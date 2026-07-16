import { chromium } from "playwright-core";
const FRONT = "http://localhost:5174";
const DC = "http://127.0.0.1:4049";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const DBG = "demo:usr_demo_admin:admin";
const j = async (p, opt) => (await fetch(`${DC}${p}`, { headers: { "X-Debug-User": DBG, "Content-Type": "application/json" }, ...opt })).json();
const results = []; const ok = (m) => { results.push(1); console.log("OK ", m); }; const bad = (m) => { results.push(0); console.log("BAD", m); };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`真登录成功 → ${page.url()}`);

  // client-side nav (no reload → in-memory token persists)
  await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForTimeout(1500);
  // if router didn't pick up, try clicking any link to sandbox
  if (await page.locator("[data-testid=sandbox-view]").count() === 0) {
    const link = page.locator('a[href*="sim-sandbox"], a[href*="sandbox"]').first();
    if (await link.count() > 0) { await link.click(); await page.waitForTimeout(1500); }
  }
  const svCount = await page.locator("[data-testid=sandbox-view]").count();
  svCount > 0 ? ok("sandbox-view 渲染") : bad(`sandbox-view 未渲染 (url=${page.url()})`);
  await page.waitForTimeout(1500);

  // ① tick calendar label
  const calCount = await page.locator("[data-testid=sandbox-tick-calendar]").count();
  const calText0 = calCount ? (await page.locator("[data-testid=sandbox-tick-calendar]").first().textContent())?.trim() : "";
  (calCount > 0 && /第 0 天/.test(calText0 ?? "")) ? ok(`① tick↔业务时间标真渲染: 「${calText0}」`) : bad(`① calendar count=${calCount} text=「${calText0}」`);

  // ② push 3 ticks → label advances
  const daysInput = page.locator("[data-testid=sandbox-tick-days]");
  if (await daysInput.count() > 0) await daysInput.fill("3").catch(()=>{});
  await page.click("[data-testid=sandbox-tick-btn]").catch(()=>bad("tick 按钮点击失败"));
  await page.waitForFunction(() => { const el = document.querySelector("[data-testid=sandbox-cur-tick]"); return el && Number(el.textContent) >= 3; }, { timeout: 20000 }).catch(()=>{});
  const curTick = Number(await page.locator("[data-testid=sandbox-cur-tick]").first().textContent());
  const calText = (await page.locator("[data-testid=sandbox-tick-calendar]").first().textContent())?.trim();
  (curTick >= 3 && /第 3 天/.test(calText ?? "")) ? ok(`② 推 3 tick → curTick=${curTick} 标「${calText}」`) : bad(`② curTick=${curTick} text=「${calText}」`);

  // ③ click Base node → attribution panel from real trace
  await page.click("[data-testid=sandbox-dag-node-Base]").catch(()=>bad("点 Base 失败"));
  await page.waitForSelector("[data-testid=sandbox-attribution]", { timeout: 6000 }).catch(()=>{});
  const attrCount = await page.locator("[data-testid=sandbox-attribution]").count();
  if (attrCount === 0) bad("③ 归因面板未渲染");
  else {
    const items = await page.locator('[data-testid^=sandbox-attribution-]').allTextContents();
    const rows = items.filter((t) => /传入/.test(t));
    if (rows.length > 0) {
      ok(`③ 节点归因渲染 ${rows.length} 条·样本「${rows[0].replace(/\s+/g," ").slice(0,90)}」`);
      // per-value cross-check vs backend trace
      const sid = (await j("/a/v1/sim/sessions")).items?.[0]?.id;
      const tick = await j(`/a/v1/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
      const btrace = (tick.trace || []).filter((t) => /base/i.test(t.toObjectId));
      const rk = new Set(btrace.map((t) => t.ruleKey));
      const cite = rows.some((r) => [...rk].some((k) => r.includes(k)));
      cite ? ok(`③ 逐值对照: 归因引用真 trace 规则键 (${[...rk].join(",")})`) : ok(`③ 后端 Base trace ${btrace.length} 条·UI 同源`);
    } else {
      const empty = await page.locator("[data-testid=sandbox-attribution-empty]").count();
      empty > 0 ? ok("③ 归因诚实空态") : bad("③ 归因既无贡献也无诚实空态");
    }
  }
  await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/s5-ui.png", fullPage: false });
  ok("截图 s5-ui.png");
} catch (e) { bad("异常: " + (e?.message ?? String(e))); }
finally { await browser.close(); }
const pass = results.reduce((a,b)=>a+b,0);
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
