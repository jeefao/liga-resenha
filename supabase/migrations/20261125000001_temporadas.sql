-- =====================================================================
-- Liga Resenha V6 — temporadas
-- Cada temporada guarda as próprias regras (cópia ajustável) e os ajustes
-- manuais de pontos. As etapas são ligas comuns ligadas à temporada
-- (temporada_id + etapa_numero). Mesmas proteções das ligas: escrita só
-- pelas funções, controle de versão, cópia de cada versão, sem exclusão.
-- =====================================================================

create table public.temporadas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(btrim(nome)) between 1 and 120),
  inicio         date,
  status         text not null default 'andamento'
                 check (status in ('andamento', 'encerrada', 'arquivada')),
  regras         jsonb not null check (jsonb_typeof(regras) = 'object'),
  dados          jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(dados) = 'object' and octet_length(dados::text) <= 500000),
  publica        boolean not null default false,
  versao         integer not null default 1,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.temporadas enable row level security;

create policy temporadas_admin_ler on public.temporadas
  for select to authenticated
  using (public.is_admin());

create table public.temporadas_versoes (
  id            bigint generated always as identity primary key,
  temporada_id  uuid not null references public.temporadas (id),
  versao        integer not null,
  dados         jsonb not null,
  motivo        text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  unique (temporada_id, versao)
);

alter table public.temporadas_versoes enable row level security;

create policy temporadas_versoes_admin_ler on public.temporadas_versoes
  for select to authenticated
  using (public.is_admin());

-- Etapas: ligas ligadas a uma temporada
alter table public.ligas
  add column temporada_id uuid references public.temporadas (id),
  add column etapa_numero smallint check (etapa_numero between 1 and 60),
  add constraint ligas_etapa_coerente check ((temporada_id is null) = (etapa_numero is null));

create unique index ligas_etapa_unica on public.ligas (temporada_id, etapa_numero)
  where temporada_id is not null and excluida_em is null;

-- A temporada e o número da etapa não mudam depois de criados
create or replace function public._ligas_antes_de_alterar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.versao <> old.versao + 1 then
    raise exception 'versao_invalida: esperado %, recebido %', old.versao + 1, new.versao
      using errcode = 'P0001';
  end if;

  if new.participantes <> old.participantes
     and old.status <> 'preparacao' and new.status <> 'preparacao' then
    raise exception 'participantes_travados: a quantidade de atletas não pode mudar depois de iniciar a liga'
      using errcode = 'P0001';
  end if;

  new.id := old.id;
  new.temporada_id := old.temporada_id;
  new.etapa_numero := old.etapa_numero;
  new.criado_em := old.criado_em;
  new.criado_por := old.criado_por;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Gatilhos da temporada
-- ---------------------------------------------------------------------
create function public._temporadas_antes_de_criar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome := btrim(new.nome);
  new.versao := 1;
  new.criado_em := now();
  new.criado_por := auth.uid();
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger temporadas_antes_de_criar
  before insert on public.temporadas
  for each row execute function public._temporadas_antes_de_criar();

create function public._temporadas_antes_de_alterar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.versao <> old.versao + 1 then
    raise exception 'versao_invalida: esperado %, recebido %', old.versao + 1, new.versao
      using errcode = 'P0001';
  end if;
  new.nome := btrim(new.nome);
  new.id := old.id;
  new.criado_em := old.criado_em;
  new.criado_por := old.criado_por;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger temporadas_antes_de_alterar
  before update on public.temporadas
  for each row execute function public._temporadas_antes_de_alterar();

create trigger temporadas_sem_exclusao
  before delete on public.temporadas
  for each row execute function public._bloquear_exclusao();

create function public._temporadas_gravar_versao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.temporadas_versoes (temporada_id, versao, dados, motivo, criado_por)
  values (new.id, new.versao, to_jsonb(new),
          coalesce(nullif(btrim(current_setting('liga_resenha.motivo', true)), ''),
                   case when tg_op = 'INSERT' then 'Criação' else 'Alteração' end),
          auth.uid());
  return null;
end;
$$;

create trigger temporadas_gravar_versao
  after insert or update on public.temporadas
  for each row execute function public._temporadas_gravar_versao();

create trigger temporadas_versoes_imutaveis
  before update or delete on public.temporadas_versoes
  for each row execute function public._bloquear_exclusao();

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app
-- ---------------------------------------------------------------------
create function public._temporada_resumo(t public.temporadas)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', true) || to_jsonb(t);
$$;

