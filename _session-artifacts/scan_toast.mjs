import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
await login(page,'admin');
await page.goto(BASE+'/admin/skills',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
await page.locator('[data-testid=skill-create]').click(); await page.waitForTimeout(1500);
await page.locator('button:has-text("发布")').first().click(); await page.waitForTimeout(1800);
// look for toast / error text
const bodyText = (await page.locator('body').innerText()).replace(/\s+/g,' ');
const hasLintMsg = bodyText.includes('lint') || bodyText.includes('SKILL_LINT') || bodyText.includes('未通过');
console.log('lint error surfaced in UI:', hasLintMsg);
console.log('toast/error snippet:', (bodyText.match(/[^ ]*lint[^ ]*|SKILL_LINT[\s\S]{0,80}|技能结构[\s\S]{0,80}/)||['(none visible)'])[0].slice(0,140));
// skill still DRAFT (not falsely PUBLISHED)?
const sel = (await page.locator('main').innerText()).match(/新技能（模板预填）[\s\S]{0,30}?(DRAFT|PUBLISHED)/);
console.log('new skill status after failed publish:', sel?sel[1]:'?');
await page.screenshot({path:`${SP}/skill_lint_toast.png`});
await b.close(); console.log('DONE');
