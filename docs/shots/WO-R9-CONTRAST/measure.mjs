#!/usr/bin/env node
/**
 * 真浏览器对比度测量 —— WO-R9-CONTRAST
 * 用法：node measure.mjs <outPrefix> [--shot]
 *
 * 遍历所有含文本的叶元素 → getComputedStyle 取 color/fontSize/fontWeight →
 * 沿父链累乘 opacity → 沿父链找第一个 alpha>0.5 的 background 当底 → 合成后算 WCAG。
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { requiredContrast } from "/home/user/complete/.claude/worktrees/agent-afea9019bb0ca42cd/scripts/check-text-legibility.mjs";

const OUT = process.argv[2] || "before";
const WANT_SHOT = process.argv.includes("--shot");
const BASE = "http://127.0.0.1:5205";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots";
mkdirSync(SHOT_DIR, { recursive: true });

/* ── 页内测量函数（字符串注入，浏览器上下文执行）───────────────────────────── */
const PAGE_FN = `() => {
  const parseRGBA = (s) => {
    if (!s) return null;
    const m = /rgba?\\(([^)]+)\\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

  const rows = [];
  const all = document.querySelectorAll("body *");
  for (const el of all) {
    // 只取"叶文本元素"：直接子节点里有非空文本
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\\s+/g, " ").trim();
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;

    // 沿父链累乘 opacity（祖先 opacity 会把子元素一起压暗）
    let opa = 1, p = el;
    while (p && p !== document.documentElement) { opa *= parseFloat(getComputedStyle(p).opacity || "1"); p = p.parentElement; }
    if (opa < 0.05) continue;

    // SVG <text>/<tspan> 的实际着色是 fill，不是 color —— 只看 color 会量到一个没被画出来的值
    const isSvgText = el.namespaceURI === "http://www.w3.org/2000/svg";
    const fgRaw = parseRGBA(isSvgText ? (cs.fill && cs.fill !== "none" ? cs.fill : cs.color) : cs.color);
    if (!fgRaw) continue;

    // 沿父链找第一个 alpha>0.5 的 background 当底；沿途把半透底依次叠上
    const stack = [];
    let q = el, bg = null;
    while (q) {
      const b = parseRGBA(getComputedStyle(q).backgroundColor);
      if (b && b.a > 0) { if (b.a > 0.5) { bg = b; break; } stack.push(b); }
      q = q.parentElement;
    }
    if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
    let base = { r: bg.r, g: bg.g, b: bg.b, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);

    const fg = over({ r: fgRaw.r, g: fgRaw.g, b: fgRaw.b, a: fgRaw.a * opa }, base);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    rows.push({
      text: own.slice(0, 44),
      cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 60),
      tag: el.tagName.toLowerCase(),
      fg: [Math.round(fg.r), Math.round(fg.g), Math.round(fg.b)],
      bg: [Math.round(base.r), Math.round(base.g), Math.round(base.b)],
      size, weight, opacity: +opa.toFixed(3),
      // WCAG 2.1 SC 1.4.3 「Incidental」原文豁免：inactive user interface components。
      // 失活控件本来就该看起来"点不动"——把它拉到高对比等于抹掉这个信号。单独标记，不并进违规数。
      inactive: !!el.closest("[disabled],[aria-disabled='true']"),
      ratio: +ratio(fg, base).toFixed(2),
    });
  }
  return rows;
}`;

/* ── 判据：**直接 import 门本体的函数**，不另抄一份公式 ──────────────────────
 *    抄一份 = 装饰品：改了门的公式，这里拿旧的去测、照样"通过"。 */
const requiredFor = requiredContrast;
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("  [page-err]", m.text().slice(0, 160)); });

  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // 登录：真后端 demo / admin / demo1234
  const inputs = page.locator("input");
  const n = await inputs.count();
  console.log("login inputs:", n);
  await inputs.nth(0).fill("demo");
  await inputs.nth(1).fill("admin");
  await inputs.nth(2).fill("demo1234");
  await page.locator("button[type=submit], button:has-text('登录')").first().click();
  await page.waitForTimeout(2500);
  console.log("after login url:", page.url());

  // 应用内点导航进沙盘（直接 goto 是硬跳转会丢内存 token）
  const nav = page.locator('[data-testid="nav-sim-sandbox"], a:has-text("推演沙盘")').first();
  await nav.waitFor({ timeout: 15000 });
  await nav.click();
  await page.waitForTimeout(14000); // 等全部异步区块落定 —— 三套主题必须看到**同一个** DOM，否则元素数不同就没法对账
  console.log("sandbox url:", page.url());

  // ⚠ 预热一遍再进循环：首轮（dark）曾只量到 357 个元素而后两轮 417 ——
  //    异步区块还在陆续挂载。**三套主题必须看到同一个 DOM**，否则前后对账的分母都不一样。
  await page.evaluate("(" + PAGE_FN + ")()");
  await page.waitForTimeout(10000);

  const out = {};
  for (const theme of ["dark", "light", "warm"]) {
    await page.evaluate((t) => {
      const root = document.documentElement;
      if (t === "dark") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", t);
    }, theme);
    await page.waitForTimeout(1500);
    const rows = await page.evaluate("(" + PAGE_FN + ")()");
    // 归类
    for (const r of rows) {
      r.cjk = CJK.test(r.text);
      r.needWcag = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700) ? 3 : 4.5;
      r.needSized = +requiredFor(r.size, r.weight).toFixed(2);
    }
    out[theme] = rows;
    const wcagBad = rows.filter((r) => r.ratio < r.needWcag && !r.inactive);
    const sizedBad = rows.filter((r) => r.ratio < r.needSized && !r.inactive);
    const exempt = rows.filter((r) => r.inactive && r.ratio < r.needSized).length;
    console.log(
      `[${theme}] 元素 ${rows.length} · WCAG 不达标 ${wcagBad.length} · 尺寸加权不达标 ${sizedBad.length}` +
      ` · 失活控件豁免 ${exempt}（WCAG 1.4.3 Incidental）`
    );
    if (WANT_SHOT) await page.screenshot({ path: `${SHOT_DIR}/${OUT}-${theme}.png`, fullPage: false });
  }
  writeFileSync(`${SHOT_DIR}/${OUT}.json`, JSON.stringify(out, null, 1));
  console.log("wrote", `${SHOT_DIR}/${OUT}.json`);
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
