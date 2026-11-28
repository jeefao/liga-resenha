import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const um = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0].r);
const anon = (sql, p = []) => como('anon', null, () => db.query(sql, p));
const consulta = () => um('select public.consulta_publica() as r');
const versao = (t) => db.query('select versao from public.temporadas where id = $1', [t]).then((x) => x.rows[0].versao);

async function temporada(nome, inicio) {
  const t = crypto.randomUUID();
  await um(`select public.criar_temporada($1, $2, $3, $4) as r`, [t, nome, inicio, JSON.stringify({ etapas: 10, especiais: [3] })]);
  return t;
}
async function cenario() {
  const a1 = (await um(`select public.salvar_atleta(null, null, 'Ana Teste', 'Aninha', 'membro', 'telefone 9999') as r`)).id;
  const a2 = (await um(`select public.salvar_atleta(null, null, 'Bia Teste') as r`)).id;
  const fora = (await um(`select public.salvar_atleta(null, null, 'Fora Teste') as r`)).id;
  const t = await temporada('4ª Temporada', '2027-01-10');
  const dados = { names: ['Ana Teste', 'Bia Teste', ...Array(14).fill('')], ids: [a1, a2, ...Array(14).fill(null)], scores: {}, finals: {}, breaks: {} };
  const e1 = crypto.randomUUID();
  await um(`select public.criar_etapa($1, 1, $2, 'Etapa 1', '2027-01-10', $3) as r`, [t, e1, JSON.stringify(dados)]);
  await um(`select public.salvar_temporada($1, $2, p_dados => $3) as r`, [t, await versao(t), JSON.stringify({
    ajustes: [{ id: 'x', atleta_id: a2, etapa: 1, pontos: -5, motivo: 'atraso', em: '2027-01-10' }],
    datas: { 2: '2027-02-07', x: '2027-01-01', 4: 'amanhã' }, segredo: 'nao' })]);
  return { t, a1, a2, fora, e1 };
}
const novaRelampago = async (nome, data) => {
  const id = crypto.randomUUID();
  await um(`select public.criar_liga($1, $2, $3, $4) as r`, [id, nome, data, JSON.stringify({ names: ['Ana Teste', ...Array(15).fill('')], ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} })]);
  return id;
};

describe('consulta pública', () => {
  it('banco vazio: listas vazias', async () => {
    expect(await consulta()).toEqual({ temporadas: [], etapas: [], atletas: [], relampagos: [] });
  });

  it('mostra as temporadas em andamento e encerradas, sem precisar marcar como pública', async () => {
    const { t, a1, a2, fora, e1 } = await cenario();
    const r = await consulta();
    expect(r.temporadas).toHaveLength(1);
    expect(r.temporadas[0]).toMatchObject({ id: t, nome: '4ª Temporada', status: 'andamento', regras: { especiais: [3] } });
    expect(r.temporadas[0].dados).toEqual({ ajustes: [{ id: 'x', atleta_id: a2, etapa: 1, pontos: -5, motivo: 'atraso' }], datas: { 2: '2027-02-07' } });
    expect(r.etapas.map((e) => [e.id, e.temporada_id])).toEqual([[e1, t]]);
    expect(r.etapas[0].dados.names[0]).toBe('Ana Teste');
    expect(r.atletas).toEqual([{ id: a1, nome: 'Ana Teste', situacao: 'membro' }, { id: a2, nome: 'Bia Teste', situacao: 'membro' }]);
    const texto = JSON.stringify(r);
    for (const x of ['telefone', 'Aninha', fora, 'segredo', 'amanhã']) expect(texto).not.toContain(x);
  });

  it('temporada arquivada e suas etapas não aparecem; encerrada aparece', async () => {
    const { t } = await cenario();
    const t2 = await temporada('3ª Temporada', '2026-01-10');
    await um(`select public.salvar_temporada($1, $2, p_status => 'encerrada') as r`, [t2, await versao(t2)]);
    expect((await consulta()).temporadas.map((x) => x.nome)).toEqual(['4ª Temporada', '3ª Temporada']);
    await um(`select public.salvar_temporada($1, $2, p_status => 'encerrada') as r`, [t, await versao(t)]);
    await um(`select public.salvar_temporada($1, $2, p_status => 'arquivada') as r`, [t, await versao(t)]);
    const r = await consulta();
    expect(r.temporadas.map((x) => x.nome)).toEqual(['3ª Temporada']);
    expect(r.etapas).toEqual([]);
    expect(r.atletas).toEqual([]);
  });

  it('etapa na lixeira não aparece', async () => {
    const { e1 } = await cenario();
    await um(`select public.mover_para_lixeira($1) as r`, [e1]);
    expect((await consulta()).etapas).toEqual([]);
  });

  it('relâmpago criadas aparecem; arquivadas e na lixeira não', async () => {
    await cenario();
    const r1 = await novaRelampago('Relâmpago Sábado', '2027-01-20');
    const r2 = await novaRelampago('Relâmpago Domingo', '2027-01-21');
    const arq = await novaRelampago('Relâmpago Arquivada', '2027-01-22');
    const lix = await novaRelampago('Relâmpago Lixeira', '2027-01-23');
    await db.query(`update public.ligas set status = 'arquivada', versao = versao + 1 where id = $1`, [arq]);
    await um(`select public.mover_para_lixeira($1) as r`, [lix]);
    const r = await consulta();
    expect(r.relampagos.map((x) => x.id)).toEqual([r2, r1]);
    expect(r.relampagos[0]).toMatchObject({ nome: 'Relâmpago Domingo', status: 'preparacao', temporada_id: null, etapa_numero: null });
  });

  it('quem não está logado continua sem ler as tabelas nem gravar', async () => {
    const { t } = await cenario();
    await expect(anon('select * from public.temporadas')).rejects.toThrow(/permission denied/);
    await expect(anon('select * from public.ligas')).rejects.toThrow(/permission denied/);
    await expect(anon('select * from public.atletas')).rejects.toThrow(/permission denied/);
    await expect(anon(`select public.salvar_temporada($1, 3, p_nome => 'X')`, [t])).rejects.toThrow(/permission denied/);
  });
});
