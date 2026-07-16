import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1300 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);

const cnt = async (s) => await page.locator(s).count();
const attr = async (s, a) => await page.locator(s).first().getAttribute(a).catch(() => null);
const txt = async (s) => ((await page.locator(s).first().textContent({ timeout: 1500 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();

console.log("=== 任务#2 独立复验 (审核方·真渲染) ===");
console.log("\n[1] 创建过程管道存在 + 默认展开:");
const hasPipe = await cnt('[data-testid="modeling-creation-pipeline"]');
console.log("  modeling-creation-pipeline:", hasPipe ? "✓存在" : "✗缺失");
console.log("  进度文本:", await txt('[data-testid="mcp-progress"]'));

console.log("\n[2] 6 阶段节点 + 状态:");
async function sig() {
  const out = [];
  for (let n = 1; n <= 6; n++) {
    const st = await attr(`[data-testid="mcp-stage-${n}"]`, "data-state");
    const sub = await txt(`[data-testid="mcp-stage-${n}"]`);
    out.push({ n, st, sub: sub.slice(0, 40) });
  }
  return out;
}
const s1 = await sig();
s1.forEach((x) => console.log(`  阶段${x.n} [${x.st}] ${x.sub}`));
const linkCount = await cnt('[data-testid^="mcp-link-"]');
console.log("  连线数:", linkCount, "(应 5)");

console.log("\n[3] 切草案 → 状态签名是否变 (证明取真草案态非写死):");
// 草案下拉（顶部 select）
const sel = page.locator("select").first();
const opts = await sel.locator("option").all();
console.log("  草案下拉选项数:", opts.length);
const sigs = [];
const sigStr = (s) => s.map((x) => x.st[0]).join("");
sigs.push({ label: "初始", s: sigStr(s1) });
for (let i = 0; i < Math.min(opts.length, 5); i++) {
  const val = await opts[i].getAttribute("value");
  const label = ((await opts[i].textContent()) || "").replace(/\s+/g, " ").trim().slice(0, 28);
  await sel.selectOption(val).catch(() => {});
  await sleep(2200);
  const ss = sigStr(await sig());
  const prog = await txt('[data-testid="mcp-progress"]');
  sigs.push({ label, s: ss, prog: prog.slice(0, 50) });
  console.log(`  草案[${label}] → 签名 ${ss} | ${prog.slice(0, 46)}`);
}
const uniq = new Set(sigs.map((x) => x.s));
console.log("  不同签名数:", uniq.size, uniq.size > 1 ? "✓状态随草案变(非写死)" : "⚠️全同(可疑写死)");

console.log("\n[4] 点阶段③ → 展开在建草案 DAG:");
await page.locator('[data-testid="mcp-stage-3"]').first().click().catch(() => {});
await sleep(1800);
const draftDag = await cnt('[data-testid="modeling-pipeline-dag-draft"]');
const draftDagOpen = await attr('[data-testid="modeling-pipeline-dag-draft"]', "open");
console.log("  modeling-pipeline-dag-draft:", draftDag ? "✓存在" : "✗", "| open:", draftDagOpen !== null ? "✓展开" : "未展开");
const procNodes = await cnt('[data-testid^="pp-proc-"]');
console.log("  处理节点(pp-proc-*):", procNodes);

await page.screenshot({ path: `${OUT}/verify-task2.png`, fullPage: true }).catch(() => {});
console.log("\n控制台 error:", errs.length, errs.slice(0, 4));
console.log("截图: verify-task2.png");
await browser.close();
