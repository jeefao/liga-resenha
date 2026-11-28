export const MOCK = () => {
  const db = { ligas: {}, atletas: {}, temporadas: {} };
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
