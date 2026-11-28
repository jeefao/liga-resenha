// Roda todos os testes de navegador do app (index.html) com um Supabase simulado (mock.mjs).
// Uso: npm run test:navegador   (precisa do Google Chrome instalado no caminho padrão do Windows)
// Prints e PDFs gerados ficam em tests/navegador/saida (fora do Git).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const SAIDA = join(AQUI, 'saida');
mkdirSync(SAIDA, { recursive: true });

// [arquivo, argumento extra] — os testes com "partes" recebem a última parte
const TESTES = [
  ['teste-ordem.mjs', SAIDA], ['teste-placar.mjs', SAIDA], ['teste-folhas2.mjs', SAIDA],
  ['teste-temporadas.mjs', SAIDA], ['teste-atletas.mjs', SAIDA], ['teste-rolagem.mjs', '1'],
  ['teste-subs.mjs', '3'], ['teste-grupos-lesao.mjs', '1'], ['teste-tela-grupos.mjs', '1'], ['teste-regras.mjs', '1', SAIDA], ['teste-chave.mjs', SAIDA], ['teste-acesso.mjs', SAIDA], ['teste-permissoes.mjs', SAIDA], ['teste-financas.mjs', SAIDA], ['teste-senha.mjs', SAIDA], ['teste-painel.mjs', SAIDA],
];
const so = process.argv[2];
let ok = 0, falhas = 0;
for (const [arq, ...extra] of TESTES) {
  if (so && !arq.includes(so)) continue;
  const r = spawnSync(process.execPath, [join(AQUI, arq), RAIZ, ...extra], { cwd: AQUI, encoding: 'utf8', timeout: 300000 });
  const saida = (r.stdout || '') + (r.stderr || '');
  const m = saida.match(/OK: (\d+)/), f = saida.split('\n').filter((l) => l.startsWith('FALHA'));
  if (!m || r.status !== 0) { falhas++; console.log(`✗ ${arq}: não terminou\n${saida.split('\n').filter((l) => !l.startsWith('    at')).slice(-8).join('\n')}`); continue; }
  ok += +m[1]; falhas += f.length;
  console.log(`${f.length ? '✗' : '✓'} ${arq}: ${m[1]} ok${f.length ? ', ' + f.length + ' falha(s)' : ''}`);
  f.forEach((l) => console.log('   ' + l));
}
console.log(`\nTotal: ${ok} verificações ok, ${falhas} falha(s).`);
process.exit(falhas ? 1 : 0);
