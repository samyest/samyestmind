const SUPABASE_URL = 'https://nufcsghiitooamcgukbw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_H6te1T153XXpx57yR6A9Sw_uVm0G6vH';
const ALLOW_SIGNUP = false;
const GOOGLE_CLIENT_ID = 'COLE_SEU_CLIENT_ID_AQUI';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
let googleTokenClient = null;
let googleAccessToken = null;
let googleTokenExpiry = 0;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let session = null;
let authMode = 'signin';

const STORAGE_KEY = 'samyest-mind-tasks-v2';

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
}

function openSettings(){
  document.getElementById('s-name').value = getUserName();
  document.getElementById('s-sound').checked = state.soundEnabled !== false;
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
  updateGoogleStatusUI();
  document.getElementById('settings-modal').classList.add('open');
}

function renderSettingsColumnsList(){
  const wrap = document.getElementById('settings-columns-list');
  if(!wrap) return;
  wrap.innerHTML = getColumns().map(c=>`
    <div class="settings-col-item" draggable="true" data-key="${c.key}" ondragstart="colDragStart(event,'${c.key}')" ondragover="colDragOver(event)" ondragleave="colDragLeave(event)" ondrop="colDrop(event,'${c.key}')" ondragend="colDragEnd(event)">
      <div class="settings-col-handle" title="Arrastar para reordenar">⠿</div>
      <div class="settings-col-dot" style="background:${c.color}"></div>
      <div class="settings-col-name">${esc(c.name)}</div>
      <button class="settings-col-edit" onclick="openColumnModal('${c.key}')" title="Editar">
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
  if(!name){alert('Preencha seu nome');return;}
  const soundEnabled = document.getElementById('s-sound').checked;
  const {error} = await sb.from('profiles').upsert({
    id: session.user.id,
    name,
    theme: currentTheme,
    avatar_url: state.myAvatarUrl,
    sound_enabled: soundEnabled,
    updated_at: new Date().toISOString()
  });
  if(error){alert('Erro ao salvar: ' + error.message);return;}
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
function getColumn(key){
  return getColumns().find(c=>c.key===key) || {key, name:key, color:'#9AAFC2', type:'active'};
}
function columnName(key){ return getColumn(key).name; }
function columnColor(key){ return getColumn(key).color; }
function columnType(key){ return getColumn(key).type; }
function statusDotStyle(status){
  const col = getColumn(status);
  const cls = col.type === 'waiting' ? 'dot-hollow' : (col.type === 'done' ? 'dot-done' : '');
  return {cls, style: `--col-color:${col.color}`};
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
function taskColumnColor(t){ return getColumnForTask(t).color; }
function taskColumnType(t){ return getColumnForTask(t).type; }
function taskDotStyle(t){
  const col = getColumnForTask(t);
  const cls = col.type === 'waiting' ? 'dot-hollow' : (col.type === 'done' ? 'dot-done' : '');
  return {cls, style: `--col-color:${col.color}`};
}

async function persistColumns(){
  const {error} = await sb.from('profiles').update({kanban_columns: state.columns}).eq('id', session.user.id);
  if(error){alert('Erro ao salvar colunas: ' + error.message);return false;}
  return true;
}

function renderColorSwatches(){
  const wrap = document.getElementById('col-color-swatches');
  if(!wrap) return;
  const isCustom = !COLUMN_COLOR_PRESETS.includes(selectedColumnColor);
  wrap.innerHTML = COLUMN_COLOR_PRESETS.map(c=>`
    <button type="button" class="color-swatch-btn ${c===selectedColumnColor?'selected':''}" style="background:${c}" onclick="selectColumnColor('${c}')"></button>
  `).join('') + `
    <label class="color-swatch-btn color-swatch-custom ${isCustom?'selected':''}" style="${isCustom ? `background:${selectedColumnColor};` : ''}" title="Escolher outra cor">
      ${isCustom ? '' : '<span>+</span>'}
      <input type="color" value="${selectedColumnColor}" oninput="selectColumnColor(this.value)" style="opacity:0;position:absolute;inset:0;width:100%;height:100%;cursor:pointer;border:none;padding:0;">
    </label>
  `;
}
function selectColumnColor(c){
  selectedColumnColor = c;
  renderColorSwatches();
}

function openStatusDetail(filterKey, label){
  document.getElementById('status-modal-add-btn').style.display = 'none';
  let list;
  if(filterKey === 'overdue'){
    list = personalTasks().filter(t=>taskColumnType(t)!=='done' && dateStatus(t.date)==='overdue');
  } else {
    const key = filterKey.replace('col:', '');
    list = personalTasks().filter(t=>t.status===key);
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
          <div class="task-date ${dateStatus(t.date)}">${dateWithTime(t)}</div>
          <span class="task-row-break"></span>
          ${badge}
          <div class="task-client">${esc(t.client || '—')}</div>
        </div>`;
    }).join('');
  }
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
    selectedColumnColor = col.color;
    delBtn.style.display = cols.length > 1 ? '' : 'none';
  } else {
    title.textContent = 'Nova coluna';
    document.getElementById('col-name').value = '';
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
  if(error){alert('Erro ao salvar colunas do projeto: ' + error.message);return false;}
  const p = state.projects.find(x=>x.id===projectId);
  if(p) p.columns = cols;
  return true;
}

