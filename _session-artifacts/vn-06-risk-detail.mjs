import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
const log = [];
try {
  await login(page, "admin");
  await goView(page, "risk");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/vn-06a-riskboard.png`, fullPage: false });

  // find risk cards
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^=risk-card-]"))
      .map(e => e.getAttribute("data-testid"))
      .filter(t => !/whatif/.test(t))
  );
  log.push("RISK CARDS: " + JSON.stringify(cards.slice(0,15)));

  if (cards.length) {
    const c = page.locator(`[data-testid="${cards[0]}"]`).first();
    await c.scrollIntoViewIfNeeded();
    await c.click();
    await page.waitForTimeout(2500); // wait for bottleneck_matrix solver
    // is a Modal open?
    const modalTitle = await page.evaluate(() => {
      const m = document.querySelector("[class*=modal], [role=dialog]");
      return m ? (m.querySelector("h1,h2,h3,[class*=title]")?.textContent || m.textContent.slice(0,60)) : "NO MODAL";
    });
    log.push("MODAL TITLE: " + modalTitle);

    // 轨N-④: BottleneckDetailPanel present?
    const bd = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="bottleneck-detail-panel"]');
      if (!panel) return { present: false };
      const dm = document.querySelector('[data-testid="bottleneck-detail-datamode"]');
      const table = document.querySelector('[data-testid="bottleneck-detail-table"]');
      const factorRows = Array.from(document.querySelectorAll('[data-testid^="bottleneck-factor-"]')).map(r => ({
        tid: r.getAttribute("data-testid"),
        txt: (r.textContent || "").trim().replace(/\s+/g, " ")
      }));
      return {
        present: true,
        titleText: (panel.querySelector(".section-title")?.textContent || "").trim(),
        dataMode: dm ? dm.textContent.trim() : null,
        hasTable: !!table,
        factorRows,
        sourceNote: (panel.textContent.match(/来源：bottleneck_matrix[^]*?可溯/) || ["(none)"])[0].slice(0,140),
      };
    });
    log.push("=== 轨N-④ BOTTLENECK DETAIL PANEL ===");
    log.push(JSON.stringify(bd, null, 1));
    await page.screenshot({ path: `${SHOTS}/vn-06b-risk-detail-modal.png` });

    // scroll the modal to the bottleneck panel and screenshot
    await page.evaluate(() => document.querySelector('[data-testid="bottleneck-detail-panel"]')?.scrollIntoView());
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/vn-06c-bottleneck-panel.png` });

    // 轨N-①: can we close the modal (return)?
    const closed = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const x = btns.find(b => /×|✕|✖|关闭/.test((b.textContent||"")) || /close|关闭/i.test(b.getAttribute("aria-label")||""));
      if (x) { x.click(); return "closed"; }
      return "no close";
    });
    await page.waitForTimeout(700);
    const modalGone = await page.evaluate(() => !document.querySelector('[data-testid="bottleneck-detail-panel"]'));
    log.push("MODAL CLOSE: " + closed + " | modal gone (returned): " + modalGone);
  }
  log.push("ERRORS: " + JSON.stringify(errs.slice(0,5)));
} catch (e) {
  log.push("SCRIPT ERR: " + e.message);
  await page.screenshot({ path: `${SHOTS}/vn-06-ERR.png` }).catch(()=>{});
} finally {
  console.log(log.join("\n"));
  await browser.close();
}
