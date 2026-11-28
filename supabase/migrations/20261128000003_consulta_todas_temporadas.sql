-- =====================================================================
-- Liga Resenha V6 — página de consulta com todas as temporadas
-- consulta_publica() (só leitura) passa a devolver:
--  - temporadas: todas em andamento e encerradas (arquivadas não aparecem);
--    o campo "publica" deixa de ser usado pela página;
--  - etapas dessas temporadas (com temporada_id), exceto as da lixeira;
--  - atletas que aparecem nessas temporadas (só id, nome e situação);
--  - relampagos: ligas fora de temporada, criadas, sem arquivadas e lixeira (até 30).
-- Não altera tabelas nem dados.
-- =====================================================================

create or replace function public.consulta_publica()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_temporadas jsonb;
  v_etapas jsonb;
  v_relampagos jsonb;
  v_ids uuid[];
begin
  -- temporadas visíveis, com ajustes (só o que entra no ranking) e datas previstas válidas
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'nome', t.nome, 'inicio', t.inicio, 'status', t.status, 'regras', t.regras,
           'dados', jsonb_build_object(
             'ajustes', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', a->>'id', 'atleta_id', a->>'atleta_id', 'etapa', a->'etapa',
                            'pontos', a->'pontos', 'motivo', a->>'motivo')), '[]'::jsonb)
                           from jsonb_array_elements(case when jsonb_typeof(t.dados->'ajustes') = 'array'
                                                          then t.dados->'ajustes' else '[]'::jsonb end) a),
             'datas', (select coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
                         from jsonb_each(case when jsonb_typeof(t.dados->'datas') = 'object' then t.dados->'datas' else '{}'::jsonb end) d
                        where d.key ~ '^[0-9]{1,3}$' and jsonb_typeof(d.value) = 'string'
                          and (d.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
         order by t.inicio desc nulls last, t.criado_em desc), '[]'::jsonb)
    into v_temporadas
    from public.temporadas t
   where t.status in ('andamento', 'encerrada');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'nome', l.nome, 'data', l.data, 'status', l.status, 'etapa', l.etapa,
           'temporada_id', l.temporada_id, 'etapa_numero', l.etapa_numero, 'participantes', l.participantes,
           'versao', l.versao, 'atualizado_em', l.atualizado_em, 'excluida_em', null, 'dados', l.dados)
         order by l.etapa_numero), '[]'::jsonb)
    into v_etapas
    from public.ligas l
    join public.temporadas t on t.id = l.temporada_id
   where t.status in ('andamento', 'encerrada') and l.excluida_em is null;

  -- atletas das temporadas visíveis (vínculo das etapas, substitutos e ajustes)
  select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
    select (i #>> '{}')::uuid as id
      from jsonb_array_elements(v_etapas) e,
           jsonb_array_elements(case when jsonb_typeof(e->'dados'->'ids') = 'array' then e->'dados'->'ids' else '[]'::jsonb end) i
     where jsonb_typeof(i) = 'string' and (i #>> '{}') ~* '^[0-9a-f-]{36}$'
    union
    select (s->'atleta'->>'id')::uuid
      from jsonb_array_elements(v_etapas) e,
           jsonb_array_elements(coalesce(case when jsonb_typeof(e->'dados'->'subs') = 'array' then e->'dados'->'subs' end, '[]'::jsonb)
                             || coalesce(case when jsonb_typeof(e->'dados'->'gsubs') = 'array' then e->'dados'->'gsubs' end, '[]'::jsonb)) s
     where (s->'atleta'->>'id') ~* '^[0-9a-f-]{36}$'
    union
    select (a->>'atleta_id')::uuid
      from jsonb_array_elements(v_temporadas) t, jsonb_array_elements(t->'dados'->'ajustes') a
     where (a->>'atleta_id') ~* '^[0-9a-f-]{36}$'
  ) x;

  select coalesce(jsonb_agg(r.obj order by r.data desc, r.atualizado_em desc), '[]'::jsonb)
    into v_relampagos
    from (
      select l.data, l.atualizado_em, jsonb_build_object(
               'id', l.id, 'nome', l.nome, 'data', l.data, 'status', l.status, 'etapa', l.etapa,
               'temporada_id', null, 'etapa_numero', null, 'participantes', l.participantes, 'versao', l.versao,
               'atualizado_em', l.atualizado_em, 'excluida_em', null, 'dados', l.dados) as obj
        from public.ligas l
       where l.temporada_id is null and l.excluida_em is null and l.status <> 'arquivada'
       order by l.data desc, l.atualizado_em desc
       limit 30
    ) r;

  return jsonb_build_object(
    'temporadas', v_temporadas,
    'etapas', v_etapas,
    'atletas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'situacao', a.situacao) order by a.nome)
                           from public.atletas a where a.id = any(v_ids)), '[]'::jsonb),
    'relampagos', v_relampagos);
end;
$$;

revoke all on function public.consulta_publica() from public, anon, authenticated;
grant execute on function public.consulta_publica() to anon, authenticated;
