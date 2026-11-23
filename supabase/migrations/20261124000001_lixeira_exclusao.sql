-- =====================================================================
-- Liga Resenha V6 — exclusão definitiva (somente da lixeira)
-- Continua proibido apagar direto nas tabelas. A única forma de apagar é
-- pelas funções abaixo, só para administrador e só para ligas que já
-- estão na lixeira (ou atletas inativos que não estão em nenhuma liga).
-- Fica um registro mínimo de cada exclusão em exclusoes_definitivas.
-- =====================================================================

-- Registro do que foi apagado (sem os dados, só para referência)
create table public.exclusoes_definitivas (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('liga', 'atleta')),
  item_id     uuid not null,
  nome        text not null,
  detalhes    jsonb not null default '{}'::jsonb,
  apagado_em  timestamptz not null default now(),
  apagado_por uuid
);

alter table public.exclusoes_definitivas enable row level security;

create policy exclusoes_admin_ler on public.exclusoes_definitivas
  for select to authenticated
  using (public.is_admin());

-- O bloqueio passa a aceitar DELETE apenas quando uma das funções de
-- exclusão definitiva ligou a chave (válida só dentro da transação).
create or replace function public._bloquear_exclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('liga_resenha.exclusao_definitiva', true) = 'sim'
     and tg_table_name in ('ligas', 'ligas_versoes', 'ligas_eventos', 'atletas', 'atletas_historico') then
    return old;
  end if;
  raise exception 'operacao_bloqueada: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger exclusoes_imutaveis
  before update or delete on public.exclusoes_definitivas
  for each row execute function public._bloquear_exclusao();

-- Apaga de vez uma liga que está na lixeira (com histórico e eventos)
create function public.excluir_definitivamente(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ligas;
begin
  perform public._exigir_admin();
  select * into v from public.ligas where id = p_id for update;
  if not found then
    raise exception 'liga_nao_encontrada' using errcode = 'P0002';
  end if;
  if v.excluida_em is null then
    raise exception 'liga_fora_da_lixeira: só é possível apagar ligas que estão na lixeira'
      using errcode = 'P0001';
  end if;
  perform set_config('liga_resenha.exclusao_definitiva', 'sim', true);
  delete from public.ligas_eventos where liga_id = p_id;
  delete from public.ligas_versoes where liga_id = p_id;
  delete from public.ligas where id = p_id;
  perform set_config('liga_resenha.exclusao_definitiva', '', true);
  insert into public.exclusoes_definitivas (tipo, item_id, nome, detalhes, apagado_por)
  values ('liga', v.id, v.nome,
          jsonb_build_object('data', v.data, 'participantes', v.participantes,
                             'status', v.status, 'versao', v.versao, 'na_lixeira_desde', v.excluida_em),
          auth.uid());
  return jsonb_build_object('ok', true, 'id', v.id, 'nome', v.nome);
end;
$$;

-- Apaga de vez todas as ligas da lixeira
create function public.esvaziar_lixeira()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  perform public._exigir_admin();
  for r in select id from public.ligas where excluida_em is not null loop
    perform public.excluir_definitivamente(r.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'apagadas', n);
end;
$$;

-- Apaga de vez um atleta inativo que não aparece em nenhuma liga
-- (nem nas da lixeira). Atletas com histórico de jogos nunca são apagados.
create function public.excluir_atleta(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atletas;
begin
  perform public._exigir_admin();
  select * into a from public.atletas where id = p_id for update;
  if not found then
    raise exception 'atleta_nao_encontrado' using errcode = 'P0002';
  end if;
  if a.situacao <> 'inativo' then
    raise exception 'atleta_ativo: marque o atleta como inativo antes de apagar'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.ligas l
    where jsonb_typeof(l.dados -> 'ids') = 'array'
      and (l.dados -> 'ids') ? p_id::text
  ) or exists (
    select 1 from public.ligas_versoes lv
    where jsonb_typeof(lv.dados -> 'ids') = 'array'
      and (lv.dados -> 'ids') ? p_id::text
  ) then
    raise exception 'atleta_em_uso: este atleta aparece em alguma liga e não pode ser apagado'
      using errcode = 'P0001';
  end if;
  perform set_config('liga_resenha.exclusao_definitiva', 'sim', true);
  delete from public.atletas_historico where atleta_id = p_id;
  delete from public.atletas where id = p_id;
  perform set_config('liga_resenha.exclusao_definitiva', '', true);
  insert into public.exclusoes_definitivas (tipo, item_id, nome, apagado_por)
  values ('atleta', a.id, a.nome, auth.uid());
  return jsonb_build_object('ok', true, 'id', a.id, 'nome', a.nome);
end;
$$;

-- Permissões
revoke all on public.exclusoes_definitivas from public, anon, authenticated;
grant select on public.exclusoes_definitivas to authenticated;

revoke all on function
  public.excluir_definitivamente(uuid),
  public.esvaziar_lixeira(),
  public.excluir_atleta(uuid)
from public, anon, authenticated;

grant execute on function
  public.excluir_definitivamente(uuid),
  public.esvaziar_lixeira(),
  public.excluir_atleta(uuid)
to authenticated;
