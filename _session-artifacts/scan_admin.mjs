import { makeCtx, attach, login, newSink, dumpSink, BASE, SP } from './driver.mjs';
const PAGES = [
  ['agents','/admin/agents'], ['workflows','/admin/workflows'], ['mcp','/admin/mcp'],
  ['skills','/admin/skills'], ['scenes','/admin/scenes'], ['data-builder','/admin/data-builder'],
  ['actions','/admin/actions'],
];
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink();
attach(page, sink);
const url = await login(page,'admin');
console.log('LOGIN ->', url);
for (const [name, path] of PAGES) {
  sink.net.length=0; sink.console.length=0; sink.pageerr.length=0;
  await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1800);
  const txt = (await page.locator('body').innerText()).replace(/\s+/g,' ').trim();
  const rows = await page.locator('table tbody tr').count();
  const tabs = await page.locator('[role=tab], button').evaluateAll(els => els.map(e=>e.textContent?.trim()).filter(Boolean).slice(0,40));
  const empty = await page.locator('.empty-state').count();
  const forbidden = txt.includes('无权访问')||txt.includes('403')||txt.includes('Forbidden');
  const notfound = txt.includes('页面不存在')||txt.includes('404')||txt.includes('NOT_FOUND');
  await page.screenshot({ path:`${SP}/admin_${name}.png`, fullPage:false });
  console.log(`\n===== ${name} (${path}) =====`);
  console.log('URL:', page.url());
  console.log('rows:', rows, '| empty-state:', empty, '| forbidden:', forbidden, '| notfound:', notfound);
  console.log('TEXT[0:500]:', txt.slice(0,500));
  console.log('BUTTONS:', JSON.stringify(tabs.slice(0,30)));
  console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
  console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,6)));
  console.log('PAGEERR:', JSON.stringify([...new Set(sink.pageerr)].slice(0,4)));
}
await b.close();
console.log('\nDONE');
