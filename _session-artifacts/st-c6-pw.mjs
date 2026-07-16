import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const out = { steps: [] };
const P = (m) => { out.steps.push(m); };
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
try {
  // login
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2200);
  // deep-link to connections
  await page.goto(BASE + '/admin/connections', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  P('connections url=' + page.url());
  // SYNTHETIC badge present?
  const synBadge = await page.$('[data-testid^="conn-synthetic-"]');
  P('SYNTHETIC badge visible: ' + !!synBadge + (synBadge ? ' (text=' + ((await synBadge.textContent()) || '').trim() + ')' : ''));
  // datasets listed?
  const dsItems = await page.$$('[data-testid^="ds-item-"]');
  P('dataset rows visible: ' + dsItems.length);
  // preview first dataset → real rows
  const previewBtn = await page.$('[data-testid^="ds-preview-"]');
  if (previewBtn) {
    await previewBtn.click();
    await page.waitForTimeout(1200);
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasReal = /SO-\d{3,}|changzhou|常州|4680|整车厂|baseId|orderNo/.test(bodyText);
    P('after preview: real business rows visible = ' + hasReal);
  }
  await page.screenshot({ path: EV + '/st-c6-connectors.png', fullPage: true });
  // download Excel → capture
  const dlBtn = await page.$('[data-testid^="ds-download-xlsx-"]');
  P('download-xlsx button present: ' + !!dlBtn);
  if (dlBtn) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      dlBtn.click(),
    ]);
    if (download) {
      const fn = download.suggestedFilename();
      const path = '/tmp/st-browser-download.xlsx';
      await download.saveAs(path);
      const buf = readFileSync(path);
      const pk = buf.slice(0, 2).toString('latin1') === 'PK';
      P('DOWNLOADED file: ' + fn + ' | bytes=' + buf.length + ' | PK-magic=' + pk + ' | .synthetic=' + /\.synthetic\./.test(fn));
      // unzip + check content
      try {
        execSync('rm -rf /tmp/st-bdl && mkdir /tmp/st-bdl && cd /tmp/st-bdl && unzip -o -q ' + path);
        const sheet = execSync("cat /tmp/st-bdl/xl/worksheets/sheet1.xml").toString();
        const vals = (sheet.match(/<t[^>]*>[^<]*<\/t>|<v>[^<]*<\/v>/g) || []).map((s) => s.replace(/<[^>]*>/g, '')).slice(0, 14);
        const rows = (sheet.match(/<row/g) || []).length;
        P('downloaded xlsx: rows=' + rows + ' | first cells=' + JSON.stringify(vals).slice(0, 200));
      } catch (e) { P('unzip check err: ' + e.message); }
    } else {
      P('NO download event captured');
    }
  }
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
