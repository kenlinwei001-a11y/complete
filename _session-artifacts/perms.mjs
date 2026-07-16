import { launch, login, watch, newSink, goto } from './lib.mjs';

const GATED = ['/admin/agents','/admin/workflows','/admin/mcp','/admin/skills','/admin/scenes','/admin/data-builder','/admin/actions','/admin/users','/admin/features','/admin/tenants'];

const browser = await launch();

async function permSweep(role) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const sink = newSink(); watch(page, sink);
  await login(page, role);
  console.log(`\n===== PERMISSION SWEEP: ${role} =====`);
  for (const path of GATED) {
    await goto(page, path);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const has = (t) => !!document.querySelector(`[data-testid=${t}]`);
      const main = document.querySelector('main');
      return {
        p403: has('page-403'), p404: has('page-404'),
        url: location.pathname,
        mainLen: (main?.innerText||'').trim().length,
        crash: (document.body.innerText||'').includes('页面出错') || (document.body.innerText||'').includes('Something went wrong'),
      };
    });
    const verdict = r.p403 ? '403 Forbidden' : r.p404 ? '404 NotFound' : r.crash ? 'CRASH' : (r.url!==path ? `redirect→${r.url}` : `RENDERED(len=${r.mainLen})`);
    console.log(`  ${path} → ${verdict}`);
  }
  await ctx.close();
}

await permSweep('planner');
await permSweep('base_manager');

// ===== Agent B1 detail (admin) =====
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const sink = newSink(); watch(page, sink);
  await login(page, 'admin');
  console.log('\n===== B1 Agent detail (admin) =====');
  await goto(page, '/admin/agents');
  await page.waitForTimeout(700);
  // click 2nd agent card (first non-create button in the left list)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /PUBLISHED|DRAFT/.test(b.textContent));
    btns[0]?.click();
  });
  await page.waitForTimeout(900);
  const ed = await page.evaluate(() => {
    const e = document.querySelector('[data-testid=agent-editor]');
    if (!e) return { present: false };
    return { present: true, len: e.innerText.length, text: e.innerText.replace(/\s+/g,' ').slice(0,500),
      hasPublish: !!e.querySelector('[data-testid=agent-publish]'),
      fields: [...e.querySelectorAll('input,textarea,select')].length };
  });
  console.log('agent-editor:', JSON.stringify(ed));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_agent_detail.png' });
  if (sink.http.length) console.log('  HTTP>=400:', JSON.stringify(sink.http.slice(-5)));

  // ===== Skill B4 detail =====
  console.log('\n===== B4 Skill detail (admin) =====');
  await goto(page, '/admin/skills');
  await page.waitForTimeout(700);
  await page.evaluate(() => { const b=[...document.querySelectorAll('button')].filter(x=>/方法论|PUBLISHED/.test(x.textContent)); b[0]?.click(); });
  await page.waitForTimeout(900);
  const sk = await page.evaluate(() => {
    const meth = document.querySelector('[data-testid=skill-methodology]');
    const ruleRefs = document.querySelector('[data-testid=skill-rule-refs]');
    const mcpRefs = document.querySelector('[data-testid=skill-mcp-refs]');
    const publishBtn = [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='发布');
    return { hasMethodology: !!meth, hasRuleRefs: !!ruleRefs, hasMcpRefs: !!mcpRefs, hasPublish: publishBtn,
      methText: meth?.innerText.replace(/\s+/g,' ').slice(0,300) };
  });
  console.log('skill detail:', JSON.stringify(sk));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_skill_detail.png' });
  if (sink.http.length) console.log('  HTTP>=400:', JSON.stringify(sink.http.slice(-5)));
  await ctx.close();
}

await browser.close();
console.log('\nDONE');
