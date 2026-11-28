import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, ADMIN, OUTRO } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const um = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0].r);
const atleta = (sql, p = []) => como('authenticated', OUTRO, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const anon = (sql, p = []) => como('anon', null, () => db.query(sql, p));

async function pedidoAprovado() {
  const a = (await um(`select public.salvar_atleta(null, null, 'Bia Teste') as r`)).id;
  await atleta(`select public.solicitar_acesso('  Bia   Teste ') as r`);
  await um(`select public.definir_acesso($1, 'aprovado', $2) as r`, [OUTRO, a]);
  return a;
}

describe('acessos dos atletas', () => {
  it('sem pedido, o atleta logado não vê a consulta', async () => {
    expect(await atleta('select public.meu_acesso() as r')).toEqual({ logado: true, admin: false, status: null });
    await expect(atleta('select public.consulta_publica() as r')).rejects.toThrow(/acesso_negado/);
  });

  it('quem não está logado não vê a consulta nem a lista', async () => {
    await expect(anon('select public.consulta_publica()')).rejects.toThrow(/permission denied/);
    await expect(anon('select public.listar_acessos()')).rejects.toThrow(/permission denied/);
    await expect(anon('select public._consulta_dados()')).rejects.toThrow(/permission denied/);
  });

  it('pedido fica pendente e o administrador vê na lista', async () => {
    const r = await atleta(`select public.solicitar_acesso('  Bia   Teste ') as r`);
    expect(r).toEqual({ logado: true, admin: false, status: 'pendente', nome: 'Bia Teste' });
    await expect(atleta('select public.consulta_publica() as r')).rejects.toThrow(/acesso_negado/);
    const l = await um('select public.listar_acessos() as r');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ user_id: OUTRO, email: 'outro@teste.local', nome_informado: 'Bia Teste', status: 'pendente', atleta_id: null });
  });

  it('aprovar exige atleta do cadastro; aprovado vê a consulta com o nome do cadastro', async () => {
    await atleta(`select public.solicitar_acesso('Bia') as r`);
    await expect(um(`select public.definir_acesso($1, 'aprovado') as r`, [OUTRO])).rejects.toThrow(/escolha_o_atleta/);
    const a = (await um(`select public.salvar_atleta(null, null, 'Beatriz Teste') as r`)).id;
    await um(`select public.definir_acesso($1, 'aprovado', $2) as r`, [OUTRO, a]);
    expect(await atleta('select public.meu_acesso() as r')).toEqual({ logado: true, admin: false, status: 'aprovado', nome: 'Beatriz Teste' });
    expect(await atleta('select public.consulta_publica() as r')).toMatchObject({ temporadas: [], relampagos: [] });
    expect((await um('select public.listar_acessos() as r'))[0]).toMatchObject({ atleta_nome: 'Beatriz Teste', status: 'aprovado' });
  });

  it('bloqueado perde o acesso e não pode pedir de novo; desbloquear devolve', async () => {
    await pedidoAprovado();
    await um(`select public.definir_acesso($1, 'bloqueado') as r`, [OUTRO]);
    await expect(atleta('select public.consulta_publica() as r')).rejects.toThrow(/acesso_negado/);
    await expect(atleta(`select public.solicitar_acesso('Bia de novo') as r`)).rejects.toThrow(/pedido_ja_analisado/);
    await um(`select public.definir_acesso($1, 'aprovado') as r`, [OUTRO]);
    expect(await atleta('select public.consulta_publica() as r')).toBeTruthy();
  });

  it('recusado pode pedir de novo', async () => {
    await atleta(`select public.solicitar_acesso('Bia') as r`);
    await um(`select public.definir_acesso($1, 'recusado') as r`, [OUTRO]);
    expect((await atleta(`select public.solicitar_acesso('Bia Teste') as r`)).status).toBe('pendente');
  });

  it('atleta não usa as funções do administrador nem lê as tabelas', async () => {
    await pedidoAprovado();
    await expect(atleta('select public.listar_acessos() as r')).rejects.toThrow(/sem_permissao/);
    await expect(atleta(`select public.definir_acesso($1, 'aprovado') as r`, [OUTRO])).rejects.toThrow(/sem_permissao/);
    await expect(atleta(`select public.trocar_senha_acesso($1, '123456') as r`, [OUTRO])).rejects.toThrow(/sem_permissao/);
    await expect(atleta(`select public.excluir_acesso($1) as r`, [OUTRO])).rejects.toThrow(/sem_permissao/);
    await expect(atleta('select * from public.acessos')).rejects.toThrow(/permission denied/);
    expect(await atleta('select count(*)::int as r from public.ligas')).toBe(0);
    expect(await atleta('select count(*)::int as r from public.atletas')).toBe(0);
    await expect(atleta(`select public.salvar_atleta(null, null, 'Invasor') as r`)).rejects.toThrow();
  });

  it('administrador troca a senha (só o hash muda) e não mexe em conta de administrador', async () => {
    await pedidoAprovado();
    await expect(um(`select public.trocar_senha_acesso($1, '123') as r`, [OUTRO])).rejects.toThrow(/senha_curta/);
    await um(`select public.trocar_senha_acesso($1, 'nova123') as r`, [OUTRO]);
    expect((await db.query('select encrypted_password from auth.users where id = $1', [OUTRO])).rows[0].encrypted_password).toBe('hash(nova123)');
    await expect(um(`select public.trocar_senha_acesso($1, 'nova123') as r`, [ADMIN])).rejects.toThrow(/conta_de_administrador/);
    expect(JSON.stringify(await um('select public.listar_acessos() as r'))).not.toContain('hash(');
  });

  it('excluir apaga a conta de login, mas o atleta do cadastro continua', async () => {
    const a = await pedidoAprovado();
    await um(`select public.excluir_acesso($1) as r`, [OUTRO]);
    expect((await db.query('select count(*)::int as n from auth.users where id = $1', [OUTRO])).rows[0].n).toBe(0);
    expect(await um('select public.listar_acessos() as r')).toEqual([]);
    expect((await db.query('select count(*)::int as n from public.atletas where id = $1', [a])).rows[0].n).toBe(1);
    await expect(um(`select public.excluir_acesso($1) as r`, [ADMIN])).rejects.toThrow(/conta_de_administrador/);
  });

  it('administrador vê a consulta sem pedido', async () => {
    expect(await um('select public.meu_acesso() as r')).toEqual({ logado: true, admin: true, status: 'aprovado' });
    expect(await um('select public.consulta_publica() as r')).toMatchObject({ temporadas: [] });
  });
});
