// 探路：登录后逐个点进 7 项对应的视图，dump 屏上文本 + 截图。不交互，只看有什么。
import { boot, login, navByText, dump, shot, save, rec, counters, netPorts } from "./lib.mjs";

const TARGETS = [
  ["接单组合优选", "p1-global-sim"],
  ["方案寻优", "p1-sim-optimize"],
  ["产能推演", "p3-risk"],
  ["本体关系", "p4-ontology-relations"],
  ["推演沙盘", "p5-sim-sandbox"],
  ["统一推演控制台", "p5-sim-unified"],
  ["订单台账", "p6-order"],
  ["隔离区", "p7-quarantine"],
];

const { browser, page } = await boot();
try {
  await login(page);
  await dump(page, "p0-home");
  for (const [text, tag] of TARGETS) {
    rec("SECTION", `=== ${tag} (${text}) ===`);
    const ok = await navByText(page, text);
    if (!ok) continue;
    await page.waitForTimeout(2500);
    await dump(page, tag);
    await shot(page, tag);
    rec("URL", page.url());
  }
} catch (e) {
  rec("FATAL", String(e).slice(0, 600));
}
save("probe-log.json");
console.log("\nCOUNTERS", JSON.stringify(counters));
console.log("PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
