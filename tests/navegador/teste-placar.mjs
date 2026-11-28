import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8793;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': extname(p) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-pl-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
  const dialogos = []; page.on('dialog', async (d) => { dialogos.push(d.message()); await d.accept(); });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(400);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const nomes = ['Marcos Pereira', 'Paulo Santos', 'Renato Gomes', 'Fabio Lopes', 'Rodrigo Mendes', 'Elton Prado', 'Sergio Moura', 'Davi Pinheiro', 'Vitor Fontes', 'Rogerio Campos', 'Jonas Peixoto', 'Heitor Klein', 'Andre Ferraz', 'Andre Alves', 'Andre Freire', 'Tadeu'];
  const id = await ev((nomes) => { const id = crypto.randomUUID(); __db.ligas[id] = { id, nome: 'Teste placar', data: '2026-11-23', participantes: 16, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } }; return id; }, nomes);
  await ev(async (id) => { await carregarLista(); }, id); await espera(200);
  check('botão Lixeira no cartão da liga', await ev(() => !!document.querySelector('button[onclick^="moverParaLixeira(\'"]')));
  await ev((id) => abrirLiga(id), id); await espera(400);
  await ev(() => { tab = 'Jogos'; render(); }); await espera(100);
  const t = await ev(() => document.querySelector('.placar').innerText);
  check('nomes curtos no placar', t.includes('MARCOS P. / PAULO S.') && t.includes('RENATO G. / FABIO L.'), t);
  check('nomes iguais usam sobrenome inteiro', await ev(() => { const n = nomesCurtos(); return n[12] === 'Andre Ferraz' && n[14] === 'Andre Freire' && n[13] === 'Andre A.' && n[15] === 'Tadeu'; }), JSON.stringify(await ev(() => nomesCurtos().slice(12))));
  check('sem botão salvar', await ev(() => ![...document.querySelectorAll('#main button')].some((b) => /salvar/i.test(b.textContent))));
  // digitar 6 e 3
  await page.click('#a0-0'); await page.keyboard.type('6');
  check('foco pula para o adversário', await ev(() => document.activeElement.id) === 'b0-0');
  await page.keyboard.type('3'); await espera(700);
  check('salvou sozinho 6x3', JSON.stringify(await ev((id) => __db.ligas[id].dados.scores['0-0'], id)) === '[6,3]');
  check('foco foi para o próximo jogo', await ev(() => document.activeElement.id) === 'a0-1');
  check('vencedor destacado', await ev(() => document.querySelector('#a0-0').closest('.placar-linha').classList.contains('venceu')));
  // empate não salva
  await page.keyboard.type('4'); await page.keyboard.type('4'); await espera(600);
  check('empate não salva e avisa', (await ev((id) => __db.ligas[id].dados.scores['0-1'], id)) === undefined && (await ev(() => $('st0-1').textContent)) === 'não existe empate');
  // corrigir para 4x6
  await page.keyboard.press('Backspace'); await page.keyboard.type('6'); await espera(700);
  check('corrigiu para 4x6', JSON.stringify(await ev((id) => __db.ligas[id].dados.scores['0-1'], id)) === '[4,6]');
  // apagar os dois campos do 1º jogo → volta a sem placar
  await page.click('#a0-0'); await page.keyboard.press('Backspace'); await page.click('#b0-0'); await page.keyboard.press('Backspace'); await espera(1000);
  check('campos vazios = sem placar', (await ev((id) => __db.ligas[id].dados.scores['0-0'], id)) === undefined && (await ev(() => $('st0-0').textContent)) === 'sem placar', JSON.stringify(await ev((id) => __db.ligas[id].dados.scores, id)));
  check('histórico registra placar apagado', await ev(() => (window.__eventos || []).some((e) => e.descricao.includes('placar apagado'))));
  await ev(() => { $('a0-1').scrollIntoView(); });
  await page.screenshot({ path: SAIDA + '/placar.png' });
  // lixeira pelo cartão
  await ev(() => voltarInicio(true)); await espera(300);
  await ev((id) => moverParaLixeira(id), id); await espera(300);
  check('liga foi para a lixeira pelo cartão', await ev((id) => !!__db.ligas[id].excluida_em || false, id) || dialogos.some((d) => d.includes('Mover "Teste placar"')));
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
