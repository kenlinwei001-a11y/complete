import { launch, login, goView, BASE, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
const log = [];
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
try {
  await login(page, "admin");

  // ===== FLOW 1: Dashboard ledger row → order-chain → 返回 → dash =====
  await goView(page, "dash");
  await page.waitForTimeout(2000);
  const ledgerRows = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid^=ledger-row-]")).map(e=>e.getAttribute("data-testid")));
  log.push("FLOW1: ledger rows on dash: " + ledgerRows.length + " e.g. " + JSON.stringify(ledgerRows.slice(0,3)));
  if (ledgerRows.length) {
    const before = url();
    await page.locator(`[data-testid="${ledgerRows[0]}"]`).first().click();
    await page.waitForTimeout(1800);
    log.push(`FLOW1: ledger row click: ${before} -> ${url()}  (expect /v/order-chain)`);
    // now click 返回
    const backBtn = page.locator('[data-testid="order-chain-back"]').first();
    const hasBack = await backBtn.count();
    log.push("FLOW1: order-chain-back button present: " + hasBack);
    if (hasBack) {
      await backBtn.click();
      await page.waitForTimeout(1500);
      log.push(`FLOW1: after 返回 -> ${url()}  (expect back to /v/dash — NOT dead-end)`);
    }
  }

  // ===== FLOW 2: order-chain DAG order node → Object360 → back =====
  await goView(page, "order-chain");
  await page.waitForTimeout(2500);
  const dagOrderNode = await page.evaluate(() => {
    const n = document.querySelector('[data-testid^="ofc-dag-node-order:"]');
    return n ? n.getAttribute("data-testid") : null;
  });
  log.push("FLOW2: order dag node: " + dagOrderNode);
  if (dagOrderNode) {
    const before = url();
    await page.locator(`[data-testid="${dagOrderNode}"]`).first().click();
    await page.waitForTimeout(2000);
    log.push(`FLOW2: DAG order node click: ${before} -> ${url()}  (expect /o/Order/...)`);
    await page.screenshot({ path: `${SHOTS}/vn-07-object360.png` });
    // is it a real Object360 detail (not dead-end/404)?
    const o360 = await page.evaluate(() => {
      const body = document.body.innerText;
      const notFound = /404|页面不存在|not found/i.test(body);
      const hasBack = !!document.querySelector('[data-testid*=back]') || /返回|‹/.test(body.slice(0,500));
      return { len: body.length, notFound, hasBack, head: body.slice(0,120).replace(/\s+/g," ") };
    });
    log.push("FLOW2: Object360 loaded: notFound=" + o360.notFound + " hasBack=" + o360.hasBack + " head=" + o360.head);
    // browser back
    await page.goBack();
    await page.waitForTimeout(1500);
    log.push(`FLOW2: after goBack -> ${url()}  (expect return to /v/order-chain)`);
  }

  // ===== FLOW 3: Dashboard problem card → order-chain?problem= → 返回 =====
  await goView(page, "dash");
  await page.waitForTimeout(1500);
  const probCards = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid^=dash-problem-], [data-testid^=oc-problem-], [data-testid*=problem]")).map(e=>e.getAttribute("data-testid")).slice(0,8));
  log.push("FLOW3: problem-ish testids on dash: " + JSON.stringify(probCards));

  log.push("ERRORS: " + JSON.stringify([...new Set(errs)].slice(0,6)));
} catch (e) {
  log.push("SCRIPT ERR: " + e.message);
} finally {
  console.log(log.join("\n"));
  await browser.close();
}
