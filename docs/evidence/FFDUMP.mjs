import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
const BASE="http://127.0.0.1:5294", DU="demo:admin:admin|planner|catalog_admin";
const b=await chromium.launch({channel:"chrome",headless:true});
const ctx=await b.newContext({viewport:{width:1920,height:1080},extraHTTPHeaders:{"x-debug-user":DU}});
const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded",timeout:60000});
await p.fill("#login-tenant","demo");await p.fill("#login-username","admin");await p.fill("#login-password","demo1234");
await p.click('form button[type="submit"]'); await p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:60000});
await p.goto(`${BASE}/v/decision-console`,{waitUntil:"domcontentloaded",timeout:60000});
await p.waitForTimeout(3500);
await p.locator('#z1 button', { hasText: '物料价格变动' }).first().click({timeout:20000});
await p.waitForTimeout(1800);
const els = await p.locator('#z1 input, #z1 select, #z1 button').evaluateAll(es=>es.map((e,i)=>{
  const wrap=e.closest('div')||e.parentElement;
  return {i, t:e.tagName, type:e.getAttribute('type')||'', ph:e.getAttribute('placeholder')||'', aria:e.getAttribute('aria-label')||'',
          txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24), near:(wrap?.textContent||'').replace(/\s+/g,' ').slice(0,58), dis:e.disabled===true};
}));
els.forEach(x=>console.log(`  ${x.i}. <${x.t}${x.type?' '+x.type:''}> ph="${x.ph}" txt="${x.txt}" ${x.dis?'[disabled]':''}\n       附近: "${x.near}"`));
console.log(`  ⇒ 共 ${els.length} 个控件`);
await b.close();
