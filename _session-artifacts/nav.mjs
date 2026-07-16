import { launch, login, watch, newSink, BASE } from './lib.mjs';

const browser = await launch();
for (const role of ['admin', 'planner', 'base_manager']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sink = newSink();
  watch(page, sink);
  try {
    await login(page, role);
    await page.waitForTimeout(800);
    // capture nav
    const nav = await page.evaluate(() => {
      const aside = document.querySelector('[data-testid=left-nav]');
      if (!aside) return { items: [], groups: [] };
      const items = Array.from(aside.querySelectorAll('a')).map((a) => ({ label: (a.textContent || '').trim(), href: a.getAttribute('href') }));
      const groups = Array.from(aside.querySelectorAll('[data-testid^=nav-group-toggle-]')).map((b) => (b.textContent || '').trim());
      return { items, groups };
    });
    const tenant = await page.evaluate(() => document.querySelector('[data-testid=tenant-name]')?.textContent?.trim());
    const user = await page.evaluate(() => document.querySelector('[data-testid=user-menu-btn]')?.textContent?.trim());
    // theme: read a couple CSS vars
    const theme = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        bg: cs.getPropertyValue('--color-bg')?.trim() || cs.getPropertyValue('--bg')?.trim(),
        accent: cs.getPropertyValue('--color-accent')?.trim() || cs.getPropertyValue('--accent')?.trim(),
        primary: cs.getPropertyValue('--color-primary')?.trim(),
      };
    });
    console.log(`\n========== ROLE: ${role} ==========`);
    console.log('tenant:', tenant, '| user:', user);
    console.log('theme:', JSON.stringify(theme));
    console.log('groups:', JSON.stringify(nav.groups));
    console.log('nav items (' + nav.items.length + '):');
    for (const it of nav.items) console.log('   ', JSON.stringify(it));
    if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http));
    if (sink.pageerrors.length) console.log('PAGEERR:', JSON.stringify(sink.pageerrors));
    if (sink.console.length) console.log('CONSOLE:', JSON.stringify(sink.console.slice(0, 5)));
  } catch (e) {
    console.log(`ROLE ${role} FAILED:`, String(e).slice(0, 300));
    console.log('sink http:', JSON.stringify(sink.http));
  }
  await ctx.close();
}
await browser.close();
console.log('\nDONE');
