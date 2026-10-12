/* eslint-disable */
/**
 * WO-ADOPTION-SURVIVES-FIX · 真浏览器取证（从登录走起 · ⛔ 禁 VITE_MOCK）。
 *
 * ⚠ 三个实测坑，本脚本逐条避开（不是"注意一下"，是代码里真避开了）：
 *  ① **截图落点是 `process.cwd()` 相对** —— 从子目录跑图会落进嵌套目录，而脚本照样 RC=0、
 *     回包里还是那个 basename ⇒ 报告会把上次的旧图当本次证据。
 *     本脚本把 `E2E_SHOTS` **锚到 `import.meta.url`**，与 cwd 无关，并在每张图后回显**绝对路径 + mtime**。
 *  ② **`lib.mjs` 的 `assertNoMock` 端口写死 4001/4002** —— 换端口会恒报「疑似 mock」。
 *     本脚本自带 `realHits()`，端口从 `DC_PORT`/`AC_PORT` 读。
 *  ③ **`ss` 在本机看不见别人的 socket** —— 端口可用性由调用方真 bind 过，脚本不再猜。
 *
 * 采纳走**真两级审批**（planner → admin ⇒ EXECUTED），用浏览器登录拿到的真 JWT 打真 REST。
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 坑① 的对策：锚到本文件所在目录，**不用 process.cwd()**。
const SHOT_DIR = process.env.E2E_SHOTS ?? path.join(HERE, "shots-adoption");
mkdirSync(SHOT_DIR, { recursive: true });

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5191";
const DC = process.env.DC_URL ?? "http://127.0.0.1:4171";
const TAG = process.env.TAG ?? "post";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 坑① 对策的另一半：每张图回显绝对路径 + 字节数 + mtime，让"旧图冒充新图"当场露馅。 */
async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${TAG}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const st = statSync(file);
  console.log(`  📷 ${file}  ${st.size}B  mtime=${st.mtime.toISOString()}`);
  return file;
}

/** 坑② 对策：端口参数化的「真后端」判据（不是靠「我没设 VITE_MOCK」自证）。 */
function realHits(netLog) {
  const dcPort = new URL(DC).port;
  const re = new RegExp(`127\\.0\\.0\\.1:(${dcPort}|${process.env.AC_PORT ?? "4172"})`);
  const real = netLog.filter((e) => re.test(e.url) && e.status >= 200 && e.status < 400);
  return { ok: real.length > 0, hits: real.length, sample: real.slice(0, 4).map((e) => `${e.status} ${e.method} ${e.url}`) };
}

