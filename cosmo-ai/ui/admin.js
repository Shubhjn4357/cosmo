/**
 * Cosmo AI - Premium Admin Control Surface (V2 Unified Vanilla)
 * High-performance, robust operational logic for runtime management and observability.
 */

// ─── Constants & Configuration ──────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 10000;
const LOG_POLLING_MS = 3000;
const AUTH_TOKEN_KEY = "cosmo_admin_token";

// ─── Central State ────────────────────────────────────────────────────────────
const AppState = {
  runtimeProfiles: [],
  selectedProfile: null,
  controlCenter: null,
  visionSamples: [],
  isRefreshing: false,
  logPolling: null,
  activeSection: "section-access",
};

// ─── Utilities ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const token = {
  get: () => localStorage.getItem(AUTH_TOKEN_KEY) || "",
  set: (val) => {
    if (val) localStorage.setItem(AUTH_TOKEN_KEY, val);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  },
};

const format = {
  bytes: (b) => {
    if (!b) return "0 B";
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
  },
  duration: (s) => {
    if (!s) return "0s";
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  },
  timestamp: (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString() : "n/a"),
  escape: (str) => String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])),
};

// ─── API Wrapper ──────────────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const authToken = token.get();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  try {
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      token.set("");
      navigateTo("section-access");
      updateAuthStatus("Session Expired", "Please login again.", "error");
      throw new Error("Unauthorized");
    }
    return res;
  } catch (err) {
    if (err.message !== "Unauthorized") console.error(`Fetch API Error [${url}]:`, err);
    throw err;
  }
}

// ─── UI Actions ──────────────────────────────────────────────────────────────
function navigateTo(sectionId) {
  document.querySelectorAll(".content-section").forEach((s) => (s.style.display = "none"));
  const target = $(sectionId);
  if (target) {
    target.style.display = "block";
    AppState.activeSection = sectionId;

    // Update Nav Buttons
    document.querySelectorAll(".nav-button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-section-target") === sectionId);
    });

    // Lifecycle
    if (sectionId === "section-logs") startLogStream();
    else stopLogStream();
    
    // Auto-refresh when switching to data-heavy sections
    if (["section-overview", "section-runtime", "section-vision"].includes(sectionId)) {
        refreshData();
    }
  }
}

function updateAuthStatus(label, message, tone = "warn") {
  const badge = $("adminAuthBadge");
  const feedback = $("adminAuthStatus");
  if (badge) {
    badge.textContent = label;
    badge.className = `pill glass status-${tone}`;
  }
  if (feedback) {
    feedback.textContent = message;
    feedback.className = `auth-feedback status-${tone}`;
  }
}

// ─── Data Sync ───────────────────────────────────────────────────────────────
async function refreshData() {
  if (AppState.isRefreshing || !token.get()) return;
  AppState.isRefreshing = true;

  try {
    const [ccRes, profRes, visionRes] = await Promise.allSettled([
      apiFetch("/api/admin/control-center"),
      apiFetch("/api/admin/runtime-profiles"),
      apiFetch("/api/feed/vision/sample?count=12"),
    ]);

    if (ccRes.status === "fulfilled" && ccRes.value.ok) {
      AppState.controlCenter = await ccRes.value.json();
      renderOverview();
    }

    if (profRes.status === "fulfilled" && profRes.value.ok) {
      const data = await profRes.value.json();
      AppState.runtimeProfiles = data.profiles || [];
      AppState.selectedProfile = data.selected_profile;
      renderRuntime();
    }

    if (visionRes.status === "fulfilled" && visionRes.value.ok) {
      const data = await visionRes.value.json();
      AppState.visionSamples = data.samples || [];
      renderVision();
    }

    if ($("lastRefreshLabel")) {
      $("lastRefreshLabel").textContent = `Last Sync: ${new Date().toLocaleTimeString()}`;
    }
  } catch (err) {
    console.error("Data Sync Failed:", err);
  } finally {
    AppState.isRefreshing = false;
  }
}

// ─── Renderers ───────────────────────────────────────────────────────────────
function renderOverview() {
  const banner = $("controlCenterBanner");
  const data = AppState.controlCenter;
  if (!banner || !data) return;

  const cards = [
    { label: "Profile", value: data.runtime?.selected_profile || "Custom" },
    { label: "Backend", value: data.runtime?.active_backend || "Uninitialized" },
    { label: "Knowledge", value: `${data.knowledge?.total_vectors || 0} vectors` },
    { label: "Uptime", value: format.duration(data.uptime_seconds) },
    { label: "Ready", value: data.readiness?.summary?.overall?.toUpperCase() || "UNKNOWN" },
  ];

  banner.innerHTML = cards.map(c => `
    <div class="hero-card">
      <div class="meta">${c.label}</div>
      <div class="hero-value">${c.value}</div>
    </div>
  `).join("");

  renderJobGrid(data.jobs || {});
  renderModeGrid(data.ai_modes || []);
}

