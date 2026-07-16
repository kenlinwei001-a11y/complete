import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/cmp";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const S = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
await S.goto(`${APP}/login`, { waitUntil: "networkidle" });
await S.fill("#login-tenant", "demo"); await S.fill("#login-username", "admin"); await S.fill("#login-password", "demo1234");
await S.click('button[type="submit"]');
await S.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
const SViews = [["dash", "经营驾驶舱"], ["risk", "预判推演看板"], ["order", "订单全链聚合"], ["audit", "规划体检"], ["generate", "方案生成"], ["sop", "S&OP 月度平衡"], ["aop", "年度情景规划台"], ["quarter", "季度滚动看板"], ["map", "基地地理视图"], ["model", "本体图谱"]];
const sOk = [];
for (const [k, label] of SViews) {
  let nav = false;
  for (const sel of [`text=${label}`, `a:has-text("${label}")`, `li:has-text("${label}")`]) {
    try { const l = S.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 2000 }); nav = true; break; } } catch {}
  }
  await sleep(3800);
  await S.screenshot({ path: `${OUT}/sys-${k}.png`, fullPage: false });
  const url = S.url().replace(APP, "");
  sOk.push(`${k}:${nav ? "✓" : "✗"}(${url})`);
}
console.log("系统截图:", sOk.join(" "));
await browser.close();
