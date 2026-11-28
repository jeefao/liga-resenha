-- =====================================================================
-- Liga Resenha V6 — página pública só de consulta
-- Quem não está logado pode LER a temporada marcada como pública
-- (a mais recente, se houver mais de uma). Nada pode ser gravado por aqui.
-- As tabelas continuam fechadas: a leitura passa só por esta função, que
-- devolve apenas o necessário para a classificação e os jogos.
-- Não devolve: observações, apelido, histórico, quem alterou, etapas
-- excluídas nem atletas que não jogaram a temporada.
-- =====================================================================

create function public.consulta_publica()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.temporadas;
  v_etapas jsonb;
  v_ajustes jsonb;
  v_ids uuid[];
begin
  select * into t from public.temporadas
   where publica and status <> 'arquivada'
   order by inicio desc nulls last, criado_em desc
   limit 1;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'nome', l.nome, 'data', l.data, 'status', l.status, 'etapa', l.etapa,
           'etapa_numero', l.etapa_numero, 'participantes', l.participantes, 'versao', l.versao,
           'atualizado_em', l.atualizado_em, 'excluida_em', null, 'dados', l.dados)
         order by l.etapa_numero), '[]'::jsonb)
    into v_etapas
    from public.ligas l
   where l.temporada_id = t.id and l.excluida_em is null;

  -- ajustes de pontos: só o que entra na conta do ranking
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a->>'id', 'atleta_id', a->>'atleta_id', 'etapa', a->'etapa',
           'pontos', a->'pontos', 'motivo', a->>'motivo')), '[]'::jsonb)
    into v_ajustes
    from jsonb_array_elements(case when jsonb_typeof(t.dados->'ajustes') = 'array'
                                   then t.dados->'ajustes' else '[]'::jsonb end) a;

  -- atletas que aparecem na temporada (vínculo das etapas, substitutos e ajustes)
  select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
    select (i #>> '{}')::uuid as id
      from public.ligas l, jsonb_array_elements(case when jsonb_typeof(l.dados->'ids') = 'array' then l.dados->'ids' else '[]'::jsonb end) i
     where l.temporada_id = t.id and l.excluida_em is null and jsonb_typeof(i) = 'string'
       and (i #>> '{}') ~* '^[0-9a-f-]{36}$'
    union
    select (s->'atleta'->>'id')::uuid
      from public.ligas l,
           jsonb_array_elements(coalesce(case when jsonb_typeof(l.dados->'subs') = 'array' then l.dados->'subs' end, '[]'::jsonb)
                             || coalesce(case when jsonb_typeof(l.dados->'gsubs') = 'array' then l.dados->'gsubs' end, '[]'::jsonb)) s
     where l.temporada_id = t.id and l.excluida_em is null
       and (s->'atleta'->>'id') ~* '^[0-9a-f-]{36}$'
    union
    select (a->>'atleta_id')::uuid from jsonb_array_elements(v_ajustes) a
     where (a->>'atleta_id') ~* '^[0-9a-f-]{36}$'
  ) x;

  return jsonb_build_object(
    'temporada', jsonb_build_object('id', t.id, 'nome', t.nome, 'inicio', t.inicio, 'status', t.status,
                                    'regras', t.regras, 'dados', jsonb_build_object('ajustes', v_ajustes)),
    'etapas', v_etapas,
    'atletas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'situacao', a.situacao) order by a.nome)
                           from public.atletas a where a.id = any(v_ids)), '[]'::jsonb));
end;
$$;

revoke all on function public.consulta_publica() from public, anon, authenticated;
grant execute on function public.consulta_publica() to anon, authenticated;
