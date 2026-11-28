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
    const nova = async (n) => {
      const id = crypto.randomUUID();
      const nomes = Array.from({ length: n }, (_, i) => 'Atleta' + String.fromCharCode(65 + i) + ' Sobre' + String.fromCharCode(65 + i));
      __db.ligas[id] = { id, nome: 'Regras', data: '2026-11-27', participantes: n, status: 'andamento', etapa: 'grupos', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: nomes.map((_, i) => 'id-' + i), scores: {}, finals: {}, breaks: {}, drawn: true, status: 'drawn' } };
      await pausa(400); await abrirLiga(id); return id;
    };
    const completar = () => {
      let semente = 5; const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
      for (let t = 0; t < 3000; t++) {
        S.scores = {};
        for (const g of groupIndexes()) for (const m of games(g)) S.scores[m.id] = rnd() < .5 ? [6, Math.floor(rnd() * 5)] : [Math.floor(rnd() * 5), 6];
        const c = FORMATS[capacity()].counts;
        if (complete() && !groupPending() && !listsGeneral().some((l, k) => c[k] > 0 && pending('r' + k, l, c[k]))) return true;
      }
      return false;
    };
    // ---------- Etapa 1: vencedor precisa ter 6 ou mais ----------
    await nova(16);
    out.p35 = aplicarPlacar('0-0', 'scores', [3, 5]) === false && !S.scores['0-0'];
    out.p65 = aplicarPlacar('0-0', 'scores', [6, 5]) === true;
    out.p76 = aplicarPlacar('0-1', 'scores', [6, 7]) === true;
    out.wo = marcarWO('0-2', 0, 2) && JSON.stringify(S.scores['0-2']) === '[2,6]';
    tab = 'Jogos'; render(); await pausa(100);
    const a = $('a1-0'), b = $('b1-0'); a.value = '3'; a.dispatchEvent(new Event('input')); b.value = '4'; b.dispatchEvent(new Event('input'));
    await pausa(500);
    out.aviso = $('st1-0').textContent; out.naoSalvou = !S.scores['1-0'];
    // ---------- Etapa 3: etapas especiais ----------
    await nova(16); completar();
    for (const q of ['q1', 'q2', 'q3', 'q4']) aplicarPlacar(q, 'finals', [6, 2]);
    ESPECIAL = true;
    const c0 = chaveAtual();
    out.semSorteio = c0.ss[0] === null && c0.ss[1] === null && c0.aguardando.some((x) => x.id === 's1' && x.jogadores.length === 4);
    tab = 'Mata-mata'; render(); await pausa(50);
    out.botao = document.querySelector('[data-sortear="s1"]') !== null;
    { const b = document.querySelector('[data-sortear="s1"]'); window.__cartao = b ? b.closest('.match-card').outerHTML : ''; }
    const q1 = c0.qs[0].a, q2 = c0.qs[1].a;   // duplas que venceram Q1 e Q2 (placar 6x2 → lado a)
    out.sorteio = sortearDuplas('s1');
    const p1 = S.sorteioMata && S.sorteioMata.s1;
    const mesma = (x, y) => x.length === 2 && y.length === 2 && x.every((i) => y.includes(i));
    out.semRepetir = !!p1 && p1.length === 2 && !p1.some((p) => mesma(p, q1) || mesma(p, q2)) && new Set(p1.flat()).size === 4 && p1.flat().every((i) => [...q1, ...q2].includes(i));
    const q3 = c0.qs[2].a, q4 = c0.qs[3].a;
    out.manualRepetido = definirDuplas('s2', [q3, q4]);
    out.manualOk = definirDuplas('s2', [[q3[0], q4[0]], [q3[1], q4[1]]]);
    await pausa(300);
    out.gravou = !!(__db.ligas[L.id].dados.sorteioMata && __db.ligas[L.id].dados.sorteioMata.s2);
    const c1 = chaveAtual();
    out.semis = c1.ss[0] && c1.ss[1] && mesma(c1.ss[1].a, [q3[0], q4[0]]);
    out.redesorteioBloq = (aplicarPlacar('s1', 'finals', [6, 3]), typeof sortearDuplas('s1') === 'string');
    aplicarPlacar('s2', 'finals', [4, 6]);
    const c2 = chaveAtual();
    out.finalAguarda = c2.f === null && c2.t === null && c2.aguardando.some((x) => x.id === 'f') && c2.aguardando.some((x) => x.id === 't');
    sortearDuplas('f'); sortearDuplas('t');
    const c3 = chaveAtual(), sp = [...S.sorteioMata.s1, ...S.sorteioMata.s2];
    out.finalSemRepetir = !!c3.f && !!c3.t && ![c3.f.a, c3.f.b, c3.t.a, c3.t.b].some((p) => sp.some((x) => mesma(p, x)));
    aplicarPlacar('f', 'finals', [6, 4]); aplicarPlacar('t', 'finals', [6, 1]);
    const camp = chaveAtual().f.a;
    const R = regrasCompletas({ especiais: [3] });
    const pe = pontosDaEtapa({ id: 'esp', versao: 1, etapa_numero: 3, temporada_id: 't', dados: dadosParaServidor() }, R);
    out.pontosCampeao = camp.every((i) => pe.porId.get('id-' + i).mataTxt.includes('vitória final')) && pe.mataCompleto;
    const w = textoWhatsApp({ jogos: false, classif: false, mata: true });
    out.whats = w.includes('Final:') && w.includes('Campeões');
    aplicarPlacar('q1', 'finals', [2, 6]);
    out.cascata = !S.sorteioMata.s1 && !S.sorteioMata.f && !S.sorteioMata.t && !!S.sorteioMata.s2;
    ESPECIAL = false;
    out.normal = !!chaveAtual().ss[1] && !chaveAtual().aguardando.length;
    // ---------- Etapa 4: desempate do ranking ----------
    const base = { total: 50, v: 10, sg: 5, gp: 40, melhorEtapa: 20, maxVit: 4, nome: 'X' };
    const ord = (lin) => lin.slice().sort(compararRanking).map((x) => x.nome);
    out.desempate = [
      ord([{ ...base, nome: 'A', v: 9 }, { ...base, nome: 'B' }]).join() === 'B,A',
      ord([{ ...base, nome: 'A', sg: 3 }, { ...base, nome: 'B' }]).join() === 'B,A',
      ord([{ ...base, nome: 'A', gp: 30 }, { ...base, nome: 'B' }]).join() === 'B,A',
      ord([{ ...base, nome: 'A', melhorEtapa: 18 }, { ...base, nome: 'B' }]).join() === 'B,A',
      ord([{ ...base, nome: 'A', maxVit: 3 }, { ...base, nome: 'B' }]).join() === 'B,A',
      ord([{ ...base, nome: 'B', total: 49, v: 99 }, { ...base, nome: 'A' }]).join() === 'A,B',
    ];
    const Tv = T, TEv = TE;
    T = { id: 't', nome: 'x', regras: { especiais: [] }, dados: {} };
    TE = [{ id: 'e1', versao: 1, etapa_numero: 1, status: 'finalizada', excluida_em: null, temporada_id: 't', dados: dadosParaServidor() }];
    try {
      const rk = calcularRanking();
      const p = pontosDaEtapa(TE[0], regrasCompletas(T.regras));
      const x = rk.linhas.find((l) => l.id === 'id-0'), e = p.porId.get('id-0');
      out.campos = !!x && x.v === e.vt && x.sg === e.sg && x.gp === e.gp && x.maxVit === e.vt && typeof x.melhorEtapa === 'number';
      // posições: empate completo divide a posição; senão, segue o critério
      out.posicoes = rk.linhas.every((l, i) => i === 0 || (compararRanking(rk.linhas[i - 1], l) === 0 ? l.pos === rk.linhas[i - 1].pos : l.pos === i + 1));
    } finally { T = Tv; TE = TEv; }
    return out;
  });
  check('placar 3x5 recusado', r.p35);
  check('placar 6x5 e 6x7 aceitos', r.p65 && r.p76);
  check('W.O. 2x6 continua valendo', r.wo);
  check('tela avisa que o vencedor precisa de 6', /6/.test(r.aviso || '') && r.naoSalvou, r.aviso);
  check('especial: semi aguarda sorteio', r.semSorteio, JSON.stringify(r));
  check('especial: botão de sortear na tela', r.botao);
  check('sorteio da semi sem repetir parceiro', r.sorteio === null && r.semRepetir, JSON.stringify(r.sorteio));
  check('manual com parceiro repetido é recusado', typeof r.manualRepetido === 'string' && r.manualOk === null, JSON.stringify([r.manualRepetido, r.manualOk]));
  check('sorteio gravado no servidor', r.gravou);
  check('semis montadas com as duplas sorteadas', r.semis);
  check('não sorteia de novo jogo com placar', r.redesorteioBloq);
  check('final e 3º aguardam sorteio', r.finalAguarda);
  check('final e 3º sem repetir parceiro da semi', r.finalSemRepetir);
  check('pontos do campeão na etapa especial', r.pontosCampeao);
  check('WhatsApp com a final especial', r.whats);
  check('mudar quartas apaga sorteios dependentes', r.cascata);
  check('etapa normal continua igual', r.normal);
  check('desempate: vitórias, saldo, games, melhor etapa, vitórias numa etapa', r.desempate.every(Boolean), JSON.stringify(r.desempate));
  check('ranking calcula vitórias, saldo e games da temporada', r.campos);
  check('posições seguem o desempate', r.posicoes);
  check('sem erros JS', erros.length === 0, erros.join(' | '));
  // print do cartão de sorteio (para conferência visual; fica em saida/, fora do Git)
  if (process.argv[4]) { await page.evaluate(() => { document.body.innerHTML = '<main style="padding:16px">' + window.__cartao + '</main>'; window.scrollTo(0, 0); }); await page.screenshot({ path: process.argv[4] + '/sorteio.png' }); }
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
