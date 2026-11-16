// Nurse activity report: spelling merge, clinic/period filters, admin tab, Excel, head-nurse scope.
// Run: node scripts/test-nurse-report.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDED_BY_DOCTOR, buildNurseReport, dushanbeDate, nurseNameKey } from "../nurse-report.js";

// 1. Spellings seen in real surveys collapse to one key.
assert.equal(nurseNameKey("Гулмаҳмадова Шодигул"), nurseNameKey("Гулмахмадова  шодигул"));
assert.equal(nurseNameKey("Кодирова Озода бегмуродовна"), nurseNameKey("Кодирова Озода"));
assert.equal(nurseNameKey("Сафарова Миҷгона"), nurseNameKey("Сафарова Мичгона Хайридиновна"));
assert.notEqual(nurseNameKey("Мирзоева Парвина"), nurseNameKey("Мирзова Парвина"), "typos are not guessed");
assert.equal(dushanbeDate("2026-11-18T20:30:00Z"), "2026-11-19", "dates are counted in Dushanbe time");

const at = (day, hour = 9) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour - 5) * 3600000).toISOString();
const survey = (nurse, clinic, day, extra = {}) => ({ nurse: { fullName: nurse }, patient: { clinic }, createdAt: at(day), needsDoctor: false, ...extra });
const surveys = [
  survey("Гулмаҳмадова Шодигул", "Поликлиника №11", "2026-11-03", { needsDoctor: true }),
  survey("Гулмахмадова Шодигул", "Поликлиника №11", "2026-11-03"),
  survey("Гулмахмадова Шодигул", "Поликлиника №11", "2026-11-10"),
  survey("Увайтова Гулчехра", "Поликлиника №11", "2026-11-05"),
  survey("Увайтова Г", "Поликлиника №11", "2026-11-06"),
  survey("Кодирова Озода", "Поликлиника №11", "2026-11-19"),
  survey("Шарипова Сайёҳат", "Поликлиника №12", "2026-11-04"),
  survey("Шарипова Сайехат", "Поликлиника №12", "2026-11-04"),
  survey("", "Поликлиника №11", "2026-11-07", { createdByDoctorId: "d1" }),
  survey("Удалённая Анкета", "Поликлиника №11", "2026-11-07", { archivedAt: "2026-11-08T00:00:00Z" })
];
const clinicKey = (value) => String(value || "").replace(/\D/g, "");
const all = buildNurseReport(surveys, { clinicKey });
assert.equal(all.totals.surveys, 9, "archived surveys are not counted");
assert.deepEqual(all.clinics, ["Поликлиника №11", "Поликлиника №12"]);
const gul = all.rows.find((row) => row.name.startsWith("Гулма"));
assert.equal(gul.surveys, 3);
assert.equal(gul.name, "Гулмахмадова Шодигул", "the most frequent spelling is shown");
assert.deepEqual(gul.variants.map((item) => item.count), [2, 1]);
assert.equal(gul.needsDoctor, 1);
assert.equal(gul.activeDays, 2);
assert.equal(gul.firstDate, "2026-11-03");
assert.equal(gul.lastDate, "2026-11-10");
assert.equal(all.rows.find((row) => row.name.startsWith("Увайтова")).surveys, 2, "an initial merges into the only matching full name");
assert.equal(all.rows.find((row) => row.name.startsWith("Шарипова")).surveys, 2);
assert.equal(all.rows.at(-1).name, ADDED_BY_DOCTOR, "rows without a nurse name go last");
assert.equal(all.totals.nurses, 4);

const gcz11 = buildNurseReport(surveys, { clinic: "Поликлиника №11", from: "2026-11-04", to: "2026-11-18", clinicKey });
assert.equal(gcz11.totals.surveys, 4, "clinic and period filters (Увайтова x2, Гулмахмадова 10th, doctor)");
assert.ok(!gcz11.rows.some((row) => row.name.startsWith("Кодирова")), "the 19th is outside the period");
assert.ok(!gcz11.rows.some((row) => row.clinic === "Поликлиника №12"));
assert.equal(gcz11.byDay.reduce((sum, row) => sum + row.surveys, 0), 4);

// 2. Admin tab, Excel download and head-nurse scope on a live server.
const port = 31989;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-nurse-report-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const api = async (path, { method = "POST", body, cookie } = {}) => {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, text, headers: response.headers, cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
};
const patient = (i, nurseName, clinic) => ({
  nurseName, lastName: `Пациентов${i}`, firstName: "Тест", birthDate: "1970-01-01", sex: "male", phone: `+9929000010${10 + i}`, address: "Душанбе", clinic,
  age: 56, height: 170, weight: 80, rabitoWaist: 90, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 120, diastolic: 80
});
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const owner = await api("/api/login/admin", { body: { username: "admin", password: "TestAdmin1234" } });
  for (const [i, [nurse, clinic]] of [["Гулмаҳмадова Шодигул", "Поликлиника №11"], ["Гулмахмадова Шодигул", "Поликлиника №11"], ["Шарипова Сайёҳат", "Поликлиника №12"]].entries()) {
    assert.equal((await api("/api/nurse-surveys", { body: patient(i, nurse, clinic) })).status, 201);
  }
  const tab = await api(`/api/admin/dashboard?tab=nurses&clinic=${encodeURIComponent("Поликлиника №11")}`, { method: "GET", cookie: owner.cookie });
  assert.equal(tab.status, 200);
  assert.equal(tab.data.nurseReport.totals.surveys, 2);
  assert.equal(tab.data.nurseReport.rows[0].surveys, 2, "both spellings in one row");
  assert.equal(tab.data.nurseReport.clinics.length, 2);

  const xls = await api(`/api/admin/nurse-report.xls?clinic=${encodeURIComponent("Поликлиника №11")}&from=2000-01-01`, { method: "GET", cookie: owner.cookie });
  assert.equal(xls.status, 200);
  assert.match(xls.headers.get("content-disposition"), /nurses-gcz-11_2000-01-01_segodnya\.xls/);
  assert.match(xls.text, /Шодигул/);
  assert.match(xls.text, /ИТОГО/);
  assert.doesNotMatch(xls.text, /Шарипова/, "other clinics are not in the file");
  assert.equal((await api("/api/admin/nurse-report.xls", { method: "GET" })).status, 403, "login required");
  const pdf = await fetch(`${base}/api/admin/nurse-report.pdf?clinic=${encodeURIComponent("Поликлиника №11")}`, { headers: { Cookie: owner.cookie } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /nurses-gcz-11_nachalo_segodnya\.pdf/);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdfBytes.includes("DejaVuSans"), "the bundled font is embedded, so Tajik letters print");
  assert.equal((await api("/api/admin/nurse-report.pdf", { method: "GET" })).status, 403, "PDF needs login too");

  assert.equal((await api("/api/admin/admins", { cookie: owner.cookie, body: { name: "Старшая Сестра", username: "head12", password: "HeadNurse12345", role: "head_nurse", clinic: "Поликлиника №12" } })).status, 201);
  const head = await api("/api/login/admin", { body: { username: "head12", password: "HeadNurse12345" } });
  const headTab = await api("/api/admin/dashboard?tab=nurses", { method: "GET", cookie: head.cookie });
  assert.equal(headTab.data.nurseReport.totals.surveys, 1, "a head nurse sees only her clinic");
  const headXls = await api(`/api/admin/nurse-report.xls?clinic=${encodeURIComponent("Поликлиника №11")}`, { method: "GET", cookie: head.cookie });
  assert.doesNotMatch(headXls.text, /Шодигул/, "even when she asks for another clinic");
  console.log("Nurse report test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
