import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { PgSimRepo } from "../src/repo/pg.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { diffTickStates, partitionPropagationRules, type SimCounterfactualResult, type SimSession } from "@platform/contracts";

/**
 * WO-ACTIVE-EDGE-UX · **后端接缝门**：关掉一条传导边 → 推演结果真的变 → 且对照跑不写世界态。
 *
 * ── 这道门为什么必须是"接缝驱动"而不是各半 unit ─────────────────────────────────────
 * 本单跨**数据半**（契约字段 + 迁移 + 仓储双实现）与**引擎半**（tick 路的规则过滤 + 对照跑）。
 * 各半分开测都能全绿而功能是坏的，两种真实死法：
 *   · 契约字段加了、pg 列没加 ⇒ memory 模式（测试默认）全绿，pg 模式（生产）屏蔽集永远读回 `[]`
 *     ⇒ 用户拨了开关、下次 tick 照旧全跑。→ 由本文件 ⑤（R9 双实现同一组断言）咬。
 *   · 过滤写在了"取规则目录"那一层而不是 tick 路 ⇒ 边从图上消失（用户不知道自己关了什么），
 *     或者反过来，过滤根本没挂到 tick 路上 ⇒ 屏上写着"已关闭"而引擎照跑。→ 由 ①②③ 咬。
 * 所以本文件一律走**真路由 inject**（真 seed → 真规则 → 真会话 → 真 tick），不直调引擎函数。
 *
 * ── 用哪条边（为什么是这条）───────────────────────────────────────────────────────
 * `demo_base_load_to_line_util`：`Base.loadIndex --line_belongs_to_base(0.5, delay 1)--> Line.utilPressure`
 * （`src/seed.ts` 出厂种子，方向已由 WO-SANDBOX-PROP-DIRECTION 钉死）。选它的理由是它**确实有下游影响
 * 且影响量可解析**：源置 20 ⇒ 每条产线 +10（20×0.5），延迟 1 tick 到达。
 * 于是"变了"这件事可以断言成**具体的数**（10 → 0），而不是"不等于"就算过 ——
 * 「不等于」那种断言，规则被换成任意别的、系数读错、贡献落到别的对象上，它都照样绿。
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 常州基地 —— demo 世界里 `line_belongs_to_base` 出边最全的一个（实测 10 条产线）。 */
const BASE_ID = "obj_base_changzhou";
/** 被测的那条边（出厂种子）。 */
const RULE_KEY = "demo_base_load_to_line_util";

interface TickResp {
  curTick: number;
  state: Record<string, Record<string, number>>;
  trace: { ruleKey: string; toObjectId: string; amount: number }[] | null;
}

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

/** 建会话 → 经**真扰动路由**把源端喂非 0（直写 baseSnapshot 就测不到写端接缝了）。 */
async function sessionWithBaseLoad(t: TestApp, loadIndex: number): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: { [BASE_ID]: { loadIndex: 0 } } },
  });
  expect(created.statusCode).toBe(201);
  const sid = created.json().id as string;
  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: {
      kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
      magnitude: loadIndex, mode: "set", label: `基地负载置为 ${loadIndex}`,
    },
  });
  expect(p.statusCode).toBe(201);
  return sid;
}

const tick = async (t: TestApp, sid: string): Promise<TickResp> => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
  expect(r.statusCode).toBe(200);
  return r.json() as TickResp;
};

/** 会话的**全部**可观测世界态（会话行 + 逐 tick 行），序列化后可逐字节比对。 */
async function worldFingerprint(t: TestApp, sid: string): Promise<string> {
  const s = await t.repos.sim.getSession("demo", sid);
  const ticks = await t.repos.sim.listTickStates("demo", sid);
  return JSON.stringify({ session: s, ticks });
}

