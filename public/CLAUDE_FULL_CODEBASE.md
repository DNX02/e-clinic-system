# ПОЛНЫЙ ИСХОДНЫЙ КОД ПРОЕКТА E-CLINIC (MEDICAL QR SYSTEM)
**Дата сборки:** 9 ноября 2026 г.  
**Стек:** Node.js (Vanilla HTTP/REST), PostgreSQL 16 (JSONB + B-tree), Vanilla JS (PWA Offline-First IndexedDB)  
**Репозиторий:** https://github.com/DNX02/e-clinic-system

## Оглавление
1. [package.json](#packagejson)
2. [public/sw.js (Service Worker PWA)](#publicswjs)
3. [scripts/test-product-improvements.mjs (Интеграционные тесты)](#scriptstest-product-improvementsmjs)
4. [server.js (Серверное ядро, API, БД, Auth)](#serverjs)
5. [public/app.js (Клиентское ядро PWA, формы, IndexedDB)](#publicappjs)

---

## package.json
```json
{
  "name": "medical-qr-system",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test:product": "node scripts/test-product-improvements.mjs",
    "test:ui": "node scripts/check-ui-contract.mjs",
    "upload-db": "node scripts/upload-db-to-postgres.mjs"
  },
  "dependencies": {
    "docx": "^9.7.1",
    "pdfkit": "^0.17.2",
    "pg": "^8.13.1",
    "pptxgenjs": "^4.0.1"
  }
}

```

---

## public/sw.js
```javascript
const CACHE_NAME = "medical-mobile-v94";
const SHELL = [
  "/app-1-admin-panel",
  "/app-2-doctor",
  "/app-3-patient-survey",
  "/app-4-doctor-knowledge",
  "/app-5-nurse-knowledge",
  "/app-6-investor-dashboard",
  "/app-7-operations-monitor",
  "/training.html",
  "/nurse-training.html",
  "/investor.html",
  "/monitor.html",
  "/styles.css?v=20261015audit-pagination",
  "/app.js?v=20261109findrisc14",
  "/workflow-ui.js?v=20260924workflow",
  "/admin.webmanifest",
  "/doctor.webmanifest",
  "/survey.webmanifest",
  "/icons/admin-icon.svg",
  "/icons/doctor-icon.svg",
  "/icons/survey-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-nurse-surveys") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "TRIGGER_SYNC" }));
      })
    );
  }
});

















```

---

## scripts/test-product-improvements.mjs
```javascript
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
  const keyOnlyUpdate = await request(admin, `/api/admin/doctors/${createdDoctor.doctor.id}`, {
    method: "PUT", body: { accessKey: doctorPassword }
  });
  assert.equal(keyOnlyUpdate.doctor.login, "test-doctor");
  assert.equal(keyOnlyUpdate.doctor.fullName, "Тестовый Врач");
  assert.equal(keyOnlyUpdate.doctor.clinic, "Поликлиника №1");
  for (const excludedNum of ["3", "5", "6", "8", "13"]) {
    await request(admin, "/api/admin/doctors", {
      method: "POST", expected: 400,
      body: { fullName: `Исключенный Врач ${excludedNum}`, login: `excluded-doctor-${excludedNum}`, accessKey: doctorPassword, passport: "TEST", clinic: `Поликлиника №${excludedNum}`, specialty: "Терапевт", experienceYears: 5 }
    });
  }

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
  for (const excludedNum of ["3", "5", "6", "8", "13"]) {
    await request(admin, "/api/admin/clinic-targets", { method: "PUT", expected: 400, body: { clinic: `Поликлиника №${excludedNum}`, monthlyPatients: 10 } });
  }

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
  assert.equal(auditDashboard.auditPageSize, 50, "Admin activity journal must use 50-event pages");
  assert.ok(auditDashboard.activityEvents.length <= 50, "Audit API must return no more than one page");
  assert.ok(auditDashboard.auditTotal >= auditDashboard.activityEvents.length);
  assert.ok(auditDashboard.activityEvents.some((event) => event.type === "patient_task_updated"));
  const nurseSurveyEvent = auditDashboard.activityEvents.find((event) => event.type === "doctor_patient_created");
  assert.equal(nurseSurveyEvent.surveyId, createdSurvey.survey.id);
  const clinicAudit = await request(admin, `/api/admin/dashboard?tab=audit&clinic=${encodeURIComponent("Поликлиника №1")}`, {
    method: "POST", body: { search: "" }
  });
  assert.ok(clinicAudit.activityEvents.length > 0);
  assert.ok(clinicAudit.activityEvents.every((event) => event.clinic === "Поликлиника №1"), "Clinic filter must be applied server-side");
  const searchedAudit = await request(admin, "/api/admin/dashboard?tab=audit", {
    method: "POST", body: { search: patient.lastName.toLocaleLowerCase("ru-RU") }
  });
  assert.ok(searchedAudit.activityEvents.some((event) => event.patientName?.includes(patient.lastName)), "Audit search must match patient names");
  const adminPatient = await request(admin, `/api/admin/patients/${createdSurvey.survey.id}`);
  assert.equal(adminPatient.survey.id, createdSurvey.survey.id);
  assert.equal(adminPatient.survey.patient.lastName, patient.lastName);
  assert.ok(Array.isArray(adminPatient.events));
  assert.ok(adminPatient.events.length >= 1, "Patient timeline must include activity events");
  assert.equal(typeof adminPatient.nextAction, "string");
  const correctedSurvey = await request(admin, `/api/admin/patients/${createdSurvey.survey.id}/answers`, {
    method: "PUT",
    body: { activity: "no", vegetables: "no", bpMeds: "yes", highGlucose: "no", familyDiabetes: "first", smoker: "no", systolic: 125, diastolic: 80 }
  });
  assert.equal(correctedSurvey.survey.answers.activity, "no");
  assert.ok(correctedSurvey.survey.changeHistory.some((event) => event.changes?.some((change) => change.field === "activity")), "Questionnaire correction must be recorded in history");
  const operationsDashboard = await request(admin, "/api/admin/dashboard?tab=operations");
  assert.equal(operationsDashboard.reminderQueue.length, 1);
  assert.deepEqual(operationsDashboard.surveyClinics, ["Поликлиника №1"]);
  const visitsDashboard = await request(admin, "/api/admin/dashboard?tab=visits");
  assert.equal(visitsDashboard.visits.length, 1);
  assert.equal(visitsDashboard.surveys.length, 1);
  assert.equal(visitsDashboard.surveys[0].measurements, undefined, "Visits tab must receive only compact patient labels");
  const clinicCorrected = await request(admin, `/api/admin/patients/${createdSurvey.survey.id}/answers`, {
    method: "PUT", body: { clinic: "Поликлиника №2" }
  });
  assert.equal(clinicCorrected.survey.patient.clinic, "Поликлиника №2");
  assert.equal(clinicCorrected.survey.clinic, "Поликлиника №2");
  assert.ok(clinicCorrected.survey.changeHistory.some((event) => event.changes?.some((change) => change.field === "clinic" && change.before === "Поликлиника №1" && change.after === "Поликлиника №2")), "Clinic correction must be preserved in history");
  await request(admin, `/api/admin/patients/${createdSurvey.survey.id}/answers`, {
    method: "PUT", body: { clinic: "Поликлиника №1" }
  });
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
  await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 400, body: { ...measuredPatient, lastName: "БезТелефона", phone: "" }
  });
  await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 400, body: { ...measuredPatient, lastName: "БезФИО", nurseName: "Медсестра" }
  });
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

  // FINDRISC doctor referral threshold test:
  // Score 12 and 13 do not refer to doctor on FINDRISC alone. Score 14 does.
  const findrisc12Patient = {
    ...measuredPatient,
    lastName: "РискДвенадцать",
    phone: "+992901119912",
    age: 50,
    weight: 97.2,
    height: 180,
    sex: "female",
    rabitoWaist: 90,
    activity: "no",
    vegetables: "no",
    bpMeds: "no",
    highGlucose: "no",
    familyDiabetes: "none",
    systolic: 120,
    diastolic: 80,
    smoker: "no"
  };
  const survey12 = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201, body: findrisc12Patient
  });
  assert.equal(survey12.survey.findrisc.score, 12);
  assert.equal(survey12.survey.findrisc.highRisk, false, "FINDRISC 12 must not be highRisk");
  assert.equal(survey12.survey.needsDoctor, false, "FINDRISC 12 without other risks must not need doctor");
  assert.ok(!survey12.survey.referralReasons.some((r) => r.includes("FINDRISC")), "FINDRISC 12 must not be in referral reasons");

  const findrisc13Patient = {
    ...findrisc12Patient,
    lastName: "РискТринадцать",
    phone: "+992901119913",
    age: 55
  };
  const survey13 = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201, body: findrisc13Patient
  });
  assert.equal(survey13.survey.findrisc.score, 13);
  assert.equal(survey13.survey.findrisc.highRisk, false, "FINDRISC 13 must not be highRisk");
  assert.equal(survey13.survey.needsDoctor, false, "FINDRISC 13 without other risks must not need doctor");

  const findrisc14Patient = {
    ...findrisc12Patient,
    lastName: "РискЧетырнадцать",
    phone: "+992901119914",
    bpMeds: "yes"
  };
  const survey14 = await request(nurse, "/api/nurse-surveys", {
    method: "POST", expected: 201, body: findrisc14Patient
  });
  assert.equal(survey14.survey.findrisc.score, 14);
  assert.equal(survey14.survey.findrisc.highRisk, true, "FINDRISC 14 must be highRisk");
  assert.equal(survey14.survey.needsDoctor, true, "FINDRISC 14 must direct to doctor");
  assert.ok(survey14.survey.referralReasons.some((r) => r.includes("FINDRISC: 14")), "FINDRISC 14 must be in referral reasons");

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

  const controlDashboard = await request(admin, "/api/admin/dashboard?tab=control");
  assert.ok(controlDashboard.careControl.summary.patients >= 1);
  assert.ok(controlDashboard.careControl.registry.some((row) => row.id === createdSurvey.survey.id));
  assert.ok(controlDashboard.careControl.nurseDaily.some((row) => row.nurseName === "Тестовая Медсестра"));
  const excelReport = await request(admin, "/api/admin/care-control.xls");
  assert.match(excelReport, /<Worksheet ss:Name="Регистр">/);
  const backup = await request(admin, "/api/admin/backup", { method: "POST", expected: 201, body: {} });
  assert.equal(backup.status.reason, "manual");
  await request(admin, "/api/admin/daily-reports", { method: "PUT", body: { enabled: false, time: "18:30", chatId: "123456789" } });
  const configuredControl = await request(admin, "/api/admin/dashboard?tab=control");
  assert.equal(configuredControl.careControl.dailyReports.time, "18:30");

  await request(admin, "/api/admin/admins", {
    method: "POST", expected: 201,
    body: { name: "Старшая медсестра №1", username: "head-nurse-1", password: "Nurse12345", role: "head_nurse", clinic: "Поликлиника №1" }
  });
  const headNurse = session();
  await request(headNurse, "/api/login/admin", { method: "POST", body: { username: "head-nurse-1", password: "Nurse12345" } });
  const headNurseControl = await request(headNurse, "/api/admin/dashboard?tab=control");
  assert.equal(headNurseControl.clinicScope, "1");
  assert.ok(headNurseControl.careControl.registry.every((row) => row.clinic === "Поликлиника №1"));
  assert.equal(headNurseControl.careControl.dailyReports.chatId, "");
  await request(headNurse, "/api/admin/backup", { method: "POST", expected: 403, body: {} });

  const referral = await request(nurse, '/api/nurse-surveys', { method: 'POST', expected: 201,
    body: { ...measuredPatient, lastName: 'ОжидаетВрача', middleName: '', systolic: 160 } });
  assert.equal(referral.survey.patient.middleName, '');
  const otherClinic = await request(nurse, '/api/nurse-surveys', { method: 'POST', expected: 201,
    body: { ...measuredPatient, lastName: 'ДругаяПоликлиника', clinic: 'Поликлиника №2', systolic: 160 } });
  const headNurseCorrection = await request(headNurse, `/api/admin/patients/${createdSurvey.survey.id}/answers`, {
    method: 'PUT', body: { activity: 'yes', vegetables: 'no', bpMeds: 'yes', highGlucose: 'no', familyDiabetes: 'first', smoker: 'no', systolic: 126, diastolic: 81 }
  });
  assert.equal(headNurseCorrection.survey.measurements.systolic, 126);
  await request(headNurse, `/api/admin/patients/${otherClinic.survey.id}/answers`, {
    method: 'PUT', expected: 403, body: { activity: 'yes', vegetables: 'yes', bpMeds: 'no', highGlucose: 'no', familyDiabetes: 'none', smoker: 'no', systolic: 120, diastolic: 80 }
  });
  const headNurseAudit = await request(headNurse, '/api/admin/dashboard?tab=audit');
  assert.equal(headNurseAudit.canCorrectSurveys, true);
  const ownCorrection = headNurseAudit.activityEvents.find(event => event.type === 'survey_answers_corrected');
  assert.ok(ownCorrection, 'Head nurse must see her own corrections');
  assert.ok(headNurseAudit.activityEvents.some(event => event.type === 'nurse_survey_created'), 'Head nurse must see clinic nurse history');
  assert.ok(headNurseAudit.activityEvents.every(event => (['nurse', 'doctor'].includes(event.actorRole) || event.actorId === ownCorrection.actorId) && event.surveyId), 'Head nurse journal must exclude administrative activity by other accounts');
  assert.ok(!headNurseAudit.activityEvents.some(event => event.type === 'admin_login'), 'Administrative logins must remain private');
  assert.ok(!headNurseAudit.activityEvents.some((event) => event.surveyId === otherClinic.survey.id), 'Head nurse journal must exclude patients from other clinics');
  await request(headNurse, '/api/admin/dashboard?tab=headNurses', { expected: 403 });
  const headNurseControlAudit = await request(admin, '/api/admin/dashboard?tab=headNurses');
  assert.equal(headNurseControlAudit.headNurseActivity.accounts.length, 1);
  assert.ok(headNurseControlAudit.headNurseActivity.events.some((event) => event.type === 'admin_login' && event.actorName === 'Старшая медсестра №1'));
  const correctionEvent = headNurseControlAudit.headNurseActivity.events.find((event) => event.type === 'survey_answers_corrected');
  assert.equal(correctionEvent.actorRole, 'head_nurse');
  assert.match(correctionEvent.details, /Физическая активность|Овощи и фрукты|Препараты от давления/);
  const waiting = await request(doctor, '/api/doctor/waiting-patients');
  assert.ok(waiting.patients.some(row => row.id === referral.survey.id));
  assert.ok(!waiting.patients.some(row => row.id === otherClinic.survey.id));
  await request(doctor, '/api/patient-outreach', { method: 'PUT', body: { surveyId: referral.survey.id, status: 'called' } });
  await request(headNurse, '/api/patient-outreach', { method: 'PUT', expected: 403, body: { surveyId: otherClinic.survey.id, status: 'called' } });
  await request(headNurse, `/api/admin/patients/${otherClinic.survey.id}`, { expected: 403 });
  const edited = await request(admin, `/api/admin/patients/${referral.survey.id}`, { method: 'PUT', body: { address: 'Новый тестовый адрес' } });
  assert.ok(edited.survey.changeHistory.some(event => event.changes.some(change => change.field === 'address' && change.after === 'Новый тестовый адрес')));
  const labVisit = await request(doctor, '/api/doctor/visits', { method: 'POST', expected: 201,
    body: { surveyId: referral.survey.id, weight: 81, height: 180, systolic: 130, diastolic: 80,
      laboratoryTests: [{ test: 'HbA1c', status: 'ordered', orderedDate: '2026-01-01' }],
      diabetesDrugs: ['Метформин 500 мг 1 раз в день'], lifestyleRecommendations: ['physicalActivity'] } });
  const workspaceAfterPrescription = await request(doctor, '/api/doctor/workspace');
  const persistedPrescription = workspaceAfterPrescription.visits.find(item => item.id === labVisit.visit.id);
  assert.deepEqual(persistedPrescription.diabetesDrugs, ['Метформин 500 мг 1 раз в день']);
  assert.equal(persistedPrescription.laboratoryTests[0].test, 'HbA1c');
  assert.equal(persistedPrescription.laboratoryTests[0].status, 'ordered');
  assert.equal(persistedPrescription.lifestyleRecommendations.physicalActivity, true);
  let care = (await request(admin, '/api/admin/dashboard?tab=control')).careControl;
  assert.equal(care.registry.find(row => row.id === referral.survey.id).checklist.hba1c, false);
  assert.ok(!care.waitingPatients.some(row => row.id === referral.survey.id));
  await request(doctor, '/api/doctor/lab-result', { method: 'PUT', expected: 400,
    body: { visitId: labVisit.visit.id, index: 0, result: '6.2%', resultDate: '2026-02-30' } });
  await request(doctor, '/api/doctor/lab-result', { method: 'PUT',
    body: { visitId: labVisit.visit.id, index: 0, result: '6.2%', resultDate: '2026-01-02' } });
  care = (await request(admin, '/api/admin/dashboard?tab=control')).careControl;
  assert.equal(care.registry.find(row => row.id === referral.survey.id).checklist.hba1c, true);
  const restoreBackup = await request(admin, '/api/admin/backup', { method: 'POST', expected: 201, body: {} });
  assert.equal(restoreBackup.status.restoreCheck.mode, 'isolated-file-database');
  assert.ok(restoreBackup.status.restoreCheck.counts.nurseSurveys > 0);
  for (const file of ['doctor-ru', 'doctor-tg', 'nurse-ru', 'nurse-tg']) {
    const video = await fetch(`${baseUrl}/help/${file}.mp4`, { headers: { Range: 'bytes=0-31' } });
    assert.equal(video.status, 206);
    assert.equal((await video.arrayBuffer()).byteLength, 32);
  }

  await request(doctor, "/api/doctor/account", { method: "PUT", expected: 401, body: { login: "test-doctor", currentAccessKey: "wrong-password", accessKey: doctorNewPassword } });
  await request(doctor, "/api/doctor/account", { method: "PUT", body: { login: "test-doctor", currentAccessKey: doctorPassword, accessKey: doctorNewPassword } });
  const doctorRelogin = session();
  await request(doctorRelogin, "/api/login/doctor", { method: "POST", body: { login: "test-doctor", accessKey: doctorNewPassword } });
  const namesake = await request(doctorRelogin, "/api/doctor/surveys", {
    method: "POST", expected: 201, body: { ...patient, middleName: "", phone: "+992900009999" }
  });
  assert.equal(namesake.survey.patient.lastName, patient.lastName);
  assert.equal(namesake.survey.patient.middleName, "");
  assert.notEqual(namesake.survey.patient.phone, createdSurvey.survey.patient.phone);

  await request(admin, "/api/admin/account", { method: "PUT", body: { currentPassword: adminPassword, newPassword: adminNewPassword } });
  const adminRelogin = session();
  await request(adminRelogin, "/api/login/admin", { method: "POST", body: { username: "admin", password: adminNewPassword } });
  const imported = await request(adminRelogin, "/api/admin/patients/import", { method: "POST", body: { rows: [{ lastName: "Импорт", firstName: "Тест", birthDate: "1985-01-01", clinic: "Поликлиника №1", sex: "female", age: 41, height: 165, weight: 70, rabitoWaist: 85, systolic: 120, diastolic: 80, nurseName: "Тестовая медсестра" }] } });
  assert.equal(imported.imported.length, 1);
  console.log("Product workflow integration test passed.");
} finally {
  const exitPromise = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 3000))]);
  await rm(dataDir, { recursive: true, force: true });
}

```

---

## server.js
```javascript
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { labHasResult, patientChanges, waitingPatients, verifyBackupRestore } from './care-workflow.js';
import PDFDocument from "pdfkit";
import { buildWeeklyMonitorReportDocx, monitorReportPeriod } from "./weekly-monitor-report.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, "data");
const dbPath = join(dataDir, "db.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_TIMEOUT_MS = Number(process.env.PG_TIMEOUT_MS || 8000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_REPORT_CHAT_ID = process.env.TELEGRAM_REPORT_CHAT_ID || "";
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1024 * 1024);
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;
const ADMIN_APP_PATH = "/app-1-admin-panel";
const DOCTOR_APP_PATH = "/app-2-doctor";
const SURVEY_APP_PATH = "/app-3-patient-survey";
const TRAINING_APP_PATH = "/app-4-doctor-knowledge";
const NURSE_TRAINING_APP_PATH = "/app-5-nurse-knowledge";
const INVESTOR_APP_PATH = "/app-6-investor-dashboard";
const MONITOR_APP_PATH = "/app-7-operations-monitor";
const DIABETES_APP_PATH = "/app-8-diabetes-risk";
let dbCache = null;
let dbLoadPromise = null;
let dbWritePromise = Promise.resolve();
let dbReadyPromise = null;
let pgPoolPromise = null;
const rateLimits = new Map();
const normalizedCollectionTables = {
  admins: "app_admins",
  doctors: "app_doctors",
  nurseSurveys: "app_nurse_surveys",
  doctorVisits: "app_doctor_visits",
  trainingParticipants: "app_training_participants",
  trainingAttempts: "app_training_attempts",
  nurseTrainingParticipants: "app_nurse_training_participants",
  nurseTrainingAttempts: "app_nurse_training_attempts",
  patientTasks: "app_patient_tasks",
  appointments: "app_appointments",
  reminderQueue: "app_reminder_queue",
  messageEvents: "app_message_events",
  activityEvents: "app_activity_events"
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".mp4": "video/mp4"
};

const seedAdmins = [
  { id: "admin-main", name: "Главный администратор", username: "admin", role: "owner" }
];

const adminRoles = {
  owner: "Главный администратор",
  manager: "Администратор",
  head_nurse: "Старшая медсестра",
  observer: "Наблюдатель"
};

const diabetesDrugs = [
  "Метформин 500 мг 1 раз в день",
  "Метформин 500 мг 2 раза в день",
  "Метформин 850 мг 2 раза в день",
  "Метформин 1000 мг 2 раза в день",
  "Гликлазид МВ 30 мг",
  "Гликлазид МВ 60 мг",
  "Глимепирид 1 мг",
  "Глимепирид 2 мг",
  "Глимепирид 4 мг",
  "Ситаглиптин 100 мг",
  "Вилдаглиптин 50 мг 2 раза в день",
  "Линаглиптин 5 мг",
  "Саксаглиптин 5 мг"
];

const hypertensionDrugs = [
  "Эналаприл 5 мг 2 раза в день",
  "Эналаприл 10 мг 2 раза в день",
  "Периндоприл 5 мг",
  "Периндоприл 10 мг",
  "Лозартан 50 мг",
  "Лозартан 100 мг",
  "Валсартан 80 мг",
  "Валсартан 160 мг",
  "Амлодипин 5 мг",
  "Амлодипин 10 мг",
  "Индапамид 1,5 мг",
  "Гидрохлортиазид 12,5 мг",
  "Бисопролол 2,5 мг",
  "Бисопролол 5 мг"
];

const preTestQuestions = [
  {
    id: 1,
    text: "Основной механизм развития СД2 включает:",
    options: { A: "Абсолютный дефицит инсулина с первого дня заболевания", B: "Инсулинорезистентность и прогрессирующую дисфункцию бета-клеток", C: "Только аутоиммунное разрушение бета-клеток", D: "Только повышение глюкагона без роли инсулина" },
    answer: "B"
  },
  { id: 2, text: "Кардиометаболический риск у пациента с СД2 и АГ обычно:", options: { A: "Ниже, чем у пациента без диабета", B: "Не зависит от уровня АД", C: "Выше и требует активного выявления факторов риска", D: "Оценивается только после инфаркта" }, answer: "C" },
  { id: 3, text: "FINDRISC применяется для:", options: { A: "Диагностики диабетической нефропатии", B: "Оценки риска развития СД2", C: "Подбора дозы инсулина", D: "Диагностики тиреотоксикоза" }, answer: "B" },
  { id: 4, text: "При высоком риске по FINDRISC врач ПМСП должен:", options: { A: "Сразу назначить инсулин", B: "Направить на лабораторное подтверждение нарушений углеводного обмена и провести профилактическое консультирование", C: "Ничего не делать без жалоб", D: "Повторить FINDRISC через 5 лет" }, answer: "B" },
  { id: 5, text: "К диагностическому уровню глюкозы плазмы натощак для СД относится:", options: { A: ">=5,0 ммоль/л", B: ">=5,6 ммоль/л", C: ">=6,1 ммоль/л", D: ">=7,0 ммоль/л" }, answer: "D" },
  { id: 6, text: "HbA1c, соответствующий диагностическому порогу СД, обычно составляет:", options: { A: ">=5,0%", B: ">=5,7%", C: ">=6,5%", D: ">=8,5%" }, answer: "C" },
  { id: 7, text: "Офисное АД, требующее подтверждения диагноза АГ при повторных измерениях:", options: { A: ">=120/80 мм рт.ст.", B: ">=130/80 мм рт.ст.", C: ">=140/90 мм рт.ст.", D: ">=160/100 мм рт.ст. только при жалобах" }, answer: "C" },
  { id: 8, text: "Предиабет важен для семейного врача, потому что:", options: { A: "Не требует наблюдения", B: "Является стадией повышенного риска СД2 и сердечно-сосудистых осложнений", C: "Всегда требует немедленного инсулина", D: "Не связан с ожирением" }, answer: "B" },
  { id: 9, text: "К микрососудистым осложнениям СД относятся:", options: { A: "Ретинопатия, нефропатия, нейропатия", B: "Инфаркт миокарда и инсульт", C: "Только ожирение", D: "Только артериальная гипертензия" }, answer: "A" },
  { id: 10, text: "К макрососудистым осложнениям СД относятся:", options: { A: "Катаракта и анемия", B: "Инфаркт миокарда, инсульт, поражение периферических артерий", C: "Только нейропатия", D: "Только гипогликемия" }, answer: "B" },
  { id: 11, text: "При каждом визите пациента с СД2 и АГ врач ПМСП должен оценивать:", options: { A: "Только температуру тела", B: "АД, приверженность, побочные эффекты, симптомы осложнений", C: "Только массу тела один раз в 5 лет", D: "Только жалобы на жажду" }, answer: "B" },
  { id: 12, text: "Индивидуальный план ведения пациента должен включать:", options: { A: "Только диагноз", B: "Цели, лечение, мониторинг, сроки контроля, маршрутизацию", C: "Только список лекарств", D: "Только рекомендацию соблюдать диету" }, answer: "B" },
  { id: 13, text: "Немедикаментозная тактика при СД2 и АГ включает:", options: { A: "Отмену физической активности", B: "Контроль массы тела, питание, физическую активность, ограничение соли, отказ от курения", C: "Только постельный режим", D: "Исключение всех углеводов без оценки состояния" }, answer: "B" },
  { id: 14, text: "Срочного направления требует:", options: { A: "Стабильное АД 130/80 без жалоб", B: "Симптомы гипертонического криза/острого поражения органов-мишеней", C: "FINDRISC 7 баллов без жалоб", D: "Плановый контроль HbA1c" }, answer: "B" },
  { id: 15, text: "Пациент с СД2 должен наблюдаться на уровне ПМСП:", options: { A: "Только при наличии осложнений", B: "Регулярно, с контролем факторов риска и осложнений", C: "Только один раз после постановки диагноза", D: "Только у эндокринолога без участия семейного врача" }, answer: "B" },
  { id: 16, text: "Коммуникация врача с пациентом при НИЗ должна быть:", options: { A: "Приказной без объяснений", B: "Понятной, уважительной, с вовлечением пациента в план лечения", C: "Только письменной", D: "Направленной только на родственников" }, answer: "B" },
  { id: 17, text: "При подозрении на впервые выявленный СД2 врач должен:", options: { A: "Игнорировать результат при отсутствии жалоб", B: "Подтвердить диагноз лабораторно и оценить сопутствующие риски", C: "Назначить антибиотики", D: "Отменить все лекарства от АГ" }, answer: "B" },
  { id: 18, text: "При СД2 и АГ особенно важно:", options: { A: "Лечить только сахар", B: "Одновременно контролировать гликемию, АД, липиды, массу тела и образ жизни", C: "Исключить мониторинг почек", D: "Не оценивать риск ССЗ" }, answer: "B" },
  { id: 19, text: "Правильная маршрутизация означает:", options: { A: "Направлять всех пациентов только в стационар", B: "Определять уровень помощи, срочность и обратную связь с ПМСП", C: "Не фиксировать направление в карте", D: "Не объяснять пациенту дальнейшие шаги" }, answer: "B" },
  { id: 20, text: "Практический разбор клинического случая нужен для оценки:", options: { A: "Только памяти участника", B: "Умения применять знания к реальному пациенту и принимать решения", C: "Только скорости письма", D: "Только посещаемости" }, answer: "B" }
];

const practicalTasks = [
  {
    id: "findrisc",
    instrument: "Инструмент 4",
    title: "Практическая задача по FINDRISC",
    maxScore: 10,
    description: "Мужчина 52 лет, ИМТ 31 кг/м2, окружность талии 104 см, физическая активность менее 30 минут в день, овощи/фрукты ежедневно не употребляет, получает препараты от АГ, ранее повышенная глюкоза не выявлялась, у матери был СД2.",
    fields: [
      ["age", "Баллы за возраст"],
      ["bmi", "Баллы за ИМТ"],
      ["waist", "Баллы за окружность талии"],
      ["activity", "Баллы за физическую активность"],
      ["vegetables", "Баллы за овощи/фрукты"],
      ["bpTherapy", "Баллы за антигипертензивную терапию"],
      ["highGlucose", "Баллы за повышение глюкозы ранее"],
      ["family", "Баллы за семейный анамнез"],
      ["total", "Итоговая сумма баллов"],
      ["riskAction", "Категория риска и дальнейшее действие"]
    ],
    criteria: [
      "Правильно указаны баллы по возрасту - 1",
      "Правильно указаны баллы по ИМТ - 1",
      "Правильно указаны баллы по окружности талии - 1",
      "Правильно учтена физическая активность - 1",
      "Правильно учтено питание - 1",
      "Правильно учтена антигипертензивная терапия - 1",
      "Правильно учтен анамнез повышенной глюкозы - 1",
      "Правильно учтен семейный анамнез - 1",
      "Правильно рассчитана сумма - 1",
      "Правильно указаны категория риска и дальнейшее действие - 1"
    ],
    key: "Ожидаемый общий балл FINDRISC: 19 баллов; категория: высокий риск; действие: лабораторное обследование гликемии/HbA1c, консультирование по образу жизни, контроль факторов риска и план наблюдения."
  },
  {
    id: "diagnostics",
    instrument: "Инструмент 5",
    title: "Диагностические мини-задачи: СД2, предиабет и АГ",
    maxScore: 20,
    cases: [
      "Женщина 48 лет, ИМТ 32. Глюкоза плазмы натощак 7,2 ммоль/л при повторном анализе. Жалоб нет.",
      "Мужчина 55 лет. Глюкоза натощак 6,4 ммоль/л, HbA1c 6,0%.",
      "Женщина 61 год. HbA1c 6,8%, АД на приеме 152/94 мм рт.ст., повторно 148/92.",
      "Мужчина 45 лет. Разовое АД 145/90 после стресса, повторных измерений нет.",
      "Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л."
    ],
    fields: [["conclusion", "Заключение врача"], ["criterion", "Критерий/основание"], ["action", "Дальнейшее действие"]],
    criteria: ["Правильно определена категория/диагноз - 2 балла за ситуацию", "Правильно указан диагностический критерий - 1 балл за ситуацию", "Правильно указано дальнейшее действие - 1 балл за ситуацию"]
  },
  {
    id: "plan",
    instrument: "Инструмент 6",
    title: "Индивидуальный план ведения пациента",
    maxScore: 30,
    description: "Женщина 56 лет, впервые выявленный СД2. HbA1c 8,1%, глюкоза натощак 8,5 ммоль/л, АД 150/95 мм рт.ст. при повторных измерениях, ИМТ 33 кг/м2, окружность талии 102 см. Курит. Жалуется на утомляемость. Креатинин и общий анализ мочи без критических отклонений. Ретинопатия не оценивалась. Лекарств от СД ранее не получала.",
    fields: [
      ["diagnosis", "Основной диагноз и сопутствующие состояния"],
      ["risks", "Факторы риска и уровень кардиометаболического риска"],
      ["goals", "Индивидуальные цели лечения"],
      ["lifestyle", "Немедикаментозные рекомендации"],
      ["diabetesTreatment", "Медикаментозная тактика по СД2"],
      ["hypertensionTreatment", "Медикаментозная тактика по АГ"],
      ["monitoring", "Мониторинг гликемии, АД, массы тела"],
      ["screening", "Скрининг осложнений СД"],
      ["followUp", "Сроки повторного визита"],
      ["referral", "Показания к направлению к специалисту"]
    ],
    criteria: ["Диагноз и сопутствующие состояния - 3", "Факторы риска/кардиометаболический риск - 3", "Цели лечения - 3", "Немедикаментозные рекомендации - 4", "Тактика по СД2 - 4", "Тактика по АГ - 4", "Мониторинг гликемии/АД/массы тела - 3", "Скрининг осложнений - 3", "Сроки повторного визита - 1", "Показания к направлению - 2"]
  },
  {
    id: "routing",
    instrument: "Инструмент 7",
    title: "Маршрутизация пациента",
    maxScore: 20,
    cases: [
      "АД 185/115 мм рт.ст. + боль в груди/одышка/неврологические симптомы",
      "Впервые выявленный СД2 без кетоза, стабильное состояние, HbA1c 7,8%",
      "СД2 + язва стопы/признаки инфекции стопы",
      "СД2 + снижение функции почек или выраженная альбуминурия по доступным данным",
      "АГ 150/95 мм рт.ст. повторно, без признаков острого поражения органов-мишеней",
      "Высокий FINDRISC, но глюкоза натощак пока не определялась"
    ],
    fields: [["route", "Куда направить/где вести"], ["urgency", "Срочность"], ["reason", "Обоснование"], ["responsible", "Ответственный за наблюдение"]],
    criteria: ["Верно определен уровень помощи/направления по каждой ситуации - 6", "Верно указана срочность - 4", "Дано клиническое обоснование - 4", "Указана обратная связь с ПМСП и ответственный - 3", "Отмечены ситуации, требующие экстренной помощи - 3"]
  },
  {
    id: "clinical-case",
    instrument: "Инструмент 8",
    title: "Комплексный клинический случай",
    maxScore: 20,
    description: "Мужчина 59 лет, водитель. ИМТ 30 кг/м2, окружность талии 106 см. Курит. АД на двух визитах 158/96 и 154/94 мм рт.ст. Глюкоза натощак 7,4 ммоль/л повторно, HbA1c 7,2%. Жалобы: быстрая утомляемость, периодическое онемение стоп. Ранее регулярно не наблюдался. Семейный анамнез: отец умер от инсульта. При осмотре выраженных острых симптомов нет.",
    fields: [
      ["diagnosis", "Предварительный/клинический диагноз"],
      ["risks", "Основные факторы риска"],
      ["additional", "Какие показатели надо дополнительно оценить"],
      ["treatment", "Первичный план лечения и профилактики"],
      ["monitoring", "План мониторинга в ПМСП"],
      ["screening", "Скрининг осложнений"],
      ["routing", "Маршрутизация и показания к специалистам"],
      ["communication", "Как объяснить пациенту дальнейшие шаги"]
    ],
    criteria: ["Диагноз: СД2 + АГ + ожирение/факторы риска - 3", "Оценка сердечно-сосудистого риска и факторов риска - 3", "План дообследования - 3", "План лечения и профилактики - 4", "Мониторинг и диспансерное наблюдение - 3", "Скрининг осложнений и маршрутизация - 3", "Коммуникация с пациентом - 1"]
  }
];

const postTrainingTasks = [
  {
    id: "findrisc-new",
    instrument: "Тест 1",
    title: "Практическая задача по FINDRISC",
    maxScore: 9,
    mode: "findrisc",
    description: "Мужчина 52 лет, ИМТ 31 кг/м2, окружность талии 104 см, физическая активность менее 30 минут в день, овощи/фрукты ежедневно не употребляет, получает препараты от АГ, ранее повышенная глюкоза не выявлялась, у матери был СД2.",
    fields: [
      ["age", "Возраст, 52 года", "2"],
      ["bmi", "ИМТ 31 кг/м2", "3"],
      ["waist", "Окружность талии 104 см, мужчина", "4"],
      ["activity", "Физическая активность <30 мин/день", "2"],
      ["vegetables", "Овощи/фрукты не ежедневно", "1"],
      ["bpTherapy", "Антигипертензивная терапия: да", "2"],
      ["highGlucose", "Повышение глюкозы ранее: нет", "0"],
      ["family", "Семейный анамнез СД: мать с СД2", "5"],
      ["risk", "ИТОГО: категория риска", "Высокий риск"]
    ],
    criteria: ["1 балл за каждый правильно заполненный компонент FINDRISC и итоговую категорию риска."],
    key: "Правильные баллы: возраст 2, ИМТ 3, талия 4, физическая активность 2, овощи/фрукты 1, АГ-терапия 2, глюкоза ранее 0, семейный анамнез 5. Итог: высокий риск."
  },
  {
    id: "diagnostics-new",
    instrument: "Тест 2",
    title: "Диагностические мини-задачи: СД2, предиабет и АГ",
    maxScore: 5,
    mode: "singleCases",
    options: ["Сахарный диабет 2 типа", "Нарушенная гликемия натощак", "Повышение артериального давления"],
    cases: [
      ["Женщина 48 лет, ИМТ 32. Глюкоза плазмы натощак 7,2 ммоль/л при повторном анализе. Жалоб нет.", "Сахарный диабет 2 типа"],
      ["Мужчина 55 лет. Глюкоза натощак 6,4 ммоль/л, HbA1c 6,0%.", "Нарушенная гликемия натощак"],
      ["Женщина 61 год. HbA1c 6,8%, АД на приеме 152/94 мм рт.ст., повторно 148/92.", "Сахарный диабет 2 типа"],
      ["Мужчина 45 лет. Разовое АД 145/90 после стресса, повторных измерений нет.", "Повышение артериального давления"],
      ["Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л.", "Сахарный диабет 2 типа"]
    ],
    criteria: ["1 балл за каждый правильный вариант ответа."]
  },
  {
    id: "plan-new",
    instrument: "Тест 3",
    title: "Клиническая задача и индивидуальный план ведения пациента",
    maxScore: 10,
    mode: "mcq",
    description: "Женщина 56 лет, впервые выявленный СД2. HbA1c 8,1%, глюкоза натощак 8,5 ммоль/л, АД 150/95 мм рт.ст. при повторных измерениях, ИМТ 33 кг/м2, окружность талии 102 см. Курит. Жалуется на утомляемость. Ретинопатия не оценивалась. Лекарств от СД ранее не получала.",
    questions: [
      { text: "Основной диагноз и сопутствующие состояния", options: { A: "Сахарный диабет 2 типа, ожирение", B: "Сахарный диабет 2 типа, впервые выявленный, декомпенсированный. Ожирение 1 степени (абдоминальное). Артериальная гипертензия 2 степени.", C: "Метаболический синдром, преддиабет", D: "Сахарный диабет 2 типа, артериальная гипертензия", E: "Ожирение, никотиновая зависимость" }, answer: "B" },
      { text: "Факторы риска и уровень кардиометаболического риска", options: { A: "Средний риск", B: "Очень высокий кардиометаболический риск (СД2 + АГ + ожирение + курение + возраст)", C: "Низкий риск", D: "Только высокий риск по ожирению", E: "Риск не определяется на ПМСП" }, answer: "B" },
      { text: "Индивидуальные цели лечения", options: { A: "HbA1c < 8,0%, АД < 140/90", B: "HbA1c < 7,0%, АД < 130/80 мм рт.ст., снижение веса >= 5-10%", C: "HbA1c < 6,5%, АД < 120/70", D: "Только нормализация глюкозы натощак", E: "Нет четких целей на старте" }, answer: "B" },
      { text: "Немедикаментозные рекомендации", options: { A: "Только отказ от курения", B: "Снижение массы тела, низкоуглеводная диета, увеличение физической активности до 150 мин/нед, полный отказ от курения", C: "Только диета", D: "Лечебная физкультура 2 раза в неделю", E: "Ничего не назначать до эндокринолога" }, answer: "B" },
      { text: "Медикаментозная тактика по СД2", options: { A: "Сразу инсулин", B: "Метформин (начать с 500 мг 2 раза в день, титровать до 2000 мг/сут)", C: "Гликлазид", D: "Только изменение образа жизни в течение 3 месяцев", E: "SGLT2-ингибитор в качестве монотерапии" }, answer: "B" },
      { text: "Медикаментозная тактика по АГ", options: { A: "Только амлодипин", B: "Ингибитор АПФ (периндоприл) или БРА + амлодипин (комбинированная терапия)", C: "Бета-блокатор", D: "Только диуретик", E: "Начинать монотерапию" }, answer: "B" },
      { text: "Мониторинг гликемии, АД, массы тела", options: { A: "1 раз в 3 месяца", B: "Самоконтроль глюкозы 2-3 раза в неделю, АД ежедневно, вес 1 раз в неделю. Контроль в ПМСП через 2 недели", C: "Только HbA1c через 3 месяца", D: "Контроль только на приеме", E: "Мониторинг не требуется" }, answer: "B" },
      { text: "Скрининг осложнений СД", options: { A: "Только через год", B: "Осмотр глазного дна (офтальмолог), ACR, eGFR, оценка стоп и неврологический статус - в ближайшее время", C: "Только ЭКГ", D: "Только УЗИ почек", E: "Скрининг не нужен при впервые выявленном СД" }, answer: "B" },
      { text: "Сроки повторного визита", options: { A: "Через 1 месяц", B: "Через 10-14 дней", C: "Через 3 месяца", D: "Через 6 месяцев", E: "Только после консультации эндокринолога" }, answer: "B" },
      { text: "Показания к направлению к специалисту", options: { A: "Направление не требуется", B: "Эндокринолог - в течение 7-14 дней, офтальмолог - в течение 1 месяца, кардиолог - по показаниям", C: "Только к кардиологу", E: "Только к нефрологу" }, answer: "B" }
    ],
    criteria: ["1 балл за каждый правильный ответ. Правильные ответы в файле отмечены черным."]
  },
  {
    id: "routing-new",
    instrument: "Тест 4",
    title: "Маршрутизация пациента",
    maxScore: 12,
    mode: "routing",
    specialistOptions: ["кардиолог", "эндокринолог", "хирург", "нефролог"],
    urgencyOptions: ["экстренно", "неотложно"],
    cases: [
      ["АД 185/115 мм рт.ст. + боль в груди/одышка/неврологические симптомы", "кардиолог", "экстренно"],
      ["Впервые выявленный СД2 без кетоза, стабильное состояние, HbA1c 7,8%", "эндокринолог", "неотложно"],
      ["СД2 + язва стопы/признаки инфекции стопы", "хирург", "экстренно"],
      ["СД2 + снижение функции почек или выраженная альбуминурия по доступным данным", "нефролог", "неотложно"],
      ["АГ 150/95 мм рт.ст. повторно, без признаков острого поражения органов-мишеней", "кардиолог", "неотложно"],
      ["Высокий FINDRISC, но глюкоза натощак пока не определялась", "эндокринолог", "неотложно"]
    ],
    criteria: ["1 балл за правильного специалиста и 1 балл за правильную срочность в каждой ситуации."]
  },
  {
    id: "clinical-case-new",
    instrument: "Тест 5",
    title: "Комплексный клинический случай для оценки принятия решений",
    maxScore: 8,
    mode: "mcq",
    description: "Мужчина 59 лет, водитель. ИМТ 30 кг/м2, окружность талии 106 см. Курит. АД на двух визитах 158/96 и 154/94 мм рт.ст. Глюкоза натощак 7,4 ммоль/л повторно, HbA1c 7,2%. Жалобы: быстрая утомляемость, периодическое онемение стоп. Семейный анамнез: отец умер от инсульта.",
    questions: [
      { text: "Предварительный клинический диагноз", options: { A: "Нарушение гликемии натощак", B: "Сахарный диабет 2 типа, впервые выявленный", C: "Преддиабет", D: "Сахарный диабет 1 типа", E: "Метаболический синдром" }, answer: "B" },
      { text: "Основные факторы риска у данного пациента", options: { A: "Только возраст и курение", B: "Ожирение, абдоминальное ожирение, АГ, курение, возраст, отягощенная наследственность", C: "Только наследственность", D: "Только гипергликемия", E: "Только артериальная гипертензия" }, answer: "B" },
      { text: "Какие показатели необходимо дополнительно оценить в первую очередь?", options: { A: "Только общий анализ крови", B: "eGFR, ACR (альбумин/креатинин), липидный профиль, осмотр глазного дна, ЛПИ", C: "Только УЗИ органов брюшной полости", D: "Только С-пептид", E: "Только коагулограмма" }, answer: "B" },
      { text: "Первичный план лечения и профилактики", options: { A: "Только диета", B: "Метформин + изменение образа жизни + ИАПФ/БРА + амлодипин + статин + отказ от курения", C: "Инсулин короткого действия", D: "Только препараты от давления", E: "Метформин + гликлазид" }, answer: "B" },
      { text: "План мониторинга в ПМСП", options: { A: "Контроль 1 раз в 6 месяцев", B: "Контроль АД, глюкозы, веса каждые 2 недели первые 1-2 месяца, затем 1 раз в 3 месяца", C: "Контроль только 1 раз в год", D: "Еженедельный контроль", E: "Только контроль HbA1c 1 раз в год" }, answer: "B" },
      { text: "Скрининг осложнений сахарного диабета", options: { A: "Только ЭКГ", B: "Офтальмолог, ACR + eGFR, оценка стоп и неврологический статус, ЭКГ/ЭхоКГ", C: "Только МРТ головного мозга", D: "Только УЗИ почек", E: "Только допплерография сосудов шеи" }, answer: "B" },
      { text: "Маршрутизация и показания к специалистам", options: { A: "Наблюдение только терапевтом", B: "Эндокринолог - в течение 7-10 дней; кардиолог - в течение 14 дней; офтальмолог - в течение 2 недель", C: "Направление в стационар", D: "Только к хирургу", E: "Направление к неврологу через 3 месяца" }, answer: "B" },
      { text: "Как лучше объяснить пациенту дальнейшие шаги", options: { A: "У вас диабет, будете колоть инсулин", B: "У вас выявился сахарный диабет 2 типа. Сейчас важно быстро нормализовать сахар и давление, чтобы не развились осложнения на глаза, почки и ноги. Начнем с таблеток, диеты и отказа от курения. Нужно пройти обследование у специалистов в ближайшие 2 недели", C: "Это не страшно, просто похудейте", E: "Ничего не объяснять, только выписать рецепты" }, answer: "B" }
    ],
    criteria: ["1 балл за каждый правильный ответ. Правильные ответы в файле отмечены черным."]
  }
];

const nursePreQuestions = [
  { id: 1, text: "Почему СД2 и АГ часто называют «тихими» заболеваниями?", options: { A: "Всегда протекают с болью", B: "Могут долго не давать жалоб", C: "Не требуют контроля" }, answer: "B" },
  { id: 2, text: "Что является первым действием медсестры у пациента 50 лет с ожирением и АД 148/92?", options: { A: "Назначить таблетки", B: "Измерить повторно/оценить риск/направить к врачу", C: "Ничего не делать" }, answer: "B" },
  { id: 3, text: "Какое значение АД соответствует АГ 1 степени?", options: { A: "120/80", B: "130/85", C: "140-159 и/или 90-99 мм рт. ст." }, answer: "C" },
  { id: 4, text: "FINDRISK используется для:", options: { A: "Постановки диагноза СД", B: "Оценки риска и отбора на лабораторный этап", C: "Подбора дозы метформина" }, answer: "B" },
  { id: 5, text: "Что нужно сделать перед измерением АД?", options: { A: "Дать пациенту отдохнуть 5 минут", B: "Измерять сразу после подъема по лестнице", C: "Попросить говорить во время измерения" }, answer: "A" },
  { id: 6, text: "Диагноз диабета ставится:", options: { A: "По жалобам", B: "Только по лабораторным критериям и подтверждению врачом", C: "По внешнему виду пациента" }, answer: "B" },
  { id: 7, text: "При АД 210/120 и боли за грудиной медсестра должна:", options: { A: "Записать на плановый прием", B: "Срочно организовать помощь/маршрутизацию", C: "Дать совет пить воду" }, answer: "B" },
  { id: 8, text: "К чему относится окружность талии?", options: { A: "К оценке абдоминального ожирения", B: "К диагностике анемии", C: "К оценке зрения" }, answer: "A" },
  { id: 9, text: "Что помогает повысить приверженность лечению?", options: { A: "Обвинять пациента", B: "Простой письменный план и уважительный разговор", C: "Отменить контроль" }, answer: "B" },
  { id: 10, text: "Что должна фиксировать медсестра в регистре скрининга?", options: { A: "Только имя", B: "Дату, АД, ИМТ/талию, FINDRISK/глюкозу, направление и дату возврата", C: "Ничего" }, answer: "B" }
];

const nursePostQuestions = [
  { id: 1, text: "Назовите 4 основных фактора риска СД2/АГ, которые должна активно выявлять медсестра.", options: { A: "Только курение и питание", B: "Возраст, ИМТ/окружность талии, семейный анамнез по СД2, повышенное АД", C: "Только уровень холестерина и гемоглобин", D: "Только физическая активность и стресс" }, answer: "B" },
  { id: 2, text: "Что такое FINDRISK?", options: { A: "Метод постановки окончательного диагноза СД2", B: "Инструмент (анкета) для оценки риска развития СД2 в ближайшие 10 лет", C: "Шкала для расчета дозы инсулина", D: "Метод определения стадии артериальной гипертензии" }, answer: "B" },
  { id: 3, text: "Назовите 3 важных правила правильного измерения артериального давления.", options: { A: "Измерять сразу после ходьбы, манжета любого размера, пациент может разговаривать", B: "Пациент отдыхает 5 минут, рука на уровне сердца, манжета соответствует размеру руки", C: "Измерять только на обеих руках одновременно, ноги скрещены", D: "Измерять сразу после приема пищи" }, answer: "B" },
  { id: 4, text: "При каком уровне офисного АД начинается диапазон артериальной гипертензии?", options: { A: ">=130/80 мм рт. ст.", B: ">=140 и/или >=90 мм рт. ст. (при подтверждении)", C: ">=160/100 мм рт. ст.", D: ">=120/80 мм рт. ст." }, answer: "B" },
  { id: 5, text: "Какой порог глюкозы плазмы натощак соответствует диабетическому диапазону?", options: { A: ">=5,6 ммоль/л", B: ">=7,0 ммоль/л (при подтверждении на повторном анализе)", C: ">=6,1 ммоль/л", D: ">=8,5 ммоль/л" }, answer: "B" },
  { id: 6, text: "Что должна сделать медсестра при выявлении АД 210/120 мм рт.ст. и боли за грудиной?", options: { A: "Записать пациента на плановый прием через неделю", B: "Организовать срочную маршрутизацию (вызвать врача или скорую помощь)", C: "Посоветовать пациенту выпить воды и отдохнуть", D: "Измерить АД еще раз через час" }, answer: "B" },
  { id: 7, text: "Почему медсестра не должна самостоятельно отменять препарат пациенту?", options: { A: "Потому что препараты дорогие", B: "Назначение и отмена терапии — зона ответственности врача", C: "Потому что пациенту всегда нужно продолжать лечение", D: "Потому что отмена препаратов запрещена законом" }, answer: "B" },
  { id: 8, text: "Какие 3 важных пункта обязательно должны быть в направлении к врачу?", options: { A: "Только ФИО и дата рождения", B: "Причина направления, объективные данные (АД, глюкоза, ИМТ, ОТ), дата возврата", C: "Только жалобы пациента", D: "Только список всех принимаемых лекарств" }, answer: "B" },
  { id: 9, text: "Как лучше спросить пациента о пропусках приема лекарств (без обвинения)?", options: { A: "Почему вы не принимаете таблетки как положено?", B: "Многие пациенты иногда пропускают таблетки. Как часто это бывает у вас?", C: "Вы вообще пьете то, что назначили?", D: "Вы понимаете, что без таблеток будет плохо?" }, answer: "B" },
  { id: 10, text: "Что означает термин «непрерывность наблюдения» в работе медсестры?", options: { A: "Пациент наблюдается только у узких специалистов", B: "Пациент не теряется после направления: есть контроль выполнения, дата возврата и фиксация результатов", C: "Наблюдение пациента только 1 раз в год", D: "Непрерывный прием всех назначенных препаратов" }, answer: "B" }
];

const remappedNursePostQuestions = nursePostQuestions.map((question, index) => {
  const orders = [
    ["B", "A", "C", "D"],
    ["A", "C", "B", "D"],
    ["A", "B", "D", "C"],
    ["C", "A", "D", "B"],
    ["D", "B", "A", "C"]
  ];
  return remapQuestionOptions(question, orders[index % orders.length]);
});

function createDefaultDb() {
  if (!INITIAL_ADMIN_PASSWORD) {
    throw new Error("INITIAL_ADMIN_PASSWORD is required when creating a new database");
  }
  const now = new Date().toISOString();
  const admins = seedAdmins.map((user) => ({
    ...user,
    passwordHash: hashPassword(INITIAL_ADMIN_PASSWORD),
    createdAt: now
  }));
  return {
    admins,
    doctors: [],
    nurseSurveys: [],
    doctorVisits: [],
    trainingParticipants: [],
    trainingAttempts: [],
    nurseTrainingParticipants: [],
    nurseTrainingAttempts: [],
    patientTasks: [],
    appointments: [],
    reminderQueue: [],
    messageEvents: [],
    activityEvents: [],
    sessions: {},
    settings: { createdAt: now }
  };
}

function createEmptyDb() {
  return {
    admins: [], doctors: [], nurseSurveys: [], doctorVisits: [],
    trainingParticipants: [], trainingAttempts: [],
    nurseTrainingParticipants: [], nurseTrainingAttempts: [],
    patientTasks: [], appointments: [], reminderQueue: [], messageEvents: [],
    activityEvents: [], sessions: {}, settings: {}
  };
}

async function pgPool() {
  if (!pgPoolPromise) {
    pgPoolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 5),
      connectionTimeoutMillis: PG_TIMEOUT_MS,
      idleTimeoutMillis: 30000,
      query_timeout: PG_TIMEOUT_MS,
      statement_timeout: PG_TIMEOUT_MS
    }));
  }
  return pgPoolPromise;
}

async function ensureDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = (DATABASE_URL ? ensureCloudDb() : ensureFileDb()).catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}

async function ensureFileDb() {
  await mkdir(dataDir, { recursive: true });
  if (existsSync(dbPath)) return;
  await writeFile(dbPath, JSON.stringify(createDefaultDb(), null, 2), "utf8");
}

async function ensureCloudDb() {
  const pool = await pgPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create table if not exists app_state (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_meta (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_settings (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_sessions (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    for (const table of Object.values(normalizedCollectionTables)) {
      await client.query(`create table if not exists ${table} (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    }
    await client.query(`create index if not exists idx_nurse_surveys_client_id on app_nurse_surveys ((data->>'clientSurveyId')) where (data->>'clientSurveyId') is not null`);
    await client.query(`create index if not exists idx_nurse_surveys_clinic on app_nurse_surveys ((data->'patient'->>'clinic'))`);
    await client.query(`create index if not exists idx_nurse_surveys_birth_date on app_nurse_surveys ((data->'patient'->>'birthDate'))`);
    await client.query(`create index if not exists idx_nurse_surveys_created_at on app_nurse_surveys ((data->>'createdAt'))`);
    await client.query(`create index if not exists idx_doctor_visits_survey_id on app_doctor_visits ((data->>'surveyId'))`);
    const schema = await client.query("select data from app_meta where id = $1", ["schema"]);
    if (!schema.rowCount) {
      const legacy = await client.query("select data from app_state where id = $1", ["main"]);
      let initialDb = legacy.rowCount ? legacy.rows[0].data : createDefaultDb();
      if (!legacy.rowCount && existsSync(dbPath)) {
        try {
          initialDb = JSON.parse(await readFile(dbPath, "utf8"));
        } catch {
          initialDb = createDefaultDb();
        }
      }
      await syncNormalizedCloudDb(client, initialDb);
      await client.query(
        "insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
        ["main", JSON.stringify(initialDb)]
      );
      await client.query("insert into app_meta (id, data) values ($1, $2::jsonb)", ["schema", JSON.stringify({ version: 2, migratedAt: new Date().toISOString() })]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const syncedItemHashes = new Map();
const syncedTableCounts = new Map();

function hashRecord(data) {
  return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
}

async function syncCloudCollection(client, table, values, dataSelector = (item) => item) {
  const rawRows = (Array.isArray(values) ? values : []).filter((item) => item?.id);
  const currentIds = new Set();
  const dirtyRows = [];

  for (const item of rawRows) {
    const id = String(item.id);
    currentIds.add(id);
    const data = dataSelector(item);
    const hash = hashRecord(data);
    const key = `${table}:${id}`;
    if (syncedItemHashes.get(key) !== hash) {
      dirtyRows.push({ id, data, hash, key });
    }
  }

  if (dirtyRows.length) {
    const batchSize = 500;
    for (let i = 0; i < dirtyRows.length; i += batchSize) {
      const batch = dirtyRows.slice(i, i + batchSize);
      await client.query(`
        insert into ${table} (id, data, updated_at)
        select item.id, item.data, now()
        from jsonb_to_recordset($1::jsonb) as item(id text, data jsonb)
        on conflict (id) do update set data = excluded.data, updated_at = now()
        where ${table}.data is distinct from excluded.data
      `, [JSON.stringify(batch.map((r) => ({ id: r.id, data: r.data })))]);
    }
    for (const r of dirtyRows) {
      syncedItemHashes.set(r.key, r.hash);
    }
  }

  const lastCount = syncedTableCounts.get(table);
  if (rawRows.length === 0) {
    if (lastCount && lastCount > 0) {
      await client.query(`delete from ${table}`);
      for (const key of Array.from(syncedItemHashes.keys())) {
        if (key.startsWith(`${table}:`)) syncedItemHashes.delete(key);
      }
    }
  } else if (lastCount !== undefined && rawRows.length < lastCount) {
    await client.query(`delete from ${table} where not (id = any($1::text[]))`, [Array.from(currentIds)]);
    for (const key of Array.from(syncedItemHashes.keys())) {
      if (key.startsWith(`${table}:`)) {
        const id = key.slice(table.length + 1);
        if (!currentIds.has(id)) syncedItemHashes.delete(key);
      }
    }
  }
  syncedTableCounts.set(table, rawRows.length);
}

async function syncNormalizedCloudDb(client, db) {
  for (const [key, table] of Object.entries(normalizedCollectionTables)) await syncCloudCollection(client, table, db[key]);
  const sessions = Object.entries(db.sessions || {}).map(([id, data]) => ({ id, data }));
  await syncCloudCollection(client, "app_sessions", sessions, (item) => item.data);
  const currentSettingsHash = hashRecord(db.settings || {});
  if (syncedItemHashes.get("app_settings:main") !== currentSettingsHash) {
    await client.query(`
      insert into app_settings (id, data, updated_at) values ('main', $1::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()
      where app_settings.data is distinct from excluded.data
    `, [JSON.stringify(db.settings || {})]);
    syncedItemHashes.set("app_settings:main", currentSettingsHash);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const expected = hashPassword(password, salt).split(":")[1];
    const bufA = Buffer.from(hash, "hex");
    const bufB = Buffer.from(expected, "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function readDb() {
  await ensureDb();
  if (dbCache) return dbCache;
  if (!dbLoadPromise) {
    dbLoadPromise = (async () => {
      const db = DATABASE_URL ? await readCloudDb() : JSON.parse(await readFile(dbPath, "utf8"));
      let changed = false;
      for (const key of ["trainingParticipants", "trainingAttempts", "nurseTrainingParticipants", "nurseTrainingAttempts", "patientTasks", "appointments", "reminderQueue", "messageEvents", "activityEvents"]) {
        if (!Array.isArray(db[key])) {
          db[key] = [];
          changed = true;
        }
      }
      if (!Array.isArray(db.admins) || !db.admins.length) {
        db.admins = createDefaultDb().admins;
        changed = true;
      }
      for (const seeded of seedAdmins) {
        const admin = db.admins.find((item) => item.id === seeded.id || item.username === seeded.username);
        if (!admin) continue;
        if (!admin.role) {
          admin.role = seeded.role;
          changed = true;
        }
        if (!admin.createdAt) {
          admin.createdAt = new Date().toISOString();
          changed = true;
        }
      }
      for (const admin of db.admins) {
        if (Object.hasOwn(admin, "passwordVisible")) {
          delete admin.passwordVisible;
          changed = true;
        }
      }
      for (const doctor of db.doctors || []) {
        if (Object.hasOwn(doctor, "accessKeyVisible")) {
          delete doctor.accessKeyVisible;
          changed = true;
        }
      }
      for (const survey of db.nurseSurveys || []) {
        const findriscScore = Number(survey.findrisc?.score ?? -1);
        if (findriscScore >= 0 && findriscScore < 14 && survey.findrisc?.highRisk) {
          survey.findrisc.highRisk = false;
          if (Array.isArray(survey.referralReasons)) {
            survey.referralReasons = survey.referralReasons.filter((r) => !r.startsWith("FINDRISC:"));
            survey.needsDoctor = survey.referralReasons.length > 0;
          }
          changed = true;
        }
      }
      dbCache = db;
      if (changed) await writeDb(db);
      return dbCache;
    })().finally(() => {
      dbLoadPromise = null;
    });
  }
  return dbLoadPromise;
}

async function writeDb(db) {
  dbCache = db;
  const body = JSON.stringify(db);
  if (DATABASE_URL) {
    const writeTask = dbWritePromise.catch(() => {}).then(async () => {
      const pool = await pgPool();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await syncNormalizedCloudDb(client, db);
        await client.query(
          "insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
          ["main", body]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
    dbWritePromise = writeTask;
    await writeTask;
    return;
  }
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  const writeTask = dbWritePromise.catch(() => {}).then(async () => {
    await writeFile(tmpPath, body, "utf8");
    await rename(tmpPath, dbPath);
  });
  dbWritePromise = writeTask;
  await writeTask;
}

async function readCloudDb() {
  const pool = await pgPool();
  const db = createEmptyDb();
  for (const [key, table] of Object.entries(normalizedCollectionTables)) {
    const result = await pool.query(`select data from ${table} order by id`);
    db[key] = result.rows.map((row) => row.data);
    for (const item of db[key]) {
      if (item?.id) syncedItemHashes.set(`${table}:${item.id}`, hashRecord(item));
    }
    syncedTableCounts.set(table, db[key].length);
  }
  const sessions = await pool.query("select id, data from app_sessions");
  db.sessions = Object.fromEntries(sessions.rows.map((row) => [row.id, row.data]));
  for (const [id, data] of Object.entries(db.sessions)) {
    syncedItemHashes.set(`app_sessions:${id}`, hashRecord(data));
  }
  syncedTableCounts.set("app_sessions", sessions.rowCount);
  const settings = await pool.query("select data from app_settings where id = 'main'");
  db.settings = settings.rowCount ? settings.rows[0].data : {};
  syncedItemHashes.set("app_settings:main", hashRecord(db.settings));
  return db;
}

async function databaseHealth() {
  if (!DATABASE_URL) return { mode: "file", ok: true };
  const startedAt = Date.now();
  const pool = await pgPool();
  await pool.query("select 1");
  return { mode: "postgres", ok: true, latencyMs: Date.now() - startedAt };
}

function isDatabaseError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "timeout",
    "database",
    "postgres",
    "connection",
    "econn",
    "enotfound",
    "authentication",
    "remaining connection slots",
    "terminating connection",
    "neon"
  ].some((part) => message.includes(part));
}

function send(res, status, payload, headers = {}) {
  const isBinary = Buffer.isBuffer(payload) || payload instanceof Uint8Array;
  const isJson = typeof payload !== "string" && !isBinary;
  let body = typeof payload === "string" || isBinary ? payload : JSON.stringify(payload);
  const acceptsGzip = String(res.req?.headers?.["accept-encoding"] || "").includes("gzip");
  const shouldCompress = isJson && acceptsGzip && Buffer.byteLength(body) >= 1024;
  if (shouldCompress) body = gzipSync(body);
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...(shouldCompress ? { "Content-Encoding": "gzip", "Vary": "Accept-Encoding" } : {}),
    ...securityHeaders(),
    ...headers
  });
  res.end(body);
}

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    const error = new Error("Размер запроса превышает допустимый лимит");
    error.statusCode = 413;
    throw error;
  }
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("Размер запроса превышает допустимый лимит");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Некорректный JSON");
    error.statusCode = 400;
    throw error;
  }
}

function clientIp(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown").trim();
}

const securityAlertState = new Map();
function queueSecurityAlert(req, event, details = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = securityAlertState.get(ip) || { count: 0, windowStartedAt: now, lastSentAt: 0 };
  if (now - current.windowStartedAt > 10 * 60 * 1000) { current.count = 0; current.windowStartedAt = now; }
  current.count += 1;
  securityAlertState.set(ip, current);
  if (current.count < 5 || now - current.lastSentAt < 30 * 60 * 1000) return;
  current.lastSentAt = now;
  Promise.resolve().then(async () => {
    if (!TELEGRAM_BOT_TOKEN) return;
    const db = await readDb();
    const chatId = String(db.settings?.dailyReports?.chatId || TELEGRAM_REPORT_CHAT_ID || "").trim();
    if (!chatId) return;
    const text = [`E-Clinic — предупреждение безопасности`, `Событие: ${event}`, `IP: ${ip}`, `Попыток за 10 минут: ${current.count}`, `Путь: ${String(req.url || "").split("?", 1)[0]}`, details.scope ? `Раздел: ${details.scope}` : ""].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
  }).catch((error) => console.error("Security alert failed:", error.message || error));
}

function securityEvent(event, req, details = {}) {
  const pathname = String(req.url || "").split("?", 1)[0] || "/";
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warning",
    category: "security",
    event,
    requestId: req.requestId || "unknown",
    ip: clientIp(req),
    method: req.method || "GET",
    path: pathname,
    ...details
  }));
  if (["rate_limited", "login_failed"].includes(event)) queueSecurityAlert(req, event, details);
}

function consumeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count <= limit) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function clearRateLimit(key) {
  rateLimits.delete(key);
}

function enforceLoginRateLimit(req, res, loginType) {
  const key = `login:${loginType}:${clientIp(req)}`;
  const result = consumeRateLimit(key, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (result.allowed) return key;
  securityEvent("rate_limited", req, { scope: "login", accountType: loginType, retryAfter: result.retryAfter });
  send(res, 429, { error: "Слишком много попыток входа. Повторите через минуту." }, { "Retry-After": String(result.retryAfter) });
  return "";
}

function enforceUserRateLimit(req, res, session, action, limit, windowMs) {
  const identity = session ? `${session.userType}:${session.userId}` : clientIp(req);
  const result = consumeRateLimit(`${action}:${identity}`, limit, windowMs);
  if (result.allowed) return true;
  securityEvent("rate_limited", req, { scope: action, accountType: session?.userType || "anonymous", retryAfter: result.retryAfter });
  send(res, 429, { error: "Слишком много запросов. Повторите позже." }, { "Retry-After": String(result.retryAfter) });
  return false;
}

function isTrustedStateChangingRequest(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) return true;
  // Public unauthenticated forms & endpoints must never be blocked by CSRF checks
  const path = (req.url || "").split("?")[0];
  if (
    path === "/api/nurse-surveys" ||
    path.startsWith("/api/nurse-training/") ||
    path.startsWith("/api/training/") ||
    path.startsWith("/api/login/") ||
    path.startsWith("/api/survey/") ||
    path.startsWith("/api/diabetes/")
  ) {
    return true;
  }
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const originHostname = originUrl.hostname.toLowerCase();
    if (
      originHostname === "e-clinic-control.ru" ||
      originHostname.endsWith(".e-clinic-control.ru") ||
      originHostname === "13.63.64.38" ||
      originHostname === "localhost" ||
      originHostname === "127.0.0.1"
    ) {
      return true;
    }
    const originHost = originUrl.host.toLowerCase();
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
    if (originHost && requestHost && (originHost === requestHost || originHostname === requestHost.split(":")[0])) {
      return true;
    }
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
    return false;
  } catch {
    return true;
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie?.split(";").map((item) => item.trim()) || [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto === "https") return true;
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = String(forwardedHost && forwardedHost !== "_" ? forwardedHost : req.headers.host || "")
    .split(":")[0]
    .toLowerCase();
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

function sessionCookie(req, sid, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

async function getSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;
  const db = await readDb();
  const session = db.sessions[sid];
  if (!session) return null;
  const createdAt = Date.parse(session.createdAt || "");
  const userExists = session.userType === "admin"
    ? db.admins.some((item) => item.id === session.userId)
    : session.userType === "doctor" && db.doctors.some((item) => item.id === session.userId);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= SESSION_TTL_MS || !userExists) {
    delete db.sessions[sid];
    await writeDb(db);
    return null;
  }
  return session;
}

async function createSession(userType, userId) {
  const db = await readDb();
  const sid = crypto.randomUUID();
  db.sessions[sid] = { userType, userId, createdAt: new Date().toISOString() };
  await writeDb(db);
  return sid;
}

async function clearSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return;
  const db = await readDb();
  delete db.sessions[sid];
  await writeDb(db);
}

function invalidateUserSessions(db, userType, userId) {
  for (const [sid, session] of Object.entries(db.sessions || {})) {
    if (session.userType === userType && session.userId === userId) delete db.sessions[sid];
  }
}

function publicDoctor(doctor) {
  const { accessKeyHash, accessKeyVisible, ...safe } = doctor;
  return safe;
}

function publicAdmin(admin) {
  const { passwordHash, passwordVisible, ...safe } = admin;
  safe.roleLabel = adminRoles[safe.role] || safe.role || "";
  return safe;
}

function clinicKey(value = "") {
  const text = String(value).trim().toLowerCase();
  const number = text.match(/\d+/)?.[0];
  return number || text.replace(/\s+/g, "");
}

function isValidUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function isExcludedClinic(value = "") {
  return ["3", "5", "6", "8", "13"].includes(clinicKey(value));
}

function allowedClinic(value, label = "Поликлиника") {
  const clinic = cleanText(value, label, { required: true, max: 100 });
  if (isExcludedClinic(clinic)) invalidInput(`${label}: поликлиника исключена из системы`);
  return clinic;
}

function doctorCanAccessSurvey(doctor, survey) {
  const doctorClinic = clinicKey(doctor?.clinic);
  const surveyClinic = clinicKey(survey?.patient?.clinic || survey?.clinic);
  return Boolean(doctorClinic && surveyClinic && doctorClinic === surveyClinic);
}

function adminRole(session, db) {
  if (!session || session.userType !== "admin") return "";
  const admin = db.admins.find((item) => item.id === session.userId);
  if (!admin) return "";
  // Older installations may have a single administrator without a role.
  // A sole administrator must retain owner access after the role migration.
  if (db.admins.length === 1) return "owner";
  return admin.role || "";
}

function canMutateAdmin(session, db) {
  return ["owner", "manager"].includes(adminRole(session, db));
}

function canManageAdmins(session, db) {
  return adminRole(session, db) === "owner";
}

function canCorrectSurvey(session, db, survey) {
  const role = adminRole(session, db);
  if (["owner", "manager"].includes(role)) return true;
  return role === "head_nurse" && adminCanAccessClinic(session, db, survey?.patient?.clinic || survey?.clinic);
}

function requireAdmin(session) {
  return session?.userType === "admin";
}

function compactCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function adminAccount(session, db) {
  if (!session || session.userType !== "admin") return null;
  return db.admins.find((admin) => admin.id === session.userId) || null;
}

function adminClinicScope(session, db) {
  const admin = adminAccount(session, db);
  return admin?.role === "head_nurse" ? clinicKey(admin.clinic) : "";
}

function adminCanAccessClinic(session, db, clinic) {
  const scope = adminClinicScope(session, db);
  return !scope || scope === clinicKey(clinic);
}

function scopedDbForAdmin(db, session) {
  const scope = adminClinicScope(session, db);
  if (!scope) return db;
  const surveys = (db.nurseSurveys || []).filter((survey) => clinicKey(survey.patient?.clinic || survey.clinic) === scope);
  const surveyIds = new Set(surveys.map((survey) => survey.id));
  const doctors = (db.doctors || []).filter((doctor) => clinicKey(doctor.clinic) === scope);
  const doctorIds = new Set(doctors.map((doctor) => doctor.id));
  const trainingParticipants = (db.trainingParticipants || []).filter((item) => clinicKey(item.clinic) === scope);
  const trainingIds = new Set(trainingParticipants.map((item) => item.id));
  const nurseTrainingParticipants = (db.nurseTrainingParticipants || []).filter((item) => clinicKey(item.clinic) === scope);
  const nurseTrainingIds = new Set(nurseTrainingParticipants.map((item) => item.id));
  return {
    ...db,
    doctors,
    nurseSurveys: surveys,
    doctorVisits: (db.doctorVisits || []).filter((visit) => surveyIds.has(visit.surveyId) || doctorIds.has(visit.doctorId)),
    patientTasks: (db.patientTasks || []).filter((item) => surveyIds.has(item.surveyId)),
    appointments: (db.appointments || []).filter((item) => surveyIds.has(item.surveyId)),
    reminderQueue: (db.reminderQueue || []).filter((item) => !item.surveyId || surveyIds.has(item.surveyId)),
    activityEvents: (db.activityEvents || []).filter((event) =>
      (["nurse", "doctor"].includes(event.actorRole) || event.actorId === session.userId) &&
      event.type !== "admin_login" && Boolean(event.surveyId) &&
      (clinicKey(event.clinic) === scope || surveyIds.has(event.surveyId))),
    trainingParticipants,
    trainingAttempts: (db.trainingAttempts || []).filter((item) => trainingIds.has(item.participantId)),
    nurseTrainingParticipants,
    nurseTrainingAttempts: (db.nurseTrainingAttempts || []).filter((item) => nurseTrainingIds.has(item.participantId)),
    admins: (db.admins || []).filter((admin) => admin.id === session.userId)
  };
}

function requestBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host || "").includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function calculateFindrisc(input) {
  const age = Number(input.age || 0);
  const bmi = Number(input.bmi || 0);
  const waist = Number(input.rabitoWaist || input.waist || 0);
  const sex = input.sex;
  let score = 0;
  if (age >= 45 && age <= 54) score += 2;
  if (age >= 55 && age <= 64) score += 3;
  if (age > 64) score += 4;
  if (bmi >= 25 && bmi < 30) score += 1;
  if (bmi >= 30) score += 3;
  if ((sex === "male" && waist >= 94 && waist <= 102) || (sex === "female" && waist >= 80 && waist <= 88)) score += 3;
  if ((sex === "male" && waist > 102) || (sex === "female" && waist > 88)) score += 4;
  if (input.activity === "no") score += 2;
  if (input.vegetables === "no") score += 1;
  if (input.bpMeds === "yes") score += 2;
  if (input.highGlucose === "yes") score += 5;
  if (input.familyDiabetes === "second") score += 3;
  if (input.familyDiabetes === "first") score += 5;
  const level = score < 7 ? "Низкий" : score < 12 ? "Слегка повышенный" : score < 15 ? "Умеренный" : score < 20 ? "Высокий" : "Очень высокий";
  return { score, level, highRisk: score >= 14 };
}

function calculateRabito(input) {
  const arm = Number(input.arm || 0);
  const waist = Number(input.rabitoWaist || input.waist || 0);
  const calf = Number(input.calf || 0);
  const sexCoef = input.sex === "male" ? 1 : 2;
  if (![arm, waist, calf].every((value) => Number.isFinite(value) && value > 0)) return null;
  return Number((0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241).toFixed(1));
}

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function cleanText(value, label, { required = false, max = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) invalidInput(`${label}: поле обязательно`);
  if (text.length > max) invalidInput(`${label}: превышена допустимая длина`);
  return text;
}

function cleanNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) invalidInput(`${label}: недопустимое значение`);
  return number;
}

function cleanEnum(value, label, allowed, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text && fallback) return fallback;
  if (!allowed.includes(text)) invalidInput(`${label}: недопустимое значение`);
  return text;
}

function cleanTextArray(value, label, { allowed = null, maxItems = 20, maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) invalidInput(`${label}: слишком много значений`);
  return value.map((item) => {
    const text = cleanText(item, label, { max: maxLength });
    if (allowed && !allowed.includes(text)) invalidInput(`${label}: недопустимое значение`);
    return text;
  });
}

function cleanPhone(value) {
  const phone = cleanText(value, "Телефон", { max: 30 });
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) invalidInput("Телефон: укажите от 7 до 15 цифр");
  if (!/^[+\d][\d\s()+-]*$/.test(phone)) invalidInput("Телефон: недопустимые символы");
  return phone;
}

function validateBloodPressure(systolic, diastolic) {
  if (!systolic && !diastolic) return;
  if (systolic < 70 || systolic > 260) invalidInput("Систолическое давление: допустимый диапазон 70–260");
  if (diastolic < 40 || diastolic > 160) invalidInput("Диастолическое давление: допустимый диапазон 40–160");
  if (systolic <= diastolic) invalidInput("Артериальное давление: верхнее значение должно быть больше нижнего");
}

function normalizePatientIdentity(patient = {}) {
  return [patient.lastName, patient.firstName, patient.middleName, patient.birthDate]
    .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function normalizePatientPhone(patient = {}) {
  return String(patient.phone || "").replace(/\D/g, "");
}

function extractBirthYear(dateStr) {
  if (!dateStr) return "";
  const match = String(dateStr).match(/^(\d{4})/);
  return match ? match[1] : "";
}

function findDuplicateSurvey(db, input) {
  if (input.allowDuplicate || input.force) return null;
  const inputBirthYear = extractBirthYear(input.birthDate);
  const identity = normalizePatientIdentity(input);
  const clinic = clinicKey(input.clinic);
  const phone = normalizePatientPhone(input);
  if (!phone) return null;
  return (db.nurseSurveys || []).find((survey) => {
    if (survey.archivedAt) return false;
    if (clinicKey(survey.patient?.clinic || survey.clinic) !== clinic) return false;
    const existingBirthYear = extractBirthYear(survey.patient?.birthDate);
    if (inputBirthYear && existingBirthYear && inputBirthYear !== existingBirthYear) {
      return false;
    }
    return (
      normalizePatientIdentity(survey.patient) === identity &&
      normalizePatientPhone(survey.patient) === phone
    );
  });
}

function patientReportPdf(survey, visits, tasks) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 46, size: "A4", info: { Title: `Медицинский отчет: ${patientNameFromSurvey(survey)}` } });
    const fontCandidates = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
    const font = fontCandidates.find(existsSync);
    if (font) doc.font(font);
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const line = (label, value) => doc.fontSize(10).text(`${label}: ${value ?? "—"}`, { paragraphGap: 4 });
    doc.fontSize(18).text("Медицинский отчет пациента", { align: "center" }).moveDown();
    line("Пациент", patientNameFromSurvey(survey));
    line("Дата рождения", survey.patient?.birthDate);
    line("Поликлиника", survey.patient?.clinic || survey.clinic);
    line("Телефон", survey.patient?.phone);
    doc.moveDown().fontSize(14).text("Последняя анкета").moveDown(0.4);
    line("Рост, см", survey.measurements?.height || "—");
    if (survey.measurements?.weight > 0) line("Измеренный вес, кг", survey.measurements.weight);
    if (survey.measurements?.rabitoWeight > 0) line("Расчётный вес Rabito, кг", survey.measurements.rabitoWeight);
    line("Индекс массы тела", survey.measurements?.bmi || "—");
    line("Артериальное давление", `${survey.measurements?.systolic || "—"}/${survey.measurements?.diastolic || "—"}`);
    line("Уровень сахара", survey.measurements?.glucoseLevel);
    line("FINDRISC", `${survey.findrisc?.score ?? "—"} — ${survey.findrisc?.level || "—"}`);
    line("Сердечно-сосудистый риск", `${survey.score2?.percent ?? "—"}% — ${survey.score2?.level || "—"}`);
    doc.moveDown().fontSize(14).text("Осмотры врача").moveDown(0.4);
    if (!visits.length) doc.fontSize(10).text("Осмотров пока нет.");
    for (const visit of visits.slice(-20).reverse()) {
      doc.fontSize(11).text(new Date(visit.createdAt).toLocaleDateString("ru-RU"), { continued: true }).text(` — ${visit.diagnosis || "Диагноз не указан"}`);
      if (visit.notes) doc.fontSize(9).fillColor("#444").text(visit.notes).fillColor("black");
    }
    doc.moveDown().fontSize(14).text("Повторные визиты").moveDown(0.4);
    if (!tasks.length) doc.fontSize(10).text("Назначенных повторных визитов нет.");
    for (const task of tasks.slice(-20).reverse()) line(new Date(task.dueAt).toLocaleDateString("ru-RU"), task.status === "completed" ? "Выполнено" : task.title || "Запланировано");
    doc.moveDown().fontSize(8).fillColor("#666").text(`Сформировано ${new Date().toLocaleString("ru-RU")}. Документ предназначен для медицинского работника.`);
    doc.end();
  });
}

function validatePatientProfileInput(body, existing = {}) {
  const birthDate = cleanText(body.birthDate ?? existing.birthDate, "Дата рождения", { required: true, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(`${birthDate}T00:00:00Z`)) || birthDate > new Date().toISOString().slice(0, 10)) invalidInput("Дата рождения: недопустимое значение");
  return {
    ...existing,
    lastName: cleanText(body.lastName ?? existing.lastName, "Фамилия", { required: true, max: 100 }),
    firstName: cleanText(body.firstName ?? existing.firstName, "Имя", { required: true, max: 100 }),
    middleName: cleanText(body.middleName ?? existing.middleName, "Отчество", { max: 100 }),
    birthDate,
    phone: cleanPhone(body.phone ?? existing.phone),
    address: cleanText(body.address ?? existing.address, "Адрес", { max: 300 }),
    clinic: allowedClinic(body.clinic ?? existing.clinic),
    sex: cleanEnum(body.sex ?? existing.sex, "Пол", ["male", "female"]),
    reminderConsent: body.reminderConsent === true || body.reminderConsent === "true",
    reminderChannel: cleanEnum(body.reminderChannel ?? existing.reminderChannel ?? "none", "Канал напоминаний", ["none", "sms", "telegram"], "none"),
    telegramChatId: cleanText(body.telegramChatId ?? existing.telegramChatId, "Telegram Chat ID", { max: 50 })
  };
}

function validateNewPassword(value, label = "Новый пароль") {
  const password = cleanText(value, label, { required: true, max: 200 });
  if (password.length < 5) invalidInput(`${label}: минимум 5 символов`);
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) invalidInput(`${label}: добавьте буквы и цифры`);
  return password;
}

function validateSurveyInput(body, clinicOverride = "") {
  const birthDate = cleanText(body.birthDate, "Дата рождения", { required: true, max: 10 });
  const parsedBirthDate = Date.parse(`${birthDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(parsedBirthDate) || parsedBirthDate > Date.now() || birthDate < "1900-01-01") {
    invalidInput("Дата рождения: недопустимое значение");
  }
  if (body.weight !== undefined && body.weight !== null && typeof body.weight !== "number" && typeof body.weight !== "string") {
    invalidInput("Вес: недопустимое значение");
  }
  const rawWeight = typeof body.weight === "string" ? body.weight.trim().replace(",", ".") : body.weight;
  const hasMeasuredWeight = rawWeight !== undefined && rawWeight !== null && rawWeight !== "";
  const weight = hasMeasuredWeight ? cleanNumber(rawWeight, "Вес", { min: 0, max: 500 }) : 0;
  if (hasMeasuredWeight && weight <= 0) {
    invalidInput("Вес: укажите значение больше 0 и не больше 500 кг");
  }
  const height = hasMeasuredWeight && typeof body.height === "string" ? body.height.trim().replace(",", ".") : body.height;
  const input = {
    lastName: cleanText(body.lastName, "Фамилия", { required: true, max: 100 }),
    firstName: cleanText(body.firstName, "Имя", { required: true, max: 100 }),
    middleName: cleanText(body.middleName, "Отчество", { max: 100 }),
    birthDate,
    phone: cleanPhone(body.phone),
    address: cleanText(body.address, "Адрес", { max: 300 }),
    clinic: allowedClinic(clinicOverride || body.clinic),
    nurseName: cleanText(body.nurseName || body.nurseFullName, "ФИО медсестры", { max: 100 }),
    sex: cleanEnum(body.sex, "Пол", ["male", "female"]),
    age: cleanNumber(body.age, "Возраст", { min: 0, max: 120 }),
    weight,
    height: cleanNumber(height, "Рост", { min: 0, max: 250 }),
    bmi: hasMeasuredWeight ? 0 : cleanNumber(body.bmi, "Индекс массы тела", { min: 0, max: 100 }),
    systolic: cleanNumber(body.systolic, "Систолическое давление", { min: 0, max: 300 }),
    diastolic: cleanNumber(body.diastolic, "Диастолическое давление", { min: 0, max: 200 }),
    arm: cleanNumber(body.arm, "Окружность плеча", { min: 0, max: 200 }),
    rabitoWaist: cleanNumber(body.rabitoWaist || body.waist, "Окружность талии", { min: 0, max: 300 }),
    calf: cleanNumber(body.calf, "Окружность голени", { min: 0, max: 200 }),
    glucoseLevel: cleanNumber(body.glucoseLevel, "Уровень сахара", { min: 0, max: 50 }),
    activity: cleanEnum(body.activity, "Физическая активность", ["yes", "no"]),
    vegetables: cleanEnum(body.vegetables, "Овощи и фрукты", ["yes", "no"]),
    bpMeds: cleanEnum(body.bpMeds, "Препараты от давления", ["yes", "no"]),
    highGlucose: cleanEnum(body.highGlucose, "Высокий сахар", ["yes", "no"]),
    familyDiabetes: cleanEnum(body.familyDiabetes, "Диабет у родственников", ["none", "second", "first"]),
    smoker: cleanEnum(body.smoker, "Курение", ["yes", "no"]),
    allowDuplicate: Boolean(body.allowDuplicate || body.force)
  };
  if (hasMeasuredWeight) {
    if (input.height <= 0) invalidInput("Рост: укажите значение больше 0 для расчёта индекса массы тела");
    if (input.rabitoWaist <= 0) invalidInput("Окружность талии: укажите значение больше 0 для расчёта FINDRISC");
    input.bmi = cleanNumber(Number((weight / ((input.height / 100) ** 2)).toFixed(1)), "Индекс массы тела", { min: 0, max: 100 });
  }
  validateBloodPressure(input.systolic, input.diastolic);
  if (input.glucoseLevel && (input.glucoseLevel < 1.5 || input.glucoseLevel > 35)) invalidInput("Уровень сахара: допустимый диапазон 1,5–35");
  return input;
}

function validateNurseSurveyInput(body) {
  const input = validateSurveyInput(body);
  if (input.nurseName.trim().split(/\s+/).filter(Boolean).length < 2) {
    invalidInput("ФИО медсестры: обязательно укажите фамилию и имя");
  }
  if (!input.phone) invalidInput("Телефон пациента: обязательное поле");
  return input;
}

function cleanLabDate(value, label, required = false) {
  const text = cleanText(value, label, { required, max: 10 });
  if (text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text || text > dushanbeClock().date)) invalidInput(`${label}: недопустимая дата`);
  return text;
}

function validateVisitInput(body) {
  const laboratoryTests = Array.isArray(body.laboratoryTests) ? body.laboratoryTests : [];
  if (laboratoryTests.length > 20) invalidInput("Лабораторные анализы: слишком много значений");
  const input = {
    surveyId: cleanText(body.surveyId, "Пациент", { required: true, max: 100 }),
    weight: cleanNumber(body.weight, "Вес", { min: 0, max: 500 }),
    height: cleanNumber(body.height, "Рост", { min: 0, max: 250 }),
    bmi: cleanNumber(body.bmi, "Индекс массы тела", { min: 0, max: 100 }),
    glucose: cleanNumber(body.glucose, "Уровень сахара", { min: 0, max: 50 }),
    glucoseType: cleanEnum(body.glucoseType, "Тип измерения сахара", ["fasting", "random", "postMeal", "hba1c"], "fasting"),
    diagnosis: cleanText(body.diagnosis, "Диагноз", { max: 500 }),
    systolic: cleanNumber(body.systolic, "Систолическое давление", { min: 0, max: 300 }),
    diastolic: cleanNumber(body.diastolic, "Диастолическое давление", { min: 0, max: 200 }),
    followUpDays: cleanNumber(body.followUpDays, "Срок повторного осмотра", { min: 0, max: 3650 }),
    laboratoryTests: laboratoryTests.map((item) => ({
      test: cleanText(item?.test || item?.name, "Название анализа", { required: true, max: 100 }),
      status: item?.status === 'ordered' ? 'ordered' : labHasResult(item || {}) ? 'received' : 'ordered',
      orderedDate: cleanLabDate(item?.orderedDate || dushanbeClock().date, 'Дата назначения'),
      resultDate: cleanLabDate(item?.resultDate, 'Дата результата'),
      result: cleanText(item?.result, "Результат анализа", { max: 200 }),
      fields: Object.fromEntries(Object.entries(item?.fields && typeof item.fields === "object" ? item.fields : {}).slice(0, 20).map(([key, value]) => [
        cleanText(key, "Поле анализа", { required: true, max: 100 }),
        cleanText(value, "Значение анализа", { max: 200 })
      ]))
    })),
    referrals: cleanTextArray(body.referrals, "Направления", { maxItems: 20 }),
    treatmentPlan: cleanText(body.treatmentPlan, "План лечения", { max: 3000 }),
    diabetesDrugs: cleanTextArray(body.diabetesDrugs, "Препараты от диабета", { allowed: diabetesDrugs, maxItems: 20 }),
    hypertensionDrugs: cleanTextArray(body.hypertensionDrugs, "Препараты от давления", { allowed: hypertensionDrugs, maxItems: 20 }),
    lifestyleRecommendations: cleanTextArray(body.lifestyleRecommendations, "Рекомендации", { allowed: ["diabetesDiet", "physicalActivity"], maxItems: 2 })
  };
  validateBloodPressure(input.systolic, input.diastolic);
  if (input.glucose && (input.glucose < 1.5 || input.glucose > 35)) invalidInput("Уровень сахара: допустимый диапазон 1,5–35");
  for (const lab of input.laboratoryTests) {
    if (lab.status === 'ordered' && labHasResult(lab)) invalidInput('Для анализа с результатом выберите «Результат получен»');
    if (lab.status === 'received' && !lab.resultDate) invalidInput('Укажите дату полученного результата анализа');
  }
  return input;
}

function calculateScore2Lite(input) {
  const age = Number(input.age || 0);
  const systolic = Number(input.systolic || 0);
  const sex = input.sex;
  const smoker = input.smoker === "yes";
  let points = 0;
  if (age >= 50) points += 1;
  if (age >= 60) points += 2;
  if (age >= 70) points += 2;
  if (systolic >= 140) points += 1;
  if (systolic >= 160) points += 1;
  if (systolic >= 180) points += 1;
  if (smoker) points += 2;
  if (sex === "male") points += 1;
  const score = points;
  const percent = Math.min(30, Math.max(1, points * 2));
  const level = points <= 2 ? "Низкий" : points <= 4 ? "Умеренный" : "Высокий";
  return {
    score,
    percent,
    level,
    highRisk: points >= 5 || systolic >= 140,
    note: "Упрощённый скрининговый индекс сердечно-сосудистого риска (возраст, пол, САД, курение по нелабораторной шкале ВОЗ). Не заменяет лабораторную шкалу SCORE2 (без липидограммы)."
  };
}

function referralReasons(input, findrisc, score2) {
  const reasons = [];
  const systolic = Number(input.systolic || 0);
  const score2Factors = [];
  if (Number(input.age || 0) >= 50) score2Factors.push("возраст");
  if (input.sex === "male") score2Factors.push("мужской пол");
  if (input.smoker === "yes") score2Factors.push("курение");
  if (systolic >= 140) score2Factors.push("повышенное САД");
  if (findrisc.highRisk) reasons.push(`FINDRISC: ${findrisc.score} баллов (${findrisc.level})`);
  if (score2.highRisk) reasons.push(`Сердечно-сосудистый риск: ${score2.level} (индекс: ${score2.score ?? score2.percent})${score2Factors.length ? `; факторы: ${score2Factors.join(", ")}` : ""}`);
  if (systolic >= 140) reasons.push(`Систолическое АД: ${systolic} мм рт.ст.`);
  return reasons;
}

function buildNurseSurvey(body) {
  const findrisc = calculateFindrisc(body);
  const rabitoWeight = calculateRabito(body);
  const score2 = calculateScore2Lite(body);
  const reasons = referralReasons(body, findrisc, score2);
  const survey = {
    id: crypto.randomUUID(),
    patient: {
      lastName: body.lastName,
      firstName: body.firstName,
      middleName: body.middleName,
      birthDate: body.birthDate,
      phone: body.phone,
      address: body.address,
      clinic: body.clinic,
      sex: body.sex
    },
    nurse: {
      fullName: body.nurseName || body.nurseFullName || "",
      source: body.nurseName || body.nurseFullName ? "survey" : ""
    },
    measurements: {
      age: Number(body.age || 0),
      weight: Number(body.weight || 0),
      weightSource: Number(body.weight || 0) > 0 ? "measured" : rabitoWeight > 0 ? "rabito" : "",
      height: Number(body.height || 0),
      bmi: Number(body.bmi || 0),
      systolic: Number(body.systolic || 0),
      diastolic: Number(body.diastolic || 0),
      arm: Number(body.arm || 0),
      waist: Number(body.rabitoWaist || body.waist || 0),
      rabitoWaist: Number(body.rabitoWaist || body.waist || 0),
      calf: Number(body.calf || 0),
      rabitoWeight,
      glucoseLevel: Number(body.glucoseLevel || 0)
    },
    answers: body,
    findrisc,
    score2,
    referralReasons: reasons,
    needsDoctor: reasons.length > 0,
    createdAt: new Date().toISOString()
  };
  survey.qualityWarnings = qualityFlagsForSurvey(survey);
  return survey;
}

function appendActivity(db, event) {
  db.activityEvents ||= [];
  db.activityEvents.push({
    id: crypto.randomUUID(),
    type: event.type,
    actorRole: event.actorRole || "",
    actorId: event.actorId || "",
    actorName: event.actorName || "",
    clinic: event.clinic || "",
    surveyId: event.surveyId || "",
    visitId: event.visitId || "",
    patientName: event.patientName || "",
    details: event.details || "",
    createdAt: new Date().toISOString()
  });
  if (db.activityEvents.length > 5000) db.activityEvents = db.activityEvents.slice(-5000);
}

const surveyCorrectionLabels = {
  activity: "Физическая активность",
  vegetables: "Овощи и фрукты",
  bpMeds: "Препараты от давления",
  highGlucose: "Ранее повышенный сахар",
  familyDiabetes: "Диабет у родственников",
  smoker: "Курение",
  systolic: "Систолическое давление",
  diastolic: "Диастолическое давление"
  , clinic: "Поликлиника"
};

function correctionActivityDetails(changes = []) {
  const fields = changes.map((change) => surveyCorrectionLabels[change.field] || change.field).filter(Boolean);
  return fields.length ? `Исправлены поля анкеты: ${fields.join(", ")}` : "Исправлены ответы анкеты";
}

function patientNameFromSurvey(survey) {
  return [survey?.patient?.lastName, survey?.patient?.firstName, survey?.patient?.middleName].filter(Boolean).join(" ");
}

function publicParticipant(participant) {
  return {
    id: participant.id,
    fullName: participant.fullName,
    clinic: participant.clinic,
    specialty: participant.specialty,
    createdAt: participant.createdAt || null,
    preCompletedAt: participant.preCompletedAt || null,
    postCompletedAt: participant.postCompletedAt || null
  };
}

function shuffle(values) {
  return [...values].sort(() => crypto.randomInt(0, 1000000) - 500000);
}

function preQuestionsForParticipant(participant) {
  if (!Array.isArray(participant.preQuestionIds) || participant.preQuestionIds.length !== 10) {
    participant.preQuestionIds = shuffle(preTestQuestions.map((question) => question.id)).slice(0, 10);
  }
  return participant.preQuestionIds
    .map((id) => preTestQuestions.find((question) => question.id === id))
    .filter(Boolean)
    .map(({ answer, ...question }) => question);
}

function publicQuestions(questions = preTestQuestions) {
  return questions.map(({ answer, ...question }) => question);
}

function scoreTest(questionIds, answers = {}) {
  let correct = 0;
  const details = questionIds.map((id) => {
    const question = preTestQuestions.find((item) => item.id === Number(id));
    const selected = answers[id] || answers[String(id)] || "";
    const isCorrect = question?.answer === selected;
    if (isCorrect) correct += 1;
    return {
      questionId: Number(id),
      questionText: question?.text || "",
      options: question?.options || {},
      selected,
      selectedText: question?.options?.[selected] || "",
      correctAnswer: question?.answer,
      correctText: question?.options?.[question?.answer] || "",
      isCorrect
    };
  });
  return { correct, total: questionIds.length, percent: Math.round((correct / questionIds.length) * 100), details };
}

function scoreQuestionSet(questions, answers = {}) {
  let correct = 0;
  const details = questions.map((question) => {
    const selected = answers[question.id] || answers[String(question.id)] || "";
    const isCorrect = selected === question.answer;
    if (isCorrect) correct += 1;
    return {
      questionId: question.id,
      questionText: question.text,
      options: question.options,
      selected,
      selectedText: question.options?.[selected] || "",
      correctAnswer: question.answer,
      correctText: question.options?.[question.answer] || "",
      isCorrect
    };
  });
  const total = questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, passed: percent >= 70, details };
}

function remapQuestionOptions(question, order) {
  const letters = ["A", "B", "C", "D"];
  const entries = order.map((oldLetter, index) => [letters[index], question.options[oldLetter]]).filter(([, text]) => text);
  return {
    ...question,
    options: Object.fromEntries(entries),
    answer: entries.find(([newLetter, text]) => text === question.options[question.answer])?.[0] || question.answer
  };
}

function publicNurseParticipant(participant) {
  return {
    id: participant.id,
    fullName: participant.fullName,
    clinic: participant.clinic,
    position: participant.position || "",
    createdAt: participant.createdAt || null,
    preCompletedAt: participant.preCompletedAt || null,
    postCompletedAt: participant.postCompletedAt || null
  };
}

function publicNurseQuestions(type) {
  const questions = type === "post" ? remappedNursePostQuestions : nursePreQuestions;
  return questions.map(({ answer, ...question }) => question);
}

function enrichTrainingAttempt(attempt) {
  if (!attempt) return attempt;
  if (attempt.type === "task") return {
    ...attempt,
    task: postTrainingTasks.find((task) => task.id === attempt.taskId) || null
  };
  const instrument = attempt.type === "post" ? "Инструмент 3" : "Инструмент 2";
  const title = attempt.type === "post" ? "Тест после обучения для оценки итогового уровня знаний" : "Тест до обучения для оценки исходного уровня знаний";
  return {
    ...attempt,
    instrument,
    title,
    details: (attempt.details || []).map((detail) => {
      const question = preTestQuestions.find((item) => item.id === Number(detail.questionId));
      return {
        ...detail,
        questionText: detail.questionText || question?.text || "",
        options: detail.options || question?.options || {},
        selectedText: detail.selectedText || question?.options?.[detail.selected] || "",
        correctText: detail.correctText || question?.options?.[detail.correctAnswer || question?.answer] || "",
        correctAnswer: detail.correctAnswer || question?.answer || ""
      };
    })
  };
}

function attemptsForParticipant(db, participantId) {
  return db.trainingAttempts
    .filter((attempt) => attempt.participantId === participantId)
    .map(enrichTrainingAttempt);
}

function publicPostTasks() {
  return postTrainingTasks.map((task) => ({
    ...task,
    fields: task.fields?.map(([name, label]) => [name, label]),
    cases: task.cases?.map((item) => Array.isArray(item) ? item[0] : item),
    questions: task.questions?.map(({ answer, ...question }) => question)
  }));
}

function scorePostTask(task, answers = {}) {
  let correct = 0;
  const details = [];
  if (task.mode === "findrisc") {
    for (const [name, label, expected] of task.fields || []) {
      const selected = String(answers[name] || "").trim();
      const isCorrect = selected.toLowerCase() === String(expected).trim().toLowerCase();
      if (isCorrect) correct += 1;
      details.push({ label, selected, correctAnswer: expected, isCorrect });
    }
  } else if (task.mode === "singleCases") {
    for (const [index, item] of (task.cases || []).entries()) {
      const [caseText, expected] = item;
      const selected = answers[`case${index}`] || "";
      const isCorrect = selected === expected;
      if (isCorrect) correct += 1;
      details.push({ label: caseText, selected, correctAnswer: expected, isCorrect });
    }
  } else if (task.mode === "routing") {
    for (const [index, item] of (task.cases || []).entries()) {
      const [caseText, specialist, urgency] = item;
      const selectedSpecialist = answers[`case${index}`]?.specialist || "";
      const selectedUrgency = answers[`case${index}`]?.urgency || "";
      const specialistCorrect = selectedSpecialist === specialist;
      const urgencyCorrect = selectedUrgency === urgency;
      if (specialistCorrect) correct += 1;
      if (urgencyCorrect) correct += 1;
      details.push({ label: caseText, selected: `${selectedSpecialist}, ${selectedUrgency}`, correctAnswer: `${specialist}, ${urgency}`, isCorrect: specialistCorrect && urgencyCorrect });
    }
  } else if (task.mode === "mcq") {
    for (const [index, question] of (task.questions || []).entries()) {
      const selected = answers[`q${index}`] || "";
      const isCorrect = selected === question.answer;
      if (isCorrect) correct += 1;
      details.push({
        label: question.text,
        selected,
        selectedText: question.options?.[selected] || "",
        correctAnswer: question.answer,
        correctText: question.options?.[question.answer] || "",
        isCorrect
      });
    }
  }
  return { correct, total: task.maxScore, percent: Math.round((correct / task.maxScore) * 100), details };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      return send(res, 200, {
        ok: true,
        server: true,
        database: await databaseHealth()
      });
    } catch (error) {
      console.error("Health check failed:", error);
      return send(res, 503, {
        ok: false,
        server: true,
        database: {
          mode: DATABASE_URL ? "postgres" : "file",
          ok: false,
          error: error.message || "Database unavailable"
        }
      });
    }
  }

  const session = await getSession(req);
  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/server-info") {
    const urls = getLanUrls();
    const currentBaseUrl = requestBaseUrl(req);
    const isLocalRequest = /(^https?:\/\/localhost\b)|(^https?:\/\/127\.0\.0\.1\b)|(^https?:\/\/\[::1\])/.test(currentBaseUrl);
    const preferredBaseUrl = isLocalRequest
      ? urls.find((item) => !item.includes("localhost")) || urls[0]
      : currentBaseUrl;
    return send(res, 200, {
      urls,
      apps: {
        admin: `${preferredBaseUrl}${ADMIN_APP_PATH}`,
        doctor: `${preferredBaseUrl}${DOCTOR_APP_PATH}`,
        survey: `${preferredBaseUrl}${SURVEY_APP_PATH}`
        , training: `${preferredBaseUrl}${TRAINING_APP_PATH}`,
        nurseTraining: `${preferredBaseUrl}${NURSE_TRAINING_APP_PATH}`,
        investor: `${preferredBaseUrl}${INVESTOR_APP_PATH}`,
        monitor: `${preferredBaseUrl}${MONITOR_APP_PATH}`
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login/admin") {
    const rateLimitKey = enforceLoginRateLimit(req, res, "admin");
    if (!rateLimitKey) return;
    const body = await parseBody(req);
    const admin = db.admins.find((item) => item.username === body.username);
    if (!admin || !verifyPassword(body.password || "", admin.passwordHash)) {
      securityEvent("login_failed", req, { accountType: "admin" });
      return send(res, 401, { error: "Неверный логин или пароль" });
    }
    clearRateLimit(rateLimitKey);
    appendActivity(db, {
      type: "admin_login",
      actorRole: admin.role || (db.admins.length === 1 ? "owner" : "admin"),
      actorId: admin.id,
      actorName: admin.name || admin.username,
      clinic: admin.clinic || "",
      details: "Вход в аккаунт"
    });
    await writeDb(db);
    const sid = await createSession("admin", admin.id);
    securityEvent("login_succeeded", req, { accountType: "admin", actorId: admin.id });
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, sid) });
  }

  if (req.method === "POST" && url.pathname === "/api/login/doctor") {
    const rateLimitKey = enforceLoginRateLimit(req, res, "doctor");
    if (!rateLimitKey) return;
    const body = await parseBody(req);
    const doctor = db.doctors.find((item) => item.login === body.login);
    if (!doctor || !verifyPassword(body.accessKey || "", doctor.accessKeyHash)) {
      securityEvent("login_failed", req, { accountType: "doctor" });
      return send(res, 401, { error: "Неверный логин или ключ" });
    }
    clearRateLimit(rateLimitKey);
    const sid = await createSession("doctor", doctor.id);
    securityEvent("login_succeeded", req, { accountType: "doctor", actorId: doctor.id });
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, sid) });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    securityEvent("logout", req, { accountType: session?.userType || "anonymous", actorId: session?.userId || null });
    await clearSession(req);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    if (!session) return send(res, 200, { user: null });
    if (session.userType === "admin") {
      const admin = db.admins.find((item) => item.id === session.userId);
      return send(res, 200, { user: { type: "admin", id: admin.id, name: admin.name, role: admin.role, clinic: admin.clinic || "" } });
    }
    const doctor = db.doctors.find((item) => item.id === session.userId);
    return send(res, 200, { user: { type: "doctor", id: doctor.id, name: doctor.fullName, specialty: doctor.specialty, clinic: doctor.clinic } });
  }

  if (["GET", "POST"].includes(req.method) && url.pathname === "/api/admin/dashboard") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const requestBody = req.method === "POST" ? await parseBody(req) : {};
    const tab = url.searchParams.get("tab") || requestBody.tab || "stats";
    if (req.method === "POST" && !["audit", "surveys"].includes(tab)) return send(res, 405, { error: "POST доступен только для поиска" });
    if (tab === "headNurses" && !canManageAdmins(session, db)) return send(res, 403, { error: "Раздел доступен только главному администратору" });
    const viewDb = scopedDbForAdmin(db, session);
    const diabetesDrugCounts = countSelected(viewDb.doctorVisits.flatMap((visit) => visit.diabetesDrugs || []));
    const hypertensionDrugCounts = countSelected(viewDb.doctorVisits.flatMap((visit) => visit.hypertensionDrugs || []));
    const dashboard = {
      stats: buildStats(viewDb),
      canEdit: canMutateAdmin(session, db),
      canCorrectSurveys: ["owner", "manager", "head_nurse"].includes(adminRole(session, db)),
      canManageAdmins: canManageAdmins(session, db),
      adminRoles,
      drugStats: { diabetesDrugCounts, hypertensionDrugCounts },
      trainingStats: buildTrainingStats(viewDb),
      nurseTrainingStats: buildNurseTrainingStats(viewDb),
      clinicScope: adminClinicScope(session, db)
    };
    if (tab === "control" || tab === "center") {
      dashboard.careControl = buildCareControl(viewDb);
      if (!canManageAdmins(session, db)) dashboard.careControl.dailyReports.chatId = "";
    }
    if (tab === "doctors") dashboard.doctors = viewDb.doctors.map(publicDoctor);
    if (tab === "training") {
      dashboard.trainingParticipants = viewDb.trainingParticipants.map(publicParticipant);
      dashboard.trainingAttempts = viewDb.trainingAttempts.map(enrichTrainingAttempt);
    }
    if (tab === "nurseTraining") {
      dashboard.nurseTrainingParticipants = viewDb.nurseTrainingParticipants.map(publicNurseParticipant);
      dashboard.nurseTrainingAttempts = viewDb.nurseTrainingAttempts;
    }
    if (tab === "surveys") {
      const pageSize = 50;
      const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get("page") || requestBody.page || "1", 10) || 1);
      const selectedClinic = String(url.searchParams.get("clinic") || requestBody.clinic || "all").trim();
      const searchQuery = String(url.searchParams.get("search") || requestBody.search || "").trim().toLocaleLowerCase("ru-RU");

      const allSurveys = viewDb.nurseSurveys || [];
      const clinics = [...new Set(allSurveys.map((survey) => survey.patient?.clinic || survey.clinic).filter(Boolean))]
        .filter((clinic) => clinic && !isExcludedClinic(clinic))
        .sort((a, b) => clinicKey(a).localeCompare(clinicKey(b), "ru", { numeric: true }));

      const filtered = allSurveys
        .filter((survey) => !isExcludedClinic(survey.patient?.clinic || survey.clinic))
        .filter((survey) => selectedClinic === "all" || (survey.patient?.clinic || survey.clinic) === selectedClinic)
        .filter((survey) => {
          if (!searchQuery) return true;
          const patient = survey.patient || {};
          return [
            patient.lastName,
            patient.firstName,
            patient.middleName,
            patient.birthDate,
            patient.phone,
            patient.address,
            patient.clinic
          ].some((val) => String(val || "").toLocaleLowerCase("ru-RU").includes(searchQuery));
        })
        .sort((a, b) => {
          const clinicA = a.patient?.clinic || a.clinic || "";
          const clinicB = b.patient?.clinic || b.clinic || "";
          const clinicCompare = clinicKey(clinicA).localeCompare(clinicKey(clinicB), "ru", { numeric: true });
          if (clinicCompare) return clinicCompare;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });

      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = Math.min(requestedPage, pageCount);
      const start = (page - 1) * pageSize;
      const pageItems = filtered.slice(start, start + pageSize);

      dashboard.surveys = pageItems.map((survey) => ({
        id: survey.id,
        patient: survey.patient || {},
        measurements: survey.measurements || {},
        findrisc: survey.findrisc || {},
        score2: survey.score2 || {},
        needsDoctor: Boolean(survey.needsDoctor),
        referralReasons: survey.referralReasons || [],
        createdAt: survey.createdAt,
        archivedAt: survey.archivedAt || null
      }));
      dashboard.surveyClinics = clinics;
      dashboard.surveysTotal = filtered.length;
      dashboard.surveysPage = page;
      dashboard.surveysPageCount = pageCount;
      dashboard.surveysPageSize = pageSize;
    }
    if (tab === "visits") {
      dashboard.visits = viewDb.doctorVisits;
      dashboard.doctors = viewDb.doctors.map(({ id, fullName, clinic }) => ({ id, fullName, clinic }));
      dashboard.surveys = viewDb.nurseSurveys.map(({ id, patient }) => ({
        id,
        patient: { lastName: patient?.lastName, firstName: patient?.firstName, middleName: patient?.middleName, clinic: patient?.clinic }
      }));
    }
    if (tab === "operations") {
      dashboard.surveyClinics = [...new Set(viewDb.nurseSurveys.map((survey) => survey.patient?.clinic || survey.clinic).filter(Boolean))];
      dashboard.reminderQueue = viewDb.reminderQueue || [];
      dashboard.clinicTargets = db.settings?.clinicTargets || {};
    }
    if (tab === "audit") {
      const pageSize = 50;
      const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
      const selectedClinic = String(url.searchParams.get("clinic") || "all").trim();
      const searchQuery = String(requestBody.search || "").trim().toLocaleLowerCase("ru-RU");
      const sourceEvents = viewDb.activityEvents || [];
      const clinics = [...new Set(sourceEvents.map((event) => String(event.clinic || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ru-RU", { numeric: true }));
      const filteredEvents = sourceEvents.filter((event) => {
        if (selectedClinic !== "all" && String(event.clinic || "").trim() !== selectedClinic) return false;
        if (!searchQuery) return true;
        return [event.patientName, event.actorName, event.clinic, event.details, event.type]
          .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(searchQuery));
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const pageCount = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
      const page = Math.min(requestedPage, pageCount);
      const start = (page - 1) * pageSize;
      dashboard.activityEvents = filteredEvents.slice(start, start + pageSize);
      dashboard.auditClinics = clinics;
      dashboard.auditTotal = filteredEvents.length;
      dashboard.auditPage = page;
      dashboard.auditPageCount = pageCount;
      dashboard.auditPageSize = pageSize;
    }
    if (tab === "headNurses") {
      const accounts = db.admins.filter((admin) => admin.role === "head_nurse");
      const accountIds = new Set(accounts.map((admin) => admin.id));
      const events = (db.activityEvents || [])
        .filter((event) => accountIds.has(event.actorId))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      dashboard.headNurseActivity = {
        accounts: accounts.map((admin) => {
          const accountEvents = events.filter((event) => event.actorId === admin.id);
          return {
            ...publicAdmin(admin),
            lastLoginAt: accountEvents.find((event) => event.type === "admin_login")?.createdAt || null,
            lastActivityAt: accountEvents[0]?.createdAt || null,
            changesCount: accountEvents.filter((event) => event.type !== "admin_login").length
          };
        }),
        events: events.slice(0, 2000)
      };
    }
    if (tab === "access") dashboard.admins = (canManageAdmins(session, db) ? db.admins : viewDb.admins).map(publicAdmin);
    return send(res, 200, dashboard);
  }

  if (req.method === "GET" && url.pathname === "/api/admin/care-control.xls") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const report = buildCareControlExcel(scopedDbForAdmin(db, session));
    return send(res, 200, report, {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-control-${dateKey(new Date().toISOString())}.xls"`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/backup") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может создавать резервные копии" });
    const status = await createSecureBackup(db, "manual");
    return send(res, 201, { status });
  }

  if (req.method === 'GET' && url.pathname === '/api/doctor/waiting-patients') {
    if (session?.userType !== 'doctor') return send(res, 403, { error: 'Нет доступа' });
    const doctor = db.doctors.find(item => item.id === session.userId);
    return send(res, 200, { patients: waitingPatients(db).filter(row => clinicKey(row.clinic) === clinicKey(doctor?.clinic)) });
  }

  if (req.method === 'PUT' && url.pathname === '/api/patient-outreach') {
    if (!session) return send(res, 403, { error: 'Нет доступа' });
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find(item => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: 'Пациент не найден' });
    const actor = session.userType === 'doctor' ? db.doctors.find(item => item.id === session.userId) : adminAccount(session, db);
    const allowed = session.userType === 'doctor' ? doctorCanAccessSurvey(actor, survey)
      : canMutateAdmin(session, db) || (actor?.role === 'head_nurse' && adminCanAccessClinic(session, db, survey.patient?.clinic || survey.clinic));
    if (!allowed) return send(res, 403, { error: 'Нет доступа' });
    const status = cleanEnum(body.status, 'Статус контакта', ['pending', 'called', 'scheduled', 'declined']);
    const before = survey.outreach?.status || 'pending';
    survey.outreach = { status, updatedAt: new Date().toISOString(), actorId: session.userId };
    survey.changeHistory ||= [];
    survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: survey.outreach.updatedAt, actorId: session.userId,
      actorName: actor?.fullName || actor?.name || '', changes: [{ field: 'outreach', before, after: status }] });
    appendActivity(db, { type: 'patient_outreach', actorRole: session.userType, actorId: session.userId, actorName: actor?.fullName || actor?.name || '',
      surveyId: survey.id, patientName: patientNameFromSurvey(survey), clinic: survey.patient?.clinic || survey.clinic, details: `Контакт с пациентом: ${status}` });
    await writeDb(db);
    return send(res, 200, { outreach: survey.outreach });
  }

  if (req.method === 'PUT' && url.pathname === '/api/doctor/lab-result') {
    if (session?.userType !== 'doctor') return send(res, 403, { error: 'Нет доступа' });
    const body = await parseBody(req);
    const visit = db.doctorVisits.find(item => item.id === body.visitId);
    const survey = db.nurseSurveys.find(item => item.id === visit?.surveyId);
    const actor = db.doctors.find(item => item.id === session.userId);
    if (!visit || !survey || !doctorCanAccessSurvey(actor, survey)) return send(res, 403, { error: 'Нет доступа к анализу' });
    const index = Number(body.index);
    const previous = Number.isInteger(index) && index >= 0 ? visit.laboratoryTests?.[index] : null;
    if (!previous) return send(res, 404, { error: 'Анализ не найден' });
    const result = cleanText(body.result, 'Результат', { required: true, max: 200 });
    const resultDate = cleanLabDate(body.resultDate, 'Дата результата', true);
    const updated = { ...previous, result, resultDate, status: 'received' };
    visit.laboratoryTests[index] = updated;
    survey.changeHistory ||= [];
    survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId: actor.id, actorName: actor.fullName,
      changes: patientChanges(previous, updated).map(change => ({ ...change, field: `${previous.test}: ${change.field}` })) });
    await writeDb(db);
    return send(res, 200, { visit });
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/daily-reports") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может настраивать отчёты" });
    const body = await parseBody(req);
    db.settings ||= {};
    db.settings.dailyReports = {
      enabled: Boolean(body.enabled),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time || "")) ? String(body.time) : "18:00",
      chatId: cleanText(body.chatId, "Telegram Chat ID", { max: 50 }),
      timezone: "Asia/Dushanbe",
      lastSentDate: db.settings.dailyReports?.lastSentDate || ""
    };
    await writeDb(db);
    return send(res, 200, { settings: { ...db.settings.dailyReports, tokenConfigured: Boolean(TELEGRAM_BOT_TOKEN) } });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/daily-reports/test") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может отправлять тестовый отчёт" });
    const body = await parseBody(req);
    const result = await sendTelegramReport(scopedDbForAdmin(db, session), body.chatId);
    return send(res, 200, result);
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/account") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const admin = db.admins.find((item) => item.id === session.userId);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const body = await parseBody(req);
    const currentPassword = cleanText(body.currentPassword, "Текущий пароль", { required: true, max: 200 });
    if (!verifyPassword(currentPassword, admin.passwordHash)) return send(res, 401, { error: "Текущий пароль указан неверно" });
    const newPassword = validateNewPassword(body.newPassword);
    if (verifyPassword(newPassword, admin.passwordHash)) return send(res, 400, { error: "Новый пароль должен отличаться от текущего" });
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    invalidateUserSessions(db, "admin", admin.id);
    appendActivity(db, {
      type: "admin_password_changed",
      actorRole: "admin",
      actorId: admin.id,
      actorName: admin.name,
      details: "Администратор изменил свой пароль; старые сеансы завершены"
    });
    await writeDb(db);
    return send(res, 200, { ok: true, currentSessionEnded: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/clinic-targets") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав" });
    const body = await parseBody(req);
    const clinic = allowedClinic(body.clinic);
    db.settings.clinicTargets ||= {};
    db.settings.clinicTargets[clinic] = {
      monthlyPatients: Math.max(0, Number(body.monthlyPatients || 0)),
      monthlyVisits: Math.max(0, Number(body.monthlyVisits || 0)),
      followUpCompletionPercent: Math.min(100, Math.max(0, Number(body.followUpCompletionPercent || 0)))
    };
    await writeDb(db);
    return send(res, 200, { targets: db.settings.clinicTargets });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/admin/patients/")) {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Анкета пациента не найдена" });
    if (!adminCanAccessClinic(session, db, survey.patient?.clinic || survey.clinic)) return send(res, 403, { error: "Нет доступа к этой поликлинике" });
    return send(res, 200, {
      survey,
      visits: (db.doctorVisits || []).filter((item) => item.surveyId === id),
      tasks: (db.patientTasks || []).filter((item) => item.surveyId === id),
      events: (db.activityEvents || []).filter((item) => item.surveyId === id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      nextAction: buildCareControl(db).registry.find((item) => item.id === id)?.nextAction || "Наблюдение по плану"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/patients/import") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для импорта" });
    const body = await parseBody(req);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    if (!rows.length) return send(res, 400, { error: "Передайте строки CSV/Excel" });
    const imported = [], skipped = [], errors = [];
    for (const [index, row] of rows.entries()) {
      try {
        const input = validateSurveyInput({
          ...row,
          sex: row.sex === "male" || row.sex === "Мужской" ? "male" : "female",
          age: Number(row.age || 0), weight: row.weight === "" ? undefined : Number(row.weight || 0), height: row.height === "" ? undefined : Number(row.height || 0),
          clinic: allowedClinic(row.clinic), nurseName: row.nurseName || "Импорт из файла", activity: row.activity || "no", vegetables: row.vegetables || "no", bpMeds: row.bpMeds || "no", highGlucose: row.highGlucose || "no", familyDiabetes: row.familyDiabetes || "none", smoker: row.smoker || "no"
        });
        const duplicate = findDuplicateSurvey(db, input);
        if (duplicate) { skipped.push({ row: index + 2, reason: "Дубликат", duplicateId: duplicate.id }); continue; }
        const survey = buildNurseSurvey(input);
        db.nurseSurveys.push(survey);
        imported.push({ row: index + 2, id: survey.id, patientName: patientNameFromSurvey(survey) });
      } catch (error) { errors.push({ row: index + 2, error: String(error.message || error) }); }
    }
    if (imported.length) { appendActivity(db, { type: "patients_imported", actorRole: "admin", actorId: session.userId, actorName: adminAccount(session, db)?.name || "", details: `Импортировано пациентов: ${imported.length}` }); await writeDb(db); }
    return send(res, 200, { imported, skipped, errors });
  }

  if (req.method === "PUT" && /^\/api\/admin\/patients\/[^/]+\/answers$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').at(-2));
    const survey = db.nurseSurveys.find(item => item.id === id);
    if (!survey) return send(res, 404, { error: "Анкета не найдена" });
    if (!canCorrectSurvey(session, db, survey)) return send(res, 403, { error: "Можно исправлять только анкеты своей поликлиники" });
    const body = await parseBody(req);
    const input = { ...survey.answers, ...survey.measurements, ...survey.patient };
    const changes = [];
    for (const field of ['activity', 'vegetables', 'bpMeds', 'highGlucose', 'familyDiabetes', 'smoker', 'systolic', 'diastolic']) {
      if (body[field] === undefined) continue;
      const value = ['systolic', 'diastolic'].includes(field)
        ? cleanNumber(body[field], field, { min: 1, max: field === 'systolic' ? 300 : 200 })
        : cleanEnum(body[field], field, field === 'familyDiabetes' ? ['none', 'second', 'first'] : ['yes', 'no']);
      if (input[field] !== value) changes.push({ field, before: input[field] ?? '', after: value });
      input[field] = value;
    }
    if (body.clinic !== undefined) {
      const clinic = allowedClinic(body.clinic);
      if (adminRole(session, db) === "head_nurse" && !adminCanAccessClinic(session, db, clinic)) {
        return send(res, 403, { error: "Старшая медсестра может оставить только свою поликлинику" });
      }
      const previousClinic = survey.patient?.clinic || survey.clinic || "";
      if (previousClinic !== clinic) changes.push({ field: "clinic", before: previousClinic, after: clinic });
      survey.patient ||= {};
      survey.patient.clinic = clinic;
      survey.clinic = clinic;
    }
    validateBloodPressure(input.systolic, input.diastolic);
    if (changes.length) {
      const answerChanges = changes.filter((item) => item.field !== "clinic");
      if (answerChanges.length) {
        survey.answers = { ...survey.answers, ...Object.fromEntries(answerChanges.map(item => [item.field, item.after])) };
        survey.measurements.systolic = input.systolic;
        survey.measurements.diastolic = input.diastolic;
        survey.findrisc = calculateFindrisc(input);
        survey.score2 = calculateScore2Lite(input);
        survey.referralReasons = referralReasons(input, survey.findrisc, survey.score2);
        survey.needsDoctor = survey.referralReasons.length > 0;
        survey.qualityWarnings = qualityFlagsForSurvey(survey);
      }
      survey.updatedAt = new Date().toISOString();
      survey.changeHistory ||= [];
      survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: survey.updatedAt, actorId: session.userId, actorName: adminAccount(session, db)?.name || '', changes });
      appendActivity(db, { type: 'survey_answers_corrected', actorRole: adminRole(session, db), actorId: session.userId, actorName: adminAccount(session, db)?.name || '', surveyId: id, clinic: survey.patient.clinic, patientName: patientNameFromSurvey(survey), details: correctionActivityDetails(changes) });
      await writeDb(db);
    }
    return send(res, 200, { survey });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/patients/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    const body = await parseBody(req);
    const updatedPatient = validatePatientProfileInput(body, survey.patient || {});
    const changes = patientChanges(survey.patient || {}, updatedPatient);
    survey.patient = updatedPatient;
    if (changes.length) {
      survey.changeHistory ||= [];
      survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId: session.userId,
        actorName: adminAccount(session, db)?.name || '', changes });
    }
    survey.updatedAt = new Date().toISOString();
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "patient_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: survey.patient.clinic, surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: "Обновлена карточка пациента" });
    await writeDb(db);
    return send(res, 200, { survey });
  }

  if (req.method === "POST" && url.pathname.endsWith("/archive") && url.pathname.startsWith("/api/admin/patients/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    const body = await parseBody(req);
    survey.archivedAt = body.archived ? new Date().toISOString() : null;
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: survey.archivedAt ? "patient_archived" : "patient_restored", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: survey.patient?.clinic || "", surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: survey.archivedAt ? "Карточка пациента архивирована" : "Карточка пациента восстановлена" });
    await writeDb(db);
    return send(res, 200, { survey });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/patients/merge") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const sourceId = cleanText(body.sourceId, "Дубликат", { required: true, max: 100 });
    const targetId = cleanText(body.targetId, "Основная карточка", { required: true, max: 100 });
    if (sourceId === targetId) return send(res, 400, { error: "Выберите две разные карточки" });
    const source = db.nurseSurveys.find((item) => item.id === sourceId);
    const target = db.nurseSurveys.find((item) => item.id === targetId);
    if (!source || !target) return send(res, 404, { error: "Одна из карточек не найдена" });
    if (clinicKey(source.patient?.clinic) !== clinicKey(target.patient?.clinic)) return send(res, 400, { error: "Объединять можно только пациентов одной поликлиники" });
    for (const collection of [db.doctorVisits, db.patientTasks, db.appointments, db.reminderQueue]) {
      for (const item of collection || []) if (item.surveyId === sourceId) item.surveyId = targetId;
    }
    source.archivedAt = new Date().toISOString();
    source.mergedIntoId = targetId;
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "patient_merged", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: target.patient?.clinic || "", surveyId: targetId, patientName: patientNameFromSurvey(target), details: `Объединена карточка-дубликат ${sourceId}` });
    await writeDb(db);
    return send(res, 200, { source, target });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/admins") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const password = validateNewPassword(body.password, "Пароль");
    const role = adminRoles[body.role] ? body.role : "observer";
    const clinic = role === "head_nurse" ? allowedClinic(body.clinic) : "";
    if (!name || !username || !password) return send(res, 400, { error: "ФИО, логин и пароль обязательны" });
    if (db.admins.some((admin) => admin.username === username)) return send(res, 409, { error: "Такой логин уже используется" });
    const admin = {
      id: crypto.randomUUID(),
      name,
      username,
      role,
      clinic,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    db.admins.push(admin);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_created", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Создан администратор: ${admin.name}; роль: ${admin.role}` });
    await writeDb(db);
    return send(res, 201, { admin: publicAdmin(admin) });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/admins/")) {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const admin = db.admins.find((item) => item.id === id);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const role = adminRoles[body.role] ? body.role : admin.role;
    const clinic = role === "head_nurse" ? allowedClinic(body.clinic || admin.clinic) : "";
    if (!name || !username) return send(res, 400, { error: "ФИО и логин обязательны" });
    if (db.admins.some((item) => item.id !== admin.id && item.username === username)) return send(res, 409, { error: "Такой логин уже используется" });
    const ownerCount = db.admins.filter((item) => item.role === "owner").length;
    if (admin.role === "owner" && role !== "owner" && ownerCount <= 1) return send(res, 400, { error: "Нельзя оставить систему без главного администратора" });
    admin.name = name;
    admin.username = username;
    admin.role = role;
    admin.clinic = clinic;
    if (password) {
      admin.passwordHash = hashPassword(validateNewPassword(password, "Новый пароль"));
      invalidateUserSessions(db, "admin", admin.id);
    }
    admin.updatedAt = new Date().toISOString();
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Изменён администратор: ${admin.name}; роль: ${admin.role}${password ? "; пароль сброшен" : ""}` });
    await writeDb(db);
    return send(res, 200, { admin: publicAdmin(admin), currentSessionEnded: Boolean(password && admin.id === session.userId) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/admins/")) {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    if (id === session.userId) return send(res, 400, { error: "Нельзя удалить свой текущий доступ" });
    const admin = db.admins.find((item) => item.id === id);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const ownerCount = db.admins.filter((item) => item.role === "owner").length;
    if (admin.role === "owner" && ownerCount <= 1) return send(res, 400, { error: "Нельзя удалить последнего главного администратора" });
    db.admins = db.admins.filter((item) => item.id !== id);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_deleted", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Удалён администратор: ${admin.name}` });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/training-answer-keys.csv") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    return send(res, 200, buildTrainingAnswerKeysCsv(), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="doctor-training-answer-keys-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/investor/dashboard") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Требуется вход администратора" });
    return send(res, 200, buildInvestorDashboard(db));
  }

  if (req.method === "GET" && url.pathname === "/api/investor/report.csv") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Требуется вход администратора" });
    return send(res, 200, buildInvestorReportCsv(db), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-investor-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/minzdrav/geo-dashboard") {
    return send(res, 200, buildMinzdravGeoDashboard(db));
  }

  if (req.method === "GET" && url.pathname === "/api/minzdrav/report.csv") {
    return send(res, 200, buildMinzdravReportCsv(db), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-minzdrav-ncd-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/monitor/dashboard") {
    return send(res, 200, buildOperationsMonitor(db, Object.fromEntries(url.searchParams)));
  }

  if (req.method === "GET" && url.pathname === "/api/monitor/report.csv") {
    const report = buildOperationsReportCsv(db, Object.fromEntries(url.searchParams));
    return send(res, 200, report, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-monitor-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

const weeklyDocxCache = new Map();
function getWeeklyDocxCache(key) {
  const item = weeklyDocxCache.get(key);
  if (item && item.expiresAt > Date.now()) return item.buffer;
  return null;
}
function setWeeklyDocxCache(key, buffer) {
  weeklyDocxCache.set(key, { buffer, expiresAt: Date.now() + 60000 });
}

  if (req.method === "GET" && url.pathname === "/api/monitor/weekly-report.docx") {
    const rateCheck = consumeRateLimit(`weekly_docx:${clientIp(req)}`, 10, 60000);
    if (!rateCheck.allowed) {
      return send(res, 429, { error: "Слишком много запросов на формирование отчёта. Подождите минуту." }, { "Retry-After": String(rateCheck.retryAfter) });
    }
    const period = monitorReportPeriod(Object.fromEntries(url.searchParams));
    const cacheKey = `${period.from}_${period.to}`;
    let report = getWeeklyDocxCache(cacheKey);
    if (!report) {
      report = await buildWeeklyMonitorReportDocx(db, period, {
        buildRows: buildPublicOperationsMonitorRows,
        dateKey,
        clinicKey
      });
      setWeeklyDocxCache(cacheKey, report);
    }
    return send(res, 200, report, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="e-clinic-weekly-${period.from}-${period.to}.docx"`,
      "Cache-Control": "no-store"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/training-participants") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const participant = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      clinic: allowedClinic(body.clinic),
      specialty: body.specialty || "",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.trainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicParticipant(participant) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/training-participants/") && url.pathname.includes("/attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const [, , , , participantId, , phase] = url.pathname.split("/");
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!["pre", "post"].includes(phase)) return send(res, 400, { error: "Неверный тип теста" });
    db.trainingAttempts = db.trainingAttempts.filter((attempt) => {
      if (attempt.participantId !== participantId) return true;
      if (phase === "pre") return attempt.type !== "pre";
      return attempt.type !== "task" && attempt.type !== "post";
    });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/training-participants/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    db.trainingParticipants = db.trainingParticipants.filter((participant) => participant.id !== id);
    db.trainingAttempts = db.trainingAttempts.filter((attempt) => attempt.participantId !== id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/nurse-training-participants") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const participant = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      clinic: allowedClinic(body.clinic),
      position: body.position || "Медсестра",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.nurseTrainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicNurseParticipant(participant) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/nurse-training-participants/") && url.pathname.includes("/attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const [, , , , participantId, , phase] = url.pathname.split("/");
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!["pre", "post"].includes(phase)) return send(res, 400, { error: "Неверный тип теста" });
    db.nurseTrainingAttempts = db.nurseTrainingAttempts.filter((attempt) =>
      attempt.participantId !== participantId || attempt.type !== phase
    );
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/nurse-training-participants/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    db.nurseTrainingParticipants = db.nurseTrainingParticipants.filter((participant) => participant.id !== id);
    db.nurseTrainingAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.participantId !== id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/doctors") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    if (db.doctors.some((item) => item.login === String(body.login || "").trim())) return send(res, 409, { error: "Такой логин уже используется" });
    const accessKey = body.accessKey ? validateNewPassword(body.accessKey, "Пароль врача") : `${crypto.randomBytes(6).toString("base64url")}7a`;
    const doctor = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      login: body.login,
      accessKeyHash: hashPassword(accessKey),
      passport: body.passport,
      clinic: allowedClinic(body.clinic),
      specialty: body.specialty,
      experienceYears: Number(body.experienceYears || 0),
      createdAt: new Date().toISOString()
    };
    db.doctors.push(doctor);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_created", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor.clinic, details: `Создан профиль врача: ${doctor.fullName}` });
    await writeDb(db);
    return send(res, 201, { doctor: publicDoctor(doctor), accessKey });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = url.pathname.split("/").pop();
    const doctor = db.doctors.find((item) => item.id === id);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const login = body.login === undefined ? doctor.login : String(body.login || "").trim();
    if (login !== doctor.login && db.doctors.some((item) => item.id !== doctor.id && item.login === login)) return send(res, 409, { error: "Такой логин уже используется" });
    Object.assign(doctor, {
      fullName: body.fullName ?? doctor.fullName,
      login,
      passport: body.passport ?? doctor.passport,
      clinic: body.clinic === undefined ? doctor.clinic : allowedClinic(body.clinic),
      specialty: body.specialty ?? doctor.specialty,
      experienceYears: body.experienceYears === undefined ? doctor.experienceYears : Number(body.experienceYears || 0)
    });
    if (body.accessKey) {
      doctor.accessKeyHash = hashPassword(validateNewPassword(body.accessKey, "Новый пароль врача"));
      invalidateUserSessions(db, "doctor", doctor.id);
    }
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor.clinic, details: `Изменён профиль врача: ${doctor.fullName}${body.accessKey ? "; пароль сброшен" : ""}` });
    await writeDb(db);
    return send(res, 200, { doctor: publicDoctor(doctor) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    const doctor = db.doctors.find((item) => item.id === id);
    db.doctors = db.doctors.filter((item) => item.id !== id);
    invalidateUserSessions(db, "doctor", id);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_deleted", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor?.clinic || "", details: `Удалён профиль врача: ${doctor?.fullName || id}` });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/nurse-surveys") {
    const rawBody = await parseBody(req);
    const clientSurveyId = cleanText(rawBody.clientSurveyId, "ID анкеты", { max: 100 });
    if (clientSurveyId && isValidUuid(clientSurveyId)) {
      const existing = (db.nurseSurveys || []).find((s) => s.clientSurveyId === clientSurveyId || s.id === clientSurveyId);
      if (existing) {
        return send(res, 200, { ok: true, alreadySaved: true, id: existing.id });
      }
    }
    const body = validateNurseSurveyInput(rawBody);
    if (clientSurveyId && isValidUuid(clientSurveyId)) body.clientSurveyId = clientSurveyId;
    const duplicate = findDuplicateSurvey(db, body);
    if (duplicate) return send(res, 409, { error: "Пациент с такими ФИО, датой рождения и телефоном уже существует в этой поликлинике", duplicateId: duplicate.id, duplicate: true });
    const survey = buildNurseSurvey(body);
    if (clientSurveyId && isValidUuid(clientSurveyId)) {
      survey.id = clientSurveyId;
      survey.clientSurveyId = clientSurveyId;
    }
    db.nurseSurveys.push(survey);
    appendActivity(db, {
      type: "nurse_survey_created",
      actorRole: "nurse",
      actorName: survey.nurse?.fullName || "Медсестра не указана",
      clinic: survey.patient?.clinic || survey.clinic || "",
      surveyId: survey.id,
      patientName: patientNameFromSurvey(survey),
      details: survey.needsDoctor ? "Анкета отправлена, нужен врач" : "Анкета отправлена"
    });
    await writeDb(db);
    return send(res, 201, { survey });
  }

  if (req.method === "GET" && url.pathname === "/api/doctor/workspace") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const doctorClinicKey = clinicKey(doctor?.clinic);
    const clinicSurveys = db.nurseSurveys
      .filter((survey) => !survey.archivedAt && clinicKey(survey.patient?.clinic || survey.clinic) === doctorClinicKey)
      .map((survey) => {
        const { answers, ...safe } = survey;
        return safe;
      });
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    let resultSurveys = clinicSurveys;
    let pagination = null;
    if (pageParam || limitParam) {
      const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(limitParam || "50", 10) || 50));
      const total = clinicSurveys.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const start = (page - 1) * limit;
      resultSurveys = clinicSurveys.slice(start, start + limit);
      pagination = { page, limit, total, totalPages };
    }
    return send(res, 200, {
      doctor: doctor ? publicDoctor(doctor) : null,
      surveys: resultSurveys,
      ...(pagination ? { pagination } : {}),
      visits: db.doctorVisits.filter((visit) => visit.doctorId === session.userId),
      tasks: (db.patientTasks || []).filter((task) => task.doctorId === session.userId),
      appointments: (db.appointments || []).filter((item) => item.doctorId === session.userId),
      dictionaries: { diabetesDrugs, hypertensionDrugs }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/appointments") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!doctor || !survey || survey.archivedAt) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const startsAt = new Date(body.startsAt);
    if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date()) return send(res, 400, { error: "Укажите будущую дату и время" });
    const appointment = { id: crypto.randomUUID(), surveyId: survey.id, doctorId: doctor.id, startsAt: startsAt.toISOString(), status: "scheduled", note: cleanText(body.note, "Комментарий", { max: 500 }), createdAt: new Date().toISOString() };
    db.appointments.push(appointment);
    const patient = survey.patient || {};
    const channel = patient.reminderConsent ? patient.reminderChannel : "none";
    const recipient = channel === "telegram" ? patient.telegramChatId : patient.phone;
    const reminder = { id: crypto.randomUUID(), surveyId: survey.id, appointmentId: appointment.id, channel, recipientMasked: recipient ? `***${String(recipient).slice(-4)}` : "", message: `Напоминание о приеме ${startsAt.toLocaleString("ru-RU")}`, scheduledAt: new Date(startsAt.getTime() - 86400000).toISOString(), status: channel !== "none" && recipient ? "queued" : "blocked", reason: channel !== "none" && recipient ? "Ожидает подключения поставщика сообщений" : "Нет согласия или контакта", createdAt: new Date().toISOString() };
    db.reminderQueue.push(reminder);
    appendActivity(db, { type: "appointment_created", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: `Прием назначен на ${startsAt.toISOString()}` });
    await writeDb(db);
    return send(res, 201, { appointment, reminder });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/doctor/appointments/")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const appointment = db.appointments.find((item) => item.id === id && item.doctorId === session.userId);
    if (!appointment) return send(res, 404, { error: "Запись не найдена" });
    const body = await parseBody(req);
    if (!["scheduled", "arrived", "completed", "no_show", "cancelled"].includes(body.status)) return send(res, 400, { error: "Некорректный статус" });
    appointment.status = body.status;
    appointment.updatedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { appointment });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/doctor/patients/") && url.pathname.endsWith("/report.pdf")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!doctor || !survey || !doctorCanAccessSurvey(doctor, survey)) return send(res, 404, { error: "Пациент не найден" });
    const pdf = await patientReportPdf(survey, db.doctorVisits.filter((item) => item.surveyId === id), db.patientTasks.filter((item) => item.surveyId === id));
    return send(res, 200, pdf, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="patient-${id}.pdf"` });
  }

  if (req.method === "PUT" && url.pathname === "/api/doctor/account") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const login = cleanText(body.login, "Логин", { required: true, max: 100 });
    const currentAccessKey = cleanText(body.currentAccessKey, "Текущий пароль", { required: true, max: 200 });
    const accessKey = String(body.accessKey || "").trim();
    if (!verifyPassword(currentAccessKey, doctor.accessKeyHash)) return send(res, 401, { error: "Текущий пароль указан неверно" });
    if (!login) return send(res, 400, { error: "Логин обязателен" });
    const loginTaken = db.doctors.some((item) => item.id !== doctor.id && item.login === login);
    if (loginTaken) return send(res, 409, { error: "Такой логин уже используется" });
    doctor.login = login;
    if (accessKey) {
      const validatedAccessKey = validateNewPassword(accessKey, "Новый пароль");
      if (verifyPassword(validatedAccessKey, doctor.accessKeyHash)) return send(res, 400, { error: "Новый пароль должен отличаться от текущего" });
      doctor.accessKeyHash = hashPassword(validatedAccessKey);
      invalidateUserSessions(db, "doctor", doctor.id);
    }
    appendActivity(db, { type: "doctor_account_updated", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, details: accessKey ? "Врач изменил логин и пароль; старые сеансы завершены" : "Врач изменил логин" });
    await writeDb(db);
    return send(res, 200, { doctor: publicDoctor(doctor), currentSessionEnded: Boolean(accessKey) });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/surveys") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const rawBody = await parseBody(req);
    const clientSurveyId = cleanText(rawBody.clientSurveyId, "ID анкеты", { max: 100 });
    if (clientSurveyId && isValidUuid(clientSurveyId)) {
      const existing = (db.nurseSurveys || []).find((s) => s.clientSurveyId === clientSurveyId || s.id === clientSurveyId);
      if (existing) {
        if (!doctorCanAccessSurvey(doctor, existing)) return send(res, 403, { error: "Нет доступа" });
        return send(res, 200, { ok: true, alreadySaved: true, id: existing.id });
      }
    }
    const body = validateSurveyInput(rawBody, doctor.clinic);
    if (clientSurveyId && isValidUuid(clientSurveyId)) body.clientSurveyId = clientSurveyId;
    const duplicate = findDuplicateSurvey(db, body);
    if (duplicate) return send(res, 409, { error: "Пациент с такими ФИО, датой рождения и телефоном уже существует в этой поликлинике", duplicateId: duplicate.id, duplicate: true });
    const survey = buildNurseSurvey(body);
    if (clientSurveyId && isValidUuid(clientSurveyId)) {
      survey.id = clientSurveyId;
      survey.clientSurveyId = clientSurveyId;
    }
    survey.createdByDoctorId = doctor.id;
    db.nurseSurveys.push(survey);
    appendActivity(db, {
      type: "doctor_patient_created",
      actorRole: "doctor",
      actorId: doctor.id,
      actorName: doctor.fullName,
      clinic: doctor.clinic,
      surveyId: survey.id,
      patientName: patientNameFromSurvey(survey),
      details: "Врач добавил пациента"
    });
    await writeDb(db);
    return send(res, 201, { survey });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/survey-view") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    appendActivity(db, {
      type: "doctor_survey_viewed",
      actorRole: "doctor",
      actorId: doctor.id,
      actorName: doctor.fullName,
      clinic: doctor.clinic,
      surveyId: body.surveyId,
      patientName: patientNameFromSurvey(survey),
      details: "Врач открыл карту пациента"
    });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/visits") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const body = validateVisitInput(await parseBody(req));
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const weight = Number(body.weight || 0);
    const height = Number(body.height || 0);
    const heightM = height / 100;
    const bmi = Number(body.bmi || 0) || (weight > 0 && heightM > 0 ? Number((weight / (heightM * heightM)).toFixed(1)) : 0);
    const visit = {
      id: crypto.randomUUID(),
      surveyId: body.surveyId,
      doctorId: session.userId,
      weight,
      height,
      bmi,
      glucose: Number(body.glucose || 0),
      glucoseType: body.glucoseType || "fasting",
      diagnosis: String(body.diagnosis || ""),
      systolic: Number(body.systolic || 0),
      diastolic: Number(body.diastolic || 0),
      followUpDays: Number(body.followUpDays || 0),
      laboratoryTests: body.laboratoryTests,
      referrals: body.referrals,
      treatmentPlan: body.treatmentPlan,
      diabetesDrugs: body.diabetesDrugs,
      hypertensionDrugs: body.hypertensionDrugs,
      lifestyleRecommendations: {
        diabetesDiet: body.lifestyleRecommendations.includes("diabetesDiet"),
        physicalActivity: body.lifestyleRecommendations.includes("physicalActivity")
      },
      createdAt: new Date().toISOString()
    };
    visit.qualityWarnings = qualityFlagsForVisit(visit);
    db.doctorVisits.push(visit);
    let followUpTask = null;
    if (visit.followUpDays > 0) {
      const dueAt = new Date(Date.now() + visit.followUpDays * 86400000).toISOString();
      const task = {
        id: crypto.randomUUID(),
        surveyId: visit.surveyId,
        visitId: visit.id,
        doctorId: session.userId,
        title: "Повторный приём",
        dueAt,
        status: "open",
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      db.patientTasks.push(task);
      followUpTask = task;
    }
    const drugsCount = (visit.diabetesDrugs || []).length + (visit.hypertensionDrugs || []).length;
    appendActivity(db, {
      type: "doctor_visit_created",
      actorRole: "doctor",
      actorId: session.userId,
      actorName: doctor?.fullName || "",
      clinic: doctor?.clinic || survey?.patient?.clinic || "",
      surveyId: visit.surveyId,
      visitId: visit.id,
      patientName: patientNameFromSurvey(survey),
      details: drugsCount ? `Осмотр сохранен, назначено препаратов: ${drugsCount}` : "Осмотр сохранен без препаратов"
    });
    await writeDb(db);
    return send(res, 201, { visit, task: followUpTask });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/tasks") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const surveyId = cleanText(body.surveyId, "Пациент", { required: true, max: 100 });
    const survey = db.nurseSurveys.find((item) => item.id === surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const dueDate = cleanText(body.dueDate, "Дата выполнения", { required: true, max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T12:00:00Z`))) return send(res, 400, { error: "Дата выполнения указана неверно" });
    const task = {
      id: crypto.randomUUID(), surveyId, doctorId: doctor.id,
      title: cleanText(body.title, "Задача", { required: true, max: 200 }),
      dueAt: `${dueDate}T12:00:00.000Z`, status: "open", createdAt: new Date().toISOString(), completedAt: null
    };
    db.patientTasks.push(task);
    appendActivity(db, { type: "patient_task_created", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, surveyId, patientName: patientNameFromSurvey(survey), details: `Создана задача: ${task.title}` });
    await writeDb(db);
    return send(res, 201, { task });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/doctor/tasks/")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const task = (db.patientTasks || []).find((item) => item.id === id && item.doctorId === session.userId);
    if (!task) return send(res, 404, { error: "Задача не найдена" });
    const body = await parseBody(req);
    task.status = body.status === "completed" ? "completed" : "open";
    task.completedAt = task.status === "completed" ? new Date().toISOString() : null;
    const survey = db.nurseSurveys.find((item) => item.id === task.surveyId);
    appendActivity(db, { type: "patient_task_updated", actorRole: "doctor", actorId: doctor?.id || "", actorName: doctor?.fullName || "", clinic: doctor?.clinic || "", surveyId: task.surveyId, patientName: patientNameFromSurvey(survey), details: task.status === "completed" ? `Задача выполнена: ${task.title}` : `Задача возвращена в работу: ${task.title}` });
    await writeDb(db);
    return send(res, 200, { task });
  }

  if (req.method === "GET" && url.pathname === "/api/training/pretest") {
    return send(res, 200, {
      participants: db.trainingParticipants.map(publicParticipant),
      attempts: db.trainingAttempts.map(enrichTrainingAttempt),
      tasks: publicPostTasks()
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/training/pretest/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const questions = preQuestionsForParticipant(participant);
    return send(res, 200, {
      participant: publicParticipant(participant),
      questions,
      attempt: enrichTrainingAttempt(db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "pre")) || null
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/pretest/")) {
    const participantId = url.pathname.split("/").at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "pre");
    if (existing) return send(res, 409, { error: "Пре-тест уже сдан" });
    const body = await parseBody(req);
    const questions = preQuestionsForParticipant(participant);
    const questionIds = questions.map((question) => question.id);
    const result = scoreTest(questionIds, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "pre",
      instrument: "Инструмент 2",
      title: "Тест до обучения для оценки исходного уровня знаний",
      questionIds,
      answers: body.answers || {},
      ...result,
      createdAt: new Date().toISOString()
    };
    participant.preCompletedAt = attempt.createdAt;
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/training/participant/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    return send(res, 200, {
      participant: publicParticipant(participant),
      attempts: attemptsForParticipant(db, participant.id),
      postQuestions: publicQuestions(preTestQuestions),
      tasks: publicPostTasks()
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/posttest/")) {
    const participantId = url.pathname.split("/").at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "post");
    if (existing) return send(res, 409, { error: "Пост-тест уже сдан" });
    const body = await parseBody(req);
    const questionIds = preTestQuestions.map((question) => question.id);
    const result = scoreTest(questionIds, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "post",
      instrument: "Инструмент 3",
      title: "Тест после обучения для оценки итогового уровня знаний",
      questionIds,
      answers: body.answers || {},
      ...result,
      createdAt: new Date().toISOString()
    };
    participant.postCompletedAt = attempt.createdAt;
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/tasks/")) {
    const parts = url.pathname.split("/");
    const participantId = parts.at(-3);
    const taskId = parts.at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    const task = postTrainingTasks.find((item) => item.id === taskId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!task) return send(res, 404, { error: "Задание не найдено" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "task" && item.taskId === task.id);
    if (existing) return send(res, 409, { error: "Это задание уже отправлено" });
    const body = await parseBody(req);
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "task",
      taskId: task.id,
      title: task.title,
      instrument: task.instrument,
      maxScore: task.maxScore,
      answers: body.answers || {},
      ...scorePostTask(task, body.answers || {}),
      manualScore: null,
      trainerComment: "",
      createdAt: new Date().toISOString()
    };
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/training-attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = url.pathname.split("/").pop();
    const attempt = db.trainingAttempts.find((item) => item.id === id);
    if (!attempt) return send(res, 404, { error: "Результат не найден" });
    const body = await parseBody(req);
    attempt.manualScore = body.manualScore === "" || body.manualScore === null ? null : Number(body.manualScore);
    attempt.trainerComment = body.trainerComment || "";
    attempt.reviewedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "GET" && url.pathname === "/api/nurse-training") {
    return send(res, 200, {
      participants: db.nurseTrainingParticipants.map(publicNurseParticipant),
      attempts: db.nurseTrainingAttempts
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/nurse-training/participant/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    return send(res, 200, {
      participant: publicNurseParticipant(participant),
      attempts: db.nurseTrainingAttempts.filter((attempt) => attempt.participantId === participant.id),
      preQuestions: publicNurseQuestions("pre"),
      postQuestions: publicNurseQuestions("post")
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/nurse-training/")) {
    const parts = url.pathname.split("/");
    const type = parts.at(-3);
    const participantId = parts.at(-2);
    if (!["pre", "post"].includes(type)) return send(res, 404, { error: "Тест не найден" });
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.nurseTrainingAttempts.find((attempt) => attempt.participantId === participant.id && attempt.type === type);
    if (existing) return send(res, 409, { error: "Этот тест уже сдан" });
    const body = await parseBody(req);
    const questions = type === "post" ? remappedNursePostQuestions : nursePreQuestions;
    const result = scoreQuestionSet(questions, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type,
      title: type === "post" ? "Тест после обучения" : "Тест до обучения",
      answers: body.answers || {},
      ...result,
      passed: type === "post" ? result.passed : null,
      createdAt: new Date().toISOString()
    };
    if (type === "post") participant.postCompletedAt = attempt.createdAt;
    else participant.preCompletedAt = attempt.createdAt;
    db.nurseTrainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt });
  }

  return send(res, 404, { error: "API не найден" });
}

function countSelected(values) {
  return values.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function buildStats(db) {
  const visibleSurveys = (db.nurseSurveys || []).filter((item) => !isExcludedClinic(item.patient?.clinic || item.clinic));
  const total = visibleSurveys.length || 1;
  const highFindrisc = visibleSurveys.filter((item) => item.findrisc?.highRisk).length;
  const highScore2 = visibleSurveys.filter((item) => item.score2?.highRisk).length;
  const needsDoctor = visibleSurveys.filter((item) => item.needsDoctor).length;
  const visibleDoctors = (db.doctors || []).filter((doctor) => !isExcludedClinic(doctor.clinic));
  const excludedSurveyIds = new Set((db.nurseSurveys || []).filter((s) => isExcludedClinic(s.patient?.clinic || s.clinic)).map((s) => s.id));
  const visibleVisits = (db.doctorVisits || []).filter((v) => !excludedSurveyIds.has(v.surveyId));
  return {
    doctorsTotal: visibleDoctors.length,
    surveysTotal: visibleSurveys.length,
    visitsTotal: visibleVisits.length,
    needsDoctor,
    highFindrisc,
    highScore2,
    needsDoctorPercent: Math.round((needsDoctor / total) * 100),
    highFindriscPercent: Math.round((highFindrisc / total) * 100),
    highScore2Percent: Math.round((highScore2 / total) * 100)
  };
}

function buildTrainingStats(db) {
  const preAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "pre");
  const postAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "post");
  const taskAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "task");
  const preTotal = preAttempts.length || 1;
  const postTotal = postAttempts.length || 1;
  const avgPrePercent = Math.round(preAttempts.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / preTotal);
  const avgPostPercent = Math.round(postAttempts.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / postTotal);
  return {
    participantsTotal: db.trainingParticipants.length,
    preCompleted: preAttempts.length,
    preAveragePercent: preAttempts.length ? avgPrePercent : 0,
    postCompleted: postAttempts.length,
    postAveragePercent: postAttempts.length ? avgPostPercent : 0,
    taskCompleted: taskAttempts.length
  };
}

function buildNurseTrainingStats(db) {
  const preAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.type === "pre");
  const postAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.type === "post");
  const avg = (items) => items.length ? Math.round(items.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / items.length) : 0;
  return {
    participantsTotal: db.nurseTrainingParticipants.length,
    preCompleted: preAttempts.length,
    postCompleted: postAttempts.length,
    preAveragePercent: avg(preAttempts),
    postAveragePercent: avg(postAttempts),
    postPassed: postAttempts.filter((attempt) => attempt.passed === true).length
  };
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "Не указано";
}

function percentAverage(items) {
  return items.length ? Math.round(items.reduce((sum, item) => sum + Number(item.percent || 0), 0) / items.length) : 0;
}

function objectToSeries(data) {
  return Object.entries(data)
    .sort(([a], [b]) => clinicKey(a).localeCompare(clinicKey(b), "ru"))
    .map(([label, value]) => ({ label, value }));
}

function doctorPostPercent(attempts) {
  const taskAttempts = attempts.filter((attempt) => attempt.type === "task");
  const correct = taskAttempts.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
  const total = taskAttempts.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
  return total ? Math.round((correct / total) * 100) : 0;
}

function buildEducationInvestorStats(participants, attempts, postMode) {
  const attemptsByParticipant = attempts.reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = participants.filter((participant) => !isExcludedClinic(participant.clinic)).map((participant) => {
    const participantAttempts = attemptsByParticipant[participant.id] || [];
    const pre = participantAttempts.find((attempt) => attempt.type === "pre");
    const post = postMode === "task"
      ? doctorPostPercent(participantAttempts)
      : Number(participantAttempts.find((attempt) => attempt.type === "post")?.percent || 0);
    return {
      clinic: participant.clinic || "Не указано",
      registeredAt: participant.createdAt,
      prePercent: pre ? Number(pre.percent || 0) : 0,
      postPercent: post,
      hasPre: Boolean(pre),
      hasPost: post > 0
    };
  });
  const byClinic = {};
  for (const row of rows) {
    byClinic[row.clinic] ||= { label: row.clinic, registered: 0, preCompleted: 0, postCompleted: 0, preSum: 0, postSum: 0 };
    byClinic[row.clinic].registered += 1;
    if (row.hasPre) {
      byClinic[row.clinic].preCompleted += 1;
      byClinic[row.clinic].preSum += row.prePercent;
    }
    if (row.hasPost) {
      byClinic[row.clinic].postCompleted += 1;
      byClinic[row.clinic].postSum += row.postPercent;
    }
  }
  const byDate = countSelected(rows.map((row) => dateKey(row.registeredAt)));
  const preRows = rows.filter((row) => row.hasPre).map((row) => ({ percent: row.prePercent }));
  const postRows = rows.filter((row) => row.hasPost).map((row) => ({ percent: row.postPercent }));
  return {
    total: participants.length,
    preCompleted: preRows.length,
    postCompleted: postRows.length,
    preAverage: percentAverage(preRows),
    postAverage: percentAverage(postRows),
    passed70: postRows.filter((row) => row.percent >= 70).length,
    byDate: objectToSeries(byDate),
    byClinic: Object.values(byClinic)
      .sort((a, b) => clinicKey(a.label).localeCompare(clinicKey(b.label), "ru"))
      .map((item) => ({
        label: item.label,
        registered: item.registered,
        preCompleted: item.preCompleted,
        postCompleted: item.postCompleted,
        preAverage: item.preCompleted ? Math.round(item.preSum / item.preCompleted) : 0,
        postAverage: item.postCompleted ? Math.round(item.postSum / item.postCompleted) : 0
      }))
  };
}

function buildInvestorDashboard(db) {
  const stats = buildStats(db);
  const doctorEducation = buildEducationInvestorStats(db.trainingParticipants, db.trainingAttempts, "task");
  const nurseEducation = buildEducationInvestorStats(db.nurseTrainingParticipants, db.nurseTrainingAttempts, "post");
  const visibleSurveys = db.nurseSurveys.filter((survey) => !isExcludedClinic(survey.patient?.clinic || survey.clinic));
  const visibleDoctors = db.doctors.filter((doctor) => !isExcludedClinic(doctor.clinic));
  const surveysByClinic = countSelected(visibleSurveys.map((survey) => survey.patient?.clinic || survey.clinic || "Не указано"));
  const visitsByDate = countSelected(db.doctorVisits.map((visit) => dateKey(visit.createdAt)));
  const surveyByDate = countSelected(visibleSurveys.map((survey) => dateKey(survey.createdAt)));
  const diagnoses = countSelected(db.doctorVisits.map((visit) => visit.diagnosis || "Без диагноза"));
  const cutoff30 = Date.now() - 30 * 86400000;
  const highGlucose = visibleSurveys.filter((survey) => Number(survey.measurements?.glucoseLevel || 0) >= 6.1).length;
  const highPressure = visibleSurveys.filter((survey) => Number(survey.measurements?.systolic || 0) >= 140 || Number(survey.measurements?.diastolic || 0) >= 90).length;
  const clinicNames = [...new Set([
    ...visibleDoctors.map((doctor) => doctor.clinic || "Не указано"),
    ...visibleSurveys.map((survey) => survey.patient?.clinic || survey.clinic || "Не указано")
  ])].filter((clinic) => !isExcludedClinic(clinic)).sort((a, b) => a.localeCompare(b, "ru"));
  const clinicPerformance = clinicNames.map((clinic) => {
    const surveys = visibleSurveys.filter((survey) => (survey.patient?.clinic || survey.clinic || "Не указано") === clinic);
    const surveyIds = new Set(surveys.map((survey) => survey.id));
    const visits = db.doctorVisits.filter((visit) => surveyIds.has(visit.surveyId));
    const tasks = (db.patientTasks || []).filter((task) => surveyIds.has(task.surveyId));
    const target = db.settings?.clinicTargets?.[clinic] || {};
    const completedTasks = tasks.filter((task) => task.status === "completed").length;
    return {
      label: clinic,
      doctors: visibleDoctors.filter((doctor) => (doctor.clinic || "Не указано") === clinic).length,
      surveys: surveys.length,
      visits: visits.length,
      highRisk: surveys.filter((survey) => survey.needsDoctor).length,
      targets: target,
      patientTargetPercent: target.monthlyPatients ? Math.min(100, Math.round((surveys.length / target.monthlyPatients) * 100)) : null,
      visitTargetPercent: target.monthlyVisits ? Math.min(100, Math.round((visits.length / target.monthlyVisits) * 100)) : null,
      followUpCompletionPercent: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      doctorsTotal: stats.doctorsTotal,
      surveysTotal: stats.surveysTotal,
      visitsTotal: stats.visitsTotal,
      riskNeedsDoctorPercent: stats.needsDoctorPercent,
      highFindriscPercent: stats.highFindriscPercent,
      highScore2Percent: stats.highScore2Percent,
      doctorTrainingPostAverage: doctorEducation.postAverage,
      nurseTrainingPostAverage: nurseEducation.postAverage,
      newPatients30Days: visibleSurveys.filter((survey) => Date.parse(survey.createdAt || "") >= cutoff30).length,
      highGlucosePercent: Math.round((highGlucose / Math.max(1, visibleSurveys.length)) * 100),
      highPressurePercent: Math.round((highPressure / Math.max(1, visibleSurveys.length)) * 100),
      openFollowUps: (db.patientTasks || []).filter((task) => task.status !== "completed").length
    },
    doctors: {
      registeredByClinic: objectToSeries(countSelected(visibleDoctors.map((doctor) => doctor.clinic || "Не указано"))),
      registeredByDate: objectToSeries(countSelected(db.doctors.map((doctor) => dateKey(doctor.createdAt))))
    },
    nurses: {
      surveyByClinic: objectToSeries(surveysByClinic),
      surveyByDate: objectToSeries(surveyByDate)
    },
    clinical: {
      visitsByDate: objectToSeries(visitsByDate),
      diagnoses: objectToSeries(diagnoses),
      clinicPerformance,
      risk: [
        { label: "Нужно к врачу", value: stats.needsDoctorPercent },
        { label: "FINDRISC повышен", value: stats.highFindriscPercent },
        { label: "СС риск высок", value: stats.highScore2Percent }
      ]
    },
    education: {
      doctors: doctorEducation,
      nurses: nurseEducation
    }
  };
}

function buildInvestorReportCsv(db) {
  const data = buildInvestorDashboard(db);
  const lines = [["Показатель", "Значение"]];
  const summaryLabels = {
    doctorsTotal: "Врачи в системе",
    surveysTotal: "Анкеты пациентов",
    visitsTotal: "Осмотры врачей",
    newPatients30Days: "Новые пациенты за 30 дней",
    highGlucosePercent: "Повышенный сахар, %",
    highPressurePercent: "Повышенное давление, %",
    openFollowUps: "Открытые повторные визиты",
    riskNeedsDoctorPercent: "Требуют врача, %",
    doctorTrainingPostAverage: "Пост-тест врачей, %",
    nurseTrainingPostAverage: "Пост-тест медсестер, %"
  };
  for (const [key, label] of Object.entries(summaryLabels)) lines.push([label, data.summary[key] ?? 0]);
  lines.push([], ["Поликлиника", "Врачи", "Анкеты", "Осмотры", "Высокий риск"]);
  for (const clinic of data.clinical.clinicPerformance) lines.push([clinic.label, clinic.doctors, clinic.surveys, clinic.visits, clinic.highRisk]);
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(";")).join("\n")}`;
}

function buildMinzdravGeoDashboard(db) {
  const visibleSurveys = (db.nurseSurveys || []).filter((survey) => !isExcludedClinic(survey.patient?.clinic || survey.clinic));
  const totalSurveys = visibleSurveys.length;
  const visitsBySurvey = {};
  for (const visit of db.doctorVisits || []) {
    (visitsBySurvey[visit.surveyId] ||= []).push(visit);
  }

  let lowRisk = 0;
  let moderateRisk = 0;
  let highRisk = 0;
  let veryHighRisk = 0;
  let hypertensionRisk = 0;
  let diabetesRisk = 0;
  let referredToDoctor = 0;
  let visitedDoctor = 0;
  let therapyPrescribed = 0;

  for (const survey of visibleSurveys) {
    const fScore = Number(survey.findrisc?.score || 0);
    const glucose = Number(survey.measurements?.glucoseLevel || 0);
    const sys = Number(survey.measurements?.systolic || 0);
    const dia = Number(survey.measurements?.diastolic || 0);
    const isNeedsDoc = Boolean(survey.needsDoctor);

    if (fScore >= 15) veryHighRisk++;
    else if (fScore >= 14) highRisk++;
    else if (fScore >= 7) moderateRisk++;
    else lowRisk++;

    if (glucose >= 6.1 || fScore >= 14) diabetesRisk++;
    if (sys >= 140 || dia >= 90) hypertensionRisk++;
    if (isNeedsDoc) referredToDoctor++;

    const visits = visitsBySurvey[survey.id] || [];
    if (visits.length > 0) {
      visitedDoctor++;
      const hasMeds = visits.some((v) => (v.diabetesDrugs?.length || 0) > 0 || (v.hypertensionDrugs?.length || 0) > 0);
      if (hasMeds) therapyPrescribed++;
    }
  }

  const clinicNames = [...new Set(visibleSurveys.map((s) => s.patient?.clinic || s.clinic || "Не указано"))]
    .filter((c) => !isExcludedClinic(c))
    .sort((a, b) => a.localeCompare(b, "ru"));

  const clinicTable = clinicNames.map((clinic) => {
    const cSurveys = visibleSurveys.filter((s) => (s.patient?.clinic || s.clinic || "Не указано") === clinic);
    const count = cSurveys.length;
    const cHighRisk = cSurveys.filter((s) => s.needsDoctor).length;
    const cHypertension = cSurveys.filter((s) => {
      const sys = Number(s.measurements?.systolic || 0);
      const dia = Number(s.measurements?.diastolic || 0);
      return sys >= 140 || dia >= 90;
    }).length;
    const cDiabetes = cSurveys.filter((s) => {
      const fScore = Number(s.findrisc?.score || 0);
      const glucose = Number(s.measurements?.glucoseLevel || 0);
      return glucose >= 6.1 || fScore >= 14;
    }).length;

    let cVisits = 0;
    let cTherapy = 0;
    for (const s of cSurveys) {
      const vList = visitsBySurvey[s.id] || [];
      if (vList.length > 0) {
        cVisits++;
        if (vList.some((v) => (v.diabetesDrugs?.length || 0) > 0 || (v.hypertensionDrugs?.length || 0) > 0)) {
          cTherapy++;
        }
      }
    }

    const conversionToDoctor = cHighRisk ? Math.round((cVisits / cHighRisk) * 100) : 0;
    const target = db.settings?.clinicTargets?.[clinic]?.monthlyPatients || 2000;
    const coveragePercent = Math.min(100, Math.round((count / target) * 100));
    const grade = coveragePercent >= 70 ? "high" : coveragePercent >= 30 ? "medium" : "low";

    return {
      clinic,
      surveysCount: count,
      targetPatients: target,
      coveragePercent,
      highRiskCount: cHighRisk,
      highRiskPercent: count ? Math.round((cHighRisk / count) * 100) : 0,
      hypertensionCount: cHypertension,
      hypertensionPercent: count ? Math.round((cHypertension / count) * 100) : 0,
      diabetesCount: cDiabetes,
      diabetesPercent: count ? Math.round((cDiabetes / count) * 100) : 0,
      visitedDoctorCount: cVisits,
      conversionToDoctor,
      therapyCount: cTherapy,
      grade
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      screenedPatients: totalSurveys,
      lowRisk,
      moderateRisk,
      highRisk,
      veryHighRisk,
      hypertensionSuspected: hypertensionRisk,
      hypertensionPercent: totalSurveys ? Math.round((hypertensionRisk / totalSurveys) * 100) : 0,
      diabetesSuspected: diabetesRisk,
      diabetesPercent: totalSurveys ? Math.round((diabetesRisk / totalSurveys) * 100) : 0,
      referredToDoctor,
      visitedDoctor,
      doctorConversionPercent: referredToDoctor ? Math.round((visitedDoctor / referredToDoctor) * 100) : 0,
      therapyPrescribed,
      therapyPercent: visitedDoctor ? Math.round((therapyPrescribed / visitedDoctor) * 100) : 0
    },
    funnel: [
      { step: "Скрининг медсестрой", count: totalSurveys, percent: 100 },
      { step: "Выявлен повышенный риск", count: referredToDoctor, percent: totalSurveys ? Math.round((referredToDoctor / totalSurveys) * 100) : 0 },
      { step: "Принято врачом", count: visitedDoctor, percent: totalSurveys ? Math.round((visitedDoctor / totalSurveys) * 100) : 0 },
      { step: "Назначена медикаментозная терапия", count: therapyPrescribed, percent: totalSurveys ? Math.round((therapyPrescribed / totalSurveys) * 100) : 0 }
    ],
    clinics: clinicTable
  };
}

function buildMinzdravReportCsv(db) {
  const dash = buildMinzdravGeoDashboard(db);
  const rows = [
    ["Отчет Министерства Здравоохранения: Скрининг неинфекционных заболеваний (НИЗ)"],
    [`Дата формирования: ${new Date().toLocaleDateString("ru-RU")} ${new Date().toLocaleTimeString("ru-RU")}`],
    [],
    [
      "Поликлиника / Медучреждение",
      "Охвачено скринингом",
      "План скрининга",
      "% Охвата плана",
      "Выявлен риск (Всего)",
      "% Группы риска",
      "Подозрение на Артериальную гипертензию",
      "% Гипертензии",
      "Подозрение на Сахарный диабет",
      "% Диабета",
      "Принято врачом",
      "% Доходимости до врача",
      "Назначена фармакотерапия"
    ]
  ];

  for (const c of dash.clinics) {
    rows.push([
      c.clinic,
      c.surveysCount,
      c.targetPatients,
      `${c.coveragePercent}%`,
      c.highRiskCount,
      `${c.highRiskPercent}%`,
      c.hypertensionCount,
      `${c.hypertensionPercent}%`,
      c.diabetesCount,
      `${c.diabetesPercent}%`,
      c.visitedDoctorCount,
      `${c.conversionToDoctor}%`,
      c.therapyCount
    ]);
  }

  rows.push([]);
  rows.push([
    "ИТОГО ПО РЕСПУБЛИКЕ / ГОРОДУ",
    dash.totals.screenedPatients,
    "-",
    "-",
    dash.totals.referredToDoctor,
    `${dash.totals.screenedPatients ? Math.round((dash.totals.referredToDoctor / dash.totals.screenedPatients) * 100) : 0}%`,
    dash.totals.hypertensionSuspected,
    `${dash.totals.hypertensionPercent}%`,
    dash.totals.diabetesSuspected,
    `${dash.totals.diabetesPercent}%`,
    dash.totals.visitedDoctor,
    `${dash.totals.doctorConversionPercent}%`,
    dash.totals.therapyPrescribed
  ]);

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
}

function hasDoctorAction(visit) {
  return Boolean(
    (visit.referrals || []).length ||
    String(visit.treatmentPlan || "").trim() ||
    (visit.diabetesDrugs || []).length ||
    (visit.hypertensionDrugs || []).length ||
    (visit.laboratoryTests || []).length ||
    Number(visit.followUpDays || 0) > 0
  );
}

function monitorDateTime(value) {
  return value ? new Date(value).toISOString() : "";
}

function matchesMonitorFilters(item, filters = {}) {
  const clinic = filters.clinic || "all";
  const nurse = filters.nurse || "all";
  const doctor = filters.doctor || "all";
  const date = filters.date || "";
  if (clinic !== "all" && item.clinic !== clinic) return false;
  if (nurse !== "all" && item.nurseName !== nurse) return false;
  if (doctor !== "all" && item.doctorName !== doctor) return false;
  if (date && dateKey(item.createdAt) !== date) return false;
  return true;
}

function buildOperationsMonitorRows(db) {
  const doctorsById = Object.fromEntries((db.doctors || []).map((doctor) => [doctor.id, doctor]));
  const visitsBySurvey = {};
  for (const visit of db.doctorVisits || []) {
    (visitsBySurvey[visit.surveyId] ||= []).push(visit);
  }
  const surveyRows = (db.nurseSurveys || []).map((survey) => {
    const visits = visitsBySurvey[survey.id] || [];
    const createdByDoctor = survey.createdByDoctorId ? doctorsById[survey.createdByDoctorId] : null;
    return {
      id: survey.id,
      createdAt: survey.createdAt,
      clinic: survey.patient?.clinic || survey.clinic || "Не указано",
      patientName: patientNameFromSurvey(survey) || "Пациент",
      nurseName: survey.nurse?.fullName || (createdByDoctor ? "Добавил врач" : "Медсестра не указана"),
      doctorName: createdByDoctor?.fullName || "",
      needsDoctor: Boolean(survey.needsDoctor),
      findrisc: survey.findrisc?.score || 0,
      score2: survey.score2?.percent || 0,
      viewedByDoctors: new Set((db.activityEvents || []).filter((event) => event.type === "doctor_survey_viewed" && event.surveyId === survey.id).map((event) => event.actorId || event.actorName)).size,
      visits: visits.length,
      visitsWithActions: visits.filter(hasDoctorAction).length,
      drugs: visits.reduce((sum, visit) => sum + (visit.diabetesDrugs || []).length + (visit.hypertensionDrugs || []).length, 0)
    };
  });
  const visitRows = (db.doctorVisits || []).map((visit) => {
    const doctor = doctorsById[visit.doctorId];
    const survey = (db.nurseSurveys || []).find((item) => item.id === visit.surveyId);
    return {
      id: visit.id,
      createdAt: visit.createdAt,
      clinic: doctor?.clinic || survey?.patient?.clinic || "Не указано",
      doctorName: doctor?.fullName || "Врач не указан",
      nurseName: survey?.nurse?.fullName || "Медсестра не указана",
      patientName: patientNameFromSurvey(survey) || "Пациент",
      diagnosis: visit.diagnosis || "",
      hasAction: hasDoctorAction(visit),
      referrals: (visit.referrals || []).join(", "),
      drugs: [...(visit.diabetesDrugs || []), ...(visit.hypertensionDrugs || [])].join("; "),
      labs: (visit.laboratoryTests || []).map((item) => `${item.name || ""}: ${item.result || ""}`).filter(Boolean).join("; "),
      followUpDays: visit.followUpDays || 0
    };
  });
  const eventRows = (db.activityEvents || []).map((event) => ({
    id: event.id,
    createdAt: event.createdAt,
    type: event.type,
    clinic: event.clinic || "Не указано",
    actorRole: event.actorRole,
    actorName: event.actorName || "",
    nurseName: event.actorRole === "nurse" ? event.actorName : "all",
    doctorName: event.actorRole === "doctor" ? event.actorName : "all",
    patientName: event.patientName || "",
    details: event.details || ""
  }));
  return { surveyRows, visitRows, eventRows };
}

function groupMonitor(items, keyFn, seed = {}) {
  const map = {};
  for (const item of items) {
    const key = keyFn(item) || "Не указано";
    map[key] ||= { label: key, ...seed };
  }
  return map;
}

function buildOperationsMonitor(db, filters = {}) {
  const { surveyRows, visitRows, eventRows } = buildPublicOperationsMonitorRows(db);
  const filteredSurveys = surveyRows.filter((row) => matchesMonitorFilters(row, filters));
  const filteredVisits = visitRows.filter((row) => matchesMonitorFilters(row, filters));
  const filteredEvents = eventRows.filter((row) => matchesMonitorFilters(row, filters));
  const clinicMap = groupMonitor([...filteredSurveys, ...filteredVisits], (row) => row.clinic, { surveys: 0, visits: 0, visitsWithActions: 0, needsDoctor: 0 });
  for (const row of filteredSurveys) {
    clinicMap[row.clinic].surveys += 1;
    if (row.needsDoctor) clinicMap[row.clinic].needsDoctor += 1;
  }
  for (const row of filteredVisits) {
    clinicMap[row.clinic].visits += 1;
    if (row.hasAction) clinicMap[row.clinic].visitsWithActions += 1;
  }
  const clinicSurveyDayMap = {};
  const nurseSurveyDayMap = {};
  for (const row of filteredSurveys) {
    const day = dateKey(row.createdAt) || "Не указано";
    const key = `${row.clinic}||${day}`;
    clinicSurveyDayMap[key] ||= { label: `${row.clinic} / ${day}`, clinic: row.clinic, date: day, surveys: 0, needsDoctor: 0 };
    clinicSurveyDayMap[key].surveys += 1;
    if (row.needsDoctor) clinicSurveyDayMap[key].needsDoctor += 1;
    const nurseKey = `${row.clinic}||${row.nurseName}||${day}`;
    nurseSurveyDayMap[nurseKey] ||= {
      label: `${row.nurseName} / ${day}`,
      clinic: row.clinic,
      nurseName: row.nurseName,
      date: day,
      surveys: 0,
      needsDoctor: 0
    };
    nurseSurveyDayMap[nurseKey].surveys += 1;
    if (row.needsDoctor) nurseSurveyDayMap[nurseKey].needsDoctor += 1;
  }
  const doctorMap = groupMonitor(filteredVisits, (row) => row.doctorName, { views: 0, visits: 0, visitsWithActions: 0, drugs: 0, lastAction: "" });
  for (const event of filteredEvents.filter((event) => event.type === "doctor_survey_viewed")) {
    doctorMap[event.actorName] ||= { label: event.actorName, views: 0, visits: 0, visitsWithActions: 0, drugs: 0, lastAction: "" };
    doctorMap[event.actorName].views += 1;
    doctorMap[event.actorName].lastAction = [doctorMap[event.actorName].lastAction, event.createdAt].filter(Boolean).sort().at(-1) || "";
  }
  for (const row of filteredVisits) {
    doctorMap[row.doctorName].visits += 1;
    if (row.hasAction) doctorMap[row.doctorName].visitsWithActions += 1;
    doctorMap[row.doctorName].drugs += row.drugs ? row.drugs.split(";").filter(Boolean).length : 0;
    doctorMap[row.doctorName].lastAction = [doctorMap[row.doctorName].lastAction, row.createdAt].filter(Boolean).sort().at(-1) || "";
  }
  const byDate = {};
  for (const row of filteredSurveys) {
    const key = dateKey(row.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].surveys += 1;
  }
  for (const event of filteredEvents.filter((event) => event.type === "doctor_survey_viewed")) {
    const key = dateKey(event.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].doctorViews += 1;
  }
  for (const row of filteredVisits) {
    const key = dateKey(row.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].visits += 1;
    if (row.hasAction) byDate[key].actions += 1;
  }
  const clinics = [...new Set([...surveyRows.map((row) => row.clinic), ...visitRows.map((row) => row.clinic)])].sort((a, b) => clinicKey(a).localeCompare(clinicKey(b), "ru"));
  const nurses = [...new Set(surveyRows.map((row) => row.nurseName))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const doctors = [...new Set([...(db.doctors || []).map((doctor) => doctor.fullName), ...visitRows.map((row) => row.doctorName)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const publicEvents = filteredEvents
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200)
    .map((event) => event.actorRole === "nurse" ? { ...event, actorName: "Медсестра", nurseName: "" } : event);
  const publicSurveys = filteredSurveys
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300)
    .map(({ nurseName, ...row }) => row);
  return {
    generatedAt: new Date().toISOString(),
    filters: { clinics, nurses, doctors },
    summary: {
      surveys: filteredSurveys.length,
      nursesActive: new Set(filteredSurveys.map((row) => row.nurseName)).size,
      doctorViews: filteredEvents.filter((event) => event.type === "doctor_survey_viewed").length,
      visits: filteredVisits.length,
      visitsWithActions: filteredVisits.filter((row) => row.hasAction).length,
      needsDoctor: filteredSurveys.filter((row) => row.needsDoctor).length
    },
    clinics: Object.values(clinicMap).sort((a, b) => clinicKey(a.label).localeCompare(clinicKey(b.label), "ru")),
    nurses: Object.values(nurseSurveyDayMap).sort((a, b) =>
      b.date.localeCompare(a.date) || clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru") || a.nurseName.localeCompare(b.nurseName, "ru")
    ),
    clinicSurveyDays: Object.values(clinicSurveyDayMap).sort((a, b) =>
      clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru") || a.date.localeCompare(b.date)
    ),
    doctors: Object.values(doctorMap).sort((a, b) => (b.visits + b.views) - (a.visits + a.views)),
    byDate: Object.values(byDate).sort((a, b) => a.label.localeCompare(b.label)),
    events: publicEvents,
    surveys: publicSurveys,
    visits: filteredVisits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 300)
  };
}

function qualityFlagsForSurvey(survey) {
  const flags = [];
  const m = survey.measurements || {};
  if (!m.weight && !m.rabitoWeight) flags.push("Не указан вес");
  if (!m.height) flags.push("Не указан рост");
  if (!m.systolic || !m.diastolic) flags.push("Не указано артериальное давление");
  if (m.bmi && (m.bmi < 15 || m.bmi > 60)) flags.push("Проверьте индекс массы тела");
  if (m.systolic >= 180 || m.diastolic >= 120) flags.push("Очень высокое артериальное давление");
  if (!survey.nurse?.fullName && !survey.createdByDoctorId) flags.push("Не указана медсестра");
  return flags;
}

function qualityFlagsForVisit(visit) {
  const flags = [];
  if (!visit.systolic || !visit.diastolic) flags.push("В осмотре не указано давление");
  if (!visit.weight) flags.push("В осмотре не указан вес");
  if (!visit.glucose) flags.push("Не указан уровень сахара в крови");
  if (!visit.diagnosis && !(visit.referrals || []).length && !visit.treatmentPlan) flags.push("Нет решения врача");
  return flags;
}

function duplicatePatientSuggestions(db) {
  const groups = new Map();
  for (const survey of (db.nurseSurveys || []).filter((item) => !item.archivedAt && !isExcludedClinic(item.patient?.clinic || item.clinic))) {
    const patient = survey.patient || {};
    const identity = normalizePatientIdentity(patient);
    const phone = String(patient.phone || "").replace(/\D/g, "");
    const keys = [`identity:${clinicKey(patient.clinic || survey.clinic)}:${identity}`];
    if (phone.length >= 7) keys.push(`phone:${clinicKey(patient.clinic || survey.clinic)}:${phone}`);
    for (const key of keys) (groups.get(key) || groups.set(key, []).get(key)).push(survey);
  }
  const seen = new Set();
  const suggestions = [];
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const ids = items.map((item) => item.id).sort();
    const signature = ids.join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    suggestions.push({
      reason: key.startsWith("phone:") ? "Одинаковый телефон" : "Совпадают ФИО и дата рождения",
      clinic: items[0].patient?.clinic || items[0].clinic || "",
      patients: items.map((item) => ({ id: item.id, name: patientNameFromSurvey(item), birthDate: item.patient?.birthDate || "", phone: item.patient?.phone || "", createdAt: item.createdAt }))
    });
  }
  return suggestions.slice(0, 100);
}

function careChecklist(visits = []) {
  const text = visits.flatMap((visit) => [
    ...(visit.laboratoryTests || []).filter(lab => lab.status !== 'ordered' && labHasResult(lab)).flatMap((lab) => [lab.test, lab.name]),
    ...(visit.completedExaminations || [])
  ]).filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
  return {
    hba1c: /hba1c|гликир|гликирован/.test(text),
    kidney: /креатинин|скф|почек|альбумин/.test(text),
    lipids: /лпнп|холестерин|липид/.test(text),
    eyes: /офтальм|глаз|сетчат/.test(text),
    feet: /стоп|подолог|нейропат/.test(text)
  };
}

function buildCareControl(db) {
  const doctorsById = Object.fromEntries((db.doctors || []).map((doctor) => [doctor.id, doctor]));
  const eventsBySurvey = {};
  for (const event of db.activityEvents || []) (eventsBySurvey[event.surveyId] ||= []).push(event);
  const visitsBySurvey = {};
  for (const visit of db.doctorVisits || []) (visitsBySurvey[visit.surveyId] ||= []).push(visit);
  const tasksBySurvey = {};
  for (const task of db.patientTasks || []) (tasksBySurvey[task.surveyId] ||= []).push(task);
  const registry = (db.nurseSurveys || []).filter((survey) => !survey.archivedAt && !isExcludedClinic(survey.patient?.clinic || survey.clinic)).map((survey) => {
    const visits = (visitsBySurvey[survey.id] || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const lastVisit = visits.at(-1) || null;
    const checklist = careChecklist(visits);
    const missingChecklist = Object.entries(checklist).filter(([, ok]) => !ok).map(([key]) => ({ hba1c: "HbA1c", kidney: "Почки", lipids: "Липиды", eyes: "Глаза", feet: "Стопы" }[key]));
    const tasks = tasksBySurvey[survey.id] || [];
    const viewed = (eventsBySurvey[survey.id] || []).some((event) => event.type === "doctor_survey_viewed");
    const followUpPlanned = Boolean(lastVisit?.followUpDays || tasks.length);
    const followUpCompleted = visits.length > 1;
    const stage = followUpCompleted ? "Повторный контроль выполнен" : followUpPlanned ? "Повторный контроль запланирован" : visits.length ? "Осмотр врача выполнен" : viewed ? "Карточка открыта врачом" : survey.needsDoctor ? "Ожидает врача" : "Первичный скрининг";
    const nextAction = stage === "Ожидает врача" ? "Назначить врача" : missingChecklist.length ? `Назначить: ${missingChecklist.join(", ")}` : followUpPlanned && !followUpCompleted ? "Проверить повторный визит" : !visits.length ? "Провести осмотр" : "Наблюдение по плану";
    const surveyFlags = qualityFlagsForSurvey(survey);
    const visitFlags = lastVisit ? qualityFlagsForVisit(lastVisit) : [];
    return {
      id: survey.id,
      patientName: patientNameFromSurvey(survey),
      birthDate: survey.patient?.birthDate || "",
      clinic: survey.patient?.clinic || survey.clinic || "",
      nurseName: survey.nurse?.fullName || (survey.createdByDoctorId ? "Добавил врач" : "Не указана"),
      doctorName: doctorsById[lastVisit?.doctorId]?.fullName || "",
      createdAt: survey.createdAt,
      lastVisitAt: lastVisit?.createdAt || "",
      findrisc: survey.findrisc?.score || 0,
      glucose: lastVisit?.glucose || survey.measurements?.glucoseLevel || 0,
      bloodPressure: `${lastVisit?.systolic || survey.measurements?.systolic || "—"}/${lastVisit?.diastolic || survey.measurements?.diastolic || "—"}`,
      stage,
      nextAction,
      needsDoctor: Boolean(survey.needsDoctor),
      visits: visits.length,
      checklist,
      missingChecklist,
      qualityFlags: [...surveyFlags, ...visitFlags]
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const nurseDailyMap = {};
  for (const row of buildPublicOperationsMonitorRows(db).surveyRows) {
    const day = dateKey(row.createdAt);
    const key = `${row.clinic}|${row.nurseName}|${day}`;
    nurseDailyMap[key] ||= { clinic: row.clinic, nurseName: row.nurseName, date: day, screened: 0, needsDoctor: 0 };
    nurseDailyMap[key].screened += 1;
    if (row.needsDoctor) nurseDailyMap[key].needsDoctor += 1;
  }
  const quality = registry.filter((row) => row.qualityFlags.length).map((row) => ({ id: row.id, patientName: row.patientName, clinic: row.clinic, flags: row.qualityFlags }));
  const duplicates = duplicatePatientSuggestions(db);
  const summary = {
    patients: registry.length,
    awaitingDoctor: registry.filter((row) => row.stage === "Ожидает врача").length,
    withDoctorVisit: registry.filter((row) => row.visits > 0).length,
    followUpPlanned: registry.filter((row) => row.stage.includes("запланирован")).length,
    followUpCompleted: registry.filter((row) => row.stage === 'Повторный контроль выполнен').length,
    qualityWarnings: quality.length,
    duplicateGroups: duplicates.length
  };
  return {
    summary,
    registry,
    waitingPatients: waitingPatients(db).filter((patient) => !isExcludedClinic(patient.clinic)),
    nurseDaily: Object.values(nurseDailyMap).sort((a, b) => b.date.localeCompare(a.date) || a.clinic.localeCompare(b.clinic, "ru")),
    quality,
    duplicates,
    backupStatus: db.settings?.backupStatus || null,
    dailyReports: { ...(db.settings?.dailyReports || {}), tokenConfigured: Boolean(TELEGRAM_BOT_TOKEN), defaultChatConfigured: Boolean(TELEGRAM_REPORT_CHAT_ID) }
  };
}

function excelXmlCell(value, type = "String") {
  const escaped = String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<Cell><Data ss:Type="${type}">${escaped}</Data></Cell>`;
}

function excelXmlSheet(name, headers, rows) {
  const header = `<Row ss:StyleID="Header">${headers.map((item) => excelXmlCell(item)).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${row.map((item) => excelXmlCell(item, typeof item === "number" ? "Number" : "String")).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${name}"><Table>${header}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
}

function buildCareControlExcel(db) {
  const control = buildCareControl(db);
  const sheets = [
    excelXmlSheet("Регистр", ["Пациент", "Дата рождения", "Поликлиника", "Медсестра", "Врач", "Этап", "FINDRISC", "Сахар", "АД", "Осмотров", "Не выполнено"], control.registry.map((row) => [row.patientName, row.birthDate, row.clinic, row.nurseName, row.doctorName, row.stage, row.findrisc, row.glucose || "", row.bloodPressure, row.visits, row.missingChecklist.join(", ")])),
    excelXmlSheet("Медсестры", ["Дата", "Поликлиника", "Медсестра", "Осмотрено", "К врачу"], control.nurseDaily.map((row) => [row.date, row.clinic, row.nurseName, row.screened, row.needsDoctor])),
    excelXmlSheet("Качество", ["Пациент", "Поликлиника", "Предупреждения"], control.quality.map((row) => [row.patientName, row.clinic, row.flags.join("; ")])),
    excelXmlSheet("Дубликаты", ["Причина", "Поликлиника", "Карточки"], control.duplicates.map((group) => [group.reason, group.clinic, group.patients.map((item) => `${item.name} (${item.birthDate})`).join("; ")]))
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EDE8" ss:Pattern="Solid"/></Style></Styles>${sheets}</Workbook>`;
}

async function createSecureBackup(db, reason = "manual") {
  const backupDir = join(dataDir, "backups");
  await mkdir(backupDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const filename = `e-clinic-${createdAt.replace(/[:.]/g, "-")}.json`;
  const path = join(backupDir, filename);
  const tempPath = `${path}.tmp`;
  const snapshot = { ...db, sessions: {} };
  const serialized = JSON.stringify(snapshot);
  await writeFile(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
  const verification = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(verification.nurseSurveys) || !Array.isArray(verification.doctorVisits)) throw new Error("Проверка резервной копии не пройдена");
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex");
  const restoreCheck = await verifyBackupRestore(verification, { pool: DATABASE_URL ? await pgPool() : null, directory: backupDir, collections: Object.keys(normalizedCollectionTables) });
  const files = (await readdir(backupDir)).filter((item) => /^e-clinic-.*\.json$/.test(item)).sort().reverse();
  for (const old of files.slice(14)) await unlink(join(backupDir, old)).catch(() => {});
  db.settings ||= {};
  db.settings.backupStatus = { createdAt, verifiedAt: new Date().toISOString(), verified: true, restoreCheck, checksum, filename, reason, retained: Math.min(files.length, 14) };
  await writeDb(db);
  return db.settings.backupStatus;
}

function dailyReportText(db) {
  const control = buildCareControl(db);
  const today = dateKey(new Date().toISOString());
  const nurses = control.nurseDaily.filter((row) => row.date === today);
  const screened = nurses.reduce((sum, row) => sum + row.screened, 0);
  const referred = nurses.reduce((sum, row) => sum + row.needsDoctor, 0);
  return [`E-Clinic — отчёт за ${today}`, `Осмотрено пациентов: ${screened}`, `Направлено к врачу: ${referred}`, `Ожидают врача всего: ${control.summary.awaitingDoctor}`, `Предупреждений по качеству данных: ${control.summary.qualityWarnings}`].join("\n");
}

async function sendTelegramReport(db, overrideChatId = "") {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN не настроен на сервере");
  const chatId = String(overrideChatId || db.settings?.dailyReports?.chatId || TELEGRAM_REPORT_CHAT_ID || "").trim();
  if (!chatId) throw new Error("Telegram Chat ID не указан");
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: dailyReportText(db) })
  });
  if (!response.ok) throw new Error("Telegram не принял отчёт");
  return { sentAt: new Date().toISOString(), chatIdMasked: chatId.length > 4 ? `***${chatId.slice(-4)}` : "***" };
}

async function sendDueTelegramReminders(db) {
  if (!TELEGRAM_BOT_TOKEN) return 0;
  const now = Date.now();
  let sentCount = 0;
  for (const reminder of db.reminderQueue || []) {
    if (reminder.status !== "queued" || reminder.channel !== "telegram" || !reminder.scheduledAt || new Date(reminder.scheduledAt).getTime() > now) continue;
    const survey = (db.nurseSurveys || []).find((item) => item.id === reminder.surveyId);
    const chatId = String(survey?.patient?.telegramChatId || "").trim();
    if (!survey?.patient?.reminderConsent || !chatId) { reminder.status = "blocked"; reminder.reason = "Нет согласия или Telegram Chat ID"; continue; }
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: reminder.message }) });
      if (!response.ok) throw new Error("Telegram не принял напоминание");
      reminder.status = "sent"; reminder.sentAt = new Date().toISOString(); reminder.reason = "Отправлено"; sentCount += 1;
    } catch (error) { reminder.status = "error"; reminder.reason = String(error.message || error).slice(0, 300); }
  }
  if (sentCount || (db.reminderQueue || []).some((item) => item.status === "error")) await writeDb(db);
  return sentCount;
}

function buildPublicOperationsMonitorRows(db) {
  const rows = buildOperationsMonitorRows(db);
  return {
    surveyRows: rows.surveyRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: "Пациент" })),
    visitRows: rows.visitRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: "Пациент" })),
    eventRows: rows.eventRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: row.patientName ? "Пациент" : "" }))
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildOperationsReportCsv(db, filters = {}) {
  const data = buildOperationsMonitor(db, filters);
  const lines = [];
  lines.push(["Раздел", "Дата", "Поликлиника", "Сотрудник", "Пациент", "Действие", "Детали"].map(csvCell).join(";"));
  for (const event of data.events) {
    lines.push(["Журнал", monitorDateTime(event.createdAt), event.clinic, event.actorName, event.patientName, event.type, event.details].map(csvCell).join(";"));
  }
  for (const survey of data.surveys) {
    lines.push(["Анкета", monitorDateTime(survey.createdAt), survey.clinic, survey.nurseName, survey.patientName, "Анкета пациента", `FINDRISC ${survey.findrisc}; СС риск ${survey.score2}%; нужен врач: ${survey.needsDoctor ? "да" : "нет"}`].map(csvCell).join(";"));
  }
  for (const visit of data.visits) {
    lines.push(["Осмотр", monitorDateTime(visit.createdAt), visit.clinic, visit.doctorName, visit.patientName, visit.hasAction ? "Осмотр с действиями" : "Осмотр без назначений", `Диагноз: ${visit.diagnosis}; направления: ${visit.referrals}; препараты: ${visit.drugs}; лаборатория: ${visit.labs}; повтор: ${visit.followUpDays}`].map(csvCell).join(";"));
  }
  return `\uFEFF${lines.join("\n")}`;
}

function buildTrainingAnswerKeysCsv() {
  const lines = [];
  lines.push(["Раздел", "Тест/задача", "Вопрос/ситуация", "Правильный ответ", "Текст правильного ответа", "Критерии"].map(csvCell).join(";"));
  for (const question of preTestQuestions) {
    lines.push([
      "До обучения",
      "Пре-тест",
      `${question.id}. ${question.text}`,
      question.answer,
      question.options?.[question.answer] || "",
      "1 балл за правильный ответ"
    ].map(csvCell).join(";"));
  }
  for (const task of postTrainingTasks) {
    const criteria = (task.criteria || []).join(" | ");
    if (task.mode === "findrisc") {
      for (const [field, label, expected] of task.fields || []) {
        lines.push(["После обучения", task.title, `${field}: ${label}`, expected, expected, criteria].map(csvCell).join(";"));
      }
      if (task.key) lines.push(["После обучения", task.title, "Ключ/разбор", "", task.key, criteria].map(csvCell).join(";"));
    } else if (task.mode === "singleCases") {
      for (const [index, item] of (task.cases || []).entries()) {
        const [caseText, expected] = item;
        lines.push(["После обучения", task.title, `${index + 1}. ${caseText}`, expected, expected, criteria].map(csvCell).join(";"));
      }
    } else if (task.mode === "routing") {
      for (const [index, item] of (task.cases || []).entries()) {
        const [caseText, specialist, urgency] = item;
        lines.push(["После обучения", task.title, `${index + 1}. ${caseText}`, `${specialist}; ${urgency}`, `Специалист: ${specialist}; срочность: ${urgency}`, criteria].map(csvCell).join(";"));
      }
    } else if (task.mode === "mcq") {
      for (const [index, question] of (task.questions || []).entries()) {
        lines.push([
          "После обучения",
          task.title,
          `${index + 1}. ${question.text}`,
          question.answer,
          question.options?.[question.answer] || "",
          criteria
        ].map(csvCell).join(";"));
      }
    } else {
      lines.push(["После обучения", task.title, task.description || "", "", task.key || "", criteria].map(csvCell).join(";"));
    }
  }
  return `\uFEFF${lines.join("\n")}`;
}

async function serveStatic(req, res, url) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const appRoutes = {
    "/": "/index.html",
    [ADMIN_APP_PATH]: "/admin.html",
    [DOCTOR_APP_PATH]: "/doctor.html",
    [SURVEY_APP_PATH]: "/survey.html",
    [TRAINING_APP_PATH]: "/training.html",
    [NURSE_TRAINING_APP_PATH]: "/nurse-training.html",
    [INVESTOR_APP_PATH]: "/investor.html",
    [MONITOR_APP_PATH]: "/monitor.html",
    [DIABETES_APP_PATH]: "/diabetes.html"
  };
  const hostHomeRoutes = {
    "admin.e-clinic-control.ru": "/admin.html",
    "doctor.e-clinic-control.ru": "/doctor.html",
    "survey.e-clinic-control.ru": "/survey.html",
    "training.e-clinic-control.ru": "/training.html",
    "nurse.e-clinic-control.ru": "/nurse-training.html",
    "investor.e-clinic-control.ru": "/investor.html",
    "monitor.e-clinic-control.ru": "/monitor.html",
    "diabetes.e-clinic-control.ru": "/diabetes.html"
  };
  const route = url.pathname === "/" && hostHomeRoutes[host] ? hostHomeRoutes[host] : appRoutes[url.pathname] || url.pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Нет доступа");
  try {
    if (route.startsWith('/help/') && extname(filePath) === '.mp4') {
      const { size } = await stat(filePath);
      const headers = { ...securityHeaders(), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) return send(res, 416, '', { 'Content-Range': `bytes */${size}` });
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return send(res, 416, '', { 'Content-Range': `bytes */${size}` });
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      res.writeHead(req.headers.range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      return stream.pipe(res);
    }
    const content = await readFile(filePath);
    const privatePages = new Set([
      "/admin.html",
      "/doctor.html",
      "/survey.html",
      "/training.html",
      "/nurse-training.html",
      "/investor.html",
      "/monitor.html",
      "/privacy-admin.html"
    ]);
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ...(privatePages.has(route) ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
      ...securityHeaders()
    });
    res.end(content);
  } catch {
    return send(res, 404, "Страница не найдена", { "X-Robots-Tag": "noindex, nofollow" });
  }
}

function getLanUrls() {
  const urls = [`http://localhost:${PORT}`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${PORT}`);
    }
  }
  return urls;
}

function dushanbeClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dushanbe", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

let maintenanceRunning = false;
async function runScheduledMaintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const db = await readDb();
    const clock = dushanbeClock();
    if (db.settings?.backupStatus?.createdAt?.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
      await createSecureBackup(db, "daily");
    }
    const reports = db.settings?.dailyReports;
    await sendDueTelegramReminders(db);
    if (reports?.enabled && reports.time === clock.time && reports.lastSentDate !== clock.date) {
      const sent = await sendTelegramReport(db);
      reports.lastSentDate = clock.date;
      reports.lastSentAt = sent.sentAt;
      reports.lastError = "";
      await writeDb(db);
    }
  } catch (error) {
    console.error("Scheduled maintenance failed:", error.message || error);
    try {
      const db = await readDb();
      if (db.settings?.dailyReports) {
        db.settings.dailyReports.lastError = String(error.message || error).slice(0, 300);
        await writeDb(db);
      }
    } catch {}
  } finally {
    maintenanceRunning = false;
  }
}

const server = createServer(async (req, res) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  if (isShuttingDown) return send(res, 503, { error: "Сервер перезагружается, повторите запрос" });
  const startedAt = Date.now();
  res.once("finish", () => {
    // Routine 404s are common from crawlers and status-endpoint probes. Do not
    // emit each one as a security warning (including its IP and requested path).
    // Authentication/security events and actionable 4xx/5xx responses remain logged.
    if (res.statusCode >= 400 && res.statusCode !== 404) {
      securityEvent("http_error_response", req, { statusCode: res.statusCode, durationMs: Date.now() - startedAt });
    }
  });
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!isTrustedStateChangingRequest(req)) {
      securityEvent("cross_site_request_blocked", req);
      return send(res, 403, { error: "Межсайтовый запрос заблокирован" });
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    securityEvent("application_error", req, { errorName: error?.name || "Error" });
    console.error(error);
    if ([400, 413].includes(error.statusCode)) {
      return send(res, error.statusCode, { error: error.message });
    }
    if (isDatabaseError(error)) {
      return send(res, 503, { error: "База данных временно недоступна", details: error.message || String(error) });
    }
    return send(res, 500, { error: "Ошибка сервера" });
  }
});

let isShuttingDown = false;

server.listen(PORT, HOST, () => {
  console.log("Medical QR system:");
  for (const baseUrl of getLanUrls()) {
    console.log(`  Admin:        ${baseUrl}${ADMIN_APP_PATH}`);
    console.log(`  Doctor:       ${baseUrl}${DOCTOR_APP_PATH}`);
    console.log(`  Patient form: ${baseUrl}${SURVEY_APP_PATH}`);
    console.log(`  Training:     ${baseUrl}${TRAINING_APP_PATH}`);
    console.log(`  Nurse test:   ${baseUrl}${NURSE_TRAINING_APP_PATH}`);
    console.log(`  Investor:     ${baseUrl}${INVESTOR_APP_PATH}`);
    console.log(`  Monitor:      ${baseUrl}${MONITOR_APP_PATH}`);
  }
  setTimeout(() => runScheduledMaintenance(), 5000);
  setInterval(() => runScheduledMaintenance(), 60 * 1000).unref();
});

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    console.log("HTTP server closed.");
    try {
      if (pgPoolPromise) {
        const pool = await pgPoolPromise;
        await pool.end();
        console.log("Database pool closed.");
      }
    } catch (err) {
      console.error("Error closing database pool:", err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

```

---

## public/app.js
```javascript
import { bindDraft, clearDraft, clearUserDrafts, helpPanel, historyPanel, waitingPanel } from './workflow-ui.js?v=20260924workflow';
const app = document.querySelector("#app");
const initialState = () => ({
  me: null,
  admin: null,
  adminLoading: false,
  adminLoadError: "",
  auditSurvey: null,
  auditSearch: "",
  auditClinic: "all",
  auditPage: 1,
  headNurseAuditSearch: "",
  careSearch: "",
  doctor: null,
  tab: "stats",
  doctorSection: "patients",
  selectedSurvey: null,
  doctorMode: "list",
  doctorRiskFirst: false,
  doctorPatientFilter: "all",
  doctorPatientSearch: "",
  doctorTaskFilter: "open",
  doctorPatientPage: 1,
  lastDoctorKey: null,
  lastSavedDoctorVisitId: "",
  doctorVisitNotice: "",
  surveyClinicFilter: "all",
  surveySearch: "",
  surveyPage: 1,
  trainingClinicFilter: ["all"],
  trainingDateFilter: "",
  trainingRegistrationDateFilter: "",
  trainingNameSort: "default",
  trainingPreStatusFilter: "all",
  trainingPostStatusFilter: "all",
  trainingAdminPage: 1,
  nurseTrainingNameSort: "default",
  nurseTrainingPreStatusFilter: "all",
  nurseTrainingPostStatusFilter: "all",
  nurseTrainingClinicFilter: ["all"],
  nurseTrainingDateFilter: "",
  nurseTrainingRegistrationDateFilter: "",
  nurseTrainingAdminPage: 1,
  investor: null,
  investorTab: "overview",
  monitor: null,
  monitorTab: "overview",
  monitorClinicFilter: "all",
  monitorNurseFilter: "all",
  monitorDoctorFilter: "all",
  monitorDateFilter: "",
  monitorReportFrom: "",
  monitorReportTo: ""
});
let state = initialState();
let offlineSurveyOnlineListenerBound = false;
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; document.querySelector('#installSurveyApp')?.removeAttribute('hidden'); });
let monitorRefreshTimer = null;
const ADMIN_APP_PATH = "/app-1-admin-panel";
const DOCTOR_APP_PATH = "/app-2-doctor";
const SURVEY_APP_PATH = "/app-3-patient-survey";
const TRAINING_APP_PATH = "/app-4-doctor-knowledge";
const NURSE_TRAINING_APP_PATH = "/app-5-nurse-knowledge";
const INVESTOR_APP_PATH = "/app-6-investor-dashboard";
const MONITOR_APP_PATH = "/app-7-operations-monitor";
const DIABETES_APP_PATH = "/app-8-diabetes-risk";

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const error = new Error(data.error || "Ошибка запроса");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (!contentType.includes("application/json")) throw new Error("Сервер вернул не JSON. Обновите страницу и попробуйте еще раз.");
  return data;
};
const shouldQueueOffline = (error) => !Number(error?.status) || Number(error.status) >= 500;

const html = (strings, ...values) => strings.map((part, i) => part + (values[i] ?? "")).join("");
const money = (value) => Number(value || 0).toLocaleString("ru-RU");
const fullName = (p) => [p?.lastName, p?.firstName, p?.middleName].filter(Boolean).join(" ");
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
const surveyClinic = (survey) => survey.patient?.clinic || survey.clinic || "Без поликлиники";
const OFFLINE_SURVEY_QUEUE_KEY = "medical-offline-nurse-surveys";
const OFFLINE_DOCTOR_QUEUE_KEY = "medical-offline-doctor-actions";
const TEST_LANGUAGE_KEY = "medical-training-language";
const SURVEY_LANGUAGE_KEY = "medical-survey-language";
const DOCTOR_LANGUAGE_KEY = "medical-doctor-language";
let nurseTrainingLanguagePromptShown = false;
let surveyLanguagePromptShown = false;
let doctorLanguagePromptShown = false;
const clinicSortKey = (value = "") => {
  const text = String(value);
  const number = text.match(/\d+/)?.[0];
  return number ? String(number).padStart(4, "0") : text.toLowerCase();
};
const clinicNumbers = Array.from({ length: 15 }, (_, index) => index + 1).filter((number) => ![3, 5, 6, 8, 13].includes(number));
const clinicOptions = clinicNumbers.map((number) => [`Поликлиника №${number}`, `Поликлиника №${number}`]);
const isExcludedClinicName = (value = "") => ["3", "5", "6", "8", "13"].includes(String(value).match(/\d+/)?.[0] || "");
const lifestyleRecommendations = {
  diabetesDiet: [
    "Основа питания: овощи, фрукты, бобовые, цельные злаки и нежирные источники белка.",
    "Ограничить свободные сахара, сладкие напитки и продукты с добавленным сахаром.",
    "Снизить насыщенные жиры и исключать трансжиры; выбирать растительные масла, рыбу и орехи по переносимости.",
    "Ограничить соль: для большинства взрослых цель - менее 5 г соли в сутки; контролировать размер порций и регулярность приемов пищи."
  ],
  physicalActivity: [
    "Не менее 150-300 минут умеренной аэробной активности в неделю или 75-150 минут интенсивной активности, если нет противопоказаний.",
    "Добавить упражнения для укрепления мышц 2 и более дней в неделю.",
    "Меньше сидеть: чаще вставать, ходить, использовать лестницу, постепенно увеличивать нагрузку.",
    "При осложнениях диабета, сердечно-сосудистых симптомах или высоком риске нагрузку подбирать индивидуально."
  ]
};
const doctorLabTests = [
  "Сахар крови",
  "Общий анализ крови",
  "Общий анализ мочи",
  "Холестерин общий",
  "ЛПНП",
  "ЛПВП",
  "Триглицериды",
  "HbA1c",
  "Креатинин",
  "СКФ",
  "АЛТ",
  "АСТ",
  "Билирубин",
  "Мочевина",
  "Калий",
  "Натрий",
  "ТТГ",
  "Свободный Т4",
  "Свободный Т3",
  "Инсулин",
  "С-пептид",
  "Кортизол",
  "Пролактин",
  "Тестостерон",
  "Другое"
];
const doctorLabTemplates = {
  "Общий анализ крови": ["Гемоглобин", "Эритроциты", "Лейкоциты", "Тромбоциты", "СОЭ"],
  "Общий анализ мочи": ["Белок", "Глюкоза", "Кетоны", "Лейкоциты", "Эритроциты", "Удельный вес"],
  "Сахар крови": ["Глюкоза натощак", "Глюкоза после еды", "HbA1c"]
};
const TAJIK_TEXT = {
  "Русский": "Русӣ",
  "Тоҷикӣ": "Тоҷикӣ",
  "Язык": "Забон",
  "Выберите язык": "Забонро интихоб кунед",
  "Продолжить": "Идома додан",
  "Опросник медсестры": "Пурсишномаи ҳамшира",
  "Кабинет врача": "Ҳуҷраи духтур",
  "Вход врача": "Воридшавии духтур",
  "Логин врача": "Логини духтур",
  "Специальный ключ": "Калиди махсус",
  "Войти": "Ворид шудан",
  "Картотека больных": "Картотекаи беморон",
  "Введите имя или фамилию": "Ном ё насабро ворид кунед",
  "Добавить пациента": "Илова кардани бемор",
  "Синхронизировать": "Ҳамоҳангсозӣ",
  "Ожидают синхронизации": "Интизори ҳамоҳангсозӣ",
  "Все записи отправлены.": "Ҳама сабтҳо фиристода шуданд.",
  "Интернет недоступен или сервер не ответил. Запись сохранена на этом устройстве и будет отправлена через синхронизацию.": "Интернет дастрас нест ё сервер ҷавоб надод. Сабт дар ин дастгоҳ нигоҳ дошта шуд ва тавассути ҳамоҳангсозӣ фиристода мешавад.",
  "Синхронизация завершена. Отправлено записей": "Ҳамоҳангсозӣ анҷом ёфт. Сабтҳои фиристодашуда",
  "Осталось без синхронизации": "Бе ҳамоҳангсозӣ боқӣ монд",
  "Попробуйте еще раз, когда интернет будет стабильным.": "Вақте интернет устувор мешавад, боз кӯшиш кунед.",
  "Анкета медсестры": "Анкетаи ҳамшира",
  "Данные пациента": "Маълумоти бемор",
  "Дата рождения": "Санаи таваллуд",
  "Артериальное давление": "Фишори хун",
  "Расчетный вес Rabito": "Вазни ҳисобии Rabito",
  "Причины направления": "Сабабҳои равонасозӣ",
  "Повторное обследование через сколько дней": "Муоинаи такрорӣ баъди чанд рӯз",
  "Повторное обследование": "Муоинаи такрорӣ",
  "дней": "рӯз",
  "Дополнительные лабораторные исследования": "Таҳқиқотҳои иловагии лабораторӣ",
  "Добавить анализ": "Илова кардани таҳлил",
  "Лабораторный анализ": "Таҳлили лабораторӣ",
  "Результат": "Натиҷа",
  "Удалить": "Нест кардан",
  "Сахар крови": "Қанди хун",
  "Общий анализ крови": "Таҳлили умумии хун",
  "Общий анализ мочи": "Таҳлили умумии пешоб",
  "Холестерин общий": "Холестерини умумӣ",
  "ЛПНП": "ЛПНП",
  "ЛПВП": "ЛПВП",
  "Триглицериды": "Триглисеридҳо",
  "HbA1c": "HbA1c",
  "Креатинин": "Креатинин",
  "СКФ": "СФГ",
  "АЛТ": "АЛТ",
  "АСТ": "АСТ",
  "Билирубин": "Билирубин",
  "Мочевина": "Мочевина",
  "Калий": "Калий",
  "Натрий": "Натрий",
  "ТТГ": "ТТГ",
  "Свободный Т4": "Т4 озод",
  "Свободный Т3": "Т3 озод",
  "Инсулин": "Инсулин",
  "С-пептид": "С-пептид",
  "Кортизол": "Кортизол",
  "Пролактин": "Пролактин",
  "Тестостерон": "Тестостерон",
  "Другое": "Дигар",
  "Гемоглобин": "Гемоглобин",
  "Эритроциты": "Эритроситҳо",
  "Лейкоциты": "Лейкоситҳо",
  "Тромбоциты": "Тромбоситҳо",
  "СОЭ": "СОЭ",
  "Белок": "Сафеда",
  "Глюкоза": "Глюкоза",
  "Кетоны": "Кетонҳо",
  "Удельный вес": "Вазни хос",
  "Глюкоза натощак": "Глюкоза ношто",
  "Глюкоза после еды": "Глюкоза баъди хӯрок",
  "Тип сахара": "Навъи қанд",
  "Натощак": "Ношто",
  "Случайный замер": "Ченкунии тасодуфӣ",
  "Через 2 часа после еды": "Пас аз 2 соати хӯрок",
  "Диагноз": "Ташхис",
  "Автоматически по сахару": "Ба таври худкор аз рӯи қанд",
  "Норма": "Меъёр",
  "Преддиабет": "Пешдиабет",
  "Сахарный диабет": "Диабети қанд",
  "Личный кабинет": "Кабинети шахсӣ",
  "Пациенты": "Беморон",
  "Статистика": "Омор",
  "Кабинет": "Кабинет",
  "К врачу": "Ба назди духтур",
  "Обычный риск": "Хавфи муқаррарӣ",
  "Сначала к врачу": "Аввал беморони ба духтур",
  "Сменить логин и пароль": "Иваз кардани логин ва парол",
  "Новый логин": "Логини нав",
  "Новый пароль / ключ": "Парол / калиди нав",
  "Оставьте пустым, если ключ менять не нужно": "Агар калидро иваз кардан лозим набошад, холӣ гузоред",
  "Сохранить логин и пароль": "Нигоҳ доштани логин ва парол",
  "Логин и пароль обновлены.": "Логин ва парол нав карда шуданд.",
  "Осмотренные пациенты": "Беморони муоинашуда",
  "Всего осмотров": "Ҳамагӣ муоинаҳо",
  "Пациентов": "Беморон",
  "История осмотров": "Таърихи муоинаҳо",
  "Последние осмотры": "Муоинаҳои охирин",
  "Статистика врача": "Омори духтур",
  "Осмотры по дням": "Муоинаҳо аз рӯи рӯзҳо",
  "Диагнозы": "Ташхисҳо",
  "Назначенные препараты": "Доруҳои таъйиншуда",
  "Предыдущие осмотры": "Муоинаҳои қаблӣ",
  "Пациент": "Бемор",
  "Дата": "Сана",
  "Назначения": "Таъйинот",
  "Лекарства": "Доруҳо",
  "Лаборатория": "Лаборатория",
  "Повторный осмотр": "Муоинаи такрорӣ",
  "Пока нет осмотров": "Ҳоло муоина нест",
  "Выберите пациента": "Беморро интихоб кунед",
  "После выбора откроется повторное измерение, направления и препараты.": "Пас аз интихоб ченкунии такрорӣ, равонасозӣ ва доруҳо кушода мешаванд.",
  "Анкет пока нет": "Ҳоло анкета нест",
  "Открыть": "Кушодан",
  "Далее": "Ба пеш",
  "Выйти": "Баромадан",
  "Заполните анкету пациента. Пациент будет добавлен в картотеку вашей поликлиники.": "Анкетаи беморро пур кунед. Бемор ба картотекаи поликлиникаи шумо илова мешавад.",
  "Отмена": "Бекор кардан",
  "Пациент добавлен. Анкета сохранена и отправлена администратору.": "Бемор илова шуд. Анкета нигоҳ дошта шуд ва ба маъмур фиристода шуд.",
  "Вес по весам, кг": "Вазн бо тарозу, кг",
  "Уровень сахара в крови, ммоль/л": "Сатҳи қанди хун, ммол/л",
  "Повторное САД": "Фишори систоликии такрорӣ",
  "Повторное ДАД": "Фишори диастоликии такрорӣ",
  "Направление": "Равонасозӣ",
  "Эндокринолог": "Эндокринолог",
  "Кардиолог": "Кардиолог",
  "План лечения": "Нақшаи табобат",
  "Препараты для СД 2 типа": "Доруҳо барои диабети қанд навъи 2",
  "Препараты для артериальной гипертензии": "Доруҳо барои фишорбаландии артериалӣ",
  "Рекомендации пациенту": "Тавсияҳо ба бемор",
  "Диета при сахарном диабете": "Парҳез ҳангоми диабети қанд",
  "Специальные физические упражнения": "Машқҳои махсуси ҷисмонӣ",
  "Физическая активность": "Фаъолияти ҷисмонӣ",
  "Сохранить осмотр": "Нигоҳ доштани муоина",
  "Осмотр сохранён и отправлен администратору.": "Муоина нигоҳ дошта шуд ва ба маъмур фиристода шуд.",
  "Осмотр сохранён. Лекарства и анализы показаны ниже в разделе «Предыдущие осмотры».": "Муоина нигоҳ дошта шуд. Доруҳо ва таҳлилҳо дар поён, дар бахши «Муоинаҳои қаблӣ» нишон дода шудаанд.",
  "Меньше сидеть: чаще вставать, ходить, использовать лестницу, постепенно увеличивать нагрузку.": "Камтар нишастан: бештар хестан, роҳ рафтан, аз зина истифода бурдан ва тадриҷан зиёд кардани сарборӣ.",
  "При осложнениях диабета, сердечно-сосудистых симптомах или высоком риске нагрузку подбирать индивидуально.": "Ҳангоми оризаҳои диабет, нишонаҳои дилу раг ё хавфи баланд, сарборӣ бояд инфиродӣ интихоб шавад.",
  "Основа питания: овощи, фрукты, бобовые, цельные злаки и нежирные источники белка.": "Асоси ғизо: сабзавот, мева, лӯбиёгиҳо, ғалладонаҳои бутун ва манбаъҳои камравғани сафеда.",
  "Ограничить свободные сахара, сладкие напитки и продукты с добавленным сахаром.": "Шакарҳои озод, нӯшокиҳои ширин ва маҳсулоти дорои шакари иловашударо маҳдуд кардан.",
  "Снизить насыщенные жиры и исключать трансжиры; выбирать растительные масла, рыбу и орехи по переносимости.": "Равғанҳои сершударо кам ва трансравғанҳоро хориҷ кардан; равғанҳои растанӣ, моҳӣ ва чормағзро мувофиқи таҳаммул интихоб кардан.",
  "Ограничить соль: для большинства взрослых цель - менее 5 г соли в сутки; контролировать размер порций и регулярность приемов пищи.": "Намакро маҳдуд кардан: барои аксари калонсолон ҳадаф камтар аз 5 г намак дар як рӯз аст; андозаи порсия ва мунтазамии хӯрокро назорат кардан.",
  "Не менее 150-300 минут умеренной аэробной активности в неделю или 75-150 минут интенсивной активности, если нет противопоказаний.": "На камтар аз 150-300 дақиқа фаъолияти аэробии миёна дар як ҳафта ё 75-150 дақиқа фаъолияти шадид, агар зиднишондод набошад.",
  "Добавить упражнения для укрепления мышц 2 и более дней в неделю.": "Машқҳои мустаҳкамкунии мушакҳоро 2 ё бештар рӯз дар як ҳафта илова кардан.",
  "Паспортная часть": "Қисми шиносномавӣ",
  "Фамилия": "Насаб",
  "Имя": "Ном",
  "Отчество": "Номи падар",
  "Дата рождения": "Санаи таваллуд",
  "Пол": "Ҷинс",
  "Женский": "Зан",
  "Мужской": "Мард",
  "Возраст": "Синну сол",
  "Телефон": "Телефон",
  "Адрес": "Суроға",
  "Поликлиника пациента": "Поликлиникаи бемор",
  "Рост, см": "Қад, см",
  "Индекс массы тела": "Индекси массаи бадан",
  "Введите вес по весам. ИМТ рассчитается автоматически по весу и росту.": "Вазнро аз рӯи тарозу ворид кунед. Индекси массаи бадан аз рӯи вазн ва қад худкор ҳисоб мешавад.",
  "Если взвесить пациента нельзя, оставьте вес пустым и заполните окружности для расчёта Rabito.": "Агар беморро баркашидан имкон надошта бошад, вазнро холӣ монед ва даври бозу ва соқро барои ҳисоби Rabito ворид кунед.",
  "Окружность талии нужна для FINDRISC при любом способе определения веса.": "Даври миён барои FINDRISC дар ҳар ду усули муайян кардани вазн лозим аст.",
  "Введите число больше нуля": "Адади аз сифр калонро ворид кунед",
  "Слишком большое значение": "Қимат аз ҳад зиёд аст",
  "Проверьте вес и рост: ИМТ не должен превышать 100": "Вазн ва қадро санҷед: индекси массаи бадан набояд аз 100 зиёд бошад",
  "Проверьте окружности для расчёта веса": "Андозаҳои даври баданро барои ҳисоби вазн санҷед",
  "Физическая активность 30 минут в день": "Фаъолияти ҷисмонӣ 30 дақиқа дар рӯз",
  "Выберите ответ": "Ҷавобро интихоб кунед",
  "Выберите поликлинику": "Поликлиникаро интихоб кунед",
  "Не заполнено обязательное поле": "Майдони ҳатмӣ пур нашудааст",
  "Заполните это поле и снова нажмите «Отправить анкету».": "Ин майдонро пур кунед ва боз «Фиристодани анкета»-ро пахш кунед.",
  "Да": "Ҳа",
  "Нет": "Не",
  "Овощи/фрукты ежедневно": "Сабзавот/мева ҳар рӯз",
  "Принимал препараты от давления": "Доруҳои фишорро қабул мекард",
  "Когда-либо был высокий сахар": "Ягон вақт қанди баланд дошт",
  "Диабет у родственников": "Диабет дар хешовандон",
  "Да, 2 линия": "Ҳа, хешовандони дараҷаи 2",
  "Да, 1 линия": "Ҳа, хешовандони дараҷаи 1",
  "Курение": "Тамокукашӣ",
  "Систолическое АД": "Фишори систоликӣ",
  "Диастолическое АД": "Фишори диастоликӣ",
  "Сердечно-сосудистый риск": "Хавфи дилу раг",
  "Формула Rabito": "Формулаи Rabito",
  "Окружность плеча, см": "Даври бозу, см",
  "Окружность живота/талия, см": "Даври шикам/миён, см",
  "Окружность голени, см": "Даври соқ, см",
  "Расчётный вес Rabito, кг": "Вазни ҳисобии Rabito, кг",
  "Уровень сахара": "Сатҳи қанд",
  "Отправить анкету": "Фиристодани анкета",
  "Синхронизировать": "Ҳамоҳангсозӣ",
  "Интернет недоступен или сервер не ответил. Анкета сохранена на этом устройстве и будет отправлена через кнопку синхронизации.": "Интернет дастрас нест ё сервер ҷавоб надод. Анкета дар ин дастгоҳ нигоҳ дошта шуд ва тавассути тугмаи ҳамоҳангсозӣ фиристода мешавад.",
  "Повышенный риск": "Хавфи баланд",
  "Слегка повышенный": "Каме баланд",
  "Низкий": "Паст",
  "Умеренный": "Миёна",
  "Высокий": "Баланд",
  "Очень высокий": "Хеле баланд",
  "баллов": "хол",
  "факторы": "омилҳо",
  "возраст": "синну сол",
  "мужской пол": "ҷинси мард",
  "курение": "тамокукашӣ",
  "повышенное САД": "фишори систоликии баланд",
  "Систолическое АД": "Фишори систоликӣ",
  "мм рт.ст.": "мм сут. сим.",
  "Направить к врачу.": "Ба духтур равона карда шавад.",
  "Причина": "Сабаб",
  "Повышенный риск не выявлен.": "Хавфи баланд муайян нашуд.",
  "Ожидают синхронизации": "Интизори ҳамоҳангсозӣ",
  "Все анкеты отправлены.": "Ҳама анкетаҳо фиристода шуданд.",
  "Отправлено": "Фиристода шуд",
  "Осталось без синхронизации": "Бе ҳамоҳангсозӣ боқӣ монд",
  "Попробуйте еще раз, когда интернет будет стабильным.": "Вақте интернет устувор мешавад, боз кӯшиш кунед.",
  "Синхронизация завершена. Отправлено анкет": "Ҳамоҳангсозӣ анҷом ёфт. Анкетаҳои фиристодашуда",
  "№5 Тесты медсестер": "№5 Тестҳои ҳамшираҳо",
  "Найдите свое имя. Сначала пройдите тест до обучения, после семинара - тест после обучения. Порог 70% действует только для теста после обучения.": "Ному насаби худро ёбед. Аввал тестро пеш аз омӯзиш супоред, баъди семинар тестро баъди омӯзиш супоред. Ҳадди 70% танҳо барои тест баъди омӯзиш амал мекунад.",
  "Введите фамилию или имя": "Насаб ё номро ворид кунед",
  "Администратор еще не зарегистрировал медсестер.": "Маъмур ҳоло ҳамшираҳоро сабт накардааст.",
  "Участник не найден": "Иштирокчӣ ёфт нашуд",
  "Медсестра": "Ҳамшира",
  "До обучения": "Пеш аз омӯзиш",
  "После обучения": "Баъди омӯзиш",
  "не сдан": "супорида нашудааст",
  "Открыть": "Кушодан",
  "К списку": "Ба рӯйхат",
  "Пройден": "Супорида шуд",
  "Не пройден": "Супорида нашуд",
  "Этот тест уже сдан": "Ин тест аллакай супорида шудааст",
  "Для прохождения нужно набрать 70% или больше.": "Барои гузаштан 70% ё бештар гирифтан лозим аст.",
  "Порог прохождения для теста до обучения не применяется.": "Барои тести пеш аз омӯзиш ҳадди гузариш истифода намешавад.",
  "Ваш результат": "Натиҷаи шумо",
  "Тест пройден.": "Тест супорида шуд.",
  "Тест не пройден. Нужно 70% и выше.": "Тест супорида нашуд. 70% ва бештар лозим аст.",
  "Выберите правильный вариант": "Ҷавоби дурустро интихоб кунед",
  "Тест до обучения": "Тест пеш аз омӯзиш",
  "Тест после обучения": "Тест баъди омӯзиш",
  "Тесты после обучения": "Тестҳо баъди омӯзиш",
  "Тесты после обучения отправлены": "Тестҳои баъди омӯзиш фиристода шуданд",
  "Тест отправлен": "Тест фиристода шуд",
  "Отправить ответы": "Фиристодани ҷавобҳо",
  "Отправить тест": "Фиристодани тест",
  "Отправить тесты после обучения": "Фиристодани тестҳои баъди омӯзиш",
  "Назад": "Бозгашт",
  "Назад к списку": "Бозгашт ба рӯйхат",
  "Вернуться": "Баргаштан",
  "Участник": "Иштирокчӣ",
  "Куда направить": "Ба куҷо равона кардан",
  "Срочность": "Фаврият",
  "Высокий риск": "Хавфи баланд",
  "Низкий риск": "Хавфи паст",
  "кардиолог": "кардиолог",
  "эндокринолог": "эндокринолог",
  "хирург": "ҷарроҳ",
  "нефролог": "нефролог",
  "экстренно": "фавран",
  "неотложно": "таъҷилан",

  "Основной механизм развития СД2 включает:": "Механизми асосии пайдоиши диабети қанд навъи 2 дар бар мегирад:",
  "Абсолютный дефицит инсулина с первого дня заболевания": "Норасоии мутлақи инсулин аз рӯзи аввали беморӣ",
  "Инсулинорезистентность и прогрессирующую дисфункцию бета-клеток": "Муқовимат ба инсулин ва сустшавии тадриҷии кори ҳуҷайраҳои бета",
  "Только аутоиммунное разрушение бета-клеток": "Танҳо вайроншавии аутоиммунии ҳуҷайраҳои бета",
  "Только повышение глюкагона без роли инсулина": "Танҳо зиёдшавии глюкагон бе нақши инсулин",
  "Кардиометаболический риск у пациента с СД2 и АГ обычно:": "Хавфи кардиометаболикӣ дар бемори дорои диабети қанд навъи 2 ва фишорбаландӣ одатан:",
  "Ниже, чем у пациента без диабета": "Аз бемори бе диабет пасттар аст",
  "Не зависит от уровня АД": "Аз сатҳи фишори хун вобаста нест",
  "Выше и требует активного выявления факторов риска": "Баландтар аст ва муайянкунии фаъоли омилҳои хавфро талаб мекунад",
  "Оценивается только после инфаркта": "Танҳо баъди инфаркт баҳогузорӣ мешавад",
  "FINDRISC применяется для:": "FINDRISC барои чӣ истифода мешавад:",
  "Диагностики диабетической нефропатии": "Ташхиси нефропатияи диабетӣ",
  "Оценки риска развития СД2": "Арзёбии хавфи пайдоиши диабети қанд навъи 2",
  "Подбора дозы инсулина": "Интихоби вояи инсулин",
  "Диагностики тиреотоксикоза": "Ташхиси тиреотоксикоз",
  "При высоком риске по FINDRISC врач ПМСП должен:": "Ҳангоми хавфи баланд аз рӯи FINDRISC духтури КАТС бояд:",
  "Сразу назначить инсулин": "Дарҳол инсулин таъин кунад",
  "Направить на лабораторное подтверждение нарушений углеводного обмена и провести профилактическое консультирование": "Барои тасдиқи лаборатории вайроншавии мубодилаи карбогидратҳо равона кунад ва машварати пешгирикунанда гузаронад",
  "Ничего не делать без жалоб": "Агар шикоят набошад, ҳеҷ кор накунад",
  "Повторить FINDRISC через 5 лет": "FINDRISC-ро баъди 5 сол такрор кунад",
  "К диагностическому уровню глюкозы плазмы натощак для СД относится:": "Ба сатҳи ташхисии глюкозаи плазма дар ҳолати ношто барои диабет дохил мешавад:",
  ">=5,0 ммоль/л": ">=5,0 ммол/л",
  ">=5,6 ммоль/л": ">=5,6 ммол/л",
  ">=6,1 ммоль/л": ">=6,1 ммол/л",
  ">=7,0 ммоль/л": ">=7,0 ммол/л",
  "HbA1c, соответствующий диагностическому порогу СД, обычно составляет:": "HbA1c, ки ба меъёри ташхисии диабет мувофиқ аст, одатан:",
  ">=5,0%": ">=5,0%",
  ">=5,7%": ">=5,7%",
  ">=6,5%": ">=6,5%",
  ">=8,5%": ">=8,5%",
  "Офисное АД, требующее подтверждения диагноза АГ при повторных измерениях:": "Фишори хуни дар қабулгоҳ ченшуда, ки барои тасдиқи гипертония ченкунии такрориро талаб мекунад:",
  ">=120/80 мм рт.ст.": ">=120/80 мм сут. сим.",
  ">=130/80 мм рт.ст.": ">=130/80 мм сут. сим.",
  ">=140/90 мм рт.ст.": ">=140/90 мм сут. сим.",
  ">=160/100 мм рт.ст. только при жалобах": ">=160/100 мм сут. сим. танҳо ҳангоми шикоят",
  "Предиабет важен для семейного врача, потому что:": "Предиабет барои духтури оилавӣ муҳим аст, зеро:",
  "Не требует наблюдения": "Назорат талаб намекунад",
  "Является стадией повышенного риска СД2 и сердечно-сосудистых осложнений": "Марҳилаи хавфи баланд барои диабети қанд навъи 2 ва оризаҳои дилу раг мебошад",
  "Всегда требует немедленного инсулина": "Ҳамеша инсулини фавриро талаб мекунад",
  "Не связан с ожирением": "Бо фарбеҳӣ алоқаманд нест",
  "К микрососудистым осложнениям СД относятся:": "Ба оризаҳои майдараги диабет дохил мешаванд:",
  "Ретинопатия, нефропатия, нейропатия": "Ретинопатия, нефропатия, нейропатия",
  "Инфаркт миокарда и инсульт": "Инфаркти миокард ва сактаи майна",
  "Только ожирение": "Танҳо фарбеҳӣ",
  "Только артериальная гипертензия": "Танҳо фишорбаландии артериалӣ",
  "К макрососудистым осложнениям СД относятся:": "Ба оризаҳои калонраги диабет дохил мешаванд:",
  "Катаракта и анемия": "Катаракта ва камхунӣ",
  "Инфаркт миокарда, инсульт, поражение периферических артерий": "Инфаркти миокард, сактаи майна ва осеби рагҳои канорӣ",
  "Только нейропатия": "Танҳо нейропатия",
  "Только гипогликемия": "Танҳо гипогликемия",
  "При каждом визите пациента с СД2 и АГ врач ПМСП должен оценивать:": "Дар ҳар ташрифи бемори дорои диабети қанд навъи 2 ва фишорбаландӣ духтури КАТС бояд арзёбӣ кунад:",
  "Только температуру тела": "Танҳо ҳарорати баданро",
  "АД, приверженность, побочные эффекты, симптомы осложнений": "Фишори хун, риояи табобат, таъсирҳои номатлуб ва нишонаҳои оризаҳоро",
  "Только массу тела один раз в 5 лет": "Танҳо вазни баданро як бор дар 5 сол",
  "Только жалобы на жажду": "Танҳо шикоят аз ташнагиро",
  "Индивидуальный план ведения пациента должен включать:": "Нақшаи инфиродии бурдани бемор бояд дар бар гирад:",
  "Только диагноз": "Танҳо ташхисро",
  "Цели, лечение, мониторинг, сроки контроля, маршрутизацию": "Ҳадафҳо, табобат, мониторинг, муҳлати назорат ва равонасозиро",
  "Только список лекарств": "Танҳо рӯйхати доруҳоро",
  "Только рекомендацию соблюдать диету": "Танҳо тавсияи риояи парҳезро",
  "Немедикаментозная тактика при СД2 и АГ включает:": "Тадбирҳои ғайридоруӣ ҳангоми диабети қанд навъи 2 ва фишорбаландӣ дар бар мегиранд:",
  "Отмену физической активности": "Қатъ кардани фаъолияти ҷисмонӣ",
  "Контроль массы тела, питание, физическую активность, ограничение соли, отказ от курения": "Назорати вазн, ғизои солим, фаъолияти ҷисмонӣ, маҳдуд кардани намак ва даст кашидан аз тамоку",
  "Только постельный режим": "Танҳо реҷаи бистарӣ",
  "Исключение всех углеводов без оценки состояния": "Хориҷ кардани ҳамаи карбогидратҳо бе арзёбии ҳолат",
  "Срочного направления требует:": "Равонасозии фаврӣ талаб мекунад:",
  "Стабильное АД 130/80 без жалоб": "Фишори устувори 130/80 бе шикоят",
  "Симптомы гипертонического криза/острого поражения органов-мишеней": "Нишонаҳои буҳрони гипертоникӣ ё осеби шадиди узвҳои ҳадаф",
  "FINDRISC 7 баллов без жалоб": "FINDRISC 7 хол бе шикоят",
  "Плановый контроль HbA1c": "Назорати нақшавии HbA1c",
  "Пациент с СД2 должен наблюдаться на уровне ПМСП:": "Бемори дорои диабети қанд навъи 2 бояд дар сатҳи КАТС назорат шавад:",
  "Только при наличии осложнений": "Танҳо ҳангоми мавҷудияти оризаҳо",
  "Регулярно, с контролем факторов риска и осложнений": "Мунтазам, бо назорати омилҳои хавф ва оризаҳо",
  "Только один раз после постановки диагноза": "Танҳо як маротиба баъди гузоштани ташхис",
  "Только у эндокринолога без участия семейного врача": "Танҳо назди эндокринолог, бе иштироки духтури оилавӣ",
  "Коммуникация врача с пациентом при НИЗ должна быть:": "Муоширати духтур бо бемор ҳангоми бемориҳои ғайрисироятӣ бояд:",
  "Приказной без объяснений": "Фармондиҳанда ва бе шарҳ бошад",
  "Понятной, уважительной, с вовлечением пациента в план лечения": "Фаҳмо, эҳтиромона ва бо ҷалби бемор ба нақшаи табобат бошад",
  "Только письменной": "Танҳо хаттӣ бошад",
  "Направленной только на родственников": "Танҳо ба хешовандон равона шавад",
  "При подозрении на впервые выявленный СД2 врач должен:": "Ҳангоми гумони диабети қанд навъи 2, ки нав ошкор шудааст, духтур бояд:",
  "Игнорировать результат при отсутствии жалоб": "Агар шикоят набошад, натиҷаро нодида гирад",
  "Подтвердить диагноз лабораторно и оценить сопутствующие риски": "Ташхисро лабораторӣ тасдиқ кунад ва хавфҳои ҳамроҳро арзёбӣ намояд",
  "Назначить антибиотики": "Антибиотик таъин кунад",
  "Отменить все лекарства от АГ": "Ҳама доруҳои фишорбаландиро қатъ кунад",
  "При СД2 и АГ особенно важно:": "Ҳангоми диабети қанд навъи 2 ва фишорбаландӣ махсусан муҳим аст:",
  "Лечить только сахар": "Танҳо қандро табобат кардан",
  "Одновременно контролировать гликемию, АД, липиды, массу тела и образ жизни": "Ҳамзамон қанд, фишори хун, липидҳо, вазн ва тарзи ҳаётро назорат кардан",
  "Исключить мониторинг почек": "Мониторинги гурдаҳоро хориҷ кардан",
  "Не оценивать риск ССЗ": "Хавфи бемориҳои дилу рагро арзёбӣ накардан",
  "Правильная маршрутизация означает:": "Равонасозии дуруст маънои онро дорад:",
  "Направлять всех пациентов только в стационар": "Ҳама беморонро танҳо ба беморхона фиристодан",
  "Определять уровень помощи, срочность и обратную связь с ПМСП": "Сатҳи ёрӣ, фаврият ва робитаи бозгашт бо КАТС-ро муайян кардан",
  "Не фиксировать направление в карте": "Равонаро дар корт сабт накардан",
  "Не объяснять пациенту дальнейшие шаги": "Қадамҳои минбаъдаро ба бемор шарҳ надодан",
  "Практический разбор клинического случая нужен для оценки:": "Баррасии амалии ҳолати клиникӣ барои арзёбии чӣ лозим аст:",
  "Только памяти участника": "Танҳо хотираи иштирокчӣ",
  "Умения применять знания к реальному пациенту и принимать решения": "Қобилияти истифодаи дониш дар бемори воқеӣ ва қабули қарор",
  "Только скорости письма": "Танҳо суръати навиштан",
  "Только посещаемости": "Танҳо иштирок",

  "Практическая задача по FINDRISC": "Масъалаи амалӣ аз рӯи FINDRISC",
  "Возраст, 52 года": "Синну сол, 52 сол",
  "ИМТ 31 кг/м2": "ИМТ 31 кг/м2",
  "Окружность талии 104 см, мужчина": "Даври миён 104 см, мард",
  "Физическая активность <30 мин/день": "Фаъолияти ҷисмонӣ <30 дақиқа дар рӯз",
  "Овощи/фрукты не ежедневно": "Сабзавот/мева ҳар рӯз не",
  "Антигипертензивная терапия: да": "Табобати зиддифишорӣ: ҳа",
  "Повышение глюкозы ранее: нет": "Баландшавии глюкоза қаблан: не",
  "Семейный анамнез СД: мать с СД2": "Анамнези оилавии диабет: модар диабети қанд навъи 2 дорад",
  "ИТОГО: категория риска": "Ҳамагӣ: категорияи хавф",
  "Мужчина 52 лет, ИМТ 31 кг/м2, окружность талии 104 см, физическая активность менее 30 минут в день, овощи/фрукты ежедневно не употребляет, получает препараты от АГ, ранее повышенная глюкоза не выявлялась, у матери был СД2.": "Мард, 52 сола. ИМТ 31 кг/м2, даври миён 104 см. Фаъолияти ҷисмонӣ камтар аз 30 дақиқа дар рӯз, сабзавот/меваро ҳар рӯз истеъмол намекунад, доруҳои зидди фишорбаландӣ мегирад, қаблан баландшавии глюкоза ошкор нашудааст, модараш диабети қанд навъи 2 дошт.",
  "Диагностические мини-задачи: СД2, предиабет и АГ": "Масъалаҳои кӯтоҳи ташхисӣ: диабети қанд навъи 2, предиабет ва фишорбаландӣ",
  "Сахарный диабет 2 типа": "Диабети қанд навъи 2",
  "Нарушенная гликемия натощак": "Вайроншавии гликемияи ношто",
  "Повышение артериального давления": "Баландшавии фишори хун",
  "Женщина 48 лет, ИМТ 32. Глюкоза плазмы натощак 7,2 ммоль/л при повторном анализе. Жалоб нет.": "Зан, 48 сола, ИМТ 32. Глюкозаи плазма ношто 7,2 ммол/л дар таҳлили такрорӣ. Шикоят надорад.",
  "Мужчина 55 лет. Глюкоза натощак 6,4 ммоль/л, HbA1c 6,0%.": "Мард, 55 сола. Глюкоза ношто 6,4 ммол/л, HbA1c 6,0%.",
  "Женщина 61 год. HbA1c 6,8%, АД на приеме 152/94 мм рт.ст., повторно 148/92.": "Зан, 61 сола. HbA1c 6,8%, фишори хун дар қабул 152/94 мм сут. сим., такроран 148/92.",
  "Мужчина 45 лет. Разовое АД 145/90 после стресса, повторных измерений нет.": "Мард, 45 сола. Як маротиба пас аз стресс фишор 145/90, ченкунии такрорӣ нест.",
  "Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л.": "Зан, 58 сола, ташнагӣ ва пешобкунии зиёд. Глюкозаи тасодуфӣ 12,4 ммол/л.",
  "Клиническая задача и индивидуальный план ведения пациента": "Масъалаи клиникӣ ва нақшаи инфиродии бурдани бемор",
  "Женщина 56 лет, впервые выявленный СД2. HbA1c 8,1%, глюкоза натощак 8,5 ммоль/л, АД 150/95 мм рт.ст. при повторных измерениях, ИМТ 33 кг/м2, окружность талии 102 см. Курит. Жалуется на утомляемость. Ретинопатия не оценивалась. Лекарств от СД ранее не получала.": "Зан, 56 сола, диабети қанд навъи 2 бори аввал ошкор шудааст. HbA1c 8,1%, глюкоза ношто 8,5 ммол/л, фишори хун дар ченкунии такрорӣ 150/95 мм сут. сим., ИМТ 33 кг/м2, даври миён 102 см. Тамоку мекашад. Аз хастагӣ шикоят мекунад. Ретинопатия арзёбӣ нашудааст. Қаблан доруи диабет нагирифтааст.",
  "Основной диагноз и сопутствующие состояния": "Ташхиси асосӣ ва ҳолатҳои ҳамроҳ",
  "Сахарный диабет 2 типа, ожирение": "Диабети қанд навъи 2, фарбеҳӣ",
  "Сахарный диабет 2 типа, впервые выявленный, декомпенсированный. Ожирение 1 степени (абдоминальное). Артериальная гипертензия 2 степени.": "Диабети қанд навъи 2, бори аввал ошкоршуда, декомпенсатсияшуда. Фарбеҳии дараҷаи 1, абдоминалӣ. Фишорбаландии артериалӣ дараҷаи 2.",
  "Метаболический синдром, преддиабет": "Синдроми метаболикӣ, предиабет",
  "Сахарный диабет 2 типа, артериальная гипертензия": "Диабети қанд навъи 2, фишорбаландии артериалӣ",
  "Ожирение, никотиновая зависимость": "Фарбеҳӣ, вобастагӣ ба никотин",
  "Факторы риска и уровень кардиометаболического риска": "Омилҳои хавф ва сатҳи хавфи кардиометаболикӣ",
  "Средний риск": "Хавфи миёна",
  "Очень высокий кардиометаболический риск (СД2 + АГ + ожирение + курение + возраст)": "Хавфи бисёр баланди кардиометаболикӣ (диабети қанд навъи 2 + фишорбаландӣ + фарбеҳӣ + тамоку + синну сол)",
  "Только высокий риск по ожирению": "Танҳо хавфи баланд аз рӯи фарбеҳӣ",
  "Риск не определяется на ПМСП": "Хавф дар сатҳи КАТС муайян намешавад",
  "Индивидуальные цели лечения": "Ҳадафҳои инфиродии табобат",
  "HbA1c < 8,0%, АД < 140/90": "HbA1c < 8,0%, фишори хун < 140/90",
  "HbA1c < 7,0%, АД < 130/80 мм рт.ст., снижение веса >= 5-10%": "HbA1c < 7,0%, фишори хун < 130/80 мм сут. сим., кам кардани вазн >= 5-10%",
  "HbA1c < 6,5%, АД < 120/70": "HbA1c < 6,5%, фишори хун < 120/70",
  "Только нормализация глюкозы натощак": "Танҳо ба меъёр овардани глюкозаи ношто",
  "Нет четких целей на старте": "Дар оғоз ҳадафҳои дақиқ нест",
  "Немедикаментозные рекомендации": "Тавсияҳои ғайридоруӣ",
  "Только отказ от курения": "Танҳо даст кашидан аз тамоку",
  "Снижение массы тела, низкоуглеводная диета, увеличение физической активности до 150 мин/нед, полный отказ от курения": "Кам кардани вазн, парҳези камкарбогидрат, зиёд кардани фаъолияти ҷисмонӣ то 150 дақиқа дар ҳафта, пурра даст кашидан аз тамоку",
  "Только диета": "Танҳо парҳез",
  "Лечебная физкультура 2 раза в неделю": "Машқҳои табобатӣ 2 маротиба дар ҳафта",
  "Ничего не назначать до эндокринолога": "То машварати эндокринолог чизе таъин накардан",
  "Медикаментозная тактика по СД2": "Тактикаи доругӣ барои диабети қанд навъи 2",
  "Сразу инсулин": "Дарҳол инсулин",
  "Метформин (начать с 500 мг 2 раза в день, титровать до 2000 мг/сут)": "Метформин (оғоз аз 500 мг 2 маротиба дар рӯз, тадриҷан то 2000 мг/рӯз)",
  "Гликлазид": "Гликлазид",
  "Только изменение образа жизни в течение 3 месяцев": "Танҳо тағйири тарзи ҳаёт дар давоми 3 моҳ",
  "SGLT2-ингибитор в качестве монотерапии": "Ингибитори SGLT2 ҳамчун монотерапия",
  "Медикаментозная тактика по АГ": "Тактикаи доругӣ барои фишорбаландӣ",
  "Только амлодипин": "Танҳо амлодипин",
  "Ингибитор АПФ (периндоприл) или БРА + амлодипин (комбинированная терапия)": "Ингибитори АПФ (периндоприл) ё БРА + амлодипин (табобати якҷоя)",
  "Бета-блокатор": "Бета-блокатор",
  "Только диуретик": "Танҳо диуретик",
  "Начинать монотерапию": "Оғоз бо монотерапия",
  "Мониторинг гликемии, АД, массы тела": "Мониторинги гликемия, фишори хун ва вазн",
  "1 раз в 3 месяца": "1 маротиба дар 3 моҳ",
  "Самоконтроль глюкозы 2-3 раза в неделю, АД ежедневно, вес 1 раз в неделю. Контроль в ПМСП через 2 недели": "Худназоратии глюкоза 2-3 маротиба дар ҳафта, фишори хун ҳар рӯз, вазн 1 маротиба дар ҳафта. Назорат дар КАТС баъди 2 ҳафта",
  "Только HbA1c через 3 месяца": "Танҳо HbA1c баъди 3 моҳ",
  "Контроль только на приеме": "Назорат танҳо ҳангоми қабул",
  "Мониторинг не требуется": "Мониторинг лозим нест",
  "Скрининг осложнений СД": "Скрининги оризаҳои диабет",
  "Только через год": "Танҳо баъди як сол",
  "Осмотр глазного дна (офтальмолог), ACR, eGFR, оценка стоп и неврологический статус - в ближайшее время": "Муоинаи қаъри чашм (офтальмолог), ACR, eGFR, арзёбии пойҳо ва ҳолати неврологӣ - дар наздиктарин вақт",
  "Только ЭКГ": "Танҳо ЭКГ",
  "Только УЗИ почек": "Танҳо УЗИ гурдаҳо",
  "Скрининг не нужен при впервые выявленном СД": "Ҳангоми диабети нав ошкоршуда скрининг лозим нест",
  "Сроки повторного визита": "Муҳлати ташрифи такрорӣ",
  "Через 1 месяц": "Баъди 1 моҳ",
  "Через 10-14 дней": "Баъди 10-14 рӯз",
  "Через 3 месяца": "Баъди 3 моҳ",
  "Через 6 месяцев": "Баъди 6 моҳ",
  "Только после консультации эндокринолога": "Танҳо баъди машварати эндокринолог",
  "Показания к направлению к специалисту": "Нишондодҳо барои равона кардан ба мутахассис",
  "Направление не требуется": "Равона кардан лозим нест",
  "Эндокринолог - в течение 7-14 дней, офтальмолог - в течение 1 месяца, кардиолог - по показаниям": "Эндокринолог - дар давоми 7-14 рӯз, офтальмолог - дар давоми 1 моҳ, кардиолог - аз рӯи нишондод",
  "Только к кардиологу": "Танҳо ба кардиолог",
  "Экстренная госпитализация": "Бистарикунонии фаврӣ",
  "Только к нефрологу": "Танҳо ба нефролог",
  "Маршрутизация пациента": "Равонасозии бемор",
  "АД 185/115 мм рт.ст. + боль в груди/одышка/неврологические симптомы": "Фишори хун 185/115 мм сут. сим. + дарди қафаси сина/нафастангӣ/нишонаҳои неврологӣ",
  "Впервые выявленный СД2 без кетоза, стабильное состояние, HbA1c 7,8%": "Диабети қанд навъи 2 бори аввал ошкор шудааст, бе кетоз, ҳолат устувор, HbA1c 7,8%",
  "СД2 + язва стопы/признаки инфекции стопы": "Диабети қанд навъи 2 + захми пой/нишонаҳои сирояти пой",
  "СД2 + снижение функции почек или выраженная альбуминурия по доступным данным": "Диабети қанд навъи 2 + пастшавии кори гурда ё альбуминурияи намоён аз рӯи маълумоти дастрас",
  "АГ 150/95 мм рт.ст. повторно, без признаков острого поражения органов-мишеней": "Фишорбаландӣ 150/95 мм сут. сим. такроран, бе нишонаҳои осеби шадиди узвҳои ҳадаф",
  "Высокий FINDRISC, но глюкоза натощак пока не определялась": "FINDRISC баланд, вале глюкозаи ношто ҳанӯз муайян нашудааст",
  "Комплексный клинический случай для оценки принятия решений": "Ҳолати мураккаби клиникӣ барои арзёбии қабули қарор",
  "Мужчина 59 лет, водитель. ИМТ 30 кг/м2, окружность талии 106 см. Курит. АД на двух визитах 158/96 и 154/94 мм рт.ст. Глюкоза натощак 7,4 ммоль/л повторно, HbA1c 7,2%. Жалобы: быстрая утомляемость, периодическое онемение стоп. Семейный анамнез: отец умер от инсульта.": "Мард, 59 сола, ронанда. ИМТ 30 кг/м2, даври миён 106 см. Тамоку мекашад. Фишори хун дар ду ташриф 158/96 ва 154/94 мм сут. сим. Глюкоза ношто такроран 7,4 ммол/л, HbA1c 7,2%. Шикоятҳо: зуд хаста шудан, карахтии даврии пойҳо. Анамнези оилавӣ: падар аз сактаи майна фавтидааст.",
  "Предварительный клинический диагноз": "Ташхиси пешакии клиникӣ",
  "Нарушение гликемии натощак": "Вайроншавии гликемияи ношто",
  "Сахарный диабет 2 типа, впервые выявленный": "Диабети қанд навъи 2, бори аввал ошкоршуда",
  "Преддиабет": "Предиабет",
  "Сахарный диабет 1 типа": "Диабети қанд навъи 1",
  "Метаболический синдром": "Синдроми метаболикӣ",
  "Основные факторы риска у данного пациента": "Омилҳои асосии хавф дар ин бемор",
  "Только возраст и курение": "Танҳо синну сол ва тамоку",
  "Ожирение, абдоминальное ожирение, АГ, курение, возраст, отягощенная наследственность": "Фарбеҳӣ, фарбеҳии абдоминалӣ, фишорбаландӣ, тамоку, синну сол, ирсияти вазнин",
  "Только наследственность": "Танҳо ирсият",
  "Только гипергликемия": "Танҳо гипергликемия",
  "Какие показатели необходимо дополнительно оценить в первую очередь?": "Кадом нишондиҳандаҳоро аввал бояд иловатан арзёбӣ кард?",
  "Только общий анализ крови": "Танҳо таҳлили умумии хун",
  "eGFR, ACR (альбумин/креатинин), липидный профиль, осмотр глазного дна, ЛПИ": "eGFR, ACR (альбумин/креатинин), профили липидӣ, муоинаи қаъри чашм, индекси тағоям-бозу",
  "Только УЗИ органов брюшной полости": "Танҳо УЗИ узвҳои шикам",
  "Только С-пептид": "Танҳо C-пептид",
  "Только коагулограмма": "Танҳо коагулограмма",
  "Первичный план лечения и профилактики": "Нақшаи аввалияи табобат ва пешгирӣ",
  "Метформин + изменение образа жизни + ИАПФ/БРА + амлодипин + статин + отказ от курения": "Метформин + тағйири тарзи ҳаёт + ИАПФ/БРА + амлодипин + статин + даст кашидан аз тамоку",
  "Инсулин короткого действия": "Инсулини кӯтоҳтаъсир",
  "Только препараты от давления": "Танҳо доруҳои фишор",
  "Метформин + гликлазид": "Метформин + гликлазид",
  "План мониторинга в ПМСП": "Нақшаи мониторинг дар КАТС",
  "Контроль 1 раз в 6 месяцев": "Назорат 1 маротиба дар 6 моҳ",
  "Контроль АД, глюкозы, веса каждые 2 недели первые 1-2 месяца, затем 1 раз в 3 месяца": "Назорати фишори хун, глюкоза ва вазн ҳар 2 ҳафта дар 1-2 моҳи аввал, баъдан 1 маротиба дар 3 моҳ",
  "Контроль только 1 раз в год": "Назорат танҳо 1 маротиба дар сол",
  "Еженедельный контроль": "Назорати ҳарҳафтаина",
  "Только контроль HbA1c 1 раз в год": "Танҳо назорати HbA1c 1 маротиба дар сол",
  "Скрининг осложнений сахарного диабета": "Скрининги оризаҳои диабети қанд",
  "Офтальмолог, ACR + eGFR, оценка стоп и неврологический статус, ЭКГ/ЭхоКГ": "Офтальмолог, ACR + eGFR, арзёбии пойҳо ва ҳолати неврологӣ, ЭКГ/ЭхоКГ",
  "Только МРТ головного мозга": "Танҳо МРТ-и майна",
  "Только допплерография сосудов шеи": "Танҳо допплерографияи рагҳои гардан",
  "Маршрутизация и показания к специалистам": "Равонасозӣ ва нишондодҳо ба мутахассисон",
  "Наблюдение только терапевтом": "Назорат танҳо аз ҷониби терапевт",
  "Эндокринолог - в течение 7-10 дней; кардиолог - в течение 14 дней; офтальмолог - в течение 2 недель": "Эндокринолог - дар давоми 7-10 рӯз; кардиолог - дар давоми 14 рӯз; офтальмолог - дар давоми 2 ҳафта",
  "Направление в стационар": "Равона кардан ба беморхона",
  "Только к хирургу": "Танҳо ба ҷарроҳ",
  "Направление к неврологу через 3 месяца": "Равона кардан ба невролог баъди 3 моҳ",
  "Как лучше объяснить пациенту дальнейшие шаги": "Чӣ гуна беҳтар аст қадамҳои минбаъдаро ба бемор фаҳмонем",
  "У вас диабет, будете колоть инсулин": "Шумо диабет доред, инсулин мегиред",
  "У вас выявился сахарный диабет 2 типа. Сейчас важно быстро нормализовать сахар и давление, чтобы не развились осложнения на глаза, почки и ноги. Начнем с таблеток, диеты и отказа от курения. Нужно пройти обследование у специалистов в ближайшие 2 недели": "Дар шумо диабети қанд навъи 2 ошкор шуд. Ҳоло муҳим аст, ки қанд ва фишор зуд ба назорат дароянд, то оризаҳо ба чашм, гурда ва пойҳо пайдо нашаванд. Аз доруҳо, парҳез ва даст кашидан аз тамоку оғоз мекунем. Дар 2 ҳафтаи наздик аз мутахассисон муоина гузаштан лозим аст.",
  "Это не страшно, просто похудейте": "Ин ҷиддӣ нест, танҳо вазн кам кунед",
  "Нужно немедленно лечь в больницу": "Бояд фавран дар беморхона бистарӣ шуд",
  "Ничего не объяснять, только выписать рецепты": "Ҳеҷ чиз шарҳ надодан, танҳо дорухат навиштан",

  "Почему СД2 и АГ часто называют «тихими» заболеваниями?": "Чаро диабети қанд навъи 2 ва фишорбаландиро аксар вақт бемориҳои «ором» меноманд?",
  "Всегда протекают с болью": "Ҳамеша бо дард мегузаранд",
  "Могут долго не давать жалоб": "Метавонанд муддати дароз бе шикоят бошанд",
  "Не требуют контроля": "Назорат талаб намекунанд",
  "Что является первым действием медсестры у пациента 50 лет с ожирением и АД 148/92?": "Амали аввалини ҳамшира дар бемори 50-сола бо фарбеҳӣ ва фишори 148/92 чист?",
  "Назначить таблетки": "Дору таъин кардан",
  "Измерить повторно/оценить риск/направить к врачу": "Такроран чен кардан/хавфро арзёбӣ кардан/ба духтур равона кардан",
  "Ничего не делать": "Ҳеҷ кор накардан",
  "Какое значение АД соответствует АГ 1 степени?": "Кадом сатҳи фишори хун ба гипертонияи дараҷаи 1 мувофиқ аст?",
  "120/80": "120/80",
  "130/85": "130/85",
  "140-159 и/или 90-99 мм рт. ст.": "140-159 ва/ё 90-99 мм сут. сим.",
  "FINDRISK используется для:": "FINDRISK барои чӣ истифода мешавад:",
  "Постановки диагноза СД": "Гузоштани ташхиси диабет",
  "Оценки риска и отбора на лабораторный этап": "Арзёбии хавф ва интихоб барои марҳилаи лабораторӣ",
  "Подбора дозы метформина": "Интихоби вояи метформин",
  "Что нужно сделать перед измерением АД?": "Пеш аз чен кардани фишори хун чӣ бояд кард?",
  "Дать пациенту отдохнуть 5 минут": "Ба бемор 5 дақиқа истироҳат додан",
  "Измерять сразу после подъема по лестнице": "Дарҳол баъди баромадан аз зина чен кардан",
  "Попросить говорить во время измерения": "Аз бемор хоҳиш кардан, ки ҳангоми ченкунӣ гап занад",
  "Диагноз диабета ставится:": "Ташхиси диабет гузошта мешавад:",
  "По жалобам": "Аз рӯи шикоятҳо",
  "Только по лабораторным критериям и подтверждению врачом": "Танҳо аз рӯи меъёрҳои лабораторӣ ва тасдиқи духтур",
  "По внешнему виду пациента": "Аз рӯи намуди зоҳирии бемор",
  "При АД 210/120 и боли за грудиной медсестра должна:": "Ҳангоми фишори 210/120 ва дарди пушти устухони сина ҳамшира бояд:",
  "Записать на плановый прием": "Ба қабули нақшавӣ нависад",
  "Срочно организовать помощь/маршрутизацию": "Фавран ёрӣ ва равонасозиро ташкил кунад",
  "Дать совет пить воду": "Маслиҳат диҳад, ки об нӯшад",
  "К чему относится окружность талии?": "Даври миён ба чӣ дахл дорад?",
  "К оценке абдоминального ожирения": "Ба арзёбии фарбеҳии абдоминалӣ",
  "К диагностике анемии": "Ба ташхиси камхунӣ",
  "К оценке зрения": "Ба арзёбии биноӣ",
  "Что помогает повысить приверженность лечению?": "Чӣ ба беҳтар шудани риояи табобат кӯмак мекунад?",
  "Обвинять пациента": "Беморро айбдор кардан",
  "Простой письменный план и уважительный разговор": "Нақшаи оддии хаттӣ ва суҳбати эҳтиромона",
  "Отменить контроль": "Назоратро бекор кардан",
  "Что должна фиксировать медсестра в регистре скрининга?": "Ҳамшира дар реестри скрининг чиро бояд сабт кунад?",
  "Только имя": "Танҳо ном",
  "Дату, АД, ИМТ/талию, FINDRISK/глюкозу, направление и дату возврата": "Сана, фишори хун, ИМТ/миён, FINDRISK/глюкоза, равона ва санаи бозгашт",
  "Назовите 4 основных фактора риска СД2/АГ, которые должна активно выявлять медсестра.": "4 омили асосии хавфи диабети қанд навъи 2/фишорбаландиро номбар кунед, ки ҳамшира бояд фаъолона муайян кунад.",
  "Только курение и питание": "Танҳо тамоку ва ғизо",
  "Возраст, ИМТ/окружность талии, семейный анамнез по СД2, повышенное АД": "Синну сол, ИМТ/даври миён, анамнези оилавии диабети қанд навъи 2, фишори баланд",
  "Только уровень холестерина и гемоглобин": "Танҳо сатҳи холестерин ва гемоглобин",
  "Только физическая активность и стресс": "Танҳо фаъолияти ҷисмонӣ ва стресс",
  "Что такое FINDRISK?": "FINDRISK чист?",
  "Метод постановки окончательного диагноза СД2": "Усули гузоштани ташхиси ниҳоии диабети қанд навъи 2",
  "Инструмент (анкета) для оценки риска развития СД2 в ближайшие 10 лет": "Восита (анкета) барои арзёбии хавфи пайдоиши диабети қанд навъи 2 дар 10 соли наздик",
  "Шкала для расчета дозы инсулина": "Шкала барои ҳисоб кардани вояи инсулин",
  "Метод определения стадии артериальной гипертензии": "Усули муайян кардани марҳилаи фишорбаландии артериалӣ",
  "Назовите 3 важных правила правильного измерения артериального давления.": "3 қоидаи муҳими дуруст чен кардани фишори хунро номбар кунед.",
  "Измерять сразу после ходьбы, манжета любого размера, пациент может разговаривать": "Дарҳол баъди роҳгардӣ чен кардан, манжет ҳар андоза бошад, бемор метавонад гап занад",
  "Пациент отдыхает 5 минут, рука на уровне сердца, манжета соответствует размеру руки": "Бемор 5 дақиқа истироҳат мекунад, даст дар сатҳи дил, манжет ба андозаи даст мувофиқ аст",
  "Измерять только на обеих руках одновременно, ноги скрещены": "Танҳо дар ду даст ҳамзамон чен кардан, пойҳо чиллик",
  "Измерять сразу после приема пищи": "Дарҳол баъди хӯрок чен кардан",
  "При каком уровне офисного АД начинается диапазон артериальной гипертензии?": "Диапазони фишорбаландии артериалӣ аз кадом сатҳи фишори қабулгоҳӣ оғоз мешавад?",
  ">=130/80 мм рт. ст.": ">=130/80 мм сут. сим.",
  ">=140 и/или >=90 мм рт. ст. (при подтверждении)": ">=140 ва/ё >=90 мм сут. сим. (ҳангоми тасдиқ)",
  ">=160/100 мм рт. ст.": ">=160/100 мм сут. сим.",
  ">=120/80 мм рт. ст.": ">=120/80 мм сут. сим.",
  "Какой порог глюкозы плазмы натощак соответствует диабетическому диапазону?": "Кадом ҳадди глюкозаи плазма ношто ба диапазони диабетӣ мувофиқ аст?",
  ">=7,0 ммоль/л (при подтверждении на повторном анализе)": ">=7,0 ммол/л (бо тасдиқ дар таҳлили такрорӣ)",
  ">=8,5 ммоль/л": ">=8,5 ммол/л",
  "Что должна сделать медсестра при выявлении АД 210/120 мм рт.ст. и боли за грудиной?": "Ҳангоми ошкор шудани фишори 210/120 мм сут. сим. ва дарди қафаси сина ҳамшира чӣ бояд кунад?",
  "Записать пациента на плановый прием через неделю": "Беморро барои қабули нақшавӣ баъди як ҳафта нависад",
  "Организовать срочную маршрутизацию (вызвать врача или скорую помощь)": "Равонасозии таъҷилиро ташкил кунад (духтур ё ёрии таъҷилиро даъват кунад)",
  "Посоветовать пациенту выпить воды и отдохнуть": "Ба бемор маслиҳат диҳад, ки об нӯшад ва истироҳат кунад",
  "Измерить АД еще раз через час": "Фишори хунро баъди як соат боз чен кунад",
  "Почему медсестра не должна самостоятельно отменять препарат пациенту?": "Чаро ҳамшира набояд доруи беморро худсарона қатъ кунад?",
  "Потому что препараты дорогие": "Зеро доруҳо қиматанд",
  "Назначение и отмена терапии — зона ответственности врача": "Таъин ва қатъи табобат масъулияти духтур аст",
  "Потому что пациенту всегда нужно продолжать лечение": "Зеро бемор ҳамеша бояд табобатро давом диҳад",
  "Потому что отмена препаратов запрещена законом": "Зеро қатъи доруҳо бо қонун манъ аст",
  "Какие 3 важных пункта обязательно должны быть в направлении к врачу?": "Кадом 3 нуқтаи муҳим ҳатман бояд дар равона ба духтур бошанд?",
  "Только ФИО и дата рождения": "Танҳо ному насаб ва санаи таваллуд",
  "Причина направления, объективные данные (АД, глюкоза, ИМТ, ОТ), дата возврата": "Сабаби равона, маълумоти объективӣ (фишор, глюкоза, ИМТ, даври миён), санаи бозгашт",
  "Только жалобы пациента": "Танҳо шикоятҳои бемор",
  "Только список всех принимаемых лекарств": "Танҳо рӯйхати ҳамаи доруҳои қабулшаванда",
  "Как лучше спросить пациента о пропусках приема лекарств (без обвинения)?": "Чӣ гуна беҳтар аст аз бемор дар бораи фаромӯш кардани доруҳо бе айбдоркунӣ пурсид?",
  "Почему вы не принимаете таблетки как положено?": "Чаро доруҳоро дуруст намегиред?",
  "Многие пациенты иногда пропускают таблетки. Как часто это бывает у вас?": "Бисёр беморон баъзан доруҳоро фаромӯш мекунанд. Ин ҳолат дар шумо чанд вақт як бор мешавад?",
  "Вы вообще пьете то, что назначили?": "Шумо умуман доруҳои таъиншударо мегиред?",
  "Вы понимаете, что без таблеток будет плохо?": "Мефаҳмед, ки бе дору вазъият бад мешавад?",
  "Что означает термин «непрерывность наблюдения» в работе медсестры?": "Истилоҳи «пайвастагии назорат» дар кори ҳамшира чӣ маъно дорад?",
  "Пациент наблюдается только у узких специалистов": "Бемор танҳо назди мутахассисони маҳдуд назорат мешавад",
  "Пациент не теряется после направления: есть контроль выполнения, дата возврата и фиксация результатов": "Бемор баъди равона гум намешавад: иҷро назорат мешавад, санаи бозгашт ва натиҷаҳо сабт мешаванд",
  "Наблюдение пациента только 1 раз в год": "Назорати бемор танҳо 1 маротиба дар сол",
  "Непрерывный прием всех назначенных препаратов": "Қабули пайвастаи ҳамаи доруҳои таъиншуда",
  "По регистрации": "Аз рӯи бақайдгирӣ",
  "От А до Я": "Аз А то Я",
  "До обучения: все": "Пеш аз омӯзиш: ҳама",
  "До обучения: сдали": "Пеш аз омӯзиш: супоридаанд",
  "До обучения: не сдали": "Пеш аз омӯзиш: насупоридаанд",
  "После обучения: все": "Баъди омӯзиш: ҳама",
  "После обучения: сдали": "Баъди омӯзиш: супоридаанд",
  "После обучения: не сдали": "Баъди омӯзиш: насупоридаанд"
};

function testLanguage() {
  return localStorage.getItem(TEST_LANGUAGE_KEY) || "ru";
}

function translateTestText(value) {
  if (testLanguage() !== "tg") return value;
  return TAJIK_TEXT[value] || value;
}

function surveyLanguage() {
  return localStorage.getItem(SURVEY_LANGUAGE_KEY) || "ru";
}

function translateSurveyText(value) {
  if (surveyLanguage() !== "tg") return value;
  return TAJIK_TEXT[value] || value;
}

function doctorLanguage() {
  return localStorage.getItem(DOCTOR_LANGUAGE_KEY) || "ru";
}

function translateDoctorText(value) {
  if (doctorLanguage() !== "tg") return value;
  return TAJIK_TEXT[value] || value;
}

function languageControl() {
  const lang = testLanguage();
  return html`
    <div class="form-row language-control">
      <label>${escapeHtml(translateTestText("Язык"))}</label>
      <select id="testLanguage">
        <option value="ru"${lang === "ru" ? " selected" : ""}>${escapeHtml(translateTestText("Русский"))}</option>
        <option value="tg"${lang === "tg" ? " selected" : ""}>${escapeHtml(translateTestText("Тоҷикӣ"))}</option>
      </select>
    </div>
  `;
}

function surveyLanguageControl() {
  const lang = surveyLanguage();
  return html`
    <div class="form-row language-control">
      <label>${escapeHtml(translateSurveyText("Язык"))}</label>
      <select id="surveyLanguage">
        <option value="ru"${lang === "ru" ? " selected" : ""}>${escapeHtml(translateSurveyText("Русский"))}</option>
        <option value="tg"${lang === "tg" ? " selected" : ""}>${escapeHtml(translateSurveyText("Тоҷикӣ"))}</option>
      </select>
    </div>
  `;
}

function bindLanguageControl(onChange) {
  document.querySelector("#testLanguage")?.addEventListener("change", (event) => {
    localStorage.setItem(TEST_LANGUAGE_KEY, event.target.value);
    onChange?.();
  });
}

function bindSurveyLanguageControl(onChange) {
  document.querySelector("#surveyLanguage")?.addEventListener("change", (event) => {
    localStorage.setItem(SURVEY_LANGUAGE_KEY, event.target.value);
    onChange?.();
  });
}

function doctorLanguageControl() {
  const lang = doctorLanguage();
  return html`
    <div class="form-row language-control">
      <label>${escapeHtml(translateDoctorText("Язык"))}</label>
      <select id="doctorLanguage">
        <option value="ru"${lang === "ru" ? " selected" : ""}>${escapeHtml(translateDoctorText("Русский"))}</option>
        <option value="tg"${lang === "tg" ? " selected" : ""}>${escapeHtml(translateDoctorText("Тоҷикӣ"))}</option>
      </select>
    </div>
  `;
}

function bindDoctorLanguageControl(onChange) {
  document.querySelector("#doctorLanguage")?.addEventListener("change", (event) => {
    localStorage.setItem(DOCTOR_LANGUAGE_KEY, event.target.value);
    onChange?.();
  });
}

function showNurseLanguagePrompt(onChoose) {
  if (nurseTrainingLanguagePromptShown) return;
  nurseTrainingLanguagePromptShown = true;
  const overlay = document.createElement("div");
  overlay.className = "language-modal";
  overlay.innerHTML = html`
    <div class="language-modal__panel">
      <h2>${escapeHtml(translateTestText("Выберите язык"))}</h2>
      <div class="language-modal__actions">
        <button type="button" data-lang-choice="ru">Русский</button>
        <button type="button" data-lang-choice="tg">Тоҷикӣ</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lang-choice]");
    if (!button) return;
    localStorage.setItem(TEST_LANGUAGE_KEY, button.dataset.langChoice);
    overlay.remove();
    onChoose?.();
  });
}

function showSurveyLanguagePrompt(onChoose) {
  if (surveyLanguagePromptShown) return;
  surveyLanguagePromptShown = true;
  const overlay = document.createElement("div");
  overlay.className = "language-modal";
  overlay.innerHTML = html`
    <div class="language-modal__panel">
      <h2>Выберите язык / Забонро интихоб кунед</h2>
      <div class="language-modal__actions">
        <button type="button" data-survey-lang-choice="ru">Русский</button>
        <button type="button" data-survey-lang-choice="tg">Тоҷикӣ</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-survey-lang-choice]");
    if (!button) return;
    localStorage.setItem(SURVEY_LANGUAGE_KEY, button.dataset.surveyLangChoice);
    overlay.remove();
    onChoose?.();
  });
}

function showDoctorLanguagePrompt(onChoose) {
  if (doctorLanguagePromptShown) return;
  doctorLanguagePromptShown = true;
  const overlay = document.createElement("div");
  overlay.className = "language-modal";
  overlay.innerHTML = html`
    <div class="language-modal__panel">
      <h2>Выберите язык / Забонро интихоб кунед</h2>
      <div class="language-modal__actions">
        <button type="button" data-doctor-lang-choice="ru">Русский</button>
        <button type="button" data-doctor-lang-choice="tg">Тоҷикӣ</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-doctor-lang-choice]");
    if (!button) return;
    localStorage.setItem(DOCTOR_LANGUAGE_KEY, button.dataset.doctorLangChoice);
    overlay.remove();
    onChoose?.();
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js?v=20260924workflow").catch(() => {});
}

async function boot() {
  const { user } = await api("/api/me");
  state.me = user;
  await route();
}

async function route() {
  const path = window.location.pathname;
  const appMode = document.body.dataset.app;
  if (appMode === "survey" || path === SURVEY_APP_PATH) return renderNurseSurvey();
  if (appMode === "training" || path === TRAINING_APP_PATH) return loadTrainingPretest();
  if (appMode === "nurse-training" || path === NURSE_TRAINING_APP_PATH) return loadNurseTraining();
  if (appMode === "investor" || path === INVESTOR_APP_PATH) return state.me?.type === "admin" ? loadInvestorDashboard() : renderAdminLogin();
  if (appMode === "monitor" || path === MONITOR_APP_PATH) return loadMonitorDashboard();
  if (appMode === "doctor" || path === DOCTOR_APP_PATH) return state.me?.type === "doctor" ? loadDoctor() : renderDoctorLogin();
  if (appMode === "admin" || path === ADMIN_APP_PATH) return state.me?.type === "admin" ? loadAdmin() : renderAdminLogin();
  renderHome();
}

function setPage(content) {
  app.innerHTML = content;
  document.body.classList.toggle('easy-reading', localStorage.getItem('eclinic-easy-reading') === 'true');
  queueMicrotask(() => {
    document.querySelector('#correctSurveyAnswers')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const id = state.auditSurvey.survey.id;
        await api(`/api/admin/patients/${encodeURIComponent(id)}/answers`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        state.auditSurvey = await api(`/api/admin/patients/${encodeURIComponent(id)}`);
        await loadAdmin();
      } catch (error) { form.querySelector('[role=status]').textContent = error.message; }
      finally { button.disabled = false; }
    });
    for (const id of ['surveyForm', 'doctorPatientSurveyForm', 'visitForm']) {
      bindDraft(document.getElementById(id), { userId: state.me?.id || 'nurse', language: id === 'surveyForm' ? surveyLanguage() : doctorLanguage(),
        collectLabs: id === 'visitForm' ? collectDoctorLabs : undefined,
        restoreLabs: id === 'visitForm' ? labs => { document.querySelector('#doctorLabList').innerHTML = labs.map(lab => doctorLabRow(lab.test, { ...lab.fields, ...lab })).join(''); bindDoctorLabControls(); } : undefined });
    }
    document.querySelectorAll('[data-help-language]').forEach(select => select.addEventListener('change', () => {
      const video = select.closest('details').querySelector('video');
      video.src = `/help/${video.dataset.helpRole}-${select.value}.mp4`;
      video.load();
    }));
    document.querySelectorAll('[data-waiting-search]').forEach(input => input.addEventListener('input', () => {
      input.closest('section').querySelectorAll('[data-waiting-row]').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(input.value.trim().toLowerCase()); });
    }));
    document.querySelectorAll('[data-outreach-id]').forEach(select => select.addEventListener('change', async () => {
      select.disabled = true;
      try { await api('/api/patient-outreach', { method: 'PUT', body: JSON.stringify({ surveyId: select.dataset.outreachId, status: select.value }) }); }
      catch (error) { alert(error.message); }
      finally { select.disabled = false; }
    }));
    document.querySelector('#installSurveyApp')?.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      document.querySelector('#installSurveyApp')?.setAttribute('hidden', '');
    });
  });
}

function topbar(title, nav = "") {
  const logoutText = document.body.dataset.app === "doctor" ? translateDoctorText("Выйти") : "Выйти";
  return html`
    <header class="topbar">
      <div class="topbar-identity">
        <div class="brand">${title}</div>
        <div class="muted">${state.me?.name || ""}</div>
      </div>
      <div class="nav">${nav}<button class="secondary" data-action="logout">${escapeHtml(logoutText)}</button></div>
    </header>
  `;
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "logout") {
    clearUserDrafts(state.me?.id || 'nurse');
    await api("/api/logout", { method: "POST", body: "{}" });
    state = initialState();
    window.location.href = "/";
  }
  if (action === "admin-tab") {
    state.auditSurvey = null;
    state.tab = event.target.closest("[data-action]").dataset.tab;
    if (state.tab === "audit") state.auditPage = 1;
    if (state.tab === "surveys") state.surveyPage = 1;
    state.trainingAdminPage = 1;
    state.nurseTrainingAdminPage = 1;
    await loadAdmin();
  }
  if (action === "open-audit-survey") {
    const id = event.target.closest("[data-action]").dataset.id;
    try {
      state.auditSurvey = await api(`/api/admin/patients/${encodeURIComponent(id)}`);
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  }
  if (action === "close-audit-survey") {
    state.auditSurvey = null;
    renderAdmin();
  }
  if (action === "print-patient-card") window.print();
  if (action === "clear-audit-search") {
    state.auditSearch = "";
    state.auditClinic = "all";
    state.auditPage = 1;
    await loadAdmin();
  }
  if (action === "audit-page") {
    const direction = Number(event.target.closest("[data-action]").dataset.direction || 0);
    const maxPage = Number(state.admin?.auditPageCount || 1);
    state.auditPage = Math.min(maxPage, Math.max(1, Number(state.admin?.auditPage || state.auditPage || 1) + direction));
    await loadAdmin();
  }
  if (action === "clear-head-nurse-audit-search") {
    state.headNurseAuditSearch = "";
    renderAdmin();
  }
  if (action === "clear-survey-search") {
    state.surveySearch = "";
    state.surveyClinicFilter = "all";
    state.surveyPage = 1;
    await loadAdmin();
  }
  if (action === "survey-page") {
    const direction = Number(event.target.closest("[data-action]").dataset.direction || 0);
    const maxPage = Number(state.admin?.surveysPageCount || 1);
    state.surveyPage = Math.min(maxPage, Math.max(1, Number(state.admin?.surveysPage || state.surveyPage || 1) + direction));
    await loadAdmin();
  }
  if (action === "clear-care-search") {
    state.careSearch = "";
    renderAdmin();
  }
  if (action === "import-patients") {
    const file = document.querySelector("#patientImportFile")?.files?.[0];
    if (!file) return alert("Выберите CSV-файл, сохранённый из Excel.");
    try {
      const result = await api("/api/admin/patients/import", { method: "POST", body: JSON.stringify({ rows: parseImportCsv(await file.text()) }) });
      alert(`Импортировано: ${result.imported.length}; дублей пропущено: ${result.skipped.length}; ошибок: ${result.errors.length}`);
      await loadAdmin();
    } catch (error) { alert(error.message); }
  }
  if (action === "create-backup") {
    try {
      await api("/api/admin/backup", { method: "POST", body: "{}" });
      alert("Защищённая резервная копия создана на сервере.");
      await loadAdmin();
    } catch (error) { alert(error.message); }
  }
  if (action === "test-daily-report") {
    const chatId = document.querySelector("#dailyReportForm [name='chatId']")?.value || "";
    try {
      await api("/api/admin/daily-reports/test", { method: "POST", body: JSON.stringify({ chatId }) });
      alert("Тестовая сводка отправлена в Telegram.");
    } catch (error) { alert(error.message); }
  }
  if (action === "generate-doctor-key") {
    const input = event.target.closest(".doctor-key-form")?.elements.accessKey;
    if (!input) return;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const random = crypto.getRandomValues(new Uint8Array(8));
    input.value = Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
    input.focus();
    input.select();
  }
  if (action === "copy-doctor-key") {
    const input = event.target.closest(".doctor-key-reveal")?.querySelector("input");
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      event.target.textContent = "Скопировано";
    } catch {
      input.focus();
      input.select();
      document.execCommand("copy");
      event.target.textContent = "Скопировано";
    }
  }
  if (action === "doctor-tab") {
    if (event.target.dataset.tab === 'waiting') {
      try { state.waitingPatients = (await api('/api/doctor/waiting-patients')).patients; }
      catch (error) { alert(error.message); return; }
    }
    state.doctorSection = event.target.dataset.tab;
    if (state.doctorSection !== "patients") {
      state.doctorMode = "list";
      state.selectedSurvey = null;
    }
    renderDoctor();
  }
  if (action === "doctor-toggle-risk-sort") {
    state.doctorRiskFirst = !state.doctorRiskFirst;
    state.doctorPatientPage = 1;
    renderDoctorPatientList();
  }
  if (action === "clear-doctor-patient-search") {
    state.doctorPatientSearch = "";
    state.doctorPatientPage = 1;
    renderDoctor();
  }
  if (action === 'toggle-easy-reading') {
    const enabled = localStorage.getItem('eclinic-easy-reading') !== 'true';
    localStorage.setItem('eclinic-easy-reading', String(enabled));
    document.body.classList.toggle('easy-reading', enabled);
    event.target.setAttribute('aria-pressed', String(enabled));
  }
  if (action === "doctor-task-status") {
    const id = event.target.dataset.id;
    const status = event.target.dataset.status;
    const result = await api(`/api/doctor/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    state.doctor.tasks = (state.doctor.tasks || []).map((task) => task.id === id ? result.task : task);
    renderDoctor();
  }
  if (action === "patient-archive") {
    if (!confirm(event.target.dataset.archived === "true" ? "Перенести карточку пациента в архив?" : "Восстановить карточку?")) return;
    await api(`/api/admin/patients/${event.target.dataset.id}/archive`, { method: "POST", body: JSON.stringify({ archived: event.target.dataset.archived === "true" }) });
    await loadAdmin();
  }
  if (action === "appointment-status") {
    const result = await api(`/api/doctor/appointments/${event.target.dataset.id}`, { method: "PUT", body: JSON.stringify({ status: event.target.dataset.status }) });
    state.doctor.appointments = state.doctor.appointments.map((item) => item.id === result.appointment.id ? result.appointment : item);
    renderDoctor();
  }
  if (action === "doctor-patient-page") {
    state.doctorPatientPage = Math.max(1, Number(event.target.dataset.page || 1));
    renderDoctorPatientList();
    document.querySelector("#patientList")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (action === "training-admin-page") {
    state.trainingAdminPage = Math.max(1, Number(event.target.dataset.page || 1));
    renderAdmin();
    document.querySelector("#trainingAdminResults")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (action === "nurse-training-admin-page") {
    state.nurseTrainingAdminPage = Math.max(1, Number(event.target.dataset.page || 1));
    renderAdmin();
    document.querySelector("#nurseTrainingAdminResults")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (action === "investor-tab") {
    state.investorTab = event.target.dataset.tab;
    renderInvestorDashboard();
  }
  if (action === "monitor-tab") {
    state.monitorTab = event.target.dataset.tab;
    renderMonitorDashboard();
  }
  if (action === "monitor-refresh") {
    await loadMonitorDashboard(false);
  }
  if (action === "monitor-report") {
    const from = document.querySelector("#monitorReportFrom")?.value || "";
    const to = document.querySelector("#monitorReportTo")?.value || "";
    if (!from || !to) {
      alert("Выберите дату начала и дату окончания отчета.");
      return;
    }
    if (from > to) {
      alert("Дата начала не может быть позже даты окончания.");
      return;
    }
    state.monitorReportFrom = from;
    state.monitorReportTo = to;
    const params = new URLSearchParams({ from, to });
    window.location.href = `/api/monitor/weekly-report.docx?${params}`;
  }
  if (action === "delete-doctor") {
    if (!confirm("Удалить профиль врача?")) return;
    await api(`/api/admin/doctors/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    state.lastDoctorKey = null;
    await loadAdmin();
  }
  if (action === "delete-training-participant") {
    if (!confirm("Удалить участника обучения и его результат пре-теста?")) return;
    await api(`/api/admin/training-participants/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "reset-training-attempts") {
    const phase = event.target.dataset.phase;
    const label = phase === "pre" ? "тест до обучения" : "тесты после обучения";
    if (!confirm(`Разрешить врачу заново пройти ${label}? Старый результат будет удален.`)) return;
    await api(`/api/admin/training-participants/${event.target.dataset.id}/attempts/${phase}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "reset-nurse-training-attempts") {
    const phase = event.target.dataset.phase;
    const label = phase === "pre" ? "тест до обучения" : "тест после обучения";
    if (!confirm(`Разрешить медсестре заново пройти ${label}? Старый результат будет удален.`)) return;
    await api(`/api/admin/nurse-training-participants/${event.target.dataset.id}/attempts/${phase}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "delete-nurse-training-participant") {
    if (!confirm("Удалить медсестру и результаты тестов?")) return;
    await api(`/api/admin/nurse-training-participants/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "delete-admin-access") {
    if (!confirm("Удалить доступ администратора?")) return;
    await api(`/api/admin/admins/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "select-survey") {
    state.selectedSurvey = state.doctor.surveys.find((item) => item.id === event.target.dataset.id);
    state.lastSavedDoctorVisitId = "";
    state.doctorVisitNotice = "";
    api("/api/doctor/survey-view", { method: "POST", body: JSON.stringify({ surveyId: event.target.dataset.id }) }).catch(() => {});
    state.doctorMode = "visit";
    state.doctorSection = "patients";
    renderDoctor();
    setTimeout(() => document.querySelector("#doctorPrimaryPanel")?.scrollIntoView({ block: "start" }), 0);
  }
  if (action === "add-doctor-patient") {
    state.selectedSurvey = null;
    state.doctorMode = "add";
    state.doctorSection = "patients";
    renderDoctor();
    setTimeout(() => document.querySelector("#doctorPrimaryPanel")?.scrollIntoView({ block: "start" }), 0);
  }
  if (action === "cancel-doctor-patient") {
    state.doctorMode = "list";
    renderDoctor();
  }
  if (action === "select-training-participant") {
    await renderTrainingWorkspace(event.target.dataset.id);
  }
  if (action === "start-pretest") {
    await renderTrainingPretest(event.target.dataset.id);
  }
  if (action === "start-posttest") {
    await renderTrainingPosttest(event.target.dataset.id);
  }
  if (action === "start-task") {
    await renderTrainingTask(event.target.dataset.participantId, event.target.dataset.taskId);
  }
  if (action === "start-post-training-tests") {
    await renderPostTrainingTests(event.target.dataset.id);
  }
  if (action === "select-nurse-training-participant") {
    await renderNurseTrainingWorkspace(event.target.dataset.id);
  }
  if (action === "start-nurse-test") {
    await renderNurseTest(event.target.dataset.id, event.target.dataset.testType);
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "surveyClinicFilter") {
    state.surveyClinicFilter = event.target.value;
    state.surveyPage = 1;
    await loadAdmin();
  }
});

function renderHome() {
  const doctorUrl = `${location.origin}${DOCTOR_APP_PATH}`;
  const surveyUrl = `${location.origin}${SURVEY_APP_PATH}`;
  const trainingUrl = `${location.origin}${TRAINING_APP_PATH}`;
  const nurseTrainingUrl = `${location.origin}${NURSE_TRAINING_APP_PATH}`;
  const investorUrl = `${location.origin}${INVESTOR_APP_PATH}`;
  const monitorUrl = `${location.origin}${MONITOR_APP_PATH}`;
  setPage(html`
    <main class="login">
      <section class="panel">
        <h1>Медицинская web-система</h1>
        <div class="grid">
          <a href="${DOCTOR_APP_PATH}"><button>№2 Врач</button></a>
          <input id="homeDoctorUrl" readonly value="${doctorUrl}" />
          <a href="${SURVEY_APP_PATH}"><button>№3 Опросник больного</button></a>
          <input id="homeSurveyUrl" readonly value="${surveyUrl}" />
          <a href="${TRAINING_APP_PATH}"><button>№4 Проверка знаний</button></a>
          <input id="homeTrainingUrl" readonly value="${trainingUrl}" />
          <a href="${NURSE_TRAINING_APP_PATH}"><button>№5 Тесты медсестер</button></a>
          <input id="homeNurseTrainingUrl" readonly value="${nurseTrainingUrl}" />
          <a href="${INVESTOR_APP_PATH}"><button>№6 Для инвесторов</button></a>
          <input id="homeInvestorUrl" readonly value="${investorUrl}" />
          <a href="${MONITOR_APP_PATH}"><button>№7 Экран наблюдения</button></a>
          <a href="${DIABETES_APP_PATH}"><button>№8 Риск сахарного диабета</button></a>
          <input id="homeMonitorUrl" readonly value="${monitorUrl}" />
        </div>
        <p class="muted">Ссылка №1 администратора не показывается здесь, чтобы врачи случайно не открывали админку.</p>
      </section>
    </main>
  `);
  api("/api/server-info").then(({ apps }) => {
    document.querySelector("#homeDoctorUrl").value = apps.doctor;
    document.querySelector("#homeSurveyUrl").value = apps.survey;
    if (apps.training) document.querySelector("#homeTrainingUrl").value = apps.training;
    if (apps.nurseTraining) document.querySelector("#homeNurseTrainingUrl").value = apps.nurseTraining;
    if (apps.investor) document.querySelector("#homeInvestorUrl").value = apps.investor;
    if (apps.monitor) document.querySelector("#homeMonitorUrl").value = apps.monitor;
  }).catch(() => {});
}

async function loadInvestorDashboard() {
  state.investor = await api("/api/investor/dashboard");
  renderInvestorDashboard();
}

function investorNumber(value, suffix = "") {
  return `${Number(value || 0).toLocaleString("ru-RU")}${suffix}`;
}

function investorKpi(label, value, detail = "", tone = "", meaning = "") {
  return html`
    <div class="investor-kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      ${meaning ? `<p>${escapeHtml(meaning)}</p>` : ""}
    </div>
  `;
}

function investorPlainInfo(title, items) {
  return html`
    <section class="investor-card investor-explain">
      <div class="section-title"><h2>${escapeHtml(title)}</h2><span>простыми словами</span></div>
      <div class="explain-grid">
        ${items.map((item) => html`
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.text)}</p>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function chartSeriesMax(items, keys = ["value"]) {
  return Math.max(1, ...items.flatMap((item) => keys.map((key) => Number(item[key] || 0))));
}

function investorBarChart(items, key = "value", accent = "var(--primary)") {
  const rows = items.slice(0, 15);
  const max = chartSeriesMax(rows, [key]);
  return html`
    <div class="investor-bars">
      ${rows.map((item) => {
        const value = Number(item[key] || 0);
        const width = Math.max(4, Math.round((value / max) * 100));
        return html`
          <div class="investor-bar-row">
            <span>${escapeHtml(item.label)}</span>
            <div><i style="width:${width}%;background:${accent}"></i></div>
            <strong>${investorNumber(value)}</strong>
          </div>
        `;
      }).join("") || `<p class="muted">Пока нет данных</p>`}
    </div>
  `;
}

function investorGroupedBarChart(items) {
  const rows = items.slice(0, 15);
  const max = chartSeriesMax(rows, ["registered", "preCompleted", "postCompleted"]);
  return html`
    <div class="investor-bars grouped">
      ${rows.map((item) => html`
        <div class="investor-bar-row">
          <span>${escapeHtml(item.label)}</span>
          <div class="mini-stack">
            <i class="tone-a" style="width:${Math.max(4, Math.round((Number(item.registered || 0) / max) * 100))}%"></i>
            <i class="tone-b" style="width:${Math.max(4, Math.round((Number(item.preCompleted || 0) / max) * 100))}%"></i>
            <i class="tone-c" style="width:${Math.max(4, Math.round((Number(item.postCompleted || 0) / max) * 100))}%"></i>
          </div>
          <strong>${item.registered}/${item.preCompleted}/${item.postCompleted}</strong>
        </div>
      `).join("") || `<p class="muted">Пока нет данных</p>`}
    </div>
  `;
}

function investorLineChart(seriesA, seriesB, labelA, labelB) {
  const dates = [...new Set([...(seriesA || []), ...(seriesB || [])].map((item) => item.label))].sort();
  const mapA = Object.fromEntries((seriesA || []).map((item) => [item.label, Number(item.value || 0)]));
  const mapB = Object.fromEntries((seriesB || []).map((item) => [item.label, Number(item.value || 0)]));
  const max = Math.max(1, ...dates.map((date) => Math.max(mapA[date] || 0, mapB[date] || 0)));
  const width = 720;
  const height = 240;
  const pad = 28;
  const point = (date, index, map) => {
    const x = pad + (dates.length <= 1 ? (width - pad * 2) / 2 : (index / (dates.length - 1)) * (width - pad * 2));
    const y = height - pad - ((map[date] || 0) / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const pointsA = dates.map((date, index) => point(date, index, mapA)).join(" ");
  const hasSeriesB = Boolean(labelB && (seriesB || []).length);
  const pointsB = hasSeriesB ? dates.map((date, index) => point(date, index, mapB)).join(" ") : "";
  return html`
    <div class="investor-line-card">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика по дням">
        <path d="M ${pad} ${height - pad} H ${width - pad}" class="axis" />
        <path d="M ${pad} ${pad} V ${height - pad}" class="axis" />
        ${pointsA ? `<polyline points="${pointsA}" class="line-a" />` : ""}
        ${pointsB ? `<polyline points="${pointsB}" class="line-b" />` : ""}
        ${dates.map((date, index) => {
          const [xA, yA] = point(date, index, mapA).split(",");
          const [xB, yB] = point(date, index, mapB).split(",");
          return `<circle cx="${xA}" cy="${yA}" r="4" class="dot-a" />${hasSeriesB ? `<circle cx="${xB}" cy="${yB}" r="4" class="dot-b" />` : ""}`;
        }).join("")}
      </svg>
      <div class="chart-legend"><span class="legend-a">${escapeHtml(labelA)}</span>${labelB ? `<span class="legend-b">${escapeHtml(labelB)}</span>` : ""}</div>
    </div>
  `;
}

function investorDonut(label, value, tone = "") {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return html`
    <div class="investor-donut ${tone}" style="--value:${safe}">
      <div class="donut-ring"><strong>${safe}%</strong></div>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function investorEducationPanel(kind, title) {
  const data = state.investor.education[kind];
  return html`
    <section class="investor-grid">
      ${investorKpi("Зарегистрировано", investorNumber(data.total), title, "", "Сколько участников внесены в систему для обучения.")}
      ${investorKpi("Средний пре-тест", investorNumber(data.preAverage, "%"), `${data.preCompleted} сдали`, "soft", "Средний уровень знаний до обучения. Чем ниже, тем больше исходный пробел.")}
      ${investorKpi("Средний пост-тест", investorNumber(data.postAverage, "%"), `${data.postCompleted} сдали`, "hot", "Средний результат после обучения. Это главный показатель усвоения материала.")}
      ${investorKpi("Прошли 70%+", investorNumber(data.passed70), "порог качества", "success", "Сколько участников достигли минимального целевого уровня знаний.")}
    </section>
    ${investorPlainInfo("Как читать эту вкладку", [
      { title: "Пре-тест", text: "Показывает стартовый уровень знаний до обучения." },
      { title: "Пост-тест", text: "Показывает, что изменилось после обучения." },
      { title: "Рост", text: "Разница между пост-тестом и пре-тестом. Для спонсора это показатель эффекта программы." }
    ])}
    <section class="investor-card">
      <div class="section-title"><h2>Динамика регистрации</h2><span>${escapeHtml(title)}</span></div>
      ${investorLineChart(data.byDate, [], "Регистрация", "")}
    </section>
    <section class="investor-card">
      <div class="section-title"><h2>Поликлиники: регистрация / пре / пост</h2><span>сравнение участия</span></div>
      ${investorGroupedBarChart(data.byClinic)}
      <div class="chart-legend"><span class="legend-neutral">Регистрация</span><span class="legend-a">Пре-тест</span><span class="legend-b">Пост-тест</span></div>
    </section>
    <section class="investor-card">
      <div class="section-title"><h2>Средний результат по поликлиникам</h2><span>пре и пост</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Поликлиника</th><th>Пре-тест</th><th>Пост-тест</th><th>Рост</th></tr></thead>
          <tbody>${data.byClinic.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.preAverage}%</td><td>${item.postAverage}%</td><td>${item.postAverage - item.preAverage >= 0 ? "+" : ""}${item.postAverage - item.preAverage}%</td></tr>`).join("") || "<tr><td colspan='4'>Пока нет данных</td></tr>"}</tbody>
        </table>
      </div>
    </section>
  `;
}

function investorOverview() {
  const data = state.investor;
  return html`
    <section class="investor-grid">
      ${investorKpi("Врачи в системе", investorNumber(data.summary.doctorsTotal), "активная сеть", "", "Сколько врачей подключены к цифровой платформе и могут работать с пациентами.")}
      ${investorKpi("Анкеты пациентов", investorNumber(data.summary.surveysTotal), "скрининг на местах", "soft", "Сколько пациентов уже прошли первичный цифровой опрос и расчет рисков.")}
      ${investorKpi("Осмотры врачей", investorNumber(data.summary.visitsTotal), "клинические действия", "success", "Сколько раз врач открыл карту пациента и зафиксировал осмотр, анализы или назначения.")}
      ${investorKpi("Пост-тест врачей", investorNumber(data.summary.doctorTrainingPostAverage, "%"), "средний результат", "hot", "Средний итоговый уровень знаний врачей после обучения.")}
      ${investorKpi("Новые пациенты", investorNumber(data.summary.newPatients30Days), "за последние 30 дней", "soft", "Сколько новых анкет зарегистрировано за последние 30 дней.")}
      ${investorKpi("Высокое давление", investorNumber(data.summary.highPressurePercent, "%"), "среди анкет", "hot", "Доля пациентов с давлением 140/90 и выше.")}
      ${investorKpi("Повышенный сахар", investorNumber(data.summary.highGlucosePercent, "%"), "среди анкет", "hot", "Доля пациентов с уровнем сахара 6,1 ммоль/л и выше.")}
      ${investorKpi("Повторные визиты", investorNumber(data.summary.openFollowUps), "открытые задачи", "success", "Сколько повторных визитов и задач ещё ожидают выполнения.")}
    </section>
    ${investorPlainInfo("Что показывает этот экран", [
      { title: "Охват", text: "Сколько сотрудников и пациентов уже включены в проект." },
      { title: "Активность", text: "Сколько анкет и осмотров реально выполнено, а не только запланировано." },
      { title: "Качество обучения", text: "Какой средний результат участники показывают после обучения." },
      { title: "Риски", text: "Какая доля пациентов требует внимания врача или дополнительного контроля." }
    ])}
    <section class="investor-split">
      <div class="investor-card wide">
        <div class="section-title"><h2>Динамика работы</h2><span>анкеты и осмотры по дням</span></div>
        ${investorLineChart(data.nurses.surveyByDate, data.clinical.visitsByDate, "Анкеты", "Осмотры")}
      </div>
      <div class="investor-card">
        <div class="section-title"><h2>Риски пациентов</h2><span>доля повышенного риска</span></div>
        <div class="donut-grid">
          ${data.clinical.risk.map((item, index) => investorDonut(item.label, item.value, index === 0 ? "hot" : index === 1 ? "soft" : "")).join("")}
        </div>
      </div>
    </section>
    <section class="investor-split">
      <div class="investor-card">
        <div class="section-title"><h2>Врачи по поликлиникам</h2><span>покрытие</span></div>
        ${investorBarChart(data.doctors.registeredByClinic, "value", "#0f766e")}
      </div>
      <div class="investor-card">
        <div class="section-title"><h2>Анкеты по поликлиникам</h2><span>активность скрининга</span></div>
        ${investorBarChart(data.nurses.surveyByClinic, "value", "#dc2626")}
      </div>
    </section>
  `;
}

function investorClinics() {
  const data = state.investor;
  return html`
    <section class="investor-split">
      <div class="investor-card">
        <div class="section-title"><h2>Покрытие врачами</h2><span>по поликлиникам</span></div>
        ${investorBarChart(data.doctors.registeredByClinic, "value", "#0f766e")}
      </div>
      <div class="investor-card">
        <div class="section-title"><h2>Работа медсестер</h2><span>анкеты пациентов</span></div>
        ${investorBarChart(data.nurses.surveyByClinic, "value", "#b91c1c")}
      </div>
    </section>
    <section class="investor-card">
      <div class="section-title"><h2>Клинические диагнозы</h2><span>по осмотрам врачей</span></div>
      ${investorBarChart(data.clinical.diagnoses, "value", "#7c3aed")}
    </section>
    <section class="investor-card">
      <div class="section-title"><h2>Эффективность поликлиник</h2><span>охват и клиническая работа</span></div>
      <div class="table-wrap"><table><thead><tr><th>Поликлиника</th><th>Врачи</th><th>Анкеты</th><th>Осмотры</th><th>Высокий риск</th></tr></thead><tbody>${data.clinical.clinicPerformance.map((clinic) => `<tr><td>${escapeHtml(clinic.label)}</td><td>${clinic.doctors}</td><td>${clinic.surveys}</td><td>${clinic.visits}</td><td>${clinic.highRisk}</td></tr>`).join("")}</tbody></table></div>
    </section>
  `;
}

async function loadMinzdravGeoDashboard() {
  state.minzdravGeoLoading = true;
  try {
    state.minzdravGeo = await api("/api/minzdrav/geo-dashboard");
  } catch (err) {
    state.minzdravGeoError = err.message;
  } finally {
    state.minzdravGeoLoading = false;
    renderInvestorDashboard();
  }
}

function renderMinzdravGeoPanel() {
  if (state.minzdravGeoLoading) {
    return `<div class="card p-4"><p class="muted">Загрузка гео-аналитики Минздрава...</p></div>`;
  }
  if (!state.minzdravGeo) {
    loadMinzdravGeoDashboard();
    return `<div class="card p-4"><p class="muted">Загрузка гео-аналитики Минздрава...</p></div>`;
  }

  const { totals, funnel, clinics } = state.minzdravGeo;

  return html`
    <div class="minzdrav-dashboard">
      <div class="minzdrav-header-card">
        <div>
          <h2>Сводный гео-мониторинг скрининга НИЗ</h2>
          <p class="muted">Официальные индикаторы охвата населения скринингом неинфекционных заболеваний (артериальная гипертензия и сахарный диабет 2 типа) по поликлиникам г. Душанбе и регионам РТ.</p>
        </div>
        <div class="minzdrav-export-btn">
          <a class="button primary" href="/api/minzdrav/report.csv" download>📥 Скачать отчёт Минздрава (Excel / CSV)</a>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="investor-kpis">
        ${investorKpi("Охвачено скринингом", totals.screenedPatients.toLocaleString("ru-RU"), "Всего осмотрено пациентов", "kpi-blue")}
        ${investorKpi("Подозрение на АГ", `${totals.hypertensionPercent}%`, `${totals.hypertensionSuspected.toLocaleString("ru-RU")} пациентов (АД ≥ 140/90)`, "kpi-red")}
        ${investorKpi("Риск диабета", `${totals.diabetesPercent}%`, `${totals.diabetesSuspected.toLocaleString("ru-RU")} пациентов (сахар ≥ 6.1 / FINDRISC ≥ 12)`, "kpi-orange")}
        ${investorKpi("Дошли до врача", `${totals.doctorConversionPercent}%`, `${totals.visitedDoctor.toLocaleString("ru-RU")} принято врачами`, "kpi-green")}
        ${investorKpi("Получили лечение", `${totals.therapyPercent}%`, `${totals.therapyPrescribed.toLocaleString("ru-RU")} назначена терапия`, "kpi-teal")}
      </div>

      <!-- Clinical Funnel -->
      <section class="investor-card minzdrav-funnel-card">
        <div class="section-title">
          <h2>Клиническая воронка скрининга</h2>
          <span>маршрут пациента от медсестры до назначения терапии</span>
        </div>
        <div class="minzdrav-funnel-grid">
          ${funnel.map((step, idx) => html`
            <div class="funnel-step-box step-${idx + 1}">
              <div class="funnel-step-badge">Этап ${idx + 1}</div>
              <strong>${step.count.toLocaleString("ru-RU")}</strong>
              <span>${escapeHtml(step.step)}</span>
              <div class="funnel-bar"><i style="width: ${step.percent}%"></i></div>
              <small>${step.percent}% от скрининга</small>
            </div>
          `).join("")}
        </div>
      </section>

      <!-- Comparative Heat Table of Polyclinics -->
      <section class="investor-card">
        <div class="section-title">
          <h2>Сравнительный мониторинг поликлиник</h2>
          <span>показатели скрининга, выявляемости и врачебного охвата</span>
        </div>
        <div class="table-wrap">
          <table class="minzdrav-table">
            <thead>
              <tr>
                <th>Поликлиника / Медучреждение</th>
                <th>Охвачено</th>
                <th>План / Охват</th>
                <th>Выявлен риск</th>
                <th>Подозрение на АГ</th>
                <th>Риск Диабета</th>
                <th>Принято врачом</th>
                <th>Терапия</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              ${clinics.map((c) => {
                const statusPill = c.grade === "high"
                  ? `<span class="pill ok">Лидер</span>`
                  : c.grade === "medium"
                    ? `<span class="pill warning">В графике</span>`
                    : `<span class="pill danger">Требует внимания</span>`;
                return html`
                  <tr>
                    <td><strong>${escapeHtml(c.clinic)}</strong></td>
                    <td><strong>${c.surveysCount.toLocaleString("ru-RU")}</strong></td>
                    <td>
                      <div class="mini-progress-cell">
                        <span>${c.coveragePercent}% (${c.targetPatients})</span>
                        <div class="mini-progress-bar"><i style="width: ${c.coveragePercent}%; background: ${c.grade === 'high' ? 'var(--primary)' : c.grade === 'medium' ? '#f59e0b' : '#ef4444'}"></i></div>
                      </div>
                    </td>
                    <td>${c.highRiskCount} <small class="muted">(${c.highRiskPercent}%)</small></td>
                    <td><span class="text-danger">${c.hypertensionCount}</span> <small class="muted">(${c.hypertensionPercent}%)</small></td>
                    <td><span class="text-orange">${c.diabetesCount}</span> <small class="muted">(${c.diabetesPercent}%)</small></td>
                    <td>${c.visitedDoctorCount} <small class="muted">(${c.conversionToDoctor}%)</small></td>
                    <td>${c.therapyCount}</td>
                    <td>${statusPill}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderInvestorDashboard() {
  const data = state.investor;
  if (!data) return;
  const tabs = [
    ["overview", "Обзор"],
    ["minzdrav", "🏛️ Дашборд Минздрава РТ"],
    ["doctors", "Обучение врачей"],
    ["nurses", "Обучение медсестер"],
    ["clinics", "Поликлиники"]
  ];
  const content = state.investorTab === "minzdrav"
    ? renderMinzdravGeoPanel()
    : state.investorTab === "doctors"
      ? investorEducationPanel("doctors", "врачи")
      : state.investorTab === "nurses"
        ? investorEducationPanel("nurses", "медсестры")
        : state.investorTab === "clinics"
          ? investorClinics()
          : investorOverview();
  setPage(html`
    <main class="investor-shell">
      <section class="investor-hero">
        <div>
          <span class="investor-eyebrow">E-Clinic Control</span>
          <h1>Инвестиционная аналитика проекта</h1>
          <p>Живая картина внедрения: обучение персонала, активность поликлиник, скрининг пациентов и клинические результаты.</p>
        </div>
        <div class="investor-hero-card">
          <span>Обновлено</span>
          <strong>${new Date(data.generatedAt).toLocaleString("ru-RU")}</strong>
          <small>Данные берутся напрямую из работающей системы</small>
          <div class="hero-card-actions">
            <a class="button-link" href="/api/investor/report.csv">Скачать отчёт CSV</a>
            <a class="button-link secondary" href="/api/minzdrav/report.csv" download>📥 Отчёт Минздрава (Excel)</a>
          </div>
        </div>
      </section>
      <nav class="investor-tabs">
        ${tabs.map(([tab, label]) => `<button data-action="investor-tab" data-tab="${tab}" class="${state.investorTab === tab ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <section class="investor-view">${content}</section>
    </main>
  `);
}

function monitorQuery() {
  const params = new URLSearchParams();
  if (state.monitorClinicFilter !== "all") params.set("clinic", state.monitorClinicFilter);
  if (state.monitorNurseFilter !== "all") params.set("nurse", state.monitorNurseFilter);
  if (state.monitorDoctorFilter !== "all") params.set("doctor", state.monitorDoctorFilter);
  if (state.monitorDateFilter) params.set("date", state.monitorDateFilter);
  return params.toString();
}

async function loadMonitorDashboard(resetTimer = true) {
  state.monitor = await api(`/api/monitor/dashboard?${monitorQuery()}`);
  renderMonitorDashboard();
  if (resetTimer) {
    clearInterval(monitorRefreshTimer);
    monitorRefreshTimer = setInterval(() => loadMonitorDashboard(false).catch(() => {}), 15000);
  }
}

function monitorNumber(value, suffix = "") {
  return `${Number(value || 0).toLocaleString("ru-RU")}${suffix}`;
}

function monitorKpi(label, value, note, tone = "") {
  return html`
    <div class="monitor-kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note || "")}</small>
    </div>
  `;
}

function monitorExplain(text) {
  return `<p class="monitor-explain">${escapeHtml(text)}</p>`;
}

function monitorBarChart(items, keys, colors) {
  const max = Math.max(1, ...items.flatMap((item) => keys.map((key) => Number(item[key] || 0))));
  return html`
    <div class="monitor-bars">
      ${items.slice(0, 12).map((item) => html`
        <div class="monitor-bar-line">
          <span>${escapeHtml(item.label)}</span>
          <div>
            ${keys.map((key, index) => `<i style="width:${Math.max(4, (Number(item[key] || 0) / max) * 100)}%; background:${colors[index]}"></i>`).join("")}
          </div>
          <strong>${keys.map((key) => monitorNumber(item[key])).join(" / ")}</strong>
        </div>
      `).join("") || `<p class="muted">Пока нет данных</p>`}
    </div>
  `;
}

function monitorSparkline(items, key) {
  const values = (items || []).map((item) => Number(item[key] || 0));
  const max = Math.max(1, ...values);
  const points = values.length
    ? values.map((value, index) => `${values.length === 1 ? 100 : (index / (values.length - 1)) * 300},${110 - (value / max) * 95}`).join(" ")
    : "0,110 300,110";
  return html`
    <svg class="monitor-spark" viewBox="0 0 320 130" role="img">
      <polyline points="${points}"></polyline>
    </svg>
  `;
}

function monitorFilters() {
  const data = state.monitor || { filters: { clinics: [], nurses: [], doctors: [] } };
  const optionList = (items, selected) => items.map((item) => `<option value="${escapeHtml(item)}" ${selected === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
  if (!state.monitorReportFrom || !state.monitorReportTo) {
    const today = new Date();
    const previousMonday = new Date(today);
    const daysSinceMonday = (today.getDay() + 6) % 7;
    previousMonday.setDate(today.getDate() - daysSinceMonday - 7);
    const previousSaturday = new Date(previousMonday);
    previousSaturday.setDate(previousMonday.getDate() + 5);
    const localDate = (value) => {
      const offset = value.getTimezoneOffset();
      return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
    };
    state.monitorReportFrom = localDate(previousMonday);
    state.monitorReportTo = localDate(previousSaturday);
  }
  return html`
    <section class="monitor-filters">
      <div class="form-row">
        <label>Поликлиника</label>
        <select id="monitorClinic"><option value="all">Все поликлиники</option>${optionList(data.filters.clinics || [], state.monitorClinicFilter)}</select>
      </div>
      <div class="form-row">
        <label>Врач</label>
        <select id="monitorDoctor"><option value="all">Все врачи</option>${optionList(data.filters.doctors || [], state.monitorDoctorFilter)}</select>
      </div>
      <div class="form-row">
        <label>Медсестра</label>
        <select id="monitorNurse"><option value="all">Все медсестры</option>${optionList(data.filters.nurses || [], state.monitorNurseFilter)}</select>
      </div>
      <div class="form-row">
        <label>День</label>
        <input id="monitorDate" type="date" value="${escapeHtml(state.monitorDateFilter)}" />
      </div>
      <button type="button" data-action="monitor-refresh">Обновить</button>
      <div class="monitor-report-period">
        <div class="form-row">
          <label>Отчет с</label>
          <input id="monitorReportFrom" type="date" value="${escapeHtml(state.monitorReportFrom)}" />
        </div>
        <div class="form-row">
          <label>По</label>
          <input id="monitorReportTo" type="date" value="${escapeHtml(state.monitorReportTo)}" />
        </div>
        <button type="button" class="secondary" data-action="monitor-report">Скачать отчет Word</button>
      </div>
    </section>
  `;
}

function monitorOverview() {
  const data = state.monitor;
  return html`
    <section class="monitor-grid">
      ${monitorKpi("Анкеты пациентов", monitorNumber(data.summary.surveys), "Сколько пациентов медсестры или врачи добавили в систему по выбранным фильтрам.", "")}
      ${monitorKpi("Активные медсестры", monitorNumber(data.summary.nursesActive), "Сколько разных медсестер реально внесли хотя бы одного пациента.", "mint")}
      ${monitorKpi("Просмотры врачей", monitorNumber(data.summary.doctorViews), "Сколько раз врачи открывали карты пациентов для просмотра или работы.", "blue")}
      ${monitorKpi("Осмотры с действиями", monitorNumber(data.summary.visitsWithActions), "Сколько осмотров завершилось назначением, планом, лабораторией или повторным обследованием.", "red")}
    </section>
    <section class="monitor-split">
      <div class="monitor-card wide">
        <h2>Работа по дням</h2>
        ${monitorSparkline(data.byDate, "surveys")}
        <div class="monitor-legend"><span>Медсестры добавили</span><span>Врачи посмотрели</span><span>Осмотры с действиями</span></div>
        ${monitorBarChart(data.byDate, ["surveys", "doctorViews", "actions"], ["#0f766e", "#2563eb", "#dc2626"])}
        ${monitorExplain("Каждая строка — отдельный день. Первое число показывает, сколько пациентов добавили медсестры/врачи, второе — сколько карт открыли врачи, третье — сколько осмотров было с назначениями или планом.")}
      </div>
      <div class="monitor-card">
        <h2>Маршрутизация</h2>
        <div class="monitor-ring" style="--value:${Math.min(100, Math.round((data.summary.needsDoctor / Math.max(1, data.summary.surveys)) * 100))}">
          <strong>${monitorNumber(Math.round((data.summary.needsDoctor / Math.max(1, data.summary.surveys)) * 100), "%")}</strong>
          <span>к врачу</span>
        </div>
        ${monitorExplain("Этот процент показывает долю пациентов, которым система рекомендовала направление к врачу после заполнения анкеты.")}
      </div>
    </section>
    <section class="monitor-split">
      <div class="monitor-card">
        <h2>Поликлиники</h2>
        ${monitorBarChart(data.clinics, ["surveys", "visitsWithActions"], ["#0f766e", "#dc2626"])}
        ${monitorExplain("По каждой поликлинике видно: первое число — сколько пациентов внесено, второе — сколько врачебных осмотров завершилось конкретными действиями.")}
      </div>
      <div class="monitor-card">
        <h2>Последние действия</h2>
        ${monitorEventList(data.events.slice(0, 8))}
        ${monitorExplain("Лента показывает последние шаги сотрудников: отправка анкеты, открытие карты врачом и сохранение осмотра.")}
      </div>
    </section>
  `;
}

function monitorEventLabel(type) {
  const labels = {
    nurse_survey_created: "Анкета отправлена",
    doctor_patient_created: "Врач добавил пациента",
    doctor_survey_viewed: "Врач открыл карту",
    doctor_visit_created: "Осмотр сохранен"
  };
  return labels[type] || type;
}

function monitorEventList(events) {
  return html`
    <div class="monitor-feed">
      ${events.map((event) => html`
        <div class="monitor-feed-item">
          <time>${new Date(event.createdAt).toLocaleString("ru-RU")}</time>
          <strong>${escapeHtml(monitorEventLabel(event.type))}</strong>
          <span>${escapeHtml(event.actorRole === "nurse" ? "Медсестра" : (event.actorName || "-"))} • ${escapeHtml(event.clinic || "-")}</span>
          <p>${escapeHtml(event.patientName || "-")} — ${escapeHtml(event.details || "")}</p>
        </div>
      `).join("") || `<p class="muted">Пока нет действий</p>`}
    </div>
  `;
}

function monitorTable(headers, rows) {
  return html`
    <div class="table-wrap monitor-table">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("") || `<tr><td colspan="${headers.length}">Нет данных</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function monitorNursesPanel() {
  const rows = (state.monitor.nurses || []).map((item) => html`
    <tr>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.clinic)}</td>
      <td>${escapeHtml(item.nurseName)}</td>
      <td>${escapeHtml(item.surveys)}</td>
      <td>${escapeHtml(item.needsDoctor)}</td>
    </tr>
  `);
  return html`
    <section class="monitor-split">
      <div class="monitor-card">
        <h2>Работа медсестёр</h2>
        ${monitorBarChart(state.monitor.nurses || [], ["surveys", "needsDoctor"], ["#0f766e", "#f59e0b"])}
        ${monitorExplain("По каждой медсестре видно число заполненных анкет за день и сколько пациентов из них система направила к врачу.")}
      </div>
      <div class="monitor-card wide">
        <h2>Ежедневный отчёт медсестёр</h2>
        <p class="muted monitor-table-note">Можно отфильтровать отчёт по поликлинике, медсестре и дате.</p>
        ${monitorTable(["День", "Поликлиника", "Медсестра", "Осмотрено", "К врачу"], rows)}
      </div>
    </section>
  `;
}

function monitorDoctorsPanel() {
  const rows = (state.monitor.doctors || []).map((item) => html`
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.views)}</td>
      <td>${escapeHtml(item.visits)}</td>
      <td>${escapeHtml(item.visitsWithActions)}</td>
      <td>${escapeHtml(item.drugs)}</td>
      <td>${item.lastAction ? new Date(item.lastAction).toLocaleString("ru-RU") : "-"}</td>
    </tr>
  `);
  return html`
    <section class="monitor-split">
      <div class="monitor-card">
        <h2>Работа врачей</h2>
        ${monitorBarChart(state.monitor.doctors, ["views", "visitsWithActions"], ["#2563eb", "#dc2626"])}
        ${monitorExplain("Первое число — сколько карт пациентов врач открыл, второе — сколько осмотров завершил назначением, планом, лабораторией или повторным обследованием.")}
      </div>
      <div class="monitor-card wide">
        <h2>Таблица врачей</h2>
        ${monitorTable(["Врач", "Открыл карт", "Осмотров", "С действиями", "Препаратов", "Последнее действие"], rows)}
        ${monitorExplain("Здесь видно не только просмотры, но и реальную врачебную работу: осмотры, назначения препаратов и последние действия.")}
      </div>
    </section>
  `;
}

function monitorTablesPanel() {
  const surveyRows = (state.monitor.surveys || []).map((survey) => html`
    <tr>
      <td>${new Date(survey.createdAt).toLocaleString("ru-RU")}</td>
      <td>${escapeHtml(survey.clinic)}</td>
      <td>${escapeHtml(survey.patientName)}</td>
      <td>${survey.findrisc}</td>
      <td>${survey.score2}%</td>
      <td>${survey.needsDoctor ? "Да" : "Нет"}</td>
      <td>${survey.viewedByDoctors}</td>
      <td>${survey.visitsWithActions}</td>
    </tr>
  `);
  const visitRows = (state.monitor.visits || []).map((visit) => html`
    <tr>
      <td>${new Date(visit.createdAt).toLocaleString("ru-RU")}</td>
      <td>${escapeHtml(visit.clinic)}</td>
      <td>${escapeHtml(visit.doctorName)}</td>
      <td>${escapeHtml(visit.patientName)}</td>
      <td>${visit.hasAction ? "Да" : "Нет"}</td>
      <td>${escapeHtml(visit.diagnosis || "-")}</td>
      <td>${escapeHtml(visit.drugs || "-")}</td>
      <td>${visit.followUpDays || "-"}</td>
    </tr>
  `);
  return html`
    <section class="monitor-card">
      <h2>Анкеты пациентов</h2>
      ${monitorTable(["Дата", "Поликлиника", "Пациент", "FINDRISC", "СС риск", "К врачу", "Открыли", "Действия"], surveyRows)}
      ${monitorExplain("В этой таблице каждая строка — один пациент, которого внесли в систему. Имена медсестер скрыты; анализ ведется по поликлиникам и датам.")}
    </section>
    <section class="monitor-card">
      <h2>Осмотры врачей</h2>
      ${monitorTable(["Дата", "Поликлиника", "Врач", "Пациент", "С действиями", "Диагноз", "Препараты", "Повтор"], visitRows)}
      ${monitorExplain("В этой таблице каждая строка — сохраненный врачебный осмотр с диагнозом, препаратами и сроком повторного обследования.")}
    </section>
  `;
}

function renderMonitorDashboard() {
  const data = state.monitor;
  if (!data) return;
  const tabs = [
    ["overview", "Обзор"],
    ["nurses", "Анкеты по дням"],
    ["doctors", "Врачи"],
    ["events", "Лента действий"],
    ["tables", "Таблицы"]
  ];
  const content = state.monitorTab === "nurses"
    ? monitorNursesPanel()
    : state.monitorTab === "doctors"
      ? monitorDoctorsPanel()
      : state.monitorTab === "events"
        ? `<section class="monitor-card"><h2>Живая лента действий</h2>${monitorEventList(data.events)}${monitorExplain("Лента нужна для наблюдения в реальном времени: кто, из какой поликлиники и с каким пациентом совершил действие.")}</section>`
        : state.monitorTab === "tables"
          ? monitorTablesPanel()
          : monitorOverview();
  setPage(html`
    <main class="monitor-shell">
      <section class="monitor-hero">
        <div>
          <span class="monitor-eyebrow">E-Clinic Control • приложение №7</span>
          <h1>Экран наблюдения</h1>
          <p>Оперативный контроль работы медсестер и врачей: анкеты, просмотры карт, осмотры, назначения, лаборатория и повторные обращения.</p>
        </div>
        <div class="monitor-live-card">
          <span>Обновлено</span>
          <strong>${new Date(data.generatedAt).toLocaleTimeString("ru-RU")}</strong>
          <small>Автообновление каждые 15 секунд</small>
          <button type="button" class="secondary" data-action="logout">Выйти</button>
        </div>
      </section>
      ${monitorFilters()}
      <nav class="monitor-tabs">
        ${tabs.map(([tab, label]) => `<button data-action="monitor-tab" data-tab="${tab}" class="${state.monitorTab === tab ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <section class="monitor-view">${content}</section>
    </main>
  `);
  bindMonitorFilters();
}

function bindMonitorFilters() {
  const bind = (id, key) => {
    document.querySelector(id)?.addEventListener("change", async (event) => {
      state[key] = event.target.value;
      await loadMonitorDashboard(false);
    });
  };
  bind("#monitorClinic", "monitorClinicFilter");
  bind("#monitorNurse", "monitorNurseFilter");
  bind("#monitorDoctor", "monitorDoctorFilter");
  bind("#monitorDate", "monitorDateFilter");
}

function renderAdminLogin() {
  setPage(html`
    <main class="login">
      <form class="panel form" id="adminLogin">
        <h1>Вход администратора</h1>
        <div class="form-row"><label>Логин</label><input name="username" autocomplete="username" required /></div>
        <div class="form-row"><label>Пароль</label><input type="password" name="password" autocomplete="current-password" required /></div>
        <button>Войти</button>
        <p class="muted">Используйте выданные вам учётные данные.</p>
      </form>
    </main>
  `);
  document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login/admin", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      const appMode = document.body.dataset.app;
      window.location.href = appMode === "monitor" ? MONITOR_APP_PATH : appMode === "investor" ? INVESTOR_APP_PATH : ADMIN_APP_PATH;
    } catch (error) {
      alert(error.message);
    }
  });
}

function renderDoctorLogin() {
  const t = (value) => translateDoctorText(value);
  setPage(html`
    <main class="login">
      <form class="panel form" id="doctorLogin">
        <h1>${escapeHtml(t("Вход врача"))}</h1>
        ${doctorLanguageControl()}
        <div class="form-row"><label>${escapeHtml(t("Логин врача"))}</label><input name="login" required /></div>
        <div class="form-row"><label>${escapeHtml(t("Специальный ключ"))}</label><input type="password" name="accessKey" required /></div>
        <button>${escapeHtml(t("Войти"))}</button>
      </form>
    </main>
  `);
  bindDoctorLanguageControl(renderDoctorLogin);
  showDoctorLanguagePrompt(renderDoctorLogin);
  document.querySelector("#doctorLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login/doctor", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      window.location.href = DOCTOR_APP_PATH;
    } catch (error) {
      alert(error.message);
    }
  });
}

async function loadAdmin() {
  state.adminLoading = true;
  state.adminLoadError = "";
  renderAdmin();
  try {
    const params = new URLSearchParams({ tab: state.tab || "stats" });
    if (state.tab === "audit") {
      params.set("page", String(state.auditPage || 1));
      params.set("clinic", state.auditClinic || "all");
    }
    if (state.tab === "surveys") {
      params.set("page", String(state.surveyPage || 1));
      params.set("clinic", state.surveyClinicFilter || "all");
      if (state.surveySearch) params.set("search", state.surveySearch);
    }
    const dashboard = state.tab === "audit"
      ? await api(`/api/admin/dashboard?${params}`, { method: "POST", body: JSON.stringify({ search: state.auditSearch || "" }) })
      : await api(`/api/admin/dashboard?${params}`);
    state.admin = { ...(state.admin || {}), ...dashboard };
  } catch (error) {
    state.adminLoadError = error.message || "Не удалось загрузить данные";
  } finally {
    state.adminLoading = false;
    renderAdmin();
  }
}

function renderAdmin() {
  const visibleTabs = state.me?.role === "head_nurse"
    ? ["stats", "center", "surveys", "operations", "audit"]
    : ["stats", "center", "control", "doctors", "training", "nurseTraining", "surveys", "visits", "operations", "audit", "access", "qr"];
  if (state.me?.role === "owner") visibleTabs.splice(visibleTabs.indexOf("access"), 0, "headNurses");
  const nav = visibleTabs.map((tab) => {
    const names = { stats: "Статистика", center: "Диабет-контроль 2.0", control: "Контроль диабета", doctors: "Врачи", training: "Обучение №4", nurseTraining: "Медсестры №5", surveys: "Пациенты", visits: "Назначения", operations: "План и сообщения", audit: "Журнал", headNurses: "Контроль старших", access: "Доступы", qr: "QR" };
    return `<button data-action="admin-tab" data-tab="${tab}" class="${state.tab === tab ? "active" : ""}">${names[tab]}</button>`;
  }).join("");
  setPage(html`
    <div class="layout">
      ${topbar("Панель администратора", nav)}
      <main class="container admin-container">${state.adminLoading
        ? `<section class="panel"><h2>Загрузка данных…</h2><p class="muted">Пожалуйста, подождите.</p></section>`
        : state.adminLoadError
          ? `<section class="panel"><h2>Не удалось загрузить данные</h2><p>${escapeHtml(state.adminLoadError)}</p><button type="button" data-action="admin-tab" data-tab="${escapeHtml(state.tab)}">Повторить</button></section>`
          : adminTab()}</main>
    </div>
  `);
  bindAdminForms();
}

function adminTab() {
  if (state.tab === "center" || state.tab === "control") return renderCareControlAdmin();
  if (state.tab === "doctors") return renderDoctorsAdmin();
  if (state.tab === "training") return renderTrainingAdmin();
  if (state.tab === "nurseTraining") return renderNurseTrainingAdmin();
  if (state.tab === "surveys") return renderSurveyTable(state.admin?.surveys || []);
  if (state.tab === "visits") return renderVisitsAdmin();
  if (state.tab === "operations") return renderOperationsAdmin();
  if (state.tab === "audit") return renderAuditAdmin();
  if (state.tab === "headNurses") return renderHeadNurseActivityAdmin();
  if (state.tab === "access") return renderAccessAdmin();
  if (state.tab === "qr") return renderQrAdmin();
  return renderStatsAdmin();
}

function adminSurveyClinics() {
  const clinics = state.admin.surveyClinics || (state.admin.surveys || []).map(surveyClinic);
  return [...new Set(clinics)]
    .filter((clinic) => clinic && !isExcludedClinicName(clinic))
    .sort((a, b) => clinicSortKey(a).localeCompare(clinicSortKey(b), "ru"));
}

function filteredAdminSurveys() {
  return state.admin?.surveys || [];
}

function renderStatsAdmin() {
  const s = state.admin.stats;
  return html`
    <section class="panel dashboard-panel">
      <h2>Статистика</h2>
      <section class="grid three">
        <div class="card metric">Врачей<strong>${money(s.doctorsTotal)}</strong></div>
        <div class="card metric">Анкет медсестры<strong>${money(s.surveysTotal)}</strong></div>
        <div class="card metric">Осмотров врача<strong>${money(s.visitsTotal)}</strong></div>
        <div class="card metric">Участников обучения<strong>${money(state.admin.trainingStats?.participantsTotal || 0)}</strong></div>
        <div class="card metric">Тест до обучения<strong>${money(state.admin.trainingStats?.preCompleted || 0)}</strong></div>
        <div class="card metric">Средний до обучения<strong>${money(state.admin.trainingStats?.preAveragePercent || 0)}%</strong></div>
        <div class="card metric">После обучения<strong>${money(state.admin.trainingStats?.taskCompleted || 0)} задач</strong></div>
        <div class="card metric">Медсестер №5<strong>${money(state.admin.nurseTrainingStats?.participantsTotal || 0)}</strong></div>
        <div class="card metric">№5 после обучения прошли<strong>${money(state.admin.nurseTrainingStats?.postPassed || 0)}</strong></div>
        <div class="card metric">Нужно к врачу<strong>${money(s.needsDoctor)} / ${s.needsDoctorPercent}%</strong></div>
        <div class="card metric">FINDRISC повышен<strong>${money(s.highFindrisc)} / ${s.highFindriscPercent}%</strong></div>
        <div class="card metric">Сердечно-сосудистый риск высок<strong>${money(s.highScore2)} / ${s.highScore2Percent}%</strong></div>
      </section>
    </section>
    <section class="grid two" style="margin-top:16px">
      ${drugStats("Препараты СД 2 типа", state.admin.drugStats.diabetesDrugCounts)}
      ${drugStats("Препараты АГ", state.admin.drugStats.hypertensionDrugCounts)}
    </section>
`;
}

function renderTrainingAdmin() {
  const attemptsByParticipant = (state.admin.trainingAttempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const participants = (state.admin.trainingParticipants || []).filter((participant) => !isExcludedClinicName(participant.clinic)).filter((participant) =>
    trainingParticipantMatchesFilters(participant, attemptsByParticipant[participant.id] || [], "training")
  );
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(participants.length / pageSize));
  state.trainingAdminPage = Math.min(Math.max(1, state.trainingAdminPage || 1), totalPages);
  const start = (state.trainingAdminPage - 1) * pageSize;
  const pageParticipants = participants.slice(start, start + pageSize);
  const from = participants.length ? start + 1 : 0;
  const to = Math.min(start + pageSize, participants.length);
  const rows = pageParticipants.map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const visibleAttempts = filterAttemptsByDate(attempts, state.trainingDateFilter);
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const tasks = attempts.filter((attempt) => attempt.type === "task");
    const postSummary = postTrainingSummary(tasks);
    return html`
      <tr>
        <td>${escapeHtml(participant.fullName)}</td>
        <td>${escapeHtml(participant.clinic || "")}</td>
        <td>${escapeHtml(participant.specialty || "")}</td>
        <td>
          <div class="result-cell">
            <span>${pre ? `${pre.correct}/${pre.total} (${pre.percent}%)` : "<span class='pill warn'>Не сдал</span>"}</span>
            ${pre ? `<button type="button" class="secondary mini" data-action="reset-training-attempts" data-id="${participant.id}" data-phase="pre" ${state.admin.canEdit ? "" : "disabled"}>Перепройти</button>` : ""}
          </div>
        </td>
        <td>
          <div class="result-cell">
            <span>${postSummary.label}</span>
            ${tasks.length ? `<button type="button" class="secondary mini" data-action="reset-training-attempts" data-id="${participant.id}" data-phase="post" ${state.admin.canEdit ? "" : "disabled"}>Перепройти</button>` : ""}
          </div>
        </td>
        <td><button class="danger" data-action="delete-training-participant" data-id="${participant.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
      </tr>
      ${visibleAttempts.length ? `<tr><td colspan="6">${trainingParticipantAdminDetails(visibleAttempts)}</td></tr>` : ""}
    `;
  }).join("");
  return html`
      <section class="panel" id="trainingAdminResults">
        <div class="section-heading">
          <h2>Результаты обучения</h2>
          <a href="/api/admin/training-answer-keys.csv"><button type="button" class="secondary">Скачать ключи ответов №4</button></a>
        </div>
        <details class="compact-admin-form">
          <summary>+ Добавить врача на обучение</summary>
          <form class="form" id="trainingParticipantForm">
            <section class="grid two">
              <div class="form-row"><label>ФИО врача</label><input name="fullName" required /></div>
              ${select("Поликлиника/ГЦЗ", "clinic", clinicOptions)}
              <div class="form-row"><label>Специальность/должность</label><input name="specialty" /></div>
              <div class="form-row"><label>Телефон</label><input name="phone" /></div>
            </section>
            <div class="actions">
              <button ${state.admin.canEdit ? "" : "disabled"}>Добавить в №4</button>
              <span class="muted">После добавления врач найдет свое имя по ссылке №4.</span>
            </div>
          </form>
        </details>
        ${adminTrainingFilters("training")}
        <div class="muted">Показано участников: ${participants.length} из ${(state.admin.trainingParticipants || []).length}. На странице: ${from}-${to}</div>
        ${trainingRegistrationSummary(participants, "врачей")}
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Поликлиника</th><th>Специальность</th><th>До обучения</th><th>Тесты после обучения</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>Пока нет участников обучения</td></tr>"}</tbody>
          </table>
        </div>
        ${adminTrainingPagination(participants.length, state.trainingAdminPage, totalPages)}
      </section>
  `;
}

function adminTrainingPagination(total, page, totalPages) {
  if (total <= 20) return "";
  const start = (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);
  return html`
    <div class="patient-pagination">
      <span>${start}-${end} / ${total}</span>
      <div class="actions">
        <button type="button" class="secondary" data-action="training-admin-page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Назад</button>
        <button type="button" class="secondary" data-action="training-admin-page" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Далее</button>
      </div>
    </div>
  `;
}

function adminTrainingFilters(kind) {
  const clinicValue = kind === "training" ? state.trainingClinicFilter : state.nurseTrainingClinicFilter;
  const dateValue = kind === "training" ? state.trainingDateFilter : state.nurseTrainingDateFilter;
  const registrationDateValue = kind === "training" ? state.trainingRegistrationDateFilter : state.nurseTrainingRegistrationDateFilter;
  const selectedClinics = Array.isArray(clinicValue) ? clinicValue : [clinicValue || "all"];
  return html`
    <div class="grid three" style="margin-bottom:14px">
      <div class="form-row">
        <label>Поликлиника</label>
        <select id="${kind}ClinicFilter" multiple size="6">
          <option value="all"${selectedClinics.includes("all") ? " selected" : ""}>Все поликлиники</option>
          ${clinicOptions.map(([value, text]) => `<option value="${escapeHtml(value)}"${selectedClinics.includes(value) ? " selected" : ""}>${escapeHtml(text)}</option>`).join("")}
        </select>
        <div class="muted">Можно выбрать несколько: удерживайте Ctrl и нажимайте нужные поликлиники.</div>
      </div>
      <div class="form-row">
        <label>Дата сдачи теста</label>
        <input id="${kind}DateFilter" type="date" value="${escapeHtml(dateValue)}" />
      </div>
      <div class="form-row">
        <label>Дата регистрации</label>
        <input id="${kind}RegistrationDateFilter" type="date" value="${escapeHtml(registrationDateValue)}" />
      </div>
    </div>
  `;
}

function attemptDate(attempt) {
  return attempt?.createdAt ? new Date(attempt.createdAt).toISOString().slice(0, 10) : "";
}

function attemptDateLabel(attempt) {
  return attempt?.createdAt ? new Date(attempt.createdAt).toLocaleString("ru-RU") : "дата не указана";
}

function participantRegistrationDate(participant) {
  return participant?.createdAt ? new Date(participant.createdAt).toISOString().slice(0, 10) : "";
}

function participantRegistrationDateLabel(date) {
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU") : "Дата не указана";
}

function filterAttemptsByDate(attempts, date) {
  return date ? attempts.filter((attempt) => attemptDate(attempt) === date) : attempts;
}

function trainingParticipantMatchesFilters(participant, attempts, kind) {
  const clinicFilter = kind === "training" ? state.trainingClinicFilter : state.nurseTrainingClinicFilter;
  const dateFilter = kind === "training" ? state.trainingDateFilter : state.nurseTrainingDateFilter;
  const registrationDateFilter = kind === "training" ? state.trainingRegistrationDateFilter : state.nurseTrainingRegistrationDateFilter;
  const selectedClinics = Array.isArray(clinicFilter) ? clinicFilter : [clinicFilter || "all"];
  const clinicMatches = selectedClinics.length === 0 || selectedClinics.includes("all") || selectedClinics.includes(participant.clinic);
  const dateMatches = !dateFilter || attempts.some((attempt) => attemptDate(attempt) === dateFilter);
  const registrationDateMatches = !registrationDateFilter || participantRegistrationDate(participant) === registrationDateFilter;
  return clinicMatches && dateMatches && registrationDateMatches;
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "Не указано";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summaryRows(data, formatKey = (key) => key) {
  return Object.entries(data)
    .sort(([a], [b]) => clinicSortKey(a).localeCompare(clinicSortKey(b), "ru"))
    .map(([key, count]) => `<tr><td>${escapeHtml(formatKey(key))}</td><td>${count}</td></tr>`)
    .join("");
}

function trainingRegistrationSummary(participants, noun) {
  const byDate = countBy(participants, participantRegistrationDate);
  const byClinic = countBy(participants, (participant) => participant.clinic || "Не указано");
  return html`
    <section class="grid two" style="margin:14px 0">
      <div class="card">
        <h3>Зарегистрировано по дням</h3>
        <div class="table-wrap"><table><tbody>${summaryRows(byDate, participantRegistrationDateLabel) || `<tr><td>Нет ${noun}</td><td>0</td></tr>`}</tbody></table></div>
      </div>
      <div class="card">
        <h3>Участники по поликлиникам</h3>
        <div class="table-wrap"><table><tbody>${summaryRows(byClinic) || `<tr><td>Нет ${noun}</td><td>0</td></tr>`}</tbody></table></div>
      </div>
    </section>
  `;
}

function trainingParticipantAdminDetails(attempts) {
  return attempts.map((attempt) => {
    if (attempt.type === "task") return trainingTaskAdminDetails(attempt);
    return trainingAttemptDetails(attempt, `${attempt.instrument || ""}. ${attempt.title || "Тест до обучения"}`);
  }).join("");
}

function postTrainingSummary(tasks) {
  const correct = tasks.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
  const total = tasks.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const completed = tasks.length >= 5;
  if (!completed) return { percent, passed: false, label: `${percent}% (${tasks.length}/5)` };
  const passed = percent >= 70;
  return {
    percent,
    passed,
    label: `${percent}% (${tasks.length}/5) ${passed ? '<span class="pill ok">Пройден</span>' : '<span class="pill danger">Не пройден</span>'}`
  };
}

function trainingAttemptDetails(attempt, title = "Тест") {
  const rows = (attempt.details || []).map((detail, index) => {
    const selected = detail.selected ? `${detail.selected}. ${detail.selectedText || ""}` : "Нет ответа";
    const correct = `${detail.correctAnswer}. ${detail.correctText || ""}`;
    return html`
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(detail.questionText || `Вопрос №${detail.questionId}`)}</td>
        <td>${escapeHtml(selected)}</td>
        <td>${escapeHtml(correct)}</td>
        <td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td>
      </tr>
    `;
  }).join("");
  return html`
    <details class="answer-details">
      <summary>${title}: ${attemptDateLabel(attempt)} - показать ответы врача (${attempt.correct}/${attempt.total}, ${attempt.percent}%)</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>№</th><th>Вопрос</th><th>Ответ врача</th><th>Правильный ответ</th><th>Оценка</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5'>Детали ответов не сохранены</td></tr>"}</tbody>
        </table>
      </div>
    </details>
  `;
}

function trainingTaskAdminDetails(attempt) {
  const task = attempt.task || {};
  const criteria = (task.criteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const answerRows = (attempt.details || []).map((detail, index) => {
    const selectedText = detail.selectedText ? `${detail.selected}. ${detail.selectedText}` : detail.selected;
    const correctText = detail.correctText ? `${detail.correctAnswer}. ${detail.correctText}` : detail.correctAnswer;
    return `<tr><td>${index + 1}. ${escapeHtml(detail.label || "")}</td><td>${escapeHtml(selectedText || "-")}</td><td>${escapeHtml(correctText || "-")}</td><td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td></tr>`;
  }).join("");
  return html`
    <details class="answer-details">
      <summary>${escapeHtml(attempt.instrument || "")}: ${escapeHtml(attempt.title || "")} - ${attemptDateLabel(attempt)} - ${attempt.correct ?? 0}/${attempt.total || attempt.maxScore} (${attempt.percent || 0}%)</summary>
      <div class="notice warn">
        <strong>Критерии:</strong>
        <ul>${criteria}</ul>
        ${task.key ? `<div><strong>Ориентировочный ключ:</strong> ${escapeHtml(task.key)}</div>` : ""}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Раздел</th><th>Ответ врача</th><th>Правильный ответ</th><th>Оценка</th></tr></thead>
          <tbody>${answerRows || "<tr><td colspan='4'>Ответов нет</td></tr>"}</tbody>
        </table>
      </div>
      <form class="score-form grid two" data-attempt-id="${attempt.id}">
        <div class="form-row"><label>Балл администратора, максимум ${attempt.maxScore}</label><input name="manualScore" inputmode="decimal" value="${attempt.manualScore ?? attempt.correct ?? ""}" /></div>
        <div class="form-row"><label>Комментарий</label><input name="trainerComment" value="${escapeHtml(attempt.trainerComment || "")}" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Сохранить оценку</button>
      </form>
    </details>
  `;
}

function renderNurseTrainingAdmin() {
  const attemptsByParticipant = (state.admin.nurseTrainingAttempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const participants = (state.admin.nurseTrainingParticipants || []).filter((participant) => !isExcludedClinicName(participant.clinic)).filter((participant) =>
    trainingParticipantMatchesFilters(participant, attemptsByParticipant[participant.id] || [], "nurseTraining")
  );
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(participants.length / pageSize));
  state.nurseTrainingAdminPage = Math.min(Math.max(1, state.nurseTrainingAdminPage || 1), totalPages);
  const start = (state.nurseTrainingAdminPage - 1) * pageSize;
  const pageParticipants = participants.slice(start, start + pageSize);
  const from = participants.length ? start + 1 : 0;
  const to = Math.min(start + pageSize, participants.length);
  const rows = pageParticipants.map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const visibleAttempts = filterAttemptsByDate(attempts, state.nurseTrainingDateFilter);
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const post = attempts.find((attempt) => attempt.type === "post");
    return html`
      <tr>
        <td>${escapeHtml(participant.fullName)}</td>
        <td>${escapeHtml(participant.clinic || "")}</td>
        <td>${escapeHtml(participant.position || "")}</td>
        <td>
          <div class="result-cell">
            <span>${pre ? `${pre.percent}%` : "<span class='pill warn'>Не сдан</span>"}</span>
            ${pre ? `<button type="button" class="secondary mini" data-action="reset-nurse-training-attempts" data-id="${participant.id}" data-phase="pre" ${state.admin.canEdit ? "" : "disabled"}>Перепройти</button>` : ""}
          </div>
        </td>
        <td>
          <div class="result-cell">
            <span>${post ? `${post.percent}% ${post.passed ? '<span class="pill ok">Пройден</span>' : '<span class="pill danger">Не пройден</span>'}` : "<span class='pill warn'>Не сдан</span>"}</span>
            ${post ? `<button type="button" class="secondary mini" data-action="reset-nurse-training-attempts" data-id="${participant.id}" data-phase="post" ${state.admin.canEdit ? "" : "disabled"}>Перепройти</button>` : ""}
          </div>
        </td>
        <td><button class="danger" data-action="delete-nurse-training-participant" data-id="${participant.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
      </tr>
      ${visibleAttempts.length ? `<tr><td colspan="6">${nurseTrainingAttemptDetails(visibleAttempts)}</td></tr>` : ""}
    `;
  }).join("");
  return html`
      <section class="panel" id="nurseTrainingAdminResults">
        <div class="section-heading">
          <h2>Результаты №5</h2>
        </div>
        <details class="compact-admin-form">
          <summary>+ Добавить медсестру на обучение</summary>
          <form class="form" id="nurseTrainingParticipantForm">
            <section class="grid two">
              <div class="form-row"><label>ФИО медсестры</label><input name="fullName" required /></div>
              ${select("Поликлиника/ГЦЗ", "clinic", clinicOptions)}
              <div class="form-row"><label>Должность</label><input name="position" value="Медсестра" /></div>
              <div class="form-row"><label>Телефон</label><input name="phone" /></div>
            </section>
            <div class="actions">
              <button ${state.admin.canEdit ? "" : "disabled"}>Добавить в №5</button>
              <span class="muted">После добавления медсестра найдет свое имя по ссылке №5.</span>
            </div>
          </form>
        </details>
        ${adminTrainingFilters("nurseTraining")}
        <div class="muted">Показано участников: ${participants.length} из ${(state.admin.nurseTrainingParticipants || []).length}. На странице: ${from}-${to}</div>
        ${trainingRegistrationSummary(participants, "медсестер")}
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Поликлиника</th><th>Должность</th><th>До обучения</th><th>После обучения</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>Пока нет медсестер</td></tr>"}</tbody>
          </table>
        </div>
        ${adminNurseTrainingPagination(participants.length, state.nurseTrainingAdminPage, totalPages)}
      </section>
  `;
}

function adminNurseTrainingPagination(total, page, totalPages) {
  if (total <= 20) return "";
  const start = (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);
  return html`
    <div class="patient-pagination">
      <span>${start}-${end} / ${total}</span>
      <div class="actions">
        <button type="button" class="secondary" data-action="nurse-training-admin-page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Назад</button>
        <button type="button" class="secondary" data-action="nurse-training-admin-page" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Далее</button>
      </div>
    </div>
  `;
}

function nurseTrainingAttemptDetails(attempts) {
  return attempts.map((attempt) => {
    const rows = (attempt.details || []).map((detail, index) => html`
      <tr>
        <td>${index + 1}. ${escapeHtml(detail.questionText)}</td>
        <td>${escapeHtml(detail.selected ? `${detail.selected}. ${detail.selectedText}` : "-")}</td>
        <td>${escapeHtml(`${detail.correctAnswer}. ${detail.correctText}`)}</td>
        <td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td>
      </tr>
    `).join("");
    return html`
      <details class="answer-details">
        <summary>${escapeHtml(attempt.title)}: ${attemptDateLabel(attempt)} - ${attempt.correct}/${attempt.total} (${attempt.percent}%) ${attempt.type === "post" ? (attempt.passed ? "Пройден" : "Не пройден") : ""}</summary>
        <div class="table-wrap"><table><thead><tr><th>Вопрос</th><th>Ответ</th><th>Правильный ответ</th><th>Оценка</th></tr></thead><tbody>${rows}</tbody></table></div>
      </details>
    `;
  }).join("");
}

function drugStats(title, data) {
  const rows = Object.entries(data).map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join("");
  return html`<div class="panel"><h3>${title}</h3><div class="table-wrap"><table><tbody>${rows || "<tr><td>Пока нет данных</td><td></td></tr>"}</tbody></table></div></div>`;
}

function renderDoctorsAdmin() {
  const keyNotice = state.lastDoctorKey ? html`
    <div class="notice ok" id="newKey">
      <div>Специальный ключ врача при регистрации:</div>
      <strong>${escapeHtml(state.lastDoctorKey.fullName)}</strong>
      <input readonly value="${escapeHtml(state.lastDoctorKey.accessKey)}" style="margin-top:8px" />
    </div>
  ` : '<div id="newKey"></div>';
  const rows = state.admin.doctors.filter((doctor) => !isExcludedClinicName(doctor.clinic)).map((doctor) => {
    const revealedKey = state.lastDoctorKey?.doctorId === doctor.id ? html`
      <div class="doctor-key-reveal notice ok" style="margin-top:8px">
        <strong>Новый временный ключ</strong>
        <div class="actions" style="margin-top:6px">
          <input readonly value="${escapeHtml(state.lastDoctorKey.accessKey)}" aria-label="Новый временный ключ врача" />
          <button type="button" class="secondary" data-action="copy-doctor-key">Копировать</button>
        </div>
        <div class="muted">Ключ виден только до обновления страницы.</div>
      </div>
    ` : "";
    return html`
    <tr>
      <td>${escapeHtml(doctor.fullName)}</td>
      <td>${escapeHtml(doctor.login)}</td>
      <td>
        <span class="pill ok">Ключ хранится защищённо</span>
        <div class="muted">Действующий ключ зашифрован. Можно быстро создать новый временный ключ.</div>
        <form class="doctor-key-form" data-id="${doctor.id}" style="margin-top:8px">
          <div class="actions">
            <input name="accessKey" minlength="5" autocomplete="new-password" placeholder="Новый ключ" ${state.admin.canEdit ? "" : "disabled"} />
            <button type="button" class="secondary" data-action="generate-doctor-key" ${state.admin.canEdit ? "" : "disabled"}>Создать ключ</button>
            <button class="secondary" ${state.admin.canEdit ? "" : "disabled"}>Сохранить</button>
          </div>
        </form>
        ${revealedKey}
      </td>
      <td>${escapeHtml(doctor.clinic)}</td>
      <td>${escapeHtml(doctor.specialty)}</td>
      <td>${doctor.experienceYears}</td>
      <td><button class="danger" data-action="delete-doctor" data-id="${doctor.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
    </tr>
  `;
  }).join("");
  return html`
    <section class="grid two doctor-admin-layout">
      <form class="panel form doctor-create-panel" id="doctorForm">
        <h2>Создать профиль врача</h2>
        <div class="form-row"><label>ФИО</label><input name="fullName" required /></div>
        <div class="form-row"><label>Логин</label><input name="login" required /></div>
        <div class="form-row"><label>Паспортная часть</label><textarea name="passport" required></textarea></div>
        ${select("Поликлиника", "clinic", clinicOptions)}
        <div class="form-row"><label>Специальность</label><input name="specialty" required /></div>
        <div class="form-row"><label>Стаж работы</label><input name="experienceYears" inputmode="numeric" required /></div>
        <div class="form-row"><label>Специальный ключ, можно оставить пустым</label><input name="accessKey" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Создать</button>
        ${keyNotice}
      </form>
      <section class="panel">
        <h2>Список врачей</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Логин</th><th>Пароль / ключ</th><th>Поликлиника</th><th>Специальность</th><th>Стаж</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='7'>Пока нет врачей</td></tr>"}</tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderSurveyTable(surveys) {
  const clinics = adminSurveyClinics();
  const filterOptions = [
    `<option value="all"${state.surveyClinicFilter === "all" ? " selected" : ""}>Все поликлиники</option>`,
    ...clinics.map((clinic) => `<option value="${escapeHtml(clinic)}"${state.surveyClinicFilter === clinic ? " selected" : ""}>${escapeHtml(clinic)}</option>`)
  ].join("");
  const rows = (surveys || []).map((survey) => html`
    <tr>
      <td>${escapeHtml(fullName(survey.patient))}<div class="muted">${escapeHtml(survey.patient?.clinic || "")}</div></td>
      <td>${survey.patient?.birthDate || ""}</td>
      <td>${survey.measurements?.systolic ?? "-"}/${survey.measurements?.diastolic ?? "-"}</td>
      <td>${survey.findrisc?.score ?? "-"} - ${survey.findrisc?.level || ""}</td>
      <td>${survey.score2?.percent ?? "-"}% - ${survey.score2?.level || ""}</td>
      <td>${survey.measurements?.weight || survey.measurements?.rabitoWeight || "-"} кг<div class="muted">${survey.measurements?.weight ? "По весам" : "Расчёт Rabito"}</div></td>
      <td>${survey.needsDoctor ? `<span class="pill danger">К врачу</span><div class="muted">${escapeHtml(referralReasonText(survey))}</div>` : '<span class="pill ok">Обычный риск</span>'}</td>
      <td>${survey.createdAt ? new Date(survey.createdAt).toLocaleString("ru-RU") : "-"}</td>
      <td><details><summary>Изменить</summary><form class="patient-edit-form form" data-id="${survey.id}">
        <input name="lastName" value="${escapeHtml(survey.patient?.lastName || "")}" placeholder="Фамилия" required />
        <input name="firstName" value="${escapeHtml(survey.patient?.firstName || "")}" placeholder="Имя" required />
        <input name="middleName" value="${escapeHtml(survey.patient?.middleName || "")}" placeholder="Отчество" />
        <input name="birthDate" type="date" value="${escapeHtml(survey.patient?.birthDate || "")}" />
        <input name="phone" value="${escapeHtml(survey.patient?.phone || "")}" placeholder="Телефон" />
        <input name="address" value="${escapeHtml(survey.patient?.address || "")}" placeholder="Адрес" />
        <input name="clinic" value="${escapeHtml(survey.patient?.clinic || "")}" required />
        <label><input name="reminderConsent" type="checkbox" ${survey.patient?.reminderConsent ? "checked" : ""}/> Согласие на напоминания</label>
        <select name="reminderChannel"><option value="none">Не отправлять</option><option value="sms" ${survey.patient?.reminderChannel === "sms" ? "selected" : ""}>SMS</option><option value="telegram" ${survey.patient?.reminderChannel === "telegram" ? "selected" : ""}>Telegram</option></select>
        <input name="telegramChatId" value="${escapeHtml(survey.patient?.telegramChatId || "")}" placeholder="Telegram chat ID" />
        <button>Сохранить</button>
      </form><button class="${survey.archivedAt ? "secondary" : "danger"}" data-action="patient-archive" data-id="${survey.id}" data-archived="${survey.archivedAt ? "false" : "true"}">${survey.archivedAt ? "Восстановить" : "В архив"}</button></details></td>
    </tr>
  `).join("");
  const patientOptions = (surveys || []).filter((survey) => !survey.archivedAt).map((survey) => `<option value="${survey.id}">${escapeHtml(fullName(survey.patient))} — ${escapeHtml(survey.patient?.clinic || "")}</option>`).join("");
  const total = Number(state.admin?.surveysTotal ?? surveys.length ?? 0);
  const page = Number(state.admin?.surveysPage || state.surveyPage || 1);
  const pageCount = Number(state.admin?.surveysPageCount || 1);
  const pageSize = Number(state.admin?.surveysPageSize || 50);
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return html`
    <section class="panel">
      <h2>Анкеты медсестры</h2>
      <details class="compact-admin-form"><summary>Объединить дубликаты пациентов</summary><form id="patientMergeForm" class="form grid two"><label>Карточка-дубликат<select name="sourceId">${patientOptions}</select></label><label>Основная карточка<select name="targetId">${patientOptions}</select></label><button>Объединить</button></form></details>
      <form id="surveySearchForm" class="audit-search-form">
        <label for="surveySearch">Поиск пациента</label>
        <div class="actions">
          <input id="surveySearch" name="query" type="search" value="${escapeHtml(state.surveySearch)}" placeholder="Фамилия, имя, телефон или дата рождения" autocomplete="off" />
          <button>Найти</button>
          ${state.surveySearch ? `<button type="button" class="secondary" data-action="clear-survey-search">Сбросить</button>` : ""}
        </div>
      </form>
      <div class="filter-bar">
        <div class="form-row">
          <label>Фильтр пациентов по поликлиникам</label>
          <select id="surveyClinicFilter">${filterOptions}</select>
        </div>
        <div class="muted">Показано анкет: ${from}–${to} из ${total}; по ${pageSize} на странице</div>
      </div>
      <div class="audit-pagination" aria-label="Страницы анкет">
        <button type="button" class="secondary" data-action="survey-page" data-direction="-1" ${page <= 1 ? "disabled" : ""}>← Назад</button>
        <span>Страница ${page} из ${pageCount}</span>
        <button type="button" class="secondary" data-action="survey-page" data-direction="1" ${page >= pageCount ? "disabled" : ""}>Вперёд →</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Пациент</th><th>Дата рождения</th><th>АД</th><th>FINDRISC</th><th>Сердечно-сосудистый риск</th><th>Вес</th><th>Статус</th><th>Дата</th><th>Карточка</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='9'>Пока нет анкет</td></tr>"}</tbody>
        </table>
      </div>
      <div class="audit-pagination" aria-label="Страницы анкет">
        <button type="button" class="secondary" data-action="survey-page" data-direction="-1" ${page <= 1 ? "disabled" : ""}>← Назад</button>
        <span>Страница ${page} из ${pageCount}</span>
        <button type="button" class="secondary" data-action="survey-page" data-direction="1" ${page >= pageCount ? "disabled" : ""}>Вперёд →</button>
      </div>
    </section>
  `;
}

function renderOperationsAdmin() {
  const clinics = adminSurveyClinics();
  const options = clinics.map((clinic) => `<option>${escapeHtml(clinic)}</option>`).join("");
  const reminders = (state.admin.reminderQueue || []).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,100).map((item) => `<tr><td>${escapeHtml(item.channel)}</td><td>${escapeHtml(item.recipientMasked)}</td><td>${new Date(item.scheduledAt).toLocaleString("ru-RU")}</td><td><span class="pill ${item.status === "sent" ? "ok" : item.status === "blocked" ? "warn" : ""}">${escapeHtml(item.status)}</span><div class="muted">${escapeHtml(item.reason || "")}</div></td></tr>`).join("");
  return html`<section class="grid two"><form id="clinicTargetForm" class="panel form"><h2>Цели поликлиники</h2><select name="clinic" required>${options}</select><input name="monthlyPatients" type="number" min="0" placeholder="Пациентов в месяц"/><input name="monthlyVisits" type="number" min="0" placeholder="Осмотров в месяц"/><input name="followUpCompletionPercent" type="number" min="0" max="100" placeholder="Повторные визиты, %"/><button>Сохранить цели</button></form><section class="panel"><h2>Очередь напоминаний</h2><p class="muted">Статус «blocked» означает, что согласие/контакт отсутствуют или поставщик SMS/Telegram ещё не подключён.</p><div class="table-wrap"><table><thead><tr><th>Канал</th><th>Получатель</th><th>Когда</th><th>Статус</th></tr></thead><tbody>${reminders || "<tr><td colspan='4'>Очередь пуста</td></tr>"}</tbody></table></div></section></section>`;
}

function referralReasonText(survey) {
  return (survey.referralReasons || []).join("; ") || "Повышенный риск";
}

function renderVisitsAdmin() {
  const doctors = Object.fromEntries(state.admin.doctors.map((doctor) => [doctor.id, doctor.fullName]));
  const surveys = Object.fromEntries(state.admin.surveys.map((survey) => [survey.id, fullName(survey.patient)]));
  const excludedSurveyIds = new Set(state.admin.surveys.filter((survey) => isExcludedClinicName(surveyClinic(survey))).map((survey) => survey.id));
  const excludedDoctorIds = new Set(state.admin.doctors.filter((doctor) => isExcludedClinicName(doctor.clinic)).map((doctor) => doctor.id));
  const rows = state.admin.visits.filter((visit) => !excludedSurveyIds.has(visit.surveyId) && !excludedDoctorIds.has(visit.doctorId)).map((visit) => html`
    <tr>
      <td>${escapeHtml(doctors[visit.doctorId] || "Врач")}</td>
      <td>${escapeHtml(surveys[visit.surveyId] || "Пациент")}</td>
      <td>ИМТ ${visit.bmi || "-"} / АД ${visit.systolic}/${visit.diastolic} / сахар ${visit.glucose || "-"}${visit.diagnosis ? `<div class="muted">Диагноз: ${escapeHtml(visit.diagnosis)}</div>` : ""}</td>
      <td>${(visit.referrals || []).join(", ") || "-"}</td>
      <td>${visit.followUpDays ? `Через ${visit.followUpDays} дней` : "-"}</td>
      <td>${doctorLabSummary(visit.laboratoryTests)}</td>
      <td>${doctorLifestyleSummary(visit.lifestyleRecommendations)}</td>
      <td>${escapeHtml((visit.diabetesDrugs || []).join("; "))}</td>
      <td>${escapeHtml((visit.hypertensionDrugs || []).join("; "))}</td>
      <td>${new Date(visit.createdAt).toLocaleString("ru-RU")}</td>
    </tr>
  `).join("");
  return html`
    <section class="panel">
      <h2>Действия врачей</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Врач</th><th>Пациент</th><th>ИМТ / АД</th><th>Направление</th><th>Повторное обследование</th><th>Лаборатория</th><th>Рекомендации</th><th>СД 2</th><th>АГ</th><th>Дата</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='10'>Пока нет записей</td></tr>"}</tbody>
        </table>
      </div>
    </section>
  `;
}

function doctorLifestyleSummary(recommendations = {}) {
  const items = [];
  if (recommendations.diabetesDiet) items.push("Диета");
  if (recommendations.physicalActivity) items.push("Физическая активность");
  return items.length ? items.join(", ") : "-";
}

function doctorLabSummary(labs = []) {
  if (!Array.isArray(labs) || !labs.length) return "-";
  return labs.map((lab) => {
    const fields = lab.fields && typeof lab.fields === "object"
      ? Object.entries(lab.fields).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(", ")
      : "";
    const status = lab.status === 'ordered' ? 'Назначен' : 'Результат получен';
    return `${lab.test || "Анализ"} — ${status}${lab.resultDate ? ` (${lab.resultDate})` : lab.orderedDate ? ` (${lab.orderedDate})` : ''}${lab.result ? `: ${lab.result}` : ''}${fields ? ` (${fields})` : ''}`;
  }).join("; ");
}

function adminRoleOptions(selected = "observer") {
  const roles = [
    ["owner", "Главный администратор"],
    ["manager", "Администратор"],
    ["head_nurse", "Старшая медсестра"],
    ["observer", "Наблюдатель"]
  ];
  return roles.map(([value, text]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${text}</option>`).join("");
}

function renderAuditAdmin() {
  const labels = {
    nurse_survey_created: "Создана анкета",
    doctor_patient_created: "Врач добавил пациента",
    doctor_survey_viewed: "Открыта карта пациента",
    doctor_visit_created: "Сохранён осмотр",
    patient_task_created: "Создана задача",
    patient_task_updated: "Изменён статус задачи",
    doctor_account_updated: "Изменён аккаунт врача",
    doctor_created: "Создан профиль врача",
    doctor_updated: "Изменён профиль врача",
    doctor_deleted: "Удалён профиль врача",
    admin_password_changed: "Администратор сменил пароль",
    admin_created: "Создан администратор",
    admin_updated: "Изменён администратор",
    admin_deleted: "Удалён администратор"
    , admin_login: "Вход в аккаунт"
    , survey_answers_corrected: "Исправлена анкета"
  };
  const events = state.admin.activityEvents || [];
  const clinics = state.admin.auditClinics || [];
  const page = Number(state.admin.auditPage || 1);
  const pageCount = Number(state.admin.auditPageCount || 1);
  const rows = events.map((event) => html`<tr>
    <td>${new Date(event.createdAt).toLocaleString("ru-RU")}</td>
    <td>${escapeHtml(event.actorName || event.actorRole || "Система")}</td>
    <td>${escapeHtml(labels[event.type] || event.type)}</td>
    <td>${event.patientName && event.surveyId
      ? `<button type="button" class="audit-patient-link" data-action="open-audit-survey" data-id="${escapeHtml(event.surveyId)}">${escapeHtml(event.patientName)}</button>`
      : escapeHtml(event.patientName || "-")}</td>
    <td>${escapeHtml(event.clinic || "-")}</td>
    <td>${escapeHtml(event.details || "-")}</td>
  </tr>`).join("");
  return html`<section class="panel"><div class="section-title"><div><h2>Журнал действий</h2><p class="muted">Найдите пациента по фамилии, медсестре или поликлинике и нажмите на имя, чтобы открыть анкету.</p></div></div>
    <form id="auditSearchForm" class="audit-search-form">
      <label for="auditSearch">Поиск и фильтры журнала</label>
      <div class="actions">
        <input id="auditSearch" name="query" type="search" value="${escapeHtml(state.auditSearch)}" placeholder="Фамилия пациента, медсестра или поликлиника" autocomplete="off" />
        <select id="auditClinic" name="clinic" aria-label="Фильтр по поликлинике">
          <option value="all" ${state.auditClinic === "all" ? "selected" : ""}>Все поликлиники</option>
          ${clinics.map((clinic) => `<option value="${escapeHtml(clinic)}" ${state.auditClinic === clinic ? "selected" : ""}>${escapeHtml(clinic)}</option>`).join("")}
        </select>
        <button type="submit">Найти</button>
        ${state.auditSearch || state.auditClinic !== "all" ? `<button type="button" class="secondary" data-action="clear-audit-search">Сбросить</button>` : ""}
      </div>
      <div class="muted">Записи ${events.length ? (page - 1) * 50 + 1 : 0}–${(page - 1) * 50 + events.length} из ${state.admin.auditTotal || 0}; по 50 на странице</div>
    </form>
    <div class="audit-pagination" aria-label="Страницы журнала">
      <button type="button" class="secondary" data-action="audit-page" data-direction="-1" ${page <= 1 ? "disabled" : ""}>← Назад</button>
      <span>Страница ${page} из ${pageCount}</span>
      <button type="button" class="secondary" data-action="audit-page" data-direction="1" ${page >= pageCount ? "disabled" : ""}>Вперёд →</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Пользователь</th><th>Действие</th><th>Пациент</th><th>Поликлиника</th><th>Описание</th></tr></thead><tbody>${rows || `<tr><td colspan="6">По вашему запросу записи не найдены</td></tr>`}</tbody></table></div>${renderAuditSurveyModal()}</section>`;
}

function renderHeadNurseActivityAdmin() {
  const activity = state.admin.headNurseActivity || { accounts: [], events: [] };
  const query = String(state.headNurseAuditSearch || "").trim().toLocaleLowerCase("ru-RU");
  const labels = { admin_login: "Вход в аккаунт", survey_answers_corrected: "Исправлена анкета" };
  const events = activity.events.filter((event) => !query || [event.actorName, event.clinic, event.patientName, event.details, labels[event.type] || event.type]
    .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(query)));
  const cards = activity.accounts.map((account) => html`<article class="stat-card">
    <strong>${escapeHtml(account.name)}</strong>
    <span>${escapeHtml(account.clinic || "Поликлиника не указана")}</span>
    <span class="muted">Логин: ${escapeHtml(account.username)}</span>
    <span class="muted">Последний вход: ${account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString("ru-RU") : "пока не зафиксирован"}</span>
    <span class="muted">Действий: ${Number(account.changesCount || 0)}</span>
  </article>`).join("");
  const rows = events.map((event) => html`<tr>
    <td>${new Date(event.createdAt).toLocaleString("ru-RU")}</td>
    <td>${escapeHtml(event.actorName || "-")}</td>
    <td>${escapeHtml(event.clinic || "-")}</td>
    <td>${escapeHtml(labels[event.type] || event.type)}</td>
    <td>${event.patientName && event.surveyId
      ? `<button type="button" class="audit-patient-link" data-action="open-audit-survey" data-id="${escapeHtml(event.surveyId)}">${escapeHtml(event.patientName)}</button>`
      : escapeHtml(event.patientName || "-")}</td>
    <td>${escapeHtml(event.details || "-")}</td>
  </tr>`).join("");
  return html`<section class="panel">
    <div class="section-title"><div><h2>Контроль старших медсестёр</h2><p class="muted">Входы в аккаунты и изменения, выполненные старшими медсёстрами. Пароли и медицинские значения здесь не сохраняются.</p></div></div>
    <div class="stats-grid">${cards || `<div class="notice">Аккаунты старших медсестёр пока не созданы.</div>`}</div>
    <form id="headNurseAuditSearchForm" class="audit-search-form">
      <label for="headNurseAuditSearch">Поиск по сотруднику, поликлинике или пациенту</label>
      <div class="actions"><input id="headNurseAuditSearch" name="query" type="search" value="${escapeHtml(state.headNurseAuditSearch)}" placeholder="ФИО, поликлиника, пациент или действие" autocomplete="off" /><button>Найти</button>${state.headNurseAuditSearch ? `<button type="button" class="secondary" data-action="clear-head-nurse-audit-search">Сбросить</button>` : ""}</div>
      <div class="muted">Показано событий: ${events.length} из ${activity.events.length}</div>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Старшая медсестра</th><th>Поликлиника</th><th>Действие</th><th>Пациент</th><th>Описание</th></tr></thead><tbody>${rows || `<tr><td colspan="6">Событий пока нет</td></tr>`}</tbody></table></div>
    ${renderAuditSurveyModal()}
  </section>`;
}

function parseImportCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines.shift().split(delimiter).map(item => item.trim().replace(/^"|"$/g, ''));
  const aliases = { 'Фамилия': 'lastName', 'Имя': 'firstName', 'Отчество': 'middleName', 'Дата рождения': 'birthDate', 'Телефон': 'phone', 'Адрес': 'address', 'Поликлиника': 'clinic', 'Пол': 'sex', 'Возраст': 'age', 'Рост': 'height', 'Вес': 'weight', 'Талия': 'rabitoWaist', 'САД': 'systolic', 'ДАД': 'diastolic', 'Медсестра': 'nurseName' };
  return lines.map(line => {
    const values = line.split(delimiter).map(item => item.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((header, index) => [aliases[header] || header, values[index] || '']));
  });
}

function renderCareControlAdmin() {
  const control = state.admin.careControl || { summary: {}, registry: [], nurseDaily: [], quality: [], duplicates: [] };
  const s = control.summary || {};
  const query = String(state.careSearch || "").trim().toLocaleLowerCase("ru-RU");
  const registry = (control.registry || []).filter((row) => !query || [row.patientName, row.clinic, row.nurseName, row.doctorName, row.stage].some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(query)));
  const rows = registry.slice(0, 300).map((row) => html`<tr>
    <td><button type="button" class="audit-patient-link" data-action="open-audit-survey" data-id="${escapeHtml(row.id)}">${escapeHtml(row.patientName)}</button><div class="muted">${escapeHtml(row.birthDate)}</div></td>
    <td>${escapeHtml(row.clinic)}</td><td>${escapeHtml(row.nurseName)}</td><td>${escapeHtml(row.doctorName || "—")}</td>
    <td><span class="pill ${row.stage.includes("выполнен") ? "ok" : row.stage === "Ожидает врача" ? "warn" : ""}">${escapeHtml(row.stage)}</span><div class="muted">Следующий шаг: ${escapeHtml(row.nextAction || "—")}</div></td>
    <td>${row.findrisc}</td><td>${escapeHtml(row.glucose || "—")}</td><td>${escapeHtml(row.bloodPressure)}</td>
    <td>${row.missingChecklist?.length ? `<span class="pill warn">${escapeHtml(row.missingChecklist.join(", "))}</span>` : `<span class="pill ok">Заполнено</span>`}</td>
    <td>${row.qualityFlags?.length ? `<span class="pill warn">${escapeHtml(row.qualityFlags.join("; "))}</span>` : "—"}</td>
  </tr>`).join("");
  const nurses = (control.nurseDaily || []).slice(0, 200).map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.clinic)}</td><td>${escapeHtml(row.nurseName)}</td><td>${row.screened}</td><td>${row.needsDoctor}</td></tr>`).join("");
  const duplicates = (control.duplicates || []).map((group) => `<tr><td>${escapeHtml(group.reason)}</td><td>${escapeHtml(group.clinic)}</td><td>${group.patients.map((item) => `<div><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.birthDate)} · ${escapeHtml(item.phone || "без телефона")}</div>`).join("")}</td></tr>`).join("");
  const reports = control.dailyReports || {};
  const backup = control.backupStatus;
  return html`
    ${waitingPanel(control.waitingPatients || [], state.admin.canEdit || state.me?.role === 'head_nurse')}
    <section class="panel care-control-hero">
      <div class="section-title"><div><h2>Контроль диабета</h2><p class="muted">Единый регистр, движение пациентов, качество данных и работа медсестёр. Подсказки не заменяют решение врача.</p></div><a class="button-link" href="/api/admin/care-control.xls">Скачать Excel</a></div>
      <div class="grid three care-metrics">
        <div class="card metric">Пациентов<strong>${money(s.patients)}</strong></div><div class="card metric">Ожидают врача<strong>${money(s.awaitingDoctor)}</strong></div><div class="card metric">Осмотрены врачом<strong>${money(s.withDoctorVisit)}</strong></div>
        <div class="card metric">Повтор запланирован<strong>${money(s.followUpPlanned)}</strong></div><div class="card metric">Повтор выполнен<strong>${money(s.followUpCompleted)}</strong></div><div class="card metric">Проверить данные<strong>${money(s.qualityWarnings)}</strong></div>
      </div>
    </section>
    <section class="panel"><div class="section-title"><div><h2>Импорт из Excel</h2><p class="muted">Сохраните таблицу Excel как CSV UTF‑8. Дубли будут пропущены автоматически.</p></div></div><div class="actions"><input id="patientImportFile" type="file" accept=".csv,text/csv"/><button type="button" data-action="import-patients" ${state.admin.canEdit ? "" : "disabled"}>Импортировать пациентов</button></div></section>
    <section class="panel">
      <div class="section-title"><div><h2>Регистр и этапы пациента</h2><p class="muted">Нажмите на имя, чтобы открыть полную анкету.</p></div></div>
      <form id="careSearchForm" class="audit-search-form"><label>Поиск</label><div class="actions"><input name="query" type="search" value="${escapeHtml(state.careSearch)}" placeholder="Пациент, поликлиника, медсестра или этап"/><button>Найти</button>${state.careSearch ? `<button type="button" class="secondary" data-action="clear-care-search">Сбросить</button>` : ""}</div></form>
      <div class="table-wrap"><table><thead><tr><th>Пациент</th><th>Поликлиника</th><th>Медсестра</th><th>Врач</th><th>Этап</th><th>FINDRISC</th><th>Сахар</th><th>АД</th><th>Чек-лист диабета</th><th>Качество</th></tr></thead><tbody>${rows || `<tr><td colspan="10">Записи не найдены</td></tr>`}</tbody></table></div>
      ${renderAuditSurveyModal()}
    </section>
    <section class="grid two">
      <section class="panel"><h2>Ежедневный отчёт старшей медсестры</h2><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Поликлиника</th><th>Медсестра</th><th>Осмотрено</th><th>К врачу</th></tr></thead><tbody>${nurses || `<tr><td colspan="5">Пока нет данных</td></tr>`}</tbody></table></div></section>
      <section class="panel"><h2>Возможные дубликаты</h2><p class="muted">Система только предлагает совпадения. Объединение выполняется вручную в разделе «Пациенты».</p><div class="table-wrap"><table><thead><tr><th>Причина</th><th>Поликлиника</th><th>Карточки</th></tr></thead><tbody>${duplicates || `<tr><td colspan="3">Подозрительных дублей нет</td></tr>`}</tbody></table></div></section>
    </section>
    <section class="grid two">
      <section class="panel"><h2>Резервное копирование</h2><p>${backup ? `Последняя копия: <strong>${new Date(backup.createdAt).toLocaleString("ru-RU")}</strong><br><span class="pill ${backup.verified ? "ok" : "warn"}">${backup.verified ? "Файл проверен" : "Нужна проверка"}</span><br><span class="muted">Хранится на сервере, сохранено до 14 копий.</span>` : "Резервная копия ещё не создавалась."}</p><button type="button" data-action="create-backup" ${state.admin.canManageAdmins ? "" : "disabled"}>Создать и проверить копию</button></section>
      <section class="panel"><h2>Ежедневная сводка Telegram</h2><p class="muted">Отправляется только агрегированная статистика без ФИО пациентов.</p><form id="dailyReportForm" class="form"><label class="checkbox"><input type="checkbox" name="enabled" ${reports.enabled ? "checked" : ""}/> Включить ежедневный отчёт</label><label>Время<input name="time" type="time" value="${escapeHtml(reports.time || "18:00")}"/></label><label>Telegram Chat ID<input name="chatId" value="${escapeHtml(reports.chatId || "")}" placeholder="Например, 123456789"/></label><div class="notice ${reports.tokenConfigured ? "ok" : "warn"}">${reports.tokenConfigured ? "Telegram-бот настроен на сервере." : "На сервере не задан TELEGRAM_BOT_TOKEN."}${reports.lastSentAt ? `<br>Последняя отправка: ${new Date(reports.lastSentAt).toLocaleString("ru-RU")}` : ""}${reports.lastError ? `<br>Последняя ошибка: ${escapeHtml(reports.lastError)}` : ""}</div><div class="actions"><button ${state.admin.canManageAdmins ? "" : "disabled"}>Сохранить</button><button type="button" class="secondary" data-action="test-daily-report" ${state.admin.canManageAdmins ? "" : "disabled"}>Отправить тест</button></div></form></section>
    </section>`;
}

function auditValue(value, fallback = "-") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function auditYesNo(value) {
  if (value === "yes") return "Да";
  if (value === "no") return "Нет";
  return auditValue(value);
}

function renderAuditSurveyModal() {
  const record = state.auditSurvey;
  if (!record?.survey) return "";
  const survey = record.survey;
  const patient = survey.patient || {};
  const measurements = survey.measurements || {};
  const answers = survey.answers || {};
  const details = [
    ["Пациент", fullName(patient)],
    ["Дата рождения", patient.birthDate],
    ["Пол", patient.sex === "male" ? "Мужской" : patient.sex === "female" ? "Женский" : patient.sex],
    ["Телефон", patient.phone],
    ["Адрес", patient.address],
    ["Поликлиника", patient.clinic || survey.clinic],
    ["Медсестра", survey.nurse?.fullName],
    ["Дата анкеты", survey.createdAt ? new Date(survey.createdAt).toLocaleString("ru-RU") : ""],
    ["Рост", measurements.height ? `${measurements.height} см` : ""],
    ["Вес", measurements.weight || measurements.rabitoWeight ? `${measurements.weight || measurements.rabitoWeight} кг` : ""],
    ["ИМТ", measurements.bmi],
    ["Талия", measurements.rabitoWaist ? `${measurements.rabitoWaist} см` : ""],
    ["Артериальное давление", measurements.systolic || measurements.diastolic ? `${auditValue(measurements.systolic)}/${auditValue(measurements.diastolic)}` : ""],
    ["Физическая активность", auditYesNo(answers.activity)],
    ["Овощи и фрукты ежедневно", auditYesNo(answers.vegetables)],
    ["Препараты от давления", auditYesNo(answers.bpMeds)],
    ["Ранее повышенный сахар", auditYesNo(answers.highGlucose)],
    ["Диабет у родственников", answers.familyDiabetes === "first" ? "Да, первая линия" : answers.familyDiabetes === "second" ? "Да, вторая линия" : "Нет"],
    ["Курение", auditYesNo(answers.smoker)],
    ["FINDRISC", `${auditValue(survey.findrisc?.score, "0")} — ${auditValue(survey.findrisc?.level)}`],
    ["Сердечно-сосудистый риск", `${auditValue(survey.score2?.percent, "0")}% — ${auditValue(survey.score2?.level)}`],
    ["Решение", survey.needsDoctor ? `Направить к врачу: ${referralReasonText(survey)}` : "Повышенный риск не выявлен"]
  ];
  return html`
    <div class="language-modal audit-survey-modal" role="dialog" aria-modal="true" aria-labelledby="auditSurveyTitle">
      <section class="language-modal__panel audit-survey-modal__panel">
        <div class="section-title">
          <div><h2 id="auditSurveyTitle">Анкета пациента</h2><p class="muted">Полные данные выбранной записи</p></div>
          <div class="actions"><button type="button" class="secondary" data-action="print-patient-card">Печать / PDF</button><button type="button" class="secondary" data-action="close-audit-survey">Закрыть</button></div>
        </div>
        <div class="audit-survey-grid">
          ${details.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(auditValue(value))}</strong></div>`).join("")}
        </div>
        ${state.admin.canCorrectSurveys ? `<details open><summary><strong>Исправить анкету</strong></summary><form id="correctSurveyAnswers" class="form">
          ${state.admin.canEdit ? `<label>Поликлиника пациента<select name="clinic" required>${survey.patient?.clinic && !clinicOptions.some(([value]) => value === survey.patient.clinic) ? `<option value="${escapeHtml(survey.patient.clinic)}" selected>${escapeHtml(survey.patient.clinic)}</option>` : ''}${clinicOptions.map(([value, text]) => `<option value="${escapeHtml(value)}" ${survey.patient?.clinic === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>` : ''}
          ${[['activity','Физическая активность'],['vegetables','Овощи и фрукты ежедневно'],['bpMeds','Препараты от давления'],['highGlucose','Ранее повышенный сахар'],['smoker','Курение'],['familyDiabetes','Диабет у родственников']].map(([key,label]) => `<label>${label}<select name="${key}" required>${(key === 'familyDiabetes' ? [['none','Нет'],['second','Да, вторая линия'],['first','Да, первая линия']] : [['yes','Да'],['no','Нет']]).map(([value,text]) => `<option value="${value}" ${answers[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`).join('')}
          <label>Систолическое давление<input name="systolic" type="number" inputmode="numeric" min="1" max="300" required value="${escapeHtml(measurements.systolic || '')}"/></label>
          <label>Диастолическое давление<input name="diastolic" type="number" inputmode="numeric" min="1" max="200" required value="${escapeHtml(measurements.diastolic || '')}"/></label>
          <p>Баллы и направление будут пересчитаны. Изменения сохранятся в истории.</p><button type="submit">Сохранить исправления</button><div role="status"></div>
        </form></details>` : ''}
        <section class="patient-next-step"><h3>Следующий шаг</h3><p>${escapeHtml(record.nextAction || "Наблюдение по плану")}</p></section>
        <section class="patient-timeline"><h3>История пациента</h3>${[...(record.events || []), ...(record.visits || []).map(item => ({ createdAt: item.createdAt, actorName: item.doctorName || "Врач", details: "Осмотр врача" })), ...(record.tasks || []).map(item => ({ createdAt: item.createdAt, actorName: "Система", details: `Задача: ${item.title}` }))].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(item => `<article><time>${escapeHtml(new Date(item.createdAt).toLocaleString("ru-RU"))}</time><strong>${escapeHtml(item.actorName || "Система")}</strong><span>${escapeHtml(item.details || "")}</span></article>`).join("") || `<p class="muted">История пока пуста</p>`}</section>
        ${historyPanel(survey.changeHistory || [])}
        <div class="actions"><button type="button" data-action="close-audit-survey">Закрыть анкету</button></div>
      </section>
    </div>
  `;
}

function renderAccessAdmin() {
  const canManage = Boolean(state.admin.canManageAdmins);
  const admins = (state.admin.admins || []).slice().sort((a, b) => {
    const rank = { owner: 0, manager: 1, head_nurse: 2, observer: 3 };
    return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || String(a.name || "").localeCompare(String(b.name || ""), "ru");
  });
  const roleHint = {
    owner: "Все права: данные, врачи, анкеты, обучение, статистика и управление доступами.",
    manager: "Может работать с данными системы, но не может управлять администраторами.",
    head_nurse: "Только просмотр пациентов и отчётов своей поликлиники.",
    observer: "Только просмотр. Изменять и удалять данные нельзя."
  };
  const rows = admins.map((admin) => html`
    <tr>
      <td>
        <strong>${escapeHtml(admin.name)}</strong>
        ${admin.id === state.me?.id ? "<span class='pill ok'>Вы</span>" : ""}
        <div class="muted">${escapeHtml(roleHint[admin.role] || "")}</div>
      </td>
      <td><span class="pill">${escapeHtml(admin.roleLabel || admin.role)}</span>${admin.clinic ? `<div class="muted">${escapeHtml(admin.clinic)}</div>` : ""}</td>
      <td><code>${escapeHtml(admin.username)}</code></td>
      <td><span class="pill ok">Хранится защищённо</span></td>
      <td>${admin.createdAt ? new Date(admin.createdAt).toLocaleDateString("ru-RU") : ""}</td>
      <td>
        <details class="compact-admin-form">
          <summary>Изменить</summary>
          <form class="form admin-access-form" data-id="${admin.id}">
            <section class="grid two">
              <div class="form-row"><label>ФИО</label><input name="name" value="${escapeHtml(admin.name)}" required /></div>
              <div class="form-row"><label>Логин</label><input name="username" value="${escapeHtml(admin.username)}" required /></div>
              <div class="form-row"><label>Новый пароль</label><input name="password" type="password" minlength="5" placeholder="Оставьте пустым, если не менять" /></div>
              <div class="form-row"><label>Роль</label><select name="role">${adminRoleOptions(admin.role)}</select></div>
              <div class="form-row"><label>Поликлиника (для старшей медсестры)</label><select name="clinic"><option value="">Не ограничивать</option>${clinicOptions.map(([value, text]) => `<option value="${value}" ${admin.clinic === value ? "selected" : ""}>${text}</option>`).join("")}</select></div>
            </section>
            <div class="actions">
              <button ${canManage ? "" : "disabled"}>Сохранить</button>
              <button type="button" class="danger" data-action="delete-admin-access" data-id="${admin.id}" ${canManage && admin.id !== state.me?.id ? "" : "disabled"}>Удалить</button>
            </div>
          </form>
        </details>
      </td>
    </tr>
  `).join("");
  return html`
    <section class="panel account-security-panel">
      <h2>Безопасность моего аккаунта</h2>
      <p class="muted">После смены пароля все старые сеансы будут завершены. Если доступ потерян, пароль может сбросить другой главный администратор.</p>
      <form class="form" id="adminPasswordForm">
        <section class="grid two">
          <div class="form-row"><label>Текущий пароль</label><input name="currentPassword" type="password" autocomplete="current-password" required /></div>
          <div class="form-row"><label>Новый пароль</label><input name="newPassword" type="password" autocomplete="new-password" minlength="5" required /></div>
        </section>
        <button>Сменить мой пароль</button>
      </form>
    </section>
    <section class="panel">
      <div class="section-heading">
        <h2>Иерархия доступа</h2>
        <span class="pill ok">Главный админ: ${escapeHtml(admins.find((admin) => admin.role === "owner")?.name || "не указан")}</span>
      </div>
      <div class="notice ${canManage ? "ok" : "warn"}">
        ${canManage
          ? "Вы вошли как главный администратор. Вам доступно создание, изменение и удаление других доступов."
          : "Вы можете просматривать список доступов, но управлять ими может только главный администратор."}
      </div>
      <details class="compact-admin-form" ${canManage ? "open" : ""}>
        <summary>+ Добавить администратора</summary>
        <form class="form" id="adminAccessForm">
          <section class="grid two">
            <div class="form-row"><label>ФИО</label><input name="name" required /></div>
            <div class="form-row"><label>Логин</label><input name="username" required /></div>
            <div class="form-row"><label>Пароль</label><input name="password" type="password" minlength="5" required /></div>
            <div class="form-row"><label>Роль</label><select name="role">${adminRoleOptions("observer")}</select></div>
            <div class="form-row"><label>Поликлиника (для старшей медсестры)</label><select name="clinic"><option value="">Выберите поликлинику</option>${clinicOptions.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></div>
          </section>
          <div class="actions">
            <button ${canManage ? "" : "disabled"}>Добавить доступ</button>
            <span class="muted">Для будущих сотрудников лучше начинать с роли “Наблюдатель”.</span>
          </div>
        </form>
      </details>
      <div class="table-wrap" style="margin-top:16px">
        <table>
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Логин</th><th>Пароль</th><th>Создан</th><th></th></tr></thead>
          <tbody>${rows || "<tr><td colspan='6'>Администраторы не найдены</td></tr>"}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderQrAdmin() {
  const adminUrl = `${location.origin}${ADMIN_APP_PATH}`;
  const doctorUrl = `${location.origin}${DOCTOR_APP_PATH}`;
  const surveyUrl = `${location.origin}${SURVEY_APP_PATH}`;
  const trainingUrl = `${location.origin}${TRAINING_APP_PATH}`;
  const nurseTrainingUrl = `${location.origin}${NURSE_TRAINING_APP_PATH}`;
  const investorUrl = `${location.origin}${INVESTOR_APP_PATH}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(surveyUrl)}`;
  const doctorQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(doctorUrl)}`;
  const trainingQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(trainingUrl)}`;
  const nurseTrainingQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(nurseTrainingUrl)}`;
  const investorQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(investorUrl)}`;
  const monitorQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(monitorUrl)}`;
  return html`
    <section class="panel">
      <h2>Отдельные ссылки приложений</h2>
      <div class="grid two">
        <div class="qr-box">
          <h3>Опросник медсестры</h3>
          <img alt="QR-код анкеты медсестры" src="${qr}" />
          <input readonly value="${surveyUrl}" />
        </div>
        <div class="qr-box">
          <h3>Приложение врача</h3>
          <img alt="QR-код приложения врача" src="${doctorQr}" />
          <input readonly value="${doctorUrl}" />
        </div>
        <div class="qr-box">
          <h3>№4 Проверка знаний врачей</h3>
          <img alt="QR-код проверки знаний врачей" src="${trainingQr}" />
          <input readonly value="${trainingUrl}" />
        </div>
        <div class="qr-box">
          <h3>№5 Тесты медсестер</h3>
          <img alt="QR-код тестов медсестер" src="${nurseTrainingQr}" />
          <input readonly value="${nurseTrainingUrl}" />
        </div>
        <div class="qr-box">
          <h3>№6 Для инвесторов</h3>
          <img alt="QR-код инвесторской аналитики" src="${investorQr}" />
          <input readonly value="${investorUrl}" />
        </div>
        <div class="qr-box">
          <h3>№7 Экран наблюдения</h3>
          <img alt="QR-код экрана наблюдения" src="${monitorQr}" />
          <input readonly value="${monitorUrl}" />
        </div>
      </div>
      <div class="form-row" style="margin-top:16px">
        <label>Приложение администратора</label>
        <input readonly value="${adminUrl}" />
      </div>
      <p class="muted">Для других устройств используйте IP-адрес этого компьютера вместо localhost.</p>
    </section>
  `;
}

function bindAdminForms() {
  bindAdminTrainingFilters();
  document.querySelector("#surveySearchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.surveySearch = String(new FormData(event.currentTarget).get("query") || "").trim();
    state.surveyPage = 1;
    await loadAdmin();
  });
  document.querySelector("#careSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.careSearch = String(new FormData(event.currentTarget).get("query") || "").trim();
    renderAdmin();
  });
  document.querySelector("#dailyReportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    data.enabled = form.elements.enabled.checked;
    try {
      await api("/api/admin/daily-reports", { method: "PUT", body: JSON.stringify(data) });
      alert("Настройки ежедневной сводки сохранены.");
      await loadAdmin();
    } catch (error) { alert(error.message); }
  });
  document.querySelector("#auditSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.auditSearch = String(new FormData(event.currentTarget).get("query") || "").trim();
    state.auditClinic = String(new FormData(event.currentTarget).get("clinic") || state.auditClinic || "all");
    state.auditPage = 1;
    loadAdmin();
  });
  document.querySelector("#auditClinic")?.addEventListener("change", (event) => {
    state.auditClinic = event.currentTarget.value || "all";
    state.auditPage = 1;
    loadAdmin();
  });
  document.querySelector("#headNurseAuditSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.headNurseAuditSearch = String(new FormData(event.currentTarget).get("query") || "").trim();
    renderAdmin();
  });
  document.querySelectorAll(".patient-edit-form").forEach((patientForm) => patientForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(patientForm));
      data.reminderConsent = patientForm.elements.reminderConsent.checked;
      await api(`/api/admin/patients/${patientForm.dataset.id}`, { method: "PUT", body: JSON.stringify(data) });
      await loadAdmin();
    } catch (error) { alert(error.message); }
  }));
  document.querySelector("#patientMergeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirm("Объединить карточки? Дубликат будет архивирован, а его осмотры и задачи перенесены.")) return;
    try {
      await api("/api/admin/patients/merge", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      await loadAdmin();
    } catch (error) { alert(error.message); }
  });
  document.querySelector("#clinicTargetForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/clinic-targets", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      alert("Цели сохранены");
      await loadAdmin();
    } catch (error) { alert(error.message); }
  });
  const adminPasswordForm = document.querySelector("#adminPasswordForm");
  if (adminPasswordForm) adminPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(adminPasswordForm));
      await api("/api/admin/account", { method: "PUT", body: JSON.stringify(data) });
      alert("Пароль изменён. Все старые сеансы завершены, войдите заново.");
      window.location.href = ADMIN_APP_PATH;
    } catch (error) {
      alert(error.message);
    }
  });
  const form = document.querySelector("#doctorForm");
  if (form) form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api("/api/admin/doctors", { method: "POST", body: JSON.stringify(data) });
      state.lastDoctorKey = { doctorId: result.doctor.id, fullName: result.doctor.fullName, accessKey: result.accessKey };
      form.reset();
      state.admin.doctors.push(result.doctor);
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelectorAll(".doctor-key-form").forEach((keyForm) => {
    keyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const doctor = state.admin.doctors.find((item) => item.id === keyForm.dataset.id);
      const accessKey = keyForm.elements.accessKey.value.trim();
      if (!doctor || !accessKey) return;
      try {
        const result = await api(`/api/admin/doctors/${doctor.id}`, {
          method: "PUT",
          body: JSON.stringify({ accessKey })
        });
        state.admin.doctors = state.admin.doctors.map((item) => item.id === doctor.id ? result.doctor : item);
        state.lastDoctorKey = { doctorId: result.doctor.id, fullName: result.doctor.fullName, accessKey };
        renderAdmin();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  const trainingForm = document.querySelector("#trainingParticipantForm");
  if (trainingForm) trainingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(trainingForm));
      const result = await api("/api/admin/training-participants", { method: "POST", body: JSON.stringify(data) });
      state.admin.trainingParticipants.push(result.participant);
      state.trainingAdminPage = 1;
      trainingForm.reset();
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  const nurseTrainingForm = document.querySelector("#nurseTrainingParticipantForm");
  if (nurseTrainingForm) nurseTrainingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(nurseTrainingForm));
      const result = await api("/api/admin/nurse-training-participants", { method: "POST", body: JSON.stringify(data) });
      state.admin.nurseTrainingParticipants.push(result.participant);
      state.nurseTrainingAdminPage = 1;
      nurseTrainingForm.reset();
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  const adminAccessForm = document.querySelector("#adminAccessForm");
  if (adminAccessForm) adminAccessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(adminAccessForm));
      await api("/api/admin/admins", { method: "POST", body: JSON.stringify(data) });
      adminAccessForm.reset();
      await loadAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelectorAll(".admin-access-form").forEach((accessForm) => {
    accessForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(accessForm));
        const result = await api(`/api/admin/admins/${accessForm.dataset.id}`, { method: "PUT", body: JSON.stringify(data) });
        if (result.currentSessionEnded) {
          alert("Пароль изменён. Для безопасности войдите заново.");
          window.location.href = ADMIN_APP_PATH;
          return;
        }
        await loadAdmin();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  document.querySelectorAll(".score-form").forEach((scoreForm) => {
    scoreForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(scoreForm));
        await api(`/api/admin/training-attempts/${scoreForm.dataset.attemptId}`, { method: "PUT", body: JSON.stringify(data) });
        await loadAdmin();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function bindAdminTrainingFilters() {
  const trainingClinic = document.querySelector("#trainingClinicFilter");
  const trainingDate = document.querySelector("#trainingDateFilter");
  const trainingRegistrationDate = document.querySelector("#trainingRegistrationDateFilter");
  const nurseClinic = document.querySelector("#nurseTrainingClinicFilter");
  const nurseDate = document.querySelector("#nurseTrainingDateFilter");
  const nurseRegistrationDate = document.querySelector("#nurseTrainingRegistrationDateFilter");
  const selectedFilterValues = (select) => Array.from(select.selectedOptions).map((option) => option.value);
  trainingClinic?.addEventListener("change", (event) => {
    const values = selectedFilterValues(event.target);
    state.trainingClinicFilter = values.includes("all") || values.length === 0 ? ["all"] : values;
    state.trainingAdminPage = 1;
    renderAdmin();
  });
  trainingDate?.addEventListener("change", (event) => {
    state.trainingDateFilter = event.target.value;
    state.trainingAdminPage = 1;
    renderAdmin();
  });
  trainingRegistrationDate?.addEventListener("change", (event) => {
    state.trainingRegistrationDateFilter = event.target.value;
    state.trainingAdminPage = 1;
    renderAdmin();
  });
  nurseClinic?.addEventListener("change", (event) => {
    const values = selectedFilterValues(event.target);
    state.nurseTrainingClinicFilter = values.includes("all") || values.length === 0 ? ["all"] : values;
    state.nurseTrainingAdminPage = 1;
    renderAdmin();
  });
  nurseDate?.addEventListener("change", (event) => {
    state.nurseTrainingDateFilter = event.target.value;
    state.nurseTrainingAdminPage = 1;
    renderAdmin();
  });
  nurseRegistrationDate?.addEventListener("change", (event) => {
    state.nurseTrainingRegistrationDateFilter = event.target.value;
    state.nurseTrainingAdminPage = 1;
    renderAdmin();
  });
}

function surveyWeightFields(t) {
  return html`
    ${input(t("Рост, см"), "height", true, "number")}
    ${input(t("Вес по весам, кг"), "weight", false, "number")}
    <div class="form-row"><label>${escapeHtml(t("Индекс массы тела"))}</label><input name="bmi" inputmode="decimal" readonly /></div>
    ${input(t("Окружность живота/талия, см"), "rabitoWaist", true, "number")}
  `;
}

function surveyRabitoFields(t) {
  return html`
    <section data-rabito-fields>
      <h3>${escapeHtml(t("Формула Rabito"))}</h3>
      <p class="muted">${escapeHtml(t("Если взвесить пациента нельзя, оставьте вес пустым и заполните окружности для расчёта Rabito."))}</p>
      <div class="grid three">
        ${input(t("Окружность плеча, см"), "arm", true, "number")}
        ${input(t("Окружность голени, см"), "calf", true, "number")}
        <div class="form-row"><label>${escapeHtml(t("Расчётный вес Rabito, кг"))}</label><input name="rabitoWeightPreview" inputmode="decimal" readonly /></div>
      </div>
    </section>
  `;
}

function validateNurseSurveyForm(form, t) {
  const invalidField = Array.from(form.elements).find((field) => field.willValidate && !field.validity.valid);
  if (!invalidField) return true;
  const label = invalidField.closest(".form-row")?.querySelector("label")?.textContent?.trim()
    || invalidField.getAttribute("name")
    || t("обязательное поле");
  document.querySelector("#surveyResult").innerHTML = html`
    <div class="notice danger">
      <strong>${escapeHtml(t("Не заполнено обязательное поле"))}: ${escapeHtml(label)}.</strong><br />
      ${escapeHtml(t("Заполните это поле и снова нажмите «Отправить анкету»."))}
    </div>
  `;
  invalidField.scrollIntoView({ behavior: "smooth", block: "center" });
  invalidField.focus({ preventScroll: true });
  return false;
}

function renderNurseSurvey() {
  const t = (value) => translateSurveyText(value);
  const surveySelect = (label, name, options) => `<div class="form-row"><label>${escapeHtml(t(label))}</label><select name="${name}" required><option value="" selected disabled>${escapeHtml(t("Выберите ответ"))}</option>${options.map(([value, text]) => `<option value="${value}">${escapeHtml(t(text))}</option>`).join("")}</select></div>`;
  const clinicText = (text) => surveyLanguage() === "tg" ? String(text).replace("Поликлиника №", "Поликлиникаи №") : text;
  setPage(html`
    <main class="container">
      <div class="install-app-hint"><button id="installSurveyApp" type="button" class="secondary" hidden>Установить приложение на телефон</button><span class="muted">Можно добавить «Опросник» на главный экран Android.</span></div>
      <form class="panel form" id="surveyForm">
        ${helpPanel('nurse', surveyLanguage())}
        <h1>${escapeHtml(t("Опросник медсестры"))}</h1>
        ${surveyLanguageControl()}
        <div class="form-row"><label>${escapeHtml(t("ФИО медсестры"))}</label><input name="nurseName" required /></div>
        <h3>${escapeHtml(t("Паспортная часть"))}</h3>
        <section class="grid two">
          ${input(t("Фамилия"), "lastName", true)}
          ${input(t("Имя"), "firstName", true)}
          ${input(t("Отчество"), "middleName", false)}
          ${input(t("Дата рождения"), "birthDate", true, "date")}
          ${surveySelect("Пол", "sex", [["female", "Женский"], ["male", "Мужской"]])}
          <div class="form-row"><label>${escapeHtml(t("Возраст"))}</label><input name="age" inputmode="numeric" required readonly /></div>
          ${input(t("Телефон"), "phone", true)}
          ${input(t("Адрес"), "address", true)}
        </section>
        <div class="form-row">
          <label>${escapeHtml(t("Поликлиника пациента"))}</label>
          <select name="clinic" required><option value="" selected disabled>${escapeHtml(t("Выберите поликлинику"))}</option>${clinicOptions.map(([value, text]) => `<option value="${value}">${escapeHtml(clinicText(text))}</option>`).join("")}</select>
        </div>
        <h3>FINDRISC</h3>
        <p class="muted">${escapeHtml(t("Введите вес по весам. ИМТ рассчитается автоматически по весу и росту."))} ${escapeHtml(t("Окружность талии нужна для FINDRISC при любом способе определения веса."))}</p>
        <section class="grid two">
          ${surveyWeightFields(t)}
          ${surveySelect("Физическая активность 30 минут в день", "activity", [["yes", "Да"], ["no", "Нет"]])}
          ${surveySelect("Овощи/фрукты ежедневно", "vegetables", [["yes", "Да"], ["no", "Нет"]])}
          ${surveySelect("Принимал препараты от давления", "bpMeds", [["no", "Нет"], ["yes", "Да"]])}
          ${surveySelect("Когда-либо был высокий сахар", "highGlucose", [["no", "Нет"], ["yes", "Да"]])}
          ${surveySelect("Диабет у родственников", "familyDiabetes", [["none", "Нет"], ["second", "Да, 2 линия"], ["first", "Да, 1 линия"]])}
        </section>
        <h3>${escapeHtml(t("Сердечно-сосудистый риск"))}</h3>
        <section class="grid two">
          ${surveySelect("Курение", "smoker", [["no", "Нет"], ["yes", "Да"]])}
          ${input(t("Систолическое АД"), "systolic", true, "number")}
          ${input(t("Диастолическое АД"), "diastolic", true, "number")}
        </section>
        ${surveyRabitoFields(t)}
        <div class="actions">
          <button type="submit">${escapeHtml(t("Отправить анкету"))}</button>
          <button type="button" class="secondary" id="syncSurveysButton">${escapeHtml(t("Синхронизировать"))}</button>
          <button type="button" class="secondary ghost" id="toggleOfflineSurveysDrawer" style="display:none"></button>
        </div>
        <div class="muted" id="syncSurveysStatus"></div>
        <div id="offlineSurveysDrawer" class="offline-drawer" style="display:none"></div>
        <div id="surveyResult"></div>
      </form>
    </main>
  `);
  const form = document.querySelector("#surveyForm");
  bindSurveyLanguageControl(renderNurseSurvey);
  bindNurseSurveyCalculations(form);
  bindBirthDateAge(form);
  bindOfflineSurveySync(form);
  showSurveyLanguagePrompt(renderNurseSurvey);
  form.noValidate = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateNurseSurveyForm(form, t)) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      const { survey } = await sendNurseSurvey(data);
      showSurveySubmitted(survey);
      form.reset();
      updateOfflineSurveyStatus();
    } catch (error) {
      if (error?.status === 409 || String(error?.message || "").includes("уже существует")) {
        const resultEl = document.querySelector("#surveyResult");
        if (resultEl) {
          resultEl.innerHTML = `
            <div class="notice warn">
              <p>⚠️ <strong>${escapeHtml(error.message)}</strong></p>
              <p class="muted" style="margin-top:6px;">${escapeHtml(t("Если это другой пациент с такими же ФИО или повторный скрининг:"))}</p>
              <button type="button" class="btn secondary" id="forceSubmitNurseSurveyBtn" style="margin-top:8px;">➕ ${escapeHtml(t("Сохранить как нового пациента"))}</button>
            </div>
          `;
          document.querySelector("#forceSubmitNurseSurveyBtn")?.addEventListener("click", async () => {
            try {
              const forcedData = { ...data, allowDuplicate: true };
              const { survey: forcedSurvey } = await sendNurseSurvey(forcedData);
              showSurveySubmitted(forcedSurvey);
              form.reset();
              updateOfflineSurveyStatus();
            } catch (err2) {
              resultEl.innerHTML = `<div class="notice danger">${escapeHtml(err2.message)}</div>`;
            }
          });
        }
        return;
      }
      if (!shouldQueueOffline(error)) {
        document.querySelector("#surveyResult").innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
        return;
      }
      saveOfflineSurvey(data);
      document.querySelector("#surveyResult").innerHTML = html`
        <div class="notice warn">
          ${escapeHtml(t("Интернет недоступен или сервер не ответил. Анкета сохранена на этом устройстве и будет отправлена через кнопку синхронизации."))}
        </div>
      `;
      form.reset();
      updateOfflineSurveyStatus();
    }
  });
}

// === Offline-First IndexedDB Engine ===
const OFFLINE_IDB_NAME = "eclinic_offline_v2";
const OFFLINE_IDB_VERSION = 1;
let offlineIdbPromise = null;
let offlineSurveyCache = null;
let offlineDoctorCache = null;

function getOfflineIdb() {
  if (offlineIdbPromise) return offlineIdbPromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  offlineIdbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(OFFLINE_IDB_NAME, OFFLINE_IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("nurse_surveys")) {
          db.createObjectStore("nurse_surveys", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("doctor_actions")) {
          db.createObjectStore("doctor_actions", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return offlineIdbPromise;
}

async function persistToIdb(storeName, item, action = "put") {
  try {
    const db = await getOfflineIdb();
    if (!db) return;
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    if (action === "put") store.put(item);
    else if (action === "delete") store.delete(item);
  } catch {}
}

async function initOfflineStores() {
  let legacySurveys = [];
  let legacyDoctor = [];
  try {
    legacySurveys = JSON.parse(localStorage.getItem(OFFLINE_SURVEY_QUEUE_KEY) || "[]");
    if (!Array.isArray(legacySurveys)) legacySurveys = [];
  } catch {}
  try {
    legacyDoctor = JSON.parse(localStorage.getItem(OFFLINE_DOCTOR_QUEUE_KEY) || "[]");
    if (!Array.isArray(legacyDoctor)) legacyDoctor = [];
  } catch {}

  const db = await getOfflineIdb();
  if (!db) {
    offlineSurveyCache = legacySurveys;
    offlineDoctorCache = legacyDoctor;
    updateOfflineSurveyStatus();
    updateOfflineDoctorStatus();
    return;
  }

  const readAll = (storeName) => new Promise((res) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    } catch {
      res([]);
    }
  });

  const [idbSurveys, idbDoctor] = await Promise.all([readAll("nurse_surveys"), readAll("doctor_actions")]);
  const surveyMap = new Map();
  idbSurveys.forEach((item) => surveyMap.set(item.id, item));
  legacySurveys.forEach((item) => {
    if (!surveyMap.has(item.id)) {
      surveyMap.set(item.id, item);
      persistToIdb("nurse_surveys", item, "put");
    }
  });
  if (legacySurveys.length) {
    try { localStorage.removeItem(OFFLINE_SURVEY_QUEUE_KEY); } catch {}
  }

  const doctorMap = new Map();
  idbDoctor.forEach((item) => doctorMap.set(item.id, item));
  legacyDoctor.forEach((item) => {
    if (!doctorMap.has(item.id)) {
      doctorMap.set(item.id, item);
      persistToIdb("doctor_actions", item, "put");
    }
  });
  if (legacyDoctor.length) {
    try { localStorage.removeItem(OFFLINE_DOCTOR_QUEUE_KEY); } catch {}
  }

  offlineSurveyCache = Array.from(surveyMap.values());
  offlineDoctorCache = Array.from(doctorMap.values());
  updateOfflineSurveyStatus();
  updateOfflineDoctorStatus();
}

initOfflineStores();

function offlineSurveyQueue() {
  if (offlineSurveyCache !== null) return offlineSurveyCache;
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_SURVEY_QUEUE_KEY) || "[]");
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function writeOfflineSurveyQueue(queue) {
  offlineSurveyCache = queue;
  try {
    localStorage.setItem(OFFLINE_SURVEY_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
  getOfflineIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction("nurse_surveys", "readwrite");
      const store = tx.objectStore("nurse_surveys");
      store.clear();
      queue.forEach((item) => store.put(item));
    } catch {}
  });
}

function saveOfflineSurvey(data) {
  const queue = offlineSurveyQueue();
  const id = data.clientSurveyId || data.id || crypto.randomUUID();
  const surveyData = { ...data, clientSurveyId: id };
  const item = { id, savedAt: new Date().toISOString(), attempts: 0, lastError: "", data: surveyData };
  queue.push(item);
  writeOfflineSurveyQueue(queue);
  persistToIdb("nurse_surveys", item, "put");
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready.then((reg) => reg.sync.register("sync-nurse-surveys")).catch(() => {});
  }
}

async function sendNurseSurvey(data) {
  return api("/api/nurse-surveys", { method: "POST", body: JSON.stringify(data) });
}

function translateSurveyDynamicText(value) {
  if (surveyLanguage() !== "tg") return value;
  const replacements = [
    "Сердечно-сосудистый риск",
    "Систолическое АД",
    "Очень высокий",
    "Слегка повышенный",
    "Повышенный риск",
    "Умеренный",
    "Высокий",
    "Низкий",
    "баллов",
    "факторы",
    "возраст",
    "мужской пол",
    "курение",
    "повышенное САД",
    "мм рт.ст."
  ];
  return replacements.reduce((text, item) => text.replaceAll(item, translateSurveyText(item)), String(value || ""));
}

function translateDoctorDynamicText(value) {
  if (doctorLanguage() !== "tg") return value;
  const replacements = [
    "Сердечно-сосудистый риск",
    "Систолическое АД",
    "Очень высокий",
    "Слегка повышенный",
    "Повышенный риск",
    "Умеренный",
    "Высокий",
    "Низкий",
    "баллов",
    "факторы",
    "возраст",
    "мужской пол",
    "курение",
    "повышенное САД",
    "мм рт.ст."
  ];
  return replacements.reduce((text, item) => text.replaceAll(item, translateDoctorText(item)), String(value || ""));
}

function showSurveySubmitted(survey) {
  const reasons = ((survey.referralReasons || []).length ? survey.referralReasons : ["Повышенный риск"])
    .map((reason) => `<li>${escapeHtml(translateSurveyDynamicText(reason))}</li>`)
    .join("");
  document.querySelector("#surveyResult").innerHTML = html`
    <div class="notice ${survey.needsDoctor ? "danger" : "ok"}">
      FINDRISC: ${survey.findrisc.score} (${escapeHtml(translateSurveyDynamicText(survey.findrisc.level))}). ${escapeHtml(translateSurveyText("Сердечно-сосудистый риск"))}: ${escapeHtml(translateSurveyDynamicText(survey.score2.level))} (${survey.score2.score ?? survey.score2.percent} б.).
      ${escapeHtml(translateSurveyText(survey.measurements.weight ? "Вес по весам, кг" : "Расчётный вес Rabito, кг"))}: ${survey.measurements.weight || survey.measurements.rabitoWeight || "-"}.
      ${survey.needsDoctor ? `<strong>${escapeHtml(translateSurveyText("Направить к врачу."))}</strong><div>${escapeHtml(translateSurveyText("Причина"))}:</div><ul>${reasons}</ul>` : escapeHtml(translateSurveyText("Повышенный риск не выявлен."))}
    </div>
  `;
}

function updateOfflineSurveyStatus() {
  const status = document.querySelector("#syncSurveysStatus");
  const button = document.querySelector("#syncSurveysButton");
  const toggleBtn = document.querySelector("#toggleOfflineSurveysDrawer");
  const drawer = document.querySelector("#offlineSurveysDrawer");
  if (!status || !button) return;
  const count = offlineSurveyQueue().length;
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  if (count > 0) {
    status.innerHTML = `<span class="pill warning">⏳ ${escapeHtml(translateSurveyText("Ожидают синхронизации"))}: <strong>${count}</strong></span>${isOffline ? ` <span class="muted">(${escapeHtml(translateSurveyText("Офлайн-режим: данные сохранены на устройстве"))})</span>` : ""}`;
    if (toggleBtn) {
      toggleBtn.style.display = "inline-block";
      toggleBtn.innerHTML = `📋 ${escapeHtml(translateSurveyText("Сохранённые анкеты"))} (<strong>${count}</strong>)`;
    }
  } else {
    status.innerHTML = `<span class="pill ok">✓ ${escapeHtml(translateSurveyText("Все анкеты отправлены."))}</span>`;
    if (toggleBtn) toggleBtn.style.display = "none";
    if (drawer) drawer.style.display = "none";
  }
  const failed = offlineSurveyQueue().filter((item) => item.lastError);
  status.title = failed.length ? failed.map((item) => `${new Date(item.savedAt).toLocaleString("ru-RU")}: ${item.lastError}`).join("\n") : "";
  button.disabled = count === 0;

  if (drawer && drawer.style.display !== "none") {
    renderOfflineSurveysDrawer();
  }
}

function renderOfflineSurveysDrawer() {
  const drawer = document.querySelector("#offlineSurveysDrawer");
  if (!drawer) return;
  const queue = offlineSurveyQueue();
  if (!queue.length) {
    drawer.innerHTML = `<p class="muted">${escapeHtml(translateSurveyText("Нет сохранённых офлайн-анкет."))}</p>`;
    return;
  }
  const dupCount = queue.filter((item) => item.status === 409 || String(item.lastError || "").includes("уже существует")).length;
  drawer.innerHTML = `
    <div class="offline-drawer-header">
      <strong>📋 ${escapeHtml(translateSurveyText("Сохранённые на устройстве анкеты"))} (${queue.length})</strong>
      ${dupCount > 0 ? `<button type="button" class="mini-btn ok-ghost" id="clearAllDuplicatesBtn" style="margin-left:auto; margin-right:8px;" title="Очистить анкеты, которые уже есть в базе">✓ Очистить дубликаты (${dupCount})</button>` : ""}
      <button type="button" class="mini-btn" id="closeOfflineDrawerBtn">✕</button>
    </div>
    <div class="offline-list">
      ${queue.map((item, idx) => {
        const p = item.data || {};
        const name = [p.lastName, p.firstName].filter(Boolean).join(" ") || `Пациент #${idx + 1}`;
        const time = new Date(item.savedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const hasErr = Boolean(item.lastError);
        const isDup = item.status === 409 || String(item.lastError || "").includes("уже существует");
        return `
          <div class="offline-card ${hasErr ? "has-error" : ""}">
            <div class="offline-card-info">
              <span class="offline-card-name">👤 ${escapeHtml(name)} (${escapeHtml(p.age || "-")} ${escapeHtml(translateSurveyText("лет"))})</span>
              <span class="offline-card-meta">🏥 ${escapeHtml(p.clinic || "")} • 🕒 ${time}</span>
              ${hasErr ? `<small class="danger-text">⚠️ ${escapeHtml(item.lastError)}</small>` : `<small class="muted">⏳ ${escapeHtml(translateSurveyText("Ожидает сети"))}</small>`}
            </div>
            <div class="offline-card-actions">
              ${isDup ? `
                <button type="button" class="mini-btn ok-ghost mark-synced-btn" data-offline-id="${item.id}" title="${escapeHtml(translateSurveyText("Удалить из сохранённых — уже есть на сервере"))}">✓ Уже в базе</button>
                <button type="button" class="mini-btn warning sync-force-btn" data-force-id="${item.id}" title="${escapeHtml(translateSurveyText("Сохранить как нового пациента"))}">➕ Как нового</button>
              ` : `
                <button type="button" class="mini-btn sync-single-btn" data-offline-id="${item.id}" title="${escapeHtml(translateSurveyText("Отправить сейчас"))}">📤 ${escapeHtml(translateSurveyText("Отправить"))}</button>
              `}
              <button type="button" class="mini-btn danger-ghost delete-single-btn" data-delete-id="${item.id}" title="${escapeHtml(translateSurveyText("Удалить"))}">🗑️</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  document.querySelector("#closeOfflineDrawerBtn")?.addEventListener("click", () => {
    drawer.style.display = "none";
  });

  document.querySelector("#clearAllDuplicatesBtn")?.addEventListener("click", () => {
    const currentQueue = offlineSurveyQueue();
    const dups = currentQueue.filter((item) => item.status === 409 || String(item.lastError || "").includes("уже существует"));
    for (const d of dups) {
      persistToIdb("nurse_surveys", d.id, "delete");
    }
    const remainingQueue = currentQueue.filter((item) => !(item.status === 409 || String(item.lastError || "").includes("уже существует")));
    writeOfflineSurveyQueue(remainingQueue);
    updateOfflineSurveyStatus();
    renderOfflineSurveysDrawer();
  });

  drawer.querySelectorAll(".mark-synced-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-offline-id");
      deleteSingleOfflineSurvey(id);
    });
  });

  drawer.querySelectorAll(".sync-force-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-force-id");
      await syncSingleOfflineSurvey(id, true);
    });
  });

  drawer.querySelectorAll(".sync-single-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-offline-id");
      await syncSingleOfflineSurvey(id, false);
    });
  });

  drawer.querySelectorAll(".delete-single-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-id");
      deleteSingleOfflineSurvey(id);
    });
  });
}

function deleteSingleOfflineSurvey(id) {
  let queue = offlineSurveyQueue().filter((item) => item.id !== id);
  writeOfflineSurveyQueue(queue);
  persistToIdb("nurse_surveys", id, "delete");
  updateOfflineSurveyStatus();
}

async function syncSingleOfflineSurvey(id, forceAsNew = false) {
  let queue = offlineSurveyQueue();
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  const result = document.querySelector("#surveyResult");
  try {
    const dataToSend = forceAsNew ? { ...item.data, allowDuplicate: true } : item.data;
    const { survey } = await sendNurseSurvey(dataToSend);
    queue = queue.filter((q) => q.id !== id);
    writeOfflineSurveyQueue(queue);
    persistToIdb("nurse_surveys", id, "delete");
    updateOfflineSurveyStatus();
    if (result) showSurveySubmitted(survey);
  } catch (err) {
    const isDup = err?.status === 409 || String(err?.message || "").includes("уже существует");
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastTriedAt = new Date().toISOString();
    item.lastError = String(err.message || "Ошибка сети").slice(0, 200);
    if (err?.status) item.status = err.status;
    writeOfflineSurveyQueue(queue);
    persistToIdb("nurse_surveys", item, "put");
    updateOfflineSurveyStatus();
    if (result) {
      if (isDup && !forceAsNew) {
        result.innerHTML = `<div class="notice warn">⚠️ <strong>${escapeHtml(err.message)}</strong><br><small>Анкета уже сохранена на сервере. Нажмите «✓ Уже в базе» или «➕ Как нового» в списке сохранённых анкет.</small></div>`;
      } else {
        result.innerHTML = `<div class="notice danger">${escapeHtml(err.message)}</div>`;
      }
    }
  }
}

function bindOfflineSurveySync() {
  const button = document.querySelector("#syncSurveysButton");
  button?.addEventListener("click", syncOfflineSurveys);
  const toggleBtn = document.querySelector("#toggleOfflineSurveysDrawer");
  const drawer = document.querySelector("#offlineSurveysDrawer");
  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      const isVisible = drawer.style.display !== "none";
      drawer.style.display = isVisible ? "none" : "block";
      if (!isVisible) renderOfflineSurveysDrawer();
    });
  }
  if (!offlineSurveyOnlineListenerBound) {
    const triggerSyncOnEvent = () => {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        syncOfflineSurveys();
        syncOfflineDoctorActions();
      }
    };
    window.addEventListener("online", triggerSyncOnEvent);
    window.addEventListener("focus", triggerSyncOnEvent);
    window.addEventListener("pageshow", triggerSyncOnEvent);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") triggerSyncOnEvent();
    });
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "TRIGGER_SYNC") {
          triggerSyncOnEvent();
        }
      });
    }
    setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine && (offlineSurveyQueue().length > 0 || offlineDoctorQueue().length > 0)) {
        triggerSyncOnEvent();
      }
    }, 60000);
    offlineSurveyOnlineListenerBound = true;
  }
  updateOfflineSurveyStatus();
}

let syncNurseInFlight = false;
let syncDoctorInFlight = false;

async function syncOfflineSurveys() {
  if (syncNurseInFlight) return;
  if (typeof navigator !== "undefined" && navigator.locks) {
    try {
      return await navigator.locks.request("eclinic_sync_nurse", { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await doSyncOfflineSurveys();
      });
    } catch {
      return doSyncOfflineSurveys();
    }
  }
  return doSyncOfflineSurveys();
}

async function doSyncOfflineSurveys() {
  if (syncNurseInFlight) return;
  syncNurseInFlight = true;
  const button = document.querySelector("#syncSurveysButton");
  const result = document.querySelector("#surveyResult");
  try {
    let queue = offlineSurveyQueue();
    if (!queue.length) {
      updateOfflineSurveyStatus();
      return;
    }
    if (button) button.disabled = true;
    const remaining = [];
    let sent = 0;
    for (const item of queue) {
      if (item.requiresEdit) {
        remaining.push(item);
        continue;
      }
      try {
        await sendNurseSurvey(item.data);
        await persistToIdb("nurse_surveys", item.id, "delete");
        sent += 1;
      } catch (error) {
        const isClientError = error?.status >= 400 && error.status < 500 && error.status !== 409;
        const updated = {
          ...item,
          attempts: Number(item.attempts || 0) + 1,
          lastTriedAt: new Date().toISOString(),
          lastError: String(error.message || "Ошибка сети").slice(0, 200),
          status: error?.status || 0,
          requiresEdit: isClientError
        };
        remaining.push(updated);
        await persistToIdb("nurse_surveys", updated, "put");
      }
    }
    writeOfflineSurveyQueue(remaining);
    updateOfflineSurveyStatus();
    if (result) {
      result.innerHTML = remaining.length
        ? `<div class="notice warn">${escapeHtml(translateSurveyText("Отправлено"))}: ${sent}. ${escapeHtml(translateSurveyText("Осталось без синхронизации"))}: ${remaining.length}. ${escapeHtml(translateSurveyText("Попробуйте еще раз, когда интернет будет стабильным."))}</div>`
        : `<div class="notice ok">${escapeHtml(translateSurveyText("Синхронизация завершена. Отправлено анкет"))}: ${sent}.</div>`;
    }
  } finally {
    syncNurseInFlight = false;
    if (button) button.disabled = offlineSurveyQueue().length === 0;
  }
}

function offlineDoctorQueue() {
  if (offlineDoctorCache !== null) return offlineDoctorCache;
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_DOCTOR_QUEUE_KEY) || "[]");
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function writeOfflineDoctorQueue(queue) {
  offlineDoctorCache = queue;
  try {
    localStorage.setItem(OFFLINE_DOCTOR_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
  getOfflineIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction("doctor_actions", "readwrite");
      const store = tx.objectStore("doctor_actions");
      store.clear();
      queue.forEach((item) => store.put(item));
    } catch {}
  });
}

function saveOfflineDoctorAction(action) {
  const queue = offlineDoctorQueue();
  const item = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), attempts: 0, lastError: "", ...action };
  queue.push(item);
  writeOfflineDoctorQueue(queue);
  persistToIdb("doctor_actions", item, "put");
}

function updateOfflineDoctorStatus() {
  const status = document.querySelector("#doctorSyncStatus");
  const button = document.querySelector("#doctorSyncButton");
  if (!status || !button) return;
  const count = offlineDoctorQueue().length;
  status.textContent = count ? `${translateDoctorText("Ожидают синхронизации")}: ${count}` : translateDoctorText("Все записи отправлены.");
  const failed = offlineDoctorQueue().filter((item) => item.lastError);
  status.title = failed.length ? failed.map((item) => `${new Date(item.savedAt).toLocaleString("ru-RU")}: ${item.lastError}`).join("\n") : "";
  button.disabled = count === 0;
}

async function syncOfflineDoctorActions() {
  if (syncDoctorInFlight) return;
  if (typeof navigator !== "undefined" && navigator.locks) {
    try {
      return await navigator.locks.request("eclinic_sync_doctor", { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await doSyncOfflineDoctorActions();
      });
    } catch {
      return doSyncOfflineDoctorActions();
    }
  }
  return doSyncOfflineDoctorActions();
}

async function doSyncOfflineDoctorActions() {
  if (syncDoctorInFlight) return;
  syncDoctorInFlight = true;
  const result = document.querySelector("#doctorSyncResult");
  const button = document.querySelector("#doctorSyncButton");
  try {
    let queue = offlineDoctorQueue();
    if (!queue.length) {
      updateOfflineDoctorStatus();
      return;
    }
    if (button) button.disabled = true;
    const remaining = [];
    const surveyIdMap = {};
    let sent = 0;

    for (const item of queue) {
      try {
        if (item.type !== "survey") continue;
        const { survey } = await api("/api/doctor/surveys", { method: "POST", body: JSON.stringify(item.data) });
        surveyIdMap[item.localSurveyId] = survey.id;
        sent += 1;
      } catch (error) {
        const isAlreadySaved = error?.status === 409 || String(error?.message || "").includes("уже существует");
        if (isAlreadySaved) {
          if (error.data?.duplicateId) surveyIdMap[item.localSurveyId] = error.data.duplicateId;
          sent += 1;
        } else {
          remaining.push({ ...item, attempts: Number(item.attempts || 0) + 1, lastTriedAt: new Date().toISOString(), lastError: String(error.message || "Ошибка сети").slice(0, 200) });
        }
      }
    }

    const visitItems = queue.filter((item) => item.type === "visit");
    for (const item of visitItems) {
      const data = { ...item.data };
      if (surveyIdMap[data.surveyId]) data.surveyId = surveyIdMap[data.surveyId];
      if (String(data.surveyId || "").startsWith("local-")) {
        remaining.push({ ...item, attempts: Number(item.attempts || 0) + 1, lastTriedAt: new Date().toISOString(), lastError: "Сначала нужно синхронизировать анкету пациента" });
        continue;
      }
      try {
        await api("/api/doctor/visits", { method: "POST", body: JSON.stringify(data) });
        sent += 1;
      } catch (error) {
        remaining.push({ ...item, data, attempts: Number(item.attempts || 0) + 1, lastTriedAt: new Date().toISOString(), lastError: String(error.message || "Ошибка сети").slice(0, 200) });
      }
    }

    const deduped = [];
    const seen = new Set();
    for (const item of remaining) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    writeOfflineDoctorQueue(deduped);
    updateOfflineDoctorStatus();
    if (result) {
      result.innerHTML = deduped.length
        ? `<div class="notice warn">${escapeHtml(translateDoctorText("Отправлено"))}: ${sent}. ${escapeHtml(translateDoctorText("Осталось без синхронизации"))}: ${deduped.length}. ${escapeHtml(translateDoctorText("Попробуйте еще раз, когда интернет будет стабильным."))}</div>`
        : `<div class="notice ok">${escapeHtml(translateDoctorText("Синхронизация завершена. Отправлено записей"))}: ${sent}.</div>`;
    }
    try {
      state.doctor = await api("/api/doctor/workspace");
      state.selectedSurvey = state.selectedSurvey && !String(state.selectedSurvey.id).startsWith("local-")
        ? state.doctor.surveys.find((survey) => survey.id === state.selectedSurvey.id) || state.selectedSurvey
        : null;
      if (!deduped.length) state.doctorMode = "list";
      renderDoctor();
    } catch {
      updateOfflineDoctorStatus();
    }
  } finally {
    syncDoctorInFlight = false;
  }
}

function bindBirthDateAge(form) {
  const calculateAge = () => {
    const value = form.elements.birthDate.value;
    if (!value) {
      form.elements.age.value = "";
      return;
    }
    const birthDate = new Date(`${value}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
    form.elements.age.value = age >= 0 && age < 130 ? String(age) : "";
  };
  form.elements.birthDate.addEventListener("input", calculateAge);
  form.addEventListener('draft-restored', calculateAge);
  calculateAge();
}

function bindNurseSurveyCalculations(form) {
  const t = form.id === "surveyForm" ? translateSurveyText : translateDoctorText;
  const numericValue = (name) => Number(String(form.elements[name]?.value || "").replace(",", "."));
  const calculate = () => {
    const measured = form.elements.weight.value.trim() !== "";
    const measuredWeight = numericValue("weight");
    const rabitoFields = form.querySelector("[data-rabito-fields]");
    rabitoFields.hidden = measured;
    for (const name of ["arm", "calf"]) {
      form.elements[name].required = !measured;
      form.elements[name].disabled = measured;
    }
    for (const [name, max] of [["weight", 500], ["height", 250], ["rabitoWaist", 300], ["arm", 200], ["calf", 200]]) {
      const field = form.elements[name];
      const number = numericValue(name);
      const filled = !field.disabled && field.value.trim() !== "";
      field.setCustomValidity(filled && (!Number.isFinite(number) || number <= 0)
        ? t("Введите число больше нуля")
        : filled && number > max ? t("Слишком большое значение") : "");
    }
    const arm = numericValue("arm");
    const waist = numericValue("rabitoWaist");
    const calf = numericValue("calf");
    const sexCoef = form.elements.sex.value === "male" ? 1 : 2;
    const rabitoWeight = !measured && arm > 0 && waist > 0 && calf > 0
      ? 0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241
      : 0;
    form.elements.rabitoWeightPreview.value = rabitoWeight > 0 ? rabitoWeight.toFixed(1) : "";

    const heightM = numericValue("height") / 100;
    const weight = measured ? measuredWeight : rabitoWeight;
    const bmi = weight > 0 && heightM > 0 ? weight / (heightM * heightM) : 0;
    form.elements.bmi.value = Number.isFinite(bmi) && bmi > 0 ? bmi.toFixed(1) : "";
    if (bmi > 100) form.elements.height.setCustomValidity(t("Проверьте вес и рост: ИМТ не должен превышать 100"));
    if (!measured && arm > 0 && waist > 0 && calf > 0 && rabitoWeight <= 0) {
      form.elements.arm.setCustomValidity(t("Проверьте окружности для расчёта веса"));
    }
  };
  ["weight", "height", "arm", "rabitoWaist", "calf"].forEach((name) => {
    form.elements[name].addEventListener("input", calculate);
  });
  form.elements.sex.addEventListener("change", calculate);
  form.addEventListener("reset", () => queueMicrotask(calculate));
  form.addEventListener('draft-restored', calculate);
  calculate();
}

async function loadTrainingPretest() {
  const data = await api("/api/training/pretest");
  state.training = data;
  renderTrainingParticipantList();
}

function renderTrainingParticipantList() {
  const attemptsByParticipant = (state.training?.attempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const personCard = (participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const tasks = attempts.filter((attempt) => attempt.type === "task");
    const postSummary = tasks.length ? postTrainingSummary(tasks) : null;
    return html`
    <div class="card training-person">
      <div>
        <strong>${escapeHtml(participant.fullName)}</strong>
        <div class="muted">${escapeHtml(participant.clinic || "")}${participant.specialty ? ` / ${escapeHtml(participant.specialty)}` : ""}</div>
        <div class="muted">Тест до обучения: ${pre ? `${pre.percent}%` : "не сдан"} / После обучения: ${postSummary ? postSummary.label : "не сдан"}</div>
      </div>
      <button data-action="select-training-participant" data-id="${participant.id}">Открыть</button>
    </div>
  `};
  const sortTrainingParticipants = (participants) => state.trainingNameSort === "az"
    ? [...participants].sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ru"))
    : [...participants];
  const participantMatchesTrainingStatus = (participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const hasPre = attempts.some((attempt) => attempt.type === "pre");
    const hasPost = attempts.filter((attempt) => attempt.type === "task").length >= 5;
    const preOk = state.trainingPreStatusFilter === "all" || (state.trainingPreStatusFilter === "done" ? hasPre : !hasPre);
    const postOk = state.trainingPostStatusFilter === "all" || (state.trainingPostStatusFilter === "done" ? hasPost : !hasPost);
    return preOk && postOk;
  };
  const filterTrainingParticipants = (participants, query = "") => participants.filter((item) =>
    item.fullName.toLowerCase().includes(query) && participantMatchesTrainingStatus(item)
  );
  const renderTrainingRows = (participants) => sortTrainingParticipants(participants).map(personCard).join("");
  const rows = renderTrainingRows(filterTrainingParticipants(state.training?.participants || []));
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№4 Проверка знаний врачей</h1>
        ${languageControl()}
        <h2>Пре-тест до обучения</h2>
        <p class="muted">Найдите свое имя в списке. Сначала сдайте тест до обучения, после семинара сдайте Инструменты 2-6.</p>
        <div class="grid two">
          <input id="trainingSearch" placeholder="Введите фамилию или имя" />
          <select id="trainingNameSort" aria-label="Сортировка списка врачей">
            <option value="default" ${state.trainingNameSort === "default" ? "selected" : ""}>По регистрации</option>
            <option value="az" ${state.trainingNameSort === "az" ? "selected" : ""}>От А до Я</option>
          </select>
          <select id="trainingPreStatusFilter" aria-label="Фильтр теста до обучения">
            <option value="all" ${state.trainingPreStatusFilter === "all" ? "selected" : ""}>До обучения: все</option>
            <option value="done" ${state.trainingPreStatusFilter === "done" ? "selected" : ""}>До обучения: сдали</option>
            <option value="missing" ${state.trainingPreStatusFilter === "missing" ? "selected" : ""}>До обучения: не сдали</option>
          </select>
          <select id="trainingPostStatusFilter" aria-label="Фильтр теста после обучения">
            <option value="all" ${state.trainingPostStatusFilter === "all" ? "selected" : ""}>После обучения: все</option>
            <option value="done" ${state.trainingPostStatusFilter === "done" ? "selected" : ""}>После обучения: сдали</option>
            <option value="missing" ${state.trainingPostStatusFilter === "missing" ? "selected" : ""}>После обучения: не сдали</option>
          </select>
        </div>
        <div id="trainingList" class="training-list">${rows || "<p class='muted'>Администратор еще не зарегистрировал участников обучения.</p>"}</div>
      </section>
    </main>
  `);
  bindLanguageControl(renderTrainingParticipantList);
  const refreshTrainingList = () => {
    const query = document.querySelector("#trainingSearch")?.value.toLowerCase() || "";
    const participants = filterTrainingParticipants(state.training.participants || [], query);
    document.querySelector("#trainingList").innerHTML = renderTrainingRows(participants) || "<p class='muted'>Участник не найден</p>";
  };
  document.querySelector("#trainingSearch")?.addEventListener("input", (event) => {
    refreshTrainingList();
  });
  document.querySelector("#trainingNameSort")?.addEventListener("change", (event) => {
    state.trainingNameSort = event.target.value;
    refreshTrainingList();
  });
  document.querySelector("#trainingPreStatusFilter")?.addEventListener("change", (event) => {
    state.trainingPreStatusFilter = event.target.value;
    refreshTrainingList();
  });
  document.querySelector("#trainingPostStatusFilter")?.addEventListener("change", (event) => {
    state.trainingPostStatusFilter = event.target.value;
    refreshTrainingList();
  });
}

async function renderTrainingWorkspace(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const pre = data.attempts.find((attempt) => attempt.type === "pre");
  const taskAttempts = data.attempts.filter((attempt) => attempt.type === "task");
  const allPostDone = taskAttempts.length >= data.tasks.length;
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№4 Проверка знаний</h1>
        ${languageControl()}
        <h2>${escapeHtml(data.participant.fullName)}</h2>
        <div class="actions">
          ${pre ? `<span class="pill ok">Тест до обучения: ${pre.percent}%</span>` : `<button data-action="start-pretest" data-id="${participantId}">Тест до обучения</button>`}
          ${allPostDone ? "<span class='pill ok'>Тесты после обучения отправлены</span>" : `<button data-action="start-post-training-tests" data-id="${participantId}">Тесты после обучения</button>`}
          <button type="button" class="secondary" onclick="location.href='${TRAINING_APP_PATH}'">К списку</button>
        </div>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Тесты после обучения</h2>
        <p class="muted">Все тесты после обучения объединены в одну форму. Пройдено: ${taskAttempts.length}/${data.tasks.length}.</p>
      </section>
    </main>
  `);
  bindLanguageControl(() => renderTrainingWorkspace(participantId));
}

async function renderTrainingPretest(participantId) {
  const data = await api(`/api/training/pretest/${participantId}`);
  if (data.attempt) {
    setPage(html`
      <main class="container">
        <section class="panel">
          <h1>Инструмент 2 уже сдан</h1>
          ${languageControl()}
          <div class="notice ok">Результат: ${data.attempt.correct}/${data.attempt.total} (${data.attempt.percent}%).</div>
          <button onclick="location.href='${TRAINING_APP_PATH}'">Вернуться к списку</button>
        </section>
      </main>
    `);
    bindLanguageControl(() => renderTrainingPretest(participantId));
    return;
  }
  const questions = data.questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(translateTestText(question.text))}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="q${question.id}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(translateTestText(text))}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="pretestForm">
        <section class="panel">
          <h1>${escapeHtml(translateTestText("Тест до обучения"))}</h1>
          ${languageControl()}
          <div class="notice warn">
            Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно ответить на все 10 вопросов.
          </div>
        </section>
        ${questions}
        <section class="panel actions">
          <button>${escapeHtml(translateTestText("Отправить ответы"))}</button>
          <button type="button" class="secondary" onclick="location.href='${TRAINING_APP_PATH}'">${escapeHtml(translateTestText("Назад к списку"))}</button>
        </section>
      </form>
    </main>
  `);
  bindLanguageControl(() => renderTrainingPretest(participantId));
  document.querySelector("#pretestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const answers = {};
    for (const [name, value] of formData.entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/training/pretest/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Инструмент 2 отправлен</h1>
            ${languageControl()}
            <div class="notice ok">Ваш результат: ${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%). Данные отправлены администратору.</div>
            <button onclick="location.href='${TRAINING_APP_PATH}'">Вернуться к списку</button>
          </section>
        </main>
      `);
      bindLanguageControl(() => renderTrainingPretest(participantId));
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderTrainingPosttest(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const existing = data.attempts.find((attempt) => attempt.type === "post");
  if (existing) {
    alert("Пост-тест уже сдан");
    return renderTrainingWorkspace(participantId);
  }
  const questions = data.postQuestions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="q${question.id}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(text)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="posttestForm">
        <section class="panel">
          <h1>Инструмент 3. Тест после обучения для оценки итогового уровня знаний</h1>
          <div class="notice warn">Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно ответить на все 20 вопросов.</div>
        </section>
        ${questions}
        <section class="panel actions">
          <button>Отправить пост-тест</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#posttestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [name, value] of new FormData(event.target).entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/training/posttest/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Инструмент 3 отправлен</h1>
            <div class="notice ok">Ваш результат: ${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%). Данные отправлены администратору.</div>
            <button data-action="select-training-participant" data-id="${participantId}">Вернуться к заданиям</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderTrainingTask(participantId, taskId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const task = data.tasks.find((item) => item.id === taskId);
  const existing = data.attempts.find((attempt) => attempt.type === "task" && attempt.taskId === taskId);
  if (!task) return alert("Задание не найдено");
  if (existing) {
    alert("Это задание уже отправлено");
    return renderTrainingWorkspace(participantId);
  }
  const criteria = (task.criteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const fields = renderPostTrainingTaskFields(task);
  setPage(html`
    <main class="container">
      <form class="form" id="taskForm">
        <section class="panel">
          <h1>${escapeHtml(task.instrument)}. ${escapeHtml(task.title)}</h1>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
          <div class="notice warn"><strong>Критерии оценки, максимум ${task.maxScore}:</strong><ul>${criteria}</ul></div>
        </section>
        ${fields}
        <section class="panel actions">
          <button>Отправить задание</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const answers = {};
    if (task.mode === "findrisc") {
      task.fields.forEach(([name]) => answers[name] = formData.get(name) || "");
    } else if (task.mode === "singleCases") {
      task.cases.forEach((_, index) => answers[`case${index}`] = formData.get(`case${index}`) || "");
    } else if (task.mode === "routing") {
      task.cases.forEach((_, index) => {
        answers[`case${index}`] = {
          specialist: formData.get(`case${index}_specialist`) || "",
          urgency: formData.get(`case${index}_urgency`) || ""
        };
      });
    } else if (task.mode === "mcq") {
      task.questions.forEach((_, index) => answers[`q${index}`] = formData.get(`q${index}`) || "");
    } else {
      task.fields.forEach(([name]) => {
        answers[name] = formData.get(name) || "";
      });
    }
    try {
      await api(`/api/training/tasks/${participantId}/${taskId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Задание отправлено</h1>
            <div class="notice ok">Ответы отправлены администратору для проверки по критериям.</div>
            <button data-action="select-training-participant" data-id="${participantId}">Вернуться к заданиям</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderPostTrainingTests(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const completedTaskIds = new Set(data.attempts.filter((attempt) => attempt.type === "task").map((attempt) => attempt.taskId));
  const tasks = data.tasks.filter((task) => !completedTaskIds.has(task.id));
  if (!tasks.length) {
    alert("Тесты после обучения уже отправлены");
    return renderTrainingWorkspace(participantId);
  }
  const sections = tasks.map((task, index) => html`
    <section class="panel">
      <h2>Тест ${index + 1}. ${escapeHtml(translateTestText(task.title))}</h2>
      ${task.description ? `<p>${escapeHtml(translateTestText(task.description))}</p>` : ""}
      ${renderPostTrainingTaskFields(task, `task${index}_`)}
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="postTrainingTestsForm">
        <section class="panel">
          <h1>${escapeHtml(translateTestText("Тесты после обучения"))}</h1>
          ${languageControl()}
          <div class="notice warn">Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно заполнить все разделы и отправить одним разом.</div>
        </section>
        ${sections}
        <section class="panel actions">
          <button>${escapeHtml(translateTestText("Отправить тесты после обучения"))}</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">${escapeHtml(translateTestText("Назад"))}</button>
        </section>
      </form>
    </main>
  `);
  bindLanguageControl(() => renderPostTrainingTests(participantId));
  document.querySelector("#postTrainingTestsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"], button:not([type])');
    if (submitButton?.disabled) return;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = translateTestText("Отправка...");
    }
    const formData = new FormData(event.target);
    try {
      const results = [];
      for (const [index, task] of tasks.entries()) {
        const answers = collectPostTrainingTaskAnswers(task, formData, `task${index}_`);
        try {
          const result = await api(`/api/training/tasks/${participantId}/${task.id}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
          results.push(result.attempt);
        } catch (error) {
          if (!String(error.message || "").includes("уже отправлено")) throw error;
        }
      }
      await showPostTrainingResult(participantId);
    } catch (error) {
      try {
        const freshData = await api(`/api/training/participant/${participantId}`);
        const savedTasks = freshData.attempts.filter((attempt) => attempt.type === "task");
        if (savedTasks.length >= freshData.tasks.length) {
          await showPostTrainingResult(participantId, freshData);
          return;
        }
      } catch {}
      alert(error.message);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = translateTestText("Отправить тесты после обучения");
      }
    }
  });
}

async function showPostTrainingResult(participantId, data = null) {
  const freshData = data || await api(`/api/training/participant/${participantId}`);
  const allResults = freshData.attempts.filter((attempt) => attempt.type === "task");
  const correct = allResults.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
  const total = allResults.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const passed = percent >= 70;
  const resultRows = allResults.map((attempt) => html`
    <tr>
      <td>${escapeHtml(attempt.instrument || "")}. ${escapeHtml(attempt.title || "")}</td>
      <td>${attempt.correct}/${attempt.total || attempt.maxScore}</td>
      <td>${attempt.percent}%</td>
    </tr>
  `).join("");
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>${escapeHtml(translateTestText("Тесты после обучения отправлены"))}</h1>
        <div class="notice ${passed ? "ok" : "danger"}">
          Ваш результат: <strong>${correct}/${total} (${percent}%)</strong>.
          ${passed ? "<strong>Тест пройден.</strong>" : "<strong>Тест не пройден. Нужно 70% и выше.</strong>"}
          Ответы сохранены и отправлены администратору.
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Тест</th><th>Баллы</th><th>Процент</th></tr></thead>
            <tbody>${resultRows}</tbody>
            <tfoot>
              <tr class="total-row">
                <td>Общий процент</td>
                <td>${correct}/${total}</td>
                <td>${percent}% ${passed ? `<span class="pill ok">${escapeHtml(translateTestText("Пройден"))}</span>` : `<span class="pill danger">${escapeHtml(translateTestText("Не пройден"))}</span>`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button data-action="select-training-participant" data-id="${participantId}">${escapeHtml(translateTestText("Вернуться"))}</button>
      </section>
    </main>
  `);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function collectPostTrainingTaskAnswers(task, formData, prefix = "") {
  const answers = {};
  if (task.mode === "findrisc") {
    task.fields.forEach(([name]) => answers[name] = formData.get(`${prefix}${name}`) || "");
  } else if (task.mode === "singleCases") {
    task.cases.forEach((_, index) => answers[`case${index}`] = formData.get(`${prefix}case${index}`) || "");
  } else if (task.mode === "routing") {
    task.cases.forEach((_, index) => {
      answers[`case${index}`] = {
        specialist: formData.get(`${prefix}case${index}_specialist`) || "",
        urgency: formData.get(`${prefix}case${index}_urgency`) || ""
      };
    });
  } else if (task.mode === "mcq") {
    task.questions.forEach((_, index) => answers[`q${index}`] = formData.get(`${prefix}q${index}`) || "");
  }
  return answers;
}

function renderPostTrainingTaskFields(task, prefix = "") {
  if (task.mode === "findrisc") return html`
    <section class="card">
      <div class="grid two">
        ${task.fields.map(([name, label]) => {
          const options = name === "risk" ? ["Высокий риск", "Низкий риск"] : ["0", "1", "2", "3", "4", "5"];
          return `<div class="form-row"><label>${escapeHtml(translateTestText(label))}</label><select name="${prefix}${name}" required>${options.map((item) => `<option value="${item}">${escapeHtml(translateTestText(item))}</option>`).join("")}</select></div>`;
        }).join("")}
      </div>
    </section>
  `;
  if (task.mode === "singleCases") return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(translateTestText(caseText))}</h3>
      <div class="form-row"><label>${escapeHtml(translateTestText("Выберите правильный вариант"))}</label><select name="${prefix}case${index}" required>${task.options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(translateTestText(item))}</option>`).join("")}</select></div>
    </section>
  `).join("");
  if (task.mode === "routing") return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(translateTestText(caseText))}</h3>
      <section class="grid two">
        <div class="form-row"><label>${escapeHtml(translateTestText("Куда направить"))}</label><select name="${prefix}case${index}_specialist" required>${task.specialistOptions.map((item) => `<option value="${item}">${escapeHtml(translateTestText(item))}</option>`).join("")}</select></div>
        <div class="form-row"><label>${escapeHtml(translateTestText("Срочность"))}</label><select name="${prefix}case${index}_urgency" required>${task.urgencyOptions.map((item) => `<option value="${item}">${escapeHtml(translateTestText(item))}</option>`).join("")}</select></div>
      </section>
    </section>
  `).join("");
  if (task.mode === "mcq") return task.questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(translateTestText(question.text))}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="${prefix}q${index}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(translateTestText(text))}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  return renderTaskSimpleFields(task);
}

function renderTaskSimpleFields(task) {
  return (task.fields || []).map(([name, label]) => html`
    <section class="card">
      <div class="form-row"><label>${escapeHtml(label)}</label><textarea name="${name}" required></textarea></div>
    </section>
  `).join("");
}

function renderTaskCaseFields(task) {
  return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(caseText)}</h3>
      <section class="grid two">
        ${task.fields.map(([name, label]) => `<div class="form-row"><label>${escapeHtml(label)}</label><textarea name="case${index}_${name}" required></textarea></div>`).join("")}
      </section>
    </section>
  `).join("");
}

async function loadNurseTraining() {
  state.nurseTraining = await api("/api/nurse-training");
  renderNurseTrainingList();
  showNurseLanguagePrompt(renderNurseTrainingList);
}

function renderNurseTrainingList() {
  const attemptsByParticipant = (state.nurseTraining.attempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const personCard = (participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const post = attempts.find((attempt) => attempt.type === "post");
    return html`
      <div class="card training-person">
        <div>
          <strong>${escapeHtml(participant.fullName)}</strong>
          <div class="muted">${escapeHtml(participant.clinic || "")} / ${escapeHtml(translateTestText(participant.position || "Медсестра"))}</div>
          <div class="muted">${escapeHtml(translateTestText("До обучения"))}: ${pre ? `${pre.percent}%` : escapeHtml(translateTestText("не сдан"))} / ${escapeHtml(translateTestText("После обучения"))}: ${post ? `${post.percent}%` : escapeHtml(translateTestText("не сдан"))}</div>
        </div>
        <button data-action="select-nurse-training-participant" data-id="${participant.id}">${escapeHtml(translateTestText("Открыть"))}</button>
      </div>
    `;
  };
  const sortNurseTrainingParticipants = (participants) => state.nurseTrainingNameSort === "az"
    ? [...participants].sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ru"))
    : [...participants];
  const participantMatchesNurseTrainingStatus = (participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const hasPre = attempts.some((attempt) => attempt.type === "pre");
    const hasPost = attempts.some((attempt) => attempt.type === "post");
    const preOk = state.nurseTrainingPreStatusFilter === "all" || (state.nurseTrainingPreStatusFilter === "done" ? hasPre : !hasPre);
    const postOk = state.nurseTrainingPostStatusFilter === "all" || (state.nurseTrainingPostStatusFilter === "done" ? hasPost : !hasPost);
    return preOk && postOk;
  };
  const filterNurseTrainingParticipants = (participants, query = "") => participants.filter((item) =>
    String(item.fullName || "").toLowerCase().includes(query) && participantMatchesNurseTrainingStatus(item)
  );
  const renderNurseTrainingRows = (participants) => sortNurseTrainingParticipants(participants).map(personCard).join("");
  const rows = renderNurseTrainingRows(filterNurseTrainingParticipants(state.nurseTraining.participants || []));
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>${escapeHtml(translateTestText("№5 Тесты медсестер"))}</h1>
        ${languageControl()}
        <p class="muted">${escapeHtml(translateTestText("Найдите свое имя. Сначала пройдите тест до обучения, после семинара - тест после обучения. Порог 70% действует только для теста после обучения."))}</p>
        <div class="grid two">
          <input id="nurseTrainingSearch" placeholder="${escapeHtml(translateTestText("Введите фамилию или имя"))}" />
          <select id="nurseTrainingNameSort" aria-label="${escapeHtml(translateTestText("Сортировка списка медсестер"))}">
            <option value="default" ${state.nurseTrainingNameSort === "default" ? "selected" : ""}>${escapeHtml(translateTestText("По регистрации"))}</option>
            <option value="az" ${state.nurseTrainingNameSort === "az" ? "selected" : ""}>${escapeHtml(translateTestText("От А до Я"))}</option>
          </select>
          <select id="nurseTrainingPreStatusFilter" aria-label="${escapeHtml(translateTestText("Фильтр теста до обучения"))}">
            <option value="all" ${state.nurseTrainingPreStatusFilter === "all" ? "selected" : ""}>${escapeHtml(translateTestText("До обучения: все"))}</option>
            <option value="done" ${state.nurseTrainingPreStatusFilter === "done" ? "selected" : ""}>${escapeHtml(translateTestText("До обучения: сдали"))}</option>
            <option value="missing" ${state.nurseTrainingPreStatusFilter === "missing" ? "selected" : ""}>${escapeHtml(translateTestText("До обучения: не сдали"))}</option>
          </select>
          <select id="nurseTrainingPostStatusFilter" aria-label="${escapeHtml(translateTestText("Фильтр теста после обучения"))}">
            <option value="all" ${state.nurseTrainingPostStatusFilter === "all" ? "selected" : ""}>${escapeHtml(translateTestText("После обучения: все"))}</option>
            <option value="done" ${state.nurseTrainingPostStatusFilter === "done" ? "selected" : ""}>${escapeHtml(translateTestText("После обучения: сдали"))}</option>
            <option value="missing" ${state.nurseTrainingPostStatusFilter === "missing" ? "selected" : ""}>${escapeHtml(translateTestText("После обучения: не сдали"))}</option>
          </select>
        </div>
        <div id="nurseTrainingList" class="training-list">${rows || `<p class='muted'>${escapeHtml(translateTestText("Администратор еще не зарегистрировал медсестер."))}</p>`}</div>
      </section>
    </main>
  `);
  bindLanguageControl(renderNurseTrainingList);
  const refreshNurseTrainingList = () => {
    const query = document.querySelector("#nurseTrainingSearch")?.value.toLowerCase() || "";
    const participants = filterNurseTrainingParticipants(state.nurseTraining.participants || [], query);
    document.querySelector("#nurseTrainingList").innerHTML = renderNurseTrainingRows(participants) || `<p class='muted'>${escapeHtml(translateTestText("Участник не найден"))}</p>`;
  };
  document.querySelector("#nurseTrainingSearch")?.addEventListener("input", () => {
    refreshNurseTrainingList();
  });
  document.querySelector("#nurseTrainingNameSort")?.addEventListener("change", (event) => {
    state.nurseTrainingNameSort = event.target.value;
    refreshNurseTrainingList();
  });
  document.querySelector("#nurseTrainingPreStatusFilter")?.addEventListener("change", (event) => {
    state.nurseTrainingPreStatusFilter = event.target.value;
    refreshNurseTrainingList();
  });
  document.querySelector("#nurseTrainingPostStatusFilter")?.addEventListener("change", (event) => {
    state.nurseTrainingPostStatusFilter = event.target.value;
    refreshNurseTrainingList();
  });
}

async function renderNurseTrainingWorkspace(participantId) {
  const data = await api(`/api/nurse-training/participant/${participantId}`);
  const pre = data.attempts.find((attempt) => attempt.type === "pre");
  const post = data.attempts.find((attempt) => attempt.type === "post");
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>${escapeHtml(translateTestText("№5 Тесты медсестер"))}</h1>
        ${languageControl()}
        <h2>${escapeHtml(data.participant.fullName)}</h2>
        <div class="actions">
          ${pre ? `<span class="pill ok">${escapeHtml(translateTestText("До обучения"))}: ${pre.percent}%</span>` : `<button data-action="start-nurse-test" data-id="${participantId}" data-test-type="pre">${escapeHtml(translateTestText("Тест до обучения"))}</button>`}
          ${post ? `<span class="pill ${post.passed ? "ok" : "danger"}">${escapeHtml(translateTestText("После обучения"))}: ${post.percent}% ${escapeHtml(translateTestText(post.passed ? "Пройден" : "Не пройден"))}</span>` : `<button data-action="start-nurse-test" data-id="${participantId}" data-test-type="post">${escapeHtml(translateTestText("Тест после обучения"))}</button>`}
          <button type="button" class="secondary" onclick="location.href='${NURSE_TRAINING_APP_PATH}'">${escapeHtml(translateTestText("К списку"))}</button>
        </div>
      </section>
    </main>
  `);
  bindLanguageControl(() => renderNurseTrainingWorkspace(participantId));
}

async function renderNurseTest(participantId, type) {
  const data = await api(`/api/nurse-training/participant/${participantId}`);
  const existing = data.attempts.find((attempt) => attempt.type === type);
  if (existing) {
    alert(translateTestText("Этот тест уже сдан"));
    return renderNurseTrainingWorkspace(participantId);
  }
  const questions = type === "post" ? data.postQuestions : data.preQuestions;
  const questionCards = questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(translateTestText(question.text))}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label><input type="radio" name="q${question.id}" value="${letter}" required /><span>${letter}. ${escapeHtml(translateTestText(text))}</span></label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="nurseTestForm">
        <section class="panel">
          <h1>${escapeHtml(translateTestText(type === "post" ? "Тест после обучения" : "Тест до обучения"))}</h1>
          ${languageControl()}
          <div class="notice warn">${escapeHtml(translateTestText("Участник"))}: <strong>${escapeHtml(data.participant.fullName)}</strong>. ${escapeHtml(translateTestText(type === "post" ? "Для прохождения нужно набрать 70% или больше." : "Порог прохождения для теста до обучения не применяется."))}</div>
        </section>
        ${questionCards}
        <section class="panel actions">
          <button>${escapeHtml(translateTestText("Отправить тест"))}</button>
          <button type="button" class="secondary" data-action="select-nurse-training-participant" data-id="${participantId}">${escapeHtml(translateTestText("Назад"))}</button>
        </section>
      </form>
    </main>
  `);
  bindLanguageControl(() => renderNurseTest(participantId, type));
  document.querySelector("#nurseTestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [name, value] of new FormData(event.target).entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/nurse-training/${type}/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>${escapeHtml(translateTestText("Тест отправлен"))}</h1>
            ${languageControl()}
            <div class="notice ${type === "post" ? (result.attempt.passed ? "ok" : "danger") : "ok"}">
              ${escapeHtml(translateTestText("Ваш результат"))}: <strong>${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%)</strong>.
              ${type === "post" ? `<strong>${escapeHtml(translateTestText(result.attempt.passed ? "Тест пройден." : "Тест не пройден. Нужно 70% и выше."))}</strong>` : ""}
            </div>
            <button data-action="select-nurse-training-participant" data-id="${participantId}">${escapeHtml(translateTestText("Вернуться"))}</button>
          </section>
        </main>
      `);
      bindLanguageControl(() => renderNurseTrainingWorkspace(participantId));
    } catch (error) {
      alert(error.message);
    }
  });
}

function input(label, name, required = false, type = "text") {
  const isPhone = type === "tel" || name === "phone";
  const numeric = type === "number";
  const isInteger = ["height", "systolic", "diastolic", "age", "followUpDays"].includes(name);
  const inputMode = isPhone ? 'inputmode="tel"' : numeric ? (isInteger ? 'inputmode="numeric"' : 'inputmode="decimal"') : "";
  const actualType = isPhone ? "tel" : numeric ? "text" : type;
  return `<div class="form-row"><label>${label}</label><input name="${name}" type="${actualType}" ${inputMode} ${required ? "required" : ""} /></div>`;
}

function select(label, name, options) {
  return `<div class="form-row"><label>${label}</label><select name="${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></div>`;
}

async function loadDoctor() {
  state.doctor = await api("/api/doctor/workspace");
  renderDoctor();
  showDoctorLanguagePrompt(renderDoctor);
}

function doctorPatientNameBySurveyId(surveyId) {
  const survey = state.doctor?.surveys?.find((item) => item.id === surveyId);
  return fullName(survey?.patient) || "Пациент";
}

function doctorVisitsForSurvey(surveyId) {
  return (state.doctor?.visits || [])
    .filter((visit) => visit.surveyId === surveyId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function glucoseTypeLabel(type) {
  const labels = {
    fasting: "Натощак",
    random: "Случайный замер",
    postMeal: "Через 2 часа после еды",
    hba1c: "HbA1c"
  };
  return labels[type] || labels.fasting;
}

function diagnosisByGlucose(value, type = "fasting") {
  const glucose = Number(String(value || "").replace(",", "."));
  if (!glucose) return { diagnosis: "", level: "" };
  if (type === "hba1c") {
    if (glucose >= 6.5) return { diagnosis: "Сахарный диабет", level: "danger" };
    if (glucose >= 5.7) return { diagnosis: "Преддиабет", level: "warn" };
    return { diagnosis: "Норма", level: "ok" };
  }
  if (type === "random" || type === "postMeal") {
    if (glucose >= 11.1) return { diagnosis: "Сахарный диабет", level: "danger" };
    if (glucose >= 7.8) return { diagnosis: "Преддиабет", level: "warn" };
    return { diagnosis: "Норма", level: "ok" };
  }
  if (glucose >= 7) return { diagnosis: "Сахарный диабет", level: "danger" };
  if (glucose >= 6.1) return { diagnosis: "Преддиабет", level: "warn" };
  return { diagnosis: "Норма", level: "ok" };
}

function doctorVisitDetails(visit) {
  const t = (value) => translateDoctorText(value);
  const referrals = (visit.referrals || []).join(", ") || "-";
  const diabetesDrugs = (visit.diabetesDrugs || []).join("; ");
  const hypertensionDrugs = (visit.hypertensionDrugs || []).join("; ");
  const drugs = [diabetesDrugs, hypertensionDrugs].filter(Boolean).join("; ") || "-";
  return html`
    <details class="answer-details visit-details"${visit.id === state.lastSavedDoctorVisitId ? " open" : ""}>
      <summary>${new Date(visit.createdAt).toLocaleString("ru-RU")} - ${escapeHtml(t("Диагноз"))}: ${visit.diagnosis ? escapeHtml(t(visit.diagnosis)) : "-"}</summary>
      <div class="grid two">
        <div>
          <div class="muted">${escapeHtml(t("Индекс массы тела"))}: ${visit.bmi || "-"}</div>
          <div class="muted">${escapeHtml(t("Артериальное давление"))}: ${visit.systolic || "-"}/${visit.diastolic || "-"}</div>
          <div class="muted">${escapeHtml(t("Сахар крови"))}: ${visit.glucose || "-"} (${escapeHtml(t(glucoseTypeLabel(visit.glucoseType)))})</div>
          <div class="muted">${escapeHtml(t("Направление"))}: ${escapeHtml(referrals)}</div>
          <div class="muted">${escapeHtml(t("Повторный осмотр"))}: ${visit.followUpDays ? `${visit.followUpDays} ${escapeHtml(t("дней"))}` : "-"}</div>
        </div>
        <div>
          <div class="muted">${escapeHtml(t("Лекарства"))}: ${escapeHtml(drugs)}</div>
          <div class="muted">${escapeHtml(t("Лаборатория"))}: ${escapeHtml(doctorLabSummary(visit.laboratoryTests))}</div>
          <div class="muted">${escapeHtml(t("План лечения"))}: ${escapeHtml(visit.treatmentPlan || "-")}</div>
        </div>
      </div>
    </details>
  `;
}

function doctorVisitHistory(surveyId) {
  const t = (value) => translateDoctorText(value);
  const visits = doctorVisitsForSurvey(surveyId);
  if (!visits.length) return "";
  return html`
    <section class="visit-history">
      <h3>${escapeHtml(t("Предыдущие осмотры"))}</h3>
      <div class="training-list">${visits.map(doctorVisitDetails).join("")}</div>
    </section>
  `;
}

function doctorTrendChart(survey) {
  const visits = [...doctorVisitsForSurvey(survey.id)].reverse();
  const points = [
    {
      date: survey.createdAt,
      systolic: Number(survey.measurements?.systolic || 0),
      diastolic: Number(survey.measurements?.diastolic || 0),
      glucose: Number(survey.measurements?.glucoseLevel || 0)
    },
    ...visits.map((visit) => ({
      date: visit.createdAt,
      systolic: Number(visit.systolic || 0),
      diastolic: Number(visit.diastolic || 0),
      glucose: Number(visit.glucose || 0)
    }))
  ];
  const miniChart = (key, label, color) => {
    const values = points.map((point) => point[key]).filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return `<div class="trend-card"><strong>${escapeHtml(label)}</strong><span class="muted">Нет измерений</span></div>`;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const coordinates = values.map((value, index) => {
      const x = values.length === 1 ? 50 : 5 + index * 90 / (values.length - 1);
      const y = 38 - ((value - min) / range) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const latest = values.at(-1);
    return html`<div class="trend-card">
      <div><strong>${escapeHtml(label)}</strong><span>${latest}</span></div>
      <svg viewBox="0 0 100 44" role="img" aria-label="${escapeHtml(label)}"><polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" /></svg>
      <small>${values.length} измерений · минимум ${min} · максимум ${max}</small>
    </div>`;
  };
  return html`
    <section class="patient-trends">
      <h3>Динамика показателей</h3>
      <div class="trend-grid">
        ${miniChart("systolic", "Систолическое АД", "#dc2626")}
        ${miniChart("diastolic", "Диастолическое АД", "#f59e0b")}
        ${miniChart("glucose", "Уровень сахара", "#2563eb")}
      </div>
    </section>
  `;
}

function patientTasksForSurvey(surveyId) {
  return (state.doctor?.tasks || [])
    .filter((task) => task.surveyId === surveyId)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

function doctorPatientTasks(surveyId) {
  const tasks = patientTasksForSurvey(surveyId);
  return html`
    <section class="patient-task-box">
      <h3>Задачи и повторные визиты</h3>
      <form class="form compact-task-form" data-doctor-task-form data-survey-id="${surveyId}">
        <input name="title" placeholder="Например: позвонить пациенту" required maxlength="200" />
        <input name="dueDate" type="date" required />
        <button type="submit">Добавить задачу</button>
      </form>
      <div class="task-list">${tasks.map((task) => {
        const overdue = task.status !== "completed" && new Date(task.dueAt) < new Date();
        return html`<article class="task-item ${overdue ? "overdue" : ""} ${task.status === "completed" ? "completed" : ""}">
          <div><strong>${escapeHtml(task.title)}</strong><span>${new Date(task.dueAt).toLocaleDateString("ru-RU")}${overdue ? " · просрочено" : ""}</span></div>
          <button type="button" class="secondary" data-action="doctor-task-status" data-id="${task.id}" data-status="${task.status === "completed" ? "open" : "completed"}">${task.status === "completed" ? "Вернуть" : "Выполнено"}</button>
        </article>`;
      }).join("") || `<p class="muted">Задач пока нет</p>`}</div>
    </section>
  `;
}

function doctorTasksPanel() {
  const tasks = (state.doctor?.tasks || []).filter((task) => state.doctorTaskFilter === "all" || task.status === state.doctorTaskFilter);
  const surveys = Object.fromEntries((state.doctor?.surveys || []).map((survey) => [survey.id, survey]));
  const today = new Date();
  const rows = [...tasks].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).map((task) => {
    const overdue = task.status !== "completed" && new Date(task.dueAt) < today;
    return html`<article class="task-item ${overdue ? "overdue" : ""} ${task.status === "completed" ? "completed" : ""}">
      <div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(fullName(surveys[task.surveyId]?.patient) || "Пациент")} · ${new Date(task.dueAt).toLocaleDateString("ru-RU")}${overdue ? " · просрочено" : ""}</span></div>
      <div class="actions"><button type="button" data-action="select-survey" data-id="${task.surveyId}">Открыть пациента</button><button type="button" class="secondary" data-action="doctor-task-status" data-id="${task.id}" data-status="${task.status === "completed" ? "open" : "completed"}">${task.status === "completed" ? "Вернуть" : "Выполнено"}</button></div>
    </article>`;
  }).join("");
  return html`<section class="panel doctor-tasks-panel"><div class="section-title"><div><h2>Задачи и напоминания</h2><p class="muted">Повторные визиты создаются автоматически после осмотра.</p></div><select id="doctorTaskFilter"><option value="open" ${state.doctorTaskFilter === "open" ? "selected" : ""}>Открытые</option><option value="completed" ${state.doctorTaskFilter === "completed" ? "selected" : ""}>Выполненные</option><option value="all" ${state.doctorTaskFilter === "all" ? "selected" : ""}>Все</option></select></div><div class="task-list">${rows || `<p class="muted">Задач в этой категории нет</p>`}</div></section>`;
}

function doctorProfilePanel() {
  const t = (value) => translateDoctorText(value);
  const visits = [...(state.doctor?.visits || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const visitRows = visits.slice(0, 20).map((visit) => html`
    <tr>
      <td>${escapeHtml(doctorPatientNameBySurveyId(visit.surveyId))}</td>
      <td>${new Date(visit.createdAt).toLocaleString("ru-RU")}</td>
      <td>${visit.diagnosis ? escapeHtml(t(visit.diagnosis)) : "-"}</td>
      <td>${visit.bmi || "-"} / ${visit.systolic || "-"}/${visit.diastolic || "-"} / ${visit.glucose || "-"}</td>
      <td>${escapeHtml(((visit.diabetesDrugs || []).concat(visit.hypertensionDrugs || [])).join("; ") || "-")}</td>
      <td>${escapeHtml(doctorLabSummary(visit.laboratoryTests))}</td>
      <td>${visit.followUpDays ? `${visit.followUpDays} ${escapeHtml(t("дней"))}` : "-"}</td>
    </tr>
  `).join("");
  return html`
    <section class="panel doctor-profile-panel">
      <h2>${escapeHtml(t("Личный кабинет"))}</h2>
      <form class="form account-form" id="doctorAccountForm">
        <h3>${escapeHtml(t("Сменить логин и пароль"))}</h3>
        <section class="grid two">
          <div class="form-row"><label>${escapeHtml(t("Новый логин"))}</label><input name="login" value="${escapeHtml(state.doctor?.doctor?.login || "")}" required /></div>
          <div class="form-row"><label>Текущий пароль</label><input name="currentAccessKey" type="password" autocomplete="current-password" required /></div>
          <div class="form-row"><label>${escapeHtml(t("Новый пароль / ключ"))}</label><input name="accessKey" type="password" autocomplete="new-password" minlength="5" placeholder="${escapeHtml(t("Оставьте пустым, если ключ менять не нужно"))}" /></div>
        </section>
        <button>${escapeHtml(t("Сохранить логин и пароль"))}</button>
        <div id="doctorAccountResult"></div>
      </form>
      <h3>${escapeHtml(t("Последние осмотры"))}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${escapeHtml(t("Пациент"))}</th><th>${escapeHtml(t("Дата"))}</th><th>${escapeHtml(t("Диагноз"))}</th><th>ИМТ / АД / сахар</th><th>${escapeHtml(t("Лекарства"))}</th><th>${escapeHtml(t("Лаборатория"))}</th><th>${escapeHtml(t("Повторный осмотр"))}</th></tr></thead>
          <tbody>${visitRows || `<tr><td colspan="7">${escapeHtml(t("Пока нет осмотров"))}</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function doctorSimpleRows(data) {
  return Object.entries(data)
    .sort(([a], [b]) => String(a).localeCompare(String(b), "ru"))
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${value}</td></tr>`)
    .join("");
}

function doctorStatsPanel() {
  const t = (value) => translateDoctorText(value);
  const visits = state.doctor?.visits || [];
  const patientCount = new Set(visits.map((visit) => visit.surveyId)).size;
  const byDate = countBy(visits, (visit) => visit.createdAt ? new Date(visit.createdAt).toISOString().slice(0, 10) : "Не указано");
  const byDiagnosis = countBy(visits, (visit) => visit.diagnosis || "Без диагноза");
  const byDrug = countBy(visits.flatMap((visit) => [...(visit.diabetesDrugs || []), ...(visit.hypertensionDrugs || [])]), (item) => item);
  return html`
    <section class="panel doctor-stats-panel">
      <h2>${escapeHtml(t("Статистика врача"))}</h2>
      <section class="grid three">
        <div class="metric"><span>${escapeHtml(t("Всего осмотров"))}</span><strong>${visits.length}</strong></div>
        <div class="metric"><span>${escapeHtml(t("Пациентов"))}</span><strong>${patientCount}</strong></div>
        <div class="metric"><span>${escapeHtml(t("Назначенные препараты"))}</span><strong>${Object.values(byDrug).reduce((sum, value) => sum + value, 0)}</strong></div>
      </section>
      <section class="grid three stat-tables">
        <div class="card">
          <h3>${escapeHtml(t("Осмотры по дням"))}</h3>
          <div class="table-wrap"><table><tbody>${doctorSimpleRows(byDate) || `<tr><td>${escapeHtml(t("Пока нет осмотров"))}</td><td>0</td></tr>`}</tbody></table></div>
        </div>
        <div class="card">
          <h3>${escapeHtml(t("Диагнозы"))}</h3>
          <div class="table-wrap"><table><tbody>${doctorSimpleRows(byDiagnosis) || `<tr><td>${escapeHtml(t("Пока нет осмотров"))}</td><td>0</td></tr>`}</tbody></table></div>
        </div>
        <div class="card">
          <h3>${escapeHtml(t("Назначенные препараты"))}</h3>
          <div class="table-wrap"><table><tbody>${doctorSimpleRows(byDrug) || `<tr><td>-</td><td>0</td></tr>`}</tbody></table></div>
        </div>
      </section>
    </section>
  `;
}

function doctorPatientsPanel() {
  const t = (value) => translateDoctorText(value);
  const visits = state.doctor?.visits || [];
  const patientCount = new Set(visits.map((visit) => visit.surveyId)).size;
  const queueCount = state.doctor?.surveys?.length || 0;
  const primaryPanel = state.doctorMode === "add"
    ? doctorPatientSurveyForm()
    : state.selectedSurvey
      ? doctorVisitForm(state.selectedSurvey)
      : html`
        <section class="doctor-empty-state">
          <div class="doctor-empty-icon">+</div>
          <h2>${escapeHtml(t("Выберите пациента"))}</h2>
          <p class="muted">${escapeHtml(t("После выбора откроется повторное измерение, направления и препараты."))}</p>
        </section>
      `;
  return html`
    <section class="doctor-hero">
      <div>
        <span>${escapeHtml(state.doctor.doctor?.clinic || "")}</span>
        <h1>${escapeHtml(t("Кабинет врача"))}</h1>
        <p>${escapeHtml(state.doctor.doctor?.fullName || state.me?.name || "")}</p>
      </div>
      <div class="doctor-hero-metrics">
        <div><strong>${queueCount}</strong><span>${escapeHtml(t("Пациенты"))}</span></div>
        <div><strong>${visits.length}</strong><span>${escapeHtml(t("Всего осмотров"))}</span></div>
        <div><strong>${patientCount}</strong><span>${escapeHtml(t("Осмотренные пациенты"))}</span></div>
      </div>
    </section>
    <section class="panel doctor-primary-panel" id="doctorPrimaryPanel">${primaryPanel}</section>
    <section class="panel patient-sidebar">
      <div class="sidebar-title">
        <div>
          <h2>${escapeHtml(t("Картотека больных"))}</h2>
          <p class="muted">${escapeHtml(t("Пациенты"))}: ${queueCount}</p>
        </div>
      </div>
      ${doctorLanguageControl()}
      <div class="actions">
        <button type="button" data-action="add-doctor-patient">${escapeHtml(t("Добавить пациента"))}</button>
        <button type="button" class="secondary" id="doctorSyncButton">${escapeHtml(t("Синхронизировать"))}</button>
        <button type="button" class="${state.doctorRiskFirst ? "" : "secondary"}" data-action="doctor-toggle-risk-sort">${escapeHtml(t("Сначала к врачу"))}</button>
      </div>
      <div class="muted" id="doctorSyncStatus"></div>
      <div id="doctorSyncResult"></div>
      <div class="doctor-patient-search">
        <label for="patientSearch">Поиск пациента</label>
        <div class="actions">
          <input id="patientSearch" type="search" value="${escapeHtml(state.doctorPatientSearch)}" placeholder="${escapeHtml(t("Введите имя или фамилию"))}" autocomplete="off" />
          ${state.doctorPatientSearch ? `<button type="button" class="secondary" data-action="clear-doctor-patient-search">Сбросить</button>` : ""}
        </div>
        <small class="muted">Можно искать по ФИО, телефону, дате рождения или поликлинике</small>
      </div>
      <select id="doctorPatientFilter" aria-label="Фильтр пациентов">
        <option value="all" ${state.doctorPatientFilter === "all" ? "selected" : ""}>Все пациенты</option>
        <option value="risk" ${state.doctorPatientFilter === "risk" ? "selected" : ""}>Повышенный риск</option>
        <option value="pressure" ${state.doctorPatientFilter === "pressure" ? "selected" : ""}>Высокое давление</option>
        <option value="glucose" ${state.doctorPatientFilter === "glucose" ? "selected" : ""}>Высокий сахар</option>
        <option value="overdue" ${state.doctorPatientFilter === "overdue" ? "selected" : ""}>Просрочен повторный визит</option>
      </select>
      <div id="patientList" style="margin-top:12px">${doctorPaginatedSurveyList(doctorSortedSurveys(doctorFilteredSurveys()))}</div>
    </section>
  `;
}

function renderDoctor() {
  const t = (value) => translateDoctorText(value);
  const doctorNav = [
    ["patients", "Пациенты"],
    ["waiting", "Ожидают врача"],
    ["calendar", "Календарь"],
    ["tasks", "Задачи"],
    ["profile", "Кабинет"],
    ["stats", "Статистика"]
  ].map(([tab, label]) => `<button data-action="doctor-tab" data-tab="${tab}" class="${state.doctorSection === tab ? "active" : ""}">${escapeHtml(t(label))}</button>`).join("") + `<button type="button" data-action="toggle-easy-reading" aria-pressed="${localStorage.getItem('eclinic-easy-reading') === 'true'}">${doctorLanguage() === 'tg' ? 'Ҳарфҳои калон' : 'Крупный шрифт'}</button>`;
  const content = state.doctorSection === 'waiting' ? waitingPanel(state.waitingPatients || []) : state.doctorSection === "calendar"
    ? doctorCalendarPanel()
    : state.doctorSection === "tasks"
    ? doctorTasksPanel()
    : state.doctorSection === "profile"
    ? doctorProfilePanel()
    : state.doctorSection === "stats"
      ? doctorStatsPanel()
      : doctorPatientsPanel();
  setPage(html`
    <div class="layout doctor-layout">
      ${topbar(escapeHtml(t("Кабинет врача")), doctorNav)}
      <main class="container grid two doctor-workspace">
        ${helpPanel('doctor', doctorLanguage())}
        ${content}
      </main>
    </div>
  `);
  bindDoctorLanguageControl(renderDoctor);
  document.querySelector("#doctorSyncButton")?.addEventListener("click", syncOfflineDoctorActions);
  updateOfflineDoctorStatus();
  document.querySelector("#patientSearch")?.addEventListener("input", (event) => {
    state.doctorPatientSearch = event.target.value;
    state.doctorPatientPage = 1;
    renderDoctorPatientList();
  });
  document.querySelector("#doctorPatientFilter")?.addEventListener("change", (event) => {
    state.doctorPatientFilter = event.target.value;
    state.doctorPatientPage = 1;
    renderDoctorPatientList();
  });
  document.querySelector("#doctorTaskFilter")?.addEventListener("change", (event) => {
    state.doctorTaskFilter = event.target.value;
    renderDoctor();
  });
  bindDoctorVisit();
  bindDoctorPatientSurvey();
  bindDoctorAccountForm();
  bindDoctorTaskForms();
  document.querySelector("#appointmentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/doctor/appointments", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      state.doctor.appointments.push(result.appointment);
      renderDoctor();
    } catch (error) { alert(error.message); }
  });
}

function doctorCalendarPanel() {
  const patients = (state.doctor.surveys || []).map((survey) => `<option value="${survey.id}">${escapeHtml(fullName(survey.patient))}</option>`).join("");
  const rows = [...(state.doctor.appointments || [])].sort((a,b) => new Date(a.startsAt)-new Date(b.startsAt)).map((item) => {
    const survey = state.doctor.surveys.find((entry) => entry.id === item.surveyId);
    return `<tr><td>${new Date(item.startsAt).toLocaleString("ru-RU")}</td><td>${escapeHtml(fullName(survey?.patient))}</td><td>${escapeHtml(item.note || "")}</td><td>${escapeHtml(item.status)}</td><td><div class="actions"><button data-action="appointment-status" data-id="${item.id}" data-status="arrived">Пришёл</button><button data-action="appointment-status" data-id="${item.id}" data-status="completed">Завершён</button><button class="secondary" data-action="appointment-status" data-id="${item.id}" data-status="no_show">Не явился</button></div></td></tr>`;
  }).join("");
  return html`<section class="panel"><h2>Календарь приёмов</h2><form id="appointmentForm" class="form grid two"><label>Пациент<select name="surveyId" required>${patients}</select></label><label>Дата и время<input type="datetime-local" name="startsAt" required /></label><label>Комментарий<input name="note" /></label><button>Записать пациента</button></form><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Пациент</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead><tbody>${rows || "<tr><td colspan='5'>Записей пока нет</td></tr>"}</tbody></table></div></section>`;
}

function doctorSortedSurveys(surveys) {
  const list = [...(surveys || [])];
  if (state.doctorRiskFirst) {
    list.sort((left, right) => Number(Boolean(right.needsDoctor)) - Number(Boolean(left.needsDoctor)) || new Date(right.createdAt) - new Date(left.createdAt));
  }
  return list;
}

function renderDoctorPatientList() {
  const patientList = document.querySelector("#patientList");
  if (!patientList) return;
  const list = doctorFilteredSurveys();
  patientList.innerHTML = doctorPaginatedSurveyList(doctorSortedSurveys(list));
}

function doctorFilteredSurveys(query = state.doctorPatientSearch || "") {
  const terms = String(query).trim().toLocaleLowerCase("ru-RU").split(/\s+/).filter(Boolean);
  const openOverdueSurveyIds = new Set((state.doctor.tasks || []).filter((task) => task.status !== "completed" && new Date(task.dueAt) < new Date()).map((task) => task.surveyId));
  return state.doctor.surveys.filter((survey) => {
    const haystack = [fullName(survey.patient), survey.patient?.phone, survey.patient?.birthDate, survey.patient?.clinic].join(" ").toLocaleLowerCase("ru-RU");
    if (terms.length && !terms.every((term) => haystack.includes(term))) return false;
    const measurements = survey.measurements || {};
    if (state.doctorPatientFilter === "risk" && !survey.needsDoctor) return false;
    if (state.doctorPatientFilter === "pressure" && Number(measurements.systolic || 0) < 140) return false;
    if (state.doctorPatientFilter === "glucose" && Number(measurements.glucoseLevel || 0) < 6.1) return false;
    if (state.doctorPatientFilter === "overdue" && !openOverdueSurveyIds.has(survey.id)) return false;
    return true;
  });
}

function doctorPaginatedSurveyList(surveys) {
  const t = (value) => translateDoctorText(value);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil((surveys || []).length / pageSize));
  state.doctorPatientPage = Math.min(Math.max(1, state.doctorPatientPage || 1), totalPages);
  const start = (state.doctorPatientPage - 1) * pageSize;
  const pageItems = surveys.slice(start, start + pageSize);
  const from = surveys.length ? start + 1 : 0;
  const to = Math.min(start + pageSize, surveys.length);
  return html`
    ${doctorSurveyList(pageItems)}
    <div class="patient-pagination">
      <span>${from}-${to} / ${surveys.length}</span>
      <div class="actions">
        <button type="button" class="secondary" data-action="doctor-patient-page" data-page="${state.doctorPatientPage - 1}" ${state.doctorPatientPage <= 1 ? "disabled" : ""}>${escapeHtml(t("Назад"))}</button>
        <button type="button" class="secondary" data-action="doctor-patient-page" data-page="${state.doctorPatientPage + 1}" ${state.doctorPatientPage >= totalPages ? "disabled" : ""}>${escapeHtml(t("Далее"))}</button>
      </div>
    </div>
  `;
}

function doctorSurveyList(surveys) {
  const t = (value) => translateDoctorText(value);
  return surveys.map((survey) => html`
    <div class="patient-card ${survey.needsDoctor ? "needs-care" : ""}">
      <div class="patient-card__main">
        <strong>${escapeHtml(fullName(survey.patient))}</strong>
        <span>${escapeHtml(survey.patient?.clinic || "")}</span>
      </div>
      <div class="patient-card__meta">
        <span>АД ${survey.measurements.systolic}/${survey.measurements.diastolic}</span>
        <span>Сахар ${survey.measurements.glucoseLevel || "-"}</span>
        <span>FINDRISC ${survey.findrisc.score}</span>
        <span>${new Date(survey.createdAt).toLocaleDateString("ru-RU")}</span>
      </div>
      <div class="patient-card__footer">
        ${survey.needsDoctor ? `<span class="pill warn">${escapeHtml(t("К врачу"))}</span>` : `<span class="pill ok">${escapeHtml(t("Обычный риск"))}</span>`}
        <button data-action="select-survey" data-id="${survey.id}">${escapeHtml(t("Открыть"))}</button>
        <a href="/api/doctor/patients/${survey.id}/report.pdf"><button type="button" class="secondary">PDF</button></a>
      </div>
    </div>
  `).join("") || `<p class='muted'>${escapeHtml(t("Анкет пока нет"))}</p>`;
}

function doctorPatientSurveyForm() {
  const t = (value) => translateDoctorText(value);
  const doctorSelect = (label, name, options) => `<div class="form-row"><label>${escapeHtml(t(label))}</label><select name="${name}" required><option value="" selected disabled>${escapeHtml(t("Выберите ответ"))}</option>${options.map(([value, text]) => `<option value="${value}">${escapeHtml(t(text))}</option>`).join("")}</select></div>`;
  return html`
    <form class="form" id="doctorPatientSurveyForm">
      <h2>${escapeHtml(t("Добавить пациента"))}</h2>
      <p class="muted">${escapeHtml(t("Заполните анкету пациента. Пациент будет добавлен в картотеку вашей поликлиники."))}</p>
      <input type="hidden" name="clinic" value="${escapeHtml(state.doctor.doctor?.clinic || "")}" />
      <div class="notice ok">${escapeHtml(t("Поликлиника пациента"))}: <strong>${escapeHtml(state.doctor.doctor?.clinic || "")}</strong></div>
      <h3>${escapeHtml(t("Паспортная часть"))}</h3>
      <section class="grid two">
        ${input(t("Фамилия"), "lastName", true)}
        ${input(t("Имя"), "firstName", true)}
        ${input(t("Отчество"), "middleName", false)}
        ${input(t("Дата рождения"), "birthDate", true, "date")}
        ${doctorSelect("Пол", "sex", [["female", "Женский"], ["male", "Мужской"]])}
        <div class="form-row"><label>${escapeHtml(t("Возраст"))}</label><input name="age" inputmode="numeric" required readonly /></div>
        ${input(t("Телефон"), "phone", true)}
        ${input(t("Адрес"), "address", true)}
      </section>
      <h3>FINDRISC</h3>
      <p class="muted">${escapeHtml(t("Введите вес по весам. ИМТ рассчитается автоматически по весу и росту."))} ${escapeHtml(t("Окружность талии нужна для FINDRISC при любом способе определения веса."))}</p>
      <section class="grid two">
        ${surveyWeightFields(t)}
        ${doctorSelect("Физическая активность 30 минут в день", "activity", [["yes", "Да"], ["no", "Нет"]])}
        ${doctorSelect("Овощи/фрукты ежедневно", "vegetables", [["yes", "Да"], ["no", "Нет"]])}
        ${doctorSelect("Принимал препараты от давления", "bpMeds", [["no", "Нет"], ["yes", "Да"]])}
        ${doctorSelect("Когда-либо был высокий сахар", "highGlucose", [["no", "Нет"], ["yes", "Да"]])}
        ${doctorSelect("Диабет у родственников", "familyDiabetes", [["none", "Нет"], ["second", "Да, 2 линия"], ["first", "Да, 1 линия"]])}
      </section>
      <h3>${escapeHtml(t("Сердечно-сосудистый риск"))}</h3>
      <section class="grid two">
        ${doctorSelect("Курение", "smoker", [["no", "Нет"], ["yes", "Да"]])}
        ${input(t("Систолическое АД"), "systolic", true, "number")}
        ${input(t("Диастолическое АД"), "diastolic", true, "number")}
      </section>
      ${surveyRabitoFields(t)}
      ${input(t("Уровень сахара в крови, ммоль/л"), "glucoseLevel", true, "number")}
      <div class="actions">
        <button type="submit">${escapeHtml(t("Отправить анкету"))}</button>
        <button type="button" class="secondary" data-action="cancel-doctor-patient">${escapeHtml(t("Отмена"))}</button>
      </div>
      <div id="doctorPatientSurveyResult"></div>
    </form>
  `;
}

function doctorSurveySummary(survey) {
  const t = (value) => translateDoctorText(value);
  const patient = survey.patient || {};
  const measurements = survey.measurements || {};
  const reasons = (survey.referralReasons || []).map((reason) => `<li>${escapeHtml(translateDoctorDynamicText(reason))}</li>`).join("");
  return html`
    <section class="answer-details">
      <h3>${escapeHtml(t("Анкета медсестры"))}</h3>
      <div class="grid two">
        <div>
          <strong>${escapeHtml(t("Данные пациента"))}</strong>
          <div class="muted">${escapeHtml(t("Дата рождения"))}: ${escapeHtml(patient.birthDate || "-")}</div>
          <div class="muted">${escapeHtml(t("Пол"))}: ${escapeHtml(t(patient.sex === "male" ? "Мужской" : "Женский"))}</div>
          <div class="muted">${escapeHtml(t("Телефон"))}: ${escapeHtml(patient.phone || "-")}</div>
          <div class="muted">${escapeHtml(t("Адрес"))}: ${escapeHtml(patient.address || "-")}</div>
        </div>
        <div>
          <strong>${escapeHtml(t("Паспортная часть"))}</strong>
          <div class="muted">${escapeHtml(t("Возраст"))}: ${measurements.age || "-"}</div>
          <div class="muted">${escapeHtml(t("Рост, см"))}: ${measurements.height || "-"}</div>
          ${measurements.weight ? `<div class="muted">${escapeHtml(t("Вес по весам, кг"))}: ${measurements.weight}</div>` : ""}
          <div class="muted">${escapeHtml(t("Индекс массы тела"))}: ${measurements.bmi || "-"}</div>
          <div class="muted">${escapeHtml(t("Артериальное давление"))}: ${measurements.systolic || "-"}/${measurements.diastolic || "-"}</div>
          <div class="muted">FINDRISC: ${survey.findrisc?.score ?? "-"} (${escapeHtml(translateDoctorDynamicText(survey.findrisc?.level || "-"))})</div>
          <div class="muted">${escapeHtml(t("Сердечно-сосудистый риск"))}: ${survey.score2?.percent ?? "-"}% (${escapeHtml(translateDoctorDynamicText(survey.score2?.level || "-"))})</div>
          <div class="muted">${escapeHtml(t("Расчетный вес Rabito"))}: ${measurements.rabitoWeight || "-"} кг</div>
          <div class="muted">${escapeHtml(t("Уровень сахара в крови, ммоль/л"))}: ${measurements.glucoseLevel || "-"}</div>
        </div>
      </div>
      ${survey.needsDoctor ? `<div class="notice warn"><strong>${escapeHtml(t("Причины направления"))}</strong><ul>${reasons}</ul></div>` : ""}
    </section>
  `;
}

function doctorVisitForm(survey) {
  const t = (value) => translateDoctorText(value);
  return html`
    <section class="doctor-patient-detail">
      <h2>${escapeHtml(fullName(survey.patient))}</h2>
      ${state.doctorVisitNotice ? `<div class="notice ok" id="doctorVisitSavedNotice">${escapeHtml(translateDoctorText(state.doctorVisitNotice))}</div>` : ""}
      ${doctorSurveySummary(survey)}
      ${doctorTrendChart(survey)}
      ${doctorVisitHistory(survey.id)}
      ${historyPanel(survey.changeHistory || [])}
      ${doctorPendingLabs(survey.id)}
      ${doctorPatientTasks(survey.id)}
      <form class="form" id="visitForm">
        <h3>${escapeHtml(t("Повторный осмотр"))}</h3>
        <input type="hidden" name="surveyId" value="${survey.id}" />
        <section class="grid two">
          ${input(t("Вес по весам, кг"), "weight", true, "number")}
          ${input(t("Рост, см"), "height", true, "number")}
          <div class="form-row"><label>${escapeHtml(t("Индекс массы тела"))}</label><input name="bmi" inputmode="decimal" readonly required /></div>
          ${input(t("Уровень сахара в крови, ммоль/л"), "glucose", false, "number")}
          ${select(t("Тип сахара"), "glucoseType", [["fasting", t("Натощак")], ["random", t("Случайный замер")], ["postMeal", t("Через 2 часа после еды")], ["hba1c", "HbA1c"]])}
          <div class="form-row"><label>${escapeHtml(t("Диагноз"))}</label><input name="diagnosis" id="doctorDiagnosis" /></div>
          ${input(t("Повторное САД"), "systolic", true, "number")}
          ${input(t("Повторное ДАД"), "diastolic", true, "number")}
          ${input(t("Повторное обследование через сколько дней"), "followUpDays", false, "number")}
        </section>
      <div class="muted" id="glucoseDiagnosisHint"></div>
      <h3>${escapeHtml(t("Направление"))}</h3>
      <div class="checkbox-list">
        ${check("referrals", t("Эндокринолог"), "Эндокринолог")}
        ${check("referrals", t("Кардиолог"), "Кардиолог")}
      </div>
      <div class="form-row"><label>${escapeHtml(t("План лечения"))}</label><textarea name="treatmentPlan"></textarea></div>
      <h3>${escapeHtml(t("Дополнительные лабораторные исследования"))}</h3>
      <div id="doctorLabList" class="lab-list"></div>
      <div class="actions">
        <button type="button" class="secondary" id="addDoctorLab">${escapeHtml(t("Добавить анализ"))}</button>
      </div>
      <h3>${escapeHtml(t("Препараты для СД 2 типа"))}</h3>
      <div class="checkbox-list">${state.doctor.dictionaries.diabetesDrugs.map((item) => check("diabetesDrugs", item)).join("")}</div>
      <h3>${escapeHtml(t("Препараты для артериальной гипертензии"))}</h3>
      <div class="checkbox-list">${state.doctor.dictionaries.hypertensionDrugs.map((item) => check("hypertensionDrugs", item)).join("")}</div>
      <h3>${escapeHtml(t("Рекомендации пациенту"))}</h3>
      <div class="checkbox-list lifestyle-list">
        ${check("lifestyleRecommendations", t("Диета при сахарном диабете"), "diabetesDiet")}
        <div class="recommendation-panel" data-recommendation="diabetesDiet">
          <strong>${escapeHtml(t("Диета при сахарном диабете"))}</strong>
          <ul>${lifestyleRecommendations.diabetesDiet.map((item) => `<li>${escapeHtml(t(item))}</li>`).join("")}</ul>
        </div>
        ${check("lifestyleRecommendations", t("Специальные физические упражнения"), "physicalActivity")}
        <div class="recommendation-panel" data-recommendation="physicalActivity">
          <strong>${escapeHtml(t("Физическая активность"))}</strong>
          <ul>${lifestyleRecommendations.physicalActivity.map((item) => `<li>${escapeHtml(t(item))}</li>`).join("")}</ul>
        </div>
      </div>
      <button>${escapeHtml(t("Сохранить осмотр"))}</button>
      <div id="visitResult"></div>
    </form>
  </section>
  `;
}

function check(name, value, optionValue = value) {
  return `<label><input type="checkbox" name="${name}" value="${escapeHtml(optionValue)}" /> ${escapeHtml(value)}</label>`;
}

function doctorLabRow(testName = "Сахар крови", values = {}) {
  const t = (value) => translateDoctorText(value);
  const rowId = crypto.randomUUID();
  const fields = doctorLabTemplates[testName] || [];
  return html`
    <div class="card lab-row" data-lab-row="${rowId}">
      <section class="grid two">
        <label>${t('Статус')}<select class="doctorLabStatus"><option value="ordered" ${values.status !== 'received' ? 'selected' : ''}>${doctorLanguage() === 'tg' ? 'Таъин шудааст' : 'Назначен'}</option><option value="received" ${values.status === 'received' ? 'selected' : ''}>${doctorLanguage() === 'tg' ? 'Натиҷа гирифта шуд' : 'Результат получен'}</option></select></label>
        <label>${doctorLanguage() === 'tg' ? 'Санаи таъин' : 'Дата назначения'}<input class="doctorLabOrderedDate" type="date" value="${escapeHtml(values.orderedDate || new Date().toLocaleDateString('en-CA'))}" /></label>
        <label>${doctorLanguage() === 'tg' ? 'Санаи натиҷа' : 'Дата результата'}<input class="doctorLabResultDate" type="date" value="${escapeHtml(values.resultDate || '')}" /></label>
        <div class="form-row">
          <label>${escapeHtml(t("Лабораторный анализ"))}</label>
          <select class="doctorLabTest">
            ${doctorLabTests.map((item) => `<option value="${escapeHtml(item)}"${item === testName ? " selected" : ""}>${escapeHtml(t(item))}</option>`).join("")}
          </select>
        </div>
        <div class="form-row generic-lab-result ${fields.length ? "hidden" : ""}">
          <label>${escapeHtml(t("Результат"))}</label>
          <input class="doctorLabGenericResult" value="${escapeHtml(values.result || "")}" />
        </div>
      </section>
      <section class="grid two lab-template-fields">
        ${fields.map((field) => html`
          <div class="form-row">
            <label>${escapeHtml(t(field))}</label>
            <input class="doctorLabField" data-field="${escapeHtml(field)}" value="${escapeHtml(values[field] || "")}" />
          </div>
        `).join("")}
      </section>
      <button type="button" class="secondary danger" data-action="remove-lab-row">${escapeHtml(t("Удалить"))}</button>
    </div>
  `;
}

function renderDoctorLabRows() {
  const list = document.querySelector("#doctorLabList");
  if (!list) return;
  list.querySelectorAll(".doctorLabTest").forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest(".lab-row");
      row.outerHTML = doctorLabRow(select.value);
      bindDoctorLabControls();
      document.querySelector('#visitForm')?.dispatchEvent(new Event('draft-change'));
    });
  });
  list.querySelectorAll('[data-action="remove-lab-row"]').forEach((button) => {
    button.addEventListener("click", () => { button.closest(".lab-row")?.remove(); document.querySelector('#visitForm')?.dispatchEvent(new Event('draft-change')); });
  });
}

function bindDoctorLabControls() {
  renderDoctorLabRows();
}

function addDoctorLabRow(testName = "Сахар крови") {
  const list = document.querySelector("#doctorLabList");
  if (!list) return;
  list.insertAdjacentHTML("beforeend", doctorLabRow(testName));
  bindDoctorLabControls();
  document.querySelector('#visitForm')?.dispatchEvent(new Event('draft-change'));
}

function collectDoctorLabs() {
  return Array.from(document.querySelectorAll("#doctorLabList .lab-row")).map((row) => {
    const test = row.querySelector(".doctorLabTest")?.value || "";
    const fields = Object.fromEntries(Array.from(row.querySelectorAll(".doctorLabField")).map((input) => [input.dataset.field, input.value]));
    const result = row.querySelector(".doctorLabGenericResult")?.value || "";
    return { test, result, fields, status: row.querySelector('.doctorLabStatus')?.value || 'ordered',
      orderedDate: row.querySelector('.doctorLabOrderedDate')?.value || '', resultDate: row.querySelector('.doctorLabResultDate')?.value || '' };
  }).filter((item) => item.test);
}

function doctorPendingLabs(surveyId) {
  const items = (state.doctor.visits || []).filter(visit => visit.surveyId === surveyId).flatMap(visit =>
    (visit.laboratoryTests || []).map((lab, index) => ({ lab, visitId: visit.id, index })).filter(({lab}) => lab.status === 'ordered'));
  if (!items.length) return '';
  return `<section><h3>Ожидаемые результаты анализов</h3>${items.map(({ lab, visitId, index }) => `<div class="card pending-lab"><strong>${escapeHtml(lab.test)}</strong><p>Назначен: ${escapeHtml(lab.orderedDate || 'дата не указана')}</p><label>Результат<input data-lab-result maxlength="200"/></label><label>Дата результата<input type="date" data-lab-date /></label><button type="button" data-save-lab="${escapeHtml(visitId)}" data-index="${index}">Сохранить результат</button><span role="status" data-lab-message></span></div>`).join('')}</section>`;
}

function bindDoctorVisit() {
  const form = document.querySelector("#visitForm");
  if (!form) return;
  if (!form.elements.weight || !form.elements.height || !form.elements.glucose || !form.elements.glucoseType) return;
  const calculateBmi = () => {
    const weight = Number(String(form.elements.weight?.value || "").replace(",", "."));
    const heightCm = Number(String(form.elements.height?.value || "").replace(",", "."));
    const heightM = heightCm / 100;
    if (form.elements.bmi) {
      form.elements.bmi.value = Number.isFinite(weight) && Number.isFinite(heightM) && weight > 0 && heightM > 0
        ? (weight / (heightM * heightM)).toFixed(1)
        : "";
    }
  };
  ["input", "change", "keyup", "paste"].forEach((evt) => {
    form.elements.weight.addEventListener(evt, calculateBmi);
    form.elements.height.addEventListener(evt, calculateBmi);
  });
  const updateDiagnosis = () => {
    const result = diagnosisByGlucose(form.elements.glucose.value, form.elements.glucoseType.value);
    const diagnosis = form.elements.diagnosis;
    const translated = translateDoctorText(result.diagnosis || "");
    if (result.diagnosis) {
      diagnosis.value = translated;
      diagnosis.dataset.autoDiagnosis = translated;
    } else if (diagnosis.dataset.autoDiagnosis && diagnosis.value === diagnosis.dataset.autoDiagnosis) {
      diagnosis.value = "";
      diagnosis.dataset.autoDiagnosis = "";
    }
    const hint = document.querySelector("#glucoseDiagnosisHint");
    if (hint) hint.innerHTML = result.diagnosis ? `${escapeHtml(translateDoctorText("Автоматически по сахару"))}: <span class="pill ${result.level}">${escapeHtml(translated)}</span>` : "";
  };
  ["input", "change", "keyup", "paste"].forEach((evt) => {
    form.elements.glucose.addEventListener(evt, updateDiagnosis);
  });
  form.elements.glucoseType.addEventListener("change", updateDiagnosis);
  document.querySelector("#addDoctorLab")?.addEventListener("click", () => addDoctorLabRow());
  bindDoctorLabControls();
  form.querySelectorAll('input[name="lifestyleRecommendations"]').forEach((input) => {
    input.addEventListener("change", updateLifestyleRecommendationPanels);
  });
  updateLifestyleRecommendationPanels();
  form.addEventListener('draft-restored', () => { calculateBmi(); updateLifestyleRecommendationPanels(); });
  calculateBmi();
  updateDiagnosis();
  form.querySelectorAll('[data-save-lab]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('.pending-lab');
    button.disabled = true;
    try {
      const { visit } = await api('/api/doctor/lab-result', { method: 'PUT', body: JSON.stringify({ visitId: button.dataset.saveLab, index: Number(button.dataset.index),
        result: card.querySelector('[data-lab-result]').value, resultDate: card.querySelector('[data-lab-date]').value }) });
      state.doctor.visits = state.doctor.visits.map(item => item.id === visit.id ? visit : item);
      card.querySelector('[data-lab-message]').textContent = 'Результат сохранён';
    } catch (error) { card.querySelector('[data-lab-message]').textContent = error.message; button.disabled = false; }
  }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button:not([type="button"])');
    if (submitButton) submitButton.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    data.referrals = new FormData(form).getAll("referrals");
    data.diabetesDrugs = new FormData(form).getAll("diabetesDrugs");
    data.hypertensionDrugs = new FormData(form).getAll("hypertensionDrugs");
    data.lifestyleRecommendations = new FormData(form).getAll("lifestyleRecommendations");
    data.laboratoryTests = collectDoctorLabs();
    try {
      const result = await api("/api/doctor/visits", { method: "POST", body: JSON.stringify(data) });
      state.doctor.visits = [result.visit, ...(state.doctor.visits || [])];
      if (result.task) state.doctor.tasks = [...(state.doctor.tasks || []), result.task];
      form.reset();
      state.lastSavedDoctorVisitId = result.visit.id;
      state.doctorVisitNotice = "Осмотр сохранён. Лекарства и анализы показаны ниже в разделе «Предыдущие осмотры».";
      renderDoctor();
      setTimeout(() => document.querySelector("#doctorVisitSavedNotice")?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
      updateOfflineDoctorStatus();
    } catch (error) {
      if (!shouldQueueOffline(error)) {
        document.querySelector("#visitResult").innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
        if (submitButton) submitButton.disabled = false;
        return;
      }
      saveOfflineDoctorAction({ type: "visit", data });
      document.querySelector("#visitResult").innerHTML = `<div class="notice warn">${escapeHtml(translateDoctorText("Интернет недоступен или сервер не ответил. Запись сохранена на этом устройстве и будет отправлена через синхронизацию."))}</div>`;
      form.reset();
      updateLifestyleRecommendationPanels();
      updateOfflineDoctorStatus();
    }
  });
}

function bindDoctorAccountForm() {
  const form = document.querySelector("#doctorAccountForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api("/api/doctor/account", { method: "PUT", body: JSON.stringify(data) });
      if (result.currentSessionEnded) {
        alert(translateDoctorText("Пароль изменён. Для безопасности войдите заново."));
        window.location.href = DOCTOR_APP_PATH;
        return;
      }
      state.doctor.doctor = result.doctor;
      document.querySelector("#doctorAccountResult").innerHTML = `<div class="notice ok">${escapeHtml(translateDoctorText("Логин и пароль обновлены."))}</div>`;
      form.elements.accessKey.value = "";
    } catch (error) {
      document.querySelector("#doctorAccountResult").innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
    }
  });
}

function bindDoctorTaskForms() {
  document.querySelectorAll("[data-doctor-task-form]").forEach((form) => {
    const dueDate = form.elements.dueDate;
    if (dueDate && !dueDate.value) dueDate.value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(form));
        data.surveyId = form.dataset.surveyId;
        const result = await api("/api/doctor/tasks", { method: "POST", body: JSON.stringify(data) });
        state.doctor.tasks = [...(state.doctor.tasks || []), result.task];
        renderDoctor();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function bindDoctorPatientSurvey() {
  const form = document.querySelector("#doctorPatientSurveyForm");
  if (!form) return;
  bindNurseSurveyCalculations(form);
  bindBirthDateAge(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const { survey } = await api("/api/doctor/surveys", { method: "POST", body: JSON.stringify(data) });
      clearDraft(form);
      state.doctor.surveys = [survey, ...state.doctor.surveys.filter((item) => item.id !== survey.id)];
      state.selectedSurvey = survey;
      state.doctorMode = "visit";
      renderDoctor();
      setTimeout(() => document.querySelector("#doctorPrimaryPanel")?.scrollIntoView({ block: "start" }), 0);
    } catch (error) {
      if (error?.status === 409 || String(error?.message || "").includes("уже существует")) {
        const resultEl = document.querySelector("#doctorPatientSurveyResult");
        if (resultEl) {
          resultEl.innerHTML = `
            <div class="notice warn">
              <p>⚠️ <strong>${escapeHtml(error.message)}</strong></p>
              <button type="button" class="btn secondary" id="forceSubmitDoctorSurveyBtn" style="margin-top:8px;">➕ Сохранить как нового пациента</button>
            </div>
          `;
          document.querySelector("#forceSubmitDoctorSurveyBtn")?.addEventListener("click", async () => {
            try {
              const forcedData = { ...data, allowDuplicate: true };
              const { survey: forcedSurvey } = await api("/api/doctor/surveys", { method: "POST", body: JSON.stringify(forcedData) });
              clearDraft(form);
              state.doctor.surveys = [forcedSurvey, ...state.doctor.surveys.filter((item) => item.id !== forcedSurvey.id)];
              state.selectedSurvey = forcedSurvey;
              state.doctorMode = "visit";
              renderDoctor();
              setTimeout(() => document.querySelector("#doctorPrimaryPanel")?.scrollIntoView({ block: "start" }), 0);
            } catch (err2) {
              resultEl.innerHTML = `<div class="notice danger">${escapeHtml(err2.message)}</div>`;
            }
          });
        }
        return;
      }
      if (!shouldQueueOffline(error)) {
        document.querySelector("#doctorPatientSurveyResult").innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
        return;
      }
      const localSurveyId = `local-${crypto.randomUUID()}`;
      const localSurvey = {
        id: localSurveyId,
        patient: {
          lastName: data.lastName,
          firstName: data.firstName,
          middleName: data.middleName,
          birthDate: data.birthDate,
          phone: data.phone,
          address: data.address,
          clinic: state.doctor.doctor?.clinic || data.clinic,
          sex: data.sex
        },
        measurements: {
          age: Number(data.age || 0),
          height: Number(String(data.height || 0).replace(",", ".")),
          weight: Number(String(data.weight || 0).replace(",", ".")),
          weightSource: data.weight ? "measured" : "rabito",
          bmi: Number(data.bmi || 0),
          systolic: Number(data.systolic || 0),
          diastolic: Number(data.diastolic || 0),
          arm: Number(data.arm || 0),
          rabitoWaist: Number(data.rabitoWaist || 0),
          calf: Number(data.calf || 0),
          rabitoWeight: Number(form.elements.rabitoWeightPreview.value || 0),
          glucoseLevel: Number(data.glucoseLevel || 0)
        },
        findrisc: { score: "-", level: "-" },
        score2: { percent: "-", level: "-" },
        referralReasons: [],
        needsDoctor: false,
        createdAt: new Date().toISOString(),
        offline: true
      };
      saveOfflineDoctorAction({ type: "survey", localSurveyId, data });
      clearDraft(form);
      state.doctor.surveys = [localSurvey, ...state.doctor.surveys];
      state.selectedSurvey = localSurvey;
      state.doctorMode = "visit";
      renderDoctor();
      setTimeout(() => document.querySelector("#doctorPrimaryPanel")?.scrollIntoView({ block: "start" }), 0);
    }
  });
}

function updateLifestyleRecommendationPanels() {
  document.querySelectorAll(".recommendation-panel").forEach((panel) => {
    const key = panel.dataset.recommendation;
    const checked = document.querySelector(`input[name="lifestyleRecommendations"][value="${key}"]`)?.checked;
    panel.classList.toggle("visible", Boolean(checked));
  });
}

boot().catch((error) => {
  setPage(`<main class="login"><section class="panel"><h1>Сервис временно недоступен</h1><p>${escapeHtml(error.message || "Не удалось загрузить данные")}</p><button type="button" onclick="location.reload()">Повторить</button></section></main>`);
});












```
