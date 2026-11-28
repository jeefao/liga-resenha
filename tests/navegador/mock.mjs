export const MOCK = () => {
  const db = { ligas: {}, atletas: {}, temporadas: {}, acessos: {} };
  // contas de login do mock; 'mock:sessao' no localStorage: ausente = administrador, 'nenhuma' = sem login, ou o e-mail da conta
  const contas = { 'admin@teste': { id: 'u1', email: 'admin@teste', senha: 'admin123', admin: true, dono: true } };
  db.contas = contas;
  let marca = null; try { marca = localStorage.getItem('mock:sessao'); } catch {}
  let atual = marca === 'nenhuma' ? null : marca ? (contas[marca] || (contas[marca] = { id: 'u-' + marca, email: marca, senha: '123456' })) : contas['admin@teste'];
  const sessaoDe = () => (atual ? { user: { id: atual.id, email: atual.email } } : null);
  const ehAdmin = () => !!(atual && atual.admin);
  const exigeAdmin = () => { if (!(atual && atual.dono)) throw { message: ehAdmin() ? 'sem_permissao' : 'acesso_negado' }; };
  const TODAS = ['ligas', 'temporadas', 'atletas', 'financeiro_ver', 'financeiro_lancar'];
  const contaPorId = (id) => Object.values(contas).find((x) => x.id === id);
  const meuAcesso = () => {
    if (!atual) return { logado: false };
    if (atual.admin) { const n = db.acessos[atual.id] && db.atletas[db.acessos[atual.id].atleta_id]; return { logado: true, admin: true, status: 'aprovado', dono: !!atual.dono, permissoes: atual.dono ? TODAS : atual.permissoes || [], ...(n ? { nome: n.nome } : {}) }; }
    const a = db.acessos[atual.id];
    if (!a) return { logado: true, admin: false, status: null };
    const t = a.atleta_id && db.atletas[a.atleta_id];
    return { logado: true, admin: false, status: a.status, nome: t ? t.nome : a.nome_informado };
  };
  window.__db = db;
  const agora = () => new Date().toISOString();
  const resumo = (l) => ({ ok: true, ...l });
  const uuid = () => crypto.randomUUID();
  function builder(tab) {
    let filtros = [], cols = '*', um = false;
    const b = {
      select(c) { cols = c; return b; }, order() { return b; },
      eq(k, v) { filtros.push([k, (x) => x === v]); return b; }, neq(k, v) { filtros.push([k, (x) => x !== v]); return b; }, lt(k, v) { filtros.push([k, (x) => x < v]); return b; }, lte(k, v) { filtros.push([k, (x) => x <= v]); return b; }, in(k, v) { filtros.push([k, (x) => v.includes(x)]); return b; }, limit() { return b; }, single() { um = true; return b; },
      then(ok, ko) {
        let rows = Object.values(db[tab]).filter((r) => filtros.every(([k, f]) => f(r[k] ?? null))).map((r) => {
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
    criar_liga(p) {
      const l = { temporada_id: null, etapa_numero: null, criado_em: agora(), id: p.p_id, nome: p.p_nome, data: p.p_data, participantes: p.p_dados.names.length, status: 'preparacao', etapa: 'cadastro', versao: 1, dados: p.p_dados, atualizado_em: agora(), excluida_em: null };
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
    criar_temporada(p) { const t = { id: p.p_id, nome: p.p_nome, inicio: p.p_inicio, status: 'andamento', regras: p.p_regras, dados: p.p_dados || {}, publica: false, versao: 1, atualizado_em: agora(), criado_em: agora() }; db.temporadas[t.id] = t; return { ok: true, ...t }; },
    salvar_temporada(p) { const t = db.temporadas[p.p_id]; if (t.versao !== p.p_versao_esperada) return { ok: false, conflito: true, versao_servidor: t.versao };
      for (const k of ['nome', 'inicio', 'regras', 'dados', 'status', 'publica']) if (p['p_' + k] != null) t[k] = p['p_' + k]; t.versao++; (window.__tmot ||= []).push(p.p_motivo); return { ok: true, ...t }; },
    criar_etapa(p) { if (Object.values(db.ligas).some((l) => l.temporada_id === p.p_temporada_id && l.etapa_numero === p.p_numero && !l.excluida_em)) throw { message: 'etapa_ja_existe' };
      const l = rpc.criar_liga(p); Object.assign(db.ligas[p.p_id], { temporada_id: p.p_temporada_id, etapa_numero: p.p_numero }); return { ...l, temporada_id: p.p_temporada_id }; },
    excluir_temporada(p) { const t = db.temporadas[p.p_id]; if (!t) throw { message: 'temporada_nao_encontrada' }; if (t.status !== 'arquivada') throw { message: 'temporada_nao_arquivada' };
      let n = 0; for (const l of Object.values(db.ligas)) if (l.temporada_id === p.p_id) { delete db.ligas[l.id]; n++; } delete db.temporadas[p.p_id]; return { ok: true, id: t.id, nome: t.nome, etapas: n }; },
    excluir_temporada(p) { const t = db.temporadas[p.p_id]; if (!t) throw { message: 'temporada_nao_encontrada' }; if (t.status !== 'arquivada') throw { message: 'temporada_nao_arquivada' };
      let n = 0; for (const l of Object.values(db.ligas)) if (l.temporada_id === p.p_id) { delete db.ligas[l.id]; n++; } delete db.temporadas[p.p_id]; return { ok: true, id: t.id, nome: t.nome, etapas: n }; },
    excluir_temporada(p) { const t = db.temporadas[p.p_id]; if (!t) throw { message: 'temporada_nao_encontrada' }; if (t.status !== 'arquivada') throw { message: 'temporada_nao_arquivada' };
      let n = 0; for (const l of Object.values(db.ligas)) if (l.temporada_id === p.p_id) { delete db.ligas[l.id]; n++; } delete db.temporadas[p.p_id]; return { ok: true, id: t.id, nome: t.nome, etapas: n }; },
    is_admin() { return ehAdmin(); },
    meu_acesso() { return meuAcesso(); },
    solicitar_acesso(p) {
      const nome = norm(p.p_nome || '');
      if (nome.length < 3) throw { message: 'nome_invalido' };
      const a = db.acessos[atual.id];
      if (a && ['aprovado', 'bloqueado'].includes(a.status)) throw { message: 'pedido_ja_analisado' };
      db.acessos[atual.id] = { ...(a || { user_id: atual.id, email: atual.email, atleta_id: null, criado_em: agora() }), nome_informado: nome, status: 'pendente' };
      return meuAcesso();
    },
    listar_acessos() {
      exigeAdmin();
      return Object.values(db.acessos).map((a) => { const c = contaPorId(a.user_id) || {}; return { ...a, atleta_nome: (db.atletas[a.atleta_id] || {}).nome || null, ultimo_acesso: null, admin: !!c.admin, dono: false, permissoes: c.permissoes || [] }; }).sort((x, y) => (y.status === 'pendente') - (x.status === 'pendente'));
    },
    definir_acesso(p) {
      exigeAdmin();
      const a = db.acessos[p.p_user_id]; if (!a) throw { message: 'acesso_nao_encontrado' };
      if (p.p_status === 'aprovado' && !(p.p_atleta_id || a.atleta_id)) throw { message: 'escolha_o_atleta' };
      a.status = p.p_status; if (p.p_atleta_id) a.atleta_id = p.p_atleta_id;
      if (p.p_status !== 'aprovado') { const c = contaPorId(a.user_id); if (c && !c.dono) { c.admin = false; c.permissoes = []; } }
      return { ok: true };
    },
    definir_admin(p) {
      exigeAdmin();
      const c = contaPorId(p.p_user_id); if (!c || c.dono) throw { message: 'conta_de_administrador' };
      if (!p.p_admin) { c.admin = false; c.permissoes = []; return { ok: true }; }
      if (!db.acessos[c.id] || db.acessos[c.id].status !== 'aprovado') throw { message: 'aprove_antes' };
      c.admin = true; c.permissoes = [...new Set(p.p_permissoes || [])].sort(); return { ok: true };
    },
    trocar_senha_acesso(p) {
      exigeAdmin();
      if ((p.p_senha || '').length < 6) throw { message: 'senha_curta' };
      const c = Object.values(contas).find((x) => x.id === p.p_user_id); if (!c || c.dono) throw { message: 'conta_de_administrador' };
      c.senha = p.p_senha; return { ok: true };
    },
    excluir_acesso(p) {
      exigeAdmin();
      const c = Object.values(contas).find((x) => x.id === p.p_user_id); if (!c || c.dono) throw { message: 'conta_de_administrador' };
      delete contas[c.email]; delete db.acessos[c.id]; return { ok: true };
    },
    consulta_publica() {
      if (!ehAdmin() && !(atual && db.acessos[atual.id] && db.acessos[atual.id].status === 'aprovado')) throw { message: 'acesso_negado' };
      // mesmo formato da função do banco (migration 20261128000003)
      const ts = Object.values(db.temporadas).filter((x) => ['andamento', 'encerrada'].includes(x.status)).sort((x, y) => String(y.inicio).localeCompare(String(x.inicio)));
      const temporadas = ts.map((t) => ({ id: t.id, nome: t.nome, inicio: t.inicio, status: t.status, regras: t.regras, dados: {
        ajustes: ((t.dados || {}).ajustes || []).map((x) => ({ id: x.id, atleta_id: x.atleta_id, etapa: x.etapa, pontos: x.pontos, motivo: x.motivo })),
        datas: Object.fromEntries(Object.entries((t.dados || {}).datas || {}).filter(([k, v]) => /^\d{1,3}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(v))) } }));
      const vis = new Set(ts.map((t) => t.id));
      const linha = (l) => ({ id: l.id, nome: l.nome, data: l.data, status: l.status, etapa: l.etapa, temporada_id: l.temporada_id || null, etapa_numero: l.etapa_numero || null, participantes: l.participantes, versao: l.versao, atualizado_em: l.atualizado_em, excluida_em: null, dados: l.dados });
      const etapas = Object.values(db.ligas).filter((l) => vis.has(l.temporada_id) && !l.excluida_em).sort((x, y) => x.etapa_numero - y.etapa_numero).map(linha);
      const relampagos = Object.values(db.ligas).filter((l) => !l.temporada_id && !l.excluida_em && l.status !== 'arquivada').sort((x, y) => String(y.data).localeCompare(String(x.data))).slice(0, 30).map(linha);
      const ids = new Set();
      etapas.forEach((l) => { (l.dados.ids || []).forEach((i) => i && ids.add(i)); [...(l.dados.subs || []), ...(l.dados.gsubs || [])].forEach((x) => x && x.atleta && x.atleta.id && ids.add(x.atleta.id)); });
      temporadas.forEach((t) => t.dados.ajustes.forEach((x) => x.atleta_id && ids.add(x.atleta_id)));
      return { temporadas, etapas, relampagos, atletas: [...ids].map((i) => db.atletas[i]).filter(Boolean).map((x) => ({ id: x.id, nome: x.nome, situacao: x.situacao })) };
    },
    garantir_atletas(p) {
      return p.p_nomes.map((n) => {
        n = norm(n || ''); if (!n) return null;
        return Object.values(db.atletas).find((a) => a.nome.toLowerCase() === n.toLowerCase()) || novoAtleta(n, p.p_situacao || 'membro');
      });
    },
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: sessaoDe() } }),
        signOut: async () => { atual = null; return { error: null }; },
        signInWithPassword: async ({ email, password }) => {
          const c = contas[email];
          if (!c || c.senha !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
          atual = c; return { data: { user: sessaoDe().user, session: sessaoDe() }, error: null };
        },
        signUp: async ({ email, password }) => {
          if (contas[email]) return { data: {}, error: { message: 'User already registered' } };
          atual = contas[email] = { id: 'u-' + email, email, senha: password }; return { data: { user: sessaoDe().user, session: sessaoDe() }, error: null };
        },
      },
      from: (t) => builder(t),
      rpc: async (n, p) => {
        await new Promise((r) => setTimeout(r, 30));
        try { return { data: JSON.parse(JSON.stringify(rpc[n](p))), error: null }; } catch (e) { return { data: null, error: e }; }
      },
    }),
  };
};
