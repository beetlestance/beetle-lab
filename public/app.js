const els = {
  configList: document.getElementById("config-list"),
  configEmpty: document.getElementById("config-empty"),
  uploadInput: document.getElementById("upload-input"),
  targetInput: document.getElementById("target-input"),
  runBtn: document.getElementById("run-btn"),
  stopBtn: document.getElementById("stop-btn"),
  runStatus: document.getElementById("run-status"),
  runId: document.getElementById("run-id"),
  previewName: document.getElementById("preview-name"),
  previewBody: document.getElementById("preview-body"),
  logs: document.getElementById("logs"),
  clearLogs: document.getElementById("clear-logs"),
};

let configs = [];
let selectedConfig = null;
let activeRunId = null;
let ws = null;
const charts = {};
const series = {
  rps: [],
  p50: [],
  p95: [],
  p99: [],
  errors: [],
  vus: [],
  labels: [],
};
const MAX_POINTS = 120;

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function setStatus(status) {
  els.runStatus.className = `badge badge-${status}`;
  els.runStatus.textContent = status;
}

async function loadConfigs() {
  const res = await fetch("/api/configs");
  configs = await res.json();
  renderConfigs();
}

function renderConfigs() {
  els.configList.innerHTML = "";
  els.configEmpty.style.display = configs.length === 0 ? "" : "none";
  for (const c of configs) {
    const li = document.createElement("li");
    li.className = c.name === selectedConfig ? "active" : "";
    const name = document.createElement("span");
    name.textContent = c.name.replace(/\.json$/, "");
    name.style.cursor = "pointer";
    name.style.flex = "1";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.whiteSpace = "nowrap";
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Delete";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${c.name}?`)) return;
      await fetch(`/api/configs/${encodeURIComponent(c.name)}`, { method: "DELETE" });
      if (selectedConfig === c.name) {
        selectedConfig = null;
        renderPreview(null);
      }
      loadConfigs();
    };
    li.appendChild(name);
    li.appendChild(del);
    li.onclick = () => selectConfig(c.name);
    els.configList.appendChild(li);
  }
  els.runBtn.disabled = !selectedConfig || activeRunId !== null;
}

async function selectConfig(name) {
  selectedConfig = name;
  renderConfigs();
  const res = await fetch(`/api/configs/${encodeURIComponent(name)}`);
  const cfg = await res.json();
  renderPreview(cfg, name);
}

