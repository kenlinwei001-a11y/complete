import { withLogin, BASE } from './pwlib.mjs';

const DIR = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const routes = [
  ['actions', '/admin/actions'],
  ['tickets', '/admin/tickets'],
  ['audit-log', '/admin/audit-log'],
  ['llm-providers', '/admin/llm-providers'],
  ['features', '/admin/features'],
  ['solver-review', '/admin/solver-review'],
  ['decisions', '/admin/decisions'],
];

await withLogin({ username: 'admin', password: 'demo1234', tenant: 'demo' }, async (page, ctx, logs) => {
  for (const [name, route] of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 25000 });
    } catch (e) {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(()=>{});
    }
    await page.waitForTimeout(2500);
    const png = `${DIR}/chB_fe_${name}.png`;
    await page.screenshot({ path: png, fullPage: true }).catch(e=>console.log('shot err', e.message));
    // Grab the main content text (below fixed nav)
    const text = await page.evaluate(() => {
      const main = document.querySelector('main') || document.querySelector('[role=main]') || document.body;
      return (main.innerText || '').slice(0, 2500);
    });
    console.log(`\n========== ${name} (${route}) ==========`);
    console.log('URL:', page.url());
    console.log(text);
  }
  const errs = logs.filter(l => l.startsWith('[pageerror]'));
  if (errs.length) { console.log('\n--- PAGE ERRORS ---'); errs.slice(0,10).forEach(e=>console.log(e)); }
});
