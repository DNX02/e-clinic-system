// Runtime self-diagnostics: a per-minute load history and the list of slow requests.
// Answers "what made the site hang at 19:55?" from outside, without SSH:
//   - loopMaxMs high + processCpuPercent high  -> our own code was busy (see slowRequests / routes)
//   - systemLoad1 high, processCpuPercent low  -> another program on the server
//   - freeMemMb near zero                      -> the server is out of memory
//   - dbWriteMaxMs high                        -> the database was slow
// Never stores patient data: routes are reduced to their shape (ids replaced by ":id"), no query strings.
import { monitorEventLoopDelay } from "node:perf_hooks";
import { cpus, freemem, loadavg, totalmem } from "node:os";

const HISTORY_MINUTES = 60;
const MAX_SLOW_REQUESTS = 100;
const slowEnv = process.env.SLOW_REQUEST_MS;
export const SLOW_REQUEST_MS = slowEnv !== undefined && slowEnv !== "" && Number.isFinite(Number(slowEnv)) ? Number(slowEnv) : 2000;
export const BLOCKED_LOOP_MS = 1000;

const startedAt = Date.now();
const minutes = [];
const slowRequests = [];
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
let current = emptyMinute();
let lastCpu = process.cpuUsage();
let lastTick = performance.now();
let timer = null;

function emptyMinute() {
  return { requests: 0, slowRequests: 0, aborted: 0, errors5xx: 0, dbWrites: 0, dbWriteMaxMs: 0 };
}

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

export function routeName(url) {
  const path = String(url || "/").split("?", 1)[0] || "/";
  return path
    .split("/")
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || /^\d+$/.test(part) || /^local-/.test(part) ? ":id" : part))
    .join("/")
    .slice(0, 120);
}

export function startRuntimeMonitor() {
  if (timer) return;
  loopDelay.enable();
  timer = setInterval(closeMinute, 60 * 1000);
  timer.unref();
}

function closeMinute() {
  const now = performance.now();
  const elapsedMs = Math.max(1, now - lastTick);
  lastTick = now;
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  const memory = process.memoryUsage();
  const entry = {
    at: new Date().toISOString(),
    loopMaxMs: Math.round(loopDelay.max / 1e6),
    loopP99Ms: Math.round(loopDelay.percentile(99) / 1e6),
    // Percent of one CPU core used by this Node process during the minute.
    processCpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
    systemLoad1: Number(loadavg()[0].toFixed(2)),
    freeMemMb: mb(freemem()),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    ...current
  };
  loopDelay.reset();
  current = emptyMinute();
  minutes.push(entry);
  if (minutes.length > HISTORY_MINUTES) minutes.splice(0, minutes.length - HISTORY_MINUTES);
  if (entry.loopMaxMs >= BLOCKED_LOOP_MS || entry.slowRequests || entry.dbWriteMaxMs >= SLOW_REQUEST_MS) {
    console.warn(JSON.stringify({ timestamp: entry.at, level: "warning", category: "performance", event: "runtime_minute", ...entry }));
  }
  return entry;
}

export function trackRequest(req, res, startedAtMs = Date.now()) {
  current.requests += 1;
  res.once("close", () => {
    const durationMs = Date.now() - startedAtMs;
    const aborted = !res.writableFinished;
    if (aborted) current.aborted += 1;
    if (res.statusCode >= 500) current.errors5xx += 1;
    if (durationMs < SLOW_REQUEST_MS) return;
    current.slowRequests += 1;
    const item = {
      at: new Date().toISOString(),
      method: req.method || "GET",
      route: routeName(req.url),
      statusCode: aborted ? 0 : res.statusCode,
      durationMs,
      aborted
    };
    slowRequests.push(item);
    if (slowRequests.length > MAX_SLOW_REQUESTS) slowRequests.splice(0, slowRequests.length - MAX_SLOW_REQUESTS);
    console.warn(JSON.stringify({ timestamp: item.at, level: "warning", category: "performance", event: "slow_request", requestId: req.requestId || "", ...item }));
  });
}

export function recordDbWrite(durationMs) {
  current.dbWrites += 1;
  current.dbWriteMaxMs = Math.max(current.dbWriteMaxMs, Math.round(durationMs));
}

export function runtimeSnapshot() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recentSlow = slowRequests.filter((item) => Date.parse(item.at) >= hourAgo);
  const memory = process.memoryUsage();
  const load = loadavg();
  return {
    ok: true,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    cpuCount: cpus().length,
    totalMemMb: mb(totalmem()),
    now: {
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      freeMemMb: mb(freemem()),
      systemLoad: load.map((value) => Number(value.toFixed(2))),
      loopMaxMsThisMinute: Math.round(loopDelay.max / 1e6)
    },
    thresholds: { slowRequestMs: SLOW_REQUEST_MS, blockedLoopMs: BLOCKED_LOOP_MS },
    lastHour: {
      maxLoopMs: Math.max(0, ...minutes.map((item) => item.loopMaxMs)),
      maxProcessCpuPercent: Math.max(0, ...minutes.map((item) => item.processCpuPercent)),
      maxSystemLoad1: Math.max(0, ...minutes.map((item) => item.systemLoad1)),
      minFreeMemMb: minutes.length ? Math.min(...minutes.map((item) => item.freeMemMb)) : mb(freemem()),
      maxDbWriteMs: Math.max(0, ...minutes.map((item) => item.dbWriteMaxMs)),
      requests: minutes.reduce((sum, item) => sum + item.requests, 0),
      slowRequests: recentSlow.length
    },
    minutes,
    slowRequests: recentSlow.slice(-50)
  };
}

// For tests: close the current minute immediately instead of waiting 60 s.
export function closeMinuteForTest() {
  return closeMinute();
}
