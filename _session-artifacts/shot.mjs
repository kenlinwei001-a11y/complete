import { chromium } from 'playwright-core';

const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/capsim-integ-shots';
const TAG = process.argv[2] || 'before';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERR:' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// login
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'planner');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
await page.waitForTimeout(2500); // lands on "/" launcher
// SPA-navigate to risk board WITHOUT full reload (token is memory-only). Open 推演 dropdown then click 产能推演.
await page.getByText('推演', { exact: true }).first().hover().catch(()=>{});
await page.waitForTimeout(400);
const link = page.getByRole('link', { name: '产能推演' }).first();
if (await link.count()) { await link.click({ force: true }).catch(()=>{}); }
else { await page.getByText('产能推演', { exact: true }).first().click({ force: true }).catch(()=>{}); }
await page.waitForURL('**/v/risk', { timeout: 15000 }).catch(() => {});
await page.waitForSelector('[data-testid^="risk-card-"]', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// Extract card facts
const facts = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-testid^="risk-card-"]')];
  const rgbTier = (c) => {
    const m = c.match(/\d+/g); if (!m) return c;
    const [r,g,b] = m.map(Number);
    // reference tiers: NORMAL #62BE77(98,190,119) WATCH #D2B04C(210,176,76) JAM #DD7E9E(221,126,158) MUTED #8A94A6(138,148,166)
    const near = (a,b2)=>Math.abs(a-b2)<=6;
    if (near(r,98)&&near(g,190)&&near(b,119)) return 'GREEN(normal)';
    if (near(r,210)&&near(g,176)&&near(b,76)) return 'GOLD(watch)';
    if (near(r,221)&&near(g,126)&&near(b,158)) return 'PINK(jam)';
    if (near(r,138)&&near(g,148)&&near(b,166)) return 'GREY(muted)';
    return `rgb(${r},${g},${b})`;
  };
  return cards.map(card => {
    const base = card.getAttribute('data-testid').replace('risk-card-','');
    const mode = card.getAttribute('data-decision-mode');
    const peakEl = card.querySelector('[data-testid^="risk-peak-"]');
    const peakColor = peakEl ? rgbTier(getComputedStyle(peakEl).color) : null;
    const peakText = peakEl ? peakEl.textContent.trim() : null;
    const unitEl = card.querySelector('.rkUnit, [class*="rkUnit"]');
    const chipsWrap = card.querySelector('[data-testid^="risk-chips-"]');
    const chips = chipsWrap ? [...chipsWrap.children].map(ch => ({ text: ch.textContent.trim(), color: rgbTier(getComputedStyle(ch).color) })) : [];
    const borderColor = rgbTier(getComputedStyle(card).borderTopColor);
    // exposure/custs decision-red?
    const custEl = card.querySelector('[data-testid^="risk-custs-"]');
    const custColor = custEl ? getComputedStyle(custEl).color : null;
    return { base, mode, peakText, peakColor, chips, borderColor,
             unit: card.textContent.includes('估算·无实测') ? '估算·无实测' : (card.textContent.includes('最早越线')?'最早越线':(card.textContent.includes('峰值张力')?'峰值张力':'?')),
             custColorRaw: custColor };
  });
});

// KPIs
const kpis = await page.evaluate(() => {
  const g = (id) => { const e = document.querySelector(`[data-testid="${id}-value"]`); return e ? e.textContent.trim() : null; };
  return { bases: g('risk-kpi-bases'), factorpts: g('risk-kpi-factorpts'), orders: g('risk-kpi-orders'), custs: g('risk-kpi-custs'), earliest: g('risk-kpi-earliest'),
           health: (document.querySelector('[data-testid="risk-kpi-health"]')||{}).textContent || null };
});

console.log('=== KPIs ===');
console.log(JSON.stringify(kpis, null, 0));
console.log('=== CARDS ===');
for (const c of facts) console.log(JSON.stringify(c));
console.log('=== console errors ===');
console.log(errs.slice(0,10).join('\n') || '(none)');

await page.screenshot({ path: `${OUT}/${TAG}-01-board-collapsed.png`, fullPage: true });

// open first crossing card detail
const firstMulti = facts.find(c => c.chips.length >= 2) || facts[0];
if (firstMulti) {
  await page.click(`[data-testid="risk-card-${firstMulti.base}"]`).catch(()=>{});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${TAG}-02-card-detail-${firstMulti.base}.png`, fullPage: true });
  console.log('opened detail for', firstMulti.base);
}

await browser.close();
