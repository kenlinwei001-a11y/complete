import type { AuthCtx, ActionDraft, ActionTypeRecord, ObjectOrigin } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import type { RulesService } from "./rules.js";
import { newId } from "./ids.js";
import { AppError, notFound, validationError } from "./errors.js";
import { hashString } from "./prng.js";
import { Metrics, ActionMetrics, type ActionSubmitOutcome } from "./metrics.js";
import {
  actionTypeVersionOf,
  actionWriteTargets,
  type ActionEffectSpec,
  type ActionWriteTarget,
} from "@platform/contracts";

/** Write-back adapter interface (S2): this period ships the Mock implementation. */
export interface ActionExecutor {
  execute(draft: ActionDraft): Promise<{ ok: boolean; targetRef?: string; error?: string }>;
}

/**
 * 执行接线态（G-ACTION-NOOP-EXEC 收口）——每个**已注册** ActionType 必须显式归入其一。
 *
 * 病灶：`app.ts domainExecutor` 只有 7 个分支，未覆盖者全部落 `MockActionExecutor`，
 * 后者返回 `MO-2026-${hash}` —— **一个哈希编出来的假工单号，形态与真 MO 一模一样**。
 * 于是审批链走完 ✅ 审计留痕齐全 ✅ targetRef 看着像真的 ✅ 而**真值一个字节没动**。
 * 加重情节：平台自己的注册表 `mapping.ts:85` 白纸黑字写着「采纳产能保障方案 → target: 生产工单MO（写回）」。
 * R4「真值经 Action」在最深处被架空，且用户在界面上**无法分辨**。
 *
 * 纪律：**未实现必须诚实失败，绝不允许返回一个看起来像真的假单号**。
 * 静默返回假成功比报错危险得多——报错至少会被发现，假成功会被当成事实沉淀进决策。
 */
export type ActionWiring = "WIRED" | "NO_WRITE" | "NOT_IMPLEMENTED";

export const ACTION_WIRING: Record<string, ActionWiring> = {
  // —— 有真执行器（app.ts domainExecutor 有分支·改动真值）——
  AOP情景拍板: "WIRED",
  校准参数变更: "WIRED",
  定稿月度计划版本: "WIRED",
  计划版本变更: "WIRED",
  对象数据变更: "WIRED",
  流水线发布物化: "WIRED",
  // plan_change 一个 key 承载**三条形态不同**的生产者，执行期按 payload 二次判定（WO-ACTION-NOOP-EXEC 实测）：
  //   ① source==="global-sim"（`GlobalSimView.tsx:354`）→ GlobalSimPlanExecutor 真回灌基线；
  //   ② 带真本体属性杠杆 `payload.levers[{objectType,objectId,prop,value}]`
  //      （`RiskBoardView.tsx adoptScenario()` 发的 `LiveScenario.apply`）→ **本单接上**：与
  //      `采纳产能保障方案` 同一套写入器落成属性真值 + runDerivations；
  //   ③ 其余四条生产者（order-chain 结论 / coordinate_capacity 协调加产 / global-sim-scenario KPI 快照 /
  //      sim_sandbox 结论）payload 里**没有任何可写的杠杆** → 诚实失败（理由随错误吐出）。
  //      其中 sim_sandbox 两条的 payload 自带 `patch.simulated: true`：把模拟态结论直接写成真值
  //      恰是 PRD-enterprise-decision-twin §4.1 明令禁止的「仿真世界回流真实世界」——
  //      这条诚实失败是**正确行为**，不是欠账（见本体 §8 G-PLAN-CHANGE-NO-LEVER）。
  plan_change: "WIRED",
  采纳产能保障方案: "WIRED", // ← 已接：杠杆落成本体属性真值（app.ts）+ runDerivations；写回意图见 mapping.ts:85
  // ← 已接：审批通过后写 AdoptedMitigation 台账（app.ts）→ risk_timeline 真曲线自第 tn 天起扣 eff。
  //   「采纳」的实质不是开一张工单，而是让**风险曲线真的降下去**；效果层断言见 test/action-adopt-mitigation.seam.test.ts。
  //   写回意图出处：decision/kernel.ts:126 真 dispatch 本 key 建 DRAFT；mapping.ts:86「预警处置方案 →
  //   处置工单（写回）+ 风险曲线消解」是同一业务动作的中文登记名（键名不同名，据实说明不硬凑）。
  adopt_mitigation: "WIRED",
  // ← 已接：项目推演⑥「采纳结论」→ 落 ForecastAdoption 台账对象（参数组合+推演快照全字段），
  //   选中订单时把可行性结论回 stamp 到 Order（app.ts domainExecutor 分支）。效果层断言（读回对象
  //   字段真变）见 test/action-adopt-forecast.seam.test.ts。
  采纳产能预测结论: "WIRED",
  // —— 尚未接执行器：审批通过后不写任何真值（**欠账**，非「设计上无副作用」）——
  // ⚠️ 只剩这一条了。写清它写回意图的**真实出处**（上一版这里笼统写成"三条在 mapping.ts / decision-kernel 里
  //    都有写回意图"，对 `采纳经营方案` 是**事实错误**——它既不在 mapping.ts，kernel 也不派它。
  //    门禁的理由本身错了，就是这套门自己身上的一小块假绿，故据实标注，勿再合并成一句笼统话）：
  //    出处 = 它自己的注册声明 battery.ts `required: ["schemeNo","scheme","targets"]`
  //    （增量 §0-4 / §7.11 规划建议「采纳方案」，payload = 方案快照 + 目标面板值）——
  //    载荷里带着方案与目标，却一个字节都不落，正是欠账形态。
  //    业务裁定（已定·勿改）：采纳一个方案**不得覆盖全局经营目标基线**（PLAN_GOAL_TARGETS）——「目标不能改」。
  //
  // ⚠️ WO-ACTION-NOOP-EXEC 逐型定性结论（**本单刻意不接·理由已实测·勿当成"忘了做"**）：
  //    本型属「**域映射缺失**」而非「该写而没写」——四条论据全部实测，逐条见 `NOT_IMPLEMENTED_RATIONALE.采纳经营方案`。
  //    一句话：载荷里的三样东西（公司级聚合预测 outcome / 目标面板 targets / 只活在求解器内部的 pathKey）
  //    **没有一样能落到某个对象的某个属性上**，而 PRD 指定的落点（AOP 年度情景细化）今天的承载对象
  //    `AnnualScenario` 属性全是已播种真值，覆盖即毁数。硬接 = 假 MO 号换件衣服（本仓刚清掉的那个病）。
  //    正确的下一步是先立「方案采纳台账对象 + AOP 细化读端」这一对新要素（跨 battery.ts 注册 + 读端，
  //    超出本单范围边界），已登记为本体 §8 `G-ADOPT-SCHEME-NO-CARRIER`。
  采纳经营方案: "NOT_IMPLEMENTED",
};

