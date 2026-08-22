import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { PgSimRepo } from "../src/repo/pg.js";
import {
  DEMO_SIM_WORLD_COMPLETE_KEY,
  DEMO_SIM_WORLD_SESSION_ID,
  DEMO_SIM_WORLD_TICKS,
  seedDemoSimWorld,
  seedWorldCompleteness,
} from "../src/sim/seed-world.js";
import type { SimSession, SimSessionListItem, TickState } from "@platform/contracts";

/**
 * ══ WO-SIM-SESSIONS-PROJECTION · 接缝门（两件病，一条链）══════════════════════════
 *
 * ── 件一 · 会话列表一跳回 285 MB ────────────────────────────────────────────────
 * **X（今天·2026-08-22 真 PostgreSQL 实测原文）**：
 *   35 条生产量级会话（每条 `baseSnapshot` = 11,348 对象 × 36 状态变量 = 408,528 格 ≈ 8.4MB）
 *   `curl -w 'size=%{size_download} time=%{time_total}' GET /a/v1/sim/sessions`
 *     → **`size=298,834,924  time=8.99`** = 285 MB / 9 秒，O(N × 世界规模)。
 *   前端三处消费方共用缓存键 `["a","sim-sessions"]` 打这一跳 ⇒ 渲染进程 OOM。
 * **Y（应该）**：列表回列表该有的东西 + 规模摘要；世界内容按 id 单取。
 *
 * ── 件二 · 播种不是原子的，崩一次就永久半残 ──────────────────────────────────────
 * **X（今天·实测）**：`seedDemoSimWorld` 是四次独立写（`createSession` → `createPerturbation`
 *   → `tick × 3`）。容器杀在中间 ⇒ 库里留下 `status=READY, cur_tick=0`、tick 态只剩 tick0、
 *   零扰动的**半成品**。重启后守卫判的是「有没有东西」，于是日志打
 *     `SEED_DEMO=1: demo sim world not created — 幂等命中：种子世界已存在（固定 id），不重建、不再推拍`
 *   —— 一句看起来一切正常的话，而四页的 `pickLatestRunningSession` 要 `RUNNING`，
 *   这条 READY@tick0 一辈子挑不中 ⇒ 屏上永远"无世界"。**部署态的库就此永久坏掉。**
 * **Y（应该）**：判据落在「播完了没有」上，不是「有没有东西」上；半残要被看见、且能自愈。
 *
 * ══ 咬的是链路，不是函数 ═══════════════════════════════════════════════════════
 * 件一断的是 `GET /a/v1/sim/sessions` **这条路由的回包**（前端真打的那条），
 * 不是 `listSessionSummaries()` 会返回什么 —— 后者只能证明一个函数会返回东西
 * （本仓假绿第 9 形态）。件二断的是「杀在中途 → 重启 → 世界真的被补齐」这条链，
 * 不是 `seedWorldCompleteness()` 的三个分支各自会返回什么字符串。
 */

const enableSim = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

const cellCount = (state: TickState): number =>
  Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);

/** 造一个 objects × vars 的世界态（口径 = 前端 `deriveBaseSnapshot`：对象 → 状态变量 → 数）。 */
const world = (objects: number, vars: number): TickState => {
  const s: TickState = {};
  for (let o = 0; o < objects; o++) {
    const row: Record<string, number> = {};
    for (let v = 0; v < vars; v++) row[`v${v}`] = o + v;
    s[`obj_${o}`] = row;
  }
  return s;
};

const createSession = async (t: TestApp, baseSnapshot: TickState): Promise<string> => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(r.statusCode).toBe(201);
  return (r.json() as SimSession).id;
};

