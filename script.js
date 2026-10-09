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
  renderMyAvatar('settings-avatar-preview', getUserName());
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = Object.entries(THEMES).map(([key, t])=>`
    <button class="theme-card ${key===currentTheme?'selected':''}" data-theme="${key}" onclick="selectTheme('${key}')">
      <div class="theme-card-name">${t.name}</div>
      <div class="theme-swatches">
        <div class="theme-swatch" style="background:${t.bg}"></div>
        <div class="theme-swatch" style="background:${t.p5}"></div>
        <div class="theme-swatch" style="background:${t.p6}"></div>
        <div class="theme-swatch" style="background:${t.p8}"></div>
        <div class="theme-swatch" style="background:${t.accent}"></div>
      </div>
    </button>
  `).join('');
  renderSettingsColumnsList();
  renderSettingsRoutinesList();
  updateGoogleStatusUI();
  document.getElementById('settings-modal').classList.add('open');
}

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
      <div class="settings-col-handle" aria-hidden="true" title="Arrastar para reordenar">⠿</div>
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
  renderMyAvatar('user-avatar', name);
}
const DEFAULT_COLUMNS = [
  {key:'todo', name:'A Fazer', color:'#9AAFC2', type:'active'},
  {key:'waiting', name:'Aguardando', color:'#C9A868', type:'waiting'},
  {key:'doing', name:'Em Andamento', color:'#5B7A94', type:'active'},
  {key:'done', name:'Concluído', color:'#8FA88C', type:'done'}
];
const COLUMN_COLOR_PRESETS = [
  '#9AAFC2','#7D9AB3','#5B7A94','#3D5578',
  '#C9A868','#D4A93F','#B8863D','#8F6A2E',
  '#8FA88C','#5CA05A','#3D7A4A','#2C5F3B',
  '#C48577','#D4826B','#B85C48','#933A2C',
  '#B084CC','#9B5FBF','#7A3FA0','#5C2C7A',
  '#5CC2C6','#3D9FA3','#2C7A7D','#1F5A5C',
  '#E0899E','#C9587A','#A83D5C','#822C46',
  '#6B7280','#4B5563','#374151','#1F2937'
];
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

function renderColorSwatches(){
  const wrap = document.getElementById('col-color-swatches');
  if(!wrap) return;
  const isCustom = !COLUMN_COLOR_PRESETS.includes(selectedColumnColor);
  wrap.innerHTML = COLUMN_COLOR_PRESETS.map(c=>`
    <button type="button" class="color-swatch-btn ${c===selectedColumnColor?'selected':''}" style="background:${c}" onclick="selectColumnColor('${c}')"></button>
  `).join('') + `
    <label class="color-swatch-btn color-swatch-custom ${isCustom?'selected':''}" style="${isCustom ? `background:${corSegura(selectedColumnColor)};` : ''}" title="Escolher outra cor">
      ${isCustom ? '' : '<span>+</span>'}
      <input type="color" value="${corSegura(selectedColumnColor)}" aria-label="Escolher outra cor" oninput="selectColumnColor(this.value)" style="opacity:0;position:absolute;inset:0;width:100%;height:100%;cursor:pointer;border:none;padding:0;">
    </label>
  `;
}
function selectColumnColor(c){
  selectedColumnColor = c;
  renderColorSwatches();
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
        ? '<span class="priority-badge urgent">🔥 Urgente</span>'
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
    selectedColumnColor = col.color;
    delBtn.style.display = cols.length > 1 ? '' : 'none';
  } else {
    title.textContent = 'Nova coluna';
    document.getElementById('col-name').value = '';
    document.getElementById('col-hidden').checked = false;
    selectedColumnColor = COLUMN_COLOR_PRESETS[0];
    delBtn.style.display = 'none';
  }
  renderColorSwatches();
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
  ignoredEvents: new Set()
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
  return t.assigned_to === session.user.id;
}