/**
 * `NO_WRITE` = **设计上**不写真值（如纯审计/纯登记动作）。它是三态里唯一「绿着却什么都不写」的一态，
 * 因此也是**最容易被用来洗白欠账**的一态：把 NOT_IMPLEMENTED 改成 NO_WRITE 只要五秒，门当场变绿，
 * 而问题原封不动——且比 NOT_IMPLEMENTED 更难发现，因为它看起来"已经想清楚了"。
 *
 * 故：**已注册内置** ActionType 若标 NO_WRITE，必须在此登记非空理由（`scripts/check-action-wiring.mjs` 断言⑤）。
 * 当前为空 —— 这不是疏漏，是**现状的事实**：10 个内置全部落 WIRED 或 NOT_IMPLEMENTED，
 * NO_WRITE 只作为**租户 registerType 自注册键**的默认（平台侧不可能有内置执行器，判 NOT_IMPLEMENTED 会误杀）。
 */
export const NO_WRITE_RATIONALE: Record<string, string> = {};

/** plan_change 只有 global-sim 来源真回灌——其余来源等同未实现（不得借 WIRED 之名假装写了）。 */
export function planChangeIsWired(payload: unknown): boolean {
  return (payload as { source?: unknown } | undefined)?.source === "global-sim";
}

// ---------------------------------------------------------------------------
// WO-ACTION-NOOP-EXEC · 本体属性杠杆：**两条生产路径共用的**真值写入最小单元
// ---------------------------------------------------------------------------

/**
 * 杠杆行 `{objectType?, objectId, prop, value}` —— **不是本单发明的形状**，是两条已在跑的生产路径
 * 各自独立长出来的同一个形状，故必须共用同一份解析实现（各抄一份必然漂移）：
 *  · `采纳产能保障方案`：`payload.levers` 由 `discoverLevers` 产出（LEVER_PROP_META 真本体属性）；
 *  · `plan_change`（非 global-sim·风险看板「采纳风险处置方案」）：`RiskBoardView.tsx adoptScenario()`
 *    发 `payload.levers = LiveScenario.apply`，其契约（`frontend-shell/src/api/endpoints.ts` `LiveScenario`）
 *    正是 `{ objectType: string; objectId: string; prop: string; value: number }[]`。
 *
 * ⚠️ 判据不放宽：任一行缺 `objectId` / `prop` / 有限数值 `value` → 整体 `INVALID`，**一个字节都不写**。
 * 「猜一个值写下去」比「不写」危险得多——写错的真值之后无法与真数分辨（本仓刚清掉的假 MO 号同款病）。
 */
export interface OntologyLever {
  objectType?: string;
  objectId: string;
  prop: string;
  value: number;
}

export type LeverParse =
  /** payload 里根本没有 `levers` 字段（或不是数组）——与「空数组」定性不同，处置也不同。 */
  | { kind: "ABSENT" }
  /** `levers: []` —— 生产者明确说了「没有杠杆」，执行即空转，拒绝。 */
  | { kind: "EMPTY" }
  /** 有行但行残缺 —— 拒绝臆造。 */
  | { kind: "INVALID"; detail: string }
  | { kind: "OK"; levers: OntologyLever[] };

export function parseLevers(payload: Record<string, unknown> | undefined): LeverParse {
  const raw = payload?.levers;
  if (!Array.isArray(raw)) return { kind: "ABSENT" };
  if (raw.length === 0) return { kind: "EMPTY" };
  const levers: OntologyLever[] = [];
  for (const r of raw) {
    const row = (r ?? {}) as Record<string, unknown>;
    const objectId = String(row.objectId ?? "");
    const prop = String(row.prop ?? "");
    const value = row.value;
    if (!objectId || !prop || typeof value !== "number" || !Number.isFinite(value)) {
      return { kind: "INVALID", detail: JSON.stringify(r) };
    }
    levers.push({
      objectType: row.objectType === undefined ? undefined : String(row.objectType),
      objectId,
      prop,
      value,
    });
  }
  return { kind: "OK", levers };
}

/**
 * 每型「为什么今天写不了」的**具体**理由（诚实失败时随错误信息一起吐给前端与审计）。
 *
 * 为什么要有这张表：`EXECUTOR_NOT_IMPLEMENTED` 那段通用文案只说了「没接」，说不出「为什么没接」。
 * 而这两件事的处置完全不同 —— 「该写而没写」要排单去接，「域映射缺失」要先立映射再谈接。
 * 把理由写在错误里，欠账就**在用户看得见的地方**可读，而不是只活在源码注释里。
 */
export const NOT_IMPLEMENTED_RATIONALE: Record<string, string> = {
  采纳经营方案:
    "域映射缺失（非「排期没排到」）：本型 payload 是 `{schemeNo, pathKey, scheme.outcome, targets}` —— " +
    "`outcome{rev,gm,share,turns,cash,capex}` 是**公司级年度聚合预测**，不是任何本体对象的属性" +
    "（`plan_generate` 在 `solvers/service.ts` 的读取声明是空数组：它一个核心对象类型都不读）；" +
    "`targets` 是目标面板值，而业务已裁定「采纳一个方案不得覆盖全局经营目标基线（PLAN_GOAL_TARGETS）」；" +
    "`pathKey` 唯一的消费方是 `solvers/service.ts` 里 plan_generate **本次调用自己的输出后处理**" +
    "（`schemes.find(s => s.pathKey === out.recommend)`，用来挑出推荐方案喂规则判定）——" +
    "**没有任何仓储、对象或别的求解器以「已采纳的 pathKey」为输入**，" +
    "即写下去也没有读端（那只是把本断点换成「有写端无读端」，参见 G-SIM-SCOPE-UNREAD 的形态）。" +
    "PRD-plan-generate-1to1 §2/§3.4 指定的落点是「下发年度情景规划台(AOP)细化」，" +
    "而 `AnnualScenario` 现有属性全是已播种的三情景真值，覆盖即毁真值。" +
    "⇒ 需先立「方案采纳台账 + AOP 细化读端」这一对新要素，才谈得上接执行器（见本体 §8 G-ADOPT-SCHEME-NO-CARRIER）。",
};

/**
 * 诚实失败结果的**唯一产地**：统一 `EXECUTOR_NOT_IMPLEMENTED:` 前缀（前端/审计据此识别），
 * 并把该型的具体缺口拼在后面。`why` 显式传入时优先于 `NOT_IMPLEMENTED_RATIONALE`
 * （给「同一个 key 但不同 payload 形态」的场景用——如非 global-sim 的 `plan_change`）。
 */
