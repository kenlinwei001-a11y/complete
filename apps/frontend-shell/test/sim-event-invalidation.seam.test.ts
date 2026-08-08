import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { queryClient } from "@/store/queryClient";
import {
  EVENT_INVALIDATES,
  SIM_CONSUMER_KEYS,
  SIM_EVENT_GAPS,
  invalidateForEvent,
} from "@/store/eventInvalidation";

/**
 * A10 接缝门 · `sim.*` 领域事件 → 前端缓存失效（本体断点 G-SIM-EVENT-NOSUB）。
 *
 * 这条测试**咬的是链路不是函数**（假绿第 9 形态的对策）：
 *   ① 用真 queryClient（不是 spy）注册真 key → 发事件 → 断言那条 query 真的被标 invalidated；
 *      spy 只能证明"我调了 invalidateQueries"，证明不了**前缀匹配真的命中**——写错一段前缀，spy 全绿。
 *   ② 把断言锚在 **RiskBoardView 源码里真实的 queryKey 字面量**上：视图改 key 而失效表没跟 → 红。
 *      否则这张表只是在自证自己（表里有 → 断言表里有），永远不会红。
 *   ③ 对账 **emit 侧**（datacore app.ts 的 outbox.emit("sim.*")）：每个发出来的事件必须
 *      要么接了线（EVENT_INVALIDATES），要么记在缺口台账（SIM_EVENT_GAPS）。
 *      新增一个 sim.* emit 而两边都没登记 → 红。这是"发了没人收"（#92 那族）复发的门。
 */

const readRepoFile = (relFromTestDir: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTestDir, import.meta.url)), "utf8");

/** datacore emit 侧：抽出所有 `outbox.emit(<tenant>, "sim.xxx"` 的事件名（含重复，用于数出 emit 处数）。 */
function emittedSimEvents(): string[] {
  const src = readRepoFile("../../datacore/src/app.ts");
  expect(src.length, "datacore/src/app.ts 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
  return [...src.matchAll(/outbox\.emit\([^,]+,\s*"(sim\.[a-z_]+)"/g)].map((m) => m[1]);
}

describe("A10 接缝 · sim.* 事件 → 前端查询键真失效", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("① sim.scenario_saved → 方案列表 + 横比矩阵两条真 query 都被标失效（真 queryClient·验前缀匹配）", () => {
    // RiskBoardView 真实注册的两条 query（含 baseId / ids 尾段，前缀失效必须能盖住）。
    const listKey = [...SIM_CONSUMER_KEYS.liveScenarioList, "base-cz"];
    const compareKey = [...SIM_CONSUMER_KEYS.liveScenarioCompare, "base-cz", ["lsc_1", "lsc_2"]];
    queryClient.setQueryData(listKey, { scenarios: [] });
    queryClient.setQueryData(compareKey, { dims: [], rows: [] });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(compareKey)?.isInvalidated).toBe(false);

    invalidateForEvent("sim.scenario_saved");

    expect(
      queryClient.getQueryState(listKey)?.isInvalidated,
      "存方案后方案列表没失效——跨页/跨用户会停在陈旧快照（A10 就是要修这个）",
    ).toBe(true);
    expect(
      queryClient.getQueryState(compareKey)?.isInvalidated,
      "横比矩阵没失效——这条连发起方自己那一页都陈旧（RiskBoardView 的 save 只本地失效了 live-scenarios）",
    ).toBe(true);
  });

  it("② 失效表里的 key 与 RiskBoardView 源码里真实的 queryKey 字面量对得上（防表漂移）", () => {
    const view = readRepoFile("../src/views/RiskBoardView.tsx");
    expect(view.length, "RiskBoardView.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    // 视图侧真实字面量（改了这两行而不改失效表 → 本条红）。
    expect(view).toContain(`queryKey: ["a", "live-scenarios", baseId]`);
    expect(view).toContain(`queryKey: ["a", "live-scenario-compare", baseId,`);
    // 表侧锚点必须与之同源。
    expect(SIM_CONSUMER_KEYS.liveScenarioList).toEqual(["a", "live-scenarios"]);
    expect(SIM_CONSUMER_KEYS.liveScenarioCompare).toEqual(["a", "live-scenario-compare"]);
    // 且这两个前缀确实是 sim.scenario_saved 走的那条标签映射出来的。
    expect(EVENT_INVALIDATES["sim.scenario_saved"]).toContain("sim-scenarios");
  });

  it("③ 事件名拼错一个字母 → 什么都不失效（证明咬的是真事件名，不是任意字符串）", () => {
    const listKey = [...SIM_CONSUMER_KEYS.liveScenarioList, "base-cz"];
    queryClient.setQueryData(listKey, { scenarios: [] });
    invalidateForEvent("sim.scenario_savedd");
    invalidateForEvent("sim.scenarios_saved");
    invalidateForEvent("sim_scenario_saved");
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it("④ emit 侧对账：datacore 发的每个 sim.* 事件，要么接了线要么记在缺口台账（防「发了没人收」复发）", () => {
    const emitted = emittedSimEvents();
    // 自证工具是对的（铁律 0.5 #5）：一个都没抓到 = 正则/路径坏了，不是代码里没 emit。
    expect(emitted.length, "一个 sim.* emit 都没抓到——正则或路径坏了，先修工具").toBeGreaterThan(0);

    const unaccounted = [...new Set(emitted)].filter(
      (e) => !(e in EVENT_INVALIDATES) && !(e in SIM_EVENT_GAPS),
    );
    expect(
      unaccounted,
      `这些 sim.* 事件 datacore 发了但前端既没接线也没登记缺口：${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("⑤ 缺口台账逐条有理由，且不与已接线的事件重叠（诚实报缺≠悄悄漏掉）", () => {
    for (const [event, reason] of Object.entries(SIM_EVENT_GAPS)) {
      expect(reason.length, `${event} 的缺口理由是空的`).toBeGreaterThan(10);
      expect(EVENT_INVALIDATES[event], `${event} 既接了线又记在缺口台账，自相矛盾`).toBeUndefined();
    }
    // 今天的实测基线：6 处 emit / 5 个不同事件名（1 接线 + 4 缺口）。
    // 数变了说明 emit 侧动过 —— 停下来重新判断消费方，别让它悄悄漂过去。
    const emitted = emittedSimEvents();
    expect(emitted.length, "datacore sim.* emit 处数变了，重新核消费方").toBe(6);
    expect(new Set(emitted).size, "datacore sim.* 事件名数变了，重新核消费方").toBe(5);
    expect(Object.keys(SIM_EVENT_GAPS).length).toBe(4);
  });
});
