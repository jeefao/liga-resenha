import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco } from './ambiente.js';

let db, admin;
beforeEach(async () => ({ db, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const resumo = () => dono('select public.fin_resumo() as r');

async function ligaCobrada(nome = 'Ana Cadastro') {
  const a1 = (await dono(`select public.salvar_atleta(null, null, $1) as r`, [nome])).id;
  const id = crypto.randomUUID();
  const dados = { names: [nome, 'Caio Nome', ...Array(14).fill('')], ids: [a1, ...Array(15).fill(null)], scores: {}, finals: {}, breaks: {} };
  await dono(`select public.criar_liga($1, 'Relâmpago Teste', '2026-12-05', $2) as r`, [id, JSON.stringify(dados)]);
  await dono('select public.fin_cobrar_rodada($1, true) as r', [id]);
  return { id, a1 };
}
const apagarDeVez = async (id) => {
  await dono('select public.mover_para_lixeira($1) as r', [id]);
  await dono('select public.excluir_definitivamente($1) as r', [id]);
};

describe('rodada de liga apagada no Finanças', () => {
  it('sem dinheiro (só isento e lançamentos excluídos): some junto com a liga', async () => {
    const { id, a1 } = await ligaCobrada();
    await dono(`select public.fin_marcar_inscricao($1, $2, 'isento') as r`, [id, a1]);
    const l = (await dono(`select public.fin_lancar(null, 'saida', 'Quadra', null, 5000, '2026-12-05', $1) as r`, [id])).id;
    await dono('select public.fin_excluir_lancamento($1) as r', [l]);
    await apagarDeVez(id);
    const r = await resumo();
    expect(r.rodadas).toHaveLength(0);
  });

  it('com inscrição paga ou lançamento ativo: continua, marcada como apagada', async () => {
    const { id, a1 } = await ligaCobrada();
    await dono(`select public.fin_marcar_inscricao($1, $2, 'pago', 5000) as r`, [id, a1]);
    await apagarDeVez(id);
    let r = await resumo();
    expect(r.rodadas).toHaveLength(1);
    expect(r.rodadas[0]).toMatchObject({ apagada: true, recebido: 5000 });

    const b = await ligaCobrada('Bia Cadastro');
    await dono(`select public.fin_lancar(null, 'saida', 'Quadra', null, 5000, '2026-12-05', $1) as r`, [b.id]);
    await apagarDeVez(b.id);
    r = await resumo();
    expect(r.rodadas.map((x) => x.liga_id)).toContain(b.id);
  });
});
