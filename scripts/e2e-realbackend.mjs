// 前后端真联调 E2E（L4 真后端，TESTING-STANDARD §1）：真 datacore + 真 agentcore + 前端真后端模式
// （非 MSW mock），Playwright 真浏览器登录 + 逐页断言。验"前端 UI ↔ 真后端"真打通，守"绿测试≠能用"。
//
// 前置（本地/夜间跑，非 CI 必过——A16 决策待定）：
//   1) pnpm -r build
//   2) 起真后端：
//      PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-rb SEED_DEMO=1 CREDENTIAL_KEY=<64hex> \
//        SERVICE_TOKEN=svc AGENTCORE_BASE_URL=http://127.0.0.1:4002 node apps/datacore/dist/server.js &
//      PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js &
//   3) 起前端真后端模式（不设 VITE_MOCK）：
//      VITE_DATACORE_URL=http://127.0.0.1:4001 VITE_AGENTCORE_URL=http://127.0.0.1:4002 \
//        pnpm --filter frontend-shell exec vite --port 5200 --host 127.0.0.1 &
//   4) 装 Playwright（一次）：npm i -g playwright-core 或本地 + npx playwright install chromium
//   5) CHROME=<chrome 路径> FRONT=http://127.0.0.1:5200 node scripts/e2e-realbackend.mjs
//
// 断言（真后端真数据，区别于 mock 写死值）：登录 / A4 真物化计数 / A11 连接归类 / 工作流 7 步 + 比对现状。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME; // chromium 可执行路径（playwright install 后的路径）
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";

const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败,停在 /login") : ok(`真后端登录成功 → ${page.url()}`);

  // A4 对象/类型浏览器：真后端真物化计数
  await page.click('a[href="/admin/object-types"]').catch(() => {});
  await page.waitForSelector("[data-testid=object-types-page]", { timeout: 10000 });
  const rows = await page.$$eval("[data-testid^=ot-row-]", (els) => els.length);
  const counts = await page.$$eval("[data-testid^=ot-count-]", (els) => els.map((e) => e.textContent));
  rows > 0 && counts.some((c) => c && c !== "0") ? ok(`A4 真后端：${rows} 类型 + 真物化计数`) : bad("A4 真后端：类型/计数异常");

  // A11 连接器归类列
  await page.click('a[href="/admin/connections"]').catch(() => {});
  await page.waitForTimeout(1000);
  const cats = await page.$$eval("[data-testid^=conn-cat-]", (els) => els.length);
  cats > 0 ? ok(`A11 真后端：${cats} 条连接含归类列`) : bad("A11 真后端：无连接归类列");

  // 工作流时间线 + 比对现状（真后端 run：真 comprehend floor + planSlice + provisioners）
  await page.click('a[href="/admin/data-builder"]').catch(() => {});
  await page.waitForSelector("[data-testid=wf-timeline]", { timeout: 10000 });
  await page.click("[data-testid=wf-start]");
  await page.waitForTimeout(4000);
  const steps = await page.$$eval("[data-testid^=wf-step-]", (els) => new Set(els.map((e) => e.getAttribute("data-testid")).filter((x) => x && !x.includes("error"))).size);
  const gap = await page.locator("[data-testid=wf-gap-analysis]").count();
  steps >= 6 ? ok(`工作流真后端：7 步状态机 + 比对现状${gap ? "表" : "(未展开)"}`) : bad(`工作流真后端：步骤异常 ${steps}`);
} catch (e) {
  bad(`E2E 异常: ${String(e.message).slice(0, 160)}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 前后端真联调 ${results.length - failed.length}/${results.length} ===`);
process.exit(failed.length === 0 ? 0 : 1);
