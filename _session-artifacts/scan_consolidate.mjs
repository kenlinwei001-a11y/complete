import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
await login(page,'admin');

console.log('===== B4 SKILL create->publish =====');
const skillNet=[];
page.on('response', async r=>{ if(/\/b\/v1\/skills/.test(r.url())){const m=r.request().method(); if(m!=='GET'){try{skillNet.push(`${r.status()} ${m} ${r.url().split('/b/v1/')[1]} -> ${(await r.text()).slice(0,120)}`)}catch{}}} });
await page.goto(BASE+'/admin/skills',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
await page.locator('[data-testid=skill-create]').click(); await page.waitForTimeout(1800);
console.log('after create net:', JSON.stringify(skillNet));
// the new DRAFT skill should be selected; find publish button
const pubBtn = page.locator('button:has-text("发布")');
console.log('publish btn count:', await pubBtn.count());
const beforeStatus = (await page.locator('main').innerText()).match(/DRAFT|PUBLISHED/)?.[0];
if (await pubBtn.count()>0){
  skillNet.length=0;
  await pubBtn.first().click(); await page.waitForTimeout(2000);
  console.log('publish net:', JSON.stringify(skillNet));
}
await page.screenshot({path:`${SP}/skill_publish.png`});

console.log('\n===== DATA BUILDER engine tab =====');
await page.goto(BASE+'/admin/data-builder',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
// engine tab is default
const engineText = (await page.locator('[data-testid=data-builder-page]').innerText()).replace(/\s+/g,' ');
console.log('engine tab text[0:350]:', engineText.slice(0,350));
console.log('has story build controls (运行构建/建域):', /运行构建|建域|故事/.test(engineText));
console.log('quick-synth present:', await page.locator('[data-testid=db-quick-synth]').count(), '| growth-console:', await page.locator('[data-testid=db-growth-console]').count(), '| approvals:', await page.locator('[data-testid=db-approvals]').count());

console.log('\n===== HOMELESS admin pages (其它 group) render check =====');
for (const p of ['knowledge','schema-reconcile','decisions','audit-log','boundary','prototype-intake']){
  await page.goto(BASE+'/admin/'+p,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200);
  const is403=await page.locator('[data-testid=page-403]').count();
  const is404=await page.locator('[data-testid=page-404]').count();
  const mainText=(await page.locator('main').innerText()).replace(/\s+/g,' ').trim();
  const white = mainText.length<8;
  console.log(`  /admin/${p} -> ${is403?'403':is404?'404':white?'WHITE!':'RENDERED'} | text[0:90]: ${mainText.slice(0,90)}`);
}
console.log('\nCONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,6)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)].slice(0,10)));
await b.close(); console.log('DONE');
