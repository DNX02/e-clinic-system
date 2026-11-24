// A nurse resending the same patient the same day (slow network, old queued copies) is confirmed, not a 409.
// Run: node scripts/test-nurse-resend.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const port = 31979;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-resend-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const patient = {
  lastName: "Халимова", firstName: "Зулола", birthDate: "1988-03-03", sex: "female", phone: "+992900123456", address: "Душанбе", clinic: "Поликлиника №9",
  age: 38, height: 160, weight: 70, rabitoWaist: 85, activity: "yes", vegetables: "yes", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 120, diastolic: 80
};
const send = async (body) => {
  const response = await fetch(`${base}/api/nurse-surveys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientSurveyId: randomUUID(), ...body }) });
  return { status: response.status, body: await response.json() };
};
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const first = await send({ ...patient, nurseName: "Раҳимова Мехри" });
  assert.equal(first.status, 201);

  for (let i = 0; i < 6; i += 1) {
    const again = await send({ ...patient, nurseName: i % 2 ? "Рахимова Мехри" : "Раҳимова Мехри" });
    assert.equal(again.status, 200, "same nurse (any spelling), same day: a resend");
    assert.equal(again.body.alreadySaved, true);
    assert.equal(again.body.id, first.body.survey.id);
  }

  const otherNurse = await send({ ...patient, nurseName: "Другая Медсестра" });
  assert.equal(otherNurse.status, 409, "another nurse with the same patient still gets the duplicate question");

  const forced = await send({ ...patient, nurseName: "Раҳимова Мехри", allowDuplicate: true });
  assert.equal(forced.status, 201, "«Как нового» still creates a new survey");
  console.log("Nurse resend test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
