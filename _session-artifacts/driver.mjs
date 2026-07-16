import { chromium } from 'playwright-core';
export const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const BASE='http://127.0.0.1:5285';
export const SP='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

export async function makeCtx() {
  const b = await chromium.launch({ executablePath: EXE, headless: true, args:['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:1500,height:950} });
  return { b, ctx };
}

export function attach(page, sink) {
  page.on('console', m => { if (m.type()==='error') sink.console.push(m.text().slice(0,240)); });
  page.on('pageerror', e => sink.pageerr.push(String(e).slice(0,240)));
  page.on('response', async r => {
    const u = r.url();
    if (/\/(a|b|api)\/v1\//.test(u)) {
      const st = r.status();
      if (st>=400) sink.net.push(`${st} ${r.request().method()} ${u.replace(BASE,'').replace('http://127.0.0.1:4085','[DC]').replace('http://127.0.0.1:4185','[AC]')}`);
      sink.all.push(`${st} ${r.request().method()} ${u.replace('http://127.0.0.1:4085','[DC]').replace('http://127.0.0.1:4185','[AC]')}`);
    }
  });
}

export async function login(page, username) {
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('#login-username',{timeout:15000});
  await page.fill('#login-tenant','demo');
  await page.fill('#login-username',username);
  await page.fill('#login-password','demo1234');
  await Promise.all([
    page.waitForNavigation({timeout:15000}).catch(()=>{}),
    page.click('button[type=submit]')
  ]);
  await page.waitForTimeout(1500);
  return page.url();
}

export function newSink(){ return { console:[], pageerr:[], net:[], all:[] }; }
export function dumpSink(s){
  return { console:[...new Set(s.console)], pageerr:[...new Set(s.pageerr)], net4xx:[...new Set(s.net)] };
}
