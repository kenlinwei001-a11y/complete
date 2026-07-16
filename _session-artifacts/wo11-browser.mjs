import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(2000);
const nav=async(p)=>{await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));},p);await sleep(2600);};

// ===== 子项1: data-health 徽章一致（来源系统总览）=====
console.log("=== 子项1: 来源系统总览徽章一致（非 critical 源超阈不显矛盾「正常」）===");
await nav("/admin/source-overview");
const b1 = await page.locator("body").innerText().catch(()=>"");
// 找同时出现"正常/OK"徽章 + "超阈/⚠/延迟"的源——矛盾
const hasContradiction = /正常[\s\S]{0,40}(超阈|超出|延迟|⚠)/.test(b1) || /(超阈|⚠)[\s\S]{0,12}正常/.test(b1);
const rendered = /来源系统|源系统|数据健康|新鲜度|延迟|阈值|objectCount|对象/.test(b1);
console.log("  页面渲染:", rendered?"✓":"?", "| 徽章自相矛盾(正常↔超阈并存):", hasContradiction?"✗仍矛盾":"✓未见矛盾");
await page.screenshot({ path: `${OUT}/wo11-1-sourceoverview.png`, fullPage: true });

// ===== 子项4: F5 不掉登录（深链刷新经 silentRefresh 续期）=====
console.log("\n=== 子项4: 深链 F5 不掉登录（dev 只 vitest·审核方真浏览器复拍）===");
await nav("/admin/object-types"); await sleep(1500);
const beforeUrl = page.url();
console.log("  深链:", beforeUrl);
// 真 F5：整页 reload（内存 token 丢→应靠 refresh cookie 静默续期）
await page.reload({ waitUntil: "networkidle" }).catch(()=>{});
await sleep(3500);
const afterUrl = page.url();
const onLogin = /\/login/.test(afterUrl);
const b4 = await page.locator("body").innerText().catch(()=>"");
const stillIn = !onLogin && /对象|类型|就绪|admin|登出|退出/.test(b4) && !/登录|密码|password/i.test(b4.slice(0,200));
console.log("  F5 后 URL:", afterUrl);
console.log("  判据(F5 不掉登录·停在深链·已登录):", stillIn?"✅ 通过(silentRefresh 续期·未跳 /login)":(onLogin?"✗ 掉登录(跳 /login)":"? 看截图"));
await page.screenshot({ path: `${OUT}/wo11-4-f5.png`, fullPage: true });
await browser.close();
console.log("\n截图: wo11-1-sourceoverview · wo11-4-f5");
