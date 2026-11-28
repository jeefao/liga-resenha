const APP_VERSION='7.7.1';
const SB_URL='https://frioxrtyffuotmmdmtxu.supabase.co';
const SB_KEY='sb_publishable_NTpbYH-L6cZG2Zx3K2bcdQ_7U8JoTZi';
const LEGACY_KEYS=['resenha16-evento-20261114-v4','resenha16-evento-20261114-v3'];
const FORMATS={
16:{counts:[4,4,4,4],label:'Todos os atletas avançam'},
20:{counts:[5,5,5,1],label:'3 melhores de cada grupo + melhor quarto'},
24:{counts:[6,6,4,0],label:'2 melhores de cada grupo + 4 melhores terceiros'},
28:{counts:[7,7,2,0],label:'2 melhores de cada grupo + 2 melhores terceiros'},
32:{counts:[8,8,0,0],label:'2 melhores de cada grupo'}
};
const SIZES=[16,20,24,28,32];
const STATUS_LABEL={preparacao:'Em preparação',andamento:'Em andamento',finalizada:'Finalizada',arquivada:'Arquivada'};
const ETAPA_LABEL={cadastro:'Cadastro de atletas',sorteio:'Sorteio dos grupos',grupos:'Fase de grupos',mata_mata:'Mata-mata',encerrada:'Encerrada'};
const ABA_DA_ETAPA={cadastro:'Atletas',sorteio:'Grupos',grupos:'Jogos',mata_mata:'Mata-mata',encerrada:'Chave'};
const tabs=['Painel','Atletas','Grupos','Jogos','Classificação','Mata-mata','Chave','Histórico'];

/* ---------- Estado ---------- */
let sb=null;
let view='carregando';      // carregando | login | inicio | nova | liga
let S=null;                 // dados da liga aberta (mesmo formato da versão anterior)
let L=null;                 // metadados da liga aberta (id, nome, data, versao...)
let tab='Painel';
let usuario=null;
let lista=[],lixeira=[],listaInfo={};
let mostrarLixeira=false;
let fila={pendente:false,eventos:[],motivo:null};
let enviando=false;
let sync={estado:'',msg:''};
let historico=null;
let ocupado=false;
let atletas=lsGet('lr6:atletas')?.lista||[];   // cadastro único (cópia local)
let atletasInfo={};
let atlFiltro={busca:'',situacao:'ativos'};
let atlBuscaLiga='';
let participacoes=null;

const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const objeto=v=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.parse(JSON.stringify(v)):{};
function lsGet(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}}
function hoje(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function fmtData(s){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?`${m[3]}/${m[2]}/${m[1]}`:esc(s)}
function fmtHora(iso){return iso?new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}
function fmtDataHora(iso){return iso?new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):''}
function novoId(){return crypto.randomUUID()}

/* ---------- Validação dos dados (nunca substitui por dados padrão) ---------- */
function validarDados(x){
  if(!x||typeof x!=='object'||!Array.isArray(x.names)||!SIZES.includes(x.names.length)||!x.names.every(n=>typeof n==='string'))
    throw new Error('dados da liga inválidos');
  const d={names:[...x.names],scores:objeto(x.scores),finals:objeto(x.finals),breaks:objeto(x.breaks),drawn:!!x.drawn,status:x.status};
  const temResultado=d.drawn||Object.keys(d.scores).length||Object.keys(d.finals).length;
  d.status=['draft','started','drawn','ended'].includes(d.status)?d.status:(temResultado?'drawn':'draft');
  if((d.status==='draft'||d.status==='started')&&temResultado)d.status='drawn';
  d.drawn=d.status==='drawn'||(d.status==='ended'&&!!x.drawn);
  // ids: atleta do cadastro em cada posição (null = nome sem vínculo)
  d.ids=Array.isArray(x.ids)&&x.ids.length===d.names.length?x.ids.map(v=>typeof v==='string'&&v?v:null):d.names.map(()=>null);
  // ordem dos cruzamentos das quartas ('antiga' = ligas que já tinham placar no mata-mata antes da troca)
  if(x.ordemChave==='antiga'||x.ordemChave==='planilha')d.ordemChave=x.ordemChave;
  // substituições no mata-mata (lesão) e W.O.
  if(Array.isArray(x.subs))d.subs=x.subs.filter(s=>s&&Number.isInteger(s.sai)&&Number.isInteger(s.entra)).map(s=>({sai:s.sai,entra:s.entra,atleta:s.atleta&&s.atleta.nome?{id:typeof s.atleta.id==='string'&&s.atleta.id?s.atleta.id:null,nome:String(s.atleta.nome)}:null,motivo:String(s.motivo||'lesão'),em:String(s.em||'')}));
  // substitutos na fase de grupos: a partir do jogo 'jogo' do grupo, quem joga na posição 'pos' é 'entra'
  if(Array.isArray(x.gsubs))d.gsubs=x.gsubs.filter(s=>s&&Number.isInteger(s.pos)&&Number.isInteger(s.jogo)&&Number.isInteger(s.entra)).map(s=>({pos:s.pos,jogo:s.jogo,entra:s.entra,atleta:s.atleta&&s.atleta.nome?{id:typeof s.atleta.id==='string'&&s.atleta.id?s.atleta.id:null,nome:String(s.atleta.nome)}:null,motivo:String(s.motivo||'lesão'),em:String(s.em||'')}));
  // etapas especiais: duplas sorteadas por jogo (s1, s2, f, t)
  if(x.sorteioMata&&typeof x.sorteioMata==='object'&&!Array.isArray(x.sorteioMata)){d.sorteioMata={};for(const k of ['s1','s2','f','t']){const v=x.sorteioMata[k];if(Array.isArray(v)&&v.length===2&&v.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isInteger)))d.sorteioMata[k]=v.map(p=>[...p])}}
  if(x.wo&&typeof x.wo==='object'&&!Array.isArray(x.wo)){d.wo={};for(const [k,v] of Object.entries(x.wo))if(v===0||v===1)d.wo[k]=v}
  return d;
}
// etapa especial: está nas regras da temporada ou a liga já tem sorteio de duplas gravado
function ehEspecial(liga,R,d){return !!(liga&&liga.temporada_id&&R&&R.especiais.includes(liga.etapa_numero))||!!(d&&d.sorteioMata&&Object.keys(d.sorteioMata).length)}
function comDados(d,fn){const old=S;S=d;try{return fn()}finally{S=old}}
function etapaDe(d){return comDados(d,()=>{if(S.status==='draft')return 'cadastro';if(S.status==='started')return 'sorteio';if(S.status==='ended')return 'encerrada';return complete()?'mata_mata':'grupos'})}
function statusDe(d){return d.status==='draft'?'preparacao':d.status==='ended'?'finalizada':'andamento'}
function statusAtual(){const s=statusDe(S);return s==='finalizada'&&L&&L.status==='arquivada'?'arquivada':s}
function dadosParaServidor(d=S){return JSON.parse(JSON.stringify({names:d.names,ids:d.ids||d.names.map(()=>null),scores:d.scores,finals:d.finals,breaks:d.breaks||{},drawn:!!d.drawn,status:d.status,...(d.ordemChave?{ordemChave:d.ordemChave}:{}),...(d.subs&&d.subs.length?{subs:d.subs}:{}),...(d.gsubs&&d.gsubs.length?{gsubs:d.gsubs}:{}),...(d.sorteioMata&&Object.keys(d.sorteioMata).length?{sorteioMata:d.sorteioMata}:{}),...(d.wo&&Object.keys(d.wo).length?{wo:d.wo}:{})}))}
// Cruzamentos das quartas (índices das duplas D1..D8). Ordem da planilha:
// Q1 = 1-2 x 15-16, Q2 = 5-6 x 11-12, Q3 = 7-8 x 9-10, Q4 = 3-4 x 13-14; Semi 1 = Q1 x Q2, Semi 2 = Q3 x Q4.
// Ligas que já tinham placar no mata-mata antes da mudança continuam na ordem antiga.
function ordemQuartas(d=S){const o=d.ordemChave||(Object.keys(d.finals||{}).length?'antiga':'planilha');return o==='antiga'?[[0,7],[3,4],[1,6],[2,5]]:[[0,7],[2,5],[3,4],[1,6]]}
function metaDe(r){return {id:r.id,nome:r.nome,data:r.data,participantes:r.participantes,status:r.status,etapa:r.etapa,versao:r.versao,atualizado_em:r.atualizado_em,temporada_id:r.temporada_id||null,etapa_numero:r.etapa_numero||null}}

/* ---------- Erros ---------- */
function ehErroDeRede(e){return !navigator.onLine||/Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(String(e&&(e.message||e)))}
function traduzErro(e){
  const m=String(e&&(e.message||e)||'erro desconhecido');
  if(ehErroDeRede(e))return 'sem conexão com o servidor';
  if(/sem_permissao/.test(m))return 'você não tem permissão para isso (fale com o dono da liga)';
  if(/rodada_com_pagamentos/.test(m))return 'esta rodada já tem pagamentos marcados; volte todos para pendente antes';
  if(/atleta_nao_inscrito/.test(m))return 'este atleta não está mais inscrito na liga (atualize a tela)';
  if(/rodada_sem_cobranca/.test(m))return 'esta rodada não está com cobrança ativa (atualize a tela)';
  if(/lancamento_nao_encontrado/.test(m))return 'este lançamento não existe mais (atualize a tela)';
  if(/premio_pago/.test(m))return 'este prêmio já foi pago; para mudar, exclua o lançamento do pagamento';
  if(/lancamento_de_premio/.test(m))return 'pagamento de prêmio não se edita; exclua e pague de novo';
  if(/valor_invalido/.test(m))return 'valor inválido';
  if(/categoria_invalida/.test(m))return 'escolha a categoria';
  if(/fin_resumo|fin_lancar|fin_marcar/.test(m)&&/not find|PGRST202|does not exist/.test(m))return 'o Finanças ainda não foi instalado no servidor';
  if(/aprove_antes/.test(m))return 'aprove o acesso da pessoa antes de torná-la administradora';
  if(/permissao_invalida/.test(m))return 'permissão desconhecida';
  if(/escolha_o_atleta/.test(m))return 'escolha o atleta do cadastro antes de aprovar';
  if(/muitos_pedidos/.test(m))return 'há muitos pedidos esperando; tente mais tarde ou fale com o administrador';
  if(/email_invalido/.test(m))return 'e-mail inválido';
  if(/pedido_nao_encontrado/.test(m))return 'este pedido não existe mais (atualize a lista)';
  if(/pedir_nova_senha|responder_pedido_senha/.test(m)&&/not find|PGRST202|does not exist/.test(m))return 'o pedido de senha nova ainda não foi instalado no servidor';
  if(/senha_curta/.test(m))return 'a senha precisa ter pelo menos 6 caracteres';
  if(/conta_de_administrador/.test(m))return 'não é possível alterar a conta do administrador por aqui';
  if(/pedido_ja_analisado/.test(m))return 'seu pedido já foi analisado pelo administrador';
  if(/nome_invalido/.test(m))return 'informe seu nome (de 3 a 80 letras)';
  if(/acesso_nao_encontrado/.test(m))return 'usuário não encontrado (atualize a lista)';
  if(/User already registered|already been registered/i.test(m))return 'já existe uma conta com este e-mail — use Entrar';
  if(/Password should be|password.*characters/i.test(m))return 'a senha precisa ter pelo menos 6 caracteres';
  if(/listar_acessos|meu_acesso|solicitar_acesso/.test(m)&&/not find|PGRST202|does not exist/.test(m))return 'o login dos atletas ainda não foi instalado no servidor';
  if(/acesso_negado|permission denied|JWT|jwt|401/.test(m))return 'sessão expirada ou sem permissão — entre novamente';
  if(/motivo_obrigatorio/.test(m))return 'liga finalizada exige um motivo para correção';
  if(/participantes_travados/.test(m))return 'a quantidade de atletas não pode mudar depois de iniciar a liga';
  if(/liga_na_lixeira/.test(m))return 'a liga está na lixeira';
  if(/liga_nao_encontrada|PGRST116/.test(m))return 'liga não encontrada';
  if(/atleta_ja_existe/.test(m))return 'já existe um atleta com esse nome no cadastro';
  if(/etapa_ja_existe/.test(m))return 'esta etapa já foi criada';
  if(/temporada_fechada/.test(m))return 'a temporada não está em andamento (reabra para criar etapas)';
  if(/ligas_etapa_unica/.test(m))return 'já existe outra etapa com este número nesta temporada';
  if(/criar_temporada|salvar_temporada|criar_etapa/.test(m)&&/not find|PGRST202|does not exist/.test(m))return 'as temporadas ainda não foram instaladas no servidor';
  if(/atleta_em_uso/.test(m))return 'este atleta aparece em alguma liga (inclusive na lixeira) e não pode ser apagado';
  if(/atleta_ativo/.test(m))return 'marque o atleta como inativo antes de apagar';
  if(/liga_fora_da_lixeira/.test(m))return 'só é possível apagar ligas que estão na lixeira';
  if(/excluir_definitivamente|esvaziar_lixeira|excluir_atleta/.test(m)&&/not find|PGRST202|does not exist/.test(m))return 'a exclusão definitiva ainda não foi instalada no servidor';
  if(/atletas.*does not exist|garantir_atletas|salvar_atleta|PGRST202|PGRST205/.test(m))return 'o cadastro de atletas ainda não foi instalado no servidor';
  return m;
}

/* ---------- Cópia local (cache temporário, nunca é a fonte oficial) ---------- */
const cacheKey=id=>'lr6:liga:'+id;
function gravarCache(){
  if(!L||!S)return;
  const ok=lsSet(cacheKey(L.id),{meta:L,dados:dadosParaServidor(),pendente:fila.pendente,eventos:fila.eventos,motivo:fila.motivo,em:new Date().toISOString()});
  if(!ok&&fila.pendente)setSync('erro','não foi possível guardar a cópia neste aparelho — mantenha o app aberto até salvar');
  atualizarListaGuardada(L);
}
function atualizarListaGuardada(meta){
  const c=lsGet('lr6:lista')||{em:null,ligas:[]};
  const ligas=(c.ligas||[]).filter(x=>x.id!==meta.id);
  ligas.push({...meta,excluida_em:null});
  ligas.sort((a,b)=>String(b.data).localeCompare(String(a.data))||String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
  lsSet('lr6:lista',{em:c.em,ligas});
}

/* ---------- Salvamento online ---------- */
function setSync(estado,msg=''){sync={estado,msg};renderSync()}
function persist(eventos=[],motivo=null){
  if(meuAcesso&&meuAcesso.admin&&!pode('ligas')){alert('Você não tem permissão para alterar ligas. Nada foi gravado.');if(L)abrirLiga(L.id,{ignorarCache:true});return}
  fila.pendente=true;
  fila.eventos.push(...eventos.map(e=>({tipo:e.tipo,descricao:String(e.descricao).slice(0,500)})));
  if(fila.eventos.length>100){const n=fila.eventos.length-90;fila.eventos=[{tipo:'alteracao',descricao:n+' alterações feitas sem conexão'},...fila.eventos.slice(-90)]}
  if(motivo)fila.motivo=motivo;
  gravarCache();
  if(sync.estado==='conflito'){renderSync();return}
  setSync(navigator.onLine?'pendente':'offline');
  enviar();
}
function devolverParaFila(lote){fila.pendente=true;fila.eventos=lote.eventos.concat(fila.eventos);fila.motivo=fila.motivo||lote.motivo}
async function enviar(){
  if(enviando||!fila.pendente||!L||view!=='liga'||sync.estado==='conflito')return;
  if(!navigator.onLine){setSync('offline');return}
  enviando=true;setSync('salvando');
  const lote={eventos:fila.eventos,motivo:fila.motivo};
  fila={pendente:false,eventos:[],motivo:null};
  try{
    const {data,error}=await sb.rpc('salvar_liga',{p_id:L.id,p_versao_esperada:L.versao,p_dados:dadosParaServidor(),p_status:statusAtual(),p_etapa:etapaDe(S),p_eventos:lote.eventos,p_motivo:lote.motivo});
    if(error)throw error;
    if(!data||!data.ok){
      devolverParaFila(lote);gravarCache();
      if(data&&data.conflito){setSync('conflito');abrirConflito(data)}else setSync('erro','resposta inesperada do servidor');
      return;
    }
    Object.assign(L,{versao:data.versao,status:data.status,etapa:data.etapa,participantes:data.participantes,atualizado_em:data.atualizado_em});
    gravarCache();
    setSync(fila.pendente?'pendente':'ok');
  }catch(e){
    devolverParaFila(lote);gravarCache();
    if(ehErroDeRede(e))setSync('offline');else setSync('erro',traduzErro(e));
  }finally{
    enviando=false;
    if(fila.pendente&&sync.estado==='pendente')enviar();
  }
}
function tentarNovamente(){if(sync.estado!=='conflito'){sync.estado='pendente';enviar()}}
function renderSync(){
  const el=$('sync');if(!el)return;
  if(view!=='liga'||!sync.estado){el.innerHTML='';return}
  const pend=fila.pendente?' — alterações guardadas neste aparelho':'';
  const m={
    salvando:['s-info','Salvando…'],
    ok:['s-ok','✓ Salvo no servidor às '+fmtHora(L&&L.atualizado_em)],
    pendente:['s-warn','Alterações pendentes'],
    offline:['s-warn','Sem conexão'+pend+(sync.msg?' • '+sync.msg:'')],
    erro:['s-err','Falha ao salvar: '+sync.msg+pend],
    conflito:['s-err','Conflito: esta liga foi alterada em outro aparelho'],
    desatualizada:['s-warn','Esta liga foi alterada em outro aparelho']
  }[sync.estado];
  if(!m){el.innerHTML='';return}
  let btn='';
  if((sync.estado==='erro'||sync.estado==='offline')&&fila.pendente)btn='<button onclick="tentarNovamente()">Tentar novamente</button>';
  if(sync.estado==='desatualizada')btn='<button onclick="abrirLiga(L.id,{ignorarCache:true})">Recarregar</button>';
  if(sync.estado==='conflito')btn='<button onclick="abrirConflito({})">Resolver</button>';
  el.innerHTML=`<div class="sync ${m[0]}"><span>${esc(m[1])}</span>${btn}</div>`;
}

/* ---------- Conflito entre aparelhos ---------- */
function fecharModal(){$('modal').innerHTML=''}
function abrirConflito(info){
  $('modal').innerHTML=`<div class="modal-bg"><div class="modal-box"><h2>Conflito de alterações</h2>
  <p>Esta liga foi alterada em outro aparelho${info.versao_servidor?` (versão ${info.versao_servidor}${info.atualizado_em?', às '+fmtHora(info.atualizado_em):''})`:''}. As alterações feitas aqui ainda <b>não</b> foram gravadas no servidor.</p>
  <p class="muted" style="margin-top:10px">Escolha o que fazer. Nada será apagado: a opção não escolhida fica guardada.</p>
  <div class="form-grid" style="margin-top:14px">
   <button onclick="usarVersaoServidor()">Usar a versão do servidor</button>
   <p class="muted">As alterações deste aparelho são baixadas num arquivo de backup.</p>
   <button class="secondary" onclick="manterMinhasAlteracoes()">Manter as alterações deste aparelho</button>
   <p class="muted">A versão do servidor fica no Histórico e pode ser restaurada.</p>
  </div></div></div>`;
}
async function usarVersaoServidor(){
  const id=L.id,nome=L.nome;
  const copia={app:'liga-resenha-v6',tipo:'liga',exportado_em:new Date().toISOString(),observacao:'Alterações descartadas em conflito',liga:{...L},dados:dadosParaServidor()};
  lsSet('lr6:descartada:'+id+':'+Date.now(),copia);
  baixarJSON(`alteracoes-descartadas-${slug(nome)}-${Date.now()}.json`,copia);
  fila={pendente:false,eventos:[],motivo:null};sync={estado:'',msg:''};
  fecharModal();
  await abrirLiga(id,{ignorarCache:true});
}
async function manterMinhasAlteracoes(){
  try{
    const {data,error}=await sb.from('ligas').select('versao').eq('id',L.id).single();
    if(error)throw error;
    L.versao=data.versao;
    fila.pendente=true;
    fila.eventos.push({tipo:'conflito',descricao:'Conflito resolvido: alterações deste aparelho mantidas sobre a versão '+data.versao});
    gravarCache();fecharModal();
    setSync('pendente');enviar();
  }catch(e){alert('Não foi possível resolver agora: '+traduzErro(e))}
}

/* ---------- Abrir liga ---------- */
async function abrirLiga(id,{ignorarCache=false}={}){
  if(enviando)return;
  fecharModal();
  view='carregando';render();
  const cache=ignorarCache?null:lsGet(cacheKey(id));
  let srv=null,erro=null;
  try{const {data,error}=await sb.from('ligas').select('*').eq('id',id).single();if(error)throw error;srv=data}catch(e){erro=e}
  fila={pendente:false,eventos:[],motivo:null};historico=null;sync={estado:'',msg:''};
  if(srv){
    let dadosSrv;
    try{dadosSrv=validarDados(srv.dados)}catch{alert('Os dados desta liga no servidor estão inválidos. Nada foi alterado. Use a exportação geral para guardar um backup e me avise.');voltarInicio(true);return}
    L=metaDe(srv);
    let dadosCache=null;
    if(cache&&cache.pendente&&cache.meta&&cache.meta.id===id){try{dadosCache=validarDados(cache.dados)}catch{}}
    if(dadosCache&&cache.meta.versao===srv.versao){
      S=dadosCache;fila={pendente:true,eventos:cache.eventos||[],motivo:cache.motivo||null};
      entrarNaLiga();setSync('pendente');enviar();return;
    }
    if(dadosCache){
      S=dadosCache;L.versao=cache.meta.versao;fila={pendente:true,eventos:cache.eventos||[],motivo:cache.motivo||null};
      entrarNaLiga();setSync('conflito');abrirConflito({versao_servidor:srv.versao,atualizado_em:srv.atualizado_em});return;
    }
    S=dadosSrv;gravarCache();entrarNaLiga();setSync('ok');return;
  }
  if(cache&&cache.meta&&cache.meta.id===id){
    try{S=validarDados(cache.dados)}catch{alert('Não foi possível abrir a liga: '+traduzErro(erro));voltarInicio(true);return}
    L=cache.meta;fila={pendente:!!cache.pendente,eventos:cache.eventos||[],motivo:cache.motivo||null};
    entrarNaLiga();
    setSync(ehErroDeRede(erro)?'offline':'erro',ehErroDeRede(erro)?'exibindo a cópia guardada neste aparelho em '+fmtDataHora(cache.em):traduzErro(erro));
    return;
  }
  alert('Não foi possível abrir a liga: '+traduzErro(erro));
  voltarInicio(true);
}
function entrarNaLiga(){
  view='liga';carregarAtletas();
  CONFRONTO_DIRETO=false;ESPECIAL=false;
  if(L.temporada_id){const t=(T&&T.id===L.temporada_id)?T:temporadas.find(x=>x.id===L.temporada_id);CONFRONTO_DIRETO=t?regrasCompletas(t.regras).confronto_direto:true;
    ESPECIAL=ehEspecial(L,t&&regrasCompletas(t.regras),S)}
  const salva=lsGet('lr6:aba:'+L.id);
  tab=tabs.includes(salva)?salva:(ABA_DA_ETAPA[L.etapa]||'Painel');
  render();
}
function voltarInicio(forcar=false){
  if(!forcar){
    if(enviando)return alert('Aguarde terminar de salvar.');
    if(fila.pendente&&!confirm('Há alterações ainda não gravadas no servidor. Elas ficam guardadas neste aparelho e serão enviadas quando você abrir esta liga de novo. Voltar mesmo assim?'))return;
  }
  const tid=L&&L.temporada_id;
  L=null;S=null;historico=null;fila={pendente:false,eventos:[],motivo:null};sync={estado:'',msg:''};CONFRONTO_DIRETO=false;ESPECIAL=false;
  if(tid){fecharModal();abrirTemporada(tid);return}
  fecharModal();view='inicio';render();carregarLista();
}

/* ---------- Login ---------- */
async function sair(){
  if(!confirm('Sair da conta neste aparelho?'))return;
  await sb.auth.signOut();usuario=null;meuAcesso=null;aModo='entrar';view='acesso';render();
}

/* ---------- Permissões dos administradores ---------- */
// O dono pode tudo; os outros administradores só o que o dono marcou. O servidor confere de novo.
const PERMISSOES=[['ligas','Ligas e jogos','criar ligas e etapas, inscrever, sortear, lançar placares, encerrar, lixeira'],['temporadas','Temporadas','criar e editar temporadas, regras, datas previstas, ajustes de pontos'],['atletas','Cadastro de atletas','criar e editar atletas'],['financeiro_ver','Financeiro: ver','abrir a página do financeiro'],['financeiro_lancar','Financeiro: lançar','registrar valores no financeiro']];
const ehDono=()=>!!(meuAcesso&&meuAcesso.admin&&meuAcesso.dono);
const pode=a=>!!(meuAcesso&&meuAcesso.admin&&(meuAcesso.dono||(meuAcesso.permissoes||[]).includes(a)));
// botões que gravam: função chamada no clique → permissão necessária ('dono' = só o dono)
const ACAO_PERMISSAO={ligas:"criarLiga duplicarLiga mudarArquivo moverParaLixeira retirarDaLixeira restaurarVersao startLeague endLeague corrigirResultados setCapacity clearNames shuffle sortearDuplasTela desfazerGrupoTela confirmarDuplasManual abrirDuplasManual chooseTie resetTie digitarPlacar previaWO abrirWO confirmarWO novoAtletaParaWO previaSub abrirSubstituicao aplicarSubstituicao desfazerSubstituicao removerPosicao toggleAtleta novoAtletaNaLiga aplicarColarLista abrirColarLista vincularCadastro importarAntiga importarArquivo abrirNovaEtapa criarEtapa usarVersaoServidor manterMinhasAlteracoes",
  temporadas:"criarTemporada mudarStatusTemporada salvarRegras salvarDataPrevista adicionarAjuste removerAjuste",
  atletas:"abrirAtletaForm salvarAtletaForm",
  financeiro_lancar:"finAbrirLanc finSalvarLanc finExcluirLanc finBaixar finMarcar finValorPago finSalvarValorPago finCobrar finParar finValorRodada finSalvarAjustes finSalvarValorTemp finAbrirPremio finSalvarPremio finExcluirPremio finPagarPremio",dono:"apagarDeVez esvaziarLixeira apagarAtleta apagarTemporada abrirUsuarios responderSenha"};
const FN_PERMISSAO={};for(const [a,l] of Object.entries(ACAO_PERMISSAO))for(const f of l.split(' '))FN_PERMISSAO[f]=a;
function permitido(a){return a==='dono'?ehDono():pode(a)}
function areaDoClique(c){
  if(/^view='nova'/.test(c)||/\$\('imp'\)/.test(c))return 'ligas';
  if(/^view='nova-temporada'/.test(c))return 'temporadas';
  const m=c.match(/^\s*(?:await\s+)?([A-Za-z_$][\w$]*)\(/);return m&&FN_PERMISSAO[m[1]];
}
// depois de desenhar a tela: some o que a pessoa não pode fazer e trava os campos das áreas sem permissão
function aplicarPermissoes(){
  if(!meuAcesso||!meuAcesso.admin||ehDono()||emConsulta())return;
  document.querySelectorAll('#main [onclick],#lifecycle [onclick],#modal [onclick]').forEach(e=>{const a=areaDoClique(e.getAttribute('onclick'));if(a&&!permitido(a))e.remove()});
  const trava=(view==='liga'&&!pode('ligas'))||(view==='temporada'&&!pode('temporadas'))||(view==='financas'&&!pode('financeiro_lancar'));
  if(trava)document.querySelectorAll('#main input:not([type=checkbox][data-leitura]),#main select,#main textarea').forEach(e=>{if(!e.closest('[data-leitura]'))e.disabled=true});
}

/* ---------- Instalar como app no celular ---------- */
let pedidoInstalar=null;
const appInstalado=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ehIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pedidoInstalar=e;if(['acesso','publica','inicio'].includes(view))render()});
window.addEventListener('appinstalled',()=>{pedidoInstalar=null;if(['acesso','publica','inicio'].includes(view))render()});
function botaoInstalar(estilo=''){
  if(appInstalado()||!(pedidoInstalar||ehIOS()))return '';
  return `<button class="secondary pub" style="${estilo}" onclick="instalarApp()">Instalar app</button>`;
}
async function instalarApp(){
  if(pedidoInstalar){const p=pedidoInstalar;pedidoInstalar=null;p.prompt();try{await p.userChoice}catch{}render();return}
  alert('Para instalar no iPhone:\n1. Abra esta página no Safari.\n2. Toque no botão Compartilhar (quadrado com a seta para cima).\n3. Escolha "Adicionar à Tela de Início" e toque em Adicionar.\n\nO ícone da Liga Resenha aparece na tela do celular.');
}

/* ---------- Acesso dos atletas (página de consulta) ---------- */
// meuAcesso: resposta de meu_acesso(); aModo: 'entrar' | 'criar'
let meuAcesso=null,aModo='entrar',aMsg='';
async function verificarAcesso(){
  view='carregando';render();
  try{
    const {data,error}=await sb.rpc('meu_acesso');if(error)throw error;
    meuAcesso=data;aMsg='';
    lsSet('lr6:acesso',data&&data.admin?data:{admin:false});
    if(data&&(data.admin||data.status==='aprovado'))sb.rpc('registrar_visita').then(()=>{},()=>{});
    if(data&&data.admin)return abrirAdministracao();
    if(data&&data.status==='aprovado')return abrirConsulta();
  }catch(e){
    // sem internet, o administrador continua usando o que está guardado no aparelho
    const g=lsGet('lr6:acesso');
    if(ehErroDeRede(e)&&g&&g.admin){meuAcesso=g;return abrirAdministracao()}
    meuAcesso=null;aMsg='Não foi possível verificar seu acesso: '+traduzErro(e);
  }
  view='acesso';render();
}
function abrirAdministracao(){
  T=null;TE=[];L=null;S=null;CONFRONTO_DIRETO=false;ESPECIAL=false;pontosCache.clear();
  view='inicio';render();carregarLista();carregarAtletas();conferirPendentes();
}
async function entrarAtleta(ev){
  ev.preventDefault();
  const btn=$('btnEntrar');btn.disabled=true;$('loginMsg').textContent='Entrando…';
  try{
    const {data,error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('senha').value});
    if(error)throw error;
    usuario=data.user;verificarAcesso();
  }catch(e){$('loginMsg').textContent=/Invalid login/i.test(e.message||'')?'E-mail ou senha incorretos.':/not confirmed/i.test(e.message||'')?'E-mail ainda não confirmado. Avise o administrador.':traduzErro(e);btn.disabled=false}
}
async function criarConta(ev){
  ev.preventDefault();
  const nome=$('nome').value.replace(/\s+/g,' ').trim(),senha=$('senha').value;
  if(nome.length<3)return $('loginMsg').textContent='Informe seu nome completo.';
  if(senha.length<6)return $('loginMsg').textContent='A senha precisa ter pelo menos 6 caracteres.';
  if(senha!==$('senha2').value)return $('loginMsg').textContent='As duas senhas não são iguais.';
  const btn=$('btnEntrar');btn.disabled=true;$('loginMsg').textContent='Criando conta…';
  try{
    const {data,error}=await sb.auth.signUp({email:$('email').value.trim(),password:senha});
    if(error)throw error;
    if(!data.session){$('loginMsg').textContent='Conta criada, mas o servidor pediu confirmação por e-mail. Avise o administrador para liberar.';btn.disabled=false;return}
    usuario=data.user;
    const r=await sb.rpc('solicitar_acesso',{p_nome:nome});if(r.error)throw r.error;
    verificarAcesso();
  }catch(e){$('loginMsg').textContent='Não foi possível criar a conta: '+traduzErro(e);btn.disabled=false}
}
function esqueciSenha(){aModo='senha';aMsg='';render()}
// esqueci a senha: o pedido fica guardado e só vale quando o dono aprovar
async function pedirNovaSenha(ev){
  ev.preventDefault();
  const email=$('email').value.trim(),senha=$('senha').value;
  if(senha.length<6)return $('loginMsg').textContent='A senha precisa ter pelo menos 6 caracteres.';
  if(senha!==$('senha2').value)return $('loginMsg').textContent='As duas senhas não são iguais.';
  const btn=$('btnEntrar');btn.disabled=true;$('loginMsg').textContent='Enviando pedido…';
  try{const r=await sb.rpc('pedir_nova_senha',{p_email:email,p_senha:senha});if(r.error)throw r.error;
    aModo='entrar';aMsg='';render();$('email').value=email;
    $('loginMsg').className='ok';$('loginMsg').textContent='Pedido enviado. Assim que o administrador aprovar, entre com a senha nova.'}
  catch(e){$('loginMsg').textContent='Pedido não enviado: '+traduzErro(e);btn.disabled=false}
}
async function pedirAcesso(ev){
  ev.preventDefault();
  const btn=$('btnEntrar');btn.disabled=true;$('loginMsg').textContent='Enviando pedido…';
  try{const r=await sb.rpc('solicitar_acesso',{p_nome:$('nome').value});if(r.error)throw r.error;verificarAcesso()}
  catch(e){$('loginMsg').textContent='Pedido não enviado: '+traduzErro(e);btn.disabled=false}
}
async function sairConsulta(){
  if(!confirm('Sair da conta neste aparelho?'))return;
  await sb.auth.signOut();usuario=null;meuAcesso=null;aModo='entrar';view='acesso';render();
}
function renderAcesso(){
  const topo=`<section><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h2>Liga Resenha</h2>${botaoInstalar('padding:6px 10px')}</div>`;
  if(!usuario){
    if(aModo==='senha')return topo+`<p class="muted">Esqueceu a senha? Informe o e-mail da sua conta e a senha nova. Ela passa a valer quando o administrador aprovar.</p>
     <form onsubmit="pedirNovaSenha(event)" class="form-grid" style="margin-top:12px">
      <label>E-mail<input id="email" type="email" autocomplete="username" required></label>
      <label>Senha nova (mínimo 6 caracteres)<input id="senha" type="password" autocomplete="new-password" required></label>
      <label>Repita a senha nova<input id="senha2" type="password" autocomplete="new-password" required></label>
      <div class="panel-actions"><button type="submit" id="btnEntrar">PEDIR NOVA SENHA</button><button type="button" class="ghost" onclick="aModo='entrar';render()">Voltar</button></div>
      <p id="loginMsg" class="warn">${esc(aMsg)}</p>
     </form></section>`;
    const criar=aModo==='criar';
    return topo+`<p class="muted">${criar?'Crie sua conta. O administrador confere e libera o acesso.':'Entre com o seu e-mail e a sua senha.'}</p>
     <div class="row" style="gap:6px;margin-top:10px"><button class="${criar?'secondary':''}" onclick="aModo='entrar';render()">Entrar</button><button class="${criar?'':'secondary'}" onclick="aModo='criar';render()">Criar conta</button></div>
     <form onsubmit="${criar?'criarConta':'entrarAtleta'}(event)" class="form-grid" style="margin-top:12px">
      ${criar?'<label>Seu nome (como é conhecido na liga)<input id="nome" maxlength="80" autocomplete="name" required></label>':''}
      <label>E-mail<input id="email" type="email" autocomplete="username" required></label>
      <label>Senha${criar?' (mínimo 6 caracteres)':''}<input id="senha" type="password" autocomplete="${criar?'new-password':'current-password'}" required></label>
      ${criar?'<label>Repita a senha<input id="senha2" type="password" autocomplete="new-password" required></label>':''}
      <div class="panel-actions"><button type="submit" id="btnEntrar">${criar?'CRIAR CONTA':'ENTRAR'}</button></div>
      <p id="loginMsg" class="warn">${esc(aMsg)}</p>
     </form>${criar?'':'<div class="panel-actions"><button class="ghost" onclick="esqueciSenha()">Esqueci a senha</button></div>'}</section>`;
  }
  const st=meuAcesso&&meuAcesso.status,sairB='<div class="panel-actions"><button class="ghost" onclick="sairConsulta()">Sair</button></div>';
  if(!meuAcesso)return topo+`<p class="warn" style="margin-top:6px">${esc(aMsg||'Não foi possível verificar seu acesso.')}</p><div class="panel-actions"><button onclick="verificarAcesso()">Tentar de novo</button><button class="ghost" onclick="sairConsulta()">Sair</button></div></section>`;
  if(st==='pendente')return topo+`<p style="margin-top:6px">Olá, <b>${esc(meuAcesso.nome)}</b>! Seu pedido de acesso foi enviado.</p><p class="muted" style="margin-top:6px">Aguardando a aprovação do administrador. Depois de aprovado, é só abrir esta página de novo.</p><div class="panel-actions"><button onclick="verificarAcesso()">Já fui aprovado? Verificar</button><button class="ghost" onclick="sairConsulta()">Sair</button></div></section>`;
  if(st==='bloqueado')return topo+`<p class="warn" style="margin-top:6px">Seu acesso está bloqueado. Fale com o administrador da liga.</p>${sairB}</section>`;
  return topo+`<p class="muted" style="margin-top:6px">${st==='recusado'?'Seu pedido anterior não foi aprovado. Confira o nome e peça de novo, ou fale com o administrador.':'Falta só pedir o acesso: informe seu nome.'}</p>
   <form onsubmit="pedirAcesso(event)" class="form-grid" style="margin-top:12px"><label>Seu nome (como é conhecido na liga)<input id="nome" maxlength="80" required value="${esc((meuAcesso&&meuAcesso.nome)||'')}"></label>
    <div class="panel-actions"><button type="submit" id="btnEntrar">PEDIR ACESSO</button></div><p id="loginMsg" class="warn">${esc(aMsg)}</p></form>${sairB}</section>`;
}

