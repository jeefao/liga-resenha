-- =====================================================================
-- Liga Resenha V6 — Finanças: lançamento pago ou pendente
-- Cada despesa/entrada passa a ter situação: paga (entra no caixa) ou
-- a pagar / a receber (entra só no saldo futuro previsto). Os lançamentos
-- que já existiam continuam pagos (o caixa não muda). Pagamento de prêmio
-- já nasce pago. Saldo futuro previsto = caixa − a pagar + entradas a
-- receber − premiação prevista (inscrições pendentes seguem à parte, em
-- "A receber", como antes).
-- =====================================================================

alter table public.fin_lancamentos add column pago boolean not null default true;
alter table public.fin_lancamentos add column pago_em date;
update public.fin_lancamentos set pago_em = data where pago_em is null;

drop function public.fin_lancar(uuid, text, text, text, integer, date, uuid, uuid);

create function public.fin_lancar(p_id uuid, p_tipo text, p_categoria text, p_descricao text, p_valor_centavos integer,
                                  p_data date, p_liga_id uuid default null, p_temporada_id uuid default null,
                                  p_pago boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.fin_lancamentos;
begin
  perform public._exigir_permissao('financeiro_lancar');
  if p_tipo not in ('entrada', 'saida') then raise exception 'tipo_invalido' using errcode = '22023'; end if;
  if p_valor_centavos is null or p_valor_centavos < 1 or p_valor_centavos > 100000000 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_categoria, ''))) not between 1 and 40 then
    raise exception 'categoria_invalida' using errcode = '22023';
  end if;
  if p_liga_id is not null and not exists (select 1 from public.ligas where id = p_liga_id)
     and not exists (select 1 from public.fin_rodadas where liga_id = p_liga_id) then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_temporada_id is not null and not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_id is not null then
    select * into x from public.fin_lancamentos where id = p_id and excluido_em is null for update;
  end if;
  if x.id is not null then
    if x.premio_id is not null then raise exception 'lancamento_de_premio' using errcode = 'P0001'; end if;
    update public.fin_lancamentos
       set tipo = p_tipo, categoria = btrim(p_categoria), descricao = nullif(btrim(p_descricao), ''),
           valor_centavos = p_valor_centavos, data = coalesce(p_data, data), liga_id = p_liga_id,
           temporada_id = p_temporada_id, atualizado_em = now(), atualizado_por = auth.uid(),
           pago = coalesce(p_pago, pago),
           pago_em = case when not coalesce(p_pago, pago) then null
                          when pago then pago_em else current_date end
     where id = x.id
    returning * into x;
  else
    insert into public.fin_lancamentos (id, tipo, categoria, descricao, valor_centavos, data, liga_id, temporada_id,
                                        criado_por, atualizado_por, pago, pago_em)
    values (coalesce(p_id, gen_random_uuid()), p_tipo, btrim(p_categoria), nullif(btrim(p_descricao), ''), p_valor_centavos,
            coalesce(p_data, current_date), p_liga_id, p_temporada_id, auth.uid(), auth.uid(),
            coalesce(p_pago, true), case when coalesce(p_pago, true) then coalesce(p_data, current_date) end)
    returning * into x;
  end if;
  return jsonb_build_object('ok', true, 'id', x.id);
end;
$$;

create or replace function public.fin_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.fin_config;
  v_rodadas jsonb;
  v_lanc jsonb;
  v_premios jsonb;
  v_recebido bigint;
  v_entradas bigint;
  v_saidas bigint;
  v_a_receber bigint;
  v_previsto bigint;
  v_caixa bigint;
  v_a_pagar bigint;
  v_entradas_a_receber bigint;
