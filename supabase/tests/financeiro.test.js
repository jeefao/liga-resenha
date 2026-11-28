import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const sub = (sql, p = []) => como('authenticated', SUB, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const resumo = () => dono('select public.fin_resumo() as r');

// uma liga relâmpago com 4 atletas (2 do cadastro, 2 só pelo nome)
async function ligaCom4() {
  const a1 = (await dono(`select public.salvar_atleta(null, null, 'Ana Cadastro') as r`)).id;
  const a2 = (await dono(`select public.salvar_atleta(null, null, 'Bia Cadastro') as r`)).id;
  const id = crypto.randomUUID();
  const dados = { names: ['Ana Cadastro', 'Bia Cadastro', 'Caio Nome', 'Duda Nome', ...Array(12).fill('')], ids: [a1, a2, ...Array(14).fill(null)], scores: {}, finals: {}, breaks: {} };
  await dono(`select public.criar_liga($1, 'Relâmpago Dez', '2026-12-05', $2) as r`, [id, JSON.stringify(dados)]);
  return { id, a1, a2 };
}

async function tornarAdmin(perms) {
  const a = (await dono(`select public.salvar_atleta(null, null, 'Membro Fin') as r`)).id;
  await sub(`select public.solicitar_acesso('Membro Fin') as r`);
  await dono(`select public.definir_acesso($1, 'aprovado', $2) as r`, [SUB, a]);
  await dono(`select public.definir_admin($1, true, $2) as r`, [SUB, perms]);
}

describe('finanças', () => {
  it('caixa, a receber, isento e saldo futuro previsto', async () => {
    const { id, a1, a2 } = await ligaCom4();
    await dono('select public.fin_salvar_config(10000, 5000) as r'); // saldo inicial R$ 100, inscrição R$ 50
    await dono('select public.fin_cobrar_rodada($1, true) as r', [id]);
    let r = await resumo();
    expect(r.rodadas).toHaveLength(1);
    expect(r.rodadas[0].inscritos.map((i) => i.status)).toEqual(['pendente', 'pendente', 'pendente', 'pendente']);
    expect(r.totais).toMatchObject({ caixa: 10000, a_receber: 20000, premiacao_prevista: 0, saldo_futuro: 10000 });
    expect(r.ligas_sem_cobranca).toHaveLength(0);

    await dono(`select public.fin_marcar_inscricao($1, $2, 'pago') as r`, [id, a1]);
    await dono(`select public.fin_marcar_inscricao($1, $2, 'isento') as r`, [id, a2]);
    await dono(`select public.fin_marcar_inscricao($1, 'nome:caio nome', 'pago', 4000) as r`, [id]); // pagou com desconto
    await dono(`select public.fin_lancar(null, 'saida', 'Quadra', 'aluguel', 6000, '2026-12-05', $1) as r`, [id]);
    await dono(`select public.fin_lancar(null, 'saida', 'Registro do site', 'domínio', 4000, '2026-11-27') as r`);
    await dono(`select public.fin_salvar_premio(null, $1, null, 1, 'dupla campeã', 3000) as r`, [id]);
    r = await resumo();
    const rod = r.rodadas[0];
    expect(rod.inscritos.find((i) => i.chave === a2)).toMatchObject({ status: 'isento', valor_centavos: 0 });
    expect(rod).toMatchObject({ recebido: 9000, a_receber: 5000, saidas: 6000, premiacao_prevista: 3000 });
    // caixa = 100 + 90 (inscrições) − 60 (quadra) − 40 (site) = 90
    expect(r.totais).toMatchObject({ inscricoes_recebidas: 9000, saidas: 10000, caixa: 9000, a_receber: 5000, premiacao_prevista: 3000, saldo_futuro: 6000 });

    // pagar o prêmio: sai do previsto e vira saída; excluir o pagamento volta ao previsto
    const pid = r.premios[0].id;
    await dono('select public.fin_pagar_premio($1) as r', [pid]);
    r = await resumo();
    expect(r.totais).toMatchObject({ caixa: 6000, premiacao_prevista: 0, saldo_futuro: 6000 });
    const lanc = r.lancamentos.find((x) => x.premio_id === pid);
    expect(lanc).toMatchObject({ categoria: 'Prêmios', valor_centavos: 3000 });
    await dono('select public.fin_excluir_lancamento($1) as r', [lanc.id]);
    r = await resumo();
    expect(r.totais).toMatchObject({ caixa: 9000, premiacao_prevista: 3000 });
    expect(r.premios[0].pago).toBe(false);
  });

  it('valor da temporada e valor próprio da rodada', async () => {
    await dono('select public.fin_salvar_config(0, 5000) as r');
    const t = crypto.randomUUID();
    await dono(`select public.criar_temporada($1, 'T4', '2027-01-01', '{}') as r`, [t]);
    await dono('select public.fin_salvar_valor_temporada($1, 7000) as r', [t]);
    const e = crypto.randomUUID();
    await dono(`select public.criar_etapa($1, 1, $2, 'T4 — Etapa 1', '2027-01-10', $3) as r`,
      [t, e, JSON.stringify({ names: ['A Um', 'B Dois', ...Array(14).fill('')], ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} })]);
    await dono('select public.fin_cobrar_rodada($1, true) as r', [e]);
    expect((await resumo()).rodadas[0]).toMatchObject({ valor_centavos: 7000, a_receber: 14000, temporada_nome: 'T4' });
    await dono('select public.fin_cobrar_rodada($1, true, 6000) as r', [e]);
    expect((await resumo()).rodadas[0]).toMatchObject({ valor_centavos: 6000, valor_proprio: 6000 });
    await dono(`select public.fin_salvar_premio(null, null, $1, 1, 'campeão da temporada', 50000) as r`, [t]);
    expect((await resumo()).totais.premiacao_prevista).toBe(50000);
  });

  it('não desliga cobrança com pagamentos e não aceita valores inválidos', async () => {
    const { id, a1 } = await ligaCom4();
    await dono('select public.fin_cobrar_rodada($1, true) as r', [id]);
    await dono(`select public.fin_marcar_inscricao($1, $2, 'pago', 1000) as r`, [id, a1]);
    await expect(dono('select public.fin_cobrar_rodada($1, false) as r', [id])).rejects.toThrow(/rodada_com_pagamentos/);
    await expect(dono(`select public.fin_marcar_inscricao($1, 'nome:ninguem', 'pago') as r`, [id])).rejects.toThrow(/atleta_nao_inscrito/);
    await expect(dono(`select public.fin_lancar(null, 'saida', 'Bar', null, 0, null) as r`)).rejects.toThrow(/valor_invalido/);
    await expect(dono(`select public.fin_lancar(null, 'saida', '', null, 100, null) as r`)).rejects.toThrow(/categoria_invalida/);
    // apagar a liga de vez não apaga o dinheiro que entrou
    await dono('select public.mover_para_lixeira($1) as r', [id]);
    await dono('select public.excluir_definitivamente($1) as r', [id]);
    const r = await resumo();
    expect(r.totais.inscricoes_recebidas).toBe(1000);
    expect(r.rodadas[0]).toMatchObject({ apagada: true, nome: 'Relâmpago Dez', recebido: 1000 });
  });

  it('permissões: ver não grava; sem permissão não lê; ninguém acessa as tabelas', async () => {
    await tornarAdmin(['financeiro_ver']);
    expect((await sub('select public.fin_resumo() as r')).totais.caixa).toBe(0);
    await expect(sub('select public.fin_salvar_config(1, 1) as r')).rejects.toThrow(/sem_permissao/);
    await dono('select public.definir_admin($1, true, $2) as r', [SUB, ['ligas']]);
    await expect(sub('select public.fin_resumo() as r')).rejects.toThrow(/sem_permissao/);
    await dono('select public.definir_admin($1, true, $2) as r', [SUB, ['financeiro_lancar']]);
    expect((await sub(`select public.fin_lancar(null, 'entrada', 'Patrocínio', null, 2500, null) as r`)).ok).toBe(true);
    await expect(como('authenticated', OUTRO, () => db.query('select public.fin_resumo()'))).rejects.toThrow(/acesso_negado/);
    await expect(como('anon', null, () => db.query('select public.fin_resumo()'))).rejects.toThrow(/permission denied/);
    for (const t of ['fin_config', 'fin_lancamentos', 'fin_inscricoes', 'fin_premios']) {
      await expect(como('authenticated', SUB, () => db.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});
