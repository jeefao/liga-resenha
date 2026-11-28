-- =====================================================================
-- Liga Resenha V6 — histórico do app, situação do atleta na próxima liga
-- e atletas que são administradores.
--
-- Histórico: tudo que muda no banco (temporadas, atletas, contas,
-- administradores, financeiro) é anotado por gatilhos, com quem fez e
-- quando. As ligas já têm o próprio registro (ligas_eventos), que entra
-- junto na leitura. Visitas: o app chama registrar_visita() ao abrir.
-- A mesma ação repetida pela mesma pessoa em poucos minutos vira uma
-- linha só ("vezes"), para o histórico não encher de linhas iguais.
-- Só o dono lê o histórico geral; o do financeiro abre para quem tem
-- "Financeiro: ver". Ninguém lê a tabela direto.
-- =====================================================================

create table public.historico (
  id      bigint generated always as identity primary key,
  em      timestamptz not null default now(),
  user_id uuid,
  area    text not null check (area in ('temporadas', 'atletas', 'usuarios', 'financeiro', 'visita')),
  acao    text not null check (char_length(acao) <= 120),
  alvo    text check (alvo is null or char_length(alvo) <= 200),
  vezes   integer not null default 1
);
create index historico_em_idx on public.historico (em desc);
create index historico_area_idx on public.historico (area, em desc);
alter table public.historico enable row level security;
revoke all on public.historico from public, anon, authenticated;