const api = async (token, method, url, body) => {
  const res = await fetch(DC + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

/** 真两级审批链：planner 批一步、admin 批一步 ⇒ EXECUTED。角色按待批步骤取，不写死。 */
async function adopt(tokens, payload) {
  const created = await api(tokens.admin, "POST", "/a/v1/action-drafts", {
    actionTypeKey: "adopt_mitigation",
    payload,
    submit: true,
  });
  if (created.status >= 300) throw new Error("建草稿失败 " + JSON.stringify(created));
  const id = created.json.draftId;
  const seen = [];
  for (let g = 0; g < 6; g++) {
    const cur = await api(tokens.admin, "GET", `/a/v1/action-drafts/${id}`);
    if (cur.json.status !== "PENDING_APPROVAL") return { status: cur.json.status, steps: seen, result: cur.json.executionResult };
    const pending = cur.json.approvalSteps.find((s) => !s.decision);
    seen.push(pending.role);
    const r = await api(tokens[pending.role], "POST", `/a/v1/action-drafts/${id}/approve`, {});
    if (r.status >= 300) throw new Error(`approve(${pending.role}) 失败 ` + JSON.stringify(r));
  }
  throw new Error("审批链未收敛");
}

const loginApi = async (username) => {
  const res = await fetch(DC + "/a/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username, password: "demo1234" }),
  });
  const j = await res.json();
  if (!j.accessToken) throw new Error(`登录 ${username} 失败：` + JSON.stringify(j));
  return j.accessToken;
};

const run = async () => {
  const out = { tag: TAG, base: BASE, dc: DC, at: new Date().toISOString() };

  // ── 0. 先用真审批链把采纳做掉（两条：一条 top-8 截断路，一条真消解路）────────────
  // `SKIP_ADOPT=1` = **会话 B**：不采纳任何东西，只验「上一个会话采纳的那条还查不查得到」。
  if (process.env.SKIP_ADOPT === "1") {
    out.skipAdopt = "会话 B：本次一条都没采纳，屏上出现的记录只能来自会话 A";
    const t = await loginApi(process.env.E2E_USER ?? "admin");
    const objs = await api(t, "GET", "/a/v1/objects?type=AdoptedMitigation&pageSize=500");
    const items = (objs.json && objs.json.items) || [];
    out.ledgerObjectsSeenBySessionB = {
      total: items.length,
      active: items.filter((o) => o.props.status === "ACTIVE").length,
      hasSessionField: items.some((o) => Object.keys(o.props).some((k) => /session/i.test(k))),
    };
    console.log("会话 B 直接查台账对象:", JSON.stringify(out.ledgerObjectsSeenBySessionB));
  } else {
    const tokens = { admin: await loginApi("admin"), planner: await loginApi("planner") };
    out.adoptTruncate = await adopt(tokens, { base: "changzhou", factor: "瓶颈工序", planKey: "reroute" });
    out.adoptResolved = await adopt(tokens, { base: "jiangmen", factor: "物料齐套", planKey: "air_freight" });
    console.log("采纳①(常州·瓶颈工序·reroute):", JSON.stringify(out.adoptTruncate));
    console.log("采纳②(江门·物料齐套·air_freight):", JSON.stringify(out.adoptResolved));
  }

  // ── 1. 真浏览器，**从登录走起**，⛔ 不手敲 URL ──────────────────────────────
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1180 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const netLog = [];
  page.on("response", (r) => netLog.push({ url: r.url(), status: r.status(), method: r.request().method() }));
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-username", { timeout: 30000 });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", process.env.E2E_USER ?? "admin");
  await page.fill("#login-password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  out.afterLoginUrl = page.url();
  await shot(page, "01-home");

  // 点导航进风险板（不 goto）
  const link = await page.$('a[href="/v/risk"]');
  if (!link) throw new Error("导航里找不到风险板入口");
  await link.click({ timeout: 10000 });
  await sleep(11000);
  out.riskUrl = page.url();

  // ── 2. 金丝雀（实验 5）：先拿一个**确定在屏上**的串同尺子扫一遍 ────────────────
  const bodyText = await page.$eval("body", (e) => e.innerText);
  out.canary = {
    admin: bodyText.includes("admin"),
    产能推演: bodyText.includes("产能推演"),
    note: "两者任一为 false ⇒ 报「量法坏了」，不许报「记录没了」",
  };

  // ── 3. 当前风险卡数（实验 3 的那个数）+ 台账记号 ──────────────────────────────
  out.riskCardCount = await page.$$eval('[data-testid^="risk-exposure-line-"]', (els) => els.length);
  out.kpiRiskBases = await page.$eval('[data-testid="risk-kpi-bases"]', (e) => e.innerText.replace(/\s+/g, " ")).catch(() => null);
  const sub = await page.$(".rkSub, [class*='rkSub']");
  out.metaLine = sub ? (await sub.innerText()).replace(/\s+/g, " ") : null;
  out.ledgerMarkerOnScreen = /已处置\s*\d+\s*条/.test(bodyText);
  out.ledgerMarkerText = (bodyText.match(/已处置\s*\d+\s*条/) || [null])[0];
  // 常州 / 江门 还在不在看板上
  out.changzhouOnBoard = bodyText.includes("常州");
  out.jiangmenOnBoard = bodyText.includes("江门");
  await shot(page, "02-riskboard");

  // ── 4. 打开台账浮层，把屏上原文抓下来 ────────────────────────────────────────
  const trigger = await page.$('[data-testid="info-risk-adoption-ledger"]');
  out.ledgerTriggerPresent = trigger !== null;
  if (trigger) {
    await trigger.hover();
    await sleep(900);
    const body = await page.$('[data-testid="risk-adoption-ledger-body"]');
    out.ledgerBodyText = body ? (await body.innerText()).replace(/\s+/g, " ") : null;
    out.ledgerRows = await page.$$eval('[data-testid^="risk-adoption-row-"]', (els) =>
      els.map((e) => ({
        testid: e.getAttribute("data-testid"),
        state: e.getAttribute("data-state"),
        onBoard: e.getAttribute("data-onboard"),
        plan: e.getAttribute("data-plan"),
        nameResolved: e.getAttribute("data-name-resolved"),
        text: e.innerText.replace(/\s+/g, " "),
      })),
    );
    await shot(page, "03-ledger-popover");
  } else {
    out.ledgerBodyText = null;
    out.ledgerRows = [];
    await shot(page, "03-ledger-ABSENT");
  }

  // ── 5. 真后端自证（坑② 的对策：端口参数化）───────────────────────────────────
  out.realBackend = realHits(netLog);
  out.riskTimelineCalls = netLog.filter((e) => /risk_timeline/.test(e.url)).map((e) => `${e.status} ${e.url}`);
  out.consoleErrors = consoleErrors.slice(0, 5);
  out.serviceWorker = await page.evaluate(() => ("serviceWorker" in navigator ? navigator.serviceWorker.controller !== null : false));

  await browser.close();
  console.log("\n===== RESULT " + TAG + " =====");
  console.log(JSON.stringify(out, null, 1));
};
run().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
