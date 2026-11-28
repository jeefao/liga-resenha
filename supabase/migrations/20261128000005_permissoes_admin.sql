-- =====================================================================
-- Liga Resenha V6 — permissões dos administradores
-- O dono tem acesso a tudo e é o único que mexe na aba Usuários
-- (aprovar, bloquear, trocar senha, excluir conta, tornar administrador).
-- Os outros administradores só gravam nas áreas marcadas pelo dono:
--   ligas             ligas e etapas, inscrições, sorteio, placares, lixeira
--   temporadas        temporadas, regras, datas previstas, ajustes de pontos
--   atletas           cadastro de atletas
--   financeiro_ver    ver o financeiro (página futura)
--   financeiro_lancar lançar no financeiro (página futura)
-- Apagar de vez (lixeira, temporada, atleta) é só do dono.
-- Todo administrador continua lendo as ligas, temporadas e atletas.
-- Os administradores que já existem viram donos.
-- =====================================================================

alter table public.admins
  add column dono boolean not null default false,
  add column permissoes text[] not null default '{}',
  add column atualizado_em timestamptz not null default now(),
  add constraint admins_permissoes_validas
    check (permissoes <@ array['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar']::text[]);

update public.admins set dono = true;

create function public.eh_dono()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid() and a.dono);
$$;

-- verdadeiro se for o dono ou tiver alguma das permissões pedidas
create function public.tem_permissao(variadic p_areas text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a
                  where a.user_id = auth.uid() and (a.dono or a.permissoes && p_areas));
$$;

create function public._exigir_permissao(variadic p_areas text[])
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
  if not public.tem_permissao(variadic p_areas) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
end;
$$;

create function public._exigir_dono()
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
  if not public.eh_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Acessos: meu_acesso informa dono e permissões; aba Usuários só do dono
-- ---------------------------------------------------------------------
create or replace function public.meu_acesso()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.acessos;
  ad public.admins;
  v_nome text;
begin
  if auth.uid() is null then
    return jsonb_build_object('logado', false);
  end if;
  select * into ad from public.admins where user_id = auth.uid();
  if found then
    select t.nome into v_nome from public.acessos x join public.atletas t on t.id = x.atleta_id where x.user_id = auth.uid();
    update public.acessos set ultimo_acesso = now() where user_id = auth.uid();
    return jsonb_build_object('logado', true, 'admin', true, 'status', 'aprovado', 'dono', ad.dono,
                              'permissoes', case when ad.dono
                                then to_jsonb(array['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar'])
                                else to_jsonb(ad.permissoes) end)
           || case when v_nome is null then '{}'::jsonb else jsonb_build_object('nome', v_nome) end;
  end if;
  select * into a from public.acessos where user_id = auth.uid();
  if not found then
    return jsonb_build_object('logado', true, 'admin', false, 'status', null);
  end if;
  if a.status = 'aprovado' then
    update public.acessos set ultimo_acesso = now() where user_id = a.user_id;
  end if;
  select nome into v_nome from public.atletas where id = a.atleta_id;
  return jsonb_build_object('logado', true, 'admin', false, 'status', a.status,
                            'nome', coalesce(v_nome, a.nome_informado));
end;
$$;

create or replace function public.listar_acessos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._exigir_dono();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', a.user_id, 'email', a.email, 'nome_informado', a.nome_informado,
             'atleta_id', a.atleta_id, 'atleta_nome', t.nome, 'status', a.status,
             'criado_em', a.criado_em, 'atualizado_em', a.atualizado_em,
             'ultimo_acesso', greatest(a.ultimo_acesso, u.last_sign_in_at),
             'admin', ad.user_id is not null, 'dono', coalesce(ad.dono, false),
             'permissoes', coalesce(to_jsonb(ad.permissoes), '[]'::jsonb))
           order by (a.status = 'pendente') desc, (ad.user_id is not null) desc, a.criado_em desc)
      from public.acessos a
      left join public.atletas t on t.id = a.atleta_id
      left join public.admins ad on ad.user_id = a.user_id
      left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;