-- anota (ou soma na linha igual mais recente, se for dentro da janela)
-- p_mesmo_alvo = false: junta mesmo com o texto diferente e fica o mais novo (ex.: ajustes do caixa)
create function public._hist(p_area text, p_acao text, p_alvo text, p_janela interval default interval '10 minutes',
                             p_mesmo_alvo boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_alvo text := left(p_alvo, 200);
begin
  select id into v_id from public.historico
   where em > now() - p_janela and area = p_area and acao = p_acao
     and user_id is not distinct from auth.uid() and (not p_mesmo_alvo or alvo is not distinct from v_alvo)
   order by em desc limit 1;
  if v_id is not null then
    update public.historico set em = now(), vezes = vezes + 1, alvo = v_alvo where id = v_id;
  else
    insert into public.historico (user_id, area, acao, alvo) values (auth.uid(), p_area, left(p_acao, 120), v_alvo);
  end if;
end;
$$;

create function public._hist_reais(p_centavos bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_centavos < 0 then '-' else '' end || 'R$ '
         || replace(replace(replace(to_char(abs(p_centavos) / 100.0, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

create function public._hist_conta(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(t.nome, a.nome_informado) || ' (' || a.email || ')'
                     from public.acessos a left join public.atletas t on t.id = a.atleta_id
                    where a.user_id = p_user_id),
                  (select u.email from auth.users u where u.id = p_user_id), 'conta apagada');
$$;

create function public._hist_liga(p_liga_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select nome from public.ligas where id = p_liga_id),
                  (select liga_nome from public.fin_rodadas where liga_id = p_liga_id), 'liga apagada');
$$;

-- gatilho único: decide o texto pela tabela e pelo que mudou
create function public._hist_gatilho()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  x jsonb := coalesce(n, o);
  v_area text;
  v_acao text;
  v_alvo text;
begin
  case tg_table_name
  when 'temporadas' then
    v_area := 'temporadas'; v_alvo := x ->> 'nome';
    v_acao := case tg_op when 'INSERT' then 'criou a temporada' when 'DELETE' then 'apagou a temporada'
              else case when n ->> 'status' is distinct from o ->> 'status' then 'mudou a temporada para ' || (n ->> 'status')
                        when n ->> 'publica' is distinct from o ->> 'publica' then 'mudou a visibilidade da temporada'
                        else 'alterou a temporada' end end;
  when 'atletas' then
    v_area := 'atletas'; v_alvo := x ->> 'nome';
    v_acao := case tg_op when 'INSERT' then 'cadastrou o atleta' when 'DELETE' then 'apagou o atleta'
              else case when n ->> 'nome' is distinct from o ->> 'nome' then 'renomeou o atleta (antes: ' || (o ->> 'nome') || ')'
                        when n ->> 'situacao' is distinct from o ->> 'situacao' then 'mudou a situação para ' || (n ->> 'situacao')
                        else 'editou o atleta' end end;
  when 'acessos' then
    v_area := 'usuarios'; v_alvo := (x ->> 'nome_informado') || ' (' || (x ->> 'email') || ')';
    if tg_op = 'UPDATE' and n ->> 'status' is not distinct from o ->> 'status'
       and n ->> 'atleta_id' is not distinct from o ->> 'atleta_id'
       and n ->> 'nome_informado' is not distinct from o ->> 'nome_informado'
       and n ->> 'atualizado_em' is not distinct from o ->> 'atualizado_em' then
      return null; -- só a data do último acesso mudou (visitas têm registro próprio)
    end if;
    v_acao := case tg_op when 'INSERT' then 'pediu acesso' when 'DELETE' then 'excluiu a conta'
              else case when n ->> 'status' is distinct from o ->> 'status' then
                          case n ->> 'status' when 'aprovado' then 'aprovou o acesso' when 'recusado' then 'recusou o acesso'
                                              when 'bloqueado' then 'bloqueou o acesso' else 'pediu acesso' end
                        when n ->> 'atleta_id' is distinct from o ->> 'atleta_id' then 'mudou o atleta ligado à conta'
                        when n ->> 'nome_informado' is distinct from o ->> 'nome_informado' then 'pediu acesso'
                        else 'trocou a senha da conta' end end;
  when 'admins' then
    v_area := 'usuarios'; v_alvo := public._hist_conta((x ->> 'user_id')::uuid);
    v_acao := case tg_op when 'INSERT' then 'tornou administrador' when 'DELETE' then 'tirou da administração'
              else 'mudou as permissões: ' || coalesce((select string_agg(p, ', ') from jsonb_array_elements_text(n -> 'permissoes') p), 'nenhuma') end;
  when 'pedidos_senha' then
    v_area := 'usuarios'; v_alvo := public._hist_conta((x ->> 'user_id')::uuid);
    v_acao := case tg_op when 'DELETE' then 'respondeu o pedido de senha nova' else 'pediu senha nova' end;
  when 'fin_config' then
    v_area := 'financeiro'; v_acao := 'alterou os ajustes do caixa';
    v_alvo := 'saldo inicial ' || public._hist_reais((n ->> 'saldo_inicial_centavos')::bigint)
              || ' • inscrição ' || public._hist_reais((n ->> 'inscricao_relampago_centavos')::bigint);
  when 'fin_temporadas' then
    v_area := 'financeiro'; v_acao := 'alterou a inscrição da temporada';
    v_alvo := (select nome from public.temporadas where id = (x ->> 'temporada_id')::uuid)
              || case when tg_op = 'DELETE' then ' (igual às relâmpago)' else ' • ' || public._hist_reais((n ->> 'inscricao_centavos')::bigint) end;
  when 'fin_rodadas' then
    v_area := 'financeiro'; v_alvo := x ->> 'liga_nome';
    v_acao := case tg_op when 'INSERT' then 'ativou a cobrança da rodada' when 'DELETE' then 'parou a cobrança da rodada'
              else 'alterou o valor da inscrição da rodada' end;
  when 'fin_inscricoes' then
    v_area := 'financeiro'; v_alvo := (x ->> 'nome') || ' • ' || public._hist_liga((x ->> 'liga_id')::uuid);
    v_acao := case when tg_op = 'DELETE' then 'voltou a inscrição para pendente'
                   when n ->> 'status' = 'isento' then 'marcou isento'
                   else 'marcou pago ' || public._hist_reais((n ->> 'valor_centavos')::bigint) end;
  when 'fin_lancamentos' then
    v_area := 'financeiro';
    v_alvo := (x ->> 'categoria') || ' ' || public._hist_reais((x ->> 'valor_centavos')::bigint)
              || coalesce(' — ' || (x ->> 'descricao'), '')
              || coalesce(' • ' || public._hist_liga((x ->> 'liga_id')::uuid), '');
    v_acao := case when tg_op = 'INSERT' then case when x ->> 'tipo' = 'saida' then 'lançou despesa' else 'lançou entrada' end
                   when tg_op = 'DELETE' or (n ->> 'excluido_em' is not null and o ->> 'excluido_em' is null) then 'excluiu o lançamento'
                   else 'editou o lançamento' end;
  when 'fin_premios' then
    v_area := 'financeiro';
    v_alvo := (x ->> 'colocacao') || 'º lugar ' || public._hist_reais((x ->> 'valor_centavos')::bigint) || ' • '
              || coalesce(public._hist_liga((x ->> 'liga_id')::uuid),
                          (select nome from public.temporadas where id = (x ->> 'temporada_id')::uuid), '');
    v_acao := case when tg_op = 'INSERT' then 'previu prêmio' when tg_op = 'DELETE' then 'excluiu prêmio'
                   when n ->> 'lancamento_id' is not null and o ->> 'lancamento_id' is null then 'pagou prêmio'
                   when n ->> 'lancamento_id' is null and o ->> 'lancamento_id' is not null then 'prêmio voltou a previsto'
                   else 'editou prêmio' end;
  else
    return null;
  end case;
  perform public._hist(v_area, v_acao, v_alvo, interval '10 minutes', tg_table_name <> 'fin_config');
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['temporadas', 'atletas', 'acessos', 'admins', 'pedidos_senha', 'fin_config', 'fin_temporadas',
                           'fin_rodadas', 'fin_inscricoes', 'fin_lancamentos', 'fin_premios'] loop
    execute format('create trigger historico_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public._hist_gatilho()', t);
  end loop;
end;
$$;

-- o app avisa que a pessoa abriu (só contas aprovadas e administradores)
create function public.registrar_visita()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin()
     and not exists (select 1 from public.acessos where user_id = auth.uid() and status = 'aprovado') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  perform public._hist('visita', 'abriu o app', null, interval '30 minutes');
  return jsonb_build_object('ok', true);
end;
$$;

-- leitura: histórico do app + eventos das ligas, mais recentes primeiro (100 por vez)
create function public._historico_ler(p_area text, p_antes timestamptz, p_limite integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('em', x.em, 'area', x.area, 'acao', x.acao, 'alvo', x.alvo, 'vezes', x.vezes,
                                               'quem', case when x.user_id is null then 'sem login'
                                                            else coalesce((select coalesce(t.nome, a.nome_informado)
                                                                             from public.acessos a left join public.atletas t on t.id = a.atleta_id
                                                                            where a.user_id = x.user_id),
                                                                          (select u.email from auth.users u where u.id = x.user_id),
                                                                          'conta apagada') end)
                            order by x.em desc), '[]'::jsonb)
    from (
      select * from (
        select h.em, h.area, h.acao, h.alvo, h.vezes, h.user_id from public.historico h
         where (p_area is null or h.area = p_area) and (p_antes is null or h.em < p_antes)
        union all
        select e.criado_em, 'ligas', e.descricao, l.nome, 1, e.criado_por
          from public.ligas_eventos e join public.ligas l on l.id = e.liga_id
         where (p_area is null or p_area = 'ligas') and (p_antes is null or e.criado_em < p_antes)
      ) y order by y.em desc limit least(greatest(coalesce(p_limite, 100), 1), 200)
    ) x;
$$;

create function public.historico_app(p_area text default null, p_antes timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._exigir_dono();
  return public._historico_ler(p_area, p_antes, 100);
end;
$$;

create function public.historico_financeiro(p_antes timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._exigir_permissao('financeiro_ver');
  return public._historico_ler('financeiro', p_antes, 100);
end;
$$;

-- linha "Próxima etapa" da consulta: o atleta ligado à conta está na liga? pagou?
create function public.minha_situacao(p_liga_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_atleta uuid;
  v_dados jsonb;
  v_inscrito boolean := false;
  v_cobranca boolean := false;
  v_status text;
begin
  if not public.is_admin()
     and not exists (select 1 from public.acessos where user_id = auth.uid() and status = 'aprovado') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  select atleta_id into v_atleta from public.acessos where user_id = auth.uid();
  if p_liga_id is not null and v_atleta is not null then
    select dados into v_dados from public.ligas where id = p_liga_id and excluida_em is null;
    v_inscrito := exists (select 1 from public._fin_inscritos(v_dados) i where i.atleta_id = v_atleta);
    v_cobranca := exists (select 1 from public.fin_rodadas where liga_id = p_liga_id);
    if v_inscrito and v_cobranca then
      select status into v_status from public.fin_inscricoes where liga_id = p_liga_id and chave = v_atleta::text;
      v_status := coalesce(v_status, 'pendente');
    end if;
  end if;
  return jsonb_build_object('atleta_id', v_atleta, 'inscrito', v_inscrito, 'cobranca', v_cobranca, 'pagamento', v_status);
end;
$$;

-- tag ADM na lista de atletas
create function public.atletas_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._exigir_admin();
  return coalesce((select jsonb_agg(distinct a.atleta_id) from public.admins d
                     join public.acessos a on a.user_id = d.user_id
                    where a.atleta_id is not null), '[]'::jsonb);
end;
$$;

revoke all on function public._hist(text, text, text, interval, boolean), public._hist_reais(bigint), public._hist_conta(uuid),
  public._hist_liga(uuid), public._hist_gatilho(), public._historico_ler(text, timestamptz, integer),
  public.registrar_visita(), public.historico_app(text, timestamptz), public.historico_financeiro(timestamptz),
  public.minha_situacao(uuid), public.atletas_admins()
from public, anon, authenticated;
grant execute on function public.registrar_visita(), public.historico_app(text, timestamptz),
  public.historico_financeiro(timestamptz), public.minha_situacao(uuid), public.atletas_admins() to authenticated;
