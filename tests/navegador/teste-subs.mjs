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
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(400);
  // Liga de 20 atletas com a fase de grupos completa e sem empates pendentes
  const id = await page.evaluate(async () => {
    const nomes = Array.from({ length: 20 }, (_, i) => 'Atleta' + String.fromCharCode(65 + i) + ' Sobre' + String.fromCharCode(65 + i));
    const id = crypto.randomUUID();
    let semente = 7; const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
    for (let t = 0; t < 2000; t++) {
      const sc = {};
      for (let g = 0; g < 5; g++) { sc[g + '-0'] = [6, Math.floor(rnd() * 5)]; sc[g + '-1'] = [6, Math.floor(rnd() * 5)]; sc[g + '-2'] = [Math.floor(rnd() * 5), 6]; }
      const d = { names: nomes, ids: Array(20).fill(null), scores: sc, finals: {}, breaks: {}, drawn: true, status: 'drawn' };
      const okk = comDados(d, () => { if (!complete() || groupPending()) return false; const L_ = listsGeneral(), c = FORMATS[20].counts; return !L_.some((l, k) => c[k] > 0 && pending('r' + k, l, c[k])); });
      if (okk) { window.__dadosBase = JSON.parse(JSON.stringify(d)); __db.ligas[id] = { id, nome: 'Relâmpago teste', data: '2026-11-26', participantes: 20, status: 'andamento', etapa: 'mata_mata', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: d }; break; }
    }
    await abrirLiga(id); return id;
  });
  check('liga de teste montada', !!(await page.evaluate((id) => __db.ligas[id], id)));
  if (PARTE >= 1) {
    const r = await page.evaluate(() => {
      const out = {};
      const c0 = classificadosGerais();
      out.temDuos = !!c0 && c0.duos.length === 8;
      out.igualChave = JSON.stringify(c0.duos) === JSON.stringify(chaveAtual().duos);
      out.fora = c0.fora;
      out.melhor = melhorEliminado();
      const sai = c0.duos[0][0], entra = c0.fora[0], nomesAntes = JSON.stringify(S.names);
      S.subs = [{ sai, entra, atleta: null, motivo: 'lesão', em: new Date().toISOString() }];
      const c1 = classificadosGerais();
      out.trocou = c1.duos[0].includes(entra) && !c1.duos[0].includes(sai) && c1.duos[0].includes(c0.duos[0][1]);
      out.foraSemEntra = !c1.fora.includes(entra);
      out.nomesIntactos = JSON.stringify(S.names) === nomesAntes;
      out.melhor2 = melhorEliminado() === c1.fora[0];
      S.subs = [{ sai, entra: 20, atleta: { id: 'ext-1', nome: 'Convidado Silva' }, motivo: 'lesão', em: '' }];
      out.ext = [nomeCompleto(20), nomesCurtos()[20], idDe(20), classificadosGerais().duos[0].includes(20)];
      out.temPlacarAntes = duplaTemPlacar(0);
      S.finals.q1 = [6, 2];
      out.temPlacarDepois = duplaTemPlacar(0);
      S.finals = {}; S.wo = { q1: 1 };
      const g = Object.keys(S.scores)[0];
      aplicarPlacar(g, 'scores', [S.scores[g][0], S.scores[g][1] === 0 ? 1 : 0]);
      out.limpou = (S.subs || []).length === 0 && Object.keys(S.wo || {}).length === 0;
      out.servidor = JSON.stringify(dadosParaServidor({ ...S, subs: [{ sai: 1, entra: 2 }], wo: { q1: 0 } }));
      return out;
    });
    check('duplas montadas igual à chave atual', r.temDuos && r.igualChave);
    check('melhor eliminado = 1º de fora', r.melhor === r.fora[0] && r.fora.length === 4, JSON.stringify(r));
    check('troca põe o substituto no lugar e mantém o parceiro', r.trocou);
    check('quem entrou sai da lista de eliminados', r.foraSemEntra && r.melhor2);
    check('nomes dos grupos não mudam', r.nomesIntactos);
    check('atleta de fora: nome, nome curto, id e dupla', JSON.stringify(r.ext) === JSON.stringify(['Convidado Silva', 'Convidado S.', 'ext-1', true]), JSON.stringify(r.ext));
    check('dupla com placar no mata-mata é detectada', !r.temPlacarAntes && r.temPlacarDepois);
    check('alterar grupos limpa trocas e W.O.', r.limpou);
    check('trocas e W.O. vão para o servidor', r.servidor.includes('"subs"') && r.servidor.includes('"wo"'));
  }
  if (PARTE >= 2) {
    const r = await page.evaluate(async () => {
      const out = {}; const pausa = (ms) => new Promise((x) => setTimeout(x, ms));
      const id2 = crypto.randomUUID();
      __db.ligas[id2] = { ...JSON.parse(JSON.stringify(Object.values(__db.ligas)[0])), id: id2, versao: 1, dados: JSON.parse(JSON.stringify(__dadosBase)) };
      const cad = { id: 'cad-1', nome: 'Carlos Cadastro', situacao: 'membro', apelido: null, observacoes: null, versao: 1 };
      __db.atletas[cad.id] = cad; if (!atletas.some((a) => a.id === cad.id)) atletas.push(cad);
      await pausa(600); await abrirLiga(id2); tab = 'Mata-mata'; render(); out.dbg = [L && L.id === id2, S.status, complete(), groupPending(), Object.keys(S.scores).length]; if (!classificadosGerais()) return out;
      out.botoes = document.querySelectorAll('[data-sub]').length;
      const c0 = classificadosGerais(); const sai = c0.duos[2][1], parceiro = c0.duos[2][0], sug = melhorEliminado();
      abrirSubstituicao(2);
      const txt = $('modal').textContent;
      out.modal = txt.includes(rawName(sai)) && txt.includes(rawName(parceiro)) && $('subEntra').value === 'i:' + sug && [...$('subEntra').options].some((o) => o.value === 'a:cad-1');
      document.querySelector(`input[name=subSai][value="${sai}"]`).checked = true;
      aplicarSubstituicao(2); await pausa(300);
      const db = __db.ligas[id2].dados;
      out.gravou = (db.subs || []).length === 1 && db.subs[0].sai === sai && db.subs[0].entra === sug && !$('modal').innerHTML;
      const ev = (window.__eventos || []).map((e) => e.descricao).join(' | ');
      out.evento = ev.includes('Substituição D3: Sai ' + rawName(sai) + ' (lesão) → Entra ' + rawName(sug));
      out.card = document.querySelector('[data-desfazer="0"]') !== null && document.querySelector('.duos').textContent.includes(rawName(sug));
      out.repetido = substituir(3, classificadosGerais().duos[3][0], 'i:' + sug, 'lesão');
      out.subsDepoisRepetido = S.subs.length;
      const s4 = classificadosGerais().duos[4][0];
      out.externo = substituir(4, s4, 'a:cad-1', 'lesão');
      const e2 = S.subs[1];
      out.ext = e2 && e2.atleta && e2.atleta.id === 'cad-1' && e2.entra >= capacity() && classificadosGerais().duos[4].includes(e2.entra) && nomeCompleto(e2.entra) === 'Carlos Cadastro';
      desfazerSubstituicao(0); await pausa(300);
      out.desfez = S.subs.length === 1 && classificadosGerais().duos[2].includes(sai) && __db.ligas[id2].dados.subs.length === 1 && (window.__eventos || []).some((e) => e.descricao.startsWith('Substituição desfeita'));
      out.extAindaLa = nomeCompleto(S.subs[0].entra) === 'Carlos Cadastro' && classificadosGerais().duos[4].includes(S.subs[0].entra);
      const q = 'q' + (ordemQuartas().findIndex((p) => p.includes(4)) + 1);
      aplicarPlacar(q, 'finals', [6, 3]); render();
      out.semBotaoComPlacar = document.querySelector('[data-sub="4"]') === null && document.querySelector('[data-sub="0"]') !== null;
      out.bloqueado = substituir(4, classificadosGerais().duos[4][1], 'i:' + melhorEliminado(), 'lesão');
      marcarWO('q1', 1); await pausa(300); render();
      out.wo = JSON.stringify(S.finals.q1) === '[6,0]' && S.wo.q1 === 1 && __db.ligas[id2].dados.wo.q1 === 1;
      out.woTela = $('stq1').textContent.includes('W.O.');
      const w = textoWhatsApp({ jogos: false, classif: false, mata: true });
      out.whats = w.includes('Carlos Cadastro') && w.includes('W.O.');
      out.folha = corpoChave(true).includes(nomesFolha()[S.subs[0].entra]);
      aplicarPlacar('q1', 'finals', null);
      out.woApagado = !S.wo.q1;
      return out;
    });
    check('botão Substituir em cada dupla', r.botoes === 8, String(r.botoes) + JSON.stringify(r.dbg));
    check('janela mostra a dupla e sugere o melhor eliminado', r.modal);
    check('substituição gravada no servidor', r.gravou);
    check('substituição no histórico', r.evento);
    check('dupla mostra quem entrou e Desfazer', r.card);
    check('mesmo atleta não entra duas vezes', typeof r.repetido === 'string' && r.subsDepoisRepetido === 1, JSON.stringify(r.repetido));
    check('atleta do cadastro entra como externo', r.externo === null && r.ext, JSON.stringify(r.externo));
    check('desfazer remove só aquela troca', r.desfez && r.extAindaLa);
    check('dupla com placar não pode ser substituída', r.semBotaoComPlacar && typeof r.bloqueado === 'string');
    check('W.O. grava 6x0 e marca', r.wo);
    check('W.O. aparece no placar', r.woTela);
    check('WhatsApp mostra substituto e W.O.', r.whats);
    check('folha da chave mostra substituto', r.folha);
    check('apagar placar remove W.O.', r.woApagado);
  }
  if (PARTE >= 3) {
    const r = await page.evaluate(() => {
      const R = regrasCompletas({});
      const base = JSON.parse(JSON.stringify(__dadosBase)); base.ids = base.names.map((_, i) => 'id-' + i);
      for (const k of ['q1', 'q2', 'q3', 'q4', 's1', 's2', 'f', 't']) base.finals[k] = [6, 1];
      base.ordemChave = 'planilha';
      const c = comDados(validarDados(base), () => classificadosGerais());
      const sai = c.duos[0][0], entra = c.fora[0], sai2 = c.duos[1][0];
      const semSub = pontosDaEtapa({ id: 'p1', versao: 1, dados: base }, R);
      const comSub = pontosDaEtapa({ id: 'p2', versao: 1, dados: { ...base, subs: [{ sai, entra, atleta: null, motivo: 'lesão', em: '' }, { sai: sai2, entra: 20, atleta: { id: 'cad-1', nome: 'Carlos Cadastro' }, motivo: 'lesão', em: '' }] } }, R);
      const g = (m, i) => m.porId.get('id-' + i);
      const Tv = T, TEv = TE; T = { id: 't', nome: 'x', regras: {}, dados: {} };
      TE = [{ id: 'p3', versao: 1, etapa_numero: 1, status: 'finalizada', excluida_em: null, dados: { ...base, subs: [{ sai: sai2, entra: 20, atleta: { id: 'cad-1', nome: 'Carlos Cadastro' }, motivo: 'lesão', em: '' }] } }];
      let rk; try { rk = calcularRanking().linhas.some((x) => x.id === 'cad-1' && x.total > 0); } finally { T = Tv; TE = TEv; }
      return {
        saiSemSub: g(semSub, sai).mata, saiComSub: g(comSub, sai).mata, saiGrupo: g(comSub, sai).grupo === g(semSub, sai).grupo,
        entraGrupo: g(comSub, entra).grupo === g(semSub, entra).grupo, entraMata: g(comSub, entra).mata, entraSemSub: g(semSub, entra).mata,
        ext: comSub.porId.get('cad-1') && comSub.porId.get('cad-1').mata, extGrupo: comSub.porId.get('cad-1') && comSub.porId.get('cad-1').grupo,
        sai2: g(comSub, sai2).mata, completo: comSub.mataCompleto, rk,
      };
    });
    check('quem saiu fica só com os grupos', r.saiSemSub > 0 && r.saiComSub === 0 && r.saiGrupo && r.sai2 === 0, JSON.stringify(r));
    check('substituto da liga soma grupos + mata-mata', r.entraSemSub === 0 && r.entraMata > 0 && r.entraGrupo, JSON.stringify(r));
    check('atleta de fora aparece no ranking da temporada', r.rk === true);
    check('atleta de fora recebe o mata-mata', r.ext > 0 && r.extGrupo === 0 && r.completo, JSON.stringify(r));
  }
  check('sem erros JS', erros.length === 0, erros.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
