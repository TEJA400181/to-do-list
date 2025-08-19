/* ========= Helpers ========= */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const store = {
  get(k, fb){ try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

const fmtDateTime = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return 'No date';
  return d.toLocaleString([], { dateStyle:'medium', timeStyle:'short' });
};
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a,b) => startOfDay(a).getTime() === startOfDay(b).getTime();

/* ========= State ========= */
let state = {
  view: 'home',
  monthCursor: startOfDay(new Date()),
  selectedDate: null,
  tasks: store.get('tasks', []),   // each: {id,title,desc,when,repeat,every,unit,priority,completed,deleted,notifiedAt}
  notes: store.get('notes', []),   // each: {id,title,body,color,pinned,deleted}
  searchTask: '',
  searchNote: '',
  filters: { status:'all', repeat:'all' },
  sortBy: 'date'
};

const saveTasks = () => store.set('tasks', state.tasks);
const saveNotes = () => store.set('notes', state.notes);

/* ========= Theme ========= */
function toggleTheme(){
  document.documentElement.classList.toggle('light');
  store.set('theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
}
(function applySavedTheme(){
  const saved = store.get('theme','dark');
  if(saved==='light') document.documentElement.classList.add('light');
})();

/* ========= Notifications ========= */
async function initNotifications(){
  try{
    if("Notification" in window && Notification.permission==="default"){
      await Notification.requestPermission();
    }
  }catch{}
}
function notifyTask(task){
  try{
    if("Notification" in window && Notification.permission==="granted"){
      new Notification("Task Reminder", { body: task.title });
    }
    const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
    audio.play().catch(()=>{});
  }catch{}
}
function startReminderTicker(){
  setInterval(()=>{
    const now = new Date();
    state.tasks.forEach(t=>{
      if(t.deleted || t.completed) return;
      const when = new Date(t.when);
      const delta = Math.abs(when - now);
      // within 60s window; prevent duplicate for same occurrence
      const occurrenceKey = when.toISOString();
      if(delta <= 60000 && t.notifiedAt !== occurrenceKey){
        notifyTask(t);
        t.notifiedAt = occurrenceKey;
        saveTasks();
      }
    });
  }, 30000);
}

/* ========= Navigation ========= */
function switchView(view){
  state.view = view;
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.remove('visible'));
  $(`#view-${view}`).classList.add('visible');
  if (view==='home') renderHome();
  if (view==='tasks') renderTasks();
  if (view==='notes') renderNotes();
  if (view==='trash') renderTrash();
}

/* ========= Calendar ========= */
function renderCalendar(){
  const month = state.monthCursor;
  const grid = $('#calendarGrid');
  grid.innerHTML = '';

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startWeekday = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth()+1, 0).getDate();
  const prevMonthDays = new Date(month.getFullYear(), month.getMonth(), 0).getDate();

  $('#calTitle').textContent = month.toLocaleString([], { month:'long', year:'numeric' });

  // Week headers
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(n=>{
    const h = document.createElement('div');
    h.textContent = n; h.className='day muted'; grid.appendChild(h);
  });

  const totalCells = 42; const today = new Date();
  for(let i=0;i<totalCells;i++){
    const cell = document.createElement('button');
    cell.type='button'; cell.className='day';
    let date;
    if(i<startWeekday){
      const day = prevMonthDays - (startWeekday - 1 - i);
      date = new Date(month.getFullYear(), month.getMonth()-1, day);
      cell.classList.add('muted'); cell.textContent = String(day);
    } else if (i >= startWeekday + daysInMonth){
      const day = i - (startWeekday + daysInMonth) + 1;
      date = new Date(month.getFullYear(), month.getMonth()+1, day);
      cell.classList.add('muted'); cell.textContent = String(day);
    } else {
      const day = i - startWeekday + 1;
      date = new Date(month.getFullYear(), month.getMonth(), day);
      cell.textContent = String(day);
    }

    const dueCount = state.tasks.filter(t=>!t.deleted && !t.completed && sameDay(new Date(t.when), date)).length;
    if(dueCount>0){ const b=document.createElement('span'); b.className='badge'; b.textContent=`${dueCount} due`; cell.appendChild(b); }

    if(sameDay(date,today)) cell.classList.add('today');
    if(state.selectedDate && sameDay(date,state.selectedDate)) cell.classList.add('selected');

    cell.addEventListener('click',()=>{ state.selectedDate = date; renderCalendar(); switchView('tasks'); renderTasks(date); });
    grid.appendChild(cell);
  }
}