/* ---------- Usuários da página de consulta (administrador) ---------- */
let acessos=[],acessosInfo={};
const ACESSO_LABEL={pendente:'Aguardando',aprovado:'Aprovado',bloqueado:'Bloqueado',recusado:'Recusado'};
async function carregarAcessos(){
  acessosInfo={carregando:true};if(view==='usuarios')render();
  try{const {data,error}=await sb.rpc('listar_acessos');if(error)throw error;acessos=data||[];acessosInfo={}}
  catch(e){acessosInfo={erro:traduzErro(e)}}
  if(view==='usuarios'||view==='inicio')render();
}
const precisaAtencao=a=>a.status==='pendente'||!!a.pedido_senha_em;
const pendentesAprovacao=()=>acessos.filter(precisaAtencao).length;
async function responderSenha(uid,aprovar){
  const a=acessos.find(x=>x.user_id===uid);if(!a||ocupado)return;
  if(!confirm(aprovar?'Aprovar a senha nova de '+a.nome_informado+' ('+a.email+')?\n\nConfira se foi mesmo ele quem pediu. Depois disso, ele entra com a senha que digitou.':'Recusar o pedido de senha nova de '+a.nome_informado+'? A senha atual continua valendo.'))return;
  ocupado=true;
  try{const {error}=await sb.rpc('responder_pedido_senha',{p_user_id:uid,p_aprovar:aprovar});if(error)throw error;ocupado=false;await carregarAcessos();alert(aprovar?'Senha nova de '+a.nome_informado+' liberada.':'Pedido recusado.')}
  catch(e){alert('Nada foi alterado: '+traduzErro(e))}finally{ocupado=false}
}
// o dono vê no botão Usuários quantas pessoas esperam aprovação
function conferirPendentes(){if(ehDono()&&navigator.onLine)carregarAcessos()}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&view==='inicio')conferirPendentes()});
function abrirUsuarios(){view='usuarios';render();carregarAcessos();carregarAtletas()}
// atleta sugerido: o já ligado, ou o do cadastro com o mesmo nome informado
function atletaSugerido(a){if(a.atleta_id)return a.atleta_id;const n=normNome(a.nome_informado),x=atletas.find(t=>normNome(t.nome)===n||normNome(t.apelido||'')===n);return x?x.id:''}
async function acaoAcesso(uid,status){
  const a=acessos.find(x=>x.user_id===uid);if(!a||ocupado)return;
  const sel=$('ua-'+uid),atl=sel&&sel.value||null;
  if(status==='aprovado'&&!atl)return alert('Escolha o atleta do cadastro antes de aprovar.');
  if(status==='bloqueado'&&!confirm('Bloquear o acesso de '+a.nome_informado+'? Ele não verá mais a página de consulta até ser desbloqueado.'))return;
  if(status==='recusado'&&!confirm('Recusar o pedido de '+a.nome_informado+'?'))return;
  ocupado=true;
  try{const {error}=await sb.rpc('definir_acesso',{p_user_id:uid,p_status:status,p_atleta_id:status==='aprovado'?atl:null});if(error)throw error;ocupado=false;await carregarAcessos()}
  catch(e){alert('Nada foi alterado: '+traduzErro(e))}finally{ocupado=false}
}
async function trocarSenhaAcesso(uid){
  const a=acessos.find(x=>x.user_id===uid);if(!a||ocupado)return;
  const s=prompt('Nova senha provisória para '+a.email+' (mínimo 6 caracteres).\nPasse a senha para o atleta; ele entra com ela.');
  if(s===null)return;
  if(s.length<6)return alert('A senha precisa ter pelo menos 6 caracteres. Nada foi alterado.');
  ocupado=true;
  try{const {error}=await sb.rpc('trocar_senha_acesso',{p_user_id:uid,p_senha:s});if(error)throw error;alert('Senha de '+a.email+' alterada.')}
  catch(e){alert('Senha não alterada: '+traduzErro(e))}finally{ocupado=false}
}
async function excluirAcesso(uid){
  const a=acessos.find(x=>x.user_id===uid);if(!a||ocupado)return;
  if(!confirm('Excluir a conta de login '+a.email+'?\n\nA pessoa perde o acesso e precisa criar outra conta. O atleta do cadastro e os resultados continuam.'))return;
  ocupado=true;
  try{const {error}=await sb.rpc('excluir_acesso',{p_user_id:uid});if(error)throw error;ocupado=false;await carregarAcessos()}
  catch(e){alert('Nada foi excluído: '+traduzErro(e))}finally{ocupado=false}
}
function cartaoAcesso(a){
  const sug=atletaSugerido(a),ops=atletas.filter(t=>t.situacao!=='inativo'||t.id===a.atleta_id);
  const sel=`<label style="margin-top:8px">Atleta do cadastro<select id="ua-${a.user_id}"><option value="">— escolher —</option>${ops.map(t=>`<option value="${t.id}"${t.id===sug?' selected':''}>${esc(t.nome)}</option>`).join('')}</select></label>`;
  const b=(t,f,c='secondary')=>`<button class="${c}" onclick="${f}">${t}</button>`;
  const acoes={pendente:b('Aprovar',`acaoAcesso('${a.user_id}','aprovado')`,'')+b('Recusar',`acaoAcesso('${a.user_id}','recusado')`),
    aprovado:b('Salvar atleta ligado',`acaoAcesso('${a.user_id}','aprovado')`)+b('Bloquear',`acaoAcesso('${a.user_id}','bloqueado')`),
    bloqueado:b('Desbloquear',`acaoAcesso('${a.user_id}','aprovado')`,''),recusado:b('Aprovar',`acaoAcesso('${a.user_id}','aprovado')`,'')}[a.status]||'';
  return `<div class="liga-card"><div class="row" style="justify-content:space-between;align-items:flex-start">
    <div style="min-width:0"><h3>${esc(a.nome_informado)}</h3><p class="muted" style="overflow-wrap:anywhere">${esc(a.email)}</p></div>
    <span class="row" style="gap:4px;flex-wrap:nowrap">${a.admin?'<span class="chip ac-adm">ADM</span>':''}<span class="chip ac-${a.status}">${ACESSO_LABEL[a.status]||esc(a.status)}</span></span></div>
   <p class="muted" style="margin-top:6px">Atleta ligado: <b>${a.atleta_nome?esc(a.atleta_nome):'nenhum'}</b> • Pedido em ${fmtDataHora(a.criado_em)} • Último acesso: ${a.ultimo_acesso?fmtDataHora(a.ultimo_acesso):'nunca'}</p>
   ${a.pedido_senha_em?`<div class="tie-card tie-pending" style="margin-top:8px;padding:10px;border-radius:10px"><b>🔑 Pediu senha nova em ${fmtDataHora(a.pedido_senha_em)}</b><div class="panel-actions">${b('Aprovar senha nova',`responderSenha('${a.user_id}',true)`,'')}${b('Recusar',`responderSenha('${a.user_id}',false)`)}</div></div>`:''}
   ${sel}${a.status==='aprovado'?blocoAdmin(a):''}<div class="panel-actions">${acoes}${b('Trocar senha',`trocarSenhaAcesso('${a.user_id}')`)}${b('🗑 Excluir conta',`excluirAcesso('${a.user_id}')`,'ghost')}</div></div>`;
}
function blocoAdmin(a){
  const u=a.user_id,per=a.permissoes||[];
  return `<details style="margin-top:10px"${a.admin?' open':''}><summary><b>${a.admin?'Administrador — permissões':'Tornar administrador'}</b></summary>
   <label style="display:flex;flex-direction:row;gap:10px;align-items:flex-start;margin-top:8px;font-weight:400"><input type="checkbox" style="width:20px;height:20px;flex:none;margin:2px 0 0;padding:0" id="adm-${u}"${a.admin?' checked':''} onchange="document.getElementById('perms-${u}').style.opacity=this.checked?1:.4"> <span><b>É administrador</b> <span class="muted">(entra na administração do app)</span></span></label>
   <div id="perms-${u}" style="margin:6px 0 0 4px;opacity:${a.admin?1:.4}">${PERMISSOES.map(([k,t,d])=>`<label style="display:flex;flex-direction:row;gap:10px;align-items:flex-start;margin-top:8px;font-weight:400"><input type="checkbox" style="width:20px;height:20px;flex:none;margin:2px 0 0;padding:0" data-perm="${k}"${per.includes(k)?' checked':''}> <span><b>${t}</b><br><span class="muted">${d}</span></span></label>`).join('')}</div>
   <p class="muted" style="margin-top:8px">Só você mexe na aba Usuários e apaga de vez.</p>
   <div class="panel-actions"><button class="secondary" onclick="salvarAdmin('${u}')">Salvar permissões</button></div></details>`;
}
async function salvarAdmin(uid){
  const a=acessos.find(x=>x.user_id===uid);if(!a||ocupado)return;
  const ehAdm=$('adm-'+uid).checked,perms=[...$('perms-'+uid).querySelectorAll('[data-perm]:checked')].map(e=>e.dataset.perm);
  if(!ehAdm&&a.admin&&!confirm('Tirar '+a.nome_informado+' da administração? Ele continua vendo a página de consulta.'))return;
  ocupado=true;
  try{const {error}=await sb.rpc('definir_admin',{p_user_id:uid,p_admin:ehAdm,p_permissoes:perms});if(error)throw error;ocupado=false;await carregarAcessos();alert(ehAdm?'Permissões de '+a.nome_informado+' salvas.':a.nome_informado+' não é mais administrador.')}
  catch(e){alert('Nada foi alterado: '+traduzErro(e))}finally{ocupado=false}
}
function renderUsuarios(){
  const pend=acessos.filter(precisaAtencao),outros=acessos.filter(a=>!precisaAtencao(a));
  let h=`<section><button class="ghost" onclick="voltarInicio()">← Minhas Ligas</button><h2 style="margin-top:12px">Usuários do app</h2>
   <p class="muted">Atletas que criaram conta no app. Só os aprovados veem a página de consulta. As senhas não ficam visíveis (o servidor guarda só uma versão embaralhada); quem esquecer pede uma senha nova no app e ela aparece aqui para você aprovar (ou defina uma senha provisória).</p>
   <div class="panel-actions"><button class="secondary" onclick="copiarLinkPublico()">🔗 Copiar link da página de consulta</button><button class="secondary" onclick="carregarAcessos()">↻ Atualizar</button></div></section>`;
  if(acessosInfo.erro)return h+`<section class="tie-card tie-pending"><b>Não foi possível carregar</b><p class="muted" style="margin-top:6px">${esc(acessosInfo.erro)}</p></section>`;
  if(acessosInfo.carregando&&!acessos.length)return h+'<section><p class="muted">Carregando…</p></section>';
  h+=`<section><h2>Aguardando aprovação (${pend.length})</h2>${pend.length?'<div class="ligas-list">'+pend.map(cartaoAcesso).join('')+'</div>':'<p class="muted">Nenhum pedido novo.</p>'}</section>`;
  h+=`<section><h2>Contas (${outros.length})</h2>${outros.length?'<div class="ligas-list">'+outros.map(cartaoAcesso).join('')+'</div>':'<p class="muted">Nenhuma conta ainda.</p>'}</section>`;
  return h;
}

/* ---------- Minhas Ligas ---------- */
async function carregarLista(){
  listaInfo={carregando:true};if(view==='inicio')render();
  carregarTemporadas();
  try{
    const {data,error}=await sb.from('ligas').select('id,nome,data,participantes,status,etapa,versao,atualizado_em,excluida_em,temporada_id,etapa_numero').order('data',{ascending:false}).order('atualizado_em',{ascending:false});
    if(error)throw error;
    lista=data.filter(x=>!x.excluida_em);lixeira=data.filter(x=>x.excluida_em);
    const ant=lsGet('lr6:lista');
    lsSet('lr6:lista',{em:new Date().toISOString(),ligas:lista});
    // Ligas guardadas no aparelho com alterações pendentes continuam listadas
    for(const x of ((ant&&ant.ligas)||[]))if(!data.some(y=>y.id===x.id)&&pendenteNoAparelho(x.id))lista.push(x);
    listaInfo={origem:'servidor'};
  }catch(e){
    const c=lsGet('lr6:lista');lista=(c&&c.ligas)||[];lixeira=[];
    listaInfo={origem:'cache',erro:traduzErro(e),em:c&&c.em};
  }
  if(view==='inicio')render();
}
function pendenteNoAparelho(id){const c=lsGet(cacheKey(id));return !!(c&&c.pendente)}
function ligaCard(x){
  const pend=pendenteNoAparelho(x.id);
  return `<div class="liga-card">
   <div class="row" style="justify-content:space-between;align-items:flex-start">
    <div><h3>${esc(x.nome)}</h3><p class="muted">${fmtData(x.data)} • ${x.participantes} atletas</p></div>
    <span class="chip st-${x.status}">${STATUS_LABEL[x.status]||esc(x.status)}</span>
   </div>
   <p style="margin-top:8px">Etapa: <b>${ETAPA_LABEL[x.etapa]||esc(x.etapa)}</b></p>
   <p class="muted">Último salvamento: ${fmtDataHora(x.atualizado_em)} • versão ${x.versao}</p>
   ${pend?'<p class="warn" style="margin-top:4px">⚠ Alterações pendentes neste aparelho — abra a liga para enviar</p>':''}
   <div class="panel-actions">
    <button onclick="abrirLiga('${x.id}')">ABRIR</button>
    <button class="secondary" onclick="duplicarLiga('${x.id}')">Duplicar</button>
    ${x.status==='finalizada'?`<button class="secondary" onclick="mudarArquivo('${x.id}',true)">Arquivar</button>`:''}
    ${x.status==='arquivada'?`<button class="secondary" onclick="mudarArquivo('${x.id}',false)">Desarquivar</button>`:''}
    <button class="ghost" onclick="moverParaLixeira('${x.id}')">🗑 Lixeira</button>
   </div></div>`;
}
function renderInicio(){
  const relampagos=lista.filter(x=>!x.temporada_id),ativas=relampagos.filter(x=>x.status!=='arquivada'),arquivadas=relampagos.filter(x=>x.status==='arquivada');
  const tAtivas=temporadas.filter(t=>t.status!=='arquivada'),tArquivadas=temporadas.filter(t=>t.status==='arquivada');
  const antiga=ligaAntigaDoAparelho();
  let h=`<section><div class="atalhos">${pode('financeiro_ver')?'<button class="secondary" onclick="abrirFinancas()">Finanças</button>':''}<button class="secondary" onclick="abrirAtletas()">Atletas</button><button class="secondary" onclick="abrirUsuarios()">Usuários${pendentesAprovacao()?` <span class="alerta" title="pessoas esperando aprovação">🔔 ${pendentesAprovacao()}</span>`:''}</button><button class="secondary" onclick="abrirConsulta()">Página de consulta</button><button class="secondary" onclick="atualizarInicio()" title="Buscar de novo os dados no servidor">↻ Atualizar</button>${botaoInstalar('')}</div>${meuAcesso&&meuAcesso.admin&&!ehDono()?`<p class="muted" style="margin-top:10px">Suas permissões: ${PERMISSOES.filter(([k])=>pode(k)).map(([,t])=>t).join(', ')||'só consultar'}.</p>`:''}</section>`;
  if(listaInfo.origem==='cache')h+=`<section class="tie-card tie-pending"><b>Sem conexão com o servidor</b><p class="muted" style="margin-top:6px">${listaInfo.em?'Mostrando a lista guardada neste aparelho em '+fmtDataHora(listaInfo.em)+'.':'Nenhuma lista guardada neste aparelho.'} (${esc(listaInfo.erro)})</p><div class="panel-actions"><button class="secondary" onclick="carregarLista()">Tentar novamente</button></div></section>`;
  if(antiga)h+=`<section class="tie-card tie-pending"><b>Liga da versão anterior encontrada neste aparelho</b>
   <p style="margin-top:6px">${antiga.d.names.length} atletas • ${esc(statusText(antiga.d))} • ${esc(antiga.d.names.slice(0,4).filter(Boolean).join(', '))}${antiga.d.names.filter(Boolean).length>4?'…':''}</p>
   <p class="muted" style="margin-top:6px">Ela continua guardada aqui. Você pode importá-la como uma nova liga online.</p>
   <div class="panel-actions"><button onclick="importarAntiga()">Importar como nova liga</button><button class="secondary" onclick="baixarAntiga()">Baixar backup</button><button class="ghost" onclick="ocultarAntiga()">Ocultar aviso</button></div></section>`;
  h+=`<section><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Temporadas</h2><button class="secondary" onclick="view='nova-temporada';render()">+ Nova temporada</button></div>${tAtivas.length?'<div class="ligas-list" style="margin-top:10px">'+tAtivas.map(temporadaCard).join('')+'</div>':'<p class="muted" style="margin-top:8px">Nenhuma temporada ainda.</p>'}${tArquivadas.length?`<details style="margin-top:10px"><summary><b>Temporadas arquivadas (${tArquivadas.length})</b></summary><div class="ligas-list" style="margin-top:10px">${tArquivadas.map(temporadaCard).join('')}</div></details>`:''}</section>`;
  h+=`<section><div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0">Ligas relâmpago</h2><button class="secondary" onclick="view='nova';render()">+ Nova liga relâmpago</button></div>${listaInfo.carregando&&!lista.length?'<p class="muted">Carregando…</p>':ativas.length?'<div class="ligas-list">'+ativas.map(ligaCard).join('')+'</div>':listaInfo.origem==='cache'?'<p class="muted">Nenhuma liga guardada neste aparelho.</p>':'<p class="muted">Nenhuma liga ainda.</p>'}</section>`;
  if(arquivadas.length)h+=`<section><details><summary><b>Arquivadas (${arquivadas.length})</b></summary><div class="ligas-list" style="margin-top:10px">${arquivadas.map(ligaCard).join('')}</div></details></section>`;
  h+=`<section><h3>Backups</h3><p class="muted" style="margin-top:6px">Exporte todas as ligas num arquivo. A importação sempre cria ligas novas e nunca altera as existentes.</p>
   <div class="panel-actions"><button class="secondary" onclick="exportarTodas()">Exportar todas as ligas</button><button class="secondary" onclick="$('imp').click()">Importar backup</button><input id="imp" type="file" accept=".json,application/json" hidden onchange="importarArquivo(event)"></div></section>`;
  h+=`<section><details ${mostrarLixeira?'open':''} ontoggle="mostrarLixeira=this.open"><summary><b>Lixeira (${lixeira.length})</b></summary>${lixeira.length?lixeira.map(x=>`<div class="liga-card" style="margin-top:10px"><h3>${esc(x.nome)}</h3><p class="muted">${x.etapa_numero?'Etapa '+x.etapa_numero+' de temporada • ':''}${fmtData(x.data)} • ${x.participantes} atletas • na lixeira desde ${fmtDataHora(x.excluida_em)}</p><div class="panel-actions"><button class="secondary" onclick="retirarDaLixeira('${x.id}')">Retirar da lixeira</button><button class="danger" onclick="apagarDeVez('${x.id}')">Apagar de vez</button></div></div>`).join('')+`<div class="panel-actions" style="margin-top:14px"><button class="danger" onclick="esvaziarLixeira()">ESVAZIAR LIXEIRA (${lixeira.length})</button></div><p class="muted" style="margin-top:6px">Apagar de vez não tem volta. Antes, o app baixa um arquivo de backup das ligas apagadas.</p>`:'<p class="muted" style="margin-top:8px">Vazia.</p>'}</details></section>`;
  if(ehDono())h+=`<section><details ${histApp.aberto?'open':''} ontoggle="abrirHistApp(this.open)"><summary><b>Histórico do app</b></summary>
    <p class="muted" style="margin-top:8px">Tudo o que acontece no app: ligas, temporadas, atletas, contas, financeiro e visitas, com quem fez e quando. Ações repetidas em poucos minutos aparecem juntas.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${HIST_AREAS.map(([k,t])=>`<button class="${histApp.area===k?'':'secondary'}" style="padding:6px 10px" onclick="filtrarHistApp('${k}')">${t}</button>`).join('')}</div>
    <div style="margin-top:10px">${histItens(histApp,'maisHistApp()')}</div></details></section>`;
  h+=`<p class="muted" style="text-align:center;margin-top:14px">${usuario&&usuario.email?'Conectado como '+esc(usuario.email)+' • ':''}<a href="#" onclick="sair();return false">Sair</a></p>`;
  return h;
}

function atualizarInicio(){carregarLista();carregarAtletas();conferirPendentes();if(histApp.aberto)carregarHistApp(histApp,'historico_app',{p_area:histApp.area||null})}

/* ---------- Histórico do app (dono) e do financeiro ---------- */
const HIST_AREAS=[['','Tudo'],['ligas','Ligas'],['temporadas','Temporadas'],['atletas','Atletas'],['usuarios','Usuários'],['financeiro','Financeiro'],['visita','Visitas']];
const HIST_PAGINA=100;
let histApp={area:'',itens:[],carregando:false,erro:null,fim:false,aberto:false},histFin={itens:[],carregando:false,erro:null,fim:false,pedido:false};
async function carregarHistApp(h,fn,args,mais=false){
  if(h.carregando)return;h.carregando=true;h.erro=null;if(!mais){h.itens=[];h.fim=false}render();
  try{
    const antes=mais&&h.itens.length?h.itens[h.itens.length-1].em:null;
    const {data,error}=await sb.rpc(fn,{...args,p_antes:antes});if(error)throw error;
    const novos=data||[];h.itens=mais?h.itens.concat(novos):novos;h.fim=novos.length<HIST_PAGINA;
  }catch(e){h.erro=traduzErro(e)}
  finally{h.carregando=false;render()}
}
function abrirHistApp(aberto){if(aberto===histApp.aberto)return;histApp.aberto=aberto;if(aberto&&!histApp.itens.length)carregarHistApp(histApp,'historico_app',{p_area:histApp.area||null})}
function filtrarHistApp(a){histApp.area=a;carregarHistApp(histApp,'historico_app',{p_area:a||null})}
function maisHistApp(){carregarHistApp(histApp,'historico_app',{p_area:histApp.area||null},true)}
function maisHistFin(){carregarHistApp(histFin,'historico_financeiro',{},true)}
const HIST_ROTULO={ligas:'Liga',temporadas:'Temporada',atletas:'Atleta',usuarios:'Usuário',financeiro:'Financeiro',visita:'Visita'};
function histItens(h,maisFn){
  if(h.erro)return `<p class="warn">Não foi possível carregar: ${esc(h.erro)}</p>`;
  if(!h.itens.length)return `<p class="muted">${h.carregando?'Carregando…':'Nada registrado ainda.'}</p>`;
  return `<div class="hist-lista">${h.itens.map(x=>`<div class="hist-item"><div class="hist-quando">${fmtDataHora(x.em)} • <b>${esc(x.quem)}</b> <span class="hist-area">${HIST_ROTULO[x.area]||esc(x.area)}</span></div>
    <div>${x.area==='ligas'?`<b>${esc(x.alvo||'')}</b>: ${esc(x.acao)}`:`${esc(x.acao)}${x.alvo?`: <b>${esc(x.alvo)}</b>`:''}`}${x.vezes>1?` <span class="muted">(${x.vezes} vezes)</span>`:''}</div></div>`).join('')}</div>
    ${h.fim?'':`<div class="panel-actions"><button class="secondary" onclick="${maisFn}"${h.carregando?' disabled':''}>${h.carregando?'Carregando…':'Carregar mais'}</button></div>`}`;
}

/* ---------- Cadastro único de atletas ---------- */
const SITUACAO_LABEL={membro:'Membro',convidado:'Convidado',inativo:'Inativo'};
function normNome(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toLowerCase()}
function atletaPorId(id){return id?atletas.find(a=>a.id===id)||null:null}
function acharAtleta(nome,comApelido=false){const k=normNome(nome);return atletas.find(a=>normNome(a.nome)===k)||(comApelido?atletas.find(a=>a.apelido&&normNome(a.apelido)===k):null)||null}
function guardarAtletas(){atletas.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));lsSet('lr6:atletas',{em:new Date().toISOString(),lista:atletas})}
function atualizarAtletaLocal(a){
  const r={id:a.id,nome:a.nome,apelido:a.apelido,situacao:a.situacao,observacoes:a.observacoes,versao:a.versao,atualizado_em:a.atualizado_em};
  const k=atletas.findIndex(x=>x.id===a.id);if(k>=0)atletas[k]=r;else atletas.push(r);
  guardarAtletas();
}
function rerenderAtletas(){if(view==='atletas'||(view==='liga'&&tab==='Atletas'))render()}
async function carregarAtletas(){
  atletasInfo={...atletasInfo,carregando:true};
  try{
    const {data,error}=await sb.from('atletas').select('id,nome,apelido,situacao,observacoes,versao,atualizado_em').order('nome');
    if(error)throw error;
    atletas=data;guardarAtletas();atletasInfo={origem:'servidor'};
  }catch(e){
    const c=lsGet('lr6:atletas');atletas=(c&&c.lista)||atletas;atletasInfo={origem:'cache',erro:traduzErro(e),em:c&&c.em};
  }
  rerenderAtletas();
}
async function carregarParticipacoes(){
  try{
    const {data,error}=await sb.from('ligas').select('id,excluida_em,ids:dados->ids');
    if(error)throw error;
    const p={};
    for(const l of data){if(l.excluida_em||!Array.isArray(l.ids))continue;for(const id of new Set(l.ids.filter(Boolean)))p[id]=(p[id]||0)+1}
    participacoes=p;
  }catch{participacoes=null}
  if(view==='atletas')render();
}
function abrirAtletas(){view='atletas';render();carregarAtletas();carregarParticipacoes();carregarAtletasAdm()}
// tag ADM: atletas ligados a contas de administrador
let atletasAdm=new Set();
async function carregarAtletasAdm(){try{const {data,error}=await sb.rpc('atletas_admins');if(error)throw error;atletasAdm=new Set(data||[]);if(view==='atletas')rerenderAtletas()}catch{}}
function atletasFiltrados(){
  const b=normNome(atlFiltro.busca),s=atlFiltro.situacao;
  return atletas.filter(a=>(s==='todos'||(s==='ativos'?a.situacao!=='inativo':a.situacao===s))&&(!b||normNome(a.nome+' '+(a.apelido||'')).includes(b)));
}
function listaAtletasHtml(){
  if(!atletas.length)return atletasInfo.carregando?'<p class="muted">Carregando…</p>':'<p class="muted">Nenhum atleta cadastrado ainda. Toque em NOVO ATLETA, ou abra uma liga antiga e use "Vincular ao cadastro".</p>';
  const f=atletasFiltrados();
  if(!f.length)return '<p class="muted">Nenhum atleta encontrado.</p>';
  return '<div class="atl-list">'+f.map(a=>`<div class="atl-row">
   <div style="flex:1;min-width:0"><b>${esc(a.nome)}</b>${a.apelido?` <span class="muted">(${esc(a.apelido)})</span>`:''}
    <div class="muted"><span class="chip at-${a.situacao}">${SITUACAO_LABEL[a.situacao]||esc(a.situacao)}</span>${atletasAdm.has(a.id)?' <span class="chip ac-adm">ADM</span>':''}${participacoes?` ${participacoes[a.id]||0} liga(s)`:''}</div>
    ${a.observacoes?`<div class="muted" style="margin-top:4px">${esc(a.observacoes)}</div>`:''}</div>
   <div class="row" style="gap:6px;flex-wrap:nowrap">${a.situacao==='inativo'&&participacoes&&!participacoes[a.id]?`<button class="danger" onclick="apagarAtleta('${a.id}')">Apagar</button>`:''}<button class="secondary" onclick="abrirAtletaForm('${a.id}')">Editar</button></div></div>`).join('')+'</div>';
}
function renderAtletas(){
  const ativos=atletas.filter(a=>a.situacao!=='inativo').length;
  let h=`<section><button class="ghost" onclick="voltarInicio()">← Minhas Ligas</button>
   <h2 style="margin-top:12px">Atletas</h2>
   <p class="muted">${atletas.length} cadastrado(s) • ${ativos} ativo(s). Ninguém é apagado: quem deixa de jogar fica como inativo e o histórico continua.</p>
   <div class="panel-actions"><button onclick="abrirAtletaForm(null)">NOVO ATLETA</button></div></section>`;
  if(atletasInfo.origem==='cache')h+=`<section class="tie-card tie-pending"><b>Sem conexão com o servidor</b><p class="muted" style="margin-top:6px">${atletasInfo.em?'Mostrando o cadastro guardado neste aparelho em '+fmtDataHora(atletasInfo.em)+'.':'Nenhum cadastro guardado neste aparelho.'} (${esc(atletasInfo.erro)})</p><div class="panel-actions"><button class="secondary" onclick="carregarAtletas()">Tentar novamente</button></div></section>`;
  h+=`<section><div class="form-grid">
   <label>Buscar<input id="atlBusca" value="${esc(atlFiltro.busca)}" placeholder="Nome ou apelido" oninput="atlFiltro.busca=this.value;$('atlLista').innerHTML=listaAtletasHtml()"></label>
   <label>Mostrar<select onchange="atlFiltro.situacao=this.value;$('atlLista').innerHTML=listaAtletasHtml()">${[['ativos','Ativos (membros e convidados)'],['membro','Membros'],['convidado','Convidados'],['inativo','Inativos'],['todos','Todos']].map(([v,t])=>`<option value="${v}" ${atlFiltro.situacao===v?'selected':''}>${t}</option>`).join('')}</select></label>
   </div><div id="atlLista" style="margin-top:12px">${listaAtletasHtml()}</div></section>`;
  return h;
}
async function apagarAtleta(id){
  const a=atletaPorId(id);if(!a||ocupado)return;
  if(!confirm('Apagar DE VEZ o atleta "'+a.nome+'"?\n\nSó é possível para atletas inativos que não aparecem em nenhuma liga, nem na lixeira. Isso não tem volta.'))return;
  ocupado=true;
  try{
    const {error}=await sb.rpc('excluir_atleta',{p_id:id});if(error)throw error;
    atletas=atletas.filter(x=>x.id!==id);guardarAtletas();
  }catch(e){alert('Nada foi apagado: '+traduzErro(e))}
  finally{ocupado=false}
  render();
}
let atlDepoisDeSalvar=null;
function abrirAtletaForm(id,nomeInicial='',depois=null){
  const a=atletaPorId(id);
  atlDepoisDeSalvar=depois;
  $('modal').innerHTML=`<div class="modal-bg"><div class="modal-box"><h2>${a?'Editar atleta':'Novo atleta'}</h2>
   <form class="form-grid" style="margin-top:10px" onsubmit="salvarAtletaForm(event,${a?`'${a.id}'`:'null'})">
    <label>Nome<input id="afNome" maxlength="80" required value="${esc(a?a.nome:nomeInicial)}"></label>
    <label>Situação<select id="afSit">${Object.entries(SITUACAO_LABEL).map(([v,t])=>`<option value="${v}" ${(a?a.situacao:'membro')===v?'selected':''}>${t}</option>`).join('')}</select></label>
    <label>Observações (opcional)<textarea id="afObs" maxlength="500" rows="2" style="min-height:0">${esc(a&&a.observacoes||'')}</textarea></label>
    ${a?'<p class="muted">Mudar o nome aqui não altera os nomes já gravados nas ligas anteriores.</p>':''}
    <p class="muted" id="afMsg"></p>
    <div class="panel-actions"><button type="submit" id="afBtn">SALVAR</button><button type="button" class="secondary" onclick="fecharModal()">Cancelar</button></div>
   </form></div></div>`;
  setTimeout(()=>{const e=$('afNome');if(e)e.focus()},50);
}
async function salvarAtletaForm(ev,id){
  ev.preventDefault();
  const a=atletaPorId(id);
  const nome=$('afNome').value.replace(/\s+/g,' ').trim();
  if(!nome)return;
  const dup=atletas.find(x=>x.id!==id&&normNome(x.nome)===normNome(nome));
  if(dup&&!confirm('Já existe "'+dup.nome+'" no cadastro. Salvar mesmo assim?'))return;
  $('afBtn').disabled=true;$('afMsg').textContent='Salvando no servidor…';
  try{
    const {data,error}=await sb.rpc('salvar_atleta',{p_id:id,p_versao_esperada:a?a.versao:null,p_nome:nome,p_apelido:a&&a.apelido||null,p_situacao:$('afSit').value,p_observacoes:$('afObs').value.trim()||null});
    if(error)throw error;
    if(data.conflito){alert('Este atleta foi alterado em outro aparelho. O cadastro será recarregado; confira e edite de novo.');fecharModal();carregarAtletas();return}
    atualizarAtletaLocal(data);
    const depois=atlDepoisDeSalvar;atlDepoisDeSalvar=null;
    fecharModal();
    if(depois)depois(data);else rerenderAtletas();
  }catch(e){$('afMsg').textContent='Não foi salvo: '+traduzErro(e);$('afBtn').disabled=false}
}

