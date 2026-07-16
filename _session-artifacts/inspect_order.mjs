import { launch, login, BASE, SHOT_DIR } from './driver.mjs';
const { browser, page } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/v/order-chain`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3000);
// list all data-testid present
const testids = await page.$$eval('[data-testid]', els => [...new Set(els.map(e=>e.getAttribute('data-testid')))]);
console.log('TESTIDS present ('+testids.length+'):');
console.log(testids.join('  '));
console.log('\n--- select an order then wait ---');
const s = await page.$('[data-testid=ofc-so-select]');
if (s){ await s.selectOption('SO-3391'); await page.waitForTimeout(3000); }
const testids2 = await page.$$eval('[data-testid]', els => [...new Set(els.map(e=>e.getAttribute('data-testid')))]);
const newOnes = testids2.filter(t=>!testids.includes(t));
console.log('NEW testids after select:', newOnes.join('  '));
const capNow = await page.$('[data-testid=ofc-judge-cap]');
console.log('ofc-judge-cap after select:', capNow?(await capNow.innerText()).replace(/\s+/g,' '):'STILL NULL');
// full visible text
const txt = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('\nBODY (first 1500):', txt.slice(0,1500));
await page.screenshot({ path:`${SHOT_DIR}/order-inspect.png`, fullPage:true });
await browser.close();
