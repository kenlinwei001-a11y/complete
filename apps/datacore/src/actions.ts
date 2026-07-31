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
  // plan_change 仅 source==="global-sim" 有真回灌；其余 source 落未实现（执行期按 payload 二次判定）。
  plan_change: "WIRED",
  // —— 尚未接执行器：审批通过后不写任何真值 ——
  // ⚠️ 这三条**不是**「设计上无副作用」。`采纳产能保障方案` 在 mapping.ts 里明确声明要写回生产工单MO；
  // `adopt_mitigation` 是决策内核 commit 的落点。它们是**欠账**，标 NOT_IMPLEMENTED 让欠账可见、可门禁。
  adopt_mitigation: "NOT_IMPLEMENTED",
  采纳经营方案: "NOT_IMPLEMENTED",
  采纳产能保障方案: "NOT_IMPLEMENTED",
};

/** plan_change 只有 global-sim 来源真回灌——其余来源等同未实现（不得借 WIRED 之名假装写了）。 */
export function planChangeIsWired(payload: unknown): boolean {
  return (payload as { source?: unknown } | undefined)?.source === "global-sim";
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
    // 而平台**内置已注册**却没接执行器的（adopt_mitigation / 采纳经营方案 / 采纳产能保障方案）是**欠账**，
    // 在 ACTION_WIRING 里显式标 NOT_IMPLEMENTED → 诚实失败，让欠账可见、可门禁、不可伪装成 NO_WRITE。
    const wiring: ActionWiring = ACTION_WIRING[key] ?? "NO_WRITE";
    if (wiring === "NO_WRITE") return { ok: true, targetRef: `NO_WRITE:${key}` };
    return {
      ok: false,
      error:
        `EXECUTOR_NOT_IMPLEMENTED: 动作类型「${key}」尚未接入真实执行器，审批通过后不会写入任何真值。` +
        `此处诚实失败而非返回占位单号——曾经的兜底会返回 MO-2026-xxxx 形态的假工单号，` +
        `使「没做」与「做了」在界面与审计里完全无法区分（G-ACTION-NOOP-EXEC）。`,
    };
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
 * 全局联合推演「采纳方案」真实执行器（G-LOOP-FEEDBACK 数据半）：审批通过 → 执行时把采纳的方案
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
            reason: `全局联合推演采纳·两段电芯就近调运（${homeBase}→${base}）`,
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
        note: "采纳全局联合推演方案 → 每个 served 订单物化一张在产工单（承诺占用·预扣净产能）",
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
      "非 global-sim 的 plan_change 在 app.ts domainExecutor 里没有分支 → 落 MockActionExecutor，审批通过后实际零回写（上列三条 writes 均带 source==='global-sim' 条件，已把这一情况标出）",
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
   * Action 三段埋点注册表。构造点（`app.ts`）当前不传 → 退化为服务自有注册表：计数照记、
   * 可经 `services.actions.metrics` 读到，但**尚未汇入 `/metrics` 输出**（暴露需在 app.ts
   * 构造处多传一个 metrics 实参，超出本单范围边界，已在交付报告里交底）。
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
      this.am.submit(typeKey, outcome);
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
    // WO-GSIM-5-ACTION：`plan_change` 键被 S&OP「计划变更」(required versionId) 与全局联合推演采纳共享；
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
      this.am.approval(draft.actionTypeKey, err instanceof AppError ? "denied" : "unexpected");
      throw err;
    }
    step.decision = "APPROVE";
    step.approverId = ctx.userId;
    step.comment = comment;
    step.decidedAt = new Date().toISOString();
    const next = draft.approvalSteps.find((s) => !s.decision);
    if (next) {
      this.am.approval(draft.actionTypeKey, "step_advanced");
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
    this.am.approval(draft.actionTypeKey, "approved");
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
      this.am.approval("unknown", "invalid_request");
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
      this.am.approval(draft.actionTypeKey, err instanceof AppError ? "denied" : "unexpected");
      throw err;
    }
    this.am.approval(draft.actionTypeKey, "rejected");
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
      this.am.execute(draft?.actionTypeKey ?? "unknown", "invalid_state");
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
          this.am.executeAttempt(typeKey, "success");
          this.am.execute(typeKey, "success");
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
        this.am.executeAttempt(typeKey, "executor_rejected");
        lastError = result.error ?? "executor returned ok=false";
      } catch (err) {
        this.am.executeAttempt(typeKey, "executor_error");
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempts < this.retryDelaysMs.length) await this.sleep(this.retryDelaysMs[attempts - 1] as number);
    }
    this.am.execute(typeKey, "failed");
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
