import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1500 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
// 点左导航"经营驾驶舱"进入驾驶舱(非 /v/dashboard)
let nav=false;
for (const sel of ['text=经营驾驶舱','a:has-text("经营驾驶舱")','[href*="cockpit"]','li:has-text("经营驾驶舱")']) {
  try { const l=page.locator(sel).first(); if(await l.count()){ await l.click({timeout:2500}); nav=true; break; } } catch {}
}
await sleep(4500);
console.log("=== 轨R 增量3 #2 · KPI 八卡溯源富度 → 六要素 走查 ===");
console.log("点经营驾驶舱导航:", nav?"✓":"✗", "| URL:", page.url().replace(APP, ""));
const allProv = await cnt('[data-testid^="widget-prov-"]');
console.log("widget-prov-* 徽总数:", allProv);

const KEYS = ["gwh","util","attain","orders","demand-p50","gross-margin","material-gap","supply-v7","rev-attain"];
// 期望规则映射(oracle)
const RULEMAP = { gwh:"C01/C04", util:"C05/C21", attain:"C21", orders:"(留空)", "demand-p50":"C25/C12", "gross-margin":"C15/C24", "material-gap":"C06/C16", "supply-v7":"C03/C10", "rev-attain":"C21" };

async function hoverProv(key) {
  const prov = page.locator(`[data-testid="widget-prov-${key}"]`).first();
  if (!(await prov.count())) return { found:false };
  await prov.scrollIntoViewIfNeeded().catch(()=>{});
  // hover 内部 Provenance span（带 ⓘ）
  const badge = prov.locator(".badge, span").first();
  await badge.hover({ force:true }).catch(()=>{});
  await sleep(700);
  const tip = page.locator('[data-testid="prov-tip"]');
  const tipTxt = (await tip.count()) ? ((await tip.first().textContent())||"").replace(/\s+/g," ").trim() : "";
  const res = {
    found:true,
    来源: /来源：/.test(tipTxt) && !/—（手工/.test(tipTxt),
    新鲜度: (await page.locator('[data-testid="prov-fresh"]').count())>0,
    推导: /推导：/.test(tipTxt),
    输入因子: /输入因子：/.test(tipTxt),
    关联规则: (await page.locator('[data-testid="prov-rule"]').count())>0,
    备注: /输出路径|声明式查询/.test(tipTxt),
    tip: tipTxt.slice(0,150),
  };
  // 移开收起 tooltip
  await page.mouse.move(5,5); await sleep(250);
  return res;
}

const rows = [];
for (const k of KEYS) {
  const r = await hoverProv(k);
  rows.push([k, r]);
  if (!r.found) { console.log(`\n[${k}] ✗ widget-prov 不存在`); continue; }
  const six = ["来源","新鲜度","推导","输入因子","关联规则","备注"].map(e=>`${e}:${r[e]?"✓":"✗"}`).join(" ");
  console.log(`\n[${k}] 规则期望 ${RULEMAP[k]}`);
  console.log(`  六要素: ${six}`);
  console.log(`  tip: ${r.tip}`);
}

// 两跳验证：gross-margin 卡里 RuleRef 悬浮出 C15/C24 真定义
console.log("\n=== 两跳溯源验证: gross-margin 卡 关联规则 → RuleRef → 真定义 ===");
await page.locator(`[data-testid="widget-prov-gross-margin"] .badge, [data-testid="widget-prov-gross-margin"] span`).first().hover({force:true}).catch(()=>{});
await sleep(700);
const ruleref = page.locator('[data-testid="prov-rule"] [data-testid^="ruleref-"]').first();
const rrCount = await ruleref.count();
console.log("RuleRef 锚点存在:", rrCount?"✓":"✗");
if (rrCount) {
  await ruleref.hover({force:true}); await sleep(800);
  const pop = page.locator('[data-testid="ruleref-pop"]');
  const popTxt = (await pop.count()) ? ((await pop.first().textContent())||"").replace(/\s+/g," ").trim() : "";
  console.log("ruleref-pop:", popTxt.slice(0,200));
  console.log("含 C15 经营毛利底线:", /C15.*毛利|毛利底线/.test(popTxt)?"✓":"✗", "| 含 C24 接单毛利:", /C24.*毛利|接单毛利/.test(popTxt)?"✓":"✗");
  console.log("未找到定义(造假征兆):", /未找到定义/.test(popTxt)?"⚠️有":"无");
}
await page.screenshot({ path: `${OUT}/r3-prov-six.png`, fullPage: true });
console.log("\n截图: r3-prov-six.png");
await browser.close();
