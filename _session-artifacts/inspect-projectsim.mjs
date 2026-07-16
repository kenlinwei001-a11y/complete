import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5262';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport:{width:1600,height:1400} })).newPage();
const netlog=[];
page.on('response', r => { const u=r.url(); if(/\/a\/v1\/|\/b\/v1\/|\/api\/v1\//.test(u)) netlog.push(r.status()+' '+r.request().method()+' '+u.replace(BASE,'')); });
await page.goto(BASE+'/', {waitUntil:'networkidle'});
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForTimeout(2500);
netlog.length=0;
await page.goto(BASE+'/v/project-sim',{waitUntil:'networkidle'});
await page.waitForTimeout(4000);
console.log('URL:', page.url());
console.log('=== network (datacore/agentcore) ===');
netlog.forEach(l=>console.log('  '+l));
// dump testids present
const tids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid]')).map(e=>e.getAttribute('data-testid')).slice(0,80));
console.log('=== data-testids on page ===');
console.log(JSON.stringify(tids));
// any run-sim / pm- prefixed
const pm = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^=pm-]')).map(e=>e.getAttribute('data-testid')));
console.log('pm- testids:', JSON.stringify(pm));
// visible text sample
const bodyText = await page.locator('body').innerText();
console.log('=== body text (first 1500 chars) ===');
console.log(bodyText.slice(0,1500));
await page.screenshot({ path: SHOT+'/projectsim-page.png', fullPage:true });
await browser.close();
console.log('DONE');
