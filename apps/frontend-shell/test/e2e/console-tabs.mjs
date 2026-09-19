/* eslint-disable */
/**
 * WO-DRILL-VERDICT-BACKEND · 统一推演控制台页签实测
 *
 * 目的只有一个：**捕获浏览器真正发出的 `chain-loss-matrix` 请求体**，回答
 * 「后端已收 `sessionId`，前端发不发」。只 grep 源码会被读成"接了线"；
 * 这里记的是用户那条路上真发出的字节。⛔ 只观测，不改 `views/sim/` 任何源码（禁令 2）。
 */
import { login, launch, shot, sleep, visibleText } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const OUT = "apps/frontend-shell/test/e2e/console-tabs-output.json";

const run = async () => {
  const { browser, page } = await launch();
  const reqs = [];
  page.on("request", (r) => {
    if (!/\/a\/v1\/sim\//.test(r.url())) return;
    // ⚠ 请求体**截断到 300 字**：`optimize-pareto` 会把整本订单簿塞进 body，
    //   原样落盘产出 1.7MB 的证据文件（实测）。本脚本要证的是「带没带 sessionId」，
    //   而 `sessionId` 恒在 body 开头 —— 截断不影响判据，只砍掉噪声。
    const raw = r.postData();
    reqs.push({
      url: r.url().replace(/^https?:\/\/[^/]+/, ""),
      body: raw === null ? null : raw.length > 300 ? raw.slice(0, 300) + `…(共${raw.length}字)` : raw,
      hasSessionId: (raw ?? "").includes("sessionId"),
    });
  });

  await login(page, { user: "admin" });
  await sleep(1200);

  const link = await page.$('a[href="/v/sim-unified"]');
  if (!link) { console.log("导航里没有 /v/sim-unified"); await browser.close(); return; }
  await link.click({ timeout: 8000 });
  await sleep(5000);
  console.log("落点:", page.url().replace(/^https?:\/\/[^/]+/, ""));

  // 枚举页签（role=tab 或 button），逐个点，记录每个页签触发的 sim 请求。
  const tabs = await page.$$eval('[role="tab"], nav button, .tab, [data-testid*="tab"]', (els) =>
    els.map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter((s) => s && s.length < 20),
  );
  const uniq = [...new Set(tabs)];
  console.log("页签:", uniq.join(" | "));

  const perTab = {};
  for (const t of uniq) {
    const before = reqs.length;
    const el = await page.$(`[role="tab"]:has-text("${t}"), button:has-text("${t}")`);
    if (!el) { perTab[t] = "点不到"; continue; }
    try {
      await el.click({ timeout: 6000 });
      await sleep(4500);
      perTab[t] = reqs.slice(before).map((r) => `${r.url} body=${r.body ?? "(无)"}`);
      console.log(`[${t}]`, JSON.stringify(perTab[t]));
      await shot(page, `ct-${t}`);
    } catch (e) { perTab[t] = "点击失败 " + String(e.message).slice(0, 50); }
  }

  const matrix = reqs.filter((r) => /chain-loss-(matrix|drill)/.test(r.url));
  console.log("\n=== chain-loss 请求汇总 ===");
  console.log("总条数:", matrix.length, "带 sessionId:", matrix.filter((r) => (r.body ?? "").includes("sessionId")).length);
  for (const m of matrix.slice(0, 6)) console.log("  ", m.url, "body=", m.body);
  // 金丝雀：证明这个抓法真的抓得到东西（sim 类请求总数应 > 0）。
  console.log("金丝雀（sim/* 请求总数，>0 才说明抓法是好的）:", reqs.length);

  const text = await visibleText(page);
  writeFileSync(OUT, JSON.stringify({ tabs: uniq, perTab, allSimRequests: reqs, chainLoss: matrix, screenLen: text.length }, null, 2));
  console.log("报告已写:", OUT);
  await browser.close();
};
run().catch((e) => { console.error("FAILED", e); process.exit(1); });