begin
  perform public._exigir_permissao('financeiro_ver');
  select * into c from public.fin_config;

  with rod as (
    select r.liga_id, coalesce(l.nome, r.liga_nome) as nome, l.data, l.temporada_id, l.etapa_numero, l.status,
           l.excluida_em, (l.id is null) as apagada, t.nome as temporada_nome,
           public._fin_valor_rodada(r.liga_id) as valor, r.inscricao_centavos as valor_proprio,
           coalesce(l.dados, '{}'::jsonb) as dados
      from public.fin_rodadas r
      left join public.ligas l on l.id = r.liga_id
      left join public.temporadas t on t.id = l.temporada_id
  ), ins as (
    select rod.liga_id, i.chave, i.nome, i.atleta_id, i.posicao,
           coalesce(fi.status, 'pendente') as status, coalesce(fi.valor_centavos, 0) as valor_pago, fi.pago_em
      from rod cross join lateral public._fin_inscritos(rod.dados) i
      left join public.fin_inscricoes fi on fi.liga_id = rod.liga_id and fi.chave = i.chave
    union all
    -- pagamentos de quem saiu da lista continuam valendo
    select fi.liga_id, fi.chave, fi.nome, fi.atleta_id, 1000, fi.status, fi.valor_centavos, fi.pago_em
      from public.fin_inscricoes fi join rod on rod.liga_id = fi.liga_id
     where not exists (select 1 from public._fin_inscritos(rod.dados) i where i.chave = fi.chave)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'liga_id', rod.liga_id, 'nome', rod.nome, 'data', rod.data, 'temporada_id', rod.temporada_id,
           'temporada_nome', rod.temporada_nome, 'etapa_numero', rod.etapa_numero, 'status', rod.status,
           'na_lixeira', rod.excluida_em is not null, 'apagada', rod.apagada,
           'valor_centavos', rod.valor, 'valor_proprio', rod.valor_proprio,
           'inscritos', coalesce((select jsonb_agg(jsonb_build_object('chave', ins.chave, 'nome', ins.nome, 'atleta_id', ins.atleta_id,
                                          'status', ins.status, 'valor_centavos', ins.valor_pago, 'pago_em', ins.pago_em)
                                   order by ins.posicao, ins.nome)
                                    from ins where ins.liga_id = rod.liga_id), '[]'::jsonb),
           'recebido', (select coalesce(sum(ins.valor_pago), 0) from ins where ins.liga_id = rod.liga_id and ins.status = 'pago'),
           'a_receber', rod.valor * (select count(*) from ins where ins.liga_id = rod.liga_id and ins.status = 'pendente'),
           'entradas', (select coalesce(sum(x.valor_centavos), 0) from public.fin_lancamentos x
                         where x.liga_id = rod.liga_id and x.tipo = 'entrada' and x.excluido_em is null and x.pago),
           'saidas', (select coalesce(sum(x.valor_centavos), 0) from public.fin_lancamentos x
                       where x.liga_id = rod.liga_id and x.tipo = 'saida' and x.excluido_em is null and x.pago),
           'a_pagar', (select coalesce(sum(x.valor_centavos), 0) from public.fin_lancamentos x
                        where x.liga_id = rod.liga_id and x.tipo = 'saida' and x.excluido_em is null and not x.pago),
           'premiacao_prevista', (select coalesce(sum(p.valor_centavos), 0) from public.fin_premios p
                                   where p.liga_id = rod.liga_id and p.lancamento_id is null))
         order by rod.data desc nulls last, rod.nome), '[]'::jsonb)
    into v_rodadas
    from rod;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'tipo', x.tipo, 'categoria', x.categoria, 'descricao', x.descricao,
           'valor_centavos', x.valor_centavos, 'data', x.data, 'liga_id', x.liga_id, 'temporada_id', x.temporada_id,
           'premio_id', x.premio_id, 'liga_nome', coalesce(l.nome, r.liga_nome), 'temporada_nome', t.nome,
           'pago', x.pago, 'pago_em', case when x.pago then coalesce(x.pago_em, x.data) end)
         order by x.data desc, x.criado_em desc), '[]'::jsonb)
    into v_lanc
    from public.fin_lancamentos x
    left join public.ligas l on l.id = x.liga_id
    left join public.fin_rodadas r on r.liga_id = x.liga_id
    left join public.temporadas t on t.id = x.temporada_id
   where x.excluido_em is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'liga_id', p.liga_id, 'temporada_id', p.temporada_id, 'colocacao', p.colocacao,
           'descricao', p.descricao, 'valor_centavos', p.valor_centavos, 'pago', p.lancamento_id is not null,
           'lancamento_id', p.lancamento_id, 'liga_nome', coalesce(l.nome, r.liga_nome), 'temporada_nome', t.nome)
         order by p.temporada_id nulls last, p.liga_id, p.colocacao), '[]'::jsonb)
    into v_premios
    from public.fin_premios p
    left join public.ligas l on l.id = p.liga_id
    left join public.fin_rodadas r on r.liga_id = p.liga_id
    left join public.temporadas t on t.id = p.temporada_id;

  select coalesce(sum(valor_centavos), 0) into v_recebido from public.fin_inscricoes where status = 'pago';
  select coalesce(sum(valor_centavos) filter (where tipo = 'entrada' and pago), 0),
         coalesce(sum(valor_centavos) filter (where tipo = 'saida' and pago), 0),
         coalesce(sum(valor_centavos) filter (where tipo = 'saida' and not pago), 0),
         coalesce(sum(valor_centavos) filter (where tipo = 'entrada' and not pago), 0)
    into v_entradas, v_saidas, v_a_pagar, v_entradas_a_receber
    from public.fin_lancamentos where excluido_em is null;
  select coalesce(sum((r ->> 'a_receber')::bigint), 0) into v_a_receber from jsonb_array_elements(v_rodadas) r;
  select coalesce(sum(valor_centavos), 0) into v_previsto from public.fin_premios where lancamento_id is null;
  v_caixa := c.saldo_inicial_centavos + v_recebido + v_entradas - v_saidas;

  return jsonb_build_object(
    'config', jsonb_build_object('saldo_inicial_centavos', c.saldo_inicial_centavos,
                                 'inscricao_relampago_centavos', c.inscricao_relampago_centavos),
    'temporadas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'status', t.status,
                                                                'inscricao_centavos', ft.inscricao_centavos)
                                             order by t.inicio desc, t.nome)
                              from public.temporadas t left join public.fin_temporadas ft on ft.temporada_id = t.id), '[]'::jsonb),
    'rodadas', v_rodadas,
    'ligas_sem_cobranca', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'data', l.data,
                                                                        'temporada_nome', t.nome, 'etapa_numero', l.etapa_numero)
                                                     order by l.data desc, l.nome)
                                      from public.ligas l left join public.temporadas t on t.id = l.temporada_id
                                     where l.excluida_em is null
                                       and not exists (select 1 from public.fin_rodadas r where r.liga_id = l.id)), '[]'::jsonb),
    'lancamentos', v_lanc,
    'premios', v_premios,
    'totais', jsonb_build_object('saldo_inicial', c.saldo_inicial_centavos, 'inscricoes_recebidas', v_recebido,
                                 'entradas', v_entradas, 'saidas', v_saidas, 'caixa', v_caixa,
                                 'a_receber', v_a_receber, 'premiacao_prevista', v_previsto,
                                 'a_pagar', v_a_pagar, 'entradas_a_receber', v_entradas_a_receber,
                                 'saldo_futuro', v_caixa - v_a_pagar + v_entradas_a_receber - v_previsto)
  );
