-- =====================================================================
-- Liga Resenha V6 — Finanças: rodada de liga apagada
-- Quando uma liga é apagada de vez, a cobrança da rodada no Finanças
-- some junto, desde que não tenha dinheiro ligado a ela: nenhuma
-- inscrição paga, nenhum lançamento ativo e nenhum prêmio. Se tiver,
-- continua (marcada como "liga apagada") para o caixa não mudar.
-- Também limpa as rodadas que já ficaram assim.
-- =====================================================================

create function public._fin_rodada_sem_dinheiro(p_liga_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.fin_inscricoes where liga_id = p_liga_id and status = 'pago')
     and not exists (select 1 from public.fin_lancamentos where liga_id = p_liga_id and excluido_em is null)
     and not exists (select 1 from public.fin_premios where liga_id = p_liga_id);
$$;

create function public._fin_liga_apagada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public._fin_rodada_sem_dinheiro(old.id) then
    delete from public.fin_rodadas where liga_id = old.id; -- as inscrições isentas vão junto (cascade)
  end if;
  return null;
end;
$$;

create trigger fin_liga_apagada after delete on public.ligas
  for each row execute function public._fin_liga_apagada();

-- rodadas que já ficaram sem liga e sem dinheiro
delete from public.fin_rodadas r
 where not exists (select 1 from public.ligas l where l.id = r.liga_id)
   and public._fin_rodada_sem_dinheiro(r.liga_id);

revoke all on function public._fin_rodada_sem_dinheiro(uuid), public._fin_liga_apagada() from public, anon, authenticated;
