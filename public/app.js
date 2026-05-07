const els = {
  foldersEl: document.getElementById("folders"),
  foldersEmpty: document.getElementById("folders-empty"),
  newFolderBtn: document.getElementById("new-folder-btn"),
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

let folders = [];
const expanded = new Set();
let selectedFolder = null;
let selectedConfig = null;
let currentCfg = null;
let activeRunId = null;
let ws = null;

const charts = {};
// Each series stores {x, y} where x = elapsed seconds since runStartT.
const series = { rps: [], p50: [], p95: [], p99: [], errors: [], vus: [] };
let runStartT = null;
let runDurationSec = null;

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

function parseDuration(s) {
  if (!s) return 0;
  const re = /(\d+(?:\.\d+)?)([smhd])/g;
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0;
  let m;
  while ((m = re.exec(String(s))) !== null) {
    total += parseFloat(m[1]) * factors[m[2]];
  }
  return total;
}

function totalDurationSec(cfg) {
  if (!cfg) return 0;
  if (cfg.executor === "constant-arrival-rate") return parseDuration(cfg.loadDuration);
  return (cfg.stages || []).reduce((sum, s) => sum + parseDuration(s.duration), 0);
}

function fmtSeconds(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

function setStatus(status) {
  els.runStatus.className = `badge badge-${status}`;
  els.runStatus.textContent = status;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function loadFolders() {
  const res = await fetch("/api/folders");
  folders = await res.json();
  // If a previously-selected folder no longer exists, clear it.
  if (selectedFolder && !folders.find((f) => f.name === selectedFolder)) {
    selectedFolder = null;
    selectedConfig = null;
    renderPreview(null);
  }
  renderFolders();
  updateRunButton();
}

function renderFolders() {
  els.foldersEl.innerHTML = "";
  els.foldersEmpty.style.display = folders.length === 0 ? "" : "none";
  for (const f of folders) {
    els.foldersEl.appendChild(renderFolderCard(f));
  }
}

function renderFolderCard(f) {
  const card = document.createElement("div");
  const isExpanded = expanded.has(f.name);
  card.className = `folder${isExpanded ? " expanded" : ""}`;

  const head = document.createElement("div");
  head.className = "folder-head";
  head.innerHTML =
    `<span class="folder-caret">${isExpanded ? "▾" : "▸"}</span>` +
    `<span class="folder-name">${escapeHtml(f.name)}</span>` +
    `<span class="folder-meta">${f.configs.length} cfg · ${f.fileCount} file${f.fileCount === 1 ? "" : "s"}</span>` +
    `<button class="folder-del" title="Delete folder">×</button>`;
  head.querySelector(".folder-del").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete folder "${f.name}" and all its files?`)) return;
    await fetch(`/api/folders/${encodeURIComponent(f.name)}`, { method: "DELETE" });
    expanded.delete(f.name);
    if (selectedFolder === f.name) {
      selectedFolder = null;
      selectedConfig = null;
      renderPreview(null);
    }
    loadFolders();
  };
  head.onclick = () => {
    if (isExpanded) expanded.delete(f.name);
    else expanded.add(f.name);
    renderFolders();
  };
  card.appendChild(head);

  if (isExpanded) {
    const body = document.createElement("div");
    body.className = "folder-body";

    const list = document.createElement("ul");
    list.className = "config-list";
    if (f.configs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "config-empty";
      empty.textContent = "No configs yet — upload a JSON with endpoints[].";
      body.appendChild(empty);
    } else {
      for (const c of f.configs) {
        const li = document.createElement("li");
        if (selectedFolder === f.name && selectedConfig === c.path) li.classList.add("active");
        li.textContent = c.path;
        li.onclick = (e) => {
          e.stopPropagation();
          selectConfig(f.name, c.path);
        };
        list.appendChild(li);
      }
      body.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "folder-actions";
    actions.innerHTML = `
      <label class="upload-btn" title="Upload one or more files">
        + File
        <input type="file" accept=".json,application/json" multiple hidden />
      </label>
      <label class="upload-btn" title="Upload a folder of files (merged in)">
        + Folder
        <input type="file" webkitdirectory directory multiple hidden />
      </label>`;
    actions.querySelectorAll("input").forEach((input, i) => {
      input.addEventListener("change", (e) => onMergeUpload(f.name, e.target, i === 1));
    });
    body.appendChild(actions);
    card.appendChild(body);
  }

  return card;
}

async function selectConfig(folder, configPath) {
  selectedFolder = folder;
  selectedConfig = configPath;
  expanded.add(folder);
  renderFolders();
  updateRunButton();
  const res = await fetch(
    `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(configPath)
      .replace(/%2F/g, "/")}`,
  );
  if (!res.ok) {
    currentCfg = null;
    renderPreview(null);
    return;
  }
  currentCfg = await res.json();
  renderPreview(currentCfg, `${folder} / ${configPath}`);
}

function updateRunButton() {
  els.runBtn.disabled = !(selectedFolder && selectedConfig) || activeRunId !== null;
}

function renderPreview(cfg, name) {
  if (!cfg) {
    els.previewName.textContent = "";
    els.previewBody.innerHTML = '<span class="muted">Pick a config in a folder.</span>';
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
    summary.push({ k: "peak VUs", v: Math.max(0, ...stages.map((s) => s.vus || s.target || 0)) });
    summary.push({ k: "duration", v: stages.map((s) => s.duration).join(" → ") });
  }
  const totalSec = totalDurationSec(cfg);
  if (totalSec > 0) summary.push({ k: "total", v: fmtSeconds(totalSec) });
  summary.push({ k: "endpoints", v: (cfg.endpoints || []).length });
  if (cfg.target) summary.push({ k: "target", v: cfg.target });

  const summaryEl = document.createElement("div");
  summaryEl.className = "preview-summary";
  for (const { k, v } of summary) {
    const kv = document.createElement("div");
    kv.className = "kv";
    kv.innerHTML = `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span>`;
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
      ? Object.entries(ep.params).map(([k, v]) => `${k}=${v}`).join("&")
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

  if (cfg.target && !els.targetInput.value) els.targetInput.value = cfg.target;
}

async function onMergeUpload(folderName, inputEl, isFolder) {
  const fileList = Array.from(inputEl.files || []);
  if (fileList.length === 0) return;

  // Folder pick: keep the picked folder's name as a subdirectory inside the
  // bucket (so uploading "loadtest/" lands at <bucket>/loadtest/...).
  // File pick: use the file's name as-is at the bucket root.
  const files = [];
  for (const f of fileList) {
    const rel = isFolder ? (f.webkitRelativePath || f.name) : f.name;
    if (!rel || rel.includes(".DS_Store") || rel.startsWith("__MACOSX/")) continue;
    if (f.size > 30 * 1024 * 1024) {
      alert(`Skipping ${rel}: file is over 30MB`);
      continue;
    }
    const content = await f.text();
    files.push({ path: rel, content });
  }
  if (files.length === 0) {
    alert("No usable files found.");
    inputEl.value = "";
    return;
  }
  const res = await fetch(`/api/folders/${encodeURIComponent(folderName)}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  inputEl.value = "";
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    alert(`Upload failed: ${e.error || res.statusText}`);
    return;
  }
  await loadFolders();
}

els.newFolderBtn.addEventListener("click", async () => {
  const name = prompt("Folder name");
  if (!name || !name.trim()) return;
  const res = await fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    alert(`Could not create folder: ${e.error || res.statusText}`);
    return;
  }
  const data = await res.json();
  expanded.add(data.name);
  await loadFolders();
});

