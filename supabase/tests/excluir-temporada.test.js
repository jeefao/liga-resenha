import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const um = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0].r);
const q = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows);
const dados16 = () => JSON.stringify({ names: Array(16).fill(''), ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} });

async function novaTemporada(nome) {
  const id = crypto.randomUUID();
  await um(`select public.criar_temporada($1, $2, '2027-01-10', $3) as r`, [id, nome, JSON.stringify({ etapas: 10 })]);
  return id;
}
const etapa = (t, n) => um(`select public.criar_etapa($1, $2, $3, $4, '2027-01-10', $5) as r`, [t, n, crypto.randomUUID(), 'Etapa ' + n, dados16()]);
const arquivar = (t) => um(`select public.salvar_temporada($1, (select versao from public.temporadas where id = $1), p_status => 'arquivada') as r`, [t]);

describe('apagar temporada', () => {
  it('só apaga temporada arquivada', async () => {
    const t = await novaTemporada('Teste');
    await expect(um(`select public.excluir_temporada($1) as r`, [t])).rejects.toThrow(/temporada_nao_arquivada/);
    expect(await q('select id from public.temporadas')).toHaveLength(1);
  });

  it('apaga a temporada com as etapas e deixa registro; não mexe em outras', async () => {
    const t = await novaTemporada('Teste');
    const outra = await novaTemporada('Outra');
    await etapa(t, 1);
    await etapa(t, 2);
    await etapa(outra, 1);
    const rel = await um(`select public.criar_liga(null, 'Relâmpago', '2027-01-01', $1) as r`, [dados16()]);
    await arquivar(t);
    const r = await um(`select public.excluir_temporada($1) as r`, [t]);
    expect(r).toMatchObject({ ok: true, nome: 'Teste', etapas: 2 });
    expect((await q('select nome from public.temporadas')).map((x) => x.nome)).toEqual(['Outra']);
    expect((await q('select count(*)::int as n from public.temporadas_versoes where temporada_id = $1', [t]))[0].n).toBe(0);
    expect((await q('select count(*)::int as n from public.ligas'))[0].n).toBe(2);
    expect((await q(`select count(*)::int as n from public.ligas where nome = 'Relâmpago'`))[0].n).toBe(1);
    const reg = await q('select tipo, nome from public.exclusoes_definitivas order by id');
    expect(reg).toEqual([{ tipo: 'liga', nome: 'Etapa 1' }, { tipo: 'liga', nome: 'Etapa 2' }, { tipo: 'temporada', nome: 'Teste' }]);
    expect(rel).toBeTruthy();
  });

  it('continua bloqueado apagar direto, e quem não é admin não apaga', async () => {
    const t = await novaTemporada('Teste');
    await arquivar(t);
    await expect(db.query('delete from public.temporadas')).rejects.toThrow(/operacao_bloqueada/);
    await expect(como('authenticated', OUTRO, () => db.query('select public.excluir_temporada($1)', [t]))).rejects.toThrow(/acesso_negado/);
    await expect(como('anon', null, () => db.query('select public.excluir_temporada($1)', [t]))).rejects.toThrow(/permission denied/);
    expect(await q('select id from public.temporadas')).toHaveLength(1);
  });
});
