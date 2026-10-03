/* eslint-disable */
/** WO-SIM-VERDICT-FRONTEND · 单点探针：采纳行的方案名到底解析没解析到（顺带看它发没发那一跳）。 */
import { login, launch, sleep } from "./lib.mjs";

const run = async () => {
  const { browser, page } = await launch();
  const reqs = [];
  page.on("request", (r) => {
    if (/mitigation_select|risk_timeline/.test(r.url())) reqs.push(`${r.url().replace(/^https?:\/\/[^/]+/, "")} ${r.postData()}`);
  });
  await login(page, { user: "admin" });
  await sleep(1200);
  const link = await page.$('a[href="/v/risk"]');
  await link.click({ timeout: 8000 });
  await sleep(9000);
  const rows = await page.$$eval('[data-testid^="risk-adopted-line-"]', (els) =>
    els.map((e) => ({ text: e.innerText.replace(/\s+/g, " "), resolved: e.getAttribute("data-name-resolved"), plan: e.getAttribute("data-plan") })),
  );
  console.log("采纳行:", JSON.stringify(rows));
  console.log("相关请求:", JSON.stringify(reqs, null, 1));
  await browser.close();
};
run().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
