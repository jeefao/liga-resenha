-- =====================================================================
-- Liga Resenha V6 — pedido de nova senha
-- O atleta que esqueceu a senha informa o e-mail e a senha nova no app
-- (sem estar logado). O pedido fica guardado (só a versão embaralhada da
-- senha) e aparece para o dono na aba Usuários; a senha só muda quando o
-- dono aprova. A resposta é sempre a mesma, exista ou não a conta, para
-- não revelar quais e-mails estão cadastrados. Conta do dono não aceita
-- pedido. Cada conta tem no máximo um pedido (o novo substitui o anterior).
-- =====================================================================

create table public.pedidos_senha (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  senha_hash text not null,
  criado_em  timestamptz not null default now()
);
alter table public.pedidos_senha enable row level security;
revoke all on public.pedidos_senha from public, anon, authenticated;

-- chamada sem login (tela "Esqueci a senha")
create function public.pedir_nova_senha(p_email text, p_senha text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if char_length(coalesce(p_senha, '')) < 6 or char_length(p_senha) > 72 then
    raise exception 'senha_curta';
  end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 200 then
    raise exception 'email_invalido';
  end if;
  -- limite contra abuso: no máximo 30 pedidos esperando
  if (select count(*) from public.pedidos_senha) >= 30 then
    raise exception 'muitos_pedidos';
  end if;
  select u.id into v_uid
    from auth.users u join public.acessos a on a.user_id = u.id
   where lower(u.email) = lower(btrim(p_email))
     and not exists (select 1 from public.admins d where d.user_id = u.id and d.dono)
   limit 1;
  if v_uid is not null then
    insert into public.pedidos_senha (user_id, senha_hash)
    values (v_uid, extensions.crypt(p_senha, extensions.gen_salt('bf')))
    on conflict (user_id) do update set senha_hash = excluded.senha_hash, criado_em = now();
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- o dono aprova (a senha nova passa a valer) ou recusa (o pedido é apagado)
create function public.responder_pedido_senha(p_user_id uuid, p_aprovar boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  perform public._exigir_dono();
  delete from public.pedidos_senha where user_id = p_user_id returning senha_hash into v_hash;
  if v_hash is null then raise exception 'pedido_nao_encontrado'; end if;
  if p_aprovar then
    if exists (select 1 from public.admins where user_id = p_user_id and dono) then raise exception 'conta_de_administrador'; end if;
    update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_user_id;
    update public.acessos set atualizado_em = now(), atualizado_por = auth.uid() where user_id = p_user_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- a lista da aba Usuários passa a mostrar quem pediu nova senha
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
             'permissoes', coalesce(to_jsonb(ad.permissoes), '[]'::jsonb),
             'pedido_senha_em', ps.criado_em)
           order by (a.status = 'pendente' or ps.user_id is not null) desc, (ad.user_id is not null) desc, a.criado_em desc)
      from public.acessos a
      left join public.atletas t on t.id = a.atleta_id
      left join public.admins ad on ad.user_id = a.user_id
      left join public.pedidos_senha ps on ps.user_id = a.user_id
      left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;

revoke all on function public.pedir_nova_senha(text, text), public.responder_pedido_senha(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.pedir_nova_senha(text, text) to anon, authenticated;
grant execute on function public.responder_pedido_senha(uuid, boolean) to authenticated;
