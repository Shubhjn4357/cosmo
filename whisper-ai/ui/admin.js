const REFRESH_INTERVAL_MS = 10000;
const healthGrid = document.getElementById("healthGrid");
const readinessGrid = document.getElementById("readinessGrid");
const datasetGrid = document.getElementById("datasetGrid");
const hfSyncOutput = document.getElementById("hfSyncOutput");
const researchOutput = document.getElementById("researchOutput");
const researchPolicyOutput = document.getElementById("researchPolicyOutput");
const researchDatasetOutput = document.getElementById("researchDatasetOutput");
const researchAutonomyOutput = document.getElementById("researchAutonomyOutput");
const researchDocumentGrid = document.getElementById("researchDocumentGrid");
const researchHistoryGrid = document.getElementById("researchHistoryGrid");
const researchHistoryScope = document.getElementById("researchHistoryScope");
const researchAutonomyGrid = document.getElementById("researchAutonomyGrid");
const controlCenterBanner = document.getElementById("controlCenterBanner");
const aiModeGrid = document.getElementById("aiModeGrid");
const aiJobGrid = document.getElementById("aiJobGrid");
const aiLogGrid = document.getElementById("aiLogGrid");
const aiOpsOutput = document.getElementById("aiOpsOutput");
const readinessOutput = document.getElementById("readinessOutput");
const runtimeOutput = document.getElementById("runtimeOutput");
const authStatus = document.getElementById("adminAuthStatus");
const authBadge = document.getElementById("adminAuthBadge");
const adminLoginHint = document.getElementById("adminLoginHint");
const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginButton = document.getElementById("adminLoginButton");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const adminUsernameInput = document.getElementById("adminUsername");
const adminPasswordInput = document.getElementById("adminPassword");
const runtimeProfileSelect = document.getElementById("runtimeProfileSelect");
const runtimeProfileGrid = document.getElementById("runtimeProfileGrid");
const runtimeJobGrid = document.getElementById("runtimeJobGrid");
const researchProviderSelect = document.getElementById("researchProvider");
const lastRefreshLabel = document.getElementById("lastRefreshLabel");
const autoRefreshToggle = document.getElementById("autoRefreshToggle");
const trainingStepsInput = document.getElementById("trainingSteps");
const drawerToggleButton = document.getElementById("drawerToggleButton");
const adminSidebar = document.getElementById("adminSidebar");
const adminSidebarBackdrop = document.getElementById("adminSidebarBackdrop");
const sectionNavButtons = Array.from(document.querySelectorAll("[data-section-target]"));
const trackedSections = Array.from(document.querySelectorAll(".content-section[id]"));
const mobileDrawerQuery = window.matchMedia("(max-width: 1080px)");
const curatedDatasetSelect = document.getElementById("curatedDatasetSelect");
const curatedImportMaxRowsInput = document.getElementById("curatedImportMaxRows");
const curatedImportAutoSyncToggle = document.getElementById("curatedImportAutoSync");
const hfDatasetIdInput = document.getElementById("hfDatasetIdInput");
const hfDatasetConfigInput = document.getElementById("hfDatasetConfigInput");
const hfDatasetSplitInput = document.getElementById("hfDatasetSplitInput");
const hfDatasetKindSelect = document.getElementById("hfDatasetKindSelect");
const hfDatasetImportMaxRowsInput = document.getElementById("hfDatasetImportMaxRows");
const hfDatasetAutoSyncToggle = document.getElementById("hfDatasetAutoSync");
const tokenKey = "whisper_admin_token";
let runtimeProfileState = null;
let controlCenterState = null;
let researchAutonomyState = null;
let selectedAutonomySourceId = null;
let refreshInFlight = false;
let refreshQueued = false;
let adminConfigState = null;
let activeSectionId = trackedSections[0]?.id || null;
let sectionObserver = null;
let curatedDatasetCatalog = [];

function getAdminToken() {
  return window.localStorage.getItem(tokenKey) || "";
}

function setAdminToken(token) {
  if (token) {
    window.localStorage.setItem(tokenKey, token);
  } else {
    window.localStorage.removeItem(tokenKey);
  }
}

function setAuthBadge(label, tone = "status-warn") {
  if (!authBadge) {
    return;
  }
  authBadge.textContent = label;
  authBadge.className = `pill ${tone}`;
}

function setAuthMessage(message, tone = "status-warn") {
  if (!authStatus) {
    return;
  }
  authStatus.textContent = message;
  authStatus.className = `auth-feedback ${tone}`;
}

function setDrawerOpen(open) {
  if (!drawerToggleButton || !adminSidebar) {
    return;
  }
  const nextState = Boolean(open) && mobileDrawerQuery.matches;
  document.body.classList.toggle("drawer-open", nextState);
  drawerToggleButton.setAttribute("aria-expanded", nextState ? "true" : "false");
}

function closeDrawer() {
  setDrawerOpen(false);
}

function setActiveSection(sectionId) {
  if (!sectionId) {
    return;
  }
  activeSectionId = sectionId;
  sectionNavButtons.forEach((button) => {
    const isActive = button.getAttribute("data-section-target") === sectionId;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "location");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function navigateToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }
  setActiveSection(sectionId);
  if (window.location.hash !== `#${sectionId}`) {
    window.history.replaceState(null, "", `#${sectionId}`);
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  closeDrawer();
}

function initializeAdminShell() {
  if (drawerToggleButton) {
    drawerToggleButton.addEventListener("click", () => {
      const isOpen = document.body.classList.contains("drawer-open");
      setDrawerOpen(!isOpen);
    });
  }

  if (adminSidebarBackdrop) {
    adminSidebarBackdrop.addEventListener("click", closeDrawer);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
    }
  });

  sectionNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-section-target");
      if (target) {
        navigateToSection(target);
      }
    });
  });

  if (sectionObserver) {
    sectionObserver.disconnect();
  }
  sectionObserver = new IntersectionObserver((entries) => {
    const visibleEntry = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (visibleEntry?.target?.id) {
      setActiveSection(visibleEntry.target.id);
    }
  }, {
    rootMargin: "-18% 0px -62% 0px",
    threshold: [0.15, 0.35, 0.6],
  });
  trackedSections.forEach((section) => sectionObserver.observe(section));

  const resetDrawerForDesktop = () => {
    if (!mobileDrawerQuery.matches) {
      closeDrawer();
    }
  };
  if (typeof mobileDrawerQuery.addEventListener === "function") {
    mobileDrawerQuery.addEventListener("change", resetDrawerForDesktop);
  } else if (typeof mobileDrawerQuery.addListener === "function") {
    mobileDrawerQuery.addListener(resetDrawerForDesktop);
  }

  const hashSectionId = window.location.hash.replace(/^#/, "");
  if (hashSectionId && document.getElementById(hashSectionId)) {
    setActiveSection(hashSectionId);
    window.requestAnimationFrame(() => {
      document.getElementById(hashSectionId)?.scrollIntoView({ block: "start" });
    });
    return;
  }

  if (activeSectionId) {
    setActiveSection(activeSectionId);
  }
}

function updateAdminConfigUi() {
  const configured = adminConfigState?.admin_configured;
  const legacyEnabled = Boolean(adminConfigState?.legacy_admin_enabled);
  const aliases = Array.isArray(adminConfigState?.admin_aliases)
    ? adminConfigState.admin_aliases.filter(Boolean)
    : [];

  if (configured === false) {
    setAuthBadge("Admin not configured", "status-error");
    setAuthMessage(
      "No server admin account is configured. Set ADMIN_USERNAME or ADMIN_EMAIL with ADMIN_PASSWORD or ADMIN_PASSWORD_HASH.",
      "status-error",
    );
    if (adminLoginHint) {
      adminLoginHint.textContent = "Server admin credentials are missing. Update the backend config, then reload this page.";
    }
    adminLoginButton.disabled = true;
    adminUsernameInput.disabled = true;
    adminPasswordInput.disabled = true;
    return;
  }

  adminLoginButton.disabled = false;
  adminUsernameInput.disabled = false;
  adminPasswordInput.disabled = false;

  if (adminLoginHint) {
    const identifierText = aliases.length
      ? `Accepted identifiers: ${aliases.join(" or ")}.`
      : "Accepted identifiers: configured admin username or admin email.";
    adminLoginHint.textContent = `${identifierText}${legacyEnabled ? " Legacy admin fallback is enabled." : ""}`;
  }

  if (!getAdminToken()) {
    setAuthBadge("Login required", "status-warn");
    setAuthMessage("Sign in with the server admin account to unlock the control surface.", "status-warn");
  }
}

