// C3 rollback drill (flag OFF): script lens tab hidden + no BUILD_CLOSURE rows =
// back to pre-change query-target board. Frontend real browser.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const FRONT = "http://127.0.0.1:5211";
const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find(existsSync);
let fail = 0; const ok = (m) => console.log("  PASS", m); const bad = (m) => { console.error("  FAIL", m); fail++; };
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });
let netBoard = null;
page.on("response", async (resp) => { if (resp.url().includes("/growth/board")) { try { netBoard = await resp.json(); } catch {} } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]"); await page.waitForTimeout(2500);
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForSelector("[data-testid=tc-source-lens]", { timeout: 12000 });
  await page.waitForTimeout(600);
  // buildClosureEnabled false in the board response the frontend received
  (netBoard && netBoard.buildClosureEnabled === false) ? ok(`前端收到 buildClosureEnabled=false（暗发关闸）`) : bad(`buildClosureEnabled 非 false: ${netBoard && netBoard.buildClosureEnabled}`);
  // C3: script lens tab HIDDEN
  const scriptTab = await page.locator("[data-testid=tc-source-script]").count();
  scriptTab === 0 ? ok("C3 回退：source 透镜无「script 目标」tab（关闸隐藏）") : bad(`C3 script 透镜未隐藏 count=${scriptTab}`);
  // other lenses still present (board still the pre-change query-target console)
  for (const k of ["all", "query", "conv"]) {
    const n = await page.locator(`[data-testid=tc-source-${k}]`).count();
    n === 1 ? ok(`C3 透镜「${k}」仍在（改造前 board 保留）`) : bad(`C3 透镜「${k}」count=${n}`);
  }
  // no BUILD_CLOSURE rows anywhere
  await page.click("[data-testid=tc-source-all]").catch(() => {});
  await page.waitForTimeout(400);
  const sbc = await page.locator("[data-testid^=tc-row-sbc_]").count();
  sbc === 0 ? ok("C3 回退：board 无 BUILD_CLOSURE 行 = 现状 query 目标 board") : bad(`C3 board 仍含 ${sbc} 个 BUILD_CLOSURE 行`);
  await page.screenshot({ path: `${SHOT}/rev-console-off.png`, fullPage: true });
  ok(`证据截图 → ${SHOT}/rev-console-off.png`);
} catch (e) { bad(`异常: ${String((e && e.stack) || e).slice(0, 400)}`); } finally { await b.close(); }
console.log(`\n=== verify-OFF ${fail ? "FAIL(" + fail + ")" : "ALL PASS"} ===`);
process.exit(fail ? 1 : 0);