/* ---------- Atletas da liga aberta ---------- */
function selecionados(){return S.names.map((n,i)=>({nome:n,id:S.ids[i]||null,i})).filter(x=>x.nome.trim())}
function definirSelecao(sel,eventos){
  const n=capacity();
  S.names=Array.from({length:n},(_,i)=>sel[i]?sel[i].nome:'');
  S.ids=Array.from({length:n},(_,i)=>sel[i]?sel[i].id||null:null);
  S.drawn=false;
  persist(eventos);
}
function incluirNaSelecao(sel,a){
  if(sel.some(x=>x.id===a.id))return 'ja';
  const k=sel.findIndex(x=>!x.id&&normNome(x.nome)===normNome(a.nome));
  if(k>=0){sel[k]={id:a.id,nome:a.nome};return 'vinculado'}
  if(sel.length>=capacity())return 'cheia';
  sel.push({id:a.id,nome:a.nome});return 'ok';
}
function toggleAtleta(id){
  if(S.status!=='draft')return;
  const a=atletaPorId(id);if(!a)return;
  const sel=selecionados();
  const k=sel.findIndex(x=>x.id===id);
  if(k>=0){sel.splice(k,1);definirSelecao(sel,[{tipo:'cadastro',descricao:a.nome+' retirado da liga'}])}
  else if(incluirNaSelecao(sel,a)==='cheia')alert('A liga já tem '+capacity()+' atletas. Retire alguém ou aumente a quantidade.');
  else definirSelecao(sel,[{tipo:'cadastro',descricao:a.nome+' incluído na liga'}]);
  renderMantendoLista();
}
function removerPosicao(i){
  if(S.status!=='draft')return;
  const nome=S.names[i];
  definirSelecao(selecionados().filter(x=>x.i!==i),[{tipo:'cadastro',descricao:nome+' retirado da liga'}]);
  renderMantendoLista();
}
// Redesenha sem a lista de atletas voltar para o topo nem a tela pular
function renderMantendoLista(){
  const el=document.querySelector('.sel-list'),st=el?el.scrollTop:0,topo=el?el.getBoundingClientRect().top:null;
  render();
  const n=document.querySelector('.sel-list');
  if(n){n.scrollTop=st;if(topo!==null)window.scrollBy(0,n.getBoundingClientRect().top-topo)}
}
function novoAtletaNaLiga(nome=''){
  abrirAtletaForm(null,String(nome||'').trim(),a=>{
    if(view==='liga'&&S&&S.status==='draft'){
      const sel=selecionados();
      if(incluirNaSelecao(sel,a)==='cheia')alert(a.nome+' foi cadastrado, mas a liga já está completa.');
      else definirSelecao(sel,[{tipo:'cadastro',descricao:a.nome+' cadastrado e incluído na liga'}]);
    }
    atlBuscaLiga='';render();
  });
}
function listaSelecaoHtml(){
  if(!atletas.length)return `<p class="muted">${atletasInfo.carregando?'Carregando cadastro…':'Cadastro vazio. Use "+ Novo atleta" ou "Colar lista".'}</p>`;
  const b=normNome(atlBuscaLiga),cheia=selecionados().length>=capacity(),ids=new Set(S.ids.filter(Boolean));
  const l=atletas.filter(a=>(a.situacao!=='inativo'||ids.has(a.id))&&(!b||normNome(a.nome+' '+(a.apelido||'')).includes(b)));
  if(!l.length)return `<p class="muted">Nenhum atleta encontrado.</p>${b?`<div class="panel-actions"><button class="secondary" onclick="novoAtletaNaLiga(atlBuscaLiga)">Cadastrar “${esc(atlBuscaLiga.trim())}”</button></div>`:''}`;
  return '<div class="sel-list">'+l.map(a=>{const on=ids.has(a.id);return `<label class="sel-item${on?' on':''}"><input type="checkbox" ${on?'checked':''} ${!on&&cheia?'disabled':''} onchange="toggleAtleta('${a.id}')"><span>${esc(a.nome)}${a.apelido?` <span class="muted">(${esc(a.apelido)})</span>`:''}${a.situacao==='convidado'?' <span class="chip at-convidado">convidado</span>':''}</span></label>`}).join('')+'</div>';
}
function renderAtletasLiga(){
  const draft=S.status==='draft',sel=selecionados(),n=capacity(),semVinculo=sel.filter(x=>!x.id).length;
  let h=`<section><h2>Atletas da liga</h2><p class="muted">${draft?'Marque quem vai jogar. Cada alteração é salva automaticamente.':'Lista bloqueada depois de iniciar a liga.'}</p>${configHtml()}
   <h3 style="margin-top:14px">Selecionados: <span class="${sel.length===n?'ok':'warn'}">${sel.length} / ${n}</span></h3>`;
  h+=sel.length?'<div class="sel-chips">'+sel.map(x=>`<span class="chip ${x.id?'at-sel':'at-sem'}">${esc(x.nome)}${x.id?'':' ⚠'}${draft?`<button class="chip-x" onclick="removerPosicao(${x.i})" aria-label="Retirar ${esc(x.nome)}">✕</button>`:''}</span>`).join('')+'</div>':'<p class="muted" style="margin-top:6px">Ninguém selecionado ainda.</p>';
  if(semVinculo)h+=`<p class="warn" style="margin-top:10px">⚠ ${semVinculo} nome(s) sem vínculo com o cadastro de atletas.</p>${L.status==='arquivada'?'<p class="muted">Desarquive a liga para vincular.</p>':'<div class="panel-actions"><button class="secondary" onclick="vincularCadastro()">Vincular ao cadastro</button></div>'}`;
  if(draft){
    h+=`<div class="form-grid" style="margin-top:14px"><label>Buscar atleta<input id="selBusca" value="${esc(atlBuscaLiga)}" placeholder="Nome ou apelido" oninput="atlBuscaLiga=this.value;$('selLista').innerHTML=listaSelecaoHtml()"></label></div>
     <div id="selLista" style="margin-top:10px">${listaSelecaoHtml()}</div>
     <div class="panel-actions"><button class="secondary" onclick="novoAtletaNaLiga()">+ Novo atleta</button><button class="secondary" onclick="abrirColarLista()">Colar lista</button><button class="secondary" onclick="clearNames()" ${sel.length?'':'disabled'}>Limpar seleção</button></div>`;
  }
  h+=`<div class="panel-actions"><button class="secondary" onclick="exportarLiga()">Exportar backup</button></div></section>`;
  return h;
}
function abrirColarLista(){
  $('modal').innerHTML=`<div class="modal-bg"><div class="modal-box"><h2>Colar lista</h2>
   <p class="muted">Um nome por linha. Números e marcadores no começo da linha são ignorados. Quem já está no cadastro é reconhecido mesmo sem acento; quem não está é cadastrado depois da sua confirmação.</p>
   <textarea id="clTexto" rows="12" style="margin-top:10px"></textarea><p class="muted" id="clMsg"></p>
   <div class="panel-actions"><button id="clBtn" onclick="aplicarColarLista()">INCLUIR NA LIGA</button><button class="secondary" onclick="fecharModal()">Cancelar</button></div></div></div>`;
  setTimeout(()=>{const e=$('clTexto');if(e)e.focus()},50);
}
function limparLinha(l){return l.replace(/^\s*(\d+\s*[-.)ºª°]?|[-*•])\s*/,'').replace(/\s+/g,' ').trim()}
async function aplicarColarLista(){
  if(S.status!=='draft')return;
  const linhas=[...new Map($('clTexto').value.split('\n').map(limparLinha).filter(Boolean).map(n=>[normNome(n),n])).values()];
  if(!linhas.length)return;
  const novos=linhas.filter(n=>!acharAtleta(n,true));
  if(novos.length&&!confirm(novos.length+' nome(s) não estão no cadastro e serão cadastrados como membros:\n\n'+novos.join('\n')+'\n\nContinuar?'))return;
  $('clBtn').disabled=true;$('clMsg').textContent='Salvando no servidor…';
  try{
    if(novos.length){
      const {data,error}=await sb.rpc('garantir_atletas',{p_nomes:novos});
      if(error)throw error;
      data.filter(Boolean).forEach(atualizarAtletaLocal);
    }
    const sel=selecionados(),fora=[];let n=0;
    for(const linha of linhas){const a=acharAtleta(linha,true);if(!a)continue;const r=incluirNaSelecao(sel,a);if(r==='cheia')fora.push(a.nome);else if(r!=='ja')n++}
    if(n)definirSelecao(sel,[{tipo:'cadastro',descricao:n+' atleta(s) incluídos por lista colada'}]);
    fecharModal();render();
    if(fora.length)alert('A liga ficou completa. Não entraram: '+fora.join(', '));
  }catch(e){$('clMsg').textContent='Nada foi alterado: '+traduzErro(e);$('clBtn').disabled=false}
}
async function vincularCadastro(){
  if(!S||L.status==='arquivada')return;
  const pos=S.names.map((n,i)=>({n,i})).filter(x=>x.n.trim()&&!S.ids[x.i]);
  if(!pos.length)return;
  if(!navigator.onLine)return alert('Sem conexão. É preciso internet para vincular ao cadastro.');
  const novos=[...new Map(pos.filter(x=>!acharAtleta(x.n)).map(x=>[normNome(x.n),x.n.trim()])).values()];
  if(!confirm('Ligar '+pos.length+' nome(s) desta liga ao cadastro de atletas.'+(novos.length?'\n\nSerão cadastrados como novos ('+novos.length+'):\n'+novos.join('\n'):'')+'\n\nOs nomes e os resultados da liga não mudam. Continuar?'))return;
  try{
    if(novos.length){
      const {data,error}=await sb.rpc('garantir_atletas',{p_nomes:novos});
      if(error)throw error;
      data.filter(Boolean).forEach(atualizarAtletaLocal);
    }
    let n=0;
    for(const x of pos){const a=acharAtleta(x.n);if(a&&!S.ids.includes(a.id)){S.ids[x.i]=a.id;n++}}
    if(!n)return alert('Nenhum nome pôde ser vinculado.');
    persist([{tipo:'cadastro',descricao:n+' nome(s) vinculados ao cadastro de atletas'}],S.status==='ended'?'Vínculo com o cadastro de atletas':null);
    render();
  }catch(e){alert('Não foi possível vincular: '+traduzErro(e))}
}

/* ---------- Temporadas ---------- */
const REGRAS_PADRAO={etapas:10,dobradas:[5],descartes:1,ausencia:'zero',especiais:[3,7],confronto_direto:true,
  pontos:{vitoria:1,bonus_6x0:1,derrota_0x6:-1,posicao:[12,10,7,5],quartas:[1,1],semi:[1,2],terceiro:[1,1],final:[3,3]}};
const T_STATUS={andamento:'Em andamento',encerrada:'Encerrada',arquivada:'Arquivada'};
const tTabs=['Ranking','Etapas','Ajustes','Regras'];
let temporadas=lsGet('lr6:temporadas')?.lista||[];
let T=null,TE=[],tTab='Ranking',tInfo={};
const pontosCache=new Map();

function numLista(v,max){return [...new Set((Array.isArray(v)?v:String(v||'').split(/[^0-9]+/)).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=max))].sort((a,b)=>a-b)}
function inteiro(v,pad){const n=Number(v);return Number.isFinite(n)?Math.round(n):pad}
function regrasCompletas(r){
  r=r&&typeof r==='object'?r:{};const p=r.pontos||{},P=REGRAS_PADRAO.pontos;
  const par=(x,d)=>Array.isArray(x)&&x.length===2?x.map((v,i)=>inteiro(v,d[i])):[...d];
  const etapas=Math.min(60,Math.max(1,inteiro(r.etapas,REGRAS_PADRAO.etapas)));
  return {etapas,
    dobradas:numLista(r.dobradas??REGRAS_PADRAO.dobradas,etapas),
    descartes:Math.max(0,Math.min(etapas-1,inteiro(r.descartes,REGRAS_PADRAO.descartes))),
    ausencia:r.ausencia==='minimo'?'minimo':'zero',
    especiais:numLista(r.especiais??REGRAS_PADRAO.especiais,etapas),
    confronto_direto:r.confronto_direto!==false,
    pontos:{vitoria:inteiro(p.vitoria,P.vitoria),bonus_6x0:inteiro(p.bonus_6x0,P.bonus_6x0),derrota_0x6:inteiro(p.derrota_0x6,P.derrota_0x6),
      posicao:Array.isArray(p.posicao)&&p.posicao.length===4?p.posicao.map((v,i)=>inteiro(v,P.posicao[i])):[...P.posicao],
      quartas:par(p.quartas,P.quartas),semi:par(p.semi,P.semi),terceiro:par(p.terceiro,P.terceiro),final:par(p.final,P.final)}};
}
// Menor pontuação possível jogando: último do grupo perdendo os 3 jogos por 0×6
function pontosMinimos(R){return R.pontos.posicao[3]+3*Math.min(0,R.pontos.derrota_0x6)}

/* Pontos de cada atleta numa etapa (calculados a partir dos placares) */
function pontosDaEtapa(liga,R){
  const chave=liga.id+':'+liga.versao+':'+JSON.stringify(R);
  if(pontosCache.has(chave))return pontosCache.get(chave);
  let d;try{d=validarDados(liga.dados)}catch{return null}
  const out={porId:new Map(),semVinculo:[],gruposCompletos:false,mataCompleto:false,iniciada:!!d.drawn};
  if(!d.drawn){pontosCache.set(chave,out);return out}
  const P=R.pontos,velho=CONFRONTO_DIRETO,velhoEsp=ESPECIAL;CONFRONTO_DIRETO=R.confronto_direto;
  ESPECIAL=ehEspecial(liga,R,d);
  // v = vitórias nos grupos; vt/sg/gp = vitórias, saldo e games pró em todos os jogos (desempate do ranking)
  const novo=()=>({grupo:0,v:0,b:0,dz:0,posicao:null,mata:0,mataTxt:[],vt:0,sg:0,gp:0,j:0});
  const somarJogo=(x,v,k)=>{x.j++;x.sg+=v[k]-v[1-k];x.gp+=v[k];if(v[k]>v[1-k])x.vt++};
  try{comDados(d,()=>{
    const pos=S.names.map(novo);
    for(const g of groupIndexes()){
      // pontua no grupo quem é do grupo (inclusive o lesionado, pelos jogos que fez) e o atleta de fora que entrou;
      // substituto vindo de outro grupo da liga não pontua
      const contam=[...group(g),...externosDoGrupo(g)];
      externosDoGrupo(g).forEach(i=>{if(!pos[i])pos[i]=novo()});
      for(const m of games(g)){const v=S.scores[m.id];if(!valid(v))continue;
        [m.a,m.b].forEach((lado,k)=>lado.forEach(i=>{if(!contam.includes(i))return;const x=pos[i];somarJogo(x,v,k);
          if(v[k]>v[1-k]){x.v++;x.grupo+=P.vitoria}
          if(v[k]===6&&v[1-k]===0){x.b++;x.grupo+=P.bonus_6x0}
          if(v[k]===0&&v[1-k]===6){x.dz++;x.grupo+=P.derrota_0x6}
        }))}
      const r=rank(g);
      if(groupDone(g)&&!pending('g'+g,r))r.forEach((x,k)=>{pos[x.i].posicao=k+1;pos[x.i].grupo+=P.posicao[k]});
    }
    out.gruposCompletos=complete()&&!groupPending();
    if(out.gruposCompletos){
      // mesma chave da tela (com substituições e, nas etapas especiais, as duplas sorteadas)
      const c=chaveAtual();
      if(c){
        const dar=(lado,pts,txt)=>lado.forEach(i=>{if(!pos[i])pos[i]=novo();pos[i].mata+=pts;pos[i].mataTxt.push(txt)});
        const jogo=(m,[part,vit],nome)=>{if(!m)return;dar(m.a,part,nome);dar(m.b,part,nome);const v=S.finals[m.id];if(!valid(v))return;
          [m.a,m.b].forEach((lado,k)=>lado.forEach(i=>somarJogo(pos[i],v,k)));dar(v[0]>v[1]?m.a:m.b,vit,'vitória '+nome)};
        c.qs.forEach(m=>jogo(m,P.quartas,'quartas'));
        c.ss.forEach(m=>jogo(m,P.semi,'semifinal'));
        jogo(c.f,P.final,'final');jogo(c.t,P.terceiro,'3º lugar');
        out.mataCompleto=!!(c.f&&c.t&&valid(S.finals.f)&&valid(S.finals.t));
      }
    }
    pos.forEach((x,i)=>{
      if(!x)return;
      const id=idDe(i),n=nomeCompleto(i);x.total=x.grupo+x.mata;
      if(id){const y=out.porId.get(id);if(y){for(const k of ['grupo','v','b','dz','mata','total','vt','sg','gp','j'])y[k]+=x[k];y.mataTxt.push(...x.mataTxt);y.posicao=y.posicao??x.posicao}else out.porId.set(id,x)}
      else if(n.trim())out.semVinculo.push(n);
    });
  })}finally{CONFRONTO_DIRETO=velho;ESPECIAL=velhoEsp}
  pontosCache.set(chave,out);return out;
}
const ligaEncerrada=l=>l.status==='finalizada'||l.status==='arquivada';

const CRITERIOS_RANKING=['total','v','sg','gp','melhorEtapa','maxVit'];
function compararRanking(a,b){for(const k of CRITERIOS_RANKING){const d=(b[k]||0)-(a[k]||0);if(d)return d}return 0}
function calcularRanking(){
  const R=regrasCompletas(T.regras),min=pontosMinimos(R);
  const porNum=new Map(TE.filter(l=>!l.excluida_em).map(l=>[l.etapa_numero,l]));
  const pts=new Map([...porNum].map(([n,l])=>[n,pontosDaEtapa(l,R)]));
  const ids=new Set();
  for(const l of porNum.values()){
    (Array.isArray(l.dados&&l.dados.ids)?l.dados.ids:[]).forEach(id=>id&&ids.add(id));
    // atleta de fora da liga que entrou no mata-mata por substituição
    [...(Array.isArray(l.dados&&l.dados.subs)?l.dados.subs:[]),...(Array.isArray(l.dados&&l.dados.gsubs)?l.dados.gsubs:[])].forEach(s=>s&&s.atleta&&typeof s.atleta.id==='string'&&s.atleta.id&&ids.add(s.atleta.id));
  }
  const ajustes=(T.dados&&Array.isArray(T.dados.ajustes)?T.dados.ajustes:[]);
  ajustes.forEach(a=>a.atleta_id&&ids.add(a.atleta_id));
  const encerradas=[...porNum.values()].filter(ligaEncerrada).length;
  const linhas=[...ids].map(id=>{
    const cel=[];
    for(let n=1;n<=R.etapas;n++){
      const l=porNum.get(n),mult=R.dobradas.includes(n)?2:1;
      if(!l){cel.push({tipo:'futura'});continue}
      const p=pts.get(n),x=p&&p.porId.get(id);
      if(x){cel.push({tipo:ligaEncerrada(l)?'jogou':'andamento',valor:x.total*mult,det:x,mult});continue}
      if(ligaEncerrada(l)){cel.push({tipo:'ausente',valor:(R.ausencia==='minimo'?min:0)*mult,mult});continue}
      cel.push({tipo:'futura'});
    }
    const cand=cel.filter(c=>c.tipo==='jogou'||c.tipo==='ausente');
    if(R.descartes&&cand.length>R.descartes)[...cand].sort((a,b)=>a.valor-b.valor).slice(0,R.descartes).forEach(c=>c.descarte=true);
    const aj=ajustes.filter(a=>a.atleta_id===id).reduce((s,a)=>s+inteiro(a.pontos,0),0);
    const total=cel.reduce((s,c)=>s+(c.valor!=null&&!c.descarte?c.valor:0),0)+aj;
    const at=atletaPorId(id);
    // desempate: vitórias, saldo e games pró da temporada inteira; depois maior pontuação numa etapa e mais vitórias numa etapa
    const jog=cel.filter(c=>c.det),soma=k=>jog.reduce((s,c)=>s+(c.det[k]||0),0);
    return {id,nome:at?at.nome:'(atleta removido)',situacao:at&&at.situacao,cel,aj,total,etapas:jog.length,
      v:soma('vt'),sg:soma('sg'),gp:soma('gp'),melhorEtapa:jog.length?Math.max(...jog.map(c=>c.valor)):0,maxVit:jog.length?Math.max(...jog.map(c=>c.det.vt||0)):0};
  });
  linhas.sort((a,b)=>compararRanking(a,b)||a.nome.localeCompare(b.nome,'pt-BR'));
  linhas.forEach((x,i)=>x.pos=i&&compararRanking(linhas[i-1],x)===0?linhas[i-1].pos:i+1);
  const semVinculo=[...pts].filter(([,p])=>p&&p.semVinculo.length).map(([n,p])=>({n,qtd:p.semVinculo.length}));
  return {R,linhas,semVinculo,encerradas,porNum,pts};
}

/* Carregar */
async function carregarTemporadas(){
  try{
    const {data,error}=await sb.from('temporadas').select('id,nome,inicio,status,versao,regras,publica,atualizado_em').order('inicio',{ascending:false,nullsFirst:false}).order('criado_em',{ascending:false});
    if(error)throw error;
    temporadas=data;lsSet('lr6:temporadas',{em:new Date().toISOString(),lista:data});
  }catch(e){if(!/temporadas.*(does not exist|schema cache)|PGRST205/.test(String(e&&e.message)))console.warn(e)}
  if(view==='inicio')render();
}
async function abrirTemporada(id){
  view='temporada';T=temporadas.find(t=>t.id===id)||T;tInfo={carregando:true};
  const salva=lsGet('lr6:taba:'+id);tTab=tTabs.includes(salva)?salva:'Ranking';
  render();
  try{
    const [t,e]=await Promise.all([
      sb.from('temporadas').select('*').eq('id',id).single(),
      sb.from('ligas').select('id,nome,data,status,etapa,etapa_numero,participantes,versao,excluida_em,atualizado_em,dados').eq('temporada_id',id)
    ]);
    if(t.error)throw t.error;if(e.error)throw e.error;
    T=t.data;TE=e.data;tInfo={origem:'servidor'};
    lsSet('lr6:temporada:'+id,{em:new Date().toISOString(),T,TE});
  }catch(err){
    const c=lsGet('lr6:temporada:'+id);
    if(c){T=c.T;TE=c.TE;tInfo={origem:'cache',erro:traduzErro(err),em:c.em}}
    else{alert('Não foi possível abrir a temporada: '+traduzErro(err));view='inicio';render();return}
  }
  if(!atletas.length||atletasInfo.origem!=='servidor')carregarAtletas();
  if(view==='temporada')render();
}
async function salvarTemporada(campos,motivo){
  if(!navigator.onLine){alert('Sem conexão. Alterações da temporada precisam de internet.');return false}
  try{
    const {data,error}=await sb.rpc('salvar_temporada',{p_id:T.id,p_versao_esperada:T.versao,...campos,p_motivo:motivo});
    if(error)throw error;
    if(data.conflito){alert('A temporada foi alterada em outro aparelho. Ela será recarregada; confira e faça de novo.');await abrirTemporada(T.id);return false}
    delete data.ok;T=data;
    const k=temporadas.findIndex(x=>x.id===T.id);if(k>=0)temporadas[k]={...temporadas[k],...T};
    lsSet('lr6:temporada:'+T.id,{em:new Date().toISOString(),T,TE});
    return true;
  }catch(e){alert('Não foi salvo: '+traduzErro(e));return false}
}

/* Início: cartões das temporadas */
function temporadaCard(t){
  const R=regrasCompletas(t.regras),n=lista.filter(l=>l.temporada_id===t.id).length;
  return `<div class="liga-card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>${esc(t.nome)}</h3><p class="muted">${t.inicio?'Início '+fmtData(t.inicio)+' • ':''}${n} de ${R.etapas} etapas criadas</p></div><span class="chip st-${t.status==='andamento'?'andamento':t.status==='encerrada'?'finalizada':'arquivada'}">${T_STATUS[t.status]||esc(t.status)}</span></div>
   <div class="panel-actions"><button onclick="abrirTemporada('${t.id}')">ABRIR</button></div></div>`;
}

/* Formulário de regras (nova temporada e aba Regras) */
function regrasFormHtml(R,bloqueado){
  const P=R.pontos,dis=bloqueado?'disabled':'';
  const num=(id,v,min=-99,max=99)=>`<input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${v}" ${dis} style="max-width:90px">`;
  return `<div class="form-grid">
   <label>Quantidade de etapas${num('rgEtapas',R.etapas,1,60)}</label>
   <label>Etapas que valem o dobro (ex.: 5 ou 5, 10)<input id="rgDobradas" value="${R.dobradas.join(', ')}" ${dis}></label>
   <label>Descartes (piores etapas que não contam; 0 = sem descarte)${num('rgDescartes',R.descartes,0,59)}</label>
   <label>Ausência vale<select id="rgAusencia" ${dis}><option value="zero" ${R.ausencia==='zero'?'selected':''}>0 ponto</option><option value="minimo" ${R.ausencia==='minimo'?'selected':''}>A menor pontuação possível jogando (${pontosMinimos(R)} pontos)</option></select></label>
   <label>Etapas especiais (duplas sorteadas a partir da semifinal)<input id="rgEspeciais" value="${R.especiais.join(', ')}" ${dis}></label>
   <label style="flex-direction:row;align-items:center;gap:10px"><input id="rgConfronto" type="checkbox" ${R.confronto_direto?'checked':''} ${dis} style="width:20px;height:20px"> Usar confronto direto como 4º critério de desempate</label>
   </div>
   <details style="margin-top:12px"><summary><b>Tabela de pontos</b></summary>
   <table style="margin-top:8px"><tr><th>Item</th><th>Pontos</th></tr>
    <tr><td>Vitória no jogo de grupo</td><td>${num('rgVit',P.vitoria)}</td></tr>
    <tr><td>Bônus por vitória 6×0</td><td>${num('rgBonus',P.bonus_6x0)}</td></tr>
    <tr><td>Derrota por 0×6</td><td>${num('rgDz',P.derrota_0x6)}</td></tr>
    ${[0,1,2,3].map(i=>`<tr><td>${i+1}º no grupo</td><td>${num('rgPos'+i,P.posicao[i])}</td></tr>`).join('')}
    ${[['quartas','Quartas'],['semi','Semifinal'],['terceiro','Disputa de 3º'],['final','Final']].map(([k,t])=>`<tr><td>${t}: participação / ${k==='final'?'campeão':'vitória'}</td><td><span class="row" style="gap:6px;flex-wrap:nowrap">${num('rg'+k+'0',P[k][0])}${num('rg'+k+'1',P[k][1])}</span></td></tr>`).join('')}
   </table><p class="muted" style="margin-top:6px">Vitória, bônus 6×0 e derrota 0×6 valem nos jogos de grupo. No mata-mata contam participação e vitória.</p></details>`;
}
function lerRegrasForm(){
  const v=id=>$(id).value;
  return regrasCompletas({etapas:v('rgEtapas'),dobradas:v('rgDobradas'),descartes:v('rgDescartes'),ausencia:v('rgAusencia'),especiais:v('rgEspeciais'),confronto_direto:$('rgConfronto').checked,
    pontos:{vitoria:v('rgVit'),bonus_6x0:v('rgBonus'),derrota_0x6:v('rgDz'),posicao:[0,1,2,3].map(i=>v('rgPos'+i)),
      quartas:[v('rgquartas0'),v('rgquartas1')],semi:[v('rgsemi0'),v('rgsemi1')],terceiro:[v('rgterceiro0'),v('rgterceiro1')],final:[v('rgfinal0'),v('rgfinal1')]}});
}

/* Nova temporada */
function renderNovaTemporada(){
  const base=temporadas[0]?regrasCompletas(temporadas[0].regras):regrasCompletas(REGRAS_PADRAO);
  return `<section><button class="ghost" onclick="view='inicio';render()">← Início</button><h2 style="margin-top:12px">Nova temporada</h2>
   <p class="muted">${temporadas[0]?'As regras vêm preenchidas com as da temporada "'+esc(temporadas[0].nome)+'". Ajuste o que quiser.':'As regras vêm preenchidas com o regulamento da 3ª temporada. Ajuste o que quiser.'}</p>
   <div class="form-grid" style="margin-top:12px"><label>Nome<input id="ntNome" maxlength="120" placeholder="Ex.: 4ª Temporada 2027"></label><label>Início<input id="ntInicio" type="date" value="${hoje()}"></label></div>
   <h3 style="margin-top:16px">Regras</h3>${regrasFormHtml(base,false)}
   <div class="panel-actions"><button id="ntBtn" onclick="criarTemporada()">CRIAR TEMPORADA</button><button class="secondary" onclick="view='inicio';render()">Cancelar</button></div></section>`;
}
async function criarTemporada(){
  if(ocupado)return;
  const nome=$('ntNome').value.trim();if(!nome)return alert('Informe o nome da temporada.');
  if(!navigator.onLine)return alert('Sem conexão. É preciso internet para criar uma temporada.');
  const regras=lerRegrasForm(),id=novoId();
  ocupado=true;$('ntBtn').disabled=true;
  try{
    const {data,error}=await sb.rpc('criar_temporada',{p_id:id,p_nome:nome,p_inicio:$('ntInicio').value||null,p_regras:regras,p_dados:{ajustes:[]}});
    if(error)throw error;
    delete data.ok;temporadas.unshift(data);lsSet('lr6:taba:'+id,'Etapas');
    await abrirTemporada(id);
  }catch(e){alert('A temporada não foi criada: '+traduzErro(e));if($('ntBtn'))$('ntBtn').disabled=false}
  finally{ocupado=false}
}

