// WO-SANDBOX-RADAR-COLLAPSE（S4·纯前端）· 真浏览器验证：三雷达合一(主雷达人话维度) + L0-L4 黑话折一句人话结论。
// 真起双服务 + 真 chromium + 真 vite(.env.local localhost) + 真 admin 登录 → 真沙盘渲染器。
// 逐值对照后端：DOM 认证结论级别 == 后端 GET /a/v1/sim/sessions/:id/certification 的 cert.level。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://localhost:5174";
const DC = process.env.DC ?? "http://127.0.0.1:4001";
const CHROME = process.env.CHROME;
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";
const DBG = "demo:usr_demo_admin:admin";

const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

// L0-L4 → 人话结论映射（与前端 simCertVerdict 同源判据·逐值对照用）。
const VERDICT_KEY = {
  L4_CERTIFIED: "可直接据此落 Action",
  L3_VERIFIED: "可支持决策",
  L2_RUNNABLE: "仅供参考",
  L1_CONFIGURED: "尚不可推演",
  L0_INVALID: "尚不可推演",
};

const j = async (p) => (await fetch(`${DC}${p}`, { headers: { "X-Debug-User": DBG } })).json();
// 后端真值：feature 是否 entitled
const ws = await j("/a/v1/me/workspace");
(ws.features || []).includes("sim.radar_collapse")
  ? ok("后端 workspace entitled sim.radar_collapse（battery all-on·暗发键真下发）")
  : bad("sim.radar_collapse 未 entitled（demo 应经 battery 模板 all-on 自动开）");

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`真后端登录成功 → ${page.url()}`);

  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=sandbox-view]", { timeout: 15000 });
  // 等就绪认证卡渲染（session 自动建 + cert 拉取）
  await page.waitForSelector("[data-testid=sim-readiness-panel]", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ① 一句人话结论置顶（L0-L4 黑话折成能不能拿来决策）
  const verdictCount = await page.locator("[data-testid=sim-cert-verdict]").count();
  if (verdictCount === 0) { bad("一句人话结论 sim-cert-verdict 未渲染（feature 开应显·humanize 未生效）"); }
  else {
    const level = await page.locator("[data-testid=sim-cert-verdict]").getAttribute("data-cert-level");
    const text = (await page.locator("[data-testid=sim-cert-verdict-text]").textContent())?.trim() ?? "";
    ok(`一句人话结论真渲染·级别=${level}·「${text.slice(0, 40)}…」`);
    // 逐值对照后端：DOM 级别 == 后端 cert.level
    const sessions = await j("/a/v1/sim/sessions").catch(() => ({}));
    const list = Array.isArray(sessions) ? sessions : (sessions.items ?? []);
    const sid = list[0]?.id;
    if (sid) {
      const cert = await j(`/a/v1/sim/sessions/${encodeURIComponent(sid)}/certification?scope=GLOBAL`);
      cert.level === level
        ? ok(`逐值对照后端：DOM 结论级别 ${level} == 后端 cert.level ${cert.level}（R13 派生·不新造）`)
        : bad(`级别对不上：DOM=${level} 后端 cert.level=${cert.level}`);
      // 人话结论文案与级别判据一致
      const key = VERDICT_KEY[cert.level];
      key && text.includes(key)
        ? ok(`人话结论文案与级别 ${cert.level} 判据一致（含「${key}」·能不能拿来决策说人话）`)
        : bad(`结论文案与级别不符：级别 ${cert.level} 期望含「${key}」·实得「${text}」`);
      // FDE 校正：结论「缺：…」指向真实 cert.gaps（前向闭合/图查询覆盖…）·world 100% 时绝不臆断「世界未就绪」
      const wc100 = cert.worldCompleteness?.pct === 100;
      const forwardGap = cert.gaps.some((g) => /FORWARD/i.test(`${g.ref} ${g.detail}`));
      if (cert.gaps.length > 0) {
        const citesReal = /前向闭合|图查询覆盖|链闭合|类型未归域|数据闭合/.test(text) || cert.gaps.some((g) => text.includes(g.gapCode));
        const noWorldLie = !(wc100 && text.includes("世界未就绪"));
        citesReal && noWorldLie
          ? ok(`FDE 校正：结论指向真断点${forwardGap ? "(含前向闭合)" : ""}·world${wc100 ? "=100%" : ""} 不臆断「世界未就绪」·「${text.slice(0, 48)}」`)
          : bad(`结论未诚实指向真 cert.gaps 或 world=100% 仍说「世界未就绪」：「${text}」`);
      }
    } else {
      bad("拿不到 session id·无法逐值对照后端 cert.level（会话未建？）");
    }
  }

  // ② L0-L4 台阶黑话收进「查看认证详情」折叠（默认折叠·DOM 保留·功能不删）
  const details = page.locator("[data-testid=sim-cert-details]");
  const detailsCount = await details.count();
  const detailsOpen = detailsCount ? await details.getAttribute("data-open") : null;
  const stepperInDom = await page.locator("[data-testid=sim-cert-level]").count();
  detailsCount > 0 && detailsOpen === "0" && stepperInDom > 0
    ? ok(`L0-L4 台阶黑话收「查看认证详情」折叠（data-open=0 默认折叠）·stepper 仍在 DOM（hidden 保留·功能不删）`)
    : bad(`认证详情折叠不符：details=${detailsCount} open=${detailsOpen} stepperInDom=${stepperInDom}`);

  // ③ 主雷达三维换人话名（数据/结构齐备 / 规则/知识覆盖 / 行为已验证）·非 structure/knowledge/behavior 裸键
  const axisTexts = await page.locator('[data-testid^=sandbox-radar-axis-]').allTextContents();
  const joined = axisTexts.join(" / ");
  const humanized = axisTexts.some((t) => /数据\/结构齐备|规则\/知识覆盖|行为已验证/.test(t));
  const noRawKey = !axisTexts.some((t) => /^(structure|knowledge|behavior)$/.test(t.trim()));
  humanized && noRawKey
    ? ok(`主雷达维度换人话名（${joined}）·无 structure/knowledge/behavior 黑话裸键（R14）`)
    : bad(`主雷达维度人话化不符：轴标=[${joined}]`);

  await page.screenshot({ path: "docs/evidence/S4-sandbox-radar-collapse-realbrowser.png", fullPage: false });
  ok("截图 docs/evidence/S4-sandbox-radar-collapse-realbrowser.png");
} catch (e) {
  bad("异常：" + (e?.message ?? String(e)));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? "✅ 全绿" : "❌ 有红"}：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
