import { launch, login, watch, newSink, goto, DC } from './lib.mjs';
const tok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);
async function dc(path) { const r = await fetch(DC + path, { headers: { Authorization: 'Bearer ' + tok } }); return { status: r.status, body: await r.json().catch(()=>null) }; }

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');
const shots = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

await goto(page, '/admin/data-builder');
await page.waitForTimeout(700);

// ===== STUDIO TAB (pipeline canvas) =====
console.log('===== STUDIO TAB (本体建模工作流 / pipeline canvas) =====');
const owfBefore = await dc('/a/v1/ontology-workflows');
console.log('ontology-workflows before:', (owfBefore.body?.items??[]).length);
await page.click('[data-testid=db-tab-studio]');
await page.waitForTimeout(900);
const emptyState = await page.evaluate(() => document.body.innerText.includes('暂无本体工作流'));
console.log('studio empty state shown:', emptyState);
// create data-first workflow
const createBtn = await page.evaluate(() => !!document.querySelector('[data-testid=wf-empty-create]') || !!document.querySelector('[data-testid=wf-new-data]'));
await page.evaluate(() => { (document.querySelector('[data-testid=wf-empty-create]')||document.querySelector('[data-testid=wf-new-data]'))?.click(); });
await page.waitForTimeout(1600);
// canvas nodes
const canvasInfo = await page.evaluate(() => {
  const body = document.body.innerText;
  // count node-ish elements: look for pipeline node testids or kind labels
  const nodeEls = document.querySelectorAll('[data-testid^=wf-node], [data-testid^=node-], [class*=node]');
  const actions = Array.from(document.querySelectorAll('[data-testid^=act-]')).map(b=>b.getAttribute('data-testid'));
  const canvasBox = document.querySelector('[data-testid=wf-canvas], [class*=canvas], [class*=Canvas]');
  return { bodyHasSrc: /源|SOURCE|src|实体|ENTITY/i.test(body), nodeCount: nodeEls.length, actions, hasCanvas: !!canvasBox };
});
console.log('canvas after create:', JSON.stringify(canvasInfo));
await page.screenshot({ path: `${shots}/shots_db_studio_canvas.png` });
// persistence check
const owfAfter = await dc('/a/v1/ontology-workflows');
const items = owfAfter.body?.items ?? [];
console.log('ontology-workflows after create:', items.length);
if (items.length) {
  const wf = items[0];
  console.log(`PERSIST: id=${wf.id} name=${wf.name} status=${wf.status} entryMode=${wf.entryMode} nodes=${wf.nodes?.length} edges=${wf.edges?.length}`);
  console.log('  node kinds:', JSON.stringify((wf.nodes||[]).map(n=>n.kind)));
}
// run readiness action
await page.evaluate(() => document.querySelector('[data-testid=act-readiness]')?.click());
await page.waitForTimeout(1800);
const readiness = await page.evaluate(() => {
  const body = document.body.innerText;
  return body.match(/准备度|readiness|就绪|缺[^]{0,60}/i)?.[0]?.replace(/\s+/g,' ') || body.slice(-300).replace(/\s+/g,' ');
});
console.log('readiness result snippet:', readiness?.slice(0,200));
await page.screenshot({ path: `${shots}/shots_db_studio_readiness.png` });

// ===== ENGINE TAB 快速合成 (deterministic, no-LLM, 落库) =====
console.log('\n===== ENGINE TAB 快速合成 (template synth 落库) =====');
await page.click('[data-testid=db-tab-engine]');
await page.waitForTimeout(700);
// connectors count before (datacore)
const connBefore = await dc('/a/v1/connections');
const cbCount = Array.isArray(connBefore.body) ? connBefore.body.length : (connBefore.body?.items?.length ?? '?');
console.log('connections before:', cbCount);
// find 快速合成 button + template/scale selects
const synthUI = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim());
  return { hasSynthBtn: btns.some(b=>b==='快速合成'), btns: btns.filter(b=>/合成|构建|建域|回填/.test(b)) };
});
console.log('engine synth UI:', JSON.stringify(synthUI));

if (sink.http.length) console.log('\nHTTP>=400:', JSON.stringify(sink.http.slice(-10)));
if (sink.pageerrors.length) console.log('PAGEERR:', JSON.stringify(sink.pageerrors.slice(-5)));
await ctx.close(); await browser.close(); console.log('\nDONE');
