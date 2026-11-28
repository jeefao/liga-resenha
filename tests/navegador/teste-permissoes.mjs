// Permissões dos administradores: o dono marca o que cada um pode fazer; os botões seguem as permissões.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8803;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-pe-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORTA}/index.html`;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 900 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText);
  // cenário: um membro aprovado (ligado ao atleta "Membro Teste") e uma liga em preparação
  const prepara = () => ev(() => {
    const id = 'atl-m'; __db.atletas[id] = { id, nome: 'Membro Teste', apelido: null, situacao: 'membro', observacoes: null, versao: 1, atualizado_em: new Date().toISOString() };
    __db.contas['m@teste'] = __db.contas['m@teste'] || { id: 'u-m@teste', email: 'm@teste', senha: '123456' };
    __db.acessos['u-m@teste'] = { user_id: 'u-m@teste', email: 'm@teste', nome_informado: 'Membro Teste', atleta_id: id, status: 'aprovado', criado_em: new Date().toISOString() };
    const nomes = Array.from({ length: 16 }, (_, i) => 'Jogador ' + (i + 1));
    __db.ligas.lp = { id: 'lp', nome: 'Liga Permissão', data: '2027-01-10', participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} } };
  });

  // 1. o dono marca o membro como administrador só de ligas
  await page.goto(URL0); await espera(300); await prepara();
  await ev(() => abrirUsuarios()); await espera(300);
  check('dono vê "Tornar administrador" para quem está aprovado', (await txt()).includes('Tornar administrador'));
  await ev(() => { document.getElementById('adm-u-m@teste').checked = true; document.querySelector('#perms-u-m\\@teste [data-perm="ligas"]').checked = true; });
  await ev(() => salvarAdmin('u-m@teste')); await espera(300);
  check('permissões salvas no servidor', (await ev(() => JSON.stringify([__db.contas['m@teste'].admin, __db.contas['m@teste'].permissoes]))) === '[true,["ligas"]]');
  check('lista mostra o selo ADM', (await txt()).includes('ADM') && (await txt()).includes('Administrador — permissões'));
  await page.screenshot({ path: SAIDA + '/permissoes-usuarios.png', fullPage: true });
  const estado = await ev(() => JSON.stringify({ contas: __db.contas, acessos: __db.acessos }));

  // 2. o membro (só ligas) entra: lança ligas, mas não cria temporada, não mexe em atletas nem em usuários
  await ev(() => localStorage.setItem('mock:sessao', 'm@teste'));
  await page.goto(URL0); await espera(100);
  await prepara(); await ev((e) => { const x = JSON.parse(e); Object.assign(__db.contas['m@teste'], x.contas['m@teste']); Object.assign(__db.acessos, x.acessos); }, estado);
  await ev(() => verificarAcesso()); await espera(400);
  const ti = await txt();
  check('membro entra na administração', (await ev(() => view)) === 'inicio');
  check('membro com "ligas": tem NOVA LIGA, sem nova temporada e sem USUÁRIOS', ti.includes('Nova liga relâmpago') && !ti.includes('Nova temporada') && !ti.includes('Usuários'), ti.slice(0, 400));
  check('membro vê as próprias permissões', ti.includes('Suas permissões: Ligas e jogos'));
  await page.screenshot({ path: SAIDA + '/permissoes-membro-inicio.png', fullPage: true });
  await ev(() => abrirAtletas()); await espera(300);
  check('sem "atletas": não aparece NOVO ATLETA nem Editar', !(await txt()).includes('NOVO ATLETA') && !(await txt()).includes('Editar'));
  await ev(async () => { await abrirLiga('lp'); }); await espera(300);
  check('com "ligas": pode editar a liga', (await ev(() => [...document.querySelectorAll('#main input')].some((e) => !e.disabled))));
  check('apagar de vez continua só do dono', !(await ev(() => !!document.querySelector('[onclick^="apagarDeVez"],[onclick^="esvaziarLixeira"]'))));

  // 3. o dono troca para só "temporadas": a liga abre só para ver
  await ev(() => { __db.contas['m@teste'].permissoes = ['temporadas']; }); await ev(() => verificarAcesso()); await espera(300);
  check('sem "ligas": sem NOVA LIGA', !(await txt()).includes('Nova liga relâmpago') && (await txt()).includes('Nova temporada'));
  await ev(async () => { await abrirLiga('lp'); }); await espera(300);
  const trav = await ev(() => ({ editaveis: [...document.querySelectorAll('#main input,#main select,#main textarea')].filter((e) => !e.disabled).length, iniciar: !!document.querySelector('[onclick^="startLeague"]'), sortear: !!document.querySelector('[onclick^="shuffle"],[onclick^="sortearDuplasTela"]') }));
  check('sem "ligas": liga só para ver (campos travados, sem iniciar nem sortear)', trav.editaveis === 0 && !trav.iniciar && !trav.sortear, JSON.stringify(trav));
  await page.screenshot({ path: SAIDA + '/permissoes-liga-so-ver.png', fullPage: true });

  // 4. tirar da administração: volta a ver só a consulta
  await ev(() => { __db.contas['m@teste'].admin = false; __db.contas['m@teste'].permissoes = []; }); await ev(() => verificarAcesso()); await espera(400);
  check('sem papel de administrador: só a consulta', (await ev(() => view)) === 'publica' && !(await txt()).includes('← Administração'));
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
