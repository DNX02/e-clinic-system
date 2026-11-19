// Diabetes / hypertension detection report: diagnosis text, thresholds, distinct patients, PDF, scope.
// Run: node scripts/test-detection-report.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDetectionReport, diagnosisFlags } from "../detection-report.js";

// 1. Diagnoses as doctors write them, Russian and Tajik.
assert.deepEqual(diagnosisFlags("Сахарный диабет 2 типа"), { diabetes: true, prediabetes: false, hypertension: false });
assert.deepEqual(diagnosisFlags("Диабети қанд навъи 2, фишорбаландии артериалӣ"), { diabetes: true, prediabetes: false, hypertension: true });
assert.deepEqual(diagnosisFlags("Предиабет, АГ 1 ст."), { diabetes: false, prediabetes: true, hypertension: true });
assert.deepEqual(diagnosisFlags("Пешдиабет"), { diabetes: false, prediabetes: true, hypertension: false });
assert.deepEqual(diagnosisFlags("СД2, ожирение"), { diabetes: true, prediabetes: false, hypertension: false });
assert.deepEqual(diagnosisFlags("Багаж в норме"), { diabetes: false, prediabetes: false, hypertension: false }, "'аг' inside a word is not hypertension");

// 2. Counting: thresholds of the rules, distinct patients, period by exam date, archived excluded.
const at = (day) => `${day}T06:00:00.000Z`;
const s = (id, clinic, day, m, findrisc = 5) => ({ id, patient: { clinic }, createdAt: at(day), measurements: m, findrisc: { score: findrisc } });
const surveys = [
  s("a", "Поликлиника №9", "2026-11-02", { glucoseLevel: 6.1, systolic: 120, diastolic: 80 }),
  s("b", "Поликлиника №9", "2026-11-03", { glucoseLevel: 5.0, systolic: 130, diastolic: 90 }, 14),
  s("c", "Поликлиника №9", "2026-11-04", { glucoseLevel: 12, systolic: 150, diastolic: 95 }),
  s("d", "Поликлиника №11", "2026-11-05", { glucoseLevel: 5.5, systolic: 139, diastolic: 89 }, 13),
  { ...s("x", "Поликлиника №9", "2026-11-05", { glucoseLevel: 20, systolic: 200, diastolic: 120 }), archivedAt: at("2026-11-06") }
];
const visits = [
  { surveyId: "a", createdAt: at("2026-11-10"), diagnosis: "Предиабет", diabetesDrugs: [] },
  { surveyId: "a", createdAt: at("2026-11-12"), diagnosis: "Сахарный диабет 2 типа", diabetesDrugs: ["Метформин 500 мг"] },
  { surveyId: "c", createdAt: at("2026-11-11"), diagnosis: "Артериальная гипертензия", hypertensionDrugs: ["Амлодипин 5 мг"] },
  { surveyId: "c", createdAt: at("2026-11-13"), diagnosis: "АГ 2 ст.", hypertensionDrugs: ["Амлодипин 5 мг"] },
  { surveyId: "x", createdAt: at("2026-11-11"), diagnosis: "Сахарный диабет 2 типа" }
];
const clinicKey = (value) => String(value || "").match(/\d+/)?.[0] || "";
const all = buildDetectionReport(surveys, visits, { clinicKey });
assert.equal(all.totals.screened, 4, "archived surveys are not counted");
assert.equal(all.totals.glucose, 2, "sugar ≥ 6.1 (a, c)");
assert.equal(all.totals.glucoseHigh, 1);
assert.equal(all.totals.findrisc, 1, "FINDRISC ≥ 14 (b), 13 is not");
assert.equal(all.totals.pressure, 2, "≥140 or diastolic ≥90 (b, c); 139/89 is not");
assert.equal(all.totals.both, 2, "b (FINDRISC + DBP 90) and c (sugar + BP)");
assert.equal(all.totals.dxDiabetes, 1, "patient a once, although two exams");
assert.equal(all.totals.dxPrediabetes, 0, "prediabetes later turned into diabetes counts as diabetes");
assert.equal(all.totals.dxHypertension, 1, "patient c once, although two exams");
assert.equal(all.totals.diabetesDrugs, 1);
assert.equal(all.totals.hypertensionDrugs, 1);
const nov11 = buildDetectionReport(surveys, visits, { clinic: "Поликлиника №9", from: "2026-11-11", to: "2026-11-11", clinicKey });
assert.equal(nov11.totals.screened, 0, "no surveys on the 11th");
assert.equal(nov11.totals.dxHypertension, 1, "diagnoses are dated by the exam");
assert.equal(nov11.totals.dxDiabetes, 0);

// 3. Admin PDF download and head-nurse scope.
const port = 31982;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-detection-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const post = async (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const owner = cookieOf(await post("/api/login/admin", { username: "admin", password: "TestAdmin1234" }));
  const patient = (i, clinic, systolic) => ({ nurseName: "Сестрина Мария", lastName: `Пациентов${"абв"[i]}`, firstName: "Тест", birthDate: "1960-01-01", sex: "male", phone: `+99290000${7000 + i}`, address: "Душанбе", clinic,
    age: 66, height: 170, weight: 90, rabitoWaist: 100, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic, diastolic: 85, glucoseLevel: 7 });
  assert.equal((await post("/api/nurse-surveys", patient(0, "Поликлиника №9", 150))).status, 201);
  assert.equal((await post("/api/nurse-surveys", patient(1, "Поликлиника №11", 120))).status, 201);

  const tab = await (await fetch(`${base}/api/admin/dashboard?tab=detection`, { headers: { Cookie: owner } })).json();
  assert.equal(tab.detectionReport.totals.screened, 2);
  assert.equal(tab.detectionReport.totals.pressure, 1);
  assert.equal(tab.detectionReport.totals.glucose, 2);

  const pdf = await fetch(`${base}/api/admin/detection-report.pdf?clinic=${encodeURIComponent("Поликлиника №9")}`, { headers: { Cookie: owner } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /vyyavlenie-sd-ag-gcz-9_nachalo_segodnya\.pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await fetch(`${base}/api/admin/detection-report.pdf`)).status, 403, "login required");

  assert.equal((await post("/api/admin/admins", { name: "Старшая Сестра", username: "head11", password: "HeadNurse12345", role: "head_nurse", clinic: "Поликлиника №11" }, owner)).status, 201);
  const head = cookieOf(await post("/api/login/admin", { username: "head11", password: "HeadNurse12345" }));
  const headTab = await (await fetch(`${base}/api/admin/dashboard?tab=detection&clinic=${encodeURIComponent("Поликлиника №9")}`, { headers: { Cookie: head } })).json();
  assert.equal(headTab.detectionReport.totals.screened, 0, "a head nurse cannot see another clinic");
  console.log("Detection report test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
