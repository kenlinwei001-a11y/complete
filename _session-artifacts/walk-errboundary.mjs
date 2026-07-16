import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2500); };
const len = async () => ((await page.locator("body").innerText().catch(() => "")) || "").length;
const isErr = async () => /出错|出了点问题|ErrorBoundary|something went wrong|重试|刷新页面|Error/i.test((await page.locator("body").innerText().catch(() => "")) || "");

console.log("=== ErrorBoundary 是否随路由复位 ===");
await nav("/admin/synthetic"); console.log("  1) synthetic 正常页 正文长度:", await len(), "| 错误态:", await isErr() ? "是" : "否");
await nav("/admin/quarantine"); console.log("  2) quarantine(已知崩) 正文长度:", await len(), "| 错误态:", await isErr() ? "⚠️是(崩)" : "否");
await page.screenshot({ path: `${OUT}/eb-quarantine.png`, fullPage: true });
await nav("/admin/synthetic"); const l3 = await len(); const e3 = await isErr();
console.log("  3) 再回 synthetic 正文长度:", l3, "| 错误态:", e3 ? "⚠️是" : "否", "→", e3 || l3 < 700 ? "✗ 卡在错误态(ErrorBoundary 不随路由复位·一崩全崩需整页刷新)" : "✓ 恢复正常");
await nav("/admin/domains"); console.log("  4) 再去 domains 正文长度:", await len(), "| 错误态:", await isErr() ? "⚠️仍卡" : "否");
// 整页 reload 看是否恢复
await page.reload({ waitUntil: "networkidle" }).catch(() => {}); await sleep(2500);
console.log("  5) 整页 reload 后 domains:", await isErr() ? "⚠️仍错(或掉登录)" : "正文" + (await len()) + (((await page.url()).includes("/login")) ? "·掉登录" : "·恢复"));
await page.screenshot({ path: `${OUT}/eb-after-reload.png`, fullPage: true });
await browser.close();
