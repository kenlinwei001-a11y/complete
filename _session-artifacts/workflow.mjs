import { launch, login, watch, newSink, goto, DC, AC } from './lib.mjs';

async function api(path, tok) {
  const r = await fetch(AC + path, { headers: { Authorization: 'Bearer ' + tok } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');
// grab token from the page (tokenStore in memory) via localStorage or a fresh login
const tok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);

// baseline count of workflows
const before = await api('/b/v1/workflows', tok);
const beforeCount = Array.isArray(before.body) ? before.body.length : (before.body?.items?.length ?? '?');
console.log('workflows before:', beforeCount);

await goto(page, '/admin/workflows');
await page.waitForTimeout(700);

// create new workflow
await page.click('[data-testid=workflow-create]');
await page.waitForTimeout(1500);
// editor should now show DRAFT
const editorInfo = await page.evaluate(() => {
  const ed = document.querySelector('[data-testid=workflow-editor]');
  if (!ed) return null;
  const header = ed.querySelector('strong')?.textContent;
  const meta = ed.querySelector('.mono')?.textContent;
  const stepRows = ed.querySelectorAll('[data-testid^=step-], .stepRow').length;
  const addStepVisible = !!ed.querySelector('[data-testid=wf-add-step]');
  const saveVisible = Array.from(ed.querySelectorAll('button')).some(b => b.textContent.includes('保存'));
  return { header, meta, addStepVisible, saveVisible };
});
console.log('editor after create:', JSON.stringify(editorInfo));
await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_wf_1_draft.png' });

// count steps currently by counting step type selects or rows in the editor. Use API to find the new wf id.
const after = await api('/b/v1/workflows', tok);
const afterList = Array.isArray(after.body) ? after.body : (after.body?.items ?? []);
console.log('workflows after create:', afterList.length);
const draft = afterList.find(w => w.status === 'DRAFT');
console.log('DRAFT wf:', draft ? `${draft.id} name=${draft.name} steps=${draft.steps?.length} status=${draft.status}` : 'NONE');
const draftStepsBefore = draft?.steps?.length ?? 0;

// add a step: select evaluate_rules then click add
await page.selectOption('select[aria-label="步骤类型"]', 'evaluate_rules').catch(e=>console.log('select step type err', String(e).slice(0,100)));
await page.click('[data-testid=wf-add-step]');
await page.waitForTimeout(500);
// save
await page.evaluate(() => { const b=[...document.querySelectorAll('[data-testid=workflow-editor] button')].find(x=>x.textContent.trim()==='保存'); b?.click(); });
await page.waitForTimeout(1500);
const saveToast = await page.evaluate(() => document.body.innerText.includes('已保存'));
console.log('save toast 已保存 present:', saveToast);

// verify persistence via API
const check = await api('/b/v1/workflows', tok);
const checkList = Array.isArray(check.body) ? check.body : (check.body?.items ?? []);
const draft2 = checkList.find(w => w.id === draft?.id);
console.log(`PERSIST CHECK: steps before=${draftStepsBefore} after save=${draft2?.steps?.length} (expect +1); last step type=${draft2?.steps?.[draft2.steps.length-1]?.type}`);

// dry run
await page.evaluate(() => { const b=document.querySelector('[data-testid=wf-dry-run]'); b?.click(); });
await page.waitForTimeout(2500);
const dryRun = await page.evaluate(() => {
  const body = document.body.innerText;
  return { hasResult: /试运行(完成|失败)/.test(body), snippet: body.match(/试运行[^]{0,120}/)?.[0]?.replace(/\s+/g,' ') };
});
console.log('DRY RUN:', JSON.stringify(dryRun));
await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_wf_2_afteredit.png' });

if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http.slice(-8)));
if (sink.pageerrors.length) console.log('PAGEERR:', JSON.stringify(sink.pageerrors.slice(-4)));
await ctx.close(); await browser.close(); console.log('DONE');
