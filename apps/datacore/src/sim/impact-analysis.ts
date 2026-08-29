/**
 * WO-IMPACT-PROPAGATION · 影响传播统一入口（Enterprise Decision Twin §14 / PRD E5）。
 *
 * ── 这个文件**不是**一个新引擎 ──────────────────────────────────────────────
 * `docs/WO-IMPACT-PROPAGATION-inventory.md` 逐条盘完了存量：全平台 13 处 `affectedObjects`
 * 里只有一处是真算法（`ontology-core.ts:341 recompute`），另两处是它的包装
 * （`POST /a/v1/inference/whatif` · `generic_inference` 求解器），其余是空值占位与业务字段。
 *
 * 本文件做的是 PRD `docs/PRD-enterprise-decision-twin.md:357` 那一句：
 *   > **想要的 `impact-analysis` = 栈 B 的传播算法 × 栈 A 的世界隔离。两边各有一半，缝在中间。**
 * —— 把栈 B（`recompute`）跑在栈 A（`SimSession`）的世界里，再把结果按四类分项。
 *
 * ── 纪律：四个「0」不是同一个 0 ────────────────────────────────────────────
 * 本文件里**没有一处**用裸 `0` 表示「没影响」。每一维要么 `available:false` + 原因，
 * 要么 `available:true` + `count` + **`universe`（全域基数）**。
 * 缺 `universe` 时 `count:0` 无法区分「台账空」与「查过了没中」—— 那是静默错答。
 *
 * R4：全程 `dryRun:true`，不落库、不 mutate 真对象。
 * R6：无 `Date.now`/随机；所有明细按稳定键排序。
 * R14：零业务常数 —— KPI 类型由**结构**（同时有 `target`/`actual`）判定，不写死 `"Metric"`。
 */
import type {
  AffectedDecisionItem,
  AffectedKpiItem,
  AffectedObjectItem,
  AffectedProcessItem,
  ImpactAnalysisRequest,
  ImpactAnalysisResponse,
  TickState,
} from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../domain.js";
import { notFound } from "../errors.js";
import type { OntologyCoreService } from "../ontology-core.js";
import type { Repos } from "../repo/repo.js";

/**
 * KPI 承载类型的结构判据（R14）。
 *
 * 一个对象类型同时具备 `target`（目标）与 `actual`（实际）⇒ 它承载 KPI。
 * 这两个词是**平台元语义**（有目标、有实际，才谈得上达成/缺口），不是行业科目。
 * 对比：写死 `key === "Metric"` 就把锂电种子的命名固化进引擎，换行业当场失效。
 */
const KPI_REQUIRED_PROPS = ["target", "actual"] as const;

/** 明细数组统一按稳定键排序（R6：同输入 → 字节级同输出）。 */
const byKey = <T>(items: T[], key: (x: T) => string): T[] =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** 截断到 limit，同时如实报出是否截断（`count` 永远是全量）。 */
function envelope<T>(all: T[], universe: number, limit: number): {
  available: true;
  count: number;
  universe: number;
  items: T[];
  truncated: boolean;
} {
  return {
    available: true,
    count: all.length,
    universe,
    items: all.slice(0, limit),
    truncated: all.length > limit,
  };
}

export interface ImpactAnalysisDeps {
  repos: Repos;
  ontologyCore: OntologyCoreService;
}

/**
 * 跑一次影响传播分析。
 *
 * @throws `notFound("sim world")` —— `worldId` 不存在**或**属于别的租户（R2 暗发：
 *   别人的世界对你不存在，故 404 而非 403；仓储层 `getSession(tenantId, id)` 已保证跨租户返 null）。
 */
