import pw from '/home/user/complete/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5263';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MODE = process.argv[2] || 'explore'; // explore | graph | data

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/ontology-workflows')) {
      let body = null; try { body = await resp.json(); } catch {}
      net.push({ method: resp.request().method(), url: u.replace(BASE,'').replace('http://127.0.0.1:4063',''), status: resp.status(), body });
    }
  });
  const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR '+e.message));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
  await page.click('button[type=submit]'); await sleep(2500);
  await page.goto(BASE + '/admin/data-builder', { waitUntil: 'networkidle' }); await sleep(1500);
  console.log('URL:', page.url());
  // switch to studio tab
  const studioTab = await page.locator('[data-testid=db-tab-studio]').count();
  console.log('db-tab-studio present:', studioTab);
  if (studioTab) { await page.click('[data-testid=db-tab-studio]'); await sleep(1500); }
  await page.screenshot({ path: SHOT + '/m02-studio-initial.png', fullPage: true });

  // list existing workflows
  const wfOpts = await page.locator('[data-testid=wf-select] option').allTextContents().catch(()=>[]);
  console.log('EXISTING WORKFLOWS (wf-select options):', JSON.stringify(wfOpts));
  const buttons = await page.locator('button[data-testid]').all();
  const btnIds = [];
  for (const b of buttons) { const t = await b.getAttribute('data-testid'); const vis = await b.isVisible().catch(()=>false); btnIds.push(t + (vis?'':'(hidden)')); }
  console.log('VISIBLE STUDIO BUTTONS:', JSON.stringify(btnIds.slice(0,40)));

  if (MODE === 'explore') {
    console.log('\nBODY (studio area, first 600):', (await page.locator('body').innerText()).slice(0,600));
    console.log('\nNET calls:'); net.forEach(n => console.log('  ', n.method, n.status, n.url));
    console.log('ERRORS:', errs.slice(0,8));
    await browser.close(); return;
  }

  // create workflow
  const createBtn = MODE === 'graph' ? 'wf-new-graph' : 'wf-new-data';
  const hasCreate = await page.locator(`[data-testid=${createBtn}]`).count();
  const hasEmpty = await page.locator('[data-testid=wf-empty-create]').count();
  if (hasCreate) { await page.click(`[data-testid=${createBtn}]`); }
  else if (hasEmpty) { await page.click('[data-testid=wf-empty-create]'); }
  await sleep(2000);
  console.log('after create, URL', page.url());
  await page.screenshot({ path: SHOT + `/m02-${MODE}-created.png`, fullPage: true });

  // canvas node count
  const canvasNodes = await page.locator('[data-testid^=wf-node-], [data-testid^=canvas-node-], .wf-node, [data-node-id]').count().catch(()=>0);
  console.log('canvas node-ish count:', canvasNodes);

  // PUBLISH (B4)
  const pubBtn = await page.locator('[data-testid=act-publish]');
  if (await pubBtn.count()) {
    await pubBtn.click(); await sleep(2500);
    const pubTypes = await page.locator('[data-testid=publish-types]').innerText().catch(()=>'(missing)');
    const pubLinks = await page.locator('[data-testid=publish-links]').innerText().catch(()=>'(missing)');
    console.log('\n=== B4 PUBLISH PANEL (DOM) ===');
    console.log('  publish-types:', pubTypes);
    console.log('  publish-links:', pubLinks);
    await page.screenshot({ path: SHOT + `/m02-${MODE}-published.png`, fullPage: true });
  } else console.log('NO act-publish button');

  // SCAFFOLD
  const scafBtn = await page.locator('[data-testid=act-scaffold]');
  if (await scafBtn.count()) {
    await scafBtn.click(); await sleep(2000);
    console.log('\n=== SCAFFOLD (DOM) ===');
    console.log('  views:', await page.locator('[data-testid=scaffold-views]').innerText().catch(()=>'(missing)'));
    console.log('  persisted:', await page.locator('[data-testid=scaffold-persisted]').innerText().catch(()=>'(none)'));
  }

  // INFERENCE (B3)
  const infBtn = await page.locator('[data-testid=act-inference]');
  const infDisabled = await infBtn.isDisabled().catch(()=>true);
  console.log('\nact-inference present:', await infBtn.count(), 'disabled:', infDisabled);
  if (await infBtn.count() && !infDisabled) {
    await infBtn.click(); await sleep(800);
    // fill inference form
    const tkOpts = await page.locator('[data-testid=inference-typekey] option').allTextContents().catch(()=>[]);
    console.log('inference typekey options:', JSON.stringify(tkOpts));
    // pick first typekey
    if (tkOpts.length) await page.selectOption('[data-testid=inference-typekey]', { index: 0 }).catch(()=>{});
    await sleep(300);
    // prop: use datalist — type a value; try to read options
    const propOpts = await page.locator('#inference-prop-options option').allTextContents().catch(()=>[]);
    console.log('inference prop options:', JSON.stringify(propOpts));
    if (propOpts.length) await page.fill('[data-testid=inference-prop]', propOpts[0]);
    await page.fill('[data-testid=inference-delta]', '10');
    await sleep(300);
    const subBtn = page.locator('[data-testid=inference-submit]');
    console.log('inference-submit disabled:', await subBtn.isDisabled().catch(()=>true));
    await subBtn.click().catch(e=>console.log('submit click err', String(e)));
    await sleep(2500);
    console.log('\n=== B3 INFERENCE PANEL (DOM) ===');
    console.log('  panel:', await page.locator('[data-testid=inference-panel]').innerText().catch(()=>'(missing)'));
    const rows = await page.locator('[data-testid^=inference-row-]').all();
    console.log('  changed rows:', rows.length);
    for (let i=0;i<rows.length && i<8;i++){
      const before = await page.locator(`[data-testid=inference-before-${i}]`).innerText().catch(()=>'?');
      const after = await page.locator(`[data-testid=inference-after-${i}]`).innerText().catch(()=>'?');
      const via = await page.locator(`[data-testid=inference-via-${i}]`).innerText().catch(()=>'?');
      console.log(`    row${i}: ${before} -> ${after} via ${via}`);
    }
    await page.screenshot({ path: SHOT + `/m02-${MODE}-inference.png`, fullPage: true });
  }

  console.log('\n=== NETWORK /ontology-workflows calls ===');
  net.forEach(n => {
    let extra = '';
    if (n.url.includes('/publish') && n.body) extra = ' types=' + JSON.stringify(n.body.types) + ' links=' + JSON.stringify(n.body.links);
    if (n.url.includes('/inference') && n.body) extra = ' changed=' + JSON.stringify((n.body.changed||[]).map(c=>`${c.typeKey}.${c.prop}:${c.before}->${c.after}`)) + ' det=' + n.body.deterministic;
    console.log('  ', n.method, n.status, n.url, extra);
  });
  console.log('ERRORS:', errs.slice(0,8));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