async function refreshAdminConfigStatus() {
  try {
    const response = await fetch("/api/auth/admin-status");
    const payload = await readJson(response);
    adminConfigState = response.ok ? payload : null;
  } catch (error) {
    adminConfigState = null;
  }

  if (!adminConfigState) {
    adminLoginButton.disabled = false;
    adminUsernameInput.disabled = false;
    adminPasswordInput.disabled = false;
    if (!getAdminToken()) {
      setAuthBadge("Status unavailable", "status-warn");
      setAuthMessage("Could not verify admin configuration. You can still try signing in.", "status-warn");
    }
    if (adminLoginHint) {
      adminLoginHint.textContent = "The server did not return admin status. Check auth routing or try signing in directly.";
    }
    return null;
  }

  updateAdminConfigUi();
  return adminConfigState;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / (1024 ** index);
  const precision = scaled >= 10 || index === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[index]}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "n/a";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) {
    return "n/a";
  }
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function parseCsvList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNumericField(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusClass(ok) {
  return ok ? "status-ok" : "status-error";
}

function statusTone(status) {
  if (["ready", "running", "completed", "configured"].includes(status)) {
    return "status-ok";
  }
  if (["error", "failed", "blocked"].includes(status)) {
    return "status-error";
  }
  return "status-warn";
}

function setBusy(buttonOrId, busy, busyLabel = "Working...") {
  const button = typeof buttonOrId === "string"
    ? document.getElementById(buttonOrId)
    : buttonOrId;
  if (!button) {
    return;
  }
  if (!button.dataset.idleLabel) {
    button.dataset.idleLabel = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.idleLabel;
}

async function withButtonBusy(buttonOrId, busyLabel, task) {
  try {
    setBusy(buttonOrId, true, busyLabel);
    return await task();
  } finally {
    setBusy(buttonOrId, false);
  }
}

function getSelectedRuntimeProfileId() {
  return String(runtimeProfileSelect?.value || "").trim();
}

function ensureSelectedRuntimeProfile(outputElement) {
  const profileId = getSelectedRuntimeProfileId();
  if (!profileId) {
    outputElement.textContent = "Choose a runtime profile first.";
    return "";
  }
  return profileId;
}

function jobStatusClass(status) {
  if (status === "completed") {
    return "status-ok";
  }
  if (status === "failed") {
    return "status-error";
  }
  return "";
}

function progressMarkup(progress) {
  if (typeof progress !== "number" || Number.isNaN(progress)) {
    return "";
  }
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  return `
    <div class="progress">
      <span style="width: ${percent}%"></span>
    </div>
    <div class="meta">Progress: ${percent}%</div>
  `;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: text || response.statusText || "Invalid JSON response" };
  }
}

async function adminFetch(url, options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}

function renderLockedPanels() {
  const locked = `
    <div class="card">
      <strong>Locked</strong>
      <div class="meta">Admin login required.</div>
    </div>
  `;
  datasetGrid.innerHTML = locked;
  hfSyncOutput.textContent = "Login to inspect Hugging Face dataset sync status.";
  researchHistoryGrid.innerHTML = locked;
  researchDocumentGrid.innerHTML = locked;
  researchAutonomyGrid.innerHTML = locked;
  if (researchHistoryScope) {
    researchHistoryScope.textContent = "Research history is locked until admin login.";
  }
  runtimeProfileGrid.innerHTML = locked;
  runtimeJobGrid.innerHTML = locked;
  controlCenterBanner.innerHTML = locked;
  aiModeGrid.innerHTML = locked;
  aiJobGrid.innerHTML = locked;
  aiLogGrid.innerHTML = locked;
  readinessGrid.innerHTML = locked;
  runtimeOutput.textContent = "Login to manage runtime profiles, datasets, and download jobs.";
  readinessOutput.textContent = "Login to view deployment readiness and blocker details.";
  researchPolicyOutput.textContent = "Login to manage research source policy.";
  researchAutonomyOutput.textContent = "Login to manage autonomous research sources and schedules.";
  researchDatasetOutput.textContent = "Login to browse and export research documents.";
  aiOpsOutput.textContent = "Login to control training, generator, and AI runtime operations.";
  ["startTrainingButton", "stopTrainingButton", "startGeneratorButton", "stopGeneratorButton"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = true;
    }
  });
}

function renderControlCenter(controlCenter) {
  controlCenterState = controlCenter || null;
  const readiness = controlCenter?.readiness?.summary || {};
  const selfLearner = controlCenter?.self_learner || {};
  const bannerCards = [
    ["Overall", readiness.overall || "unknown"],
    ["Active Runtime", controlCenter?.runtime?.active_backend || "uninitialized"],
    ["Selected Profile", controlCenter?.runtime?.selected_profile || "custom"],
    ["Knowledge", String(controlCenter?.knowledge?.total_vectors || 0)],
    ["Uptime", formatDuration(controlCenter?.uptime_seconds)],
    ["Self-Learner", selfLearner.ready ? (selfLearner.training_recommended ? "early-stage" : "chat-ready") : "offline"],
  ];

  controlCenterBanner.innerHTML = "";
  bannerCards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "hero-card";
    card.innerHTML = `
      <div class="meta">${escapeHtml(label)}</div>
      <div class="hero-value">${escapeHtml(value)}</div>
    `;
    controlCenterBanner.appendChild(card);
  });

  lastRefreshLabel.textContent = `Last sync: ${formatTimestamp(controlCenter?.generated_at)}`;
  renderAiModes(controlCenter?.ai_modes || []);
  renderAiJobs(controlCenter?.jobs || {});
  renderAiLogs(controlCenter?.logs || {});
  updateAiActionState(controlCenter);
}

function renderAiModes(modes) {
  aiModeGrid.innerHTML = "";
  if (!modes.length) {
    aiModeGrid.innerHTML = `
      <div class="card">
        <strong>No AI modes</strong>
        <div class="meta">The control center did not return AI mode data.</div>
      </div>
    `;
    return;
  }

  modes.forEach((mode) => {
    const card = document.createElement("div");
    const tone = statusTone(mode.status);
    card.className = `card${mode.active ? " card-active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(mode.title || mode.id || "Mode")}</strong>
      <div class="meta">${escapeHtml(mode.summary || "n/a")}</div>
      <div class="status-chip ${tone}">${escapeHtml(mode.status || "unknown")}</div>
      ${(mode.details || []).map((item) => `<div class="meta">${escapeHtml(item)}</div>`).join("")}
    `;
    aiModeGrid.appendChild(card);
  });
}

function renderAiJobs(jobs) {
  const entries = Object.entries(jobs || {});
  aiJobGrid.innerHTML = "";
  if (!entries.length) {
    aiJobGrid.innerHTML = `
      <div class="card">
        <strong>No jobs</strong>
        <div class="meta">No training or generator job data was returned.</div>
      </div>
    `;
    return;
  }

  entries.forEach(([jobName, job]) => {
    const running = Boolean(job?.running);
    const card = document.createElement("div");
    card.className = `card${running ? " card-active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(jobName)}</strong>
      <div class="status-chip ${statusTone(running ? "running" : "idle")}">${running ? "running" : "idle"}</div>
      <div class="meta">PID: ${escapeHtml(job?.pid || "n/a")}</div>
      <div class="meta">Log: ${escapeHtml(job?.log_path || "n/a")}</div>
    `;
    aiJobGrid.appendChild(card);
  });
}

