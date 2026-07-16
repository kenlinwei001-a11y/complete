import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4500); // 等 createSimSession + fetchSimCertification 完成

const txt = async (sel) => { const l = page.locator(sel); return (await l.count()) ? ((await l.first().textContent()) || "").trim() : "<缺>"; };
const attr = async (sel, a) => { const l = page.locator(sel); return (await l.count()) ? await l.first().getAttribute(a) : "<缺>"; };
const cnt = async (sel) => await page.locator(sel).count();

const panelExists = await cnt('[data-testid="modeling-readiness"]');
const entOff = await cnt('[data-testid="modeling-readiness-entoff"]');
// 是否还卡在 loading
const bodyText = (await page.locator('[data-testid="modeling-readiness"]').textContent().catch(() => "")) || "";
const stuck = bodyText.includes("建认证会话中") || bodyText.includes("加载就绪认证");

const gaugePct = await txt('[data-testid="sim-cert-gauge-pct"]');
const l1Current = await attr('[data-testid="sim-cert-step-L1_CONFIGURED"]', "data-current");
const l1Active = await attr('[data-testid="sim-cert-step-L1_CONFIGURED"]', "data-active");
const l2Active = await attr('[data-testid="sim-cert-step-L2_RUNNABLE"]', "data-active");
const dimsLine = await txt('[data-testid="sim-readiness-panel"] >> text=综合');
const fanout = await attr('[data-testid="sim-cert-l4-fanoutSafe"]', "data-ok");
const writeb = await attr('[data-testid="sim-cert-l4-writebackComplete"]', "data-ok");
const observ = await attr('[data-testid="sim-cert-l4-observabilityMet"]', "data-ok");
const trialPassed = await attr('[data-testid="sim-cert-trial-passed"]', "data-ok");
const rulesFired = await txt('[data-testid="sim-cert-trial-rulesfired"]');
const canEnter = await txt('[data-testid="sim-cert-canenter"]');
const reservedSchema = await txt('[data-testid="l4-reserved-schemalint"]');
const reservedPersist = await txt('[data-testid="l4-reserved-persisted"]');
const wcStateVars = await txt('[data-testid="sim-cert-wc-状态变量"]');
const enteringCnt = await cnt('[data-testid="sim-cert-entering"] li');

await page.screenshot({ path: `${OUT}/p2-cert-panel.png`, fullPage: true });
// 局部截就绪面板
try { await page.locator('[data-testid="modeling-readiness"]').screenshot({ path: `${OUT}/p2-cert-panel-crop.png` }); } catch {}

console.log("=== 轨P 增量2 真浏览器取证 ===");
console.log("面板存在        :", panelExists, "| entOff显示:", entOff, "| 卡loading:", stuck);
console.log("绿环 gauge%     :", gaugePct, "  (oracle 35%)");
console.log("L1 当前/点亮    :", l1Current, "/", l1Active, "| L2点亮:", l2Active, "(应 L1=current·active, L2=0)");
console.log("三维行          :", dimsLine);
console.log("L4 扇出/写回/可观测:", fanout, "/", writeb, "/", observ, "(应全 1)");
console.log("TrialTick passed:", trialPassed, "|", rulesFired);
console.log("canEnter        :", canEnter, "(应 ✗ 暂不可进入)");
console.log("RESERVED Schema :", reservedSchema);
console.log("RESERVED 持久化 :", reservedPersist);
console.log("世界完整度状态变量:", wcStateVars, "(oracle present0/needed11)");
console.log("entering 清单条数:", enteringCnt, "(oracle 12)");
console.log("console errors  :", errs.length, errs.slice(0, 3).join(" | "));
await browser.close();
