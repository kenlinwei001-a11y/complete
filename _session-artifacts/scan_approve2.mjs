import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const APPROVE='act_6vanc7ehaq7avsrh', REJECT='act_e67d7txr34f94kfe';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
const decs=[];
page.on('response', async r=>{ if(r.url().includes('/decision')){try{decs.push(`${r.status()} ${(await r.text()).slice(0,240)}`)}catch{}} });
await login(page,'admin');

async function openDraft(id){
  await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await page.selectOption('select[aria-label="状态筛选"]','PENDING_APPROVAL').catch(()=>{});
  await page.waitForTimeout(1000);
  const row = page.locator(`[data-testid="draft-${id}"]`);
  if (await row.count()===0) return false;
  await row.click(); await page.waitForTimeout(700); return true;
}
async function clickConfirm(){
  // modal primary button (last on page)
  const prim = page.locator('.btn.primary');
  const n = await prim.count();
  // click the last primary (modal)
  await prim.nth(n-1).click();
  await page.waitForTimeout(1500);
}

console.log('===== APPROVE FLOW (act_6vanc...) =====');
// step1 planner
let ok = await openDraft(APPROVE);
console.log('opened for step1:', ok);
if (ok){
  const chain1 = (await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ').match(/审批链.*/)?.[0]?.slice(0,140);
  console.log('chain before step1:', chain1);
  decs.length=0; await page.locator('[data-testid=approve-btn]').click(); await page.waitForTimeout(400);
  // screenshot the confirm modal to check empty label
  await page.screenshot({path:`${SP}/confirm_modal.png`});
  const primLabels = await page.locator('.btn.primary').evaluateAll(els=>els.map(e=>`"${e.textContent.trim()}"`));
  console.log('primary btn labels (incl modal):', JSON.stringify(primLabels));
  await clickConfirm();
  console.log('step1 decision resp:', JSON.stringify(decs));
}
// step2 admin
ok = await openDraft(APPROVE);
console.log('opened for step2:', ok);
if (ok){
  const chain2 = (await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ').match(/审批链.*/)?.[0]?.slice(0,140);
  console.log('chain before step2:', chain2);
  decs.length=0; await page.locator('[data-testid=approve-btn]').click(); await page.waitForTimeout(400);
  await clickConfirm();
  console.log('step2 decision resp:', JSON.stringify(decs));
}
// verify executed
await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1000);
await page.selectOption('select[aria-label="状态筛选"]','EXECUTED').catch(()=>{}); await page.waitForTimeout(1000);
const execRow = await page.locator(`[data-testid="draft-${APPROVE}"]`).count();
console.log('APPROVE draft now in EXECUTED list:', execRow);

console.log('\n===== REJECT FLOW (act_e67d...) =====');
ok = await openDraft(REJECT);
console.log('opened reject:', ok);
if (ok){
  await page.fill('[data-testid=draft-detail] textarea','复验驳回测试');
  decs.length=0; await page.locator('[data-testid=reject-btn]').click(); await page.waitForTimeout(400);
  await clickConfirm();
  console.log('reject decision resp:', JSON.stringify(decs));
}
await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1000);
await page.selectOption('select[aria-label="状态筛选"]','REJECTED').catch(()=>{}); await page.waitForTimeout(1000);
console.log('REJECT draft now in REJECTED list:', await page.locator(`[data-testid="draft-${REJECT}"]`).count());
if (await page.locator(`[data-testid="draft-${REJECT}"]`).count()>0){
  await page.locator(`[data-testid="draft-${REJECT}"]`).click(); await page.waitForTimeout(800);
  console.log('REJECTED detail:', (await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ').slice(0,400));
}
console.log('\nCONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,5)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
