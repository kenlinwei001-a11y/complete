/* eslint-disable */
/** WO-LOSS-ATTRIB-MONEY · 侦察：登录后**真实可见**的入口有哪些，怎么点到损失归因。 */
import { launch, login, shot, attachNetLog, sleep } from "./lib.mjs";

const out = {};
const { browser, page } = await launch();
const net = attachNetLog(page);
try {
  out.landed = await login(page);
  await sleep(2000);
  // 真实打到的后端（我的端口是 4021/4022，lib 里的 assertNoMock 只认 4001/4002 —— 那是它的常量过期，不是没打后端）
  out.realBackendHits = net
    .filter((e) => /127\.0\.0\.1:(4021|4022)/.test(e.url) && e.status >= 200 && e.status < 400)
    .slice(0, 6)
    .map((e) => `${e.status} ${e.method} ${e.url}`);
  out.mockHits = net.filter((e) => /127\.0\.0\.1:(4001|4002)/.test(e.url)).length;

  out.homeEntries = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      links: Array.from(document.querySelectorAll("a")).filter(vis).map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim().replace(/\n+/g, " ") })).filter((x) => x.text),
      buttons: Array.from(document.querySelectorAll('button, [role="tab"]')).filter(vis).map((b) => b.innerText.trim().replace(/\n+/g, " ")).filter(Boolean),
    };
  });
  out.shot1 = await shot(page, "R1-home");

  // 找一切含「推演/沙盘/归因」的入口
  const simLink = out.homeEntries.links.find((l) => /推演|沙盘/.test(l.text));
  out.simLink = simLink ?? null;
  if (simLink) {
    await page.click(`a[href="${simLink.href}"]`);
    await sleep(3000);
    out.afterSim = { url: page.url() };
    out.simPage = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        tabs: Array.from(document.querySelectorAll('button, [role="tab"], a')).filter(vis).map((b) => ({ tag: b.tagName, href: b.getAttribute?.("href") ?? null, text: b.innerText.trim().replace(/\n+/g, " ") })).filter((x) => x.text).slice(0, 60),
        testids: Array.from(document.querySelectorAll("[data-testid]")).filter(vis).map((e) => e.dataset.testid).slice(0, 60),
      };
    });
    out.shot2 = await shot(page, "R2-sim");
  }
} catch (e) {
  out.FATAL = String(e && e.stack ? e.stack : e);
} finally { await browser.close(); }
console.log(JSON.stringify(out, null, 2));
