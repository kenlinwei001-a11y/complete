// WO-E2E-ACCEPT · 只读验收驱动脚本
// 用法：NODE_PATH=/opt/node22/lib/node_modules node docs/evidence/e2e-accept/drive.mjs
// 前置：datacore :4051 / agentcore :4052 / vite :5181（VITE_DATACORE_URL/VITE_AGENTCORE_URL 已指向前两者）
// 纪律：全程从登录页走起，不手敲 URL；每一步记录 step/click/nav；所有网络请求记录命中端口。
// ESM 不认 NODE_PATH，用绝对路径导入全局安装的 playwright
const _pw = await import(process.env.PW_PATH ?? "/opt/node22/lib/node_modules/playwright/index.js");
const chromium = (_pw.chromium ?? _pw.default?.chromium);
if (!chromium) throw new Error("playwright 解析失败 —— 我的取证坏了，不许据此报「界面没有 X」");
import fs from "node:fs";
import path from "node:path";

const FE = process.env.FE_URL ?? "http://127.0.0.1:5181";
const OUT = path.resolve("docs/evidence/e2e-accept");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const counters = { steps: 0, clicks: 0, navs: 0 };
const log = [];
const netPorts = new Map(); // port -> count
const netByPath = [];

function rec(kind, msg, extra) {
  const line = { t: new Date().toISOString(), kind, msg, ...(extra ?? {}) };
  log.push(line);
  console.log(`[${kind}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
}
function step(msg) { counters.steps++; rec("STEP", `#${counters.steps} ${msg}`); }
async function click(loc, msg) { counters.clicks++; rec("CLICK", `#${counters.clicks} ${msg}`); await loc.click(); }

async function shot(page, name) {
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f, fullPage: true });
  rec("SHOT", name, { file: path.relative(OUT, f) });
  return f;
}

// 提取屏上可见文本（去脚本/样式）
async function screenText(page) {
  return await page.evaluate(() => {
    const walk = (el) => (el?.innerText ?? "");
    return walk(document.body);
  });
}

const results = {};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: "zh-CN" });
const page = await ctx.newPage();

page.on("console", (m) => { if (m.type() === "error") rec("CONSOLE-ERR", m.text().slice(0, 300)); });
page.on("framenavigated", (f) => { if (f === page.mainFrame()) { counters.navs++; rec("NAV", f.url()); } });
page.on("response", (r) => {
  try {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http")) {
      const key = `${u.hostname}:${u.port || "80"}`;
      netPorts.set(key, (netPorts.get(key) ?? 0) + 1);
      if (u.pathname.startsWith("/a/v1") || u.pathname.startsWith("/b/v1") || u.pathname.startsWith("/api/v1")) {
        netByPath.push({ port: u.port, path: u.pathname, status: r.status() });
      }
    }
  } catch { /* ignore */ }
});

try {
  // ───────── 0. 登录 ─────────
  step("打开前端根路径（唯一允许输入的 URL = 应用入口）");
  await page.goto(FE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, "00-login");
  const loginTxt = await screenText(page);
  rec("SCREEN", "登录页文本", { head: loginTxt.slice(0, 400) });

  step("填写 demo / admin / demo1234 并登录");
  // 表单字段探测
  const inputs = await page.locator("input").all();
  rec("PROBE", `登录页 input 数=${inputs.length}`);
  for (let i = 0; i < inputs.length; i++) {
    const ph = await inputs[i].getAttribute("placeholder");
    const nm = await inputs[i].getAttribute("name");
    const tp = await inputs[i].getAttribute("type");
    rec("PROBE", `input[${i}] name=${nm} type=${tp} ph=${ph}`);
  }
  // 按顺序填：tenant, user, password（若只有两个则 user/password）
  if (inputs.length >= 3) {
    await inputs[0].fill("demo");
    await inputs[1].fill("admin");
    await inputs[2].fill("demo1234");
  } else if (inputs.length === 2) {
    await inputs[0].fill("admin");
    await inputs[1].fill("demo1234");
  }
  const submit = page.locator('button[type="submit"], button:has-text("登录")').first();
  await click(submit, "点击登录按钮");
  await page.waitForTimeout(4000);
  await shot(page, "01-after-login");
  results.loginUrl = page.url();
  rec("SCREEN", "登录后 URL", { url: page.url() });

  const homeTxt = await screenText(page);
  fs.writeFileSync(path.join(OUT, "screen-01-home.txt"), homeTxt);
  rec("SCREEN", "首页文本已存", { chars: homeTxt.length });

  // 导航目录：把左侧/顶部所有可点入口抓下来（这就是「入口可不可达」的证据）
  const navItems = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a[href], button, [role=tab], [role=menuitem]").forEach((el) => {
      const t = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (t && t.length < 40) out.push({ tag: el.tagName, text: t, href: el.getAttribute("href") ?? null });
    });
    return out;
  });
  fs.writeFileSync(path.join(OUT, "nav-inventory.json"), JSON.stringify(navItems, null, 2));
  rec("PROBE", `首页可点入口 ${navItems.length} 个`);
} catch (e) {
  rec("FATAL", String(e).slice(0, 500));
}

fs.writeFileSync(path.join(OUT, "drive-log.json"), JSON.stringify({ counters, netPorts: Object.fromEntries(netPorts), netByPath, log }, null, 2));
console.log("\n=== COUNTERS ===", JSON.stringify(counters));
console.log("=== PORTS HIT ===", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
