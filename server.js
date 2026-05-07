import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runner } from "./runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4567);
const CONFIGS_DIR = path.join(__dirname, "configs");
const RUNS_DIR = path.join(__dirname, "runs");

await fs.mkdir(CONFIGS_DIR, { recursive: true });
await fs.mkdir(RUNS_DIR, { recursive: true });
await migrateLooseConfigs();

const runner = new Runner();
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^[._]+/, "").slice(0, 100) || "config";
}

function safeRelPath(p) {
  return p
    .split(/[\\/]/)
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[^a-zA-Z0-9_.-]/g, "_"))
    .join("/");
}

async function findConfigFile(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  // Prefer config.json; fall back to any *.json containing an endpoints array.
  const candidates = [];
  if (entries.includes("config.json")) candidates.push("config.json");
  for (const f of entries) {
    if (f !== "config.json" && f.endsWith(".json")) candidates.push(f);
  }
  for (const c of candidates) {
    try {
      const txt = await fs.readFile(path.join(dir, c), "utf8");
      const json = JSON.parse(txt);
      if (Array.isArray(json.endpoints)) return path.join(dir, c);
    } catch {}
  }
  return null;
}

async function migrateLooseConfigs() {
  const entries = await fs.readdir(CONFIGS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const baseName = safeName(e.name.replace(/\.json$/, ""));
    const targetDir = path.join(CONFIGS_DIR, baseName);
    try {
      await fs.access(targetDir);
      // Target already exists; leave the loose file alone.
      continue;
    } catch {}
    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(
      path.join(CONFIGS_DIR, e.name),
      path.join(targetDir, "config.json"),
    );
    console.log(`migrated ${e.name} -> ${baseName}/config.json`);
  }
}

app.get("/api/configs", async (_req, res) => {
  const entries = await fs.readdir(CONFIGS_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(CONFIGS_DIR, e.name);
    const configFile = await findConfigFile(dir);
    if (!configFile) continue;
    const stat = await fs.stat(configFile);
    const all = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    const fileCount = all.filter((f) => f.isFile()).length;
    out.push({ name: e.name, mtime: stat.mtimeMs, size: stat.size, fileCount });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  res.json(out);
});

app.get("/api/configs/:name", async (req, res) => {
  const name = safeName(req.params.name);
  const dir = path.join(CONFIGS_DIR, name);
  const configFile = await findConfigFile(dir);
  if (!configFile) return res.status(404).json({ error: "not found" });
  const content = await fs.readFile(configFile, "utf8");
  res.type("application/json").send(content);
});

app.post("/api/configs", async (req, res) => {
  const { name, content, files } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const dirName = safeName(name.replace(/\.json$/, ""));
  const targetDir = path.join(CONFIGS_DIR, dirName);

  if (Array.isArray(files) && files.length > 0) {
    // Bundle upload: many files preserving relative paths.
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    for (const f of files) {
      if (typeof f.path !== "string" || typeof f.content !== "string") continue;
      const rel = safeRelPath(f.path);
      if (!rel) continue;
      const dest = path.join(targetDir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.content);
    }
    const cf = await findConfigFile(targetDir);
    if (!cf) {
      await fs.rm(targetDir, { recursive: true, force: true });
      return res
        .status(400)
        .json({ error: "no JSON file with an 'endpoints' array found in bundle" });
    }
    return res.json({ name: dirName });
  }

  if (typeof content === "string" || (content && typeof content === "object")) {
    let parsed;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch (e) {
      return res.status(400).json({ error: `invalid JSON: ${e.message}` });
    }
    if (!Array.isArray(parsed.endpoints) || parsed.endpoints.length === 0) {
      return res.status(400).json({ error: "config must have a non-empty endpoints array" });
    }
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "config.json"), JSON.stringify(parsed, null, 2));
    return res.json({ name: dirName });
  }

  return res.status(400).json({ error: "either content or files[] required" });
});

app.delete("/api/configs/:name", async (req, res) => {
  const name = safeName(req.params.name);
  const dir = path.join(CONFIGS_DIR, name);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.get("/api/runs", (_req, res) => {
  res.json(runner.list());
});

app.get("/api/runs/:id", (req, res) => {
  const run = runner.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json({
    ...run.snapshot(),
    ticks: run.tickHistory,
    logs: run.logLines.slice(-500),
  });
});

app.post("/api/runs", async (req, res) => {
  const { config: configName, target } = req.body || {};
  if (!configName) return res.status(400).json({ error: "config required" });
  const dir = path.join(CONFIGS_DIR, safeName(configName));
  const configFile = await findConfigFile(dir);
  if (!configFile) return res.status(404).json({ error: "config not found" });
  const run = await runner.create({ configPath: configFile, target });
  res.json(run.snapshot());
});

app.post("/api/runs/:id/stop", (req, res) => {
  const run = runner.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  run.stop();
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const runId = url.searchParams.get("run");
  if (!runId) {
    ws.close(1008, "run query param required");
    return;
  }
  const run = runner.get(runId);
  if (!run) {
    ws.close(1008, "run not found");
    return;
  }

  const send = (type, payload) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  };

  // Replay history
  send("hello", { run: run.snapshot() });
  for (const t of run.tickHistory) send("tick", t);
  for (const l of run.logLines.slice(-200)) send("log", l);
  if (run.status !== "running") send("status", { status: run.status, error: run.error });

  const onTick = (t) => send("tick", t);
  const onLog = (l) => send("log", l);
  const onStatus = (s) => send("status", s);
  const onSummary = (s) => send("summary", { data: s });

  run.on("tick", onTick);
  run.on("log", onLog);
  run.on("status", onStatus);
  run.on("summary", onSummary);

  ws.on("close", () => {
    run.off("tick", onTick);
    run.off("log", onLog);
    run.off("status", onStatus);
    run.off("summary", onSummary);
  });
});

server.listen(PORT, () => {
  console.log(`k6-studio running at http://localhost:${PORT}`);
});
