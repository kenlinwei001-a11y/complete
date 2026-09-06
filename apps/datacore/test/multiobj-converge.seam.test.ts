import { describe, expect, it } from "vitest";
import { makeApp, debugUser } from "./helpers.js";
import {
  ParetoAssembleResultSchema,
  declaredObjectiveKeys,
  deriveParetoMetrics,
  normalizeParetoWeights,
  type ParetoAssembleResult,
  type ParetoResult,
} from "@platform/contracts";

/**
 * WO-MULTIOBJ-CONVERGE · **两个多目标界面同轴同数**的接缝门。
 *
 * ══ 今天的行为是 X，应该是 Y（开工实测，本机 4711 内存态 demo 租户，SEED_DEMO=1）══════
 *
 * **X**：同一租户、同一批订单，平台上两个多目标界面各算各的 ——
 *   `/v/sim-optimize`（方案寻优）最优解营收 **244.59 亿 / 获排率 21.6%**；
 *   `/v/global-sim` 的「多目标联合 WHAT-IF」**39.49 亿**。差 **6.19 倍**，屏上无一处说得清。
 *   拆开：**覆盖子集 7.331×**（后者只取分页第一页 50/500 单）× **获排比例 0.845×** = 6.19。
 *   两边的轴集合、粒度、成本口径也全不同（后者的违约金/换型成本出自前端自定系数）。
 *
 * **Y（本门驱动的那条缝）**：两条路都从**同一个装配出口**取模型，
 *   轴读数都由契约包里**唯一那份** `deriveParetoMetrics` 折出来 ⇒
 *   **同一组权重下，同一根轴上两条路的读数必须逐字节相等**。
 *
 * ══ 这道门咬的是链路不是函数 ═══════════════════════════════════════════════════
 * 三跳全走 HTTP 路由（`app.inject`），中间那份请求体**不是测试写的、是上一跳回的**：
 *   ① `POST …/optimize-pareto/assemble` → `ParetoRequest`
 *   ② A 路：把它原样 `POST …/optimize-pareto` → 前沿 + 名次 → 取推荐解的 `metrics`
 *   ③ B 路：把推荐解的杠杆档位施加到同一份 `args` → `POST /a/v1/solvers/<族>/invoke`
 *          → 用 `deriveParetoMetrics` 折读数
 * ②③ 两条路**互不引用对方的回包**，走到同一个数才算数。
 *
 * ⚠ 同族既有测试全喂 mock 引擎、只咬「传下去了吗」，咬不到「算得对不对」——
 *   本门刻意走**内存态真求解器**（InProc 确定性贪心），不注入任何 mock optimizer。
 *
 * ══ 变异反证（写下来，好让下一个人验这门不是装饰品）══════════════════════════════
 * 把 B 路那一行 `deriveParetoMetrics(raw, declared)` 换回「前端自己折一遍」的任一变体 ——
 * 例如营收改读 `raw.objectiveValues.revenue` 却漏掉 `q()` 量化、或 `serviceRate` 自己再除一遍、
 * 或按旧口径 `qty × 800` 造一根换型成本 —— 用例 ① 当场红。实测已验（见本单报告）。
 *
 * ══ R14 反硬编码：本门的本体里没有一个电池/基地字样 ══════════════════════════════
 * 类型叫 `TicketOrder`/`Coach`（沿用 `opt-pareto-assemble.seam.test.ts` 的售票世界）。
 */

const T = "acme";
const ACME = debugUser(T, "admin", "admin");
type App = Awaited<ReturnType<typeof makeApp>>;

const putType = (
  t: App,
  key: string,
  props: { propKey: string; dataType: string; isPrimaryKey?: boolean; unit?: string }[],
) =>
  t.repos.ontologyTypes.put({
    id: `ot_${T}_${key}`, tenantId: T, key, displayName: key, domain: "x", version: 1, status: "ACTIVE",
    derivedProperties: [], sourceBindings: [],
    properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
  });