/* ========= Task recurrence helpers ========= */
function nextOccurrence(task){
  const d = new Date(task.when);
  if(task.repeat==='daily') d.setDate(d.getDate()+1);
  else if(task.repeat==='weekly') d.setDate(d.getDate()+7);
  else if(task.repeat==='monthly') d.setMonth(d.getMonth()+1);
  else if(task.repeat==='custom'){
    const n = parseInt(task.every||1,10);
    const u = task.unit || 'days';
    if(u==='days') d.setDate(d.getDate()+n);
    if(u==='weeks') d.setDate(d.getDate()+7*n);
    if(u==='months') d.setMonth(d.getMonth()+n);
  }
  return d.toISOString();
}

/* ========= Tasks ========= */
function upsertTask(fromForm){
  const id = $('#taskId').value || crypto.randomUUID();
  const title = $('#taskTitle').value.trim();
  const desc = $('#taskDesc').value.trim();
  const date = $('#taskDate').value;
  const time = $('#taskTime').value;
  const repeat = $('#taskRepeat').value;
  const every = repeat==='custom' ? parseInt($('#repeatEvery').value||1,10) : null;
  const unit = repeat==='custom' ? $('#repeatUnit').value : null;
  const priority = $('#taskPriority').value;

  if(!title||!date||!time) return;
  const whenIso = new Date(`${date}T${time}`).toISOString();
  const existing = state.tasks.find(t=>t.id===id);
  const payload = {
    id, title, desc, when:whenIso, repeat, every, unit, priority,
    completed:false, deleted:false, createdAt: existing?.createdAt ?? new Date().toISOString(),
    notifiedAt: null
  };
  if(existing) Object.assign(existing, payload); else state.tasks.push(payload);
  saveTasks(); renderTasks(); renderCalendar(); $('#taskModal').close(); fromForm && $('#taskForm').reset();
}

function softDeleteTask(id){
  const t = state.tasks.find(x=>x.id===id); if(!t) return;
  t.deleted = true; t.deletedAt = new Date().toISOString(); saveTasks(); renderTasks(); renderCalendar();
}
function restoreTask(id){ const t = state.tasks.find(x=>x.id===id); if(!t) return; t.deleted=false; delete t.deletedAt; saveTasks(); renderTrash(); renderTasks(); renderCalendar(); }
function purgeTask(id){ state.tasks = state.tasks.filter(t=>t.id!==id); saveTasks(); renderTrash(); renderCalendar(); }

function toggleTask(id){
  const t = state.tasks.find(x=>x.id===id); if(!t) return;
  if(!t.completed){
    if(t.repeat!=="none"){ t.when = nextOccurrence(t); t.notifiedAt=null; }
    else { t.completed = true; t.completedAt = new Date().toISOString(); }
  } else {
    t.completed=false; delete t.completedAt;
  }
  saveTasks(); renderTasks(); renderCalendar();
}

function openTaskModal(task=null){
  $('#taskModalTitle').textContent = task ? 'Edit Task' : 'New Task';
  $('#taskId').value = task?.id || '';
  $('#taskTitle').value = task?.title || '';
  $('#taskDesc').value = task?.desc || '';
  const d = task ? new Date(task.when) : new Date();
  $('#taskDate').value = d.toISOString().slice(0,10);
  $('#taskTime').value = d.toTimeString().slice(0,5);
  $('#taskRepeat').value = task?.repeat || 'none';
  $('#taskPriority').value = task?.priority || 'medium';

  if(task?.repeat==='custom'){
    $('#customRepeatWrap').style.display='flex';
    $('#repeatEvery').value = task.every ?? 1;
    $('#repeatUnit').value = task.unit ?? 'days';
  } else {
    $('#customRepeatWrap').style.display='none';
    $('#repeatEvery').value = 1;
    $('#repeatUnit').value = 'days';
  }
  $('#taskModal').showModal();
}