-- Aprovar / recusar / bloquear. Quem deixa de estar aprovado perde também o papel de administrador.
create or replace function public.definir_acesso(p_user_id uuid, p_status text, p_atleta_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acessos;
begin
  perform public._exigir_dono();
  if p_status not in ('pendente', 'aprovado', 'bloqueado', 'recusado') then raise exception 'status_invalido'; end if;
  if exists (select 1 from public.admins where user_id = p_user_id and dono) then raise exception 'conta_de_administrador'; end if;
  select * into a from public.acessos where user_id = p_user_id for update;
  if not found then raise exception 'acesso_nao_encontrado'; end if;
  if p_atleta_id is not null and not exists (select 1 from public.atletas where id = p_atleta_id) then
    raise exception 'atleta_nao_encontrado';
  end if;
  if p_status = 'aprovado' and coalesce(p_atleta_id, a.atleta_id) is null then
    raise exception 'escolha_o_atleta';
  end if;
  update public.acessos
     set status = p_status, atleta_id = coalesce(p_atleta_id, atleta_id),
         atualizado_em = now(), atualizado_por = auth.uid()
   where user_id = p_user_id;
  if p_status <> 'aprovado' then
    delete from public.admins where user_id = p_user_id and not dono;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.trocar_senha_acesso(p_user_id uuid, p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_dono();
  if char_length(coalesce(p_senha, '')) < 6 then raise exception 'senha_curta'; end if;
  if exists (select 1 from public.admins where user_id = p_user_id and dono) then raise exception 'conta_de_administrador'; end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id) then raise exception 'acesso_nao_encontrado'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  update public.acessos set atualizado_em = now(), atualizado_por = auth.uid() where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.excluir_acesso(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._exigir_dono();
  if exists (select 1 from public.admins where user_id = p_user_id and dono) then raise exception 'conta_de_administrador'; end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id) then raise exception 'acesso_nao_encontrado'; end if;
  delete from auth.users where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Tornar administrador (com as permissões marcadas) ou voltar a ser só atleta. Só o dono.
create function public.definir_admin(p_user_id uuid, p_admin boolean, p_permissoes text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perm text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_permissoes, '{}')) x), '{}');
begin
  perform public._exigir_dono();
  if exists (select 1 from public.admins where user_id = p_user_id and dono) then raise exception 'conta_de_administrador'; end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id) then raise exception 'acesso_nao_encontrado'; end if;
  if not p_admin then
    delete from public.admins where user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id and status = 'aprovado') then
    raise exception 'aprove_antes';
  end if;
  if not (v_perm <@ array['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar']::text[]) then
    raise exception 'permissao_invalida';
  end if;
  insert into public.admins (user_id, permissoes) values (p_user_id, v_perm)
  on conflict (user_id) do update set permissoes = excluded.permissoes, atualizado_em = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Funções de gravação: cada uma confere a permissão da sua área
