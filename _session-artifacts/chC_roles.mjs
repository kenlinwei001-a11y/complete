import { withLogin, BASE } from './pwlib.mjs';

const SCR = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

async function grabNav(page) {
  // collect visible nav/link text from the fixed nav
  return await page.evaluate(() => {
    const texts = new Set();
    // common nav containers
    const sels = ['nav a', 'aside a', '[role=navigation] a', 'nav button', 'aside button'];
    for (const s of sels) for (const el of document.querySelectorAll(s)) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 30) texts.add(t);
    }
    return Array.from(texts);
  });
}

const roles = [
  { username: 'admin', password: 'demo1234', tenant: 'demo' },
  { username: 'planner', password: 'demo1234', tenant: 'demo' },
  { username: 'base_manager', password: 'demo1234', tenant: 'demo' },
];

for (const r of roles) {
  await withLogin(r, async (page, ctx, logs) => {
    await page.waitForTimeout(1200);
    const url = page.url();
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const nav = await grabNav(page);
    const shot = `${SCR}/chC_role_${r.username}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    // also capture the greeting / username shown
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log(`\n===== ROLE ${r.username} =====`);
    console.log('url:', url);
    console.log('accent(css --accent):', accent);
    console.log('nav count:', nav.length);
    console.log('nav:', JSON.stringify(nav));
    console.log('screenshot:', shot);
    console.log('bodyTextHead:', bodyText.replace(/\n+/g, ' | ').slice(0, 400));
    if (logs.length) console.log('pageerrors:', logs.filter(l=>l.includes('pageerror')).slice(0,3));
  });
}
console.log('\nDONE');