function renderRuntime() {
  const select = $("runtimeProfileSelect");
  const grid = $("runtimeProfileGrid");
  if (!select || !grid) return;

  // Sync Selector
  const currentVal = select.value;
  select.innerHTML = AppState.runtimeProfiles.map(p => `
    <option value="${p.id}" ${p.id === AppState.selectedProfile ? "selected" : ""}>
      ${p.name} (${p.backend})
    </option>
  `).join("");
  // Preserve user selection if they were interacting
  if (currentVal && !AppState.selectedProfile) select.value = currentVal;

  // Sync Grid
  grid.innerHTML = AppState.runtimeProfiles.map(p => `
    <div class="card ${p.id === AppState.selectedProfile ? "card-active" : ""}">
      <div class="card-header">
        <strong>${format.escape(p.name)}</strong>
        <span class="pill status-${p.ready ? "ok" : "warn"}">${p.ready ? "READY" : "PENDING"}</span>
      </div>
      <div class="meta">${p.backend} | Context: ${p.max_context_tokens}</div>
      <div class="meta">${p.status_message}</div>
      <div class="card-progress">
         <div class="fill" style="width: ${p.artifact_progress ? p.artifact_progress * 100 : 0}%"></div>
      </div>
    </div>
  `).join("");
}

function renderJobGrid(jobs) {
    const grid = $("aiJobGrid");
    if (!grid) return;
    grid.innerHTML = Object.entries(jobs).map(([name, job]) => `
      <div class="card ${job.running ? "card-active" : ""}">
        <div class="card-header">
            <strong>${name.toUpperCase()}</strong>
            <span class="pill ${job.running ? "status-ok" : "glass"}">${job.running ? "Running" : "Idle"}</span>
        </div>
        <div class="meta">PID: ${job.pid || "n/a"}</div>
        <div class="meta">Log: ${format.escape(job.log_path || "none")}</div>
      </div>
    `).join("");
}

function renderModeGrid(modes) {
    const grid = $("aiModeGrid");
    if (!grid) return;
    grid.innerHTML = modes.map(m => `
      <div class="card ${m.active ? "card-active" : ""}">
        <div class="card-header">
            <strong>${format.escape(m.title)}</strong>
            <span class="pill status-${m.status === "ready" ? "ok" : "warn"}">${m.status}</span>
        </div>
        <div class="meta">${format.escape(m.summary)}</div>
        <div class="stack mini" style="margin-top:8px;">
            ${(m.details || []).map(d => `<div class="meta text-xs">• ${format.escape(d)}</div>`).join("")}
        </div>
      </div>
    `).join("");
}

function renderVision() {
    const grid = $("visionFeedGrid");
    if (!grid) return;
    grid.innerHTML = AppState.visionSamples.map(s => `
        <div class="card">
            <div class="meta">${format.timestamp(s.timestamp)}</div>
            <p class="meta text-sm font-bold">${format.escape(s.text)}</p>
            <div class="meta text-xs">Source: ${s.source}</div>
            ${s.preview_url ? `<img src="${s.preview_url}" class="vision-preview">` : ""}
        </div>
    `).join("");
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function performLogin(username, password) {
  updateAuthStatus("Authenticating", "Sending secure credentials...", "warn");
  try {
    const res = await fetch("/api/auth/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok && data.access_token) {
      token.set(data.access_token);
      updateAuthStatus("Authorized", `Logged in as ${username}`, "ok");
      navigateTo("section-overview");
      refreshData();
    } else {
      updateAuthStatus("Login Failed", data.detail || "Invalid credentials", "error");
    }
  } catch (err) {
    updateAuthStatus("Network Error", "Server unreachable.", "error");
  }
}

async function applyRuntimeProfile() {
    const profileId = $("runtimeProfileSelect").value;
    if (!profileId) return;
    
    const btn = $("applyProfileButton");
    btn.disabled = true;
    btn.textContent = "Activating...";

    try {
        const res = await apiFetch("/api/admin/runtime-profiles/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile_id: profileId, eager_load: true }),
        });
        if (res.ok) {
            refreshData();
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Activate";
    }
}

// ─── Log Stream ─────────────────────────────────────────────────────────────
function startLogStream() {
    if (AppState.logPolling) return;
    const poll = async () => {
        if (AppState.activeSection !== "section-logs") return;
        try {
            const res = await apiFetch("/api/admin/system/logs?lines=500");
            if (res.ok) {
                const data = await res.json();
                const console = $("systemLogConsole");
                console.textContent = data.tail || "Terminal ready. Waiting for events...";
                if ($("autoScrollLogs")?.checked) console.scrollTop = console.scrollHeight;
            }
        } catch {}
        AppState.logPolling = setTimeout(poll, LOG_POLLING_MS);
    };
    poll();
}

function stopLogStream() {
    if (AppState.logPolling) clearTimeout(AppState.logPolling);
    AppState.logPolling = null;
}

// ─── Initialization ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Navigation Wiring
  document.querySelectorAll("[data-section-target]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.getAttribute("data-section-target")));
  });

  // 2. Auth Flow Wiring
  if ($("adminLoginForm")) {
    $("adminLoginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      performLogin($("adminUsername").value, $("adminPassword").value);
    });
  }

  document.querySelectorAll(".logout-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
          token.set("");
          navigateTo("section-access");
          updateAuthStatus("Signed Out", "Session terminated.", "warn");
      });
  });

  // 3. Action Button Wiring
  $("applyProfileButton")?.addEventListener("click", applyRuntimeProfile);
  $("refreshControlCenterButton")?.addEventListener("click", () => refreshData());

  // 4. Boot-up check
  if (token.get()) {
    const isReady = await refreshData().then(() => true).catch(() => false);
    if (!isReady) navigateTo("section-access");
    else navigateTo("section-overview");
  } else {
    navigateTo("section-access");
  }

  // 5. Global Intervals
  setInterval(refreshData, REFRESH_INTERVAL_MS);
});