const putObj = (t: App, type: string, id: string, props: Record<string, unknown>) =>
  t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId: T, type, props });

/** 售票世界：总需求 41 > 三节车厢最小档合计 30 ⇒ 产能真不够用 ⇒ 前沿上有真权衡。 */
async function seedTicketWorld(t: App): Promise<void> {
  await putType(t, "TicketOrder", [
    { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
    { propKey: "seatQty", dataType: "number" },
    { propKey: "farePrice", dataType: "number" },
    { propKey: "refundCost", dataType: "number" },
  ]);
  await putType(t, "Coach", [
    { propKey: "coachId", dataType: "string", isPrimaryKey: true },
    { propKey: "seatCapacity", dataType: "number" },
    { propKey: "runCost", dataType: "number" },
  ]);
  for (const [id, seatQty, farePrice, refundCost] of [
    ["o1", 12, 100, 50], ["o2", 8, 60, 5], ["o3", 15, 90, 40], ["o4", 6, 30, 30],
  ] as [string, number, number, number][]) {
    await putObj(t, "TicketOrder", id, { ticketNo: id, seatQty, farePrice, refundCost });
  }
  for (const [id, seatCapacity, runCost] of [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]] as [string, number, number][]) {
    await putObj(t, "Coach", id, { coachId: id, seatCapacity, runCost });
  }
}

const enableSim = (t: App) =>
  t.app.inject({ method: "PUT", url: `/a/v1/tenants/${T}/features`, headers: ACME, payload: { overrides: { "sim.sandbox": true, "opt.solver-pool": true, "opt.multiobj": true } } });

/** 杠杆档位 → 施加到 args（与前端面板 `applyLevers` 同一套接地语法，也与后端 `data_override` 同源）。 */
function applyLevers(args: Record<string, unknown>, levers: readonly { key: string; value: number }[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  for (const l of levers) {
    const m = /^(.+)\.(.+)\.(.+)$/.exec(l.key);
    if (!m) continue;
    const [, coll, id, field] = m;
    const rows = next[coll!];
    if (!Array.isArray(rows)) continue;
    next[coll!] = rows.map((r) =>
      r !== null && typeof r === "object" && (r as { id?: unknown }).id === id ? { ...(r as object), [field!]: l.value } : r,
    );
  }
  return next;
}

async function setup(): Promise<{ t: App; req: NonNullable<Extract<ParetoAssembleResult, { applicable: true }>["request"]> }> {
  const t = await makeApp();
  await enableSim(t);
  await seedTicketWorld(t);
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto/assemble", headers: ACME, payload: {} });
  expect(r.statusCode, `装配口不通 ⇒ 本门测的是别的东西：${r.body}`).toBe(200);
  const parsed = ParetoAssembleResultSchema.safeParse(JSON.parse(r.body));
  expect(parsed.success, `装配回包过不了契约：${r.body}`).toBe(true);
  const res = parsed.success ? parsed.data : undefined;
  expect(res?.applicable, `装不出来：${r.body}`).toBe(true);
  if (!res || res.applicable !== true) throw new Error("unreachable");
  return { t, req: res.request };
}

/** A 路：整份请求原样求解，回前沿 + 名次。 */
async function readA(t: App, req: unknown, weights: Record<string, number>): Promise<ParetoResult> {
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/sim/optimize-pareto", headers: ACME,
    payload: { ...(req as object), weights },
  });
  expect(r.statusCode, `A 路求解失败：${r.body}`).toBe(200);
  return JSON.parse(r.body) as ParetoResult;
}

