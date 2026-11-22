-- =====================================================================
-- Liga Resenha V6 — Ligas Relâmpago online
-- Projeto Supabase EXCLUSIVO da V6 (não aplicar no banco da V2).
--
-- Princípios:
--   * Cada liga é um documento completo (coluna "dados"), no mesmo formato
--     que o app já usa. As regras aprovadas continuam no app.
--   * Clientes NÃO gravam direto nas tabelas: toda escrita passa pelas
--     funções abaixo, que conferem administrador e número de versão.
--   * Toda gravação gera automaticamente uma cópia completa em
--     ligas_versoes. Histórico e versões são imutáveis.
--   * Nada é apagado de verdade: excluir = mover para a lixeira.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------
create table public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.admins enable row level security;

create policy admins_ver_proprio on public.admins
  for select to authenticated
  using (user_id = auth.uid());

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Ligas
-- ---------------------------------------------------------------------
create table public.ligas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(btrim(nome)) between 1 and 120),
  data           date not null,
  participantes  smallint not null check (participantes in (16, 20, 24, 28, 32)),
  status         text not null default 'preparacao'
                 check (status in ('preparacao', 'andamento', 'finalizada', 'arquivada')),
  etapa          text not null default 'cadastro'
                 check (etapa in ('cadastro', 'sorteio', 'grupos', 'mata_mata', 'encerrada')),
  dados          jsonb not null,
  versao         integer not null default 1,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  excluida_em    timestamptz,
  constraint ligas_dados_validos check (
    jsonb_typeof(dados) = 'object'
    and case when jsonb_typeof(dados -> 'names') = 'array'
             then jsonb_array_length(dados -> 'names') = participantes
             else false end
    and octet_length(dados::text) <= 1000000
  )
);

create index ligas_lista_idx on public.ligas (excluida_em, data desc);

alter table public.ligas enable row level security;

create policy ligas_admin_ler on public.ligas
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Versões (cópia completa a cada gravação) e eventos (histórico legível)
-- ---------------------------------------------------------------------
create table public.ligas_versoes (
  id            bigint generated always as identity primary key,
  liga_id       uuid not null references public.ligas (id),
  versao        integer not null,
  nome          text not null,
  data          date not null,
  participantes smallint not null,
  status        text not null,
  etapa         text not null,
  dados         jsonb not null,
  excluida      boolean not null default false,
  motivo        text not null,
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  unique (liga_id, versao)
);

alter table public.ligas_versoes enable row level security;

create policy ligas_versoes_admin_ler on public.ligas_versoes
  for select to authenticated
  using (public.is_admin());

create table public.ligas_eventos (
  id         bigint generated always as identity primary key,
  liga_id    uuid not null references public.ligas (id),
  versao     integer not null,
  tipo       text not null check (char_length(tipo) between 1 and 40),
  descricao  text not null check (char_length(descricao) <= 500),
  detalhes   jsonb,
  criado_em  timestamptz not null default now(),
  criado_por uuid
);

create index ligas_eventos_liga_idx on public.ligas_eventos (liga_id, id desc);

alter table public.ligas_eventos enable row level security;

create policy ligas_eventos_admin_ler on public.ligas_eventos
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Gatilhos de proteção
-- ---------------------------------------------------------------------

-- Antes de criar: carimbos e versão inicial.
create function public._ligas_antes_de_criar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.versao := 1;
  new.criado_em := now();
  new.criado_por := auth.uid();
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger ligas_antes_de_criar
  before insert on public.ligas
  for each row execute function public._ligas_antes_de_criar();

-- Antes de alterar: versão sempre +1, autoria preservada e
-- quantidade de atletas travada depois que a liga sai da preparação.
create function public._ligas_antes_de_alterar()
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
  new.criado_em := old.criado_em;
  new.criado_por := old.criado_por;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger ligas_antes_de_alterar
  before update on public.ligas
  for each row execute function public._ligas_antes_de_alterar();

-- Ligas nunca são apagadas fisicamente (usa-se a lixeira).
create function public._bloquear_exclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'operacao_bloqueada: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger ligas_sem_exclusao
  before delete on public.ligas
  for each row execute function public._bloquear_exclusao();

-- Depois de criar/alterar: cópia completa em ligas_versoes.
create function public._ligas_gravar_versao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ligas_versoes
    (liga_id, versao, nome, data, participantes, status, etapa, dados, excluida, motivo, criado_por)
  values
    (new.id, new.versao, new.nome, new.data, new.participantes, new.status, new.etapa,
     new.dados, new.excluida_em is not null,
     coalesce(nullif(btrim(current_setting('liga_resenha.motivo', true)), ''),
              case when tg_op = 'INSERT' then 'Criação' else 'Alteração' end),
     auth.uid());
  return null;
