import pw from '/home/user/complete/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5263';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WF_LABEL = process.argv[2] || 'audit-order-inf';
const PROP = process.argv[3] || 'qty';
const DELTA = process.argv[4] || '1000';

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
  const page = await ctx.newPage();
  let inferResp = null;
  page.on('response', async (resp) => {
    if (resp.url().includes('/inference')) { try { inferResp = await resp.json(); } catch {} }
  });
  const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
  await page.click('button[type=submit]'); await sleep(2500);
  await page.goto(BASE + '/admin/data-builder', { waitUntil: 'networkidle' }); await sleep(1200);
  await page.click('[data-testid=db-tab-studio]'); await sleep(1200);

  const wfOpts = await page.locator('[data-testid=wf-select] option').allTextContents().catch(()=>[]);
  console.log('workflows:', JSON.stringify(wfOpts));
  // select the target workflow by matching label
  const match = wfOpts.find(o => o.includes(WF_LABEL));
  if (!match) { console.log('WF not found:', WF_LABEL); await browser.close(); return; }
  await page.selectOption('[data-testid=wf-select]', { label: match });
  await sleep(1800);
  console.log('selected:', match);

  // open inference
  const infBtn = page.locator('[data-testid=act-inference]');
  console.log('act-inference disabled:', await infBtn.isDisabled().catch(()=>true));
  await infBtn.click(); await sleep(600);
  const tkOpts = await page.locator('[data-testid=inference-typekey] option').allTextContents().catch(()=>[]);
  console.log('typekey options:', JSON.stringify(tkOpts));
  const propOpts = await page.locator('#inference-prop-options option').evaluateAll(els => els.map(e=>e.value)).catch(()=>[]);
  console.log('prop datalist options:', JSON.stringify(propOpts));
  // type prop directly (free-text input)
  await page.fill('[data-testid=inference-prop]', PROP);
  await page.fill('[data-testid=inference-delta]', DELTA);
  await sleep(400);
  const sub = page.locator('[data-testid=inference-submit]');
  console.log('submit disabled:', await sub.isDisabled().catch(()=>true), '| typeKey=', await page.locator('[data-testid=inference-typekey]').inputValue().catch(()=>'?'), 'prop=', await page.locator('[data-testid=inference-prop]').inputValue().catch(()=>'?'), 'delta=', await page.locator('[data-testid=inference-delta]').inputValue().catch(()=>'?'));
  await sub.click().catch(e=>console.log('click err', String(e)));
  await sleep(2500);

  console.log('\n=== B3 INFERENCE PANEL (DOM) ===');
  const panelText = await page.locator('[data-testid=inference-panel]').innerText().catch(()=>'(missing)');
  console.log(panelText);
  const rows = await page.locator('[data-testid^=inference-row-]').all();
  const domRows = [];
  for (let i=0;i<rows.length;i++){
    const before = await page.locator(`[data-testid=inference-before-${i}]`).innerText().catch(()=>'?');
    const after = await page.locator(`[data-testid=inference-after-${i}]`).innerText().catch(()=>'?');
    const via = await page.locator(`[data-testid=inference-via-${i}]`).innerText().catch(()=>'?');
    domRows.push({before, after, via});
    console.log(`  DOM row${i}: before=${before} after=${after} via=${via}`);
  }
  await page.locator('[data-testid=results-panel]').scrollIntoViewIfNeeded().catch(()=>{});
  await page.screenshot({ path: SHOT + `/b3-${WF_LABEL}-inference.png`, fullPage: true });

  console.log('\n=== B3 INFERENCE NETWORK (endpoint response) ===');
  if (inferResp) {
    console.log('deterministic=', inferResp.deterministic, 'note=', inferResp.note);
    (inferResp.changed||[]).forEach((c,i)=>console.log(`  NET row${i}: ${c.typeKey}#${c.objectId}.${c.prop} before=${c.before} after=${c.after} via=${c.via}`));
    // compare
    console.log('\n=== 逐值对照 (DOM vs NET) ===');
    (inferResp.changed||[]).forEach((c,i)=>{
      const d = domRows[i];
      const okB = d && String(d.after).includes(String(c.after));
      console.log(`  row${i} ${c.prop}: NET ${c.before}->${c.after} | DOM ${d?d.before:'?'}->${d?d.after:'?'} | match=${okB}`);
    });
  } else console.log('NO inference network response captured');
  console.log('\nERRORS:', errs.slice(0,6));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
