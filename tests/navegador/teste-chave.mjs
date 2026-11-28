// Chave na tela: espelhada (final e 3º no centro) e visível antes de os grupos terminarem.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8801;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-ch-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 900, height: 900 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(400);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  // liga de 16 sorteada, sem nenhum placar
  await ev(async () => {
    const id = crypto.randomUUID(), nomes = Array.from({ length: 16 }, (_, i) => 'Atleta' + String.fromCharCode(65 + i) + ' Sobrenome' + String.fromCharCode(65 + i));
    __db.ligas[id] = { id, nome: 'Chave', data: '2026-11-28', participantes: 16, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: nomes.map((_, i) => 'id-' + i), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
    await new Promise((r) => setTimeout(r, 400)); await abrirLiga(id); tab = 'Chave'; render();
  });
  await espera(200);
  const vazia = await ev(() => ({ t: document.querySelector('.br-grid').innerText, nos: document.querySelectorAll('.br-node').length, img: !!document.querySelector('[onclick*="abrirImagemJogos"]') }));
  check('chave aparece antes dos grupos terminarem', vazia.nos === 8, String(vazia.nos));
  check('chave vazia explica o cruzamento', ['Dupla 1 (1º e 2º)', 'Dupla 8 (15º e 16º)', 'Vencedor Q1', 'Vencedor S1', 'Perdedor S1'].every((x) => vazia.t.includes(x)), vazia.t.slice(0, 300));
  check('sem chave formada, sem botão de imagem', !vazia.img);
  await page.screenshot({ path: SAIDA + '/chave-vazia.png', fullPage: true });
  check('sem final jogada: sem pódio', !(await ev(() => !!document.querySelector('.podio'))));
  // completa os grupos e o mata-mata
  await ev(() => {
    let semente = 5; const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
    for (let t = 0; t < 3000; t++) {
      S.scores = {};
      for (const g of groupIndexes()) for (const m of games(g)) S.scores[m.id] = rnd() < .5 ? [6, Math.floor(rnd() * 5)] : [Math.floor(rnd() * 5), 6];
      const c = FORMATS[capacity()].counts;
      if (complete() && !groupPending() && !listsGeneral().some((l, k) => c[k] > 0 && pending('r' + k, l, c[k]))) break;
    }
    for (const id of ['q1', 'q2', 'q3', 'q4', 's1', 's2', 'f', 't']) S.finals[id] = [6, 3];
    tab = 'Chave'; render();
  });
  await espera(200);
  const cheia = await ev(() => {
    const g = document.querySelector('.br-grid').getBoundingClientRect(), sc = document.querySelector('.br-scroll');
    const lbl = [...document.querySelectorAll('.br-node')].map((n) => { const r = n.getBoundingClientRect(); return { t: n.querySelector('.br-label').textContent, x: Math.round(r.left - g.left), y: Math.round(r.top - g.top), dir: Math.round(r.right - g.left) }; });
    return { lbl, largura: Math.round(g.width), cabe: sc.scrollWidth <= sc.clientWidth + 1, img: !!document.querySelector('[onclick*="abrirImagemJogos"]') };
  });
  const pos = Object.fromEntries(cheia.lbl.map((x) => [x.t, x]));
  check('final e 3º no centro, 3º abaixo da final', pos['🏆 Final'].x === pos['🥉 3º lugar'].x && pos['🥉 3º lugar'].y > pos['🏆 Final'].y && pos['🏆 Final'].x > pos['Semi 1'].x && pos['🏆 Final'].x < pos['Semi 2'].x, JSON.stringify(pos));
  check('Q1/Q2 à esquerda e Q3/Q4 à direita', pos.Q1.x === 0 && pos.Q2.x === 0 && pos.Q3.dir === cheia.largura && pos.Q4.dir === cheia.largura, JSON.stringify(pos));
  check('no computador a chave cabe sem rolar', cheia.cabe);
  check('com chave formada, botão de imagem', cheia.img);
  await page.screenshot({ path: SAIDA + '/chave-cheia.png', fullPage: true });
  const pod = await ev(() => { const c = chavePronta(), nomes = [...document.querySelectorAll('.podio-nome')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
    const dupla = (d) => d.map((i) => rawName(i)).join(' ');
    return { nomes, ok: nomes[1] === 'Campeões ' + dupla(winner(c.f)) && nomes[0] === '2º lugar ' + dupla(loser(c.f)) && nomes[2] === '3º lugar ' + dupla(winner(c.t)), figuras: document.querySelectorAll('.podio svg > g').length }; });
  check('pódio: campeões no meio, 2º à esquerda, 3º à direita, 6 atletas', pod.ok && pod.figuras === 6, JSON.stringify(pod));
  await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 }); await espera(100);
  await (await page.$('.podio')).screenshot({ path: SAIDA + '/podio.png' });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await espera(100);
  await (await page.$('.podio')).screenshot({ path: SAIDA + '/podio-celular.png' });
  check('pódio cabe na largura do celular', await ev(() => document.querySelector('.podio').scrollWidth <= document.querySelector('.podio').clientWidth + 1));
  await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
  await page.setViewport({ width: 390, height: 844 }); await ev(() => render()); await espera(200);
  const cel = await ev(() => { const e = document.querySelector('.br-scroll'); return { meio: Math.abs(e.scrollLeft - (e.scrollWidth - e.clientWidth) / 2) < 2, rola: e.scrollWidth > e.clientWidth }; });
  check('no celular a chave abre centralizada na final', cel.rola && cel.meio, JSON.stringify(cel));
  await page.screenshot({ path: SAIDA + '/chave-celular.png' });
  check('sem erros de script', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
