// A doctor opening a patient sees the exams of the other doctors of the same clinic (27.11.2026: "the
// therapist refers, but the endocrinologist sees no exam"), never another clinic's, and personal counters stay own.
// Run: node scripts/test-clinic-visits.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 31993;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-clinic-visits-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const post = (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const admin = cookieOf(await post("/api/login/admin", { username: "admin", password: "TestAdmin1234" }));
  const addDoctor = async (login, fullName, clinic, specialty) => {
    assert.equal((await post("/api/admin/doctors", { fullName, login, accessKey: "Doctor12345", passport: "T", clinic, specialty, experienceYears: 5 }, admin)).status, 201);
    return cookieOf(await post("/api/login/doctor", { login, accessKey: "Doctor12345" }));
  };
  const therapist = await addDoctor("ter11", "Терапевтова Зарина", "Поликлиника №11", "Терапевт");
  const endo = await addDoctor("endo11", "Эндокринов Фарход", "Поликлиника №11", "Эндокринолог");
  const other = await addDoctor("ter9", "Чужой Врач", "Поликлиника №9", "Терапевт");

  const created = await (await post("/api/nurse-surveys", { nurseName: "Сестрина Мария", lastName: "Направленов", firstName: "Тест", birthDate: "1960-01-01", sex: "male", phone: "+992900001111",
    address: "Душанбе", clinic: "Поликлиника №11", age: 66, height: 170, weight: 90, rabitoWaist: 100, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "yes",
    familyDiabetes: "first", smoker: "no", systolic: 150, diastolic: 95, glucoseLevel: 9 })).json();
  const surveyId = created.survey.id;
  const saved = await post("/api/doctor/visits", { surveyId, weight: 90, height: 170, glucose: 9, systolic: 150, diastolic: 95, diagnosis: "Сахарный диабет 2 типа",
    referrals: ["Эндокринолог"], diabetesDrugs: [], hypertensionDrugs: [], lifestyleRecommendations: [],
    laboratoryTests: [{ test: "HbA1c", status: "ordered" }] }, therapist);
  assert.equal(saved.status, 201);
  const visitId = (await saved.json()).visit.id;

  const workspace = async (cookie) => (await fetch(`${base}/api/doctor/workspace`, { headers: { Cookie: cookie } })).json();
  const endoWs = await workspace(endo);
  assert.equal(endoWs.visits.length, 0, "the endocrinologist's own counters stay empty");
  assert.equal(endoWs.clinicVisits.length, 1, "but the therapist's exam is in the patient's file");
  assert.equal(endoWs.clinicVisits[0].surveyId, surveyId);
  assert.deepEqual(endoWs.clinicVisits[0].referrals, ["Эндокринолог"]);
  assert.equal(endoWs.clinicVisits[0].doctorName, "Терапевтова Зарина");

  const therapistWs = await workspace(therapist);
  assert.equal(therapistWs.visits.length, 1);
  assert.equal(therapistWs.clinicVisits.length, 0, "own exams are not repeated");

  const otherWs = await workspace(other);
  assert.equal(otherWs.clinicVisits.length, 0, "another clinic sees nothing");

  // The endocrinologist can enter the lab result ordered by the therapist.
  const lab = await fetch(`${base}/api/doctor/lab-result`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: endo },
    body: JSON.stringify({ visitId, index: 0, result: "8,1%", resultDate: "2026-11-27" }) });
  assert.equal(lab.status, 200);
  const otherLab = await fetch(`${base}/api/doctor/lab-result`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: other },
    body: JSON.stringify({ visitId, index: 0, result: "1%", resultDate: "2026-11-27" }) });
  assert.equal(otherLab.status, 403);
  // The same exam sent twice (timeout, then the phone queue) is saved once.
  const exam = { surveyId, clientVisitId: "c0ffee00-1111-4222-8333-444455556666", weight: 90, height: 170, systolic: 140, diastolic: 90, diagnosis: "АГ 1 ст.",
    referrals: [], diabetesDrugs: [], hypertensionDrugs: [], lifestyleRecommendations: [], laboratoryTests: [] };
  assert.equal((await post("/api/doctor/visits", exam, endo)).status, 201);
  const again = await post("/api/doctor/visits", exam, endo);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).alreadySaved, true);
  assert.equal((await workspace(endo)).visits.length, 1, "one exam, not two");
  // The admin finds a nurse's patients by the nurse's name (Пациенты tab search).
  const found = await (await fetch(`${base}/api/admin/dashboard?tab=surveys&search=${encodeURIComponent("сестрина")}`, { headers: { Cookie: admin } })).json();
  assert.ok(JSON.stringify(found).includes("Направленов"), "search by nurse name finds her patient");
  // A head nurse searches the same way, by patient or nurse surname, only inside her clinic.
  assert.equal((await post("/api/admin/admins", { name: "Старшая Одиннадцатая", username: "head11", password: "HeadNurse12345", role: "head_nurse", clinic: "Поликлиника №11" }, admin)).status, 201);
  assert.equal((await post("/api/admin/admins", { name: "Старшая Девятая", username: "head9", password: "HeadNurse12345", role: "head_nurse", clinic: "Поликлиника №9" }, admin)).status, 201);
  const headSearch = async (login, query) => {
    const cookie = cookieOf(await post("/api/login/admin", { username: login, password: "HeadNurse12345" }));
    return JSON.stringify(await (await fetch(`${base}/api/admin/dashboard?tab=surveys&search=${encodeURIComponent(query)}`, { headers: { Cookie: cookie } })).json());
  };
  assert.ok((await headSearch("head11", "сестрина")).includes("Направленов"), "head nurse: by nurse surname");
  assert.ok((await headSearch("head11", "направленов")).includes("Направленов"), "head nurse: by patient surname");
  assert.ok(!(await headSearch("head9", "сестрина")).includes("Направленов"), "another clinic's head nurse finds nothing");
  console.log("Clinic visits test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
