#!/usr/bin/env node
/** 真页面 dump「物料价格变动」展开后的表单控件 —— 拿 ground truth：
 *  有没有 select？options 几条？「加进去」禁用吗？旁边的 hint 原文是什么？
 *  用法: FF_LABEL='物料价格变动' node DUMPFORM.mjs */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
const BASE = process.env.FF_BASE ?? "http://127.0.0.1:5294";
const LABEL = process.env.FF_LABEL ?? "物料价格变动";
const DU = "demo:admin:admin|planner|catalog_admin";
const L = []; const say = (s = "") => { L.push(s); console.log(s); };
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, extraHTTPHeaders: { "x-debug-user": DU } });
const p = await ctx.newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.fill("#login-tenant", "demo"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click('form button[type="submit"]'); await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 60000 });
  say("0 登录 OK");
  await p.goto(`${BASE}/v/decision-console`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(3500);

  // 全部事件按钮的标签与顺序
  const btns = p.locator('#z1 button[aria-label^="加一件"]');
  const n = await btns.count();
  say(`1 事件按钮数 = ${n}`);
  for (let i = 0; i < n; i++) say(`   [${i}] ${await btns.nth(i).getAttribute("aria-label")}`);

  // 点开目标事件
  const target = p.locator(`#z1 button[aria-label="加一件「${LABEL}」"]`);
  say(`2 目标按钮命中 = ${await target.count()}`);
  if (await target.count() === 0) throw new Error("target event button not found");
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 20000 });
  await p.waitForTimeout(2500);
  say("3 已点击展开，等 2.5s");

  // 展开的表单容器 = 按钮的下一个 div 兄弟
  const form = target.locator("xpath=following-sibling::div[1]");
  say(`4 tplOpen 命中 = ${await form.count()}`);
  const formInner = (await form.count()) ? form : p.locator("#z1");
  const txt = ((await formInner.innerText().catch(() => "")) || "").trim();
  say("── 表单可见文本 ──");
  for (const line of txt.split("\n")) say(`   | ${line}`);

  // input 全量
  const ins = formInner.locator("input");
  const inN = await ins.count();
  say(`5 input 数 = ${inN}`);
  for (let i = 0; i < inN; i++) {
    const el = ins.nth(i);
    say(`   in[${i}] type=${await el.getAttribute("type")} id=${await el.getAttribute("id")} value="${await el.inputValue().catch(() => "?")}"`);
  }
  // select 全量
  const sels = formInner.locator("select");
  const selN = await sels.count();
  say(`6 select 数 = ${selN}`);
  for (let i = 0; i < selN; i++) {
    const el = sels.nth(i);
    const id = await el.getAttribute("id");
    const opts = el.locator("option");
    const oN = await opts.count();
    say(`   sel[${i}] id=${id} options=${oN}`);
    for (let j = 0; j < Math.min(oN, 12); j++) say(`      opt[${j}] value="${await opts.nth(j).getAttribute("value")}" text="${((await opts.nth(j).textContent()) || "").trim()}"`);
  }
  // 按钮
  const fbtns = formInner.locator("button");
  const fbN = await fbtns.count();
  say(`7 表单内按钮数 = ${fbN}`);
  for (let i = 0; i < fbN; i++) {
    const t = ((await fbtns.nth(i).textContent()) || "").trim().slice(0, 30);
    const dis = await fbtns.nth(i).isDisabled().catch(() => "?");
    say(`   btn[${i}] "${t}" disabled=${dis}`);
  }
} finally {
  const out = process.env.FF_OUT ?? "/tmp/DUP_FORM.txt";
  const fs = await import("node:fs");
  fs.writeFileSync(out, L.join("\n") + "\n");
  await b.close();
  console.log(`→ ${out}`);
}