function renderAiLogs(logs) {
  const entries = Object.entries(logs || {});
  aiLogGrid.innerHTML = "";
  if (!entries.length) {
    aiLogGrid.innerHTML = `
      <div class="card">
        <strong>No log previews</strong>
        <div class="meta">Training and generator logs will appear here when available.</div>
      </div>
    `;
    return;
  }

  entries.forEach(([jobName, log]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(jobName)} log</strong>
      <div class="meta">${escapeHtml(log?.log_path || "n/a")}</div>
      <div class="meta">${log?.running ? "Job running" : "Job idle"}</div>
      <pre class="log-tail">${escapeHtml(log?.tail || "No log output yet.")}</pre>
    `;
    aiLogGrid.appendChild(card);
  });
}

function updateAiActionState(controlCenter) {
  const jobs = controlCenter?.jobs || {};
  const trainingRunning = Boolean(jobs.training?.running);
  const generatorRunning = Boolean(jobs.generator?.running);

  document.getElementById("startTrainingButton").disabled = trainingRunning;
  document.getElementById("stopTrainingButton").disabled = !trainingRunning;
  document.getElementById("startGeneratorButton").disabled = generatorRunning;
  document.getElementById("stopGeneratorButton").disabled = !generatorRunning;
}

function renderHealth(runtime, knowledge, research) {
  const cloudflare = research.cloudflare || {};
  const quota = cloudflare.quota || {};
  const policy = research.policy || {};
  const cards = [
    ["Backend", runtime.active_backend || "uninitialized"],
    ["Loaded", String(Boolean(runtime.loaded))],
    ["Selected Profile", runtime.selected_profile || "custom"],
    ["Model", runtime.model_id || "none"],
    ["Runtime Ready", runtime.readiness?.summary || "unknown"],
    ["Knowledge", String(knowledge.total_vectors || 0)],
    ["Research Runs", String(research.runs || 0)],
    ["Indexed Chunks", String(research.documents_indexed || 0)],
    ["Research Provider", String(research.last_provider || "none")],
    ["Cloudflare Crawl", cloudflare.status_message || (cloudflare.available ? "ready" : (cloudflare.configured ? "disabled" : "not configured"))],
    ["Cloudflare Jobs Left", `${quota.jobs_remaining_today ?? 0}/${quota.jobs_per_day_limit ?? cloudflare.jobs_per_day_limit ?? 0}`],
    ["Cloudflare REST", `${quota.requests_last_minute ?? 0}/${quota.requests_per_minute_limit ?? cloudflare.requests_per_minute_limit ?? 0} used/min`],
    ["Source Policy", policy.require_allowed_sources ? "allowlist only" : "open with blocklist"],
    ["Known Sources", `${policy.source_override_count ?? 0} registry entries`],
  ];

  healthGrid.innerHTML = "";
  cards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<strong>${escapeHtml(label)}</strong><div class="meta">${escapeHtml(value)}</div>`;
    healthGrid.appendChild(card);
  });
}

function renderProfileOptions() {
  runtimeProfileSelect.innerHTML = "";
  const profiles = runtimeProfileState?.profiles || [];

  if (!profiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No runtime profiles available";
    runtimeProfileSelect.appendChild(option);
    runtimeProfileSelect.disabled = true;
    return;
  }

  runtimeProfileSelect.disabled = false;
  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.backend})`;
    option.selected = profile.id === runtimeProfileState.selected_profile;
    runtimeProfileSelect.appendChild(option);
  });

  if (!getSelectedRuntimeProfileId() && runtimeProfileSelect.options.length) {
    runtimeProfileSelect.selectedIndex = 0;
  }
}

function renderProfileCards(runtimeStatus) {
  const profiles = runtimeProfileState?.profiles || [];
  runtimeProfileGrid.innerHTML = "";

  profiles.forEach((profile) => {
    const selected = profile.id === runtimeProfileState.selected_profile;
    const readinessClass = statusClass(profile.ready);
    const selectionLabel = selected ? "selected" : "not selected";
    const hasExpectedBytes = Number.isFinite(Number(profile.expected_size_bytes));
    const artifactLine = profile.artifact_required
      ? (hasExpectedBytes
          ? `${formatBytes(profile.artifact_size_bytes)} / ${formatBytes(profile.expected_size_bytes)}`
          : `${formatBytes(profile.artifact_size_bytes)} local`)
      : (profile.artifact_exists ? "Cached locally" : "Lazy download on first use");
    const runtimeMatch = runtimeStatus.selected_profile === profile.id ? runtimeStatus.active_backend : "inactive";
    const reasons = (profile.status_reasons || []).map((reason) => `
      <div class="meta">${escapeHtml(reason)}</div>
    `).join("");
    const progress = profile.artifact_required ? progressMarkup(profile.artifact_progress) : "";
    const validation = profile.validation || null;
    const validationMarkup = validation
      ? `
        <div class="meta ${statusClass(validation.ok)}">Validation: ${escapeHtml(validation.summary || "validated")}</div>
        <div class="meta">Validated: ${escapeHtml(formatTimestamp(validation.validated_at))}</div>
        ${validation.test_load?.attempted
          ? `<div class="meta">Load test: ${escapeHtml(validation.test_load.loaded ? `passed via ${validation.test_load.active_backend || "runtime"}` : (validation.test_load.last_error || "failed"))}</div>`
          : `<div class="meta">Load test: not run</div>`}
      `
      : `<div class="meta">Validation: not run yet</div>`;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(profile.name)}</strong>
      <div class="meta">${escapeHtml(profile.backend)} | ${selectionLabel}</div>
      <div class="meta">${escapeHtml(profile.recommended_for)}</div>
      <div class="meta">Model: ${escapeHtml(profile.model_id)}</div>
      <div class="meta ${readinessClass}">Status: ${escapeHtml(profile.status_message)}</div>
      <div class="meta">Runtime: ${escapeHtml(runtimeMatch)}</div>
      <div class="meta">Context: ${escapeHtml(profile.max_context_tokens)}</div>
      <div class="meta">Artifacts: ${escapeHtml(artifactLine)}</div>
      <div class="meta">Path: ${escapeHtml(profile.artifact_path)}</div>
      ${progress}
      ${validationMarkup}
      ${reasons}
    `;
    runtimeProfileGrid.appendChild(card);
  });

  if (!profiles.length) {
    runtimeProfileGrid.innerHTML = `
      <div class="card">
        <strong>No profiles</strong>
        <div class="meta">Runtime profiles were not returned by the API.</div>
      </div>
    `;
  }
}

function renderJobCards() {
  const jobs = runtimeProfileState?.download_jobs || [];
  if (!jobs.length) {
    runtimeJobGrid.innerHTML = `
      <div class="card">
        <strong>No jobs</strong>
        <div class="meta">No model downloads have been queued.</div>
      </div>
    `;
    return;
  }

  runtimeJobGrid.innerHTML = "";
  jobs.forEach((job) => {
    const healthClass = jobStatusClass(job.status);
    const progress = progressMarkup(job.progress);
    const byteLine = job.total_bytes
      ? `${formatBytes(job.bytes_downloaded)} / ${formatBytes(job.total_bytes)}`
      : formatBytes(job.bytes_downloaded);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(job.profile_name)}</strong>
      <div class="meta">${escapeHtml(job.profile_backend || "model")} | ${escapeHtml(job.stage || job.status)}</div>
      <div class="meta ${healthClass}">Status: ${escapeHtml(job.status)}</div>
      <div class="meta">Job: ${escapeHtml(job.id)}</div>
      <div class="meta">Updated: ${escapeHtml(formatTimestamp(job.updated_at))}</div>
      <div class="meta">Bytes: ${escapeHtml(byteLine)}</div>
      <div class="meta">Output: ${escapeHtml(job.output_path || "pending")}</div>
      ${progress}
      ${job.error ? `<div class="meta status-error">${escapeHtml(job.error)}</div>` : ""}
    `;
    runtimeJobGrid.appendChild(card);
  });
}

function renderDatasetCards(datasets) {
  datasetGrid.innerHTML = "";
  datasets.forEach((dataset) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(dataset.name)}</strong>
      <div class="meta">Kind: ${escapeHtml(dataset.kind || "managed")}</div>
      <div class="meta">Rows: ${escapeHtml(dataset.rows ?? "n/a")}</div>
      <div class="meta">Bytes: ${escapeHtml(formatBytes(dataset.size_bytes))}</div>
      <a href="/api/datasets/download/${encodeURIComponent(dataset.name)}" target="_blank" rel="noreferrer">download</a>
      <button class="secondary dataset-sync-button" data-dataset-name="${escapeHtml(dataset.name)}">sync to HF</button>
    `;
    datasetGrid.appendChild(card);
  });

  if (!datasets.length) {
    datasetGrid.innerHTML = `
      <div class="card">
        <strong>No datasets</strong>
        <div class="meta">Upload or sync a dataset to manage it here.</div>
      </div>
    `;
  }
}

