import { launch, login, watch, newSink, goto, DC } from './lib.mjs';
const tok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);
async function putFeat(overrides) {
  const r = await fetch(DC + '/a/v1/tenants/demo/features', { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }) });
  return { status: r.status, body: await r.text() };
}

const browser = await launch();

// ---- capture full 404 URLs on admin home ----
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const all404 = [];
  page.on('response', r => { if (r.status()===404) all404.push(r.url()); });
  page.on('requestfailed', r => all404.push('FAILED:'+r.url()));
  await login(page, 'admin');
  await page.waitForTimeout(1500);
  await goto(page, '/admin/agents'); await page.waitForTimeout(500);
  console.log('===== 404 / failed resources (admin) =====');
  console.log(JSON.stringify([...new Set(all404)], null, 1));
  await ctx.close();
}

// ---- entitlement: toggle data-builder OFF ----
console.log('\n===== ENTITLEMENT: data-builder feature OFF → 404 =====');
const off = await putFeat({ 'data-builder': false });
console.log('PUT data-builder=false →', off.status, off.body.slice(0,80));
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sink = newSink(); watch(page, sink);
  await login(page, 'admin');
  await page.waitForTimeout(1000);
  const navHas = await page.evaluate(() => [...document.querySelectorAll('[data-testid=left-nav] a')].some(a=>a.getAttribute('href')==='/admin/data-builder'));
  console.log('nav shows data-builder (should be FALSE):', navHas);
  await goto(page, '/admin/data-builder');
  await page.waitForTimeout(600);
  const guard = await page.evaluate(() => ({ p404: !!document.querySelector('[data-testid=page-404]'), p403: !!document.querySelector('[data-testid=page-403]'), body: document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,120) }));
  console.log('  /admin/data-builder →', guard.p404 ? '404 FEATURE_NOT_FOUND ✓' : guard.p403 ? '403' : 'OTHER', '|', guard.body);
  await ctx.close();
}
// ---- revert ----
const on = await putFeat({ 'data-builder': true });
console.log('PUT data-builder=true (revert) →', on.status);
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'admin');
  await page.waitForTimeout(1000);
  const navHas = await page.evaluate(() => [...document.querySelectorAll('[data-testid=left-nav] a')].some(a=>a.getAttribute('href')==='/admin/data-builder'));
  console.log('after revert, nav shows data-builder (should be TRUE):', navHas);
  await ctx.close();
}

await browser.close();
console.log('\nDONE');
