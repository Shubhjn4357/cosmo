/**
 * Whisper AI - Premium Admin Control Surface
 * Advanced operational logic for runtime, vision perception, and system observability.
 */

const REFRESH_INTERVAL_MS = 10000;
const LOG_POLLING_MS = 3000;

// State management
let runtimeProfileState = null;
let controlCenterState = null;
let researchAutonomyState = null;
let selectedAutonomySourceId = null;
let refreshInFlight = false;
let logPollingActive = false;
let adminConfigState = null;
let activeSectionId = "section-access";

// DOM Elements
const authBadge = document.getElementById("adminAuthBadge");
const authStatus = document.getElementById("adminAuthStatus");
const adminLoginForm = document.getElementById("adminLoginForm");
const lastRefreshLabel = document.getElementById("lastRefreshLabel");
const systemLogConsole = document.getElementById("systemLogConsole");
const visionDropZone = document.getElementById("visionDropZone");
const visionFeedGrid = document.getElementById("visionFeedGrid");

const tokenKey = "whisper_admin_token";

/**
 * UTILS
 */
function getAdminToken() {
  return window.localStorage.getItem(tokenKey) || "";
}

function setAdminToken(token) {
  if (token) window.localStorage.setItem(tokenKey, token);
  else window.localStorage.removeItem(tokenKey);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatTimestamp(ts) {
  return ts ? new Date(ts * 1000).toLocaleString() : "n/a";
}

function formatDuration(s) {
  if (!s || s < 0) return "n/a";
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

/**
 * UI CONTROLS
 */
function setAuthStatus(label, message, tone = "status-warn") {
  if (authBadge) {
    authBadge.textContent = label;
    authBadge.className = `pill glass ${tone}`;
  }
  if (authStatus) {
    authStatus.textContent = message;
    authStatus.className = `auth-feedback ${tone}`;
  }
}

function toggleSkeleton(containerId, show) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (show) {
    container.innerHTML = Array(3).fill(0).map(() => document.getElementById("skeleton-card").innerHTML).join("");
  }
}

function setActiveSection(sectionId) {
  document.querySelectorAll(".content-section").forEach(s => s.style.display = "none");
  const target = document.getElementById(sectionId);
  if (target) {
    target.style.display = "block";
    activeSectionId = sectionId;
    
    // Update nav state
    document.querySelectorAll(".nav-button").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-section-target") === sectionId);
    });

    // Lifecycle hooks for specific sections
    if (sectionId === "section-logs") startLogPolling();
    else stopLogPolling();
  }
}

/**
 * API WRAPPER
 */
async function adminFetch(url, options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    setAdminToken("");
    setActiveSection("section-access");
    setAuthStatus("Session Expired", "Please login again.", "status-error");
  }
  return response;
}

async function readJson(res) {
  try { return await res.json(); } catch { return { error: "Parse Error" }; }
}

/**
 * VISION FEED LOGIC
 */
function setupVisionFeed() {
  if (!visionDropZone) return;

  const fileInput = document.getElementById("visionFileInput");
  const progressBar = document.getElementById("visionProgressBar");
  const progressContainer = document.getElementById("visionUploadProgress");

  visionDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    visionDropZone.classList.add("drag-over");
  });

  visionDropZone.addEventListener("dragleave", () => {
    visionDropZone.classList.remove("drag-over");
  });

  visionDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    visionDropZone.classList.remove("drag-over");
    uploadVisionFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    uploadVisionFiles(fileInput.files);
  });
}

async function uploadVisionFiles(files) {
  if (!files.length) return;
  
  const progressContainer = document.getElementById("visionUploadProgress");
  const progressBar = document.getElementById("visionProgressBar");
  progressContainer.style.display = "block";

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("text", `Admin curated sample: ${file.name}`);

    try {
      progressBar.style.width = `${((i + 1) / files.length) * 100}%`;
      const res = await adminFetch("/api/admin/vision/upload", {
        method: "POST",
        body: formData
      });
      if (!res.ok) throw new Error("Upload failed");
    } catch (e) {
      console.error(e);
    }
  }

  setTimeout(() => { progressContainer.style.display = "none"; progressBar.style.width = "0%"; }, 2000);
  refreshAdmin();
}

