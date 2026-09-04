import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out";
fs.mkdirSync(OUT, { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);
console.log("after login:", page.url());
await page.screenshot({ path: OUT + "/01-home.png", fullPage: true });

// 枚举左侧导航（从登录后的壳里拿，不手敲 URL）
const links = await page.$$eval("a[href]", (as) =>
  as.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 40) })),
);
const uniq = [];
const seen = new Set();
for (const l of links) {
  if (!l.href || !l.href.startsWith("/") || seen.has(l.href)) continue;
  seen.add(l.href);
  uniq.push(l);
}
fs.writeFileSync(OUT + "/nav.json", JSON.stringify(uniq, null, 2));
console.log("NAV COUNT", uniq.length);
for (const l of uniq) console.log("NAV", l.href, "|", l.text);
await b.close();
