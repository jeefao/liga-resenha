// Login dos atletas na página de consulta e aba Usuários do administrador.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8802;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-ac-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORTA}/index.html`, URLC = `http://127.0.0.1:${PORTA}/index.html`;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 900 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'prov123' : undefined));
  await page.evaluateOnNewDocument(MOCK);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText);
  const digita = async (id, v) => { await page.$eval('#' + id, (e) => (e.value = '')); await page.type('#' + id, v); };

  // sem login: tela de entrar
  await page.goto(URLC); await ev(() => localStorage.setItem('mock:sessao', 'nenhuma')); await page.reload(); await espera(300);
  check('sem login a consulta pede para entrar', (await ev(() => view)) === 'acesso' && (await txt()).includes('Criar conta') && !(await txt()).includes('Rodada atual'));
  check('campos de login habilitados', await ev(() => !$('email').disabled && !$('senha').disabled));
  await page.screenshot({ path: SAIDA + '/acesso-entrar.png' });

  // cria conta → pedido pendente
  await ev(() => { aModo = 'criar'; render(); });
  await digita('nome', 'Bia Teste'); await digita('email', 'bia@teste'); await digita('senha', '123456'); await digita('senha2', '654321');
  await page.click('#btnEntrar'); await espera(100);
  check('senhas diferentes são recusadas', (await ev(() => $('loginMsg').textContent)).includes('não são iguais'));
  await digita('senha2', '123456'); await page.click('#btnEntrar'); await espera(400);
  const tp = await txt();
  check('conta criada fica aguardando aprovação', tp.includes('Aguardando a aprovação') && tp.includes('Bia Teste') && (await ev(() => __db.acessos['u-bia@teste'].status)) === 'pendente', tp.slice(0, 300));
  await page.screenshot({ path: SAIDA + '/acesso-pendente.png' });

  // administrador: aba Usuários
  await ev(() => { localStorage.setItem('mock:sessao', 'admin@teste'); __db.acessos['u-x'] = { user_id: 'u-x', email: 'x@teste', nome_informado: 'Fulano', atleta_id: null, status: 'pendente', criado_em: new Date().toISOString() }; });
  const acessosAntes = await ev(() => JSON.stringify(__db.acessos));
  await page.goto(URL0); await espera(300);
  // o mock é recriado a cada carga: recoloca o atleta e os pedidos
  await ev((a) => { Object.assign(__db.acessos, JSON.parse(a)); const id = 'atl-bia'; __db.atletas[id] = { id, nome: 'Bia Teste', apelido: null, situacao: 'membro', observacoes: null, versao: 1, atualizado_em: new Date().toISOString() }; __db.contas['bia@teste'] = { id: 'u-bia@teste', email: 'bia@teste', senha: '123456' }; __db.contas['x@teste'] = { id: 'u-x', email: 'x@teste', senha: '123456' }; }, acessosAntes);
  check('administrador tem o botão Usuários', (await txt()).includes('Usuários'));
  await ev(() => abrirUsuarios()); await espera(300);
  const tu = await txt();
  check('lista mostra os pedidos pendentes', tu.includes('Aguardando aprovação (2)') && tu.includes('bia@teste') && tu.includes('Fulano'), tu.slice(0, 400));
  check('atleta sugerido pelo nome', (await ev(() => $('ua-u-bia@teste').value)) === 'atl-bia');
  check('senha não aparece na lista', !tu.includes('123456'));
  await page.screenshot({ path: SAIDA + '/usuarios.png', fullPage: true });
  await ev(() => acaoAcesso('u-x', 'aprovado')); await espera(200);
  check('aprovar sem atleta é recusado', (await ev(() => __db.acessos['u-x'].status)) === 'pendente');
  await ev(() => acaoAcesso('u-bia@teste', 'aprovado')); await espera(300);
  check('aprovar liga ao atleta do cadastro', (await ev(() => __db.acessos['u-bia@teste'].status + '/' + __db.acessos['u-bia@teste'].atleta_id)) === 'aprovado/atl-bia');
  await ev(() => trocarSenhaAcesso('u-bia@teste')); await espera(200);
  check('trocar senha define a provisória', (await ev(() => __db.contas['bia@teste'].senha)) === 'prov123');
  await ev(() => acaoAcesso('u-x', 'bloqueado')); await espera(200);
  check('bloquear', (await ev(() => __db.acessos['u-x'].status)) === 'bloqueado' && (await txt()).includes('Desbloquear'));
  await ev(() => excluirAcesso('u-x')); await espera(300);
  check('excluir conta some da lista', !(await ev(() => !!__db.acessos['u-x'])) && !(await txt()).includes('x@teste'));
  const estado = await ev(() => JSON.stringify({ acessos: __db.acessos, atletas: __db.atletas, contas: __db.contas }));

  // atleta aprovado entra com a senha provisória e vê "Bem-vindo"
  await ev(() => localStorage.setItem('mock:sessao', 'nenhuma'));
  await page.goto(URLC); await espera(300);
  await ev((e) => { const x = JSON.parse(e); Object.assign(__db.acessos, x.acessos); Object.assign(__db.atletas, x.atletas); Object.assign(__db.contas, x.contas); }, estado);
  await digita('email', 'bia@teste'); await digita('senha', '123456'); await page.click('#btnEntrar'); await espera(300);
  check('senha antiga não entra mais', (await ev(() => $('loginMsg').textContent)).includes('incorretos'));
  await digita('senha', 'prov123'); await page.click('#btnEntrar'); await espera(500);
  const tw = await txt();
  check('aprovado entra na consulta com Bem-vindo', (await ev(() => view)) === 'publica' && tw.includes('Bem-vindo, Bia Teste'), tw.slice(0, 300));
  await page.screenshot({ path: SAIDA + '/acesso-bemvindo.png' });
  // bloqueado depois: ao atualizar, volta para a tela de acesso
  await ev(async () => { __db.acessos['u-bia@teste'].status = 'bloqueado'; await abrirConsulta(); }); await espera(300);
  check('bloqueado perde a consulta', (await ev(() => view)) === 'acesso' && (await txt()).includes('acesso está bloqueado'));
  await ev(async () => { await sb.auth.signOut(); usuario = null; meuAcesso = null; view = 'acesso'; render(); });
  check('depois de sair volta para entrar', (await txt()).includes('ENTRAR'));

  // administrador: entra pelo mesmo endereço, cai na administração e abre a consulta dentro do app
  await ev(() => localStorage.setItem('mock:sessao', 'nenhuma'));
  await page.goto(URL0); await espera(300);
  await digita('email', 'admin@teste'); await digita('senha', 'admin123'); await page.click('#btnEntrar'); await espera(500);
  check('administrador entra na administração pelo mesmo login', (await ev(() => view)) === 'inicio' && (await txt()).includes('Página de consulta'));
  await ev(() => abrirConsulta()); await espera(300);
  check('administrador vê a consulta igual aos atletas', (await ev(() => view)) === 'publica' && (await txt()).includes('Bem-vindo, administrador') && (await txt()).includes('Rodada atual'));
  await page.screenshot({ path: SAIDA + '/acesso-admin-consulta.png' });
  await ev(() => abrirAdministracao()); await espera(300);
  check('administrador volta para a administração', (await ev(() => view)) === 'inicio' && (await txt()).includes('Usuários'));
  // conta de atleta sem pedido: tela para pedir acesso, nunca a administração
  await ev(() => localStorage.setItem('mock:sessao', 'outro@teste'));
  await page.goto(URL0); await espera(500);
  check('atleta sem pedido não vê a administração', (await ev(() => view)) === 'acesso' && (await txt()).includes('PEDIR ACESSO') && !(await txt()).includes('Usuários'));
  // endereço antigo /adm/ leva ao endereço principal
  await page.goto(`http://127.0.0.1:${PORTA}/adm/`); await espera(500);
  check('endereço /adm/ redireciona para o principal', !page.url().includes('/adm'), page.url());
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
