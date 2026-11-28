// Finanças: caixa único, inscrições por rodada (pago/pendente/isento), despesas, premiação prevista e permissões.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { MOCK } from './mock.mjs';
const RAIZ = process.argv[2], SAIDA = process.argv[3], PORTA = 8804;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-fi-')) });
const ok = [], falhas = []; const check = (n, c, e = '') => (c ? ok : falhas).push(n + (c ? '' : ' → ' + e));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORTA}/index.html`;
const R = (v) => 'R$ ' + v; // trecho do valor como o navegador mostra (ex.: "R$ 80,00")
try {
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(MOCK);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const txt = () => ev(() => document.body.innerText.replace(/\u00a0/g, ' '));
  const clica = async (texto, sel = 'button') => { const ok = await ev((t, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, texto, sel); await espera(250); return ok; };

  const temBotaoFin = () => ev(() => !!document.querySelector('[onclick^="abrirFinancas"]'));
  await page.goto(URL0); await espera(300);
  await ev(() => { const nomes = ['Ana Teste', 'Bia Teste', 'Caio Teste', 'Duda Teste', ...Array(12).fill('')];
    __db.ligas.lf = { id: 'lf', nome: 'Relâmpago Finanças', data: '2026-12-05', participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, temporada_id: null, etapa_numero: null, excluida_em: null, atualizado_em: new Date().toISOString(), dados: { names: nomes, ids: Array(16).fill(null), scores: {}, finals: {}, breaks: {} } };
    __db.ligas.lr2 = { ...__db.ligas.lf, id: 'lr2', nome: 'Relâmpago Sem Cobrança', data: '2026-11-20', dados: { names: Array(16).fill(''), ids: Array(16).fill(null) } }; });
  check('dono vê o botão Finanças no início', await temBotaoFin());
  await clica('Finanças'); await espera(200);
  check('resumo abre com caixa zerado', (await txt()).includes('Caixa atual') && (await txt()).includes(R('0,00')));

  // ajustes: saldo inicial R$ 100 e inscrição R$ 50
  await clica('Ajustes');
  await ev(() => { document.getElementById('fin-saldo-inicial').value = '100'; document.getElementById('fin-insc-relampago').value = '50,00'; });
  await clica('Salvar'); await espera(200);
  check('ajustes gravados no servidor', (await ev(() => JSON.stringify(__db.fin.config))) === '{"saldo_inicial_centavos":10000,"inscricao_relampago_centavos":5000}');
  check('aviso de salvo só depois do servidor', (await txt()).includes('Ajustes salvos.'));

  // rodada: ativar cobrança e marcar pagamentos
  await clica('Rodadas'); await clica('Cobrar inscrição'); await espera(200);
  let t = await txt();
  check('rodada com os 4 inscritos e R$ 200 a receber', t.includes('Inscritos (4)') && t.includes(R('200,00')), t.slice(0, 600));
  await ev(() => document.querySelectorAll('.seg')[0].querySelector('button').click()); await espera(250); // Ana: Pago
  await ev(() => document.querySelectorAll('.seg')[1].querySelectorAll('button')[2].click()); await espera(250); // Bia: Isento
  check('pago e isento gravados', (await ev(() => JSON.stringify(Object.values(__db.fin.inscricoes).map((i) => [i.nome, i.status, i.valor_centavos]).sort()))) === '[["Ana Teste","pago",5000],["Bia Teste","isento",0]]');
  t = await txt();
  check('rodada: recebido R$ 50 e a receber R$ 100 (isento não conta)', t.includes('pagou ' + R('50,00')) && t.includes('A receber\n' + R('100,00')), t.slice(0, 700));

  // despesa da rodada e prêmio previsto
  await clica('+ Despesa');
  await ev(() => { document.getElementById('fin-l-cat').value = 'Quadra'; document.getElementById('fin-l-valor').value = '30'; document.getElementById('fin-l-desc').value = 'aluguel'; document.getElementById('fin-l-pago').value = '1'; });
  await clica('Salvar', '#modal button'); await espera(200);
  check('despesa ligada à rodada', (await ev(() => { const l = Object.values(__db.fin.lancamentos)[0]; return l && l.liga_id === 'lf' && l.valor_centavos === 3000 && l.categoria === 'Quadra'; })));
  await clica('+ Prêmio');
  await ev(() => { document.getElementById('fin-p-valor').value = '40'; document.getElementById('fin-p-desc').value = 'dupla campeã'; });
  await clica('Salvar', '#modal button'); await espera(200);
  t = await txt();
  check('saldo da rodada = 50 − 30', t.includes('Saldo da rodada\n' + R('20,00')), t.slice(0, 600));
  await page.screenshot({ path: SAIDA + '/financas-rodada.png', fullPage: true });

  // resumo: caixa 100 + 50 − 30 = 120; previsto 40; futuro 80
  await clica('Resumo'); t = await txt();
  check('resumo: caixa, a receber, previsto e saldo futuro', t.includes('Caixa atual\n' + R('120,00')) && t.includes('A receber\n' + R('100,00')) && t.includes('Premiação prevista\n' + R('40,00')) && t.includes('Saldo futuro previsto\n' + R('80,00')), t.slice(0, 600));
  await page.screenshot({ path: SAIDA + '/financas-resumo.png', fullPage: true });

  // pagar o prêmio: sai do previsto e entra como saída
  await clica('Premiação'); await clica('Pagar'); await espera(200);
  await clica('Resumo'); t = await txt();
  check('prêmio pago: caixa R$ 80, previsto R$ 0, futuro R$ 80', t.includes('Caixa atual\n' + R('80,00')) && t.includes('Premiação prevista\n' + R('0,00')) && t.includes('Saldo futuro previsto\n' + R('80,00')), t.slice(0, 600));
  check('pagamento do prêmio aparece nos lançamentos', t.includes('Prêmios'));

  // "De onde é" mostra também as relâmpago sem cobrança de inscrição
  await clica('Lançamentos'); await clica('+ Despesa');
  const grupos = await ev(() => [...document.querySelectorAll('#fin-l-vinc optgroup')].map((g) => g.label + ': ' + [...g.children].map((o) => o.textContent).join(' | ')));
  check('"De onde é" lista as ligas relâmpago, com e sem cobrança', grupos.some((g) => g.startsWith('Ligas relâmpago') && g.includes('Relâmpago Finanças') && g.includes('Relâmpago Sem Cobrança')), grupos.join(' / '));
  await ev(() => { document.getElementById('fin-l-valor').value = '12'; document.getElementById('fin-l-vinc').value = 'l:lr2'; });
  await clica('Salvar', '#modal button'); await espera(200);
  check('despesa ligada à relâmpago sem cobrança', await ev(() => Object.values(__db.fin.lancamentos).some((l) => l.liga_id === 'lr2' && l.valor_centavos === 1200)));
  // despesa nova nasce "a pagar": não mexe no caixa, só no saldo futuro
  await clica('Resumo'); t = await txt();
  check('despesa a pagar: caixa R$ 80, a pagar R$ 12, futuro R$ 68', t.includes('Caixa atual\n' + R('80,00')) && t.includes('A pagar\n' + R('12,00')) && t.includes('Saldo futuro previsto\n' + R('68,00')), t.slice(0, 700));
  check('resumo mostra o bloco "A pagar e a receber"', t.includes('A pagar e a receber'));
  await clica('Lançamentos'); t = await txt();
  check('lançamentos: linha automática das inscrições pagas da rodada', t.includes('Inscrições — 1 pago(s)') && t.includes('soma automática das inscrições pagas'), t.slice(0, 900));
  await page.screenshot({ path: SAIDA + '/financas-lancamentos.png', fullPage: true });
  check('botão Pagar na despesa pendente', await clica('Pagar')); await espera(200);
  await clica('Resumo'); t = await txt();
  check('depois de pagar: caixa R$ 68, a pagar R$ 0, futuro R$ 68', t.includes('Caixa atual\n' + R('68,00')) && t.includes('A pagar\n' + R('0,00')) && t.includes('Saldo futuro previsto\n' + R('68,00')), t.slice(0, 700));
  check('baixa gravada com data', await ev(() => Object.values(__db.fin.lancamentos).some((l) => l.liga_id === 'lr2' && l.pago === true && !!l.pago_em)));
  await clica('Lançamentos');
  // valor inválido não grava nada
  await clica('+ Despesa');
  await ev(() => { document.getElementById('fin-l-valor').value = 'abc'; });
  const antes = await ev(() => Object.keys(__db.fin.lancamentos).length);
  await clica('Salvar', '#modal button');
  check('valor inválido: nada gravado', (await ev(() => Object.keys(__db.fin.lancamentos).length)) === antes);
  await ev(() => fecharModal());

  // membro só com "Financeiro: ver": vê os números, não grava
  const estado = await ev(() => JSON.stringify(__db.fin));
  await ev(() => { localStorage.setItem('mock:sessao', 'm@teste'); });
  await page.goto(URL0); await espera(150);
  await ev((e) => { Object.assign(__db.fin, JSON.parse(e)); __db.ligas.lf = { id: 'lf', nome: 'Relâmpago Finanças', data: '2026-12-05', participantes: 16, status: 'preparacao', etapa: 'cadastro', versao: 1, dados: { names: ['Ana Teste', 'Bia Teste', 'Caio Teste', 'Duda Teste', ...Array(12).fill('')], ids: Array(16).fill(null) } };
    Object.assign(__db.contas['m@teste'], { admin: true, permissoes: ['financeiro_ver'] }); }, estado);
  await ev(() => verificarAcesso()); await espera(300);
  check('membro com "ver" tem o botão Finanças', await temBotaoFin());
  await ev(() => abrirFinancas()); await espera(300); t = await txt();
  check('membro com "ver" vê o caixa', t.includes('Caixa atual\n' + R('68,00')));
  check('membro com "ver" não tem + Despesa', !t.includes('+ Despesa') && !t.includes('+ Entrada'));
  await clica('Rodadas'); await ev(() => document.querySelector('.fin-rodada').click()); await espera(200);
  check('membro com "ver": botões de pagamento travados', (await ev(() => [...document.querySelectorAll('.seg button')].every((b) => b.disabled))));
  await clica('Ajustes');
  check('membro com "ver": ajustes só leitura', (await ev(() => [...document.querySelectorAll('#main input')].every((i) => i.disabled))) && !(await txt()).includes('Salvar'));

  // membro sem financeiro: nem vê o botão
  await ev(() => { __db.contas['m@teste'].permissoes = ['ligas']; }); await ev(() => verificarAcesso()); await espera(300);
  check('membro sem financeiro não vê Finanças', !(await temBotaoFin()));
  check('sem erros de script', !erros.length, erros.join(' | '));
} catch (e) { falhas.push('erro: ' + e.message); }
finally { await browser.close(); srv.close(); }
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
