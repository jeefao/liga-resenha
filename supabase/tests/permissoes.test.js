import { beforeEach, describe, expect, it } from 'vitest';
import { criarBanco, ADMIN, SUB } from './ambiente.js';

let db, como, admin;
beforeEach(async () => ({ db, como, admin } = await criarBanco()));

const dono = (sql, p = []) => admin(() => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const sub = (sql, p = []) => como('authenticated', SUB, () => db.query(sql, p)).then((x) => x.rows[0] && x.rows[0].r);
const dadosLiga = () => JSON.stringify({ names: Array(16).fill(''), ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} });

// o membro cria conta, o dono aprova (ligado a um atleta) e marca as permissões
async function tornarAdmin(perms) {
  const a = (await dono(`select public.salvar_atleta(null, null, 'Membro Teste') as r`)).id;
  await sub(`select public.solicitar_acesso('Membro Teste') as r`);
  await dono(`select public.definir_acesso($1, 'aprovado', $2) as r`, [SUB, a]);
  await dono(`select public.definir_admin($1, true, $2) as r`, [SUB, perms]);
  return a;
}

describe('permissões dos administradores', () => {
  it('o dono tem todas as permissões', async () => {
    expect(await dono('select public.meu_acesso() as r')).toEqual({
      logado: true, admin: true, status: 'aprovado', dono: true,
      permissoes: ['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar'],
    });
  });

  it('administrador só com "ligas": cria ligas, mas não mexe em atletas, temporadas nem apaga de vez', async () => {
    await tornarAdmin(['ligas']);
    expect(await sub('select public.meu_acesso() as r')).toEqual({ logado: true, admin: true, status: 'aprovado', dono: false, permissoes: ['ligas'], nome: 'Membro Teste' });
    const id = crypto.randomUUID();
    expect((await sub(`select public.criar_liga($1, 'Liga do Membro', '2027-01-01', $2) as r`, [id, dadosLiga()])).id).toBe(id);
    expect(await sub('select count(*)::int as r from public.atletas')).toBe(1);
    expect((await sub(`select public.garantir_atletas(array['Novo Inscrito']) as r`))[0].nome).toBe('Novo Inscrito');
    await expect(sub(`select public.salvar_atleta(null, null, 'Outro') as r`)).rejects.toThrow(/sem_permissao/);
    await expect(sub(`select public.criar_temporada($1, 'T', '2027-01-01', '{}') as r`, [crypto.randomUUID()])).rejects.toThrow(/sem_permissao/);
    await sub('select public.mover_para_lixeira($1) as r', [id]);
    await expect(sub('select public.excluir_definitivamente($1) as r', [id])).rejects.toThrow(/sem_permissao/);
    await expect(sub('select public.esvaziar_lixeira() as r')).rejects.toThrow(/sem_permissao/);
  });

  it('administrador com "temporadas" e "atletas" não cria liga', async () => {
    await tornarAdmin(['temporadas', 'atletas']);
    await expect(sub(`select public.criar_liga($1, 'X', '2027-01-01', $2) as r`, [crypto.randomUUID(), dadosLiga()])).rejects.toThrow(/sem_permissao/);
    expect((await sub(`select public.salvar_atleta(null, null, 'Pelo Membro') as r`)).nome).toBe('Pelo Membro');
    const t = crypto.randomUUID();
    expect((await sub(`select public.criar_temporada($1, 'Temporada do Membro', '2027-01-01', '{}') as r`, [t])).id).toBe(t);
  });

  it('só o dono usa a aba Usuários', async () => {
    await tornarAdmin(['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar']);
    for (const sql of ['select public.listar_acessos() as r', `select public.definir_acesso('${ADMIN}', 'bloqueado') as r`,
      `select public.trocar_senha_acesso('${SUB}', '123456') as r`, `select public.excluir_acesso('${SUB}') as r`,
      `select public.definir_admin('${SUB}', true, array['ligas']) as r`]) {
      await expect(sub(sql)).rejects.toThrow(/sem_permissao/);
    }
  });

  it('o dono vê o papel na lista, troca a senha do administrador e não mexe na própria conta', async () => {
    await tornarAdmin(['ligas']);
    expect((await dono('select public.listar_acessos() as r'))[0]).toMatchObject({ user_id: SUB, admin: true, dono: false, permissoes: ['ligas'] });
    await dono(`select public.trocar_senha_acesso($1, 'nova123') as r`, [SUB]);
    expect((await db.query('select encrypted_password from auth.users where id = $1', [SUB])).rows[0].encrypted_password).toBe('hash(nova123)');
    await expect(dono(`select public.definir_admin($1, false) as r`, [ADMIN])).rejects.toThrow(/conta_de_administrador|acesso_nao_encontrado/);
  });

  it('só vira administrador quem está aprovado; permissão desconhecida é recusada', async () => {
    await sub(`select public.solicitar_acesso('Membro Teste') as r`);
    await expect(dono(`select public.definir_admin($1, true, array['ligas']) as r`, [SUB])).rejects.toThrow(/aprove_antes/);
    const a = (await dono(`select public.salvar_atleta(null, null, 'Membro Teste') as r`)).id;
    await dono(`select public.definir_acesso($1, 'aprovado', $2) as r`, [SUB, a]);
    await expect(dono(`select public.definir_admin($1, true, array['tudo']) as r`, [SUB])).rejects.toThrow(/permissao_invalida/);
  });

  it('bloquear tira o papel de administrador; tirar o papel volta a ser atleta', async () => {
    await tornarAdmin(['ligas']);
    await dono(`select public.definir_admin($1, false) as r`, [SUB]);
    expect((await sub('select public.meu_acesso() as r')).admin).toBe(false);
    await dono(`select public.definir_admin($1, true, array['ligas']) as r`, [SUB]);
    await dono(`select public.definir_acesso($1, 'bloqueado') as r`, [SUB]);
    expect(await sub('select public.meu_acesso() as r')).toMatchObject({ admin: false, status: 'bloqueado' });
    await expect(sub(`select public.criar_liga($1, 'X', '2027-01-01', $2) as r`, [crypto.randomUUID(), dadosLiga()])).rejects.toThrow(/sem_permissao|acesso_negado/);
  });
});
