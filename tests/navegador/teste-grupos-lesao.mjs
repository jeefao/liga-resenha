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
    const out = {}; const pausa = (ms) => new Promise((x) => setTimeout(x, ms));
    const cad = { id: 'cad-1', nome: 'Carlos Cadastro', situacao: 'membro', apelido: null, observacoes: null, versao: 1 };
    __db.atletas[cad.id] = cad; atletas.push(cad);
    const nova = async (n) => {
      const id = crypto.randomUUID();
      const nomes = Array.from({ length: n }, (_, i) => 'Atleta' + String.fromCharCode(65 + i) + ' Sobre' + String.fromCharCode(65 + i));
      __db.ligas[id] = { id, nome: 'Grupo lesão', data: '2026-11-27', participantes: n, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: nomes.map((_, i) => 'id-' + i), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
      await pausa(400); await abrirLiga(id); return id;
    };
    // preenche os jogos sem placar até não haver empate pendente
    const completar = () => {
      const base = JSON.stringify(S.scores); let semente = 11; const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
      for (let t = 0; t < 3000; t++) {
        S.scores = JSON.parse(base);
        for (const g of groupIndexes()) for (const m of games(g)) if (!S.scores[m.id]) S.scores[m.id] = rnd() < .5 ? [6, Math.floor(rnd() * 5)] : [Math.floor(rnd() * 5), 6];
        const c = FORMATS[capacity()].counts;
        if (complete() && !groupPending() && !listsGeneral().some((l, k) => c[k] > 0 && pending('r' + k, l, c[k]))) return true;
      }
      return false;
    };
    const id = await nova(20);
    // Task 1: W.O. com games
    out.wo1 = marcarWO('0-0', 0, 2) && JSON.stringify(S.scores['0-0']) === '[2,6]' && S.wo['0-0'] === 0;
    await pausa(300); out.woSrv = !!__db.ligas[id].dados.wo && __db.ligas[id].dados.wo['0-0'] === 0;
    aplicarPlacar('0-0', 'scores', null); out.woApaga = S.wo['0-0'] === undefined;
    out.wo2 = marcarWO('0-0', 1, 5) && JSON.stringify(S.scores['0-0']) === '[6,5]' && S.wo['0-0'] === 1;
    out.woInvalido = marcarWO('0-1', 0, 6) === false && !S.scores['0-1'];
    aplicarPlacar('0-0', 'scores', null); marcarWO('0-0', 0, 2);
    // Task 2: substitutos
    out.ext = substituirNoGrupo(0, 1, 'a:cad-1', 'lesão');
    out.extVirtual = S.gsubs[0].entra >= 20 && nomeCompleto(S.gsubs[0].entra) === 'Carlos Cadastro' && idDe(S.gsubs[0].entra) === 'cad-1';
    const v = S.gsubs[0].entra;
    out.jogos = games(0)[0].a.includes(0) && games(0)[1].a.includes(v) && !games(0)[1].a.includes(0) && games(0)[2].a.includes(v);
    out.repetido = substituirNoGrupo(0, 2, 'i:8', 'lesão');
    out.mesmoGrupo = substituirNoGrupo(5, 1, 'i:6', 'lesão');
    out.liga = substituirNoGrupo(4, 1, 'i:8', 'lesão');
    out.desfazLivre = desfazerGrupo(1) === null && S.gsubs.length === 1;
    out.liga2 = substituirNoGrupo(4, 1, 'i:8', 'lesão');
    out.completou = completar();
    out.bloqDesfazer = typeof desfazerGrupo(0) === 'string';
    const r0 = rank(0).map((x) => x.i), r1 = rank(1).map((x) => x.i), r2 = rank(2);
    out.rank0 = r0.includes(v) && !r0.includes(0) && r0.length === 4;
    out.rank1 = !r1.includes(4) && !r1.includes(8) && r1.length === 3;
    out.rank2 = r2.find((x) => x.i === 8).j === 3 && rank(0).find((x) => x.i === v).j === 2;
    const c = classificadosGerais(); const q = c && c.duos.flat();
    out.classif = !!c && q.length === 16 && new Set(q).size === 16 && !q.includes(0) && !q.includes(4) && !c.fora.includes(0) && !c.fora.includes(4);
    out.lesionados = JSON.stringify(lesionadosDoGrupo(0)) === '[0]' && JSON.stringify(lesionadosDoGrupo(1)) === '[4]';
    const w = textoWhatsApp({ jogos: true, classif: true, mata: true });
    out.whats = w.includes('Carlos Cadastro') && w.includes('(W.O.)');
    out.folha = corpoGrupos(true).includes(nomesFolha()[v]);
    // Task 4: pontos
    const R = regrasCompletas({});
    const p = pontosDaEtapa({ id: 'pg', versao: 1, dados: dadosParaServidor() }, R);
    const p0 = p.porId.get('id-0'), pc = p.porId.get('cad-1'), p8 = p.porId.get('id-8'), p4 = p.porId.get('id-4');
    out.pontos = { p0: p0 && [p0.v, p0.posicao, p0.dz], pc: pc && [pc.v, pc.posicao], p8: p8 && [p8.v, r2.find((x) => x.i === 8).w], p4: p4 && [p4.posicao] };
    out.pontosOk = !!(p0 && p0.posicao === null && pc && pc.posicao !== null && pc.v === rank(0).find((x) => x.i === v).w && p8 && p8.v === r2.find((x) => x.i === 8).w && p4 && p4.posicao === null);
    // W.O. no mata-mata com placar parcial
    out.woMata = marcarWO('q1', 1, 5) && JSON.stringify(S.finals.q1) === '[6,5]' && S.wo.q1 === 1;
    // liga de 16 com substituto da liga: o lesionado segura a vaga
    await nova(16);
    out.l16sub = substituirNoGrupo(0, 1, 'i:5', 'lesão');
    out.l16 = completar();
    const c16 = classificadosGerais();
    out.l16ok = !!c16 && new Set(c16.duos.flat()).size === 16 && c16.duos.flat().includes(0);
    return out;
  });
  check('W.O. no grupo: games + 6 e marca', r.wo1 && r.woSrv, JSON.stringify(r));
  check('apagar placar remove W.O.', r.woApaga);
  check('W.O. 5 games vira 5x6 (lado 1)', r.wo2);
  check('W.O. com games impossíveis é recusado', r.woInvalido);
  check('substituto de fora entra a partir do jogo seguinte', r.ext === null && r.extVirtual && r.jogos, JSON.stringify([r.ext, r.extVirtual, r.jogos]));
  check('mesma posição duas vezes é recusada', typeof r.repetido === 'string');
  check('substituto da liga tem que ser de outro grupo', typeof r.mesmoGrupo === 'string');
  check('substituto da liga aceito e desfazer livre', r.liga === null && r.desfazLivre && r.liga2 === null, JSON.stringify([r.liga, r.desfazLivre, r.liga2]));
  check('grupos completos', r.completou);
  check('desfazer bloqueado com jogo seguinte lançado', r.bloqDesfazer);
  check('grupo A: externo no lugar do lesionado', r.rank0);
  check('grupo B: lesionado e substituto da liga fora', r.rank1);
  check('substituto da liga só conta os jogos do grupo dele', r.rank2);
  check('16 vagas sem os lesionados', r.classif);
  check('lesionados identificados', r.lesionados);
  check('WhatsApp mostra substituto e W.O.', r.whats);
  check('folha dos grupos mostra substituto', r.folha);
  check('pontos: lesionado sem posição, externo e substituto da liga', r.pontosOk, JSON.stringify(r.pontos));
  check('W.O. no mata-mata com placar parcial', r.woMata);
  check('liga de 16: lesionado segura a vaga', r.l16sub === null && r.l16 && r.l16ok, JSON.stringify([r.l16sub, r.l16, r.l16ok]));
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
