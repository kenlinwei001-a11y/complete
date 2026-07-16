import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const OBJ = '/o/Base/obj_base_changzhou';
const out = { steps: [], asserts: {} };
const push = (m) => out.steps.push(m);

const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
try {
  // ---- login (demo / admin / demo1234) against REAL datacore ----
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  const btn = await page.$('button[type=submit]') || (await page.$$('button'))[0];
  await btn.click();
  await page.waitForTimeout(2500);
  push('after-login url=' + page.url());
  await page.screenshot({ path: EV + '/optV-01-postlogin.png' });

  // ---- deep-link to Object360 (same-site cookie → silent refresh should hold session) ----
  await page.goto(BASE + OBJ, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  // fallback: if bounced to /login, re-login then client-side navigate (no reload)
  if (page.url().includes('/login')) {
    push('deep-link bounced to /login; re-login + client-nav');
    await page.fill('#login-tenant', 'demo');
    await page.fill('#login-username', 'admin');
    await page.fill('input[type=password]', 'demo1234');
    ((await page.$('button[type=submit]')) || (await page.$$('button'))[0]) && await page.click('button[type=submit]');
    await page.waitForTimeout(2500);
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, OBJ);
    await page.waitForTimeout(3000);
  }
  push('O360 url=' + page.url());

  // ---- front-back visible: extract EXACT displayed values ----
  const disp = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => (q(s)?.textContent || '').trim();
    const header = document.querySelector('[data-testid="object-360"] header h2')?.textContent?.trim() || null;
    const objkey = txt('[data-testid="o360-objectkey"]') || null;
    const badge = txt('[data-testid="o360-domain-badge"]') || null;
    const relGroups = [...document.querySelectorAll('[data-testid^="o360-rel-"]')].map((e) => e.getAttribute('data-testid').replace('o360-rel-', ''));
    const lineageNodes = document.querySelectorAll('[data-testid^="o360-lineage-node-"]').length;
    const props = {};
    document.querySelectorAll('[data-testid^="o360-prop-"]').forEach((tr) => {
      const k = tr.querySelector('th')?.textContent?.trim();
      const v = tr.querySelector('td')?.textContent?.trim();
      if (k) props[k] = v;
    });
    const notFound = !!q('[data-testid="o360-notfound"]');
    return { header, objkey, badge, relGroups, lineageNodes, props, notFound };
  });
  out.asserts.display = disp;
  push('header=' + disp.header + ' objkey=' + disp.objkey + ' badge=' + disp.badge + ' lineageNodes=' + disp.lineageNodes + ' relGroups=' + JSON.stringify(disp.relGroups));
  await page.screenshot({ path: EV + '/optV-02-object360.png', fullPage: true });

  // ---- FIX-1: click lineage node → dag-node-drawer must render (was dead) ----
  const nodes = await page.$$('[data-testid^="o360-lineage-node-"]');
  push('lineage node handles: ' + nodes.length);
  if (nodes.length) {
    const before = !!(await page.$('[data-testid="dag-node-drawer"]'));
    await nodes[Math.min(1, nodes.length - 1)].click();  // click a non-center neighbor node
    await page.waitForTimeout(1200);
    const drawerEl = await page.$('[data-testid="dag-node-drawer"]');
    const drawerText = drawerEl ? ((await drawerEl.textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    out.asserts.drawer = { beforeClick: before, afterClick: !!drawerEl, text: drawerText };
    push('DRAWER before=' + before + ' AFTER=' + !!drawerEl);
    push('drawer text: ' + drawerText);
    await page.screenshot({ path: EV + '/optV-03-drawer.png', fullPage: true });
    // close works?
    if (drawerEl) {
      const closeBtn = await page.$('[data-testid="dag-node-drawer"] button');
      if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(600); }
      out.asserts.drawer.closedOk = !(await page.$('[data-testid="dag-node-drawer"]'));
      push('drawer closedOk=' + out.asserts.drawer.closedOk);
    }
  }
  out.consoleErrors = errs.slice(0, 8);
} catch (e) { push('ERR: ' + e.message); out.error = e.message; }
console.log(JSON.stringify(out, null, 2));
await b.close();