function renderTasks(dateFilter=null){
  const list = $('#taskList');
  list.innerHTML = '';

  let items = state.tasks.filter(t=>!t.deleted);
  const now = new Date();

  if (dateFilter instanceof Date) items = items.filter(t => sameDay(new Date(t.when), dateFilter));
  if (state.filters.status === 'open') items = items.filter(t => !t.completed);
  if (state.filters.status === 'completed') items = items.filter(t => t.completed);
  if (state.filters.status === 'overdue') items = items.filter(t => !t.completed && new Date(t.when) < now);
  if (state.filters.repeat !== 'all') items = items.filter(t => t.repeat === state.filters.repeat);

  const search = state.searchTask.toLowerCase();
  if (search) items = items.filter(t => t.title.toLowerCase().includes(search) || (t.desc||'').toLowerCase().includes(search));

  // Sorting
  const order = { high:0, medium:1, low:2 };
  if (state.sortBy === 'date') items.sort((a,b) => new Date(a.when) - new Date(b.when));
  if (state.sortBy === 'priority') items.sort((a,b) => (order[a.priority||'medium'] - order[b.priority||'medium']) || (new Date(a.when)-new Date(b.when)));
  if (state.sortBy === 'title') items.sort((a,b) => a.title.localeCompare(b.title));

  const tpl = $('#taskItemTpl');
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No tasks match your filters.';
    empty.style.color = 'var(--muted)';
    list.appendChild(empty);
    return;
  }

  items.forEach(t=>{
    const node = tpl.content.firstElementChild.cloneNode(true);
    const when = new Date(t.when);
    node.dataset.id = t.id;
    node.classList.toggle('completed', !!t.completed);
    node.classList.toggle('overdue', !t.completed && when < new Date());

    $('.task-title', node).textContent = t.title;
    const metaParts = [];
    metaParts.push(fmtDateTime(t.when));
    if (t.repeat !== 'none') {
      if(t.repeat==='custom') metaParts.push(`repeats every ${t.every||1} ${t.unit||'days'}`);
      else metaParts.push(`repeats ${t.repeat}`);
    }
    if (t.desc) metaParts.push(t.desc);
    metaParts.push(`Priority: ${t.priority||'medium'}`);
    $('.task-meta', node).textContent = metaParts.join(' • ');

    const pr = t.priority || 'medium';
    node.style.borderLeft = pr==="high"?"4px solid var(--danger)":
                            pr==="medium"?"4px solid var(--brand)":
                            "4px solid var(--accent)";

    const check = $('.task-check', node);
    check.checked = !!t.completed;
    check.addEventListener('change', () => toggleTask(t.id));

    $('.edit', node).addEventListener('click', () => openTaskModal(t));
    $('.delete', node).addEventListener('click', () => {
      if (confirm('Move this task to Trash?')) softDeleteTask(t.id);
    });

    list.appendChild(node);
  });
}

/* ========= Notes ========= */
function upsertNote(){
  const id = $('#noteId').value || crypto.randomUUID();
  const title = $('#noteTitle').value.trim();
  const body = $('#noteBody').value.trim();
  const color = $('#noteColor').value || '#111527';
  const pinned = $('#notePinned').checked;

  if(!title || !body) return;
  const existing = state.notes.find(n=>n.id===id);
  const payload = { id, title, body, color, pinned, deleted:false, updatedAt: new Date().toISOString(), createdAt: existing?.createdAt ?? new Date().toISOString() };

  if (existing) Object.assign(existing, payload);
  else state.notes.push(payload);

  saveNotes(); renderNotes(); $('#noteModal').close(); $('#noteForm').reset();
}

function softDeleteNote(id){ const n = state.notes.find(x=>x.id===id); if(!n) return; n.deleted=true; n.deletedAt=new Date().toISOString(); saveNotes(); renderNotes(); }
function restoreNote(id){ const n = state.notes.find(x=>x.id===id); if(!n) return; n.deleted=false; delete n.deletedAt; saveNotes(); renderTrash(); renderNotes(); }
function purgeNote(id){ state.notes = state.notes.filter(n=>n.id!==id); saveNotes(); renderTrash(); }

function openNoteModal(note=null){
  $('#noteModalTitle').textContent = note ? 'Edit Note' : 'New Note';
  $('#noteId').value = note?.id || '';
  $('#noteTitle').value = note?.title || '';
  $('#noteBody').value = note?.body || '';
  $('#noteColor').value = note?.color || '#111527';
  $('#notePinned').checked = !!note?.pinned;
  $('#noteModal').showModal();
}

function renderNotes(){
  const grid = $('#notesGrid');
  grid.innerHTML = '';
  const tpl = $('#noteCardTpl');
  const q = state.searchNote.toLowerCase();

  let notes = state.notes.filter(n=>!n.deleted);
  if (q) notes = notes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  // Order: pinned first, then updatedAt desc
  notes.sort((a,b) => (b.pinned - a.pinned) || (new Date(b.updatedAt) - new Date(a.updatedAt)));

  if (notes.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No notes yet. Click “+ Add Note”.';
    empty.style.color = 'var(--muted)';
    grid.appendChild(empty);
    return;
  }

  notes.forEach(n=>{
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.background = n.color || '#111527';
    $('.note-title', node).textContent = n.title;
    $('.note-body', node).textContent = n.body;
    const dt = new Date(n.updatedAt).toLocaleString([], { dateStyle:'medium', timeStyle:'short' });
    $('.note-footer', node).textContent = `${n.pinned?'📌 ':''}Updated ${dt}`;
    $('.edit', node).addEventListener('click', () => openNoteModal(n));
    $('.delete', node).addEventListener('click', () => {
      if (confirm('Move this note to Trash?')) softDeleteNote(n.id);
    });
    grid.appendChild(node);
  });
}

