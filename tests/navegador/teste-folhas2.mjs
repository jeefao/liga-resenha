import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8797;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-f2-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const base = ['Ronaldo Teixeira', 'Tadeu Kato', 'Caio Barros', 'Hugo Matos', 'Mauro Reis', 'Samuel Gabriel', 'Rodrigo Nogueira', 'Fabio Lopes', 'Heitor Klein', 'Felipe Rocha', 'Enzo Duarte', 'JP Moraes', 'Elton Prado', 'Andre Ferraz', 'Caio Vieira', 'Bruno Farias', 'Lucas Torres', 'Jonas Peixoto', 'Marcos Pereira', 'Andre Alves'];
try {
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('APAGAR') : d.accept()));
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(400);
  // ---- folhas ----
  const nomes = [...base, ...Array.from({ length: 12 }, (_, i) => 'Atleta Extra ' + (i + 1))];
  const r = await page.evaluate(async (nomes) => {
    const id = crypto.randomUUID();
    __db.ligas[id] = { id, nome: 'Relâmpago 23/11', data: '2026-11-23', participantes: 32, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: Array(32).fill(null), scores: { '0-0': [6, 2] }, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
    await abrirLiga(id); tab = 'Jogos'; render();
    abrirImagemJogos('grupos');
    const radios = document.querySelectorAll('input[name=impSel]').length, previa = document.querySelectorAll('#tjPrevia svg').length;
    chaveAtual = () => ({ duos: Array.from({ length: 8 }, (_, i) => [2 * i, 2 * i + 1]), ss: [{ a: [0, 1], b: [6, 7] }, null], f: null, t: null });
    const b64 = async (b) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    impPlacar = true;
    const g = await folhaPng('grupos'), c = await folhaPng('chave');
    impSel = 'ambas'; window.print = () => {}; imprimirTabelaJogos();
    const txt = document.querySelector('#impressao').textContent;
    return { radios, previa, g: await b64(g), c: await b64(c), gs: g.size, cs: c.size, paginas: document.querySelectorAll('#impressao .imp-pagina').length, grupos: (txt.match(/GRUPO [A-H]/g) || []).length };
  }, nomes);
  check('modal com 3 opções e prévia', r.radios === 3 && r.previa === 1, r.radios + '/' + r.previa);
  check('imagens PNG geradas', r.gs > 50000 && r.cs > 50000, r.gs + '/' + r.cs);
  check('impressão: 2 páginas, 8 grupos', r.paginas === 2 && r.grupos === 8, r.paginas + '/' + r.grupos);
  writeFileSync(SAIDA + '/img-grupos.png', Buffer.from(r.g, 'base64'));
  writeFileSync(SAIDA + '/img-chave.png', Buffer.from(r.c, 'base64'));
  await page.evaluate(() => document.body.classList.add('imprimindo'));
  await page.pdf({ path: SAIDA + '/folhas-svg.pdf', format: 'A4', landscape: true, printBackground: true });
  const pdf = readFileSync(SAIDA + '/folhas-svg.pdf');
  check('PDF com 2 páginas', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 2);
  // ---- apagar temporada ----
  await page.evaluate(() => { document.body.classList.remove('imprimindo'); fecharModal(); });
  const t = await page.evaluate(async () => {
    const tid = crypto.randomUUID();
    __db.temporadas[tid] = { id: tid, nome: 'Temporada teste', inicio: '2027-01-10', status: 'encerrada', regras: { etapas: 10 }, dados: { ajustes: [] }, publica: false, versao: 1, atualizado_em: new Date().toISOString(), criado_em: new Date().toISOString() };
    for (const n of [1, 2]) { const id = crypto.randomUUID(); __db.ligas[id] = { id, nome: 'Etapa ' + n, data: '2027-01-10', participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: tid, etapa_numero: n, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: Array(16).fill(''), ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {}, drawn: false, status: 'draft' } }; }
    await carregarTemporadas(); await abrirTemporada(tid); await new Promise((r) => setTimeout(r, 300));
    const antes = !!document.querySelector('button[onclick="apagarTemporada()"]');
    await mudarStatusTemporada('arquivada'); await new Promise((r) => setTimeout(r, 300));
    const depois = !!document.querySelector('button[onclick="apagarTemporada()"]');
    await apagarTemporada(); await new Promise((r) => setTimeout(r, 300));
    return { antes, depois, existe: !!__db.temporadas[tid], etapas: Object.values(__db.ligas).filter((l) => l.temporada_id === tid).length, total: Object.values(__db.ligas).length, view };
  });
  check('sem botão apagar antes de arquivar', !t.antes);
  check('botão apagar aparece quando arquivada', t.depois);
  check('temporada e etapas apagadas, relâmpago mantida', !t.existe && t.etapas === 0 && t.total === 1, JSON.stringify(t));
  check('voltou ao início', t.view === 'inicio', t.view);
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
