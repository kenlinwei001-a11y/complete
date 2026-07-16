import { withLogin } from './pwlib.mjs';
await withLogin({ username:'admin' }, async (page, ctx, logs) => {
  const url = page.url();
  const title = await page.title();
  // capture visible nav / headings
  const bodyText = (await page.locator('body').innerText()).slice(0, 800);
  await page.screenshot({ path: 'smoke_admin.png', fullPage: false });
  console.log('URL:', url);
  console.log('TITLE:', title);
  console.log('--- BODY TEXT (first 800) ---');
  console.log(bodyText);
  console.log('--- console logs (last 8) ---');
  console.log(logs.slice(-8).join('\n'));
});
