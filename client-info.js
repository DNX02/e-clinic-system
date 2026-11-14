// Who is on the other end of a request: a trustworthy client IP and a short device label.
//
// Traffic normally goes  client -> Cloudflare -> nginx -> node (node listens on 127.0.0.1 only).
// Cloudflare puts the real client address into CF-Connecting-IP, but the server is also reachable
// directly by its IP address, and on such a request anyone can send a forged CF-Connecting-IP.
// So the header is trusted only when the hop that reached nginx is a Cloudflare address.
import { BlockList, isIP } from "node:net";

// https://www.cloudflare.com/ips-v4 and /ips-v6 (checked 2026-11-14). The list changes very rarely;
// if Cloudflare adds a range, requests from it are shown as "direct" with the edge IP, never a forged one.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32"
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [address, prefix] = range.split("/");
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? "ipv6" : "ipv4");
}

function cleanIp(value) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : "";
}

export function isCloudflareIp(value) {
  const ip = cleanIp(value);
  if (!ip) return false;
  return cloudflare.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

const isLoopback = (ip) => ip === "127.0.0.1" || ip === "::1";

// via: "cloudflare"  - came through Cloudflare, CF-Connecting-IP verified
//      "direct"      - reached the server without Cloudflare (the address is the real sender)
//      "unverified"  - the proxy did not tell us who connected, so CF-Connecting-IP cannot be checked
export function clientIpInfo(req) {
  const headers = req?.headers || {};
  const forwardedFor = String(headers["x-forwarded-for"] || "").split(",").map((item) => item.trim()).filter(Boolean);
  const proxyReported = cleanIp(headers["x-real-ip"]) || cleanIp(forwardedFor.at(-1));
  const socketIp = cleanIp(req?.socket?.remoteAddress);
  const hop = proxyReported || socketIp;
  const cfIp = cleanIp(headers["cf-connecting-ip"]);
  if (hop && isCloudflareIp(hop)) return { ip: cfIp || hop, via: cfIp ? "cloudflare" : "direct" };
  if (proxyReported) return { ip: proxyReported, via: "direct" };
  if (cfIp && (!socketIp || isLoopback(socketIp))) return { ip: cfIp, via: "unverified" };
  return { ip: hop || "unknown", via: "direct" };
}

// "Android 13 · Chrome", "iPhone iOS 17 · Safari", "Windows · Edge". Never stores the raw User-Agent.
export function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "";
  let os = "";
  let match;
  if ((match = ua.match(/Android\s([\d.]+)/))) os = `Android ${match[1].split(".")[0]}`;
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/iPhone/.test(ua)) os = (match = ua.match(/OS (\d+)_/)) ? `iPhone iOS ${match[1]}` : "iPhone";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";
  let browser = "";
  if (/YaBrowser\//.test(ua)) browser = "Яндекс Браузер";
  else if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//.test(ua)) browser = "Samsung Internet";
  else if (/Telegram/i.test(ua)) browser = "Telegram";
  else if (/CriOS\/|Chrome\//.test(ua)) browser = "Chrome";
  else if (/FxiOS\/|Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  return [os, browser].filter(Boolean).join(" · ") || "Другое устройство";
}