function renderHfSyncStatus(syncStatus) {
  hfSyncOutput.textContent = JSON.stringify(
    {
      configured: syncStatus.configured,
      available: syncStatus.available,
      repo: syncStatus.repo || syncStatus.repo_id,
      last_action: syncStatus.last_action,
      last_sync_at: syncStatus.last_sync_at,
      last_download_at: syncStatus.last_download_at,
      last_validated_at: syncStatus.last_validated_at,
      last_sync_count: syncStatus.last_sync_count,
      remote_file_count: syncStatus.remote_file_count,
      last_error: syncStatus.last_error,
      remote_files_sample: syncStatus.remote_files_sample || [],
    },
    null,
    2,
  );
}

function renderCuratedCatalog(payload) {
  curatedDatasetCatalog = Array.isArray(payload?.datasets) ? payload.datasets : [];
  if (!curatedDatasetSelect) {
    return;
  }

  const previousValue = curatedDatasetSelect.value;
  curatedDatasetSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = curatedDatasetCatalog.length
    ? "Select a curated dataset"
    : "No curated datasets available";
  curatedDatasetSelect.appendChild(defaultOption);

  curatedDatasetCatalog.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = `${dataset.name} (${dataset.kind})`;
    curatedDatasetSelect.appendChild(option);
  });

  if (previousValue && curatedDatasetCatalog.some((dataset) => dataset.id === previousValue)) {
    curatedDatasetSelect.value = previousValue;
  }
}