async function saveColumn(){
  const name = document.getElementById('col-name').value.trim();
  if(!name){document.getElementById('col-name').focus();return;}

  if(editingColumnProjectId){
    const p = state.projects.find(x=>x.id===editingColumnProjectId);
    if(!p) return;
    let cols = JSON.parse(JSON.stringify(getProjectColumns(p)));
    if(editingColumnKey){
      const col = cols.find(c=>c.key===editingColumnKey);
      if(col){col.name = name;col.color = selectedColumnColor;}
    } else {
      const key = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
      cols.push({key, name, type: 'active', color: selectedColumnColor});
    }
    const ok = await persistProjectColumns(editingColumnProjectId, cols);
    if(ok){closeColumnModal();render();}
    return;
  }

  if(!state.columns) state.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  if(editingColumnKey){
    const col = state.columns.find(c=>c.key===editingColumnKey);
    if(col){col.name = name;col.color = selectedColumnColor;}
  } else {
    const key = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    state.columns.push({key, name, type: 'active', color: selectedColumnColor});
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
    if(cols.length <= 1){alert('Precisa ter ao menos uma coluna.');return;}
    const hasTasks = state.tasks.some(t=>t.project_id===editingColumnProjectId && t.status===editingColumnKey);
    if(hasTasks && !confirm('Essa coluna tem tarefas — elas serão movidas para a primeira coluna restante. Continuar?')) return;
    const fallback = cols.find(c=>c.key !== editingColumnKey);
    const toMove = state.tasks.filter(t=>t.project_id===editingColumnProjectId && t.status===editingColumnKey);
    for(const t of toMove){
      t.status = fallback.key;
      await updateTaskRemote(t.id, t);
    }
    cols = cols.filter(c=>c.key !== editingColumnKey);
    const ok = await persistProjectColumns(editingColumnProjectId, cols);
    if(ok){closeColumnModal();render();}
    return;
  }

  const cols = getColumns();
  if(cols.length <= 1){alert('Precisa ter ao menos uma coluna.');return;}
  const hasTasks = state.tasks.some(t=>!t.project_id && t.status===editingColumnKey);
  if(hasTasks && !confirm('Essa coluna tem tarefas — elas serão movidas para a primeira coluna restante. Continuar?')) return;
  const fallback = cols.find(c=>c.key !== editingColumnKey);
  const toMove = state.tasks.filter(t=>!t.project_id && t.status===editingColumnKey);
  for(const t of toMove){
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

function populateStatusSelect(selectId, currentValue, projectId){
  const sel = document.getElementById(selectId);
  const cols = projectId ? getProjectColumns(state.projects.find(p=>p.id===projectId)) : getColumns();
  sel.innerHTML = cols.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('');
  sel.value = currentValue;
}

const DEFAULT_CLIENTS = [];

let state = {
  tasks: [],
  columns: null,
  myAvatarUrl: null,
  myName: null,
  recentClients: [],
  projects: [],
  pendingInvites: [],
  view: 'dashboard',
  currentProjectId: null,
  editingId: null,
  calDate: new Date(),
  calSelectedDate: null,
  miniCalDate: new Date(),
  dateFilter: 'all',
  filter: {client:'', status:'', search:'', project:'', assignee:'', tableDate:'all', kanbanClient:'', kanbanDate:'all', kanbanAssignee:''}
};

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

function isVisibleInPersonalViews(t){
  if(!t.project_id) return true;
  if(!t.assigned_to) return true;
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

function resolveCompletedAt(newStatus, oldStatus, currentValue){
  const newType = columnType(newStatus);
  const oldType = oldStatus ? columnType(oldStatus) : null;
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
      setTimeout(()=>document.getElementById('onboarding-name').focus(), 60);
      return;
    }
    onbEl.classList.remove('show');
    appEl.style.display = 'grid';
    const email = session.user.email;
    state.myName = myProfile.name;
    state.myAvatarUrl = myProfile.avatar_url || null;
    state.savedTheme = myProfile.theme || 'bluegray';
    state.soundEnabled = myProfile.sound_enabled !== false;
    applyTheme(state.savedTheme);
    state.columns = myProfile.kanban_columns || JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    document.getElementById('user-email').textContent = email;
    document.getElementById('user-name-display').textContent = state.myName;
    renderMyAvatar('user-avatar', state.myName);
    await loadTasks();
    await loadProjects();
    setupRealtime();
    startAlarmChecker();
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
  btn.textContent = 'Salvando...';
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

async function doAuth(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-btn');
  errorEl.classList.remove('show');
  if(!email || !password){errorEl.textContent = 'Preencha email e senha.';errorEl.classList.add('show');return;}
  btn.disabled = true;
  btn.textContent = 'Aguarde...';
  const fn = authMode === 'signin' ? 'signInWithPassword' : 'signUp';
  const {data, error} = await sb.auth[fn]({email, password});
  btn.disabled = false;
  btn.textContent = authMode === 'signin' ? 'Entrar' : 'Criar conta';
  if(error){errorEl.textContent = error.message;errorEl.classList.add('show');return;}
  if(authMode === 'signup' && !data.session){
    errorEl.textContent = 'Conta criada! Confira seu email pra confirmar.';
    errorEl.classList.add('show');
    return;
  }
  await checkAuth();
}

function isGoogleConnected(){
  return googleAccessToken && Date.now() < googleTokenExpiry;
}

function initGoogleClient(){
  if(googleTokenClient || typeof google === 'undefined' || GOOGLE_CLIENT_ID.includes('COLE_SEU')) return;
  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPE,
    callback: (resp)=>{
      if(resp.error){
        showToast('Erro ao conectar Google');
        return;
      }
      googleAccessToken = resp.access_token;
      googleTokenExpiry = Date.now() + (resp.expires_in * 1000) - 60000;
      showToast('Google Calendar conectado');
      updateGoogleStatusUI();
    }
  });
}

function connectGoogleCalendar(){
  if(GOOGLE_CLIENT_ID.includes('COLE_SEU')){
    alert('Configuração pendente: adicione o GOOGLE_CLIENT_ID no código.');
    return;
  }
  initGoogleClient();
  if(!googleTokenClient){
    alert('Google ainda carregando, tenta de novo em 1 segundo.');
    return;
  }
  googleTokenClient.requestAccessToken({prompt: isGoogleConnected() ? '' : 'consent'});
}

function disconnectGoogleCalendar(){
  if(googleAccessToken){
    google.accounts.oauth2.revoke(googleAccessToken, ()=>{});
  }
  googleAccessToken = null;
  googleTokenExpiry = 0;
  showToast('Google Calendar desconectado');
  updateGoogleStatusUI();
}

function updateGoogleStatusUI(){
  const el = document.getElementById('google-cal-status');
  if(!el) return;
  if(isGoogleConnected()){
    el.innerHTML = `<span style="color:var(--done);">● Conectado</span>`;
    document.getElementById('google-cal-btn').textContent = 'Desconectar';
    document.getElementById('google-cal-btn').onclick = disconnectGoogleCalendar;
  } else {
    el.innerHTML = `<span style="color:var(--text-muted);">○ Não conectado</span>`;
    document.getElementById('google-cal-btn').textContent = 'Conectar';
    document.getElementById('google-cal-btn').onclick = connectGoogleCalendar;
  }
}

async function syncTaskToGoogle(task){
  if(!isGoogleConnected()) return;
  try{
    if(!task.date){
      if(task.google_event_id) await deleteGoogleEvent(task);
      return;
    }
    const body = {
      summary: task.title,
      description: [task.client ? `Cliente: ${task.client}` : '', task.notes || ''].filter(Boolean).join('\n'),
      start: {date: task.date},
      end: {date: task.date}
    };
    let url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    let method = 'POST';
    if(task.google_event_id){
      url += '/' + task.google_event_id;
      method = 'PATCH';
    }
    const res = await fetch(url, {
      method,
      headers: {'Authorization': 'Bearer ' + googleAccessToken, 'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if(res.ok){
      const evt = await res.json();
      if(evt.id && evt.id !== task.google_event_id){
        task.google_event_id = evt.id;
        await sb.from('tasks').update({google_event_id: evt.id}).eq('id', task.id);
      }
    }
  }catch(e){}
}

async function deleteGoogleEvent(task){
  if(!isGoogleConnected() || !task.google_event_id) return;
  try{
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${task.google_event_id}`, {
      method: 'DELETE',
      headers: {'Authorization': 'Bearer ' + googleAccessToken}
    });
  }catch(e){}
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
    if(!kind || kind === 'tasks'){
      await loadTasks();
    }
    if(!kind || kind === 'projects'){
      await loadProjects();
    }
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
  if(window.Notification && Notification.permission === 'default'){
    try{ Notification.requestPermission(); }catch(e){}
  }
  checkAlarms();
  alarmCheckTimer = setInterval(checkAlarms, 20000);
}

function stopAlarmChecker(){
  if(alarmCheckTimer){clearInterval(alarmCheckTimer);alarmCheckTimer = null;}
  stopAlarmSoundLoop();
}

function checkAlarms(){
  if(!state.tasks || !state.tasks.length) return;
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  personalTasks().forEach(t=>{
    if(!t.time || t.date !== todayIso) return;
    if(taskColumnType(t) === 'done') return;
    if(t.time !== nowHM) return;
    const key = `${t.id}_${t.date}_${t.time}`;
    if(alarmedTaskKeys.has(key)) return;
    alarmedTaskKeys.add(key);
    fireAlarm(t);
  });
}

let alarmSoundInterval = null;

function playAlarmSound(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    el.innerHTML = `<img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
  } else {
    el.textContent = name[0].toUpperCase();
  }
}

async function uploadAvatar(fileInput){
  const file = fileInput.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){alert('Escolhe uma imagem.');return;}
  if(file.size > 4 * 1024 * 1024){alert('Imagem muito grande (máx 4MB).');return;}

  const ext = file.name.split('.').pop();
  const path = `${session.user.id}/avatar.${ext}`;

  const btn = document.getElementById('avatar-upload-label');
  if(btn) btn.textContent = 'Enviando...';

  const {error: upErr} = await sb.storage.from('avatars').upload(path, file, {upsert: true, cacheControl: '3600'});
  if(upErr){alert('Erro ao enviar foto: ' + upErr.message);if(btn) btn.textContent = 'Trocar foto';return;}

  const {data: urlData} = sb.storage.from('avatars').getPublicUrl(path);
  const publicUrl = urlData.publicUrl + '?t=' + Date.now();

  const {error: dbErr} = await sb.from('profiles').upsert({
    id: session.user.id,
    name: getUserName(),
    avatar_url: publicUrl,
    updated_at: new Date().toISOString()
  });
  if(dbErr){alert('Erro ao salvar: ' + dbErr.message);if(btn) btn.textContent = 'Trocar foto';return;}

  state.myAvatarUrl = publicUrl;
  renderMyAvatar('user-avatar', getUserName());
  renderMyAvatar('settings-avatar-preview', getUserName());
  if(btn) btn.textContent = 'Trocar foto';
  showToast('Foto atualizada');
}

function getUserName(){
  if(state.myName) return state.myName;
  if(!session) return '';
  const emailPart = session.user.email.split('@')[0];
  const firstPart = emailPart.split(/[._-]/)[0];
  return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
}

async function editUserName(){
  const current = getUserName();
  const newName = prompt('Como você quer ser chamado?', current);
  if(!newName || newName.trim() === '' || newName === current) return;
  const {error} = await sb.from('profiles').upsert({id: session.user.id, name: newName.trim(), updated_at: new Date().toISOString()});
  if(error){alert('Erro ao salvar nome: ' + error.message);return;}
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
    completed_at: t.completed_at || null,
    project_id: t.project_id || null,
    assigned_to: t.assigned_to || null,
    owner_id: t.user_id,
    created: new Date(t.created_at).getTime()
  }));
  render();
}

