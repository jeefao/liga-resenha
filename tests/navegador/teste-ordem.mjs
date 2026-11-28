import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], PORTA = 8796;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-or-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
try {
  const page = await browser.newPage(); const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await new Promise((r) => setTimeout(r, 400));
  const r = await page.evaluate(async () => {
    const out = {};
    out.nova = JSON.stringify(ordemQuartas({ finals: {} }));
    out.antiga = JSON.stringify(ordemQuartas({ finals: { q1: [6, 2] } }));
    out.marcada = JSON.stringify(ordemQuartas({ finals: { q1: [6, 2] }, ordemChave: 'planilha' }));
    // liga nova: primeiro placar do mata-mata grava 'planilha' e é salvo no servidor
    const id = crypto.randomUUID(), nomes = Array.from({ length: 16 }, (_, i) => 'Atleta ' + (i + 1));
    __db.ligas[id] = { id, nome: 'T', data: '2026-11-23', participantes: 16, status: 'andamento', etapa: 'mata_mata', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
    await abrirLiga(id);
    aplicarPlacar('q1', 'finals', [6, 3]); await new Promise((r) => setTimeout(r, 600));
    out.salvo = __db.ligas[id].dados.ordemChave;
    out.depois = JSON.stringify(ordemQuartas());
    // liga antiga com placar: carregar mantém ordem antiga e ao lançar grava 'antiga'
    const id2 = crypto.randomUUID();
    __db.ligas[id2] = { ...__db.ligas[id], id: id2, versao: 1, dados: { names: nomes, ids: Array(16).fill(null), scores: {}, finals: { q1: [6, 1] }, breaks: {}, drawn: true, status: 'drawn' } };
    await abrirLiga(id2);
    aplicarPlacar('q2', 'finals', [6, 4]); await new Promise((r) => setTimeout(r, 600));
    out.salvo2 = __db.ligas[id2].dados.ordemChave;
    return out;
  });
  const NOVA = '[[0,7],[2,5],[3,4],[1,6]]', VELHA = '[[0,7],[3,4],[1,6],[2,5]]';
  check('liga sem placar no mata-mata usa ordem da planilha', r.nova === NOVA, r.nova);
  check('liga antiga com placar mantém ordem antiga', r.antiga === VELHA, r.antiga);
  check('marcação planilha vale mesmo com placar', r.marcada === NOVA, r.marcada);
  check('1º placar grava ordem planilha no servidor', r.salvo === 'planilha' && r.depois === NOVA, r.salvo + ' ' + r.depois);
  check('liga antiga grava ordem antiga', r.salvo2 === 'antiga', r.salvo2);
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
