import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "eclinic-ui-"));
const port = 3219;
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "UiCheck-Password-2026!" },
  stdio: ["ignore", "pipe", "pipe"]
});
const paths = ["/app-1-admin-panel", "/app-2-doctor", "/app-3-patient-survey", "/app-4-doctor-knowledge", "/app-5-nurse-knowledge", "/app-6-investor-dashboard", "/app-7-operations-monitor"];
const agents = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126",
  mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1"
};
try {
  const appSource = await readFile("public/app.js", "utf8");
  const stylesSource = await readFile("public/styles.css", "utf8");
  assert.match(appSource, /<select name="\$\{name\}" required><option value="" selected disabled>/, "questionnaire selects must require an explicit answer");
  assert.match(appSource, /<select name="clinic" required><option value="" selected disabled>/, "nurse clinic must be selected explicitly");
  assert.match(appSource, /id="surveySearchForm"/, "admin patients must provide a search form");
  assert.match(appSource, /Фамилия, имя, телефон или дата рождения/, "admin patient search must explain supported fields");
  assert.match(appSource, /lastSavedDoctorVisitId/, "saved doctor visit must be highlighted immediately");
  assert.match(appSource, /Лекарства и анализы показаны ниже/, "doctor must see where the saved prescription is displayed");
  assert.match(appSource, /Контроль старших медсестёр/, "owner must have a head nurse activity screen");
  assert.match(appSource, /state\.me\?\.role === "owner"/, "head nurse activity tab must be limited to the owner UI");
  assert.equal((appSource.match(/input\(t\("Отчество"\), "middleName", false\)/g) || []).length, 2, "patronymic must be optional in nurse and doctor questionnaires");
  assert.match(stylesSource, /\.doctor-layout \.nav[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, "mobile doctor navigation must use a wrapped grid");
  assert.match(stylesSource, /\.easy-reading \.doctor-layout \.nav button[\s\S]*font-size: 13px/, "large text mode must keep mobile navigation readable");
  assert.match(stylesSource, /\.doctor-layout \.topbar \{[\s\S]*backdrop-filter: none/, "mobile doctor header must not trap fixed navigation");
  assert.match(stylesSource, /\.doctor-layout \.nav \{[\s\S]*position: static;[\s\S]*width: 100%/, "mobile doctor navigation must follow the doctor identity in the header");
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const [viewport, agent] of Object.entries(agents)) {
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "User-Agent": agent } });
      const body = await response.text();
      assert.equal(response.status, 200, `${viewport}: ${path}`);
      assert.match(body, /<meta name="viewport"/i, `${viewport}: viewport missing in ${path}`);
      assert.match(body, /app\.js/, `${viewport}: app.js missing in ${path}`);
      assert.match(body, /styles\.css/, `${viewport}: styles missing in ${path}`);
    }
  }
  console.log(`UI contract OK: ${paths.length} apps x ${Object.keys(agents).length} device profiles`);
} finally {
  child.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
