-- =====================================================================
-- Liga Resenha V6 — função de "sinal de vida" (keep-alive)
-- Chamada uma vez por dia pelo GitHub Actions para o projeto gratuito do
-- Supabase não ser pausado por falta de uso.
-- NÃO lê nem devolve nenhum dado das ligas.
-- =====================================================================

create function public.keepalive()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'ok ' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI');
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
