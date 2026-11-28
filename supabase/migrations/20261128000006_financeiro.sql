-- =====================================================================
-- Liga Resenha V6 — Finanças
-- Caixa único da liga: saldo inicial + inscrições pagas + entradas − saídas.
-- Inscrição cobrada por atleta em cada rodada (liga relâmpago ou etapa):
-- valor padrão das relâmpago, valor padrão de cada temporada e, se preciso,
-- um valor diferente numa rodada. Cada inscrito fica pago, pendente ou isento.
-- Premiação prevista por colocação (rodada ou temporada); quando é paga
-- vira uma saída do caixa. Saldo futuro previsto = caixa − premiação prevista.
-- Valores sempre em centavos (inteiros).
-- Ler exige "financeiro_ver"; gravar exige "financeiro_lancar".
-- As tabelas não são acessíveis diretamente: só pelas funções abaixo.
-- Não há chave estrangeira para ligas/temporadas de propósito: apagar uma
-- liga de vez não pode apagar dinheiro que já entrou no caixa.
-- =====================================================================

create table public.fin_config (
  id                           boolean primary key default true check (id),
  saldo_inicial_centavos       bigint not null default 0,
  inscricao_relampago_centavos integer not null default 0 check (inscricao_relampago_centavos between 0 and 100000000),
  atualizado_em                timestamptz not null default now(),
  atualizado_por               uuid
);
insert into public.fin_config default values;

create table public.fin_temporadas (
  temporada_id       uuid primary key,
  inscricao_centavos integer not null check (inscricao_centavos between 0 and 100000000),
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid
);

-- rodadas com cobrança de inscrição ativa
create table public.fin_rodadas (
  liga_id            uuid primary key,
  liga_nome          text not null,
  inscricao_centavos integer check (inscricao_centavos between 0 and 100000000), -- null = valor padrão
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid
);

-- pendente = sem linha aqui
create table public.fin_inscricoes (
  liga_id        uuid not null references public.fin_rodadas(liga_id) on delete cascade,
  chave          text not null,
  nome           text not null,
  atleta_id      uuid,
  status         text not null check (status in ('pago', 'isento')),
  valor_centavos integer not null default 0 check (valor_centavos between 0 and 100000000),
  pago_em        date,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  primary key (liga_id, chave)
);

create table public.fin_lancamentos (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('entrada', 'saida')),
  categoria      text not null check (char_length(btrim(categoria)) between 1 and 40),
  descricao      text check (descricao is null or char_length(descricao) <= 200),
  valor_centavos integer not null check (valor_centavos between 1 and 100000000),
  data           date not null default current_date,
  liga_id        uuid,
  temporada_id   uuid,
  premio_id      uuid,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  excluido_em    timestamptz,
  excluido_por   uuid
);
create index fin_lancamentos_data on public.fin_lancamentos (data desc) where excluido_em is null;