async function createTaskRemote(data){
  const {data: task, error} = await sb.from('tasks').insert({
    user_id: session.user.id,
    title: data.title,
    client: data.client || null,
    status: data.status,
    priority: data.priority,
    date: data.date || null,
    time: data.time || null,
    notes: data.notes || null,
    completed_at: data.completed_at || null,
    project_id: data.project_id || null,
    assigned_to: data.assigned_to || null
  }).select().single();
  if(error){alert('Erro ao criar tarefa: ' + error.message);return null;}
  return {
    id: task.id,
    title: task.title,
    client: task.client || '',
    status: task.status,
    priority: task.priority,
    date: task.date || '',
    time: task.time || '',
    notes: task.notes || '',
    google_event_id: null,
    completed_at: task.completed_at || null,
    project_id: task.project_id || null,
    assigned_to: task.assigned_to || null,
    owner_id: task.user_id,
    created: new Date(task.created_at).getTime()
  };
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
  if('completed_at' in data) payload.completed_at = data.completed_at || null;
  if('project_id' in data) payload.project_id = data.project_id || null;
  if('assigned_to' in data) payload.assigned_to = data.assigned_to || null;
  const {error} = await sb.from('tasks').update(payload).eq('id', id);
  if(error){alert('Erro ao atualizar: ' + error.message);return false;}
  return true;
}

async function deleteTaskRemote(id){
  const {error} = await sb.from('tasks').delete().eq('id', id);
  if(error){alert('Erro ao excluir: ' + error.message);return false;}
  return true;
}

