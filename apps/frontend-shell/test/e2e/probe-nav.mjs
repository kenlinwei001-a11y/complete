/* eslint-disable */
// 一次性探针：点分组头前后，量「/admin/connections」这条链接的可见性到底怎么变。
import { launch, login, sleep } from "./lib.mjs";
const { browser, page } = await launch();
await login(page);

const measure = () =>
  page.evaluate(() => {
    const a = document.querySelector('a[href="/admin/connections"]');
    if (!a) return { present: false };
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    // 找出祖先里第一个把它压扁/裁掉的节点
    let culprit = null;
    let p = a.parentElement;
    for (let i = 0; i < 6 && p; i++) {
      const pr = p.getBoundingClientRect();
      const pcs = getComputedStyle(p);
      if (pr.height === 0 || pcs.display === "none" || pcs.visibility === "hidden" || pcs.maxHeight === "0px") {
        culprit = { tag: p.tagName, cls: String(p.className).slice(0, 50), h: Math.round(pr.height), display: pcs.display, vis: pcs.visibility, maxH: pcs.maxHeight, overflow: pcs.overflow };
        break;
      }
      p = p.parentElement;
    }
    return {
      present: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      culprit,
      headerAria: document.querySelector("button._navGroupHeader_pjf11_144")?.getAttribute("aria-expanded") ?? null,
    };
  });

console.log("=== 点击前 ===");
console.log(JSON.stringify(await measure(), null, 2));

const btn = await page.$('button:has-text("数据接入")');
console.log("分组头按钮找到:", btn !== null);
await btn.click();
await sleep(600);

console.log("=== 点击分组头之后 ===");
console.log(JSON.stringify(await measure(), null, 2));

await browser.close();
