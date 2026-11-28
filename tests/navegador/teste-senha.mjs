// Esqueci a senha: o atleta pede a senha nova no app e ela só vale depois que o dono aprova.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8805;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-se-')) });
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
  const msg = () => ev(() => $('loginMsg').textContent);
  const conta = { id: 'u-bia', email: 'bia@teste.local', senha: 'antiga1' };
  const acesso = { user_id: 'u-bia', email: 'bia@teste.local', nome_informado: 'Bia Teste', atleta_id: null, status: 'aprovado', criado_em: new Date().toISOString() };
  const prepara = (extra = {}) => ev((c, a, x) => { __db.contas[c.email] = c; __db.acessos[a.user_id] = a; Object.assign(__db.pedidosSenha, x); }, conta, acesso, extra);

  // atleta sem login: "Esqueci a senha"
  await page.goto(URL0); await ev(() => localStorage.setItem('mock:sessao', 'nenhuma')); await page.reload(); await espera(300); await prepara();
  check('tela de entrar tem "Esqueci a senha"', await ev(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Esqueci a senha')));
  check('não manda mais falar com o administrador', !(await txt()).includes('Peça ao administrador'));
  await ev(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Esqueci a senha').click()); await espera(100);
  check('abre o formulário de senha nova', (await txt()).includes('PEDIR NOVA SENHA') && !!(await ev(() => $('senha2'))));
  await digita('email', 'bia@teste.local'); await digita('senha', 'nova123'); await digita('senha2', 'nova124');
  await page.click('#btnEntrar'); await espera(100);
  check('senhas diferentes são recusadas', (await msg()).includes('não são iguais') && !(await ev(() => Object.keys(__db.pedidosSenha).length)));
  await digita('senha', '123'); await digita('senha2', '123'); await page.click('#btnEntrar'); await espera(100);
  check('senha curta é recusada', (await msg()).includes('6 caracteres'));
  await digita('senha', 'nova123'); await digita('senha2', 'nova123');
  const logo = await ev(() => { $('btnEntrar').click(); return $('loginMsg').textContent; });
  check('não mostra "enviado" antes da resposta do servidor', logo === 'Enviando pedido…', logo);
  await espera(250);
  check('pedido enviado e volta para Entrar', (await msg()).includes('Pedido enviado') && (await ev(() => aModo)) === 'entrar' && (await ev(() => $('email').value)) === 'bia@teste.local');
  check('pedido guardado; senha ainda não mudou', (await ev(() => !!__db.pedidosSenha['u-bia'] && __db.contas['bia@teste.local'].senha)) === 'antiga1');
  await page.screenshot({ path: SAIDA + '/senha-pedido.png' });
  await digita('senha', 'nova123'); await page.click('#btnEntrar'); await espera(200);
  check('senha nova ainda não entra antes da aprovação', (await msg()).includes('incorretos'));
  // e-mail desconhecido: mesma resposta, nenhum pedido
  await ev(() => esqueciSenha()); await digita('email', 'ninguem@teste.local'); await digita('senha', 'nova123'); await digita('senha2', 'nova123');
  await page.click('#btnEntrar'); await espera(250);
  check('e-mail desconhecido: mesma resposta e nada guardado', (await msg()).includes('Pedido enviado') && (await ev(() => Object.keys(__db.pedidosSenha).length)) === 1);
  const pedidos = await ev(() => JSON.stringify(__db.pedidosSenha));

  // dono: aviso no botão Usuários e aprovação
  await ev(() => localStorage.setItem('mock:sessao', 'admin@teste')); await page.goto(URL0); await espera(300);
  await prepara(JSON.parse(pedidos)); await ev(() => conferirPendentes()); await espera(300);
  check('botão Usuários avisa o pedido de senha', (await ev(() => { const b = document.querySelector('[onclick^="abrirUsuarios"] .alerta'); return b && b.textContent.trim(); })) === '🔔 1');
  await ev(() => abrirUsuarios()); await espera(300);
  let t = await txt();
  check('pedido aparece em Aguardando', t.includes('Aguardando aprovação (1)') && t.includes('Pediu senha nova em'), t.slice(0, 500));
  check('senha pedida não aparece na tela', !t.includes('nova123'));
  await page.screenshot({ path: SAIDA + '/senha-aprovar.png', fullPage: true });
  await ev(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Aprovar senha nova').click()); await espera(400);
  check('aprovado: senha nova vale', (await ev(() => __db.contas['bia@teste.local'].senha)) === 'nova123' && !(await ev(() => __db.pedidosSenha['u-bia'])));
  t = await txt();
  check('pedido sai da lista', t.includes('Aguardando aprovação (0)') && !t.includes('Pediu senha nova'));
  // recusar: senha continua
  await ev(() => { __db.pedidosSenha['u-bia'] = { senha: 'outra12', criado_em: new Date().toISOString() }; }); await ev(() => carregarAcessos()); await espera(300);
  await ev(() => responderSenha('u-bia', false)); await espera(400);
  check('recusado: senha não muda', (await ev(() => __db.contas['bia@teste.local'].senha)) === 'nova123' && !(await ev(() => __db.pedidosSenha['u-bia'])));
  const contas = await ev(() => JSON.stringify(__db.contas));

  // atleta entra com a senha nova
  await ev(() => localStorage.setItem('mock:sessao', 'nenhuma')); await page.goto(URL0); await espera(300);
  await prepara(); await ev((c) => Object.assign(__db.contas, JSON.parse(c)), contas);
  await digita('email', 'bia@teste.local'); await digita('senha', 'nova123'); await page.click('#btnEntrar'); await espera(500);
  check('atleta entra com a senha nova', (await ev(() => view)) === 'publica', await ev(() => view));
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