async function loadProjects(){
  const myEmail = session.user.email;

  const {data: owned} = await sb.from('projects').select('*').eq('owner_id', session.user.id);
  const {data: memberOf} = await sb.from('project_members').select('project_id, projects(*)').eq('user_id', session.user.id).eq('status', 'accepted');
  const {data: pending} = await sb.from('project_members').select('*, projects(name)').eq('invited_email', myEmail).eq('status', 'pending');

  const projectMap = {};
  (owned || []).forEach(p=>{projectMap[p.id] = {...p, myRole: 'owner', members: []};});
  (memberOf || []).forEach(m=>{
    if(m.projects && !projectMap[m.project_id]){
      projectMap[m.project_id] = {...m.projects, myRole: 'member', members: []};
    }
  });

  const projectIds = Object.keys(projectMap);
  if(projectIds.length > 0){
    const {data: allMembers} = await sb.from('project_members').select('*').in('project_id', projectIds);
    (allMembers || []).forEach(m=>{
      if(projectMap[m.project_id]) projectMap[m.project_id].members.push(m);
    });

    const profileIds = new Set();
    Object.values(projectMap).forEach(p=>{
      if(p.owner_id) profileIds.add(p.owner_id);
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
  if(error){alert('Erro ao criar projeto: ' + error.message);return;}
  nameInput.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast('Projeto criado');
}

async function inviteToProject(projectId){
  const emailInput = document.getElementById(`invite-email-${projectId}`);
  const roleSelect = document.getElementById(`invite-role-${projectId}`);
  const email = emailInput.value.trim().toLowerCase();
  if(!email || !email.includes('@')){emailInput.focus();return;}
  const {error} = await sb.from('project_members').insert({
    project_id: projectId,
    invited_email: email,
    role: roleSelect.value,
    status: 'pending'
  });
  if(error){alert('Erro ao convidar: ' + error.message);return;}
  emailInput.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast('Convite enviado');
}

function genInviteCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
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
  if(error){alert('Erro ao gerar código: ' + error.message);return;}
  await loadProjects();
  renderProjectsModal();
  showToast(`Código gerado: ${code}`);
}

async function joinByCode(){
  const input = document.getElementById('join-code-input');
  const code = input.value.trim().toUpperCase();
  if(!code){input.focus();return;}
  const {data, error} = await sb.rpc('accept_invite_by_code', {p_code: code});
  if(error){alert('Erro: ' + error.message);return;}
  if(!data || !data.success){
    alert(data && data.error ? data.error : 'Código inválido ou já usado.');
    return;
  }
  input.value = '';
  await loadProjects();
  renderProjectsModal();
  showToast(data.already_member ? 'Você já era membro desse projeto' : 'Você entrou no projeto!');
  render();
}

async function removeMember(memberId){
  if(!confirm('Remover essa pessoa do projeto?')) return;
  const {error} = await sb.from('project_members').delete().eq('id', memberId);
  if(error){alert('Erro: ' + error.message);return;}
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
    alert('Erro ao aceitar: ' + error.message);
    return;
  }
  await loadProjects();
  renderProjectsModal();
  showToast('Convite aceito');
  render();
}

async function declineInvite(memberId){
  const {error} = await sb.from('project_members').delete().eq('id', memberId);
  if(error){alert('Erro: ' + error.message);return;}
  await loadProjects();
  renderProjectsModal();
}

async function leaveProject(projectId){
  if(!confirm('Sair deste projeto? Você perde o acesso às tarefas compartilhadas dele.')) return;
  const {error} = await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', session.user.id);
  if(error){alert('Erro ao sair: ' + error.message);return;}
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
  if(!confirm('Excluir este projeto? As tarefas voltam a ser privadas, mas o projeto some pra todo mundo.')) return;
  const {error} = await sb.from('projects').delete().eq('id', projectId);
  if(error){alert('Erro: ' + error.message);return;}
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
  state.currentProjectId = projectId;
  state.view = 'project';
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
  const html = el.innerHTML;
  const {error} = await sb.from('projects').update({notes: html}).eq('id', p.id);
  if(!error){
    p.notes = html;
    const indicator = document.getElementById('notes-save-indicator');
    if(indicator){
      indicator.textContent = 'Salvo';
      indicator.style.opacity = '1';
      setTimeout(()=>{indicator.style.opacity = '0';}, 1500);
    }
  }
}

function execEditorCmd(cmd, value){
  document.getElementById('project-notes-editor').focus();
  document.execCommand(cmd, false, value || null);
  scheduleProjectNotesSave();
}

function insertProjectImage(){
  const url = prompt('Cole o link da imagem:');
  if(!url) return;
  document.getElementById('project-notes-editor').focus();
  document.execCommand('insertImage', false, url);
  scheduleProjectNotesSave();
}

function renderProjectPage(){
  const p = state.projects.find(x=>x.id===state.currentProjectId);
  if(!p){
    return `<div class="view-header"><div><div class="eyebrow">Projeto</div><h1>Não encontrado</h1></div></div>
      <div class="empty"><strong>Esse projeto não existe mais ou você não tem acesso.</strong><button class="btn-secondary" style="margin-top:12px;" onclick="state.view='dashboard';render();">Voltar</button></div>`;
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
  const filteredProjectTasks = projectTasks.filter(t=>{
    if(state.filter.kanbanClient && t.client !== state.filter.kanbanClient) return false;
    if(state.filter.kanbanAssignee){
      if(state.filter.kanbanAssignee === 'unassigned'){ if(t.assigned_to) return false; }
      else if(t.assigned_to !== state.filter.kanbanAssignee) return false;
    }
    if(state.filter.kanbanDate && state.filter.kanbanDate !== 'all' && !matchesDateFilter(t, state.filter.kanbanDate)) return false;
    return true;
  });

  return `
    <div class="view-header">
      <div>
        <div class="eyebrow">Projeto compartilhado</div>
        <h1>${esc(p.name)}</h1>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-back" onclick="flushNotesIfPending();state.view='dashboard';render();" title="Voltar aos projetos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <button class="btn-back refresh-btn" onclick="refreshAll()" title="Atualizar agora">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
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
            <button class="editor-btn" onclick="execEditorCmd('bold')" title="Negrito"><b>B</b></button>
            <button class="editor-btn" onclick="execEditorCmd('italic')" title="Itálico"><i>I</i></button>
            <button class="editor-btn" onclick="execEditorCmd('formatBlock','H3')" title="Título">H</button>
            <button class="editor-btn" onclick="execEditorCmd('insertUnorderedList')" title="Lista">•</button>
            <button class="editor-btn" onclick="insertProjectImage()" title="Imagem">🖼</button>
          </div>` : ''}
        </div>
      </div>
      <div id="project-notes-editor" class="project-notes-editor" ${canEdit ? 'contenteditable="true"' : ''} oninput="scheduleProjectNotesSave()" data-placeholder="${canEdit ? 'Escreva aqui — contexto, links, decisões do projeto...' : 'Nenhuma nota ainda.'}">${p.notes || ''}</div>
    </div>

    <div class="glass panel" style="padding-bottom:20px;">
      <div class="panel-head">
        <div class="panel-title">Tarefas do projeto</div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${canEdit ? `<button class="btn-format" onclick="openColumnModal(null, '${p.id}')">+ Nova coluna</button>` : ''}
          <div class="panel-hint">${activeCount} ativa${activeCount!==1?'s':''} · ${projectTasks.length} no total</div>
        </div>
      </div>
      <div class="kanban-filter-row">
        <select class="select" id="kf-assignee" style="width:auto;">
          ${assigneeOptions.map(o=>`<option value="${o.id}" ${state.filter.kanbanAssignee===o.id?'selected':''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" id="kf-client" style="width:auto;">
          <option value="">Todos clientes</option>
          ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="select" id="kf-date" style="width:auto;">
          <option value="all" ${(!state.filter.kanbanDate||state.filter.kanbanDate==='all')?'selected':''}>Qualquer prazo</option>
          <option value="today" ${state.filter.kanbanDate==='today'?'selected':''}>Hoje</option>
          <option value="next3" ${state.filter.kanbanDate==='next3'?'selected':''}>Próximos dias</option>
          <option value="week" ${state.filter.kanbanDate==='week'?'selected':''}>Semana</option>
          <option value="month" ${state.filter.kanbanDate==='month'?'selected':''}>Mês</option>
        </select>
      </div>
      <div class="kanban" style="margin-top:4px;">
        ${cols.map(col=>{
          const list = sortByDateThenPriority(filteredProjectTasks.filter(t=>t.status===col.key && !isHiddenFromKanban(t)));
          return `
            <div class="glass kb-col" data-status="${col.key}" ondragover="dragOver(event)" ondrop="drop(event,'${col.key}')" ondragleave="dragLeave(event)">
              <div class="kb-col-head">
                <div class="kb-col-title"><span class="kb-col-dot" style="background:${col.color}"></span>${esc(col.name)}</div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <div class="kb-col-count">${list.length}</div>
                  ${canEdit ? `<button class="kb-col-edit" onclick="openColumnModal('${col.key}', '${p.id}')" title="Editar coluna">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>` : ''}
                </div>
              </div>
              <div class="kb-cards">
                ${list.length===0
                  ? `<div class="empty" style="padding:22px 8px;font-size:12px;"><strong>Nada aqui</strong></div>`
                  : list.map(t=>{
                    const badge = t.priority === 'urgent' ? '<span class="priority-badge urgent">🔥 Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
                    const doneCls = col.type === 'done' ? 'done' : '';
                    const assignee = getAssigneeLabel(t);
                    const assigneeBadge = assignee ? `<span class="project-badge" style="margin-bottom:6px;">👤 ${esc(assignee)}</span>` : '';
                    return `
                    <div class="kb-card ${doneCls}" style="--col-color:${col.color}" draggable="true" ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)" onclick="openModal('${t.id}')">
                      <div class="kb-card-client">${esc(t.client || '—')}</div>
                      <div class="kb-card-title">${esc(t.title)}</div>
                      ${assigneeBadge}
                      <div class="kb-card-meta">
                        <span class="${dateStatus(t.date)}">${t.date ? dateWithTime(t) : 'sem prazo'}</span>
                        ${badge}
                      </div>
                    </div>`;
                  }).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
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
  const dias = ['dom','seg','ter','qua','qui','sex','sáb'];
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
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
  if(error){alert('Erro ao comentar: ' + error.message);return;}
  input.value = '';
  await refreshComments();
}

async function deleteComment(commentId){
  if(!confirm('Excluir esse comentário?')) return;
  const {error} = await sb.from('task_comments').delete().eq('id', commentId);
  if(error){alert('Erro: ' + error.message);return;}
  await refreshComments();
}

function avatarChip(profile, fallbackChar){
  const url = profile && profile.avatar_url;
  if(url){
    return `<div class="member-avatar"><img src="${esc(url)}" alt=""></div>`;
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
            <div class="project-card-role">${isOwner ? 'Dono' : myRoleInProject(p.id) === 'editor' ? 'Editor' : 'Visualizador'}</div>
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
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
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
let toastTimer = null;
function showToast(msg){
  const old = document.querySelector('.toast');
  if(old) old.remove();
  if(toastTimer) clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="toast-dot"></span>${esc(msg)}`;
  document.body.appendChild(t);
  toastTimer = setTimeout(()=>{
    t.style.transition = 'opacity .25s ease, transform .25s ease';
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, 8px)';
    setTimeout(()=>t.remove(), 250);
  }, 2200);
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

function esc(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function updateNav(){
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.view === state.view);
  });
  const now = new Date();
  const dias = ['dom','seg','ter','qua','qui','sex','sáb'];
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
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

function render(){
  updateNav();
  const m = document.getElementById('main');
  if(state.view === 'dashboard') m.innerHTML = renderDashboard();
  else if(state.view === 'kanban') m.innerHTML = renderKanban();
  else if(state.view === 'calendar') m.innerHTML = renderCalendar();
  else if(state.view === 'table') m.innerHTML = renderTable();
  else if(state.view === 'project') m.innerHTML = renderProjectPage();
  m.scrollLeft = 0;
  attachEvents();
}

function renderDashboard(){
  const now = new Date();
  const hrs = now.getHours();
  const saudacao = hrs < 12 ? 'Bom dia' : hrs < 18 ? 'Boa tarde' : 'Boa noite';
  const cols = getColumns();
  const pTasks = personalTasks();
  const colCounts = cols.map(c=>({...c, count: pTasks.filter(t=>t.status===c.key).length}));
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
        <div class="task-date ${dateStatus(t.date)}">${dateWithTime(t)}</div>
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
      ${colCounts.map(c=>`<div class="status-item" onclick="openStatusDetail('col:${c.key}', '${esc(c.name).replace(/'/g,"\\'")}')"><div class="lbl">${esc(c.name)}</div><div class="val" data-count="${c.count}">0</div></div>`).join('')}
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
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
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
          <div class="task-date ${dateStatus(t.date)}">${dateWithTime(t)}</div>
          <span class="task-row-break"></span>
          ${badge}
          <div class="task-client">${esc(t.client || '—')}</div>
        </div>`;
    }).join('');
  }
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
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
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
        <button onclick="miniCalNav(-1)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button onclick="miniCalNav(1)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
    </div>
    <div class="mini-cal-grid">
      ${dow.map(d=>`<div class="mini-cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>`;
}

function miniCalNav(delta){state.miniCalDate.setMonth(state.miniCalDate.getMonth()+delta);render();}

function renderKanban(){
  const cols = getColumns();
  const clientOptions = [...new Set(personalTasks().map(t=>t.client).filter(Boolean))].sort();
  const filteredTasks = personalTasks().filter(t=>{
    if(state.filter.kanbanClient && t.client !== state.filter.kanbanClient) return false;
    if(state.filter.kanbanDate && state.filter.kanbanDate !== 'all' && !matchesDateFilter(t, state.filter.kanbanDate)) return false;
    return true;
  });
  return `
    <div class="view-header">
      <div><div class="eyebrow">Fluxo de trabalho</div><h1>Kanban</h1></div>
      <div class="kanban-header-actions" style="display:flex;gap:10px;">
        <button class="btn-secondary" onclick="openColumnModal()">+ Nova coluna</button>
        <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
      </div>
    </div>
    <div class="kanban-filter-row">
      <select class="select" id="kf-client" style="width:auto;">
        <option value="">Todos clientes</option>
        ${clientOptions.map(c=>`<option value="${esc(c)}" ${state.filter.kanbanClient===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <select class="select" id="kf-date" style="width:auto;">
        <option value="all" ${(!state.filter.kanbanDate||state.filter.kanbanDate==='all')?'selected':''}>Qualquer prazo</option>
        <option value="today" ${state.filter.kanbanDate==='today'?'selected':''}>Hoje</option>
        <option value="next3" ${state.filter.kanbanDate==='next3'?'selected':''}>Próximos dias</option>
        <option value="week" ${state.filter.kanbanDate==='week'?'selected':''}>Semana</option>
        <option value="month" ${state.filter.kanbanDate==='month'?'selected':''}>Mês</option>
      </select>
    </div>
    <div class="kanban">
      ${cols.map(col=>{
        const list = sortByDateThenPriority(filteredTasks.filter(t=>t.status===col.key && !isHiddenFromKanban(t)));
        return `
          <div class="glass kb-col" data-status="${col.key}" ondragover="dragOver(event)" ondrop="drop(event,'${col.key}')" ondragleave="dragLeave(event)">
            <div class="kb-col-head">
              <div class="kb-col-title"><span class="kb-col-dot" style="background:${col.color}"></span>${esc(col.name)}${col.type==='done' ? '<span class="kb-col-hint" title="Concluídos somem toda semana no domingo — o histórico fica registrado no Calendário">↻</span>' : ''}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <div class="kb-col-count">${list.length}</div>
                <div class="kb-col-drag-handle" draggable="true" ondragstart="colHeadDragStart(event,'${col.key}')" ondragend="colHeadDragEnd(event)" title="Arrastar para reordenar coluna">
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
                : list.map(t=>{
                  const badge = t.priority === 'urgent' ? '<span class="priority-badge urgent">🔥 Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
                  const doneCls = col.type === 'done' ? 'done' : '';
                  const pName = t.project_id ? projectName(t.project_id) : null;
                  const projBadge = pName ? `<span class="project-badge" style="margin-bottom:6px;">👥 ${esc(pName)}</span>` : '';
                  return `
                  <div class="kb-card ${doneCls}" style="--col-color:${col.color}" draggable="true" ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)" onclick="openModal('${t.id}')">
                    <div class="kb-card-client">${esc(t.client || '—')}</div>
                    <div class="kb-card-title">${esc(t.title)}</div>
                    ${projBadge}
                    <div class="kb-card-meta">
                      <span class="${dateStatus(t.date)}">${t.date ? dateWithTime(t) : 'sem prazo'}</span>
                      ${badge}
                    </div>
                  </div>`;
                }).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

let draggingColumnKey = null;
let dragOriginalOrder = null;
let dragPreviewOrder = null;
let dragOriginalRects = null;

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

function colHeadDragStart(e, key){
  draggingColumnKey = key;
  const colEl = e.currentTarget.closest('.kb-col');
  const container = colEl.closest('.kanban');
  const cols = [...container.querySelectorAll(':scope > .kb-col')];
  dragOriginalOrder = cols.map(el=>el.dataset.status);
  dragPreviewOrder = [...dragOriginalOrder];
  dragOriginalRects = new Map(cols.map(el=>[el.dataset.status, el.getBoundingClientRect()]));
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  setTimeout(()=>{ colEl.classList.add('dragging'); }, 0);
}

function applyColumnPreview(container){
  container.querySelectorAll(':scope > .kb-col').forEach(el=>{
    const key = el.dataset.status;
    const originalRect = dragOriginalRects.get(key);
    const slotKey = dragPreviewOrder[dragOriginalOrder.indexOf(key)];
    const slotRect = dragOriginalRects.get(slotKey);
    const dx = slotRect.left - originalRect.left;
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  });
}

function colHeadDragEnd(e){
  const colEl = e.currentTarget.closest('.kb-col');
  const container = colEl ? colEl.closest('.kanban') : null;
  if(colEl) colEl.classList.remove('dragging');
  if(container){
    container.querySelectorAll(':scope > .kb-col').forEach(el=>{ el.style.transform = ''; });
  }
  const changed = dragPreviewOrder && dragOriginalOrder && dragPreviewOrder.join() !== dragOriginalOrder.join();
  draggingColumnKey = null;
  if(changed){
    const finalOrder = dragPreviewOrder;
    dragPreviewOrder = null; dragOriginalOrder = null; dragOriginalRects = null;
    commitColumnOrder(finalOrder).then(()=>render());
  }else{
    dragPreviewOrder = null; dragOriginalOrder = null; dragOriginalRects = null;
  }
}
async function commitColumnOrder(orderedKeys){
  if(!state.columns) state.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
  const byKey = {};
  state.columns.forEach(c=>{byKey[c.key]=c;});
  const reordered = orderedKeys.map(k=>byKey[k]).filter(Boolean);
  state.columns.forEach(c=>{ if(!reordered.includes(c)) reordered.push(c); });
  state.columns = reordered;
  await persistColumns();
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
  if(draggingColumnKey){
    const target = e.currentTarget;
    if(!target.classList.contains('kb-col')) return;
    const targetKey = target.dataset.status;
    if(targetKey === draggingColumnKey) return;
    const rect = dragOriginalRects.get(targetKey) || target.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width/2;
    const fromIdx = dragPreviewOrder.indexOf(draggingColumnKey);
    dragPreviewOrder.splice(fromIdx, 1);
    let toIdx = dragPreviewOrder.indexOf(targetKey);
    if(after) toIdx += 1;
    dragPreviewOrder.splice(toIdx, 0, draggingColumnKey);
    applyColumnPreview(target.parentNode);
    return;
  }
  e.currentTarget.classList.add('drag-over');
}
function dragLeave(e){
  if(draggingColumnKey) return;
  e.currentTarget.classList.remove('drag-over');
}
async function drop(e, status){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(draggingColumnKey) return;
  const id = e.dataTransfer.getData('text/plain');
  const task = state.tasks.find(t=>t.id===id);
  if(task && task.status !== status){
    const prevStatus = task.status;
    const prevCompletedAt = task.completed_at;
    task.completed_at = resolveCompletedAt(status, prevStatus, task.completed_at);
    task.status = status;
    render();
    const ok = await updateTaskRemote(id, task);
    if(!ok){task.status = prevStatus;task.completed_at = prevCompletedAt;render();}
    else if(task.completed_at !== prevCompletedAt) syncTaskToGoogle(task);
  }
}

function renderCalendar(){
  const d = state.calDate;
  const year = d.getFullYear(), month = d.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const dow = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const dowShort = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const today = new Date();
  const tasksByDate = {};
  personalTasks().forEach(t=>{
    const isDone = taskColumnType(t) === 'done';
    const key = (isDone && t.completed_at) ? isoDateFromTimestamp(t.completed_at) : t.date;
    if(key){if(!tasksByDate[key]) tasksByDate[key] = [];tasksByDate[key].push(t);}
  });

  let cells = '';
  const prevMonthDays = new Date(year, month, 0).getDate();
  for(let i=startDow-1;i>=0;i--) cells += `<div class="cal-cell other"><div class="cal-cell-num">${prevMonthDays-i}</div></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getDate()===day && today.getMonth()===month && today.getFullYear()===year;
    const isSelected = state.calSelectedDate === iso;
    const list = tasksByDate[iso] || [];
    const wd = (startDow + day - 1) % 7;
    cells += `
      <div class="cal-cell ${isToday?'today':''} ${isSelected?'selected':''} ${list.length===0?'is-empty':''}" data-date="${iso}">
        <div class="cal-cell-num"><span class="cal-cell-dow">${dowShort[wd]} </span>${day}</div>
        ${list.map(t=>{
          const isDone = taskColumnType(t)==='done';
          return `<div class="cal-task" style="border-left-color:${taskColumnColor(t)};${isDone?'opacity:0.6;':''}" data-task-id="${t.id}" title="${esc(t.title)}${isDone?' (concluída)':''}">${isDone?'✓ ':''}${esc(t.title)}</div>`;
        }).join('')}
      </div>`;
  }
  const filled = startDow + daysInMonth;
  const trailing = (7 - filled % 7) % 7;
  for(let i=1;i<=trailing;i++) cells += `<div class="cal-cell other"><div class="cal-cell-num">${i}</div></div>`;

  const dayPanel = state.calSelectedDate ? renderDayPanel(state.calSelectedDate, tasksByDate[state.calSelectedDate] || []) : '';
  const hasAnyTaskThisMonth = Object.keys(tasksByDate).some(iso => iso.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
  const emptyMonthHint = !hasAnyTaskThisMonth ? `<div class="empty cal-empty-mobile" style="margin-top:10px;"><strong>Nada agendado em ${meses[month].toLowerCase()}.</strong>Toque em um dia pra criar uma tarefa.</div>` : '';

  return `
    <div class="view-header">
      <div><div class="eyebrow">Prazos e agenda</div><h1>Calendário</h1></div>
      <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
    </div>
    <div class="glass cal-view">
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
      </div>
      ${emptyMonthHint}
    </div>
    ${dayPanel}`;
}

function renderDayPanel(iso, tasks){
  const [y,m,d] = iso.split('-');
  const dt = new Date(+y, +m-1, +d);
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const dateLabel = `${dias[dt.getDay()]}, ${+d} de ${meses[+m-1]}`;

  return `
    <div class="glass day-panel">
      <div class="day-panel-head">
        <div class="day-panel-date">${dateLabel}</div>
        <div class="day-panel-actions">
          <button class="btn-primary" onclick="openModal(null,'${iso}')">+ Adicionar neste dia</button>
          <button class="day-panel-close" onclick="selectCalDay(null)" title="Fechar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      ${tasks.length===0
        ? `<div class="empty"><strong>Nada agendado neste dia.</strong>Clica em "Adicionar neste dia" pra criar uma tarefa.</div>`
        : `<div class="day-panel-tasks">
            ${tasks.map(t=>{
              const priorityBadge = t.priority === 'urgent' ? '<span class="priority-badge urgent">🔥 Urgente</span>' : t.priority === 'high' ? '<span class="priority-badge high">Alta</span>' : '';
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
                  </div>
                  ${t.notes ? `<div class="day-task-notes">${esc(t.notes)}</div>` : ''}
                </div>`;
            }).join('')}
          </div>`
      }
    </div>`;
}

function selectCalDay(iso){
  state.calSelectedDate = (state.calSelectedDate === iso) ? null : iso;
  render();
  if(state.calSelectedDate){
    setTimeout(()=>{
      const panel = document.querySelector('.day-panel');
      if(panel) panel.scrollIntoView({behavior:'smooth', block:'nearest'});
    }, 50);
  }
}

function calNav(delta){state.calDate.setMonth(state.calDate.getMonth()+delta);render();}
function calToday(){state.calDate = new Date();render();}

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

  let filtered = baseTasks;
  if(state.filter.status) filtered = filtered.filter(t=>t.status===state.filter.status);
  if(state.filter.client) filtered = filtered.filter(t=>t.client===state.filter.client);
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
        <input type="text" class="input search" id="f-search" placeholder="Buscar por título, cliente ou notas..." value="${esc(state.filter.search)}">
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
                  <td>${esc(t.title)}</td>
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
  document.querySelectorAll('.status-item .val[data-count]').forEach(el=>{
    animateCount(el, parseInt(el.dataset.count, 10) || 0);
  });
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el=>{el.onclick = ()=>{flushNotesIfPending();state.view = el.dataset.view;render();window.scrollTo(0,0);};});
  const fs = document.getElementById('f-search');
  if(fs) fs.oninput = (e)=>{state.filter.search = e.target.value;render();document.getElementById('f-search').focus();};
  const fst = document.getElementById('f-status');
  if(fst) fst.onchange = (e)=>{state.filter.status = e.target.value;render();};
  const fc = document.getElementById('f-client');
  if(fc) fc.onchange = (e)=>{state.filter.client = e.target.value;render();};
  const fp = document.getElementById('f-project');
  if(fp) fp.onchange = (e)=>{state.filter.project = e.target.value;state.filter.status='';state.filter.client='';state.filter.assignee='';render();};
  const fa = document.getElementById('f-assignee');
  if(fa) fa.onchange = (e)=>{state.filter.assignee = e.target.value;render();};
  const ftd = document.getElementById('f-table-date');
  if(ftd) ftd.onchange = (e)=>{state.filter.tableDate = e.target.value;render();};

  const kfc = document.getElementById('kf-client');
  if(kfc) kfc.onchange = (e)=>{state.filter.kanbanClient = e.target.value;render();};
  const kfd = document.getElementById('kf-date');
  if(kfd) kfd.onchange = (e)=>{state.filter.kanbanDate = e.target.value;render();};
  const kfa = document.getElementById('kf-assignee');
  if(kfa) kfa.onchange = (e)=>{state.filter.kanbanAssignee = e.target.value;render();};

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

function openModal(id, prefillDate, prefillProjectId){
  state.editingId = id || null;
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const delBtn = document.getElementById('m-delete');
  const commentsField = document.getElementById('m-comments-field');
  populateProjectSelect();
  if(id){
    const t = state.tasks.find(x=>x.id===id);
    if(!t) return;
    title.textContent = 'Editar tarefa';
    document.getElementById('m-title').value = t.title || '';
    document.getElementById('m-client').value = t.client || '';
    populateStatusSelect('m-status', t.status || getColumns()[0].key, t.project_id);
    document.getElementById('m-date').value = t.date || '';
    document.getElementById('m-time').value = t.time || '';
    document.getElementById('m-priority').value = t.priority || 'normal';
    document.getElementById('m-project').value = t.project_id || '';
    populateAssigneeSelect(t.project_id, t.assigned_to);
    document.getElementById('m-notes').value = t.notes || '';
    const isMine = t.owner_id === session.user.id;
    const canEdit = isMine || (t.project_id && canEditProject(t.project_id));
    delBtn.style.display = canEdit ? '' : 'none';
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format, #modal .time-clear-btn').forEach(el=>{el.disabled = !canEdit;});
    commentsField.style.display = '';
    currentCommentTaskId = id;
    document.getElementById('task-comments-list').innerHTML = `<div class="empty" style="padding:16px 12px;font-size:11.5px;">Carregando...</div>`;
    refreshComments();
  }else{
    title.textContent = 'Nova tarefa';
    document.getElementById('m-title').value = '';
    document.getElementById('m-client').value = '';
    populateStatusSelect('m-status', getProjectColumns(state.projects.find(p=>p.id===prefillProjectId))[0].key, prefillProjectId);
    document.getElementById('m-date').value = prefillDate || '';
    document.getElementById('m-time').value = `${String(new Date().getHours()).padStart(2,'0')}:${String(new Date().getMinutes()).padStart(2,'0')}`;
    document.getElementById('m-priority').value = 'normal';
    document.getElementById('m-project').value = prefillProjectId || '';
    populateAssigneeSelect(prefillProjectId, null);
    document.getElementById('m-notes').value = '';
    delBtn.style.display = 'none';
    document.querySelectorAll('#modal input, #modal select, #modal textarea').forEach(el=>{el.disabled = false;});
    commentsField.style.display = 'none';
    currentCommentTaskId = null;
  }
  document.getElementById('m-project').onchange = (e)=>{
    populateStatusSelect('m-status', getProjectColumns(state.projects.find(p=>p.id===e.target.value))[0].key, e.target.value || null);
    populateAssigneeSelect(e.target.value || null, null);
  };
  modal.classList.add('open');
  setTimeout(()=>document.getElementById('m-title').focus(), 50);
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
    return `<div class="client-suggestion-item" onmousedown="selectClientSuggestion('${c.replace(/'/g,"\\'")}')">${label}</div>`;
  }).join('');
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

async function saveTask(){
  const title = document.getElementById('m-title').value.trim();
  if(!title){document.getElementById('m-title').focus();return;}
  const newStatus = document.getElementById('m-status').value;
  const existingTask = state.editingId ? state.tasks.find(x=>x.id===state.editingId) : null;
  const data = {
    title,
    client: document.getElementById('m-client').value.trim(),
    status: newStatus,
    date: document.getElementById('m-date').value,
    time: document.getElementById('m-time').value,
    priority: document.getElementById('m-priority').value,
    notes: document.getElementById('m-notes').value.trim(),
    project_id: document.getElementById('m-project').value || null,
    assigned_to: document.getElementById('m-assignee').value || null,
    completed_at: resolveCompletedAt(newStatus, existingTask ? existingTask.status : null, existingTask ? existingTask.completed_at : null)
  };
  const isNew = !state.editingId;
  let savedTask = null;
  if(state.editingId){
    const ok = await updateTaskRemote(state.editingId, data);
    if(ok){
      const t = state.tasks.find(x=>x.id===state.editingId);
      Object.assign(t, data);
      savedTask = t;
    }
  }else{
    const newTask = await createTaskRemote(data);
    if(newTask){state.tasks.push(newTask);savedTask = newTask;}
  }
  closeModal();render();
  showToast(isNew ? 'Tarefa criada' : 'Alterações salvas');
  if(savedTask) syncTaskToGoogle(savedTask);
}

async function deleteTask(){
  if(!state.editingId) return;
  if(!confirm('Excluir esta tarefa?')) return;
  const t = state.tasks.find(x=>x.id===state.editingId);
  const ok = await deleteTaskRemote(state.editingId);
  if(ok){
    if(t) deleteGoogleEvent(t);
    state.tasks = state.tasks.filter(x=>x.id !== state.editingId);
    closeModal();render();
    showToast('Tarefa excluída');
  }
}

async function quickAdd(){
  const title = document.getElementById('qa-title').value.trim();
  if(!title){document.getElementById('qa-title').focus();return;}
  const data = {
    title,
    client: document.getElementById('qa-client').value.trim(),
    status: getColumns()[0].key,
    date: document.getElementById('qa-date').value,
    priority: 'normal',
    notes: ''
  };
  const newTask = await createTaskRemote(data);
  if(newTask){state.tasks.push(newTask);render();}
}

document.getElementById('modal').addEventListener('click', (e)=>{if(e.target.id === 'modal') closeModal();});
document.getElementById('settings-modal').addEventListener('click', (e)=>{if(e.target.id === 'settings-modal') closeSettings();});
document.getElementById('column-modal').addEventListener('click', (e)=>{if(e.target.id === 'column-modal') closeColumnModal();});
document.getElementById('status-modal').addEventListener('click', (e)=>{if(e.target.id === 'status-modal') closeStatusModal();});
document.getElementById('projects-modal').addEventListener('click', (e)=>{if(e.target.id === 'projects-modal') closeProjectsModal();});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    closeModal();
    closeSettings();
    closeColumnModal();
    closeStatusModal();
    closeProjectsModal();
  }
  if(e.key === 'n' && !document.getElementById('modal').classList.contains('open') && !document.getElementById('settings-modal').classList.contains('open') && !document.getElementById('column-modal').classList.contains('open') && !document.getElementById('status-modal').classList.contains('open') && !document.getElementById('projects-modal').classList.contains('open') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'){
    e.preventDefault();openModal();
  }
});

checkAuth();