function renderReadiness(report) {
  const summary = report?.summary || {};
  const sections = report?.sections || {};
  const blockers = report?.blockers || [];
  const cards = [
    ["Overall", summary.overall || "unknown"],
    ["Errors", String(summary.errors ?? 0)],
    ["Warnings", String(summary.warnings ?? 0)],
    ["Runtime", sections.runtime?.readiness?.summary || "unknown"],
    ["Database", sections.database?.mode || "unknown"],
    ["HF Sync", sections.dataset_sync?.configured ? "configured" : "not configured"],
    ["Cloudflare", sections.cloudflare?.status_message || "unknown"],
    ["Google Auth", sections.google_auth?.configured ? "configured" : "not configured"],
  ];

  readinessGrid.innerHTML = "";
  cards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<strong>${escapeHtml(label)}</strong><div class="meta">${escapeHtml(value)}</div>`;
    readinessGrid.appendChild(card);
  });

  readinessOutput.textContent = JSON.stringify(
    {
      summary,
      blockers,
      sections,
    },
    null,
    2,
  );
}

function renderResearchHistory(runs, summary = null, scopeLabel = "Recent research runs.") {
  researchHistoryGrid.innerHTML = "";
  if (researchHistoryScope) {
    researchHistoryScope.textContent = scopeLabel;
  }

  if (!runs.length) {
    researchHistoryGrid.innerHTML = `
      <div class="card">
        <strong>No research runs</strong>
        <div class="meta">Run a crawl to populate recent research history.</div>
      </div>
    `;
    return;
  }

  runs.forEach((run) => {
    const card = document.createElement("div");
    card.className = "card";
    const status = run.status || "unknown";
    const statusClassName = status === "completed" ? "status-ok" : (status === "failed" ? "status-error" : "");
    const fallback = run.fallback || null;
    card.innerHTML = `
      <strong>${escapeHtml(run.topic || "unknown")}</strong>
      <div class="meta">${escapeHtml(run.provider || "none")} | ${escapeHtml(new Date((run.timestamp || 0) * 1000).toLocaleString())}</div>
      <div class="meta ${statusClassName}">Status: ${escapeHtml(status)}</div>
      <div class="meta">Pages: ${escapeHtml(run.pages_crawled ?? 0)} | Texts: ${escapeHtml(run.texts_processed ?? 0)} | Chunks: ${escapeHtml(run.chunks_indexed ?? 0)}</div>
      ${run.learning_records_added !== undefined ? `<div class="meta">Learning added: ${escapeHtml(run.learning_records_added ?? 0)} | skipped: ${escapeHtml(run.learning_records_skipped ?? 0)}</div>` : ""}
      ${run.autonomy_source_label || run.autonomy_source_id ? `<div class="meta">Source: ${escapeHtml(run.autonomy_source_label || run.autonomy_source_id)}</div>` : ""}
      <div class="meta">Job: ${escapeHtml(run.job_id || "n/a")}</div>
      ${run.start_url ? `<div class="meta">Start URL: ${escapeHtml(run.start_url)}</div>` : ""}
      ${fallback ? `<div class="meta">Fallback: ${escapeHtml(`${fallback.from || "cloudflare"} -> ${fallback.to || "legacy"}`)}</div>` : ""}
      ${fallback?.reason ? `<div class="meta">${escapeHtml(fallback.reason)}</div>` : ""}
      ${run.error ? `<div class="meta status-error">${escapeHtml(run.error)}</div>` : ""}
    `;
    researchHistoryGrid.appendChild(card);
  });

}

function renderResearchDocuments(documents, summary) {
  researchDocumentGrid.innerHTML = "";

  if (!documents.length) {
    researchDocumentGrid.innerHTML = `
      <div class="card">
        <strong>No research documents</strong>
        <div class="meta">Run or import research to populate the document corpus.</div>
      </div>
    `;
    researchDatasetOutput.textContent = JSON.stringify(summary || {}, null, 2);
    return;
  }

  documents.forEach((entry) => {
    const card = window.document.createElement("div");
    card.className = "card";
    const provenance = entry.provenance || {};
    card.innerHTML = `
      <strong>${escapeHtml(entry.title || entry.topic || "Untitled document")}</strong>
      <div class="meta">${escapeHtml(entry.provider || "unknown")} | ${escapeHtml(entry.domain || "unknown")}</div>
      <div class="meta">${escapeHtml(new Date((entry.timestamp || 0) * 1000).toLocaleString())}</div>
      <div class="meta">Topic: ${escapeHtml(entry.topic || "n/a")}</div>
      <div class="meta">License: ${escapeHtml(provenance.license || "unknown")} | Trust: ${escapeHtml(provenance.trust || "unknown")}</div>
      <div class="meta">Preview: ${escapeHtml(entry.text_preview || "")}</div>
      <div class="meta">Length: ${escapeHtml(entry.text_length || 0)}</div>
      <div class="meta">URL: ${escapeHtml(entry.url || "n/a")}</div>
    `;
    researchDocumentGrid.appendChild(card);
  });

  researchDatasetOutput.textContent = JSON.stringify(summary || {}, null, 2);
}

function renderResearchPolicy(policy) {
  document.getElementById("researchRequireAllowed").checked = Boolean(policy.require_allowed_sources);
  document.getElementById("researchRequireLicensed").checked = Boolean(policy.require_license_metadata);
  document.getElementById("researchAllowedDomains").value = (policy.allowed_domains || []).join(", ");
  document.getElementById("researchBlockedDomains").value = (policy.blocked_domains || []).join(", ");
  researchPolicyOutput.textContent = JSON.stringify(
    {
      require_allowed_sources: policy.require_allowed_sources,
      require_license_metadata: policy.require_license_metadata,
      allowed_domains: policy.allowed_domains,
      blocked_domains: policy.blocked_domains,
      policy_path: policy.policy_path,
      source_override_count: policy.source_override_count,
    },
    null,
    2,
  );
}

function renderResearchAutonomy(autonomy) {
  researchAutonomyState = autonomy || null;
  const runtime = autonomy?.runtime || {};
  const sources = autonomy?.sources || [];
  document.getElementById("autonomyEnabled").checked = Boolean(autonomy?.enabled);
  document.getElementById("autonomyIntervalMinutes").value = autonomy?.interval_minutes || 60;
  document.getElementById("autonomyChunkChars").value = autonomy?.learning_chunk_chars || 1200;
  document.getElementById("autonomyMaxChunks").value = autonomy?.learning_max_chunks_per_document || 2;
  document.getElementById("autonomyAutoSyncHf").checked = Boolean(autonomy?.auto_sync_hf);

  researchAutonomyGrid.innerHTML = "";
  if (!sources.length) {
    researchAutonomyGrid.innerHTML = `
      <div class="card">
        <strong>No autonomous sources</strong>
        <div class="meta">Add a topic or start URL to let the server keep learning after startup.</div>
      </div>
    `;
  } else {
    sources.forEach((source) => {
      const card = document.createElement("div");
      const active = runtime.current_source_id === source.id;
      const selected = selectedAutonomySourceId === source.id;
      const tone = source.enabled ? "status-ok" : "status-warn";
      card.className = `card${active || selected ? " card-active" : ""}`;
      card.innerHTML = `
        <strong>${escapeHtml(source.label || source.topic || "Research source")}</strong>
        <div class="status-chip ${tone}">${source.enabled ? "enabled" : "disabled"}</div>
        <div class="meta">Topic: ${escapeHtml(source.topic || "n/a")}</div>
        <div class="meta">Provider: ${escapeHtml(source.provider || "auto")} | Pages: ${escapeHtml(source.max_pages || 0)} | Depth: ${escapeHtml(source.depth || 0)}</div>
        <div class="meta">Sites: ${escapeHtml(source.max_sites || 1)} | Source mode: ${escapeHtml(source.source || "all")} | Formats: ${escapeHtml((source.formats || []).join(", ") || "markdown")}</div>
        ${source.start_url ? `<div class="meta">Start URL: ${escapeHtml(source.start_url)}</div>` : ""}
        ${(source.tags || []).length ? `<div class="meta">Tags: ${escapeHtml(source.tags.join(", "))}</div>` : ""}
        <div class="meta">Last run: ${escapeHtml(source.last_run_at ? new Date(source.last_run_at * 1000).toLocaleString() : "never")}</div>
        <div class="meta">Last status: ${escapeHtml(source.last_status || "n/a")}</div>
        ${(source.last_result && Object.keys(source.last_result).length) ? `<div class="meta">Last result: ${escapeHtml(JSON.stringify(source.last_result))}</div>` : ""}
        ${source.last_error ? `<div class="meta status-error">${escapeHtml(source.last_error)}</div>` : ""}
        <div class="meta">Completed: ${escapeHtml(source.runs_completed || 0)} | Failed: ${escapeHtml(source.runs_failed || 0)}</div>
        <div class="row" style="margin-top: 12px;">
          <div><button class="secondary autonomy-view-history-button" data-source-id="${escapeHtml(source.id)}">Runs</button></div>
          <div><button class="secondary autonomy-edit-button" data-source-id="${escapeHtml(source.id)}">Edit</button></div>
          <div><button class="secondary autonomy-run-button" data-source-id="${escapeHtml(source.id)}">Run</button></div>
          <div><button class="secondary autonomy-toggle-button" data-source-id="${escapeHtml(source.id)}" data-enabled="${source.enabled ? "false" : "true"}">${source.enabled ? "Disable" : "Enable"}</button></div>
          <div><button class="secondary autonomy-delete-button" data-source-id="${escapeHtml(source.id)}">Delete</button></div>
        </div>
      `;
      researchAutonomyGrid.appendChild(card);
    });
  }

  researchAutonomyOutput.textContent = JSON.stringify(
    {
      enabled: autonomy?.enabled,
      interval_minutes: autonomy?.interval_minutes,
      auto_sync_hf: autonomy?.auto_sync_hf,
      learning_chunk_chars: autonomy?.learning_chunk_chars,
      learning_max_chunks_per_document: autonomy?.learning_max_chunks_per_document,
      task_running: autonomy?.task_running,
      runtime,
      source_count: autonomy?.source_count,
      enabled_source_count: autonomy?.enabled_source_count,
      config_path: autonomy?.config_path,
    },
    null,
    2,
  );

  if (selectedAutonomySourceId && !findAutonomySource(selectedAutonomySourceId)) {
    selectedAutonomySourceId = null;
  }
}

function findAutonomySource(sourceId) {
  return (researchAutonomyState?.sources || []).find((source) => source.id === sourceId) || null;
}

function resetAutonomySourceForm() {
  document.getElementById("autonomySourceId").value = "";
  document.getElementById("autonomySourceFormMode").textContent = "Create a new autonomous source.";
  document.getElementById("addAutonomySourceButton").textContent = "Save Autonomous Source";
  document.getElementById("autonomySourceLabel").value = "";
  document.getElementById("autonomySourceTopic").value = "";
  document.getElementById("autonomySourceStartUrl").value = "";
  document.getElementById("autonomySourceTags").value = "";
  document.getElementById("autonomySourceProvider").value = "auto";
  document.getElementById("autonomySourcePages").value = 3;
  document.getElementById("autonomySourceMaxSites").value = 1;
  document.getElementById("autonomySourceDepth").value = 1;
  document.getElementById("autonomySourceEnabled").checked = true;
  document.getElementById("autonomySourceSource").value = "all";
  document.getElementById("autonomySourceFormats").value = "markdown";
  document.getElementById("autonomySourceIncludePatterns").value = "";
  document.getElementById("autonomySourceExcludePatterns").value = "";
  document.getElementById("autonomySourceModifiedSince").value = "";
  document.getElementById("autonomySourceMaxAge").value = "";
  document.getElementById("autonomySourceRender").checked = false;
  document.getElementById("autonomySourceRefreshExisting").checked = false;
  document.getElementById("autonomySourceExternalLinks").checked = false;
  document.getElementById("autonomySourceSubdomains").checked = false;
}

function populateAutonomySourceForm(source) {
  if (!source) {
    resetAutonomySourceForm();
    return;
  }
  document.getElementById("autonomySourceId").value = source.id || "";
  document.getElementById("autonomySourceFormMode").textContent = `Editing autonomous source: ${source.label || source.topic || source.id}`;
  document.getElementById("addAutonomySourceButton").textContent = "Update Autonomous Source";
  document.getElementById("autonomySourceLabel").value = source.label || "";
  document.getElementById("autonomySourceTopic").value = source.topic || "";
  document.getElementById("autonomySourceStartUrl").value = source.start_url || "";
  document.getElementById("autonomySourceTags").value = (source.tags || []).join(", ");
  document.getElementById("autonomySourceProvider").value = source.provider || "auto";
  document.getElementById("autonomySourcePages").value = source.max_pages || 3;
  document.getElementById("autonomySourceMaxSites").value = source.max_sites || 1;
  document.getElementById("autonomySourceDepth").value = source.depth || 1;
  document.getElementById("autonomySourceEnabled").checked = Boolean(source.enabled);
  document.getElementById("autonomySourceSource").value = source.source || "all";
  document.getElementById("autonomySourceFormats").value = (source.formats || []).join(", ");
  document.getElementById("autonomySourceIncludePatterns").value = (source.include_patterns || []).join(", ");
  document.getElementById("autonomySourceExcludePatterns").value = (source.exclude_patterns || []).join(", ");
  document.getElementById("autonomySourceModifiedSince").value = source.modified_since ?? "";
  document.getElementById("autonomySourceMaxAge").value = source.max_age ?? "";
  document.getElementById("autonomySourceRender").checked = Boolean(source.render);
  document.getElementById("autonomySourceRefreshExisting").checked = Boolean(source.refresh_existing);
  document.getElementById("autonomySourceExternalLinks").checked = Boolean(source.include_external_links);
  document.getElementById("autonomySourceSubdomains").checked = Boolean(source.include_subdomains);
}

function collectAutonomySourcePayload() {
  const topic = document.getElementById("autonomySourceTopic").value.trim();
  const startUrl = document.getElementById("autonomySourceStartUrl").value.trim();
  return {
    label: document.getElementById("autonomySourceLabel").value.trim() || null,
    topic: topic || null,
    start_url: startUrl || null,
    provider: document.getElementById("autonomySourceProvider").value,
    max_pages: Math.max(1, Number(document.getElementById("autonomySourcePages").value) || 3),
    max_sites: Math.max(1, Number(document.getElementById("autonomySourceMaxSites").value) || 1),
    depth: Math.max(0, Number(document.getElementById("autonomySourceDepth").value) || 1),
    enabled: document.getElementById("autonomySourceEnabled").checked,
    source: document.getElementById("autonomySourceSource").value.trim() || "all",
    formats: parseCsvList(document.getElementById("autonomySourceFormats").value || "markdown"),
    include_patterns: parseCsvList(document.getElementById("autonomySourceIncludePatterns").value),
    exclude_patterns: parseCsvList(document.getElementById("autonomySourceExcludePatterns").value),
    modified_since: normalizeNumericField(document.getElementById("autonomySourceModifiedSince").value),
    max_age: normalizeNumericField(document.getElementById("autonomySourceMaxAge").value),
    render: document.getElementById("autonomySourceRender").checked,
    refresh_existing: document.getElementById("autonomySourceRefreshExisting").checked,
    include_external_links: document.getElementById("autonomySourceExternalLinks").checked,
    include_subdomains: document.getElementById("autonomySourceSubdomains").checked,
    tags: parseCsvList(document.getElementById("autonomySourceTags").value),
  };
}

async function refreshResearchHistoryView(defaultRuns, defaultSummary) {
  if (!selectedAutonomySourceId) {
    const summary = defaultSummary || null;
    const scopeLabel = summary
      ? `Recent research runs. Completed: ${summary.completed_runs || 0}, failed: ${summary.failed_runs || 0}, indexed: ${summary.documents_indexed || 0}.`
      : "Recent research runs.";
    renderResearchHistory(defaultRuns || [], summary, scopeLabel);
    return;
  }

  const response = await adminFetch(`/api/research/autonomy/sources/${encodeURIComponent(selectedAutonomySourceId)}/history?limit=20`);
  const payload = await readJson(response);
  if (!response.ok) {
    selectedAutonomySourceId = null;
    renderResearchHistory(
      defaultRuns || [],
      defaultSummary || null,
      `Recent research runs. Source history unavailable: ${payload.detail || payload.error || "unknown source"}`,
    );
    return;
  }

  renderResearchHistory(
    payload.runs || [],
    payload.summary || null,
    `Recent runs for ${payload.source?.label || payload.source?.topic || selectedAutonomySourceId}. Completed: ${payload.summary?.completed_runs || 0}, failed: ${payload.summary?.failed_runs || 0}, indexed: ${payload.summary?.documents_indexed || 0}.`,
  );
}

async function verifyAdminToken() {
  const token = getAdminToken();
  if (!token) {
    updateAdminConfigUi();
    return false;
  }

  const response = await adminFetch("/api/auth/verify");
  const payload = await readJson(response);
  if (!response.ok) {
    setAdminToken("");
    setAuthBadge("Session expired", "status-error");
    setAuthMessage("Admin session expired. Sign in again.", "status-error");
    return false;
  }

  if (!payload.is_admin) {
    setAdminToken("");
    setAuthBadge("Access denied", "status-error");
    setAuthMessage("This session belongs to a regular user account, not the server admin.", "status-error");
    return false;
  }

  setAuthBadge("Admin unlocked", "status-ok");
  setAuthMessage(`Logged in as ${payload.username}`, "status-ok");
  return true;
}

async function refreshAdmin() {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;

  const previousRefreshLabel = lastRefreshLabel?.textContent || "Last sync: never";
  if (lastRefreshLabel) {
    lastRefreshLabel.textContent = "Syncing...";
  }

  try {
    const adminStatusPromise = refreshAdminConfigStatus();
    const [runtimeRes, researchRes] = await Promise.all([
      fetch("/api/admin/runtime-status"),
      fetch("/api/research/stats"),
    ]);
    const runtimePayload = await readJson(runtimeRes);
    const researchPayload = await readJson(researchRes);
    if (!runtimeRes.ok) {
      throw new Error(runtimePayload.error || runtimePayload.detail || "Failed to load runtime status");
    }
    if (!researchRes.ok) {
      throw new Error(researchPayload.error || researchPayload.detail || "Failed to load research stats");
    }

    const runtimeStatus = runtimePayload.runtime || {};
    renderHealth(runtimeStatus, runtimePayload.knowledge || {}, researchPayload);

    await adminStatusPromise;
    const isAdmin = await verifyAdminToken();
    if (!isAdmin) {
      renderLockedPanels();
      return;
    }

    const [controlCenterRes, curatedCatalogRes] = await Promise.all([
      adminFetch("/api/admin/control-center"),
      adminFetch("/api/datasets/curated/catalog"),
    ]);
    const controlCenterPayload = await readJson(controlCenterRes);
    const curatedCatalogPayload = await readJson(curatedCatalogRes);
    if (!controlCenterRes.ok) {
      throw new Error(controlCenterPayload.error || controlCenterPayload.detail || "Failed to load admin control center");
    }

    runtimeProfileState = controlCenterPayload.runtime_profiles || { profiles: [], download_jobs: [] };
    renderProfileOptions();
    renderProfileCards(runtimeStatus);
    renderJobCards();
    renderDatasetCards(controlCenterPayload.datasets?.datasets || []);
    renderCuratedCatalog(curatedCatalogRes.ok ? curatedCatalogPayload : {});
    renderHfSyncStatus(controlCenterPayload.hf_sync || {});
    renderReadiness(controlCenterPayload.readiness || {});
    renderResearchPolicy(controlCenterPayload.research_policy || {});
    renderResearchAutonomy(controlCenterPayload.research_autonomy || {});
    renderResearchDocuments(
      controlCenterPayload.research_documents?.documents || [],
      controlCenterPayload.research_documents?.summary || {},
    );
    await refreshResearchHistoryView(
      controlCenterPayload.research_history?.runs || [],
      controlCenterPayload.research_history?.summary || null,
    );
    renderControlCenter(controlCenterPayload);

    runtimeOutput.textContent = JSON.stringify(
      {
        active_backend: runtimeStatus.active_backend,
        selected_profile: runtimeProfileState.selected_profile,
        selected_profile_validation: (runtimeProfileState.profiles || []).find(
          (profile) => profile.id === runtimeProfileState.selected_profile,
        )?.validation || null,
        readiness: runtimeStatus.readiness,
        backends: runtimeProfileState.backends,
        jobs: runtimeProfileState.download_jobs,
        ai_control: {
          generated_at: controlCenterPayload.generated_at,
          self_learner: controlCenterPayload.self_learner,
          system_jobs: controlCenterPayload.jobs,
        },
      },
      null,
      2,
    );
  } catch (error) {
    runtimeOutput.textContent = error.message || String(error);
    if (lastRefreshLabel) {
      lastRefreshLabel.textContent = `${previousRefreshLabel} (refresh failed)`;
    }
  } finally {
    refreshInFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      await refreshAdmin();
    } else if (lastRefreshLabel?.textContent === "Syncing...") {
      lastRefreshLabel.textContent = previousRefreshLabel;
    }
  }
}

async function runAdminAction(buttonOrId, outputElement, task, options = {}) {
  const normalizedOptions = typeof options === "string"
    ? { busyLabel: options }
    : options;
  const {
    busyLabel = "Working...",
    adminMessage = "Admin login required.",
    refresh = true,
  } = normalizedOptions;

  return withButtonBusy(buttonOrId, busyLabel, async () => {
    const isAdmin = await verifyAdminToken();
    if (!isAdmin) {
      outputElement.textContent = adminMessage;
      return null;
    }
    const payload = await task();
    outputElement.textContent = JSON.stringify(payload, null, 2);
    if (refresh) {
      await refreshAdmin();
    }
    return payload;
  }).catch((error) => {
    outputElement.textContent = error.message || String(error);
    return null;
  });
}

document.getElementById("researchButton").addEventListener("click", async () => {
  await runAdminAction("researchButton", researchOutput, async () => {
    const topic = document.getElementById("researchTopic").value.trim();
    const max_pages = Number(document.getElementById("researchPages").value);
    const provider = researchProviderSelect.value;
    const start_url = document.getElementById("researchStartUrl").value.trim();
    const depth = Number(document.getElementById("researchDepth").value);
    const render = document.getElementById("researchRender").checked;
    const refresh_existing = document.getElementById("researchRefreshExisting").checked;
    const response = await adminFetch("/api/research/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        max_pages,
        provider,
        start_url: start_url || null,
        depth,
        render,
        refresh_existing,
        formats: ["markdown"],
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Research discovery failed");
    }
    return payload;
  }, "Discovering...");
});

document.getElementById("uploadDatasetButton").addEventListener("click", async () => {
  const input = document.getElementById("datasetFileInput");
  if (!input.files.length) {
    hfSyncOutput.textContent = "Choose a dataset file first.";
    return;
  }
  await runAdminAction("uploadDatasetButton", hfSyncOutput, async () => {
    const form = new FormData();
    form.append("file", input.files[0]);
    const response = await adminFetch("/api/datasets/upload", {
      method: "POST",
      body: form,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Dataset upload failed");
    }
    input.value = "";
    return payload;
  }, "Uploading...");
});

document.getElementById("validateHfButton").addEventListener("click", async () => {
  await runAdminAction("validateHfButton", hfSyncOutput, async () => {
    const response = await adminFetch("/api/learn/validate-remote", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "HF validation failed");
    }
    return payload;
  }, "Validating...");
});

document.getElementById("syncLearningDataButton").addEventListener("click", async () => {
  await runAdminAction("syncLearningDataButton", hfSyncOutput, async () => {
    const response = await adminFetch("/api/learn/sync-now?wait=true", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "HF sync failed");
    }
    return payload;
  }, "Syncing...");
});

async function runCuratedImport(specIds) {
  const buttonId = Array.isArray(specIds) ? "importCuratedDatasetButton" : "importAllCuratedDatasetsButton";
  await runAdminAction(buttonId, hfSyncOutput, async () => {
    const maxRows = normalizeNumericField(curatedImportMaxRowsInput?.value);
    const response = await adminFetch("/api/datasets/curated/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec_ids: specIds,
        max_rows: maxRows,
        auto_sync: Boolean(curatedImportAutoSyncToggle?.checked),
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Curated import failed");
    }
    return payload;
  }, Array.isArray(specIds) ? "Importing..." : "Importing all...");
}

document.getElementById("importCuratedDatasetButton").addEventListener("click", async () => {
  const selectedId = curatedDatasetSelect?.value || "";
  if (!selectedId) {
    hfSyncOutput.textContent = "Choose a curated dataset first, or use Import All.";
    return;
  }
  await runCuratedImport([selectedId]);
});

document.getElementById("importAllCuratedDatasetsButton").addEventListener("click", async () => {
  await runCuratedImport(null);
});

document.getElementById("importHfDatasetButton").addEventListener("click", async () => {
  const datasetId = String(hfDatasetIdInput?.value || "").trim();
  if (!datasetId) {
    hfSyncOutput.textContent = "Enter a Hugging Face dataset id like owner/name.";
    return;
  }

  await runAdminAction("importHfDatasetButton", hfSyncOutput, async () => {
    const response = await adminFetch("/api/datasets/hf/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: datasetId,
        config_name: String(hfDatasetConfigInput?.value || "").trim() || null,
        split: String(hfDatasetSplitInput?.value || "").trim() || "train",
        kind: String(hfDatasetKindSelect?.value || "auto").trim() || "auto",
        max_rows: normalizeNumericField(hfDatasetImportMaxRowsInput?.value),
        auto_sync: Boolean(hfDatasetAutoSyncToggle?.checked),
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "HF dataset import failed");
    }
    return payload;
  }, "Importing...");
});

datasetGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".dataset-sync-button");
  if (!button) {
    return;
  }

  const datasetName = button.getAttribute("data-dataset-name");
  if (!datasetName) {
    return;
  }

  await runAdminAction(button, hfSyncOutput, async () => {
    const response = await adminFetch(`/api/datasets/sync/${encodeURIComponent(datasetName)}`, {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Dataset sync failed");
    }
    return payload;
  }, "Syncing...");
});

document.getElementById("saveResearchPolicyButton").addEventListener("click", async () => {
  await runAdminAction("saveResearchPolicyButton", researchPolicyOutput, async () => {
    const allowedDomains = document.getElementById("researchAllowedDomains").value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const blockedDomains = document.getElementById("researchBlockedDomains").value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const response = await adminFetch("/api/research/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        require_allowed_sources: document.getElementById("researchRequireAllowed").checked,
        require_license_metadata: document.getElementById("researchRequireLicensed").checked,
        allowed_domains: allowedDomains,
        blocked_domains: blockedDomains,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to save research policy");
    }
    return payload;
  }, "Saving...");
});

document.getElementById("saveAutonomySettingsButton").addEventListener("click", async () => {
  await runAdminAction("saveAutonomySettingsButton", researchAutonomyOutput, async () => {
    const response = await adminFetch("/api/research/autonomy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: document.getElementById("autonomyEnabled").checked,
        interval_minutes: Math.max(1, Number(document.getElementById("autonomyIntervalMinutes").value) || 60),
        auto_sync_hf: document.getElementById("autonomyAutoSyncHf").checked,
        learning_chunk_chars: Math.max(200, Number(document.getElementById("autonomyChunkChars").value) || 1200),
        learning_max_chunks_per_document: Math.max(1, Number(document.getElementById("autonomyMaxChunks").value) || 2),
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to save autonomy settings");
    }
    return payload;
  }, "Saving...");
});

document.getElementById("runAutonomyNowButton").addEventListener("click", async () => {
  await runAdminAction("runAutonomyNowButton", researchAutonomyOutput, async () => {
    const response = await adminFetch("/api/research/autonomy/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to run autonomy source");
    }
    return payload;
  }, "Running...");
});

document.getElementById("startAutonomyButton").addEventListener("click", async () => {
  await runAdminAction("startAutonomyButton", researchAutonomyOutput, async () => {
    const response = await adminFetch("/api/research/autonomy/start", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to start autonomy loop");
    }
    return payload;
  }, "Starting...");
});

document.getElementById("stopAutonomyButton").addEventListener("click", async () => {
  await runAdminAction("stopAutonomyButton", researchAutonomyOutput, async () => {
    const response = await adminFetch("/api/research/autonomy/stop", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to stop autonomy loop");
    }
    return payload;
  }, "Stopping...");
});

document.getElementById("addAutonomySourceButton").addEventListener("click", async () => {
  const sourceId = document.getElementById("autonomySourceId").value.trim();
  const payloadBody = collectAutonomySourcePayload();
  const topic = payloadBody.topic || "";
  const startUrl = payloadBody.start_url || "";
  if (!topic && !startUrl) {
    researchAutonomyOutput.textContent = "Topic or start URL is required.";
    return;
  }

  await runAdminAction("addAutonomySourceButton", researchAutonomyOutput, async () => {
    const response = await adminFetch(
      sourceId
        ? `/api/research/autonomy/sources/${encodeURIComponent(sourceId)}`
        : "/api/research/autonomy/sources",
      {
        method: sourceId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      },
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to save autonomy source");
    }
    selectedAutonomySourceId = payload.source?.id || sourceId || null;
    resetAutonomySourceForm();
    return payload;
  }, sourceId ? "Saving..." : "Creating...");
});

document.getElementById("cancelAutonomySourceEditButton").addEventListener("click", () => {
  resetAutonomySourceForm();
});

document.getElementById("clearResearchHistoryScopeButton").addEventListener("click", async () => {
  await withButtonBusy("clearResearchHistoryScopeButton", "Clearing...", async () => {
    selectedAutonomySourceId = null;
    await refreshAdmin();
  });
});

researchAutonomyGrid.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) {
    return;
  }

  const sourceId = target.getAttribute("data-source-id");
  if (!sourceId) {
    return;
  }

  let response;
  if (target.classList.contains("autonomy-view-history-button")) {
    await withButtonBusy(target, "Loading...", async () => {
      selectedAutonomySourceId = sourceId;
      await refreshAdmin();
    });
    return;
  }
  if (target.classList.contains("autonomy-edit-button")) {
    populateAutonomySourceForm(findAutonomySource(sourceId));
    return;
  }

  await runAdminAction(target, researchAutonomyOutput, async () => {
    if (target.classList.contains("autonomy-run-button")) {
      response = await adminFetch("/api/research/autonomy/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      });
    } else if (target.classList.contains("autonomy-toggle-button")) {
      response = await adminFetch(`/api/research/autonomy/sources/${encodeURIComponent(sourceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: target.getAttribute("data-enabled") === "true",
        }),
      });
    } else if (target.classList.contains("autonomy-delete-button")) {
      response = await adminFetch(`/api/research/autonomy/sources/${encodeURIComponent(sourceId)}`, {
        method: "DELETE",
      });
    } else {
      return null;
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Autonomy action failed");
    }
    if (target.classList.contains("autonomy-delete-button") && selectedAutonomySourceId === sourceId) {
      selectedAutonomySourceId = null;
    }
    return payload;
  }, target.classList.contains("autonomy-delete-button")
    ? "Deleting..."
    : (target.classList.contains("autonomy-toggle-button") ? "Saving..." : "Running..."));
});

