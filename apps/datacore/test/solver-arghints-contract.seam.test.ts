import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { GENERIC_SOLVER_CATALOG } from "../src/catalog.js";
import { knownArgKeys } from "../src/solvers/arg-aliases.js";

/**
 * ★ WO-SOLVER-ARGHINTS-DRIFT · 「目录 `argHints` ↔ 求解器实读实参」的**接缝**测试
 *   （同族门：`G-SOLVER-ARG-KEY-DRIFT`；本文件咬的是该门**自陈看不见**的那一档）。
 *
 * ── 病是什么（实测·非推理·经真实 HTTP `POST /a/v1/solvers/{key}/invoke`）────────────────
 * `argHints` 是**给 LLM 看的入参说明书**（`solvers/llm-gen.ts:41` 原文「argHints 给入参提示」，
 * 且经 `agentcore` 的 `mcp/solvers-catalog.ts:20` / `tools/executor.ts:292` **原样交给模型**）。
 * 说明书写的键与求解器真读的键对不上 ⇒ 模型照说明书填参 ⇒ 求解器拿不到必填键 ⇒ **恒 400**。
 * 修前实测四条（file:line 为求解器**实读那一行**）：
 *   · `shared_bottleneck`          目录 `{upstreamType, viaField}`；实读 `service.ts:1344-1349`
 *     `resourceType/sharedByType/viaField/capacityField/demandField/priorityField?`，
 *     `:1350` 缺前三个即 throw ⇒ **交集 1/3，两个必填键一个都没提示**。
 *   · `margin_attribution`         目录 `{itemType}`；实读 `service.ts:1518-1521`
 *     `targetType/revenueField/costFields[]/marginThreshold`，`:1522` 缺 targetType 或 costFields 即 throw
 *     ⇒ **交集 0**，且必填的结构化 `costFields:[{field,label?}]` 连提都没提。
 *   · `concentration_risk`         目录 `{rootType}`；实读 `service.ts:1409-1411`
 *     `startType/path:[{viaField,toType}]/minDependents`，`:1412` 缺前两个即 throw ⇒ **交集 0**。
 *     （`rootType` 在本求解器里根本不是入参：`:1444` 是从 `path` **末跳算出来的输出字段**。）
 *   · `supplier_disruption_radius` 目录 `{rootType, rootId}`；实读 `service.ts:4648-4650`
 *     `rootType/rootId/layers:[{type,viaField}]`，`:4651` 缺 layers 即 throw ⇒ **必填 layers 没提示**。
 *
 * ── 三态定性（铁律 0.5·三种「不工作」修法完全不同）────────────────────────────────────
 * **不是**「没接线」：四个求解器都真读真算（下面每条的金丝雀给出真实答案，非 200 状态门）。
 * **不是**「接了线没数据」：同一夹具用**实读的键**调用，四条全出非平凡答案。
 * **是**「**接了线接错地方**」—— 键送到了 `Record<string, unknown>`，只是**名字对不上**被静默吞掉，
 * 而这四个的必填键缺失会直接 throw ⇒ 比静默错答更早暴露，但**只有真调用才看得见**。
 *
 * ── 为什么修法不是加别名（`solvers/arg-aliases.ts`），两条独立理由 ──────────────────────
 * ① **表达不了**：`upstreamType` 要映到**两个不同类型**（`resourceType` 资源 + `sharedByType` 共享方），
 *    1→2 别名机制没有这个形状；`itemType` 要额外补一个**不存在的结构化数组** `costFields`，
 *    别名只能搬运已有的值、造不出新参数。别名治的是「同一概念两个键名」（该文件头注原文）。
 * ② **根本到不了**：`normalizeSolverArgs` 的唯一挂载点在 `SolverService.compute()`（`service.ts:5642`），
 *    而这四个求解器在 `invoke()` 里**先于 compute 被拦截**（`service.ts:5877-5879` / `:5885`）⇒
 *    即便登记了别名，归一那一步**一次都不会执行**。（追一层实测，非 grep 直读。）
 *
 * ── 与既有门 `solver-arg-key-drift:check` 的分工（本文件为何非有不可）──────────────────
 * 那道门的 `isRead()` 判据是「**全仓求解器源里有没有人读这个键名**」，**不是**「这个求解器读不读」
 * （门脚本自己的「已知局限」注释原文）。于是：
 *   · `margin_attribution.itemType` 被 `selection_optimize`/`packing_optimize` 读 ⇒ 门**看不见**；
 *   · `concentration_risk.rootType` 被 `supplier_disruption_radius`/`generic_inference` 读 ⇒ 门**看不见**；
 *   · `supplier_disruption_radius` **漏掉必填 `layers`** 属「少声明」，那道门只查「声明了的键到不到得了」，
 *     **结构上查不出漏声明**。
 * ⇒ 静态门粒度粗、覆盖面广；本文件**真调用、按求解器分别咬**，正好补上这三类。
 *
 * ── 判据刻意不是「有没有这些键」，是「只照说明书填参，求解器认不认」────────────────────
 * 硬编码一份键名清单会随下一次改名再次漂移，且改的人不会想起来同步它。
 * 本文件的判据是**行为**：`pick(真值组, 目录声明的键) → 真 HTTP invoke → 不许是 VALIDATION_ERROR`。
 * 「必填键没被提示」「提示了求解器不认的键」两种形态都天然落进这个判据，
 * 且新增通用求解器**自动进入覆盖**（§3 强制它要么被驱动、要么写明为何驱动不了）。
 *
 * ── 反假绿设计（铁律 0.6：扫描/判定类结论一律先自证工具）────────────────────────────
 * §0a **正金丝雀**：用**实读的键**（真值组全集）调用，四条必须各自给出**非平凡的真实答案**
 *      （瓶颈是「化成」/ 敞口 3 / 倒挂 2 单 / 半径 3 层），而不是「HTTP 200」。
 *      任一不成立 ⇒ 报「**夹具/工具坏了**」，**不许**读作「求解器漂了」——两者处置相反。
 * §0b **负金丝雀（防断言空转）**：把 `shared_bottleneck` 的**历史漂移目录** `{upstreamType, viaField}`
 *      喂进**与主判据完全相同的那一条 `pick + invoke` 路径**，断言它**必须** 400 VALIDATION_ERROR。
 *      这条证明 §1 的绿不是空转出来的；它与主判据**共用同一份实现**，不另抄一条调用路径。
 */

