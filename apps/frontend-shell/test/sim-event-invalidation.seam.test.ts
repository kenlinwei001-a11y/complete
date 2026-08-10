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
  return [...src.matchAll(/outbox\.emit\([^,]+,\s*"(sim\.[a-z_]+)"/g)].map((m) => m[1]!);
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
    // 今天的实测基线：7 处 emit / 6 个不同事件名 ⇒ **5 接线 + 1 缺口**。
    // 数变了说明 emit 侧动过 —— 停下来重新判断消费方，别让它悄悄漂过去。
    // 变更史：
    //   6/5/4 → 7/6/5（WO-P0 · 2026-08-09 新增 `sim.perturbation_created` emit，按本门要求
    //                  先登记进 SIM_EVENT_GAPS 并写清"为什么今天不接线"）；
    //   7/6/5 → 7/6/5，但**缺口 2 → 1**（WO-SIM-PERTURB-TIMELINE · 2026-08-10：
    //                  扰动清单读端真进了 TanStack Query（PerturbationTimeline 的 listQuery），
    //                  前任写死的出台账条件达成 ⇒ `sim.perturbation_created` 转真接线。
    //                  **emit 处数与事件名数都没动** —— 本单一行 emit 都没加，只补消费方）。
    const emitted = emittedSimEvents();
    expect(emitted.length, "datacore sim.* emit 处数变了，重新核消费方").toBe(7);
    expect(new Set(emitted).size, "datacore sim.* 事件名数变了，重新核消费方").toBe(6);
    expect(Object.keys(SIM_EVENT_GAPS).length).toBe(1);
    // 唯一剩下的缺口是 checkpoint（成因是**后端没开列表路由**，不是前端没接）——写死它，
    // 免得哪天有人把别的事件悄悄塞回台账当挡箭牌。
    expect(Object.keys(SIM_EVENT_GAPS).sort()).toEqual(["sim.checkpoint_saved"]);
  });

  /**
   * ══ WO-L4B（欠账 #145）· 补订阅方：三条此前"发了没人收"的事件 ══
   *
   * 这几条咬的是**副作用**不是"订阅函数被调过"：注册真 key → 发事件 → 断言那条 query 真被标脏。
   * 反证（③ 同款）：事件名拼错一个字母 → 什么都不该失效。
   */
  it("⑥ sim.branched → 世界列表 query 真失效（修「分叉子世界刷新即丢」）", () => {
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(listKey, { items: [] });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);

    invalidateForEvent("sim.branched");

    expect(
      queryClient.getQueryState(listKey)?.isInvalidated,
      "分支后世界列表没失效——子世界只活在 SandboxView 的 useState(branchId) 里，刷新即丢（本单要修的就是这个）",
    ).toBe(true);
  });

  it("⑦ sim.tick_completed → 世界态 + 世界列表两条 query 都真失效（前缀失效要盖住尾带 sessionId 的真 key）", () => {
    // 真 key 尾带 sessionId（SandboxView 的 worldQuery），前缀失效必须能盖住。
    const worldKey = [...SIM_CONSUMER_KEYS.simWorld, "sims_abc"];
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(worldKey, { tick: 3, state: {} });
    queryClient.setQueryData(listKey, { items: [] });

    invalidateForEvent("sim.tick_completed");

    expect(
      queryClient.getQueryState(worldKey)?.isInvalidated,
      "tick 后当前世界态没失效——别的标签页会一直停在旧 tick",
    ).toBe(true);
    expect(
      queryClient.getQueryState(listKey)?.isInvalidated,
      "tick 后世界列表没失效——datacore app.ts:1465 在 emit 前写了 status=RUNNING + curTick，列表显示的正是这两个字段",
    ).toBe(true);
  });

  it("⑧ sim.session_created → 世界列表真失效", () => {
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(listKey, { items: [] });
    invalidateForEvent("sim.session_created");
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("⑨ 反证：三条新接线的事件名各拼错一个字母 → 什么都不失效（证咬的是真事件名）", () => {
    const worldKey = [...SIM_CONSUMER_KEYS.simWorld, "sims_abc"];
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(worldKey, { tick: 0, state: {} });
    queryClient.setQueryData(listKey, { items: [] });
    for (const bad of ["sim.branchedd", "sim.branch", "sim.tick_complete", "sim.session_create", "sim_branched"]) {
      invalidateForEvent(bad);
    }
    expect(queryClient.getQueryState(worldKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it("⑩ 失效表里的 key 与 SandboxView 源码里真实的 queryKey 字面量对得上（防表漂移）", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view.length, "SandboxView.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    // 视图侧真实字面量（改了这两行而不改失效表 → 本条红）。
    expect(view).toContain(`queryKey: ["a", "sim-sessions"]`);
    expect(view).toContain(`queryKey: ["a", "sim-world", sessionId ?? ""]`);
    // 表侧锚点必须与之同源。
    expect(SIM_CONSUMER_KEYS.simSessionList).toEqual(["a", "sim-sessions"]);
    expect(SIM_CONSUMER_KEYS.simWorld).toEqual(["a", "sim-world"]);
    // 且这两个前缀确实是那三个事件走的标签映射出来的。
    expect(EVENT_INVALIDATES["sim.branched"]).toContain("sim-sessions");
    expect(EVENT_INVALIDATES["sim.session_created"]).toContain("sim-sessions");
    expect(EVENT_INVALIDATES["sim.tick_completed"]).toContain("sim-world");
  });

  /**
   * ⑪ 与 **agentcore 侧订阅表**对账（事件→语义标签的单一来源在后端）。
   * 前端接了线而后端没登记 → 两边对不上，下一个人照后端表判断"这事件没人收"就又错一轮。
   */
  it("⑪ 前端失效表与 agentcore event-subscriptions 的 sim.* 登记逐条一致", () => {
    const src = readRepoFile("../../agentcore/src/event-subscriptions.ts");
    expect(src.length, "agentcore/src/event-subscriptions.ts 读到了空内容——路径漂了").toBeGreaterThan(1000);
    // 抽出后端登记的 sim.* 事件名（金丝雀：一个都抓不到 = 正则/路径坏了）。
    const registered = [...src.matchAll(/\{\s*event:\s*"(sim\.[a-z_]+)"/g)].map((m) => m[1]);
    expect(registered.length, "一个后端 sim.* 订阅登记都没抓到——正则或路径坏了，先修工具").toBeGreaterThan(0);
    const wiredInFrontend = Object.keys(EVENT_INVALIDATES).filter((e) => e.startsWith("sim."));
    expect(
      [...registered].sort(),
      "前端接线的 sim.* 与 agentcore 登记的对不上——事件→标签的单一来源在后端，必须同步",
    ).toEqual([...wiredInFrontend].sort());
  });
});
