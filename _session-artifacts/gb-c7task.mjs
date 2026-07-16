import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const BASE = 'http://127.0.0.1:5177';
const out = [];
const b = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
const page = await b.newPage();
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1000);
  await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('input[type=password]','demo1234');
  await page.click('button[type=submit]'); await page.waitForTimeout(2200);
  // direct-link to a task detail (TaskDetailPage renders DrillBack task-back regardless of task load)
  await page.goto(BASE + '/tasks/task-demo-1', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  const tb = await page.$$('[data-testid="task-back"]');
  out.push('C7 /tasks/:id → task-back count=' + tb.length + ' url=' + page.url());
  if (tb.length) { await tb[0].click(); await page.waitForTimeout(1500); out.push('  after back: pathname=' + await page.evaluate(()=>location.pathname) + ' (NOT /tasks/: ' + !(await page.evaluate(()=>location.pathname)).startsWith('/tasks/') + ')'); }
} catch(e){ out.push('ERR: '+e.message); }
console.log(out.join('\n'));
await b.close();