export async function analyzeImpact(
  deps: ImpactAnalysisDeps,
  ctx: AuthCtx,
  req: ImpactAnalysisRequest,
): Promise<ImpactAnalysisResponse> {
  const { repos, ontologyCore } = deps;
  const limit = req.limit;
  const warnings: string[] = [];

  // ── ① 栈 A：取世界（R2 隔离由仓储保证）────────────────────────────────────
  const world = await repos.sim.getSession(ctx.tenantId, req.worldId);
  if (!world) throw notFound("sim world");
  const worldState: TickState =
    (await repos.sim.getTickState(ctx.tenantId, world.id, world.curTick))?.state ?? world.baseSnapshot;

  // 世界态 → recompute 的 apply 覆盖层。
  // ⚠ `SimTickState.state` 是 `objectId → stateVar → number`（`contracts/sim.ts:15`），
  //   只承载**状态变量**，不是完整对象图。世界为空时叠加 0 条 ⇒ 这次分析实质跑在真本体值上，
  //   那**不是**世界隔离 —— 故如实报 `worldOverlayApplied`，不默默退化。
  const overlay: { objectId: string; prop: string; value: unknown }[] = [];
  for (const objectId of Object.keys(worldState).sort()) {
    const vars = worldState[objectId] ?? {};
    for (const prop of Object.keys(vars).sort()) overlay.push({ objectId, prop, value: vars[prop] });
  }
  if (overlay.length === 0) {
    warnings.push(
      `世界 ${world.id} 的态为空（baseSnapshot/tick 态均无对象），本次分析实质跑在真本体当前值上，未发生世界隔离——不是「世界里没东西受影响」。`,
    );
  }

  // ── ② 变更前的真实旧值（回显 · 与调用方声明的 oldValue 对照）──────────────
  // 先读世界覆盖层，覆盖层没有再读真对象；两处都没有则 undefined（对象不存在或该属性未赋值）。
  const originObj = await repos.objects.get(ctx.tenantId, req.change.objectId);
  const observedOldValue =
    worldState[req.change.objectId]?.[req.change.prop] ?? originObj?.props?.[req.change.prop];
  const oldValueMismatch =
    req.change.oldValue !== undefined &&
    JSON.stringify(req.change.oldValue ?? null) !== JSON.stringify(observedOldValue ?? null);
  if (!originObj) {
    warnings.push(
      `变更目标对象 ${req.change.objectId} 在本租户本体里不存在——传播闭包必为空，这是「找不到起点」而非「没影响」。`,
    );
  }

  // ── ③ 栈 B：变更驱动的依赖传播（dryRun · R4 不写真值）────────────────────
  // `changes` 只播种**变更本身**的脏集 ⇒ 闭包 = 该变更的下游；`apply` 同时带上世界覆盖层，
  // 使下游重算读到的输入是**世界里的值**而不是真本体的值。这就是「栈 B 跑在栈 A 的世界里」。
  const activeSpecs = await repos.derivationSpecs.list(ctx.tenantId, (s) => s.status === "ACTIVE");
  const result = await ontologyCore.recompute(
    ctx,
    [{ typeKey: req.change.objectType, prop: req.change.prop, objectIds: [req.change.objectId] }],
    {
      dryRun: true,
      apply: [...overlay, { objectId: req.change.objectId, prop: req.change.prop, value: req.change.value }],
    },
  );
  if (activeSpecs.length === 0) {
    warnings.push(
      "本体里没有任何 ACTIVE 派生规格（derivationSpecs=0），传播闭包必然为空——四维的 0 是「算不了」而非「没影响」。",
    );
  }

  const deltas = result.dryRunDeltas ?? [];
  const affectedIds = result.affectedObjectIds;

  // 受影响对象的类型：只查闭包里的这些 id（有界查询）。
  const affectedObjs = new Map<string, ObjectInstance>();
  for (const id of affectedIds) {
    const o = await repos.objects.get(ctx.tenantId, id);
    if (o) affectedObjs.set(id, o);
  }
  const deltasByObj = new Map<string, { prop: string; before: unknown; after: unknown }[]>();
  for (const d of deltas) {
    const list = deltasByObj.get(d.objId) ?? [];
    list.push({ prop: d.prop, before: d.before, after: d.after });
    deltasByObj.set(d.objId, list);
  }

  // ── 维① 受影响对象 ───────────────────────────────────────────────────────
  const objectItems: AffectedObjectItem[] = byKey(
    affectedIds.map((id) => ({
      objectId: id,
      objectType: affectedObjs.get(id)?.type ?? "",
      changedProps: byKey(deltasByObj.get(id) ?? [], (p) => p.prop),
    })),
    (x) => x.objectId,
  );
  // 全域基数 = 本租户对象总数（「N 个里动了 M 个」才是可读的影响面）。
  const universeObjects = (await repos.objects.list(ctx.tenantId)).length;

  // ── 维④ 受影响 KPI（先算，维③ 要用它）──────────────────────────────────
  const allTypes = await repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
  const kpiTypeKeys = allTypes
    .filter((t) => KPI_REQUIRED_PROPS.every((p) => t.properties.some((pd) => pd.propKey === p)))
    .map((t) => t.key)
    .sort();

  let affectedKpis: ImpactAnalysisResponse["affectedKpis"];
  const affectedKpiObjects: ObjectInstance[] = [];
  if (kpiTypeKeys.length === 0) {
    affectedKpis = {
      available: false,
      reason:
        "本体里没有任何对象类型同时具备 `target` 与 `actual` 属性 ⇒ 平台今天没有 KPI 承载物，这一维算不了（不是「没有 KPI 受影响」）。",
      missingCarrier: "ObjectType(target+actual)",
    };
  } else {
    const kpiSet = new Set(kpiTypeKeys);
    for (const id of affectedIds) {
      const o = affectedObjs.get(id);
      if (o && kpiSet.has(o.type)) affectedKpiObjects.push(o);
    }
    const items: AffectedKpiItem[] = byKey(
      affectedKpiObjects.map((o) => {
        const changedProps = byKey(deltasByObj.get(o.id) ?? [], (p) => p.prop);
        // 变更**后**的 actual：优先取本次重算出的 after，否则取对象当前值。
        const actualAfter = changedProps.find((p) => p.prop === "actual")?.after ?? o.props.actual;
        const floor = o.props.floorVal;
        // 🔴 三态：取不到 floorVal 或 actual ⇒ UNKNOWN，**绝不**当成 SAFE
        //   （「没算出越线」和「没越线」是两回事，塌成 SAFE 就是静默错答）。
        const breach: AffectedKpiItem["breach"] =
          typeof floor === "number" && typeof actualAfter === "number"
            ? actualAfter < floor
              ? "BREACHED"
              : "SAFE"
            : "UNKNOWN";
        return {
          objectId: o.id,
          metricKey: typeof o.props.key === "string" ? o.props.key : null,
          name: typeof o.props.name === "string" ? o.props.name : null,
          unit: typeof o.props.unit === "string" ? o.props.unit : null,
          changedProps,
          breach,
        };
      }),
      (x) => x.objectId,
    );
    let universeKpis = 0;
    for (const k of kpiTypeKeys) universeKpis += (await repos.objects.listByType(ctx.tenantId, k)).length;
    affectedKpis = envelope(items, universeKpis, limit);
  }

  // ── 维② 受影响流程（definition 粒度）────────────────────────────────────
  // 连接键 = `ProcessDefinition.carrierTypeKey`（contracts/process.ts 红线 3：
  // 每条 P## 必须声明它作用在哪个本体对象类型上，且由 process-layer.test.ts 断言①守）。
  const allProcs = await repos.processDefinitions.list(ctx.tenantId);
  const affectedTypeToIds = new Map<string, string[]>();
  for (const id of affectedIds) {
    const t = affectedObjs.get(id)?.type;
    if (!t) continue;
    const list = affectedTypeToIds.get(t) ?? [];
    list.push(id);
    affectedTypeToIds.set(t, list);
  }
  /**
   * 🔴 实例粒度恒不可用。`ProcessInstance` / `ProcessTask` 在
   * `docs/PRD-enterprise-decision-twin.md` §1 的「新增」清单里 ⇒ 今天不存在；
   * 同文 §2.2 自述并发缺口：「流程节点没有 Owner」（三处 schema 全无 owner/actor/assignee）、
   * 「五种 WAITING 一个都没有」。故「**哪一条**流程实例被卡住、卡在**谁**那里」答不出。
   */
  const instanceLevel = {
    available: false as const,
    reason:
      "流程**实例**粒度不可用：平台今天只有 ProcessDefinition（流程定义），没有 ProcessInstance/ProcessTask 承载物，流程节点也无 owner/assignee 字段、五种 WAITING 状态全缺。故只能答「哪些流程会被波及」，答不出「哪一条实例被卡住、卡在谁那里、卡了多久」。上面的 count 是**定义数**，不是受阻实例数。",
    missingCarrier: "ProcessInstance",
  };
  let affectedProcesses: ImpactAnalysisResponse["affectedProcesses"];
  if (allProcs.length === 0) {
    affectedProcesses = {
      available: false,
      reason:
        "本租户没有播种业务流程层（ProcessDefinition 0 条）⇒ 没有可被波及的流程定义可查，这一维算不了（不是「没有流程受影响」）。参见 seedDemoProcessLayer。",
      missingCarrier: "ProcessDefinition",
    };
  } else {
    const procItems: AffectedProcessItem[] = byKey(
      allProcs
        .filter((p) => affectedTypeToIds.has(p.carrierTypeKey))
        .map((p) => ({
          processKey: p.key,
          name: p.name,
          domainKey: p.domainKey,
          ownerFunctionKey: p.ownerFunctionKey,
          waitKind: p.waitKind,
          stdDurationDays: p.stdDurationDays,
          carrierTypeKey: p.carrierTypeKey,
          viaObjectIds: [...(affectedTypeToIds.get(p.carrierTypeKey) ?? [])].sort().slice(0, limit),
        })),
      (x) => x.processKey,
    );
    affectedProcesses = { ...envelope(procItems, allProcs.length, limit), instanceLevel };
  }

  // ── 维③ 受影响决策 ──────────────────────────────────────────────────────
  // 连接键：`Decision.metricKey` / `rootRef.rootMetric.key` ∩ 受影响 KPI 的 `key` 属性 ——
  // 一条决策的根因锚在某指标上，那个指标被波及 ⇒ 该决策的前提可能已不成立。
  const allDecisions = await repos.decisions.list(ctx.tenantId);
  const kpiKeyToObjIds = new Map<string, string[]>();
  for (const o of affectedKpiObjects) {
    const k = typeof o.props.key === "string" ? o.props.key : null;
    if (!k) continue;
    const list = kpiKeyToObjIds.get(k) ?? [];
    list.push(o.id);
    kpiKeyToObjIds.set(k, list);
  }
  let affectedDecisions: ImpactAnalysisResponse["affectedDecisions"];
  if (kpiTypeKeys.length === 0) {
    // 连接键的来源没了（无 KPI 承载物）⇒ 这一维也算不了。诚实传染，不假装能算。
    affectedDecisions = {
      available: false,
      reason:
        "决策与变更的连接键是「决策根因锚定的指标」，而本体里没有 KPI 承载物（无类型同时具备 target/actual）⇒ 无从判定哪些决策受影响。",
      missingCarrier: "ObjectType(target+actual)",
    };
  } else {
    const decItems: AffectedDecisionItem[] = byKey(
      allDecisions
        .map((d) => {
          const keys = new Set([d.metricKey, d.rootRef?.rootMetric?.key].filter((x): x is string => !!x));
          const via: string[] = [];
          for (const k of keys) for (const oid of kpiKeyToObjIds.get(k) ?? []) via.push(oid);
          return { d, via: [...new Set(via)].sort() };
        })
        .filter((x) => x.via.length > 0)
        .map(({ d, via }) => ({
          decisionId: d.id,
          status: d.status,
          metricKey: d.metricKey,
          factorId: d.factorId ?? null,
          viaKpiObjectIds: via,
          actionDraftCount: d.actionDraftIds?.length ?? 0,
        })),
      (x) => x.decisionId,
    );
    if (allDecisions.length === 0) {
      // 有承载物、台账为空 —— 与「有 500 条一条没中」是不同的事实，靠 universe:0 + warning 区分。
      warnings.push(
        "决策台账为空（Decision 0 条）：affectedDecisions.count=0 的含义是「一条决策都还没建」，不是「已有决策都不受影响」。",
      );
    }
    affectedDecisions = envelope(decItems, allDecisions.length, limit);
  }

  return {
    basis: {
      engine: "ontology-core.recompute",
      worldId: world.id,
      worldTick: world.curTick,
      worldStatus: world.status,
      worldOverlayApplied: overlay.length,
      countBasis: "DISTINCT_OBJECTS",
      derivationSpecCount: activeSpecs.length,
      kpiTypeKeys,
      oldValueMismatch,
      ...(observedOldValue !== undefined ? { observedOldValue } : {}),
    },
    affectedObjects: envelope(objectItems, universeObjects, limit),
    affectedProcesses,
    affectedDecisions,
    affectedKpis,
    warnings,
  };
}
