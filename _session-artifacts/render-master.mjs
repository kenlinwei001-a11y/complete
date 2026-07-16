import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MASTER = "file:///home/user/complete/docs/reference-prototype-decision-platform.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); });
page.on("pageerror", (e) => errs.push("PAGEERR:" + String(e).slice(0, 100)));
await page.goto(MASTER, { waitUntil: "networkidle" }).catch((e) => console.log("goto err", String(e).slice(0,80)));
await sleep(2500);
console.log("=== HTML 母版渲染 ===");
console.log("title:", await page.title());
console.log("body 文本长度:", ((await page.locator("body").textContent()) || "").length);
console.log("console errors:", errs.slice(0, 5));
// 找视图切换控件(nav/tab/button 含视图名)
const navTexts = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, .tab, .nav a, [data-view], [onclick*="view"], nav *, .views *')) {
    const t = (el.textContent || "").trim();
    if (t && t.length < 14 && out.length < 40) out.push(t);
  }
  return [...new Set(out)];
});
console.log("视图切换控件文本(去重):", JSON.stringify(navTexts.slice(0, 40)));
// 全局 setView/switchView 函数?
const fns = await page.evaluate(() => Object.keys(window).filter((k) => /view|nav|render|show|switch/i.test(k) && typeof window[k] === "function").slice(0, 20));
console.log("可能的切视图全局函数:", JSON.stringify(fns));
await page.screenshot({ path: `${OUT}/master-default.png`, fullPage: false });
console.log("截图 master-default.png (首屏)");
await browser.close();
