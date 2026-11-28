import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const sub = (sql, p = []) => como('authenticated', SUB, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const outro = (sql, p = []) => como('authenticated', OUTRO, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const anon = (sql, p = []) => como('anon', null, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);

async function preparar() {
  const a = (await dono(`select public.salvar_atleta(null, null, 'Bia Teste') as r`)).id;
  await sub(`select public.solicitar_acesso('Bia Teste') as r`);
  await dono(`select public.definir_acesso($1, 'aprovado', $2) as r`, [SUB, a]);
  const id = crypto.randomUUID();
  const nomes = ['Bia Teste', 'Caio Nome', 'Ana Nome'];
  const dados = { names: [...nomes, ...Array(13).fill('')], ids: [a, ...Array(15).fill(null)], scores: {}, finals: {}, breaks: {} };
  await dono(`select public.criar_liga($1, 'Relâmpago Teste', '2026-12-05', $2) as r`, [id, JSON.stringify(dados)]);
  return { a, id };
}
const st = (r) => Object.fromEntries(r.inscritos.map((i) => [i.posicao + ' ' + i.nome, i.status]));

describe('situação dos pagamentos da liga (tags Pago / Falta pagamento)', () => {
  it('sem cobrança: só avisa que não cobra', async () => {
    const { id } = await preparar();
    expect(await sub('select public.situacao_pagamentos($1) as r', [id])).toEqual({ cobranca: false, inscritos: [] });
  });

  it('com cobrança: pago, isento e pendente por posição, sem valores', async () => {
    const { a, id } = await preparar();
    await dono('select public.fin_cobrar_rodada($1, true) as r', [id]);
    await dono(`select public.fin_marcar_inscricao($1, $2, 'pago', 5000) as r`, [id, a]);
    await dono(`select public.fin_marcar_inscricao($1, 'nome:ana nome', 'isento') as r`, [id]);
    const r = await sub('select public.situacao_pagamentos($1) as r', [id]);
    expect(r.cobranca).toBe(true);
    expect(st(r)).toEqual({ '1 Bia Teste': 'pago', '2 Caio Nome': 'pendente', '3 Ana Nome': 'isento' });
    expect(JSON.stringify(r)).not.toMatch(/valor|5000/);
    expect(await dono('select public.situacao_pagamentos($1) as r', [id])).toEqual(r);
  });

  it('só administradores e atletas aprovados; liga na lixeira não aparece para atleta', async () => {
    const { id } = await preparar();
    await expect(outro('select public.situacao_pagamentos($1) as r', [id])).rejects.toThrow(/acesso_negado/);
    await expect(anon('select public.situacao_pagamentos($1) as r', [id])).rejects.toThrow(/permission denied|acesso_negado/);
    await dono('select public.mover_para_lixeira($1) as r', [id]);
    expect(await sub('select public.situacao_pagamentos($1) as r', [id])).toEqual({ cobranca: false, inscritos: [] });
  });
});