const lineIdsOf = async (t: TestApp): Promise<string[]> =>
  (await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base" && l.fromId === BASE_ID))
    .map((l) => l.toId).sort();

describe("WO-ACTIVE-EDGE-UX · 会话级反事实（关掉一条传导边 → 结果真的变）", () => {
  // ── ① 引擎接缝：关掉边 ⇒ 下游状态变量真的变，且变的方向与量级可解释 ────────────────
  it("🔴 SEAM：屏蔽 demo_base_load_to_line_util ⇒ Line.utilPressure 由 10 变 0（方向↓·量级 20×0.5）", async () => {
    const t = await seededApp();
    const lineIds = await lineIdsOf(t);
    expect(lineIds.length).toBe(10); // 金丝雀：链路真的种了，本用例不是空转

    // (a) 基线：边开着，延迟 1 tick 后每条产线各得 20×0.5 = 10。
    const base = await sessionWithBaseLoad(t, 20);
    await tick(t, base); // tick1：只排 pending
    const b2 = await tick(t, base);
    for (const id of lineIds) expect(b2.state[id]!.utilPressure).toBe(10);

    // (b) 反事实：同一份种子、同一个扰动，只多了"把这条边关掉"这一件事。
    const cf = await sessionWithBaseLoad(t, 20);
    const patched = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${cf}/disabled-rules`, headers: ADMIN,
      payload: { disabledRuleKeys: [RULE_KEY] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().disabledRuleKeys).toEqual([RULE_KEY]);

    await tick(t, cf);
    const c2 = await tick(t, cf);
    // 🔴 判据 a：下游真的变了，且变成**具体那个数**（0），不是"不等于 10"。
    for (const id of lineIds) expect(c2.state[id]?.utilPressure ?? 0).toBe(0);
    // 🔴 判据 b：这条规则一次都没进 trace（不是"贡献变小了"，是这条边根本没跑）。
    expect((c2.trace ?? []).filter((x) => x.ruleKey === RULE_KEY).length).toBe(0);
    // 🔴 判据 c：**只有这条边被关掉**——源端扰动照旧生效（证明关的是边，不是把整个引擎停了）。
    expect(c2.state[BASE_ID]!.loadIndex).toBe(20);
    // 🔴 判据 d：`status` 一个字节没动（会话级反事实与本体真值正交，这正是本单最容易做错的地方）。
    const rules = await t.repos.sim.listPropagationRules("demo", false);
    expect(rules.find((r) => r.key === RULE_KEY)!.status).toBe("PUBLISHED");
  });

  // ── ② 对照端点：一次调用拿到"开/关两版 + 差异"，方向与量级都在回包里 ────────────────
  it("🔴 SEAM：POST …/counterfactual 同时给出基线与反事实，diff 方向 down、量级 10", async () => {
    const t = await seededApp();
    const lineIds = await lineIdsOf(t);
    const sid = await sessionWithBaseLoad(t, 20);

    // n=2：这条边 `delayTicks=1`，跑一格只进 pending、世界态看不出差别。
    // 用 n=1 断言"没差异"是**测错了对象**（那测的是延迟，不是屏蔽）。
    const r = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/counterfactual`, headers: ADMIN,
      payload: { n: 2, disabledRuleKeys: [RULE_KEY] },
    });
    expect(r.statusCode).toBe(200);
    const out = r.json() as SimCounterfactualResult;

    expect(out.fromTick).toBe(0);
    expect(out.ticks).toBe(2);
    expect(out.disabledRuleKeys).toEqual([RULE_KEY]);
    // 屏蔽的那条边**结构要回带** —— §3.3「关掉的边在图上要可见地降级，不是从图上消失」。
    expect(out.suppressedRules.map((x) => x.key)).toEqual([RULE_KEY]);
    // 诚实位：这条边在基线那版确实触发过 ⇒ 差值为空时才分得清"没影响"与"本来就没动"。
    expect(out.suppressedRulesFiredInBaseline).toEqual([RULE_KEY]);

    for (const id of lineIds) {
      expect(out.baselineState[id]!.utilPressure).toBe(10);
      expect(out.counterfactualState[id]?.utilPressure ?? 0).toBe(0);
    }
    const cell = out.diffs.find((d) => d.objectId === lineIds[0] && d.stateVar === "utilPressure");
    expect(cell).toBeDefined();
    expect(cell!.baseline).toBe(10);
    // 🔴 关掉这条边后，这一格在反事实世界里**整个不存在**（没有任何规则往它写）——
    //    `counterfactual` 如实报 `null`（「这个世界里没有这一格」≠「这一格是 0」），
    //    而 `delta` 照**引擎自己的读数约定**（`propagation.ts:367 readVar` 缺格读 0）算出 −10。
    //    这一条是实跑逼出来的：初版把 `delta` 也写成 null ⇒ 屏上显示"算不出"，
    //    而真相是"它降到了 0"，正是最该被看见的那个结论被藏起来了。
    expect(cell!.counterfactual).toBeNull();
    expect(cell!.delta).toBe(-10);
    expect(cell!.direction).toBe("down");

    // R6 确定性：同输入同参数版本同输出（回包里不许有任何 wall-clock 字段）。
    const again = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/counterfactual`, headers: ADMIN,
      payload: { n: 2, disabledRuleKeys: [RULE_KEY] },
    });
    expect(again.body).toBe(r.body);
  });

  // ── ③ 「对照跑不写世界态」——**用测试咬死，不是注释保证**（WO §3.1.4）──────────────
  it("🔴 SEAM：对照跑前后，会话行 + 全部 tick 行逐字节相同（putTickState/putSession 一次都不调）", async () => {
    const t = await seededApp();
    const sid = await sessionWithBaseLoad(t, 20);
    await tick(t, sid); // 先真跑一格，让世界里确实有东西可被写坏

    const before = await worldFingerprint(t, sid);
    // 金丝雀：指纹**不是恒定串** —— 真 tick 一定会改变它。没有这一步，
    // 下面的"前后相同"在指纹函数坏掉（比如恒返 "{}"）时会假绿。
    await tick(t, sid);
    const afterRealTick = await worldFingerprint(t, sid);
    expect(afterRealTick).not.toBe(before);

    const r = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/counterfactual`, headers: ADMIN,
      payload: { n: 3, disabledRuleKeys: [RULE_KEY] },
    });
    expect(r.statusCode).toBe(200);
    // 🔴 判据：跑了 3 格对照，世界**一个字节没动**（含 curTick、status、逐 tick state/pending/trace）。
    expect(await worldFingerprint(t, sid)).toBe(afterRealTick);
    // 且 curTick 确实没被推进（单独再钉一遍——它是用户最容易被悄悄推进的那个数）。
    const s = await t.repos.sim.getSession("demo", sid);
    expect(s!.curTick).toBe(2);
  });

  // ── ④ 未知 key 显式报错，**不许静默忽略** ──────────────────────────────────────────
  it("🔴 未知 ruleKey ⇒ 400 UNKNOWN_PROPAGATION_RULE_KEY（两条路由都咬）", async () => {
    const t = await seededApp();
    const sid = await sessionWithBaseLoad(t, 20);

    const p = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN,
      payload: { disabledRuleKeys: ["no_such_edge"] },
    });
    expect(p.statusCode).toBe(400);
    expect(p.json().error.code).toBe("UNKNOWN_PROPAGATION_RULE_KEY");

    const c = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/counterfactual`, headers: ADMIN,
      payload: { disabledRuleKeys: ["no_such_edge"] },
    });
    expect(c.statusCode).toBe(400);
    expect(c.json().error.code).toBe("UNKNOWN_PROPAGATION_RULE_KEY");

    // 金丝雀：同两条路由喂**真 key** 必须成功 —— 否则上面的 400 可能只是"路由压根不存在"。
    const ok = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN,
      payload: { disabledRuleKeys: [RULE_KEY] },
    });
    expect(ok.statusCode).toBe(200);
    // 报错那次**不许留下痕迹**（校验先于写入）。
    const s = await t.repos.sim.getSession("demo", sid);
    expect(s!.disabledRuleKeys).toEqual([RULE_KEY]);
  });

  // ── ⑤ R9 仓储双实现：memory 与 pg 跑**同一组断言** ────────────────────────────────
  //
  // 为什么必须有这一条：`sim_session` 是**逐列**表不是 doc-jsonb 表。契约上加一个字段，
  // memory（整对象 structuredClone）自动带上，**pg 不会** —— 忘了改列，
  // memory 测试全绿而 pg 模式下这个功能等于不存在（"漏一个 = 全绿且不可用"）。
  // 本环境无 `DATABASE_URL`，故 pg 侧用**桩 pool** 跑真 `PgSimRepo`：它真的执行
  // `putSession` 的列清单与 `rowToSession` 的读回映射 —— 少写一列/少读一个字段，本用例当场红。
  it("🔴 R9：memory 与 pg 两个仓储实现，disabledRuleKeys 往返同一组断言都通过", async () => {
    const session: SimSession = {
      id: "sims_r9", tenantId: "demo", baseSnapshot: { o1: { v: 1 } }, scope: { kind: "GLOBAL" },
      status: "READY", curTick: 3, parentCheckpointId: null,
      disabledRuleKeys: ["edge_a", "edge_b"], createdAt: "2026-08-14T00:00:00.000Z",
    };

    /** 两个实现共跑的**同一组**断言（不许各写一套——各写一套就测不出漂移）。 */
    const assertRoundTrip = (got: SimSession | null) => {
      expect(got).not.toBeNull();
      expect(got!.disabledRuleKeys).toEqual(["edge_a", "edge_b"]);
      expect(got!.curTick).toBe(3);
      expect(got!.scope).toEqual({ kind: "GLOBAL" });
    };

    // memory 侧
    const mem = createMemoryRepos();
    await mem.sim.createSession(session);
    assertRoundTrip(await mem.sim.getSession("demo", "sims_r9"));
    expect(await mem.sim.getSession("other", "sims_r9")).toBeNull(); // R2 跨租户

    // pg 侧：桩 pool 只做两件事 —— 记下 INSERT 的 (列名 → 值)，SELECT 时按 pg 驱动的形状回吐。
    // jsonb 列由驱动回吐**已解析的对象**，故此处对字符串做 JSON.parse 以逼真（否则 rowToSession
    // 会拿到字符串却因为 `as` 断言而不报错 —— 那就是"看着过了、生产是坏的"）。
    const rows = new Map<string, Record<string, unknown>>();
    const JSONB_COLS = new Set(["base_snapshot", "scope", "disabled_rule_keys"]);
    const stubPool = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async query(sql: string, params: unknown[] = []) {
        const insert = /INSERT INTO sim_session \(([^)]+)\)/.exec(sql);
        if (insert) {
          const cols = insert[1]!.split(",").map((s) => s.trim());
          const row: Record<string, unknown> = {};
          cols.forEach((col, i) => {
            const raw = params[i];
            row[col] = JSONB_COLS.has(col) && typeof raw === "string" ? JSON.parse(raw) : raw;
          });
          rows.set(String(row.id), row);
          return { rows: [], rowCount: 1 };
        }
        if (/SELECT \* FROM sim_session WHERE tenant_id=\$1 AND id=\$2/.test(sql)) {
          const row = rows.get(String(params[1]));
          return { rows: row && row.tenant_id === params[0] ? [row] : [], rowCount: 0 };
        }
        throw new Error(`桩 pool 未覆盖的 SQL：${sql}`);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgRepo = new PgSimRepo(stubPool as any);
    await pgRepo.createSession(session);
    // 🔴 金丝雀：INSERT 的列清单里**必须真的有** disabled_rule_keys —— 这一句让"忘了加列"
    // 报出的是"列缺失"而不是一个含糊的 undefined 断言失败（机器先说话，而且说的是人话）。
    expect([...rows.get("sims_r9")!.constructor === Object ? Object.keys(rows.get("sims_r9")!) : []])
      .toContain("disabled_rule_keys");
    assertRoundTrip(await pgRepo.getSession("demo", "sims_r9"));
    expect(await pgRepo.getSession("other", "sims_r9")).toBeNull(); // R2 跨租户

    // 旧行（034 之前建的，列为 NULL）读回 `[]` —— additive 可回退（RL9）。
    rows.get("sims_r9")!.disabled_rule_keys = null;
    expect((await pgRepo.getSession("demo", "sims_r9"))!.disabledRuleKeys).toEqual([]);
  });

  // ── ⑥ R3 entitlement 先于 authz：功能关 = 不存在（404），不是 403 ──────────────────
  it("🔴 R3：sim.propagation 关掉 ⇒ 两条新路由都 404 FEATURE_NOT_FOUND", async () => {
    const t = await seededApp();
    const sid = await sessionWithBaseLoad(t, 20);
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": true, "sim.propagation": false } },
    });
    for (const [method, url] of [
      ["PATCH", `/a/v1/sim/sessions/${sid}/disabled-rules`],
      ["POST", `/a/v1/sim/sessions/${sid}/counterfactual`],
    ] as const) {
      const r = await t.app.inject({ method, url, headers: ADMIN, payload: { disabledRuleKeys: [] } });
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
    }
  });

  // ── ⑦ 契约纯函数：过滤与差值的判据本身（前后端共用同一支，故它坏了两边一起坏）────────
  it("契约单源：partitionPropagationRules 空屏蔽集 ⇒ 原样返回（additive 可回退）；diffTickStates 只报变了的格", () => {
    const rules = [{ key: "a" }, { key: "b" }];
    expect(partitionPropagationRules(rules, []).active).toEqual(rules);
    expect(partitionPropagationRules(rules, []).suppressed).toEqual([]);
    expect(partitionPropagationRules(rules, ["b"]).active.map((r) => r.key)).toEqual(["a"]);
    expect(partitionPropagationRules(rules, ["b"]).suppressed.map((r) => r.key)).toEqual(["b"]);

    const d = diffTickStates({ o: { x: 10, y: 5 } }, { o: { x: 4, y: 5 } });
    expect(d.length).toBe(1); // y 没变 ⇒ 不上桌
    expect(d[0]).toMatchObject({ objectId: "o", stateVar: "x", baseline: 10, counterfactual: 4, delta: -6, direction: "down" });
    // 某一侧**缺这一格**：显示层如实报 `null`（「没有这一格」≠「这一格是 0」），
    // 而 delta 照引擎 `readVar` 的约定按 0 算 ⇒ 用户看得到"它降到 0 了"这个结论。
    const missing = diffTickStates({ o: { x: 10 } }, {});
    expect(missing[0]!.baseline).toBe(10);
    expect(missing[0]!.counterfactual).toBeNull();
    expect(missing[0]!.delta).toBe(-10);
    expect(missing[0]!.direction).toBe("down");
    // 两侧都缺 ⇒ 真的算不出，且这种格根本不上桌（`onlyChanged`）。
    expect(diffTickStates({ o: { x: 10 } }, { o: { x: 10 } })).toEqual([]);
  });
});