/* ========= Home ========= */
function renderHome(){
  const open = state.tasks.filter(t => !t.deleted && !t.completed).length;
  const overdue = state.tasks.filter(t => !t.deleted && !t.completed && new Date(t.when) < new Date()).length;
  const completed = state.tasks.filter(t => !t.deleted && t.completed).length;

  const box = $('#homeStats');
  box.innerHTML = `
    <div class="card"><strong>${open}</strong><br/><span style="color:var(--muted)">Open</span></div>
    <div class="card"><strong>${overdue}</strong><br/><span style="color:var(--muted)">Overdue</span></div>
    <div class="card"><strong>${completed}</strong><br/><span style="color:var(--muted)">Completed</span></div>
  `;

  const upcoming = [...state.tasks]
    .filter(t => !t.deleted && !t.completed && new Date(t.when) >= new Date())
    .sort((a,b) => new Date(a.when) - new Date(b.when))
    .slice(0,7);

  const ul = $('#homeUpcoming');
  ul.innerHTML = '';
  if (upcoming.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No upcoming tasks.';
    li.style.color = 'var(--muted)';
    ul.appendChild(li);
  } else {
    upcoming.forEach(t => {
      const li = document.createElement('li');
      li.className = 'task';
      li.style.borderLeft = (t.priority==='high')?"4px solid var(--danger)":
                            (t.priority==='medium')?"4px solid var(--brand)":"4px solid var(--accent)";
      li.innerHTML = `
        <div class="task-left">
          <input type="checkbox" ${t.completed ? 'checked' : ''} />
          <div class="task-main">
            <div class="task-title">${t.title}</div>
            <div class="task-meta">${fmtDateTime(t.when)} ${t.repeat !== 'none' ? '• repeats ' + (t.repeat==='custom' ? `every ${t.every||1} ${t.unit||'days'}` : t.repeat) : ''}</div>
          </div>
        </div>
        <div class="task-actions"><button class="ghost xs">Open</button></div>
      `;
      $('input', li).addEventListener('change', () => toggleTask(t.id));
      $('button', li).addEventListener('click', () => { switchView('tasks'); openTaskModal(t); });
      ul.appendChild(li);
    });
  }
}

/* ========= Trash ========= */
function renderTrash(){
  // Tasks
  const tl = $('#trashTaskList');
  tl.innerHTML = '';
  const deletedTasks = state.tasks.filter(t=>t.deleted);
  if(deletedTasks.length===0){
    const p = document.createElement('p'); p.textContent='No deleted tasks.'; p.style.color='var(--muted)'; tl.appendChild(p);
  } else {
    deletedTasks.sort((a,b)=>new Date(b.deletedAt)-new Date(a.deletedAt));
    deletedTasks.forEach(t=>{
      const li = document.createElement('li');
      li.className='task';
      li.innerHTML=`
        <div class="task-main">
          <div class="task-title">${t.title}</div>
          <div class="task-meta">Deleted • ${fmtDateTime(t.deletedAt)} • ${fmtDateTime(t.when)}</div>
        </div>
        <div class="task-actions">
          <button class="ghost xs restore">Restore</button>
          <button class="ghost xs delete-forever">Delete Forever</button>
        </div>
      `;
      $('.restore', li).addEventListener('click', ()=>restoreTask(t.id));
      $('.delete-forever', li).addEventListener('click', ()=>{
        if(confirm('Permanently delete this task?')) purgeTask(t.id);
      });
      tl.appendChild(li);
    });
  }

  // Notes
  const ng = $('#trashNotesGrid');
  ng.innerHTML = '';
  const deletedNotes = state.notes.filter(n=>n.deleted);
  if(deletedNotes.length===0){
    const p = document.createElement('p'); p.textContent='No deleted notes.'; p.style.color='var(--muted)'; ng.appendChild(p);
  } else {
    deletedNotes.sort((a,b)=>new Date(b.deletedAt)-new Date(a.deletedAt));
    deletedNotes.forEach(n=>{
      const card = document.createElement('div');
      card.className='note-card';
      card.style.background = n.color || '#111527';
      card.innerHTML=`
        <div class="note-header">
          <h3 class="note-title">${n.title}</h3>
          <div class="note-actions">
            <button class="ghost xs restore">Restore</button>
            <button class="ghost xs delete-forever">Delete Forever</button>
          </div>
        </div>
        <p class="note-body">${n.body}</p>
        <div class="note-footer">Deleted • ${fmtDateTime(n.deletedAt)}</div>
      `;
      $('.restore', card).addEventListener('click', ()=>restoreNote(n.id));
      $('.delete-forever', card).addEventListener('click', ()=>{
        if(confirm('Permanently delete this note?')) purgeNote(n.id);
      });
      ng.appendChild(card);
    });
  }
}

