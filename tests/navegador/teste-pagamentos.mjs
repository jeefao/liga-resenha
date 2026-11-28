// Tags de pagamento e ordem alfabética nas listas de inscritos (administração e consulta).
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8807;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-pg-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORTA}/index.html`;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 900 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText);
  // liga com cobrança: Zeca pendente, Bia paga, Ana isenta (fora da ordem alfabética de propósito)
  const prepara = () => ev(() => {
    const bia = { id: 'atl-bia', nome: 'Bia Teste', apelido: null, situacao: 'membro', observacoes: null, versao: 1, atualizado_em: new Date().toISOString() };
    __db.atletas[bia.id] = bia;
    __db.contas['bia@teste.local'] = { id: 'u-bia', email: 'bia@teste.local', senha: 'bia123' };
    __db.acessos['u-bia'] = { user_id: 'u-bia', email: 'bia@teste.local', nome_informado: 'Bia Teste', atleta_id: 'atl-bia', status: 'aprovado', criado_em: new Date().toISOString() };
    __db.ligas.lp = { id: 'lp', nome: 'Relâmpago Pagamentos', data: '2026-12-20', participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(),
      dados: { names: ['Zeca Teste', 'Bia Teste', 'ana Nome', ...Array(13).fill('')], ids: [null, 'atl-bia', ...Array(14).fill(null)], scores: {}, finals: {}, breaks: {} } };
    __db.fin.rodadas.lp = { liga_id: 'lp', liga_nome: 'Relâmpago Pagamentos', inscricao_centavos: null };
    __db.fin.inscricoes['lp|atl-bia'] = { liga_id: 'lp', chave: 'atl-bia', nome: 'Bia Teste', atleta_id: 'atl-bia', status: 'pago', valor_centavos: 5000 };
    __db.fin.inscricoes['lp|nome:ana nome'] = { liga_id: 'lp', chave: 'nome:ana nome', nome: 'ana Nome', atleta_id: null, status: 'isento', valor_centavos: 0 };
  });
  const linhas = (sel) => ev((s) => [...document.querySelectorAll(s)].map((x) => x.innerText.replace(/\s+/g, ' ').trim()), sel);

  // administração: painel da liga
  await page.goto(URL0); await espera(200); await prepara();
  // ordem das listas: próximas primeiro (da mais perto à mais longe), depois as que já passaram
  const ordem = () => ev(() => {
    const d = (n) => { const x = new Date(Date.now() + n * 864e5); return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
    const base = __db.ligas.lp;
    __db.ligas.lLonge = { ...base, id: 'lLonge', nome: 'Rel Longe', data: d(40), dados: { ...base.dados } };
    __db.ligas.lPerto = { ...base, id: 'lPerto', nome: 'Rel Perto', data: d(2), dados: { ...base.dados } };
    __db.ligas.lPassou = { ...base, id: 'lPassou', nome: 'Rel Passou', data: d(-5), dados: { ...base.dados } };
    __db.ligas.lAntiga = { ...base, id: 'lAntiga', nome: 'Rel Antiga', data: d(-60), dados: { ...base.dados } };
    __db.ligas.lp.data = d(10);
  });
  await ordem(); await ev(() => carregarLista()); await espera(500);
  let ord = await ev(() => [...document.querySelectorAll('.liga-card h3')].map((h) => h.innerText.trim()).filter((n) => n.startsWith('Rel')));
  check('ADM: relâmpagos da mais próxima para a mais distante, passadas no fim', ord.join(' / ') === 'Rel Perto / Relâmpago Pagamentos / Rel Longe / Rel Passou / Rel Antiga', ord.join(' / '));
  check('ADM: temporada usa a próxima data (etapa futura antes de uma que já passou)', await ev(() => {
    const ts = [{ id: 't1', nome: 'A', inicio: '2020-01-01', dados: { datas: { 1: '2020-02-01' } } }, { id: 't2', nome: 'B', inicio: '2020-01-01', dados: { datas: { 1: '2020-02-01', 2: '2099-03-01' } } }];
    return porProximidade(ts, (t) => dataTemporada(t, [])).map((t) => t.id).join() === 't2,t1';
  }));
  await ev(() => abrirLiga('lp')); await espera(500); await ev(() => { tab = 'Painel'; render(); }); await espera(300);
  let t0, l = await linhas('.inscritos > div');
  if (!l.length) throw new Error('sem lista: ' + (await ev(() => view + '/' + tab + ' ' + document.body.innerText.slice(0, 300))));
  check('ADM: inscritos em ordem alfabética, vagos no fim', l[0].startsWith('01 • ana Nome') && l[1].startsWith('02 • Bia Teste') && l[2].startsWith('03 • Zeca Teste') && l[3] === '04 • (vago)' && l.length === 16, l.slice(0, 4).join(' / '));
  check('ADM: tag Pago no pago e Isento no isento; pendente sem tag', l[1].endsWith('Pago') && l[0].endsWith('Isento') && l[2] === '03 • Zeca Teste', l.slice(0, 3).join(' / '));
  await page.screenshot({ path: SAIDA + '/inscritos-adm.png', fullPage: true });
  await ev(() => { tab = 'Classificação'; render(); }); await espera(200);
  t0 = await ev(() => document.getElementById('main').innerText);
  check('ADM: sem sorteio, Classificação só avisa (sem grupos)', !/Grupo [A-D]/.test(t0) && t0.includes('Realize o sorteio'), t0.slice(0, 300));
  await ev(() => { tab = 'Painel'; render(); }); await espera(200);
  check('ADM: a ordem dos dados da liga não mudou', await ev(() => S.names[0] === 'Zeca Teste' && S.names[1] === 'Bia Teste'));
  // sem cobrança: sem tags
  await ev(() => { delete __db.fin.rodadas.lp; abrirLiga('lp'); }); await espera(500); await ev(() => { tab = 'Painel'; render(); }); await espera(300);
  l = await linhas('.inscritos > div');
  check('ADM: rodada sem cobrança fica sem tags', !l.some((x) => /Pago|Isento/.test(x)), l.slice(0, 3).join(' / '));

  // consulta: atleta logada
  await ev(() => localStorage.setItem('mock:sessao', 'nenhuma')); await page.reload(); await espera(200); await prepara();
  await ev(async () => { const { data } = await sb.auth.signInWithPassword({ email: 'bia@teste.local', password: 'bia123' }); usuario = data.user; verificarAcesso(); }); await espera(600);
  await ordem(); await ev(() => abrirConsulta()); await espera(500); await ev(() => irSecaoPublica('relampagos')); await espera(300);
  ord = await ev(() => [...document.querySelectorAll('.match-card b')].map((h) => h.innerText.trim()).filter((n) => n.startsWith('Rel')));
  check('consulta: relâmpagos da mais próxima para a mais distante', ord.join(' / ') === 'Rel Perto / Relâmpago Pagamentos / Rel Longe / Rel Passou / Rel Antiga', ord.join(' / '));
  await ev(() => abrirEtapaPublica('lp')); await espera(500);
  l = await linhas('.lista-insc li');
  check('consulta: ordem alfabética com as tags', l.join(' / ') === 'ana Nome Isento / Bia Teste Pagamento Confirmado / Zeca Teste Falta Pagamento', l.join(' / '));
  await page.screenshot({ path: SAIDA + '/inscritos-consulta.png', fullPage: true });
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
