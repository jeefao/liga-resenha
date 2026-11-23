-- =====================================================================
-- Liga Resenha V6 — apagar temporada de vez
-- Mesma regra das ligas: só o administrador, só pela função e só depois de
-- arquivar (a temporada arquivada faz o papel da lixeira). Apaga junto as
-- etapas da temporada (com histórico e eventos) e deixa um registro mínimo
-- em exclusoes_definitivas. Apagar direto nas tabelas continua bloqueado.
-- =====================================================================

alter table public.exclusoes_definitivas
  drop constraint exclusoes_definitivas_tipo_check,
  add constraint exclusoes_definitivas_tipo_check check (tipo in ('liga', 'atleta', 'temporada'));

create or replace function public._bloquear_exclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('liga_resenha.exclusao_definitiva', true) = 'sim'
     and tg_table_name in ('ligas', 'ligas_versoes', 'ligas_eventos', 'atletas', 'atletas_historico',
                           'temporadas', 'temporadas_versoes') then
    return old;
  end if;
  raise exception 'operacao_bloqueada: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

create function public.excluir_temporada(p_id uuid)
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
  perform public._exigir_admin();
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

revoke all on function public.excluir_temporada(uuid) from public, anon, authenticated;
grant execute on function public.excluir_temporada(uuid) to authenticated;
