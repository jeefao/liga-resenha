// Painel do atleta logado (próxima etapa: inscrito/pago), tag ADM, histórico do app e do financeiro, atualizar e rodapé.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8806;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-pa-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORTA}/index.html`, URLC = `http://127.0.0.1:${PORTA}/index.html`;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 900 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'prov123' : undefined));
  await page.evaluateOnNewDocument(MOCK);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText);
  const futuro = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), fmt = futuro.split('-').reverse().join('/');
  const prox = () => ev(() => { const e = document.querySelector('.prox-etapa'); return e ? e.textContent : null; });
  // cenário: atleta Bia aprovada e ligada ao cadastro, inscrita numa relâmpago futura com cobrança e pagamento
  const prepara = () => ev((dia) => {
    const bia = { id: 'atl-bia', nome: 'Bia Teste', apelido: null, situacao: 'membro', observacoes: null, versao: 1, atualizado_em: new Date().toISOString() };
    __db.atletas[bia.id] = bia; __db.atletas['atl-caio'] = { ...bia, id: 'atl-caio', nome: 'Caio Teste' };
    __db.contas['bia@teste.local'] = { id: 'u-bia', email: 'bia@teste.local', senha: 'bia123' };
    __db.acessos['u-bia'] = { user_id: 'u-bia', email: 'bia@teste.local', nome_informado: 'Bia Teste', atleta_id: 'atl-bia', status: 'aprovado', criado_em: new Date().toISOString() };
    __db.ligas.lp = { id: 'lp', nome: 'Relâmpago Futura', data: dia, participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(),
      dados: { names: ['Bia Teste', 'Caio Teste', ...Array(14).fill('')], ids: ['atl-bia', 'atl-caio', ...Array(14).fill(null)], scores: {}, finals: {}, breaks: {} } };
    __db.fin.rodadas.lp = { liga_id: 'lp', liga_nome: 'Relâmpago Futura', inscricao_centavos: null };
    __db.fin.inscricoes['lp|atl-bia'] = { liga_id: 'lp', chave: 'atl-bia', nome: 'Bia Teste', atleta_id: 'atl-bia', status: 'pago', valor_centavos: 5000 };
    __db.historico = [
      { em: '2026-11-28T15:00:00Z', area: 'financeiro', quem: 'Administrador', acao: 'marcou pago R$ 50,00', alvo: 'Bia Teste • Relâmpago Futura', vezes: 1 },
      { em: '2026-11-28T14:00:00Z', area: 'visita', quem: 'Bia Teste', acao: 'abriu o app', alvo: null, vezes: 3 },
      { em: '2026-11-28T13:00:00Z', area: 'atletas', quem: 'Administrador', acao: 'cadastrou o atleta', alvo: 'Caio Teste', vezes: 1 }];
  }, futuro);

  // atleta logada
  await page.goto(URL0); await ev(() => localStorage.setItem('mock:sessao', 'nenhuma')); await page.reload(); await espera(150);
  await prepara();
  await ev(async () => { const { data } = await sb.auth.signInWithPassword({ email: 'bia@teste.local', password: 'bia123' }); usuario = data.user; verificarAcesso(); }); await espera(600);
  let t = await txt();
  check('atleta abre direto no próprio painel', (await ev(() => view + '/' + pSec)) === 'publica/inicio' && t.includes('Bia Teste') && t.includes('você') && t.includes('Participações (1)'), (await ev(() => view + '/' + pSec)) + ' ' + t.slice(0, 900).split('\n').join(' ¦ '));
  check('próxima etapa: data, inscrito e pago', (await prox()) === 'Próxima etapa: ' + fmt + ' - Inscrito - Pago', await prox());
  check('visita registrada ao abrir', await ev(() => (__db.visitas || []).includes('bia@teste.local')));
  check('rodapé novo', t.includes('Liga Resenha BT - Desenvolvido por Jeferson Moreno - Versão ' + (await ev(() => APP_VERSION))) && !t.includes('Página só de consulta'));
  await page.screenshot({ path: SAIDA + '/painel-atleta.png', fullPage: true });
  // pagamento pendente e não inscrito
  await ev(() => { delete __db.fin.inscricoes['lp|atl-bia']; }); await ev(() => abrirConsulta()); await espera(300);
  check('pagamento pendente', ((await prox()) || '').endsWith('Inscrito - Pagamento pendente'), await prox());
  await ev(() => { __db.ligas.lp.dados.ids[0] = null; __db.ligas.lp.dados.names[0] = ''; }); await ev(() => abrirConsulta()); await espera(300);
  check('não inscrito: sem informação de pagamento', (await prox()) === 'Próxima etapa: ' + fmt + ' - Não inscrito', await prox());
  // ver o painel de outro atleta
  await ev(() => escolherPainel('atl-caio')); await espera(100);
  check('escolhe o painel de outro atleta', (await txt()).includes('Caio Teste') && !(await ev(() => document.querySelector('.painel-escolha select').disabled)));

  // dono: atualizar, histórico do app, tag ADM e histórico do financeiro
  await ev(() => localStorage.setItem('mock:sessao', 'admin@teste')); await page.goto(URL0); await espera(150);
  await prepara(); await ev(() => { __db.contas['bia@teste.local'].admin = true; __db.contas['bia@teste.local'].permissoes = ['ligas']; }); await ev(() => verificarAcesso()); await espera(400);
  t = await txt();
  check('início do administrador tem ↻ Atualizar', t.includes('↻ Atualizar'));
  await ev(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Atualizar')).click()); await espera(300);
  check('atualizar recarrega sem erro', (await ev(() => view)) === 'inicio');
  check('histórico do app fica abaixo da lixeira', await ev(() => { const s = [...document.querySelectorAll('summary')].map((x) => x.innerText); return s.findIndex((x) => x.startsWith('Histórico do app')) > s.findIndex((x) => x.startsWith('Lixeira')); }));
  await ev(() => { const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('summary').innerText.startsWith('Histórico do app')); d.open = true; }); await espera(400);
  t = await txt();
  check('histórico mostra quem, o quê e quando', t.includes('cadastrou o atleta: Caio Teste') && t.includes('abriu o app') && t.includes('(3 vezes)'), t.slice(-900));
  await ev(() => filtrarHistApp('visita')); await espera(300);
  t = await txt();
  check('filtro de visitas', t.includes('abriu o app') && !t.includes('cadastrou o atleta'));
  await page.screenshot({ path: SAIDA + '/historico-app.png', fullPage: true });
  await ev(() => abrirAtletas()); await espera(400);
  check('tag ADM no atleta administrador', await ev(() => { const r = [...document.querySelectorAll('.atl-row')].find((x) => x.innerText.includes('Bia Teste')); return !!(r && r.querySelector('.ac-adm')); }));
  check('atleta comum sem tag ADM', await ev(() => { const r = [...document.querySelectorAll('.atl-row')].find((x) => x.innerText.includes('Caio Teste')); return !!(r && !r.querySelector('.ac-adm')); }));
  await ev(() => abrirFinancas()); await espera(300); await ev(() => { finTab = 'Histórico'; render(); }); await espera(400);
  t = await txt();
  check('finanças: aba Histórico só com o financeiro', t.includes('Histórico do financeiro') && t.includes('marcou pago R$ 50,00') && !t.includes('abriu o app'));
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
