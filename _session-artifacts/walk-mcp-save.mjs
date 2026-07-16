import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
const errs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 90)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/mcp"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(2800);

const NAME = "test-mcp-" + "verify";
console.log("=== #2 MCP 保存真验 ===");
// 点"新建"
await page.locator('text=新建').first().click().catch(() => {});
await sleep(1500);
// 填 name（第一个文本输入）+ url
const textInputs = page.locator('input[type="text"], input:not([type])');
const n = await textInputs.count();
console.log("  表单文本输入框数:", n);
await textInputs.nth(0).fill(NAME).catch(() => {});
// url 输入：找含 http 或 url 的输入；兜底填第 2 个
let urlFilled = false;
for (let i = 0; i < n; i++) {
  const ph = (await textInputs.nth(i).getAttribute("placeholder").catch(() => "")) || "";
  if (/url|http|端点|地址/i.test(ph) || i === 1) { await textInputs.nth(i).fill("https://example.com/mcp").catch(() => {}); urlFilled = true; break; }
}
console.log("  填 name + url:", urlFilled ? "✓" : "url未定位");
await page.screenshot({ path: `${OUT}/mcp-save-form-filled.png`, fullPage: true });
// 点保存
const saved = await page.locator('button:has-text("保存")').first().click().then(() => true).catch(() => false);
console.log("  点保存:", saved ? "✓" : "✗未找到保存按钮");
await sleep(2500);
const body = (await page.locator("body").innerText().catch(() => ""));
console.log("  出现「已保存」toast:", /已保存/.test(body) ? "✓" : "?");
console.log("  列表出现新 MCP 名:", body.includes(NAME) ? "✓ 持久化可见" : "?");
await page.screenshot({ path: `${OUT}/mcp-save-after.png`, fullPage: true });

// 后端确证持久化
const tok = await page.evaluate(async () => {
  const t = (window.localStorage.getItem("token") || ""); return t;
});
console.log("\n  控制台 error:", errs.length, errs.slice(0, 3));
await browser.close();
