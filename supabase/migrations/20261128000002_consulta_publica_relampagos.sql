-- =====================================================================
-- Liga Resenha V6 — página de consulta: ligas relâmpago e datas previstas
-- Atualiza consulta_publica() (só leitura, sem login) para devolver também:
--  - as ligas relâmpago criadas (fora de temporada), exceto arquivadas e
--    as que estão na lixeira — até 30, da mais recente para a mais antiga;
--  - as datas previstas das próximas etapas da temporada pública
--    (guardadas em temporadas.dados->'datas', ex.: {"3": "2027-02-10"}).
-- Sem temporada pública, devolve temporada nula e as relâmpago mesmo assim.
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
  t public.temporadas;
  v_temporada jsonb := null;
  v_etapas jsonb := '[]'::jsonb;
  v_ajustes jsonb := '[]'::jsonb;
  v_datas jsonb := '{}'::jsonb;
  v_ids uuid[] := '{}';
  v_relampagos jsonb;
begin
  select * into t from public.temporadas
   where publica and status <> 'arquivada'
   order by inicio desc nulls last, criado_em desc
   limit 1;

  if found then
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

    -- datas previstas: só número da etapa -> data (AAAA-MM-DD)
    select coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
      into v_datas
      from jsonb_each(case when jsonb_typeof(t.dados->'datas') = 'object' then t.dados->'datas' else '{}'::jsonb end) d
     where d.key ~ '^[0-9]{1,3}$' and jsonb_typeof(d.value) = 'string'
       and (d.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

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

    v_temporada := jsonb_build_object('id', t.id, 'nome', t.nome, 'inicio', t.inicio, 'status', t.status,
                                      'regras', t.regras, 'dados', jsonb_build_object('ajustes', v_ajustes, 'datas', v_datas));
  end if;

  -- ligas relâmpago: criadas, fora de temporada, nem arquivadas nem na lixeira
  select coalesce(jsonb_agg(r.obj order by r.data desc, r.atualizado_em desc), '[]'::jsonb)
    into v_relampagos
    from (
      select l.data, l.atualizado_em, jsonb_build_object(
               'id', l.id, 'nome', l.nome, 'data', l.data, 'status', l.status, 'etapa', l.etapa,
               'etapa_numero', null, 'participantes', l.participantes, 'versao', l.versao,
               'atualizado_em', l.atualizado_em, 'excluida_em', null, 'dados', l.dados) as obj
        from public.ligas l
       where l.temporada_id is null and l.excluida_em is null and l.status <> 'arquivada'
       order by l.data desc, l.atualizado_em desc
       limit 30
    ) r;

  return jsonb_build_object(
    'temporada', v_temporada,
    'etapas', v_etapas,
    'atletas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'situacao', a.situacao) order by a.nome)
                           from public.atletas a where a.id = any(v_ids)), '[]'::jsonb),
    'relampagos', v_relampagos);
end;
$$;

revoke all on function public.consulta_publica() from public, anon, authenticated;
grant execute on function public.consulta_publica() to anon, authenticated;