document.getElementById("exportResearchButton").addEventListener("click", async () => {
  const topic = document.getElementById("researchTopic").value.trim();
  const provider = researchProviderSelect.value;
  const datasetName = topic
    ? `research_${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "export"}`
    : "research_export";

  await runAdminAction("exportResearchButton", researchDatasetOutput, async () => {
    const response = await adminFetch("/api/research/documents/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic || null,
        provider: provider === "auto" ? null : provider,
        include_text: true,
        dataset_name: datasetName,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Research export failed");
    }
    return payload;
  }, "Exporting...");
});

document.getElementById("validateCloudflareButton").addEventListener("click", async () => {
  await runAdminAction("validateCloudflareButton", researchDatasetOutput, async () => {
    const response = await adminFetch("/api/research/cloudflare/validate", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Cloudflare validation failed");
    }
    return payload;
  }, "Validating...");
});

document.getElementById("deleteResearchDocsButton").addEventListener("click", async () => {
  await runAdminAction("deleteResearchDocsButton", researchDatasetOutput, async () => {
    const topic = document.getElementById("researchTopic").value.trim();
    const provider = researchProviderSelect.value;
    const response = await adminFetch("/api/research/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic || null,
        provider: provider === "auto" ? null : provider,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to delete research documents");
    }
    return payload;
  }, "Deleting...");
});

