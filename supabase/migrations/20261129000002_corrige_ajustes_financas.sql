-- Liga Resenha V6 — corrige "Salvar" dos Ajustes do Finanças.
-- O Supabase recusa UPDATE sem WHERE ("UPDATE requires a WHERE clause"); a tabela fin_config
-- tem uma linha só (id = true), então o filtro "where id" não muda o resultado.

-- ---------------------------------------------------------------------
create or replace function public.fin_salvar_config(p_saldo_inicial_centavos bigint, p_inscricao_relampago_centavos integer)
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
         atualizado_em = now(), atualizado_por = auth.uid()
   where id;
  return jsonb_build_object('ok', true);
end;
$$;

