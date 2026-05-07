import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Gauge } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

// CONFIG points to an absolute path to a JSON config file.
// CONFIG_DIR is its directory (used to resolve bodyFile references).
// TARGET overrides config.target.
// SUMMARY_PATH (optional) is where handleSummary writes summary.json.
// SUMMARY_TXT_PATH (optional) is where the rich text report is written.
const CONFIG_FILE = __ENV.CONFIG;
if (!CONFIG_FILE) throw new Error("CONFIG env var is required");
const CONFIG_DIR = __ENV.CONFIG_DIR || ".";
const config = JSON.parse(open(CONFIG_FILE));

config.endpoints.forEach((ep) => {
  if (ep.bodyFile) {
    const p = ep.bodyFile.startsWith("/") ? ep.bodyFile : `${CONFIG_DIR}/${ep.bodyFile}`;
    ep.body = JSON.parse(open(p));
  }
});

const TARGET = __ENV.TARGET || config.target || "http://localhost:8080";

// Standard load metrics
const errors = new Counter("errors");
const endpointLatency = {};
config.endpoints.forEach((ep) => {
  endpointLatency[ep.name] = new Trend(`ep_${ep.name}_latency`);
});

// Memory & runtime metrics — emitted only when memorySampling is enabled.
// Names match the original ecs-content loadtest so the rich report renders
// the same regardless of which service is being measured.
const heapInuse = new Gauge("heap_inuse_bytes");
const activeHandles = new Gauge("active_handles");
const activeRequests = new Gauge("active_requests");
const rssBytes = new Gauge("rss_bytes");
const externalBytes = new Gauge("external_bytes");
const baselineHeap = new Gauge("baseline_heap_mb");
const baselineHandles = new Gauge("baseline_handles");
const baselineRss = new Gauge("baseline_rss_mb");
const peakHeapGauge = new Gauge("peak_heap_mb");
const peakRssGauge = new Gauge("peak_rss_mb");

const cpuPercent = new Gauge("cpu_percent");
const systemCpuPercent = new Gauge("system_cpu_percent");
const baselineCpu = new Gauge("baseline_cpu_percent");
const peakCpuGauge = new Gauge("peak_cpu_percent");
const avgCpuTrend = new Trend("avg_cpu_percent");

const cooldownHeap = new Gauge("cooldown_heap_mb");
const cooldownHandles = new Gauge("cooldown_handles");
const cooldownRss = new Gauge("cooldown_rss_mb");
const cooldownCpu = new Gauge("cooldown_cpu");

const heapSizeLimit = new Gauge("heap_size_limit_mb");
const heapTotalSize = new Gauge("heap_total_size_mb");
const cppHeapAllocated = new Gauge("cpp_heap_allocated_mb");
const cppHeapUsed = new Gauge("cpp_heap_used_mb");

const eventLoopMean = new Trend("event_loop_delay_mean_ms");
const eventLoopP90 = new Gauge("event_loop_delay_p90_ms");
const eventLoopP99 = new Gauge("event_loop_delay_p99_ms");
const eventLoopMax = new Gauge("event_loop_delay_max_ms");

const gcCount = new Gauge("gc_count");
const gcTotalMs = new Gauge("gc_total_ms");
const gcMaxMs = new Gauge("gc_max_ms");
const gcAvgMs = new Gauge("gc_avg_ms");

const uvThreadpoolSize = new Gauge("uv_threadpool_size");

const stages = config.stages || [
  { duration: "30s", target: 10 },
  { duration: "1m", target: 25 },
  { duration: "30s", target: 0 },
];
const k6Stages = stages.map((s) => ({
  duration: s.duration,
  target: s.vus || s.target || 0,
}));

const iterationCounts = {};
config.endpoints.forEach((ep) => {
  iterationCounts[ep.name] = 0;
});

const memorySamplingEnabled = !!config.memorySampling?.enabled;
const memorySamplerInterval = config.memorySampling?.intervalSeconds || 2;
const memorySamplerEndpoint = config.memorySampling?.endpoint || "/debug/procstats";
const cooldownSeconds = Math.max(0, config.memorySampling?.cooldownSeconds || 0);

