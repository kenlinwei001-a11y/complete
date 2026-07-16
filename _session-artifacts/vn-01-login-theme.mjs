import { launch, login, goView, SHOTS } from "./vn-lib.mjs";

const { browser, page, errs } = await launch();
try {
  await login(page, "admin");
  console.log("URL after login:", page.url());
  await goView(page, "dash");
  await page.screenshot({ path: `${SHOTS}/vn-01-dash.png`, fullPage: false });

  // 轨O: inspect documentElement theme state
  const themeState = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      dataTheme: de.getAttribute("data-theme"),
      className: de.className,
      dataThemeKeys: de.dataset.themeKeys || null,
      // any inline color-scheme?
      colorScheme: getComputedStyle(de).colorScheme,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log("THEME STATE:", JSON.stringify(themeState));

  // 轨O: scan header/topbar for any theme toggle control
  const headerScan = await page.evaluate(() => {
    const texts = [];
    // gather all buttons and clickable controls text
    const btns = Array.from(document.querySelectorAll("button, [role=button], a"));
    for (const b of btns) {
      const t = (b.textContent || "").trim();
      const aria = b.getAttribute("aria-label") || "";
      const title = b.getAttribute("title") || "";
      const tid = b.getAttribute("data-testid") || "";
      const blob = `${t} ${aria} ${title} ${tid}`;
      if (/主题|浅色|深色|暗色|黑曜|obsidian|light|dark|theme|配色|☀|🌙|色彩/i.test(blob)) {
        texts.push({ text: t.slice(0, 40), aria, title, tid });
      }
    }
    return texts;
  });
  console.log("HEADER THEME CONTROLS:", JSON.stringify(headerScan));

  // Capture header region text for manual inspection
  const headerText = await page.evaluate(() => {
    const h = document.querySelector("header") || document.querySelector("[class*=header]") || document.querySelector("[class*=topbar]");
    return h ? h.textContent.trim().slice(0, 300) : "NO HEADER FOUND";
  });
  console.log("HEADER TEXT:", headerText);

  console.log("CONSOLE ERRORS:", errs.slice(0, 10));
} catch (e) {
  console.log("SCRIPT ERROR:", e.message);
} finally {
  await browser.close();
}
