/**
 * 临时探针（仅 vitest.leak.config.ts 使用，正式套件不加载）：把每条用例结束后的残留句柄
 * 打成一行 `LEAK <file:line>`，用来**枚举**泄漏源，而不是判红。定位阶段用完即可删。
 */
import { afterEach } from "vitest";
import { harvestLeakedTimers } from "./leakGuard";

afterEach((ctx) => {
  const leaked = harvestLeakedTimers();
  for (const l of leaked) console.error(`LEAK [${ctx.task.file?.name ?? "?"}] ${l}`);
});
