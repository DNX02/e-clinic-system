// Tests the runtime self-diagnostics (/api/health/details): slow requests, hang detection, no patient data.
// Run: node scripts/test-runtime-monitor.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeMinuteForTest, routeName, startRuntimeMonitor } from "../runtime-monitor.js";

// 1. Routes keep their shape but lose ids and query strings.
assert.equal(routeName("/api/doctor/patients/3fa85f64-5717-4562-b3fc-2c963f66afa6/report.pdf?name=Иванов"), "/api/doctor/patients/:id/report.pdf");
assert.equal(routeName("/api/admin/patients/12345"), "/api/admin/patients/:id");
assert.equal(routeName("/api/admin/dashboard?tab=control&search=Рахимов"), "/api/admin/dashboard");

// 2. A blocked event loop is visible in the minute summary.
startRuntimeMonitor();
await new Promise((resolve) => setTimeout(resolve, 50));
const busyUntil = Date.now() + 400;
while (Date.now() < busyUntil) { /* simulate a heavy synchronous job */ }
await new Promise((resolve) => setTimeout(resolve, 50));
const minute = closeMinuteForTest();
assert.ok(minute.loopMaxMs >= 300, `loopMaxMs should show the 400 ms block, got ${minute.loopMaxMs}`);
assert.ok(minute.processCpuPercent > 0, "processCpuPercent must be measured");
for (const key of ["systemLoad1", "freeMemMb", "rssMb", "requests", "dbWriteMaxMs"]) assert.ok(key in minute, `missing ${key}`);

// 3. The live endpoint lists slow requests without patient data.
const port = 31998;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-runtime-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234", SLOW_REQUEST_MS: "0" },
  stdio: "ignore"
});
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fetch(`${base}/api/doctor/patients/3fa85f64-5717-4562-b3fc-2c963f66afa6/report.pdf?name=Иванов`);
  await fetch(`${base}/api/admin/dashboard?tab=surveys&search=Рахимов`);
  const response = await fetch(`${base}/api/health/details`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.text();
  const details = JSON.parse(raw);
  assert.equal(details.ok, true);
  assert.ok(details.uptimeSec >= 0 && details.cpuCount > 0 && details.totalMemMb > 0);
  for (const key of ["maxLoopMs", "maxProcessCpuPercent", "maxSystemLoad1", "minFreeMemMb", "maxDbWriteMs", "requests", "slowRequests"]) {
    assert.ok(key in details.lastHour, `lastHour.${key} missing`);
  }
  const routes = details.slowRequests.map((item) => item.route);
  assert.ok(routes.includes("/api/doctor/patients/:id/report.pdf"), `routes: ${routes}`);
  assert.ok(routes.includes("/api/admin/dashboard"), `routes: ${routes}`);
  assert.doesNotMatch(raw, /Иванов|Рахимов|3fa85f64|search=|name=/, "no patient data, ids or query strings");
  console.log("Runtime monitor test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