/* ========= Export / Import ========= */
function exportAll(){
  const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), tasks:state.tasks, notes:state.notes}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='todo-backup.json'; a.click();
  URL.revokeObjectURL(url);
}
function importAll(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(Array.isArray(data.tasks)) state.tasks = data.tasks;
      if(Array.isArray(data.notes)) state.notes = data.notes;
      saveTasks(); saveNotes(); renderCalendar(); renderTasks(); renderNotes(); renderTrash(); alert('Imported successfully.');
    }catch(e){ alert('Invalid backup file.'); }
  };
  reader.readAsText(file);
}

/* ========= Events / Wiring ========= */
function initEvents(){
  // Navigation
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

  // Theme
  $('#themeToggle').addEventListener('click', toggleTheme);

  // Calendar
  $('#calPrev').addEventListener('click', () => { state.monthCursor.setMonth(state.monthCursor.getMonth() - 1); renderCalendar(); });
  $('#calNext').addEventListener('click', () => { state.monthCursor.setMonth(state.monthCursor.getMonth() + 1); renderCalendar(); });

  // Quick buttons
  $('#quickAddTask').addEventListener('click', () => openTaskModal());
  $('#quickAddNote').addEventListener('click', () => openNoteModal());

  // Tasks
  $('#addTaskBtn').addEventListener('click', () => openTaskModal());
  $('#taskForm').addEventListener('submit', (e) => { e.preventDefault(); upsertTask(true); });
  $('#saveTaskBtn').addEventListener('click', (e) => { e.preventDefault(); upsertTask(true); });

  $('#taskSearch').addEventListener('input', (e) => { state.searchTask = e.target.value; renderTasks(); });
  $('#statusFilter').addEventListener('change', (e) => { state.filters.status = e.target.value; renderTasks(); });
  $('#repeatFilter').addEventListener('change', (e) => { state.filters.repeat = e.target.value; renderTasks(); });
  $('#sortBy').addEventListener('change', (e) => { state.sortBy = e.target.value; renderTasks(); });

  $('#clearFilters').addEventListener('click', () => {
    state.filters = { status:'all', repeat:'all' };
    state.sortBy = 'date';
    state.searchTask = '';
    $('#taskSearch').value = '';
    $('#statusFilter').value = 'all';
    $('#repeatFilter').value = 'all';
    $('#sortBy').value = 'date';
    state.selectedDate = null;
    renderCalendar(); renderTasks();
  });

  $('#taskRepeat').addEventListener('change', e=>{
    $('#customRepeatWrap').style.display = e.target.value==="custom" ? "flex" : "none";
  });

  // Notes
  $('#addNoteBtn').addEventListener('click', () => openNoteModal());
  $('#noteForm').addEventListener('submit', (e) => { e.preventDefault(); upsertNote(); });
  $('#saveNoteBtn').addEventListener('click', (e) => { e.preventDefault(); upsertNote(); });
  $('#noteSearch').addEventListener('input', (e) => { state.searchNote = e.target.value; renderNotes(); });

  // Export / Import
  $('#exportData').addEventListener('click', exportAll);
  $('#importBtn').addEventListener('click', () => $('#importData').click());
  $('#importData').addEventListener('change', (e) => { const f = e.target.files[0]; if(f) importAll(f); });

  // Dialogs: allow Esc to close (default), ensure clean state on cancel
  ['taskModal','noteModal'].forEach(id=>{
    const dlg = document.getElementById(id);
    dlg.addEventListener('cancel', () => dlg.close());
  });
}

/* ========= Boot ========= */
function boot(){
  renderCalendar();
  renderHome();
  initEvents();
  initNotifications();
  startReminderTicker();
}
document.addEventListener('DOMContentLoaded', boot);
