import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
const SECRET='SUPERSECRET-abc123-XYZ';
const saveResps=[]; const listResps=[];
page.on('response', async r=>{
  const u=r.url();
  if(u.includes('/b/v1/mcp-configs')){
    try{ const t=await r.text();
      if(r.request().method()==='POST'||r.request().method()==='PUT') saveResps.push(`${r.status()} ${r.request().method()} -> ${t.slice(0,500)}`);
      else if(r.request().method()==='GET') listResps.push(`${r.status()} GET -> ${t.slice(0,500)}`);
    }catch{}
  }
});
await login(page,'admin');
await page.goto(BASE+'/admin/mcp',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
// click 新建
await page.locator('button:has-text("新建")').first().click(); await page.waitForTimeout(800);
// fill form
await page.fill('input[aria-label="MCP 名称"]','复验测试MCP');
await page.fill('input[aria-label="url"]','https://example.test/mcp').catch(()=>{});
await page.fill('input[aria-label="凭据"]',SECRET);
saveResps.length=0;
await page.locator('button:has-text("保存")').first().click();
await page.waitForTimeout(2000);
console.log('SAVE response:', JSON.stringify(saveResps));
console.log('SAVE contains plaintext secret?', saveResps.join('').includes(SECRET));
// re-fetch list
await page.goto(BASE+'/admin/mcp',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
console.log('LIST response:', JSON.stringify(listResps.slice(-1)));
console.log('LIST contains plaintext secret?', listResps.join('').includes(SECRET));
console.log('LIST has credentialRef?', listResps.join('').includes('credentialRef'));
// open the created config, verify credential field is masked/empty
const created = page.locator('button:has-text("复验测试MCP")');
if (await created.count()>0){
  await created.first().click(); await page.waitForTimeout(800);
  const val = await page.locator('input[aria-label="凭据"]').inputValue();
  const ph = await page.locator('input[aria-label="凭据"]').getAttribute('placeholder');
  const type = await page.locator('input[aria-label="凭据"]').getAttribute('type');
  console.log('reopened credential field -> type:',type,'value:',JSON.stringify(val),'placeholder:',JSON.stringify(ph));
  console.log('已配凭据 badge present:', await page.locator('[data-testid^="mcp-cred-"]').count());
  // test connection
  if (await page.locator('[data-testid=mcp-test]').count()>0){
    await page.locator('[data-testid=mcp-test]').click(); await page.waitForTimeout(2500);
    const tools = await page.locator('[data-testid=mcp-tools]').count();
    console.log('mcp-test discovered tools panel:', tools, '| text:', tools>0?(await page.locator('[data-testid=mcp-tools]').innerText()).replace(/\s+/g,' ').slice(0,200):'—');
  }
  await page.screenshot({path:`${SP}/mcp_cred.png`});
}
console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,5)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
