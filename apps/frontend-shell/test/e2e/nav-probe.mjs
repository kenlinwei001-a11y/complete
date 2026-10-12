/* eslint-disable */
/** 导航实测：列出所有可点导航项与其 href（供上层脚本精确点击，避免 text= 多义命中）。 */
import { login, launch, sleep } from "./lib.mjs";

const run = async () => {
  const { browser, page } = await launch();
  await login(page, { user: "admin" });
  await sleep(1500);
  const links = await page.$$eval("a[href]", (els) =>
    els.map((e) => ({ text: (e.innerText || "").trim().replace(/\s+/g, " "), href: e.getAttribute("href") })),
  );
  const seen = new Set();
  for (const l of links) {
    if (!l.href || seen.has(l.href)) continue;
    seen.add(l.href);
    console.log(String(l.href).padEnd(34), l.text.slice(0, 40));
  }
  await browser.close();
};
run().catch((e) => { console.error("FAILED", e); process.exit(1); });
