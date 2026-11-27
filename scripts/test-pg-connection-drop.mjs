// The database drops the server's idle connections (restart, network, maintenance): the service must stay up
// and the next request must work (crash 27.11.2026: "Main process exited" after an idle client error).
// Needs a disposable database: TEST_DATABASE_URL=postgresql://... PGSSLMODE=disable node scripts/test-pg-connection-drop.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("PG connection drop test skipped (no TEST_DATABASE_URL).");
  process.exit(0);
}
const port = 31991;
const base = `http://127.0.0.1:${port}`;
const token = "d".repeat(40);
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-pgdrop-"));
let exited = null;
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: url, INITIAL_ADMIN_PASSWORD: "TestAdmin1234", REPORT_API_TOKEN: token },
  stdio: ["ignore", "ignore", "pipe"]
});
server.on("exit", (code) => { exited = code; });
const admin = new pg.Client({ connectionString: url });
try {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Open several pooled connections, then let them sit idle.
  await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}/api/health`)));
  await admin.connect();
  const killed = await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()");
  assert.ok(killed.rowCount >= 1, "the server had idle connections to drop");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(exited, null, "the service must not exit when the database drops idle connections");
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.database.ok, true, "the next request reconnects");
  const ops = await (await fetch(`${base}/api/reports/ops`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.ok(ops.problems.byKind.database_connection_lost >= 1, "the drop is visible to the assistant");
  console.log("PG connection drop test passed.");
} finally {
  await admin.end().catch(() => {});
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
