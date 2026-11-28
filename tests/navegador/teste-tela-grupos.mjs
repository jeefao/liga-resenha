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
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
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
  await page.goto(`http://127.0.0.1:${PORTA}/adm/index.html`); await espera(400);
  await page.evaluate(async () => {
    const cad = { id: 'cad-1', nome: 'Carlos Cadastro', situacao: 'membro', apelido: null, observacoes: null, versao: 1 };
    __db.atletas[cad.id] = cad; atletas.push(cad);
    const id = crypto.randomUUID();
    const nomes = Array.from({ length: 20 }, (_, i) => 'Atleta' + String.fromCharCode(65 + i) + ' Sobre' + String.fromCharCode(65 + i));
    __db.ligas[id] = { id, nome: 'Tela lesão', data: '2026-11-27', participantes: 20, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: nomes.map((_, i) => 'id-' + i), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
    await abrirLiga(id); tab = 'Jogos'; render();
  });
  await espera(300);
  await page.click('[data-wo="0-0"]'); await espera(200);
  await page.click('input[name=woQuem][value="1"]');
  await page.evaluate(() => { $('woGames').value = '3'; $('woEntra').value = 'a:cad-1'; previaWO('0-0'); });
  const previa = await page.evaluate(() => $('woPrevia').textContent);
  check('prévia do W.O. mostra placar e substituto', previa.includes('3 x 6') && previa.includes('Carlos Cadastro'), previa);
  await page.screenshot({ path: 'saida/wo-modal.png' });
  await page.evaluate(() => confirmarWO('0-0')); await espera(400);
  const r = await page.evaluate(() => ({ placar: JSON.stringify(S.scores['0-0']), wo: S.wo['0-0'], subs: JSON.stringify(S.gsubs.map((s) => [s.pos, s.jogo, s.atleta && s.atleta.id])), modal: $('modal').innerHTML, aviso: document.querySelector('[data-desfazer-grupo="0"]') !== null, jogo2: games(0)[1].b.concat(games(0)[1].a).some((i) => nomeCompleto(i) === 'Carlos Cadastro'), ev: (window.__eventos || []).map((e) => e.descricao).join(' | ') }));
  check('W.O. lançado pela tela', r.placar === '[3,6]' && r.wo === 0 && !r.modal, JSON.stringify(r));
  check('substituto gravado a partir do jogo 2', r.subs === '[[1,1,"cad-1"]]' && r.jogo2 && r.aviso, JSON.stringify(r));
  check('histórico registra W.O. e substituição', r.ev.includes('(W.O.)') && r.ev.includes('Substituição no Grupo A'), r.ev);
  await (await page.evaluateHandle(() => document.querySelector('[data-desfazer-grupo="0"]').closest('section'))).screenshot({ path: 'saida/wo-grupo.png' });
  await page.evaluate(() => { tab = 'Classificação'; render(); }); await espera(200);
  await (await page.evaluateHandle(() => document.querySelectorAll('table')[0].closest('section'))).screenshot({ path: 'saida/wo-classif.png' });
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
