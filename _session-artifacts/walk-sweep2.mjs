import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
const nav = async (p) => { const errs = []; const h = (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 70)); }; page.on("console", h); await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2600); page.off("console", h); return errs; };
const bodyTxt = async () => (await page.locator("body").innerText().catch(() => "")) || "";

const PAGES = [
  ["连接器与上传", "/admin/connections"], ["对象/类型浏览", "/admin/object-types"], ["规则文档审核", "/admin/rule-docs"],
  ["合成数据", "/admin/synthetic"], ["外部信号", "/admin/external-signals"], ["隔离区", "/admin/quarantine"],
  ["验证引擎", "/admin/validation"], ["校准报告", "/admin/calibration"], ["域管理", "/admin/domains"],
  ["本体切片", "/admin/slices"], ["实体合并", "/admin/merge"], ["数据构建", "/admin/data-builder"],
];
console.log("=== 走查 12 页 (render/error/empty/buttons/back) ===");
const issues = [];
for (const [name, path] of PAGES) {
  const errs = await nav(path);
  const url = page.url();
  const bounced = url.includes("/login");
  const body = await bodyTxt();
  const btns = await page.locator("button").count().catch(() => 0);
  const hasBack = /返回|‹ 返回|回退/.test(body) || (await page.locator('button:has-text("返回")').count().catch(() => 0)) > 0;
  const emptyish = /暂无|无数据|empty|没有|未配置|加载中/.test(body) && body.length < 900;
  const errToast = /VALIDATION_ERROR|INTERNAL_ERROR|不可达|失败|错误/.test(body.slice(-300));
  const flag = bounced ? "⚠️掉登录" : (errs.length ? `⚠️console-err(${errs.length})` : (errToast ? "⚠️错误提示" : (emptyish ? "◐空态" : "✓"))) + (hasBack ? "·有返回" : "·无返回");
  console.log(`  ${name} (${path}): ${flag} | 按钮${btns} | 正文${body.length}`);
  if (bounced || errs.length || errToast) { issues.push(`${name}: ${bounced ? "掉登录" : ""}${errs.length ? "console:" + errs[0] : ""}${errToast ? "错误提示" : ""}`); }
}
console.log("\n=== 深查: 连接器创建流程 ===");
await nav("/admin/connections");
const beforeBody = await bodyTxt();
console.log("  连接器页正文片段:", beforeBody.replace(/\s+/g, " ").slice(0, 160));
// 找"新建/创建/上传"
const createBtns = await page.locator('button').filter({ hasText: /新建|创建|上传|添加|连接/ }).allInnerTexts().catch(() => []);
console.log("  创建类按钮:", createBtns.slice(0, 6).join(" | ") || "(无)");
await page.locator('button').filter({ hasText: /新建|创建|上传|添加/ }).first().click().catch(() => {});
await sleep(1800);
const afterBody = await bodyTxt();
console.log("  点创建后出现表单/选择器:", afterBody.length > beforeBody.length + 50 ? "✓ 有交互" : "?", "| 含连接器类型选择:", /类型|sap|jdbc|rest|file|csv|上传/i.test(afterBody) ? "✓" : "?");
await page.screenshot({ path: `${OUT}/sweep-connectors.png`, fullPage: true });

console.log("\n=== 汇总 issues ===");
issues.length ? issues.forEach((i) => console.log("  ⚠️ " + i)) : console.log("  (无掉登录/console错/错误提示)");
await browser.close();
