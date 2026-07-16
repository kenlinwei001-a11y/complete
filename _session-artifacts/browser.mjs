import pkg from '/home/user/complete/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXEC='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SS='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const browser=await chromium.launch({executablePath:EXEC,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1440,height:1600}});
const page=await ctx.newPage();
const apiHosts=new Set();
page.on('request',r=>{const u=r.url();if(u.includes('/a/v1/')||u.includes('/api/v1/')||u.includes('/b/v1/'))apiHosts.add(new URL(u).host);});
const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
try{
  await page.goto('http://127.0.0.1:5261/',{waitUntil:'networkidle',timeout:30000});
  // login
  await page.fill('#login-username','admin');
  await page.fill('#login-password','demo1234');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log('after login URL:',page.url());
  // navigate to risk board
  await page.goto('http://127.0.0.1:5261/v/risk',{waitUntil:'networkidle',timeout:30000});
  await page.waitForSelector('[data-testid="risk-decision-summary"]',{timeout:25000});
  await page.waitForTimeout(2500);
  // read summary red/yellow
  const red=await page.getAttribute('[data-testid="risk-summary-red"]','data-testid').catch(()=>null);
  const redVal=await page.locator('[data-testid="risk-summary-red"]').innerText().catch(()=>'?');
  const yellowVal=await page.locator('[data-testid="risk-summary-yellow"]').innerText().catch(()=>'?');
  const dm=await page.locator('[data-testid="risk-confidence-datamode"]').innerText().catch(()=>'?');
  console.log('\n=== RISK BOARD SUMMARY (real browser) ===');
  console.log('越线基地(risk-summary-red):',JSON.stringify(redVal));
  console.log('临近基地(risk-summary-yellow):',JSON.stringify(yellowVal));
  console.log('top dataMode badge:',JSON.stringify(dm));
  // count red-colored cards: look at card tightness colors. Count elements with danger color.
  const bodyText=await page.locator('body').innerText();
  const hasBase=['信阳','厦门','合肥','常州','成都','枣庄','武汉','江门'].filter(b=>bodyText.includes(b));
  console.log('base names visible on board:',hasBase.join(','));
  await page.screenshot({path:SS+'/riskboard.png',fullPage:true});
  console.log('screenshot saved. API hosts hit:',[...apiHosts].join(','));
  if(errs.length)console.log('console errors:',errs.slice(0,5).join(' | '));
}catch(e){console.log('BROWSER ERROR:',e.message.slice(0,300));await page.screenshot({path:SS+'/riskboard_err.png',fullPage:true}).catch(()=>{});}
await browser.close();
