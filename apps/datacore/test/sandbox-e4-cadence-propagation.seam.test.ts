/**
 * WO-SANDBOX-E4 · 节拍进推演（`propagateTick` 消费 D1 的 `Cadence`）验收门。
 *
 * ── 本门咬的接缝 ──────────────────────────────────────────────────────────────
 * **数据半（D1 从种子推出的 `Cadence` 落成对象）× 引擎半（`propagateTick` 到点才放行）**。
 * 两半此前完全没有连线：`Cadence` 落了库但没有任何东西读它去改变推演，
 * `propagateTick` 只认 `delayTicks`（固定时长），不认「到点才办」。
 * 故本门的每条断言都**跨过 HTTP tick 端点**（对象库 → cadenceFromProps → buildCadenceGates →
 * propagateTick → 落 tick 快照），不是直接调纯函数看形状对不对。
 *
 * ── 四条判据（工单 §E4） ──────────────────────────────────────────────────────
 *  ① **到点才放行 ≠ 固定等一段**：同一条流，挂闸门 vs 不挂闸门 → 中途读数完全不同
 *     （0,0,24 vs 8,16,24），总量相同。批量释放现象就是这个形状差。
 *  ② **SEAM 判据（工单原文）**：把 S&OP 节拍从基线 14d 改到 7d → **全链前置期真的缩短，
 *     且缩短量 == `Δ(everyDays)/2`**（3.5 tick，逐值相等，不是"变小了就算过"）。
 *  ③ **诚实缺席**：规则声明了一个 D1 标 EMPTY 的节拍 → 该流**不传导**且响应里显式报缺，
 *     绝不当作"随到随办"（那是把"不知道要等多久"渲染成"不用等"）。
 *  ④ **R6 确定性**：同 (seed, 场景, 参数版本) 重跑逐 tick 快照字节一致。
 *
 * ── 变异反证的注入点（改哪一处会红，写明白免得下一个人猜）────────────────────
 *  · `propagation.ts` `nextGateTick(tick, gate)` → 改成固定时长 `tick + round(everyTicks/2)`
 *    ⇒ ①「批量释放」红（中途读数变成逐 tick 递增）。
 *  · `propagateTick` 里 `gates[rule.cadenceNodeId] === undefined` 的 `continue`
 *    → 改成"当没闸门跑" ⇒ ③ 红（EMPTY 节拍的流会悄悄传导出一个数）。
 */
