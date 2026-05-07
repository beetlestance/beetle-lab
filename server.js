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

const runner = new Runner();
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
}

app.get("/api/configs", async (_req, res) => {
  const files = (await fs.readdir(CONFIGS_DIR)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    const stat = await fs.stat(path.join(CONFIGS_DIR, f));
    out.push({ name: f, size: stat.size, mtime: stat.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  res.json(out);
});

app.get("/api/configs/:name", async (req, res) => {
  const name = safeName(req.params.name);
  try {
    const content = await fs.readFile(path.join(CONFIGS_DIR, name), "utf8");
    res.type("application/json").send(content);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.post("/api/configs", async (req, res) => {
  const { name, content } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: "name and content required" });
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch (e) {
    return res.status(400).json({ error: `invalid JSON: ${e.message}` });
  }
  if (!Array.isArray(parsed.endpoints) || parsed.endpoints.length === 0) {
    return res.status(400).json({ error: "config must have a non-empty endpoints array" });
  }
  const fname = safeName(name.endsWith(".json") ? name : `${name}.json`);
  await fs.writeFile(path.join(CONFIGS_DIR, fname), JSON.stringify(parsed, null, 2));
  res.json({ name: fname });
});

app.delete("/api/configs/:name", async (req, res) => {
  const name = safeName(req.params.name);
  try {
    await fs.unlink(path.join(CONFIGS_DIR, name));
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
  const configPath = path.join(CONFIGS_DIR, safeName(configName));
  try {
    await fs.access(configPath);
  } catch {
    return res.status(404).json({ error: "config not found" });
  }
  const run = await runner.create({ configPath, target });
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
