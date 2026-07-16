import { launch, login } from './pw.mjs';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const { browser, page, logs } = await launch();
await login(page);
await page.waitForTimeout(1200);
// SPA nav to DataBuilder engine (数据构建发动机)
await page.locator('text=数据构建发动机').first().click();
await page.waitForTimeout(2500);
console.log('url:', page.url());
// find a story textarea and enter a requirement
const story = '5万套电芯订单提前15天交付能否满足？挤占哪些在产项目？影响哪些客户与利润损失？';
const ta = page.locator('textarea').first();
let entered = false;
if (await ta.count()) { await ta.click(); await ta.fill(story); entered = true; }
console.log('story entered:', entered, '| textareas:', await page.locator('textarea').count());
// click a preview/comprehend/generate button
const btns = await page.locator('button').allInnerTexts();
console.log('buttons:', btns.slice(0,25).join(' | '));
const trigger = page.locator('button:has-text("预览"), button:has-text("解析"), button:has-text("生成"), button:has-text("构建"), button:has-text("推演"), button:has-text("运行")').first();
if (await trigger.count()) { await trigger.click(); console.log('clicked trigger'); }
// wait for plan/object types to appear
for (let i=0;i<20;i++){ await page.waitForTimeout(1000); const t=await page.locator('body').innerText().catch(()=> ''); if(/对象类型|订单|Order|Customer|工序|comprehend|BuildPlan|清单|manifest/i.test(t)) break; }
await page.screenshot({ path: `${SHOT}/ch20_databuilder.png`, fullPage: true });
const body = await page.locator('body').innerText().catch(()=> '');
console.log('--- PAGE TEXT (900) ---\n', body.slice(0, 900));
await browser.close();
