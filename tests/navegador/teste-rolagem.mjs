import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], PARTE = Number(process.argv[3] || 1), PORTA = 8799;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': extname(p) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-sb-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(400);
  const r = await page.evaluate(async () => {
    const pausa = (ms) => new Promise((x) => setTimeout(x, ms));
    for (let k = 0; k < 40; k++) { const a = { id: 'at-' + k, nome: 'Jogador ' + String(k).padStart(2, '0') + ' Teste', situacao: 'membro', apelido: null, observacoes: null, versao: 1 }; __db.atletas[a.id] = a; atletas.push(a); }
    const id = crypto.randomUUID();
    __db.ligas[id] = { id, nome: 'Seleção', data: '2026-11-27', participantes: 20, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: Array(20).fill(''), ids: Array(20).fill(null), scores: {}, finals: {}, breaks: {}, drawn: false, status: 'draft' } };
    await abrirLiga(id); tab = 'Atletas'; render(); await pausa(100);
    const out = [];
    for (const k of [30, 35, 38]) {
      const lista = document.querySelector('.sel-list'); lista.scrollTop = lista.scrollHeight;
      const alvo = [...document.querySelectorAll('.sel-item')].find((x) => x.textContent.includes('Jogador ' + k));
      alvo.scrollIntoView({ block: 'center' }); await pausa(50);
      const antes = { lista: document.querySelector('.sel-list').scrollTop, tela: Math.round(alvo.getBoundingClientRect().top) };
      alvo.querySelector('input').click(); await pausa(150);
      const depoisEl = [...document.querySelectorAll('.sel-item')].find((x) => x.textContent.includes('Jogador ' + k));
      out.push({ k, antes, depois: { lista: document.querySelector('.sel-list').scrollTop, tela: Math.round(depoisEl.getBoundingClientRect().top) }, marcado: depoisEl.querySelector('input').checked });
    }
    return out;
  });
  for (const x of r) check('selecionar Jogador ' + x.k + ' não mexe na tela', x.marcado && Math.abs(x.antes.lista - x.depois.lista) <= 2 && Math.abs(x.antes.tela - x.depois.tela) <= 2, JSON.stringify(x));
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
