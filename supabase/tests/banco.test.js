/**
 * Testes das migrations da V6 contra um PostgreSQL real em memória (PGlite).
 * Simula o ambiente do Supabase (schema auth, auth.uid(), papéis anon/authenticated)
 * e valida RLS, permissões, controle de versão, histórico e lixeira.
 * Não acessa a internet nem nenhum projeto Supabase.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = '00000000-0000-4000-a000-0000000000aa';
const OUTRO = '00000000-0000-4000-a000-0000000000bb';
const LIGA = '11111111-1111-4111-a111-111111111111';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif((nullif(current_setting('request.jwt.claims', true), '')::json)->>'sub', '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Como no Supabase: tudo concedido por padrão (a migration precisa revogar)
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
`;

const nomes = (n, prefixo = 'Atleta') =>
  Array.from({ length: n }, (_, i) => `${prefixo} ${String(i + 1).padStart(2, '0')}`);
const dados = (n, extra = {}) => ({ names: nomes(n), scores: {}, finals: {}, breaks: {}, ...extra });

let db;

async function como(papel, uid, fn) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${papel}`);
    if (uid) await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);
    const r = await fn();
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
const admin = (fn) => como('authenticated', ADMIN, fn);
const rpc = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function criarLiga(n = 24, extra = {}) {
  return admin(() =>
    rpc(`select public.criar_liga($1, $2, $3, $4) as r`, [LIGA, 'Relâmpago Sábado', '2026-11-28', JSON.stringify(dados(n, extra))])
  ).then((x) => x.r);
}
async function salvar(versao, novosDados, opcoes = {}) {
  const r = await admin(() =>
    rpc(
      `select public.salvar_liga(p_id => $1, p_versao_esperada => $2, p_dados => $3, p_status => $4,
         p_etapa => $5, p_eventos => $6, p_motivo => $7) as r`,
      [
        LIGA,
        versao,
        novosDados === null ? null : JSON.stringify(novosDados),
        opcoes.status ?? null,
        opcoes.etapa ?? null,
        JSON.stringify(opcoes.eventos ?? []),
        opcoes.motivo ?? null,
      ]
    )
  );
  return r.r;
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  await db.exec(`insert into auth.users (id, email) values
    ('${ADMIN}', 'admin@teste.local'), ('${OUTRO}', 'outro@teste.local');
    insert into public.admins (user_id, dono) values ('${ADMIN}', true);`);
});

describe('segurança (RLS e permissões)', () => {
  it('visitante sem login não lê nem cria ligas', async () => {
    await criarLiga();
    await expect(como('anon', null, () => db.query('select * from public.ligas'))).rejects.toThrow(/permission denied/);
    await expect(
      como('anon', null, () => db.query(`select public.criar_liga(null, 'X', '2026-01-01', '{"names":[]}')`))
    ).rejects.toThrow(/permission denied/);
  });

  it('usuário logado que não é admin não vê nada e não consegue gravar', async () => {
    await criarLiga();
    const r = await como('authenticated', OUTRO, () => db.query('select * from public.ligas'));
    expect(r.rows).toHaveLength(0);
    const v = await como('authenticated', OUTRO, () => db.query('select * from public.ligas_versoes'));
    expect(v.rows).toHaveLength(0);
    await expect(
      como('authenticated', OUTRO, () =>
        db.query(`select public.salvar_liga($1, 1, $2)`, [LIGA, JSON.stringify(dados(16))])
      )
    ).rejects.toThrow(/acesso_negado/);
  });

  it('nem o admin grava direto nas tabelas (só pelas funções)', async () => {
    await criarLiga();
    await expect(admin(() => db.query(`update public.ligas set nome = 'X'`))).rejects.toThrow(/permission denied/);
    await expect(admin(() => db.query(`delete from public.ligas`))).rejects.toThrow(/permission denied/);
    await expect(
      admin(() => db.query(`insert into public.ligas_versoes (liga_id, versao, nome, data, participantes, status, etapa, dados, motivo)
        values ('${LIGA}', 99, 'x', '2026-01-01', 16, 'preparacao', 'cadastro', '{}', 'x')`))
    ).rejects.toThrow(/permission denied/);
    await expect(admin(() => db.query(`insert into public.admins values ('${OUTRO}')`))).rejects.toThrow(/permission denied/);
  });

  it('keepalive responde sem login e não expõe dados', async () => {
    await criarLiga();
    const r = await como('anon', null, () => db.query('select public.keepalive() as r'));
    expect(r.rows[0].r).toMatch(/^ok \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(como('anon', null, () => db.query('select * from public.ligas'))).rejects.toThrow(/permission denied/);
  });

  it('funções internas não podem ser chamadas pelo app', async () => {
    await expect(admin(() => db.query(`select public._exigir_admin()`))).rejects.toThrow(/permission denied/);
    await expect(
      admin(() => db.query(`select public._registrar_eventos('${LIGA}', 1, '[]')`))
    ).rejects.toThrow(/permission denied/);
  });
});

describe('criação de liga', () => {
  it('cria com versão 1, cópia de segurança e evento no histórico', async () => {
    const r = await criarLiga(24);
    expect(r).toMatchObject({ ok: true, id: LIGA, versao: 1, participantes: 24, status: 'preparacao' });
    const v = await admin(() => db.query('select versao, motivo from public.ligas_versoes'));
    expect(v.rows).toEqual([{ versao: 1, motivo: 'Criação da liga' }]);
    const e = await admin(() => db.query('select tipo from public.ligas_eventos'));
    expect(e.rows).toEqual([{ tipo: 'criada' }]);
  });

  it('aceita os cinco formatos e recusa quantidades inválidas', async () => {
    for (const n of [16, 20, 24, 28, 32]) {
      const r = await admin(() =>
        rpc(`select public.criar_liga(null, 'L', '2026-11-28', $1) as r`, [JSON.stringify(dados(n))])
      );
      expect(r.r.participantes).toBe(n);
    }
    await expect(
      admin(() => db.query(`select public.criar_liga(null, 'L', '2026-11-28', $1)`, [JSON.stringify(dados(18))]))
    ).rejects.toThrow(/participantes_check/);
    await expect(
      admin(() => db.query(`select public.criar_liga(null, 'L', '2026-11-28', '{"semNomes":true}')`))
    ).rejects.toThrow();
  });

  it('repetir a criação com o mesmo id não duplica (reenvio seguro)', async () => {
    await criarLiga();
    const r = await criarLiga();
    expect(r.ja_existia).toBe(true);
    const c = await admin(() => db.query('select count(*)::int as n from public.ligas'));
    expect(c.rows[0].n).toBe(1);
  });

  it('ligas diferentes são independentes', async () => {
    await criarLiga(24);
    const outra = await admin(() =>
      rpc(`select public.criar_liga(null, 'Outra', '2026-11-29', $1) as r`, [JSON.stringify(dados(16))])
    );
    await salvar(1, dados(24, { scores: { '0-0': [6, 2] } }));
    const r = await admin(() => db.query('select id, versao, participantes from public.ligas order by participantes'));
    expect(r.rows).toEqual([
      { id: outra.r.id, versao: 1, participantes: 16 },
      { id: LIGA, versao: 2, participantes: 24 },
    ]);
  });
});

describe('salvamento com controle de versão', () => {
  it('salva quando a versão confere e devolve a hora do servidor', async () => {
    await criarLiga();
    const r = await salvar(1, dados(24, { scores: { '0-0': [6, 3] } }), {
      status: 'andamento',
      etapa: 'grupos',
      eventos: [{ tipo: 'placar', descricao: 'Grupo A jogo 1: 6×3' }],
    });
    expect(r).toMatchObject({ ok: true, versao: 2, status: 'andamento', etapa: 'grupos' });
    expect(r.atualizado_em).toBeTruthy();
    const e = await admin(() => db.query(`select tipo, versao from public.ligas_eventos order by id`));
    expect(e.rows.at(-1)).toEqual({ tipo: 'placar', versao: 2 });
  });

  it('CONFLITO: aparelho com versão antiga não sobrescreve', async () => {
    await criarLiga();
    await salvar(1, dados(24, { scores: { '0-0': [6, 3] } })); // celular salva → v2
    const r = await salvar(1, dados(24, { scores: { '0-0': [1, 6] } })); // computador ainda estava na v1
    expect(r).toMatchObject({ ok: false, conflito: true, versao_servidor: 2 });
    const l = await admin(() => db.query(`select versao, dados->'scores'->'0-0' as placar from public.ligas`));
    expect(l.rows[0]).toEqual({ versao: 2, placar: [6, 3] });
  });

  it('INCIDENTE: não aceita trocar 24 atletas por 16 com a liga em andamento', async () => {
    await criarLiga(24);
    await salvar(1, null, { status: 'andamento', etapa: 'grupos' });
    await expect(salvar(2, dados(16))).rejects.toThrow(/participantes_travados/);
    const l = await admin(() => db.query(`select versao, participantes from public.ligas`));
    expect(l.rows[0]).toEqual({ versao: 2, participantes: 24 });
  });

  it('permite mudar a quantidade de atletas durante a preparação', async () => {
    await criarLiga(24);
    const r = await salvar(1, dados(32));
    expect(r).toMatchObject({ ok: true, participantes: 32 });
  });

  it('liga finalizada só aceita correção de resultado com motivo registrado', async () => {
    await criarLiga();
    await salvar(1, dados(24, { finals: { f: [6, 4] } }), { status: 'finalizada', etapa: 'encerrada' });
    await expect(salvar(2, dados(24, { finals: { f: [4, 6] } }))).rejects.toThrow(/motivo_obrigatorio/);
    const r = await salvar(2, dados(24, { finals: { f: [6, 3] } }), { motivo: 'Placar da final digitado errado' });
    expect(r).toMatchObject({ ok: true, versao: 3 });
    const e = await admin(() => db.query(`select tipo, descricao from public.ligas_eventos where tipo = 'correcao'`));
    expect(e.rows).toEqual([{ tipo: 'correcao', descricao: 'Placar da final digitado errado' }]);
    // Arquivar (sem mudar dados) não exige motivo
    expect(await salvar(3, null, { status: 'arquivada' })).toMatchObject({ ok: true, status: 'arquivada' });
  });

  it('cada gravação gera uma cópia completa', async () => {
    await criarLiga();
    await salvar(1, dados(24, { scores: { '0-0': [6, 1] } }));
    await salvar(2, dados(24, { scores: { '0-0': [6, 1], '0-1': [3, 6] } }));
    const v = await admin(() =>
      db.query(`select versao, jsonb_object_keys_count from (
        select versao, (select count(*)::int from jsonb_object_keys(dados->'scores')) as jsonb_object_keys_count
        from public.ligas_versoes order by versao) x`)
    );
    expect(v.rows).toEqual([
      { versao: 1, jsonb_object_keys_count: 0 },
      { versao: 2, jsonb_object_keys_count: 1 },
      { versao: 3, jsonb_object_keys_count: 2 },
    ]);
  });
});

describe('recuperação', () => {
  it('restaurar versão cria uma versão nova com o conteúdo antigo', async () => {
    await criarLiga();
    await salvar(1, dados(24, { scores: { '0-0': [6, 1] } }));
    await salvar(2, dados(24, { scores: {} }));
    const r = await admin(() => rpc(`select public.restaurar_versao($1, 2, 3) as r`, [LIGA]));
    expect(r.r).toMatchObject({ ok: true, versao: 4 });
    const l = await admin(() => db.query(`select dados->'scores'->'0-0' as p from public.ligas`));
    expect(l.rows[0].p).toEqual([6, 1]);
    const n = await admin(() => db.query(`select count(*)::int as n from public.ligas_versoes`));
    expect(n.rows[0].n).toBe(4);
  });

  it('restaurar com versão desatualizada devolve conflito', async () => {
    await criarLiga();
    await salvar(1, dados(24));
    const r = await admin(() => rpc(`select public.restaurar_versao($1, 1, 1) as r`, [LIGA]));
    expect(r.r).toMatchObject({ ok: false, conflito: true, versao_servidor: 2 });
  });

  it('lixeira: mover, bloquear edição e retirar', async () => {
    await criarLiga();
    const m = await admin(() => rpc(`select public.mover_para_lixeira($1) as r`, [LIGA]));
    expect(m.r).toMatchObject({ ok: true, versao: 2, excluida: true });
    await expect(salvar(2, dados(24))).rejects.toThrow(/liga_na_lixeira/);
    const t = await admin(() => rpc(`select public.retirar_da_lixeira($1) as r`, [LIGA]));
    expect(t.r).toMatchObject({ ok: true, versao: 3, excluida: false });
    expect(await salvar(3, dados(24))).toMatchObject({ ok: true, versao: 4 });
  });

  it('histórico e versões são imutáveis e ligas não são apagadas, nem pelo dono do banco', async () => {
    await criarLiga();
    await expect(db.query(`update public.ligas_versoes set motivo = 'x'`)).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query(`delete from public.ligas_versoes`)).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query(`delete from public.ligas_eventos`)).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query(`delete from public.ligas`)).rejects.toThrow(/operacao_bloqueada/);
  });

  it('versão só avança de 1 em 1, mesmo em alteração manual', async () => {
    await criarLiga();
    await expect(db.query(`update public.ligas set nome = 'Manual'`)).rejects.toThrow(/versao_invalida/);
    await db.query(`update public.ligas set nome = 'Manual', versao = versao + 1`);
    const v = await db.query(`select versao from public.ligas_versoes order by versao`);
    expect(v.rows.map((x) => x.versao)).toEqual([1, 2]);
  });
});
