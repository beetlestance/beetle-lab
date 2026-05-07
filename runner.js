import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADTEST_SCRIPT = path.join(__dirname, "loadtest.js");
const RUNS_DIR = path.join(__dirname, "runs");

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

class Run extends EventEmitter {
  constructor({ id, configPath, target, k6Bin = "k6" }) {
    super();
    this.id = id;
    this.configPath = configPath;
    this.target = target;
    this.k6Bin = k6Bin;
    this.dir = path.join(RUNS_DIR, id);
    this.metricsPath = path.join(this.dir, "metrics.jsonl");
    this.summaryPath = path.join(this.dir, "summary.json");
    this.logPath = path.join(this.dir, "log.txt");
    this.status = "pending";
    this.startedAt = null;
    this.endedAt = null;
    this.exitCode = null;
    this.error = null;
    this.stopRequested = false;
    this.proc = null;
    this.logLines = [];
    this.tickHistory = [];
    this.metricNames = {};
    this.bucket = null;
    this.bucketTimer = null;
    this.tailer = null;
    this.aliveFlag = true;
  }

  async start() {
    await fsp.mkdir(this.dir, { recursive: true });
    fs.writeFileSync(this.metricsPath, "");
    this.logStream = fs.createWriteStream(this.logPath, { flags: "a" });

    const env = {
      ...process.env,
      CONFIG: this.configPath,
      CONFIG_DIR: path.dirname(this.configPath),
      SUMMARY_PATH: this.summaryPath,
    };
    if (this.target) env.TARGET = this.target;

    const args = [
      "run",
      "--quiet",
      "--out",
      `json=${this.metricsPath}`,
      LOADTEST_SCRIPT,
    ];

    this.status = "running";
    this.startedAt = Date.now();
    this.emit("status", { status: this.status, startedAt: this.startedAt });

    this.proc = spawn(this.k6Bin, args, { env, cwd: __dirname });

    this.proc.stdout.on("data", (chunk) => this._handleLog(chunk));
    this.proc.stderr.on("data", (chunk) => this._handleLog(chunk));

    this.proc.on("error", (err) => {
      this.status = "failed";
      this.error = err.message;
      this.emit("status", { status: this.status, error: this.error });
    });

    this.proc.on("exit", (code) => {
      this.exitCode = code;
      this._stopTailing();
      // Drain final tail and read summary, then emit completion.
      setTimeout(async () => {
        await this._drainTail();
        this._flushBucket(true);
        let summary = null;
        try {
          summary = JSON.parse(await fsp.readFile(this.summaryPath, "utf8"));
        } catch {}
        this.endedAt = Date.now();
        if (this.stopRequested) {
          this.status = "stopped";
        } else if (code === 0 || code === 99) {
          // 99 = thresholds crossed; the test still ran.
          this.status = "completed";
          if (code === 99) this.thresholdFailed = true;
        } else {
          this.status = "failed";
          if (!this.error) this.error = `k6 exited with code ${code}`;
        }
        this.emit("summary", summary);
        this.emit("status", {
          status: this.status,
          endedAt: this.endedAt,
          exitCode: code,
          error: this.error,
        });
      }, 500);
    });

    this._startTailing();
    this._startBucketTimer();
  }

  stop() {
    if (this.proc && this.status === "running") {
      this.stopRequested = true;
      try {
        this.proc.kill("SIGINT");
      } catch {}
    }
  }

  _handleLog(chunk) {
    const text = chunk.toString("utf8");
    this.logStream?.write(text);
    text.split(/\r?\n/).forEach((line) => {
      if (line.length === 0) return;
      const entry = { t: Date.now(), line };
      this.logLines.push(entry);
      if (this.logLines.length > 2000) this.logLines.shift();
      this.emit("log", entry);
    });
  }

