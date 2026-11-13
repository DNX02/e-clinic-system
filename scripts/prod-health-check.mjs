// Read-only production check: no logins, no writes. Usage:
//   node scripts/prod-health-check.mjs [https://admin.e-clinic-control.ru]
// Behind an HTTPS proxy run with NODE_USE_ENV_PROXY=1 (and NODE_EXTRA_CA_CERTS if the proxy needs it).
// Exit code 1 if any check fails. Warnings do not fail the run.
import { readFileSync } from "node:fs";
import tls from "node:tls";
import { createRequire } from "node:module";

const base = (process.argv[2] || process.env.PROD_URL || "https://admin.e-clinic-control.ru").replace(/\/$/, "");
const results = [];
const record = (level, name, detail = "") => {
  results.push({ level, name, detail });
  console.log(`${level === "ok" ? "  ok  " : level === "warn" ? "  WARN" : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const timed = async (url, options = {}) => {
  const started = Date.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  return { response, ms: Date.now() - started };
};

// 1. API health
try {
  const { response, ms } = await timed(`${base}/api/health`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) record("fail", "API /api/health", `HTTP ${response.status}`);
  else record(ms > 3000 ? "warn" : "ok", "API /api/health", `${ms} ms ${JSON.stringify(body).slice(0, 160)}`);
} catch (error) {
  record("fail", "API /api/health", error.message);
}

// 1b. Load over the last hour (runtime self-diagnostics, no patient data)
try {
  const { response } = await timed(`${base}/api/health/details`);
  if (!response.ok) record("warn", "API /api/health/details", `HTTP ${response.status} (not deployed yet?)`);
  else {
    const d = await response.json();
    const h = d.lastHour || {};
    const summary = `uptime ${Math.round(d.uptimeSec / 60)} min, loop max ${h.maxLoopMs} ms, node CPU max ${h.maxProcessCpuPercent}%, load max ${h.maxSystemLoad1}/${d.cpuCount} CPU, free mem min ${h.minFreeMemMb}/${d.totalMemMb} MB, db write max ${h.maxDbWriteMs} ms, slow requests ${h.slowRequests}`;
    const worrying = h.maxLoopMs >= 1000 || h.slowRequests > 0 || h.maxDbWriteMs >= 2000 || h.minFreeMemMb < 100;
    record(worrying ? "warn" : "ok", "Server load, last hour", summary);
    for (const item of (d.slowRequests || []).slice(-5)) record("warn", "  slow request", `${item.at} ${item.method} ${item.route} ${item.durationMs} ms${item.aborted ? " (client gave up)" : ""}`);
  }
} catch (error) {
  record("warn", "API /api/health/details", error.message);
}

// 2. Every app page answers 200 and looks like our HTML
const pages = ["/app-1-admin-panel", "/app-2-doctor", "/app-3-patient-survey", "/app-4-doctor-knowledge", "/app-5-nurse-knowledge", "/app-6-investor-dashboard", "/app-7-operations-monitor", "/app-8-diabetes-risk", "/presentation.html", "/app.js", "/styles.css", "/sw.js"];
for (const path of pages) {
  try {
    const { response, ms } = await timed(base + path);
    const text = await response.text();
    if (!response.ok) record("fail", `GET ${path}`, `HTTP ${response.status}`);
    else if (text.length < 200) record("fail", `GET ${path}`, `suspiciously short body (${text.length} bytes)`);
    else record(ms > 4000 ? "warn" : "ok", `GET ${path}`, `${ms} ms`);
  } catch (error) {
    record("fail", `GET ${path}`, error.message);
  }
}

// 3. Deployed version matches the repository (main)
try {
  const local = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8").match(/medical-mobile-v\d+/)?.[0];
  const remote = (await (await timed(`${base}/sw.js?check=${Date.now()}`)).response.text()).match(/medical-mobile-v\d+/)?.[0];
  if (local === remote) record("ok", "deployed version = repository", remote);
  else record("warn", "deployed version differs from repository", `prod ${remote}, repo ${local} (deploy pending or failed?)`);
} catch (error) {
  record("warn", "version comparison", error.message);
}

// 4. Security headers
try {
  const { response } = await timed(`${base}/app-1-admin-panel`);
  for (const header of ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options"]) {
    if (!response.headers.get(header)) record("fail", `security header ${header}`, "missing");
  }
  record("ok", "security headers present");
} catch (error) {
  record("fail", "security headers", error.message);
}

// 5. TLS certificate expiry
await new Promise((resolve) => {
  const host = new URL(base).hostname;
  const socket = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
    const cert = socket.getPeerCertificate();
    const days = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000);
    record(days < 7 ? "fail" : days < 20 ? "warn" : "ok", "TLS certificate", `expires in ${days} days (${cert.valid_to})`);
    socket.end();
    resolve();
  });
  socket.on("error", (error) => {
    // Behind an HTTPS proxy (cloud sandboxes) DNS for the host is not available directly.
    const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
    record(proxied && /ENOTFOUND|EAI_AGAIN/.test(error.message) ? "warn" : "fail", "TLS certificate", proxied ? `not checked behind proxy (${error.message})` : error.message);
    resolve();
  });
  socket.on("timeout", () => { record("fail", "TLS certificate", "timeout"); socket.destroy(); resolve(); });
});

// 6. Pages render in a real browser without script errors (if Playwright is available)
let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch {}
if (!chromium) {
  record("warn", "browser check skipped", "playwright not installed");
} else {
  const browser = await chromium.launch();
  try {
    for (const [label, viewport, isMobile] of [["desktop", { width: 1280, height: 800 }, false], ["phone", { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile });
      for (const path of pages.filter((p) => !/\.(js|css)$/.test(p))) {
        const page = await context.newPage();
        const problems = [];
        page.on("pageerror", (e) => problems.push(e.message));
        page.on("console", (m) => {
          const text = m.text();
          // Cloudflare's analytics beacon is blocked by our CSP on purpose; ignore that noise.
          if (m.type() === "error" && !/cloudflareinsights|Failed to load resource/.test(text)) problems.push(text.slice(0, 160));
        });
        try {
          await page.goto(base + path, { waitUntil: "networkidle", timeout: 30000 });
          const heading = (await page.locator("h1").first().textContent({ timeout: 3000 }).catch(() => "")).trim();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
          if (problems.length) record("fail", `browser ${label} ${path}`, problems.join(" | "));
          else if (!heading) record("fail", `browser ${label} ${path}`, "no heading rendered");
          else if (overflow && path !== "/presentation.html") record("warn", `browser ${label} ${path}`, "horizontal scroll on page");
          else record("ok", `browser ${label} ${path}`, heading.slice(0, 40));
        } catch (error) {
          record("fail", `browser ${label} ${path}`, error.message.split("\n")[0]);
        }
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

const fails = results.filter((r) => r.level === "fail").length;
const warns = results.filter((r) => r.level === "warn").length;
console.log(`\nProduction check ${base}: ${results.length - fails - warns} ok, ${warns} warnings, ${fails} failures.`);
process.exit(fails ? 1 : 0);
