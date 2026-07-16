// INDEPENDENT reviewer verification (flag ON). Reads DOM the user sees, fetches backend
// endpoints itself, asserts value-by-value. Does NOT trust dev evidence.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const FRONT = "http://127.0.0.1:5211";
const AC = "http://127.0.0.1:4112";
const ADMIN = "demo:user-admin:admin|catalog_admin|planner";
const SHOT = process.env.SHOT || "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find(existsSync);

// allowed token colors (zero new colors)
const TOK = { blue: "rgb(91, 124, 250)", amber: "rgb(232, 181, 74)", green: "rgb(98, 190, 119)", red: "rgb(224, 98, 108)", muted: "rgb(174, 184, 201)" };
const ALLOWED = new Set(Object.values(TOK));

let fail = 0;
const ok = (m) => console.log("  PASS", m);
const bad = (m) => { console.error("  FAIL", m); fail++; };
const eq = (a, b, m) => (String(a) === String(b) ? ok(`${m} [${a}]`) : bad(`${m}: DOM<${a}> !== BE<${b}>`));

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });
const netUrls = [];
let netBoard = null, netDetail = null;
page.on("request", (r) => { const u = r.url(); if (/growth\/(board|tickets)/.test(u)) netUrls.push(u); });
page.on("response", async (resp) => {
  const u = resp.url();
  if (u.includes("/growth/board")) { try { netBoard = await resp.json(); } catch {} }
  if (u.includes("/growth/tickets/") && u.includes("/detail")) { try { netDetail = await resp.json(); } catch {} }
});

