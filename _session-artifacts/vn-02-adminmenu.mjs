import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page } = await launch();
try {
  await login(page, "admin");
  await goView(page, "dash");
  // click the admin dropdown (top-right "admin ▾")
  const adminBtn = page.locator("text=/admin/").last();
  await adminBtn.click({ timeout: 5000 }).catch(() => console.log("admin click failed"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/vn-02-adminmenu.png` });
  // scan whole DOM again for theme toggle after menu open
  const scan = await page.evaluate(() => {
    const out = [];
    const all = Array.from(document.querySelectorAll("button, a, [role=button], [role=menuitem], li"));
    for (const b of all) {
      const blob = `${(b.textContent||"").trim()} ${b.getAttribute("aria-label")||""} ${b.getAttribute("title")||""} ${b.getAttribute("data-testid")||""}`;
      if (/主题|浅色|深色|暗色|黑曜|obsidian|明亮|theme|配色|色彩|☀|🌙/i.test(blob)) out.push(blob.trim().slice(0,60));
    }
    return out;
  });
  console.log("THEME CONTROLS AFTER ADMIN MENU:", JSON.stringify(scan));
  // dump menu items text
  const menuText = await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll("[role=menu], [class*=menu], [class*=dropdown], ul"));
    return menus.map(m => (m.textContent||"").trim().slice(0,150)).filter(Boolean).slice(0,8);
  });
  console.log("MENU/DROPDOWN TEXTS:", JSON.stringify(menuText, null, 1));
} catch (e) {
  console.log("ERR:", e.message);
} finally {
  await browser.close();
}
