// Captures phone screenshots for the nurse and doctor training videos (Tajik UI) on a throwaway
// server with demo data only. For every scene it also records the element to highlight.
// Run: node scripts/capture-tutorials.mjs [outputDir]   then   python3 scripts/render-tutorials.py
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const outputDir = process.argv[2] || "artifacts/tutorials";
const port = 34323;
const base = `http://127.0.0.1:${port}`;
const adminPassword = "TutorialAdmin123";
const doctorKey = "TutorialDoctor123";
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-tutorials-"));
await mkdir(outputDir, { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: adminPassword },
  stdio: "ignore"
});
const api = async (path, { method = "POST", body, cookie } = {}) => {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { data, cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
};

const demoPatient = (overrides) => ({
  nurseName: "Ҳамшира Намуна", firstName: "Нигина", middleName: "Намуна", birthDate: "1964-03-12", sex: "female",
  phone: "+992900000001", address: "Душанбе, намуна", clinic: "Поликлиника №1", age: 62, height: 158, weight: 82, rabitoWaist: 98,
  activity: "no", vegetables: "no", bpMeds: "yes", highGlucose: "yes", familyDiabetes: "first", smoker: "no", systolic: 150, diastolic: 95,
  ...overrides
});

let browser;
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const admin = await api("/api/login/admin", { body: { username: "admin", password: adminPassword } });
  await api("/api/admin/doctors", { cookie: admin.cookie, body: { fullName: "Духтур Намуна", login: "doctor-demo", accessKey: doctorKey, passport: "Намуна", clinic: "Поликлиника №1", specialty: "Табиби оилавӣ", experienceYears: 5 } });
  for (const [i, lastName] of ["Каримова", "Назаров", "Шарипова"].entries()) {
    await api("/api/nurse-surveys", { body: demoPatient({ lastName, firstName: ["Нигина", "Фарход", "Зарина"][i], phone: `+99290000000${i + 2}`, sex: i === 1 ? "male" : "female" }) });
  }

  browser = await chromium.launch();
  const scenes = { nurse: [], doctor: [] };

  // Screenshot the viewport with the target centred, remembering where it is for the highlight ring.
  // `target` may be a list of selectors: the ring then surrounds all of them.
  const capture = async (page, app, name, target, { center = true } = {}) => {
    let box = null;
    const targets = target ? [target].flat() : [];
    if (targets.length) {
      const first = page.locator(targets[0]).first();
      await first.waitFor({ state: "visible", timeout: 10000 });
      if (center) await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
    }
    // No leftover focus frame from the last typed field: only our highlight should stand out.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(350);
    for (const selector of targets) {
      const b = await page.locator(selector).first().boundingBox();
      if (!b) continue;
      box = box
        ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), width: Math.max(box.x + box.width, b.x + b.width) - Math.min(box.x, b.x), height: Math.max(box.y + box.height, b.y + b.height) - Math.min(box.y, b.y) }
        : b;
    }
    await page.screenshot({ path: `${outputDir}/${app}-${name}.png` });
    scenes[app].push({ name, file: `${app}-${name}.png`, box });
  };

  // ---------- Nurse ----------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const nurse = await phone.newPage();
  await nurse.goto(`${base}/app-3-patient-survey`, { waitUntil: "networkidle" });
  await capture(nurse, "nurse", "01-language", "[data-survey-lang-choice=tg]", { center: false });
  await nurse.locator("[data-survey-lang-choice=tg]").click();
  await nurse.waitForSelector("#surveyForm");
  const fill = async (name, value) => nurse.locator(`#surveyForm [name="${name}"]`).fill(String(value));
  const select = async (name, value) => nurse.locator(`#surveyForm [name="${name}"]`).selectOption(String(value));
  const row = (name) => `#surveyForm .form-row:has([name="${name}"])`;
  await fill("nurseName", "Ҳамшира Намуна");
  await capture(nurse, "nurse", "02-nurse-name", row("nurseName"));
  await fill("lastName", "Раҳимов");
  await fill("firstName", "Алишер");
  await fill("middleName", "Намуна");
  await fill("birthDate", "1966-05-05");
  await nurse.locator('#surveyForm [name="birthDate"]').dispatchEvent("change");
  await select("sex", "male");
  await fill("phone", "+992900111222");
  await fill("address", "Душанбе, намуна");
  await capture(nurse, "nurse", "03-patient", "#surveyForm section.grid.two:has([name=lastName])");
  await select("clinic", "Поликлиника №1");
  await capture(nurse, "nurse", "04-clinic", row("clinic"));
  await fill("height", "170");
  await fill("weight", "95");
  await nurse.locator('#surveyForm [name="weight"]').dispatchEvent("input");
  await fill("rabitoWaist", "110");
  await capture(nurse, "nurse", "05-measurements", `#surveyForm section.grid.two:has([name=height])`);
  await select("activity", "no");
  await select("vegetables", "no");
  await select("bpMeds", "yes");
  await select("highGlucose", "yes");
  await select("familyDiabetes", "first");
  await capture(nurse, "nurse", "06-findrisc", `#surveyForm .form-row:has([name=activity])`);
  await select("smoker", "yes");
  await fill("systolic", "150");
  await fill("diastolic", "95");
  await capture(nurse, "nurse", "07-pressure", `#surveyForm section.grid.two:has([name=smoker])`);
  await capture(nurse, "nurse", "08-submit", '#surveyForm button[type="submit"]');
  await nurse.locator('#surveyForm button[type="submit"]').click();
  await nurse.waitForFunction(() => /FINDRISC/.test(document.querySelector("#surveyResult")?.innerText || ""), null, { timeout: 10000 });
  await capture(nurse, "nurse", "09-result", "#surveyResult .notice");

  // Offline: the next survey stays on the phone, then goes out with the sync button.
  await nurse.goto(`${base}/app-3-patient-survey`, { waitUntil: "networkidle" });
  await nurse.locator("[data-survey-lang-choice=tg]").click({ timeout: 3000 }).catch(() => {});
  await nurse.waitForSelector("#surveyForm");
  for (const [name, value] of Object.entries({ nurseName: "Ҳамшира Намуна", lastName: "Сафарова", firstName: "Мадина", birthDate: "1972-02-02", phone: "+992900333444", address: "Душанбе, намуна", height: "160", weight: "70", rabitoWaist: "88", systolic: "125", diastolic: "80" })) await fill(name, value);
  for (const [name, value] of Object.entries({ sex: "female", clinic: "Поликлиника №1", activity: "yes", vegetables: "yes", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no" })) await select(name, value);
  await nurse.locator('#surveyForm [name="birthDate"]').dispatchEvent("change");
  await phone.setOffline(true);
  await nurse.locator('#surveyForm button[type="submit"]').click();
  await nurse.waitForFunction(() => /1/.test(document.querySelector("#syncSurveysStatus")?.innerText || ""), null, { timeout: 10000 });
  await capture(nurse, "nurse", "10-offline", "#syncSurveysStatus");
  await nurse.locator("#toggleOfflineSurveysDrawer").click();
  await capture(nurse, "nurse", "11-saved-list", "#offlineSurveysDrawer");
  await capture(nurse, "nurse", "12-sync-button", "#syncSurveysButton");
  await phone.setOffline(false);
  await nurse.waitForFunction(() => !/: *1/.test(document.querySelector("#syncSurveysStatus")?.innerText || "x: 1"), null, { timeout: 15000 });
  await capture(nurse, "nurse", "13-synced", "#syncSurveysStatus");

  // ---------- Doctor ----------
  const doctorPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const doctor = await doctorPhone.newPage();
  await doctor.goto(`${base}/app-2-doctor`, { waitUntil: "networkidle" });
  await doctor.locator("[data-doctor-lang-choice=tg]").click({ timeout: 3000 }).catch(() => {});
  await doctor.locator('#doctorLogin [name="login"]').fill("doctor-demo");
  await doctor.locator('#doctorLogin [name="accessKey"]').fill(doctorKey);
  await capture(doctor, "doctor", "01-login", "#doctorLogin");
  await doctor.click("#doctorLogin button");
  await doctor.waitForSelector("#patientSearch");
  await doctor.locator("[data-doctor-lang-choice=tg]").click({ timeout: 2000 }).catch(() => {});
  await doctor.evaluate(() => window.scrollTo(0, 0));
  await capture(doctor, "doctor", "02-counters", ".doctor-hero-metrics", { center: false });
  await doctor.locator("#patientSearch").fill("Раҳимов");
  await doctor.waitForTimeout(600);
  await capture(doctor, "doctor", "03-search", "#patientSearch");
  await capture(doctor, "doctor", "04-open", '.patient-card:has-text("Раҳимов") [data-action="select-survey"]');
  await doctor.locator('.patient-card:has-text("Раҳимов") [data-action="select-survey"]').first().click();
  await doctor.waitForSelector("#visitForm");
  await capture(doctor, "doctor", "05-card", ".doctor-patient-detail .notice.warn");
  const dfill = async (name, value) => doctor.locator(`#visitForm [name="${name}"]`).fill(String(value));
  await dfill("weight", "95");
  await dfill("height", "170");
  await dfill("glucose", "7.4");
  await doctor.locator('#visitForm [name="glucose"]').dispatchEvent("input");
  await capture(doctor, "doctor", "06-sugar", [`#visitForm .form-row:has([name=glucose])`, `#visitForm .form-row:has([name=diagnosis])`]);
  await dfill("systolic", "148");
  await dfill("diastolic", "92");
  await dfill("followUpDays", "14");
  await capture(doctor, "doctor", "07-pressure", [`#visitForm .form-row:has([name=systolic])`, `#visitForm .form-row:has([name=followUpDays])`]);
  await doctor.locator('#visitForm [name="referrals"]').first().check();
  await doctor.locator('#visitForm [name="treatmentPlan"]').fill("Назорати қанди хун, парҳез, муоинаи такрорӣ пас аз 14 рӯз");
  await capture(doctor, "doctor", "08-plan", `#visitForm .form-row:has([name=treatmentPlan])`);
  await capture(doctor, "doctor", "09-save", '#visitForm button:not([type="button"])');
  await doctor.click('#visitForm button:not([type="button"])');
  await doctor.waitForSelector("#doctorVisitSavedNotice", { timeout: 10000 });
  await doctor.evaluate(() => window.scrollTo(0, 0));
  await capture(doctor, "doctor", "10-saved", ".doctor-hero-metrics > div:nth-child(3)", { center: false });
  await capture(doctor, "doctor", "11-add-button", '[data-action="add-doctor-patient"]');
  await doctor.click('[data-action="add-doctor-patient"]');
  await doctor.waitForSelector("#doctorPatientSurveyForm");
  const pfill = async (name, value) => doctor.locator(`#doctorPatientSurveyForm [name="${name}"]`).fill(String(value));
  const pselect = async (name, value) => doctor.locator(`#doctorPatientSurveyForm [name="${name}"]`).selectOption(String(value));
  for (const [name, value] of Object.entries({ lastName: "Ҳасанов", firstName: "Сино", birthDate: "1969-09-09", phone: "+992900555666", address: "Душанбе, намуна", height: "172", weight: "88", rabitoWaist: "101", systolic: "142", diastolic: "88", glucoseLevel: "6.8" })) await pfill(name, value);
  for (const [name, value] of Object.entries({ sex: "male", activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "second", smoker: "no" })) await pselect(name, value);
  await doctor.locator('#doctorPatientSurveyForm [name="birthDate"]').dispatchEvent("change");
  const missing = await doctor.evaluate(() => [...document.querySelectorAll("#doctorPatientSurveyForm :invalid")].map((el) => el.name).filter(Boolean));
  if (missing.length) throw new Error(`Doctor add-patient form: unfilled fields ${missing.join(", ")}`);
  await doctor.click('#doctorPatientSurveyForm button:not([type="button"])');
  await doctor.waitForSelector("#doctorVisitSavedNotice", { timeout: 10000 }).catch(async (error) => {
    throw new Error(`${error.message}; result: ${await doctor.locator("#doctorPatientSurveyResult").innerText().catch(() => "-")}`);
  });
  await capture(doctor, "doctor", "12-added-hint", "#doctorVisitSavedNotice");
  await capture(doctor, "doctor", "13-sync", "#doctorSyncButton");

  await writeFile(`${outputDir}/scenes.json`, JSON.stringify({ viewport: { width: 390, height: 844, scale: 2 }, scenes }, null, 2));
  console.log(`Captured ${scenes.nurse.length} nurse and ${scenes.doctor.length} doctor scenes in ${outputDir}`);
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
