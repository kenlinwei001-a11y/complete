import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/userline-shots";
const BASE = "http://localhost:5173";
const log = (...a) => console.log("[shoot]", ...a);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

try {
  // ---- login ----
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#login-username", { timeout: 15000 });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !/login/i.test(u.pathname) && u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  log("after login, url =", page.url());

  // ---- 产能推演 / risk board ----
  await page.goto(BASE + "/v/risk", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid^="risk-card-"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const cards = await page.$$eval('[data-testid^="risk-card-"]', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, " ").trim().slice(0, 120))
  );
  log("RISK cards:", cards.length);
  cards.forEach((c, i) => log(`  card[${i}]: ${c}`));
  const legend = await page.$eval('[data-testid="risk-legend"]', (e) => e.innerText.replace(/\s+/g, " ").trim()).catch(() => "n/a");
  log("legend:", legend);
  const planRows = await page.$$eval('[data-testid^="risk-plan-row-"]', (e) => e.length).catch(() => 0);
  log("plan rows:", planRows);
  await page.screenshot({ path: `${OUT}/01-capacity-risk-board.png`, fullPage: true });
  log("saved 01-capacity-risk-board.png");

  // ---- card detail modal ----
  const target = (await page.$('[data-testid="risk-card-常州"]')) || (await page.$('[data-testid^="risk-card-"]'));
  await target.click();
  await page.waitForSelector('[data-testid="risk-heat-strip"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  log("detail modal open, events:", await page.$$eval('[data-testid^="risk-event-"]', (e) => e.length).catch(() => 0),
      "mitigation rows:", await page.$$eval('[data-testid^="mitigation-plan-"]', (e) => e.length).catch(() => 0));
  await page.screenshot({ path: `${OUT}/03-card-detail-modal.png`, fullPage: true });
  log("saved 03-card-detail-modal.png");

  // ---- affected-orders modal (the 03f610b7 fix) ----
  const day = (await page.$('[data-testid="risk-day-18"]')) || (await page.$('[data-testid="risk-day-0"]'));
  if (day) {
    await day.click();
    await page.waitForSelector('[data-testid="affected-orders-table"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const rows = await page.$$eval('[data-testid="affected-orders-table"] tbody tr', (trs) =>
      trs.map((tr) => tr.innerText.replace(/\t/g, " | ").replace(/\n/g, " | ").trim())
    ).catch(() => []);
    log("AFFECTED ORDERS rows:", rows.length);
    rows.forEach((r, i) => log(`  order[${i}]: ${r}`));
    await page.screenshot({ path: `${OUT}/04-affected-orders-modal.png`, fullPage: true });
    log("saved 04-affected-orders-modal.png");
  } else {
    log("no day cell found");
  }

  // ---- dashboard / 经营驾驶舱 ----
  await page.goto(BASE + "/v/dash", { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const kpis = await page.$$eval("[class*=kpi], [class*=Kpi]", (els) =>
    els.slice(0, 16).map((e) => e.innerText.replace(/\s+/g, " ").trim().slice(0, 60))
  ).catch(() => []);
  log("DASH kpi blocks:", kpis.length);
  kpis.forEach((k) => log("  kpi:", k));
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });
  log("saved 02-dashboard.png");

  log("ERRORS captured:", errors.length);
  errors.slice(0, 15).forEach((e) => log("  " + e));
} catch (e) {
  log("FATAL:", String(e).slice(0, 400));
  await page.screenshot({ path: `${OUT}/ZZ-failure.png`, fullPage: true }).catch(() => {});
  try { fs.writeFileSync(`${OUT}/ZZ-page-html.txt`, (await page.content()).slice(0, 5000)); } catch {}
} finally {
  await browser.close();
}