end;
$$;

create or replace function public._hist_gatilho()
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
                   when (n ->> 'pago')::boolean and not (o ->> 'pago')::boolean then
                     case when x ->> 'tipo' = 'saida' then 'pagou a despesa' else 'recebeu a entrada' end
                   when not (n ->> 'pago')::boolean and (o ->> 'pago')::boolean then 'voltou o lançamento para pendente'
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

-- dar baixa (pagar / receber) ou voltar para pendente
create function public.fin_baixar_lancamento(p_id uuid, p_pago boolean, p_pago_em date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.fin_lancamentos;
begin
  perform public._exigir_permissao('financeiro_lancar');
  select * into x from public.fin_lancamentos where id = p_id and excluido_em is null for update;
  if x.id is null then raise exception 'lancamento_nao_encontrado' using errcode = 'P0002'; end if;
  if x.premio_id is not null then raise exception 'lancamento_de_premio' using errcode = 'P0001'; end if;
  update public.fin_lancamentos
     set pago = coalesce(p_pago, true),
         pago_em = case when coalesce(p_pago, true) then coalesce(p_pago_em, current_date) end,
         atualizado_em = now(), atualizado_por = auth.uid()
   where id = x.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.fin_lancar(uuid, text, text, text, integer, date, uuid, uuid, boolean),
  public.fin_baixar_lancamento(uuid, boolean, date) from public, anon, authenticated;
grant execute on function public.fin_lancar(uuid, text, text, text, integer, date, uuid, uuid, boolean),
  public.fin_baixar_lancamento(uuid, boolean, date) to authenticated;
