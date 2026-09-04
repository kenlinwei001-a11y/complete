import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://127.0.0.1:5401";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
if (await page.locator('input[type="password"]').count()) {
  const inputs = page.locator("input");
  await inputs.nth(0).fill("demo");
  await inputs.nth(1).fill("admin");
  await page.locator('input[type="password"]').fill("demo1234");
  await page.locator("button").filter({ hasText: /登录|登 录|Sign/ }).first().click();
  await page.waitForTimeout(2500);
}
// 展开所有导航分组
for (let i = 0; i < 4; i++) {
  const btns = await page.locator('nav button, aside button, [role="navigation"] button').all();
  for (const b of btns) await b.click({ timeout: 500 }).catch(() => {});
  await page.waitForTimeout(300);
}
const hrefs = await page.evaluate(() =>
  [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))]
);
console.log(JSON.stringify(hrefs.filter((h) => h && h.startsWith("/")), null, 0));
fs.writeFileSync("/tmp/rui4/routes.json", JSON.stringify(hrefs.filter((h) => h && h.startsWith("/"))));
await browser.close();
