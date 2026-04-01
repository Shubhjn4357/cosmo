const messagesEl = document.getElementById("messages");
const runtimeGrid = document.getElementById("runtimeGrid");
const imageModelSelect = document.getElementById("imageModelSelect");
const imageModelMeta = document.getElementById("imageModelMeta");
let imageModels = [];
const history = [];
const guestSessionId = (() => {
  const key = "whisper_guest_session";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `guest-${Date.now()}`;
    window.localStorage.setItem(key, value);
  }
  return value;
})();

function appendMessage(role, text, meta = "") {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  if (meta) {
    const metaDiv = document.createElement("div");
    metaDiv.className = "meta";
    metaDiv.textContent = meta;
    div.appendChild(metaDiv);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function refreshImageModels() {
  const response = await fetch("/api/image/models");
  const payload = await response.json();
  const models = payload.models || [];
  imageModels = models;

  imageModelSelect.innerHTML = "";
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name} (${model.speed || "local"})`;
    option.selected = model.id === payload.current_model;
    imageModelSelect.appendChild(option);
  });

  const current = models.find((model) => model.id === imageModelSelect.value) || models[0];
  if (current) {
    const status = current.downloaded ? "Downloaded" : (current.install_status || "Preparing");
    imageModelMeta.textContent = `${current.description}. ${status}.`;
  } else {
    imageModelMeta.textContent = "No image models available.";
  }
}

async function refreshRuntime() {
  const [healthRes, runtimeRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/admin/runtime-status"),
  ]);
  const health = await healthRes.json();
  const runtime = await runtimeRes.json();

  runtimeGrid.innerHTML = "";
  [
    ["API", health.status],
    ["Model Loaded", String(runtime.runtime.loaded)],
    ["Backend", runtime.runtime.active_backend],
    ["Model", runtime.runtime.model_id],
    ["Knowledge Vectors", String(runtime.knowledge.total_vectors || 0)],
    ["Research Runs", String(runtime.research.runs || 0)],
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<strong>${label}</strong><div class="meta">${value}</div>`;
    runtimeGrid.appendChild(card);
  });
}

document.getElementById("sendButton").addEventListener("click", async () => {
  const message = document.getElementById("messageInput").value.trim();
  if (!message) return;

  appendMessage("user", message);
  document.getElementById("messageInput").value = "";

  const payload = {
    message,
    history: history.slice(),
    context: document.getElementById("contextInput").value.trim() || null,
    system_prompt: document.getElementById("systemPromptInput").value.trim() || null,
    max_tokens: Number(document.getElementById("maxTokensInput").value),
    temperature: Number(document.getElementById("temperatureInput").value),
    use_rag: true,
    is_local: true,
    session_id: guestSessionId,
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    appendMessage("assistant", `Error: ${data.detail || data.error || JSON.stringify(data)}`);
    return;
  }

  history.push({ role: "user", content: message });
  history.push({ role: "assistant", content: data.response });
  appendMessage(
    "assistant",
    data.response,
    `${data.model_used || "local"} via ${data.backend || "runtime"}`
  );
  refreshRuntime();
});

document.getElementById("imageButton").addEventListener("click", async () => {
  const prompt = document.getElementById("imagePromptInput").value.trim();
  if (!prompt) return;

  const statusEl = document.getElementById("imageStatus");
  const imgEl = document.getElementById("imagePreview");
  statusEl.textContent = "Generating...";
  imgEl.hidden = true;

  const payload = {
    prompt,
    model_id: imageModelSelect.value || "cyberrealistic-v9",
    width: Number(document.getElementById("imageWidthInput").value),
    height: Number(document.getElementById("imageHeightInput").value),
    is_local: true,
    session_id: guestSessionId,
  };

  const res = await fetch("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.textContent = `Error: ${data.detail || data.error || JSON.stringify(data)}`;
    return;
  }

  statusEl.textContent = `Generated with seed ${data.seed}`;
  imgEl.src = data.image_url;
  imgEl.hidden = false;
});

imageModelSelect.addEventListener("change", async () => {
  const current = imageModels.find((model) => model.id === imageModelSelect.value);
  if (!current) {
    imageModelMeta.textContent = "";
    return;
  }
  const status = current.downloaded ? "Downloaded" : (current.install_status || "Preparing");
  imageModelMeta.textContent = `${current.description}. ${status}.`;
});

refreshImageModels();
refreshRuntime();
