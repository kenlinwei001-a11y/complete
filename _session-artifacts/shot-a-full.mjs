// Render reference obsidian HTML -> capacity sim (risk) view, FULL content screenshots (unclip inner scroll).
import { chromium } from "/home/user/complete/node_modules/playwright-core/index.mjs";
import path from "node:path";

const OUT_DIR = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/compare-shots";
const FILE = "/home/user/complete/docs/reference/capacity-sim-obsidian-target.html";

const UNCLIP = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { ok: false };
  let node = el;
  while (node) {
    node.style.overflow = "visible";
    node.style.overflowY = "visible";
    node = node.parentElement;
  }
  document.documentElement.style.overflow = "visible";
  document.body.style.overflow = "visible";
  return { ok: true, scrollHeightAfter: document.documentElement.scrollHeight };
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("file://" + FILE, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1000);
await page.evaluate(() => setView("risk"));
await page.waitForTimeout(1200);

const r1 = await page.evaluate(UNCLIP, "#riskwrap");
console.log("unclip riskwrap:", JSON.stringify(r1));
await page.waitForTimeout(300);

await page.screenshot({ path: path.join(OUT_DIR, "A-reference-html.png"), fullPage: true });
console.log("Saved A-reference-html.png (full content)");

// Re-navigate fresh for the detail shot (state got mutated by unclip; safer to reload).
await page.goto("file://" + FILE, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1000);
await page.evaluate(() => setView("risk"));
await page.waitForTimeout(1000);
await page.click("#rkc0");
await page.waitForTimeout(1200);
const r2 = await page.evaluate(UNCLIP, "#riskwrap");
console.log("unclip riskwrap (detail):", JSON.stringify(r2));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT_DIR, "A-reference-html-detail.png"), fullPage: true });
console.log("Saved A-reference-html-detail.png (full content)");

await browser.close();