function renderPreview(cfg, name) {
  if (!cfg) {
    els.previewName.textContent = "";
    els.previewBody.innerHTML = '<span class="muted">Pick a config on the left.</span>';
    return;
  }
  els.previewName.textContent = name || "";
  const summary = [];
  summary.push({ k: "executor", v: cfg.executor || "ramping-vus" });
  if (cfg.executor === "constant-arrival-rate") {
    summary.push({ k: "rate", v: `${cfg.rate || 20}/${cfg.timeUnit || "1s"}` });
    summary.push({ k: "duration", v: cfg.loadDuration || "3m" });
    summary.push({ k: "max VUs", v: cfg.maxVUs || 200 });
  } else {
    const stages = cfg.stages || [];
    summary.push({ k: "stages", v: stages.length });
    summary.push({
      k: "peak VUs",
      v: Math.max(0, ...stages.map((s) => s.vus || s.target || 0)),
    });
    summary.push({
      k: "duration",
      v: stages.map((s) => s.duration).join(" → "),
    });
  }
  summary.push({ k: "endpoints", v: (cfg.endpoints || []).length });
  if (cfg.target) summary.push({ k: "target", v: cfg.target });

  const summaryEl = document.createElement("div");
  summaryEl.className = "preview-summary";
  for (const { k, v } of summary) {
    const kv = document.createElement("div");
    kv.className = "kv";
    kv.innerHTML = `<span class="k">${k}</span><span class="v">${escapeHtml(String(v))}</span>`;
    summaryEl.appendChild(kv);
  }

  const table = document.createElement("table");
  table.className = "preview-table";
  table.innerHTML =
    "<thead><tr><th>name</th><th>method</th><th>path</th><th>weight</th><th>params</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const ep of cfg.endpoints || []) {
    const tr = document.createElement("tr");
    const method = (ep.method || "GET").toUpperCase();
    const params = ep.params
      ? Object.entries(ep.params)
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : "";
    tr.innerHTML =
      `<td>${escapeHtml(ep.name)}</td>` +
      `<td><span class="method method-${method}">${method}</span></td>` +
      `<td>${escapeHtml(ep.path || "")}</td>` +
      `<td>${ep.weight || 1}</td>` +
      `<td class="muted">${escapeHtml(params)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  els.previewBody.innerHTML = "";
  els.previewBody.appendChild(summaryEl);
  els.previewBody.appendChild(table);

  if (cfg.target && !els.targetInput.value) {
    els.targetInput.value = cfg.target;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

els.uploadInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    JSON.parse(text);
  } catch (err) {
    alert(`Invalid JSON: ${err.message}`);
    return;
  }
  const res = await fetch("/api/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, content: text }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    alert(`Upload failed: ${e.error || res.statusText}`);
    return;
  }
  els.uploadInput.value = "";
  await loadConfigs();
  const data = await res.json();
  selectConfig(data.name);
});

els.runBtn.addEventListener("click", async () => {
  if (!selectedConfig) return;
  resetCharts();
  els.logs.textContent = "";
  const target = els.targetInput.value.trim() || undefined;
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: selectedConfig, target }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    alert(`Run failed: ${e.error || res.statusText}`);
    return;
  }
  const run = await res.json();
  attachToRun(run.id);
});

els.stopBtn.addEventListener("click", async () => {
  if (!activeRunId) return;
  await fetch(`/api/runs/${activeRunId}/stop`, { method: "POST" });
});

els.clearLogs.addEventListener("click", () => {
  els.logs.textContent = "";
});

function attachToRun(id) {
  activeRunId = id;
  els.runId.textContent = id;
  setStatus("running");
  els.runBtn.disabled = true;
  els.stopBtn.disabled = false;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?run=${encodeURIComponent(id)}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "tick") onTick(msg);
    else if (msg.type === "log") onLog(msg);
    else if (msg.type === "status") onStatus(msg);
    else if (msg.type === "summary") onSummary(msg);
    else if (msg.type === "hello") onHello(msg);
  };
  ws.onclose = () => {};
}

function onHello(msg) {
  if (msg.run?.status && msg.run.status !== "running") {
    setStatus(msg.run.status);
  }
}

function onTick(t) {
  series.labels.push(fmtTime(t.t));
  series.rps.push(t.rps);
  series.p50.push(Math.round(t.p50));
  series.p95.push(Math.round(t.p95));
  series.p99.push(Math.round(t.p99));
  series.errors.push(t.errors);
  series.vus.push(t.vus);
  trim(series, MAX_POINTS);
  updateCharts();
}

function trim(s, max) {
  for (const k of Object.keys(s)) {
    while (s[k].length > max) s[k].shift();
  }
}

function onLog(l) {
  const ts = fmtTime(l.t);
  const div = document.createElement("div");
  div.innerHTML = `<span class="log-time">${ts}</span>${escapeHtml(l.line)}`;
  els.logs.appendChild(div);
  // cap
  while (els.logs.childNodes.length > 500) els.logs.removeChild(els.logs.firstChild);
  els.logs.scrollTop = els.logs.scrollHeight;
}

function onStatus(s) {
  if (s.status) setStatus(s.status);
  if (s.status === "completed" || s.status === "failed") {
    els.stopBtn.disabled = true;
    activeRunId = null;
    els.runBtn.disabled = !selectedConfig;
  }
  if (s.error) {
    onLog({ t: Date.now(), line: `[error] ${s.error}` });
  }
}

function onSummary() {
  // could render summary later; for now keep it logged.
}

function resetCharts() {
  for (const k of Object.keys(series)) series[k].length = 0;
  updateCharts();
}

function makeChart(canvasId, datasets) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: datasets.length > 1, labels: { color: "#8a93a3", font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: "#8a93a3", maxTicksLimit: 6, font: { size: 10 } }, grid: { color: "#2a313c" } },
        y: { ticks: { color: "#8a93a3", font: { size: 10 } }, grid: { color: "#2a313c" }, beginAtZero: true },
      },
      elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.25 } },
    },
  });
}

function initCharts() {
  charts.rps = makeChart("chart-rps", [
    { label: "rps", data: [], borderColor: "#4f8cff", backgroundColor: "rgba(79,140,255,0.15)", fill: true },
  ]);
  charts.latency = makeChart("chart-latency", [
    { label: "p50", data: [], borderColor: "#2ea043" },
    { label: "p95", data: [], borderColor: "#d29922" },
    { label: "p99", data: [], borderColor: "#f85149" },
  ]);
  charts.errors = makeChart("chart-errors", [
    { label: "errors/s", data: [], borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.15)", fill: true },
  ]);
  charts.vus = makeChart("chart-vus", [
    { label: "vus", data: [], borderColor: "#c678dd", backgroundColor: "rgba(198,120,221,0.15)", fill: true },
  ]);
}

function updateCharts() {
  charts.rps.data.labels = series.labels;
  charts.rps.data.datasets[0].data = series.rps;
  charts.rps.update("none");

  charts.latency.data.labels = series.labels;
  charts.latency.data.datasets[0].data = series.p50;
  charts.latency.data.datasets[1].data = series.p95;
  charts.latency.data.datasets[2].data = series.p99;
  charts.latency.update("none");

  charts.errors.data.labels = series.labels;
  charts.errors.data.datasets[0].data = series.errors;
  charts.errors.update("none");

  charts.vus.data.labels = series.labels;
  charts.vus.data.datasets[0].data = series.vus;
  charts.vus.update("none");
}

initCharts();
loadConfigs();
