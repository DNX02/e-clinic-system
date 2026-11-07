import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 32988;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-homonym-test-"));
const adminPassword = "TestAdmin1234";

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
  console.log("1. Testing nurse survey creation with identical name but DIFFERENT birth year (homonyms)...");

  const patient1 = {
    lastName: "Олимов",
    firstName: "Муҳаммад",
    middleName: "",
    birthDate: "1978-05-20", // birth year 1978
    phone: "+992 90 404 4829",
    clinic: "Поликлиника №1",
    nurseName: "Тестовая Медсестра",
    sex: "male",
    age: 48,
    weight: 75,
    height: 175,
    systolic: 120,
    diastolic: 80,
    rabitoWaist: 85,
    activity: "yes",
    vegetables: "yes",
    bpMeds: "no",
    highGlucose: "no",
    familyDiabetes: "none",
    smoker: "no"
  };

  const res1 = await request(session(), "/api/nurse-surveys", { method: "POST", expected: 201, body: patient1 });
  assert.ok(res1.survey?.id, "First patient should be created");

  console.log("2. Creating second patient with SAME name & phone, but DIFFERENT birth year (1995)...");
  const patient2 = {
    ...patient1,
    birthDate: "1995-10-15", // birth year 1995
    age: 31
  };

  const res2 = await request(session(), "/api/nurse-surveys", { method: "POST", expected: 201, body: patient2 });
  assert.ok(res2.survey?.id, "Homonym with different birth year should be created without duplicate error");
  assert.notEqual(res1.survey.id, res2.survey.id, "Surveys must have different IDs");

  console.log("3. Submitting duplicate (SAME name, SAME birth year 1978, SAME phone) without allowDuplicate...");
  const resDuplicate = await request(session(), "/api/nurse-surveys", { method: "POST", expected: 409, body: patient1 });
  assert.equal(resDuplicate.duplicate, true);
  assert.equal(resDuplicate.duplicateId, res1.survey.id);

  console.log("4. Submitting duplicate WITH allowDuplicate: true...");
  const resForced = await request(session(), "/api/nurse-surveys", {
    method: "POST",
    expected: 201,
    body: { ...patient1, allowDuplicate: true }
  });
  assert.ok(resForced.survey?.id, "Forced submission should succeed with 201");
  assert.notEqual(resForced.survey.id, res1.survey.id);

  console.log("5. Testing doctor workspace patient homonyms...");
  const admin = session();
  await request(admin, "/api/login/admin", { method: "POST", body: { username: "admin", password: adminPassword } });
  const doctorAccount = {
    fullName: "Тестовый Врач",
    login: "test-doctor-homonym",
    accessKey: "DoctorPass123",
    passport: "DOC123",
    clinic: "Поликлиника №1",
    specialty: "Терапевт",
    experienceYears: 5
  };
  await request(admin, "/api/admin/doctors", { method: "POST", expected: 201, body: doctorAccount });
  const doctorSession = session();
  await request(doctorSession, "/api/login/doctor", { method: "POST", body: { login: doctorAccount.login, accessKey: doctorAccount.accessKey } });

  const docPatient1 = {
    ...patient1,
    lastName: "Рахимов",
    firstName: "Собир",
    birthDate: "1980-01-01",
    phone: "+992 91 111 2233"
  };
  const docRes1 = await request(doctorSession, "/api/doctor/surveys", { method: "POST", expected: 201, body: docPatient1 });
  assert.ok(docRes1.survey?.id);

  const docPatient2 = {
    ...docPatient1,
    birthDate: "1999-12-31" // Different birth year
  };
  const docRes2 = await request(doctorSession, "/api/doctor/surveys", { method: "POST", expected: 201, body: docPatient2 });
  assert.ok(docRes2.survey?.id, "Doctor homonym with different birth year should succeed");

  const docResDup = await request(doctorSession, "/api/doctor/surveys", { method: "POST", expected: 409, body: docPatient1 });
  assert.equal(docResDup.duplicate, true);

  const docResForce = await request(doctorSession, "/api/doctor/surveys", { method: "POST", expected: 201, body: { ...docPatient1, allowDuplicate: true } });
  assert.ok(docResForce.survey?.id);

  console.log("All homonym and duplicate tests PASSED successfully!");
} finally {
  server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
