import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
let mcpBody='';
page.on('response', async r=>{ if(r.url().endsWith('/b/v1/mcp-configs')){try{mcpBody=await r.text()}catch{}} });
await login(page,'admin');

console.log('===== B3 MCP =====');
await page.goto(BASE+'/admin/mcp',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2000);
console.log('mcp-configs response (raw, check for plaintext secret):');
console.log(mcpBody.slice(0,600));
const hasCredRef = mcpBody.includes('credentialRef');
const hasPlaintextCred = /"credential"\s*:\s*"[^"]+"/.test(mcpBody) || /"secret"\s*:\s*"[^"]/.test(mcpBody) || /"apiKey"\s*:\s*"[^"]/.test(mcpBody);
console.log('has credentialRef:', hasCredRef, '| has PLAINTEXT credential/secret/apiKey:', hasPlaintextCred);
// list server cards
const serverBtns = await page.locator('button').evaluateAll(b=>b.map(x=>x.textContent.trim()).filter(t=>t&&t.length<40).slice(0,30));
const bodyText = (await page.locator('main').innerText()).replace(/\s+/g,' ');
console.log('mcp page text[0:400]:', bodyText.slice(0,400));
// click a config that has 已配凭据 or first editable server; open editor and check credential input
const credInput = page.locator('input[aria-label="凭据"]');
// select first server in list to open editor
const firstServer = page.locator('[data-testid^="mcp-status-"]').first();
if (await firstServer.count()>0){ await firstServer.click().catch(()=>{}); await page.waitForTimeout(800); }
// find any server row clickable
const rows = page.locator('main li, main [data-testid^=mcp-]');
await page.screenshot({path:`${SP}/mcp.png`});
const ci = await credInput.count();
if (ci>0){
  const val = await credInput.first().inputValue();
  const ph = await credInput.first().getAttribute('placeholder');
  const type = await credInput.first().getAttribute('type');
  console.log('credential input -> type:',type,'| value:',JSON.stringify(val),'| placeholder:',JSON.stringify(ph));
}

console.log('\n===== B4 SKILLS =====');
await page.goto(BASE+'/admin/skills',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
const skillBtns = await page.locator('button:has(.badge)').filter({hasText:/PUBLISHED|DRAFT/}).count();
console.log('skill buttons:', skillBtns);
await page.locator('button:has(.badge)').filter({hasText:/PUBLISHED|DRAFT/}).first().click(); await page.waitForTimeout(1200);
const skillDetail = await page.locator('[data-testid=skill-methodology]').count();
console.log('skill detail (methodology panel):', skillDetail);
if (skillDetail>0){
  const st=(await page.locator('main').innerText()).replace(/\s+/g,' ');
  console.log('skill detail text[0:400]:', st.slice(0,400));
  console.log('has publish btn:', await page.locator('button:has-text("发布")').count(), '| has methodology-template:', await page.locator('[data-testid=skill-methodology-template]').count());
  await page.screenshot({path:`${SP}/skill_detail.png`});
}

console.log('\n===== B5 SCENES =====');
await page.goto(BASE+'/admin/scenes',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
console.log('scene table rows:', await page.locator('table tbody tr').count());
console.log('查看配置 count:', await page.locator('button:has-text("查看配置")').count());
await page.locator('button:has-text("查看配置")').first().click().catch(e=>console.log('err',e.message)); await page.waitForTimeout(1200);
const sceneCfg = (await page.locator('main').innerText()).replace(/\s+/g,' ');
console.log('after 查看配置, text[0:400]:', sceneCfg.slice(0,400));
await page.screenshot({path:`${SP}/scenes_config.png`});
console.log('\nCONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,5)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
