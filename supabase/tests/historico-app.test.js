import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const sub = (sql, p = []) => como('authenticated', SUB, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const outro = (sql, p = []) => como('authenticated', OUTRO, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const hist = (area = null) => dono('select public.historico_app($1) as r', [area]);

async function atletaAprovado() {
  const a = (await dono(`select public.salvar_atleta(null, null, 'Bia Teste') as r`)).id;
  await sub(`select public.solicitar_acesso('Bia Teste') as r`);
  await dono(`select public.definir_acesso($1, 'aprovado', $2) as r`, [SUB, a]);
  return a;
}

async function ligaCom(ids, nomes, data = '2026-12-05') {
  const id = crypto.randomUUID();
  const dados = { names: [...nomes, ...Array(16 - nomes.length).fill('')], ids: [...ids, ...Array(16 - ids.length).fill(null)], scores: {}, finals: {}, breaks: {} };
  await dono(`select public.criar_liga($1, 'Relâmpago Teste', $2, $3) as r`, [id, data, JSON.stringify(dados)]);
  return id;
}

describe('histórico do app', () => {
  it('registra atletas, contas, financeiro e ligas, com quem fez', async () => {
    const a = await atletaAprovado();
    await dono('select public.fin_salvar_config(10000, 5000) as r');
    await ligaCom([a], ['Bia Teste']);
    const h = await hist();
    const txt = h.map((x) => `${x.area}|${x.quem}|${x.acao}|${x.alvo || ''}`);
    expect(txt).toContainEqual(expect.stringMatching(/^atletas\|.*\|cadastrou o atleta\|Bia Teste$/));
    expect(txt).toContainEqual(expect.stringMatching(/^usuarios\|Bia Teste\|pediu acesso\|Bia Teste/));
    expect(txt).toContainEqual(expect.stringMatching(/^usuarios\|admin@teste\.local\|aprovou o acesso\|Bia Teste/));
    expect(txt).toContainEqual(expect.stringMatching(/^financeiro\|.*\|alterou os ajustes do caixa\|.*R\$ 100,00/));
    expect(h.some((x) => x.area === 'ligas' && x.alvo === 'Relâmpago Teste')).toBe(true);
    // mais recente primeiro
    expect(new Date(h[0].em) >= new Date(h[h.length - 1].em)).toBe(true);
  });

  it('agrupa a mesma ação repetida em poucos minutos', async () => {
    await dono('select public.fin_salvar_config(100, 0) as r');
    await dono('select public.fin_salvar_config(200, 0) as r');
    await dono('select public.fin_salvar_config(300, 0) as r');
    const f = (await hist('financeiro')).filter((x) => x.acao === 'alterou os ajustes do caixa');
    expect(f).toHaveLength(1);
    expect(f[0].vezes).toBe(3);
  });

  it('visitas: registra quem abriu o app, uma vez a cada 30 minutos', async () => {
    await atletaAprovado();
    await sub('select public.registrar_visita() as r');
    await sub('select public.registrar_visita() as r');
    const v = await hist('visita');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ quem: 'Bia Teste', acao: 'abriu o app', vezes: 2 });
    // quem não foi aprovado não registra nada
    await expect(outro('select public.registrar_visita() as r')).rejects.toThrow(/acesso_negado/);
  });

  it('só o dono vê o histórico geral; o financeiro exige "Financeiro: ver"', async () => {
    const a = await atletaAprovado();
    await dono('select public.fin_salvar_config(100, 0) as r');
    await expect(sub('select public.historico_app() as r')).rejects.toThrow(/acesso_negado/);
    await expect(sub('select public.historico_financeiro() as r')).rejects.toThrow(/acesso_negado/);
    await dono(`select public.definir_admin($1, true, '{financeiro_ver}') as r`, [SUB]);
    const f = await sub('select public.historico_financeiro() as r');
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.area === 'financeiro')).toBe(true);
    await expect(sub('select public.historico_app() as r')).rejects.toThrow(/sem_permissao|acesso_negado/);
    await expect(como('authenticated', SUB, () => db.query('select * from public.historico'))).rejects.toThrow(/permission denied/);
    await expect(como('anon', null, () => db.query('select public.historico_app()'))).rejects.toThrow(/permission denied|acesso_negado/);
    expect(a).toBeTruthy();
  });
});

describe('minha situação na próxima liga', () => {
  it('diz se o atleta está inscrito e se pagou', async () => {
    const a = await atletaAprovado();
    const outroAtl = (await dono(`select public.salvar_atleta(null, null, 'Caio Teste') as r`)).id;
    const id = await ligaCom([a, outroAtl], ['Bia Teste', 'Caio Teste']);
    let s = await sub('select public.minha_situacao($1) as r', [id]);
    expect(s).toMatchObject({ atleta_id: a, inscrito: true, cobranca: false, pagamento: null });
    await dono('select public.fin_cobrar_rodada($1, true) as r', [id]);
    s = await sub('select public.minha_situacao($1) as r', [id]);
    expect(s).toMatchObject({ inscrito: true, cobranca: true, pagamento: 'pendente' });
    await dono(`select public.fin_marcar_inscricao($1, $2, 'pago') as r`, [id, a]);
    s = await sub('select public.minha_situacao($1) as r', [id]);
    expect(s.pagamento).toBe('pago');
    // não inscrito
    const id2 = await ligaCom([outroAtl], ['Caio Teste'], '2026-12-12');
    s = await sub('select public.minha_situacao($1) as r', [id2]);
    expect(s).toMatchObject({ inscrito: false, pagamento: null });
    // sem liga: só devolve o atleta ligado
    s = await sub('select public.minha_situacao(null) as r');
    expect(s).toMatchObject({ atleta_id: a, inscrito: false });
    // quem não foi aprovado não consulta
    await expect(outro('select public.minha_situacao(null) as r')).rejects.toThrow(/acesso_negado/);
  });
});

describe('atletas que são administradores', () => {
  it('lista os atletas ligados a contas de administrador (só para administradores)', async () => {
    const a = await atletaAprovado();
    expect(await dono('select public.atletas_admins() as r')).toEqual([]);
    await dono(`select public.definir_admin($1, true, '{ligas}') as r`, [SUB]);
    expect(await dono('select public.atletas_admins() as r')).toEqual([a]);
    await expect(outro('select public.atletas_admins() as r')).rejects.toThrow(/acesso_negado|sem_permissao/);
  });
});
