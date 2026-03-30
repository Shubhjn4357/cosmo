const REFRESH_INTERVAL_MS = 10000;
const healthGrid = document.getElementById("healthGrid");
const readinessGrid = document.getElementById("readinessGrid");
const datasetGrid = document.getElementById("datasetGrid");
const hfSyncOutput = document.getElementById("hfSyncOutput");
const researchOutput = document.getElementById("researchOutput");
const researchPolicyOutput = document.getElementById("researchPolicyOutput");
const researchDatasetOutput = document.getElementById("researchDatasetOutput");
const researchDocumentGrid = document.getElementById("researchDocumentGrid");
const researchHistoryGrid = document.getElementById("researchHistoryGrid");
const controlCenterBanner = document.getElementById("controlCenterBanner");
const aiModeGrid = document.getElementById("aiModeGrid");
const aiJobGrid = document.getElementById("aiJobGrid");
const aiLogGrid = document.getElementById("aiLogGrid");
const aiOpsOutput = document.getElementById("aiOpsOutput");
const readinessOutput = document.getElementById("readinessOutput");
const runtimeOutput = document.getElementById("runtimeOutput");
const authStatus = document.getElementById("adminAuthStatus");
const runtimeProfileSelect = document.getElementById("runtimeProfileSelect");
const runtimeProfileGrid = document.getElementById("runtimeProfileGrid");
const runtimeJobGrid = document.getElementById("runtimeJobGrid");
const researchProviderSelect = document.getElementById("researchProvider");
const lastRefreshLabel = document.getElementById("lastRefreshLabel");
const autoRefreshToggle = document.getElementById("autoRefreshToggle");
const trainingStepsInput = document.getElementById("trainingSteps");
const tokenKey = "whisper_admin_token";
let runtimeProfileState = null;
let controlCenterState = null;
let refreshInFlight = false;

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
    ["Self-Learner", selfLearner.chat_ready ? "chat-ready" : (selfLearner.ready ? "warming up" : "offline")],
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
  (runtimeProfileState?.profiles || []).forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.backend})`;
    option.selected = profile.id === runtimeProfileState.selected_profile;
    runtimeProfileSelect.appendChild(option);
  });
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
    ["Payments", sections.payments?.last_message || (sections.payments?.configured ? "configured" : "not configured")],
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

function renderResearchHistory(runs) {
  researchHistoryGrid.innerHTML = "";

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

async function verifyAdminToken() {
  const token = getAdminToken();
  if (!token) {
    authStatus.textContent = "Not logged in.";
    return false;
  }

  const response = await adminFetch("/api/auth/verify");
  const payload = await readJson(response);
  if (!response.ok) {
    setAdminToken("");
    authStatus.textContent = "Admin session expired.";
    return false;
  }

  authStatus.textContent = payload.is_admin
    ? `Logged in as ${payload.username}`
    : "Token is valid but not admin.";
  return Boolean(payload.is_admin);
}

async function refreshAdmin() {
  if (refreshInFlight) {
    return;
  }
  refreshInFlight = true;

  try {
    const [runtimeRes, researchRes] = await Promise.all([
      fetch("/api/admin/runtime-status"),
      fetch("/api/research/stats"),
    ]);
    const runtimePayload = await readJson(runtimeRes);
    const researchPayload = await readJson(researchRes);
    if (!runtimeRes.ok) {
      throw new Error(runtimePayload.error || "Failed to load runtime status");
    }
    if (!researchRes.ok) {
      throw new Error(researchPayload.error || "Failed to load research stats");
    }

    const runtimeStatus = runtimePayload.runtime || {};
    renderHealth(runtimeStatus, runtimePayload.knowledge || {}, researchPayload);

    const isAdmin = await verifyAdminToken();
    if (!isAdmin) {
      renderLockedPanels();
      return;
    }

    const controlCenterRes = await adminFetch("/api/admin/control-center");
    const controlCenterPayload = await readJson(controlCenterRes);
    if (!controlCenterRes.ok) {
      throw new Error(controlCenterPayload.error || "Failed to load admin control center");
    }

    runtimeProfileState = controlCenterPayload.runtime_profiles || { profiles: [], download_jobs: [] };
    renderProfileOptions();
    renderProfileCards(runtimeStatus);
    renderJobCards();
    renderDatasetCards(controlCenterPayload.datasets?.datasets || []);
    renderHfSyncStatus(controlCenterPayload.hf_sync || {});
    renderReadiness(controlCenterPayload.readiness || {});
    renderResearchHistory(controlCenterPayload.research_history?.runs || []);
    renderResearchPolicy(controlCenterPayload.research_policy || {});
    renderResearchDocuments(
      controlCenterPayload.research_documents?.documents || [],
      controlCenterPayload.research_documents?.summary || {},
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
  } finally {
    refreshInFlight = false;
  }
}

async function runAdminAction(buttonId, outputElement, task, busyLabel = "Working...") {
  const button = document.getElementById(buttonId);
  try {
    setBusy(button, true, busyLabel);
    const isAdmin = await verifyAdminToken();
    if (!isAdmin) {
      outputElement.textContent = "Admin login required.";
      return;
    }
    const payload = await task();
    outputElement.textContent = JSON.stringify(payload, null, 2);
    await refreshAdmin();
  } catch (error) {
    outputElement.textContent = error.message || String(error);
  } finally {
    setBusy(button, false);
  }
}

document.getElementById("researchButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchOutput.textContent = "Admin login required.";
    return;
  }

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
  researchOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("uploadDatasetButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchOutput.textContent = "Admin login required.";
    return;
  }

  const input = document.getElementById("datasetFileInput");
  if (!input.files.length) {
    researchOutput.textContent = "Choose a dataset file first.";
    return;
  }

  const form = new FormData();
  form.append("file", input.files[0]);
  const response = await adminFetch("/api/datasets/upload", {
    method: "POST",
    body: form,
  });
  const payload = await readJson(response);
  researchOutput.textContent = JSON.stringify(payload, null, 2);
  input.value = "";
  await refreshAdmin();
});

document.getElementById("validateHfButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    hfSyncOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/learn/validate-remote", {
    method: "POST",
  });
  const payload = await readJson(response);
  hfSyncOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("syncLearningDataButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    hfSyncOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/learn/sync-now?wait=true", {
    method: "POST",
  });
  const payload = await readJson(response);
  hfSyncOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

datasetGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".dataset-sync-button");
  if (!button) {
    return;
  }

  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    hfSyncOutput.textContent = "Admin login required.";
    return;
  }

  const datasetName = button.getAttribute("data-dataset-name");
  if (!datasetName) {
    return;
  }

  const response = await adminFetch(`/api/datasets/sync/${encodeURIComponent(datasetName)}`, {
    method: "POST",
  });
  const payload = await readJson(response);
  hfSyncOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("saveResearchPolicyButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchPolicyOutput.textContent = "Admin login required.";
    return;
  }

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
  researchPolicyOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("exportResearchButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

  const topic = document.getElementById("researchTopic").value.trim();
  const provider = researchProviderSelect.value;
  const datasetName = topic
    ? `research_${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "export"}`
    : "research_export";

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
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("validateCloudflareButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/research/cloudflare/validate", {
    method: "POST",
  });
  const payload = await readJson(response);
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("deleteResearchDocsButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

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
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("deleteResearchHistoryButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

  const topic = document.getElementById("researchTopic").value.trim();
  const provider = researchProviderSelect.value;
  const response = await adminFetch("/api/research/history", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topic || null,
      provider: provider === "auto" ? null : provider,
    }),
  });
  const payload = await readJson(response);
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("resetResearchQuotaButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/research/quota/reset", {
    method: "POST",
  });
  const payload = await readJson(response);
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("resetResearchScraperButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/research/scraper/reset", {
    method: "POST",
  });
  const payload = await readJson(response);
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("rebuildResearchIndexButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    researchDatasetOutput.textContent = "Admin login required.";
    return;
  }

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
  researchDatasetOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("adminLoginButton").addEventListener("click", async () => {
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value;
  if (!username || !password) {
    authStatus.textContent = "Username and password are required.";
    return;
  }

  const response = await fetch("/api/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await readJson(response);
  const token = payload?.session?.access_token;
  if (!response.ok || !token) {
    authStatus.textContent = payload.error || "Admin login failed.";
    return;
  }

  setAdminToken(token);
  document.getElementById("adminPassword").value = "";
  await refreshAdmin();
});

document.getElementById("applyProfileButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    runtimeOutput.textContent = "Admin login required.";
    return;
  }

  const profile_id = runtimeProfileSelect.value;
  const response = await adminFetch("/api/admin/runtime-profiles/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id, eager_load: false }),
  });
  const payload = await readJson(response);
  runtimeOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("reloadRuntimeButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    runtimeOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/admin/runtime/reload", { method: "POST" });
  const payload = await readJson(response);
  runtimeOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("unloadRuntimeButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    runtimeOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/admin/runtime/unload", { method: "POST" });
  const payload = await readJson(response);
  runtimeOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("downloadProfileButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    runtimeOutput.textContent = "Admin login required.";
    return;
  }

  const profileId = runtimeProfileSelect.value;
  const response = await adminFetch(`/api/admin/runtime/download/${encodeURIComponent(profileId)}`, {
    method: "POST",
  });
  const payload = await readJson(response);
  runtimeOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("validateRuntimeButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    runtimeOutput.textContent = "Admin login required.";
    return;
  }

  const profile_id = runtimeProfileSelect.value;
  const test_load = document.getElementById("runtimeValidationLoadTest").checked;
  const response = await adminFetch("/api/admin/runtime/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id, test_load, refresh_imports: true }),
  });
  const payload = await readJson(response);
  runtimeOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("refreshRuntimeButton").addEventListener("click", refreshAdmin);
document.getElementById("refreshDatasetsButton").addEventListener("click", refreshAdmin);
document.getElementById("refreshReadinessButton").addEventListener("click", refreshAdmin);

document.getElementById("validateDatabaseButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    readinessOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/admin/database/validate", {
    method: "POST",
  });
  const payload = await readJson(response);
  readinessOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("validatePaymentsButton").addEventListener("click", async () => {
  const isAdmin = await verifyAdminToken();
  if (!isAdmin) {
    readinessOutput.textContent = "Admin login required.";
    return;
  }

  const response = await adminFetch("/api/admin/payments/validate", {
    method: "POST",
  });
  const payload = await readJson(response);
  readinessOutput.textContent = JSON.stringify(payload, null, 2);
  await refreshAdmin();
});

document.getElementById("refreshControlCenterButton").addEventListener("click", refreshAdmin);

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

refreshAdmin();
