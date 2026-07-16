import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
try {
  await login(page, "admin");
  await goView(page, "order-chain");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/vn-03-orderchain-top.png`, fullPage: true });

  // What testids / RuleRef anchors are present?
  const info = await page.evaluate(() => {
    const rulerefs = Array.from(document.querySelectorAll("[data-testid^=ruleref-]")).map(e => e.getAttribute("data-testid"));
    const provs = Array.from(document.querySelectorAll("[data-testid*=ofc-], [data-testid*=prov]")).map(e => e.getAttribute("data-testid"));
    const breadcrumb = Array.from(document.querySelectorAll("[class*=breadcrumb], [class*=crumb], nav")).map(e=>(e.textContent||"").trim().slice(0,120)).filter(Boolean);
    // any select / order picker
    const selects = Array.from(document.querySelectorAll("select, [class*=select], [data-testid*=so], [data-testid*=order]")).map(e=>({tid:e.getAttribute("data-testid"),tag:e.tagName,txt:(e.textContent||"").trim().slice(0,50)})).slice(0,15);
    // C0x visible text anywhere
    const bodyTxt = document.body.innerText;
    const c0x = (bodyTxt.match(/C\d{2}(\/C\d{2})*/g)||[]).slice(0,20);
    return { rulerefs, provs, breadcrumb, selects, c0x };
  });
  console.log("RULEREFS:", JSON.stringify(info.rulerefs));
  console.log("PROV testids:", JSON.stringify(info.provs));
  console.log("BREADCRUMB:", JSON.stringify(info.breadcrumb));
  console.log("SELECTS/PICKERS:", JSON.stringify(info.selects, null, 1));
  console.log("C0x tokens visible:", JSON.stringify(info.c0x));
  console.log("ERRORS:", errs.slice(0,5));
} catch (e) {
  console.log("ERR:", e.message);
} finally {
  await browser.close();
}
