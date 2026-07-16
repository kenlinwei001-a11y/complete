import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;

export const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export const BASE = "http://127.0.0.1:5286";
export const SHOTS = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots";

export async function launch() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
  return { browser, ctx, page, errs };
}

export async function login(page, username = "admin") {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", username);
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForTimeout(1500);
}

export async function goView(page, viewKey) {
  await page.goto(`${BASE}/v/${viewKey}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
}
