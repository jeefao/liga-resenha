// Teste das temporadas: pontos da etapa, ranking, confronto direto e telas.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';

const RAIZ = process.argv[2], SAIDA = process.argv[3];
const PORTA = 8792;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-tp-')) });
const ok = [], falhas = [];
const check = (nome, cond, extra = '') => (cond ? ok : falhas).push(nome + (cond ? '' : ' → ' + extra));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const dialogos = [];
  page.on('dialog', async (d) => { dialogos.push(d.message()); await (d.type() === 'prompt' ? d.accept('Teste de regra') : d.accept()); });
  const errosJs = []; page.on('pageerror', (e) => errosJs.push(e.message));
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(500);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText);

  // Atletas A00..A15 + X
  await ev(() => { for (let i = 0; i < 16; i++) window.__db.atletas['a' + i] = { id: 'a' + i, nome: 'A' + String(i).padStart(2, '0'), situacao: 'membro', versao: 1 }; window.__db.atletas.x = { id: 'x', nome: 'Xavier', situacao: 'convidado', versao: 1 }; });
  await ev(() => carregarAtletas()); await espera(200);

  // Etapa com resultados calculados à mão
  const dadosEtapa = (troca) => {
    const ids = Array.from({ length: 16 }, (_, i) => 'a' + i); if (troca) ids[0] = 'x';
    const scores = {}; for (let g = 0; g < 4; g++) { scores[g + '-0'] = [6, 0]; scores[g + '-1'] = [6, 2]; scores[g + '-2'] = [6, 4]; }
    return { names: ids.map((id) => (id === 'x' ? 'Xavier' : 'A' + id.slice(1).padStart(2, '0'))), ids, scores,
      breaks: { 'r0:0,4,8,12': [0, 4, 8], 'r1:1,5,9,13': [1, 5, 9], 'r2:2,6,10,14': [2, 6, 10], 'r3:3,7,11,15': [3, 7, 11] },
      finals: { q1: [6, 1], q2: [2, 6], q3: [6, 3], q4: [6, 2], s1: [6, 4], s2: [3, 6], f: [7, 5], t: [6, 2] }, drawn: true, status: 'ended' };
  };
  const R = await ev((d) => { const p = pontosDaEtapa({ id: 'e', versao: 1, dados: d }, regrasCompletas({})); return Object.fromEntries([...p.porId].map(([k, v]) => [k, v.total])); }, dadosEtapa(false));
  const esperado = { a0: 27, a4: 27, a1: 20, a8: 20, a2: 12, a9: 13, a3: 6, a11: 6, a10: 8, a5: 20, a12: 20, a6: 12, a13: 13, a7: 6, a15: 6, a14: 8 };
  check('pontos da etapa batem com a conta à mão', JSON.stringify(Object.keys(esperado).sort().map((k) => [k, R[k]])) === JSON.stringify(Object.keys(esperado).sort().map((k) => [k, esperado[k]])), JSON.stringify(R));

  // Confronto direto: procura um grupo com empate em V/SG/GP e confere
  const conf = await ev(() => {
    let achou = 0, certo = 0;
    for (let t = 0; t < 4000 && achou < 25; t++) {
      const sc = {}; for (let j = 0; j < 3; j++) { const a = Math.floor(Math.random() * 7), b = Math.floor(Math.random() * 7); if (a === b) { j--; continue; } sc['0-' + j] = [a, b]; }
      const d = { names: Array.from({ length: 16 }, (_, i) => 'N' + i), ids: Array(16).fill(null), scores: sc, finals: {}, breaks: {}, drawn: true, status: 'drawn' };
      const res = comDados(validarDados(d), () => {
        CONFRONTO_DIRETO = false; const r0 = rank(0); const pend0 = pending('g0', r0);
        CONFRONTO_DIRETO = true; const r1 = rank(0); const pend1 = pending('g0', r1);
        CONFRONTO_DIRETO = false;
        return { r0: r0.map((x) => x.i), r1: r1.map((x) => x.i), pend0, pend1, cmpEq: r0.some((x, i) => i && cmp(r0[i - 1], x) === 0) };
      });
      if (!res.cmpEq) continue;
      // existe empate nos 3 critérios: com confronto, ou desempata ou continua pendente
      achou++;
      // verificação: para cada par vizinho empatado em V/SG/GP e com confronto diferente, a ordem segue o confronto
      const okPar = comDados(validarDados(d), () => { CONFRONTO_DIRETO = true; const r = rank(0); let bom = true;
        for (let i = 1; i < r.length; i++) if (cmp(r[i - 1], r[i]) === 0) { const bl = r.filter((y) => cmp(y, r[i]) === 0).map((y) => y.i); if (bl.length === 2 && saldoConfronto(r[i - 1].i, bl) < saldoConfronto(r[i].i, bl)) bom = false; }
        CONFRONTO_DIRETO = false; return bom; });
      if (okPar && (!res.pend1 || res.pend0)) certo++;
    }
    return { achou, certo };
  });
  check('confronto direto ordena empates de 2 (' + conf.achou + ' casos)', conf.achou > 5 && conf.achou === conf.certo, JSON.stringify(conf));

  // Temporada pela tela
  await ev(() => { view = 'nova-temporada'; render(); }); await espera(100);
  check('nova temporada vem com regras padrão', (await ev(() => [$('rgEtapas').value, $('rgDobradas').value, $('rgDescartes').value, $('rgEspeciais').value].join('|'))) === '10|5|1|3, 7');
  await page.type('#ntNome', 'Temporada Teste');
  await ev(() => { $('rgEtapas').value = 3; $('rgDobradas').value = '2'; $('rgAusencia').value = 'minimo'; });
  await page.click('#ntBtn'); await espera(500);
  check('temporada aberta na aba Etapas', (await ev(() => view + '/' + tTab)) === 'temporada/Etapas' && (await txt()).includes('Etapa 3'));
  // cria etapa 1 pela tela
  await ev(() => abrirNovaEtapa(1)); await page.click('#neBtn'); await espera(600);
  check('etapa 1 abre como liga da temporada', (await ev(() => view === 'liga' && L.etapa_numero === 1 && CONFRONTO_DIRETO)) && (await txt()).includes('Etapa 1 da temporada'));
  // grava resultados nas etapas 1 e 2 direto no banco simulado (encerradas)
  const tid = await ev(() => L.temporada_id);
  await ev(({ tid, d1, d2 }) => {
    const l1 = Object.values(__db.ligas).find((l) => l.etapa_numero === 1); Object.assign(l1, { dados: d1, status: 'finalizada', versao: 9 });
    const id2 = crypto.randomUUID(); __db.ligas[id2] = { ...l1, id: id2, etapa_numero: 2, dados: d2, versao: 3 };
  }, { tid, d1: dadosEtapa(false), d2: dadosEtapa(true) });
  await ev(() => voltarInicio(true)); await espera(500);
  check('voltar da etapa vai para a temporada', (await ev(() => view)) === 'temporada');
  await ev(() => { tTab = 'Ranking'; render(); }); await espera(100);
  const rk = await ev(() => Object.fromEntries(calcularRanking().linhas.map((x) => [x.nome, x.total + ':' + x.cel.map((c) => (c.valor ?? '-') + (c.descarte ? 'D' : '')).join(',')])));
  // A00: E1 27, E2 falta = mínimo (5-3=2) x2 = 4 (descartada) → 27
  check('ausência com valor mínimo dobrado e descartada', rk.A00 === '27:27,4D,-', rk.A00);
  check('etapa dobrada e descarte da pior', rk.A04 === '54:27D,54,-', rk.A04);
  check('convidado que faltou na E1', rk.Xavier === '54:2D,54,-', rk.Xavier);
  // ajuste −5
  await ev(() => { tTab = 'Ajustes'; render(); }); await espera(100);
  await page.select('#ajAtleta', 'a4'); await page.type('#ajMotivo', 'Atraso'); await page.click('button[onclick="adicionarAjuste()"]'); await espera(400);
  check('ajuste −5 aplicado', (await ev(() => calcularRanking().linhas.find((x) => x.id === 'a4').total)) === 49);
  check('motivo do ajuste no histórico', (await ev(() => window.__tmot.join('|'))).includes('Ajuste: A04 -5 (Atraso)'));
  // regras: tirar descarte recalcula
  await ev(() => { tTab = 'Regras'; render(); }); await ev(() => { $('rgDescartes').value = 0; }); await ev(() => salvarRegras()); await espera(400);
  check('sem descarte: A04 = 27+54−5 = 76', (await ev(() => calcularRanking().linhas.find((x) => x.id === 'a4').total)) === 76);
  await ev(() => { tTab = 'Ranking'; render(); }); await espera(100);
  check('tabela do ranking na tela', (await txt()).includes('E2') && (await ev(() => document.querySelectorAll('.rk tr').length)) === 18);
  await page.screenshot({ path: SAIDA + '/ranking.png' });
  await ev(() => detalheAtletaTemporada('a0')); await espera(100);
  check('detalhe do atleta', (await txt()).includes('3 vitória(s), 1 bônus 6×0, 1º lugar = 16'));
  await ev(() => fecharModal());
  // início mostra temporada e não mostra etapas na lista de relâmpagos
  await ev(() => sairDaTemporada()); await espera(400);
  const t = await txt();
  check('início: temporada listada', t.includes('Temporadas') && t.includes('Temporada Teste') && t.includes('2 de 3 etapas'));
  check('início: etapas fora das ligas relâmpago', t.includes('Ligas relâmpago') && !t.includes('Temporada Teste — Etapa'));
  await page.screenshot({ path: SAIDA + '/inicio.png' });
  // sorteio de etapa usa etapas anteriores da temporada
  const hist = await ev(async () => { const l3 = crypto.randomUUID(); await sb.rpc('criar_etapa', { p_temporada_id: T ? T.id : temporadas[0].id, p_numero: 3, p_id: l3, p_nome: 'E3', p_data: hoje(), p_dados: { names: Array(16).fill(''), ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {}, drawn: false, status: 'draft' } }); await abrirLiga(l3); return (await historicoDeGrupos()).length; });
  check('sorteio da etapa 3 considera as 2 etapas anteriores', hist === 2, String(hist));
  // WhatsApp: liga encerrada (etapa 1)
  const w = await ev(async () => { const l1 = Object.values(__db.ligas).find((l) => l.etapa_numero === 1); await abrirLiga(l1.id); abrirWhatsApp(); return $('wTexto').value; });
  check('whats: cabeçalho e grupos', w.includes('🎾 *Temporada Teste — Etapa 1*') && w.includes('*GRUPO A*') && w.includes('1) *A00 / A01*  6 x 0  A02 / A03'));
  check('whats: mata-mata e campeões', w.includes('Quartas 1: *A00 / A04*  6 x 1  A11 / A15') && w.includes('🥇 Campeões: *A00 / A04*') && w.includes('🥉 3º lugar: *A02 / A06*'.replace(/\*/g, '')));
  await ev(() => { wOp.classif = true; $('wTexto').value = textoWhatsApp(wOp); });
  check('whats: classificação opcional', (await ev(() => $('wTexto').value)).includes('1º A00 — 3V, saldo +12'));
  await page.screenshot({ path: SAIDA + '/whats.png' });
  console.log('----- TEXTO -----\n' + (await ev(() => $('wTexto').value)).split('\n').slice(0, 22).join('\n'));
  await ev(() => { fecharModal(); });
  const wr = await ev(async () => { await abrirTemporada(L.temporada_id); return textoRankingTemporada(); });
  check('whats: ranking da temporada', wr.includes('1º A04 — *76*'), wr.slice(0, 200));
  // liga antes do sorteio: sai a lista de atletas
  const wl = await ev(async () => { const l3 = Object.values(__db.ligas).find((l) => l.etapa_numero === 3); l3.dados.names[0] = 'Fulano'; await abrirLiga(l3.id); abrirWhatsApp(); return $('wTexto').value; });
  check('whats: antes do sorteio mostra atletas', wl.includes('01. Fulano') && wl.includes('Grupos ainda não sorteados'));
  check('sem erros de JavaScript', errosJs.length === 0, errosJs.join(' | '));
  // ---- Página pública (só consulta)
  const tidP = await ev(() => Object.values(__db.temporadas)[0].id);
  await ev((id) => abrirTemporada(id), tidP); await espera(400);
  await ev(() => { tTab = 'Ranking'; render(); }); await espera(50);
  check('botão copiar link da página de consulta', (await txt()).includes('Copiar link da página de consulta') && !(await txt()).includes('Ligar página pública'));
  const rkAdmin = await ev(() => calcularRanking().linhas.map((x) => x.pos + ':' + x.nome + ':' + x.total).join('|'));
  // datas previstas: temporada passa a ter 5 etapas; marca a data da 4 pela tela
  await ev(async () => { await salvarTemporada({ p_regras: { ...T.regras, etapas: 5 } }, 'Teste: 5 etapas'); tTab = 'Etapas'; render(); }); await espera(100);
  check('campo de data prevista nas etapas não criadas', await ev(() => !!$('dp4') && !!$('dp5') && !$('dp1')));
  await ev(() => salvarDataPrevista(4, '2027-03-07')); await espera(300);
  check('data prevista gravada na temporada', await ev((id) => __db.temporadas[id].dados.datas['4'] === '2027-03-07' && $('dp4').value === '2027-03-07', tidP));
  check('criar etapa já vem com a data prevista', await ev(() => { abrirNovaEtapa(4); const v = $('neData').value; fecharModal(); return v === '2027-03-07'; }));
  // ligas relâmpago: uma criada (aparece), uma arquivada e uma na lixeira (não aparecem)
  await ev(() => { const base = { temporada_id: null, etapa_numero: null, participantes: 16, etapa: 'cadastro', versao: 1, atualizado_em: new Date().toISOString(), excluida_em: null };
    const dd = (n) => ({ names: [n, ...Array(15).fill('')], ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} });
    __db.ligas.rel1 = { ...base, id: 'rel1', nome: 'Relâmpago Feriado', data: '2027-04-21', status: 'preparacao', dados: dd('Inscrito Um') };
    __db.ligas.rel2 = { ...base, id: 'rel2', nome: 'Relâmpago Arquivada', data: '2027-04-22', status: 'arquivada', dados: dd('X') };
    __db.ligas.rel3 = { ...base, id: 'rel3', nome: 'Relâmpago Lixeira', data: '2027-04-23', status: 'preparacao', excluida_em: new Date().toISOString(), dados: dd('Y') }; });
  const banco = await ev(() => JSON.stringify(__db));
  const pub = await browser.newPage(); await pub.setViewport({ width: 390, height: 844 });
  const errosPub = []; pub.on('pageerror', (e) => errosPub.push(e.message));
  await pub.evaluateOnNewDocument(MOCK);
  await pub.evaluateOnNewDocument((b) => { const d = JSON.parse(b); for (const k of Object.keys(d)) window.__db[k] = d[k]; }, banco);
  await pub.goto(`http://127.0.0.1:${PORTA}/index.html`); await espera(600);
  // o administrador abre a consulta pelo botão do Início (mesma tela dos atletas)
  check('administrador entra na administração', (await pub.evaluate(() => view)) === 'inicio' && (await pub.evaluate(() => document.body.innerText.includes('Página de consulta'))));
  await pub.evaluate(() => abrirConsulta()); await espera(300);
  const evP = (f, ...a) => pub.evaluate(f, ...a), txtP = () => evP(() => document.body.innerText);
  // só a escolha do painel (classe pub) fica liberada na consulta
  const semEdicao = () => evP(() => [...document.querySelectorAll('#main button')].every((b) => b.classList.contains('pub')) && [...document.querySelectorAll('#main input,#main select')].every((e) => e.disabled || e.classList.contains('pub')));
  check('consulta abre no Painel com os 4 botões', (await evP(() => view + '/' + pSec)) === 'publica/inicio' && (await evP(() => ['Painel', 'Rodada atual', 'Temporadas', 'Relâmpagos'].every((x) => [...document.querySelectorAll('#lifecycle button')].some((b) => b.textContent === x)))));
  const ti = await txtP();
  check('painel: sem ligas na tela principal, só a escolha do atleta', ti.includes('Painel do atleta') && ti.includes('Ver o painel de') && !ti.includes('Ver temporada completa') && !ti.includes('Última relâmpago'), ti.slice(0, 900).split('\n').join(' ¦ '));
  check('linha da próxima etapa abaixo dos botões', /Próxima etapa: \d{2}\/\d{2}\/\d{4}/.test(await evP(() => document.querySelector('#lifecycle .prox-etapa').textContent)));
  check('painel sem botões de edição', await semEdicao());
  // painel de um atleta: posição e pontos iguais à classificação geral
  const linhaA04 = rkAdmin.split('|').find((x) => x.split(':')[1] === 'A04').split(':');
  await evP(() => escolherPainel(atletas.find((a) => a.nome === 'A04').id));
  const tp = await txtP();
  check('painel do atleta: números e temporada com a mesma posição do ranking', ['A04', 'Temporadas', 'Etapas', 'Jogos', 'Vitórias', 'Aproveitamento', 'Nas temporadas', 'Participações'].every((x) => tp.includes(x)) && tp.includes(linhaA04[0] + 'º\n' + linhaA04[2] + ' pts'), tp.slice(0, 1200).split('\n').join(' ¦ '));
  const st = await evP(() => { const s = estatisticasAtleta(atletas.find((a) => a.nome === 'A04').id); return { j: s.jogos, v: s.v, p: s.part.length }; });
  check('painel do atleta: jogos e vitórias coerentes', st.j > 0 && st.v <= st.j && st.p >= 1, JSON.stringify(st));
  await pub.screenshot({ path: SAIDA + '/publica-painel.png', fullPage: true });
  await evP(() => irSecaoPublica('temporadas'));
  const tt = await txtP();
  check('temporadas: lista a temporada em andamento', tt.includes('Temporada Teste') && tt.includes('Ver classificação e etapas'));
  await evP(() => abrirTemporadaPublica(PUB.temporadas[0].id));
  check('temporada: classificação geral igual à do administrador', (await evP(() => view)) === 'publica-temporada' && (await evP(() => calcularRanking().linhas.map((x) => x.pos + ':' + x.nome + ':' + x.total).join('|'))) === rkAdmin);
  check('temporada: ranking sem botões de edição', (await semEdicao()) && !(await txtP()).includes('WhatsApp'));
  await pub.screenshot({ path: SAIDA + '/publica-ranking.png' });
  await evP(() => { pTab = 'Etapas'; render(); });
  const te = await txtP();
  check('temporada: etapas atual, próximas e jogadas', ['Atual', 'Próximas', 'Data prevista: 07/03/2027', 'Data a definir', 'Jogadas', 'Encerrada', 'Inscrições'].every((x) => te.includes(x)), te.slice(0, 900).split('\n').join(' ¦ '));
  await evP(() => abrirEtapaPublica(TE.find((l) => l.etapa_numero === 1).id));
  check('etapa abre nos jogos, com voltar para a temporada', (await evP(() => view + '/' + tab)) === 'publica-etapa/Jogos' && (await semEdicao()) && (await txtP()).includes('← Temporada Teste') && (await evP(() => document.querySelectorAll('#main input:disabled').length)) > 0);
  for (const t of ['Grupos', 'Classificação', 'Chave']) { await evP((x) => { tab = x; render(); }, t); check('etapa: aba ' + t + ' sem edição', await semEdicao()); }
  await pub.screenshot({ path: SAIDA + '/publica-chave.png' });
  await evP(() => voltarConsulta());
  check('voltar da etapa volta para as etapas da temporada', (await evP(() => view + '/' + pTab)) === 'publica-temporada/Etapas');
  await evP(() => abrirEtapaPublica(TE.find((l) => l.etapa_numero === 3).id));
  check('etapa sem sorteio mostra atletas', (await txtP()).includes('Grupos ainda não sorteados') && (await txtP()).includes('Fulano'));
  await evP(() => irSecaoPublica('relampagos'));
  const tr = await txtP();
  check('relâmpago criada aparece; arquivada e lixeira não', tr.includes('Relâmpago Feriado') && !tr.includes('Relâmpago Arquivada') && !tr.includes('Relâmpago Lixeira') && (await semEdicao()), tr.slice(0, 600).split('\n').join(' ¦ '));
  await evP(() => abrirEtapaPublica('rel1'));
  check('relâmpago abre os inscritos', (await txtP()).includes('Inscrito Um') && (await txtP()).includes('← Relâmpagos'));
  await evP(() => voltarConsulta());
  check('voltar da relâmpago volta para a lista', (await evP(() => view + '/' + pSec)) === 'publica/relampagos');
  await pub.screenshot({ path: SAIDA + '/publica-relampagos.png' });
  await evP(() => irSecaoPublica('rodada'));
  check('rodada atual abre direto a liga aberta mais recente, sem voltar', (await evP(() => view + '/' + pSec + '/' + !!pOrigem + '/' + ligaEncerrada(L))) === 'publica-etapa/rodada/false/false' && !(await txtP()).replace('← Administração', '').includes('← '));
  await evP(async () => { for (const t of Object.values(__db.temporadas)) t.status = 'arquivada'; for (const l of Object.values(__db.ligas)) if (!l.temporada_id) l.excluida_em = 'x'; await abrirConsulta(); });
  check('sem liga aberta: painel continua abrindo', (await txtP()).includes('Ver o painel de'));
  check('pública: sem erros de script', errosPub.length === 0, errosPub.join(' | '));
} finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
