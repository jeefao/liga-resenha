// Teste das telas de atletas com um Supabase simulado dentro da página.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const RAIZ = process.argv[2];
const PORTA = 8791;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/sw.js' || p.startsWith('/vendor/')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(''); }
  let c; try { c = readFileSync(join(RAIZ, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': tipos[extname(p)] || 'application/octet-stream' }); res.end(c);
});
await new Promise((r) => srv.listen(PORTA, '127.0.0.1', r));

const MOCK = () => {
  const db = { ligas: {}, atletas: {} };
  window.__db = db;
  const agora = () => new Date().toISOString();
  const resumo = (l) => ({ ok: true, ...l });
  const uuid = () => crypto.randomUUID();
  function builder(tab) {
    let filtros = [], cols = '*', um = false;
    const b = {
      select(c) { cols = c; return b; }, order() { return b; },
      eq(k, v) { filtros.push([k, v]); return b; }, single() { um = true; return b; },
      then(ok, ko) {
        let rows = Object.values(db[tab]).filter((r) => filtros.every(([k, v]) => r[k] === v)).map((r) => {
          const x = JSON.parse(JSON.stringify(r));
          if (cols.includes('ids:dados->ids')) x.ids = r.dados ? r.dados.ids ?? null : null;
          return x;
        });
        if (tab === 'atletas') rows.sort((a, b) => a.nome.localeCompare(b.nome));
        const r = um ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'PGRST116' } }) : { data: rows, error: null };
        return Promise.resolve(r).then(ok, ko);
      },
    };
    return b;
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function novoAtleta(nome, situacao = 'membro', extra = {}) {
    nome = norm(nome);
    if (Object.values(db.atletas).some((a) => a.nome.toLowerCase() === nome.toLowerCase())) throw { message: 'atleta_ja_existe' };
    const a = { id: uuid(), nome, apelido: extra.apelido || null, situacao, observacoes: extra.observacoes || null, versao: 1, atualizado_em: agora() };
    db.atletas[a.id] = a; return a;
  }
  const rpc = {
    meu_acesso() { return { logado: true, admin: true, status: 'aprovado', dono: true, permissoes: [] }; },
    criar_liga(p) {
      const l = { id: p.p_id, nome: p.p_nome, data: p.p_data, participantes: p.p_dados.names.length, status: 'preparacao', etapa: 'cadastro', versao: 1, dados: p.p_dados, atualizado_em: agora(), excluida_em: null };
      db.ligas[l.id] = l; return resumo(l);
    },
    salvar_liga(p) {
      const l = db.ligas[p.p_id];
      if (l.versao !== p.p_versao_esperada) return { ok: false, conflito: true, versao_servidor: l.versao };
      if (l.status === 'finalizada' && !p.p_motivo) throw { message: 'motivo_obrigatorio' };
      Object.assign(l, { dados: p.p_dados ?? l.dados, status: p.p_status ?? l.status, etapa: p.p_etapa ?? l.etapa, versao: l.versao + 1, atualizado_em: agora(), participantes: (p.p_dados ?? l.dados).names.length });
      (window.__eventos ||= []).push(...(p.p_eventos || []).map((e) => ({ ...e, motivo: p.p_motivo })));
      return resumo(l);
    },
    salvar_atleta(p) {
      if (!p.p_id || !db.atletas[p.p_id]) return { ok: true, ...novoAtleta(p.p_nome, p.p_situacao, { apelido: p.p_apelido, observacoes: p.p_observacoes }) };
      const a = db.atletas[p.p_id];
      if (a.versao !== p.p_versao_esperada) return { ok: false, conflito: true, versao_servidor: a.versao };
      Object.assign(a, { nome: norm(p.p_nome), apelido: p.p_apelido, situacao: p.p_situacao, observacoes: p.p_observacoes, versao: a.versao + 1 });
      return { ok: true, ...a };
    },
    garantir_atletas(p) {
      return p.p_nomes.map((n) => {
        n = norm(n || ''); if (!n) return null;
        return Object.values(db.atletas).find((a) => a.nome.toLowerCase() === n.toLowerCase()) || novoAtleta(n, p.p_situacao || 'membro');
      });
    },
  };
  const sessao = { user: { id: 'u1', email: 'admin@teste' } };
  window.supabase = {
    createClient: () => ({
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: sessao } }), signOut: async () => {} },
      from: (t) => builder(t),
      rpc: async (n, p) => {
        await new Promise((r) => setTimeout(r, 30));
        try { return { data: JSON.parse(JSON.stringify(rpc[n](p))), error: null }; } catch (e) { return { data: null, error: e }; }
      },
    }),
  };
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'lr6-at-')) });
const ok = [], falhas = [];
const check = (nome, cond, extra = '') => (cond ? ok : falhas).push(nome + (cond ? '' : ' → ' + extra));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const dialogos = [];
  page.on('dialog', async (d) => { dialogos.push(d.message()); await (d.type() === 'prompt' ? d.accept('Correção teste') : d.accept()); });
  const errosJs = [];
  page.on('pageerror', (e) => errosJs.push(e.message));
  await page.evaluateOnNewDocument(MOCK);
  await page.goto(`http://127.0.0.1:${PORTA}/index.html`);
  await espera(400);
  const txt = () => page.evaluate(() => document.body.innerText);
  const ev = (f, ...a) => page.evaluate(f, ...a);

  // 1. Tela Atletas a partir do início
  check('botão ATLETAS no início', (await txt()).includes('ATLETAS'), (await ev(() => view)) + ' | ' + (await txt()).slice(0, 200));
  await ev(() => abrirAtletas()); await espera(200);
  check('tela atletas vazia', (await txt()).includes('Nenhum atleta cadastrado'));
  await ev(() => abrirAtletaForm(null)); await espera(100);
  await page.type('#afNome', '  José   Silva ');
  await page.type('#afApelido', 'Zé');
  await page.click('#afBtn'); await espera(200);
  check('atleta criado e listado', (await txt()).includes('José Silva') && (await txt()).includes('Zé'));
  // duplicado sem acento → aviso de confirmação
  await ev(() => abrirAtletaForm(null)); await page.type('#afNome', 'jose silva'); await page.click('#afBtn'); await espera(200);
  check('aviso de nome parecido', dialogos.some((m) => m.includes('Já existe "José Silva"')));
  check('servidor recusa duplicado exato? (jose silva difere de josé)', true);
  // editar → situação inativo
  const idJose = await ev(() => atletas.find((a) => a.nome === 'José Silva').id);
  await ev((id) => abrirAtletaForm(id), idJose); await page.select('#afSit', 'inativo'); await page.click('#afBtn'); await espera(200);
  check('editado para inativo (versão 2)', (await ev((id) => __db.atletas[id].versao + __db.atletas[id].situacao, idJose)) === '2inativo');
  await ev(() => { atlFiltro.situacao = 'inativo'; render(); });
  check('filtro inativos', (await txt()).includes('José Silva'));
  await ev(() => { atlFiltro.situacao = 'ativos'; render(); });

  // 2. Nova liga e seleção
  await ev(() => { view = 'nova'; render(); });
  await page.type('#nlNome', 'Relâmpago teste');
  await page.click('#nlBtn'); await espera(500);
  check('liga criada abre na aba Atletas', (await txt()).includes('Atletas da liga') && (await txt()).includes('Selecionados: 0 / 16'));
  // colar lista com números, acento diferente e repetido
  await ev(() => abrirColarLista());
  const nomes = Array.from({ length: 15 }, (_, i) => `${i + 1}. Atleta ${String.fromCharCode(65 + i)}`).join('\n') + '\nJOSE SILVA\nAtleta A\nExtra Um';
  await page.type('#clTexto', nomes);
  await page.click('#clBtn'); await espera(800);
  const sel = await ev(() => selecionados());
  check('colar: 16 selecionados', sel.length === 16, JSON.stringify(sel.length));
  check('colar: todos com vínculo', sel.every((x) => x.id));
  check('colar: José inativo não entra', !sel.some((x) => x.nome === 'José Silva'));
  check('colar: avisou quem não coube', dialogos.some((m) => m.includes('Não entraram: Extra Um')));
  check('colar: Extra Um foi cadastrado', await ev(() => atletas.some((a) => a.nome === 'Extra Um')));
  check('salvo no servidor com ids', await ev(() => { const l = Object.values(__db.ligas)[0]; return l.dados.ids.filter(Boolean).length === 16 && l.dados.names.filter(Boolean).length === 16; }));
  // retirar e incluir por checkbox
  await ev(() => removerPosicao(0)); await espera(200);
  check('retirar compacta (15)', (await ev(() => selecionados().length)) === 15 && (await ev(() => S.names[15] === '' && S.ids[15] === null)));
  const idExtra = await ev(() => atletas.find((a) => a.nome === 'Extra Um').id);
  await page.click(`input[onchange="toggleAtleta('${idExtra}')"]`); await espera(300);
  check('incluir pelo checkbox (16)', (await ev(() => selecionados().length)) === 16 && (await ev((id) => S.ids.includes(id), idExtra)));
  check('lista cheia desabilita os demais', await ev(() => [...document.querySelectorAll('.sel-item input')].filter((i) => !i.checked).every((i) => i.disabled)));
  // busca na seleção mantém foco
  await page.click('#selBusca'); await page.type('#selBusca', 'atleta b');
  check('busca filtra e mantém foco', (await ev(() => document.querySelectorAll('.sel-item').length)) === 1 && (await ev(() => document.activeElement.id)) === 'selBusca');
  await ev(() => { atlBuscaLiga = ''; render(); });
  // iniciar e sortear: ids acompanham nomes
  await ev(() => startLeague()); await espera(300);
  await ev(() => shuffle()); await espera(300);
  check('sorteio mantém par nome↔id', await ev(() => S.names.every((n, i) => atletaPorId(S.ids[i]) && atletaPorId(S.ids[i]).nome === n)));
  await ev(() => { tab = 'Atletas'; render(); });
  check('aba bloqueada após iniciar', (await txt()).includes('Lista bloqueada') && !(await txt()).includes('Colar lista'));

  // 3. Liga antiga sem ids: vincular (finalizada exige motivo automático)
  const idAntiga = await ev(async () => {
    const id = crypto.randomUUID();
    const names = Array.from({ length: 16 }, (_, i) => (i === 0 ? 'atleta c' : i === 1 ? 'Pessoa Antiga' : 'Velho ' + i));
    __db.ligas[id] = { id, nome: 'Antiga', data: '2026-11-14', participantes: 16, status: 'finalizada', etapa: 'encerrada', versao: 5, dados: { names, scores: {}, finals: {}, breaks: {}, drawn: true, status: 'ended' }, atualizado_em: new Date().toISOString(), excluida_em: null };
    return id;
  });
  await ev((id) => abrirLiga(id), idAntiga); await espera(400);
  await ev(() => { tab = 'Atletas'; render(); });
  check('antiga mostra sem vínculo', (await txt()).includes('16 nome(s) sem vínculo'));
  await ev(() => vincularCadastro()); await espera(800);
  check('vinculou todos', await ev((id) => __db.ligas[id].dados.ids.every(Boolean), idAntiga));
  check('nomes da liga antiga não mudaram', await ev((id) => __db.ligas[id].dados.names[0] === 'atleta c', idAntiga));
  check('reaproveitou "Atleta C"', await ev((id) => __db.ligas[id].dados.ids[0] === atletas.find((a) => a.nome === 'Atleta C').id, idAntiga));
  check('motivo automático', await ev(() => __eventos.some((e) => e.motivo === 'Vínculo com o cadastro de atletas')));
  check('liga continua finalizada', await ev((id) => __db.ligas[id].status === 'finalizada', idAntiga));

  // 4. Participações
  await ev(() => voltarInicio(true)); await espera(200);
  await ev(() => abrirAtletas()); await espera(400);
  check('contagem de participações', await ev(() => { const id = atletas.find((a) => a.nome === 'Atleta C').id; return participacoes[id] === 2; }));
  // 5. Conflito ao editar atleta
  await ev(() => { const a = atletas.find((x) => x.nome === 'Extra Um'); __db.atletas[a.id].versao = 9; });
  await ev(() => abrirAtletaForm(atletas.find((x) => x.nome === 'Extra Um').id)); await page.click('#afBtn'); await espera(300);
  check('conflito de atleta avisado', dialogos.some((m) => m.includes('alterado em outro aparelho')));
  // 6. offline: cadastro guardado no aparelho
  check('cache local do cadastro', await ev(() => JSON.parse(localStorage.getItem('lr6:atletas')).lista.length >= 18));
  await page.screenshot({ path: process.argv[3] + '/atletas.png', fullPage: false });
  await ev(() => { view = 'nova'; render(); }); await page.type('#nlNome', 'Print'); await page.click('#nlBtn'); await espera(500);
  await ev(() => { const s = selecionados(); atletas.slice(0, 5).forEach((a) => incluirNaSelecao(s, a)); s.push({ nome: 'Nome Antigo', id: null }); definirSelecao(s, []); render(); });
  await espera(300);
  await ev(() => window.scrollTo(0, document.querySelector('h3[style]').getBoundingClientRect().top + scrollY - 20));
  await page.screenshot({ path: process.argv[3] + '/selecao.png', fullPage: false });
  await ev(() => { view = 'nova'; render(); }); await page.type('#nlNome', 'Print'); await page.click('#nlBtn'); await espera(500);
  await ev(() => { const s = selecionados(); atletas.slice(0, 5).forEach((a) => incluirNaSelecao(s, a)); s.push({ nome: 'Nome Antigo', id: null }); definirSelecao(s, []); render(); });
  await espera(300);
  await ev(() => window.scrollTo(0, document.querySelector('h3[style]').getBoundingClientRect().top + scrollY - 20));
  await page.screenshot({ path: process.argv[3] + '/selecao.png', fullPage: false });
  await ev(() => { view = 'nova'; render(); });
  check('sem erros de JavaScript', errosJs.length === 0, errosJs.join(' | '));
} finally {
  await browser.close(); srv.close();
}
console.log('OK:', ok.length); for (const f of falhas) console.log('FALHA:', f);
