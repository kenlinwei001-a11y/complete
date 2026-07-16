import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
const log = [];
try {
  await login(page, "admin");
  await goView(page, "dash");
  await page.waitForTimeout(2500);

  // 1) 轨N-③: hover a KPI Provenance tooltip (in-place 6-element traceability)
  // KPI info icons — find prov-* testids
  const provTids = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^=prov-]")).map(e => e.getAttribute("data-testid")).slice(0, 20)
  );
  log.push("DASH prov testids: " + JSON.stringify(provTids));

  if (provTids.length) {
    const first = page.locator(`[data-testid="${provTids[0]}"]`).first();
    await first.scrollIntoViewIfNeeded();
    await first.hover();
    await page.waitForTimeout(1500);
    const tip = await page.locator('[data-testid="prov-tip"]').first().innerText().catch(()=>"(no prov-tip)");
    log.push("PROV TOOLTIP (" + provTids[0] + "):\n" + tip);
    await page.screenshot({ path: `${SHOTS}/vn-05a-prov-tooltip.png` });
    await page.mouse.move(10, 10); // dismiss
    await page.waitForTimeout(500);
  }

  // 2) 轨N-①/③: KPI drill → ProvenanceDag → DagNodeDrawer
  const drillKpis = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^=drill-kpi-]")).map(e => e.getAttribute("data-testid"))
  );
  log.push("DRILL KPIs: " + JSON.stringify(drillKpis));

  if (drillKpis.length) {
    const kpi = page.locator(`[data-testid="${drillKpis[0]}"]`).first();
    await kpi.scrollIntoViewIfNeeded();
    await kpi.click();
    await page.waitForTimeout(1500);
    const dagShown = await page.locator('[data-testid="provenance-dag"]').count();
    log.push("provenance-dag present after KPI click: " + dagShown);
    await page.screenshot({ path: `${SHOTS}/vn-05b-provenance-dag.png` });

    // click a dag node → DagNodeDrawer
    const dagNodes = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid^=dag-node-]")).map(e => e.getAttribute("data-testid")).filter(t=>t!=="dag-node-drawer").slice(0,25)
    );
    log.push("DAG NODES: " + JSON.stringify(dagNodes));
    if (dagNodes.length) {
      // prefer a kpi/factor node (clickable openDetail)
      const target = page.locator(`[data-testid="${dagNodes[0]}"]`).first();
      await target.click();
      await page.waitForTimeout(1200);
      const drawerCount = await page.locator('[data-testid="dag-node-drawer"]').count();
      log.push("DAG NODE DRAWER opened: " + drawerCount);
      if (drawerCount) {
        const drawer = await page.evaluate(() => {
          const d = document.querySelector('[data-testid="dag-node-drawer"]');
          const src = document.querySelector('[data-testid="dag-node-src"]');
          const rule = document.querySelector('[data-testid="dag-node-rule"]');
          const bd = document.querySelector('[data-testid="dag-node-breakdown"]');
          return {
            full: d ? d.innerText.slice(0, 600) : null,
            src: src ? src.textContent.trim() : null,
            rule: rule ? rule.textContent.trim() : null,
            breakdown: bd ? bd.innerText.slice(0,300) : null,
          };
        });
        log.push("DRAWER src=" + drawer.src + " | rule=" + drawer.rule);
        log.push("DRAWER breakdown: " + drawer.breakdown);
        log.push("DRAWER FULL:\n" + drawer.full);
        await page.screenshot({ path: `${SHOTS}/vn-05c-dagnode-drawer.png` });

        // 轨N-①: can we close/return? find modal close (X) or overlay
        const closed = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const x = btns.find(b => /×|✕|✖|关闭|close/i.test((b.textContent||"")+(b.getAttribute("aria-label")||"")));
          if (x) { x.click(); return "clicked close btn"; }
          return "no close btn found";
        });
        await page.waitForTimeout(800);
        const drawerAfter = await page.locator('[data-testid="dag-node-drawer"]').count();
        log.push("CLOSE attempt: " + closed + " | drawer after: " + drawerAfter + " (0=returned OK)");
      }
    }
  }
  log.push("ERRORS: " + JSON.stringify(errs.slice(0,5)));
} catch (e) {
  log.push("SCRIPT ERR: " + e.message);
  await page.screenshot({ path: `${SHOTS}/vn-05-ERR.png` }).catch(()=>{});
} finally {
  console.log(log.join("\n"));
  await browser.close();
}
