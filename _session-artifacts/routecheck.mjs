import { withLogin } from '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/pwlib.mjs';
await withLogin({username:'admin'}, async (page)=>{
  await page.goto('http://127.0.0.1:5296/decisions',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);
  console.log('URL after goto /decisions:', page.url());
  const t=(await page.locator('body').innerText()).slice(0,300);
  console.log('BODY:', t.replace(/\n+/g,' | '));
});
