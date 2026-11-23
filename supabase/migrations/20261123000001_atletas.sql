-- =====================================================================
-- Liga Resenha V6 — cadastro único de atletas
-- Nada é apagado: atleta que sai fica "inativo". Toda alteração gera
-- uma cópia em atletas_historico (imutável). Escrita só pelas funções.
-- =====================================================================

create table public.atletas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(btrim(nome)) between 1 and 80),
  apelido        text check (apelido is null or char_length(apelido) <= 40),
  situacao       text not null default 'membro'
                 check (situacao in ('membro', 'convidado', 'inativo')),
  observacoes    text check (observacoes is null or char_length(observacoes) <= 500),
  versao         integer not null default 1,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

-- Mesmo nome não pode ser cadastrado duas vezes (ignora maiúsculas e espaços extras)
create unique index atletas_nome_unico on public.atletas (lower(btrim(nome)));

alter table public.atletas enable row level security;

create policy atletas_admin_ler on public.atletas
  for select to authenticated
  using (public.is_admin());

create table public.atletas_historico (
  id         bigint generated always as identity primary key,
  atleta_id  uuid not null references public.atletas (id),
  versao     integer not null,
  dados      jsonb not null,
  criado_em  timestamptz not null default now(),
  criado_por uuid,
  unique (atleta_id, versao)
);

alter table public.atletas_historico enable row level security;

create policy atletas_historico_admin_ler on public.atletas_historico
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Gatilhos (mesma proteção das ligas)
-- ---------------------------------------------------------------------
create function public._atletas_antes_de_criar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  new.apelido := nullif(btrim(new.apelido), '');
  new.observacoes := nullif(btrim(new.observacoes), '');
  new.versao := 1;
  new.criado_em := now();
  new.criado_por := auth.uid();
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger atletas_antes_de_criar
  before insert on public.atletas
  for each row execute function public._atletas_antes_de_criar();

create function public._atletas_antes_de_alterar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.versao <> old.versao + 1 then
    raise exception 'versao_invalida: esperado %, recebido %', old.versao + 1, new.versao
      using errcode = 'P0001';
  end if;
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  new.apelido := nullif(btrim(new.apelido), '');
  new.observacoes := nullif(btrim(new.observacoes), '');
  new.id := old.id;
  new.criado_em := old.criado_em;
  new.criado_por := old.criado_por;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger atletas_antes_de_alterar
  before update on public.atletas
  for each row execute function public._atletas_antes_de_alterar();

create trigger atletas_sem_exclusao
  before delete on public.atletas
  for each row execute function public._bloquear_exclusao();

create function public._atletas_gravar_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.atletas_historico (atleta_id, versao, dados, criado_por)
  values (new.id, new.versao, to_jsonb(new), auth.uid());
  return null;
end;
$$;

create trigger atletas_gravar_historico
  after insert or update on public.atletas
  for each row execute function public._atletas_gravar_historico();

create trigger atletas_historico_imutavel
  before update or delete on public.atletas_historico
  for each row execute function public._bloquear_exclusao();

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app
-- ---------------------------------------------------------------------

-- Criar (p_id novo ou nulo) ou alterar (p_id existente, com versão) um atleta.
create function public.salvar_atleta(
  p_id              uuid,
  p_versao_esperada integer,
  p_nome            text,
  p_apelido         text default null,
  p_situacao        text default 'membro',
  p_observacoes     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.atletas;
begin
  perform public._exigir_admin();

  if p_id is not null then
    select * into v from public.atletas where id = p_id for update;
  end if;

  begin
    if v.id is null then
      insert into public.atletas (id, nome, apelido, situacao, observacoes)
      values (coalesce(p_id, gen_random_uuid()), p_nome, p_apelido, coalesce(p_situacao, 'membro'), p_observacoes)
      returning * into v;
    else
      if v.versao <> p_versao_esperada then
        return jsonb_build_object('ok', false, 'conflito', true, 'versao_servidor', v.versao);
      end if;
      update public.atletas set
        nome = p_nome, apelido = p_apelido, situacao = coalesce(p_situacao, situacao),
        observacoes = p_observacoes, versao = versao + 1
      where id = p_id
      returning * into v;
    end if;
  exception when unique_violation then
    raise exception 'atleta_ja_existe: já existe um atleta com o nome "%"', btrim(p_nome)
      using errcode = 'P0001';
  end;

  return jsonb_build_object('ok', true) || to_jsonb(v);
end;
$$;

-- Recebe uma lista de nomes e devolve os atletas correspondentes, na mesma
-- ordem, criando os que ainda não existem. Usado ao colar listas e ao
-- vincular ligas antigas ao cadastro.
create function public.garantir_atletas(p_nomes text[], p_situacao text default 'membro')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n text;
  v public.atletas;
  saida jsonb := '[]'::jsonb;
begin
  perform public._exigir_admin();
  if p_nomes is null or array_length(p_nomes, 1) > 64 then
    raise exception 'lista_invalida' using errcode = '22023';
  end if;
  foreach n in array p_nomes loop
    n := btrim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g'));
    if n = '' then
      saida := saida || jsonb_build_array(null);
      continue;
    end if;
    select * into v from public.atletas where lower(btrim(nome)) = lower(n);
    if not found then
      insert into public.atletas (nome, situacao) values (n, coalesce(p_situacao, 'membro'))
      returning * into v;
    end if;
    saida := saida || jsonb_build_array(to_jsonb(v));
  end loop;
  return saida;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on public.atletas, public.atletas_historico from public, anon, authenticated;
grant select on public.atletas, public.atletas_historico to authenticated;

revoke all on function
  public._atletas_antes_de_criar(),
  public._atletas_antes_de_alterar(),
  public._atletas_gravar_historico(),
  public.salvar_atleta(uuid, integer, text, text, text, text),
  public.garantir_atletas(text[], text)
from public, anon, authenticated;

grant execute on function
  public.salvar_atleta(uuid, integer, text, text, text, text),
  public.garantir_atletas(text[], text)
to authenticated;