export function notImplementedResult(key: string, why?: string): { ok: false; error: string } {
  const base =
    `EXECUTOR_NOT_IMPLEMENTED: 动作类型「${key}」尚未接入真实执行器，审批通过后不会写入任何真值。` +
    `此处诚实失败而非返回占位单号——曾经的兜底会返回 MO-2026-xxxx 形态的假工单号，` +
    `使「没做」与「做了」在界面与审计里完全无法区分（G-ACTION-NOOP-EXEC）。`;
  const rationale = why ?? NOT_IMPLEMENTED_RATIONALE[key];
  return { ok: false, error: rationale ? `${base}【本型的具体缺口】${rationale}` : base };
}

/**
 * 未接线动作的**诚实执行器**：取代此前返回假 MO 号的兜底。
 * NOT_IMPLEMENTED → `ok:false`（草稿落 EXECUTION_FAILED·错误码可被前端/审计识别）；
 * NO_WRITE        → `ok:true` 但 targetRef 显式标注无写入，**绝不产出 MO 形态字符串**。
 */
export class UnwiredActionExecutor implements ActionExecutor {
  async execute(draft: ActionDraft): Promise<{ ok: boolean; targetRef?: string; error?: string }> {
    const key = draft.actionTypeKey;
    // 未知键 = 租户经 registerType 自注册的**自定义**动作类型：平台侧不可能有内置执行器，
    // 判 NOT_IMPLEMENTED 会打死这个正当功能。故默认 NO_WRITE——
    // ⚠️ 关键区分：**不诚实的从来不是 `ok:true`，而是那个 MO 形态的假 ref**（使"没写"与"开了工单"不可分辨）。
    // NO_WRITE 返回 `NO_WRITE:<key>`：动作确实走完了审批链，且 targetRef **自证没有写入任何真值**。
    // 而平台**内置已注册**却没接执行器的（现仅剩 `采纳经营方案`）是**欠账**，
    // 在 ACTION_WIRING 里显式标 NOT_IMPLEMENTED → 诚实失败，让欠账可见、可门禁、不可伪装成 NO_WRITE。
    const wiring: ActionWiring = ACTION_WIRING[key] ?? "NO_WRITE";
    if (wiring === "NO_WRITE") return { ok: true, targetRef: `NO_WRITE:${key}` };
    // 具体缺口（若已登记）随错误一起吐出——让「为什么没接」在界面与审计里可读，不只活在源码注释里。
    return notImplementedResult(key);
  }
}

export class MockActionExecutor implements ActionExecutor {
  async execute(draft: ActionDraft): Promise<{ ok: boolean; targetRef: string }> {
    return { ok: true, targetRef: `MO-2026-${String(1000 + (hashString(draft.id) % 9000))}` };
  }
}

// ---------------------------------------------------------------------------
// WO-GSIM-5-ACTION · 洞察→行动写回·闭决策环（G-DECISION 行动半 / G-LOOP-FEEDBACK）
// ---------------------------------------------------------------------------

/** 对象 id 归一（照 synthetic/service.ts oid：obj_{type}_{pk}·非字母数字→_·跨路径一致）。 */
function objId(type: string, pk: unknown): string {
  return `obj_${type.toLowerCase()}_${String(pk)}`.replace(/[^\p{L}\p{N}_-]/gu, "_");
}

/** forecastStart(ISO date) + days → ISO date（确定性·无 Date.now/random·R6）。 */
function isoAddDays(startIso: string, days: number): string {
  const base = Date.parse(startIso.slice(0, 10));
  const ms = Number.isNaN(base) ? Date.parse("2026-06-10") : base;
  return new Date(ms + Math.round(days) * 86400000).toISOString().slice(0, 10);
}

/**
 * 确定性方案指纹（R6·无 Date.now/random）：只对 `plan_change` + source:"global-sim" 生效，
 * 由 source|objective|sorted(displaced)|summary 派生 → 同方案两次采纳同一指纹 → 幂等去重（不重复建 Action/物化）。
 * 生成的 WorkOrder/InterBaseTransfer id 也以此指纹为锚 → 二次执行 put 覆盖同 id 不产重复。
 */
export function planFingerprint(actionTypeKey: string, payload: Record<string, unknown>): string | undefined {
  if (actionTypeKey !== "plan_change" || payload?.source !== "global-sim") return undefined;
  const displaced = Array.isArray(payload.displaced) ? payload.displaced.map(String).sort() : [];
  const raw = `global-sim|${String(payload.objective ?? "")}|${displaced.join(",")}|${String(payload.summary ?? "")}`;
  return `gsim_${hashString(raw).toString(16)}`;
}

export interface PlanWritebackDeps {
  repos: Repos;
  /** 时间锚（= solver_params.forecastStart）；禁 Date.now（R6）。 */
  forecastStart: (tenantId: string) => Promise<string>;
  /** 物化后重算派生（etaDay 等派生属性）；缺省则跳过。 */
  runDerivations?: (tenantId: string) => Promise<void>;
}

/**
 * 全局项目推演「采纳方案」真实执行器（G-LOOP-FEEDBACK 数据半）：审批通过 → 执行时把采纳的方案
 * **回灌基线**——为每个 served 订单物化「在产 WorkOrder（承诺占用·portfolio.assemble 读为 committed WIP·
 * 预扣净产能）」+ 把该 Order 移出 OPEN 决策集（status→已排产），跨基地分配再生成「InterBaseTransfer
 * 两段电芯就近调运 leg」→ 下一轮 portfolioOptimize 读到真变基线（served 订单已承诺/产能已占）。
 * 其余 action 类型/非 global-sim 的 plan_change 一律委派 fallback（不破坏既有 S2 行为）。
 * 确定性 R6（id/值全由 payload+forecastStart 派生·无 Date.now/random）·tenant 全程作用域·R13 provenance 溯回方案。
 */
export class GlobalSimPlanExecutor implements ActionExecutor {
  constructor(private deps: PlanWritebackDeps, private fallback: ActionExecutor) {}

