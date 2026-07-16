import { withLogin, BASE } from './pwlib.mjs';
const DIR = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const TARGET = 'act_adm2z00prrk7j3wt';

await withLogin({ username: 'admin', password: 'demo1234', tenant: 'demo' }, async (page) => {
  await page.goto(BASE + '/admin/actions', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1500);
  // click EXECUTED filter tab if present
  const execTab = page.locator('text=EXECUTED').first();
  if (await execTab.count()) { await execTab.click().catch(()=>{}); await page.waitForTimeout(1200); }
  console.log('after EXECUTED filter, rows:');
  console.log((await page.evaluate(()=> (document.querySelector('main')||document.body).innerText)).slice(0,1200));
  // click the target draft row
  const row = page.locator(`text=${TARGET}`).first();
  if (await row.count()) {
    await row.click().catch(()=>{});
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: `${DIR}/chB_fe_action_detail.png`, fullPage: true });
  const text = await page.evaluate(()=> (document.querySelector('main')||document.body).innerText);
  console.log('\n========== ACTION DETAIL after clicking row ==========');
  console.log('URL:', page.url());
  console.log(text.slice(0, 2500));
});
