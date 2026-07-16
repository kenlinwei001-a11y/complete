import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
const runResps=[];
page.on('response', async r=>{ if(/\/workflows\/[^/]+\/(run|publish)/.test(r.url())){try{runResps.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')} -> ${(await r.text()).slice(0,300)}`)}catch{}} });
await login(page,'admin');

console.log('===== B2 WORKFLOWS =====');
await page.goto(BASE+'/admin/workflows',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
// list all workflows in selector
const opts = await page.locator('select[aria-label="选择 workflow"] option').evaluateAll(o=>o.map(x=>x.textContent.trim()));
console.log('workflow options:', JSON.stringify(opts));
// editor for default selected
const edtxt = (await page.locator('[data-testid=workflow-editor]').innerText().catch(()=>'NO EDITOR')).replace(/\s+/g,' ');
console.log('editor[0:400]:', edtxt.slice(0,400));
console.log('steps rendered (StepRow count via 步骤类型 selects excluded):', await page.locator('[data-testid=workflow-editor] select').count());
// Is try-run visible? (only DRAFT editable). Check publish/try-run buttons
console.log('has 试运行 btn:', await page.locator('[data-testid=wf-dry-run]').count(), '| has publish:', await page.locator('[data-testid=wf-publish]').count());
// Create a new workflow (DRAFT) to test edit+run
await page.locator('[data-testid=workflow-create]').click(); await page.waitForTimeout(1800);
const edtxt2 = (await page.locator('[data-testid=workflow-editor]').innerText().catch(()=>'')).replace(/\s+/g,' ');
console.log('after create, editor[0:200]:', edtxt2.slice(0,200));
console.log('now has 试运行:', await page.locator('[data-testid=wf-dry-run]').count());
// try-run the new draft
if (await page.locator('[data-testid=wf-dry-run]').count()>0){
  runResps.length=0;
  await page.locator('[data-testid=wf-dry-run]').click();
  await page.waitForTimeout(3000);
  console.log('DRY-RUN network:', JSON.stringify(runResps));
  const dr = await page.locator('[data-testid=workflow-editor]').innerText();
  console.log('dry-run result visible?:', dr.includes('试运行')||dr.includes('结果')||dr.includes('output'), '| snippet:', dr.replace(/\s+/g,' ').slice(0,300));
  await page.screenshot({path:`${SP}/wf_dryrun.png`});
}

console.log('\n===== B1 AGENTS =====');
await page.goto(BASE+'/admin/agents',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
// left list agent buttons
const agentBtns = await page.locator('button:has(.badge)').evaluateAll(b=>b.map(x=>x.textContent.trim()).filter(t=>t.includes('PUBLISHED')||t.includes('DRAFT')).slice(0,20));
console.log('agent buttons:', agentBtns.length, JSON.stringify(agentBtns.slice(0,6)));
// click first agent
await page.locator('button:has(.badge)').filter({hasText:/PUBLISHED|DRAFT/}).first().click().catch(e=>console.log('click err',e.message));
await page.waitForTimeout(1500);
const aed = await page.locator('[data-testid=agent-editor]').count();
console.log('agent-editor present:', aed);
if (aed>0){
  const at = (await page.locator('[data-testid=agent-editor]').innerText()).replace(/\s+/g,' ');
  console.log('agent editor[0:500]:', at.slice(0,500));
  await page.screenshot({path:`${SP}/agent_detail.png`});
}
console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,5)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