  async execute(draft: ActionDraft): Promise<{ ok: boolean; targetRef?: string; error?: string }> {
    const payload = draft.payload as Record<string, unknown>;
    if (draft.actionTypeKey !== "plan_change" || payload?.source !== "global-sim") {
      return this.fallback.execute(draft);
    }
    const tenantId = draft.tenantId;
    const fp = draft.fingerprint ?? planFingerprint(draft.actionTypeKey, payload) ?? `gsim_${hashString(draft.id).toString(16)}`;
    const forecastStart = await this.deps.forecastStart(tenantId);
    const objective = String(payload.objective ?? "");
    const served = Array.isArray(payload.served) ? (payload.served as Record<string, unknown>[]) : [];
    const origin: ObjectOrigin = { type: "ACTION", actionId: draft.id, source: "global-sim", fingerprint: fp };
    const provenance = {
      kind: "行动写回", source: "global-sim", objective, actionId: draft.id, fingerprint: fp,
      summary: String(payload.summary ?? ""), drillType: "ActionDraft", drillId: draft.id, drillField: "payload.source",
    };

    // Order 现状（用于移出 OPEN 决策集 + 推 home 基地）。tenant 作用域读。
    const orderObjs = await this.deps.repos.objects.listByType(tenantId, "Order");
    const orderBySo = new Map(orderObjs.map((o) => [String(o.props.so), o]));

    const materializedWos: string[] = [];
    const transfers: string[] = [];

    // 稳定排序（R6·执行序不依赖入参顺序）。
    const sortedServed = [...served].sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
    for (const s of sortedServed) {
      const orderId = String(s.orderId ?? "");
      const base = String(s.base ?? "");
      const model = String(s.model ?? "");
      const qty = Math.max(0, Math.round(Number(s.qty) || 0));
      const window = Math.max(0, Math.round(Number(s.window) || 0));
      const windowDaysGuess = 14;
      const windowStartDay = Math.max(0, Math.round(Number(s.windowStartDay ?? window * windowDaysGuess)));
      if (!orderId || !base || qty <= 0) continue;

      // ① 物化在产 WorkOrder（承诺占用·portfolio 读 committed WIP：status∉{已完成,已关闭} & qtyActual>0 & baseId 有线）。
      //    endDate 落在 served 窗口内 → 预扣该 (base,窗口) 净产能（下一轮基线真变）。
      const woId = `WO-GS-${fp}-${orderId}`;
      const endDate = isoAddDays(forecastStart, windowStartDay + 1);
      const startDate = isoAddDays(forecastStart, Math.max(0, windowStartDay - 6));
      await this.deps.repos.objects.put({
        id: objId("WorkOrder", woId), tenantId, type: "WorkOrder", origin,
        props: {
          woId, moNo: `MO-${woId}`, modelId: model, baseId: base,
          qtyPlanned: qty, qtyActual: qty, startDate, endDate, status: "生产中",
          _provenance: provenance, _adoptedOrderId: orderId, _adoptedByAction: draft.id,
        },
      });
      materializedWos.push(woId);

      // ② 采纳即承诺：把该 OPEN 订单移出决策集（status→已排产·portfolio includeOrderIds 默认只收 OPEN）。
      const orderObj = orderBySo.get(orderId);
      if (orderObj && String(orderObj.props.status) === "OPEN") {
        await this.deps.repos.objects.put({
          ...orderObj,
          props: { ...orderObj.props, status: "已排产", _committedByAction: draft.id, _provenance: provenance },
          origin,
        });
      }

      // ③ 跨基地调剂：服务基地 ≠ 订单 home 基地（eligibleBases 排序首个·同 portfolio 口径）→ 生成
      //    InterBaseTransfer「两段电芯就近调运」leg（freightCost/cellSourceMap 留 WO-GSIM-1-DATA 接缝·此处不硬依赖）。
      const homeBase = orderObj && Array.isArray(orderObj.props.bases) && (orderObj.props.bases as unknown[]).length
        ? [...(orderObj.props.bases as unknown[])].map(String).sort()[0]!
        : base;
      if (homeBase && homeBase !== base) {
        const transitDays = 1 + (hashString(`xfer_${homeBase}${base}${model}`) % 6);
        const dispatchDay = Math.max(0, windowStartDay - transitDays);
        const transferId = `XFER-GS-${fp}-${orderId}`;
        await this.deps.repos.objects.put({
          id: objId("InterBaseTransfer", transferId), tenantId, type: "InterBaseTransfer", origin,
          props: {
            transferId, fromBase: homeBase, toBase: base, model, qty, transitDays, status: "PLANNED",
            dispatchDay, dispatchDate: isoAddDays(forecastStart, dispatchDay),
            etaDay: dispatchDay + transitDays, etaDate: isoAddDays(forecastStart, dispatchDay + transitDays),
            reason: `全局项目推演采纳·两段电芯就近调运（${homeBase}→${base}）`,
            _provenance: provenance, _adoptedOrderId: orderId, _adoptedByAction: draft.id,
          },
        });
        transfers.push(transferId);
      }
    }

    // 物化后重算派生（etaDay 等；也让后续切片/推演读到新对象）。
    if (this.deps.runDerivations && (materializedWos.length || transfers.length)) {
      await this.deps.runDerivations(tenantId);
    }

    const targetRef = materializedWos[0] ? `MO-${materializedWos[0]}` : `GSIM-${fp}`;
    return { ok: true, targetRef };
  }
}

