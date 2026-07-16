import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5262';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport:{width:1600,height:1300} })).newPage();
await page.goto(BASE+'/', {waitUntil:'networkidle'});
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForTimeout(2500);
await page.goto(BASE+'/v/sim-sandbox', {waitUntil:'networkidle'});
await page.waitForSelector('[data-testid=sandbox-view]',{timeout:15000}).catch(()=>{});
await page.waitForTimeout(4000);

// is cert loaded? (health/trust radar present vs cert-na)
const certNa = await page.locator('[data-testid=sandbox-cert-na]').count();
const healthRadar = await page.locator('[data-testid=sandbox-health-radar]').count();
const healthComposite = (await page.locator('[data-testid=sandbox-health-radar-composite]').count())>0 ? await page.locator('[data-testid=sandbox-health-radar-composite]').first().textContent() : '<none>';
console.log('cert-na present:', certNa, '| health-radar present:', healthRadar, '| health composite:', healthComposite);

// extract SVG text via textContent (innerText fails on SVG)
const healthAxes = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid=sandbox-health-radar]');
  if (!svg) return null;
  return Array.from(svg.querySelectorAll('text')).map(t=>t.textContent.trim());
});
console.log('health-radar axis labels:', JSON.stringify(healthAxes));

const readinessAxes = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid=sandbox-radar]');
  if (!svg) return null;
  return Array.from(svg.querySelectorAll('text')).map(t=>t.textContent.trim());
});
console.log('readiness-radar (3-dim) axis labels:', JSON.stringify(readinessAxes));

// does health radar contain 建模完整度 and NOT 利用率 as a dim label?
const hasModeling = (healthAxes||[]).includes('建模完整度');
const hasUtilAsDim = (healthAxes||[]).includes('利用率');
console.log('health radar has 建模完整度 dim:', hasModeling, '| still has 利用率 dim (should be false):', hasUtilAsDim);

// where does "利用率" text appear on page? (base card is legit)
const utilLocs = await page.evaluate(() => {
  const out=[];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while(n=walk.nextNode()){ if(n.textContent.includes('利用率')){ let el=n.parentElement; out.push((el?.getAttribute('data-testid')||el?.tagName||'?')+': '+n.textContent.trim().slice(0,40)); } }
  return out;
});
console.log('all "利用率" text occurrences:', JSON.stringify(utilLocs));
await browser.close();
console.log('DONE');
