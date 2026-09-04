import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://127.0.0.1:5401";
// 与 scan.mjs 同一把尺（单一实现，禁止各抄一份）
export const COORD_RE =
  /(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-\/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs)\:\d+/g;

const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(",")
  : [
      "/v/node-inspector",
      "/v/sim-sandbox",
      "/admin/boundary",
      "/v/transit-flow",
      "/v/physical-topology",
    ];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();

// —— 从登录走起 ——
await page.goto(BASE + "/", { waitUntil: "networkidle" });
const needLogin = await page.locator('input[type="password"]').count();
if (needLogin) {
  const inputs = page.locator("input");
  await inputs.nth(0).fill("demo");
  await inputs.nth(1).fill("admin");
  await page.locator('input[type="password"]').fill("demo1234");
  await page.locator("button").filter({ hasText: /登录|登 录|Sign/ }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
}
console.log("LOGIN_URL_AFTER", page.url());
// 金丝雀0：登录没成功 ⇒ 后面每页都是登录屏，命中数恒 0 —— 那是取证坏了，不是屏干净。
if (/\/login/.test(page.url()) || (await page.locator('input[type="password"]').count())) {
  console.log("!! 取证坏了：没登进去，本次一切 0 命中作废");
  process.exit(2);
}

async function harvest() {
  // innerText + 所有 [title] 属性 + aria-label
  return await page.evaluate(() => {
    const t = document.body ? document.body.innerText : "";
    const attrs = [];
    for (const el of document.querySelectorAll("[title],[aria-label],[alt],[placeholder]")) {
      for (const a of ["title", "aria-label", "alt", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v) attrs.push(v);
      }
    }
    return t + "\n" + attrs.join("\n");
  });
}

async function expandAll() {
  // 展开 details / 点开所有 tab / 折叠面板，尽量把隐藏文本翻出来
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => {
        if (!d.open) {
          d.open = true;
          d.dispatchEvent(new Event("toggle", { bubbles: true }));
        }
      });
    });
    const btns = await page.locator('button[aria-expanded="false"]').all();
    for (const b of btns.slice(0, 40)) await b.click({ timeout: 800 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

const report = {};
let grand = 0;
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);
  await expandAll();
  await page.waitForTimeout(800);
  const text = await harvest();
  const hits = text.match(COORD_RE) || [];
  if (text.length < 500) { console.log('!! 取证坏了：' + r + ' 只渲染了 ' + text.length + ' 字，判 0 不作数'); process.exitCode = 2; }
  report[r] = { count: hits.length, bytes: text.length, samples: [...new Set(hits)].slice(0, 12) };
  grand += hits.length;
  fs.writeFileSync(`/tmp/rui4/text${r.replace(/\//g, "_")}.txt`, text);
  console.log(`${r}\t${hits.length}\t${[...new Set(hits)].slice(0, 6).join(" | ")}`);
}
console.log("GRAND_TOTAL", grand);

// —— 金丝雀：这把尺对一段已知含坐标的文本必须命中 ——
const canary = "引擎侧 apps/datacore/src/sim/propagation.ts:73 在 cadenceGate() 里";
const cm = canary.match(COORD_RE) || [];
console.log("CANARY", cm.length, cm.join("|"));
if (cm.length === 0) console.log("!! 取证坏了：金丝雀不中");

fs.writeFileSync("/tmp/rui4/report.json", JSON.stringify(report, null, 1));
await browser.close();