create table public.fin_premios (
  id             uuid primary key default gen_random_uuid(),
  liga_id        uuid,
  temporada_id   uuid,
  colocacao      integer not null check (colocacao between 1 and 64),
  descricao      text check (descricao is null or char_length(descricao) <= 120),
  valor_centavos integer not null check (valor_centavos between 0 and 100000000),
  lancamento_id  uuid references public.fin_lancamentos(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  check ((liga_id is null) <> (temporada_id is null))
);

alter table public.fin_config enable row level security;
alter table public.fin_temporadas enable row level security;
alter table public.fin_rodadas enable row level security;
alter table public.fin_inscricoes enable row level security;
alter table public.fin_lancamentos enable row level security;
alter table public.fin_premios enable row level security;
revoke all on public.fin_config, public.fin_temporadas, public.fin_rodadas, public.fin_inscricoes,
              public.fin_lancamentos, public.fin_premios
from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create function public._fin_valor(p_centavos bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_centavos is null or p_centavos < 0 or p_centavos > 100000000 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
end;
$$;

-- inscritos de uma liga (nomes preenchidos), com a chave usada nos pagamentos
create function public._fin_inscritos(p_dados jsonb)
returns table (chave text, nome text, atleta_id uuid, posicao integer)
language sql
immutable
set search_path = ''
as $$
  select distinct on (x.chave) x.chave, x.nome, x.atleta_id, x.posicao
    from (
      select coalesce(nullif(p_dados -> 'ids' ->> (n.i::int - 1), ''), 'nome:' || lower(btrim(n.nome))) as chave,
             btrim(n.nome) as nome,
             case when (p_dados -> 'ids' ->> (n.i::int - 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (p_dados -> 'ids' ->> (n.i::int - 1))::uuid end as atleta_id,
             n.i::int as posicao
        from jsonb_array_elements_text(case when jsonb_typeof(p_dados -> 'names') = 'array'
                                            then p_dados -> 'names' else '[]'::jsonb end) with ordinality as n(nome, i)
       where btrim(n.nome) <> ''
    ) x
   order by x.chave, x.posicao;
$$;

-- valor da inscrição de uma rodada
create function public._fin_valor_rodada(p_liga_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.inscricao_centavos,
                  case when l.temporada_id is null then c.inscricao_relampago_centavos
                       else (select ft.inscricao_centavos from public.fin_temporadas ft where ft.temporada_id = l.temporada_id) end,
                  c.inscricao_relampago_centavos, 0)
    from public.fin_config c
    left join public.fin_rodadas r on r.liga_id = p_liga_id
    left join public.ligas l on l.id = p_liga_id;
$$;

-- ---------------------------------------------------------------------
-- Leitura: tudo o que a página Finanças mostra, numa chamada só
-- ---------------------------------------------------------------------
create function public.fin_resumo()
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
                         where x.liga_id = rod.liga_id and x.tipo = 'entrada' and x.excluido_em is null),
           'saidas', (select coalesce(sum(x.valor_centavos), 0) from public.fin_lancamentos x
                       where x.liga_id = rod.liga_id and x.tipo = 'saida' and x.excluido_em is null),
           'premiacao_prevista', (select coalesce(sum(p.valor_centavos), 0) from public.fin_premios p
                                   where p.liga_id = rod.liga_id and p.lancamento_id is null))
         order by rod.data desc nulls last, rod.nome), '[]'::jsonb)
    into v_rodadas
    from rod;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'tipo', x.tipo, 'categoria', x.categoria, 'descricao', x.descricao,
           'valor_centavos', x.valor_centavos, 'data', x.data, 'liga_id', x.liga_id, 'temporada_id', x.temporada_id,
           'premio_id', x.premio_id, 'liga_nome', coalesce(l.nome, r.liga_nome), 'temporada_nome', t.nome)
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
  select coalesce(sum(valor_centavos) filter (where tipo = 'entrada'), 0),
         coalesce(sum(valor_centavos) filter (where tipo = 'saida'), 0)
    into v_entradas, v_saidas
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
                                 'saldo_futuro', v_caixa - v_previsto)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Gravação (exige "financeiro_lancar")