function buildLoadScenario() {
  const executorType = config.executor || "ramping-vus";
  if (executorType === "constant-arrival-rate") {
    return {
      executor: "constant-arrival-rate",
      rate: config.rate || 20,
      timeUnit: config.timeUnit || "1s",
      duration: config.loadDuration || "3m",
      preAllocatedVUs: config.preAllocatedVUs || 50,
      maxVUs: config.maxVUs || 200,
      exec: "runEndpoint",
    };
  }
  return {
    executor: "ramping-vus",
    stages: k6Stages,
    gracefulRampDown: "30s",
    exec: "runEndpoint",
  };
}

// Estimate the total active-load duration so the memory sampler runs at
// least that long. Caller can also set config.duration explicitly.
function estimateLoadDurationS() {
  if (config.duration) return parseDurationS(config.duration);
  if (config.executor === "constant-arrival-rate") return parseDurationS(config.loadDuration || "3m");
  return stages.reduce((sum, s) => sum + parseDurationS(s.duration), 0);
}

function parseDurationS(s) {
  const re = /(\d+(?:\.\d+)?)([smhd])/g;
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0;
  let m;
  while ((m = re.exec(String(s))) !== null) total += parseFloat(m[1]) * factors[m[2]];
  return total;
}

const samplerDuration = `${Math.ceil(estimateLoadDurationS() + 5)}s`;

const scenarios = { load_test: buildLoadScenario() };
if (memorySamplingEnabled) {
  scenarios.memory_sampler = {
    executor: "constant-vus",
    vus: 1,
    duration: samplerDuration,
    exec: "sampleMemory",
  };
}

export const options = {
  scenarios,
  thresholds: config.thresholds || {},
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  // Allow generous teardown: cooldownSeconds + buffer.
  teardownTimeout: `${Math.max(60, cooldownSeconds + 30)}s`,
};

// State for memory and CPU tracking
let baselineStats = null;
let peakMemory = 0;
let peakRss = 0;
let peakCpu = 0;

function getRandomToken() {
  if (!config.tokens || config.tokens.length === 0) return null;
  return config.tokens[Math.floor(Math.random() * config.tokens.length)];
}

function selectEndpoint() {
  const active = config.endpoints.filter(
    (ep) => !ep.maxIterations || iterationCounts[ep.name] < ep.maxIterations,
  );
  if (active.length === 0) return null;
  const total = active.reduce((sum, ep) => sum + (ep.weight || 1), 0);
  const rand = Math.random() * total;
  let cumulative = 0;
  for (const ep of active) {
    cumulative += ep.weight || 1;
    if (rand < cumulative) {
      iterationCounts[ep.name]++;
      return ep;
    }
  }
  const fallback = active[active.length - 1];
  iterationCounts[fallback.name]++;
  return fallback;
}

