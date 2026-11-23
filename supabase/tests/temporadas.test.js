import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const um = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0].r);
const q = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows);
const REGRAS = { etapas: 10, dobradas: [5], descartes: 1 };
const dados16 = () => JSON.stringify({ names: Array(16).fill(''), ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} });

async function novaTemporada(nome = '4ª Temporada') {
  const id = crypto.randomUUID();
  await um(`select public.criar_temporada($1, $2, '2027-01-10', $3) as r`, [id, nome, JSON.stringify(REGRAS)]);
  return id;
}
const etapa = (t, n, id = crypto.randomUUID()) =>
  um(`select public.criar_etapa($1, $2, $3, $4, '2027-01-10', $5) as r`, [t, n, id, 'Etapa ' + n, dados16()]);

describe('temporadas', () => {
  it('cria temporada com versão 1 e cópia', async () => {
    const t = await novaTemporada();
    const r = await q('select versao, regras from public.temporadas where id = $1', [t]);
    expect(r[0]).toMatchObject({ versao: 1, regras: REGRAS });
    expect((await q('select versao, motivo from public.temporadas_versoes'))).toEqual([{ versao: 1, motivo: 'Criação da temporada' }]);
  });

  it('salva com controle de versão e detecta conflito', async () => {
    const t = await novaTemporada();
    const a = await um(`select public.salvar_temporada($1, 1, p_dados => $2, p_motivo => 'Ajuste: atraso') as r`, [t, JSON.stringify({ ajustes: [{ pontos: -5 }] })]);
    expect(a).toMatchObject({ ok: true, versao: 2, dados: { ajustes: [{ pontos: -5 }] }, regras: REGRAS });
    const b = await um(`select public.salvar_temporada($1, 1, p_nome => 'X') as r`, [t]);
    expect(b).toMatchObject({ ok: false, conflito: true, versao_servidor: 2 });
    expect((await q('select motivo from public.temporadas_versoes where versao = 2'))[0].motivo).toBe('Ajuste: atraso');
  });

  it('cria etapas ligadas à temporada, sem repetir número', async () => {
    const t = await novaTemporada();
    await etapa(t, 1);
    await expect(etapa(t, 1)).rejects.toThrow(/etapa_ja_existe/);
    const e2 = crypto.randomUUID();
    await etapa(t, 2, e2);
    const r = await q('select etapa_numero, temporada_id, versao from public.ligas order by etapa_numero');
    expect(r.map((x) => x.etapa_numero)).toEqual([1, 2]);
    expect(r.every((x) => x.temporada_id === t && x.versao === 1)).toBe(true);
    // repetir a mesma chamada (internet caiu e o app tentou de novo) não duplica
    expect(await etapa(t, 2, e2)).toMatchObject({ ja_existia: true });
  });

  it('salvar a liga não muda temporada nem número da etapa', async () => {
    const t = await novaTemporada();
    const id = crypto.randomUUID();
    await etapa(t, 3, id);
    await um(`select public.salvar_liga($1, 1, $2) as r`, [id, dados16()]);
    const r = await q('select etapa_numero, temporada_id, versao from public.ligas');
    expect(r[0]).toMatchObject({ etapa_numero: 3, temporada_id: t, versao: 2 });
  });

  it('etapa na lixeira libera o número; temporada encerrada não cria etapa', async () => {
    const t = await novaTemporada();
    const id = crypto.randomUUID();
    await etapa(t, 1, id);
    await um(`select public.mover_para_lixeira($1) as r`, [id]);
    await etapa(t, 1);
    await expect(um(`select public.retirar_da_lixeira($1) as r`, [id])).rejects.toThrow(/ligas_etapa_unica/);
    await um(`select public.salvar_temporada($1, 1, p_status => 'encerrada') as r`, [t]);
    await expect(etapa(t, 2)).rejects.toThrow(/temporada_fechada/);
  });

  it('relâmpago continua sem temporada', async () => {
    await um(`select public.criar_liga(null, 'Relâmpago', '2027-01-01', $1) as r`, [dados16()]);
    const r = await q('select temporada_id, etapa_numero from public.ligas');
    expect(r[0]).toEqual({ temporada_id: null, etapa_numero: null });
  });

  it('protegido: sem admin não vê nem grava; não apaga', async () => {
    const t = await novaTemporada();
    await expect(como('anon', null, () => db.query('select * from public.temporadas'))).rejects.toThrow(/permission denied/);
    expect((await como('authenticated', OUTRO, () => db.query('select * from public.temporadas'))).rows).toHaveLength(0);
    await expect(como('authenticated', OUTRO, () => db.query(`select public.salvar_temporada($1, 1, 'X')`, [t]))).rejects.toThrow(/acesso_negado/);
    await expect(db.query('delete from public.temporadas')).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query('delete from public.temporadas_versoes')).rejects.toThrow(/operacao_bloqueada/);
    await expect(admin(() => db.query(`update public.temporadas set nome = 'X'`))).rejects.toThrow(/permission denied/);
  });
});
