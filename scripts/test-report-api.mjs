// Token-protected aggregate report API: closed without a token, counts right, no patient data.
// Run: node scripts/test-report-api.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "t".repeat(20) + "0123456789abcdef";
const start = async (port, env) => {
  const dataDir = await mkdtemp(join(tmpdir(), "eclinic-report-api-"));
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234", REPORT_API_TOKEN: "", ...env },
    stdio: "ignore"
  });
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { server, dataDir, base: `http://127.0.0.1:${port}` };
};
const report = (base, token, query = "") => fetch(`${base}/api/reports/aggregate${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

// 1. Without REPORT_API_TOKEN on the server the endpoint is closed for everyone.
const closed = await start(31978, {});
try {
  assert.equal((await report(closed.base, TOKEN)).status, 401);
  assert.equal((await report(closed.base, "")).status, 401);
} finally {
  closed.server.kill();
  await rm(closed.dataDir, { recursive: true, force: true });
}

// 2. With a token: wrong / missing token refused, right token gives counts only.
const open = await start(31977, { REPORT_API_TOKEN: TOKEN });
const post = (path, body, cookie) => fetch(open.base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
try {
  assert.equal((await report(open.base, "")).status, 401);
  assert.equal((await report(open.base, TOKEN + "x")).status, 401);
  assert.equal((await report(open.base, "short")).status, 401);

  const patient = (i, extra) => ({ nurseName: "Раҳимова Мехри", lastName: `Конфиденциалов${"абв"[i]}`, firstName: "Секрет", birthDate: "1961-07-07", sex: "male",
    phone: `+99290055${5000 + i}`, address: "Тайная улица", clinic: "Поликлиника №9", age: 65, height: 170, weight: 95, rabitoWaist: 105,
    activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "first", smoker: "yes", ...extra });
  const a = await (await post("/api/nurse-surveys", patient(0, { systolic: 150, diastolic: 95, glucoseLevel: 8 }))).json();
  await post("/api/nurse-surveys", patient(1, { systolic: 120, diastolic: 78, glucoseLevel: 5 }));
  await post("/api/nurse-surveys", patient(2, { systolic: 135, diastolic: 85, glucoseLevel: 6.5, clinic: "Поликлиника №11" }));

  const admin = (await post("/api/login/admin", { username: "admin", password: "TestAdmin1234" })).headers.get("set-cookie").split(";")[0];
  await post("/api/admin/doctors", { fullName: "Врач Девятый", login: "dr9", accessKey: "Doctor9999", passport: "T", clinic: "Поликлиника №9", specialty: "Терапевт", experienceYears: 3 }, admin);
  const doctor = (await post("/api/login/doctor", { login: "dr9", accessKey: "Doctor9999" })).headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/doctor/visits", { surveyId: a.survey.id, weight: 95, height: 170, glucose: 8, systolic: 150, diastolic: 95, diagnosis: "Сахарный диабет 2 типа, АГ 2 ст.",
    diabetesDrugs: ["Метформин 500 мг 1 раз в день"], hypertensionDrugs: [], referrals: [], lifestyleRecommendations: [], laboratoryTests: [] }, doctor)).status, 201);

  const response = await report(open.base, TOKEN);
  assert.equal(response.status, 200);
  const raw = await response.text();
  const data = JSON.parse(raw);
  assert.equal(data.screening.surveys, 3);
  assert.equal(data.screening.uniquePatients, 3);
  assert.equal(data.doctors.visits, 1);
  assert.equal(data.doctors.patientsWithDrugs, 1);
  assert.equal(data.detection.totals.glucose, 1, "sugar >= 7.0");
  assert.equal(data.detection.totals.glucoseImpaired, 1, "6.5 is prediabetes");
  assert.equal(data.detection.totals.bpHypertension, 1);
  assert.equal(data.detection.totals.bpHighNormal, 1, "135/85");
  assert.equal(data.detection.totals.dxDiabetes, 1);
  assert.equal(data.detection.totals.dxHypertension, 1);
  assert.deepEqual(data.byClinic.map((row) => [row.clinic, row.surveys]), [["Поликлиника №9", 2], ["Поликлиника №11", 1]]);
  assert.equal(data.nurses[0].name, "Раҳимова Мехри");
  assert.doesNotMatch(raw, /Конфиденциалов|Секрет|1961-07-07|99290055|Тайная/, "no patient names, birth dates, phones or addresses");

  const only11 = await (await report(open.base, TOKEN, `?clinic=${encodeURIComponent("Поликлиника №11")}`)).json();
  assert.equal(only11.screening.surveys, 1, "clinic filter");

  // 3. Server health for the assistant: same token, no patient data, failed logins counted.
  await post("/api/login/doctor", { login: "dr9", accessKey: "wrong-key-1" });
  assert.equal((await fetch(`${open.base}/api/reports/ops`)).status, 401, "ops needs the token too");
  const opsResponse = await fetch(`${open.base}/api/reports/ops`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(opsResponse.status, 200);
  const opsRaw = await opsResponse.text();
  const ops = JSON.parse(opsRaw);
  assert.equal(ops.database.ok, true);
  assert.ok(ops.uptimeSec >= 0 && ops.startedAt);
  assert.ok(ops.problems.securityEvents.login_failed >= 1, "failed logins are counted");
  assert.ok("backup" in ops && "load" in ops);
  assert.doesNotMatch(opsRaw, /Конфиденциалов|Секрет|1961-07-07|99290055|Тайная|Doctor9999|wrong-key/, "no patient data or keys");
  console.log("Report API test passed.");
} finally {
  open.server.kill();
  await rm(open.dataDir, { recursive: true, force: true });
}