function personalTasks(){
  return state.tasks.filter(isVisibleInPersonalViews);
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
    const email = session.user.email;
    state.myName = myProfile.name;
    state.myAvatarUrl = myProfile.avatar_url || null;
    state.savedTheme = myProfile.theme || 'bluegray';
    state.soundEnabled = myProfile.sound_enabled !== false;
    applyTheme(state.savedTheme);
    state.columns = normalizarColunas(myProfile.kanban_columns) || JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    document.getElementById('user-email').textContent = email || '';
    document.getElementById('user-name-display').textContent = state.myName;
    renderMyAvatar('user-avatar', state.myName);
    // A barra lateral aparece completa já no primeiro desenho: o Desafio só
    // depende do e-mail, e os projetos vêm da última visita até o banco responder.
    setupDesafioNav();
    restoreProjectsCache();
    // Em paralelo: uma consulta não precisa esperar a outra terminar. Só gerar
    // as rotinas precisa das tarefas e das rotinas já carregadas.
    await Promise.all([loadTasks(), loadRoutines(), loadProjects(), loadIgnoredEvents(), loadDesafio(), loadGoogleSession()]);
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
  } else {
    appEl.style.display = 'none';
    onbEl.classList.remove('show');
    authEl.classList.add('show');
  }
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
  document.getElementById('auth-sub').textContent = authMode === 'signin' ? 'Acesse sua conta pra continuar de onde parou' : 'Crie sua conta em segundos';
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
      ? {email, password, options:{emailRedirectTo: location.origin}}
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
    const hint = expiring ? ` <span style="color:var(--waiting);">· expira em breve, reconecte</span>` : '';
    el.innerHTML = `<span style="color:var(--done);">● Conectado</span>${hint}`;
    btn.textContent = 'Desconectar';
    btn.onclick = disconnectGoogleCalendar;
    if(syncBtn) syncBtn.style.display = '';
  } else {
    el.innerHTML = `<span style="color:var(--text-muted);">○ Não conectado</span>`;
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
  return document.activeElement && document.activeElement.id === 'project-notes-editor';
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

async function editUserName(){
  const current = getUserName();
  const newName = await perguntar('Como você quer ser chamado?', {value: current, label:'Seu nome', okLabel:'Salvar'});
  if(!newName || newName.trim() === '' || newName === current) return;
  const {error} = await sb.from('profiles').upsert({id: session.user.id, name: newName.trim(), updated_at: new Date().toISOString()});
  if(error){console.error(error);showToast('Não deu para salvar o nome. Tente de novo em instantes.', 'erro');return;}
  state.myName = newName.trim();
  render();
}

async function loadTasks(){
  const {data, error} = await sb.from('tasks').select('*').order('created_at', {ascending: true});
  if(error){console.error(error);state.tasks = [];render();return;}
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
      el.innerHTML = `<span class="invite-dot-badge"></span> ${state.pendingInvites.length} convite${state.pendingInvites.length>1?'s':''}`;
      el.style.color = 'var(--waiting)';
      el.style.fontFamily = "'JetBrains Mono',monospace";
      el.style.fontSize = '10.5px';
    } else {
      el.textContent = '';
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

  if(state.projects.length > 0){
    html += `<div class="nav-label">Projetos</div>`;
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

async function createProject(){
  const nameInput = document.getElementById('new-project-name');
  const name = nameInput.value.trim();
  if(!name){nameInput.focus();return;}
  const {error} = await sb.from('projects').insert({name, owner_id: session.user.id, owner_email: session.user.email});
  if(error){console.error(error);showToast('Não deu para criar o projeto. Tente de novo em instantes.', 'erro');return;}
  nameInput.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast('Projeto criado');
}

async function inviteToProject(projectId){
  const emailInput = document.getElementById(`invite-email-${projectId}`);
  const roleSelect = document.getElementById(`invite-role-${projectId}`);
  const email = emailInput.value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showToast('Confira o email — falta algo como nome@dominio.com.', 'erro');emailInput.focus();return;}
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
  showToast(`Código gerado: ${code}`);
}

async function joinByCode(){
  const input = document.getElementById('join-code-input');
  const code = input.value.trim().toUpperCase();
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
  if(notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(saveProjectNotes, 900);
}

async function saveProjectNotes(){
  const el = document.getElementById('project-notes-editor');
  if(!el) return;
  const p = state.projects.find(x=>x.id===state.currentProjectId);
  if(!p) return;
  const html = sanitizeNotesHtml(el.innerHTML);
  const {error} = await sb.from('projects').update({notes: html}).eq('id', p.id);
  const indicator = document.getElementById('notes-save-indicator');
  if(error){
    // Falhava calado: a pessoa saía achando que a nota estava salva.
    console.error(error);
    if(indicator){
      indicator.textContent = 'Não salvou — tente de novo';
      indicator.style.color = 'var(--danger)';
      indicator.style.opacity = '1';
    }
    showToast('A nota do projeto não foi salva. Confira a conexão e edite de novo.', 'erro');
    return;
  }
  p.notes = html;
  if(indicator){
    indicator.textContent = 'Salvo';
    indicator.style.color = '';
    indicator.style.opacity = '1';
    setTimeout(()=>{indicator.style.opacity = '0';}, 1500);
  }
}

function execEditorCmd(cmd, value){
  document.getElementById('project-notes-editor').focus();
  document.execCommand(cmd, false, value || null);
  scheduleProjectNotesSave();
}

async function insertProjectImage(){
  const raw = await perguntar('Inserir imagem', {label:'Endereço da imagem', placeholder:'https://…', okLabel:'Inserir'});
  if(!raw) return;
  const url = safeUrl(raw, true);
  if(!url){ showToast('Link de imagem inválido — use um endereço http:// ou https://', 'erro'); return; }
  document.getElementById('project-notes-editor').focus();
  document.execCommand('insertImage', false, url);
  scheduleProjectNotesSave();
}

// Quadro ou calendário nas tarefas do projeto. Vale para todos os projetos e
// fica salvo no aparelho, como a aba do Desafio.
function visaoProjetoSalva(){
  try{ return localStorage.getItem('projectTasksView') === 'calendar' ? 'calendar' : 'kanban'; }catch(e){ return 'kanban'; }
}

function setProjectTasksView(visao){
  state.projectTasksView = visao;
  try{ localStorage.setItem('projectTasksView', visao); }catch(e){}
  skipEntranceOnce = true;
  render();
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

function renderProjectPage(){
  const p = state.projects.find(x=>x.id===state.currentProjectId);
  if(!p){
    return `<div class="view-header"><div><div class="eyebrow">Projeto</div><h1>Não encontrado</h1></div></div>
      <div class="empty"><strong>Esse projeto não existe mais ou você não tem acesso.</strong><button class="btn-secondary" style="margin-top:12px;" onclick="voltarDoProjeto()">Voltar</button></div>`;
  }
  const isOwner = p.myRole === 'owner';
  const role = myRoleInProject(p.id);
  const canEdit = isOwner || role === 'editor';
  const projectTasks = state.tasks.filter(t=>t.project_id===p.id);
  const cols = getProjectColumns(p);
  const activeCount = projectTasks.filter(t=>taskColumnType(t)!=='done').length;
  const clientOptions = [...new Set(projectTasks.map(t=>t.client).filter(Boolean))].sort();
  const assigneeOptions = [
    {id:'', label:'Todas as pessoas'},
    {id:'unassigned', label:'Sem atribuição'},
    {id: p.owner_id, label: (p.ownerProfile && p.ownerProfile.name) || p.owner_email || 'Dono'},
    ...p.members.filter(m=>m.status==='accepted' && m.user_id).map(m=>({id:m.user_id, label:(m.profile && m.profile.name) || m.invited_email || 'Membro'}))
  ];
  const tagOptions = tagsInList(projectTasks);
  const asCalendar = state.projectTasksView === 'calendar';
  const filteredProjectTasks = projectTasks.filter(t=>{
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

  return `
    <div class="view-header">
      <div>
        <div class="eyebrow">Projeto compartilhado</div>
        <h1>${esc(p.name)}</h1>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-back" onclick="voltarDoProjeto()" title="Voltar" aria-label="Voltar">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <button class="btn-back refresh-btn" onclick="refreshAll()" title="Atualizar agora" aria-label="Atualizar agora">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        <button class="btn-secondary" onclick="openProjectsModal()">👥 Membros</button>
        ${canEdit ? `<button class="btn-primary" onclick="openModal(null, '', '${p.id}')">+ Nova tarefa</button>` : ''}
      </div>
    </div>

    <div class="glass panel" style="margin-bottom:20px;">
      <div class="panel-head">
        <div class="panel-title">📝 Notas do projeto</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="notes-save-indicator" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--done);opacity:0;transition:opacity .3s;">Salvo</span>
          ${canEdit ? `
          <div style="display:flex;gap:4px;">
            <button class="editor-btn" onclick="execEditorCmd('bold')" title="Negrito" aria-label="Negrito"><b aria-hidden="true">B</b></button>
            <button class="editor-btn" onclick="execEditorCmd('italic')" title="Itálico" aria-label="Itálico"><i aria-hidden="true">I</i></button>
            <button class="editor-btn" onclick="execEditorCmd('formatBlock','H3')" title="Título" aria-label="Título"><span aria-hidden="true">H</span></button>
            <button class="editor-btn" onclick="execEditorCmd('insertUnorderedList')" title="Lista" aria-label="Lista"><span aria-hidden="true">•</span></button>
            <button class="editor-btn" onclick="insertProjectImage()" title="Imagem" aria-label="Inserir imagem"><span aria-hidden="true">🖼</span></button>
          </div>` : ''}
        </div>
      </div>
      <div id="project-notes-editor" class="project-notes-editor" role="textbox" aria-multiline="true" aria-label="Notas do projeto" ${canEdit ? 'contenteditable="true"' : 'aria-readonly="true"'} oninput="scheduleProjectNotesSave()" data-placeholder="${canEdit ? 'Escreva aqui — contexto, links, decisões do projeto…' : 'Nenhuma nota ainda.'}">${sanitizeNotesHtml(p.notes)}</div>
    </div>

    <div class="glass panel" style="padding-bottom:20px;">
      <div class="panel-head">
        <div class="proj-tasks-title">
          <div class="panel-title">Tarefas do projeto</div>
          <div class="proj-view-abas" role="group" aria-label="Ver tarefas como">
            <button class="proj-view-aba ${asCalendar ? '' : 'ativa'}" aria-pressed="${!asCalendar}" onclick="setProjectTasksView('kanban')">Quadro</button>
            <button class="proj-view-aba ${asCalendar ? 'ativa' : ''}" aria-pressed="${asCalendar}" onclick="setProjectTasksView('calendar')">Calendário</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${canEdit && !asCalendar ? `<button class="btn-format" onclick="openColumnModal(null, '${p.id}')">+ Nova coluna</button>` : ''}
          <div class="panel-hint">${activeCount} ativa${activeCount!==1?'s':''} · ${projectTasks.length} no total</div>
        </div>
      </div>
      <div class="kanban-filter-row">
        <div class="search-box">
          <svg class="search-box-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" class="input" id="kf-search" name="kf-search" autocomplete="off" placeholder="Pesquisar tarefas…" value="${esc(state.filter.kanbanSearch)}">
        </div>
        <select class="select" id="kf-assignee" style="width:auto;">
          ${assigneeOptions.map(o=>`<option value="${o.id}" ${state.filter.kanbanAssignee===o.id?'selected':''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" id="kf-client" style="width:auto;">
          <option value="">Todos clientes</option>
          ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        ${renderTagFilterSelect('kf-tag', tagOptions, state.filter.kanbanTag)}
        ${asCalendar ? '' : `<select class="select" id="kf-date" style="width:auto;">
          <option value="all" ${(!state.filter.kanbanDate||state.filter.kanbanDate==='all')?'selected':''}>Qualquer prazo</option>
          <option value="today" ${state.filter.kanbanDate==='today'?'selected':''}>Hoje</option>
          <option value="next3" ${state.filter.kanbanDate==='next3'?'selected':''}>Próximos dias</option>
          <option value="week" ${state.filter.kanbanDate==='week'?'selected':''}>Semana</option>
          <option value="month" ${state.filter.kanbanDate==='month'?'selected':''}>Mês</option>
        </select>`}
      </div>
      ${asCalendar ? renderProjectCalendar(p, filteredProjectTasks) : `
      <div class="kanban" style="margin-top:4px;">
        ${cols.map(col=>{
          const list = sortByDateThenPriority(filteredProjectTasks.filter(t=>statusVisivel(t, cols)===col.key && !isHiddenFromKanban(t)));
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
                  <button class="kb-col-edit" onclick="openColumnModal('${col.key}', '${p.id}')" title="Editar coluna">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>` : ''}
                </div>
              </div>
              <div class="kb-cards">
                ${list.length===0
                  ? `<div class="empty" style="padding:22px 8px;font-size:12px;"><strong>Nada aqui</strong></div>`
                  : list.map(t=>{
                    const assignee = getAssigneeLabel(t);
                    return renderKbCard(t, col, {badge: assignee ? ()=>`<span class="project-badge" style="margin-bottom:6px;">👤 ${esc(assignee)}</span>` : null});
                  }).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>`}
    </div>
    ${asCalendar && state.projCalSelectedDate ? renderDayPanel(state.projCalSelectedDate, groupTasksByCalDate(filteredProjectTasks)[state.projCalSelectedDate] || [], {projectId: p.id, canEdit}) : ''}
  `;
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

  return `
    <div class="view-header">
      <div><div class="eyebrow">Trabalho em equipe</div><h1>Projetos</h1></div>
      <button class="btn-secondary" onclick="openProjectsModal()">👥 Gerenciar</button>
    </div>
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
      <label>Entrar com código de convite</label>
      <div class="invite-row">
        <input type="text" class="input" id="join-code-input" placeholder="Ex: 7F3K2A" maxlength="6" style="text-transform:uppercase;letter-spacing:0.1em;" onkeypress="if(event.key==='Enter')joinByCode()">
        <button class="btn-primary" style="flex-shrink:0;padding:0 16px;" onclick="joinByCode()">Entrar</button>
      </div>
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
          return `
          <div class="member-row">
            ${avatarChip(m.profile, (m.invited_email||'?')[0])}
            <div class="member-email">${label}</div>
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
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <div style="flex:1;height:1px;background:var(--line);"></div>
              <span style="font-size:10.5px;color:var(--text-soft);font-family:'JetBrains Mono',monospace;">ou</span>
              <div style="flex:1;height:1px;background:var(--line);"></div>
            </div>
            <div class="invite-row">
              <select id="code-role-${p.id}" style="flex:1;">
                <option value="editor">Gerar código — Editor</option>
                <option value="viewer">Gerar código — Visualizador</option>
              </select>
              <button class="btn-secondary" style="flex-shrink:0;padding:0 14px;" onclick="generateInviteCode('${p.id}')">Gerar</button>
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
}

let skipEntranceOnce = false;
let lastRenderedView = null;

function render(){
  updateNav();
  const m = document.getElementById('main');

  // A animação de entrada é para quando se troca de tela. Repetir ela a cada
  // atualização em lugar (sync, realtime, filtro, seleção) é o que faz a tela
  // piscar. Redesenhar a mesma tela também não deve perder a rolagem lateral.
  const viewKey = state.view === 'project' ? `project:${state.currentProjectId}` : state.view;
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
  const aguardando = sortByDateThenPriority(
    pTasks.filter(t=>taskColumnType(t)==='waiting' && matchesDateFilter(t, state.dateFilter))
  );
  const dataStr = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});

  const renderTaskRow = (t)=>{
    const isUrgent = t.priority === 'urgent';
    const isHigh = t.priority === 'high';
    const badge = isUrgent
      ? '<span class="priority-badge urgent">🔥 Urgente</span>'
      : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
    const cls = isUrgent ? 'urgent' : (isHigh ? 'high' : '');
    const dot = taskDotStyle(t);
    const pName = t.project_id ? projectName(t.project_id) : null;
    const projBadge = pName ? `<span class="project-badge">👥 ${esc(pName)}</span>` : '';
    return `
      <div class="task-row ${cls}" onclick="openModal('${t.id}')">
        <div class="task-check ${dot.cls}" style="${dot.style}"></div>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-date ${taskDateStatus(t)}">${dateWithTime(t)}</div>
        <span class="task-row-break"></span>
        ${badge}
        ${projBadge}
        <div class="task-client">${esc(t.client || '—')}</div>
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
    <div class="date-filter-row">
      <div class="date-filter">
        <span class="date-filter-label">Prazo:</span>
        <button class="date-pill ${state.dateFilter==='all'?'active':''}" onclick="setDateFilter('all')">Todas</button>
        <button class="date-pill ${state.dateFilter==='today'?'active':''}" onclick="setDateFilter('today')">Hoje</button>
        <button class="date-pill ${state.dateFilter==='next3'?'active':''}" onclick="setDateFilter('next3')">Próximos dias</button>
        <button class="date-pill ${state.dateFilter==='week'?'active':''}" onclick="setDateFilter('week')">Semana</button>
        <button class="date-pill ${state.dateFilter==='month'?'active':''}" onclick="setDateFilter('month')">Mês</button>
      </div>
      ${renderTodayAlert()}
    </div>
    <div class="dash-grid">
      <div style="display:flex;flex-direction:column;gap:22px;">
        <div class="glass panel">
          <div class="panel-head">
            <div class="panel-title">🎯 Suas próximas ações</div>
            <div class="panel-hint">${acoes.length} depende${acoes.length!==1?'m':''} de você</div>
          </div>
          ${acoes.length===0
            ? `<div class="empty"><strong>${state.dateFilter==='all' ? 'Zero pendências suas.' : 'Nada nesse período.'}</strong>${state.dateFilter==='all' ? 'Aproveita pra respirar.' : 'Ajusta o filtro pra ver mais.'}</div>`
            : acoes.slice(0,6).map(renderTaskRow).join('')
          }
        </div>
        <div class="glass panel">
          <div class="panel-head">
            <div class="panel-title">👥 Foco por cliente</div>
          </div>
          ${renderClientFocus()}
        </div>
        ${aguardando.length > 0 ? `
        <div class="glass panel">
          <div class="panel-head">
            <div class="panel-title" style="color:var(--text-muted);">⏳ Aguardando retorno</div>
            <div class="panel-hint">${aguardando.length} item${aguardando.length!==1?'s':''} com terceiros</div>
          </div>
          ${aguardando.slice(0,5).map(renderTaskRow).join('')}
        </div>
        ` : ''}
      </div>
      <div class="side-col">
        <div class="glass panel">${renderMiniCal()}</div>
      </div>
    </div>
  `;
}

function renderClientFocus(){
  const active = personalTasks().filter(t=>taskColumnType(t)!=='done');
  if(active.length === 0){
    return `<div class="empty" style="padding:26px 12px;font-size:12.5px;"><strong>Sem pendências</strong>Nenhum cliente ativo</div>`;
  }
  const byClient = {};
  active.forEach(t=>{
    const c = t.client || 'Sem cliente';
    byClient[c] = (byClient[c] || 0) + 1;
  });
  const sorted = Object.entries(byClient).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max = sorted[0][1];
  return sorted.map(([client, count])=>{
    const pct = (count/max)*100;
    return `
      <div class="client-item">
        <div class="client-name">${esc(client)}</div>
        <div class="client-bar"><div class="client-bar-fill" style="width:${pct}%"></div></div>
        <div class="client-count">${count}</div>
      </div>`;
  }).join('');
}

function renderTodayAlert(){
  const candidates = personalTasks().filter(t=>{
    if(taskColumnType(t)!=='active') return false;
    const ds = dateStatus(t.date);
    return ds === 'today' || ds === 'overdue';
  });

  if(candidates.length === 0){
    return `
      <div class="glass today-alert today-alert-calm">
        <div class="today-alert-icon">✅</div>
        <div class="today-alert-body">
          <div class="today-alert-title">Nada urgente hoje</div>
          <div class="today-alert-sub">Aproveita pra respirar</div>
        </div>
      </div>`;
  }

  candidates.sort((a,b)=>priorityWeight(b) - priorityWeight(a));
  const top = candidates[0];
  const isOverdue = dateStatus(top.date) === 'overdue';
  const restCount = candidates.length - 1;

  return `
    <div class="glass today-alert" onclick="openModal('${top.id}')">
      <div class="today-alert-icon">🔥</div>
      <div class="today-alert-body">
        <div class="today-alert-label">${isOverdue ? 'Atrasada' : 'Prioridade de hoje'}</div>
        <div class="today-alert-title">${esc(top.title)}</div>
        <div class="today-alert-sub">${esc(top.client || 'Sem cliente')}${restCount > 0 ? ` · +${restCount} pendente${restCount>1?'s':''}` : ''}</div>
      </div>
    </div>`;
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
        ? '<span class="priority-badge urgent">🔥 Urgente</span>'
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

function renderKbCard(t, col, opts){
  opts = opts || {};
  const badge = t.priority === 'urgent' ? '<span class="priority-badge urgent">🔥 Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
  const doneCls = col.type === 'done' ? 'done' : '';
  const extraBadge = opts.badge ? opts.badge(t) : '';
  const draggable = opts.draggable === false ? false : (!state.selecting && canEditTask(t));
  const dragAttrs = draggable ? `ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)"` : '';
  return `
    <div class="kb-card ${doneCls} ${state.selected.has(t.id)?'is-selected':''}" style="--col-color:${taskColor(t)}" draggable="${draggable}" ${dragAttrs} onclick="cardClick(event,'${t.id}')">
      ${state.selecting ? `<span class="kb-card-check">${state.selected.has(t.id)?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><polyline points="20 6 9 17 4 12"/></svg>':''}</span>` : ''}
      <div class="kb-card-client">${esc(t.client || '—')}</div>
      <div class="kb-card-title">${t.routine_id ? '<span title="Gerada por uma rotina" style="margin-right:4px;">🔁</span>' : ''}${esc(t.title)}</div>
      ${extraBadge}
      ${renderTagChipsInline(t, 3)}
      <div class="kb-card-meta">
        ${(col.type === 'done' && state.hideDateOnDone) ? '' : `<span class="${taskDateStatus(t)}">${t.date ? dateWithTime(t) : 'sem prazo'}</span>`}
        ${badge}
      </div>
    </div>`;
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
  const sharedFilteredTasks = state.tasks.filter(t=>t.project_id && matchesKanbanFilters(t));
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
          ${canAdd ? `<button class="btn-primary" onclick="openModal(null,'${iso}'${o.projectId ? `,'${o.projectId}'` : ''})">+ Adicionar neste dia</button>` : ''}
          <button class="day-panel-close" onclick="selectCalDay(null)" title="Fechar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      ${tasks.length===0
        ? `<div class="empty"><strong>Nada agendado neste dia.</strong>${canAdd ? 'Clica em "Adicionar neste dia" pra criar uma tarefa.' : ''}</div>`
        : `<div class="day-panel-tasks">
            ${tasks.map(t=>{
              const priorityBadge = t.priority === 'urgent' ? '<span class="priority-badge urgent">🔥 Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
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
    baseTasks = state.tasks.filter(t=>t.project_id===selectedProject.id);
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
  filtered = sortByDateThenPriority(filtered);

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
    <button type="button" class="task-color-btn task-color-none ${!selectedTaskColor?'selected':''}"
      onclick="selectTaskColor(null)" title="Sem cor própria (usa a cor da coluna)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/></svg>
    </button>`;
  wrap.innerHTML = none + EVENT_COLORS.map(c=>`
    <button type="button" class="task-color-btn ${selectedTaskColor===c.id?'selected':''}"
      style="background:${c.hex}" onclick="selectTaskColor('${c.id}')" title="${c.name}"></button>
  `).join('');
}

function selectTaskColor(id){
  selectedTaskColor = id;
  renderTaskColorSwatches();
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

function openModal(id, prefillDate, prefillProjectId){
  state.editingId = id || null;
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
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format, #modal .time-clear-btn, #modal .task-color-btn, #modal .tag-chip-remove').forEach(el=>{el.disabled = !canEdit;});
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
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format, #modal .time-clear-btn, #modal .task-color-btn, #modal .tag-chip-remove').forEach(el=>{el.disabled = false;});
    setupGcalToggle(null, true);
    commentsField.style.display = 'none';
    currentCommentTaskId = null;
  }
  document.getElementById('m-project').onchange = (e)=>{
    populateStatusSelect('m-status', colunasDe(e.target.value || null)[0].key, e.target.value || null);
    populateAssigneeSelect(e.target.value || null, null);
    // Rotina é só pra tarefa pessoal — escolher um projeto desliga e some com a opção.
    resetRepeatField(!id && !e.target.value);
  };
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
  const statusEscolhido = document.getElementById('m-status').value;
  const newStatus = statusEscolhido || colunasDe(document.getElementById('m-project').value || null)[0].key;
  const existingTask = state.editingId ? state.tasks.find(x=>x.id===state.editingId) : null;
  const projetoEscolhido = document.getElementById('m-project').value || null;
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
    priority: document.getElementById('m-priority').value,
    notes: document.getElementById('m-notes').value.trim(),
    color_id: selectedTaskColor,
    sync_google: wantsGcal,
    project_id: projetoEscolhido,
    assigned_to: document.getElementById('m-assignee').value || null,
    completed_at: resolveCompletedAt(
      newStatus,
      existingTask ? existingTask.status : null,
      existingTask ? existingTask.completed_at : null,
      colunasDe(projetoEscolhido),
      existingTask ? columnsForTask(existingTask) : null
    )
  };
  if(selectedTaskTags.length || (existingTask && existingTask.tags && existingTask.tags.length)) data.tags = [...selectedTaskTags];
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
  showToast(isNew ? 'Tarefa criada' : 'Alterações salvas');
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
  'confirm-modal': ()=>resolveDialog(null)
};
const SALVAR_MODAL = {
  'modal': ()=>saveTask(),
  'column-modal': ()=>saveColumn(),
  'routine-modal': ()=>saveRoutineModal(),
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

function setupDesafioNav(){
  const dono = isDesafioOwner();
  const grupo = document.getElementById('desafio-nav-group');
  const mob = document.getElementById('desafio-btn-mobile');
  if(grupo) grupo.hidden = !dono;
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

watchModalFocus();
checkAuth();
