// Ambiente de teste: PostgreSQL em memória (PGlite) simulando o Supabase.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN = '00000000-0000-4000-a000-0000000000aa';
export const OUTRO = '00000000-0000-4000-a000-0000000000bb';
export const SUB = '00000000-0000-4000-a000-0000000000cc';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, encrypted_password text, updated_at timestamptz, last_sign_in_at timestamptz);
  create schema extensions;
  create function extensions.gen_salt(text) returns text language sql as $$ select 'sal-' || $1 $$;
  create function extensions.crypt(text, text) returns text language sql as $$ select 'hash(' || $1 || ')' $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif((nullif(current_setting('request.jwt.claims', true), '')::json)->>'sub', '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
`;

export async function criarBanco() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  await db.exec(`insert into auth.users (id, email) values
    ('${ADMIN}', 'admin@teste.local'), ('${OUTRO}', 'outro@teste.local'), ('${SUB}', 'sub@teste.local');
    insert into public.admins (user_id, dono) values ('${ADMIN}', true);`);
  const como = async (papel, uid, fn) => {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${papel}`);
      if (uid) await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);
      const r = await fn();
      await db.exec('commit');
      return r;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  };
  return { db, como, admin: (fn) => como('authenticated', ADMIN, fn) };
}
