// Doctor login from a phone: capital first letter and keyboard spaces must not lock a doctor out.
// Run: node scripts/test-doctor-login.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 31980;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-doctor-login-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const post = (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const login = async (loginName, accessKey) => (await post("/api/login/doctor", { login: loginName, accessKey })).status;
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const admin = (await post("/api/login/admin", { username: "admin", password: "TestAdmin1234" })).headers.get("set-cookie").split(";")[0];
  const doctor = (fields) => post("/api/admin/doctors", { passport: "T", clinic: "Поликлиника №2", specialty: "Терапевт", experienceYears: 5, ...fields }, admin);
  assert.equal((await doctor({ fullName: "Олдошева Саида", login: "saida", accessKey: "1234s" })).status, 201);

  assert.equal(await login("saida", "1234s"), 200, "exact login");
  assert.equal(await login("Saida", "1234s"), 200, "phone capitalised the first letter");
  assert.equal(await login("saida ", "1234s"), 200, "space after a suggested word");
  assert.equal(await login(" SAIDA", "1234s "), 200, "spaces around the key too");
  assert.equal(await login("Saida", "1234S"), 401, "the key itself stays case-sensitive");
  assert.equal(await login("saida", "wrong1"), 401, "a wrong key is still refused");
  assert.equal(await login("", "1234s"), 401);

  assert.equal((await doctor({ fullName: "Другой Врач", login: "SAIDA", accessKey: "abc12" })).status, 409, "a login differing only in case is taken");
  console.log("Doctor login test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
