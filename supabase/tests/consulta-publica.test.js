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
  it('sem temporada pública, quem não está logado não recebe nada', async () => {
    await cenario();
    expect(await consulta()).toBeNull();
  });

  it('com a temporada pública, devolve só o necessário', async () => {
    const { t, a1, a2, fora, e1 } = await cenario();
    await um(`select public.salvar_temporada($1, 2, p_publica => true) as r`, [t]);
    const r = await consulta();
    expect(r.temporada).toMatchObject({ id: t, nome: '4ª Temporada', regras: { especiais: [3] } });
    expect(r.temporada.dados).toEqual({ ajustes: [{ id: 'x', atleta_id: a2, etapa: 1, pontos: -5, motivo: 'atraso' }] });
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
