import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const sub = (sql, p = []) => como('authenticated', SUB, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const resumo = () => dono('select public.fin_resumo() as r');
// fin_lancar(id, tipo, categoria, descricao, valor, data, liga, temporada, pago)
const lancar = (tipo, valor, pago) =>
  dono(`select public.fin_lancar(null, $1, 'Quadra', null, $2, '2026-12-01', null, null, $3) as r`, [tipo, valor, pago]).then((r) => r.id);

describe('lançamentos pagos e a pagar', () => {
  it('despesa a pagar não mexe no caixa; ao pagar, sai do caixa', async () => {
    await dono('select public.fin_salvar_config(10000, 0) as r'); // caixa R$ 100
    const id = await lancar('saida', 3000, false);
    let r = await resumo();
    expect(r.totais).toMatchObject({ caixa: 10000, a_pagar: 3000, saldo_futuro: 7000, saidas: 0 });
    expect(r.lancamentos[0]).toMatchObject({ id, pago: false, pago_em: null });
    await dono(`select public.fin_baixar_lancamento($1, true, '2026-12-03') as r`, [id]);
    r = await resumo();
    expect(r.totais).toMatchObject({ caixa: 7000, a_pagar: 0, saldo_futuro: 7000, saidas: 3000 });
    expect(r.lancamentos[0]).toMatchObject({ pago: true, pago_em: '2026-12-03' });
    // desfazer o pagamento volta para a pagar
    await dono('select public.fin_baixar_lancamento($1, false) as r', [id]);
    expect((await resumo()).totais).toMatchObject({ caixa: 10000, a_pagar: 3000 });
  });

  it('entrada a receber entra só no saldo futuro até ser recebida', async () => {
    const id = await lancar('entrada', 5000, false);
    let t = (await resumo()).totais;
    expect(t).toMatchObject({ caixa: 0, entradas_a_receber: 5000, saldo_futuro: 5000, entradas: 0 });
    await dono('select public.fin_baixar_lancamento($1, true) as r', [id]);
    t = (await resumo()).totais;
    expect(t).toMatchObject({ caixa: 5000, entradas_a_receber: 0, saldo_futuro: 5000, entradas: 5000 });
  });

  it('sem dizer a situação, o lançamento vale como pago (como antes); editar sem situação mantém', async () => {
    const id = await lancar('saida', 1000, null);
    expect((await resumo()).totais).toMatchObject({ caixa: -1000, a_pagar: 0 });
    await dono(`select public.fin_lancar($1, 'saida', 'Bar', null, 2000, '2026-12-01') as r`, [id]);
    expect((await resumo()).totais).toMatchObject({ caixa: -2000, a_pagar: 0 });
    await dono(`select public.fin_lancar($1, 'saida', 'Bar', null, 2000, '2026-12-01', null, null, false) as r`, [id]);
    expect((await resumo()).totais).toMatchObject({ caixa: 0, a_pagar: 2000 });
  });

  it('pagamento de prêmio já nasce pago e não aceita baixa; baixa exige "Financeiro: lançar"', async () => {
    const tid = crypto.randomUUID();
    await dono(`select public.criar_temporada($1, 'Temporada Fin', '2026-01-01', '{}'::jsonb) as r`, [tid]);
    const pr = (await dono(`select public.fin_salvar_premio(null, null, $1, 1, 'campeão', 2000) as r`, [tid])).id;
    const pg = (await dono('select public.fin_pagar_premio($1) as r', [pr])).lancamento_id;
    const r = await resumo();
    expect(r.lancamentos.find((x) => x.id === pg)).toMatchObject({ pago: true });
    expect(r.totais).toMatchObject({ caixa: -2000, a_pagar: 0 });
    await expect(dono('select public.fin_baixar_lancamento($1, false) as r', [pg])).rejects.toThrow(/lancamento_de_premio/);
    const id = await lancar('saida', 1000, false);
    await expect(sub('select public.fin_baixar_lancamento($1, true) as r', [id])).rejects.toThrow(/acesso_negado/);
    await expect(dono('select public.fin_baixar_lancamento(gen_random_uuid(), true) as r')).rejects.toThrow(/lancamento_nao_encontrado/);
  });
});
