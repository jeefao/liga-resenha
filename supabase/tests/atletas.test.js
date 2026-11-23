import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, OUTRO } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const salvar = (id, versao, nome, extra = {}) =>
  admin(() =>
    db.query(`select public.salvar_atleta($1, $2, $3, $4, $5, $6) as r`, [
      id, versao, nome, extra.apelido ?? null, extra.situacao ?? 'membro', extra.observacoes ?? null,
    ])
  ).then((x) => x.rows[0].r);

describe('cadastro de atletas', () => {
  it('cria atleta com versão 1 e histórico, limpando espaços', async () => {
    const r = await salvar(null, null, '  Paulo   Moreno ', { apelido: ' PM ' });
    expect(r).toMatchObject({ ok: true, nome: 'Paulo Moreno', apelido: 'PM', situacao: 'membro', versao: 1 });
    const h = await admin(() => db.query('select versao from public.atletas_historico'));
    expect(h.rows).toEqual([{ versao: 1 }]);
  });

  it('não permite nome repetido (ignora maiúsculas e espaços)', async () => {
    await salvar(null, null, 'Hugo');
    await expect(salvar(null, null, ' hugo ')).rejects.toThrow(/atleta_ja_existe/);
  });

  it('altera com controle de versão e detecta conflito', async () => {
    const a = await salvar(null, null, 'Victor');
    const b = await salvar(a.id, 1, 'Victor F.', { situacao: 'convidado' });
    expect(b).toMatchObject({ ok: true, versao: 2, nome: 'Victor F.', situacao: 'convidado' });
    const c = await salvar(a.id, 1, 'Outro nome');
    expect(c).toMatchObject({ ok: false, conflito: true, versao_servidor: 2 });
    const h = await admin(() => db.query('select count(*)::int as n from public.atletas_historico'));
    expect(h.rows[0].n).toBe(2);
  });

  it('situação inválida é recusada', async () => {
    await expect(salvar(null, null, 'X', { situacao: 'banido' })).rejects.toThrow(/situacao_check/);
  });

  it('garantir_atletas devolve na mesma ordem e cria só os que faltam', async () => {
    const hugo = await salvar(null, null, 'Hugo');
    const r = await admin(() =>
      db.query(`select public.garantir_atletas($1, 'convidado') as r`, [['hugo', 'Novo Atleta', '', ' Hugo ']])
    );
    const lista = r.rows[0].r;
    expect(lista[0].id).toBe(hugo.id);
    expect(lista[1]).toMatchObject({ nome: 'Novo Atleta', situacao: 'convidado' });
    expect(lista[2]).toBeNull();
    expect(lista[3].id).toBe(hugo.id);
    const n = await admin(() => db.query('select count(*)::int as n from public.atletas'));
    expect(n.rows[0].n).toBe(2);
  });

  it('atleta nunca é apagado e histórico é imutável', async () => {
    await salvar(null, null, 'Caio');
    await expect(db.query('delete from public.atletas')).rejects.toThrow(/operacao_bloqueada/);
    await expect(db.query('delete from public.atletas_historico')).rejects.toThrow(/operacao_bloqueada/);
  });

  it('sem login ou sem ser admin não vê nem grava', async () => {
    await salvar(null, null, 'Caio');
    await expect(como('anon', null, () => db.query('select * from public.atletas'))).rejects.toThrow(/permission denied/);
    const r = await como('authenticated', OUTRO, () => db.query('select * from public.atletas'));
    expect(r.rows).toHaveLength(0);
    await expect(
      como('authenticated', OUTRO, () => db.query(`select public.salvar_atleta(null, null, 'X')`))
    ).rejects.toThrow(/acesso_negado/);
    await expect(admin(() => db.query(`update public.atletas set nome = 'X'`))).rejects.toThrow(/permission denied/);
  });
});