/**
 * LOG POLLING
 */
function startLogPolling() {
  if (logPollingActive) return;
  logPollingActive = true;
  pollLogs();
}

function stopLogPolling() {
  logPollingActive = false;
}

async function pollLogs() {
  if (!logPollingActive || activeSectionId !== "section-logs") return;

  try {
    const res = await adminFetch("/api/admin/system/logs?lines=500");
    if (res.ok) {
      const data = await res.json();
      const consoleNode = document.getElementById("systemLogConsole");
      consoleNode.textContent = data.tail || "Waiting for log events...";
      
      if (document.getElementById("autoScrollLogs").checked) {
        consoleNode.scrollTop = consoleNode.scrollHeight;
      }
    }
  } catch (e) {
    console.error("Log fetch failed", e);
  }

  setTimeout(pollLogs, LOG_POLLING_MS);
}

/**
 * DASHBOARD RENDERING
 */
function renderControlCenter(data) {
  const banner = document.getElementById("controlCenterBanner");
  if (!banner) return;

  const readiness = data.readiness?.summary || {};
  const stats = [
    ["System Profile", data.runtime?.selected_profile || "Custom"],
    ["Active Backend", data.runtime?.active_backend || "Uninitialized"],
    ["Knowledge Base", data.knowledge?.total_vectors || 0],
    ["Ready Status", readiness.overall || "Unknown"],
    ["Uptime", formatDuration(data.uptime_seconds)]
  ];

  banner.innerHTML = stats.map(([l, v]) => `
    <div class="hero-card">
      <div class="meta">${l}</div>
      <div class="hero-value">${v}</div>
    </div>
  `).join("");

  if (lastRefreshLabel) lastRefreshLabel.textContent = `Sync: ${formatTimestamp(data.generated_at)}`;
  
  renderAiJobs(data.jobs || {});
  renderAiModes(data.ai_modes || []);
}

function renderAiModes(modes) {
  const grid = document.getElementById("aiModeGrid");
  if (!grid) return;
  grid.innerHTML = modes.map(m => `
    <div class="card ${m.active ? 'card-active' : ''}">
      <strong>${escapeHtml(m.title)}</strong>
      <div class="meta">${escapeHtml(m.summary)}</div>
      <div class="pill status-${m.status === 'ready' ? 'ok' : 'warn'}">${m.status}</div>
      ${(m.details || []).map(d => `<div class="meta">${escapeHtml(d)}</div>`).join("")}
    </div>
  `).join("");
}

function renderAiJobs(jobs) {
  const grid = document.getElementById("aiJobGrid");
  if (!grid) return;
  grid.innerHTML = Object.entries(jobs).map(([name, job]) => `
    <div class="card ${job.running ? 'card-active' : ''}">
      <strong>${name.toUpperCase()}</strong>
      <div class="pill ${job.running ? 'status-ok' : 'glass'}">${job.running ? 'Running' : 'Idle'}</div>
      <div class="meta">PID: ${job.pid || 'n/a'}</div>
      <div class="meta">Log: ${escapeHtml(job.log_path || 'n/a')}</div>
    </div>
  `).join("");
}

function renderRuntimeProfiles() {
  const grid = document.getElementById("runtimeProfileGrid");
  if (!grid || !runtimeProfileState) return;

  grid.innerHTML = (runtimeProfileState.profiles || []).map(p => {
    const active = p.id === runtimeProfileState.selected_profile;
    return `
      <div class="card ${active ? 'card-active' : ''}">
        <strong>${escapeHtml(p.name)}</strong>
        <div class="meta">${p.backend} | ${active ? 'Active' : 'Standby'}</div>
        <div class="meta">Context: ${p.max_context_tokens}</div>
        <div class="meta">Artifact: ${p.artifact_exists ? 'Local' : 'Pending'}</div>
        <div class="pill status-${p.ready ? 'ok' : 'error'}">${p.status_message}</div>
      </div>
    `;
  }).join("");
}

