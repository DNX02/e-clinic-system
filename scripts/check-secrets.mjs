import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const self = "scripts/check-secrets.mjs";
const ignored = new Set([self, "package-lock.json"]);
const patterns = [
  ["Telegram bot token", /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ["OpenAI-style API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["Database URL with password", /postgres(?:ql)?:\/\/(?!user(?:name)?:password@)[^:\s/@]+:[^@\s/]+@/i],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !ignored.has(file));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length) {
  console.error("Potential secrets found in tracked files:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} tracked files.`);