// ---------------------------------------------------------------------------
// 夹具 · 一张自足的对象图（不依赖 demo 种子的类型名，故对种子改动免疫）
// ---------------------------------------------------------------------------

const SUPPLIER = "华东电解液";

async function seedArgHintsGraph(t: TestApp): Promise<void> {
  const ot = (key: string, props: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string }[]) =>
    t.repos.ontologyTypes.put({
      id: `ot_${key}`, tenantId: "demo", key, displayName: key, domain: "x", version: 1,
      status: "ACTIVE", derivedProperties: [], sourceBindings: [],
      properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
    });
  const obj = (id: string, type: string, props: Record<string, unknown>) =>
    t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId: "demo", type, props });

  // 共享瓶颈 + 毛利倒挂：AhResource ← AhSharer（一张类型同时承载产能维与损益维，同 e2e 夹具口径）
  await ot("AhResource", [
    { propKey: "resId", dataType: "string", isPrimaryKey: true },
    { propKey: "capacity", dataType: "number" },
  ]);
  await ot("AhSharer", [
    { propKey: "sharerId", dataType: "string", isPrimaryKey: true },
    { propKey: "resRef", dataType: "ref", refToTypeKey: "AhResource" },
    { propKey: "qty", dataType: "number" },
    { propKey: "prio", dataType: "number" },
    { propKey: "revenue", dataType: "number" },
    { propKey: "rawCost", dataType: "number" },
    { propKey: "freight", dataType: "number" },
  ]);
  await obj("ah_r1", "AhResource", { resId: "化成", capacity: 10 });
  await obj("ah_s1", "AhSharer", { sharerId: "星辰", resRef: "化成", qty: 7, prio: 3, revenue: 100, rawCost: 120, freight: 5 });
  await obj("ah_s2", "AhSharer", { sharerId: "蓝海", resRef: "化成", qty: 8, prio: 2, revenue: 100, rawCost: 130, freight: 4 });

  // 隐性集中度 + 断供半径：AhCustomer → AhOrder → AhMaterial → AhSupplier（三跳收敛到一根）
  await ot("AhSupplier", [{ propKey: "supId", dataType: "string", isPrimaryKey: true }]);
  await ot("AhMaterial", [
    { propKey: "matId", dataType: "string", isPrimaryKey: true },
    { propKey: "supplierRef", dataType: "ref", refToTypeKey: "AhSupplier" },
  ]);
  await ot("AhOrder", [
    { propKey: "soId", dataType: "string", isPrimaryKey: true },
    { propKey: "materialRef", dataType: "ref", refToTypeKey: "AhMaterial" },
  ]);
  await ot("AhCustomer", [
    { propKey: "custId", dataType: "string", isPrimaryKey: true },
    { propKey: "orderRef", dataType: "ref", refToTypeKey: "AhOrder" },
  ]);
  await obj("ah_sup1", "AhSupplier", { supId: SUPPLIER });
  await obj("ah_m1", "AhMaterial", { matId: "正极A", supplierRef: SUPPLIER });
  await obj("ah_m2", "AhMaterial", { matId: "电解液B", supplierRef: SUPPLIER });
  for (const [so, mat] of [["SO1", "正极A"], ["SO2", "电解液B"], ["SO3", "正极A"]] as const) {
    await obj(`ah_${so}`, "AhOrder", { soId: so, materialRef: mat });
  }
  for (const [cust, so] of [["星辰", "SO1"], ["蓝海", "SO2"], ["远景", "SO3"]] as const) {
    await obj(`ah_c_${cust}`, "AhCustomer", { custId: cust, orderRef: so });
  }
}

