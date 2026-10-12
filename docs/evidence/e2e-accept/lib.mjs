// WO-E2E-ACCEPT 共享驱动库（只读验收）
import fs from "node:fs";
import path from "node:path";

const _pw = await import(process.env.PW_PATH ?? "/opt/node22/lib/node_modules/playwright/index.js");
export const chromium = _pw.chromium ?? _pw.default?.chromium;
if (!chromium) throw new Error("playwright 解析失败 —— 取证工具坏了");

export const FE = process.env.FE_URL ?? "http://127.0.0.1:5181";
export const OUT = path.resolve("docs/evidence/e2e-accept");
export const SHOTS = path.join(OUT, "shots");
export const TXT = path.join(OUT, "screens");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TXT, { recursive: true });

export const counters = { steps: 0, clicks: 0, navs: 0 };
export const log = [];
export const netPorts = new Map();
export const netCalls = [];

export function rec(kind, msg, extra) {
  log.push({ t: new Date().toISOString(), kind, msg, ...(extra ?? {}) });
  console.log(`[${kind}] ${msg}${extra ? " " + JSON.stringify(extra).slice(0, 400) : ""}`);
}
export function step(msg) { counters.steps++; rec("STEP", `#${counters.steps} ${msg}`); }
export async function click(loc, msg) { counters.clicks++; rec("CLICK", `#${counters.clicks} ${msg}`); await loc.click({ timeout: 15000 }); }

export async function shot(page, name) {
  const f = path.join(SHOTS, `${name}.png`);
  try { await page.screenshot({ path: f, fullPage: true }); rec("SHOT", name); } catch (e) { rec("SHOT-FAIL", name + " " + String(e).slice(0, 120)); }
  return f;
}
export async function dump(page, name) {
  const t = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(TXT, `${name}.txt`), t);
  rec("DUMP", name, { chars: t.length });
  return t;
}

export async function boot() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1200 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") rec("CONSOLE-ERR", m.text().slice(0, 240)); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) { counters.navs++; rec("NAV", f.url()); } });
  page.on("response", (r) => {
    try {
      const u = new URL(r.url());
      const key = `${u.hostname}:${u.port || "80"}`;
      netPorts.set(key, (netPorts.get(key) ?? 0) + 1);
      if (/^\/(a|b|api)\/v1/.test(u.pathname)) netCalls.push({ port: u.port, path: u.pathname, status: r.status(), method: r.request().method() });
    } catch { }
  });
  return { browser, ctx, page };
}

export async function login(page) {
  step("打开应用入口（唯一允许输入的 URL）");
  await page.goto(FE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  step("在登录页填 demo / admin / demo1234");
  const inputs = await page.locator("input").all();
  if (inputs.length >= 3) { await inputs[0].fill("demo"); await inputs[1].fill("admin"); await inputs[2].fill("demo1234"); }
  await click(page.locator('button[type="submit"], button:has-text("登录")').first(), "登录");
  await page.waitForTimeout(3500);
  rec("LOGIN", "登录后 URL", { url: page.url() });
}

// 从侧边栏点进某个视图（不手敲 URL）。返回是否成功。
export async function navByText(page, text, note) {
  const loc = page.locator(`a:has-text("${text}")`).first();
  const n = await page.locator(`a:has-text("${text}")`).count();
  if (n === 0) { rec("NAV-MISS", `侧边栏找不到「${text}」`); return false; }
  await click(loc, `侧边栏 →「${text}」${note ? " · " + note : ""}`);
  await page.waitForTimeout(3000);
  return true;
}

export function save(name) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify({
    counters, portsHit: Object.fromEntries(netPorts), netCalls, log,
  }, null, 2));
}