import { describe, expect, it } from "vitest";
import { expectedCadenceWaitDays, type Cadence } from "@platform/contracts";
import { ADMIN, debugUser, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { generateBattery } from "../src/synthetic/battery.js";
import { cadenceObjectRows, deriveChainCadences } from "../src/synthetic/cadence.js";
import { cadenceGate, cadenceGateWaitTicks, cadenceQuantizationGapTicks, nextGateTick } from "../src/sim/propagation.js";

/** D1 从种子推出的**真**节拍对象行（与 `synthetic/service.ts:712 putAll("Cadence", …)` 同一支产出）。 */
const D1_CADENCE_ROWS = cadenceObjectRows(deriveChainCadences(generateBattery(42, "S")));
const d1Row = (nodeId: string): Record<string, unknown> => {
  const r = D1_CADENCE_ROWS.find((x) => x.nodeId === nodeId);
  if (!r) throw new Error(`D1 未登记节点：${nodeId}`);
  return r;
};

const ORG = { type: "SYNTHETIC" as const, jobId: "e4-seam" };
const enableSim = (t: TestApp, tenant: string, headers: Record<string, string>) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 抽象两点图（R14 零行业名）：src(TypeA) --FEEDS--> dst(TypeB)，外加**真** Cadence 对象行。 */
async function lightWorld(t: TestApp, tenant: string, cadenceRows: readonly Record<string, unknown>[]): Promise<void> {
  for (const k of ["TypeA", "TypeB"]) {
    await t.repos.ontologyTypes.put({ id: `otype_${k}_${tenant}`, tenantId: tenant, key: k, displayName: k, properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE" });
  }
  await t.repos.objects.put({ id: "src", tenantId: tenant, type: "TypeA", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "dst", tenantId: tenant, type: "TypeB", props: {}, origin: ORG });
  await t.repos.links.put({ id: "lnk", tenantId: tenant, type: "FEEDS", fromId: "src", toId: "dst", origin: ORG });
  // Cadence 行按 `synthetic/service.ts putAll(…, "nodeId")` 的同一 id 约定落库（消费口只认 props.nodeId）。
  for (const row of cadenceRows) {
    await t.repos.objects.put({
      id: `obj_cadence_${String(row.nodeId)}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
      tenantId: tenant, type: "Cadence", props: row, origin: ORG,
    });
  }
}

/**
 * 跑一条「恒定来料 → 过闸 → 固定行程」的流，回**前置期**（tick）= 质量加权平均到达 tick − 平均投料 tick。
 *
 * ── 为什么是恒定来料 + 完整周期取平均，而不是打一发脉冲看它哪 tick 落地 ──────
 * 单发脉冲的等待取决于它撞上周期的**哪个相位**（0…E−1 里的任意一个），那是**一次实现**、不是**期望**；
 * 契约 §2 的 `everyDays/2` 是期望，只有在完整周期上取平均才谈得上。恒定来料 ⇒ 每 tick 等量到闸前
 * ⇒ 一个周期内的等待恰好取遍 `{0,…,E−1}`，平均即期望（引擎离散版 `(E−1)/2`，那半个 tick 的量化差
 * 在 `cadenceGateWaitTicks` 注释与 E4-6 里诚实登记，且它是常数 ⇒ 不影响本判据要的**差值**）。
 *
 * ── 计量窗口的取法（这里有一处必须讲清，否则数会对不上）────────────────────
 * 窗口取 **`(g0, g0+WINDOW]`**，`g0` = 第一次开闸的 tick（= 种子推出的相位），`WINDOW = 28`
 * （14 与 7 的公倍数）。这样取的理由有两条，缺一不可：
 *  · 起点用 `g0` 而不是 0 —— tick 0…g0 那批料和 tick g0 那一份**在同一次开闸里齐放**，
 *    窗口若从 0 起，第一批就把"半个周期"混进来，平均值不再是完整周期的平均；
 *  · 长度取两个节拍的公倍数 —— 两边都恰好跑整数个完整周期，于是结果是**精确值**（下面逐值相等断言，不留容差）。
 * `g0+WINDOW` 对两个节拍都仍是开闸点（WINDOW 是周期的公倍数），故两次测量的窗口**同一个**。
 *
 * 注（本单**不用** `act` 掐来料的原因，是个真实发现）：`POST /sim/sessions/:id/act` 落 tick 态时
 * 写死 `pending: []`（`app.ts` act 分支）——**会把在途的延迟贡献整队清空**。
 * 用它掐来料会凭空吞掉一批已发出的量（实测 28 → 17），守恒当场破。
 * 那是既有行为、不在本单边界内，故本测改用"只统计完整批次窗口"绕开，并在交付说明里报这个发现。
 *
 * ⚠ **上面这段自 2026-08-09 起已过期，保留原文只为留住来历**（本仓规矩：过期的账要标掉不要抹掉）：
 * 欠账 #151 已由 WO-P0 修掉 —— `simApplyAtCurrentTick`（`app.ts`）现在**读回并保留**当前 tick 的
 * `pending`/`trace`，只改 `state`；`/act` 与 `POST /perturbations` 共用它。
 * 复验：`test/sim-perturbation.test.ts` 断言②（`/act` 路）· `test/sim-act-close.seam.test.ts` ③（`/perturbations` 路），
 * 两条都真跑 `tick → 施加 → tick` 并断言在途贡献如期到达。
 * 本测**不改**计量窗口的取法：那个取法本身是对的（要的是完整周期的平均，与 `act` 能不能用无关）。
 */
const WINDOW = 28; // 计量窗口长度（14 与 7 的公倍数 ⇒ 两边都是整数个完整周期）
const TRAVEL_TICKS = 3; // 链上除节拍外的固定行程（rule.delayTicks）

async function chainLeadTimeTicks(t: TestApp, tenant: string, headers: Record<string, string>, gateOffset: number): Promise<number> {
  const g0 = gateOffset; // 第一次开闸（相位来自数据，不是测试写死）
  const g1 = g0 + WINDOW; // 窗口末端，对两个节拍同为开闸点
  const runTicks = g1 + TRAVEL_TICKS + 1; // 跑到最后一批落地（快照 tick = 引擎 tick + 1）
  const sid = (await (await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers,
    payload: { baseSnapshot: { src: { flow: 1 }, dst: { received: 0 } } },
  })).json()).id as string;
  // 恒定来料（src.flow 无人改写 ⇒ 每 tick 产出等量 = 1×1）。
  await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers, payload: { n: runTicks } });

  // 从**端点自己落的**逐 tick 快照读到达剖面（不是测试自己另跑一遍传导给自己作证）。
  const states = await t.repos.sim.listTickStates(tenant, sid);
  const byTick = new Map<number, number>();
  for (const s of states) byTick.set(s.tick, (s.state as Record<string, Record<string, number>>).dst?.received ?? 0);
  let mass = 0;
  let weighted = 0;
  // 窗口内投料（tick g0+1 … g1）的到达，落在快照 (g0+TRAVEL+1, g1+TRAVEL+1]。
  for (let k = g0 + TRAVEL_TICKS + 2; k <= g1 + TRAVEL_TICKS + 1; k++) {
    const delta = (byTick.get(k) ?? 0) - (byTick.get(k - 1) ?? 0);
    if (delta === 0) continue;
    mass += delta;
    // 快照 tick k 存的是「引擎跑 tick k−1」之后的态 ⇒ 引擎口径到达 tick = k−1。
    weighted += (k - 1) * delta;
  }
  // 守恒自证：窗口内投多少料就到多少（没漏、没重、没混进邻窗的批次）。
  expect(mass).toBe(WINDOW);
  const meanGenTick = (g0 + 1 + g1) / 2; // 窗口内投料 tick 的平均（等量投料 ⇒ 算术中点）
  return weighted / mass - meanGenTick;
}

describe("WO-SANDBOX-E4 · 节拍进推演（D1 Cadence × propagateTick 接缝）", () => {
  // ────────────────────────────────────────────────────────────────────────
  // ① 到点才放行（批量释放）—— 走**真种子**落的 Cadence 对象 + 真 HTTP tick 端点
  // ────────────────────────────────────────────────────────────────────────

  it("E4-1 SEAM 真种子链路：合成落的 Cadence(demand.consensus) 真的把一条流拦到闸点，到点一次性齐放", async () => {
    const t = await makeApp();
    await seedBattery(t); // 真合成 → 真 putAll("Cadence", …)（数据半的真实产出，不是测试手写）
    await enableSim(t, "demo", ADMIN);

    // 数据半确认：闸门参数来自对象库里那一行，不是测试常量。
    const cadObjs = await t.repos.objects.listByType("demo", "Cadence");
    const sop = cadObjs.find((o) => o.props.nodeId === "demand.consensus");
    expect(sop, "合成必须把 Cadence 落成对象（D1 §5 落库口）").toBeDefined();
    expect(sop!.props.dataMode).toBe("SYNTHETIC");
    const everyDays = Number(sop!.props.everyDays);
    const offsetDays = Number(sop!.props.offsetDays);
    const gate = cadenceGate({ everyDays, offsetDays })!;
    expect(gate).not.toBeNull();

    // 引擎半：沿 demo 真链路 order_for_model 挂一条**声明了节拍闸门**的规则（走真 REST）。
    const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
    const { fromId: orderId, toId: modelId } = links[0]!;
    const mk = (key: string, cadenceNodeId: string | null) =>
      t.app.inject({
        method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
        payload: {
          key, sourceTypeKey: "Order", sourceStateVar: "demandPressure", viaLinkKey: "order_for_model",
          targetTypeKey: "Model", targetStateVar: "demandLoad", coefficient: 0.8, delayTicks: 0,
          cadenceNodeId, status: "PUBLISHED",
        },
      });
    expect((await mk("e4_gated", "demand.consensus")).statusCode).toBe(201);

    const run = async () => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [orderId]: { demandPressure: 10 }, [modelId]: { demandLoad: 0 } } },
      })).json()).id as string;
      const seen: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
        seen.push((r.json().state as Record<string, Record<string, number>>)[modelId]!.demandLoad ?? 0);
      }
      return seen;
    };

    // 闸门相位 = offsetDays（种子推出的相位），周期 14 ⇒ 从 tick 0 起第一次开闸在 tick 2。
    const firstGate = nextGateTick(0, gate);
    expect(firstGate).toBe(offsetDays); // 真值驱动：相位来自数据，不是测试写死的 2
    const gated = await run();
    // 到点前**恒 0**（不是"变小了"，是真的一点都没放），到点当 tick 把攒下的一次性放完：
    // tick 0/1 产生的量排到 tick 2，tick 2 自身开闸即时放 ⇒ 3 个 tick 的量齐放 = 0.8×10×3。
    expect(gated.slice(0, firstGate)).toEqual(new Array(firstGate).fill(0));
    expect(gated[firstGate]).toBe(0.8 * 10 * (firstGate + 1));

    // 对照组：同一条流不挂闸门 ⇒ 逐 tick 递增。两组**终值相同、路径不同** = 批量释放的定义。
    await t.repos.sim.putPropagationRule({
      ...(await t.repos.sim.listPropagationRules("demo", true)).find((r) => r.key === "e4_gated")!,
      key: "e4_gated", cadenceNodeId: null,
    });
    const plain = await run();
    expect(plain).toEqual([8, 16, 24]);
    expect(gated).toEqual([0, 0, 24]);
    expect(gated[2]).toBe(plain[2]); // 守恒：闸门只改**什么时候**到，不改**到多少**
  });

  // ────────────────────────────────────────────────────────────────────────
  // ② SEAM 判据：改节拍 → 全链前置期缩短量 == Δ(everyDays)/2
  // ────────────────────────────────────────────────────────────────────────

  it("E4-2 SEAM 判据（工单原文）：S&OP 节拍 14d→7d ⇒ 全链前置期缩短量逐值 == Δ(everyDays)/2", async () => {
    const t = await makeApp();
    const TEN = "e4co";
    const H = debugUser(TEN, "admin", "admin");
    await lightWorld(t, TEN, D1_CADENCE_ROWS);
    await enableSim(t, TEN, H);
    await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H,
      payload: {
        key: "e4_chain", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeB", targetStateVar: "received", coefficient: 1, delayTicks: TRAVEL_TICKS,
        cadenceNodeId: "demand.consensus", status: "PUBLISHED",
      },
    });

    // 基线 = D1 从种子推出的真值（**不是**测试挑的数）。相位同理。
    const baseEveryDays = Number(d1Row("demand.consensus").everyDays);
    const phase = Number(d1Row("demand.consensus").offsetDays);
    expect(baseEveryDays).toBe(14);
    expect(WINDOW % baseEveryDays).toBe(0); // 窗口是整数个完整周期（判据成立的前提，显式咬住）
    expect(WINDOW % 7).toBe(0);
    const leadBefore = await chainLeadTimeTicks(t, TEN, H, phase);

    // 只改这一个数：把节拍对象的 everyDays 从 14 改成 7（相位不动）。
    const sopId = `obj_cadence_demand_consensus`;
    const before = (await t.repos.objects.get(TEN, sopId))!;
    await t.repos.objects.put({ ...before, props: { ...before.props, everyDays: 7 } });
    const leadAfter = await chainLeadTimeTicks(t, TEN, H, phase);

    // ★ 工单判据：真的缩短了，且缩短量**恰等于** Δ(everyDays)/2 —— 走契约的唯一公式，
    //   本文件不写第二支除法（写了就等于给"等待期望"开第二个真相源）。
    const expectedShrink =
      expectedCadenceWaitDays({ everyDays: baseEveryDays } as Cadence) - expectedCadenceWaitDays({ everyDays: 7 } as Cadence);
    expect(expectedShrink).toBe(3.5);
    expect(leadBefore - leadAfter).toBe(expectedShrink);
    expect(leadAfter).toBeLessThan(leadBefore);

    // 绝对值也钉死（前置期 = 固定行程 + 闸门平均等待 (E−1)/2），
    // 免得两边同时漂了差值还对 —— 这正是"只断言差值"能漏掉的假绿。
    expect(leadBefore).toBe(TRAVEL_TICKS + (14 - 1) / 2);
    expect(leadAfter).toBe(TRAVEL_TICKS + (7 - 1) / 2);
  });

  // ────────────────────────────────────────────────────────────────────────
  // ③ 诚实缺席：EMPTY 节拍不许被当成"随到随办"
  // ────────────────────────────────────────────────────────────────────────

  it("E4-3 诚实缺席：规则声明了 D1 标 EMPTY 的节拍 ⇒ 该流不传导 + 响应显式报缺（不静默兜底）", async () => {
    const t = await makeApp();
    const TEN = "e4empty";
    const H = debugUser(TEN, "admin", "admin");
    await lightWorld(t, TEN, D1_CADENCE_ROWS);
    await enableSim(t, TEN, H);
    // order.review 是 D1 亲手取证后标 EMPTY/NO_CARRIER 的节点（全仓无订单评审事件序列）。
    expect(d1Row("order.review").dataMode).toBe("EMPTY");
    expect(d1Row("order.review").emptyReason).toBe("NO_CARRIER");
    await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H,
      payload: {
        key: "e4_empty", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeB", targetStateVar: "received", coefficient: 1, delayTicks: 0,
        cadenceNodeId: "order.review", status: "PUBLISHED",
      },
    });
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: H,
      payload: { baseSnapshot: { src: { flow: 5 }, dst: { received: 0 } } },
    })).json()).id as string;
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 4 } });
    const body = r.json() as {
      state: Record<string, Record<string, number>>;
      cadence: { gates: Record<string, unknown>; skipped: { nodeId: string; reason: string }[]; unresolved: { ruleKey: string; cadenceNodeId: string; reason: string; detail: string }[] };
    };
    // 终态：**一点都没传导**（不是传导了 0 —— 是这条流根本没参与）。
    expect(body.state.dst?.received ?? 0).toBe(0);
    // 而且说清了为什么：机器可读 + 人可读，前端才可能显示"这条流因节拍未知未参与推演"。
    expect(body.cadence.unresolved.map((u) => u.ruleKey)).toEqual(["e4_empty"]);
    expect(body.cadence.unresolved[0]!.reason).toBe("NO_GATE");
    expect(body.cadence.unresolved[0]!.detail).toContain("order.review");
    // EMPTY 的节点必须出现在 skipped（查过、有登记、就是没值），而不是从世界上消失。
    expect(body.cadence.skipped.some((s) => s.nodeId === "order.review" && s.reason === "EMPTY")).toBe(true);
    // 反面对照：能推出周期的节点确实成了闸门（证明 skipped 不是"全都没建成"）。
    expect(Object.keys(body.cadence.gates)).toContain("demand.consensus");
  });

  it("E4-4 单源纪律：cadenceNodeId 写自由串 ⇒ REST 拒收（CHAIN_NODE_REGISTRY 单源，D1×E1 那次事故的门）", async () => {
    const t = await makeApp();
    await enableSim(t, "demo", ADMIN);
    const bad = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: {
        key: "e4_bad", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeB", targetStateVar: "received", coefficient: 1, delayTicks: 0,
        cadenceNodeId: "sop_consensus", status: "PUBLISHED", // ← D1 初版自造的那套 snake_case 词表
      },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const list = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()).items as { key: string }[];
    expect(list.some((r) => r.key === "e4_bad")).toBe(false); // 终态：没落库
    // 在册节点则收（证明拒的是"自由串"不是"这个字段"）。
    const good = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: {
        key: "e4_ok", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeB", targetStateVar: "received", coefficient: 1, delayTicks: 0,
        cadenceNodeId: "demand.consensus", status: "PUBLISHED",
      },
    });
    expect(good.statusCode).toBe(201);
  });

  // ────────────────────────────────────────────────────────────────────────
  // ④ R6 确定性 + 半 tick 量化的诚实登记
  // ────────────────────────────────────────────────────────────────────────

  it("E4-5 R6：同 (seed, 场景, 参数版本) 重跑 → 逐 tick 快照字节一致", async () => {
    const snapshot = async (tenant: string) => {
      const t = await makeApp();
      const H = debugUser(tenant, "admin", "admin");
      await lightWorld(t, tenant, D1_CADENCE_ROWS);
      await enableSim(t, tenant, H);
      await t.app.inject({
        method: "POST", url: "/a/v1/sim/propagation-rules", headers: H,
        payload: {
          key: "e4_r6", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
          targetTypeKey: "TypeB", targetStateVar: "received", coefficient: 1, delayTicks: TRAVEL_TICKS,
          cadenceNodeId: "demand.consensus", status: "PUBLISHED",
        },
      });
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: H,
        payload: { baseSnapshot: { src: { flow: 1 }, dst: { received: 0 } } },
      })).json()).id as string;
      await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 20 } });
      return JSON.stringify((await t.repos.sim.listTickStates(tenant, sid)).map((s) => [s.tick, s.state, s.pending]));
    };
    expect(await snapshot("e4r6a")).toBe(await snapshot("e4r6b"));
  });

  it("E4-6 半 tick 量化差是**常数 0.5**（所以差值恒 = Δ/2）—— 诚实登记，不拿它冒充契约期望", () => {
    // 引擎只有整 tick：一个周期内的等待取遍 {0,…,E−1} ⇒ 均值 (E−1)/2；
    // 契约 `expectedCadenceWaitDays` 是连续时间期望 E/2。二者恒差半个 tick。
    // 这半个 tick **不许**被偷偷抹平（抹平 = 给用户一个算不出来的数），但它是常数 ⇒ 差值不受影响。
    for (const row of D1_CADENCE_ROWS) {
      if (row.dataMode !== "SYNTHETIC") continue;
      const cadence = { everyDays: Number(row.everyDays), offsetDays: Number(row.offsetDays), kind: String(row.cadenceKind) } as Cadence;
      const gate = cadenceGate(cadence);
      expect(gate, `D1 推出的周期应可整 tick 表示：${String(row.nodeId)}`).not.toBeNull();
      expect(cadenceQuantizationGapTicks(cadence, gate!)).toBe(0.5);
      // 且引擎均值就是实测：把一个完整周期走一遍，等待恰好取遍 {0,…,E−1}。
      const waits: number[] = [];
      for (let k = 0; k < gate!.everyTicks; k++) waits.push(nextGateTick(k, gate!) - k);
      expect([...waits].sort((a, b) => a - b)).toEqual([...Array(gate!.everyTicks).keys()]);
      expect(waits.reduce((a, b) => a + b, 0) / waits.length).toBe(cadenceGateWaitTicks(gate!));
    }
  });

  it("E4-8 向后兼容：E4 之前落库的老规则（doc 里根本没有 cadenceNodeId 键）必须照旧传导，不许被当成'声明了闸门'", async () => {
    // ── 这条门咬的是一个**只在 pg 模式才暴露**的接缝 ──────────────────────────
    // `repo/pg.ts:113` 读回是 `row.doc as PropagationRule` —— **裸 cast，不过 zod parse**，
    // 所以 `.default(null)` 在读回路上**不生效**：E4 之前写进 `sim_propagation_rule.doc`
    // 的老规则读回来 `cadenceNodeId === undefined`（不是 null）。
    // 若引擎用 `!== null` 判「有没有声明闸门」，`undefined !== null` 为真 ⇒ 老规则会被当成
    // 「声明了闸门但拿不到」⇒ **整条流停止传导**。契约 §cadenceNodeId 明写「缺省 ⇒ 行为与本字段
    // 引入前逐字节相同（additive·可回退 RL9）」，那就必须对 undefined 也成立。
    // 内存仓与 pg 仓一样是**原样存取**（`repo/memory.ts:70` `this.rules.set(r.id, clone(r))`），
    // 故这里直接经仓储放一条「没有该键」的规则 = 忠实复现 pg 读回老 doc 的那一刻。
    const t = await makeApp();
    const TEN = "e4legacy";
    const H = debugUser(TEN, "admin", "admin");
    await lightWorld(t, TEN, D1_CADENCE_ROWS);
    await enableSim(t, TEN, H);
    const legacy = {
      id: "rule_legacy", tenantId: TEN, key: "e4_legacy",
      sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
      targetTypeKey: "TypeB", targetStateVar: "received",
      coefficient: 1, delayTicks: 0, combine: "sum", decay: null, clamp: null, coefficientRef: null,
      status: "PUBLISHED",
    };
    expect("cadenceNodeId" in legacy, "本例的前提就是这个键不存在").toBe(false);
    await t.repos.sim.putPropagationRule(legacy as unknown as Parameters<typeof t.repos.sim.putPropagationRule>[0]);

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: H,
      payload: { baseSnapshot: { src: { flow: 5 }, dst: { received: 0 } } },
    })).json()).id as string;
    const body = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 3 } })).json() as {
      state: Record<string, Record<string, number>>;
      cadence: { unresolved: { ruleKey: string; cadenceNodeId: string }[] };
    };
    // 老规则 = 不过闸门 ⇒ 逐 tick 即时传导，3 tick 后 = 5×1×3。
    expect(body.state.dst?.received ?? 0).toBe(15);
    // 且**绝不**出现在 unresolved 里 —— 它从来没声明过闸门，报它缺闸门是污蔑。
    expect(body.cadence.unresolved.map((u) => u.ruleKey)).not.toContain("e4_legacy");
  });

  it("E4-7 不可整 tick 表示的周期诚实拒绝（D1 SEAM-4 留给 E4 的那条边界，不偷偷取整）", () => {
    expect(cadenceGate({ everyDays: 2.5 })).toBeNull(); // 半天周期在日 tick 引擎上造不出闸门
    expect(cadenceGate({ everyDays: 0.5 })).toBeNull();
    expect(cadenceGate({ everyDays: 14, offsetDays: 2.5 })).toBeNull(); // 相位同理
    expect(cadenceGate({ everyDays: 14, offsetDays: 2 })).toEqual({ everyTicks: 14, offsetTicks: 2 });
  });
});
