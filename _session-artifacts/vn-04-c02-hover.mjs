import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
try {
  await login(page, "admin");
  await goView(page, "order-chain");
  await page.waitForTimeout(2500);

  // Locate the C02 RuleRef anchor and scroll into view
  const ref = page.locator('[data-testid="ruleref-C02/C03"]').first();
  await ref.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const before = await ref.textContent();
  console.log("RULEREF ANCHOR TEXT (before hover):", JSON.stringify(before));

  // Hover to open popover
  await ref.hover();
  // popover triggers a react-query fetch of rules; wait for it
  await page.waitForSelector('[data-testid="ruleref-pop"]', { timeout: 6000 });
  // wait for data (loading -> content)
  await page.waitForTimeout(1800);

  const popText = await page.locator('[data-testid="ruleref-pop"]').innerText();
  console.log("=== POPOVER FULL TEXT ===");
  console.log(popText);

  // Specifically check the provenance sub-block
  const provBlocks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid^="ruleref-prov-"]')).map(e => ({
      tid: e.getAttribute("data-testid"),
      txt: (e.textContent || "").trim()
    }));
  });
  console.log("=== PROVENANCE SUB-BLOCKS (谁设定/时间/边界/依据) ===");
  console.log(JSON.stringify(provBlocks, null, 1));

  await page.screenshot({ path: `${SHOTS}/vn-04-c02-hover.png` });
  console.log("ERRORS:", errs.slice(0,5));
} catch (e) {
  console.log("ERR:", e.message);
  await page.screenshot({ path: `${SHOTS}/vn-04-c02-ERR.png` }).catch(()=>{});
} finally {
  await browser.close();
}
