import { chromium } from "/home/user/complete/node_modules/playwright-core/index.js";

const SCRATCH = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text()); });

// 1) login via the real UI flow (fall back to programmatic token if UI differs)
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
console.log("INITIAL URL:", page.url());

// Try to log in: fill tenant/username/password if a login form is present.
const bodyText0 = await page.evaluate(() => document.body.innerText);
console.log("LANDING TEXT (first 200):", JSON.stringify(bodyText0.slice(0, 200)));

// Attempt programmatic login by injecting token the way the app stores it, then navigate.
// First get a token from backend.
const tok = await page.evaluate(async () => {
  const r = await fetch("http://127.0.0.1:4001/a/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const j = await r.json();
  return j.accessToken;
});
console.log("GOT TOKEN:", !!tok, "len", tok?.length);

// Try common token storage keys used by frontends.
await page.evaluate((t) => {
  try { localStorage.setItem("accessToken", t); } catch {}
  try { localStorage.setItem("token", t); } catch {}
  try { sessionStorage.setItem("accessToken", t); } catch {}
}, tok);

await browser.close();
console.log("STEP1_DONE");
