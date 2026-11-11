// Browser end-to-end test (Chromium via Playwright): nurse, doctor, admin and public pages.
// Run: node scripts/e2e-browser.mjs   (needs the `playwright` package, e.g. globally installed)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const port = 31992;
const base = `http://127.0.0.1:${port}`;
const adminPassword = "TestAdmin1234";
const doctorPassword = "DoctorTest1234";
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-e2e-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: adminPassword },
  stdio: "ignore"
});
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

const results = [];
const pageProblems = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ok   ${name}`); }
  catch (error) { results.push([false, name, error]); console.log(`  FAIL ${name}\n       ${String(error.message).split("\n")[0]}`); }
}
const api = async (path, { method = "POST", body, cookie } = {}) => {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json().catch(() => ({})), cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
};
const watch = (page, label) => {
  page.on("pageerror", (e) => pageProblems.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageProblems.push(`${label}: ${m.text().slice(0, 160)}`); });
};

const browser = await chromium.launch();
try {
  const adminLogin = await api("/api/login/admin", { body: { username: "admin", password: adminPassword } });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.cookie;
  assert.equal((await api("/api/admin/doctors", { cookie: adminCookie, body: { fullName: "Тестовый Врач", login: "dr1", accessKey: doctorPassword, passport: "T1", clinic: "Поликлиника №1", specialty: "Терапевт", experienceYears: 5 } })).status, 201);
  const clinic2Patient = await api("/api/nurse-surveys", { body: {
    lastName: "Чужой", firstName: "Пациент", birthDate: "1975-03-03", phone: "+992900000099", address: "Душанбе", clinic: "Поликлиника №2", nurseName: "Сестрина Мария",
    sex: "male", age: 51, height: 170, weight: 90, rabitoWaist: 100, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 125, diastolic: 80 } });
  assert.equal(clinic2Patient.status, 201);

  // ---------- Nurse (phone) ----------
  console.log("Nurse survey (mobile)");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const nurse = await phone.newPage();
  watch(nurse, "nurse");
  const nurseFields = {
    high: { nurseName: "Сестрина Мария", lastName: "Рахимов", firstName: "Алишер", birthDate: "1970-05-05", sex: "male", phone: "+992900111222", address: "Душанбе", clinic: "Поликлиника №1",
      height: 170, weight: 95, rabitoWaist: 110, activity: "no", vegetables: "no", bpMeds: "yes", highGlucose: "yes", familyDiabetes: "first", smoker: "yes", systolic: 150, diastolic: 95 },
    low: { nurseName: "Сестрина Мария", lastName: "Саидова", firstName: "Мадина", birthDate: "1998-01-01", sex: "female", phone: "+992900333444", address: "Душанбе", clinic: "Поликлиника №1",
      height: 165, weight: 58, rabitoWaist: 68, activity: "yes", vegetables: "yes", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 115, diastolic: 75 },
    offline: { nurseName: "Сестрина Мария", lastName: "Офлайнов", firstName: "Фарход", birthDate: "1965-07-07", sex: "male", phone: "+992900555666", address: "Душанбе", clinic: "Поликлиника №1",
      height: 175, weight: 100, rabitoWaist: 112, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "second", smoker: "no", systolic: 135, diastolic: 85 }
  };
  const openSurvey = async () => {
    await nurse.goto(`${base}/app-3-patient-survey`);
    await nurse.locator("[data-survey-lang-choice=ru]").click({ timeout: 3000 }).catch(() => {});
    await nurse.waitForSelector("#surveyForm");
  };
  const fillSurvey = async (values) => {
    for (const [name, value] of Object.entries(values)) {
      const field = nurse.locator(`#surveyForm [name="${name}"]`);
      if ((await field.evaluate((el) => el.tagName)) === "SELECT") await field.selectOption(String(value));
      else await field.fill(String(value));
    }
  };
  const resultText = async () => (await nurse.locator("#surveyResult").innerText()).replace(/\s+/g, " ");
  const clinic1Patients = async () => {
    const login = await api("/api/login/doctor", { body: { login: "dr1", accessKey: doctorPassword } });
    return (await api("/api/doctor/workspace", { method: "GET", cookie: login.cookie })).data.surveys;
  };

  await openSurvey();
  await step("form shows required fields and computes age/BMI", async () => {
    await fillSurvey({ birthDate: "1970-05-05", height: 170, weight: 95 });
    assert.equal(await nurse.inputValue('[name="age"]'), String(new Date().getFullYear() - 1970 - (new Date() < new Date(new Date().getFullYear(), 4, 5) ? 1 : 0)));
    assert.equal(await nurse.inputValue('[name="bmi"]'), "32.9");
  });
  await step("empty form is blocked by validation (no request sent)", async () => {
    await openSurvey();
    let posted = 0;
    nurse.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/nurse-surveys")) posted += 1; });
    await nurse.click('#surveyForm button[type="submit"]');
    await nurse.waitForTimeout(400);
    assert.equal(posted, 0);
  });
  await step("high-risk patient is referred to a doctor", async () => {
    await openSurvey();
    await fillSurvey(nurseFields.high);
    await nurse.click('#surveyForm button[type="submit"]');
    await nurse.waitForFunction(() => /Направить к врачу/.test(document.querySelector("#surveyResult")?.innerText || ""), null, { timeout: 5000 });
    const text = await resultText();
    assert.match(text, /FINDRISC: 25/);
    assert.match(text, /Высокий/);
  });
  await step("low-risk patient is NOT referred (FINDRISC < 14)", async () => {
    await openSurvey();
    await fillSurvey(nurseFields.low);
    await nurse.click('#surveyForm button[type="submit"]');
    await nurse.waitForFunction(() => /FINDRISC/.test(document.querySelector("#surveyResult")?.innerText || ""), null, { timeout: 5000 });
    assert.doesNotMatch(await resultText(), /Направить к врачу/);
  });
  await step("duplicate patient shows a clear message and is not saved twice", async () => {
    await openSurvey();
    await fillSurvey(nurseFields.high);
    await nurse.click('#surveyForm button[type="submit"]');
    await nurse.waitForFunction(() => /уже существует/.test(document.querySelector("#surveyResult")?.innerText || document.body.innerText), null, { timeout: 5000 });
    assert.equal((await clinic1Patients()).filter((s) => s.patient.lastName === "Рахимов").length, 1);
  });
  await step("offline: survey is queued, then synced after reconnect", async () => {
    await openSurvey();
    await fillSurvey(nurseFields.offline);
    await phone.setOffline(true);
    await nurse.click('#surveyForm button[type="submit"]');
    await nurse.waitForFunction(() => /сохран|офлайн|очеред|синхрониз/i.test(document.querySelector("#surveyResult")?.innerText || ""), null, { timeout: 5000 });
    assert.equal((await clinic1Patients()).some((s) => s.patient.lastName === "Офлайнов"), false, "must not be on the server yet");
    const queued = await nurse.evaluate(async () => new Promise((resolve) => {
      const open = indexedDB.open("eclinic_offline_v2");
      open.onsuccess = () => { const req = open.result.transaction("nurse_surveys").objectStore("nurse_surveys").getAll(); req.onsuccess = () => resolve(req.result.length); };
    }));
    assert.equal(queued, 1, "one survey must be waiting in IndexedDB");
    await phone.setOffline(false); // the "online" event must trigger the sync by itself
    await nurse.waitForFunction(async () => {
      const db = await new Promise((resolve) => { const o = indexedDB.open("eclinic_offline_v2"); o.onsuccess = () => resolve(o.result); });
      return (await new Promise((resolve) => { const r = db.transaction("nurse_surveys").objectStore("nurse_surveys").getAll(); r.onsuccess = () => resolve(r.result.length); })) === 0;
    }, null, { timeout: 8000 });
    assert.equal((await clinic1Patients()).filter((s) => s.patient.lastName === "Офлайнов").length, 1);
  });
  await step("Tajik language switch works", async () => {
    await nurse.goto(`${base}/app-3-patient-survey`);
    await nurse.locator("[data-survey-lang-choice=tg]").click({ timeout: 3000 });
    await nurse.waitForSelector("#surveyForm");
    assert.doesNotMatch(await nurse.locator("#surveyForm h1").innerText(), /Опросник медсестры/);
  });
  await step("service worker is active with the current cache", async () => {
    await nurse.goto(`${base}/app-3-patient-survey`);
    const caches = await nurse.evaluate(async () => { await navigator.serviceWorker.ready; return await window.caches.keys(); });
    assert.ok(caches.includes("medical-mobile-v97"), `caches: ${caches}`);
  });

  // ---------- Doctor ----------
  console.log("Doctor workspace (desktop)");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const doctor = await desktop.newPage();
  watch(doctor, "doctor");
  let dialogMessage = "";
  doctor.on("dialog", async (d) => { dialogMessage = d.message(); await d.dismiss(); });
  const doctorLogin = async (key) => {
    await doctor.goto(`${base}/app-2-doctor`);
    await doctor.locator("[data-doctor-lang-choice=ru]").click({ timeout: 3000 }).catch(() => {});
    await doctor.fill('#doctorLogin [name="login"]', "dr1");
    await doctor.fill('#doctorLogin [name="accessKey"]', key);
    await doctor.click("#doctorLogin button");
  };
  await step("wrong key is rejected", async () => {
    await doctorLogin("wrong-key-123");
    await doctor.waitForTimeout(800);
    assert.ok(dialogMessage, "an error must be shown");
    assert.equal(await doctor.locator("#doctorLogin").count(), 1);
  });
  await step("doctor logs in and sees only own-clinic patients", async () => {
    await doctorLogin(doctorPassword);
    await doctor.waitForSelector("text=Картотека больных");
    // The language prompt is shown on every page load and covers the workspace until a choice is made.
    await doctor.locator("[data-doctor-lang-choice=ru]").click({ timeout: 3000 }).catch(() => {});
    const body = await doctor.locator("body").innerText();
    assert.match(body, /Рахимов/);
    assert.match(body, /Саидова/);
    assert.match(body, /Офлайнов/);
    assert.doesNotMatch(body, /Чужой/, "patients of another clinic must not be visible");
  });
  await step("high-risk patient is marked 'К врачу', low-risk is not", async () => {
    const rows = await doctor.locator(".patient-card").filter({ hasText: "Рахимов" }).first().innerText();
    assert.match(rows, /К врачу/);
    const low = await doctor.locator(".patient-card").filter({ hasText: "Саидова" }).first().innerText();
    assert.doesNotMatch(low, /К врачу/);
  });
  await step("doctor opens a patient and saves a visit", async () => {
    await doctor.locator(".patient-card").filter({ hasText: "Рахимов" }).first().getByText("Открыть").click();
    await doctor.waitForSelector("#visitForm");
    await doctor.fill('#visitForm [name="weight"]', "93");
    await doctor.fill('#visitForm [name="height"]', "170");
    await doctor.fill('#visitForm [name="glucose"]', "6.4");
    await doctor.fill('#visitForm [name="systolic"]', "145");
    await doctor.fill('#visitForm [name="diastolic"]', "92");
    await doctor.fill('#visitForm [name="followUpDays"]', "14");
    await doctor.fill('#visitForm [name="diagnosis"]', "Предиабет, АГ 1 ст.");
    await doctor.click('#visitForm button:not([type="button"])');
    await doctor.waitForFunction(() => /Осмотр сохранён/.test(document.querySelector("#doctorVisitSavedNotice")?.innerText || ""), null, { timeout: 5000 });
  });
  await step("visit is stored and PDF report downloads", async () => {
    const login = await api("/api/login/doctor", { body: { login: "dr1", accessKey: doctorPassword } });
    const ws = (await api("/api/doctor/workspace", { method: "GET", cookie: login.cookie })).data;
    assert.equal(ws.visits.length, 1);
    const patientId = ws.visits[0].surveyId;
    const pdf = await fetch(`${base}/api/doctor/patients/${patientId}/report.pdf`, { headers: { Cookie: login.cookie } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
  });
  await step("doctor cannot open another clinic's patient by id (IDOR)", async () => {
    const login = await api("/api/login/doctor", { body: { login: "dr1", accessKey: doctorPassword } });
    const pdf = await fetch(`${base}/api/doctor/patients/${clinic2Patient.data.survey.id}/report.pdf`, { headers: { Cookie: login.cookie } });
    assert.ok([403, 404].includes(pdf.status), `status ${pdf.status}`);
  });

  // ---------- Admin ----------
  console.log("Admin panel (desktop)");
  const adminPage = await desktop.newPage();
  watch(adminPage, "admin");
  adminPage.on("dialog", (d) => d.dismiss());
  await step("admin logs in through the form", async () => {
    await adminPage.goto(`${base}/app-1-admin-panel`);
    await adminPage.fill('#adminLogin [name="username"]', "admin");
    await adminPage.fill('#adminLogin [name="password"]', adminPassword);
    await adminPage.click("#adminLogin button");
    await adminPage.waitForSelector("nav button, .nav button", { timeout: 6000 });
  });
  await step("admin nav: everyday tabs visible, the rest in the 'Ещё' menu, no duplicate tab", async () => {
    const visible = await adminPage.locator('.nav > button[data-action="admin-tab"]').allInnerTexts();
    assert.deepEqual(visible, ["Статистика", "Контроль диабета", "Пациенты", "Врачи", "Журнал"]);
    assert.equal(await adminPage.locator('[data-tab="control"]').count(), 0, "duplicate 'control' tab must be gone");
  });
  await step("admin sees every tab render without broken values", async () => {
    const tabs = await adminPage.locator('[data-action="admin-tab"]').evaluateAll((els) => els.map((el) => el.dataset.tab));
    assert.ok(tabs.length >= 10, `tabs: ${tabs}`);
    let sawQrTab = false;
    for (const tab of tabs) {
      if (await adminPage.locator(`.nav-more [data-tab="${tab}"]`).count()) await adminPage.click(".nav-more > summary");
      await adminPage.click(`[data-action="admin-tab"][data-tab="${tab}"]`);
      await adminPage.waitForTimeout(400);
      const text = await adminPage.locator("main").innerText();
      assert.ok(text.length > 40, `tab "${tab}" rendered empty`);
      assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, `tab "${tab}" shows broken values`);
      if (/Отдельные ссылки приложений/.test(text)) sawQrTab = true;
    }
    assert.ok(sawQrTab, "the links/QR tab must render");
    assert.equal(await adminPage.locator(".nav-more > summary").innerText(), "Ссылки и QR", "the menu shows the active section");
  });
  await step("admin tools (import, backup, Telegram) are collapsed and open on click", async () => {
    await adminPage.click('[data-action="admin-tab"][data-tab="center"]');
    assert.equal(await adminPage.locator("details.admin-tools").evaluate((el) => el.open), false);
    await adminPage.click("details.admin-tools > summary");
    assert.ok(await adminPage.locator("#patientImportFile").isVisible());
  });
  await step("admin on a phone: no sideways scrolling, menu opens above the tab bar", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await mobile.addCookies((await desktop.cookies()).filter((c) => c.name === "sid"));
    const m = await mobile.newPage();
    watch(m, "admin-mobile");
    await m.goto(`${base}/app-1-admin-panel`);
    await m.waitForSelector(".nav-more > summary");
    const [scrollWidth, clientWidth] = await m.evaluate(() => [document.querySelector(".nav").scrollWidth, document.querySelector(".nav").clientWidth]);
    assert.ok(scrollWidth <= clientWidth, "tab bar must not scroll sideways");
    const brandTop = await m.locator(".topbar .brand").boundingBox();
    const navBox = await m.locator(".nav").boundingBox();
    assert.ok(navBox.y > brandTop.y + 200, "tab bar must sit at the bottom, not over the title");
    await m.click(".nav-more > summary");
    await m.click('.nav-more__menu [data-tab="doctors"], .nav-more__menu [data-tab="qr"]');
    await mobile.close();
  });

  // ---------- Public pages ----------
  console.log("Public pages");
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // no admin cookie
  const pub = await publicContext.newPage();
  watch(pub, "public");
  for (const [path, expected] of [["/app-4-doctor-knowledge", /Проверка знаний врачей/], ["/app-5-nurse-knowledge", /Тесты медсестер/], ["/app-7-operations-monitor", /Экран наблюдения/], ["/app-8-diabetes-risk", /риск сахарного диабета/], ["/app-6-investor-dashboard", /Вход администратора/]]) {
    await step(`${path} loads`, async () => {
      await pub.goto(base + path, { waitUntil: "networkidle" });
      assert.match(await pub.locator("body").innerText(), expected);
    });
  }
  await step("monitor dashboard shows saved surveys without patient names", async () => {
    await pub.goto(`${base}/app-7-operations-monitor`, { waitUntil: "networkidle" });
    await pub.waitForTimeout(500);
    const body = await pub.locator("body").innerText();
    assert.doesNotMatch(body, /Рахимов|Саидова|Офлайнов|Чужой/, "monitor must not leak patient surnames");
  });
  await step("presentation slides navigate (CSP-safe script)", async () => {
    await pub.goto(`${base}/presentation.html`);
    assert.equal((await pub.locator("#currentSlideNum").innerText()).trim(), "1");
    await pub.click("#btnNext");
    assert.equal((await pub.locator("#currentSlideNum").innerText()).trim(), "2");
    await pub.keyboard.press("ArrowLeft");
    assert.equal((await pub.locator("#currentSlideNum").innerText()).trim(), "1");
  });
} finally {
  await browser.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}

const failed = results.filter(([ok]) => !ok);
const uniqueProblems = [...new Set(pageProblems)];
if (uniqueProblems.length) console.log(`\nBrowser console/page errors:\n${uniqueProblems.map((p) => `  - ${p}`).join("\n")}`);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed${uniqueProblems.length ? `, ${uniqueProblems.length} console problem(s)` : ""}.`);
process.exit(failed.length || uniqueProblems.length ? 1 : 0);