els.runBtn.addEventListener("click", async () => {
  if (!selectedFolder || !selectedConfig) return;
  runDurationSec = totalDurationSec(currentCfg) || null;
  runStartT = null;
  resetCharts();
  els.logs.textContent = "";
  const target = els.targetInput.value.trim() || undefined;
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: selectedFolder, config: selectedConfig, target }),
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
  if (msg.run?.status && msg.run.status !== "running") setStatus(msg.run.status);
}

function onTick(t) {
  if (runStartT === null) runStartT = t.t;
  const x = (t.t - runStartT) / 1000;
  series.rps.push({ x, y: t.rps });
  series.p50.push({ x, y: Math.round(t.p50) });
  series.p95.push({ x, y: Math.round(t.p95) });
  series.p99.push({ x, y: Math.round(t.p99) });
  series.errors.push({ x, y: t.errors });
  series.vus.push({ x, y: t.vus });
  // Outgrew the predicted duration? Grow the axis just enough to keep up.
  if (runDurationSec && x > runDurationSec) {
    runDurationSec = Math.ceil(x) + 1;
    applyAxisRange();
  }
  updateCharts();
}

function onLog(l) {
  const ts = fmtTime(l.t);
  const div = document.createElement("div");
  div.innerHTML = `<span class="log-time">${ts}</span>${escapeHtml(l.line)}`;
  els.logs.appendChild(div);
  while (els.logs.childNodes.length > 500) els.logs.removeChild(els.logs.firstChild);
  els.logs.scrollTop = els.logs.scrollHeight;
}

function onStatus(s) {
  if (s.status) setStatus(s.status);
  if (s.status === "completed" || s.status === "failed" || s.status === "stopped") {
    els.stopBtn.disabled = true;
    activeRunId = null;
    updateRunButton();
  }
  if (s.error) onLog({ t: Date.now(), line: `[error] ${s.error}` });
}

function onSummary() {}

function resetCharts() {
  for (const k of Object.keys(series)) series[k].length = 0;
  applyAxisRange();
  updateCharts();
}

function applyAxisRange() {
  for (const c of Object.values(charts)) {
    c.options.scales.x.min = 0;
    c.options.scales.x.max = runDurationSec || undefined;
  }
}

function makeChart(canvasId, datasets) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      plugins: { legend: { display: datasets.length > 1, labels: { color: "#8a93a3", font: { size: 10 } } } },
      scales: {
        x: {
          type: "linear",
          min: 0,
          ticks: {
            color: "#8a93a3",
            maxTicksLimit: 8,
            font: { size: 10 },
            callback: (v) => fmtSeconds(v),
          },
          grid: { color: "#2a313c" },
        },
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
  charts.rps.data.datasets[0].data = series.rps;
  charts.rps.update("none");

  charts.latency.data.datasets[0].data = series.p50;
  charts.latency.data.datasets[1].data = series.p95;
  charts.latency.data.datasets[2].data = series.p99;
  charts.latency.update("none");

  charts.errors.data.datasets[0].data = series.errors;
  charts.errors.update("none");

  charts.vus.data.datasets[0].data = series.vus;
  charts.vus.update("none");
}

initCharts();
loadFolders();