-- ---------------------------------------------------------------------
create function public.fin_salvar_config(p_saldo_inicial_centavos bigint, p_inscricao_relampago_centavos integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_permissao('financeiro_lancar');
  if p_saldo_inicial_centavos is null or abs(p_saldo_inicial_centavos) > 10000000000 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
  perform public._fin_valor(p_inscricao_relampago_centavos);
  update public.fin_config
     set saldo_inicial_centavos = p_saldo_inicial_centavos,
         inscricao_relampago_centavos = p_inscricao_relampago_centavos,
         atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- valor padrão da inscrição numa temporada (null = sem valor próprio)
create function public.fin_salvar_valor_temporada(p_temporada_id uuid, p_inscricao_centavos integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_permissao('financeiro_lancar');
  if not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_inscricao_centavos is null then
    delete from public.fin_temporadas where temporada_id = p_temporada_id;
  else
    perform public._fin_valor(p_inscricao_centavos);
    insert into public.fin_temporadas (temporada_id, inscricao_centavos, atualizado_por)
    values (p_temporada_id, p_inscricao_centavos, auth.uid())
    on conflict (temporada_id) do update
      set inscricao_centavos = excluded.inscricao_centavos, atualizado_em = now(), atualizado_por = auth.uid();
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- liga/desliga a cobrança de inscrição de uma rodada e, se quiser, um valor só dela
create function public.fin_cobrar_rodada(p_liga_id uuid, p_cobrar boolean, p_inscricao_centavos integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
begin
  perform public._exigir_permissao('financeiro_lancar');
  if not p_cobrar then
    if exists (select 1 from public.fin_inscricoes where liga_id = p_liga_id) then
      raise exception 'rodada_com_pagamentos' using errcode = 'P0001';
    end if;
    delete from public.fin_rodadas where liga_id = p_liga_id;
    return jsonb_build_object('ok', true);
  end if;
  select nome into v_nome from public.ligas where id = p_liga_id;
  if v_nome is null then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_inscricao_centavos is not null then
    perform public._fin_valor(p_inscricao_centavos);
  end if;
  insert into public.fin_rodadas (liga_id, liga_nome, inscricao_centavos, atualizado_por)
  values (p_liga_id, v_nome, p_inscricao_centavos, auth.uid())
  on conflict (liga_id) do update
    set liga_nome = excluded.liga_nome, inscricao_centavos = excluded.inscricao_centavos,
        atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- marca um inscrito como pago, isento ou pendente
create function public.fin_marcar_inscricao(p_liga_id uuid, p_chave text, p_status text,
                                            p_valor_centavos integer default null, p_pago_em date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i record;
  v_valor integer;
begin
  perform public._exigir_permissao('financeiro_lancar');
  if p_status not in ('pago', 'isento', 'pendente') then
    raise exception 'status_invalido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.fin_rodadas where liga_id = p_liga_id) then
    raise exception 'rodada_sem_cobranca' using errcode = 'P0002';
  end if;
  if p_status = 'pendente' then
    delete from public.fin_inscricoes where liga_id = p_liga_id and chave = p_chave;
    return jsonb_build_object('ok', true);
  end if;
  select x.chave, x.nome, x.atleta_id into i
    from public.ligas l cross join lateral public._fin_inscritos(l.dados) x
   where l.id = p_liga_id and x.chave = p_chave;
  if i.chave is null then
    select chave, nome, atleta_id into i from public.fin_inscricoes where liga_id = p_liga_id and chave = p_chave;
    if i.chave is null then
      raise exception 'atleta_nao_inscrito' using errcode = 'P0002';
    end if;
  end if;
  v_valor := case when p_status = 'isento' then 0 else coalesce(p_valor_centavos, public._fin_valor_rodada(p_liga_id)) end;
  perform public._fin_valor(v_valor);
  insert into public.fin_inscricoes (liga_id, chave, nome, atleta_id, status, valor_centavos, pago_em, atualizado_por)
  values (p_liga_id, i.chave, i.nome, i.atleta_id, p_status, v_valor,
          case when p_status = 'pago' then coalesce(p_pago_em, current_date) end, auth.uid())
  on conflict (liga_id, chave) do update
    set status = excluded.status, valor_centavos = excluded.valor_centavos, pago_em = excluded.pago_em,
        nome = excluded.nome, atleta_id = excluded.atleta_id, atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true, 'valor_centavos', v_valor);
end;
$$;

-- cria ou altera uma entrada/saída do caixa (da rodada, da temporada ou da liga em geral)
create function public.fin_lancar(p_id uuid, p_tipo text, p_categoria text, p_descricao text, p_valor_centavos integer,
                                  p_data date, p_liga_id uuid default null, p_temporada_id uuid default null)
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
           temporada_id = p_temporada_id, atualizado_em = now(), atualizado_por = auth.uid()
     where id = x.id
    returning * into x;
  else
    insert into public.fin_lancamentos (id, tipo, categoria, descricao, valor_centavos, data, liga_id, temporada_id,
                                        criado_por, atualizado_por)
    values (coalesce(p_id, gen_random_uuid()), p_tipo, btrim(p_categoria), nullif(btrim(p_descricao), ''), p_valor_centavos,
            coalesce(p_data, current_date), p_liga_id, p_temporada_id, auth.uid(), auth.uid())
    returning * into x;
  end if;
  return jsonb_build_object('ok', true, 'id', x.id);
end;
$$;

-- exclui um lançamento (fica guardado como excluído); se era o pagamento de um prêmio, o prêmio volta a ser previsto
create function public.fin_excluir_lancamento(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.fin_lancamentos;
begin
  perform public._exigir_permissao('financeiro_lancar');
  update public.fin_lancamentos set excluido_em = now(), excluido_por = auth.uid()
   where id = p_id and excluido_em is null
  returning * into x;
  if x.id is null then raise exception 'lancamento_nao_encontrado' using errcode = 'P0002'; end if;
  update public.fin_premios set lancamento_id = null, atualizado_em = now(), atualizado_por = auth.uid()
   where lancamento_id = x.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- prêmio previsto de uma rodada (p_liga_id) ou da temporada (p_temporada_id)
create function public.fin_salvar_premio(p_id uuid, p_liga_id uuid, p_temporada_id uuid, p_colocacao integer,
                                         p_descricao text, p_valor_centavos integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.fin_premios;
begin
  perform public._exigir_permissao('financeiro_lancar');
  perform public._fin_valor(p_valor_centavos);
  if (p_liga_id is null) = (p_temporada_id is null) then raise exception 'premio_sem_destino' using errcode = '22023'; end if;
  if p_colocacao is null or p_colocacao not between 1 and 64 then raise exception 'colocacao_invalida' using errcode = '22023'; end if;
  if p_liga_id is not null and not exists (select 1 from public.ligas where id = p_liga_id) then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_temporada_id is not null and not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if p_id is not null then
    select * into p from public.fin_premios where id = p_id for update;
  end if;
  if p.id is not null then
    if p.lancamento_id is not null then raise exception 'premio_pago' using errcode = 'P0001'; end if;
    update public.fin_premios
       set liga_id = p_liga_id, temporada_id = p_temporada_id, colocacao = p_colocacao,
           descricao = nullif(btrim(p_descricao), ''), valor_centavos = p_valor_centavos,
           atualizado_em = now(), atualizado_por = auth.uid()
     where id = p.id
    returning * into p;
  else
    insert into public.fin_premios (id, liga_id, temporada_id, colocacao, descricao, valor_centavos, atualizado_por)
    values (coalesce(p_id, gen_random_uuid()), p_liga_id, p_temporada_id, p_colocacao, nullif(btrim(p_descricao), ''),
            p_valor_centavos, auth.uid())
    returning * into p;
  end if;
  return jsonb_build_object('ok', true, 'id', p.id);
end;
$$;

create function public.fin_excluir_premio(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_permissao('financeiro_lancar');
  if exists (select 1 from public.fin_premios where id = p_id and lancamento_id is not null) then
    raise exception 'premio_pago' using errcode = 'P0001';
  end if;
  delete from public.fin_premios where id = p_id;
  if not found then raise exception 'premio_nao_encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- paga um prêmio previsto: vira uma saída do caixa na categoria Prêmios
create function public.fin_pagar_premio(p_id uuid, p_data date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.fin_premios;
  v_lanc uuid;
  v_onde text;
begin
  perform public._exigir_permissao('financeiro_lancar');
  select * into p from public.fin_premios where id = p_id for update;
  if p.id is null then raise exception 'premio_nao_encontrado' using errcode = 'P0002'; end if;
  if p.lancamento_id is not null then raise exception 'premio_pago' using errcode = 'P0001'; end if;
  if p.valor_centavos < 1 then raise exception 'valor_invalido' using errcode = '22023'; end if;
  select coalesce((select nome from public.ligas where id = p.liga_id),
                  (select liga_nome from public.fin_rodadas where liga_id = p.liga_id),
                  (select nome from public.temporadas where id = p.temporada_id), '')
    into v_onde;
  insert into public.fin_lancamentos (tipo, categoria, descricao, valor_centavos, data, liga_id, temporada_id, premio_id,
                                      criado_por, atualizado_por)
  values ('saida', 'Prêmios',
          left('Premiação ' || p.colocacao || 'º lugar' || coalesce(' (' || p.descricao || ')', '') ||
               case when v_onde <> '' then ' — ' || v_onde else '' end, 200),
          p.valor_centavos, coalesce(p_data, current_date), p.liga_id, p.temporada_id, p.id, auth.uid(), auth.uid())
  returning id into v_lanc;
  update public.fin_premios set lancamento_id = v_lanc, atualizado_em = now(), atualizado_por = auth.uid() where id = p.id;
  return jsonb_build_object('ok', true, 'lancamento_id', v_lanc);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function
  public._fin_valor(bigint), public._fin_inscritos(jsonb), public._fin_valor_rodada(uuid),
  public.fin_resumo(), public.fin_salvar_config(bigint, integer), public.fin_salvar_valor_temporada(uuid, integer),
  public.fin_cobrar_rodada(uuid, boolean, integer), public.fin_marcar_inscricao(uuid, text, text, integer, date),
  public.fin_lancar(uuid, text, text, text, integer, date, uuid, uuid), public.fin_excluir_lancamento(uuid),
  public.fin_salvar_premio(uuid, uuid, uuid, integer, text, integer), public.fin_excluir_premio(uuid),
  public.fin_pagar_premio(uuid, date)
from public, anon, authenticated;

grant execute on function
  public.fin_resumo(), public.fin_salvar_config(bigint, integer), public.fin_salvar_valor_temporada(uuid, integer),
  public.fin_cobrar_rodada(uuid, boolean, integer), public.fin_marcar_inscricao(uuid, text, text, integer, date),
  public.fin_lancar(uuid, text, text, text, integer, date, uuid, uuid), public.fin_excluir_lancamento(uuid),
  public.fin_salvar_premio(uuid, uuid, uuid, integer, text, integer), public.fin_excluir_premio(uuid),
  public.fin_pagar_premio(uuid, date)
to authenticated;
