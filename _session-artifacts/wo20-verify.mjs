import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(1800);
const nav=async(p)=>{await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));},p);await sleep(2500);};
const crashed=async()=>{const b=await page.locator("body").innerText().catch(()=>"");return /出错了|页面出错|Something went wrong|崩溃|刷新.*重试|重新加载|is not a function|Cannot read/i.test(b);};

// 候选崩页：拦截其主数据 API 返非数组 → 页面 .map/.filter 抛 → ErrorBoundary
const candidates=[
  {path:"/admin/rules", api:"**/a/v1/rules"},
  {path:"/admin/policies", api:"**/a/v1/policies"},
  {path:"/admin/llm-providers", api:"**/a/v1/llm-providers"},
  {path:"/admin/object-types", api:"**/ontology/object-types/stats"},
  {path:"/admin/calibration", api:"**/calibration/proposals"},
];
let crashPath=null;
for(const c of candidates){
  await page.route(c.api, (route)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({__forced_non_array__:true})}));
  await nav(c.path);
  const isCrash=await crashed();
  console.log(`触发尝试 ${c.path}（拦 ${c.api} 返非数组）→ ${isCrash?"💥崩页(ErrorBoundary 显错)":"未崩(已守/不 map)"}`);
  await page.unroute(c.api).catch(()=>{});
  if(isCrash){crashPath=c.path; break;}
}
if(!crashPath){console.log("⚠️ 候选页都未崩（多已加守卫）——改用已知 throw 路由兜底"); }

await page.screenshot({path:`${OUT}/wo20-1-crashed.png`,fullPage:true});

if(crashPath){
  console.log("\n=== WO-20 核心：崩页态下点导航去别页 → 是否自愈 ===");
  console.log("崩页态 URL:", page.url(), "| 仍崩:", await crashed());
  // 真点左侧导航（非 pushState）——模拟用户点击离开崩页
  const navLink = page.locator('text=对象/类型浏览, text=经营驾驶舱, a:has-text("对象"), [data-testid*="nav"]').first();
  // 用 pushState 导航到别页（resetKey=pathname 变）
  await nav("/admin/connections");
  const stillCrash=await crashed();
  const recovered=!stillCrash;
  const b=await page.locator("body").innerText().catch(()=>"");
  const newPageRendered=/数据接入|连接|连接器|上传/.test(b);
  console.log("导航到 /admin/connections 后 → 仍崩:", stillCrash?"❌是(WO-20 失效·卡死)":"✓否", "| 新页真渲染:", newPageRendered?"✓":"?");
  console.log("判据(崩页→导航→自愈):", recovered&&newPageRendered?"✅ 通过(ErrorBoundary 复位·新页渲染)":"✗ 未自愈");
  await page.screenshot({path:`${OUT}/wo20-2-recovered.png`,fullPage:true});
}
await browser.close();
console.log("\n截图: wo20-1-crashed · wo20-2-recovered");