// ---------------------------------------------------------------------------
// 真值组 · 「用求解器**真读的键**调用，能算出真实答案」的那一组实参
//   —— 这是本文件唯一的手写数据，且它是**夹具**（值），不是被验对象（键的清单）。
//      §1 从中**按目录声明的键切片**，故目录漂了必然切不出必填键 → 400 → 红。
// ---------------------------------------------------------------------------

const CONCENTRATION_PATH = [
  { viaField: "orderRef", toType: "AhOrder" },
  { viaField: "materialRef", toType: "AhMaterial" },
  { viaField: "supplierRef", toType: "AhSupplier" },
];

const WORKING_ARGS: Record<string, Record<string, unknown>> = {
  shared_bottleneck: {
    resourceType: "AhResource", sharedByType: "AhSharer", viaField: "resRef",
    capacityField: "capacity", demandField: "qty", priorityField: "prio",
  },
  concentration_risk: { startType: "AhCustomer", path: CONCENTRATION_PATH, minDependents: 2 },
  margin_attribution: {
    targetType: "AhSharer", revenueField: "revenue",
    costFields: [{ field: "rawCost", label: "原料" }, { field: "freight", label: "运费" }],
    marginThreshold: 0,
  },
  supplier_disruption_radius: {
    rootType: "AhSupplier", rootId: SUPPLIER,
    layers: [
      { type: "AhMaterial", viaField: "supplierRef" },
      { type: "AhOrder", viaField: "materialRef" },
      { type: "AhCustomer", viaField: "orderRef" },
    ],
  },
};

/**
 * 驱动不了的通用求解器 —— **必须逐条写明为什么**，不许静默跳过。
 *
 * ⚠ 诚实位（铁律 0.6「我没找到 ≠ 它不存在」）：本表**不是**「这些求解器的 argHints 是干净的」的断言。
 *   恰恰相反，`scripts/check-solver-arg-key-drift.mjs` 的 `KNOWN_DRIFT` 里已登记了其中多条 REAL-DRIFT
 *   （`assignment_optimize.bins` / `sequencing_optimize.jobs+changeover` / `facility_location.serveCost`
 *   / `set_cover.subsets` / `optimize_whatif.templateKey+perturbation`）。它们只是**用本文件的判据验不了**。
 */