// ---------------------------------------------------------------------------
// ActionType 回写声明 · 平台内置执行器登记
//
// 范围与诚实边界（务必照读，勿当作"全平台回写目录"）：
//  · 这里**只**登记回写实现与本声明同在 `apps/datacore/src/actions.ts` 的执行器
//    （= `GlobalSimPlanExecutor`），因此声明可被 SEAM 测试逐属性对拍——执行器改了、声明没跟，测试变红。
//  · `app.ts domainExecutor` 其余分支（AOP情景拍板 / 校准参数变更 / 定稿月度计划版本 / 计划版本变更 /
//    对象数据变更 / 流水线发布物化）的回写**没有**登记在此：它们要么写的不是 ObjectInstance
//    （solver params、S&OP 版本记录），要么目标类型/属性由 payload 或工作流定义在运行期决定
//    （`对象数据变更` 的 objectType/patch、`流水线发布物化` 的 node.modeling.typeKey），
//    静态声明表达不了。**宁可留空（coverage=NONE）也不编造**。
//  · 租户经 `POST /a/v1/action-types` 注册的 `effects` 优先级高于本表（本表只是缺省兜底）。
// ---------------------------------------------------------------------------
export const BUILTIN_ACTION_EFFECTS: Record<string, ActionEffectSpec> = {
  plan_change: {
    coverage: "PARTIAL",
    writes: [
      {
        objectType: "WorkOrder",
        op: "UPSERT",
        properties: [
          "woId", "moNo", "modelId", "baseId", "qtyPlanned", "qtyActual",
          "startDate", "endDate", "status", "_provenance", "_adoptedOrderId", "_adoptedByAction",
        ],
        selector: { kind: "BY_PAYLOAD", payloadPath: "served[].orderId" },
        cardinality: "MANY",
        condition: { payloadPath: "source", equals: "global-sim" },
        note: "采纳全局项目推演方案 → 每个 served 订单物化一张在产工单（承诺占用·预扣净产能）",
      },
      {
        objectType: "Order",
        op: "UPDATE",
        properties: ["status", "_committedByAction", "_provenance"],
        selector: { kind: "BY_PAYLOAD", payloadPath: "served[].orderId" },
        cardinality: "MANY",
        condition: { payloadPath: "source", equals: "global-sim" },
        note: "采纳即承诺：OPEN → 已排产，移出自由决策集（仅当该订单当前为 OPEN）",
      },
      {
        objectType: "InterBaseTransfer",
        op: "UPSERT",
        properties: [
          "transferId", "fromBase", "toBase", "model", "qty", "transitDays", "status",
          "dispatchDay", "dispatchDate", "etaDay", "etaDate", "reason",
          "_provenance", "_adoptedOrderId", "_adoptedByAction",
        ],
        selector: { kind: "BY_PAYLOAD", payloadPath: "served[].orderId" },
        cardinality: "MANY",
        condition: { payloadPath: "source", equals: "global-sim" },
        note: "服务基地 ≠ 订单 home 基地时才生成跨基地调运 leg（同基地不产生此条回写）",
      },
    ],
    undeclared: [
      "执行末尾 runDerivations() 会重算全租户派生属性（etaDay 等），二阶写入的对象/属性集由 DerivationSpec 决定，静态声明枚举不了",
      // ⚠️ 2026-08-16 就地回写（WO-ACTION-NOOP-EXEC 实测）：原文写「非 global-sim 的 plan_change …
      //    没有分支 → 落 MockActionExecutor，审批通过后实际零回写」——**两处都已不成立**，
      //    而一条**在说谎的回写声明**比没有声明更危险（影响分析会照它答「批准这个不会动任何真值」）。
      "非 global-sim 的 plan_change **按 payload 形态二分**（上列三条 writes 均带 source==='global-sim' 条件，只覆盖 global-sim 那一支）：" +
        "① 带 `levers[{objectType,objectId,prop,value}]` 者（风险看板「采纳风险处置方案」）**真写本体属性真值** —— " +
        "但**目标 objectType/propKey 由 payload 在运行期决定**，本 schema 的 `objectType` 要求具体 typeKey，静态声明表达不了，故只能记在此处（保持 coverage=PARTIAL，绝不以 COMPLETE 假装完整）；" +
        "② 不带 levers 者（order-chain 结论 / coordinate_capacity / global-sim-scenario KPI 快照 / sim_sandbox 结论）**零回写且诚实失败**（`EXECUTOR_NOT_IMPLEMENTED` + 具体缺口），" +
        "**不再**返回 MO 形态假单号（兜底早已从 MockActionExecutor 换成 UnwiredActionExecutor）。见本体 §8 G-PLAN-CHANGE-NO-LEVER。",
    ],
  },
};

/**
 * 解析某 ActionType 的有效回写声明：**注册在类型上的 `effects` 优先**，缺省回落平台内置登记表。
 * 纯函数（无 IO），供服务层与影响分析共用一条规则。
 */
export function resolveActionEffects(
  actionTypeKey: string,
  type?: { effects?: ActionEffectSpec } | null,
): ActionEffectSpec | undefined {
  return type?.effects ?? BUILTIN_ACTION_EFFECTS[actionTypeKey];
}

/** 影响分析结果：批准执行这个 Action 会动到什么。 */
export interface ActionImpact {
  actionTypeKey: string;
  /** 生效版本（缺省 = ACTION_TYPE_DEFAULT_VERSION，见 contracts 注释）。 */
  version: number;
  coverage: "COMPLETE" | "PARTIAL" | "NONE";
  writes: ActionWriteTarget[];
  /** 声明表达不了的回写（诚实交底，供人读）。 */
  undeclared: string[];
}

/** 纯函数：把 ActionType（可能没注册）投影成影响分析结论。确定性排序（R6）。 */
export function describeActionImpact(actionTypeKey: string, type?: ActionTypeRecord | null): ActionImpact {
  const effects = resolveActionEffects(actionTypeKey, type);
  return {
    actionTypeKey,
    version: actionTypeVersionOf(type),
    coverage: effects?.coverage ?? "NONE",
    writes: actionWriteTargets(effects ? { effects } : undefined),
    undeclared: effects?.undeclared ?? [],
  };
}

/**
 * ActionDraft + 本单 additive 字段的**局部结构视图**。
 * 缘由：datacore 运行期用的是 `domain.ts` 手写的 `ActionDraft` 接口（与 contracts 的
 * `ActionDraftSchema` 早已各写一份，例如 `fingerprint` 只在 domain 侧有）。本单范围边界不含
 * `domain.ts`，故在此以交集类型加宽；值本身照常经仓储落库（memory=structuredClone、
 * pg=`JSON.stringify(item)` 存 doc 列，两路都原样保留该字段，无需迁移/不触 R9）。
 */
type VersionedActionDraft = ActionDraft & { actionTypeVersion?: number };

const invalidStep = (msg: string) => new AppError("INVALID_STEP", msg, 409);
const noEligibleApprover = (role: string) =>
  new AppError("NO_ELIGIBLE_APPROVER", `审批链角色 ${role} 没有可用审批人（发起人不得自批）`, 422);

function baseRole(r: string): string {
  return r.split(":")[0] as string;
}

type SelfApprovePolicy = "STRICT" | "ALLOW_ADMIN" | "ALLOW_ALL";

/**
 * SA：解析租户级自审策略（粗粒度兜底）。优先级：env `SELF_APPROVE_POLICY` 显式覆盖 →
 * demo 演示租户默认 `ALLOW_ADMIN`（解锁单 admin 演示闭环）→ 其余 `STRICT`（现行职责分离，向后兼容）。
 * 确定性、零迁移；细粒度由 `ActionType.selfApproveAllowed` 覆盖。
 */
function tenantSelfApprovePolicy(tenantId: string): SelfApprovePolicy {
  const env = (process.env.SELF_APPROVE_POLICY ?? "").toUpperCase();
  if (env === "STRICT" || env === "ALLOW_ADMIN" || env === "ALLOW_ALL") return env;
  if (tenantId === "demo") return "ALLOW_ADMIN";
  return "STRICT";
}

