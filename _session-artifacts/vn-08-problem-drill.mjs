import { launch, login, goView, SHOTS } from "./vn-lib.mjs";
const { browser, page, errs } = await launch();
const log = [];
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
try {
  await login(page, "admin");
  await goView(page, "dash");
  await page.waitForTimeout(2000);
  // problem card → order-chain?problem=
  const before = url();
  const pc = page.locator('[data-testid="dash-problem-cost"]').first();
  const cnt = await pc.count();
  log.push("dash-problem-cost present: " + cnt);
  if (cnt) {
    await pc.scrollIntoViewIfNeeded();
    await pc.click();
    await page.waitForTimeout(2000);
    log.push(`PROBLEM CARD click: ${before} -> ${url()}  (expect /v/order-chain?problem=cost)`);
    await page.screenshot({ path: `${SHOTS}/vn-08-problem-drill.png` });
    // did the problem auto-expand a root-cause DAG? (?problem= handler)
    const expanded = await page.evaluate(() => {
      const oc = document.querySelector('[data-testid="order-chain-view"]');
      const openProblem = document.querySelector('[data-testid^="oc-problem-"]');
      return { ocPresent: !!oc, anyProblemNode: !!openProblem, bodyHasRootCause: /根因|受影响|problem/i.test(document.body.innerText) };
    });
    log.push("PROBLEM landing: " + JSON.stringify(expanded));
    // back
    const back = page.locator('[data-testid="order-chain-back"]').first();
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(1500);
      log.push(`after 返回 -> ${url()}  (expect /v/dash — not dead-end)`);
    }
  }
  log.push("ERRORS: " + JSON.stringify([...new Set(errs)].slice(0,5)));
} catch (e) { log.push("ERR: " + e.message); }
finally { console.log(log.join("\n")); await browser.close(); }
