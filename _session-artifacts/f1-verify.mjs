import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(1800);
const nav=async(p)=>{await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));},p);await sleep(2600);};
// 对象浏览器：Customer 应显 11
await nav("/admin/object-types");
const b=await page.locator("body").innerText().catch(()=>"");
const custLine=(b.split("\n").find(l=>/客户|Customer/.test(l))||"").trim();
console.log("对象浏览器 Customer 行:", custLine.slice(0,60));
console.log("页面含 '11':", /客户[\s\S]{0,40}11|11[\s\S]{0,20}客户/.test(b)?"✓(新上传可见)":"(看截图)");
await page.screenshot({ path: `${OUT}/f1v-objbrowser.png`, fullPage: true });
// 连接器页：应见新的 file_upload + prototype_html 连接
await nav("/admin/connections");
const b2=await page.locator("body").innerText().catch(()=>"");
console.log("连接器页含 maint-schedule/客户主数据原型:", /maint|检修|客户主数据|原型|file_upload|prototype/i.test(b2)?"✓(新连接可见)":"(看截图)");
await page.screenshot({ path: `${OUT}/f1v-connections.png`, fullPage: true });
await browser.close();
console.log("截图: f1v-objbrowser · f1v-connections");
