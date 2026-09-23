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
  await request(admin, "/api/admin/doctors", {
    method: "POST", expected: 400,
    body: { fullName: "Исключенный Врач", login: "excluded-doctor", accessKey: doctorPassword, passport: "TEST", clinic: "Поликлиника №6", specialty: "Терапевт", experienceYears: 5 }
  });

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
  await request(admin, `/api/admin/patients/${createdSurvey.survey.id}`, { method: "PUT", body: { ...patient, clinic: "Поликлиника №1", reminderConsent: true, reminderChannel: "sms" } });
  await request(admin, "/api/admin/clinic-targets", { method: "PUT", body: { clinic: "Поликлиника №1", monthlyPatients: 10, monthlyVisits: 20, followUpCompletionPercent: 80 } });
  await request(admin, "/api/admin/clinic-targets", { method: "PUT", expected: 400, body: { clinic: "Поликлиника №13", monthlyPatients: 10 } });

  const appointment = await request(doctor, "/api/doctor/appointments", { method: "POST", expected: 201, body: { surveyId: createdSurvey.survey.id, startsAt: "2030-05-20T09:00:00.000Z", note: "Плановый прием" } });
  assert.equal(appointment.reminder.status, "queued");
  await request(doctor, `/api/doctor/appointments/${appointment.appointment.id}`, { method: "PUT", body: { status: "arrived" } });

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
  assert.equal(workspace.appointments.length, 1);
  const pdfResponse = await fetch(`${baseUrl}/api/doctor/patients/${createdSurvey.survey.id}/report.pdf`, { headers: { Cookie: doctor.cookie } });
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  assert.ok((await pdfResponse.arrayBuffer()).byteLength > 1000);

  const investor = await request(admin, "/api/investor/dashboard");
  assert.equal(investor.summary.newPatients30Days, 1);
  assert.ok(Array.isArray(investor.clinical.clinicPerformance));
  assert.equal(investor.clinical.clinicPerformance[0].targets.monthlyPatients, 10);
  const report = await request(admin, "/api/investor/report.csv");
  assert.match(report, /Новые пациенты за 30 дней/);
  const dashboard = await request(admin, "/api/admin/dashboard");
  assert.ok(dashboard.stats);
  assert.equal(dashboard.surveys, undefined, "Initial admin dashboard must not include the large patient collection");
  assert.equal(dashboard.trainingAttempts, undefined, "Initial admin dashboard must load training details lazily");
  const auditDashboard = await request(admin, "/api/admin/dashboard?tab=audit");
  assert.ok(auditDashboard.activityEvents.some((event) => event.type === "patient_task_updated"));
  const operationsDashboard = await request(admin, "/api/admin/dashboard?tab=operations");
  assert.equal(operationsDashboard.reminderQueue.length, 1);
  assert.deepEqual(operationsDashboard.surveyClinics, ["Поликлиника №1"]);
  const visitsDashboard = await request(admin, "/api/admin/dashboard?tab=visits");
  assert.equal(visitsDashboard.visits.length, 1);
  assert.equal(visitsDashboard.surveys.length, 1);
  assert.equal(visitsDashboard.surveys[0].measurements, undefined, "Visits tab must receive only compact patient labels");
  const publicMonitor = await request(session(), "/api/monitor/dashboard");
  assert.equal(publicMonitor.summary.surveys, 1);
  assert.ok(publicMonitor.surveys.every((survey) => survey.patientName === "Пациент"));
  assert.deepEqual(publicMonitor.filters.nurses, ["Добавил врач"]);
  assert.equal(publicMonitor.nurses.length, 1);
  assert.equal(publicMonitor.nurses[0].nurseName, "Добавил врач");
  assert.equal(publicMonitor.nurses[0].surveys, 1);

  // A known weight replaces arm/calf measurements; waist is still needed for FINDRISC.
  const nurse = session();
  const measuredPatient = {
    ...patient, lastName: "Измеренный", clinic: "Поликлиника №1", nurseName: "Тестовая Медсестра",
    height: 180, weight: 81, bmi: 18, arm: undefined, calf: undefined, glucoseLevel: undefined
  };
  const measuredMale = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201, body: measuredPatient
  });
  assert.equal(measuredMale.survey.measurements.weight, 81);
  assert.equal(measuredMale.survey.measurements.weightSource, "measured");
  assert.equal(measuredMale.survey.measurements.bmi, 25);
  assert.equal(measuredMale.survey.answers.bmi, 25);
  assert.equal(measuredMale.survey.measurements.rabitoWeight, null);
  assert.equal(measuredMale.survey.measurements.glucoseLevel, 0);
  assert.equal(measuredMale.survey.findrisc.score, 3, "FINDRISC must use BMI from the measured weight");

  const measuredFemale = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201,
    body: { ...measuredPatient, lastName: "Измеренная", sex: "female", weight: "81,3", height: "180,0" }
  });
  assert.equal(measuredFemale.survey.measurements.weight, 81.3);
  assert.equal(measuredFemale.survey.measurements.bmi, 25.1);
  assert.equal(measuredFemale.survey.measurements.rabitoWeight, null);
  assert.equal(measuredFemale.survey.findrisc.score, 7, "Female waist thresholds still apply with a measured weight");
  const nurseMonitor = await request(session(), "/api/monitor/dashboard?nurse=Тестовая%20Медсестра");
  assert.equal(nurseMonitor.summary.surveys, 2);
  assert.equal(nurseMonitor.nurses.length, 1);
  assert.equal(nurseMonitor.nurses[0].nurseName, "Тестовая Медсестра");
  assert.equal(nurseMonitor.nurses[0].surveys, 2);

  const measuredWithCircumferences = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201,
    body: { ...measuredPatient, lastName: "ПриоритетИзмерения", weight: 97.2, arm: 30, calf: 35 }
  });
  assert.equal(measuredWithCircumferences.survey.measurements.weight, 97.2);
  assert.equal(measuredWithCircumferences.survey.measurements.weightSource, "measured");
  assert.equal(measuredWithCircumferences.survey.measurements.bmi, 30);
  assert.equal(measuredWithCircumferences.survey.findrisc.score, 5);
  assert.notEqual(measuredWithCircumferences.survey.measurements.rabitoWeight, 97.2);

  for (const [field, invalidValues] of [
    ["weight", [0, -1, "не число", 501]],
    ["height", [undefined, "", 0, -1, "не число", 251]],
    ["rabitoWaist", [undefined, "", 0, -1, "не число", 301]]
  ]) {
    for (const value of invalidValues) {
      await request(nurse, "/api/nurse-surveys", {
        method: "POST", expected: 400,
        body: { ...measuredPatient, lastName: `Ошибка-${field}-${String(value)}`, [field]: value }
      });
    }
  }

  // Existing surveys and offline drafts without the new field retain the Rabito flow.
  for (const [index, weight] of [undefined, "", null].entries()) {
    const legacySurvey = await request(nurse, "/api/nurse-surveys", {
      method: "POST", expected: 201,
      body: { ...patient, lastName: `ПрежняяАнкета-${index}`, clinic: "Поликлиника №1", nurseName: "Тестовая Медсестра", weight, glucoseLevel: undefined }
    });
    assert.equal(legacySurvey.survey.measurements.rabitoWeight, createdSurvey.survey.measurements.rabitoWeight);
    assert.equal(legacySurvey.survey.measurements.bmi, createdSurvey.survey.measurements.bmi);
    assert.deepEqual(legacySurvey.survey.findrisc, createdSurvey.survey.findrisc);
  }

  const doctorMeasured = await request(doctor, "/api/doctor/surveys", {
    method: "POST", expected: 201,
    body: { ...measuredPatient, lastName: "ИзмеренВрачом", glucoseLevel: 5.5 }
  });
  assert.equal(doctorMeasured.survey.measurements.weight, 81);
  assert.equal(doctorMeasured.survey.measurements.bmi, 25);
  assert.equal(doctorMeasured.survey.measurements.glucoseLevel, 5.5);
  const measuredWorkspace = await request(doctor, "/api/doctor/workspace");
  const persistedMeasured = measuredWorkspace.surveys.find((survey) => survey.id === measuredMale.survey.id);
  assert.equal(persistedMeasured?.measurements.weight, 81);
  assert.equal(persistedMeasured?.measurements.weightSource, "measured");
  assert.equal(persistedMeasured?.measurements.bmi, 25);

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
