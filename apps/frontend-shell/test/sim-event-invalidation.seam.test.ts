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
    // 今天的实测基线：7 处 emit / 6 个不同事件名 ⇒ **6 接线 + 0 缺口**。
    // 数变了说明 emit 侧动过 —— 停下来重新判断消费方，别让它悄悄漂过去。
    // 变更史：
    //   6/5/4 → 7/6/5（WO-P0 · 2026-08-09 新增 `sim.perturbation_created` emit，按本门要求
    //                  先登记进 SIM_EVENT_GAPS 并写清"为什么今天不接线"）；
    //   7/6/5 → 7/6/5，但**缺口 2 → 1**（WO-SIM-PERTURB-TIMELINE · 2026-08-10：
    //                  扰动清单读端真进了 TanStack Query（PerturbationTimeline 的 listQuery），
    //                  前任写死的出台账条件达成 ⇒ `sim.perturbation_created` 转真接线。
    //                  **emit 处数与事件名数都没动** —— 本单一行 emit 都没加，只补消费方）。
    //   缺口 1 → 0（WO-EVENT-SUB-CLOSURE · 2026-08-20：出台账三条件逐条达成 —— 读端路由
    //                  WO-ENGINE-2 件二（08-13）+ 真缓存 WO-BEFE-E 的 checkpointsQuery
    //                  + agentcore 登记（本单）⇒ `sim.checkpoint_saved` 转真接线，台账清空。
    //                  **emit 侧同样一行没动**，7/6 不变）。
    //   7/6 → 8/7（WO-SIMSESSION-BIZ-REUSE 加了 `sim.session_status_changed` 这**一处**新 emit
    //                  （`setSimSessionStatus` 里的唯一一行，datacore app.ts:2002），当时只登了本体 §4、
    //                  **前端两边都没登** ⇒ 本条与④当场变红。WO-GATE-ONTOLOGY-DRIFT（2026-08-23）
    //                  按"真缓存承载"判据接进 `EVENT_INVALIDATES`（→ `sim-sessions`，理由见 ⑭⑮），
    //                  故 8/7 + 缺口仍为 0。**这两个数是被这条断言逼出来的，不是人想起来的**。
    //   8/7 → 9/8，缺口 0 → 1（WO-SIM-DRILL-P12 · 3a23b3e3 · 2026-08-25 加了
    //                  `sim.drill_completed` 这**一处**新 emit，`app.ts` 演习端点里唯一一行）。
    //                  **按本门要求停下来重新核过消费方了，不是照着报错抄的数**：
    //                  演习走 `simAdvanceTicks(persist:false)`，`curTick` 一格不动、`putTickState`
    //                  一次不调（`sim-drill.seam.test.ts` ⑦ 咬死）⇒ 世界态/会话/扰动/检查点
    //                  **没有任何被缓存的东西变过**，此时接失效标签就是假接线（#90/#92 同族）。
    //                  故按本门另一条路「记进缺口台账并写清为什么今天不接线」处置 ——
    //                  条目在 `SIM_EVENT_GAPS`，出台账条件也写死在那里（先有真读端再登记）。
    //   ⚠ 这三个数此前一直停在 8/7/0，**不是因为没人动 emit**，而是因为 `pnpm -r test` 在
    //     datacore 那一包就短路了，frontend-shell 整包从来没跑到这里 —— 「门存在 ≠ 门在跑」。
    const emitted = emittedSimEvents();
    expect(emitted.length, "datacore sim.* emit 处数变了，重新核消费方").toBe(9);
    expect(new Set(emitted).size, "datacore sim.* 事件名数变了，重新核消费方").toBe(8);
    // 台账**不是**「悄悄不接线」的挡箭牌：新增 emit 而既不接线也不记账 ⇒ 测试④当场红；
    // 记了账也要逐条有理由、且不与已接线的重叠（本用例开头那个循环守着）。
    // 今日在账 1 条（`sim.drill_completed`，理由与出台账条件见 `eventInvalidation.ts`）。
    expect(Object.keys(SIM_EVENT_GAPS).length, "缺口台账条数变了：逐条复核理由与出台账条件").toBe(1);
    expect(Object.keys(SIM_EVENT_GAPS), "在账缺口不是预期的那条 ⇒ 有新缺口混进来了，别放过").toEqual(["sim.drill_completed"]);
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

  /**
   * ══ WO-EVENT-SUB-CLOSURE（2026-08-20）· 最后一个 sim.* 缺口闭环 ══
   * 与前几条同款纪律：咬**副作用**（真 query 被标脏）不咬「订阅函数被调过」，键锚在
   * SandboxView 源码真实字面量上，事件名拼错的反证必须什么都不失效。
   */
  it("⑫ sim.checkpoint_saved → 存档清单 query 真失效（跨标签页收到别的用户存的档）", () => {
    // 真 key 尾带 sessionId（SandboxView 的 checkpointsQuery），前缀失效必须能盖住。
    const cpKey = [...SIM_CONSUMER_KEYS.simCheckpoints, "sims_abc"];
    queryClient.setQueryData(cpKey, { items: [] });
    expect(queryClient.getQueryState(cpKey)?.isInvalidated).toBe(false);

    invalidateForEvent("sim.checkpoint_saved");

    expect(
      queryClient.getQueryState(cpKey)?.isInvalidated,
      "存档事件到达但存档清单没失效——别的标签页/别的用户存的档，本页永远看不见（本单要闭的就是这个）",
    ).toBe(true);
  });

  it("⑬ checkpoint 接线的防漂移锚 + 拼错事件名反证", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view.length, "SandboxView.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    // 视图侧真实字面量（改了这行而不改失效表 → 本条红）。
    expect(view).toContain(`queryKey: ["a", "sim-checkpoints", sessionId ?? ""]`);
    // 表侧锚点必须与之同源。
    expect(SIM_CONSUMER_KEYS.simCheckpoints).toEqual(["a", "sim-checkpoints"]);
    // 且这个前缀确实是 sim.checkpoint_saved 走的那条标签映射出来的。
    expect(EVENT_INVALIDATES["sim.checkpoint_saved"]).toContain("sim-checkpoints");
    // 反证：事件名拼错一个字母 → 什么都不失效（证咬的是真事件名，不是任意字符串）。
    const cpKey = [...SIM_CONSUMER_KEYS.simCheckpoints, "sims_abc"];
    queryClient.setQueryData(cpKey, { items: [] });
    for (const bad of ["sim.checkpoint_save", "sim.checkpoints_saved", "sim_checkpoint_saved"]) {
      invalidateForEvent(bad);
    }
    expect(queryClient.getQueryState(cpKey)?.isInvalidated).toBe(false);
  });

  /**
   * ══ WO-GATE-ONTOLOGY-DRIFT（2026-08-23）· 会话生命周期迁移接线 ══
   *
   * 这一条不是补记账，修的是**真陈旧**：`setSimSessionStatus`（datacore `app.ts:1989`）改完
   * `s.status` 并 `putSession` 之后 emit（`app.ts:2002`），而会话列表投影
   * （`GET /a/v1/sim/sessions` 的 `listSessionSummaries`）**逐项带 `status`**。
   * 不失效 ⇒ 别的标签页/别的面板停在旧状态：
   *   · `SandboxView.tsx` 世界列表 rail 直接渲染 `{s.status} · tick {s.curTick}`；
   *   · `console/useConsoleSession.ts` 的那条 useQuery 是 **`staleTime: Infinity`**（不失效永不重取），
   *     它用 `pickLatestRunningSession`（只认 `RUNNING`）替四个控制台页挑「当前世界」——
   *     会话被迁成 PAUSED/ENDED 后仍拿冻结世界冒充「当前」，用户再点 tick/act 只会撞 409。
   */
  it("⑭ sim.session_status_changed → 世界列表 query 真失效（迁 PAUSED/ENDED 后别处不再停在旧状态）", () => {
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(listKey, { items: [{ id: "sims_a", status: "RUNNING", curTick: 3 }] });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);

    invalidateForEvent("sim.session_status_changed");

    expect(
      queryClient.getQueryState(listKey)?.isInvalidated,
      "会话迁了状态而世界列表没失效——rail 上的 status 与 useConsoleSession 挑的『当前世界』都会停在旧值（useConsoleSession 是 staleTime:Infinity，不失效就永不重取）",
    ).toBe(true);
  });

  it("⑮ 会话状态接线的防漂移锚 + 「不挂无承载的标签」的反向断言 + 拼错事件名反证", () => {
    // 正向：这个前缀确实是本事件走的那条标签映射出来的（表改了这里就红）。
    expect(EVENT_INVALIDATES["sim.session_status_changed"]).toContain("sim-sessions");

    // 反向（这一半才是「不是随便挂一个」的证据）：
    //  · `sim-world` —— `setSimSessionStatus` 只改 status 再 putSession，tick 态一个字节没动 ⇒ 挂上=空跑；
    //  · `sim-scenarios` —— 产能页 pause/end 也走本事件，但前端 `LiveScenario` 类型里没有 `status`
    //    字段、`RiskBoardView` 一处都不读 ⇒ 今天没有承载它的屏，挂上=假接线（#90/#92 同族）。
    expect(
      EVENT_INVALIDATES["sim.session_status_changed"],
      "sim-world 被挂上了——状态迁移不改 tick 态，这是纯空跑；要挂先给出它真变了的证据",
    ).not.toContain("sim-world");
    expect(
      EVENT_INVALIDATES["sim.session_status_changed"],
      "sim-scenarios 被挂上了——前端 LiveScenario 类型里没有 status、方案列表一处都不读它，这是假接线；等方案列表真把生命周期上屏（先读端后事件）再挂",
    ).not.toContain("sim-scenarios");
    // 上面那句「LiveScenario 没有 status」是本条的前提，锚在源码上，改了即红（防前提悄悄过期）。
    const ep = readRepoFile("../src/api/endpoints.ts");
    expect(ep.length, "api/endpoints.ts 读到了空内容——路径漂了").toBeGreaterThan(1000);
    const liveScenarioDecl = ep.slice(ep.indexOf("export interface LiveScenario {"));
    expect(liveScenarioDecl.length, "抓不到 LiveScenario 声明——锚漂了，本条结论不可信").toBeGreaterThan(100);
    expect(
      liveScenarioDecl.slice(0, liveScenarioDecl.indexOf("}")),
      "LiveScenario 长出了 status 字段——方案列表可能已把生命周期上屏，重新判断要不要给本事件补挂 sim-scenarios",
    ).not.toContain("status");

    // 反证：事件名拼错 → 什么都不失效（证咬的是真事件名）。
    const listKey = [...SIM_CONSUMER_KEYS.simSessionList];
    queryClient.setQueryData(listKey, { items: [] });
    for (const bad of ["sim.session_status_change", "sim.session_statuses_changed", "sim_session_status_changed"]) {
      invalidateForEvent(bad);
    }
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
});