document.getElementById("deleteResearchHistoryButton").addEventListener("click", async () => {
  await runAdminAction("deleteResearchHistoryButton", researchDatasetOutput, async () => {
    const topic = document.getElementById("researchTopic").value.trim();
    const provider = researchProviderSelect.value;
    const response = await adminFetch("/api/research/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic || null,
        provider: provider === "auto" ? null : provider,
        source_id: selectedAutonomySourceId || null,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to delete research history");
    }
    return payload;
  }, "Deleting...");
});

document.getElementById("resetResearchQuotaButton").addEventListener("click", async () => {
  await runAdminAction("resetResearchQuotaButton", researchDatasetOutput, async () => {
    const response = await adminFetch("/api/research/quota/reset", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to reset research quota");
    }
    return payload;
  }, "Resetting...");
});

document.getElementById("resetResearchScraperButton").addEventListener("click", async () => {
  await runAdminAction("resetResearchScraperButton", researchDatasetOutput, async () => {
    const response = await adminFetch("/api/research/scraper/reset", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to reset scraper state");
    }
    return payload;
  }, "Resetting...");
});

document.getElementById("rebuildResearchIndexButton").addEventListener("click", async () => {
  await runAdminAction("rebuildResearchIndexButton", researchDatasetOutput, async () => {
    const topic = document.getElementById("researchTopic").value.trim();
    const provider = researchProviderSelect.value;
    const response = await adminFetch("/api/research/index/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic || null,
        provider: provider === "auto" ? null : provider,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to rebuild research index");
    }
    return payload;
  }, "Rebuilding...");
});

