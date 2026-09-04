import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out";
const MD = /\*\*[^*\n]{1,120}\*\*/g;
const BAD = /删除|移除|退出|登出|注销|停用|禁用|清空|重置|销毁|下载|导出/;

const nav = JSON.parse(fs.readFileSync(OUT + "/nav.json", "utf8"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);

const found = new Map(); // md -> [where]
function note(md, where) {
  if (!found.has(md)) found.set(md, new Set());
  found.get(md).add(where);
}
async function harvest(where) {
  const r = await page.evaluate(() => {
    const t = document.body.innerText;
    const titles = [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n");
    return { t, titles };
  });
  for (const m of r.t.matchAll(MD)) note(m[0], where + " [innerText]");
  for (const m of r.titles.matchAll(MD)) note(m[0], where + " [title属性]");
}

for (const l of nav) {
  const href = l.href;
  // 每页前先回到壳首页，保证左侧导航完好（上一页的按钮点击可能收起导航）
  try { await page.goto(BASE + "/v/dash", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500); } catch {}
  if ((await page.locator("#login-tenant").count()) > 0) {
    await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin");
    await page.fill("input[type=password]", "demo1234"); await page.click("button[type=submit]"); await page.waitForTimeout(3500);
  }
  try {
    const link = page.locator(`a[href="${href}"]`).first();
    if ((await link.count()) === 0) { console.log("SKIP", href); continue; }
    await link.click({ timeout: 8000 });
  } catch { try { await page.goto(BASE + href, { waitUntil: "domcontentloaded" }); } catch { continue; } }
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  await page.waitForTimeout(500);
  await harvest(href);

  // 选择器：每个 <select> 逐项切一遍
  const sels = await page.locator("select").count();
  for (let i = 0; i < Math.min(sels, 6); i++) {
    try {
      const opts = await page.locator("select").nth(i).locator("option").count();
      for (let j = 0; j < Math.min(opts, 8); j++) {
        const v = await page.locator("select").nth(i).locator("option").nth(j).getAttribute("value");
        if (v == null) continue;
        await page.locator("select").nth(i).selectOption(v, { timeout: 3000 });
        await page.waitForTimeout(600);
        await harvest(href + ` select#${i}=${v}`);
      }
    } catch {}
  }

  // 按钮/tab：逐个点一遍（跳过破坏性）
  let btns = await page.locator("button:visible").all();
  const labels = [];
  for (const bt of btns.slice(0, 40)) { try { labels.push(((await bt.innerText()) || "").trim()); } catch { labels.push(""); } }
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i];
    if (!lab || lab.length > 24 || BAD.test(lab)) continue;
    try {
      const cur = page.locator("button:visible").nth(i);
      await cur.click({ timeout: 2500 });
      await page.waitForTimeout(900);
      if (!page.url().includes(href)) { await page.goBack(); await page.waitForTimeout(1200); continue; }
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      await harvest(href + ` btn:${lab}`);
    } catch {}
  }
  console.log("DONE", href, "acc=", found.size);
}
const out = [...found.entries()].map(([k, v]) => ({ md: k, where: [...v] }));
fs.writeFileSync(OUT + "/mdscan2.json", JSON.stringify(out, null, 2));
console.log("TOTAL DISTINCT MD ON SCREEN:", out.length);
for (const o of out) console.log(o.md, "=>", o.where.slice(0, 3).join(" ; "));
await b.close();