function buildUrl(endpoint) {
  let url = `${TARGET}${endpoint.path}`;
  if (endpoint.params && Object.keys(endpoint.params).length > 0) {
    const parts = [];
    for (const [key, value] of Object.entries(endpoint.params)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    url += `?${parts.join("&")}`;
  }
  return url;
}

function buildHeaders(endpoint) {
  const headers = {};
  if (endpoint.headers) {
    const token = getRandomToken();
    for (const [key, value] of Object.entries(endpoint.headers)) {
      headers[key] = String(value).replace("${token}", token || "");
    }
  }
  return headers;
}

function runChecks(endpoint, response) {
  const checks = endpoint.checks || {};
  const out = {};
  if (checks.status !== undefined) {
    out[`${endpoint.name} status is ${checks.status}`] = response.status === checks.status;
  }
  if (checks.statusNot5xx) {
    out[`${endpoint.name} status not 5xx`] = response.status < 500;
  }
  if (checks.status2xx) {
    out[`${endpoint.name} status is 2xx`] = response.status >= 200 && response.status < 300;
  }
  if (checks.bodyContains) {
    out[`${endpoint.name} body contains ${checks.bodyContains}`] =
      response.body && response.body.includes(checks.bodyContains);
  }
  if (Object.keys(out).length === 0) {
    out[`${endpoint.name} responded`] = response.status > 0;
  }
  return check(response, out);
}

export function setup() {
  const healthPath = config.healthPath;
  if (!healthPath) {
    console.log(`Target: ${TARGET} | health check skipped (no healthPath in config)`);
    return;
  }
  const maxRetries = config.healthMaxRetries ?? 15;
  const interval = config.healthIntervalSeconds ?? 2;
  for (let i = 0; i < maxRetries; i++) {
    const res = http.get(`${TARGET}${healthPath}`);
    if (res.status >= 200 && res.status < 300) {
      console.log(`Service healthy after ${i * interval}s`);
      return;
    }
    console.log(`Waiting for service... ${i + 1}/${maxRetries} (status=${res.status})`);
    sleep(interval);
  }
  console.log("WARNING: service did not become healthy; running anyway");
}

export function runEndpoint() {
  const endpoint = selectEndpoint();
  if (!endpoint) {
    sleep(0.1);
    return;
  }
  const url = buildUrl(endpoint);
  const headers = buildHeaders(endpoint);
  const method = (endpoint.method || "GET").toUpperCase();

  let response;
  switch (method) {
    case "POST":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.post(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
      break;
    case "PUT":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.put(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
      break;
    case "DELETE":
      response = http.del(url, null, { headers });
      break;
    case "PATCH":
      if (endpoint.body) headers["Content-Type"] = "application/json";
      response = http.patch(url, endpoint.body ? JSON.stringify(endpoint.body) : null, { headers });
      break;
    default:
      response = http.get(url, { headers });
  }

  endpointLatency[endpoint.name].add(response.timings.duration);
  if (!runChecks(endpoint, response)) errors.add(1);

  if (endpoint.waitMs) {
    const wait = endpoint.waitMs.min + Math.random() * (endpoint.waitMs.max - endpoint.waitMs.min);
    sleep(wait / 1000);
  } else {
    sleep(0.02);
  }
}

// Periodically poll a Node.js procstats-style endpoint and record runtime
// metrics. Compatible with the original ecs-content shape; missing fields
// are simply skipped.
export function sampleMemory() {
  const response = http.get(`${TARGET}${memorySamplerEndpoint}`);

  if (response.status === 200) {
    try {
      const stats = JSON.parse(response.body);

      const heapBytes = stats.heapInuse || stats.usedHeapSize || 0;
      const heapMB = heapBytes / 1048576;
      const rssMB = (stats.rss || 0) / 1048576;
      const handles = stats.goroutines || stats.activeHandles || 0;
      const requests = stats.activeRequests || 0;
      const procCpu = stats.cpuPercent || 0;
      const sysCpu = stats.systemCpuPercent || 0;
      const heapLimit = (stats.heapSizeLimit || 0) / 1048576;
      const heapTotal = (stats.totalHeapSize || 0) / 1048576;
      const external = stats.external || 0;

      const cppHeap = stats.cppHeap || {};
      const cppAllocMB = (cppHeap.allocated_size || 0) / 1048576;
      const cppUsedMB = (cppHeap.used_size || 0) / 1048576;

      heapInuse.add(heapBytes);
      activeHandles.add(handles);
      activeRequests.add(requests);
      rssBytes.add(stats.rss || 0);
      externalBytes.add(external);
      heapSizeLimit.add(heapLimit);
      heapTotalSize.add(heapTotal);
      cppHeapAllocated.add(cppAllocMB);
      cppHeapUsed.add(cppUsedMB);

      cpuPercent.add(procCpu);
      systemCpuPercent.add(sysCpu);
      avgCpuTrend.add(procCpu);

      const eld = stats.eventLoopDelay;
      if (eld) {
        eventLoopMean.add(eld.mean);
        eventLoopP90.add(eld.p90);
        eventLoopP99.add(eld.p99);
        eventLoopMax.add(eld.max);
      }

      const gc = stats.gc;
      if (gc) {
        gcCount.add(gc.count);
        gcTotalMs.add(gc.totalMs);
        gcMaxMs.add(gc.maxMs);
        gcAvgMs.add(gc.avgMs);
      }

      if (stats.uvThreadpoolSize) uvThreadpoolSize.add(stats.uvThreadpoolSize);

      if (heapMB > peakMemory) {
        peakMemory = heapMB;
        peakHeapGauge.add(heapMB);
      }
      if (rssMB > peakRss) {
        peakRss = rssMB;
        peakRssGauge.add(rssMB);
      }
      if (procCpu > peakCpu) {
        peakCpu = procCpu;
        peakCpuGauge.add(procCpu);
      }

      if (baselineStats === null) {
        baselineStats = { heapMB, rssMB, handles, requests, external, cpuPercent: procCpu };
        baselineHeap.add(heapMB);
        baselineHandles.add(handles);
        baselineRss.add(rssMB);
        baselineCpu.add(procCpu);

        console.log(`=== Load Test Started === Target: ${TARGET} | Config: ${CONFIG_FILE}`);
        console.log(
          `Endpoints: ${config.endpoints.map((e) => e.name).join(", ")} | Tokens: ${config.tokens?.length || 0}`,
        );
        const uvStr = stats.uvThreadpoolSize ? ` | UV_THREADPOOL=${stats.uvThreadpoolSize}` : "";
        console.log(
          `Baseline: Heap=${heapMB.toFixed(2).padStart(7)} MB | RSS=${rssMB.toFixed(2).padStart(7)} MB | Handles=${handles.toString().padStart(4)} | ProcCPU=${procCpu.toFixed(1).padStart(5)}%${uvStr}`,
        );
      }

      const cppStr = cppAllocMB > 0 ? ` | CppHeap=${cppUsedMB.toFixed(1)}/${cppAllocMB.toFixed(1)}MB` : "";
      const eldStr = eld ? ` | EL_p90=${eld.p90.toFixed(1)}ms EL_max=${eld.max.toFixed(1)}ms` : "";
      const gcStr = gc ? ` | GC=${gc.count} max=${gc.maxMs.toFixed(1)}ms` : "";
      console.log(
        `[Sample] Heap=${heapMB.toFixed(2).padStart(7)} MB | RSS=${rssMB.toFixed(2).padStart(7)} MB | Handles=${handles.toString().padStart(4)} | ProcCPU=${procCpu.toFixed(1).padStart(5)}%${cppStr}${eldStr}${gcStr}`,
      );
    } catch (e) {
      console.log(`[Sample] Failed to parse response: ${e.message}`);
    }
  } else {
    console.log(`[Sample] Failed to fetch procstats: ${response.status}`);
  }

  sleep(memorySamplerInterval);
}

// Optional cooldown sample after the load ends.
export function teardown() {
  if (!memorySamplingEnabled || cooldownSeconds <= 0) return;
  console.log(`\n=== Load Test Complete === Cooldown ${cooldownSeconds}s ...`);
  sleep(cooldownSeconds);

  const response = http.get(`${TARGET}${memorySamplerEndpoint}`);
  if (response.status !== 200) {
    console.log(`[Cooldown] Failed to fetch procstats: ${response.status}`);
    return;
  }
  try {
    const stats = JSON.parse(response.body);
    const heapMB = (stats.heapInuse || stats.usedHeapSize || 0) / 1048576;
    const rssMB = (stats.rss || 0) / 1048576;
    const handles = stats.goroutines || stats.activeHandles || 0;
    const procCpu = stats.cpuPercent || 0;
    cooldownHeap.add(heapMB);
    cooldownHandles.add(handles);
    cooldownRss.add(rssMB);
    cooldownCpu.add(procCpu);
    console.log(
      `\n=== Cooldown Complete === Heap=${heapMB.toFixed(1)}MB | RSS=${rssMB.toFixed(1)}MB | CPU=${procCpu.toFixed(0)}%`,
    );
  } catch (e) {
    console.log(`[Cooldown] Failed to parse response: ${e.message}`);
  }
}

function formatDelta(value, unit = "") {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

// Build the rich text report. Mirrors the ecs-content original — sections are
// only rendered when their underlying metrics are present in `data`.
function buildReport(data) {
  const W = 62;
  const line = "=".repeat(W);
  const dash = "-".repeat(W);
  let out = "\n";
  out += line + "\n";
  out += "NODE.JS PERFORMANCE ANALYSIS REPORT".padStart((W + 35) / 2).padEnd(W) + "\n";
  out += line + "\n";

  const metrics = data.metrics;
  const hasMemoryData = metrics.baseline_heap_mb && metrics.active_handles;

  const row = (label, value) => {
    const gap = W - label.length - value.length;
    return label + ".".repeat(Math.max(gap, 1)) + value + "\n";
  };

  if (hasMemoryData) {
    const baselineHeapMB = metrics.baseline_heap_mb?.values?.value || 0;
    const baselineHandlesVal = metrics.baseline_handles?.values?.value || 0;
    const baselineRssMB = metrics.baseline_rss_mb?.values?.value || 0;
    const baselineCpuVal = metrics.baseline_cpu_percent?.values?.value || 0;

    const cooldownHeapMB = metrics.cooldown_heap_mb?.values?.value ?? null;
    const cooldownHandlesVal = metrics.cooldown_handles?.values?.value ?? null;
    const cooldownRssMB = metrics.cooldown_rss_mb?.values?.value ?? null;
    const cooldownCpuVal = metrics.cooldown_cpu?.values?.value ?? null;
    const hasCooldown = cooldownHeapMB !== null;

    const finalHeapBytes = metrics.heap_inuse_bytes?.values?.value || 0;
    const finalHeapMB = finalHeapBytes / 1048576;
    const finalHandles = metrics.active_handles?.values?.value || 0;
    const finalRssBytes = metrics.rss_bytes?.values?.value || 0;
    const finalRssMB = finalRssBytes / 1048576;
    const finalCpu = metrics.cpu_percent?.values?.value || 0;

    const peakHeapMB = metrics.peak_heap_mb?.values?.value || finalHeapMB;
    const peakRssMB = metrics.peak_rss_mb?.values?.value || finalRssMB;
    const peakCpuVal = metrics.peak_cpu_percent?.values?.value || 0;
    const avgCpuVal = metrics.avg_cpu_percent?.values?.avg || 0;

    const heapDelta = finalHeapMB - baselineHeapMB;
    const handleDelta = finalHandles - baselineHandlesVal;
    const rssDelta = finalRssMB - baselineRssMB;

    out += "\n[V8 HEAP MEMORY - Baseline]\n" + dash + "\n";
    out += row("  Heap Used", `${baselineHeapMB.toFixed(2)} MB`);
    out += row("  RSS (Physical Memory)", `${baselineRssMB.toFixed(2)} MB`);
    out += row("  Active Handles (libuv)", `${baselineHandlesVal}`);

    out += "\n[V8 HEAP MEMORY - Final (End of Load)]\n" + dash + "\n";
    out += row("  Heap Used", `${finalHeapMB.toFixed(2)} MB`);
    out += row("  RSS (Physical Memory)", `${finalRssMB.toFixed(2)} MB`);
    out += row("  Active Handles (libuv)", `${finalHandles}`);
    out += row("  Peak Heap", `${peakHeapMB.toFixed(2)} MB`);
    out += row("  Peak RSS", `${peakRssMB.toFixed(2)} MB`);

    if (hasCooldown) {
      out += "\n[V8 HEAP MEMORY - After Cooldown]\n" + dash + "\n";
      out += row("  Heap Used", `${cooldownHeapMB.toFixed(2)} MB`);
      out += row("  RSS (Physical Memory)", `${cooldownRssMB.toFixed(2)} MB`);
      out += row("  Active Handles (libuv)", `${cooldownHandlesVal}`);
      out += row("  Heap vs Baseline", formatDelta(cooldownHeapMB - baselineHeapMB, " MB"));
    }

    out += "\n[MEMORY - Delta Analysis]\n" + dash + "\n";
    out += row("  Heap Change (Final vs Baseline)", formatDelta(heapDelta, " MB"));
    out += row("  RSS Change (Final vs Baseline)", formatDelta(rssDelta, " MB"));
    if (hasCooldown) {
      out += row("  Heap Change (Cooldown vs Baseline)", formatDelta(cooldownHeapMB - baselineHeapMB, " MB"));
      out += row("  RSS Change (Cooldown vs Baseline)", formatDelta(cooldownRssMB - baselineRssMB, " MB"));
    }
    out += row("  Handle Change", formatDelta(handleDelta, ""));

    out += "\n[CPU UTILIZATION]\n" + dash + "\n";
    out += row("  Baseline CPU", `${baselineCpuVal.toFixed(1)}%`);
    out += row("  Final CPU", `${finalCpu.toFixed(1)}%`);
    if (hasCooldown) out += row("  Cooldown CPU", `${cooldownCpuVal.toFixed(1)}%`);
    out += row("  Peak CPU", `${peakCpuVal.toFixed(1)}%`);
    out += row("  Average CPU", `${avgCpuVal.toFixed(1)}%`);

    const eldMeanAvg = metrics.event_loop_delay_mean_ms?.values?.avg;
    if (eldMeanAvg !== undefined) {
      const eldP90Val = metrics.event_loop_delay_p90_ms?.values?.value || 0;
      const eldP99Val = metrics.event_loop_delay_p99_ms?.values?.value || 0;
      const eldMaxVal = metrics.event_loop_delay_max_ms?.values?.value || 0;
      out += "\n[EVENT LOOP DELAY]\n" + dash + "\n";
      out += row("  Mean", `${eldMeanAvg.toFixed(2)} ms`);
      out += row("  p90", `${eldP90Val.toFixed(2)} ms`);
      out += row("  p99", `${eldP99Val.toFixed(2)} ms`);
      out += row("  Max", `${eldMaxVal.toFixed(2)} ms`);
    }

    const gcCountVal = metrics.gc_count?.values?.value;
    if (gcCountVal !== undefined) {
      const gcTotalVal = metrics.gc_total_ms?.values?.value || 0;
      const gcMaxVal = metrics.gc_max_ms?.values?.value || 0;
      const gcAvgVal = metrics.gc_avg_ms?.values?.value || 0;
      out += "\n[GARBAGE COLLECTION]\n" + dash + "\n";
      out += row("  Total GC pauses", `${gcCountVal}`);
      out += row("  Total GC time", `${gcTotalVal.toFixed(2)} ms`);
      out += row("  Avg GC pause", `${gcAvgVal.toFixed(2)} ms`);
      out += row("  Max GC pause", `${gcMaxVal.toFixed(2)} ms`);
    }

    const cppAllocVal = metrics.cpp_heap_allocated_mb?.values?.value;
    if (cppAllocVal !== undefined) {
      const cppUsedVal = metrics.cpp_heap_used_mb?.values?.value || 0;
      out += "\n[C++ HEAP (ArrayBuffers, Wasm, Native)]\n" + dash + "\n";
      out += row("  Allocated", `${cppAllocVal.toFixed(2)} MB`);
      out += row("  Used", `${cppUsedVal.toFixed(2)} MB`);
    }

    const uvSize = metrics.uv_threadpool_size?.values?.value;
    if (uvSize !== undefined) {
      out += "\n[LIBUV THREADPOOL]\n" + dash + "\n";
      out += row("  UV_THREADPOOL_SIZE", `${uvSize}`);
    }

    out += "\n[VERDICT]\n" + dash + "\n";
    const verdictHeapDelta = hasCooldown ? cooldownHeapMB - baselineHeapMB : heapDelta;
    const verdictRssDelta = hasCooldown ? cooldownRssMB - baselineRssMB : rssDelta;
    const verdictLabel = hasCooldown ? "after cooldown" : "at end of load";

    if (verdictHeapDelta > 10) {
      out += `  [!] V8 HEAP: Increased by ${verdictHeapDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Possible memory leak. Take heap snapshot for analysis.\n";
    } else if (verdictHeapDelta > 5) {
      out += `  [~] V8 HEAP: Increased by ${verdictHeapDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Minor increase - monitor over extended tests.\n";
    } else if (verdictHeapDelta < -1) {
      out += `  [OK] V8 HEAP: Returned below baseline (${formatDelta(verdictHeapDelta, " MB")}) ${verdictLabel}\n`;
    } else {
      out += `  [OK] V8 HEAP: Stable (within +/-5 MB of baseline) ${verdictLabel}\n`;
    }

    if (verdictRssDelta > 50) {
      out += `  [!] RSS: Physical memory increased by ${verdictRssDelta.toFixed(2)} MB ${verdictLabel}\n`;
      out += "      Check for external memory leaks (buffers, native addons).\n";
    } else if (verdictRssDelta > 20) {
      out += `  [~] RSS: Physical memory increased by ${verdictRssDelta.toFixed(2)} MB ${verdictLabel}\n`;
    } else {
      out += `  [OK] RSS: Physical memory stable ${verdictLabel}\n`;
    }

    const verdictHandleDelta = hasCooldown ? cooldownHandlesVal - baselineHandlesVal : handleDelta;
    if (verdictHandleDelta > 10) {
      out += `  [!] HANDLES: ${verdictHandleDelta} libuv handles not cleaned up ${verdictLabel}\n`;
      out += "      Check for unclosed connections, timers, or event listeners.\n";
    } else if (verdictHandleDelta > 0) {
      out += `  [i] HANDLES: ${verdictHandleDelta} additional handles (may be normal)\n`;
    } else {
      out += "  [OK] HANDLES: All handles cleaned up properly\n";
    }

    if (peakCpuVal > 80) {
      out += `  [!] CPU: Peak usage ${peakCpuVal.toFixed(1)}% - High CPU pressure\n`;
      out += "      Profile with Chrome DevTools or clinic.js flame.\n";
    } else if (peakCpuVal > 50) {
      out += `  [~] CPU: Peak usage ${peakCpuVal.toFixed(1)}% - Moderate load\n`;
    } else if (avgCpuVal > 0) {
      out += `  [OK] CPU: Average ${avgCpuVal.toFixed(1)}%, Peak ${peakCpuVal.toFixed(1)}%\n`;
    }

    if (gcCountVal !== undefined) {
      const gcMaxVal = metrics.gc_max_ms?.values?.value || 0;
      if (gcMaxVal > 100) {
        out += `  [!] GC: Max pause ${gcMaxVal.toFixed(1)}ms - Long GC pauses detected\n`;
        out += "      Consider reducing heap allocation rate or increasing heap size.\n";
      } else if (gcMaxVal > 50) {
        out += `  [~] GC: Max pause ${gcMaxVal.toFixed(1)}ms - Moderate GC pauses\n`;
      } else {
        out += `  [OK] GC: Max pause ${gcMaxVal.toFixed(1)}ms - No long pauses\n`;
      }
    }
  } else {
    out += "\n  Memory sampling was not enabled or returned no data.\n";
    out += "  Set memorySampling.enabled=true (and a procstats endpoint) in the config.\n";
  }

  out += "\n" + line + "\n";
  return out;
}

export function handleSummary(data) {
  const summaryPath = __ENV.SUMMARY_PATH;
  const summaryTxtPath = __ENV.SUMMARY_TXT_PATH;
  const report = buildReport(data);
  const text = textSummary(data, { indent: " ", enableColors: false });
  const out = { stdout: "" };
  if (summaryPath) out[summaryPath] = JSON.stringify(data, null, 2);
  if (summaryTxtPath) out[summaryTxtPath] = report + "\n" + text;
  return out;
}
