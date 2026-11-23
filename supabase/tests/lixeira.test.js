import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const q = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows);
const um = (sql, p = []) => q(sql, p).then((r) => r[0].r);
const n = async (tabela) => (await q(`select count(*)::int as n from public.${tabela}`))[0].n;

async function novaLiga(nome, ids = null) {
  const id = crypto.randomUUID();
  const names = Array.from({ length: 16 }, (_, i) => `${nome} ${i + 1}`);
  await um(`select public.criar_liga($1, $2, '2026-11-28', $3) as r`, [id, nome, JSON.stringify({ names, ids: ids ?? names.map(() => null), scores: {}, finals: {}, breaks: {} })]);
  return id;
}
const lixeira = (id) => um(`select public.mover_para_lixeira($1) as r`, [id]);

describe('exclusão definitiva', () => {
  it('liga fora da lixeira não pode ser apagada', async () => {
    const id = await novaLiga('A');
    await expect(um(`select public.excluir_definitivamente($1) as r`, [id])).rejects.toThrow(/liga_fora_da_lixeira/);
    expect(await n('ligas')).toBe(1);
  });

  it('apaga liga da lixeira com versões e eventos e deixa registro', async () => {
    const a = await novaLiga('A');
    const b = await novaLiga('B');
    await lixeira(a);
    const r = await um(`select public.excluir_definitivamente($1) as r`, [a]);
    expect(r).toMatchObject({ ok: true, nome: 'A' });
    expect((await q('select id from public.ligas')).map((x) => x.id)).toEqual([b]);
    expect((await q('select count(*)::int as n from public.ligas_versoes where liga_id = $1', [a]))[0].n).toBe(0);
    expect((await q('select count(*)::int as n from public.ligas_eventos where liga_id = $1', [a]))[0].n).toBe(0);
    const reg = await q('select tipo, nome from public.exclusoes_definitivas');
    expect(reg).toEqual([{ tipo: 'liga', nome: 'A' }]);
  });

  it('esvaziar lixeira apaga só as que estão na lixeira', async () => {
    const a = await novaLiga('A');
    const b = await novaLiga('B');
    const c = await novaLiga('C');
    await lixeira(a);
    await lixeira(c);
    expect(await um('select public.esvaziar_lixeira() as r')).toMatchObject({ ok: true, apagadas: 2 });
    expect((await q('select id from public.ligas')).map((x) => x.id)).toEqual([b]);
  });

  it('apagar direto nas tabelas continua bloqueado', async () => {
    const a = await novaLiga('A');
    await lixeira(a);
    await expect(db.query('delete from public.ligas')).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query('delete from public.ligas_versoes')).rejects.toThrow(/operacao_bloqueada/);
    await expect(admin(() => db.query('delete from public.ligas'))).rejects.toThrow(/permission denied/);
    await um(`select public.excluir_definitivamente($1) as r`, [a]);
    await expect(db.query('delete from public.exclusoes_definitivas')).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query(`update public.exclusoes_definitivas set nome = 'x'`)).rejects.toThrow(/operacao_bloqueada/);
  });

  it('quem não é admin não apaga', async () => {
    const a = await novaLiga('A');
    await lixeira(a);
    await expect(como('authenticated', OUTRO, () => db.query('select public.esvaziar_lixeira()'))).rejects.toThrow(/acesso_negado/);
    await expect(como('anon', null, () => db.query('select public.esvaziar_lixeira()'))).rejects.toThrow(/permission denied/);
    expect(await n('ligas')).toBe(1);
  });

  it('atleta: só apaga inativo que não está em nenhuma liga', async () => {
    const at = await um(`select public.salvar_atleta(null, null, 'Teste') as r`);
    await expect(um(`select public.excluir_atleta($1) as r`, [at.id])).rejects.toThrow(/atleta_ativo/);
    await um(`select public.salvar_atleta($1, 1, 'Teste', null, 'inativo') as r`, [at.id]);
    const ids = Array(16).fill(null);
    ids[0] = at.id;
    const liga = await novaLiga('L', ids);
    await expect(um(`select public.excluir_atleta($1) as r`, [at.id])).rejects.toThrow(/atleta_em_uso/);
    await lixeira(liga);
    await expect(um(`select public.excluir_atleta($1) as r`, [at.id])).rejects.toThrow(/atleta_em_uso/);
    await um(`select public.excluir_definitivamente($1) as r`, [liga]);
    expect(await um(`select public.excluir_atleta($1) as r`, [at.id])).toMatchObject({ ok: true, nome: 'Teste' });
    expect(await n('atletas')).toBe(0);
    expect(await n('atletas_historico')).toBe(0);
    await expect(db.query('delete from public.atletas')).resolves.toBeTruthy(); // tabela vazia: nada a bloquear
  });
});
