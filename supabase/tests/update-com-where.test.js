// O Supabase (pg_safeupdate) recusa UPDATE/DELETE sem WHERE nas chamadas vindas do app:
// "UPDATE requires a WHERE clause". O banco de teste (PGlite) não tem essa trava,
// então este teste confere o texto das migrations. Funções já substituídas por uma
// migration mais nova ficam de fora (só vale a última versão de cada função).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PASTA = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function ultimasFuncoes() {
  const funcoes = new Map();
  for (const arq of readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(PASTA, arq), 'utf8');
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$/gi;
    for (const m of sql.matchAll(re)) funcoes.set(m[1].toLowerCase(), { arq, corpo: m[3] });
  }
  return funcoes;
}

describe('UPDATE e DELETE sempre com WHERE', () => {
  it('nenhuma função atual tem UPDATE/DELETE sem WHERE', () => {
    const problemas = [];
    for (const [nome, { arq, corpo }] of ultimasFuncoes()) {
      const semComentarios = corpo.replace(/--.*$/gm, '');
      for (const m of semComentarios.matchAll(/\b(update\s+[\w.]+\s+set|delete\s+from\s+[\w.]+)([^;]*);/gi)) {
        if (!/\bwhere\b/i.test(m[2])) problemas.push(`${nome} (${arq}): ${m[1].replace(/\s+/g, ' ')}`);
      }
    }
    expect(problemas).toEqual([]);
  });
});