const NOT_DRIVEN: Record<string, string> = {
  generic_inference:
    "需本体派生引擎 + 真实对象 id 才能重算（`service.ts:990` genericInference 走 recompute，非纯对象图）；" +
    "其目录键 `apply` 已追一层确认与 `service.ts:993` 实读一致，不属本单缺陷。",
  // 下面这一族：无 CP-SAT sidecar 时求解器在**参数校验通过之后**另抛一条
  // 「未接入最优化引擎（设 OPTIMIZER_BASE_URL）」的 VALIDATION_ERROR（如 `service.ts:4692`）
  // ⇒ 本文件「不许是 VALIDATION_ERROR」这个判据在它们身上**分辨不了「漂移」与「没 sidecar」**，
  //   强行驱动只会把两种定性完全不同的红混成一种。故不驱动，留给能起 sidecar 的单。
  selection_optimize: "需 CP-SAT sidecar（OPTIMIZER_BASE_URL）；无 sidecar 时错误码与漂移同为 VALIDATION_ERROR，判据分辨不了",
  assignment_optimize: "同上（CP-SAT sidecar）",
  sequencing_optimize: "同上（CP-SAT sidecar）",
  packing_optimize: "同上（CP-SAT sidecar）",
  job_shop_schedule: "同上（CP-SAT sidecar）",
  facility_location: "同上（CP-SAT sidecar）",
  min_cost_flow: "同上（CP-SAT sidecar）",
  set_cover: "同上（CP-SAT sidecar）",
  independent_set: "同上（CP-SAT sidecar）",
  combinatorial_auction: "同上（CP-SAT sidecar）",
  optimize_whatif: "同上（CP-SAT sidecar）+ 需 OntologyBinding 绑定",
  multi_objective: "同上（CP-SAT sidecar）",
  cross_object_occupancy: "同上（CP-SAT sidecar）",
};

// ---------------------------------------------------------------------------
// 唯一一条调用路径 —— §0b 负金丝雀与 §1 主判据**共用**它（抄第二份 = 金丝雀变装饰品）
// ---------------------------------------------------------------------------

interface InvokeOutcome {
  statusCode: number;
  code: string | null;
  message: string;
  data: Record<string, unknown>;
  sentKeys: string[];
}

/** 按 `hintKeys` 从真值组切片 → 真 HTTP invoke。切不到的键**不补**（那正是「说明书没提示」的现场）。 */
async function invokeWithHintKeys(t: TestApp, solverKey: string, hintKeys: string[]): Promise<InvokeOutcome> {
  const full = WORKING_ARGS[solverKey] ?? {};
  const args: Record<string, unknown> = {};
  for (const k of hintKeys) if (k in full) args[k] = full[k];
  const res = await t.app.inject({
    method: "POST", url: `/a/v1/solvers/${encodeURIComponent(solverKey)}/invoke`,
    headers: ADMIN, payload: { args },
  });
  const body = res.json() as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
  return {
    statusCode: res.statusCode,
    code: body.error?.code ?? null,
    message: body.error?.message ?? "",
    data: body.data ?? {},
    sentKeys: Object.keys(args),
  };
}

const hintKeysOf = (solverKey: string): string[] =>
  Object.keys(GENERIC_SOLVER_CATALOG.find((x) => x.key === solverKey)?.argHints ?? {});

const DRIVEN = Object.keys(WORKING_ARGS).sort();

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
  await seedArgHintsGraph(t);
}, 120_000);