async function submitAdminLogin() {
  const username = adminUsernameInput.value.trim();
  const password = adminPasswordInput.value;
  if (!username || !password) {
    setAuthBadge("Missing fields", "status-error");
    setAuthMessage("Username and password are required.", "status-error");
    return;
  }

  try {
    setBusy(adminLoginButton, true, "Logging in...");
    const response = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await readJson(response);
    const token = payload?.session?.access_token;

    if (!response.ok || !token) {
      setAuthBadge("Login failed", "status-error");
      setAuthMessage(payload.error || "Admin login failed.", "status-error");
      return;
    }

    setAdminToken(token);
    const isAdmin = await verifyAdminToken();
    if (!isAdmin) {
      setAdminToken("");
      return;
    }

    adminPasswordInput.value = "";
    await refreshAdmin();
  } catch (error) {
    setAuthBadge("Login failed", "status-error");
    setAuthMessage(error.message || String(error), "status-error");
  } finally {
    setBusy(adminLoginButton, false);
  }
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAdminLogin();
});

adminLogoutButton.addEventListener("click", async () => {
  await withButtonBusy(adminLogoutButton, "Logging out...", async () => {
    setAdminToken("");
    adminPasswordInput.value = "";
    setAuthBadge("Logged out", "status-warn");
    setAuthMessage("Admin session cleared.", "status-warn");
    await refreshAdmin();
  });
});

document.getElementById("applyProfileButton").addEventListener("click", async () => {
  const profile_id = ensureSelectedRuntimeProfile(runtimeOutput);
  if (!profile_id) {
    return;
  }
  await runAdminAction("applyProfileButton", runtimeOutput, async () => {
    const response = await adminFetch("/api/admin/runtime-profiles/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id, eager_load: false }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to apply runtime profile");
    }
    return payload;
  }, "Applying...");
});

document.getElementById("reloadRuntimeButton").addEventListener("click", async () => {
  await runAdminAction("reloadRuntimeButton", runtimeOutput, async () => {
    const response = await adminFetch("/api/admin/runtime/reload", { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to load runtime");
    }
    return payload;
  }, "Loading...");
});

document.getElementById("unloadRuntimeButton").addEventListener("click", async () => {
  await runAdminAction("unloadRuntimeButton", runtimeOutput, async () => {
    const response = await adminFetch("/api/admin/runtime/unload", { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to unload runtime");
    }
    return payload;
  }, "Unloading...");
});

document.getElementById("downloadProfileButton").addEventListener("click", async () => {
  const profileId = ensureSelectedRuntimeProfile(runtimeOutput);
  if (!profileId) {
    return;
  }
  await runAdminAction("downloadProfileButton", runtimeOutput, async () => {
    const response = await adminFetch(`/api/admin/runtime/download/${encodeURIComponent(profileId)}`, {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to queue model download");
    }
    return payload;
  }, "Queuing...");
});

document.getElementById("validateRuntimeButton").addEventListener("click", async () => {
  const profile_id = ensureSelectedRuntimeProfile(runtimeOutput);
  if (!profile_id) {
    return;
  }
  await runAdminAction("validateRuntimeButton", runtimeOutput, async () => {
    const test_load = document.getElementById("runtimeValidationLoadTest").checked;
    const response = await adminFetch("/api/admin/runtime/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id, test_load, refresh_imports: true }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Runtime validation failed");
    }
    return payload;
  }, "Validating...");
});

document.getElementById("refreshRuntimeButton").addEventListener("click", async () => {
  await withButtonBusy("refreshRuntimeButton", "Refreshing...", async () => {
    await refreshAdmin();
  });
});
document.getElementById("refreshDatasetsButton").addEventListener("click", async () => {
  await withButtonBusy("refreshDatasetsButton", "Refreshing...", async () => {
    await refreshAdmin();
  });
});
document.getElementById("refreshReadinessButton").addEventListener("click", async () => {
  await withButtonBusy("refreshReadinessButton", "Refreshing...", async () => {
    await refreshAdmin();
  });
});

document.getElementById("validateDatabaseButton").addEventListener("click", async () => {
  await runAdminAction("validateDatabaseButton", readinessOutput, async () => {
    const response = await adminFetch("/api/admin/database/validate", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Database validation failed");
    }
    return payload;
  }, "Validating...");
});

document.getElementById("validatePaymentsButton").addEventListener("click", async () => {
  await runAdminAction("validatePaymentsButton", readinessOutput, async () => {
    const response = await adminFetch("/api/admin/readiness");
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Readiness check failed");
    }
    return payload;
  }, "Checking...");
});

document.getElementById("refreshControlCenterButton").addEventListener("click", async () => {
  await withButtonBusy("refreshControlCenterButton", "Refreshing...", async () => {
    await refreshAdmin();
  });
});

document.getElementById("startTrainingButton").addEventListener("click", async () => {
  await runAdminAction("startTrainingButton", aiOpsOutput, async () => {
    const steps = Math.max(1, Number(trainingStepsInput.value) || 100);
    const response = await adminFetch(`/api/admin/system/training/start?steps=${encodeURIComponent(String(steps))}`, {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to start training");
    }
    return payload;
  }, "Starting...");
});

document.getElementById("stopTrainingButton").addEventListener("click", async () => {
  await runAdminAction("stopTrainingButton", aiOpsOutput, async () => {
    const response = await adminFetch("/api/admin/system/training/stop", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to stop training");
    }
    return payload;
  }, "Stopping...");
});

document.getElementById("startGeneratorButton").addEventListener("click", async () => {
  await runAdminAction("startGeneratorButton", aiOpsOutput, async () => {
    const response = await adminFetch("/api/admin/generator/start", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to start generator");
    }
    return payload;
  }, "Starting...");
});

document.getElementById("stopGeneratorButton").addEventListener("click", async () => {
  await runAdminAction("stopGeneratorButton", aiOpsOutput, async () => {
    const response = await adminFetch("/api/admin/generator/stop", {
      method: "POST",
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to stop generator");
    }
    return payload;
  }, "Stopping...");
});

window.setInterval(() => {
  if (!document.hidden && autoRefreshToggle.checked) {
    refreshAdmin();
  }
}, REFRESH_INTERVAL_MS);

initializeAdminShell();
resetAutonomySourceForm();
refreshAdmin();