try {
  // --- login ---
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`登录成功 → ${page.url()}`);

  // --- nav to unified console (SPA, keep in-memory token) ---
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForSelector("[data-testid=ticket-center-page]", { timeout: 12000 });
  await page.waitForSelector("[data-testid=tc-source-lens]", { timeout: 8000 });
  ok("统一工单中心 Console + source 透镜渲染");

  // --- prove real backend (not MSW mock) ---
  const hitAC = netUrls.some((u) => u.includes("127.0.0.1:4112"));
  hitAC ? ok(`前端真调 agentcore:4112（非 mock）· ${netUrls.filter(u=>u.includes('4112')).length} 次 growth 请求`) : bad("前端未命中真 agentcore（可能 mock）");

  // === C2: lens tabs present (flag ON → script tab shows) ===
  for (const [k, present] of [["all", 1], ["query", 1], ["script", 1], ["conv", 1]]) {
    const n = await page.locator(`[data-testid=tc-source-${k}]`).count();
    n === present ? ok(`C2 透镜 tab「${k}」存在`) : bad(`C2 透镜 tab「${k}」count=${n}`);
  }

  // === discover the BUILD_CLOSURE row id from DOM ===
  await page.waitForSelector("[data-testid^=tc-row-sbc_]", { timeout: 8000 });
  const sbcId = (await page.locator("[data-testid^=tc-row-sbc_]").first().getAttribute("data-testid")).replace("tc-row-", "");
  ok(`发现 BUILD_CLOSURE 行 id=${sbcId}`);

  // fetch backend board MYSELF (independent truth)
  const beBoard = await fetch(`${AC}/api/v1/growth/board`, { headers: { "x-debug-user": ADMIN } }).then((r) => r.json());
  const beRow = beBoard.items.find((r) => r.id === sbcId);
  if (!beRow) { bad("后端 board 无此行"); throw new Error("no be row"); }

  // === C1: DOM cell values vs backend truth (value-by-value) ===
  const domFromQ = (await page.locator(`[data-testid="tc-row-${sbcId}"] td`).nth(0).textContent()) ?? "";
  const domGap = (await page.locator(`[data-testid="tc-row-${sbcId}"] td.mono`).first().textContent()) ?? "";
  const domKind = (await page.locator(`[data-testid="tc-kind-${sbcId}"]`).textContent()) ?? "";
  const domSrc = (await page.locator(`[data-testid="tc-source-badge-${sbcId}"]`).textContent()) ?? "";
  const domStatus = (await page.locator(`[data-testid="tc-status-${sbcId}"]`).textContent()) ?? "";
  eq(domFromQ.trim(), beRow.fromQuestion, "C1 fromQuestion");
  eq(domGap.trim(), beRow.gapCode, "C1 gapCode");
  eq(domStatus.trim(), beRow.status, "C1 status");
  domKind.includes("建域闭包缺口") ? ok(`C1 kind 标签「${domKind.trim()}」`) : bad(`C1 kind 标签异常: ${domKind}`);
  (beRow.source === "BUILD_CLOSURE" && domSrc.includes("script 建域")) ? ok(`C1 source 徽章「${domSrc.trim()}」= BE source ${beRow.source}`) : bad(`C1 source 徽章/后端不符: DOM<${domSrc}> BE<${beRow.source}>`);

  // === C2: source badge color = existing token (zero new color) ===
  const srcColor = await page.locator(`[data-testid="tc-source-badge-${sbcId}"]`).evaluate((el) => getComputedStyle(el).color);
  (srcColor === TOK.amber) ? ok(`C2 source 徽章 computed color = amber token ${srcColor}`) : bad(`C2 source 徽章色非 amber token: ${srcColor}`);
  // sweep ALL badges on page — every color must ∈ allowed token set
  const allColors = await page.locator(".badge").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const badColors = [...new Set(allColors)].filter((c) => !new Set(["rgb(91, 124, 250)","rgb(232, 181, 74)","rgb(98, 190, 119)","rgb(224, 98, 108)","rgb(174, 184, 201)"]).has(c));
  badColors.length === 0 ? ok(`C2 零新色：全部 ${allColors.length} 徽章色 ∈ 既有 token（去重 ${new Set(allColors).size} 种）`) : bad(`C2 发现新色: ${JSON.stringify(badColors)}`);

  // === C2: lens switching real-run ===
  const cntSbc = () => page.locator("[data-testid^=tc-row-sbc_]").count();
  const cntRows = () => page.locator("[data-testid^=tc-row-]").count();
  await page.click("[data-testid=tc-source-script]"); await page.waitForTimeout(500);
  const scriptSbc = await cntSbc(), scriptTot = await cntRows();
  (scriptSbc > 0 && scriptSbc === scriptTot) ? ok(`C2 透镜=script：仅 BUILD_CLOSURE 行（${scriptSbc}/${scriptTot}）`) : bad(`C2 script 透镜异常 sbc=${scriptSbc} tot=${scriptTot}`);
  // active lens button color = blue token
  const scriptBtnColor = await page.locator("[data-testid=tc-source-script]").evaluate((el) => getComputedStyle(el).color);
  (scriptBtnColor === TOK.blue) ? ok(`C2 选中透镜按钮 color = blue token ${scriptBtnColor}`) : bad(`C2 选中透镜按钮色非 blue token: ${scriptBtnColor}`);
  await page.click("[data-testid=tc-source-query]"); await page.waitForTimeout(500);
  const querySbc = await cntSbc();
  querySbc === 0 ? ok("C2 透镜=query：BUILD_CLOSURE 行隐（收窄=改造前 query 目标视图）") : bad(`C2 query 透镜未收窄 sbc=${querySbc}`);
  await page.click("[data-testid=tc-source-conv]"); await page.waitForTimeout(400);
  const convSbc = await cntSbc();
  convSbc === 0 ? ok("C2 透镜=对话缺口：BUILD_CLOSURE 行隐") : bad(`C2 conv 透镜未收窄 sbc=${convSbc}`);
  await page.click("[data-testid=tc-source-all]"); await page.waitForTimeout(400);
  const allSbc = await cntSbc();
  allSbc > 0 ? ok("C2 透镜=全部：BUILD_CLOSURE 行复现") : bad("C2 全部透镜未复现 sbc 行");

  // === C1: detail drawer — closure block value-by-value vs backend ===
  await page.locator(`[data-testid="tc-row-${sbcId}"]`).click();
  await page.waitForSelector("[data-testid=tc-d-closure]", { timeout: 8000 });
  ok("C1 详情抽屉「全链闭包逐段」块渲染");
  const beDetail = await fetch(`${AC}/api/v1/growth/tickets/${sbcId}/detail`, { headers: { "x-debug-user": ADMIN } }).then((r) => r.json());
  const c = beDetail.supply.closure;
  const uiGate = ((await page.locator("[data-testid=tc-d-closure-gate]").textContent()) ?? "").trim();
  const uiCounts = ((await page.locator("[data-testid=tc-d-closure-counts]").textContent()) ?? "").replace(/\s+/g, " ").trim();
  const expCounts = `objectsBound=${c.counts.objectsBound} · dataOrphans=${c.counts.dataOrphans} · forwardMissing=${c.counts.forwardMissing} · chainBroken=${c.counts.chainBroken} · shapeBroken=${c.counts.shapeBroken}`;
  eq(uiGate, c.gatePassed ? "通过" : "未通过", "C1 闭包闸");
  (uiCounts === expCounts) ? ok(`C1 counts 逐值对照 = 后端 [${expCounts}]`) : bad(`C1 counts 不符: UI<${uiCounts}> BE<${expCounts}>`);
  // every backend segment kind → a DOM segment row; check CHAIN=FAILED specifically
  for (const kind of [...new Set(c.segments.map((s) => s.kind))]) {
    const n = await page.locator(`[data-testid=tc-d-closure-seg-${kind}]`).count();
    n > 0 ? ok(`C1 逐段渲染 ${kind}（${n} 行）`) : bad(`C1 缺逐段 ${kind}`);
  }
  const chainRow = page.locator("[data-testid=tc-d-closure-seg-CHAIN]").first();
  const chainTxt = (await chainRow.textContent()) ?? "";
  chainTxt.includes("FAILED") ? ok(`C1 CHAIN 段状态=FAILED（真 MISSING 段·${chainTxt.replace(/\s+/g," ").trim().slice(0,80)}）`) : bad(`C1 CHAIN 段非 FAILED: ${chainTxt}`);
  // cross-check: frontend's OWN network detail == my independent fetch (proves not fabricated)
  if (netDetail && netDetail.supply && netDetail.supply.closure) {
    const nc = netDetail.supply.closure.counts;
    JSON.stringify(nc) === JSON.stringify(c.counts) ? ok("C1 前端网络 detail == 独立后端 detail（同源真值·非编造）") : bad(`C1 前端网络 detail 与后端不符: ${JSON.stringify(nc)} vs ${JSON.stringify(c.counts)}`);
  } else bad("C1 未捕获前端 detail 网络响应");

  await page.screenshot({ path: `${SHOT}/rev-console-on.png`, fullPage: true });
  ok(`证据截图 → ${SHOT}/rev-console-on.png`);
} catch (e) {
  bad(`异常: ${String((e && e.stack) || e).slice(0, 500)}`);
} finally { await b.close(); }
console.log(`\n=== verify-ON ${fail ? "FAIL(" + fail + ")" : "ALL PASS"} ===`);
process.exit(fail ? 1 : 0);
