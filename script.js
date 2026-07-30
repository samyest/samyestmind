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
}

function openSettings(){
  document.getElementById('s-name').value = getUserName();
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
    <div class="settings-col-item">
      <div class="settings-col-dot" style="background:${c.color}"></div>
      <div class="settings-col-name">${esc(c.name)}</div>
      <button class="settings-col-edit" onclick="openColumnModal('${c.key}')" title="Editar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
    </div>
  `).join('');
}

function closeSettings(){
  const original = (session?.user?.user_metadata?.theme) || 'bluegray';
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
  const {error} = await sb.auth.updateUser({data: {name, theme: currentTheme}});
  if(error){alert('Erro ao salvar: ' + error.message);return;}
  const {data} = await sb.auth.getSession();
  session = data.session;
  document.getElementById('settings-modal').classList.remove('open');
  render();
  const userName = getUserName();
  document.getElementById('user-name-display').textContent = userName;
  document.getElementById('user-avatar').textContent = userName[0].toUpperCase();
}
const DEFAULT_COLUMNS = [
  {key:'todo', name:'A Fazer', color:'#9AAFC2', type:'active'},
  {key:'waiting', name:'Aguardando', color:'#C9A868', type:'waiting'},
  {key:'doing', name:'Em Andamento', color:'#5B7A94', type:'active'},
  {key:'done', name:'Concluído', color:'#8FA88C', type:'done'}
];
const COLUMN_COLOR_PRESETS = ['#9AAFC2','#C9A868','#5B7A94','#8FA88C','#C48577','#B084CC','#5CC2C6','#D4826B'];
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

async function persistColumns(){
  const {error} = await sb.auth.updateUser({data: {kanban_columns: state.columns}});
  if(error){alert('Erro ao salvar colunas: ' + error.message);return false;}
  const {data} = await sb.auth.getSession();
  session = data.session;
  return true;
}

function renderColorSwatches(){
  const wrap = document.getElementById('col-color-swatches');
  if(!wrap) return;
  wrap.innerHTML = COLUMN_COLOR_PRESETS.map(c=>`
    <button type="button" class="color-swatch-btn ${c===selectedColumnColor?'selected':''}" style="background:${c}" onclick="selectColumnColor('${c}')"></button>
  `).join('');
}
function selectColumnColor(c){
  selectedColumnColor = c;
  renderColorSwatches();
}

function openStatusDetail(filterKey, label){
  let list;
  if(filterKey === 'overdue'){
    list = state.tasks.filter(t=>columnType(t.status)!=='done' && dateStatus(t.date)==='overdue');
  } else {
    const key = filterKey.replace('col:', '');
    list = state.tasks.filter(t=>t.status===key);
  }
  list.sort((a,b)=>{
    const pa = priorityWeight(a), pb = priorityWeight(b);
    if(pa !== pb) return pb - pa;
    if(!a.date) return 1;
    if(!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  document.getElementById('status-modal-title').textContent = label;
  const body = document.getElementById('status-modal-body');
  if(list.length === 0){
    body.innerHTML = `<div class="empty"><strong>Nada por aqui.</strong>Nenhuma tarefa nessa categoria.</div>`;
  } else {
    body.innerHTML = list.map(t=>{
      const isUrgent = t.priority === 'urgent';
      const isHigh = t.priority === 'high';
      const badge = isUrgent
        ? '<span class="priority-badge urgent">🔥 Urgente</span>'
        : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
      const cls = isUrgent ? 'urgent' : (isHigh ? 'high' : '');
      const dot = statusDotStyle(t.status);
      return `
        <div class="task-row ${cls}" onclick="closeStatusModal();openModal('${t.id}')">
          <div class="task-check ${dot.cls}" style="${dot.style}"></div>
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-date ${dateStatus(t.date)}">${t.date ? fmtDate(t.date) : '—'}</div>
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

function openColumnModal(key){
  editingColumnKey = key || null;
  const modal = document.getElementById('column-modal');
  const title = document.getElementById('column-modal-title');
  const delBtn = document.getElementById('col-delete');
  if(key){
    const col = getColumn(key);
    title.textContent = 'Editar coluna';
    document.getElementById('col-name').value = col.name;
    selectedColumnColor = col.color;
    delBtn.style.display = getColumns().length > 1 ? '' : 'none';
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
}

async function saveColumn(){
  const name = document.getElementById('col-name').value.trim();
  if(!name){document.getElementById('col-name').focus();return;}
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
  const cols = getColumns();
  if(cols.length <= 1){alert('Precisa ter ao menos uma coluna.');return;}
  const hasTasks = state.tasks.some(t=>t.status===editingColumnKey);
  if(hasTasks && !confirm('Essa coluna tem tarefas — elas serão movidas para a primeira coluna restante. Continuar?')) return;
  const fallback = cols.find(c=>c.key !== editingColumnKey);
  const toMove = state.tasks.filter(t=>t.status===editingColumnKey);
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

function populateStatusSelect(selectId, currentValue){
  const sel = document.getElementById(selectId);
  sel.innerHTML = getColumns().map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('');
  sel.value = currentValue;
}

const DEFAULT_CLIENTS = ['Elliz B (Donna da Lua)','Adelso Costa','Conteinner','Alex','Jmavell','Interno','TruthCommerce','Ascent','Espumart'];

let state = {
  tasks: [],
  columns: null,
  projects: [],
  pendingInvites: [],
  view: 'dashboard',
  editingId: null,
  calDate: new Date(),
  calSelectedDate: null,
  miniCalDate: new Date(),
  dateFilter: 'all',
  filter: {client:'', status:'', search:''}
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

function isHiddenFromKanban(t){
  if(columnType(t.status) !== 'done') return false;
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
  if(dateStatus(t.date) === 'overdue' && columnType(t.status) !== 'done') return 3.5;
  if(t.priority === 'high') return 3;
  if(dateStatus(t.date) === 'today') return 2;
  return 1;
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
    const meta = session.user.user_metadata || {};
    if(!meta.name){
      appEl.style.display = 'none';
      onbEl.classList.add('show');
      setTimeout(()=>document.getElementById('onboarding-name').focus(), 60);
      return;
    }
    onbEl.classList.remove('show');
    appEl.style.display = 'grid';
    const email = session.user.email;
    const name = getUserName();
    const savedTheme = (session.user.user_metadata || {}).theme || 'bluegray';
    applyTheme(savedTheme);
    state.columns = (session.user.user_metadata || {}).kanban_columns || JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    document.getElementById('user-email').textContent = email;
    document.getElementById('user-name-display').textContent = name;
    document.getElementById('user-avatar').textContent = name[0].toUpperCase();
    await loadTasks();
    await loadProjects();
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
  const {error} = await sb.auth.updateUser({data: {name}});
  btn.disabled = false;
  btn.textContent = 'Continuar';
  if(error){errorEl.textContent = error.message;errorEl.classList.add('show');return;}
  const {data} = await sb.auth.getSession();
  session = data.session;
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

async function logout(){
  await sb.auth.signOut();
  location.reload();
}

function getUserName(){
  if(!session) return '';
  const meta = session.user.user_metadata || {};
  if(meta.name) return meta.name;
  if(meta.full_name) return meta.full_name.split(' ')[0];
  const emailPart = session.user.email.split('@')[0];
  const firstPart = emailPart.split(/[._-]/)[0];
  return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
}

async function editUserName(){
  const current = getUserName();
  const newName = prompt('Como você quer ser chamado?', current);
  if(!newName || newName.trim() === '' || newName === current) return;
  const {error} = await sb.auth.updateUser({data: {name: newName.trim()}});
  if(error){alert('Erro ao salvar nome: ' + error.message);return;}
  const {data} = await sb.auth.getSession();
  session = data.session;
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
    notes: t.notes || '',
    google_event_id: t.google_event_id || null,
    completed_at: t.completed_at || null,
    project_id: t.project_id || null,
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
    notes: data.notes || null,
    completed_at: data.completed_at || null,
    project_id: data.project_id || null
  }).select().single();
  if(error){alert('Erro ao criar tarefa: ' + error.message);return null;}
  return {
    id: task.id,
    title: task.title,
    client: task.client || '',
    status: task.status,
    priority: task.priority,
    date: task.date || '',
    notes: task.notes || '',
    google_event_id: null,
    completed_at: task.completed_at || null,
    project_id: task.project_id || null,
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
  if('completed_at' in data) payload.completed_at = data.completed_at || null;
  if('project_id' in data) payload.project_id = data.project_id || null;
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
      return `
        <button class="sidebar-project-item" onclick="openProjectsModal()" title="${esc(p.name)}">
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
  const {error} = await sb.from('projects').insert({name, owner_id: session.user.id});
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
  showToast('Você entrou no projeto!');
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
  const {error} = await sb.from('project_members').update({user_id: session.user.id, status: 'accepted'}).eq('id', memberId);
  if(error){alert('Erro ao aceitar: ' + error.message);return;}
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

async function deleteProject(projectId){
  if(!confirm('Excluir este projeto? As tarefas voltam a ser privadas, mas o projeto some pra todo mundo.')) return;
  const {error} = await sb.from('projects').delete().eq('id', projectId);
  if(error){alert('Erro: ' + error.message);return;}
  await loadProjects();
  renderProjectsModal();
  showToast('Projeto excluído');
  render();
}

function openProjectsModal(){
  renderProjectsModal();
  document.getElementById('projects-modal').classList.add('open');
}
function closeProjectsModal(){
  document.getElementById('projects-modal').classList.remove('open');
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
      const membersHtml = p.members.length === 0
        ? `<div style="font-size:12px;color:var(--text-soft);padding:6px 0;">Ninguém convidado ainda.</div>`
        : p.members.map(m=>{
          const label = m.code
            ? `Código: <span style="color:var(--text-strong);font-family:'JetBrains Mono',monospace;letter-spacing:0.08em;">${esc(m.code)}</span>`
            : esc(m.invited_email || '—');
          return `
          <div class="member-row">
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
          ` : ''}
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
  const overdue = state.tasks.filter(t=>columnType(t.status)!=='done' && dateStatus(t.date)==='overdue').length;
  const today = state.tasks.filter(t=>columnType(t.status)!=='done' && dateStatus(t.date)==='today').length;
  document.getElementById('today-hint').textContent = overdue > 0 ? `${overdue} atrasada${overdue>1?'s':''}` : today > 0 ? `${today} vence hoje` : 'tudo em dia';

  const list = document.getElementById('clients-list');
  if(list){
    const set = new Set(DEFAULT_CLIENTS);
    state.tasks.forEach(t=>{if(t.client) set.add(t.client);});
    list.innerHTML = [...set].map(c=>`<option value="${esc(c)}">`).join('');
  }
}

function render(){
  updateNav();
  const m = document.getElementById('main');
  if(state.view === 'dashboard') m.innerHTML = renderDashboard();
  else if(state.view === 'kanban') m.innerHTML = renderKanban();
  else if(state.view === 'calendar') m.innerHTML = renderCalendar();
  else if(state.view === 'table') m.innerHTML = renderTable();
  m.scrollLeft = 0;
  attachEvents();
}

function renderDashboard(){
  const now = new Date();
  const hrs = now.getHours();
  const saudacao = hrs < 12 ? 'Bom dia' : hrs < 18 ? 'Boa tarde' : 'Boa noite';
  const cols = getColumns();
  const colCounts = cols.map(c=>({...c, count: state.tasks.filter(t=>t.status===c.key).length}));
  const overdue = state.tasks.filter(t=>columnType(t.status)!=='done' && dateStatus(t.date)==='overdue').length;
  const acoes = state.tasks
    .filter(t=>columnType(t.status)==='active' && matchesDateFilter(t, state.dateFilter))
    .sort((a,b)=>{
      const pa = priorityWeight(a), pb = priorityWeight(b);
      if(pa !== pb) return pb - pa;
      if(!a.date) return 1;
      if(!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
  const aguardando = state.tasks
    .filter(t=>columnType(t.status)==='waiting' && matchesDateFilter(t, state.dateFilter))
    .sort((a,b)=>{
      const pa = priorityWeight(a), pb = priorityWeight(b);
      if(pa !== pb) return pb - pa;
      if(!a.date) return 1;
      if(!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
  const dataStr = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});

  const renderTaskRow = (t)=>{
    const isUrgent = t.priority === 'urgent';
    const isHigh = t.priority === 'high';
    const badge = isUrgent
      ? '<span class="priority-badge urgent">🔥 Urgente</span>'
      : isHigh ? '<span class="priority-badge high">Alta</span>' : '';
    const cls = isUrgent ? 'urgent' : (isHigh ? 'high' : '');
    const dot = statusDotStyle(t.status);
    const pName = t.project_id ? projectName(t.project_id) : null;
    const projBadge = pName ? `<span class="project-badge">👥 ${esc(pName)}</span>` : '';
    return `
      <div class="task-row ${cls}" onclick="openModal('${t.id}')">
        <div class="task-check ${dot.cls}" style="${dot.style}"></div>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-date ${dateStatus(t.date)}">${t.date ? fmtDate(t.date) : '—'}</div>
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
    <div class="date-filter">
      <span class="date-filter-label">Prazo:</span>
      <button class="date-pill ${state.dateFilter==='all'?'active':''}" onclick="setDateFilter('all')">Todas</button>
      <button class="date-pill ${state.dateFilter==='today'?'active':''}" onclick="setDateFilter('today')">Hoje</button>
      <button class="date-pill ${state.dateFilter==='next3'?'active':''}" onclick="setDateFilter('next3')">Próximos dias</button>
      <button class="date-pill ${state.dateFilter==='week'?'active':''}" onclick="setDateFilter('week')">Semana</button>
      <button class="date-pill ${state.dateFilter==='month'?'active':''}" onclick="setDateFilter('month')">Mês</button>
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
  const active = state.tasks.filter(t=>columnType(t.status)!=='done');
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
  const tasksWithDate = new Set(state.tasks.filter(t=>t.date && columnType(t.status)!=='done').map(t=>t.date));

  let cells = '';
  for(let i=startDow-1;i>=0;i--) cells += `<div class="mini-cal-day other">${prevMonthDays-i}</div>`;
  for(let day=1;day<=daysInMonth;day++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getDate()===day && today.getMonth()===month && today.getFullYear()===year;
    const hasTask = tasksWithDate.has(iso);
    cells += `<div class="mini-cal-day ${isToday?'today':''} ${hasTask?'has-task':''}">${day}</div>`;
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
  return `
    <div class="view-header">
      <div><div class="eyebrow">Fluxo de trabalho</div><h1>Kanban</h1></div>
      <div class="kanban-header-actions" style="display:flex;gap:10px;">
        <button class="btn-secondary" onclick="openColumnModal()">+ Nova coluna</button>
        <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
      </div>
    </div>
    <div class="kanban">
      ${cols.map(col=>{
        const list = state.tasks.filter(t=>t.status===col.key && !isHiddenFromKanban(t));
        return `
          <div class="glass kb-col" data-status="${col.key}" ondragover="dragOver(event)" ondrop="drop(event,'${col.key}')" ondragleave="dragLeave(event)">
            <div class="kb-col-head">
              <div class="kb-col-title"><span class="kb-col-dot" style="background:${col.color}"></span>${esc(col.name)}${col.type==='done' ? '<span class="kb-col-hint" title="Concluídos somem toda semana no domingo — o histórico fica registrado no Calendário">↻</span>' : ''}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <div class="kb-col-count">${list.length}</div>
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
                      <span class="${dateStatus(t.date)}">${t.date ? fmtDate(t.date) : 'sem prazo'}</span>
                      ${badge}
                    </div>
                  </div>`;
                }).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function dragStart(e, id){
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(()=>e.target.classList.add('dragging'), 0);
}
function dragEnd(e){
  e.target.classList.remove('dragging');
}
function dragOver(e){e.preventDefault();e.currentTarget.classList.add('drag-over');}
function dragLeave(e){e.currentTarget.classList.remove('drag-over');}
async function drop(e, status){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
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
  state.tasks.forEach(t=>{
    const isDone = columnType(t.status) === 'done';
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
          const isDone = columnType(t.status)==='done';
          return `<div class="cal-task" style="border-left-color:${columnColor(t.status)};${isDone?'opacity:0.6;':''}" data-task-id="${t.id}" title="${esc(t.title)}${isDone?' (concluída)':''}">${isDone?'✓ ':''}${esc(t.title)}</div>`;
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
                <div class="day-task ${columnType(t.status)==='done'?'done':''}" style="--col-color:${columnColor(t.status)}" onclick="openModal('${t.id}')">
                  <div class="day-task-head">
                    <div class="day-task-title">${esc(t.title)}</div>
                    ${priorityBadge}
                  </div>
                  <div class="day-task-meta">
                    <span>${esc(t.client || 'sem cliente')}</span>
                    <span>·</span>
                    <span>${esc(columnName(t.status))}</span>
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
  const clientes = [...new Set(state.tasks.map(t=>t.client).filter(Boolean))].sort();
  let filtered = [...state.tasks];
  if(state.filter.status) filtered = filtered.filter(t=>t.status===state.filter.status);
  if(state.filter.client) filtered = filtered.filter(t=>t.client===state.filter.client);
  if(state.filter.search){
    const s = state.filter.search.toLowerCase();
    filtered = filtered.filter(t=>(t.title||'').toLowerCase().includes(s) || (t.client||'').toLowerCase().includes(s) || (t.notes||'').toLowerCase().includes(s));
  }
  filtered.sort((a,b)=>{if(!a.date) return 1;if(!b.date) return -1;return a.date.localeCompare(b.date);});

  return `
    <div class="view-header">
      <div><div class="eyebrow">Visão completa</div><h1>Todas as tarefas</h1></div>
      <button class="btn-primary" onclick="openModal()">+ Nova tarefa</button>
    </div>
    <div class="glass table-view">
      <div class="table-filters">
        <input type="text" class="input search" id="f-search" placeholder="Buscar por título, cliente ou notas..." value="${esc(state.filter.search)}">
        <select class="select" id="f-status" style="width:auto;">
          <option value="">Todos status</option>
          ${getColumns().map(c=>`<option value="${c.key}" ${state.filter.status===c.key?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select class="select" id="f-client" style="width:auto;">
          <option value="">Todos clientes</option>
          ${clientes.map(c=>`<option value="${esc(c)}" ${state.filter.client===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${filtered.length===0
        ? `<div class="empty" style="margin:28px;"><strong>Nenhuma tarefa encontrada</strong>Ajuste os filtros ou crie uma nova.</div>`
        : `<div class="table-scroll"><table class="task-table">
            <thead><tr><th>Tarefa</th><th>Cliente</th><th>Status</th><th>Prazo</th></tr></thead>
            <tbody>
              ${filtered.map(t=>`
                <tr onclick="openModal('${t.id}')">
                  <td>${esc(t.title)}</td>
                  <td>${esc(t.client || '—')}</td>
                  <td><span class="badge"><span class="badge-dot" style="background:${columnColor(t.status)}"></span>${esc(columnName(t.status))}</span></td>
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
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el=>{el.onclick = ()=>{state.view = el.dataset.view;render();window.scrollTo(0,0);};});
  const fs = document.getElementById('f-search');
  if(fs) fs.oninput = (e)=>{state.filter.search = e.target.value;render();document.getElementById('f-search').focus();};
  const fst = document.getElementById('f-status');
  if(fst) fst.onchange = (e)=>{state.filter.status = e.target.value;render();};
  const fc = document.getElementById('f-client');
  if(fc) fc.onchange = (e)=>{state.filter.client = e.target.value;render();};

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

function openModal(id, prefillDate){
  state.editingId = id || null;
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const delBtn = document.getElementById('m-delete');
  populateProjectSelect();
  if(id){
    const t = state.tasks.find(x=>x.id===id);
    if(!t) return;
    title.textContent = 'Editar tarefa';
    document.getElementById('m-title').value = t.title || '';
    document.getElementById('m-client').value = t.client || '';
    populateStatusSelect('m-status', t.status || getColumns()[0].key);
    document.getElementById('m-date').value = t.date || '';
    document.getElementById('m-priority').value = t.priority || 'normal';
    document.getElementById('m-project').value = t.project_id || '';
    document.getElementById('m-notes').value = t.notes || '';
    const isMine = t.owner_id === session.user.id;
    const canEdit = isMine || (t.project_id && canEditProject(t.project_id));
    delBtn.style.display = canEdit ? '' : 'none';
    document.querySelectorAll('#modal input, #modal select, #modal textarea, #modal .btn-format').forEach(el=>{el.disabled = !canEdit;});
  }else{
    title.textContent = 'Nova tarefa';
    document.getElementById('m-title').value = '';
    document.getElementById('m-client').value = '';
    populateStatusSelect('m-status', getColumns()[0].key);
    document.getElementById('m-date').value = prefillDate || '';
    document.getElementById('m-priority').value = 'normal';
    document.getElementById('m-project').value = '';
    document.getElementById('m-notes').value = '';
    delBtn.style.display = 'none';
    document.querySelectorAll('#modal input, #modal select, #modal textarea').forEach(el=>{el.disabled = false;});
  }
  modal.classList.add('open');
  setTimeout(()=>document.getElementById('m-title').focus(), 50);
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

function closeModal(){document.getElementById('modal').classList.remove('open');state.editingId = null;}

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
    priority: document.getElementById('m-priority').value,
    notes: document.getElementById('m-notes').value.trim(),
    project_id: document.getElementById('m-project').value || null,
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

async function formatNotes(){
  const textarea = document.getElementById('m-notes');
  const btn = document.getElementById('btn-format');
  const raw = textarea.value.trim();
  if(!raw){textarea.focus();return;}

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Formatando';

  try{
    const response = await fetch('/api/format', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: raw})
    });
    const data = await response.json();
    if(!response.ok){
      alert(data.error || 'Erro ao formatar');
    } else if(data.text){
      textarea.value = data.text;
    }
  }catch(e){
    alert('Erro de conexão. Tenta de novo.');
  }

  btn.disabled = false;
  btn.innerHTML = '✨ Formatar';
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
