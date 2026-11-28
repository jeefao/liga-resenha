import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, ADMIN, OUTRO, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const anon = (sql, p = []) => como('anon', null, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const senhaDe = async (id) => (await db.query('select encrypted_password as r from auth.users where id = $1', [id])).rows[0].r;

describe('pedido de nova senha', () => {
  it('atleta pede sem login, o dono aprova e a senha nova passa a valer', async () => {
    await como('authenticated', SUB, () => db.query(`select public.solicitar_acesso('Atleta Teste')`));
    expect(await anon(`select public.pedir_nova_senha('SUB@teste.local', 'nova123') as r`)).toEqual({ ok: true });
    const lista = await dono('select public.listar_acessos() as r');
    expect(lista.find((a) => a.user_id === SUB).pedido_senha_em).toBeTruthy();
    expect(await senhaDe(SUB)).toBeNull(); // ainda não mudou
    await dono('select public.responder_pedido_senha($1, true) as r', [SUB]);
    expect(await senhaDe(SUB)).toBe('hash(nova123)');
    expect((await dono('select public.listar_acessos() as r')).find((a) => a.user_id === SUB).pedido_senha_em).toBeNull();
  });

  it('recusar apaga o pedido sem trocar a senha', async () => {
    await como('authenticated', SUB, () => db.query(`select public.solicitar_acesso('Atleta Teste')`));
    await anon(`select public.pedir_nova_senha('sub@teste.local', 'nova123') as r`);
    await dono('select public.responder_pedido_senha($1, false) as r', [SUB]);
    expect(await senhaDe(SUB)).toBeNull();
    await expect(dono('select public.responder_pedido_senha($1, true) as r', [SUB])).rejects.toThrow(/pedido_nao_encontrado/);
  });

  it('não revela contas: e-mail desconhecido e conta do dono respondem igual e não criam pedido', async () => {
    expect(await anon(`select public.pedir_nova_senha('ninguem@teste.local', 'nova123') as r`)).toEqual({ ok: true });
    expect(await anon(`select public.pedir_nova_senha('admin@teste.local', 'nova123') as r`)).toEqual({ ok: true });
    expect((await db.query('select count(*)::int as n from public.pedidos_senha')).rows[0].n).toBe(0);
    await expect(anon(`select public.pedir_nova_senha('sub@teste.local', '123') as r`)).rejects.toThrow(/senha_curta/);
    await expect(anon(`select public.pedir_nova_senha('sem-arroba', 'nova123') as r`)).rejects.toThrow(/email_invalido/);
  });

  it('só o dono responde; ninguém lê a tabela de pedidos', async () => {
    await como('authenticated', SUB, () => db.query(`select public.solicitar_acesso('Atleta Teste')`));
    await anon(`select public.pedir_nova_senha('sub@teste.local', 'nova123') as r`);
    await expect(como('authenticated', OUTRO, () => db.query('select public.responder_pedido_senha($1, true)', [SUB]))).rejects.toThrow(/acesso_negado/);
    await expect(como('anon', null, () => db.query('select public.responder_pedido_senha($1, true)', [SUB]))).rejects.toThrow(/permission denied/);
    await expect(como('anon', null, () => db.query('select * from public.pedidos_senha'))).rejects.toThrow(/permission denied/);
    await expect(como('authenticated', SUB, () => db.query('select * from public.pedidos_senha'))).rejects.toThrow(/permission denied/);
    expect(ADMIN).toBeTruthy();
  });
});
