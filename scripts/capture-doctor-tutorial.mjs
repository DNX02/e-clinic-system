import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = 34322;
const baseUrl = `http://127.0.0.1:${port}`;
const language = process.env.TUTORIAL_LANGUAGE || "ru";
const outputDir = process.env.TUTORIAL_FRAMES || `artifacts/doctor-tutorial-frames${language === "ru" ? "" : `-${language}`}`;
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
    body: { fullName: language === "tg" ? "Духтури омӯзишӣ" : "Врач Демо", login: "doctor-demo", accessKey: doctorKey, passport: language === "tg" ? "Сабти омӯзишӣ" : "Учебная запись", clinic: "Поликлиника №1", specialty: language === "tg" ? "Табиби оилавӣ" : "Семейный врач", experienceYears: 5 }
  });
  const patient = {
    nurseName: language === "tg" ? "Ҳамшираи омӯзишӣ" : "Медсестра Демо", lastName: "Иванова", firstName: "Анна", middleName: language === "tg" ? "Омӯзишӣ" : "Учебная", birthDate: "1966-01-01",
    phone: "900000000", address: language === "tg" ? "Намунаи омӯзишӣ" : "Учебный пример", clinic: "Поликлиника №1", sex: "female", age: 60,
    height: 160, weight: 77, bmi: 30.1, systolic: 140, diastolic: 90, rabitoWaist: 89,
    activity: "no", vegetables: "no", bpMeds: "yes", highGlucose: "no", familyDiabetes: "none", smoker: "no"
  };
  const createdSurvey = await request("/api/nurse-surveys", { method: "POST", body: patient });

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const shot = (name) => page.screenshot({ path: `${outputDir}/${name}.png` });

  await page.goto(`${baseUrl}/app-2-doctor`, { waitUntil: "networkidle" });
  await page.locator(`[data-doctor-lang-choice="${language}"]`).click();
  await page.locator('[name="login"]').fill("doctor-demo");
  await page.locator('[name="accessKey"]').fill(doctorKey);
  await shot("01-login");
  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/login/doctor")),
    page.locator("#doctorLogin button").click()
  ]);
  if (!loginResponse.ok()) throw new Error(`Doctor tutorial login failed: ${await loginResponse.text()}`);
  await page.waitForSelector("#patientSearch");
  const languageChoice = page.locator(`[data-doctor-lang-choice="${language}"]`);
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
  await fill("diagnosis", language === "tg" ? "Диабети қанд" : "Сахарный диабет");
  await fill("systolic", "138");
  await fill("diastolic", "86");
  await fill("followUpDays", "14");
  await page.locator('[name="glucose"]').last().scrollIntoViewIfNeeded();
  await shot("05-measurements");

  await page.locator('[name="referrals"][value="Эндокринолог"]').check();
  await page.locator('[name="treatmentPlan"]').fill(language === "tg" ? "Назорати қанди хун ва муоинаи такрорӣ" : "Контроль сахара крови и повторный осмотр");
  await page.locator('[name="lifestyleRecommendations"][value="diabetesDiet"]').check();
  await page.locator('[name="treatmentPlan"]').scrollIntoViewIfNeeded();
  await shot("06-plan");

  await page.locator("#visitForm button").last().scrollIntoViewIfNeeded();
  await shot("07-save");
  await page.evaluate(async ({ surveyId, visitDiagnosis, visitPlan, successMessage }) => {
    const response = await fetch("/api/doctor/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surveyId, weight: 77, height: 160, bmi: 30.1, glucose: 7.2, glucoseType: "fasting",
        diagnosis: visitDiagnosis, systolic: 138, diastolic: 86, followUpDays: 14,
        referrals: ["Эндокринолог"], treatmentPlan: visitPlan,
        laboratoryTests: [], diabetesDrugs: [], hypertensionDrugs: [], lifestyleRecommendations: ["diabetesDiet"]
      })
    });
    if (!response.ok) throw new Error("Не удалось сохранить учебный осмотр");
    document.querySelector("#visitResult").innerHTML = `<div class="notice ok">${successMessage}</div>`;
  }, {
    surveyId: createdSurvey.payload.survey.id,
    visitDiagnosis: language === "tg" ? "Диабети қанд" : "Сахарный диабет",
    visitPlan: language === "tg" ? "Назорати қанди хун ва муоинаи такрорӣ" : "Контроль сахара крови и повторный осмотр",
    successMessage: language === "tg" ? "Муоина сабт ва ба маъмур фиристода шуд." : "Осмотр сохранён и отправлен администратору."
  });
  await page.waitForSelector("#visitResult .notice", { timeout: 10000 });
  await page.locator("#visitResult").scrollIntoViewIfNeeded();
  await shot("08-result");
  console.log(`Doctor tutorial screenshots created in ${outputDir}`);
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
