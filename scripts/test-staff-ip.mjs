// Staff IP addresses in the activity log: trustworthy client IP, device label, owner-only visibility.
// Run: node scripts/test-staff-ip.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientIpInfo, deviceLabel, isCloudflareIp } from "../client-info.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const req = (headers, remoteAddress = "127.0.0.1") => ({ headers, socket: { remoteAddress } });

// 1. Client IP: Cloudflare's header is trusted only when the request really came from Cloudflare.
assert.equal(isCloudflareIp("172.70.10.1"), true);
assert.equal(isCloudflareIp("2a06:98c1::1"), true);
assert.equal(isCloudflareIp("203.0.113.9"), false);
assert.deepEqual(clientIpInfo(req({ "x-real-ip": "172.70.10.1", "cf-connecting-ip": "5.188.1.2" })), { ip: "5.188.1.2", via: "cloudflare" });
assert.deepEqual(clientIpInfo(req({ "x-forwarded-for": "5.188.1.2, 172.70.10.1", "cf-connecting-ip": "5.188.1.2" })), { ip: "5.188.1.2", via: "cloudflare" });
assert.deepEqual(clientIpInfo(req({ "x-real-ip": "203.0.113.9", "cf-connecting-ip": "1.1.1.1" })), { ip: "203.0.113.9", via: "direct" }, "forged header on a direct request");
assert.deepEqual(clientIpInfo(req({ "cf-connecting-ip": "5.188.1.2" })), { ip: "5.188.1.2", via: "unverified" }, "proxy did not report the peer");
assert.deepEqual(clientIpInfo(req({}, "::ffff:198.51.100.7")), { ip: "198.51.100.7", via: "direct" });
assert.deepEqual(clientIpInfo(req({ "x-real-ip": "172.70.10.1", "cf-connecting-ip": "not-an-ip<script>" })), { ip: "172.70.10.1", via: "direct" });

// 2. Device label: short and readable, never the raw User-Agent.
assert.equal(deviceLabel(ANDROID), "Android 13 · Chrome");
assert.equal(deviceLabel(IPHONE), "iPhone iOS 17 · Safari");
assert.equal(deviceLabel(WINDOWS_EDGE), "Windows · Edge");
assert.equal(deviceLabel(""), "");

// 3. End to end: logins and surveys record the IP; only the main administrator sees it.
const port = 31991;
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "eclinic-staff-ip-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", INITIAL_ADMIN_PASSWORD: "TestAdmin1234" },
  stdio: "ignore"
});
const api = async (path, { method = "POST", body, cookie, headers = {} } = {}) => {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json().catch(() => ({})), cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
};
const viaCloudflare = (ip, ua) => ({ "x-real-ip": "172.70.10.1", "cf-connecting-ip": ip, "user-agent": ua });
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const owner = await api("/api/login/admin", { body: { username: "admin", password: "TestAdmin1234" } });
  assert.equal(owner.status, 200);
  assert.equal((await api("/api/admin/admins", { cookie: owner.cookie, body: { name: "Админ Менеджер", username: "manager1", password: "Manager12345", role: "manager" } })).status, 201);
  assert.equal((await api("/api/admin/doctors", { cookie: owner.cookie, body: { fullName: "Шарипова Нигина", login: "dr1", accessKey: "DoctorTest1234", passport: "T1", clinic: "Поликлиника №2", specialty: "Терапевт", experienceYears: 5 } })).status, 201);

  assert.equal((await api("/api/login/doctor", { body: { login: "dr1", accessKey: "DoctorTest1234" }, headers: viaCloudflare("5.188.1.2", ANDROID) })).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await api("/api/login/doctor", { body: { login: "dr1", accessKey: "DoctorTest1234" }, headers: { "x-real-ip": "203.0.113.9", "cf-connecting-ip": "1.1.1.1", "user-agent": WINDOWS_EDGE } })).status, 200);
  assert.equal((await api("/api/nurse-surveys", { headers: viaCloudflare("37.98.1.1", IPHONE), body: {
    nurseName: "Сестрина Мария", lastName: "Каримов", firstName: "Сино", birthDate: "1970-05-05", sex: "male", phone: "+992900111222", address: "Душанбе", clinic: "Поликлиника №2",
    age: 56, height: 170, weight: 80, rabitoWaist: 90, activity: "no", vegetables: "no", bpMeds: "no", highGlucose: "no", familyDiabetes: "none", smoker: "no", systolic: 120, diastolic: 80 } })).status, 201);

  const audit = (await api("/api/admin/dashboard?tab=audit", { method: "GET", cookie: owner.cookie })).data;
  assert.equal(audit.showStaffIps, true);
  const logins = audit.activityEvents.filter((event) => event.type === "doctor_login");
  assert.equal(logins.length, 2, "doctor logins are now in the activity log");
  assert.ok(logins.some((event) => event.ip === "5.188.1.2" && !event.ipVia && event.device === "Android 13 · Chrome"));
  assert.ok(logins.some((event) => event.ip === "203.0.113.9" && event.ipVia === "direct"), "forged CF header must not be trusted");
  assert.ok(!JSON.stringify(audit).includes("1.1.1.1"), "the forged address is not shown anywhere");
  assert.ok(!JSON.stringify(audit).includes("Mozilla"), "raw User-Agent is not stored");

  const doctorRow = audit.staffIps.find((row) => row.role === "doctor");
  assert.equal(doctorRow.name, "Шарипова Нигина");
  assert.equal(doctorRow.lastIp, "203.0.113.9");
  assert.equal(doctorRow.lastIpVia, "direct");
  assert.equal(doctorRow.ipCount, 2);
  const nurseRow = audit.staffIps.find((row) => row.role === "nurse");
  assert.equal(nurseRow.name, "Сестрина Мария");
  assert.equal(nurseRow.lastIp, "37.98.1.1");
  assert.equal(nurseRow.lastDevice, "iPhone iOS 17 · Safari");

  const byIp = (await api("/api/admin/dashboard?tab=audit", { cookie: owner.cookie, body: { tab: "audit", search: "37.98.1.1" } })).data;
  assert.equal(byIp.auditTotal, 1, "the main administrator can search the log by IP");

  const manager = await api("/api/login/admin", { body: { username: "manager1", password: "Manager12345" } });
  const managerAudit = (await api("/api/admin/dashboard?tab=audit", { method: "GET", cookie: manager.cookie })).data;
  assert.equal(managerAudit.showStaffIps, false);
  assert.equal(managerAudit.staffIps, undefined);
  assert.ok(managerAudit.activityEvents.length > 0);
  assert.ok(managerAudit.activityEvents.every((event) => !("ip" in event) && !("device" in event)), "other admins do not see IPs");
  const managerByIp = (await api("/api/admin/dashboard?tab=audit", { cookie: manager.cookie, body: { tab: "audit", search: "37.98.1.1" } })).data;
  assert.equal(managerByIp.auditTotal, 0, "other admins cannot search by IP either");

  const details = await (await fetch(`${base}/api/health/details`)).json();
  assert.ok(!JSON.stringify(details).includes("5.188.1.2"), "self-check page has counts only, no addresses");
  console.log("Staff IP test passed.");
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