/* Tela da temporada */
function renderTemporadaCabecalho(){
  const R=regrasCompletas(T.regras),criadas=TE.filter(l=>!l.excluida_em).length,enc=TE.filter(l=>!l.excluida_em&&ligaEncerrada(l)).length;
  let acoes='';
  if(T.status==='andamento')acoes=`<button class="secondary" onclick="mudarStatusTemporada('encerrada')">Encerrar temporada</button>`;
  else if(T.status==='encerrada')acoes=`<button class="secondary" onclick="mudarStatusTemporada('andamento')">Reabrir</button><button class="secondary" onclick="mudarStatusTemporada('arquivada')">Arquivar</button>`;
  else acoes=`<button class="secondary" onclick="mudarStatusTemporada('encerrada')">Desarquivar</button><button class="danger" onclick="apagarTemporada()">🗑 Apagar de vez</button>`;
  return `<section class="header-card"><button class="ghost" onclick="sairDaTemporada()">← Início</button>
   <h2 style="margin:12px 0 2px">${esc(T.nome)}</h2>
   <p class="muted">${T.inicio?'Início '+fmtData(T.inicio)+' • ':''}${enc} etapa(s) encerrada(s) • ${criadas} de ${R.etapas} criadas • <span class="chip st-${T.status==='andamento'?'andamento':T.status==='encerrada'?'finalizada':'arquivada'}">${T_STATUS[T.status]||esc(T.status)}</span></p>
   ${tInfo.origem==='cache'?`<p class="warn" style="margin-top:6px">Sem conexão: mostrando a cópia guardada em ${fmtDataHora(tInfo.em)}.</p>`:''}
   <div class="panel-actions">${acoes}</div>
   <div class="panel-actions"><button class="secondary" onclick="copiarLinkPublico()">🔗 Copiar link da página de consulta</button></div></section>`;
}
/* ---------- Página pública (só consulta) ---------- */
// um endereço só: o login decide se abre a administração (administrador) ou a consulta (atleta aprovado)
const linkPublico=()=>new URL(LR_RAIZ,location.href).href;
async function copiarLinkPublico(){
  const u=linkPublico();
  try{await navigator.clipboard.writeText(u);alert('Link copiado:\n'+u)}catch{prompt('Copie o link da página pública:',u)}
}
// Apaga de vez uma temporada arquivada (com todas as etapas). Baixa um backup antes; sem backup, nada é apagado.
async function apagarTemporada(){
  if(!T||T.status!=='arquivada'||ocupado)return;
  const nE=TE.length;
  const r=prompt('Apagar DE VEZ a temporada "'+T.nome+'"'+(nE?' e as '+nE+' etapa(s) dela':'')+'?\n\nIsso não tem volta: temporada, etapas, resultados e histórico somem do servidor. Um arquivo de backup será baixado antes.\nPara confirmar, digite APAGAR:');
  if(r===null)return;
  if(r.trim().toUpperCase()!=='APAGAR')return alert('Nada foi apagado (a palavra digitada não foi APAGAR).');
  ocupado=true;
  try{
    const {data:t,error:e1}=await sb.from('temporadas').select('*').eq('id',T.id).single();if(e1)throw e1;
    const {data:ls,error:e2}=await sb.from('ligas').select('*').eq('temporada_id',T.id);if(e2)throw e2;
    baixarJSON(`backup-temporada-antes-de-apagar-${hoje()}-${Date.now()}.json`,{app:'liga-resenha-v6',tipo:'temporada',observacao:'Temporada apagada definitivamente',exportado_em:new Date().toISOString(),temporada:t,ligas:(ls||[]).map(x=>({liga:metaDe(x),dados:x.dados}))});
    const {data,error}=await sb.rpc('excluir_temporada',{p_id:T.id});if(error)throw error;
    try{for(const x of ls||[]){localStorage.removeItem(cacheKey(x.id));localStorage.removeItem('lr6:aba:'+x.id)}localStorage.removeItem('lr6:temporada:'+T.id);localStorage.removeItem('lr6:taba:'+T.id)}catch{}
    temporadas=temporadas.filter(x=>x.id!==T.id);
    alert('Temporada "'+data.nome+'" apagada de vez'+(data.etapas?' ('+data.etapas+' etapa(s))':'')+'.');
    ocupado=false;sairDaTemporada();
  }catch(e){alert('Nada foi apagado: '+traduzErro(e))}
  finally{ocupado=false}
}
// telas da consulta: só leitura, para atletas e para o administrador
const emConsulta=()=>view.startsWith('publica');
// PUB: tudo que a consulta recebe do servidor; pSec: seção do topo; pOrigem: para onde o "voltar" leva
let PUB={temporadas:[],etapas:[],atletas:[],relampagos:[]},pSec='inicio',pTab='Ranking',pInfo={},pOrigem=null;
// PROX: próxima liga/etapa; PSIT: situação do atleta da conta nela (minha_situacao); pAtleta: painel aberto
let PROX=null,PSIT=null,pAtleta=null;
const P_SECOES=[['inicio','Painel'],['rodada','Rodada atual'],['temporadas','Temporadas'],['relampagos','Relâmpagos']];
async function abrirConsulta(){
  view='carregando';render();
  try{
    const {data,error}=await sb.rpc('consulta_publica');if(error)throw error;
    pInfo={em:new Date().toISOString()};
    PUB={temporadas:data&&data.temporadas||[],etapas:data&&data.etapas||[],atletas:data&&data.atletas||[],relampagos:data&&data.relampagos||[]};
    atletas=PUB.atletas;pontosCache.clear();T=null;TE=[];L=null;S=null;pOrigem=null;
    PROX=proximaLigaPublica();
    try{const r=await sb.rpc('minha_situacao',{p_liga_id:PROX&&PROX.l?PROX.l.id:null});PSIT=r.error?null:r.data}catch{PSIT=null}
    // o servidor manda só os atletas das etapas: completa com os das relâmpago e com o atleta da conta
    const conhecidos=new Set(PUB.atletas.map(a=>a.id));
    const incluir=(id,nome)=>{if(id&&nome&&!conhecidos.has(id)){conhecidos.add(id);PUB.atletas.push({id,nome:String(nome).trim()})}};
    for(const l of PUB.relampagos){const d=l.dados||{};(d.ids||[]).forEach((id,i)=>incluir(id,(d.names||[])[i]))}
    if(PSIT&&PSIT.atleta_id)incluir(PSIT.atleta_id,meuAcesso&&meuAcesso.nome);
    if(!pAtleta&&PSIT&&PSIT.atleta_id)pAtleta=PSIT.atleta_id;
    view='publica';if(pSec==='rodada')pSec='inicio';
  }catch(e){
    if(/acesso_negado|permission denied/.test(String(e&&e.message)))return verificarAcesso();
    pInfo={erro:traduzErro(e)};view='publica-vazia';
  }
  render();
}
function usarTemporada(id){T=PUB.temporadas.find(x=>x.id===id)||null;TE=T?PUB.etapas.filter(e=>e.temporada_id===id):[];return T}
// rodada atual: a liga aberta mais recente (em andamento antes de inscrições); sem nenhuma aberta, a última jogada
function rodadaAtual(){
  const todas=[...PUB.etapas.filter(e=>{const t=PUB.temporadas.find(x=>x.id===e.temporada_id);return t&&t.status==='andamento'}),...PUB.relampagos];
  const abertas=todas.filter(l=>!ligaEncerrada(l)).sort((a,b)=>(b.status==='andamento')-(a.status==='andamento')||String(b.data).localeCompare(String(a.data)));
  if(abertas.length)return {l:abertas[0],aberta:true};
  const ult=todas.sort((a,b)=>String(b.data).localeCompare(String(a.data)))[0];
  return ult?{l:ult,aberta:false}:null;
}
function irSecaoPublica(sec){
  if(sec==='rodada'){const r=rodadaAtual();pSec='rodada';if(r){pOrigem=null;return abrirEtapaPublica(r.l.id,true)}}
  pSec=sec;view='publica';T=null;TE=[];L=null;S=null;render();window.scrollTo(0,0);
}
function cabecalhoPublico(sub=''){
  return `<section class="header-card"><div class="row" style="justify-content:space-between;align-items:center"><div style="min-width:0"><p class="muted">Liga Resenha • consulta</p><p style="margin-top:2px">Bem-vindo, <b>${esc((meuAcesso&&meuAcesso.nome)||(meuAcesso&&meuAcesso.admin?'administrador':'atleta'))}</b></p>${meuAcesso&&meuAcesso.admin?'<button class="ghost pub" style="padding:6px 10px;margin-top:6px" onclick="abrirAdministracao()">← Administração</button>':''}</div><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="ghost pub" style="padding:6px 10px" onclick="abrirConsulta()" title="Atualizar">↻</button><button class="ghost pub" style="padding:6px 10px" onclick="sairConsulta()">Sair</button></div></div>${botaoInstalar('margin-top:8px')}
   <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${P_SECOES.map(([k,t])=>`<button class="${k===pSec?'':'secondary'} pub" onclick="irSecaoPublica('${k}')">${t}</button>`).join('')}</div>${linhaProxima()}${sub}</section>`;
}
function subCabecalho(volta,titulo,linha){
  return `<div style="margin-top:14px;border-top:1px solid #334155;padding-top:12px">${volta?`<button class="ghost pub" onclick="voltarConsulta()">← ${volta}</button>`:''}<h2 style="margin:10px 0 2px">${titulo}</h2>${linha?`<p class="muted">${linha}</p>`:''}</div>`;
}
function statusEtapaPublica(l){return ligaEncerrada(l)?'Encerrada':l.status==='preparacao'?'Inscrições':'Em andamento'}
function cartaoLigaPublica(l,rotulo){
  return `<div class="match-card" style="margin-top:10px"><div class="match-label">${rotulo}</div>
    <p style="margin-top:6px"><b>${esc(l.nome)}</b> • ${fmtData(l.data)} • ${statusEtapaPublica(l)}${l.participantes?' • '+l.participantes+' atletas':''}</p>
    <div class="panel-actions"><button class="secondary pub" onclick="abrirEtapaPublica('${l.id}')">${l.dados&&l.dados.drawn?'Ver grupos e jogos':'Ver inscritos'}</button></div></div>`;
}
// próxima liga: a aberta (inscrições ou em andamento) de data mais próxima; sem nenhuma, a próxima etapa prevista
function proximaLigaPublica(){
  const tAnd=PUB.temporadas.filter(t=>t.status==='andamento');
  const abertas=[...PUB.etapas.filter(e=>tAnd.some(t=>t.id===e.temporada_id)),...PUB.relampagos].filter(l=>!ligaEncerrada(l)).sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  if(abertas.length)return {l:abertas.find(l=>String(l.data)>=hoje())||abertas[abertas.length-1]};
  let melhor=null;
  for(const t of tAnd){
    const R=regrasCompletas(t.regras),usados=new Set(PUB.etapas.filter(e=>e.temporada_id===t.id).map(e=>e.etapa_numero)),datas=(t.dados&&t.dados.datas)||{};
    for(let n=1;n<=R.etapas;n++)if(!usados.has(n)){const d=datas[n]||null;if(!melhor||(d&&(!melhor.data||d<melhor.data)))melhor={t,n,data:d};break}
  }
  return melhor;
}
function linhaProxima(){
  const p=PROX;if(!p)return '';
  const it=[];
  if(p.l){
    it.push(['',fmtData(p.l.data)]);
    if(PSIT&&PSIT.atleta_id){
      it.push(PSIT.inscrito?['ok','Inscrito']:['muted','Não inscrito']);
      if(PSIT.inscrito&&PSIT.cobranca)it.push(PSIT.pagamento==='pago'?['ok','Pago']:PSIT.pagamento==='isento'?['ok','Isento']:['warn','Pagamento pendente']);
    }
  }else it.push(['',p.data?fmtData(p.data)+' (prevista)':'data a definir'],['muted','inscrições ainda não abertas']);
  return `<p class="prox-etapa">Próxima etapa: ${it.map(([c,t])=>`<b class="${c}">${t}</b>`).join(' - ')}</p>`;
}
/* ---------- Painel do atleta (consulta) ---------- */
const RES_LABEL={campeao:'🏆 Campeão',vice:'🥈 Vice',terceiro:'🥉 3º lugar',quarto:'4º lugar',semi:'Semifinal',quartas:'Quartas'};
function resultadoMata(txt){
  return txt.includes('vitória final')?'campeao':txt.includes('final')?'vice':txt.includes('vitória 3º lugar')?'terceiro':txt.includes('3º lugar')?'quarto':txt.includes('semifinal')?'semi':txt.includes('quartas')?'quartas':null;
}
// números do atleta em todas as ligas da consulta (só onde o nome está ligado ao cadastro)
function estatisticasAtleta(id){
  const st={part:[],temporadas:[],jogos:0,v:0,sg:0,gp:0,titulos:0,vices:0,terceiros:0};
  const R0=regrasCompletas({});
  for(const l of [...PUB.etapas,...PUB.relampagos]){
    if(!((l.dados&&l.dados.ids)||[]).includes(id))continue;
    const t=l.temporada_id?PUB.temporadas.find(x=>x.id===l.temporada_id)||null:null;
    const pe=pontosDaEtapa(l,t?regrasCompletas(t.regras):R0),x=pe&&pe.porId.get(id)||null,res=x?resultadoMata(x.mataTxt):null;
    if(x){st.jogos+=x.j;st.v+=x.vt;st.sg+=x.sg;st.gp+=x.gp}
    if(res==='campeao')st.titulos++;else if(res==='vice')st.vices++;else if(res==='terceiro')st.terceiros++;
    st.part.push({l,t,x,res});
  }
  const salvo=[T,TE];
  for(const t of PUB.temporadas){
    const n=st.part.filter(p=>p.t&&p.t.id===t.id).length;if(!n)continue;
    usarTemporada(t.id);const {linhas}=calcularRanking(),r=linhas.find(x=>x.id===id);
    st.temporadas.push({t,etapas:n,pos:r?r.pos:null,total:r?r.total:0,de:linhas.length});
  }
  [T,TE]=salvo;
  return st;
}
function iniciais(n){return String(n||'').trim().split(/\s+/).filter(Boolean).map((p,i,a)=>i===0||i===a.length-1?p[0]:'').join('').toUpperCase().slice(0,2)}
function mesAno(d){const m=/^(\d{4})-(\d{2})/.exec(d||'');return m?['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+m[2]-1]+'/'+m[1]:''}
function escolherPainel(v){pAtleta=v||null;render();window.scrollTo(0,0)}
function renderInicioPublico(){
  const ops=PUB.atletas.filter(a=>a.situacao!=='inativo'||a.id===pAtleta).slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  const eu=PSIT&&PSIT.atleta_id;
  const sel=`<label class="painel-escolha">Ver o painel de<select class="pub" onchange="escolherPainel(this.value)"><option value="">— escolher atleta —</option>${eu&&ops.some(a=>a.id===eu)?`<option value="${eu}"${eu===pAtleta?' selected':''}>Meu painel</option>`:''}${ops.filter(a=>a.id!==eu).map(a=>`<option value="${a.id}"${a.id===pAtleta?' selected':''}>${esc(a.nome)}</option>`).join('')}</select></label>`;
  const a=pAtleta&&PUB.atletas.find(x=>x.id===pAtleta);
  if(!a)return `<section><h2>Painel do atleta</h2><p class="muted" style="margin-top:6px">${PSIT&&!PSIT.atleta_id&&!(meuAcesso&&meuAcesso.admin)?'Sua conta ainda não está ligada a um atleta do cadastro. Fale com o administrador.':'Escolha um atleta para ver o histórico e as estatísticas dele na liga.'}</p>${sel}</section>`;
  const s=estatisticasAtleta(a.id),et=s.part.filter(p=>p.t).length,rel=s.part.length-et,aprov=s.jogos?Math.round(100*s.v/s.jogos):null;
  const desde=s.part.map(p=>p.l.data).filter(Boolean).sort()[0];
  const kpi=(t,v,sub='')=>`<div class="painel-kpi"><b>${v}</b><span>${t}</span>${sub?`<small>${sub}</small>`:''}</div>`;
  let h=`<section><div class="painel-id"><div class="painel-avatar" aria-hidden="true">${esc(iniciais(a.nome))}</div><div style="min-width:0"><h2>${esc(a.nome)}</h2><p class="muted">${[[SITUACAO_LABEL[a.situacao],desde?'na liga desde '+mesAno(desde):''].filter(Boolean).join(' ').replace(/^./,c=>c.toUpperCase()),a.id===eu?'você':''].filter(Boolean).join(' • ')}</p></div></div>${sel}</section>`;
  if(!s.part.length)return h+'<section><p class="muted">Ainda sem participações registradas nas ligas da consulta.</p></section>';
  h+=`<section><div class="painel-kpis">${kpi('Temporadas',s.temporadas.length)}${kpi('Etapas',et)}${kpi('Relâmpagos',rel)}${kpi('Jogos',s.jogos)}${kpi('Vitórias',s.v,s.jogos?(s.jogos-s.v)+' derrota(s)':'')}${kpi('Aproveitamento',aprov==null?'–':aprov+'%')}${kpi('Saldo de games',(s.sg>0?'+':'')+s.sg,s.gp+' games pró')}${kpi('Títulos',s.titulos,s.vices||s.terceiros?s.vices+' vice • '+s.terceiros+' 3º':'')}</div></section>`;
  if(s.temporadas.length)h+=`<section><h3>Nas temporadas</h3>${s.temporadas.map(x=>`<a href="#" class="painel-linha" onclick="abrirTemporadaPublica('${x.t.id}');return false"><div style="min-width:0"><b>${esc(x.t.nome)}</b><p class="muted">${x.etapas} etapa(s) jogada(s) • ${T_STATUS[x.t.status]||esc(x.t.status)}</p></div><div class="painel-pos">${x.pos?x.pos+'º':'–'}<small>${x.total} pts${x.de?' • de '+x.de:''}</small></div></a>`).join('')}</section>`;
  const ult=s.part.slice().sort((p,q)=>String(q.l.data).localeCompare(String(p.l.data)));
  h+=`<section><h3>Participações (${ult.length})</h3>${ult.map(p=>{const x=p.x;return `<a href="#" class="painel-linha" onclick="abrirEtapaPublica('${p.l.id}');return false"><div style="min-width:0"><b>${p.t?'Etapa '+p.l.etapa_numero+' • '+esc(p.t.nome):esc(p.l.nome)}</b><p class="muted">${fmtData(p.l.data)} • ${x&&x.j?x.vt+'V '+(x.j-x.vt)+'D'+(x.posicao?' • '+x.posicao+'º no grupo':''):statusEtapaPublica(p.l)}</p></div><div class="painel-res">${RES_LABEL[p.res]||''}</div></a>`}).join('')}</section>`;
  return h;
}
function renderTemporadasPublicas(){
  if(!PUB.temporadas.length)return '<section><h2>Temporadas</h2><p class="muted" style="margin-top:6px">Nenhuma temporada ainda.</p></section>';
  return `<section><h2>Temporadas</h2>${PUB.temporadas.map(t=>{const n=PUB.etapas.filter(e=>e.temporada_id===t.id).length;return `<div class="match-card" style="margin-top:10px"><div class="match-label">${T_STATUS[t.status]||esc(t.status)}</div>
    <p style="margin-top:6px"><b>${esc(t.nome)}</b>${t.inicio?' • início '+fmtData(t.inicio):''} • ${n} etapa(s)</p>
    <div class="panel-actions"><button class="secondary pub" onclick="abrirTemporadaPublica('${t.id}')">Ver classificação e etapas</button></div></div>`}).join('')}</section>`;
}
function abrirTemporadaPublica(id){if(!usarTemporada(id))return;pSec='temporadas';pTab='Ranking';view='publica-temporada';L=null;S=null;render();window.scrollTo(0,0)}
function renderEtapasPublicas(){
  const R=regrasCompletas(T.regras),ets=TE.slice().sort((a,b)=>a.etapa_numero-b.etapa_numero);
  const tags=n=>(R.dobradas.includes(n)?' • vale o dobro':'')+(R.especiais.includes(n)?' • especial':'');
  const jogadas=ets.filter(ligaEncerrada),atuais=ets.filter(l=>!ligaEncerrada(l)),usados=new Set(ets.map(l=>l.etapa_numero));
  const datas=(T.dados&&T.dados.datas)||{},proximas=[];
  if(T.status==='andamento')for(let n=1;n<=R.etapas;n++)if(!usados.has(n))proximas.push(n);
  let h='<section><h2>Etapas</h2>';
  h+='<h3 style="margin-top:12px">Atual</h3>'+(atuais.length?atuais.map(l=>cartaoLigaPublica(l,'Etapa '+l.etapa_numero+tags(l.etapa_numero))).join(''):'<p class="muted">Nenhuma etapa em andamento.</p>');
  if(proximas.length)h+='<h3 style="margin-top:16px">Próximas</h3>'+proximas.map(n=>`<div class="match-card" style="margin-top:10px;opacity:.85"><div class="match-label">Etapa ${n}${tags(n)}</div><p style="margin-top:6px">${datas[n]?'Data prevista: <b>'+fmtData(datas[n])+'</b>':'Data a definir'}</p></div>`).join('');
  h+='<h3 style="margin-top:16px">Jogadas</h3>'+(jogadas.length?jogadas.slice().reverse().map(l=>cartaoLigaPublica(l,'Etapa '+l.etapa_numero+tags(l.etapa_numero))).join(''):'<p class="muted">Nenhuma etapa encerrada ainda.</p>');
  return h+'</section>';
}
function renderRelampagosPublicas(){
  return `<section><h2>Ligas relâmpago</h2><p class="muted">Fora do ranking das temporadas.</p>${PUB.relampagos.length?PUB.relampagos.map(l=>cartaoLigaPublica(l,'Relâmpago')).join(''):'<p class="muted" style="margin-top:10px">Nenhuma liga relâmpago no momento.</p>'}</section>`;
}
const pubTabs=['Grupos','Jogos','Classificação','Chave'];
function abrirEtapaPublica(id,daRodada=false){
  const l=PUB.etapas.find(x=>x.id===id)||PUB.relampagos.find(x=>x.id===id);if(!l)return;
  if(!daRodada)pOrigem={view,pSec,pTab,tid:T&&T.id};
  let d;try{d=validarDados(l.dados)}catch{return alert('Não foi possível abrir esta liga.')}
  const R=l.temporada_id&&usarTemporada(l.temporada_id)?regrasCompletas(T.regras):null;
  S=d;L={...l};CONFRONTO_DIRETO=!!(R&&R.confronto_direto);ESPECIAL=ehEspecial(R?L:null,R,S);
  tab=S.drawn?'Jogos':'Grupos';view='publica-etapa';render();window.scrollTo(0,0);
}
function voltarConsulta(){
  const o=pOrigem,v=view;pOrigem=null;L=null;S=null;
  if(v==='publica-etapa'&&o&&o.view==='publica-temporada'&&usarTemporada(o.tid)){pSec='temporadas';pTab=o.pTab;view='publica-temporada'}
  else{pSec=v==='publica-temporada'?'temporadas':o&&o.view==='publica'?o.pSec:'inicio';view='publica';T=null;TE=[]}
  render();window.scrollTo(0,0);
}
function renderEtapaPublica(){
  if(!S.drawn)return `<section><h2>Atletas confirmados</h2><p class="muted">Grupos ainda não sorteados.</p><ol style="margin-top:8px">${S.names.filter(n=>n.trim()).map(n=>'<li>'+esc(n)+'</li>').join('')}</ol></section>`;
  if(tab==='Grupos')return renderGroups();
  if(tab==='Jogos')return renderGroupGames();
  if(tab==='Classificação')return renderClassification();
  return renderKnockout(true);
}
function sairDaTemporada(){T=null;TE=[];view='inicio';render();carregarLista()}
async function mudarStatusTemporada(st){
  const txt={encerrada:T.status==='arquivada'?'Desarquivar a temporada?':'Encerrar a temporada? Não será possível criar novas etapas até reabrir.',andamento:'Reabrir a temporada?',arquivada:'Arquivar a temporada? Ela continua disponível para consulta.'}[st];
  if(!confirm(txt))return;
  if(await salvarTemporada({p_status:st},{encerrada:'Temporada encerrada',andamento:'Temporada reaberta',arquivada:'Temporada arquivada'}[st]))render();
}
function renderTemporada(){
  if(!T)return '<section><p class="muted">Carregando…</p></section>';
  if(tTab==='Ranking')return renderRankingTemporada();
  if(tTab==='Etapas')return renderEtapasTemporada();
  if(tTab==='Ajustes')return renderAjustesTemporada();
  if(tTab==='Regras')return renderRegrasTemporada();
  return '';
}
function celulaRanking(c){
  if(c.tipo==='futura')return '<td class="muted">–</td>';
  const t=c.tipo==='ausente'?'F':'';
  return `<td class="${c.descarte?'desc':''} ${c.tipo==='andamento'?'parcial':''} ${c.tipo==='ausente'?'aus':''}" title="${c.tipo==='ausente'?'Falta':''}${c.descarte?' (descartada)':''}">${c.valor}${t?'<small>'+t+'</small>':''}</td>`;
}
function renderRankingTemporada(){
  if(tInfo.carregando&&!TE.length)return '<section><p class="muted">Carregando…</p></section>';
  const {R,linhas,semVinculo,encerradas}=calcularRanking();
  let h=`<section><h2>Ranking</h2><p class="muted">${encerradas} de ${R.etapas} etapas encerradas.${R.dobradas.length?' Etapa(s) '+R.dobradas.join(', ')+' valem o dobro.':''} ${R.descartes?R.descartes+' descarte(s) (riscados)'+(encerradas<R.etapas?' — provisório até a última etapa':'')+'.':'Sem descarte.'} Falta (F) vale ${R.ausencia==='minimo'?pontosMinimos(R):0}. Valores em itálico: etapa em andamento.</p>`;
  if(semVinculo.length)h+=`<p class="warn" style="margin-top:8px">⚠ ${semVinculo.map(x=>'Etapa '+x.n+': '+x.qtd+' nome(s) sem vínculo com o cadastro').join(' • ')} — esses nomes não entram no ranking. Abra a etapa, aba Atletas, e use "Vincular ao cadastro".</p>`;
  if(!linhas.length)return h+'<p class="muted" style="margin-top:10px">Ainda não há resultados. Crie a primeira etapa na aba Etapas.</p></section>';
  h+=`<div class="tabela-rolagem"><table class="rk"><tr><th>#</th><th class="rk-nome">Atleta</th>${Array.from({length:R.etapas},(_,i)=>`<th>E${i+1}${R.dobradas.includes(i+1)?'<small>×2</small>':''}</th>`).join('')}<th>Aj.</th><th>Total</th><th title="Vitórias na temporada">V</th><th title="Saldo de games">SG</th><th title="Games pró">GP</th></tr>
   ${linhas.map(x=>`<tr><td>${x.pos}º</td><td class="rk-nome"><a href="#" onclick="detalheAtletaTemporada('${x.id}');return false">${esc(x.nome)}</a>${x.situacao==='convidado'?' <span class="chip at-convidado">conv.</span>':''}</td>${x.cel.map(celulaRanking).join('')}<td>${x.aj||''}</td><td><b>${x.total}</b></td><td>${x.v}</td><td>${x.sg>0?'+':''}${x.sg}</td><td>${x.gp}</td></tr>`).join('')}
   </table></div><p class="muted" style="margin-top:8px">Toque no nome para ver os pontos de cada etapa. Desempate no total: vitórias (V), saldo de games (SG) e games pró (GP) da temporada; depois a maior pontuação numa etapa e o maior número de vitórias numa etapa. Empate em tudo: mesma posição.</p><div class="panel-actions"><button class="secondary" onclick="abrirWhatsAppRanking()">📤 Enviar ranking no WhatsApp</button></div></section>`;
  return h;
}
function detalheAtletaTemporada(id){
  const {R,linhas}=calcularRanking(),x=linhas.find(l=>l.id===id);if(!x)return;
  const aj=((T.dados&&T.dados.ajustes)||[]).filter(a=>a.atleta_id===id);
  const linhasEt=x.cel.map((c,i)=>{
    if(c.tipo==='futura')return '';
    const n=i+1,d=c.det;
    let txt=c.tipo==='ausente'?'Falta':`Grupo: ${d.v} vitória(s)${d.b?', '+d.b+' bônus 6×0':''}${d.dz?', '+d.dz+' derrota(s) 0×6':''}${d.posicao?', '+d.posicao+'º lugar':', posição pendente'} = ${d.grupo}${d.mata?' • Mata-mata ('+d.mataTxt.join(', ')+') = '+d.mata:''}`;
    return `<tr><td>E${n}</td><td>${txt}${c.mult>1?' • vale o dobro':''}${c.tipo==='andamento'?' • em andamento':''}</td><td class="${c.descarte?'desc':''}">${c.valor}</td></tr>`;
  }).join('');
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>${esc(x.nome)}</h2><p class="muted">${x.pos}º lugar • ${x.total} pontos</p>
   <table style="margin-top:10px"><tr><th>Etapa</th><th>Detalhe</th><th>Pts</th></tr>${linhasEt||'<tr><td colspan="3" class="muted">Sem etapas.</td></tr>'}
   ${aj.map(a=>`<tr><td>Ajuste</td><td>${esc(a.motivo)}${a.etapa?' (etapa '+a.etapa+')':''}</td><td>${a.pontos}</td></tr>`).join('')}</table>
   <div class="panel-actions"><button class="secondary" onclick="fecharModal()">Fechar</button></div></div></div>`;
}
function renderEtapasTemporada(){
  const R=regrasCompletas(T.regras),porNum=new Map(TE.filter(l=>!l.excluida_em).map(l=>[l.etapa_numero,l]));
  const aberta=T.status==='andamento';
  let h=`<section><h2>Etapas</h2><p class="muted">Cada etapa funciona como uma liga: atletas, sorteio, jogos, classificação e mata-mata. O sorteio evita repetir no mesmo grupo quem já jogou junto nas etapas anteriores desta temporada.</p><div class="ligas-list" style="margin-top:12px">`;
  for(let n=1;n<=R.etapas;n++){
    const l=porNum.get(n),tags=(R.dobradas.includes(n)?'<span class="chip at-convidado">vale o dobro</span> ':'')+(R.especiais.includes(n)?'<span class="chip at-membro">especial</span>':'');
    if(l)h+=`<div class="liga-card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>Etapa ${n}</h3><p class="muted">${fmtData(l.data)} • ${l.participantes} atletas • ${ETAPA_LABEL[l.etapa]||esc(l.etapa)}</p><div style="margin-top:4px">${tags}</div></div><span class="chip st-${l.status}">${STATUS_LABEL[l.status]||esc(l.status)}</span></div><div class="panel-actions"><button onclick="abrirLiga('${l.id}')">ABRIR</button><button class="ghost" onclick="moverParaLixeira('${l.id}')">🗑 Lixeira</button></div></div>`;
    else{const dp=dataPrevista(n);
      h+=`<div class="liga-card" style="opacity:.85"><div class="row" style="justify-content:space-between;align-items:center"><div><h3>Etapa ${n}</h3><div style="margin-top:4px">${tags}</div></div>${aberta?`<button class="secondary" onclick="abrirNovaEtapa(${n})">Criar</button>`:''}</div>
      ${aberta?`<label class="muted" style="display:block;margin-top:8px">Data prevista<input type="date" id="dp${n}" value="${dp}" onchange="salvarDataPrevista(${n},this.value)"></label>`:dp?`<p class="muted" style="margin-top:6px">Data prevista: ${fmtData(dp)}</p>`:''}</div>`}
  }
  h+='</div>';
  const extras=TE.filter(l=>!l.excluida_em&&l.etapa_numero>R.etapas);
  if(extras.length)h+=`<p class="warn" style="margin-top:10px">Há etapas além da quantidade definida nas regras: ${extras.map(l=>l.etapa_numero).join(', ')}. Elas não entram no ranking até você aumentar a quantidade de etapas.</p>`;
  return h+'</section>';
}
// datas previstas das etapas ainda não criadas (temporadas.dados.datas = {"3": "2027-02-10"})
function dataPrevista(n){const d=T&&T.dados&&T.dados.datas;return d&&typeof d[n]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d[n])?d[n]:''}
async function salvarDataPrevista(n,v){
  if(!T||v===dataPrevista(n))return;
  const datas={...((T.dados&&T.dados.datas)||{})};if(v)datas[n]=v;else delete datas[n];
  await salvarTemporada({p_dados:{...(T.dados||{}),datas}},v?'Data prevista da etapa '+n+': '+fmtData(v):'Data prevista da etapa '+n+' apagada');
  render();
}
function abrirNovaEtapa(n){
  $('modal').innerHTML=`<div class="modal-bg"><div class="modal-box"><h2>Criar etapa ${n}</h2>
   <div class="form-grid" style="margin-top:10px"><label>Data<input id="neData" type="date" value="${dataPrevista(n)||hoje()}"></label>
   <label>Quantidade de participantes<select id="neQtd">${SIZES.map(q=>`<option value="${q}">${q} atletas — ${q/4} grupos</option>`).join('')}</select></label>
   <p class="muted">Com menos de 16 inscritos, o regulamento prevê cancelar a etapa ou fazer uma liga relâmpago (fora do ranking).</p></div>
   <div class="panel-actions"><button id="neBtn" onclick="criarEtapa(${n})">CRIAR E ESCOLHER ATLETAS</button><button class="secondary" onclick="fecharModal()">Cancelar</button></div></div></div>`;
}
async function criarEtapa(n){
  if(ocupado)return;
  if(!navigator.onLine)return alert('Sem conexão. É preciso internet para criar a etapa.');
  const q=Number($('neQtd').value),data=$('neData').value,id=novoId();
  if(!data||!SIZES.includes(q))return;
  ocupado=true;$('neBtn').disabled=true;
  try{
    const {error}=await sb.rpc('criar_etapa',{p_temporada_id:T.id,p_numero:n,p_id:id,p_nome:T.nome+' — Etapa '+n,p_data:data,p_dados:{names:Array(q).fill(''),ids:Array(q).fill(null),scores:{},finals:{},breaks:{},drawn:false,status:'draft'}});
    if(error)throw error;
    lsSet('lr6:aba:'+id,'Atletas');fecharModal();
    await abrirLiga(id);
  }catch(e){alert('A etapa não foi criada: '+traduzErro(e));if($('neBtn'))$('neBtn').disabled=false}
  finally{ocupado=false}
}
function renderAjustesTemporada(){
  const aj=(T.dados&&Array.isArray(T.dados.ajustes)?T.dados.ajustes:[]),R=regrasCompletas(T.regras);
  const nomes=calcularRanking().linhas.map(x=>x.id);
  const opcoes=[...new Set([...nomes,...atletas.filter(a=>a.situacao!=='inativo').map(a=>a.id)])].map(id=>atletaPorId(id)).filter(Boolean).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  let h=`<section><h2>Ajustes de pontos</h2><p class="muted">Pontos somados ou descontados manualmente no ranking (ex.: −5 por atraso de mais de 10 minutos na confirmação). Ajustes não entram no descarte. Cada ajuste fica registrado no histórico da temporada.</p>`;
  if(T.status!=='arquivada')h+=`<div class="form-grid" style="margin-top:12px">
    <label>Atleta<select id="ajAtleta"><option value="">Escolha…</option>${opcoes.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></label>
    <label>Etapa (opcional)<select id="ajEtapa"><option value="">—</option>${Array.from({length:R.etapas},(_,i)=>`<option value="${i+1}">Etapa ${i+1}</option>`).join('')}</select></label>
    <label>Pontos (use − para descontar)<input id="ajPontos" type="number" inputmode="numeric" value="-5" style="max-width:120px"></label>
    <label>Motivo<input id="ajMotivo" maxlength="200" placeholder="Ex.: atraso na confirmação"></label>
    </div><div class="panel-actions"><button onclick="adicionarAjuste()">ADICIONAR AJUSTE</button></div>`;
  h+=aj.length?`<table style="margin-top:14px"><tr><th>Atleta</th><th>Etapa</th><th>Pts</th><th>Motivo</th><th></th></tr>${aj.map(a=>`<tr><td>${esc((atletaPorId(a.atleta_id)||{}).nome||'?')}</td><td>${a.etapa||'–'}</td><td>${a.pontos}</td><td>${esc(a.motivo)}<div class="muted">${fmtDataHora(a.em)}</div></td><td>${T.status!=='arquivada'?`<button class="ghost" onclick="removerAjuste('${a.id}')">Remover</button>`:''}</td></tr>`).join('')}</table>`:'<p class="muted" style="margin-top:12px">Nenhum ajuste.</p>';
  return h+'</section>';
}
async function adicionarAjuste(){
  const atleta_id=$('ajAtleta').value,pontos=inteiro($('ajPontos').value,NaN),motivo=$('ajMotivo').value.trim(),etapa=$('ajEtapa').value?Number($('ajEtapa').value):null;
  if(!atleta_id||!Number.isFinite(pontos)||!pontos||!motivo)return alert('Escolha o atleta, informe os pontos (diferente de 0) e o motivo.');
  const at=atletaPorId(atleta_id);
  if(!confirm('Lançar '+(pontos>0?'+':'')+pontos+' ponto(s) para '+at.nome+'?\nMotivo: '+motivo))return;
  const dados={...(T.dados||{}),ajustes:[...((T.dados&&T.dados.ajustes)||[]),{id:novoId(),atleta_id,etapa,pontos,motivo,em:new Date().toISOString()}]};
  if(await salvarTemporada({p_dados:dados},'Ajuste: '+at.nome+' '+(pontos>0?'+':'')+pontos+' ('+motivo+')'))render();
}
async function removerAjuste(id){
  const a=((T.dados&&T.dados.ajustes)||[]).find(x=>x.id===id);if(!a)return;
  const nome=(atletaPorId(a.atleta_id)||{}).nome||'?';
  if(!confirm('Remover o ajuste de '+a.pontos+' ponto(s) de '+nome+' ('+a.motivo+')? Ele continua no histórico da temporada.'))return;
  const dados={...T.dados,ajustes:T.dados.ajustes.filter(x=>x.id!==id)};
  if(await salvarTemporada({p_dados:dados},'Ajuste removido: '+nome+' '+a.pontos+' ('+a.motivo+')'))render();
}
function renderRegrasTemporada(){
  const R=regrasCompletas(T.regras),bloq=T.status==='arquivada';
  return `<section><h2>Regras da temporada</h2><p class="muted">Mudar uma regra recalcula o ranking inteiro na hora. A alteração fica registrada no histórico da temporada.</p>
   <div class="form-grid" style="margin-top:12px"><label>Nome<input id="rgNome" maxlength="120" value="${esc(T.nome)}" ${bloq?'disabled':''}></label><label>Início<input id="rgInicio" type="date" value="${esc(T.inicio||'')}" ${bloq?'disabled':''}></label></div>
   <div style="margin-top:12px">${regrasFormHtml(R,bloq)}</div>
   ${bloq?'<p class="muted" style="margin-top:10px">Temporada arquivada: desarquive para alterar.</p>':'<div class="panel-actions"><button onclick="salvarRegras()">SALVAR REGRAS</button></div>'}</section>`;
}
async function salvarRegras(){
  const nome=$('rgNome').value.trim();if(!nome)return alert('Informe o nome.');
  const novas=lerRegrasForm(),antes=regrasCompletas(T.regras);
  const mudou=JSON.stringify(novas)!==JSON.stringify(antes),mudouNome=nome!==T.nome||($('rgInicio').value||null)!==(T.inicio||null);
  if(!mudou&&!mudouNome)return alert('Nada mudou.');
  let motivo='Dados da temporada alterados';
  if(mudou){const m=prompt('Motivo da mudança de regra (fica no histórico):','Ajuste do regulamento');if(m===null)return;motivo='Regras alteradas: '+(m.trim()||'sem motivo informado')}
  if(await salvarTemporada({p_nome:nome,p_inicio:$('rgInicio').value||null,p_regras:novas},motivo)){alert('Regras salvas. O ranking foi recalculado.');render()}
}
/* ---------- Exportar para o WhatsApp (texto) ---------- */
// Monta a chave do mata-mata a partir dos dados atuais (null se ainda não liberada)
// Duplas do mata-mata já com as substituições aplicadas, e os eliminados em ordem da classificação geral
function classificadosGerais(){
  if(!complete()||groupPending())return null;
  const lists=listsGeneral(),counts=FORMATS[capacity()].counts;
  if(lists.some((l,k)=>counts[k]>0&&pending('r'+k,l,counts[k])))return null;
  const q=lists.flatMap((l,k)=>l.slice(0,counts[k])).map(x=>x.i);
  let fora=lists.flatMap((l,k)=>l.slice(counts[k])).map(x=>x.i);
  // lesão nos grupos: faltando gente, a vaga vai para o melhor que sobrou; sem ninguém, o lesionado segura a vaga
  while(q.length<16&&fora.length)q.push(fora.shift());
  const les=groupIndexes().flatMap(lesionadosDoGrupo);
  while(q.length<16&&les.length)q.push(les.shift());
  if(q.length!==16||new Set(q).size!==16)return null;
  const duos=Array.from({length:8},(_,i)=>q.slice(i*2,i*2+2));
  for(const s of (S.subs||[])){
    for(const p of duos){const k=p.indexOf(s.sai);if(k>=0)p[k]=s.entra}
    fora=fora.filter(i=>i!==s.entra);
  }
  return {duos,fora};
}
function melhorEliminado(){const c=classificadosGerais();return c&&c.fora.length?c.fora[0]:null}
// A dupla d (0..7) já tem placar nas quartas?
function duplaTemPlacar(d){const k=ordemQuartas().findIndex(p=>p.includes(d));return k>=0&&valid(S.finals['q'+(k+1)])}
function subDe(i){return [...(S.subs||[]),...(S.gsubs||[])].find(s=>s.entra===i&&s.atleta)}
// próxima posição virtual livre (atleta de fora da liga)
function proximoVirtual(){return Math.max(capacity()-1,...(S.subs||[]).map(s=>s.entra),...(S.gsubs||[]).map(s=>s.entra))+1}
// Nome de qualquer posição: atleta da liga ou atleta de fora que entrou no mata-mata
function nomeCompleto(i){if(i<capacity())return S.names[i]||'';const s=subDe(i);return s?s.atleta.nome:''}
function idDe(i){if(i<capacity())return (S.ids||[])[i]||null;const s=subDe(i);return s?s.atleta.id||null:null}
function chaveAtual(c=classificadosGerais()){
  if(!c)return null;
  const duos=c.duos;
  const qs=ordemQuartas().map((p,i)=>({id:'q'+(i+1),nome:'Quartas '+(i+1),a:duos[p[0]],b:duos[p[1]]}));
  // Etapa especial: da semifinal em diante as duplas são sorteadas antes de cada jogo (sem repetir o parceiro anterior)
  const aguardando=[];
  const montar=(id,nome,pa,pb)=>{
    if(!ESPECIAL)return {id,nome,a:pa,b:pb};
    const sm=(S.sorteioMata||{})[id];
    if(sm)return {id,nome,a:sm[0],b:sm[1]};
    aguardando.push({id,nome,jogadores:[...pa,...pb],antes:[pa,pb]});return null;
  };
  const ss=[0,1].map(i=>{const x=qs[2*i],y=qs[2*i+1];return valid(S.finals[x.id])&&valid(S.finals[y.id])?montar('s'+(i+1),'Semifinal '+(i+1),winner(x),winner(y)):null});
  let f=null,t=null;
  if(ss[0]&&ss[1]&&valid(S.finals.s1)&&valid(S.finals.s2)){f=montar('f','Final',winner(ss[0]),winner(ss[1]));t=montar('t','Disputa de 3º',loser(ss[0]),loser(ss[1]))}
  return {duos,qs,ss,f,t,aguardando};
}
/* ---------- Sorteio de duplas nas etapas especiais ---------- */
function mesmaDupla(x,y){return x.length===2&&y.length===2&&x.every(i=>y.includes(i))}
// Jogo que espera sorteio (ou que já foi sorteado e ainda não tem placar): {id,nome,jogadores,antes} ou texto do problema
function jogoParaSortear(id){
  if(!ESPECIAL)return 'Esta etapa não tem sorteio de duplas.';
  if(!podeMexerNoMata())return 'Lançamentos bloqueados.';
  if(valid(S.finals[id]))return 'Este jogo já tem placar. Apague o placar para sortear de novo.';
  const sm={...(S.sorteioMata||{})};delete sm[id];
  const c=comDados({...S,sorteioMata:sm},chaveAtual),g=c&&c.aguardando.find(x=>x.id===id);
  return g||'Ainda não dá para sortear este jogo.';
}
function combinacoesSemRepetir(g){
  const [a,b,c,d]=g.jogadores;
  return [[[a,b],[c,d]],[[a,c],[b,d]],[[a,d],[b,c]]].filter(op=>!op.some(p=>g.antes.some(x=>mesmaDupla(p,x))));
}
function gravarSorteio(id,pares,como){
  S.sorteioMata={...(S.sorteioMata||{}),[id]:pares};
  persist([{tipo:'sorteio',descricao:`Sorteio das duplas — ${jogoTexto(id,'finals')}: ${wDupla(pares[0])} x ${wDupla(pares[1])} (${como})`}]);
  return null;
}
function sortearDuplas(id){
  const g=jogoParaSortear(id);if(typeof g==='string')return g;
  const ops=combinacoesSemRepetir(g);if(!ops.length)return 'Não há combinação sem repetir o parceiro.';
  const rnd=n=>crypto.getRandomValues(new Uint32Array(1))[0]%n;
  const op=ops[rnd(ops.length)];
  return gravarSorteio(id,rnd(2)?[op[1],op[0]]:op,'sorteio automático');
}
function definirDuplas(id,pares,g=jogoParaSortear(id)){
  if(typeof g==='string')return g;
  if(!Array.isArray(pares)||pares.length!==2||pares.some(p=>!Array.isArray(p)||p.length!==2))return 'Escolha as duas duplas.';
  const todos=pares.flat();
  if(new Set(todos).size!==4||!todos.every(i=>g.jogadores.includes(i)))return 'As duplas têm que ser formadas pelos 4 atletas deste jogo.';
  if(pares.some(p=>g.antes.some(x=>mesmaDupla(p,x))))return 'Não pode repetir a dupla do jogo anterior.';
  return gravarSorteio(id,pares.map(p=>[...p]),'definido no saco de bolas');
}
function sortearDuplasTela(id){const e=sortearDuplas(id);if(e)alert(e);render()}
function abrirDuplasManual(id){
  const g=jogoParaSortear(id);if(typeof g==='string')return alert(g);
  const [a,...resto]=g.jogadores,ok=resto.filter(i=>!g.antes.some(x=>mesmaDupla([a,i],x)));
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Duplas — ${esc(jogoTexto(id,'finals'))}</h2>
   <p class="muted">Use o resultado do saco de bolas. Não pode repetir a dupla do jogo anterior.</p>
   <p style="margin-top:12px"><b>Parceiro de ${name(a)}</b></p>
   <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">${ok.map((i,k)=>`<label style="flex-direction:row;align-items:center;gap:8px"><input type="radio" name="dmParceiro" value="${i}" ${k===0?'checked':''} style="width:20px;height:20px">${name(i)} <span class="muted">— contra ${resto.filter(x=>x!==i).map(name).join(' / ')}</span></label>`).join('')}</div>
   <div class="panel-actions"><button onclick="confirmarDuplasManual('${id}')">CONFIRMAR DUPLAS</button><button class="secondary" onclick="fecharModal()">Cancelar</button></div></div></div>`;
}
function confirmarDuplasManual(id){
  const g=jogoParaSortear(id),r=document.querySelector('input[name=dmParceiro]:checked');if(typeof g==='string'||!r)return;
  const a=g.jogadores[0],p=+r.value,outros=g.jogadores.filter(i=>i!==a&&i!==p);
  const e=definirDuplas(id,[[a,p],outros],g);if(e)return alert(e);
  fecharModal();render();
}
function cartaoSorteio(x){
  const pode=podeMexerNoMata();
  return `<div class="match-card"><div class="match-label">${esc(x.nome)} — etapa especial</div><p style="margin-top:6px">Duplas sorteadas antes do jogo entre: <b>${x.jogadores.map(name).join(', ')}</b></p><p class="muted" style="margin-top:4px">Não pode repetir a dupla do jogo anterior.</p>${pode?`<div class="row" style="margin-top:8px;flex-wrap:wrap"><button data-sortear="${x.id}" onclick="sortearDuplasTela('${x.id}')">🎲 Sortear duplas</button><button class="secondary" onclick="abrirDuplasManual('${x.id}')">✍ Informar do saco de bolas</button></div>`:''}</div>`;
}
function wNome(i){return nomeCompleto(i)||'?'}
function wDupla(p){return p.map(wNome).join(' / ')}
function wJogo(m,k){
  const v=S[k][m.id];
  if(!valid(v))return `${wDupla(m.a)}  x  ${wDupla(m.b)}`;
  const [ga,gb]=v,venceuA=ga>gb;
  const wo=(S.wo||{})[m.id];
  return `${venceuA?'*'+wDupla(m.a)+'*':wDupla(m.a)}  ${ga} x ${gb}  ${venceuA?wDupla(m.b):'*'+wDupla(m.b)+'*'}${wo===0||wo===1?' (W.O.)':''}`;
}
function textoWhatsApp(op){
  const L_=L,linhas=[];
  linhas.push(`🎾 *${L_.nome}*`);
  linhas.push(`📅 ${fmtData(L_.data)} • ${capacity()} atletas${L_.etapa_numero&&!/etapa/i.test(L_.nome)?' • Etapa '+L_.etapa_numero:''}`);
  if(!S.drawn){
    linhas.push('','*Atletas confirmados*');
    S.names.forEach((n,i)=>{if(n.trim())linhas.push(`${String(i+1).padStart(2,'0')}. ${n}`)});
    linhas.push('','_Grupos ainda não sorteados._');
    return linhas.join('\n');
  }
  for(const g of groupIndexes()){
    const L2=[];
    if(op.jogos){L2.push(`*GRUPO ${'ABCDEFGH'[g]}*`);games(g).forEach((m,j)=>L2.push(`${j+1}) ${wJogo(m,'scores')}`))}
    if(op.classif&&games(g).some(m=>valid(S.scores[m.id]))){
      const r=rank(g);
      if(!op.jogos)L2.push(`*GRUPO ${'ABCDEFGH'[g]}*`);
      L2.push(op.jogos?'_Classificação:_':'');
      r.forEach((x,k)=>L2.push(`${k+1}º ${wNome(x.i)} — ${x.w}V, saldo ${x.s>0?'+':''}${x.s}`));
    }
    if(!op.jogos&&!op.classif)L2.push(`*GRUPO ${'ABCDEFGH'[g]}*: `+group(g).map(wNome).join(', '));
    linhas.push('',...L2.filter(x=>x!==''));
  }
  if(op.mata){
    const c=chaveAtual();
    if(c){
      linhas.push('','🏆 *MATA-MATA*');
      linhas.push('_Duplas:_');
      c.duos.forEach((d,i)=>linhas.push(`D${i+1}: ${wDupla(d)}`));
      (S.subs||[]).forEach(s=>{if(c.duos.some(p=>p.includes(s.entra)))linhas.push(`↺ ${wNome(s.entra)} entrou no lugar de ${wNome(s.sai)} (${s.motivo})`)});
      linhas.push('');
      c.qs.forEach(m=>linhas.push(`${m.nome}: ${wJogo(m,'finals')}`));
      c.ss.forEach(m=>m&&linhas.push(`${m.nome}: ${wJogo(m,'finals')}`));
      if(c.f){linhas.push(`${c.t.nome}: ${wJogo(c.t,'finals')}`);linhas.push(`${c.f.nome}: ${wJogo(c.f,'finals')}`)}
      if(c.f&&valid(S.finals.f)){
        linhas.push('',`🥇 Campeões: *${wDupla(winner(c.f))}*`,`🥈 Vice: ${wDupla(loser(c.f))}`);
        if(valid(S.finals.t))linhas.push(`🥉 3º lugar: ${wDupla(winner(c.t))}`);
      }
    }else linhas.push('','_Mata-mata: aguardando o fim da fase de grupos._');
  }
  linhas.push('','_Liga Resenha_');
  return linhas.join('\n');
}
let wOp={jogos:true,classif:false,mata:true};
function abrirWhatsApp(){
  const fase=S.drawn?'':'<p class="muted">Os grupos ainda não foram sorteados: sai a lista de atletas.</p>';
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Enviar no WhatsApp</h2>${fase}
   ${S.drawn?`<div class="row" style="gap:14px;margin-top:8px;flex-wrap:wrap">
    ${[['jogos','Jogos dos grupos'],['classif','Classificação'],['mata','Mata-mata']].map(([k,t])=>`<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" ${wOp[k]?'checked':''} onchange="wOp.${k}=this.checked;$('wTexto').value=textoWhatsApp(wOp)" style="width:20px;height:20px">${t}</label>`).join('')}</div>`:''}
   <textarea id="wTexto" rows="14" style="margin-top:10px;font-size:13px">${esc(textoWhatsApp(wOp))}</textarea>
   <p class="muted" id="wMsg">Você pode editar o texto antes de enviar. Os vencedores aparecem em *negrito* no WhatsApp.</p>
   <div class="panel-actions"><button onclick="compartilharTexto()">ENVIAR TEXTO</button><button class="secondary" onclick="copiarTexto()">Copiar</button>${S.drawn?'<button class="secondary" onclick="abrirImagemJogos()">🖼 Imagem / 🖨 PDF</button>':''}<button class="secondary" onclick="fecharModal()">Fechar</button></div></div></div>`;
}
async function compartilharTexto(){
  const t=$('wTexto').value;
  if(navigator.share){try{await navigator.share({text:t});return}catch(e){if(e&&e.name==='AbortError')return}}
  window.open('https://wa.me/?text='+encodeURIComponent(t),'_blank');
}
async function copiarTexto(){
  const t=$('wTexto').value;
  try{await navigator.clipboard.writeText(t);$('wMsg').textContent='✓ Texto copiado. Agora é só colar no grupo.'}
  catch{$('wTexto').select();document.execCommand('copy');$('wMsg').textContent='✓ Texto copiado. Agora é só colar no grupo.'}
}
// Ranking da temporada
function textoRankingTemporada(){
  const {R,linhas,encerradas}=calcularRanking();
  const out=[`🏆 *${T.nome} — Ranking*`,`${encerradas} de ${R.etapas} etapas${R.descartes&&encerradas<R.etapas?' • descarte provisório':''}`,''];
  linhas.forEach(x=>out.push(`${x.pos}º ${x.nome} — *${x.total}*`));
  out.push('','_Liga Resenha_');
  return out.join('\n');
}
function abrirWhatsAppRanking(){
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Ranking no WhatsApp</h2>
   <textarea id="wTexto" rows="16" style="margin-top:10px;font-size:13px">${esc(textoRankingTemporada())}</textarea><p class="muted" id="wMsg">Você pode editar o texto antes de enviar.</p>
   <div class="panel-actions"><button onclick="compartilharTexto()">ENVIAR</button><button class="secondary" onclick="copiarTexto()">Copiar</button><button class="secondary" onclick="fecharModal()">Fechar</button></div></div></div>`;
}

/* ---------- Folhas dos grupos e do chaveamento: imagem (WhatsApp) e impressão (PDF) ---------- */
// As duas folhas são desenhadas em SVG (A4 deitado, medidas em mm). A mesma folha vira
// a imagem PNG compartilhada e a página impressa, então as duas saem iguais.
let impSel='grupos',impPlacar=false;
const F_AZ='#1f3864',F_AZ2='#2f5597',F_OURO='#ffc000',F_VERDE='#4e8f2f',F_W=281,F_H=192;
function logoDoApp(){return document.querySelector('.logo-wrap img')}
let fMed=null;
function fLarg(t,tam){if(!fMed){fMed=document.createElement('canvas').getContext('2d');fMed.font='bold 100px Arial'}return fMed.measureText(String(t)).width*tam/100}
// Texto SVG; se passar da largura máxima, é comprimido para caber
function fT(x,y,t,tam,o='',max=0){const lg=max&&fLarg(t,tam)>max?` textLength="${max}" lengthAdjust="spacingAndGlyphs"`:'';return `<text x="${x}" y="${y}" font-size="${tam}"${/font-weight/.test(o)?'':' font-weight="700"'} ${o}${lg}>${esc(String(t))}</text>`}
function fLogo(x,y,w,h){const l=logoDoApp();return l&&l.src?`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${l.src}" xlink:href="${l.src}" preserveAspectRatio="xMidYMid meet"/>`:''}
function fCabecalho(titulo){
  const sub=`${fmtData(L.data).replace(/&[^;]+;/g,'')} • ${capacity()} atletas${L.etapa_numero?' • Etapa '+L.etapa_numero:''}`;
  const pw=fLarg(titulo,4.4)+14,px=F_W-pw;
  return fLogo(0,.5,19,19)
    +fT(23,6,'LIGA RESENHA',2.8,'fill="#b8860b" letter-spacing=".5"')
    +fT(23,12.6,L.nome,5.4,`fill="${F_AZ}"`,px-28)
    +fT(23,17.6,sub,3.1,'font-weight="400" fill="#333"')
    +`<rect x="${px}" y="3" width="${pw}" height="10.5" rx="2" fill="${F_AZ}"/><rect x="${px}" y="12.3" width="${pw}" height="1.7" rx=".8" fill="${F_OURO}"/>`
    +fT(px+pw/2,10.2,titulo,4.4,'fill="#fff" text-anchor="middle" letter-spacing=".4"')
    +`<line x1="0" y1="21.5" x2="${F_W}" y2="21.5" stroke="${F_AZ}" stroke-width=".7"/>`;
}
// m = margem branca em volta (usada na imagem; na impressão a margem é a da página)
function fSvg(corpo,w,h,m=0){return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${-m} ${-m} ${F_W+2*m} ${F_H+2*m}" width="${w}" height="${h}" font-family="Arial,Helvetica,sans-serif"><rect x="${-m}" y="${-m}" width="${F_W+2*m}" height="${F_H+2*m}" fill="#fff"/>${corpo}</svg>`}
const F_M=7;
function nomesFolha(){return nomesCurtos().map(n=>(n||'').toUpperCase())}
// Folha dos grupos: só os grupos que existem, jogos na ordem da aba Jogos
function corpoGrupos(comPlacar){
  const nc=nomesFolha(),G=groupIndexes(),lin=Math.ceil(G.length/2),CW=137,CH=36.2,GAP=4;
  let s=fCabecalho('FASE DE GRUPOS');
  G.forEach((g,k)=>{
    const col=k<lin?0:1,x=col*(CW+7),y=25+(k%lin)*(CH+GAP),L_='ABCDEFGH'[g];
    s+=`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="3" fill="#fff" stroke="#c5cfe3" stroke-width=".3"/>`;
    s+=`<path d="M${x} ${y+3}a3 3 0 0 1 3 -3h${CW-6}a3 3 0 0 1 3 3v5h-${CW}z" fill="${F_AZ}"/><rect x="${x}" y="${y+8}" width="${CW}" height="1" fill="${F_OURO}"/>`;
    s+=`<circle cx="${x+6}" cy="${y+4}" r="3" fill="${F_OURO}"/>`+fT(x+6,y+5.35,L_,3.8,`fill="${F_AZ}" text-anchor="middle"`)+fT(x+11,y+5.5,'GRUPO '+L_,3.7,'fill="#fff" letter-spacing=".5"');
    games(g).forEach((m,j)=>{
      const ry=y+10.6+j*8.4,v=comPlacar&&valid(S.scores[m.id])?S.scores[m.id]:null;
      if(j%2)s+=`<rect x="${x+2.5}" y="${ry}" width="${CW-5}" height="7.4" rx="1.5" fill="#eef2f9"/>`;
      s+=`<circle cx="${x+6}" cy="${ry+3.7}" r="2.4" fill="#dae3f3"/>`+fT(x+6,ry+4.55,j+1,2.4,`fill="${F_AZ}" text-anchor="middle"`);
      const c0=x+10.3,c1=x+CW-4,mid=(c0+c1)/2;
      [mid-13,mid+2].forEach((bx,k2)=>{s+=`<rect x="${bx}" y="${ry+.6}" width="11" height="6.2" rx="1.5" fill="#fff" stroke="${F_AZ}" stroke-width=".45"/>`;if(v)s+=fT(bx+5.5,ry+5.2,v[k2],4.2,'fill="#111" text-anchor="middle"')});
      s+=fT(mid,ry+4.6,'X',2.6,'fill="#8a96ad" text-anchor="middle"');
      s+=fT(mid-14.8,ry+4.75,m.a.map(i=>nc[i]).join(' / '),3,'fill="#111" text-anchor="end"',mid-14.8-c0);
      s+=fT(mid+14.8,ry+4.75,m.b.map(i=>nc[i]).join(' / '),3,'fill="#111"',c1-mid-14.8);
    });
  });
  return s;
}
// Chave espelhada: quartas 1-2 e semi 1 à esquerda, quartas 3-4 e semi 2 à direita, final no centro
function corpoChave(comPlacar){
  const nc=nomesFolha(),c=chaveAtual();
  const caixa=(x,y,w,cor,claro,txtCor,rotulo,linhas,id,esp=false,destaque=false)=>{
    const h=34,v=comPlacar&&valid(S.finals[id])?S.finals[id]:null;
    const xs=esp?x+w-6:x,xseed=esp?x+w-14:x+6,xsc=esp?x+2:x+w-13,xn=esp?x+15:x+16,maxN=w-31;
    let s=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="#fff" stroke="${destaque?F_OURO:F_AZ}" stroke-width="${destaque?.9:.35}"/>`;
    s+=`<rect x="${xs}" y="${y}" width="6" height="${h}" fill="${cor}"/><rect x="${xseed}" y="${y}" width="8" height="${h}" fill="${claro}"/>`;
    s+=fT(xs+4,y+h/2,rotulo,2.6,`transform="rotate(-90 ${xs+4} ${y+h/2})" text-anchor="middle" letter-spacing=".3" fill="${txtCor}"`);
    linhas.forEach(([s1,s2,p],k)=>{
      const ry=y+k*17;
      s+=fT(xseed+4,ry+7.4,s1,2.7,`text-anchor="middle" fill="${F_AZ}"`)+fT(xseed+4,ry+11.6,s2,2.7,`text-anchor="middle" fill="${F_AZ}"`);
      if(p)p.forEach((i,n)=>{s+=fT(xn,ry+7.6+n*4.6,nc[i]||'',3,'fill="#111"',maxN)});
      s+=`<rect x="${xsc}" y="${ry+2}" width="11" height="13" rx="1" fill="#eef2f9" stroke="#9fb0cf" stroke-width=".3"/>`;
      if(v)s+=(S.wo||{})[id]===k?fT(xsc+5.5,ry+10.4,'WO',3.4,'text-anchor="middle" fill="#b91c1c"'):fT(xsc+5.5,ry+11.2,v[k],5,'text-anchor="middle" fill="#111"');
    });
    return s+`<line x1="${esp?x:x+6}" y1="${y+17}" x2="${esp?x+w-6:x+w}" y2="${y+17}" stroke="#9fb0cf" stroke-width=".3"/>`;
  };
  const liga=(x1,y1,x2,y2)=>`<path d="M${x1} ${y1}H${(x1+x2)/2}V${y2}H${x2}" fill="none" stroke="${F_AZ}" stroke-width=".45"/>`;
  const ord=ordemQuartas(),QW=54,SW=48,FW=51,qy=[16,108],sy=62,fy=60;
  const qx=[0,0,281-QW,281-QW],qyy=[qy[0],qy[1],qy[0],qy[1]],sx=[61,281-61-SW],fx=(281-FW)/2;
  let s='';
  [[QW/2,'QUARTAS'],[61+SW/2,'SEMIFINAL'],[281-61-SW/2,'SEMIFINAL'],[281-QW/2,'QUARTAS']].forEach(([x,t])=>s+=fT(x,8,t,3.2,`text-anchor="middle" letter-spacing=".8" fill="${F_AZ2}"`));
  ord.forEach(([a,b],i)=>{
    const esp=i>=2;
    s+=caixa(qx[i],qyy[i],QW,F_AZ,'#dae3f3','#fff',`QUARTAS ${i+1}`,[a,b].map(d=>[2*d+1,2*d+2,c?c.duos[d]:null]),'q'+(i+1),esp);
    const alvo=sy+8.5+(i&1)*17;
    s+=esp?liga(qx[i],qyy[i]+17,sx[1]+SW,alvo):liga(QW,qyy[i]+17,sx[0],alvo);
  });
  [0,1].forEach(i=>{const m=c&&c.ss[i];s+=caixa(sx[i],sy,SW,F_AZ2,'#dae3f3','#fff',`SEMI ${i+1}`,[0,1].map(k=>['QF',String(2*i+k+1),m?(k?m.b:m.a):null]),'s'+(i+1),i===1)});
  s+=liga(sx[0]+SW,sy+17,fx,fy+8.5)+liga(sx[1],sy+17,fx+FW,fy+25.5);
  s+=fLogo(fx+FW/2-20,4,40,40);
  s+=fT(140.5,55,'FINAL',4.2,`text-anchor="middle" letter-spacing="1.5" fill="${F_AZ}"`);
  s+=caixa(fx,fy,FW,F_OURO,'#fff2cc',F_AZ,'FINAL',[0,1].map(k=>['SF',String(k+1),c&&c.f?(k?c.f.b:c.f.a):null]),'f',false,true);
  s+=fT(140.5,103,'CAMPEÕES',3.4,'text-anchor="middle" letter-spacing="1.2" fill="#b8860b"');
  s+=`<line x1="${fx}" y1="113" x2="${fx+FW}" y2="113" stroke="${F_AZ}" stroke-width=".35"/>`;
  s+=fT(140.5,124,'3º LUGAR',3.4,`text-anchor="middle" letter-spacing="1.2" fill="${F_VERDE}"`);
  s+=caixa(fx,127,FW,F_VERDE,'#e2f0d9','#fff','3º LUGAR',[0,1].map(k=>['SF',String(k+1),c&&c.t?(k?c.t.b:c.t.a):null]),'t');
  if(!c)s+=fT(140.5,168,'Números = posição na classificação geral dos 16 classificados (1 e 2 formam a dupla 1, 3 e 4 a dupla 2...).',2.6,'font-weight="400" text-anchor="middle" fill="#555"');
  return fCabecalho('CHAVEAMENTO')+`<g transform="translate(4.2 23.5) scale(.97)">${s}</g>`;
}
const F_TIPOS={grupos:{nome:'Grupos',arquivo:'jogos-grupos',corpo:corpoGrupos},chave:{nome:'Chaveamento',arquivo:'chaveamento',corpo:corpoChave}};
function tiposEscolhidos(){return impSel==='ambas'?['grupos','chave']:[impSel]}
function folhaSvg(tipo,w,h,m=0){return fSvg(F_TIPOS[tipo].corpo(impPlacar),w,h,m)}
// Converte a folha em PNG (2480 px de largura, boa para WhatsApp e impressão)
function folhaPng(tipo){
  const W=2480,H=Math.round(W*(F_H+2*F_M)/(F_W+2*F_M));
  return new Promise((ok,falha)=>{
    const img=new Image();
    img.onload=()=>{try{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,W,H);x.drawImage(img,0,0,W,H);c.toBlob(b=>b?ok(b):falha(new Error('não foi possível gerar a imagem')),'image/png')}catch(e){falha(e)}};
    img.onerror=()=>falha(new Error('não foi possível gerar a imagem'));
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(folhaSvg(tipo,W,H,F_M));
  });
}
function abrirImagemJogos(sel){
  if(!S.drawn)return alert('Faça o sorteio dos grupos primeiro.');
  impSel=sel||(chaveAtual()?'chave':'grupos');
  const temPlacar=totalGroupGames()>0||Object.keys(S.finals||{}).length>0;
  if(!temPlacar)impPlacar=false;
  const op=(v,t)=>`<label style="flex-direction:row;align-items:center;gap:6px"><input type="radio" name="impSel" value="${v}" ${impSel===v?'checked':''} onchange="impSel=this.value;atualizarPreviaJogos()" style="width:20px;height:20px"> ${t}</label>`;
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Imagens e impressão</h2>
   <p class="muted">Escolha a folha. A imagem para o WhatsApp e o PDF saem iguais.</p>
   <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:8px">${op('grupos','Grupos')}${op('chave','Chaveamento')}${op('ambas','Os dois')}</div>
   ${temPlacar?`<label style="flex-direction:row;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" ${impPlacar?'checked':''} onchange="impPlacar=this.checked;atualizarPreviaJogos()" style="width:20px;height:20px"> Mostrar os placares já lançados</label>`:''}
   <div id="tjPrevia" style="margin-top:10px;display:grid;gap:8px"></div>
   <p class="muted" id="tjMsg"></p>
   <div class="panel-actions"><button onclick="compartilharImagemJogos()">🖼 COMPARTILHAR IMAGEM</button><button class="secondary" onclick="imprimirTabelaJogos()">🖨 Imprimir / PDF</button><button class="secondary" onclick="fecharModal()">Fechar</button></div></div></div>`;
  atualizarPreviaJogos();
}
function atualizarPreviaJogos(){
  const d=$('tjPrevia');if(!d)return;
  d.innerHTML=tiposEscolhidos().map(t=>`<div style="background:#fff;border-radius:8px;overflow:hidden;aspect-ratio:${F_W+2*F_M}/${F_H+2*F_M}">${folhaSvg(t,'100%','100%',F_M)}</div>`).join('');
}
async function compartilharImagemJogos(){
  const m=$('tjMsg');if(m)m.textContent='Gerando imagem…';
  let arqs;
  try{arqs=await Promise.all(tiposEscolhidos().map(async t=>new File([await folhaPng(t)],`${F_TIPOS[t].arquivo}-${slug(L.nome)}.png`,{type:'image/png'})))}
  catch(e){if(m)m.textContent='Não foi possível gerar a imagem: '+traduzErro(e);return}
  if(m)m.textContent='';
  if(navigator.canShare&&navigator.canShare({files:arqs})){
    try{await navigator.share({files:arqs,title:L.nome});return}catch(e){if(e&&e.name==='AbortError')return}
  }
  for(const f of arqs){const a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
  if(m)m.textContent=arqs.length>1?'Imagens baixadas. Envie pelo WhatsApp como foto.':'Imagem baixada. Envie pelo WhatsApp como foto.';
}
// Folhas A4 deitadas para imprimir ou salvar em PDF e preencher à mão
function imprimirTabelaJogos(){
  if(!S.drawn)return alert('Faça o sorteio dos grupos primeiro.');
  $('impressao').innerHTML=tiposEscolhidos().map(t=>`<div class="imp-pagina">${folhaSvg(t,'281mm','192mm')}</div>`).join('');
  fecharModal();
  document.body.classList.add('imprimindo');
  const fim=()=>{document.body.classList.remove('imprimindo');window.removeEventListener('afterprint',fim)};
  window.addEventListener('afterprint',fim);
  setTimeout(()=>window.print(),150);
}

/* ---------- Nova liga ---------- */
function renderNova(){
  return `<section><h2>Nova liga</h2>
  <form onsubmit="criarLiga(event)" class="form-grid" style="margin-top:10px">
   <label>Nome da competição<input id="nlNome" maxlength="120" required placeholder="Ex.: Relâmpago de Sábado"></label>
   <label>Data<input id="nlData" type="date" required value="${hoje()}"></label>
   <label>Quantidade de participantes<select id="nlQtd">${SIZES.map(n=>`<option value="${n}">${n} atletas — ${n/4} grupos</option>`).join('')}</select></label>
   <p class="muted" id="nlRegra">${FORMATS[16].label}</p>
   <div class="panel-actions"><button type="submit" id="nlBtn">CRIAR E CADASTRAR ATLETAS</button><button type="button" class="secondary" onclick="view='inicio';render()">Cancelar</button></div>
  </form></section>`;
}
async function criarLiga(ev){
  ev.preventDefault();
  if(ocupado)return;
  const nome=$('nlNome').value.trim(),data=$('nlData').value,n=Number($('nlQtd').value);
  if(!nome||!data||!SIZES.includes(n))return alert('Preencha nome, data e quantidade.');
  if(!navigator.onLine)return alert('Sem conexão. É preciso internet para criar uma liga.');
  ocupado=true;$('nlBtn').disabled=true;
  const id=novoId();
  try{
    const {data:r,error}=await sb.rpc('criar_liga',{p_id:id,p_nome:nome,p_data:data,p_dados:{names:Array(n).fill(''),ids:Array(n).fill(null),scores:{},finals:{},breaks:{},drawn:false,status:'draft'}});
    if(error)throw error;
    lsSet('lr6:aba:'+id,'Atletas');
    await abrirLiga(r.id);
  }catch(e){alert('A liga não foi criada: '+traduzErro(e));if($('nlBtn'))$('nlBtn').disabled=false}
  finally{ocupado=false}
}

/* ---------- Duplicar, arquivar, lixeira ---------- */
async function duplicarLiga(id){
  if(ocupado)return;
  const base=lista.find(x=>x.id===id)||(L&&L.id===id?L:null);
  const nome=prompt('Nome da nova liga (atletas e formato serão copiados, resultados não):','Cópia de '+(base?base.nome:'liga'));
  if(!nome||!nome.trim())return;
  ocupado=true;
  try{
    let names,ids;
    if(L&&L.id===id&&S){names=[...S.names];ids=[...S.ids]}
    else{const {data,error}=await sb.from('ligas').select('dados').eq('id',id).single();if(error)throw error;const d=validarDados(data.dados);names=d.names;ids=d.ids}
    const novo=novoId();
    const {error}=await sb.rpc('criar_liga',{p_id:novo,p_nome:nome.trim(),p_data:hoje(),p_dados:{names,ids,scores:{},finals:{},breaks:{},drawn:false,status:'draft'},p_motivo:'Duplicada de "'+(base?base.nome:id)+'"'});
    if(error)throw error;
    if(view==='liga'&&(enviando||fila.pendente)){alert('Liga duplicada. Ela aparece em Minhas Ligas.');return}
    lsSet('lr6:aba:'+novo,'Atletas');
    await abrirLiga(novo);
  }catch(e){alert('Não foi possível duplicar: '+traduzErro(e))}
  finally{ocupado=false}
}
async function mudarArquivo(id,arquivar){
  const x=lista.find(y=>y.id===id);if(!x||ocupado)return;
  if(!confirm(arquivar?'Arquivar esta liga? Ela continua disponível para consulta.':'Desarquivar esta liga?'))return;
  ocupado=true;
  try{
    const {data,error}=await sb.rpc('salvar_liga',{p_id:id,p_versao_esperada:x.versao,p_status:arquivar?'arquivada':'finalizada',p_eventos:[{tipo:arquivar?'arquivada':'desarquivada',descricao:arquivar?'Liga arquivada':'Liga desarquivada'}]});
    if(error)throw error;
    if(!data.ok)alert('A liga foi alterada em outro aparelho. A lista será atualizada; tente de novo.');
  }catch(e){alert('Não foi possível: '+traduzErro(e))}
  finally{ocupado=false;carregarLista()}
}
async function moverParaLixeira(id){
  const aberta=!id||(L&&L.id===id);
  const x=aberta?L:(lista.find(y=>y.id===id)||TE.find(y=>y.id===id));if(!x)return;
  if(aberta&&(enviando||fila.pendente))return alert('Aguarde as alterações serem salvas no servidor.');
  if(!confirm('Mover "'+x.nome+'" para a lixeira? Ela pode ser recuperada depois em Lixeira, no fim da tela inicial. Lá também dá para apagar de vez.'))return;
  try{
    const {error}=await sb.rpc('mover_para_lixeira',{p_id:x.id});if(error)throw error;
    if(aberta)voltarInicio(true);else if(view==='temporada'&&T)abrirTemporada(T.id);else{mostrarLixeira=true;carregarLista()}
  }catch(e){alert('Não foi possível: '+traduzErro(e))}
}
async function retirarDaLixeira(id){
  try{const {error}=await sb.rpc('retirar_da_lixeira',{p_id:id});if(error)throw error}
  catch(e){alert('Não foi possível: '+traduzErro(e))}
  carregarLista();
}
// Baixa um backup das ligas antes de apagar. Se não conseguir, nada é apagado.
async function backupAntesDeApagar(ids){
  const {data,error}=await sb.from('ligas').select('*').in('id',ids);
  if(error)throw error;
  if(!data||data.length!==ids.length)throw new Error('não foi possível ler todas as ligas para o backup');
  baixarJSON(`backup-antes-de-apagar-${hoje()}-${Date.now()}.json`,{app:'liga-resenha-v6',tipo:'ligas',observacao:'Ligas apagadas definitivamente da lixeira',exportado_em:new Date().toISOString(),ligas:data.map(r=>({liga:metaDe(r),dados:r.dados}))});
}
async function apagarDeVez(id){
  const x=lixeira.find(y=>y.id===id);if(!x||ocupado)return;
  if(!confirm('Apagar DE VEZ a liga "'+x.nome+'" ('+fmtData(x.data)+')?\n\nIsso não tem volta: a liga, os resultados e o histórico dela somem do servidor. Um arquivo de backup será baixado antes.'))return;
  ocupado=true;
  try{
    await backupAntesDeApagar([id]);
    const {error}=await sb.rpc('excluir_definitivamente',{p_id:id});if(error)throw error;
    try{localStorage.removeItem(cacheKey(id));localStorage.removeItem('lr6:aba:'+id)}catch{}
  }catch(e){alert('Nada foi apagado: '+traduzErro(e))}
  finally{ocupado=false}
  carregarLista();
}
async function esvaziarLixeira(){
  if(!lixeira.length||ocupado)return;
  const r=prompt('Apagar DE VEZ as '+lixeira.length+' liga(s) da lixeira?\n\n'+lixeira.map(x=>'• '+x.nome).join('\n')+'\n\nIsso não tem volta. Um arquivo de backup será baixado antes.\nPara confirmar, digite APAGAR:');
  if(r===null)return;
  if(r.trim().toUpperCase()!=='APAGAR')return alert('Nada foi apagado (a palavra digitada não foi APAGAR).');
  ocupado=true;
  try{
    const ids=lixeira.map(x=>x.id);
    await backupAntesDeApagar(ids);
    const {data,error}=await sb.rpc('esvaziar_lixeira');if(error)throw error;
    for(const id of ids)try{localStorage.removeItem(cacheKey(id));localStorage.removeItem('lr6:aba:'+id)}catch{}
    alert(data.apagadas+' liga(s) apagada(s) de vez.');
  }catch(e){alert('Nada foi apagado: '+traduzErro(e))}
  finally{ocupado=false}
  carregarLista();
}

/* ---------- Exportar / importar ---------- */
function slug(s){return String(s||'liga').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'liga'}
function baixarJSON(nome,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function exportarLiga(){baixarJSON(`liga-${slug(L.nome)}-${L.data}-v${L.versao}.json`,{app:'liga-resenha-v6',tipo:'liga',exportado_em:new Date().toISOString(),liga:{...L},dados:dadosParaServidor()})}
async function exportarTodas(){
  try{
    const {data,error}=await sb.from('ligas').select('*').order('data');
    if(error)throw error;
    baixarJSON(`liga-resenha-todas-${hoje()}.json`,{app:'liga-resenha-v6',tipo:'todas',exportado_em:new Date().toISOString(),ligas:data.map(r=>({liga:{...metaDe(r),excluida_em:r.excluida_em},dados:r.dados}))});
  }catch(e){alert('Não foi possível exportar: '+traduzErro(e))}
}
function importarArquivo(ev){
  const f=ev.target.files[0];ev.target.value='';if(!f)return;
  const r=new FileReader();
  r.onload=async()=>{
    let itens;
    try{
      const x=JSON.parse(r.result);
      if(x&&x.app==='liga-resenha-v6'&&x.tipo==='liga')itens=[{liga:x.liga||{},dados:x.dados}];
      else if(x&&x.app==='liga-resenha-v6'&&x.tipo==='todas'&&Array.isArray(x.ligas))itens=x.ligas;
      else if(x&&Array.isArray(x.names))itens=[{liga:{nome:'Liga importada'},dados:x}];
      else throw new Error('formato não reconhecido');
      itens=itens.map((it,i)=>{try{return {nome:String((it.liga&&it.liga.nome)||'Liga importada').slice(0,100),data:/^\d{4}-\d{2}-\d{2}$/.test(it.liga&&it.liga.data)?it.liga.data:hoje(),dados:validarDados(it.dados)}}catch{throw new Error('liga '+(i+1)+' do arquivo está inválida')}});
      if(!itens.length)throw new Error('arquivo sem ligas');
    }catch(e){return alert('Backup inválido: '+e.message+'. Nada foi importado.')}
    if(!confirm(`Importar ${itens.length} liga(s) como NOVAS ligas? Nenhuma liga existente será alterada.`))return;
    let ok=0,falhas=[];
    for(const it of itens){
      const {error}=await sb.rpc('criar_liga',{p_id:novoId(),p_nome:it.nome+' (importada)',p_data:it.data,p_dados:dadosParaServidor(it.dados),p_status:statusDe(it.dados),p_etapa:etapaDe(it.dados),p_motivo:'Importada de backup'});
      if(error)falhas.push(it.nome+': '+traduzErro(error));else ok++;
    }
    alert(`${ok} liga(s) importada(s).`+(falhas.length?'\nFalhas:\n'+falhas.join('\n'):''));
    carregarLista();
  };
  r.readAsText(f);
}
function hashTexto(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return String(h)}
function ligaAntigaDoAparelho(){
  for(const k of LEGACY_KEYS){
    let raw;try{raw=localStorage.getItem(k)}catch{raw=null}
    if(!raw)continue;
    try{const d=validarDados(JSON.parse(raw));const assinatura=hashTexto(raw);if(lsGet('lr6:antiga-ocultada')===assinatura)return null;return {k,raw,d,assinatura}}catch{}
  }
  return null;
}
async function importarAntiga(){
  const a=ligaAntigaDoAparelho();if(!a||ocupado)return;
  const nome=prompt('Nome para esta liga:','Liga importada do aparelho');if(!nome||!nome.trim())return;
  const data=prompt('Data da liga (AAAA-MM-DD):',hoje());if(!data||!/^\d{4}-\d{2}-\d{2}$/.test(data))return alert('Data inválida.');
  ocupado=true;
  try{
    const id=novoId();
    const {error}=await sb.rpc('criar_liga',{p_id:id,p_nome:nome.trim(),p_data:data,p_dados:dadosParaServidor(a.d),p_status:statusDe(a.d),p_etapa:etapaDe(a.d),p_motivo:'Importada da versão anterior (dados do aparelho)'});
    if(error)throw error;
    lsSet('lr6:antiga-ocultada',a.assinatura);
    await abrirLiga(id);
  }catch(e){alert('Não foi possível importar: '+traduzErro(e))}
  finally{ocupado=false}
}
function baixarAntiga(){const a=ligaAntigaDoAparelho();if(a)baixarJSON('liga-versao-anterior-backup.json',JSON.parse(a.raw))}
function ocultarAntiga(){const a=ligaAntigaDoAparelho();if(a&&confirm('Ocultar este aviso? Os dados continuam guardados no aparelho.')){lsSet('lr6:antiga-ocultada',a.assinatura);render()}}

/* ---------- Histórico e versões ---------- */
async function carregarHistorico(){
  historico={carregando:true};
  try{
    const [ev,vs]=await Promise.all([
      sb.from('ligas_eventos').select('versao,tipo,descricao,criado_em').eq('liga_id',L.id).order('id',{ascending:false}).limit(300),
      sb.from('ligas_versoes').select('versao,motivo,status,etapa,participantes,excluida,criado_em').eq('liga_id',L.id).order('versao',{ascending:false}).limit(300)
    ]);
    if(ev.error)throw ev.error;if(vs.error)throw vs.error;
    historico={eventos:ev.data,versoes:vs.data};
  }catch(e){historico={erro:traduzErro(e)}}
  if(view==='liga'&&tab==='Histórico')render();
}
function renderHistorico(){
  if(!historico){carregarHistorico();return '<section><h2>Histórico</h2><p class="muted">Carregando…</p></section>'}
  if(historico.carregando)return '<section><h2>Histórico</h2><p class="muted">Carregando…</p></section>';
  if(historico.erro)return `<section><h2>Histórico</h2><p class="warn">Não foi possível carregar: ${esc(historico.erro)}</p><div class="panel-actions"><button class="secondary" onclick="historico=null;render()">Tentar novamente</button></div></section>`;
  let h=`<section><h2>Histórico de alterações</h2><div class="panel-actions" style="margin-top:0"><button class="secondary" onclick="historico=null;render()">Atualizar</button><button class="secondary" onclick="exportarLiga()">Exportar esta liga</button></div>
   <table style="margin-top:10px"><tr><th>Quando</th><th>Alteração</th><th>Versão</th></tr>${historico.eventos.map(e=>`<tr><td class="muted">${fmtDataHora(e.criado_em)}</td><td style="text-align:left">${esc(e.descricao||e.tipo)}</td><td>${e.versao}</td></tr>`).join('')}</table></section>`;
  h+=`<section><h2>Versões salvas</h2><p class="muted">Cada gravação no servidor guarda uma cópia completa. Restaurar cria uma nova versão; nada é apagado.</p>
   ${historico.versoes.map(v=>`<div class="liga-card" style="margin-top:8px"><div class="row" style="justify-content:space-between"><b>Versão ${v.versao}${v.versao===L.versao?' (atual)':''}</b><span class="muted">${fmtDataHora(v.criado_em)}</span></div><p class="muted">${esc(v.motivo)} • ${STATUS_LABEL[v.status]||esc(v.status)} • ${ETAPA_LABEL[v.etapa]||esc(v.etapa)} • ${v.participantes} atletas${v.excluida?' • na lixeira':''}</p><div class="panel-actions"><button class="secondary" onclick="baixarVersao(${v.versao})">Baixar</button>${v.versao!==L.versao?`<button class="secondary" onclick="restaurarVersao(${v.versao})">Restaurar esta versão</button>`:''}</div></div>`).join('')}</section>`;
  h+=`<section><h3>Lixeira</h3><p class="muted" style="margin-top:6px">Retira a liga de Minhas Ligas. Pode ser recuperada depois.</p><div class="panel-actions"><button class="secondary" onclick="moverParaLixeira()">Mover para a lixeira</button></div></section>`;
  return h;
}
async function baixarVersao(v){
  try{const {data,error}=await sb.from('ligas_versoes').select('*').eq('liga_id',L.id).eq('versao',v).single();if(error)throw error;
    baixarJSON(`liga-${slug(data.nome)}-${data.data}-v${v}.json`,{app:'liga-resenha-v6',tipo:'liga',exportado_em:new Date().toISOString(),liga:{id:L.id,nome:data.nome,data:data.data,participantes:data.participantes,status:data.status,etapa:data.etapa,versao:v},dados:data.dados})}
  catch(e){alert('Não foi possível baixar: '+traduzErro(e))}
}
async function restaurarVersao(v){
  if(enviando||fila.pendente)return alert('Aguarde as alterações serem salvas no servidor.');
  if(!confirm(`Restaurar a versão ${v}? O estado atual continua guardado no histórico.`))return;
  try{
    const {data,error}=await sb.rpc('restaurar_versao',{p_id:L.id,p_versao:v,p_versao_esperada:L.versao});
    if(error)throw error;
    if(!data.ok){alert('A liga foi alterada em outro aparelho. Ela será recarregada; tente de novo.')}
    await abrirLiga(L.id,{ignorarCache:true});
  }catch(e){alert('Não foi possível restaurar: '+traduzErro(e))}
}

/* ---------- Regras da Liga Relâmpago (aprovadas — não alterar critérios) ---------- */
function capacity(){return S.names.length}
function groupIndexes(){
return Array.from({length:capacity()/4},(_,i)=>i)
}
function groupGameCount(){
return groupIndexes().length*3
}
function formatRule(){
return FORMATS[capacity()].label
}
function setCapacity(n,el){
if(S.status!=='draft'||!SIZES.includes(n)){
el.value=String(capacity());return;
}
if(n===capacity())return;
const sel=selecionados();
if(sel.length>n&&!confirm('Manter somente os primeiros '+n+' atletas selecionados?')){
el.value=String(capacity());return;
}
S.names=Array.from({length:n},(_,i)=>sel[i]?sel[i].nome:'');
S.ids=Array.from({length:n},(_,i)=>sel[i]?sel[i].id||null:null);
S.scores={};S.finals={};S.breaks={};S.drawn=false;
persist([{tipo:'configuracao',descricao:'Quantidade de atletas alterada para '+n}]);
tab='Atletas';render();
}
function clearNames(){
if(S.status!=='draft')return;
if(!confirm('Limpar a seleção de atletas desta liga?'))return;
S.names=Array(capacity()).fill('');
S.ids=Array(capacity()).fill(null);
S.scores={};S.finals={};S.breaks={};
persist([{tipo:'cadastro',descricao:'Seleção de atletas limpa'}]);
tab='Atletas';render();
}
function configHtml(){
return `<section>
<h3>Configuração da liga</h3>
<label>Quantidade de participantes
<select id="capacity" onchange="setCapacity(Number(this.value),this)" ${S.status!=='draft'?'disabled':''}>
${SIZES.map(n=>`<option value="${n}" ${n===capacity()?'selected':''}>${n} atletas</option>`).join('')}
</select></label>
<p class="muted" style="margin-top:12px">${groupIndexes().length} grupos de 4 • ${groupGameCount()} jogos de grupos</p>
<p style="margin-top:8px"><b>Classificação:</b> ${formatRule()}</p>
<p class="muted">16 atletas classificados • 8 duplas nas quartas</p>
</section>`;
}
function group(g){return [0,1,2,3].map(i=>g*4+i)}
const patterns=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
// Jogos do grupo já com quem realmente jogou (substituto no lugar do lesionado a partir do jogo marcado)
function games(g){
  const gs=(S.gsubs||[]);
  const quem=(pos,j)=>{const s=gs.find(x=>x.pos===pos&&x.jogo<=j);return s?s.entra:pos};
  return patterns.map((p,i)=>({id:g+'-'+i,a:p.slice(0,2).map(j=>quem(g*4+j,i)),b:p.slice(2).map(j=>quem(g*4+j,i))}));
}
function grupoDe(i){if(i<capacity())return Math.floor(i/4);const s=(S.gsubs||[]).find(x=>x.entra===i);return s?Math.floor(s.pos/4):-1}
function lesionadosDoGrupo(g){return (S.gsubs||[]).filter(s=>Math.floor(s.pos/4)===g).map(s=>s.pos).sort((a,b)=>a-b)}
// Atletas de fora que entraram no grupo (contam e podem classificar)
function externosDoGrupo(g){return (S.gsubs||[]).filter(s=>Math.floor(s.pos/4)===g&&s.entra>=capacity()).map(s=>s.entra)}
// Quem disputa a classificação do grupo: membros não lesionados + atletas de fora daquele grupo
function membrosDoGrupo(g){const les=lesionadosDoGrupo(g);return [...group(g).filter(i=>!les.includes(i)),...externosDoGrupo(g)]}
function linhasGrupo(g,quem){
  const r=quem.map(i=>({i,w:0,s:0,f:0,j:0}));
  for(const m of games(g)){
    const v=S.scores[m.id];if(!valid(v))continue;
    [m.a,m.b].forEach((p,k)=>p.forEach(i=>{const t=r.find(x=>x.i===i);if(!t)return;t.j++;t.w+=+(v[k]>v[1-k]);t.s+=v[k]-v[1-k];t.f+=v[k]}));
  }
  return r;
}
function name(i){return esc(nomeCompleto(i))}
function rawName(i){return nomeCompleto(i)}
function pair(a){return a.map(name).join(' + ')}
// placar que pode ser lançado: o vencedor precisa ter 6 games ou mais (3x5 não vale)
function placarLancavel(v){return Math.max(...v)>=6}
function valid(v){return Array.isArray(v)&&v.length===2&&v.every(x=>Number.isInteger(x)&&x>=0&&x<=9)&&v[0]!==v[1]}
function rank(g){
  let r=linhasGrupo(g,membrosDoGrupo(g));
  return sorted('g'+g,r);
}
function cmp(a,b){return b.w-a.w||b.s-a.s||b.f-a.f}
function eq(a,b){return cmp(a,b)===0}
function blocks(list){let out=[];for(let x of list){let last=out[out.length-1];if(last&&eq(last[0],x))last.push(x);else out.push([x])}return CONFRONTO_DIRETO?out.flatMap(dividirPorConfronto):out}
// 4º critério nas etapas de temporada: saldo de games nos jogos em que os empatados se enfrentaram
let CONFRONTO_DIRETO=false;
// Etapa especial da temporada (duplas sorteadas da semifinal em diante)
let ESPECIAL=false;
function saldoConfronto(i,bloco){
  let s=0;const g=grupoDe(i);
  for(const m of games(g)){const v=S.scores[m.id];if(!valid(v))continue;
    const k=m.a.includes(i)?0:m.b.includes(i)?1:-1;if(k<0)continue;
    if((k?m.a:m.b).some(y=>y!==i&&bloco.includes(y)))s+=v[k]-v[1-k];}
  return s;
}
function dividirPorConfronto(b){
  if(b.length<2)return [b];
  const ids=b.map(x=>x.i),sd=new Map(b.map(x=>[x.i,saldoConfronto(x.i,ids)]));
  const ord=[...b].sort((p,q)=>sd.get(q.i)-sd.get(p.i));
  const subs=[];for(const x of ord){const l=subs[subs.length-1];if(l&&sd.get(l[0].i)===sd.get(x.i))l.push(x);else subs.push([x])}
  if(subs.length===1)return [b];
  return subs.flatMap(s=>s.length>1?dividirPorConfronto(s):[s]);
}
function key(scope,block){return scope+':'+block.map(x=>x.i).sort((a,b)=>a-b).join(',')}
function order(scope,block){let ids=block.map(x=>x.i),chosen=(S.breaks||{})[key(scope,block)]||[];return chosen.filter(i=>ids.includes(i))}
function sorted(scope,list){return blocks(list.sort(cmp)).flatMap(b=>{let o=order(scope,b);return [...b].sort((a,c)=>(o.includes(a.i)?o.indexOf(a.i):99)-(o.includes(c.i)?o.indexOf(c.i):99)||a.i-c.i)})}
function pending(scope,list,limit=list.length){return blocks(list).some(b=>list.indexOf(b[0])<limit&&b.length>1&&order(scope,b).length<b.length-1)}
function groupDone(g){return games(g).every(m=>valid(S.scores[m.id]))}
function groupPending(){return groupIndexes().some(g=>pending('g'+g,rank(g)))}
function listsGeneral(){let r=groupIndexes().map(rank);return [0,1,2,3].map(k=>sorted('r'+k,r.map(x=>x[k]).filter(Boolean)))}
function tieUI(scope,list,limit=list.length){
  return blocks(list).filter(b=>b.length>1&&list.indexOf(b[0])<limit).map(b=>{
    let o=order(scope,b),left=b.filter(x=>!o.includes(x.i)),done=left.length<=1,k=key(scope,b);
    return `<section class="tie-card ${done?'tie-done':'tie-pending'}"><b>${done?'Desempate resolvido':'EMPATE — precisa resolver'}</b><p style="margin-top:8px">${b.map(x=>name(x.i)).join(' • ')}</p>${o.length?'<p class="muted" style="margin-top:8px">Ordem definida: '+o.map(i=>esc(rawName(i))).join(' → ')+'</p>':''}${done?'<p style="margin-top:8px">Ordem final: '+[...o,...left.map(x=>x.i)].map(i=>esc(rawName(i))).join(' → ')+'</p>':`<p class="muted" style="margin-top:8px">Selecione quem venceu ${left.length===2?'o desempate':'a próxima posição do desempate'}:</p><div class="row" style="margin-top:6px">${left.map(x=>`<button onclick="chooseTie('${k}',${x.i})" ${S.status!=='drawn'?'disabled':''}>${name(x.i)} venceu</button>`).join('')}</div>`}${o.length&&S.status==='drawn'?`<div class="row" style="margin-top:10px"><button class="secondary" onclick="resetTie('${k}')">Refazer desempate</button></div>`:''}</section>`
  }).join('')
}
function escopoTexto(k){return k.startsWith('g')?'Grupo '+'ABCDEFGH'[+k.slice(1,k.indexOf(':'))]:'Ranking dos '+(+k.slice(1,k.indexOf(':'))+1)+'º colocados'}
// W.O. do mata-mata: ids sem '-' (q1, s1, f, t); os dos grupos têm '-' (0-1)
function woMataIds(){return Object.keys(S.wo||{}).filter(x=>!x.includes('-'))}
function limparMata(){S.finals={};S.subs=[];S.sorteioMata={};woMataIds().forEach(x=>delete S.wo[x])}
const DEPENDENTES={q1:['s1','f','t'],q2:['s1','f','t'],q3:['s2','f','t'],q4:['s2','f','t'],s1:['f','t'],s2:['f','t']};
function changeTie(k){
  if(S.status!=='drawn')return false;
  if((Object.keys(S.finals).length||(S.subs||[]).length)&&!confirm('Alterar desempate apagará o mata-mata'+((S.subs||[]).length?' e as substituições':'')+'. Continuar?'))return false;
  limparMata(); S.breaks=S.breaks||{};
  if(k.startsWith('g'))for(let x of Object.keys(S.breaks))if(x.startsWith('r'))delete S.breaks[x];
  return true;
}
function chooseTie(k,i){if(!changeTie(k))return;let o=S.breaks[k]||[];if(!o.includes(i))S.breaks[k]=[...o,i];persist([{tipo:'desempate',descricao:'Desempate manual — '+escopoTexto(k)+': '+rawName(i)+' à frente'}]);render()}
function resetTie(k){if(!changeTie(k))return;delete S.breaks[k];persist([{tipo:'desempate',descricao:'Desempate refeito — '+escopoTexto(k)}]);render()}
function tieRow(scope,list,x,limit=list.length){let b=blocks(list).find(b=>b.some(y=>y.i===x.i));return list.indexOf(b[0])<limit&&b.length>1&&order(scope,b).length<b.length-1?' class="highlight-tie"':''}
function complete(){return groupIndexes().every(g=>games(g).every(m=>valid(S.scores[m.id])))}
// Nome curto para o placar: primeiro nome + inicial do último sobrenome (JEFERSON M.).
// Se dois atletas da liga ficarem iguais, usa o sobrenome inteiro.
function nomesCurtos(){
  const curto=n=>{const p=String(n||'').trim().split(/\s+/);return p.length>1?p[0]+' '+p[p.length-1][0]+'.':p[0]||'?'};
  const longo=n=>{const p=String(n||'').trim().split(/\s+/);return p.length>1?p[0]+' '+p[p.length-1]:p[0]||'?'};
  const todos=[...S.names];[...(S.subs||[]),...(S.gsubs||[])].forEach(s=>{if(s.atleta&&s.entra>=S.names.length)todos[s.entra]=s.atleta.nome});
  for(let i=0;i<todos.length;i++)if(todos[i]===undefined)todos[i]='';
  const c=todos.map(curto),cont={};c.forEach(x=>cont[x.toLowerCase()]=(cont[x.toLowerCase()]||0)+1);
  return c.map((x,i)=>cont[x.toLowerCase()]>1?longo(todos[i]):x);
}
function scorecard(m,kind='scores',extraClass=''){
  const v=S[kind][m.id]||[],nc=nomesCurtos(),lancado=valid(v),venc=lancado?(v[0]>v[1]?0:1):-1;
  const dupla=p=>p.map(i=>esc(nc[i])).join(' / ');
  const linha=(lado,k,next)=>`<div class="placar-linha${venc===k?' venceu':''}"><div class="placar-nome" title="${esc(lado.map(rawName).join(' / '))}">${dupla(lado)}</div><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" id="${k?'b':'a'}${m.id}" value="${v[k]??''}" oninput="digitarPlacar(this,'${m.id}','${kind}',${k})" onfocus="this.select()" aria-label="Games de ${esc(lado.map(rawName).join(' e '))}"></div>`;
  const wo=(S.wo||{})[m.id],ehWO=lancado&&(wo===0||wo===1);
  let extra='';
  if(ehWO)extra=`<p class="muted" style="margin-top:6px">W.O.: ${dupla(wo?m.b:m.a)} não ${kind==='scores'?'terminou o jogo':'jogou'}.</p>`;
  else if(!lancado&&(kind==='scores'?podeLancarGrupo():podeMexerNoMata()))extra=`<div class="row" style="margin-top:8px"><button class="ghost" style="padding:6px 10px;font-size:13px;min-height:0" data-wo="${m.id}" onclick="abrirWO('${m.id}')">🚑 Lesão / W.O.</button></div>`;
  return `<div class="match-card ${extraClass}"><div class="row" style="justify-content:space-between;align-items:center"><div class="match-label">${esc(jogoTexto(m.id,kind))}</div><span class="placar-status ${lancado?'ok':'muted'}" id="st${m.id}">${lancado?(ehWO?'✓ W.O.':'✓ salvo'):'sem placar'}</span></div>
   <div class="placar">${linha(m.a,0)}${linha(m.b,1)}</div>${extra}</div>`;
}
function placeholderCard(label,text){return `<div class="match-card placeholder"><div><div class="match-label">${label}</div><div>${text}</div></div></div>`}
function digit(el,next){el.value=el.value.replace(/[^0-9]/g,'').slice(0,1);if(el.value&&next){let n=$(next);if(n){n.focus();n.select()}}}
function jogoTexto(id,k){if(k==='scores'){const [g,j]=id.split('-');return 'Grupo '+'ABCDEFGH'[+g]+', jogo '+(+j+1)}return {f:'Final',t:'Disputa de 3º'}[id]||id.toUpperCase()}
// Placar salva sozinho: com os dois campos preenchidos grava; com os dois vazios apaga.
const placarTimers={};
function digitarPlacar(el,id,k,lado){
  el.value=el.value.replace(/[^0-9]/g,'').slice(-1);
  if(lado===0&&el.value){const n=$('b'+id);if(n&&n.value===''){n.focus();n.select()}}
  clearTimeout(placarTimers[id]);
  const st=$('st'+id),a=$('a'+id).value,b=$('b'+id).value;
  if(st){
    if(a!==''&&b!==''&&a===b){st.textContent='não existe empate';st.className='placar-status warn';return}
    if(a!==''&&b!==''&&!placarLancavel([+a,+b])){st.textContent='o vencedor precisa ter 6 games';st.className='placar-status warn';return}
    if((a==='')!==(b==='')){st.textContent='complete o placar';st.className='placar-status muted';return}
  }
  placarTimers[id]=setTimeout(()=>salvarPlacar(id,k,lado===1),a!==''&&b!==''?250:700);
}
function salvarPlacar(id,k,avancar){
  const ea=$('a'+id),eb=$('b'+id);if(!ea||!eb)return;
  const a=ea.value,b=eb.value;
  let novo;
  if(a===''&&b==='')novo=null;
  else if(a!==''&&b!==''&&valid([+a,+b]))novo=[+a,+b];
  else return;
  const ok=aplicarPlacar(id,k,novo);
  const antes=S[k][id];
  if(!ok){const v=S[k][id]||[];ea.value=v[0]??'';eb.value=v[1]??'';const st=$('st'+id);if(st){st.textContent=valid(v)?'✓ salvo':'sem placar';st.className='placar-status '+(valid(v)?'ok':'muted')}return}
  render();
  if(avancar&&novo){
    // vai para o próximo jogo ainda sem placar
    const campos=[...document.querySelectorAll('.placar input')];
    const k0=campos.findIndex(x=>x.id==='b'+id);
    const prox=campos.slice(k0+1).find(x=>x.id.startsWith('a')&&x.value===''&&!x.disabled);
    if(prox)prox.focus();
  }
}
function aplicarPlacar(id,k,novo,wo){
  if(S.status!=='drawn'){alert('Lançamentos bloqueados.');return false}
  if(novo&&!placarLancavel(novo)){alert('Placar inválido: o vencedor precisa ter 6 games ou mais.');return false}
  const antes=S[k][id];
  if(JSON.stringify(antes??null)===JSON.stringify(novo)&&(S.wo||{})[id]===wo)return false;
  if(k==='finals'&&!S.ordemChave)S.ordemChave=Object.keys(S.finals).length?'antiga':'planilha';
  if(k==='scores'){if((Object.keys(S.finals).length||(S.subs||[]).length||woMataIds().length)&&!confirm('Alterar a fase de grupos apagará o mata-mata'+((S.subs||[]).length?' e as substituições':'')+'. Continuar?'))return false;limparMata()}
  if(k==='finals')(DEPENDENTES[id]||[]).forEach(x=>{delete S.finals[x];if(S.wo)delete S.wo[x];if(S.sorteioMata)delete S.sorteioMata[x]});
  if(k==='scores'){for(let x of Object.keys(S.breaks||{}))if(x.startsWith('r')||x.startsWith('g'+id.split('-')[0]+':'))delete S.breaks[x];}
  if(novo)S[k][id]=novo;else delete S[k][id];
  S.wo=S.wo||{};if(novo&&(wo===0||wo===1))S.wo[id]=wo;else delete S.wo[id];
  persist([{tipo:'placar',descricao:jogoTexto(id,k)+': '+(novo?novo[0]+'×'+novo[1]:'placar apagado')+(novo&&(wo===0||wo===1)?' (W.O.)':'')+(valid(antes)?' (antes '+antes[0]+'×'+antes[1]+')':'')}]);
  return true;
}
/* ---------- Sorteio dos grupos sem repetir quem já caiu junto ---------- */
// Busca as ligas anteriores (já sorteadas) e devolve a lista de grupos de cada uma,
// da mais recente para a mais antiga. Só conta atletas ligados ao cadastro.
async function historicoDeGrupos(limite=6){
  if(L.temporada_id)limite=60;
  const consulta=L.temporada_id
    ?sb.from('ligas').select('id,data,criado_em,excluida_em,dados').eq('temporada_id',L.temporada_id).lt('etapa_numero',L.etapa_numero).order('etapa_numero',{ascending:false})
    :sb.from('ligas').select('id,data,criado_em,excluida_em,dados').neq('id',L.id).lte('data',L.data).order('data',{ascending:false}).order('criado_em',{ascending:false}).limit(40);
  const {data,error}=await consulta;
  if(error)throw error;
  const out=[];
  for(const r of data){
    if(r.excluida_em)continue;
    const d=r.dados||{};
    if(!d.drawn||!Array.isArray(d.ids)||!Array.isArray(d.names))continue;
    const grupos=[];for(let g=0;g<d.ids.length/4;g++)grupos.push(d.ids.slice(g*4,g*4+4).filter(Boolean));
    out.push(grupos);
    if(out.length>=limite)break;
  }
  return out;
}
// Peso de cada par que já caiu no mesmo grupo: a liga mais recente pesa mais.
function pesosDeRepeticao(hist){
  const w=new Map(),n=hist.length;
  hist.forEach((grupos,k)=>{const peso=2**(n-1-k);for(const g of grupos)for(let a=0;a<g.length;a++)for(let b=a+1;b<g.length;b++){const c=g[a]<g[b]?g[a]+'|'+g[b]:g[b]+'|'+g[a];w.set(c,(w.get(c)||0)+peso)}});
  return w;
}
function custoGrupos(ordem,ids,w){
  let c=0,rep=0;
  for(let g=0;g<ordem.length;g+=4)for(let a=g;a<g+4;a++)for(let b=a+1;b<g+4;b++){
    const x=ids[ordem[a]],y=ids[ordem[b]];if(!x||!y)continue;
    const v=w.get(x<y?x+'|'+y:y+'|'+x);if(v){c+=v;rep++}
  }
  return {c,rep};
}
// Várias tentativas aleatórias + trocas entre grupos; fica com a de menor repetição.
function melhorSorteio(ids,w){
  const n=ids.length,emb=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  let melhor=null;
  for(let t=0;t<60;t++){
    const o=emb([...Array(n).keys()]);let atual=custoGrupos(o,ids,w).c;
    for(let melhorou=true;melhorou&&atual>0;){
      melhorou=false;
      for(const i of emb([...Array(n).keys()]))for(let j=0;j<n;j++){
        if((i>>2)===(j>>2))continue;
        [o[i],o[j]]=[o[j],o[i]];const c=custoGrupos(o,ids,w).c;
        if(c<atual){atual=c;melhorou=true}else[o[i],o[j]]=[o[j],o[i]];
      }
    }
    if(!melhor||atual<melhor.c)melhor={o:[...o],c:atual};
    if(melhor.c===0)break;
  }
  // embaralha a ordem dos grupos e dentro de cada grupo (não muda quem está junto)
  const grupos=emb(Array.from({length:n/4},(_,g)=>emb(melhor.o.slice(g*4,g*4+4))));
  return grupos.flat();
}
async function shuffle(){
  if(S.status!=='started'||S.drawn)return alert('Sorteio indisponível.');
  if(ocupado)return;
  if(!confirm('Confirmar sorteio único desta liga?\n\nO sorteio evita colocar no mesmo grupo atletas que já jogaram juntos no grupo nas ligas anteriores.'))return;
  ocupado=true;
  let hist=[];
  try{hist=await historicoDeGrupos()}
  catch(e){
    if(!confirm('Não foi possível ler as ligas anteriores ('+traduzErro(e)+').\n\nSortear sem evitar repetições?')){ocupado=false;return}
  }
  ocupado=false;
  if(S.status!=='started'||S.drawn)return;
  const w=pesosDeRepeticao(hist);
  const ordem=melhorSorteio(S.ids,w);
  const {rep}=custoGrupos(ordem,S.ids,w);
  S.names=ordem.map(i=>S.names[i]);S.ids=ordem.map(i=>S.ids[i]);
  S.scores={};S.finals={};S.drawn=true;S.status='drawn';delete S.breaks;
  const desc='Sorteio dos grupos realizado'+(hist.length?' — considerou '+hist.length+' liga(s) anterior(es); '+(rep?rep+' dupla(s) de atletas repetiram grupo (não havia como evitar)':'nenhum atleta repetiu grupo'):' — sem ligas anteriores para comparar');
  persist([{tipo:'sorteio',descricao:desc}]);
  render();
  if(hist.length)alert(rep?'Sorteio feito. Não foi possível evitar tudo: '+rep+' dupla(s) de atletas repetiram grupo de ligas anteriores (as repetições mais antigas foram as escolhidas).':'Sorteio feito. Ninguém caiu no mesmo grupo de quem já tinha jogado junto nas últimas '+hist.length+' liga(s).');
}
function winner(m){return S.finals[m.id][0]>S.finals[m.id][1]?m.a:m.b}
function loser(m){return S.finals[m.id][0]>S.finals[m.id][1]?m.b:m.a}
function startLeague(){
  if(S.status!=='draft')return;
  if(!SIZES.includes(capacity())||S.names.some(n=>!n.trim())||new Set(S.names.map((n,i)=>S.ids[i]||normNome(n))).size!==capacity())return alert('Selecione '+capacity()+' atletas diferentes na aba Atletas.');
  if(!confirm('Iniciar liga e bloquear a lista de atletas?'))return;
  S.status='started';
  persist([{tipo:'inicio',descricao:'Liga iniciada (cadastro bloqueado)'}]);
  tab='Grupos'; render();
}
function endLeague(){
  if(!['started','drawn'].includes(S.status))return;
  let done=complete()&&['q1','q2','q3','q4','s1','s2','f','t'].every(k=>valid(S.finals[k]));
  if(!confirm(done?'Encerrar liga e bloquear resultados?':'A liga está incompleta. Encerrar mesmo assim?'))return;
  S.status='ended';
  persist([{tipo:'finalizacao',descricao:done?'Liga finalizada':'Liga encerrada incompleta'}]);
  render();
}
function corrigirResultados(){
  if(S.status!=='ended'||L.status==='arquivada')return;
  const motivo=prompt('Correção administrativa de liga finalizada.\nInforme o motivo (fica registrado no histórico):');
  if(!motivo||!motivo.trim())return;
  S.status=S.drawn?'drawn':'started';
  persist([{tipo:'reabertura',descricao:'Liga reaberta para correção'}],motivo.trim());
  render();
}
function statusText(d){d=d||S;return {draft:'Não iniciada',started:'Iniciada — aguardando sorteio',drawn:'Em andamento — sorteio bloqueado',ended:'Encerrada'}[d.status]}
function totalGroupGames(){return groupIndexes().flatMap(g=>games(g)).filter(m=>valid(S.scores[m.id])).length}
function totalFinalGames(){return Object.values(S.finals).filter(valid).length}
function progressSummary(){
  if(S.status==='draft')return 'Cadastre ou revise os atletas e inicie a liga.';
  if(S.status==='started')return 'Liga iniciada. Falta realizar o sorteio único dos grupos.';
  if(S.status==='drawn'&&!complete())return `Fase de grupos em andamento: ${totalGroupGames()}/${groupGameCount()} jogos lançados.`;
  if(S.status==='drawn'&&complete())return `Grupos concluídos. Mata-mata: ${totalFinalGames()}/8 jogos lançados.`;
  return 'Liga encerrada. Resultados preservados para consulta.';
}
function heroActionHtml(){
  if(S.status==='draft')return '<button onclick="startLeague()">INICIAR LIGA</button>';
  if(S.status==='started')return '<button onclick="tab=\'Grupos\';render()">IR PARA O SORTEIO</button>';
  if(S.status==='drawn'&&!complete())return '<button onclick="tab=\'Jogos\';render()">LANÇAR JOGOS</button>';
  if(S.status==='drawn'&&complete())return '<button onclick="tab=\'Mata-mata\';render()">IR PARA O MATA-MATA</button>';
  return '<button onclick="tab=\'Chave\';render()">VER CHAVE</button>';
}
function renderHome(){
  return `<section><h2>Painel da Liga</h2><p class="muted">${progressSummary()}</p><div class="quick-box"><div class="quick-item"><div class="muted">Status</div><div class="v">${statusText()}</div></div><div class="quick-item"><div class="muted">Jogos dos grupos</div><div class="v">${totalGroupGames()} / ${groupGameCount()}</div></div><div class="quick-item"><div class="muted">Mata-mata</div><div class="v">${totalFinalGames()} / 8</div></div></div><div class="hero-actions">${heroActionHtml()}<button class="secondary" onclick="tab='Atletas';render()">ATLETAS</button><button class="secondary" onclick="tab='Classificação';render()">CLASSIFICAÇÃO</button></div></section><section><h2>Fluxo da competição</h2><div class="grid-4"><div class="kpi"><div class="muted">1</div><div class="name">Cadastre</div><div class="muted">Confira os ${capacity()} inscritos</div></div><div class="kpi"><div class="muted">2</div><div class="name">Inicie e sorteie</div><div class="muted">Sorteio único com trava</div></div><div class="kpi"><div class="muted">3</div><div class="name">Lance os grupos</div><div class="muted">${groupGameCount()} jogos + desempates</div></div><div class="kpi"><div class="muted">4</div><div class="name">Feche a chave</div><div class="muted">Quartas, semi, final e 3º</div></div></div></section><section><h2>Atletas inscritos</h2><div class="list-card inscritos">${S.names.map((n,i)=>`<div>${String(i+1).padStart(2,'0')} • <span class="name">${esc(n)||'<span class="muted">(vago)</span>'}</span></div>`).join('')}</div></section>`;
}
function renderGroups(){
  let h=`<section><h2>Grupos</h2><p class="muted">Para evitar sorteios acidentais, o sistema só libera o sorteio após iniciar a liga. Depois de sortear, o sorteio fica travado.</p><div class="panel-actions"><button onclick="shuffle()" ${S.status!=='started'||S.drawn?'disabled':''}>${S.drawn?'Sorteio realizado — bloqueado':'Sortear grupos'}</button><button class="secondary" onclick="tab='Jogos';render()" ${!S.drawn?'disabled':''}>Ir para jogos</button></div><p class="muted" style="margin-top:10px">${S.drawn?'Sorteio concluído.':'Grupos ainda não sorteados: abaixo está a ordem atual dos atletas.'}</p></section>`;
  for(let g=0;g<groupIndexes().length;g++)h+=`<section><h3>Grupo ${'ABCDEFGH'[g]}</h3><div class="group-list" style="margin-top:8px">${group(g).map((i,pos)=>`<div>${pos+1}. <span class="name">${name(i)}</span></div>`).join('')}</div></section>`;
  return h;
}
// Avisos de substituto no grupo, com Desfazer enquanto os jogos dele não têm placar
function avisosSubGrupo(g){
  return (S.gsubs||[]).map((s,k)=>({s,k})).filter(({s})=>grupoDe(s.pos)===g).map(({s,k})=>{
    const livre=podeLancarGrupo()&&![0,1,2].some(j=>j>=s.jogo&&valid(S.scores[g+'-'+j]));
    return `<p class="muted" style="margin-top:8px;font-size:13px">↺ ${esc(rawName(s.entra))} joga no lugar de ${esc(rawName(s.pos))} (${esc(s.motivo)}) a partir do jogo ${s.jogo+1}${s.atleta?'':' — da liga, não pontua'}${livre?` <button class="ghost" style="padding:4px 10px;font-size:13px;min-height:0" data-desfazer-grupo="${k}" onclick="desfazerGrupoTela(${k})">Desfazer</button>`:''}</p>`;
  }).join('');
}
function renderGroupGames(){
  if(!S.drawn)return `<section><h2>Jogos</h2><p class="muted">Realize o sorteio na aba Grupos antes de lançar os placares.</p><div class="panel-actions"><button onclick="tab='Grupos';render()">Ir para grupos</button></div></section>`;
  let h=`<section><h2>Jogos de grupos</h2><p class="muted">${totalGroupGames()}/${groupGameCount()} jogos concluídos. Informe dois placares inteiros diferentes. Não existe empate no jogo.</p><div class="panel-actions"><button class="secondary" onclick="abrirImagemJogos('grupos')">🖼 Imagem / 🖨 Imprimir</button></div></section>`;
  for(let g=0;g<groupIndexes().length;g++)h+=`<section><h3>Grupo ${'ABCDEFGH'[g]}</h3>${avisosSubGrupo(g)}<div class="round-stack" style="margin-top:10px">${games(g).map((m,i)=>scorecard(m,'scores','') ).join('')}</div></section>`;
  return h;
}
function renderClassification(){
  let h=`<section><h2>Classificação individual</h2><p class="muted">V = vitórias • SG = saldo de games • GP = games pró.${CONFRONTO_DIRETO?' Etapa de temporada: o 4º critério é o confronto direto (saldo de games nos jogos entre os empatados).':''} Quando houver empate absoluto, os atletas ficam destacados para você definir o desempate manualmente.</p></section>`;
  for(let g=0;g<groupIndexes().length;g++){
    let r=rank(g);
    h+=`<section><h3>Grupo ${'ABCDEFGH'[g]}</h3><table><tr><th>Atleta</th><th>J</th><th>V</th><th>SG</th><th>GP</th></tr>${r.map((x,i)=>`<tr${groupDone(g)?tieRow('g'+g,r,x):''}><td>${i+1}. ${name(x.i)}</td><td>${x.j}</td><td>${x.w}</td><td>${x.s}</td><td>${x.f}</td></tr>`).join('')}${linhasGrupo(g,lesionadosDoGrupo(g)).map(x=>`<tr class="muted"><td>🚑 ${name(x.i)} <small>(lesionado — não classifica)</small></td><td>${x.j}</td><td>${x.w}</td><td>${x.s}</td><td>${x.f}</td></tr>`).join('')}</table>${groupDone(g)?tieUI('g'+g,r):'<p class="muted" style="margin-top:10px">Aguardando os 3 jogos deste grupo.</p>'}</section>`;
  }
  return h;
}
function duoCards(duos){
  const pode=podeMexerNoMata(),bt='style="padding:6px 10px;font-size:13px;min-height:0"';
  return `<section><h2>Duplas formadas</h2>${pode?'<p class="muted">Atleta machucado? Use Substituir antes de a dupla jogar. Depois disso, use o W.O. no jogo.</p>':''}<div class="duos">${duos.map((p,i)=>{
    const livre=pode&&!duplaTemPlacar(i);
    const trocas=(S.subs||[]).map((s,k)=>({s,k})).filter(({s})=>p.includes(s.entra));
    return `<div class="duo-card"><div class="match-label">D${i+1}</div><div class="name">${pair(p)}</div>${trocas.map(({s,k})=>`<div class="muted" style="margin-top:6px;font-size:13px">↺ ${esc(rawName(s.entra))} entrou no lugar de ${esc(rawName(s.sai))} (${esc(s.motivo)})${livre?` <button class="ghost" ${bt} data-desfazer="${k}" onclick="desfazerSubstituicao(${k})">Desfazer</button>`:''}</div>`).join('')}${livre?`<div class="row" style="margin-top:8px"><button class="secondary" ${bt} data-sub="${i}" onclick="abrirSubstituicao(${i})">Substituir</button></div>`:''}</div>`}).join('')}</div></section>`}
/* ---------- Substituição (lesão) e W.O. no mata-mata ---------- */
function podeMexerNoMata(){return S.status==='drawn'&&!(L&&L.status==='arquivada')}
// Quem pode entrar: eliminados da liga (melhor primeiro) e atletas ativos do cadastro que não estão na liga
function opcoesEntrada(){
  const c=classificadosGerais();if(!c)return {fora:[],cadastro:[]};
  const usados=new Set([...(S.ids||[]).filter(Boolean),...c.duos.flat().map(idDe).filter(Boolean)]);
  const cadastro=atletas.filter(a=>a.situacao!=='inativo'&&!usados.has(a.id)).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  return {fora:c.fora,cadastro};
}
// Faz a troca. Devolve null se deu certo ou o texto do problema.
function substituir(d,sai,sel,motivo){
  if(!podeMexerNoMata())return 'Lançamentos bloqueados.';
  const c=classificadosGerais();if(!c)return 'A chave do mata-mata ainda não está formada.';
  if(!c.duos[d]||!c.duos[d].includes(sai))return 'Escolha quem sai da dupla.';
  if(duplaTemPlacar(d))return 'Esta dupla já jogou no mata-mata. Use o W.O.';
  const op=opcoesEntrada();let entra,atleta=null;
  if(/^i:\d+$/.test(sel||'')){entra=+sel.slice(2);if(!op.fora.includes(entra))return 'Este atleta não pode entrar: já está no mata-mata.'}
  else if(/^a:./.test(sel||'')){
    const a=op.cadastro.find(x=>x.id===sel.slice(2));if(!a)return 'Este atleta não pode entrar: já está na liga ou no mata-mata.';
    entra=Math.max(capacity()-1,...(S.subs||[]).map(s=>s.entra))+1;atleta={id:a.id,nome:a.nome};
  }else return 'Escolha quem entra.';
  const m=String(motivo||'').trim().slice(0,60)||'lesão',nomeSai=rawName(sai);
  S.subs=[...(S.subs||[]),{sai,entra,atleta,motivo:m,em:new Date().toISOString()}];
  persist([{tipo:'substituicao',descricao:`Substituição D${d+1}: Sai ${nomeSai} (${m}) → Entra ${rawName(entra)}`}]);
  return null;
}
function abrirSubstituicao(d){
  const c=classificadosGerais();if(!c||!podeMexerNoMata())return;
  if(duplaTemPlacar(d))return alert('Esta dupla já jogou no mata-mata. Use o W.O.');
  const p=c.duos[d],op=opcoesEntrada(),st=new Map(listsGeneral().flat().map(x=>[x.i,x]));
  const info=i=>{const x=st.get(i);return x?` — ${x.w}V, saldo ${x.s>0?'+':''}${x.s}`:''};
  const opcoes=(op.fora.length?`<optgroup label="Eliminados da liga (melhor primeiro)">${op.fora.map((i,k)=>`<option value="i:${i}">${k===0?'⭐ ':''}${name(i)}${info(i)}</option>`).join('')}</optgroup>`:'')+(op.cadastro.length?`<optgroup label="Outros atletas do cadastro">${op.cadastro.map(a=>`<option value="a:${esc(a.id)}">${esc(a.nome)}</option>`).join('')}</optgroup>`:'');
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Substituir atleta — D${d+1}</h2>
   <p class="muted">Quem entra fica no mesmo lugar da chave, com o mesmo parceiro. Os jogos dos grupos não mudam.</p>
   <p style="margin-top:12px"><b>Quem sai</b></p>
   <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:4px">${p.map((i,k)=>`<label style="flex-direction:row;align-items:center;gap:6px"><input type="radio" name="subSai" value="${i}" ${k===0?'checked':''} onchange="previaSub()" style="width:20px;height:20px">${name(i)}</label>`).join('')}</div>
   ${opcoes?`<label style="margin-top:12px">Quem entra<select id="subEntra" onchange="previaSub()">${opcoes}</select></label>
   <label style="margin-top:10px">Motivo<input id="subMotivo" value="lesão" maxlength="60" oninput="previaSub()"></label>
   <p id="subPrevia" class="tag" style="margin-top:12px"></p>`:'<p class="tag" style="margin-top:12px">Não há atleta disponível para entrar. Cadastre o atleta na aba Atletas do menu principal.</p>'}
   <div class="panel-actions">${opcoes?`<button onclick="aplicarSubstituicao(${d})">CONFIRMAR TROCA</button>`:''}<button class="secondary" onclick="fecharModal()">Cancelar</button></div></div></div>`;
  previaSub();
}
function nomeDaOpcao(v){if(/^i:/.test(v))return rawName(+v.slice(2));const a=atletas.find(x=>x.id===v.slice(2));return a?a.nome:''}
function previaSub(){
  const el=$('subPrevia'),r=document.querySelector('input[name=subSai]:checked'),sel=$('subEntra');if(!el||!r||!sel)return;
  el.textContent=`Sai ${rawName(+r.value)} (${($('subMotivo').value.trim()||'lesão')}) → Entra ${nomeDaOpcao(sel.value)}`;
}
function aplicarSubstituicao(d){
  const r=document.querySelector('input[name=subSai]:checked'),sel=$('subEntra');
  const erro=substituir(d,r?+r.value:-1,sel?sel.value:'',$('subMotivo')?$('subMotivo').value:'lesão');
  if(erro)return alert(erro);
  fecharModal();render();
}
function desfazerSubstituicao(k){
  const s=(S.subs||[])[k];if(!s||!podeMexerNoMata())return;
  const c=classificadosGerais(),d=c?c.duos.findIndex(p=>p.includes(s.entra)):-1;
  if(d>=0&&duplaTemPlacar(d))return alert('Esta dupla já jogou no mata-mata. Não dá para desfazer a troca.');
  if(S.subs.slice(k+1).some(x=>x.sai===s.entra))return alert('Desfaça antes a troca feita depois desta.');
  if(!confirm(`Desfazer a troca? ${rawName(s.sai)} volta para a dupla no lugar de ${rawName(s.entra)}.`))return;
  const desc=`Substituição desfeita: ${rawName(s.sai)} volta no lugar de ${rawName(s.entra)}`;
  S.subs=S.subs.filter((_,i)=>i!==k);
  persist([{tipo:'substituicao',descricao:desc}]);render();
}
/* ---------- W.O. (lesão durante o jogo ou dupla que não pode jogar) ---------- */
// Quem saiu fica com os games que tinha; o adversário fica com 6 (7 na final/3º se quem saiu tinha 6).
function podeLancarGrupo(){return S.status==='drawn'&&!(L&&L.status==='arquivada')}
function maxGamesWO(id){return id==='f'||id==='t'?6:5}
function jogoPorId(id){
  if(id.includes('-')){const [g,j]=id.split('-').map(Number);return games(g)[j]||null}
  const c=chaveAtual();return c&&[...c.qs,...c.ss,c.f,c.t].find(x=>x&&x.id===id)||null;
}
function marcarWO(id,lado,gm=0){
  const kind=id.includes('-')?'scores':'finals';
  if(kind==='scores'?!podeLancarGrupo():!podeMexerNoMata())return false;
  if(!jogoPorId(id)||(lado!==0&&lado!==1))return false;
  gm=Number(gm);if(!Number.isInteger(gm)||gm<0||gm>maxGamesWO(id))return false;
  const alvo=gm===6?7:6;
  return aplicarPlacar(id,kind,lado?[alvo,gm]:[gm,alvo],lado);
}
// Atletas que podem entrar nos próximos jogos de quem se machucou no grupo g
function opcoesGrupo(g){
  const usados=new Set([...(S.ids||[]).filter(Boolean),...[...(S.subs||[]),...(S.gsubs||[])].map(s=>s.atleta&&s.atleta.id).filter(Boolean)]);
  const cadastro=atletas.filter(a=>a.situacao!=='inativo'&&!usados.has(a.id)).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  const les=(S.gsubs||[]).map(s=>s.pos);
  const liga=S.names.map((_,i)=>i).filter(i=>grupoDe(i)!==g&&!les.includes(i)).sort((a,b)=>rawName(a).localeCompare(rawName(b),'pt-BR'));
  return {cadastro,liga};
}
function substituirNoGrupo(pos,jogo,sel,motivo){
  if(!podeLancarGrupo())return 'Lançamentos bloqueados.';
  if(!Number.isInteger(pos)||pos<0||pos>=capacity())return 'Posição inválida.';
  if(!Number.isInteger(jogo)||jogo<0||jogo>2)return 'Era o último jogo dele no grupo: não precisa de substituto.';
  const g=grupoDe(pos);
  if((S.gsubs||[]).some(s=>s.pos===pos))return 'Este atleta já tem substituto no grupo.';
  for(let j=jogo;j<3;j++)if(valid(S.scores[g+'-'+j]))return 'Os próximos jogos dele já têm placar. Apague o placar antes.';
  const op=opcoesGrupo(g);let entra,atleta=null;
  if(/^i:\d+$/.test(sel||'')){entra=+sel.slice(2);if(entra===pos||grupoDe(entra)===g)return 'O substituto da liga tem que ser de outro grupo.';if(!op.liga.includes(entra))return 'Este atleta não pode entrar.'}
  else if(/^a:./.test(sel||'')){const a=op.cadastro.find(x=>x.id===sel.slice(2));if(!a)return 'Este atleta não pode entrar: já está na liga.';entra=proximoVirtual();atleta={id:a.id,nome:a.nome}}
  else return 'Escolha quem entra.';
  const m=String(motivo||'').trim().slice(0,60)||'lesão',nomeSai=rawName(pos);
  S.gsubs=[...(S.gsubs||[]),{pos,jogo,entra,atleta,motivo:m,em:new Date().toISOString()}];
  persist([{tipo:'substituicao',descricao:`Substituição no Grupo ${'ABCDEFGH'[g]}: Sai ${nomeSai} (${m}) → Entra ${rawName(entra)}${atleta?'':' (da liga, não pontua)'} a partir do jogo ${jogo+1}`}]);
  return null;
}
function desfazerGrupo(k){
  const s=(S.gsubs||[])[k];if(!s||!podeLancarGrupo())return 'Lançamentos bloqueados.';
  const g=grupoDe(s.pos);
  for(let j=s.jogo;j<3;j++)if(valid(S.scores[g+'-'+j]))return 'Os jogos com o substituto já têm placar. Apague esses placares antes de desfazer.';
  const desc=`Substituição desfeita no Grupo ${'ABCDEFGH'[g]}: ${rawName(s.pos)} volta no lugar de ${rawName(s.entra)}`;
  S.gsubs=S.gsubs.filter((_,i)=>i!==k);
  persist([{tipo:'substituicao',descricao:desc}]);
  return null;
}
function desfazerGrupoTela(k){
  const s=(S.gsubs||[])[k];if(!s)return;
  if(!confirm(`Desfazer? ${rawName(s.pos)} volta a jogar no lugar de ${rawName(s.entra)}.`))return;
  const e=desfazerGrupo(k);if(e)alert(e);render();
}
function abrirWO(id){
  const kind=id.includes('-')?'scores':'finals',m=jogoPorId(id);if(!m)return;
  const grupo=kind==='scores',g=grupo?+id.split('-')[0]:-1,j=grupo?+id.split('-')[1]:-1,max=maxGamesWO(id);
  const jogadores=grupo?[...m.a,...m.b]:[];
  const op=grupo?opcoesGrupo(g):null;
  const opcoes=grupo&&j<2?`<option value="">Ninguém por enquanto</option>`+(op.cadastro.length?`<optgroup label="De fora (cadastro) — soma e pode classificar">${op.cadastro.map(a=>`<option value="a:${esc(a.id)}">${esc(a.nome)}</option>`).join('')}</optgroup>`:'')+(op.liga.length?`<optgroup label="Da liga (outro grupo) — não pontua">${op.liga.map(i=>`<option value="i:${i}">${name(i)} — Grupo ${'ABCDEFGH'[grupoDe(i)]}</option>`).join('')}</optgroup>`:''):'';
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>W.O. — ${esc(jogoTexto(id,kind))}</h2>
   <p class="muted">Quem saiu fica com os games que tinha e o adversário fica com ${max===6?'6 (7 se quem saiu tinha 6)':'6'}. Se a dupla nem entrou em quadra, deixe 0.</p>
   <p style="margin-top:12px"><b>${grupo?'Quem se machucou':'Qual dupla não pode continuar'}</b></p>
   <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">${grupo?jogadores.map((i,k)=>`<label style="flex-direction:row;align-items:center;gap:8px"><input type="radio" name="woQuem" value="${i}" data-lado="${k<2?0:1}" ${k===0?'checked':''} onchange="previaWO('${id}')" style="width:20px;height:20px">${name(i)}</label>`).join(''):[m.a,m.b].map((p,k)=>`<label style="flex-direction:row;align-items:center;gap:8px"><input type="radio" name="woQuem" value="${k}" data-lado="${k}" ${k===0?'checked':''} onchange="previaWO('${id}')" style="width:20px;height:20px">${esc(wDupla(p))}</label>`).join('')}</div>
   <label style="margin-top:12px">Games ${grupo?'da dupla dele':'dessa dupla'} até parar<input id="woGames" type="number" inputmode="numeric" min="0" max="${max}" value="0" oninput="previaWO('${id}')"></label>
   ${opcoes?`<label style="margin-top:12px">Quem joga os próximos jogos dele<select id="woEntra" onchange="previaWO('${id}')">${opcoes}</select></label>
   <div class="panel-actions" style="margin-top:6px"><button class="secondary" onclick="novoAtletaParaWO('${id}')">+ Cadastrar atleta novo</button></div>`:''}
   <p id="woPrevia" class="tag" style="margin-top:12px"></p>
   <div class="panel-actions"><button onclick="confirmarWO('${id}')">CONFIRMAR W.O.</button><button class="secondary" onclick="fecharModal()">Cancelar</button></div></div></div>`;
  previaWO(id);
}
function previaWO(id){
  const el=$('woPrevia'),r=document.querySelector('input[name=woQuem]:checked'),m=jogoPorId(id);if(!el||!r||!m)return;
  const lado=+r.dataset.lado,gm=+$('woGames').value,max=maxGamesWO(id);
  if(!Number.isInteger(gm)||gm<0||gm>max){el.textContent=`Games: de 0 a ${max}.`;return}
  const alvo=gm===6?7:6,v=lado?[alvo,gm]:[gm,alvo];
  let t=`Placar: ${wDupla(m.a)} ${v[0]} x ${v[1]} ${wDupla(m.b)} (W.O.)`;
  const s=$('woEntra');if(s&&s.value)t+=` • Próximos jogos: ${rawName(+r.value)} → ${s.value.startsWith('i:')?rawName(+s.value.slice(2))+' (não pontua)':(atletas.find(a=>a.id===s.value.slice(2))||{}).nome}`;
  el.textContent=t;
}
function novoAtletaParaWO(id){
  abrirAtletaForm(null,'',a=>{abrirWO(id);const s=$('woEntra');if(s&&a&&[...s.options].some(o=>o.value==='a:'+a.id)){s.value='a:'+a.id;previaWO(id)}});
}
function confirmarWO(id){
  const r=document.querySelector('input[name=woQuem]:checked');if(!r)return;
  const lado=+r.dataset.lado,gm=+$('woGames').value,s=$('woEntra');
  if(!marcarWO(id,lado,gm))return alert(`Confira os games (de 0 a ${maxGamesWO(id)}).`);
  if(s&&s.value){
    const g=+id.split('-')[0],j=+id.split('-')[1],quem=+r.value;
    const pos=quem<capacity()&&grupoDe(quem)===g?quem:-1;
    const e=pos<0?'Só dá para colocar substituto para atleta do próprio grupo.':substituirNoGrupo(pos,j+1,s.value,'lesão');
    if(e)alert('O W.O. foi lançado, mas o substituto não: '+e);
  }
  fecharModal();render();
}
// Chave na tela, espelhada como na imagem/impressão: Q1, Q2 e S1 à esquerda; Q3, Q4 e S2 à direita;
// final e 3º lugar no centro. Sem chave formada, mostra o cruzamento (quem enfrenta quem).
function renderBracket(c){
 const {qs,ss,f,t}=c||{qs:[null,null,null,null],ss:[null,null],f:null,t:null};
 const oq=ordemQuartas(),dupla=d=>`Dupla ${d+1} (${2*d+1}º e ${2*d+2}º)`;
 const sorteio=ESPECIAL?'Sorteio entre os vencedores de ':'';
 const ph={q1:[dupla(oq[0][0]),dupla(oq[0][1])],q2:[dupla(oq[1][0]),dupla(oq[1][1])],q3:[dupla(oq[2][0]),dupla(oq[2][1])],q4:[dupla(oq[3][0]),dupla(oq[3][1])],
   s1:ESPECIAL?[sorteio+'Q1 e Q2','']:['Vencedor Q1','Vencedor Q2'],s2:ESPECIAL?[sorteio+'Q3 e Q4','']:['Vencedor Q3','Vencedor Q4'],
   f:ESPECIAL?[sorteio+'S1 e S2','']:['Vencedor S1','Vencedor S2'],t:ESPECIAL?['Sorteio entre os perdedores de S1 e S2','']:['Perdedor S1','Perdedor S2']};
 const box=(m,id,label)=>`<div class="br-match"><div class="br-label">${label}</div>${m?[m.a,m.b].map((p,k)=>`<div class="br-team ${valid(S.finals[m.id])&&S.finals[m.id][k]>S.finals[m.id][1-k]?'br-win':''}"><span>${p.map(name).join('<br>')}</span><strong>${valid(S.finals[m.id])&&(S.wo||{})[m.id]===k?'W.O.':S.finals[m.id]?.[k]??'–'}</strong></div>`).join(''):ph[id].map(x=>`<div class="br-team br-empty">${x}</div>`).join('')}</div>`;
 const no=(col,lin,html)=>`<div class="br-node" style="grid-column:${col};grid-row:${lin}">${html}</div>`;
 return `<section><h2>Chave da competição</h2><p class="muted">${c?'':'A chave é preenchida quando terminarem os jogos dos grupos. '}No celular, deslize para os lados.${emConsulta()?'':' Os placares são lançados na aba Mata-mata.'}</p>${emConsulta()?'':`<div class="panel-actions"><button onclick="tab='Mata-mata';render()">Lançar placares</button>${c?`<button class="secondary" onclick="abrirImagemJogos('chave')">🖼 Imagem / 🖨 Imprimir chave</button>`:''}</div>`}</section>
 <div class="br-scroll"><div class="br-grid">
  <div class="br-head" style="grid-column:1">Quartas</div><div class="br-head" style="grid-column:2">Semifinal</div><div class="br-head" style="grid-column:3">Final</div><div class="br-head" style="grid-column:4">Semifinal</div><div class="br-head" style="grid-column:5">Quartas</div>
  <svg class="br-lines" viewBox="0 0 860 420" preserveAspectRatio="none"><path d="M148 105 H163 V210 H178 M148 315 H163 V210 M326 210 H341 V105 H356 M712 105 H697 V210 H682 M712 315 H697 V210 M534 210 H519 V105 H504"/></svg>
  ${no(1,'2/span 3',box(qs[0],'q1','Q1'))}${no(1,'5/span 3',box(qs[1],'q2','Q2'))}
  ${no(2,'3/span 4',box(ss[0],'s1','Semi 1'))}
  ${no(3,'2/span 3',box(f,'f','🏆 Final'))}${no(3,'5/span 3',box(t,'t','🥉 3º lugar'))}
  ${no(4,'3/span 4',box(ss[1],'s2','Semi 2'))}
  ${no(5,'2/span 3',box(qs[2],'q3','Q3'))}${no(5,'5/span 3',box(qs[3],'q4','Q4'))}
 </div></div>`;
}
// chave formada (com substituições e sorteios) ou null enquanto os grupos/desempates não permitem
function chavePronta(){
  if(!S.drawn||!complete()||groupPending())return null;
  const lists=listsGeneral(),counts=FORMATS[capacity()].counts;
  if(lists.some((l,k)=>counts[k]>0&&pending('r'+k,l,counts[k])))return null;
  const cg=classificadosGerais();return cg?chaveAtual(cg):null;
}
function renderKnockout(bracketOnly=false){
  if(bracketOnly)return renderBracket(chavePronta());
  let h=`<section><h2>Mata-mata</h2><p class="muted">A chave é liberada após os ${groupGameCount()} jogos e os desempates necessários.</p><p style="margin-top:8px"><b>Classificação:</b> ${formatRule()}</p></section>`;
  if(!complete())return h+'<section><p class="tag">Conclua os '+groupGameCount()+' jogos dos grupos para liberar as quartas.</p><div class="panel-actions"><button onclick="tab=\'Jogos\';render()">Ir para jogos</button></div></section>';
  if(groupPending())return h+'<section><p class="tag">Resolva primeiro os empates dentro dos grupos.</p><div class="panel-actions"><button onclick="tab=\'Classificação\';render()">Ir para classificação</button></div></section>';
  let lists=listsGeneral();
  let counts=FORMATS[capacity()].counts;
  let ties=lists.some((l,k)=>counts[k]>0&&pending('r'+k,l,counts[k]));
  for(let k=0;k<4;k++){
    let limit=counts[k];
    h+=`<section><h3>Ranking dos ${k+1}º colocados</h3><p class="muted">${limit} vagas para esta posição</p><table><tr><th>Atleta</th><th>V</th><th>SG</th><th>GP</th><th>Situação</th></tr>${lists[k].map((x,i)=>`<tr${tieRow('r'+k,lists[k],x,limit)}><td>${i+1}. ${name(x.i)}</td><td>${x.w}</td><td>${x.s}</td><td>${x.f}</td><td class="${i<limit?'ok':'muted'}">${i<limit?'Classificado':'Eliminado'}${pending('r'+k,lists[k],limit)?' (provisório)':''}</td></tr>`).join('')}</table>${tieUI('r'+k,lists[k],limit)}</section>`;
  }
  if(ties)return h+'<section><p class="tag">Resolva os empates gerais necessários para formar as duplas.</p></section>';
  const cg=classificadosGerais();
  if(!cg)return h+'<section><p class="tag">Revise a classificação dos 16 atletas.</p></section>';
  let duos=cg.duos;
  if(!bracketOnly)h+=duoCards(duos);
  const c=chaveAtual(cg),{qs,ss,f,t}=c,esp=id=>c.aguardando.find(x=>x.id===id);
  const jogo=(m,id,txt)=>m?scorecard(m,'finals'):esp(id)?cartaoSorteio(esp(id)):placeholderCard(id.toUpperCase(),txt);
  h+=(ESPECIAL?'<section><p class="tag">Etapa especial: da semifinal em diante as duplas são sorteadas antes de cada jogo.</p></section>':'')+'<section><h2>Quartas de final</h2>'+qs.map(m=>scorecard(m,'finals')).join('')+'</section><section><h2>Semifinais</h2>'+ss.map((m,i)=>jogo(m,'s'+(i+1),'Aguardando as quartas')).join('')+'</section><section><h2>Final e terceiro lugar</h2>'+(f||t||esp('f')||esp('t')?jogo(f,'f','')+jogo(t,'t',''):placeholderCard('FINAL / 3º','Aguardando as semifinais'))+'</section>';
  if(f&&valid(S.finals.f))h+=`<section><h2 class="tag">Campeões: ${pair(winner(f))}</h2><p style="margin-top:8px">2º lugar: ${pair(loser(f))}</p>${t&&valid(S.finals.t)?'<p style="margin-top:4px">3º lugar: '+pair(winner(t))+'</p>':''}</section>`;
  return h;
}

/* ---------- Telas ---------- */
function renderLifecycle(){
  const st=statusAtual();
  let acoes='';
  if(st==='arquivada')acoes='<p class="muted">Liga arquivada (somente consulta). Desarquive em Minhas Ligas para corrigir.</p>';
  else if(S.status==='draft')acoes='<button onclick="startLeague()">INICIAR LIGA</button>';
  else if(S.status==='ended')acoes='<button class="secondary" onclick="corrigirResultados()">CORRIGIR RESULTADOS</button><button class="secondary" onclick="duplicarLiga(L.id)">DUPLICAR LIGA</button>';
  else acoes='<button class="secondary" onclick="endLeague()">ENCERRAR LIGA</button>';
  acoes+='<button class="secondary" onclick="abrirWhatsApp()">📤 WHATSAPP</button>';
  $('lifecycle').innerHTML=`<section class="header-card"><button class="ghost" onclick="voltarInicio()">${L.temporada_id?'← Temporada':'← Minhas Ligas'}</button>
   <h2 style="margin:12px 0 2px">${esc(L.nome)}</h2>
   <p class="muted">${L.etapa_numero?'Etapa '+L.etapa_numero+' da temporada • ':''}${fmtData(L.data)} • ${capacity()} atletas • <span class="chip st-${st}">${STATUS_LABEL[st]}</span></p>
   <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px"><div><div class="status-chip">${statusText()}</div><p class="muted" style="margin-top:8px">${progressSummary()}</p></div><div class="row">${acoes}</div></div></section>`;
}
/* ---------- Finanças ---------- */
// Caixa único da liga. Tudo vem do servidor (fin_resumo); nada é guardado neste aparelho.
// Só aparece para quem tem "Financeiro: ver"; botões de gravar só com "Financeiro: lançar".
let fin=null,finInfo={carregando:false,erro:null},finTab='Resumo',finRodadaId=null;
const FIN_TABS=['Resumo','Rodadas','Lançamentos','Premiação','Ajustes','Histórico'];
const FIN_CAT_SAIDA=['Quadra','Bar','Prêmios','Bolas','Troféus','Medalhas','Registro do site','Outros'];
const FIN_CAT_ENTRADA=['Patrocínio','Venda','Outros'];
const finLanca=()=>pode('financeiro_lancar');
function reais(c){return (Number(c||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function reaisCampo(c){return c==null?'':(Number(c)/100).toFixed(2).replace('.',',')}
// "50", "50,5", "1.234,56", "R$ 20" → centavos; vazio → null; inválido → NaN
function centavosDe(t){
  let s=String(t==null?'':t).replace(/R\$|\s/g,'');if(!s)return null;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  if(!/^-?\d+(\.\d{1,2})?$/.test(s))return NaN;
  return Math.round(Number(s)*100);
}
function abrirFinancas(){view='financas';finRodadaId=null;histFin.pedido=false;render();carregarFin()}
async function carregarFin(){
  finInfo.carregando=true;finInfo.erro=null;if(view==='financas')render();
  try{const {data,error}=await sb.rpc('fin_resumo');if(error)throw error;fin=data}
  catch(e){finInfo.erro=traduzErro(e)}
  finally{finInfo.carregando=false;if(view==='financas')render()}
}
// toda gravação: espera o servidor responder antes de mostrar qualquer resultado
async function finGravar(fn,args,okMsg){
  if(ocupado)return false;ocupado=true;
  try{const {data,error}=await sb.rpc(fn,args);if(error)throw error;ocupado=false;fecharModal();await carregarFin();if(okMsg)finAviso(okMsg);return data||true}
  catch(e){alert('Nada foi gravado: '+traduzErro(e));return false}
  finally{ocupado=false}
}
function finAviso(t){const el=$('fin-aviso');if(el){el.textContent=t;el.style.display='block';clearTimeout(finAviso.t);finAviso.t=setTimeout(()=>{if($('fin-aviso'))$('fin-aviso').style.display='none'},2600)}}

function renderFinancas(){
  let h=`<section><button class="ghost" onclick="view='inicio';render()">← Início</button><h2 style="margin:12px 0 0">Finanças</h2><p id="fin-aviso" class="fin-aviso" style="display:none"></p></section>`;
  if(!fin)return h+`<section>${finInfo.erro?`<p class="muted">Não foi possível carregar: ${esc(finInfo.erro)}</p><div class="panel-actions"><button class="secondary" onclick="carregarFin()">Tentar novamente</button></div>`:'<p class="muted">Carregando…</p>'}</section>`;
  if(finInfo.erro)h+=`<section class="tie-card tie-pending"><b>Sem conexão com o servidor</b><p class="muted" style="margin-top:6px">Mostrando os últimos números carregados. (${esc(finInfo.erro)})</p><div class="panel-actions"><button class="secondary" onclick="carregarFin()">Tentar novamente</button></div></section>`;
  if(finTab==='Rodadas')return h+(finRodadaId?finRodadaDetalhe():finRodadas());
  if(finTab==='Lançamentos')return h+finLancamentos();
  if(finTab==='Premiação')return h+finPremiacao();
  if(finTab==='Ajustes')return h+finAjustes();
  if(finTab==='Histórico'){
    if(!histFin.pedido){histFin.pedido=true;setTimeout(()=>carregarHistApp(histFin,'historico_financeiro',{}),0)}
    return h+`<section><h3>Histórico do financeiro</h3><p class="muted" style="margin-top:6px">Quem lançou, marcou pagamento, mudou valores ou excluiu, e quando.</p><div style="margin-top:10px">${histItens(histFin,'maisHistFin()')}</div></section>`;
  }
  return h+finResumo();
}
function finKpis(t){
  return `<div class="fin-kpis">
    <div class="fin-kpi"><span>Caixa atual</span><b>${reais(t.caixa)}</b></div>
    <div class="fin-kpi"><span>A receber</span><b>${reais(t.a_receber)}</b></div>
    <div class="fin-kpi"><span>A pagar</span><b>${reais(t.a_pagar||0)}</b></div>
    <div class="fin-kpi"><span>Premiação prevista</span><b>${reais(t.premiacao_prevista)}</b></div>
    ${t.entradas_a_receber?`<div class="fin-kpi"><span>Entradas a receber</span><b>${reais(t.entradas_a_receber)}</b></div>`:''}
    <div class="fin-kpi fin-futuro${t.saldo_futuro<0?' neg':''}"><span>Saldo futuro previsto</span><b>${reais(t.saldo_futuro)}</b></div>
  </div>`;
}
function finBotoesLanc(liga,temporada){
  if(!finLanca())return '';
  const a=`${liga?`'${liga}'`:'null'},${temporada?`'${temporada}'`:'null'}`;
  return `<div class="panel-actions"><button class="secondary" onclick="finAbrirLanc(null,'saida',${a})">+ Despesa</button><button class="secondary" onclick="finAbrirLanc(null,'entrada',${a})">+ Entrada</button></div>`;
}
// lançamentos + uma linha automática de receita por rodada com inscrições pagas (soma o que foi marcado como pago)
function finTodosLanc(){
  const ins=fin.rodadas.filter(r=>r.recebido>0).map(r=>{const pg=r.inscritos.filter(i=>i.status==='pago');
    return {id:'insc-'+r.liga_id,auto:true,tipo:'entrada',categoria:'Inscrições',descricao:pg.length+' pago(s)',valor_centavos:r.recebido,
      data:pg.map(i=>i.pago_em).filter(Boolean).sort().pop()||r.data,liga_id:r.liga_id,liga_nome:r.nome,pago:true}});
  return [...fin.lancamentos,...ins].sort((a,b)=>String(b.data).localeCompare(String(a.data)));
}
const finPendentes=()=>fin.lancamentos.filter(x=>x.pago===false);
function finResumo(){
  const t=fin.totais,todos=finTodosLanc().filter(x=>x.pago!==false);
  return `<section>${finKpis(t)}
    <p class="muted" style="margin-top:10px">Caixa = saldo inicial ${reais(t.saldo_inicial)} + inscrições ${reais(t.inscricoes_recebidas)} + entradas recebidas ${reais(t.entradas)} − despesas pagas ${reais(t.saidas)}. Saldo futuro previsto = caixa − a pagar${t.entradas_a_receber?' + entradas a receber':''} − premiação prevista. Inscrições pendentes ficam só em "A receber".</p>
    ${finBotoesLanc()}</section>
   ${finPendentes().length?`<section><h3>A pagar e a receber</h3>${finListaLanc(finPendentes())}</section>`:''}
   <section><h3>Últimos pagos e recebidos</h3>${finListaLanc(todos.slice(0,8))}${todos.length>8?`<div class="panel-actions"><button class="ghost" onclick="finTab='Lançamentos';render()">Ver todos (${todos.length})</button></div>`:''}</section>`;
}
function finListaLanc(l){
  if(!l.length)return '<p class="muted" style="margin-top:8px">Nada lançado ainda.</p>';
  const sai=x=>x.tipo==='saida';
  return `<div class="fin-lista">${l.map(x=>{const onde=x.liga_nome?esc(x.liga_nome):x.temporada_nome?'Temporada '+esc(x.temporada_nome):'Liga (geral)';
    const sit=x.auto?'soma automática das inscrições pagas':x.pago===false?`<span class="fin-pend">${sai(x)?'a pagar':'a receber'}</span>`:x.pago_em&&x.pago_em!==x.data?(sai(x)?'pago':'recebido')+' em '+fmtData(x.pago_em):'';
    const acoes=x.auto?`<button class="ghost mini" onclick="finTab='Rodadas';finRodadaId='${x.liga_id}';render()">Ver rodada</button>`
      :finLanca()?`${x.pago===false?`<button class="secondary mini" onclick="finBaixar('${x.id}')">${sai(x)?'Pagar':'Receber'}</button>`:''}${x.premio_id?'':`<button class="ghost mini" onclick="finAbrirLanc('${x.id}')">Editar</button>`}<button class="ghost mini" onclick="finExcluirLanc('${x.id}')">Excluir</button>`:'';
    return `<div class="fin-linha${x.pago===false?' fin-linha-pend':''}"><div class="fin-linha-txt"><b>${esc(x.categoria)}</b>${x.descricao?' — '+esc(x.descricao):''}<div class="muted">${fmtData(x.data)} • ${onde}${sit?' • '+sit:''}</div></div>
      <div class="fin-valor ${x.pago===false?'':sai(x)?'neg':'pos'}">${sai(x)?'−':'+'} ${reais(x.valor_centavos)}</div>
      ${acoes?`<div class="fin-acoes">${acoes}</div>`:''}</div>`}).join('')}</div>`;
}
function finNomeRodada(r){return `${esc(r.nome)}${r.apagada?' <span class="muted">(liga apagada)</span>':r.na_lixeira?' <span class="muted">(na lixeira)</span>':''}`}
function finRodadas(){
  const rs=fin.rodadas;
  let h=`<section><h3>Rodadas com inscrição</h3>${rs.length?`<div class="ligas-list" style="margin-top:10px">${rs.map(r=>{
    const c={pago:0,isento:0,pendente:0};r.inscritos.forEach(i=>c[i.status]++);const saldo=r.recebido+r.entradas-r.saidas;
    return `<div class="liga-card fin-rodada" onclick="finRodadaId='${r.liga_id}';render()"><div class="row" style="justify-content:space-between;align-items:baseline"><h3>${finNomeRodada(r)}</h3><span class="muted">${fmtData(r.data)}</span></div>
      <p class="muted" style="margin-top:4px">${r.temporada_nome?'Temporada '+esc(r.temporada_nome)+(r.etapa_numero?' • etapa '+r.etapa_numero:'')+' • ':'Relâmpago • '}inscrição ${reais(r.valor_centavos)}</p>
      <p style="margin-top:6px">${c.pago} pago(s) • ${c.pendente} pendente(s) • ${c.isento} isento(s)</p>
      <p class="muted" style="margin-top:2px">Recebido ${reais(r.recebido)} • a receber ${reais(r.a_receber)} • saldo da rodada <b class="${saldo<0?'neg':''}">${reais(saldo)}</b></p></div>`}).join('')}</div>`:'<p class="muted" style="margin-top:8px">Nenhuma rodada com cobrança ainda.</p>'}</section>`;
  if(finLanca()&&fin.ligas_sem_cobranca.length)h+=`<section><h3>Cobrar inscrição de uma rodada</h3><p class="muted" style="margin-top:4px">Escolha a liga relâmpago ou etapa. A lista de inscritos vem da própria liga.</p>
    <select id="fin-nova-rodada" style="margin-top:10px">${fin.ligas_sem_cobranca.map(l=>`<option value="${l.id}">${esc(l.nome)} — ${fmtData(l.data)}</option>`).join('')}</select>
    <div class="panel-actions"><button onclick="finCobrar()">Cobrar inscrição</button></div></section>`;
  return h;
}
function finRodadaDetalhe(){
  const r=fin.rodadas.find(x=>x.liga_id===finRodadaId);if(!r){finRodadaId=null;return finRodadas()}
  const lanc=finTodosLanc().filter(x=>x.liga_id===r.liga_id),prem=fin.premios.filter(p=>p.liga_id===r.liga_id);
  const saldo=r.recebido+r.entradas-r.saidas,L=finLanca();
  const seg=(i,k,s,txt)=>`<button class="${i.status===s?'on':''}" ${L?`onclick="finMarcar('${r.liga_id}',${k},'${s}')"`:'disabled'}>${txt}</button>`;
  return `<section><button class="ghost" onclick="finRodadaId=null;render()">← Rodadas</button>
    <h3 style="margin-top:10px">${finNomeRodada(r)}</h3><p class="muted">${fmtData(r.data)} • inscrição ${reais(r.valor_centavos)}${r.valor_proprio!=null?' (valor só desta rodada)':' (valor padrão)'}</p>
    <div class="fin-kpis" style="margin-top:10px"><div class="fin-kpi"><span>Recebido</span><b>${reais(r.recebido)}</b></div><div class="fin-kpi"><span>A receber</span><b>${reais(r.a_receber)}</b></div><div class="fin-kpi"><span>Despesas pagas</span><b>${reais(r.saidas)}</b>${r.a_pagar?`<small class="muted">+ ${reais(r.a_pagar)} a pagar</small>`:''}</div><div class="fin-kpi fin-futuro${saldo<0?' neg':''}"><span>Saldo da rodada</span><b>${reais(saldo)}</b></div></div>
    ${L?`<details style="margin-top:10px"><summary class="muted">Mudar o valor da inscrição desta rodada</summary><div class="row" style="margin-top:8px;align-items:end"><label style="flex:1">Valor (R$) <input id="fin-valor-rodada" inputmode="decimal" placeholder="vazio = valor padrão" value="${reaisCampo(r.valor_proprio)}"></label><button class="secondary" onclick="finValorRodada('${r.liga_id}')">Salvar valor</button></div></details>`:''}</section>
   <section><h3>Inscritos (${r.inscritos.length})</h3>${r.inscritos.length?`<div class="fin-lista">${r.inscritos.map((i,k)=>`<div class="fin-linha"><div class="fin-linha-txt"><b>${esc(i.nome)}</b>${i.status==='pago'?`<div class="muted">pagou ${reais(i.valor_centavos)}${i.pago_em?' em '+fmtData(i.pago_em):''}${L?` • <a href="#" onclick="finValorPago('${r.liga_id}',${k});return false">mudar valor</a>`:''}</div>`:''}</div>
      <div class="seg">${seg(i,k,'pago','Pago')}${seg(i,k,'pendente','Pendente')}${seg(i,k,'isento','Isento')}</div></div>`).join('')}</div>`:'<p class="muted" style="margin-top:8px">A liga ainda não tem atletas inscritos.</p>'}</section>
   <section><h3>Despesas e entradas da rodada</h3>${finListaLanc(lanc)}${finBotoesLanc(r.liga_id)}</section>
   <section><h3>Premiação da rodada</h3>${finListaPremios(prem)}${L?`<div class="panel-actions"><button class="secondary" onclick="finAbrirPremio(null,'${r.liga_id}',null)">+ Prêmio</button></div>`:''}</section>
   ${L&&!r.recebido&&!r.inscritos.some(i=>i.status!=='pendente')?`<p class="muted" style="text-align:center"><a href="#" onclick="finParar('${r.liga_id}');return false">Parar de cobrar inscrição desta rodada</a></p>`:''}`;
}
function finListaPremios(ps){
  if(!ps.length)return '<p class="muted" style="margin-top:8px">Nenhum prêmio previsto.</p>';
  return `<div class="fin-lista">${ps.map(p=>`<div class="fin-linha"><div class="fin-linha-txt"><b>${p.colocacao}º lugar</b>${p.descricao?' — '+esc(p.descricao):''}<div class="muted">${p.pago?'pago':'previsto'}</div></div>
    <div class="fin-valor ${p.pago?'neg':''}">${reais(p.valor_centavos)}</div>
    ${finLanca()?`<div class="fin-acoes">${p.pago?'<span class="muted" style="font-size:12px">para desfazer, exclua o lançamento</span>':`<button class="secondary mini" onclick="finPagarPremio('${p.id}')">Pagar</button><button class="ghost mini" onclick="finAbrirPremio('${p.id}')">Editar</button><button class="ghost mini" onclick="finExcluirPremio('${p.id}')">Excluir</button>`}</div>`:''}</div>`).join('')}</div>`;
}
function finLancamentos(){
  const t=fin.totais;
  const pend=finPendentes();
  return `<section><p>Entradas <b class="pos">${reais(t.entradas+t.inscricoes_recebidas)}</b> • Saídas <b class="neg">${reais(t.saidas)}</b></p>
    <p class="muted" style="margin-top:4px">Só o que foi pago ou recebido. A pagar ${reais(t.a_pagar||0)}${t.entradas_a_receber?' • entradas a receber '+reais(t.entradas_a_receber):''}. As inscrições marcadas como pagas entram sozinhas, uma linha por rodada.</p>${finBotoesLanc()}</section>
   ${pend.length?`<section><h3>A pagar e a receber (${pend.length})</h3>${finListaLanc(pend)}</section>`:''}
   <section><h3>Pagos e recebidos</h3>${finListaLanc(finTodosLanc().filter(x=>x.pago!==false))}</section>`;
}
function finPremiacao(){
  const porTemp=fin.temporadas.map(t=>({t,ps:fin.premios.filter(p=>p.temporada_id===t.id)})).filter(x=>x.ps.length||x.t.status!=='arquivada');
  const rod=fin.rodadas.map(r=>({r,ps:fin.premios.filter(p=>p.liga_id===r.liga_id)})).filter(x=>x.ps.length);
  return `<section>${finKpis(fin.totais)}</section>
   <section><h3>Temporadas</h3>${porTemp.length?porTemp.map(({t,ps})=>`<div class="liga-card" style="margin-top:10px"><h3>${esc(t.nome)}</h3>${finListaPremios(ps)}${finLanca()?`<div class="panel-actions"><button class="secondary" onclick="finAbrirPremio(null,null,'${t.id}')">+ Prêmio da temporada</button></div>`:''}</div>`).join(''):'<p class="muted" style="margin-top:8px">Nenhuma temporada.</p>'}</section>
   <section><h3>Rodadas</h3>${rod.length?rod.map(({r,ps})=>`<div class="liga-card" style="margin-top:10px"><h3>${finNomeRodada(r)}</h3>${finListaPremios(ps)}</div>`).join(''):'<p class="muted" style="margin-top:8px">Os prêmios de cada rodada são lançados dentro da rodada (aba Rodadas).</p>'}</section>`;
}
function finAjustes(){
  const c=fin.config,L=finLanca(),dis=L?'':' disabled';
  return `<section><h3>Caixa e inscrição das relâmpago</h3>
    <div class="form-grid" style="margin-top:10px"><label>Saldo inicial do caixa (R$)<input id="fin-saldo-inicial" inputmode="decimal" value="${reaisCampo(c.saldo_inicial_centavos)}"${dis}></label>
    <label>Inscrição padrão das ligas relâmpago (R$)<input id="fin-insc-relampago" inputmode="decimal" value="${reaisCampo(c.inscricao_relampago_centavos)}"${dis}></label></div>
    <p class="muted" style="margin-top:6px">Saldo inicial é o dinheiro que a liga já tinha antes de usar o app.</p>
    ${L?'<div class="panel-actions"><button onclick="finSalvarAjustes()">Salvar</button></div>':''}</section>
   <section><h3>Inscrição padrão de cada temporada</h3>${fin.temporadas.length?fin.temporadas.map(t=>`<div class="row" style="margin-top:10px;align-items:end"><label style="flex:1">${esc(t.nome)} (R$)<input id="fin-temp-${t.id}" inputmode="decimal" placeholder="vazio = igual às relâmpago" value="${reaisCampo(t.inscricao_centavos)}"${dis}></label>${L?`<button class="secondary" onclick="finSalvarValorTemp('${t.id}')">Salvar</button>`:''}</div>`).join(''):'<p class="muted" style="margin-top:8px">Nenhuma temporada ainda.</p>'}</section>`;
}

/* ações (precisam de "Financeiro: lançar"; o servidor confere de novo) */
function finLerValor(id,{vazio=false,zero=true}={}){
  const c=centavosDe($(id).value);
  if(c===null&&vazio)return null;
  if(c===null||Number.isNaN(c)||c<0||(!zero&&c===0)){alert('Valor inválido. Use, por exemplo, 50 ou 50,00.');$(id).focus();return undefined}
  return c;
}
async function finSalvarAjustes(){
  const s=centavosDe($('fin-saldo-inicial').value),i=finLerValor('fin-insc-relampago');
  if(s===null||Number.isNaN(s)){alert('Saldo inicial inválido. Use, por exemplo, 1500 ou 1.500,00.');return}
  if(i===undefined)return;
  await finGravar('fin_salvar_config',{p_saldo_inicial_centavos:s,p_inscricao_relampago_centavos:i},'Ajustes salvos.');
}
async function finSalvarValorTemp(tid){
  const v=finLerValor('fin-temp-'+tid,{vazio:true});if(v===undefined)return;
  await finGravar('fin_salvar_valor_temporada',{p_temporada_id:tid,p_inscricao_centavos:v},'Valor da temporada salvo.');
}
async function finCobrar(){
  const id=$('fin-nova-rodada')&&$('fin-nova-rodada').value;if(!id)return;
  if(await finGravar('fin_cobrar_rodada',{p_liga_id:id,p_cobrar:true},'Cobrança ativada.'))finRodadaId=id,render();
}
async function finParar(id){
  if(!confirm('Parar de cobrar inscrição desta rodada? Ela sai da lista de rodadas do Finanças.'))return;
  if(await finGravar('fin_cobrar_rodada',{p_liga_id:id,p_cobrar:false},'Cobrança desativada.'))finRodadaId=null,render();
}
async function finValorRodada(id){
  const v=finLerValor('fin-valor-rodada',{vazio:true});if(v===undefined)return;
  await finGravar('fin_cobrar_rodada',{p_liga_id:id,p_cobrar:true,p_inscricao_centavos:v},'Valor da rodada salvo.');
}
const finInscrito=(liga,k)=>{const r=fin.rodadas.find(x=>x.liga_id===liga);return r&&r.inscritos[k]};
async function finMarcar(liga,k,status){const i=finInscrito(liga,k);if(i)await finGravar('fin_marcar_inscricao',{p_liga_id:liga,p_chave:i.chave,p_status:status})}
function finValorPago(liga,k){
  const i=finInscrito(liga,k);if(!i)return;
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>Valor pago — ${esc(i.nome)}</h2>
    <div class="form-grid" style="margin-top:12px"><label>Valor (R$)<input id="fin-vp" inputmode="decimal" value="${reaisCampo(i.valor_centavos)}"></label><label>Data do pagamento<input id="fin-vp-data" type="date" value="${i.pago_em||hoje()}"></label></div>
    <div class="panel-actions"><button onclick="finSalvarValorPago('${liga}',${k})">Salvar</button><button class="ghost" onclick="fecharModal()">Cancelar</button></div></div></div>`;
}
async function finSalvarValorPago(liga,k){
  const v=finLerValor('fin-vp');if(v===undefined)return;const i=finInscrito(liga,k);if(!i)return;
  await finGravar('fin_marcar_inscricao',{p_liga_id:liga,p_chave:i.chave,p_status:'pago',p_valor_centavos:v,p_pago_em:$('fin-vp-data').value||null},'Pagamento salvo.');
}
function finAbrirLanc(id,tipo,liga,temporada){
  const x=id?fin.lancamentos.find(l=>l.id===id):null;
  tipo=x?x.tipo:tipo||'saida';liga=x?x.liga_id:liga||null;temporada=x?x.temporada_id:temporada||null;
  const cats=tipo==='saida'?FIN_CAT_SAIDA:FIN_CAT_ENTRADA,vinc=liga?'l:'+liga:temporada?'t:'+temporada:'';
  // todas as ligas (com ou sem cobrança de inscrição): relâmpago e etapas das temporadas
  // ligas apagadas ou na lixeira só aparecem se o lançamento já for delas
  const ligasFin=[...fin.rodadas.filter(r=>!(r.apagada||r.na_lixeira)||r.liga_id===liga).map(r=>({...r,id:r.liga_id,nome:r.nome+(r.apagada?' (apagada)':r.na_lixeira?' (na lixeira)':'')})),...fin.ligas_sem_cobranca].sort((a,b)=>String(b.data||'').localeCompare(String(a.data||''))),
    nomeL=l=>l.nome+(l.data?' — '+fmtData(l.data):''),
    grupos=[['Temporadas',fin.temporadas.map(t=>['t:'+t.id,'Temporada '+t.nome])],
      ['Ligas relâmpago',ligasFin.filter(l=>!l.temporada_nome).map(l=>['l:'+l.id,nomeL(l)])],
      ['Etapas das temporadas',ligasFin.filter(l=>l.temporada_nome).map(l=>['l:'+l.id,nomeL(l)+' ('+l.temporada_nome+(l.etapa_numero?', etapa '+l.etapa_numero:'')+')'])]];
  const opt=([v,t])=>`<option value="${v}"${v===vinc?' selected':''}>${esc(t)}</option>`;
  const opcoesHtml=opt(['','Liga (geral)'])+grupos.filter(([,o])=>o.length).map(([g,o])=>`<optgroup label="${g}">${o.map(opt).join('')}</optgroup>`).join('');
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>${x?'Editar':'Nova'} ${tipo==='saida'?'despesa':'entrada'}</h2>
    <input type="hidden" id="fin-l-tipo" value="${tipo}">
    <div class="form-grid" style="margin-top:12px">
      <label>Categoria<select id="fin-l-cat">${cats.map(c=>`<option${x&&x.categoria===c?' selected':''}>${esc(c)}</option>`).join('')}${x&&!cats.includes(x.categoria)?`<option selected>${esc(x.categoria)}</option>`:''}</select></label>
      <label>Valor (R$)<input id="fin-l-valor" inputmode="decimal" value="${x?reaisCampo(x.valor_centavos):''}" placeholder="0,00"></label>
      <label>Descrição (opcional)<input id="fin-l-desc" maxlength="200" value="${x&&x.descricao?esc(x.descricao):''}"></label>
      <label>Data<input id="fin-l-data" type="date" value="${x?x.data:hoje()}"></label>
      <label>Situação<select id="fin-l-pago"><option value="0"${x&&x.pago!==false?'':' selected'}>${tipo==='saida'?'A pagar':'A receber'} (entra só no saldo futuro)</option><option value="1"${x&&x.pago!==false?' selected':''}>${tipo==='saida'?'Já paga':'Já recebida'} (sai/entra no caixa)</option></select></label>
      <label>De onde é<select id="fin-l-vinc">${opcoesHtml}</select></label>
    </div>
    <div class="panel-actions"><button onclick="finSalvarLanc(${x?`'${x.id}'`:'null'})">Salvar</button><button class="ghost" onclick="fecharModal()">Cancelar</button></div></div></div>`;
}
async function finSalvarLanc(id){
  const v=finLerValor('fin-l-valor',{zero:false});if(v===undefined)return;
  const vinc=$('fin-l-vinc').value;
  await finGravar('fin_lancar',{p_id:id||crypto.randomUUID(),p_tipo:$('fin-l-tipo').value,p_categoria:$('fin-l-cat').value,p_descricao:$('fin-l-desc').value.trim()||null,
    p_valor_centavos:v,p_data:$('fin-l-data').value||null,p_liga_id:vinc.startsWith('l:')?vinc.slice(2):null,p_temporada_id:vinc.startsWith('t:')?vinc.slice(2):null,p_pago:$('fin-l-pago').value==='1'},'Lançamento salvo.');
}
async function finBaixar(id){
  const x=fin.lancamentos.find(l=>l.id===id);if(!x)return;const sai=x.tipo==='saida';
  if(!confirm(`${sai?'Pagar':'Receber'} ${x.categoria} de ${reais(x.valor_centavos)} hoje?\n\n${sai?'O valor sai':'O valor entra'} no caixa atual.`))return;
  await finGravar('fin_baixar_lancamento',{p_id:id,p_pago:true},sai?'Despesa paga.':'Entrada recebida.');
}
async function finExcluirLanc(id){
  const x=fin.lancamentos.find(l=>l.id===id);if(!x)return;
  if(!confirm(`Excluir ${x.categoria} de ${reais(x.valor_centavos)}?${x.premio_id?' O prêmio volta a ficar previsto.':''}`))return;
  await finGravar('fin_excluir_lancamento',{p_id:id},'Lançamento excluído.');
}
function finAbrirPremio(id,liga,temporada){
  const p=id?fin.premios.find(x=>x.id===id):null;liga=p?p.liga_id:liga;temporada=p?p.temporada_id:temporada;
  const onde=liga?(fin.rodadas.find(r=>r.liga_id===liga)||{}).nome:(fin.temporadas.find(t=>t.id===temporada)||{}).nome;
  const prox=p?p.colocacao:1+Math.max(0,...fin.premios.filter(x=>liga?x.liga_id===liga:x.temporada_id===temporada).map(x=>x.colocacao));
  $('modal').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)fecharModal()"><div class="modal-box"><h2>${p?'Editar':'Novo'} prêmio</h2><p class="muted">${liga?'Rodada':'Temporada'} ${esc(onde||'')}</p>
    <div class="form-grid" style="margin-top:12px"><label>Colocação<input id="fin-p-col" type="number" min="1" max="64" value="${prox}"></label>
    <label>Descrição (opcional)<input id="fin-p-desc" maxlength="120" placeholder="ex.: dinheiro, troféu, kit" value="${p&&p.descricao?esc(p.descricao):''}"></label>
    <label>Valor previsto (R$)<input id="fin-p-valor" inputmode="decimal" value="${p?reaisCampo(p.valor_centavos):''}" placeholder="0,00"></label></div>
    <div class="panel-actions"><button onclick="finSalvarPremio(${p?`'${p.id}'`:'null'},${liga?`'${liga}'`:'null'},${temporada?`'${temporada}'`:'null'})">Salvar</button><button class="ghost" onclick="fecharModal()">Cancelar</button></div></div></div>`;
}
async function finSalvarPremio(id,liga,temporada){
  const v=finLerValor('fin-p-valor');if(v===undefined)return;
  const col=parseInt($('fin-p-col').value,10);if(!(col>=1&&col<=64)){alert('Colocação inválida.');return}
  await finGravar('fin_salvar_premio',{p_id:id||crypto.randomUUID(),p_liga_id:liga,p_temporada_id:temporada,p_colocacao:col,p_descricao:$('fin-p-desc').value.trim()||null,p_valor_centavos:v},'Prêmio salvo.');
}
async function finExcluirPremio(id){if(confirm('Excluir este prêmio previsto?'))await finGravar('fin_excluir_premio',{p_id:id},'Prêmio excluído.')}
async function finPagarPremio(id){
  const p=fin.premios.find(x=>x.id===id);if(!p)return;
  if(!confirm(`Registrar o pagamento de ${reais(p.valor_centavos)} (${p.colocacao}º lugar)? Vira uma saída do caixa hoje.`))return;
  await finGravar('fin_pagar_premio',{p_id:id},'Prêmio pago.');
}

function render(){
  renderSync();
  if(view!=='liga'&&view!=='temporada'){$('lifecycle').innerHTML='';$('nav').innerHTML='';$('nav').style.display='none'}
  let h='';
  if(view==='carregando')h='<section><p class="muted">Carregando…</p></section>';
  if(view==='erro')h='<section><h2>Não foi possível iniciar</h2><p class="muted">O app não conseguiu carregar os componentes necessários. Verifique a conexão e recarregue a página.</p><div class="panel-actions"><button onclick="location.reload()">Recarregar</button></div></section>';
  if(view==='acesso')h=renderAcesso();
  if(view==='usuarios')h=renderUsuarios();
  if(view==='inicio')h=renderInicio();
  if(view==='nova')h=renderNova();
  if(view==='atletas')h=renderAtletas();
  if(view==='nova-temporada')h=renderNovaTemporada();
  if(view==='financas'){$('nav').style.display='';$('nav').innerHTML=FIN_TABS.map(t=>`<button class="${t===finTab?'active':'secondary'}" onclick="finTab='${t}';finRodadaId=null;render()">${t}</button>`).join('');h=renderFinancas()}
  if(view==='temporada'){
    if(T){lsSet('lr6:taba:'+T.id,tTab);$('lifecycle').innerHTML=renderTemporadaCabecalho()}
    $('nav').style.display='';
    $('nav').innerHTML=tTabs.map(t=>`<button class="${t===tTab?'active':'secondary'}" onclick="tTab='${t}';render()">${t}</button>`).join('');
    h=renderTemporada();
  }
  if(view==='publica-vazia')h=`<section><h2>Liga Resenha</h2><p class="muted" style="margin-top:6px">${pInfo.erro?'Não foi possível carregar: '+esc(pInfo.erro):'Nenhuma temporada ou liga relâmpago para consultar no momento.'}</p><div class="panel-actions"><button class="pub" onclick="abrirConsulta()">Tentar de novo</button></div></section>`;
  if(view==='publica'){
    $('lifecycle').innerHTML=cabecalhoPublico();$('nav').style.display='none';$('nav').innerHTML='';
    h=pSec==='temporadas'?renderTemporadasPublicas():pSec==='relampagos'?renderRelampagosPublicas():pSec==='rodada'?'<section><p class="muted">Nenhuma rodada para mostrar.</p></section>':renderInicioPublico();
  }
  if(view==='publica-temporada'){
    $('lifecycle').innerHTML=cabecalhoPublico(subCabecalho('Temporadas',esc(T.nome),`${T.inicio?'Início '+fmtData(T.inicio)+' • ':''}${T_STATUS[T.status]||esc(T.status)}`));
    $('nav').style.display='';
    $('nav').innerHTML=['Ranking','Etapas'].map(t=>`<button class="${t===pTab?'active':'secondary'}" onclick="pTab='${t}';render()">${t==='Ranking'?'Classificação geral':t}</button>`).join('');
    h=pTab==='Ranking'?renderRankingTemporada():renderEtapasPublicas();
  }
  if(view==='publica-etapa'){
    const o=pOrigem,volta=!o?'':o.view==='publica-temporada'?esc(T?T.nome:'Temporada'):o.pSec==='relampagos'?'Relâmpagos':o.pSec==='temporadas'?'Temporadas':'Painel';
    const tit=L.temporada_id&&T?esc(T.nome)+' • Etapa '+L.etapa_numero:'Relâmpago';
    $('lifecycle').innerHTML=cabecalhoPublico(subCabecalho(volta,esc(L.nome),`${tit} • ${fmtData(L.data)} • ${statusEtapaPublica(L)}`));
    $('nav').style.display=S.drawn?'':'none';
    $('nav').innerHTML=pubTabs.map(t=>`<button class="${t===tab?'active':'secondary'}" onclick="tab='${t}';render()">${t}</button>`).join('');
    h=renderEtapaPublica();
  }
  if(view==='liga'){
    lsSet('lr6:aba:'+L.id,tab);
    renderLifecycle();
    $('nav').style.display='';
    $('nav').innerHTML=tabs.map(t=>`<button class="${t===tab?'active':'secondary'}" onclick="tab='${t}';render()">${t}</button>`).join('');
    if(tab==='Painel')h=renderHome();
    if(tab==='Atletas')h=renderAtletasLiga();
    if(tab==='Grupos')h=renderGroups();
    if(tab==='Jogos')h=renderGroupGames();
    if(tab==='Classificação')h=renderClassification();
    if(tab==='Mata-mata')h=renderKnockout();
    if(tab==='Chave')h=renderKnockout(true);
    if(tab==='Histórico')h=renderHistorico();
  }
  h+=`<div class="footer-note">Liga Resenha BT - Desenvolvido por Jeferson Moreno - Versão ${APP_VERSION}</div>`;
  $('main').innerHTML=h;
  document.querySelectorAll('.br-scroll').forEach(e=>{e.scrollLeft=(e.scrollWidth-e.clientWidth)/2});
  aplicarPermissoes();
  // página pública: só leitura (o servidor também não aceita gravação sem login)
  if(emConsulta()){document.querySelectorAll('#main button:not(.pub)').forEach(e=>e.remove());document.querySelectorAll('#main input:not(.pub),#main select:not(.pub),#main textarea').forEach(e=>e.disabled=true)}
  if(view==='nova'){const q=$('nlQtd');q.onchange=()=>{$('nlRegra').textContent=FORMATS[q.value].label}}
  if(view==='liga'){
    if(S.status==='ended')document.querySelectorAll('#main input:not([type=file]), #main button[onclick^="chooseTie"], #main button[onclick^="resetTie"]').forEach(e=>e.disabled=true);
  }
}

/* ---------- Início do app ---------- */
async function iniciar(){
  if(!window.supabase||!window.supabase.createClient){view='erro';render();return}
  sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'lr6-auth'}});
  sb.auth.onAuthStateChange((ev,session)=>{
    if(ev==='SIGNED_OUT'){usuario=null;meuAcesso=null;if(view!=='acesso'&&view!=='liga'){view='acesso';render()}}
    else if(session)usuario=session.user;
  });
  view='carregando';render();
  let session=null;
  try{const r=await sb.auth.getSession();session=r.data&&r.data.session}catch{}
  usuario=session&&session.user;
  let temSessaoGuardada=false;try{temSessaoGuardada=!!localStorage.getItem('lr6-auth')}catch{}
  if(usuario||(temSessaoGuardada&&!navigator.onLine))verificarAcesso();else{view='acesso';render()}
}
window.addEventListener('online',()=>{if(view==='liga'&&fila.pendente)tentarNovamente();if(view==='inicio')carregarLista()});
window.addEventListener('offline',()=>{if(view==='liga'&&sync.estado!=='conflito')setSync('offline')});
window.addEventListener('beforeunload',e=>{if(enviando||fila.pendente){e.preventDefault();e.returnValue=''}});
async function conferirVersaoNoServidor(recarregar){
  if(view!=='liga'||!L||fila.pendente||enviando||!navigator.onLine||document.visibilityState!=='visible')return;
  try{
    const {data,error}=await sb.from('ligas').select('versao').eq('id',L.id).single();
    if(error||!data||!L||data.versao<=L.versao||fila.pendente||enviando)return;
    if(recarregar)abrirLiga(L.id,{ignorarCache:true});else setSync('desatualizada');
  }catch{}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(view==='publica'&&pSec==='inicio')abrirConsulta();else if(view==='liga')conferirVersaoNoServidor(true);else if(view==='inicio')carregarLista()}});
setInterval(()=>{
  if(view!=='liga')return;
  if(fila.pendente&&!enviando&&(sync.estado==='offline'||sync.estado==='pendente'))tentarNovamente();
  else conferirVersaoNoServidor(false);
},30000);
iniciar();
if('serviceWorker' in navigator&&location.protocol!=='file:'){
  let tinhaControle=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!tinhaControle){tinhaControle=true;return}
    document.getElementById('update-banner').innerHTML='<div class="sync s-info" style="position:static;transform:none;margin:10px 0"><span>Nova versão do app disponível.</span><button onclick="atualizarApp()">Atualizar</button></div>';
  });
  window.addEventListener('load',()=>navigator.serviceWorker.register(LR_RAIZ+'sw.js',{scope:LR_RAIZ}).then(reg=>{setInterval(()=>reg.update().catch(()=>{}),60*60*1000)}).catch(console.error));
}
function atualizarApp(){
  if((typeof enviando!=='undefined'&&enviando)||(typeof fila!=='undefined'&&fila.pendente)){
    if(!confirm('Há alterações ainda não gravadas no servidor. Elas ficam guardadas neste aparelho. Atualizar mesmo assim?'))return;
  }
  location.reload();
}
