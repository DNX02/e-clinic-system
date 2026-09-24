import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = 34322;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = process.env.TUTORIAL_FRAMES || "artifacts/doctor-tutorial-frames";
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-doctor-tutorial-"));
const adminPassword = "TutorialAdmin123";
const doctorKey = "TutorialDoctor123";
await mkdir(outputDir, { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: adminPassword },
  stdio: "ignore"
});

async function request(path, { method = "GET", body, cookie = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] || cookie };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Tutorial server did not start");
}

let browser;
try {
  await waitForServer();
  let admin = await request("/api/login/admin", { method: "POST", body: { username: "admin", password: adminPassword } });
  await request("/api/admin/doctors", {
    method: "POST", cookie: admin.cookie,
    body: { fullName: "Врач Демо", login: "doctor-demo", accessKey: doctorKey, passport: "Учебная запись", clinic: "Поликлиника №1", specialty: "Семейный врач", experienceYears: 5 }
  });
  const patient = {
    nurseName: "Медсестра Демо", lastName: "Иванова", firstName: "Анна", middleName: "Учебная", birthDate: "1966-01-01",
    phone: "900000000", address: "Учебный пример", clinic: "Поликлиника №1", sex: "female", age: 60,
    height: 160, weight: 77, bmi: 30.1, systolic: 140, diastolic: 90, rabitoWaist: 89,
    activity: "no", vegetables: "no", bpMeds: "yes", highGlucose: "no", familyDiabetes: "none", smoker: "no"
  };
  const createdSurvey = await request("/api/nurse-surveys", { method: "POST", body: patient });

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const shot = (name) => page.screenshot({ path: `${outputDir}/${name}.png` });

  await page.goto(`${baseUrl}/app-2-doctor`, { waitUntil: "networkidle" });
  await page.locator('[data-doctor-lang-choice="ru"]').click();
  await page.locator('[name="login"]').fill("doctor-demo");
  await page.locator('[name="accessKey"]').fill(doctorKey);
  await shot("01-login");
  await page.locator("#doctorLogin button").click();
  await page.waitForURL("**/app-2-doctor");
  await page.waitForSelector("#patientSearch");
  const languageChoice = page.locator('[data-doctor-lang-choice="ru"]');
  if (await languageChoice.isVisible().catch(() => false)) await languageChoice.click();
  await shot("02-patients");

  await page.locator("#patientSearch").fill("Иванова");
  await page.waitForTimeout(300);
  await shot("03-search");
  await page.locator('[data-action="select-survey"]').first().click();
  await page.waitForSelector("#visitForm");
  await shot("04-card");

  const fill = async (name, value) => page.locator(`[name="${name}"]`).last().fill(String(value));
  await fill("weight", "77");
  await fill("height", "160");
  await fill("glucose", "7.2");
  await page.locator('[name="glucoseType"]').last().selectOption("fasting");
  await fill("diagnosis", "Сахарный диабет");
  await fill("systolic", "138");
  await fill("diastolic", "86");
  await fill("followUpDays", "14");
  await page.locator('[name="glucose"]').last().scrollIntoViewIfNeeded();
  await shot("05-measurements");

  await page.locator('[name="referrals"][value="Эндокринолог"]').check();
  await page.locator('[name="treatmentPlan"]').fill("Контроль сахара крови и повторный осмотр");
  await page.locator('[name="lifestyleRecommendations"][value="diabetesDiet"]').check();
  await page.locator('[name="treatmentPlan"]').scrollIntoViewIfNeeded();
  await shot("06-plan");

  await page.getByRole("button", { name: "Сохранить осмотр" }).scrollIntoViewIfNeeded();
  await shot("07-save");
  await page.evaluate(async ({ surveyId }) => {
    const response = await fetch("/api/doctor/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surveyId, weight: 77, height: 160, bmi: 30.1, glucose: 7.2, glucoseType: "fasting",
        diagnosis: "Сахарный диабет", systolic: 138, diastolic: 86, followUpDays: 14,
        referrals: ["Эндокринолог"], treatmentPlan: "Контроль сахара крови и повторный осмотр",
        laboratoryTests: [], diabetesDrugs: [], hypertensionDrugs: [], lifestyleRecommendations: ["diabetesDiet"]
      })
    });
    if (!response.ok) throw new Error("Не удалось сохранить учебный осмотр");
    document.querySelector("#visitResult").innerHTML = '<div class="notice ok">Осмотр сохранён и отправлен администратору.</div>';
  }, { surveyId: createdSurvey.payload.survey.id });
  await page.waitForSelector("#visitResult .notice", { timeout: 10000 });
  await page.locator("#visitResult").scrollIntoViewIfNeeded();
  await shot("08-result");
  console.log(`Doctor tutorial screenshots created in ${outputDir}`);
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