/** SA：在给定租户/类型/审批人角色下，发起人自审是否生效（类型显式 ∨ 租户策略允许）。 */
function selfApproveAllowedFor(tenantId: string, type: ActionTypeRecord | undefined, approverRoles: string[]): boolean {
  if (type?.selfApproveAllowed === true) return true;
  const policy = tenantSelfApprovePolicy(tenantId);
  if (policy === "ALLOW_ALL") return true;
  if (policy === "ALLOW_ADMIN") return approverRoles.some((r) => baseRole(r) === "admin");
  return false;
}

const hasStepRole = (roles: string[], stepRole: string): boolean =>
  roles.some((r) => baseRole(r) === stepRole || r === stepRole);

/** Minimal JSON-schema check: required keys + primitive type tags. */
function validateParams(schema: Record<string, unknown>, payload: Record<string, unknown>): void {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const k of required) {
    if (payload[k] === undefined || payload[k] === null || payload[k] === "") {
      throw validationError(`payload.${k} is required`);
    }
  }
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [k, def] of Object.entries(props)) {
    const v = payload[k];
    if (v === undefined || !def.type) continue;
    const t = def.type;
    const ok =
      (t === "string" && typeof v === "string") ||
      (t === "number" && typeof v === "number") ||
      (t === "boolean" && typeof v === "boolean") ||
      (t === "object" && typeof v === "object") ||
      (t === "array" && Array.isArray(v));
    if (!ok) throw validationError(`payload.${k} must be of type ${t}`);
  }
}

/**
 * S2 Action approval: DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING →
 * EXECUTED / EXECUTION_FAILED, with REJECTED / CANCELLED branches. All
 * transitions emit action.* events through the C-2 outbox.
 */
export class ActionService {
  private executor: ActionExecutor = new MockActionExecutor();
  private retryDelaysMs = [50, 100, 200];
  /**
   * Action 三段埋点注册表。`app.ts` 构造处传入 app 级 Metrics → 埋点直接汇入 `/metrics` 输出
   * （守门测试：`test/action-metrics-endpoint.seam.test.ts`，效果层断言 —— 真跑一个 Action 后
   * `GET /metrics` 文本里 dc_action_* 计数 > 0）。不传时退化为服务自有注册表：计数仍记、
   * 但只有 `services.actions.metrics` 读得到，对外等于不存在 —— 单测直连服务时才用这条退路。
   */
  readonly metrics: Metrics;
  private am: ActionMetrics;

  constructor(
    private repos: Repos,
    private rules: RulesService,
    private outbox: OutboxService,
    private notifications?: import("./notifications.js").NotificationService,
    metrics?: Metrics,
  ) {
    this.metrics = metrics ?? new Metrics();
    this.am = new ActionMetrics(this.metrics);
  }

  /** Test hook / deployment hook: swap the write-back adapter. */
  setExecutor(executor: ActionExecutor, retryDelaysMs?: number[]): void {
    this.executor = executor;
    if (retryDelaysMs) this.retryDelaysMs = retryDelaysMs;
  }

  /** 部署/测试钩子：把 Action 埋点并入外部（app 级）注册表。 */
  setMetrics(metrics: Metrics): void {
    (this as { metrics: Metrics }).metrics = metrics;
    this.am = new ActionMetrics(metrics);
  }

  /**
   * 影响分析：批准执行这个 ActionType 会写哪个 ObjectType 的哪些 property。
   * 读注册在类型上的 `effects`，缺省回落 `BUILTIN_ACTION_EFFECTS`；未声明诚实返回 coverage=NONE
   * （**不知道 ≠ 无副作用**）。
   */
  async describeImpact(ctx: AuthCtx, actionTypeKey: string): Promise<ActionImpact> {
    const type = await this.getType(ctx.tenantId, actionTypeKey);
    return describeActionImpact(actionTypeKey, type);
  }

  async registerType(ctx: AuthCtx, type: Omit<ActionTypeRecord, "id" | "tenantId">): Promise<ActionTypeRecord> {
    if (!Array.isArray(type.approvalChain) || type.approvalChain.length < 1 || type.approvalChain.length > 3) {
      throw validationError("approvalChain must have 1–3 steps");
    }
    const existing = (await this.repos.actionTypes.list(ctx.tenantId, (t) => t.key === type.key))[0];
    const rec: ActionTypeRecord = { id: existing?.id ?? `atype_${ctx.tenantId}_${type.key}`, tenantId: ctx.tenantId, ...type };
    await this.repos.actionTypes.put(rec);
    return rec;
  }

  async listTypes(ctx: AuthCtx): Promise<ActionTypeRecord[]> {
    return this.repos.actionTypes.list(ctx.tenantId);
  }

  async getType(tenantId: string, key: string): Promise<ActionTypeRecord | undefined> {
    return (await this.repos.actionTypes.list(tenantId, (t) => t.key === key))[0];
  }