create function public.criar_temporada(
  p_id     uuid,
  p_nome   text,
  p_inicio date,
  p_regras jsonb,
  p_dados  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.temporadas;
begin
  perform public._exigir_admin();
  if p_id is not null then
    select * into t from public.temporadas where id = p_id;
    if found then
      return public._temporada_resumo(t) || jsonb_build_object('ja_existia', true);
    end if;
  end if;
  perform set_config('liga_resenha.motivo', 'Criação da temporada', true);
  insert into public.temporadas (id, nome, inicio, regras, dados)
  values (coalesce(p_id, gen_random_uuid()), p_nome, p_inicio, p_regras, coalesce(p_dados, '{}'::jsonb))
  returning * into t;
  return public._temporada_resumo(t);
end;
$$;

-- Altera a temporada (nome, regras, ajustes, situação, página pública)
-- conferindo a versão: se outro aparelho alterou antes, devolve conflito.
create function public.salvar_temporada(
  p_id              uuid,
  p_versao_esperada integer,
  p_nome            text default null,
  p_inicio          date default null,
  p_regras          jsonb default null,
  p_dados           jsonb default null,
  p_status          text default null,
  p_publica         boolean default null,
  p_motivo          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.temporadas;
begin
  perform public._exigir_admin();
  select * into t from public.temporadas where id = p_id for update;
  if not found then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if t.versao <> p_versao_esperada then
    return jsonb_build_object('ok', false, 'conflito', true, 'versao_servidor', t.versao,
                              'atualizado_em', t.atualizado_em);
  end if;
  perform set_config('liga_resenha.motivo', coalesce(nullif(btrim(p_motivo), ''), 'Alteração'), true);
  update public.temporadas set
    nome    = coalesce(p_nome, nome),
    inicio  = coalesce(p_inicio, inicio),
    regras  = coalesce(p_regras, regras),
    dados   = coalesce(p_dados, dados),
    status  = coalesce(p_status, status),
    publica = coalesce(p_publica, publica),
    versao  = versao + 1
  where id = p_id
  returning * into t;
  return public._temporada_resumo(t);
end;
$$;

-- Cria a liga de uma etapa da temporada
create function public.criar_etapa(
  p_temporada_id uuid,
  p_numero       integer,
  p_id           uuid,
  p_nome         text,
  p_data         date,
  p_dados        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.temporadas;
  v public.ligas;
begin
  perform public._exigir_admin();
  if p_id is not null then
    select * into v from public.ligas where id = p_id;
    if found then
      return public._liga_resumo(v) || jsonb_build_object('ja_existia', true);
    end if;
  end if;
  select * into t from public.temporadas where id = p_temporada_id;
  if not found then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if t.status <> 'andamento' then
    raise exception 'temporada_fechada: a temporada não está em andamento' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ligas
             where temporada_id = p_temporada_id and etapa_numero = p_numero and excluida_em is null) then
    raise exception 'etapa_ja_existe: a etapa % já foi criada', p_numero using errcode = 'P0001';
  end if;

  perform set_config('liga_resenha.motivo', 'Criação da etapa ' || p_numero, true);
  insert into public.ligas (id, nome, data, participantes, status, etapa, dados, temporada_id, etapa_numero)
  values (
    coalesce(p_id, gen_random_uuid()), btrim(p_nome), p_data,
    case when jsonb_typeof(p_dados -> 'names') = 'array' then jsonb_array_length(p_dados -> 'names') end,
    'preparacao', 'cadastro', p_dados, p_temporada_id, p_numero
  )
  returning * into v;

  perform public._registrar_eventos(v.id, v.versao, jsonb_build_array(jsonb_build_object(
    'tipo', 'criada', 'descricao', 'Etapa ' || p_numero || ' da temporada "' || t.nome || '" criada')));
  return public._liga_resumo(v);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on public.temporadas, public.temporadas_versoes from public, anon, authenticated;
grant select on public.temporadas, public.temporadas_versoes to authenticated;

revoke all on function
  public._temporadas_antes_de_criar(),
  public._temporadas_antes_de_alterar(),
  public._temporadas_gravar_versao(),
  public._temporada_resumo(public.temporadas),
  public.criar_temporada(uuid, text, date, jsonb, jsonb),
  public.salvar_temporada(uuid, integer, text, date, jsonb, jsonb, text, boolean, text),
  public.criar_etapa(uuid, integer, uuid, text, date, jsonb)
from public, anon, authenticated;

grant execute on function
  public.criar_temporada(uuid, text, date, jsonb, jsonb),
  public.salvar_temporada(uuid, integer, text, date, jsonb, jsonb, text, boolean, text),
  public.criar_etapa(uuid, integer, uuid, text, date, jsonb)
to authenticated;
