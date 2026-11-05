const SUPABASE_URL = 'https://nufcsghiitooamcgukbw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_H6te1T153XXpx57yR6A9Sw_uVm0G6vH';
const ALLOW_SIGNUP = true;
// As 11 cores fixas de evento do Google Calendar. Guardamos o id ("1".."11") em
// vez do hex para a cor sobreviver à ida e volta sem se degradar a cada sync.
const EVENT_COLORS = [
  {id:'1',  name:'Lavanda',   hex:'#7986CB'},
  {id:'2',  name:'Sálvia',    hex:'#33B679'},
  {id:'3',  name:'Uva',       hex:'#8E24AA'},
  {id:'4',  name:'Flamingo',  hex:'#E67C73'},
  {id:'5',  name:'Banana',    hex:'#F6BF26'},
  {id:'6',  name:'Tangerina', hex:'#F4511E'},
  {id:'7',  name:'Pavão',     hex:'#039BE5'},
  {id:'8',  name:'Grafite',   hex:'#616161'},
  {id:'9',  name:'Mirtilo',   hex:'#3F51B5'},
  {id:'10', name:'Manjericão',hex:'#0B8043'},
  {id:'11', name:'Tomate',    hex:'#D50000'}
];

function eventColorHex(colorId){
  const c = EVENT_COLORS.find(x=>x.id === String(colorId));
  return c ? corSegura(c.hex) : null;
}

// Cor efetiva do cartão: a da tarefa, se escolhida; senão a da coluna.
function taskColor(t){
  return eventColorHex(t.color_id) || taskColumnColor(t);
}

const GCAL_ID = 'primary';
const GCAL_PULL_INTERVAL = 2 * 60 * 1000;
// Até onde a busca olha para a frente. Sem limite, todo compromisso
// recorrente sem data de fim era expandido décadas adiante: cada aniversário
// anual da agenda virava ~30 tarefas, uma por ano até 2056.
const GCAL_HORIZONTE_DIAS = 90;
// A busca incremental só traz o que mudou. Uma ocorrência que entra na janela
// sem ter sido editada nunca chegaria por ela — uma busca completa por dia
// (dentro da janela) é o que traz essas.
const GCAL_COMPLETA_A_CADA = 24 * 60 * 60 * 1000;
let googleConnected = false;
let googleAccessToken = null;
let googleTokenExpiry = 0;
let gcalCalendarId = null;
let gcalSyncToken = null;
let gcalPullTimer = null;
let gcalConnectedAt = null;
// Contas de teste do Google (não verificadas) têm o refresh token expirado pelo
// próprio Google 7 dias após a conexão, não importa o que o app faça — ver README.
const GOOGLE_TEST_TOKEN_LIFETIME_DAYS = 7;
// Lido antes do createClient: o supabase-js consome o hash do link do email e
// limpa a URL. Quem volta pelo link de redefinir senha já chega com sessão, e o
// checkAuth não pode jogar a pessoa direto no app sem ela escolher a senha nova.
// O pedido fica guardado até a senha ser salva: a sessão do link sobrevive a
// recarregar a página ou a clicar de novo no link já usado, e sem a marca o app
// abriria logado sem nunca pedir a senha.
const SENHA_PENDENTE_KEY = 'senhaPendente';
const hashDaUrl = new URLSearchParams(location.hash.slice(1));
let recuperandoSenha = hashDaUrl.get('type') === 'recovery' || lerSenhaPendente();
if(recuperandoSenha) marcarSenhaPendente(true);
const linkDoEmailInvalido = hashDaUrl.has('error_description');
function lerSenhaPendente(){
  try{ return localStorage.getItem(SENHA_PENDENTE_KEY) === '1'; }catch(e){ return false; }
}
function marcarSenhaPendente(pendente){
  try{
    if(pendente) localStorage.setItem(SENHA_PENDENTE_KEY, '1');
    else localStorage.removeItem(SENHA_PENDENTE_KEY);
  }catch(e){}
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let session = null;
let authMode = 'signin';

// O supabase-js renova o JWT sozinho a cada ~1h, mas `session` guardava o da
// abertura da página. Passada uma hora, as chamadas a /api/google/* voltavam
// 401 e o sync com o Google parava em silêncio — com a aba aberta o dia todo.
sb.auth.onAuthStateChange((event, novaSessao)=>{
  if(novaSessao) session = novaSessao;
  if(event === 'PASSWORD_RECOVERY' && !recuperandoSenha){
    recuperandoSenha = true;
    marcarSenhaPendente(true);
    checkAuth();
  }
  if(event === 'SIGNED_OUT'){
    recuperandoSenha = false;
    marcarSenhaPendente(false);
  }
  // Saiu em outra aba (ou o refresh token morreu): esta aba não pode seguir
  // mostrando dados de uma sessão que não existe mais.
  if(event === 'SIGNED_OUT' && session && document.getElementById('app').style.display !== 'none'){
    location.reload();
  }
});

const THEMES = {
  // Os tons do Sereno em vidro fosco mais branco, com o desfoque e as formas
  // em pílula do body.theme-vidro no CSS.
  vidro: {
    name: 'Vidro',
    vidro: true,
    bg: '#EEF2F5',
    p5: '#C9D5E0', p6: '#A9BCCD', p8: '#7D9AB3',
    accent: '#5B7A94', accentHover: '#4A6680',
    text: '#3B4A5A', textStrong: '#2A3644',
    textMuted: '#6E879E', textSoft: '#9AAFC2',
    glass: 'rgba(255, 255, 255, 0.50)',
    glassStrong: 'rgba(255, 255, 255, 0.72)',
    glassHover: 'rgba(255, 255, 255, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.90)',
    glassBorderSoft: 'rgba(255, 255, 255, 0.70)'
  },
  bluegray: {
    name: 'Sereno',
    bg: '#E9EDF1',
    p5: '#B7C6D4', p6: '#9AAFC2', p8: '#7D9AB3',
    accent: '#5B7A94', accentHover: '#4A6680',
    text: '#3B4A5A', textStrong: '#2A3644',
    textMuted: '#7D9AB3', textSoft: '#9AAFC2'
  },
  rose: {
    name: 'Rosa',
    bg: '#FCEFEF',
    p5: '#FFACAB', p6: '#FF8B84', p8: '#D95F5A',
    accent: '#B84C48', accentHover: '#933A36',
    text: '#4A2A2A', textStrong: '#2E1717',
    textMuted: '#B57676', textSoft: '#D9A8A6'
  },
  mint: {
    name: 'Menta',
    bg: '#EAF5F4',
    p5: '#A1E0DD', p6: '#5CC2C6', p8: '#4A9B9E',
    accent: '#3F8285', accentHover: '#2F6669',
    text: '#1F4444', textStrong: '#0F2828',
    textMuted: '#6BA0A2', textSoft: '#A0C4C6'
  },
  lavender: {
    name: 'Lavanda',
    bg: '#F3EDF5',
    p5: '#D9C4E0', p6: '#B8A2C7', p8: '#9B85B0',
    accent: '#7D6395', accentHover: '#634A78',
    text: '#3D2C4A', textStrong: '#241A2E',
    textMuted: '#9080A0', textSoft: '#B3A5C0'
  },
  sky: {
    name: 'Céu',
    bg: '#EAF2F9',
    p5: '#B4D3E8', p6: '#88A8D2', p8: '#5A7EAF',
    accent: '#4568A0', accentHover: '#345183',
    text: '#2C3E5C', textStrong: '#1A2537',
    textMuted: '#7A9AB5', textSoft: '#9EB8CB'
  },
  sunset: {
    name: 'Pêssego',
    bg: '#FBEEE4',
    p5: '#FDBBBA', p6: '#F5A08D', p8: '#D4826B',
    accent: '#B96548', accentHover: '#9B4E36',
    text: '#4F2E1F', textStrong: '#2F1B12',
    textMuted: '#B58472', textSoft: '#D6A997'
  },
  graphite: {
    name: 'Grafite',
    dark: true,
    bg: '#141821',
    p5: '#2A3140', p6: '#3D4557', p8: '#5A6478',
    accent: '#C7CDD6', accentHover: '#DDE2E9',
    text: '#E5E7EB', textStrong: '#FFFFFF',
    textMuted: '#9CA3AF', textSoft: '#6B7280',
    accentText: '#141821',
    glass: 'rgba(28, 33, 44, 0.55)',
    glassStrong: 'rgba(36, 42, 54, 0.75)',
    glassHover: 'rgba(45, 52, 66, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
    glassBorderSoft: 'rgba(255, 255, 255, 0.06)',
    navAtivo: 'rgba(52, 60, 76, 0.92)',
    line: 'rgba(255, 255, 255, 0.07)',
    lineStrong: 'rgba(255, 255, 255, 0.14)'
  }
};

let currentTheme = 'vidro';

function applyTheme(name){
  const t = THEMES[name] || THEMES.vidro;
  // Tema salvo que não existe mais (o Grêmio saiu) cai no padrão, o Vidro.
  currentTheme = THEMES[name] ? name : 'vidro';
  const r = document.documentElement.style;
  r.setProperty('--bg-base', t.bg);
  r.setProperty('--palette-5', t.p5);
  r.setProperty('--palette-6', t.p6);
  r.setProperty('--palette-8', t.p8);
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent-hover', t.accentHover);
  r.setProperty('--accent-text', t.accentText || '#ffffff');
  r.setProperty('--text', t.text);
  r.setProperty('--text-strong', t.textStrong);
  r.setProperty('--text-muted', t.textMuted);
  r.setProperty('--text-soft', t.textSoft);
  r.setProperty('--glass', t.glass || 'rgba(255,255,255,0.45)');
  r.setProperty('--modal-glass', t.dark ? (t.glass || 'rgba(255,255,255,0.45)') : (t.glassStrong || 'rgba(255,255,255,0.65)'));
  r.setProperty('--glass-strong', t.glassStrong || 'rgba(255,255,255,0.65)');
  r.setProperty('--glass-hover', t.glassHover || 'rgba(255,255,255,0.72)');
  r.setProperty('--glass-border', t.glassBorder || 'rgba(255,255,255,0.75)');
  r.setProperty('--glass-border-soft', t.glassBorderSoft || 'rgba(255,255,255,0.5)');
  r.setProperty('--nav-ativo', t.navAtivo || 'rgba(255,255,255,0.9)');
  r.setProperty('--line', t.line || 'rgba(122, 142, 162, 0.14)');
  r.setProperty('--line-strong', t.lineStrong || 'rgba(122, 142, 162, 0.22)');
  document.body.classList.toggle('theme-vidro', !!t.vidro);
  // A chamada segue o tema, mas o verde de quem fala e o vermelho de fechado
  // precisam de outro tom no fundo escuro do Grafite.
  document.body.classList.toggle('theme-escuro', !!t.dark);
  document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
  // A janela flutuante copia o tema quando abre; trocar de tema com ela
  // aberta leva a troca para lá também.
  // (try: o applyTheme pode rodar antes do let da janela existir.)
  try{ if(janelaFlutuante) copiarTemaParaJanela(janelaFlutuante.win.document); }catch(e){}
  // A barra do navegador no celular ficava sempre no azul-acinzentado do
  // tema padrão, mesmo com o Grafite escuro na tela.
  const metaCor = document.querySelector('meta[name="theme-color"]');
  if(metaCor) metaCor.setAttribute('content', t.bg);
}

function toggleSidebar(){
  const collapsed = document.getElementById('app').classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

function openSettings(){
  document.getElementById('s-name').value = getUserName();
  document.getElementById('s-sound').checked = state.soundEnabled !== false;
  document.getElementById('s-hide-date-done').checked = !!state.hideDateOnDone;
  const nConcluidas = state.metas.lista.filter(g=>g.status === 'concluida').length;
  document.getElementById('s-historico-metas').textContent = nConcluidas ? `Ver histórico (${nConcluidas})` : 'Ver histórico';
  renderMyAvatar('settings-avatar-preview', getUserName());
  rascunhoNome = {fonte: state.minhaFonteNome || null, cor: state.minhaCorNome || null};
  desenharEscolhaDeFonte();
  const grid = document.getElementById('theme-grid');
  // Cada tema vira um quadro em miniatura: o fundo, três colunas nos tons
  // dele e o accent no botão — mais fácil de reconhecer que cinco quadradinhos.
  grid.innerHTML = Object.entries(THEMES).map(([key, t])=>`
    <button class="theme-card ${key===currentTheme?'selected':''}" role="radio" aria-checked="${key===currentTheme}" data-theme="${key}" onclick="selectTheme('${key}')">
      <span class="theme-preview" style="background:${t.bg}" aria-hidden="true">
        <span style="background:${t.p5}"></span><span style="background:${t.p6}"></span><span style="background:${t.p8}"></span>
        <i style="background:${t.accent}"></i>
      </span>
      <span class="theme-card-name">${t.name}</span>
    </button>
  `).join('');
  renderSettingsColumnsList();
  renderSettingsRoutinesList();
  updateGoogleStatusUI();
  abrirSecaoConfig(secaoConfig, false);
  document.getElementById('settings-modal').classList.add('open');
}

// Seção aberta nas Configurações; volta na mesma ao reabrir na mesma visita.
let secaoConfig = 'conta';

function abrirSecaoConfig(secao, focar){
  secaoConfig = secao;
  document.querySelectorAll('#settings-modal .set-aba').forEach(b=>{
    const ativa = b.dataset.secao === secao;
    b.setAttribute('aria-selected', ativa);
    b.tabIndex = ativa ? 0 : -1;
    if(ativa && focar) b.focus();
  });
  document.querySelectorAll('#settings-modal .set-painel').forEach(p=>{
    p.hidden = p.id !== `set-${secao}`;
  });
  const ativa = document.querySelector(`#settings-modal .set-aba[data-secao="${secao}"]`);
  if(ativa && ativa.scrollIntoView) ativa.scrollIntoView({block: 'nearest', inline: 'nearest'});
  const paineis = document.querySelector('#settings-modal .set-paineis');
  if(paineis) paineis.scrollTop = 0;
}

// Setas trocam de seção, como numa lista de abas de verdade.
document.addEventListener('keydown', (e)=>{
  const aba = e.target.closest && e.target.closest('#settings-modal .set-aba');
  if(!aba || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const abas = Array.from(document.querySelectorAll('#settings-modal .set-aba'));
  const i = abas.indexOf(aba);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? abas.length - 1
    : (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
  e.preventDefault();
  abrirSecaoConfig(abas[n].dataset.secao, true);
});

const DOW_LETTERS = ['D','S','T','Q','Q','S','S'];

function renderSettingsRoutinesList(){
  const wrap = document.getElementById('settings-routines-list');
  if(!wrap) return;
  if(!state.routines || state.routines.length === 0){
    wrap.innerHTML = `<div class="empty" style="padding:16px 8px;font-size:12px;"><strong>Nenhuma rotina ainda.</strong>Crie uma acima.</div>`;
    return;
  }
  wrap.innerHTML = state.routines.map(r=>{
    const daysLabel = DOW_LETTERS.map((l,i)=>`<span style="opacity:${r.weekdays.includes(i)?1:0.3};font-weight:${r.weekdays.includes(i)?600:400};">${l}</span>`).join(' ');
    return `
      <div class="settings-col-item">
        <div class="settings-col-dot" style="background:${r.active?'var(--accent)':'var(--text-soft)'}"></div>
        <div class="settings-col-name" style="flex:1;">
          ${esc(r.title)}${!r.active ? ' <span style="color:var(--text-soft);font-size:10.5px;">(pausada)</span>' : ''}
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);margin-top:2px;">${daysLabel}</div>
        </div>
        <button class="settings-col-edit" onclick="toggleRoutineActive('${r.id}')" title="${r.active?'Pausar':'Reativar'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.active ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' : '<polygon points="5 3 19 12 5 21 5 3"/>'}</svg>
        </button>
        <button class="settings-col-edit" onclick="openRoutineModal('${r.id}')" title="Editar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
      </div>`;
  }).join('');
}

let editingRoutineId = null;

function openRoutineModal(id){
  editingRoutineId = id || null;
  const title = document.getElementById('routine-modal-title');
  document.getElementById('rt-status').innerHTML = getColumns().map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('');
  document.querySelectorAll('#rt-days .weekday-btn').forEach(b=>b.classList.remove('selected'));
  if(id){
    const r = state.routines.find(x=>x.id===id);
    if(!r) return;
    title.textContent = 'Editar rotina';
    document.getElementById('rt-title').value = r.title;
    document.getElementById('rt-client').value = r.client || '';
    document.getElementById('rt-status').value = r.status;
    if(!document.getElementById('rt-status').value) document.getElementById('rt-status').value = getColumns()[0].key;
    document.getElementById('rt-priority').value = r.priority;
    document.getElementById('rt-time').value = r.time || '';
    r.weekdays.forEach(d=>{
      const btn = document.querySelector(`#rt-days .weekday-btn[data-day="${d}"]`);
      if(btn) btn.classList.add('selected');
    });
    document.getElementById('rt-active-field').style.display = '';
    document.getElementById('rt-active').checked = r.active;
    document.getElementById('rt-delete').style.display = '';
  }else{
    title.textContent = 'Nova rotina';
    document.getElementById('rt-title').value = '';
    document.getElementById('rt-client').value = '';
    document.getElementById('rt-status').value = getColumns()[0].key;
    document.getElementById('rt-priority').value = 'normal';
    document.getElementById('rt-time').value = '';
    document.getElementById('rt-active-field').style.display = 'none';
    document.getElementById('rt-delete').style.display = 'none';
  }
  document.getElementById('routine-modal').classList.add('open');
  setTimeout(()=>document.getElementById('rt-title').focus(), 50);
}

function closeRoutineModal(){
  document.getElementById('routine-modal').classList.remove('open');
  editingRoutineId = null;
}

async function saveRoutineModal(){
  const title = document.getElementById('rt-title').value.trim();
  if(!title){document.getElementById('rt-title').focus();return;}
  const weekdays = [...document.querySelectorAll('#rt-days .weekday-btn.selected')].map(b=>+b.dataset.day);
  if(weekdays.length === 0){showToast('Escolha ao menos um dia da semana');return;}
  const data = {
    title,
    client: document.getElementById('rt-client').value.trim(),
    status: document.getElementById('rt-status').value,
    priority: document.getElementById('rt-priority').value,
    time: document.getElementById('rt-time').value,
    weekdays
  };
  // closeRoutineModal zera editingRoutineId: guardar antes, senão o toast
  // dizia "Rotina criada" toda vez que se editava uma.
  const editando = editingRoutineId;
  let ok;
  if(editando){
    ok = await updateRoutineRemote(editando, data);
    const r = state.routines.find(x=>x.id===editando);
    const activeChecked = document.getElementById('rt-active').checked;
    if(ok && r && activeChecked !== r.active){
      const {error} = await sb.from('routines').update({active: activeChecked}).eq('id', editando);
      if(error){console.error(error);showToast('Não deu para pausar ou reativar a rotina. Tente de novo em instantes.', 'erro');ok = false;}
      else r.active = activeChecked;
    }
    // Incluir o dia de hoje (ou reativar) devia gerar a tarefa já, não só
    // na próxima volta do ciclo de 30 minutos.
    if(ok) await generateRoutineInstances();
  }else{
    ok = await createRoutine(data);
  }
  if(ok){
    closeRoutineModal();
    renderSettingsRoutinesList();
    showToast(editando ? 'Rotina atualizada' : 'Rotina criada');
  }
}

async function deleteRoutine(){
  if(!editingRoutineId) return;
  if(!await confirmar('As tarefas já criadas continuam existindo — só param de se repetir.', {title:'Excluir esta rotina?', okLabel:'Excluir rotina'})) return;
  const ok = await deleteRoutineRemote(editingRoutineId);
  if(ok){
    closeRoutineModal();
    renderSettingsRoutinesList();
    showToast('Rotina excluída');
  }
}

function renderSettingsColumnsList(){
  const wrap = document.getElementById('settings-columns-list');
  if(!wrap) return;
  const cols = getColumns();
  wrap.innerHTML = cols.map((c, i)=>`
    <div class="settings-col-item" draggable="true" data-key="${c.key}" ondragstart="colDragStart(event,'${c.key}')" ondragover="colDragOver(event)" ondragleave="colDragLeave(event)" ondrop="colDrop(event,'${c.key}')" ondragend="colDragEnd(event)">
      <div class="settings-col-handle" aria-hidden="true" title="Arrastar para reordenar"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></div>
      <div class="settings-col-dot" style="background:${corSegura(c.color)}"></div>
      <div class="settings-col-name">${esc(c.name)}</div>
      <button class="settings-col-edit" onclick="moveColumn('${c.key}', -1)" ${i === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover ${esc(c.name)} para cima">
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="settings-col-edit" onclick="moveColumn('${c.key}', 1)" ${i === cols.length - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover ${esc(c.name)} para baixo">
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="settings-col-edit" onclick="openColumnModal('${c.key}')" title="Editar" aria-label="Editar ${esc(c.name)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
    </div>
  `).join('');
}

let dragColKey = null;
function colDragStart(e, key){
  dragColKey = key;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(()=>e.target.classList.add('dragging'), 0);
}
function colDragEnd(e){
  e.target.classList.remove('dragging');
  dragColKey = null;
}
function colDragOver(e){
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function colDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
// Arrastar nao alcanca quem usa teclado ou leitor de tela; estas setas fazem a
// mesma reordenacao.
async function moveColumn(key, delta){
  const cols = getColumns();
  const i = cols.findIndex(c=>c.key === key);
  const alvo = i + delta;
  if(i === -1 || alvo < 0 || alvo >= cols.length) return;
  await reorderColumns(key, cols[alvo].key);
  renderSettingsColumnsList();
  const botao = document.querySelector(`.settings-col-item[data-key="${key}"] .settings-col-edit`);
  if(botao) botao.focus();
}

async function colDrop(e, targetKey){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(!dragColKey || dragColKey === targetKey) return;
  const fromKey = dragColKey;
  dragColKey = null;
  await reorderColumns(fromKey, targetKey);
  renderSettingsColumnsList();
}

function closeSettings(){
  const original = state.savedTheme || 'vidro';
  if(currentTheme !== original) applyTheme(original);
  document.getElementById('settings-modal').classList.remove('open');
}

function selectTheme(name){
  applyTheme(name);
  document.querySelectorAll('.theme-card').forEach(c=>{
    c.classList.toggle('selected', c.dataset.theme === name);
    c.setAttribute('aria-checked', c.dataset.theme === name);
  });
}

async function saveSettings(){
  const name = document.getElementById('s-name').value.trim();
  if(!name){showToast('Escreva seu nome para continuar.', 'erro');document.getElementById('s-name').focus();return;}
  const soundEnabled = document.getElementById('s-sound').checked;
  const hideDateOnDone = document.getElementById('s-hide-date-done').checked;
  localStorage.setItem('hideDateOnDone', hideDateOnDone ? '1' : '0');
  state.hideDateOnDone = hideDateOnDone;
  const {error} = await sb.from('profiles').upsert({
    id: session.user.id,
    name,
    theme: currentTheme,
    avatar_url: state.myAvatarUrl,
    sound_enabled: soundEnabled,
    updated_at: new Date().toISOString()
  });
  if(error){console.error(error);showToast('Não deu para salvar. Confira a conexão e tente de novo.', 'erro');return;}
  state.myName = name;
  state.savedTheme = currentTheme;
  state.soundEnabled = soundEnabled;
  await salvarFonteNome();
  document.getElementById('settings-modal').classList.remove('open');
  render();
  if(chamada) desenharChamada();
  document.getElementById('user-name-display').textContent = name;
  aplicarFonteNoMeuNome();
  atualizarDicaUsuario();
  renderMyAvatar('user-avatar', name);
}

// Nome longo termina em "…" na barra lateral; inteiro ao passar o mouse.
function atualizarDicaUsuario(){
  const info = document.querySelector('.side-user-info');
  if(info) info.title = state.myName || '';
}
const DEFAULT_COLUMNS = [
  {key:'todo', name:'A Fazer', color:'#9AAFC2', type:'active'},
  {key:'waiting', name:'Aguardando', color:'#C9A868', type:'waiting'},
  {key:'doing', name:'Em Andamento', color:'#5B7A94', type:'active'},
  {key:'done', name:'Concluído', color:'#8FA88C', type:'done'}
];
// Oito famílias em quatro tons. Na grade, cada coluna é uma família e cada
// linha um tom: o olho corre o matiz na horizontal e a intensidade na
// vertical. Antes eram 32 quadrados em fileiras quebradas ao acaso.
const FAMILIAS_COR = [
  {nome:'Azul-acinzentado', cores:['#9AAFC2','#7D9AB3','#5B7A94','#3D5578']},
  {nome:'Mostarda',         cores:['#C9A868','#D4A93F','#B8863D','#8F6A2E']},
  {nome:'Verde',            cores:['#8FA88C','#5CA05A','#3D7A4A','#2C5F3B']},
  {nome:'Terracota',        cores:['#C48577','#D4826B','#B85C48','#933A2C']},
  {nome:'Roxo',             cores:['#B084CC','#9B5FBF','#7A3FA0','#5C2C7A']},
  {nome:'Turquesa',         cores:['#5CC2C6','#3D9FA3','#2C7A7D','#1F5A5C']},
  {nome:'Rosa',             cores:['#E0899E','#C9587A','#A83D5C','#822C46']},
  {nome:'Cinza',            cores:['#6B7280','#4B5563','#374151','#1F2937']}
];
const TONS_COR = ['claro', 'médio', 'escuro', 'profundo'];
const COLUMN_COLOR_PRESETS = FAMILIAS_COR.flatMap(f=>f.cores);
let selectedColumnColor = COLUMN_COLOR_PRESETS[0];
let editingColumnKey = null;

function getColumns(){
  return (state.columns && state.columns.length) ? state.columns : DEFAULT_COLUMNS;
}

// Colunas vêm do banco e, num projeto compartilhado, qualquer editor escreve
// nelas. A chave entra crua em onclick="...('${key}')" e em data-status em
// vários templates: uma chave com aspas executava script no navegador de todos
// os membros. Validar na carga fecha isso em todos os pontos de uso de uma vez.
const CHAVE_COLUNA = /^[A-Za-z0-9_-]{1,64}$/;
const TIPOS_COLUNA = ['active', 'waiting', 'done'];
function normalizarColunas(lista){
  if(!Array.isArray(lista)) return null;
  const vistas = new Set();
  const out = [];
  lista.forEach(c=>{
    if(!c || !CHAVE_COLUNA.test(String(c.key)) || vistas.has(c.key)) return;
    vistas.add(c.key);
    out.push({
      key: c.key,
      name: String(c.name == null || c.name === '' ? c.key : c.name).slice(0, 80),
      color: corSegura(c.color),
      type: TIPOS_COLUNA.includes(c.type) ? c.type : 'active',
      hidden: !!c.hidden
    });
  });
  return out.length ? out : null;
}

function getProjectColumns(project){
  return (project && project.columns && project.columns.length) ? project.columns : DEFAULT_COLUMNS;
}
function columnsForTask(t){
  if(t.project_id){
    const p = state.projects.find(x=>x.id===t.project_id);
    if(p) return getProjectColumns(p);
  }
  return getColumns();
}
function getColumnForTask(t){
  const cols = columnsForTask(t);
  return cols.find(c=>c.key===t.status) || {key:t.status, name:t.status, color:'#9AAFC2', type:'active'};
}
function taskColumnName(t){ return getColumnForTask(t).name; }
// Cores vao direto para dentro de atributos style=. Elas vem do banco e, num
// projeto compartilhado, quem edita o projeto escreve nelas — validar aqui
// fecha o buraco em todos os pontos de uso de uma vez.
const COR_PADRAO = '#9AAFC2';
function corSegura(v){
  return /^#[0-9a-fA-F]{3,8}$/.test(String(v || '').trim()) ? String(v).trim() : COR_PADRAO;
}
function taskColumnColor(t){ return corSegura(getColumnForTask(t).color); }
function taskColumnType(t){ return getColumnForTask(t).type; }
function taskDotStyle(t){
  const col = getColumnForTask(t);
  const cls = col.type === 'waiting' ? 'dot-hollow' : (col.type === 'done' ? 'dot-done' : '');
  return {cls, style: `--col-color:${taskColor(t)}`};
}

async function persistColumns(){
  const {error} = await sb.from('profiles').update({kanban_columns: state.columns}).eq('id', session.user.id);
  if(error){console.error(error);showToast('Não deu para salvar as colunas. Tente de novo em instantes.', 'erro');return false;}
  return true;
}

// input[type=color] só aceita #rrggbb; corSegura deixa passar #abc e #rrggbbaa.
function hex6(v){
  let h = corSegura(v).slice(1);
  if(h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c=>c + c).join('');
  else if(h.length === 6 || h.length === 8) h = h.slice(0, 6);
  else return COR_PADRAO.toUpperCase();
  return '#' + h.toUpperCase();
}

// Decide a cor do check sobre o quadrado: branco nas cores escuras, escuro
// nas claras (luminância relativa, a mesma conta do WCAG).
function corEhClara(cor){
  const h = hex6(cor).slice(1);
  const [r, g, b] = [0, 2, 4].map(i=>{
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

function renderColorSwatches(){
  const wrap = document.getElementById('col-color-swatches');
  if(!wrap) return;
  wrap.innerHTML = TONS_COR.map((tom, i)=>FAMILIAS_COR.map(f=>{
    const c = f.cores[i];
    return `<button type="button" role="radio" class="color-swatch-btn${corEhClara(c) ? ' claro' : ''}" style="--sw:${c}" data-cor="${c}" aria-label="${f.nome} ${tom}" title="${f.nome} ${tom}" onclick="selectColumnColor('${c}')"></button>`;
  }).join('')).join('');
  marcarCorDaColuna();
}

function selectColumnColor(c){
  selectedColumnColor = hex6(c);
  marcarCorDaColuna();
}

// Atualiza seleção, prévia e campos sem redesenhar a grade: redesenhar
// trocava os botões a cada clique e o foco do teclado se perdia.
function marcarCorDaColuna(){
  const atual = hex6(selectedColumnColor);
  const botoes = [...document.querySelectorAll('#col-color-swatches .color-swatch-btn')];
  let achou = false;
  botoes.forEach(b=>{
    const sel = b.dataset.cor === atual;
    if(sel) achou = true;
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-checked', String(sel));
    b.tabIndex = sel ? 0 : -1;
  });
  // Cor própria: nada da grade fica marcado, e o primeiro quadrado recebe o Tab.
  if(!achou && botoes.length) botoes[0].tabIndex = 0;
  const pick = document.getElementById('col-color-pick');
  if(pick){
    pick.classList.toggle('selected', !achou);
    pick.style.setProperty('--sw', atual);
  }
  const nativo = document.getElementById('col-color-native');
  if(nativo) nativo.value = atual;
  const hex = document.getElementById('col-color-hex');
  if(hex && document.activeElement !== hex){
    hex.value = atual;
    hex.removeAttribute('aria-invalid');
  }
  const prev = document.getElementById('col-preview');
  if(prev) prev.style.setProperty('--col-color', atual);
}

// Aceita com ou sem "#", em 3 ou 6 dígitos. Só aplica quando o código está
// completo; no meio da digitação a prévia fica na última cor válida.
function digitarCorHex(input){
  let v = input.value.trim();
  if(v && v[0] !== '#') v = '#' + v;
  const valido = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
  if(valido){
    input.removeAttribute('aria-invalid');
    selectColumnColor(v);
  }else if(v.length >= 7){
    input.setAttribute('aria-invalid', 'true');
  }
}

// Setas andam pela grade como num grupo de rádio: mover já escolhe a cor.
function teclaGradeCores(e){
  const passo = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: FAMILIAS_COR.length, ArrowUp: -FAMILIAS_COR.length}[e.key];
  if(passo === undefined) return;
  const botoes = [...document.querySelectorAll('#col-color-swatches .color-swatch-btn')];
  const i = botoes.indexOf(document.activeElement);
  const j = i + passo;
  if(i === -1 || j < 0 || j >= botoes.length) return;
  e.preventDefault();
  botoes[j].focus();
  selectColumnColor(botoes[j].dataset.cor);
}

function atualizarPreviewColuna(){
  const el = document.getElementById('col-preview-nome');
  if(el) el.textContent = document.getElementById('col-name').value.trim() || 'Nova coluna';
}

function openStatusDetail(filterKey, label){
  document.getElementById('status-modal-add-btn').style.display = 'none';
  // O nome da coluna e escrito pelo usuario; deriva-lo aqui evita ter que
  // escapar HTML e string JS ao mesmo tempo no onclick.
  if(!label){
    const col = getColumns().find(c=>c.key === filterKey.replace('col:', ''));
    label = col ? col.name : 'Pendencias';
  }
  let list;
  if(filterKey === 'overdue'){
    list = personalTasks().filter(t=>taskColumnType(t)!=='done' && dateStatus(t.date)==='overdue');
  } else {
    // Mesma regra da contagem no painel (statusVisivel); com t.status===key a
    // lista podia vir vazia num card que mostrava 3.
    const key = filterKey.replace('col:', '');
    const cols = getColumns();
    list = personalTasks().filter(t=>statusVisivel(t, cols)===key);
  }
  list = sortByDateThenPriority(list);

  document.getElementById('status-modal-title').textContent = label;
  const body = document.getElementById('status-modal-body');
  if(list.length === 0){
    body.innerHTML = `<div class="empty"><strong>Nada por aqui.</strong>Nenhuma tarefa nessa categoria.</div>`;
  } else {
    body.innerHTML = list.map(t=>{
      const isDone = taskColumnType(t) === 'done';
      const isUrgent = t.priority === 'urgent';
      const isHigh = t.priority === 'high';
      const badge = isUrgent
        ? '<span class="priority-badge urgent">Urgente</span>'
        : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
      const cls = isDone ? 'done-highlight' : (isUrgent ? 'urgent' : (isHigh ? 'high' : ''));
      const rowStyle = isDone ? `--col-color:${taskColumnColor(t)};` : '';
      const dot = taskDotStyle(t);
      return `
        <div class="task-row ${cls}" style="${rowStyle}" role="button" tabindex="0" onclick="closeStatusModal();openModal('${t.id}')">
          <div class="task-check ${dot.cls}" style="${dot.style}"></div>
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-date ${taskDateStatus(t)}">${dateWithTime(t)}</div>
          <span class="task-row-break"></span>
          ${badge}
          <div class="task-client">${esc(t.client || '—')}</div>
        </div>`;
    }).join('');
  }
  tornarClicaveisAcessiveis(body);
  document.getElementById('status-modal').classList.add('open');
}

function closeStatusModal(){
  document.getElementById('status-modal').classList.remove('open');
}

let editingColumnProjectId = null;

function openColumnModal(key, projectId){
  editingColumnKey = key || null;
  editingColumnProjectId = projectId || null;
  const modal = document.getElementById('column-modal');
  const title = document.getElementById('column-modal-title');
  const delBtn = document.getElementById('col-delete');
  const cols = projectId ? getProjectColumns(state.projects.find(p=>p.id===projectId)) : getColumns();
  if(key){
    const col = cols.find(c=>c.key===key) || {name:key, color:COLUMN_COLOR_PRESETS[0]};
    title.textContent = 'Editar coluna';
    document.getElementById('col-name').value = col.name;
    document.getElementById('col-hidden').checked = !!col.hidden;
    selectedColumnColor = hex6(col.color);
    delBtn.style.display = cols.length > 1 ? '' : 'none';
  } else {
    title.textContent = 'Nova coluna';
    document.getElementById('col-name').value = '';
    document.getElementById('col-hidden').checked = false;
    selectedColumnColor = COLUMN_COLOR_PRESETS[0];
    delBtn.style.display = 'none';
  }
  renderColorSwatches();
  atualizarPreviewColuna();
  modal.classList.add('open');
  setTimeout(()=>document.getElementById('col-name').focus(), 50);
}

function closeColumnModal(){
  document.getElementById('column-modal').classList.remove('open');
  editingColumnKey = null;
  editingColumnProjectId = null;
}

async function persistProjectColumns(projectId, cols){
  const {error} = await sb.from('projects').update({columns: cols}).eq('id', projectId);
  if(error){console.error(error);showToast('Não deu para salvar as colunas do projeto. Tente de novo em instantes.', 'erro');return false;}
  const p = state.projects.find(x=>x.id===projectId);
  if(p) p.columns = cols;
  return true;
}

async function saveColumn(){
  const name = document.getElementById('col-name').value.trim();
  if(!name){document.getElementById('col-name').focus();return;}
  const hidden = document.getElementById('col-hidden').checked;

  if(editingColumnProjectId){
    const p = state.projects.find(x=>x.id===editingColumnProjectId);
    if(!p) return;
    let cols = JSON.parse(JSON.stringify(getProjectColumns(p)));
    if(editingColumnKey){
      const col = cols.find(c=>c.key===editingColumnKey);
      if(col){col.name = name;col.color = selectedColumnColor;col.hidden = hidden;}
    } else {
      const key = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
      cols.push({key, name, type: 'active', color: selectedColumnColor, hidden});
    }
    const ok = await persistProjectColumns(editingColumnProjectId, cols);
    if(ok){closeColumnModal();render();}
    return;
  }

  if(!state.columns) state.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  if(editingColumnKey){
    const col = state.columns.find(c=>c.key===editingColumnKey);
    if(col){col.name = name;col.color = selectedColumnColor;col.hidden = hidden;}
  } else {
    const key = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    state.columns.push({key, name, type: 'active', color: selectedColumnColor, hidden});
  }
  const ok = await persistColumns();
  if(ok){
    closeColumnModal();
    render();
    if(document.getElementById('settings-modal').classList.contains('open')) renderSettingsColumnsList();
  }
}

async function deleteColumn(){
  if(!editingColumnKey) return;

  if(editingColumnProjectId){
    const p = state.projects.find(x=>x.id===editingColumnProjectId);
    if(!p) return;
    let cols = JSON.parse(JSON.stringify(getProjectColumns(p)));
    if(cols.length <= 1){showToast('O quadro precisa de pelo menos uma coluna — crie outra antes de excluir esta.', 'erro');return;}
    const hasTasks = state.tasks.some(t=>t.project_id===editingColumnProjectId && t.status===editingColumnKey);
    if(hasTasks && !(await confirmar('As tarefas dela vão para a primeira coluna restante.', {title:'Excluir a coluna?', okLabel:'Excluir coluna'}))) return;
    const fallback = cols.find(c=>c.key !== editingColumnKey);
    const toMove = state.tasks.filter(t=>t.project_id===editingColumnProjectId && t.status===editingColumnKey);
    for(const t of toMove){
      t.completed_at = resolveCompletedAt(fallback.key, t.status, t.completed_at, cols);
      t.status = fallback.key;
      await updateTaskRemote(t.id, t);
    }
    cols = cols.filter(c=>c.key !== editingColumnKey);
    const ok = await persistProjectColumns(editingColumnProjectId, cols);
    if(ok){closeColumnModal();render();}
    return;
  }

  const cols = getColumns();
  if(cols.length <= 1){showToast('O quadro precisa de pelo menos uma coluna — crie outra antes de excluir esta.', 'erro');return;}
  const hasTasks = state.tasks.some(t=>!t.project_id && t.status===editingColumnKey);
  if(hasTasks && !(await confirmar('As tarefas dela vão para a primeira coluna restante.', {title:'Excluir a coluna?', okLabel:'Excluir coluna'}))) return;
  const fallback = cols.find(c=>c.key !== editingColumnKey);
  const toMove = state.tasks.filter(t=>!t.project_id && t.status===editingColumnKey);
  for(const t of toMove){
    t.completed_at = resolveCompletedAt(fallback.key, t.status, t.completed_at, cols);
    t.status = fallback.key;
    await updateTaskRemote(t.id, t);
  }
  state.columns = cols.filter(c=>c.key !== editingColumnKey);
  const ok = await persistColumns();
  if(ok){
    closeColumnModal();
    render();
    if(document.getElementById('settings-modal').classList.contains('open')) renderSettingsColumnsList();
  }
}

// Lista de colunas que vale para um contexto: as do projeto, ou as pessoais.
function colunasDe(projectId){
  return projectId ? getProjectColumns(state.projects.find(p=>p.id===projectId)) : getColumns();
}

function populateStatusSelect(selectId, currentValue, projectId){
  const sel = document.getElementById(selectId);
  const cols = colunasDe(projectId);
  sel.innerHTML = cols.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('');
  sel.value = currentValue;
  // Atribuir um value que nao existe entre as <option> deixa o select em "".
  // Sem esta rede, a tarefa era salva com status vazio e nunca mais aparecia.
  if(!sel.value && cols.length) sel.value = cols[0].key;
}

// Uma tarefa cujo status nao bate com nenhuma coluna (coluna excluida, ou o bug
// acima) era filtrada para fora de todas as colunas. Passa a cair na primeira,
// para poder ser vista e corrigida em vez de ficar presa no banco.
function statusVisivel(t, cols){
  if(cols.some(c=>c.key === t.status)) return t.status;
  return cols.length ? cols[0].key : t.status;
}

let state = {
  tasks: [],
  columns: null,
  myAvatarUrl: null,
  myName: null,
  recentClients: [],
  projects: [],
  pendingInvites: [],
  routines: [],
  view: 'dashboard',
  viewBeforeProject: null,
  currentProjectId: null,
  editingId: null,
  calDate: new Date(),
  calSelectedDate: null,
  projCalDate: new Date(),
  projCalSelectedDate: null,
  projectTasksView: visaoProjetoSalva(),
  miniCalDate: new Date(),
  dateFilter: 'all',
  filter: {client:'', status:'', search:'', project:'', assignee:'', tableDate:'all', kanbanClient:'', kanbanDate:'all', kanbanAssignee:'', kanbanSearch:'', kanbanTag:'', tag:''},
  hideDateOnDone: localStorage.getItem('hideDateOnDone') === '1',
  expandedCols: new Set(),
  selecting: false,
  selected: new Set(),
  ignoredEvents: new Set(),
  novidadesVistas: [],
  // Notas de cada projeto, carregadas quando a aba Notas abre:
  // {lista, semTabela, aberta (id), lendo (no celular, a nota ocupa a tela)}
  notasProjeto: {},
  // Conversa de cada canal de texto (o id do canal é a chave), carregada
  // quando o canal abre na aba Canais:
  // {projectId, lista, erro, temMais, rascunho, doFim (distância do fim da lista)}
  chatProjeto: {},
  metas: {lista: [], registros: {}, modo: {}, carregado: false, precisaSql: false, atual: null, viewAntes: null, calMes: null}
};

// Eventos que o usuário já descartou uma vez. Sem isto, a sincronização completa
// relista tudo e recria as tarefas que ele apagou de propósito.
async function loadIgnoredEvents(){
  const {data, error} = await sb.from('google_ignored_events').select('event_id');
  if(error) return;
  state.ignoredEvents = new Set((data || []).map(r=>r.event_id));
}

async function ignoreGoogleEvent(eventId){
  if(!eventId || state.ignoredEvents.has(eventId)) return;
  state.ignoredEvents.add(eventId);
  await sb.from('google_ignored_events')
    .upsert({user_id: session.user.id, event_id: eventId}, {onConflict: 'user_id,event_id'});
}

// Apagar uma tarefa criada no app remove o evento espelho no Google. Apagar uma
// que veio do Google não pode remover o compromisso real da agenda — só marca
// para não voltar.
async function forgetTaskInGoogle(task){
  const eventId = getEventId(task);
  if(!eventId) return;
  await ignoreGoogleEvent(eventId);
  if(task.from_google){
    await setEventId(task, null);
    return;
  }
  await deleteGoogleEvent(task);
}

function toggleSelectMode(){
  state.selecting = !state.selecting;
  state.selected.clear();
  skipEntranceOnce = true;
  render();
}

// Colunas marcadas como "oculta" ficam recolhidas numa faixa fina; isto só
// controla se estão abertas nesta sessão — não muda a marcação salva.
function toggleColExpanded(key){
  if(state.expandedCols.has(key)) state.expandedCols.delete(key);
  else state.expandedCols.add(key);
  skipEntranceOnce = true;
  render();
}

function toggleTaskSelection(id){
  if(state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  skipEntranceOnce = true;
  render();
}

// Cartões abrem a tarefa normalmente, mas viram alvo de seleção no modo em massa.
function cardClick(e, id){
  if(!state.selecting){ openModal(id); return; }
  e.preventDefault();
  e.stopPropagation();
  toggleTaskSelection(id);
}

function selectedTasks(){
  return state.tasks.filter(t=>state.selected.has(t.id));
}

function renderBulkBar(){
  if(!state.selecting) return '';
  const n = state.selected.size;
  return `
    <div class="bulk-bar">
      <div class="bulk-bar-count">${n === 0 ? 'Toque nas tarefas para selecionar' : `${n} selecionada${n!==1?'s':''}`}</div>
      <div class="bulk-bar-actions">
        <select class="select" id="bulk-move" ${n===0?'disabled':''} onchange="bulkMove(this.value);this.value='';">
          <option value="">Mover para…</option>
          ${getColumns().map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('')}
        </select>
        <button class="btn-danger" ${n===0?'disabled':''} onclick="bulkDelete()">Excluir</button>
      </div>
    </div>`;
}

// Só deixa agir sobre o que o usuário pode mesmo alterar. Mesma regra do
// tasks_update: tarefa pessoal, só o dono; tarefa de projeto, dono, editor ou
// participante do projeto, mesmo para quem criou a tarefa e hoje é
// visualizador (configuracoes_projeto.sql, SEC-085).
function canEditTask(t){
  if(!session || !session.user) return false;
  if(!t.project_id) return t.owner_id === session.user.id;
  return mexeEmTarefas(t.project_id);
}

async function bulkMove(status){
  if(!status) return;
  const editaveis = selectedTasks().filter(canEditTask);
  // O "Mover para…" lista as colunas pessoais. Tarefa de projeto selecionada
  // na coluna compartilhada recebia uma chave que não existe no quadro dela e
  // caía na primeira coluna do projeto.
  const list = editaveis.filter(t=>columnsForTask(t).some(c=>c.key===status));
  const ficaram = editaveis.length - list.length;
  if(list.length === 0){
    showToast(ficaram ? 'Tarefas de projeto se movem pelo quadro do próprio projeto.' : 'Nada que você possa mover', ficaram ? 'erro' : undefined);
    return;
  }

  let n = 0;
  for(const t of list){
    const prevStatus = t.status;
    const prevCompletedAt = t.completed_at;
    t.completed_at = resolveCompletedAt(status, prevStatus, t.completed_at, columnsForTask(t));
    t.status = status;
    if(await updateTaskRemote(t.id, t)){
      n++;
      await syncTaskToGoogle(t);
    }else{
      t.status = prevStatus;
      t.completed_at = prevCompletedAt;
    }
  }
  state.selected.clear();
  state.selecting = false;
  skipEntranceOnce = true;
  render();
  const extra = ficaram ? ` · ${ficaram} de projeto ${ficaram!==1?'ficaram onde estavam':'ficou onde estava'}` : '';
  showToast(`${n} tarefa${n!==1?'s':''} movida${n!==1?'s':''}${extra}`);
}

async function bulkDelete(){
  const list = selectedTasks().filter(canEditTask);
  if(list.length === 0){ showToast('Nada que você possa excluir'); return; }
  if(!await confirmar(`Isso também remove os eventos correspondentes no Google Calendar. Não tem como desfazer.`, {title:`Excluir ${list.length} tarefa${list.length!==1?'s':''}?`, okLabel:'Excluir'})) return;

  let n = 0;
  for(const t of list){
    await forgetTaskInGoogle(t);
    if(await deleteTaskRemote(t.id)){
      state.tasks = state.tasks.filter(x=>x.id !== t.id);
      n++;
    }
  }
  state.selected.clear();
  state.selecting = false;
  skipEntranceOnce = true;
  render();
  showToast(`${n} tarefa${n!==1?'s':''} excluída${n!==1?'s':''}`);
}

function matchesKanbanSearch(t, search){
  if(!search) return true;
  const s = search.toLowerCase();
  return (t.title||'').toLowerCase().includes(s) || (t.client||'').toLowerCase().includes(s) || (t.notes||'').toLowerCase().includes(s);
}

function matchesDateFilter(t, filter){
  if(filter === 'all') return true;
  if(!t.date) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  const [y,m,d] = t.date.split('-');
  const dt = new Date(+y, +m-1, +d);
  const diff = Math.round((dt-today)/86400000);
  if(filter === 'today') return diff <= 0;
  if(filter === 'next3') return diff <= 3;
  if(filter === 'week') return diff <= 7;
  if(filter === 'month') return diff <= 30;
  return true;
}

function setDateFilter(f){
  state.dateFilter = f;
  render();
}

function projectName(id){
  const p = state.projects.find(x=>x.id===id);
  return p ? p.name : null;
}

function isoDateFromTimestamp(ts){
  const dt = new Date(ts);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function lastSunday(){
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// Views pessoais (dashboard, calendário, alarmes, colunas normais do Kanban)
// só mostram tarefa de projeto quando ela é atribuída a mim — o quadro do
// projeto em si (renderProjectPage e as colunas compartilhadas do Kanban)
// continua mostrando tudo, atribuído ou não.
function isVisibleInPersonalViews(t){
  if(!t.project_id) return true;
  if(ehEvento(t)) return false;
  return t.assigned_to === session.user.id;
}

function personalTasks(){
  return state.tasks.filter(isVisibleInPersonalViews);
}

// Evento (reunião, call) de um projeto: tem dia e hora, aparece no Início e
// no Calendário do projeto, mas não é trabalho a mover pelo quadro.
function ehEvento(t){
  return t.kind === 'evento';
}

function isHiddenFromKanban(t){
  if(taskColumnType(t) !== 'done') return false;
  if(!t.completed_at) return true;
  return new Date(t.completed_at) < lastSunday();
}

// cols = colunas do quadro da tarefa. Usar sempre as pessoais (como antes)
// errava em tarefa de projeto: mover para o "Concluído" de um projeto cuja
// chave não existia nas colunas pessoais não marcava completed_at, e o cartão
// sumia do Kanban na hora (concluída sem data de conclusão = escondida).
function tipoDaColuna(cols, key){
  const c = cols.find(x=>x.key===key);
  return c ? c.type : 'active';
}
function resolveCompletedAt(newStatus, oldStatus, currentValue, cols, oldCols){
  const lista = cols || getColumns();
  const newType = tipoDaColuna(lista, newStatus);
  const oldType = oldStatus ? tipoDaColuna(oldCols || lista, oldStatus) : null;
  if(newType === 'done' && oldType !== 'done') return new Date().toISOString();
  if(newType !== 'done' && oldType === 'done') return null;
  return currentValue || null;
}

function priorityWeight(t){
  if(t.priority === 'urgent') return 4;
  if(dateStatus(t.date) === 'overdue' && taskColumnType(t) !== 'done') return 3.5;
  if(t.priority === 'high') return 3;
  if(dateStatus(t.date) === 'today') return 2;
  return 1;
}

function sortByDateThenPriority(list){
  const rawPriority = t => t.priority === 'urgent' ? 3 : t.priority === 'high' ? 2 : 1;
  return list.slice().sort((a,b)=>{
    if(!a.date && !b.date) return rawPriority(b) - rawPriority(a);
    if(!a.date) return 1;
    if(!b.date) return -1;
    if(a.date !== b.date) return a.date.localeCompare(b.date);
    return rawPriority(b) - rawPriority(a);
  });
}

async function checkAuth(){
  const {data} = await sb.auth.getSession();
  session = data.session;
  const appEl = document.getElementById('app');
  const authEl = document.getElementById('auth-screen');
  const onbEl = document.getElementById('onboarding-screen');
  if(!ALLOW_SIGNUP){
    document.getElementById('auth-switch').style.display = 'none';
  }
  if(session && recuperandoSenha){
    appEl.style.display = 'none';
    onbEl.classList.remove('show');
    authEl.classList.add('show');
    mostrarNovaSenha();
    return;
  }
  if(session){
    authEl.classList.remove('show');
    const {data: myProfile} = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if(!myProfile || !myProfile.name){
      appEl.style.display = 'none';
      onbEl.classList.add('show');
      const nameEl = document.getElementById('onboarding-name');
      setTimeout(()=>nameEl.focus(), 60);
      return;
    }
    onbEl.classList.remove('show');
    appEl.style.display = 'grid';
    appEl.classList.toggle('sidebar-collapsed', localStorage.getItem('sidebarCollapsed') === '1');
    state.myName = myProfile.name;
    state.myAvatarUrl = myProfile.avatar_url || null;
    state.minhaFonteNome = fonteDoPerfil(myProfile);
    state.minhaCorNome = corDoNome(myProfile);
    state.savedTheme = myProfile.theme || 'vidro';
    state.ordemProjetosPerfil = myProfile.ordem_projetos || null;
    state.soundEnabled = myProfile.sound_enabled !== false;
    state.novidadesVistas = Array.isArray(myProfile.novidades_vistas) ? myProfile.novidades_vistas : [];
    applyTheme(state.savedTheme);
    state.columns = normalizarColunas(myProfile.kanban_columns) || JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    document.getElementById('user-name-display').textContent = state.myName;
    aplicarFonteNoMeuNome();
    atualizarDicaUsuario();
    renderMyAvatar('user-avatar', state.myName);
    // A barra lateral aparece completa já no primeiro desenho: o Desafio só
    // depende do e-mail, e os projetos vêm da última visita até o banco responder.
    setupDesafioNav();
    restoreProjectsCache();
    // Em paralelo: uma consulta não precisa esperar a outra terminar. Só gerar
    // as rotinas precisa das tarefas e das rotinas já carregadas.
    await Promise.all([loadTasks(), loadRoutines(), loadProjects(), loadIgnoredEvents(), loadDesafio(), loadMetas(), loadGoogleSession()]);
    await generateRoutineInstances();
    setupRealtime();
    startRoutineCheckLoop();
    startAlarmChecker();
    updateGoogleStatusUI();
    safeRerender();
    if(isGoogleConnected()){
      startGoogleSyncLoop();
      runGoogleSync();
    }
    await handleGoogleRedirect();
    await aceitarConvitePendente();
    talvezMostrarFraseDoDia();
    talvezApresentarMetas();
  } else {
    appEl.style.display = 'none';
    onbEl.classList.remove('show');
    authEl.classList.add('show');
    document.getElementById('auth-sub').textContent = subtituloAuth();
    // Sem sessão não há o que proteger: quem entrar de novo com a senha antiga
    // não deve cair no formulário de senha nova.
    recuperandoSenha = false;
    marcarSenhaPendente(false);
    if(linkDoEmailInvalido && location.hash){
      showAuthMessage('Esse link expirou ou já foi usado. Peça um novo.');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
}

function subtituloAuth(){
  if(lerConvitePendente()){
    return authMode === 'signin'
      ? 'Você recebeu um convite para um projeto. Entre pra participar.'
      : 'Você recebeu um convite para um projeto. Crie sua conta pra participar.';
  }
  return authMode === 'signin' ? 'Acesse sua conta pra continuar de onde parou' : 'Crie sua conta em segundos';
}

async function saveOnboarding(){
  const nameEl = document.getElementById('onboarding-name');
  const errorEl = document.getElementById('onboarding-error');
  const btn = document.getElementById('onboarding-btn');
  const name = nameEl.value.trim();
  errorEl.classList.remove('show');
  if(!name){errorEl.textContent = 'Digite seu nome.';errorEl.classList.add('show');return;}
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  const {error} = await sb.from('profiles').upsert({id: session.user.id, name, theme: 'vidro', updated_at: new Date().toISOString()});
  btn.disabled = false;
  btn.textContent = 'Continuar';
  if(error){errorEl.textContent = error.message;errorEl.classList.add('show');return;}
  await checkAuth();
}

function toggleAuthMode(){
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  document.getElementById('auth-title').textContent = authMode === 'signin' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-sub').textContent = subtituloAuth();
  document.getElementById('auth-btn').textContent = authMode === 'signin' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-switch-text').textContent = authMode === 'signin' ? 'Não tem conta?' : 'Já tem conta?';
  document.getElementById('auth-switch-btn').textContent = authMode === 'signin' ? 'Cadastrar' : 'Entrar';
  document.getElementById('auth-forgot').hidden = authMode !== 'signin';
  document.getElementById('auth-error').classList.remove('show');
}

// A mensagem é a mesma exista o email ou não, para a tela não servir de
// consulta de quem tem conta.
async function esqueciSenha(){
  const email = document.getElementById('auth-email').value.trim();
  const btn = document.getElementById('auth-forgot-btn');
  document.getElementById('auth-error').classList.remove('show');
  if(!email){showAuthMessage('Digite seu email acima pra receber o link.');document.getElementById('auth-email').focus();return;}
  btn.disabled = true;
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin});
  btn.disabled = false;
  // Nem o erro aparece: o limite de envios do Supabase, por exemplo, é contado
  // por conta, e só dispara para email que existe.
  if(error) console.warn('resetPasswordForEmail:', error.message);
  showAuthMessage(`Se existir uma conta com ${email}, enviamos um link pra redefinir a senha.`, true);
}

function mostrarNovaSenha(){
  document.getElementById('auth-title').textContent = 'Nova senha';
  document.getElementById('auth-sub').textContent = 'Escolha uma senha nova pra sua conta';
  document.querySelector('#auth-screen form:not(#auth-recovery-form)').hidden = true;
  document.getElementById('auth-switch').hidden = true;
  document.getElementById('auth-recovery-form').hidden = false;
  document.getElementById('auth-recovery-sair').hidden = false;
  document.getElementById('auth-recovery-email').value = session.user.email || '';
  document.getElementById('auth-error').classList.remove('show');
  setTimeout(()=>document.getElementById('auth-new-password').focus(), 60);
}

async function sairDaRecuperacao(){
  await sb.auth.signOut();
  location.reload();
}

async function salvarNovaSenha(){
  const password = document.getElementById('auth-new-password').value;
  const confirmacao = document.getElementById('auth-new-password-confirm').value;
  const btn = document.getElementById('auth-recovery-btn');
  document.getElementById('auth-error').classList.remove('show');
  if(!password || !confirmacao){showAuthMessage('Preencha os dois campos.');return;}
  if(password.length < 6){showAuthMessage('A senha precisa ter pelo menos 6 caracteres.');return;}
  if(password !== confirmacao){showAuthMessage('As senhas não batem.');return;}
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  const {error} = await sb.auth.updateUser({password});
  btn.disabled = false;
  btn.textContent = 'Salvar senha';
  if(error){showAuthMessage(error.message);return;}
  recuperandoSenha = false;
  marcarSenhaPendente(false);
  document.getElementById('auth-recovery-form').hidden = true;
  document.getElementById('auth-recovery-sair').hidden = true;
  document.querySelector('#auth-screen form:not(#auth-recovery-form)').hidden = false;
  document.getElementById('auth-switch').hidden = false;
  document.getElementById('auth-title').textContent = 'Entrar';
  await checkAuth();
}

function showAuthMessage(text, isSuccess){
  const el = document.getElementById('auth-error');
  el.textContent = text;
  el.classList.toggle('is-success', !!isSuccess);
  el.classList.add('show');
}

async function doAuth(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-btn');
  errorEl.classList.remove('show');
  if(!email || !password){showAuthMessage('Preencha email e senha.');return;}
  btn.disabled = true;
  btn.textContent = 'Aguarde…';
  const fn = authMode === 'signin' ? 'signInWithPassword' : 'signUp';
  const {data, error} = await sb.auth[fn](
    authMode === 'signup'
      ? {email, password, options:{emailRedirectTo: lerConvitePendente() ? linkDoConvite(lerConvitePendente()) : location.origin}}
      : {email, password}
  );
  btn.disabled = false;
  btn.textContent = authMode === 'signin' ? 'Entrar' : 'Criar conta';
  if(error){showAuthMessage(error.message);return;}
  // Sem sessão após o cadastro significa que o Supabase exige confirmar o email.
  if(authMode === 'signup' && !data.session){
    showAuthMessage(`Conta criada. Enviamos um link de confirmação para ${email} — confirme para entrar.`, true);
    return;
  }
  await checkAuth();
}

// A conexão vive no backend (api/google/*): o refresh token fica no servidor e
// só o access token curto chega aqui, renovado sob demanda. Por isso o usuário
// conecta uma vez e continua conectado.
function isGoogleConnected(){
  return googleConnected;
}

function gcalKey(suffix){
  return `gcal_${suffix}_${session && session.user ? session.user.id : 'anon'}`;
}

function apiHeaders(){
  return {
    'Authorization': 'Bearer ' + (session ? session.access_token : ''),
    'Content-Type': 'application/json'
  };
}

async function loadGoogleSession(){
  if(!session) return false;
  try{
    const res = await fetch('/api/google/token', {headers: apiHeaders()});
    if(!res.ok) return false;
    const data = await res.json();
    if(!data.connected){
      googleConnected = false;
      googleAccessToken = null;
      googleTokenExpiry = 0;
      return false;
    }
    googleConnected = true;
    googleAccessToken = data.access_token;
    googleTokenExpiry = Date.now() + 50 * 60 * 1000;
    gcalCalendarId = data.calendar_id || null;
    gcalSyncToken = data.sync_token || null;
    gcalConnectedAt = data.connected_at ? new Date(data.connected_at).getTime() : null;
    return true;
  }catch(e){ return false; }
}

// Dias restantes até o Google derrubar sozinho a conexão (contas de teste — ver
// GOOGLE_TEST_TOKEN_LIFETIME_DAYS). Null quando não dá pra saber.
function googleDaysUntilExpiry(){
  if(!gcalConnectedAt) return null;
  const elapsedDays = (Date.now() - gcalConnectedAt) / 86400000;
  return GOOGLE_TEST_TOKEN_LIFETIME_DAYS - elapsedDays;
}

function isGoogleExpiringSoon(){
  const left = googleDaysUntilExpiry();
  return left !== null && left <= 1.5;
}

async function ensureGoogleToken(){
  if(googleAccessToken && Date.now() < googleTokenExpiry) return googleAccessToken;
  const ok = await loadGoogleSession();
  return ok ? googleAccessToken : null;
}

// Guarda no servidor o que precisa sobreviver entre dispositivos.
async function persistGoogleState(patch){
  try{
    await fetch('/api/google/token', {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify(patch)
    });
  }catch(e){}
}

function clearGoogleToken(){
  googleConnected = false;
  googleAccessToken = null;
  googleTokenExpiry = 0;
  gcalCalendarId = null;
  gcalSyncToken = null;
  gcalConnectedAt = null;
  localEventMapCache = null;
  try{ localStorage.removeItem(gcalKey('localEvents')); }catch(e){}
}

// Google returns 401 once the token is revoked or expires early; treat that as a
// clean disconnect so the UI can prompt for a reconnect instead of failing silently.
async function gapi(path, options, retried){
  const token = await ensureGoogleToken();
  if(!token) return null;
  const opts = options || {};
  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    method: opts.method || 'GET',
    headers: Object.assign(
      {'Authorization': 'Bearer ' + token},
      opts.body ? {'Content-Type': 'application/json'} : {}
    ),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if(res.status === 401){
    // Token vencido antes do previsto: pede um novo ao backend e tenta uma vez só.
    googleAccessToken = null;
    googleTokenExpiry = 0;
    if(!retried && await ensureGoogleToken()) return gapi(path, options, true);
    // Só desconecta quando o backend confirmou que a conexão acabou
    // (googleConnected virou false) ou quando o token novo também foi
    // recusado. Uma falha passageira do backend ao renovar (503) derrubava a
    // conexão e pedia para reconectar à toa.
    if(retried || !googleConnected){
      clearGoogleToken();
      stopGoogleSyncLoop();
      updateGoogleStatusUI();
      showToast('A conexão com o Google expirou. Reconecte em Configurações.', 'erro');
    }
    return null;
  }
  if(res.status === 410) return {__gone: true};
  if(res.status === 404) return {__missing: true};
  if(!res.ok) return null;
  if(res.status === 204) return {};
  return res.json();
}

// Leva o usuário à tela de contas do Google. O backend monta a URL porque é ele
// que assina o state com a identidade — o navegador só navega.
async function connectGoogleCalendar(){
  const btn = document.getElementById('google-cal-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Abrindo Google…'; }
  try{
    const res = await fetch('/api/google/start', {headers: apiHeaders()});
    const data = await res.json();
    if(!res.ok || !data.url){
      console.error(data);showToast('Não foi possível iniciar a conexão com o Google. Tente de novo em instantes.', 'erro');
      if(btn){ btn.disabled = false; btn.textContent = 'Conectar'; }
      return;
    }
    window.location.href = data.url;
  }catch(e){
    console.error(e);showToast('Sem resposta do servidor. Confira sua conexão e tente de novo.', 'erro');
    if(btn){ btn.disabled = false; btn.textContent = 'Conectar'; }
  }
}

async function disconnectGoogleCalendar(){
  if(!await confirmar('As tarefas continuam aqui e os eventos já criados continuam na agenda — só para de sincronizar.', {title:'Desconectar o Google Calendar?', okLabel:'Desconectar'})) return;
  // Antes o app se dava por desconectado mesmo com a requisição falhando, e a
  // conexão voltava sozinha no próximo carregamento.
  try{
    const res = await fetch('/api/google/disconnect', {method: 'POST', headers: apiHeaders()});
    if(!res.ok) throw new Error(`disconnect ${res.status}`);
  }catch(e){
    console.error(e);
    showToast('Não deu para desconectar agora. Confira a conexão e tente de novo.', 'erro');
    return;
  }
  clearGoogleToken();
  stopGoogleSyncLoop();
  showToast('Google Calendar desconectado');
  updateGoogleStatusUI();
  safeRerender();
}

// Link de convite: ?convite=CODIGO. O código fica guardado até a pessoa entrar,
// porque login e cadastro (com a confirmação por email) podem levar a outra
// carga da página, que já não tem o parâmetro.
const CONVITE_KEY = 'convitePendente';

function capturarConviteDaUrl(){
  const params = new URLSearchParams(location.search);
  if(!params.has('convite')) return;
  const code = codigoDoConvite(params.get('convite'));
  params.delete('convite');
  const q = params.toString();
  history.replaceState({}, '', location.pathname + (q ? '?' + q : ''));
  if(code) try{ localStorage.setItem(CONVITE_KEY, code); }catch(e){}
}
function lerConvitePendente(){
  try{ return localStorage.getItem(CONVITE_KEY); }catch(e){ return null; }
}
function limparConvitePendente(){
  try{ localStorage.removeItem(CONVITE_KEY); }catch(e){}
}

function linkDoConvite(code){
  return `${location.origin}/?convite=${encodeURIComponent(code)}`;
}

// Aceita o código puro ("7F3K2A") ou o link inteiro colado no campo.
function codigoDoConvite(texto){
  const t = String(texto || '').trim();
  const m = t.match(/[?&]convite=([A-Za-z0-9]+)/);
  return (m ? m[1] : t).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Roda depois do login: pergunta antes de entrar, pra quem está com a conta
// errada aberta não entrar no projeto com ela.
async function aceitarConvitePendente(){
  const code = lerConvitePendente();
  if(!code) return;
  const ok = await confirmar(`Você vai entrar no projeto com a conta ${session.user.email}. Se o convite era para outra conta, saia e abra o link de novo.`, {title: 'Aceitar o convite?', okLabel: 'Entrar no projeto', danger: false});
  limparConvitePendente();
  if(!ok) return;
  const {data, error} = await sb.rpc('accept_invite_by_code', {p_code: code});
  if(error){console.error(error);showToast('Não deu para aceitar o convite. Peça o link de novo para quem te convidou.', 'erro');return;}
  if(!data || !data.success){
    showToast('Esse link de convite já foi usado ou não vale mais. Peça um novo para quem te convidou.', 'erro');
    return;
  }
  await loadProjects();
  showToast(data.already_member ? 'Você já era membro desse projeto' : 'Você entrou no projeto!');
  if(state.projects.some(p=>p.id === data.project_id)) openProjectView(data.project_id);
  else render();
}

async function copiarLinkConvite(code){
  const link = linkDoConvite(code);
  try{
    await navigator.clipboard.writeText(link);
    showToast('Link copiado. Ele vale para uma pessoa só.');
  }catch(e){
    showToast(`Não deu para copiar. O link é ${link}`, 'erro');
  }
}

// Lê o ?google=... com que o callback devolve o usuário ao app.
async function handleGoogleRedirect(){
  const params = new URLSearchParams(location.search);
  const status = params.get('google');
  if(!status) return;
  history.replaceState({}, '', location.pathname);

  const msgs = {
    ok: 'Google Calendar conectado',
    negado: 'Você recusou o acesso ao Google Calendar',
    expirado: 'O pedido expirou — tente conectar de novo',
    sem_refresh: 'O Google não devolveu acesso permanente. Remova o app em myaccount.google.com/permissions e conecte de novo.',
    erro: 'Erro ao conectar com o Google'
  };
  showToast(msgs[status] || msgs.erro, status === 'ok' ? undefined : 'erro');

  if(status === 'ok'){
    await loadGoogleSession();
    updateGoogleStatusUI();
    safeRerender();
    startGoogleSyncLoop();
    await runGoogleSync({full: true});
  }
}

function updateGoogleStatusUI(){
  const el = document.getElementById('google-cal-status');
  if(!el) return;
  const btn = document.getElementById('google-cal-btn');
  const syncBtn = document.getElementById('google-cal-sync-btn');
  if(isGoogleConnected()){
    const expiring = isGoogleExpiringSoon();
    const hint = expiring ? ` <span style="color:var(--waiting);">Expira em breve, reconecte.</span>` : '';
    el.innerHTML = `<span class="set-status ligado">Conectado</span>${hint}`;
    btn.textContent = 'Desconectar';
    btn.onclick = disconnectGoogleCalendar;
    if(syncBtn) syncBtn.style.display = '';
  } else {
    el.innerHTML = `<span class="set-status">Não conectado</span>`;
    btn.textContent = 'Conectar';
    btn.onclick = connectGoogleCalendar;
    if(syncBtn) syncBtn.style.display = 'none';
  }
}

// Sincroniza com a agenda principal: é a que abre por padrão ao criar um evento
// no Google, então qualquer compromisso criado por lá vira tarefa sem exigir que
// o usuário escolha um calendário específico.
async function getSyncCalendarId(){
  if(gcalCalendarId === GCAL_ID) return GCAL_ID;
  // Migração da versão que usava um calendário dedicado: o sync token antigo
  // pertence àquele calendário e não vale para a agenda principal.
  gcalCalendarId = GCAL_ID;
  gcalSyncToken = null;
  await persistGoogleState({calendar_id: GCAL_ID, sync_token: null});
  return GCAL_ID;
}

function gcalTimeZone(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'; }
  catch(e){ return 'America/Sao_Paulo'; }
}

// Event ids for tasks the user owns live on the row itself. For tasks owned by a
// teammate in a shared project each member syncs into their own calendar, so the
// mapping has to stay local or members would overwrite each other's event ids.
function ownsTask(task){
  return session && session.user && task.owner_id === session.user.id;
}

let localEventMapCache = null;
function localEventMap(){
  if(localEventMapCache) return localEventMapCache;
  try{ localEventMapCache = JSON.parse(localStorage.getItem(gcalKey('localEvents')) || '{}'); }
  catch(e){ localEventMapCache = {}; }
  return localEventMapCache;
}

function getEventId(task){
  if(ownsTask(task)) return task.google_event_id || null;
  return localEventMap()[task.id] || null;
}

async function setEventId(task, eventId){
  if(ownsTask(task)){
    task.google_event_id = eventId;
    await sb.from('tasks').update({google_event_id: eventId}).eq('id', task.id);
    return;
  }
  const map = localEventMap();
  if(eventId) map[task.id] = eventId; else delete map[task.id];
  localEventMapCache = map;
  try{ localStorage.setItem(gcalKey('localEvents'), JSON.stringify(map)); }catch(e){}
}

// Tarefas antigas (anteriores à coluna sync_google) chegam sem o campo: a
// ausência vale como "sim", que era o comportamento até então.
function wantsGoogle(task){
  return task.sync_google !== false;
}

function shouldSyncTask(task){
  if(!session || !session.user) return false;
  if(!wantsGoogle(task)) return false;
  return task.owner_id === session.user.id || task.assigned_to === session.user.id;
}

function buildEventBody(task){
  const done = taskColumnType(task) === 'done';
  const body = {
    summary: (done ? '✓ ' : '') + task.title,
    description: [
      task.client ? `Cliente: ${task.client}` : '',
      task.notes || '',
      '—',
      'Sincronizado do samyest.mind'
    ].filter(Boolean).join('\n')
  };
  // null limpa o campo num PATCH, devolvendo o evento à cor padrão do calendário.
  body.colorId = task.color_id ? String(task.color_id) : null;
  if(task.time){
    const start = new Date(`${task.date}T${task.time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const tz = gcalTimeZone();
    body.start = {dateTime: gcalLocalIso(start), timeZone: tz};
    body.end = {dateTime: gcalLocalIso(end), timeZone: tz};
  } else {
    const next = new Date(`${task.date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    body.start = {date: task.date};
    body.end = {date: gcalDateIso(next)};
  }
  return body;
}

function gcalLocalIso(d){
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

function gcalDateIso(d){
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

async function syncTaskToGoogle(task){
  if(!isGoogleConnected() || !shouldSyncTask(task)) return;
  const calId = await getSyncCalendarId();
  if(!calId) return;
  const existingId = getEventId(task);

  if(!task.date){
    if(existingId) await deleteGoogleEvent(task);
    return;
  }

  const body = buildEventBody(task);
  const base = '/calendars/' + encodeURIComponent(calId) + '/events';
  let evt = null;
  if(existingId){
    evt = await gapi(`${base}/${existingId}`, {method:'PATCH', body});
    // The event was deleted straight from Google — recreate it rather than losing the task.
    if(evt && evt.__missing){
      await setEventId(task, null);
      evt = await gapi(base, {method:'POST', body});
    }
  } else {
    evt = await gapi(base, {method:'POST', body});
  }
  if(evt && evt.id && evt.id !== getEventId(task)){
    await setEventId(task, evt.id);
  }
}

async function deleteGoogleEvent(task){
  if(!isGoogleConnected()) return;
  const eventId = getEventId(task);
  if(!eventId) return;
  const calId = await getSyncCalendarId();
  if(!calId) return;
  await gapi(`/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {method:'DELETE'});
  await setEventId(task, null);
}

async function syncAllTasksToGoogle(){
  if(!isGoogleConnected()) return 0;
  const pending = state.tasks.filter(t=>t.date && shouldSyncTask(t));
  let n = 0;
  for(const t of pending){
    await syncTaskToGoogle(t);
    n++;
  }
  return n;
}

// --- Google -> app ---

function parseEventDate(evt){
  if(evt.start && evt.start.date) return {date: evt.start.date, time: ''};
  if(evt.start && evt.start.dateTime){
    const d = new Date(evt.start.dateTime);
    const p = n => String(n).padStart(2, '0');
    return {date: gcalDateIso(d), time: `${p(d.getHours())}:${p(d.getMinutes())}`};
  }
  return null;
}

function titleFromEvent(evt){
  return (evt.summary || '(sem título)').replace(/^✓\s*/, '').trim();
}

// O Google mistura na agenda principal coisas que não são compromissos: os
// aniversários (dos contatos e o próprio), blocos de foco, horário de trabalho
// e ausências. Só 'default' é evento de verdade.
const IMPORTABLE_EVENT_TYPES = ['default', 'fromGmail'];

// Rede de segurança para aniversários que chegam sem eventType marcado, como os
// vindos de contatos antigos. Casa só com a saudação inteira — "Aniversário do
// contrato" continua virando tarefa, que é o certo.
const BIRTHDAY_TITLE = /^(happy birthday|feliz anivers[áa]rio|anivers[áa]rio)[\s!🎂🎉]*$/i;

function isTaskWorthyEvent(evt){
  const type = evt.eventType || 'default';
  if(!IMPORTABLE_EVENT_TYPES.includes(type)) return false;
  if(BIRTHDAY_TITLE.test((evt.summary || '').trim())) return false;
  // Convite recusado não é tarefa.
  const me = (evt.attendees || []).find(a=>a.self);
  if(me && me.responseStatus === 'declined') return false;
  return true;
}

function gcalHorizonteIso(){
  return isoDateFromTimestamp(Date.now() + GCAL_HORIZONTE_DIAS * 86400000);
}

function gcalCompletaVencida(){
  try{
    const ultima = Number(localStorage.getItem(gcalKey('ultimaCompleta')) || 0);
    return Date.now() - ultima > GCAL_COMPLETA_A_CADA;
  }catch(e){ return false; }
}

function marcarGcalCompleta(){
  try{ localStorage.setItem(gcalKey('ultimaCompleta'), String(Date.now())); }catch(e){}
}

// true = percorreu todas as páginas; false = parou no meio (sem conexão, erro).
async function pullFromGoogle(opts){
  const full = opts && opts.full;
  const calId = await getSyncCalendarId();
  if(!calId) return false;
  const base = '/calendars/' + encodeURIComponent(calId) + '/events';
  const syncToken = full ? null : gcalSyncToken;

  const params = new URLSearchParams();
  // O Google pede os mesmos parâmetros na busca incremental e na completa.
  // A incremental ia sem singleEvents: uma série recorrente alterada chegava
  // como o evento-mestre (uma tarefa só, com outro id) em vez de ocorrências.
  params.set('singleEvents', 'true');
  params.set('maxResults', '250');
  if(syncToken){
    params.set('syncToken', syncToken);
    params.set('showDeleted', 'true');
  } else {
    // A partir de hoje: compromissos passados não são tarefas pendentes, e a
    // varredura do histórico é o que despejava meses de eventos de uma vez.
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const ate = new Date(from);
    ate.setDate(ate.getDate() + GCAL_HORIZONTE_DIAS + 1);
    params.set('timeMin', from.toISOString());
    params.set('timeMax', ate.toISOString());
    params.set('showDeleted', 'false');
  }

  let changed = false;
  let pageToken = null;
  let nextSync = null;
  let guard = 0;

  // O nextSyncToken só vem na última página. Sem paginar, ele nunca chega e toda
  // sincronização vira uma varredura completa em vez de buscar só as mudanças.
  do{
    const q = new URLSearchParams(params);
    if(pageToken) q.set('pageToken', pageToken);

    const data = await gapi(`${base}?${q}`);
    // Sync token expirado: o Google não consegue mais dar o delta, recomeça.
    if(data && data.__gone){
      gcalSyncToken = null;
      return pullFromGoogle({full: true});
    }
    if(!data) return false;

    for(const evt of (data.items || [])){
      if(await applyGoogleEvent(evt)) changed = true;
    }
    pageToken = data.nextPageToken || null;
    nextSync = data.nextSyncToken || nextSync;
  }while(pageToken && ++guard < 20);

  if(nextSync && nextSync !== gcalSyncToken){
    gcalSyncToken = nextSync;
    await persistGoogleState({sync_token: gcalSyncToken});
  }
  if(changed){
    // Sem isto a grade toda refaz a animação de entrada e o calendário pisca.
    skipEntranceOnce = true;
    await loadTasks();
    skipEntranceOnce = true;
    safeRerender();
  }
  return true;
}

async function applyGoogleEvent(evt){
  const task = state.tasks.find(t=>getEventId(t) === evt.id);

  // Já descartado uma vez: não ressuscita.
  if(!task && state.ignoredEvents.has(evt.id)) return false;

  if(evt.status === 'cancelled'){
    if(!task) return false;
    // Removing an event from your own calendar must not delete a teammate's task —
    // just stop tracking it.
    if(!ownsTask(task)){
      await setEventId(task, null);
      return false;
    }
    await setEventId(task, null);
    await deleteTaskRemote(task.id);
    state.tasks = state.tasks.filter(t=>t.id !== task.id);
    return true;
  }

  const when = parseEventDate(evt);
  if(!when) return false;
  const title = titleFromEvent(evt);

  const colorId = evt.colorId ? String(evt.colorId) : null;

  if(task){
    // Visualizador com tarefa atribuída recebe o evento na agenda, mas não
    // pode alterar a tarefa: sem isto o app tentava a cada 2 min e mostrava
    // "Não deu para atualizar" sem parar.
    if(!shouldSyncTask(task) || !canEditTask(task)) return false;
    if(task.title === title && task.date === when.date && (task.time || '') === when.time
       && (task.color_id || null) === colorId) return false;
    const ok = await updateTaskRemote(task.id, {
      title,
      client: task.client,
      status: task.status,
      priority: task.priority,
      date: when.date,
      time: when.time,
      color_id: colorId,
      notes: task.notes
    });
    if(!ok) return false;
    Object.assign(task, {title, date: when.date, time: when.time, color_id: colorId});
    return true;
  }

  // Event created directly in Google Calendar — mirror it as a new task.
  if(evt.description && evt.description.includes('Sincronizado do samyest.mind')) return false;
  if(!isTaskWorthyEvent(evt)) return false;
  // A sincronização incremental (via syncToken) não filtra por timeMin como a
  // completa — só ela evita a varredura de meses. Sem isto, um compromisso
  // antigo tocado no Google (cor, recorrência etc.) ressuscitava como tarefa.
  if(when.date < isoDateFromTimestamp(Date.now())) return false;
  // A incremental não respeita o timeMax da completa: alterar uma série sem
  // fim no Google devolvia todas as ocorrências dela. Fora da janela, a
  // ocorrência espera; a busca completa diária traz quando ela entrar.
  if(when.date > gcalHorizonteIso()) return false;
  // O id do evento vai junto no insert. Gravado num segundo passo (como era),
  // outro sync que corresse no meio não achava o vínculo e criava a tarefa de
  // novo. Com o índice de supabase/tarefas_google_unicas.sql, o banco recusa a
  // duplicata vinda de outro aparelho e o app só recarrega.
  const created = await createTaskRemote({
    title,
    client: '',
    status: getColumns()[0].key,
    priority: 'normal',
    date: when.date,
    time: when.time,
    color_id: colorId,
    from_google: true,
    google_event_id: evt.id,
    notes: ''
  }, {duplicataSilenciosa: true});
  if(created === 'duplicata') return true;
  if(!created) return false;
  state.tasks.push(created);
  return true;
}

// Uma sincronização por vez, em fila. O ciclo de 2 min, o botão
// "Sincronizar" e o sync completo da volta do OAuth corriam em paralelo: duas
// buscas viam o mesmo evento novo ao mesmo tempo e criavam duas tarefas para
// ele. E o sync completo do primeiro conectar era simplesmente descartado por
// já haver outro rodando — as tarefas existentes nunca subiam para a agenda.
//   opts.full → envia tudo e refaz a busca completa
//   opts.push → envia tudo e busca só as mudanças
// Devolve quantas tarefas foram enviadas.
let gcalSyncFila = Promise.resolve();
let gcalSyncNaFila = 0;
function runGoogleSync(opts){
  const o = opts || {};
  const envia = !!(o.full || o.push);
  // Uma busca simples pedida com outra já na fila não acrescenta nada.
  if(!envia && gcalSyncNaFila > 0) return gcalSyncFila.then(()=>0);
  gcalSyncNaFila++;
  const passo = gcalSyncFila.then(async ()=>{
    if(!isGoogleConnected()) return 0;
    let enviadas = 0;
    try{
      if(envia) enviadas = await syncAllTasksToGoogle();
      const completa = !!o.full || gcalCompletaVencida();
      if(await pullFromGoogle({full: completa}) && completa) marcarGcalCompleta();
    }catch(e){ console.error('[google sync]', e); }
    return enviadas;
  }).finally(()=>{ gcalSyncNaFila--; });
  gcalSyncFila = passo.catch(()=>0);
  return passo;
}

function startGoogleSyncLoop(){
  if(gcalPullTimer || !isGoogleConnected()) return;
  gcalPullTimer = setInterval(()=>{ runGoogleSync(); }, GCAL_PULL_INTERVAL);
}

function stopGoogleSyncLoop(){
  if(gcalPullTimer){ clearInterval(gcalPullTimer); gcalPullTimer = null; }
}

let calSyncing = false;

// Sincronização sob demanda a partir do calendário, sem esperar o ciclo de 2 min.
async function syncCalendarNow(){
  if(!isGoogleConnected()){
    showToast('Conecte o Google Calendar primeiro');
    return;
  }
  if(calSyncing) return;

  const before = state.tasks.length;
  calSyncing = true;
  skipEntranceOnce = true;
  render();

  await runGoogleSync({push: true});

  calSyncing = false;
  skipEntranceOnce = true;
  render();

  const novas = state.tasks.length - before;
  showToast(novas > 0
    ? `${novas} nova${novas!==1?'s':''} tarefa${novas!==1?'s':''} do Google`
    : 'Tudo em dia com o Google');
}

async function forceFullGoogleSync(){
  if(!isGoogleConnected()) return;
  const btn = document.getElementById('google-cal-sync-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  const n = await runGoogleSync({full: true});
  if(btn){ btn.disabled = false; btn.textContent = 'Sincronizar tudo agora'; }
  showToast(`${n} tarefa${n!==1?'s':''} enviada${n!==1?'s':''} ao Google`);
}

let realtimeChannel = null;
let realtimeDebounceTimer = null;
let isRefreshing = false;

function isEditingNotes(){
  const id = document.activeElement && document.activeElement.id;
  return id === 'project-notes-editor' || id === 'project-note-title';
}

function safeRerender(){
  if(isEditingNotes()) return;
  render();
}

// Eventos seguidos de tipos diferentes se juntam: 'projects' já recarrega as
// tarefas, então ganha de 'tasks'. Antes valia só o último, e um 'tasks' logo
// depois de alguém entrar no projeto engolia a recarga dos membros.
let realtimeKindPendente = null;
function scheduleRealtimeReload(kind){
  if(realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
  realtimeKindPendente = realtimeKindPendente ? {kind: juntarCargas(realtimeKindPendente.kind, kind)} : {kind};
  realtimeDebounceTimer = setTimeout(async ()=>{
    const {kind: k} = realtimeKindPendente || {};
    realtimeKindPendente = null;
    await refreshAll(k, true);
  }, 500);
}

// Pedido que chega com outra carga em andamento roda logo depois dela, em vez
// de ser descartado.
let refreshDepois = null;
function juntarCargas(a, b){
  if(!a || !b) return undefined;
  if(a === b) return a;
  if((a === 'projects' || b === 'projects') && (a === 'tasks' || b === 'tasks')) return 'projects';
  return undefined;
}
async function refreshAll(kind, silent){
  if(isRefreshing){
    refreshDepois = refreshDepois ? {kind: juntarCargas(refreshDepois.kind, kind)} : {kind};
    return;
  }
  isRefreshing = true;
  const btns = document.querySelectorAll('.refresh-btn');
  btns.forEach(b=>b.classList.add('spinning'));
  try{
    const cargas = [];
    // Entrar, sair ou ser removido de um projeto chega como 'projects' (vem de
    // project_members). Sem recarregar as tarefas junto, as do projeto
    // continuavam na tela de quem saiu até a próxima carga.
    if(!kind || kind === 'tasks' || kind === 'projects') cargas.push(loadTasks());
    if(!kind || kind === 'projects') cargas.push(loadProjects());
    if(!kind) cargas.push(loadDesafio());
    if((!kind || kind === 'notes') && state.view === 'project' && state.projectTasksView === 'notes' && state.currentProjectId && !isEditingNotes()){
      cargas.push(carregarNotasProjeto(state.currentProjectId));
    }
    await Promise.all(cargas);
    safeRerender();
    if(!silent) showToast('Atualizado');
  }catch(e){}
  isRefreshing = false;
  setTimeout(()=>btns.forEach(b=>b.classList.remove('spinning')), 400);
  if(refreshDepois){
    const {kind: k} = refreshDepois;
    refreshDepois = null;
    refreshAll(k, true);
  }
}

let alarmedTaskKeys = new Set();
let alarmCheckTimer = null;

function startAlarmChecker(){
  if(alarmCheckTimer) return;
  // A permissão de notificação era pedida aqui, no carregamento, sem gesto do
  // usuário: Safari e Firefox ignoram o pedido e o Chrome o esconde. Agora ela
  // é pedida ao salvar a primeira tarefa com horário (pedirPermissaoNotificacao).
  try{
    const salvos = JSON.parse(sessionStorage.getItem('alarmesDisparados') || '[]');
    if(Array.isArray(salvos)) salvos.forEach(k=>alarmedTaskKeys.add(k));
  }catch(e){}
  checkAlarms();
  alarmCheckTimer = setInterval(checkAlarms, 20000);
}

function pedirPermissaoNotificacao(){
  if(!window.Notification || Notification.permission !== 'default') return;
  try{ Notification.requestPermission(); }catch(e){}
}

function stopAlarmChecker(){
  if(alarmCheckTimer){clearInterval(alarmCheckTimer);alarmCheckTimer = null;}
  stopAlarmSoundLoop();
}

// Disparava só se a checagem caísse exatamente no minuto marcado. Em aba de
// fundo o navegador espaça os timers e o minuto podia passar batido. Agora
// vale qualquer checagem até 2 minutos depois do horário.
const JANELA_ALARME_MS = 2 * 60 * 1000;

function checkAlarms(){
  if(!state.tasks || !state.tasks.length) return;
  const now = new Date();
  const todayIso = isoDateFromTimestamp(now.getTime());

  personalTasks().forEach(t=>{
    if(!t.time || t.date !== todayIso) return;
    if(taskColumnType(t) === 'done') return;
    // Aceita "HH:MM" e "HH:MM:SS".
    const [h, m] = String(t.time).split(':').map(Number);
    if(!Number.isFinite(h) || !Number.isFinite(m)) return;
    const alvo = new Date(now);
    alvo.setHours(h, m, 0, 0);
    const atraso = now - alvo;
    if(atraso < 0 || atraso > JANELA_ALARME_MS) return;
    const key = `${t.id}_${t.date}_${t.time}`;
    if(alarmedTaskKeys.has(key)) return;
    alarmedTaskKeys.add(key);
    // Sobrevive a recarregar a página dentro da janela, senão tocava de novo.
    try{ sessionStorage.setItem('alarmesDisparados', JSON.stringify([...alarmedTaskKeys].slice(-200))); }catch(e){}
    fireAlarm(t);
  });
}

let alarmSoundInterval = null;

// Um AudioContext só, reaproveitado. Criar um por bipe (8 por alarme, nunca
// fechados) esbarrava no limite do navegador numa aba aberta o dia inteiro e o
// alarme ficava mudo. Ele nasce no primeiro clique da página, porque o
// navegador só deixa tocar som depois de um gesto do usuário.
let alarmAudioCtx = null;
function alarmContext(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  if(!alarmAudioCtx || alarmAudioCtx.state === 'closed') alarmAudioCtx = new Ctx();
  if(alarmAudioCtx.state === 'suspended') alarmAudioCtx.resume().catch(()=>{});
  return alarmAudioCtx;
}
document.addEventListener('pointerdown', ()=>{ try{ alarmContext(); }catch(e){} }, {once: true, capture: true});

function playAlarmSound(){
  try{
    const ctx = alarmContext();
    if(!ctx) return;
    const notes = [880, 1108, 1318];
    notes.forEach((freq, i)=>{
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.start(start);
      osc.stop(start + 0.34);
    });
  }catch(e){}
}

function startAlarmSoundLoop(){
  stopAlarmSoundLoop();
  playAlarmSound();
  alarmSoundInterval = setInterval(playAlarmSound, 1300);
  setTimeout(stopAlarmSoundLoop, 10000);
}

function stopAlarmSoundLoop(){
  if(alarmSoundInterval){clearInterval(alarmSoundInterval);alarmSoundInterval = null;}
  const btn = document.getElementById('alarm-stop-sound-btn');
  if(btn) btn.style.display = 'none';
}

function fireAlarm(task){
  if(state.soundEnabled !== false) startAlarmSoundLoop();
  showAlarmBanner(task);
  if(window.Notification && Notification.permission === 'granted'){
    try{
      new Notification('⏰ ' + task.title, {body: task.client || 'Está na hora!', tag: task.id});
    }catch(e){}
  }
}

function closeAlarmBanner(){
  stopAlarmSoundLoop();
  const el = document.getElementById('alarm-banner');
  if(el) el.remove();
}

function showAlarmBanner(task){
  const old = document.getElementById('alarm-banner');
  if(old) old.remove();
  const el = document.createElement('div');
  el.id = 'alarm-banner';
  el.className = 'alarm-banner';
  const showStopBtn = state.soundEnabled !== false;
  el.innerHTML = `
    <div class="alarm-banner-icon">⏰</div>
    <div class="alarm-banner-body">
      <div class="alarm-banner-label">Está na hora</div>
      <div class="alarm-banner-title">${esc(task.title)}</div>
      ${task.client ? `<div class="alarm-banner-sub">${esc(task.client)}</div>` : ''}
    </div>
    <div class="alarm-banner-actions">
      <button class="btn-primary" onclick="closeAlarmBanner();openModal('${task.id}')">Ver tarefa</button>
      <button class="alarm-banner-stop" id="alarm-stop-sound-btn" style="${showStopBtn ? '' : 'display:none;'}" onclick="stopAlarmSoundLoop()">🔇 Parar som</button>
      <button class="alarm-banner-dismiss" onclick="closeAlarmBanner();" title="Fechar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.body.appendChild(el);
  setTimeout(()=>{
    if(document.getElementById('alarm-banner') === el) el.remove();
  }, 15000);
}

function setupRealtime(){
  if(realtimeChannel) return;
  realtimeChannel = sb.channel('app-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'tasks'}, ()=>{
      scheduleRealtimeReload('tasks');
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'projects'}, ()=>{
      scheduleRealtimeReload('projects');
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'project_members'}, ()=>{
      scheduleRealtimeReload('projects');
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'task_comments'}, (payload)=>{
      const affectedId = (payload.new && payload.new.task_id) || (payload.old && payload.old.task_id);
      if(affectedId && affectedId === currentCommentTaskId && document.getElementById('modal').classList.contains('open')){
        refreshComments();
      }
    })
    .subscribe();
}

function teardownRealtime(){
  if(realtimeChannel){
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function logout(){
  if(chamada) await sairDaChamada({silencioso: true});
  teardownRealtime();
  stopAlarmChecker();
  stopGoogleSyncLoop();
  stopRoutineCheckLoop();
  try{ const k = projectsCacheKey(); if(k) localStorage.removeItem(k); }catch(e){}
  await sb.auth.signOut();
  location.reload();
}

function getUserAvatarUrl(){
  return state.myAvatarUrl || null;
}

function renderMyAvatar(elId, name){
  const el = document.getElementById(elId);
  if(!el) return;
  const url = getUserAvatarUrl();
  if(url){
    el.innerHTML = `<img src="${esc(url)}" alt="" width="96" height="96" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
  } else {
    el.textContent = (String(name || '?').trim()[0] || '?').toUpperCase();
  }
}

// A extensão vinha do nome do arquivo ("foto" sem ponto virava avatar.foto) e
// cada formato novo deixava o arquivo antigo para trás no bucket.
const EXT_IMAGEM = {'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/avif':'avif'};

async function uploadAvatar(fileInput){
  const file = fileInput.files[0];
  // Limpa já: escolher o mesmo arquivo de novo (depois de um erro) não
  // disparava o change.
  fileInput.value = '';
  if(!file) return;
  const ext = EXT_IMAGEM[file.type];
  if(!ext){showToast('Formato não suportado — escolha um JPG, PNG ou WebP.', 'erro');return;}
  if(file.size > 4 * 1024 * 1024){showToast('Imagem acima de 4\u00a0MB. Reduza o tamanho e envie de novo.', 'erro');return;}

  const path = `${session.user.id}/avatar.${ext}`;

  const btn = document.getElementById('avatar-upload-label');
  if(btn) btn.textContent = 'Enviando…';

  const {error: upErr} = await sb.storage.from('avatars').upload(path, file, {upsert: true, cacheControl: '3600'});
  if(upErr){console.error(upErr);showToast('Não deu para enviar a foto. Tente de novo em instantes.', 'erro');if(btn) btn.textContent = 'Trocar foto';return;}

  const {data: urlData} = sb.storage.from('avatars').getPublicUrl(path);
  const publicUrl = urlData.publicUrl + '?t=' + Date.now();

  const {error: dbErr} = await sb.from('profiles').upsert({
    id: session.user.id,
    name: getUserName(),
    avatar_url: publicUrl,
    updated_at: new Date().toISOString()
  });
  if(dbErr){console.error(dbErr);showToast('A foto subiu, mas não deu para salvar no perfil. Tente de novo.', 'erro');if(btn) btn.textContent = 'Trocar foto';return;}

  state.myAvatarUrl = publicUrl;
  renderMyAvatar('user-avatar', getUserName());
  renderMyAvatar('settings-avatar-preview', getUserName());
  if(btn) btn.textContent = 'Trocar foto';
  showToast('Foto atualizada');
}

/* --- fonte e cor do nome (RFC 0005, SEC-089) --- */
// Cada pessoa escolhe a fonte e a cor com que o nome dela aparece nos
// projetos. A chave vem do banco, mas só vale se estiver nesta lista (a mesma
// do check em supabase/fonte_do_nome.sql), e a font-family sai do styles.css.
// Grotesca e Máquina já vêm com o app; as outras carregam do Google Fonts só
// quando aparece um nome com elas.
const FONTES_NOME = {
  grotesca: 'Grotesca',
  serifada: 'Serifada',
  mono: 'Máquina',
  manuscrita: 'Manuscrita',
  arredondada: 'Arredondada',
  pixel: 'Pixel',
  marcante: 'Marcante',
  elegante: 'Elegante',
  retro: 'Retrô'
};
const FONTES_NOME_DE_FORA = new Set(['serifada', 'manuscrita', 'arredondada', 'pixel', 'marcante', 'elegante', 'retro']);
const CORES_NOME = FAMILIAS_COR.filter(f=>f.nome !== 'Cinza').map(f=>f.cores[1]);
let fontesDeNomeCarregadas = false;
let fontesDeNomeSemColuna = false;

function carregarFontesDeNome(){
  if(fontesDeNomeCarregadas) return;
  fontesDeNomeCarregadas = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Young+Serif&family=Caveat:wght@600&family=Nunito:wght@800&family=Pixelify+Sans:wght@500&family=Bebas+Neue&family=Playfair+Display:ital,wght@1,600&family=Righteous&display=swap';
  document.head.appendChild(link);
}

function fonteDoPerfil(perfil){
  const f = perfil && perfil.nome_fonte;
  return typeof f === 'string' && Object.prototype.hasOwnProperty.call(FONTES_NOME, f) ? f : null;
}

function corDoNome(perfil){
  const c = perfil && perfil.nome_cor;
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? corSegura(c) : null;
}

// O nome escapado, dentro de um span com a fonte e a cor da pessoa (quando
// ela escolheu). Sem escolha, só o texto, como antes.
function nomePessoaHtml(perfil, texto){
  const t = esc(texto || '');
  const f = fonteDoPerfil(perfil);
  const cor = corDoNome(perfil);
  if(!f && !cor) return t;
  if(f && FONTES_NOME_DE_FORA.has(f)) carregarFontesDeNome();
  return `<span class="nome-fonte"${f ? ` data-fonte="${f}"` : ''}${cor ? ` style="--nome-cor:${cor}"` : ''}>${t}</span>`;
}

function meuPerfilDeNome(){
  return {avatar_url: state.myAvatarUrl, nome_fonte: state.minhaFonteNome || null, nome_cor: state.minhaCorNome || null};
}

// Perfis com fonte e cor; sem o fonte_do_nome.sql, a consulta com as colunas
// novas falha e o app segue com as de antes.
async function buscarPerfis(ids){
  const base = 'id, name, avatar_url';
  if(!fontesDeNomeSemColuna){
    const r = await sb.from('profiles').select(`${base}, nome_fonte, nome_cor`).in('id', ids);
    if(!r.error || !faltaColuna(r.error)) return r;
    fontesDeNomeSemColuna = true;
  }
  return sb.from('profiles').select(base).in('id', ids);
}

// O próprio nome na barra lateral também vai com a fonte escolhida.
function aplicarFonteNoMeuNome(){
  const el = document.getElementById('user-name-display');
  if(!el) return;
  const perfil = meuPerfilDeNome();
  const f = fonteDoPerfil(perfil), cor = corDoNome(perfil);
  el.classList.toggle('nome-fonte', !!(f || cor));
  if(f){ el.dataset.fonte = f; if(FONTES_NOME_DE_FORA.has(f)) carregarFontesDeNome(); } else delete el.dataset.fonte;
  if(cor) el.style.setProperty('--nome-cor', cor); else el.style.removeProperty('--nome-cor');
}

// Rascunho das Configurações: muda na hora a prévia e só grava no Salvar.
let rascunhoNome = {fonte: null, cor: null};

function desenharEscolhaDeFonte(){
  const grade = document.getElementById('fonte-nome-grade');
  const cores = document.getElementById('cor-nome-grade');
  if(!grade || !cores) return;
  const nome = (document.getElementById('s-name').value || '').trim() || getUserName() || 'Seu nome';
  const perfil = (f)=>({nome_fonte: f, nome_cor: rascunhoNome.cor});
  const opcoes = [[null, 'Padrão'], ...Object.entries(FONTES_NOME)];
  grade.innerHTML = opcoes.map(([k, rotulo])=>{
    const sel = (rascunhoNome.fonte || null) === k;
    return `<button type="button" class="fonte-nome-opcao ${sel ? 'selected' : ''}" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-fonte-opcao="${k || ''}" onclick="escolherFonteNome('${k || ''}')">
      <span class="fonte-nome-amostra">${nomePessoaHtml(perfil(k), nome)}</span>
      <span class="fonte-nome-rotulo">${rotulo}</span>
    </button>`;
  }).join('');
  cores.innerHTML = [null, ...CORES_NOME].map(c=>{
    const sel = (rascunhoNome.cor || null) === c;
    return `<button type="button" class="cor-nome-opcao ${sel ? 'selected' : ''} ${c ? '' : 'sem-cor'}" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" data-cor-opcao="${c || ''}" ${c ? `style="--cor:${corSegura(c)}"` : ''} onclick="escolherCorNome('${c || ''}')" aria-label="${c ? `Cor ${c}` : 'Cor do texto, sem cor própria'}" title="${c ? c : 'Sem cor própria'}"></button>`;
  }).join('');
}

function escolherFonteNome(k){
  rascunhoNome.fonte = Object.prototype.hasOwnProperty.call(FONTES_NOME, k) ? k : null;
  desenharEscolhaDeFonte();
  const b = document.querySelector(`#fonte-nome-grade [data-fonte-opcao="${rascunhoNome.fonte || ''}"]`);
  if(b) b.focus();
}

function escolherCorNome(c){
  rascunhoNome.cor = CORES_NOME.includes(c) ? c : null;
  desenharEscolhaDeFonte();
  const b = document.querySelector(`#cor-nome-grade [data-cor-opcao="${rascunhoNome.cor || ''}"]`);
  if(b) b.focus();
}

// Setas andam entre as opções, como num grupo de rádios.
document.addEventListener('keydown', (e)=>{
  const op = e.target.closest && e.target.closest('.fonte-nome-opcao, .cor-nome-opcao');
  if(!op || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const grupo = [...op.parentElement.children];
  const i = grupo.indexOf(op);
  const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + grupo.length) % grupo.length;
  e.preventDefault();
  grupo[n].click();
});

// Grava fonte e cor separado do resto do perfil: sem o fonte_do_nome.sql, o
// upsert com as colunas novas derrubaria o Salvar inteiro.
async function salvarFonteNome(){
  const fonte = rascunhoNome.fonte || null, cor = rascunhoNome.cor || null;
  if(fonte === (state.minhaFonteNome || null) && cor === (state.minhaCorNome || null)) return true;
  const {error} = await sb.from('profiles').update({nome_fonte: fonte, nome_cor: cor}).eq('id', session.user.id);
  if(error){
    console.error(error);
    showToast(faltaColuna(error) ? 'A fonte do nome precisa do supabase/fonte_do_nome.sql. Rode ele no Supabase.' : 'O resto foi salvo, mas a fonte do nome não. Tente de novo.', 'erro');
    return false;
  }
  state.minhaFonteNome = fonte;
  state.minhaCorNome = cor;
  aplicarFonteNoMeuNome();
  return true;
}

function getUserName(){
  if(state.myName) return state.myName;
  if(!session || !session.user.email) return '';
  const emailPart = session.user.email.split('@')[0];
  const firstPart = emailPart.split(/[._-]/)[0];
  return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
}

async function loadTasks(){
  const {data, error} = await sb.from('tasks').select('*').order('created_at', {ascending: true});
  if(error){console.error(error);state.tasks = [];render();return;}
  // A coluna kind vem do supabase/eventos_projeto.sql. Sem ela (ou sem nenhuma
  // tarefa para conferir) a opção "Evento" fica escondida em vez de falhar.
  if(data.length) state.temTipoEvento = 'kind' in data[0];
  state.tasks = data.map(t => ({
    id: t.id,
    title: t.title,
    client: t.client || '',
    status: t.status || 'todo',
    priority: t.priority || 'normal',
    date: t.date || '',
    time: t.time || '',
    notes: t.notes || '',
    google_event_id: t.google_event_id || null,
    color_id: t.color_id || null,
    sync_google: t.sync_google !== false,
    from_google: !!t.from_google,
    completed_at: t.completed_at || null,
    project_id: t.project_id || null,
    assigned_to: t.assigned_to || null,
    routine_id: t.routine_id || null,
    tags: Array.isArray(t.tags) ? t.tags : [],
    kind: t.kind === 'evento' ? 'evento' : 'tarefa',
    owner_id: t.user_id,
    created: new Date(t.created_at).getTime()
  }));
  render();
}

async function createTaskRemote(data, opts){
  const linha = {
    user_id: session.user.id,
    title: data.title,
    client: data.client || null,
    status: data.status,
    priority: data.priority,
    date: data.date || null,
    time: data.time || null,
    notes: data.notes || null,
    color_id: data.color_id || null,
    sync_google: data.sync_google !== false,
    from_google: !!data.from_google,
    completed_at: data.completed_at || null,
    project_id: data.project_id || null,
    assigned_to: data.assigned_to || null,
    routine_id: data.routine_id || null,
    google_event_id: data.google_event_id || null
  };
  // Só manda a coluna quando a tarefa tem tag: assim criar tarefa continua
  // funcionando mesmo antes do supabase/task_tags.sql ser aplicado.
  if(data.tags && data.tags.length) linha.tags = data.tags;
  // Mesma ideia para o tipo: só vai quando é evento.
  if(data.kind === 'evento') linha.kind = 'evento';
  const {data: task, error} = await sb.from('tasks').insert(linha).select().single();
  if(error){
    // 23505 = violou o índice único (tarefa já criada por outro aparelho).
    if(opts && opts.duplicataSilenciosa && error.code === '23505') return 'duplicata';
    console.error(error);showToast('Não deu para criar a tarefa. Confira a conexão e tente de novo.', 'erro');return null;
  }
  return {
    id: task.id,
    title: task.title,
    client: task.client || '',
    status: task.status,
    priority: task.priority,
    date: task.date || '',
    time: task.time || '',
    notes: task.notes || '',
    google_event_id: task.google_event_id || null,
    color_id: task.color_id || null,
    sync_google: task.sync_google !== false,
    from_google: !!task.from_google,
    completed_at: task.completed_at || null,
    project_id: task.project_id || null,
    assigned_to: task.assigned_to || null,
    routine_id: task.routine_id || null,
    tags: Array.isArray(task.tags) ? task.tags : [],
    kind: task.kind === 'evento' ? 'evento' : 'tarefa',
    owner_id: task.user_id,
    created: new Date(task.created_at).getTime()
  };
}

/* ---------- Rotinas semanais ---------- */
// Uma rotina é um molde (título, coluna, dias da semana); a tarefa de cada
// dia é gerada como uma tarefa normal ligada a ela por routine_id. Concluir
// ou apagar essa tarefa não mexe na rotina — ela gera de novo no próximo
// dia marcado.

function todayIso(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadRoutines(){
  const {data, error} = await sb.from('routines').select('*').order('created_at', {ascending: true});
  if(error){state.routines = [];return;}
  state.routines = data.map(r => ({
    id: r.id,
    title: r.title,
    client: r.client || '',
    status: r.status || 'todo',
    priority: r.priority || 'normal',
    time: r.time || '',
    weekdays: r.weekdays || [],
    active: r.active !== false,
    lastGeneratedDate: r.last_generated_date || null
  }));
}

// Roda no carregamento do app e periodicamente enquanto fica aberto — pega
// tanto o "hoje" de quem acabou de abrir quanto a virada da meia-noite pra
// quem deixa a aba aberta.
async function generateRoutineInstances(){
  if(!state.routines || !state.routines.length) return;
  const iso = todayIso();
  const dow = new Date().getDay();
  let changed = false;
  for(const r of state.routines){
    if(!r.active) continue;
    if(!r.weekdays.includes(dow)) continue;
    if(r.lastGeneratedDate === iso) continue;

    // Reserva o dia no banco ANTES de criar a tarefa, e só se ninguém
    // reservou ainda. Cada aba e cada aparelho tem sua própria cópia de
    // lastGeneratedDate: com o app aberto no celular e no computador (ou uma
    // aba esquecida desde ontem), cada um gerava a sua e a rotina duplicava.
    const anterior = r.lastGeneratedDate;
    const {data: reservada, error: errReserva} = await sb.from('routines')
      .update({last_generated_date: iso})
      .eq('id', r.id)
      .or(`last_generated_date.is.null,last_generated_date.lt.${iso}`)
      .select('id');
    if(errReserva){ console.error(errReserva); continue; }
    r.lastGeneratedDate = iso;
    // Outra aba/aparelho chegou antes; a tarefa dela chega pelo realtime.
    if(!reservada || reservada.length === 0) continue;

    const created = await createTaskRemote({
      title: r.title,
      client: r.client,
      status: getColumns().some(c=>c.key===r.status) ? r.status : getColumns()[0].key,
      priority: r.priority,
      date: iso,
      time: r.time,
      notes: '',
      routine_id: r.id
    });
    if(created){
      state.tasks.push(created);
      await syncTaskToGoogle(created);
      changed = true;
    }else{
      // Devolve a reserva para a próxima checagem tentar de novo, em vez de
      // perder a tarefa do dia por uma falha de rede.
      await sb.from('routines').update({last_generated_date: anterior}).eq('id', r.id).eq('last_generated_date', iso);
      r.lastGeneratedDate = anterior;
    }
  }
  if(changed){ skipEntranceOnce = true; safeRerender(); }
}

let routineCheckTimer = null;
function startRoutineCheckLoop(){
  if(routineCheckTimer) return;
  routineCheckTimer = setInterval(()=>{ generateRoutineInstances(); }, 30 * 60 * 1000);
}
function stopRoutineCheckLoop(){
  if(routineCheckTimer){ clearInterval(routineCheckTimer); routineCheckTimer = null; }
}

async function createRoutine(data){
  const {data: r, error} = await sb.from('routines').insert({
    user_id: session.user.id,
    title: data.title,
    client: data.client || null,
    status: data.status,
    priority: data.priority,
    time: data.time || null,
    weekdays: data.weekdays
  }).select().single();
  if(error){console.error(error);showToast('Não deu para criar a rotina. Tente de novo em instantes.', 'erro');return null;}
  const routine = {
    id: r.id, title: r.title, client: r.client || '', status: r.status,
    priority: r.priority, time: r.time || '', weekdays: r.weekdays || [],
    active: true, lastGeneratedDate: null
  };
  state.routines.push(routine);
  await generateRoutineInstances();
  return routine;
}

async function updateRoutineRemote(id, data){
  const {error} = await sb.from('routines').update({
    title: data.title,
    client: data.client || null,
    status: data.status,
    priority: data.priority,
    time: data.time || null,
    weekdays: data.weekdays,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if(error){console.error(error);showToast('Não deu para salvar a rotina. Tente de novo em instantes.', 'erro');return false;}
  const r = state.routines.find(x=>x.id===id);
  if(r) Object.assign(r, data);
  return true;
}

async function toggleRoutineActive(id){
  const r = state.routines.find(x=>x.id===id);
  if(!r) return;
  const {error} = await sb.from('routines').update({active: !r.active}).eq('id', id);
  if(error){console.error(error);showToast('Não deu para pausar ou reativar a rotina. Tente de novo em instantes.', 'erro');return;}
  r.active = !r.active;
  renderSettingsRoutinesList();
  if(r.active) await generateRoutineInstances();
}

async function deleteRoutineRemote(id){
  const {error} = await sb.from('routines').delete().eq('id', id);
  if(error){console.error(error);showToast('Não deu para excluir a rotina. Tente de novo em instantes.', 'erro');return false;}
  state.routines = state.routines.filter(x=>x.id!==id);
  return true;
}

async function updateTaskRemote(id, data){
  const payload = {
    title: data.title,
    client: data.client || null,
    status: data.status,
    priority: data.priority,
    date: data.date || null,
    notes: data.notes || null
  };
  if('time' in data) payload.time = data.time || null;
  if('color_id' in data) payload.color_id = data.color_id || null;
  if('sync_google' in data) payload.sync_google = data.sync_google !== false;
  if('completed_at' in data) payload.completed_at = data.completed_at || null;
  if('project_id' in data) payload.project_id = data.project_id || null;
  if('assigned_to' in data) payload.assigned_to = data.assigned_to || null;
  if('tags' in data) payload.tags = data.tags || [];
  if('kind' in data) payload.kind = data.kind === 'evento' ? 'evento' : 'tarefa';
  const {error} = await sb.from('tasks').update(payload).eq('id', id);
  if(error){console.error(error);showToast('Não deu para atualizar. Tente de novo em instantes.', 'erro');return false;}
  return true;
}

async function deleteTaskRemote(id){
  const {error} = await sb.from('tasks').delete().eq('id', id);
  if(error){console.error(error);showToast('Não deu para excluir. Tente de novo em instantes.', 'erro');return false;}
  return true;
}

function projectsCacheKey(){
  return session && session.user ? `projectsCache:${session.user.id}` : null;
}

function restoreProjectsCache(){
  const key = projectsCacheKey();
  if(!key || state.projects.length) return;
  try{
    const salvo = JSON.parse(localStorage.getItem(key) || 'null');
    if(Array.isArray(salvo)){
      state.projects = salvo;
      renderSidebarProjects();
    }
  }catch(e){}
}

function saveProjectsCache(){
  const key = projectsCacheKey();
  if(!key) return;
  try{ localStorage.setItem(key, JSON.stringify(state.projects)); }catch(e){}
}

async function loadProjects(){
  const myEmail = session.user.email;

  // As três consultas não dependem uma da outra; em fila custavam três idas e
  // voltas a cada carregamento e a cada evento do realtime.
  const [{data: owned}, {data: memberOf}, {data: pending}] = await Promise.all([
    sb.from('projects').select('*').eq('owner_id', session.user.id),
    sb.from('project_members').select('project_id, projects(*)').eq('user_id', session.user.id).eq('status', 'accepted'),
    myEmail
      ? sb.from('project_members').select('*, projects(name)').eq('invited_email', myEmail.toLowerCase()).eq('status', 'pending')
      : Promise.resolve({data: []})
  ]);

  const projectMap = {};
  (owned || []).forEach(p=>{projectMap[p.id] = {...p, columns: normalizarColunas(p.columns), myRole: 'owner', members: []};});
  (memberOf || []).forEach(m=>{
    if(m.projects && !projectMap[m.project_id]){
      projectMap[m.project_id] = {...m.projects, columns: normalizarColunas(m.projects.columns), myRole: 'member', members: []};
    }
  });

  const projectIds = Object.keys(projectMap);
  if(projectIds.length > 0){
    const ownerIds = Object.values(projectMap).map(p=>p.owner_id).filter(Boolean);
    const {data: allMembers} = await sb.from('project_members').select('*').in('project_id', projectIds);
    (allMembers || []).forEach(m=>{
      if(projectMap[m.project_id]) projectMap[m.project_id].members.push(m);
    });

    const profileIds = new Set(ownerIds);
    Object.values(projectMap).forEach(p=>{
      p.members.forEach(m=>{if(m.user_id) profileIds.add(m.user_id);});
    });
    if(profileIds.size > 0){
      const {data: profiles} = await buscarPerfis([...profileIds]);
      const profileMap = {};
      (profiles || []).forEach(pr=>{profileMap[pr.id] = pr;});
      Object.values(projectMap).forEach(p=>{
        p.ownerProfile = profileMap[p.owner_id] || null;
        p.members.forEach(m=>{m.profile = m.user_id ? (profileMap[m.user_id] || null) : null;});
      });
    }
  }

  // A ordem do banco vale em outro aparelho: vira a deste navegador.
  if(Array.isArray(state.ordemProjetosPerfil) && state.ordemProjetosPerfil.length){
    guardarOrdemProjetos(state.ordemProjetosPerfil.filter(x=>typeof x === 'string'));
    state.ordemProjetosPerfil = null;
  }
  state.projects = ordenarProjetos(Object.values(projectMap));
  state.pendingInvites = pending || [];
  saveProjectsCache();
  updatePendingInvitesBadge();
  // Entrar ou sair de um projeto muda o que conta como não lido.
  carregarNaoLidasChat();
  // E muda quem pode continuar numa chamada (SEC-076).
  conferirAcessoChamada();
  // A moderação das salas vale por projeto; um cargo novo muda quem pode o quê.
  carregarModeracao();
  if(configProjeto) desenharConfigProjeto();
}

function updatePendingInvitesBadge(){
  const el = document.getElementById('pending-invites-badge');
  if(el){
    if(state.pendingInvites.length > 0){
      const n = state.pendingInvites.length;
      el.className = 'set-aba-badge';
      el.textContent = n;
      el.setAttribute('aria-label', `${n} convite${n > 1 ? 's' : ''} pendente${n > 1 ? 's' : ''}`);
    } else {
      el.className = '';
      el.textContent = '';
      el.removeAttribute('aria-label');
    }
  }
  renderSidebarProjects();
}

/* --- ícone do projeto (SEC-083) --- */

// A mesma lista do check em supabase/icone_projeto.sql: ícone novo entra nos
// dois. O SVG sai daqui, nunca do banco.
const ICONES_PROJETO = {
  foguete:  {nome: 'Foguete', svg: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'},
  estrela:  {nome: 'Estrela', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'},
  raio:     {nome: 'Raio', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'},
  coracao:  {nome: 'Coração', svg: '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>'},
  alvo:     {nome: 'Alvo', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'},
  livro:    {nome: 'Livro', svg: '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>'},
  codigo:   {nome: 'Código', svg: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'},
  musica:   {nome: 'Música', svg: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'},
  camera:   {nome: 'Câmera', svg: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>'},
  globo:    {nome: 'Globo', svg: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>'},
  casa:     {nome: 'Casa', svg: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'},
  maleta:   {nome: 'Maleta', svg: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>'},
  sacola:   {nome: 'Sacola', svg: '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>'},
  grafico:  {nome: 'Gráfico', svg: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'},
  chat:     {nome: 'Conversa', svg: '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>'},
  coroa:    {nome: 'Coroa', svg: '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>'},
  folha:    {nome: 'Folha', svg: '<path d="M11 20A7 7 0 019.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'},
  fogo:     {nome: 'Fogo', svg: '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 002.5 2.5z"/>'},
  diamante: {nome: 'Diamante', svg: '<path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3L8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>'},
  lampada:  {nome: 'Lâmpada', svg: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/>'},
  pessoas:  {nome: 'Pessoas', svg: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'},
  escudo:   {nome: 'Escudo', svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'},
  jogo:     {nome: 'Jogo', svg: '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/>'}
};
// O tom médio de cada família das cores de coluna.
const CORES_ICONE = FAMILIAS_COR.map(f=>({nome: f.nome, hex: f.cores[1]}));
// O mesmo formato do check em icone_projeto.sql. Só um caminho assim vira URL.
const ICONE_IMAGEM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/projeto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{1,16}\.(png|jpg|webp)$/;

function svgIconeProjeto(chave){
  const i = ICONES_PROJETO[chave];
  return i ? `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.svg}</svg>` : '';
}

// Sem cor escolhida, cada projeto ganha uma das cores pelo id: dois projetos
// lado a lado quase nunca saem iguais, e a cor não muda de um dia para o outro.
function corPadraoIcone(id){
  let h = 0;
  for(const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_ICONE[h % CORES_ICONE.length].hex;
}

function corDoIcone(p){
  return p && p.icone_cor ? hex6(p.icone_cor) : corPadraoIcone(p && p.id);
}

function inicialDoProjeto(nome){
  const primeira = Array.from(String(nome || '').trim())[0] || '?';
  return primeira.toLocaleUpperCase('pt-BR');
}

function urlImagemIcone(caminho){
  if(!caminho || !ICONE_IMAGEM_RE.test(caminho)) return null;
  const {data} = sb.storage.from('avatars').getPublicUrl(caminho);
  const url = data && data.publicUrl;
  return url && /^https:\/\//.test(url) ? url : null;
}

// Quadrado com a imagem (com borda), o ícone pronto ou a inicial. tam: p na
// barra lateral, m nas listas, g no topo do projeto. dados troca o que está
// salvo pelo rascunho do diálogo (com imagem em blob:).
function projetoIconeHtml(p, tam, dados){
  const d = dados || {icone: p.icone, cor: p.icone_cor, url: urlImagemIcone(p.icone_imagem)};
  const cor = d.cor ? hex6(d.cor) : corPadraoIcone(p.id);
  const url = d.url && /^(https:|blob:)/.test(d.url) ? d.url : null;
  const miolo = ICONES_PROJETO[d.icone] ? svgIconeProjeto(d.icone) : `<span class="proj-icone-letra">${esc(inicialDoProjeto(p.name))}</span>`;
  const classes = ['proj-icone', `proj-icone-${tam}`];
  if(corEhClara(cor)) classes.push('claro');
  if(url) classes.push('com-imagem');
  if(url && d.cor) classes.push('com-cor');
  // Se a imagem não carregar, o quadrado volta a mostrar o ícone ou a inicial.
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove('com-imagem','com-cor');this.remove()">` : '';
  return `<span class="${classes.join(' ')}" style="--icone-cor:${cor}" aria-hidden="true">${miolo}${img}</span>`;
}

/* diálogo */

let iconeRascunho = null;

function abrirIconeProjeto(pid){
  const p = state.projects.find(x=>x.id === pid);
  if(!p || !temPermissaoVoz(pid, 'icone')) return;
  if(iconeRascunho && iconeRascunho.blobUrl) URL.revokeObjectURL(iconeRascunho.blobUrl);
  iconeRascunho = {
    pid,
    icone: ICONES_PROJETO[p.icone] ? p.icone : null,
    cor: corDoIcone(p),
    imagem: p.icone_imagem && ICONE_IMAGEM_RE.test(p.icone_imagem) ? p.icone_imagem : null,
    arquivo: null, blobUrl: null, salvando: false
  };
  erroIconeProjeto('');
  desenharIconeProjeto();
  document.getElementById('icone-projeto').classList.add('open');
}

function fecharIconeProjeto(){
  document.getElementById('icone-projeto').classList.remove('open');
  if(iconeRascunho && iconeRascunho.blobUrl) URL.revokeObjectURL(iconeRascunho.blobUrl);
  iconeRascunho = null;
}

function erroIconeProjeto(msg){
  const el = document.getElementById('icone-projeto-erro');
  el.textContent = msg;
  el.hidden = !msg;
}

function dadosDoRascunho(r){
  return {icone: r.icone, cor: r.cor, url: r.blobUrl || urlImagemIcone(r.imagem)};
}

// A grade de ícones e a de cores só são montadas uma vez por abertura; depois,
// só a marcação muda, para o foco do teclado não se perder.
function desenharIconeProjeto(){
  const r = iconeRascunho;
  if(!r) return;
  const p = state.projects.find(x=>x.id === r.pid);
  if(!p) return;
  const dados = dadosDoRascunho(r);
  const temImagem = !!dados.url;
  document.getElementById('icone-projeto-previa').innerHTML = projetoIconeHtml(p, 'xg', dados);
  document.getElementById('icone-projeto-previa-lateral').innerHTML =
    `${projetoIconeHtml(p, 'p', dados)}<span class="sidebar-project-name">${esc(p.name)}</span>`;
  document.getElementById('icone-projeto-tirar').hidden = !temImagem;
  document.getElementById('icone-projeto-enviar').textContent = temImagem ? 'Trocar imagem' : 'Enviar imagem';

  const icones = document.getElementById('icone-projeto-icones');
  if(!icones.childElementCount){
    const letra = `<button type="button" role="radio" class="ip-icone" data-icone="" title="Inicial do nome" aria-label="Inicial do nome" onclick="escolherIconeProjeto('')"><span class="ip-icone-letra" id="icone-projeto-letra"></span></button>`;
    icones.innerHTML = letra + Object.keys(ICONES_PROJETO).map(k=>
      `<button type="button" role="radio" class="ip-icone" data-icone="${k}" title="${ICONES_PROJETO[k].nome}" aria-label="${ICONES_PROJETO[k].nome}" onclick="escolherIconeProjeto('${k}')">${svgIconeProjeto(k)}</button>`
    ).join('');
  }
  document.getElementById('icone-projeto-letra').textContent = inicialDoProjeto(p.name);
  // O ícone marcado já aparece na cor escolhida.
  icones.style.setProperty('--icone-cor', r.cor);
  icones.classList.toggle('claro', corEhClara(r.cor));
  const atual = temImagem ? null : (r.icone || '');
  marcarRadios(icones, '.ip-icone', b=>b.dataset.icone === atual);

  const cores = document.getElementById('icone-projeto-cores');
  if(!cores.childElementCount){
    cores.innerHTML = CORES_ICONE.map(c=>
      `<button type="button" role="radio" class="color-swatch-btn${corEhClara(c.hex) ? ' claro' : ''}" style="--sw:${c.hex}" data-cor="${c.hex}" title="${c.nome}" aria-label="${c.nome}" onclick="escolherCorIcone('${c.hex}')"></button>`
    ).join('') + `<label class="color-custom-pick" id="icone-projeto-cor-propria" title="Outra cor"><input type="color" aria-label="Escolher outra cor" oninput="escolherCorIcone(this.value)"></label>`;
  }
  const achou = marcarRadios(cores, '.color-swatch-btn', b=>b.dataset.cor === r.cor);
  const propria = document.getElementById('icone-projeto-cor-propria');
  propria.classList.toggle('selected', !achou);
  propria.style.setProperty('--sw', r.cor);
  propria.querySelector('input').value = r.cor;
}

// Rádio com tabindex móvel: só o marcado (ou o primeiro) entra no Tab.
function marcarRadios(grupo, seletor, ehMarcado){
  const botoes = [...grupo.querySelectorAll(seletor)];
  let achou = false;
  botoes.forEach(b=>{
    const sel = ehMarcado(b);
    if(sel) achou = true;
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-checked', String(sel));
    b.tabIndex = sel ? 0 : -1;
  });
  if(!achou && botoes.length) botoes[0].tabIndex = 0;
  return achou;
}

// Escolher um ícone pronto (ou a inicial) tira a imagem: com ela, o ícone não
// apareceria.
function escolherIconeProjeto(chave){
  const r = iconeRascunho;
  if(!r) return;
  r.icone = ICONES_PROJETO[chave] ? chave : null;
  tirarImagemIcone(true);
}

function escolherCorIcone(cor){
  if(!iconeRascunho || !/^#[0-9a-fA-F]{6}$/.test(cor)) return;
  iconeRascunho.cor = cor.toUpperCase();
  desenharIconeProjeto();
}

function tirarImagemIcone(semFoco){
  const r = iconeRascunho;
  if(!r) return;
  if(r.blobUrl) URL.revokeObjectURL(r.blobUrl);
  r.blobUrl = null;
  r.arquivo = null;
  r.imagem = null;
  desenharIconeProjeto();
  if(!semFoco) document.getElementById('icone-projeto-enviar').focus();
}

// Setas andam pelas grades como num grupo de rádio: mover já escolhe.
function teclaGradeIcone(e){
  const grade = e.currentTarget;
  const botoes = [...grade.querySelectorAll('button[role="radio"]')];
  const i = botoes.indexOf(document.activeElement);
  if(i === -1) return;
  const cols = getComputedStyle(grade).gridTemplateColumns.split(' ').length || 1;
  const passo = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols}[e.key];
  if(passo === undefined) return;
  const j = i + passo;
  if(j < 0 || j >= botoes.length) return;
  e.preventDefault();
  botoes[j].click();
  const novo = grade.querySelectorAll('button[role="radio"]')[j];
  if(novo) novo.focus();
}

// A imagem vira um quadrado de até 256 px, recortado no centro, antes de subir:
// o ícone tem no máximo 72 px na tela, e assim o arquivo fica pequeno.
async function recortarImagemQuadrada(arquivo){
  const bmp = await createImageBitmap(arquivo);
  const m = Math.min(bmp.width, bmp.height);
  const lado = Math.max(1, Math.min(256, m));
  const cv = document.createElement('canvas');
  cv.width = cv.height = lado;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, lado, lado);
  if(bmp.close) bmp.close();
  let blob = await new Promise(ok=>cv.toBlob(ok, 'image/webp', 0.9));
  // Safari antigo não gera WebP e devolve PNG ou nada.
  if(!blob || blob.type !== 'image/webp') blob = await new Promise(ok=>cv.toBlob(ok, 'image/png'));
  return blob;
}

async function escolherImagemIcone(input){
  const arquivo = input.files[0];
  input.value = '';
  const r = iconeRascunho;
  if(!arquivo || !r) return;
  if(!EXT_IMAGEM[arquivo.type]){ erroIconeProjeto('Formato não suportado. Escolha um JPG, PNG ou WebP.'); return; }
  if(arquivo.size > 4 * 1024 * 1024){ erroIconeProjeto('Imagem acima de 4 MB. Escolha uma menor.'); return; }
  let blob;
  try{ blob = await recortarImagemQuadrada(arquivo); }catch(e){ console.warn(e); blob = null; }
  if(iconeRascunho !== r) return;
  if(!blob){ erroIconeProjeto('Não deu para ler essa imagem. Tente outra.'); return; }
  erroIconeProjeto('');
  if(r.blobUrl) URL.revokeObjectURL(r.blobUrl);
  r.arquivo = blob;
  r.blobUrl = URL.createObjectURL(blob);
  desenharIconeProjeto();
}

async function salvarIconeProjeto(){
  const r = iconeRascunho;
  if(!r || r.salvando) return;
  const p = state.projects.find(x=>x.id === r.pid);
  if(!p) return fecharIconeProjeto();
  const ok = document.getElementById('icone-projeto-ok');
  r.salvando = true;
  ok.disabled = true;
  ok.textContent = 'Salvando…';
  erroIconeProjeto('');
  const terminar = (msg)=>{
    r.salvando = false;
    ok.disabled = false;
    ok.textContent = 'Salvar';
    if(msg) erroIconeProjeto(msg);
  };

  let caminho = r.imagem;
  let enviado = null;
  if(r.arquivo){
    const ext = r.arquivo.type === 'image/webp' ? 'webp' : 'png';
    enviado = `${session.user.id}/projeto-${p.id}-${Date.now()}.${ext}`;
    const {error} = await sb.storage.from('avatars').upload(enviado, r.arquivo, {contentType: r.arquivo.type, cacheControl: '31536000', upsert: false});
    if(error){ console.error(error); return terminar('Não deu para enviar a imagem. Tente de novo em instantes.'); }
    caminho = enviado;
  }

  const antes = p.icone_imagem;
  const mudanca = {icone: caminho ? null : r.icone, icone_cor: r.cor, icone_imagem: caminho || null};
  const {error} = await sb.from('projects').update(mudanca).eq('id', p.id);
  if(error){
    console.error(error);
    if(enviado) sb.storage.from('avatars').remove([enviado]).catch(()=>{});
    const semColuna = error.code === '42703' || error.code === 'PGRST204' || /icone/.test(error.message || '');
    return terminar(semColuna
      ? 'O banco ainda não tem o ícone do projeto: falta rodar o supabase/icone_projeto.sql no Supabase.'
      : 'Não deu para salvar o ícone. Tente de novo em instantes.');
  }
  // A imagem antiga sai do bucket, se for da própria pasta (a de outra pessoa
  // o bucket não deixa apagar).
  if(antes && antes !== caminho && antes.startsWith(session.user.id + '/') && ICONE_IMAGEM_RE.test(antes)){
    sb.storage.from('avatars').remove([antes]).catch(()=>{});
  }
  Object.assign(p, mudanca);
  terminar('');
  fecharIconeProjeto();
  render();
  showToast('Ícone do projeto atualizado');
}

/* --- ordem dos projetos na barra lateral --- */

// A ordem é de cada pessoa: fica no navegador (vale na hora e sem o banco) e
// em profiles.ordem_projetos (vale em outro aparelho; supabase/ordem_projetos.sql).
// Projeto que não está na lista (novo, ou aceito agora) entra no fim.
function ordemProjetosKey(){
  return session && session.user ? `ordemProjetos:${session.user.id}` : null;
}

function lerOrdemProjetos(){
  const key = ordemProjetosKey();
  if(!key) return [];
  try{
    const o = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(o) ? o.filter(x=>typeof x === 'string') : [];
  }catch(e){ return []; }
}

function guardarOrdemProjetos(ids){
  const key = ordemProjetosKey();
  if(!key) return;
  try{ localStorage.setItem(key, JSON.stringify(ids)); }catch(e){}
}

function ordenarProjetos(lista){
  const ordem = lerOrdemProjetos();
  const pos = id=>{ const i = ordem.indexOf(id); return i === -1 ? Infinity : i; };
  return lista.map((p, i)=>({p, i})).sort((a, b)=>(pos(a.p.id) - pos(b.p.id)) || (a.i - b.i)).map(x=>x.p);
}

let salvarOrdemTimer = null;
async function salvarOrdemProjetos(ids){
  guardarOrdemProjetos(ids);
  // Vários movimentos seguidos viram uma gravação só. Se o banco ainda não tem
  // a coluna, a ordem segue valendo neste navegador.
  clearTimeout(salvarOrdemTimer);
  salvarOrdemTimer = setTimeout(async ()=>{
    const {error} = await sb.from('profiles').update({ordem_projetos: ids}).eq('id', session.user.id);
    if(error) console.warn('ordem dos projetos só neste navegador:', error.message);
  }, 600);
}

function moverProjeto(id, novoIndice){
  const ids = state.projects.map(p=>p.id);
  const de = ids.indexOf(id);
  if(de === -1 || novoIndice < 0 || novoIndice >= ids.length || novoIndice === de) return false;
  ids.splice(novoIndice, 0, ids.splice(de, 1)[0]);
  state.projects = ids.map(i=>state.projects.find(p=>p.id === i));
  salvarOrdemProjetos(ids);
  saveProjectsCache();
  return true;
}

// Segurar o projeto (~0,4 s) e arrastar para cima ou para baixo. Antes de
// segurar, mexer mais que alguns pixels cancela, e a barra rola normalmente no
// toque. Alt + seta faz o mesmo pelo teclado.
const SEGURAR_PROJETO_MS = 400;
let arrastoProjeto = null;
let ignorarCliqueProjeto = false;

function iniciarArrastoProjeto(e){
  if(e.button > 0 || arrastoProjeto) return;
  const item = e.target.closest('.sidebar-project-item[data-pid]');
  if(!item || state.projects.length < 2) return;
  const a = arrastoProjeto = {
    item, id: item.dataset.pid, pointerId: e.pointerId, x: e.clientX, y: e.clientY,
    ativo: false, timer: null, itens: [], rects: null, ordem: null, ordemInicial: null
  };
  a.timer = setTimeout(()=>levantarProjeto(a), SEGURAR_PROJETO_MS);
  document.addEventListener('pointermove', moverArrastoProjeto);
  document.addEventListener('pointerup', terminarArrastoProjeto, {once: true});
  document.addEventListener('pointercancel', terminarArrastoProjeto, {once: true});
}

function levantarProjeto(a){
  if(arrastoProjeto !== a) return;
  a.ativo = true;
  a.itens = [...document.querySelectorAll('#sidebar-projects .sidebar-project-item[data-pid]')];
  a.ordemInicial = a.itens.map(el=>el.dataset.pid);
  a.ordem = [...a.ordemInicial];
  a.rects = new Map(a.itens.map(el=>[el.dataset.pid, el.getBoundingClientRect()]));
  a.item.classList.add('arrastando');
  document.getElementById('sidebar-projects').classList.add('reordenando');
  try{ a.item.setPointerCapture(a.pointerId); }catch(err){}
  if(navigator.vibrate) navigator.vibrate(12);
}

function moverArrastoProjeto(e){
  const a = arrastoProjeto;
  if(!a || e.pointerId !== a.pointerId) return;
  const dx = e.clientX - a.x, dy = e.clientY - a.y;
  if(!a.ativo){
    if(Math.hypot(dx, dy) > 6) cancelarArrastoProjeto();
    return;
  }
  a.item.style.transform = `translateY(${dy}px) scale(1.02)`;
  const meu = a.rects.get(a.id);
  const centro = meu.top + meu.height / 2 + dy;
  const centros = a.ordemInicial.map(k=>{ const r = a.rects.get(k); return r.top + r.height / 2; });
  let idx = 0, melhor = Infinity;
  centros.forEach((c, i)=>{ const d = Math.abs(c - centro); if(d < melhor){ melhor = d; idx = i; } });
  const nova = a.ordemInicial.filter(k=>k !== a.id);
  nova.splice(idx, 0, a.id);
  if(nova.join() === a.ordem.join()) return;
  a.ordem = nova;
  for(const el of a.itens){
    if(el === a.item) continue;
    const k = el.dataset.pid;
    const slot = a.rects.get(a.ordemInicial[nova.indexOf(k)]);
    const orig = a.rects.get(k);
    const mover = slot.top - orig.top;
    el.style.transform = mover ? `translateY(${mover}px)` : '';
  }
}

function cancelarArrastoProjeto(){
  const a = arrastoProjeto;
  if(!a) return;
  clearTimeout(a.timer);
  document.removeEventListener('pointermove', moverArrastoProjeto);
  document.removeEventListener('pointerup', terminarArrastoProjeto);
  document.removeEventListener('pointercancel', terminarArrastoProjeto);
  arrastoProjeto = null;
}

function terminarArrastoProjeto(e){
  const a = arrastoProjeto;
  if(!a) return;
  cancelarArrastoProjeto();
  if(!a.ativo) return;
  // O clique que sai de soltar o dedo não abre o projeto.
  ignorarCliqueProjeto = true;
  setTimeout(()=>{ ignorarCliqueProjeto = false; }, 0);
  const wrap = document.getElementById('sidebar-projects');
  if(wrap) wrap.classList.remove('reordenando');
  for(const el of a.itens){ el.style.transform = ''; el.classList.remove('arrastando'); }
  const mudou = e && e.type === 'pointerup' && a.ordem.join() !== a.ordemInicial.join();
  if(mudou){
    moverProjeto(a.id, a.ordem.indexOf(a.id));
    renderSidebarProjects();
  }
}

document.addEventListener('click', e=>{
  if(ignorarCliqueProjeto && e.target.closest && e.target.closest('.sidebar-project-item')){
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// No toque, depois de segurar, o dedo arrasta o projeto em vez de rolar a barra.
document.addEventListener('touchmove', e=>{
  if(arrastoProjeto && arrastoProjeto.ativo && e.cancelable) e.preventDefault();
}, {passive: false});

// Aviso só para leitor de tela, sem toast na vista.
function anunciarNoApp(texto){
  let el = document.getElementById('anuncio-app');
  if(!el){
    el = document.createElement('div');
    el.id = 'anuncio-app';
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(()=>{ el.textContent = texto; }, 30);
}

function teclaProjeto(e){
  if(!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const item = e.target.closest('.sidebar-project-item[data-pid]');
  if(!item) return;
  e.preventDefault();
  const id = item.dataset.pid;
  const i = state.projects.findIndex(p=>p.id === id);
  if(!moverProjeto(id, i + (e.key === 'ArrowUp' ? -1 : 1))) return;
  renderSidebarProjects();
  const novo = document.querySelector(`#sidebar-projects .sidebar-project-item[data-pid="${id}"]`);
  if(novo) novo.focus();
  anunciarNoApp(`${state.projects.find(p=>p.id === id).name}: posição ${state.projects.findIndex(p=>p.id === id) + 1} de ${state.projects.length}`);
}

function renderSidebarProjects(){
  const wrap = document.getElementById('sidebar-projects');
  if(!wrap) return;
  if(!wrap.dataset.arrasto){
    wrap.dataset.arrasto = '1';
    wrap.addEventListener('pointerdown', iniciarArrastoProjeto);
    wrap.addEventListener('keydown', teclaProjeto);
    wrap.addEventListener('contextmenu', e=>{ if(arrastoProjeto && arrastoProjeto.ativo) e.preventDefault(); });
  }

  let html = '';

  if(state.pendingInvites.length > 0){
    html += `
      <button class="sidebar-invite-pill" onclick="openProjectsModal()" style="cursor:pointer;">
        <span class="sidebar-invite-dot"></span>
        ${state.pendingInvites.length} convite${state.pendingInvites.length>1?'s':''} pendente${state.pendingInvites.length>1?'s':''}
      </button>`;
  }

  // Sempre visível, mesmo sem projeto: o + no título abre as duas formas de
  // ter um projeto, criar um ou entrar no de alguém com o código do convite.
  html += `
    <div class="nav-section-head nav-section-head-menu">
      <div class="nav-label">Projetos</div>
      <div class="novo-menu nav-novo-projeto">
        <button class="nav-section-add novo-menu-btn" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)" title="Criar projeto ou entrar com código" aria-label="Criar projeto ou entrar com código">${ICONE_MAIS}</button>
        <div class="novo-menu-lista" role="menu" hidden>${itensNovoProjeto()}</div>
      </div>
    </div>`;
  if(state.projects.length === 0){
    html += `<button class="nav-empty-acao" onclick="novoProjetoRapido()">Criar o primeiro projeto</button>
      <button class="nav-empty-acao" onclick="entrarComCodigoRapido()">Entrar com código de convite</button>`;
  } else {
    html += state.projects.map(p=>{
      const role = esc(curtoDoCargo(myRoleInProject(p.id), p));
      const isActive = state.view === 'project' && state.currentProjectId === p.id;
      return `
        <button class="sidebar-project-item ${isActive?'active':''}" data-pid="${p.id}" onclick="openProjectView('${p.id}')" title="${esc(p.name)} · segure e arraste para mudar a ordem" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
          ${projetoIconeHtml(p, 'p')}
          <span class="sidebar-project-name">${esc(p.name)}</span>
          ${seloNaoLidas(p.id)}
          <span class="sidebar-project-role">${role}</span>
        </button>`;
    }).join('');
  }

  wrap.innerHTML = html;
}

function myRoleInProject(projectId){
  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return null;
  if(p.myRole === 'owner') return 'owner';
  const m = p.members.find(x=>x.user_id===session.user.id);
  return m ? m.role : null;
}

function canEditProject(projectId){
  const role = myRoleInProject(projectId);
  return role === 'owner' || role === 'editor';
}

// Cargos (RFC 0005): dono, editor, participante e visualizador. O
// participante mexe nas tarefas, não na estrutura (colunas, notas, canais,
// ícone, abas). Quem decide de verdade é o RLS (configuracoes_projeto.sql,
// SEC-085); aqui é só o que a tela mostra. Cargo desconhecido conta como
// visualizador, o que pode menos.
const CARGOS = {
  owner: {nome: 'Dono', curto: 'Dono', nivel: 3, desc: 'Tudo, inclusive cargos, regras e excluir o projeto.'},
  editor: {nome: 'Editor', curto: 'Editor', nivel: 2, desc: 'Tarefas, colunas, notas, canais, ícone e abas.'},
  participante: {nome: 'Participante', curto: 'Participa', nivel: 1, desc: 'Cria e mexe nas tarefas, conversa e entra nas salas.'},
  viewer: {nome: 'Visualizador', curto: 'Vendo', nivel: 0, desc: 'Vê o projeto, conversa e entra nas salas.'}
};
const CARGOS_DE_MEMBRO = ['editor', 'participante', 'viewer'];

function cargoValido(role){
  return role === 'owner' || CARGOS_DE_MEMBRO.includes(role) ? role : 'viewer';
}

// O dono pode dar outro nome a cada cargo do projeto (RFC 0006): o
// "Editor" vira "Moderador". O nome é texto de quem escreveu: sempre por
// esc() no HTML. Sem nome próprio (ou com um que não passa), o padrão.
const CARGO_NOME_MAX = 24;
function nomesDosCargos(p){
  const n = p && p.nomes_cargos;
  return n && typeof n === 'object' && !Array.isArray(n) ? n : {};
}
function nomeDoCargo(role, p){
  const r = cargoValido(role);
  const v = nomesDosCargos(p)[r];
  return typeof v === 'string' && v.trim() && v.length <= CARGO_NOME_MAX && !/[<>\u0000-\u001f\u007f]/.test(v) ? v : CARGOS[r].nome;
}
// Na barra lateral cabe pouco: o nome próprio, se houver, ou o curto padrão.
function curtoDoCargo(role, p){
  const r = cargoValido(role);
  const nome = nomeDoCargo(r, p);
  return nome === CARGOS[r].nome ? CARGOS[r].curto : nome;
}

// O cargo de qualquer pessoa no projeto, pela lista carregada. null para
// quem não é (mais) do projeto.
function cargoNoProjeto(p, uid){
  if(!p || !uid) return null;
  if(uid === p.owner_id) return 'owner';
  const m = (p.members || []).find(x=>x.user_id === uid && x.status === 'accepted');
  return m ? cargoValido(m.role) : null;
}

function mexeEmTarefas(projectId){
  const role = myRoleInProject(projectId);
  return role === 'owner' || role === 'editor' || role === 'participante';
}

function opcoesDeCargo(atual, p){
  return CARGOS_DE_MEMBRO.map(r=>`<option value="${r}" ${r === atual ? 'selected' : ''}>${esc(nomeDoCargo(r, p))}</option>`).join('');
}

// Título de seção da barra lateral com o + que só aparece ao passar o mouse
// (ou ao chegar nele pelo Tab).
function cabecalhoSecaoNav(nome, acao, rotulo){
  return `
    <div class="nav-section-head">
      <div class="nav-label">${nome}</div>
      <button class="nav-section-add" onclick="${acao}" title="${rotulo}" aria-label="${rotulo}">${ICONE_MAIS}</button>
    </div>`;
}

async function criarProjetoRemoto(name){
  const {data, error} = await sb.from('projects').insert({name, owner_id: session.user.id, owner_email: session.user.email}).select().single();
  if(error){console.error(error);showToast('Não deu para criar o projeto. Tente de novo em instantes.', 'erro');return null;}
  return data;
}

async function createProject(){
  const nameInput = document.getElementById('new-project-name');
  const name = nameInput.value.trim();
  if(!name){nameInput.focus();return;}
  if(!await criarProjetoRemoto(name)) return;
  nameInput.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast('Projeto criado');
}

// As duas opções do + de Projetos (barra lateral) e do "Novo projeto" do
// celular. Usam o menu do "+ Novo" do projeto (alternarMenuNovo), que já fecha
// com clique fora e com Esc.
function itensNovoProjeto(){
  const item = (k, nome, desc)=>`<button role="menuitem" class="novo-menu-item" onclick="escolherNovoProjeto('${k}')"><span class="novo-menu-nome">${nome}</span><span class="novo-menu-desc">${desc}</span></button>`;
  return item('criar', 'Criar projeto', 'Quadro, canais e salas de voz')
    + item('codigo', 'Entrar com código', 'O código ou link do convite');
}

function escolherNovoProjeto(k){
  const b = document.querySelector('.novo-menu-btn[aria-expanded="true"]');
  if(b) alternarMenuNovo(b, true);
  if(k === 'codigo') entrarComCodigoRapido();
  else novoProjetoRapido();
}

function novoProjetoRapido(){ abrirProjetoRapido('criar'); }
function entrarComCodigoRapido(){ abrirProjetoRapido('codigo'); }

// Diálogo próprio de "Criar projeto" e "Entrar com código", com um campo só,
// em vez do perguntar() genérico: diz o que acontece, mostra o erro no próprio
// diálogo e, no código, o campo tem cara de código.
const PROJETO_RAPIDO = {
  criar: {
    titulo: 'Novo projeto',
    texto: 'Um quadro do time, com canais de texto e salas de voz. Depois de criar, chame quem quiser pelo botão Convidar.',
    rotulo: 'Nome do projeto', placeholder: 'Ex: Lançamento da loja', dica: '',
    ok: 'Criar projeto', enviando: 'Criando…', max: 80
  },
  codigo: {
    titulo: 'Entrar com código',
    texto: 'Digite o código que te mandaram para entrar no projeto de outra pessoa.',
    rotulo: 'Código ou link do convite', placeholder: '7F3K2A', dica: 'Pode colar o link inteiro do convite.',
    ok: 'Entrar no projeto', enviando: 'Entrando…', max: 300
  }
};
let projetoRapidoModo = null;
let projetoRapidoEnviando = false;

function abrirProjetoRapido(modo){
  const m = PROJETO_RAPIDO[modo];
  if(!m) return;
  projetoRapidoModo = modo;
  projetoRapidoEnviando = false;
  const caixa = document.getElementById('projeto-rapido');
  caixa.dataset.modo = modo;
  document.getElementById('projeto-rapido-titulo').textContent = m.titulo;
  document.getElementById('projeto-rapido-texto').textContent = m.texto;
  document.getElementById('projeto-rapido-rotulo').textContent = m.rotulo;
  document.getElementById('projeto-rapido-dica').textContent = m.dica;
  const campo = document.getElementById('projeto-rapido-campo');
  campo.value = '';
  campo.placeholder = m.placeholder;
  campo.maxLength = m.max;
  campo.spellcheck = modo !== 'codigo';
  campo.setAttribute('autocapitalize', modo === 'codigo' ? 'characters' : 'sentences');
  document.getElementById('projeto-rapido-ok').textContent = m.ok;
  erroProjetoRapido('');
  atualizarOkProjetoRapido();
  caixa.classList.add('open');
  // O fundo leva alguns quadros para deixar de ser invisível, e focar antes
  // disso não pega. Um setTimeout fixo de 50 ms às vezes chegava cedo e o foco
  // se perdia; repete até o campo estar mesmo com o foco.
  const focar = (resta)=>{
    if(projetoRapidoModo !== modo) return;
    campo.focus();
    if(document.activeElement !== campo && resta > 0) setTimeout(()=>focar(resta - 1), 40);
  };
  setTimeout(()=>focar(10), 30);
}

function fecharProjetoRapido(){
  document.getElementById('projeto-rapido').classList.remove('open');
  projetoRapidoModo = null;
}

function erroProjetoRapido(msg){
  const el = document.getElementById('projeto-rapido-erro');
  el.textContent = msg;
  el.hidden = !msg;
  document.getElementById('projeto-rapido-campo').setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function projetoRapidoValido(){
  const v = document.getElementById('projeto-rapido-campo').value;
  return projetoRapidoModo === 'codigo' ? codigoDoConvite(v).length >= 4 : v.trim().length > 0;
}

function atualizarOkProjetoRapido(){
  document.getElementById('projeto-rapido-ok').disabled = projetoRapidoEnviando || !projetoRapidoValido();
}

// No código, o link colado vira só o código, em maiúsculas e sem espaços.
function digitarProjetoRapido(campo){
  if(projetoRapidoModo === 'codigo'){
    const limpo = codigoDoConvite(campo.value);
    if(campo.value !== limpo) campo.value = limpo;
  }
  erroProjetoRapido('');
  atualizarOkProjetoRapido();
}

async function enviarProjetoRapido(){
  const modo = projetoRapidoModo;
  if(!modo || projetoRapidoEnviando || !projetoRapidoValido()) return;
  const m = PROJETO_RAPIDO[modo];
  const campo = document.getElementById('projeto-rapido-campo');
  const ok = document.getElementById('projeto-rapido-ok');
  projetoRapidoEnviando = true;
  ok.textContent = m.enviando;
  atualizarOkProjetoRapido();
  try{
    if(modo === 'criar'){
      const criado = await criarProjetoRemoto(campo.value.trim().slice(0, 80));
      if(!criado) return;
      await loadProjects();
      fecharProjetoRapido();
      openProjectView(criado.id);
      showToast('Projeto criado');
    }else{
      const r = await aceitarCodigoDeConvite(codigoDoConvite(campo.value), {noDialogo: true});
      if(!r) return;
      if(r.erro){ erroProjetoRapido(r.erro); campo.focus(); campo.select(); return; }
      fecharProjetoRapido();
      if(r.project_id && state.projects.some(p=>p.id === r.project_id)) openProjectView(r.project_id);
      else render();
    }
  }finally{
    projetoRapidoEnviando = false;
    if(projetoRapidoModo === modo){ ok.textContent = m.ok; atualizarOkProjetoRapido(); }
  }
}

// Atalho do cabeçalho do projeto: abre a lista de projetos já no campo de
// convite deste, em vez de a pessoa caçar o cartão certo.
function convidarNoProjeto(projectId){
  openProjectsModal();
  setTimeout(()=>{
    const input = document.getElementById(`invite-email-${projectId}`);
    if(!input) return;
    input.closest('.project-card').scrollIntoView({block: 'center'});
    input.focus();
  }, 60);
}

async function inviteToProject(projectId){
  const emailInput = document.getElementById(`invite-email-${projectId}`);
  const roleSelect = document.getElementById(`invite-role-${projectId}`);
  const email = emailInput.value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showToast('Confira o email — falta algo como nome@dominio.com.', 'erro');emailInput.focus();return;}
  if(email === (session.user.email || '').toLowerCase()){showToast('Esse é o seu email — você já está no projeto.', 'erro');return;}
  const p = state.projects.find(x=>x.id===projectId);
  if(p && p.members.some(m=>m.invited_email === email)){showToast('Essa pessoa já foi convidada para este projeto.', 'erro');return;}
  const role = cargoValido(roleSelect.value);
  if(!cargosParaConvidar(projectId).includes(role)){showToast('Seu cargo não convida para esse cargo.', 'erro');return;}
  const {error} = await sb.from('project_members').insert({
    project_id: projectId,
    invited_email: email,
    role,
    status: 'pending'
  });
  if(error){console.error(error);showToast(erroDeCargo(error, role) || 'Não deu para enviar o convite. Confira o email e tente de novo.', 'erro');return;}
  emailInput.value = '';
  await loadProjects();
  renderProjectsModal();
  // Nenhum email sai daqui: o convite só aparece quando a pessoa entra no app
  // com esse endereço. "Convite enviado" fazia o dono esperar um email que
  // nunca chegava.
  showToast(`Convite criado. Avise ${email} — ele aparece quando a pessoa entrar com esse email.`);
}

// O código dá entrada no projeto: Math.random não é fonte segura para isso.
// 32 símbolos divide 256 exato, então o resto não enviesa a distribuição.
function genInviteCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b=>chars[b % chars.length]).join('');
}

async function generateInviteCode(projectId){
  const roleSelect = document.getElementById(`code-role-${projectId}`);
  const code = genInviteCode();
  const role = cargoValido(roleSelect.value);
  if(!cargosParaConvidar(projectId).includes(role)){showToast('Seu cargo não convida para esse cargo.', 'erro');return;}
  const {error} = await sb.from('project_members').insert({
    project_id: projectId,
    invited_email: null,
    role,
    status: 'pending',
    code
  });
  if(error){console.error(error);showToast(erroDeCargo(error, role) || 'Não deu para gerar o código. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
  // Só o dono vê os convites pendentes na lista (SEC-044): quem não é dono
  // fica com o código no aviso, que dura mais.
  const dono = (state.projects.find(x=>x.id === projectId) || {}).myRole === 'owner';
  try{
    await navigator.clipboard.writeText(linkDoConvite(code));
    showToast(`Código ${code} gerado e link copiado. Mande para uma pessoa.`);
  }catch(e){
    showToast(dono ? `Código gerado: ${code}. Use "Copiar link" ao lado dele.` : `Código gerado: ${code}. Anote e mande para a pessoa: ela entra com ele em "Entrar com código".`);
  }
}

// Aceita o convite por código: recarrega os projetos e avisa. Devolve a
// resposta do banco (com project_id) ou null, já com o aviso de erro dado.
// Com noDialogo, o erro volta como {erro} para aparecer no próprio diálogo.
async function aceitarCodigoDeConvite(code, opts){
  const noDialogo = !!(opts && opts.noDialogo);
  const falhar = (msg)=>{ if(noDialogo) return {erro: msg}; showToast(msg, 'erro'); return null; };
  const {data, error} = await sb.rpc('accept_invite_by_code', {p_code: code});
  if(error){console.error(error);return falhar('Não deu para entrar agora. Confira a conexão e tente de novo.');}
  if(!data || !data.success){
    const msg = data && data.error ? String(data.error) : '';
    return falhar(!msg || /inválido|usado/i.test(msg)
      ? 'Esse código está errado ou já foi usado. Peça um novo para quem te convidou.'
      : `${msg.replace(/\.$/, '')}.`);
  }
  await loadProjects();
  showToast(data.already_member ? 'Você já era membro desse projeto' : 'Você entrou no projeto!');
  return data;
}

async function joinByCode(){
  const input = document.getElementById('join-code-input');
  const code = codigoDoConvite(input.value);
  if(!code){input.focus();return;}
  if(!await aceitarCodigoDeConvite(code)) return;
  input.value = '';
  renderProjectsModal();
  render();
}

async function removeMember(memberId){
  if(!await confirmar('Ela perde o acesso às tarefas compartilhadas deste projeto.', {title:'Remover essa pessoa?', okLabel:'Remover'})) return;
  const {error} = await sb.from('project_members').delete().eq('id', memberId);
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
  if(configProjeto) desenharConfigProjeto();
  showToast('Removido');
}

// Sem o configuracoes_projeto.sql, a policy de convite recusa o participante e
// a função de mudar cargo não existe: o aviso diz o que falta.
function erroDeCargo(error, role){
  if(!error) return '';
  const t = `${error.message || ''} ${error.code || ''}`;
  if(/PGRST202|42883/.test(t)) return 'Mudar cargo precisa do supabase/configuracoes_projeto.sql. Rode ele no Supabase.';
  if(role === 'participante' && /row-level security|42501|check/.test(t)) return 'O cargo Participante precisa do supabase/configuracoes_projeto.sql. Rode ele no Supabase.';
  if(/row-level security|42501/.test(t)) return 'O banco recusou o convite. Se você não é o dono, confira na aba Cargos se o seu cargo convida, e se o supabase/configuracoes_projeto.sql novo já rodou.';
  if(/cargo_sem_permissao/.test(t)) return 'Só o dono do projeto muda cargos.';
  return '';
}

// O dono muda o cargo pela função do banco (SEC-084): o UPDATE direto em
// project_members continua fechado, para o convidado não escolher o próprio
// cargo ao aceitar. O select volta ao cargo de antes se não der.
async function mudarCargo(memberId, role, select){
  role = cargoValido(role);
  let p = null, m = null;
  for(const x of state.projects){ const achou = (x.members || []).find(y=>y.id === memberId); if(achou){ p = x; m = achou; break; } }
  if(!p || !m || role === 'owner' || !podeMudarCargoDe(p.id, m) || !cargosParaDar(p.id).includes(role)) return;
  const antes = cargoValido(m.role);
  if(antes === role) return;
  if(select) select.disabled = true;
  const {error} = await sb.rpc('definir_cargo_membro', {p_membro: memberId, p_cargo: role});
  if(select) select.disabled = false;
  if(error){
    console.error(error);
    if(select) select.value = antes;
    showToast(erroDeCargo(error, role) || 'Não deu para mudar o cargo. Tente de novo em instantes.', 'erro');
    return;
  }
  m.role = role;
  const nome = (m.profile && m.profile.name) || m.invited_email || 'O convite';
  showToast(`${nome} agora é ${nomeDoCargo(role, p)}`);
  await loadProjects();
  if(document.getElementById('projects-modal').classList.contains('open')) renderProjectsModal();
  if(configProjeto) desenharConfigProjeto();
  safeRerender();
}

async function acceptInvite(memberId){
  const invite = state.pendingInvites.find(i=>i.id===memberId);
  const {error} = await sb.from('project_members').update({user_id: session.user.id, status: 'accepted'}).eq('id', memberId);
  if(error){
    if(error.code === '23505' || (error.message||'').includes('duplicate')){
      await sb.from('project_members').delete().eq('id', memberId);
      await loadProjects();
      renderProjectsModal();
      showToast('Você já era membro desse projeto');
      render();
      return;
    }
    console.error(error);showToast('Não deu para aceitar o convite. Tente de novo em instantes.', 'erro');
    return;
  }
  await loadProjects();
  renderProjectsModal();
  showToast('Convite aceito');
  render();
}

async function declineInvite(memberId){
  const {error} = await sb.from('project_members').delete().eq('id', memberId);
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
}

async function leaveProject(projectId){
  if(!await confirmar('Você perde o acesso às tarefas compartilhadas dele.', {title:'Sair deste projeto?', okLabel:'Sair do projeto'})) return;
  const {error} = await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', session.user.id);
  if(error){console.error(error);showToast('Não deu para sair do projeto. Tente de novo em instantes.', 'erro');return;}
  if(state.view === 'project' && state.currentProjectId === projectId){
    state.view = 'dashboard';
    state.currentProjectId = null;
  }
  // As tarefas do projeto, inclusive as que você criou, saem junto.
  await Promise.all([loadProjects(), loadTasks()]);
  renderProjectsModal();
  showToast('Você saiu do projeto');
  render();
}

async function deleteProject(projectId){
  if(!await confirmar('As tarefas voltam a ser privadas, mas o projeto some para todo mundo.', {title:'Excluir este projeto?', okLabel:'Excluir projeto'})) return;
  const {error} = await sb.from('projects').delete().eq('id', projectId);
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
  showToast('Projeto excluído');
  render();
}

function flushNotesIfPending(){
  if(notesSaveTimer){
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
    saveProjectNotes();
  }
}

function openProjectView(projectId){
  flushNotesIfPending();
  const outroLugar = state.currentProjectId !== projectId || state.view !== 'project';
  if(state.currentProjectId !== projectId) state.projCalSelectedDate = null;
  if(state.view !== 'project') state.viewBeforeProject = state.view;
  if(outroLugar) state.projectTasksView = visaoProjetoSalva(projectId);
  state.currentProjectId = projectId;
  state.view = 'project';
  // Chegar num projeto (ou trocar de projeto) tem a transição da tela; clicar
  // no projeto em que já se está só redesenha.
  if(outroLugar) trocarComTransicao(()=>render(), 'projeto', false);
  else render();
  window.scrollTo(0,0);
}

// O botão de voltar levava sempre ao painel, mesmo para quem chegou pela aba
// Projetos do celular ou pelo Kanban.
function voltarDoProjeto(){
  flushNotesIfPending();
  state.view = state.viewBeforeProject || 'dashboard';
  state.viewBeforeProject = null;
  render();
  window.scrollTo(0,0);
}

let notesSaveTimer = null;
function scheduleProjectNotesSave(){
  const indicator = document.getElementById('notes-save-indicator');
  if(indicator){ indicator.textContent = 'Salvando…'; indicator.classList.remove('erro'); }
  if(notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(saveProjectNotes, 900);
}

async function saveProjectNotes(){
  const el = document.getElementById('project-notes-editor');
  if(!el) return;
  if(el.dataset.nota) return salvarNotaProjeto(el);
  const p = state.projects.find(x=>x.id===state.currentProjectId);
  if(!p) return;
  const html = sanitizeNotesHtml(el.innerHTML);
  const {error} = await sb.from('projects').update({notes: html}).eq('id', p.id);
  const indicator = document.getElementById('notes-save-indicator');
  if(error){
    // Falhava calado: a pessoa saía achando que a nota estava salva.
    console.error(error);
    if(indicator){
      indicator.textContent = 'Não salvou — edite de novo';
      indicator.classList.add('erro');
    }
    showToast('A nota do projeto não foi salva. Confira a conexão e edite de novo.', 'erro');
    return;
  }
  p.notes = html;
  if(indicator){
    indicator.textContent = 'Salvo agora';
    setTimeout(()=>{
      const atual = document.getElementById('notes-save-indicator');
      if(atual && atual.textContent === 'Salvo agora') atual.textContent = 'Salvo automaticamente';
    }, 2500);
  }
}

function execEditorCmd(cmd, value){
  document.getElementById('project-notes-editor').focus();
  // O botão de título só aplicava: apertar de novo não voltava a texto normal.
  if(cmd === 'formatBlock' && value === 'H3' && /^h3$/i.test(document.queryCommandValue('formatBlock'))) value = 'P';
  document.execCommand(cmd, false, value || null);
  scheduleProjectNotesSave();
  atualizarFerramentasNotas();
}

function atualizarFerramentasNotas(){
  const ed = document.getElementById('project-notes-editor');
  if(!ed) return;
  const sel = document.getSelection();
  const dentro = sel && sel.anchorNode && ed.contains(sel.anchorNode);
  let bloco = '';
  try{ bloco = dentro ? String(document.queryCommandValue('formatBlock')) : ''; }catch(e){}
  const emTitulo = /^h[1-6]$/i.test(bloco);
  document.querySelectorAll('.proj-nota-btn[data-cmd]').forEach(btn=>{
    const cmd = btn.dataset.cmd;
    let ativo = false;
    if(dentro){
      try{
        if(cmd === 'formatBlock') ativo = emTitulo;
        // Título já é negrito no navegador: o B aceso ali só confundia.
        else if(cmd === 'bold') ativo = !emTitulo && document.queryCommandState('bold');
        else ativo = document.queryCommandState(cmd);
      }catch(e){}
    }
    btn.classList.toggle('ativo', ativo);
    btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
}
document.addEventListener('selectionchange', atualizarFerramentasNotas);

async function insertProjectImage(){
  const raw = await perguntar('Inserir imagem', {label:'Endereço da imagem', placeholder:'https://…', okLabel:'Inserir'});
  if(!raw) return;
  const url = safeUrl(raw, true);
  if(!url){ showToast('Link de imagem inválido — use um endereço http:// ou https://', 'erro'); return; }
  document.getElementById('project-notes-editor').focus();
  document.execCommand('insertImage', false, url);
  scheduleProjectNotesSave();
}

// Quadro, calendário ou notas na página do projeto. Vale para todos os
// projetos e fica salvo no aparelho, como a aba do Desafio.
// Cada projeto lembra a última aba; o primeiro acesso abre na Visão geral.
const VISOES_PROJETO = ['inicio', 'kanban', 'calendar', 'notes', 'chat'];
const ABAS_PROJETO = {inicio: 'Visão geral', kanban: 'Quadro', calendar: 'Calendário', notes: 'Notas', chat: 'Canais'};

// A ordem das abas é do projeto e igual para todos (projects.ordem_abas,
// configuracoes_projeto.sql, RFC 0005). Chave desconhecida sai; aba que
// faltar entra no fim, na ordem padrão.
function ordemAbasDoProjeto(p){
  const salva = p && Array.isArray(p.ordem_abas) ? p.ordem_abas.filter(k=>VISOES_PROJETO.includes(k)) : [];
  const unicas = [...new Set(salva)];
  return [...unicas, ...VISOES_PROJETO.filter(k=>!unicas.includes(k))];
}

// Sem aba guardada, abre a primeira da ordem do projeto.
function visaoProjetoSalva(pid){
  if(!pid) return 'inicio';
  const primeira = ordemAbasDoProjeto(state.projects.find(x=>x.id === pid))[0];
  try{
    const v = localStorage.getItem(`projectView:${pid}`);
    return VISOES_PROJETO.includes(v) ? v : primeira;
  }catch(e){ return primeira; }
}

function setProjectTasksView(visao){
  // Sair das notas com um salvamento agendado perdia o que acabou de ser digitado.
  flushNotesIfPending();
  const antes = state.projectTasksView;
  state.projectTasksView = visao;
  try{ if(state.currentProjectId) localStorage.setItem(`projectView:${state.currentProjectId}`, visao); }catch(e){}
  // O conteúdo da aba nova desliza do lado dela: para a esquerda quando a aba
  // fica à direita da anterior, e o contrário. Os filtros só existem no
  // Quadro e no Calendário.
  if(antes !== visao){
    const comFiltros = v => v === 'kanban' || v === 'calendar';
    const ordem = ordemAbasDoProjeto(state.projects.find(x=>x.id === state.currentProjectId));
    trocaDeAba = {
      de: antes,
      volta: ordem.indexOf(visao) < ordem.indexOf(antes),
      filtros: comFiltros(visao) && !comFiltros(antes)
    };
    realceAntes = medirRealceDasAbas();
  }
  skipEntranceOnce = true;
  if(antes !== visao) trocarComTransicao(()=>render(), 'aba', trocaDeAba.volta);
  else render();
}

// O realce da aba ativa anda da aba de antes até a nova (RFC 0005, Q18). Cada
// render cria a barra de novo; o lugar de antes é medido antes e entra aqui.
let realceAntes = null;

function medirRealceDasAbas(){
  const r = document.querySelector('#main .proj-view-abas .proj-aba-realce');
  if(!r) return null;
  const x = r.style.getPropertyValue('--realce-x'), w = r.style.getPropertyValue('--realce-w');
  return x && w ? {x, w} : null;
}

function posicionarRealceDasAbas(de){
  const caixa = document.querySelector('#main .proj-view-abas');
  const r = caixa && caixa.querySelector('.proj-aba-realce');
  const ativa = caixa && caixa.querySelector('.proj-view-aba.ativa');
  if(!r || !ativa) return;
  const x = `${ativa.offsetLeft}px`, w = `${ativa.offsetWidth}px`;
  r.classList.add('sem-animar');
  if(de && (de.x !== x || de.w !== w)){
    r.style.setProperty('--realce-x', de.x);
    r.style.setProperty('--realce-w', de.w);
    void r.offsetWidth;
    r.classList.remove('sem-animar');
  }
  r.style.setProperty('--realce-x', x);
  r.style.setProperty('--realce-w', w);
  if(r.classList.contains('sem-animar')){ void r.offsetWidth; r.classList.remove('sem-animar'); }
}
window.addEventListener('resize', ()=>posicionarRealceDasAbas(null));
if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>posicionarRealceDasAbas(null));

// Troca de aba ou de projeto pela View Transition do navegador: a tela velha
// sai (recua para o lado, ou afunda) enquanto a nova entra com as animações
// do CSS. Sem a API, com menos movimento pedido, com uma chamada aberta (o
// vídeo congelaria na captura) ou com um modal por cima, a troca é direta e
// só a entrada anima.
let trocaVtSeq = 0;
function trocarComTransicao(mudar, tipo, volta){
  const reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!document.startViewTransition || reduzir || chamada || document.visibilityState !== 'visible' || topOpenModal()){ mudar(); return; }
  const raiz = document.documentElement;
  const meu = ++trocaVtSeq;
  raiz.dataset.troca = tipo;
  if(volta) raiz.dataset.trocaVolta = ''; else delete raiz.dataset.trocaVolta;
  const limpar = ()=>{
    if(trocaVtSeq !== meu) return;
    delete raiz.dataset.troca;
    delete raiz.dataset.trocaVolta;
  };
  try{
    const t = document.startViewTransition(mudar);
    // Uma troca nova no meio de outra faz o navegador pular a antiga; não é erro.
    t.ready.catch(()=>{});
    t.updateCallbackDone.catch(()=>{});
    const vigia = setTimeout(()=>{ try{ t.skipTransition(); }catch(e){} }, 1200);
    t.finished.then(()=>{ clearTimeout(vigia); limpar(); }, ()=>{ clearTimeout(vigia); limpar(); });
  }catch(e){
    limpar();
    mudar();
  }
}

// Dono e membros aceitos, cada um com o perfil que tiver carregado.
function projectPeople(p){
  const owner = {id: p.owner_id, profile: p.ownerProfile, label: (p.ownerProfile && p.ownerProfile.name) || p.owner_email || 'Dono'};
  const members = p.members
    .filter(m=>m.status==='accepted' && m.user_id && m.user_id !== p.owner_id)
    .map(m=>({id: m.user_id, profile: m.profile, label: (m.profile && m.profile.name) || m.invited_email || 'Membro'}));
  return [owner, ...members];
}

function projectHasNotes(p){
  const html = p.notes || '';
  if(/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
}

function renderProjectCalendar(p, tasks){
  const d = state.projCalDate;
  const meses = MESES_LONGOS_CAP;
  const tasksByDate = groupTasksByCalDate(tasks);
  const semPrazo = tasks.filter(t=>!calDateKey(t)).length;
  const taskTitle = t=>{
    const assignee = getAssigneeLabel(t);
    return assignee ? `${t.title} · ${assignee}` : t.title;
  };
  return `
    <div class="proj-cal">
      ${renderCalMonth(d, tasksByDate, state.projCalSelectedDate, taskTitle)}
      ${calMonthIsEmpty(d, tasksByDate) ? `<div class="empty cal-empty-mobile" style="margin-top:10px;"><strong>Nada agendado em ${meses[d.getMonth()].toLowerCase()}.</strong></div>` : ''}
      ${semPrazo > 0 ? `<div class="proj-cal-sem-prazo">${semPrazo === 1 ? '1 tarefa sem prazo fica' : `${semPrazo} tarefas sem prazo ficam`} só no quadro. <button onclick="setProjectTasksView('kanban')">Ver no quadro</button></div>` : ''}
    </div>`;
}

function renderProjectNotes(p, canEdit){
  const n = state.notasProjeto[p.id];
  if(!n){
    if(!notasCarregando.has(p.id)) carregarNotasProjeto(p.id);
    return `<div class="glass proj-surface proj-vazio" role="status">Carregando as notas…</div>`;
  }
  // Sem a tabela nova (SQL ainda não rodou), continua a nota única de antes.
  if(n.semTabela) return renderNotaUnicaProjeto(p, canEdit);
  if(n.erro) return `<div class="glass proj-surface proj-vazio"><strong>Não deu para carregar as notas.</strong>${esc(n.erro)}<button class="btn-secondary" style="margin-top:12px;" onclick="delete state.notasProjeto['${p.id}'];render()">Tentar de novo</button></div>`;
  return renderNotasProjeto(p, canEdit, n);
}

function renderNotaUnicaProjeto(p, canEdit){
  const temNotas = projectHasNotes(p);
  if(!canEdit && !temNotas){
    return `<div class="glass proj-surface proj-vazio"><strong>Ninguém escreveu notas neste projeto ainda.</strong>Quem edita o projeto pode registrar aqui contexto, links e decisões.</div>`;
  }
  const ferramenta = (cmd, label, conteudo, valor)=>`<button class="proj-nota-btn" data-cmd="${cmd}" onmousedown="event.preventDefault()" onclick="execEditorCmd('${cmd}'${valor ? `,'${valor}'` : ''})" title="${label}" aria-label="${label}" aria-pressed="false">${conteudo}</button>`;
  return `
    <div class="glass proj-surface proj-notas">
      <div class="proj-notas-doc">
        ${canEdit ? `
        <div class="proj-notas-head">
          <div class="proj-notas-ferramentas" role="toolbar" aria-label="Formatação das notas">
            ${ferramenta('formatBlock', 'Título', '<span aria-hidden="true" class="proj-nota-h">T</span>', 'H3')}
            <span class="proj-nota-sep" aria-hidden="true"></span>
            ${ferramenta('bold', 'Negrito', '<b aria-hidden="true">B</b>')}
            ${ferramenta('italic', 'Itálico', '<i aria-hidden="true">I</i>')}
            <span class="proj-nota-sep" aria-hidden="true"></span>
            ${ferramenta('insertUnorderedList', 'Lista', '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>')}
            ${ferramenta('insertOrderedList', 'Lista numerada', '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>')}
            <span class="proj-nota-sep" aria-hidden="true"></span>
            <button class="proj-nota-btn" onmousedown="event.preventDefault()" onclick="insertProjectImage()" title="Inserir imagem" aria-label="Inserir imagem">
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
          </div>
          <span id="notes-save-indicator" class="proj-notas-salvo" role="status">Salvo automaticamente</span>
        </div>` : ''}
        <div id="project-notes-editor" class="project-notes-editor" role="textbox" aria-multiline="true" aria-label="Notas do projeto" ${canEdit ? 'contenteditable="true"' : 'aria-readonly="true"'} oninput="scheduleProjectNotesSave()" data-placeholder="${canEdit ? 'Escreva o contexto do projeto: objetivo, links, decisões, combinados…' : ''}">${sanitizeNotesHtml(p.notes)}</div>
      </div>
    </div>`;
}

function renderProjectPage(){
  const p = state.projects.find(x=>x.id===state.currentProjectId);
  if(!p){
    return `<div class="view-header"><div><h1>Projeto não encontrado</h1></div></div>
      <div class="empty"><strong>Esse projeto não existe mais ou você não tem acesso.</strong><button class="btn-secondary" style="margin-top:12px;" onclick="voltarDoProjeto()">Voltar</button></div>`;
  }
  const isOwner = p.myRole === 'owner';
  const role = myRoleInProject(p.id);
  // canEdit é a estrutura (colunas, notas, ícone); mexe é criar e mexer nas
  // tarefas, que o participante também faz.
  const canEdit = isOwner || role === 'editor';
  const mexe = mexeEmTarefas(p.id);
  const roleLabel = esc(nomeDoCargo(isOwner ? 'owner' : role, p));
  // Itens = tarefas e eventos; o quadro e as contagens são só das tarefas.
  const projectItems = state.tasks.filter(t=>t.project_id===p.id);
  const projectTasks = projectItems.filter(t=>!ehEvento(t));
  const cols = getProjectColumns(p);
  const doneCount = projectTasks.filter(t=>taskColumnType(t)==='done').length;
  const openCount = projectTasks.length - doneCount;
  const people = projectPeople(p);
  const visao = state.projectTasksView;
  const asCalendar = visao === 'calendar';
  const asNotes = visao === 'notes';
  const asInicio = visao === 'inicio';
  const asChat = visao === 'chat';
  const clientOptions = [...new Set(projectTasks.map(t=>t.client).filter(Boolean))].sort();
  const assigneeOptions = [
    {id:'', label:'Todas as pessoas'},
    {id:'unassigned', label:'Sem atribuição'},
    ...people.map(pe=>({id: pe.id, label: pe.label}))
  ];
  const tagOptions = tagsInList(projectTasks);
  // Com filtro ligado, "Sem tarefas" parecia projeto vazio; o aviso diz que
  // é o filtro que está escondendo o trabalho.
  const filtrando = !!(state.filter.kanbanSearch || state.filter.kanbanClient || state.filter.kanbanTag || state.filter.kanbanAssignee
    || (!asCalendar && state.filter.kanbanDate && state.filter.kanbanDate !== 'all'));
  // O calendário mostra tarefas e eventos; o quadro filtra os eventos fora.
  const filteredProjectTasks = projectItems.filter(t=>{
    if(state.filter.kanbanClient && t.client !== state.filter.kanbanClient) return false;
    if(state.filter.kanbanTag && !taskHasTag(t, state.filter.kanbanTag)) return false;
    if(state.filter.kanbanAssignee){
      if(state.filter.kanbanAssignee === 'unassigned'){ if(t.assigned_to) return false; }
      else if(t.assigned_to !== state.filter.kanbanAssignee) return false;
    }
    // O filtro de prazo some no calendário (a navegação por mês faz esse papel);
    // aplicá-lo escondido deixaria o mês vazio sem explicação.
    if(!asCalendar && state.filter.kanbanDate && state.filter.kanbanDate !== 'all' && !matchesDateFilter(t, state.filter.kanbanDate)) return false;
    if(!matchesKanbanSearch(t, state.filter.kanbanSearch)) return false;
    return true;
  });

  const avatares = people.slice(0, 4).map(pe=>avatarChip(pe.id === session.user.id ? {avatar_url: state.myAvatarUrl} : pe.profile, (pe.label || '?')[0])).join('');
  const excedente = people.length > 4 ? `<span class="member-avatar proj-avatar-mais">+${people.length - 4}</span>` : '';
  const andamento = projectTasks.length === 0
    ? 'Nenhuma tarefa ainda'
    : `${openCount} em aberto · ${doneCount} concluída${doneCount!==1?'s':''}`;

  const extrasDaAba = {
    notes: {marca: !asNotes && (state.notasProjeto[p.id] && !state.notasProjeto[p.id].semTabela ? state.notasProjeto[p.id].lista.length > 0 : projectHasNotes(p))},
    chat: {selo: !asChat}
  };
  const abas = ordemAbasDoProjeto(p).map(key=>({key, label: ABAS_PROJETO[key], ...(extrasDaAba[key] || {})}));

  const filtros = (asNotes || asInicio || asChat) ? '' : `
      <div class="proj-filtros">
        <div class="search-box">
          <svg class="search-box-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" class="input" id="kf-search" name="kf-search" autocomplete="off" placeholder="Pesquisar tarefas…" aria-label="Pesquisar tarefas do projeto" value="${esc(state.filter.kanbanSearch)}">
        </div>
        <div class="proj-filtros-selects">
        <select class="select" id="kf-assignee" aria-label="Filtrar por pessoa">
          ${assigneeOptions.map(o=>`<option value="${o.id}" ${state.filter.kanbanAssignee===o.id?'selected':''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" id="kf-client" aria-label="Filtrar por cliente">
          <option value="">Todos clientes</option>
          ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        ${renderTagFilterSelect('kf-tag', tagOptions, state.filter.kanbanTag)}
        ${asCalendar ? '' : `<select class="select" id="kf-date" aria-label="Filtrar por prazo">
          <option value="all" ${(!state.filter.kanbanDate||state.filter.kanbanDate==='all')?'selected':''}>Qualquer prazo</option>
          <option value="today" ${state.filter.kanbanDate==='today'?'selected':''}>Hoje</option>
          <option value="next3" ${state.filter.kanbanDate==='next3'?'selected':''}>Próximos dias</option>
          <option value="week" ${state.filter.kanbanDate==='week'?'selected':''}>Semana</option>
          <option value="month" ${state.filter.kanbanDate==='month'?'selected':''}>Mês</option>
        </select>`}
        </div>
        ${filtrando ? `<button class="proj-limpar-filtros" onclick="limparFiltrosProjeto()">Limpar filtros</button>` : ''}
      </div>`;

  let corpo;
  if(asInicio){
    corpo = renderProjectInicio(p, canEdit, projectItems, projectTasks, cols, mexe);
  } else if(asNotes){
    corpo = renderProjectNotes(p, canEdit);
  } else if(asChat){
    corpo = renderProjectChat(p);
  } else if(!asCalendar && !mexe && projectTasks.length === 0){
    corpo = `<div class="glass proj-surface proj-vazio"><strong>Nenhuma tarefa neste projeto ainda.</strong>Quem edita o projeto cria as tarefas aqui; elas aparecem para você assim que forem criadas.</div>`;
  } else if(asCalendar){
    corpo = `<div class="glass proj-surface">${renderProjectCalendar(p, filteredProjectTasks)}</div>
      ${state.projCalSelectedDate ? renderDayPanel(state.projCalSelectedDate, groupTasksByCalDate(filteredProjectTasks)[state.projCalSelectedDate] || [], {projectId: p.id, canEdit: mexe}) : ''}`;
  } else {
    corpo = `
      <div class="kanban kanban-projeto">
        ${cols.map(col=>{
          const list = sortByDateThenPriority(filteredProjectTasks.filter(t=>!ehEvento(t) && statusVisivel(t, cols)===col.key && !isHiddenFromKanban(t)));
          const collapsed = col.hidden && !state.expandedCols.has(col.key);
          if(collapsed){
            return `
              <div class="glass kb-col kb-col-collapsed" data-status="${col.key}" role="button" tabindex="0" onclick="toggleColExpanded('${col.key}')" title="Coluna oculta — toque para abrir">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                <div class="kb-col-collapsed-label"><span class="kb-col-dot" style="background:${corSegura(col.color)}"></span>${esc(col.name)}</div>
                <div class="kb-col-count">${list.length}</div>
              </div>`;
          }
          return `
            <div class="glass kb-col" data-status="${col.key}" ondragover="dragOver(event)" ondrop="drop(event,'${col.key}')" ondragleave="dragLeave(event)">
              <div class="kb-col-head">
                <div class="kb-col-title"><span class="kb-col-dot" style="background:${corSegura(col.color)}"></span>${esc(col.name)}</div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <div class="kb-col-count">${list.length}</div>
                  ${col.hidden ? `<button class="kb-col-collapse-btn" onclick="toggleColExpanded('${col.key}')" title="Recolher coluna">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>` : ''}
                  ${canEdit ? `<div class="kb-col-drag-handle" onpointerdown="colHandlePointerDown(event,'${col.key}','${p.id}')" title="Arrastar para reordenar coluna">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8L22 12L18 16"/><path d="M6 8L2 12L6 16"/><path d="M2 12H22"/></svg>
                  </div>
                  <button class="kb-col-edit" onclick="openColumnModal('${col.key}', '${p.id}')" title="Editar coluna" aria-label="Editar coluna ${esc(col.name)}">
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>` : ''}
                </div>
              </div>
              <div class="kb-cards">
                ${list.length===0
                  ? `<div class="kb-col-vazia">${filtrando ? 'Nada com esses filtros' : 'Sem tarefas'}</div>`
                  : list.map(t=>renderKbCard(t, col, {clientInMeta: true, badge: ()=>renderAssigneeChip(t, p, people)})).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  return `
    <header class="proj-head">
      <button class="btn-back" onclick="voltarDoProjeto()" title="Voltar" aria-label="Voltar">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      </button>
      <div class="proj-head-main">
        ${temPermissaoVoz(p.id, 'icone')
          ? `<button type="button" class="proj-icone-btn" onclick="abrirIconeProjeto('${p.id}')" title="Mudar o ícone do projeto" aria-label="Mudar o ícone do projeto">${projetoIconeHtml(p, 'g')}<span class="proj-icone-lapis" aria-hidden="true"><svg focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span></button>`
          : projetoIconeHtml(p, 'g')}
        <h1 class="proj-title">${esc(p.name)}</h1>
        <div class="proj-meta">
          <div class="proj-pessoas">
            <button class="proj-people" onclick="alternarPessoasDoProjeto(this)" aria-haspopup="dialog" aria-expanded="false" title="Ver quem está no projeto">
              <span class="proj-avatars">${avatares}${excedente}</span>
              <span>${people.length} pessoa${people.length!==1?'s':''}</span>
            </button>
            <div class="proj-pessoas-pop" role="dialog" aria-label="${esc(`Pessoas em ${p.name}`)}" hidden>${pessoasDoProjetoHtml(p, isOwner)}</div>
          </div>
          <span class="proj-role ${mexe ? '' : 'leitura'}">${roleLabel}${mexe ? '' : ' · só leitura'}</span>
          <span class="proj-andamento">${andamento}</span>
        </div>
      </div>
      <div class="proj-head-actions">
        <button class="btn-back refresh-btn" onclick="refreshAll()" title="Atualizar agora" aria-label="Atualizar agora">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        <button class="btn-back proj-config-btn" onclick="abrirConfigProjeto('${p.id}')" title="Configurações do projeto" aria-label="Configurações do projeto">${ICONE_ENGRENAGEM}</button>
        ${podeConvidar(p.id) ? `<button class="btn-secondary btn-com-icone" onclick="convidarNoProjeto('${p.id}')"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>Convidar</button>` : ''}
        ${canEdit && visao === 'kanban' ? `<button class="btn-secondary" onclick="openColumnModal(null, '${p.id}')">+ Nova coluna</button>` : ''}
        ${mexe ? renderMenuNovo(canEdit) : ''}
      </div>
    </header>

    ${faixaChamadaHtml(p)}

    <div class="proj-toolbar">
      <div class="proj-view-abas com-realce" role="group" aria-label="Ver o projeto como">
        <span class="proj-aba-realce sem-animar" aria-hidden="true"></span>
        ${abas.map(a=>`<button class="proj-view-aba ${visao===a.key ? 'ativa' : ''}" data-aba="${a.key}" aria-pressed="${visao===a.key}" onclick="setProjectTasksView('${a.key}')">${a.label}${a.marca ? '<span class="proj-view-marca" title="Tem notas"></span>' : ''}${a.selo ? seloNaoLidas(p.id) : ''}</button>`).join('')}
      </div>
      ${filtros}
    </div>

    ${corpo}
  `;
}

/* ---------- configurações do projeto (RFC 0005) ---------- */
// A engrenagem ao lado do Convidar, como as configurações de um servidor do
// Discord: Geral, Abas, Cargos e Membros. Todo mundo do projeto abre e vê como
// está; os controles só aparecem para quem pode mudar, e o banco confere de
// novo (configuracoes_projeto.sql, SEC-084 a SEC-086).

const ICONE_ENGRENAGEM = '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
const ICONE_PEGA = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const SETA_ACIMA = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
const SETA_ABAIXO = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

const SECOES_CONFIG_PROJETO = [
  ['geral', 'Geral', '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 9h8M8 13h8M8 17h5"/>'],
  ['abas', 'Abas', '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M9 5v5M15 5v5"/>'],
  ['cargos', 'Cargos', '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'],
  ['membros', 'Membros', '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>']
];

// As permissões de cada cargo (regras de cargo). O dono tem todas sempre; sem
// regra salva, vale o padrão: o editor com as três e o participante
// convidando. Convidar é só para cargo igual ou abaixo do de quem convida.
// RFC 0006: nome e ícone separados, canais de texto e salas separados, e mudar
// cargos. O padrão do editor é o que ele já fazia; "cargos" fica só com o dono.
const PERMISSOES_VOZ = {
  convidar: {grupo: 'Pessoas', nome: 'Convidar pessoas', desc: 'Cria convite por email ou por código, para cargo igual ou abaixo do seu.'},
  cargos: {grupo: 'Pessoas', nome: 'Mudar cargos', desc: 'Muda o cargo de quem está igual ou abaixo, nunca o próprio nem para cima do seu.'},
  nome: {grupo: 'Projeto', nome: 'Mudar o nome do projeto', desc: 'O nome que aparece para todo mundo.'},
  icone: {grupo: 'Projeto', nome: 'Mudar a foto do projeto', desc: 'O ícone ou a imagem do projeto.'},
  texto: {grupo: 'Canais', nome: 'Criar e editar canais de texto', desc: 'Criar, renomear, ordenar e apagar canais de texto e categorias.'},
  voz: {grupo: 'Canais', nome: 'Criar e editar salas de voz', desc: 'Criar, renomear, ordenar e apagar salas de voz e categorias.'},
  silenciar: {grupo: 'Salas de voz', nome: 'Silenciar outros nas salas', desc: 'Fecha o microfone de alguém na chamada, em todas as salas, até alguém liberar.'},
  mover: {grupo: 'Salas de voz', nome: 'Mover e desconectar outros', desc: 'Leva alguém para outra sala de voz ou tira da chamada.'}
};
const REGRAS_PADRAO = {editor: ['convidar', 'nome', 'icone', 'texto', 'voz', 'silenciar', 'mover'], participante: ['convidar'], viewer: []};

// Criar e mexer num canal pede a regra do tipo dele; categoria, qualquer uma.
function podeMexerNoCanal(pid, tipo){
  if(canaisSemTabela) return false;
  if(tipo === 'texto') return temPermissaoVoz(pid, 'texto');
  if(tipo === 'voz') return temPermissaoVoz(pid, 'voz');
  if(tipo === 'categoria') return temPermissaoVoz(pid, 'texto') || temPermissaoVoz(pid, 'voz');
  return false;
}

// Mudar o cargo de alguém: o dono, ou quem tem a regra, sobre cargo igual ou
// abaixo do seu e nunca o próprio (definir_cargo_membro confere de novo).
function podeMudarCargoDe(pid, m){
  const p = state.projects.find(x=>x.id === pid);
  if(!p || !m) return false;
  if(p.myRole === 'owner') return true;
  const meu = cargoNoProjeto(p, session.user.id);
  if(!meu || m.user_id === session.user.id || !temPermissaoVoz(pid, 'cargos')) return false;
  return CARGOS[cargoValido(m.role)].nivel <= CARGOS[meu].nivel;
}

function cargosParaDar(pid){
  const p = state.projects.find(x=>x.id === pid);
  if(p && p.myRole === 'owner') return CARGOS_DE_MEMBRO;
  const meu = cargoNoProjeto(p, session.user.id);
  return meu ? CARGOS_DE_MEMBRO.filter(r=>CARGOS[r].nivel <= CARGOS[meu].nivel) : [];
}

function podeConvidar(pid){
  return temPermissaoVoz(pid, 'convidar');
}

// Os cargos que eu posso dar num convite: o meu e os de baixo (o dono, todos).
function cargosParaConvidar(pid){
  const p = state.projects.find(x=>x.id === pid);
  const meu = cargoNoProjeto(p, session.user.id);
  if(!meu || !podeConvidar(pid)) return [];
  return CARGOS_DE_MEMBRO.filter(r=>CARGOS[r].nivel <= CARGOS[meu].nivel);
}

function opcoesDeConvite(pid){
  const cargos = cargosParaConvidar(pid);
  const p = state.projects.find(x=>x.id === pid);
  const padrao = cargos.includes('editor') ? 'editor' : cargos[0];
  return cargos.map(r=>`<option value="${r}" ${r === padrao ? 'selected' : ''}>${esc(nomeDoCargo(r, p))}</option>`).join('');
}

function regrasDoProjeto(p){
  const r = p && p.regras_cargos && typeof p.regras_cargos === 'object' && !Array.isArray(p.regras_cargos) ? p.regras_cargos : {};
  const out = {};
  for(const cargo of CARGOS_DE_MEMBRO){
    const lista = Array.isArray(r[cargo]) ? r[cargo] : REGRAS_PADRAO[cargo];
    out[cargo] = Object.keys(PERMISSOES_VOZ).filter(k=>lista.includes(k));
  }
  return out;
}

function temPermissaoVoz(pid, perm, uid){
  const p = state.projects.find(x=>x.id === pid);
  const cargo = cargoNoProjeto(p, uid || (session && session.user.id));
  if(!cargo || !PERMISSOES_VOZ[perm]) return false;
  return cargo === 'owner' || regrasDoProjeto(p)[cargo].includes(perm);
}

// O que a tela oferece; quem decide é o banco (pode_moderar, SEC-087).
// Ninguém modera o dono, e cada um só modera cargo igual ou abaixo do seu.
function podeModerar(pid, alvo, perm){
  const p = state.projects.find(x=>x.id === pid);
  if(!p || !alvo || moderacaoSemTabela) return false;
  const eu = cargoNoProjeto(p, session.user.id), dele = cargoNoProjeto(p, alvo);
  if(!eu || !dele || dele === 'owner') return false;
  if(CARGOS[dele].nivel > CARGOS[eu].nivel) return false;
  return perm ? temPermissaoVoz(pid, perm) : (temPermissaoVoz(pid, 'silenciar') || temPermissaoVoz(pid, 'mover'));
}

function faltaColuna(error){
  return !!error && (['42703', 'PGRST204'].includes(error.code) || /column|coluna/i.test(error.message || ''));
}

let configProjeto = null;

function abrirConfigProjeto(pid, secao){
  const p = state.projects.find(x=>x.id === pid);
  if(!p) return;
  alternarPessoasDoProjeto(null, true);
  const mesma = configProjeto && configProjeto.pid === pid;
  configProjeto = {pid, secao: secao || (mesma ? configProjeto.secao : 'geral')};
  desenharConfigProjeto();
  document.getElementById('config-projeto').classList.add('open');
  setTimeout(()=>{
    const b = document.querySelector('#config-projeto .set-aba[aria-selected="true"]');
    if(b) b.focus();
  }, 40);
}

function fecharConfigProjeto(){
  document.getElementById('config-projeto').classList.remove('open');
  const redesenhar = configProjeto && configProjeto.redesenharAoFechar;
  configProjeto = null;
  // Um cargo renomeado aparece no topo do projeto: redesenha só agora, para
  // a página não passar por cima do diálogo aberto.
  if(redesenhar && state.view === 'project'){ skipEntranceOnce = true; safeRerender(); }
}

function abrirSecaoProjeto(secao, focar){
  if(!configProjeto) return;
  configProjeto.secao = secao;
  desenharConfigProjeto();
  const paineis = document.getElementById('config-projeto-paineis');
  if(paineis) paineis.scrollTop = 0;
  if(focar){
    const b = document.querySelector(`#config-projeto .set-aba[data-secao="${secao}"]`);
    if(b) b.focus();
  }
}

document.addEventListener('keydown', (e)=>{
  const aba = e.target.closest && e.target.closest('#config-projeto .set-aba');
  if(!aba || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const chaves = SECOES_CONFIG_PROJETO.map(s=>s[0]);
  const i = chaves.indexOf(aba.dataset.secao);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? chaves.length - 1
    : (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + chaves.length) % chaves.length;
  e.preventDefault();
  abrirSecaoProjeto(chaves[n], true);
});

// Redesenha o modal inteiro a partir do estado; o foco e o que está sendo
// digitado no nome voltam para onde estavam.
function desenharConfigProjeto(){
  const c = configProjeto;
  if(!c) return;
  const p = state.projects.find(x=>x.id === c.pid);
  if(!p){ fecharConfigProjeto(); return; }
  const caixa = document.getElementById('config-projeto');
  const ativo = document.activeElement;
  const foco = ativo && caixa.contains(ativo) ? (ativo.dataset.foco || ativo.id) : null;
  const campoNome = document.getElementById('cp-nome');
  const rascunhoNome = campoNome && campoNome.dataset.mexido === '1' ? campoNome.value : null;
  const meu = cargoValido(myRoleInProject(p.id));
  document.getElementById('config-projeto-icone').innerHTML = projetoIconeHtml(p, 'm');
  document.getElementById('config-projeto-sub').textContent = `${p.name} · você é ${nomeDoCargo(meu, p)}`;
  document.getElementById('config-projeto-nav').innerHTML = SECOES_CONFIG_PROJETO.map(([k, nome, icone])=>`
    <button class="set-aba" role="tab" id="cp-aba-${k}" data-secao="${k}" aria-controls="cp-${k}" aria-selected="${c.secao === k}" tabindex="${c.secao === k ? 0 : -1}" onclick="abrirSecaoProjeto('${k}')">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icone}</svg>
      ${nome}
    </button>`).join('');
  const corpo = c.secao === 'abas' ? painelAbasProjeto(p)
    : c.secao === 'cargos' ? painelCargosProjeto(p)
    : c.secao === 'membros' ? painelMembrosProjeto(p)
    : painelGeralProjeto(p);
  document.getElementById('config-projeto-paineis').innerHTML = `
    <section class="set-painel cp-painel" role="tabpanel" id="cp-${c.secao}" aria-labelledby="cp-aba-${c.secao}">${corpo}</section>`;
  if(rascunhoNome !== null){
    const novo = document.getElementById('cp-nome');
    if(novo){ novo.value = rascunhoNome; novo.dataset.mexido = '1'; }
  }
  if(foco){
    const el = caixa.querySelector(`[data-foco="${foco}"]`) || document.getElementById(foco);
    if(el) el.focus({preventScroll: true});
  }
}

function painelGeralProjeto(p){
  // Nome e ícone são regras separadas (RFC 0006).
  const pode = temPermissaoVoz(p.id, 'nome');
  const podeIcone = temPermissaoVoz(p.id, 'icone');
  const dono = p.myRole === 'owner';
  const meu = cargoValido(myRoleInProject(p.id));
  return `
    <h3 class="set-painel-titulo">Geral</h3>
    <div class="cp-identidade">
      ${podeIcone
        ? `<button type="button" class="proj-icone-btn cp-icone-btn" data-foco="cp-icone" onclick="abrirIconeProjeto('${p.id}')" title="Mudar o ícone do projeto" aria-label="Mudar o ícone do projeto">${projetoIconeHtml(p, 'g')}<span class="proj-icone-lapis" aria-hidden="true">${ICONE_LAPIS}</span></button>`
        : projetoIconeHtml(p, 'g')}
      <div class="cp-nome-campos">
        <label class="set-rotulo" for="cp-nome">Nome do projeto</label>
        <div class="cp-nome-linha">
          <input type="text" class="input" id="cp-nome" maxlength="80" autocomplete="off" value="${esc(p.name)}" ${pode ? '' : 'readonly aria-readonly="true"'} oninput="this.dataset.mexido='1';atualizarNomeConfig()" onkeydown="if(event.key==='Enter'){event.preventDefault();salvarNomeProjeto();}">
          ${pode ? '<button type="button" class="btn-primary" id="cp-nome-salvar" onclick="salvarNomeProjeto()" disabled>Salvar</button>' : ''}
        </div>
        ${pode && podeIcone ? '' : `<p class="cp-nota">${!pode && !podeIcone ? 'Seu cargo não muda o nome nem o ícone.' : !pode ? 'Seu cargo muda o ícone, mas não o nome.' : 'Seu cargo muda o nome, mas não o ícone.'} Quem decide é o dono, em Cargos.</p>`}
      </div>
    </div>
    <div class="set-linha">
      <div class="set-linha-texto">
        <div class="set-linha-titulo">Seu cargo: ${esc(nomeDoCargo(meu, p))}</div>
        <div class="set-linha-desc">${esc(CARGOS[meu].desc)}</div>
      </div>
      <button type="button" class="btn-secondary" data-foco="cp-ver-cargos" onclick="abrirSecaoProjeto('cargos')">Ver cargos</button>
    </div>
    <div class="set-linha">
      <div class="set-linha-texto">
        <div class="set-linha-titulo">${dono ? 'Excluir o projeto' : 'Sair do projeto'}</div>
        <div class="set-linha-desc">${dono ? 'Some para todo mundo, com canais e mensagens. As tarefas voltam a ser privadas.' : 'Você perde o acesso às tarefas, aos canais e às salas dele.'}</div>
      </div>
      <button type="button" class="btn-danger" onclick="${dono ? `excluirProjetoDaConfig('${p.id}')` : `sairDoProjetoDaConfig('${p.id}')`}">${dono ? 'Excluir' : 'Sair'}</button>
    </div>`;
}

function atualizarNomeConfig(){
  const c = configProjeto;
  const p = c && state.projects.find(x=>x.id === c.pid);
  const campo = document.getElementById('cp-nome');
  const ok = document.getElementById('cp-nome-salvar');
  if(!p || !campo || !ok) return;
  const nome = campo.value.trim();
  ok.disabled = !nome || nome === p.name;
}

async function salvarNomeProjeto(){
  const c = configProjeto;
  const p = c && state.projects.find(x=>x.id === c.pid);
  const campo = document.getElementById('cp-nome');
  if(!p || !campo || !temPermissaoVoz(p.id, 'nome')) return;
  const nome = campo.value.trim().slice(0, 80);
  if(!nome){ showToast('O projeto precisa de um nome.', 'erro'); campo.focus(); return; }
  if(nome === p.name) return;
  const ok = document.getElementById('cp-nome-salvar');
  if(ok){ ok.disabled = true; ok.textContent = 'Salvando…'; }
  const {data, error} = await sb.from('projects').update({name: nome}).eq('id', p.id).select('id, name').maybeSingle();
  if(error || !data){
    if(error) console.error(error);
    if(ok){ ok.textContent = 'Salvar'; ok.disabled = false; }
    showToast(error ? 'Não deu para salvar o nome. Confira a conexão e tente de novo.' : 'Só o dono e quem edita mudam o nome.', 'erro');
    return;
  }
  p.name = data.name;
  saveProjectsCache();
  campo.dataset.mexido = '';
  renderSidebarProjects();
  safeRerender();
  desenharConfigProjeto();
  showToast('Nome salvo');
}

async function excluirProjetoDaConfig(pid){
  fecharConfigProjeto();
  await deleteProject(pid);
}

async function sairDoProjetoDaConfig(pid){
  fecharConfigProjeto();
  await leaveProject(pid);
}

function painelAbasProjeto(p){
  const pode = canEditProject(p.id);
  const ordem = ordemAbasDoProjeto(p);
  const padrao = ordem.join() === VISOES_PROJETO.join();
  const itens = ordem.map((k, i)=>`
    <li class="cp-aba ${pode ? 'movel' : ''}" data-chave="${k}">
      ${pode ? `<span class="cp-aba-pega" aria-hidden="true">${ICONE_PEGA}</span>` : ''}
      <span class="cp-aba-num" aria-hidden="true">${i + 1}</span>
      <span class="cp-aba-nome">${ABAS_PROJETO[k]}${i === 0 ? '<span class="cp-aba-primeira">abre primeiro</span>' : ''}</span>
      ${pode ? `<span class="cp-aba-acoes">
        <button type="button" class="cn-acao" data-foco="aba-sobe-${k}" onclick="moverAbaProjeto('${k}', -1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${ABAS_PROJETO[k]}" title="Subir">${SETA_ACIMA}</button>
        <button type="button" class="cn-acao" data-foco="aba-desce-${k}" onclick="moverAbaProjeto('${k}', 1)" ${i === ordem.length - 1 ? 'disabled' : ''} aria-label="Descer ${ABAS_PROJETO[k]}" title="Descer">${SETA_ABAIXO}</button>
      </span>` : ''}
    </li>`).join('');
  return `
    <h3 class="set-painel-titulo">Abas</h3>
    <p class="set-painel-desc">A ordem da barra de abas do projeto. Vale para todo mundo dele, e a primeira é a que abre para quem entra pela primeira vez.${pode ? ' Arraste pela alça ou use as setas.' : ''}</p>
    <ol class="cp-abas" id="cp-abas" ${pode ? 'onpointerdown="arrastarAbaProjeto(event)"' : ''} aria-label="Ordem das abas">${itens}</ol>
    ${pode
      ? (padrao ? '' : '<button type="button" class="cp-link" data-foco="cp-abas-padrao" onclick="salvarOrdemAbas(null)">Voltar para a ordem padrão</button>')
      : '<p class="cp-nota">Só o dono e quem edita mudam a ordem.</p>'}`;
}

function moverAbaProjeto(k, delta){
  const p = configProjeto && state.projects.find(x=>x.id === configProjeto.pid);
  if(!p) return;
  const ordem = ordemAbasDoProjeto(p);
  const i = ordem.indexOf(k), j = i + delta;
  if(i < 0 || j < 0 || j >= ordem.length) return;
  ordem.splice(j, 0, ordem.splice(i, 1)[0]);
  salvarOrdemAbas(ordem, `aba-${delta < 0 ? 'sobe' : 'desce'}-${k}`);
  anunciarNoApp(`${ABAS_PROJETO[k]}: posição ${j + 1} de ${ordem.length}`);
}

// Na lista das abas o arrasto começa na hora, pela alça ou pela linha: ela
// fica num modal, sem rolagem disputando o gesto. O botão de seta não arrasta.
function arrastarAbaProjeto(e){
  if(e.button > 0 || (e.target.closest && e.target.closest('button'))) return;
  const item = e.target.closest && e.target.closest('.cp-aba[data-chave]');
  if(!item) return;
  e.preventDefault();
  arrastarNaLista(item, e, (ordem)=>salvarOrdemAbas(ordem));
}

// Arrastar um item de uma lista vertical simples. Os outros abrem espaço
// enquanto o item passa; aoSoltar recebe a ordem nova das chaves.
function arrastarNaLista(item, e, aoSoltar){
  const lista = item.parentElement;
  const itens = [...lista.children].filter(el=>el.dataset.chave);
  const rects = new Map(itens.map(el=>[el.dataset.chave, el.getBoundingClientRect()]));
  const inicial = itens.map(el=>el.dataset.chave);
  const chave = item.dataset.chave;
  let ordem = inicial;
  const y0 = e.clientY;
  item.classList.add('arrastando');
  lista.classList.add('reordenando');
  try{ item.setPointerCapture(e.pointerId); }catch(err){}
  const mover = (ev)=>{
    if(ev.pointerId !== e.pointerId) return;
    const dy = ev.clientY - y0;
    item.style.transform = `translateY(${dy}px) scale(1.02)`;
    const r = rects.get(chave);
    const centro = r.top + r.height / 2 + dy;
    let idx = 0, melhor = Infinity;
    inicial.forEach((k, i)=>{ const q = rects.get(k); const d = Math.abs(q.top + q.height / 2 - centro); if(d < melhor){ melhor = d; idx = i; } });
    const nova = inicial.filter(k=>k !== chave);
    nova.splice(idx, 0, chave);
    ordem = nova;
    for(const el of itens){
      if(el === item) continue;
      const k = el.dataset.chave;
      const desloca = rects.get(inicial[nova.indexOf(k)]).top - rects.get(k).top;
      el.style.transform = desloca ? `translateY(${desloca}px)` : '';
    }
  };
  const soltar = (ev)=>{
    if(ev.pointerId !== e.pointerId) return;
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', soltar);
    lista.classList.remove('reordenando');
    for(const el of itens){ el.style.transform = ''; el.classList.remove('arrastando'); }
    if(ev.type === 'pointerup' && ordem.join() !== inicial.join()) aoSoltar(ordem);
  };
  document.addEventListener('pointermove', mover);
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', soltar);
}

// null volta para a ordem padrão. Muda na hora na tela e desfaz se o banco
// recusar.
async function salvarOrdemAbas(ordem, foco){
  const p = configProjeto && state.projects.find(x=>x.id === configProjeto.pid);
  if(!p || !canEditProject(p.id)) return;
  const antes = p.ordem_abas;
  p.ordem_abas = ordem;
  desenharConfigProjeto();
  if(foco){ const b = document.querySelector(`#config-projeto [data-foco="${foco}"]`); if(b && !b.disabled) b.focus(); }
  if(state.view === 'project' && state.currentProjectId === p.id){ skipEntranceOnce = true; safeRerender(); }
  const {data, error} = await sb.from('projects').update({ordem_abas: ordem}).eq('id', p.id).select('id').maybeSingle();
  if(error || !data){
    if(error) console.error(error);
    p.ordem_abas = antes;
    desenharConfigProjeto();
    if(state.view === 'project' && state.currentProjectId === p.id){ skipEntranceOnce = true; safeRerender(); }
    showToast(faltaColuna(error) ? 'A ordem das abas precisa do supabase/configuracoes_projeto.sql. Rode ele no Supabase.'
      : error ? 'Não deu para salvar a ordem. Confira a conexão e tente de novo.' : 'Só o dono e quem edita mudam a ordem.', 'erro');
    return;
  }
  saveProjectsCache();
}

function painelCargosProjeto(p){
  const dono = p.myRole === 'owner';
  const regras = regrasDoProjeto(p);
  const quantos = (cargo)=>projectPeople(p).filter(pe=>cargoNoProjeto(p, pe.id) === cargo).length;
  const bloco = (cargo)=>{
    const c = CARGOS[cargo];
    const n = quantos(cargo);
    // O dono tem tudo, sempre: o bloco dele só diz isso. Os outros, agrupados.
    let grupo = '';
    const perms = cargo === 'owner' ? '' : Object.entries(PERMISSOES_VOZ).map(([k, perm])=>{
      const ligado = regras[cargo].includes(k);
      const travado = !dono;
      const cab = perm.grupo !== grupo ? `<div class="cp-perm-grupo">${esc(perm.grupo)}</div>` : '';
      grupo = perm.grupo;
      return `${cab}
        <div class="cp-perm">
          <div class="cp-perm-texto">
            <span class="cp-perm-nome" id="cp-perm-${cargo}-${k}">${esc(perm.nome)}</span>
            <span class="cp-perm-desc">${esc(perm.desc)}</span>
          </div>
          <label class="sound-toggle">
            <input type="checkbox" data-foco="perm-${cargo}-${k}" ${ligado ? 'checked' : ''} ${travado ? 'disabled' : ''} aria-labelledby="cp-cargo-nome-${cargo} cp-perm-${cargo}-${k}" onchange="alternarRegraCargo('${cargo}', '${k}', this.checked, this)">
            <span class="sound-toggle-track"><span class="sound-toggle-thumb"></span></span>
          </label>
        </div>`;
    }).join('');
    return `
      <div class="cp-cargo nivel-${c.nivel}">
        <div class="cp-cargo-cab">
          ${dono
            ? `<input type="text" class="cp-cargo-nome cp-cargo-renomear" id="cp-cargo-nome-${cargo}" data-foco="nome-cargo-${cargo}" value="${esc(nomeDoCargo(cargo, p))}" maxlength="${CARGO_NOME_MAX}" placeholder="${esc(c.nome)}" spellcheck="false" autocomplete="off" aria-label="${esc(`Nome do cargo ${c.nome}`)}" title="Clique para renomear o cargo" onkeydown="teclaNomeCargo(event, this)" onchange="renomearCargo('${cargo}', this)">`
            : `<span class="cp-cargo-nome" id="cp-cargo-nome-${cargo}">${esc(nomeDoCargo(cargo, p))}</span>`}
          ${nomeDoCargo(cargo, p) !== c.nome ? `<span class="cp-cargo-padrao" title="Nome padrão">${esc(c.nome)}</span>` : ''}
          <span class="cp-cargo-n">${n} ${n === 1 ? 'pessoa' : 'pessoas'}</span>
        </div>
        <p class="cp-cargo-desc">${esc(c.desc)}${cargo === 'owner' ? ' Tem todas as permissões, sempre.' : ''}</p>
        ${perms}
      </div>`;
  };
  return `
    <h3 class="set-painel-titulo">Cargos</h3>
    <p class="set-painel-desc">${dono ? 'O que cada cargo pode fazer. Clique no nome de um cargo para renomear. Cada regra liga e desliga aqui e vale na hora para todo mundo daquele cargo.' : 'O que cada cargo pode fazer. Só o dono muda as regras e os nomes.'}</p>
    <div class="cp-cargos">${['owner', ...CARGOS_DE_MEMBRO].map(bloco).join('')}</div>
    <p class="cp-nota">Convidar e mudar cargos só vão até o cargo de quem faz, e ninguém muda o próprio cargo. Ninguém silencia nem move o dono, e cada pessoa só modera quem tem cargo igual ou abaixo do seu. As mensagens diretas são só de quem conversa, nem o dono vê.</p>`;
}

// Enter grava (o change vem do blur); Esc volta ao nome de antes sem gravar.
function teclaNomeCargo(e, input){
  if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
  else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); input.value = input.defaultValue; input.blur(); }
}

// Só o dono (SEC-086). Nome vazio, ou igual ao padrão, volta ao padrão.
async function renomearCargo(cargo, input){
  const p = configProjeto && state.projects.find(x=>x.id === configProjeto.pid);
  if(!p || p.myRole !== 'owner' || !CARGOS[cargo] || !input) return;
  const padrao = CARGOS[cargo].nome;
  const v = input.value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, CARGO_NOME_MAX) || padrao;
  if(v === nomeDoCargo(cargo, p)){ input.value = v; return; }
  const antes = p.nomes_cargos;
  const novo = {...nomesDosCargos(p)};
  if(v === padrao) delete novo[cargo]; else novo[cargo] = v;
  const valor = Object.keys(novo).length ? novo : null;
  p.nomes_cargos = valor;
  input.disabled = true;
  const {data, error} = await sb.from('projects').update({nomes_cargos: valor}).eq('id', p.id).select('id').maybeSingle();
  input.disabled = false;
  if(error || !data){
    if(error) console.error(error);
    p.nomes_cargos = antes;
    input.value = nomeDoCargo(cargo, p);
    showToast(faltaColuna(error) ? 'Renomear cargos precisa do supabase/configuracoes_projeto.sql novo. Rode ele no Supabase.'
      : error ? 'Não deu para renomear o cargo. Confira a conexão e tente de novo.' : 'Só o dono renomeia os cargos.', 'erro');
    return;
  }
  saveProjectsCache();
  anunciarNoApp(v === padrao ? `O cargo voltou a se chamar ${padrao}` : `${padrao} agora se chama ${v}`);
  configProjeto.redesenharAoFechar = true;
  desenharConfigProjeto();
  renderSidebarProjects();
}

async function alternarRegraCargo(cargo, perm, ligado, input){
  const p = configProjeto && state.projects.find(x=>x.id === configProjeto.pid);
  if(!p || p.myRole !== 'owner' || !CARGOS_DE_MEMBRO.includes(cargo) || !PERMISSOES_VOZ[perm]) return;
  const regras = regrasDoProjeto(p);
  const lista = new Set(regras[cargo]);
  if(ligado) lista.add(perm); else lista.delete(perm);
  regras[cargo] = Object.keys(PERMISSOES_VOZ).filter(k=>lista.has(k));
  const antes = p.regras_cargos;
  p.regras_cargos = regras;
  if(input) input.disabled = true;
  const {data, error} = await sb.from('projects').update({regras_cargos: regras}).eq('id', p.id).select('id').maybeSingle();
  if(input) input.disabled = false;
  if(error || !data){
    if(error) console.error(error);
    p.regras_cargos = antes;
    if(input) input.checked = !ligado;
    showToast(faltaColuna(error) ? 'As regras de cargo precisam do supabase/configuracoes_projeto.sql. Rode ele no Supabase.'
      : error ? 'Não deu para salvar a regra. Confira a conexão e tente de novo.' : 'Só o dono muda as regras de cargo.', 'erro');
    return;
  }
  saveProjectsCache();
  anunciarNoApp(`${nomeDoCargo(cargo, p)}: ${PERMISSOES_VOZ[perm].nome.toLowerCase()} ${ligado ? 'ligado' : 'desligado'}`);
  if(chamada && chamada.pid === p.id) desenharChamada();
  atualizarListaCanais();
}

function painelMembrosProjeto(p){
  const dono = p.myRole === 'owner';
  const eu = session.user.id;
  const linhaDono = `
    <li class="cp-membro">
      ${avatarChip(p.owner_id === eu ? {avatar_url: state.myAvatarUrl} : p.ownerProfile, ((p.ownerProfile && p.ownerProfile.name) || p.owner_email || '?')[0])}
      <span class="cp-membro-texto">
        <span class="cp-membro-nome">${nomePessoaHtml(p.owner_id === eu ? meuPerfilDeNome() : p.ownerProfile, (p.ownerProfile && p.ownerProfile.name) || p.owner_email || 'Dono')}${p.owner_id === eu ? ' <span class="proj-pessoa-voce">(você)</span>' : ''}</span>
      </span>
      <span class="cp-cargo-pilula nivel-3">${esc(nomeDoCargo('owner', p))}</span>
    </li>`;
  const membros = (p.members || []).filter(m=>m.user_id !== p.owner_id)
    .sort((a, b)=>(a.status === 'accepted' ? 0 : 1) - (b.status === 'accepted' ? 0 : 1)
      || (CARGOS[cargoValido(b.role)].nivel - CARGOS[cargoValido(a.role)].nivel));
  const linhas = membros.map(m=>{
    const cargo = cargoValido(m.role);
    const pendente = m.status !== 'accepted';
    const nome = m.code && !m.user_id ? 'Convite por código' : ((m.profile && m.profile.name) || m.invited_email || 'Membro');
    const sou = m.user_id === eu;
    const detalhe = pendente ? (m.code && !m.user_id ? 'Ainda não usado' : 'Convite pendente') : (m.profile && m.profile.name && m.invited_email ? m.invited_email : '');
    return `
      <li class="cp-membro ${pendente ? 'pendente' : ''}">
        ${avatarChip(m.profile, (nome || '?')[0])}
        <span class="cp-membro-texto">
          <span class="cp-membro-nome">${pendente ? esc(nome) : nomePessoaHtml(sou ? meuPerfilDeNome() : m.profile, nome)}${sou ? ' <span class="proj-pessoa-voce">(você)</span>' : ''}</span>
          ${detalhe ? `<span class="cp-membro-detalhe">${esc(detalhe)}</span>` : ''}
        </span>
        ${!pendente && !sou && m.user_id && !canaisSemTabela ? `<button type="button" class="cn-acao cp-membro-dm" data-foco="dm-${m.id}" onclick="fecharConfigProjeto();abrirConversaDireta('${p.id}','${m.user_id}')" title="Mensagem direta" aria-label="${esc(`Mensagem direta para ${nome}`)}">${ICONE_DM}</button>` : ''}
        ${podeMudarCargoDe(p.id, m)
          ? `<select class="select cp-membro-cargo" data-foco="cargo-${m.id}" aria-label="${esc(`Cargo de ${nome}`)}" onchange="mudarCargo('${m.id}', this.value, this)">${cargosParaDar(p.id).map(r=>`<option value="${r}" ${r === cargo ? 'selected' : ''}>${esc(nomeDoCargo(r, p))}</option>`).join('')}</select>`
          : `<span class="cp-cargo-pilula nivel-${CARGOS[cargo].nivel}">${esc(nomeDoCargo(cargo, p))}</span>`}
        ${dono
          ? `<button type="button" class="cn-acao cp-membro-tirar" data-foco="tirar-${m.id}" onclick="removeMember('${m.id}')" title="${pendente ? 'Cancelar convite' : 'Remover do projeto'}" aria-label="${esc(`${pendente ? 'Cancelar o convite de' : 'Remover'} ${nome}`)}"><svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
          : ''}
      </li>`;
  }).join('');
  return `
    <div class="set-sub-head">
      <h3 class="set-painel-titulo">Membros</h3>
      ${podeConvidar(p.id) ? `<button type="button" class="btn-secondary btn-com-icone set-btn-pequeno" onclick="fecharConfigProjeto();convidarNoProjeto('${p.id}')">${ICONE_MAIS}Convidar</button>` : ''}
    </div>
    <p class="set-painel-desc">${dono ? 'Mude o cargo de cada pessoa. Vale na hora, inclusive para quem está com o projeto aberto.'
      : temPermissaoVoz(p.id, 'cargos') ? 'Você muda o cargo de quem está igual ou abaixo do seu. Vale na hora.'
      : 'Quem está no projeto e o cargo de cada um. Seu cargo não muda cargos.'}</p>
    <ul class="cp-membros" role="list">${linhaDono}${linhas}</ul>`;
}

function limparFiltrosProjeto(){
  Object.assign(state.filter, {kanbanSearch:'', kanbanClient:'', kanbanTag:'', kanbanAssignee:'', kanbanDate:'all'});
  skipEntranceOnce = true;
  render();
}

// Responsável no cartão: foto (ou inicial) e primeiro nome, no lugar do emoji.
function renderAssigneeChip(t, p, people){
  if(!t.assigned_to) return '';
  const pe = people.find(x=>x.id===t.assigned_to);
  const label = getAssigneeLabel(t);
  if(!label) return '';
  const profile = t.assigned_to === session.user.id ? {avatar_url: state.myAvatarUrl} : (pe && pe.profile);
  const nome = label === 'Você' ? 'Você' : label.split(/\s+/)[0];
  return `<span class="kb-card-pessoa">${avatarChip(profile, (pe ? pe.label : label)[0])}${esc(nome)}</span>`;
}

// Tela dedicada pra projetos compartilhados — só alcançável pela aba
// "Projetos" da barra inferior do celular (no desktop a lista já vive na
// barra lateral). Convites pendentes ficam aqui também, pra aceitar sem
// precisar entrar em Configurações.
function renderProjectsList(){
  const invitesHtml = state.pendingInvites.length === 0 ? '' : `
    <div style="margin-bottom:20px;">
      ${state.pendingInvites.map(inv=>`
        <div class="pending-invite-card">
          <div>
            <div style="font-weight:500;color:var(--text-strong);font-size:13.5px;">${esc(inv.projects ? inv.projects.name : 'Projeto')}</div>
            <div style="font-size:11.5px;color:var(--text-muted);">Convite como ${nomeDoCargo(inv.role).toLowerCase()}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn-secondary" style="padding:7px 12px;font-size:12px;" onclick="declineInvite('${inv.id}')">Recusar</button>
            <button class="btn-primary" style="padding:7px 12px;font-size:12px;" onclick="acceptInvite('${inv.id}')">Aceitar</button>
          </div>
        </div>
      `).join('')}
    </div>`;

  const listHtml = state.projects.length === 0
    ? `<div class="empty"><strong>Nenhum projeto compartilhado ainda.</strong>Crie um ou entre com um código de convite em "Gerenciar".</div>`
    : `<div class="projects-list-grid">${state.projects.map(p=>{
        const role = esc(nomeDoCargo(myRoleInProject(p.id), p));
        const tasks = state.tasks.filter(t=>t.project_id===p.id);
        const active = tasks.filter(t=>taskColumnType(t)!=='done').length;
        return `
          <div class="glass project-list-card" role="button" tabindex="0" onclick="openProjectView('${p.id}')">
            <div class="project-card-head" style="margin-bottom:6px;">
              <div class="project-card-name">${projetoIconeHtml(p, 'm')}<span class="project-card-nome">${esc(p.name)}</span>${seloNaoLidas(p.id)}</div>
              <div class="project-card-role">${role}</div>
            </div>
            <div class="project-list-card-meta">${active} ativa${active!==1?'s':''} · ${tasks.length} no total</div>
          </div>`;
      }).join('')}</div>`;

  const acoesProjetos = `
      <div class="projects-list-acoes">
        <button class="btn-secondary" onclick="openProjectsModal()">Gerenciar</button>
        <div class="novo-menu">
          <button class="btn-primary btn-com-icone novo-menu-btn" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)">${ICONE_MAIS}Novo projeto</button>
          <div class="novo-menu-lista" role="menu" hidden>${itensNovoProjeto()}</div>
        </div>
      </div>`;
  // Com as metas no topo a tela vira "Metas e projetos", e os botões de
  // projeto descem para junto da lista que eles afetam — no topo, separados
  // dela por todas as metas, ficavam longe do que mudam.
  return `
    <div class="view-header"><div><h1>Metas e projetos</h1></div></div>
    ${renderMetasMobile()}
    <div class="secao-head projetos-head"><h2 class="panel-title">Projetos</h2>${acoesProjetos}</div>
    ${invitesHtml}
    ${listHtml}`;
}

// "N pessoas", no topo do projeto: uma lista simples de quem está nele, como
// a lista de membros de um servidor do Discord. Foto, nome, papel e, se a
// pessoa estiver numa sala de voz, qual. Convidar e remover continuam no
// "Gerenciar membros" (o modal dos projetos), só para o dono.
function pessoasDoProjetoHtml(p, isOwner){
  const naSalaDe = {};
  try{
    const porSala = pessoasNasSalas(p.id);
    for(const [sala, gente] of Object.entries(porSala)) for(const x of gente) naSalaDe[x.uid] = sala;
  }catch(e){}
  const pessoas = projectPeople(p)
    .map(pe=>{ const cargo = cargoNoProjeto(p, pe.id) || 'viewer'; return {...pe, cargo, papel: esc(nomeDoCargo(cargo, p))}; })
    .sort((a, b)=>(CARGOS[b.cargo].nivel - CARGOS[a.cargo].nivel) || a.label.localeCompare(b.label, 'pt-BR'));
  const linhas = pessoas.map(pe=>{
    const eu = pe.id === session.user.id;
    const sala = naSalaDe[pe.id] && canalDoProjeto(p.id, naSalaDe[pe.id]);
    return `
      <li class="proj-pessoa">
        ${avatarChip(eu ? meuPerfilDeNome() : pe.profile, pe.label[0])}
        <span class="proj-pessoa-texto">
          <span class="proj-pessoa-nome">${nomePessoaHtml(eu ? meuPerfilDeNome() : pe.profile, pe.label)}${eu ? ' <span class="proj-pessoa-voce">(você)</span>' : ''}</span>
          ${sala ? `<span class="proj-pessoa-sala">${ICONE_SALA}${esc(sala.nome)}</span>` : ''}
        </span>
        <span class="proj-pessoa-papel">${pe.papel}</span>
      </li>`;
  }).join('');
  return `
    <p class="proj-pessoas-titulo">${pessoas.length} ${pessoas.length === 1 ? 'pessoa' : 'pessoas'} no projeto</p>
    <ul class="proj-pessoas-lista">${linhas}</ul>
    <button type="button" class="proj-pessoas-gerenciar" onclick="abrirConfigProjeto('${p.id}', 'membros')">${isOwner ? 'Gerenciar membros e cargos' : 'Ver cargos'}</button>`;
}

function alternarPessoasDoProjeto(btn, fechar){
  const botoes = btn ? [btn] : [...document.querySelectorAll('.proj-pessoas .proj-people')];
  for(const b of botoes){
    const pop = b.nextElementSibling;
    if(!pop) continue;
    const abrir = !fechar && pop.hidden;
    pop.hidden = !abrir;
    b.setAttribute('aria-expanded', abrir);
    if(abrir){ const alvo = pop.querySelector('button') || pop; pop.tabIndex = -1; alvo.focus(); }
  }
}

document.addEventListener('click', (e)=>{
  document.querySelectorAll('.proj-pessoas').forEach(w=>{
    if(w.contains(e.target)) return;
    const b = w.querySelector('.proj-people');
    if(b && b.getAttribute('aria-expanded') === 'true') alternarPessoasDoProjeto(b, true);
  });
});

document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  const b = document.querySelector('.proj-pessoas .proj-people[aria-expanded="true"]');
  if(!b) return;
  e.preventDefault();
  alternarPessoasDoProjeto(b, true);
  b.focus();
});

function openProjectsModal(){
  renderProjectsModal();
  document.getElementById('projects-modal').classList.add('open');
}
function closeProjectsModal(){
  document.getElementById('projects-modal').classList.remove('open');
}

function getAssigneeLabel(t){
  if(!t.assigned_to || !t.project_id) return null;
  if(t.assigned_to === session.user.id) return 'Você';
  const p = state.projects.find(x=>x.id===t.project_id);
  if(!p) return null;
  if(t.assigned_to === p.owner_id) return (p.ownerProfile && p.ownerProfile.name) || (p.owner_email ? p.owner_email.split('@')[0] : null);
  const m = p.members.find(x=>x.user_id===t.assigned_to);
  if(!m) return null;
  return (m.profile && m.profile.name) || (m.invited_email ? m.invited_email.split('@')[0] : null);
}

let currentCommentTaskId = null;
let commentProfileCache = {};

function fmtCommentTime(iso){
  const d = new Date(iso);
  const dias = DIAS_CURTOS;
  const meses = MESES_CURTOS;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if(isToday) return `Hoje, ${time}`;
  return `${d.getDate()} ${meses[d.getMonth()]}, ${time}`;
}

async function loadTaskComments(taskId){
  const {data, error} = await sb.from('task_comments').select('*').eq('task_id', taskId).order('created_at', {ascending: true});
  if(error){console.error(error);return [];}
  const userIds = [...new Set(data.map(c=>c.user_id))].filter(id=>!commentProfileCache[id]);
  if(userIds.length){
    const {data: profiles} = await sb.from('profiles').select('id,name,avatar_url').in('id', userIds);
    (profiles || []).forEach(p=>{commentProfileCache[p.id] = p;});
  }
  return data.map(c=>({...c, profile: commentProfileCache[c.user_id] || null}));
}

function renderCommentsList(comments){
  const wrap = document.getElementById('task-comments-list');
  if(!wrap) return;
  if(comments.length === 0){
    wrap.innerHTML = `<div class="empty" style="padding:20px 12px;font-size:12px;"><strong>Nenhum comentário ainda.</strong>Seja o primeiro a escrever algo.</div>`;
    return;
  }
  wrap.innerHTML = comments.map(c=>{
    const name = (c.profile && c.profile.name) || 'Alguém';
    const mine = c.user_id === session.user.id;
    return `
      <div class="comment-item">
        ${avatarChip(c.profile, name[0])}
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">${esc(name)}${mine ? ' (você)' : ''}</span>
            <span class="comment-time">${fmtCommentTime(c.created_at)}</span>
            ${mine ? `<button class="comment-delete" onclick="deleteComment('${c.id}')" title="Excluir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>
          <div class="comment-text">${esc(c.content)}</div>
        </div>
      </div>`;
  }).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

async function refreshComments(){
  if(!currentCommentTaskId) return;
  const comments = await loadTaskComments(currentCommentTaskId);
  renderCommentsList(comments);
}

async function sendComment(){
  const input = document.getElementById('comment-input');
  const content = input.value.trim();
  if(!content || !currentCommentTaskId) return;
  const btn = document.querySelector('.comment-send-btn');
  if(btn) btn.disabled = true;
  const {error} = await sb.from('task_comments').insert({
    task_id: currentCommentTaskId,
    user_id: session.user.id,
    content
  });
  if(btn) btn.disabled = false;
  if(error){console.error(error);showToast('Não deu para enviar o comentário. Tente de novo em instantes.', 'erro');return;}
  input.value = '';
  await refreshComments();
}

async function deleteComment(commentId){
  if(!await confirmar('O comentário some para todos os membros do projeto.', {title:'Excluir esse comentário?', okLabel:'Excluir'})) return;
  const {error} = await sb.from('task_comments').delete().eq('id', commentId);
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  await refreshComments();
}

function avatarChip(profile, fallbackChar){
  const url = profile && profile.avatar_url;
  if(url){
    return `<div class="member-avatar"><img src="${esc(url)}" alt="" width="28" height="28" loading="lazy" decoding="async"></div>`;
  }
  return `<div class="member-avatar member-avatar-fallback">${esc((fallbackChar||'?').toUpperCase())}</div>`;
}

function renderProjectsModal(){
  const body = document.getElementById('projects-modal-body');
  let html = '';

  if(state.pendingInvites.length > 0){
    html += state.pendingInvites.map(inv=>`
      <div class="pending-invite-card">
        <div>
          <div style="font-weight:500;color:var(--text-strong);font-size:13.5px;">${esc(inv.projects ? inv.projects.name : 'Projeto')}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">Convite como ${nomeDoCargo(inv.role).toLowerCase()}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary" style="padding:7px 12px;font-size:12px;" onclick="declineInvite('${inv.id}')">Recusar</button>
          <button class="btn-primary" style="padding:7px 12px;font-size:12px;" onclick="acceptInvite('${inv.id}')">Aceitar</button>
        </div>
      </div>
    `).join('');
  }

  html += `
    <div class="field" style="margin-bottom:18px;">
      <label for="join-code-input">Entrar com código de convite</label>
      <div class="invite-row">
        <input type="text" class="input" id="join-code-input" placeholder="Código ou link, ex: 7F3K2A" autocomplete="off" spellcheck="false" autocapitalize="characters" onkeypress="if(event.key==='Enter')joinByCode()">
        <button class="btn-primary" style="flex-shrink:0;padding:0 16px;" onclick="joinByCode()">Entrar</button>
      </div>
      <div class="invite-conta">Convites por email chegam para <strong>${esc(session.user.email || '')}</strong>. Se esperava um convite e ele não aparece, confira se entrou com a conta certa.</div>
    </div>
  `;

  html += `
    <div class="field" style="margin-bottom:18px;">
      <label>Criar novo projeto</label>
      <div class="invite-row">
        <input type="text" class="input" id="new-project-name" placeholder="Nome do projeto" onkeypress="if(event.key==='Enter')createProject()">
        <button class="btn-primary" style="flex-shrink:0;padding:0 16px;" onclick="createProject()">Criar</button>
      </div>
    </div>
  `;

  if(state.projects.length === 0){
    html += `<div class="empty"><strong>Nenhum projeto ainda.</strong>Crie um acima pra convidar alguém.</div>`;
  } else {
    html += state.projects.map(p=>{
      const isOwner = p.myRole === 'owner';
      const ownerRow = !isOwner ? `
        <div class="member-row">
          ${avatarChip(p.ownerProfile, (p.owner_email||'?')[0])}
          <div class="member-email">${esc((p.ownerProfile && p.ownerProfile.name) || p.owner_email || '—')}</div>
          <div class="member-status accepted">${esc(nomeDoCargo('owner', p))}</div>
        </div>` : '';
      const membersHtml = p.members.length === 0
        ? `<div style="font-size:12px;color:var(--text-soft);padding:6px 0;">Ninguém convidado ainda.</div>`
        : p.members.map(m=>{
          const label = m.code
            ? (isOwner
                ? `Código: <span style="color:var(--text-strong);font-family:'JetBrains Mono',monospace;letter-spacing:0.08em;">${esc(m.code)}</span>`
                : `<span style="color:var(--text-soft);">Convite por código, ainda não usado</span>`)
            : esc((m.profile && m.profile.name) || m.invited_email || '—');
          const codeSeguro = m.code ? String(m.code).replace(/[^A-Z0-9]/gi, '') : '';
          return `
          <div class="member-row">
            ${avatarChip(m.profile, (m.invited_email||'?')[0])}
            <div class="member-email">${label}</div>
            ${isOwner && codeSeguro ? `<button class="member-copy" onclick="copiarLinkConvite('${codeSeguro}')">Copiar link</button>` : ''}
            ${isOwner
              ? `<select class="member-cargo" aria-label="${esc(`Cargo de ${(m.profile && m.profile.name) || m.invited_email || 'convite por código'}`)}" onchange="mudarCargo('${m.id}', this.value, this)">${opcoesDeCargo(cargoValido(m.role), p)}</select><div class="member-status ${m.status === 'accepted' ? 'accepted' : 'pending'}">${m.status === 'accepted' ? 'Ativo' : 'Pendente'}</div>`
              : `<div class="member-status ${m.status === 'accepted' ? 'accepted' : 'pending'}">${m.status === 'accepted' ? 'Ativo' : 'Pendente'} · ${esc(nomeDoCargo(m.role, p))}</div>`}
            ${isOwner ? `<button class="member-remove" onclick="removeMember('${m.id}')" title="Remover"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>`;
        }).join('');

      return `
        <div class="project-card">
          <div class="project-card-head">
            <div class="project-card-name">${projetoIconeHtml(p, 'm')}<span class="project-card-nome">${esc(p.name)}</span>${seloNaoLidas(p.id)}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="project-card-role">${esc(nomeDoCargo(myRoleInProject(p.id), p))}</div>
              <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="closeProjectsModal();openProjectView('${p.id}');">Abrir quadro</button>
            </div>
          </div>
          ${ownerRow}
          ${membersHtml}
          ${podeConvidar(p.id) ? `
            <div class="invite-row">
              <input type="email" class="input" id="invite-email-${p.id}" placeholder="Email pra convidar" aria-label="Email pra convidar para ${esc(p.name)}">
              <select id="invite-role-${p.id}" aria-label="Cargo de quem for convidado">
                ${opcoesDeConvite(p.id)}
              </select>
              <button class="btn-secondary" style="flex-shrink:0;padding:0 14px;" onclick="inviteToProject('${p.id}')">Convidar</button>
            </div>
            <div class="invite-ou"><span>ou</span></div>
            <div class="invite-code-row">
              <div class="invite-code-text">
                <div class="invite-code-title">Código de convite</div>
                <div class="invite-code-hint">Pra quem já tem login no app.</div>
              </div>
              <select id="code-role-${p.id}" aria-label="Cargo de quem entrar pelo código">
                ${opcoesDeConvite(p.id)}
              </select>
              <button class="btn-secondary" style="flex-shrink:0;padding:0 14px;" onclick="generateInviteCode('${p.id}')">Gerar código</button>
            </div>
          ` : ''}
          ${isOwner
            ? `<button class="btn-danger" style="width:100%;margin-top:10px;" onclick="deleteProject('${p.id}')">Excluir projeto</button>`
            : `<button class="btn-danger" style="width:100%;margin-top:12px;" onclick="leaveProject('${p.id}')">Sair do projeto</button>`}
        </div>
      `;
    }).join('');
  }

  body.innerHTML = html;
}

function fmtDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}`;
}
function dateWithTime(t){
  if(!t.date) return '—';
  return t.time ? `${fmtDate(t.date)} ⏰${esc(t.time)}` : fmtDate(t.date);
}
function fmtDateFull(iso){
  if(!iso) return 'Sem prazo';
  const [y,m,d] = iso.split('-');
  const dt = new Date(+y, +m-1, +d);
  const dias = DIAS_LONGOS;
  const meses = MESES_CURTOS_CAP;
  return `${dias[dt.getDay()]}, ${+d} ${meses[+m-1]}`;
}
function dateStatus(iso){
  if(!iso) return '';
  const today = new Date();
  today.setHours(0,0,0,0);
  const [y,m,d] = iso.split('-');
  const dt = new Date(+y, +m-1, +d);
  const diff = Math.round((dt-today)/86400000);
  if(diff < 0) return 'overdue';
  if(diff === 0) return 'today';
  return '';
}
function taskDateStatus(t){
  if(taskColumnType(t) === 'done') return t.date ? 'done' : '';
  return dateStatus(t.date);
}
/* --- Nomes de data --------------------------------------------------------
   Estavam escritos a mao em 6 lugares (com tres grafias diferentes de mes).
   Agora saem do Intl uma vez so; a indexacao continua a mesma de antes. */
const LOCALE_APP = 'pt-BR';
function nomesDeData(tipo, estilo){
  const fmt = new Intl.DateTimeFormat(LOCALE_APP, tipo === 'mes'
    ? {month: estilo, timeZone: 'UTC'}
    : {weekday: estilo, timeZone: 'UTC'});
  const out = [];
  if(tipo === 'mes'){
    for(let m = 0; m < 12; m++) out.push(fmt.format(new Date(Date.UTC(2021, m, 15))));
  } else {
    // 2021-08-01 caiu num domingo, entao o indice bate com getDay().
    for(let d = 0; d < 7; d++) out.push(fmt.format(new Date(Date.UTC(2021, 7, 1 + d))));
  }
  return out.map(t=>t.replace(/\.$/, ''));
}
const capitaliza = (t)=> t.charAt(0).toUpperCase() + t.slice(1);
const MESES_CURTOS = nomesDeData('mes', 'short');
const MESES_CURTOS_CAP = MESES_CURTOS.map(capitaliza);
const MESES_LONGOS = nomesDeData('mes', 'long');
const MESES_LONGOS_CAP = MESES_LONGOS.map(capitaliza);
const DIAS_CURTOS = nomesDeData('dia', 'short');
const DIAS_CURTOS_CAP = DIAS_CURTOS.map(capitaliza);
const DIAS_LONGOS = nomesDeData('dia', 'long').map(t=>capitaliza(t).replace('-feira', ''));

let toastTimer = null;
function showToast(msg, type){
  const old = document.querySelector('.toast');
  if(old) old.remove();
  if(toastTimer) clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast';
  if(type) t.dataset.type = type;
  // Sem isto, nada do que o app avisa chega a quem usa leitor de tela.
  t.setAttribute('role', type === 'erro' ? 'alert' : 'status');
  t.setAttribute('aria-live', type === 'erro' ? 'assertive' : 'polite');
  t.innerHTML = `<span class="toast-dot"></span>${esc(msg)}`;
  document.body.appendChild(t);
  toastTimer = setTimeout(()=>{
    t.style.transition = 'opacity .25s ease, transform .25s ease';
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, 8px)';
    setTimeout(()=>t.remove(), 250);
  }, type === 'erro' ? 5000 : 2200);
}

/* --- Dialogos do app ------------------------------------------------------
   confirm()/prompt()/alert() nativos travam a aba inteira, ignoram o tema e
   nao dao para rotular. Estes resolvem uma Promise e usam o mesmo modal do
   resto do app. */
/* --- Foco nos modais -----------------------------------------------------
   Sem isto o Tab passeia pela pagina atras do modal aberto, e ao fechar o foco
   cai no <body> — quem navega por teclado perde o lugar. */
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const modalFocusStack = [];

function focusablesIn(root){
  return Array.from(root.querySelectorAll(FOCUSABLE_SEL)).filter(el=>el.offsetParent !== null);
}

// QUA-020: linha de tarefa, cartão do kanban, cartão de projeto, contador do
// painel e dia do mini calendário são <div onclick> com role="button" e
// tabindex="0" (virar <button> quebraria o layout deles, que tem blocos
// dentro). Enter e Espaço neles fazem o mesmo que o clique, como num botão.
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Enter' && e.key !== ' ') return;
  if(e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
  const el = e.target;
  if(!el || el.getAttribute('role') !== 'button' || !el.hasAttribute('onclick')) return;
  if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) return;
  e.preventDefault();
  el.click();
});

function topOpenModal(){
  const abertos = Array.from(document.querySelectorAll('.modal-bg.open'));
  return abertos.length ? abertos[abertos.length - 1] : null;
}

function watchModalFocus(){
  document.querySelectorAll('.modal-bg').forEach(modal=>{
    new MutationObserver(()=>{
      const aberto = modal.classList.contains('open');
      const marcado = modal.dataset.focusTracked === '1';
      if(aberto && !marcado){
        modal.dataset.focusTracked = '1';
        modalFocusStack.push(document.activeElement);
        const alvos = focusablesIn(modal);
        if(alvos.length) alvos[0].focus();
      } else if(!aberto && marcado){
        delete modal.dataset.focusTracked;
        const anterior = modalFocusStack.pop();
        if(anterior && document.contains(anterior)) anterior.focus();
      }
    }).observe(modal, {attributes: true, attributeFilter: ['class']});
  });
}

document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Tab') return;
  const modal = topOpenModal();
  if(!modal) return;
  const alvos = focusablesIn(modal);
  if(!alvos.length) return;
  const primeiro = alvos[0], ultimo = alvos[alvos.length - 1];
  if(e.shiftKey && document.activeElement === primeiro){ e.preventDefault(); ultimo.focus(); }
  else if(!e.shiftKey && document.activeElement === ultimo){ e.preventDefault(); primeiro.focus(); }
  else if(!modal.contains(document.activeElement)){ e.preventDefault(); primeiro.focus(); }
});

let dialogResolver = null;

function askDialog(opts){
  const o = opts || {};
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-modal-title').textContent = o.title || 'Confirmar';
  document.getElementById('confirm-modal-text').textContent = o.text || '';
  const okBtn = document.getElementById('confirm-modal-ok');
  okBtn.textContent = o.okLabel || 'Confirmar';
  okBtn.classList.toggle('btn-danger', !!o.danger);
  okBtn.classList.toggle('btn-primary', !o.danger);

  const field = document.getElementById('confirm-modal-field');
  const input = document.getElementById('confirm-modal-input');
  const isPrompt = !!o.input;
  field.style.display = isPrompt ? '' : 'none';
  if(isPrompt){
    document.getElementById('confirm-modal-label').textContent = o.input.label || 'Valor';
    input.value = o.input.value || '';
    input.placeholder = o.input.placeholder || '';
  }

  modal.classList.add('open');
  setTimeout(()=>{ (isPrompt ? input : okBtn).focus(); }, 50);

  return new Promise(resolve=>{ dialogResolver = resolve; });
}

// null = cancelou. Para confirmacao devolve true; para prompt, o texto.
function resolveDialog(value){
  const modal = document.getElementById('confirm-modal');
  if(!modal.classList.contains('open')) return;
  modal.classList.remove('open');
  const r = dialogResolver;
  dialogResolver = null;
  if(r) r(value);
}

function submitDialog(){
  const field = document.getElementById('confirm-modal-field');
  if(field.style.display === 'none') return resolveDialog(true);
  const v = document.getElementById('confirm-modal-input').value.trim();
  resolveDialog(v || null);
}

function confirmar(text, opts){
  const o = opts || {};
  return askDialog({title: o.title || 'Tem certeza?', text, okLabel: o.okLabel || 'Confirmar', danger: o.danger !== false})
    .then(v=> v === true);
}

function perguntar(text, opts){
  const o = opts || {};
  return askDialog({title: o.title || text, text: o.text || '', okLabel: o.okLabel || 'Salvar', danger: false,
                    input: {label: o.label || text, value: o.value || '', placeholder: o.placeholder || ''}});
}

// Último número mostrado em cada contador do painel. O render() refaz o HTML
// a cada sync, realtime e tarefa marcada; sem isto os contadores voltavam a
// zero e contavam de novo a cada atualização. Agora contam a partir do zero
// só na primeira vez e, depois, só quando o número muda, do valor antigo ao
// novo.
const contadoresVistos = {};

function animateCount(el, target){
  const chave = el.dataset.chave;
  const start = chave && chave in contadoresVistos ? contadoresVistos[chave] : 0;
  if(chave) contadoresVistos[chave] = target;
  if(start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.textContent = target;
    return;
  }
  el.textContent = start;
  const dur = start === 0 ? 550 : 400;
  const startTime = performance.now();
  function tick(now){
    // O carimbo do quadro pode vir antes do performance.now() acima; sem o
    // max o primeiro quadro mostrava um número negativo.
    const p = Math.max(0, Math.min((now - startTime) / dur, 1));
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if(p < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  }
  requestAnimationFrame(tick);
}

// Escapa para texto E para dentro de atributo. A versao antiga usava
// textContent -> innerHTML, que nao escapa aspas: qualquer titulo com " escapava
// do atributo e virava execucao de script.
function esc(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Sanitizacao das notas de projeto -------------------------------------
// As notas sao HTML de um contenteditable e ficam visiveis para todos os membros
// do projeto. Sem allowlist, um membro injeta script no navegador dos outros.
const NOTES_ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','H1','H2','H3','H4','H5','H6','P','BR','HR','DIV','SPAN','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A','IMG']);
const NOTES_ALLOWED_ATTRS = {A: ['href'], IMG: ['src','alt']};
const NOTES_DROP_TAGS = new Set(['SCRIPT','STYLE','IFRAME','FRAME','FRAMESET','OBJECT','EMBED','APPLET','LINK','META','BASE','FORM','INPUT','BUTTON','SELECT','TEXTAREA','SVG','MATH','TEMPLATE','NOSCRIPT','AUDIO','VIDEO','SOURCE']);

function safeUrl(value, allowInlineImage){
  const v = String(value == null ? '' : value).trim();
  if(/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if(allowInlineImage && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]*$/i.test(v)) return v;
  return '';
}

function sanitizeNotesHtml(html){
  const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
  const clean = (parent)=>{
    Array.from(parent.childNodes).forEach(node=>{
      if(node.nodeType === Node.TEXT_NODE) return;
      if(node.nodeType !== Node.ELEMENT_NODE){ node.remove(); return; }
      const tag = node.tagName.toUpperCase();
      if(NOTES_DROP_TAGS.has(tag)){ node.remove(); return; }
      clean(node);
      if(!NOTES_ALLOWED_TAGS.has(tag)){ node.replaceWith(...node.childNodes); return; }
      const allowed = NOTES_ALLOWED_ATTRS[tag] || [];
      let drop = false;
      Array.from(node.attributes).forEach(attr=>{
        const name = attr.name.toLowerCase();
        if(allowed.indexOf(name) === -1){ node.removeAttribute(attr.name); return; }
        if(name === 'href'){
          const u = safeUrl(attr.value, false);
          if(u) node.setAttribute('href', u); else node.removeAttribute('href');
        }
        if(name === 'src'){
          const u = safeUrl(attr.value, true);
          if(u) node.setAttribute('src', u); else drop = true;
        }
      });
      if(drop){ node.remove(); return; }
      if(tag === 'A' && node.getAttribute('href')){
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if(tag === 'IMG'){ node.setAttribute('loading', 'lazy'); }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

function updateNav(){
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.view === state.view);
  });
  const now = new Date();
  const dias = DIAS_CURTOS;
  const meses = MESES_CURTOS;
  document.getElementById('today-date').textContent = `${dias[now.getDay()]}, ${now.getDate()} ${meses[now.getMonth()]}`;
  const overdue = personalTasks().filter(t=>taskColumnType(t)!=='done' && dateStatus(t.date)==='overdue').length;
  const today = personalTasks().filter(t=>taskColumnType(t)!=='done' && dateStatus(t.date)==='today').length;
  document.getElementById('today-hint').textContent = overdue > 0 ? `${overdue} atrasada${overdue>1?'s':''}` : today > 0 ? `${today} vence hoje` : 'tudo em dia';

  const myOwnTasks = state.tasks.filter(t=>!t.project_id && t.owner_id === session.user.id);
  const sortedTasks = [...myOwnTasks].sort((a,b)=>b.created - a.created);
  const seen = new Set();
  const ordered = [];
  sortedTasks.forEach(t=>{
    if(t.client){
      const trimmed = t.client.trim();
      const key = trimmed.toLowerCase();
      if(key && !seen.has(key)){
        seen.add(key);
        ordered.push(trimmed);
      }
    }
  });
  state.recentClients = ordered;
  renderSidebarProjects();
  renderSidebarMetas();
  renderFraseLateral();
}

let skipEntranceOnce = false;
let lastRenderedView = null;
// Preenchido por setProjectTasksView e consumido pelo render() seguinte, que
// anima só o conteúdo da aba. Qualquer outro render da mesma tela vem sem.
let trocaDeAba = null;

function render(){
  updateNav();
  const m = document.getElementById('main');

  // A animação de entrada é para quando se troca de tela. Repetir ela a cada
  // atualização em lugar (sync, realtime, filtro, seleção) é o que faz a tela
  // piscar. Redesenhar a mesma tela também não deve perder a rolagem lateral.
  const viewKey = state.view === 'project' ? `project:${state.currentProjectId}`
    : state.view === 'meta' ? `meta:${state.metas.atual}` : state.view;
  const sameView = viewKey === lastRenderedView;
  lastRenderedView = viewKey;
  const keepScroll = sameView ? m.scrollLeft : 0;

  // O sync do Google e o realtime chamam render() a qualquer momento. Trocar o
  // innerHTML inteiro sem isto apaga o campo em que a pessoa esta digitando.
  const ativo = document.activeElement;
  const focoId = ativo && ativo.id && m.contains(ativo) ? ativo.id : null;
  let selIni = null, selFim = null;
  if(focoId){
    try{ selIni = ativo.selectionStart; selFim = ativo.selectionEnd; }catch(e){}
  }

  if(state.view === 'dashboard') m.innerHTML = renderDashboard();
  else if(state.view === 'kanban') m.innerHTML = renderKanban();
  else if(state.view === 'calendar') m.innerHTML = renderCalendar();
  else if(state.view === 'table') m.innerHTML = renderTable();
  else if(state.view === 'project') m.innerHTML = renderProjectPage();
  else if(state.view === 'projects') m.innerHTML = renderProjectsList();
  else if(state.view === 'desafio') m.innerHTML = isDesafioOwner() ? renderDesafio() : renderDashboard();
  else if(state.view === 'meta') m.innerHTML = renderMetaPage();

  m.classList.toggle('no-entrance', sameView || skipEntranceOnce);
  m.classList.toggle('troca-aba', !!trocaDeAba);
  m.classList.toggle('aba-volta', !!(trocaDeAba && trocaDeAba.volta));
  m.classList.toggle('filtros-entram', !!(trocaDeAba && trocaDeAba.filtros));
  skipEntranceOnce = false;
  trocaDeAba = null;
  m.scrollLeft = keepScroll;
  if(state.view === 'project') posicionarRealceDasAbas(realceAntes);
  realceAntes = null;
  attachEvents();
  tornarClicaveisAcessiveis(m);
  if(state.view === 'project' && state.projectTasksView === 'chat') aposRenderChat();
  sincronizarCanaisChamada();

  if(focoId){
    const denovo = document.getElementById(focoId);
    if(denovo){
      denovo.focus();
      if(selIni !== null){
        try{ denovo.setSelectionRange(selIni, selFim); }catch(e){}
      }
    }
  }
}

// Linhas de tarefa, cartões do Kanban, dias do calendário, contadores do
// painel: tudo <div onclick>. O mouse alcança, o teclado não. Em vez de
// reescrever cada template, isto dá foco e papel de botão a eles depois de
// cada render, e o keydown global lá embaixo traduz Enter/Espaço em clique.
// Quem já tem um <button> dentro (o atalho "Nova tarefa") fica de fora para
// não virar duas paradas de Tab.
const CLICAVEIS_SEL = '[onclick]:not(button):not(a):not(input):not(select):not(textarea):not(label), .cal-cell[data-date], .cal-task[data-task-id]';
function tornarClicaveisAcessiveis(root){
  if(!root) return;
  root.querySelectorAll(CLICAVEIS_SEL).forEach(el=>{
    if(el.querySelector('button')) return;
    if(!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if(!el.hasAttribute('role') && el.tagName !== 'TR') el.setAttribute('role', 'button');
    el.dataset.clicavel = '1';
  });
}

function renderDashboard(){
  const now = new Date();
  const hrs = now.getHours();
  const saudacao = hrs < 12 ? 'Bom dia' : hrs < 18 ? 'Boa tarde' : 'Boa noite';
  const cols = getColumns();
  const pTasks = personalTasks();
  const colCounts = cols.map(c=>({...c, count: pTasks.filter(t=>statusVisivel(t, cols)===c.key).length}));
  const overdue = pTasks.filter(t=>taskColumnType(t)!=='done' && dateStatus(t.date)==='overdue').length;
  const acoes = sortByDateThenPriority(
    pTasks.filter(t=>taskColumnType(t)==='active' && matchesDateFilter(t, state.dateFilter))
  );
  const dataStr = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});

  const renderTaskRow = (t)=>{
    const isUrgent = t.priority === 'urgent';
    const isHigh = t.priority === 'high';
    const badge = isUrgent
      ? '<span class="priority-badge urgent">Urgente</span>'
      : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
    const cls = isUrgent ? 'urgent' : (isHigh ? 'high' : '');
    const dot = taskDotStyle(t);
    const pName = t.project_id ? projectName(t.project_id) : null;
    const projBadge = pName ? `<span class="project-badge">${esc(pName)}</span>` : '';
    return `
      <div class="task-row ${cls}" role="button" tabindex="0" onclick="openModal('${t.id}')">
        <div class="task-check ${dot.cls}" style="${dot.style}"></div>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-date ${taskDateStatus(t)}">${dateWithTime(t)}</div>
        <span class="task-row-break"></span>
        ${badge}
        ${projBadge}
        ${t.client ? `<div class="task-client">${esc(t.client)}</div>` : ''}
      </div>`;
  };

  return `
    <div class="view-header">
      <div>
        <div class="eyebrow">${dataStr}</div>
        <h1>${saudacao}, ${esc(getUserName())}</h1>
      </div>
      <div class="header-cta" role="button" tabindex="0" onclick="openModal()" style="cursor:pointer;">
        <div class="header-cta-info">
          <div class="header-cta-title">Precisa lançar algo?</div>
          <div class="header-cta-sub">Atalho: tecla N</div>
        </div>
        <button class="btn-cta" onclick="event.stopPropagation();openModal()">
          <span class="btn-cta-icon">+</span>
          Nova tarefa
        </button>
      </div>
    </div>
    <div class="status-row">
      ${colCounts.map(c=>`<div class="status-item" role="button" tabindex="0" onclick="openStatusDetail('col:${c.key}')"><div class="lbl">${esc(c.name)}</div><div class="val" data-chave="${esc('col:' + c.key)}" data-count="${c.count}">0</div></div>`).join('')}
      <div class="status-item overdue" role="button" tabindex="0" onclick="openStatusDetail('overdue', 'Atrasadas')"><div class="lbl">Atrasadas</div><div class="val" data-chave="overdue" data-count="${overdue}">0</div></div>
    </div>
    <div class="dash-grid">
      <section class="glass panel dash-acoes" aria-labelledby="dash-acoes-titulo">
        <div class="panel-head">
          <h2 class="panel-title" id="dash-acoes-titulo">Próximas ações</h2>
          <div class="dash-prazo" role="group" aria-label="Prazo">
            ${DASH_PRAZOS.map(([k, nome])=>`<button class="${state.dateFilter===k?'active':''}" aria-pressed="${state.dateFilter===k}" onclick="setDateFilter('${k}')">${nome}</button>`).join('')}
          </div>
        </div>
        ${renderAcoesAgrupadas(acoes, renderTaskRow)}
      </section>
      <div class="side-col">
        ${state.metas.precisaSql ? '' : `
        <section class="glass panel" aria-labelledby="dash-metas-titulo">
          <div class="panel-head">
            <h2 class="panel-title" id="dash-metas-titulo">Suas metas</h2>
            ${state.metas.lista.some(g=>g.status === 'ativa') ? `<button class="dash-link" onclick="abrirNovaMeta()">Nova meta</button>` : ''}
          </div>
          ${renderMetasPainel()}
        </section>`}
        <div class="glass panel">${renderMiniCal()}</div>
      </div>
    </div>
  `;
}

const DASH_PRAZOS = [['today', 'Hoje'], ['week', 'Semana'], ['month', 'Mês'], ['all', 'Todas']];

// Em que grupo da Visão geral a tarefa cai, pela distância do prazo até hoje.
function grupoDoPrazo(t){
  if(!t.date) return 'sem';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [y, m, d] = t.date.split('-');
  const diff = Math.round((new Date(+y, +m - 1, +d) - hoje) / 86400000);
  if(diff < 0) return 'atrasadas';
  if(diff === 0) return 'hoje';
  if(diff === 1) return 'amanha';
  if(diff <= 7) return 'semana';
  return 'depois';
}
const GRUPOS_PRAZO = [['atrasadas', 'Atrasadas'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['semana', 'Nos próximos 7 dias'], ['depois', 'Mais pra frente'], ['sem', 'Sem prazo']];
const DASH_LIMITE_ACOES = 10;

function irParaTodasTarefas(){
  state.view = 'table';
  render();
  window.scrollTo(0, 0);
}

// O que vence primeiro aparece primeiro, separado por quando vence: a lista
// corrida misturava a atrasada de ontem com a do mês que vem.
function renderAcoesAgrupadas(acoes, linha){
  if(!acoes.length){
    const todas = state.dateFilter === 'all';
    return `<div class="empty"><strong>${todas ? 'Zero pendências suas.' : 'Nada nesse período.'}</strong>${todas ? 'Aproveita pra respirar.' : 'Escolha um prazo maior pra ver mais.'}</div>`;
  }
  const mostrar = acoes.slice(0, DASH_LIMITE_ACOES);
  const html = GRUPOS_PRAZO.map(([k, nome])=>{
    const doGrupo = mostrar.filter(t=>grupoDoPrazo(t) === k);
    if(!doGrupo.length) return '';
    const total = acoes.filter(t=>grupoDoPrazo(t) === k).length;
    return `
      <div class="dash-grupo ${k}">
        <h3 class="dash-grupo-titulo">${nome}<span>${total}</span></h3>
        ${doGrupo.map(linha).join('')}
      </div>`;
  }).join('');
  const resto = acoes.length - mostrar.length;
  return html + (resto > 0 ? `<button class="dash-link dash-ver-todas" onclick="irParaTodasTarefas()">Ver as outras ${resto} em Todas as tarefas</button>` : '');
}

// Metas em andamento na Visão geral: uma linha por meta com a barra na cor da
// área, para ver de relance o que está andando sem abrir cada página.
function renderMetasPainel(){
  const ativas = state.metas.lista.filter(g=>g.status === 'ativa');
  if(!ativas.length){
    return `<div class="empty dash-metas-vazio"><strong>Nenhuma meta em andamento.</strong>Uma meta junta o que você quer alcançar e mostra o caminho até lá.<button class="btn-secondary btn-com-icone" onclick="abrirNovaMeta()">${ICONE_MAIS}Criar meta</button></div>`;
  }
  return ativas.slice(0, 6).map(g=>{
    const p = metaProgresso(g);
    const temBarra = g.kind !== 'unica';
    return `
      <button class="dash-meta" onclick="abrirMeta('${g.id}')" style="--area:${corDaArea(g.area)}">
        <span class="sidebar-meta-dot" aria-hidden="true"></span>
        <span class="dash-meta-nome">${esc(g.title)}</span>
        ${temBarra ? `<span class="dash-meta-barra" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, p.pct)) * 100).toFixed(1)}%"></span></span>` : ''}
        <span class="dash-meta-prog">${esc(p.longo)}</span>
      </button>`;
  }).join('');
}

function openMiniCalDay(iso){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const dias = DIAS_LONGOS;
  const meses = MESES_LONGOS;
  const label = `${dias[dt.getDay()]}, ${d} de ${meses[m-1]}`;

  let list = personalTasks().filter(t=>t.date === iso);
  list = sortByDateThenPriority(list);

  document.getElementById('status-modal-title').textContent = label;
  const addBtn = document.getElementById('status-modal-add-btn');
  addBtn.style.display = '';
  addBtn.onclick = ()=>{closeStatusModal();openModal(null, iso);};
  const body = document.getElementById('status-modal-body');
  if(list.length === 0){
    body.innerHTML = `<div class="empty"><strong>Nada agendado.</strong>Nenhuma tarefa pra esse dia.</div>`;
  } else {
    body.innerHTML = list.map(t=>{
      const isDone = taskColumnType(t) === 'done';
      const isUrgent = t.priority === 'urgent';
      const isHigh = t.priority === 'high';
      const badge = isUrgent
        ? '<span class="priority-badge urgent">Urgente</span>'
        : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
      const cls = isDone ? 'done-highlight' : (isUrgent ? 'urgent' : (isHigh ? 'high' : ''));
      const rowStyle = isDone ? `--col-color:${taskColumnColor(t)};` : '';
      const dot = taskDotStyle(t);
      return `
        <div class="task-row ${cls}" style="${rowStyle}" role="button" tabindex="0" onclick="closeStatusModal();openModal('${t.id}')">
          <div class="task-check ${dot.cls}" style="${dot.style}"></div>
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-date ${taskDateStatus(t)}">${dateWithTime(t)}</div>
          <span class="task-row-break"></span>
          ${badge}
          <div class="task-client">${esc(t.client || '—')}</div>
        </div>`;
    }).join('');
  }
  tornarClicaveisAcessiveis(body);
  document.getElementById('status-modal').classList.add('open');
}

function renderMiniCal(){
  const d = state.miniCalDate;
  const year = d.getFullYear(), month = d.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const dow = ['D','S','T','Q','Q','S','S'];
  const meses = MESES_LONGOS_CAP;
  const today = new Date();
  const tasksWithDate = new Set(personalTasks().filter(t=>t.date && taskColumnType(t)!=='done').map(t=>t.date));

  let cells = '';
  for(let i=startDow-1;i>=0;i--) cells += `<div class="mini-cal-day other">${prevMonthDays-i}</div>`;
  for(let day=1;day<=daysInMonth;day++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getDate()===day && today.getMonth()===month && today.getFullYear()===year;
    const hasTask = tasksWithDate.has(iso);
    const rotuloDia = `${day} de ${meses[month].toLowerCase()}${isToday ? ', hoje' : ''}${hasTask ? ', com tarefas' : ''}`;
    cells += `<div class="mini-cal-day ${isToday?'today':''} ${hasTask?'has-task':''}" role="button" tabindex="0" aria-label="${rotuloDia}" onclick="openMiniCalDay('${iso}')">${day}</div>`;
  }
  const filled = startDow + daysInMonth;
  const trailing = (7 - filled % 7) % 7;
  for(let i=1;i<=trailing;i++) cells += `<div class="mini-cal-day other">${i}</div>`;

  return `
    <div class="mini-cal-head">
      <div class="mini-cal-title">${meses[month]} ${year}</div>
      <div class="mini-cal-nav">
        <button onclick="miniCalNav(-1)" aria-label="Mês anterior"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button onclick="miniCalNav(1)" aria-label="Próximo mês"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
    </div>
    <div class="mini-cal-grid">
      ${dow.map(d=>`<div class="mini-cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>`;
}

function miniCalNav(delta){state.miniCalDate.setMonth(state.miniCalDate.getMonth()+delta);render();}

// Ícone de repetição desenhado: o emoji 🔁 no título destoava do resto dos
// ícones do app e não dizia de onde a tarefa vinha.
const ICONE_REPETE = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>';

function diasCurtos(ws){
  const ds = [...new Set(ws)].sort((a, b)=>a - b);
  if(ds.length === 7) return 'todo dia';
  if(ds.join() === '1,2,3,4,5') return 'dias úteis';
  if(ds.join() === '0,6') return 'fins de semana';
  return ds.map(i=>DIAS_CURTOS[i]).join(', ');
}

// Linha de origem de uma tarefa gerada por rotina. Se a rotina é o hábito de
// uma meta, mostra a meta (cor da área e progresso da semana) e leva até ela;
// se é uma rotina comum, mostra em que dias ela se repete.
function origemDoCartao(t){
  if(!t.routine_id) return '';
  const g = state.metas.lista.find(x=>x.routineId === t.routine_id && x.status === 'ativa');
  if(g){
    const p = metaProgresso(g);
    const texto = `Meta · ${p.curto.replace('/', ' de ')} na semana`;
    // No modo de seleção o cartão inteiro é alvo de seleção: a linha vira
    // texto, senão o clique nela abriria a meta em vez de selecionar.
    if(state.selecting){
      return `<div class="kb-card-origem"><span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span><span>${esc(texto)}</span></div>`;
    }
    return `<button type="button" class="kb-card-origem kb-card-origem-meta" onclick="event.stopPropagation();abrirMeta('${g.id}')" title="Abrir a meta" aria-label="Abrir a meta ${esc(g.title)}: ${esc(p.longo)}"><span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span><span>${esc(texto)}</span></button>`;
  }
  const r = state.routines.find(x=>x.id === t.routine_id);
  return `<div class="kb-card-origem" title="Gerada por uma rotina">${ICONE_REPETE}<span>${r ? esc(diasCurtos(r.weekdays)) : 'rotina'}</span></div>`;
}

function renderKbCard(t, col, opts){
  opts = opts || {};
  const badge = t.priority === 'urgent' ? '<span class="priority-badge urgent">Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
  const doneCls = col.type === 'done' ? 'done' : '';
  const extraBadge = opts.badge ? opts.badge(t) : '';
  const draggable = opts.draggable === false ? false : (!state.selecting && canEditTask(t));
  const dragAttrs = draggable ? `ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)"` : '';
  return `
    <div class="kb-card ${doneCls} ${state.selected.has(t.id)?'is-selected':''}" style="--col-color:${taskColor(t)}" draggable="${draggable}" ${dragAttrs} role="button" tabindex="0" onclick="cardClick(event,'${t.id}')">
      ${state.selecting ? `<span class="kb-card-check">${state.selected.has(t.id)?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><polyline points="20 6 9 17 4 12"/></svg>':''}</span>` : ''}
      ${t.client && !opts.clientInMeta ? `<div class="kb-card-client">${esc(t.client)}</div>` : ''}
      <div class="kb-card-title">${esc(t.title)}</div>
      ${origemDoCartao(t)}
      ${extraBadge}
      ${renderTagChipsInline(t, 3)}
      <div class="kb-card-meta">
        ${opts.clientInMeta && t.client ? `<span class="kb-card-cliente">${esc(t.client)}</span>` : ''}
        ${(col.type === 'done' && state.hideDateOnDone) ? '' : `<span class="${taskDateStatus(t)}">${dataDoCartao(t)}</span>`}
        ${badge}
      </div>
    </div>`;
}

// Tarefa de rotina do dia mostra "hoje": o "13/10" de toda manhã não dizia
// nada que a coluna já não dissesse.
function dataDoCartao(t){
  if(!t.date) return 'sem prazo';
  if(t.routine_id && t.date === todayIso()) return t.time ? `hoje · ${esc(t.time.slice(0, 5))}` : 'hoje';
  return dateWithTime(t);
}

function matchesKanbanFilters(t){
  if(state.filter.kanbanClient && t.client !== state.filter.kanbanClient) return false;
  if(state.filter.kanbanTag && !taskHasTag(t, state.filter.kanbanTag)) return false;
  if(state.filter.kanbanDate && state.filter.kanbanDate !== 'all' && !matchesDateFilter(t, state.filter.kanbanDate)) return false;
  if(!matchesKanbanSearch(t, state.filter.kanbanSearch)) return false;
  return true;
}

function renderKanban(){
  const cols = getColumns();
  const clientOptions = [...new Set(personalTasks().map(t=>t.client).filter(Boolean))].sort();
  const tagOptions = tagsInList([...personalTasks(), ...state.tasks.filter(t=>t.project_id)]);
  const filteredTasks = personalTasks().filter(matchesKanbanFilters);
  // As colunas compartilhadas abaixo mostram o quadro inteiro do projeto —
  // atribuído a mim ou não — por isso partem de state.tasks, não de
  // personalTasks() (que só traz o que é meu).
  const sharedFilteredTasks = state.tasks.filter(t=>t.project_id && !ehEvento(t) && matchesKanbanFilters(t));
  const normalColsHtml = cols.map(col=>{
    const list = sortByDateThenPriority(filteredTasks.filter(t=>statusVisivel(t, cols)===col.key && !isHiddenFromKanban(t) && !t.project_id));
    const collapsed = col.hidden && !state.expandedCols.has(col.key);
    if(collapsed){
      return `
        <div class="glass kb-col kb-col-collapsed" data-status="${col.key}" role="button" tabindex="0" onclick="toggleColExpanded('${col.key}')" title="Coluna oculta — toque para abrir">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          <div class="kb-col-collapsed-label"><span class="kb-col-dot" style="background:${corSegura(col.color)}"></span>${esc(col.name)}</div>
          <div class="kb-col-count">${list.length}</div>
        </div>`;
    }
    return `
      <div class="glass kb-col" data-status="${col.key}" ondragover="dragOver(event)" ondrop="drop(event,'${col.key}')" ondragleave="dragLeave(event)">
        <div class="kb-col-head">
          <div class="kb-col-title"><span class="kb-col-dot" style="background:${corSegura(col.color)}"></span>${esc(col.name)}${col.type==='done' ? '<span class="kb-col-hint" title="Concluídos somem toda semana no domingo — o histórico fica registrado no Calendário">↻</span>' : ''}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="kb-col-count">${list.length}</div>
            ${col.hidden ? `<button class="kb-col-collapse-btn" onclick="toggleColExpanded('${col.key}')" title="Recolher coluna">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
            </button>` : ''}
            <div class="kb-col-drag-handle" onpointerdown="colHandlePointerDown(event,'${col.key}')" title="Arrastar para reordenar coluna">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8L22 12L18 16"/><path d="M6 8L2 12L6 16"/><path d="M2 12H22"/></svg>
            </div>
            <button class="kb-col-edit" onclick="openColumnModal('${col.key}')" title="Editar coluna">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
          </div>
        </div>
        <div class="kb-cards">
          ${list.length===0
            ? `<div class="empty" style="padding:28px 8px;font-size:12px;"><strong>Nada aqui</strong>arraste ou crie</div>`
            : list.map(t=>renderKbCard(t, col)).join('')}
        </div>
      </div>`;
  }).join('');

  // Tarefas de projetos compartilhados nunca aparecem misturadas nas colunas
  // pessoais acima — cada projeto ganha sua própria coluna aqui, sempre.
  const projectIds = [...new Set(sharedFilteredTasks.map(t=>t.project_id))];
  const sharedColsHtml = projectIds.map(pid=>{
    const p = state.projects.find(x=>x.id===pid);
    const list = sortByDateThenPriority(sharedFilteredTasks.filter(t=>t.project_id===pid && !isHiddenFromKanban(t)));
    return `
      <div class="glass kb-col kb-col-shared" data-project="${pid}">
        <div class="kb-col-head">
          <div class="kb-col-title">👥 ${esc(p ? p.name : 'Projeto')}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="kb-col-count">${list.length}</div>
            <button class="kb-col-open-btn" onclick="openProjectView('${pid}')" title="Abrir quadro do projeto">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          </div>
        </div>
        <div class="kb-cards">
          ${list.length===0
            ? `<div class="empty" style="padding:28px 8px;font-size:12px;"><strong>Nada aqui</strong></div>`
            : list.map(t=>renderKbCard(t, getColumnForTask(t), {
                draggable: false,
                badge: ()=>`<span class="kb-card-status-pill" style="--pill-color:${taskColumnColor(t)};">${esc(taskColumnName(t))}</span>`
              })).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="view-header">
      <div><div class="eyebrow">Fluxo de trabalho</div><h1>Kanban</h1></div>
      <div class="kanban-header-actions" style="display:flex;gap:10px;">
        <button class="btn-secondary ${state.selecting?'is-active':''}" onclick="toggleSelectMode()" title="Selecionar várias tarefas">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>${state.selecting?'Cancelar':'Selecionar'}
        </button>
        <button class="btn-secondary" onclick="openColumnModal()">+ Nova coluna</button>
        <button class="btn-primary kb-nova-tarefa" onclick="openModal()">+ Nova tarefa</button>
      </div>
    </div>
    ${renderBulkBar()}
    <div class="kanban-filter-row">
      <div class="search-box">
        <svg class="search-box-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="input" id="kf-search" name="kf-search" autocomplete="off" placeholder="Pesquisar tarefas…" aria-label="Pesquisar tarefas" value="${esc(state.filter.kanbanSearch)}">
      </div>
      <select class="select" id="kf-client" style="width:auto;" aria-label="Filtrar por cliente">
        <option value="">Todos clientes</option>
        ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      ${renderTagFilterSelect('kf-tag', tagOptions, state.filter.kanbanTag)}
      <select class="select" id="kf-date" style="width:auto;" aria-label="Filtrar por prazo">
        <option value="all" ${(!state.filter.kanbanDate||state.filter.kanbanDate==='all')?'selected':''}>Qualquer prazo</option>
        <option value="today" ${state.filter.kanbanDate==='today'?'selected':''}>Hoje</option>
        <option value="next3" ${state.filter.kanbanDate==='next3'?'selected':''}>Próximos dias</option>
        <option value="week" ${state.filter.kanbanDate==='week'?'selected':''}>Semana</option>
        <option value="month" ${state.filter.kanbanDate==='month'?'selected':''}>Mês</option>
      </select>
    </div>
    <div class="kanban">
      ${normalColsHtml}
      ${sharedColsHtml}
    </div>`;
}

let ptrDragKey = null;
let ptrDragColEl = null;
let ptrContainer = null;
let ptrStartX = 0, ptrStartY = 0;
let ptrOriginalOrder = null;
let ptrPreviewOrder = null;
let ptrOriginalRects = null;
let ptrProjectId = null;

async function reorderColumns(fromKey, toKey){
  if(fromKey === toKey) return;
  if(!state.columns) state.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  const cols = state.columns;
  const fromIdx = cols.findIndex(c=>c.key===fromKey);
  const toIdx = cols.findIndex(c=>c.key===toKey);
  if(fromIdx === -1 || toIdx === -1) return;
  const [moved] = cols.splice(fromIdx, 1);
  cols.splice(toIdx, 0, moved);
  render();
  await persistColumns();
}

function colHandlePointerDown(e, key, projectId){
  e.preventDefault();
  const colEl = e.currentTarget.closest('.kb-col');
  const container = colEl.closest('.kanban');
  // [data-status] deixa de fora as colunas compartilhadas de projeto do Kanban
  // pessoal: sem chave, elas colidiam no Map de posições e o preview do
  // arrasto empurrava as colunas para o lugar errado.
  const cols = [...container.querySelectorAll(':scope > .kb-col[data-status]')];

  ptrProjectId = projectId || null;
  ptrDragKey = key;
  ptrDragColEl = colEl;
  ptrContainer = container;
  ptrOriginalOrder = cols.map(el=>el.dataset.status);
  ptrPreviewOrder = [...ptrOriginalOrder];
  ptrOriginalRects = new Map(cols.map(el=>[el.dataset.status, el.getBoundingClientRect()]));
  ptrStartX = e.clientX;
  ptrStartY = e.clientY;

  colEl.classList.add('kb-col-lifted');
  container.classList.add('reordering');

  document.addEventListener('pointermove', colHandlePointerMove);
  document.addEventListener('pointerup', colHandlePointerUp, {once:true});
  document.addEventListener('pointercancel', colHandlePointerUp, {once:true});
}

function applyColumnPreview(){
  ptrContainer.querySelectorAll(':scope > .kb-col[data-status]').forEach(el=>{
    if(el === ptrDragColEl) return;
    const key = el.dataset.status;
    const originalRect = ptrOriginalRects.get(key);
    const newIdx = ptrPreviewOrder.indexOf(key);
    const slotRect = ptrOriginalRects.get(ptrOriginalOrder[newIdx]);
    const dx = slotRect.left - originalRect.left;
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  });
}

function colHandlePointerMove(e){
  if(!ptrDragColEl) return;
  const dx = e.clientX - ptrStartX;
  const dy = e.clientY - ptrStartY;
  ptrDragColEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;

  const myRect = ptrOriginalRects.get(ptrDragKey);
  const cx = myRect.left + myRect.width/2 + dx;

  const slotCenters = ptrOriginalOrder.map(k=>{
    const r = ptrOriginalRects.get(k);
    return r.left + r.width/2;
  });
  let idx = 0, best = Infinity;
  slotCenters.forEach((c,i)=>{
    const d = Math.abs(c - cx);
    if(d < best){best = d; idx = i;}
  });

  const newOrder = ptrOriginalOrder.filter(k=>k!==ptrDragKey);
  newOrder.splice(idx, 0, ptrDragKey);
  if(newOrder.join() !== ptrPreviewOrder.join()){
    ptrPreviewOrder = newOrder;
    applyColumnPreview();
  }
}

function colHandlePointerUp(){
  document.removeEventListener('pointermove', colHandlePointerMove);
  const colEl = ptrDragColEl;
  const container = ptrContainer;
  const changed = ptrPreviewOrder && ptrOriginalOrder && ptrPreviewOrder.join() !== ptrOriginalOrder.join();
  const finalOrder = ptrPreviewOrder;

  if(colEl && changed){
    const myOriginal = ptrOriginalRects.get(ptrDragKey);
    const slotIdxInOriginal = ptrOriginalOrder[finalOrder.indexOf(ptrDragKey)];
    const slotRect = ptrOriginalRects.get(slotIdxInOriginal);
    const dx = slotRect.left - myOriginal.left;
    colEl.style.transition = 'transform .18s ease';
    colEl.style.transform = `translate(${dx}px, 0) scale(1)`;
  }

  ptrDragKey = null;

  const projectId = ptrProjectId;

  setTimeout(()=>{
    if(changed){
      if(projectId){
        applyProjectColumnOrder(projectId, finalOrder);
        skipEntranceOnce = true;
        render();
        persistProjectColumns(projectId, getProjectColumns(state.projects.find(x=>x.id===projectId)));
      }else{
        applyColumnOrder(finalOrder);
        skipEntranceOnce = true;
        render();
        persistColumns();
      }
    }else{
      if(colEl){
        colEl.classList.remove('kb-col-lifted');
        colEl.style.transition = '';
        colEl.style.transform = '';
      }
      if(container){
        container.classList.remove('reordering');
        container.querySelectorAll(':scope > .kb-col').forEach(el=>{ el.style.transform = ''; });
      }
    }
  }, changed ? 180 : 0);

  ptrDragColEl = null; ptrContainer = null;
  ptrOriginalOrder = null; ptrPreviewOrder = null; ptrOriginalRects = null; ptrProjectId = null;
}

function applyColumnOrder(orderedKeys){
  if(!state.columns) state.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  const byKey = {};
  state.columns.forEach(c=>{byKey[c.key]=c;});
  const reordered = orderedKeys.map(k=>byKey[k]).filter(Boolean);
  state.columns.forEach(c=>{ if(!reordered.includes(c)) reordered.push(c); });
  state.columns = reordered;
}

function applyProjectColumnOrder(projectId, orderedKeys){
  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return;
  const cols = getProjectColumns(p);
  const byKey = {};
  cols.forEach(c=>{byKey[c.key]=c;});
  const reordered = orderedKeys.map(k=>byKey[k]).filter(Boolean);
  cols.forEach(c=>{ if(!reordered.includes(c)) reordered.push(c); });
  p.columns = reordered;
}

function dragStart(e, id){
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(()=>e.target.classList.add('dragging'), 0);
}
function dragEnd(e){
  e.target.classList.remove('dragging');
}
function dragOver(e){
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function dragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
async function drop(e, status){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain');
  const task = state.tasks.find(t=>t.id===id);
  // Texto arrastado de fora, ou cartão de outro quadro: a coluna precisa
  // existir no quadro da própria tarefa.
  if(!task || !canEditTask(task) || !columnsForTask(task).some(c=>c.key===status)) return;
  if(task.status !== status){
    const prevStatus = task.status;
    const prevCompletedAt = task.completed_at;
    task.completed_at = resolveCompletedAt(status, prevStatus, task.completed_at, columnsForTask(task));
    task.status = status;
    render();
    const ok = await updateTaskRemote(id, task);
    if(!ok){task.status = prevStatus;task.completed_at = prevCompletedAt;render();}
    else if(task.completed_at !== prevCompletedAt) syncTaskToGoogle(task);
  }
}


// Concluída vai para o dia em que foi concluída; o resto, para o prazo.
// Sem nenhum dos dois, a tarefa não tem lugar no calendário.
function calDateKey(t){
  const isDone = taskColumnType(t) === 'done';
  return (isDone && t.completed_at) ? isoDateFromTimestamp(t.completed_at) : (t.date || null);
}

function groupTasksByCalDate(tasks){
  const byDate = {};
  tasks.forEach(t=>{
    const key = calDateKey(t);
    if(key){if(!byDate[key]) byDate[key] = [];byDate[key].push(t);}
  });
  return byDate;
}

// Cabeçalho do mês e grade — iguais no calendário pessoal e no do projeto.
// taskTitle diz o que vai no title de cada tarefa (o projeto acrescenta o
// responsável).
function renderCalMonth(d, tasksByDate, selectedIso, taskTitle){
  const year = d.getFullYear(), month = d.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const dow = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const dowShort = DIAS_CURTOS_CAP;
  const meses = MESES_LONGOS_CAP;
  const today = new Date();

  let cells = '';
  const prevMonthDays = new Date(year, month, 0).getDate();
  for(let i=startDow-1;i>=0;i--) cells += `<div class="cal-cell other"><div class="cal-cell-num">${prevMonthDays-i}</div></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getDate()===day && today.getMonth()===month && today.getFullYear()===year;
    const isSelected = selectedIso === iso;
    const list = tasksByDate[iso] || [];
    const wd = (startDow + day - 1) % 7;
    cells += `
      <div class="cal-cell ${isToday?'today':''} ${isSelected?'selected':''} ${list.length===0?'is-empty':''}" data-date="${iso}">
        <div class="cal-cell-num"><span class="cal-cell-dow">${dowShort[wd]} </span>${day}</div>
        ${list.map(t=>{
          const isDone = taskColumnType(t)==='done';
          return `<div class="cal-task" style="border-left-color:${taskColumnColor(t)};${isDone?'opacity:0.6;':''}" data-task-id="${t.id}" title="${esc(taskTitle(t))}${isDone?' (concluída)':''}">${isDone?'✓ ':''}${esc(t.title)}</div>`;
        }).join('')}
      </div>`;
  }
  const filled = startDow + daysInMonth;
  const trailing = (7 - filled % 7) % 7;
  for(let i=1;i<=trailing;i++) cells += `<div class="cal-cell other"><div class="cal-cell-num">${i}</div></div>`;

  return `
      <div class="cal-view-head">
        <div class="cal-view-title">${meses[month]} ${year}</div>
        <div class="cal-view-nav">
          <button onclick="calNav(-1)">← Anterior</button>
          <button onclick="calToday()">Hoje</button>
          <button onclick="calNav(1)">Próximo →</button>
        </div>
      </div>
      <div class="cal-grid">
        ${dow.map(d=>`<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>`;
}

function calMonthIsEmpty(d, tasksByDate){
  const prefix = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return !Object.keys(tasksByDate).some(iso => iso.startsWith(prefix));
}

function renderCalendar(){
  const d = state.calDate;
  const meses = MESES_LONGOS_CAP;
  const tasksByDate = groupTasksByCalDate(personalTasks());

  const dayPanel = state.calSelectedDate ? renderDayPanel(state.calSelectedDate, tasksByDate[state.calSelectedDate] || []) : '';
  const emptyMonthHint = calMonthIsEmpty(d, tasksByDate) ? `<div class="empty cal-empty-mobile" style="margin-top:10px;"><strong>Nada agendado em ${meses[d.getMonth()].toLowerCase()}.</strong>Toque em um dia pra criar uma tarefa.</div>` : '';

  const connected = isGoogleConnected();
  const gcalBanner = connected ? (isGoogleExpiringSoon() ? `
    <div class="gcal-banner warn">
      <svg class="gcal-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div class="gcal-banner-text">
        <strong>Sua conexão com o Google vai expirar em breve</strong>
        <span>Conta em modo teste no Google — a conexão dura só 7 dias e depois precisa reconectar. Clique para renovar agora e não perder sincronizações.</span>
      </div>
      <button class="btn-primary" onclick="connectGoogleCalendar()">Reconectar</button>
    </div>` : '') : `
    <div class="gcal-banner">
      <svg class="gcal-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <div class="gcal-banner-text">
        <strong>Conecte seu Google Calendar</strong>
        <span>Suas tarefas viram eventos na agenda, e os compromissos da agenda viram tarefas aqui.</span>
      </div>
      <button class="btn-primary" onclick="connectGoogleCalendar()">Conectar</button>
    </div>`;

  return `
    <div class="view-header">
      <div><div class="eyebrow">Prazos e agenda</div><h1>Calendário</h1></div>
      <div style="display:flex;gap:10px;align-items:center;">
        ${connected ? `<button class="btn-secondary" id="cal-sync-btn" onclick="syncCalendarNow()" title="Buscar novidades no Google Calendar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>Sincronizar
        </button>` : ''}
        <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
      </div>
    </div>
    ${gcalBanner}
    <div class="glass cal-view">
      ${renderCalMonth(d, tasksByDate, state.calSelectedDate, t=>t.title)}
      ${emptyMonthHint}
      ${calSyncing ? `
      <div class="cal-sync-overlay">
        <div class="cal-sync-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          <span>Sincronizando</span>
        </div>
      </div>` : ''}
    </div>
    ${dayPanel}`;
}

// opts.projectId: painel do calendário de um projeto. opts.canEdit: falso para
// visualizador, que não pode criar tarefa ali.
function renderDayPanel(iso, tasks, opts){
  const o = opts || {};
  const canAdd = o.canEdit !== false;
  const [y,m,d] = iso.split('-');
  const dt = new Date(+y, +m-1, +d);
  const dias = DIAS_LONGOS;
  const meses = MESES_LONGOS;
  const dateLabel = `${dias[dt.getDay()]}, ${+d} de ${meses[+m-1]}`;

  return `
    <div class="glass day-panel">
      <div class="day-panel-head">
        <div class="day-panel-date">${dateLabel}</div>
        <div class="day-panel-actions">
          ${canAdd ? `<button class="btn-primary" onclick="openModal(null,'${iso}'${o.projectId ? `,'${o.projectId}','evento'` : ''})">+ Adicionar neste dia</button>` : ''}
          <button class="day-panel-close" onclick="selectCalDay(null)" title="Fechar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      ${tasks.length===0
        ? `<div class="empty"><strong>Nada agendado neste dia.</strong>${canAdd ? 'Clica em "Adicionar neste dia" pra criar uma tarefa.' : ''}</div>`
        : `<div class="day-panel-tasks">
            ${tasks.map(t=>{
              const priorityBadge = t.priority === 'urgent' ? '<span class="priority-badge urgent">Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
              const assignee = o.projectId ? getAssigneeLabel(t) : null;
              return `
                <div class="day-task ${taskColumnType(t)==='done'?'done':''}" style="--col-color:${taskColumnColor(t)}" role="button" tabindex="0" onclick="openModal('${t.id}')">
                  <div class="day-task-head">
                    <div class="day-task-title">${esc(t.title)}</div>
                    ${priorityBadge}
                  </div>
                  <div class="day-task-meta">
                    <span>${esc(t.client || 'sem cliente')}</span>
                    <span>·</span>
                    <span>${esc(taskColumnName(t))}</span>
                    ${assignee ? `<span>·</span><span>👤 ${esc(assignee)}</span>` : ''}
                  </div>
                  ${t.notes ? `<div class="day-task-notes">${esc(t.notes)}</div>` : ''}
                </div>`;
            }).join('')}
          </div>`
      }
    </div>`;
}

// O calendário do projeto guarda mês e dia selecionado à parte: navegar num não
// mexe no outro, e o dia aberto no pessoal não aparece aberto no projeto.
function calStateKeys(){
  return state.view === 'project'
    ? {date:'projCalDate', selected:'projCalSelectedDate'}
    : {date:'calDate', selected:'calSelectedDate'};
}

function selectCalDay(iso){
  const k = calStateKeys().selected;
  state[k] = (state[k] === iso) ? null : iso;
  render();
  if(state[k]){
    setTimeout(()=>{
      const panel = document.querySelector('.day-panel');
      if(panel) panel.scrollIntoView({behavior:'smooth', block:'nearest'});
    }, 50);
  }
}

function calNav(delta){
  const d = state[calStateKeys().date];
  d.setDate(1);
  d.setMonth(d.getMonth()+delta);
  render();
}
function calToday(){state[calStateKeys().date] = new Date();render();}

function renderTable(){
  const projectFilter = state.filter.project || '';
  const selectedProject = projectFilter ? state.projects.find(p=>p.id===projectFilter) : null;

  let baseTasks;
  if(selectedProject){
    baseTasks = state.tasks.filter(t=>t.project_id===selectedProject.id && !ehEvento(t));
  } else {
    baseTasks = personalTasks();
  }

  const clientes = [...new Set(baseTasks.map(t=>t.client).filter(Boolean))].sort();
  const tagOptions = tagsInList(baseTasks);

  let filtered = baseTasks;
  if(state.filter.status) filtered = filtered.filter(t=>t.status===state.filter.status);
  if(state.filter.client) filtered = filtered.filter(t=>t.client===state.filter.client);
  if(state.filter.tag) filtered = filtered.filter(t=>taskHasTag(t, state.filter.tag));
  if(selectedProject && state.filter.assignee){
    if(state.filter.assignee === 'unassigned'){
      filtered = filtered.filter(t=>!t.assigned_to);
    } else {
      filtered = filtered.filter(t=>t.assigned_to===state.filter.assignee);
    }
  }
  if(state.filter.tableDate && state.filter.tableDate !== 'all'){
    filtered = filtered.filter(t=>matchesDateFilter(t, state.filter.tableDate));
  }
  if(state.filter.search){
    const s = state.filter.search.toLowerCase();
    filtered = filtered.filter(t=>(t.title||'').toLowerCase().includes(s) || (t.client||'').toLowerCase().includes(s) || (t.notes||'').toLowerCase().includes(s));
  }
  // Aqui é o arquivo de tudo: o prazo mais recente em cima, descendo para as
  // mais antigas. Sem prazo vai para o fim.
  filtered = sortByDateThenPriority(filtered).sort((a, b)=>{
    if(!a.date || !b.date) return (a.date ? 0 : 1) - (b.date ? 0 : 1);
    return b.date.localeCompare(a.date);
  });

  const myProjects = state.projects;
  const assigneeOptions = selectedProject ? [
    {id:'', label:'Todas as pessoas'},
    {id:'unassigned', label:'Sem atribuição'},
    {id: selectedProject.owner_id, label: (selectedProject.ownerProfile && selectedProject.ownerProfile.name) || selectedProject.owner_email || 'Dono'},
    ...selectedProject.members.filter(m=>m.status==='accepted' && m.user_id).map(m=>({id:m.user_id, label:(m.profile && m.profile.name) || m.invited_email || 'Membro'}))
  ] : [];

  return `
    <div class="view-header">
      <div><div class="eyebrow">Visão completa</div><h1>Todas as tarefas</h1></div>
      <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
    </div>
    <div class="glass table-view">
      <div class="table-filters">
        <input type="search" class="input search" id="f-search" name="f-search" autocomplete="off" placeholder="Buscar por título, cliente ou notas…" value="${esc(state.filter.search)}">
        <select class="select" id="f-project" style="width:auto;">
          <option value="">Pessoal (minhas tarefas)</option>
          ${myProjects.map(p=>`<option value="${p.id}" ${projectFilter===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        ${selectedProject ? `
        <select class="select" id="f-assignee" style="width:auto;">
          ${assigneeOptions.map(o=>`<option value="${o.id}" ${state.filter.assignee===o.id?'selected':''}>${esc(o.label)}</option>`).join('')}
        </select>` : ''}
        <select class="select" id="f-status" style="width:auto;">
          <option value="">Todos status</option>
          ${(selectedProject ? getProjectColumns(selectedProject) : getColumns()).map(c=>`<option value="${c.key}" ${state.filter.status===c.key?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select class="select" id="f-client" style="width:auto;">
          <option value="">Todos clientes</option>
          ${clientes.map(c=>`<option value="${esc(c)}" ${state.filter.client===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        ${renderTagFilterSelect('f-tag', tagOptions, state.filter.tag)}
        <select class="select" id="f-table-date" style="width:auto;">
          <option value="all" ${(!state.filter.tableDate || state.filter.tableDate==='all')?'selected':''}>Qualquer prazo</option>
          <option value="today" ${state.filter.tableDate==='today'?'selected':''}>Hoje</option>
          <option value="next3" ${state.filter.tableDate==='next3'?'selected':''}>Próximos dias</option>
          <option value="week" ${state.filter.tableDate==='week'?'selected':''}>Semana</option>
          <option value="month" ${state.filter.tableDate==='month'?'selected':''}>Mês</option>
        </select>
      </div>
      ${filtered.length===0
        ? `<div class="empty" style="margin:28px;"><strong>Nenhuma tarefa encontrada</strong>Ajuste os filtros ou crie uma nova.</div>`
        : `<div class="table-scroll"><table class="task-table">
            <thead><tr><th>Tarefa</th><th>Cliente</th>${selectedProject ? '<th>Atribuída a</th>' : ''}<th>Status</th><th>Prazo</th></tr></thead>
            <tbody>
              ${filtered.map(t=>`
                <tr onclick="openModal('${t.id}')">
                  <td>${esc(t.title)}${renderTagChipsInline(t, 4)}</td>
                  <td>${esc(t.client || '—')}</td>
                  ${selectedProject ? `<td>${esc(getAssigneeLabel(t) || 'Todo mundo')}</td>` : ''}
                  <td><span class="badge"><span class="badge-dot" style="background:${taskColumnColor(t)}"></span>${esc(taskColumnName(t))}</span></td>
                  <td>${t.date ? fmtDateFull(t.date) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>`
      }
    </div>`;
}

function attachEvents(){
  const notesEl = document.getElementById('project-notes-editor');
  if(notesEl && notesEl.isContentEditable){
    notesEl.onpaste = (e)=>{
      e.preventDefault();
      const cb = e.clipboardData;
      const html = cb ? cb.getData('text/html') : '';
      const text = cb ? cb.getData('text/plain') : '';
      if(html) document.execCommand('insertHTML', false, sanitizeNotesHtml(html));
      else if(text) document.execCommand('insertText', false, text);
      scheduleProjectNotesSave();
    };
  }
  document.querySelectorAll('.status-item .val[data-count]').forEach(el=>{
    animateCount(el, parseInt(el.dataset.count, 10) || 0);
  });
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el=>{el.onclick = ()=>{
    flushNotesIfPending();
    // Sem isto o modo de seleção continua ligado numa tela que não o mostra.
    state.selecting = false;
    state.selected.clear();
    state.view = el.dataset.view;
    render();
    window.scrollTo(0,0);
  };});
  const fs = document.getElementById('f-search');
  if(fs) fs.oninput = (e)=>{state.filter.search = e.target.value;skipEntranceOnce=true;render();};
  const fst = document.getElementById('f-status');
  if(fst) fst.onchange = (e)=>{state.filter.status = e.target.value;skipEntranceOnce=true;render();};
  const fc = document.getElementById('f-client');
  if(fc) fc.onchange = (e)=>{state.filter.client = e.target.value;skipEntranceOnce=true;render();};
  const fp = document.getElementById('f-project');
  if(fp) fp.onchange = (e)=>{state.filter.project = e.target.value;state.filter.status='';state.filter.client='';state.filter.assignee='';state.filter.tag='';skipEntranceOnce=true;render();};
  const ftg = document.getElementById('f-tag');
  if(ftg) ftg.onchange = (e)=>{state.filter.tag = e.target.value;skipEntranceOnce=true;render();};
  const fa = document.getElementById('f-assignee');
  if(fa) fa.onchange = (e)=>{state.filter.assignee = e.target.value;skipEntranceOnce=true;render();};
  const ftd = document.getElementById('f-table-date');
  if(ftd) ftd.onchange = (e)=>{state.filter.tableDate = e.target.value;skipEntranceOnce=true;render();};

  const kfc = document.getElementById('kf-client');
  if(kfc) kfc.onchange = (e)=>{state.filter.kanbanClient = e.target.value;skipEntranceOnce=true;render();};
  const kfd = document.getElementById('kf-date');
  if(kfd) kfd.onchange = (e)=>{state.filter.kanbanDate = e.target.value;skipEntranceOnce=true;render();};
  const kft = document.getElementById('kf-tag');
  if(kft) kft.onchange = (e)=>{state.filter.kanbanTag = e.target.value;skipEntranceOnce=true;render();};
  const kfa = document.getElementById('kf-assignee');
  if(kfa) kfa.onchange = (e)=>{state.filter.kanbanAssignee = e.target.value;skipEntranceOnce=true;render();};
  const kfs = document.getElementById('kf-search');
  if(kfs) kfs.oninput = (e)=>{state.filter.kanbanSearch = e.target.value;skipEntranceOnce=true;render();};

  document.querySelectorAll('.cal-cell[data-date]').forEach(cell=>{
    cell.addEventListener('click', (e)=>{
      const taskEl = e.target.closest('.cal-task');
      if(taskEl){
        openModal(taskEl.dataset.taskId);
        return;
      }
      selectCalDay(cell.dataset.date);
    });
  });
}

let selectedTaskColor = null;

function renderTaskColorSwatches(){
  const wrap = document.getElementById('m-color-swatches');
  if(!wrap) return;
  const none = `
    <button type="button" role="radio" aria-checked="${!selectedTaskColor}" class="task-color-btn task-color-none ${!selectedTaskColor?'selected':''}"
      onclick="selectTaskColor(null)" title="Sem cor própria (usa a cor da coluna)" aria-label="Sem cor própria, usa a cor da coluna">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/></svg>
    </button>`;
  wrap.innerHTML = none + EVENT_COLORS.map(c=>`
    <button type="button" role="radio" aria-checked="${selectedTaskColor===c.id}" class="task-color-btn${corEhClara(c.hex) ? ' claro' : ''} ${selectedTaskColor===c.id?'selected':''}"
      style="--sw:${c.hex}" onclick="selectTaskColor('${c.id}')" title="${c.name}" aria-label="${c.name}"></button>
  `).join('');
}

function selectTaskColor(id){
  const wrap = document.getElementById('m-color-swatches');
  const tinhaFoco = wrap && wrap.contains(document.activeElement);
  selectedTaskColor = id;
  renderTaskColorSwatches();
  // Redesenhar troca os botões: devolve o foco ao escolhido para quem usa teclado.
  if(tinhaFoco){
    const sel = wrap.querySelector('.task-color-btn.selected');
    if(sel) sel.focus();
  }
}

// Sem Calendar conectado o interruptor aparece desligado e travado: escondê-lo
// deixava a impressão de que a opção não existe. Precisa rodar DEPOIS do laço
// que habilita os campos do modal, senão ele desfaz o travamento.
function setupGcalToggle(task, canEdit){
  const field = document.getElementById('m-gcal-field');
  const input = document.getElementById('m-gcal');
  if(!field || !input) return;
  field.style.display = '';
  const connected = isGoogleConnected();
  input.checked = connected && (task ? wantsGoogle(task) : true);
  input.disabled = !connected || !canEdit;
  updateGcalHint();
}

function updateGcalHint(){
  const hint = document.getElementById('m-gcal-hint');
  const input = document.getElementById('m-gcal');
  if(!hint || !input) return;
  if(!isGoogleConnected()){
    hint.textContent = 'Conecte sua agenda nas Configurações.';
    return;
  }
  if(!input.checked){
    const t = state.editingId ? state.tasks.find(x=>x.id===state.editingId) : null;
    const mirrored = t && wantsGoogle(t) && getEventId(t);
    // Numa tarefa que veio do Google o compromisso real fica de pé; só o
    // vínculo se desfaz. Dizer "sai da agenda" ali seria mentira.
    hint.textContent = !mirrored ? 'Fica só aqui no app.'
      : t.from_google ? 'Solta o vínculo ao salvar.'
      : 'O evento sai da agenda ao salvar.';
    return;
  }
  const hasDate = !!document.getElementById('m-date').value;
  hint.textContent = hasDate
    ? 'Cria o evento na sua agenda.'
    : 'Defina um prazo acima.';
}

/* ---------- Tags ---------- */
// Não existe tabela de tags: as tags de um projeto são as que já estão nas
// tarefas dele, então todo mundo do projeto reaproveita as mesmas. A cor sai
// do nome, igual para todos os membros e em todos os temas.

let selectedTaskTags = [];

function normalizeTag(raw){
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function tagKey(tag){
  return normalizeTag(tag).toLowerCase();
}

function taskHasTag(t, tag){
  const k = tagKey(tag);
  return (t.tags || []).some(x=>tagKey(x) === k);
}

function tagHue(tag){
  const k = tagKey(tag);
  let h = 0;
  for(let i=0;i<k.length;i++) h = (h * 31 + k.charCodeAt(i)) % 360;
  return h;
}

function tagStyle(tag){
  return `--tag-color:hsl(${tagHue(tag)} 55% 52%)`;
}

// Junta as tags de uma lista de tarefas sem repetir maiúscula/minúscula,
// mantendo a grafia que apareceu primeiro.
function tagsInList(tasks){
  const vistos = new Map();
  tasks.forEach(t=>(t.tags || []).forEach(tag=>{
    const k = tagKey(tag);
    if(k && !vistos.has(k)) vistos.set(k, normalizeTag(tag));
  }));
  return [...vistos.values()].sort((a,b)=>a.localeCompare(b, 'pt-BR'));
}

function tagsForModalScope(){
  const projectId = document.getElementById('m-project').value || null;
  const lista = projectId
    ? state.tasks.filter(t=>t.project_id === projectId)
    : state.tasks.filter(t=>!t.project_id && t.owner_id === session.user.id);
  return tagsInList(lista);
}

function renderTagChipsInline(t, max){
  const tags = t.tags || [];
  if(!tags.length) return '';
  const visiveis = tags.slice(0, max);
  const resto = tags.length - visiveis.length;
  return `<div class="tag-row">${visiveis.map(tag=>`<span class="tag-chip" style="${tagStyle(tag)}">${esc(tag)}</span>`).join('')}${resto > 0 ? `<span class="tag-chip tag-chip-more">+${resto}</span>` : ''}</div>`;
}

function renderTagFilterSelect(id, options, current){
  if(!options.length && !current) return '';
  return `<select class="select" id="${id}" style="width:auto;" aria-label="Filtrar por tag">
    <option value="">Todas as tags</option>
    ${options.map(tag=>`<option value="${esc(tag)}" ${tagKey(current)===tagKey(tag)?'selected':''}>🏷️ ${esc(tag)}</option>`).join('')}
  </select>`;
}

function renderTaskTagChips(){
  const wrap = document.getElementById('m-tags-chips');
  if(!wrap) return;
  const input = document.getElementById('m-tag-input');
  const travado = input && input.disabled;
  wrap.innerHTML = selectedTaskTags.map((tag, i)=>`
    <span class="tag-chip tag-chip-edit" style="${tagStyle(tag)}">${esc(tag)}<button type="button" class="tag-chip-remove" data-i="${i}" aria-label="Remover tag ${esc(tag)}" ${travado ? 'disabled' : ''}>×</button></span>`).join('');
  wrap.querySelectorAll('.tag-chip-remove').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      selectedTaskTags.splice(+btn.dataset.i, 1);
      renderTaskTagChips();
      document.getElementById('m-tag-input').focus();
    };
  });
}

function addTaskTag(raw){
  const tag = normalizeTag(raw);
  if(!tag) return;
  if(selectedTaskTags.some(x=>tagKey(x) === tagKey(tag))) return;
  // Reaproveita a grafia que o projeto já usa ("marketing" vira "Marketing").
  const existente = tagsForModalScope().find(x=>tagKey(x) === tagKey(tag));
  selectedTaskTags.push(existente || tag);
  renderTaskTagChips();
}

function commitTagInput(){
  const input = document.getElementById('m-tag-input');
  if(!input || !input.value.trim()) return;
  addTaskTag(input.value);
  input.value = '';
}

function tagInputKeydown(e){
  const input = e.target;
  if(e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && input.value.trim())){
    e.preventDefault();
    commitTagInput();
    filterTagSuggestions();
  } else if(e.key === 'Backspace' && !input.value && selectedTaskTags.length){
    selectedTaskTags.pop();
    renderTaskTagChips();
    filterTagSuggestions();
  } else if(e.key === 'Escape'){
    hideTagSuggestions();
  }
}

function filterTagSuggestions(){
  const input = document.getElementById('m-tag-input');
  const wrap = document.getElementById('tag-suggestions');
  if(!input || !wrap || input.disabled) return;
  const q = tagKey(input.value);
  const usadas = new Set(selectedTaskTags.map(tagKey));
  const existentes = tagsForModalScope();
  const matches = existentes.filter(tag=>!usadas.has(tagKey(tag)) && (!q || tagKey(tag).includes(q))).slice(0, 8);
  const nova = q && !existentes.some(tag=>tagKey(tag) === q) && !usadas.has(q);
  if(!matches.length && !nova){ hideTagSuggestions(); return; }
  wrap.innerHTML = matches.map(tag=>`<div class="client-suggestion-item tag-suggestion-item" role="option" tabindex="-1" data-tag="${esc(tag)}"><span class="tag-chip" style="${tagStyle(tag)}">${esc(tag)}</span></div>`).join('')
    + (nova ? `<div class="client-suggestion-item tag-suggestion-item" role="option" tabindex="-1" data-tag="${esc(normalizeTag(input.value))}">Criar <span class="tag-chip" style="${tagStyle(input.value)}">${esc(normalizeTag(input.value))}</span></div>` : '');
  wrap.querySelectorAll('.tag-suggestion-item').forEach(el=>{
    el.onmousedown = (e)=>{
      e.preventDefault();
      addTaskTag(el.dataset.tag);
      input.value = '';
      filterTagSuggestions();
    };
  });
  wrap.classList.add('open');
}

function hideTagSuggestions(){
  const wrap = document.getElementById('tag-suggestions');
  if(wrap){ wrap.classList.remove('open'); wrap.innerHTML = ''; }
}

// Tarefa ou evento, só dentro de projeto. Fora de projeto é sempre tarefa.
let tipoItemModal = 'tarefa';

function escolherTipoItem(k){
  tipoItemModal = k === 'evento' ? 'evento' : 'tarefa';
  aplicarTipoItem();
}

function aplicarTipoItem(){
  const projeto = document.getElementById('m-project').value || null;
  const disponivel = !!projeto && state.temTipoEvento !== false;
  if(!disponivel) tipoItemModal = 'tarefa';
  const evento = tipoItemModal === 'evento';
  document.getElementById('m-kind-field').style.display = disponivel ? '' : 'none';
  document.querySelectorAll('#m-kind-field .tk-tipo-btn').forEach(b=>{
    const sel = b.dataset.kind === tipoItemModal;
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-checked', sel);
  });
  document.getElementById('m-kind-hint').textContent = evento
    ? 'Aparece na Visão geral e no Calendário do projeto, fora do quadro.'
    : 'Vai para o quadro do projeto.';
  // Evento não tem coluna, prioridade nem responsável.
  document.getElementById('m-status-field').style.display = evento ? 'none' : '';
  document.getElementById('m-priority-field').style.display = evento ? 'none' : '';
  if(evento) document.getElementById('m-assignee-field').style.display = 'none';
  else if(projeto) populateAssigneeSelect(projeto, document.getElementById('m-assignee').value || null);
  document.getElementById('m-title').placeholder = evento ? 'Nome do evento (ex: Reunião de heads)' : 'O que precisa ser feito?';
  const rotuloData = document.querySelector('label[for="m-date"]');
  if(rotuloData && rotuloData.lastChild) rotuloData.lastChild.textContent = evento ? 'Quando' : 'Prazo';
  const titulo = document.getElementById('modal-title');
  const novo = !state.editingId;
  const somenteLeitura = document.getElementById('m-save').style.display === 'none';
  titulo.textContent = evento
    ? (somenteLeitura ? 'Evento' : novo ? 'Novo evento' : 'Editar evento')
    : (somenteLeitura ? 'Tarefa' : novo ? 'Nova tarefa' : 'Editar tarefa');
}

function openModal(id, prefillDate, prefillProjectId, prefillKind){
  state.editingId = id || null;
  const tarefaAberta = id ? state.tasks.find(x=>x.id===id) : null;
  tipoItemModal = tarefaAberta ? (tarefaAberta.kind || 'tarefa') : (prefillKind === 'evento' ? 'evento' : 'tarefa');
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const delBtn = document.getElementById('m-delete');
  const commentsField = document.getElementById('m-comments-field');
  populateProjectSelect();
  resetRepeatField(!id && !prefillProjectId);
  if(id){
    const t = state.tasks.find(x=>x.id===id);
    if(!t) return;
    title.textContent = 'Editar tarefa';
    document.getElementById('m-title').value = t.title || '';
    document.getElementById('m-client').value = t.client || '';
    populateStatusSelect('m-status', t.status || colunasDe(t.project_id)[0].key, t.project_id);
    document.getElementById('m-date').value = t.date || '';
    document.getElementById('m-time').value = t.time || '';
    document.getElementById('m-priority').value = t.priority || 'normal';
    document.getElementById('m-project').value = t.project_id || '';
    populateAssigneeSelect(t.project_id, t.assigned_to);
    selectedTaskColor = t.color_id || null;
    renderTaskColorSwatches();
    selectedTaskTags = [...(t.tags || [])];
    document.getElementById('m-tag-input').value = '';
    renderTaskTagChips();
    document.getElementById('m-notes').value = t.notes || '';
    const canEdit = canEditTask(t);
    delBtn.style.display = canEdit ? '' : 'none';
    // Visualizador via campos travados mas um "Salvar" ativo: o banco recusava
    // e a mensagem de erro era coberta por "Alterações salvas".
    document.getElementById('m-save').style.display = canEdit ? '' : 'none';
    document.getElementById('m-cancel').textContent = canEdit ? 'Cancelar' : 'Fechar';
    title.textContent = canEdit ? 'Editar tarefa' : 'Tarefa';
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format, #modal .time-clear-btn, #modal .task-color-btn, #modal .tag-chip-remove, #modal .tk-tipo-btn').forEach(el=>{el.disabled = !canEdit;});
    setupGcalToggle(t, canEdit);
    commentsField.style.display = '';
    currentCommentTaskId = id;
    document.getElementById('task-comments-list').innerHTML = `<div class="empty" style="padding:16px 12px;font-size:11.5px;">Carregando…</div>`;
    refreshComments();
  }else{
    title.textContent = 'Nova tarefa';
    document.getElementById('m-title').value = '';
    document.getElementById('m-client').value = '';
    populateStatusSelect('m-status', colunasDe(prefillProjectId)[0].key, prefillProjectId);
    document.getElementById('m-date').value = prefillDate || '';
    // Vinha preenchido com a hora atual. O campo é opcional, mas toda tarefa
    // nova com prazo virava evento com horário aleatório no Google — e uma
    // criada para hoje disparava o alarme no mesmo minuto em que era salva.
    document.getElementById('m-time').value = '';
    document.getElementById('m-priority').value = 'normal';
    document.getElementById('m-project').value = prefillProjectId || '';
    populateAssigneeSelect(prefillProjectId, null);
    selectedTaskColor = null;
    renderTaskColorSwatches();
    selectedTaskTags = [];
    document.getElementById('m-tag-input').value = '';
    renderTaskTagChips();
    document.getElementById('m-notes').value = '';
    delBtn.style.display = 'none';
    document.getElementById('m-save').style.display = '';
    document.getElementById('m-cancel').textContent = 'Cancelar';
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format, #modal .time-clear-btn, #modal .task-color-btn, #modal .tag-chip-remove, #modal .tk-tipo-btn').forEach(el=>{el.disabled = false;});
    setupGcalToggle(null, true);
    commentsField.style.display = 'none';
    currentCommentTaskId = null;
  }
  document.getElementById('m-project').onchange = (e)=>{
    populateStatusSelect('m-status', colunasDe(e.target.value || null)[0].key, e.target.value || null);
    populateAssigneeSelect(e.target.value || null, null);
    // Rotina é só pra tarefa pessoal — escolher um projeto desliga e some com a opção.
    resetRepeatField(!id && !e.target.value);
    aplicarTipoItem();
  };
  aplicarTipoItem();
  modal.classList.add('open');
  setTimeout(()=>document.getElementById('m-title').focus(), 50);
}

// Disponível só ao criar uma tarefa pessoal nova (rotina não existe pra
// tarefa de projeto nem faz sentido reaproveitar ao editar uma já existente).
function resetRepeatField(available){
  const field = document.getElementById('m-repeat-field');
  const checkbox = document.getElementById('m-repeat');
  field.style.display = available ? '' : 'none';
  checkbox.checked = false;
  document.querySelectorAll('#m-repeat-days .weekday-btn').forEach(b=>b.classList.remove('selected'));
  toggleRepeatField();
}

function toggleRepeatField(){
  const checked = document.getElementById('m-repeat').checked;
  document.getElementById('m-repeat-days').style.display = checked ? 'flex' : 'none';
  document.getElementById('m-repeat-hint').style.display = checked ? '' : 'none';
  document.getElementById('m-date-field').style.opacity = checked ? '0.4' : '';
  document.getElementById('m-date').disabled = checked;
}

function toggleWeekdayBtn(el){
  el.classList.toggle('selected');
}

// #m-repeat-days (tarefa nova) e #rt-days (rotina em Configurações) têm
// cada um o seu próprio jogo de botões — nunca ler os dois juntos.
function selectedWeekdays(){
  return [...document.querySelectorAll('#m-repeat-days .weekday-btn.selected')].map(b=>+b.dataset.day);
}

function filterClientSuggestions(){
  const input = document.getElementById('m-client');
  const wrap = document.getElementById('client-suggestions');
  if(!input || !wrap) return;
  const q = input.value.trim().toLowerCase();
  const matches = (state.recentClients || []).filter(c=>!q || c.toLowerCase().includes(q)).slice(0, 8);
  if(matches.length === 0){
    wrap.classList.remove('open');
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = matches.map(c=>{
    const idx = c.toLowerCase().indexOf(q);
    const label = (q && idx >= 0)
      ? `${esc(c.slice(0,idx))}<strong>${esc(c.slice(idx,idx+q.length))}</strong>${esc(c.slice(idx+q.length))}`
      : esc(c);
    // O nome do cliente e texto livre: passa por data- em vez de virar string JS
    // dentro de um atributo, que exigiria escapar HTML e JS ao mesmo tempo.
    return `<div class="client-suggestion-item" role="option" tabindex="-1" data-client="${esc(c)}">${label}</div>`;
  }).join('');
  wrap.querySelectorAll('.client-suggestion-item').forEach(el=>{
    el.onmousedown = ()=> selectClientSuggestion(el.dataset.client);
  });
  wrap.classList.add('open');
}

function selectClientSuggestion(value){
  document.getElementById('m-client').value = value;
  hideClientSuggestions();
}

function hideClientSuggestions(){
  const wrap = document.getElementById('client-suggestions');
  if(wrap){wrap.classList.remove('open');wrap.innerHTML = '';}
}

function populateProjectSelect(){
  const editableProjects = state.projects.filter(p=>mexeEmTarefas(p.id));
  const field = document.getElementById('m-project-field');
  const sel = document.getElementById('m-project');
  if(editableProjects.length === 0){
    field.style.display = 'none';
    sel.innerHTML = '<option value="">Pessoal (privado)</option>';
    return;
  }
  field.style.display = '';
  sel.innerHTML = '<option value="">Pessoal (privado)</option>' + editableProjects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

function populateAssigneeSelect(projectId, currentAssignee){
  const field = document.getElementById('m-assignee-field');
  const sel = document.getElementById('m-assignee');
  if(!projectId){
    field.style.display = 'none';
    sel.innerHTML = '<option value="">Todo mundo do projeto</option>';
    return;
  }
  const p = state.projects.find(x=>x.id===projectId);
  if(!p){field.style.display = 'none';return;}
  field.style.display = '';
  const people = [];
  people.push({id: p.owner_id, label: (p.ownerProfile && p.ownerProfile.name) || p.owner_email || 'Dono', isMe: p.owner_id === session.user.id});
  p.members.filter(m=>m.status==='accepted' && m.user_id).forEach(m=>{
    people.push({id: m.user_id, label: (m.profile && m.profile.name) || m.invited_email || 'Membro', isMe: m.user_id === session.user.id});
  });
  sel.innerHTML = '<option value="">Todo mundo do projeto</option>' + people.map(pe=>`<option value="${pe.id}">${esc(pe.label)}${pe.isMe ? ' (eu)' : ''}</option>`).join('');
  sel.value = currentAssignee || '';
}

function closeModal(){document.getElementById('modal').classList.remove('open');state.editingId = null;currentCommentTaskId = null;}

// Enter duas vezes rápido (ou clique duplo no Salvar) criava a tarefa duas vezes.
let salvandoTarefa = false;

async function saveTask(){
  if(salvandoTarefa) return;
  const title = document.getElementById('m-title').value.trim();
  if(!title){showToast('Dê um título para a tarefa.', 'erro');document.getElementById('m-title').focus();return;}
  // Precisa ser antes de qualquer await: o navegador só mostra o pedido de
  // permissão se ele vier direto de um clique ou tecla.
  if(document.getElementById('m-time').value) pedirPermissaoNotificacao();

  const btn = document.getElementById('m-save');
  salvandoTarefa = true;
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try{
    await salvarTarefaDoModal(title);
  }finally{
    salvandoTarefa = false;
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function salvarTarefaDoModal(title){
  if(!state.editingId && document.getElementById('m-repeat').checked){
    const weekdays = selectedWeekdays();
    if(weekdays.length === 0){showToast('Escolha ao menos um dia da semana.', 'erro');return;}
    const routine = await createRoutine({
      title,
      client: document.getElementById('m-client').value.trim(),
      status: document.getElementById('m-status').value || getColumns()[0].key,
      priority: document.getElementById('m-priority').value,
      time: document.getElementById('m-time').value,
      weekdays
    });
    // Falhou: o modal fica aberto com o que foi digitado (createRoutine já
    // mostrou o erro). Antes fechava e a pessoa perdia tudo.
    if(!routine) return;
    closeModal();render();
    showToast('Rotina criada');
    return;
  }

  // Barreira final: mesmo que algo acima falhe, a tarefa nao vai para o banco
  // sem status — era isso que a fazia sumir.
  const projetoEscolhido = document.getElementById('m-project').value || null;
  const kind = projetoEscolhido && tipoItemModal === 'evento' ? 'evento' : 'tarefa';
  if(kind === 'evento' && !document.getElementById('m-date').value){
    showToast('Escolha o dia do evento.', 'erro');
    document.getElementById('m-date').focus();
    return;
  }
  const existingTask = state.editingId ? state.tasks.find(x=>x.id===state.editingId) : null;
  // Evento fica na primeira coluna do projeto só para o banco ter um status;
  // ele não aparece no quadro.
  const statusEscolhido = kind === 'evento'
    ? (existingTask ? existingTask.status : colunasDe(projetoEscolhido)[0].key)
    : document.getElementById('m-status').value;
  const newStatus = statusEscolhido || colunasDe(projetoEscolhido)[0].key;
  const gcalInput = document.getElementById('m-gcal');
  // Sem Calendar conectado o interruptor fica escondido: aí a tarefa guarda a
  // escolha que já tinha (ou "sim", para quando a conexão vier depois).
  const wantsGcal = isGoogleConnected()
    ? gcalInput.checked
    : (existingTask ? wantsGoogle(existingTask) : true);
  const droppedFromGcal = !wantsGcal && existingTask && wantsGoogle(existingTask);
  commitTagInput();
  const data = {
    title,
    client: document.getElementById('m-client').value.trim(),
    status: newStatus,
    date: document.getElementById('m-date').value,
    time: document.getElementById('m-time').value,
    priority: kind === 'evento' ? 'normal' : document.getElementById('m-priority').value,
    notes: document.getElementById('m-notes').value.trim(),
    color_id: selectedTaskColor,
    sync_google: wantsGcal,
    project_id: projetoEscolhido,
    assigned_to: kind === 'evento' ? null : (document.getElementById('m-assignee').value || null),
    completed_at: resolveCompletedAt(
      newStatus,
      existingTask ? existingTask.status : null,
      existingTask ? existingTask.completed_at : null,
      colunasDe(projetoEscolhido),
      existingTask ? columnsForTask(existingTask) : null
    )
  };
  if(selectedTaskTags.length || (existingTask && existingTask.tags && existingTask.tags.length)) data.tags = [...selectedTaskTags];
  if(state.temTipoEvento !== false) data.kind = kind;
  const isNew = !state.editingId;
  let savedTask = null;
  if(state.editingId){
    const ok = await updateTaskRemote(state.editingId, data);
    if(ok){
      const t = state.tasks.find(x=>x.id===state.editingId);
      if(t){ Object.assign(t, data); savedTask = t; }
    }
  }else{
    const newTask = await createTaskRemote(data);
    if(newTask){state.tasks.push(newTask);savedTask = newTask;}
  }
  // Falhou: mantém o modal aberto com o que foi digitado. Antes ele fechava e
  // o "Tarefa criada" cobria o toast de erro — falha com cara de sucesso.
  if(!savedTask) return;
  closeModal();render();
  showToast(isNew ? (kind === 'evento' ? 'Evento criado' : 'Tarefa criada') : 'Alterações salvas');
  // Desmarcar o interruptor tem que limpar o evento que ficou para trás —
  // syncTaskToGoogle já ignora a tarefa daqui em diante. Vale a mesma regra de
  // apagar a tarefa: se ela veio do Google, o compromisso real fica de pé.
  if(droppedFromGcal) await forgetTaskInGoogle(savedTask);
  else syncTaskToGoogle(savedTask);
}

async function deleteTask(){
  if(!state.editingId) return;
  if(!await confirmar('A tarefa e o evento dela no Google Calendar são removidos.', {title:'Excluir esta tarefa?', okLabel:'Excluir'})) return;
  const t = state.tasks.find(x=>x.id===state.editingId);
  if(t) await forgetTaskInGoogle(t);
  const ok = await deleteTaskRemote(state.editingId);
  if(ok){
    state.tasks = state.tasks.filter(x=>x.id !== state.editingId);
    closeModal();render();
    showToast('Tarefa excluída');
  }
}

// Fecha o modal de cima. Antes o Escape fechava todos de uma vez, e o de
// rotina (aberto por cima das Configurações) nem estava na lista. A ordem no
// DOM é a ordem de empilhamento, então o último aberto é o de cima.
const FECHAR_MODAL = {
  'modal': ()=>closeModal(),
  'settings-modal': ()=>closeSettings(),
  'column-modal': ()=>closeColumnModal(),
  'routine-modal': ()=>closeRoutineModal(),
  'status-modal': ()=>closeStatusModal(),
  'projects-modal': ()=>closeProjectsModal(),
  'config-projeto': ()=>fecharConfigProjeto(),
  'meta-modal': ()=>fecharNovaMeta(),
  'metas-intro-modal': ()=>fecharApresentacaoMetas(),
  'metas-historico-modal': ()=>fecharHistoricoMetas(),
  'chamada-previa': ()=>fecharPreviaChamada(),
  'projeto-rapido': ()=>fecharProjetoRapido(),
  'canal-rapido': ()=>fecharCanalRapido(),
  'icone-projeto': ()=>fecharIconeProjeto(),
  'confirm-modal': ()=>resolveDialog(null)
};
const SALVAR_MODAL = {
  'modal': ()=>saveTask(),
  'column-modal': ()=>saveColumn(),
  'routine-modal': ()=>saveRoutineModal(),
  'meta-modal': ()=>avancarMeta(),
  'confirm-modal': ()=>submitDialog()
};

// Fecha clicando no fundo — mas só se o clique começou no fundo. Selecionar o
// texto de um campo arrastando para fora do modal soltava o mouse no fundo e
// fechava o modal, levando junto o que tinha sido digitado.
document.querySelectorAll('.modal-bg').forEach(bg=>{
  let inicioNoFundo = false;
  bg.addEventListener('mousedown', (e)=>{ inicioNoFundo = e.target === bg; });
  bg.addEventListener('click', (e)=>{
    if(e.target === bg && inicioNoFundo && FECHAR_MODAL[bg.id]) FECHAR_MODAL[bg.id]();
    inicioNoFundo = false;
  });
});

function campoDeTexto(el){
  if(!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const TIPOS_INPUT_ENTER = ['text', 'email', 'search', 'date', 'time', 'url', 'tel', 'number'];

document.addEventListener('keydown', (e)=>{
  // Composição de IME (acentos em alguns teclados, japonês, chinês): o Enter
  // confirma a letra, não é para o app. E campo que já tratou a tecla (o Enter
  // do campo de tags adiciona a tag) não pode também salvar a tarefa.
  if(e.isComposing || e.defaultPrevented) return;
  const topo = topOpenModal();

  if(e.key === 'Escape'){
    if(topo && FECHAR_MODAL[topo.id]){ e.preventDefault(); FECHAR_MODAL[topo.id](); }
    return;
  }

  if(e.key === 'Enter' && topo && SALVAR_MODAL[topo.id]){
    const alvo = e.target;
    // Ctrl/⌘+Enter salva de qualquer campo do modal (inclusive das notas).
    // Enter puro só num campo de uma linha — no textarea ele quebra linha.
    const atalho = (e.metaKey || e.ctrlKey) && topo.contains(alvo);
    const campoSimples = alvo && alvo.tagName === 'INPUT' && TIPOS_INPUT_ENTER.includes(alvo.type) && topo.contains(alvo);
    if((atalho && alvo.id !== 'comment-input') || campoSimples){
      e.preventDefault();
      SALVAR_MODAL[topo.id]();
      return;
    }
  }

  // Enter/Espaço nos <div onclick> marcados por tornarClicaveisAcessiveis.
  if((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset && e.target.dataset.clicavel === '1'){
    e.preventDefault();
    e.target.click();
    return;
  }

  // "N" abre uma tarefa nova. Sem o teste de modificador ele engolia o ⌘N /
  // Ctrl+N do navegador; sem o do <select> ele disparava na busca por letra
  // de um select; e sem o do app visível, na tela de login.
  if((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !topo
     && !campoDeTexto(document.activeElement)
     && document.getElementById('app').style.display !== 'none'){
    e.preventDefault();openModal();
  }
});

// Com a aba escondida o navegador congela os timers e o realtime pode cair
// (notebook dormindo, celular com a tela apagada). Voltar depois de horas
// mostrava dados velhos até alguém clicar em Atualizar.
let escondidaDesde = 0;
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ escondidaDesde = Date.now(); return; }
  const fora = escondidaDesde ? Date.now() - escondidaDesde : 0;
  escondidaDesde = 0;
  if(fora < 60 * 1000 || !session || document.getElementById('app').style.display === 'none') return;
  refreshAll(null, true);
  generateRoutineInstances();
  checkAlarms();
  if(isGoogleConnected()) runGoogleSync();
});

// Nao havia aviso nenhum: fechar a aba com nota em edicao ou modal preenchido
// perdia o conteudo em silencio.
window.addEventListener('beforeunload', (e)=>{
  const notaPendente = !!notesSaveTimer;
  const modalAberto = document.getElementById('modal').classList.contains('open');
  const tituloPreenchido = modalAberto && (document.getElementById('m-title').value || '').trim() !== '';
  if(notaPendente || tituloPreenchido){
    e.preventDefault();
    e.returnValue = '';
  }
});

// ============================================================================
//  Desafio 88 dias — aba pessoal, visível só para a conta dona do desafio.
//  As tabelas também barram outras contas no RLS (supabase/desafio.sql e
//  supabase/desafio_v2.sql).
// ============================================================================

const DESAFIO_EMAIL = 'samirahmadpour@gmail.com';
const DESAFIO_INICIO = '2026-10-05';
const DESAFIO_FIM = '2026-12-31';
const DESAFIO_METAS = {pesoInicial: 73, pesoMeta: 77, dinheiro: 2000, clientes: 3, vagas: 30, kcal: 2800, proteina: 140};
const TODOS_OS_DIAS = [0,1,2,3,4,5,6];
const DESAFIO_ITENS = [
  {key:'academia', label:'Academia', hint:'direto do trabalho', dias:[1,3,4,5]},
  {key:'pesar', label:'Pesar em jejum', hint:'registre em Progresso', dias:[1], auto:true},
  {key:'proteina', label:'140g de proteína', hint:'conta pela comida registrada', dias:TODOS_OS_DIAS, auto:true},
  {key:'agua', label:'3L de água', hint:'4L se treinar', dias:TODOS_OS_DIAS},
  {key:'creatina', label:'Creatina 3–5g', hint:'pós-treino ou almoço', dias:TODOS_OS_DIAS},
  {key:'dev', label:'1h de curso ou freela', hint:'celular longe', dias:[2,5,6]},
  {key:'cs', label:'CS só depois do bloco', hint:'jogo é recompensa', dias:[2,5,6]},
  {key:'revisao', label:'Revisar a semana', hint:'15 min', dias:[0]}
];
const DESAFIO_STATUS_VAGA = [
  {key:'enviada', label:'Enviada'},
  {key:'entrevista', label:'Entrevista'},
  {key:'proposta', label:'Proposta'},
  {key:'recusada', label:'Recusada'}
];

// Metas que entram uma única vez no banco; depois disso são linhas comuns,
// que dá pra concluir, apagar ou somar com outras.
const DESAFIO_SEED_MARK = '__seed_v1';
const DESAFIO_METAS_PADRAO = [
  {label:'Revisar o roteiro do kick off: pauta, próximos passos, o que pedir ao cliente', date:'2026-10-07'},
  {label:'Ensaiar o onboarding em voz alta 2x (mais confiante, menos frio)', date:'2026-10-08'},
  {label:'Teste de onboarding 🎤', date:'2026-10-09'},
  {label:'LinkedIn com o título "Desenvolvedor Front-end"', date:'2026-10-12'},
  {label:'Montar a oferta de freela Nuvemshop com preço fechado', date:'2026-10-16'},
  {label:'GitHub com README e prints do samyest.mind e do CS2 hub', date:'2026-10-19'},
  {label:'Oferecer o freela pra 10 lojas ou contatos', date:'2026-10-26'},
  {label:'Fechar o 1º cliente de freela', date:'2026-10-31'},
  {label:'15 candidaturas de dev enviadas', date:'2026-11-30'},
  {label:'Chegar a 75kg', date:'2026-11-30'},
  {label:'Fechar o 3º cliente de freela', date:'2026-12-31'},
  {label:'Chegar a 77kg e tirar a foto de antes e depois', date:'2026-12-31'}
];

// Módulos do curso, na ordem dele. value = 1 marca a meta como estudo, pra
// ela aparecer na trilha do curso e não na lista de prazos.
const DESAFIO_SEED_ESTUDOS = '__seed_estudos_v1';
const DESAFIO_ESTUDOS = [
  {label:'Fundamentos da Programação Web e Setup', date:'2026-10-04', feita:true},
  {label:'Git e GitHub', date:'2026-10-04', feita:true},
  {label:'Fundamentos do HTML e do CSS', date:'2026-10-11'},
  {label:'Usando Inteligência Artificial no Aprendizado', date:'2026-10-15'},
  {label:'Avançando no HTML e CSS', date:'2026-10-25'},
  {label:'JavaScript', date:'2026-11-15'},
  {label:'TypeScript', date:'2026-11-29'},
  {label:'Iniciando no Node.js', date:'2026-12-13'},
  {label:'API REST com Node.js', date:'2026-12-31'},
  {label:'Node.js com Containers', date:'2027-01-17'},
  {label:'Bônus: API do Refund 2.0', date:'2027-01-24'},
  {label:'Iniciando no React', date:'2027-02-07'},
  {label:'Avançando no React', date:'2027-02-28'},
  {label:'HelpDesk', date:'2027-03-21'},
  {label:'Certificado final', date:'2027-03-31'}
];
// O curso já cobre o React; as metas genéricas de React do plano saem.
const DESAFIO_METAS_SUBSTITUIDAS = ['Começar React: 3x por semana, 1h', 'Projeto refeito em React e no ar'];

const DESAFIO_REFEICOES = [
  {nome:'Café da manhã', texto:'2 pães + 3 fatias de peito de peru + 2 fatias de queijo + 1 copo de leite semi desnatado + 1 banana'},
  {nome:'Almoço', texto:'a la minuta'},
  {nome:'Lanche', texto:'1 maçã + 2 iogurtes grego light'},
  {nome:'Pré-treino', texto:'50g de sucrilhos + 1 copo de leite semi desnatado'},
  {nome:'Pós-treino', texto:'3 ovos'},
  {nome:'Jantar leve', texto:'1 copo de leite com nescau'}
];

function desafioAbaSalva(){
  try{ return localStorage.getItem('desafioAba') || 'hoje'; }catch(e){ return 'hoje'; }
}

state.desafio = {days: {}, entries: [], loaded: false, comidaTexto: '', comidaPreview: null, cadastro: null, todasMetas: false, novaMeta: false, precisaSql: false, aba: desafioAbaSalva()};

function setDesafioAba(aba){
  state.desafio.aba = aba;
  try{ localStorage.setItem('desafioAba', aba); }catch(e){}
  render();
  window.scrollTo(0,0);
}

function isDesafioOwner(){
  return !!(session && session.user && (session.user.email || '').toLowerCase() === DESAFIO_EMAIL);
}

// As Metas são de todo mundo; só o Desafio, dentro da mesma seção, é da
// conta dona.
function setupDesafioNav(){
  const dono = isDesafioOwner();
  const item = document.getElementById('desafio-nav-item');
  const mob = document.getElementById('desafio-btn-mobile');
  if(item) item.hidden = !dono;
  if(mob) mob.hidden = !dono;
}

function goDesafio(){
  if(!isDesafioOwner()) return;
  flushNotesIfPending();
  state.selecting = false;
  state.selected.clear();
  state.view = 'desafio';
  render();
  window.scrollTo(0,0);
}

function desafioLinha(r){
  return {
    id: r.id,
    kind: r.kind,
    date: r.date,
    label: r.label || '',
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    protein: r.protein === null || r.protein === undefined ? null : Number(r.protein),
    status: r.status || ''
  };
}

async function loadDesafio(){
  if(!isDesafioOwner()) return;
  const [dias, lanc] = await Promise.all([
    sb.from('challenge_days').select('day, checks').gte('day', DESAFIO_INICIO).lte('day', DESAFIO_FIM),
    sb.from('challenge_entries').select('*').order('date', {ascending: true}).order('created_at', {ascending: true})
  ]);
  if(dias.error || lanc.error){
    state.desafio.loaded = false;
    state.desafio.error = true;
    return;
  }
  state.desafio.days = {};
  (dias.data || []).forEach(r=>{ state.desafio.days[r.day] = new Set(r.checks || []); });
  state.desafio.entries = (lanc.data || []).map(desafioLinha);
  state.desafio.loaded = true;
  state.desafio.error = false;
  await seedDesafioMetas();
  await seedDesafioEstudos();
}

async function seedDesafioMetas(){
  if(state.desafio.entries.some(e=>e.kind === 'meta' && e.label === DESAFIO_SEED_MARK)) return;
  const linhas = DESAFIO_METAS_PADRAO.map(m=>({user_id: session.user.id, kind:'meta', label:m.label, date:m.date, status:'aberta'}));
  linhas.push({user_id: session.user.id, kind:'meta', label:DESAFIO_SEED_MARK, date:DESAFIO_INICIO, status:'marca'});
  const {data, error} = await sb.from('challenge_entries').insert(linhas).select();
  if(error){ state.desafio.precisaSql = true; return; }
  state.desafio.precisaSql = false;
  (data || []).forEach(r=>state.desafio.entries.push(desafioLinha(r)));
}

async function seedDesafioEstudos(){
  if(state.desafio.precisaSql) return;
  if(state.desafio.entries.some(e=>e.kind === 'meta' && e.label === DESAFIO_SEED_ESTUDOS)) return;
  const linhas = DESAFIO_ESTUDOS.map(m=>({user_id: session.user.id, kind:'meta', label:m.label, date:m.date, value:1, status: m.feita ? 'feita' : 'aberta'}));
  linhas.push({user_id: session.user.id, kind:'meta', label:DESAFIO_SEED_ESTUDOS, date:DESAFIO_INICIO, status:'marca'});
  const {data, error} = await sb.from('challenge_entries').insert(linhas).select();
  if(error) return;
  (data || []).forEach(r=>state.desafio.entries.push(desafioLinha(r)));
  const sobras = state.desafio.entries.filter(e=>e.kind === 'meta' && e.status !== 'feita' && DESAFIO_METAS_SUBSTITUIDAS.includes(e.label));
  if(sobras.length){
    const {error: errDel} = await sb.from('challenge_entries').delete().in('id', sobras.map(e=>e.id));
    if(!errDel) state.desafio.entries = state.desafio.entries.filter(e=>!sobras.includes(e));
  }
}

function desafioIso(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function desafioDate(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}

function desafioAddDays(iso, n){
  const d = desafioDate(iso);
  d.setDate(d.getDate() + n);
  return desafioIso(d);
}

function desafioDiff(a, b){
  return Math.round((desafioDate(b) - desafioDate(a)) / 86400000);
}

function desafioFmt(iso){
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function desafioPrazo(iso){
  const n = desafioDiff(todayIso(), iso);
  if(n < 0) return {txt: n === -1 ? 'era ontem' : `atrasada ${-n} dias`, cls:'atrasada'};
  if(n === 0) return {txt:'hoje', cls:'perto'};
  if(n === 1) return {txt:'amanhã', cls:'perto'};
  if(n < 7) return {txt:`${DIAS_LONGOS[desafioDate(iso).getDay()].toLowerCase()} · ${n} dias`, cls:'perto'};
  return {txt: desafioFmt(iso), cls:''};
}

function desafioDinheiro(v){
  return Number(v || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0});
}

function desafioNum(v, casas){
  return Number(v || 0).toLocaleString('pt-BR', {maximumFractionDigits: casas || 0});
}

function desafioItensDoDia(iso){
  const dow = desafioDate(iso).getDay();
  return DESAFIO_ITENS.filter(i=>i.dias.includes(dow));
}

function desafioPctDia(iso){
  const itens = desafioItensDoDia(iso);
  if(!itens.length) return 0;
  const marcados = state.desafio.days[iso] || new Set();
  return itens.filter(i=>marcados.has(i.key)).length / itens.length;
}

function desafioSequencia(){
  const hoje = todayIso();
  let iso = desafioPctDia(hoje) === 1 ? hoje : desafioAddDays(hoje, -1);
  let n = 0;
  while(iso >= DESAFIO_INICIO && desafioPctDia(iso) === 1){
    n++;
    iso = desafioAddDays(iso, -1);
  }
  return n;
}

function desafioDiaAtual(){
  const hoje = todayIso();
  const total = desafioDiff(DESAFIO_INICIO, DESAFIO_FIM) + 1;
  if(hoje < DESAFIO_INICIO) return {dia: 0, total, faltam: total};
  if(hoje > DESAFIO_FIM) return {dia: total, total, faltam: 0};
  const dia = desafioDiff(DESAFIO_INICIO, hoje) + 1;
  return {dia, total, faltam: total - dia};
}

function desafioDoTipo(kind){
  return state.desafio.entries.filter(e=>e.kind === kind);
}

function desafioMetas(){
  return desafioDoTipo('meta').filter(m=>m.status !== 'marca' && m.value !== 1);
}

function desafioEstudos(){
  return desafioDoTipo('meta').filter(m=>m.status !== 'marca' && m.value === 1)
    .sort((a, b)=>a.date.localeCompare(b.date) || DESAFIO_ESTUDOS.findIndex(x=>x.label === a.label) - DESAFIO_ESTUDOS.findIndex(x=>x.label === b.label));
}

function desafioRerender(){
  skipEntranceOnce = true;
  render();
}

async function salvarDesafioDia(iso){
  return sb.from('challenge_days').upsert({
    user_id: session.user.id,
    day: iso,
    checks: [...(state.desafio.days[iso] || [])],
    updated_at: new Date().toISOString()
  }, {onConflict: 'user_id,day'});
}

async function toggleDesafioItem(key){
  const iso = todayIso();
  const atual = new Set(state.desafio.days[iso] || []);
  if(atual.has(key)) atual.delete(key); else atual.add(key);
  const anterior = state.desafio.days[iso];
  state.desafio.days[iso] = atual;
  desafioRerender();
  const {error} = await salvarDesafioDia(iso);
  if(error){
    state.desafio.days[iso] = anterior;
    desafioRerender();
    showToast('Não deu pra salvar o checklist', 'erro');
    return;
  }
  if(desafioPctDia(iso) === 1 && atual.has(key)) showToast('Dia completo 💪');
}

// Itens que o próprio app consegue confirmar (peso registrado, proteína
// batida) se marcam sozinhos; desmarcar continua sendo manual.
async function desafioMarcarSozinho(key){
  const iso = todayIso();
  if(!desafioItensDoDia(iso).some(i=>i.key === key)) return;
  const atual = new Set(state.desafio.days[iso] || []);
  if(atual.has(key)) return;
  atual.add(key);
  state.desafio.days[iso] = atual;
  const {error} = await salvarDesafioDia(iso);
  if(!error) desafioRerender();
}

async function inserirDesafio(linha){
  const {data, error} = await sb.from('challenge_entries').insert({user_id: session.user.id, ...linha}).select().single();
  if(error){
    if(['meta','comida','alimento'].includes(linha.kind)) state.desafio.precisaSql = true;
    return null;
  }
  const e = desafioLinha(data);
  state.desafio.entries.push(e);
  return e;
}

async function addDesafioEntry(kind){
  const linha = {kind, date: todayIso()};
  if(kind === 'peso'){
    const el = document.getElementById('desafio-peso');
    const v = parseFloat(String(el.value).replace(',', '.'));
    if(!v || v < 30 || v > 200){ showToast('Coloca um peso válido', 'erro'); el.focus(); return; }
    linha.value = v;
  } else if(kind === 'freela'){
    const cli = document.getElementById('desafio-freela-cliente');
    const val = document.getElementById('desafio-freela-valor');
    const v = parseFloat(String(val.value).replace(/\./g, '').replace(',', '.'));
    if(!cli.value.trim()){ showToast('Coloca o nome do cliente', 'erro'); cli.focus(); return; }
    if(!v || v <= 0){ showToast('Coloca o valor recebido', 'erro'); val.focus(); return; }
    linha.label = cli.value.trim();
    linha.value = v;
  } else if(kind === 'vaga'){
    const emp = document.getElementById('desafio-vaga');
    if(!emp.value.trim()){ showToast('Coloca a empresa ou a vaga', 'erro'); emp.focus(); return; }
    linha.label = emp.value.trim();
    linha.status = 'enviada';
  } else if(kind === 'meta'){
    const txt = document.getElementById('desafio-meta');
    const prazo = document.getElementById('desafio-meta-prazo');
    if(!txt.value.trim()){ showToast('Escreve a meta', 'erro'); txt.focus(); return; }
    linha.label = txt.value.trim();
    linha.date = prazo.value || desafioAddDays(todayIso(), 7);
    linha.status = 'aberta';
  }
  const e = await inserirDesafio(linha);
  if(!e){ showToast(kind === 'meta' ? 'Falta rodar o supabase/desafio_v2.sql' : 'Não deu pra salvar', 'erro'); return; }
  if(kind === 'meta') state.desafio.novaMeta = false;
  desafioRerender();
  showToast({peso:'Peso registrado', freela:'Freela lançado', vaga:'Vaga adicionada', meta:'Meta criada'}[kind]);
  if(kind === 'peso') desafioMarcarSozinho('pesar');
}

async function setDesafioVagaStatus(id, status){
  const e = state.desafio.entries.find(x=>x.id === id);
  if(!e) return;
  const anterior = e.status;
  e.status = status;
  desafioRerender();
  const {error} = await sb.from('challenge_entries').update({status}).eq('id', id);
  if(error){
    e.status = anterior;
    desafioRerender();
    showToast('Não deu pra mudar o status', 'erro');
  }
}

async function toggleDesafioMeta(id){
  const e = state.desafio.entries.find(x=>x.id === id);
  if(!e) return;
  const anterior = e.status;
  e.status = e.status === 'feita' ? 'aberta' : 'feita';
  desafioRerender();
  const {error} = await sb.from('challenge_entries').update({status: e.status}).eq('id', id);
  if(error){
    e.status = anterior;
    desafioRerender();
    showToast('Não deu pra salvar a meta', 'erro');
    return;
  }
  if(e.status === 'feita') showToast('Meta concluída 🎯');
}

async function deleteDesafioEntry(id){
  const idx = state.desafio.entries.findIndex(x=>x.id === id);
  if(idx < 0) return;
  const [removido] = state.desafio.entries.splice(idx, 1);
  desafioRerender();
  const {error} = await sb.from('challenge_entries').delete().eq('id', id);
  if(error){
    state.desafio.entries.splice(idx, 0, removido);
    desafioRerender();
    showToast('Não deu pra apagar', 'erro');
  }
}

function desafioOnEnter(e, kind){
  if(e.key === 'Enter'){ e.preventDefault(); addDesafioEntry(kind); }
}

/* ---------- Comida: texto livre -> estimativa de calorias e proteína ---------- */
// Valores por porção, arredondados de tabelas de composição (TACO) e de
// rótulos comuns. É estimativa: serve pra acompanhar a média do dia, não pra
// contar grama por grama.

const ALIMENTOS_BASE = [
  {nome:'Kit pão', a:['kit pao'], p:'kit', g:100, kcal:250, prot:14},
  {nome:'Pão francês', a:['pao frances','paozinho','pao de sal','pao'], p:'unidade', g:50, kcal:150, prot:4},
  {nome:'Pão de forma', a:['pao de forma','pao integral','pao de forma integral'], p:'fatia', g:25, kcal:62, prot:2.3},
  {nome:'Torrada', a:['torrada'], p:'unidade', g:10, kcal:40, prot:1.1},
  {nome:'Peito de peru', a:['peito de peru','peru','blanquet'], p:'fatia', g:15, kcal:16, prot:2.7},
  {nome:'Presunto', a:['presunto'], p:'fatia', g:15, kcal:14, prot:2.1},
  {nome:'Queijo mussarela', a:['queijo','mussarela','mucarela','queijo mussarela'], p:'fatia', g:20, kcal:66, prot:4.4},
  {nome:'Queijo prato', a:['queijo prato'], p:'fatia', g:20, kcal:72, prot:4.6},
  {nome:'Requeijão', a:['requeijao'], p:'colher', g:30, kcal:77, prot:2.9},
  {nome:'Manteiga', a:['manteiga','margarina'], p:'colher', g:10, kcal:72, prot:0},
  {nome:'Ovo', a:['ovo','ovo cozido','ovo mexido'], p:'unidade', g:50, kcal:72, prot:6.5},
  {nome:'Ovo frito', a:['ovo frito'], p:'unidade', g:50, kcal:90, prot:6.5},
  {nome:'Omelete', a:['omelete','omelete de 2 ovo'], p:'unidade (2 ovos)', g:130, kcal:200, prot:13},
  {nome:'Leite semidesnatado', a:['leite','leite semi','semi desnatado','semidesnatado','leite semi desnatado','leite semidesnatado'], p:'copo', g:200, kcal:92, prot:6.4},
  {nome:'Leite integral', a:['leite integral'], p:'copo', g:200, kcal:122, prot:6.4},
  {nome:'Leite desnatado', a:['leite desnatado','desnatado'], p:'copo', g:200, kcal:70, prot:6.8},
  {nome:'Leite sem lactose', a:['leite sem lactose','sem lactose','zero lactose'], p:'copo', g:200, kcal:100, prot:6.2},
  {nome:'Iogurte grego light', a:['iogurte grego light','grego light','iogurte light'], p:'pote', g:90, kcal:74, prot:5.4},
  {nome:'Iogurte grego', a:['iogurte grego','grego','iogurte grego tradicional'], p:'pote', g:100, kcal:115, prot:5.5},
  {nome:'Iogurte natural', a:['iogurte','iogurte natural'], p:'pote', g:170, kcal:100, prot:6.8},
  {nome:'Banana', a:['banana'], p:'unidade', g:80, kcal:78, prot:1},
  {nome:'Maçã', a:['maca'], p:'unidade', g:130, kcal:73, prot:0.4},
  {nome:'Laranja', a:['laranja'], p:'unidade', g:140, kcal:52, prot:1.1},
  {nome:'Mamão', a:['mamao'], p:'fatia', g:150, kcal:60, prot:0.7},
  {nome:'Manga', a:['manga'], p:'unidade', g:150, kcal:96, prot:0.6},
  {nome:'Uva', a:['uva'], p:'porção', g:100, kcal:69, prot:0.7},
  {nome:'Morango', a:['morango'], p:'porção', g:100, kcal:30, prot:0.9},
  {nome:'Abacate', a:['abacate'], p:'porção', g:100, kcal:96, prot:1.2},
  {nome:'Sucrilhos', a:['sucrilho','sucrilho tigrao','tigrao','cereal','flocos de milho','corn flake'], p:'tigela', g:50, kcal:190, prot:2},
  {nome:'Aveia', a:['aveia'], p:'colher', g:15, kcal:59, prot:2.1},
  {nome:'Granola', a:['granola'], p:'porção', g:30, kcal:126, prot:2.7},
  {nome:'Nescau', a:['nescau','achocolatado','toddy'], p:'porção (2 colheres)', g:20, kcal:76, prot:0.9, u:{colher:10}},
  {nome:'Açúcar', a:['acucar'], p:'colher', g:10, kcal:39, prot:0},
  {nome:'Café', a:['cafe','cafezinho'], p:'xícara', g:50, kcal:2, prot:0.1},
  {nome:'Arroz', a:['arroz','arroz branco'], p:'porção', g:150, kcal:192, prot:3.8, u:{colher:25, escumadeira:90}},
  {nome:'Arroz integral', a:['arroz integral'], p:'porção', g:150, kcal:186, prot:3.9, u:{colher:25, escumadeira:90}},
  {nome:'Feijão', a:['feijao','feijao preto','feijao carioca'], p:'concha', g:140, kcal:106, prot:6.7},
  {nome:'Frango grelhado', a:['frango','frango grelhado','peito de frango','file de frango','frango cozido','frango desfiado'], p:'filé', g:120, kcal:191, prot:38},
  {nome:'Frango assado', a:['frango assado','galeto'], p:'pedaço', g:150, kcal:260, prot:40},
  {nome:'Frango à milanesa', a:['frango frito','frango a milanesa','file a milanesa','milanesa'], p:'filé', g:130, kcal:325, prot:30},
  {nome:'Bife', a:['bife','carne','carne grelhada','alcatra','contra file','contrafile','patinho','file mignon','bife acebolado'], p:'bife', g:120, kcal:276, prot:37},
  {nome:'Carne moída', a:['carne moida','guisado'], p:'porção', g:100, kcal:212, prot:26},
  {nome:'Carne de panela', a:['carne de panela','carne cozida','picadinho'], p:'porção', g:150, kcal:330, prot:40},
  {nome:'Churrasco', a:['churrasco','picanha'], p:'porção', g:150, kcal:435, prot:37},
  {nome:'Costela', a:['costela'], p:'porção', g:150, kcal:525, prot:30},
  {nome:'Linguiça', a:['linguica','salsichao'], p:'unidade', g:60, kcal:180, prot:9.6},
  {nome:'Salsicha', a:['salsicha','cachorro quente'], p:'unidade', g:50, kcal:125, prot:6.5},
  {nome:'Porco', a:['lombo','carne de porco','porco','bisteca'], p:'porção', g:120, kcal:252, prot:36},
  {nome:'Peixe', a:['peixe','tilapia','file de peixe','merluza'], p:'filé', g:120, kcal:154, prot:31},
  {nome:'Atum', a:['atum'], p:'lata', g:120, kcal:132, prot:29},
  {nome:'Sardinha', a:['sardinha'], p:'lata', g:90, kcal:180, prot:21},
  {nome:'Salada', a:['salada','alface','tomate'], p:'porção', g:100, kcal:15, prot:1},
  {nome:'Brócolis', a:['brocoli'], p:'porção', g:100, kcal:25, prot:2.1},
  {nome:'Batata frita', a:['batata frita','frita','batatinha'], p:'porção', g:100, kcal:300, prot:4},
  {nome:'Batata', a:['batata','batata cozida'], p:'porção', g:150, kcal:78, prot:1.8},
  {nome:'Purê', a:['pure','pure de batata'], p:'porção', g:150, kcal:150, prot:3},
  {nome:'Batata doce', a:['batata doce'], p:'porção', g:150, kcal:116, prot:0.9},
  {nome:'Aipim', a:['aipim','mandioca','macaxeira'], p:'porção', g:150, kcal:188, prot:0.9},
  {nome:'Macarrão', a:['macarrao','massa','espaguete'], p:'prato', g:200, kcal:316, prot:11.6},
  {nome:'Miojo', a:['miojo','lamen','nissin'], p:'pacote', g:80, kcal:380, prot:8},
  {nome:'Lasanha', a:['lasanha'], p:'pedaço', g:250, kcal:375, prot:20},
  {nome:'Pizza', a:['pizza'], p:'fatia', g:110, kcal:297, prot:12},
  {nome:'Hambúrguer', a:['hamburguer','x burguer','x salada','burguer'], p:'unidade', g:200, kcal:520, prot:25},
  {nome:'Xis', a:['xis'], p:'unidade', g:300, kcal:750, prot:38},
  {nome:'Pastel', a:['pastel'], p:'unidade', g:100, kcal:300, prot:7},
  {nome:'Coxinha', a:['coxinha'], p:'unidade', g:100, kcal:280, prot:9},
  {nome:'Pão de queijo', a:['pao de queijo'], p:'unidade', g:40, kcal:145, prot:2},
  {nome:'Tapioca', a:['tapioca'], p:'unidade', g:70, kcal:240, prot:0.3},
  {nome:'Cuscuz', a:['cuscuz'], p:'porção', g:150, kcal:170, prot:3.3},
  {nome:'Whey', a:['whey','whey protein','proteina em po'], p:'scoop', g:30, kcal:120, prot:24},
  {nome:'Creatina', a:['creatina'], p:'dose', g:5, kcal:0, prot:0},
  {nome:'Barra de proteína', a:['barra de proteina','barrinha de proteina'], p:'unidade', g:45, kcal:180, prot:15},
  {nome:'Barra de cereal', a:['barra de cereal','barrinha'], p:'unidade', g:25, kcal:90, prot:1.2},
  {nome:'Suco de laranja', a:['suco de laranja'], p:'copo', g:200, kcal:90, prot:1.4},
  {nome:'Suco', a:['suco'], p:'copo', g:200, kcal:90, prot:0.5},
  {nome:'Refrigerante', a:['refrigerante','refri','coca','coca cola','guarana'], p:'lata', g:350, kcal:147, prot:0, u:{copo:200}},
  {nome:'Refrigerante zero', a:['coca zero','refri zero','refrigerante zero'], p:'lata', g:350, kcal:1, prot:0, u:{copo:200}},
  {nome:'Cerveja', a:['cerveja'], p:'lata', g:350, kcal:147, prot:1.1, u:{copo:200}},
  {nome:'Chocolate', a:['chocolate','bombom'], p:'porção', g:25, kcal:135, prot:1.8},
  {nome:'Biscoito', a:['biscoito','bolacha','cookie'], p:'porção', g:30, kcal:140, prot:2},
  {nome:'Amendoim', a:['amendoim','castanha','mix de castanha'], p:'punhado', g:30, kcal:174, prot:8},
  {nome:'Pasta de amendoim', a:['pasta de amendoim'], p:'colher', g:15, kcal:89, prot:3.8},
  {nome:'Açaí', a:['acai'], p:'tigela', g:300, kcal:330, prot:3},
  {nome:'Bolo', a:['bolo'], p:'fatia', g:60, kcal:200, prot:3},
  {nome:'Sorvete', a:['sorvete'], p:'bola', g:60, kcal:125, prot:2.3},
  {nome:'À la minuta', a:['a la minuta','alaminuta','ala minuta','la minuta'], p:'prato', g:550, kcal:850, prot:50},
  {nome:'À la minuta de frango', a:['a la minuta de frango','alaminuta de frango','ala minuta de frango'], p:'prato', g:550, kcal:800, prot:55},
  {nome:'Prato feito', a:['prato feito','pf','marmita','marmitex'], p:'prato', g:500, kcal:800, prot:40}
];

const UNIDADES_GENERICAS = {
  copo:200, xicara:240, colher:15, colherzinha:5, concha:140, fatia:20, lata:350, pote:100,
  scoop:30, medida:30, dose:30, tigela:300, prato:350, punhado:30, pedaco:100, file:120,
  escumadeira:90, pacote:100, barra:30, bola:60, garrafa:500, caixinha:200, cacho:100
};
const UNIDADES_PORCAO = ['unidade','un','und','porcao','kit'];
const NUMEROS_ESCRITOS = {um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10, meio:0.5, meia:0.5, metade:0.5};
const PALAVRAS_DE_REFEICAO = ['cafe da manha','almocei','almoco','jantei','jantar','janta','lanche da tarde','lanche','ceia','pre treino','pos treino','comi','tomei','bebi','hoje'];
const SINGULAR_INTOCAVEL = new Set(['xis','tres','mais','gas','pires','lapis','depois','pois','seis','dois']);

function textoComida(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.\/,+;\n ]/g, ' ')
    .replace(/[ ]+/g, ' ').trim();
}

function singularPalavra(w){
  if(w.length <= 3 || SINGULAR_INTOCAVEL.has(w) || /\d/.test(w)) return w;
  if(/(oes|aes)$/.test(w)) return w.slice(0, -3) + 'ao';
  if(/eis$/.test(w)) return w.slice(0, -3) + 'el';
  if(/ais$/.test(w)) return w.slice(0, -3) + 'al';
  if(/res$/.test(w)) return w.slice(0, -2);
  if(/ns$/.test(w)) return w.slice(0, -2) + 'm';
  if(/s$/.test(w)) return w.slice(0, -1);
  return w;
}

function singularFrase(s){
  return s.split(' ').map(singularPalavra).join(' ');
}

function alimentosConhecidos(){
  const proprios = desafioDoTipo('alimento').map(e=>({
    nome: e.label,
    a: [singularFrase(textoComida(e.label))],
    p: 'porção', g: 100,
    kcal: e.value || 0, prot: e.protein || 0,
    proprio: true
  }));
  const base = ALIMENTOS_BASE.map(f=>({...f, a: f.a.map(x=>singularFrase(textoComida(x)))}));
  return [...proprios, ...base];
}

function acharAlimento(seg, lista){
  let melhor = null, tam = 0;
  for(const f of lista){
    for(const alias of f.a){
      if(alias.length <= tam) continue;
      const re = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`);
      if(re.test(seg)){ melhor = f; tam = alias.length; }
    }
  }
  return melhor;
}

function lerQuantidade(seg){
  const tokens = seg.split(' ');
  let n = null, unidade = null;
  for(let i = 0; i < tokens.length; i++){
    const t = tokens[i];
    let v = null;
    if(/^\d+(\.\d+)?$/.test(t)) v = parseFloat(t);
    else if(/^\d+\/\d+$/.test(t)){ const [a, b] = t.split('/').map(Number); v = b ? a / b : null; }
    else if(t in NUMEROS_ESCRITOS) v = NUMEROS_ESCRITOS[t];
    if(v !== null){
      n = v;
      const prox = singularPalavra(tokens[i+1] || '');
      if(['g','gr','grama','ml','kg','l','litro','quilo'].includes(prox) || prox in UNIDADES_GENERICAS || UNIDADES_PORCAO.includes(prox)) unidade = prox;
      break;
    }
  }
  if(!unidade){
    const achada = tokens.map(singularPalavra).find(t=>(t in UNIDADES_GENERICAS && t !== 'file') || t === 'unidade');
    if(achada) unidade = achada;
  }
  return {n: n === null ? 1 : n, unidade};
}

function pluralUnidade(u, n){
  if(n <= 1 || u.includes('(')) return u;
  if(u.endsWith('ão')) return u.slice(0, -2) + 'ões';
  if(/[rz]$/.test(u)) return u + 'es';
  return u + 's';
}

function calcularItem(seg, lista){
  const limpo = singularFrase(seg);
  const comida = acharAlimento(limpo, lista);
  if(!comida) return null;
  const {n, unidade} = lerQuantidade(seg);
  let fator = n;
  let desc = `${desafioNum(n, 2)} ${pluralUnidade(comida.p, n)}`;
  if(['g','gr','grama','ml'].includes(unidade)){ fator = n / comida.g; desc = `${desafioNum(n)}${unidade === 'ml' ? 'ml' : 'g'}`; }
  else if(['kg','l','litro','quilo'].includes(unidade)){ fator = (n * 1000) / comida.g; desc = `${desafioNum(n, 2)}${unidade === 'kg' || unidade === 'quilo' ? 'kg' : 'L'}`; }
  else if(unidade && !UNIDADES_PORCAO.includes(unidade) && singularPalavra(textoComida(comida.p)) !== unidade){
    const gramas = (comida.u && comida.u[unidade]) || UNIDADES_GENERICAS[unidade];
    if(gramas){ fator = (n * gramas) / comida.g; desc = `${desafioNum(n, 2)} ${pluralUnidade(unidade, n)}`; }
  }
  return {nome: comida.nome, desc, kcal: comida.kcal * fator, prot: comida.prot * fator};
}

function calcularComida(texto){
  const bruto = String(texto || '');
  let t = textoComida(bruto.includes(':') ? bruto.split(':').pop() : bruto);
  PALAVRAS_DE_REFEICAO.forEach(w=>{ t = t.replace(new RegExp(`(^|[^a-z])${w}($|[^a-z])`, 'g'), ' '); });
  const lista = alimentosConhecidos();
  const partes = t.split(/\s*(?:[+,;\n]|\be\b|\bcom\b|\bmais\b)\s*/).map(s=>s.trim()).filter(Boolean);
  const itens = [], desconhecidos = [];
  partes.forEach(seg=>{
    if(!/[a-z]/.test(seg)) return;
    const item = calcularItem(seg, lista);
    if(item) itens.push(item); else desconhecidos.push(seg);
  });
  const kcal = itens.reduce((s, i)=>s + i.kcal, 0);
  const prot = itens.reduce((s, i)=>s + i.prot, 0);
  return {texto, itens, desconhecidos, kcal, prot};
}

function desafioComidaInput(el){
  state.desafio.comidaTexto = el.value;
}

function desafioCalcularComida(){
  const el = document.getElementById('desafio-comida');
  const texto = el ? el.value.trim() : state.desafio.comidaTexto.trim();
  state.desafio.comidaTexto = texto;
  state.desafio.cadastro = null;
  if(!texto){ state.desafio.comidaPreview = null; desafioRerender(); return; }
  state.desafio.comidaPreview = calcularComida(texto);
  desafioRerender();
}

function desafioUsarRefeicao(i){
  const r = DESAFIO_REFEICOES[i];
  if(!r) return;
  state.desafio.comidaTexto = r.texto;
  state.desafio.cadastro = null;
  state.desafio.comidaPreview = calcularComida(r.texto);
  desafioRerender();
}

function desafioComidaKeydown(e){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  const p = state.desafio.comidaPreview;
  if(p && p.texto === e.target.value.trim() && p.itens.length) addDesafioComida();
  else desafioCalcularComida();
}

async function addDesafioComida(){
  const p = state.desafio.comidaPreview;
  if(!p || !p.itens.length){ showToast('Não reconheci nenhum alimento', 'erro'); return; }
  const e = await inserirDesafio({kind:'comida', date: todayIso(), label: p.texto.slice(0, 160), value: Math.round(p.kcal), protein: Math.round(p.prot * 10) / 10});
  if(!e){ showToast('Falta rodar o supabase/desafio_v2.sql', 'erro'); return; }
  state.desafio.comidaTexto = '';
  state.desafio.comidaPreview = null;
  state.desafio.cadastro = null;
  desafioRerender();
  showToast(`+${desafioNum(e.value)} kcal · ${desafioNum(e.protein, 1)}g de proteína`);
  const protHoje = desafioDoTipo('comida').filter(c=>c.date === todayIso()).reduce((s, c)=>s + (c.protein || 0), 0);
  if(protHoje >= DESAFIO_METAS.proteina) desafioMarcarSozinho('proteina');
}

function desafioAbrirCadastro(seg){
  const nome = seg.replace(/\b\d+(\.\d+)?\b/g, ' ').replace(/\b(g|gr|ml|de|da|do)\b/g, ' ').replace(/\s+/g, ' ').trim();
  state.desafio.cadastro = nome || seg;
  desafioRerender();
  setTimeout(()=>{ const el = document.getElementById('desafio-alim-kcal'); if(el) el.focus(); }, 30);
}

async function salvarAlimentoProprio(){
  const nome = document.getElementById('desafio-alim-nome').value.trim();
  const kcal = parseFloat(String(document.getElementById('desafio-alim-kcal').value).replace(',', '.'));
  const prot = parseFloat(String(document.getElementById('desafio-alim-prot').value).replace(',', '.'));
  if(!nome){ showToast('Coloca o nome do alimento', 'erro'); return; }
  if(isNaN(kcal) || kcal < 0){ showToast('Coloca as calorias de uma porção', 'erro'); return; }
  const e = await inserirDesafio({kind:'alimento', date: todayIso(), label: nome, value: kcal, protein: isNaN(prot) ? 0 : prot});
  if(!e){ showToast('Falta rodar o supabase/desafio_v2.sql', 'erro'); return; }
  state.desafio.cadastro = null;
  if(state.desafio.comidaTexto) state.desafio.comidaPreview = calcularComida(state.desafio.comidaTexto);
  desafioRerender();
  showToast(`${nome} cadastrado`);
}

/* ---------- Render ---------- */

function renderDesafioBarra(pct){
  const p = Math.max(0, Math.min(1, pct));
  return `<div class="desafio-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p*100)}"><span style="width:${(p*100).toFixed(1)}%"></span></div>`;
}

function renderDesafioMapa(){
  const hoje = todayIso();
  const semanas = [];
  let iso = DESAFIO_INICIO;
  while(iso <= DESAFIO_FIM){
    const semana = [];
    for(let i=0;i<7;i++){
      const dentro = iso <= DESAFIO_FIM;
      const futuro = iso > hoje;
      const pct = dentro && !futuro ? desafioPctDia(iso) : 0;
      const nivel = !dentro ? 'fora' : futuro ? 'futuro' : pct === 1 ? 'n4' : pct >= 0.66 ? 'n3' : pct >= 0.33 ? 'n2' : pct > 0 ? 'n1' : 'n0';
      const titulo = dentro ? `${desafioFmt(iso)} — ${futuro ? 'ainda não chegou' : Math.round(pct*100) + '%'}` : '';
      semana.push(`<span class="desafio-cell ${nivel}${iso === hoje ? ' hoje' : ''}" title="${titulo}"></span>`);
      iso = desafioAddDays(iso, 1);
    }
    semanas.push(`<div class="desafio-week">${semana.join('')}</div>`);
  }
  return `
    <div class="desafio-map-wrap">
      <div class="desafio-map-days" aria-hidden="true"><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span><span>D</span></div>
      <div class="desafio-map">${semanas.join('')}</div>
    </div>`;
}

function renderDesafioGraficoPeso(pesos){
  if(pesos.length < 2) return '';
  const w = 300, h = 80, pad = 6;
  const valores = pesos.map(p=>p.value);
  const min = Math.min(DESAFIO_METAS.pesoInicial, ...valores) - 0.5;
  const max = Math.max(DESAFIO_METAS.pesoMeta, ...valores) + 0.5;
  const x = i => pad + (i * (w - pad*2)) / (pesos.length - 1);
  const y = v => h - pad - ((v - min) * (h - pad*2)) / (max - min);
  const pontos = pesos.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const yMeta = y(DESAFIO_METAS.pesoMeta).toFixed(1);
  return `
    <svg class="desafio-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Evolução do peso">
      <line x1="${pad}" x2="${w-pad}" y1="${yMeta}" y2="${yMeta}" class="desafio-chart-meta"/>
      <polyline points="${pontos}" class="desafio-chart-line"/>
      ${pesos.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6" class="desafio-chart-dot"><title>${desafioFmt(p.date)} — ${p.value}kg</title></circle>`).join('')}
    </svg>`;
}

function renderDesafioAvisoSql(){
  if(!state.desafio.precisaSql) return '';
  return `<div class="desafio-aviso">Metas e comida precisam do <strong>supabase/desafio_v2.sql</strong>. Roda ele no SQL Editor do Supabase e atualiza a página.</div>`;
}

function renderDesafioComida(){
  const hoje = todayIso();
  const comidas = desafioDoTipo('comida').filter(c=>c.date === hoje);
  const kcal = comidas.reduce((s, c)=>s + (c.value || 0), 0);
  const prot = comidas.reduce((s, c)=>s + (c.protein || 0), 0);
  const p = state.desafio.comidaPreview;
  const btnApagar = (id)=>`<button class="desafio-del" onclick="deleteDesafioEntry('${id}')" title="Apagar" aria-label="Apagar">×</button>`;

  let preview = '';
  if(p){
    preview = `
      <div class="desafio-preview">
        ${p.itens.length ? `
          <div class="desafio-preview-total"><strong>≈ ${desafioNum(p.kcal)} kcal</strong><span>${desafioNum(p.prot, 1)}g de proteína</span></div>
          <div class="desafio-preview-itens">${p.itens.map(i=>`
            <div class="desafio-preview-item"><span>${esc(i.nome)} <small>${esc(i.desc)}</small></span><span>${desafioNum(i.kcal)} kcal · ${desafioNum(i.prot, 1)}g</span></div>`).join('')}
          </div>` : ''}
        ${p.desconhecidos.map(seg=>`
          <div class="desafio-desconhecido">Não reconheci <strong>“${esc(seg)}”</strong><button class="btn-format" onclick="desafioAbrirCadastro(this.dataset.seg)" data-seg="${esc(seg)}">Cadastrar</button></div>`).join('')}
        ${state.desafio.cadastro !== null ? `
          <div class="desafio-cadastro">
            <input class="input" id="desafio-alim-nome" value="${esc(state.desafio.cadastro)}" placeholder="Nome" autocomplete="off">
            <input class="input" id="desafio-alim-kcal" placeholder="kcal por porção" inputmode="decimal" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();salvarAlimentoProprio();}">
            <input class="input" id="desafio-alim-prot" placeholder="proteína (g)" inputmode="decimal" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();salvarAlimentoProprio();}">
            <button class="btn-primary" onclick="salvarAlimentoProprio()">Salvar</button>
          </div>
          <div class="desafio-empty">Olha no rótulo ou no app do mercado. Na próxima vez ele já reconhece.</div>` : ''}
        ${p.itens.length ? `<div class="desafio-preview-acoes"><button class="btn-secondary" onclick="state.desafio.comidaPreview=null;state.desafio.comidaTexto='';desafioRerender()">Limpar</button><button class="btn-primary" onclick="addDesafioComida()">Adicionar ao dia</button></div>` : ''}
      </div>`;
  }

  return `
    <div class="glass panel">
      <div class="panel-head">
        <div class="panel-title">Comida</div>
        <div class="panel-hint">estimativa</div>
      </div>
      <div class="desafio-macros">
        <div>
          <div class="desafio-meta-line"><strong>${desafioNum(prot)}g</strong><span>de ${DESAFIO_METAS.proteina}g de proteína</span></div>
          ${renderDesafioBarra(prot / DESAFIO_METAS.proteina)}
        </div>
        <div>
          <div class="desafio-meta-line"><strong>${desafioNum(kcal)}</strong><span>de ${desafioNum(DESAFIO_METAS.kcal)} kcal</span></div>
          ${renderDesafioBarra(kcal / DESAFIO_METAS.kcal)}
        </div>
      </div>
      <div class="desafio-form">
        <input class="input" id="desafio-comida" value="${esc(state.desafio.comidaTexto)}" placeholder="Ex: 3 ovos + 1 copo de leite + 1 banana" autocomplete="off" oninput="desafioComidaInput(this)" onkeydown="desafioComidaKeydown(event)">
        <button class="btn-primary" onclick="desafioCalcularComida()">Calcular</button>
      </div>
      <div class="desafio-refeicoes" role="group" aria-label="Refeições do plano">
        ${DESAFIO_REFEICOES.map((r, i)=>`<button type="button" class="desafio-refeicao" onclick="desafioUsarRefeicao(${i})">${esc(r.nome)}</button>`).join('')}
      </div>
      ${preview}
      ${comidas.length ? `<div class="desafio-list">${[...comidas].reverse().map(c=>`
        <div class="desafio-row">
          <span class="desafio-row-label">${esc(c.label)}</span>
          <span class="desafio-row-val">${desafioNum(c.value)} kcal · ${desafioNum(c.protein, 1)}g</span>
          ${btnApagar(c.id)}
        </div>`).join('')}</div>` : (p ? '' : `<div class="desafio-empty">Escreva como falaria: “a la minuta”, “3 ovos e 1 banana”.</div>`)}
    </div>`;
}

function renderDesafioMetaLinha(m){
  const ok = m.status === 'feita';
  const prazo = desafioPrazo(m.date);
  return `
    <div class="desafio-meta-item ${ok ? 'ok' : ''}">
      <button class="desafio-meta-check" onclick="toggleDesafioMeta('${m.id}')" aria-pressed="${ok}" aria-label="${ok ? 'Reabrir' : 'Concluir'}: ${esc(m.label)}"><span class="desafio-box" aria-hidden="true">${ok ? '✓' : ''}</span></button>
      <span class="desafio-meta-txt">${esc(m.label)}</span>
      ${ok ? '' : `<span class="desafio-prazo ${prazo.cls}">${prazo.txt}</span>`}
      <button class="desafio-del" onclick="deleteDesafioEntry('${m.id}')" title="Apagar" aria-label="Apagar meta">×</button>
    </div>`;
}

function renderDesafioMetas(){
  const metas = desafioMetas();
  const hoje = todayIso();
  const abertas = metas.filter(m=>m.status !== 'feita').sort((a, b)=>a.date.localeCompare(b.date));
  const feitas = metas.filter(m=>m.status === 'feita');
  const semana = abertas.filter(m=>desafioDiff(hoje, m.date) < 7);
  const depois = abertas.filter(m=>desafioDiff(hoje, m.date) >= 7);
  const depoisVisiveis = state.desafio.todasMetas ? depois : depois.slice(0, 4);
  return `
    <div class="glass panel">
      <div class="panel-head">
        <div class="panel-title">Metas</div>
        <div class="panel-hint">${feitas.length} de ${metas.length} concluídas</div>
      </div>
      <div class="desafio-grupo">
        <div class="desafio-grupo-titulo">Esta semana</div>
        ${semana.map(renderDesafioMetaLinha).join('') || '<div class="desafio-empty">Nada com prazo nos próximos 7 dias.</div>'}
      </div>
      ${depois.length ? `
      <div class="desafio-grupo">
        <div class="desafio-grupo-titulo">Mais pra frente</div>
        ${depoisVisiveis.map(renderDesafioMetaLinha).join('')}
        ${depois.length > 4 ? `<button class="desafio-mais" onclick="state.desafio.todasMetas=!state.desafio.todasMetas;desafioRerender()">${state.desafio.todasMetas ? 'Mostrar menos' : `Ver mais ${depois.length - 4}`}</button>` : ''}
      </div>` : ''}
      ${state.desafio.novaMeta ? `
      <div class="desafio-form desafio-form-meta">
        <input class="input" id="desafio-meta" placeholder="O que você quer conquistar?" autocomplete="off" onkeydown="desafioOnEnter(event,'meta')">
        <input class="input desafio-input-data" type="date" id="desafio-meta-prazo" value="${desafioAddDays(hoje, 7)}" aria-label="Prazo">
        <button class="btn-primary" onclick="addDesafioEntry('meta')">Criar</button>
      </div>` : `<button class="desafio-add" onclick="state.desafio.novaMeta=true;desafioRerender();setTimeout(()=>document.getElementById('desafio-meta').focus(),30)">+ Nova meta</button>`}
      ${feitas.length ? `<details class="desafio-feitas"><summary>Concluídas (${feitas.length})</summary>${feitas.map(renderDesafioMetaLinha).join('')}</details>` : ''}
    </div>`;
}

function renderDesafioEstudos(){
  const estudos = desafioEstudos();
  if(!estudos.length) return '';
  const feitos = estudos.filter(m=>m.status === 'feita').length;
  const atual = estudos.find(m=>m.status !== 'feita');
  return `
    <div class="glass panel">
      <div class="panel-head">
        <div class="panel-title">Formação dev</div>
        <div class="panel-hint">${feitos} de ${estudos.length} módulos</div>
      </div>
      ${renderDesafioBarra(feitos / estudos.length)}
      <ol class="desafio-trilha">
        ${estudos.map(m=>{
          const ok = m.status === 'feita';
          const agora = atual && m.id === atual.id;
          const prazo = desafioPrazo(m.date);
          return `
            <li class="desafio-modulo ${ok ? 'ok' : ''} ${agora ? 'agora' : ''}">
              <button class="desafio-meta-check" onclick="toggleDesafioMeta('${m.id}')" aria-pressed="${ok}" aria-label="${ok ? 'Reabrir' : 'Concluir'}: ${esc(m.label)}"><span class="desafio-box" aria-hidden="true">${ok ? '✓' : ''}</span></button>
              <span class="desafio-modulo-nome">${esc(m.label)}</span>
              ${ok ? '' : `<span class="desafio-prazo ${agora ? prazo.cls || 'perto' : ''}">${agora ? `agora · ${prazo.txt}` : desafioFmt(m.date)}</span>`}
            </li>`;
        }).join('')}
      </ol>
    </div>`;
}

function renderDesafioHoje(){
  const hoje = todayIso();
  const itensHoje = desafioItensDoDia(hoje);
  const marcados = state.desafio.days[hoje] || new Set();
  const feitos = itensHoje.filter(i=>marcados.has(i.key)).length;
  const nomeDia = DIAS_LONGOS[desafioDate(hoje).getDay()];
  return `
    <div class="desafio-hoje">
      <div class="glass panel">
        <div class="panel-head">
          <div class="panel-title">${nomeDia}</div>
          <div class="panel-hint">${feitos} de ${itensHoje.length}</div>
        </div>
        ${renderDesafioBarra(itensHoje.length ? feitos / itensHoje.length : 0)}
        <ul class="desafio-checks">
          ${itensHoje.map(i=>{
            const ok = marcados.has(i.key);
            return `<li><button class="desafio-check ${ok ? 'ok' : ''}" onclick="toggleDesafioItem('${i.key}')" aria-pressed="${ok}">
              <span class="desafio-box" aria-hidden="true">${ok ? '✓' : ''}</span>
              <span class="desafio-check-txt">${esc(i.label)}</span>
              <small>${i.auto ? '<span class="desafio-auto">auto</span>' : ''}${esc(i.hint)}</small>
            </button></li>`;
          }).join('')}
        </ul>
        ${feitos === itensHoje.length && itensHoje.length ? '<div class="desafio-dia-ok">Dia completo. Amanhã tem mais.</div>' : ''}
      </div>
      ${renderDesafioComida()}
    </div>`;
}

function renderDesafioProgresso(){
  const pesos = desafioDoTipo('peso');
  const pesoAtual = pesos.length ? pesos[pesos.length-1].value : DESAFIO_METAS.pesoInicial;
  const ganho = pesoAtual - DESAFIO_METAS.pesoInicial;
  const freelas = desafioDoTipo('freela');
  const totalFreela = freelas.reduce((s,f)=>s + (f.value || 0), 0);
  const clientes = new Set(freelas.map(f=>f.label.trim().toLowerCase())).size;
  const vagas = desafioDoTipo('vaga');
  const entrevistas = vagas.filter(v=>v.status === 'entrevista' || v.status === 'proposta').length;
  const hoje = todayIso();
  const diasFeitos = Object.keys(state.desafio.days).filter(d=>d <= hoje && desafioPctDia(d) === 1).length;
  const btnApagar = (id)=>`<button class="desafio-del" onclick="deleteDesafioEntry('${id}')" title="Apagar" aria-label="Apagar">×</button>`;

  return `
    <div class="desafio-progresso">
      <div class="glass panel">
        <div class="panel-head">
          <div class="panel-title">Peso</div>
          <div class="panel-hint">meta ${DESAFIO_METAS.pesoMeta}kg</div>
        </div>
        <div class="desafio-meta-line"><strong>${desafioNum(pesoAtual, 1)}kg</strong><span>${ganho >= 0 ? '+' : ''}${desafioNum(ganho, 1)}kg desde o início</span></div>
        ${renderDesafioBarra(ganho / (DESAFIO_METAS.pesoMeta - DESAFIO_METAS.pesoInicial))}
        ${renderDesafioGraficoPeso(pesos)}
        <div class="desafio-form">
          <input class="input" id="desafio-peso" placeholder="Peso de hoje (kg)" inputmode="decimal" autocomplete="off" onkeydown="desafioOnEnter(event,'peso')">
          <button class="btn-primary" onclick="addDesafioEntry('peso')">Registrar</button>
        </div>
        ${pesos.length ? `<div class="desafio-list">${[...pesos].reverse().slice(0,3).map(p=>`
          <div class="desafio-row">
            <span class="desafio-row-date">${desafioFmt(p.date)}</span>
            <span class="desafio-row-label">${desafioNum(p.value, 1)}kg</span>
            ${btnApagar(p.id)}
          </div>`).join('')}</div>` : `<div class="desafio-empty">Toda segunda, de manhã, em jejum.</div>`}
      </div>

      <div class="glass panel">
        <div class="panel-head">
          <div class="panel-title">Os 88 dias</div>
          <div class="panel-hint">${diasFeitos} ${diasFeitos === 1 ? 'dia completo' : 'dias completos'}</div>
        </div>
        ${renderDesafioMapa()}
        <div class="desafio-legend"><span>menos</span><span class="desafio-cell n0"></span><span class="desafio-cell n1"></span><span class="desafio-cell n2"></span><span class="desafio-cell n3"></span><span class="desafio-cell n4"></span><span>100%</span></div>
      </div>

      <div class="glass panel">
        <div class="panel-head">
          <div class="panel-title">Dinheiro extra</div>
          <div class="panel-hint">${clientes} de ${DESAFIO_METAS.clientes} clientes</div>
        </div>
        <div class="desafio-meta-line"><strong>${desafioDinheiro(totalFreela)}</strong><span>de ${desafioDinheiro(DESAFIO_METAS.dinheiro)}</span></div>
        ${renderDesafioBarra(totalFreela / DESAFIO_METAS.dinheiro)}
        <div class="desafio-form">
          <input class="input" id="desafio-freela-cliente" placeholder="Cliente" autocomplete="off" onkeydown="desafioOnEnter(event,'freela')">
          <input class="input desafio-input-sm" id="desafio-freela-valor" placeholder="R$" inputmode="decimal" autocomplete="off" onkeydown="desafioOnEnter(event,'freela')">
          <button class="btn-primary" onclick="addDesafioEntry('freela')">Lançar</button>
        </div>
        ${freelas.length ? `<div class="desafio-list">${[...freelas].reverse().map(f=>`
          <div class="desafio-row">
            <span class="desafio-row-date">${desafioFmt(f.date)}</span>
            <span class="desafio-row-label">${esc(f.label)}</span>
            <span class="desafio-row-val">${desafioDinheiro(f.value)}</span>
            ${btnApagar(f.id)}
          </div>`).join('')}</div>` : `<div class="desafio-empty">Primeiro cliente até 31/10.</div>`}
      </div>

      <div class="glass panel">
        <div class="panel-head">
          <div class="panel-title">Vagas de dev</div>
          <div class="panel-hint">${entrevistas} em entrevista</div>
        </div>
        <div class="desafio-meta-line"><strong>${vagas.length}</strong><span>de ${DESAFIO_METAS.vagas} candidaturas</span></div>
        ${renderDesafioBarra(vagas.length / DESAFIO_METAS.vagas)}
        <div class="desafio-form">
          <input class="input" id="desafio-vaga" placeholder="Empresa — vaga" autocomplete="off" onkeydown="desafioOnEnter(event,'vaga')">
          <button class="btn-primary" onclick="addDesafioEntry('vaga')">Adicionar</button>
        </div>
        ${vagas.length ? `<div class="desafio-list">${[...vagas].reverse().map(v=>`
          <div class="desafio-row">
            <span class="desafio-row-date">${desafioFmt(v.date)}</span>
            <span class="desafio-row-label">${esc(v.label)}</span>
            <select class="select desafio-status" data-status="${esc(v.status)}" onchange="setDesafioVagaStatus('${v.id}', this.value)" aria-label="Status da vaga">
              ${DESAFIO_STATUS_VAGA.map(s=>`<option value="${s.key}" ${s.key===v.status?'selected':''}>${s.label}</option>`).join('')}
            </select>
            ${btnApagar(v.id)}
          </div>`).join('')}</div>` : `<div class="desafio-empty">15 candidaturas até o fim de novembro.</div>`}
      </div>
    </div>`;
}

function renderDesafio(){
  if(!state.desafio.loaded){
    return `
      <div class="view-header"><div><h1>Desafio</h1></div></div>
      <div class="glass panel"><div class="empty"><strong>${state.desafio.error ? 'Não deu pra carregar o desafio.' : 'Carregando…'}</strong>${state.desafio.error ? 'Confere se o supabase/desafio.sql já foi rodado no Supabase.' : ''}</div></div>`;
  }

  const {dia, total, faltam} = desafioDiaAtual();
  const seq = desafioSequencia();
  const proxima = desafioMetas().filter(m=>m.status !== 'feita').sort((a, b)=>a.date.localeCompare(b.date))[0];
  const aba = ['hoje','metas','progresso'].includes(state.desafio.aba) ? state.desafio.aba : 'hoje';
  const abas = [
    {key:'hoje', label:'Hoje'},
    {key:'metas', label:'Metas'},
    {key:'progresso', label:'Progresso'}
  ];
  const corpo = aba === 'metas'
    ? `<div class="desafio-metas-aba">${renderDesafioMetas()}${renderDesafioEstudos()}</div>`
    : aba === 'progresso' ? renderDesafioProgresso() : renderDesafioHoje();

  return `
    <div class="desafio-topo">
      <h1>${dia === 0 ? 'Começa amanhã' : `Dia ${dia} de ${total}`}</h1>
      <p class="desafio-resumo">
        ${faltam > 0 ? `faltam ${faltam} dias` : 'desafio encerrado'}
        <span aria-hidden="true">·</span> sequência de ${seq} ${seq === 1 ? 'dia' : 'dias'}
      </p>
      ${proxima ? `<button class="desafio-proxima" onclick="setDesafioAba('metas')"><span class="desafio-proxima-rotulo">Próxima meta</span><span class="desafio-proxima-txt">${esc(proxima.label)}</span><span class="desafio-prazo ${desafioPrazo(proxima.date).cls}">${desafioPrazo(proxima.date).txt}</span></button>` : ''}
    </div>

    ${renderDesafioAvisoSql()}

    <div class="desafio-abas" role="tablist" aria-label="Seções do desafio">
      ${abas.map(a=>`<button role="tab" aria-selected="${a.key === aba}" class="desafio-aba ${a.key === aba ? 'ativa' : ''}" onclick="setDesafioAba('${a.key}')">${a.label}</button>`).join('')}
    </div>

    <div role="tabpanel">${corpo}</div>
  `;
}

// ============================================================================
//  Metas — seção da barra lateral, só da conta dona (como o Desafio).
//  As tabelas barram outras contas no RLS (supabase/metas.sql).
//  Criação em passos (tipo → nome → medida → prazo → revisão) e uma página
//  por meta, que muda de forma conforme o tipo.
// ============================================================================

const META_TIPOS = {
  numero: {nome:'Chegar a um número', exemplo:'Ler 12 livros, juntar R$\u00a010\u00a0mil', placeholder:'Ex: Ler 12 livros',
    icone:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'},
  habito: {nome:'Criar um hábito', exemplo:'Treinar 4 vezes por semana', placeholder:'Ex: Treinar',
    icone:'<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>'},
  etapas: {nome:'Concluir em etapas', exemplo:'Lançar o site, mudar de casa', placeholder:'Ex: Lançar o site',
    icone:'<path d="M10 6h11M10 12h11M10 18h11"/><path d="M3 6l1.5 1.5L7 5"/><path d="M3 12l1.5 1.5L7 11"/><path d="M3 18l1.5 1.5L7 17"/>'},
  unica: {nome:'Feito ou não feito', exemplo:'Tirar a CNH até março', placeholder:'Ex: Tirar a CNH',
    icone:'<path d="M5 22V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>'}
};
const META_AREAS = [
  {key:'saude', nome:'Saúde', cor:'#5CA05A'},
  {key:'dinheiro', nome:'Dinheiro', cor:'#D4A93F'},
  {key:'carreira', nome:'Carreira', cor:'#7D9AB3'},
  {key:'estudos', nome:'Estudos', cor:'#9B5FBF'},
  {key:'casa', nome:'Casa', cor:'#D4826B'},
  {key:'pessoal', nome:'Pessoal', cor:'#C9587A'}
];
const META_UNIDADES = ['livros', 'kg', 'R$', 'km', 'horas', 'páginas', '%'];
// Unidades em que se registra "onde estou agora" (o peso de hoje), e não
// quanto se somou desde a última vez (mais um livro lido).
const META_UNIDADES_ABSOLUTAS = ['kg', '%'];
const META_PRAZOS = [
  {key:'1m', nome:'Em 1 mês'},
  {key:'3m', nome:'Em 3 meses'},
  {key:'6m', nome:'Em 6 meses'},
  {key:'ano', nome:'Até o fim do ano'},
  {key:'data', nome:'Escolher data'},
  {key:'sem', nome:'Sem prazo'}
];
const ICONE_MAIS = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICONE_CHECK = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICONE_X = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const NUM_META = new Intl.NumberFormat(LOCALE_APP, {maximumFractionDigits: 2});

/* ---------- dados ---------- */

// Ids de etapa entram crus em onclick: só letras minúsculas e dígitos.
function idEtapa(){
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b=>(b % 36).toString(36)).join('');
}

function numMeta(v){
  if(v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function metaLinha(r){
  const steps = Array.isArray(r.steps) ? r.steps : [];
  return {
    id: r.id,
    kind: META_TIPOS[r.kind] ? r.kind : 'unica',
    title: r.title || '',
    area: META_AREAS.some(a=>a.key === r.area) ? r.area : null,
    why: r.why || '',
    unit: r.unit || '',
    start: numMeta(r.start_value),
    target: numMeta(r.target_value),
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.filter(d=>Number.isInteger(d) && d >= 0 && d <= 6) : [],
    routineId: r.routine_id || null,
    steps: steps.filter(s=>s && typeof s.t === 'string').map(s=>({
      id: /^[a-z0-9]{1,16}$/.test(String(s.id)) ? String(s.id) : idEtapa(),
      t: s.t.slice(0, 160),
      ok: !!s.ok
    })),
    due: r.due_date || null,
    status: r.status === 'concluida' ? 'concluida' : 'ativa',
    completedAt: r.completed_at || null,
    created: r.created_at || null
  };
}

async function loadMetas(){
  const [metas, regs] = await Promise.all([
    sb.from('goals').select('*').order('created_at', {ascending: true}),
    sb.from('goal_entries').select('id, goal_id, date, value').order('date', {ascending: true})
  ]);
  const erro = metas.error || regs.error;
  if(erro){
    console.error(erro);
    // Tabela ainda não criada: a barra lateral diz onde rodar o SQL em vez
    // de ficar vazia sem explicação.
    state.metas.precisaSql = erro.code === '42P01' || erro.code === 'PGRST205' || /goals|goal_entries|schema cache/i.test(erro.message || '');
    state.metas.carregado = false;
    return;
  }
  state.metas.lista = (metas.data || []).map(metaLinha);
  state.metas.registros = {};
  (regs.data || []).forEach(r=>{
    (state.metas.registros[r.goal_id] = state.metas.registros[r.goal_id] || [])
      .push({id: r.id, date: r.date, value: numMeta(r.value)});
  });
  state.metas.precisaSql = false;
  state.metas.carregado = true;
  concluirMetasNoAlvo();
}

// Número e etapas têm fim: ao bater 100% a meta vai sozinha para o histórico.
// Hábito não tem (a semana recomeça) e "feito ou não feito" já é o próprio
// botão de concluir.
function metaNoAlvo(g){
  if(g.status !== 'ativa') return false;
  if(g.kind === 'etapas') return g.steps.length > 0 && g.steps.every(s=>s.ok);
  if(g.kind === 'numero') return (g.target ?? 0) !== (g.start ?? 0) && metaProgresso(g).pct >= 1;
  return false;
}

// Metas que já estavam no alvo antes de existir a conclusão automática.
async function concluirMetasNoAlvo(){
  const prontas = state.metas.lista.filter(metaNoAlvo);
  if(!prontas.length) return;
  const agora = new Date().toISOString();
  const {error} = await sb.from('goals').update({status: 'concluida', completed_at: agora, updated_at: agora}).in('id', prontas.map(g=>g.id));
  if(error){ console.error(error); return; }
  prontas.forEach(g=>{ g.status = 'concluida'; g.completedAt = agora; });
  metaRerender();
}

async function concluirSeNoAlvo(g){
  if(metaNoAlvo(g)) await concluirMeta(g.id, true);
}

function metaPorId(id){ return state.metas.lista.find(g=>g.id === id) || null; }
function metaRegistros(g){ return state.metas.registros[g.id] || []; }
function corDaArea(area){ const a = META_AREAS.find(x=>x.key === area); return a ? a.cor : 'var(--accent)'; }
function nomeDaArea(area){ const a = META_AREAS.find(x=>x.key === area); return a ? a.nome : ''; }

/* ---------- contas ---------- */

function fmtMetaValor(v, unit){
  const n = NUM_META.format(Number(v) || 0);
  if(unit === 'R$') return `R$ ${n}`;
  if(unit === '%') return `${n}%`;
  return unit ? `${n} ${unit}` : n;
}

function dataLonga(iso){
  const [y, m, d] = iso.split('-').map(Number);
  const ano = y !== new Date().getFullYear() ? ` de ${y}` : '';
  return `${d} de ${MESES_LONGOS[m - 1]}${ano}`;
}

function diasAte(iso){
  const [y, m, d] = iso.split('-').map(Number);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - hoje) / 86400000);
}

function textoPrazo(dias){
  if(dias < 0) return `O prazo passou há ${-dias} dia${dias !== -1 ? 's' : ''}`;
  if(dias === 0) return 'O prazo é hoje';
  return `Faltam ${dias} dia${dias !== 1 ? 's' : ''}`;
}

function dataDoPrazo(chave){
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if(chave === '1m') d.setMonth(d.getMonth() + 1);
  else if(chave === '3m') d.setMonth(d.getMonth() + 3);
  else if(chave === '6m') d.setMonth(d.getMonth() + 6);
  else if(chave === 'ano') return `${d.getFullYear()}-12-31`;
  else return null;
  return isoDateFromTimestamp(d.getTime());
}

function textoDias(ws){
  const ds = [...new Set(ws)].sort((a, b)=>a - b);
  if(ds.length === 7) return 'Todo dia';
  if(ds.join() === '1,2,3,4,5') return 'Dias úteis';
  if(ds.join() === '0,6') return 'Fins de semana';
  if(!ds.length) return 'Nenhum dia marcado';
  const nomes = ds.map(i=>DIAS_LONGOS[i].toLowerCase());
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
  return capitaliza(lista);
}

function fraseMeta(g){
  const prazo = g.due ? ` até ${dataLonga(g.due)}` : '';
  if(g.kind === 'numero') return `De ${fmtMetaValor(g.start ?? 0, g.unit)} para ${fmtMetaValor(g.target ?? 0, g.unit)}${prazo}`;
  if(g.kind === 'habito') return `${textoDias(g.weekdays)}${prazo}`;
  if(g.kind === 'etapas') return `${g.steps.length} etapa${g.steps.length !== 1 ? 's' : ''}${prazo}`;
  return g.due ? `Até ${dataLonga(g.due)}` : 'Sem prazo';
}

function metaValorAtual(g){
  const regs = metaRegistros(g).filter(r=>r.value !== null);
  return regs.length ? regs[regs.length - 1].value : (g.start ?? 0);
}

// Dias feitos de um hábito: os marcados à mão na meta mais os dias em que a
// tarefa da rotina ligada foi concluída. É calculado, não copiado: concluir ou
// reabrir a tarefa no Kanban já muda a meta, sem nada para sincronizar.
function metaDiasFeitos(g){
  const dias = new Set(metaRegistros(g).map(r=>r.date));
  if(g.routineId){
    state.tasks.forEach(t=>{
      if(t.routine_id === g.routineId && t.date && taskColumnType(t) === 'done') dias.add(t.date);
    });
  }
  return dias;
}

function metaCriadaIso(g){
  return g.created ? isoDateFromTimestamp(new Date(g.created).getTime()) : todayIso();
}

// Dias de antes de a meta existir não contam como previstos: uma meta criada
// na terça mostrava "0 de 7 nesta semana", contando domingo e segunda.
function metaSemana(g){
  const criada = metaCriadaIso(g);
  const ini = new Date();
  ini.setHours(0, 0, 0, 0);
  ini.setDate(ini.getDate() - ini.getDay());
  const feitos = metaDiasFeitos(g);
  const dias = [];
  for(let i = 0; i < 7; i++){
    const d = new Date(ini);
    d.setDate(ini.getDate() + i);
    const iso = isoDateFromTimestamp(d.getTime());
    dias.push({iso, dow: i, previsto: g.weekdays.includes(i) && iso >= criada, feito: feitos.has(iso)});
  }
  return dias;
}

// A maior sequência de dias previstos feitos sem nenhuma falha, desde a
// criação. Hoje em aberto não interrompe.
function metaMelhorSequencia(g){
  if(!g.weekdays.length) return 0;
  const feitos = metaDiasFeitos(g);
  const hoje = todayIso();
  const [y, m, d] = metaCriadaIso(g).split('-').map(Number);
  const dia = new Date(y, m - 1, d);
  let melhor = 0, atual = 0;
  for(let i = 0; i < 3000; i++){
    const iso = isoDateFromTimestamp(dia.getTime());
    if(iso > hoje) break;
    if(g.weekdays.includes(dia.getDay())){
      if(feitos.has(iso)){ atual++; if(atual > melhor) melhor = atual; }
      else if(iso !== hoje) atual = 0;
    }
    dia.setDate(dia.getDate() + 1);
  }
  return melhor;
}

// Dias previstos seguidos que foram feitos, de hoje para trás. Hoje ainda em
// aberto não quebra a sequência; ela só para no primeiro dia previsto perdido.
function metaSequencia(g){
  if(!g.weekdays.length) return 0;
  const feitos = metaDiasFeitos(g);
  const hoje = todayIso();
  const inicio = g.created ? isoDateFromTimestamp(new Date(g.created).getTime()) : null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let n = 0;
  for(let i = 0; i < 400; i++){
    const iso = isoDateFromTimestamp(d.getTime());
    if(inicio && iso < inicio) break;
    if(g.weekdays.includes(d.getDay())){
      if(feitos.has(iso)) n++;
      else if(iso !== hoje) break;
    }
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function metaProgresso(g){
  if(g.status === 'concluida') return {pct: 1, curto: 'feita', longo: 'Concluída'};
  if(g.kind === 'numero'){
    const atual = metaValorAtual(g);
    const ini = g.start ?? 0;
    const alvo = g.target ?? 0;
    const pct = alvo === ini ? 0 : Math.max(0, Math.min(1, (atual - ini) / (alvo - ini)));
    return {pct, curto: `${Math.round(pct * 100)}%`, longo: `${NUM_META.format(atual)} de ${fmtMetaValor(alvo, g.unit)}`};
  }
  if(g.kind === 'habito'){
    const semana = metaSemana(g);
    const previstos = semana.filter(d=>d.previsto).length;
    const feitos = semana.filter(d=>d.previsto && d.feito).length;
    return {pct: previstos ? feitos / previstos : 0, curto: `${feitos}/${previstos}`, longo: `${feitos} de ${previstos} nesta semana`};
  }
  if(g.kind === 'etapas'){
    const total = g.steps.length;
    const feitas = g.steps.filter(s=>s.ok).length;
    return {pct: total ? feitas / total : 0, curto: `${feitas}/${total}`, longo: `${feitas} de ${total} etapas`};
  }
  const dias = g.due ? diasAte(g.due) : null;
  return {
    pct: 0,
    // Na barra lateral o selo só aparece quando o prazo aperta: "40 dias" em
    // toda meta sem urgência cortava o nome e não pedia nada de ninguém.
    curto: dias === null || dias > 7 ? '' : (dias < 0 ? 'atrasada' : dias === 0 ? 'hoje' : `${dias}d`),
    longo: dias === null ? 'Sem prazo' : textoPrazo(dias)
  };
}

/* ---------- barra lateral ---------- */

function renderSidebarMetas(){
  const wrap = document.getElementById('sidebar-metas');
  if(!wrap) return;
  if(state.metas.precisaSql){
    wrap.innerHTML = `<div class="nav-empty">Falta rodar o supabase/metas.sql</div>`;
    return;
  }
  // Concluídas não ocupam a barra lateral: ficam no histórico, nas Configurações.
  const ativas = state.metas.lista.filter(g=>g.status === 'ativa');
  const item = (g)=>{
    const p = metaProgresso(g);
    const ativo = state.view === 'meta' && state.metas.atual === g.id;
    return `
      <button class="sidebar-project-item sidebar-meta-item ${ativo ? 'active' : ''}" onclick="abrirMeta('${g.id}')" title="${esc(g.title)}"${ativo ? ' aria-current="page"' : ''}>
        <span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}"></span>
        <span class="sidebar-project-name">${esc(g.title)}</span>
        <span class="sidebar-project-role">${esc(p.curto)}</span>
      </button>`;
  };
  let html = ativas.map(item).join('');
  if(!state.metas.lista.length){
    html += `<button class="nav-empty-acao" onclick="abrirNovaMeta()">Criar a primeira meta</button>`;
  }else if(!ativas.length){
    html += `<button class="nav-empty-acao" onclick="abrirNovaMeta()">Criar uma meta</button>`;
  }
  wrap.innerHTML = html;
}

/* ---------- navegação ---------- */

function abrirMeta(id){
  if(!metaPorId(id)) return;
  flushNotesIfPending();
  if(state.view !== 'meta') state.metas.viewAntes = state.view;
  state.metas.atual = id;
  state.view = 'meta';
  state.selecting = false;
  state.selected.clear();
  render();
  window.scrollTo(0, 0);
}

function voltarDaMeta(){
  state.view = state.metas.viewAntes || 'dashboard';
  state.metas.viewAntes = null;
  render();
  window.scrollTo(0, 0);
}

function metaRerender(){
  skipEntranceOnce = true;
  render();
}

/* ---------- criar e editar (passo a passo) ---------- */

let metaRascunho = null;
let metaPasso = 0;
let metaDirecao = 1;
let metaEditandoId = null;
let salvandoMeta = false;

function novoRascunhoMeta(){
  return {
    kind: null, title: '', area: null,
    unit: '', unidadeOutra: false, start: '', target: '',
    freq: 'todo-dia', weekdays: [1, 2, 3, 4, 5], virarRotina: true,
    steps: [{id: idEtapa(), t: '', ok: false}],
    prazo: '3m', prazoTocado: false, due: '', why: ''
  };
}

function rascunhoDaMeta(g){
  const r = novoRascunhoMeta();
  Object.assign(r, {
    kind: g.kind, title: g.title, area: g.area, why: g.why,
    unit: g.unit, unidadeOutra: !!g.unit && !META_UNIDADES.includes(g.unit),
    start: g.start === null ? '' : String(g.start),
    target: g.target === null ? '' : String(g.target),
    freq: g.weekdays.length === 7 ? 'todo-dia' : 'dias',
    weekdays: g.weekdays.length ? [...g.weekdays] : [1, 2, 3, 4, 5],
    virarRotina: !!g.routineId,
    steps: g.steps.length ? g.steps.map(s=>({...s})) : r.steps,
    prazo: g.due ? 'data' : 'sem', prazoTocado: true, due: g.due || ''
  });
  return r;
}

function passosDaMeta(r){
  const p = metaEditandoId ? [] : ['tipo'];
  p.push('nome');
  if(r.kind !== 'unica') p.push('medida');
  p.push('prazo', 'revisao');
  return p;
}

function abrirNovaMeta(){
  if(state.metas.precisaSql){ showToast('Falta rodar o supabase/metas.sql no Supabase.', 'erro'); return; }
  metaEditandoId = null;
  metaRascunho = novoRascunhoMeta();
  metaPasso = 0;
  metaDirecao = 1;
  renderMetaWizard();
  document.getElementById('meta-modal').classList.add('open');
}

function editarMeta(id){
  const g = metaPorId(id);
  if(!g) return;
  metaEditandoId = id;
  metaRascunho = rascunhoDaMeta(g);
  metaPasso = 0;
  metaDirecao = 1;
  renderMetaWizard();
  document.getElementById('meta-modal').classList.add('open');
}

function fecharNovaMeta(){
  document.getElementById('meta-modal').classList.remove('open');
  metaRascunho = null;
  metaEditandoId = null;
}

function fichaMeta(campo, valor, texto, selecionada, cor){
  return `<button type="button" role="radio" aria-checked="${selecionada}" class="meta-ficha ${selecionada ? 'selected' : ''}" data-campo="${campo}" data-valor="${esc(valor)}" onclick="escolherMeta('${campo}','${valor}')">${cor ? `<span class="meta-ficha-cor" style="background:${cor}" aria-hidden="true"></span>` : ''}${esc(texto)}</button>`;
}

function passoTipoMeta(r){
  return `
    <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Que tipo de meta?</h2>
    <div class="meta-tipos" role="radiogroup" aria-labelledby="meta-pergunta">
      ${Object.entries(META_TIPOS).map(([k, t])=>`
        <button type="button" role="radio" aria-checked="${r.kind === k}" class="meta-tipo ${r.kind === k ? 'selected' : ''}" data-tipo="${k}" onclick="escolherTipoMeta('${k}')">
          <svg class="meta-tipo-icone" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${t.icone}</svg>
          <span class="meta-tipo-nome">${t.nome}</span>
          <span class="meta-tipo-ex">${t.exemplo}</span>
        </button>`).join('')}
    </div>`;
}

function passoNomeMeta(r){
  return `
    <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Qual é a meta?</h2>
    <div class="field">
      <label class="sr-only" for="meta-titulo">Nome da meta</label>
      <input type="text" class="input meta-input-grande" id="meta-titulo" maxlength="120" autocomplete="off" placeholder="${esc(META_TIPOS[r.kind].placeholder)}" value="${esc(r.title)}" oninput="metaRascunho.title=this.value">
    </div>
    <div class="field">
      <label id="meta-area-rotulo">Área <span class="meta-opcional">opcional</span></label>
      <div class="meta-fichas" role="radiogroup" aria-labelledby="meta-area-rotulo">
        ${META_AREAS.map(a=>fichaMeta('area', a.key, a.nome, r.area === a.key, a.cor)).join('')}
      </div>
    </div>`;
}

function passoMedidaMeta(r){
  if(r.kind === 'numero'){
    const ini = numMeta(r.start), alvo = numMeta(r.target);
    const dica = ini !== null && alvo !== null && alvo < ini
      ? 'Meta de diminuir: o progresso conta o quanto você já desceu.'
      : 'Dá para registrar somando (mais um livro) ou o valor do dia (o peso de hoje).';
    return `
      <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">De quanto para quanto?</h2>
      <div class="field-row">
        <div class="field">
          <label for="meta-inicio">Começo</label>
          <input type="number" inputmode="decimal" step="any" class="input" id="meta-inicio" placeholder="0" value="${esc(r.start)}" oninput="metaRascunho.start=this.value">
        </div>
        <div class="field">
          <label for="meta-alvo">Alvo</label>
          <input type="number" inputmode="decimal" step="any" class="input" id="meta-alvo" placeholder="12" value="${esc(r.target)}" oninput="metaRascunho.target=this.value">
        </div>
      </div>
      <div class="field">
        <label id="meta-unid-rotulo">Unidade</label>
        <div class="meta-fichas" role="radiogroup" aria-labelledby="meta-unid-rotulo">
          ${META_UNIDADES.map(u=>fichaMeta('unit', u, u, !r.unidadeOutra && r.unit === u)).join('')}
          ${fichaMeta('unit', 'outra', 'Outra', r.unidadeOutra)}
        </div>
        ${r.unidadeOutra ? `<input type="text" class="input meta-unid-outra" id="meta-unid-outra" maxlength="16" autocomplete="off" placeholder="Ex: treinos" aria-label="Nome da unidade" value="${esc(r.unit)}" oninput="metaRascunho.unit=this.value">` : ''}
      </div>
      <p class="meta-dica">${dica}</p>`;
  }
  if(r.kind === 'habito'){
    return `
      <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Com que frequência?</h2>
      <div class="meta-fichas" role="radiogroup" aria-labelledby="meta-pergunta">
        ${fichaMeta('freq', 'todo-dia', 'Todo dia', r.freq === 'todo-dia')}
        ${fichaMeta('freq', 'dias', 'Dias da semana', r.freq === 'dias')}
      </div>
      ${r.freq === 'dias' ? `
      <div class="weekday-picker meta-dias" role="group" aria-label="Dias da semana">
        ${DOW_LETTERS.map((l, i)=>`<button type="button" class="weekday-btn ${r.weekdays.includes(i) ? 'selected' : ''}" aria-pressed="${r.weekdays.includes(i)}" aria-label="${DIAS_LONGOS[i]}" data-dia="${i}" onclick="alternarDiaRascunho(${i})">${l}</button>`).join('')}
      </div>` : ''}
      <div class="field meta-rotina">
        <div class="field-label-row">
          <label for="meta-rotina">Aparecer como tarefa nesses dias</label>
          <label class="sound-toggle">
            <input type="checkbox" id="meta-rotina" ${r.virarRotina ? 'checked' : ''} onchange="metaRascunho.virarRotina=this.checked">
            <span class="sound-toggle-track"><span class="sound-toggle-thumb"></span></span>
          </label>
        </div>
        <p class="meta-dica">Cria uma rotina: a tarefa aparece no Kanban nos dias marcados, e concluí-la marca o dia aqui.</p>
      </div>`;
  }
  // etapas
  return `
    <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Quais são as etapas?</h2>
    <ol class="meta-etapas-edit">
      ${r.steps.map((s, i)=>`
        <li>
          <span class="meta-etapa-n" aria-hidden="true">${i + 1}</span>
          <input type="text" class="input" id="meta-etapa-${s.id}" maxlength="160" autocomplete="off" placeholder="${i === 0 ? 'Ex: Definir o que entra' : 'Próxima etapa'}" aria-label="Etapa ${i + 1}" value="${esc(s.t)}" oninput="textoEtapaRascunho('${s.id}', this.value)" onkeydown="teclaEtapaRascunho(event, '${s.id}')">
          <button type="button" class="meta-etapa-tirar" onclick="tirarEtapaRascunho('${s.id}')" aria-label="Tirar a etapa ${i + 1}" title="Tirar etapa">${ICONE_X}</button>
        </li>`).join('')}
    </ol>
    <button type="button" class="meta-add-etapa" onclick="adicionarEtapaRascunho()">${ICONE_MAIS}Adicionar etapa</button>
    <p class="meta-dica">Enter cria a próxima etapa.</p>`;
}

function passoPrazoMeta(r){
  const dataPronta = r.prazo !== 'sem' && r.prazo !== 'data' ? dataDoPrazo(r.prazo) : null;
  return `
    <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Até quando?</h2>
    <div class="meta-fichas" role="radiogroup" aria-labelledby="meta-pergunta">
      ${META_PRAZOS.map(p=>fichaMeta('prazo', p.key, p.nome, r.prazo === p.key)).join('')}
    </div>
    ${r.prazo === 'data' ? `<input type="date" class="input meta-data" id="meta-data" min="${todayIso()}" aria-label="Data do prazo" value="${esc(r.due)}" oninput="metaRascunho.due=this.value">` : ''}
    ${dataPronta ? `<p class="meta-dica">Até ${dataLonga(dataPronta)}.</p>` : ''}
    <div class="field meta-porque">
      <label for="meta-porque">Por que isso importa? <span class="meta-opcional">opcional</span></label>
      <textarea id="meta-porque" rows="2" maxlength="280" placeholder="Ex: Quero chegar ao fim do ano com mais fôlego" oninput="metaRascunho.why=this.value">${esc(r.why)}</textarea>
    </div>`;
}

function metaDoRascunho(r){
  const linha = linhaDaMeta(r);
  return metaLinha(Object.assign({id: 'previa', created_at: new Date().toISOString()}, linha));
}

// O que a página da meta vai mostrar, em miniatura: a barra de um número, a
// semana de um hábito, as etapas. É aqui que se vê que a página muda por tipo.
function miniaturaMeta(g){
  if(g.kind === 'numero'){
    return `
      <div class="meta-mini-placar"><span>${NUM_META.format(g.start ?? 0)}</span> de ${esc(fmtMetaValor(g.target ?? 0, g.unit))}</div>
      ${barraMeta(0, null)}`;
  }
  if(g.kind === 'habito'){
    return `<div class="meta-mini-semana">${DOW_LETTERS.map((l, i)=>`<span class="${g.weekdays.includes(i) ? 'previsto' : ''}">${l}</span>`).join('')}</div>`;
  }
  if(g.kind === 'etapas'){
    const extra = g.steps.length > 4 ? `<li class="meta-mini-mais">mais ${g.steps.length - 4}</li>` : '';
    return `<ol class="meta-mini-etapas">${g.steps.slice(0, 4).map(s=>`<li><span class="meta-etapa-box" aria-hidden="true"></span>${esc(s.t)}</li>`).join('')}${extra}</ol>`;
  }
  return '';
}

function passoRevisaoMeta(r){
  const g = metaDoRascunho(r);
  const editar = (passo, rotulo)=> passosDaMeta(r).includes(passo)
    ? `<button type="button" class="meta-editar-passo" onclick="irParaPassoMeta('${passo}')">${rotulo || 'Editar'}</button>` : '';
  const mini = miniaturaMeta(g);
  return `
    <h2 class="meta-pergunta" id="meta-pergunta" tabindex="-1">Tudo certo?</h2>
    <div class="meta-previa">
      <div class="meta-previa-topo">
        <div class="meta-previa-titulo"><span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span>${esc(g.title)}</div>
        ${editar('nome', 'Editar nome')}
      </div>
      ${mini ? `<div class="meta-previa-mini">${mini}</div>` : ''}
      ${r.kind !== 'unica' ? `<div class="meta-previa-pe">${editar('medida', r.kind === 'etapas' ? 'Editar etapas' : r.kind === 'habito' ? 'Editar dias' : 'Editar medida')}</div>` : ''}
    </div>
    <dl class="meta-resumo">
      <dt>Tipo</dt><dd><span>${META_TIPOS[r.kind].nome}</span>${editar('tipo')}</dd>
      <dt>Área</dt><dd><span>${g.area ? nomeDaArea(g.area) : 'Nenhuma'}</span>${editar('nome')}</dd>
      ${r.kind === 'habito' ? `<dt>Tarefa</dt><dd><span>${r.virarRotina ? 'Aparece no Kanban nos dias marcados' : 'Não vira tarefa'}</span>${editar('medida')}</dd>` : ''}
      <dt>Prazo</dt><dd><span>${g.due ? dataLonga(g.due) : 'Sem prazo'}</span>${editar('prazo')}</dd>
      ${g.why ? `<dt>Por quê</dt><dd><span>${esc(g.why)}</span>${editar('prazo')}</dd>` : ''}
    </dl>`;
}

function renderMetaWizard(foco){
  const r = metaRascunho;
  if(!r) return;
  const passos = passosDaMeta(r);
  metaPasso = Math.max(0, Math.min(metaPasso, passos.length - 1));
  const passo = passos[metaPasso];
  document.getElementById('meta-modal-title').textContent = metaEditandoId ? 'Editar meta' : 'Nova meta';
  const pontos = document.getElementById('meta-dots');
  pontos.innerHTML = passos.map((p, i)=>`<span class="${i < metaPasso ? 'feito' : (i === metaPasso ? 'atual' : '')}"></span>`).join('');
  pontos.setAttribute('aria-label', `Passo ${metaPasso + 1} de ${passos.length}`);

  const conteudo = passo === 'tipo' ? passoTipoMeta(r)
    : passo === 'nome' ? passoNomeMeta(r)
    : passo === 'medida' ? passoMedidaMeta(r)
    : passo === 'prazo' ? passoPrazoMeta(r)
    : passoRevisaoMeta(r);
  const anim = metaDirecao > 0 ? '' : (metaDirecao < 0 ? 'volta' : 'parado');
  document.getElementById('meta-modal-body').innerHTML = `
    <div class="meta-passo ${anim}">
      ${conteudo}
      <p class="meta-erro" id="meta-erro" role="alert"></p>
    </div>`;

  document.getElementById('meta-voltar').textContent = metaPasso === 0 ? 'Cancelar' : 'Voltar';
  const seguir = document.getElementById('meta-seguir');
  seguir.textContent = passo === 'revisao' ? (metaEditandoId ? 'Salvar meta' : 'Criar meta') : 'Continuar';
  seguir.disabled = passo === 'tipo' && !r.kind;

  // Depois do observador de foco dos modais: o foco vai para o que se
  // responde neste passo, não para o botão de fechar.
  // Sem tipo escolhido, o foco vai para a pergunta: no primeiro cartão, o
  // anel de foco parecia uma seleção enquanto o Continuar seguia desabilitado.
  const candidatos = passo === 'tipo' ? (r.kind ? ['.meta-tipo.selected'] : ['#meta-pergunta'])
    : passo === 'revisao' ? ['#meta-pergunta']
    : ['input:not([type=checkbox])', '.meta-ficha.selected', '.meta-ficha'];
  setTimeout(()=>{
    let alvo = foco ? document.querySelector(foco) : null;
    for(const sel of candidatos){
      if(alvo) break;
      alvo = document.querySelector(`#meta-modal-body ${sel}`);
    }
    if(alvo) alvo.focus();
  }, 40);
}

function erroMeta(msg, focoSel){
  const el = document.getElementById('meta-erro');
  if(el) el.textContent = msg;
  if(focoSel){ const f = document.querySelector(focoSel); if(f) f.focus(); }
}

function rerenderPassoMeta(foco){
  metaDirecao = 0;
  renderMetaWizard(foco);
}

function escolherTipoMeta(k){
  if(!META_TIPOS[k] || !metaRascunho) return;
  metaRascunho.kind = k;
  // Hábito costuma não ter data para acabar; o resto nasce com 3 meses.
  if(!metaRascunho.prazoTocado) metaRascunho.prazo = k === 'habito' ? 'sem' : '3m';
  avancarMeta();
}

const CAMPOS_ESCOLHA_META = {
  area: META_AREAS.map(a=>a.key),
  unit: [...META_UNIDADES, 'outra'],
  freq: ['todo-dia', 'dias'],
  prazo: META_PRAZOS.map(p=>p.key)
};

function escolherMeta(campo, valor){
  const r = metaRascunho;
  if(!r || !(CAMPOS_ESCOLHA_META[campo] || []).includes(valor)) return;
  if(campo === 'area') r.area = r.area === valor ? null : valor;
  else if(campo === 'unit'){
    if(valor === 'outra'){
      if(!r.unidadeOutra){ r.unidadeOutra = true; r.unit = ''; }
    }else{ r.unidadeOutra = false; r.unit = valor; }
  }
  else if(campo === 'freq') r.freq = valor;
  else if(campo === 'prazo'){ r.prazo = valor; r.prazoTocado = true; }
  const foco = campo === 'unit' && valor === 'outra' ? '#meta-unid-outra'
    : campo === 'prazo' && valor === 'data' ? '#meta-data'
    : `.meta-ficha[data-campo="${campo}"][data-valor="${valor}"]`;
  rerenderPassoMeta(foco);
}

function alternarDiaRascunho(i){
  const r = metaRascunho;
  if(!r || !Number.isInteger(i)) return;
  r.weekdays = r.weekdays.includes(i) ? r.weekdays.filter(d=>d !== i) : [...r.weekdays, i];
  rerenderPassoMeta(`.meta-dias [data-dia="${i}"]`);
}

function textoEtapaRascunho(id, texto){
  const s = metaRascunho && metaRascunho.steps.find(x=>x.id === id);
  if(s) s.t = texto;
}

function adicionarEtapaRascunho(depoisDe){
  const r = metaRascunho;
  if(!r) return;
  const nova = {id: idEtapa(), t: '', ok: false};
  const i = depoisDe ? r.steps.findIndex(s=>s.id === depoisDe) : -1;
  if(i === -1) r.steps.push(nova); else r.steps.splice(i + 1, 0, nova);
  rerenderPassoMeta(`#meta-etapa-${nova.id}`);
}

function tirarEtapaRascunho(id){
  const r = metaRascunho;
  if(!r) return;
  const i = r.steps.findIndex(s=>s.id === id);
  if(i === -1) return;
  r.steps.splice(i, 1);
  if(!r.steps.length) r.steps.push({id: idEtapa(), t: '', ok: false});
  const vizinha = r.steps[Math.max(0, i - 1)];
  rerenderPassoMeta(`#meta-etapa-${vizinha.id}`);
}

// Enter cria a próxima etapa logo abaixo; Backspace numa etapa vazia a tira.
// O preventDefault faz o atalho global de Enter (que avança o passo) ignorar.
function teclaEtapaRascunho(e, id){
  if(e.isComposing) return;
  if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey){
    e.preventDefault();
    adicionarEtapaRascunho(id);
  }else if(e.key === 'Backspace' && !e.target.value && metaRascunho.steps.length > 1){
    e.preventDefault();
    tirarEtapaRascunho(id);
  }
}

function validarPassoMeta(passo){
  const r = metaRascunho;
  if(passo === 'tipo' && !r.kind) return ['Escolha um tipo de meta.'];
  if(passo === 'nome' && !r.title.trim()) return ['Dê um nome para a meta.', '#meta-titulo'];
  if(passo === 'medida'){
    if(r.kind === 'numero'){
      const ini = numMeta(r.start), alvo = numMeta(r.target);
      if(alvo === null) return ['Diga o alvo: o número aonde você quer chegar.', '#meta-alvo'];
      if((ini ?? 0) === alvo) return ['O alvo precisa ser diferente do começo.', '#meta-alvo'];
      if(r.unidadeOutra && !r.unit.trim()) return ['Escreva a unidade ou escolha uma da lista.', '#meta-unid-outra'];
    }
    if(r.kind === 'habito' && r.freq === 'dias' && !r.weekdays.length) return ['Marque pelo menos um dia da semana.'];
    if(r.kind === 'etapas' && !r.steps.some(s=>s.t.trim())) return ['Escreva pelo menos uma etapa.', '.meta-etapas-edit input'];
  }
  if(passo === 'prazo' && r.prazo === 'data' && !r.due) return ['Escolha a data do prazo.', '#meta-data'];
  return null;
}

function avancarMeta(){
  const r = metaRascunho;
  if(!r) return;
  const passos = passosDaMeta(r);
  const passo = passos[metaPasso];
  const erro = validarPassoMeta(passo);
  if(erro){ erroMeta(erro[0], erro[1]); return; }
  if(passo === 'revisao'){ salvarMeta(); return; }
  metaPasso++;
  metaDirecao = 1;
  renderMetaWizard();
}

function voltarMeta(){
  if(!metaRascunho) return;
  if(metaPasso === 0){ fecharNovaMeta(); return; }
  metaPasso--;
  metaDirecao = -1;
  renderMetaWizard();
}

function irParaPassoMeta(passo){
  const i = passosDaMeta(metaRascunho).indexOf(passo);
  if(i === -1) return;
  metaPasso = i;
  metaDirecao = -1;
  renderMetaWizard();
}

function linhaDaMeta(r){
  const due = r.prazo === 'sem' ? null : (r.prazo === 'data' ? (r.due || null) : dataDoPrazo(r.prazo));
  const linha = {
    kind: r.kind,
    title: r.title.trim().slice(0, 120),
    area: r.area,
    why: r.why.trim().slice(0, 280) || null,
    due_date: due,
    unit: null, start_value: null, target_value: null, weekdays: null, steps: [],
    updated_at: new Date().toISOString()
  };
  if(r.kind === 'numero'){
    linha.unit = r.unit.trim().slice(0, 16) || null;
    linha.start_value = numMeta(r.start) ?? 0;
    linha.target_value = numMeta(r.target);
  }
  if(r.kind === 'habito') linha.weekdays = r.freq === 'todo-dia' ? [0, 1, 2, 3, 4, 5, 6] : [...r.weekdays].sort((a, b)=>a - b);
  if(r.kind === 'etapas') linha.steps = r.steps.filter(s=>s.t.trim()).map(s=>({id: s.id, t: s.t.trim().slice(0, 160), ok: !!s.ok}));
  return linha;
}

function rotinaDoHabito(linha, existente){
  return {
    title: linha.title,
    client: existente ? existente.client : '',
    status: existente && existente.status ? existente.status : getColumns()[0].key,
    priority: existente ? existente.priority : 'normal',
    time: existente ? existente.time : '',
    weekdays: linha.weekdays
  };
}

async function salvarMeta(){
  if(salvandoMeta || !metaRascunho) return;
  const btn = document.getElementById('meta-seguir');
  const textoBtn = btn.textContent;
  salvandoMeta = true;
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try{
    if(metaEditandoId) await atualizarMeta(metaRascunho);
    else await criarMeta(metaRascunho);
  }finally{
    salvandoMeta = false;
    btn.disabled = false;
    if(btn.textContent === 'Salvando…') btn.textContent = textoBtn;
  }
}

// A meta é gravada primeiro e a rotina depois: se a rotina falhar, a meta
// existe e dá para ligar o "aparecer como tarefa" editando. Na ordem inversa,
// uma falha deixava uma rotina órfã que já tinha criado a tarefa de hoje.
async function criarMeta(r){
  const linha = linhaDaMeta(r);
  const {data, error} = await sb.from('goals').insert({...linha, user_id: session.user.id}).select().single();
  if(error){
    console.error(error);
    erroMeta('Não deu para criar a meta. Confira a conexão e tente de novo.');
    return false;
  }
  const g = metaLinha(data);
  state.metas.lista.push(g);
  let avisoRotina = '';
  if(r.kind === 'habito' && r.virarRotina){
    const rotina = await createRoutine(rotinaDoHabito(linha));
    if(rotina){
      const {error: errLiga} = await sb.from('goals').update({routine_id: rotina.id}).eq('id', g.id);
      if(errLiga){ console.error(errLiga); avisoRotina = ' A rotina foi criada, mas não ficou ligada à meta.'; }
      else g.routineId = rotina.id;
    }else{
      avisoRotina = ' A tarefa nos dias marcados não foi criada; ligue de novo em Editar.';
    }
  }
  fecharNovaMeta();
  abrirMeta(g.id);
  showToast(`Meta criada.${avisoRotina}`, avisoRotina ? 'erro' : undefined);
  return true;
}

async function atualizarMeta(r){
  const g = metaPorId(metaEditandoId);
  if(!g) return false;
  const linha = linhaDaMeta(r);
  let routineId = g.routineId;
  if(g.kind === 'habito'){
    const existente = routineId ? state.routines.find(x=>x.id === routineId) : null;
    if(routineId && !existente) routineId = null;
    if(r.virarRotina && routineId){
      if(!await updateRoutineRemote(routineId, rotinaDoHabito(linha, existente))) return false;
      await generateRoutineInstances();
    }else if(r.virarRotina && !routineId){
      const rotina = await createRoutine(rotinaDoHabito(linha));
      if(!rotina) return false;
      routineId = rotina.id;
    }else if(!r.virarRotina && routineId){
      if(!await deleteRoutineRemote(routineId)) return false;
      routineId = null;
    }
  }
  const {data, error} = await sb.from('goals').update({...linha, routine_id: routineId}).eq('id', g.id).select().single();
  if(error){
    console.error(error);
    erroMeta('Não deu para salvar a meta. Confira a conexão e tente de novo.');
    return false;
  }
  Object.assign(g, metaLinha(data));
  fecharNovaMeta();
  metaRerender();
  if(metaNoAlvo(g)){ await concluirMeta(g.id, true); return true; }
  showToast('Meta salva');
  return true;
}

/* ---------- ações na página da meta ---------- */

async function gravarMeta(g, patch, msgErro){
  const {error} = await sb.from('goals').update({...patch, updated_at: new Date().toISOString()}).eq('id', g.id);
  if(error){
    console.error(error);
    showToast(msgErro || 'Não deu para salvar. Tente de novo em instantes.', 'erro');
    return false;
  }
  return true;
}

async function concluirMeta(id, automatico){
  const g = metaPorId(id);
  if(!g) return;
  const agora = new Date().toISOString();
  if(!await gravarMeta(g, {status: 'concluida', completed_at: agora}, 'Não deu para concluir a meta. Tente de novo em instantes.')) return;
  g.status = 'concluida';
  g.completedAt = agora;
  metaRerender();
  showToast(automatico ? 'Chegou a 100%: meta concluída e guardada no histórico' : 'Meta concluída');
}

async function reabrirMeta(id){
  const g = metaPorId(id);
  if(!g) return;
  if(!await gravarMeta(g, {status: 'ativa', completed_at: null}, 'Não deu para reabrir a meta. Tente de novo em instantes.')) return;
  g.status = 'ativa';
  g.completedAt = null;
  metaRerender();
  showToast('Meta reaberta');
}

async function excluirMeta(id){
  const g = metaPorId(id);
  if(!g) return;
  // As tarefas que a rotina do hábito criou saem junto: sem a meta elas
  // ficavam soltas no Kanban. Precisa ser antes de apagar a rotina, que no
  // banco zera o routine_id delas (on delete set null) e o vínculo se perde.
  const daRotina = g.routineId ? state.tasks.filter(t=>t.routine_id === g.routineId) : [];
  const texto = g.routineId
    ? `Os registros dela, a rotina ligada e ${daRotina.length === 1 ? 'a tarefa que ela criou somem' : `as ${daRotina.length} tarefas que ela criou somem`} junto. Não tem como desfazer.`
    : 'Os registros dela somem junto. Não tem como desfazer.';
  if(!await confirmar(texto, {title: 'Excluir esta meta?', okLabel: 'Excluir meta'})) return;
  for(const t of daRotina){
    await forgetTaskInGoogle(t);
    if(await deleteTaskRemote(t.id)) state.tasks = state.tasks.filter(x=>x.id !== t.id);
  }
  if(g.routineId && !await deleteRoutineRemote(g.routineId)) return;
  const {error} = await sb.from('goals').delete().eq('id', g.id);
  if(error){ console.error(error); showToast('Não deu para excluir a meta. Tente de novo em instantes.', 'erro'); return; }
  state.metas.lista = state.metas.lista.filter(x=>x.id !== g.id);
  delete state.metas.registros[g.id];
  voltarDaMeta();
  showToast('Meta excluída');
}

function modoRegistroMeta(id, absoluto){
  state.metas.modo[id] = !!absoluto;
  metaRerender();
  setTimeout(()=>{ const i = document.getElementById('meta-valor'); if(i) i.focus(); }, 30);
}

function metaModoAbsoluto(g){
  return g.id in state.metas.modo ? state.metas.modo[g.id] : META_UNIDADES_ABSOLUTAS.includes(g.unit);
}

async function gravarRegistroMeta(g, iso, value){
  const {data, error} = await sb.from('goal_entries')
    .upsert({goal_id: g.id, user_id: session.user.id, date: iso, value}, {onConflict: 'goal_id,date'})
    .select('id, goal_id, date, value').single();
  if(error){ console.error(error); showToast('Não deu para registrar. Confira a conexão e tente de novo.', 'erro'); return false; }
  const lista = (state.metas.registros[g.id] || []).filter(r=>r.date !== iso);
  lista.push({id: data.id, date: data.date, value: numMeta(data.value)});
  lista.sort((a, b)=>a.date.localeCompare(b.date));
  state.metas.registros[g.id] = lista;
  return true;
}

async function registrarValorMeta(id){
  const g = metaPorId(id);
  const input = document.getElementById('meta-valor');
  if(!g || !input) return;
  const n = numMeta(input.value);
  if(n === null){ showToast('Digite um número para registrar.', 'erro'); input.focus(); return; }
  const absoluto = metaModoAbsoluto(g);
  const novo = absoluto ? n : metaValorAtual(g) + n;
  if(!await gravarRegistroMeta(g, todayIso(), novo)) return;
  metaRerender();
  if(metaNoAlvo(g)){ await concluirMeta(g.id, true); return; }
  showToast(`Registrado: ${fmtMetaValor(novo, g.unit)}`);
}

async function apagarRegistroMeta(goalId, regId){
  const g = metaPorId(goalId);
  if(!g) return;
  const {error} = await sb.from('goal_entries').delete().eq('id', regId);
  if(error){ console.error(error); showToast('Não deu para apagar o registro. Tente de novo em instantes.', 'erro'); return; }
  state.metas.registros[g.id] = metaRegistros(g).filter(r=>r.id !== regId);
  metaRerender();
}

async function alternarDiaHabito(goalId, iso){
  const g = metaPorId(goalId);
  if(!g || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > todayIso() || iso < metaCriadaIso(g)) return;
  // Guardado antes do redesenho: depois dele o foco já não está no botão.
  const veioDoCalendario = !!(document.activeElement && document.activeElement.classList.contains('meta-cal-dia'));
  const manual = metaRegistros(g).find(r=>r.date === iso);
  if(manual){
    const {error} = await sb.from('goal_entries').delete().eq('id', manual.id);
    if(error){ console.error(error); showToast('Não deu para desmarcar o dia. Tente de novo em instantes.', 'erro'); return; }
    state.metas.registros[g.id] = metaRegistros(g).filter(r=>r.id !== manual.id);
  }else if(metaDiasFeitos(g).has(iso)){
    // O dia conta pela tarefa concluída da rotina: desmarcar aqui não teria
    // efeito, porque a tarefa continua concluída.
    showToast('Esse dia conta pela tarefa da rotina. Reabra a tarefa no Kanban para desmarcar.');
    return;
  }else if(!await gravarRegistroMeta(g, iso, null)){
    return;
  }
  metaRerender();
  // Devolve o foco ao dia clicado, na semana ou no calendário.
  setTimeout(()=>{ const b = document.querySelector(`${veioDoCalendario ? '.meta-cal-dia' : '.meta-dia'}[data-dia="${iso}"]`); if(b) b.focus(); }, 30);
}

async function salvarEtapasMeta(g, novas, msgErro){
  const antes = g.steps;
  g.steps = novas;
  metaRerender();
  if(!await gravarMeta(g, {steps: novas}, msgErro)){
    g.steps = antes;
    metaRerender();
    return false;
  }
  await concluirSeNoAlvo(g);
  return true;
}

async function alternarEtapa(goalId, stepId){
  const g = metaPorId(goalId);
  if(!g) return;
  const novas = g.steps.map(s=>s.id === stepId ? {...s, ok: !s.ok} : s);
  await salvarEtapasMeta(g, novas, 'Não deu para marcar a etapa. Tente de novo em instantes.');
  setTimeout(()=>{ const b = document.querySelector(`.meta-etapa-check[data-etapa="${stepId}"]`); if(b) b.focus(); }, 30);
}

async function adicionarEtapa(goalId){
  const g = metaPorId(goalId);
  const input = document.getElementById('meta-nova-etapa');
  if(!g || !input) return;
  const t = input.value.trim().slice(0, 160);
  if(!t){ input.focus(); return; }
  if(await salvarEtapasMeta(g, [...g.steps, {id: idEtapa(), t, ok: false}], 'Não deu para adicionar a etapa. Tente de novo em instantes.')){
    setTimeout(()=>{ const i = document.getElementById('meta-nova-etapa'); if(i) i.focus(); }, 30);
  }
}

async function tirarEtapa(goalId, stepId){
  const g = metaPorId(goalId);
  if(!g) return;
  await salvarEtapasMeta(g, g.steps.filter(s=>s.id !== stepId), 'Não deu para apagar a etapa. Tente de novo em instantes.');
}

/* ---------- página da meta ---------- */

// Onde o progresso deveria estar hoje, se o avanço fosse em linha reta da
// criação até o prazo. null quando não há prazo para medir.
function metaRitmoEsperado(g){
  if(!g.due || !g.created) return null;
  const ini = new Date(g.created).getTime();
  const [y, m, d] = g.due.split('-').map(Number);
  const fim = new Date(y, m - 1, d, 23, 59, 59).getTime();
  if(!(fim > ini)) return null;
  return Math.max(0, Math.min(1, (Date.now() - ini) / (fim - ini)));
}

function barraMeta(pct, esperado){
  const p = Math.max(0, Math.min(1, pct));
  const marca = esperado === null ? '' : `<i class="meta-barra-ritmo" style="left:${(esperado * 100).toFixed(1)}%" title="Onde o ritmo pedia que você estivesse hoje"></i>`;
  const texto = esperado === null ? '' : ` aria-valuetext="${Math.round(p * 100)}%; o ritmo pedia ${Math.round(esperado * 100)}% hoje"`;
  return `<div class="meta-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"${texto}><span style="width:${(p * 100).toFixed(1)}%"></span>${marca}</div>`;
}

function textoRitmo(g, p){
  const esperado = metaRitmoEsperado(g);
  if(esperado === null || p.pct >= 1 || g.status === 'concluida') return '';
  const diff = Math.round((p.pct - esperado) * 100);
  const quando = Math.abs(diff) <= 2 ? 'No ritmo' : diff > 0 ? 'À frente do ritmo' : 'Atrás do ritmo';
  return `<p class="meta-dica">${quando}: a marca na barra é onde você deveria estar hoje.</p>`;
}

function renderMetaChegou(g, p){
  if(g.status === 'concluida' || p.pct < 1) return '';
  return `
    <div class="meta-chegou">
      <span>Você chegou ao alvo.</span>
      <button class="btn-primary" onclick="concluirMeta('${g.id}')">Concluir meta</button>
    </div>`;
}

function renderMetaNumero(g, p){
  const atual = metaValorAtual(g);
  const alvo = g.target ?? 0;
  const falta = Math.max(0, (g.target ?? 0) > (g.start ?? 0) ? alvo - atual : atual - alvo);
  let ritmo;
  if(p.pct >= 1) ritmo = 'Alvo alcançado.';
  else if(g.due){
    const dias = diasAte(g.due);
    if(dias > 0){
      const porSemana = falta / Math.max(dias / 7, 1);
      ritmo = `Faltam ${fmtMetaValor(falta, g.unit)} em ${dias} dia${dias !== 1 ? 's' : ''}: cerca de ${fmtMetaValor(porSemana, g.unit)} por semana.`;
    }else ritmo = `${textoPrazo(dias)}, e faltam ${fmtMetaValor(falta, g.unit)}.`;
  }else ritmo = `Faltam ${fmtMetaValor(falta, g.unit)}.`;
  const absoluto = metaModoAbsoluto(g);
  // Cada registro guarda o total do dia; a lista mostra quanto ele mudou em
  // relação ao anterior. Só o total ("5 livros", "3 livros") parecia soma.
  const todos = metaRegistros(g).filter(r=>r.value !== null);
  const regs = todos.map((r, i)=>({...r, delta: r.value - (i ? todos[i - 1].value : (g.start ?? 0))})).slice(-8).reverse();
  const fmtDelta = (v)=> v === 0 ? 'sem mudança' : `${v > 0 ? '+' : '−'}${fmtMetaValor(Math.abs(v), g.unit)}`;
  return `
    <div class="meta-placar">
      <div class="meta-placar-num"><span class="meta-atual">${NUM_META.format(atual)}</span><span class="meta-alvo">de ${esc(fmtMetaValor(alvo, g.unit))}</span></div>
      <div class="meta-pct">${Math.round(p.pct * 100)}%</div>
    </div>
    ${barraMeta(p.pct, g.status === 'concluida' ? null : metaRitmoEsperado(g))}
    <p class="meta-ritmo">${esc(ritmo)}</p>
    ${textoRitmo(g, p)}
    ${renderMetaChegou(g, p)}
    ${g.status === 'concluida' ? '' : `
    <div class="meta-registro">
      <div class="meta-modo" role="group" aria-label="Como registrar">
        <button type="button" class="${absoluto ? '' : 'ativo'}" aria-pressed="${!absoluto}" onclick="modoRegistroMeta('${g.id}', false)">Somar</button>
        <button type="button" class="${absoluto ? 'ativo' : ''}" aria-pressed="${absoluto}" onclick="modoRegistroMeta('${g.id}', true)">Valor de hoje</button>
      </div>
      <input type="number" inputmode="decimal" step="any" class="input" id="meta-valor" autocomplete="off" placeholder="${absoluto ? `Ex: ${NUM_META.format(atual)}` : 'Ex: 1'}" aria-label="${absoluto ? 'Valor de hoje' : 'Quanto somar'}" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();registrarValorMeta('${g.id}')}">
      <button class="btn-primary" onclick="registrarValorMeta('${g.id}')">Registrar</button>
    </div>`}
    <h2 class="meta-sub">Registros</h2>
    ${regs.length ? `<ul class="meta-historico">${regs.map(r=>`
      <li>
        <span class="meta-reg-data">${fmtDate(r.date)}</span>
        <span class="meta-reg-valor">${esc(fmtDelta(r.delta))}</span>
        <span class="meta-reg-total">total ${esc(fmtMetaValor(r.value, g.unit))}</span>
        <button class="meta-etapa-tirar" onclick="apagarRegistroMeta('${g.id}','${r.id}')" aria-label="Apagar o registro de ${fmtDate(r.date)}" title="Apagar registro">${ICONE_X}</button>
      </li>`).join('')}</ul>`
      : `<p class="meta-vazio">Nenhum registro ainda. O primeiro valor que você registrar aparece aqui.</p>`}`;
}

function renderMetaHabito(g, p){
  const hoje = todayIso();
  const criada = metaCriadaIso(g);
  const semana = metaSemana(g);
  const seq = metaSequencia(g);
  const recorde = metaMelhorSequencia(g);
  const previstos = semana.filter(d=>d.previsto).length;
  const feitos = semana.filter(d=>d.previsto && d.feito).length;
  return `
    <div class="meta-habito">
      <div class="meta-habito-principal">
        <div class="meta-semana" role="group" aria-label="Esta semana">
          ${semana.map(d=>`
            <button type="button" class="meta-dia ${d.previsto ? 'previsto' : ''} ${d.feito ? 'feito' : ''} ${d.iso === hoje ? 'hoje' : ''}" data-dia="${d.iso}" aria-pressed="${d.feito}" aria-label="${DIAS_LONGOS[d.dow]}, ${fmtDate(d.iso)}${d.iso < criada ? ', antes da meta' : d.previsto ? '' : ', fora dos dias marcados'}" ${d.iso > hoje || d.iso < criada || g.status === 'concluida' ? 'disabled' : ''} onclick="alternarDiaHabito('${g.id}','${d.iso}')">
              <span class="meta-dia-letra">${DOW_LETTERS[d.dow]}</span>
              <span class="meta-dia-marca">${d.feito ? ICONE_CHECK : ''}</span>
            </button>`).join('')}
        </div>
        <div class="meta-habito-numeros">
          <div><strong>${seq}</strong>${seq === 1 ? 'dia seguido' : 'dias seguidos'}</div>
          <div><strong>${recorde}</strong>${recorde === 1 ? 'dia de recorde' : 'dias de recorde'}</div>
          <div><strong>${feitos} de ${previstos}</strong>nesta semana</div>
        </div>
        ${renderMetaSemanas(g)}
        <p class="meta-dica meta-dica-pe">${g.routineId
          ? 'Aparece como tarefa nos dias marcados; concluir a tarefa marca o dia aqui e no calendário.'
          : 'Marque os dias feitos aqui ou no calendário. Para virar tarefa nos dias marcados, ligue em Editar.'}</p>
      </div>
      ${renderMetaCalendario(g)}
    </div>`;
}

// Semana a semana: quanto dos dias marcados foi feito em cada semana, até as
// 8 mais recentes. Mostra a tendência que o calendário, mês a mês, não deixa
// ver. Uma série só: todas as barras na cor de destaque; o valor escrito fica
// só na semana atual e o resto vai no balão (mouse e teclado) e na lista.
function renderMetaSemanas(g){
  const hoje = todayIso();
  const criada = metaCriadaIso(g);
  const feitos = metaDiasFeitos(g);
  const semanaAtual = new Date();
  semanaAtual.setHours(0, 0, 0, 0);
  semanaAtual.setDate(semanaAtual.getDate() - semanaAtual.getDay());
  const [cy, cm, cd] = criada.split('-').map(Number);
  const semanaCriada = new Date(cy, cm - 1, cd);
  semanaCriada.setDate(semanaCriada.getDate() - semanaCriada.getDay());
  const total = Math.min(8, Math.round((semanaAtual - semanaCriada) / (7 * 86400000)) + 1);
  // Uma barra só não é gráfico: a semana atual já está na faixa logo acima.
  if(total < 2) return '';
  const colunas = [];
  for(let w = total - 1; w >= 0; w--){
    const inicio = new Date(semanaAtual);
    inicio.setDate(inicio.getDate() - 7 * w);
    let previstos = 0, feitosSemana = 0;
    for(let i = 0; i < 7; i++){
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      const iso = isoDateFromTimestamp(d.getTime());
      if(iso < criada || iso > hoje || !g.weekdays.includes(d.getDay())) continue;
      previstos++;
      if(feitos.has(iso)) feitosSemana++;
    }
    colunas.push({inicio: isoDateFromTimestamp(inicio.getTime()), previstos, feitos: feitosSemana, atual: w === 0});
  }
  const ALTURA = 72;
  return `
    <h2 class="meta-sub">Semana a semana</h2>
    <div class="meta-colunas" role="list" aria-label="Dias marcados feitos em cada semana">
      ${colunas.map(c=>{
        const pct = c.previstos ? c.feitos / c.previstos : 0;
        const valor = c.previstos ? `${c.feitos}/${c.previstos}` : '—';
        const texto = c.previstos ? `${c.feitos} de ${c.previstos} dias marcados` : 'nenhum dia marcado';
        return `
          <div class="meta-col ${c.atual ? 'atual' : ''}" role="listitem" tabindex="0" aria-label="Semana de ${fmtDate(c.inicio)}${c.atual ? ', esta semana' : ''}: ${texto}">
            <div class="meta-col-area" aria-hidden="true">
              ${c.atual ? `<span class="meta-col-valor">${valor}</span>` : ''}
              <span class="meta-col-barra" style="height:${Math.round(pct * ALTURA)}px"></span>
            </div>
            <span class="meta-col-data" aria-hidden="true">${fmtDate(c.inicio)}</span>
            <span class="meta-col-dica" aria-hidden="true"><strong>${valor}</strong>${c.atual ? 'esta semana' : `semana de ${fmtDate(c.inicio)}`}</span>
          </div>`;
      }).join('')}
    </div>`;
}

// Mês mostrado no calendário do hábito. Volta para o mês atual ao abrir
// outra meta: a navegação de uma não vaza para a outra.
function mesDaMeta(g){
  const c = state.metas.calMes;
  if(c && c.goal === g.id) return new Date(c.ano, c.mes, 1);
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
}

function mudarMesMeta(id, delta){
  const g = metaPorId(id);
  if(!g) return;
  const atual = mesDaMeta(g);
  const alvo = new Date(atual.getFullYear(), atual.getMonth() + delta, 1);
  state.metas.calMes = {goal: id, ano: alvo.getFullYear(), mes: alvo.getMonth()};
  metaRerender();
  setTimeout(()=>{
    const b = document.querySelector(`.meta-cal [data-mes-nav="${delta < 0 ? 'ant' : 'prox'}"]`);
    if(b && !b.disabled) b.focus();
  }, 30);
}

// O mês inteiro: feito (cheio), não feito (contorno), previsto (tracejado),
// hoje (anel). Dá para marcar ou desmarcar qualquer dia entre a criação e hoje.
function renderMetaCalendario(g){
  const hoje = todayIso();
  const criada = metaCriadaIso(g);
  const feitos = metaDiasFeitos(g);
  const mes = mesDaMeta(g);
  const ano = mes.getFullYear();
  const m = mes.getMonth();
  const agora = new Date();
  const [cy, cm] = criada.split('-').map(Number);
  const podeVoltar = ano > cy || (ano === cy && m > cm - 1);
  const podeAvancar = ano < agora.getFullYear() || (ano === agora.getFullYear() && m < agora.getMonth());
  const diasNoMes = new Date(ano, m + 1, 0).getDate();
  let celulas = '';
  for(let i = 0; i < mes.getDay(); i++) celulas += '<span aria-hidden="true"></span>';
  let previstosMes = 0, feitosMes = 0;
  for(let dia = 1; dia <= diasNoMes; dia++){
    const iso = `${ano}-${String(m + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const dow = new Date(ano, m, dia).getDay();
    const antes = iso < criada;
    const futuro = iso > hoje;
    const previsto = g.weekdays.includes(dow) && !antes;
    const feito = feitos.has(iso);
    if(previsto && !futuro){ previstosMes++; if(feito) feitosMes++; }
    const estado = feito ? 'feito'
      : antes ? 'antes'
      : futuro ? (previsto ? 'previsto' : 'futuro')
      : previsto ? (iso === hoje ? 'previsto' : 'perdido')
      : 'livre';
    const descricao = feito ? 'feito'
      : antes ? 'antes da meta'
      : !previsto ? 'fora dos dias marcados'
      : futuro ? 'previsto'
      : iso === hoje ? 'previsto para hoje' : 'não feito';
    const clicavel = !antes && !futuro && g.status !== 'concluida';
    celulas += `<button type="button" class="meta-cal-dia ${estado} ${iso === hoje ? 'hoje' : ''}" data-dia="${iso}" aria-pressed="${feito}" aria-label="${dia} de ${MESES_LONGOS[m]}, ${descricao}" ${clicavel ? '' : 'disabled'} onclick="alternarDiaHabito('${g.id}','${iso}')">${dia}</button>`;
  }
  const nomeMes = `${MESES_LONGOS_CAP[m]} ${ano}`;
  const mesAtual = ano === agora.getFullYear() && m === agora.getMonth();
  const resumo = previstosMes
    ? `${feitosMes} de ${previstosMes} dia${previstosMes !== 1 ? 's' : ''} marcado${previstosMes !== 1 ? 's' : ''} feito${previstosMes !== 1 ? 's' : ''} em ${MESES_LONGOS[m]}${mesAtual ? ' até hoje' : ''}.`
    : `Nenhum dia marcado em ${MESES_LONGOS[m]}${mesAtual ? ' até hoje' : ''}.`;
  return `
    <section class="meta-cal" aria-label="Calendário de ${nomeMes}">
      <div class="mini-cal-head">
        <h2 class="mini-cal-title">${nomeMes}</h2>
        <div class="mini-cal-nav">
          <button type="button" data-mes-nav="ant" onclick="mudarMesMeta('${g.id}', -1)" aria-label="Mês anterior" ${podeVoltar ? '' : 'disabled'}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
          <button type="button" data-mes-nav="prox" onclick="mudarMesMeta('${g.id}', 1)" aria-label="Próximo mês" ${podeAvancar ? '' : 'disabled'}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
      </div>
      <div class="mini-cal-grid meta-cal-grid">
        ${DOW_LETTERS.map(l=>`<div class="mini-cal-dow" aria-hidden="true">${l}</div>`).join('')}
        ${celulas}
      </div>
      <p class="meta-cal-resumo">${resumo}</p>
      <div class="meta-cal-legenda" aria-hidden="true">
        <span><i class="feito"></i>Feito</span>
        <span><i class="perdido"></i>Não feito</span>
        <span><i class="previsto"></i>Previsto</span>
      </div>
    </section>`;
}

function renderMetaEtapas(g, p){
  const feitas = g.steps.filter(s=>s.ok).length;
  const aberta = g.status !== 'concluida';
  return `
    <div class="meta-placar">
      <div class="meta-placar-num"><span class="meta-atual">${feitas}</span><span class="meta-alvo">de ${g.steps.length} etapa${g.steps.length !== 1 ? 's' : ''}</span></div>
      <div class="meta-pct">${Math.round(p.pct * 100)}%</div>
    </div>
    ${barraMeta(p.pct, aberta ? metaRitmoEsperado(g) : null)}
    ${textoRitmo(g, p)}
    ${renderMetaChegou(g, p)}
    ${g.steps.length ? `<ol class="meta-etapas">${g.steps.map(s=>`
      <li class="${s.ok ? 'ok' : ''}">
        <button type="button" class="meta-etapa-check" role="checkbox" aria-checked="${s.ok}" data-etapa="${s.id}" aria-label="${esc(s.t)}" ${aberta ? '' : 'disabled'} onclick="alternarEtapa('${g.id}','${s.id}')"><span class="meta-etapa-box" aria-hidden="true">${s.ok ? ICONE_CHECK : ''}</span></button>
        <span class="meta-etapa-texto">${esc(s.t)}</span>
        ${aberta ? `<button type="button" class="meta-etapa-tirar" onclick="tirarEtapa('${g.id}','${s.id}')" aria-label="Apagar a etapa: ${esc(s.t)}" title="Apagar etapa">${ICONE_X}</button>` : ''}
      </li>`).join('')}</ol>` : `<p class="meta-vazio">Nenhuma etapa. Escreva a primeira abaixo.</p>`}
    ${aberta ? `
    <div class="meta-add-linha">
      <input type="text" class="input" id="meta-nova-etapa" maxlength="160" autocomplete="off" placeholder="Nova etapa" aria-label="Nova etapa" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();adicionarEtapa('${g.id}')}">
      <button class="btn-secondary" onclick="adicionarEtapa('${g.id}')">Adicionar</button>
    </div>` : ''}`;
}

function renderMetaUnica(g){
  const concluida = g.status === 'concluida';
  return `
    <div class="meta-unica">
      <p class="meta-unica-prazo">${concluida ? 'Feita.' : esc(g.due ? textoPrazo(diasAte(g.due)) : 'Sem prazo')}</p>
      ${g.due && !concluida ? `<p class="meta-dica">Prazo: ${dataLonga(g.due)}.</p>` : ''}
      ${concluida ? '' : `<button class="btn-primary" onclick="concluirMeta('${g.id}')">Marcar como concluída</button>`}
    </div>`;
}

function renderMetaPage(){
  const g = metaPorId(state.metas.atual);
  if(!g){
    return `<div class="empty"><strong>Essa meta não existe mais.</strong><button class="btn-secondary" style="margin-top:12px;" onclick="voltarDaMeta()">Voltar</button></div>`;
  }
  const p = metaProgresso(g);
  const concluida = g.status === 'concluida';
  const corpo = g.kind === 'numero' ? renderMetaNumero(g, p)
    : g.kind === 'habito' ? renderMetaHabito(g, p)
    : g.kind === 'etapas' ? renderMetaEtapas(g, p)
    : renderMetaUnica(g);
  return `
    <header class="meta-head">
      <button class="btn-back" onclick="voltarDaMeta()" title="Voltar" aria-label="Voltar">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      </button>
      <div class="meta-head-main">
        <h1 class="meta-titulo"><span class="meta-area-marca" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span>${esc(g.title)}</h1>
        <p class="meta-frase">${META_TIPOS[g.kind].nome} · ${esc(fraseMeta(g))}${g.area ? ` · ${nomeDaArea(g.area)}` : ''}</p>
      </div>
      <div class="meta-head-acoes">
        <button class="btn-secondary" onclick="editarMeta('${g.id}')">Editar</button>
        ${concluida
          ? `<button class="btn-secondary" onclick="reabrirMeta('${g.id}')">Reabrir</button>`
          : (g.kind === 'unica' ? '' : `<button class="btn-secondary" onclick="concluirMeta('${g.id}')">Concluir</button>`)}
        <button class="btn-icone-perigo" onclick="excluirMeta('${g.id}')" title="Excluir meta" aria-label="Excluir meta">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </header>
    ${concluida && g.completedAt ? `<p class="meta-concluida-faixa">Concluída em ${dataLonga(isoDateFromTimestamp(new Date(g.completedAt).getTime()))}</p>` : ''}
    <section class="glass panel meta-painel meta-painel-${g.kind}" aria-label="Progresso">${corpo}</section>
    ${g.why ? `<blockquote class="meta-porque-citacao"><p>${esc(g.why)}</p></blockquote>` : ''}`;
}

/* ---------- celular: metas na aba Projetos ---------- */

// Linhas compactas num painel só, a mesma leitura da barra lateral: um cartão
// de vidro por meta, com número e barra, virava um painel de cards de métrica.
function renderMetasMobile(){
  const ativas = state.metas.lista.filter(g=>g.status === 'ativa');
  const desafio = desafioDiaAtual();
  const linha = (acao, marca, nome, progresso)=>`
    <button class="meta-linha" onclick="${acao}">
      ${marca}
      <span class="meta-linha-nome">${nome}</span>
      <span class="meta-linha-prog">${progresso}</span>
    </button>`;
  const trofeu = '<svg class="meta-linha-icone" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/></svg>';
  return `
    <section class="glass panel metas-mobile" aria-labelledby="metas-mobile-titulo">
      <div class="secao-head">
        <h2 class="panel-title" id="metas-mobile-titulo">Metas</h2>
        <button class="btn-secondary btn-com-icone" onclick="abrirNovaMeta()">${ICONE_MAIS}Nova meta</button>
      </div>
      ${isDesafioOwner() ? linha('goDesafio()', trofeu, 'Desafio', desafio.dia ? `dia ${desafio.dia} de ${desafio.total}` : 'começa amanhã') : ''}
      ${ativas.map(g=>linha(`abrirMeta('${g.id}')`, `<span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span>`, esc(g.title), esc(metaProgresso(g).longo))).join('')}
      ${!state.metas.lista.length && !state.metas.precisaSql ? '<p class="meta-vazio">Nenhuma meta ainda. Toque em Nova meta para criar a primeira.</p>' : ''}
      ${state.metas.precisaSql ? '<p class="meta-dica">Falta rodar o supabase/metas.sql no Supabase.</p>' : ''}
    </section>`;
}

/* ---------- histórico de metas (nas Configurações) ---------- */

const DATA_CONCLUSAO = new Intl.DateTimeFormat(LOCALE_APP, {day: 'numeric', month: 'short', year: 'numeric'});

function abrirHistoricoMetas(){
  closeSettings();
  const concluidas = state.metas.lista
    .filter(g=>g.status === 'concluida')
    .sort((a, b)=>(b.completedAt || '').localeCompare(a.completedAt || ''));
  document.getElementById('metas-historico-body').innerHTML = concluidas.length
    ? concluidas.map(g=>`
      <button class="meta-linha" onclick="abrirMetaDoHistorico('${g.id}')">
        <span class="sidebar-meta-dot" style="--area:${corDaArea(g.area)}" aria-hidden="true"></span>
        <span class="meta-linha-nome">${esc(g.title)}</span>
        <span class="meta-linha-prog">${g.completedAt ? DATA_CONCLUSAO.format(new Date(g.completedAt)) : 'Concluída'}</span>
      </button>`).join('')
    : '<p class="meta-vazio">Nenhuma meta concluída ainda. Quando uma chegar a 100%, ela aparece aqui.</p>';
  document.getElementById('metas-historico-modal').classList.add('open');
}

function fecharHistoricoMetas(){
  document.getElementById('metas-historico-modal').classList.remove('open');
}

function abrirMetaDoHistorico(id){
  fecharHistoricoMetas();
  abrirMeta(id);
}

/* ---------- apresentação das Metas (uma vez por conta) ---------- */

// O que cada tipo faz, em uma linha: o exemplo do passo a passo diz o que dá
// para pôr ali, isto diz o que o app faz com a meta depois.
const APRESENTACAO_METAS = {
  numero: 'Você registra o avanço e vê se está no ritmo para o prazo.',
  habito: 'Vira rotina: a tarefa aparece sozinha nos dias que você marcar.',
  etapas: 'Uma lista do que falta, riscada etapa por etapa.',
  unica: 'Um prazo e a contagem até ele.'
};

function chaveNovidadeLocal(chave){
  return `novidade_${chave}_${session.user.id}`;
}

// O perfil guarda a lista para valer em qualquer aparelho; o localStorage
// segura enquanto o SQL da coluna não rodou ou se a gravação falhar.
function novidadeVista(chave){
  if(state.novidadesVistas.includes(chave)) return true;
  try{ return localStorage.getItem(chaveNovidadeLocal(chave)) === '1'; }catch(e){ return false; }
}

async function marcarNovidadeVista(chave){
  try{ localStorage.setItem(chaveNovidadeLocal(chave), '1'); }catch(e){}
  if(state.novidadesVistas.includes(chave)) return;
  state.novidadesVistas = [...state.novidadesVistas, chave];
  const {error} = await sb.from('profiles').update({novidades_vistas: state.novidadesVistas}).eq('id', session.user.id);
  if(error) console.warn('novidades_vistas não salvou (falta rodar o supabase/metas_para_todos.sql?)', error);
}

function talvezApresentarMetas(){
  if(novidadeVista('metas') || state.metas.precisaSql) return;
  // Quem já criou meta (a conta dona usa desde antes) não precisa do aviso.
  if(state.metas.lista.length){ marcarNovidadeVista('metas'); return; }
  setTimeout(()=>{
    // Outro modal ou a frase do dia aberta: fica para a próxima visita.
    if(!session || topOpenModal() || fraseDoDiaAberta() || novidadeVista('metas')) return;
    abrirApresentacaoMetas();
  }, 700);
}

function abrirApresentacaoMetas(){
  document.getElementById('metas-intro-tipos').innerHTML = Object.entries(META_TIPOS).map(([k, t])=>`
    <li class="metas-intro-tipo">
      <svg class="metas-intro-icone" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${t.icone}</svg>
      <div>
        <div class="metas-intro-nome">${t.nome}</div>
        <div class="metas-intro-desc">${t.exemplo}. ${APRESENTACAO_METAS[k]}</div>
      </div>
    </li>`).join('');
  document.getElementById('metas-intro-onde').textContent = window.matchMedia('(max-width:900px)').matches
    ? 'Elas ficam na aba Projetos, acima dos seus projetos.'
    : 'Elas ficam na barra lateral, em Metas. Para criar outra depois, passe o mouse no título e clique no +.';
  document.getElementById('metas-intro-modal').classList.add('open');
  // Abriu sozinho, sem clique: o foco vai para o título (lido primeiro pelo
  // leitor de tela) em vez de acender o anel no botão de fechar.
  setTimeout(()=>document.getElementById('metas-intro-title').focus(), 0);
}

function fecharApresentacaoMetas(){
  document.getElementById('metas-intro-modal').classList.remove('open');
  marcarNovidadeVista('metas');
}

function criarMetaDaApresentacao(){
  fecharApresentacaoMetas();
  // Depois do observador de foco devolver o foco do modal que fechou; senão o
  // passo a passo guardaria o botão escondido como "onde o foco estava".
  setTimeout(abrirNovaMeta, 0);
}

/* ---------- frase do dia ---------- */

// Só frases com fonte conhecida (livro, carta, discurso, entrevista). Muita
// frase famosa circula com o autor errado (Einstein e Da Vinci são os
// campeões); essas ficaram de fora em vez de entrar com a atribuição duvidosa.
// As do Steve Jobs têm lista própria: aparecem primeiro e com mais frequência.
const FRASES_JOBS = [
  {t:'A única maneira de fazer um ótimo trabalho é amar o que você faz.', a:'Steve Jobs', o:'Discurso em Stanford, 2005'},
  {t:'Seu tempo é limitado, então não o desperdice vivendo a vida de outra pessoa.', a:'Steve Jobs', o:'Discurso em Stanford, 2005'},
  {t:'Você não consegue ligar os pontos olhando para a frente; só consegue ligá-los olhando para trás.', a:'Steve Jobs', o:'Discurso em Stanford, 2005'},
  {t:'Design não é só a aparência e a sensação. Design é como funciona.', a:'Steve Jobs', o:'The New York Times Magazine, 2003'},
  {t:'Se você ainda não encontrou, continue procurando. Não se acomode.', a:'Steve Jobs', o:'Discurso em Stanford, 2005'},
  {t:'Foco é saber dizer não.', a:'Steve Jobs', o:'WWDC, 1997'},
  {t:'Tenha a coragem de seguir seu coração e sua intuição. Eles de algum jeito já sabem o que você realmente quer se tornar.', a:'Steve Jobs', o:'Discurso em Stanford, 2005'},
  {t:'Muitas vezes, as pessoas não sabem o que querem até você mostrar a elas.', a:'Steve Jobs', o:'Entrevista à BusinessWeek, 1998'},
  {t:'Ir dormir dizendo que fizemos algo incrível: é isso que importa para mim.', a:'Steve Jobs', o:'The Wall Street Journal, 1993'},
  {t:'Continue com fome. Continue tolo.', a:'Steve Jobs', o:'Discurso em Stanford, 2005, citando o Whole Earth Catalog'},
  {t:'É melhor ser um pirata do que entrar para a Marinha.', a:'Steve Jobs', o:'Retiro da equipe do Macintosh, 1982'}
];
const FRASES_DO_DIA = [
  {t:'Não é que tenhamos pouco tempo; é que perdemos muito dele.', a:'Sêneca', o:'Sobre a brevidade da vida'},
  {t:'O que impede a ação faz a ação avançar. O que fica no caminho vira o caminho.', a:'Marco Aurélio', o:'Meditações'},
  {t:'O que precisamos aprender a fazer, aprendemos fazendo.', a:'Aristóteles', o:'Ética a Nicômaco'},
  {t:'A imaginação é mais importante que o conhecimento.', a:'Albert Einstein', o:'Entrevista ao Saturday Evening Post, 1929'},
  {t:'Uma jornada de mil léguas começa com um passo.', a:'Lao-Tsé', o:'Tao Te Ching'},
  {t:'O primeiro princípio é não enganar a si mesmo, e você é a pessoa mais fácil de enganar.', a:'Richard Feynman', o:'Cargo Cult Science, 1974'},
  {t:'Primeiro diga a si mesmo o que você quer ser; depois faça o que tem que fazer.', a:'Epicteto', o:'Discursos'},
  {t:'Se eu vi mais longe, foi por estar sobre ombros de gigantes.', a:'Isaac Newton', o:'Carta a Robert Hooke, 1676'},
  {t:'Saber não basta; é preciso aplicar. Querer não basta; é preciso fazer.', a:'Goethe', o:'Os anos de peregrinação de Wilhelm Meister'},
  {t:'Enquanto a gente adia, a vida passa.', a:'Sêneca', o:'Cartas a Lucílio'},
  {t:'A vida é como andar de bicicleta: para manter o equilíbrio, é preciso continuar em movimento.', a:'Albert Einstein', o:'Carta ao filho Eduard, 1930'},
  {t:'O começo é a parte mais importante do trabalho.', a:'Platão', o:'A República'},
  {t:'A vida não é fácil para nenhum de nós. E daí? Precisamos ter persistência e, acima de tudo, confiança em nós mesmos.', a:'Marie Curie', o:'Citada por Ève Curie em Madame Curie'},
  {t:'Pare de discutir como deve ser um homem bom. Seja um.', a:'Marco Aurélio', o:'Meditações'},
  {t:'No campo da observação, o acaso só favorece a mente preparada.', a:'Louis Pasteur', o:'Aula em Lille, 1854'},
  {t:'A melhor maneira de prever o futuro é inventá-lo.', a:'Alan Kay', o:'Xerox PARC, 1971'},
  {t:'Não é porque as coisas são difíceis que não ousamos; é porque não ousamos que elas são difíceis.', a:'Sêneca', o:'Cartas a Lucílio'},
  {t:'Quem conhece os outros é sábio; quem conhece a si mesmo é iluminado.', a:'Lao-Tsé', o:'Tao Te Ching'},
  {t:'Gênio é um por cento inspiração e noventa e nove por cento transpiração.', a:'Thomas Edison', o:'Harper’s Monthly, 1932'},
  {t:'Uma vida sem exame não vale a pena ser vivida.', a:'Sócrates', o:'Apologia, de Platão'},
  {t:'O que perturba as pessoas não são as coisas, mas as opiniões que elas têm sobre as coisas.', a:'Epicteto', o:'Manual'},
  {t:'Somos o que fazemos repetidamente. A excelência, então, não é um ato, mas um hábito.', a:'Will Durant', o:'A história da filosofia, resumindo Aristóteles'},
  {t:'O importante é não parar de questionar.', a:'Albert Einstein', o:'Entrevista à revista Life, 1955'},
  {t:'Quem ousa desperdiçar uma hora ainda não descobriu o valor da vida.', a:'Charles Darwin', o:'Carta à irmã Susan, 1836'},
  {t:'Saber o que se sabe e saber o que não se sabe: isso é o verdadeiro saber.', a:'Confúcio', o:'Analectos'},
  {t:'Para quem não sabe a que porto vai, nenhum vento é favorável.', a:'Sêneca', o:'Cartas a Lucílio'},
  {t:'A alma ganha a cor dos seus pensamentos.', a:'Marco Aurélio', o:'Meditações'},
  {t:'Uma andorinha só não faz verão, nem um único dia.', a:'Aristóteles', o:'Ética a Nicômaco'}
];

// A conta começa no dia em que a frase do dia entrou no app. Nos primeiros
// dias passam todas as do Jobs, uma por dia; depois é dia sim, dia não: Jobs
// num, outro pensador no outro. Mesma frase o dia inteiro e em qualquer
// aparelho, porque o índice sai só da data.
const FRASE_DIA_INICIO = Date.UTC(2026, 9, 13);
function fraseDoDia(){
  const [y, m, d] = todayIso().split('-').map(Number);
  const n = Math.max(0, Math.round((Date.UTC(y, m - 1, d) - FRASE_DIA_INICIO) / 86400000));
  if(n < FRASES_JOBS.length) return FRASES_JOBS[n];
  const k = n - FRASES_JOBS.length;
  return k % 2 === 0
    ? FRASES_JOBS[(k / 2) % FRASES_JOBS.length]
    : FRASES_DO_DIA[((k - 1) / 2) % FRASES_DO_DIA.length];
}

function chaveFraseVista(){
  return `fraseVista_${session.user.id}`;
}

function fraseDoDiaAberta(){
  const el = document.getElementById('frase-dia');
  return !!(el && !el.hidden);
}

// Na primeira abertura do dia neste aparelho. Também ao voltar para a aba no
// dia seguinte, já que o app costuma ficar aberto de um dia para o outro.
function talvezMostrarFraseDoDia(){
  if(!session || fraseDoDiaAberta()) return;
  let vista = null;
  try{ vista = localStorage.getItem(chaveFraseVista()); }catch(e){}
  if(vista === todayIso() || topOpenModal()) return;
  abrirFraseDoDia();
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible' && state.myName) talvezMostrarFraseDoDia();
});

function abrirFraseDoDia(){
  const el = document.getElementById('frase-dia');
  if(!el) return;
  const f = fraseDoDia();
  const hrs = new Date().getHours();
  const saudacao = hrs < 12 ? 'Bom dia' : hrs < 18 ? 'Boa tarde' : 'Boa noite';
  const agora = new Date();
  const data = `${DIAS_LONGOS[agora.getDay()]}, ${agora.getDate()} de ${MESES_LONGOS[agora.getMonth()]}`;
  const titulo = `${saudacao}, ${getUserName()}`;
  // A saudação sobe letra por letra; a frase, palavra por palavra, depois
  // dela. Cada pedaço sai de trás de uma máscara, então nada pisca nem pula.
  let letra = 0;
  const letras = titulo.split(' ').map(p=>`<span class="fd-mascara">${Array.from(p).map(ch=>`<span class="fd-letra" style="--i:${letra++}">${esc(ch)}</span>`).join('')}</span>`).join(' ');
  const palavras = f.t.split(' ');
  el.innerHTML = `
    <div class="frase-dia-topo" style="--letras:${letra}">
      <h2 class="frase-dia-saudacao" aria-label="${esc(titulo)}"><span aria-hidden="true">${letras}</span></h2>
      <p class="frase-dia-data"><span class="frase-dia-traco" aria-hidden="true"></span>${esc(data)}</p>
    </div>
    <figure class="frase-dia-corpo" style="--letras:${letra};--fim:${palavras.length}">
      <span class="frase-dia-aspas" aria-hidden="true">“</span>
      <blockquote class="frase-dia-texto" id="frase-dia-texto">${palavras.map((p, i)=>`<span class="fd-mascara"><span class="frase-palavra" style="--i:${i}">${esc(p)}</span></span>`).join(' ')}</blockquote>
      <figcaption class="frase-dia-fonte">
        <span class="frase-dia-autor">${esc(f.a)}</span>
        <span class="frase-dia-obra">${esc(f.o)}</span>
      </figcaption>
    </figure>
    <div class="frase-dia-acoes">
      <button class="btn-primary frase-dia-ok" onclick="fecharFraseDoDia()">Começar o dia</button>
      <span class="frase-dia-dica">ou tecle Enter</span>
    </div>`;
  el.hidden = false;
  el.classList.remove('saindo');
  document.addEventListener('keydown', teclasFraseDoDia, true);
  setTimeout(()=>{ const b = el.querySelector('.frase-dia-ok'); if(b) b.focus({preventScroll: true, focusVisible: false}); }, 30);
}

function fecharFraseDoDia(){
  const el = document.getElementById('frase-dia');
  if(!el || el.hidden) return;
  try{ localStorage.setItem(chaveFraseVista(), todayIso()); }catch(e){}
  document.removeEventListener('keydown', teclasFraseDoDia, true);
  const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.classList.add('saindo');
  setTimeout(()=>{ el.hidden = true; el.classList.remove('saindo'); el.innerHTML = ''; }, reduzir ? 0 : 400);
}

// Enquanto a frase está na tela, os atalhos do app (N, setas, Enter dos modais)
// não passam para trás dela.
function teclasFraseDoDia(e){
  if(e.key === 'Enter' || e.key === 'Escape'){
    e.preventDefault();
    fecharFraseDoDia();
  }else if(e.key === 'Tab'){
    e.preventDefault();
  }
  e.stopImmediatePropagation();
}

function renderFraseLateral(){
  const el = document.getElementById('side-frase');
  if(!el) return;
  const f = fraseDoDia();
  el.innerHTML = `<span class="side-frase-texto">“${esc(f.t)}”</span><span class="side-frase-autor">${esc(f.a)}</span>`;
  el.hidden = false;
}

/* ---------- notas do projeto (várias, com título) ---------- */

function notaProjetoLinha(r){
  return {id: r.id, projectId: r.project_id, authorId: r.author_id, title: r.title || '', body: r.body || '', created: r.created_at, updated: r.updated_at};
}

function notaVazia(nt){
  return !nt.title.trim() && !/<img\b/i.test(nt.body) && !nt.body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

let canalNotas = null;
let criarNotaAoCarregar = null;
const notasCarregando = new Set();
async function carregarNotasProjeto(pid){
  const anterior = state.notasProjeto[pid];
  notasCarregando.add(pid);
  const {data, error} = await sb.from('project_notes').select('*').eq('project_id', pid).order('created_at', {ascending: false});
  notasCarregando.delete(pid);
  if(error){
    console.error(error);
    // Só "tabela não existe" volta para a nota única. Qualquer outro erro
    // (permissão, por exemplo) aparece na tela com o código, em vez de se
    // disfarçar de "o SQL não rodou".
    const semTabela = error.code === '42P01' || error.code === 'PGRST205';
    state.notasProjeto[pid] = {lista: [], semTabela, aberta: null, lendo: false, erro: semTabela ? null : `${error.code || 'erro'}: ${error.message || ''}`};
    if(semTabela) console.warn('Notas do projeto: a tabela project_notes não foi encontrada (rode supabase/notas_projeto.sql). Usando a nota única.', error);
    else showToast('Não deu para carregar as notas. Confira a conexão e tente de novo.', 'erro');
  }else{
    const lista = (data || []).map(notaProjetoLinha);
    const aberta = anterior && lista.some(x=>x.id === anterior.aberta) ? anterior.aberta : (lista[0] ? lista[0].id : null);
    state.notasProjeto[pid] = {lista, semTabela: false, aberta, lendo: !!(anterior && anterior.lendo && aberta === anterior.aberta)};
    ligarRealtimeNotas();
  }
  if(!error && criarNotaAoCarregar === pid){
    criarNotaAoCarregar = null;
    novaNotaProjeto();
    return;
  }
  if(state.view === 'project' && state.currentProjectId === pid && (state.projectTasksView === 'notes' || state.projectTasksView === 'inicio')){
    skipEntranceOnce = true;
    safeRerender();
  }
}

// Canal próprio, ligado só depois que a tabela respondeu: assinar uma tabela
// que ainda não existe derrubaria o canal das tarefas junto.
function ligarRealtimeNotas(){
  if(canalNotas) return;
  canalNotas = sb.channel('notas-projeto')
    .on('postgres_changes', {event:'*', schema:'public', table:'project_notes'}, (payload)=>{
      const pid = (payload.new && payload.new.project_id) || (payload.old && payload.old.project_id);
      if(pid && state.notasProjeto[pid] && !isEditingNotes()) carregarNotasProjeto(pid);
    })
    .subscribe();
}

function notasDoProjetoAtual(){
  return state.notasProjeto[state.currentProjectId] || null;
}

function abrirNotaProjeto(id){
  flushNotesIfPending();
  const n = notasDoProjetoAtual();
  if(!n) return;
  n.aberta = id;
  n.lendo = true;
  skipEntranceOnce = true;
  render();
}

function voltarListaNotas(){
  flushNotesIfPending();
  const n = notasDoProjetoAtual();
  if(n) n.lendo = false;
  skipEntranceOnce = true;
  render();
}

async function novaNotaProjeto(){
  flushNotesIfPending();
  const pid = state.currentProjectId;
  const n = notasDoProjetoAtual();
  if(!pid || !n) return;
  // Uma nota em branco minha já aberta serve: não empilha várias vazias.
  const vazia = n.lista.find(x=>x.authorId === session.user.id && notaVazia(x));
  let nota = vazia;
  if(!nota){
    const {data, error} = await sb.from('project_notes').insert({project_id: pid, author_id: session.user.id, title: '', body: ''}).select().single();
    if(error){ console.error(error); showToast('Não deu para criar a nota. Confira a conexão e tente de novo.', 'erro'); return; }
    nota = notaProjetoLinha(data);
    n.lista.unshift(nota);
  }
  n.aberta = nota.id;
  n.lendo = true;
  skipEntranceOnce = true;
  render();
  setTimeout(()=>{ const t = document.getElementById('project-note-title'); if(t) t.focus(); }, 30);
}

async function excluirNotaProjeto(id){
  const n = notasDoProjetoAtual();
  const nota = n && n.lista.find(x=>x.id === id);
  if(!nota) return;
  const nome = nota.title.trim() ? `“${nota.title.trim()}”` : 'esta nota';
  if(!notaVazia(nota) && !await confirmar(`Ela some para todo mundo do projeto. Não tem como desfazer.`, {title: `Apagar ${nome}?`, okLabel: 'Apagar nota'})) return;
  if(notesSaveTimer){ clearTimeout(notesSaveTimer); notesSaveTimer = null; }
  const {error} = await sb.from('project_notes').delete().eq('id', id);
  if(error){ console.error(error); showToast('Não deu para apagar a nota. Tente de novo em instantes.', 'erro'); return; }
  n.lista = n.lista.filter(x=>x.id !== id);
  n.aberta = n.lista[0] ? n.lista[0].id : null;
  n.lendo = false;
  skipEntranceOnce = true;
  render();
  showToast('Nota apagada');
}

async function salvarNotaProjeto(el){
  const n = notasDoProjetoAtual();
  const nota = n && n.lista.find(x=>x.id === el.dataset.nota);
  if(!nota) return;
  const tituloEl = document.getElementById('project-note-title');
  const title = tituloEl ? tituloEl.value.slice(0, 160) : nota.title;
  const body = sanitizeNotesHtml(el.innerHTML);
  const agora = new Date().toISOString();
  const {error} = await sb.from('project_notes').update({title, body, updated_at: agora}).eq('id', nota.id);
  const indicator = document.getElementById('notes-save-indicator');
  if(error){
    console.error(error);
    if(indicator){ indicator.textContent = 'Não salvou — edite de novo'; indicator.classList.add('erro'); }
    showToast('A nota não foi salva. Confira a conexão e edite de novo.', 'erro');
    return;
  }
  nota.title = title;
  nota.body = body;
  nota.updated = agora;
  // A lista ao lado acompanha o título e a prévia sem redesenhar o editor.
  const item = document.querySelector(`.pn-item[data-nota="${nota.id}"]`);
  if(item){
    item.querySelector('.pn-item-titulo').textContent = title.trim() || 'Sem título';
    item.querySelector('.pn-item-previa').textContent = previaNota(nota);
  }
  if(indicator){
    indicator.textContent = 'Salvo agora';
    setTimeout(()=>{
      const atual = document.getElementById('notes-save-indicator');
      if(atual && atual.textContent === 'Salvo agora') atual.textContent = 'Salvo automaticamente';
    }, 2500);
  }
}

function previaNota(nota){
  // Espaço no fim de cada bloco: sem ele os itens de lista grudavam ("offVendas").
  const doc = new DOMParser().parseFromString(nota.body.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' $&'), 'text/html');
  const texto = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  return texto ? texto.slice(0, 90) : (/<img\b/i.test(nota.body) ? 'Imagem' : 'Sem texto');
}

function dataNota(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const mesmoAno = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(LOCALE_APP, mesmoAno ? {day: '2-digit', month: '2-digit'} : {day: '2-digit', month: '2-digit', year: 'numeric'});
}

function autorNota(p, nota){
  if(nota.authorId === session.user.id) return 'você';
  const pe = projectPeople(p).find(x=>x.id === nota.authorId);
  return pe ? pe.label : 'alguém que saiu do projeto';
}

function renderNotasProjeto(p, canEdit, n){
  const nota = n.lista.find(x=>x.id === n.aberta) || null;
  const itens = n.lista.map(x=>`
    <button class="pn-item ${nota && x.id === nota.id ? 'ativa' : ''}" data-nota="${x.id}" onclick="abrirNotaProjeto('${x.id}')"${nota && x.id === nota.id ? ' aria-current="true"' : ''}>
      <span class="pn-item-titulo">${esc(x.title.trim() || 'Sem título')}</span>
      <span class="pn-item-meta">${esc(dataNota(x.created))} · ${esc(autorNota(p, x))}</span>
      <span class="pn-item-previa">${esc(previaNota(x))}</span>
    </button>`).join('');
  const lista = `
    <div class="pn-lista">
      ${canEdit ? `<button class="btn-primary btn-com-icone pn-nova" onclick="novaNotaProjeto()">${ICONE_MAIS}Nova nota</button>` : ''}
      ${n.lista.length ? `<div class="pn-itens">${itens}</div>` : `<p class="pn-lista-vazia">${canEdit ? 'Nenhuma nota ainda. Crie uma para a próxima reunião, um combinado ou uma ideia.' : 'Ninguém escreveu notas neste projeto ainda.'}</p>`}
    </div>`;
  const ferramenta = (cmd, label, conteudo, valor)=>`<button class="proj-nota-btn" data-cmd="${cmd}" onmousedown="event.preventDefault()" onclick="execEditorCmd('${cmd}'${valor ? `,'${valor}'` : ''})" title="${label}" aria-label="${label}" aria-pressed="false">${conteudo}</button>`;
  const doc = !nota ? `
    <div class="pn-doc pn-doc-vazio">
      <p>${canEdit ? 'Escolha uma nota na lista ou crie uma nova.' : 'Escolha uma nota na lista.'}</p>
    </div>` : `
    <div class="pn-doc">
      <button class="pn-voltar" onclick="voltarListaNotas()">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>Todas as notas
      </button>
      <div class="pn-doc-topo">
        ${canEdit
          ? `<input type="text" class="pn-titulo" id="project-note-title" maxlength="160" autocomplete="off" placeholder="Título da nota (ex: Reunião de heads ${esc(dataNota(new Date().toISOString()))})" aria-label="Título da nota" value="${esc(nota.title)}" oninput="scheduleProjectNotesSave()" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('project-notes-editor').focus();}">`
          : `<h3 class="pn-titulo">${esc(nota.title.trim() || 'Sem título')}</h3>`}
        <p class="pn-doc-meta">Criada por ${esc(autorNota(p, nota))} em ${esc(dataNota(nota.created))}</p>
      </div>
      ${canEdit ? `
      <div class="proj-notas-head">
        <div class="proj-notas-ferramentas" role="toolbar" aria-label="Formatação da nota">
          ${ferramenta('formatBlock', 'Título', '<span aria-hidden="true" class="proj-nota-h">T</span>', 'H3')}
          <span class="proj-nota-sep" aria-hidden="true"></span>
          ${ferramenta('bold', 'Negrito', '<b aria-hidden="true">B</b>')}
          ${ferramenta('italic', 'Itálico', '<i aria-hidden="true">I</i>')}
          <span class="proj-nota-sep" aria-hidden="true"></span>
          ${ferramenta('insertUnorderedList', 'Lista', '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>')}
          ${ferramenta('insertOrderedList', 'Lista numerada', '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>')}
          <span class="proj-nota-sep" aria-hidden="true"></span>
          <button class="proj-nota-btn" onmousedown="event.preventDefault()" onclick="insertProjectImage()" title="Inserir imagem" aria-label="Inserir imagem">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
        </div>
        <span id="notes-save-indicator" class="proj-notas-salvo" role="status">Salvo automaticamente</span>
        <button class="pn-apagar" onclick="excluirNotaProjeto('${nota.id}')" title="Apagar nota" aria-label="Apagar nota">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>` : ''}
      <div id="project-notes-editor" class="project-notes-editor" data-nota="${nota.id}" role="textbox" aria-multiline="true" aria-label="Texto da nota" ${canEdit ? 'contenteditable="true"' : 'aria-readonly="true"'} oninput="scheduleProjectNotesSave()" data-placeholder="${canEdit ? 'Escreva aqui: pauta, decisões, quem faz o quê…' : ''}">${sanitizeNotesHtml(nota.body)}</div>
    </div>`;
  return `<div class="glass proj-surface proj-notas proj-notas-v2 ${n.lendo && nota ? 'lendo' : ''}">${lista}${doc}</div>`;
}

/* ---------- Início do projeto ---------- */

function isoMaisDias(iso, n){
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function rotuloDia(iso){
  const hoje = todayIso();
  if(iso === hoje) return 'Hoje';
  if(iso === isoMaisDias(hoje, 1)) return 'Amanhã';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS_LONGOS[dt.getDay()]}, ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
}

// Ao abrir o projeto: o que vem nos próximos 7 dias (eventos e tarefas
// juntos, por dia e hora), as notas mais recentes, o quadro em números e o
// que está com quem está olhando.
function renderProjectInicio(p, canEdit, itens, tarefas, cols, mexe){
  const hoje = todayIso();
  const limite = isoMaisDias(hoje, 6);
  const aberta = t=>ehEvento(t) || taskColumnType(t) !== 'done';
  const porHora = (a, b)=>(a.date || '').localeCompare(b.date || '') || (a.time || '99').localeCompare(b.time || '99');
  const atrasadas = tarefas.filter(t=>t.date && t.date < hoje && taskColumnType(t) !== 'done').sort(porHora);
  const proximos = itens.filter(t=>t.date && t.date >= hoje && t.date <= limite && aberta(t)).sort(porHora);

  const linha = (t)=>{
    const evento = ehEvento(t);
    const quem = !evento ? getAssigneeLabel(t) : null;
    return `
      <button class="pi-item ${evento ? 'evento' : ''}" onclick="openModal('${t.id}')" style="--col-color:${evento ? 'var(--accent)' : taskColumnColor(t)}">
        <span class="pi-hora">${t.time ? esc(t.time.slice(0, 5)) : ''}</span>
        <span class="pi-marca" aria-hidden="true"></span>
        <span class="pi-titulo">${esc(t.title)}</span>
        <span class="pi-tipo">${evento ? 'Evento' : esc(quem || 'Tarefa')}</span>
      </button>`;
  };
  const dias = [];
  proximos.forEach(t=>{
    let g = dias.find(x=>x.iso === t.date);
    if(!g){ g = {iso: t.date, itens: []}; dias.push(g); }
    g.itens.push(t);
  });
  const agenda = (atrasadas.length || dias.length) ? `
    ${atrasadas.length ? `<div class="pi-dia atrasado"><h3 class="pi-dia-titulo">Atrasadas<span>${atrasadas.length}</span></h3>${atrasadas.slice(0, 5).map(linha).join('')}</div>` : ''}
    ${dias.map(g=>`<div class="pi-dia ${g.iso === hoje ? 'hoje' : ''}"><h3 class="pi-dia-titulo">${rotuloDia(g.iso)}<span>${g.itens.length}</span></h3>${g.itens.map(linha).join('')}</div>`).join('')}`
    : `<div class="pi-vazio"><p>Nada marcado para os próximos 7 dias.</p>${mexe ? `<div class="pi-vazio-acoes">${state.temTipoEvento !== false ? `<button class="btn-secondary" onclick="novoNoProjeto('evento')">Novo evento</button>` : ''}<button class="btn-secondary" onclick="novoNoProjeto('tarefa')">Nova tarefa</button></div>` : ''}</div>`;

  // Notas: as três mexidas por último.
  const n = state.notasProjeto[p.id];
  if(!n && !notasCarregando.has(p.id)) carregarNotasProjeto(p.id);
  let notas;
  if(!n) notas = `<p class="pi-suave" role="status">Carregando…</p>`;
  else if(n.semTabela || n.erro) notas = `<p class="pi-suave">${projectHasNotes(p) ? 'Este projeto tem notas.' : 'Nenhuma nota ainda.'}</p>`;
  else if(!n.lista.length) notas = `<p class="pi-suave">Nenhuma nota ainda.${canEdit ? ' Anote a próxima reunião aqui.' : ''}</p>`;
  else notas = [...n.lista].sort((a, b)=>(b.updated || '').localeCompare(a.updated || '')).slice(0, 3).map(x=>`
      <button class="pi-nota" onclick="abrirNotaDoInicio('${x.id}')">
        <span class="pi-nota-titulo">${esc(x.title.trim() || 'Sem título')}</span>
        <span class="pi-nota-meta">${esc(dataNota(x.updated || x.created))} · ${esc(autorNota(p, x))}</span>
        <span class="pi-nota-previa">${esc(previaNota(x))}</span>
      </button>`).join('');

  // Quadro em números.
  const contagem = cols.map(c=>({c, n: tarefas.filter(t=>statusVisivel(t, cols) === c.key && !isHiddenFromKanban(t)).length}));
  const quadro = `
    <div class="pi-colunas">
      ${contagem.map(({c, n})=>`<div class="pi-coluna"><span class="kb-col-dot" style="background:${corSegura(c.color)}"></span><span class="pi-coluna-nome">${esc(c.name)}</span><span class="pi-coluna-n">${n}</span></div>`).join('')}
    </div>
    ${atrasadas.length ? `<p class="pi-alerta">${atrasadas.length === 1 ? '1 tarefa atrasada' : `${atrasadas.length} tarefas atrasadas`}</p>` : ''}`;

  // Comigo.
  const minhas = tarefas.filter(t=>t.assigned_to === session.user.id && taskColumnType(t) !== 'done').sort(porHora);
  const comigo = minhas.length
    ? minhas.slice(0, 4).map(t=>`
      <button class="pi-item" onclick="openModal('${t.id}')" style="--col-color:${taskColumnColor(t)}">
        <span class="pi-marca" aria-hidden="true"></span>
        <span class="pi-titulo">${esc(t.title)}</span>
        <span class="pi-tipo">${t.date ? esc(rotuloDia(t.date)) : 'sem prazo'}</span>
      </button>`).join('') + (minhas.length > 4 ? `<p class="pi-suave">e mais ${minhas.length - 4}</p>` : '')
    : `<p class="pi-suave">Nada atribuído a você.</p>`;

  return `
    <div class="pi-grade">
      <section class="glass proj-surface pi-painel pi-agenda" aria-labelledby="pi-agenda-t">
        <div class="pi-head"><h2 class="panel-title" id="pi-agenda-t">Próximos 7 dias</h2><button class="dash-link" onclick="setProjectTasksView('calendar')">Abrir calendário</button></div>
        ${agenda}
      </section>
      <section class="glass proj-surface pi-painel" aria-labelledby="pi-notas-t">
        <div class="pi-head"><h2 class="panel-title" id="pi-notas-t">Notas recentes</h2><button class="dash-link" onclick="setProjectTasksView('notes')">Ver todas</button></div>
        ${canEdit && n && !n.semTabela && !n.erro ? `<button class="btn-secondary btn-com-icone pi-nova-nota" onclick="novoNoProjeto('nota')">${ICONE_MAIS}Nova nota</button>` : ''}
        ${notas}
      </section>
      <section class="glass proj-surface pi-painel" aria-labelledby="pi-quadro-t">
        <div class="pi-head"><h2 class="panel-title" id="pi-quadro-t">Quadro</h2><button class="dash-link" onclick="setProjectTasksView('kanban')">Abrir quadro</button></div>
        ${quadro}
      </section>
      <section class="glass proj-surface pi-painel" aria-labelledby="pi-comigo-t">
        <div class="pi-head"><h2 class="panel-title" id="pi-comigo-t">Com você</h2></div>
        ${comigo}
      </section>
    </div>`;
}

function abrirNotaDoInicio(id){
  setProjectTasksView('notes');
  abrirNotaProjeto(id);
}

/* ---------- + Novo (tarefa, evento, nota) ---------- */

// comNota: a nota é estrutura do projeto, e o participante cria só tarefas e
// eventos.
function renderMenuNovo(comNota){
  const item = (k, nome, desc)=>`<button role="menuitem" class="novo-menu-item" onclick="novoNoProjeto('${k}')"><span class="novo-menu-nome">${nome}</span><span class="novo-menu-desc">${desc}</span></button>`;
  return `
    <div class="novo-menu">
      <button class="btn-primary novo-menu-btn" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)">+ Novo</button>
      <div class="novo-menu-lista" role="menu" hidden>
        ${item('tarefa', 'Tarefa', 'Vai para o quadro')}
        ${state.temTipoEvento !== false ? item('evento', 'Evento', 'Reunião, call, entrega com hora') : ''}
        ${comNota !== false ? item('nota', 'Nota', 'Anotações do time') : ''}
      </div>
    </div>`;
}

function alternarMenuNovo(btn, fechar){
  const lista = btn.nextElementSibling;
  const abrir = !fechar && lista.hidden;
  lista.hidden = !abrir;
  btn.setAttribute('aria-expanded', abrir);
  if(abrir){ const primeiro = lista.querySelector('button'); if(primeiro) primeiro.focus(); }
}

document.addEventListener('click', (e)=>{
  document.querySelectorAll('.novo-menu').forEach(m=>{
    if(!m.contains(e.target)){
      const b = m.querySelector('.novo-menu-btn');
      if(b && b.getAttribute('aria-expanded') === 'true') alternarMenuNovo(b, true);
    }
  });
});
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  const b = document.querySelector('.novo-menu-btn[aria-expanded="true"]');
  if(b){ e.stopPropagation(); alternarMenuNovo(b, true); b.focus(); }
}, true);

function novoNoProjeto(k){
  const pid = state.currentProjectId;
  const b = document.querySelector('.novo-menu-btn[aria-expanded="true"]');
  if(b) alternarMenuNovo(b, true);
  if(!pid) return;
  if(k === 'evento') openModal(null, todayIso(), pid, 'evento');
  else if(k === 'nota'){
    setProjectTasksView('notes');
    const n = state.notasProjeto[pid];
    if(n && !n.semTabela) novaNotaProjeto();
    else if(!n) criarNotaAoCarregar = pid;
  }
  else openModal(null, '', pid);
}

/* ---------- canais e chat do projeto (RFC 0002, fase 1, e RFC 0004) ---------- */
// Cada projeto tem categorias, canais de texto e salas de voz, como um
// servidor do Discord. A estrutura vem de project_channels; as mensagens vêm
// de project_messages, cada uma presa a um canal, e chegam em tempo real pelo
// canal 'chat-projeto'. "Até onde li" é por canal (project_channel_reads) e
// "silenciado" é por projeto (project_chat_reads). Quem lê, escreve e mexe na
// estrutura é o banco que decide (supabase/chat_projeto.sql e
// supabase/canais_projeto.sql, SEC-070 e SEC-080).
//
// Sem o canais_projeto.sql, cada projeto mostra um #geral e uma sala Geral
// virtuais, que são o chat e a chamada de antes: o id do #geral virtual é o
// do próprio projeto, e as consultas filtram pelo projeto em vez do canal.

const CHAT_LIMITE_TEXTO = 4000;
const CHAT_POR_PAGINA = 100;
const CANAL_LIMITE_NOME = 60;
const CANAL_ID = /^(voz-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Sem a tabela (SQL ainda não rodou) a aba explica, e nada mais tenta o banco.
let chatSemTabela = false;
let canalChat = null;
const chatCarregando = new Set();
// {pid: n} mensagens dos outros depois do "até onde li", somando os canais.
let chatNaoLidas = {};
// {canalId: n} o mesmo, canal por canal.
let chatNaoLidasCanal = {};
// {pid: {silenciado}} a linha de project_chat_reads de cada projeto.
let chatLeitura = {};
// {canalId: data} o "até onde li" de cada canal.
let leituraCanal = {};
let chatContagemTimer = null;

let canaisSemTabela = false;
let canaisCarregados = false;
let canaisCarregando = null;
let canaisErro = '';
let canaisTimer = null;
// {pid: [canal]} canais e categorias de cada projeto, na ordem do banco.
let canaisPorProjeto = {};
// {pid: true}: no celular, a conversa está aberta no lugar da lista.
const lendoCanal = {};

const ICONE_CANAL_TEXTO = '<svg class="cn-icone" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>';
const ICONE_SALA = '<svg class="cn-icone" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>';
const ICONE_LAPIS = '<svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICONE_SETA_CATEGORIA = '<svg class="cn-seta" aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function chatErroSemTabela(error){
  return !!error && ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code);
}

function mensagemChatLinha(r){
  // autorNome: o nome que o banco guardou na mensagem (autor_das_mensagens.sql),
  // para quem já saiu do projeto continuar assinando o que escreveu.
  const autorNome = typeof r.autor_nome === 'string' && r.autor_nome.trim() ? r.autor_nome.trim().slice(0, 80) : null;
  const imagem = typeof r.imagem === 'string' && IMAGEM_CHAT.test(r.imagem) ? r.imagem : null;
  return {id: r.id, projectId: r.project_id, canalId: r.canal_id || null, authorId: r.author_id, autorNome, kind: r.kind, body: r.body || '', imagem, created: r.created_at, apagada: !!r.apagada_em, duracao: r.duracao_seg};
}

// Foto no chat (RFC 0006, SEC-090): bucket privado "chat", caminho
// <projeto>/<canal>/<quem enviou>_<aleatório>.<ext>. O mesmo formato que o
// banco confere (imagens_no_chat.sql); a foto só abre por URL assinada.
const UUID_PARTE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGEM_CHAT = new RegExp(`^${UUID_PARTE}/${UUID_PARTE}/${UUID_PARTE}_[0-9a-f]{8,32}\\.(png|jpg|webp|gif)$`);
const IMAGEM_CHAT_MAX = 5 * 1024 * 1024;
const IMAGEM_CHAT_LADO = 1600;
let imagensSemBucket = false;
const urlsFotoChat = new Map();

// Foto grande vira webp (ou jpeg) de até 1600px; o GIF vai como está, para
// não perder a animação. Também tira os metadados (EXIF, localização) das
// fotos que passam pelo canvas.
async function prepararImagemChat(arquivo){
  if(arquivo.type === 'image/gif') return arquivo.size <= IMAGEM_CHAT_MAX ? {blob: arquivo, ext: 'gif'} : null;
  let bitmap;
  try{ bitmap = await createImageBitmap(arquivo); }catch(e){ return null; }
  const escala = Math.min(1, IMAGEM_CHAT_LADO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if(bitmap.close) bitmap.close();
  const gerar = (tipo, q)=>new Promise(ok=>canvas.toBlob(ok, tipo, q));
  let blob = await gerar('image/webp', 0.85);
  let ext = 'webp';
  if(!blob || blob.type !== 'image/webp'){ blob = await gerar('image/jpeg', 0.85); ext = 'jpg'; }
  if(blob && blob.size > IMAGEM_CHAT_MAX){ blob = await gerar('image/jpeg', 0.6); ext = 'jpg'; }
  return blob && blob.size <= IMAGEM_CHAT_MAX ? {blob, ext} : null;
}

// De onde a foto sai: a conversa da página do projeto ou o chat da chamada.
function destinoDoChat(idCampo){
  if(idCampo === 'ch-chat-input'){
    if(!chamada) return {};
    const canal = canalDoChatDaChamada(chamada);
    return {pid: chamada.pid, canal, c: canal && state.chatProjeto[canal.id]};
  }
  const {canal, c} = conversaAberta();
  return {pid: state.currentProjectId, canal, c};
}

function escolherImagemChat(idCampo){
  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = 'image/png,image/jpeg,image/webp,image/gif';
  entrada.addEventListener('change', ()=>{ if(entrada.files && entrada.files[0]) enviarImagemChat(idCampo, entrada.files[0]); });
  entrada.click();
}

// Colar uma imagem (print, foto copiada) no campo também envia.
function colarImagemChat(e, idCampo){
  const itens = e.clipboardData ? [...e.clipboardData.items] : [];
  const item = itens.find(i=>i.kind === 'file' && /^image\/(png|jpeg|webp|gif)$/.test(i.type));
  if(!item) return;
  const arquivo = item.getAsFile();
  if(!arquivo) return;
  e.preventDefault();
  enviarImagemChat(idCampo, arquivo);
}

let imagemEnviando = false;
async function enviarImagemChat(idCampo, arquivo){
  const {pid, canal, c} = destinoDoChat(idCampo);
  if(!pid || !canal || !c || canal.virtual || !CANAL_ID.test(canal.id) || !session) return;
  if(imagemEnviando || chatEnviando) return;
  if(imagensSemBucket){ showToast('Fotos no chat: falta rodar o supabase/imagens_no_chat.sql.', 'erro'); return; }
  if(!/^image\/(png|jpeg|webp|gif)$/.test(arquivo.type)){ showToast('Envie uma imagem PNG, JPG, WebP ou GIF.', 'erro'); return; }
  const campo = document.getElementById(idCampo);
  const legenda = campo ? campo.value.trim() : '';
  if(legenda.length > CHAT_LIMITE_TEXTO){ showToast(`A legenda passa de ${CHAT_LIMITE_TEXTO.toLocaleString(LOCALE_APP)} caracteres.`, 'erro'); return; }
  imagemEnviando = true;
  marcarEnviandoImagem(idCampo, true);
  try{
    const pronta = await prepararImagemChat(arquivo);
    if(!pronta){ showToast('Não deu para usar essa imagem. Ela precisa ter até 5 MB.', 'erro'); return; }
    const sorte = new Uint8Array(12);
    crypto.getRandomValues(sorte);
    const caminho = `${pid}/${canal.id}/${session.user.id}_${[...sorte].map(b=>b.toString(16).padStart(2, '0')).join('')}.${pronta.ext}`;
    const tipo = {gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png'}[pronta.ext];
    const subida = await sb.storage.from('chat').upload(caminho, pronta.blob, {contentType: tipo, upsert: false});
    if(subida.error){
      console.error(subida.error);
      const semBucket = /bucket not found|not found/i.test(subida.error.message || '');
      if(semBucket) imagensSemBucket = true;
      showToast(semBucket ? 'Fotos no chat: falta rodar o supabase/imagens_no_chat.sql.' : 'A foto não subiu. Confira a conexão e tente de novo.', 'erro');
      return;
    }
    pedirPermissaoNotificacao();
    const {data, error} = await sb.from('project_messages').insert({project_id: pid, canal_id: canal.id, body: legenda, imagem: caminho}).select().single();
    if(error){
      console.error(error);
      sb.storage.from('chat').remove([caminho]);
      if(/chat_limite/.test(error.message || '')) showToast('Calma: muitas mensagens seguidas. Espere um minuto e envie de novo.', 'erro');
      else if(chatErroSemTabela(error) || /imagem/.test(error.message || '')) showToast('Fotos no chat: falta rodar o supabase/imagens_no_chat.sql.', 'erro');
      else showToast('A foto não foi enviada. Tente de novo.', 'erro');
      return;
    }
    c.rascunho = '';
    if(idCampo === 'ch-chat-input') c.doFimChamada = 0; else c.doFim = 0;
    const atual = document.getElementById(idCampo);
    if(atual){ atual.value = ''; ajustarAlturaChat(atual); atual.focus({preventScroll: true}); }
    const botao = document.getElementById(idCampo === 'ch-chat-input' ? 'ch-chat-enviar' : 'chat-enviar');
    if(botao) botao.disabled = true;
    receberMensagemChat(mensagemChatLinha(data));
    marcarChatLido();
    marcarLidoNaChamada();
  }finally{
    imagemEnviando = false;
    marcarEnviandoImagem(idCampo, false);
  }
}

function marcarEnviandoImagem(idCampo, sim){
  const campo = document.getElementById(idCampo);
  const b = campo && campo.closest('form') && campo.closest('form').querySelector('.chat-anexar');
  if(!b) return;
  b.disabled = sim;
  b.classList.toggle('enviando', sim);
  b.setAttribute('aria-label', sim ? 'Enviando a foto…' : 'Enviar foto');
}

const ICONE_FOTO = '<svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/></svg>';
function botaoFotoChat(idCampo){
  return `<button type="button" class="chat-anexar" onclick="escolherImagemChat('${idCampo}')" title="Enviar foto (ou cole uma imagem no campo)" aria-label="Enviar foto">${ICONE_FOTO}</button>`;
}

// As fotos chegam por URL assinada de 1 hora, pedidas juntas para o que está
// na tela. Um observador pega toda imagem com data-anexo nova, seja da página ou
// do chat da chamada.
let fotosPendentes = false;
function pedirFotosChat(){
  if(fotosPendentes) return;
  fotosPendentes = true;
  requestAnimationFrame(async ()=>{
    fotosPendentes = false;
    const imgs = [...document.querySelectorAll('img[data-anexo]:not([src])')];
    if(!imgs.length) return;
    const agora = Date.now();
    const faltam = [...new Set(imgs.map(i=>i.dataset.anexo))].filter(c=>IMAGEM_CHAT.test(c) && !(urlsFotoChat.has(c) && urlsFotoChat.get(c).ate > agora));
    if(faltam.length){
      const {data, error} = await sb.storage.from('chat').createSignedUrls(faltam, 3600);
      if(error) console.warn('fotos do chat:', error.message);
      for(const r of data || []) if(r && r.signedUrl && r.path) urlsFotoChat.set(r.path, {url: r.signedUrl, ate: agora + 50 * 60 * 1000});
    }
    for(const img of document.querySelectorAll('img[data-anexo]:not([src])')){
      const u = urlsFotoChat.get(img.dataset.anexo);
      if(u) img.src = u.url;
      else img.closest('.chat-foto')?.classList.add('falhou');
    }
  });
}
new MutationObserver(muts=>{
  for(const m of muts) for(const n of m.addedNodes){
    if(n.nodeType === 1 && (n.matches('img[data-anexo]') || n.querySelector('img[data-anexo]'))){ pedirFotosChat(); return; }
  }
}).observe(document.documentElement, {childList: true, subtree: true});

// A foto que termina de carregar empurra a conversa; quem estava no fim
// continua no fim.
function fotoChatCarregou(img){
  img.closest('.chat-foto')?.classList.add('pronta');
  const lista = img.closest('.chat-lista');
  if(!lista) return;
  const chamadaLista = lista.id === 'ch-chat-lista';
  const canal = chamadaLista ? (chamada && canalDoChatDaChamada(chamada)) : (state.currentProjectId && canalAberto(state.currentProjectId));
  const c = canal && state.chatProjeto[canal.id];
  if(c && !(chamadaLista ? c.doFimChamada : c.doFim)) lista.scrollTop = lista.scrollHeight;
}

function abrirFotoChat(caminho){
  const u = urlsFotoChat.get(caminho);
  if(u) window.open(u.url, '_blank', 'noopener');
}

// privado, regraMic e criadoPor vêm do salas_projeto.sql (RFC 0005); sem ele,
// todo canal é aberto e toda sala é livre.
function canalLinha(r){
  return {
    id: r.id, projectId: r.project_id, tipo: r.tipo, nome: r.nome || '', categoriaId: r.categoria_id || null, posicao: Number(r.posicao) || 0, created: r.created_at || '',
    privado: r.privado === true && r.tipo !== 'categoria',
    regraMic: r.tipo === 'voz' && ['fechado', 'silencio'].includes(r.regra_mic) ? r.regra_mic : 'livre',
    criadoPor: typeof r.criado_por === 'string' ? r.criado_por : null
  };
}

// O chat e a chamada de antes, para quando o canais_projeto.sql ainda não rodou.
function canaisVirtuais(pid){
  return [
    {id: pid, projectId: pid, tipo: 'texto', nome: 'geral', categoriaId: null, posicao: 0, created: '', virtual: true},
    {id: `voz-${pid}`, projectId: pid, tipo: 'voz', nome: 'Geral', categoriaId: null, posicao: 1, created: '', virtual: true}
  ];
}

function ordemCanal(a, b){
  return (a.posicao - b.posicao) || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0) || (a.id < b.id ? -1 : 1);
}

function canaisDoProjeto(pid){
  if(canaisSemTabela) return canaisVirtuais(pid);
  return (canaisPorProjeto[pid] || []).filter(c=>CANAL_ID.test(c.id)).sort(ordemCanal);
}

function canalDoProjeto(pid, id){
  return id ? canaisDoProjeto(pid).find(c=>c.id === id) || null : null;
}

// Quem vê um canal privado: o dono, quem criou e a lista (SEC-088). A lista
// vem com os canais; o banco confere de novo.
let membrosDosCanais = {};
function pessoaVeCanal(pid, canal, uid){
  if(!canal || !canal.privado) return true;
  const p = state.projects.find(x=>x.id === pid);
  return !!p && (uid === p.owner_id || uid === canal.criadoPor || !!(membrosDosCanais[canal.id] && membrosDosCanais[canal.id].has(uid)));
}

// Como a lista mostra: os canais sem categoria no topo, como no Discord, e
// depois cada categoria com os dela. Canal cuja categoria acabou de sumir
// fica solto até a lista recarregar.
function estruturaCanais(pid){
  const todos = canaisDoProjeto(pid);
  const categorias = todos.filter(c=>c.tipo === 'categoria');
  const ids = new Set(categorias.map(c=>c.id));
  const canais = todos.filter(c=>c.tipo === 'texto' || c.tipo === 'voz');
  return {
    soltos: canais.filter(c=>!c.categoriaId || !ids.has(c.categoriaId)),
    categorias: categorias.map(cat=>({cat, canais: canais.filter(c=>c.categoriaId === cat.id)}))
  };
}

function canaisNaOrdem(pid){
  const e = estruturaCanais(pid);
  return [...e.soltos, ...e.categorias.flatMap(g=>g.canais)];
}

function canaisDeTexto(pid){ return canaisNaOrdem(pid).filter(c=>c.tipo === 'texto'); }
function salasDoProjeto(pid){ return canaisNaOrdem(pid).filter(c=>c.tipo === 'voz'); }

// Mensagem direta (RFC 0006, SEC-091): um canal privado de duas pessoas, fora
// da árvore de canais. Só as duas veem; nem o dono do projeto.
function conversasDiretas(pid){
  if(canaisSemTabela) return [];
  return canaisDoProjeto(pid).filter(c=>c.tipo === 'direta');
}
function ehConversaDireta(canal){ return !!canal && canal.tipo === 'direta'; }
function canalDeMensagens(canal){ return !!canal && (canal.tipo === 'texto' || canal.tipo === 'direta'); }
// O outro lado da conversa: quem está na lista e não sou eu.
function outroDaConversa(canal){
  const lista = canal && membrosDosCanais[canal.id];
  const eu = session && session.user.id;
  return lista ? [...lista].find(u=>u !== eu) || null : null;
}
function nomeDaConversa(pid, canal){
  const outro = outroDaConversa(canal);
  const p = state.projects.find(x=>x.id === pid);
  return outro && p ? nomeAutorChat(p, outro, null) : 'Conversa direta';
}
// Como o canal aparece em textos curtos: #nome, o nome da pessoa ou da sala.
function rotuloDoCanal(pid, canal){
  if(!canal) return '';
  if(ehConversaDireta(canal)) return nomeDaConversa(pid, canal);
  return canal.tipo === 'texto' ? `#${canal.nome}` : canal.nome;
}

// Pode mexer em algum tipo de canal (o + da lista, o modo de organizar).
function podeEditarCanais(p){
  return !!p && !canaisSemTabela && (temPermissaoVoz(p.id, 'texto') || temPermissaoVoz(p.id, 'voz'));
}

function telaEstreita(){
  return window.matchMedia('(max-width:900px)').matches;
}

// O canal de texto aberto em cada projeto fica guardado no aparelho; sem
// escolha (ou com o canal apagado), abre o primeiro.
function canalAberto(pid){
  let escolhido = '';
  try{ escolhido = localStorage.getItem(`canal:${pid}`) || ''; }catch(e){}
  const textos = canaisDeTexto(pid);
  return textos.find(c=>c.id === escolhido) || conversasDiretas(pid).find(c=>c.id === escolhido) || textos[0] || null;
}

function guardarCanalAberto(pid, id){
  try{ localStorage.setItem(`canal:${pid}`, id); }catch(e){}
}

async function carregarCanais(){
  if(!session || canaisSemTabela){ canaisCarregados = true; return; }
  if(canaisCarregando) return canaisCarregando;
  canaisCarregando = (async ()=>{
    const ids = state.projects.map(p=>p.id);
    if(!ids.length){ canaisPorProjeto = {}; canaisCarregados = true; canaisErro = ''; return; }
    const {data, error} = await sb.from('project_channels').select('*').in('project_id', ids);
    if(error){
      if(chatErroSemTabela(error)){
        canaisSemTabela = true;
        canaisCarregados = true;
        console.warn('Canais do projeto: rode supabase/canais_projeto.sql para ativar.', error);
      }else{
        console.error(error);
        canaisErro = `${error.code || 'erro'}: ${error.message || ''}`;
      }
      return;
    }
    const novo = {};
    ids.forEach(id=>{ novo[id] = []; });
    (data || []).forEach(r=>{ const c = canalLinha(r); if(novo[c.projectId]) novo[c.projectId].push(c); });
    // Quem vê cada canal privado (só dos que eu vejo, pelo RLS), para o
    // "Mover para" não oferecer sala em que a pessoa não pode entrar.
    const privados = Object.values(novo).flat().filter(c=>c.privado).map(c=>c.id);
    const listas = {};
    if(privados.length){
      const {data: membros, error: erroMembros} = await sb.from('project_channel_membros').select('canal_id, user_id').in('canal_id', privados);
      if(erroMembros) console.warn('lista dos canais privados:', erroMembros.message);
      for(const m of membros || []) (listas[m.canal_id] = listas[m.canal_id] || new Set()).add(m.user_id);
    }
    canaisPorProjeto = novo;
    membrosDosCanais = listas;
    canaisCarregados = true;
    canaisErro = '';
  })();
  try{ await canaisCarregando; }finally{ canaisCarregando = null; }
}

function tentarCanaisDeNovo(){
  canaisErro = '';
  skipEntranceOnce = true;
  render();
  carregarNaoLidasChat();
}

// Criar, renomear e apagar canal chega pelo realtime (de quem quer que seja,
// inclusive desta aba). Junta as mudanças seguidas numa recarga só.
function agendarCanais(){
  clearTimeout(canaisTimer);
  canaisTimer = setTimeout(async ()=>{
    await carregarCanais();
    aposMudarCanais();
  }, 300);
}

function aposMudarCanais(){
  for(const chave of Object.keys(state.chatProjeto)){
    const c = state.chatProjeto[chave];
    if(c.projectId && !canalDoProjeto(c.projectId, chave)) delete state.chatProjeto[chave];
  }
  agendarContagemChat();
  // Sala privada nova (ou que deixou de ser) muda os tópicos assinados, e a
  // sala da chamada pode ter mudado de tópico ou sumido.
  conferirSalaDaChamada();
  if(!chamada) sincronizarCanaisChamada();
  aplicarModeracaoNaChamada();
  atualizarFaixaChamada();
  if(state.view !== 'project' || state.projectTasksView !== 'chat') return;
  // Com o mesmo canal aberto troca só a lista, para não mexer no campo em que
  // a pessoa está digitando; se o canal aberto sumiu, redesenha.
  const conversa = document.querySelector('.cn-conversa');
  const aberto = canalAberto(state.currentProjectId);
  if(conversa && (conversa.dataset.canal || '') === (aberto ? aberto.id : '')) atualizarListaCanais();
  else { skipEntranceOnce = true; safeRerender(); }
}

async function carregarNaoLidasChat(){
  if(chatSemTabela || !session) return;
  await carregarCanais();
  const porCanal = !canaisSemTabela;
  const [{data, error}, {data: leituras}, {data: leiturasCanal}] = await Promise.all([
    sb.rpc(porCanal ? 'contar_nao_lidas_canais' : 'contar_nao_lidas'),
    sb.from('project_chat_reads').select('project_id, lido_ate, silenciado'),
    porCanal ? sb.from('project_channel_reads').select('canal_id, lido_ate') : Promise.resolve({data: []})
  ]);
  if(error){
    if(chatErroSemTabela(error)){
      chatSemTabela = true;
      console.warn('Chat do projeto: rode supabase/chat_projeto.sql para ativar.', error);
    }else console.error(error);
    return;
  }
  chatNaoLidas = {};
  chatNaoLidasCanal = {};
  (data || []).forEach(r=>{
    const n = Number(r.n) || 0;
    chatNaoLidasCanal[porCanal ? r.canal_id : r.project_id] = n;
    chatNaoLidas[r.project_id] = (chatNaoLidas[r.project_id] || 0) + n;
  });
  chatLeitura = {};
  leituraCanal = {};
  (leituras || []).forEach(r=>{
    chatLeitura[r.project_id] = {silenciado: !!r.silenciado};
    if(!porCanal) leituraCanal[r.project_id] = r.lido_ate;
  });
  (leiturasCanal || []).forEach(r=>{ leituraCanal[r.canal_id] = r.lido_ate; });
  // Quem saiu de um projeto, ou viu o canal ser apagado, não guarda a conversa
  // dele na memória da aba.
  for(const chave of Object.keys(state.chatProjeto)){
    const c = state.chatProjeto[chave];
    if(!c.projectId || !canalDoProjeto(c.projectId, chave)) delete state.chatProjeto[chave];
  }
  ligarRealtimeChat();
  marcarChatLido();
  renderSidebarProjects();
  atualizarContadorAbaChat();
  atualizarListaCanais();
  atualizarFaixaChamada();
}

function agendarContagemChat(){
  if(chatContagemTimer) clearTimeout(chatContagemTimer);
  chatContagemTimer = setTimeout(carregarNaoLidasChat, 800);
}

function naoLidasChat(pid){
  return chatSemTabela ? 0 : (chatNaoLidas[pid] || 0);
}

function rotuloNaoLidas(n){
  return n > 99 ? '99+' : String(n);
}

// Contador pequeno para pôr ao lado do nome do projeto nas listas.
function seloNaoLidas(pid){
  const n = naoLidasChat(pid);
  if(!n) return '';
  return `<span class="chat-selo" aria-label="${n} mensage${n > 1 ? 'ns' : 'm'} não lida${n > 1 ? 's' : ''} nos canais">${rotuloNaoLidas(n)}</span>`;
}

// A aba Canais é a única coisa do projeto que muda com o contador; trocar só
// ela evita redesenhar o quadro inteiro a cada mensagem.
function atualizarContadorAbaChat(){
  const aba = document.querySelector('.proj-view-aba[data-aba="chat"]');
  if(!aba || !state.currentProjectId) return;
  const velho = aba.querySelector('.chat-selo');
  if(velho) velho.remove();
  if(state.projectTasksView !== 'chat') aba.insertAdjacentHTML('beforeend', seloNaoLidas(state.currentProjectId));
  // O selo muda a largura da aba; o realce acompanha sem andar.
  posicionarRealceDasAbas(null);
}

// A conversa deste canal está montada na aba Canais do projeto aberto.
function canalNaTela(canalId){
  if(state.view !== 'project' || state.projectTasksView !== 'chat' || !state.currentProjectId) return false;
  const aberto = canalAberto(state.currentProjectId);
  return !!aberto && aberto.id === canalId;
}

// E está à vista: no celular, a lista ocupa a tela até a pessoa abrir o canal.
function chatAberto(canalId){
  return canalNaTela(canalId) && (!telaEstreita() || !!lendoCanal[state.currentProjectId]);
}

function chaveConversa(m){
  return canaisSemTabela ? m.projectId : m.canalId;
}

function conversaVazia(canal, atual){
  return {projectId: canal.projectId, lista: [], erro: null, temMais: false, rascunho: atual ? atual.rascunho : '', doFim: 0};
}

async function carregarChatCanal(canal, anteriores){
  if(!canal || chatCarregando.has(canal.id)) return;
  const atual = state.chatProjeto[canal.id];
  chatCarregando.add(canal.id);
  let q = sb.from('project_messages').select('*');
  q = canal.virtual ? q.eq('project_id', canal.projectId) : q.eq('canal_id', canal.id);
  q = q.order('created_at', {ascending: false}).limit(CHAT_POR_PAGINA);
  if(anteriores && atual && atual.lista.length) q = q.lt('created_at', atual.lista[0].created);
  const {data, error} = await q;
  chatCarregando.delete(canal.id);
  if(error){
    console.error(error);
    if(chatErroSemTabela(error) && canal.virtual){
      chatSemTabela = true;
      state.chatProjeto[canal.id] = conversaVazia(canal, atual);
    }else if(anteriores){
      showToast('Não deu para carregar as mensagens anteriores. Tente de novo em instantes.', 'erro');
      return;
    }else{
      state.chatProjeto[canal.id] = {...conversaVazia(canal, atual), erro: `${error.code || 'erro'}: ${error.message || ''}`};
    }
  }else{
    const novas = (data || []).map(mensagemChatLinha).reverse();
    if(anteriores && atual){
      atual.lista = [...novas, ...atual.lista];
      atual.temMais = novas.length === CHAT_POR_PAGINA;
    }else{
      state.chatProjeto[canal.id] = {...conversaVazia(canal, atual), lista: novas, temMais: novas.length === CHAT_POR_PAGINA};
    }
    ligarRealtimeChat();
  }
  if(canalNaTela(canal.id)){
    if(anteriores) atualizarListaChat(canal.id, true);
    else { skipEntranceOnce = true; safeRerender(); }
    marcarChatLido();
  }
  if(chatDaChamadaMostra(canal.id)){
    if(anteriores) atualizarChatDaChamada(canal.id, true);
    else montarPainelChat();
    marcarLidoNaChamada();
  }
}

// O botão vem da página do projeto ou do chat da chamada (que pode ser de
// outro projeto que o da tela).
function carregarAnterioresChat(canalId){
  const pid = state.currentProjectId;
  const canal = (pid && canalDoProjeto(pid, canalId)) || (chamada && canalDoProjeto(chamada.pid, canalId));
  carregarChatCanal(canal, true);
}

// Canal próprio, ligado só depois que a tabela respondeu, como o das notas.
// Postgres Changes reconfere o RLS de leitura a cada mensagem: quem sai do
// projeto para de receber na hora. Os canais vêm pelo mesmo canal.
function ligarRealtimeChat(){
  if(canalChat || chatSemTabela) return;
  let c = sb.channel('chat-projeto')
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'project_messages'}, (payload)=>{
      if(payload.new) receberMensagemChat(mensagemChatLinha(payload.new));
    })
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'project_messages'}, (payload)=>{
      if(!payload.new) return;
      const m = mensagemChatLinha(payload.new);
      const chave = chaveConversa(m);
      const c = chave && state.chatProjeto[chave];
      if(c){
        const i = c.lista.findIndex(x=>x.id === m.id);
        if(i >= 0){ c.lista[i] = m; atualizarListaChat(chave); atualizarChatDaChamada(chave); }
      }
      // Uma mensagem apagada sai da contagem de quem ainda não tinha lido.
      if(m.apagada && m.authorId !== session.user.id) agendarContagemChat();
    });
  if(!canaisSemTabela) c = c.on('postgres_changes', {event:'*', schema:'public', table:'project_channels'}, ()=>agendarCanais());
  canalChat = c.subscribe();
}

function receberMensagemChat(m){
  const pid = m.projectId;
  const chave = chaveConversa(m);
  const c = chave && state.chatProjeto[chave];
  // Mensagem de um canal que eu ainda não conheço: uma conversa direta que a
  // outra pessoa acabou de abrir comigo. A lista de canais recarrega.
  if(chave && !canaisSemTabela && !canalDoProjeto(pid, chave)) agendarCanais();
  if(c && !c.lista.some(x=>x.id === m.id)){
    c.lista.push(m);
    atualizarListaChat(chave);
    atualizarChatDaChamada(chave);
  }
  if(m.kind === 'chamada_inicio') avisarChamadaIniciada(m);
  if(m.authorId === session.user.id || m.kind !== 'texto' || m.apagada) return;
  if((chatAberto(chave) || chatDaChamadaMostra(chave)) && !document.hidden){
    marcarChatLido();
    marcarLidoNaChamada();
    return;
  }
  if(chave) chatNaoLidasCanal[chave] = (chatNaoLidasCanal[chave] || 0) + 1;
  chatNaoLidas[pid] = (chatNaoLidas[pid] || 0) + 1;
  renderSidebarProjects();
  atualizarContadorAbaChat();
  atualizarSeloChatDaChamada();
  atualizarListaCanais();
  if(state.view === 'projects') safeRerender();
  notificarMensagemChat(m);
}

// Só com a aba do app escondida e o projeto não silenciado. A API de
// notificação recebe texto puro, então nada aqui passa por esc().
function notificarMensagemChat(m){
  if(!document.hidden) return;
  if(chatLeitura[m.projectId] && chatLeitura[m.projectId].silenciado) return;
  if(!window.Notification || Notification.permission !== 'granted') return;
  const p = state.projects.find(x=>x.id === m.projectId);
  if(!p) return;
  const canal = canalDoProjeto(p.id, chaveConversa(m));
  const trecho = m.body.length > 100 ? m.body.slice(0, 100) + '…' : m.body;
  // Com um canal só, o nome dele não diz nada; com vários, vai na frente.
  const corpo = ehConversaDireta(canal) ? `(mensagem direta) ${trecho}` : canal && canaisDeTexto(p.id).length > 1 ? `#${canal.nome}: ${trecho}` : trecho;
  try{
    const n = new Notification(`${nomeAutorChat(p, m.authorId, m.autorNome)} em ${p.name}`, {body: corpo, tag: `chat-${canal ? canal.id : p.id}`});
    n.onclick = ()=>{
      window.focus();
      n.close();
      abrirChatDoProjeto(p.id, canal && canal.id);
    };
  }catch(e){}
}

function abrirChatDoProjeto(pid, canalId){
  if(canalId){ guardarCanalAberto(pid, canalId); lendoCanal[pid] = true; }
  if(!(state.view === 'project' && state.currentProjectId === pid)) openProjectView(pid);
  setProjectTasksView('chat');
}

function abrirCanal(id){
  const pid = state.currentProjectId;
  const canal = pid && canalDoProjeto(pid, id);
  if(!canalDeMensagens(canal)) return;
  guardarCanalAberto(pid, id);
  lendoCanal[pid] = true;
  skipEntranceOnce = true;
  render();
  // No computador o foco vai para o campo, para já escrever.
  const campo = document.getElementById('chat-input');
  if(campo && !telaEstreita()) campo.focus({preventScroll: true});
}

function voltarListaCanais(){
  const pid = state.currentProjectId;
  if(!pid) return;
  lendoCanal[pid] = false;
  skipEntranceOnce = true;
  render();
  const aberto = canalAberto(pid);
  const linha = aberto && document.querySelector(`[data-foco="canal:${aberto.id}"]`);
  if(linha) linha.focus();
}

// Guarda o "até onde li" no banco quando a conversa está na tela. Usa a data
// da última mensagem (do servidor), não o relógio do aparelho.
let chatLeituraEmVoo = null;
async function marcarChatLido(){
  const pid = state.currentProjectId;
  if(!pid || document.hidden || chatSemTabela) return;
  const canal = canalAberto(pid);
  if(!canal || !chatAberto(canal.id)) return;
  await marcarCanalLido(pid, canal);
}

// O "até onde li" de um canal que está à vista (na página do projeto ou no
// chat da chamada).
async function marcarCanalLido(pid, canal){
  if(!pid || !canal || document.hidden || chatSemTabela) return;
  const c = state.chatProjeto[canal.id];
  if(!c || !c.lista.length) return;
  const ultima = c.lista[c.lista.length - 1].created;
  const lidoAte = leituraCanal[canal.id];
  const tinha = chatNaoLidasCanal[canal.id] || 0;
  if(lidoAte && new Date(lidoAte) >= new Date(ultima) && !tinha) return;
  if(chatLeituraEmVoo === `${canal.id}:${ultima}`) return;
  chatLeituraEmVoo = `${canal.id}:${ultima}`;
  chatNaoLidasCanal[canal.id] = 0;
  chatNaoLidas[pid] = Math.max(0, (chatNaoLidas[pid] || 0) - tinha);
  leituraCanal[canal.id] = ultima;
  if(tinha){ renderSidebarProjects(); atualizarListaCanais(); atualizarSeloChatDaChamada(); }
  const {error} = canal.virtual
    ? await sb.from('project_chat_reads').upsert({project_id: pid, user_id: session.user.id, lido_ate: ultima}, {onConflict: 'project_id,user_id'})
    : await sb.from('project_channel_reads').upsert({canal_id: canal.id, project_id: pid, user_id: session.user.id, lido_ate: ultima}, {onConflict: 'canal_id,user_id'});
  chatLeituraEmVoo = null;
  if(error) console.error(error);
}

document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden){ marcarChatLido(); marcarLidoNaChamada(); }
});

async function alternarSilencioChat(){
  const pid = state.currentProjectId;
  if(!pid) return;
  const leitura = chatLeitura[pid] || {silenciado: false};
  const silenciado = !leitura.silenciado;
  chatLeitura[pid] = {...leitura, silenciado};
  skipEntranceOnce = true;
  render();
  const {error} = await sb.from('project_chat_reads').upsert({project_id: pid, user_id: session.user.id, silenciado}, {onConflict: 'project_id,user_id'});
  if(error){
    console.error(error);
    chatLeitura[pid] = leitura;
    skipEntranceOnce = true;
    safeRerender();
    showToast('Não deu para mudar as notificações do projeto. Tente de novo em instantes.', 'erro');
    return;
  }
  showToast(silenciado ? 'Projeto silenciado: o contador continua, a notificação para' : 'Notificações do projeto ligadas');
}

function nomeAutorChat(p, authorId, autorNome){
  if(authorId && authorId === session.user.id) return 'Você';
  // Quem ainda está no projeto aparece com o nome de agora. Quem saiu some do
  // RLS de profiles e daqui, e fica o nome que a mensagem guardou; sem ele
  // (mensagem de antes do autor_das_mensagens.sql, ou perfil sem nome),
  // "Ex-membro".
  const pessoa = authorId && projectPeople(p).find(pe=>pe.id === authorId);
  return pessoa ? pessoa.label : (autorNome || 'Ex-membro');
}

function perfilAutorChat(p, authorId){
  if(authorId === session.user.id) return meuPerfilDeNome();
  const pessoa = authorId && projectPeople(p).find(pe=>pe.id === authorId);
  return pessoa ? pessoa.profile : null;
}

// SEC-072: o texto passa por esc() primeiro; os links são achados depois, no
// texto já escapado, só com https. A quebra de linha vem do CSS (pre-wrap).
function textoChatHtml(body){
  return esc(body).replace(/https:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<])+/g, (url)=>{
    const fim = url.match(/[.,;:!?)\]]+$/);
    const corte = fim ? url.slice(0, -fim[0].length) : url;
    const resto = fim ? fim[0] : '';
    return `<a href="${corte}" target="_blank" rel="noopener noreferrer">${corte}</a>${resto}`;
  });
}

function diaChat(iso){
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmo = (a, b)=> a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if(mesmo(d, hoje)) return 'Hoje';
  if(mesmo(d, ontem)) return 'Ontem';
  return d.toLocaleDateString(LOCALE_APP, d.getFullYear() === hoje.getFullYear() ? {day: 'numeric', month: 'long'} : {day: 'numeric', month: 'long', year: 'numeric'});
}

function horaChat(iso){
  return new Date(iso).toLocaleTimeString(LOCALE_APP, {hour: '2-digit', minute: '2-digit'});
}

// Mensagens agrupadas por dia e, dentro do dia, por autor: o nome e a foto
// aparecem uma vez por sequência, e não a cada mensagem. As suas também levam
// nome e foto, do lado direito, para a conversa ler igual para todo mundo.
// O horário fica no canto de cada balão.
function renderListaChat(p, c, canal){
  if(!c.lista.length){
    if(ehConversaDireta(canal)) return `<div class="chat-vazio"><strong>Comece a conversa com ${esc(nomeDaConversa(p.id, canal))}.</strong>Só vocês dois veem estas mensagens, nem o dono do projeto.</div>`;
    return `<div class="chat-vazio"><strong>Nenhuma mensagem em #${esc(canal.nome)} ainda.</strong>${canal.privado ? 'Só quem está na lista deste canal lê e escreve aqui.' : 'Todo mundo do projeto lê e escreve aqui, inclusive quem só visualiza. Quem é de fora não vê.'}</div>`;
  }
  const isOwner = p.myRole === 'owner';
  let html = c.temMais && CANAL_ID.test(canal.id) ? `<div class="chat-anteriores"><button class="btn-secondary" onclick="carregarAnterioresChat('${canal.id}')">Mostrar mensagens anteriores</button></div>` : '';
  let diaAnterior = '';
  let autorAnterior = null;
  let ultimaHora = 0;
  c.lista.forEach(m=>{
    const dia = diaChat(m.created);
    if(dia !== diaAnterior){
      html += `<div class="chat-dia" role="separator"><span>${esc(dia)}</span></div>`;
      diaAnterior = dia;
      autorAnterior = null;
    }
    // Só no chat de antes (sem os canais) as linhas de chamada caem aqui; com
    // os canais, elas são da sala de voz.
    if(m.kind !== 'texto'){
      const texto = m.kind === 'chamada_inicio' ? 'Chamada iniciada'
        : `Chamada encerrada${m.duracao ? ` · ${Math.max(1, Math.round(m.duracao / 60))} min` : ''}`;
      html += `<div class="chat-sistema">${texto} · ${horaChat(m.created)}</div>`;
      autorAnterior = null;
      return;
    }
    const minha = m.authorId === session.user.id;
    const t = new Date(m.created).getTime();
    // Uma pausa longa reabre o cabeçalho mesmo com o mesmo autor.
    const novoGrupo = m.authorId !== autorAnterior || t - ultimaHora > 10 * 60 * 1000;
    autorAnterior = m.authorId;
    ultimaHora = t;
    // nomeAutorChat diz "Você" para a própria conta (serve à notificação);
    // no balão vai o nome do perfil, o mesmo que os outros veem.
    const nome = minha ? (getUserName() || 'Você') : nomeAutorChat(p, m.authorId, m.autorNome);
    const podeApagar = !m.apagada && (isOwner || minha);
    // O horário é de cada mensagem e vai dentro do balão; em cima do grupo
    // fica só o nome, ao lado da foto.
    const horaNoBalao = `<time class="chat-hora" datetime="${esc(m.created)}">${horaChat(m.created)}</time>`;
    html += `
      <div class="chat-msg ${minha ? 'minha' : ''} ${novoGrupo ? 'inicio' : ''}">
        ${novoGrupo ? `<div class="chat-msg-avatar">${avatarChip(perfilAutorChat(p, m.authorId), nome[0])}</div>` : ''}
        <div class="chat-msg-corpo">
          ${novoGrupo ? `<div class="chat-msg-nome">${nomePessoaHtml(minha ? meuPerfilDeNome() : perfilAutorChat(p, m.authorId), nome)}</div>` : ''}
          <div class="chat-msg-linha">
            ${m.apagada
              ? `<div class="chat-balao apagada">mensagem apagada${horaNoBalao}</div>`
              : `<div class="chat-balao ${m.imagem ? 'com-foto' : ''} ${m.imagem && !m.body.trim() ? 'so-foto' : ''}">${m.imagem ? `<button type="button" class="chat-foto" onclick="abrirFotoChat('${m.imagem}')" aria-label="${esc(`Abrir a foto de ${nome}`)}"><img data-anexo="${m.imagem}" alt="${esc(m.body.trim() ? `Foto: ${m.body.trim().slice(0, 80)}` : `Foto enviada por ${nome}`)}" decoding="async" onload="fotoChatCarregou(this)" onerror="this.closest('.chat-foto').classList.add('falhou')"></button>` : ''}${m.body.trim() ? `<span class="chat-texto">${textoChatHtml(m.body)}</span>` : ''}${horaNoBalao}</div>`}
            ${podeApagar ? `<button class="chat-apagar" onclick="apagarMensagemChat('${m.id}')" title="Apagar mensagem" aria-label="Apagar mensagem">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>` : ''}
          </div>
        </div>
      </div>`;
  });
  return html;
}

/* --- lista de canais --- */

function categoriasFechadas(pid){
  try{ return new Set(JSON.parse(localStorage.getItem(`canaisFechados:${pid}`) || '[]')); }catch(e){ return new Set(); }
}

function alternarCategoria(id){
  const pid = state.currentProjectId;
  if(!pid || !canalDoProjeto(pid, id)) return;
  const fechadas = categoriasFechadas(pid);
  if(fechadas.has(id)) fechadas.delete(id); else fechadas.add(id);
  try{ localStorage.setItem(`canaisFechados:${pid}`, JSON.stringify([...fechadas])); }catch(e){}
  atualizarListaCanais();
}

// Quem está em cada sala, pela Presence dos tópicos do projeto (o dele e o de
// cada sala privada que a pessoa vê).
function pessoasNasSalas(pid){
  const porSala = {};
  for(const x of emChamadaDoProjeto(pid)) if(x.sala) (porSala[x.sala] = porSala[x.sala] || []).push(x);
  return porSala;
}

function botaoEditarCanal(canal){
  const rotulo = canal.tipo === 'categoria' ? `Editar a categoria ${canal.nome}` : canal.tipo === 'voz' ? `Editar a sala ${canal.nome}` : `Editar o canal #${canal.nome}`;
  return `<button class="cn-acao cn-editar" data-foco="editar:${canal.id}" onclick="editarCanal('${canal.id}')" title="${canal.tipo === 'categoria' ? 'Editar categoria' : canal.tipo === 'voz' ? 'Editar sala' : 'Editar canal'}" aria-label="${esc(rotulo)}">${ICONE_LAPIS}</button>`;
}

const ICONE_CADEADO = '<svg class="cn-cadeado" aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

// Cadeado no canal privado e o microfone riscado na sala com regra (RFC 0005).
function marcasDoCanal(canal){
  let html = '';
  if(canal.privado) html += `<span class="cn-marca" title="${canal.tipo === 'voz' ? 'Sala privada' : 'Canal privado'}">${ICONE_CADEADO}<span class="sr-only">, privado</span></span>`;
  if(canal.tipo === 'voz' && canal.regraMic !== 'livre'){
    const t = canal.regraMic === 'silencio' ? 'Sala de silêncio' : 'Entra com o microfone fechado';
    html += `<span class="cn-marca ${canal.regraMic}" title="${t}">${iconeChamada('micOff', 12)}<span class="sr-only">, ${t.toLowerCase()}</span></span>`;
  }
  return html;
}

function linhaCanalTexto(canal, aberto, pode){
  const ativo = !!aberto && canal.id === aberto.id;
  const n = chatNaoLidasCanal[canal.id] || 0;
  const movel = pode && !canal.virtual;
  return `
    <li class="cn-linha ${movel ? 'editavel' : ''}" data-id="${canal.id}" data-cat="${canal.categoriaId || ''}"${movel ? ' data-movel="1"' : ''}>
      ${movel && organizandoCanais ? `<span class="cn-alca" aria-hidden="true">${ICONE_PEGA}</span>` : ''}
      <button class="cn-canal ${ativo ? 'ativo' : ''} ${n && !ativo ? 'nao-lido' : ''}" data-foco="canal:${canal.id}" onclick="abrirCanal('${canal.id}')"${ativo ? ' aria-current="true"' : ''}${movel ? ' aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"' : ''}>
        ${ICONE_CANAL_TEXTO}<span class="sr-only">Canal de texto </span><span class="cn-nome">${esc(canal.nome)}</span>${marcasDoCanal(canal)}${n && !ativo ? `<span class="chat-selo" aria-label="${n} não lida${n > 1 ? 's' : ''}">${rotuloNaoLidas(n)}</span>` : ''}
      </button>
      ${movel ? botaoEditarCanal(canal) : ''}
    </li>`;
}

// Itens do menu de moderação de alguém numa sala: o que o cargo de quem abre
// permite (SEC-087). O banco confere de novo.
function itensModeracao(pid, uid, salaAtual){
  const item = (acao, nome, desc, perigo)=>`<button role="menuitem" class="novo-menu-item ${perigo ? 'perigo' : ''}" onclick="fecharMenuNovoAberto();${acao}"><span class="novo-menu-nome">${nome}</span>${desc ? `<span class="novo-menu-desc">${desc}</span>` : ''}</button>`;
  const partes = [];
  if(podeModerar(pid, uid, 'silenciar')){
    const sil = silenciadoPeloModerador(pid, uid);
    partes.push(item(`moderarVoz('${pid}','${uid}','${sil ? 'liberar' : 'silenciar'}')`, sil ? 'Liberar o microfone' : 'Silenciar nas salas', sil ? 'Volta a poder falar' : 'Fecha o microfone até alguém liberar'));
  }
  if(podeModerar(pid, uid, 'mover')){
    const outras = salasDoProjeto(pid).filter(s=>s.id !== salaAtual && CHAMADA_UUID.test(s.id) && pessoaVeCanal(pid, s, uid));
    if(outras.length) partes.push(`<div class="novo-menu-titulo" role="presentation">Mover para</div>${outras.map(s=>item(`moderarVoz('${pid}','${uid}','mover','${s.id}')`, `${ICONE_SALA}<span>${esc(s.nome)}</span>`, '')).join('')}`);
    partes.push(item(`moderarVoz('${pid}','${uid}','desconectar')`, 'Desconectar da chamada', 'Tira da sala', true));
  }
  return partes.join('');
}

function linhaSala(p, sala, gente, pode){
  const minha = !!chamada && chamada.pid === p.id && chamada.sala === sala.id;
  const n = gente.length;
  const pessoas = gente.map(x=>{
    const nome = nomeNaChamada(p.id, x.uid);
    const perfil = perfilNaChamada(p.id, x.uid);
    const moderado = silenciadoPeloModerador(p.id, x.uid);
    const fechado = x.ensurdecido || !x.mic || moderado;
    const tituloMudo = moderado ? 'Silenciado por um moderador' : x.ensurdecido ? 'Sem som' : 'Microfone fechado';
    const conteudo = `
        ${avatarChip(perfil, nome[0])}
        <span class="cn-pessoa-nome">${nomePessoaHtml(perfil, nome)}</span>
        ${x.tela ? '<span class="cn-pessoa-tela">Tela</span>' : ''}
        ${fechado ? `<span class="cn-pessoa-mudo ${moderado ? 'moderado' : ''}" title="${tituloMudo}">${iconeChamada(x.ensurdecido && !moderado ? 'foneOff' : 'micOff', 13)}<span class="sr-only">${tituloMudo.toLowerCase()}</span></span>` : ''}`;
    const menu = x.uid !== session.user.id && podeModerar(p.id, x.uid) ? itensModeracao(p.id, x.uid, sala.id) : '';
    if(!menu) return `<li class="cn-pessoa" data-fala="${x.uid}">${conteudo}</li>`;
    const movel = podeModerar(p.id, x.uid, 'mover');
    return `
      <li class="cn-pessoa moderavel" data-fala="${x.uid}" data-uid="${x.uid}" data-sala="${sala.id}"${movel ? ' data-movel="1"' : ''}>
        <div class="novo-menu cn-pessoa-menu">
          <button type="button" class="cn-pessoa-btn novo-menu-btn" data-foco="pessoa:${x.uid}" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)" aria-label="${esc(`${nome}: moderar`)}"${movel ? ' title="Clique para moderar, ou segure e arraste para outra sala"' : ''}>${conteudo}</button>
          <div class="novo-menu-lista cn-pessoa-lista" role="menu" hidden>${menu}</div>
        </div>
      </li>`;
  }).join('');
  const movel = pode && !sala.virtual;
  // Há quanto tempo a sala está em ligação (RFC 0006): desde quem entrou
  // primeiro entre os que estão nela agora. Na minha sala, o mesmo relógio
  // da chamada.
  const desde = !n ? 0 : (minha && chamada.inicio ? chamada.inicio : Math.min(...gente.map(x=>Number(x.desde) || Date.now())));
  const tempo = desde ? `<span class="cn-sala-tempo" data-desde="${desde}" title="Tempo em ligação"><span class="sr-only">, em ligação há </span><span class="cn-sala-tempo-v">${formatarDuracaoChamada(Math.max(0, Date.now() - desde))}</span></span>` : '';
  if(desde) ligarRelogioDasSalas();
  return `
    <li class="cn-linha ${movel ? 'editavel' : ''}" data-id="${sala.id}" data-cat="${sala.categoriaId || ''}" data-sala="${sala.id}"${movel ? ' data-movel="1"' : ''}>
      ${movel && organizandoCanais ? `<span class="cn-alca" aria-hidden="true">${ICONE_PEGA}</span>` : ''}
      <button class="cn-canal voz ${minha ? 'ativo' : ''} ${n ? 'com-gente' : ''}" data-foco="canal:${sala.id}" onclick="entrarNaSala('${p.id}','${sala.id}')" title="${minha ? 'Você está nesta sala' : 'Entrar na sala'}"${movel ? ' aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"' : ''}>
        ${ICONE_SALA}<span class="sr-only">Sala de voz </span><span class="cn-nome">${esc(sala.nome)}</span>${marcasDoCanal(sala)}${tempo}${n ? `<span class="cn-sala-n"><span class="sr-only">, </span>${n}<span class="sr-only"> na sala</span></span>` : ''}
      </button>
      ${movel ? botaoEditarCanal(sala) : ''}
      ${n ? `<ul class="cn-sala-gente" role="list" aria-label="Na sala ${esc(sala.nome)}">${pessoas}</ul>` : ''}
    </li>`;
}

const ICONE_DM = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1121 12z"/></svg>';

// Mensagens diretas na lista de canais (RFC 0006): a conversa de cada pessoa,
// com o avatar dela, e o + para começar uma nova com quem está no projeto.
function secaoConversasDiretas(p, aberto){
  if(canaisSemTabela || !session) return '';
  const eu = session.user.id;
  const conversas = conversasDiretas(p.id)
    .map(c=>({c, outro: outroDaConversa(c)}))
    .filter(x=>x.outro)
    .sort((a, b)=>nomeAutorChat(p, a.outro, null).localeCompare(nomeAutorChat(p, b.outro, null), 'pt-BR'));
  const comConversa = new Set(conversas.map(x=>x.outro));
  const pessoas = projectPeople(p).filter(pe=>pe.id && pe.id !== eu && CHAMADA_UUID.test(pe.id) && !comConversa.has(pe.id));
  const linhas = conversas.map(({c, outro})=>{
    const ativo = !!aberto && c.id === aberto.id;
    const n = chatNaoLidasCanal[c.id] || 0;
    const nome = nomeAutorChat(p, outro, null);
    return `
      <li class="cn-linha cn-dm" data-id="${c.id}">
        <button class="cn-canal ${ativo ? 'ativo' : ''} ${n && !ativo ? 'nao-lido' : ''}" data-foco="canal:${c.id}" onclick="abrirCanal('${c.id}')"${ativo ? ' aria-current="true"' : ''}>
          ${avatarChip(perfilAutorChat(p, outro), (nome || '?')[0])}<span class="sr-only">Mensagem direta com </span><span class="cn-nome">${esc(nome)}</span>${n && !ativo ? `<span class="chat-selo" aria-label="${n} não lida${n > 1 ? 's' : ''}">${rotuloNaoLidas(n)}</span>` : ''}
        </button>
      </li>`;
  }).join('');
  const item = pe=>`<button role="menuitem" class="novo-menu-item cn-dm-pessoa" onclick="abrirConversaDireta('${p.id}','${pe.id}')">${avatarChip(pe.profile, (pe.label || '?')[0])}<span class="novo-menu-nome">${nomePessoaHtml(pe.profile, pe.label)}</span></button>`;
  const mais = pessoas.length ? `
        <div class="novo-menu cn-novo">
          <button class="cn-acao novo-menu-btn" data-foco="novo-dm" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)" title="Nova mensagem direta" aria-label="Nova mensagem direta">${ICONE_MAIS}</button>
          <div class="novo-menu-lista" role="menu" hidden><div class="novo-menu-titulo" role="presentation">Conversar com</div>${pessoas.map(item).join('')}</div>
        </div>` : '';
  if(!linhas && !mais) return '';
  return `
      <div class="cn-cat cn-diretas">
        <div class="cn-cat-cab">
          <h4 class="cn-diretas-titulo">Mensagens diretas</h4>
          ${mais}
        </div>
        ${linhas ? `<ul class="cn-grupo" role="list">${linhas}</ul>` : '<p class="cn-diretas-vazio">Só você e a outra pessoa veem a conversa.</p>'}
      </div>`;
}

// Abre (ou cria, pelo banco) a conversa direta com alguém do projeto.
let conversaDiretaAbrindo = false;
async function abrirConversaDireta(pid, uid){
  fecharMenuNovoAberto();
  if(!session || canaisSemTabela || conversaDiretaAbrindo || !CHAMADA_UUID.test(uid) || uid === session.user.id) return;
  let canal = conversasDiretas(pid).find(c=>outroDaConversa(c) === uid);
  if(!canal){
    conversaDiretaAbrindo = true;
    try{
      const {data, error} = await sb.rpc('abrir_conversa_direta', {p_projeto: pid, p_outro: uid});
      if(error){
        console.error(error);
        showToast(chatErroSemTabela(error) ? 'Mensagens diretas: falta rodar o supabase/salas_projeto.sql de novo' : String(error.message || '').startsWith('direta_limite') ? 'O projeto chegou ao limite de conversas diretas' : 'Não deu para abrir a conversa');
        return;
      }
      await carregarCanais();
      aposMudarCanais();
      canal = typeof data === 'string' ? canalDoProjeto(pid, data) : null;
    }finally{ conversaDiretaAbrindo = false; }
    if(!canal){ showToast('Não deu para abrir a conversa'); return; }
  }
  abrirChatDoProjeto(pid, canal.id);
  abrirCanal(canal.id);
}

// Um relógio só para todas as salas com gente na tela; para sozinho quando
// não sobra nenhuma.
let relogioDasSalas = null;
function ligarRelogioDasSalas(){
  if(relogioDasSalas) return;
  relogioDasSalas = setInterval(()=>{
    const els = document.querySelectorAll('.cn-sala-tempo[data-desde]');
    if(!els.length){ clearInterval(relogioDasSalas); relogioDasSalas = null; return; }
    const agora = Date.now();
    els.forEach(el=>{
      const v = el.querySelector('.cn-sala-tempo-v');
      if(v) v.textContent = formatarDuracaoChamada(Math.max(0, agora - Number(el.dataset.desde)));
    });
  }, 1000);
}

// Cada opção aparece para quem tem a regra do tipo (RFC 0006).
function menuNovoCanal(p){
  const item = (acao, nome, desc)=>`<button role="menuitem" class="novo-menu-item" onclick="${acao}"><span class="novo-menu-nome">${nome}</span><span class="novo-menu-desc">${desc}</span></button>`;
  const semCategoria = !canaisDoProjeto(p.id).some(c=>c.tipo === 'categoria');
  const texto = podeMexerNoCanal(p.id, 'texto'), voz = podeMexerNoCanal(p.id, 'voz');
  return `
    <div class="novo-menu cn-novo">
      <button class="cn-acao novo-menu-btn" data-foco="novo" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)" title="Criar canal, sala ou categoria" aria-label="Criar canal, sala ou categoria">${ICONE_MAIS}</button>
      <div class="novo-menu-lista" role="menu" hidden>
        ${texto ? item(`novoCanal('texto')`, 'Canal de texto', 'Conversa com histórico') : ''}
        ${voz ? item(`novoCanal('voz')`, 'Sala de voz', 'Voz, câmera e tela') : ''}
        ${item(`novoCanal('categoria')`, 'Categoria', 'Agrupa canais e salas')}
        ${semCategoria && texto && voz ? item('usarModeloEquipe()', 'Usar o modelo de equipe', 'Comunicação, reuniões com 5 salas e intervalo') : ''}
      </div>
    </div>`;
}

// Modo de organizar (RFC 0006): tocar no título "Canais" liga e desliga. Com
// ele ligado, cada canal mostra a alça e se arrasta já no primeiro movimento,
// sem precisar segurar.
let organizandoCanais = false;
function alternarOrganizarCanais(){
  const p = state.projects.find(x=>x.id === state.currentProjectId);
  if(!podeEditarCanais(p)) return;
  organizandoCanais = !organizandoCanais;
  atualizarListaCanais();
  anunciarNoApp(organizandoCanais ? 'Organizando os canais: arraste pela alça. Toque em Pronto para terminar.' : 'Pronto, canais organizados.');
  const b = document.querySelector('#cn-lista .cn-topo-nome');
  if(b) b.focus();
}

function renderNavCanais(p, aberto){
  const pode = podeEditarCanais(p);
  if(!pode) organizandoCanais = false;
  const e = estruturaCanais(p.id);
  const fechadas = categoriasFechadas(p.id);
  const salas = pessoasNasSalas(p.id);
  const linha = (canal)=> canal.tipo === 'voz' ? linhaSala(p, canal, salas[canal.id] || [], podeMexerNoCanal(p.id, 'voz')) : linhaCanalTexto(canal, aberto, podeMexerNoCanal(p.id, 'texto'));
  const podeCat = podeMexerNoCanal(p.id, 'categoria');
  const grupo = (lista)=> lista.length ? `<ul class="cn-grupo" role="list">${lista.map(linha).join('')}</ul>` : '';
  const categorias = e.categorias.map(({cat, canais})=>{
    const fechada = fechadas.has(cat.id);
    // Recolhida, continua mostrando o canal aberto, os não lidos e as salas
    // com gente.
    const visiveis = !fechada ? canais : canais.filter(c=>(aberto && c.id === aberto.id)
      || (c.tipo === 'voz' && (salas[c.id] || []).length) || (c.tipo === 'texto' && chatNaoLidasCanal[c.id]));
    return `
      <div class="cn-cat ${fechada ? 'fechada' : ''}" data-cat-id="${cat.id}">
        <div class="cn-cat-cab ${podeCat ? 'editavel' : ''}" data-cat-id="${cat.id}"${podeCat ? ' data-movel="1"' : ''}>
          ${podeCat && organizandoCanais ? `<span class="cn-alca" aria-hidden="true">${ICONE_PEGA}</span>` : ''}
          <button class="cn-cat-nome" data-foco="cat:${cat.id}" aria-expanded="${!fechada}" onclick="alternarCategoria('${cat.id}')"${podeCat ? ' aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"' : ''}>
            ${ICONE_SETA_CATEGORIA}<span>${esc(cat.nome)}</span>
          </button>
          ${podeCat ? `${botaoEditarCanal(cat)}<button class="cn-acao" data-foco="novo:${cat.id}" onclick="novoCanal('${podeMexerNoCanal(p.id, 'texto') ? 'texto' : 'voz'}','${cat.id}')" title="Criar canal nesta categoria" aria-label="${esc(`Criar canal ou sala em ${cat.nome}`)}">${ICONE_MAIS}</button>` : ''}
        </div>
        ${grupo(visiveis)}
      </div>`;
  }).join('');
  const vazia = !e.soltos.length && !e.categorias.length;
  // "Canais" é um botão para quem pode mexer: liga o modo de organizar.
  const titulo = pode
    ? `<button type="button" class="cn-topo-nome cn-topo-organizar ${organizandoCanais ? 'ativo' : ''}" data-foco="organizar" onclick="alternarOrganizarCanais()" aria-pressed="${organizandoCanais}" title="${organizandoCanais ? 'Terminar de organizar' : 'Organizar: arrastar canais, salas e categorias'}">${organizandoCanais ? 'Pronto' : 'Canais'}${organizandoCanais ? '' : `<span class="cn-organizar-dica" aria-hidden="true">${ICONE_PEGA}</span>`}</button>`
    : '<h3 class="cn-topo-nome">Canais</h3>';
  return `
    <nav class="cn-lista ${organizandoCanais ? 'organizando' : ''}" id="cn-lista" aria-label="${esc(`Canais de ${p.name}`)}" onpointerdown="iniciarArrastoCanais(event)" onkeydown="teclaCanais(event)">
      <div class="cn-topo">
        ${titulo}
        ${pode && !organizandoCanais ? menuNovoCanal(p) : ''}
      </div>
      <div class="cn-itens">
        ${grupo(e.soltos)}
        ${categorias}
        ${vazia ? `<p class="cn-vazia">${pode ? 'Nenhum canal ainda. Crie o primeiro no +.' : 'Nenhum canal ainda. Quem edita o projeto cria os canais.'}</p>` : ''}
        ${organizandoCanais ? '' : secaoConversasDiretas(p, aberto)}
      </div>
    </nav>`;
}

// Troca só a lista (contadores, quem está nas salas, nomes), sem mexer na
// conversa nem no campo de texto. O foco e a rolagem voltam para onde estavam.
function atualizarListaCanais(){
  if(state.view !== 'project' || state.projectTasksView !== 'chat') return;
  // No meio de um arrasto, redesenhar tiraria o item da mão; ao soltar a lista
  // é redesenhada.
  if(arrastoCanais){ arrastoCanais.redesenhar = true; return; }
  const nav = document.getElementById('cn-lista');
  const p = state.projects.find(x=>x.id === state.currentProjectId);
  if(!nav || !p) return;
  const ativo = document.activeElement;
  const foco = ativo && nav.contains(ativo) ? ativo.dataset.foco : null;
  const itens = nav.querySelector('.cn-itens');
  const rolagem = itens ? itens.scrollTop : 0;
  const menuAberto = !!nav.querySelector('.novo-menu-btn[aria-expanded="true"]');
  if(menuAberto) return;
  const aberto = canalAberto(p.id);
  nav.outerHTML = renderNavCanais(p, aberto);
  const nova = document.getElementById('cn-lista');
  const novosItens = nova && nova.querySelector('.cn-itens');
  if(novosItens) novosItens.scrollTop = rolagem;
  if(foco){
    const alvo = nova.querySelector(`[data-foco="${foco}"]`);
    if(alvo) alvo.focus({preventScroll: true});
  }
  // O anel de quem está falando agora volta já, sem esperar a próxima fala.
  for(const [chave, m] of falaMedidores) if(m.falando) marcarFalaChamada(chave, true);
  // O nome do canal aberto pode ter mudado.
  const titulo = document.querySelector('#cn-conversa-nome .cn-conversa-texto');
  const nomeVisivel = aberto && (ehConversaDireta(aberto) ? nomeDaConversa(p.id, aberto) : aberto.nome);
  if(titulo && aberto && titulo.textContent !== nomeVisivel){
    titulo.textContent = nomeVisivel;
    const campo = document.getElementById('chat-input');
    if(campo){ campo.placeholder = ehConversaDireta(aberto) ? `Mensagem para ${nomeVisivel}…` : `Escreva em #${aberto.nome}…`; campo.setAttribute('aria-label', `Mensagem para ${rotuloDoCanal(p.id, aberto)}`); }
  }
}

function renderConversaCanal(p, canal){
  if(!canal){
    return `
      <div class="cn-conversa cn-conversa-vazia" data-canal="">
        <div class="chat-vazio"><strong>Nenhum canal de texto.</strong>${podeEditarCanais(p) ? 'Crie um no + da lista de canais.' : 'Quem edita o projeto cria os canais.'}</div>
      </div>`;
  }
  const c = state.chatProjeto[canal.id];
  const direta = ehConversaDireta(canal);
  const outro = direta ? outroDaConversa(canal) : null;
  const nomeTopo = direta ? nomeDaConversa(p.id, canal) : canal.nome;
  const rotulo = rotuloDoCanal(p.id, canal);
  const silenciado = !!(chatLeitura[p.id] && chatLeitura[p.id].silenciado);
  const sino = silenciado
    ? '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 01-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0118 8"/><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 00-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
  const topo = `
    <div class="chat-topo">
      <button class="cn-voltar" onclick="voltarListaCanais()">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>Canais
      </button>
      <h3 class="cn-conversa-nome ${direta ? 'direta' : ''}" id="cn-conversa-nome">${direta ? avatarChip(perfilAutorChat(p, outro), (nomeTopo || '?')[0]) : ICONE_CANAL_TEXTO}<span class="cn-conversa-texto">${esc(nomeTopo)}</span>${direta ? '<span class="cn-conversa-detalhe">Mensagem direta</span>' : ''}</h3>
      <button class="chat-silenciar ${silenciado ? 'ativo' : ''}" onclick="alternarSilencioChat()" aria-pressed="${silenciado}" title="${silenciado ? 'Voltar a receber notificações deste projeto' : 'Parar as notificações deste projeto (o contador continua)'}">${sino}${silenciado ? 'Silenciado' : 'Silenciar'}</button>
    </div>`;
  let resto;
  if(!c){
    if(!chatCarregando.has(canal.id)) carregarChatCanal(canal);
    resto = `<div class="chat-lista" role="status"><div class="chat-vazio">Carregando as mensagens…</div></div>`;
  }else if(c.erro){
    resto = `<div class="chat-lista"><div class="chat-vazio"><strong>Não deu para carregar as mensagens.</strong>${esc(c.erro)}<button class="btn-secondary" style="margin-top:12px;" onclick="recarregarConversa('${CANAL_ID.test(canal.id) ? canal.id : ''}')">Tentar de novo</button></div></div>`;
  }else{
    resto = `
      <div class="chat-lista" id="chat-lista" role="log" aria-live="polite" aria-label="${esc(`Mensagens de ${rotulo}`)}" onscroll="rolagemChat(this)">${renderListaChat(p, c, canal)}</div>
      <form class="chat-escrever" onsubmit="event.preventDefault();enviarMensagemChat()">
        ${canal.virtual ? '' : botaoFotoChat('chat-input')}
        <textarea id="chat-input" class="input chat-input" rows="1" maxlength="${CHAT_LIMITE_TEXTO}" placeholder="${esc(direta ? `Mensagem para ${nomeTopo}…` : `Escreva em #${canal.nome}…`)}" aria-label="${esc(`Mensagem para ${rotulo}`)}" oninput="rascunhoChat(this)" onkeydown="teclaChat(event)" onpaste="colarImagemChat(event,'chat-input')">${esc(c.rascunho)}</textarea>
        <button type="submit" class="btn-primary chat-enviar" id="chat-enviar" aria-label="Enviar mensagem" title="Enviar (Enter)" ${c.rascunho.trim() ? '' : 'disabled'}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>`;
  }
  return `<div class="cn-conversa" data-canal="${canal.id}">${topo}${resto}</div>`;
}

function recarregarConversa(id){
  if(id) delete state.chatProjeto[id];
  render();
}

function renderProjectChat(p){
  if(chatSemTabela){
    return `<div class="glass proj-surface proj-vazio"><strong>O chat ainda não foi ativado.</strong>Falta rodar o supabase/chat_projeto.sql no Supabase.</div>`;
  }
  if(!canaisCarregados){
    if(canaisErro) return `<div class="glass proj-surface proj-vazio"><strong>Não deu para carregar os canais.</strong>${esc(canaisErro)}<button class="btn-secondary" style="margin-top:12px;" onclick="tentarCanaisDeNovo()">Tentar de novo</button></div>`;
    if(!canaisCarregando) carregarCanais().then(()=>{ if(state.view === 'project' && state.projectTasksView === 'chat'){ skipEntranceOnce = true; safeRerender(); } });
    return `<div class="glass proj-surface proj-vazio" role="status">Carregando os canais…</div>`;
  }
  const canal = canalAberto(p.id);
  // O canal que está na tela fica guardado: criar canais acima dele (o modelo
  // de equipe põe o #avisos no topo) não troca a conversa de ninguém.
  if(canal && !canal.virtual) guardarCanalAberto(p.id, canal.id);
  const lendo = !!lendoCanal[p.id] && !!canal;
  return `
    <section class="glass proj-surface proj-chat proj-canais ${lendo ? 'lendo' : ''}" aria-label="Canais do projeto">
      ${renderNavCanais(p, canal)}
      ${renderConversaCanal(p, canal)}
    </section>`;
}

// Depois de cada render: a lista volta para onde estava (no fim, por padrão)
// e o campo cresce com o texto.
function aposRenderChat(){
  const lista = document.getElementById('chat-lista');
  const canal = state.currentProjectId && canalAberto(state.currentProjectId);
  const c = canal && state.chatProjeto[canal.id];
  if(lista && c) lista.scrollTop = lista.scrollHeight - lista.clientHeight - c.doFim;
  const campo = document.getElementById('chat-input');
  if(campo) ajustarAlturaChat(campo);
  marcarChatLido();
}

// Mensagem nova não redesenha a tela: troca só a lista, para não mexer no
// campo em que a pessoa está digitando. Quem estava no fim continua no fim.
function atualizarListaChat(canalId, manterTopo){
  if(!canalNaTela(canalId)) return;
  const lista = document.getElementById('chat-lista');
  const p = state.projects.find(x=>x.id === state.currentProjectId);
  const c = state.chatProjeto[canalId];
  const canal = p && canalDoProjeto(p.id, canalId);
  if(!lista || !p || !c || !canal) return;
  const alturaAntes = lista.scrollHeight;
  const topoAntes = lista.scrollTop;
  lista.innerHTML = renderListaChat(p, c, canal);
  if(manterTopo) lista.scrollTop = topoAntes + (lista.scrollHeight - alturaAntes);
  else lista.scrollTop = lista.scrollHeight - lista.clientHeight - c.doFim;
}

function conversaAberta(){
  const canal = state.currentProjectId && canalAberto(state.currentProjectId);
  return canal ? {canal, c: state.chatProjeto[canal.id]} : {canal: null, c: null};
}

function rolagemChat(lista){
  const {c} = conversaAberta();
  if(!c) return;
  const doFim = lista.scrollHeight - lista.clientHeight - lista.scrollTop;
  // Perto do fim conta como no fim: mensagem nova continua aparecendo.
  c.doFim = doFim < 40 ? 0 : doFim;
}

function ajustarAlturaChat(campo){
  campo.style.height = 'auto';
  campo.style.height = Math.min(campo.scrollHeight, 180) + 'px';
}

function rascunhoChat(campo){
  const {c} = conversaAberta();
  if(c) c.rascunho = campo.value;
  ajustarAlturaChat(campo);
  const b = document.getElementById('chat-enviar');
  if(b) b.disabled = !campo.value.trim();
}

// Enter envia; Shift+Enter quebra a linha. Durante a composição de acentos
// (isComposing) o Enter é do teclado, não do chat.
function teclaChat(e){
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    enviarMensagemChat();
  }
}

let chatEnviando = false;
function enviarMensagemChat(){
  const {canal, c} = conversaAberta();
  return enviarNoCanal(state.currentProjectId, canal, c, 'chat-input', 'chat-enviar');
}

// Envia o que está no campo para um canal: o da página do projeto
// (chat-input) ou o do chat da chamada (ch-chat-input).
async function enviarNoCanal(pid, canal, c, idCampo, idBotao){
  const campo = document.getElementById(idCampo);
  if(!pid || !canal || !c || !campo || chatEnviando) return;
  const texto = campo.value.trim();
  if(!texto) return;
  if(texto.length > CHAT_LIMITE_TEXTO){ showToast(`A mensagem passa de ${CHAT_LIMITE_TEXTO.toLocaleString(LOCALE_APP)} caracteres.`, 'erro'); return; }
  chatEnviando = true;
  const botao = document.getElementById(idBotao);
  if(botao) botao.disabled = true;
  // O clique em Enviar é o gesto que o navegador pede para liberar a permissão.
  pedirPermissaoNotificacao();
  const linha = canal.virtual ? {project_id: pid, body: texto} : {project_id: pid, canal_id: canal.id, body: texto};
  const {data, error} = await sb.from('project_messages').insert(linha).select().single();
  chatEnviando = false;
  if(error){
    console.error(error);
    if(botao) botao.disabled = false;
    if(/chat_limite/.test(error.message || '')) showToast('Calma: muitas mensagens seguidas. Espere um minuto e envie de novo.', 'erro');
    else if(/canal_tipo|23503/.test(`${error.message || ''} ${error.code || ''}`)){ showToast('Este canal não existe mais. A lista foi atualizada.', 'erro'); agendarCanais(); }
    else showToast('A mensagem não foi enviada. Confira a conexão e tente de novo.', 'erro');
    return;
  }
  c.rascunho = '';
  c.doFim = 0;
  const atual = document.getElementById(idCampo);
  if(atual){ atual.value = ''; ajustarAlturaChat(atual); atual.focus(); }
  receberMensagemChat(mensagemChatLinha(data));
  marcarChatLido();
  marcarLidoNaChamada();
}

// A mensagem pode estar na conversa da página ou na do chat da chamada:
// procura nas conversas carregadas.
async function apagarMensagemChat(id){
  const achada = Object.entries(state.chatProjeto).find(([, conv])=>conv && conv.lista.some(x=>x.id === id));
  const canal = achada ? {id: achada[0]} : null;
  const c = achada ? achada[1] : null;
  const m = c && c.lista.find(x=>x.id === id);
  if(!m) return;
  const minha = m.authorId === session.user.id;
  if(!await confirmar(minha ? 'Ela vira "mensagem apagada" para todo mundo do projeto. Não tem como desfazer.' : 'Como dono do projeto, você apaga a mensagem para todo mundo. Ela vira "mensagem apagada" e não tem como desfazer.', {title: 'Apagar mensagem?', okLabel: 'Apagar mensagem'})) return;
  const {data, error} = await sb.from('project_messages').update(m.imagem ? {body: '', imagem: null, apagada_em: new Date().toISOString()} : {body: '', apagada_em: new Date().toISOString()}).eq('id', id).select().maybeSingle();
  if(error || !data){
    if(error) console.error(error);
    showToast('Não deu para apagar a mensagem. Tente de novo em instantes.', 'erro');
    return;
  }
  // O arquivo só sai do bucket por quem enviou (SEC-090).
  if(m.imagem && minha) sb.storage.from('chat').remove([m.imagem]).then(({error: e})=>{ if(e) console.warn('foto apagada:', e.message); });
  if(m.imagem) urlsFotoChat.delete(m.imagem);
  const i = c.lista.findIndex(x=>x.id === id);
  if(i >= 0) c.lista[i] = mensagemChatLinha(data);
  atualizarListaChat(canal.id, true);
  atualizarChatDaChamada(canal.id, true);
}

/* --- criar, editar e apagar canais (dono e editores) --- */
// O diálogo segue o do "Novo projeto": título, uma linha dizendo o que é, os
// campos e o erro no próprio diálogo, sem perder o que foi digitado.

const TEXTOS_CANAL = {
  texto: {criar: 'Novo canal de texto', editar: 'Editar canal', texto: 'Todo mundo do projeto lê e escreve aqui.', rotulo: 'Nome do canal', placeholder: 'Ex: geral, drive, avisos', ok: 'Criar canal', apagar: 'Apagar canal'},
  voz: {criar: 'Nova sala de voz', editar: 'Editar sala', texto: 'Uma chamada com voz, câmera e tela. Quem está nela aparece embaixo do nome.', rotulo: 'Nome da sala', placeholder: 'Ex: Sala 1, Em reunião', ok: 'Criar sala', apagar: 'Apagar sala'},
  categoria: {criar: 'Nova categoria', editar: 'Editar categoria', texto: 'Agrupa canais e salas na lista, e dá para recolher.', rotulo: 'Nome da categoria', placeholder: 'Ex: Reuniões', ok: 'Criar categoria', apagar: 'Apagar categoria'}
};
let canalRapido = null;

function fecharMenuNovoAberto(){
  const b = document.querySelector('.novo-menu-btn[aria-expanded="true"]');
  if(b) alternarMenuNovo(b, true);
}

function novoCanal(tipo, categoriaId){
  fecharMenuNovoAberto();
  abrirCanalRapido({modo: 'criar', tipo, categoriaId: categoriaId || null});
}

function editarCanal(id){
  const canal = state.currentProjectId && canalDoProjeto(state.currentProjectId, id);
  if(!canal) return;
  abrirCanalRapido({modo: 'editar', tipo: canal.tipo, id: canal.id, categoriaId: canal.categoriaId});
}

function entrarNaSala(pid, salaId){
  abrirPreviaChamada(pid, salaId);
}

// Os outros do mesmo grupo: as categorias entre si, ou os canais e salas da
// mesma categoria (ou sem categoria).
function irmaosNoGrupo(pid, ehCategoria, categoriaId, semId){
  const e = estruturaCanais(pid);
  const lista = ehCategoria ? e.categorias.map(g=>g.cat)
    : categoriaId ? ((e.categorias.find(g=>g.cat.id === categoriaId) || {canais: []}).canais) : e.soltos;
  return lista.filter(c=>c.id !== semId);
}

function abrirCanalRapido(o){
  const pid = state.currentProjectId;
  const p = pid && state.projects.find(x=>x.id === pid);
  if(!p || !podeMexerNoCanal(pid, o.tipo)) return;
  canalRapido = {...o, pid, enviando: false};
  const canal = o.modo === 'editar' ? canalDoProjeto(pid, o.id) : null;
  const caixa = document.getElementById('canal-rapido');
  caixa.dataset.modo = o.modo;
  document.querySelectorAll('#canal-rapido input[name="canal-tipo"]').forEach(r=>{ r.checked = r.value === o.tipo; r.disabled = !podeMexerNoCanal(pid, r.value); r.closest('label')?.classList.toggle('desligado', r.disabled); });
  // O tipo só se escolhe ao criar canal ou sala; categoria e edição não trocam.
  document.getElementById('canal-rapido-tipos').hidden = !(o.modo === 'criar' && o.tipo !== 'categoria');
  document.getElementById('canal-rapido-apagar').hidden = o.modo !== 'editar';
  const campo = document.getElementById('canal-rapido-campo');
  campo.value = canal ? canal.nome : '';
  campo.maxLength = CANAL_LIMITE_NOME;
  const cats = canaisDoProjeto(pid).filter(c=>c.tipo === 'categoria');
  const sel = document.getElementById('canal-rapido-categoria');
  sel.innerHTML = `<option value="">Sem categoria (no topo)</option>${cats.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('')}`;
  sel.value = o.categoriaId && cats.some(c=>c.id === o.categoriaId) ? o.categoriaId : '';
  // Microfone ao entrar (sala) e privado (canal ou sala), RFC 0005.
  document.getElementById('canal-rapido-mic').value = canal ? canal.regraMic : 'livre';
  document.getElementById('canal-rapido-privado').checked = !!(canal && canal.privado);
  canalRapido.membros = new Set();
  canalRapido.membrosAntes = new Set();
  canalRapido.membrosCarregados = !(canal && canal.privado);
  if(canal && canal.privado) carregarMembrosDoCanal(canal);
  textosCanalRapido();
  opcoesPosicaoCanal(true);
  micCanalRapido();
  privadoCanalRapido();
  erroCanalRapido('');
  atualizarOkCanalRapido();
  caixa.classList.add('open');
  const focar = (resta)=>{
    if(canalRapido === null) return;
    campo.focus();
    if(document.activeElement !== campo && resta > 0) setTimeout(()=>focar(resta - 1), 40);
  };
  setTimeout(()=>focar(10), 30);
}

function textosCanalRapido(){
  const r = canalRapido;
  if(!r) return;
  const t = TEXTOS_CANAL[r.tipo];
  document.getElementById('canal-rapido-titulo').textContent = r.modo === 'editar' ? t.editar : t.criar;
  document.getElementById('canal-rapido-texto').textContent = t.texto;
  document.getElementById('canal-rapido-rotulo').textContent = t.rotulo;
  document.getElementById('canal-rapido-campo').placeholder = t.placeholder;
  document.getElementById('canal-rapido-apagar').textContent = t.apagar;
  document.getElementById('canal-rapido-prefixo').innerHTML = r.tipo === 'texto' ? ICONE_CANAL_TEXTO : r.tipo === 'voz' ? ICONE_SALA : '';
  document.getElementById('canal-rapido').dataset.tipo = r.tipo;
  document.getElementById('canal-rapido-grupo-categoria').hidden = r.tipo === 'categoria';
  document.getElementById('canal-rapido-grupo-mic').hidden = r.tipo !== 'voz';
  document.getElementById('canal-rapido-grupo-privado').hidden = r.tipo === 'categoria';
  document.getElementById('canal-rapido-privado-titulo').textContent = r.tipo === 'voz' ? 'Sala privada' : 'Canal privado';
  document.getElementById('canal-rapido-ok').textContent = r.enviando ? (r.modo === 'editar' ? 'Salvando…' : 'Criando…') : (r.modo === 'editar' ? 'Salvar' : t.ok);
}

function tipoCanalRapido(tipo){
  if(!canalRapido || canalRapido.modo !== 'criar' || !['texto', 'voz'].includes(tipo)) return;
  if(!podeMexerNoCanal(canalRapido.pid, tipo)) return;
  canalRapido.tipo = tipo;
  textosCanalRapido();
  opcoesPosicaoCanal(false);
  micCanalRapido();
}

function micCanalRapido(){
  const v = document.getElementById('canal-rapido-mic').value;
  document.getElementById('canal-rapido-mic-dica').textContent = (REGRAS_MIC[v] || REGRAS_MIC.livre).desc;
}

// A lista de quem vê o canal privado: o dono e quem criou sempre veem; quem
// salva entra marcado e travado, para não se trancar fora (a policy recusaria).
function privadoCanalRapido(){
  const r = canalRapido;
  if(!r) return;
  const ligado = document.getElementById('canal-rapido-privado').checked;
  const caixa = document.getElementById('canal-rapido-pessoas');
  caixa.hidden = !ligado;
  if(!ligado) return;
  const p = state.projects.find(x=>x.id === r.pid);
  const canal = r.modo === 'editar' ? canalDoProjeto(r.pid, r.id) : null;
  const eu = session.user.id;
  const criador = canal ? canal.criadoPor : eu;
  const lista = document.getElementById('canal-rapido-pessoas-lista');
  if(!r.membrosCarregados){ lista.innerHTML = '<p class="cr-dica">Carregando quem vê…</p>'; return; }
  const pessoas = projectPeople(p).sort((a, b)=>(CARGOS[cargoNoProjeto(p, b.id) || 'viewer'].nivel - CARGOS[cargoNoProjeto(p, a.id) || 'viewer'].nivel) || a.label.localeCompare(b.label, 'pt-BR'));
  lista.innerHTML = pessoas.map(pe=>{
    const sempre = pe.id === p.owner_id ? 'dono' : pe.id === criador ? 'criou' : pe.id === eu ? 'você' : '';
    const marcado = !!sempre || r.membros.has(pe.id);
    const perfil = pe.id === eu ? meuPerfilDeNome() : pe.profile;
    return `<label class="cr-pessoa ${sempre ? 'travada' : ''}">
      <input type="checkbox" value="${pe.id}" ${marcado ? 'checked' : ''} ${sempre ? 'disabled' : ''} onchange="marcarMembroCanal(this)">
      ${avatarChip(perfil, (pe.label || '?')[0])}
      <span class="cr-pessoa-nome">${nomePessoaHtml(perfil, pe.label)}</span>
      <span class="cr-pessoa-papel">${sempre ? (sempre === 'você' ? 'você' : sempre === 'dono' ? 'dono, sempre vê' : 'criou, sempre vê') : esc(nomeDoCargo(cargoNoProjeto(p, pe.id), p))}</span>
    </label>`;
  }).join('');
}

function marcarMembroCanal(input){
  const r = canalRapido;
  if(!r || !CHAMADA_UUID.test(input.value)) return;
  if(input.checked) r.membros.add(input.value); else r.membros.delete(input.value);
}

async function carregarMembrosDoCanal(canal){
  const r = canalRapido;
  const {data, error} = await sb.from('project_channel_membros').select('user_id').eq('canal_id', canal.id);
  if(canalRapido !== r) return;
  if(error) console.error(error);
  for(const x of data || []) if(CHAMADA_UUID.test(x.user_id || '')){ r.membros.add(x.user_id); r.membrosAntes.add(x.user_id); }
  r.membrosCarregados = true;
  privadoCanalRapido();
}

// Grava a lista do canal privado: quem salva entra junto (se não for o dono
// nem quem criou), para continuar vendo o canal.
async function salvarMembrosDoCanal(pid, canal, membros, antes){
  const p = state.projects.find(x=>x.id === pid);
  const eu = session.user.id;
  const quer = new Set([...membros].filter(uid=>uid !== p.owner_id && projectPeople(p).some(pe=>pe.id === uid)));
  if(eu !== p.owner_id && eu !== canal.criadoPor) quer.add(eu);
  const entrar = [...quer].filter(uid=>!antes.has(uid));
  const sair = [...antes].filter(uid=>!quer.has(uid) && uid !== eu);
  const res = await Promise.all([
    entrar.length ? sb.from('project_channel_membros').insert(entrar.map(uid=>({canal_id: canal.id, project_id: pid, user_id: uid}))) : Promise.resolve({}),
    sair.length ? sb.from('project_channel_membros').delete().eq('canal_id', canal.id).in('user_id', sair) : Promise.resolve({})
  ]);
  const falhou = res.find(x=>x.error);
  if(falhou){ console.error(falhou.error); return falhou.error; }
  membrosDosCanais[canal.id] = quer;
  return null;
}

// Quem perde a visão de um canal não recebe o UPDATE pelo realtime (o RLS o
// esconde): um aviso no tópico do projeto faz cada um recarregar a lista. Um
// aviso falso só causa uma recarga.
function avisarMudancaCanais(pid){
  const reg = canaisChamada[pid];
  if(reg && reg.assinado) reg.canal.send({type: 'broadcast', event: 'canais', payload: {}}).catch(()=>{});
}

// "Lugar na lista": no topo do grupo ou depois de cada um dos outros. Ao
// abrir, o canal fica onde está; canal novo, ou que muda de categoria, vai
// para o fim.
function opcoesPosicaoCanal(inicial){
  const r = canalRapido;
  if(!r) return;
  const sel = document.getElementById('canal-rapido-posicao');
  const categoriaId = r.tipo === 'categoria' ? null : (document.getElementById('canal-rapido-categoria').value || null);
  const irmaos = irmaosNoGrupo(r.pid, r.tipo === 'categoria', categoriaId, r.id);
  const rotulo = c=>c.tipo === 'texto' ? `#${c.nome}` : c.nome;
  sel.innerHTML = `<option value="0">No topo</option>${irmaos.map((c, i)=>`<option value="${i + 1}">Depois de ${esc(rotulo(c))}</option>`).join('')}`;
  let lugar = irmaos.length;
  if(inicial && r.modo === 'editar'){
    const atual = irmaosNoGrupo(r.pid, r.tipo === 'categoria', categoriaId, null).findIndex(c=>c.id === r.id);
    if(atual >= 0) lugar = atual;
  }
  sel.value = String(lugar);
}

function categoriaCanalRapido(){
  opcoesPosicaoCanal(false);
}

function fecharCanalRapido(){
  document.getElementById('canal-rapido').classList.remove('open');
  canalRapido = null;
}

function erroCanalRapido(msg){
  const el = document.getElementById('canal-rapido-erro');
  el.textContent = msg;
  el.hidden = !msg;
  document.getElementById('canal-rapido-campo').setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function atualizarOkCanalRapido(){
  const ok = document.getElementById('canal-rapido-ok');
  ok.disabled = !canalRapido || canalRapido.enviando || !document.getElementById('canal-rapido-campo').value.trim();
}

function digitarCanalRapido(){
  erroCanalRapido('');
  atualizarOkCanalRapido();
}

function mensagemErroCanal(error){
  const t = `${error.message || ''} ${error.code || ''}`;
  if(faltaColuna(error) || /project_channel_membros|42P01|PGRST205/.test(t)) return 'Privado e microfone da sala precisam do supabase/salas_projeto.sql. Rode ele no Supabase.';
  if(/canal_membro_fora/.test(t)) return 'Alguém marcado não está mais no projeto. Confira a lista.';
  if(/canal_limite/.test(t)) return 'O projeto já tem 100 canais e categorias. Apague algum para criar outro.';
  if(/canal_categoria/.test(t)) return 'Essa categoria não existe mais. Escolha outra.';
  if(/row-level security|42501/.test(t)) return 'Só o dono e quem edita o projeto mexem nos canais.';
  if(/check/.test(t)) return 'O nome precisa ter de 1 a 60 caracteres.';
  return 'Não deu para salvar. Confira a conexão e tente de novo.';
}

// Põe o canal no lugar escolhido e renumera o grupo (0, 1, 2…). Só grava o
// que mudou de posição.
async function reordenarGrupo(pid, canal, categoriaId, lugar){
  const grupo = irmaosNoGrupo(pid, canal.tipo === 'categoria', categoriaId, canal.id);
  grupo.splice(Math.max(0, Math.min(lugar, grupo.length)), 0, canal);
  const mudar = grupo.map((c, i)=>({c, i})).filter(x=>x.c.posicao !== x.i);
  if(!mudar.length) return true;
  mudar.forEach(x=>{ x.c.posicao = x.i; });
  const res = await Promise.all(mudar.map(x=>sb.from('project_channels').update({posicao: x.i}).eq('id', x.c.id)));
  const falhou = res.find(x=>x.error);
  if(falhou){ console.error(falhou.error); return false; }
  return true;
}

/* --- arrastar na lista de canais (RFC 0005) --- */
// Segurar ~0,4 s e arrastar, como os projetos na barra lateral. Dono e
// editores mudam a ordem de canais, salas e categorias, inclusive levando um
// canal para outra categoria; quem pode mover outros arrasta uma pessoa até
// outra sala. Antes de segurar, mexer mais que alguns pixels cancela, e a
// lista rola normalmente. Alt + seta faz o mesmo pelo teclado.
let arrastoCanais = null;
let ignorarCliqueCanais = false;

function iniciarArrastoCanais(e){
  if(e.button > 0 || arrastoCanais || !e.target.closest) return;
  if(e.target.closest('.cn-acao, .novo-menu-lista, .cn-topo')) return;
  const pessoa = e.target.closest('.cn-pessoa[data-movel]');
  const linha = !pessoa && e.target.closest('.cn-linha[data-movel]');
  const cab = !pessoa && !linha && e.target.closest('.cn-cat-cab[data-movel]');
  const el = pessoa || linha || cab;
  if(!el || !state.currentProjectId) return;
  // Numa linha de sala, segurar em cima de uma pessoa não arrasta a sala.
  if(linha && e.target.closest('.cn-sala-gente')) return;
  const a = arrastoCanais = {
    tipo: pessoa ? 'pessoa' : linha ? 'canal' : 'categoria', el, pid: state.currentProjectId,
    pointerId: e.pointerId, x: e.clientX, y: e.clientY, ativo: false, timer: null, alvo: null
  };
  // No modo de organizar o arrasto começa no primeiro movimento, sem segurar.
  a.organizando = organizandoCanais && a.tipo !== 'pessoa';
  if(!a.organizando) a.timer = setTimeout(()=>levantarNaListaCanais(a), SEGURAR_PROJETO_MS);
  document.addEventListener('pointermove', moverArrastoCanais);
  document.addEventListener('pointerup', soltarArrastoCanais);
  document.addEventListener('pointercancel', soltarArrastoCanais);
}

function levantarNaListaCanais(a){
  if(arrastoCanais !== a) return;
  const nav = document.getElementById('cn-lista');
  const itens = nav && nav.querySelector('.cn-itens');
  if(!itens || !a.el.isConnected){ cancelarArrastoCanais(); return; }
  fecharMenuNovoAberto();
  a.ativo = true;
  a.itens = itens;
  // No computador quem rola é a lista; no celular, a página.
  a.rolador = elementoQueRola(itens);
  a.rolagem0 = a.rolador.scrollTop;
  a.el.classList.add('arrastando');
  nav.classList.add('reordenando', `arrastando-${a.tipo}`);
  a.marca = document.createElement('div');
  a.marca.className = 'cn-solta-aqui';
  a.marca.hidden = true;
  itens.appendChild(a.marca);
  try{ a.el.setPointerCapture(a.pointerId); }catch(err){}
  if(navigator.vibrate) navigator.vibrate(12);
  anunciarNoApp(a.tipo === 'pessoa' ? 'Arraste até a sala de destino e solte.' : 'Arraste até o lugar novo e solte.');
}

function moverArrastoCanais(e){
  const a = arrastoCanais;
  if(!a || e.pointerId !== a.pointerId) return;
  const dx = e.clientX - a.x, dy = e.clientY - a.y;
  if(!a.ativo){
    if(a.organizando && Math.hypot(dx, dy) > 4){ levantarNaListaCanais(a); if(!a.ativo) return; }
    else{ if(Math.hypot(dx, dy) > 6) cancelarArrastoCanais(); return; }
  }
  const rolou = a.rolador.scrollTop - a.rolagem0;
  a.el.style.transform = `translate(${a.tipo === 'pessoa' ? dx : 0}px, ${dy + rolou}px)`;
  a.alvo = alvoNaListaCanais(a, e.clientY);
  desenharAlvoCanais(a);
  // Perto da borda, a lista (ou a página) rola sozinha.
  const ehPagina = a.rolador === document.scrollingElement;
  const r = ehPagina ? {top: 0, bottom: window.innerHeight} : a.rolador.getBoundingClientRect();
  const topo = Math.max(r.top, 0), fundo = Math.min(r.bottom, window.innerHeight);
  // A faixa de baixo da página desconta a barra do celular; dentro da lista,
  // que é baixa no celular, a faixa é estreita e só rola para onde o dedo vai.
  const borda = ehPagina ? 72 : 28;
  if(e.clientY < topo + (ehPagina ? 40 : 28) && dy < 0) a.rolador.scrollTop -= 10;
  else if(e.clientY > fundo - borda && dy > 0) a.rolador.scrollTop += 10;
}

function elementoQueRola(el){
  for(let x = el; x && x !== document.body; x = x.parentElement){
    const o = getComputedStyle(x).overflowY;
    if((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight + 1) return x;
  }
  return document.scrollingElement || document.documentElement;
}

// O que está debaixo do dedo: a sala (para uma pessoa) ou o lugar na lista
// (para canal e categoria). O lugar é guardado como "antes ou depois de tal
// canal", e o índice sai dos dados, não da tela: numa categoria recolhida a
// tela mostra só parte dela.
function alvoNaListaCanais(a, y){
  const meio = (r)=>r.top + r.height / 2;
  const maisPerto = (lista)=>{
    let melhor = null, dist = Infinity;
    for(const x of lista){
      const d = y < x.r.top ? x.r.top - y : y > x.r.bottom ? y - x.r.bottom : 0;
      if(d < dist){ dist = d; melhor = x; }
    }
    return melhor;
  };
  if(a.tipo === 'pessoa'){
    const salaDe = a.el.dataset.sala;
    const salas = [...a.itens.querySelectorAll('.cn-linha[data-sala]')]
      .map(el=>({el, r: el.getBoundingClientRect()}))
      .filter(x=>y >= x.r.top && y <= x.r.bottom);
    const x = salas[0];
    if(!x || x.el.dataset.sala === salaDe) return null;
    // Sala privada em que a pessoa não pode entrar não acende como destino.
    if(!pessoaVeCanal(a.pid, canalDoProjeto(a.pid, x.el.dataset.sala), a.el.dataset.uid)) return null;
    return {sala: x.el.dataset.sala, el: x.el};
  }
  if(a.tipo === 'categoria'){
    const meu = a.el.closest('.cn-cat');
    const blocos = [...a.itens.querySelectorAll('.cn-cat[data-cat-id]')].filter(el=>el !== meu)
      .map(el=>({el, r: el.getBoundingClientRect()}));
    const x = maisPerto(blocos);
    if(!x) return null;
    const antes = y < meio(x.r);
    return {vizinho: x.el.dataset.catId, antes, linhaY: antes ? x.r.top : x.r.bottom};
  }
  const linhas = [...a.itens.querySelectorAll('.cn-linha[data-id]:not(.cn-dm)')].filter(el=>el !== a.el)
    .map(el=>{ const b = el.querySelector('.cn-canal'); return {el, tipo: 'linha', r: (b || el).getBoundingClientRect(), fim: el.getBoundingClientRect().bottom}; });
  const cabs = [...a.itens.querySelectorAll('.cn-cat-cab[data-cat-id]')]
    .map(el=>({el, tipo: 'cab', r: el.getBoundingClientRect()}));
  const x = maisPerto([...linhas, ...cabs]);
  if(!x) return null;
  if(x.tipo === 'cab') return {categoriaId: x.el.dataset.catId, vizinho: null, antes: true, linhaY: x.r.bottom};
  const bloco = x.el.closest('.cn-cat[data-cat-id]');
  const antes = y < meio(x.r);
  return {categoriaId: bloco ? bloco.dataset.catId : null, vizinho: x.el.dataset.id, antes, linhaY: antes ? x.r.top : x.fim};
}

function desenharAlvoCanais(a){
  a.itens.querySelectorAll('.alvo-soltar').forEach(el=>el.classList.remove('alvo-soltar'));
  if(a.tipo === 'pessoa'){
    a.marca.hidden = true;
    if(a.alvo) a.alvo.el.classList.add('alvo-soltar');
    return;
  }
  if(!a.alvo){ a.marca.hidden = true; return; }
  const base = a.itens.getBoundingClientRect();
  a.marca.hidden = false;
  a.marca.style.top = `${a.alvo.linhaY - base.top + a.itens.scrollTop - 1}px`;
}

function cancelarArrastoCanais(){
  const a = arrastoCanais;
  if(!a) return;
  clearTimeout(a.timer);
  document.removeEventListener('pointermove', moverArrastoCanais);
  document.removeEventListener('pointerup', soltarArrastoCanais);
  document.removeEventListener('pointercancel', soltarArrastoCanais);
  arrastoCanais = null;
  if(a.ativo){
    const nav = document.getElementById('cn-lista');
    if(nav) nav.classList.remove('reordenando', `arrastando-${a.tipo}`);
    a.el.style.transform = '';
    a.el.classList.remove('arrastando');
    if(a.marca) a.marca.remove();
    if(a.itens) a.itens.querySelectorAll('.alvo-soltar').forEach(el=>el.classList.remove('alvo-soltar'));
  }
}

async function soltarArrastoCanais(e){
  const a = arrastoCanais;
  if(!a || (e && e.pointerId !== a.pointerId)) return;
  const ativo = a.ativo;
  const alvo = a.alvo;
  cancelarArrastoCanais();
  if(!ativo) return;
  // O clique que sai de soltar o dedo não abre o canal nem a sala.
  ignorarCliqueCanais = true;
  setTimeout(()=>{ ignorarCliqueCanais = false; }, 0);
  if(e && e.type === 'pointerup' && alvo) await aplicarArrastoCanais(a, alvo);
  atualizarListaCanais();
}

async function aplicarArrastoCanais(a, alvo){
  const pid = a.pid;
  if(a.tipo === 'pessoa'){
    const uid = a.el.dataset.uid;
    if(alvo.sala && CHAMADA_UUID.test(uid || '')) await moderarVoz(pid, uid, 'mover', alvo.sala);
    return;
  }
  if(a.tipo === 'categoria'){
    const cat = canalDoProjeto(pid, a.el.dataset.catId);
    if(!cat) return;
    const irmaos = irmaosNoGrupo(pid, true, null, cat.id);
    const i = irmaos.findIndex(c=>c.id === alvo.vizinho);
    if(i < 0) return;
    await moverCanalPara(pid, cat, null, alvo.antes ? i : i + 1);
    return;
  }
  const canal = canalDoProjeto(pid, a.el.dataset.id);
  if(!canal) return;
  let lugar = 0;
  if(alvo.vizinho){
    const irmaos = irmaosNoGrupo(pid, false, alvo.categoriaId, canal.id);
    const i = irmaos.findIndex(c=>c.id === alvo.vizinho);
    lugar = i < 0 ? irmaos.length : (alvo.antes ? i : i + 1);
  }
  await moverCanalPara(pid, canal, alvo.categoriaId, lugar);
}

// Muda a categoria (se mudou) e o lugar no grupo, e avisa os outros.
async function moverCanalPara(pid, canal, categoriaId, lugar){
  const ehCategoria = canal.tipo === 'categoria';
  const catNova = ehCategoria ? null : (categoriaId || null);
  const antes = {categoriaId: canal.categoriaId};
  if(!ehCategoria && catNova !== (canal.categoriaId || null)){
    const {data, error} = await sb.from('project_channels').update({categoria_id: catNova}).eq('id', canal.id).select('id').maybeSingle();
    if(error || !data){
      if(error) console.error(error);
      showToast(error ? mensagemErroCanal(error) : 'Só o dono e quem edita o projeto mexem nos canais.', 'erro');
      return false;
    }
    canal.categoriaId = catNova;
    // Recolhida, a categoria de destino abre para mostrar onde o canal ficou.
    const fechadas = categoriasFechadas(pid);
    if(catNova && fechadas.has(catNova)){
      fechadas.delete(catNova);
      try{ localStorage.setItem(`canaisFechados:${pid}`, JSON.stringify([...fechadas])); }catch(e){}
    }
  }
  const ok = await reordenarGrupo(pid, canal, ehCategoria ? null : catNova, lugar);
  if(!ok){
    canal.categoriaId = antes.categoriaId;
    showToast('A ordem não foi gravada toda. Confira a lista.', 'erro');
  }
  avisarMudancaCanais(pid);
  aposMudarCanais();
  const grupo = irmaosNoGrupo(pid, ehCategoria, ehCategoria ? null : catNova, null);
  const onde = ehCategoria ? '' : ` em ${catNova ? (canalDoProjeto(pid, catNova) || {}).nome || 'categoria' : 'sem categoria'}`;
  anunciarNoApp(`${canal.tipo === 'texto' ? '#' : ''}${canal.nome}: posição ${grupo.findIndex(c=>c.id === canal.id) + 1} de ${grupo.length}${onde}`);
  return ok;
}

document.addEventListener('click', e=>{
  if(ignorarCliqueCanais && e.target.closest && e.target.closest('#cn-lista')){
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// No toque, depois de segurar, o dedo arrasta em vez de rolar a lista, e o
// menu de toque longo do navegador não abre.
document.addEventListener('touchmove', e=>{
  if(arrastoCanais && arrastoCanais.ativo && e.cancelable) e.preventDefault();
}, {passive: false});
document.addEventListener('contextmenu', e=>{
  if(arrastoCanais && e.target.closest && e.target.closest('#cn-lista')) e.preventDefault();
});

// Alt + seta: o canal (ou sala) sobe ou desce um lugar; no começo ou no fim do
// grupo, passa para o grupo vizinho. A categoria troca de lugar com a vizinha.
async function teclaCanais(e){
  if(!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const pid = state.currentProjectId;
  const sobe = e.key === 'ArrowUp';
  const botaoCanal = e.target.closest('.cn-linha[data-movel] > .cn-canal');
  const botaoCat = e.target.closest('.cn-cat-cab[data-movel] .cn-cat-nome');
  if(!pid || (!botaoCanal && !botaoCat)) return;
  e.preventDefault();
  if(botaoCat){
    const cat = canalDoProjeto(pid, botaoCat.closest('.cn-cat-cab').dataset.catId);
    if(!cat) return;
    const todas = irmaosNoGrupo(pid, true, null, null);
    const i = todas.findIndex(c=>c.id === cat.id);
    const j = i + (sobe ? -1 : 1);
    if(i < 0 || j < 0 || j >= todas.length) return;
    await moverCanalPara(pid, cat, null, j);
    focarNaListaCanais(`cat:${cat.id}`);
    return;
  }
  const canal = canalDoProjeto(pid, botaoCanal.closest('.cn-linha').dataset.id);
  if(!canal) return;
  const e2 = estruturaCanais(pid);
  const grupos = [{cat: null, canais: e2.soltos}, ...e2.categorias.map(g=>({cat: g.cat.id, canais: g.canais}))];
  const g = grupos.findIndex(x=>x.canais.some(c=>c.id === canal.id));
  if(g < 0) return;
  const i = grupos[g].canais.findIndex(c=>c.id === canal.id);
  let destino = g, lugar;
  if(sobe && i > 0) lugar = i - 1;
  else if(!sobe && i < grupos[g].canais.length - 1) lugar = i + 1;
  else if(sobe && g > 0){ destino = g - 1; lugar = grupos[destino].canais.length; }
  else if(!sobe && g < grupos.length - 1){ destino = g + 1; lugar = 0; }
  else return;
  await moverCanalPara(pid, canal, grupos[destino].cat, lugar);
  focarNaListaCanais(`canal:${canal.id}`);
}

function focarNaListaCanais(foco){
  atualizarListaCanais();
  const el = document.querySelector(`#cn-lista [data-foco="${foco}"]`);
  if(el) el.focus();
}

async function salvarCanalRapido(){
  const r = canalRapido;
  if(!r || r.enviando) return;
  const campo = document.getElementById('canal-rapido-campo');
  const nome = campo.value.trim().slice(0, CANAL_LIMITE_NOME);
  if(!nome) return;
  const categoriaId = r.tipo === 'categoria' ? null : (document.getElementById('canal-rapido-categoria').value || null);
  const lugar = Number(document.getElementById('canal-rapido-posicao').value) || 0;
  // Privado e microfone só vão ao banco quando saem do padrão ou mudam: sem o
  // salas_projeto.sql, o canal comum continua salvando como antes.
  const privado = r.tipo !== 'categoria' && document.getElementById('canal-rapido-privado').checked;
  const regraMic = r.tipo === 'voz' && REGRAS_MIC[document.getElementById('canal-rapido-mic').value] ? document.getElementById('canal-rapido-mic').value : 'livre';
  if(privado && !r.membrosCarregados) return;
  r.enviando = true;
  textosCanalRapido();
  atualizarOkCanalRapido();
  let ordemOk = true;
  let listaOk = true;
  let novo = null;
  try{
    if(r.modo === 'criar'){
      const linha = {project_id: r.pid, tipo: r.tipo, nome, categoria_id: categoriaId, posicao: 0};
      if(privado) linha.privado = true;
      if(regraMic !== 'livre') linha.regra_mic = regraMic;
      const {data, error} = await sb.from('project_channels').insert(linha).select().single();
      if(error){ console.error(error); erroCanalRapido(mensagemErroCanal(error)); campo.focus(); return; }
      novo = canalLinha(data);
      (canaisPorProjeto[r.pid] = canaisPorProjeto[r.pid] || []).push(novo);
      ordemOk = await reordenarGrupo(r.pid, novo, categoriaId, lugar);
      if(privado) listaOk = !await salvarMembrosDoCanal(r.pid, novo, r.membros, new Set());
    }else{
      const canal = canalDoProjeto(r.pid, r.id);
      if(!canal){ erroCanalRapido('Este canal não existe mais.'); return; }
      const mudou = {};
      if(nome !== canal.nome) mudou.nome = nome;
      if(r.tipo !== 'categoria' && categoriaId !== canal.categoriaId) mudou.categoria_id = categoriaId;
      if(r.tipo === 'voz' && regraMic !== canal.regraMic) mudou.regra_mic = regraMic;
      if(r.tipo !== 'categoria' && privado !== canal.privado) mudou.privado = privado;
      // A lista vai antes de o canal virar privado: a policy só deixa salvar o
      // canal privado se quem salva continuar vendo.
      if(privado){
        const erroLista = await salvarMembrosDoCanal(r.pid, canal, r.membros, r.membrosAntes);
        if(erroLista){ erroCanalRapido(mensagemErroCanal(erroLista)); return; }
      }
      if(Object.keys(mudou).length){
        const {data, error} = await sb.from('project_channels').update(mudou).eq('id', canal.id).select().maybeSingle();
        if(error || !data){
          if(error) console.error(error);
          erroCanalRapido(error ? mensagemErroCanal(error) : 'Só o dono e quem edita o projeto mexem nos canais.');
          campo.focus();
          return;
        }
        Object.assign(canal, canalLinha(data));
      }
      ordemOk = await reordenarGrupo(r.pid, canal, categoriaId, lugar);
    }
  }finally{
    if(canalRapido === r){ r.enviando = false; textosCanalRapido(); atualizarOkCanalRapido(); }
  }
  if(canalRapido !== r) return;
  const tipo = r.tipo;
  fecharCanalRapido();
  avisarMudancaCanais(r.pid);
  if(!ordemOk) showToast('Salvo, mas a ordem não foi gravada toda. Confira a lista.', 'erro');
  else if(!listaOk) showToast('Criado, mas a lista de quem vê não foi gravada. Edite o canal para conferir.', 'erro');
  else showToast(r.modo === 'criar' ? (tipo === 'categoria' ? 'Categoria criada' : tipo === 'voz' ? 'Sala criada' : 'Canal criado') : 'Salvo');
  if(novo && novo.tipo === 'texto'){ abrirCanal(novo.id); return; }
  aposMudarCanais();
}

async function apagarCanalRapido(){
  const r = canalRapido;
  if(!r || r.modo !== 'editar') return;
  const canal = canalDoProjeto(r.pid, r.id);
  if(!canal) return;
  fecharCanalRapido();
  const titulo = canal.tipo === 'categoria' ? `Apagar a categoria ${canal.nome}?` : canal.tipo === 'voz' ? `Apagar a sala ${canal.nome}?` : `Apagar #${canal.nome}?`;
  const texto = canal.tipo === 'categoria' ? 'Os canais e as salas dela continuam, sem categoria.'
    : canal.tipo === 'voz' ? 'Quem estiver nela continua na chamada até sair. Não tem como desfazer.'
    : 'As mensagens deste canal somem para todo mundo do projeto. Não tem como desfazer.';
  if(!await confirmar(texto, {title: titulo, okLabel: TEXTOS_CANAL[canal.tipo].apagar})){ editarCanal(canal.id); return; }
  const {data, error} = await sb.from('project_channels').delete().eq('id', canal.id).select('id');
  if(error || !data || !data.length){
    if(error) console.error(error);
    showToast(error ? 'Não deu para apagar. Confira a conexão e tente de novo.' : 'Só o dono e quem edita o projeto apagam canais.', 'erro');
    return;
  }
  const lista = canaisPorProjeto[r.pid] || [];
  canaisPorProjeto[r.pid] = lista.filter(c=>c.id !== canal.id);
  if(canal.tipo === 'categoria') canaisPorProjeto[r.pid].forEach(c=>{ if(c.categoriaId === canal.id) c.categoriaId = null; });
  delete state.chatProjeto[canal.id];
  avisarMudancaCanais(r.pid);
  showToast(canal.tipo === 'categoria' ? 'Categoria apagada' : canal.tipo === 'voz' ? 'Sala apagada' : 'Canal apagado');
  aposMudarCanais();
}

// A estrutura da captura do Discord que originou os canais (RFC 0004, 3.4),
// com nomes genéricos. null é o #geral ou a sala Geral que já existem, que
// entram no lugar com o histórico em vez de virar outro canal.
const MODELO_EQUIPE = [
  {nome: 'Administração', canais: [['texto', 'avisos']]},
  {nome: 'Comunicação Geral', canais: [['texto', null], ['texto', 'drive'], ['texto', 'músicas']]},
  {nome: 'Reuniões', canais: [['voz', null], ['voz', 'Em reunião'], ['voz', 'Sala 1'], ['voz', 'Sala 2'], ['voz', 'Sala 3'], ['voz', 'Sala 4'], ['voz', 'Sala 5'], ['voz', 'Silêncio']]},
  {nome: 'Intervalo', canais: [['texto', 'intervalo'], ['voz', 'Intervalo']]}
];

let modeloEmAndamento = false;
async function usarModeloEquipe(){
  fecharMenuNovoAberto();
  const pid = state.currentProjectId;
  const p = pid && state.projects.find(x=>x.id === pid);
  if(!p || !podeMexerNoCanal(pid, 'texto') || !podeMexerNoCanal(pid, 'voz') || modeloEmAndamento) return;
  if(canaisDoProjeto(pid).some(c=>c.tipo === 'categoria')) return;
  if(!await confirmar('Cria as categorias Administração, Comunicação Geral, Reuniões e Intervalo, com canais de texto e oito salas de voz. O #geral e a sala Geral entram nelas com o histórico. Dá para renomear e apagar tudo depois.', {title: 'Usar o modelo de equipe?', okLabel: 'Criar os canais', danger: false})) return;
  modeloEmAndamento = true;
  try{
    const textoAtual = canaisDeTexto(pid)[0];
    const salaAtual = salasDoProjeto(pid)[0];
    const {data: cats, error} = await sb.from('project_channels')
      .insert(MODELO_EQUIPE.map((g, i)=>({project_id: pid, tipo: 'categoria', nome: g.nome, posicao: i})))
      .select();
    if(error || !cats){
      console.error(error);
      showToast(error ? mensagemErroCanal(error) : 'Não deu para criar os canais. Tente de novo em instantes.', 'erro');
      return;
    }
    const idCategoria = (nome)=>{ const c = cats.find(x=>x.nome === nome); return c ? c.id : null; };
    const novos = [];
    const mover = [];
    MODELO_EQUIPE.forEach(g=>{
      g.canais.forEach(([tipo, nome], i)=>{
        const existente = nome === null ? (tipo === 'texto' ? textoAtual : salaAtual) : null;
        if(existente) mover.push({id: existente.id, categoria_id: idCategoria(g.nome), posicao: i});
        else novos.push({project_id: pid, tipo, nome: nome || (tipo === 'texto' ? 'geral' : 'Geral'), categoria_id: idCategoria(g.nome), posicao: i});
      });
    });
    // A sala Silêncio já nasce como sala de silêncio (RFC 0005). Sem o
    // salas_projeto.sql a coluna não existe, e ela nasce como as outras.
    const comSilencio = novos.map(n=>n.tipo === 'voz' && n.nome === 'Silêncio' ? {...n, regra_mic: 'silencio'} : n);
    let inseridos = await sb.from('project_channels').insert(comSilencio);
    if(inseridos.error && faltaColuna(inseridos.error)) inseridos = await sb.from('project_channels').insert(novos);
    const res = [inseridos, ...await Promise.all(
      mover.map(m=>sb.from('project_channels').update({categoria_id: m.categoria_id, posicao: m.posicao}).eq('id', m.id))
    )];
    await carregarCanais();
    const falhou = res.find(x=>x.error);
    if(falhou){
      console.error(falhou.error);
      showToast('O modelo ficou pela metade. Confira a lista e crie o que faltou.', 'erro');
    }else showToast('Canais criados');
    aposMudarCanais();
  }finally{
    modeloEmAndamento = false;
  }
}

/* ---------- chamada do projeto (RFC 0002, fase 2) ---------- */
// Voz, câmera e tela entre quem está no projeto, em malha P2P de até 4
// pessoas: cada participante mantém uma conexão com cada um dos outros. A
// combinação das conexões (oferta, resposta, candidatos ICE) passa pelo canal
// privado chamada:<project_id> do Realtime, que só o dono e os membros aceitos
// assinam (supabase/chamadas.sql, SEC-075). Quem está na chamada e o que cada
// um tem ligado vai na Presence do mesmo canal.
//
// Em cada par, só quem tem o menor user id oferece, com quatro transceptores
// fixos na ordem de CHAMADA_FAIXAS. Ligar e desligar câmera ou tela é
// replaceTrack, sem renegociar; a Presence diz o que está ligado.
//
// Salas de voz (RFC 0004): cada sala é uma chamada separada, todas no mesmo
// canal do Realtime do projeto. A Presence diz em que sala cada um está, e as
// conexões só se fazem entre quem está na mesma sala. A separação é do
// cliente, não controle de acesso: qualquer pessoa do projeto entra em
// qualquer sala.
//
// A janela fica presa ao <body>, fora do #main que o render() reescreve, para
// a chamada continuar enquanto a pessoa navega pelo app.

const CHAMADA_FAIXAS = ['voz', 'cam', 'tela', 'telaAudio'];
const CHAMADA_STUN = [{urls: 'stun:stun.cloudflare.com:3478'}];
const CHAMADA_RENOVA_TURN_MS = 45 * 60 * 1000;
const CHAMADA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Teto de envio por conexão conforme quantas pessoas estão do outro lado
// (Q27): na malha, quem transmite manda uma cópia para cada uma. Sem limite
// de pessoas (desde 2026-11-03), a câmera também diminui a resolução
// (camEscala divide largura e altura) a partir de 4 do outro lado, para a
// soma das cópias caber no envio de uma internet de casa; a tela mantém a
// resolução, para o texto continuar legível, e perde quadros.
const CHAMADA_TETOS = [
  null,
  {tela: 8000000, telaQuadros: 60, cam: 2500000, camEscala: 1, camQuadros: 30},
  {tela: 4500000, telaQuadros: 30, cam: 1500000, camEscala: 1, camQuadros: 30},
  {tela: 3000000, telaQuadros: 30, cam: 1000000, camEscala: 1, camQuadros: 30},
  // 4 e 5 do outro lado: câmera em ~480p.
  {tela: 2000000, telaQuadros: 24, cam: 600000, camEscala: 1.5, camQuadros: 24},
  // 6 a 8: ~360p.
  {tela: 1200000, telaQuadros: 15, cam: 350000, camEscala: 2, camQuadros: 20},
  // 9 ou mais: ~240p.
  {tela: 800000, telaQuadros: 10, cam: 200000, camEscala: 3, camQuadros: 15}
];

function tetoDaChamada(outros){
  if(outros <= 3) return CHAMADA_TETOS[Math.max(1, outros)];
  if(outros <= 5) return CHAMADA_TETOS[4];
  if(outros <= 8) return CHAMADA_TETOS[5];
  return CHAMADA_TETOS[6];
}
const CHAMADA_LIMIAR_FALA = 0.02;

let chamada = null;
let previaChamada = null;
const canaisChamada = {};
const chamadaVideos = {};
const falaMedidores = new Map();
let falaTimer = null;
// {win, auto, modoAntes, voltarExpandida} com a chamada na janela flutuante.
let janelaFlutuante = null;
let chamadaRelogio = null;
let dispositivosChamada = {mic: [], cam: [], saida: []};
// O que o último desenho da janela mostrou, para animar só o que é novo, e
// quando cada ladrilho novo começou a entrar (a animação dura CHAMADA_ENTRADA_MS).
let chamadaDesenho = {modo: null, chaves: new Set()};
const chamadaEntradas = new Map();
const CHAMADA_ENTRADA_MS = 380;

const ICONES_CHAMADA = {
  mic: '<path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  micOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V5a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/>',
  fone: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>',
  foneOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M3 18v-6a9 9 0 0114.4-7.2M20.4 8.6A9 9 0 0121 12v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>',
  cam: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  camOff: '<path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>',
  tela: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="9 10 12 7 15 10"/><line x1="12" y1="7" x2="12" y2="13"/>',
  ajustes: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  // Telefone inteiro; o risco (ch-risco) só se desenha com o mouse em cima.
  sair: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/><line class="ch-risco" pathLength="1" x1="23" y1="1" x2="1" y2="23"/>',
  ligar: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>',
  minimizar: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  expandir: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  telaCheia: '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>',
  volumeOff: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
  flutuar: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',
  seta: '<polyline points="6 9 12 15 18 9"/>',
  chat: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  fechar: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};

function iconeChamada(nome, tam){
  const t = tam || 20;
  return `<svg aria-hidden="true" focusable="false" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES_CHAMADA[nome]}</svg>`;
}

function chamadaSuportada(){
  return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function telaSuportada(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

function novaSessaoChamada(){
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, x=>x.toString(16).padStart(2, '0')).join('');
}

function projetoDaChamada(pid){
  return state.projects.find(x=>x.id === pid) || null;
}

// SEC-076: só dono e membros aceitos que este aparelho carregou. Quem sai do
// projeto some daqui no próximo loadProjects.
function permitidoNaChamada(pid, uid){
  const p = projetoDaChamada(pid);
  return !!p && projectPeople(p).some(pe=>pe.id === uid);
}

// Quem entrou no projeto depois que este aparelho carregou a lista de membros
// aparece no canal da chamada (que o Supabase só abre para membros) sem estar
// na lista daqui, e era ignorado até a próxima recarga. Agora isso puxa a
// lista de novo: no fim do loadProjects a presença é conferida outra vez.
// No máximo uma recarga a cada 8 s por projeto e 3 por pessoa, para alguém
// já removido que siga no canal não virar recarga sem fim.
const recargaMembrosChamada = {};
function membroNovoNaChamada(pid, uid){
  if(!CHAMADA_UUID.test(uid) || !projetoDaChamada(pid)) return;
  const r = recargaMembrosChamada[pid] || (recargaMembrosChamada[pid] = {ultima: 0, timer: null, vezes: {}});
  if((r.vezes[uid] || 0) >= 3 || r.timer) return;
  r.vezes[uid] = (r.vezes[uid] || 0) + 1;
  r.timer = setTimeout(async ()=>{
    r.ultima = Date.now();
    try{ await loadProjects(); safeRerender(); }catch(e){}
    r.timer = null;
    // Reconfere: se a pessoa ainda não estiver na lista, tenta de novo depois.
    if(projetoDaChamada(pid) && !permitidoNaChamada(pid, uid)) presencaDoProjeto(pid);
  }, Math.max(0, r.ultima + 8000 - Date.now()));
}

function nomeNaChamada(pid, uid){
  if(uid === session.user.id) return getUserName() || 'Você';
  const p = projetoDaChamada(pid);
  const pessoa = p && projectPeople(p).find(pe=>pe.id === uid);
  return pessoa ? pessoa.label : 'Ex-membro';
}

function perfilNaChamada(pid, uid){
  if(uid === session.user.id) return meuPerfilDeNome();
  const p = projetoDaChamada(pid);
  const pessoa = p && projectPeople(p).find(pe=>pe.id === uid);
  return pessoa ? pessoa.profile : null;
}

function listaDeNomes(nomes){
  if(nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

function formatarDuracaoChamada(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  const dois = (n)=>String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(seg)}` : `${m}:${dois(seg)}`;
}

/* --- canal do Realtime (sinalização e presença) --- */

// Salas privadas (RFC 0005): cada uma tem o próprio tópico,
// chamada:<projeto>:<sala>, que o banco só abre para quem a vê (SEC-088). As
// salas abertas continuam todas no tópico do projeto. canaisChamada guarda um
// registro por tópico, com a chave "<projeto>" ou "<projeto>:<sala>".
function salaPrivada(pid, sala){
  const s = canalDoProjeto(pid, sala);
  return !!(s && s.tipo === 'voz' && s.privado && CHAMADA_UUID.test(s.id));
}

function chaveTopico(pid, sala){
  return salaPrivada(pid, sala) ? `${pid}:${sala}` : pid;
}

function regDaChamada(c){
  return c ? canaisChamada[c.topico || c.pid] || null : null;
}

// Todos os registros de um projeto: o tópico dele e os das salas privadas.
function regsDoProjeto(pid){
  return Object.values(canaisChamada).filter(r=>r.pid === pid);
}

// Quem está em alguma sala do projeto, juntando os tópicos.
function emChamadaDoProjeto(pid){
  return regsDoProjeto(pid).flatMap(r=>r.emChamada);
}

function canalChamada(chave){
  if(canaisChamada[chave]) return canaisChamada[chave];
  const [pid, salaFixa] = chave.split(':');
  const reg = {chave, pid, salaFixa: salaFixa || null, assinado: false, erro: false, emChamada: []};
  reg.pronto = new Promise(ok=>{ reg.resolver = ok; });
  reg.canal = sb.channel(`chamada:${chave}`, {config: {private: true, presence: {key: session.user.id}, broadcast: {self: false}}})
    .on('presence', {event: 'sync'}, ()=>presencaChamada(chave))
    .on('broadcast', {event: 'sinal'}, (msg)=>receberSinalChamada(chave, msg && msg.payload))
    .on('broadcast', {event: 'canais'}, ()=>{ if(!salaFixa) agendarCanais(); })
    .subscribe((status)=>{
      if(status === 'SUBSCRIBED'){
        reg.assinado = true;
        reg.erro = false;
        reg.resolver(true);
        presencaChamada(chave);
        // Voltando de uma queda de conexão: a Presence some do servidor e
        // precisa ser marcada de novo.
        if(chamada && regDaChamada(chamada) === reg && chamada.presente) atualizarPresencaChamada();
      }else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
        if(!reg.assinado){ reg.erro = true; reg.resolver(false); }
      }else if(status === 'CLOSED'){
        reg.assinado = false;
      }
    });
  canaisChamada[chave] = reg;
  return reg;
}

// Fica assinado o canal do projeto aberto (para a faixa "Chamada em
// andamento" e para quem está em cada sala), o da prévia e o da chamada em que
// a pessoa está. Cada um leva junto os tópicos das salas privadas que a
// pessoa vê no projeto.
function sincronizarCanaisChamada(){
  if(!session || !chamadaSuportada()) return;
  const quer = new Set();
  const projeto = (pid)=>{
    if(!projetoDaChamada(pid)) return;
    quer.add(pid);
    for(const s of salasDoProjeto(pid)) if(salaPrivada(pid, s.id)) quer.add(`${pid}:${s.id}`);
  };
  if(state.view === 'project' && state.currentProjectId) projeto(state.currentProjectId);
  if(previaChamada){ projeto(previaChamada.pid); quer.add(chaveTopico(previaChamada.pid, previaChamada.sala)); }
  if(chamada){ projeto(chamada.pid); if(chamada.topico) quer.add(chamada.topico); }
  for(const chave of quer) canalChamada(chave);
  for(const chave of Object.keys(canaisChamada)){
    if(quer.has(chave)) continue;
    try{ sb.removeChannel(canaisChamada[chave].canal); }catch(e){}
    delete canaisChamada[chave];
  }
}

// Presence de todos os tópicos de um projeto (quem entrou no projeto agora
// pode estar em qualquer um).
function presencaDoProjeto(pid){
  for(const r of regsDoProjeto(pid)) presencaChamada(r.chave);
}

function presencaChamada(chave){
  const reg = canaisChamada[chave];
  if(!reg) return;
  const pid = reg.pid;
  const estado = reg.canal.presenceState();
  const lista = [];
  for(const [uid, metas] of Object.entries(estado || {})){
    if(!CHAMADA_UUID.test(uid)) continue;
    if(!permitidoNaChamada(pid, uid)){ membroNovoNaChamada(pid, uid); continue; }
    const ativas = (metas || []).filter(m=>m && m.em_chamada && typeof m.sessao === 'string');
    if(!ativas.length) continue;
    const m = ativas.reduce((a, b)=>(Number(b.desde) || 0) > (Number(a.desde) || 0) ? b : a);
    lista.push({
      uid, sessao: m.sessao.slice(0, 64), desde: Number(m.desde) || Date.now(),
      // No tópico de uma sala privada, a sala é a dele, diga a pessoa o que
      // disser.
      sala: reg.salaFixa || salaDaPresenca(pid, m.sala), topico: chave,
      mic: m.mic !== false, ensurdecido: !!m.ensurdecido, camera: !!m.camera, tela: !!m.tela, telaSom: !!(m.tela && m.telaSom)
    });
  }
  // Ordem de chegada, com desempate pelo id: todos precisam ver a mesma ordem
  // para concordar sobre quem é o primeiro e sobre quem fica de fora com 5.
  lista.sort((a, b)=>(a.desde - b.desde) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  reg.emChamada = lista;
  atualizarFaixaChamada();
  if(state.currentProjectId === pid) atualizarListaCanais();
  if(previaChamada && previaChamada.pid === pid) desenharQuemEstaNaPrevia();
  if(chamada && regDaChamada(chamada) === reg) reconciliarChamada();
  // A lista de salas aberta na chamada mostra quem está em cada uma.
  if(chamada && chamada.pid === pid && chamada.painelSalas) desenharChamada();
}

// A sala que a pessoa diz estar. Quem não diz (a versão anterior do app, ou
// sem os canais no banco) está na primeira sala do projeto.
function salaDaPresenca(pid, sala){
  if(typeof sala === 'string' && CHAMADA_UUID.test(sala)) return sala;
  const primeira = salasDoProjeto(pid)[0];
  return primeira ? primeira.id : null;
}

function nomeDaSala(pid, sala){
  const s = canalDoProjeto(pid, sala);
  return s ? s.nome : 'Sala apagada';
}

// Quem está na mesma sala que eu, e os da sala de alguém.
function naSala(reg, sala){
  return reg ? reg.emChamada.filter(p=>p.sala === sala) : [];
}

// "Sala 1 · Truth" quando o projeto tem mais de uma sala; só "Truth" quando
// a sala é a única, como era antes.
function nomeDaChamada(pid, sala){
  const p = projetoDaChamada(pid);
  const nome = p ? p.name : 'Projeto';
  return salasDoProjeto(pid).length > 1 ? `${nomeDaSala(pid, sala)} · ${nome}` : nome;
}

function atualizarPresencaChamada(){
  const c = chamada;
  const reg = regDaChamada(c);
  if(!reg || !reg.assinado) return Promise.resolve();
  return reg.canal.track({
    sessao: c.sessao, em_chamada: true, desde: c.entrouEm, sala: CHAMADA_UUID.test(c.sala || '') ? c.sala : null,
    mic: c.mic && !!c.local.voz, ensurdecido: c.ensurdecido, camera: c.camera, tela: c.tela, telaSom: !!(c.tela && c.local.telaAudio)
  }).catch(e=>console.warn('chamada: presença', e));
}

function enviarSinalChamada(para, paraSessao, tipo, dados){
  const c = chamada;
  const reg = regDaChamada(c);
  if(!reg || !reg.assinado) return;
  reg.canal.send({type: 'broadcast', event: 'sinal', payload: {de: session.user.id, deSessao: c.sessao, para, paraSessao, tipo, dados}})
    .catch(e=>console.warn('chamada: sinal', e));
}

function sinalChamadaValido(s){
  if(!s || typeof s !== 'object') return false;
  if(typeof s.de !== 'string' || !CHAMADA_UUID.test(s.de)) return false;
  if(typeof s.deSessao !== 'string' || !s.deSessao || s.deSessao.length > 64) return false;
  if(s.tipo === 'oferta' || s.tipo === 'resposta'){
    const d = s.dados;
    return !!d && d.type === (s.tipo === 'oferta' ? 'offer' : 'answer') && typeof d.sdp === 'string' && d.sdp.length < 200000;
  }
  if(s.tipo === 'ice') return !!s.dados && typeof s.dados.candidate === 'string' && s.dados.candidate.length < 2000;
  return s.tipo === 'pedir';
}

function impressaoDtls(sdp){
  const m = /a=fingerprint:\S+ (\S+)/.exec(sdp || '');
  return m ? m[1] : '';
}

function ufragDe(sdp){
  const m = /a=ice-ufrag:(\S+)/.exec(sdp || '');
  return m ? m[1] : '';
}

function candidatoIce(d){
  return {candidate: d.candidate, sdpMid: typeof d.sdpMid === 'string' ? d.sdpMid : null,
    sdpMLineIndex: Number.isInteger(d.sdpMLineIndex) ? d.sdpMLineIndex : null,
    usernameFragment: typeof d.usernameFragment === 'string' ? d.usernameFragment : undefined};
}

function receberSinalChamada(chave, s){
  const c = chamada;
  const reg = canaisChamada[chave];
  // Só vale o sinal que chega pelo tópico da sala em que estou.
  if(!c || !reg || regDaChamada(c) !== reg || !sinalChamadaValido(s)) return;
  const pid = c.pid;
  if(s.para !== session.user.id || s.paraSessao !== c.sessao || s.de === session.user.id) return;
  // SEC-076: sinal de quem não é (mais) do projeto é ignorado.
  if(!permitidoNaChamada(pid, s.de)){ membroNovoNaChamada(pid, s.de); return; }
  // Sinal de quem a Presence diz estar em outra sala também. Quem ainda não
  // apareceu na Presence passa: a oferta às vezes chega antes dela.
  const quem = reg.emChamada.find(x=>x.uid === s.de);
  if(quem && quem.sala !== c.sala) return;
  // SEC-087: a sessão que recebeu ordem de mover ou desconectar fica sozinha.
  if(quem && sessaoBarradaNaSala(pid, quem)) return;
  let par = c.pares.get(s.de);
  if(s.tipo === 'oferta'){
    if(par && par.sessao !== s.deSessao){ fecharParChamada(par); par = null; }
    if(par && par.ofertante) return;
    // Oferta de uma conexão nova do outro lado (ele recomeçou do zero: o
    // certificado DTLS muda). O Chrome aceita aplicar por cima da conexão
    // velha, mas nem todo navegador aceita: aqui também recomeça do zero.
    if(par && par.pc.remoteDescription && impressaoDtls(par.pc.remoteDescription.sdp) !== impressaoDtls(s.dados.sdp)){
      fecharParChamada(par);
      par = null;
    }
    if(!par) par = criarParChamada(s.de, s.deSessao, false);
    // Oferta nova (do zero ou reinício de ICE): a conferência da imagem recomeça.
    par.criadoEm = Date.now();
    par.imagem = {};
    const oferta = {type: 'offer', sdp: s.dados.sdp};
    enfileirarPar(par, ()=>aceitarOfertaChamada(par, oferta));
  }else if(s.tipo === 'resposta'){
    if(!par || par.sessao !== s.deSessao || !par.ofertante) return;
    enfileirarPar(par, async ()=>{
      if(par.pc.signalingState !== 'have-local-offer') return;
      await par.pc.setRemoteDescription({type: 'answer', sdp: s.dados.sdp});
      await descarregarCandidatos(par);
      ajustarQualidadePar(par);
    });
  }else if(s.tipo === 'ice'){
    const cand = candidatoIce(s.dados);
    if(!par || par.sessao !== s.deSessao){
      // O candidato chegou antes da oferta: guarda até o par existir.
      const k = `${s.de}:${s.deSessao}`;
      (c.iceAdiantado[k] = c.iceAdiantado[k] || []).push(cand);
      return;
    }
    // Candidato de outra negociação (conexão nova ou reinício de ICE do outro
    // lado) que chegou antes da oferta dela: guarda até a oferta chegar.
    const rd = par.pc.remoteDescription;
    if(!par.ofertante && rd && cand.usernameFragment && ufragDe(rd.sdp) && cand.usernameFragment !== ufragDe(rd.sdp)){
      const k = `${s.de}:${s.deSessao}`;
      (c.iceAdiantado[k] = c.iceAdiantado[k] || []).push(cand);
      return;
    }
    enfileirarPar(par, async ()=>{
      if(par.pc.remoteDescription) await par.pc.addIceCandidate(cand).catch(()=>{});
      else par.pendentes.push(cand);
    });
  }else if(s.tipo === 'pedir'){
    // Quem não oferece pediu uma oferta nova: a primeira se perdeu ou a
    // conexão caiu. Só quem tem o id menor oferece.
    if(!(session.user.id < s.de)) return;
    const p = reg && reg.emChamada.find(x=>x.uid === s.de && x.sessao === s.deSessao && x.sala === c.sala);
    if(!p) return;
    // Uma conexão recém-recomeçada (pela vigia ou por outro pedido) ainda
    // está negociando: recomeçar de novo agora só atrasaria.
    if(par && par.sessao === s.deSessao && Date.now() - par.criadoEm < 5000 && par.pc.connectionState !== 'failed') return;
    if(par) fecharParChamada(par);
    criarParChamada(s.de, s.deSessao, true);
  }
}

/* --- conexões --- */

function enfileirarPar(par, fn){
  par.fila = par.fila.then(fn).catch(e=>console.warn('chamada: negociação', e));
  return par.fila;
}

function criarParChamada(uid, sessao, ofertante){
  const c = chamada;
  const pc = new RTCPeerConnection({iceServers: c.iceServers, bundlePolicy: 'max-bundle'});
  const par = {uid, sessao, pc, ofertante, transceptores: {}, remotas: {}, pendentes: [], fila: Promise.resolve(), audio: {}, reforcos: {}, timer: null, pedidos: 0, criadoEm: Date.now()};
  c.pares.set(uid, par);
  const adiantados = c.iceAdiantado[`${uid}:${sessao}`];
  if(adiantados){ par.pendentes.push(...adiantados); delete c.iceAdiantado[`${uid}:${sessao}`]; }
  pc.onicecandidate = (e)=>{ if(e.candidate) enviarSinalChamada(uid, sessao, 'ice', e.candidate.toJSON()); };
  pc.ontrack = (e)=>receberFaixaChamada(par, e);
  pc.onconnectionstatechange = ()=>estadoConexaoChamada(par);
  if(ofertante){
    for(const tipo of CHAMADA_FAIXAS){
      par.transceptores[tipo] = pc.addTransceiver(tipo === 'voz' || tipo === 'telaAudio' ? 'audio' : 'video', {direction: 'sendrecv'});
    }
    preferirCodecsDeVideo(par);
    aplicarFaixasLocaisNoPar(par);
    enfileirarPar(par, ()=>enviarOfertaChamada(par, false));
  }
  return par;
}

// H.264 primeiro na câmera e na tela. Na malha, cada um codifica o próprio
// vídeo uma vez para cada pessoa; o VP8, que o navegador usa por padrão, roda
// no processador, e com 4 pessoas e uma tela transmitida o computador não dava
// conta: as câmeras chegavam aos trancos (uns 8 quadros por segundo). O H.264
// é codificado e decodificado no hardware no Mac, no iPhone e na maioria dos
// PCs. Cada lado manda no codec que o outro lista primeiro, então os dois
// listam o H.264 na frente; quem não tem H.264 (o Firefox sem o OpenH264, por
// exemplo) segue no VP8, que continua na lista.
function preferirCodecsDeVideo(par){
  if(!window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
  const caps = RTCRtpReceiver.getCapabilities('video');
  if(!caps || !caps.codecs) return;
  const h264 = caps.codecs.filter(c=>/^video\/h264$/i.test(c.mimeType) && /packetization-mode=1/.test(c.sdpFmtpLine || ''));
  if(!h264.length) return;
  // Constrained Baseline (42e0) na frente: é o perfil que todo codificador
  // de hardware aceita.
  h264.sort((a, b)=>Number(/profile-level-id=42e0/i.test(b.sdpFmtpLine)) - Number(/profile-level-id=42e0/i.test(a.sdpFmtpLine)));
  const ordem = [...h264, ...caps.codecs.filter(c=>!h264.includes(c))];
  for(const tipo of ['cam', 'tela']){
    const t = par.transceptores[tipo];
    if(t && t.setCodecPreferences){ try{ t.setCodecPreferences(ordem); }catch(e){} }
  }
}

async function enviarOfertaChamada(par, reiniciarIce){
  if(!chamada || chamada.pares.get(par.uid) !== par) return;
  const oferta = await par.pc.createOffer(reiniciarIce ? {iceRestart: true} : undefined);
  await par.pc.setLocalDescription(oferta);
  enviarSinalChamada(par.uid, par.sessao, 'oferta', {type: oferta.type, sdp: oferta.sdp});
}

async function aceitarOfertaChamada(par, oferta){
  if(!chamada || chamada.pares.get(par.uid) !== par) return;
  const pc = par.pc;
  const primeira = !pc.remoteDescription;
  await pc.setRemoteDescription(oferta);
  if(primeira){
    // Os transceptores nascem da oferta, na ordem dela: voz, câmera, tela e
    // áudio da tela.
    pc.getTransceivers().forEach((t, i)=>{
      const tipo = CHAMADA_FAIXAS[i];
      if(!tipo) return;
      par.transceptores[tipo] = t;
      t.direction = 'sendrecv';
    });
    preferirCodecsDeVideo(par);
  }
  // Toda oferta, não só a primeira, recoloca as faixas de agora: numa
  // renegociação a câmera religada ficava de fora e quem recebia via preto.
  aplicarFaixasLocaisNoPar(par);
  // Candidatos que chegaram antes desta oferta (reinício de ICE do outro lado).
  const k = `${par.uid}:${par.sessao}`;
  if(chamada.iceAdiantado[k]){ par.pendentes.push(...chamada.iceAdiantado[k]); delete chamada.iceAdiantado[k]; }
  const resposta = await pc.createAnswer();
  await pc.setLocalDescription(resposta);
  enviarSinalChamada(par.uid, par.sessao, 'resposta', {type: resposta.type, sdp: resposta.sdp});
  await descarregarCandidatos(par);
  ajustarQualidadePar(par);
}

async function descarregarCandidatos(par){
  const lista = par.pendentes.splice(0);
  for(const cand of lista) await par.pc.addIceCandidate(cand).catch(()=>{});
}

function aplicarFaixasLocaisNoPar(par){
  const c = chamada;
  for(const tipo of CHAMADA_FAIXAS){
    const t = par.transceptores[tipo];
    if(t && t.sender) t.sender.replaceTrack(c.local[tipo] || null).catch(()=>{});
  }
}

function tipoDaFaixaRemota(par, transceptor){
  const i = par.pc.getTransceivers().indexOf(transceptor);
  return CHAMADA_FAIXAS[i] || null;
}

function receberFaixaChamada(par, e){
  const tipo = tipoDaFaixaRemota(par, e.transceiver);
  if(!tipo) return;
  par.remotas[tipo] = e.track;
  if(tipo === 'voz' || tipo === 'telaAudio') tocarAudioRemoto(par, tipo, e.track);
  if(tipo === 'voz') medirFala(par.uid, e.track);
  // O vídeo começa a chegar depois que o outro lado liga a câmera ou a tela.
  e.track.onunmute = ()=>desenharChamada();
  desenharChamada();
}

function caixaAudioChamada(){
  let el = document.getElementById('chamada-audios');
  if(!el){
    el = document.createElement('div');
    el.id = 'chamada-audios';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function tocarAudioRemoto(par, tipo, track){
  let el = par.audio[tipo];
  if(!el){
    el = document.createElement('audio');
    el.autoplay = true;
    caixaAudioChamada().appendChild(el);
    par.audio[tipo] = el;
  }
  el.srcObject = new MediaStream([track]);
  aplicarVolumePar(par);
  if(chamada.dispositivos.saida && el.setSinkId) el.setSinkId(chamada.dispositivos.saida).catch(()=>{});
  el.play().catch(()=>{});
}

// Volume que cada um escolhe para os outros, só neste aparelho. A chave é o
// id da pessoa (voz) ou `<id>:tela` (som da transmissão), e o valor vai de 0
// a 2 (200%), com "silenciado para mim" à parte, para o volume voltar igual.
// Guardado antes como número solto; os dois formatos são lidos.
function volumesChamada(){
  try{ const v = JSON.parse(localStorage.getItem('chamadaVolumes') || '{}'); return v && typeof v === 'object' ? v : {}; }catch(e){ return {}; }
}

function chaveVolumeValida(chave){
  const [uid, extra, ...resto] = String(chave).split(':');
  return CHAMADA_UUID.test(uid) && !resto.length && (extra === undefined || extra === 'tela');
}

function ajusteDeVolume(chave){
  const bruto = volumesChamada()[chave];
  const v = Number(bruto && typeof bruto === 'object' ? bruto.v : bruto);
  return {v: Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1, mudo: !!(bruto && bruto.mudo)};
}

function guardarAjusteDeVolume(chave, ajuste){
  const todos = volumesChamada();
  todos[chave] = {v: ajuste.v, mudo: ajuste.mudo};
  try{ localStorage.setItem('chamadaVolumes', JSON.stringify(todos)); }catch(e){}
}

// Acima de 100% o som passa por um GainNode, porque o <audio> não vai além
// de 1. Com alto-falante escolhido, só se o AudioContext também souber
// mandar para ele; senão o teto fica em 100%.
function volumeAcimaDe100(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return false;
  return !(chamada && chamada.dispositivos.saida) || 'setSinkId' in Ctx.prototype;
}

function volumeMaximoChamada(){
  return volumeAcimaDe100() ? 200 : 100;
}

let chamadaAudioCtx = null;
function contextoReforcoChamada(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  if(!chamadaAudioCtx || chamadaAudioCtx.state === 'closed'){
    chamadaAudioCtx = new Ctx();
    const saida = chamada && chamada.dispositivos.saida;
    if(saida && chamadaAudioCtx.setSinkId) chamadaAudioCtx.setSinkId(saida).catch(()=>{});
  }
  if(chamadaAudioCtx.state === 'suspended') chamadaAudioCtx.resume().catch(()=>{});
  return chamadaAudioCtx;
}

// O <audio> continua tocando, mudo: o Chromium só entrega o áudio remoto do
// WebRTC ao Web Audio enquanto a faixa está presa a um elemento.
function reforcoDoAudio(par, tipo, el){
  const track = el.srcObject && el.srcObject.getAudioTracks()[0];
  const atual = par.reforcos[tipo];
  if(atual && atual.track === track) return atual;
  desligarReforco(par, tipo);
  const ctx = track && contextoReforcoChamada();
  if(!ctx) return null;
  try{
    const fonte = ctx.createMediaStreamSource(new MediaStream([track]));
    const ganho = ctx.createGain();
    fonte.connect(ganho).connect(ctx.destination);
    par.reforcos[tipo] = {track, fonte, ganho};
    return par.reforcos[tipo];
  }catch(e){ return null; }
}

function desligarReforco(par, tipo){
  const r = par.reforcos[tipo];
  if(!r) return;
  try{ r.fonte.disconnect(); r.ganho.disconnect(); }catch(e){}
  delete par.reforcos[tipo];
}

function desligarReforcosPar(par){
  for(const tipo of Object.keys(par.reforcos || {})) desligarReforco(par, tipo);
}

function aplicarVolumePar(par){
  const c = chamada;
  if(!par.reforcos) par.reforcos = {};
  for(const [tipo, el] of Object.entries(par.audio)){
    const a = ajusteDeVolume(tipo === 'telaAudio' ? `${par.uid}:tela` : par.uid);
    // SEC-087: a voz de quem foi silenciado, ou está numa sala de silêncio
    // sem poder falar, não toca aqui, mesmo que o app dele mande.
    const semVoz = tipo === 'voz' && !!c && !podeFalarNaSala(c.pid, c.sala, par.uid);
    const calado = !!(c && c.ensurdecido) || a.mudo || semVoz;
    const r = a.v > 1 && volumeAcimaDe100() ? reforcoDoAudio(par, tipo, el) : null;
    if(r){
      el.volume = 1;
      el.muted = true;
      r.ganho.gain.setTargetAtTime(calado ? 0 : a.v, r.ganho.context.currentTime, 0.015);
    }else{
      desligarReforco(par, tipo);
      el.volume = Math.min(1, a.v);
      el.muted = calado;
    }
  }
}

function estadoConexaoChamada(par){
  const c = chamada;
  if(!c || c.pares.get(par.uid) !== par) return;
  const st = par.pc.connectionState;
  if(st === 'connected'){
    clearTimeout(par.timer);
    par.pedidos = 0;
    ajustarQualidadePar(par);
  }else if(st === 'failed' || st === 'disconnected'){
    // Queda de rede: quem oferece reinicia o ICE; quem não oferece pede.
    clearTimeout(par.timer);
    par.timer = setTimeout(()=>{
      if(!chamada || chamada.pares.get(par.uid) !== par) return;
      if(!['failed', 'disconnected'].includes(par.pc.connectionState)) return;
      if(par.ofertante) enfileirarPar(par, ()=>enviarOfertaChamada(par, true));
      else enviarSinalChamada(par.uid, par.sessao, 'pedir', null);
    }, st === 'failed' ? 300 : 5000);
  }
  desenharChamada();
}

// Vigia das conexões, a cada 3 s. Antes, quem esperava a oferta pedia de novo
// só três vezes e desistia, e ninguém percebia uma negociação parada no meio
// (a resposta perdida deixava os dois lados "Conectando…" para sempre). Agora,
// enquanto a pessoa está na chamada e a conexão com ela não fecha, tenta de
// novo sem desistir, com intervalos de 8 s crescendo até 30 s: quem oferece
// recomeça do zero (conexão e oferta novas); quem espera pede uma oferta.
function vigiarConexoesChamada(){
  const c = chamada;
  if(!c) return;
  const agora = Date.now();
  const eu = session.user.id;
  for(const p of c.participantes.values()){
    const chave = `${p.uid}:${p.sessao}`;
    const v = c.vigias[chave] || (c.vigias[chave] = {desde: 0, tentativas: 0, proxima: 0});
    const par = c.pares.get(p.uid);
    const st = par && par.sessao === p.sessao ? par.pc.connectionState : 'sem-par';
    if(st === 'connected' && !imagemParadaChamada(p, par, agora)){
      v.desde = 0;
      v.tentativas = 0;
      conferirImagemChamada(p, par);
      continue;
    }
    // Conectada mas com a imagem parada: refaz já, sem esperar a carência
    // (depois, as tentativas seguintes respeitam os intervalos).
    if(st === 'connected' && !v.desde){ v.desde = agora - 8000; v.proxima = agora; }
    if(!v.desde){ v.desde = agora; v.proxima = agora + 8000; continue; }
    if(agora < v.proxima) continue;
    v.tentativas++;
    v.proxima = agora + Math.min(30000, 8000 + v.tentativas * 5000);
    if(eu < p.uid){
      if(par) fecharParChamada(par);
      criarParChamada(p.uid, p.sessao, true);
    }else enviarSinalChamada(p.uid, p.sessao, 'pedir', null);
    desenharChamada();
  }
  for(const chave of Object.keys(c.vigias)){
    const [uid, sessao] = chave.split(':');
    const p = c.participantes.get(uid);
    if(!p || p.sessao !== sessao) delete c.vigias[chave];
  }
}

// Imagem parada: a conexão está de pé e a pessoa diz que a câmera (ou a tela)
// está ligada, mas nenhum quadro novo foi decodificado em 9 s. Acontecia ao
// religar a câmera, com algumas câmeras, navegadores e redes: quem recebia via
// o ladrilho preto para sempre. A vigia refaz a conexão do zero, que chega com
// a faixa atual. Conta quadros pelas estatísticas do receptor, que não
// dependem de o vídeo estar na tela.
async function conferirImagemChamada(p, par){
  if(par.lendoImagem) return;
  const tipos = [p.camera && 'cam', p.tela && 'tela'].filter(Boolean);
  const imagem = par.imagem || (par.imagem = {});
  for(const tipo of Object.keys(imagem)) if(!tipos.includes(tipo)) delete imagem[tipo];
  if(!tipos.length) return;
  par.lendoImagem = true;
  try{
    for(const tipo of tipos){
      const t = par.transceptores[tipo];
      if(!t || !t.receiver) continue;
      let quadros = null;
      const stats = await t.receiver.getStats();
      stats.forEach(s=>{ if(s.type === 'inbound-rtp' && s.kind === 'video') quadros = s.framesDecoded || 0; });
      if(quadros === null) continue;
      // Qualquer mudança conta como quadro novo: numa renegociação a contagem
      // pode recomeçar do zero.
      const r = imagem[tipo];
      if(!r || quadros !== r.quadros) imagem[tipo] = {quadros, desde: Date.now()};
    }
  }catch(e){}
  par.lendoImagem = false;
}

function imagemParadaChamada(p, par, agora){
  if(!par || !par.imagem || agora - par.criadoEm < 12000) return false;
  return Object.entries(par.imagem).some(([tipo, r])=>(tipo === 'cam' ? p.camera : p.tela) && agora - r.desde > 9000);
}

function tentativasDeConexao(uid){
  const c = chamada;
  const p = c && c.participantes.get(uid);
  const v = p && c.vigias[`${uid}:${p.sessao}`];
  return v ? v.tentativas : 0;
}

function fecharParChamada(par){
  const c = chamada;
  clearTimeout(par.timer);
  try{ par.pc.close(); }catch(e){}
  desligarReforcosPar(par);
  for(const el of Object.values(par.audio)){ el.srcObject = null; el.remove(); }
  pararMedicaoFala(par.uid);
  for(const tipo of ['cam', 'tela']) delete chamadaVideos[`${par.uid}:${tipo}`];
  if(c && c.pares.get(par.uid) === par) c.pares.delete(par.uid);
}

// Liga e desliga conexões conforme a Presence: entra quem chegou, sai quem
// saiu ou perdeu o acesso. Sem limite de pessoas desde 2026-11-03 (antes, só
// as 4 primeiras ficavam, Q19); a qualidade se ajusta pelo tetoDaChamada.
function reconciliarChamada(){
  const c = chamada;
  const reg = regDaChamada(c);
  if(!c || !reg || !c.presente) return;
  const eu = session.user.id;
  // Só quem está na mesma sala: quem vai para outra sala sai das conexões
  // como quem sai da chamada. Quem recebeu ordem de mover ou desconectar e
  // ficou (app alterado) também sai, pela moderação (SEC-087).
  const dentro = naSala(reg, c.sala).filter(p=>p.uid === eu || !sessaoBarradaNaSala(c.pid, p));
  const estouNaPresenca = dentro.some(p=>p.uid === eu && p.sessao === c.sessao);
  c.inicio = Math.min(c.entrouEm, ...dentro.map(p=>p.desde));
  // "Chamada iniciada" sai de quem não viu ninguém ao entrar, mas só depois
  // de a Presence assentar (2,5 s): duas pessoas que iniciam juntas acabam
  // vendo a mesma lista, e só uma delas é a primeira. Decidir antes disso
  // fazia as duas se acharem sozinhas e gravarem a linha duas vezes.
  if(c.registrarInicio && estouNaPresenca && Date.now() - c.entrouEm >= 2400){
    c.registrarInicio = false;
    if(dentro[0] && dentro[0].uid === eu && dentro[0].sessao === c.sessao) registrarLinhaChamada(c.pid, c.sala, 'chamada_inicio', null);
  }
  const vistos = new Set();
  for(const p of dentro){
    if(p.uid === eu) continue;
    vistos.add(p.uid);
    const antes = c.participantes.get(p.uid);
    // Câmera ou tela desligada: o vídeo é jogado fora, e o da próxima vez nasce
    // escondido até o primeiro quadro (a foto aparece no lugar do preto).
    if(antes && antes.camera && !p.camera) delete chamadaVideos[`${p.uid}:cam`];
    if(antes && antes.tela && !p.tela) delete chamadaVideos[`${p.uid}:tela`];
    if(antes && antes.tela !== p.tela && p.tela && !c.destaque) c.destaque = `${p.uid}:tela`;
    if(!antes && p.tela && !c.destaque) c.destaque = `${p.uid}:tela`;
    c.participantes.set(p.uid, p);
    let par = c.pares.get(p.uid);
    if(par && par.sessao !== p.sessao){ fecharParChamada(par); par = null; }
    // Entrou sozinho num projeto que agora tem mais gente: pede o TURN.
    if(c.turnAdiado){ c.turnAdiado = false; renovarTurnChamada(c); }
    if(!antes || antes.sessao !== p.sessao){
      tocarSomChamada('entrar');
      anunciarNaChamada(`${nomeNaChamada(c.pid, p.uid)} entrou na chamada`);
    }
    // Quem espera a oferta não faz nada aqui: se ela não vier, a vigia pede.
    if(!par && eu < p.uid) criarParChamada(p.uid, p.sessao, true);
  }
  for(const uid of [...c.participantes.keys()]){
    if(vistos.has(uid)) continue;
    const par = c.pares.get(uid);
    if(par) fecharParChamada(par);
    c.participantes.delete(uid);
    tocarSomChamada('sair');
    anunciarNaChamada(`${nomeNaChamada(c.pid, uid)} saiu da chamada`);
  }
  for(const [uid, par] of [...c.pares]) if(!vistos.has(uid)) fecharParChamada(par);
  if(c.destaque && !chaveDaChamadaExiste(c.destaque)) c.destaque = null;
  ajustarQualidadeChamada();
  desenharChamada();
}

/* --- qualidade (Q27) --- */

async function definirEnvioChamada(transceptor, enc, preferencia){
  if(!transceptor || !transceptor.sender) return;
  const sender = transceptor.sender;
  const p = sender.getParameters();
  if(!p.encodings || !p.encodings.length) return;
  Object.assign(p.encodings[0], enc);
  if(preferencia) p.degradationPreference = preferencia;
  try{ await sender.setParameters(p); }
  catch(e){
    // Navegador sem degradationPreference: aplica só o teto.
    try{ delete p.degradationPreference; await sender.setParameters(p); }catch(e2){}
  }
}

// A tela vai com 'maintain-resolution': quando a banda ou o processador
// apertam, cai o número de quadros e o texto continua legível (Q27). A
// câmera ia assim também, e numa chamada de 4 com tela transmitida as caras
// chegavam aos trancos (uns 8 quadros por segundo, com congelamentos de até
// 0,7 s). Rosto pede movimento: a câmera vai com 'maintain-framerate', que
// mantém os quadros e baixa a resolução quando falta banda ou processador.
// Só que, com ela, a conexão nova começa em 320x180 e leva uns 15 s para
// chegar a 720p. Por isso os primeiros 12 s de cada conexão vão com
// 'maintain-resolution', que já sai em 720p, e depois troca.
const CHAMADA_ARRANQUE_MS = 12000;
function ajustarQualidadePar(par){
  const c = chamada;
  if(!c) return;
  const teto = tetoDaChamada(c.pares.size);
  const idade = Date.now() - (par.criadoEm || 0);
  const arrancando = idade < CHAMADA_ARRANQUE_MS;
  if(arrancando && !par.trocaDePreferencia){
    par.trocaDePreferencia = setTimeout(()=>{
      par.trocaDePreferencia = null;
      if(chamada && chamada.pares.get(par.uid) === par) ajustarQualidadePar(par);
    }, CHAMADA_ARRANQUE_MS - idade + 200);
  }
  definirEnvioChamada(par.transceptores.voz, {maxBitrate: 64000});
  definirEnvioChamada(par.transceptores.cam, {maxBitrate: teto.cam, maxFramerate: teto.camQuadros, scaleResolutionDownBy: teto.camEscala}, arrancando ? 'maintain-resolution' : 'maintain-framerate');
  // A qualidade escolhida para a tela é um teto a mais: 720p não precisa da
  // taxa do 1080p, e 30 quadros não mandam 60.
  const q = QUALIDADES_TELA[c.qualidadeTela] || QUALIDADES_TELA['1080'];
  definirEnvioChamada(par.transceptores.tela, {maxBitrate: Math.min(teto.tela, q.taxa), maxFramerate: Math.min(teto.telaQuadros, q.quadros)}, 'maintain-resolution');
  definirEnvioChamada(par.transceptores.telaAudio, {maxBitrate: 128000});
}

function ajustarQualidadeChamada(){
  if(!chamada) return;
  for(const par of chamada.pares.values()) ajustarQualidadePar(par);
}

/* --- quem está falando (Q28) --- */

function medirFala(chave, track){
  pararMedicaoFala(chave);
  const ctx = alarmContext();
  if(!ctx || !track) return;
  try{
    const fonte = ctx.createMediaStreamSource(new MediaStream([track]));
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    fonte.connect(analisador);
    falaMedidores.set(chave, {fonte, analisador, track, buffer: new Float32Array(analisador.fftSize), falando: false, ate: 0, nivel: 0});
  }catch(e){ return; }
  if(!falaTimer) ligarRelogioFala();
}

// Com a janela flutuante aberta, a página costuma estar escondida (outra aba
// ou outro programa na frente) e o navegador segura os timers dela em um por
// segundo; o anel de quem fala ficaria atrasado. Aí o relógio do medidor roda
// na janela flutuante, que está visível.
function ligarRelogioFala(){
  const dono = janelaFlutuante ? janelaFlutuante.win : window;
  falaTimer = {dono, id: dono.setInterval(lerFala, 100)};
}

function desligarRelogioFala(){
  if(!falaTimer) return;
  try{ falaTimer.dono.clearInterval(falaTimer.id); }catch(e){}
  falaTimer = null;
}

function trocarRelogioFala(){
  if(!falaTimer) return;
  desligarRelogioFala();
  if(falaMedidores.size) ligarRelogioFala();
}

function pararMedicaoFala(chave){
  const m = falaMedidores.get(chave);
  if(!m) return;
  try{ m.fonte.disconnect(); }catch(e){}
  falaMedidores.delete(chave);
  if(!falaMedidores.size && falaTimer) desligarRelogioFala();
}

function lerFala(){
  const agora = performance.now();
  for(const [chave, m] of falaMedidores){
    m.analisador.getFloatTimeDomainData(m.buffer);
    let soma = 0;
    for(let i = 0; i < m.buffer.length; i++) soma += m.buffer[i] * m.buffer[i];
    const rms = Math.sqrt(soma / m.buffer.length);
    m.nivel = rms;
    if(chave === 'previa'){
      const barra = document.getElementById('ch-previa-nivel');
      if(barra) barra.style.transform = `scaleX(${Math.min(1, rms * 12).toFixed(3)})`;
      continue;
    }
    // A própria voz com o microfone fechado não acende o anel.
    const valendo = m.track.enabled && m.track.readyState === 'live';
    if(chave === session.user.id) mostrarVozNoBotao(valendo ? rms : 0);
    if(valendo && rms > CHAMADA_LIMIAR_FALA) m.ate = agora + 350;
    const falando = agora < m.ate;
    if(falando !== m.falando){
      m.falando = falando;
      marcarFalaChamada(chave, falando);
    }
  }
}

// Microfone aberto: o botão do microfone ganha um anel verde que acompanha a
// própria voz, para a pessoa ver que está sendo ouvida sem precisar olhar o
// próprio ladrilho. Suavizado, e só escreve no estilo quando muda de verdade.
let vozNoBotao = 0;
function mostrarVozNoBotao(rms){
  const alvo = Math.min(1, rms * 16);
  const novo = alvo > vozNoBotao ? vozNoBotao * 0.4 + alvo * 0.6 : vozNoBotao * 0.75 + alvo * 0.25;
  if(Math.abs(novo - vozNoBotao) < 0.02 && !(alvo === 0 && vozNoBotao > 0 && novo < 0.02)) return;
  vozNoBotao = novo < 0.02 ? 0 : novo;
  for(const d of docsChamada()){
    d.querySelectorAll('#ch-btn-mic, #ch-btn-mic-mini').forEach(b=>b.style.setProperty('--ch-voz', vozNoBotao.toFixed(2)));
  }
}

function marcarFalaChamada(uid, falando){
  for(const d of docsChamada()) d.querySelectorAll(`[data-fala="${uid}"]`).forEach(el=>el.classList.toggle('falando', falando));
}

/* --- sons (Q31) --- */

// Sons da chamada, gerados na hora (sem arquivo). Entrar e sair são dois tons
// em seno. Microfone e fone são um toque só, curto, baixo e em seno, com a
// altura deslizando de leve: desce ao fechar e sobe ao abrir; o do fone é
// mais grave que o do microfone. Uma nota [de, para] desliza entre as duas.
// Só quem clicou ouve. Respeitam o "Som" das Configurações.
const SONS_CHAMADA = {
  entrar: {notas: [587.33, 880], onda: 'sine', passo: 0.11, dura: 0.2, volume: 0.12},
  sair: {notas: [659.25, 440], onda: 'sine', passo: 0.11, dura: 0.2, volume: 0.12},
  chamando: {notas: [659.25, 830.61, 987.77], onda: 'sine', passo: 0.11, dura: 0.2, volume: 0.12},
  mutar: {notas: [[620, 500]], onda: 'sine', passo: 0, dura: 0.09, volume: 0.07},
  desmutar: {notas: [[500, 620]], onda: 'sine', passo: 0, dura: 0.09, volume: 0.07},
  ensurdecer: {notas: [[440, 350]], onda: 'sine', passo: 0, dura: 0.12, volume: 0.07},
  ouvir: {notas: [[350, 440]], onda: 'sine', passo: 0, dura: 0.12, volume: 0.07}
};

function tocarSomChamada(tipo){
  if(state.soundEnabled === false) return;
  const som = SONS_CHAMADA[tipo] || SONS_CHAMADA.sair;
  try{
    const ctx = alarmContext();
    if(!ctx) return;
    som.notas.forEach((nota, i)=>{
      const [de, para] = Array.isArray(nota) ? nota : [nota, nota];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = som.onda;
      osc.frequency.value = de;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const ini = ctx.currentTime + i * som.passo;
      if(para !== de){
        osc.frequency.setValueAtTime(de, ini);
        osc.frequency.exponentialRampToValueAtTime(para, ini + som.dura * 0.7);
      }
      gain.gain.setValueAtTime(0, ini);
      gain.gain.linearRampToValueAtTime(som.volume, ini + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, ini + som.dura);
      osc.start(ini);
      osc.stop(ini + som.dura + 0.02);
    });
  }catch(e){}
}

function anunciarNaChamada(texto){
  const el = docChamada().getElementById('ch-anuncio');
  if(el) el.textContent = texto;
}

/* --- dispositivos (Q30) --- */

// Supressão de ruído do navegador, mais o isolamento de voz onde ele existe:
// ligada por padrão (já era, sem controle); quem toca um instrumento ou quer o
// som ambiente desliga. Fica guardada no aparelho.
function ruidoLigado(){
  try{ return localStorage.getItem('chamadaRuido') !== 'nao'; }catch(e){ return true; }
}

function guardarRuido(ligado){
  try{ localStorage.setItem('chamadaRuido', ligado ? 'sim' : 'nao'); }catch(e){}
}

function restricoesMicrofone(deviceId){
  const ruido = ruidoLigado();
  const audio = {deviceId: deviceId ? {exact: deviceId} : undefined, echoCancellation: true, noiseSuppression: ruido, autoGainControl: true};
  const aceitas = navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
  if(aceitas.voiceIsolation) audio.voiceIsolation = ruido;
  return {audio};
}

function restricoesCamera(deviceId){
  return {video: {deviceId: deviceId ? {exact: deviceId} : undefined, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30}}};
}

function mensagemErroMidia(e, oque){
  const n = e && e.name;
  if(n === 'NotAllowedError' || n === 'SecurityError') return `O navegador bloqueou ${oque}. Libere no cadeado ao lado do endereço do site e tente de novo.`;
  if(n === 'NotFoundError' || n === 'OverconstrainedError') return `Nenhum ${oque === 'o microfone' ? 'microfone' : 'câmera'} encontrado neste aparelho.`;
  if(n === 'NotReadableError') return `Outro programa está usando ${oque}. Feche ele e tente de novo.`;
  return `Não deu para ligar ${oque}.`;
}

async function carregarDispositivosChamada(){
  try{
    const lista = await navigator.mediaDevices.enumerateDevices();
    const rotulo = (d, i, base)=>d.label || `${base} ${i + 1}`;
    const doTipo = (kind, base)=>lista.filter(d=>d.kind === kind && d.deviceId).map((d, i)=>({deviceId: d.deviceId, label: rotulo(d, i, base)}));
    dispositivosChamada = {
      mic: doTipo('audioinput', 'Microfone'),
      cam: doTipo('videoinput', 'Câmera'),
      saida: 'setSinkId' in HTMLMediaElement.prototype ? doTipo('audiooutput', 'Alto-falante') : []
    };
  }catch(e){ dispositivosChamada = {mic: [], cam: [], saida: []}; }
}

function seletoresDispositivo(atual, acao){
  const campo = (tipo, rotulo)=>{
    const lista = dispositivosChamada[tipo];
    if(!lista.length) return '';
    const sel = atual[tipo] || '';
    return `<label class="ch-disp"><span>${rotulo}</span>
      <select class="select" onchange="${acao}('${tipo}', this.value)">
        ${sel ? '' : '<option value="" selected>Padrão do sistema</option>'}
        ${lista.map(d=>`<option value="${esc(d.deviceId)}" ${d.deviceId === sel ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
      </select></label>`;
  };
  const ruido = `<label class="ch-disp-ruido">
      <span class="ch-disp-ruido-texto"><span>Supressão de ruído</span><small>Tira o barulho de fundo, como teclado e ventilador. Desligue para tocar música.</small></span>
      <input type="checkbox" role="switch" class="ch-interruptor" ${ruidoLigado() ? 'checked' : ''} onchange="${acao}('ruido', this.checked)">
    </label>`;
  return campo('mic', 'Microfone') + campo('cam', 'Câmera') + campo('saida', 'Saída de áudio') + ruido;
}

/* --- prévia (Q22) --- */

// Sem sala, entra na primeira do projeto.
async function abrirPreviaChamada(pid, salaPedida){
  if(!session || !chamadaSuportada()){
    showToast('Este navegador não faz chamadas. Use o Chrome, o Edge, o Firefox ou o Safari atualizados.', 'erro');
    return;
  }
  const p = projetoDaChamada(pid);
  if(!p) return;
  const sala = canalDoProjeto(pid, salaPedida) ? salaPedida : (salasDoProjeto(pid)[0] || {}).id;
  if(!sala || (canalDoProjeto(pid, sala) || {}).tipo !== 'voz'){
    showToast('Este projeto não tem sala de voz. Quem edita o projeto cria uma na aba Canais.');
    return;
  }
  // Dá para entrar sozinho, mesmo num projeto só seu: a sala fica esperando
  // quem chegar. O TURN espera alguém entrar (buscarTurnChamada).
  if(chamada){
    if(chamada.pid === pid){
      // Outra sala do mesmo projeto: troca direto, como no Discord.
      if(chamada.sala === sala) chamadaExpandir();
      else trocarDeSalaChamada(sala);
      return;
    }
    if(!await confirmar('Você sai da chamada em que está para entrar nesta.', {title: 'Trocar de chamada?', okLabel: 'Trocar de chamada', danger: false})) return;
    await sairDaChamada();
  }
  fecharAvisoChamada();
  if(previaChamada) fecharPreviaChamada();
  // A regra da sala decide o microfone da prévia: "entra mudo" e "silêncio"
  // começam fechados.
  const micLivre = regraMicDaSala(pid, sala) === 'livre' && !micTravadoNaSala(pid, sala);
  previaChamada = {pid, sala, mic: micLivre, camera: false, voz: null, cam: null, erro: '', entrando: false, dispositivos: {mic: '', cam: '', saida: ''}};
  sincronizarCanaisChamada();
  // textContent: o nome da sala e do projeto entram como texto puro.
  const varias = salasDoProjeto(pid).length >= 2;
  document.getElementById('chamada-previa-titulo').textContent = varias ? `Entrar em ${nomeDaSala(pid, sala)} · ${p.name}` : `Entrar na chamada · ${p.name}`;
  desenharPreviaChamada();
  document.getElementById('chamada-previa').classList.add('open');
  // O clique em "Iniciar chamada" ou "Entrar" é o gesto que libera o pedido
  // do microfone (SEC-078). A câmera só quando a pessoa ligar.
  pedirPermissaoNotificacao();
  await previaLigarMicrofone();
  await carregarDispositivosChamada();
  desenharPreviaChamada();
}

async function previaLigarMicrofone(){
  const pr = previaChamada;
  if(!pr) return;
  try{
    const s = await navigator.mediaDevices.getUserMedia(restricoesMicrofone(pr.dispositivos.mic));
    if(previaChamada !== pr){ s.getTracks().forEach(t=>t.stop()); return; }
    if(pr.voz) pr.voz.stop();
    pr.voz = s.getAudioTracks()[0];
    pr.voz.enabled = pr.mic;
    pr.dispositivos.mic = pr.voz.getSettings().deviceId || pr.dispositivos.mic;
    pr.erro = '';
    medirFala('previa', pr.voz);
  }catch(e){
    if(previaChamada !== pr) return;
    pr.mic = false;
    pr.erro = mensagemErroMidia(e, 'o microfone') + ' Dá para entrar só ouvindo.';
  }
}

function previaAlternarMic(){
  const pr = previaChamada;
  if(!pr) return;
  if(!pr.mic && micTravadoNaSala(pr.pid, pr.sala)){
    showToast(silenciadoPeloModerador(pr.pid, session.user.id) ? 'Um moderador silenciou você neste projeto.' : 'Sala de silêncio: aqui ninguém abre o microfone.');
    return;
  }
  if(!pr.voz){ pr.mic = true; previaLigarMicrofone().then(desenharPreviaChamada); return; }
  pr.mic = !pr.mic;
  pr.voz.enabled = pr.mic;
  desenharPreviaChamada();
}

async function previaAlternarCamera(){
  const pr = previaChamada;
  if(!pr) return;
  if(pr.camera){
    pr.camera = false;
    if(pr.cam){ pr.cam.stop(); pr.cam = null; }
    desenharPreviaChamada();
    return;
  }
  try{
    const s = await navigator.mediaDevices.getUserMedia(restricoesCamera(pr.dispositivos.cam));
    if(previaChamada !== pr){ s.getTracks().forEach(t=>t.stop()); return; }
    pr.cam = s.getVideoTracks()[0];
    pr.camera = true;
    pr.dispositivos.cam = pr.cam.getSettings().deviceId || pr.dispositivos.cam;
    pr.erro = '';
    await carregarDispositivosChamada();
  }catch(e){
    pr.erro = mensagemErroMidia(e, 'a câmera');
  }
  desenharPreviaChamada();
}

async function previaTrocarDispositivo(tipo, id){
  const pr = previaChamada;
  if(!pr || !['mic', 'cam', 'saida', 'ruido'].includes(tipo)) return;
  if(tipo === 'ruido'){
    guardarRuido(!!id);
    // Fecha antes de abrir de novo: com o microfone ainda aberto, o navegador
    // reaproveita o processamento de áudio dele e ignora a escolha nova.
    if(pr.voz){ pr.voz.stop(); await previaLigarMicrofone(); }
    desenharPreviaChamada();
    return;
  }
  pr.dispositivos[tipo] = id;
  if(tipo === 'mic' && pr.voz) await previaLigarMicrofone();
  if(tipo === 'cam' && pr.camera){
    if(pr.cam){ pr.cam.stop(); pr.cam = null; }
    pr.camera = false;
    await previaAlternarCamera();
    return;
  }
  desenharPreviaChamada();
}

function desenharPreviaChamada(){
  const pr = previaChamada;
  const corpo = document.getElementById('chamada-previa-corpo');
  if(!pr || !corpo) return;
  const nome = getUserName() || 'Você';
  const comVideo = pr.camera && pr.cam;
  corpo.innerHTML = `
    <div class="ch-previa">
      <div class="ch-previa-video ${comVideo ? 'com-video' : ''}">
        <div class="ch-previa-slot"></div>
        ${comVideo ? '' : `<div class="ch-ladrilho-avatar">${avatarChip({avatar_url: state.myAvatarUrl}, nome[0])}</div>`}
        <div class="ch-previa-nome">${esc(nome)}</div>
      </div>
      <div class="ch-previa-controles">
        <button type="button" id="ch-previa-mic" class="ch-botao ${pr.mic && pr.voz ? '' : 'desligado'}" onclick="previaAlternarMic()" aria-pressed="${!(pr.mic && pr.voz)}" aria-label="${pr.mic && pr.voz ? 'Fechar o microfone' : 'Abrir o microfone'}" title="${pr.mic && pr.voz ? 'Fechar o microfone' : 'Abrir o microfone'}">${iconeChamada(pr.mic && pr.voz ? 'mic' : 'micOff')}</button>
        <button type="button" id="ch-previa-cam" class="ch-botao ${comVideo ? '' : 'desligado'}" onclick="previaAlternarCamera()" aria-pressed="${!comVideo}" aria-label="${comVideo ? 'Desligar a câmera' : 'Ligar a câmera'}" title="${comVideo ? 'Desligar a câmera' : 'Ligar a câmera'}">${iconeChamada(comVideo ? 'cam' : 'camOff')}</button>
        <div class="ch-previa-nivel" aria-hidden="true" title="Volume do microfone"><span id="ch-previa-nivel"></span></div>
      </div>
      ${pr.erro ? `<p class="ch-previa-erro" role="alert">${esc(pr.erro)}</p>` : ''}
      <div class="ch-previa-disps">${seletoresDispositivo(pr.dispositivos, 'previaTrocarDispositivo')}</div>
      <p class="ch-previa-quem" id="ch-previa-quem"></p>
    </div>`;
  if(comVideo){
    // O mesmo <video> volta para o slot novo a cada redesenho (mutar, trocar
    // opção): um elemento novo começa preto até o primeiro quadro e pisca.
    let v = pr.video;
    if(!v || v.srcObject?.getVideoTracks()[0] !== pr.cam){
      v = document.createElement('video');
      v.autoplay = true; v.playsInline = true; v.muted = true;
      v.className = 'ch-video espelho';
      marcarVideoQuandoPronto(v);
      v.srcObject = new MediaStream([pr.cam]);
      pr.video = v;
    }
    corpo.querySelector('.ch-previa-slot').appendChild(v);
    v.play().catch(()=>{});
  }else pr.video = null;
  desenharQuemEstaNaPrevia();
  const btn = document.getElementById('chamada-previa-entrar');
  if(btn){ btn.disabled = pr.entrando; btn.textContent = pr.entrando ? 'Entrando…' : 'Entrar na chamada'; }
}

function desenharQuemEstaNaPrevia(){
  const pr = previaChamada;
  const el = document.getElementById('ch-previa-quem');
  if(!pr || !el) return;
  const reg = canaisChamada[chaveTopico(pr.pid, pr.sala)];
  const na = naSala(reg, pr.sala);
  const varias = salasDoProjeto(pr.pid).length > 1;
  const onde = varias ? `em ${nomeDaSala(pr.pid, pr.sala)}` : 'na chamada';
  if(reg && reg.erro){
    el.textContent = reg.salaFixa ? 'A sala privada não abriu. Se é a primeira sala privada do app, falta rodar o supabase/salas_projeto.sql no Supabase.'
      : 'O canal da chamada não abriu. Se é a primeira chamada do app, falta rodar o supabase/chamadas.sql no Supabase.';
    return;
  }
  // A regra do microfone da sala vem junto, para ninguém estranhar entrar mudo.
  const regra = regraMicDaSala(pr.pid, pr.sala);
  const nota = silenciadoPeloModerador(pr.pid, session.user.id) ? ' Um moderador silenciou você: você entra só ouvindo.'
    : regra === 'silencio' ? (micTravadoNaSala(pr.pid, pr.sala) ? ' Sala de silêncio: você entra só ouvindo.' : ' Sala de silêncio: só quem modera abre o microfone.')
    : regra === 'fechado' ? ' Nesta sala todo mundo entra com o microfone fechado.' : '';
  if(!na.length){ el.textContent = `Ninguém ${onde} ainda. Quem estiver com o app aberto recebe um aviso quando você entrar.${nota}`; return; }
  const nomes = na.map(p=>nomeNaChamada(pr.pid, p.uid));
  el.textContent = `${listaDeNomes(nomes)} ${na.length === 1 ? 'está' : 'estão'} ${onde}.${nota}`;
}

function fecharPreviaChamada(){
  const pr = previaChamada;
  previaChamada = null;
  if(pr){
    if(pr.voz) pr.voz.stop();
    if(pr.cam) pr.cam.stop();
  }
  pararMedicaoFala('previa');
  const modal = document.getElementById('chamada-previa');
  if(modal) modal.classList.remove('open');
  const corpo = document.getElementById('chamada-previa-corpo');
  if(corpo) corpo.innerHTML = '';
  sincronizarCanaisChamada();
}

/* --- entrar e sair --- */

// Sozinho no projeto não há com quem conectar, e a rota recusa o TURN para
// projeto de uma pessoa só (SEC-077). A chamada nasce só com STUN e marcada
// com turnAdiado; o TURN vem quando alguém entra (renovarTurnChamada).
async function buscarTurnChamada(pid, forcar){
  const p = projetoDaChamada(pid);
  if(!forcar && p && projectPeople(p).length < 2) return {servidores: CHAMADA_STUN, semTurn: true, adiado: true};
  try{
    const res = await fetch('/api/chamada/turn', {method: 'POST', headers: apiHeaders(), body: JSON.stringify({project_id: pid})});
    if(res.ok){
      const d = await res.json();
      if(Array.isArray(d.iceServers) && d.iceServers.length) return {servidores: [...CHAMADA_STUN, ...d.iceServers], semTurn: false};
    }
  }catch(e){ console.warn('chamada: TURN indisponível', e); }
  return {servidores: CHAMADA_STUN, semTurn: true};
}

function agendarRenovacaoTurn(){
  const c = chamada;
  if(!c) return;
  clearTimeout(c.turnTimer);
  c.turnTimer = setTimeout(async ()=>{
    if(chamada !== c) return;
    await renovarTurnChamada(c);
    if(chamada !== c) return;
    agendarRenovacaoTurn();
  }, CHAMADA_RENOVA_TURN_MS);
}

async function renovarTurnChamada(c){
  const r = await buscarTurnChamada(c.pid, true);
  if(chamada !== c || r.semTurn) return;
  c.iceServers = r.servidores;
  c.semTurn = false;
  c.turnAdiado = false;
  for(const par of c.pares.values()){
    try{ par.pc.setConfiguration(Object.assign(par.pc.getConfiguration(), {iceServers: r.servidores})); }catch(e){}
  }
}

// Entrar abre a chamada na página inteira; a janela flutuante fica para o
// botão de minimizar (e para a troca de aba, nos navegadores que avisam).
async function entrarNaChamada(){
  const pr = previaChamada;
  if(!pr || pr.entrando) return;
  pr.entrando = true;
  desenharPreviaChamada();
  const topico = chaveTopico(pr.pid, pr.sala);
  const reg = canalChamada(topico);
  const pronto = await Promise.race([reg.pronto, new Promise(ok=>setTimeout(()=>ok(false), 10000))]);
  if(previaChamada !== pr) return;
  const falhar = (msg)=>{ pr.entrando = false; pr.erro = msg; desenharPreviaChamada(); };
  if(!pronto) return falhar(topico !== pr.pid
    ? 'A sala privada não abriu. Confira a conexão. Se é a primeira sala privada do app, falta rodar o supabase/salas_projeto.sql no Supabase.'
    : 'O canal da chamada não abriu. Confira a conexão. Se é a primeira chamada do app, falta rodar o supabase/chamadas.sql no Supabase.');
  const eu = session.user.id;
  // Uma conta fica em uma sala por vez no projeto: a Presence tem uma chave
  // por pessoa.
  if(emChamadaDoProjeto(pr.pid).some(p=>p.uid === eu)) return falhar('Você já está numa chamada deste projeto em outra aba ou aparelho.');
  const ice = await buscarTurnChamada(pr.pid);
  if(previaChamada !== pr) return;

  const agora = Date.now();
  // Silenciado por um moderador ou sala de silêncio sem poder falar: entra
  // com o microfone fechado e travado. Na sala "entra mudo" a prévia já
  // começou fechada; quem abriu ali entra falando.
  const micPermitido = !micTravadoNaSala(pr.pid, pr.sala);
  chamada = {
    pid: pr.pid, sala: pr.sala, topico, sessao: novaSessaoChamada(), entrouEm: agora, inicio: agora, presente: false,
    local: {voz: pr.voz, cam: pr.camera ? pr.cam : null, tela: null, telaAudio: null},
    mic: !!(pr.mic && pr.voz && micPermitido), ensurdecido: false, micAntes: true, camera: !!(pr.camera && pr.cam), tela: false,
    dispositivos: Object.assign({}, pr.dispositivos),
    pares: new Map(), participantes: new Map(), iceAdiantado: {}, esperas: {}, vigias: {},
    iceServers: ice.servidores, semTurn: ice.semTurn, turnAdiado: !!ice.adiado, turnTimer: null,
    destaque: null, modo: 'expandida', painelDisp: false, volumeAberto: null,
    registrarInicio: naSala(reg, pr.sala).length === 0
  };
  // As faixas passam da prévia para a chamada; a prévia não para elas.
  pr.voz = null; pr.cam = null;
  if(!chamada.camera && chamada.local.cam) chamada.local.cam = null;
  fecharPreviaChamada();
  if(chamada.local.voz){
    chamada.local.voz.enabled = chamada.mic;
    medirFala(eu, chamada.local.voz);
  }
  agendarRenovacaoTurn();
  tocarSomChamada('entrar');
  comTransicaoChamada(()=>desenharChamada());
  ligarFlutuanteAutomatico();
  chamada.vigiaConexoes = setInterval(vigiarConexoesChamada, 3000);
  iniciarRelogioChamada();
  await atualizarPresencaChamada();
  if(!chamada) return;
  chamada.presente = true;
  if(chamada.registrarInicio){
    const c = chamada;
    c.timerInicio = setTimeout(()=>{ if(chamada === c) reconciliarChamada(); }, 2500);
  }
  presencaDoProjeto(chamada.pid);
  aplicarModeracaoNaChamada();
  safeRerender();
}

// O primeiro a entrar numa sala grava "Chamada iniciada" no canal dela, que
// chega como aviso a quem está com o app aberto; o último a sair grava a
// duração. Sem os canais no banco, vai sem canal e cai no chat, como antes.
function registrarLinhaChamada(pid, sala, kind, duracao){
  if(chatSemTabela) return;
  const linha = {project_id: pid, kind, body: '', duracao_seg: duracao};
  if(!canaisSemTabela && CHAMADA_UUID.test(sala || '')) linha.canal_id = sala;
  sb.from('project_messages').insert(linha)
    .then(({error})=>{ if(error) console.warn('chamada: linha no chat', error); });
}

async function sairDaChamada(opts){
  const o = opts || {};
  const c = chamada;
  if(!c) return;
  // A janela da chamada pode estar na flutuante: pega ela antes de fechar.
  const flutuante = janelaFlutuante;
  const raizFlutuante = flutuante ? flutuante.raiz : null;
  janelaFlutuante = null;
  trocarRelogioFala();
  desligarFlutuanteAutomatico();
  chamada = null;
  // Saindo da chamada aberta, o app atrás dela volta a responder. Antes ele
  // ficava inerte (sem clique) até a próxima chamada.
  travarAppAtrasDaChamada();
  // A próxima chamada começa sem animar a troca dos botões a partir desta.
  for(const id of Object.keys(estadosDosBotoes)) delete estadosDosBotoes[id];
  vozNoBotao = 0;
  if(flutuante){
    clearInterval(flutuante.vigia);
    try{ if(raizFlutuante) raizFlutuante.remove(); }catch(e){}
    try{ flutuante.win.close(); }catch(e){}
  }
  desenharAvisoFlutuante();
  clearTimeout(c.turnTimer);
  clearTimeout(c.timerInicio);
  Object.values(c.esperas).forEach(clearTimeout);
  clearInterval(c.vigiaConexoes);
  pararRelogioChamada();
  for(const par of [...c.pares.values()]){
    clearTimeout(par.timer);
    try{ par.pc.close(); }catch(e){}
    desligarReforcosPar(par);
    for(const el of Object.values(par.audio)){ el.srcObject = null; el.remove(); }
  }
  if(chamadaAudioCtx){ chamadaAudioCtx.close().catch(()=>{}); chamadaAudioCtx = null; }
  // SEC-078: sair para todas as faixas, para o indicador de câmera apagar.
  for(const t of Object.values(c.local)) if(t) t.stop();
  for(const chave of [...falaMedidores.keys()]) if(chave !== 'previa') pararMedicaoFala(chave);
  Object.keys(chamadaVideos).forEach(k=>delete chamadaVideos[k]);
  if(document.fullscreenElement && document.getElementById('chamada') && document.getElementById('chamada').contains(document.fullscreenElement)){
    document.exitFullscreen().catch(()=>{});
  }
  // A janela sai com a transição. Perde o id já, para uma chamada nova que
  // comece nesse meio-tempo criar a própria janela em vez de reusar esta.
  const raiz = document.getElementById('chamada');
  chamadaDesenho = {modo: null, chaves: new Set()};
  if(raiz){
    raiz.removeAttribute('id');
    raiz.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    comTransicaoChamada(()=>raiz.remove());
  }
  const audios = document.getElementById('chamada-audios');
  if(audios) audios.remove();
  const reg = regDaChamada(c);
  const restantes = naSala(reg, c.sala).filter(p=>!(p.uid === session.user.id && p.sessao === c.sessao));
  if(reg && reg.assinado){ try{ await reg.canal.untrack(); }catch(e){} }
  if(c.presente && !restantes.length) registrarLinhaChamada(c.pid, c.sala, 'chamada_fim', Math.round((Date.now() - c.inicio) / 1000));
  if(!o.silencioso) tocarSomChamada('sair');
  if(o.aviso) showToast(o.aviso, 'erro');
  sincronizarCanaisChamada();
  atualizarFaixaChamada();
  if(session) safeRerender();
}

// Troca de sala sem sair da chamada (Q11 da RFC 0004): fecha as conexões da
// sala antiga, grava "Chamada encerrada" nela se a pessoa era a última e
// entra na nova com uma sessão nova, para um sinal atrasado da sala antiga
// não se misturar. Microfone, câmera e tela seguem como estavam.
// Entre sala aberta e sala privada o tópico muda (RFC 0005): sai da Presence
// do tópico antigo e entra na do novo. o.forcar refaz a entrada na mesma sala,
// quando ela vira privada ou aberta com a pessoa dentro; o.aviso diz por quê
// (movido por alguém).
async function trocarDeSalaChamada(sala, opts){
  const o = opts || {};
  const c = chamada;
  if(!c || (c.sala === sala && !o.forcar) || c.trocando) return;
  if((canalDoProjeto(c.pid, sala) || {}).tipo !== 'voz') return;
  c.trocando = true;
  const reg = regDaChamada(c);
  const eu = session.user.id;
  const topicoNovo = chaveTopico(c.pid, sala);
  if(topicoNovo !== c.topico){
    const regNovo = canalChamada(topicoNovo);
    const pronto = await Promise.race([regNovo.pronto, new Promise(ok=>setTimeout(()=>ok(false), 10000))]);
    if(chamada !== c){ return; }
    if(!pronto){
      c.trocando = false;
      showToast(salaPrivada(c.pid, sala) ? 'A sala privada não abriu. Confira a conexão ou se o supabase/salas_projeto.sql já rodou.' : 'Não deu para trocar de sala. Confira a conexão.', 'erro');
      sincronizarCanaisChamada();
      return;
    }
  }
  const restantes = naSala(reg, c.sala).filter(p=>!(p.uid === eu && p.sessao === c.sessao));
  if(c.presente && !restantes.length && c.sala !== sala) registrarLinhaChamada(c.pid, c.sala, 'chamada_fim', Math.round((Date.now() - c.inicio) / 1000));
  if(topicoNovo !== c.topico && reg && reg.assinado){ try{ await reg.canal.untrack(); }catch(e){} }
  c.topico = topicoNovo;
  clearTimeout(c.timerInicio);
  Object.values(c.esperas).forEach(clearTimeout);
  c.esperas = {};
  for(const par of [...c.pares.values()]) fecharParChamada(par);
  c.participantes.clear();
  c.vigias = {};
  c.iceAdiantado = {};
  c.destaque = null;
  for(const k of Object.keys(chamadaVideos)) if(!k.startsWith(`${eu}:`)) delete chamadaVideos[k];
  const agora = Date.now();
  c.sala = sala;
  c.sessao = novaSessaoChamada();
  c.entrouEm = agora;
  c.inicio = agora;
  c.registrarInicio = naSala(regDaChamada(c), sala).length === 0;
  // A regra de microfone da sala nova vale ao chegar: sala de silêncio (ou
  // silenciado pelo moderador) fecha; sala "fechado" também começa fechada.
  if(c.mic && (micTravadoNaSala(c.pid, sala) || regraMicDaSala(c.pid, sala) !== 'livre')){
    c.mic = false;
    if(c.local.voz) c.local.voz.enabled = false;
  }
  tocarSomChamada('entrar');
  anunciarNaChamada(o.aviso || `Você entrou em ${nomeDaSala(c.pid, sala)}`);
  if(o.aviso) showToast(o.aviso);
  sincronizarCanaisChamada();
  await atualizarPresencaChamada();
  c.trocando = false;
  if(chamada !== c) return;
  if(c.registrarInicio) c.timerInicio = setTimeout(()=>{ if(chamada === c) reconciliarChamada(); }, 2500);
  presencaDoProjeto(c.pid);
  aplicarModeracaoNaChamada();
  desenharChamada();
  safeRerender();
}

function chamadaSair(){ sairDaChamada(); }

// SEC-076: depois de cada loadProjects, quem perdeu o acesso sai das conexões,
// e quem perdeu o próprio acesso sai da chamada.
function conferirAcessoChamada(){
  if(!chamada) { sincronizarCanaisChamada(); return; }
  if(!projetoDaChamada(chamada.pid)){
    sairDaChamada({aviso: 'Você não faz mais parte deste projeto e saiu da chamada.'});
    return;
  }
  for(const par of [...chamada.pares.values()]){
    if(!permitidoNaChamada(chamada.pid, par.uid)) fecharParChamada(par);
  }
  presencaDoProjeto(chamada.pid);
}

// Depois de recarregar os canais: a sala da chamada sumiu (apagada, ou
// privada e a pessoa saiu da lista) e a chamada acaba; virou privada ou aberta
// e a chamada passa para o tópico certo.
function conferirSalaDaChamada(){
  const c = chamada;
  if(!c || c.trocando || canaisSemTabela || !canaisCarregados) return;
  if(!canalDoProjeto(c.pid, c.sala)){
    sairDaChamada({aviso: 'A sala em que você estava não existe mais para você.'});
    return;
  }
  if(chaveTopico(c.pid, c.sala) !== c.topico) trocarDeSalaChamada(c.sala, {forcar: true});
  else sincronizarCanaisChamada();
}

/* --- microfone das salas e moderação de voz (RFC 0005) --- */
// Cada sala tem uma regra de microfone (project_channels.regra_mic). Silenciar,
// mover e desconectar outra pessoa é uma linha em project_voz_moderacao, que
// só aceita quem tem a permissão do cargo (SEC-087), e chega a todos pelo
// Postgres Changes. Quem é alvo obedece; os outros aplicam por conta própria:
// não tocam a voz de quem não pode falar e não conectam com a sessão que
// recebeu ordem de mover ou desconectar.

const REGRAS_MIC = {
  livre: {nome: 'Livre', desc: 'Cada um entra com o microfone como escolheu na prévia.'},
  fechado: {nome: 'Entra mudo', desc: 'Todo mundo chega com o microfone fechado e abre quando quiser.'},
  silencio: {nome: 'Silêncio', desc: 'Ninguém abre o microfone, só quem pode silenciar outros.'}
};

function regraMicDaSala(pid, sala){
  const s = canalDoProjeto(pid, sala);
  return s && Object.prototype.hasOwnProperty.call(REGRAS_MIC, s.regraMic) ? s.regraMic : 'livre';
}

// moderacao[projeto][pessoa] = a linha de project_voz_moderacao dela.
let moderacao = {};
let moderacaoSemTabela = false;
let canalModeracao = null;
const comandosAtendidos = new Set();

function moderacaoDe(pid, uid){
  return (moderacao[pid] || {})[uid] || null;
}

function silenciadoPeloModerador(pid, uid){
  const m = moderacaoDe(pid, uid);
  return !!(m && m.silenciado);
}

// Pode falar na sala: ninguém silenciou a pessoa e, na sala de silêncio, ela
// tem a permissão de silenciar outros.
function podeFalarNaSala(pid, sala, uid){
  if(silenciadoPeloModerador(pid, uid)) return false;
  if(regraMicDaSala(pid, sala) === 'silencio') return temPermissaoVoz(pid, 'silenciar', uid);
  return true;
}

function micTravadoNaSala(pid, sala){
  return !podeFalarNaSala(pid, sala, session.user.id);
}

// A sessão de alguém que recebeu ordem de ir para outra sala, ou de sair, e
// continua aqui.
function sessaoBarradaNaSala(pid, p){
  const m = moderacaoDe(pid, p.uid);
  if(!m || !m.comando || !m.comandoSessao || m.comandoSessao !== p.sessao) return false;
  return m.comando === 'desconectar' || m.comandoSala !== p.sala;
}

function moderacaoLinha(r){
  return {
    projectId: r.project_id, uid: r.user_id, silenciado: !!r.silenciado,
    comando: r.comando === 'mover' || r.comando === 'desconectar' ? r.comando : null,
    comandoSala: CHAMADA_UUID.test(r.comando_sala || '') ? r.comando_sala : null,
    comandoSessao: typeof r.comando_sessao === 'string' ? r.comando_sessao.slice(0, 64) : null,
    comandoEm: typeof r.comando_em === 'string' ? r.comando_em : null,
    por: CHAMADA_UUID.test(r.atualizado_por || '') ? r.atualizado_por : null
  };
}

async function carregarModeracao(){
  if(!session || moderacaoSemTabela) return;
  const ids = state.projects.map(p=>p.id);
  if(!ids.length){ moderacao = {}; return; }
  const {data, error} = await sb.from('project_voz_moderacao').select('*').in('project_id', ids);
  if(error){
    if(chatErroSemTabela(error)){
      moderacaoSemTabela = true;
      console.warn('Moderação de voz: rode supabase/salas_projeto.sql para ativar.');
    }else console.error(error);
    return;
  }
  const novo = {};
  for(const r of data || []){
    const m = moderacaoLinha(r);
    if(CHAMADA_UUID.test(m.projectId || '') && CHAMADA_UUID.test(m.uid || '')) (novo[m.projectId] = novo[m.projectId] || {})[m.uid] = m;
  }
  moderacao = novo;
  ligarRealtimeModeracao();
  aposMudarModeracao();
}

function ligarRealtimeModeracao(){
  if(canalModeracao || moderacaoSemTabela) return;
  canalModeracao = sb.channel('moderacao-voz')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'project_voz_moderacao'}, (payload)=>{
      if(payload.eventType === 'DELETE'){
        const o = payload.old || {};
        if(moderacao[o.project_id]) delete moderacao[o.project_id][o.user_id];
      }else if(payload.new){
        const m = moderacaoLinha(payload.new);
        if(!CHAMADA_UUID.test(m.projectId || '') || !CHAMADA_UUID.test(m.uid || '')) return;
        const antes = moderacaoDe(m.projectId, m.uid);
        (moderacao[m.projectId] = moderacao[m.projectId] || {})[m.uid] = m;
        avisarModeracao(antes, m);
      }
      aposMudarModeracao();
    })
    .subscribe();
}

// Quem foi silenciado ou liberado fica sabendo, com o nome de quem fez.
function avisarModeracao(antes, m){
  if(m.uid !== session.user.id || !!(antes && antes.silenciado) === m.silenciado) return;
  const p = projetoDaChamada(m.projectId);
  if(!p) return;
  const quem = m.por && m.por !== session.user.id ? nomeNaChamada(p.id, m.por) : null;
  if(m.silenciado) showToast(`${quem || 'Um moderador'} silenciou você nas salas de ${p.name}.`);
  else showToast(`${quem || 'Um moderador'} liberou o seu microfone em ${p.name}.`);
}

function aposMudarModeracao(){
  aplicarModeracaoNaChamada();
  atualizarListaCanais();
  if(previaChamada) desenharPreviaChamada();
}

// O que a moderação muda na chamada em que estou: ordem para esta sessão
// (mover ou sair), microfone travado e a voz de quem não pode falar.
function aplicarModeracaoNaChamada(){
  const c = chamada;
  if(!c || c.trocando) return;
  const eu = session.user.id;
  const m = moderacaoDe(c.pid, eu);
  if(m && m.comando && m.comandoSessao === c.sessao && m.comandoEm){
    const chave = `${c.sessao}:${m.comandoEm}`;
    if(!comandosAtendidos.has(chave)){
      comandosAtendidos.add(chave);
      const quem = m.por && m.por !== eu ? nomeNaChamada(c.pid, m.por) : 'Um moderador';
      if(m.comando === 'desconectar'){
        sairDaChamada({aviso: `${quem} tirou você da chamada.`});
        return;
      }
      if(m.comandoSala && m.comandoSala !== c.sala && canalDoProjeto(c.pid, m.comandoSala)){
        trocarDeSalaChamada(m.comandoSala, {aviso: `${quem} levou você para ${nomeDaSala(c.pid, m.comandoSala)}.`});
        return;
      }
    }
  }
  const travado = micTravadoNaSala(c.pid, c.sala);
  if(travado && c.mic){
    c.mic = false;
    if(c.local.voz) c.local.voz.enabled = false;
    tocarSomChamada('mutar');
    anunciarNaChamada(silenciadoPeloModerador(c.pid, eu) ? 'Seu microfone foi fechado por um moderador' : 'Sala de silêncio: seu microfone foi fechado');
    atualizarPresencaChamada();
  }
  c.micTravado = travado;
  for(const par of c.pares.values()) aplicarVolumePar(par);
  reconciliarChamada();
}

// Pede ao banco; o resultado volta pelo realtime para todos, inclusive aqui.
async function moderarVoz(pid, alvo, acao, sala){
  if(!CHAMADA_UUID.test(pid || '') || !CHAMADA_UUID.test(alvo || '')) return false;
  const perm = acao === 'silenciar' || acao === 'liberar' ? 'silenciar' : 'mover';
  if(!podeModerar(pid, alvo, perm)){ showToast('Seu cargo não pode fazer isso com essa pessoa.', 'erro'); return false; }
  const p = emChamadaDoProjeto(pid).find(x=>x.uid === alvo);
  const sessao = p && /^[0-9a-f]{1,64}$/.test(p.sessao) ? p.sessao : null;
  const {error} = await sb.rpc('moderar_voz', {
    p_projeto: pid, p_alvo: alvo, p_acao: acao,
    p_sala: acao === 'mover' && CHAMADA_UUID.test(sala || '') ? sala : null,
    p_sessao: acao === 'mover' || acao === 'desconectar' ? sessao : null
  });
  if(error){
    console.error(error);
    const t = `${error.message || ''} ${error.code || ''}`;
    showToast(/PGRST202|42883|42P01/.test(t) ? 'A moderação precisa do supabase/salas_projeto.sql. Rode ele no Supabase.'
      : /moderar_sala/.test(t) ? 'Essa pessoa não pode entrar nessa sala.'
      : /moderar_sem_permissao|row-level security|42501/.test(t) ? 'Seu cargo não pode fazer isso com essa pessoa.'
      : 'Não deu para fazer isso agora. Confira a conexão e tente de novo.', 'erro');
    return false;
  }
  const nome = nomeNaChamada(pid, alvo);
  const textos = {silenciar: `Microfone de ${nome} fechado nas salas`, liberar: `${nome} pode falar de novo`, desconectar: `${nome} saiu da chamada`, mover: `${nome} foi para ${nomeDaSala(pid, sala)}`};
  showToast(textos[acao] || 'Feito');
  return true;
}

window.addEventListener('pagehide', ()=>{
  const c = chamada;
  if(!c) return;
  for(const t of Object.values(c.local)) if(t) t.stop();
  for(const par of c.pares.values()){ try{ par.pc.close(); }catch(e){} }
  const reg = regDaChamada(c);
  if(reg && reg.assinado){ try{ reg.canal.untrack(); }catch(e){} }
});

/* --- controles --- */

async function trocarFaixaLocal(tipo, track){
  const c = chamada;
  if(!c) return;
  const antiga = c.local[tipo];
  c.local[tipo] = track;
  for(const par of c.pares.values()){
    const t = par.transceptores[tipo];
    if(t && t.sender) await t.sender.replaceTrack(track).catch(()=>{});
  }
  if(antiga && antiga !== track) antiga.stop();
  if(tipo === 'voz'){
    if(track){ track.enabled = c.mic && !c.ensurdecido; medirFala(session.user.id, track); }
    else pararMedicaoFala(session.user.id);
  }
  // Só câmera e tela têm vídeo próprio. Antes, trocar o microfone (ao mudar a
  // supressão de ruído) descartava o vídeo da câmera e ela piscava.
  if(tipo === 'cam' || tipo === 'tela') delete chamadaVideos[`${session.user.id}:${tipo}`];
  ajustarQualidadeChamada();
}

async function chamadaAlternarMic(){
  const c = chamada;
  if(!c) return;
  if(!c.mic && micTravadoNaSala(c.pid, c.sala)){
    showToast(silenciadoPeloModerador(c.pid, session.user.id) ? 'Um moderador silenciou você. Peça para liberar.' : 'Sala de silêncio: aqui ninguém abre o microfone.');
    return;
  }
  if(!c.local.voz){
    try{
      const s = await navigator.mediaDevices.getUserMedia(restricoesMicrofone(c.dispositivos.mic));
      if(chamada !== c){ s.getTracks().forEach(t=>t.stop()); return; }
      c.mic = true;
      c.ensurdecido = false;
      await trocarFaixaLocal('voz', s.getAudioTracks()[0]);
    }catch(e){ showToast(mensagemErroMidia(e, 'o microfone'), 'erro'); return; }
  }else{
    c.mic = !c.mic;
    // Abrir o microfone tira o ensurdecer, como no Discord.
    if(c.mic && c.ensurdecido){ c.ensurdecido = false; for(const par of c.pares.values()) aplicarVolumePar(par); }
    c.local.voz.enabled = c.mic;
  }
  tocarSomChamada(c.mic ? 'desmutar' : 'mutar');
  atualizarPresencaChamada();
  desenharChamada();
}

function chamadaAlternarEnsurdecer(){
  const c = chamada;
  if(!c) return;
  c.ensurdecido = !c.ensurdecido;
  if(c.ensurdecido){ c.micAntes = c.mic; c.mic = false; }
  else c.mic = c.micAntes !== false && !micTravadoNaSala(c.pid, c.sala);
  if(c.local.voz) c.local.voz.enabled = c.mic;
  for(const par of c.pares.values()) aplicarVolumePar(par);
  tocarSomChamada(c.ensurdecido ? 'ensurdecer' : 'ouvir');
  atualizarPresencaChamada();
  desenharChamada();
}

async function chamadaAlternarCamera(){
  const c = chamada;
  if(!c) return;
  if(c.camera){
    c.camera = false;
    await trocarFaixaLocal('cam', null);
  }else{
    try{
      const s = await navigator.mediaDevices.getUserMedia(restricoesCamera(c.dispositivos.cam));
      if(chamada !== c){ s.getTracks().forEach(t=>t.stop()); return; }
      const t = s.getVideoTracks()[0];
      c.dispositivos.cam = t.getSettings().deviceId || c.dispositivos.cam;
      c.camera = true;
      await trocarFaixaLocal('cam', t);
    }catch(e){ showToast(mensagemErroMidia(e, 'a câmera'), 'erro'); return; }
  }
  atualizarPresencaChamada();
  desenharChamada();
}

// Transmitir a tela começa por uma escolha do app, como no Discord: o que
// transmitir, em que qualidade e se o som vai junto. O seletor do navegador
// vem depois, já na aba certa (displaySurface), só para confirmar; o visual
// dele é do navegador e nenhum site muda.
const QUALIDADES_TELA = {
  '720': {rotulo: '720p', dica: 'Mais leve para a internet de quem assiste', largura: 1280, altura: 720, quadros: 30, taxa: 2500000},
  '1080': {rotulo: '1080p', dica: 'Texto e detalhes nítidos', largura: 1920, altura: 1080, quadros: 30, taxa: 6000000},
  '1080-60': {rotulo: '1080p · 60', dica: 'Movimento suave, para jogos e vídeos', largura: 1920, altura: 1080, quadros: 60, taxa: 8000000}
};
const FONTES_TELA = {
  monitor: {nome: 'Tela inteira', desc: 'Tudo o que está no monitor'},
  window: {nome: 'Janela', desc: 'Um programa só'},
  browser: {nome: 'Aba', desc: 'Uma aba do navegador, com o som dela'}
};
const ICONES_FONTE = {
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="6" cy="6.5" r=".6" fill="currentColor"/><circle cx="8.5" cy="6.5" r=".6" fill="currentColor"/>',
  browser: '<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 9h20"/><path d="M6 5V3.5h6V5"/>'
};

function escolhaTelaSalva(){
  let e = {};
  try{ e = JSON.parse(localStorage.getItem('chamadaTela') || '{}') || {}; }catch(err){}
  return {
    fonte: FONTES_TELA[e.fonte] ? e.fonte : 'monitor',
    qualidade: QUALIDADES_TELA[e.qualidade] ? e.qualidade : '1080',
    som: e.som !== false,
    // Levar a chamada para a janela flutuante junto com a transmissão: vem
    // desligado. Dentro do samyest a chamada fica na página; a flutuante abre
    // sozinha quando a pessoa sai da aba. Chave nova, para a escolha antiga
    // (que vinha ligada) não valer mais.
    flutuanteJunto: e.flutuanteJunto === true
  };
}

function ehMac(){
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  return /mac/i.test(p);
}

async function chamadaAlternarTela(){
  const c = chamada;
  if(!c || !telaSuportada()) return;
  if(c.tela){ await pararTelaChamada(); return; }
  c.painelTela = true;
  c.painelDisp = false;
  c.volumeAberto = null;
  c.escolhaTela = escolhaTelaSalva();
  c.animarPainel = true;
  desenharChamada();
  const marcada = document.getElementById(`ch-fonte-${c.escolhaTela.fonte}`);
  if(marcada) marcada.focus();
}

function escolherTela(campo, valor){
  const c = chamada;
  if(!c || !c.escolhaTela) return;
  if(campo === 'fonte' && FONTES_TELA[valor]) c.escolhaTela.fonte = valor;
  else if(campo === 'qualidade' && QUALIDADES_TELA[valor]) c.escolhaTela.qualidade = valor;
  else if(campo === 'som') c.escolhaTela.som = !!valor;
  else if(campo === 'flutuante') c.escolhaTela.flutuanteJunto = !!valor;
  else return;
  try{ localStorage.setItem('chamadaTela', JSON.stringify(c.escolhaTela)); }catch(e){}
  desenharChamada();
}

function fecharEscolhaTela(){
  const c = chamada;
  if(!c || !c.painelTela) return;
  c.painelTela = false;
  desenharChamada();
  const b = document.getElementById('ch-btn-tela');
  if(b) b.focus();
}

function escolhaTelaHtml(){
  const c = chamada;
  const e = c.escolhaTela;
  const q = QUALIDADES_TELA[e.qualidade];
  const somDica = !e.som ? 'Só a imagem vai para a chamada.'
    : e.fonte === 'browser' ? 'O som da aba vai junto com a imagem.'
    : ehMac() ? 'No Mac, o navegador só manda o som quando você transmite uma aba.'
    : 'O som do computador vai junto, se o navegador permitir.';
  return `
    <div class="ch-dialogo-fundo">
      <div class="ch-dialogo" role="dialog" aria-modal="true" aria-labelledby="ch-tela-titulo" aria-describedby="ch-tela-texto">
        <h3 class="ch-dialogo-titulo" id="ch-tela-titulo">Transmitir a tela</h3>
        <p class="ch-dialogo-texto" id="ch-tela-texto">Escolha o que mostrar. Depois o navegador pede para confirmar qual.</p>
        <fieldset class="ch-fontes">
          <legend class="sr-only">O que transmitir</legend>
          ${Object.entries(FONTES_TELA).map(([k, f])=>`
            <label class="ch-fonte ${e.fonte === k ? 'marcada' : ''}">
              <input type="radio" class="sr-only" name="ch-fonte" id="ch-fonte-${k}" value="${k}" ${e.fonte === k ? 'checked' : ''} onchange="escolherTela('fonte', this.value)">
              <span class="ch-fonte-icone" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONES_FONTE[k]}</svg></span>
              <span class="ch-fonte-nome">${esc(f.nome)}</span>
              <span class="ch-fonte-desc">${esc(f.desc)}</span>
            </label>`).join('')}
        </fieldset>
        <fieldset class="ch-qualidade">
          <legend class="ch-dialogo-rotulo">Qualidade</legend>
          <div class="ch-segmentos">
            ${Object.entries(QUALIDADES_TELA).map(([k, qq])=>`
              <label class="ch-segmento ${e.qualidade === k ? 'marcado' : ''}">
                <input type="radio" class="sr-only" name="ch-qualidade" id="ch-qualidade-${k}" value="${k}" ${e.qualidade === k ? 'checked' : ''} onchange="escolherTela('qualidade', this.value)">
                ${esc(qq.rotulo)}
              </label>`).join('')}
          </div>
          <p class="ch-dialogo-dica">${esc(q.dica)}</p>
        </fieldset>
        <label class="ch-som">
          <span class="ch-som-texto"><span>Transmitir o som</span><span class="ch-dialogo-dica">${esc(somDica)}</span></span>
          <input type="checkbox" role="switch" class="ch-interruptor" id="ch-tela-som" ${e.som ? 'checked' : ''} onchange="escolherTela('som', this.checked)">
        </label>
        ${janelaFlutuanteSuportada() ? `<label class="ch-som">
          <span class="ch-som-texto"><span>Janela flutuante</span><span class="ch-dialogo-dica">A chamada fica por cima dos outros programas enquanto você transmite.</span></span>
          <input type="checkbox" role="switch" class="ch-interruptor" id="ch-tela-flutuante" ${e.flutuanteJunto ? 'checked' : ''} onchange="escolherTela('flutuante', this.checked)">
        </label>` : ''}
        <div class="ch-dialogo-acoes">
          <button type="button" class="ch-dialogo-cancelar" id="ch-tela-cancelar" onclick="fecharEscolhaTela()">Cancelar</button>
          <button type="button" class="ch-dialogo-ok" id="ch-tela-transmitir" onclick="transmitirTelaEscolhida()">${iconeChamada('tela', 17)}Transmitir</button>
        </div>
      </div>
    </div>`;
}

// O clique em "Transmitir" é o gesto que o navegador exige para pedir a
// tela (SEC-078): getDisplayMedia é chamado antes de qualquer espera.
function transmitirTelaEscolhida(){
  const c = chamada;
  if(!c || !c.escolhaTela) return;
  const e = c.escolhaTela;
  const q = QUALIDADES_TELA[e.qualidade];
  const pedido = {
    video: {displaySurface: e.fonte, width: {ideal: q.largura, max: q.largura}, height: {ideal: q.altura, max: q.altura}, frameRate: {ideal: q.quadros, max: q.quadros}},
    audio: e.som ? {echoCancellation: false, noiseSuppression: false, autoGainControl: false} : false,
    selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: e.som ? 'include' : 'exclude', monitorTypeSurfaces: 'include'
  };
  const pedirTela = navigator.mediaDevices.getDisplayMedia(pedido);
  // Como no Meet: quem transmite costuma ir para outro programa, e a chamada
  // vai junto, por cima. Usa o mesmo clique, que é o gesto que o navegador
  // exige para abrir a janela; o pedido da tela já saiu antes.
  if(e.flutuanteJunto && !janelaFlutuante && janelaFlutuanteSuportada()) abrirJanelaFlutuante('tela');
  c.pedindoTela = true;
  const soltar = ()=>{ c.pedindoTela = false; c.telaPedidaAte = Date.now() + 800; };
  pedirTela.then(soltar, soltar);
  c.painelTela = false;
  c.qualidadePedida = e.qualidade;
  desenharChamada();
  iniciarTelaChamada(c, pedirTela, pedido, q);
}

async function iniciarTelaChamada(c, pedirTela, pedido, q){
  let s;
  try{ s = await pedirTela; }
  catch(e){
    // Navegador que não conhece algum campo do pedido: tenta só com o vídeo.
    if(e && e.name === 'TypeError'){
      c.pedindoTela = true;
      try{ s = await navigator.mediaDevices.getDisplayMedia({video: {width: pedido.video.width, height: pedido.video.height, frameRate: pedido.video.frameRate}}); }catch(e2){ e = e2; }
      c.pedindoTela = false;
      c.telaPedidaAte = Date.now() + 800;
    }
    if(!s){
      if(e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') showToast('Não deu para transmitir a tela.', 'erro');
      // Desistiu de transmitir: a flutuante que abriu junto volta para a aba.
      if(janelaFlutuante && janelaFlutuante.origem === 'tela') janelaFlutuante.win.close();
      return;
    }
  }
  if(chamada !== c){ s.getTracks().forEach(t=>t.stop()); return; }
  const video = s.getVideoTracks()[0];
  const audio = s.getAudioTracks()[0] || null;
  // A 30 quadros, nitidez antes de fluidez (texto e código legíveis); a 60,
  // o pedido é movimento. Em todos, quando a banda aperta, cai o número de
  // quadros e não a resolução (Q27).
  try{ video.contentHint = q.quadros >= 60 ? 'motion' : 'detail'; }catch(e){}
  c.qualidadeTela = c.qualidadePedida || '1080';
  // "Parar de compartilhar" na barra do navegador encerra a faixa por fora.
  video.addEventListener('ended', ()=>{ if(chamada === c && c.local.tela === video) pararTelaChamada(); });
  c.tela = true;
  await trocarFaixaLocal('tela', video);
  await trocarFaixaLocal('telaAudio', audio);
  atualizarPresencaChamada();
  desenharChamada();
}

async function pararTelaChamada(){
  const c = chamada;
  if(!c) return;
  c.tela = false;
  if(c.destaque === `${session.user.id}:tela`) c.destaque = null;
  await trocarFaixaLocal('tela', null);
  await trocarFaixaLocal('telaAudio', null);
  atualizarPresencaChamada();
  desenharChamada();
}

async function chamadaTrocarDispositivo(tipo, id){
  const c = chamada;
  if(!c || !['mic', 'cam', 'saida', 'ruido'].includes(tipo)) return;
  if(tipo === 'ruido') guardarRuido(!!id);
  else c.dispositivos[tipo] = id;
  try{
    // A supressão de ruído vem na hora de abrir o microfone: trocar ela é
    // abrir o microfone de novo, com a escolha nova, e pôr no lugar. Fecha o
    // atual antes (um corte de fração de segundo): aberto, o navegador
    // reaproveitaria o processamento dele e ignoraria a escolha nova.
    if((tipo === 'mic' || tipo === 'ruido') && c.local.voz){
      if(tipo === 'ruido') c.local.voz.stop();
      const s = await navigator.mediaDevices.getUserMedia(restricoesMicrofone(c.dispositivos.mic));
      if(chamada !== c){ s.getTracks().forEach(t=>t.stop()); return; }
      await trocarFaixaLocal('voz', s.getAudioTracks()[0]);
    }else if(tipo === 'cam' && c.camera){
      const s = await navigator.mediaDevices.getUserMedia(restricoesCamera(id));
      if(chamada !== c){ s.getTracks().forEach(t=>t.stop()); return; }
      await trocarFaixaLocal('cam', s.getVideoTracks()[0]);
    }else if(tipo === 'saida'){
      for(const par of c.pares.values()){
        for(const el of Object.values(par.audio)) if(el.setSinkId) el.setSinkId(id).catch(()=>{});
      }
      if(chamadaAudioCtx && chamadaAudioCtx.setSinkId) chamadaAudioCtx.setSinkId(id).catch(()=>{});
      // Sem setSinkId no AudioContext, o reforço acima de 100% sairia no
      // alto-falante padrão: volta todo mundo para o <audio>.
      for(const par of c.pares.values()) aplicarVolumePar(par);
    }
  }catch(e){
    showToast(mensagemErroMidia(e, tipo === 'cam' ? 'a câmera' : 'o microfone'), 'erro');
    // O microfone foi fechado para trocar a supressão e não reabriu: fica
    // fechado de verdade, e o botão de microfone abre de novo quando der.
    if(chamada === c && c.local.voz && c.local.voz.readyState === 'ended'){
      c.mic = false;
      await trocarFaixaLocal('voz', null);
      atualizarPresencaChamada();
    }
  }
  desenharChamada();
}

async function chamadaAlternarDispositivos(){
  const c = chamada;
  if(!c) return;
  c.painelDisp = !c.painelDisp;
  if(c.painelDisp){
    await carregarDispositivosChamada();
    c.animarPainel = true;
  }
  desenharChamada();
}

function idVolume(chave){
  return String(chave).replace(':', '-');
}

function textoVolume(a){
  return a.mudo ? 'Silenciado' : `${Math.round(Math.min(a.v * 100, volumeMaximoChamada()))}%`;
}

function aplicarVolumeDaChave(chave){
  const par = chamada && chamada.pares.get(String(chave).split(':')[0]);
  if(par) aplicarVolumePar(par);
}

// No arraste, atualiza só o painel, sem redesenhar a chamada (redesenhar
// soltaria o controle da mão). Mexer no volume tira o "silenciado".
function chamadaVolume(chave, valor){
  const c = chamada;
  if(!c || !chaveVolumeValida(chave)) return;
  const pct = Math.min(volumeMaximoChamada(), Math.max(0, Math.round(Number(valor) || 0)));
  guardarAjusteDeVolume(chave, {v: pct / 100, mudo: false});
  aplicarVolumeDaChave(chave);
  atualizarPainelVolume(chave);
}

function atualizarPainelVolume(chave){
  const id = idVolume(chave);
  const a = ajusteDeVolume(chave);
  const max = volumeMaximoChamada();
  const pct = Math.min(max, Math.round(a.v * 100));
  const barra = document.getElementById(`ch-vol-${id}`);
  if(!barra) return;
  if(Number(barra.value) !== pct) barra.value = String(pct);
  barra.style.setProperty('--f', String(pct / max));
  barra.setAttribute('aria-valuetext', textoVolume(a));
  const caixa = barra.closest('.ch-volume');
  if(caixa) caixa.classList.toggle('mudo', a.mudo);
  const valor = document.getElementById(`ch-vol-valor-${id}`);
  if(valor) valor.textContent = textoVolume(a);
  const mudo = document.getElementById(`ch-vol-mudo-${id}`);
  if(mudo){ mudo.setAttribute('aria-pressed', String(a.mudo)); mudo.innerHTML = iconeChamada(a.mudo ? 'volumeOff' : 'volume', 16); }
  const redefinir = document.getElementById(`ch-vol-redefinir-${id}`);
  if(redefinir) redefinir.hidden = pct === 100;
}

function chamadaSilenciar(chave){
  const c = chamada;
  if(!c || !chaveVolumeValida(chave)) return;
  const a = ajusteDeVolume(chave);
  guardarAjusteDeVolume(chave, {v: a.v, mudo: !a.mudo});
  aplicarVolumeDaChave(chave);
  desenharChamada();
}

function chamadaRedefinirVolume(chave){
  chamadaVolume(chave, 100);
  desenharChamada();
  const barra = document.getElementById(`ch-vol-${idVolume(chave)}`);
  if(barra) barra.focus();
}

function chamadaAbrirVolume(chave, e){
  if(e) e.stopPropagation();
  const c = chamada;
  if(!c || !chaveVolumeValida(chave)) return;
  c.volumeAberto = c.volumeAberto === chave ? null : chave;
  if(c.volumeAberto) c.animarPainel = true;
  desenharChamada();
  if(c.volumeAberto){
    const r = document.getElementById(`ch-vol-${idVolume(chave)}`);
    if(r) r.focus();
  }
}

// Clique fora fecha o painel de volume e a lista de salas (depois da ação do
// próprio clique).
document.addEventListener('click', (e)=>{
  const c = chamada;
  if(!c || !(c.volumeAberto || c.painelSalas)) return;
  const dentro = (sel)=>e.target.closest && e.target.closest(sel);
  let mudou = false;
  if(c.volumeAberto && !dentro('.ch-volume, [data-volume-botao]')){ c.volumeAberto = null; mudou = true; }
  if(c.painelSalas && !dentro('.ch-salas, #ch-btn-salas')){ c.painelSalas = false; mudou = true; }
  if(mudou) desenharChamada();
});

/* --- salas dentro da chamada (RFC 0004, Q16) --- */

// A lista de salas do projeto abre pelo botão "Salas" no alto da chamada:
// quem está em cada uma e um toque para trocar, sem fechar microfone nem
// câmera (trocarDeSalaChamada).
function chamadaAlternarSalas(){
  const c = chamada;
  if(!c) return;
  c.painelSalas = !c.painelSalas;
  c.painelDisp = false;
  c.volumeAberto = null;
  if(c.painelSalas) c.animarPainel = true;
  desenharChamada();
  if(c.painelSalas){
    const d = docChamada();
    const alvo = d.querySelector('.ch-sala[aria-current="true"]') || d.querySelector('.ch-sala');
    if(alvo) alvo.focus();
  }
}

function chamadaIrParaSala(sala){
  const c = chamada;
  if(!c) return;
  c.painelSalas = false;
  if(sala === c.sala){
    desenharChamada();
    const b = docChamada().getElementById('ch-btn-salas');
    if(b) b.focus();
    return;
  }
  trocarDeSalaChamada(sala);
}

function painelSalasHtml(c){
  const porSala = pessoasNasSalas(c.pid);
  const itens = salasDoProjeto(c.pid).map(s=>{
    const atual = s.id === c.sala;
    const gente = porSala[s.id] || [];
    const rostos = gente.slice(0, 3).map(x=>`<span class="ch-sala-rosto">${avatarChip(perfilNaChamada(c.pid, x.uid), nomeNaChamada(c.pid, x.uid)[0])}</span>`).join('');
    const mais = gente.length > 3 ? `<span class="ch-sala-mais">+${gente.length - 3}</span>` : '';
    const quem = gente.length ? `${gente.length} ${gente.length === 1 ? 'pessoa' : 'pessoas'}` : 'Vazia';
    return `
      <li>
        <button type="button" class="ch-sala ${atual ? 'atual' : ''}" data-sala="${esc(s.id)}" onclick="chamadaIrParaSala(this.dataset.sala)"${atual ? ' aria-current="true"' : ''} aria-label="${esc(`${s.nome}: ${atual ? 'você está aqui' : quem}`)}">
          <span class="ch-sala-icone" aria-hidden="true">${iconeChamada('volume', 16)}</span>
          <span class="ch-sala-texto">
            <span class="ch-sala-nome">${esc(s.nome)}</span>
            <span class="ch-sala-quem">${atual ? 'Você está aqui' : quem}</span>
          </span>
          ${gente.length ? `<span class="ch-sala-gente" aria-hidden="true">${rostos}${mais}</span>` : ''}
        </button>
      </li>`;
  }).join('');
  return `
    <div class="ch-salas" role="group" aria-labelledby="ch-salas-titulo">
      <p class="ch-salas-titulo" id="ch-salas-titulo">Salas de voz</p>
      <ul class="ch-salas-lista">${itens}</ul>
    </div>`;
}

/* --- chat dentro da chamada --- */

// O botão Chat, no alto da chamada aberta, abre à direita um canal de texto
// do projeto da chamada, como o chat de uma reunião: o último canal aberto
// no projeto, e um seletor para trocar. Usa as mesmas conversas, o mesmo
// tempo real e o mesmo envio da aba Canais, com ids próprios (ch-chat-*),
// porque a página do projeto pode estar atrás com a mesma conversa. O
// painel é um elemento só, que sobrevive aos redesenhos da chamada: o texto,
// o cursor e a rolagem ficam onde estavam.
let painelChatEl = null;

function canalDoChatDaChamada(c){
  if(!c) return null;
  const lista = canaisDeTexto(c.pid);
  return lista.find(x=>x.id === c.chatCanal) || canalAberto(c.pid) || lista[0] || null;
}

function chatDaChamadaVisivel(){
  const c = chamada;
  return !!c && !!c.chatAberto && c.modo === 'expandida' && !janelaFlutuante;
}

function chatDaChamadaMostra(canalId){
  if(!chatDaChamadaVisivel()) return false;
  const canal = canalDoChatDaChamada(chamada);
  return !!canal && canal.id === canalId;
}

function chamadaAlternarChat(){
  const c = chamada;
  if(!c) return;
  c.chatAberto = !c.chatAberto;
  c.painelSalas = false;
  c.painelDisp = false;
  if(c.chatAberto && !canaisCarregados && !canaisCarregando){
    carregarCanais().then(()=>{ if(chamada === c && c.chatAberto) montarPainelChat(); });
  }
  if(!c.chatAberto) painelChatEl = null;
  // O campo pode ainda não existir (mensagens carregando): o foco vai para
  // ele quando a conversa chegar (montarPainelChat).
  c.focarChat = c.chatAberto;
  desenharChamada();
  if(c.chatAberto){
    const campo = document.getElementById('ch-chat-input');
    if(campo){ campo.focus({preventScroll: true}); c.focarChat = false; }
    marcarLidoNaChamada();
  }else{
    const b = document.getElementById('ch-btn-chat');
    if(b) b.focus();
  }
}

function chamadaTrocarCanalChat(id){
  const c = chamada;
  if(!c || !CANAL_ID.test(id || '')) return;
  const canal = canaisDeTexto(c.pid).find(x=>x.id === id);
  if(!canal) return;
  c.chatCanal = canal.id;
  montarPainelChat();
  marcarLidoNaChamada();
  const campo = document.getElementById('ch-chat-input');
  if(campo) campo.focus({preventScroll: true});
}

// Monta (ou remonta) o conteúdo do painel: o topo com o canal, a lista e o
// campo. Mensagem nova não passa por aqui: troca só a lista
// (atualizarChatDaChamada).
function montarPainelChat(){
  const c = chamada;
  if(!c || !c.chatAberto) return null;
  if(!painelChatEl){
    painelChatEl = document.createElement('section');
    // A entrada anima uma vez, ao abrir; depois a classe sai, para o painel
    // não piscar quando a chamada se redesenha e ele volta para o lugar.
    painelChatEl.className = 'ch-chat abrindo';
    painelChatEl.setAttribute('aria-label', 'Chat do projeto');
    const el = painelChatEl;
    const tirar = ()=>el.classList.remove('abrindo');
    el.addEventListener('animationend', tirar, {once: true});
    setTimeout(tirar, 400);
  }
  const p = projetoDaChamada(c.pid);
  const canal = canalDoChatDaChamada(c);
  const textos = canaisDeTexto(c.pid);
  const fechar = `<button type="button" class="ch-botao ch-botao-leve ch-chat-fechar" onclick="chamadaAlternarChat()" aria-label="Fechar o chat" title="Fechar o chat">${iconeChamada('fechar', 16)}</button>`;
  let topo;
  if(canal && textos.length > 1){
    const opcoes = textos.map(t=>`<option value="${esc(t.id)}"${t.id === canal.id ? ' selected' : ''}>#${esc(t.nome)}${chatNaoLidasCanal[t.id] ? ` (${chatNaoLidasCanal[t.id]})` : ''}</option>`).join('');
    topo = `<label class="ch-chat-canal">${ICONE_CANAL_TEXTO}<span class="sr-only">Canal</span><select class="ch-chat-select" onchange="chamadaTrocarCanalChat(this.value)">${opcoes}</select></label>`;
  }else{
    topo = `<h3 class="ch-chat-canal">${ICONE_CANAL_TEXTO}<span>${canal ? esc(canal.nome) : 'Chat'}</span></h3>`;
  }
  let corpo;
  const conv = canal && state.chatProjeto[canal.id];
  if(!p || !canal){
    corpo = `<div class="chat-lista"><div class="chat-vazio">${canaisCarregados ? '<strong>Nenhum canal de texto.</strong>Quem edita o projeto cria os canais na aba Canais.' : 'Carregando os canais…'}</div></div>`;
  }else if(!conv){
    if(!chatCarregando.has(canal.id)) carregarChatCanal(canal);
    corpo = `<div class="chat-lista" role="status"><div class="chat-vazio">Carregando as mensagens…</div></div>`;
  }else if(conv.erro){
    corpo = `<div class="chat-lista"><div class="chat-vazio"><strong>Não deu para carregar as mensagens.</strong>${esc(conv.erro)}</div></div>`;
  }else{
    corpo = `
      <div class="chat-lista" id="ch-chat-lista" role="log" aria-live="polite" aria-label="${esc(`Mensagens de #${canal.nome}`)}" onscroll="rolagemChatDaChamada(this)">${renderListaChat(p, conv, canal)}</div>
      <form class="chat-escrever" onsubmit="event.preventDefault();enviarChatDaChamada()">
        ${canal.virtual ? '' : botaoFotoChat('ch-chat-input')}
        <textarea id="ch-chat-input" class="input chat-input" rows="1" maxlength="${CHAT_LIMITE_TEXTO}" placeholder="${esc(`Escreva em #${canal.nome}…`)}" aria-label="${esc(`Mensagem para #${canal.nome}`)}" oninput="rascunhoChatDaChamada(this)" onkeydown="teclaChatDaChamada(event)" onpaste="colarImagemChat(event,'ch-chat-input')">${esc(conv.rascunho)}</textarea>
        <button type="submit" class="btn-primary chat-enviar" id="ch-chat-enviar" aria-label="Enviar mensagem" title="Enviar (Enter)" ${conv.rascunho.trim() ? '' : 'disabled'}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>`;
  }
  painelChatEl.innerHTML = `<div class="ch-chat-topo">${topo}${fechar}</div>${corpo}`;
  const lista = painelChatEl.querySelector('#ch-chat-lista');
  if(lista && conv) requestAnimationFrame(()=>{ lista.scrollTop = lista.scrollHeight - lista.clientHeight - (conv.doFimChamada || 0); });
  const campo = painelChatEl.querySelector('#ch-chat-input');
  if(campo) requestAnimationFrame(()=>ajustarAlturaChat(campo));
  // Fora da chamada (ainda não desenhada) o painel entra no próximo desenho.
  const raiz = document.getElementById('chamada');
  if(raiz && chatDaChamadaVisivel() && painelChatEl.parentNode !== raiz) raiz.appendChild(painelChatEl);
  if(campo && c.focarChat && painelChatEl.isConnected){
    c.focarChat = false;
    requestAnimationFrame(()=>campo.focus({preventScroll: true}));
  }
  return painelChatEl;
}

// Mensagem nova ou apagada: troca só a lista. Quem estava no fim continua no
// fim; "mostrar anteriores" mantém a mensagem que estava em cima.
function atualizarChatDaChamada(canalId, manterTopo){
  if(!chatDaChamadaMostra(canalId)) return;
  const lista = document.getElementById('ch-chat-lista');
  const conv = state.chatProjeto[canalId];
  const p = projetoDaChamada(chamada.pid);
  const canal = canalDoChatDaChamada(chamada);
  if(!lista || !conv || !p || !canal){ montarPainelChat(); return; }
  const alturaAntes = lista.scrollHeight;
  const topoAntes = lista.scrollTop;
  lista.innerHTML = renderListaChat(p, conv, canal);
  if(manterTopo) lista.scrollTop = topoAntes + (lista.scrollHeight - alturaAntes);
  else lista.scrollTop = lista.scrollHeight - lista.clientHeight - (conv.doFimChamada || 0);
}

function rolagemChatDaChamada(lista){
  const canal = canalDoChatDaChamada(chamada);
  const conv = canal && state.chatProjeto[canal.id];
  if(!conv) return;
  const doFim = lista.scrollHeight - lista.clientHeight - lista.scrollTop;
  conv.doFimChamada = doFim < 40 ? 0 : doFim;
}

function rascunhoChatDaChamada(campo){
  const canal = canalDoChatDaChamada(chamada);
  const conv = canal && state.chatProjeto[canal.id];
  if(conv) conv.rascunho = campo.value;
  ajustarAlturaChat(campo);
  const b = document.getElementById('ch-chat-enviar');
  if(b) b.disabled = !campo.value.trim();
}

function teclaChatDaChamada(e){
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    enviarChatDaChamada();
  }
}

function enviarChatDaChamada(){
  const c = chamada;
  if(!c) return;
  const canal = canalDoChatDaChamada(c);
  const conv = canal && state.chatProjeto[canal.id];
  if(conv) conv.doFimChamada = 0;
  return enviarNoCanal(c.pid, canal, conv, 'ch-chat-input', 'ch-chat-enviar');
}

function marcarLidoNaChamada(){
  if(!chatDaChamadaVisivel()) return;
  const canal = canalDoChatDaChamada(chamada);
  if(canal) marcarCanalLido(chamada.pid, canal);
}

// O número de não lidas do projeto no botão Chat (com o chat fechado), sem
// redesenhar a chamada.
function seloChatHtml(c){
  const n = !c.chatAberto ? (chatNaoLidas[c.pid] || 0) : 0;
  return n ? `<span class="ch-chat-selo" aria-hidden="true">${rotuloNaoLidas(n)}</span>` : '';
}

function atualizarSeloChatDaChamada(){
  const c = chamada;
  const b = c && document.getElementById('ch-btn-chat');
  if(!b) return;
  const n = !c.chatAberto ? (chatNaoLidas[c.pid] || 0) : 0;
  const antigo = b.querySelector('.ch-chat-selo');
  if(antigo) antigo.remove();
  if(n) b.insertAdjacentHTML('beforeend', seloChatHtml(c));
  b.setAttribute('aria-label', n ? `Chat do projeto, ${n} não lida${n > 1 ? 's' : ''}` : 'Chat do projeto');
}

function chamadaDestacar(chave, e){
  if(e) e.stopPropagation();
  const c = chamada;
  if(!c || !chaveDaChamadaExiste(chave)) return;
  // Sozinho na chamada, não há o que destacar (ver desenharChamada).
  const ladrilhos = ladrilhosChamada();
  if(ladrilhos.length < 2){ c.destaque = null; return; }
  // Clicar no que está em destaque (escolhido ou a tela que entrou sozinha)
  // tira do destaque; a tela tirada não volta sozinha.
  const atual = destaqueDaChamada(c, ladrilhos);
  if(atual && atual.chave === chave){
    c.destaque = null;
    c.semDestaqueAuto = chave;
  }else c.destaque = chave;
  c.volumeAberto = null;
  desenharChamada();
}

// O que vai para o destaque: o que a pessoa escolheu ou, sem escolha, a
// tela que alguém está transmitindo, como no Meet. Com um quadro só, nada.
function destaqueDaChamada(c, ladrilhos){
  if(!c || ladrilhos.length < 2) return null;
  const escolhido = c.destaque && ladrilhos.find(l=>l.chave === c.destaque);
  if(escolhido) return escolhido;
  // A tela que a pessoa tirou do destaque parou de ser transmitida: na
  // próxima transmissão ela volta a entrar sozinha.
  if(c.semDestaqueAuto && !ladrilhos.some(l=>l.chave === c.semDestaqueAuto)) c.semDestaqueAuto = null;
  return ladrilhos.find(l=>l.tipo === 'tela' && l.chave !== c.semDestaqueAuto) || null;
}

// Colunas da grade pelo tamanho do palco, não só pela quantidade: com o chat
// aberto (palco estreito e alto), 2 quadros um embaixo do outro ficam bem
// maiores que lado a lado. Escolhe as colunas que dão o maior quadro (16:9,
// ou 4:3 no celular em pé) e fixa a largura da grade nessa conta.
function ajustarGradeChamada(raiz){
  const grade = raiz && raiz.querySelector('.ch-grade');
  const palco = grade && grade.parentElement;
  if(!grade || !palco) return;
  const n = grade.children.length;
  if(!n) return;
  const r = palco.getBoundingClientRect();
  const cs = getComputedStyle(palco);
  const larg = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const alt = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if(larg <= 0 || alt <= 0) return;
  const vao = parseFloat(getComputedStyle(grade).columnGap) || 12;
  const emPe = window.matchMedia && window.matchMedia('(max-width:900px) and (orientation:portrait)').matches;
  const proporcao = emPe ? 4 / 3 : 16 / 9;
  const larguras = [];
  for(let cols = 1; cols <= n; cols++){
    const linhas = Math.ceil(n / cols);
    larguras[cols] = Math.min((larg - (cols - 1) * vao) / cols, ((alt - (linhas - 1) * vao) / linhas) * proporcao);
  }
  // Menos colunas só quando o quadro cresce mais de 10%: com quadros quase do
  // mesmo tamanho, lado a lado aproveita melhor a largura do palco.
  const teto = Math.max(...larguras.slice(1));
  let melhor = 1;
  for(let cols = n; cols >= 1; cols--){ if(larguras[cols] >= teto * 0.9){ melhor = cols; break; } }
  const maior = larguras[melhor];
  grade.style.setProperty('--cols', melhor);
  grade.style.setProperty('--linhas', Math.ceil(n / melhor));
  grade.style.width = `${Math.floor(Math.min(larg, maior * melhor + (melhor - 1) * vao))}px`;
}

let ajusteGradePendente = null;
window.addEventListener('resize', ()=>{
  if(ajusteGradePendente) cancelAnimationFrame(ajusteGradePendente);
  ajusteGradePendente = requestAnimationFrame(()=>{
    ajusteGradePendente = null;
    if(chamada && chamada.modo === 'expandida') ajustarGradeChamada(docChamada().getElementById('chamada'));
  });
});

function chamadaTelaCheia(chave, e){
  if(e) e.stopPropagation();
  const el = document.querySelector(`.ch-ladrilho[data-chave="${chave}"]`);
  if(!el) return;
  if(document.fullscreenElement === el) document.exitFullscreen().catch(()=>{});
  else if(el.requestFullscreen) el.requestFullscreen().catch(()=>{});
}

function chamadaMinimizar(){
  const c = chamada;
  if(!c || c.modo === 'mini') return;
  // Dentro do samyest, minimizar é o cartão no canto da página. A janela
  // flutuante, por cima das outras abas e programas, é para quando a pessoa
  // sai: abre sozinha na troca de aba (ligarFlutuanteAutomatico) ou pelo
  // botão do cartão, e fecha quando ela volta para a aba.
  minimizarNaPagina(c);
}

function minimizarNaPagina(c){
  comTransicaoChamada(()=>{
    c.modo = 'mini';
    c.painelDisp = false;
    c.painelSalas = false;
    c.painelTela = false;
    c.volumeAberto = null;
    desenharChamada();
  }).then(()=>{
    const b = document.getElementById('ch-btn-expandir');
    if(b) b.focus();
  });
}

/* --- arrastar a chamada minimizada --- */
// O cartão da chamada minimizada se arrasta pela tela, pelo vídeo ou pela
// barra de baixo (os botões continuam botões), e fica onde foi solto. O
// lugar é guardado no aparelho como a distância até a borda direita e a de
// baixo, e volta para dentro da tela quando a janela muda de tamanho. Um
// arrasto não conta como clique: soltar não abre a chamada.
const MINI_MARGEM = 8;
let lugarDoMini = null;
let arrastoMini = null;
let ignorarCliqueMini = false;

try{
  const salvo = JSON.parse(localStorage.getItem('chamadaMiniLugar') || 'null');
  if(salvo && Number.isFinite(salvo.direita) && Number.isFinite(salvo.baixo)) lugarDoMini = {direita: salvo.direita, baixo: salvo.baixo};
}catch(e){}

// No celular, a barra de baixo do app fica livre.
function margemDeBaixoDoMini(){
  return telaDeCelular && telaDeCelular.matches ? 76 : MINI_MARGEM;
}

function lugarDentroDaTela(lugar, largura, altura){
  const maxDireita = Math.max(MINI_MARGEM, window.innerWidth - largura - MINI_MARGEM);
  const maxBaixo = Math.max(margemDeBaixoDoMini(), window.innerHeight - altura - MINI_MARGEM);
  return {
    direita: Math.round(Math.min(Math.max(lugar.direita, MINI_MARGEM), maxDireita)),
    baixo: Math.round(Math.min(Math.max(lugar.baixo, margemDeBaixoDoMini()), maxBaixo))
  };
}

function aplicarLugarDoMini(raiz, doc){
  const usar = !!lugarDoMini && doc === document && chamada && chamada.modo === 'mini';
  if(!usar){
    raiz.style.removeProperty('--mini-direita');
    raiz.style.removeProperty('--mini-baixo');
    return;
  }
  const r = raiz.getBoundingClientRect();
  const l = lugarDentroDaTela(lugarDoMini, r.width || 340, r.height || 240);
  raiz.style.setProperty('--mini-direita', `${l.direita}px`);
  raiz.style.setProperty('--mini-baixo', `${l.baixo}px`);
}

function iniciarArrastoMini(e){
  const raiz = e.target.closest && e.target.closest('#chamada');
  if(!raiz || raiz.dataset.modo !== 'mini' || raiz.classList.contains('na-janela') || janelaFlutuante) return;
  if(e.button > 0 || arrastoMini) return;
  // Os botões e campos continuam respondendo ao clique; o alvo transparente do
  // vídeo (que abre a chamada) é por onde mais se arrasta.
  if(e.target.closest('button:not(.ch-alvo), select, input, a')) return;
  const r = raiz.getBoundingClientRect();
  arrastoMini = {raiz, pointerId: e.pointerId, x: e.clientX, y: e.clientY, r, ativo: false};
  document.addEventListener('pointermove', moverArrastoMini);
  document.addEventListener('pointerup', soltarArrastoMini);
  document.addEventListener('pointercancel', soltarArrastoMini);
}

function moverArrastoMini(e){
  const a = arrastoMini;
  if(!a || e.pointerId !== a.pointerId) return;
  let dx = e.clientX - a.x, dy = e.clientY - a.y;
  if(!a.ativo){
    if(Math.hypot(dx, dy) < 5) return;
    a.ativo = true;
    a.raiz.classList.remove('assentando');
    a.raiz.classList.add('arrastando');
    try{ a.raiz.setPointerCapture(a.pointerId); }catch(err){}
  }
  // O cartão não sai da tela no meio do arrasto.
  dx = Math.min(Math.max(dx, MINI_MARGEM - a.r.left), window.innerWidth - MINI_MARGEM - a.r.right);
  dy = Math.min(Math.max(dy, MINI_MARGEM - a.r.top), window.innerHeight - margemDeBaixoDoMini() - a.r.bottom);
  a.dx = dx;
  a.dy = dy;
  a.raiz.style.transform = `translate(${dx}px, ${dy}px)`;
}

function soltarArrastoMini(e){
  const a = arrastoMini;
  if(!a || (e && e.pointerId !== a.pointerId)) return;
  document.removeEventListener('pointermove', moverArrastoMini);
  document.removeEventListener('pointerup', soltarArrastoMini);
  document.removeEventListener('pointercancel', soltarArrastoMini);
  arrastoMini = null;
  if(!a.ativo) return;
  ignorarCliqueMini = true;
  setTimeout(()=>{ ignorarCliqueMini = false; }, 0);
  const r = a.raiz.getBoundingClientRect();
  lugarDoMini = lugarDentroDaTela({direita: window.innerWidth - r.right, baixo: window.innerHeight - r.bottom}, r.width, r.height);
  try{ localStorage.setItem('chamadaMiniLugar', JSON.stringify(lugarDoMini)); }catch(err){}
  // Troca o deslocamento do arrasto pelo lugar novo sem pular.
  a.raiz.classList.remove('arrastando');
  a.raiz.style.setProperty('--mini-direita', `${lugarDoMini.direita}px`);
  a.raiz.style.setProperty('--mini-baixo', `${lugarDoMini.baixo}px`);
  a.raiz.style.transform = '';
}

document.addEventListener('pointerdown', iniciarArrastoMini);
document.addEventListener('click', (e)=>{
  if(ignorarCliqueMini && e.target.closest && e.target.closest('#chamada')){
    e.stopPropagation();
    e.preventDefault();
  }
}, true);
window.addEventListener('resize', ()=>{
  const raiz = document.getElementById('chamada');
  if(raiz && raiz.dataset.modo === 'mini') aplicarLugarDoMini(raiz, document);
});

function chamadaExpandir(){
  if(janelaFlutuante){ chamadaVoltarParaAba(); return; }
  const c = chamada;
  if(!c || c.modo === 'expandida') return;
  comTransicaoChamada(()=>{
    c.modo = 'expandida';
    desenharChamada();
  }).then(()=>{
    const b = document.getElementById('ch-btn-minimizar') || document.getElementById('ch-btn-flutuar');
    if(b) b.focus();
  });
}

document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape' || !chamada || e.defaultPrevented) return;
  if(topOpenModal() || document.fullscreenElement) return;
  // O Esc que fecha o seletor de tela do navegador pode chegar aqui também; não
  // é para minimizar a chamada.
  if(chamada.pedindoTela || Date.now() < (chamada.telaPedidaAte || 0)) return;
  if(chamada.painelTela){ fecharEscolhaTela(); return; }
  if(chamada.painelSalas){
    chamada.painelSalas = false;
    desenharChamada();
    const b = docChamada().getElementById('ch-btn-salas');
    if(b) b.focus();
  }else if(chamada.painelDisp || chamada.volumeAberto){
    const voltar = chamada.volumeAberto ? document.getElementById(`ch-vol-btn-${idVolume(chamada.volumeAberto)}`) : null;
    chamada.painelDisp = false;
    chamada.volumeAberto = null;
    desenharChamada();
    const b = voltar && document.getElementById(voltar.id);
    if(b) b.focus();
  }else if(chamada.chatAberto && chatDaChamadaVisivel()) chamadaAlternarChat();
  else if(chamada.modo === 'expandida') chamadaMinimizar();
});

// Com a escolha da tela aberta, o Tab fica dentro dela, como nos modais.
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Tab' || !chamada || !chamada.painelTela) return;
  const caixa = document.querySelector('#chamada .ch-dialogo');
  if(!caixa) return;
  const alvos = focusablesIn(caixa).filter(el=>!(el.type === 'radio' && !el.checked));
  if(!alvos.length) return;
  const primeiro = alvos[0], ultimo = alvos[alvos.length - 1];
  if(e.shiftKey && document.activeElement === primeiro){ e.preventDefault(); ultimo.focus(); }
  else if(!e.shiftKey && document.activeElement === ultimo){ e.preventDefault(); primeiro.focus(); }
  else if(!caixa.contains(document.activeElement)){ e.preventDefault(); primeiro.focus(); }
});

/* --- janela flutuante (Document Picture-in-Picture) --- */

// Como no Meet: a chamada sai numa janela pequena que fica por cima das
// outras abas e dos outros programas. É a própria janela da chamada,
// minimizada, movida para o documento da janela flutuante; os <audio>
// continuam na página. Abre pelo botão ou sozinha ao trocar de aba, onde o
// navegador permite. Só Chrome e Edge no computador têm a API. O estado fica
// em `janelaFlutuante`, declarada no topo do bloco da chamada.

function janelaFlutuanteSuportada(){
  return 'documentPictureInPicture' in window;
}

function docChamada(){
  return janelaFlutuante ? janelaFlutuante.win.document : document;
}

function docsChamada(){
  return janelaFlutuante ? [document, janelaFlutuante.win.document] : [document];
}

// origem: nada (o botão), 'auto' (troca de aba) ou 'tela' (junto com a
// transmissão). Só o botão avisa quando o navegador não abre.
async function abrirJanelaFlutuante(origem){
  const c = chamada;
  if(!c || janelaFlutuante || !janelaFlutuanteSuportada()) return false;
  let win;
  try{
    // A largura do cartão na página (340px). O Chrome desenha a barra dele
    // por cima disto, então a altura pedida já desconta essa barra, para a
    // janela inteira ficar do tamanho do cartão. Se a pessoa redimensionar, o
    // Chrome guarda o tamanho dela para a próxima vez.
    win = await window.documentPictureInPicture.requestWindow({width: 340, height: 216});
  }catch(e){
    if(!origem) showToast('O navegador não abriu a janela flutuante.', 'erro');
    return false;
  }
  if(chamada !== c || janelaFlutuante){ win.close(); return false; }
  // Aberta junto com a transmissão, mas a pessoa já desistiu do seletor.
  if(origem === 'tela' && !c.pedindoTela && !c.tela){ win.close(); return false; }
  adotarJanelaFlutuante(win, origem);
  return true;
}

// Leva a chamada para uma janela flutuante já aberta.
function adotarJanelaFlutuante(win, origem){
  const c = chamada;
  if(!c || janelaFlutuante){ try{ win.close(); }catch(e){} return; }
  prepararJanelaFlutuante(win);
  const raiz = document.getElementById('chamada');
  janelaFlutuante = {win, origem: origem || 'botao', auto: origem === 'auto', modoAntes: origem === 'minimizar' ? 'mini' : c.modo, voltarExpandida: false};
  c.modo = 'mini';
  c.painelDisp = false;
  c.painelSalas = false;
  c.painelTela = false;
  c.volumeAberto = null;
  if(raiz) win.document.body.appendChild(raiz);
  janelaFlutuante.raiz = raiz;
  win.addEventListener('pagehide', ()=>voltarDaJanelaFlutuante(win), {once: true});
  janelaFlutuante.vigia = setInterval(conferirJanelaFlutuante, 1000);
  trocarRelogioFala();
  desenharChamada();
}

// A janela flutuante nasce em branco: leva os estilos e o tema do app.
function prepararJanelaFlutuante(win){
  const d = win.document;
  ouvirModalidadeChamada(d);
  for(const folha of document.querySelectorAll('link[rel="stylesheet"], style')){
    let copia;
    if(folha.tagName === 'LINK'){
      copia = d.createElement('link');
      copia.rel = 'stylesheet';
      copia.href = folha.href;
    }else{
      copia = d.createElement('style');
      copia.textContent = folha.textContent;
    }
    d.head.appendChild(copia);
  }
  copiarTemaParaJanela(d);
  d.documentElement.lang = document.documentElement.lang || 'pt-BR';
  d.title = `Chamada · ${nomeDaChamada(chamada.pid, chamada.sala)}`;
}

// As cores do tema ficam no style do <html> (applyTheme) e o Vidro e o
// Grafite são classes do <body>: tudo isso vai junto para a flutuante.
function copiarTemaParaJanela(d){
  d.documentElement.className = document.documentElement.className;
  d.documentElement.style.cssText = document.documentElement.style.cssText;
  const tema = document.documentElement.getAttribute('data-theme');
  if(tema !== null) d.documentElement.setAttribute('data-theme', tema);
  d.body.className = `${document.body.className} corpo-flutuante`;
}

// Os onclick do HTML da chamada rodam no escopo global da janela onde o
// elemento está. Na flutuante, as funções do app precisam existir lá também.
function exporFuncoesNaJanela(win, html){
  for(const atributo of html.matchAll(/\son[a-z]+="([^"]*)"/g)){
    for(const chamadaJs of atributo[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)){
      const nome = chamadaJs[1];
      if(typeof window[nome] === 'function' && win[nome] !== window[nome]) win[nome] = window[nome];
    }
  }
}

// Fechou a flutuante (pelo X, pelo "voltar para a aba" do navegador ou pelo
// nosso): a janela da chamada volta para a página, no modo em que estava.
function voltarDaJanelaFlutuante(win){
  const j = janelaFlutuante;
  if(!j || j.win !== win) return;
  janelaFlutuante = null;
  clearInterval(j.vigia);
  trocarRelogioFala();
  // O documento da flutuante pode já ter ido embora (fechada sem o pagehide
  // chegar, ou no meio dele): nada aqui pode falhar, senão a chamada ficava
  // presa numa janela que não existe mais e sumia da página.
  let raiz = j.raiz;
  if(!raiz){ try{ raiz = win.document.getElementById('chamada'); }catch(e){} }
  const c = chamada;
  if(!c){ try{ if(raiz) raiz.remove(); }catch(e){} desenharAvisoFlutuante(); return; }
  try{ if(raiz) document.body.appendChild(raiz); }
  catch(e){ try{ raiz.remove(); }catch(e2){} }
  c.modo = j.modoVolta || (j.voltarExpandida ? 'expandida' : j.modoAntes);
  desenharChamada();
}

// Confere se a flutuante ainda está de pé com a chamada dentro. Roda a cada
// segundo enquanto ela existe, ao voltar para a aba e quando a página ganha
// foco; se ela sumiu sem avisar, a chamada volta para a página.
function conferirJanelaFlutuante(){
  const j = janelaFlutuante;
  if(!j) return;
  let aberta = false;
  try{ aberta = !j.win.closed && !!j.raiz && j.win.document.body.contains(j.raiz); }catch(e){}
  if(!aberta) voltarDaJanelaFlutuante(j.win);
}

// "Trazer para cá" do aviso na página: a chamada volta minimizada no canto.
function chamadaTrazerParaPagina(){
  const j = janelaFlutuante;
  if(!j) return;
  j.modoVolta = 'mini';
  try{ j.win.close(); }catch(e){}
  setTimeout(conferirJanelaFlutuante, 300);
}

// Enquanto a chamada está na flutuante, a página mostra no canto, no lugar da
// janela minimizada, só o caminho de volta. Nome e relógio já estão na
// própria flutuante, que fica por cima de tudo; aqui eles vão só para o
// leitor de tela.
function desenharAvisoFlutuante(){
  let el = document.getElementById('chamada-na-flutuante');
  if(!janelaFlutuante || !chamada){ if(el) el.remove(); return; }
  const p = projetoDaChamada(chamada.pid);
  const nome = p ? nomeDaChamada(chamada.pid, chamada.sala) : 'Chamada';
  const texto = `${nome}, na janela flutuante`;
  const html = `
    <span class="ch-ponto" aria-hidden="true"></span>
    <span class="sr-only ch-na-flutuante-texto">${esc(texto)}</span>
    <button type="button" class="ch-na-flutuante-btn" id="ch-btn-trazer" onclick="chamadaTrazerParaPagina()" aria-label="Trazer a chamada para cá">Trazer para cá</button>`;
  if(!el){
    el = document.createElement('div');
    el.id = 'chamada-na-flutuante';
    el.className = 'ch-na-flutuante';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    el.innerHTML = html;
  }else if(!el.querySelector('#ch-btn-trazer')) el.innerHTML = html;
  else{
    // Trocar de sala muda o nome; o botão fica, para não perder o foco.
    const leitor = el.querySelector('.ch-na-flutuante-texto');
    if(leitor && leitor.textContent !== texto) leitor.textContent = texto;
  }
  try{ janelaFlutuante.win.document.title = `Chamada · ${nome}`; }catch(e){}
}

function chamadaVoltarParaAba(){
  const j = janelaFlutuante;
  if(!j) return;
  j.voltarExpandida = true;
  try{ window.focus(); }catch(e){}
  j.win.close();
}

// Troca de aba com a chamada aberta: o navegador oferece abrir a flutuante
// sozinho (Chrome 134+, e a pessoa pode desligar). Ao voltar para a aba, a
// flutuante fecha, a que abriu sozinha e a que a pessoa abriu pelo botão:
// dentro do samyest a chamada fica na página (o cartão no canto, ou aberta
// se estava aberta), e fora dele fica na flutuante.
function ligarFlutuanteAutomatico(){
  if(!janelaFlutuanteSuportada() || !('mediaSession' in navigator)) return;
  try{ navigator.mediaSession.setActionHandler('enterpictureinpicture', ()=>abrirJanelaFlutuante('auto')); }catch(e){}
}

function desligarFlutuanteAutomatico(){
  if(!('mediaSession' in navigator)) return;
  try{ navigator.mediaSession.setActionHandler('enterpictureinpicture', null); }catch(e){}
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState !== 'visible' || !janelaFlutuante) return;
  try{ janelaFlutuante.win.close(); }catch(e){}
  conferirJanelaFlutuante();
});
window.addEventListener('focus', ()=>conferirJanelaFlutuante());

// Anel de foco só para quem usa o teclado. Depois de cada clique a chamada se
// redesenha e devolve o foco ao botão clicado; o navegador às vezes trata esse
// foco devolvido como de teclado e mostrava o anel branco em quem usa mouse.
// Clique (ou toque) liga "via-ponteiro", que esconde o anel; Tab, setas,
// Enter ou espaço desligam.
let chamadaViaPonteiro = false;
function ouvirModalidadeChamada(doc){
  const marcar = (viaPonteiro)=>{
    if(chamadaViaPonteiro === viaPonteiro) return;
    chamadaViaPonteiro = viaPonteiro;
    const raiz = chamada && docChamada().getElementById('chamada');
    if(raiz) raiz.classList.toggle('via-ponteiro', viaPonteiro);
  };
  doc.addEventListener('pointerdown', ()=>marcar(true), true);
  doc.addEventListener('keydown', (e)=>{ if(e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) marcar(false); }, true);
}
ouvirModalidadeChamada(document);

/* --- desenho da janela --- */

function chaveDaChamadaExiste(chave){
  return ladrilhosChamada().some(l=>l.chave === chave);
}

// Um ladrilho por pessoa (câmera ou foto) e um por tela transmitida (Q26).
function ladrilhosChamada(){
  const c = chamada;
  if(!c) return [];
  const eu = session.user.id;
  const pessoas = [
    {uid: eu, mic: c.mic && !!c.local.voz, ensurdecido: c.ensurdecido, camera: c.camera, tela: c.tela, telaSom: !!(c.tela && c.local.telaAudio)},
    ...c.participantes.values()
  ];
  const lista = [];
  for(const p of pessoas){
    lista.push({chave: `${p.uid}:cam`, uid: p.uid, tipo: 'cam', p});
    if(p.tela) lista.push({chave: `${p.uid}:tela`, uid: p.uid, tipo: 'tela', p});
  }
  return lista;
}

function faixaDeVideoChamada(chave){
  const c = chamada;
  if(!c) return null;
  const [uid, tipo] = chave.split(':');
  if(uid === session.user.id) return tipo === 'tela' ? c.local.tela : (c.camera ? c.local.cam : null);
  const par = c.pares.get(uid);
  const p = c.participantes.get(uid);
  if(!par || !p || (tipo === 'tela' ? !p.tela : !p.camera)) return null;
  const t = par.remotas[tipo];
  return t && t.readyState === 'live' ? t : null;
}

function videoDaChamada(chave){
  const t = faixaDeVideoChamada(chave);
  if(!t) return null;
  let v = chamadaVideos[chave];
  if(!v){
    v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    marcarVideoQuandoPronto(v);
    chamadaVideos[chave] = v;
  }
  const atual = v.srcObject && v.srcObject.getVideoTracks()[0];
  if(atual !== t) v.srcObject = new MediaStream([t]);
  const tela = chave.endsWith(':tela');
  v.className = 'ch-video' + (tela ? ' tela' : '') + (chave === `${session.user.id}:cam` ? ' espelho' : '') + (v.dataset.pronto ? ' pronto' : '');
  v.play().catch(()=>{});
  return v;
}

// O vídeo aparece com um fade quando chega o primeiro quadro; até lá, o que
// se vê é a foto da pessoa, por baixo dele, e não um quadro preto. Se o
// navegador não avisar pelos eventos, uma conferência a cada 300 ms vê quando
// o vídeo ganhou tamanho (o primeiro quadro foi decodificado). Antes ele
// aparecia de qualquer jeito depois de 1,5 s: preto, se nada tivesse chegado.
function marcarVideoQuandoPronto(v){
  const pronto = ()=>{ v.dataset.pronto = '1'; v.classList.add('pronto'); };
  v.addEventListener('loadeddata', pronto, {once: true});
  v.addEventListener('playing', pronto, {once: true});
  const espia = setInterval(()=>{
    if(v.videoWidth > 0) pronto();
    if(v.dataset.pronto || !Object.values(chamadaVideos).includes(v)) clearInterval(espia);
  }, 300);
}

// Troca de modo com a View Transition do navegador: o palco encolhe até a
// janela do canto e ela cresce de volta, no lugar de trocar de uma vez. Sem
// suporte, ou com movimento reduzido, troca direto.
// Enquanto uma View Transition está em andamento, a página não recebe clique.
// Sem foco (o seletor de tela do navegador aberto ou fechando, outra janela na
// frente) ou com a aba escondida, o navegador pode não desenhar o quadro que
// a transição espera, e ela ficava parada: o site travava até trocar de aba,
// que é quando o navegador a pula. Nesses casos troca direto, e uma transição
// que passe de 1,5 s (a mais longa dura 0,4 s) é pulada.
function comTransicaoChamada(mudar){
  const reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!document.startViewTransition || reduzir || janelaFlutuante || document.visibilityState !== 'visible' || !document.hasFocus()){ mudar(); return Promise.resolve(); }
  try{
    const t = document.startViewTransition(mudar);
    // Uma transição nova no meio de outra faz o navegador pular a antiga e
    // rejeitar as promessas dela; não é erro, só não anima.
    t.ready.catch(()=>{});
    t.finished.catch(()=>{});
    const vigia = setTimeout(()=>{ try{ t.skipTransition(); }catch(e){} }, 1500);
    t.finished.then(()=>clearTimeout(vigia), ()=>clearTimeout(vigia));
    return t.updateCallbackDone.catch(()=>{});
  }catch(e){
    mudar();
    return Promise.resolve();
  }
}

function estadoDoLadrilho(uid){
  const c = chamada;
  if(uid === session.user.id) return '';
  const par = c.pares.get(uid);
  const st = par ? par.pc.connectionState : 'new';
  if(st === 'connected') return '';
  if(st === 'failed') return c.semTurn ? 'Não conectou: esta rede pede o servidor de apoio (TURN), que não está configurado.' : 'Reconectando…';
  if(st === 'disconnected') return 'Reconectando…';
  // Depois de duas tentativas da vigia, diz que está tentando de novo e, sem
  // TURN, a causa mais provável.
  if(tentativasDeConexao(uid) >= 2){
    return c.semTurn ? 'Ainda não conectou. Esta rede pode precisar do servidor de apoio (TURN), que não está configurado. Tentando de novo…' : 'Ainda não conectou. Tentando de novo…';
  }
  return 'Conectando…';
}

function ladrilhoChamadaHtml(l, opts){
  const c = chamada;
  const o = opts || {};
  const eu = l.uid === session.user.id;
  const nome = nomeNaChamada(c.pid, l.uid);
  const comVideo = !!faixaDeVideoChamada(l.chave);
  const tela = l.tipo === 'tela';
  const rotulo = tela ? (eu ? 'Sua tela' : `Tela de ${nome}`) : (eu ? `${nome} (você)` : nome);
  const estado = tela ? '' : estadoDoLadrilho(l.uid);
  const destacado = (c.destaqueAtual || null) === l.chave;
  // Volume de cada um, só para mim: a voz no ladrilho da pessoa e o som da
  // transmissão no ladrilho da tela, quando ela vem com som.
  const chaveVol = eu || o.mini ? null : tela ? (l.p.telaSom ? `${l.uid}:tela` : null) : l.uid;
  const aVol = chaveVol ? ajusteDeVolume(chaveVol) : null;
  const silenciado = chaveVol && aVol.mudo ? `<span class="ch-rotulo-icone" title="Silenciado para você">${iconeChamada('volumeOff', 14)}</span>` : '';
  // Silenciado por um moderador (ou sem poder falar na sala de silêncio):
  // aparece assim mesmo que o app da pessoa diga que o microfone está aberto.
  const semVoz = !tela && !podeFalarNaSala(c.pid, c.sala, l.uid);
  const icones = (!tela ? `${semVoz ? `<span class="ch-rotulo-icone moderado" title="${silenciadoPeloModerador(c.pid, l.uid) ? 'Silenciado por um moderador' : 'Sala de silêncio'}">${iconeChamada('micOff', 14)}</span>`
    : l.p.ensurdecido ? `<span class="ch-rotulo-icone" title="Ensurdecido">${iconeChamada('foneOff', 14)}</span>` : (!l.p.mic ? `<span class="ch-rotulo-icone" title="Microfone fechado">${iconeChamada('micOff', 14)}</span>` : '')}` : '') + silenciado;
  const volAberto = !!chaveVol && c.volumeAberto === chaveVol;
  const rotuloVol = tela ? 'Som da tela' : 'Volume';
  const volume = chaveVol ? `
      <button type="button" class="ch-acao ${aVol.mudo ? 'silenciado' : ''}" id="ch-vol-btn-${idVolume(chaveVol)}" data-volume-botao onclick="chamadaAbrirVolume('${chaveVol}', event)" aria-expanded="${volAberto}" aria-label="${rotuloVol} de ${esc(nome)}: ${textoVolume(aVol)}"${volAberto ? '' : ` title="${rotuloVol}"`}>${iconeChamada(aVol.mudo ? 'volumeOff' : 'volume', 15)}</button>` : '';
  let painelVolume = '';
  if(volAberto){
    const id = idVolume(chaveVol);
    const max = volumeMaximoChamada();
    const pct = Math.min(max, Math.round(aVol.v * 100));
    const quem = tela ? `a tela de ${nome}` : nome;
    painelVolume = `
      <div class="ch-volume ${aVol.mudo ? 'mudo' : ''}" role="group" aria-labelledby="ch-vol-titulo-${id}">
        <div class="ch-volume-topo">
          <span class="ch-volume-titulo" id="ch-vol-titulo-${id}">${esc(tela ? `Som da tela de ${nome}` : nome)}</span>
          <span class="ch-volume-valor" id="ch-vol-valor-${id}" aria-hidden="true">${textoVolume(aVol)}</span>
        </div>
        <div class="ch-volume-linha">
          <button type="button" class="ch-volume-mudo" id="ch-vol-mudo-${id}" onclick="chamadaSilenciar('${chaveVol}')" aria-pressed="${aVol.mudo}" aria-label="Silenciar ${esc(quem)} para você" title="Silenciar para você">${iconeChamada(aVol.mudo ? 'volumeOff' : 'volume', 16)}</button>
          <span class="ch-volume-trilho">
            ${max > 100 ? '<span class="ch-volume-marca" aria-hidden="true"></span>' : ''}
            <input type="range" class="ch-volume-barra" id="ch-vol-${id}" min="0" max="${max}" step="5" value="${pct}" style="--f:${pct / max};--m:${100 / max}" aria-label="Volume de ${esc(quem)}" aria-valuetext="${textoVolume(aVol)}" oninput="chamadaVolume('${chaveVol}', this.value)" onchange="desenharChamada()">
          </span>
        </div>
        <div class="ch-volume-pe">
          <span>Só para você</span>
          <button type="button" class="ch-volume-redefinir" id="ch-vol-redefinir-${id}" onclick="chamadaRedefinirVolume('${chaveVol}')"${pct === 100 ? ' hidden' : ''}>Voltar a 100%</button>
        </div>
        ${tela ? '' : moderacaoNaChamadaHtml(c, l.uid, nome)}
      </div>`;
  }
  // O ladrilho inteiro é um botão (transparente, por baixo do nome e das
  // ações) que põe ou tira do destaque.
  // o.voz: a sala só de voz em fotos grandes (layoutSoVoz), sem vídeo e sem
  // destaque; a pessoa é a foto com o nome embaixo, e microfone fechado,
  // ensurdecido e silenciado viram um selo no canto da foto, para o nome
  // ficar centrado.
  return `
    <div class="ch-ladrilho ${o.voz ? 'voz' : ''} ${tela ? 'tela' : ''} ${comVideo ? 'com-video' : ''} ${destacado ? 'destacado' : ''} ${eu ? 'eu' : ''}" data-chave="${l.chave}" ${tela ? '' : `data-fala="${l.uid}"`}>
      <div class="ch-ladrilho-avatar">${tela ? iconeChamada('tela', 40) : avatarChip(perfilNaChamada(c.pid, l.uid), nome[0])}${o.voz && icones ? `<span class="ch-voz-selos">${icones}</span>` : ''}</div>
      <div class="ch-ladrilho-video" data-slot="${l.chave}"></div>
      ${o.mini || o.voz || o.semDestaque ? '' : `<button type="button" class="ch-alvo" id="ch-destacar-${l.chave.replace(':', '-')}" onclick="chamadaDestacar('${l.chave}')" aria-pressed="${destacado}" aria-label="${destacado ? 'Tirar do destaque' : 'Pôr em destaque'}: ${esc(rotulo)}"></button>`}
      ${o.semRotulo ? '' : `<div class="ch-rotulo">${o.voz ? '' : icones}<span class="ch-rotulo-nome">${tela ? esc(rotulo) : `${nomePessoaHtml(perfilNaChamada(c.pid, l.uid), nome)}${eu ? ' (você)' : ''}`}</span></div>`}
      ${estado ? `<div class="ch-estado">${esc(estado)}</div>` : ''}
      ${o.mini ? '' : `<div class="ch-ladrilho-acoes">
        ${volume}
        ${comVideo ? `<button type="button" class="ch-acao" onclick="chamadaTelaCheia('${l.chave}', event)" aria-label="Tela cheia: ${esc(rotulo)}" title="Tela cheia">${iconeChamada('telaCheia', 15)}</button>` : ''}
      </div>`}
      ${painelVolume}
    </div>`;
}

// Moderação no quadro da pessoa, junto do volume: vale para todos, e só
// aparece com a permissão do cargo (SEC-087).
function moderacaoNaChamadaHtml(c, uid, nome){
  if(uid === session.user.id || !podeModerar(c.pid, uid)) return '';
  const partes = [];
  const sufixo = uid.slice(0, 8);
  if(podeModerar(c.pid, uid, 'silenciar')){
    const sil = silenciadoPeloModerador(c.pid, uid);
    partes.push(`<button type="button" class="ch-moderar-btn ${sil ? 'ativo' : ''}" id="ch-mod-sil-${sufixo}" onclick="moderarVoz('${c.pid}','${uid}','${sil ? 'liberar' : 'silenciar'}')">${iconeChamada(sil ? 'mic' : 'micOff', 15)}<span>${sil ? 'Liberar o microfone' : 'Silenciar nas salas'}</span></button>`);
  }
  if(podeModerar(c.pid, uid, 'mover')){
    const outras = salasDoProjeto(c.pid).filter(s=>s.id !== c.sala && CHAMADA_UUID.test(s.id) && pessoaVeCanal(c.pid, s, uid));
    if(outras.length) partes.push(`<select class="ch-moderar-mover" id="ch-mod-mover-${sufixo}" aria-label="${esc(`Mover ${nome} para outra sala`)}" onchange="if(this.value)moderarVoz('${c.pid}','${uid}','mover',this.value)"><option value="">Mover para…</option>${outras.map(s=>`<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select>`);
    partes.push(`<button type="button" class="ch-moderar-btn perigo" id="ch-mod-sair-${sufixo}" onclick="moderarVoz('${c.pid}','${uid}','desconectar')">${iconeChamada('sair', 15)}<span>Desconectar</span></button>`);
  }
  return `<div class="ch-moderar" role="group" aria-label="${esc(`Moderar ${nome}, para todos`)}"><span class="ch-moderar-titulo">Para todos</span>${partes.join('')}</div>`;
}

// Troca de estado dos botões (microfone, fone, câmera, tela, dispositivos). A
// chamada se redesenha a cada mudança e o botão nasce de novo, então uma
// transição de CSS não teria de onde partir: a troca era seca. Aqui cada
// botão guarda o estado em que estava; quando ele muda, o botão novo nasce
// com "trocou": a cor sai da do estado anterior (--ch-de), o ícone novo entra
// girando e um anel se espalha uma vez. Um redesenho no meio continua a
// animação de onde ela estava (--ch-atraso negativo), em vez de recomeçar.
const CHAMADA_TROCA_MS = 520;
const COR_DO_ESTADO = {'': 'var(--ch-botao)', desligado: 'var(--ch-desligado)', ativo: 'var(--ch-ativo)'};
const estadosDosBotoes = {};

function botaoChamada(id, acao, icone, rotulo, classe, pressionado){
  const cl = classe || '';
  const agora = Date.now();
  const antes = estadosDosBotoes[id];
  if(!antes) estadosDosBotoes[id] = {icone, classe: cl, de: '', desde: 0};
  else if(antes.icone !== icone || antes.classe !== cl) estadosDosBotoes[id] = {icone, classe: cl, de: antes.classe, desde: agora};
  const e = estadosDosBotoes[id];
  const passou = agora - e.desde;
  const trocando = e.desde && passou < CHAMADA_TROCA_MS;
  const estilo = trocando ? ` style="--ch-de:${COR_DO_ESTADO[e.de] || COR_DO_ESTADO['']};--ch-atraso:-${passou}ms"` : '';
  return `<button type="button" id="${id}" class="ch-botao ${cl}${trocando ? ' trocou' : ''}"${estilo} onclick="${acao}" aria-label="${rotulo}" title="${rotulo}"${pressionado === undefined ? '' : ` aria-pressed="${pressionado}"`}>${iconeChamada(icone)}</button>`;
}

function controlesChamadaHtml(mini){
  const c = chamada;
  const micAberto = c.mic && !!c.local.voz;
  // Silenciado por um moderador ou na sala de silêncio: o botão fica fechado
  // e diz por quê (RFC 0005).
  const travado = !micAberto && micTravadoNaSala(c.pid, c.sala);
  const rotuloMic = travado ? (silenciadoPeloModerador(c.pid, session.user.id) ? 'Silenciado por um moderador' : 'Sala de silêncio: microfone fechado')
    : micAberto ? 'Fechar o microfone' : 'Abrir o microfone';
  const partes = [
    botaoChamada(mini ? 'ch-btn-mic-mini' : 'ch-btn-mic', 'chamadaAlternarMic()', micAberto ? 'mic' : 'micOff', rotuloMic, micAberto ? '' : (travado ? 'desligado travado' : 'desligado'), !micAberto),
    botaoChamada(mini ? 'ch-btn-fone-mini' : 'ch-btn-fone', 'chamadaAlternarEnsurdecer()', c.ensurdecido ? 'foneOff' : 'fone', c.ensurdecido ? 'Voltar a ouvir' : 'Ensurdecer', c.ensurdecido ? 'desligado' : '', c.ensurdecido)
  ];
  // Na chamada aberta, três grupos separados por um fio: o que eu falo e
  // ouço, o que eu mostro, e sair.
  const divisor = '<span class="ch-divisor" aria-hidden="true"></span>';
  if(!mini){
    partes.push(divisor);
    partes.push(botaoChamada('ch-btn-cam', 'chamadaAlternarCamera()', c.camera ? 'cam' : 'camOff', c.camera ? 'Desligar a câmera' : 'Ligar a câmera', c.camera ? '' : 'desligado', !c.camera));
    if(telaSuportada()) partes.push(botaoChamada('ch-btn-tela', 'chamadaAlternarTela()', 'tela', c.tela ? 'Parar de transmitir a tela' : 'Transmitir a tela', c.tela ? 'ativo' : '', c.tela));
    partes.push(botaoChamada('ch-btn-disp', 'chamadaAlternarDispositivos()', 'ajustes', 'Microfone, câmera e alto-falante', c.painelDisp ? 'ativo' : '', c.painelDisp));
    partes.push(divisor);
  }else{
    // Minimizada, a câmera fica à mão, no lugar do botão da janela flutuante
    // (que foi para o topo da chamada aberta). Na flutuante não há "abrir": a
    // volta para a aba já está no ⇱ que o Chrome põe na barra da janela, e o
    // clique no vídeo faz o mesmo.
    partes.push(botaoChamada('ch-btn-cam-mini', 'chamadaAlternarCamera()', c.camera ? 'cam' : 'camOff', c.camera ? 'Desligar a câmera' : 'Ligar a câmera', c.camera ? '' : 'desligado', !c.camera));
    if(!janelaFlutuante) partes.push(botaoChamada('ch-btn-expandir', 'chamadaExpandir()', 'expandir', 'Abrir a chamada', ''));
  }
  partes.push(`<button type="button" id="${mini ? 'ch-btn-sair-mini' : 'ch-btn-sair'}" class="ch-sair" onclick="chamadaSair()" aria-label="Sair da chamada" title="Sair da chamada">${iconeChamada('sair')}${mini ? '' : '<span>Sair</span>'}</button>`);
  return partes.join('');
}

// Celular em pé: uma coluna até 2 ladrilhos e no máximo 2 colunas depois.
function videosDoMini(){
  const c = chamada;
  const eu = session.user.id;
  const ladrilhos = ladrilhosChamada();
  const outros = [];
  const pegar = (k)=>{ if(k && !outros.includes(k) && !k.startsWith(`${eu}:`) && faixaDeVideoChamada(k)) outros.push(k); };
  pegar(c.destaque);
  ladrilhos.filter(l=>l.tipo === 'tela').forEach(l=>pegar(l.chave));
  ladrilhos.filter(l=>l.tipo === 'cam').forEach(l=>pegar(l.chave));
  return {outros: outros.slice(0, 4), minha: faixaDeVideoChamada(`${eu}:cam`) ? `${eu}:cam` : null};
}

function colunasDaGrade(n){
  if(window.matchMedia && window.matchMedia('(max-width:900px) and (orientation:portrait)').matches) return n <= 2 ? 1 : 2;
  if(n <= 1) return 1;
  if(n <= 4) return 2;
  if(n <= 6) return 3;
  if(n <= 12) return 4;
  return 5;
}

// Sala só de voz (ninguém com câmera nem tela): 'fotos' mostra cada pessoa
// como a foto grande com o nome embaixo, como numa sala de voz; 'quadros'
// mantém a grade de quadros 16:9 da chamada com vídeo.
let layoutSoVoz = 'fotos';

// O que fica atrás da chamada aberta fica inerte, para o Tab e o leitor de
// tela não andarem pelo que não se vê. No computador a barra lateral continua
// à mostra e usável, e só o conteúdo (#main) fica inerte; no celular a
// chamada cobre tudo, e o #app inteiro fica. Os modais ficam fora do #app e
// continuam usáveis por cima da chamada.
const telaDeCelular = window.matchMedia ? window.matchMedia('(max-width:900px)') : null;

function travarAppAtrasDaChamada(){
  const app = document.getElementById('app');
  const main = document.getElementById('main');
  if(!app || !main) return;
  const aberta = !!chamada && chamada.modo === 'expandida' && !janelaFlutuante;
  const celular = !!(telaDeCelular && telaDeCelular.matches);
  const appInerte = aberta && celular;
  const mainInerte = aberta && !celular;
  if(app.inert !== appInerte) app.inert = appInerte;
  if(main.inert !== mainInerte) main.inert = mainInerte;
}
if(telaDeCelular && telaDeCelular.addEventListener) telaDeCelular.addEventListener('change', ()=>travarAppAtrasDaChamada());

// Com a chamada aberta e a barra lateral à mostra, ir para outra tela pela
// barra (outra visão, projeto ou meta) minimiza a chamada no canto, para a
// pessoa ver o que abriu, como no Discord. O que não muda de tela (Nova meta,
// Configurações, a frase do dia) abre por cima e deixa a chamada como está.
function lugarNoApp(){
  return [state.view, state.currentProjectId || '', state.metas && state.metas.atual || ''].join('|');
}

// Clicar no lugar em que já se está (o projeto da chamada, por exemplo) também
// minimiza: a pessoa quer ver a tela que ficou atrás da chamada, na aba e no
// canal em que ela estava. Antes esse clique não fazia nada (RFC 0005, Q16).
document.addEventListener('click', (e)=>{
  const c = chamada;
  if(!c || c.modo !== 'expandida' || janelaFlutuante) return;
  if(!e.target.closest || !e.target.closest('#app aside')) return;
  const antes = lugarNoApp();
  const navegou = !!e.target.closest('.sidebar-project-item, .nav-item');
  setTimeout(()=>{
    if(chamada === c && c.modo === 'expandida' && (navegou || lugarNoApp() !== antes)) minimizarNaPagina(c);
  }, 0);
}, true);

function desenharChamada(){
  const c = chamada;
  desenharAvisoFlutuante();
  travarAppAtrasDaChamada();
  const doc = docChamada();
  let raiz = doc.getElementById('chamada');
  if(!c){ painelChatEl = null; if(raiz) raiz.remove(); return; }
  if(!raiz){
    raiz = doc.createElement('section');
    raiz.id = 'chamada';
    raiz.className = 'chamada';
    doc.body.appendChild(raiz);
  }
  raiz.classList.toggle('na-janela', doc !== document);
  raiz.classList.toggle('via-ponteiro', chamadaViaPonteiro);
  if(janelaFlutuante && doc !== document) janelaFlutuante.raiz = raiz;
  const p = projetoDaChamada(c.pid);
  // Com várias salas, o nome da sala vem na frente do projeto.
  const nomeProjeto = p ? nomeDaChamada(c.pid, c.sala) : 'Projeto';
  // No cartão pequeno não cabe "Sala 1 · Projeto": com várias salas vai só a
  // sala (o nome inteiro fica no title), com uma só vai o projeto.
  const nomeCurto = p && salasDoProjeto(c.pid).length > 1 ? nomeDaSala(c.pid, c.sala) : (p ? p.name : 'Projeto');
  raiz.dataset.modo = c.modo;
  aplicarLugarDoMini(raiz, doc);
  raiz.setAttribute('aria-label', `Chamada em ${nomeProjeto}`);
  const foco = doc.activeElement && raiz.contains(doc.activeElement) ? doc.activeElement.id : null;
  const ladrilhos = ladrilhosChamada();
  const pessoas = 1 + c.participantes.size;
  let html;

  if(c.modo === 'mini'){
    // Minimizada, a câmera de quem estiver com ela ligada continua aparecendo:
    // os vídeos dos outros em grade (até 4, o destaque e as telas primeiro) e
    // a própria câmera num quadro no canto, ou ocupando tudo se for o único
    // vídeo. Sem vídeo nenhum, as fotos de todos.
    const {outros, minha} = videosDoMini();
    const porChave = (k)=>ladrilhos.find(l=>l.chave === k);
    let palco;
    if(outros.length){
      palco = `<div class="ch-mini-grade n-${outros.length}">${outros.map(k=>ladrilhoChamadaHtml(porChave(k), {mini: true})).join('')}</div>`
        + (minha ? `<div class="ch-mini-eu">${ladrilhoChamadaHtml(porChave(minha), {mini: true, semRotulo: true})}</div>` : '');
    }else if(minha){
      palco = ladrilhoChamadaHtml(porChave(minha), {mini: true});
    }else{
      palco = `<div class="ch-mini-pessoas">${ladrilhos.filter(l=>l.tipo === 'cam').map(l=>`<span class="ch-mini-pessoa" data-fala="${l.uid}" title="${esc(nomeNaChamada(c.pid, l.uid))}">${avatarChip(perfilNaChamada(c.pid, l.uid), nomeNaChamada(c.pid, l.uid)[0])}</span>`).join('')}</div>`;
    }
    // O palco do mini abre a chamada no clique; pelo teclado, o caminho é o
    // botão "Abrir a chamada" dos controles, por isso este fica fora do Tab.
    html = `
      <div class="ch-mini-palco">${palco}<button type="button" class="ch-alvo" tabindex="-1" aria-hidden="true" onclick="chamadaExpandir()"></button></div>
      <div class="ch-mini-barra">
        <div class="ch-mini-info"><span class="ch-ponto" aria-hidden="true"></span><span class="ch-mini-nome" title="${esc(nomeProjeto)}">${esc(nomeCurto)}</span><span class="ch-tempo"></span></div>
        <div class="ch-mini-controles">${controlesChamadaHtml(true)}</div>
      </div>
      <div class="sr-only" aria-live="polite" id="ch-anuncio"></div>`;
  }else{
    // Ninguém com câmera nem tela: a sala é só de voz, e as pessoas aparecem
    // como fotos grandes (ou nos quadros de sempre, conforme layoutSoVoz).
    const soVoz = !ladrilhos.some(l=>l.tipo === 'tela' || l.p.camera);
    const emFotos = soVoz && layoutSoVoz === 'fotos';
    // Com um quadro só não há o que destacar: o clique esticava a câmera para
    // a largura do palco e parecia zoom.
    const podeDestacar = ladrilhos.length > 1;
    const destaque = !emFotos ? destaqueDaChamada(c, ladrilhos) : null;
    c.destaqueAtual = destaque ? destaque.chave : null;
    let palco;
    if(emFotos){
      const n = ladrilhos.length;
      const tam = n <= 2 ? 'g' : n <= 4 ? 'm' : n <= 6 ? 'p' : n <= 8 ? 'pp' : 'ppp';
      // Fileiras equilibradas: 6 viram 3 + 3, e não 5 + 1.
      const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
      palco = `
        <div class="ch-palco so-voz">
          <div class="ch-roda tam-${tam}" style="--cols:${cols};">${ladrilhos.map(l=>ladrilhoChamadaHtml(l, {voz: true})).join('')}</div>
        </div>`;
    }else if(destaque){
      const outros = ladrilhos.filter(l=>l.chave !== destaque.chave);
      palco = `
        <div class="ch-palco com-destaque">
          <div class="ch-destaque">${ladrilhoChamadaHtml(destaque)}</div>
          ${outros.length ? `<div class="ch-fileira">${outros.map(l=>ladrilhoChamadaHtml(l)).join('')}</div>` : ''}
        </div>`;
    }else{
      const n = ladrilhos.length;
      const cols = colunasDaGrade(n);
      const linhas = Math.ceil(n / cols);
      palco = `
        <div class="ch-palco">
          <div class="ch-grade" style="--cols:${cols};--linhas:${linhas};">${ladrilhos.map(l=>ladrilhoChamadaHtml(l, {semDestaque: !podeDestacar})).join('')}</div>
        </div>`;
    }
    // No alto, a sala em que estou; embaixo dela, o projeto, o tempo e quantos
    // estão aqui. Com mais de uma sala, o botão Salas abre a lista para trocar.
    const sala = canalDoProjeto(c.pid, c.sala);
    const nomeSala = sala ? sala.nome : (p ? p.name : 'Chamada');
    const salas = salasDoProjeto(c.pid);
    const minimizar = 'Minimizar a chamada (Esc)';
    html = `
      <header class="ch-topo">
        <div class="ch-titulo">
          <span class="ch-titulo-icone" aria-hidden="true">${iconeChamada('volume', 18)}</span>
          <div class="ch-titulo-texto">
            <h2>${esc(nomeSala)}</h2>
            <span class="ch-topo-meta">${sala && p ? `<span class="ch-topo-projeto">${esc(p.name)}</span><span aria-hidden="true"> · </span>` : ''}<span class="ch-tempo"></span><span aria-hidden="true"> · </span>${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'}</span>
          </div>
        </div>
        <div class="ch-topo-acoes">
          ${salas.length > 1 ? `<button type="button" id="ch-btn-salas" class="ch-salas-btn" onclick="chamadaAlternarSalas()" aria-expanded="${!!c.painelSalas}" aria-label="Salas de voz: trocar de sala">${iconeChamada('volume', 16)}<span>Salas</span><span class="ch-salas-seta">${iconeChamada('seta', 14)}</span></button>` : ''}
          ${doc === document ? `<button type="button" id="ch-btn-chat" class="ch-salas-btn ch-chat-btn ${c.chatAberto ? 'ativo' : ''}" onclick="chamadaAlternarChat()" aria-expanded="${!!c.chatAberto}" aria-label="${!c.chatAberto && chatNaoLidas[c.pid] ? `Chat do projeto, ${chatNaoLidas[c.pid]} não lida${chatNaoLidas[c.pid] > 1 ? 's' : ''}` : 'Chat do projeto'}" title="Chat do projeto">${iconeChamada('chat', 16)}<span>Chat</span>${seloChatHtml(c)}</button>` : ''}
          ${doc === document && janelaFlutuanteSuportada()
            // Um botão só no topo: com janela flutuante, ela; o cartão no
            // canto continua no Esc e no clique na barra lateral. Sem ela
            // (celular, Firefox, Safari), o minimizar, que é a única saída.
            ? `<button type="button" id="ch-btn-flutuar" class="ch-botao ch-botao-leve" onclick="abrirJanelaFlutuante()" aria-label="Janela flutuante, por cima dos outros programas (Esc minimiza no canto)" title="Janela flutuante, por cima dos outros programas (Esc minimiza no canto)">${iconeChamada('flutuar', 18)}</button>`
            : `<button type="button" id="ch-btn-minimizar" class="ch-botao ch-botao-leve" onclick="chamadaMinimizar()" aria-label="${minimizar}" title="${minimizar}">${iconeChamada('minimizar', 18)}</button>`}
        </div>
        ${c.painelSalas && salas.length > 1 ? painelSalasHtml(c) : ''}
      </header>
      ${palco}
      <div class="ch-rodape">
        ${c.painelDisp ? `<div class="ch-painel-disp" role="group" aria-label="Dispositivos">${seletoresDispositivo(c.dispositivos, 'chamadaTrocarDispositivo') || '<p>Nenhum dispositivo encontrado.</p>'}</div>` : ''}
        <div class="ch-controles" role="toolbar" aria-label="Controles da chamada">${controlesChamadaHtml(false)}</div>
      </div>
      ${c.painelTela && c.escolhaTela ? escolhaTelaHtml() : ''}
      <div class="sr-only" aria-live="polite" id="ch-anuncio"></div>`;
  }
  const anuncio = doc.getElementById('ch-anuncio');
  const textoAnuncio = anuncio ? anuncio.textContent : '';
  if(doc !== document) exporFuncoesNaJanela(doc.defaultView, html);
  // O chat da chamada é um elemento só, que sai junto com o innerHTML e volta
  // logo depois: o texto e o cursor ficam; a rolagem é devolvida à mão.
  const comChat = c.modo === 'expandida' && chatDaChamadaVisivel();
  raiz.classList.toggle('com-chat', comChat);
  const listaChatAntes = painelChatEl && painelChatEl.querySelector('#ch-chat-lista');
  const rolagemChatAntes = listaChatAntes && listaChatAntes.isConnected ? listaChatAntes.scrollTop : null;
  raiz.innerHTML = html;
  if(comChat){
    if(painelChatEl && painelChatEl.firstChild) raiz.appendChild(painelChatEl);
    else montarPainelChat();
    const listaChat = painelChatEl && painelChatEl.querySelector('#ch-chat-lista');
    if(listaChat && rolagemChatAntes !== null) listaChat.scrollTop = rolagemChatAntes;
  }
  if(c.modo === 'expandida') ajustarGradeChamada(raiz);
  raiz.querySelectorAll('[data-slot]').forEach(slot=>{
    const v = videoDaChamada(slot.dataset.slot);
    if(v) slot.appendChild(v);
  });
  // Ladrilho de quem acabou de entrar (ou da tela que acabou de começar)
  // chega com animação; os que já estavam não repetem a cada desenho. Na
  // troca de modo, quem anima é a transição da janela inteira.
  // Ao entrar alguém a janela se redesenha várias vezes seguidas (presença,
  // áudio, conexão); a animação continua de onde estava em vez de recomeçar
  // ou ser cortada.
  const agora = performance.now();
  const chaves = new Set();
  raiz.querySelectorAll('.ch-ladrilho[data-chave]').forEach(el=>{
    const k = el.dataset.chave;
    chaves.add(k);
    if(chamadaDesenho.modo === c.modo && !chamadaDesenho.chaves.has(k) && !chamadaEntradas.has(k)) chamadaEntradas.set(k, agora);
    const desde = chamadaEntradas.get(k);
    if(desde === undefined) return;
    const passou = agora - desde;
    if(passou < CHAMADA_ENTRADA_MS){
      el.classList.add('entrando');
      el.style.animationDelay = `-${Math.round(passou)}ms`;
    }else chamadaEntradas.delete(k);
  });
  chamadaDesenho = {modo: c.modo, chaves};
  if(c.animarPainel){
    raiz.querySelectorAll('.ch-painel-disp, .ch-volume, .ch-dialogo-fundo, .ch-salas').forEach(el=>el.classList.add('abrindo'));
    c.animarPainel = false;
  }
  const novoAnuncio = doc.getElementById('ch-anuncio');
  if(novoAnuncio && textoAnuncio) novoAnuncio.textContent = textoAnuncio;
  for(const [chave, m] of falaMedidores) if(m.falando) marcarFalaChamada(chave, true);
  atualizarTempoChamada();
  if(foco){
    const el = doc.getElementById(foco);
    if(el) el.focus();
  }
}

function atualizarTempoChamada(){
  if(!chamada) return;
  const t = formatarDuracaoChamada(Date.now() - chamada.inicio);
  for(const d of docsChamada()) d.querySelectorAll('.ch-tempo').forEach(el=>{ el.textContent = t; });
}

function iniciarRelogioChamada(){
  pararRelogioChamada();
  chamadaRelogio = setInterval(atualizarTempoChamada, 1000);
}

function pararRelogioChamada(){
  if(chamadaRelogio){ clearInterval(chamadaRelogio); chamadaRelogio = null; }
}

/* --- no projeto: botão, faixa e aviso --- */

// O "Iniciar chamada" do topo saiu (RFC 0006): entra-se pela sala, na aba
// Canais, ou pela faixa quando alguém já está numa.
function faixaChamadaHtml(p){
  const na = emChamadaDoProjeto(p.id);
  const euDentro = chamada && chamada.pid === p.id;
  if(!na.length && !euDentro) return '<div id="chamada-faixa"></div>';
  // O nome da sala só aparece quando o projeto tem mais de uma.
  const varias = salasDoProjeto(p.id).length > 1;
  const ocupadas = [...new Set(na.map(x=>x.sala).filter(s=>s && CANAL_ID.test(s)))];
  let pessoas, titulo, acao;
  if(euDentro){
    pessoas = [{uid: session.user.id}, ...[...chamada.participantes.values()]];
    titulo = varias ? `Você está em ${nomeDaSala(p.id, chamada.sala)}` : 'Você está na chamada';
    acao = `<button class="btn-secondary" onclick="chamadaExpandir()">Abrir a chamada</button>`;
  }else if(ocupadas.length > 1){
    pessoas = na;
    titulo = `Chamadas em ${listaDeNomes(ocupadas.map(s=>nomeDaSala(p.id, s)))}`;
    acao = state.projectTasksView === 'chat' ? '' : `<button class="btn-primary" onclick="setProjectTasksView('chat')">Ver as salas</button>`;
  }else{
    const sala = ocupadas[0] || '';
    pessoas = na;
    titulo = varias && sala ? `Chamada em ${nomeDaSala(p.id, sala)}` : 'Chamada em andamento';
    acao = `<button class="btn-primary btn-com-icone" onclick="abrirPreviaChamada('${p.id}','${sala}')">${iconeChamada('ligar', 14)}Entrar</button>`;
  }
  const nomes = pessoas.map(x=>x.uid === session.user.id ? 'você' : nomeNaChamada(p.id, x.uid));
  const avatares = pessoas.slice(0, 4).map(x=>`<span data-fala="${x.uid}">${avatarChip(perfilNaChamada(p.id, x.uid), nomeNaChamada(p.id, x.uid)[0])}</span>`).join('')
    + (pessoas.length > 4 ? `<span class="ch-faixa-mais" aria-hidden="true">+${pessoas.length - 4}</span>` : '');
  return `
    <div id="chamada-faixa" class="ch-faixa" role="status">
      <span class="ch-ponto" aria-hidden="true"></span>
      <span class="ch-faixa-avatares">${avatares}</span>
      <span class="ch-faixa-texto"><strong>${esc(titulo)}</strong><span>${esc(listaDeNomes(nomes))}</span></span>
      ${acao}
    </div>`;
}

function atualizarFaixaChamada(){
  if(state.view !== 'project') return;
  const p = projetoDaChamada(state.currentProjectId);
  if(!p) return;
  const faixa = document.getElementById('chamada-faixa');
  if(faixa) faixa.outerHTML = faixaChamadaHtml(p);
}

// A linha "Chamada iniciada" chega pelo canal do chat a quem é do projeto.
function avisarChamadaIniciada(m){
  if(!session || m.authorId === session.user.id) return;
  if(chamada && chamada.pid === m.projectId) return;
  if(Date.now() - new Date(m.created).getTime() > 2 * 60 * 1000) return;
  const p = projetoDaChamada(m.projectId);
  if(!p || !chamadaSuportada()) return;
  const quem = nomeAutorChat(p, m.authorId, m.autorNome);
  // Com várias salas, o aviso diz qual; o Entrar vai para ela.
  const sala = m.canalId && CHAMADA_UUID.test(m.canalId) && canalDoProjeto(p.id, m.canalId) ? m.canalId : '';
  const ondeSala = sala && salasDoProjeto(p.id).length > 1 ? ` em ${nomeDaSala(p.id, sala)}` : '';
  const silenciado = !!(chatLeitura[p.id] && chatLeitura[p.id].silenciado);
  // O toque e a notificação são para uma chamada nova. Não tocam se já estou
  // numa chamada (de qualquer projeto, nem que seja em outra aba) nem se o
  // projeto já tem gente em outra sala: alguém entrar noutra sala aparece na
  // lista de salas, sem barulho.
  const reg = canaisChamada[p.id];
  const jaTemChamada = !!chamada || !!(reg && reg.emChamada.some(x=>x.uid !== m.authorId));
  if(!silenciado && !jaTemChamada){
    tocarSomChamada('chamando');
    if(document.hidden && window.Notification && Notification.permission === 'granted'){
      try{
        const n = new Notification(`${quem} iniciou uma chamada${ondeSala}`, {body: p.name, tag: `chamada-${p.id}`});
        n.onclick = ()=>{ window.focus(); n.close(); openProjectView(p.id); };
      }catch(e){}
    }
  }
  fecharAvisoChamada();
  const el = document.createElement('div');
  el.id = 'chamada-aviso';
  el.className = 'alarm-banner ch-aviso';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="alarm-banner-icon ch-aviso-icone">${iconeChamada('ligar', 22)}</div>
    <div class="alarm-banner-body">
      <div class="alarm-banner-label">${esc(p.name)}</div>
      <div class="alarm-banner-title">${esc(`${quem} iniciou uma chamada${ondeSala}`)}</div>
    </div>
    <div class="alarm-banner-actions">
      <button class="btn-primary" onclick="abrirPreviaChamada('${p.id}','${sala}')">Entrar</button>
      <button class="alarm-banner-dismiss" onclick="fecharAvisoChamada()" title="Agora não" aria-label="Agora não">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.body.appendChild(el);
  setTimeout(()=>{ if(document.getElementById('chamada-aviso') === el) el.remove(); }, 30000);
}

function fecharAvisoChamada(){
  const el = document.getElementById('chamada-aviso');
  if(el) el.remove();
}

watchModalFocus();
capturarConviteDaUrl();
checkAuth();