  async create(
    ctx: AuthCtx,
    input: {
      actionTypeKey: string;
      payload: Record<string, unknown>;
      origin?: { taskId?: string; agentId?: string };
      submit?: boolean;
    },
  ): Promise<ActionDraft> {
    // WO-GSIM-5-ACTION 幂等：同方案（确定性指纹）已采纳 → 返回既有草稿·不重复建 Action/物化（G-LOOP-FEEDBACK）。
    const fingerprint = planFingerprint(input.actionTypeKey, input.payload);
    if (fingerprint) {
      const existing = (await this.repos.actionDrafts.list(ctx.tenantId, (d) => d.fingerprint === fingerprint))[0];
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const draft: ActionDraft = {
      id: newId("act"),
      tenantId: ctx.tenantId,
      actionTypeKey: input.actionTypeKey,
      payload: input.payload,
      origin: { ...input.origin, userId: ctx.userId },
      status: "DRAFT",
      approvalSteps: [],
      ...(fingerprint ? { fingerprint } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.actionDrafts.put(draft);
    if (input.submit !== false) return this.submit(ctx, draft.id);
    return draft;
  }

  /** C10 submit validation: zod/schema params + rule pre-check + non-empty chain + self-approval skip. */
  async submit(ctx: AuthCtx, draftId: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, draftId);
    // 埋点：失败分型逐个 throw 点显式登记（不靠猜 error code），未预期异常兜底 "unexpected"。
    let outcome: ActionSubmitOutcome = "unexpected";
    const typeKey = draft.actionTypeKey;
    try {
      const result = await this.submitInner(ctx, draft, (o) => { outcome = o; });
      outcome = "success";
      return result;
    } finally {
      this.am.submit(ctx.tenantId, typeKey, outcome);
    }
  }

  private async submitInner(
    ctx: AuthCtx,
    draft: ActionDraft,
    fail: (outcome: ActionSubmitOutcome) => void,
  ): Promise<ActionDraft> {
    if (draft.status !== "DRAFT") {
      fail("invalid_state");
      throw invalidStep(`draft is ${draft.status}, expected DRAFT`);
    }
    const type = await this.getType(ctx.tenantId, draft.actionTypeKey);
    // WO-GSIM-5-ACTION：`plan_change` 键被 S&OP「计划变更」(required versionId) 与全局项目推演采纳共享；
    // 后者由 source:"global-sim" 判别，校验其自有 payload（source+objective），不套 S&OP paramsSchema。
    const isGlobalSimPlan = draft.actionTypeKey === "plan_change" && draft.payload?.source === "global-sim";
    if (isGlobalSimPlan) {
      if (!draft.payload.objective) {
        fail("validation_failed");
        throw validationError("payload.objective is required");
      }
    } else if (type) {
      try {
        validateParams(type.paramsSchema, draft.payload);
      } catch (err) {
        fail("validation_failed");
        throw err;
      }
    }
    if (type && !isGlobalSimPlan) {
      if (type.checkRules.length > 0) {
        const verdicts = await this.rules.evaluate(ctx, type.checkRules, draft.payload);
        const blocked = verdicts.filter((v) => !v.passed && v.severity === "BLOCK");
        if (blocked.length > 0) {
          // 规则引擎 BLOCK ≠ payload 写错：分开计数，"失败率"才指导得了行动。
          fail("rule_blocked");
          throw validationError(`规则预检不通过: ${blocked.map((b) => b.explanation).join("; ")}`);
        }
      }
    }
    const chain = type?.approvalChain ?? [{ role: "admin" }];
    if (chain.length === 0) {
      fail("validation_failed");
      throw validationError("approval chain is empty");
    }
    if (type) {
      // Self-approval guard: every step role must have an approver ≠ the originator
      // (the step auto-skips to another user with the role; none → submit fails).
      // SA：当租户策略/类型允许自审且发起人本人持该步角色时，把发起人计入 eligible（不再误抛）。
      const users = await this.repos.users.list(ctx.tenantId);
      const originId = draft.origin.userId;
      const originUser = users.find((u) => u.id === originId || u.username === originId);
      const originRoles = originUser?.roles ?? ctx.roles;
      const selfOk = selfApproveAllowedFor(ctx.tenantId, type, originRoles);
      for (const step of chain) {
        const eligible = users.filter(
          (u) =>
            u.id !== originId &&
            u.username !== originId && // debug-auth contexts carry the username as userId
            u.roles.some((r) => baseRole(r) === step.role || r === step.role),
        );
        if (eligible.length === 0) {
          const selfEligible = selfOk && hasStepRole(originRoles, step.role);
          if (!selfEligible) {
            fail("no_approver");
            throw noEligibleApprover(step.role);
          }
        }
      }
    }
    // ActionType 演进：提交即快照「本 payload 是按哪一版 paramsSchema 校验通过的」。
    // payload 提交后不可变，所以这一刻的版本就是这条历史记录的永久解释坐标（R13）。
    // 类型未注册（chain 回落 admin 兜底）→ 不写版本：诚实留空好过记一个凭空的 1。
    if (type) (draft as VersionedActionDraft).actionTypeVersion = actionTypeVersionOf(type);
    draft.approvalSteps = chain.map((s, i) => ({ seq: i + 1, role: s.role }));
    draft.status = "PENDING_APPROVAL";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.pending_approval", {
      draftId: draft.id,
      actionTypeKey: draft.actionTypeKey,
      step: 1,
      role: chain[0]?.role,
    });
    // §9 通知中心：定向通知第一步审批角色（排除发起人）。
    if (chain[0]?.role) {
      await this.notifications?.notifyRole(ctx.tenantId, chain[0].role, draft.origin.userId, {
        kind: "approval_pending",
        title: "待审批",
        body: `有一条 ${draft.actionTypeKey} 待你审批`,
        refType: "action",
        refId: draft.id,
      });
    }
    return draft;
  }

  async get(ctx: AuthCtx, id: string): Promise<ActionDraft> {
    const draft = await this.repos.actionDrafts.get(ctx.tenantId, id);
    if (!draft) throw notFound("action draft");
    return draft;
  }

  currentStep(draft: ActionDraft): { seq: number; role: string } | undefined {
    const step = draft.approvalSteps.find((s) => !s.decision);
    return step ? { seq: step.seq, role: step.role } : undefined;
  }

  async list(ctx: AuthCtx, q: { status?: string; role?: string }): Promise<ActionDraft[]> {
    let drafts = await this.repos.actionDrafts.list(ctx.tenantId, (d) => (q.status ? d.status === q.status : true));
    if (q.role === "mine") {
      // "待我审批" = current step role ∈ my roles (and I am not the originator).
      // SA：自审生效时，也含我自己发起、当前步由我可审的草稿（前端按 origin.userId===me 标"自审"）。
      const myRoles = new Set(ctx.roles.map(baseRole));
      const selfOk = selfApproveAllowedFor(ctx.tenantId, undefined, ctx.roles);
      drafts = drafts.filter((d) => {
        if (d.status !== "PENDING_APPROVAL") return false;
        const step = this.currentStep(d);
        if (!step || !myRoles.has(step.role)) return false;
        return d.origin.userId !== ctx.userId || selfOk;
      });
    }
    return drafts.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async approve(ctx: AuthCtx, id: string, comment?: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, id);
    // 前置校验段：任何一条不过 = denied（角色不符 / 自批被拦 / 状态机非法）。
    // 与 rejected（审批人主动拒绝，业务结论）分开计，别把人的决定算进系统失败率。
    let step: ActionDraft["approvalSteps"][number];
    try {
      if (draft.status !== "PENDING_APPROVAL") throw invalidStep(`draft is ${draft.status}`);
      const pending = draft.approvalSteps.find((s) => !s.decision);
      if (!pending) throw invalidStep("no pending step");
      if (!ctx.roles.some((r) => baseRole(r) === pending.role || r === pending.role)) {
        throw invalidStep(`当前步骤需要角色 ${pending.role}`);
      }
      if (ctx.userId === draft.origin.userId) {
        // SA：发起人自批——按租户策略/类型放行并显式留痕（R13）；否则维持现职责分离阻断。
        const type = await this.getType(ctx.tenantId, draft.actionTypeKey);
        if (!selfApproveAllowedFor(ctx.tenantId, type, ctx.roles)) throw invalidStep("发起人不得自批");
        pending.selfApproved = true;
      }
      step = pending;
    } catch (err) {
      this.am.approval(ctx.tenantId, draft.actionTypeKey, err instanceof AppError ? "denied" : "unexpected");
      throw err;
    }
    step.decision = "APPROVE";
    step.approverId = ctx.userId;
    step.comment = comment;
    step.decidedAt = new Date().toISOString();
    const next = draft.approvalSteps.find((s) => !s.decision);
    if (next) {
      this.am.approval(ctx.tenantId, draft.actionTypeKey, "step_advanced");
      draft.updatedAt = step.decidedAt;
      await this.repos.actionDrafts.put(draft);
      await this.outbox.emit(ctx.tenantId, "action.pending_approval", {
        draftId: draft.id,
        actionTypeKey: draft.actionTypeKey,
        step: next.seq,
        role: next.role,
      });
      await this.notifications?.notifyRole(ctx.tenantId, next.role, draft.origin.userId, {
        kind: "approval_pending",
        title: "待审批",
        body: `有一条 ${draft.actionTypeKey} 进入下一审批环节，待你审批`,
        refType: "action",
        refId: draft.id,
      });
      return draft;
    }
    this.am.approval(ctx.tenantId, draft.actionTypeKey, "approved");
    draft.status = "APPROVED";
    draft.updatedAt = step.decidedAt;
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.approved", { draftId: draft.id, actionTypeKey: draft.actionTypeKey });
    // §9 通知发起人：审批通过。
    await this.notifications?.notify(ctx.tenantId, {
      userId: draft.origin.userId,
      kind: "action_approved",
      title: "审批通过",
      body: `你发起的 ${draft.actionTypeKey} 已审批通过`,
      refType: "action",
      refId: draft.id,
    });
    // APPROVED → outbox → executor (mock adapter) with 3 retries / exponential backoff.
    return this.execute(ctx.tenantId, draft.id);
  }

