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
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let session = null;
let authMode = 'signin';

// O supabase-js renova o JWT sozinho a cada ~1h, mas `session` guardava o da
// abertura da página. Passada uma hora, as chamadas a /api/google/* voltavam
// 401 e o sync com o Google parava em silêncio — com a aba aberta o dia todo.
sb.auth.onAuthStateChange((event, novaSessao)=>{
  if(novaSessao) session = novaSessao;
  // Saiu em outra aba (ou o refresh token morreu): esta aba não pode seguir
  // mostrando dados de uma sessão que não existe mais.
  if(event === 'SIGNED_OUT' && session && document.getElementById('app').style.display !== 'none'){
    location.reload();
  }
});

const THEMES = {
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
    line: 'rgba(255, 255, 255, 0.07)',
    lineStrong: 'rgba(255, 255, 255, 0.14)'
  },
  gremio: {
    name: 'Grêmio',
    dark: true,
    bg: '#0A1428',
    p5: '#1B3A6B', p6: '#2C5AA0', p8: '#3D7DD8',
    accent: '#1560BD', accentHover: '#0D4A9C',
    text: '#C9D6E8', textStrong: '#FFFFFF',
    textMuted: '#7891B5', textSoft: '#3D5578',
    accentText: '#FFFFFF',
    glass: 'rgba(10, 20, 40, 0.55)',
    glassStrong: 'rgba(16, 30, 56, 0.75)',
    glassHover: 'rgba(24, 42, 74, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
    glassBorderSoft: 'rgba(255, 255, 255, 0.06)',
    line: 'rgba(255, 255, 255, 0.08)',
    lineStrong: 'rgba(255, 255, 255, 0.16)',
    bgPhoto: 'gremio-bg.jpg'
  }
};

let currentTheme = 'bluegray';

