-- =====================================================================
-- Liga Resenha V6 — situação do pagamento de cada inscrito da liga
-- Para as tags "Pago" (administração) e "Pagamento confirmado" /
-- "Falta pagamento" (consulta). Devolve só a situação (pago, isento ou
-- pendente) por posição na lista, sem valores. Só administradores e
-- atletas com acesso aprovado; a liga na lixeira só para administradores.
-- =====================================================================

create function public.situacao_pagamentos(p_liga_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_dados jsonb;
begin
  if not v_admin
     and not exists (select 1 from public.acessos where user_id = auth.uid() and status = 'aprovado') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  select dados into v_dados from public.ligas
   where id = p_liga_id and (v_admin or excluida_em is null);
  if v_dados is null or not exists (select 1 from public.fin_rodadas where liga_id = p_liga_id) then
    return jsonb_build_object('cobranca', false, 'inscritos', '[]'::jsonb);
  end if;
  return jsonb_build_object('cobranca', true, 'inscritos', coalesce((
    select jsonb_agg(jsonb_build_object('posicao', i.posicao, 'nome', i.nome,
                                        'status', coalesce(fi.status, 'pendente')) order by i.posicao)
      from public._fin_inscritos(v_dados) i
      left join public.fin_inscricoes fi on fi.liga_id = p_liga_id and fi.chave = i.chave), '[]'::jsonb));
end;
$$;

revoke all on function public.situacao_pagamentos(uuid) from public, anon, authenticated;
grant execute on function public.situacao_pagamentos(uuid) to authenticated;
