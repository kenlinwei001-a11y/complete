import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();

// admin-only pages a lower role must NOT reach (expect 403)
const CROSS = ['agents','workflows','mcp','skills','scenes','permissions','data-builder','actions','tenants','users','features','connections','synthetic'];

for (const role of ['admin','planner','base_manager']){
  const page = await ctx.newPage();
  const sink = newSink(); attach(page,sink);
  await login(page, role);
  // theme accent
  const accent = await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  // nav items
  const navItems = await page.locator('[data-testid=left-nav] a').evaluateAll(a=>a.map(x=>x.textContent.replace(/\s+/g,' ').trim()).filter(Boolean));
  const navGroups = await page.locator('[data-testid=left-nav] [data-testid^=nav-group-toggle-]').evaluateAll(el=>el.map(x=>x.textContent.replace(/[▾\s]+/g,' ').trim()));
  console.log(`\n########## ROLE: ${role} ##########`);
  console.log('theme --accent:', JSON.stringify(accent));
  console.log('nav groups:', JSON.stringify(navGroups));
  console.log('nav items ('+navItems.length+'):', JSON.stringify(navItems));
  // admin nav items present? (admin pages appear as /admin/ links)
  const adminLinks = await page.locator('[data-testid=left-nav] a[href^="/admin/"]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
  console.log('admin links:', JSON.stringify(adminLinks));
  // cross-access probes
  console.log('--- cross-access (expect 403 for disallowed) ---');
  for (const p of (role==='admin'?['agents','permissions']:CROSS)){
    await page.goto(BASE+'/admin/'+p,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(700);
    const is403 = await page.locator('[data-testid=page-403]').count();
    const is404 = await page.locator('[data-testid=page-404]').count();
    const hasEditor = await page.locator('[data-testid$=-editor], [data-testid=data-builder-page], table').count();
    const white = (await page.locator('main').innerText()).trim().length < 5;
    let verdict = is403? '403':(is404?'404':(hasEditor>0?'ALLOWED(content)':(white?'WHITE/EMPTY':'other')));
    console.log(`  /admin/${p} -> ${verdict}`);
  }
  // entitlement: non-existent view -> 404
  await page.goto(BASE+'/v/zzz-nonexistent',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(700);
  console.log('  /v/zzz-nonexistent ->', (await page.locator('[data-testid=page-404]').count())?'404':((await page.locator('[data-testid=page-403]').count())?'403':'other'));
  // granted-feature-but-not-in-workspace view (base_manager /v/dash) -> expect 403
  if (role==='base_manager'){
    await page.goto(BASE+'/v/dash',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(700);
    console.log('  /v/dash (base_manager) ->', (await page.locator('[data-testid=page-403]').count())?'403':((await page.locator('[data-testid=page-404]').count())?'404':'RENDERED(!)'));
    await page.goto(BASE+'/v/graph',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(700);
    console.log('  /v/graph (base_manager) ->', (await page.locator('[data-testid=page-403]').count())?'403':((await page.locator('[data-testid=page-404]').count())?'404':'RENDERED(!)'));
  }
  await page.screenshot({path:`${SP}/role_${role}.png`});
  console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,4)));
  console.log('NET4xx:', JSON.stringify([...new Set(sink.net)].slice(0,8)));
  await page.close();
}
await b.close(); console.log('\nDONE');
