import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 31987;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-product-test-"));
const adminPassword = "TestAdmin1234";
const doctorPassword = "DoctorTest1234";
const doctorNewPassword = "DoctorNew5678";
const adminNewPassword = "AdminNew5678";
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, INITIAL_ADMIN_PASSWORD: adminPassword, DATABASE_URL: "" },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Test server did not start: ${serverOutput}`);
};

const session = () => ({ cookie: "" });
const request = async (jar, path, { method = "GET", body, expected = 200 } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) jar.cookie = setCookie.split(";", 1)[0];
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
};

try {
  await waitForServer();
  const admin = session();
  await request(admin, "/api/login/admin", { method: "POST", body: { username: "admin", password: adminPassword } });
  const createdDoctor = await request(admin, "/api/admin/doctors", {
    method: "POST",
    expected: 201,
    body: { fullName: "Тестовый Врач", login: "test-doctor", accessKey: doctorPassword, passport: "TEST", clinic: "Поликлиника №1", specialty: "Терапевт", experienceYears: 5 }
  });
  assert.equal(createdDoctor.doctor.login, "test-doctor");

  const doctor = session();
  await request(doctor, "/api/login/doctor", { method: "POST", body: { login: "test-doctor", accessKey: doctorPassword } });
  const patient = {
    lastName: "Тестов", firstName: "Пациент", middleName: "Первый", birthDate: "1980-01-01", phone: "+992900001122", address: "Тестовый адрес",
    sex: "male", age: 46, height: 175, bmi: 25, systolic: 135, diastolic: 85, arm: 30, rabitoWaist: 90, calf: 35, glucoseLevel: 5.5,
    activity: "yes", vegetables: "yes", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no"
  };
  const createdSurvey = await request(doctor, "/api/doctor/surveys", { method: "POST", expected: 201, body: patient });
  await request(doctor, "/api/doctor/surveys", { method: "POST", expected: 409, body: patient });
  await request(doctor, "/api/doctor/surveys", { method: "POST", expected: 400, body: { ...patient, birthDate: "1981-01-01", systolic: 80, diastolic: 100 } });

  const visit = await request(doctor, "/api/doctor/visits", {
    method: "POST", expected: 201,
    body: { surveyId: createdSurvey.survey.id, weight: 77, height: 175, bmi: 25.1, glucose: 5.8, glucoseType: "fasting", diagnosis: "Профилактическое наблюдение", systolic: 132, diastolic: 82, followUpDays: 7, laboratoryTests: [], referrals: [], treatmentPlan: "Контроль", diabetesDrugs: [], hypertensionDrugs: [], lifestyleRecommendations: [] }
  });
  assert.equal(visit.task.status, "open");
  const manualTask = await request(doctor, "/api/doctor/tasks", { method: "POST", expected: 201, body: { surveyId: createdSurvey.survey.id, title: "Контрольный звонок", dueDate: "2030-01-01" } });
  await request(doctor, `/api/doctor/tasks/${manualTask.task.id}`, { method: "PUT", body: { status: "completed" } });
  const workspace = await request(doctor, "/api/doctor/workspace");
  assert.equal(workspace.tasks.length, 2);
  assert.equal(workspace.visits.length, 1);

  const investor = await request(admin, "/api/investor/dashboard");
  assert.equal(investor.summary.newPatients30Days, 1);
  assert.ok(Array.isArray(investor.clinical.clinicPerformance));
  const report = await request(admin, "/api/investor/report.csv");
  assert.match(report, /Новые пациенты за 30 дней/);
  const dashboard = await request(admin, "/api/admin/dashboard");
  assert.ok(dashboard.activityEvents.some((event) => event.type === "patient_task_updated"));

  await request(doctor, "/api/doctor/account", { method: "PUT", expected: 401, body: { login: "test-doctor", currentAccessKey: "wrong-password", accessKey: doctorNewPassword } });
  await request(doctor, "/api/doctor/account", { method: "PUT", body: { login: "test-doctor", currentAccessKey: doctorPassword, accessKey: doctorNewPassword } });
  const doctorRelogin = session();
  await request(doctorRelogin, "/api/login/doctor", { method: "POST", body: { login: "test-doctor", accessKey: doctorNewPassword } });

  await request(admin, "/api/admin/account", { method: "PUT", body: { currentPassword: adminPassword, newPassword: adminNewPassword } });
  const adminRelogin = session();
  await request(adminRelogin, "/api/login/admin", { method: "POST", body: { username: "admin", password: adminNewPassword } });
  console.log("Product workflow integration test passed.");
} finally {
  server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
