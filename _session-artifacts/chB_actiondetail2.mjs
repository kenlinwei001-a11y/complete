import { withLogin, BASE } from './pwlib.mjs';
const DIR = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const TARGET = 'act_adm2z00prrk7j3wt';

await withLogin({ username: 'admin', password: 'demo1234', tenant: 'demo' }, async (page) => {
  await page.goto(BASE + '/admin/actions', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1200);
  // filter is a <select aria-label="状态筛选">
  await page.selectOption('select[aria-label="状态筛选"]', 'EXECUTED').catch(e=>console.log('sel err', e.message));
  await page.waitForTimeout(1500);
  console.log('=== EXECUTED list ===');
  console.log((await page.evaluate(()=> (document.querySelector('main')||document.body).innerText)).slice(0,600));
  // click the target draft row via data-testid
  const row = page.locator(`[data-testid="draft-${TARGET}"]`);
  if (await row.count()) { await row.click(); await page.waitForTimeout(1500); }
  else { const alt = page.locator(`text=${TARGET}`).first(); if (await alt.count()) { await alt.click(); await page.waitForTimeout(1500); } }
  await page.screenshot({ path: `${DIR}/chB_fe_action_detail.png`, fullPage: true });
  const detail = await page.evaluate(()=> {
    const d = document.querySelector('[data-testid="draft-detail"]');
    return d ? d.innerText : 'NO DETAIL PANEL';
  });
  console.log('\n=== DRAFT DETAIL PANEL (data-testid=draft-detail) ===');
  console.log(detail);
});
