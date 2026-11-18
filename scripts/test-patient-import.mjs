// Patient CSV import: no silent defaults, readable answers, every problem of a row reported.
// Run: node scripts/test-patient-import.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeImportRow } from "../patient-import.js";

const good = {
  lastName: "Каримов", firstName: "Алишер", birthDate: "05.11.1964", sex: "м", phone: "+992900111222", address: "Душанбе",
  clinic: "поликлиника 11", nurseName: "Раҳимова Мехри", height: "170", weight: "86", rabitoWaist: "98",
  activity: "нет", vegetables: "+", bpMeds: "ҳа", highGlucose: "-", familyDiabetes: "1 линия", smoker: "Нет", systolic: "140", diastolic: "90", glucoseLevel: "6,2"
};

// 1. Common spellings are understood and normalised.
const row = normalizeImportRow(good, { today: new Date("2026-11-18T00:00:00Z") });
assert.equal(row.birthDate, "1964-11-05", "dd.mm.yyyy from Excel");
assert.equal(row.age, 62, "age from the birth date when the column is missing");
assert.equal(row.sex, "male");
assert.equal(row.clinic, "Поликлиника №11");
assert.deepEqual([row.activity, row.vegetables, row.bpMeds, row.highGlucose, row.smoker], ["no", "yes", "yes", "no", "no"]);
assert.equal(row.familyDiabetes, "first");
assert.equal(row.glucoseLevel, "6.2");

// 2. Nothing is filled in silently; all problems of the row come in one message.
const broken = { ...good, sex: "", smoker: "", activity: "иногда", clinic: "Поликлиника №3", nurseName: "Импорт", familyDiabetes: "" };
assert.throws(() => normalizeImportRow(broken), (error) => {
  for (const part of ["Пол: не указан", "Курение: не указано", "Физическая активность: «иногда» не понято", "Поликлиника: «Поликлиника №3» нет в системе", "Медсестра", "Диабет у родственников: не указано"]) {
    assert.ok(error.message.includes(part), `missing "${part}" in: ${error.message}`);
  }
  assert.equal(error.statusCode, 400);
  return true;
});

// 3. End to end through the admin API.
const port = 31983;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-import-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const login = await fetch(`${base}/api/login/admin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "TestAdmin1234" }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const send = async (rows) => (await fetch(`${base}/api/admin/patients/import`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ rows }) })).json();
  const result = await send([good, broken, { ...good, lastName: "Сафарова", sex: "ж", phone: "+992900333444" }]);
  assert.equal(result.imported.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 3, "row numbers count the header line");
  assert.match(result.errors[0].error, /Курение: не указано/);
  const again = await send([good]);
  assert.equal(again.skipped.length, 1, "re-uploading the same file skips already imported patients");
  const login2 = await fetch(`${base}/api/admin/dashboard?tab=surveys`, { headers: { Cookie: cookie } });
  const surveys = (await login2.json()).surveys;
  const karimov = surveys.find((item) => item.patient.lastName === "Каримов");
  assert.equal(karimov.patient.clinic, "Поликлиника №11");
  assert.equal(karimov.patient.sex, "male");
  console.log("Patient import test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