  _startTailing() {
    let offset = 0;
    let buffer = "";
    const tick = async () => {
      if (!this.aliveFlag) return;
      try {
        const stat = await fsp.stat(this.metricsPath);
        if (stat.size > offset) {
          const fd = await fsp.open(this.metricsPath, "r");
          const len = stat.size - offset;
          const buf = Buffer.alloc(len);
          await fd.read(buf, 0, len, offset);
          await fd.close();
          offset = stat.size;
          buffer += buf.toString("utf8");
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line) this._handleMetricLine(line);
          }
        }
      } catch {}
      this.tailer = setTimeout(tick, 250);
    };
    this._tailState = () => ({ offset, buffer });
    this.tailer = setTimeout(tick, 100);
  }

  _stopTailing() {
    this.aliveFlag = false;
    if (this.tailer) clearTimeout(this.tailer);
    if (this.bucketTimer) clearInterval(this.bucketTimer);
  }

  async _drainTail() {
    try {
      const data = await fsp.readFile(this.metricsPath, "utf8");
      const state = this._tailState ? this._tailState() : { offset: 0, buffer: "" };
      const remaining = data.slice(state.offset) + state.buffer;
      remaining.split("\n").forEach((line) => {
        if (line) this._handleMetricLine(line);
      });
    } catch {}
  }

  _handleMetricLine(line) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (evt.type === "Metric") {
      this.metricNames[evt.data.name] = evt.data;
      return;
    }
    if (evt.type !== "Point") return;
    const metricName = evt.metric;
    const value = evt.data.value;
    const time = new Date(evt.data.time).getTime();
    const tags = evt.data.tags || {};
    if (!this.bucket) this._openBucket(time);
    if (time >= this.bucket.windowEnd) {
      this._flushBucket();
      this._openBucket(time);
    }
    this._recordPoint(metricName, value, tags);
  }

  _openBucket(time) {
    const start = Math.floor(time / 1000) * 1000;
    this.bucket = {
      windowStart: start,
      windowEnd: start + 1000,
      reqs: 0,
      durations: [],
      failed: 0,
      vus: 0,
      iterations: 0,
      errors: 0,
      endpointLatencies: {},
    };
  }

  _recordPoint(name, value, tags) {
    const b = this.bucket;
    if (name === "http_reqs") b.reqs += value;
    else if (name === "http_req_duration") b.durations.push(value);
    else if (name === "http_req_failed") {
      if (value > 0) b.failed += 1;
    } else if (name === "vus") b.vus = Math.max(b.vus, value);
    else if (name === "iterations") b.iterations += value;
    else if (name === "errors") b.errors += value;
    else if (name.startsWith("ep_") && name.endsWith("_latency")) {
      const ep = name.slice(3, -"_latency".length);
      if (!b.endpointLatencies[ep]) b.endpointLatencies[ep] = [];
      b.endpointLatencies[ep].push(value);
    }
  }

  _startBucketTimer() {
    // Emit bucket every second even if no points arrived (so charts keep advancing).
    this.bucketTimer = setInterval(() => {
      if (this.bucket && Date.now() >= this.bucket.windowEnd) {
        this._flushBucket();
      }
    }, 500);
  }

  _flushBucket(final = false) {
    if (!this.bucket) return;
    const b = this.bucket;
    const durations = b.durations.slice().sort((a, b) => a - b);
    const tick = {
      t: b.windowStart,
      rps: b.reqs,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      avg: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
      failed: b.failed,
      errors: b.errors,
      vus: b.vus,
      iterations: b.iterations,
      endpoints: Object.fromEntries(
        Object.entries(b.endpointLatencies).map(([k, vs]) => {
          const sorted = vs.slice().sort((a, b) => a - b);
          return [k, { count: vs.length, p95: percentile(sorted, 95) }];
        }),
      ),
    };
    this.tickHistory.push(tick);
    if (this.tickHistory.length > 1800) this.tickHistory.shift();
    this.emit("tick", tick);
    if (final) {
      this.bucket = null;
    } else {
      this._openBucket(b.windowEnd);
    }
  }

  snapshot() {
    return {
      id: this.id,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exitCode: this.exitCode,
      error: this.error,
      target: this.target,
      configPath: this.configPath,
    };
  }
}

export class Runner {
  constructor() {
    this.runs = new Map();
  }

  list() {
    return [...this.runs.values()].map((r) => r.snapshot());
  }

  get(id) {
    return this.runs.get(id);
  }

  async create({ configPath, target }) {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    const run = new Run({ id, configPath, target });
    this.runs.set(id, run);
    await run.start();
    return run;
  }
}
