export const MOCK = () => {
  const db = { ligas: {}, atletas: {}, temporadas: {}, acessos: {}, pedidosSenha: {} };
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
  // Finanças (mesmo formato das funções da migration 20261128000006)
  const fin = { config: { saldo_inicial_centavos: 0, inscricao_relampago_centavos: 0 }, temporadas: {}, rodadas: {}, inscricoes: {}, lancamentos: {}, premios: {} };
  db.fin = fin; let finOrdem = 0;
  const hojeIso = () => new Date().toISOString().slice(0, 10);
  const finPode = (a) => { if (!ehAdmin()) throw { message: 'acesso_negado' }; if (!(atual.dono || (atual.permissoes || []).includes(a))) throw { message: 'sem_permissao' }; };
  const finVal = (v) => { if (v == null || v < 0 || v > 100000000) throw { message: 'valor_invalido' }; };
  const finInscritos = (d) => { const vistos = new Set(), out = []; ((d && d.names) || []).forEach((n, i) => { n = (n || '').trim(); if (!n) return; const id = (d.ids && d.ids[i]) || null; const chave = id || 'nome:' + n.toLowerCase(); if (vistos.has(chave)) return; vistos.add(chave); out.push({ chave, nome: n, atleta_id: id }); }); return out; };
  const finValorRodada = (lid) => { const r = fin.rodadas[lid], l = db.ligas[lid]; if (r && r.inscricao_centavos != null) return r.inscricao_centavos; if (l && l.temporada_id && fin.temporadas[l.temporada_id] != null) return fin.temporadas[l.temporada_id]; return fin.config.inscricao_relampago_centavos; };
  function finResumo() {
    const vivos = Object.values(fin.lancamentos).filter((x) => !x.excluido), soma = (l) => l.reduce((s, x) => s + x.valor_centavos, 0);
    const nomeLiga = (id) => (db.ligas[id] || {}).nome || (fin.rodadas[id] || {}).liga_nome || null, nomeTemp = (id) => (db.temporadas[id] || {}).nome || null;
    const rodadas = Object.values(fin.rodadas).map((r) => {
      const l = db.ligas[r.liga_id], ins = finInscritos(l && l.dados);
      const insc = ins.map((i) => { const f = fin.inscricoes[r.liga_id + '|' + i.chave]; return { ...i, status: f ? f.status : 'pendente', valor_centavos: f ? f.valor_centavos : 0, pago_em: f ? f.pago_em : null }; });
      Object.values(fin.inscricoes).filter((f) => f.liga_id === r.liga_id && !ins.some((i) => i.chave === f.chave)).forEach((f) => insc.push({ chave: f.chave, nome: f.nome, atleta_id: f.atleta_id, status: f.status, valor_centavos: f.valor_centavos, pago_em: f.pago_em }));
      const valor = finValorRodada(r.liga_id);
      return { liga_id: r.liga_id, nome: nomeLiga(r.liga_id), data: l ? l.data : null, temporada_id: l ? l.temporada_id : null, temporada_nome: l && l.temporada_id ? nomeTemp(l.temporada_id) : null, etapa_numero: l ? l.etapa_numero : null, status: l ? l.status : null,
        na_lixeira: !!(l && l.excluida_em), apagada: !l, valor_centavos: valor, valor_proprio: r.inscricao_centavos, inscritos: insc,
        recebido: soma(insc.filter((i) => i.status === 'pago')), a_receber: valor * insc.filter((i) => i.status === 'pendente').length,
        entradas: soma(vivos.filter((x) => x.liga_id === r.liga_id && x.tipo === 'entrada')), saidas: soma(vivos.filter((x) => x.liga_id === r.liga_id && x.tipo === 'saida')),
        premiacao_prevista: soma(Object.values(fin.premios).filter((q) => q.liga_id === r.liga_id && !q.lancamento_id)) };
    }).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const c = fin.config, recebido = soma(Object.values(fin.inscricoes).filter((f) => f.status === 'pago'));
    const entradas = soma(vivos.filter((x) => x.tipo === 'entrada')), saidas = soma(vivos.filter((x) => x.tipo === 'saida'));
    const previsto = soma(Object.values(fin.premios).filter((q) => !q.lancamento_id)), caixa = c.saldo_inicial_centavos + recebido + entradas - saidas;
    return { config: { ...c }, temporadas: Object.values(db.temporadas).map((t) => ({ id: t.id, nome: t.nome, status: t.status, inscricao_centavos: fin.temporadas[t.id] ?? null })),
      rodadas, ligas_sem_cobranca: Object.values(db.ligas).filter((l) => !l.excluida_em && !fin.rodadas[l.id]).map((l) => ({ id: l.id, nome: l.nome, data: l.data, temporada_nome: l.temporada_id ? nomeTemp(l.temporada_id) : null, etapa_numero: l.etapa_numero })),
      lancamentos: vivos.sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.ordem - a.ordem).map((x) => ({ ...x, liga_nome: x.liga_id ? nomeLiga(x.liga_id) : null, temporada_nome: x.temporada_id ? nomeTemp(x.temporada_id) : null })),
      premios: Object.values(fin.premios).map((q) => ({ ...q, pago: !!q.lancamento_id, liga_nome: q.liga_id ? nomeLiga(q.liga_id) : null, temporada_nome: q.temporada_id ? nomeTemp(q.temporada_id) : null })).sort((a, b) => a.colocacao - b.colocacao),
      totais: { saldo_inicial: c.saldo_inicial_centavos, inscricoes_recebidas: recebido, entradas, saidas, caixa, a_receber: rodadas.reduce((s, r) => s + r.a_receber, 0), premiacao_prevista: previsto, saldo_futuro: caixa - previsto } };
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
      return Object.values(db.acessos).map((a) => { const c = contaPorId(a.user_id) || {}; return { ...a, atleta_nome: (db.atletas[a.atleta_id] || {}).nome || null, ultimo_acesso: null, admin: !!c.admin, dono: false, permissoes: c.permissoes || [], pedido_senha_em: (db.pedidosSenha[a.user_id] || {}).criado_em || null }; }).sort((x, y) => (y.status === 'pendente' || !!y.pedido_senha_em) - (x.status === 'pendente' || !!x.pedido_senha_em));
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
    pedir_nova_senha(p) {
      if ((p.p_senha || '').length < 6) throw { message: 'senha_curta' };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.p_email || '')) throw { message: 'email_invalido' };
      const c = contas[(p.p_email || '').trim().toLowerCase()];
      if (c && !c.dono && db.acessos[c.id]) db.pedidosSenha[c.id] = { senha: p.p_senha, criado_em: agora() };
      return { ok: true };
    },
    responder_pedido_senha(p) {
      exigeAdmin();
      const r = db.pedidosSenha[p.p_user_id]; if (!r) throw { message: 'pedido_nao_encontrado' };
      delete db.pedidosSenha[p.p_user_id];
      if (p.p_aprovar) { const c = contaPorId(p.p_user_id); c.senha = r.senha; }
      return { ok: true };
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
    fin_resumo() { finPode('financeiro_ver'); return finResumo(); },
    fin_salvar_config(p) { finPode('financeiro_lancar'); finVal(p.p_inscricao_relampago_centavos); fin.config = { saldo_inicial_centavos: p.p_saldo_inicial_centavos, inscricao_relampago_centavos: p.p_inscricao_relampago_centavos }; return { ok: true }; },
    fin_salvar_valor_temporada(p) { finPode('financeiro_lancar'); if (p.p_inscricao_centavos == null) delete fin.temporadas[p.p_temporada_id]; else { finVal(p.p_inscricao_centavos); fin.temporadas[p.p_temporada_id] = p.p_inscricao_centavos; } return { ok: true }; },
    fin_cobrar_rodada(p) {
      finPode('financeiro_lancar');
      if (!p.p_cobrar) { if (Object.values(fin.inscricoes).some((f) => f.liga_id === p.p_liga_id)) throw { message: 'rodada_com_pagamentos' }; delete fin.rodadas[p.p_liga_id]; return { ok: true }; }
      const l = db.ligas[p.p_liga_id]; if (!l) throw { message: 'liga_nao_encontrada' };
      fin.rodadas[l.id] = { liga_id: l.id, liga_nome: l.nome, inscricao_centavos: p.p_inscricao_centavos ?? null }; return { ok: true };
    },
    fin_marcar_inscricao(p) {
      finPode('financeiro_lancar'); if (!fin.rodadas[p.p_liga_id]) throw { message: 'rodada_sem_cobranca' };
      const k = p.p_liga_id + '|' + p.p_chave;
      if (p.p_status === 'pendente') { delete fin.inscricoes[k]; return { ok: true }; }
      const i = finInscritos((db.ligas[p.p_liga_id] || {}).dados).find((x) => x.chave === p.p_chave) || fin.inscricoes[k]; if (!i) throw { message: 'atleta_nao_inscrito' };
      const v = p.p_status === 'isento' ? 0 : p.p_valor_centavos ?? finValorRodada(p.p_liga_id); finVal(v);
      fin.inscricoes[k] = { liga_id: p.p_liga_id, chave: p.p_chave, nome: i.nome, atleta_id: i.atleta_id, status: p.p_status, valor_centavos: v, pago_em: p.p_status === 'pago' ? p.p_pago_em || hojeIso() : null };
      return { ok: true, valor_centavos: v };
    },
    fin_lancar(p) {
      finPode('financeiro_lancar'); if (!(p.p_valor_centavos >= 1)) throw { message: 'valor_invalido' }; if (!(p.p_categoria || '').trim()) throw { message: 'categoria_invalida' };
      const x = fin.lancamentos[p.p_id]; if (x && x.premio_id) throw { message: 'lancamento_de_premio' };
      fin.lancamentos[p.p_id] = { ...(x || { id: p.p_id, premio_id: null, ordem: ++finOrdem }), tipo: p.p_tipo, categoria: p.p_categoria, descricao: p.p_descricao, valor_centavos: p.p_valor_centavos, data: p.p_data || hojeIso(), liga_id: p.p_liga_id || null, temporada_id: p.p_temporada_id || null };
      return { ok: true, id: p.p_id };
    },
    fin_excluir_lancamento(p) { finPode('financeiro_lancar'); const x = fin.lancamentos[p.p_id]; if (!x || x.excluido) throw { message: 'lancamento_nao_encontrado' }; x.excluido = true; Object.values(fin.premios).forEach((q) => { if (q.lancamento_id === x.id) q.lancamento_id = null; }); return { ok: true }; },
    fin_salvar_premio(p) {
      finPode('financeiro_lancar'); finVal(p.p_valor_centavos); const q = fin.premios[p.p_id]; if (q && q.lancamento_id) throw { message: 'premio_pago' };
      fin.premios[p.p_id] = { id: p.p_id, liga_id: p.p_liga_id, temporada_id: p.p_temporada_id, colocacao: p.p_colocacao, descricao: p.p_descricao, valor_centavos: p.p_valor_centavos, lancamento_id: null }; return { ok: true, id: p.p_id };
    },
    fin_excluir_premio(p) { finPode('financeiro_lancar'); const q = fin.premios[p.p_id]; if (!q) throw { message: 'premio_nao_encontrado' }; if (q.lancamento_id) throw { message: 'premio_pago' }; delete fin.premios[p.p_id]; return { ok: true }; },
    fin_pagar_premio(p) {
      finPode('financeiro_lancar'); const q = fin.premios[p.p_id]; if (!q) throw { message: 'premio_nao_encontrado' }; if (q.lancamento_id) throw { message: 'premio_pago' };
      const id = uuid(); fin.lancamentos[id] = { id, tipo: 'saida', categoria: 'Prêmios', descricao: 'Premiação ' + q.colocacao + 'º lugar', valor_centavos: q.valor_centavos, data: p.p_data || hojeIso(), liga_id: q.liga_id, temporada_id: q.temporada_id, premio_id: q.id, ordem: ++finOrdem };
      q.lancamento_id = id; return { ok: true, lancamento_id: id };
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