function applyTheme(name){
  const t = THEMES[name] || THEMES.bluegray;
  currentTheme = name;
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
  r.setProperty('--line', t.line || 'rgba(122, 142, 162, 0.14)');
  r.setProperty('--line-strong', t.lineStrong || 'rgba(122, 142, 162, 0.22)');
  document.body.classList.toggle('theme-bg-photo', !!t.bgPhoto);
  document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
  // A barra do navegador no celular ficava sempre no azul-acinzentado do
  // tema padrão, mesmo com o Grafite ou o Grêmio escuros na tela.
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
  const original = state.savedTheme || 'bluegray';
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
  document.getElementById('settings-modal').classList.remove('open');
  render();
  document.getElementById('user-name-display').textContent = name;
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
        <div class="task-row ${cls}" style="${rowStyle}" onclick="closeStatusModal();openModal('${t.id}')">
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

// Só deixa agir sobre o que o usuário pode mesmo alterar.
function canEditTask(t){
  if(!session || !session.user) return false;
  if(t.owner_id === session.user.id) return true;
  return !!(t.project_id && canEditProject(t.project_id));
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
    document.querySelector('.auth-switch').style.display = 'none';
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
    state.savedTheme = myProfile.theme || 'bluegray';
    state.soundEnabled = myProfile.sound_enabled !== false;
    state.novidadesVistas = Array.isArray(myProfile.novidades_vistas) ? myProfile.novidades_vistas : [];
    applyTheme(state.savedTheme);
    state.columns = normalizarColunas(myProfile.kanban_columns) || JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    document.getElementById('user-name-display').textContent = state.myName;
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
  const {error} = await sb.from('profiles').upsert({id: session.user.id, name, theme: 'bluegray', updated_at: new Date().toISOString()});
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
  document.getElementById('auth-error').classList.remove('show');
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

function scheduleRealtimeReload(kind){
  if(realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = setTimeout(async ()=>{
    await refreshAll(kind, true);
  }, 500);
}

async function refreshAll(kind, silent){
  if(isRefreshing) return;
  isRefreshing = true;
  const btns = document.querySelectorAll('.refresh-btn');
  btns.forEach(b=>b.classList.add('spinning'));
  try{
    const cargas = [];
    if(!kind || kind === 'tasks') cargas.push(loadTasks());
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
      const {data: profiles} = await sb.from('profiles').select('id, name, avatar_url').in('id', [...profileIds]);
      const profileMap = {};
      (profiles || []).forEach(pr=>{profileMap[pr.id] = pr;});
      Object.values(projectMap).forEach(p=>{
        p.ownerProfile = profileMap[p.owner_id] || null;
        p.members.forEach(m=>{m.profile = m.user_id ? (profileMap[m.user_id] || null) : null;});
      });
    }
  }

  state.projects = Object.values(projectMap);
  state.pendingInvites = pending || [];
  saveProjectsCache();
  updatePendingInvitesBadge();
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

function renderSidebarProjects(){
  const wrap = document.getElementById('sidebar-projects');
  if(!wrap) return;

  let html = '';

  if(state.pendingInvites.length > 0){
    html += `
      <button class="sidebar-invite-pill" onclick="openProjectsModal()" style="cursor:pointer;">
        <span class="sidebar-invite-dot"></span>
        ${state.pendingInvites.length} convite${state.pendingInvites.length>1?'s':''} pendente${state.pendingInvites.length>1?'s':''}
      </button>`;
  }

  // Sempre visível, mesmo sem projeto: o + no título é o caminho para criar.
  html += cabecalhoSecaoNav('Projetos', 'novoProjetoRapido()', 'Novo projeto');
  if(state.projects.length === 0){
    html += `<button class="nav-empty-acao" onclick="novoProjetoRapido()">Criar o primeiro projeto</button>`;
  } else {
    html += state.projects.map(p=>{
      const role = p.myRole === 'owner' ? 'Dono' : (myRoleInProject(p.id) === 'editor' ? 'Editor' : 'Vendo');
      const isActive = state.view === 'project' && state.currentProjectId === p.id;
      return `
        <button class="sidebar-project-item ${isActive?'active':''}" onclick="openProjectView('${p.id}')" title="${esc(p.name)}">
          <span class="sidebar-project-dot"></span>
          <span class="sidebar-project-name">${esc(p.name)}</span>
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

// O + de Projetos na barra lateral: pede só o nome, cria e já abre o quadro.
async function novoProjetoRapido(){
  const name = await perguntar('Novo projeto', {label: 'Nome do projeto', placeholder: 'Ex: Lançamento da loja', okLabel: 'Criar projeto'});
  if(!name) return;
  const criado = await criarProjetoRemoto(name.slice(0, 80));
  if(!criado) return;
  await loadProjects();
  openProjectView(criado.id);
  showToast('Projeto criado');
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
  const {error} = await sb.from('project_members').insert({
    project_id: projectId,
    invited_email: email,
    role: roleSelect.value,
    status: 'pending'
  });
  if(error){console.error(error);showToast('Não deu para enviar o convite. Confira o email e tente de novo.', 'erro');return;}
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
  const {error} = await sb.from('project_members').insert({
    project_id: projectId,
    invited_email: null,
    role: roleSelect.value,
    status: 'pending',
    code
  });
  if(error){console.error(error);showToast('Não deu para gerar o código. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
  try{
    await navigator.clipboard.writeText(linkDoConvite(code));
    showToast(`Código ${code} gerado e link copiado. Mande para uma pessoa.`);
  }catch(e){
    showToast(`Código gerado: ${code}. Use "Copiar link" ao lado dele.`);
  }
}

async function joinByCode(){
  const input = document.getElementById('join-code-input');
  const code = codigoDoConvite(input.value);
  if(!code){input.focus();return;}
  const {data, error} = await sb.rpc('accept_invite_by_code', {p_code: code});
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  if(!data || !data.success){
    showToast(data && data.error ? data.error : 'Código inválido ou já usado. Peça um novo para quem te convidou.', 'erro');
    return;
  }
  input.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast(data.already_member ? 'Você já era membro desse projeto' : 'Você entrou no projeto!');
  render();
}

async function removeMember(memberId){
  if(!await confirmar('Ela perde o acesso às tarefas compartilhadas deste projeto.', {title:'Remover essa pessoa?', okLabel:'Remover'})) return;
  const {error} = await sb.from('project_members').delete().eq('id', memberId);
  if(error){console.error(error);showToast('Não deu para concluir a ação. Tente de novo em instantes.', 'erro');return;}
  await loadProjects();
  renderProjectsModal();
  showToast('Removido');
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
  await loadProjects();
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
  if(state.currentProjectId !== projectId) state.projCalSelectedDate = null;
  if(state.view !== 'project') state.viewBeforeProject = state.view;
  if(state.currentProjectId !== projectId || state.view !== 'project') state.projectTasksView = visaoProjetoSalva(projectId);
  state.currentProjectId = projectId;
  state.view = 'project';
  render();
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
// Cada projeto lembra a última aba; o primeiro acesso abre no Início.
const VISOES_PROJETO = ['inicio', 'kanban', 'calendar', 'notes'];
function visaoProjetoSalva(pid){
  if(!pid) return 'inicio';
  try{
    const v = localStorage.getItem(`projectView:${pid}`);
    return VISOES_PROJETO.includes(v) ? v : 'inicio';
  }catch(e){ return 'inicio'; }
}

function setProjectTasksView(visao){
  // Sair das notas com um salvamento agendado perdia o que acabou de ser digitado.
  flushNotesIfPending();
  state.projectTasksView = visao;
  try{ if(state.currentProjectId) localStorage.setItem(`projectView:${state.currentProjectId}`, visao); }catch(e){}
  skipEntranceOnce = true;
  render();
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
  const canEdit = isOwner || role === 'editor';
  const roleLabel = isOwner ? 'Dono' : (role === 'editor' ? 'Editor' : 'Visualizador');
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

  const abas = [
    {key:'inicio', label:'Início'},
    {key:'kanban', label:'Quadro'},
    {key:'calendar', label:'Calendário'},
    {key:'notes', label:'Notas', marca: !asNotes && (state.notasProjeto[p.id] && !state.notasProjeto[p.id].semTabela ? state.notasProjeto[p.id].lista.length > 0 : projectHasNotes(p))}
  ];

  const filtros = (asNotes || asInicio) ? '' : `
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
    corpo = renderProjectInicio(p, canEdit, projectItems, projectTasks, cols);
  } else if(asNotes){
    corpo = renderProjectNotes(p, canEdit);
  } else if(!asCalendar && !canEdit && projectTasks.length === 0){
    corpo = `<div class="glass proj-surface proj-vazio"><strong>Nenhuma tarefa neste projeto ainda.</strong>Quem edita o projeto cria as tarefas aqui; elas aparecem para você assim que forem criadas.</div>`;
  } else if(asCalendar){
    corpo = `<div class="glass proj-surface">${renderProjectCalendar(p, filteredProjectTasks)}</div>
      ${state.projCalSelectedDate ? renderDayPanel(state.projCalSelectedDate, groupTasksByCalDate(filteredProjectTasks)[state.projCalSelectedDate] || [], {projectId: p.id, canEdit}) : ''}`;
  } else {
    corpo = `
      <div class="kanban kanban-projeto">
        ${cols.map(col=>{
          const list = sortByDateThenPriority(filteredProjectTasks.filter(t=>!ehEvento(t) && statusVisivel(t, cols)===col.key && !isHiddenFromKanban(t)));
          const collapsed = col.hidden && !state.expandedCols.has(col.key);
          if(collapsed){
            return `
              <div class="glass kb-col kb-col-collapsed" data-status="${col.key}" onclick="toggleColExpanded('${col.key}')" title="Coluna oculta — toque para abrir">
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
        <h1 class="proj-title">${esc(p.name)}</h1>
        <div class="proj-meta">
          <button class="proj-people" onclick="openProjectsModal()" title="${isOwner ? 'Ver e gerenciar membros' : 'Ver membros'}">
            <span class="proj-avatars">${avatares}${excedente}</span>
            <span>${people.length} pessoa${people.length!==1?'s':''}</span>
          </button>
          <span class="proj-role ${canEdit ? '' : 'leitura'}">${roleLabel}${canEdit ? '' : ' · só leitura'}</span>
          <span class="proj-andamento">${andamento}</span>
        </div>
      </div>
      <div class="proj-head-actions">
        <button class="btn-back refresh-btn" onclick="refreshAll()" title="Atualizar agora" aria-label="Atualizar agora">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        ${isOwner ? `<button class="btn-secondary btn-com-icone" onclick="convidarNoProjeto('${p.id}')"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>Convidar</button>` : ''}
        ${canEdit && visao === 'kanban' ? `<button class="btn-secondary" onclick="openColumnModal(null, '${p.id}')">+ Nova coluna</button>` : ''}
        ${canEdit ? renderMenuNovo() : ''}
      </div>
    </header>

    <div class="proj-toolbar">
      <div class="proj-view-abas" role="group" aria-label="Ver o projeto como">
        ${abas.map(a=>`<button class="proj-view-aba ${visao===a.key ? 'ativa' : ''}" aria-pressed="${visao===a.key}" onclick="setProjectTasksView('${a.key}')">${a.label}${a.marca ? '<span class="proj-view-marca" title="Tem notas"></span>' : ''}</button>`).join('')}
      </div>
      ${filtros}
    </div>

    ${corpo}
  `;
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
            <div style="font-size:11.5px;color:var(--text-muted);">Convite como ${inv.role === 'editor' ? 'editor' : 'visualizador'}</div>
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
        const role = p.myRole === 'owner' ? 'Dono' : (myRoleInProject(p.id) === 'editor' ? 'Editor' : 'Visualizador');
        const tasks = state.tasks.filter(t=>t.project_id===p.id);
        const active = tasks.filter(t=>taskColumnType(t)!=='done').length;
        return `
          <div class="glass project-list-card" onclick="openProjectView('${p.id}')">
            <div class="project-card-head" style="margin-bottom:6px;">
              <div class="project-card-name">${esc(p.name)}</div>
              <div class="project-card-role">${role}</div>
            </div>
            <div class="project-list-card-meta">${active} ativa${active!==1?'s':''} · ${tasks.length} no total</div>
          </div>`;
      }).join('')}</div>`;

  const acoesProjetos = `
      <div class="projects-list-acoes">
        <button class="btn-secondary" onclick="openProjectsModal()">Gerenciar</button>
        <button class="btn-primary btn-com-icone" onclick="novoProjetoRapido()">${ICONE_MAIS}Novo projeto</button>
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
          <div style="font-size:11.5px;color:var(--text-muted);">Convite como ${inv.role === 'editor' ? 'editor' : 'visualizador'}</div>
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
          <div class="member-status accepted">Dono</div>
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
            <div class="member-status ${m.status}">${m.status === 'accepted' ? 'Ativo' : 'Pendente'} · ${m.role === 'editor' ? 'Editor' : 'Visualizador'}</div>
            ${isOwner ? `<button class="member-remove" onclick="removeMember('${m.id}')" title="Remover"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>`;
        }).join('');

      return `
        <div class="project-card">
          <div class="project-card-head">
            <div class="project-card-name">${esc(p.name)}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="project-card-role">${isOwner ? 'Dono' : myRoleInProject(p.id) === 'editor' ? 'Editor' : 'Visualizador'}</div>
              <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="closeProjectsModal();openProjectView('${p.id}');">Abrir quadro</button>
            </div>
          </div>
          ${ownerRow}
          ${membersHtml}
          ${isOwner ? `
            <div class="invite-row">
              <input type="email" class="input" id="invite-email-${p.id}" placeholder="Email pra convidar">
              <select id="invite-role-${p.id}">
                <option value="editor">Editor</option>
                <option value="viewer">Visualizador</option>
              </select>
              <button class="btn-secondary" style="flex-shrink:0;padding:0 14px;" onclick="inviteToProject('${p.id}')">Convidar</button>
            </div>
            <div class="invite-ou"><span>ou</span></div>
            <div class="invite-code-row">
              <div class="invite-code-text">
                <div class="invite-code-title">Código de convite</div>
                <div class="invite-code-hint">Pra quem já tem login no app.</div>
              </div>
              <select id="code-role-${p.id}" aria-label="Papel de quem entrar pelo código">
                <option value="editor">Editor</option>
                <option value="viewer">Visualizador</option>
              </select>
              <button class="btn-secondary" style="flex-shrink:0;padding:0 14px;" onclick="generateInviteCode('${p.id}')">Gerar código</button>
            </div>
            <button class="btn-danger" style="width:100%;margin-top:10px;" onclick="deleteProject('${p.id}')">Excluir projeto</button>
          ` : `
            <button class="btn-danger" style="width:100%;margin-top:12px;" onclick="leaveProject('${p.id}')">Sair do projeto</button>
          `}
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
  return t.time ? `${fmtDate(t.date)} ⏰${t.time}` : fmtDate(t.date);
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

function animateCount(el, target){
  const start = 0;
  const dur = 550;
  const startTime = performance.now();
  function tick(now){
    const p = Math.min((now - startTime) / dur, 1);
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
  skipEntranceOnce = false;
  m.scrollLeft = keepScroll;
  attachEvents();
  tornarClicaveisAcessiveis(m);

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
      <div class="task-row ${cls}" onclick="openModal('${t.id}')">
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
      <div class="header-cta" onclick="openModal()" style="cursor:pointer;">
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
      ${colCounts.map(c=>`<div class="status-item" onclick="openStatusDetail('col:${c.key}')"><div class="lbl">${esc(c.name)}</div><div class="val" data-count="${c.count}">0</div></div>`).join('')}
      <div class="status-item overdue" onclick="openStatusDetail('overdue', 'Atrasadas')"><div class="lbl">Atrasadas</div><div class="val" data-count="${overdue}">0</div></div>
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
        <div class="task-row ${cls}" style="${rowStyle}" onclick="closeStatusModal();openModal('${t.id}')">
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
    cells += `<div class="mini-cal-day ${isToday?'today':''} ${hasTask?'has-task':''}" onclick="openMiniCalDay('${iso}')">${day}</div>`;
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
    <div class="kb-card ${doneCls} ${state.selected.has(t.id)?'is-selected':''}" style="--col-color:${taskColor(t)}" draggable="${draggable}" ${dragAttrs} onclick="cardClick(event,'${t.id}')">
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
  if(t.routine_id && t.date === todayIso()) return t.time ? `hoje · ${t.time.slice(0, 5)}` : 'hoje';
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
        <div class="glass kb-col kb-col-collapsed" data-status="${col.key}" onclick="toggleColExpanded('${col.key}')" title="Coluna oculta — toque para abrir">
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
        <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
      </div>
    </div>
    ${renderBulkBar()}
    <div class="kanban-filter-row">
      <div class="search-box">
        <svg class="search-box-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="input" id="kf-search" name="kf-search" autocomplete="off" placeholder="Pesquisar tarefas…" value="${esc(state.filter.kanbanSearch)}">
      </div>
      <select class="select" id="kf-client" style="width:auto;">
        <option value="">Todos clientes</option>
        ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      ${renderTagFilterSelect('kf-tag', tagOptions, state.filter.kanbanTag)}
      <select class="select" id="kf-date" style="width:auto;">
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
                <div class="day-task ${taskColumnType(t)==='done'?'done':''}" style="--col-color:${taskColumnColor(t)}" onclick="openModal('${t.id}')">
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
    ? 'Aparece no Início e no Calendário do projeto, fora do quadro.'
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
    const isMine = t.owner_id === session.user.id;
    const canEdit = isMine || (t.project_id && canEditProject(t.project_id));
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
  const editableProjects = state.projects.filter(p=>p.myRole === 'owner' || myRoleInProject(p.id) === 'editor');
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
  'meta-modal': ()=>fecharNovaMeta(),
  'metas-intro-modal': ()=>fecharApresentacaoMetas(),
  'metas-historico-modal': ()=>fecharHistoricoMetas(),
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
function renderProjectInicio(p, canEdit, itens, tarefas, cols){
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
    : `<div class="pi-vazio"><p>Nada marcado para os próximos 7 dias.</p>${canEdit ? `<div class="pi-vazio-acoes">${state.temTipoEvento !== false ? `<button class="btn-secondary" onclick="novoNoProjeto('evento')">Novo evento</button>` : ''}<button class="btn-secondary" onclick="novoNoProjeto('tarefa')">Nova tarefa</button></div>` : ''}</div>`;

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

function renderMenuNovo(){
  const item = (k, nome, desc)=>`<button role="menuitem" class="novo-menu-item" onclick="novoNoProjeto('${k}')"><span class="novo-menu-nome">${nome}</span><span class="novo-menu-desc">${desc}</span></button>`;
  return `
    <div class="novo-menu">
      <button class="btn-primary novo-menu-btn" aria-haspopup="menu" aria-expanded="false" onclick="alternarMenuNovo(this)">+ Novo</button>
      <div class="novo-menu-lista" role="menu" hidden>
        ${item('tarefa', 'Tarefa', 'Vai para o quadro')}
        ${state.temTipoEvento !== false ? item('evento', 'Evento', 'Reunião, call, entrega com hora') : ''}
        ${item('nota', 'Nota', 'Anotações do time')}
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

watchModalFocus();
capturarConviteDaUrl();
checkAuth();