-- (corpo igual ao das migrations anteriores; só muda a conferência)
-- ---------------------------------------------------------------------
create or replace function public.criar_liga(
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
  perform public._exigir_permissao('ligas');

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

create or replace function public.salvar_liga(
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
  perform public._exigir_permissao('ligas');

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

create or replace function public.restaurar_versao(
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
  perform public._exigir_permissao('ligas');

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

create or replace function public.mover_para_lixeira(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_permissao('ligas');
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

create or replace function public.retirar_da_lixeira(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_permissao('ligas');
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

create or replace function public.criar_etapa(
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
  perform public._exigir_permissao('ligas');
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

create or replace function public.salvar_atleta(
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
  perform public._exigir_permissao('atletas');

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

create or replace function public.garantir_atletas(p_nomes text[], p_situacao text default 'membro')
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
  perform public._exigir_permissao('ligas', 'atletas');
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

create or replace function public.criar_temporada(
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
  perform public._exigir_permissao('temporadas');
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

create or replace function public.salvar_temporada(
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
  perform public._exigir_permissao('temporadas');
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

create or replace function public.excluir_definitivamente(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_dono();
  select * into v from public.ligas where id = p_id for update;
  if not found then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if v.excluida_em is null then
    raise exception 'liga_fora_da_lixeira: só é possível apagar ligas que estão na lixeira'
      using errcode = 'P0001';
  end if;
  perform set_config('liga_resenha.exclusao_definitiva', 'sim', true);
  delete from public.ligas_eventos where liga_id = p_id;
  delete from public.ligas_versoes where liga_id = p_id;
  delete from public.ligas where id = p_id;
  perform set_config('liga_resenha.exclusao_definitiva', '', true);
  insert into public.exclusoes_definitivas (tipo, item_id, nome, detalhes, apagado_por)
  values ('liga', v.id, v.nome,
          jsonb_build_object('data', v.data, 'participantes', v.participantes,
                             'status', v.status, 'versao', v.versao, 'na_lixeira_desde', v.excluida_em),
          auth.uid());
  return jsonb_build_object('ok', true, 'id', v.id, 'nome', v.nome);
end;
$$;

create or replace function public.esvaziar_lixeira()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  perform public._exigir_dono();
  for r in select id from public.ligas where excluida_em is not null loop
    perform public.excluir_definitivamente(r.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'apagadas', n);
end;
$$;

create or replace function public.excluir_atleta(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atletas;
begin
  perform public._exigir_dono();
  select * into a from public.atletas where id = p_id for update;
  if not found then
    raise exception 'atleta_nao_encontrado' using errcode = 'P0002';
  end if;
  if a.situacao <> 'inativo' then
    raise exception 'atleta_ativo: marque o atleta como inativo antes de apagar'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.ligas l
    where jsonb_typeof(l.dados -> 'ids') = 'array'
      and (l.dados -> 'ids') ? p_id::text
  ) or exists (
    select 1 from public.ligas_versoes lv
    where jsonb_typeof(lv.dados -> 'ids') = 'array'
      and (lv.dados -> 'ids') ? p_id::text
  ) then
    raise exception 'atleta_em_uso: este atleta aparece em alguma liga e não pode ser apagado'
      using errcode = 'P0001';
  end if;
  perform set_config('liga_resenha.exclusao_definitiva', 'sim', true);
  delete from public.atletas_historico where atleta_id = p_id;
  delete from public.atletas where id = p_id;
  perform set_config('liga_resenha.exclusao_definitiva', '', true);
  insert into public.exclusoes_definitivas (tipo, item_id, nome, apagado_por)
  values ('atleta', a.id, a.nome, auth.uid());
  return jsonb_build_object('ok', true, 'id', a.id, 'nome', a.nome);
end;
$$;

create or replace function public.excluir_temporada(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.temporadas;
  l record;
  n integer := 0;
begin
  perform public._exigir_dono();
  select * into t from public.temporadas where id = p_id for update;
  if not found then
    raise exception 'temporada_nao_encontrada' using errcode = 'P0002';
  end if;
  if t.status <> 'arquivada' then
    raise exception 'temporada_nao_arquivada: arquive a temporada antes de apagar'
      using errcode = 'P0001';
  end if;
  perform set_config('liga_resenha.exclusao_definitiva', 'sim', true);
  for l in select id, nome, data, etapa_numero from public.ligas where temporada_id = p_id order by etapa_numero loop
    delete from public.ligas_eventos where liga_id = l.id;
    delete from public.ligas_versoes where liga_id = l.id;
    delete from public.ligas where id = l.id;
    insert into public.exclusoes_definitivas (tipo, item_id, nome, detalhes, apagado_por)
    values ('liga', l.id, l.nome,
            jsonb_build_object('data', l.data, 'temporada', t.nome, 'etapa', l.etapa_numero), auth.uid());
    n := n + 1;
  end loop;
  delete from public.temporadas_versoes where temporada_id = p_id;
  delete from public.temporadas where id = p_id;
  perform set_config('liga_resenha.exclusao_definitiva', '', true);
  insert into public.exclusoes_definitivas (tipo, item_id, nome, detalhes, apagado_por)
  values ('temporada', t.id, t.nome,
          jsonb_build_object('inicio', t.inicio, 'versao', t.versao, 'etapas_apagadas', n), auth.uid());
  return jsonb_build_object('ok', true, 'id', t.id, 'nome', t.nome, 'etapas', n);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões das funções novas
-- ---------------------------------------------------------------------
revoke all on function
  public.eh_dono(), public.tem_permissao(text[]), public._exigir_permissao(text[]),
  public._exigir_dono(), public.definir_admin(uuid, boolean, text[])
from public, anon, authenticated;

grant execute on function public.eh_dono(), public.tem_permissao(text[]), public.definir_admin(uuid, boolean, text[])
to authenticated;
