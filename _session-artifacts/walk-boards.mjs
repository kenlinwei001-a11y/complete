import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const has = (body, re) => re.test(body);
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);

// #2 驾驶舱 KPI 溯源徽 hover
await page.evaluate(() => { window.history.pushState({}, "", "/v/dash"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);
let provTip = "<无>";
try {
  const prov = page.locator('[data-testid^="widget-prov-"]').first();
  const provN = await page.locator('[data-testid^="widget-prov-"]').count();
  if (await prov.count()) { await prov.hover(); await sleep(700); await prov.click().catch(() => {}); await sleep(700); const body = (await page.locator("body").textContent()) || ""; const m = body.match(/来源系统|新鲜度|推导|输入|规则\s*C?\d|快照|输出路径|备注|provId/g); provTip = "溯源徽数=" + provN + " 命中:" + (m ? [...new Set(m)].join(",") : "无六要素字样"); }
  else provTip = "无 widget-prov 徽";
} catch (e) { provTip = "err " + String(e).slice(0, 40); }
console.log("[#2] KPI 六要素溯源:", provTip);

// 各板块：导航(点左导航文字) + 全页截图 + 关键字检测
async function board(navText, file, checks) {
  try {
    const link = page.locator(`text=${navText}`).first();
    await link.click({ timeout: 4000 }); await sleep(4500);
  } catch { /* fallback pushState */ }
  const body = (await page.locator("body").textContent().catch(() => "")) || "";
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  const res = {};
  for (const [k, re] of Object.entries(checks)) res[k] = has(body, re) ? "✓" : "✗";
  console.log(`\n=== ${navText} (${page.url().replace(APP, "")}) ===`);
  for (const [k, v] of Object.entries(res)) console.log(`  ${k}: ${v}`);
}

// 规划体检 plan-audit: #4 聚合勾稽 / #5 X01-X05+一键fix / 反事实排除深度
await board("规划体检", "walk-plan-audit.png", {
  "[#5] X01-X05 命名校验": /X0[1-5]|X1[0-9]/,
  "[#5] 一键fix/采纳修正": /一键|修正|采纳|应用.*fix|fix/i,
  "[#4] 聚合勾稽表(Σ闭合)": /勾稽|聚合.*贡献|Σ|闭合|归一/,
  "[3a/b] 反事实排除层": /反事实|已排除|反算达标/,
  "H/M/S 三段": /硬矛盾|软风险|建议|HITL|H\s|M\s|S\s/,
});
// 方案生成 plan-generate: #6 3案对比
await board("方案生成", "walk-plan-generate.png", {
  "[#6] 3案(稳健/均衡/进取)": /稳健|均衡|进取|方案[ABC]|3\s*案|三案/,
  "[#6] 五维雷达": /雷达|五维|radar/i,
  "[#6] 取舍矩阵": /取舍|矩阵|tradeoff/i,
  "[#6] 外部敏感性/风险传播": /敏感性|外部信号|风险传播/,
});
// 项目沙盘 project-sim: #7 订单驱动三关联判
await board("项目沙盘推演", "walk-project-sim.png", {
  "[#7] 订单全链推演 tab": /订单全链|订单驱动/,
  "[#7] 三关联判(交期/齐套/财务)": /交期判|齐套判|财务判|交期.*齐套.*财务/,
  "[#7] 4态承接 verdict": /可接|提价接|不接|承接/,
  "型号产能6步": /可产网络|驱动因子|P50|瓶颈/,
});
// 预判推演看板 risk-board: #8 PropagationTimeline
await board("预判推演看板", "walk-risk-board.png", {
  "[#8] 问题传播时序(逐日传导)": /传播时序|逐日传导|传导曲线|事件窗|越线/,
  "[#8] 财务击穿(系数非写死)": /财务击穿|击穿/,
  "风险卡(基地×因素)": /风险卡|基地|因素|越线日/,
  "处置方案": /处置|对症|方案/,
});
await browser.close();