  async reject(ctx: AuthCtx, id: string, comment: string): Promise<ActionDraft> {
    if (!comment || !comment.trim()) {
      // 请求本身不合法，且此刻还没取到草稿 → action_type 只能诚实记 "unknown"（不猜）。
      this.am.approval(ctx.tenantId, "unknown", "invalid_request");
      throw validationError("reject comment is required");
    }
    const draft = await this.get(ctx, id);
    let step: ActionDraft["approvalSteps"][number];
    try {
      if (draft.status !== "PENDING_APPROVAL") throw invalidStep(`draft is ${draft.status}`);
      const pending = draft.approvalSteps.find((s) => !s.decision);
      if (!pending) throw invalidStep("no pending step");
      if (!ctx.roles.some((r) => baseRole(r) === pending.role || r === pending.role)) {
        throw invalidStep(`当前步骤需要角色 ${pending.role}`);
      }
      step = pending;
    } catch (err) {
      this.am.approval(ctx.tenantId, draft.actionTypeKey, err instanceof AppError ? "denied" : "unexpected");
      throw err;
    }
    this.am.approval(ctx.tenantId, draft.actionTypeKey, "rejected");
    step.decision = "REJECT";
    step.approverId = ctx.userId;
    step.comment = comment;
    step.decidedAt = new Date().toISOString();
    draft.status = "REJECTED";
    draft.updatedAt = step.decidedAt;
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.rejected", { draftId: draft.id, step: step.seq, comment });
    // §9 通知发起人：被拒（必带意见）。
    await this.notifications?.notify(ctx.tenantId, {
      userId: draft.origin.userId,
      kind: "action_rejected",
      title: "审批被拒",
      body: `你发起的 ${draft.actionTypeKey} 被拒：${comment}`,
      refType: "action",
      refId: draft.id,
    });
    return draft;
  }

  async cancel(ctx: AuthCtx, id: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, id);
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(draft.status)) {
      throw invalidStep(`cannot cancel in status ${draft.status} (only before EXECUTING)`);
    }
    const isAdmin = ctx.roles.some((r) => baseRole(r) === "admin");
    if (draft.origin.userId !== ctx.userId && !isAdmin) {
      throw invalidStep("仅发起人或管理员可取消");
    }
    draft.status = "CANCELLED";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.cancelled", { draftId: draft.id });
    return draft;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async execute(tenantId: string, draftId: string): Promise<ActionDraft> {
    const draft = await this.repos.actionDrafts.get(tenantId, draftId);
    if (!draft || draft.status !== "APPROVED") {
      this.am.execute(tenantId, draft?.actionTypeKey ?? "unknown", "invalid_state");
      throw invalidStep("draft not in APPROVED state");
    }
    const typeKey = draft.actionTypeKey;
    draft.status = "EXECUTING";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    let attempts = 0;
    let lastError: string | undefined;
    while (attempts < this.retryDelaysMs.length) {
      attempts++;
      try {
        const result = await this.executor.execute(draft);
        if (result.ok) {
          this.am.executeAttempt(tenantId, typeKey, "success");
          this.am.execute(tenantId, typeKey, "success");
          draft.status = "EXECUTED";
          draft.executionResult = { ok: true, targetRef: result.targetRef, attempts };
          draft.updatedAt = new Date().toISOString();
          await this.repos.actionDrafts.put(draft);
          await this.outbox.emit(tenantId, "action.executed", {
            draftId: draft.id,
            targetRef: result.targetRef,
            attempts,
          });
          return draft;
        }
        // 执行器"有序拒绝"（ok:false）与"抛异常"分开计：前者查业务前提，后者查平台/依赖故障。
        this.am.executeAttempt(tenantId, typeKey, "executor_rejected");
        lastError = result.error ?? "executor returned ok=false";
      } catch (err) {
        this.am.executeAttempt(tenantId, typeKey, "executor_error");
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempts < this.retryDelaysMs.length) await this.sleep(this.retryDelaysMs[attempts - 1] as number);
    }
    this.am.execute(tenantId, typeKey, "failed");
    draft.status = "EXECUTION_FAILED";
    draft.executionResult = { ok: false, error: lastError, attempts };
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(tenantId, "action.execution_failed", { draftId: draft.id, error: lastError, attempts });
    return draft;
  }

  /** GET /a/v1/action-drafts/{id}/audit — full trail: snapshot + decisions + execution + events. */
  async audit(ctx: AuthCtx, id: string): Promise<Record<string, unknown>> {
    const draft = await this.get(ctx, id);
    const events = await this.repos.outboxEvents.list(
      ctx.tenantId,
      (e) => e.event.startsWith("action.") && e.payload.draftId === id,
    );
    return {
      draft,
      steps: draft.approvalSteps,
      executionResult: draft.executionResult ?? null,
      events: events
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map((e) => ({ event: e.event, payload: e.payload, at: e.createdAt, status: e.status })),
    };
  }
}
