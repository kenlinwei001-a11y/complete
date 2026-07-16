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
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(()=>{}); await sleep(1800);
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2600); };
const body = async () => (await page.locator("body").innerText().catch(() => "")) || "";

console.log("=== 数据接入落点：对象类型 → 看实例 → 对象 360 ===");
await nav("/admin/object-types");
// 点第一个「看实例 →」
const seeBtn = page.locator('button:has-text("看实例")').first();
const n = await seeBtn.count().catch(()=>0);
console.log("「看实例」按钮数:", await page.locator('button:has-text("看实例")').count().catch(()=>0));
await seeBtn.click().catch((e)=>console.log("click err", String(e).slice(0,80)));
await sleep(2600);
console.log("点看实例后 URL:", page.url());
const b1 = await body();
const instRows = await page.locator('table tbody tr, [class*="card"], li').count().catch(()=>0);
console.log("实例列表 行/卡:", instRows, "| 文本", b1.replace(/\s+/g,"").length, "字");
await page.screenshot({ path: `${OUT}/f1b-instances.png`, fullPage: true });

// 点第一个对象实例 → Object360 (/o/:typeKey/:objectKey)
const objLink = page.locator('a[href*="/o/"], table tbody tr a, button:has-text("详情"), [data-testid^="obj-row"]').first();
const hasObj = await objLink.count().catch(()=>0);
if (hasObj) {
  await objLink.click().catch(()=>{});
  await sleep(2600);
  console.log("点实例后 URL:", page.url(), "| 是 /o/ 对象360页:", /\/o\//.test(page.url()) ? "✓" : "?");
  const b2 = await body();
  console.log("对象360 文本", b2.replace(/\s+/g,"").length, "字 | 含属性/派生/血缘:", /属性|派生|血缘|来源|provenance|360/i.test(b2)?"✓":"?");
  await page.screenshot({ path: `${OUT}/f1b-object360.png`, fullPage: true });
} else {
  console.log("⚠️ 实例列表无可点进 360 的链接（用 URL 直达验证）");
  await nav("/o/Equipment/EQ-001");
  console.log("直达 /o/Equipment/EQ-001 URL:", page.url());
  await page.screenshot({ path: `${OUT}/f1b-object360-direct.png`, fullPage: true });
}

// 连接器页快照
console.log("\n=== 连接器与上传页 ===");
await nav("/admin/connections");
const bc = await body();
const upBtn = await page.locator('button:has-text("上传"), button:has-text("新建"), input[type="file"]').count().catch(()=>0);
console.log("连接器页 含上传/新建入口:", upBtn>0?"✓":"✗", "| 文本", bc.replace(/\s+/g,"").length, "字");
await page.screenshot({ path: `${OUT}/f1b-connections.png`, fullPage: true });
await browser.close();
console.log("\n截图: f1b-instances · f1b-object360 · f1b-connections");
