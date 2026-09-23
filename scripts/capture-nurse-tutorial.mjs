import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const baseUrl = process.env.TUTORIAL_URL || "http://127.0.0.1:34321";
const outputDir = process.env.TUTORIAL_FRAMES || "artifacts/nurse-tutorial-frames";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 820 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/app-3-patient-survey`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.setItem("eclinic_survey_language_confirmed", "ru"));
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-survey-lang-choice="ru"]').click();

const shot = async (name) => {
  await page.screenshot({ path: `${outputDir}/${name}.png` });
};
const fill = async (name, value) => page.locator(`[name="${name}"]`).fill(String(value));
const select = async (name, value) => page.locator(`[name="${name}"]`).selectOption(value);
const focus = async (name) => {
  await page.locator(`[name="${name}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[name="${name}"]`).focus();
  await page.waitForTimeout(250);
};

await shot("01-open");
await fill("nurseName", "Медсестра Демо");
await fill("lastName", "Иванова");
await fill("firstName", "Анна");
await fill("middleName", "Тестовна");
await fill("birthDate", "1966-01-01");
await select("sex", "female");
await fill("phone", "900000000");
await fill("address", "Учебный пример");
await focus("nurseName");
await shot("02-passport");

await select("clinic", "Поликлиника №1");
await focus("clinic");
await shot("03-clinic");

await fill("height", "160");
await fill("weight", "77");
await fill("rabitoWaist", "89");
await focus("weight");
await shot("04-measurements");

await select("activity", "no");
await select("vegetables", "no");
await select("bpMeds", "yes");
await select("highGlucose", "no");
await select("familyDiabetes", "none");
await focus("activity");
await shot("05-findrisc");

await select("smoker", "no");
await fill("systolic", "130");
await fill("diastolic", "80");
await focus("systolic");
await shot("06-pressure");

await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
await page.locator('button[type="submit"]').focus();
await shot("07-submit");
await page.locator('button[type="submit"]').click();
await page.locator("#surveyResult .notice").waitFor({ timeout: 10000 });
await page.locator("#surveyResult").scrollIntoViewIfNeeded();
await shot("08-result");
const result = await page.locator("#surveyResult").innerText();
if (!result.includes("FINDRISC: 15")) throw new Error(`Expected FINDRISC 15, received: ${result}`);

await browser.close();
console.log(`Tutorial screenshots created in ${outputDir}`);
