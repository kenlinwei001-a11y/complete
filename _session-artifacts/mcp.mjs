import { launch, login, watch, newSink, goto, DC, AC } from './lib.mjs';
const SENTINEL = 'SENTINEL-SECRET-9f3a7b2c';
const tok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);
async function raw(base, path) { const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } }); return { status: r.status, text: await r.text() }; }

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');

console.log('===== B3 MCP credential non-echo =====');
await goto(page, '/admin/mcp');
await page.waitForTimeout(700);
// click 新建
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='新建'); b?.click(); });
await page.waitForTimeout(600);
await page.fill('input[aria-label="MCP 名称"]', 'test-mcp-cred');
await page.fill('input[aria-label="url"]', 'https://example.test/mcp');
await page.fill('input[aria-label="凭据"]', SENTINEL);
// save
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='保存'); b?.click(); });
await page.waitForTimeout(1500);
const savedToast = await page.evaluate(() => document.body.innerText.includes('已保存'));
console.log('save toast:', savedToast);
// reload page, select the new config, check credential badge + placeholder
await goto(page, '/admin/mcp');
await page.waitForTimeout(800);
const listState = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(b=>b.textContent.includes('test-mcp-cred'));
  const hasCredBadge = btns.some(b=>b.innerText.includes('已配凭据'));
  return { found: btns.length>0, hasCredBadge };
});
console.log('list shows config + 已配凭据 badge:', JSON.stringify(listState));
// click it, check password placeholder
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('test-mcp-cred')); b?.click(); });
await page.waitForTimeout(700);
const credField = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="凭据"]');
  return { type: inp?.type, value: inp?.value, placeholder: inp?.placeholder };
});
console.log('credential field:', JSON.stringify(credField));
await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_mcp_cred.png' });

// ===== API-level leak check: sentinel must NOT appear in any response =====
console.log('\n===== SENTINEL leak scan (must be ABSENT) =====');
for (const [base, path] of [[AC,'/b/v1/mcp-configs'],[DC,'/a/v1/mcp-configs'].filter(Boolean)]) {}
const probes = [ [AC,'/b/v1/mcp-configs'] ];
// find the config id from AC
const listResp = await raw(AC, '/b/v1/mcp-configs');
console.log('/b/v1/mcp-configs status:', listResp.status);
const leakInList = listResp.text.includes(SENTINEL);
console.log('  sentinel in list response:', leakInList, '| credentialRef present:', /credentialRef/.test(listResp.text));
let cfgId = null;
try { const arr = JSON.parse(listResp.text); const c = arr.find(x=>x.name==='test-mcp-cred'); cfgId = c?.id; console.log('  cfg:', c? `${c.id} credentialRef=${JSON.stringify(c.credentialRef)} keys=${Object.keys(c)}`:'not found'); } catch(e){}
if (cfgId) {
  const single = await raw(AC, `/b/v1/mcp-configs/${cfgId}`);
  console.log(`  single config leak:`, single.text.includes(SENTINEL), 'status', single.status);
}
// service-token credential fetch (should require SERVICE_TOKEN; user JWT 403) - probe leak surface
if (sink.http.length) console.log('HTTP>=400 (ui):', JSON.stringify(sink.http.slice(-6)));

// ===== DRAFT publish panel check (skill) =====
console.log('\n===== Skill DRAFT publish panel =====');
await goto(page, '/admin/skills');
await page.waitForTimeout(700);
await page.evaluate(() => { const b=document.querySelector('[data-testid=skill-create]'); b?.click(); });
await page.waitForTimeout(1200);
const draftSkill = await page.evaluate(() => {
  const publishBtn = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='发布');
  const saveBtn = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存');
  return { hasPublish: !!publishBtn, publishDisabled: publishBtn?.disabled, hasSave: !!saveBtn };
});
console.log('draft skill publish panel:', JSON.stringify(draftSkill));

await ctx.close(); await browser.close(); console.log('\nDONE');
