import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const um = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0].r);
const anon = (sql, p = []) => como('anon', null, () => db.query(sql, p));
const consulta = () => anon('select public.consulta_publica() as r').then((x) => x.rows[0].r);

async function cenario() {
  const a1 = (await um(`select public.salvar_atleta(null, null, 'Ana Teste', 'Aninha', 'membro', 'telefone 9999') as r`)).id;
  const a2 = (await um(`select public.salvar_atleta(null, null, 'Bia Teste') as r`)).id;
  const fora = (await um(`select public.salvar_atleta(null, null, 'Fora Teste') as r`)).id;
  const t = crypto.randomUUID();
  await um(`select public.criar_temporada($1, '4ª Temporada', '2027-01-10', $2) as r`, [t, JSON.stringify({ etapas: 10, especiais: [3] })]);
  const dados = { names: ['Ana Teste', 'Bia Teste', ...Array(14).fill('')], ids: [a1, a2, ...Array(14).fill(null)], scores: {}, finals: {}, breaks: {} };
  const e1 = crypto.randomUUID();
  await um(`select public.criar_etapa($1, 1, $2, 'Etapa 1', '2027-01-10', $3) as r`, [t, e1, JSON.stringify(dados)]);
  await um(`select public.salvar_temporada($1, 1, p_dados => $2) as r`, [t, JSON.stringify({ ajustes: [{ id: 'x', atleta_id: a2, etapa: 1, pontos: -5, motivo: 'atraso', em: '2027-01-10' }], segredo: 'nao' })]);
  return { t, a1, a2, fora, e1 };
}

describe('consulta pública', () => {
  it('sem temporada pública, não devolve temporada nem etapas', async () => {
    await cenario();
    expect(await consulta()).toEqual({ temporada: null, etapas: [], atletas: [], relampagos: [] });
  });

  it('relâmpago criadas aparecem; arquivadas e na lixeira não', async () => {
    await cenario();
    const nova = async (nome, data) => {
      const id = crypto.randomUUID();
      await um(`select public.criar_liga($1, $2, $3, $4) as r`, [id, nome, data, JSON.stringify({ names: ['Ana Teste', ...Array(15).fill('')], ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} })]);
      return id;
    };
    const r1 = await nova('Relâmpago Sábado', '2027-01-20');
    const r2 = await nova('Relâmpago Domingo', '2027-01-21');
    const arq = await nova('Relâmpago Arquivada', '2027-01-22');
    const lix = await nova('Relâmpago Lixeira', '2027-01-23');
    await db.query(`update public.ligas set status = 'arquivada', versao = versao + 1 where id = $1`, [arq]);
    await um(`select public.mover_para_lixeira($1) as r`, [lix]);
    const r = await consulta();
    expect(r.temporada).toBeNull();
    expect(r.relampagos.map((x) => x.id)).toEqual([r2, r1]);
    expect(r.relampagos[0]).toMatchObject({ nome: 'Relâmpago Domingo', status: 'preparacao', etapa_numero: null });
    expect(r.relampagos[0].dados.names[0]).toBe('Ana Teste');
  });

  it('devolve as datas previstas válidas das próximas etapas', async () => {
    const { t } = await cenario();
    await um(`select public.salvar_temporada($1, 2, p_publica => true, p_dados => $2) as r`, [t, JSON.stringify({ datas: { 2: '2027-02-07', 3: '2027-03-07', x: '2027-01-01', 4: 'amanhã' } })]);
    expect((await consulta()).temporada.dados).toEqual({ ajustes: [], datas: { 2: '2027-02-07', 3: '2027-03-07' } });
  });

  it('com a temporada pública, devolve só o necessário', async () => {
    const { t, a1, a2, fora, e1 } = await cenario();
    await um(`select public.salvar_temporada($1, 2, p_publica => true) as r`, [t]);
    const r = await consulta();
    expect(r.temporada).toMatchObject({ id: t, nome: '4ª Temporada', regras: { especiais: [3] } });
    expect(r.temporada.dados).toEqual({ ajustes: [{ id: 'x', atleta_id: a2, etapa: 1, pontos: -5, motivo: 'atraso' }], datas: {} });
    expect(r.relampagos).toEqual([]);
    expect(r.etapas.map((e) => e.id)).toEqual([e1]);
    expect(r.etapas[0].dados.names[0]).toBe('Ana Teste');
    expect(r.atletas).toEqual([{ id: a1, nome: 'Ana Teste', situacao: 'membro' }, { id: a2, nome: 'Bia Teste', situacao: 'membro' }]);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('telefone');
    expect(texto).not.toContain('Aninha');
    expect(texto).not.toContain(fora);
    expect(texto).not.toContain('segredo');
  });

  it('etapa excluída não aparece', async () => {
    const { t, e1 } = await cenario();
    await um(`select public.salvar_temporada($1, 2, p_publica => true) as r`, [t]);
    await um(`select public.mover_para_lixeira($1) as r`, [e1]);
    expect((await consulta()).etapas).toEqual([]);
  });

  it('quem não está logado continua sem ler as tabelas nem gravar', async () => {
    const { t } = await cenario();
    await um(`select public.salvar_temporada($1, 2, p_publica => true) as r`, [t]);
    await expect(anon('select * from public.temporadas')).rejects.toThrow(/permission denied/);
    await expect(anon('select * from public.ligas')).rejects.toThrow(/permission denied/);
    await expect(anon('select * from public.atletas')).rejects.toThrow(/permission denied/);
    await expect(anon(`select public.salvar_temporada($1, 3, p_nome => 'X')`, [t])).rejects.toThrow(/permission denied/);
  });
});
