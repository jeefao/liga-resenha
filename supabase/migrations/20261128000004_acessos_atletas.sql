-- =====================================================================
-- Liga Resenha V6 — login dos atletas (página de consulta)
-- O atleta cria a conta (e-mail e senha) e informa o nome; o administrador
-- aprova, liga ao atleta do cadastro, bloqueia, troca a senha ou exclui.
-- A consulta passa a exigir login: administrador ou atleta aprovado.
-- A tabela acessos não tem leitura direta: tudo passa pelas funções abaixo.
-- Senhas nunca são lidas nem devolvidas (o Supabase só guarda o hash).
-- =====================================================================

create table public.acessos (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  nome_informado text not null check (char_length(btrim(nome_informado)) between 1 and 80),
  atleta_id      uuid references public.atletas(id) on delete set null,
  status         text not null default 'pendente'
                 check (status in ('pendente', 'aprovado', 'bloqueado', 'recusado')),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  ultimo_acesso  timestamptz
);
alter table public.acessos enable row level security;
revoke all on public.acessos from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Do próprio usuário
-- ---------------------------------------------------------------------
-- Situação de quem está logado: administrador, atleta (e status) ou sem pedido.
create function public.meu_acesso()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.acessos;
  v_nome text;
begin
  if auth.uid() is null then
    return jsonb_build_object('logado', false);
  end if;
  if public.is_admin() then
    return jsonb_build_object('logado', true, 'admin', true, 'status', 'aprovado');
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

-- Pedido de acesso (ou novo pedido depois de recusado). Bloqueado não pode pedir de novo.
create function public.solicitar_acesso(p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  a public.acessos;
begin
  if auth.uid() is null then raise exception 'nao_autenticado'; end if;
  if public.is_admin() then raise exception 'administrador_nao_precisa'; end if;
  if char_length(v_nome) not between 3 and 80 then raise exception 'nome_invalido'; end if;
  select email into v_email from auth.users where id = auth.uid();
  select * into a from public.acessos where user_id = auth.uid();
  if found and a.status in ('aprovado', 'bloqueado') then
    raise exception 'pedido_ja_analisado';
  end if;
  insert into public.acessos (user_id, email, nome_informado, status)
  values (auth.uid(), coalesce(v_email, ''), v_nome, 'pendente')
  on conflict (user_id) do update
    set nome_informado = excluded.nome_informado, status = 'pendente', atualizado_em = now();
  return public.meu_acesso();
end;
$$;

-- ---------------------------------------------------------------------
-- Do administrador
-- ---------------------------------------------------------------------
create function public.listar_acessos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'sem_permissao'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', a.user_id, 'email', a.email, 'nome_informado', a.nome_informado,
             'atleta_id', a.atleta_id, 'atleta_nome', t.nome, 'status', a.status,
             'criado_em', a.criado_em, 'atualizado_em', a.atualizado_em,
             'ultimo_acesso', greatest(a.ultimo_acesso, u.last_sign_in_at))
           order by (a.status = 'pendente') desc, a.criado_em desc)
      from public.acessos a
      left join public.atletas t on t.id = a.atleta_id
      left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;

-- Aprovar (exige atleta do cadastro), recusar, bloquear ou desbloquear; também troca o atleta ligado.
create function public.definir_acesso(p_user_id uuid, p_status text, p_atleta_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acessos;
begin
  if not public.is_admin() then raise exception 'sem_permissao'; end if;
  if p_status not in ('pendente', 'aprovado', 'bloqueado', 'recusado') then raise exception 'status_invalido'; end if;
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
  return jsonb_build_object('ok', true);
end;
$$;

-- Senha provisória definida pelo administrador (mínimo 6 caracteres). Nunca para contas de administrador.
create function public.trocar_senha_acesso(p_user_id uuid, p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'sem_permissao'; end if;
  if char_length(coalesce(p_senha, '')) < 6 then raise exception 'senha_curta'; end if;
  if exists (select 1 from public.admins where user_id = p_user_id) then raise exception 'conta_de_administrador'; end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id) then raise exception 'acesso_nao_encontrado'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  update public.acessos set atualizado_em = now(), atualizado_por = auth.uid() where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Exclui a conta de login (o atleta do cadastro e os resultados continuam). Nunca contas de administrador.
create function public.excluir_acesso(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'sem_permissao'; end if;
  if exists (select 1 from public.admins where user_id = p_user_id) then raise exception 'conta_de_administrador'; end if;
  if not exists (select 1 from public.acessos where user_id = p_user_id) then raise exception 'acesso_nao_encontrado'; end if;
  delete from auth.users where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Consulta: agora só para administrador ou atleta aprovado
-- ---------------------------------------------------------------------
alter function public.consulta_publica() rename to _consulta_dados;
revoke all on function public._consulta_dados() from public, anon, authenticated;

create function public.consulta_publica()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or exists (select 1 from public.acessos where user_id = auth.uid() and status = 'aprovado')) then
    raise exception 'acesso_negado';
  end if;
  return public._consulta_dados();
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function
  public.meu_acesso(), public.solicitar_acesso(text), public.listar_acessos(),
  public.definir_acesso(uuid, text, uuid), public.trocar_senha_acesso(uuid, text),
  public.excluir_acesso(uuid), public.consulta_publica()
from public, anon, authenticated;

grant execute on function
  public.meu_acesso(), public.solicitar_acesso(text), public.listar_acessos(),
  public.definir_acesso(uuid, text, uuid), public.trocar_senha_acesso(uuid, text),
  public.excluir_acesso(uuid), public.consulta_publica()
to authenticated;
