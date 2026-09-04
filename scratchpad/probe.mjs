import { chromium } from "playwright-core";
const BASE = "http://localhost:5847";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1400 } })).newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const a = document.querySelector('a[href="/v/graph-all"]');
  if (!a) return { found: false };
  const chain = [];
  let e = a;
  for (let i = 0; i < 6 && e; i++) {
    const cs = getComputedStyle(e);
    chain.push({ tag: e.tagName, cls: e.className?.toString().slice(0, 60), display: cs.display, vis: cs.visibility, h: e.getBoundingClientRect().height, txt: (e.textContent || "").slice(0, 40) });
    e = e.parentElement;
  }
  return { found: true, chain };
});
console.log(JSON.stringify(info, null, 1));
const groups = await page.evaluate(() => [...document.querySelectorAll("nav button, aside button, nav summary, [role=button]")].map((e) => (e.textContent || "").trim().slice(0, 24)).filter(Boolean).slice(0, 40));
console.log("GROUPS", JSON.stringify(groups));
await b.close();