describe("WO-SIM-SESSIONS-PROJECTION 件一 · 列表投影", () => {
  it("① 列表回包不含世界内容、带规模摘要；② 回包体积不随世界规模长；③ 建会话 201 与 GET :id 照旧含 baseSnapshot", async () => {
    const t = await makeApp();
    await enableSim(t);

    // ── 金丝雀：先自证这套量法真能分辨"大"与"小"（铁律 0.6：扫描类结论先自证工具）─────
    // 没有这一步，②的「回包不随规模长」在一个**根本没建出大世界**的库上也恒真。
    const small = world(3, 2); //   3 对象 ×  2 变量 =    6 格
    const big = world(400, 30); // 400 对象 × 30 变量 = 12,000 格（2000×，够把差别拉开）
    expect(cellCount(big) / cellCount(small), "金丝雀：两个世界的规模差必须够大").toBeGreaterThan(1000);

    const smallId = await createSession(t, small);
    const bigId = await createSession(t, big);

    // ── ① 列表：**没有** baseSnapshot 这个键，且规模摘要与真世界逐值对得上 ──────────
    const lr = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN });
    expect(lr.statusCode).toBe(200);
    const items = lr.json().items as SimSessionListItem[];
    expect(items).toHaveLength(2);
    for (const it of items) {
      // 「没有这个键」必须用 `in` 咬，不能用 `toBeUndefined()` —— 后者对
      // `{baseSnapshot: undefined}` 也通过，而那是"给了一个空的"，不是"没给"。
      expect("baseSnapshot" in it, `${it.id}：列表项不许带世界内容`).toBe(false);
    }
    const bigItem = items.find((x) => x.id === bigId)!;
    const smallItem = items.find((x) => x.id === smallId)!;
    // 诚实位：调用方据此知道那边有多大，而不是在「我没给你」与「它就是空的」之间猜。
    expect(bigItem.baseSnapshotScale).toEqual({ objects: 400, cells: 12_000 });
    expect(smallItem.baseSnapshotScale).toEqual({ objects: 3, cells: 6 });
    // 列表**该有**的东西一样不少（四页/沙盘 rail 真读的那几个字段）。
    expect(bigItem.status).toBe("READY");
    expect(bigItem.curTick).toBe(0);
    expect(bigItem.disabledRuleKeys).toEqual([]);
    expect(typeof bigItem.createdAt).toBe("string");
    expect(bigItem.parentCheckpointId).toBeNull();

    // ── ② 量化：回包体积**不随世界规模长**（本单的整个理由）───────────────────────
    // 判据是「列表回包 < 单个世界回包」，不是一个写死的字节数 ——
    // 写死的阈值会在世界规模变了之后变成一条度量不到任何东西的恒真断言。
    const listBytes = Buffer.byteLength(lr.body, "utf8");
    const oneWorld = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${bigId}`, headers: ADMIN });
    expect(oneWorld.statusCode).toBe(200);
    const oneWorldBytes = Buffer.byteLength(oneWorld.body, "utf8");
    expect(listBytes * 10, `列表 ${listBytes}B 不该与单个世界 ${oneWorldBytes}B 同量级`).toBeLessThan(oneWorldBytes);

    // 反向金丝雀：改之前的行为（把完整会话塞进列表）到底有多大 —— 证明上面那条不是恒真。
    const legacyBytes = Buffer.byteLength(
      JSON.stringify({ items: await t.repos.sim.listSessions("demo") }),
      "utf8",
    );
    expect(legacyBytes, "金丝雀：全量列表确实是大的（否则②度量不到任何东西）").toBeGreaterThan(listBytes * 10);

    // ── ③ `SimSession` 本身一个字节没动：201 回包与 GET :id 照旧带完整世界 ──────────
    const full = oneWorld.json() as SimSession;
    expect(cellCount(full.baseSnapshot)).toBe(12_000);
    expect(full.id).toBe(bigId);
  });

  it("④ GET /a/v1/sim/sessions/:id 的 R2/R3：别租户 404、功能关闭 404", async () => {
    const t = await makeApp();
    await enableSim(t);
    const id = await createSession(t, world(2, 2));

    // R2：同一个 id，别租户读不到（不是 403 —— 「不存在」才不泄露存在性）。
    await enableSim(t, "other");
    const other = { "x-debug-user": "other:admin:admin" };
    const r2 = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${id}`, headers: other });
    expect(r2.statusCode).toBe(404);

    // R3 entitlement 先于 authz：功能关掉 ⇒ 端点不存在。
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": false } },
    });
    const r3 = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${id}`, headers: ADMIN });
    expect(r3.statusCode).toBe(404);
    expect(r3.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("⑤ R9：pg 侧 listSessionSummaries 的 SQL 与 memory 侧同口径（`base_snapshot` 不进 SELECT 列表）", () => {
    // `sim_session` 是**逐列表**，memory 全绿从不构成 pg 也行的证据（`PgSimRepo` 头注立的规矩）。
    // 这里不连库，咬的是**这条实现的两个要害**，都是能被一次手滑改没的：
    const sql = PgSimRepo.prototype.listSessionSummaries.toString();
    // ① 投影：`base_snapshot` 只许出现在**聚合函数的入参**里，不许出现在 SELECT 的输出列里。
    //    判据落在"有没有 `SELECT ... base_snapshot ...` 这个输出列"上 —— 用 `SELECT *` 或把它
    //    加回列清单，是这条实现最容易被"顺手改回去"的一手，而那一手会让 285MB 原样回来。
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql, "规模摘要必须在服务端算，不许把世界搬回进程再数").toContain("jsonb_object_keys");
    // ② bigint→string：pg 的 count()/sum() 回字符串，不 Number() 就会渲染成 `"12000"`。
    expect(sql).toContain("Number(row.obj_count)");
    expect(sql).toContain("Number(row.cell_count)");
  });
});

describe("WO-SIM-SESSIONS-PROJECTION 件二 · 播种原子性（判据落在「播完了」不是「有东西」）", () => {
  /** 把一个播完的世界打成"播到一半被容器杀掉"的样子（= 实测到的那个真实半残态）。 */
  const truncateToHalfSeeded = async (t: TestApp): Promise<void> => {
    const s = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    await t.repos.sim.deleteTicksAfter("demo", s.id, 0); // tick1..3 还没来得及写
    for (const p of await t.repos.sim.listPerturbations("demo", s.id)) {
      await t.repos.sim.deletePerturbation("demo", s.id, p.id); // 扰动还没来得及建
    }
    const scope = { ...(s.scope as Record<string, unknown>) };
    delete scope[DEMO_SIM_WORLD_COMPLETE_KEY]; // 完成标记是最后一次写 ⇒ 半残态上必然没有
    await t.repos.sim.putSession({ ...s, scope, status: "READY", curTick: 0 });
  };

  it("① 播完 → 有完成标记；② 打断到一半 → 重启检测到「不完整」并补齐（不是静默走开）；③ 补齐后世界真能用", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    // ── ① 播完就有完成标记，且守卫读它为 COMPLETE ────────────────────────────────
    const first = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(first.created).toBe(true);
    expect(first.repaired).toBe(false);
    const seeded = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect((seeded.scope as Record<string, unknown>)[DEMO_SIM_WORLD_COMPLETE_KEY]).toBe(DEMO_SIM_WORLD_TICKS);
    expect(seedWorldCompleteness(seeded)).toBe("COMPLETE");

    // 幂等：再播一次一条都不多、也不再推拍（旧行为原样保留）。
    const again = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(again.created).toBe(false);
    expect(again.repaired).toBe(false);
    expect(again.completeness).toBe("COMPLETE");
    expect(again.reason).toContain("已播完");
    expect((await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!.curTick).toBe(DEMO_SIM_WORLD_TICKS);

    // ── ② 打断到一半（= 实测的那个真实半残态），再"重启" ─────────────────────────
    await truncateToHalfSeeded(t);
    const half = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect(seedWorldCompleteness(half), "半残态必须判 INCOMPLETE").toBe("INCOMPLETE");
    // 金丝雀 —— 先自证这个半残态**真的会**让四页挑不到世界（否则下面在修一个不存在的病）：
    const halfList = (await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN }))
      .json().items as SimSessionListItem[];
    expect(halfList.filter((x) => x.status === "RUNNING"), "半残态下四页的 pickLatestRunningSession 挑不到任何世界")
      .toHaveLength(0);

    const repaired = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    // 报的是"检测到不完整 + 已补齐"，**不是**"幂等命中"（判据 2：半残不许长得像正常）。
    expect(repaired.repaired, "半残态必须被修，不许静默走开").toBe(true);
    expect(repaired.created, "补齐不是新建：库里那条世界还是原来那条").toBe(false);
    expect(repaired.reason).toContain("检测到播种不完整");
    expect(repaired.reason).not.toContain("幂等命中");

    // ── ③ 补齐后世界**真能用**：不是把标记补上就算数 ──────────────────────────────
    const fixed = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect(fixed.status).toBe("RUNNING");
    expect(fixed.curTick, "curTick 必须正好是播种目标拍数，不许在半残的 curTick 上继续累加").toBe(DEMO_SIM_WORLD_TICKS);
    expect(seedWorldCompleteness(fixed)).toBe("COMPLETE");
    // 世界线真的重铺了（tick 态行回来了、真动过、trace 非空 = 真过了传导核）。
    const tick0 = await t.repos.sim.getTickState("demo", fixed.id, 0);
    const last = await t.repos.sim.getTickState("demo", fixed.id, DEMO_SIM_WORLD_TICKS);
    expect(last, `tick${DEMO_SIM_WORLD_TICKS} 行必须重新落盘`).not.toBeNull();
    expect(last!.state, "补齐后的世界真动过（只补标记会逐字节相同）").not.toEqual(tick0!.state);
    expect(last!.trace!.length).toBeGreaterThan(0);
    // 扰动也补回来了（补齐走的是与新建**同一段**代码，不是另写一套只补拍数的）。
    expect(await t.repos.sim.listPerturbations("demo", fixed.id)).toHaveLength(1);
    // 世界与第一次播出来的**逐字节一致**（R6：补齐不是"重新算一个今天的世界"）。
    expect(fixed.baseSnapshot).toEqual(seeded.baseSnapshot);

    // 四页现在挑得到了。
    const okList = (await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN }))
      .json().items as SimSessionListItem[];
    expect(okList.filter((x) => x.status === "RUNNING")).toHaveLength(1);
  });

  it("④ 存量兼容：完成标记引入之前播下的世界（RUNNING@tick≥N 但无标记）只回填标记，**不重播**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);

    // 造一个"标记引入之前"的世界：世界本身完好，只是 scope 里没有那个键。
    const s = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    const scope = { ...(s.scope as Record<string, unknown>) };
    delete scope[DEMO_SIM_WORLD_COMPLETE_KEY];
    await t.repos.sim.putSession({ ...s, scope });
    const legacy = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect(seedWorldCompleteness(legacy), "世界本身作证已播完 ⇒ LEGACY，不是 INCOMPLETE").toBe("LEGACY");

    const r = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    // ⚠ 这一条是本单最容易做错的地方：没有 LEGACY 这一态，**所有存量部署**升级后都会被
    //   误判成半残、被重播一次 —— 那就是拿一个新字段去证伪一堆本来好好的世界。
    expect(r.repaired, "存量世界不许被当成半残重播").toBe(false);
    expect(r.created).toBe(false);
    expect(r.completeness).toBe("LEGACY");
    expect(r.reason).toContain("回填标记");
    const after = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect((after.scope as Record<string, unknown>)[DEMO_SIM_WORLD_COMPLETE_KEY]).toBe(DEMO_SIM_WORLD_TICKS);
    // 回填**不许**动世界：拍数、世界态、扰动一个字节不变。
    expect(after.curTick).toBe(DEMO_SIM_WORLD_TICKS);
    expect(after.baseSnapshot).toEqual(legacy.baseSnapshot);
    expect(await t.repos.sim.listPerturbations("demo", after.id)).toHaveLength(1);
  });

  it("⑤ 用户在种子世界上多推了几拍 ⇒ 仍判已播完（判据用 `>=` 不是 `===`，否则会把「用过」读成「没播完」）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);

    const s = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    // 用户自己推了 2 拍（合法用法）——连完成标记一起去掉，逼守卫走"世界作证"那条路。
    const scope = { ...(s.scope as Record<string, unknown>) };
    delete scope[DEMO_SIM_WORLD_COMPLETE_KEY];
    await t.repos.sim.putSession({ ...s, scope, curTick: DEMO_SIM_WORLD_TICKS + 2 });
    const used = (await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!;
    expect(seedWorldCompleteness(used), "curTick 超过目标拍数 = 用户用过，不是没播完").toBe("LEGACY");

    const r = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(r.repaired, "不许把用户推过的世界重置回 tick0").toBe(false);
    expect((await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID))!.curTick).toBe(DEMO_SIM_WORLD_TICKS + 2);
  });
});