// ---------------------------------------------------------------------------
// §0a 正金丝雀 —— 先证明夹具与求解器都是活的，再谈「目录对不对」
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ARGHINTS-DRIFT §0a · 正金丝雀（夹具自证·不成立则报「工具坏了」不许报「求解器漂了」）", () => {
  const BROKEN = (k: string) =>
    `金丝雀失败：用 ${k} **真读的键**（真值组全集）都算不出预期答案 ⇒ **夹具/求解器坏了，不是目录漂了**。` +
    `本次 §1 的结论一律作废，不许读作「目录干净」或「求解器全漂」。`;

  it("shared_bottleneck 用实读键 → 真瓶颈「化成」+ 低优先级者被降级（非 200 状态门）", async () => {
    const r = await invokeWithHintKeys(t, "shared_bottleneck", Object.keys(WORKING_ARGS.shared_bottleneck!));
    expect(r.statusCode, `${BROKEN("shared_bottleneck")} 实收 ${r.code}: ${r.message}`).toBe(200);
    const out = r.data as { bottlenecks: { resourceId: string }[]; downgraded: { objectId: string }[] };
    expect(out.bottlenecks.map((b) => b.resourceId), BROKEN("shared_bottleneck")).toEqual(["化成"]);
    expect(out.downgraded.map((d) => d.objectId), BROKEN("shared_bottleneck")).toEqual(["蓝海"]);
  });

  it("concentration_risk 用实读键 → 三个客户经三跳全收敛到同一供应商（敞口 3）", async () => {
    const r = await invokeWithHintKeys(t, "concentration_risk", Object.keys(WORKING_ARGS.concentration_risk!));
    expect(r.statusCode, `${BROKEN("concentration_risk")} 实收 ${r.code}: ${r.message}`).toBe(200);
    const out = r.data as { topExposure: { rootId: string; count: number } | null };
    expect(out.topExposure?.rootId, BROKEN("concentration_risk")).toBe(SUPPLIER);
    expect(out.topExposure?.count, BROKEN("concentration_risk")).toBe(3);
  });

  it("margin_attribution 用实读键 → 2 单倒挂且主驱动是「原料」（两个成本项真被拆开）", async () => {
    const r = await invokeWithHintKeys(t, "margin_attribution", Object.keys(WORKING_ARGS.margin_attribution!));
    expect(r.statusCode, `${BROKEN("margin_attribution")} 实收 ${r.code}: ${r.message}`).toBe(200);
    const out = r.data as { inverted: { id: string }[]; rootDrivers: { label: string }[] };
    expect(out.inverted.map((x) => x.id).sort(), BROKEN("margin_attribution")).toEqual(["星辰", "蓝海"].sort());
    expect(out.rootDrivers[0]?.label, BROKEN("margin_attribution")).toBe("原料");
  });

  it("supplier_disruption_radius 用实读键 → 半径 3 层 · 叶层 3 个客户", async () => {
    const r = await invokeWithHintKeys(t, "supplier_disruption_radius", Object.keys(WORKING_ARGS.supplier_disruption_radius!));
    expect(r.statusCode, `${BROKEN("supplier_disruption_radius")} 实收 ${r.code}: ${r.message}`).toBe(200);
    const out = r.data as { radius: number; leafCount: number };
    expect(out.radius, BROKEN("supplier_disruption_radius")).toBe(3);
    expect(out.leafCount, BROKEN("supplier_disruption_radius")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §0b 负金丝雀 —— 证明 §1 的判据真的会红（防「断言空转」）
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ARGHINTS-DRIFT §0b · 负金丝雀（把历史漂移目录喂进**同一条**判据路径，必须红）", () => {
  it("★ 历史目录 `{upstreamType, viaField}` 经 §1 同款 pick+invoke → **必须** 400 VALIDATION_ERROR", async () => {
    // 这正是修前 `catalog.ts` 对 shared_bottleneck 的原文声明。
    const r = await invokeWithHintKeys(t, "shared_bottleneck", ["upstreamType", "viaField"]);
    expect(r.sentKeys, "历史目录只有 viaField 能落到真读键上（upstreamType 求解器根本不认）").toEqual(["viaField"]);
    expect(
      r.statusCode,
      "判据空转了：照历史漂移目录填参竟然没红 ⇒ §1 的绿证明不了任何事，必须先修本测试而不是宣布通过",
    ).toBe(400);
    expect(r.code).toBe("VALIDATION_ERROR");
    expect(r.message).toContain("shared_bottleneck 需 resourceType/sharedByType/viaField");
  });
});

// ---------------------------------------------------------------------------
// §1 主判据 · 充分性 —— 只照说明书填参，求解器必须认
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ARGHINTS-DRIFT §1 · 只传目录 `argHints` 声明的键，求解器不许拒（必填键必须被提示）", () => {
  for (const solverKey of DRIVEN) {
    it(`★ ${solverKey}：pick(真值组, argHints 声明的键) → 不许 VALIDATION_ERROR`, async () => {
      const hints = hintKeysOf(solverKey);
      expect(hints.length, `${solverKey} 在 GENERIC_SOLVER_CATALOG 里声明了 0 个 argHints —— 模型无从填参`).toBeGreaterThan(0);
      const r = await invokeWithHintKeys(t, solverKey, hints);
      expect(
        r.statusCode,
        `目录 argHints 声明 {${hints.join(", ")}}，其中只有 {${r.sentKeys.join(", ")}} 是 ${solverKey} 真读的键，` +
          `照说明书填参被求解器拒绝：${r.code} ${r.message}。` +
          `修：改 apps/datacore/src/catalog.ts 的 argHints 为求解器真读的那组键（含必填标注与结构形状），` +
          `**不是**去改求解器，也**不是**加别名（别名挂在 compute() 上，这些求解器在 invoke() 里先被拦截，归一根本不执行）。`,
      ).toBe(200);
      expect(r.code).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// §2 主判据 · 有效性 —— 不许声明求解器根本不读的键（「空头支票」形态）
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ARGHINTS-DRIFT §2 · argHints 里不许有求解器不读的键（§1 切片时会被静默丢掉，故需单独咬）", () => {
  it("★ 每个被驱动求解器：声明的键 ⊆ 真读键 ∪ 生产别名表登记键", () => {
    const bad: string[] = [];
    for (const solverKey of DRIVEN) {
      const real = new Set(Object.keys(WORKING_ARGS[solverKey]!));
      const aliased = knownArgKeys(solverKey); // 与生产同一份表（`arg-aliases.ts`），不另抄
      for (const hint of hintKeysOf(solverKey)) {
        if (!real.has(hint) && !aliased.has(hint)) bad.push(`${solverKey}.${hint}`);
      }
    }
    expect(
      bad,
      "目录声明了求解器**不读**的键 —— 模型会照它填一个没人看的参数（空头支票）。" +
        "这一档 §1 咬不到（切片时被丢掉、剩下的必填键仍然齐全），故必须单列。",
    ).toEqual([]);
  });

  it("金丝雀：真读键集合非空且确实来自真值组（否则上一条是拿空集比空集）", () => {
    for (const solverKey of DRIVEN) {
      expect(Object.keys(WORKING_ARGS[solverKey]!).length, `${solverKey} 真值组为空 ⇒ §2 退化成恒真`).toBeGreaterThan(0);
      expect(hintKeysOf(solverKey).length, `${solverKey} 目录 argHints 为空 ⇒ §2 退化成恒真`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 覆盖 —— 新增通用求解器**自动进入**本门射程（要么被驱动，要么写明为何驱动不了）
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ARGHINTS-DRIFT §3 · 覆盖面自证（新增通用求解器不许悄悄绕过本测试）", () => {
  it("★ GENERIC_SOLVER_CATALOG 每一条：要么在真值组里被真调用，要么在 NOT_DRIVEN 里写明理由", () => {
    const uncovered = GENERIC_SOLVER_CATALOG.map((x) => x.key)
      .filter((k) => !(k in WORKING_ARGS) && !(k in NOT_DRIVEN));
    expect(
      uncovered,
      "新增的通用求解器既没进真值组、也没登记为「驱动不了 + 理由」⇒ 它的 argHints 无人验。" +
        "两条出路：① 在 WORKING_ARGS 里补一组真读实参（推荐）；② 在 NOT_DRIVEN 里写明**具体**为何驱动不了。",
    ).toEqual([]);
  });

  it("金丝雀：目录条数 > 0 且真值组/未驱动表的键都真的在目录里（防「拿空目录报全覆盖」）", () => {
    const catalogKeys = new Set(GENERIC_SOLVER_CATALOG.map((x) => x.key));
    expect(catalogKeys.size, "GENERIC_SOLVER_CATALOG 抽出 0 条 ⇒ 上一条恒真，是工具坏了").toBeGreaterThan(0);
    const stale = [...DRIVEN, ...Object.keys(NOT_DRIVEN)].filter((k) => !catalogKeys.has(k));
    expect(stale, "本文件登记了目录里已不存在的求解器（目录改名/删除后本文件没跟上）").toEqual([]);
  });
});