end;
$$;

create trigger ligas_gravar_versao
  after insert or update on public.ligas
  for each row execute function public._ligas_gravar_versao();

-- Versões e eventos são imutáveis.
create trigger ligas_versoes_imutaveis
  before update or delete on public.ligas_versoes
  for each row execute function public._bloquear_exclusao();

create trigger ligas_eventos_imutaveis
  before update or delete on public.ligas_eventos
  for each row execute function public._bloquear_exclusao();

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app (RPC)
-- ---------------------------------------------------------------------

create function public._liga_resumo(v public.ligas)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'id', v.id,
    'versao', v.versao,
    'status', v.status,
    'etapa', v.etapa,
    'participantes', v.participantes,
    'atualizado_em', v.atualizado_em,
    'excluida', v.excluida_em is not null
  );
$$;

create function public._exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
end;
$$;

create function public._registrar_eventos(p_liga uuid, p_versao integer, p_eventos jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_eventos is null then
    return;
  end if;
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 100 then
    raise exception 'eventos_invalidos' using errcode = '22023';
  end if;
  insert into public.ligas_eventos (liga_id, versao, tipo, descricao, detalhes, criado_por)
  select p_liga, p_versao,
         left(coalesce(nullif(btrim(e ->> 'tipo'), ''), 'alteracao'), 40),
         left(coalesce(e ->> 'descricao', ''), 500),
         e -> 'detalhes',
         auth.uid()
  from jsonb_array_elements(p_eventos) as e;
end;
$$;

-- Criar liga. p_id opcional (gerado no aparelho) torna a chamada
-- repetível: se a liga já existir, devolve a existente sem duplicar.
create function public.criar_liga(
  p_id     uuid,
  p_nome   text,
  p_data   date,
  p_dados  jsonb,
  p_status text default 'preparacao',
  p_etapa  text default 'cadastro',
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_admin();

  if p_id is not null then
    select * into v from public.ligas where id = p_id;
    if found then
      return public._liga_resumo(v) || jsonb_build_object('ja_existia', true);
    end if;
  end if;

  perform set_config('liga_resenha.motivo', coalesce(nullif(btrim(p_motivo), ''), 'Criação da liga'), true);

  insert into public.ligas (id, nome, data, participantes, status, etapa, dados)
  values (
    coalesce(p_id, gen_random_uuid()),
    btrim(p_nome),
    p_data,
    case when jsonb_typeof(p_dados -> 'names') = 'array'
         then jsonb_array_length(p_dados -> 'names') end,
    coalesce(p_status, 'preparacao'),
    coalesce(p_etapa, 'cadastro'),
    p_dados
  )
  returning * into v;

  perform public._registrar_eventos(v.id, v.versao, jsonb_build_array(jsonb_build_object(
    'tipo', 'criada',
    'descricao', coalesce(nullif(btrim(p_motivo), ''), 'Liga criada'))));

  return public._liga_resumo(v);
end;
$$;

-- Salvar liga com controle de versão.
-- Se outro aparelho salvou antes, NÃO grava e devolve conflito.
-- Liga finalizada só tem dados alterados com motivo (correção administrativa).
create function public.salvar_liga(
  p_id              uuid,
  p_versao_esperada integer,
  p_dados           jsonb default null,
  p_nome            text default null,
  p_data            date default null,
  p_status          text default null,
  p_etapa           text default null,
  p_eventos         jsonb default '[]'::jsonb,
  p_motivo          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public._exigir_admin();

  select * into v from public.ligas where id = p_id for update;
  if not found then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;

  if v.versao <> p_versao_esperada then
    return jsonb_build_object(
      'ok', false,
      'conflito', true,
      'versao_servidor', v.versao,
      'atualizado_em', v.atualizado_em
    );
  end if;

  if v.excluida_em is not null then
    raise exception 'liga_na_lixeira' using errcode = 'P0001';
  end if;

  if v.status = 'finalizada' and p_dados is not null and p_dados is distinct from v.dados
     and v_motivo is null then
    raise exception 'motivo_obrigatorio: liga finalizada exige motivo para correção'
      using errcode = 'P0001';
  end if;

  perform set_config('liga_resenha.motivo', coalesce(v_motivo, 'Alteração'), true);

  update public.ligas set
    dados         = coalesce(p_dados, dados),
    nome          = coalesce(btrim(p_nome), nome),
    data          = coalesce(p_data, data),
    status        = coalesce(p_status, status),
    etapa         = coalesce(p_etapa, etapa),
    participantes = case when p_dados is not null and jsonb_typeof(p_dados -> 'names') = 'array'
                         then jsonb_array_length(p_dados -> 'names') else participantes end,
    versao        = versao + 1
  where id = p_id
  returning * into v;

  perform public._registrar_eventos(v.id, v.versao, p_eventos);
  if v_motivo is not null then
    perform public._registrar_eventos(v.id, v.versao,
      jsonb_build_array(jsonb_build_object('tipo', 'correcao', 'descricao', v_motivo)));
  end if;

  return public._liga_resumo(v);
end;
$$;

-- Restaurar uma versão anterior: cria uma NOVA versão com o conteúdo antigo.
create function public.restaurar_versao(
  p_id              uuid,
  p_versao          integer,
  p_versao_esperada integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v  public.ligas;
  s  public.ligas_versoes;
begin
  perform public._exigir_admin();

  select * into v from public.ligas where id = p_id for update;
  if not found then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if v.versao <> p_versao_esperada then
    return jsonb_build_object('ok', false, 'conflito', true,
      'versao_servidor', v.versao, 'atualizado_em', v.atualizado_em);
  end if;
  if v.excluida_em is not null then
    raise exception 'liga_na_lixeira' using errcode = 'P0001';
  end if;

  select * into s from public.ligas_versoes where liga_id = p_id and versao = p_versao;
  if not found then
    raise exception 'versao_nao_encontrada' using errcode = 'P0002';
  end if;

  perform set_config('liga_resenha.motivo', 'Restaurada a partir da versão ' || p_versao, true);

  update public.ligas set
    nome = s.nome, data = s.data, participantes = s.participantes,
    status = s.status, etapa = s.etapa, dados = s.dados,
    versao = versao + 1
  where id = p_id
  returning * into v;

  perform public._registrar_eventos(v.id, v.versao, jsonb_build_array(jsonb_build_object(
    'tipo', 'restauracao',
    'descricao', 'Restaurada a partir da versão ' || p_versao)));

  return public._liga_resumo(v);
end;
$$;

-- Lixeira: mover e restaurar (nunca apaga).
create function public.mover_para_lixeira(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_admin();
  perform set_config('liga_resenha.motivo', 'Movida para a lixeira', true);
  update public.ligas set excluida_em = now(), versao = versao + 1
  where id = p_id and excluida_em is null
  returning * into v;
  if not found then
    raise exception 'liga_nao_encontrada_ou_ja_na_lixeira' using errcode = 'P0002';
  end if;
  perform public._registrar_eventos(v.id, v.versao, '[{"tipo":"lixeira","descricao":"Movida para a lixeira"}]'::jsonb);
  return public._liga_resumo(v);
end;
$$;

create function public.retirar_da_lixeira(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_admin();
  perform set_config('liga_resenha.motivo', 'Retirada da lixeira', true);
  update public.ligas set excluida_em = null, versao = versao + 1
  where id = p_id and excluida_em is not null
  returning * into v;
  if not found then
    raise exception 'liga_nao_esta_na_lixeira' using errcode = 'P0002';
  end if;
  perform public._registrar_eventos(v.id, v.versao, '[{"tipo":"restauracao","descricao":"Retirada da lixeira"}]'::jsonb);
  return public._liga_resumo(v);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões: leitura só via RLS (admin); escrita só pelas funções.
-- (O Supabase concede tudo a anon/authenticated por padrão; revogamos.)
-- ---------------------------------------------------------------------
revoke all on public.admins, public.ligas, public.ligas_versoes, public.ligas_eventos
  from public, anon, authenticated;
grant select on public.admins, public.ligas, public.ligas_versoes, public.ligas_eventos
  to authenticated;

revoke all on function
  public.is_admin(),
  public._ligas_antes_de_criar(),
  public._ligas_antes_de_alterar(),
  public._bloquear_exclusao(),
  public._ligas_gravar_versao(),
  public._liga_resumo(public.ligas),
  public._exigir_admin(),
  public._registrar_eventos(uuid, integer, jsonb),
  public.criar_liga(uuid, text, date, jsonb, text, text, text),
  public.salvar_liga(uuid, integer, jsonb, text, date, text, text, jsonb, text),
  public.restaurar_versao(uuid, integer, integer),
  public.mover_para_lixeira(uuid),
  public.retirar_da_lixeira(uuid)
from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.criar_liga(uuid, text, date, jsonb, text, text, text),
  public.salvar_liga(uuid, integer, jsonb, text, date, text, text, jsonb, text),
  public.restaurar_versao(uuid, integer, integer),
  public.mover_para_lixeira(uuid),
  public.retirar_da_lixeira(uuid)
to authenticated;
