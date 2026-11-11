// Integration test for the PostgreSQL write path (rollback safety, deletes).
// Needs a disposable database: TEST_DATABASE_URL=postgresql://... npm run test:pg
// It is skipped (exit 0) when TEST_DATABASE_URL is not set.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log("TEST_DATABASE_URL is not set; skipping PostgreSQL sync test.");
  process.exit(0);
}

const port = 31988;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-pg-test-"));
const adminPassword = "TestAdmin1234";
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
const tables = ["app_state", "app_meta", "app_settings", "app_sessions", "app_admins", "app_doctors", "app_nurse_surveys", "app_doctor_visits", "app_training_participants", "app_training_attempts", "app_nurse_training_participants", "app_nurse_training_attempts", "app_patient_tasks", "app_appointments", "app_reminder_queue", "app_message_events", "app_activity_events"];
for (const table of tables) await pool.query(`drop table if exists ${table} cascade`);
await pool.query("drop function if exists test_block_writes() cascade");

let server;
let serverOutput = "";
const startServer = async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, INITIAL_ADMIN_PASSWORD: adminPassword, DATABASE_URL: databaseUrl, PGSSLMODE: "disable" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (c) => { serverOutput += c; });
  server.stderr.on("data", (c) => { serverOutput += c; });
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${serverOutput}`);
};
const stopServer = () => new Promise((resolve) => {
  if (!server || server.exitCode !== null) return resolve();
  server.once("exit", resolve);
  server.kill("SIGTERM");
});

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const patient = (lastName) => ({
  lastName, firstName: "Пациент", middleName: "Первый", birthDate: "1980-01-01", phone: "+992900001122", address: "Тестовый адрес",
  clinic: "Поликлиника №1", nurseName: "Тестовая Медсестра", sex: "male", age: 46, height: 180, weight: 81, bmi: 25, systolic: 120, diastolic: 80,
  rabitoWaist: 90, activity: "yes", vegetables: "yes", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no"
});
const savedIds = async () => (await pool.query("select id from app_nurse_surveys")).rows.map((r) => r.id);

try {
  await startServer();

  // 1. Normal write reaches the normalized table.
  const firstId = randomUUID();
  const first = await post("/api/nurse-surveys", { ...patient("Первый"), clientSurveyId: firstId });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.ok((await savedIds()).includes(firstId), "survey must be stored in PostgreSQL");

  // 2. A failed commit must not mark rows as synced: the survey must reach the table on the next write.
  await pool.query(`create function test_block_writes() returns trigger language plpgsql as $$ begin raise exception 'blocked by test'; end $$`);
  await pool.query("create trigger test_block before insert on app_nurse_surveys for each row execute function test_block_writes()");
  const lostId = randomUUID();
  const blocked = await post("/api/nurse-surveys", { ...patient("Потерянный"), phone: "+992900003344", clientSurveyId: lostId });
  assert.equal(blocked.status, 500, "write must fail while the table rejects inserts");
  assert.ok(!(await savedIds()).includes(lostId));
  await pool.query("drop trigger test_block on app_nurse_surveys");

  const retry = await post("/api/nurse-surveys", { ...patient("Потерянный"), phone: "+992900003344", clientSurveyId: lostId });
  assert.ok([200, 201].includes(retry.status), JSON.stringify(retry.body));
  assert.ok((await savedIds()).includes(lostId), "survey must be stored after the retry even though memory already had it");

  // 3. Rows are deleted from PostgreSQL when removed in memory, even if another row is added in the same write.
  const admin = { cookie: "" };
  const loginRes = await fetch(`${baseUrl}/api/login/admin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: adminPassword }) });
  admin.cookie = loginRes.headers.get("set-cookie").split(";", 1)[0];
  assert.equal(loginRes.status, 200);
  const sessionsBefore = (await pool.query("select count(*)::int as n from app_sessions")).rows[0].n;
  assert.equal(sessionsBefore, 1);
  const logout = await fetch(`${baseUrl}/api/logout`, { method: "POST", headers: { Cookie: admin.cookie } });
  assert.ok(logout.status < 400, `logout ${logout.status}`);
  assert.equal((await pool.query("select count(*)::int as n from app_sessions")).rows[0].n, 0, "session row must be deleted from PostgreSQL");

  // 4. Data survives a restart (read back from normalized tables).
  await stopServer();
  await startServer();
  const afterRestart = await post("/api/nurse-surveys", { ...patient("Первый"), clientSurveyId: firstId });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.body.alreadySaved, true);
  const lostAfterRestart = await post("/api/nurse-surveys", { ...patient("Потерянный"), phone: "+992900003344", clientSurveyId: lostId });
  assert.equal(lostAfterRestart.body.alreadySaved, true);

  // 5. Graceful shutdown writes the legacy snapshot.
  await stopServer();
  const snapshot = await pool.query("select data from app_state where id = 'main'");
  assert.equal(snapshot.rowCount, 1);
  assert.equal(snapshot.rows[0].data.nurseSurveys.length, 2);

  console.log("PostgreSQL sync integration test passed.");
} catch (error) {
  console.error(serverOutput.split("\n").slice(-15).join("\n"));
  throw error;
} finally {
  await stopServer();
  await pool.end();
  await rm(dataDir, { recursive: true, force: true });
}