function renderVisionFeed(samples) {
  if (!visionFeedGrid) return;
  visionFeedGrid.innerHTML = (samples || []).map(s => `
    <div class="card">
      <div class="meta">${formatTimestamp(s.timestamp)}</div>
      <strong>${escapeHtml(s.text)}</strong>
      <div class="meta">Source: ${s.source} | Dims: ${s.dimension}</div>
      ${s.preview_url ? `<img src="${s.preview_url}" style="width:100%; border-radius:4px; margin-top:8px;">` : ''}
    </div>
  `).join("");
}

async function refreshAdmin() {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const isAuth = await verifyAuth();
    if (!isAuth) { refreshInFlight = false; return; }

    const [ccRes, profRes, visionRes] = await Promise.all([
      adminFetch("/api/admin/control-center"),
      adminFetch("/api/admin/runtime-profiles"),
      adminFetch("/api/feed/vision/sample?count=12")
    ]);

    const cc = await readJson(ccRes);
    const profs = await readJson(profRes);
    const vision = await readJson(visionRes);

    if (ccRes.ok) renderControlCenter(cc);
    if (profRes.ok) { runtimeProfileState = profs; renderRuntimeProfiles(); renderProfileOptions(); }
    if (visionRes.ok) renderVisionFeed(vision.samples);

  } catch (e) {
    console.error("Dashboard refresh failed", e);
  } finally {
    refreshInFlight = false;
  }
}

async function verifyAuth() {
  const token = getAdminToken();
  if (!token) return false;
  
  try {
    const res = await adminFetch("/api/auth/verify");
    const data = await readJson(res);
    if (res.ok && data.is_admin) {
      setAuthStatus("Session Active", `Authorized as ${data.username}`, "status-ok");
      return true;
    }
  } catch (e) {}
  return false;
}

function renderProfileOptions() {
  const select = document.getElementById("runtimeProfileSelect");
  if (!select || !runtimeProfileState) return;
  
  const profiles = runtimeProfileState.profiles || [];
  select.innerHTML = profiles.map(p => `
    <option value="${p.id}" ${p.id === runtimeProfileState.selected_profile ? 'selected' : ''}>
      ${p.name} (${p.backend})
    </option>
  `).join("");
}

/**
 * INITIALIZATION
 */
function init() {
  // Navigation
  document.querySelectorAll("[data-section-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      setActiveSection(btn.getAttribute("data-section-target"));
    });
  });

  // Login
  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const u = document.getElementById("adminUsername").value;
      const p = document.getElementById("adminPassword").value;
      
      setAuthStatus("Attempting Auth", "Negotiating secret key...", "status-warn");
      
      try {
        const res = await fetch("/api/auth/admin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: u, password: p })
        });
        const data = await readJson(res);
        if (res.ok && data.access_token) {
          setAdminToken(data.access_token);
          setActiveSection("section-overview");
          refreshAdmin();
        } else {
          setAuthStatus("Login Failed", data.detail || "Invalid credentials", "status-error");
        }
      } catch (err) {
        setAuthStatus("Network Error", "Server is unreachable", "status-error");
      }
    });
  }

  // Action Buttons
  document.getElementById("adminLogoutButton").addEventListener("click", () => {
    setAdminToken("");
    setActiveSection("section-access");
    setAuthStatus("Logged Out", "Session terminated.", "status-warn");
  });

  document.getElementById("applyProfileButton").addEventListener("click", async () => {
    const pid = document.getElementById("runtimeProfileSelect").value;
    const res = await adminFetch("/api/admin/runtime-profiles/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: pid, eager_load: true })
    });
    if (res.ok) refreshAdmin();
  });

  document.getElementById("startTrainingButton").addEventListener("click", async () => {
    const steps = document.getElementById("trainingSteps").value;
    await adminFetch(`/api/admin/system/training/start?steps=${steps}`, { method: "POST" });
    refreshAdmin();
  });

  document.getElementById("stopTrainingButton").addEventListener("click", async () => {
    await adminFetch("/api/admin/system/training/stop", { method: "POST" });
    refreshAdmin();
  });

  setupVisionFeed();
  
  // Start polling
  refreshAdmin();
  setInterval(refreshAdmin, REFRESH_INTERVAL_MS);
}

// Global start
window.addEventListener("DOMContentLoaded", init);
