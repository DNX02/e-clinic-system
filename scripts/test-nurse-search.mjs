// "Поиск медсестры": spellings merged, partial and Tajik-letter search, history newest first, head nurse scope.
// Run: node scripts/test-nurse-search.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nurseHistory, searchNurses } from "../nurse-search.js";

const s = (id, nurse, clinic, at, extra = {}) => ({ id, nurse: { fullName: nurse }, patient: { lastName: `Пациент${id}`, firstName: "Тест", clinic, birthDate: "1960-01-01" }, createdAt: at, measurements: { systolic: 150, diastolic: 95 }, ...extra });
const surveys = [
  s("a", "Гулмаҳмадова Шодигул", "Поликлиника №11", "2026-11-20T05:00:00Z", { needsDoctor: true, referralReasons: ["АД ≥ 140/90"] }),
  s("b", "Гулмахмадова Шодигул Каримовна", "Поликлиника №11", "2026-11-21T05:00:00Z"),
  s("c", "Гулмахмадова шодигул", "Поликлиника №11", "2026-11-21T06:00:00Z"),
  s("d", "Махмадназар Фатона", "Поликлиника №14", "2026-11-27T05:00:00Z", { needsDoctor: true }),
  s("e", "Махмадназар Фатона", "Поликлиника №1", "2026-07-05T05:00:00Z"),
  s("x", "Гулмахмадова Шодигул", "Поликлиника №11", "2026-11-22T05:00:00Z", { archivedAt: "2026-11-23T00:00:00Z" })
];
const found = searchNurses(surveys, "гулмах");
assert.equal(found.length, 1, "three spellings are one nurse");
assert.equal(found[0].surveys, 3, "archived surveys are not counted");
assert.equal(found[0].needsDoctor, 1);
assert.equal(searchNurses(surveys, "ГУЛМАҲ")[0].key, found[0].key, "Tajik letters and case do not matter");
assert.equal(searchNurses(surveys, "фатона махмад").length, 1, "several words, any order");
assert.equal(searchNurses(surveys, "").length, 0);
const history = nurseHistory(surveys, found[0].key);
assert.deepEqual(history.rows.map((row) => row.id), ["c", "b", "a"], "newest first");
assert.equal(history.rows[2].needsDoctor, true);
assert.equal(history.rows[0].patientName, "Пациентc Тест");
const fatona = nurseHistory(surveys, searchNurses(surveys, "фатона")[0].key);
assert.deepEqual(fatona.clinics.map((item) => item.clinic).sort(), ["Поликлиника №1", "Поликлиника №14"]);
assert.equal(nurseHistory(surveys, "нет такой"), null);

// Through the admin API, with the head-nurse scope.
const port = 31994;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-nurse-search-"));
const server = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" }, stdio: "ignore" });
const post = (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const patient = (i, nurseName, clinic) => ({ nurseName, lastName: `Пациентов${"абвг"[i]}`, firstName: "Тест", birthDate: "1960-01-01", sex: "male", phone: `+99290012${3000 + i}`, address: "Душанбе", clinic,
    age: 66, height: 170, weight: 90, rabitoWaist: 100, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 150, diastolic: 95, glucoseLevel: 5 });
  assert.equal((await post("/api/nurse-surveys", patient(0, "Махмадназар Фатона", "Поликлиника №14"))).status, 201);
  assert.equal((await post("/api/nurse-surveys", patient(1, "Махмадназар фатона", "Поликлиника №1"))).status, 201);
  const owner = cookieOf(await post("/api/login/admin", { username: "admin", password: "TestAdmin1234" }));
  const tab = async (cookie, query) => (await (await fetch(`${base}/api/admin/dashboard?tab=nurseSearch&${query}`, { headers: { Cookie: cookie } })).json()).nurseSearch;
  const result = await tab(owner, "q=" + encodeURIComponent("махмадназар"));
  assert.equal(result.nurses.length, 1);
  assert.equal(result.nurses[0].surveys, 2);
  const withHistory = await tab(owner, `q=${encodeURIComponent("махмадназар")}&nurse=${encodeURIComponent(result.nurses[0].key)}`);
  assert.deepEqual(withHistory.history.rows.map((row) => row.patientName).sort(), ["Пациентова Тест", "Пациентовб Тест"]);

  assert.equal((await post("/api/admin/admins", { name: "Старшая", username: "head14", password: "HeadNurse12345", role: "head_nurse", clinic: "Поликлиника №14" }, owner)).status, 201);
  const head = cookieOf(await post("/api/login/admin", { username: "head14", password: "HeadNurse12345" }));
  const headResult = await tab(head, `q=${encodeURIComponent("махмадназар")}&nurse=${encodeURIComponent(result.nurses[0].key)}`);
  assert.equal(headResult.nurses[0].surveys, 1, "a head nurse sees only her clinic");
  assert.deepEqual(headResult.history.rows.map((row) => row.clinic), ["Поликлиника №14"]);
  assert.equal((await fetch(`${base}/api/admin/dashboard?tab=nurseSearch&q=a`)).status, 403, "login required");
  console.log("Nurse search test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