/** B 路：同一份 args + 推荐解的杠杆档位 → 真求解器 → 契约包唯一那份读数折算。 */
async function readB(
  t: App,
  req: { family: string; args: Record<string, unknown>; objectives: readonly { key: string; dir: "min" | "max" }[] },
  levers: readonly { key: string; value: number }[],
): Promise<Record<string, number>> {
  const args = applyLevers(req.args, levers);
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/solvers/${req.family}/invoke`, headers: ACME, payload: { args },
  });
  expect(r.statusCode, `B 路求解失败：${r.body}`).toBe(200);
  const raw = (JSON.parse(r.body) as { data: Record<string, unknown> }).data;
  return deriveParetoMetrics(raw, declaredObjectiveKeys(req.objectives as never));
}

describe("WO-MULTIOBJ-CONVERGE · 两个多目标界面同轴同数", () => {
  it("⓪ 金丝雀：装置先自证（两条路各自真的跑起来了，且轴集合非空）", async () => {
    const { t, req } = await setup();
    expect(req.objectives.length, "轴集合是空的 ⇒ 下面每条相等断言都是空转").toBeGreaterThanOrEqual(2);
    // 缺席位必须在册：少一根轴而屏上什么都不说，会被读成「这一维没问题」。
    const gapKeys = (req.unavailableObjectives ?? []).map((g) => g.key);
    expect(gapKeys, "现金这一根本族答不了，不许悄悄消失").toContain("cash");
    expect(gapKeys, "换型成本本族没有次序、答不了，必须点名报缺而不是留白").toContain("changeover");
    const res = await readA(t, req, normalizeParetoWeights(req.objectives, undefined));
    expect(res.frontier.length, "前沿是空的 ⇒ 没有可比的解").toBeGreaterThan(0);
    expect(res.iterations, "账不平：iterations ≠ frontier + dominated + residual")
      .toBe(res.frontier.length + res.dominated.length + res.residual);
  });

  it("① 同一组权重 ⇒ 同一根轴上，A 路与 B 路读数逐字节相等（本门的存在理由）", async () => {
    const { t, req } = await setup();
    for (const w of [
      normalizeParetoWeights(req.objectives, undefined),
      normalizeParetoWeights(req.objectives, { revenue: 8, cost: 1 }),
      normalizeParetoWeights(req.objectives, { cost: 8, revenue: 1 }),
    ]) {
      const res = await readA(t, req, w);
      const picked = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
      expect(picked, "没有推荐解 ⇒ 无从比较").toBeDefined();
      if (!picked) continue;
      const b = await readB(t, req as never, picked.levers);
      for (const o of req.objectives) {
        expect(
          b[o.key],
          `轴 '${o.key}' 两条路读数不等：方案寻优 ${picked.metrics[o.key]} vs 多目标面板 ${b[o.key]}`
            + `（同一份 args、同一组杠杆档位 —— 不等就说明有人另写了一份读数折算）`,
        ).toBe(picked.metrics[o.key]);
      }
    }
  });

  it("② 权重真的在起作用：换一组权重换出一个不同的推荐解，而**前沿成员一条不变**", async () => {
    const { t, req } = await setup();
    const lo = await readA(t, req, normalizeParetoWeights(req.objectives, { revenue: 32, cost: 0 }));
    const hi = await readA(t, req, normalizeParetoWeights(req.objectives, { revenue: 0, cost: 32 }));
    // 前沿是解集，与权重无关（契约红线：权重进 args 会把多目标退化成单目标最优点轨迹）。
    expect(hi.frontier.map((s) => s.id).sort(), "换权重换掉了前沿成员 ⇒ 权重流进了 args").toEqual(
      lo.frontier.map((s) => s.id).sort(),
    );
    // 而名次必须真的会变（不变 ⇒ 滑杆是死的，屏上那根「偏好」没有落点）。
    expect(hi.ranking.map((r) => r.id), "两组极端权重给出同一份名次 ⇒ 权重没接线").not.toEqual(lo.ranking.map((r) => r.id));
  });

  it("③ 确定性 R6：同输入重跑，两条路的读数逐字节一致", async () => {
    const { t, req } = await setup();
    const w = normalizeParetoWeights(req.objectives, undefined);
    const once = async (): Promise<string> => {
      const res = await readA(t, req, w);
      const picked = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId)!;
      return JSON.stringify({ a: picked.metrics, b: await readB(t, req as never, picked.levers) });
    };
    expect(await once()).toBe(await once());
  });
});
