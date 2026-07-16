import { launch, login } from './pw.mjs';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const sNo = process.argv[2] || 'S01';
const needle = process.argv[3] || '承接';
const waitText = process.argv[4] || 'GWh';
const name = process.argv[5] || `scen_${sNo}`;

const { browser, page, logs } = await launch();
await login(page);
await page.waitForTimeout(1200);
// open command palette
await page.keyboard.down('Control'); await page.keyboard.press('K'); await page.keyboard.up('Control');
await page.waitForTimeout(600);
const paletteVisible = await page.locator('[data-testid=command-palette]').count();
console.log('palette visible:', paletteVisible);
if (paletteVisible) {
  await page.fill('[data-testid=command-palette-input]', needle);
  await page.waitForTimeout(500);
  const item = page.locator(`[data-testid=command-palette-item-${sNo}]`);
  const cnt = await item.count();
  console.log(`item ${sNo} count:`, cnt);
  if (cnt) { await item.first().click(); }
}
// wait for answer to render
let appeared = false;
for (let i=0;i<40;i++){
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText().catch(()=> '');
  if (txt.includes(waitText)) { appeared = true; break; }
}
console.log('waitText appeared:', appeared, 'url:', page.url());
await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true });
const body = await page.locator('body').innerText().catch(()=> '');
// extract numbers near labels
const grab = (label) => { const re = new RegExp(label + '[\\s\\S]{0,40}?([0-9]+[0-9.,]*\\s*(?:GWh|%)?)'); const m = body.match(re); return m? m[1].trim(): null; };
console.log('--- EXTRACTED ---');
console.log('P50:', grab('P50'));
console.log('P90:', grab('P90'));
console.log('缺口:', grab('缺口'));
console.log('--- BODY SLICE (answer area) ---');
const idx = body.indexOf('本次回答') >=0 ? body.indexOf('本次回答') : Math.max(0, body.indexOf(waitText)-200);
console.log(body.slice(idx, idx+900));
console.log('--- LOGS ---'); console.log(logs.slice(-10).join('\n'));
await browser.close();
