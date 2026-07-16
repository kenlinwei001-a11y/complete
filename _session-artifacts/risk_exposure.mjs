import { launch, login, BASE, SHOT_DIR } from './driver.mjs';
const { browser, page } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/v/risk`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3500);
async function val(tid){ const e=await page.$(`[data-testid="${tid}"]`); return e?(await e.innerText()).replace(/\s+/g,' ').trim():'(missing)'; }
console.log('risk-summary-red (越线):', await val('risk-summary-red'), '|', await val('risk-summary-red-value'));
console.log('risk-summary-yellow:', await val('risk-summary-yellow-value'));
console.log('risk-summary-exposure (敞口):', await val('risk-summary-exposure'), '|', await val('risk-summary-exposure-value'));
console.log('risk-summary-custs:', await val('risk-summary-custs-value'));
console.log('risk-summary-mitigations:', await val('risk-summary-mitigations-value'));
console.log('risk-decision-summary:', await val('risk-decision-summary'));
console.log('risk-confidence-banner:', await val('risk-confidence-banner'));
// per-card datamode + exposure for a couple bases
for (const b of ['常州','合肥']){
  console.log(`card ${b}: factor=${await val('risk-factor-'+b)} affected=${await val('risk-affected-'+b)} exposure=${await val('risk-exposure-'+b)} datamode=${await val('risk-datamode-'+b)}`);
}
await page.screenshot({ path:`${SHOT_DIR}/risk-exposure-detail.png`, fullPage:true });
await browser.close();
