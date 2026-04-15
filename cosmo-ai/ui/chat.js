/* ══════════ CHAT.JS — Cosmo Unified Web Client ══════════
   Handles: Chat (standard + cosmo agent), Image generation,
   Business Agent sessions with real-time polling.
   ═══════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────────────

const history = [];
let currentMode = 'cosmo'; // 'cosmo' | 'standard'
let activeSection = 'chat';
let bizPollTimer = null;
let currentBizSessionId = null;
let imageModels = [];

const guestSessionId = (() => {
  const key = 'cosmo_guest_session';
  let v = localStorage.getItem(key);
  if (!v) { v = crypto.randomUUID?.() ?? `guest-${Date.now()}`; localStorage.setItem(key, v); }
  return v;
})();

const ROLE_COLORS = {
  ceo: '#8b5cf6', research: '#06b6d4', analyst: '#f59e0b',
  developer: '#10b981', writer: '#ec4899', reviewer: '#ef4444',
};
const ROLE_ICONS = {
  ceo: '👔', research: '🔎', analyst: '📊', developer: '💻', writer: '✍️', reviewer: '✅',
};
const STATUS_COLORS = {
  pending: '#6b7280', running: '#f59e0b', completed: '#10b981', failed: '#ef4444',
};

// ─── DOM Shortcuts ─────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const $_ = (sel, ctx = document) => ctx.querySelector(sel);

// ─── Navigation ─────────────────────────────────────────────────────────────

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('visible'));
  document.getElementById(`section-${id}`).classList.add('visible');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-section="${id}"]`)?.classList.add('active');
  activeSection = id;

  const titleMap = {
    chat: ['Cosmo Chat', 'Multi-agent intelligence with Mythos memory'],
    image: ['Image Create', 'Generate high-quality images with local models'],
    business: ['Business Agent', 'Autonomous AI workforce — self-plans and executes'],
  };
  $('topbarTitle').textContent = titleMap[id][0];
  $('topbarSub').textContent = titleMap[id][1];

  // Show/hide mode pills only on chat
  $('modePills').style.display = id === 'chat' ? 'flex' : 'none';

  if (id === 'business') { loadBizSessions(); loadRoles(); }
  if (id === 'image') { refreshImageModels(); }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// ─── Chat Mode Pills ─────────────────────────────────────────────────────────

document.querySelectorAll('.mode-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentMode = pill.dataset.mode;
  });
});

// ─── Chat ────────────────────────────────────────────────────────────────────

function appendMsg(role, content, meta = '', extra = {}) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;

  if (extra.imageUrl) {
    el.innerHTML = `<div>${content}</div><div class="msg-image"><img src="${extra.imageUrl}" alt="Generated" loading="lazy"></div>`;
  } else if (extra.audioUrl) {
    el.innerHTML = `<div>${content}</div><div class="msg-audio"><audio controls src="${extra.audioUrl}"></audio></div>`;
  } else if (extra.steps) {
    const stepsHtml = extra.steps.map(s =>
      `<span class="step-badge" style="color:${ROLE_COLORS[s.role]||'#8b5cf6'}">${ROLE_ICONS[s.role]||'🤖'} ${s.role.toUpperCase()}: ${s.content.slice(0, 80)}</span>`
    ).join('');
    el.innerHTML = `<div>${content}</div><div class="msg-steps">${stepsHtml}</div>`;
  } else {
    el.textContent = content;
  }

  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';
    metaEl.textContent = meta;
    el.appendChild(metaEl);
  }

  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
  return el;
}

function setThinking(show) {
  $('thinkingRow').style.display = show ? 'block' : 'none';
  $('sendButton').disabled = show;
  $('messageInput').disabled = show;
}

async function sendMessage() {
  const message = $('messageInput').value.trim();
  if (!message) return;

  appendMsg('user', message);
  $('messageInput').value = '';
  setThinking(true);

  history.push({ role: 'user', content: message });

  try {
    const endpoint = currentMode === 'cosmo' ? '/api/cosmo/agent/chat' : '/api/chat';
    const payload = currentMode === 'cosmo'
      ? { message, history: history.slice(-10), is_local: true, session_id: guestSessionId }
      : {
          message, history: history.slice(-10), is_local: true, session_id: guestSessionId,
          context: $('contextInput').value.trim() || null,
          max_tokens: Number($('maxTokensInput').value),
          temperature: Number($('temperatureInput').value),
          use_rag: true,
        };

    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      appendMsg('assistant', `Error: ${data.detail || JSON.stringify(data)}`);
      return;
    }

    const responseText = data.response || data.final_response || '';
    const meta = `${data.model_used || 'cosmo'} · ${data.backend || 'multi-agent'}`;
    const steps = data.agent_steps || null;
    appendMsg('assistant', responseText, meta, { steps });
    history.push({ role: 'assistant', content: responseText });

  } catch (e) {
    appendMsg('assistant', `Network error: ${e.message}`);
  } finally {
    setThinking(false);
  }
}

$('sendButton').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ─── Image Generation ─────────────────────────────────────────────────────────

async function refreshImageModels() {
  try {
    const res = await fetch('/api/image/models');
    const payload = await res.json();
    imageModels = payload.models || [];
    const sel = $('imageModelSelect');
    sel.innerHTML = '';
    imageModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.speed || 'local'})`;
      opt.selected = m.id === payload.current_model;
      sel.appendChild(opt);
    });
    updateModelMeta();
  } catch {}
}

function updateModelMeta() {
  const current = imageModels.find(m => m.id === $('imageModelSelect').value);
  if (current) {
    $('imageModelMeta').textContent = `${current.description}. ${current.downloaded ? 'Ready' : (current.install_status || 'Preparing')}`;
  }
}

$('imageModelSelect')?.addEventListener('change', updateModelMeta);

$('imageButton').addEventListener('click', async () => {
  const prompt = $('imagePromptInput').value.trim();
  if (!prompt) return;

  const statusEl = $('imageStatus');
  const imgEl = $('imagePreview');
  statusEl.textContent = '⏳ Generating...';
  imgEl.style.display = 'none';
  $('imageButton').disabled = true;

  try {
    const res = await fetch('/api/image/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, model_id: $('imageModelSelect').value || 'cyberrealistic-v9',
        width: Number($('imageWidthInput').value),
        height: Number($('imageHeightInput').value),
        is_local: true, session_id: guestSessionId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      let err = data.detail || data.error || JSON.stringify(data);
      if (typeof err === 'object') err = err.message || JSON.stringify(err);
      statusEl.textContent = `Error: ${err}`;
      return;
    }
    statusEl.textContent = `✅ Seed ${data.seed}`;
    imgEl.src = data.image_url;
    imgEl.style.display = 'block';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    $('imageButton').disabled = false;
  }
});

// ─── Business Agent ──────────────────────────────────────────────────────────

async function loadRoles() {
  try {
    const res = await fetch('/api/cosmo/business/roles');
    const data = await res.json();
    const strip = $('rolesStrip');
    strip.innerHTML = '';
    (data.roles || []).forEach(r => {
      const badge = document.createElement('span');
      badge.className = 'role-badge';
      badge.style.background = (ROLE_COLORS[r.id] || '#6b7280') + '22';
      badge.style.color = ROLE_COLORS[r.id] || '#6b7280';
      badge.innerHTML = `${ROLE_ICONS[r.id] || '🤖'} ${r.name}`;
      strip.appendChild(badge);
    });
  } catch {}
}

async function loadBizSessions() {
  try {
    const res = await fetch('/api/cosmo/business/sessions');
    const data = await res.json();
    renderSessionList(data.sessions || []);
  } catch {}
}

function renderSessionList(sessions) {
  const listEl = $('sessionList');
  if (!sessions.length) {
    listEl.innerHTML = '<div class="empty-state">No sessions yet. Launch your first business goal above.</div>';
    return;
  }
  listEl.innerHTML = sessions.map(s => `
    <div class="session-card" onclick="openSession('${s.id}')">
      <div style="flex:1">
        <div class="session-goal">${s.goal}</div>
        <div class="session-meta">${s.task_count} tasks · ${s.progress}% complete</div>
      </div>
      <span class="status-chip status-${s.status}">${s.status}</span>
    </div>
  `).join('');
}

$('launchBizBtn').addEventListener('click', async () => {
  const goal = $('bizGoalInput').value.trim();
  if (!goal) return;

  const btn = $('launchBizBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Deploying...';

  try {
    const res = await fetch('/api/cosmo/business/launch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, company_context: $('bizContextInput').value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Launch failed');

    $('bizGoalInput').value = '';
    $('bizContextInput').value = '';
    openSession(data.session_id);
  } catch (e) {
    alert(`Launch failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Deploy AI Workforce`;
  }
});

async function openSession(sessionId) {
  currentBizSessionId = sessionId;
  $('sessionOverlay').classList.add('open');
  await pollSessionDetail(sessionId);
  if (bizPollTimer) clearInterval(bizPollTimer);
  bizPollTimer = setInterval(() => pollSessionDetail(sessionId), 3000);
}

async function pollSessionDetail(sessionId) {
  try {
    const res = await fetch(`/api/cosmo/business/sessions/${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    renderSessionDetail(data);
    if (!data.is_running && data.status !== 'running') {
      clearInterval(bizPollTimer);
      bizPollTimer = null;
      loadBizSessions();
    }
  } catch {}
}

function renderSessionDetail(session) {
  $('overlayGoal').textContent = session.goal;
  $('overlayMeta').textContent = `${(session.tasks || []).filter(t => t.status === 'completed').length}/${(session.tasks || []).length} tasks · ${session.is_running ? 'Running...' : 'Done'}`;
  $('overlayStatus').textContent = session.status;
  $('overlayStatus').className = `status-chip status-${session.status}`;
  $('overlayProgress').textContent = `${session.progress || 0}%`;
  $('overlayProgFill').style.width = `${session.progress || 0}%`;
  $('overlayProgFill').style.background = session.status === 'completed' ? '#10b981' : session.status === 'failed' ? '#ef4444' : '#f59e0b';

  // Tasks
  const tasksEl = $('overlayTasks');
  const tasks = session.tasks || [];
  if (!tasks.length) {
    tasksEl.innerHTML = '<div class="empty-state">CEO is planning tasks...</div>';
  } else {
    tasksEl.innerHTML = tasks.map(t => {
      const color = ROLE_COLORS[t.assigned_to] || '#6b7280';
      const statusColor = STATUS_COLORS[t.status] || '#6b7280';
      const outputSection = t.output
        ? `<div class="task-output">${t.output}</div>`
        : '';
      const spinner = t.status === 'running' ? '<span class="spinner" style="border-top-color:var(--primary)"></span>' : '';
      return `
        <div class="task-card" onclick="this.querySelector('.task-output')?.classList.toggle('hidden')">
          <div class="task-header">
            <span class="task-role-chip" style="background:${color}22;color:${color}">${ROLE_ICONS[t.assigned_to]||'🤖'} ${t.assigned_to.toUpperCase()}</span>
            <span style="display:flex;align-items:center;gap:6px;">
              ${spinner}
              <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
            </span>
          </div>
          <div class="task-title">${t.title}</div>
          <div class="task-desc">${t.description}</div>
          ${outputSection}
        </div>`;
    }).join('');
  }

  // Report
  if (session.final_report) {
    $('overlayReport').textContent = session.final_report;
    $('overlayReport').style.color = '';
  }
}

$('closeOverlayBtn').addEventListener('click', () => {
  $('sessionOverlay').classList.remove('open');
  if (bizPollTimer) { clearInterval(bizPollTimer); bizPollTimer = null; }
  currentBizSessionId = null;
  loadBizSessions();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async function boot() {
  await refreshImageModels();
})();
