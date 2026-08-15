import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { AgentRunRecord, BuildPipeline, BuildPipelineKind, PlanBuilderCanvas, PlanBuilderCompileResult, PlanBuilderPublishResult, CreatePlanBuilderBody, UpdatePlanBuilderBody, PlanStep, Scenario, SkillCompileDiagnostic, SkillCompileStageReport, FactoryCalendar, OpsPlaybook, ReconcileAction, SchemaReconcileCandidate } from "@platform/contracts";
import { BOUNDARY_IMPACT, boundaryVersion, deriveDisposition, deriveDispositionOptions, SEG_REGISTRY } from "@platform/contracts";
// WO-DECISION-INFO-FE · 决策三块（影响面 / 不作为后果 / 方案代价）的 mock 载荷类型，
// 与真后端共用同一份契约 ⇒ mock 与引擎口径不可能分家。
import type {
  DispositionOptions,
  DispositionSideEffect,
  DoNothing,
  DoNothingOrderDelay,
  Exposure,
  ExposureCustomer,
  ExposureOrder,
  MissingEvidence,
} from "@platform/contracts";
// WO-UNBLOCK-SKILL-FE · 编译 mock 复用**契约里那份**纯函数实现（Parser/图派生住在 contracts，
// 见 packages/contracts/src/skill-compile.ts）——绝不在此另抄一套 AST/图推导，抄了就是"同一概念两套词表"。
import {
  SOLVER_CATEGORIES,
  SOLVER_CATEGORY_META,
  deriveSkillReasoningGraph,
  parseSkillToAst,
  skillDeclaredRefKeys,
  skillGraphRefKeys,
} from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：触红线判定读契约，禁内联裸阈值。
import { OUTSOURCE_REDLINE } from "@platform/contracts";
// WO-ACTIVE-EDGE-UX：差值算法与"未知 key 不静默忽略"的判据一律走契约唯一实现，mock 不另写一份。
import { diffTickStates, unknownPropagationRuleKeys, type PropagationRule } from "@platform/contracts";
// WO-PROCESS-INSTANCE：等待态词表单源（mock 也不许手抄一份五值数组）。
import { PROCESS_TASK_WAIT_STATES } from "@platform/contracts";
import type { RiskTimelineOutput } from "@platform/contracts";
// WO-R1 收编 kit_readiness mock：基地解析镜像引擎 `resolveBaseRef`，基地表读契约单一来源（禁前端另拍一张）。
import { BASE_REGISTRY } from "@platform/contracts";
// WO-ENTERPRISE-STATE：捕获核**与 datacore 共用同一份纯函数**（治「mock 与引擎口径分家」，见下方 mockEnterpriseStates 注释）。
import {
  captureEnterpriseState,
  diffEnterpriseStates,
  ENTERPRISE_STATE_REAL_WORLD_ID,
  forkEnterpriseState,
  type EnterpriseState,
  type EnterpriseStateKpiInput,
  type EnterpriseStateTypeInput,
  type LogicalClock,
} from "@platform/contracts";
// WO-BEFE-WIRE-3：影响传播端点的**入参校验走契约本尊**（与 datacore app.ts 同一个 schema）——
// mock 自己再写一套 if 判空，就是"同一份契约两套解释"，两边迟早分家。
import { ImpactAnalysisRequestSchema, type ImpactAnalysisResponse } from "@platform/contracts";
// WO-BEFE-D：组织世界 mock —— **判定逻辑不在此重写**，走 orgFixtures 里那份复用
// contracts `evaluateLimit`/`delegationActive` 的解析器（与真后端同一份实现，见该文件顶注纪律①）。
import { ApprovalMatterSchema, DecisionGraphSchema, type DecisionGraph } from "@platform/contracts";
import { orgChartMock, orgState, resetOrgState, resolveApproversMock, ORG_AUTHORITIES, ORG_DELEGATIONS, ORG_LIMITS } from "./orgFixtures";
import {
  ACCOUNTS,
  BASES,
  CONNECTOR_TYPES,
  FALLBACK_CLUSTERS,
  FEATURE_REGISTRY,
  featuresForAccount,
  GRAPH,
  ORDERS,
  PACKAGE_ID,
  POLICIES,
  PLANS,
  RISK_TIMELINE,
  RISK_DISPOSITION_SEED,
  ROLES_RESPONSE,
  SYNTHETIC_PHASES,
  SYNTHETIC_REPORT,
  // WO-BEFE-B · 行动与审批组
  OPS_PERSONAS,
  OPS_POOLS,
  TENANT_ID,
  tickReport,
  TS_AGG_POINTS,
  workspaceForAccount,
  type MockAccount,
} from "./fixtures";
import { newPlanBuilderCanvas } from "./planBuilderFixtures";
import { accountFromAuth, db, tokenFor, type MockTask } from "./db";
import { BUILD_PIPELINE_KINDS, factoryPipeline, pipelineOrder, resolvePipeline } from "./pipelineFixtures";
// WO-WAITING-STATES-FE · 流程等待态 fixture（过契约 schema 的真种子子集，见该文件头三重防漂移机制）
import { PROCESS_DEFINITIONS_RESPONSE, processInspectFixture, processInstancesFixture } from "./processWaitFixtures";
import { historyBundleFor, LIVED_WATERMARK } from "./livedInFixtures";

/**
 * C5 求解器目录（`GET /a/v1/solvers/registry` 的 mock 数据源）——**提升为模块级单一来源**。
 *
 * 为何不再内联在那一个 handler 里：`POST /b/v1/skills/:id/publish` 的引用存在性探针
 * （真后端 `probeMissingRefs`·`apps/agentcore/src/resources.ts`）要拿"哪些求解器真的注册了"
 * 来判死路。若在探针那边另抄一份 key 清单，就是本仓治过的老病——**同一事实两份词表**，
 * 谁改一边另一边照绿（`sideEffect` 三套词表 → 判定永不触发，假绿第 6 例）。故两处共用本常量。
 */
const MOCK_SOLVER_REGISTRY = [
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", argHints: { modelId: "型号 ID", qty: "需求量", weeks: "周数" }, domain: "plan", outputShape: ["capWanP50", "capWanP90", "gap", "ok"] },
  { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", argHints: { baseId: "基地 ID" }, domain: "plan", outputShape: ["matrix"] },
  { key: "selection_optimize", name: "组合最优化", description: "通用 0/1 选择最优化（CP-SAT 可证最优）：预算约束下选价值最大子集。", argHints: { items: "候选项", budget: "预算上限" }, domain: "generic", outputShape: ["selected", "totalValue"] },
  { key: "order_fullchain", name: "订单全链推演", description: "逐单三关联判（交期/齐套/财务三闸）+ 统一结论（可接/提价X%接/不建议接）。", argHints: { so: "订单号" }, domain: "decision", outputShape: ["verdict", "chain"] },
] as const;

/** 引用模式增量 §2.3：规则被引用反查（mock：agent ruleKeys + 计划步骤 evaluate_rules） */
function ruleReferences(ruleKey: string): { kind: string; key: string; name?: string; via: string }[] {
  const out: { kind: string; key: string; name?: string; via: string }[] = [];
  for (const a of db.agents) {
    const keys = a.ruleBindings?.ruleKeys;
    if (Array.isArray(keys) && keys.includes(ruleKey)) out.push({ kind: "agent", key: a.key, name: a.name, via: "ruleBindings" });
  }
  for (const w of db.workflows) {
    if (w.steps.some((s) => s.type === "evaluate_rules" && Array.isArray(s.params.ruleIds) && s.params.ruleIds.includes(ruleKey))) {
      out.push({ kind: "workflow", key: w.key, name: w.name, via: "steps.evaluate_rules" });
    }
  }
  return out;
}
import { registerTaskScript, releaseNextSegment } from "./mockEventSource";
import { scriptForQuery } from "./sseScripts";
import {
  mockBottleneckMatrix,
  mockCapacityForecast,
  mockMultiObj,
  mockPlanAudit,
  mockPlanGenerate,
  mockPortfolio,
  mockGlobalSim,
  PORT_TRANSFERS,
  mockSopAdvance,
  mockSopReschedule,
  mockBaseOutlook,
  mockChainImpediments,
  PLAN_VERSION_CURRENT,
  SopMockError,
  sopPlanLocked,
  type MockAuditInput,
  type MockForecastArgs,
} from "./simSolvers";
// WO-MOCK-SCALE-TRUTH：年口径（DemandSegment / SopVersionRow / AOP 营收）单一来源。
import { AOP_BASE_REVENUE_YI, DEMAND_YEAR, FINANCE_PNL_YEAR, SOP_VERSION_ROWS, SOP_VERSION_TOTAL_GAP_WAN, SUPPLY_V7_WAN } from "./sopScale";
import {
  affectedOrdersOutput,
  AOP_RESPONSE,
  CALIBRATION_HISTORY,
  CALIBRATION_PROPOSALS,
  calibrationReportFor,
  DATA_HEALTH,
  MAPPING_ROWS,
  QUARTERLY_RESPONSE,
} from "./planFixtures";

const err = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, requestId: `req_${Math.random().toString(36).slice(2, 10)}` } }, { status });

/**
 * WO-BEFE-B · 往 R4 留痕流里追一条 `action.*` 事件（真后端是 `outbox.emit`）。
 * `at` 用递增序号而非 `Date.now()`：R6 确定性——同一串操作重跑必须字节级一致。
 */
let actionEventSeq = 0;
function pushActionEvent(event: string, payload: Record<string, unknown>): void {
  actionEventSeq += 1;
  db.actionEvents.push({
    event,
    payload,
    at: `2026-06-12T09:${String(actionEventSeq % 60).padStart(2, "0")}:00Z`,
    status: "SENT",
  });
}

// ---------------------------------------------------------------------------
// WO-LIVE-DISPOSITION · mock 处置表**真重算**（KILL-MOCK：不写死两套结果）。
// 与后端 `buildRiskPlanRows` 同结构（主因素行 + 峰值≥90 备份行 + 14 天内 C21 反提 S&OP，按启动排序），
// 且逐行 steps 由**同一份** `deriveDisposition`（@platform/contracts·后端 risk.ts / base-outlook.ts 也 import 它）
// 从 mock 真数据（RISK_DISPOSITION_SEED.freeDaily × capRatio × horizon vs 卡上 affectedOrders Σqty）派生。
// 基线（apply 空 → capRatio=1）与杠杆推演态（apply 非空 → capRatio≠1）走**同一条路径**，故"调杠杆→重算→真变"。
// 确定性 R6：无 Date.now/随机。
// ---------------------------------------------------------------------------
function mockCapRatio(apply: { objectType?: unknown; prop?: unknown; value?: unknown }[]): number {
  let ratio = 1;
  for (const a of apply) {
    const key = `${String(a.objectType ?? "")}.${String(a.prop ?? "")}`;
    const baseline = RISK_DISPOSITION_SEED.leverBaseline[key];
    const v = Number(a.value);
    if (!Number.isFinite(baseline) || !Number.isFinite(v) || baseline === 0 || v === 0) continue;
    // 利用率类为反向（利用率↑ = 空闲可用产能↓）；其余（OEE/良率/在手/覆盖/外协）正向。
    ratio *= RISK_DISPOSITION_SEED.inverseProps.includes(String(a.prop)) ? baseline! / v : v / baseline!;
  }
  return Math.round(ratio * 1e6) / 1e6;
}

function mmddMock(startIso: string, day: number): string {
  return new Date(Date.parse(`${startIso}T00:00:00Z`) + day * 86400000).toISOString().slice(5, 10);
}

// ---------------------------------------------------------------------------
// WO-DECISION-INFO-FE · mock 的**决策三块**（影响面 / 不作为后果 / 多方案代价）。
//
// 口径逐条照抄真后端（`apps/datacore/src/solvers/decision-info.ts`），不是另写一套看着像的：
//   exposure      = 卡片**已有的那份** affectedOrders 聚合（不重新筛单）；金额 Σ qty×SEG 参考单价/1e4
//                   （与 datacore `orderRevenueYi` 逐字同式·SEG_REGISTRY 单一价基）
//   exposureOrder = `assignExposureRanks` 同判据：**hasExposure 是主序**（零敞口一律沉底），
//                   其后 金额↓ → 单数↓ → 最早交期↑ → baseId↑（R6 全序·同输入同序）
//   doNothing     = catchUp 用**与 planRows 同一份** shortfall/freeDaily（同一出处·不各算一套）；
//                   delay 标 `ESTIMATED`（mock 的 affectedOrders[].delay 同样是估算，绝不当实测）；
//                   penalty **恒 EMPTY**（与真后端一致：C01–C33 无交付罚则承载 → 前端必须显"未承载"）
//   options       = `deriveDispositionOptions`（@platform/contracts **同一份**纯函数），
//                   代价层照 datacore `attachOptionEvidence` 的形状装配：跨基地运费按真调拨台账算，
//                   加班/外协成本本体无承载 → EMPTY（不填 0），外协比例对 C08 红线（OUTSOURCE_REDLINE 单源）。
// 确定性 R6：全程无 Date.now / 无随机 —— 同 args 字节一致。
// ---------------------------------------------------------------------------
const SEG_PRICE_WAN: Record<string, number> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.priceWan]));
const SEG_NAME_OF: Record<string, string> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.seg]));
/** mock 世界的客户→细分映射（真后端走 `segOfCust` 的客户名集合；mock 客户是另一批名字，故在此显式列出）。 */
const MOCK_SEG_OF_CUST: Record<string, string> = { 蔚途汽车: "pas", 极光新能源: "ess", 星河储能: "ess" };
const mockSegKey = (cust: string): string => MOCK_SEG_OF_CUST[cust] ?? "pas";
const r2m = (v: number): number => Math.round(v * 100) / 100;
const r6m = (v: number): number => Math.round(v * 1e6) / 1e6;
/** 单张订单金额（亿元）= qty(套) × 细分单价(万元/套) / 1e4 —— 与 datacore orderRevenueYi 逐字同式。 */
const mockOrderRevenueYi = (cust: string, qty: number): number => r6m((qty * (SEG_PRICE_WAN[mockSegKey(cust)] ?? 0)) / 1e4);

type MockCard = RiskTimelineOutput["cards"][number];

/** ① 影响面（不含 rank —— rank 由 assignExposureRanks 统一回填，与真后端同结构）。 */
function mockExposure(card: MockCard, window: { fromDay: number; toDay: number }, forecastStart: string): Omit<Exposure, "rank"> {
  const orders: ExposureOrder[] = (card.affectedOrders ?? [])
    .map((a) => ({
      so: a.so,
      cust: a.cust,
      model: a.model,
      qty: a.qty,
      due: a.due,
      dueDay: a.dueDay,
      // mock 的 affectedOrders 不带 Order.pri —— 诚实留空串（前端渲成"未标"），不默认成"中"。
      pri: "",
      revenueYi: mockOrderRevenueYi(a.cust, a.qty),
      seg: SEG_NAME_OF[mockSegKey(a.cust)] ?? mockSegKey(a.cust),
    }))
    .sort((x, y) => x.dueDay - y.dueDay || (x.so < y.so ? -1 : 1));

  const byCust = new Map<string, ExposureCustomer>();
  for (const o of orders) {
    const e = byCust.get(o.cust);
    if (!e) {
      byCust.set(o.cust, { cust: o.cust, seg: o.seg, orderCount: 1, qty: o.qty, revenueYi: o.revenueYi, earliestDue: o.due, earliestDueDay: o.dueDay });
    } else {
      e.orderCount += 1;
      e.qty = r2m(e.qty + o.qty);
      e.revenueYi = r6m(e.revenueYi + o.revenueYi);
      if (o.dueDay < e.earliestDueDay) {
        e.earliestDue = o.due;
        e.earliestDueDay = o.dueDay;
      }
    }
  }
  const customers = [...byCust.values()].sort((a, b) => b.revenueYi - a.revenueYi || (a.cust < b.cust ? -1 : 1));
  const common = {
    baseId: card.baseId,
    baseName: card.base,
    window: { ...window, forecastStart },
    units: { qty: "套" as const, revenue: "亿元" as const },
  };
  if (orders.length === 0) {
    return {
      ...common,
      status: "EMPTY",
      orderCount: 0,
      totalQty: 0,
      revenueYi: 0,
      customerCount: 0,
      customers: [],
      orders: [],
      earliest: null,
      hasExposure: false,
      emptyReason: `本窗（D+${window.fromDay}…D+${window.toDay}·锚 ${forecastStart}）无订单交期落入：${card.base}基地在本 mock 数据集里没有窗内受影响订单 —— 有风险但本窗没有订单敞口`,
      // mock 数据集没有窗外订单台账 → 诚实 null（不编一张"窗外还有多少"的单）。
      nextOutsideWindow: null,
      provenance: [],
    };
  }
  return {
    ...common,
    status: "OK",
    orderCount: orders.length,
    totalQty: r2m(orders.reduce((a, o) => a + o.qty, 0)),
    revenueYi: Math.round(orders.reduce((a, o) => a + o.revenueYi, 0) * 1e4) / 1e4,
    customerCount: customers.length,
    customers,
    orders,
    earliest: { so: orders[0]!.so, cust: orders[0]!.cust, due: orders[0]!.due, dueDay: orders[0]!.dueDay },
    hasExposure: true,
    provenance: orders.slice(0, 3).map((o) => ({ objectType: "Order", objectId: o.so, field: "qty", value: o.qty })),
  };
}

/** 影响面排序键（与 datacore `assignExposureRanks` 同判据·hasExposure 为主序）。 */
function mockAssignRanks(list: Omit<Exposure, "rank">[]): Exposure[] {
  const ordered = [...list].sort((a, b) => {
    if (a.hasExposure !== b.hasExposure) return a.hasExposure ? -1 : 1;
    if (a.revenueYi !== b.revenueYi) return b.revenueYi - a.revenueYi;
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    const ea = a.earliest?.dueDay ?? Number.MAX_SAFE_INTEGER;
    const eb = b.earliest?.dueDay ?? Number.MAX_SAFE_INTEGER;
    if (ea !== eb) return ea - eb;
    return a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0;
  });
  const rankById = new Map(ordered.map((e, i) => [e.baseId, i + 1]));
  return list.map((e) => ({ ...e, rank: rankById.get(e.baseId) ?? ordered.length + 1 }));
}

/**
 * 违约金的**逐条核查结论** —— 与真后端 `buildPenaltyEvidence` 同结论：本仓无任何规则承载"交付延误赔多少"。
 * mock 里同样恒 EMPTY：如果 mock 给个数、真环境给 EMPTY，前端就会被 mock 训练成"总有金额可显"。
 */
const MOCK_PENALTY_EMPTY: MissingEvidence = {
  status: "EMPTY",
  reason:
    "违约金/罚则**当前本体无承载**：规则库 C01–C33 逐条核过，没有一条带交付延误罚金/费率（财务类均为闸门谓词、不带金额）；" +
    "唯一带罚金的字段 LongTermAgreement.breachPenaltyWan 是**供应商长协欠交**罚金（C27 口径），与「我方晚交客户单要赔多少」不是一回事 —— 拒绝挪用。",
  missingFields: ["Order.latePenaltyRatePerDay", "Customer.contractPenaltyRate", "RuleEntry(交付延误罚则).params"],
  checked: [
    "RuleEntry.C05/C08/C21/C27（逐条核过·无交付罚则）",
    "LongTermAgreement.breachPenaltyWan（供应商长协欠交·非交付延误）",
    "Order.*（so/cust/qty/due —— 无罚则字段）",
    "Customer.*（creditLimit/termDays —— 无罚则字段）",
  ],
};

/** ② 不作为后果（catchUp / delay / penalty / atRiskCustomers 四块各自独立标状态）。 */
function mockDoNothing(card: MockCard, exposure: Omit<Exposure, "rank">, shortfall: number, freeDaily: number): DoNothing {
  const delayNote =
    "delay = 由受影响订单的传导估算派生（与 affected_orders 同口径）——**确定性估算（R6 可重跑），非实测交付延误**；" +
    "要变成实测需接 Shipment 实际交付日 / 排产完工日回写。";
  const catchUp: DoNothing["catchUp"] =
    shortfall > 0 && freeDaily > 0
      ? {
          status: "OK",
          shortfall: r2m(shortfall),
          freeDaily: r2m(freeDaily),
          days: r2m(shortfall / freeDaily),
          unit: "天",
          formula: "缺口(套) ÷ 空闲日产能(套/日)；空闲日产能 = Σ Line.capacityDaily × (1 − Base.util/100)",
          provenance: [
            { objectType: "Line", objectId: card.baseId, field: "capacityDaily", value: r2m(freeDaily) },
            { objectType: "Order", objectId: card.baseId, field: "qty", value: r2m(shortfall) },
          ],
        }
      : {
          status: "EMPTY",
          reason:
            shortfall <= 0
              ? "本窗无产能缺口（可用产能覆盖窗内订单）→ 不存在\"自然消化天数\"这件事，不编一个数"
              : `${card.base}基地空闲日产能为 0（Σ Line.capacityDaily×(1−util/100) = 0）→ 缺口除不动，拒绝按任意日产能估天数`,
          missingFields: shortfall <= 0 ? [] : ["Line.capacityDaily", "Base.util"],
          checked: ["Line.capacityDaily", "Base.util", "Order.qty(窗内未来订单)"],
        };

  const delayOrders: DoNothingOrderDelay[] = (card.affectedOrders ?? [])
    .map((a) => ({ so: a.so, cust: a.cust, qty: a.qty, due: a.due, dueDay: a.dueDay, delayDays: a.delay, basis: "ESTIMATED" as const, basisNote: delayNote }))
    .sort((x, y) => y.delayDays - x.delayDays || (x.so < y.so ? -1 : 1));
  const delay: DoNothing["delay"] =
    delayOrders.length > 0
      ? { status: "OK", worstDays: delayOrders[0]!.delayDays, orders: delayOrders, note: delayNote }
      : { status: "EMPTY", reason: "本窗无受影响订单（见 exposure.emptyReason）→ 没有\"晚交几天\"这件事可算", missingFields: [], checked: ["Order.due(窗内)", "affected_orders.delay"] };

  const worstByCust = new Map<string, number>();
  for (const d of delayOrders) worstByCust.set(d.cust, Math.max(worstByCust.get(d.cust) ?? 0, d.delayDays));
  const atRiskCustomers = exposure.customers.map((cu) => {
    // 与真后端同结论：order_of_customer 边按订单序轮转绑定，与 Order.cust 名称无对应 → 账期/额度连不上。
    //
    // ⚠ WO-R5 收编注记：此处**显式标注 `MissingEvidence` 类型**，而不是写 `status: "EMPTY" as const`。
    // 后者会踩中 `test/transit-flow.seam.test.tsx` 的回归锁 —— 那道门全树禁 `status: "EMPTY" as const`
    // 字面量（它治的是「缺席声明退回手写字面量、不再由 derive* 派生」那个病）。
    // 门的正则是全树的、比它自述的靶子宽，但它在 canonical 上是**绿的**，收编不得把它弄红；
    // 且换成类型标注在语义上更好：窄化由契约类型给，不由 `as const` 给。
    const customerObject: MissingEvidence = {
      status: "EMPTY",
      reason: `订单客户「${cu.cust}」连不到 Customer 对象：order_of_customer 边由 synthetic 按订单序**轮转**绑定（custIds[i % n]），与 Order.cust 名称无对应关系 —— 拒绝拿这条边回答账期/信用额度（张冠李戴的数比没有更危险）。`,
      missingFields: ["Customer.custName ↔ Order.cust 的真实对应（或 Order.custId 外键）"],
      checked: ["link:order_of_customer", "Customer.custName", "Customer.termDays", "Customer.creditLimit"],
    };
    return {
      cust: cu.cust,
      orderCount: cu.orderCount,
      qty: cu.qty,
      revenueYi: cu.revenueYi,
      worstDelayDays: worstByCust.get(cu.cust) ?? 0,
      customerObject,
    };
  });

  const okCount = [catchUp.status, delay.status, MOCK_PENALTY_EMPTY.status].filter((s) => s === "OK").length;
  return {
    status: okCount === 3 ? "OK" : okCount === 0 ? "EMPTY" : "PARTIAL",
    baseId: card.baseId,
    baseName: card.base,
    window: exposure.window,
    catchUp,
    delay,
    penalty: MOCK_PENALTY_EMPTY,
    atRiskCustomers,
    revenueAtRiskYi: exposure.revenueYi,
    summary: exposure.hasExposure
      ? `不处置：${exposure.orderCount} 张单 / ${exposure.customerCount} 个客户 / ${exposure.revenueYi} 亿元敞口受影响` +
        `${delay.status === "OK" ? `，最坏延误 ${delay.worstDays} 天（估算·非实测）` : ""}` +
        `${catchUp.status === "OK" ? `；缺口按本基地空闲产能自然消化需 ${catchUp.days} 天` : ""}` +
        "；违约金**算不出**（规则库无交付罚则承载，见 penalty.reason）"
      : `不处置：本窗无订单敞口（${exposure.emptyReason ?? ""}）` +
        `${catchUp.status === "OK" ? `；但缺口仍需 ${catchUp.days} 天自然消化` : ""}` +
        "；违约金**算不出**（规则库无交付罚则承载）",
    units: { qty: "套", revenue: "亿元" },
  };
}

/**
 * ③ 方案代价的证据层（形状照 datacore `attachOptionEvidence`）：
 *   跨基地 → 运费按 mock 调拨台账真算 + 挤占的在手单点名；加班/外协 → 本体无单价承载 ⇒ EMPTY（不填 0）；
 *   外协比例 → 对 C08 红线（`OUTSOURCE_REDLINE` 单一来源·禁内联裸阈值）。
 */
function mockAttachOptionEvidence(opts: DispositionOptions, ctx: { baseId: string; demandInWindow: number; window: { fromDay: number; toDay: number } }): DispositionOptions {
  const freight = RISK_DISPOSITION_SEED.crossBaseFreight;
  const options = opts.options.map((opt) => {
    const missing: { leverKey: string; reason: string; missingField: string }[] = [];
    const sideEffects: DispositionSideEffect[] = [];
    let total = 0;
    let anyOk = false;
    const levers = opt.levers.map((lv) => {
      const effects: DispositionSideEffect[] = [];
      let cost: NonNullable<typeof lv.cost>;
      if (lv.leverKey === "cross_base") {
        cost = {
          status: "OK",
          amountYuan: r2m(lv.closesGap * freight.yuanPerUnit),
          unit: "元",
          source: {
            objectType: "InterBaseTransfer",
            objectId: freight.transferId,
            field: "freightCost",
            value: freight.freightCost,
            formula: `运费单价(元/套) = InterBaseTransfer.freightCost(${freight.freightCost}) ÷ InterBaseTransfer.qty(${freight.qty})；本步成本 = 收窄量(${lv.closesGap}套) × 运费单价(${freight.yuanPerUnit}元/套)`,
          },
        };
        const displaced = RISK_DISPOSITION_SEED.displaceable
          .filter((d) => d.baseId !== ctx.baseId)
          .map((d) => ({ ...d, displacedQty: r2m(Math.min(d.qty, lv.closesGap)), delayDays: d.freeDaily > 0 ? r2m(Math.min(d.qty, lv.closesGap) / d.freeDaily) : null, provenance: { objectType: "Order", objectId: d.so, field: "qty", value: d.qty } }))
          .slice(0, 2);
        effects.push({
          kind: "DISPLACE_ORDERS",
          leverKey: lv.leverKey,
          title: `挤占 ${displaced.length} 张其他基地在手单（${r2m(displaced.reduce((a, d) => a + d.displacedQty, 0))} 套）`,
          detail: `按「优先级低者先让 → 交期晚者先让 → 订单号」挑，直到覆盖跨基地吸收量 ${lv.closesGap} 套；每张单延后天数 = 被挤占量 ÷ 该单基地空闲日产能。`,
          displacedOrders: displaced.map((d) => ({ so: d.so, cust: d.cust, baseId: d.baseId, baseName: d.baseName, qty: d.qty, displacedQty: d.displacedQty, pri: d.pri, due: d.due, dueDay: d.dueDay, delayDays: d.delayDays, provenance: d.provenance })),
        });
      } else if (lv.leverKey === "outsource") {
        cost = {
          status: "EMPTY",
          amountYuan: null,
          unit: "元",
          reason: "本体无外协单价/加工费承载字段（Supplier 只有 leadTime/minOrderQty/onTimeRate）→ 外协成本算不出，拒绝按任意单价估",
          missingField: "Supplier.outsourcePricePerUnit",
        };
        const ratio = ctx.demandInWindow > 0 ? Math.round((lv.closesGap / ctx.demandInWindow) * 1e4) / 1e4 : 0;
        effects.push(
          ctx.demandInWindow > 0
            ? {
                kind: "RULE_BREACH",
                leverKey: lv.leverKey,
                title:
                  ratio > OUTSOURCE_REDLINE.maxRatio
                    ? `外协比例 ${r2m(ratio * 100)}% 越 ${OUTSOURCE_REDLINE.ruleKey} 红线 ${r2m(OUTSOURCE_REDLINE.maxRatio * 100)}%`
                    : `外协比例 ${r2m(ratio * 100)}%（${OUTSOURCE_REDLINE.ruleKey} 红线 ${r2m(OUTSOURCE_REDLINE.maxRatio * 100)}%·未越）`,
                detail: `外协量 ${lv.closesGap}套 ÷ 窗内需求 ${ctx.demandInWindow}套 = ${r2m(ratio * 100)}%；阈值取规则 ${OUTSOURCE_REDLINE.ruleKey}.params.${OUTSOURCE_REDLINE.paramKey}（**规则口径·非代码内联**）`,
                rule: { ruleKey: OUTSOURCE_REDLINE.ruleKey, threshold: OUTSOURCE_REDLINE.maxRatio, actual: ratio, breached: ratio > OUTSOURCE_REDLINE.maxRatio, paramKey: OUTSOURCE_REDLINE.paramKey },
              }
            : {
                kind: "UNKNOWN",
                leverKey: lv.leverKey,
                title: "外协比例是否越红线：算不出",
                detail: "窗内需求为 0，外协比例的分母不存在",
                missingField: "Order.qty(窗内需求)",
              },
        );
      } else {
        cost = {
          status: "EMPTY",
          amountYuan: null,
          unit: "元",
          reason: "本体无加班工时费率承载字段（Line/Base 均无 overtimeCostPerUnit / overtimeRate）→ 加班成本算不出，拒绝按任意费率估",
          missingField: "Line.overtimeCostPerUnit",
        };
        effects.push({
          kind: "UNKNOWN",
          leverKey: lv.leverKey,
          title: "加班的副作用：算不出",
          detail: "本体无人力工时上限/疲劳度/加班额度承载物 → 说不出「加这些班会撞到什么」；拒绝写一句听着对的空话",
          missingField: "Line.maxOvertimeHours",
        });
      }
      if (cost.status === "OK" && cost.amountYuan !== null) {
        total = r2m(total + cost.amountYuan);
        anyOk = true;
      } else {
        missing.push({ leverKey: lv.leverKey, reason: cost.reason ?? "算不出", missingField: cost.missingField ?? "?" });
      }
      sideEffects.push(...effects);
      return { ...lv, cost, sideEffects: effects };
    });
    if (!levers.some((l) => l.leverKey === "cross_base")) {
      sideEffects.push({ kind: "NONE", leverKey: "cross_base", title: "不挤占任何在手单", detail: "本方案未取用跨基地调剂杠杆 → 其他基地的在手单一张都不动（这正是它比 A 贵的原因）" });
    }
    return {
      ...opt,
      levers,
      cost: { status: missing.length === 0 ? ("OK" as const) : anyOk ? ("PARTIAL" as const) : ("EMPTY" as const), totalYuan: anyOk ? total : null, unit: "元" as const, missing },
      sideEffects,
    };
  });
  return { ...opts, options };
}

function mockRiskTimeline(args: Record<string, unknown>): RiskTimelineOutput {
  const apply = Array.isArray(args.apply) ? (args.apply as { objectType?: unknown; prop?: unknown; value?: unknown }[]) : [];
  const capRatio = mockCapRatio(apply);
  const H = Number.isFinite(Number(args.horizon)) && Number(args.horizon) > 0 ? Number(args.horizon) : RISK_DISPOSITION_SEED.defaultHorizon;
  const fs = RISK_DISPOSITION_SEED.forecastStart;
  const rows: NonNullable<RiskTimelineOutput["planRows"]> = [];
  const early: string[] = [];
  // 缺口读数（`planRows` 与卡片 `doNothing.catchUp` **同一出处**·不各算一套·R-一致）。
  const gapByBase = new Map<string, { freeDaily: number; shortfall: number }>();
  for (const card of RISK_TIMELINE.cards) {
    const seed = RISK_DISPOSITION_SEED.bases.find((b) => b.base === card.base);
    const cross = card.crossDay ?? RISK_TIMELINE.horizon;
    if (card.crossDay != null && card.crossDay <= 14 && !early.includes(card.base)) early.push(card.base);
    if (!seed) continue;
    const freeDaily = Math.round(seed.freeDaily * capRatio * 100) / 100;
    const available = Math.round(freeDaily * H * 100) / 100;
    const futureQty = (card.affectedOrders ?? []).reduce((a, o) => a + Number((o as { qty?: number }).qty ?? 0), 0);
    const shortfall = Math.round(Math.max(0, futureQty - available) * 100) / 100;
    gapByBase.set(seed.baseId, { freeDaily, shortfall });
    // WO-DECISION-INFO ③.2：前置期由调用方从真对象带进来（`InterBaseTransfer.transitDays` / `Supplier.leadTime`），
    // 加班杠杆不带（本体无该承载字段 → 契约内部恒 EMPTY）。绝不复活 `+7 / +14` 魔数。
    const dispositionInput = {
      baseId: seed.baseId, forecastStart: fs, horizon: H, trigDay: Math.max(1, cross), shortfall,
      freeDaily, available, inProdTotal: 0, futureQty,
      overtimeUpliftPct: RISK_DISPOSITION_SEED.coeff.overtimeUpliftPct,
      crossBaseAbsorbPct: RISK_DISPOSITION_SEED.coeff.crossBaseAbsorbPct,
      crossBaseLead: RISK_DISPOSITION_SEED.crossBaseLead,
      outsourceLead: RISK_DISPOSITION_SEED.outsourceLead,
    };
    const d = deriveDisposition(dispositionInput);
    // WO-DECISION-INFO ③：可比较的多方案（A 本地优先 = 上面那条贪心的同解，可对拍）+ 真代价装配。
    const options = mockAttachOptionEvidence(
      deriveDispositionOptions({ ...dispositionInput, coefficients: RISK_DISPOSITION_SEED.coefficients }),
      { baseId: seed.baseId, demandInWindow: futureQty, window: { fromDay: 0, toDay: H } },
    );
    const head = d.steps[0];
    const p0 = seed.plans[0]!;
    const common = {
      owner: seed.owner, rule: "C05", baseId: seed.baseId, shortfall, residual: d.residual, steps: d.steps,
      ...(apply.length > 0 ? { overlay: { count: apply.length, capRatio } } : {}),
    };
    rows.push({
      act: `${head ? head.action : p0.name}（${card.base}）`,
      det: `${d.summary} · 峰值${card.peak}`,
      start: `T+${cross - 7}·${mmddMock(fs, cross - 7)}（越线前7天）`,
      done: `T+${cross}·${mmddMock(fs, cross)}（越线日）`,
      eff: head ? `${d.steps.length} 步收窄 ${d.closedTotal}套 · 残留 ${d.residual}套` : `消解≈${p0.eff}·${p0.tn}天起效`,
      plan: p0.name,
      // 多方案只挂每基地**主行**（备份行不重复挂同一份大对象·与真后端一致）。
      options,
      ...common,
    });
    const p1 = seed.plans[1];
    if (card.peak >= 90 && p1) {
      rows.push({
        act: `${p1.name}（${card.base}·备份方案）`,
        det: `峰值≥90 双保险 · ${d.summary}`,
        start: `T+${cross - 3}·${mmddMock(fs, cross - 3)}`,
        done: `T+${cross + 7}·${mmddMock(fs, cross + 7)}`,
        eff: `消解≈${p1.eff}·${p1.tn}天起效`,
        plan: p1.name,
        ...common,
      });
    }
  }
  if (early.length > 0) {
    rows.push({
      act: `反提月度计划差异（${early.join("、")}）`, det: "14 天内越线，需计划层资源协同",
      owner: "计划中心 → S&OP", start: `T+1·${mmddMock(fs, 1)}`, done: "本周 S&OP",
      eff: "计划-执行闭环，差异进入月度议程", rule: "C21",
    });
  }
  rows.sort((a, b) => String(a.start).localeCompare(String(b.start), undefined, { numeric: true }));

  // ---- WO-DECISION-INFO-FE ①② · 影响面排序 + 不作为后果（逐卡回填·顺序与真后端一致）---------
  // ⚠ `cards[]` 数组序**刻意不动**（既有排序契约）；给出的是显式排序键 `exposure.rank` + 顶层 `exposureOrder`。
  const window = { fromDay: 0, toDay: H };
  const ranked = mockAssignRanks(RISK_TIMELINE.cards.map((c) => mockExposure(c, window, fs)));
  const rankByBase = new Map(ranked.map((e) => [e.baseId, e]));
  const cards = RISK_TIMELINE.cards.map((c) => {
    const exposure = rankByBase.get(c.baseId);
    if (!exposure) return c;
    const gap = gapByBase.get(c.baseId);
    return { ...c, exposure, doNothing: mockDoNothing(c, exposure, gap?.shortfall ?? 0, gap?.freeDaily ?? 0) };
  });
  const exposureOrder = [...ranked].sort((a, b) => a.rank - b.rank).map((e) => e.baseId);

  return { ...RISK_TIMELINE, cards, planRows: rows, exposureOrder };
}

/**
 * 反事实双轨 mock（基地感知·KILL-MOCK）：从 RISK_TIMELINE 各基地的 peak/crossDay 派生 do-nothing baseline ‖
 * 处置后 mitigated 双轨——每基地峰值不同 → 曲线/峰值削减不同，保证「切基地 → 双轨真变」（前端 WO-C C2）。
 * base 缺省 → 取峰值最严重基地（worst-by-peak，与真后端 counterfactualTimeline 同口径 → 默认不破现状·C3）。
 * 确定性（无随机·R6）：同 base 字节一致。
 */
// ═══════════════════════════════════════════════════════════════════════════
// WO-SCOPE-HONESTY-FE · `kit_readiness` / `quote_margin` 的 **mock 半**
// （WO-R1 2026-08-13 从 `claude/integ-ui-w5` 收编：canonical 的 handlers.ts 自分叉后另行演进，
//   整文件不可照搬，故只把这两段**按符号**摘过来，不动 canonical 已有的任何 mock。）
//
// 治的是「功能进了 canonical、mock 没跟、demo 里看不见」——与 `test/mock-stubs.test.ts` 记的
// decision_play / supply_demand_gap_attribution 那次同形态。不补这一段，`VITE_MOCK=1` 的 demo 态
// 这两个求解器直接落 base handler 的兜底「求解器不存在或未开通」。
//
// 三条一律**镜像真引擎口径**，不另造一套好看的：
//  · `base` 解析走「先 id 精确、再中文名精确」；解析不到 → **400 AMBIGUOUS_SCOPE**，
//    绝不静默退回全网（那正是本单要治的病）。
//  · 订单池收窄 → `orderPoolTotal` / `networkOrderTotal`，取样上限 8 → `sampled` / `samplingNote`。
//  · `quote_margin` 客户维恒 `NOT_APPLIED` + `missingInputs`（今天数据层确实没有这一维，不假装）。
//
// ⚠ 未收编 w5 的 `riskScopeOf()`：canonical 的 `risk_timeline` 诚实位已由
//   `fixtures.ts` 的 `RISK_TIMELINE.scope/scopeNote` 下发，并被
//   `test/solver-scope-honesty.seam.test.tsx` 的夹具金丝雀咬住。再补一份就是第二个出处。
// ═══════════════════════════════════════════════════════════════════════════

/** 引擎取样上限（`extended.ts` 的 `pool.slice(0, 8)`）。mock 与引擎同一个数，改一处两处一起动。 */
const KIT_SAMPLE_CAP = 8;

/** 镜像 `resolveBaseRef`：id 精确 → 中文名精确。解析不到返 null（调用方负责 400，不静默退全网）。 */
function resolveMockBase(ref: unknown): { baseId: string; name: string } | null {
  const raw = typeof ref === "string" ? ref.trim() : "";
  if (!raw) return null;
  const hit = BASE_REGISTRY.find((b) => b.baseId === raw) ?? BASE_REGISTRY.find((b) => b.name === raw);
  return hit ? { baseId: hit.baseId, name: hit.name } : null;
}

/**
 * 齐套物料表（mock 侧固定 4 种，镜像引擎 `mats.slice(0,4)` 的形状与算法：ratio = 可用 ÷ (单耗×数量)）。
 *
 * ⚠ 库存量刻意调到**真会缺料**的水位：三元正极/电解液是瓶颈料，隔膜/铜箔恒够。
 * 第一版把四种都给得很宽裕 → 全网与单基地一律 `shortageCount: 0`，屏上「缺料 0 张」——
 * 那样这块面板永远演示不出「抽样的 N 张里 M 张缺料」这件本单要治的事（**mock 不比生产漂亮，
 * 但也不该比生产干净**）。现状（确定性·同 seed 同结果）：全网取样 8 张里 3 张缺料，常州 2 张里 1 张。
 */
const KIT_MATS = [
  { material: "三元正极", onHand: 1100, inTransit: 400, bomUnit: 0.42 },
  { material: "隔膜", onHand: 9000, inTransit: 2400, bomUnit: 0.18 },
  { material: "电解液", onHand: 620, inTransit: 280, bomUnit: 0.31 },
  { material: "铜箔", onHand: 8000, inTransit: 3000, bomUnit: 0.22 },
];

/** `kit_readiness` mock：真按 base 收窄订单池 → 取样 → 逐单 kitRatio，并透出全套作用域/抽样诚实位。 */
function mockKitReadiness(args: Record<string, unknown>): Record<string, unknown> | { __err: string } {
  const hasBaseRef = typeof args.base === "string" && args.base.trim() !== "";
  const network = ORDERS;
  let pool = network;
  let scope: Record<string, unknown>;
  if (hasBaseRef) {
    const b = resolveMockBase(args.base);
    if (!b) return { __err: `kit_readiness：问句指定基地「${String(args.base)}」在基地库中无匹配（扫 ${BASE_REGISTRY.length} 行）——拒绝静默退回全网订单池` };
    pool = network.filter((o) => o.bases === b.name);
    scope = {
      mode: "BASE",
      baseId: b.baseId,
      baseName: b.name,
      orderPoolTotal: pool.length,
      networkOrderTotal: network.length,
      note: `仅 ${b.name} 基地可承接的订单（Order.bases ∋ ${b.baseId}）·非全网`,
    };
  } else {
    scope = { mode: "ALL", orderPoolTotal: pool.length, note: "全网口径（未指定基地·跨全部产地）" };
  }
  const sample = pool.slice(0, KIT_SAMPLE_CAP);
  const rows = sample.map((o) => {
    const items = KIT_MATS.map((m) => {
      const need = Math.round(m.bomUnit * o.qty * 1e4) / 1e4;
      const avail = m.onHand + m.inTransit;
      return { material: m.material, ratio: need <= 0 ? 1 : Math.round((avail / need) * 1e4) / 1e4, shortage: Math.round(Math.max(0, need - avail) * 1e4) / 1e4 };
    });
    const kitRatio = Math.round(Math.min(...items.map((i) => i.ratio)) * 1e4) / 1e4;
    return { orderId: o.so, kitRatio, shortItems: items.filter((i) => i.ratio < 1), advice: kitRatio >= 1 ? "齐套" : "加急采购" };
  });
  scope.sampled = sample.length;
  if (sample.length < (scope.orderPoolTotal as number))
    scope.samplingNote =
      `本次只分析订单池里排序靠前的 ${sample.length}/${scope.orderPoolTotal} 张（引擎侧固定采样上限 ${KIT_SAMPLE_CAP}）·` +
      `shortageCount 是这 ${sample.length} 张里的缺料数，不是该口径下的全部`;
  if (sample.length === 0) scope.emptyNote = "该口径下无可分析订单 —— rows 为空**不等于**全部齐套（拒绝把「没数据」渲染成「没问题」）";
  return { rows, shortageCount: rows.filter((r) => r.kitRatio < 1).length, scope, ruleRefs: ["C06", "C16"] };
}

/**
 * `quote_margin` mock：型号维**真接线**（按型号单价重算 bomCost ⇒ 换型号 margin 真变），
 * 客户维**恒 NOT_APPLIED**（今天 Customer 上确实没有报价/细分底线字段 ⇒ 换客户 margin **必须不变**）。
 * ⚠ 这两维定性不同，不许合成一句 —— 后端门里有一条**反向**断言正是咬这件事。
 */
function mockQuoteMargin(args: Record<string, unknown>): Record<string, unknown> | { __err: string } {
  const modelId = typeof args.modelId === "string" ? args.modelId.trim() : "";
  const custName = typeof args.custName === "string" ? args.custName.trim() : "";
  const price = 500;
  const mfgRate = 0.1;
  const logistics = 8;
  const segmentFloor = 0.12;
  let bomCost: number;
  if (modelId) {
    const unit = MODEL_UNIT_PRICE_MOCK[modelId];
    if (unit === undefined)
      return { __err: `quote_margin：问句指定型号「${modelId}」无可用 BOM——拒绝拿与型号无关的全局前 4 种物料冒充该型号的 BOM 成本` };
    // 型号真参与计算：单价越高的化学体系 BOM 成本越高（确定性·同型号字节一致）。
    bomCost = Math.round(unit * 0.0182 * 1e4) / 1e4;
  } else {
    bomCost = 313.7452; // 未指定型号 → 全局前 4 种物料（非任何具体型号的配方），与引擎同为「回落值」
  }
  const cost = Math.round((bomCost * (1 + mfgRate) + logistics) * 1e4) / 1e4;
  const margin = Math.round(((price - cost) / price) * 1e4) / 1e4;
  return {
    price, bomCost, mfgRate, logistics, cost, margin, segmentFloor,
    verdict: margin >= segmentFloor ? "过线" : margin >= 0 ? "触线" : "低于底线",
    scope: {
      modelId: modelId || null,
      modelDimension: modelId ? "APPLIED" : "ALL",
      modelNote: modelId
        ? `BOM 成本按型号 ${modelId} 的真 BOM 逐行计（quantity×(1+lossRate) × Material.unitPrice）`
        : "未指定型号 → BOM 取全局前 4 种物料（非任何具体型号的配方）",
      custName: custName || null,
      custDimension: "NOT_APPLIED",
      custNote:
        "客户维今天不生效：price / mfgRate / logistics / segmentFloor 四项均为引擎写死常数，" +
        "Customer 对象上无报价、无细分毛利底线字段可派生 ⇒ 换个客户名，margin 与 verdict 不会变。" +
        "要真按客户算，需先给 Customer 补 segment/报价承载体（缺源登记·不臆造）。",
      missingInputs: [
        { objectType: "Customer", property: "segment", need: "客户所属细分（决定 segmentFloor 毛利底线）" },
        { objectType: "Customer", property: "quotedPrice", need: "该客户该型号的报价（决定 price）" },
      ],
    },
    ruleRefs: ["C15", "C24"],
  };
}

/** 型号 → 单价（mock 侧型号维的真源；与 fixtures 的 Order.unitPrice 同一张表口径）。 */
const MODEL_UNIT_PRICE_MOCK: Record<string, number> = {
  "4680-NCM": 22000, "VDA-NCM": 20000, "4680-LFP": 16000, "刀片-LFP": 15000, "储能-280Ah": 14000, "储能-314Ah": 14500,
};


function mockCounterfactual(reqBase?: string): Record<string, unknown> {
  const H = 30;
  const threshold = RISK_TIMELINE.threshold;
  const worst = [...RISK_TIMELINE.cards].sort((a, b) => b.peak - a.peak || (a.base < b.base ? -1 : 1))[0]!;
  const card = (reqBase ? RISK_TIMELINE.cards.find((c) => c.base === reqBase) : undefined) ?? worst;
  const peak = card.peak;
  const responseDay = card.crossDay ?? 20;
  const reliefMax = Math.round(peak * 0.18);
  // baseline：单调↑ 至该基地峰值；mitigated：自越线响应日起按 reliefMax 衰减（尾段趋稳）。
  const baseline = Array.from({ length: H }, (_, d) => Math.round(45 + (peak - 45) * (d / (H - 1))));
  const mitigated = baseline.map((v, d) => Math.max(35, Math.round(v - (d < responseDay ? 0 : reliefMax * Math.min(1, (d - responseDay) / 6)))));
  const over = (s: number[]) => s.filter((v) => v >= threshold).length;
  const bCross = baseline.findIndex((v) => v >= threshold);
  const mCross = mitigated.findIndex((v) => v >= threshold);
  const crossDelayDays = bCross < 0 ? 0 : mCross < 0 ? H - bCross : mCross - bCross;
  return {
    baselineSeries: baseline,
    mitigatedSeries: mitigated,
    threshold,
    base: card.base,
    factor: card.factor,
    mitigation: `${card.factor}·处置`,
    delta: {
      peakCut: Math.max(...baseline) - Math.max(...mitigated),
      crossDelayDays,
      ordersSaved: Math.max(0, over(baseline) - over(mitigated)),
    },
    events: [],
    summary: `如不解决「${card.base}·${card.factor}」：峰值削减 ${Math.max(...baseline) - Math.max(...mitigated)}`,
  };
}

/**
 * #9 驾驶舱经营指标（metric_rollup 单一出处）——「经营指标」条渲染 + gap_attribution noGap 判据同源。
 * 含一条**已达成**指标（交付达成率 98.2 ≥ 95）以驱动「达成·无缺口」下钻路径：镜像真 solver 零缺口短路
 * （service.ts:1279 · actual≥target → noGap=true·levels 空），让"点已达成指标也能下钻其结构"可测。
 */
const COCKPIT_ROLLUP_METRICS = [
  { metricId: "kpi-margin", key: "gm_rate", name: "毛利率", unit: "%", level: "op", category: "profit", target: 16, actual: 15.2, delta: -0.8, miss: false },
  { metricId: "kpi-attain", key: "demand_attain", name: "需求达成率", unit: "%", level: "op", category: "scale", target: 100, actual: 96.4, delta: -3.6, miss: false },
  { metricId: "kpi-material", key: "material_cov", name: "物料保障率", unit: "%", level: "op", category: "material", target: 100, actual: 77.3, delta: -22.7, miss: true },
  { metricId: "kpi-delivery", key: "delivery_attain", name: "交付达成率", unit: "%", level: "op", category: "delivery", target: 95, actual: 98.2, delta: 3.2, miss: false },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// VITE_MOCK 可见性桩：decision_play（CEO-3 决策推演）+ supply_demand_gap_attribution（供需失衡双向归因）。
// 病根：WO-D 决策页 + 供需 panel 已合入真部署态，但纯 VITE_MOCK=1 态 base mock 对这两 solver invoke 返 404
// → 两块诚实空，CEO 在 demo 里看不到。此桩**仅 mock 可见性用途**（真部署走真求解器·不覆盖）。
// 诚实：数字从已有真 fixtures 确定性派生（sopScale 的年口径 DemandSegment / SopVersionRow + kitGap / oee），
// 非编造"来自数据库"；结构与真 solver 一字不差（DecisionPlayOutput / SupplyDemandGapOutput 契约）。R6 无随机·字节一致。
// WO-MOCK-SCALE-TRUTH：两处取数对象都改过 —— decision_play 的 ess 目标从**月**字段 seg_ess 改回**年**口径
// DemandSegment.demandWanPerYearP50；供需归因的 G 从月度台账改回 SopVersionRow（与真求解器同口径）。
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * WO-DECISION-PLAY-FE-CONSUME · 桩里的**可执行候选**（真枚举器形状）。
 * `gapClose.value === null` 是**必须演出来的一态**：它的意思是「算不出收窄量」，
 * 不是「没效果」—— 屏上渲染成 0 会被读反。故本桩刻意给一条 null、一条有值。
 * 形状取自 2026-08-14 实测的引擎真回包（datacore `solvers.invoke("decision_play")`）。
 */
const MOCK_PLAY_CANDIDATES = [
  {
    candidateId: "cand_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10",
    impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
    label: "物料·到货周期 ↓ 10（物料到货·pos_lfp）",
    lever: { objectType: "Material", objectId: "pos_lfp", prop: "leadTime", unit: "天", factorName: "物料到货" },
    fromValue: 26,
    toValue: 10,
    join: { kind: "KEY_JOIN", path: "值键相等 MaterialBalance.material = Material.name = 磷酸铁锂正极（因子⑮ 物料到货）" },
    rungKind: "PEER_BEST",
    rungSource: "同侪 Material.leadTime 真实极值（最小） 10（全类型·6 个不同取值·当前 26）",
    dims: [
      { key: "breach", label: "超阈幅度（MaterialBalance.gapTon）", value: 492, baseline: 492, unit: "吨" },
      { key: "capacityP50", label: "产能 p50 合计（全域）", value: 34523133.8622, baseline: 30258169.2393, unit: "套/天" },
    ],
    // 判据读数没变 ⇒ 引擎拒绝折算，给 null + 理由（**不给 0**）。
    gapClose: {
      value: null,
      basis: "metricgap:demand_attain 贡献 8.096% × Δbreach/breach基线",
      reason:
        "该候选**不改变**本根因的判据读数（492→492吨）——它的效果落在其他维（见产能 p50 那一维）；" +
        "本引擎无从把那些维换算成本指标缺口，故不给收窄量。",
    },
  },
  {
    candidateId: "cand_mbal-2_MaterialBalance.gapTon_mbal-2_PEER_NEXT_246",
    impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
    label: "物料平衡·缺口吨 ↓ 246（正极齐套）",
    lever: { objectType: "MaterialBalance", objectId: "mbal-2", prop: "gapTon", unit: "吨", factorName: "正极齐套" },
    fromValue: 492,
    toValue: 246,
    join: { kind: "LOCUS_PROP", path: "落点对象自身的可拨动属性 MaterialBalance/mbal-2.gapTon" },
    rungKind: "HALF",
    rungSource: "落点读数对半档（492 → 246）",
    dims: [{ key: "breach", label: "超阈幅度（MaterialBalance.gapTon）", value: 246, baseline: 492, unit: "吨" }],
    // 落点读数与判据基线逐位相等 ⇒ 可等比折算，给真数。
    gapClose: {
      value: 4.048,
      unit: "%",
      basis: "metricgap:demand_attain 贡献 8.096% × (492−246)/492（落点读数与判据基线逐位相等 ⇒ 同量可等比折算）",
    },
  },
];

/** 三条战略方案的「被挡下」理由（引擎原文形状：依据对象 + 本次根因的下钻面）。 */
const mockOmitted = (rootLabel: string, drillFaces: string) => [
  {
    optionId: "opt-backup-cert",
    label: "缩短备份供应商认证周期",
    reason:
      `依据对象 BackupSupplierPool|pool-cathode 与其类型都不在本次归因树的落点集里` +
      `（根因「${rootLabel}」的下钻面为 ${drillFaces}）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。`,
  },
  {
    optionId: "opt-lta-clause",
    label: "长协加价格联动条款",
    reason:
      `依据对象 LongTermAgreement|lta-lfp-rbkj 与其类型都不在本次归因树的落点集里` +
      `（根因「${rootLabel}」的下钻面为 ${drillFaces}）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。`,
  },
  {
    optionId: "opt-insource",
    label: "上游自采矿+战略储备",
    reason:
      `依据对象 LongTermAgreement|lta-lfp-cylk 与其类型都不在本次归因树的落点集里` +
      `（根因「${rootLabel}」的下钻面为 ${drillFaces}）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。`,
  },
];

/**
 * decision_play mock（CEO-3·5 区决策产物）：根因 seg_attain_ess 缺口从 ess 段（target 139.2 / 实绩 100.5·fixtures.ts:488）
 * 派生 → 3 对症方案（solver+agent·带 provenance 下钻真对象）→ 比对矩阵 → 触发规则 → 推荐组合 + 差距收窄试算。
 * 自洽：narrowedPct = totalClosesGap/beforeGap（活算·非写死）；afterGap = beforeGap − totalClosesGap。
 *
 * ── WO-DECISION-PLAY-FE-CONSUME：桩必须能演出**三种态** ────────────────────────
 * 引擎改成「依据可核对才下发方案」之后，同一个求解器在不同指标上产出的形态完全不同；
 * 桩只演一种 ⇒ `VITE_MOCK=1` 的 demo 里永远看不到「方案 0 条」那一屏，而那一屏恰恰是
 * 最容易做错的（不消费被挡名单就是一块无缘无故的空白）。三态按 `metricKey` 分：
 *   · `demand_attain`   有卡点候选 · 战略方案 **0 条**（三条全被挡下）
 *   · `cash`            全空：方案 0 条 + 一个卡点都接不上（带机器可读理由）
 *   · 其余（含 `seg_attain_ess`·缺省） 有方案（含一条**弱依据**）+ 有候选
 * 三态的文字与数值形状取自 2026-08-14 在 datacore 真跑同名求解器打出来的回包。
 */
function mockDecisionPlay(metricKey?: string): Record<string, unknown> {
  // 根因缺口：储能达成率 = 实绩/目标 → gap = (1 − 100.5/139.2)×100 ≈ 27.8%（与真后端 metric `seg_attain_ess`
  // 的 `actual = round(act/tgt×100, 1)` 同式同值）。
  // WO-MOCK-SCALE-TRUTH：这两个数是 `DemandSegment` 的**年**口径（P50 139.2 / act 100.5），
  // 旧写法却从 `PLAN_VERSION_CURRENT.input.seg_ess` 取 —— 那个字段是**月**口径（8.93）。
  // 旧代码之所以没炸，只是因为当时 seg_ess 恰好也被错填成年值；把 seg_ess 修对，这里就会算出 −1025%。
  // 「接了线接错地方」的典型：改取年口径本体，不再借道月度台账字段。
  const ess = DEMAND_YEAR.find((d) => d.key === "ess")!;
  const essTarget = ess.p50; // 139.2 万套/年（DemandSegment.demandWanPerYearP50）
  const essActual = ess.act; // 100.5 万套/年（DemandSegment.act）——实绩偏弱下修
  const gap = r1((1 - essActual / essTarget) * 100); // 27.8

  // ── 三态之二/三：战略方案 0 条（依据够不着）。这两态是本桩存在的第二个理由 ────────────
  if (metricKey === "demand_attain" || metricKey === "cash") {
    const isCash = metricKey === "cash";
    const rootLabel = isCash ? "应收账龄恶化(root)" : "物料短缺(root)";
    const drillFaces = isCash ? "ARAging、Customer、DSO" : "DecisionGap、Equipment、MaterialBalance";
    const rootGap = isCash ? 2 : 9.2;
    const unit = isCash ? "亿" : "%";
    // cash：一个卡点都接不上（判据册的落点类型与本次根因的下钻面交集为空）⇒ 机器可读理由。
    const plays = isCash
      ? {
          joined: [],
          scanned: 0,
          joinedCount: 0,
          candidateCount: 0,
          noPlayReason:
            "本次归因树的落点类型 [ARAging、Customer、DSO] 与阻滞点判据册的落点类型 " +
            "[Base、DataSourceHealth、Line、MaterialBalance、MaterialBatch、Order、Process] **交集为空**，" +
            "且归因结构层没有基地面 ⇒ 一条 join 路都够不着。这是「接不上」不是「没有对策」。",
        }
      : {
          joined: [
            {
              impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
              kind: "BREAK",
              locus: { objectType: "MaterialBalance", objectId: "mbal-2", label: "磷酸铁锂正极" },
              severity: 6,
              ruleKey: "C06",
              join: {
                kind: "LOCUS_EXACT",
                path: "gap_attribution.node metricgap:demand_attain（贡献 8.096%·下钻 MaterialBalance/mbal-2.gapTon=492）== 阻滞点落点 MaterialBalance/mbal-2",
                anchorNodeId: "metricgap:demand_attain",
                anchorFactor: "需求达成缺口",
                anchorContribution: 8.096,
              },
              candidates: MOCK_PLAY_CANDIDATES,
            },
            {
              // 接上了、但这个卡点**没有**候选 —— 与「一条都接不上」是两件事，屏上两句话。
              impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-1",
              kind: "BREAK",
              locus: { objectType: "MaterialBalance", objectId: "mbal-1", label: "三元正极" },
              severity: 8,
              ruleKey: "C06",
              join: {
                kind: "LOCUS_EXACT",
                path: "gap_attribution.node cf:cf-material-short（贡献 6.4716%·下钻 MaterialBalance/mbal-1.gapTon=1858）== 阻滞点落点 MaterialBalance/mbal-1",
                anchorNodeId: "cf:cf-material-short",
                anchorFactor: "物料短缺(root)",
                anchorContribution: 6.4716,
              },
              candidates: [],
              noCandidateReason:
                "枚举已跑完，有效候选 0 个（探了 2 个杠杆锚点 / 6 次试算），不足 2 个 ⇒ 构不成多方案对比，诚实不下发。",
              noCandidateKind: "NONE",
            },
          ],
          scanned: 7,
          joinedCount: 2,
          candidateCount: MOCK_PLAY_CANDIDATES.length,
          candidatesTruncated: false,
          candidateProbes: 45,
        };
    return {
      rootCause: { factorId: isCash ? "cf-ar-aging" : "cf-material-short", label: rootLabel, metricKey, gap: rootGap, unit },
      options: [],
      matrix: [],
      triggers: [
        { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 12, fired: true, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
        { triggerId: "trig-fx-hedge", signalRef: "usd_cny", signalValue: 7.18, op: ">", threshold: 8, fired: false, action: "外汇对冲展期", thresholdSource: "trigger.default" },
      ],
      recommendedPlan: { planId: `plan-${isCash ? "cf-ar-aging" : "cf-material-short"}`, optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
      sandboxNarrowing: { beforeGap: rootGap, afterGap: rootGap, narrowedPct: 0, ticks: 0 },
      optionsOmitted: mockOmitted(rootLabel, drillFaces),
      optionsEvidence: [],
      impedimentPlays: plays,
      summary:
        `根因「${rootLabel}」→ 0 战略方案比对（另 3 条因依据不在本根因树上未下发）` +
        `·可执行方案 ${plays.candidateCount} 条(接 ${plays.joinedCount}/${plays.scanned} 个阻滞点)`,
    };
  }

  const options = [
    { optionId: "opt-backup-cert", factorId: "cf-upstream-cut", label: "缩短备份供应商认证周期", sourceKind: "solver",
      closesGap: 3.2, cost: 248, cycleDays: 112, risk: 0.25, exposure: 0.23, reversibility: 0.8,
      provenance: { kind: "求解器", basis: "BackupSupplierPool.certWeeks（认证周期越长 → 备份池上量越慢）", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillValue: 16 } },
    { optionId: "opt-lta-clause", factorId: "cf-upstream-cut", label: "长协加价格联动条款", sourceKind: "agent",
      closesGap: 4.1, cost: 90, cycleDays: 30, risk: 0.2, exposure: 0.075, reversibility: 0.9,
      provenance: { kind: "策略推理", basis: "LongTermAgreement.priceLinked（未挂联动 → 违约敞口）", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 0 } },
    { optionId: "opt-insource", factorId: "cf-upstream-cut", label: "上游自采矿+战略储备", sourceKind: "agent",
      closesGap: 5.5, cost: 1160, cycleDays: 180, risk: 0.55, exposure: 0.05, reversibility: 0.2,
      provenance: { kind: "策略推理", basis: "正极供应缺口（LTA 约定−实际交付吨）", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 600 } },
  ];
  const matrix = options.map((o) => ({ optionId: o.optionId, label: o.label,
    dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility } }));
  // 推荐组合 = 低代价高补缺口两项（长协联动 + 备份认证）；重叠去化后组合补缺口取 6.1（供应可解决权重上限·非简单相加）。
  const recOptionIds = ["opt-lta-clause", "opt-backup-cert"];
  const totalClosesGap = 6.1;
  const totalCost = options.filter((o) => recOptionIds.includes(o.optionId)).reduce((s, o) => s + o.cost, 0); // 90+248=338
  const afterGap = r1(gap - totalClosesGap); // 21.7
  const narrowedPct = r2((totalClosesGap / gap) * 100); // 21.94（活算·自洽）
  return {
    rootCause: { factorId: "cf-upstream-cut", label: "上游减供", metricKey: "seg_attain_ess", gap, unit: "%" },
    options,
    matrix,
    triggers: [
      { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 12, fired: true, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
      { triggerId: "trig-fx-hedge", signalRef: "usd_cny", signalValue: 7.18, op: ">", threshold: 8, fired: false, action: "外汇对冲展期", thresholdSource: "trigger.default" },
      { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", signalValue: 96000, op: ">", threshold: 90000, fired: true, action: "长协重定价谈判", thresholdSource: "trigger.default" },
    ],
    recommendedPlan: {
      planId: "plan-cf-upstream-cut", optionIds: recOptionIds,
      steps: [
        { phase: "即刻", action: "长协加价格联动条款", optionRef: "opt-lta-clause" },
        { phase: "本季", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
      ],
      totalClosesGap, totalCost,
    },
    sandboxNarrowing: { beforeGap: gap, afterGap, narrowedPct, ticks: 0 },
    // 三态之一：有方案。其中 `opt-lta-clause` 是**弱依据**（同类型不同实例）——
    // 这一档必须在 demo 里真出现过，否则「弱依据要出声」这条规矩在 mock 态永远演不到。
    optionsOmitted: [],
    optionsEvidence: [
      { optionId: "opt-backup-cert", match: "OBJECT",
        note: "依据对象 BackupSupplierPool|pool-cathode == 归因树节点 cf:cf-cert-cycle（认证周期长(root)·贡献 0.4772%）的下钻对象" },
      { optionId: "opt-lta-clause", match: "TYPE",
        note: "依据**类型** LongTermAgreement 在归因树上（节点 cf:cf-lta-breach·下钻 LongTermAgreement/lta-lfp-cylk），但本方案指的是 lta-lfp-rbkj —— **同类型不同实例**，依据强度为 TYPE（弱）。" },
      { optionId: "opt-insource", match: "OBJECT",
        note: "依据对象 LongTermAgreement|lta-lfp-cylk == 归因树节点 cf:cf-lta-breach（长协违约·贡献 0.1163%）的下钻对象" },
    ],
    impedimentPlays: {
      joined: [
        {
          impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
          kind: "BREAK",
          locus: { objectType: "MaterialBalance", objectId: "mbal-2", label: "磷酸铁锂正极" },
          severity: 6,
          ruleKey: "C06",
          join: {
            kind: "LOCUS_EXACT",
            path: "gap_attribution.node material:cathode（贡献 3.2811%·下钻 MaterialBalance/mbal-2.gapTon=492）== 阻滞点落点 MaterialBalance/mbal-2",
            anchorNodeId: "material:cathode",
            anchorFactor: "正极物料短缺",
            anchorContribution: 3.2811,
          },
          candidates: MOCK_PLAY_CANDIDATES,
        },
        {
          // BASE_SCOPE 这条接法也得演到（三条接法三句话，不塌成「已关联」）。
          impedimentId: "imp_BOTTLENECK.CAPACITY.cross-segment-contention_changzhou",
          kind: "BOTTLENECK",
          locus: { objectType: "Base", objectId: "changzhou", label: "常州" },
          severity: 67,
          ruleKey: "C34",
          join: { kind: "BASE_SCOPE", path: "gap_attribution.levels[1] 基地面含 changzhou → 阻滞点落在该基地面上" },
          candidates: [],
          noCandidateReason:
            "枚举已跑完，有效候选 0 个（探了 10 个杠杆锚点 / 34 次试算）。缺口：对象类型 Base 上没有任何可拨动落点；判据 C34 不是任何可拨动因子的门。",
          noCandidateKind: "NONE",
        },
      ],
      scanned: 8,
      joinedCount: 2,
      candidateCount: MOCK_PLAY_CANDIDATES.length,
      candidatesTruncated: false,
      candidateProbes: 80,
    },
    summary: `根因「上游减供」(储能达成率缺口 ${gap}%) → 3 方案比对·推荐组合 2 项补 ${totalClosesGap}%(收窄 ${narrowedPct}%)·2/3 触发规则 fire`,
  };
}

/**
 * supply_demand_gap_attribution mock（供需失衡双向归因·勾稽 Σ=G）：总缺口 G
 * → 需求端(预测虚高) ⊥ 供给端(物料/OEE) + residual。侧/叶贡献确定性分摊，last 叶取余保证 Σ 精确=父（非写死叙事）。
 * 诚实：供给端**不含** capacity_gap 叶（Line.capacityDaily 未落·忠于 demo 种子）→ 前端渲「产能数据未接·诚实空」，绝不编造产能占比。
 *
 * WO-MOCK-SCALE-TRUTH：G 的**取数对象换了**。旧写法 `G = dem − SOP_SUPPLY_BASELINE` 从**月度台账**派生（7.1），
 * 而真求解器的口径是 `SopVersionRow Σ max(0, demand−supply)`（目录条目原文），**年**口径，实测 **81 万套**。
 * 即旧桩不是"数不准"而是"取错了对象"——差 11.4 倍，跨了一个数量级。
 */
function mockSupplyDemandGap(): Record<string, unknown> {
  // 与真求解器同式同源：Σ max(0, SopVersionRow.demand − .supply)（万套/年）⇒ 36+26+15+4 = 81。
  const G = SOP_VERSION_TOTAL_GAP_WAN;
  // 侧分摊（预测虚高 → 需求端主导·residual 15%·非五五开）：占比不变，随 G 一起放大到年口径。
  const demandContribution = r1(G * 0.704);
  const supplyContribution = r1(G * 0.141);
  const residual = r1(G - demandContribution - supplyContribution); // 取余保证 Σ=G
  const essSeg = DEMAND_YEAR.find((d) => d.key === "ess")!;
  // 需求端叶的 driverValue 同样回到**年**口径（真后端 seg_bias 叶实测 38.7 = P50 139.2 − act 100.5）。
  const essBias = r1(essSeg.p50 - essSeg.act); // 38.7 万套/年
  const demandDrivers = [
    { id: "seg_bias:ess", factor: "储能 预测偏差（P50−实绩）", contribution: r1(demandContribution * 0.84), share: r4(0.84), unit: "万套", driverValue: essBias,
      provenance: { kind: "派生", drillType: "DemandSegment", drillId: "ess", drillField: "demandWanPerYearP50−act", drillValue: essBias } },
    { id: "order_backlog", factor: "在手订单需求（OPEN 未交付折口径）", contribution: 0, share: 0, unit: "万套", driverValue: 108.4,
      provenance: { kind: "实测", drillType: "Order", drillId: "*", drillField: "qty", drillValue: 1084000 } },
  ];
  demandDrivers[1]!.contribution = r1(demandContribution - demandDrivers[0]!.contribution); // 取余 → Σ叶=侧
  demandDrivers[1]!.share = r4(demandDrivers[1]!.contribution / demandContribution);
  const supplyDrivers = [
    // 无 capacity_gap 叶（capacityDaily 未落）——诚实缺，非编造。仅物料/OEE 真叶。
    // WO-MOCK-SCALE-TRUTH 量纲修正：`unit` 写着「万套」，旧 driverValue 却直接塞了 kitGap 的**吨**数（654）——
    // 屏上等于把吨当万套读。真后端此叶实测 46.02 万套；下钻证据仍是 654 吨（drillField=kitGap），两者分栏不混。
    { id: "material_gap", factor: "正极物料缺口（ΣkitGap 折万套）", contribution: 0, share: 0, unit: "万套", driverValue: 46.02,
      provenance: { kind: "派生", drillType: "MaterialBalance", drillId: "gapTon", drillField: "kitGap", drillValue: PLAN_VERSION_CURRENT.input.kitGap } },
    { id: "oee_loss", factor: "设备 OEE 损失（1−oee_current×产能）", contribution: r1(supplyContribution * 0.3), share: r4(0.3), unit: "万套", driverValue: 0.84,
      provenance: { kind: "实测", drillType: "Equipment", drillId: "oee_current", drillField: "oee_current", drillValue: 0.84 } },
  ];
  supplyDrivers[0]!.contribution = r1(supplyContribution - supplyDrivers[1]!.contribution); // 取余 → Σ叶=侧
  supplyDrivers[0]!.share = r4(supplyDrivers[0]!.contribution / supplyContribution);
  const sumChildren = r1(demandContribution + supplyContribution);
  return {
    rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit: "万套", gap: G },
    totalGap: G, unit: "万套",
    demandSide: { contribution: demandContribution, share: r4(demandContribution / G), pct: Math.round((demandContribution / G) * 100), drivers: demandDrivers },
    supplySide: { contribution: supplyContribution, share: r4(supplyContribution / G), pct: Math.round((supplyContribution / G) * 100), drivers: supplyDrivers },
    residual, reconChecks: [{ label: "Σ子=父", parentGap: G, sumChildren, residual, ok: r1(sumChildren + residual) === G }],
    reconciled: true, residualPct: Math.round((residual / G) * 100),
    summary: `产销缺口 ${G}万套 双向归因：需求端(预测虚高) ${Math.round((demandContribution / G) * 100)}% ⊥ 供给端(物料/OEE) ${Math.round((supplyContribution / G) * 100)}%，residual ${Math.round((residual / G) * 100)}%（产能数据未接·诚实空）`,
  };
}

function auth(request: Request): MockAccount | null {
  return accountFromAuth(request.headers.get("Authorization"));
}

/** 行级过滤（QOS §7.6 权限种子语义：base_manager:常州 仅常州数据） */
function filterByScope<T extends { bases?: string; name?: string }>(rows: T[], account: MockAccount): T[] {
  if (!account.baseScope) return rows;
  return rows.filter((r) => {
    const v = r.bases ?? r.name;
    return v == null || account.baseScope!.some((b) => String(v).includes(b));
  });
}

// WO-SCHEMA-ZH · 物料实例（对象 360 的 Material 分支）。定值、无随机；
// 属性列与 ontology/object-types mock 的 Material 属性对齐（含故意留白中文名的 devPct）。
const MOCK_MATERIALS = [
  { matId: "pos_ncm", name: "三元正极", unitPrice: 183.4, leadTime: 21, onHand: 6116, devPct: 0.08 },
  { matId: "sep_film", name: "隔膜", unitPrice: 12.6, leadTime: 14, onHand: 3480, devPct: 0.02 },
];

let idSeq = 1000;
const newId = (prefix: string) => `${prefix}-${++idSeq}`;

/**
 * WO-BEFE-F · DRIL 智能资源 mock 库（`/b/v1/resources*`）。
 *
 * **`capability` / `suitableQuestions` 只在详情里给，列表里刻意不给** —— 这不是偷懒，
 * 是照真后端的形状：`ResourceRegistryService.get()`（`apps/agentcore/src/dril/resource-registry.ts:253`）
 * 比 `list()`（:239）多一步 `overlayQuality`，详情本就比列表富。mock 若让两者一模一样，
 * 「详情端点接没接」在屏上就看不出差别 —— 那种 mock 会让接缝测试**恒绿**，正是本仓要堵的假绿。
 */
interface MockDrilResource {
  kind: string;
  key: string;
  label: string;
  description: string;
  domain?: string;
  tieredTags?: Record<string, string[]>;
  /** 只在 `GET /b/v1/resources/:kind/:key` 里下发的那部分（列表/检索一律剥掉）。 */
  detail: {
    capability: string;
    suitableQuestions: string[];
    notSuitableQuestions: string[];
    quality?: { successRate: number; usageCount: number; avgLatencyMs: number };
  };
}
const DRIL_RESOURCES: MockDrilResource[] = [
  {
    kind: "solver",
    key: "capacity_forecast",
    label: "产能推演",
    description: "推演产能满足度 P50/P90、缺口率、主瓶颈。",
    domain: "plan",
    tieredTags: { l1_domain: ["plan"], l2_decisionType: ["预测"], l5_algorithm: ["推演"] },
    detail: {
      capability: "给定型号与时窗，算出产能满足度与主瓶颈工序。",
      suitableQuestions: ["下季度 A 型号产能够不够？"],
      notSuitableQuestions: ["这批货运费多少？"],
      quality: { successRate: 0.92, usageCount: 17, avgLatencyMs: 240 },
    },
  },
  {
    kind: "slice",
    key: "model_capacity_network",
    label: "型号可产网络",
    description: "某型号可产基地网络切片。",
    domain: "plan",
    detail: {
      capability: "列出某型号可产的基地与产线拓扑。",
      suitableQuestions: ["常州能不能产 A 型号？"],
      notSuitableQuestions: ["A 型号毛利多少？"],
    },
  },
];

/**
 * WO-BEFE-F · OC7 配额状态派生 —— 与真后端 `budgetStatus()`
 * （`apps/datacore/src/app.ts:1269-1274`）逐行同构，**mock 里不存派生值**：
 * hard=0 ⇒ 恒 OK（0 的语义是「不限」，不是「上限为零」）。
 */
const mockBudgetStatus = () => {
  const b = db.llmBudget;
  const soft = Math.floor(b.hardLimitTokens * b.softLimitPct);
  const state =
    b.hardLimitTokens > 0 && b.usedTokens >= b.hardLimitTokens
      ? "HARD_EXCEEDED"
      : b.hardLimitTokens > 0 && b.usedTokens >= soft
        ? "SOFT_EXCEEDED"
        : "OK";
  return {
    usedTokens: b.usedTokens,
    hardLimitTokens: b.hardLimitTokens,
    softLimitTokens: soft,
    state,
    degrade: state !== "OK",
  };
};
const mockCategoryMode: Record<string, "SYSTEM_INTEGRATION" | "FILE_UPLOAD"> = {};
const mockCategoryTpl: Record<string, string[] | null> = {};

// ---- A7 Foundry-Grade Data Builder mock ----
const DATA_BUILDER_PRESET = {
  id: "dba-preset",
  tenantId: "demo",
  key: "foundry-grade-data-builder",
  version: 1,
  name: "Foundry-Grade Data Builder",
  description: "工业级数据构建发动机（v1，可二次配置）",
  status: "PUBLISHED",
  config: {
    llm: { binding: "extraction" },
    determinism: { freezePlan: true, seed: 42 },
    closure: {
      object: { mode: "HARD", fallback: ["BIND_EXISTING_SLICE", "CREATE_SLICE"] },
      data: { mode: "SOFT", onOrphan: "PASS_AND_MARK" },
      forward: { mode: "HARD" },
    },
    moduleAdapters: {
      rawIn: ["connector.excel", "knowledge-base", "constraint-doc", "timeseries", "solver-params"],
      transform: ["ontology-modeling", "rule-extract", "derivation"],
    },
    publish: { auto: true, allowOnlineEdit: true },
    audit: { trail: true, rollback: true },
  },
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};
const MOCK_BUILD_JOBS: unknown[] = [];

/**
 * WO-AGENTRUN-ATTRIBUTION · Agent 运行记录（形状对着 `AgentRunRecordSchema`）。
 *
 * **一份数据、两个读端**（`/queries/:taskId/agent-run` 与 `/agents/:id/runs` 都从这里取）——
 * 抄成两份就会漂：真后端两个读端读的是同一行库记录，mock 里各写各的当场就制造出一个
 * 「同一次运行在两个界面上数字不一样」的假象，而那个假象在真部署里不存在。
 *
 * 归属刻意覆盖三态（这正是界面要区分的三种情况，缺一种就测不出诚实位）：
 *  · `run-agent-1`  → EXPLORATORY：`task-agent-1` 是 dash 视图上的自由问句，真走探索路，
 *                     全程没有 Agent 定义参与。这不是"忘了填 agentId"，是引擎正面声明。
 *  · `run-explore-*`→ REGISTERED：真绑到 `explore_agent` 的两次运行，且**跨版本**（v1 / v2）——
 *                     用来钉死「按 key 聚合」这条：若哪天改成按 id 过滤，v1 那条会当场消失。
 *  · `run-legacy-1` → 无任何归属字段：归属上线前的旧记录，**未知**。它必须既不出现在
 *                     任何 Agent 的运行列表里，也不被当成 EXPLORATORY 混算。
 * `contextOps: []` 同样是刻意的真值（欠账 #91：默认 20 万窗口下软阈值够不到，三刀一次都不会跑）。
 *
 * WO-AGENTRUN-FANOUT-PERSIST · `origin` 同样覆盖三态，且**与归属正交**（别把两列合读）：
 *  · 今天的引擎给每条新记录都写 `origin` —— 顶层 `ROOT`，`invoke_agent` 扇出的子运行 `FANOUT`。
 *    故除 `run-legacy-1` 外每条都必须有，漏写就是 mock 形状比真后端旧了一个版本。
 *  · `run-fanout-1` → FANOUT + REGISTERED：一条记录同时是"被会诊叫去的"和"归属明确的"，
 *    这是**正常**形态而非矛盾 —— 位置回答"谁叫它跑的"，归属回答"跑的是哪个 Agent"。
 *  · `run-legacy-1` → 无 `origin`：本字段上线前的旧记录，界面显示 "—"，不冒充「直接运行」。
 */
const AGENT_RUNS: AgentRunRecord[] = [
  {
    id: "run-agent-1",
    taskId: "task-agent-1",
    model: "claude-opus-4-8",
    iterations: [
      {
        index: 0,
        toolCalls: [
          { toolCallId: "toolu_1", toolName: "discover", input: {}, outcome: "OK", durationMs: 120 },
          { toolCallId: "toolu_2", toolName: "query_objects", input: { objectType: "Order" }, outcome: "OK", durationMs: 310 },
        ],
      },
      {
        index: 1,
        toolCalls: [{ toolCallId: "toolu_3", toolName: "invoke_solver", input: { solver: "capacity_forecast" }, outcome: "OK", durationMs: 1840 }],
      },
      {
        index: 2,
        toolCalls: [{ toolCallId: "toolu_4", toolName: "evaluate_rules", input: {}, outcome: "ERROR", durationMs: 95 }],
      },
    ],
    budget: { maxIterations: 24, maxToolCalls: 40, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
    budgetExhausted: false,
    totalInputTokens: 18432,
    totalOutputTokens: 2106,
    contextOps: [],
    tenantId: TENANT_ID,
    attribution: "EXPLORATORY",
    origin: "ROOT", // 探索路也是**这个任务自己**那次循环（位置与归属正交：ROOT + EXPLORATORY 并存）
    createdAt: "2026-06-16T10:20:31Z",
  },
  {
    id: "run-explore-2",
    taskId: "task-explore-2",
    model: "claude-opus-4-8",
    iterations: [
      { index: 0, toolCalls: [{ toolCallId: "toolu_e1", toolName: "query_objects", input: { objectType: "Base" }, outcome: "OK", durationMs: 210 }] },
      { index: 1, toolCalls: [{ toolCallId: "toolu_e2", toolName: "invoke_solver", input: { solver: "capacity_forecast" }, outcome: "OK", durationMs: 1620 }] },
    ],
    budget: { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
    budgetExhausted: false,
    totalInputTokens: 9120,
    totalOutputTokens: 1340,
    contextOps: [],
    tenantId: TENANT_ID,
    agentId: "agt-explore",
    agentKey: "explore_agent",
    agentVersion: 2,
    attribution: "REGISTERED",
    origin: "ROOT",
    createdAt: "2026-06-16T14:02:10Z",
  },
  {
    id: "run-explore-1",
    taskId: "task-explore-1",
    model: "claude-opus-4-8",
    iterations: [{ index: 0, toolCalls: [{ toolCallId: "toolu_o1", toolName: "query_objects", input: { objectType: "Order" }, outcome: "OK", durationMs: 180 }] }],
    budget: { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
    budgetExhausted: false,
    totalInputTokens: 4210,
    totalOutputTokens: 660,
    contextOps: [],
    tenantId: TENANT_ID,
    agentId: "agt-explore-v1",
    agentKey: "explore_agent",
    agentVersion: 1,
    attribution: "REGISTERED",
    origin: "ROOT",
    createdAt: "2026-06-15T11:41:00Z",
  },
  {
    /**
     * WO-AGENTRUN-FANOUT-PERSIST · **会诊扇出的子运行**（此前这类记录在全仓根本不存在）。
     *
     * 真实形态刻意照抄后端：`taskId` 是**会诊那个任务**的 id（子 agent 挂父任务，事件才串得起来），
     * `origin: "FANOUT"` + `stepId: "dispatch_0"`（它是三角里的第一路），归属仍是 REGISTERED ——
     * 位置与归属正交，一条记录同时是 FANOUT 和 REGISTERED 是**正常**的，不是矛盾。
     * 有了它，`explore_agent` 的运行数从 2 变 3，界面必须能说清多出来的那次是被会诊叫去的。
     */
    id: "run-fanout-1",
    taskId: "task-consult-1",
    model: "claude-opus-4-8",
    iterations: [
      { index: 0, toolCalls: [{ toolCallId: "toolu_f1", toolName: "query_objects", input: { objectType: "Material" }, outcome: "OK", durationMs: 240 }] },
    ],
    budget: { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
    budgetExhausted: false,
    totalInputTokens: 3180,
    totalOutputTokens: 470,
    contextOps: [],
    tenantId: TENANT_ID,
    agentId: "agt-explore",
    agentKey: "explore_agent",
    agentVersion: 2,
    attribution: "REGISTERED",
    origin: "FANOUT",
    stepId: "dispatch_0",
    createdAt: "2026-06-16T15:30:00Z",
  },
  {
    id: "run-legacy-1",
    taskId: "task-legacy-1",
    model: "claude-opus-4-8",
    iterations: [],
    budget: { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
    budgetExhausted: false,
    totalInputTokens: 100,
    totalOutputTokens: 20,
  },
];
// g8 故事驱动建域 · P1：StoryBuildRun 历史推演记录（mock 模式内存存储，提交→列出可见）
const META_POLICY = { tenantId: "demo", roles: ["admin"] as string[] };
const MOCK_STORY_RUNS: { id: string; script: string; status: string; createdAt: string; [k: string]: unknown }[] = [];
/** 工业级工作流运行时 mock：6 步持久化步骤状态机（happy 路径全 SUCCEEDED，含一个 SKIPPED 演示两轴分离）。 */
const WF_STEP_DEFS: { stepKey: string; title: string }[] = [
  { stepKey: "dry_build", title: "试建：出 BuildPlan + A 三向闭包（不发布）" },
  { stepKey: "cross_scaffold", title: "跨系统下发：A 闭包通过则向 AgentCore 下发 B 栈 scaffold" },
  { stepKey: "gap_analysis", title: "比对现状：倒推 BuildPlan vs 系统现状（跨模块统一 diff）" },
  { stepKey: "publish_build", title: "全链 HARD 门：A⊕B 闭合则真建 + 发布 + 落切片" },
  { stepKey: "validation", title: "推演验证痕迹：结论依据反向核对知识图谱" },
  { stepKey: "inference", title: "一键推演：故事主问句经 QOS/求解器跑出答案" },
  { stepKey: "record", title: "记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded" },
];
const MOCK_GAP = {
  entries: [
    { kind: "dataset", side: "content", needed: 5, existing: 1, toCreate: 4, missing: 0, items: [] },
    { kind: "ontology_type", side: "structure", needed: 8, existing: 3, toCreate: 5, missing: 0, items: [] },
    { kind: "rule", side: "structure", needed: 1, existing: 0, toCreate: 1, missing: 0, items: [] },
    { kind: "slice", side: "structure", needed: 8, existing: 0, toCreate: 8, missing: 0, items: [] },
    { kind: "solver", side: "code", needed: 5, existing: 4, toCreate: 0, missing: 1, items: [{ key: "schedule_impact", status: "MISSING" }] },
    { kind: "intent", side: "cross_system", needed: 5, existing: 0, toCreate: 5, missing: 0, items: [] },
  ],
  totals: { needed: 21, existing: 8, toCreate: 12, missing: 1 },
  generatedAt: new Date().toISOString(),
};
const MOCK_SCAFFOLD_MANIFEST = {
  runId: "mock",
  items: [
    { module: "agent", key: "agt_affected_orders", status: "PENDING_BSTACK", definition: { systemPrompt: "针对 affected_orders 的推演分析 agent", tools: ["affected_orders"] } },
    { module: "plan", key: "plan_affected_orders", status: "PENDING_BSTACK", definition: { steps: ["invoke_solver", "render"], solverKey: "affected_orders" } },
    { module: "scene", key: "scene_affected_orders", status: "PENDING_BSTACK", definition: { targetView: "risk", mode: "WORKFLOW" } },
  ],
  fullChainOk: false,
  pendingBstack: true,
  recordedAt: new Date().toISOString(),
};
function mockWorkflowRun(script: string, seed: number, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  const id = newId("bwf");
  const storyRunId = newId("sbr");
  const failAt = status === "FAILED" ? "cross_scaffold" : null;
  let hitFail = false;
  const steps = WF_STEP_DEFS.map((d) => {
    if (hitFail) return { ...d, status: "PENDING", attempts: 0, maxAttempts: d.stepKey === "cross_scaffold" ? 3 : 1 };
    if (d.stepKey === failAt) { hitFail = true; return { ...d, status: "FAILED", attempts: 3, maxAttempts: 3, durationMs: 12, error: { code: "SCAFFOLD_HTTP", message: "scaffold 下发失败：连接超时", retryable: true } }; }
    const skipped = d.stepKey === "inference"; // 演示 SKIPPED（未要求推演）
    if (d.stepKey === "gap_analysis") {
      return { ...d, status: "SUCCEEDED", attempts: 1, maxAttempts: 1, durationMs: 6, detail: "需 21 · 复用 8 · 新建 12 · 缺 1", checkpoint: { gapAnalysis: MOCK_GAP } };
    }
    if (d.stepKey === "cross_scaffold") {
      // A7：单机态 B 栈 scaffold 清单（pending-bstack，看得到倒推出的 agent/plan/scene 定义）
      return { ...d, status: "SUCCEEDED", attempts: 1, maxAttempts: 3, durationMs: 7, detail: "bOk=true · 单机可见(待B对账)", checkpoint: { scaffoldManifest: MOCK_SCAFFOLD_MANIFEST } };
    }
    return { ...d, status: skipped ? "SKIPPED" : "SUCCEEDED", attempts: 1, maxAttempts: d.stepKey === "cross_scaffold" ? 3 : 1, durationMs: 5 + (idSeq % 9), detail: d.stepKey === "record" ? `status=${status}` : undefined };
  });
  // 形状显式写全（WO-87）：`steps[].attempts/durationMs/error` 与 `context` 早就在数据里，
  // 只是旧断言把它们收进了 `[k:string]: unknown` ⇒ 驱动逻辑一碰就是编译错。写全 = 让类型替我们咬。
  return { id, tenantId: "demo", kind: "story_build", script, scriptHash: "mockhash", seed, inference: false, status, steps, context: {}, storyRunId: status === "SUCCEEDED" ? storyRunId : undefined, resumedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as {
    id: string;
    status: string;
    steps: { stepKey: string; status: string; attempts?: number; maxAttempts?: number; durationMs?: number; detail?: string; error?: { code: string; message: string; retryable: boolean } }[];
    context: Record<string, unknown>;
    storyRunId?: string;
    [k: string]: unknown;
  };
}
const MOCK_WORKFLOW_RUNS: ReturnType<typeof mockWorkflowRun>[] = [];
/**
 * 清空运行台账（测试现场清理）。`resetMockDb()` 够不着这个模块级数组 ——
 * 不清就会出现「同文件里后一条用例看见前一条留下的运行」这种顺序耦合，
 * 而 `POST /workflow-runs` 的「第一条故意失败」演示行为正是**看长度**决定的。
 */
export function resetMockWorkflowRuns(): void {
  MOCK_WORKFLOW_RUNS.length = 0;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * WO-87 · story_build 的**执行侧**也按生效 pipeline 跑（此前只有 intake 按它跑）。
 *
 * 为什么必须补这一半：`PipelineConfigPage.tsx:177 PausedRuns` 的放行入口早就挂上了，
 * 但它的数据源 `GET /a/v1/databuilder/workflow-runs` 里**永远不会出现 PAUSED**——
 * 旧 `POST /workflow-runs`（:4115）压根不读 pipeline，只在 FAILED/SUCCEEDED 二选一。
 * 于是「接了线**没数据**」（铁律 0.5 第二形态）：按钮在场、一次也不可能渲染出来 ⇒ 配了
 * 「要人工放行」的建域运行在屏上是**死锁**。补这一半后死锁闭合，且是端到端可驱动的。
 *
 * 语义逐条对齐真后端（不是另发明一套）：
 *  · 节点 `enabled:false` ⇒ 该步**不进 steps**  — `datacore/databuilder/pipeline-defs.ts:154`
 *    `resolvePipelineSteps` 里的 `if (!n.enabled) continue`；
 *  · 首个未获放行的 `requiresHumanApproval` 节点 ⇒ 该步及其后回 PENDING、run 置 PAUSED、**保留现场**
 *    — `datacore/databuilder/workflow-engine.ts:192-199`；
 *  · 放行名单存在 `run.context.__approvedSteps` — `workflow-engine.ts:51 APPROVAL_KEY`；
 *  · approve = 记名单 + resume 续跑（不是把整条 run 直接判成功）— `databuilder/service.ts:640`；
 *  · 闸在失败步**之后**时，失败先发生 ⇒ run 仍是 FAILED（drive 遇 FATAL 即 return，够不到闸）。
 *
 * 出厂 pipeline（7 节点全启用 · 零放行节点）下这几个函数是**恒等变换** ⇒ 既有 mock 行为不变。
 * ────────────────────────────────────────────────────────────────────────────── */

/** 放行名单键：与 datacore `workflow-engine.ts:51` 的 `APPROVAL_KEY` 同名同义。 */
const MOCK_APPROVAL_KEY = "__approvedSteps";

type MockWfRun = ReturnType<typeof mockWorkflowRun>;

/** 该 run 已放行的步（context 里的名单）。 */
function mockApprovedSteps(wf: MockWfRun): Set<string> {
  const list = wf.context?.[MOCK_APPROVAL_KEY];
  return new Set(Array.isArray(list) ? (list as string[]) : []);
}

/** 生效 story_build pipeline 的执行序（已滤掉停用节点）。 */
function storyPipelineOrder() {
  const pipeline = resolvePipeline("story_build");
  return pipelineOrder(pipeline).filter((n) => n.enabled);
}

/** 该步是否为「等人放行」的闸（配了 requiresHumanApproval 且本 run 尚未放行）。 */
function isBlockingGate(wf: MockWfRun, stepKey: string): boolean {
  const node = storyPipelineOrder().find((n) => n.stepKey === stepKey);
  return !!node?.sop.requiresHumanApproval && !mockApprovedSteps(wf).has(stepKey);
}

/**
 * 按生效 pipeline 驱动一条 mock run 到下一个终态/暂停点（同步 POST 与 approve 后的 resume 共用一份）。
 * 共用而非各抄一份，正是为了避免「两套机制不对接」——真后端也是 drive 一份实现被 start/resume 共用。
 */
function driveMockStoryRun(wf: MockWfRun) {
  const keep = new Set(storyPipelineOrder().map((n) => n.stepKey));
  wf.steps = wf.steps.filter((s) => keep.has(s.stepKey)); // 停用节点：不执行也不出现在轨迹里
  for (const s of wf.steps) {
    if (isBlockingGate(wf, s.stepKey)) {
      // 停在该步**之前**：闸步及其后全部回 PENDING（现场保留，闸前跑完的步不动）。
      let hit = false;
      for (const x of wf.steps) {
        if (x.stepKey === s.stepKey) hit = true;
        if (hit) { x.status = "PENDING"; x.attempts = 0; x.durationMs = undefined; x.error = undefined; }
      }
      wf.status = "PAUSED";
      wf.storyRunId = undefined;
      return wf;
    }
    if (s.status === "FAILED") { wf.status = "FAILED"; return wf; } // 致命：止于该步，够不到后面的闸
    if (s.status === "PENDING" || s.status === "RUNNING") { s.status = s.stepKey === "inference" ? "SKIPPED" : "SUCCEEDED"; s.attempts = 1; s.durationMs = 6; }
  }
  wf.status = "SUCCEEDED";
  wf.storyRunId = wf.storyRunId ?? newId("sbr");
  return wf;
}

/** 推进一个异步 RUNNING 运行一步（模拟后台脱离驱动；轮询即见逐步实时跳动）。 */
function advanceMockWorkflow(wf: MockWfRun) {
  if (wf.status !== "RUNNING") return;
  const next = wf.steps.find((s) => s.status === "PENDING");
  // 异步后台驱动同样受闸约束：走到未放行的闸就停 PAUSED 等人（不许偷偷跑过去）。
  if (next && isBlockingGate(wf, next.stepKey)) { wf.status = "PAUSED"; return; }
  if (next) { next.status = next.stepKey === "inference" ? "SKIPPED" : "SUCCEEDED"; next.durationMs = 6; }
  if (!wf.steps.some((s) => s.status === "PENDING")) { wf.status = "SUCCEEDED"; wf.storyRunId = wf.storyRunId ?? newId("sbr"); }
}
/** 全栈 BuildPlan mock（区2 故事理解分组卡片渲染源）：故事倒推出的全栈制品，命名条目供前端结构化展示。 */
function mockBuildPlan(planId: string) {
  return {
    id: planId,
    dataSources: [{ connType: "synthetic", name: "合成数据源（确定性生成）", datasetKey: "ds_order", rowCount: 120, fields: [] }],
    objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "order", properties: [] }, { typeKey: "Base", displayName: "基地", domain: "capacity", properties: [] }],
    sliceNeeds: [{ sliceKey: "order_risk", rootType: "Order", hops: [] }],
    rules: [{ key: "C03", name: "产能约束", expression: "load <= capacity", scopeObjectTypes: ["Base"], severity: "WARN" }],
    solverNeeds: [{ solverKey: "affected_orders", inputFields: [] }],
    intentNeeds: [{ intentKey: "risk_inference", triggers: ["风险推演"], slots: [], riskLevel: "MEDIUM" }],
    planNeeds: [{ planKey: "risk_plan", steps: ["invoke_solver", "render_answer"], renderBindings: [] }],
    workflowNeeds: [{ workflowKey: "risk_workflow", kind: "workflow", steps: [] }],
    skillNeeds: [{ skillKey: "risk_skill", capability: "风险评估", resources: [] }],
    agentNeeds: [{ agentKey: "risk_agent", systemPrompt: "", tools: [], skills: [], ruleBindings: [], scopeObjectTypes: [] }],
    mcpNeeds: [{ serverName: "risk_mcp", tools: [] }],
    sceneNeeds: [{ scenarioKey: "risk_scene", targetView: "risk", presetContext: {} }],
    kbDocs: [{ title: "风险评估手册", content: "" }],
  };
}
/** 区6③ 故事覆盖度 mock：逐句对账，命中已知关键词 = mapped，否则未理解（与后端口径一致）。 */
function mockStoryCoverage(script: string) {
  const KW = ["基地", "订单", "风险", "产能", "信用", "客户", "利用率", "物料", "交期"];
  return script
    .split(/[。！？；;.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => {
      const refs = KW.filter((k) => text.includes(k));
      return { text, mapped: refs.length > 0, refs };
    });
}
/** 区6④ 推演验证痕迹 mock：一致性（实体/公理/版本钉/数字溯源）+ 交叉验证（结论依据对象 vs KG）。 */
function mockValidationTrace() {
  return {
    slicesUsed: ["order_risk"],
    consistency: {
      checks: [
        { kind: "ENTITY_DEFINED", ref: "Order", status: "PASS", detail: "对象类型 订单 已在本体定义" },
        { kind: "AXIOM", ref: "C03", status: "PASS", detail: "load <= capacity" },
        { kind: "VERSION_PIN", ref: "bpl_mock", status: "PASS" },
        { kind: "NUMERIC_PROVENANCE", ref: "affected_orders", status: "PASS" },
      ],
      verdict: "ALL_PASS",
    },
    crossValidation: {
      claims: [{ claim: "Order:SO-1.qty == 1.5", kind: "PROPERTY", subjectType: "Order", subjectId: "SO-1", property: "qty", assertedValue: 1.5, status: "CONSISTENT" }],
      verdict: "ALL_CONSISTENT",
    },
    generatedAt: new Date().toISOString(),
  };
}
/** 区5 模块同步矩阵真值源 mock：跨多模块的产出（A 栈已发布 + B 栈 DRAFT，对应 scaffold）。 */
function mockProducedArtifacts() {
  return [
    { module: "connector", kind: "connection", key: "conn_mock", action: "CREATED", status: "PUBLISHED" },
    { module: "connector", kind: "dataset", key: "rds_mock", action: "CREATED", status: "PUBLISHED" },
    { module: "ontology", kind: "objectType", key: "Order", action: "CREATED", status: "PUBLISHED" },
    { module: "ontology", kind: "objectType", key: "Base", action: "CREATED", status: "PUBLISHED" },
    { module: "slice", kind: "slice", key: "order_risk", action: "CREATED", status: "PUBLISHED" },
    { module: "rule", kind: "rule", key: "C03", action: "CREATED", status: "PUBLISHED" },
    { module: "solver", kind: "solver", key: "affected_orders", action: "REUSED", status: "PUBLISHED" },
    { module: "catalog", kind: "intent", key: "risk_inference", action: "CREATED", status: "DRAFT" },
    { module: "workflow", kind: "workflow", key: "risk_workflow", action: "CREATED", status: "DRAFT" },
    { module: "agent", kind: "agent", key: "risk_agent", action: "CREATED", status: "DRAFT" },
    { module: "scene", kind: "scene", key: "risk_scene", action: "CREATED", status: "DRAFT" },
  ];
}
const MOCK_RAW_ROWS: Record<string, Record<string, unknown>[]> = {
  default: [
    { so: "SO-10001", cust: "蔚途汽车", qty: "1.5", due: "2026-06-20" },
    { so: "SO-10002", cust: "星河储能", qty: "0.82", due: "2026-06-25" },
    { so: "SO-10003", cust: "蓝海电网", qty: "1.1", due: "2026-06-28" },
  ],
};
/** WO-DBUI-FLOW：比对现状四分（需要/复用/新建/缺）——第 ② 步的一等内容。 */
function mockGapAnalysis() {
  return {
    entries: [
      { kind: "objectType", side: "structure", needed: 3, existing: 1, toCreate: 2, missing: 0, items: [{ key: "Order", status: "EXISTS" }, { key: "Base", status: "TO_CREATE" }, { key: "Customer", status: "TO_CREATE" }] },
      { kind: "solver", side: "code", needed: 1, existing: 1, toCreate: 0, missing: 0, items: [{ key: "affected_orders", status: "EXISTS" }] },
      { kind: "rule", side: "content", needed: 1, existing: 0, toCreate: 1, missing: 0, items: [{ key: "C03", status: "TO_CREATE" }] },
    ],
    totals: { needed: 5, existing: 2, toCreate: 3, missing: 0 },
    generatedAt: new Date().toISOString(),
  };
}

function mockBuildJob(body: { script?: string; seed?: number; dryRun?: boolean }) {
  const seed = body.seed ?? 42;
  const script = (body.script ?? "").toLowerCase();
  const types = ["Order", "Base"];
  if (script.includes("客户") || script.includes("信用") || script.includes("credit")) types.push("Customer");
  const dryRun = !!body.dryRun;
  const allPhases = ["intake", "comprehend", "gap", "rawin", "transform", "closure", "publish"] as const;
  const phases = allPhases.map((name) => ({
    name,
    status: dryRun && ["gap", "rawin", "transform", "publish"].includes(name) ? "SKIPPED" : "DONE",
  }));
  const closure = {
    gatePassed: true,
    objectsBound: types.length,
    dataOrphans: 0,
    forwardMissing: 0,
    findings: types.map((t) => ({ kind: "OBJECT", ref: t, status: "BOUND" })),
  };
  const planId = `bpl_demo_${script.length}_${seed}`;
  const job = {
    id: newId("bjb"),
    jobId: newId("bjb"),
    tenantId: "demo",
    builderKey: "foundry-grade-data-builder",
    scriptHash: String(script.length),
    seed,
    dryRun,
    replayed: false,
    status: "SUCCEEDED",
    phases,
    planId,
    closure,
    preview: dryRun
      ? { dataSources: types.map((t) => ({ name: `${t}数据源`, datasetKey: t.toLowerCase(), rowCount: 20, fields: 4 })), objectTypes: types, rules: ["C03"], solverNeeds: ["affected_orders"], kbDocs: 1 }
      : undefined,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  MOCK_BUILD_JOBS.unshift(job);
  return job;
}

// A18.4 求解器审核台 mock：一个审核中临时件（LLM 生成、未认证）+ 一个已治理件（mutable，promote 翻转）。
const MOCK_SOLVER_ARTIFACTS: {
  id: string; tenantId: string; key: string; computeSource: string; outputShape: string[]; argHints: Record<string, string>;
  rationale: string; origin: string; status: string; trustLevel: string; hash: string; version: number; createdBy: string; createdAt: string; rejectReason?: string;
}[] = [
  {
    id: "sart_demo_seg_share_v1", tenantId: "demo", key: "seg_share_forecast",
    computeSource: "(ctx, args) => {\n  const segs = ctx.objectsByType.DemandSegment || [];\n  const total = segs.reduce((s, d) => s + (d.demandWanPerYearP50 || 0), 0);\n  return { rows: segs.map(d => ({ segment: d.segment, share: total ? d.demandWanPerYearP50 / total : 0 })) };\n}",
    outputShape: ["rows"], argHints: {}, rationale: "按需求细分 P50（万套/年）计算各业态占比，回答『储能占比是多少』。",
    origin: "LLM", status: "PROVISIONAL", trustLevel: "UNVERIFIED", hash: "a1b2c3d4e5f60718", version: 1, createdBy: "usr_demo_admin", createdAt: "2026-06-22T02:00:00.000Z",
  },
  {
    id: "sart_demo_mat_cov_v2", tenantId: "demo", key: "material_coverage",
    computeSource: "(ctx, args) => {\n  const m = ctx.objectsByType.MaterialBalance || [];\n  return { rows: m.map(x => ({ material: x.material, cov: x.ltaPct })) };\n}",
    outputShape: ["rows"], argHints: {}, rationale: "列各物料长协覆盖率。",
    origin: "LLM", status: "GOVERNED", trustLevel: "VERIFIED", hash: "f0e1d2c3b4a59687", version: 2, createdBy: "usr_demo_planner", createdAt: "2026-06-21T09:00:00.000Z",
  },
];

// V11 · VLE 段级红绿矩阵 mock 断言集（七段抽样 + ⑤参照双算 + 一条失败 diff 供下钻）。
const VLE_MOCK_ASSERTIONS = [
  { segment: "①接入", point: "接入产出核心类型行数 == GenSpec", oracle: "constructed", pass: true, expected: { Base: 13, Model: 6, Order: 24 }, actual: { Base: 13, Model: 6, Order: 24 } },
  { segment: "②建模与对象化", point: "链接引用完整性（悬挂引用=0）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
  { segment: "③聚合与派生", point: "聚合下推 == 明细求和（守恒律）", oracle: "invariant", pass: true, expected: 4680, actual: 4680 },
  { segment: "④规则查全查准", point: "植入越线行被独立谓词捕获（C03）", oracle: "constructed", pass: true, expected: ">0", actual: 3 },
  { segment: "⑤求解器执行", point: "参照实现双算 capacity_forecast P50/P90", oracle: "reference", pass: false, expected: { capWanP50: 6.3625, capWanP90: 5.9171 }, actual: { capWanP50: 6.3625, capWanP90: 2.9586 }, diff: "P90 期望 5.9171 实际 2.9586（Δ2.9585）· 首个偏离基地 BASE-CZ" },
  { segment: "⑥行动终态", point: "真值变更必经审批（审批链非空）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
  { segment: "⑦校准注入", point: "校准注入即收敛（mapeAfter<mapeBefore）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
] as const;

/**
 * WO-PROJECT-SIM-WHATIF · generic_inference mode:"levers" 确定性桩（杠杆随⑤瓶颈变·服务端算敏感度镜像）：
 * 从 args.factors（⑤瓶颈因子/瓶颈名）映到候选杠杆集——产能瓶颈出产能杠杆、物料瓶颈出物料杠杆，两集不同（证非写死）。
 * 每根杠杆带确定性 sensitivity（tornado 排序=真敏感度）+ provenance；SEAM 测可 server.use 覆盖精确 payload（KILL-MOCK）。
 */
function mockLeverDiscovery(args: Record<string, unknown>): Record<string, unknown> {
  const factors = Array.isArray(args.factors) ? (args.factors as unknown[]).map(String) : [];
  const prov = (leaf: string) => ({ src: "generic_inference · recompute(dryRun,+ε)", formula: `∂(Base.oeeIndex) / ∂(${leaf})`, inputs: [leaf] });
  const levers: Record<string, unknown>[] = [];
  // 主瓶颈（factors[0]=⑤ mainBn）决定杠杆集类别：物料主瓶颈 → 物料杠杆，其余 → 产能杠杆（杠杆随瓶颈变）。
  const material = /物料|齐套|料/.test(factors[0] ?? "");
  // WO-LEVER-UNIT：mock 镜像后端单源——比率类杠杆下发 unit:"%"+valueKind:"ratio"（前端 0–1 存储显示为 %·mock/真同口径）。
  if (material) {
    levers.push({ objectType: "Order", objectId: "obj_Order_SO-10001", prop: "outsourceRatio", factor: "物料齐套·外协", unit: "%", valueKind: "ratio", currentValue: 0, sensitivity: 1.1, provenance: prov("Order.outsourceRatio") });
    levers.push({ objectType: "MaterialBalance", objectId: "obj_MaterialBalance_MB-1", prop: "coverage", factor: "物料齐套·长协覆盖", unit: "%", valueKind: "ratio", currentValue: 0.72, sensitivity: 0.7, provenance: prov("MaterialBalance.coverage") });
  } else {
    // 产能瓶颈（化成/通道/工序/OEE/利用/良率）：产能杠杆集（含外协杠杆供 C08 边界演示）。
    levers.push({ objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", factor: "设备OEE", unit: "%", valueKind: "ratio", currentValue: 0.82, sensitivity: 1.8, provenance: prov("Equipment.oee_current") });
    levers.push({ objectType: "Process", objectId: "obj_Process_P1", prop: "yield_baseline", factor: "良率波动", unit: "%", valueKind: "ratio", currentValue: 0.9, sensitivity: 1.2, provenance: prov("Process.yield_baseline") });
    levers.push({ objectType: "Line", objectId: "obj_Line_L1", prop: "utilization", factor: "瓶颈工序·利用率", unit: "%", valueKind: "ratio", currentValue: 0.75, sensitivity: 0.9, provenance: prov("Line.utilization") });
    levers.push({ objectType: "Order", objectId: "obj_Order_SO-10001", prop: "outsourceRatio", factor: "外协替代", unit: "%", valueKind: "ratio", currentValue: 0, sensitivity: 0.6, provenance: prov("Order.outsourceRatio") });
  }
  levers.sort((a, b) => Math.abs(Number(b.sensitivity)) - Math.abs(Number(a.sensitivity)));
  return { levers, deltas: [], rows: [], affectedObjects: 0, count: levers.length, rootTypes: [...new Set(levers.map((l) => String(l.objectType)))] };
}

/** generic_inference 默认路径（apply）确定性桩：前向重算下游派生 before/after，after 随假设值变（KILL-MOCK）。 */
function mockGenericInference(args: Record<string, unknown>): Record<string, unknown> | { __err: string } {
  const apply = Array.isArray(args.apply) ? (args.apply as { objectType?: unknown; objectId?: unknown; prop?: unknown; value?: unknown }[]) : [];
  if (apply.length === 0) return { __err: "generic_inference 需 apply:[{objectType,objectId,prop,value}]（假设值）" };
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const deltas = apply.map((a) => {
    const objId = String(a.objectId ?? "");
    const objType = String(a.objectType ?? "");
    const v = Number(a.value);
    const vnum = Number.isFinite(v) ? v : 1;
    // 下游聚合派生（Base.oeeIndex 口径）∝ 假设值，确定性、随假设值变。
    return { objId: `base-of-${objId}`, type: "Base", prop: "oeeIndex", before: 0.8, after: round2(0.8 * 0.5 + vnum * 0.5), rootObj: objId, rootType: objType };
  });
  const rows = deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after }));
  return { deltas, rows, affectedObjects: new Set(deltas.map((d) => d.objId)).size, count: deltas.length, rootTypes: [...new Set(apply.map((x) => String(x.objectType ?? "")))] };
}

// ===================================================================================
// WO-GSLIVE-1-COCKPIT · 全局推演「活系统」升级 MSW 桩（additive）——依赖两张未落 WO 的预期契约形状：
//   · 活②自由杠杆：portfolio 携 args.levers[{key,target,delta}] → 派生 leverDeltas（before/after 七维·drillType=Lever）
//     并把聚合改善反映到主方案 KPI（dev-mode 七维真变·KILL-MOCK）。真 portfolio levers[] 引擎合并态复验。
//   · 活①compose 路径（WO-LIVE-NL）：POST /b/v1/sim/compose → 联合求解叙述（含被挤单/按期率·ranAgentLoop=false·非 path-B）。
//   · 活③方案存/分支/横比（WO-LIVE-SCENARIO·SimSession solve-mode）：/a/v1/sim/scenarios(+/:id/branch, /compare)。
// 确定性（无 Date.now/random 影响数值·R6）；数值取自 mockGlobalSim / 杠杆 delta 派生（非编造）。
// ===================================================================================
type GsliveKpi7 = { ontime: number; cost: number; changeoverHours: number; freight: number; fgInv: number; transitInv: number; margin: number };
function gsliveKpi7From(sc: Record<string, unknown> | undefined): GsliveKpi7 {
  const kpi = sc?.kpi as Partial<GsliveKpi7> | undefined;
  if (kpi && typeof kpi.ontime === "number") {
    return { ontime: kpi.ontime, cost: kpi.cost ?? 0, changeoverHours: kpi.changeoverHours ?? 0, freight: kpi.freight ?? 0, fgInv: kpi.fgInv ?? 0, transitInv: kpi.transitInv ?? 0, margin: kpi.margin ?? 0 };
  }
  const ov = (sc?.objectiveValues ?? {}) as Record<string, number>;
  return { ontime: ov.ontime ?? 0, cost: ov.cost ?? 0, changeoverHours: ov.changeover ?? 0, freight: 0, fgInv: ov.fgInventory ?? 0, transitInv: 0, margin: 0 };
}
/** 杠杆 delta → 改善后七维（加产能：按期↑ 代价↓ 毛利↑·确定性系数·before≠after 当 delta≠0）。 */
function gsliveImprove(kpi: GsliveKpi7, delta: number): GsliveKpi7 {
  const d = Math.abs(delta);
  return {
    ontime: r2(kpi.ontime + Math.max(0, delta)),
    cost: r2(Math.max(0, kpi.cost - d * 40)),
    changeoverHours: kpi.changeoverHours,
    freight: kpi.freight,
    fgInv: kpi.fgInv,
    transitInv: kpi.transitInv,
    margin: r2(kpi.margin + d * 40),
  };
}
/** portfolio 响应携 levers[] → 叠加 leverDeltas + 主方案 KPI 改善（args.levers 空则原样返·无回归）。 */
function applyGslivePortfolioLevers(resp: Record<string, unknown>, args: Record<string, unknown>): Record<string, unknown> {
  const levers = (Array.isArray(args.levers) ? args.levers : []) as { key: string; target: string; delta: number }[];
  if (!levers.length) return resp;
  const scenarios = (resp.scenarios as Record<string, unknown>[] | undefined) ?? [];
  const objective = String(args.objective ?? "");
  const primarySc = scenarios.find((s) => s.key === objective) ?? scenarios[0];
  const baseKpi = gsliveKpi7From(primarySc);
  const leverDeltas = levers.map((l) => ({
    lever: { key: String(l.key), target: String(l.target), delta: Number(l.delta) || 0 },
    before: baseKpi,
    after: gsliveImprove(baseKpi, Number(l.delta) || 0),
    provenance: { kind: "派生", drillType: "Lever", drillId: String(l.target), drillField: String(l.key), drillValue: Number(l.delta) || 0, mockNote: "MSW 桩·leverDeltas（真 portfolio levers[] 引擎合并态复验）" },
  }));
  const totalDelta = levers.reduce((s, l) => s + (Number(l.delta) || 0), 0);
  const aggAfter = gsliveImprove(baseKpi, totalDelta);
  const newScenarios = scenarios.map((s) => {
    if (s !== primarySc) return s;
    const ov = { ...((s.objectiveValues as Record<string, number>) ?? {}) };
    ov.ontime = aggAfter.ontime; ov.cost = aggAfter.cost;
    return { ...s, kpi: aggAfter, objectiveValues: ov };
  });
  return { ...resp, scenarios: newScenarios, leverDeltas };
}
/** 活③方案存/分支 store（模块态·横比 compare 读回·R6 无随机数值）。 */
const gsliveScenarios = new Map<string, { id: string; label: string; parentId: string | null; page: string; primary: string; createdAt: string; kpi: GsliveKpi7; servedCount: number; displacedCount: number; ontimeRate: number }>();

/**
 * WO-L4B · 沙盘会话 store（模块态）。
 *
 * 原先 sim 这几条 mock 是**无状态桩**：POST /sessions 恒回 `sims_mock`，没有 GET /sessions 与 GET …/world
 * （后端 app.ts:1405/:1410 两条路由一直都在，是 mock 这边没镜像）。世界列表与世界态现在是
 * `sim.session_created` / `sim.branched` / `sim.tick_completed` 三个事件的真消费方，mock 必须
 * **有状态**才能证明"事件到达 → 重取 → 屏上真的变了"，否则重取回来的还是同一个死值，等于没测。
 * R6 确定性：id 走计数器、时间戳固定，无随机数、无真实时钟。
 */
type MockSimSession = { id: string; tenantId: string; baseSnapshot: Record<string, unknown>; scope: Record<string, unknown>; status: string; curTick: number; parentCheckpointId: string | null; createdAt: string; disabledRuleKeys?: string[] };
const mockSimSessions = new Map<string, MockSimSession>();
/**
 * WO-ACTIVE-EDGE-UX · 传导边目录（= `GET /a/v1/sim/propagation-rules` 的 mock 数据源）。
 *
 * 为什么必须加：`test/setup.ts` 起的是 `onUnhandledRequest: "error"` —— `EdgeActivePanel` 一挂上
 * 就会请求这条，mock 这边没镜像的话，**每一个挂了本面板的用例都会红**，而且红在一条与它自己
 * 无关的请求上（与扰动时间轴当初一模一样的坑）。
 *
 * 两条边的形状与 `GET /a/v1/ontology/mapping/registries` 的 mock 本体保持**同向**
 * （`Base --line_belongs_to_base(1:N)--> Line` 那条纪律的同族）：源类型/目标类型/链路 key
 * 三者必须与本体声明同向，写反 ⇒ `targetsOf` 恒空 ⇒ 规则一次都不触发且不报任何错。
 * 这里用 mock 世界自有的 `TypeA/TypeB/linkAB`（与 `/a/v1/sim/view-config` mock 同源），不引业务实体名（R14）。
 */
const mockSimWorlds = new Map<string, { tick: number; state: Record<string, unknown> }>();
/**
 * WO-SIM-PERTURB-TIMELINE · 扰动清单（= `GET …/:id/perturbations` 的 mock 数据源）。
 *
 * 为什么必须加这三条 handler：`test/setup.ts` 起的是 `onUnhandledRequest: "error"` ——
 * 扰动时间轴一挂上就会 `GET …/perturbations`，mock 这边没镜像的话，**每一个挂载 SandboxView
 * 的既有用例都会红**（而且红在一条与它自己无关的请求上，最容易被误判成"时间轴写坏了"）。
 * 顺带补齐 `POST`：WO-SIM-ACT-CLOSE 把施加口接上了，但 mock 模式下一直没有对应 handler，
 * 于是 `VITE_MOCK=1` 跑起来点「施加扰动」必然报错 —— 那是那一单留下的、只在 mock 模式暴露的口子。
 * R6 确定性：id 走计数器、`createdAt` 固定串，无随机数、无真实时钟。
 */
const mockSimPerturbations = new Map<string, Record<string, unknown>[]>();
/**
 * WO-BEFE-E · 存档清单 + 逐 tick 态历史（= `GET …/:id/checkpoints` 与 `POST …/:id/rollback` 的 mock 数据源）。
 *
 * 原先 `POST …/checkpoint` 是**无状态桩**：恒回 `{id:"cp_mock", tick:1}`，存进去的东西不落任何地方。
 * 于是"存两次得到两条""回滚真能把世界态拨回去"这两件事在 mock 上根本演不出来 —— 断言只能咬桩，
 * 那正是本仓治过的假绿。要证明接缝是通的，mock 必须**有状态**：
 *   · `mockSimCheckpoints`：每个会话的存档清单，排序与后端 `app.ts:1826` **同一把尺**（tick → createdAt → id）；
 *   · `mockSimTickHistory`：逐 tick 世界态，回滚据此**真取回**那一刻的态（不是把当前态原样回一遍）。
 * mock 只镜像后端已有语义（`deleteTicksAfter` + `curTick` 拨回），**不复制传导引擎** —— 那是第二套真相源。
 * R6 确定性：id 走计数器、`createdAt` 由 tick + 序号确定性拼出，无随机数、无真实时钟。
 */
const mockSimCheckpoints = new Map<string, { id: string; sessionId: string; tenantId: string; tick: number; label: string; createdAt: string }[]>();
const mockSimTickHistory = new Map<string, Map<number, Record<string, unknown>>>();
let mockSimSeq = 0;
let mockPertSeq = 0;

/**
 * WO-BEFE-A · **本体关系 store（有状态·接缝的承载物）**。
 *
 * 为什么必须有状态：本单要证的那句话是「在界面上建/停一条因果边 ⇒
 * `GET /a/v1/sim/view-config` 的 `stateVars`/`propagationCount` 真的跟着变」。
 * 若 `view-config` 还是原来那个**写死的桩**（`propagationCount: 1` 恒定），
 * 那条断言就成了「表单能提交」这种各半 unit —— 恰好是 SEAM-GATE 要堵的东西。
 *
 * 🔴 派生口径**逐条对齐后端**，不是我另编一套（对齐点在 `apps/datacore/src/app.ts:1873-1885`）：
 *   · `propagationCount` = `listPropagationRules(tenantId, true).length`
 *     而 `publishedOnly` 的过滤判据是 `status === "PUBLISHED"`（`repo/memory.ts:76`·`repo/pg.ts:114`）
 *     ⇒ **DRAFT（停用）的边不计数**；
 *   · `stateVars` = 上述已启用规则的 `sourceStateVar ∪ targetStateVar`，去重后 `.sort()`；
 *   · `linkTypes` = **全部**结构边的 key（`links.map(l => l.key).sort()`）——
 *     后端这里**不看 `deprecation`**，所以停用一条结构边 `linkTypes` 不会少一个。
 *     这不是 mock 偷懒，是后端的真实行为，测试据此断言「结构边的停用不影响推演口径」。
 * 这三条口径由 `test/ontology-relations.seam.test.tsx` 的事实锁钉在后端源码上：
 * 后端哪天改了过滤条件而 mock 没跟，机器当场报红。
 *
 * R6 确定性：id 走计数器、时间戳固定串，无随机数、无真实时钟。
 */
type MockLinkType = { key: string; fromType: string; toType: string; cardinality: string; deprecation?: { status: "DEPRECATED" | "RETIRED"; supersededBy?: string; deprecatedAt?: string; graceUntil?: string; retiredAt?: string } };
type MockPropRule = {
  id: string; tenantId: string; key: string;
  sourceTypeKey: string; sourceStateVar: string; viaLinkKey: string;
  targetTypeKey: string; targetStateVar: string;
  coefficient: number; delayTicks: number; combine: "sum" | "max";
  decay: null; clamp: null; coefficientRef: null; cadenceNodeId: null;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
};
type MockPublishRequest = { id: string; ontologyVersion: number; status: "PENDING" | "APPROVED" | "REJECTED"; touchedDomains: string[]; signoffs: { domainKey: string; decision: string }[]; createdAt: string };

/**
 * 结构边种子 —— 与映射表注册表段那个 handler 里的三条字面量**同一份真值**。
 *
 * ⚠ 为什么这里是「两处副本 + 机器盯着」而不是「一处」：那个 handler 里的字面量**不能**换成
 * `mockLinkTypes.map(...)` —— `apps/datacore/test/mock-linktype-direction.gate.test.ts:40`
 * 的抽取器读的是**本文件源码文本**（`indexOf("linkTypes: [", anchor)`），换成 store 读法它会抽出 0 条、
 * 当场报「工具坏了」。那是一道本单范围外的 datacore 门，不许碰坏。
 * 于是只能留两份，并把「两份必须一致」交给机器：`test/ontology-relations.seam.test.tsx` §④
 * 在**运行时**跨 `mapping/registries` 与 `ontology/versions` 两个端点逐 key 对账 —— 人忘了同步，机器先说话。
 * （方向纪律见该 handler 的欠账 #160 注释，逐字适用于本种子。）
 *
 * 🔴 **属性顺序是 `key → cardinality → fromType → toType`，与那个 handler 里的字面量故意不同 ——
 *    这不是笔误，改回去会弄红一道 datacore 门。**
 * 同一份 gate 文件（`mock-linktype-direction.gate.test.ts:112`）还有一条**变异反证**用例：
 * 它拿 `src.replace(<line_belongs_to_base 那一行的字面量原文>, <方向调换后的同一行>)`
 * 把方向改反，再验抽取器抽到反方向。
 * ⚠ 此处**故意不照抄那行原文** —— 照抄一遍就等于在文件里又造一个同样的字面量，
 *   `replace` 会落在这条注释上（本单已连栽两次同形态：上一次是把抽取器的搜索串
 *   写进注释，锚点落进注释自己）。**注释里写下工具要找的那个串 = 给工具埋假锚点。**
 * `String.replace(string, …)` 只换**第一处**；
 * 本常量在文件里排在那个 handler **之前**，若两处逐字节相同，变异就会落在这里、
 * 而抽取器读的仍是 handler 那份未变异的 ⇒ 该用例失败（2026-08-14 实测过：
 * `expected [ 'Base', 'Line' ] to deeply equal [ 'Line', 'Base' ]`）。
 * 换个属性顺序即让那条字面量在全文件**唯一**，变异照旧命中它该命中的地方。
 * 复验：`pnpm --filter datacore exec vitest run test/mock-linktype-direction.gate.test.ts`
 */
const MOCK_LINK_SEED: MockLinkType[] = [
  { key: "model_producible_at", cardinality: "N:N", fromType: "Model", toType: "Base" },
  { key: "order_for_model", cardinality: "1:1", fromType: "Order", toType: "Model" },
  { key: "line_belongs_to_base", cardinality: "1:N", fromType: "Base", toType: "Line" },
];
/** 因果边种子：一条已启用（进推演）——与旧桩的 `propagationCount: 1` 逐字节等价，零回归。 */
const MOCK_RULE_SEED: MockPropRule[] = [
  {
    id: "simpr_mock_seed", tenantId: "demo", key: "seed_line_to_base",
    sourceTypeKey: "Line", sourceStateVar: "s1", viaLinkKey: "line_belongs_to_base",
    targetTypeKey: "Base", targetStateVar: "s2",
    coefficient: 0.85, delayTicks: 1, combine: "sum",
    decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, status: "PUBLISHED",
  },

  // ⚠ 合并 WO-BEFE-A × WO-ACTIVE-EDGE-UX 时收编：这两条原本住在**另一份** fixture
  //   `MOCK_PROPAGATION_RULES` 里，且**同一个 URL 注册了 3 个 MSW handler**（先匹配先赢）
  //   ⇒ ACTIVE-EDGE 那份永远不触发，面板只看得到 1 条边。三张单各建一份 mock =
  //   本仓反复治的「第二套真值源」长在 mock 层。现收成这一个源，另两个 handler 已删。
  // hardcoded-data-allow —— mock 世界的传导边 fixture，非生产业务数据
  {
    id: "simpr_mock_a", tenantId: "demo", key: "mock_a_to_b",
    sourceTypeKey: "TypeA", sourceStateVar: "s1", viaLinkKey: "linkAB", targetTypeKey: "TypeB", targetStateVar: "s1",
    coefficient: 0.5, delayTicks: 0, combine: "sum", decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, status: "PUBLISHED",
  },
  {
    id: "simpr_mock_b", tenantId: "demo", key: "mock_a_to_b_slow",
    sourceTypeKey: "TypeA", sourceStateVar: "s2", viaLinkKey: "linkAB", targetTypeKey: "TypeB", targetStateVar: "s2",
    coefficient: 0.25, delayTicks: 1, combine: "sum", decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, status: "PUBLISHED",
  },
];
/** 传导边 fixture —— **派生视图**，真值源是 `MOCK_RULE_SEED`（合并时收编，见其尾部注释）。 */
const MOCK_PROPAGATION_RULES: PropagationRule[] = MOCK_RULE_SEED as unknown as PropagationRule[];
let mockLinkTypes: MockLinkType[] = MOCK_LINK_SEED.map((l) => ({ ...l }));
let mockPropRules: MockPropRule[] = MOCK_RULE_SEED.map((r) => ({ ...r }));
const mockPublishRequests = new Map<string, MockPublishRequest>();
let mockOntologyVersionSeq = 1;
let mockRelSeq = 0;

/**
 * 引用反查（后端 `ontology-governance.ts:332` 查 `element_refs` 索引）。
 * mock 侧的**真派生**：一条结构边的引用方 = 正在经由它传导的因果边
 * （后端把派生规格的 `deps[].via` 索引成 `elementKind:"link"` 的引用，`ontology-governance.ts:328`）。
 * 这样「先建因果边 → 该结构边就下线不掉了」这条真实约束在 mock 模式下也成立，
 * 而不是靠一张写死的引用表冒充。
 */
function mockElementRefs(key: string): { refKind: string; key: string; version: number | "latest"; where: string }[] {
  return mockPropRules
    .filter((r) => r.viaLinkKey === key)
    .map((r) => ({ refKind: "propagation-rule", key: r.key, version: "latest" as const, where: "viaLinkKey" }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** 后端 `app.ts:1877-1880` 的口径**镜像**：只数已启用的边，状态变量取自这些边的两端。 */
function derivePublishedRules(): MockPropRule[] {
  return mockPropRules.filter((r) => r.status === "PUBLISHED");
}
function deriveStateVars(): string[] {
  return [...new Set(derivePublishedRules().flatMap((r) => [r.sourceStateVar, r.targetStateVar]))].sort();
}

export function resetMockOntologyRelations(): void {
  mockLinkTypes = MOCK_LINK_SEED.map((l) => ({ ...l }));
  mockPropRules = MOCK_RULE_SEED.map((r) => ({ ...r }));
  mockPublishRequests.clear();
  mockOntologyVersionSeq = 1;
  mockRelSeq = 0;
}
let mockCpSeq = 0;
export function resetMockSim(): void {
  mockSimSessions.clear();
  mockSimWorlds.clear();
  mockSimPerturbations.clear();
  mockSimCheckpoints.clear();
  mockSimTickHistory.clear();
  mockSimSeq = 0;
  mockPertSeq = 0;
  mockCpSeq = 0;
  mockEnterpriseStates.clear();
  resetMockOntologyRelations();
  // ⚠ 这两行必须留在 `resetMockSim()` 里。它们曾在收编 WO-BEFE-D 的那次合并中被冲突解决
  //   错挪进下面的 `rememberTickState()`，造成两个方向都错的后果：
  //   ① 逐用例复位失效 —— 成长工单/组织在岗态跨用例串味（gtk_1 认领后停在 IN_PROGRESS ⇒
  //      「开放工单」下一例读成 0；张明被置为不在岗后不复位 ⇒ 下一例的 toggle 把他翻回在岗）；
  //   ② 沙盘每 tick 反而把这两份态**清一次** —— 一边跑沙盘一边看组织/成长页会看到数据自己跳回初态。
  //   两者都不是「测试洁癖」，是 mock 世界的真实一致性。
  resetGrowthTickets();
  resetOrgState();
}
/** 记一份逐 tick 态（tick 引擎每次落态都要经这里，回滚才有得取）。 */
function rememberTickState(sessionId: string, tick: number, state: Record<string, unknown>): void {
  const hist = mockSimTickHistory.get(sessionId) ?? new Map<number, Record<string, unknown>>();
  hist.set(tick, state);
  mockSimTickHistory.set(sessionId, hist);
}

/**
 * WO-BEFE-D · 成长工单 mock store（**可变**）。
 *
 * 此前 `GET /b/v1/growth/tickets` 返回一个每次现造的字面量、`claim` 返回一个写死的
 * `{status:"IN_PROGRESS"}` —— 于是「认领 → 提交复核 → 重跑验证」这条链在 mock 上
 * 走一步就回到 OPEN，任何接缝断言都只能咬到桩的返回值，咬不到状态真的推进了。
 * 改成模块态之后三条端点真的推得动它，`resetMockSim()` 每个用例复位（确定性）。
 *
 * 两张单刻意给不同 `fromQuestion`：`gtk_1`（"未知能力问句"）重跑仍答不出 ⇒ 停 IN_REVIEW；
 * `gtk_2`（含"达成率"）重跑可答 ⇒ VERIFIED。两条分支在 mock 上**都能走到**，
 * 不然「验证不通过」那一支就是永不进入的死分支（本仓「接了线没数据」的老形态）。
 *
 * ⚠ `gtk_2` 的初态刻意是 **IN_PROGRESS 而不是 OPEN**：驾驶舱的「开放工单」指标数的是
 * `status === "OPEN"` 的条数，既有断言（`f45.growth-cockpit.test.tsx:31` 与 :34）咬着 **1 张**。
 * 新增一张 OPEN 会把那个数字改成 2 —— 那不是"测试过时"，是我改了它度量的那件事。
 * 让 `gtk_2` 从"已认领"起步：既补齐了 submit/verify 两跳的可驱动性，又一个字都没动那条指标。
 */
type MockGrowthTicket = {
  id: string; tenantId: string; fromQuestion: string; gapCode: string;
  ioContract: { inputs: string[]; outputShape: string[] };
  ontologyRefs: { objectTypes: string[]; slices: string[]; rules: string[] };
  acceptance: string; status: string; createdAt: string; assignee?: string;
};
const GROWTH_TICKET_SEED: MockGrowthTicket[] = [
  { id: "gtk_1", tenantId: "demo", fromQuestion: "未知能力问句", gapCode: "NO_CAPABILITY", ioContract: { inputs: [], outputShape: [] }, ontologyRefs: { objectTypes: [], slices: [], rules: [] }, acceptance: "应能答", status: "OPEN", createdAt: "2026-06-17T07:00:00Z" },
  { id: "gtk_2", tenantId: "demo", fromQuestion: "订单达成率怎么算", gapCode: "EMPTY_DATA", ioContract: { inputs: [], outputShape: [] }, ontologyRefs: { objectTypes: [], slices: [], rules: [] }, acceptance: "应能答", status: "IN_PROGRESS", assignee: "cli-agent", createdAt: "2026-06-17T07:30:00Z" },
];
let growthTicketState: MockGrowthTicket[] = GROWTH_TICKET_SEED.map((t) => ({ ...t }));
function resetGrowthTickets(): void {
  growthTicketState = GROWTH_TICKET_SEED.map((t) => ({ ...t }));
}

/**
 * WO-BEFE-D · 场景引用闭包（**单源**）—— `/b/v1/scenarios/manage` 与 `/b/v1/scenarios/:key/closure`
 * 共用它。真后端两条路由本来就是同一个 `scenarioClosure()`；mock 各写一份 = 复检按钮
 * 会给出与列表不同的答案，那种矛盾只有用户会发现。
 */
function scenarioClosureMock(s: Scenario): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  const intent = db.intents.find((i) => i.key === s.intentKey);
  if (!intent) issues.push(`意图「${s.intentKey}」未配置（死路）`);
  else if (intent.status !== "PUBLISHED") issues.push(`意图「${s.intentKey}」未发布（${intent.status}）——上架门不放行`);
  if ((s.mode === "AGENT_FIRST" || s.mode === "AGENT_ONLY") && !s.defaultAgentId) issues.push("AGENT 模式缺 defaultAgent");
  return { ready: issues.length === 0, issues };
}

/**
 * WO-BEFE-D · 决策因果图 mock（两个源各一张）。
 *
 * ⚠ 两个构造器的返回值都过 `DecisionGraphSchema.parse()`。这不是洁癖：
 * 契约的 superRefine 锁着四条（空段必写 segmentGaps · segmentCounts 与 nodes 一致 ·
 * 零悬空边 · 段序不可倒流）。不 parse 的话，mock 可以轻松编出一张**结构上不可能**的图，
 * 而前端拿它当真图渲染、测试全绿 —— 那正是「mock 与引擎口径分家」的老事故。
 */
function countSegments(nodes: { segment: string }[]): Record<string, number> {
  const counts: Record<string, number> = { CAUSE: 0, IMPACT: 0, DECISION: 0, ACTION: 0, RESULT: 0 };
  for (const n of nodes) counts[n.segment] = (counts[n.segment] ?? 0) + 1;
  return counts;
}

/** 沙盘源：CAUSE(扰动) + IMPACT(传导轨迹) 有真值；DECISION/ACTION/RESULT 三段**没接线**（诚实报缺）。 */
function simCausalGraphMock(sessionId: string): DecisionGraph {
  const nodes = [
    {
      nodeId: `${sessionId}:pert:pert_1`, segment: "CAUSE" as const, label: "设备故障（产能下调）",
      anchor: { objectId: "Base#0", stateVar: "capacity" }, value: -120_000, unit: "件", tick: 0,
      provenance: { kind: "perturbation" as const, refId: "pert_1", producedBy: null, detail: "人建扰动 pert_1：Base#0.capacity 下调 120000（startTick 0）" },
    },
    {
      nodeId: `${sessionId}@t1:Base#0.load`, segment: "IMPACT" as const, label: "Base#0.load 传导",
      anchor: { objectId: "Base#0", stateVar: "load" }, value: 12.5, unit: null, tick: 1,
      provenance: { kind: "propagation_trace" as const, refId: `${sessionId}@t1:Base#0.load`, producedBy: "r_capacity_load", detail: "规则 r_capacity_load: Base#0.capacity --FEEDS--> Base#0.load ×0.5 ⇒ +12.5" },
    },
    {
      nodeId: `${sessionId}@t2:Order#3.risk`, segment: "IMPACT" as const, label: "Order#3.risk 传导",
      anchor: { objectId: "Order#3", stateVar: "risk" }, value: 18, unit: "%", tick: 2,
      provenance: { kind: "propagation_trace" as const, refId: `${sessionId}@t2:Order#3.risk`, producedBy: "r_load_risk", detail: "规则 r_load_risk: Base#0.load --FEEDS--> Order#3.risk ×1.44 ⇒ +18" },
    },
  ];
  return DecisionGraphSchema.parse({
    graphId: `cg_sim_${sessionId}`,
    tenantId: TENANT_ID,
    source: { kind: "sim_session", refId: sessionId },
    nodes,
    edges: [
      { edgeId: "e1", fromNodeId: nodes[0]!.nodeId, toNodeId: nodes[1]!.nodeId, kind: "CAUSE_TO_IMPACT", amount: 12.5, provenance: { kind: "propagation_trace", refId: `${sessionId}@t1`, producedBy: "r_capacity_load", detail: "扰动落地 → 首个受影响量" } },
      { edgeId: "e2", fromNodeId: nodes[1]!.nodeId, toNodeId: nodes[2]!.nodeId, kind: "IMPACT_TO_IMPACT", amount: 18, provenance: { kind: "propagation_trace", refId: `${sessionId}@t2`, producedBy: "r_load_risk", detail: "传导第二跳" } },
    ],
    segmentCounts: countSegments(nodes),
    // 三种缺席原因**分开**：沙盘 session 上根本没有承载"决策/动作/结果"的东西 ⇒ NO_SOURCE_WIRED。
    segmentGaps: [
      { segment: "DECISION", reason: "NO_SOURCE_WIRED", missing: "沙盘 session 上没有任何承载「决策」的对象（Decision 台账与 session 无字段互指）", needs: "把一次推演结论落成 Decision（POST /a/v1/decisions），再看台账源因果图" },
      { segment: "ACTION", reason: "NO_SOURCE_WIRED", missing: "ActionDraft 上没有 sessionId，接不回本次推演", needs: "决策 commit 后经 S2 审批链派 ActionDraft" },
      { segment: "RESULT", reason: "NO_SOURCE_WIRED", missing: "沙盘不记录实测成效（DecisionOutcome 只挂在台账上）", needs: "决策 REALIZED 后由运营回填 realizedGapClose" },
    ],
    caveats: [
      "DelayedContribution 只记 {arriveTick,target*,amount,ruleKey}，不记 fromObjectId ⇒ 延迟到达的贡献出节点不出边",
    ],
  });
}

/** 台账源：五段全覆盖；RESULT 段在 outcome 未回填时报 `NOT_YET_REALIZED`（不是"没问题"）。 */
function decisionCausalGraphMock(decisionId: string): DecisionGraph {
  const nodes = [
    {
      nodeId: `${decisionId}:root`, segment: "CAUSE" as const, label: "缺口归因根因：供应能力不足",
      anchor: { objectId: "Supplier#1", stateVar: null }, value: 0.62, unit: "share", tick: null,
      provenance: { kind: "gap_attribution" as const, refId: `${decisionId}:root`, producedBy: "gap_attribution", detail: "gap_attribution: market_share 缺口 62% 分摊到 Supplier#1" },
    },
    {
      nodeId: `${decisionId}:impact`, segment: "IMPACT" as const, label: "订单风险 +18%",
      anchor: { objectId: "Order#3", stateVar: "risk" }, value: 18, unit: "%", tick: null,
      provenance: { kind: "gap_attribution" as const, refId: `${decisionId}:impact`, producedBy: "gap_attribution", detail: "归因第二层：供应不足 → 订单风险" },
    },
    {
      nodeId: `${decisionId}`, segment: "DECISION" as const, label: "决策：跨厂生产",
      anchor: { objectId: null, stateVar: null }, value: null, unit: null, tick: null,
      provenance: { kind: "decision" as const, refId: decisionId, producedBy: "decision_play", detail: `Decision ${decisionId}：chosen = opt_cross_plant` },
    },
    // ⚠ 方案节点属 **ACTION** 段（不是 DECISION）—— 与真构图器 `causal-graph.ts:645` 逐字一致。
    //   段放错会被契约 superRefine ④ 当场咬住（`DECISION_TO_ACTION` 的两端段必须是 DECISION→ACTION）。
    {
      nodeId: `${decisionId}:opt`, segment: "ACTION" as const, label: "方案：跨厂生产（预言补缺口 0.41）",
      anchor: { objectId: "Supplier#1", stateVar: null }, value: 0.41, unit: "share", tick: null,
      provenance: { kind: "decision_option" as const, refId: "opt_cross_plant", producedBy: "decision_play", detail: "方案（求解器 decision_play 真产物）：**预言**补缺口 0.41 share，代价 80 万元。此值是预言不是实测" },
    },
    {
      nodeId: `${decisionId}:draft`, segment: "ACTION" as const, label: "跨厂排产变更（PENDING_APPROVAL）",
      anchor: { objectId: "adraft_cross_plant_1", stateVar: null }, value: null, unit: null, tick: null,
      provenance: { kind: "action_draft" as const, refId: "adraft_cross_plant_1", producedBy: null, detail: "commit 时经 ActionService 派出的 ActionDraft，状态 PENDING_APPROVAL（执行仍走 S2 审批链）" },
    },
  ];
  return DecisionGraphSchema.parse({
    graphId: `cg_dec_${decisionId}`,
    tenantId: TENANT_ID,
    source: { kind: "decision", refId: decisionId },
    nodes,
    edges: [
      { edgeId: "d1", fromNodeId: nodes[0]!.nodeId, toNodeId: nodes[1]!.nodeId, kind: "CAUSE_TO_IMPACT", amount: 18, provenance: { kind: "gap_attribution", refId: `${decisionId}:impact`, producedBy: "gap_attribution", detail: "根因 → 影响" } },
      { edgeId: "d2", fromNodeId: nodes[1]!.nodeId, toNodeId: nodes[2]!.nodeId, kind: "IMPACT_TO_DECISION", amount: 18, provenance: { kind: "decision", refId: decisionId, producedBy: "gap_attribution", detail: "★ 触发判据：指标缺口 18% ⇒ 建 Decision（这个数就是「为什么被触发」的量化答案）" } },
      { edgeId: "d3", fromNodeId: nodes[2]!.nodeId, toNodeId: nodes[3]!.nodeId, kind: "DECISION_TO_ACTION", amount: 0.41, provenance: { kind: "decision_option", refId: "opt_cross_plant", producedBy: "decision_play", detail: "Decision 选定方案 opt_cross_plant（⊆ optionsRef.options，建单时已校验拒幽灵）" } },
      { edgeId: "d4", fromNodeId: nodes[2]!.nodeId, toNodeId: nodes[4]!.nodeId, kind: "DECISION_TO_ACTION", amount: null, provenance: { kind: "action_draft", refId: "adraft_cross_plant_1", producedBy: null, detail: "Decision commit 时经 ActionService 派出（执行仍走 S2 审批链）" } },
    ],
    segmentCounts: countSegments(nodes),
    // ⚠ `NOT_YET_REALIZED` ≠ `SOURCE_EMPTY`：承载物存在且会有，只是时点未到 —— 修法完全不同。
    segmentGaps: [
      // 「实测」在这里是**领域词**（外部注入的真实成效），不是"我测过"的声明；
      // 为不与 stale-claims 门的自称实测判据撞车，改写成不含该触发词的等义表述。
      { segment: "RESULT", reason: "NOT_YET_REALIZED", missing: "Decision.outcome 在 REALIZED 之前恒 null", needs: "运营经 POST /a/v1/decisions/:id/outcome 回填外部观测到的 realizedGapClose" },
    ],
    caveats: [],
  });
}

/**
 * WO-ENTERPRISE-STATE · 企业状态快照 mock store（模块态）。
 *
 * ⚠ **形状不是这里手写的**：下面的 handler 调用的是 `@platform/contracts` 的
 * `captureEnterpriseState` —— 与 datacore `twin/enterprise-state.ts` **同一个函数**。
 * 本仓有过「mock 与引擎口径分家、测试咬 mock 恒绿」的真事故，那次的根因是两边各写一套形状。
 * 现在两边共用同一份纯函数：形状分家在结构上就不可能发生，而不是靠「两边都记得写成一样」。
 * mock 这边**只负责喂输入**（mock 世界的对象数据 + mock 模拟时钟），算法一行都不重写。
 */
const mockEnterpriseStates = new Map<string, EnterpriseState>();

/**
 * mock 世界的逻辑时钟：从 `db.clock`（模拟时钟 mock，`simDate` + `currentTick`）派生。
 * `t0` = simDate 往回推 currentTick 天 —— **推算**出来的，不是 `new Date()`
 * （前端一旦补 wall-clock，界面上的"时刻"就与快照锚定的时间轴分家了）。
 */
function mockLogicalClock(): LogicalClock {
  const tick = db.clock.currentTick;
  const t0 = new Date(new Date(`${db.clock.simDate}T00:00:00Z`).getTime() - tick * 86400_000).toISOString().slice(0, 10);
  return { tick, simulatedDate: db.clock.simDate, t0 };
}

/**
 * mock 世界的「对象库」切片：与 `GET /a/v1/objects` 的 mock 同源（BASES / ORDERS / MODELS），
 * 域名与真后端本体一致（factory / product）。数值属性清单显式声明 —— 真后端那边它来自本体
 * `properties(dataType==="number") ∪ derivedProperties`，mock 无本体故手写，
 * 但**聚合与排序一律走同一个纯函数**，所以 mock 与真后端的 doc 形状逐字段相同。
 */
function mockEnterpriseTypes(): EnterpriseStateTypeInput[] {
  return [
    {
      typeKey: "Base",
      displayName: "生产基地",
      domain: "factory",
      numericProps: [
        { propKey: "gwh", unit: "GWh" },
        { propKey: "lines", unit: "条" },
        { propKey: "util", unit: "" },
      ],
      rows: BASES.map((b) => ({ ...b })),
    },
    {
      typeKey: "Order",
      displayName: "销售订单",
      domain: "product",
      numericProps: [
        { propKey: "qty", unit: "套" },
        { propKey: "unitPrice", unit: "元/套" },
      ],
      rows: ORDERS.map((o) => ({ ...o })),
    },
  ];
}

/** mock 世界的 SPINE 指标库切片（KPI 组）。真后端取 `Metric` 对象，mock 取本地固定几条。 */
function mockEnterpriseKpis(): EnterpriseStateKpiInput[] {
  return [
    { metricKey: "ontime_rate", label: "订单准时率", unit: "%", category: "scale", actual: 92.4, target: 95 },
    { metricKey: "gross_margin", label: "毛利率", unit: "%", category: "profit", actual: 18.7, target: 20 },
    // 诚实空的样本：指标库有这一行，但 actual 从未回采 ⇒ value:null + reason（不许兜底成 0）。
    { metricKey: "cash_cycle", label: "现金周转天数", unit: "天", category: "cash", actual: null, target: 45 },
  ];
}

function mockCaptureEnterpriseState(worldId: string): EnterpriseState {
  const state = captureEnterpriseState({
    tenantId: TENANT_ID,
    worldId,
    isSimulated: worldId !== ENTERPRISE_STATE_REAL_WORLD_ID,
    forkedFromStateId: null,
    clock: mockLogicalClock(),
    kpis: mockEnterpriseKpis(),
    types: mockEnterpriseTypes(),
  });
  mockEnterpriseStates.set(state.id, state);
  return state;
}
/**
 * WO-CAPLIVE-2 · 方案横比矩阵产能增益（KILL-MOCK）：各方案 apply 经 generic_inference 同款前向重算公式真算——
 * 下游派生 after = 0.8*0.5 + value*0.5，capGain = Σ max(0, after − 0.8)。改方案 apply → capGain 变（非写死）。
 */
function scenarioCapGain(apply: { value: number }[]): number {
  const g = apply.reduce((acc, a) => {
    const v = Number(a.value);
    const vnum = Number.isFinite(v) ? v : 1;
    const after = 0.8 * 0.5 + vnum * 0.5;
    return acc + Math.max(0, after - 0.8);
  }, 0);
  return Math.round(g * 1e6) / 1e6;
}

// WO-SLICE-GOVERNANCE-FULL：切片治理 mock 状态（stateful → promote 后徽标翻转、编辑器预填一致）。
const mockSliceGov: Record<string, { rootType: string; fixtures: number }> = {
  model_capacity_network: { rootType: "Model", fixtures: 1 },
  base_risk_profile: { rootType: "Base", fixtures: 0 },
};
function mockSliceFixture(rootType: string) {
  return {
    name: "auto_baseline_v1",
    args: {} as Record<string, string | number>,
    expect: { rootType, minNodes: 3, mustIncludeTypes: [rootType, "Base"], mustIncludeLinkKeys: ["model_producible_at"] },
  };
}
function mockSliceGraph(sliceKey: string) {
  const rootType = mockSliceGov[sliceKey]?.rootType ?? "Model";
  return {
    nodes: [
      { id: `${sliceKey}:r1`, typeKey: rootType, objectKey: "R1", props: {} },
      { id: `${sliceKey}:c1`, typeKey: "Base", objectKey: "常州", props: {} },
      { id: `${sliceKey}:c2`, typeKey: "Base", objectKey: "宜宾", props: {} },
    ],
    edges: [
      { linkKey: "model_producible_at", from: `${sliceKey}:r1`, to: `${sliceKey}:c1` },
      { linkKey: "model_producible_at", from: `${sliceKey}:r1`, to: `${sliceKey}:c2` },
    ],
    truncated: false,
    snapshotVersion: "ov-12",
  };
}
/** 测试用：复位切片治理 mock 状态（模块级状态跨用例复用，beforeEach 调用避免顺序耦合）。 */
export function __resetSliceGovMock(): void {
  mockSliceGov.model_capacity_network = { rootType: "Model", fixtures: 1 };
  mockSliceGov.base_risk_profile = { rootType: "Base", fixtures: 0 };
}

/**
 * WO-SLICE-16-LAYERS：十六层结构 mock。
 *
 * 形状与真后端 `GET /a/v1/ontology/slices/{key}/layers` 一字不差（契约 SliceLayersResponse），
 * 且**三态齐全**（present / not_in_slice / absent）——mock 只给全绿的话，
 * 诚实态那半边界面在 mock 模式下永远走不到，等于没测。
 * 真实取证数字见 docs/AUDIT-slice-16-layers.md：真后端 order_fulfillment_360 = 12/1/3。
 */
const MOCK_LAYER_SPEC: { id: string; unit: string; carrier: string; n: number; platform?: number; reason?: string }[] = [
  { id: "business_scenario", unit: "个", carrier: "reported_refs → governance.sliceReferences", n: 0, reason: "承载物在，但 AgentCore 只上报 rule 引用、从不产出 kind:\"slice\" ⇒ 反查恒空。缺的是上报方，不是切片。" },
  { id: "decision_intent", unit: "个", carrier: "reported_refs.refKind ∈ {plan,intent,agent}", n: 0, reason: "workflow→slice 的关系算在 AgentCore 侧，不回写 DataCore ⇒ A 侧反查取不到。" },
  { id: "object", unit: "类", carrier: "objects（executeSlice 真子图 nodes）", n: 2 },
  { id: "property", unit: "个", carrier: "object_types.properties + 子图 node.props", n: 6 },
  { id: "relation", unit: "种", carrier: "links + ontology_links", n: 1 },
  { id: "event", unit: "条", carrier: "objects[type=ExceptionEvent] + exc_sourced_from", n: 0, platform: 372 },
  { id: "state", unit: "个", carrier: "sim_propagation_rules.{source,target}StateVar + enum 属性", n: 3 },
  { id: "metric", unit: "个", carrier: "object_types.derivedProperties.formula + PropertyDef.unit", n: 2 },
  { id: "time", unit: "个", carrier: "ts_series.entityType + PropertyDef.temporal/date", n: 2 },
  { id: "rule", unit: "条", carrier: "rules.scopeObjectTypes ∩ 切片类型", n: 3, platform: 28 },
  { id: "constraint", unit: "条", carrier: "contractFixtures + rules[BLOCK] + rules.params", n: 2 },
  { id: "data_binding", unit: "条", carrier: "object_types.sourceBindings", n: 2 },
  { id: "scenario", unit: "条", carrier: "objects[AnnualScenario] + sim_propagation_rules", n: 1, platform: 13 },
  { id: "evidence", unit: "条", carrier: "derivation_specs + contractFixtures", n: 1 },
  { id: "action", unit: "个", carrier: "object_types.actions[] + action_types", n: 0, platform: 10, reason: "全局注册了 10 个 ActionType，但 ActionType 无 targetTypeKey 字段、且 object_types.actions[] 全空 ⇒ 无法归因到本切片类型。缺的是 join 键（结构缺口），不是数据。" },
  { id: "governance", unit: "项", carrier: "objects.origin/epoch + object_types.domain/published", n: 2 },
];
function mockSliceLayers(sliceKey: string) {
  const rootType = mockSliceGov[sliceKey]?.rootType ?? "Model";
  const layers = MOCK_LAYER_SPEC.map((s, i) => {
    const status = s.n > 0 ? "present" : (s.platform ?? 0) > 0 && !s.reason ? "not_in_slice" : "absent";
    return {
      id: s.id,
      ordinal: i + 1,
      status,
      count: s.n,
      unit: s.unit,
      carrier: s.carrier,
      ...(s.platform !== undefined ? { platformCount: s.platform } : {}),
      ...(status !== "present"
        ? { absentReason: s.reason ?? `平台有 ${s.platform ?? 0} ${s.unit}，但本切片的路径没纳入 —— 改切片 paths 把相关类型接进来即可取到。` }
        : {}),
      items: Array.from({ length: s.n }, (_, k) => ({
        key: `${s.id}-${k + 1}`,
        label: `${s.id}-${k + 1}`,
        group: rootType,
        detail: `mock 明细 ${k + 1}`,
      })),
    };
  });
  return {
    sliceKey,
    version: 1,
    rootType,
    graph: { nodes: 3, edges: 2, truncated: false, typeKeys: [rootType, "Base"], linkKeys: ["model_producible_at"] },
    snapshotVersion: "ov-12",
    layers,
    summary: {
      total: 16,
      present: layers.filter((l) => l.status === "present").length,
      notInSlice: layers.filter((l) => l.status === "not_in_slice").length,
      absent: layers.filter((l) => l.status === "absent").length,
    },
  };
}

/**
 * mock 端唯一的异步定时器（模拟时钟推进）。**必须可取消**：用例结束后仍活着的句柄，其回调会在
 * 测试环境拆除后才 fire —— 正是「全绿却 RC≠0」那条 teardown 期未捕获错误的火种。
 */
let clockTickTimer: ReturnType<typeof setTimeout> | null = null;

/** 测试 teardown 调用：撤销 mock 端待触发的定时器（与 resetMockDb 配套） */
export function clearMockTimers(): void {
  if (clockTickTimer !== null) {
    clearTimeout(clockTickTimer);
    clockTickTimer = null;
  }
}

/**
 * WO-FE-WIRE-2 件一：原 intake 写死响应拆成**两段具名产物**，让 pipeline 的节点开关能逐段生效
 * （intake_parse 产 INTAKE_PARSE_RESULT · intake_reconcile 产 INTAKE_RECONCILE_RESULT）。
 * 值与拆分前逐字一致 —— 出厂默认（四节点全开）下 intake 响应的 intake/reconcile 两段与改造前相同。
 */
/**
 * WO-BEFE-E · 对账候选 HITL 队列的 mock store（= `GET/POST …/reconcile-candidates` 的数据源）。
 * 形状 = 契约 `SchemaReconcileCandidate`（落库后带 `id`/`tenantId`）。
 * 由 intake 的 `intake_persist_candidates` 节点写入 —— 与真后端同一个触发点，不另开后门。
 */
const mockReconcileCandidates = new Map<string, SchemaReconcileCandidate & { id: string; tenantId: string }>();
export function resetMockReconcileCandidates(): void {
  mockReconcileCandidates.clear();
}

const INTAKE_PARSE_RESULT = {
  dataSources: [
    { name: "BASE_DATA", columns: ["baseId", "name", "util", "gwh"], sampleRows: [{ baseId: "changzhou", name: "常州", util: 88, gwh: 35 }, { baseId: "xiamen", name: "厦门", util: 85, gwh: 28 }] },
    { name: "ORDER_DATA", columns: ["so", "cust", "model", "qty", "baseRef"], sampleRows: [{ so: "SO-001", cust: "星辰汽车", model: "4680-NCM", qty: 1200, baseRef: "changzhou" }] },
  ],
  // ⚠ WO-BEFE-E：`{src,tgt}` → `{from,to,origin}` —— 契约 `ProtoLinkSchema` 与后端
  // `prototype-intake.ts:104/111` 逐字如此。桩此前照前端手写的错类型写，两边一起错了一整程。
  links: [{ from: "ORDER_DATA", to: "BASE_DATA", rel: "produced_at", origin: "ref" as const }],
  unparsed: [{ name: "CHART_CONFIG", reason: "非数据表（图表配置对象，已诚实跳过不静默丢）" }],
};
/**
 * ⚠ **WO-BEFE-E 订正**：`candidates[].column` → `prototypeColumn`，并补齐 `suggestedAction`/`status`。
 *
 * 原字段名与后端**不一致**：真后端 `reconcileIntake`（`apps/datacore/src/databuilder/prototype-intake.ts:144`）
 * 与契约 `SchemaReconcileCandidateSchema` 都叫 `prototypeColumn`。这份桩当年照着**前端手写的错类型**
 * （`endpoints.ts` 里那份 `IntakePreview`）写，于是页面与桩互相印证、一起错：mock 态好好的，
 * 真后端下 `PrototypeIntakePage` 那行渲染出的是 `ORDER_DATA.undefined`。
 * 这正是本仓治过的「mock 与引擎口径分家 ⇒ 测试咬 mock 恒绿」。现在两边同用契约字段名。
 * `autoMapped` 那一段后端确实叫 `column`（`prototype-intake.ts:140`），**不许顺手统一** —— 两段本就不同名。
 */
const INTAKE_RECONCILE_RESULT = {
  autoMapped: [
    { datasetName: "BASE_DATA", column: "name", targetType: "Base", targetField: "name" },
    { datasetName: "BASE_DATA", column: "util", targetType: "Base", targetField: "util" },
  ],
  candidates: [
    {
      datasetName: "ORDER_DATA", prototypeColumn: "cust",
      candidates: [{ targetType: "Order", targetField: "cust", score: 0.82 }, { targetType: "Customer", targetField: "name", score: 0.61 }],
      suggestedAction: "USE" as const, status: "PENDING" as const,
    },
  ],
};

// ---------------------------------------------------------------------------
// WO-A · PlanBuilder mock endpoints（Phase 1：线性多 solver 链）
// ---------------------------------------------------------------------------

function compilePlanBuilderDSL(dsl: PlanBuilderCanvas["dsl"]): PlanBuilderCompileResult {
  const errors: { code: string; message: string; nodeId?: string }[] = [];
  for (const n of dsl.nodes) {
    if (n.type === "CONDITION" || n.type === "LOOP" || n.type === "MERGE") {
      errors.push({ code: "UNSUPPORTED_NODE", message: `${n.type} 节点在 Phase 1 仅占位，暂不支持编译`, nodeId: n.id });
    }
  }
  // 简单环检测（DFS）
  const adj = new Map<string, string[]>();
  for (const n of dsl.nodes) adj.set(n.id, []);
  for (const e of dsl.edges) adj.get(e.from)?.push(e.to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) {
      errors.push({ code: "CYCLIC_GRAPH", message: `检测到环，节点 ${id}` });
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const to of adj.get(id) ?? []) if (dfs(to)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const n of dsl.nodes) dfs(n.id);

  if (dsl.nodes.filter((n) => n.type === "OUTPUT").length === 0) {
    errors.push({ code: "MISSING_OUTPUT", message: "至少需要一个 OUTPUT 节点" });
  }
  if (errors.length > 0) return { ok: false, errors };
  // 占位 ExecutionPlan 形状（R24：DSL ↔ ExecutionPlan 等价可证）
  const plan: Record<string, unknown> = {
    version: 1,
    steps: dsl.nodes
      .filter((n) => n.type !== "INPUT")
      .map((n) => {
        if (n.type === "SOLVER") return { id: n.id, type: "invoke_solver", params: { solverKey: n.solverKey, args: n.args } };
        if (n.type === "TRANSFORM") return { id: n.id, type: n.stepType, params: n.params };
        if (n.type === "OUTPUT") return { id: n.id, type: "render_answer", params: { blocks: n.blocks } };
        return { id: n.id, type: n.type, params: {} };
      }),
  };
  return { ok: true, plan, errors: [] };
}

function planBuilderById(id: string): PlanBuilderCanvas | undefined {
  return db.planBuilders.find((c) => c.id === id);
}

/**
 * WO-BEFE-E · `facility_location` 真暴力最优（min 总成本 = Σ开设 + Σ就近指派；
 * 容量判据：开设总容量 ≥ 总需求即可行 —— 就近指派近似）。
 *
 * 从 `solvers/:key/invoke` 的 `optimize_whatif` 分支**提到模块顶层**：
 * `POST /a/v1/opt/solve` 的桩要用同一份。抄第二份就是第二套真相源 ——
 * 两边一旦漂移，「基线求解」与「推演的基线那一半」会给出不同的数，而屏上看不出来。
 * ⚠ 这是 mock 态的**形状回放**，非可证最优；真 CP-SAT 仍须打 sidecar（services/optimizer·DEPLOY.md）。
 */
function mockSolveFacilityLocation(a: Record<string, unknown>) {
  const facilities = (a.facilities as { id: string; openCost: number; capacity?: number }[]) ?? [];
  const clients = (a.clients as { id: string; demand?: number }[]) ?? [];
  const assign = (a.assignCosts as { client: string; facility: string; cost: number }[]) ?? [];
  const n = facilities.length;
  if (!n || !clients.length) return null;
  const costOf = (c: string, f: string) => assign.find((x) => x.client === c && x.facility === f)?.cost;
  const totalDemand = clients.reduce((s, c) => s + (c.demand ?? 0), 0);
  let best: { openFacilities: string[]; assignments: { client: string; facility: string }[]; objective: number } | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const open = facilities.filter((_, i) => (mask & (1 << i)) !== 0);
    const cap = open.reduce((s, f) => s + (f.capacity ?? Number.POSITIVE_INFINITY), 0);
    if (cap < totalDemand) continue; // 容量不足 → 该组合不可行
    let obj = open.reduce((s, f) => s + f.openCost, 0);
    const assignments: { client: string; facility: string }[] = [];
    let ok = true;
    for (const c of clients) {
      let bf: string | null = null;
      let bc = Number.POSITIVE_INFINITY;
      for (const f of open) {
        const cc = costOf(c.id, f.id);
        if (typeof cc === "number" && cc < bc) { bc = cc; bf = f.id; }
      }
      if (bf == null) { ok = false; break; }
      obj += bc;
      assignments.push({ client: c.id, facility: bf });
    }
    if (!ok) continue;
    if (!best || obj < best.objective) best = { openFacilities: open.map((f) => f.id), assignments, objective: obj };
  }
  return best;
}

/**
 * WO-BEFE-E · 优化模板池 `/a/v1/opt/*` 的 mock 数据源。
 *
 * ⚠ **五个 key 与 `apps/datacore/src/app.ts:3660` 的 `OPT_FAMILIES` 逐字一致**。
 * 桩自己再编一份就把本单要治的病（同一概念两套词表）原样搬进 mock 层。
 */
const MOCK_OPT_FAMILIES = ["facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction"] as const;

export const handlers = [
  // ── WO-BEFE-E · 优化模板池三条（datacore app.ts:3682 / :3689 / :3664）────────────
  // ⚠ 语义照抄后端，**不放宽**：`opt.embedding-retrieval` 是 defaultOn:false 的暗发门，
  // 故 retrieve 回的是 `mode:"comprehend"` 关键词回退档（后端 app.ts:3700 的那一支）。
  // 桩若一律回 `embedding`，"这次是哪一档算的"这个诚实位在测试里就永远验不到。
  http.get("*/a/v1/opt/templates", () => HttpResponse.json({ families: [...MOCK_OPT_FAMILIES] })),
  http.get("*/a/v1/opt/retrieve", ({ request }) => {
    const need = (new URL(request.url).searchParams.get("need") ?? "").trim();
    if (!need) return err(400, "VALIDATION_ERROR", "opt retrieve 需 ?need=<需求文本>");
    const q = need.toLowerCase();
    const matched = MOCK_OPT_FAMILIES.filter((f) => q.includes(f) || q.includes(f.replace(/_/g, " ")));
    return HttpResponse.json({
      mode: "comprehend",
      embeddingEnabled: false,
      candidates: (matched.length ? matched : MOCK_OPT_FAMILIES).map((key) => ({ key })),
      note: "opt.embedding-retrieval 未开 → 退回 comprehend 关键词列表（不静默）",
    });
  }),
  http.post("*/a/v1/opt/solve", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { family?: string; args?: Record<string, unknown> };
    if (!MOCK_OPT_FAMILIES.includes(body.family as (typeof MOCK_OPT_FAMILIES)[number])) {
      return err(400, "VALIDATION_ERROR", `family 必须是 ${MOCK_OPT_FAMILIES.join("|")} 之一`);
    }
    if (body.family === "facility_location") {
      const sol = mockSolveFacilityLocation(body.args ?? {});
      if (!sol) return err(400, "VALIDATION_ERROR", "facility_location 需 facilities + clients + assignCosts");
      return HttpResponse.json({ ...sol, optimal: true, status: "OPTIMAL" });
    }
    // 其余 family：mock 态无真解引擎 —— **诚实说没接入**，不编一个目标值出来
    // （本仓纪律：画出来的假线路图比空白更危险）。真解须打 sidecar（services/optimizer）。
    return err(501, "OPTIMIZER_NOT_CONFIGURED", `${body.family} 未接入最优化引擎（mock 态只回放 facility_location；真解需 OPTIMIZER_BASE_URL sidecar）`);
  }),
  // ======================== A · DataCore ========================

  http.post("*/a/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { tenantId: string; username: string; password: string };
    const account = ACCOUNTS.find((a) => a.username === body.username && a.password === body.password);
    // mock 容忍 demo（真实种子租户）与 tenant-battery（mock 租户）两者，避免登录默认租户切换后 mock 登录失败
    if (!account || (body.tenantId !== TENANT_ID && body.tenantId !== "demo")) return err(401, "INVALID_CREDENTIALS", "账号或密码错误");
    return HttpResponse.json({ accessToken: tokenFor(account) });
  }),

  http.post("*/a/v1/auth/refresh", () => err(401, "REFRESH_FAILED", "请重新登录")),

  // WO-BEFE-G · 登出（服务端吊销 refresh 会话）。真后端 `datacore app.ts:1090`：
  // `reply.clearCookie("refresh_token", { path: "/a/v1/auth" })` → `{ ok: true }`，属 PUBLIC_PATHS（认 cookie 不认 Bearer）。
  // 必须有这条 handler：`test/setup.ts:61` 起的是 `onUnhandledRequest: "error"`，
  // 少了它，任何点到「退出登录」的用例都会因未桩请求而红（与本改动无关的假红）。
  http.post("*/a/v1/auth/logout", () => HttpResponse.json({ ok: true })),

  http.get("*/a/v1/me/workspace", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(workspaceForAccount(account, db.tenantOverrides, db.configVersion));
  }),

  // ---- 运营态出厂配置增量 §5：一年运营态历史（行级过滤 + actionHistory 分页） ----
  http.get("*/a/v1/history/bundle", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20)));
    return HttpResponse.json(historyBundleFor(account.baseScope, page, pageSize));
  }),

  http.get("*/a/v1/history/watermark", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(LIVED_WATERMARK);
  }),
  // WO-PROCESS-INSTANCE · 流程卡点（mock 模式）。
  // 四条纪律，与真后端逐字对齐：
  //  ① `byWaitState` 的五个 key 从契约 `PROCESS_TASK_WAIT_STATES` **派生**，不手抄字面量
  //     —— 手抄的那份会在后端加第六个态时静默落后，而 mock 模式看不出来；
  //  ② 计数由 `stuck` **算出来**，不是另写一份常量：两个数不同源就会出现
  //     「列表 2 条、计数说 3 条」这种只有用户能发现的矛盾；
  //  ③ 第二条刻意**不带** `ownerDisplayName`/`waitedMs`（自定义职能 + 未知等待起点），
  //     用来在 mock 模式下也能看见「缺就不显示那一块」的真实行为，而不是永远只演示满字段的理想态；
  //  ④ **`derivedStuckCount` 必须给**（WO-R9-STUCKVIEW 收编时补）——
  //     合并单把它加成**必填**，mock 少给一个字段就会让「本投影答不出的那一批」这条诚实位
  //     在 mock 模式下永远为 undefined，页面那一块永不渲染 = 演示态在说谎。
  //     这里给 1 而不是 0：0 会让该分支在 mock 模式下从不进入（「接了线没数据」的又一形态）。
  http.get("*/a/v1/process-instances/stuck", () => {
    const stuck = [
      {
        instanceId: "pinst_demo_P17_ord_9001",
        // ⚠ 合并单 WO-R9-PROCESS-MERGE 把 `definitionKey` 改名为 `processKey`
        //   （判据：仓内既有约定 `impact-analysis.ts:132`）。mock 留旧名 = 契约与演示两套真相。
        processKey: "P17",
        definitionName: "销售订单评审接单",
        subjectRef: { typeKey: "Order", objectId: "ord_9001" },
        taskId: "ptask_pinst_demo_P17_ord_9001_1",
        taskName: "信用超额审批",
        taskSeq: 1,
        waitState: "WAITING_APPROVAL" as const,
        waitRef: "adraft_credit_9001",
        ownerFunctionKey: "finance",
        ownerDisplayName: "财务",
        waitingSince: "2026-03-01T00:00:00.000Z",
        waitedMs: 3 * 86_400_000,
      },
      {
        instanceId: "pinst_demo_P44_wip_3312",
        processKey: "P44",
        definitionName: "工序流转报工",
        subjectRef: { typeKey: "WIPMove", objectId: "wip_3312" },
        taskId: "ptask_pinst_demo_P44_wip_3312_2",
        taskName: "上料齐套确认",
        taskSeq: 2,
        waitState: "WAITING_DATA" as const,
        waitRef: "stock_on_hand",
        ownerFunctionKey: "tenant_custom_dept", // 登记册外 ⇒ 无中文名 ⇒ 前端退回显示 key
      },
    ];
    const byWaitState = Object.fromEntries(
      PROCESS_TASK_WAIT_STATES.map((s) => [s, stuck.filter((r) => r.waitState === s).length]),
    );
    return HttpResponse.json({
      evaluatedAt: "2026-03-04T00:00:00.000Z",
      stuck,
      byWaitState,
      derivedStuckCount: 1,
    });
  }),
  // DF.12 边界册治理：影响图 + 版本（直接派生 contracts 单一来源，与真后端同源）。
  http.get("*/a/v1/boundary/impact", () => HttpResponse.json({ impact: BOUNDARY_IMPACT, registries: BOUNDARY_IMPACT.map((b) => b.registry) })),
  http.get("*/a/v1/boundary/version", () => HttpResponse.json(boundaryVersion())),
  // ── WO-FE-WIRE-2 件一 · pipeline 配置面（后端已开五条·此前前端零调用方）──
  http.get("*/a/v1/databuilder/pipelines", () =>
    HttpResponse.json({ items: BUILD_PIPELINE_KINDS.map((k) => resolvePipeline(k)) }),
  ),
  http.get("*/a/v1/databuilder/pipelines/:kind", ({ params }) =>
    HttpResponse.json(resolvePipeline(params.kind as BuildPipelineKind)),
  ),
  // 覆盖（幂等）：落一条即 factory:false —— 下次 intake 执行**立刻按新定义跑**。
  http.put("*/a/v1/databuilder/pipelines/:kind", async ({ params, request }) => {
    const kind = params.kind as BuildPipelineKind;
    const body = (await request.json()) as { name: string; nodes: BuildPipeline["nodes"]; edges: BuildPipeline["edges"] };
    const saved: BuildPipeline = {
      id: `bpp_${kind}`, tenantId: "demo", kind,
      name: body.name, nodes: body.nodes ?? [], edges: body.edges ?? [],
      factory: false, updatedAt: "2026-08-11T00:00:00Z",
    };
    db.buildPipelines[kind] = saved;
    return HttpResponse.json(saved);
  }),
  // 撤销覆盖 → 回出厂默认。
  http.delete("*/a/v1/databuilder/pipelines/:kind", ({ params }) => {
    const kind = params.kind as BuildPipelineKind;
    delete db.buildPipelines[kind];
    return HttpResponse.json(factoryPipeline(kind));
  }),
  // 节点 SOP「人要不要介入」的放行：PAUSED 的 run 放行该步并续跑（没人能放行 = 死锁）。
  http.post("*/a/v1/databuilder/workflow-runs/:id/approve", async ({ params, request }) => {
    const body = (await request.json()) as { stepKey: string };
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    // 放行该步 → 续跑（与真后端 `databuilder/service.ts:640 approveWorkflowStep` 同语义：
    // 把 stepKey 记进 context 放行名单，再 resume 驱动——**不是**把整条 run 直接判成功）。
    const approved = mockApprovedSteps(wf);
    approved.add(body.stepKey);
    wf.context = { ...(wf.context ?? {}), [MOCK_APPROVAL_KEY]: [...approved] };
    driveMockStoryRun(wf); // 续跑：跑到终态，或停在**下一个**未放行的闸
    return HttpResponse.json(wf);
  }),
  // DF.13c 原型 intake（mock：返回确定性示例解析 + 对账；真后端 parsePrototypeHtml 确定性解析上传 HTML）。
  // ★ WO-FE-WIRE-2：**按生效 pipeline 跑**——节点关掉 → 该段产物真的不出现；标「要人放行」→ 停 PAUSED。
  // 这样「在界面上改 pipeline ⇒ intake 处理行为跟着变」是真的接缝，而不是只测 CRUD 存取。
  http.post("*/a/v1/databuilder/intake", () => {
    const pipeline = resolvePipeline("intake");
    const ran: string[] = [];
    const out: Record<string, unknown> = {};
    for (const n of pipelineOrder(pipeline)) {
      if (!n.enabled) continue; // 关掉 = 不执行（保留在画布上）
      if (n.sop.requiresHumanApproval) {
        // 执行到该节点**前**置 PAUSED 等人批准（approve 后 resume 续跑）。
        return HttpResponse.json({ ...out, status: "PAUSED", pausedAt: n.stepKey, ranSteps: ran, pipeline: { kind: pipeline.kind, factory: pipeline.factory } });
      }
      ran.push(n.stepKey);
      if (n.stepKey === "intake_parse") out.intake = structuredClone(INTAKE_PARSE_RESULT);
      if (n.stepKey === "intake_reconcile") out.reconcile = structuredClone(INTAKE_RECONCILE_RESULT);
      // WO-BEFE-E：`intake_persist_candidates` 这一节点在真后端**真的落库**
      // （`intake-pipeline.ts:135` 逐条 `repos.reconcileCandidates.put`）。桩此前只回一个计数，
      // 于是「落库了的那批」在 mock 态根本不存在 ⇒ HITL 队列演不出来。现在真写进 store。
      if (n.stepKey === "intake_persist_candidates") {
        for (const [i, c] of INTAKE_RECONCILE_RESULT.candidates.entries()) {
          const id = `rcc_mock_${i}`;
          if (!mockReconcileCandidates.has(id)) mockReconcileCandidates.set(id, { ...structuredClone(c), id, tenantId: "demo" });
        }
        out.persistedCandidates = INTAKE_RECONCILE_RESULT.candidates.length;
      }
      if (n.stepKey === "intake_emit") out.emitted = "prototype.intake_recorded";
    }
    return HttpResponse.json({ ...out, status: "SUCCEEDED", ranSteps: ran, pipeline: { kind: pipeline.kind, factory: pipeline.factory } });
  }),
  // ── WO-BEFE-E · 对账候选 HITL 队列（datacore app.ts:4804 / :4811）──────────────
  // 状态机照抄后端：`status` 过滤；resolve 写 `RESOLVED` + `resolvedAction`/`resolvedTarget`/`resolvedAt`。
  http.get("*/a/v1/databuilder/reconcile-candidates", ({ request }) => {
    const want = new URL(request.url).searchParams.get("status");
    const items = [...mockReconcileCandidates.values()]
      .filter((c) => (want ? c.status === want : true))
      // R6 确定性：按 id 稳定排序（Map 迭代序是插入序，跨用例不可依赖）。
      .sort((a, b) => a.id.localeCompare(b.id));
    return HttpResponse.json({ items });
  }),
  http.post("*/a/v1/databuilder/reconcile-candidates/:id/resolve", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const cand = mockReconcileCandidates.get(id);
    if (!cand) return err(404, "NOT_FOUND", "对账候选不存在");
    const body = (await request.json()) as { action?: ReconcileAction; target?: string };
    const resolved: SchemaReconcileCandidate & { id: string; tenantId: string } = {
      ...cand, status: "RESOLVED", resolvedAction: body.action,
      ...(body.target ? { resolvedTarget: body.target } : {}),
      resolvedAt: "2026-08-14T00:00:00.000Z", // 确定性时间戳（R6·无 `new Date()`）
    };
    mockReconcileCandidates.set(id, resolved);
    return HttpResponse.json(resolved);
  }),
  // P3 导入正门（mock）：HTML 物化进库 → 返回落库连接 + RawDataset 概要（值与原型一致）。
  http.post("*/a/v1/databuilder/intake/import", () =>
    HttpResponse.json({
      connection: { id: "conn_proto_mock", name: "原型导入:prototype.html", category: "PROTOTYPE" },
      datasets: [
        { id: "rds_base", name: "BASE_DATA", rowCount: 2, fields: ["baseId", "name", "util", "gwh"] },
        { id: "rds_order", name: "ORDER_DATA", rowCount: 1, fields: ["so", "cust", "model", "qty", "baseRef"] },
      ],
      rowCounts: { BASE_DATA: 2, ORDER_DATA: 1 },
    }),
  ),

  // P3 闭环末步（mock）：按对账把导入表物化为既有对象类型 ObjectInstance。
  http.post("*/a/v1/databuilder/intake/objectify", () =>
    HttpResponse.json({
      jobId: "job_proto_mock",
      materialized: [{ dataset: "ORDER_DATA", type: "Order", count: 1 }],
      skipped: [{ dataset: "BASE_DATA", reason: "多义/未命中，待人确认（不猜）" }],
    }),
  ),

  // ---- Entitlement ----
  http.get("*/a/v1/features/registry", () => HttpResponse.json(FEATURE_REGISTRY)),

  // C12 配置迁移（OC3 跨系统 Saga）：导出本租户 bundle + 导入跑 Saga。真后端 config-bundle.ts；mock 给确定性 Saga 结果。
  http.get("*/a/v1/config-bundles/export", () =>
    HttpResponse.json({ platformSchemaVersion: "1.0", sourceTenantId: "demo", exportedAt: "2026-06-25T00:00:00Z", featureOverrides: { "view.dash": true, "view.plan-audit": false } }),
  ),
  http.post("*/a/v1/config-bundles/import", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { bundle?: { platformSchemaVersion?: string; featureOverrides?: Record<string, boolean> }; dryRun?: boolean; conflictPolicy?: string };
    const overrides = body.bundle?.featureOverrides ?? {};
    const known = new Set(FEATURE_REGISTRY.map((f) => f.key));
    const unknown = Object.keys(overrides).filter((k) => !known.has(k));
    const base = { id: "imp_mock_1", tenantId: "demo", schemaVersion: body.bundle?.platformSchemaVersion ?? "1.0", dryRun: !!body.dryRun, conflictPolicy: body.conflictPolicy ?? "OVERWRITE", createdAt: "2026-06-25T00:00:00Z", updatedAt: "2026-06-25T00:00:01Z" };
    if (unknown.length > 0) return HttpResponse.json({ ...base, state: "FAILED", error: `未知功能键：${unknown.slice(0, 5).join(", ")}` });
    // 目标当前（mock）：view.dash=true → 同；view.plan-audit 不存在 → 新增。
    const current: Record<string, boolean> = { "view.dash": true };
    const added: string[] = [], changed: { key: string; from: boolean; to: boolean }[] = [], same: string[] = [];
    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in current)) added.push(k);
      else if (current[k] !== v) changed.push({ key: k, from: current[k]!, to: v });
      else same.push(k);
    }
    const diff = { featureOverrides: { added, changed, same }, conflicts: changed.map((c) => c.key) };
    if (body.conflictPolicy === "FAIL" && diff.conflicts.length > 0) return HttpResponse.json({ ...base, state: "FAILED", diff, error: `存在 ${diff.conflicts.length} 项冲突且 policy=FAIL` });
    if (body.dryRun) return HttpResponse.json({ ...base, state: "DRY_RUN_OK", diff });
    return HttpResponse.json({ ...base, state: "COMMITTED", diff });
  }),

  http.get("*/a/v1/tenants/:id/features/preview", ({ request }) => {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") ?? "planner";
    const account = ACCOUNTS.find((a) => a.roles.some((r) => r.startsWith(role))) ?? ACCOUNTS[0]!;
    const ws = workspaceForAccount(account, db.tenantOverrides, db.configVersion);
    return HttpResponse.json({ navigation: ws.navigation, views: (ws.views ?? []).map((v) => ({ key: v.key, title: v.title })) });
  }),

  http.get("*/a/v1/tenants/:id/features", ({ request }) => {
    const account = auth(request) ?? ACCOUNTS[0]!;
    return HttpResponse.json({ features: featuresForAccount(account, db.tenantOverrides), configVersion: db.configVersion });
  }),

  http.put("*/a/v1/tenants/:id/features", async ({ request }) => {
    const body = (await request.json()) as { overrides: Record<string, boolean> };
    db.tenantOverrides = { ...db.tenantOverrides, ...body.overrides };
    db.configVersion += 1;
    return HttpResponse.json({ configVersion: db.configVersion });
  }),

  http.put("*/a/v1/tenants/:id/features/roles/:role", async ({ request, params }) => {
    const body = (await request.json()) as { overrides: Record<string, boolean> };
    // 角色只能收窄：尝试开启租户未购项 → 422
    for (const [key, on] of Object.entries(body.overrides)) {
      const tenantOn = db.tenantOverrides[key] ?? FEATURE_REGISTRY.find((f) => f.key === key)?.defaultOn ?? false;
      if (on && !tenantOn) return err(422, "ROLE_CANNOT_EXCEED_TENANT", `角色不可开通租户未购功能：${key}`);
    }
    db.roleOverrides[String(params.role)] = body.overrides;
    db.configVersion += 1;
    return HttpResponse.json({ configVersion: db.configVersion });
  }),

  http.get("*/a/v1/tenants/:id/features/audit", () => HttpResponse.json([])),

  // ---- 数据接入分类（mock）----
  http.get("*/a/v1/data-categories", () =>
    HttpResponse.json({
      items: [
        { key: "sales_orders", displayName: "销售订单", description: "客户下达的电池销售订单（型号/数量/交期/状态）。", mode: mockCategoryMode.sales_orders ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "salesforce_crm", "rest_api", "file_upload"], customColumns: mockCategoryTpl.sales_orders ?? null, types: [{ typeKey: "Order", displayName: "销售订单", columns: ["so", "cust", "model", "qty", "due", "status"], present: true }] },
        { key: "demand_forecast", displayName: "销售预测与计划", description: "需求预测、年度情景与触发条件、计划目标（驱动产能/排产推演）。", mode: mockCategoryMode.demand_forecast ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.demand_forecast ?? null, types: [{ typeKey: "PlanTarget", displayName: "计划目标", columns: ["period", "level", "value"], present: true }, { typeKey: "AnnualScenario", displayName: "年度情景", columns: ["key", "name", "version"], present: true }] },
        { key: "customer_ar", displayName: "客户与应收", description: "客户主数据（信用/账期）与应收发票。", mode: mockCategoryMode.customer_ar ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["salesforce_crm", "sap_erp", "file_upload"], customColumns: mockCategoryTpl.customer_ar ?? null, types: [{ typeKey: "Customer", displayName: "客户", columns: ["custId", "name", "creditLimit"], present: true }] },
        { key: "product_master", displayName: "产品主数据", description: "产品平台、系列、型号、版本与应用细分（毛利率口径）及工程变更。", mode: mockCategoryMode.product_master ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "sap_erp", "rest_api"], customColumns: mockCategoryTpl.product_master ?? null, types: [{ typeKey: "ProductPlatform", displayName: "产品平台", columns: ["platformId", "platformCode", "name", "category", "status"], present: true }, { typeKey: "ProductSeries", displayName: "产品系列", columns: ["seriesId", "seriesCode", "name", "category", "targetMarket"], present: true }, { typeKey: "Model", displayName: "产品型号", columns: ["modelId", "name", "chem", "pos", "unitPrice"], present: true }, { typeKey: "ProductVersion", displayName: "产品版本", columns: ["versionId", "versionCode", "status", "effectiveDate"], present: true }, { typeKey: "EngineeringChange", displayName: "工程变更", columns: ["changeId", "changeNumber", "changeType", "status"], present: true }] },
        { key: "capacity_base", displayName: "产能与基地", description: "生产基地、产线、产能投资项目及产品-产线/设备制造能力。", mode: mockCategoryMode.capacity_base ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.capacity_base ?? null, types: [{ typeKey: "Base", displayName: "生产基地", columns: ["baseId", "name", "kind", "lon", "lat"], present: true }, { typeKey: "Line", displayName: "产线", columns: ["lineId", "baseId", "utilization"], present: true }, { typeKey: "ProductLineCapability", displayName: "产品产线能力", columns: ["capId", "capability", "maxCapacity", "yield"], present: true }, { typeKey: "ProductEquipmentCapability", displayName: "产品设备能力", columns: ["equipCapId", "capability", "maxSpeed"], present: true }] },
        { key: "process_routing", displayName: "工艺路线与工序", description: "工艺路线、工序定义、工艺能力边界及换型矩阵（瓶颈/换型排序推演）。", mode: mockCategoryMode.process_routing ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "generic_jdbc", "rest_api"], customColumns: mockCategoryTpl.process_routing ?? null, types: [{ typeKey: "Process", displayName: "工序", columns: ["procId", "name", "kind", "yield"], present: true }, { typeKey: "Routing", displayName: "工艺路线", columns: ["routingId", "routingCode", "operationCount", "totalStandardTime"], present: true }, { typeKey: "Operation", displayName: "工序定义", columns: ["operationId", "operationName", "standardTime", "yield"], present: true }, { typeKey: "ProcessCapabilityWindow", displayName: "工艺能力边界", columns: ["capabilityId", "parameterName", "minValue", "maxValue", "targetValue"], present: true }] },
        { key: "equipment_ledger", displayName: "设备与能耗", description: "设备台账 OEE、检修计划与能耗计量（MES/IoT）。", mode: mockCategoryMode.equipment_ledger ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["generic_jdbc", "rest_api", "file_upload"], customColumns: mockCategoryTpl.equipment_ledger ?? null, types: [{ typeKey: "Equipment", displayName: "设备", columns: ["equipId", "processId", "ctSeconds", "availFactor"], present: true }] },
        { key: "material_inventory", displayName: "物料与库存", description: "物料主数据、BOM、物料替代关系、批次库存及物料平衡（断供/集中度推演）。", mode: mockCategoryMode.material_inventory ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.material_inventory ?? null, types: [{ typeKey: "Material", displayName: "物料", columns: ["matId", "name", "unitPrice", "leadTime"], present: true }, { typeKey: "BOMHeader", displayName: "BOM", columns: ["bomId", "bomCode", "bomLevel"], present: true }, { typeKey: "BOMDetail", displayName: "BOM明细", columns: ["bomDetailId", "sequence", "quantity"], present: true }, { typeKey: "MaterialAlternative", displayName: "物料替代", columns: ["altId", "priority", "approvalStatus"], present: true }] },
        { key: "procurement", displayName: "采购与供应商", description: "供应商主数据、采购订单与在途批次（到货延误/缺料推演）。", mode: mockCategoryMode.procurement ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "rest_api", "file_upload"], customColumns: mockCategoryTpl.procurement ?? null, types: [{ typeKey: "Supplier", displayName: "供应商", columns: ["supplierId", "supplierCode", "name", "rating", "status"], present: true }, { typeKey: "PurchaseOrder", displayName: "采购订单", columns: ["poId", "qty", "etaDay"], present: true }] },
        { key: "quality_compliance", displayName: "质量与合规", description: "质量标准、检验特性、数据源健康度与产品认证（合规/碳护照前置）。", mode: mockCategoryMode.quality_compliance ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.quality_compliance ?? null, types: [{ typeKey: "QualityStandard", displayName: "质量标准", columns: ["standardId", "itemName", "targetValue", "toleranceUpper", "toleranceLower"], present: true }, { typeKey: "InspectionCharacteristic", displayName: "检验特性", columns: ["charId", "charName", "inspectionType", "samplingRate"], present: true }] },
        { key: "finance_carbon", displayName: "财务与碳", description: "基地财务账户、情景财务指标、财务预算（收入/成本/毛利）与碳因子。", mode: mockCategoryMode.finance_carbon ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.finance_carbon ?? null, types: [{ typeKey: "FinanceAccount", displayName: "财务账户", columns: ["accId", "cashOnHand", "receivable"], present: true }] },
        { key: "external_signal", displayName: "外部信号", description: "锂价/镍价/汇率/需求指数/政策等市场与环境信号。", mode: mockCategoryMode.external_signal ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["external_feed", "mock_external", "rest_api"], customColumns: mockCategoryTpl.external_signal ?? null, types: [{ typeKey: "ExternalSignal", displayName: "外部信号", columns: ["signalId", "category", "value"], present: true }] },
        { key: "decision_cockpit", displayName: "经营决策驾驶舱", description: "经营指标库/KSF/责任主体与根因归因模板（目标-指标-责任骨架，驱动各视图 KPI · 根因 DAG）。", mode: mockCategoryMode.decision_cockpit ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.decision_cockpit ?? null, types: [{ typeKey: "Metric", displayName: "指标", columns: ["metricId", "name", "target", "actual"], present: true }] },
      ],
    })),
  http.put("*/a/v1/data-categories/:key/mode", async ({ request, params }) => {
    const body = (await request.json()) as { mode: "SYSTEM_INTEGRATION" | "FILE_UPLOAD" };
    mockCategoryMode[params.key as string] = body.mode;
    return HttpResponse.json({ categoryKey: params.key, mode: body.mode });
  }),
  http.put("*/a/v1/data-categories/:key/template", async ({ request, params }) => {
    const body = (await request.json()) as { columns: string[] };
    mockCategoryTpl[params.key as string] = body.columns.length > 0 ? body.columns : null;
    return HttpResponse.json({ categoryKey: params.key, customColumns: mockCategoryTpl[params.key as string] });
  }),

  // ---- 对象查询（GET /a/v1/objects?type=&q=&page=&f_*） ----
  http.get("*/a/v1/objects", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "Order";
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    const base = url.searchParams.get("base");

    let rows: { id: string; props: Record<string, unknown> }[];
    if (type === "Base") {
      rows = filterByScope(BASES, account).map((b) => ({ id: b.id, props: { ...b } }));
    } else if (type === "Model") {
      rows = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"].map((m) => ({ id: `model-${m}`, props: { name: m } }));
    } else if (type === "DemandSegment") {
      rows = [
        { segId: "dseg-1", segment: "乘用车", tgt: 201.7, demandWanPerYearP50: 201.7, demandWanPerYearP90: 199.6, act: 200.6 },
        { segId: "dseg-2", segment: "储能", tgt: 139.2, demandWanPerYearP50: 139.2, demandWanPerYearP90: 108.4, act: 100.5 },
        { segId: "dseg-3", segment: "商用车", tgt: 34.1, demandWanPerYearP50: 34.1, demandWanPerYearP90: 34.0, act: 39.5 },
      ].map((r) => ({ id: r.segId, props: r }));
    } else if (type === "Workshop") {
      const workshops = filterByScope(BASES, account).flatMap((b) =>
        ["制浆", "涂布", "辊压", "分切", "卷绕", "装配", "注液", "化成", "分容", "PACK"].map((wt, i) => ({
          id: `workshop-${b.name}-${i + 1}`,
          props: { workshopId: `${b.name}-WS${String(i + 1).padStart(2, "0")}`, baseId: b.id, name: `${b.name}${wt}车间`, processType: wt },
        })),
      );
      rows = workshops;
    } else if (type === "Line") {
      // ② G-UI-2·真产线对象（每基地 10 车间线·PACK 线 = 成品下线代表·镜像 datacore battery.ts LINE-WS-{base}-{suffix}）。
      // baseId 取基地**名**（与 mock ORDERS.bases=基地名 同键·令前端 lineNameOf(homeBase) 命中；真 datacore 两侧同为拼音 id 亦命中）。
      const WS: [string, string][] = [["制浆", "slurry"], ["涂布", "coating"], ["辊压", "calendering"], ["分切", "slitting"], ["卷绕", "winding"], ["装配", "assembly"], ["注液", "filling"], ["化成", "formation"], ["分容", "grading"], ["PACK", "pack"]];
      rows = filterByScope(BASES, account).flatMap((b) => WS.map(([wt, suffix]) => {
        const lineId = `LINE-WS-${b.name}-${suffix}`;
        return { id: lineId, props: { lineId, baseId: b.name, name: `${b.name}${wt}线`, line_code: lineId.replace("LINE-", "L-"), status: "运行中" } };
      }));
    } else if (type === "InterBaseTransfer") {
      // WO-GSIM-3：跨基地调拨（喂区⑤两段排产表·电芯段→在途→Pack段）。fromBase/toBase=真 baseId·model 对齐订单型号。
      // 逐口径移植 datacore battery.ts interBaseTransfers（键 XFER-{from}-{to}-{model}·transitDays 真值·MODEL_BASE_MAP 派生）。
      // WO-SURFACE-7DIM：与 mockGlobalSim 两阶段 schedule[] 同源（PORT_TRANSFERS·单一来源·灭漂移）。
      rows = PORT_TRANSFERS.map((r) => ({ id: r.transferId, props: r }));
    } else if (type === "SopVersionRow") {
      // SOP.4 版本演进对比（V1/V3/V5/V7）。
      // WO-MOCK-SCALE-TRUTH：本体属性定义写死 `demand/supply` 的 `unit: "万套/年"`
      //（description 还专门写了「非 S&OP 月度台账口径」），真后端种子实测 360/368/375/383 与
      // 324/342/360/379。旧 mock 的 127/130/132/134 既不是年也不是月，是第三份真相源 —— 现改回年口径。
      rows = SOP_VERSION_ROWS.map((r) => ({ id: `sopv-${r.ver}`, props: { ...r } }));
    } else {
      let orders = filterByScope(ORDERS, account);
      if (base) orders = orders.filter((o) => o.bases.includes(base));
      rows = orders.map((o) => ({ id: o.id, props: { ...o } }));
    }
    if (q) rows = rows.filter((r) => JSON.stringify(r.props).toLowerCase().includes(q));
    // 列筛选 f_*
    for (const [k, v] of url.searchParams.entries()) {
      if (!k.startsWith("f_") || !v) continue;
      const prop = k.slice(2);
      rows = rows.filter((r) => String(r.props[prop] ?? "").includes(v));
    }
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, type }));
    return HttpResponse.json({ items, total });
  }),

  // ---- 治理增量 §3.3 关键词搜索（命中 name + 相似度降序） ----
  http.get("*/a/v1/objects/search", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return err(400, "VALIDATION_ERROR", "搜索关键词长度需 ≥2");
    const typesParam = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
    const known = new Set(["Base", "Model", "Order", "Workshop"]);
    const unknown = typesParam.filter((t) => !known.has(t));
    if (unknown.length) return err(400, "VALIDATION_ERROR", `未知对象类型：${unknown.join(", ")}`);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20") || 20, 20);
    const bases = filterByScope(BASES, account);
    const items = (typesParam.length && !typesParam.includes("Base") ? [] : bases)
      .filter((b) => b.name.includes(q) || b.id.includes(q) || (b.mainProduct ?? "").includes(q))
      .map((b) => ({ typeKey: "Base", objectKey: b.name, display: b.name, domainKey: "factory", score: b.name === q ? 1 : 0.7 }));
    items.sort((a, b) => b.score - a.score);
    return HttpResponse.json({ items: items.slice(0, limit), tookMs: 1 });
  }),

  // ---- 治理增量 §3.4 邻接导航 ----
  http.get("*/a/v1/objects/:id/neighbors", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const id = String(params.id);
    const base = filterByScope(BASES, account).find((b) => b.id === id || b.name === id || b.name === decodeURIComponent(id));
    if (!base) return err(404, "NOT_FOUND", "object not found");
    const orders = filterByScope(ORDERS, account).filter((o) => o.bases === base.name);
    const groups = [
      {
        linkKey: "order_at_base",
        direction: "in" as const,
        total: orders.length,
        items: orders.slice(0, 50).map((o) => ({ id: o.id, typeKey: "Order", objectKey: o.so, display: o.so })),
      },
    ].filter((g) => g.total > 0);
    return HttpResponse.json({ groups });
  }),

  // ---- 治理增量 §3.6 聚合查询 ----
  http.post("*/a/v1/objects/aggregate", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as {
      typeKey: string;
      groupBy?: string[];
      metrics: { prop: string; fn: "count" | "sum" | "avg" | "min" | "max" }[];
    };
    const rows = body.typeKey === "Base" ? filterByScope(BASES, account) : body.typeKey === "Order" ? filterByScope(ORDERS, account) : [];
    const groupBy = body.groupBy ?? [];
    const groups = new Map<string, { group: Record<string, string | null>; rows: Record<string, unknown>[] }>();
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const k = groupBy.map((g) => String(r[g] ?? "∅")).join("");
      let g = groups.get(k);
      if (!g) {
        const group: Record<string, string | null> = {};
        for (const gb of groupBy) group[gb] = r[gb] == null ? null : String(r[gb]);
        g = { group, rows: [] };
        groups.set(k, g);
      }
      g.rows.push(r);
    }
    const out = [...groups.values()].map((g) => {
      const metrics: Record<string, number | null> = {};
      for (const m of body.metrics) {
        const key = `${m.fn}_${m.prop}`;
        if (m.fn === "count") metrics[key] = g.rows.length;
        else {
          const vals = g.rows.map((p) => p[m.prop]).filter((v): v is number => typeof v === "number");
          if (!vals.length) metrics[key] = null;
          else if (m.fn === "sum") metrics[key] = vals.reduce((a, b) => a + b, 0);
          else if (m.fn === "avg") metrics[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
          else if (m.fn === "min") metrics[key] = Math.min(...vals);
          else metrics[key] = Math.max(...vals);
        }
      }
      return { group: g.group, metrics };
    });
    return HttpResponse.json({ rows: out, rowCount: out.length, truncated: false });
  }),

  http.get("*/a/v1/ontology/domains", () =>
    HttpResponse.json([
      { domainKey: "factory", displayName: "工厂", color: "#2563eb" },
      { domainKey: "product", displayName: "产品", color: "#16a34a" },
    ]),
  ),
  http.post("*/a/v1/ontology/domains", async ({ request }) => {
    const b = (await request.json()) as { domainKey: string; displayName?: string };
    return HttpResponse.json({ domainKey: b.domainKey, displayName: b.displayName ?? b.domainKey }, { status: 201 });
  }),

  // ---- 七管理页整簇 mock ----
  // V11：断言矩阵 mock（含 ⑤参照双算 + 一条失败 diff，供段级红绿矩阵/下钻渲染）。
  http.get("*/a/v1/validation/runs/:id", ({ params }) =>
    HttpResponse.json({
      id: String(params.id), profile: "SMOKE", seed: 42, startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:09:00Z",
      report: { profile: "SMOKE", seed: 42, pass: false, coverage: { module: 0.92, assertion: 1, loop: 0.86 }, engineeringVerificationScore: 0.95, assertions: VLE_MOCK_ASSERTIONS },
    }),
  ),
  http.get("*/a/v1/validation/runs", () =>
    HttpResponse.json([
      {
        id: "vrun_1", profile: "SMOKE", seed: 42, startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:09:00Z",
        report: { profile: "SMOKE", seed: 42, pass: true, coverage: { module: 0.95, assertion: 0.9, loop: 1 }, engineeringVerificationScore: 0.94, assertions: [] },
      },
    ]),
  ),
  http.post("*/a/v1/validation/runs", () => HttpResponse.json({ id: "vrun_2" }, { status: 202 })),

  http.get("*/a/v1/quarantine", () =>
    HttpResponse.json([
      { id: "qr_1", connId: "conn_1", dataset: "orders", raw: { so: "", qty: 10 }, reason: "SCHEMA_MISMATCH", detail: "缺主键 so", status: "PENDING", createdAt: "2026-06-17T08:00:00Z" },
      { id: "qr_2", connId: "conn_1", dataset: "orders", raw: { so: "SO-1", qty: "x" }, reason: "TYPE_ERROR", detail: "qty 非数字", status: "DISCARDED", createdAt: "2026-06-17T08:01:00Z" },
    ]),
  ),
  http.post("*/a/v1/quarantine/:id/reprocess", () => HttpResponse.json({ ok: true })),
  http.post("*/a/v1/quarantine/discard", () => HttpResponse.json({ discarded: 1 })),

  http.get("*/a/v1/notifications", () =>
    HttpResponse.json({
      unread: 1,
      items: [
        { id: "ntf_1", kind: "approval_pending", title: "待审批", body: "有一条 capex_action 待你审批", refType: "action", refId: "act_1", createdAt: "2026-06-17T08:00:00Z" },
        { id: "ntf_2", kind: "action_approved", title: "审批通过", body: "你发起的方案已通过", readAt: "2026-06-17T08:05:00Z", createdAt: "2026-06-17T07:00:00Z" },
      ],
    }),
  ),
  http.post("*/a/v1/notifications/:id/read", () => HttpResponse.json({ ok: true })),
  http.post("*/a/v1/notifications/read-all", () => HttpResponse.json({ ok: true })),

  http.get("*/b/v1/evals", () =>
    HttpResponse.json({
      items: [
        { id: "ec_1", tenantId: "demo", suite: "classifier", packageId: "pkg_battery_manufacturing", input: { query: "4680-NCM 加 20% 六周能不能接？", context: { view: "project", selectedObjects: [], filters: {} } }, expect: { intentKey: "capacity_feasibility" }, origin: "SCENARIO", createdAt: "2026-06-17T08:00:00Z" },
      ],
    }),
  ),
  // C9 评测用例创建（input/expect）：真后端 POST /b/v1/evals。mock 回回填一条带 id 的用例。
  http.post("*/b/v1/evals", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return HttpResponse.json({ id: `ec_mock_${Date.now()}`, tenantId: "demo", origin: "MANUAL", createdAt: new Date().toISOString(), ...body }, { status: 201 });
  }),
  http.get("*/b/v1/evals/runs", () =>
    HttpResponse.json({
      items: [
        { id: "erun_1", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:01:00Z", total: 20, passed: 19, passRate: 0.95, metrics: { intentAccuracy: 0.95, toolCorrectness: 0.9, avgToolCalls: 2.1, avgLatencyMs: 320, avgTokenCost: 1200 }, results: [], llmMode: "MOCK", parity: { byFailKind: { INTENT: 1, TOOLSEQ: 0, ANSWER: 0, OTHER: 0 }, byCase: [] } },
      ],
    }),
  ),
  http.post("*/a/v1/objects/merge-scan", () => HttpResponse.json({ candidates: [{ id: "mc_new" }] })),
  http.get("*/a/v1/objects/merge-candidates", () =>
    HttpResponse.json([
      { id: "mc_1", tenantId: "demo", typeKey: "Base", objectIds: ["obj_a", "obj_b"], score: 1, rule: "归一名称完全一致", status: "PENDING", createdAt: "2026-06-17T08:00:00Z",
        objects: [{ id: "obj_a", props: { baseId: "cz1", name: "常州", util: 0.88 } }, { id: "obj_b", props: { baseId: "cz2", name: "常州", util: 0.9 } }] },
    ]),
  ),
  http.post("*/a/v1/objects/merge-candidates/:id/merge", () => HttpResponse.json({ id: "omg_1", tenantId: "demo", typeKey: "Base", goldenId: "obj_a", mergedIds: ["obj_b"], mergedBy: "planner", mergedAt: "2026-06-17T09:00:00Z", unmergeUntil: "2026-06-20T09:00:00Z" })),
  http.post("*/a/v1/objects/merge-candidates/:id/reject", () => HttpResponse.json({ ok: true })),
  http.get("*/a/v1/objects/merges", () =>
    HttpResponse.json({ items: [{ id: "omg_0", tenantId: "demo", typeKey: "Base", goldenId: "obj_x", mergedIds: ["obj_y"], mergedBy: "planner", mergedAt: "2026-06-16T09:00:00Z", unmergeUntil: "2026-06-19T09:00:00Z" }] }),
  ),
  http.post("*/a/v1/objects/merges/:id/unmerge", () => HttpResponse.json({ ok: true })),

  http.post("*/b/v1/growth/run", async ({ request }) => {
    const b = (await request.json()) as { query: string; maxRounds?: number };
    // CL.7：可补齐的缺口（EMPTY_DATA 类，含"达成率"标记）→ CONVERGED（续推可出答案）；其余 → BOUNDARY（诚实工单）。
    if (b.query.includes("达成率")) {
      return HttpResponse.json({
        question: b.query, maxRounds: b.maxRounds ?? 4,
        rounds: [{ round: 1, gapReport: { question: b.query, taskId: "t1", verdict: "ANSWERABLE", path: "AGENT", findings: [], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "EMPTY_DATA", action: "fill-data 已补", advanced: true } }],
        terminalState: "CONVERGED", openTickets: [], generatedAt: "2026-06-17T00:00:00Z",
      });
    }
    return HttpResponse.json({
      question: b.query, maxRounds: b.maxRounds ?? 4,
      rounds: [{ round: 1, gapReport: { question: b.query, taskId: "t1", verdict: "BOUNDARY", path: "AGENT", findings: [{ gapCode: "NO_INTENT", evidence: "无意图覆盖", suggestedFill: "scaffold", blocking: true }], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "NO_INTENT", action: "scaffold待建（出工单）", advanced: false, ticket: { gapCode: "NO_INTENT", detail: "无意图覆盖" } } }],
      terminalState: "BOUNDARY", openTickets: [{ gapCode: "NO_INTENT", detail: "无意图覆盖" }], generatedAt: "2026-06-17T00:00:00Z",
    });
  }),
  http.get("*/b/v1/growth/ledger", () =>
    HttpResponse.json({ items: [
      { id: "glr_1", tenantId: "demo", createdAt: "2026-06-17T08:00:00Z", report: { question: "常州影响哪些订单？", maxRounds: 4, rounds: [{ round: 1, gapReport: { verdict: "ANSWERABLE", findings: [] } }], terminalState: "CONVERGED", openTickets: [] } },
      { id: "glr_2", tenantId: "demo", createdAt: "2026-06-17T07:00:00Z", report: { question: "未知能力问句", maxRounds: 4, rounds: [{ round: 1, gapReport: { verdict: "BOUNDARY", findings: [] } }], terminalState: "BOUNDARY", openTickets: [{ gapCode: "NO_CAPABILITY", detail: "x" }] } },
    ] }),
  ),
  // WO-BEFE-D：工单状态改成**可变**的 —— claim/submit/verify 三条端点要真的推得动它，
  // 否则「认领→提交→验证」这条链在 mock 模式下走一步就回到 OPEN，前端接缝测试证明不了任何事。
  http.get("*/b/v1/growth/tickets", () => HttpResponse.json({ items: growthTicketState })),
  http.post("*/b/v1/growth/tickets/:id/claim", ({ params }) => {
    const tk = growthTicketState.find((t) => t.id === params.id);
    if (!tk) return err(404, "TICKET_NOT_FOUND", `growth ticket not found: ${String(params.id)}`);
    tk.status = "IN_PROGRESS";
    tk.assignee = "cli-agent";
    return HttpResponse.json(tk);
  }),
  // ── WO-BEFE-D · 探针（只诊断不动数据）────────────────────────────────────────
  // 与 `/growth/run` 的差别在 mock 里也**必须真实存在**，否则前端测试证明不了"探针不写"这件事：
  // 本 handler 一个字都不改 `growthTicketState`（run 那条会），断言可据此分辨两者。
  http.post("*/b/v1/growth/probe", async ({ request }) => {
    const b = (await request.json()) as { query: string };
    const answerable = b.query.includes("达成率");
    return HttpResponse.json({
      question: b.query,
      taskId: "task_probe_mock",
      verdict: answerable ? "ANSWERABLE" : "BOUNDARY",
      path: "AGENT",
      findings: answerable ? [] : [{ gapCode: "NO_INTENT", evidence: "无意图覆盖该问句", suggestedFill: "scaffold", blocking: true }],
      generatedAt: "2026-06-17T00:00:00Z",
    });
  }),
  // ── WO-BEFE-D · 工单生命周期后两跳（IN_PROGRESS → IN_REVIEW → VERIFIED）──────────
  http.post("*/b/v1/growth/tickets/:id/submit", ({ params }) => {
    const tk = growthTicketState.find((t) => t.id === params.id);
    if (!tk) return err(404, "TICKET_NOT_FOUND", `growth ticket not found: ${String(params.id)}`);
    tk.status = "IN_REVIEW";
    return HttpResponse.json(tk);
  }),
  http.post("*/b/v1/growth/tickets/:id/verify", ({ params }) => {
    const tk = growthTicketState.find((t) => t.id === params.id);
    if (!tk) return err(404, "TICKET_NOT_FOUND", `growth ticket not found: ${String(params.id)}`);
    // 与真后端同款判据：重跑该单的原问句 → `verdict === "ANSWERABLE"` 才 VERIFIED，
    // 否则**停在 IN_REVIEW** 并回带新缺口（不是失败，是"还没好"——两者处置不同）。
    const answerable = tk.fromQuestion.includes("达成率");
    tk.status = answerable ? "VERIFIED" : "IN_REVIEW";
    return HttpResponse.json({
      ticket: tk,
      verified: answerable,
      gapReport: {
        question: tk.fromQuestion,
        taskId: "task_verify_mock",
        verdict: answerable ? "ANSWERABLE" : "BOUNDARY",
        path: "AGENT",
        findings: answerable ? [] : [{ gapCode: tk.gapCode, evidence: "重跑仍答不出", suggestedFill: "继续施工", blocking: true }],
        generatedAt: "2026-06-17T00:00:00Z",
      },
    });
  }),

  http.get("*/a/v1/ontology/slices", () =>
    HttpResponse.json(
      Object.entries(mockSliceGov).map(([sliceKey, v]) => ({
        sliceKey, version: 1, rootType: v.rootType, hops: 1, linkKeys: ["model_producible_at"], maxNodes: 200, fixtures: v.fixtures,
      })),
    ),
  ),
  // WO-SLICE-16-LAYERS：十六层结构（须排在 `/slices/:sliceKey` 之前——MSW 按注册序匹配，
  // 否则 `:sliceKey` 会把 `xxx/layers` 也吞掉）。
  http.get("*/a/v1/ontology/slices/:sliceKey/layers", ({ params }) => {
    const key = String(params.sliceKey);
    if (!mockSliceGov[key]) return err(404, "NOT_FOUND", `slice ${key}`);
    return HttpResponse.json(mockSliceLayers(key));
  }),
  // WO-SLICE-GOVERNANCE-FULL：完整 spec（编辑器预填）/ 内联子图 / 推进为契约（单+批）。
  http.get("*/a/v1/ontology/slices/:sliceKey", ({ params }) => {
    const key = String(params.sliceKey);
    const st = mockSliceGov[key];
    if (!st) return err(404, "NOT_FOUND", `slice ${key}`);
    return HttpResponse.json({
      sliceKey: key,
      version: 1,
      spec: {
        root: { typeKey: st.rootType, selector: { filter: {} } },
        paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
        maxNodes: 200,
        contractFixtures: st.fixtures > 0 ? [mockSliceFixture(st.rootType)] : [],
      },
    });
  }),
  http.post("*/a/v1/ontology/slices/derive-fixtures", () => {
    const promoted: { sliceKey: string; fixture: ReturnType<typeof mockSliceFixture> }[] = [];
    for (const [k, v] of Object.entries(mockSliceGov)) {
      if (v.fixtures === 0) { v.fixtures = 1; promoted.push({ sliceKey: k, fixture: mockSliceFixture(v.rootType) }); }
    }
    return HttpResponse.json({ promoted, skipped: [] }, { status: 201 });
  }),
  http.post("*/a/v1/ontology/slices/:sliceKey/derive-fixture", ({ params }) => {
    const key = String(params.sliceKey);
    const st = mockSliceGov[key];
    if (!st) return err(404, "NOT_FOUND", `slice ${key}`);
    st.fixtures = 1;
    return HttpResponse.json({ sliceKey: key, promoted: true, fixture: mockSliceFixture(st.rootType) }, { status: 201 });
  }),
  http.post("*/a/v1/ontology/slices/:sliceKey/resolve", ({ params }) => HttpResponse.json(mockSliceGraph(String(params.sliceKey)))),
  // C7 切片编辑器：规划器求路径 + 入库 + 试切预览。真后端 planSlice/PUT slices/resolveSlice；mock 给确定性结果。
  http.post("*/a/v1/slices/plan", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { rootType?: string; targets?: string[] };
    const rootType = body.rootType ?? "Order";
    const targets = body.targets ?? [];
    return HttpResponse.json({
      ok: true,
      plan: {
        sliceKey: `custom_${rootType.toLowerCase()}`,
        rootType,
        paths: targets.map((t) => ({ target: t, hops: [{ linkKey: `${rootType.toLowerCase()}_to_${t.toLowerCase()}`, direction: "out", toType: t }] })),
        pathEvidence: targets.map((t) => `${rootType} -[${rootType.toLowerCase()}_to_${t.toLowerCase()}:out]-> ${t}`),
        spannedDomains: ["factory"],
        reused: false,
      },
    });
  }),
  http.put("*/a/v1/ontology/slices/:sliceKey", ({ params }) =>
    HttpResponse.json({ sliceKey: String(params.sliceKey), version: 1 }, { status: 201 }),
  ),
  http.post("*/a/v1/slices/:sliceKey/resolve", () =>
    HttpResponse.json({
      data: { nodes: [{ id: "o1", type: "Order" }, { id: "b1", type: "Base" }], edges: [{ from: "o1", to: "b1", linkKey: "order_to_base" }], truncated: false },
      snapshotVersion: "ov-12",
    }),
  ),
  http.post("*/b/v1/evals/run", () =>
    HttpResponse.json({ id: "erun_2", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T09:00:00Z", finishedAt: "2026-06-17T09:01:00Z", total: 20, passed: 20, passRate: 1, metrics: { intentAccuracy: 1, toolCorrectness: 1, avgToolCalls: 2, avgLatencyMs: 300, avgTokenCost: 1100 }, results: [], llmMode: "MOCK" }),
  ),

  // A4 对象/类型浏览器：每类型物化计数（与 object-types mock 对齐）+ 14 业务域注册表。
  http.get("*/a/v1/ontology/object-types/stats", () =>
    HttpResponse.json({
      stats: [
        { key: "Base", displayName: "生产基地", domain: "factory", propCount: 4, derivedCount: 1, pk: "baseId", count: 3 },
        { key: "Model", displayName: "电池型号", domain: "product", propCount: 3, derivedCount: 0, pk: "modelId", count: 5 },
        { key: "Order", displayName: "订单", domain: "product", propCount: 6, derivedCount: 0, pk: "so", count: 20 },
        { key: "ExternalSignal", displayName: "外部信号", domain: "external", propCount: 5, derivedCount: 0, pk: "signalKey", count: 0 },
      ],
    }),
  ),
  http.get("*/a/v1/business-domains", () =>
    HttpResponse.json({
      domains: [
        { key: "factory", displayName: "工厂/基地", color: "#4C8BF5" },
        { key: "product", displayName: "产品/型号", color: "#36BFA5" },
        { key: "process", displayName: "工艺/工序", color: "#9C6ADE" },
        { key: "equip", displayName: "设备", color: "#DD9551" },
        { key: "people", displayName: "人员/班组", color: "#E2719B" },
        { key: "quality", displayName: "质量", color: "#46A758" },
        { key: "capacity", displayName: "产能", color: "#3D9AE8" },
        { key: "forecast", displayName: "预测/需求", color: "#8E6FE8" },
        { key: "sales", displayName: "销售/订单", color: "#E5894B" },
        { key: "material", displayName: "物料/供应", color: "#C2A33B" },
        { key: "finance", displayName: "财务/成本", color: "#5BB98C" },
        { key: "plan", displayName: "规划/情景", color: "#7C8CF8" },
        { key: "external", displayName: "外部信号", color: "#B36AC2" },
        { key: "decision", displayName: "决策/根因", color: "#E5484D" },
      ],
    }),
  ),
  // WO-WAITING-STATES-FE · 业务流程层等待态（需求 §20）。
  // fixture 走 `processWaitFixtures.ts`：逐条过契约 zod schema（与后端播种同一份），
  // 数据是 `apps/datacore/src/seed.ts` 的逐字子集 —— 防「mock 与真后端分家、测试咬 mock 恒绿」。
  // ⚠ 顺序要紧：`:key/instances` 必须排在裸 `/a/v1/process-definitions` **前面**，
  // 否则前者永远匹不到（msw 按注册序取第一个命中的 handler）。
  // WO-FLOWTIME · 流程实例与站间流转时长。fixture 两向都给（反推得出 / 反推不出），
  // 值逐字取自真后端真跑响应 —— 只 mock 成功那一路，`available:false` 的渲染分支就永远没跑过。
  http.get("*/a/v1/process-definitions/:key/instances", ({ params }) =>
    HttpResponse.json(processInstancesFixture(String(params.key))),
  ),
  // WO-SANDBOX-PROCESS-MODE · 流程节点检视（沙盘第五档右栏 ＋ /v/process-wait 共用同一个面板）。
  // 补之前这条路由在 mock 模式下**没有 handler** ⇒ 面板一点就落错误分支。
  // fixture 现算自 mock 自己的定义表，`carrier` 一律 absent —— 那是 mock 世界的真实情况
  // （object-types 里确实没有这些承载类型），**不编造本体**。理由详见 fixture 文件的注释。
  http.get("*/a/v1/process-definitions/:key/inspect", ({ params }) => {
    const body = processInspectFixture(String(params.key));
    if (body === null) {
      return HttpResponse.json(
        { error: { code: "NOT_FOUND", message: `mock 世界没有流程 ${String(params.key)}（fixture 只取了真种子的一个子集）`, requestId: "req_mock_process_inspect" } },
        { status: 404 },
      );
    }
    return HttpResponse.json(body);
  }),
  http.get("*/a/v1/process-definitions", () => HttpResponse.json(PROCESS_DEFINITIONS_RESPONSE)),
  http.get("*/a/v1/ontology/object-types", () =>
    // 图谱体系：与真后端 SEED_DEMO 一致的推演图谱（推演读这些类型），非只 Base。
    // WO-SCHEMA-ZH：properties[].displayName 镜像真后端 PROP_DISPLAY_NAMES（synthetic/battery.ts 单一真值）——
    // mock 只是后端的替身，**不是第二份中文名来源**；真值改了这里跟着改（datacore seam 测试守真值那一侧）。
    // 故意保留若干**无 displayName** 的属性（如 Base.position / Material.devPct），用于验前端诚实回落裸键。
    HttpResponse.json([
      {
        key: "Base", displayName: "生产基地", domain: "factory", status: "ACTIVE",
        sourceBindings: [{ connId: "conn-synth", dataset: "base" }],
        properties: [
          { propKey: "baseId", dataType: "string", isPrimaryKey: true, displayName: "基地编号" },
          { propKey: "name", dataType: "string", isPrimaryKey: false, displayName: "基地名称" },
          { propKey: "util", dataType: "number", isPrimaryKey: false, unit: "%", displayName: "产能利用率" },
          { propKey: "gwh", dataType: "number", isPrimaryKey: false, unit: "GWh", displayName: "铭牌年产能" },
          { propKey: "position", dataType: "enum", isPrimaryKey: false }, // 留白：与 kind 同值，业务语义待确认
        ],
      },
      { key: "Model", displayName: "电池型号", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "model" }], properties: [{ propKey: "modelId", dataType: "string", isPrimaryKey: true, displayName: "型号编号" }, { propKey: "name", dataType: "string", displayName: "型号名称" }, { propKey: "chemistry", dataType: "string" }] },
      { key: "Order", displayName: "销售订单", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "order" }], properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true, displayName: "订单号" }, { propKey: "cust", dataType: "string", displayName: "客户" }, { propKey: "qty", dataType: "number", displayName: "订单数量" }, { propKey: "due", dataType: "date", displayName: "交期" }] },
      { key: "Line", displayName: "产线", domain: "capacity", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "line" }], properties: [{ propKey: "lineNo", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref", refToTypeKey: "Base" }, { propKey: "utilization", dataType: "number", unit: "%" }] },
      { key: "Process", displayName: "工序", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "process" }], properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
      { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "customer" }], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "creditLimit", dataType: "number" }] },
      // Phase 2 产品工程主数据域
      { key: "ProductPlatform", displayName: "产品平台", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_platforms" }], properties: [{ propKey: "platformId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }] },
      { key: "ProductSeries", displayName: "产品系列", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_series" }], properties: [{ propKey: "seriesId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }] },
      { key: "ProductVersion", displayName: "产品版本", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_versions" }], properties: [{ propKey: "versionId", dataType: "string", isPrimaryKey: true }, { propKey: "versionCode", dataType: "string" }, { propKey: "status", dataType: "enum" }] },
      { key: "BOMHeader", displayName: "BOM", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_headers" }], properties: [{ propKey: "bomId", dataType: "string", isPrimaryKey: true }, { propKey: "bomCode", dataType: "string" }, { propKey: "bomLevel", dataType: "number" }] },
      { key: "BOMDetail", displayName: "BOM明细", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_details" }], properties: [{ propKey: "bomDetailId", dataType: "string", isPrimaryKey: true }, { propKey: "sequence", dataType: "number" }, { propKey: "quantity", dataType: "number" }] },
      // 用户原话点名的例子：Material.leadTime → 「到货周期」（真后端 PROP_DISPLAY_NAMES["Material.leadTime"] 同值）。
      // devPct 故意无中文名（口径不明·后端亦留白）→ 界面诚实显裸键 devPct。
      { key: "Material", displayName: "物料", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-erp", dataset: "erp_materials" }], properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true, displayName: "物料标识" }, { propKey: "name", dataType: "string", displayName: "物料名称" }, { propKey: "unitPrice", dataType: "number", displayName: "单价" }, { propKey: "leadTime", dataType: "number", unit: "天", displayName: "到货周期" }, { propKey: "onHand", dataType: "number", displayName: "现货库存" }, { propKey: "devPct", dataType: "number" }] },
      { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-srm", dataset: "srm_suppliers" }], properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "rating", dataType: "enum" }] },
      { key: "MaterialAlternative", displayName: "物料替代", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_material_alts" }], properties: [{ propKey: "altId", dataType: "string", isPrimaryKey: true }, { propKey: "priority", dataType: "number" }, { propKey: "approvalStatus", dataType: "enum" }] },
      { key: "Routing", displayName: "工艺路线", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_routings" }], properties: [{ propKey: "routingId", dataType: "string", isPrimaryKey: true }, { propKey: "routingCode", dataType: "string" }, { propKey: "operationCount", dataType: "number" }] },
      { key: "Operation", displayName: "工序", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_operations" }], properties: [{ propKey: "operationId", dataType: "string", isPrimaryKey: true }, { propKey: "operationName", dataType: "string" }, { propKey: "standardTime", dataType: "number" }] },
      { key: "ProcessCapabilityWindow", displayName: "工艺能力边界", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_process_capabilities" }], properties: [{ propKey: "capabilityId", dataType: "string", isPrimaryKey: true }, { propKey: "parameterName", dataType: "string" }, { propKey: "minValue", dataType: "number" }] },
      { key: "QualityStandard", displayName: "质量标准", domain: "quality", status: "ACTIVE", sourceBindings: [{ connId: "conn-qms", dataset: "qms_standards" }], properties: [{ propKey: "standardId", dataType: "string", isPrimaryKey: true }, { propKey: "itemName", dataType: "string" }, { propKey: "targetValue", dataType: "number" }] },
      { key: "InspectionCharacteristic", displayName: "检验特性", domain: "quality", status: "ACTIVE", sourceBindings: [{ connId: "conn-qms", dataset: "qms_inspection_chars" }], properties: [{ propKey: "charId", dataType: "string", isPrimaryKey: true }, { propKey: "charName", dataType: "string" }, { propKey: "inspectionType", dataType: "enum" }] },
      { key: "ProductLineCapability", displayName: "产品产线能力", domain: "factory", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_line_cap" }], properties: [{ propKey: "capId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxCapacity", dataType: "number" }] },
      { key: "ProductEquipmentCapability", displayName: "产品设备能力", domain: "equip", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_equip_cap" }], properties: [{ propKey: "equipCapId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxSpeed", dataType: "number" }] },
      { key: "EngineeringChange", displayName: "工程变更", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_ecn" }], properties: [{ propKey: "changeId", dataType: "string", isPrimaryKey: true }, { propKey: "changeNumber", dataType: "string" }, { propKey: "changeType", dataType: "enum" }] },
    ]),
  ),

  // ---- 治理增量 §5 对象 360：按键取对象 ----
  http.get("*/a/v1/objects/:type/:id", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const type = String(params.type);
    const idRaw = decodeURIComponent(String(params.id));
    if (type === "Base") {
      const base = filterByScope(BASES, account).find((b) => b.id === idRaw || b.name === idRaw);
      if (!base) return err(404, "NOT_FOUND", "object not found");
      return HttpResponse.json({ data: { id: base.id, type, props: { ...base } }, snapshotVersion: "1.1" });
    }
    if (type === "Order") {
      const o = filterByScope(ORDERS, account).find((x) => x.id === idRaw || x.so === idRaw);
      if (!o) return err(404, "NOT_FOUND", "object not found");
      return HttpResponse.json({ data: { id: o.id, type, props: { ...o } }, snapshotVersion: "1.1" });
    }
    // WO-SCHEMA-ZH：物料实例（对象 360 展示 Material.leadTime 等属性的中文名 + 单位）。
    // 值取真后端合成量级的定值（mock 无随机·与 object-types mock 的属性列对齐）。
    if (type === "Material") {
      const mat = MOCK_MATERIALS.find((m) => m.matId === idRaw);
      if (!mat) return err(404, "NOT_FOUND", "object not found");
      return HttpResponse.json({ data: { id: `obj_${mat.matId}`, type, props: { ...mat } }, snapshotVersion: "1.1" });
    }
    return err(404, "NOT_FOUND", "object not found");
  }),

  // 活数据可溯（PRD-live-traceable-data §3.2）：对象 lineage 反查（mock 返回合成源链路）。
  http.get("*/a/v1/lineage/object/:type/:id", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const type = String(params.type);
    const id = decodeURIComponent(String(params.id));
    return HttpResponse.json({
      object: { id, type, origin: { type: "SYNTHETIC", rawDatasetId: `rds_${type}`, rawRowIdx: 0, sourceConnId: "conn_synth" } },
      source: {
        connection: { id: "conn_synth", name: "合成数据源（确定性生成）", connectorTypeKey: "mock_erp", lastSyncAt: new Date(Date.now() - 5 * 3600_000).toISOString() },
        rawDataset: { id: `rds_${type}`, name: type, rowCount: 20, fields: ["so", "cust", "model", "qty", "due"] },
        rawRowIdx: 0,
        rawRow: { so: id, cust: "客户A", model: "4680-NCM" },
      },
      derivations: type === "Order" ? [{ prop: "value", formula: "value = qty × unitPrice" }] : [],
      snapshotVersion: "1.1",
    });
  }),

  http.get("*/a/v1/ontology/graph", () => HttpResponse.json(GRAPH)),

  // ---- 剩余视图增量：计划域 / 映射表 / 校准 / 数据健康度 ----
  http.get("*/a/v1/plan/aop", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(AOP_RESPONSE);
  }),
  http.get("*/a/v1/plan/quarterly", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const n = Math.min(Number(url.searchParams.get("n") ?? "6") || 6, QUARTERLY_RESPONSE.rows.length);
    return HttpResponse.json({ ...QUARTERLY_RESPONSE, rows: QUARTERLY_RESPONSE.rows.slice(0, n) });
  }),
  http.get("*/a/v1/ontology/mapping/registries", () =>
    HttpResponse.json({
      // ⚠ 方向必须与本体单源一致 —— 这三行不是随手编的示例，是 mock 模式下
      // `MappingOverlay` 唯一的显示来源（`views/graph/MappingOverlay.tsx` 的 linkTypes 消费处）。
      // 欠账 #160：`line_belongs_to_base` 曾写成 `Line→Base`，与本体
      // （`apps/datacore/src/synthetic/battery.ts` 的 `batteryLinkTypes()`：
      //  `fromTypeKey:"Base", toTypeKey:"Line"`）**方向相反** —— 与 #158 是同一个错的两个副本：
      // 「我用『这个 linkKey 的名字读起来像 A 属于 B』当作『它在本体里就是 A→B』的证据」。
      // 名字里的 `belongs_to` 读作 Line→Base，而契约 cardinality 只允许 1:1/1:N/N:N，
      // N:1 语义一律**翻转方向**表达为 1:N ⇒ 真方向是 Base→Line。
      // 已由 `apps/datacore/test/mock-linktype-direction.gate.test.ts` 钉成机械门：
      // 改坏这三行任一方向，机器当场报红，不必等人去发现。
      // （原注释写死 `battery.ts:2321`，收编时实测已漂到 2336 ⇒ 改用符号引用，免得注释自己过期。）
      // ⚠ WO-BEFE-A：下面三行**必须留在此处、必须是对象字面量** ——
      //   `apps/datacore/test/mock-linktype-direction.gate.test.ts:40` 的抽取器按**本文件源码文本**
      //   在本端点路径之后找紧跟的那个数组，把它们换成 `mockLinkTypes.map(...)` 会让它抽出 0 条
      //   → 该门当场报「工具坏了」。（2026-08-14 实测过两次：一次是换成 store 读法，抽取锚点漂到
      //   3568 行的建模草稿夹具；一次是本注释里**照抄了抽取器的搜索串**，锚点落进注释自己 —— 两次都抽出 0 条。
      //   后者尤其值得记：注释里写下工具要找的那个串，就等于给工具埋了个假锚点。）
      //   那是一道本单范围外的 datacore 门，不许碰坏。故此处保持字面量，尾部 `.concat` 追加
      //   本会话新建的边（门只对账「种子三条的方向 vs 真本体」，新建的边不在其射程）。
      //   种子与顶部 `MOCK_LINK_SEED` 的一致性由 `test/ontology-relations.seam.test.tsx` §④
      //   在**运行时**跨两个端点逐 key 对账 —— 人忘了同步，机器先说话。
      linkTypes: [
        { key: "model_producible_at", fromType: "Model", toType: "Base", cardinality: "N:N" },
        { key: "order_for_model", fromType: "Order", toType: "Model", cardinality: "1:1" },
        { key: "line_belongs_to_base", fromType: "Base", toType: "Line", cardinality: "1:N" },
      ].concat(mockLinkTypes.filter((l) => !MOCK_LINK_SEED.some((s) => s.key === l.key)).map((l) => ({ key: l.key, fromType: l.fromType, toType: l.toType, cardinality: l.cardinality }))),
      rules: [
        { key: "C03", expression: "weeklySupply.packsPerWeekP90 >= weeklyDemand", scope: "Order、Base", severity: "阻断" },
        { key: "C06", expression: "kitCoverDays >= 5", scope: "MaterialBalance", severity: "阻断" },
        { key: "C15", expression: "marginPct >= floorPct", scope: "Order", severity: "告警" },
      ],
      actions: [
        { name: "采纳产能保障方案", params: "型号 / 需求量 / 交期 / 调参组合(夜班·通道·外协)", check: "C03 上限校验 · C08 外协红线 · 需含审批人(C10)", target: "生产工单MO（写回）", perm: "发起:规划员 · 审批:生产计划部" },
        { name: "预警处置方案", params: "基地 / 风险对象 / 方案编号 / 起效时间", check: "C06 齐套冻结 · C11 错峰评审", target: "处置工单（写回）+ 风险曲线消解", perm: "发起:基地负责人 · 审批:生产计划部" },
        { name: "调整排产分配", params: "订单 / 基地分配比例 / 生效周", check: "C04 仅认证产线 · C01 产线上限", target: "排产计划（写回）", perm: "发起:计划员 · 审批:基地负责人" },
        { name: "定稿月度计划版本", params: "计划版本号 / 三张评审表快照 / 高管决议", check: "C21 差异已提报 · C18 现金安全垫 · C22 定稿后锁定", target: "月度S&OP版本（定稿+锁定）", perm: "发起:S&OP主持人 · 审批:经营决策会" },
      ],
      events: [
        { name: "检修窗口", window: "每基地年度检修周（如常州第8周）", affects: "设备OEE / 产线负载率 +14", source: "EAM/CMMS 检修计划" },
        { name: "交付高峰", window: "订单交期聚集日 ±3天", affects: "产线负载率 / 人力工时 +9", source: "S&OP 订单交期" },
        { name: "到货间隙", window: "采购批次周期(≈14天)末端", affects: "物料供给齐套 / 物流在途 +10", source: "WMS/ERP 采购批次" },
      ],
    }),
  ),
  http.get("*/a/v1/ontology/mapping", () => HttpResponse.json(MAPPING_ROWS)),
  http.get("*/a/v1/calibration/report", ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json(
      calibrationReportFor({
        objectType: url.searchParams.get("objectType") ?? undefined,
        baseId: url.searchParams.get("baseId") ?? undefined,
        solverKey: url.searchParams.get("solverKey") ?? undefined,
      }),
    );
  }),
  http.get("*/a/v1/calibration/proposals", () => HttpResponse.json(CALIBRATION_PROPOSALS)),
  http.get("*/a/v1/calibration/history", () => HttpResponse.json(CALIBRATION_HISTORY)),
  // 批准/回滚不直改参数：生成「校准参数变更」Action 草稿走 §S2 审批流
  http.post("*/a/v1/calibration/proposals/:id/:decision", ({ params, request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const proposal = CALIBRATION_PROPOSALS.find((p) => p.id === params.id);
    if (!proposal) return err(404, "NOT_FOUND", "提案不存在");
    const decision = String(params.decision);
    if (decision !== "approve" && decision !== "rollback") return err(404, "NOT_FOUND", "not found");
    const draft = {
      id: newId("act"),
      tenantId: TENANT_ID,
      actionTypeKey: "校准参数变更",
      payload: { proposalId: proposal.id, parameter: proposal.parameter, from: proposal.currentValue, to: proposal.proposedValue, decision },
      origin: { userId: `usr-${account.username}` },
      status: "PENDING_APPROVAL" as const,
      approvalSteps: [{ seq: 1, role: "admin" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.actionDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: draft.status }, { status: 201 });
  }),
  // M11 §3 手动「立即校准」：配对 → 元闭环 → 全切片提案生成（catalog_admin）
  http.post("*/a/v1/calibration/run", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    if (!account.roles.some((r) => r === "admin" || r === "catalog_admin")) return err(403, "FORBIDDEN", "catalog_admin only");
    return HttpResponse.json({
      paired: 36,
      deferred: 6,
      staleDeferred: false,
      slicesEvaluated: 3,
      created: 1,
      autoApplied: 0,
      held: 1,
      dropped: 1,
      insufficient: 1,
    });
  }),
  http.get("*/a/v1/data-health", () => HttpResponse.json(DATA_HEALTH)),

  // ---- solver ----
  // C5 求解器目录（只读发现页数据源）：真后端来自 /a/v1/solvers/registry（注册表 feature 过滤）。mock 给代表性子集。
  // 数据源见模块顶部 MOCK_SOLVER_REGISTRY（与 skill 发布引用探针共用同一份，勿在此内联另一份）。
  http.get("*/a/v1/solvers/registry", () => HttpResponse.json({ solvers: MOCK_SOLVER_REGISTRY })),
  /**
   * WO-L7A 求解器**决策问题类目**登记表（`GET /a/v1/solvers/categories`）。
   *
   * 类目定义（label / decisionQuestion / 类目顺序）**直接读契约** `SOLVER_CATEGORY_META`
   * （`packages/contracts/src/solver-taxonomy.ts:49`）—— 与真后端 `apps/datacore/src/app.ts:2844`
   * 读的是同一份常量，不在此另抄一份中文标签（抄了就是"同一事实两份词表"）。
   *
   * 成员 key 是 mock 侧的代表性子集（真后端论域 59 条，mock 的 `MOCK_SOLVER_REGISTRY` 只有 4 条），
   * 故 `total` 报的是 mock 论域大小、`uncategorized` 报 mock 里没归类的那些——
   * **空数组 = 无漏网**，与真后端同口径地诚实亮出，不藏。
   */
  http.get("*/a/v1/solvers/categories", () => {
    // mock 论域内每条求解器归哪一类（判据同契约：按"回答什么决策问题"分，不按算法分）
    const MOCK_CATEGORY_OF: Record<string, string> = {
      capacity_forecast: "capacity_bottleneck",
      bottleneck_matrix: "capacity_bottleneck",
      selection_optimize: "combinatorial_allocation",
      order_fullchain: "order_commitment",
    };
    const allKeys = MOCK_SOLVER_REGISTRY.map((s) => s.key as string);
    return HttpResponse.json({
      categories: SOLVER_CATEGORIES.map((category) => {
        const solverKeys = allKeys.filter((k) => MOCK_CATEGORY_OF[k] === category);
        return {
          category,
          label: SOLVER_CATEGORY_META[category].label,
          decisionQuestion: SOLVER_CATEGORY_META[category].decisionQuestion,
          solverKeys,
          count: solverKeys.length,
        };
      }),
      total: allKeys.length,
      uncategorized: allKeys.filter((k) => MOCK_CATEGORY_OF[k] === undefined),
    });
  }),
  http.post("*/a/v1/solvers/:key/invoke", async ({ params, request }) => {
    const key = String(params.key);
    // WO-CAPSIM-REPLICA 缺口②修（355b8502 同口径）：此前只解构 params 不读 body → 订单聚合基地筛选 base 参恒被忽略、
    // bottleneck_matrix 漏接（chip 空）。改读 body.args → base 真裁剪 + bottleneck 真出（与真后端 /a/v1 invoke 同口径）。
    const invBody = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
    const invArgs = invBody.args ?? {};
    if (key === "risk_timeline") return HttpResponse.json({ data: mockRiskTimeline(invArgs), snapshotVersion: "ov-12" });
    // WO-SCOPE-HONESTY-FE（WO-R1 收编）：齐套/报价的作用域诚实位在 mock 里也真下发，
    // 否则 VITE_MOCK demo 态这两个求解器直接落兜底 404「求解器不存在或未开通」。
    // 解析不到基地/型号 → 400，与真引擎同口径（R-ARG-FIDELITY：绝不静默退回全网 / 全局前 4 种物料）。
    if (key === "kit_readiness") {
      const kr = mockKitReadiness(invArgs);
      if ("__err" in kr) return err(400, "AMBIGUOUS_SCOPE", String(kr.__err));
      return HttpResponse.json({ data: kr, snapshotVersion: "ov-12" });
    }
    if (key === "quote_margin") {
      const qm = mockQuoteMargin(invArgs);
      if ("__err" in qm) return err(400, "AMBIGUOUS_SCOPE", String(qm.__err));
      return HttpResponse.json({ data: qm, snapshotVersion: "ov-12" });
    }
    if (key === "bottleneck_matrix") return HttpResponse.json({ data: mockBottleneckMatrix(invArgs as { baseIds?: string[] }), snapshotVersion: "ov-12" });
    if (key === "schedule_attainment") return HttpResponse.json({ data: { value: 91.4 }, snapshotVersion: "agg-77" });
    if (key === "capacity_forecast")
      return HttpResponse.json({ data: { capWanP50: 21.4, capWanP90: 18.9, unit: "万套/窗口", gap: -1.2, ok: false, healthFactor: 0.93, mainBn: "化成柜", perBaseRows: [], pendingCertList: [] }, snapshotVersion: "ov-12" });
    if (key === "affected_orders") {
      const base = typeof invArgs.base === "string" && invArgs.base !== "" ? invArgs.base : undefined;
      return HttpResponse.json({ data: affectedOrdersOutput(base), snapshotVersion: "ov-12" });
    }
    if (key === "counterfactual_timeline") {
      // base 参数真裁剪（与真后端 counterfactualTimeline 同口径）：缺省 → 峰值最严重基地；指定 → 该基地双轨。
      const base = typeof invArgs.base === "string" && invArgs.base !== "" ? invArgs.base : undefined;
      return HttpResponse.json({ data: mockCounterfactual(base), snapshotVersion: "ov-12" });
    }
    // VITE_MOCK 可见性桩（仅 mock 态·真部署走真 solver）：决策推演页 + 供需双向归因 panel。
    // metricKey 真透传：三种态（有方案 / 方案 0 条有候选 / 全空带理由）在 demo 里都演得到。
    if (key === "decision_play")
      return HttpResponse.json({
        data: mockDecisionPlay(typeof invArgs.metricKey === "string" ? invArgs.metricKey : undefined),
        snapshotVersion: "ov-12",
      });
    if (key === "supply_demand_gap_attribution") return HttpResponse.json({ data: mockSupplyDemandGap(), snapshotVersion: "ov-12" });
    if (key === "mitigation_select")
      // cockpit P3 对症方案优选（与 params.risk.mitigations 同源形状）
      return HttpResponse.json({
        data: {
          factor: "物料齐套", baseName: "常州", urgency: 0.67, recommended: "early_stock",
          plans: [
            { key: "early_stock", name: "提前备料", eff: 12, tn: 2, cost: "中", risk: "低", score: 2.0 },
            { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高", risk: "低", score: 1.5 },
            { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高", risk: "中", score: 0.4 },
          ],
          draftPayload: { base: "常州", factor: "物料齐套", planKey: "early_stock" },
        },
        snapshotVersion: "ov-12",
      });
    if (key === "cockpit_kpi")
      // DS.2 富 KPI（mock：从对象派生的 5 标量确定性示例）。
      // WO-MOCK-SCALE-TRUTH：`supplyV7` = 定稿版 SopVersionRow.supply（万套/年·真后端实测 379，旧值 132）；
      // `aopBaseRev` = 基准情景年营收 = 供给侧年口径 322.2 × P̄ 1.8667（亿元·真后端实测 601.5，旧值 240）。
      return HttpResponse.json({ data: { supplyV7: SUPPLY_V7_WAN, revAttainPct: 102, utilPeak: 88, aopBaseRev: AOP_BASE_REVENUE_YI, cashCushion: 58 }, snapshotVersion: "ov-12" });
    if (key === "metric_rollup") {
      // SPINE.4 经营指标条（mock：op 级 4 指标·物料保障率越线·交付达成率已达成——单一出处 COCKPIT_ROLLUP_METRICS）
      const missCount = COCKPIT_ROLLUP_METRICS.filter((m) => m.miss).length;
      return HttpResponse.json({
        data: {
          metrics: COCKPIT_ROLLUP_METRICS,
          missCount, byLevel: { op: COCKPIT_ROLLUP_METRICS.length }, summary: `${COCKPIT_ROLLUP_METRICS.length} 项指标，${missCount} 项越线`,
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "optimize_whatif") {
      // 优化推演 mock（无 sidecar 态）：facility_location 用**真·小规模暴力枚举**求最优（2^n 设施子集 × 客户就近指派），
      // 基线 vs 扰动后各解一次 → 真 Δ + 真「决策切换」（开哪些设施 / 怎么指派）——让决策比对卡有牙、随任意编辑真变。
      // 镜像后端 opt-whatif.ts：data_override 施加到 args 克隆（DF.8 接地 target=facilities.<id>.openCost 等）。
      // 其余 family 保留形状回放（delta 之和）兜底。真 CP-SAT 可证最优仍须打真 sidecar（services/optimizer·见 DEPLOY.md）。
      const ow = invArgs as {
        family?: string;
        args?: Record<string, unknown>;
        perturbations?: { kind?: string; target?: string; value?: number | string; delta?: number }[];
      };
      const family = ow.family ?? "";
      const perts = Array.isArray(ow.perturbations) ? ow.perturbations : [];

      // data_override 施加到 args 克隆（寻址与后端一致：collection.id.field；arcs 用 from-to 复合 id）。
      const applyPerts = (base: Record<string, unknown>): Record<string, unknown> => {
        const a = JSON.parse(JSON.stringify(base ?? {})) as Record<string, unknown>;
        for (const p of perts) {
          const parts = String(p.target ?? "").split(".");
          if (parts.length < 2) continue;
          const [coll, id, field] = parts;
          const arr = a[coll!] as Record<string, unknown>[] | undefined;
          if (!Array.isArray(arr)) continue;
          const obj = arr.find((e) => (coll === "arcs" ? `${e.from}-${e.to}` === id : String(e.id) === id));
          if (!obj) continue;
          const f = field ?? (coll === "facilities" ? "openCost" : coll === "bids" ? "value" : "cost");
          const v = typeof p.value === "number" ? p.value : Number(p.value);
          if (Number.isFinite(v)) obj[f] = v;
        }
        return a;
      };

      // WO-BEFE-E：这段暴力最优**提到了模块顶层**（`mockSolveFacilityLocation`），
      // 因为 `POST /a/v1/opt/solve` 的桩要用同一份 —— 抄第二份就是第二套真相源。
      const solveFL = mockSolveFacilityLocation;

      if (family === "facility_location" && ow.args) {
        const base = solveFL(ow.args);
        const pert = solveFL(applyPerts(ow.args));
        const feasible = pert != null;
        const baselineObjective = base?.objective ?? null;
        const perturbedObjective = pert?.objective ?? null;
        const deltaObjective =
          baselineObjective != null && perturbedObjective != null ? Math.round((perturbedObjective - baselineObjective) * 1e6) / 1e6 : null;
        const switched = !!base && !!pert && JSON.stringify(base.openFacilities) !== JSON.stringify(pert.openFacilities);
        return HttpResponse.json({
          data: {
            baselineObjective,
            perturbedObjective,
            deltaObjective,
            feasible,
            conflictConstraints: feasible ? [] : ["capacity: 开设总容量 < 总需求（扰动后不可行）"],
            explanation: feasible
              ? `基线开 ${base?.openFacilities.join("/")}（成本 ${baselineObjective}）→ 扰动后开 ${pert?.openFacilities.join("/")}（成本 ${perturbedObjective}·Δ=${deltaObjective}）${switched ? "·最优决策切换" : "·决策不变"}`
              : "扰动后不可行：开设总容量不足以覆盖总需求",
            optimal: true,
            status: feasible ? "OPTIMAL" : "INFEASIBLE",
            baselineSolution: base ? { openFacilities: base.openFacilities, assignments: base.assignments, objective: base.objective, optimal: true } : undefined,
            perturbedSolution: pert ? { openFacilities: pert.openFacilities, assignments: pert.assignments, objective: pert.objective, optimal: true } : undefined,
            summary: "optimize_whatif mock（facility_location 真暴力最优·决策比对有牙）",
          },
          snapshotVersion: "ov-12",
        });
      }

      // 其余 family：形状回放（delta 之和·渲染/兜底测试用·真解须打 sidecar）。
      const deltaSum = perts.reduce((s, p) => s + (typeof p.delta === "number" ? p.delta : 0), 0);
      const baseline = 100;
      const perturbed = baseline + deltaSum;
      const feasible = deltaSum < 500;
      return HttpResponse.json({
        data: {
          baselineObjective: baseline,
          perturbedObjective: perturbed,
          deltaObjective: perturbed - baseline,
          feasible,
          conflictConstraints: feasible ? [] : [`capacity(${family || "?"}) 扰动超限 ${deltaSum}`],
          explanation: `family=${family || "?"}：基线 ${baseline} → 扰动后 ${perturbed}（Δ=${perturbed - baseline}·${feasible ? "可行" : "不可行"}）`,
          optimal: true,
          status: "OPTIMAL",
          summary: "optimize_whatif mock（Δ 随扰动真变·渲染测试用）",
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "plan_rootcause")
      // cockpit P2 根因归因 DAG（mock：物料保障率越线 → 现货缺口 → 取证叶）
      return HttpResponse.json({
        data: {
          kpis: [{ kpiId: "kpi-material", name: "物料保障率", category: "material", actual: 77, target: 100, gap: 23, offTarget: true, status: "RED" }],
          dag: {
            nodes: [
              { id: "kpi:kpi-material", kind: "kpi", label: "物料保障率", status: "RED", actual: 77, target: 100, value: 23, unit: "%" },
              { id: "ksf:ksf-kit", kind: "ksf", label: "物料齐套", sub: "长协与现货缺口" },
              { id: "factor:rc-material-gap", kind: "factor", label: "现货缺口扩大", value: 4200, share: 1 },
              { id: "leaf:rc-material-gap:三元正极", kind: "evidence", label: "三元正极", value: 2600 },
              { id: "leaf:rc-material-gap:隔膜", kind: "evidence", label: "隔膜", value: 1600 },
            ],
            edges: [
              { from: "kpi:kpi-material", to: "ksf:ksf-kit", weight: 1, kind: "kpi_ksf" },
              { from: "ksf:ksf-kit", to: "factor:rc-material-gap", weight: 1, kind: "ksf_factor" },
              { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:三元正极", weight: 0.62, kind: "factor_evidence" },
              { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:隔膜", weight: 0.38, kind: "factor_evidence" },
            ],
          },
          offTargetCount: 1, summary: "1 项 KPI 越线", ruleRefs: [],
        },
        snapshotVersion: "ov-12",
      });
    if (key === "gap_attribution") {
      // #9 已达成指标（actual≥target）→ 镜像真 solver 零缺口短路（service.ts:1279）：noGap=true·levels 空·诚实不编因果链。
      // 前端据 noGap 走「达成·无缺口」正向框 + 仅渲该指标结构根（gapAttributionToDag 产 GREEN KPI 根·非空树）。
      const wantKey = typeof invArgs.metricKey === "string" && invArgs.metricKey !== "" ? invArgs.metricKey : undefined;
      const selMetric = wantKey ? COCKPIT_ROLLUP_METRICS.find((m) => m.key === wantKey || m.metricId === wantKey) : undefined;
      if (selMetric && selMetric.actual >= selMetric.target) {
        const gap = Math.round((selMetric.target - selMetric.actual) * 10) / 10; // ≤0
        return HttpResponse.json({
          data: {
            rootMetric: { key: selMetric.key, name: selMetric.name, unit: selMetric.unit, target: selMetric.target, actual: selMetric.actual, gap },
            totalGap: gap, noGap: true, levels: [], atomicLeaves: [], causalEdges: [], reconChecks: [], reconciled: true, residualPct: 0,
            severityKind: "info", summary: `目标「${selMetric.name}」已达成（actual ${selMetric.actual} ≥ target ${selMetric.target}），无需归因。`,
          },
          snapshotVersion: "ov-12",
        });
      }
      // WO-COCKPIT-INFER gap_attribution（CEO-2 深度反向归因·多跳 caused_by 因果树·mock 同后端形状）：
      // 储能达成率越线 → 结构分摊 + caused_by 逐跳（上游减供→长协违约→矿价→地缘→决策 / 备份薄→认证周期）→ 终点根因 + 下钻真值叶。
      //
      // ⚠ WO-FACTOR-SCOPE-SINGLESOURCE（本段的形状是**病灶的直接对策**）：修前本桩
      //   ① **完全忽略 `scope.factorId`**（7 个 chip 返回逐字节相同的载荷），
      //   ② 且**不回 `scope` 字段** ⇒ 前端判据 `factorApplied !== false` 恒真
      //      ⇒ mock 模式下一律显示「已按因子细分」——**比真后端更糟**（真后端至少诚实说了"未细分"）。
      // 现在桩与真后端同形状：下发 `scope.availableFactors`（chip 候选单源）、按 factorId 真细分、
      // 不在册的 factorId 诚实回 `factorApplied:false`。桩的取值随入参真变（KILL-MOCK·非写死示意）。
      {
        const gaScope = (invArgs.scope ?? {}) as { baseId?: string; factorId?: string };
        // 可细分因子集（与 datacore 种子 CAPACITY_CAUSAL_FACTORS 同 id/同 label·mock 只取能演示的三个）。
        const availableFactors = [
          { factorId: "cf-cap-bottleneck-process", label: "瓶颈工序", drillType: "Line", drillField: "utilization", objectCount: 10 },
          { factorId: "cf-cap-equipment-oee", label: "设备OEE", drillType: "Equipment", drillField: "oee_current", objectCount: 60 },
          { factorId: "cf-cap-yield-variance", label: "良率波动", drillType: "Process", drillField: "yield_baseline", objectCount: 50 },
        ];
        const wantFactor = typeof gaScope.factorId === "string" && gaScope.factorId !== "" ? gaScope.factorId : undefined;
        const hit = availableFactors.find((f) => f.factorId === wantFactor);
        const baseKey = gaScope.baseId ?? "changzhou";
        // 细分节点：每个因子给**不同**的对象节点（改 factorId → 树真变·非写死）。与因果链节点同处 depth 3
        // （前端 `levels.find(depth===3)` 只取第一层 ⇒ 必须并到同一层，不能各起一层）。
        const refineNodes = hit
          ? [
              { id: `capfactor:${hit.factorId}`, factor: `${hit.label}（本基地 ${hit.drillType}.${hit.drillField}）`, contribution: 3.1, unit: "%", share: 0.34,
                path: ["m1", `base:${baseKey}`, `capfactor:${hit.factorId}`],
                provenance: { kind: "实测", drillType: hit.drillType, drillId: `MOCK-${hit.factorId}-1`, drillField: hit.drillField, drillValue: 0.87 } },
              { id: `capobj:${hit.factorId}:MOCK-1`, factor: `MOCK-${hit.factorId}-1 · ${hit.drillField}=0.87`, contribution: 1.8, unit: "%", share: 0.58,
                path: ["m1", `base:${baseKey}`, `capfactor:${hit.factorId}`, `capobj:${hit.factorId}:MOCK-1`],
                provenance: { kind: "实测", drillType: hit.drillType, drillId: `MOCK-${hit.factorId}-1`, drillField: hit.drillField, drillValue: 0.87 } },
            ]
          : [];
        const scopeOut = {
          baseId: baseKey,
          availableFactors,
          ...(wantFactor
            ? (hit
                ? { factorId: hit.factorId, factorLabel: hit.label, factorApplied: true }
                : { factorId: wantFactor, factorApplied: false, factorNote: `因子「${wantFactor}」无对应 CausalFactor 因果域（按基地聚合返回·未按该因子细分）` })
            : {}),
        };
      return HttpResponse.json({
        data: {
          rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
          totalGap: 27.8,
          scope: scopeOut,
          levels: [
            { depth: 1, label: "基地", nodes: [{ id: `base:${baseKey}`, factor: "基地 常州", contribution: 9.2, unit: "%" }], residual: 2.1 },
            { depth: 2, label: "订单/瓶颈", nodes: [{ id: "material:cathode", factor: "正极物料短缺", contribution: 6.1, unit: "%" }], residual: 1.0 },
            {
              depth: 3, label: "因果链（caused_by）", residual: 0.7,
              nodes: [
                { id: "cf:cf-upstream-cut", factor: "上游减供", contribution: 2.4, unit: "%", share: 0.44, provenance: { drillType: "Supplier", drillField: "actualSupplyTon", drillValue: 820 } },
                { id: "cf:cf-lta-breach", factor: "长协违约", contribution: 1.2, unit: "%", share: 0.22, provenance: { drillType: "LongTermAgreement", drillField: "actualDeliveredTon", drillValue: 1500 } },
                { id: "cf:cf-ore-price", factor: "锂价上涨", contribution: 0.6, unit: "%", share: 0.11, provenance: { drillType: "CommodityPriceTrend", drillField: "pctChange", drillValue: 14.29 } },
                { id: "cf:cf-geopolitical", factor: "地缘冲突推升矿价", contribution: 0.4, unit: "%", share: 0.07, provenance: { drillType: "ExternalSignal", drillField: "value", drillValue: 96000 } },
                { id: "cf:cf-decision-gap", factor: "价格预判缺失(root)", contribution: 0.3, unit: "%", share: 0.05, provenance: { drillType: "DecisionGap", drillField: "severity", drillValue: 0.8 } },
                { id: "cf:cf-backup-thin", factor: "备份池不足", contribution: 0.5, unit: "%", share: 0.09, provenance: { drillType: "BackupSupplierPool", drillField: "memberCount", drillValue: 2 } },
                { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4, unit: "%", share: 0.07, provenance: { drillType: "BackupSupplierPool", drillField: "certWeeks", drillValue: 16 } },
                ...refineNodes,
              ],
            },
          ],
          causalEdges: [
            { from: "cf-cathode-shortage", to: "cf-upstream-cut", viaLinkKey: "caused_by" },
            { from: "cf-upstream-cut", to: "cf-lta-breach", viaLinkKey: "caused_by" },
            { from: "cf-lta-breach", to: "cf-ore-price", viaLinkKey: "caused_by" },
            { from: "cf-ore-price", to: "cf-geopolitical", viaLinkKey: "caused_by" },
            { from: "cf-geopolitical", to: "cf-decision-gap", viaLinkKey: "caused_by" },
            { from: "cf-upstream-cut", to: "cf-backup-thin", viaLinkKey: "caused_by" },
            { from: "cf-backup-thin", to: "cf-cert-cycle", viaLinkKey: "caused_by" },
          ],
          atomicLeaves: [
            { id: "cf:cf-decision-gap", factor: "价格预判缺失(root)", contribution: 0.3, unit: "%", share: 0.05 },
            { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4, unit: "%", share: 0.07 },
          ],
          reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%：沿 caused_by 溯到决策/地缘终点根因",
        },
        snapshotVersion: "ov-12",
      });
      }
    }
    if (key === "generic_inference") {
      // WO-PROJECT-SIM-WHATIF：杠杆发现 mode:levers（杠杆随⑤瓶颈变·服务端算敏感度）。
      if (String(invArgs.mode) === "levers") return HttpResponse.json({ data: mockLeverDiscovery(invArgs), snapshotVersion: "ov-lv" });
      // 通用 what-if（G-5）确定性桩：包装本体 recompute(dryRun+apply) 的形状 —— 前向重算下游派生链，
      // after 随假设值变（KILL-MOCK：前端仅投影本响应，改假设值→重算→deltas 变）。空 apply → 400（不静默）。
      const apply = Array.isArray(invArgs.apply)
        ? (invArgs.apply as { objectType?: unknown; objectId?: unknown; prop?: unknown; value?: unknown }[])
        : [];
      if (apply.length === 0) return err(400, "VALIDATION", "generic_inference 需 apply:[{objectType,objectId,prop,value}]（假设值）");
      const a0 = apply[0]!;
      const objType = String(a0.objectType ?? "");
      const objId = String(a0.objectId ?? "");
      const v = Number(a0.value);
      const vnum = Number.isFinite(v) ? v : 1;
      // 下游派生：自身派生字段 capacity_h（∝ 假设值）+ 上游聚合 capacity（前向传播）。确定性、随假设值变。
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const deltas = [
        { objId, type: objType, prop: "capacity_h", before: 100, after: round2(100 * vnum) },
        { objId: `parent-of-${objId}`, type: "Line", prop: "capacity", before: 1000, after: round2(900 + 100 * vnum) },
      ];
      const rows = deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after }));
      const affected = new Set(deltas.map((d) => d.objId)).size;
      return HttpResponse.json({
        data: { deltas, rows, affectedObjects: affected, count: deltas.length, rootTypes: [...new Set(apply.map((x) => String(x.objectType ?? "")))] },
        snapshotVersion: "ov-gi",
      });
    }
    // 净室归因三通用求解器（前端 CleanroomAttrView 接地）：mock 出结构性真值供 VITE_MOCK 浏览；
    // 测试用 server.use 覆盖精确 payload。输出形状与 datacore solvers/service.ts 一字不差。
    if (key === "shared_bottleneck") {
      const rt = String(invArgs.resourceType ?? "Res");
      const st = String(invArgs.sharedByType ?? "Sharer");
      return HttpResponse.json({
        data: {
          bottlenecks: [{ resourceType: rt, resourceId: `${rt}-01`, capacity: 100, demand: 138, sharerCount: 3 }],
          contention: [{ resourceId: `${rt}-01`, sharers: [`${st}-a`, `${st}-b`, `${st}-c`] }],
          downgraded: [{ resourceId: `${rt}-01`, sharedByType: st, objectId: `${st}-c`, reason: "需求最小" }],
          summary: `1 个共享瓶颈,3 张单争用,1 张被降级`,
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "concentration_risk") {
      const path = Array.isArray(invArgs.path) ? (invArgs.path as { toType: string }[]) : [];
      const rootType = path[path.length - 1]?.toType ?? "Root";
      const top = { rootType, rootId: `${rootType}-hub`, dependents: ["s-01", "s-02", "s-03"], count: 3 };
      return HttpResponse.json({
        data: { concentrations: [top, { rootType, rootId: `${rootType}-b`, dependents: ["s-04", "s-05"], count: 2 }], topExposure: top, summary: `2 个隐性集中单点（${rootType}）,最大敞口 3 个依赖方` },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "margin_attribution") {
      const tt = String(invArgs.targetType ?? "Item");
      const cfs = Array.isArray(invArgs.costFields) ? (invArgs.costFields as { field: string; label?: string }[]) : [];
      const driver = cfs[0]?.label ?? cfs[0]?.field ?? "成本项";
      return HttpResponse.json({
        data: {
          inverted: [{ id: `${tt}-9`, revenue: 100, totalCost: 128, margin: -28, marginRate: -0.28, topDriver: { label: driver, value: 80, share: 0.625 }, attribution: [{ label: driver, value: 80, share: 0.625 }] }],
          rootDrivers: [{ label: driver, invertedCount: 1, totalValue: 80 }],
          invertedCount: 1,
          summary: `1 个目标毛利倒挂；根因主驱动 ${driver}（拉穿 1 个）`,
        },
        snapshotVersion: "ov-12",
      });
    }
    return err(404, "FEATURE_NOT_FOUND", "求解器不存在或未开通");
  }),

  // A18.4 求解器审核台：列临时求解器制品 / 看代码 / 晋升 GOVERNED（mock 同源）。
  http.get("*/a/v1/solvers/artifacts", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const list = status ? MOCK_SOLVER_ARTIFACTS.filter((a) => a.status === status) : MOCK_SOLVER_ARTIFACTS;
    return HttpResponse.json({ artifacts: list });
  }),
  http.get("*/a/v1/solvers/:key/artifact", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const art = MOCK_SOLVER_ARTIFACTS.find((a) => a.key === String(params.key));
    return art ? HttpResponse.json(art) : err(404, "NOT_FOUND", "solver artifact");
  }),
  http.post("*/a/v1/solvers/:key/promote", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const art = MOCK_SOLVER_ARTIFACTS.find((a) => a.key === String(params.key));
    if (!art) return err(404, "NOT_FOUND", "solver artifact");
    art.status = "GOVERNED";
    art.trustLevel = "VERIFIED";
    return HttpResponse.json(art);
  }),
  /**
   * WO-BEFE-E · 生成临时求解器（datacore app.ts:3574）。
   *
   * ⚠ 真后端这一步**要调 LLM**（`generateProvisionalSolver` 未注入 LLM 直接 400）。
   * mock 态不假装有 LLM：产物的 `computeSource` 明写是占位、`rationale` 明写「mock 态未调 LLM」，
   * 免得有人拿 mock 跑一遍就以为生成链路已验（本仓纪律：画出来的假线路图比空白更危险）。
   * 状态机照抄后端：新件一律 `PROVISIONAL` + `trustLevel:UNVERIFIED`（R4 下游闸未解）。
   */
  http.post("*/a/v1/solvers/generate", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const b = (await request.json().catch(() => ({}))) as { key?: string; intent?: string };
    if (!b.key || !b.intent) return err(400, "VALIDATION_ERROR", "key + intent required");
    if (MOCK_SOLVER_ARTIFACTS.some((a) => a.key === b.key)) return err(409, "INVALID_STATE", `求解器 ${b.key} 已存在临时件`);
    const art = {
      id: `sart_mock_${MOCK_SOLVER_ARTIFACTS.length + 1}`, tenantId: "demo", key: b.key, version: 1,
      status: "PROVISIONAL" as const, origin: "LLM_GENERATED" as const, trustLevel: "UNVERIFIED" as const,
      computeSource: `// mock 态占位：真后端此处是 LLM 生成并冻结的纯函数源码\n// intent: ${b.intent}\nexport function compute() { return {}; }`,
      rationale: `mock 态**未调 LLM**（真链路需配 comprehend provider）——此文本为占位，不可据此认为生成链路已验。intent: ${b.intent}`,
      hash: `mockhash${String(MOCK_SOLVER_ARTIFACTS.length + 1).padStart(8, "0")}`,
      outputShape: [], createdBy: "admin", createdAt: "2026-08-14T00:00:00.000Z",
    };
    MOCK_SOLVER_ARTIFACTS.push(art as unknown as (typeof MOCK_SOLVER_ARTIFACTS)[number]);
    return HttpResponse.json(art, { status: 201 });
  }),
  /**
   * WO-BEFE-E · 求解器影响面反查（agentcore server.ts:1270）。
   * 复用同文件的 `ruleReferences` 同款形状；`via` 说的是"经哪条路引用的"，不是装饰。
   */
  http.get("*/b/v1/solvers/:key/references", ({ params }) => {
    const key = String((params as { key: string }).key);
    // 与 db 里真实存在的工作流/意图对账：谁的步骤里写了这个 solverKey，谁就算引用（与后端 computeReferences 同判据）。
    const references = [
      ...db.workflows
        .filter((w) => w.steps.some((s) => s.type === "invoke_solver" && s.params.solverKey === key))
        .map((w) => ({ kind: "workflow", key: w.id, name: w.name, via: "steps[].invoke_solver.solverKey" })),
      ...db.plans
        .filter((p) => p.steps.some((s) => (s as { type?: string; params?: { solverKey?: string } }).type === "invoke_solver" && (s as { params?: { solverKey?: string } }).params?.solverKey === key))
        .map((p) => ({ kind: "plan", key: p.key, name: p.key, via: "steps[].invoke_solver.solverKey" })),
    ];
    return HttpResponse.json({ references, count: references.length });
  }),
  /**
   * WO-BEFE-E · 字段角色确定性解析（datacore app.ts:3609）。
   *
   * ⚠ 只有这 4 个通用图求解器在后端 `SOLVER_FIELD_ROLES`（`solvers/field-roles.ts:31`）里声明了角色，
   * 其余**必须**回空 roles —— 桩若给每个 key 都编一份角色，「这个求解器不吃角色」这一支就永远测不到。
   */
  http.get("*/a/v1/solvers/:key/field-roles", ({ params }) => {
    const key = String((params as { key: string }).key);
    const DECLARED: Record<string, Record<string, string>> = {
      supplier_disruption_radius: { rootType: "Supplier" },
      concentration_risk: { rootType: "Supplier", sinkType: "Order" },
      shared_bottleneck: { resourceType: "Line", sharedByType: "Order", priorityField: "priority" },
      margin_attribution: { targetType: "Order", revenueField: "revenue" },
    };
    const roles = DECLARED[key] ?? {};
    const candidates: Record<string, { value: string; score: number; signals: string[] }[]> = {};
    for (const [role, v] of Object.entries(roles)) candidates[role] = [{ value: v, score: 3, signals: ["lexicon", "fanIn"] }];
    return HttpResponse.json({
      solverKey: key, roles, candidates,
      confidence: Object.keys(roles).length > 0 ? 1 : 0,
      ambiguous: false,
    });
  }),

  // ---- 增量 §7.10：规划体检基线（当前定稿 S&OP 版本 → plan_audit 输入字段集） ----
  http.get("*/a/v1/plan-versions/current", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(PLAN_VERSION_CURRENT);
  }),

  // ---- S&OP 月度版本（五步法状态机；FINAL → 409 PLAN_LOCKED） ----
  http.get("*/a/v1/sop/versions", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json([...db.sopVersions].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)));
  }),
  http.post("*/a/v1/sop/versions", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as { month: string; inputs?: Record<string, unknown> };
    if (!/^\d{4}-\d{2}$/.test(body.month ?? "")) return err(422, "VALIDATION_ERROR", "month must be YYYY-MM");
    const now = new Date().toISOString();
    const version = {
      id: newId("sop"),
      month: body.month,
      status: "DRAFT" as const,
      inputs: body.inputs ?? {},
      steps: {},
      agenda: [],
      resolutions: [],
      createdAt: now,
      updatedAt: now,
    };
    db.sopVersions.unshift(version);
    return HttpResponse.json(version, { status: 201 });
  }),
  http.get("*/a/v1/sop/versions/:id", ({ params }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    return v ? HttpResponse.json(v) : err(404, "NOT_FOUND", "sop version 不存在");
  }),
  http.patch("*/a/v1/sop/versions/:id", async ({ params, request }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    if (v.status === "FINAL") {
      const e = sopPlanLocked();
      return err(e.status, e.code, e.message);
    }
    const fields = (await request.json()) as Record<string, unknown>;
    v.inputs = { ...v.inputs, ...fields };
    v.updatedAt = new Date().toISOString();
    return HttpResponse.json(v);
  }),
  http.post("*/a/v1/sop/versions/:id/advance", async ({ params, request }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    const body = (await request.json()) as { step: number; payload?: Record<string, unknown> };
    try {
      return HttpResponse.json(mockSopAdvance(v, body.step, body.payload ?? {}));
    } catch (e) {
      if (e instanceof SopMockError) return err(e.status, e.code, e.message);
      throw e;
    }
  }),
  http.post("*/a/v1/sop/versions/:id/finalize", ({ params }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    if (v.status === "FINAL") {
      const e = sopPlanLocked();
      return err(e.status, e.code, e.message);
    }
    if (v.status !== "EXEC_MEETING") return err(409, "INVALID_STATE", `cannot finalize from ${v.status}（先执行第⑤步）`);
    v.status = "FINAL";
    v.updatedAt = new Date().toISOString();
    return HttpResponse.json(v);
  }),

  // ---- 时序聚合查询（A8.4，无任何参数组合可返回原始行） ----
  http.post("*/a/v1/timeseries/agg-query", () => HttpResponse.json({ points: TS_AGG_POINTS })),

  // ---- 连接器 ----
  http.get("*/a/v1/connector-types", () => HttpResponse.json(CONNECTOR_TYPES)),
  http.get("*/a/v1/connections", () => HttpResponse.json(db.connections)),
  http.put("*/a/v1/connections/:id/validation-policy", async ({ request, params }) => {
    const body = (await request.json()) as { policy?: unknown };
    const conn = db.connections.find((c) => c.id === (params as { id: string }).id);
    if (!conn) return new HttpResponse(null, { status: 404 });
    (conn as { validationPolicy?: unknown }).validationPolicy = body.policy ?? body;
    return HttpResponse.json(conn);
  }),
  http.post("*/a/v1/connections/test", async ({ request }) => {
    const body = (await request.json()) as { config: Record<string, unknown> };
    const ok = Boolean(Object.values(body.config ?? {}).some((v) => v !== "" && v != null));
    return HttpResponse.json(ok ? { ok: true } : { ok: false, message: "配置为空" });
  }),
  http.post("*/a/v1/connections", async ({ request }) => {
    const body = (await request.json()) as { connectorTypeKey: string; name: string; config: Record<string, unknown>; category?: string };
    // A11：缺省取连接器类型 category（mock 默认 ERP），显式传则覆盖、可自定义。
    const typeCat: Record<string, string> = { mock_erp: "ERP", mock_crm: "CRM", file_upload: "FILE", rest_api: "EXTERNAL", knowledge_base: "KB" };
    const conn = { id: newId("conn"), tenantId: TENANT_ID, connectorTypeKey: body.connectorTypeKey, name: body.name, config: {}, status: "ACTIVE" as const, category: body.category?.trim() || typeCat[body.connectorTypeKey] || "EXTERNAL" };
    db.connections.push(conn);
    return HttpResponse.json(conn, { status: 201 });
  }),
  http.get("*/a/v1/connector-categories", () => {
    const used = db.connections.map((c) => (c as { category?: string }).category).filter((v): v is string => !!v);
    return HttpResponse.json({ categories: [...new Set(["ERP", "CRM", "EXTERNAL", "KB", "FILE", ...used])].sort() });
  }),
  http.post("*/a/v1/connections/:id/sync", () => {
    const id = newId("sync");
    db.syncJobPolls.set(id, 0);
    return HttpResponse.json({ syncJobId: id }, { status: 202 });
  }),
  http.get("*/a/v1/sync-jobs/:id", ({ params }) => {
    const id = String(params.id);
    const polls = (db.syncJobPolls.get(id) ?? 0) + 1;
    db.syncJobPolls.set(id, polls);
    const status = polls < 3 ? "RUNNING" : "SUCCEEDED";
    return HttpResponse.json({ id, connId: "conn-erp", status, rowCounts: status === "SUCCEEDED" ? { orders: 20, plants: 12 } : { orders: Math.min(polls * 7, 20) } });
  }),
  http.get("*/a/v1/connections/:id/schema", () =>
    HttpResponse.json({
      datasets: [
        {
          name: "orders.csv",
          kind: "ENTITY",
          fields: [
            { name: "so_no", inferredType: "string", samples: ["SO-10001", "SO-10002"], nullRate: 0, uniqueRate: 1 },
            { name: "customer", inferredType: "string", samples: ["蔚途汽车"], nullRate: 0.02, uniqueRate: 0.2, enumCandidates: ["蔚途汽车", "星河储能", "极光新能源"] },
            { name: "qty", inferredType: "number", samples: [1500, 820], nullRate: 0, uniqueRate: 0.9 },
            { name: "due_date", inferredType: "date", samples: ["2026-06-20"], nullRate: 0.05, uniqueRate: 0.7 },
          ],
        },
        {
          name: "oee_points.csv",
          kind: "TIMESERIES",
          timeField: "ts",
          entityRefField: "equip_no",
          fields: [
            { name: "equip_no", inferredType: "string", samples: ["CZ-07"], nullRate: 0, uniqueRate: 0.01 },
            { name: "ts", inferredType: "date", samples: ["2026-06-01T08:00:00Z"], nullRate: 0, uniqueRate: 0.98 },
            { name: "oee", inferredType: "number", samples: [0.86], nullRate: 0.01, uniqueRate: 0.9 },
          ],
        },
      ],
    }),
  ),
  http.post("*/a/v1/uploads", () => HttpResponse.json({ connId: "conn-upload-1", datasetName: "orders.csv" }, { status: 201 })),

  // ---- 规则文档 ----
  http.get("*/a/v1/rule-docs", () => HttpResponse.json(db.ruleDocs)),
  http.get("*/a/v1/rule-docs/:id", ({ params }) => {
    const d = db.ruleDocs.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "文档不存在");
  }),
  // 上传（multipart）→ 202 抽取作业（与 DataCore /a/v1/rule-docs 响应形态一致）
  http.post("*/a/v1/rule-docs", async ({ request }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const filename = file instanceof File ? file.name : "上传文档.md";
    const docId = newId("doc");
    // redline-allow：上传制度文档的**原文**，有意与现行红线不同（演示"抽取出的候选需人工裁决"）。
    const seg = { idx: 0, heading: "一、生产约束", text: "单基地外协比例不得超过 25%，超出需提交风险评估。", spanStart: 0, spanEnd: 40 };
    db.ruleDocs.unshift({ id: docId, filename, status: "IN_REVIEW", createdAt: new Date().toISOString(), segments: [seg] });
    db.candidates.push({
      id: newId("cand"), docId, segmentIdx: 0, span: { start: 0, end: 20 },
      // 演示"候选 ≠ 现行规则、需人工裁决"：若改成派生现行值，A2 审批演示就没有可裁的差异了。
      // redline-allow：**上传制度文档抽出的待审批候选**，有意与现行红线不同（这正是要给人裁的那个差异）。
      candidate: { name: "外协比例红线", description: "外协比例不得超过 25%", expression: "Outsource.ratio <= 0.25", expressionConfidence: 0.86, scopeObjectTypes: ["QualityLot"], severity: "WARN", sourceQuote: "单基地外协比例不得超过 25%" },
      status: "PENDING", diff: "新增",
    });
    return HttpResponse.json({ docId, jobId: newId("xjob"), status: "IN_REVIEW", candidateCount: 1 }, { status: 202 });
  }),
  http.get("*/a/v1/rule-docs/:id/candidates", ({ params }) =>
    HttpResponse.json(db.candidates.filter((c) => c.docId === params.id)),
  ),
  http.post("*/a/v1/rule-candidates/:id/review", async ({ params, request }) => {
    const body = (await request.json()) as { action: string; patch?: Record<string, unknown> };
    const cand = db.candidates.find((c) => c.id === params.id);
    if (!cand) return err(404, "NOT_FOUND", "候选不存在");
    cand.status = body.action === "REJECT" ? "REJECTED" : "APPROVED";
    if (body.action === "EDIT_APPROVE" && body.patch) Object.assign(cand.candidate, body.patch);
    return HttpResponse.json(cand);
  }),

  http.get("*/a/v1/rules", () => HttpResponse.json(db.rules)),

  // ---- 管理平台增量 §5：规则手工管理（编辑器 + dry-run） ----
  http.post("*/a/v1/rules/dry-run", async ({ request }) => {
    const { expression, samplePayload } = (await request.json()) as { expression: string; samplePayload: Record<string, unknown> };
    // 简易 mock：非法符号 → 定位字符位；合法简单比较式 → 即时求值
    for (const badToken of ["@@", ">>", "=="]) {
      if (badToken === "==" ? false : expression.includes(badToken)) {
        return HttpResponse.json({ ok: false, error: { message: "expected comparison operator", position: expression.indexOf(badToken) } });
      }
    }
    if (/[>＜<]\s*$/.test(expression) || expression.trim() === "") {
      return HttpResponse.json({ ok: false, error: { message: "unexpected end of expression", position: expression.length } });
    }
    const m = /^\s*(\w+)\.(\w+)\s*(>=|<=|>|<)\s*([\d.]+)\s*$/.exec(expression);
    if (m) {
      const obj = samplePayload[m[1]!] as Record<string, unknown> | undefined;
      const left = Number(obj?.[m[2]!] ?? NaN);
      const right = Number(m[4]);
      const violated =
        m[3] === ">" ? left > right : m[3] === ">=" ? left >= right : m[3] === "<" ? left < right : left <= right;
      return HttpResponse.json({ ok: true, violated, passed: !violated, explanation: violated ? "命中违规条件" : "未命中" });
    }
    // 规则即引用 §4：裸标识符比较（key OP number）—— 命名阈值由编辑器并入载荷顶层，按 key 解析求值。
    const b = /^\s*(\w+)\s*(>=|<=|>|<)\s*([\d.]+)\s*$/.exec(expression);
    if (b) {
      const left = Number(samplePayload[b[1]!] ?? NaN);
      const right = Number(b[3]);
      const violated =
        b[2] === ">" ? left > right : b[2] === ">=" ? left >= right : b[2] === "<" ? left < right : left <= right;
      return HttpResponse.json({ ok: true, violated, passed: !violated, explanation: violated ? "命中违规条件" : "未命中" });
    }
    return HttpResponse.json({ ok: true, violated: false, passed: true, explanation: "未命中" });
  }),

  http.post("*/a/v1/rules", async ({ request }) => {
    // 规则即引用 §2.2/§4：params（命名阈值）随 create 透传（与真后端一致），mock 原样回存。
    const body = (await request.json()) as { key: string; name: string; expression: string; scopeObjectTypes: string[]; severity: "BLOCK" | "WARN" | "INFO"; params?: Record<string, number> };
    if (body.expression.includes("@@")) {
      return err(400, "VALIDATION_ERROR", `表达式语法错误（位置 ${body.expression.indexOf("@@")}）：expected comparison operator`);
    }
    const rule = { id: newId("rule"), ...body, params: body.params ?? {}, origin: { type: "MANUAL" as const }, version: 1, status: "DRAFT" as const };
    db.rules.unshift(rule);
    return HttpResponse.json(rule, { status: 201 });
  }),

  http.put("*/a/v1/rules/:id", async ({ params, request }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    if (rule.status !== "DRAFT") return err(409, "IMMUTABLE_VERSION", "仅 DRAFT 状态的规则可修改");
    Object.assign(rule, (await request.json()) as Record<string, unknown>);
    return HttpResponse.json(rule);
  }),

  // 引用模式增量 §2.3：publish 响应附影响面 impact + warnings（契约 PublishImpact 形态）
  http.post("*/a/v1/rules/:id/publish", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    rule.status = "PUBLISHED";
    const refs = ruleReferences(rule.key);
    return HttpResponse.json({
      ...rule,
      impact: {
        agents: refs.filter((r) => r.kind === "agent").length,
        plans: refs.filter((r) => r.kind === "plan" || r.kind === "workflow").length,
        intents: refs.filter((r) => r.kind === "intent").length,
        refs: refs.map((r) => ({ kind: r.kind, key: r.key, version: "latest", name: r.name })),
      },
      warnings: [],
    });
  }),

  http.get("*/a/v1/rules/:id/references", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    const references = ruleReferences(rule.key);
    return HttpResponse.json({ references, count: references.length });
  }),

  /* ── WO-REFERENCES-FAMILY · 引用反查族的其余各条 ────────────────────────────
   * B 侧这 5 条在后端是**同一个函数**在答（`apps/agentcore/src/resources.ts:186`
   * `computeReferences`，按 `kind` 分支）。mock 照抄它的判据（谁的哪个字段指向我），
   * **不是**编一段好看的假数据 —— 判据抄歪了，接缝测试验的就不是真链路。
   * ⚠ 形状按后端原样：B 侧条目的标识字段是 `id`（不是 `key`），A 侧 rules 才是 `key`。
   *   这个差异是真的，前端 `fetchReferences` 那一层做归一。
   */
  // agent：场景入口 / 场景的 defaultAgentId + workflow 的 invoke_agent 步骤
  http.get("*/b/v1/agents/:id/references", ({ params }) => {
    const id = String((params as { id: string }).id);
    if (!db.agents.some((a) => a.id === id)) return err(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    const references = [
      ...db.scenes.filter((s) => s.defaultAgentId === id).map((s) => ({ kind: "scene-entry", id: s.id, name: s.viewKey, via: "defaultAgentId" })),
      ...db.scenarios.filter((sc) => sc.defaultAgentId === id).map((sc) => ({ kind: "scenario", id: sc.id, name: `${sc.scenarioKey}·${sc.name}`, via: "scenario.defaultAgentId" })),
      ...db.workflows
        .filter((w) => w.steps.some((st) => st.type === "invoke_agent" && (st.params as { agentId?: string }).agentId === id))
        .map((w) => ({ kind: "workflow", id: w.id, name: w.name, via: "steps.invoke_agent" })),
    ];
    return HttpResponse.json({ references, count: references.length });
  }),
  // workflow：被哪些 Agent 当 WORKFLOW 工具挂着
  http.get("*/b/v1/workflows/:id/references", ({ params }) => {
    const id = String((params as { id: string }).id);
    if (!db.workflows.some((w) => w.id === id)) return err(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const references = db.agents
      .filter((a) => (a.tools ?? []).some((t) => t.kind === "WORKFLOW" && t.workflowId === id))
      .map((a) => ({ kind: "agent", id: a.id, name: a.name, via: "tools[kind=WORKFLOW]" }));
    return HttpResponse.json({ references, count: references.length });
  }),
  // skill：被哪些 Agent 挂着
  http.get("*/b/v1/skills/:id/references", ({ params }) => {
    const id = String((params as { id: string }).id);
    if (!db.skills.some((s) => s.id === id)) return err(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const references = db.agents
      .filter((a) => (a.skills ?? []).some((s) => s.skillId === id))
      .map((a) => ({ kind: "agent", id: a.id, name: a.name, via: "skills" }));
    return HttpResponse.json({ references, count: references.length });
  }),
  // mcp-config：Agent 的 mcpServers / MCP 工具 + workflow 的 invoke_mcp_tool
  http.get("*/b/v1/mcp-configs/:id/references", ({ params }) => {
    const id = String((params as { id: string }).id);
    if (!db.mcpConfigs.some((c) => c.id === id)) return err(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const references = [
      ...db.agents
        .filter((a) => (a.mcpServers ?? []).some((m) => m.mcpConfigId === id) || (a.tools ?? []).some((t) => t.kind === "MCP" && t.mcpConfigId === id))
        .map((a) => ({ kind: "agent", id: a.id, name: a.name, via: "mcpServers/tools[kind=MCP]" })),
      ...db.workflows
        .filter((w) => w.steps.some((st) => st.type === "invoke_mcp_tool" && (st.params as { mcpConfigId?: string }).mcpConfigId === id))
        .map((w) => ({ kind: "workflow", id: w.id, name: w.name, via: "steps.invoke_mcp_tool" })),
    ];
    return HttpResponse.json({ references, count: references.length });
  }),
  // rule（**B 侧**）：编排资源的规则绑定。与上面 A 侧 `/a/v1/rules/:id/references` 是两套事实源，
  // 也吃两种入参（A 吃 rule.id、B 吃 rule.key）—— 后端签名如此，mock 照抄，不许统一掉。
  http.get("*/b/v1/rules/:key/references", ({ params }) => {
    const key = String((params as { key: string }).key);
    const hasKey = (v: unknown): boolean => v === "ALL_APPLICABLE" || (Array.isArray(v) && v.includes(key));
    const references = [
      ...db.agents.filter((a) => hasKey(a.ruleBindings?.ruleKeys)).map((a) => ({
        kind: "agent", id: a.id, name: a.name,
        via: a.ruleBindings?.ruleKeys === "ALL_APPLICABLE" ? "ruleBindings=ALL_APPLICABLE" : "ruleBindings.ruleKeys",
      })),
      ...db.scenarios.filter((sc) => (sc.rules ?? []).includes(key)).map((sc) => ({ kind: "scenario", id: sc.id, name: `${sc.scenarioKey}·${sc.name}`, via: "scenario.rules" })),
      ...db.workflows
        .filter((w) => w.steps.some((st) => st.type === "evaluate_rules" && hasKey((st.params as { ruleIds?: unknown }).ruleIds)))
        .map((w) => ({ kind: "workflow", id: w.id, name: w.name, via: "steps.evaluate_rules" })),
    ];
    return HttpResponse.json({ references, count: references.length });
  }),
  // slice（A 侧）：形状是 `{refs, total}`（`refKind/key/version/where`），与上面各条**都不同** ——
  // 后端 `ontology-governance.ts:351 sliceReferences` 读的是 B→A 上报登记表。mock 照抄形状。
  http.get("*/a/v1/ontology/slices/:key/references", ({ params }) => {
    const key = String((params as { key: string }).key);
    const refs = db.workflows
      .filter((w) => w.steps.some((st) => st.type === "resolve_slice" && (st.params as { sliceKey?: string }).sliceKey === key))
      .map((w) => ({ refKind: "plan", key: w.key ?? w.id, version: "latest" as const, where: "reportedRefs" }));
    return HttpResponse.json({ refs, total: refs.length });
  }),
  // external-signal（A 侧）：因果因子反查，形状再不同一层（factors + causalEdges + 指标归因）。
  // `metricLinkage: "pending"` 是后端的**诚实位**（归因未种时不编），mock 保留它 ——
  // 抹平成 "bound" 就等于替后端撒谎。
  http.get("*/a/v1/external-signals/:key/references", ({ params }) => {
    const key = String((params as { key: string }).key);
    const FACTORS: Record<string, { factorId: string; label: string; drillField: string; isRoot: boolean }[]> = {
      li_carbonate_price: [
        { factorId: "cf_material_cost", label: "正极材料成本上行", drillField: "value", isRoot: true },
        { factorId: "cf_margin_squeeze", label: "毛利承压", drillField: "value", isRoot: false },
      ],
      usd_cny: [{ factorId: "cf_export_fx", label: "出口结汇收益变动", drillField: "value", isRoot: true }],
    };
    const factors = (FACTORS[key] ?? []).map((f) => ({ ...f, drillValue: 0, provenanceSynthetic: true, boundMetricKeys: [] as string[] }));
    return HttpResponse.json({
      signalKey: key,
      name: key,
      category: "",
      factors,
      causalEdges: [],
      metricsAffected: [],
      hasReferences: factors.length > 0,
      metricLinkage: "pending",
      ...(factors.length === 0 ? { note: "本信号暂无因果因子引用（未进任何根因树·诚实空）" } : {}),
    });
  }),

  // ---- LLM Provider 配置体系增量 §1（/admin/llm-providers 页消费形态） ----
  http.get("*/a/v1/llm-providers", () => HttpResponse.json(db.llmProviders)),
  http.post("*/a/v1/llm-providers", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const { apiKey, ...rest } = body;
    const provider = {
      id: newId("llmp"),
      tenantId: TENANT_ID,
      status: "ACTIVE",
      models: [],
      ...rest,
      hasApiKey: Boolean(apiKey), // write-only：明文永不回显
    } as unknown as (typeof db.llmProviders)[number];
    db.llmProviders.unshift(provider);
    return HttpResponse.json(provider, { status: 201 });
  }),
  http.put("*/a/v1/llm-providers/:id", async ({ params, request }) => {
    const p = db.llmProviders.find((x) => x.id === params.id);
    if (!p) return err(404, "NOT_FOUND", "provider not found");
    const body = (await request.json()) as Record<string, unknown>;
    const { apiKey, ...rest } = body;
    Object.assign(p, rest);
    if (apiKey !== undefined) (p as { hasApiKey?: boolean }).hasApiKey = Boolean(apiKey);
    return HttpResponse.json(p);
  }),
  http.post("*/a/v1/llm-providers/:id/test", ({ params }) => {
    const p = db.llmProviders.find((x) => x.id === params.id);
    if (!p) return err(404, "NOT_FOUND", "provider not found");
    if (p.kind === "custom_http") return HttpResponse.json({ ok: false, message: "custom_http 适配器为预留接口" });
    return HttpResponse.json({ ok: true, latencyMs: 42, probedModels: p.models.map((m) => m.modelId) });
  }),
  http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: db.llmBindings })),
  http.put("*/a/v1/llm-bindings", async ({ request }) => {
    const { bindings } = (await request.json()) as { bindings: { purpose: string; providerId: string; modelId: string }[] };
    const warnings: { purpose: string; message: string }[] = [];
    for (const b of bindings) {
      const p = db.llmProviders.find((x) => x.id === b.providerId);
      const m = p?.models.find((x) => x.modelId === b.modelId);
      if (!p || !m) return err(400, "VALIDATION_ERROR", `provider/model 不存在：${b.providerId}/${b.modelId}`);
      if (b.purpose === "agent" && !m.capabilities.tools) {
        return err(400, "VALIDATION_ERROR", `绑定被拒：用途「agent」要求 tools 能力，${p.name}/${b.modelId} 缺失能力：tools`);
      }
      if (["classifier", "extraction", "modeling", "template_gen"].includes(b.purpose) && !m.capabilities.structuredOutput) {
        warnings.push({ purpose: b.purpose, message: `${p.name}/${b.modelId} 无原生 structuredOutput —— 运行期 JSON-mode 降级` });
      }
    }
    db.llmBindings = bindings as typeof db.llmBindings;
    return HttpResponse.json({ bindings, warnings });
  }),

  // ---- WO-BEFE-F · OC7 LLM 成本配额（GET/PUT /a/v1/llm-budgets）--------------------------------
  // `budgetStatus()` 与 `apps/datacore/src/app.ts:1269-1274` 逐行同构：hard=0 ⇒ 恒 OK（不限）。
  // ⚠ `POST /a/v1/llm-budgets/record` **故意不建 mock**：它是 AgentCore 的服务间记账入口，
  //   前端不该有调用方；建了 mock 就等于给一条不该存在的路铺了砖（见本单分诊表 (2) 类）。
  // ---- WO-BEFE-F · DRIL 智能资源（`/b/v1/resources*`）--------------------------------------------
  // 详情路由必须注册在 `/search` **之后**：msw 按注册序匹配，`:kind/:key` 会把 `search` 吃掉。
  http.get("*/b/v1/resources", ({ request }) => {
    const kind = new URL(request.url).searchParams.get("kind");
    const items = DRIL_RESOURCES.filter((r) => !kind || r.kind === kind).map(({ detail: _d, ...rest }) => rest);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post("*/b/v1/resources/search", async ({ request }) => {
    const body = (await request.json()) as { query?: string };
    const q = (body.query ?? "").trim();
    const results = DRIL_RESOURCES.filter((r) => !q || r.label.includes(q) || r.description.includes(q)).map(
      ({ detail: _d, ...rest }, i) => ({
        resource: rest,
        score: Number((0.9 - i * 0.1).toFixed(3)),
        scoreBreakdown: { semantic: 0.5, domain: 0.2, ontology: 0.1, history: 0.05, cost: 0.02 },
        explanation: `${rest.label} 命中五级标签与语义。`,
      }),
    );
    return HttpResponse.json({ results, explanation: q ? `据五级标签+语义命中：共 ${results.length} 条。` : "空查询。" });
  }),
  http.get("*/b/v1/resources/:kind/:key/relations", ({ params }) => {
    const r = DRIL_RESOURCES.find((x) => x.kind === params.kind && x.key === params.key);
    if (!r) return err(404, "RESOURCE_NOT_FOUND", `resource not found: ${params.kind}/${params.key}`);
    return HttpResponse.json({
      resource: { kind: r.kind, key: r.key },
      relations: [{ relType: "reads", toKind: "field", toKey: "Model" }],
      inbound: [{ fromKind: "workflow", fromKey: "wf-capacity", relType: "invokes" }],
    });
  }),
  http.get("*/b/v1/resources/:kind/:key/quality", ({ params }) => {
    const r = DRIL_RESOURCES.find((x) => x.kind === params.kind && x.key === params.key);
    if (!r) return err(404, "RESOURCE_NOT_FOUND", `resource not found: ${params.kind}/${params.key}`);
    return HttpResponse.json({
      kind: r.kind,
      key: r.key,
      quality: r.detail.quality ? { ...r.detail.quality, lastProbeAt: "2026-07-25T00:00:00Z" } : null,
    });
  }),
  // 单资源详情：比列表多 capability / 正负向问句 / 质量叠加（真后端 overlayQuality 的 mock 对应物）。
  http.get("*/b/v1/resources/:kind/:key", ({ params }) => {
    const r = DRIL_RESOURCES.find((x) => x.kind === params.kind && x.key === params.key);
    if (!r) return err(404, "RESOURCE_NOT_FOUND", `resource not found: ${params.kind}/${params.key}`);
    const { detail, ...rest } = r;
    return HttpResponse.json({ ...rest, ...detail });
  }),

  http.get("*/a/v1/llm-budgets", () => HttpResponse.json(mockBudgetStatus())),
  http.put("*/a/v1/llm-budgets", async ({ request }) => {
    const body = (await request.json()) as { hardLimitTokens?: number; softLimitPct?: number };
    if (typeof body.hardLimitTokens !== "number" || body.hardLimitTokens < 0 || !Number.isInteger(body.hardLimitTokens)) {
      return err(400, "VALIDATION_ERROR", "hardLimitTokens 须为 ≥0 整数");
    }
    db.llmBudget.hardLimitTokens = body.hardLimitTokens;
    if (typeof body.softLimitPct === "number") db.llmBudget.softLimitPct = body.softLimitPct;
    return HttpResponse.json(mockBudgetStatus());
  }),

  // ---- WO-BEFE-F · S4 知识库（POST /a/v1/kb/search · /a/v1/kb/:connId/docs · /a/v1/kb/:connId/sync）----
  // 检索用**确定性**词元重合打分（非随机、非嵌入）：同 query 同库必得同序，符合本仓「确定性种子」纪律。
  http.post("*/a/v1/kb/search", async ({ request }) => {
    const body = (await request.json()) as { query?: string; topK?: number; connId?: string };
    const q = (body.query ?? "").trim();
    if (!q) return err(400, "VALIDATION_ERROR", "query required");
    const topK = Math.min(10, Math.max(1, body.topK ?? 5));
    const terms = [...q];
    const hits = db.kbDocs
      .filter((d) => !body.connId || d.connId === body.connId)
      .map((d) => {
        const overlap = terms.filter((t) => t.trim() && d.text.includes(t)).length;
        return {
          text: d.text.slice(0, 160),
          score: terms.length ? Number((overlap / terms.length).toFixed(4)) : 0,
          docId: d.id,
          span: { start: 0, end: Math.min(160, d.text.length) },
          source: "KB_CHUNK" as const,
          connId: d.connId,
        };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => (b.score === a.score ? a.docId.localeCompare(b.docId) : b.score - a.score))
      .slice(0, topK);
    return HttpResponse.json({ hits });
  }),
  http.post("*/a/v1/kb/:connId/docs", async ({ params, request }) => {
    const connId = String(params.connId);
    const conn = db.connections.find((c) => c.id === connId);
    if (!conn) return err(404, "NOT_FOUND", "connection not found");
    if (conn.connectorTypeKey !== "knowledge_base") {
      return err(400, "VALIDATION_ERROR", `connection ${connId} is not a knowledge_base connector`);
    }
    const body = (await request.json()) as { filename?: string; contentBase64?: string };
    if (!body.filename || !body.contentBase64) return err(400, "VALIDATION_ERROR", "filename/contentBase64 required");
    // ⚠ `atob()` 返回的是 **latin-1 二进制串**，不是 UTF-8 文本 —— 直接用它，中文全变乱码，
    // 于是「上传了中文文档 → 搜中文搜不到」。（本单接缝测试当场把这条抖出来：检索恒零命中。）
    // 必须先还原字节再按 UTF-8 解码。
    const bytes = Uint8Array.from(atob(body.contentBase64), (ch) => ch.charCodeAt(0));
    const text = new TextDecoder("utf-8").decode(bytes);
    // 真后端切块 ~512 token/块（`chunkText`）；mock 取 512 字符，只为「块数随文长变」是真的。
    const chunkCount = Math.max(1, Math.ceil(text.length / 512));
    const doc = { id: newId("kbdoc"), connId, filename: body.filename, chunkCount, text };
    db.kbDocs.push(doc);
    return HttpResponse.json({ docId: doc.id, chunkCount }, { status: 201 });
  }),
  http.post("*/a/v1/kb/:connId/sync", ({ params }) => {
    const connId = String(params.connId);
    const conn = db.connections.find((c) => c.id === connId);
    if (!conn) return err(404, "NOT_FOUND", "connection not found");
    if (conn.connectorTypeKey !== "knowledge_base") {
      return err(400, "VALIDATION_ERROR", `connection ${connId} is not a knowledge_base connector`);
    }
    const docs = db.kbDocs.filter((d) => d.connId === connId);
    return HttpResponse.json(
      { docs: docs.length, chunks: docs.reduce((n, d) => n + d.chunkCount, 0) },
      { status: 202 },
    );
  }),

  http.post("*/a/v1/rules/:id/retire", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    rule.status = "RETIRED";
    return HttpResponse.json(rule);
  }),

  // ---- 管理平台增量 §2：租户与用户 ----
  http.get("*/a/v1/tenants", ({ request }) => {
    const account = auth(request);
    if (!account?.roles.includes("platform_admin")) return err(403, "FORBIDDEN", "platform_admin only");
    return HttpResponse.json(db.tenants);
  }),

  http.post("*/a/v1/tenants", async ({ request }) => {
    const account = auth(request);
    if (!account?.roles.includes("platform_admin")) return err(403, "FORBIDDEN", "platform_admin only");
    const body = (await request.json()) as { key: string; name: string; industry?: string };
    if (db.tenants.some((t) => t.id === body.key)) return err(409, "TENANT_EXISTS", `租户已存在：${body.key}`);
    const tenant = { id: body.key, key: body.key, name: body.name, industry: body.industry, status: "ACTIVE" as const, createdAt: new Date().toISOString() };
    db.tenants.push(tenant);
    return HttpResponse.json(tenant, { status: 201 });
  }),

  http.get("*/a/v1/tenants/:id/users", () => HttpResponse.json(db.adminUsers)),

  http.post("*/a/v1/tenants/:id/users", async ({ request, params }) => {
    const body = (await request.json()) as { email: string; displayName?: string; roles: string[]; attributes?: Record<string, unknown> };
    if (db.adminUsers.some((u) => u.email === body.email)) return err(409, "USER_EXISTS", `邮箱已存在：${body.email}`);
    const user = {
      id: newId("usr"), tenantId: String(params.id), username: body.email, email: body.email,
      displayName: body.displayName ?? body.email.split("@")[0]!, roles: body.roles,
      attributes: body.attributes ?? {}, status: "ACTIVE" as const,
    };
    db.adminUsers.push(user);
    return HttpResponse.json({ ...user, initialPassword: "init-pass-9x" }, { status: 201 });
  }),

  http.patch("*/a/v1/tenants/:id/users/:userId", async ({ request, params }) => {
    const account = auth(request);
    const user = db.adminUsers.find((u) => u.id === params.userId);
    if (!user) return err(404, "NOT_FOUND", "user not found");
    const body = (await request.json()) as { displayName?: string; roles?: string[]; attributes?: Record<string, unknown>; status?: "ACTIVE" | "DISABLED" };
    // 自我保护：不能改自己的角色/状态
    if (account && user.username === account.username && (body.roles !== undefined || body.status !== undefined)) {
      return err(403, "FORBIDDEN", "不能修改自己账号的角色/状态");
    }
    // LAST_ADMIN：最后一个 ACTIVE tenant_admin 不可禁用/降权
    const isActiveAdmin = user.roles.some((r) => r.split(":")[0] === "tenant_admin") && user.status === "ACTIVE";
    const loses = isActiveAdmin && (body.status === "DISABLED" || (body.roles !== undefined && !body.roles.some((r) => r.split(":")[0] === "tenant_admin")));
    if (loses) {
      const others = db.adminUsers.filter((u) => u.id !== user.id && u.status === "ACTIVE" && u.roles.some((r) => r.split(":")[0] === "tenant_admin"));
      if (others.length === 0) return err(409, "LAST_ADMIN", "最后一个 ACTIVE 的 tenant_admin 不可禁用/降权");
    }
    Object.assign(user, body);
    return HttpResponse.json(user);
  }),

  http.post("*/a/v1/users/:id/reset-password", () =>
    HttpResponse.json({ password: "new-pass-123", note: "TODO: 邮件下发一次性重置链接（本期直接返回新密码）" }),
  ),

  http.get("*/a/v1/roles", () => HttpResponse.json(ROLES_RESPONSE)),

  // ---- 管理平台增量 §3：视图配置 ----
  http.get("*/a/v1/view-configs", () => HttpResponse.json({ items: db.adminViews, configVersion: db.configVersion })),

  http.post("*/a/v1/view-configs", async ({ request }) => {
    const body = (await request.json()) as (typeof db.adminViews)[number];
    if (db.adminViews.some((v) => v.viewKey === body.viewKey)) return err(409, "VIEWKEY_EXISTS", `viewKey 已存在：${body.viewKey}`);
    db.configVersion += 1;
    const created = { ...body, featureKey: `view.${body.viewKey}`, featureOn: true };
    db.adminViews.push(created);
    return HttpResponse.json({ ...created, configVersion: db.configVersion }, { status: 201 });
  }),

  http.put("*/a/v1/view-configs/:viewKey", async ({ params, request }) => {
    const view = db.adminViews.find((v) => v.viewKey === params.viewKey);
    if (!view) return err(404, "NOT_FOUND", "view config not found");
    const body = (await request.json()) as Partial<(typeof db.adminViews)[number]>;
    Object.assign(view, body, { viewKey: view.viewKey });
    db.configVersion += 1;
    return HttpResponse.json({ ...view, configVersion: db.configVersion });
  }),

  http.delete("*/a/v1/view-configs/:viewKey", ({ params, request }) => {
    const url = new URL(request.url);
    const view = db.adminViews.find((v) => v.viewKey === params.viewKey);
    if (!view) return err(404, "NOT_FOUND", "view config not found");
    const references = {
      feature: view.featureKey ?? null,
      roles: view.roles,
      sceneEntryViewKey: view.viewKey,
      intentsHint: `B 侧意图 enabledViews 含 "${String(params.viewKey)}" 的条目将失去入口`,
    };
    if (url.searchParams.get("confirm") !== "1") {
      return HttpResponse.json({ deleted: false, requiresConfirm: true, references });
    }
    db.adminViews = db.adminViews.filter((v) => v.viewKey !== params.viewKey);
    db.configVersion += 1;
    return HttpResponse.json({ deleted: true, references });
  }),

  // ---- 管理平台增量 §3：场景包 ----
  http.get("*/a/v1/scenario-packages", () =>
    HttpResponse.json([
      { id: PACKAGE_ID, tenantId: TENANT_ID, name: "电池制造场景包", fromTemplate: "battery-manufacturing", views: ["dash", "graph", "risk", "order"], toolWhitelist: [], modelOverrides: {}, thresholds: {}, createdAt: "2026-01-05T08:00:00Z", updatedAt: "2026-06-01T08:00:00Z" },
    ]),
  ),
  http.get("*/a/v1/policies", () => HttpResponse.json(POLICIES)),
  // C6/C11 评审返工：策略↔role 编辑器写回 mock（POST /a/v1/policies）。
  http.post("*/a/v1/policies", async ({ request }) => {
    const body = (await request.json()) as { resource: { kind: string; key: string }; grants: unknown[]; rowFilter?: string };
    const policy = { id: `pol_${POLICIES.length + 1}`, tenantId: "demo", ...body };
    POLICIES.push(policy as (typeof POLICIES)[number]);
    return HttpResponse.json(policy, { status: 201 });
  }),
  http.post("*/a/v1/authz/explain", async ({ request }) => {
    const body = (await request.json()) as { user?: { roles: string[] }; resource: { kind: string; key: string }; op: string };
    const roles = (body.user?.roles ?? []).map((r) => r.split(":")[0]);
    const matched = POLICIES.filter((p) => p.resource.kind === body.resource.kind && p.resource.key === body.resource.key);
    const allowed = matched.some((p) => p.grants.some((g) => roles.includes(g.role) && g.ops.includes(body.op as "READ")));
    const rowFilter = roles.includes("base_manager") ? `${body.resource.key}.bases IN ['常州']` : null;
    return HttpResponse.json({
      allowed,
      matched: matched.map((p) => ({ policyId: p.id, resource: `${p.resource.kind}:${p.resource.key}`, grants: p.grants.map((g) => `${g.role}:${g.ops.join("/")}`).join(", ") })),
      rowFilter,
    });
  }),

  // ---- 建模 ----
  // 原始数据集（A3 suggest 入口的可选项；与连接器同步/上传产物对应）。
  // Agent F · 数据源面板 additive：sourceConnId 指向真实 db.connections（分组/provenance 解析），
  // name 对齐草案 objectType.sourceDataset（orders.csv/plants.csv）使覆盖度可演示；
  // syncedAt/sourceCategory/rowCount 供新鲜度与来源类标签（值确定性、非业务常数）。
  http.get("*/a/v1/raw-datasets", () =>
    HttpResponse.json([
      { id: "rds-orders", name: "orders.csv", sourceConnId: "conn-erp", rowCount: 1280, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-plants", name: "plants.csv", sourceConnId: "conn-erp", rowCount: 6, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-oee", name: "oee_points", sourceConnId: "conn-iot", rowCount: 9600, syncedAt: "2026-06-12T01:00:00Z", sourceCategory: "EXTERNAL" },
      // Phase 2 产品工程主数据：PLM / MES / QMS / SRM 原始数据集
      { id: "rds-platforms", name: "plm_platforms", sourceConnId: "conn-plm", rowCount: 3, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-series", name: "plm_series", sourceConnId: "conn-plm", rowCount: 6, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-models", name: "plm_models", sourceConnId: "conn-plm", rowCount: 6, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-versions", name: "plm_versions", sourceConnId: "conn-plm", rowCount: 18, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-bom-headers", name: "plm_bom_headers", sourceConnId: "conn-plm", rowCount: 18, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-bom-details", name: "plm_bom_details", sourceConnId: "conn-plm", rowCount: 250, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-material-alts", name: "plm_material_alts", sourceConnId: "conn-plm", rowCount: 5, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-ecn", name: "plm_ecn", sourceConnId: "conn-plm", rowCount: 12, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-materials", name: "erp_materials", sourceConnId: "conn-erp", rowCount: 8, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-suppliers", name: "srm_suppliers", sourceConnId: "conn-srm", rowCount: 14, syncedAt: "2026-06-11T23:00:00Z", sourceCategory: "SRM" },
      { id: "rds-routings", name: "mes_routings", sourceConnId: "conn-mes", rowCount: 18, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-operations", name: "mes_operations", sourceConnId: "conn-mes", rowCount: 180, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-process-caps", name: "mes_process_capabilities", sourceConnId: "conn-mes", rowCount: 50, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-product-line-cap", name: "mes_product_line_cap", sourceConnId: "conn-mes", rowCount: 40, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-product-equip-cap", name: "mes_product_equip_cap", sourceConnId: "conn-mes", rowCount: 250, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-quality-standards", name: "qms_standards", sourceConnId: "conn-qms", rowCount: 40, syncedAt: "2026-06-12T01:30:00Z", sourceCategory: "QMS" },
      { id: "rds-inspection-chars", name: "qms_inspection_chars", sourceConnId: "conn-qms", rowCount: 100, syncedAt: "2026-06-12T01:30:00Z", sourceCategory: "QMS" },
    ]),
  ),
  // 数据源节点行数据 + 在线编辑（A7 增量）
  http.get("*/a/v1/raw-datasets/:id/rows", ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json({ dataset: { id, name: "orders" }, rows: MOCK_RAW_ROWS[id] ?? MOCK_RAW_ROWS.default! });
  }),
  http.patch("*/a/v1/raw-datasets/:id/rows/:idx", async ({ params, request }) => {
    const id = String(params.id);
    const idx = Number(params.idx);
    const patch = (await request.json()) as Record<string, unknown>;
    const rows = (MOCK_RAW_ROWS[id] ??= structuredClone(MOCK_RAW_ROWS.default!));
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) return err(404, "NOT_FOUND", "row 不存在");
    rows[idx] = { ...(rows[idx] ?? {}), ...patch, _editedAt: new Date().toISOString() };
    return HttpResponse.json({ ok: true, idx, row: rows[idx] });
  }),
  http.post("*/a/v1/modeling/suggest", async ({ request }) => {
    const body = (await request.json()) as { rawDatasetIds?: string[] };
    if (!body.rawDatasetIds?.length) return err(422, "VALIDATION_ERROR", "rawDatasetIds 不能为空");
    const draft = structuredClone(db.modelingDrafts[0]!);
    draft.id = newId("draft");
    draft.status = "DRAFT";
    draft.rawDatasetIds = body.rawDatasetIds;
    delete draft.publishErrors;
    db.modelingDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: draft.status }, { status: 202 });
  }),
  // 外部域（EXT_SIG）：环境信号清单 + 敏感性（确定性弹性）。
  http.get("*/a/v1/external-signals", () => {
    const signals = [
      { signalKey: "ev_demand_index", name: "新能源车需求指数", category: "需求", value: 112.4, unit: "index(2025=100)", asOf: "2026-06-01", source: "乘联会", trend: "up", impact: "需求", elasticity: 0.6 },
      { signalKey: "ess_subsidy_signal", name: "储能补贴政策强度", category: "政策", value: 0.72, unit: "0–1", asOf: "2026-06-10", source: "发改委公告解析", trend: "up", impact: "需求", elasticity: 0.25 },
      { signalKey: "li_carbonate_price", name: "电池级碳酸锂价", category: "原料价格", value: 96000, unit: "元/吨", asOf: "2026-06-15", source: "上海有色网", trend: "down", impact: "毛利", elasticity: -0.08 },
      { signalKey: "nickel_price", name: "镍价(LME)", category: "原料价格", value: 18600, unit: "USD/吨", asOf: "2026-06-15", source: "LME", trend: "flat", impact: "毛利", elasticity: -0.03 },
      { signalKey: "usd_cny", name: "美元兑人民币", category: "汇率", value: 7.18, unit: "CNY/USD", asOf: "2026-06-15", source: "中国外汇交易中心", trend: "up", impact: "出口营收", elasticity: 0.9 },
      { signalKey: "industrial_power_price", name: "工业电价", category: "能源", value: 0.78, unit: "元/kWh", asOf: "2026-06-01", source: "国网", trend: "flat", impact: "成本", elasticity: 0.12 },
    ];
    return HttpResponse.json({ signals, total: signals.length });
  }),
  http.get("*/a/v1/external-signals/:key/series", ({ params }) => {
    const key = String(params.key);
    const vals: Record<string, { v: number; t: string; u: string }> = {
      li_carbonate_price: { v: 96000, t: "down", u: "元/吨" }, ev_demand_index: { v: 112.4, t: "up", u: "index" },
      usd_cny: { v: 7.18, t: "up", u: "CNY/USD" }, nickel_price: { v: 18600, t: "flat", u: "USD/吨" },
      ess_subsidy_signal: { v: 0.72, t: "up", u: "0–1" }, industrial_power_price: { v: 0.78, t: "flat", u: "元/kWh" },
    };
    const s = vals[key] ?? { v: 100, t: "flat", u: "" };
    const slope = s.t === "up" ? 0.018 : s.t === "down" ? -0.018 : 0;
    const points = Array.from({ length: 12 }, (_, idx) => {
      const i = 11 - idx;
      const drift = s.v / Math.pow(1 + slope, i);
      const wobble = 1 + 0.006 * Math.sin((i + key.length) * 1.3);
      const d = new Date("2026-06-01T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() - i);
      return { month: d.toISOString().slice(0, 7), value: Math.round(drift * wobble * 1000) / 1000 };
    });
    return HttpResponse.json({ signalKey: key, unit: s.u, trend: s.t, points });
  }),
  http.post("*/a/v1/external-signals/sensitivity", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { shocks?: { signalKey?: string; deltaPct?: number }[] };
    const elas: Record<string, { impact: string; e: number }> = {
      ev_demand_index: { impact: "需求", e: 0.6 }, ess_subsidy_signal: { impact: "需求", e: 0.25 },
      li_carbonate_price: { impact: "毛利", e: -0.08 }, nickel_price: { impact: "毛利", e: -0.03 },
      usd_cny: { impact: "出口营收", e: 0.9 }, industrial_power_price: { impact: "成本", e: 0.12 },
    };
    const byMetric = new Map<string, { metric: string; deltaPct: number; drivers: { signalKey: string; deltaPct: number; contributionPp: number }[] }>();
    const unknownSignals: string[] = [];
    for (const s of body.shocks ?? []) {
      const sig = s.signalKey ? elas[s.signalKey] : undefined;
      if (!sig) { if (s.signalKey) unknownSignals.push(s.signalKey); continue; }
      const contributionPp = Math.round(Number(s.deltaPct ?? 0) * sig.e * 100) / 100;
      const m = byMetric.get(sig.impact) ?? { metric: sig.impact, deltaPct: 0, drivers: [] };
      m.deltaPct = Math.round((m.deltaPct + contributionPp) * 100) / 100;
      m.drivers.push({ signalKey: s.signalKey!, deltaPct: Number(s.deltaPct ?? 0), contributionPp });
      byMetric.set(sig.impact, m);
    }
    return HttpResponse.json({ impacts: [...byMetric.values()].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)), unknownSignals });
  }),

  // A3 确定性建模（无 LLM·字段全建模 100% 覆盖）：每个数据集字段→一个属性。
  http.post("*/a/v1/modeling/derive", async ({ request }) => {
    const body = (await request.json()) as { rawDatasetIds?: string[] };
    if (!body.rawDatasetIds?.length) return err(422, "VALIDATION_ERROR", "rawDatasetIds 不能为空");
    const dsName: Record<string, string> = { "rds-orders": "orders", "rds-oee": "oee_points" };
    const toPascal = (s: string) => s.replace(/(^|[_-])(\w)/g, (_m, _x, c: string) => c.toUpperCase()).replace(/[^\w]/g, "") || s;
    const datasets: { name: string; fields: { name: string; inferredType: string; nullRate: number; uniqueRate: number }[] }[] = [];
    const objectTypes = body.rawDatasetIds.map((id) => {
      const name = dsName[id] ?? id;
      const row = (MOCK_RAW_ROWS[id] ?? MOCK_RAW_ROWS.default!)[0] ?? {};
      const names = Object.keys(row);
      const fields = names.map((n, i) => ({ name: n, inferredType: typeof row[n] === "number" ? "number" : "string", nullRate: 0, uniqueRate: i === 0 ? 1 : 0.5 }));
      datasets.push({ name, fields });
      return {
        action: "CREATE" as const, existingTypeKey: null, typeKey: toPascal(name), displayName: name, domain: "unassigned", sourceDataset: name,
        properties: fields.map((f, i) => ({ propKey: f.name, sourceField: f.name, dataType: (f.inferredType === "number" ? "number" : "string") as "number" | "string", isPrimaryKey: i === 0, refToTypeKey: null })),
        confidence: 1,
      };
    });
    const draft = { id: newId("draft"), status: "DRAFT", rawDatasetIds: body.rawDatasetIds, datasets, suggestion: { objectTypes, linkTypes: [] } } as (typeof db.modelingDrafts)[number];
    db.modelingDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: "DRAFT" }, { status: 201 });
  }),
  // 字段全建模覆盖报告（R12）
  http.get("*/a/v1/modeling/drafts/:id/coverage", ({ params }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    const rows = d.datasets.map((ds) => {
      const mapped = new Set(d.suggestion.objectTypes.filter((t) => t.sourceDataset === ds.name).flatMap((t) => t.properties.map((p) => p.sourceField)));
      const unmodeled = ds.fields.map((f) => f.name).filter((n) => !mapped.has(n));
      return { name: ds.name, total: ds.fields.length, modeled: ds.fields.length - unmodeled.length, unmodeled };
    });
    const totalFields = rows.reduce((a, r) => a + r.total, 0);
    const modeledFields = rows.reduce((a, r) => a + r.modeled, 0);
    return HttpResponse.json({ datasets: rows, totalFields, modeledFields, coverage: totalFields ? modeledFields / totalFields : 1, fullyCovered: modeledFields === totalFields });
  }),
  http.get("*/a/v1/modeling/drafts", () => HttpResponse.json(db.modelingDrafts)),
  http.get("*/a/v1/modeling/drafts/:id", ({ params }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "草案不存在");
  }),
  http.patch("*/a/v1/modeling/drafts/:id", async ({ params, request }) => {
    const body = (await request.json()) as { operations: Record<string, unknown>[] };
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    for (const op of body.operations) {
      // F10 失败回滚演示：改名为 FAIL 触发 422
      if (op.op === "renameType" && op.newTypeKey === "FAIL") return err(422, "VALIDATION_ERROR", "typeKey 不合法");
      const ot = d.suggestion.objectTypes.find((o) => o.typeKey === op.typeKey);
      if (op.op === "renameType" && ot) ot.typeKey = String(op.newTypeKey);
      if (op.op === "addProperty" && ot) ot.properties.push(op.property as (typeof ot.properties)[number]);
      if (op.op === "removeProperty" && ot) ot.properties = ot.properties.filter((p) => p.propKey !== op.propKey);
      if (op.op === "setRef" && ot) {
        const p = ot.properties.find((x) => x.propKey === op.propKey);
        if (p) {
          p.refToTypeKey = String(op.refToTypeKey);
          p.dataType = "ref";
        }
      }
    }
    return HttpResponse.json(d);
  }),
  http.post("*/a/v1/modeling/drafts/:id/publish", async ({ params, request }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    const body = (await request.json().catch(() => ({}))) as { requireFullCoverage?: boolean };
    const errors = d.suggestion.objectTypes
      .filter((ot) => !ot.properties.some((p) => p.isPrimaryKey))
      .map((ot) => ({ typeKey: ot.typeKey, message: "缺少主键属性（主键必填）" }));
    // 字段全建模门（R12）：开门则未建模字段阻断发布
    if (body?.requireFullCoverage) {
      for (const ds of d.datasets) {
        const mapped = new Set(d.suggestion.objectTypes.filter((t) => t.sourceDataset === ds.name).flatMap((t) => t.properties.map((p) => p.sourceField)));
        for (const f of ds.fields.filter((x) => !mapped.has(x.name))) {
          const tk = d.suggestion.objectTypes.find((t) => t.sourceDataset === ds.name)?.typeKey ?? ds.name;
          errors.push({ typeKey: tk, message: `字段 '${ds.name}.${f.name}' 未建模（字段全建模门 R12）` });
        }
      }
    }
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    d.status = "PUBLISHED";
    return HttpResponse.json({ ok: true });
  }),
  http.post("*/a/v1/modeling/drafts/:id/materialize", () => {
    const id = newId("mat");
    db.syncJobPolls.set(id, 0);
    return HttpResponse.json({ jobId: id }, { status: 202 });
  }),

  // ---- 合成数据 ----
  http.get("*/a/v1/industry-templates", () =>
    HttpResponse.json([{ industryKey: "battery-manufacturing" }, { industryKey: "discrete-assembly" }, { industryKey: "retail-supply-chain" }]),
  ),
  http.post("*/a/v1/synthetic/jobs", () => {
    const id = newId("synjob");
    db.syntheticJobPolls.set(id, 0);
    return HttpResponse.json({ jobId: id }, { status: 202 });
  }),
  http.get("*/a/v1/synthetic/jobs/:id", ({ params }) => {
    const id = String(params.id);
    const polls = (db.syntheticJobPolls.get(id) ?? 0) + 1;
    db.syntheticJobPolls.set(id, polls);
    const phase = Math.min(polls - 1, SYNTHETIC_PHASES.length);
    const done = phase >= SYNTHETIC_PHASES.length;
    return HttpResponse.json({
      id,
      status: done ? "SUCCEEDED" : "RUNNING",
      phase: Math.min(phase, SYNTHETIC_PHASES.length - 1),
      phases: SYNTHETIC_PHASES.map((name, i) => ({
        name,
        status: i < phase ? "DONE" : i === phase && !done ? "RUNNING" : done ? "DONE" : "PENDING",
      })),
      report: done ? SYNTHETIC_REPORT : undefined,
    });
  }),

  // ---- 模拟时钟（A8 §6.2） ----
  http.get("*/a/v1/synthetic/clock/ticks", () => HttpResponse.json(db.tickReports)),
  http.get("*/a/v1/synthetic/clock", () => HttpResponse.json(db.clock)),
  // D-29 实时环 F1：领域事件双源馈源（默认空；f51 经 server.use 注入事件验证全局传播）。
  http.get("*/a/v1/outbox", () => HttpResponse.json([])),
  http.get("*/b/v1/outbox", () => HttpResponse.json([])),
  http.post("*/a/v1/synthetic/clock/tick", async ({ request }) => {
    const body = (await request.json()) as { advance: "1d" | "7d" };
    const days = body.advance === "7d" ? 7 : 1;
    db.clock.status = "TICKING";
    // 记下句柄：mock 端的异步推进定时器若不可取消，用例结束后它仍会 fire（残留句柄 → teardown 期报错）
    clockTickTimer = setTimeout(() => {
      clockTickTimer = null;
      for (let i = 0; i < days; i++) {
        db.clock.currentTick += 1;
        const date = new Date(new Date(db.clock.simDate).getTime() + 86400_000);
        db.clock.simDate = date.toISOString().slice(0, 10);
        db.clock.script = db.clock.script.map((s) => (s.tick <= db.clock.currentTick ? { ...s, fired: true } : s));
        db.tickReports.unshift(tickReport(db.clock.currentTick, db.clock.simDate));
      }
      db.clock.status = "ACTIVE";
    }, 600);
    return HttpResponse.json({ tickJobId: newId("tick") }, { status: 202 });
  }),
  http.post("*/a/v1/synthetic/clock/reset", () => {
    db.clock = { simDate: "2026-06-12", currentTick: 0, status: "ACTIVE", script: db.clock.script.map((s) => ({ ...s, fired: false })) };
    db.tickReports = [];
    return HttpResponse.json(db.clock);
  }),

  // ---- Action 草稿 ----
  http.post("*/a/v1/action-drafts", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as {
      actionTypeKey?: string;
      payload?: Record<string, unknown>;
      origin?: { userId?: string; taskId?: string };
      submit?: boolean;
    };
    if (!body.actionTypeKey) return err(422, "VALIDATION_ERROR", "actionTypeKey required");
    // 增量 §7.12：定稿走 Action —— 先校验版本可定稿（FINAL → 409 PLAN_LOCKED）
    let finalizeVersion: (typeof db.sopVersions)[number] | undefined;
    if (body.actionTypeKey === "定稿月度计划版本") {
      const versionId = String((body.payload ?? {}).versionId ?? "");
      finalizeVersion = db.sopVersions.find((v) => v.id === versionId);
      if (!finalizeVersion) return err(404, "NOT_FOUND", "sop version 不存在");
      if (finalizeVersion.status === "FINAL") {
        const e = sopPlanLocked();
        return err(e.status, e.code, e.message);
      }
      if (finalizeVersion.status !== "EXEC_MEETING") return err(409, "INVALID_STATE", `cannot request finalize from ${finalizeVersion.status}（先执行第⑤步）`);
    }
    const draft = {
      id: newId("act"),
      tenantId: TENANT_ID,
      actionTypeKey: body.actionTypeKey,
      payload: body.payload ?? {},
      origin: { userId: body.origin?.userId ?? `usr-${account.username}`, taskId: body.origin?.taskId },
      status: (body.submit ? "PENDING_APPROVAL" : "DRAFT") as "PENDING_APPROVAL" | "DRAFT",
      approvalSteps: [{ seq: 1, role: "admin" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.actionDrafts.unshift(draft);
    if (finalizeVersion) {
      finalizeVersion.pendingApproval = { draftId: draft.id };
      finalizeVersion.updatedAt = new Date().toISOString();
    }
    return HttpResponse.json({ draftId: draft.id, status: draft.status, draft }, { status: 201 });
  }),
  // ---- WO-CAPLIVE-2（依赖 WO-LIVE-SCENARIO·桩·集成接真点=datacore 沙盘 SimCheckpoint 存/分支/横比）----
  // 方案快照存：SimCheckpoint.state 承载 what-if 快照 {apply,kpis}。
  http.post("*/a/v1/sim/live-scenarios", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as {
      baseId?: string; name?: string; parentId?: string;
      apply?: { objectType: string; objectId: string; prop: string; value: number }[];
    };
    const apply = Array.isArray(body.apply) ? body.apply : [];
    const scenario = {
      id: newId("lsc"),
      baseId: String(body.baseId ?? ""),
      name: String(body.name ?? `方案 ${db.liveScenarios.length + 1}`),
      parentId: body.parentId,
      apply,
      kpis: { capGain: scenarioCapGain(apply), affected: new Set(apply.map((a) => a.objectId)).size },
      createdAt: new Date().toISOString(),
    };
    db.liveScenarios.unshift(scenario);
    return HttpResponse.json(scenario, { status: 201 });
  }),
  http.get("*/a/v1/sim/live-scenarios", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const baseId = url.searchParams.get("baseId");
    const scenarios = db.liveScenarios.filter((s) => !baseId || s.baseId === baseId);
    return HttpResponse.json({ scenarios });
  }),
  // 横比矩阵：各格 = 各方案 apply 经 generic_inference 真算（同引擎前向重算公式·改方案 apply → 矩阵变·KILL-MOCK）。
  http.post("*/a/v1/sim/live-scenarios/compare", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const rows = ids
      .map((id) => db.liveScenarios.find((s) => s.id === id))
      .filter((s): s is (typeof db.liveScenarios)[number] => !!s)
      .map((s) => {
        const capGain = scenarioCapGain(s.apply);
        const cost = Math.round(s.apply.reduce((a, x) => a + (/outsource/i.test(String(x.prop)) ? Number(x.value) * 50 : 0), 0) * 100) / 100;
        // DF.13：触红线判定读契约单一来源（此前内联 0.2）。注意运算符是 `>=`（"已达红线"提示），
        // 与规则引擎的违规谓词 `>` 差一个边界点 —— 提示比拦截早一格是有意的，不是漂移。
        const ruleFlag = s.apply.some((x) => /outsource/i.test(String(x.prop)) && Number(x.value) >= OUTSOURCE_REDLINE.maxRatio);
        return { scenarioId: s.id, name: s.name, cells: { capGain, cost }, ruleFlag };
      });
    return HttpResponse.json({ dims: [{ key: "capGain", label: "产能增益" }, { key: "cost", label: "外协代价" }], rows });
  }),
  // ---- WO-CAPLIVE-2（依赖 WO-LIVE-NL·桩·集成接真点=agentcore 产能 what-if 意图路由）----
  // 真 NL：问句 → 识别 what-if/根因意图 → 路由 generic_inference/gap_attribution → 叙述带溯源（答案随问句变·KILL-MOCK）。
  http.post("*/b/v1/capacity-live/ask", async ({ request }) => {
    const body = (await request.json()) as { baseId?: string; question?: string; factor?: string };
    const q = String(body.question ?? "");
    const base = String(body.baseId ?? "该基地");
    const m = q.match(/(\d+(?:\.\d+)?)\s*%?/);
    const num = m ? parseFloat(m[1]!) : null;
    const isWhatIf = /良率|产能|降到|降至|提到|少多少|多少|OEE|利用率/.test(q) && num != null;
    if (isWhatIf) {
      const ratio = num! > 1 ? num! / 100 : num!;
      const before = 100;
      const after = Math.round(before * (0.5 + ratio * 0.5) * 100) / 100;
      return HttpResponse.json({
        answer: `按 ${base} 化成工序良率调至 ${num}% 推演：可用产能由 ${before} → ${after}（Δ ${Math.round((after - before) * 100) / 100}）。`,
        solver: "generic_inference",
        provenance: { src: "generic_inference · recompute(dryRun)", formula: "产能 ∝ 良率（前向重算下游派生）", inputs: [`Process.yield_baseline=${ratio}`] },
        deltas: [{ objectId: `base-${base}`, type: "Base", prop: "weeklyCap", before, after }],
        dataMode: "SYNTHETIC",
      });
    }
    return HttpResponse.json({
      answer: `已按 ${base}${body.factor ? `·${body.factor}` : ""} 结构反向归因：${q || "请给出问题"}（经 gap_attribution 结构分摊到叶级根因）。`,
      solver: "gap_attribution",
      provenance: { src: "gap_attribution · 结构反向归因", inputs: [`scope.baseId=${base}`, ...(body.factor ? [`scope.factorId=${body.factor}`] : [])] },
      dataMode: "SYNTHETIC",
    });
  }),
  http.post("*/a/v1/action-drafts/:id/submit", ({ params }) => {
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    d.status = "PENDING_APPROVAL";
    return HttpResponse.json(d);
  }),
  http.get("*/a/v1/action-drafts/:id", ({ params }) => {
    const d = db.actionDrafts.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "草稿不存在");
  }),
  /* ── WO-BEFE-B · R4 留痕读端（真后端 `actions.ts:822`）───────────────────────
   * 形状与真后端逐字段对齐：{ draft, steps, executionResult, events }。
   * `events` 从 `db.actionEvents` 按 draftId 筛 + 时间正序 —— 与后端
   * `e.event.startsWith("action.") && e.payload.draftId === id` 同判据。 */
  http.get("*/a/v1/action-drafts/:id/audit", ({ params }) => {
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    return HttpResponse.json({
      draft: d,
      steps: d.approvalSteps,
      executionResult: (d as { executionResult?: unknown }).executionResult ?? null,
      events: db.actionEvents
        .filter((e) => e.event.startsWith("action.") && e.payload.draftId === d.id)
        .sort((a, b) => (a.at < b.at ? -1 : 1)),
    });
  }),
  /* ── WO-BEFE-B · 撤回（真后端 `actions.ts:753`）──────────────────────────────
   * 两道闸与后端同判据：① 状态 ∈ {DRAFT, PENDING_APPROVAL, APPROVED}（EXECUTING 之后不可撤）；
   * ② 仅发起人或 admin。**不执行任何 payload、不写任何真值** —— cancel 是审批链的放弃分支。 */
  http.post("*/a/v1/action-drafts/:id/cancel", ({ params, request }) => {
    const account = auth(request);
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(d.status)) {
      return err(409, "INVALID_STATE", `cannot cancel in status ${d.status} (only before EXECUTING)`);
    }
    // 身份口径：真后端比 `ctx.userId`；mock 账号只有 username（`MockAccount`），
    // 而种子草稿的 origin.userId 形如 `usr-planner` ⇒ 两种写法都认，别把"是发起人"误判成"不是"。
    const isAdmin = (account?.roles ?? []).some((r) => r.split(":")[0] === "admin");
    const me = account?.username ?? "";
    const isOwner = d.origin.userId === me || d.origin.userId === `usr-${me}` || d.origin.userId === `usr_${me}`;
    if (!isOwner && !isAdmin) {
      return err(409, "INVALID_STATE", "仅发起人或管理员可取消");
    }
    d.status = "CANCELLED";
    d.updatedAt = new Date().toISOString();
    pushActionEvent("action.cancelled", { draftId: d.id });
    return HttpResponse.json(d);
  }),

  /* ══ WO-BEFE-B · S3 调度器（真后端 app.ts:4967–4982）══════════════════════ */
  http.get("*/a/v1/scheduler/jobs", ({ request }) => {
    const kind = new URL(request.url).searchParams.get("kind");
    return HttpResponse.json(kind ? db.schedulerJobs.filter((j) => j.kind === kind) : db.schedulerJobs);
  }),
  http.get("*/a/v1/scheduler/jobs/:id/runs", ({ params }) =>
    HttpResponse.json(db.schedulerRuns.filter((r) => r.jobId === params.id)),
  ),
  http.post("*/a/v1/scheduler/jobs/:id/pause", ({ params }) => {
    const j = db.schedulerJobs.find((x) => x.id === params.id);
    if (!j) return err(404, "NOT_FOUND", "任务不存在");
    j.status = "PAUSED";
    return HttpResponse.json(j);
  }),
  http.post("*/a/v1/scheduler/jobs/:id/resume", ({ params }) => {
    const j = db.schedulerJobs.find((x) => x.id === params.id);
    if (!j) return err(404, "NOT_FOUND", "任务不存在");
    j.status = "ACTIVE";
    return HttpResponse.json(j);
  }),

  /* ══ WO-BEFE-B · OC9 工厂日历（真后端 app.ts:1293–1310，admin only）════════
   * 后端 GET 不存在时回**默认壳**而非 404（`?? { …weekendMode:"SAT_SUN_OFF", exceptions:[] }`），
   * mock 照同样语义 —— 否则前端会为"新建日历"多写一条本不存在的分支。 */
  http.get("*/a/v1/calendars/:key", ({ params, request }) => {
    const account = auth(request);
    if (!(account?.roles ?? []).some((r) => r.split(":")[0] === "admin")) return err(403, "FORBIDDEN", "admin only");
    const key = String(params.key);
    const c = db.calendars.find((x) => x.calendarKey === key);
    return HttpResponse.json(
      c ?? { id: `cal_${TENANT_ID}_${key}`, tenantId: TENANT_ID, calendarKey: key, weekendMode: "SAT_SUN_OFF", exceptions: [], updatedAt: "" },
    );
  }),
  http.put("*/a/v1/calendars/:key", async ({ params, request }) => {
    const account = auth(request);
    if (!(account?.roles ?? []).some((r) => r.split(":")[0] === "admin")) return err(403, "FORBIDDEN", "admin only");
    const key = String(params.key);
    const body = (await request.json()) as Partial<Pick<FactoryCalendar, "weekendMode" | "exceptions">>;
    const prev = db.calendars.find((x) => x.calendarKey === key);
    const rec: FactoryCalendar = {
      id: `cal_${TENANT_ID}_${key}`,
      tenantId: TENANT_ID,
      calendarKey: key,
      weekendMode: body.weekendMode ?? prev?.weekendMode ?? "SAT_SUN_OFF",
      exceptions: body.exceptions ?? prev?.exceptions ?? [],
      updatedAt: new Date().toISOString(),
    };
    if (prev) Object.assign(prev, rec);
    else db.calendars.push(rec);
    return HttpResponse.json(rec);
  }),
  /**
   * 净生产窗口：与后端 `netProductionDays(from, to, cal)` **同算法**重算，不是摆一个好看的数。
   * 口径：区间内逐日 —— 周末按 weekendMode 扣、HOLIDAY/MAINTENANCE 扣、EXTRA_WORKDAY 补回。
   */
  http.get("*/a/v1/calendars/:key/net-window", ({ params, request }) => {
    const account = auth(request);
    if (!(account?.roles ?? []).some((r) => r.split(":")[0] === "admin")) return err(403, "FORBIDDEN", "admin only");
    const url = new URL(request.url);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!from || !to) return err(400, "VALIDATION_ERROR", "from/to required (YYYY-MM-DD)");
    const key = String(params.key);
    const cal = db.calendars.find((x) => x.calendarKey === key);
    const byDate = new Map((cal?.exceptions ?? []).map((e) => [e.date, e.kind]));
    let net = 0;
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const kind = byDate.get(iso);
      if (kind === "EXTRA_WORKDAY") { net += 1; continue; }
      if (kind === "HOLIDAY" || kind === "MAINTENANCE") continue;
      const dow = d.getUTCDay();
      const weekendOff =
        (cal?.weekendMode ?? "SAT_SUN_OFF") === "SAT_SUN_OFF" ? dow === 0 || dow === 6
          : (cal?.weekendMode ?? "") === "SUN_OFF" ? dow === 0 : false;
      if (!weekendOff) net += 1;
    }
    return HttpResponse.json({ calendarKey: key, from, to, netProductionDays: net });
  }),

  /* ══ WO-BEFE-B · 回放编排器 §1–§3（真后端 app.ts:5348–5366）════════════════
   * 隔离语义：真后端只在 SYNTHETIC 租户返回内容、写操作对真实租户 403（`opsteam/team.ts:39`）。
   * mock 给内容以便页面可测，但页面必须把这条边界显在屏上（见 OpsSchedulePage 的说明块）。 */
  http.get("*/a/v1/ops/personas", () => HttpResponse.json({ items: db.opsPersonas })),
  http.post("*/a/v1/ops/personas/seed", ({ request }) => {
    const account = auth(request);
    if (!(account?.roles ?? []).some((r) => r === "tenant_admin" || r.split(":")[0] === "admin")) {
      return err(403, "FORBIDDEN", "需要 tenant_admin 角色");
    }
    if (db.opsPersonas.length === 0) db.opsPersonas = structuredClone(OPS_PERSONAS);
    return HttpResponse.json({ items: db.opsPersonas }, { status: 201 });
  }),
  http.get("*/a/v1/ops/playbook", () => HttpResponse.json({ playbook: db.opsPlaybook })),
  http.put("*/a/v1/ops/playbook", async ({ request }) => {
    const account = auth(request);
    if (!(account?.roles ?? []).some((r) => r === "tenant_admin" || r.split(":")[0] === "admin")) {
      return err(403, "FORBIDDEN", "需要 tenant_admin 角色");
    }
    db.opsPlaybook = (await request.json()) as OpsPlaybook;
    return HttpResponse.json({ playbook: db.opsPlaybook });
  }),
  http.get("*/a/v1/ops/pools", () => HttpResponse.json({ pools: OPS_POOLS })),
  http.get("*/a/v1/ops/tick-reports", () =>
    HttpResponse.json({ items: [...db.opsTickReports].sort((a, b) => a.tick - b.tick) }),
  ),
  http.get("*/a/v1/action-drafts", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    return HttpResponse.json(status ? db.actionDrafts.filter((d) => d.status === status) : db.actionDrafts);
  }),
  http.post("*/a/v1/action-drafts/:id/decision", async ({ params, request }) => {
    const body = (await request.json()) as { decision: "APPROVE" | "REJECT"; comment: string };
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    const step = d.approvalSteps.find((s) => !s.decision);
    if (!step) return err(409, "INVALID_STATE", "无待审批步骤");
    step.decision = body.decision;
    step.comment = body.comment;
    step.decidedAt = new Date().toISOString();
    if (body.decision === "REJECT") d.status = "REJECTED";
    else if (d.approvalSteps.every((s) => s.decision === "APPROVE")) d.status = "APPROVED";
    // WO-BEFE-B · R4 留痕：与真后端 `actions.ts` approve/reject 的 outbox.emit 同名同载荷。
    // 追加在状态迁移**之后**，故 audit 里读到的 event 名与最终状态一致。
    pushActionEvent(
      body.decision === "REJECT" ? "action.rejected" : d.status === "APPROVED" ? "action.approved" : "action.pending_approval",
      { draftId: d.id, actionTypeKey: d.actionTypeKey },
    );
    // 增量 §7.12：域执行器语义镜像 —— 定稿 Action EXECUTED → 版本 FINAL；变更 Action → inputs patch
    if (d.status === "APPROVED") {
      const versionId = String((d.payload as Record<string, unknown>).versionId ?? "");
      const v = db.sopVersions.find((x) => x.id === versionId);
      if (d.actionTypeKey === "定稿月度计划版本" && v) {
        v.status = "FINAL";
        v.pendingApproval = null;
        v.updatedAt = new Date().toISOString();
        d.status = "EXECUTED" as typeof d.status;
      } else if (d.actionTypeKey === "计划版本变更" && v) {
        v.inputs = { ...v.inputs, ...((d.payload as { patch?: Record<string, unknown> }).patch ?? {}) };
        v.updatedAt = new Date().toISOString();
        d.status = "EXECUTED" as typeof d.status;
      }
    }
    return HttpResponse.json(d);
  }),

  // ======================== B · AgentCore ========================

  // ---- 同步求解器代理（Entitlement §4：先查 feature —— solverKey 绑定的功能被关 → 404，不泄露存在性） ----
  http.post("*/b/v1/solvers/:key/run", async ({ params, request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const key = String(params.key);
    const features = featuresForAccount(account, db.tenantOverrides);
    const boundOff = FEATURE_REGISTRY.some(
      (f) => f.bindings?.solverKeys?.includes(key) && !features.includes(f.key),
    );
    if (boundOff) return err(404, "FEATURE_NOT_FOUND", "not found");
    const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
    const args = body.args ?? {};
    if (key === "plan_audit") {
      // F20 竞态演示哨兵：dem=999 的请求慢 400ms（AbortController 最后发出者胜）
      if ((args as { dem?: number }).dem === 999) await new Promise((r) => setTimeout(r, 400));
      return HttpResponse.json({ data: mockPlanAudit(args as unknown as MockAuditInput), snapshotVersion: "ov-12" });
    }
    if (key === "plan_generate") return HttpResponse.json({ data: mockPlanGenerate(args), snapshotVersion: "ov-12" });
    if (key === "bottleneck_matrix") return HttpResponse.json({ data: mockBottleneckMatrix(args as { baseIds?: string[] }), snapshotVersion: "ov-12" });
    if (key === "capacity_forecast") {
      const data = mockCapacityForecast(args as unknown as MockForecastArgs);
      if ("error" in data) return err(422, "VALIDATION_ERROR", String(data.error));
      return HttpResponse.json({ data, snapshotVersion: "ov-12" });
    }
    // WO-LIVE-DISPOSITION：B 侧 run 路径同走 mock 真重算（与 A 侧 invoke 同一函数·不两套）。
    if (key === "risk_timeline") return HttpResponse.json({ data: mockRiskTimeline(args), snapshotVersion: "ov-12" });
    // 同上：B 侧 run 路径与 A 侧 invoke **共用同一个 mock 函数**（不两套，否则两条路会各自漂移）。
    if (key === "kit_readiness") {
      const kr = mockKitReadiness(args);
      if ("__err" in kr) return err(400, "AMBIGUOUS_SCOPE", String(kr.__err));
      return HttpResponse.json({ data: kr, snapshotVersion: "ov-12" });
    }
    if (key === "quote_margin") {
      const qm = mockQuoteMargin(args);
      if ("__err" in qm) return err(400, "AMBIGUOUS_SCOPE", String(qm.__err));
      return HttpResponse.json({ data: qm, snapshotVersion: "ov-12" });
    }
    // WO-PROJECT-SIM-WHATIF：⑥ 拖动杠杆经 useLiveSolver → B 侧 run 真重算（generic_inference）；
    // mode:levers 杠杆发现同经 B 侧（若前端改走 runSolver）。默认路径 apply → deltas（after 随假设值变·KILL-MOCK）。
    if (key === "generic_inference") {
      if (String(args.mode) === "levers") return HttpResponse.json({ data: mockLeverDiscovery(args), snapshotVersion: "ov-lv" });
      const gi = mockGenericInference(args);
      if ("__err" in gi) return err(400, "VALIDATION", String(gi.__err));
      return HttpResponse.json({ data: gi, snapshotVersion: "ov-gi" });
    }
    if (key === "affected_orders") {
      // §S1.5 扩展输出：summary + rows + problems[]（4 类归并 + rootChains）
      const base = typeof args.base === "string" && args.base !== "" ? args.base : undefined;
      return HttpResponse.json({ data: affectedOrdersOutput(base), snapshotVersion: "ov-12" });
    }
    if (key === "counterfactual_timeline") {
      const base = typeof args.base === "string" && args.base !== "" ? args.base : undefined;
      return HttpResponse.json({ data: mockCounterfactual(base), snapshotVersion: "ov-12" });
    }
    // VITE_MOCK 可见性桩（/b/v1 等价·与 /a/v1 invoke 同口径）：决策推演 + 供需双向归因。
    if (key === "decision_play")
      return HttpResponse.json({
        data: mockDecisionPlay(typeof args.metricKey === "string" ? args.metricKey : undefined),
        snapshotVersion: "ov-12",
      });
    if (key === "supply_demand_gap_attribution") return HttpResponse.json({ data: mockSupplyDemandGap(), snapshotVersion: "ov-12" });
    if (key === "mrp_netting")
      return HttpResponse.json({
        data: {
          materials: [
            { material: "三元正极", netDemand: 8180, ltaCoverPct: 92, gap: 654, earliestComplete: "2026-06-28" },
            { material: "隔膜", netDemand: 2376, ltaCoverPct: 100, gap: 0, earliestComplete: "" },
            { material: "电解液", netDemand: 5544, ltaCoverPct: 96, gap: 222, earliestComplete: "2026-06-25" },
          ],
          shortageCount: 2, summary: "3 种物料，2 种现货缺口（C06 齐套口径）",
        },
        snapshotVersion: "ov-12",
      });
    // WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用 + 多目标 what-if（mock 形状，真求解走 CP-SAT sidecar）。
    if (key === "cross_object_occupancy" || key === "multi_objective" || key === "optimize_whatif") {
      return HttpResponse.json({ data: mockMultiObj(key, args), snapshotVersion: "ov-12" });
    }
    if (key === "finance_pnl")
      // WO-MOCK-SCALE-TRUTH：量价本利科目表是**年**口径（亿元/年）。旧 mock 写 240/248/39.4，
      // 真后端实测 686/700/118.9（收入 rolling 700 就是需求侧营收锚本体）——同一张表差 2.8 倍。
      // 这一族**不随**量轴改月：钱轴与量轴期间不同是真后端自己的设计，见 mocks/sopScale.ts。
      return HttpResponse.json({
        data: {
          pnl: FINANCE_PNL_YEAR.pnl.map((row) => ({ ...row })),
          gmRow: { ...FINANCE_PNL_YEAR.gmRow },
          attribution: `毛利率 ${FINANCE_PNL_YEAR.gmRow.budgetPct}%→${FINANCE_PNL_YEAR.gmRow.rollPct}%（${FINANCE_PNL_YEAR.gmRow.diffPp}pp）：储能占比 37% 结构拉低（单价/成本未恶化）`,
          summary: `收入/成本/毛利三科目 + 毛利率 ${FINANCE_PNL_YEAR.gmRow.rollPct}%（C15）`,
        },
        snapshotVersion: "ov-12",
      });
    if (key === "sop_reschedule")
      return HttpResponse.json({ data: mockSopReschedule(args), snapshotVersion: "ov-12" });
    // WO-PORTFOLIO-OPTIMAL portfolio 全局项目推演（mock 逐口径移植·守恒 + ≥2 方案 + 冻结·真求解走 CP-SAT sidecar）。
    // WO-SURFACE-7DIM · 编排路由（镜像后端 service.ts orchestrate 判据）：twoStage/materialConstraint/levers/priorityLocks/globalSim
    // → mockGlobalSim（返 7 维 schedule[]/kpi/mockNotes additively 叠加经典字段）；否则经典 mockPortfolio。
    if (key === "portfolio") {
      const orchestrate = args.twoStage === true || args.materialConstraint === true || args.globalSim === true
        || (Array.isArray(args.levers) && args.levers.length > 0) || (Array.isArray(args.priorityLocks) && args.priorityLocks.length > 0)
        || (Array.isArray(args.businessTypes) && args.businessTypes.length > 0)
        // ③④⑤ · 分批交付 / 最终交期 / 方法旋钮 亦经 mockGlobalSim（出 dueComparison/methodScenario·镜像 datacore orchestrate）。
        || (Array.isArray(args.splitOrderIds) && args.splitOrderIds.length > 0)
        || (args.finalDueDays != null && typeof args.finalDueDays === "object" && Object.keys(args.finalDueDays as object).length > 0)
        || (args.methodWeights != null && typeof args.methodWeights === "object" && Object.keys(args.methodWeights as object).length > 0)
        || (Array.isArray(args.epsilon) && args.epsilon.length > 0) || (Array.isArray(args.priority) && args.priority.length > 0)
        || (typeof args.method === "string" && args.method !== "weighted");
      const portResp = orchestrate ? mockGlobalSim(args) : mockPortfolio(args);
      // WO-GSLIVE-1-COCKPIT · 活②：levers 非空 → 叠加 leverDeltas + 主方案 KPI 改善（空则原样·无回归）。
      return HttpResponse.json({ data: applyGslivePortfolioLevers(portResp, args), snapshotVersion: "ov-12" });
    }
    if (key === "base_capacity_outlook")
      return HttpResponse.json({ data: mockBaseOutlook(args), snapshotVersion: "ov-12" });
    // WO-IMPEDIMENT-FE · 全链阻滞点扫描（卡点/堵点/断点）。载荷口径 = 真后端在 demo 合成种子上的基线
    //（无 LIVE、C02/C09 各 0 条、C22 与 LEADTIME 诚实缺席）—— mock 不比生产漂亮。
    if (key === "chain_impediments") {
      const ci = mockChainImpediments(args);
      // R-ARG-FIDELITY：businessTypes / modelIds 真后端 400，mock 同口径（不静默返全域）。
      if ("__err" in ci) return err(400, "VALIDATION_ERROR", String(ci.__err));
      return HttpResponse.json({ data: ci, snapshotVersion: "ov-12" });
    }
    if (key === "order_fullchain") {
      // ORD 订单全链推演（mock：储能单越线财务提价）
      const so = typeof args.so === "string" && args.so ? args.so : "SO-10001";
      return HttpResponse.json({
        data: {
          so, verdict: "提价3%接", vc: "#E8B54A",
          kpis: { qty: 800, segment: "储能", marginPct: 11, floorPct: 14, deliveryPacksPerWeekP90: 1260, kitGap: 654 },
          judges: {
            cap: { verdict: "可达", packsPerWeekP50: 1400, packsPerWeekP90: 1260, demand: 800, ruleRefs: ["C02", "C03"], unit: "套/周" },
            kit: { verdict: "缺料", material: "三元正极", gapTon: 654, eta: "2026-06-28", ruleRefs: ["C06", "C16"] },
            fin: { verdict: "需提价3%", marginPct: 11, floorPct: 14, creditUsedRatio: 0.8, priceUpPct: 3, ruleRefs: ["C15", "C13", "C18"] },
          },
          conds: ["毛利率 11% < 细分底线 14%（C15），提价 3% 达线", "三元正极 缺口 654 吨（C06），最早齐套 2026-06-28"],
          dag: {
            nodes: [
              { id: `order:${so}`, kind: "order", label: `订单 ${so}` },
              { id: "net", kind: "network", label: "可产网络" }, { id: "bom", kind: "bom", label: "BOM 展开" },
              { id: "eco", kind: "economics", label: "单价与细分" }, { id: "cred", kind: "credit", label: "信用档案" },
              { id: "jcap", kind: "judge", label: "①交期判" }, { id: "jkit", kind: "judge", label: "②齐套判" }, { id: "jfin", kind: "judge", label: "③财务判" },
              { id: "vrd", kind: "verdict", label: "提价3%接" },
            ],
            edges: [
              { from: `order:${so}`, to: "net" }, { from: `order:${so}`, to: "bom" }, { from: `order:${so}`, to: "eco" }, { from: `order:${so}`, to: "cred" },
              { from: "net", to: "jcap" }, { from: "bom", to: "jkit" }, { from: "eco", to: "jfin" }, { from: "cred", to: "jfin" },
              { from: "jcap", to: "vrd" }, { from: "jkit", to: "vrd" }, { from: "jfin", to: "vrd" },
            ],
          },
          summary: `订单 ${so} 结论：提价3%接`,
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "ksf_graph")
      return HttpResponse.json({
        data: {
          problems: [
            { id: "prob:kpi-margin", name: "毛利率越线", severity: "H", ksfRef: "ksf-dem", gap: 3.0 },
            { id: "prob:kpi-attain", name: "产销达成越线", severity: "M", ksfRef: "ksf-bal", gap: 1.5 },
          ],
          ksfNodes: [
            { id: "ksf:ksf-dem", ksfId: "ksf-dem", key: "k_dem", name: "需求结构", sub: "细分占比与价格" },
            { id: "ksf:ksf-bal", ksfId: "ksf-bal", key: "k_bal", name: "产销爬坡", sub: "产能与达成" },
            { id: "ksf:ksf-kit", ksfId: "ksf-kit", key: "k_kit", name: "物料齐套", sub: "长协与现货缺口" },
            { id: "ksf:ksf-cash", ksfId: "ksf-cash", key: "k_cash", name: "信用现金", sub: "应收与现金垫" },
            { id: "ksf:ksf-cost", ksfId: "ksf-cost", key: "k_cost", name: "成本外协", sub: "制造成本与外协" },
          ],
          finNodes: [
            { id: "fin:kpi-margin", name: "毛利率", actual: 13, target: 16, unit: "%", status: "RED" },
            { id: "fin:kpi-attain", name: "产销达成率", actual: 91, target: 95, unit: "%", status: "AMBER" },
          ],
          edges: [
            { from: "prob:kpi-margin", to: "ksf:ksf-dem", kind: "threat" },
            { from: "prob:kpi-attain", to: "ksf:ksf-bal", kind: "threat" },
            { from: "ksf:ksf-dem", to: "fin:kpi-margin", kind: "support" },
            { from: "ksf:ksf-bal", to: "fin:kpi-attain", kind: "support" },
          ],
          summary: "2 个待解决问题压在 2 个关键成功要素上，传导至 2 项财务计划指标",
        },
        snapshotVersion: "ov-12",
      });
    if (key === "audit_timeline") {
      const series = Array.from({ length: 90 }, (_, d) => Math.min(100, Math.round(40 + d * 0.7)));
      return HttpResponse.json({
        data: {
          kind: String(args.kind ?? "毛利"), series,
          stages: [{ label: "事件窗" }, { label: "约束越线" }, { label: "波及订单" }, { label: "财务击穿" }],
          peak: 100, crossDay: 64, threshold: 85,
          events: [{ type: "delivery_peak", day: 22, amp: 6, factors: ["交付高峰"], tag: "交付高峰", obj: "SO-9001", desc: "SO-9001·广汽集团 交付 1,800 套到期：当周产线排产负载 +8 个百分点", src: "S&OP/ERP 订单交期" }],
          affectedOrders: [],
        },
        snapshotVersion: "ov-12",
      });
    }
    return err(404, "FEATURE_NOT_FOUND", "求解器不存在或未开通");
  }),

  http.get("*/b/v1/scenes", ({ request }) => {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    if (view) return HttpResponse.json(db.scenes.find((s) => s.viewKey === view) ?? null);
    return HttpResponse.json(db.scenes);
  }),
  http.get("*/b/v1/scene-entries", () => HttpResponse.json(db.scenes)),
  http.put("*/b/v1/scene-entries/:viewKey", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const scene = db.scenes.find((s) => s.viewKey === params.viewKey);
    if (!scene) return err(404, "NOT_FOUND", "场景不存在");
    Object.assign(scene, body);
    return HttpResponse.json(scene);
  }),

  // ---- 场景启动器：公共目录卡片（按域分组、一键启动）----
  http.get("*/b/v1/scenarios", ({ request }) => {
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    const items = [...db.scenarios]
      .filter((s) => s.status === "PUBLISHED")
      .sort((a, b) => (a.scenarioKey < b.scenarioKey ? -1 : 1))
      .map((s) => ({
        sNo: s.scenarioKey, name: s.name, view: s.targetView, domain: s.domain, intentKey: s.intentKey,
        triggerQuestion: s.triggerQuestion, solver: s.solver, riskLevel: s.riskLevel, summary: s.summary,
        willProduceDraft: s.riskLevel === "ACTION_DRAFT", inactive: false, presetContext: s.presetContext,
      }));
    const shown = includeInactive ? items : items.filter((c) => !c.inactive);
    return HttpResponse.json({ launcherEnabled: true, total: shown.length, items: shown });
  }),

  // ---- 场景启动器 P2/P3：Scenario 一等对象管理（场景为主键，完整可配）----
  http.get("*/b/v1/scenarios/manage", () =>
    // WO-BEFE-D：闭包口径抽成 `scenarioClosureMock` 单源 —— `/manage` 与 `/:key/closure`
    // 在真后端就是同一个 `scenarioClosure()`；mock 这边各写一份的话，「复检」按钮会给出
    // 与列表不同的答案，而那种矛盾只有用户会发现。
    HttpResponse.json(
      [...db.scenarios].sort((a, b) => (a.scenarioKey < b.scenarioKey ? -1 : 1)).map((s) => ({ ...s, closure: scenarioClosureMock(s) })),
    ),
  ),
  http.post("*/b/v1/scenarios", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const key = String(body.scenarioKey ?? "");
    if (db.scenarios.some((s) => s.scenarioKey === key)) return err(409, "CONFLICT", "场景键已存在");
    const sc = {
      id: `scn-${key}`, tenantId: TENANT_ID, scenarioKey: key, name: String(body.name ?? key),
      domain: body.domain as string | undefined, targetView: String(body.targetView ?? ""), intentKey: String(body.intentKey ?? ""),
      triggerQuestion: String(body.triggerQuestion ?? ""), solver: body.solver as string | undefined,
      rules: (body.rules as string[]) ?? [], riskLevel: (body.riskLevel as "COMPUTE" | "ACTION_DRAFT") ?? "COMPUTE",
      summary: String(body.summary ?? ""), mode: (body.mode as Scenario["mode"]) ?? "WORKFLOW_FIRST",
      defaultAgentId: body.defaultAgentId as string | undefined,
      presetContext: (body.presetContext as Scenario["presetContext"]) ?? { targetView: String(body.targetView ?? ""), selectedObjects: [], slotPresets: {} },
      status: "DRAFT" as const, version: 1, updatedAt: new Date().toISOString(),
    };
    db.scenarios.push(sc);
    return HttpResponse.json(sc, { status: 201 });
  }),
  http.put("*/b/v1/scenarios/:key", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    if (sc.status === "PUBLISHED") return err(409, "INVALID_STATE", "场景已发布，请先退役再改");
    Object.assign(sc, body, { status: "DRAFT", updatedAt: new Date().toISOString() });
    return HttpResponse.json(sc);
  }),
  http.post("*/b/v1/scenarios/:key/publish", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    sc.status = "PUBLISHED";
    sc.version += 1;
    sc.updatedAt = new Date().toISOString();
    return HttpResponse.json(sc);
  }),
  // PRD-scenario-ontogenesis P1：发育验证（mock）—— 经 QOS 跑通触发问句 → VERIFIED → GOVERNED + 留痕。
  http.post("*/b/v1/scenarios/:key/grow", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key) as (typeof db.scenarios)[number] & { maturity?: string; lastOntogenesisRun?: unknown };
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    const run = {
      runId: `sor_${String(params.key)}`, scenarioKey: String(params.key), ranAt: new Date().toISOString(),
      rings: { data: true, ontology: true, capability: true },
      verification: { status: "VERIFIED" as const, path: "WORKFLOW" as const, gapCode: null, answerPreview: "P50 产能 132 GWh · P90 118 GWh · 缺口 3.2%", taskId: "task_mock_grow" },
      gaps: [] as { gapCode: string; disposition: "AUTO_DERIVE" | "NEEDS_HUMAN"; detail: string }[], maturity: "GOVERNED" as const,
    };
    sc.maturity = "GOVERNED"; sc.lastOntogenesisRun = run;
    return HttpResponse.json(run);
  }),
  http.post("*/b/v1/scenarios/:key/retire", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    sc.status = "RETIRED";
    sc.updatedAt = new Date().toISOString();
    return HttpResponse.json(sc);
  }),
  // ── WO-BEFE-D · 场景三条（此前前端零调用方）─────────────────────────────────
  // ⚠ MSW 按注册序匹配：`:key/closure` 这类子路径必须排在任何 `:key` 通配之前。
  //   本文件今天没有 `GET */b/v1/scenarios/:key`，但排序仍照此纪律写，免得下一个人加了那条就静默吞掉。
  http.get("*/b/v1/scenarios/:key/closure", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    return HttpResponse.json(scenarioClosureMock(sc));
  }),
  /**
   * 服务端组装启动。mock 侧**必须真的做那三件事**，否则前端改走这条路的收益在测试上看不见：
   *  ① 非 PUBLISHED → 409（前端自己拼 `/b/v1/queries` 那条路根本没有这道闸）；
   *  ② 用户改写 query 时，把归一化结果写进 `slotPresets._normalizedSlots`
   *     （真后端由 agentcore `parseCapacityFeasibilityVariant` 算；mock 用一个**刻意简化但确定性**的
   *      规则：识别「N天/N周」→ weeks。简化的是解析器，不是"有没有归一化"这件事）；
   *  ③ 回包带 `scenario` / `query` 两个字段 —— 前端据此断言"启动的是哪张卡、用的是哪句问句"。
   */
  http.post("*/b/v1/scenarios/:key/launch", async ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key || s.intentKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", `scenario not found: ${String(params.key)}`);
    if (sc.status !== "PUBLISHED") return err(409, "INVALID_STATE", `场景未发布（${sc.status}），不可启动`);
    const body = ((await request.json().catch(() => ({}))) ?? {}) as { query?: string };
    const userQuery = body.query?.trim() || sc.triggerQuestion;
    const slotPresets: Record<string, unknown> = { ...sc.presetContext.slotPresets };
    if (userQuery !== sc.triggerQuestion) {
      const days = /(\d+)\s*天/.exec(userQuery);
      const weeks = /(\d+)\s*周/.exec(userQuery);
      const w = weeks ? Number(weeks[1]) : days ? Math.max(1, Math.ceil(Number(days[1]) / 7)) : undefined;
      if (w !== undefined) {
        slotPresets.weeks = w;
        slotPresets._normalizedSlots = { weeks: { raw: userQuery, normalized: w, unit: "week" } };
      }
    }
    // 任务本体与 `POST /b/v1/queries` **同一条造法**（scriptForQuery + registerTaskScript）——
    // 换的只是"谁来组装 context"，不是"任务怎么跑"。另造一条会让对话坞在两条启动路上行为不同。
    const context = {
      view: sc.presetContext.targetView,
      selectedObjects: sc.presetContext.selectedObjects,
      filters: {},
      presetSlots: slotPresets,
      scenarioIntentKey: sc.intentKey,
      scenarioKey: sc.scenarioKey,
    };
    const taskId = newId("task");
    const plan = scriptForQuery(taskId, userQuery, context as never);
    db.tasks.set(taskId, {
      id: taskId, query: userQuery, context, plan, status: "ROUTING", clarificationRounds: 0,
      createdAt: new Date().toISOString(),
    });
    registerTaskScript(taskId, plan.segments);
    return HttpResponse.json(
      { taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events`, scenario: sc.scenarioKey, query: userQuery },
      { status: 202 },
    );
  }),
  /** 一键发布全链：计划 → 意图 → 场景（依赖序）。闭包不通过 → 409（R4 不绕，前端不许自己放行）。 */
  http.post("*/b/v1/scenarios/:key/publish-chain", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    const publishedChain: { kind: string; key: string }[] = [];
    // ① 意图：DRAFT → PUBLISHED（真后端还会先发它引用的计划；mock 的 intents 无 planRef 层，故只此一跳）。
    const intent = db.intents.find((i) => i.key === sc.intentKey);
    if (intent && intent.status !== "PUBLISHED") {
      intent.status = "PUBLISHED";
      publishedChain.push({ kind: "intent", key: intent.key });
    }
    // ② 场景：链补齐后**重跑**上架门 —— 仍不闭合就 409（不是发完再说）。
    const closure = scenarioClosureMock(sc);
    if (!closure.ready) return err(409, "VALIDATION_ERROR", `场景引用未闭合（死路），不可发布：${closure.issues.join("；")}`);
    sc.status = "PUBLISHED";
    sc.version += 1;
    sc.updatedAt = new Date().toISOString();
    publishedChain.push({ kind: "scenario", key: sc.scenarioKey });
    return HttpResponse.json({ scenario: sc, publishedChain });
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // WO-BEFE-D · 组织世界 `/a/v1/org/*`（五条·此前前端零调用方）
  // ══════════════════════════════════════════════════════════════════════════
  http.get("*/a/v1/org/chart", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(orgChartMock());
  }),
  http.get("*/a/v1/org/authorities", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json({ authorities: ORG_AUTHORITIES, limits: ORG_LIMITS });
  }),
  http.get("*/a/v1/org/delegations", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json({ delegations: ORG_DELEGATIONS });
  }),
  /**
   * 在岗状态写面。mock 也**照抄后端那三道判据**（`org/routes.ts:83`）：
   * 角色不够 → 403 · 人不存在 → 404 · 非 person → 400。
   * 少一道都会让前端在 mock 上试出一个生产里不成立的行为。
   */
  http.patch("*/a/v1/org/principals/:principalId/availability", async ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    if (!account.roles.some((r) => ["admin", "tenant_admin"].includes(r.split(":")[0]!))) {
      return err(403, "FORBIDDEN", "需要 admin 或 tenant_admin 角色");
    }
    const body = ((await request.json().catch(() => ({}))) ?? {}) as { available?: unknown };
    if (typeof body.available !== "boolean") return err(400, "VALIDATION_ERROR", "available 必须是布尔值");
    const row = orgState.principals.find((p) => p.principalId === params.principalId);
    if (!row) return err(404, "NOT_FOUND", `org principal ${String(params.principalId)} not found`);
    if (row.kind !== "person") return err(400, "VALIDATION_ERROR", "只有 kind=person 的主体有在岗状态（部门/角色没有）");
    row.available = body.available;
    return HttpResponse.json(row);
  }),
  /** 谁能批这一单。入参走**契约本尊** `ApprovalMatterSchema`，mock 不另写一套判空。 */
  http.post("*/a/v1/org/approvers/resolve", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const parsed = ApprovalMatterSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return err(400, "VALIDATION_ERROR", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return HttpResponse.json(resolveApproversMock(parsed.data));
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // WO-BEFE-D · 决策因果图 `/a/v1/causal-graphs/*`（两条·此前前端零调用方）
  // ══════════════════════════════════════════════════════════════════════════
  // ⚠ 两个 handler 的返回值都过 `DecisionGraphSchema.parse()` —— 契约的 superRefine 会当场
  //   咬住「空段没写 segmentGaps」「segmentCounts 与 nodes 不符」「悬空边」「段序倒流」。
  //   即：mock 若编了一张结构上不可能的图，**mock 自己先炸**，而不是让前端拿它当真图渲染出来。
  http.get("*/a/v1/causal-graphs/sim/:sessionId", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(simCausalGraphMock(String(params.sessionId)));
  }),
  http.get("*/a/v1/causal-graphs/decision/:decisionId", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(decisionCausalGraphMock(String(params.decisionId)));
  }),

  // ---- 查询任务 ----
  http.post("*/b/v1/queries", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const idemKey = request.headers.get("Idempotency-Key");
    if (idemKey && db.idempotency.has(idemKey)) {
      const taskId = db.idempotency.get(idemKey)!;
      return HttpResponse.json({ taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events` }, { status: 202 });
    }
    const body = (await request.json()) as { packageId: string; query: string; context: Record<string, unknown> };
    if (body.packageId !== PACKAGE_ID) return err(404, "PACKAGE_NOT_FOUND", "场景包不存在");
    // shell.query-dock 关闭 → 404（Entitlement §5）
    const features = featuresForAccount(account, db.tenantOverrides);
    if (!features.includes("shell.query-dock")) return err(404, "FEATURE_NOT_FOUND", "功能未开通");

    const taskId = newId("task");
    const plan = scriptForQuery(taskId, body.query, body.context as never);
    const task: MockTask = {
      id: taskId,
      query: body.query,
      context: body.context,
      plan,
      status: "ROUTING",
      clarificationRounds: 0,
      createdAt: new Date().toISOString(),
    };
    db.tasks.set(taskId, task);
    if (idemKey) db.idempotency.set(idemKey, taskId);
    registerTaskScript(taskId, plan.segments);
    return HttpResponse.json({ taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events` }, { status: 202 });
  }),

  http.post("*/b/v1/queries/:taskId/clarification", ({ params }) => {
    const task = db.tasks.get(String(params.taskId));
    if (!task) return err(404, "NOT_FOUND", "任务不存在");
    if (task.plan.segments.length < 2) return err(409, "INVALID_STATE", "任务不在等待澄清状态");
    task.clarificationRounds += 1;
    releaseNextSegment(task.id);
    return HttpResponse.json({ ok: true });
  }),

  http.post("*/b/v1/queries/:taskId/cancel", () => HttpResponse.json({ ok: true }, { status: 202 })),
  http.post("*/b/v1/queries/:taskId/feedback", () => HttpResponse.json({ ok: true })),

  // 推演历史列表（Phase9C；时钟图标侧滑面板消费）：本租户最近 QOS 任务。
  http.get("*/b/v1/queries", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? "50") || 50));
    // ⚠️ WO-AGENT-ADMIN-CONSOLE 修正：`path` 此前写的是 `PATH_A`，**真后端从不返回这个值** ——
    // 契约是 `z.enum(["WORKFLOW","AGENT"])`（`packages/contracts/src/qos.ts:493`），
    // 真端点返 `t.path ?? null`（`agentcore/src/server.ts:366`）。mock 与真后端形状不一致，
    // 任何按 path 过滤的消费方在 mock 模式下都会读到空集（本单的 Agent 运行观测台正是其一）。
    const items = [
      { taskId: "task-hist-1", query: "4680-NCM 加 20% 六周能不能接？", path: "WORKFLOW", status: "COMPLETED", view: "project-sim", conversationId: "conv-h1", classification: { intentKey: "capacity_feasibility", confidence: 0.94 }, answerSummary: "P50 42.0 万套 · 缺口 1.0；加夜班可补齐", createdAt: "2026-06-15T09:12:00Z", completedAt: "2026-06-15T09:12:08Z" },
      { taskId: "task-hist-2", query: "常州基地影响哪些订单？", path: "WORKFLOW", status: "COMPLETED", view: "risk", conversationId: "conv-h2", classification: { intentKey: "affected_orders", confidence: 0.91 }, answerSummary: "8 单受影响 · 营收暴露 27.6 亿", createdAt: "2026-06-15T08:40:00Z", completedAt: "2026-06-15T08:40:05Z" },
      { taskId: "task-hist-3", query: "现金垫 45 亿过得了体检吗？", path: "WORKFLOW", status: "COMPLETED", view: "plan-audit", conversationId: "conv-h3", classification: { intentKey: "plan_audit_q", confidence: 0.88 }, answerSummary: "站不住：现金垫 C18 越线，建议补 5 亿", createdAt: "2026-06-14T16:05:00Z", completedAt: "2026-06-14T16:05:06Z" },
      // AGENT 路两条：一条引擎真跑过（有 run 记录），一条走了未接 LLM 的诚实降级（无 run 记录）。
      // 后者不是为了凑数——它是全新部署的**常态**（`orchestrator.ts:2656 completeNoLlmDegradation`
      // 把 task 标成 path=AGENT + COMPLETED 却从不写 run），mock 不带这一态就测不出诚实位。
      { taskId: "task-agent-1", query: "结合最近产能与订单，帮我判断下季度整体经营风险在哪", path: "AGENT", status: "COMPLETED", view: "dash", conversationId: "conv-a1", classification: null, answerSummary: "识别 3 处风险敞口，其中电解液供应最紧", createdAt: "2026-06-16T10:20:00Z", completedAt: "2026-06-16T10:20:31Z" },
      { taskId: "task-agent-2", query: "随便聊聊，当前产线整体健康度怎么样", path: "AGENT", status: "COMPLETED", view: "dash", conversationId: "conv-a2", classification: null, answerSummary: "未接入可用的 LLM 提供商，已诚实降级", createdAt: "2026-06-16T09:05:00Z", completedAt: "2026-06-16T09:05:01Z" },
      // WO-AGENTRUN-ATTRIBUTION：两条**归属得上**的运行（绑到 explore_agent，且分属 v1/v2）。
      // 加进来不是为了凑数：租户级清单里若一条归属得上的都没有，「归属已可得」这句话在 mock 模式下
      // 就无从被界面证实，而真部署里这类运行恰恰是主流（场景入口 Agent / 角色 Agent 都走这条）。
      { taskId: "task-explore-2", query: "用探索分析 Agent 复核一下常州基地的产能缺口", path: "AGENT", status: "COMPLETED", view: "graph", conversationId: "conv-e2", classification: null, answerSummary: "缺口 1.0 万套，建议加夜班", createdAt: "2026-06-16T14:02:00Z", completedAt: "2026-06-16T14:02:10Z" },
      { taskId: "task-explore-1", query: "在手单里哪些型号交期最紧", path: "AGENT", status: "COMPLETED", view: "graph", conversationId: "conv-e1", classification: null, answerSummary: "3 个型号进入交期红区", createdAt: "2026-06-15T11:40:00Z", completedAt: "2026-06-15T11:41:00Z" },
      /**
       * WO-BEFE-C · 多角色会诊那一条（`task-consult-1`）。
       *
       * ⚠️ **这一行是 WO-BEFE-C 于 2026-08-14 实测补上的**。
       * 复验方式（任一条不成立即说明这段话过期了，回来改）：
       *   · 两个承载物必须**同时**在场，缺一个这条任务就又变得展不开：
       *     `grep -n '"run-fanout-1"' …/handlers.ts`      → 运行记录（今日实测：`id:` 那行 1 处 + 本注释自引用 1 处）
       *     `grep -n '组织一次多角色会诊' …/handlers.ts`  → 任务清单行（今日实测：清单 1 处 + 本注释自引用 1 处）
       *     ⚠️ **看的是"那一行代码在不在"，不是 `grep -c` 的数字**：本注释里写着的探针串
       *        自己也会被匹上，于是每个计数都比代码多 1。今日亲手踩过两次 ——
       *        先用 `grep -c 'task-consult-1'` 写下"实测 2 处"，真跑是 5（注释提了 3 次）。
       *        形态就是铁律 0.6 那一句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y」**。
       *   · 机器判据（真正该信的那个）：接缝断言
       *     `apps/frontend-shell/test/befe-wire-c.seam.test.tsx`「展开会诊任务 → 屏上出现本次全部运行」
       *     —— 删掉本行它当场红（`openRunByQuery` 找不到含「多角色会诊」的任务行）。
       * 补之前 mock 里存在一个「有数据、但界面永远够不到」的洞：
       * `AGENT_RUNS` 里躺着 `run-fanout-1`（`taskId: "task-consult-1"`，`origin: "FANOUT"`），
       * 两个读端的 mock handler 也都会照实返回它 —— 但**任务清单里没有这一行**，
       * 而观测台的运行列表正是从 `GET /b/v1/queries` 来的 ⇒ 用户在界面上永远展不开这条任务，
       * 那条会诊子运行就永远看不见。形态与本仓 `path: "PATH_A"` 那次同源：
       * **数据摆在那儿、没有消费方按它取，于是错了三个月没人发现**；这次是本单接上复数读端
       * （`GET /b/v1/queries/:taskId/agent-runs`）当场撞出来的。
       *
       * 它的真实形态刻意保持「**顶层 0 条 + 扇出 N 条**」：单数端点对它如实 404
       * （界面显示"本次未进入 Agent 循环"），复数端点返 1 条 —— 两句同时为真，
       * 这正是 `TaskAgentRuns` 那条 rootless 说明存在的理由。
       */
      { taskId: "task-consult-1", query: "组织一次多角色会诊：这批电解液涨价我们该怎么应对", path: "AGENT", status: "COMPLETED", view: "dash", conversationId: "conv-c1", classification: null, answerSummary: "三角色会诊：采购/生产/财务给出联合建议", createdAt: "2026-06-16T15:29:00Z", completedAt: "2026-06-16T15:30:20Z" },
    ].slice(0, limit);
    return HttpResponse.json({ items, total: items.length });
  }),

  // WO-AGENT-ADMIN-CONSOLE · 决策痕迹（真后端 `agentcore/src/server.ts:426`）。
  // 形状对着 `DecisionTraceSchema`（`packages/contracts/src/qos.ts:626-650`）写，勿自造字段。
  http.get("*/b/v1/queries/:taskId/decision-trace", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const taskId = String(params.taskId);
    // 工具调用从**同一份** run 记录派生（真后端两处读的也是同一批 toolCalls 行）——
    // 抄成两份，界面上就会出现「运行记录说调了 4 次、痕迹里只有 2 次」这种真部署里不存在的矛盾。
    // 没有 run 记录的那条（未接 LLM 的诚实降级）自然得到空数组：真值，不是缺数据。
    const toolCalls = (AGENT_RUNS.find((r) => r.taskId === taskId)?.iterations ?? []).flatMap((it) =>
      it.toolCalls.map((tc) => ({ tool: tc.toolName, outcome: tc.outcome, durationMs: tc.durationMs })),
    );
    return HttpResponse.json({
      decisionId: taskId,
      tenantId: TENANT_ID,
      question: "（mock）",
      status: "COMPLETED",
      path: "AGENT",
      resolvedRefs: [],
      unverifiedNumerics: false,
      provenanceCount: toolCalls.filter((t) => t.outcome === "OK").length,
      ontologyValidation: "NONE",
      humanReviewRequired: true,
      toolCalls,
      createdAt: "2026-06-16T10:20:00Z",
      completedAt: "2026-06-16T10:20:31Z",
    });
  }),

  // WO-AGENT-ADMIN-CONSOLE · Agent 运行记录（真后端 `agentcore/src/server.ts` 新增）。
  // 形状对着 `AgentRunRecordSchema`（`packages/contracts/src/qos.ts:711-722`）。
  // `contextOps: []` 是**刻意的真值**：默认 20 万上下文窗口下软阈值够不到（欠账 #91），
  // 三刀一次都不会跑。mock 若在这里塞几条假的 fold，界面就会画出一个真部署里永远看不到的东西。
  http.get("*/b/v1/queries/:taskId/agent-run", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const taskId = String(params.taskId);
    // WO-AGENTRUN-FANOUT-PERSIST · 与真后端 `getByTask` **同一个谓词**（`origin IS DISTINCT FROM 'FANOUT'`）：
    // 单数端点只返这个任务自己那条，绝不拿会诊扇出的子运行冒充。少了这个过滤，mock 模式下
    // 会诊任务会返回一条真后端会 404 的记录 —— 又一次「mock 形状 ≠ 真后端形状」（G-MOCK-PATH-ENUM-DRIFT 同源）。
    // 旧记录无 origin ⇒ 视为顶层，照旧返回（`!== "FANOUT"` 而非 `=== "ROOT"`）。
    const run = AGENT_RUNS.find((r) => r.taskId === taskId && r.origin !== "FANOUT");
    if (!run) {
      // 与真后端同码：任务在但引擎没进循环 → AGENT_RUN_NOT_FOUND（不是 TASK_NOT_FOUND）
      return err(404, "AGENT_RUN_NOT_FOUND", `no agent run for task: ${taskId}`);
    }
    return HttpResponse.json(run);
  }),

  /**
   * WO-AGENTRUN-FANOUT-PERSIST · 一次任务的**全部**运行（真后端 `GET /api/v1/queries/:taskId/agent-runs`）。
   * 多角色会诊的真实形态是「0 条顶层 + N 条子运行」，故这里刻意不做 origin 过滤。
   */
  http.get("*/b/v1/queries/:taskId/agent-runs", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const taskId = String(params.taskId);
    return HttpResponse.json({ taskId, runs: AGENT_RUNS.filter((r) => r.taskId === taskId) });
  }),

  /**
   * WO-AGENTRUN-ATTRIBUTION · **这个 Agent 的历次运行**（真后端 `GET /b/v1/agents/:id/runs`）。
   *
   * 与真后端同语义，三条都不许省（省一条，界面在 mock 模式下就会显示一个真部署里不存在的样子）：
   *  ① 按 `agentKey` **跨版本**聚合 —— 按 id 过滤在换版当天就归零；
   *  ② 归属不上的运行（EXPLORATORY / 无归属字段的旧记录）**一条都不出现**；
   *  ③ agent 不存在 → 404 AGENT_NOT_FOUND（与越租户同码）。
   */
  http.get("*/b/v1/agents/:id/runs", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const agent = db.agents.find((a) => a.id === String(params.id));
    if (!agent) return err(404, "AGENT_NOT_FOUND", `agent not found: ${String(params.id)}`);
    return HttpResponse.json({
      agentId: agent.id,
      agentKey: agent.key,
      // WO-AGENTRUN-FANOUT-PERSIST · 次序也照抄真后端（`listByAgent`: `created_at DESC NULLS LAST, id DESC`）。
      // 此前 mock 直接用数组序，恰好与倒序一致所以看不出来 —— 一加会诊子运行（时间更晚但排在数组末尾）
      // 当场就漂。「恰好对」不是「对」，靠数组序等于把正确性押在字面量的书写顺序上。
      runs: AGENT_RUNS.filter((r) => r.agentKey === agent.key && r.tenantId === TENANT_ID).sort((a, b) =>
        (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id),
      ),
    });
  }),

  http.get("*/b/v1/queries/:taskId", ({ params }) => {
    const task = db.tasks.get(String(params.taskId));
    if (!task) return err(404, "NOT_FOUND", "任务不存在");
    return HttpResponse.json({
      id: task.id,
      tenantId: TENANT_ID,
      userId: "usr-planner",
      packageId: PACKAGE_ID,
      conversationId: "conv-1",
      query: task.query,
      context: task.context,
      status: "COMPLETED",
      path: task.plan.path,
      classification: {
        candidates: task.plan.intentKey ? [{ intentKey: task.plan.intentKey, confidence: 0.93 }] : [],
        outOfCatalog: task.plan.path === "AGENT",
        extractedSlots: {},
        latencyMs: 420,
        model: "claude-haiku-4-5",
      },
      matchedIntent: task.plan.intentKey ? { intentId: `int-${task.plan.intentKey}`, intentKey: task.plan.intentKey, version: 1 } : undefined,
      clarificationRounds: task.clarificationRounds,
      answer: task.plan.finalAnswer,
      createdAt: task.createdAt,
      completedAt: new Date().toISOString(),
    });
  }),

  // ---- 意图目录 ----
  http.get("*/b/v1/catalog/packages/:packageId/intents", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    return HttpResponse.json(status ? db.intents.filter((i) => i.status === status) : db.intents);
  }),
  /**
   * WO-BEFE-E 顺带补的 mock 缺口：`createIntent`（agentcore `server.ts` 的
   * `POST /api/v1/catalog/packages/:packageId/intents`）**此前没有 handler**。
   * 后果不只在测试里：`VITE_MOCK=1` 下点 CatalogPage 的「创建意图」（`cta-intent`）会撞
   * `onUnhandledRequest:"error"` —— 那颗按钮在 mock 态一直是死的。
   * 状态机照抄后端：新意图一律 `DRAFT`、版本从 1 起。
   */
  http.post("*/b/v1/catalog/packages/:packageId/intents", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const packageId = String((params as { packageId: string }).packageId);
    const intent = {
      id: newId("int"), packageId, version: 1, status: "DRAFT" as const,
      createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
      ...body,
    } as (typeof db.intents)[number];
    db.intents.push(intent);
    return HttpResponse.json(intent, { status: 201 });
  }),
  http.put("*/b/v1/catalog/intents/:intentId", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    if (intent.status !== "DRAFT") return err(409, "INVALID_STATE", "仅 DRAFT 可改");
    Object.assign(intent, body);
    return HttpResponse.json(intent);
  }),
  // C10 试分类（确定性词法打分，无 LLM）：真后端 POST /b/v1/intents/classify-preview。mock 用 query token 与意图 name/examples 交集打分。
  http.post("*/b/v1/intents/classify-preview", async ({ request }) => {
    const { query } = ((await request.json().catch(() => ({}))) ?? {}) as { query?: string };
    const tok = (s: string): Set<string> => {
      const out = new Set<string>();
      for (const m of s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) out.add(m);
      for (const m of s.match(/[一-龥]/g) ?? []) out.add(m);
      return out;
    };
    const qtok = tok(query ?? "");
    const scored = db.intents
      .filter((i) => i.status === "PUBLISHED")
      .map((i) => {
        const itok = tok([i.name, i.description, ...(i.examples ?? [])].join(" "));
        const inter = [...qtok].filter((x) => itok.has(x)).length;
        return { intentKey: i.key, name: i.name, score: qtok.size ? inter / qtok.size : 0 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const top = scored[0] && scored[0].score > 0 ? scored[0].intentKey : null;
    return HttpResponse.json({ matched: scored, top, outOfCatalog: top === null });
  }),
  http.post("*/b/v1/catalog/intents/:intentId/publish", ({ params }) => {
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    if (intent.slots.length === 0) return err(422, "PLAN_VALIDATION_ERROR", "slots 为空，无法发布");
    intent.status = "PUBLISHED";
    return HttpResponse.json(intent);
  }),
  http.post("*/b/v1/catalog/intents/:intentId/retire", ({ params }) => {
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    intent.status = "RETIRED";
    return HttpResponse.json(intent);
  }),
  http.get("*/b/v1/catalog/packages/:packageId/plans", () => HttpResponse.json(db.plans)),
  // G-4：自助创建执行计划（消裁决#27 死路 —— 意图可绑定新建计划）
  http.post("*/b/v1/catalog/packages/:packageId/plans", async ({ params, request }) => {
    const body = (await request.json()) as { key?: string; steps?: Record<string, unknown>[] };
    const plan = {
      id: `plan_${Date.now()}`, packageId: String((params as { packageId: string }).packageId),
      key: body.key ?? `plan_${Date.now()}`, version: 1, status: "DRAFT",
      steps: body.steps ?? [],
    };
    db.plans.push(plan);
    return HttpResponse.json(plan, { status: 201 });
  }),
  // ── WO-BEFE-E · 执行计划改 / 发布（后端 agentcore server.ts:653 / :661）───────────
  // 两条状态机判据照抄后端 `catalog/service.ts:243/:271`，**不放宽**：
  //   · 非 DRAFT 改 → 409 INVALID_STATE（`service.ts:246`）
  //   · 非 DRAFT 发 → 409 INVALID_STATE（`service.ts:274`）
  //   · 步骤不以 `render_answer` 收尾 → 400 PLAN_VALIDATION_ERROR（`service.ts:276` requireRenderAnswer）
  // 桩若把这三条放宽，前端"发不出去时屏上说什么"这一支就永远测不到（而那正是用户最常撞的墙）。
  http.put("*/b/v1/catalog/plans/:planId", async ({ params, request }) => {
    const plan = db.plans.find((p) => p.id === String((params as { planId: string }).planId));
    if (!plan) return err(404, "PLAN_NOT_FOUND", "计划不存在");
    if (plan.status !== "DRAFT") return err(409, "INVALID_STATE", "仅 DRAFT 状态的计划可修改");
    const patch = (await request.json()) as { key?: string; steps?: Record<string, unknown>[] };
    if (patch.key !== undefined) plan.key = patch.key;
    if (patch.steps !== undefined) plan.steps = patch.steps;
    return HttpResponse.json(plan);
  }),
  http.post("*/b/v1/catalog/plans/:planId/publish", ({ params }) => {
    const plan = db.plans.find((p) => p.id === String((params as { planId: string }).planId));
    if (!plan) return err(404, "PLAN_NOT_FOUND", "计划不存在");
    if (plan.status !== "DRAFT") return err(409, "INVALID_STATE", "仅 DRAFT 状态的计划可发布");
    const last = plan.steps[plan.steps.length - 1];
    if (plan.steps.length === 0 || (last as { type?: string } | undefined)?.type !== "render_answer") {
      return err(400, "PLAN_VALIDATION_ERROR", "计划必须以 render_answer 步骤收尾");
    }
    plan.status = "PUBLISHED";
    // 影响面 = 引用本计划的意图反查（后端 `planImpact`·service.ts:252 同口径：按 planId 或 planRef.planKey）。
    const refs = db.intents.filter(
      (i) => i.status !== "RETIRED" && (i.planId === plan.id || (i.planRef && i.planRef.planKey === plan.key)),
    );
    return HttpResponse.json({
      ...plan,
      impact: { agents: 0, plans: 0, intents: refs.length, refs: refs.map((i) => ({ kind: "intent", key: i.key, version: i.version, name: i.name })) },
    });
  }),

  // ---- 兜底运营 ----
  http.get("*/b/v1/ops/fallback-stats", () => HttpResponse.json({ items: FALLBACK_CLUSTERS })),
  http.post("*/b/v1/ops/fallback/:traceId/promote", ({ params }) => {
    const cluster = FALLBACK_CLUSTERS.find((c) => c.traceId === params.traceId);
    const intentId = newId("int");
    db.intents.push({
      id: intentId,
      packageId: PACKAGE_ID,
      key: `incubated_${intentId}`,
      version: 1,
      status: "DRAFT",
      name: `孵化意图（${cluster?.querySample.slice(0, 12) ?? "新"}…）`,
      description: "由兜底留痕孵化，待人工补全",
      examples: cluster ? [cluster.querySample] : [],
      enabledViews: "*",
      slots: [],
      planId: PLANS[0]!.id,
      riskLevel: "READ",
      owner: "ops",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return HttpResponse.json({ intentId });
  }),

  // ---- 运营自动化 OpsSchedule（§6） ----
  http.get("*/a/v1/ops/schedule", () => HttpResponse.json({ schedule: db.opsSchedule })),
  http.put("*/a/v1/ops/schedule", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    db.opsSchedule = {
      ...(body as object),
      tenantId: TENANT_ID,
      updatedAt: new Date().toISOString(),
      updatedBy: "usr_demo_admin",
    } as typeof db.opsSchedule;
    return HttpResponse.json({ schedule: db.opsSchedule });
  }),

  // ---- agents / workflows / skills / mcp ----
  http.get("*/b/v1/agents", () => HttpResponse.json(db.agents)),
  http.put("*/b/v1/agents/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const agent = db.agents.find((a) => a.id === params.id);
    if (!agent) return err(404, "NOT_FOUND", "Agent 不存在");
    Object.assign(agent, body);
    return HttpResponse.json(agent);
  }),
  http.post("*/b/v1/agents/:id/publish", ({ params }) => {
    const agent = db.agents.find((a) => a.id === params.id);
    if (!agent) return err(404, "NOT_FOUND", "Agent 不存在");
    const errors: { field: string; message: string }[] = [];
    if (agent.scopeDeclaration.objectTypes.length === 0) errors.push({ field: "scopeDeclaration.objectTypes", message: "必须声明对象类型范围（最小授权）" });
    if (!agent.systemPrompt) errors.push({ field: "systemPrompt", message: "系统提示词不能为空" });
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    agent.status = "PUBLISHED";
    return HttpResponse.json({ ok: true });
  }),

  http.get("*/b/v1/workflows", () => HttpResponse.json(db.workflows)),
  // G-4：自助创建工作流（此前无创建入口）
  http.post("*/b/v1/workflows", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const base = structuredClone(db.workflows[0] ?? {}) as Record<string, unknown>;
    const wf = { ...base, ...body, id: `wf_${Date.now()}`, tenantId: "demo", version: 1, status: "DRAFT" } as unknown as (typeof db.workflows)[number];
    db.workflows.push(wf);
    return HttpResponse.json(wf, { status: 201 });
  }),
  http.put("*/b/v1/workflows/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "NOT_FOUND", "Workflow 不存在");
    Object.assign(wf, body);
    return HttpResponse.json(wf);
  }),
  // C8 试运行（编辑器内所见即所得）：真后端走执行引擎；mock 给确定性步骤输出 + 渲染结果。
  http.post("*/b/v1/workflows/:id/run", ({ params }) => {
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "WORKFLOW_NOT_FOUND", "Workflow 不存在");
    const stepOutputs: Record<string, unknown> = {};
    for (const s of wf.steps) stepOutputs[s.id] = { type: s.type, ok: true };
    const renderStep = wf.steps.find((s) => s.type === "render_answer");
    return HttpResponse.json({
      runId: `wfr_mock_${wf.id}`,
      status: "COMPLETED",
      answer: renderStep ? { blocks: (renderStep.params as { blocks?: unknown[] }).blocks ?? [] } : { blocks: [] },
      stepOutputs,
    });
  }),
  http.post("*/b/v1/workflows/:id/publish", async ({ params, request }) => {
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "NOT_FOUND", "Workflow 不存在");
    const { force } = ((await request.json().catch(() => ({}))) ?? {}) as { force?: boolean };
    const errors = validateWorkflow(wf.steps);
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    // 引用模式增量 §2.3 破坏性门禁（mock：名称含 [breaking] 模拟 inputs 不兼容 + latest 引用方）
    const referrers = db.agents.filter((a) => a.tools.some((t) => t.kind === "WORKFLOW" && t.workflowId === wf.id && t.version === "latest"));
    if (wf.name.includes("[breaking]") && referrers.length > 0 && !force) {
      return err(409, "BREAKING_CHANGE_WITH_LATEST_REFS", `破坏性变更且存在 latest 引用方：${referrers.map((a) => `agent:${a.name}`).join("、")}`);
    }
    wf.status = "PUBLISHED";
    return HttpResponse.json({
      ok: true,
      impact: { agents: referrers.length, plans: 0, intents: 0, refs: referrers.map((a) => ({ kind: "agent", key: a.key, version: a.version, name: a.name })) },
      ...(force ? { forced: true } : {}),
    });
  }),

  http.get("*/b/v1/skills", () => HttpResponse.json(db.skills)),
  // G-4：自助创建技能（此前无创建入口）
  http.post("*/b/v1/skills", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const base = structuredClone(db.skills[0] ?? {}) as Record<string, unknown>;
    const sk = { ...base, ...body, id: `skl_${Date.now()}`, version: 1, status: "DRAFT", resources: [] } as unknown as (typeof db.skills)[number];
    db.skills.push(sk);
    return HttpResponse.json(sk, { status: 201 });
  }),
  http.put("*/b/v1/skills/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const s = db.skills.find((x) => x.id === params.id);
    if (!s) return err(404, "NOT_FOUND", "Skill 不存在");
    Object.assign(s, body);
    return HttpResponse.json(s);
  }),
  /**
   * Skill 发布 —— **含引用存在性门**，口径照真后端 `server.ts` 的 `/b/v1/skills/:id/publish`
   * （2026-08-09 WO-SKILL-REFCLOSURE-A 把 `probeMissingRefs` 接上了这条路）。
   *
   * 为何 mock 也必须带这道门：本单要在界面上暴露「发布被拒时到底哪条引用死了」。
   * 若 mock 无脑 `status = "PUBLISHED"`，那段 UI 在 mock 模式下**永远走不到**，
   * 就成了"只在真后端才存在的分支"——测试与手跑都验不到它，典型的「接了线没数据」。
   *
   * 与真后端一字对齐的三件事（改动其一即口径分家）：
   *   ① HTTP 422 + code `SKILL_REF_UNRESOLVED`
   *   ② message：`技能引用存在死路（N 项，发布被拒且未落库）：…；…`，每项形如 `求解器「k」在 DataCore 未注册`
   *   ③ **未落库**：被拒时 status 保持原值，不得改成 PUBLISHED
   * 覆盖范围同真后端：只探 solver / rule / ontologyType 三种 kind，且只探 `required !== false` 的；
   * references 与 dependsOn 一起探。constraint/slice/workflow/agent 今天两侧都无人校验，别在此补——
   * mock 比真后端严会造出"本地红、线上绿"的反向假信号。
   */
  http.post("*/b/v1/skills/:id/publish", ({ params }) => {
    const s = db.skills.find((x) => x.id === params.id);
    if (!s) return err(404, "NOT_FOUND", "Skill 不存在");
    const crossRefs = [...(s.references ?? []), ...(s.dependsOn ?? [])].filter((r) => r.required !== false);
    const solverKeys = new Set(MOCK_SOLVER_REGISTRY.map((x) => x.key as string));
    const ruleKeys = new Set(db.rules.map((r) => r.key));
    const objectTypes = new Set(GRAPH.nodes.map((n) => n.key));
    const dead = [
      ...crossRefs.filter((r) => r.kind === "solver" && !solverKeys.has(r.key)).map((r) => `求解器「${r.key}」在 DataCore 未注册`),
      ...crossRefs.filter((r) => r.kind === "rule" && !ruleKeys.has(r.key)).map((r) => `规则「${r.key}」在 DataCore 规则库不存在`),
      ...crossRefs.filter((r) => r.kind === "ontologyType" && !objectTypes.has(r.key)).map((r) => `对象类型「${r.key}」在 DataCore 本体不存在`),
    ];
    if (dead.length > 0) {
      // 未落库：故意不动 s.status。
      return err(422, "SKILL_REF_UNRESOLVED", `技能引用存在死路（${dead.length} 项，发布被拒且未落库）：${dead.join("；")}`);
    }
    s.status = "PUBLISHED";
    return HttpResponse.json(s);
  }),

  /**
   * Skill 编译（WO-UNBLOCK-SKILL-FE 接前端）——口径照真后端
   * `apps/agentcore/src/server.ts:1430` → `skill-compiler.ts:238 compileSkill`。
   *
   * **对齐的部分**（改动其一即口径分家）：
   *  ① ①Parser 与 ③图派生**直接调 contracts 的同一份纯函数**（`parseSkillToAst` / `deriveSkillReasoningGraph`）
   *     —— 不是"照着抄一遍"，是同一份实现，故 AST 与推理图在 mock 与真后端逐字节一致；
   *  ② `stages[]` 五段齐全，`optimize` / `package` 恒 `NOT_IMPLEMENTED`（后端的诚实位，界面靠它说真话）；
   *  ③ 诊断按 `code + path + message` 字典序排（同 `skill-compiler.ts:64 sortDiagnostics`）；
   *  ④ `ok = 无 error 级诊断`（同 `skill-compiler.ts:242`）；
   *  ⑤ 只读：不落库、不改 status、不发事件。
   *
   * ⚠️ **mock 比真后端「松」的两条（诚实边界 · 方向是刻意选的）**：
   *  · `GV-LINT`：真后端全量复用 `lintSkill`（`apps/agentcore/src/skill-lint.ts`），那是 agentcore 的源码，
   *    跨 app import 是本仓禁止的（contracts-only-shared），故 mock **产不出** GV-LINT 诊断。
   *  · `RG-TOOL`：需要平台工具注册表（`apps/agentcore/src/tools/registry.ts`），同上不可达。
   *  松而不严是**刻意的方向**：mock 比真后端严会造出"本地红、线上绿"的反向假信号
   *  （见上方 publish handler 的同款注释）。松的代价是本地看不到 lint 类诊断——
   *  但诊断表本身的渲染路径由下面几条 contracts 可导出的诊断照常驱动，不是空表。
   */
  http.post("*/b/v1/skills/:id/compile", ({ params }) => {
    const skill = db.skills.find((x) => x.id === params.id);
    if (!skill) return err(404, "SKILL_NOT_FOUND", `skill not found: ${String(params.id)}`);

    const ast = parseSkillToAst(skill);
    const graph = deriveSkillReasoningGraph(ast);
    const diagnostics: SkillCompileDiagnostic[] = [];

    // GR-REACH：节点集合必须与声明的引用逐条对账（与真后端共用 contracts 的同两个函数）
    if (JSON.stringify(skillGraphRefKeys(graph)) !== JSON.stringify(skillDeclaredRefKeys(skill))) {
      diagnostics.push({
        code: "GR-REACH", severity: "error", path: "/references",
        message: "推理图节点集合与声明的引用不一致——有引用没长出节点，或有节点凭空冒出",
        evidence: `graph=[${skillGraphRefKeys(graph).join(",")}] declared=[${skillDeclaredRefKeys(skill).join(",")}]`,
      });
    }
    // GR-APPROVAL：写模式技能必须派生出 create_action_draft（R4 真值经 Action）
    if (ast.skill.writeMode && !ast.tools.some((t) => t.name === "create_action_draft")) {
      diagnostics.push({
        code: "GR-APPROVAL", severity: "error", path: "/sideEffect",
        message: "写模式技能未派生出 create_action_draft —— 它将无法产出可审批的行动草案",
        evidence: `sideEffect=${ast.skill.sideEffect ?? "none"} approvalGate=${ast.skill.approvalGate ?? "none"}`,
      });
    }
    // IO-OUTPUT-CONSUMER：声明了 outputSchema 但本切片没有运行时包去消费它
    if (ast.io.outputSchema !== null) {
      diagnostics.push({
        code: "IO-OUTPUT-CONSUMER", severity: "warning", path: "/outputSchema",
        message: "outputSchema 已声明，但本编译切片未产出运行时包，故此声明目前无人消费",
        evidence: "SkillRuntimePackage 段 NOT_IMPLEMENTED（WO-SKILL-PACKAGE）",
      });
    }
    // GR-STEPS-NO-DATA：`execution.steps` 契约上尚不存在 ⇒「接了线没数据」，不是「没有步骤」
    if (!ast.execution.declared) {
      diagnostics.push({
        code: "GR-STEPS-NO-DATA", severity: "info", path: "/execution/steps",
        message:
          "Skill.execution.steps 在 SkillDefinitionSchema 上尚不存在（迁移线在建），故确定性步骤段恒空——" +
          "属「接了线没数据」，不是「这个技能没有步骤」。本编译器不做任何别名回退：名字对不上就该空得刺眼。",
        evidence: "对名裁决 2026-08-09 · 唯一字段名 execution.steps",
      });
    }
    // RG-NOT-WIRED：跨系统引用可达性今天不校验，必须说出来
    const unprobed = [...ast.ontology, ...ast.rules, ...ast.slices, ...ast.solvers, ...ast.agents, ...ast.workflows];
    if (unprobed.length > 0) {
      diagnostics.push({
        code: "RG-NOT-WIRED", severity: "info", path: "/references",
        message:
          `${unprobed.length} 条非 skill 引用未做存在性校验：引用探针 probeMissingRefs 今天只接在 workflow / agent ` +
          "发布路上，skill 这条路没接，且其自身 fail-open。接线 + 改发布期 fail-closed 属另一张单（PRD §4.3.1）。",
        evidence: unprobed.map((r) => `${r.kind}:${r.key}`).sort().join(","),
      });
    }
    diagnostics.sort((a, b) => {
      const ka = `${a.code} ${a.path} ${a.message}`;
      const kb = `${b.code} ${b.path} ${b.message}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const hasError = diagnostics.some((d) => d.severity === "error");
    const stages: SkillCompileStageReport[] = [
      { stage: "parse", status: "OK", note: "SkillDefinition → SkillAst（纯函数·contracts/skill-compile.ts）" },
      {
        stage: "validate", status: hasError ? "FAILED" : "OK",
        note:
          "复用既有 lintSkill（skill-lint.ts:234）+ 工具注册表反查 + 图/引用对账。" +
          "**未含**跨系统引用可达性探针（probeMissingRefs 未接 skill 路，见 RG-NOT-WIRED 诊断）。" +
          "【mock 模式】lintSkill 与工具注册表在 agentcore，浏览器不可达 ⇒ 本地看不到 GV-LINT / RG-TOOL 两族诊断。",
      },
      { stage: "graph", status: "OK", note: "AST → SkillReasoningGraph（纯函数·分层拓扑·未经优化）" },
      {
        stage: "optimize", status: "NOT_IMPLEMENTED",
        note:
          "PRD §4.4 Optimizer（拓扑排序 / parallelGroup 分组 / 死节点剪除 / 常量折叠 / 预算下推）本切片未做。" +
          "graph 段给出的是**未优化**的派生图，不要当成优化产物。",
      },
      {
        stage: "package", status: "NOT_IMPLEMENTED",
        note:
          "PRD §4.5 / §6 的 SkillRuntimePackage、digest、manifest.json、signature/ 本切片全未做，归 WO-SKILL-PACKAGE。" +
          "本响应**不含**任何可分发制品。",
      },
    ];

    return HttpResponse.json({
      skillId: skill.id, skillKey: skill.key, skillVersion: skill.version,
      ok: !hasError, ast, graph, diagnostics, stages,
    });
  }),

  /**
   * F14 出厂技能门审计诚实位（`GET /b/v1/ops/skill-seed-gate`）。
   *
   * mock 给 `CLEAN`：本地 fixture 里的种子技能引用都在 `MOCK_SOLVER_REGISTRY` / `db.rules` / `GRAPH` 里
   * （与上方 publish 探针同一份判据），确实审得干净。
   * ⚠️ 不给 `NOT_RUN`：那会让"未审计"成为 mock 模式的常态，看久了就把灰色徽标读成正常——
   * 四态各有各的含义，mock 该给的是它真实对应的那一态。另三态的渲染由测试直接构造响应驱动。
   */
  http.get("*/b/v1/ops/skill-seed-gate", () =>
    HttpResponse.json({
      status: "CLEAN",
      /*
       * WO-SEEDGATE-FRESHNESS 缺陷 A：`ranAt` **按请求现算**，不是写死的常量。
       * mock 里写死一个日期会把「这份数据永远不刷新」这件事在 mock 模式下原样复刻出来——
       * 而那正是本单要修的病。这里如实反映真实后端行为：每次请求都是新时刻。
       */
      ranAt: new Date().toISOString(),
      ttlSeconds: 30,
      tenantId: TENANT_ID,
      checked: db.skills.filter((s) => s.status === "PUBLISHED").length,
      findings: [],
    }),
  ),

  http.get("*/b/v1/mcp-configs", () => HttpResponse.json(db.mcpConfigs)),
  http.post("*/b/v1/mcp-configs/:id/test", () =>
    HttpResponse.json({
      ok: true,
      tools: [
        { name: "demo_weather", description: "查询天气（演示工具）" },
        { name: "demo_exchange_rate", description: "汇率查询（演示工具）" },
      ],
    }),
  ),
  http.post("*/b/v1/mcp-configs", async ({ request }) => {
    const body = (await request.json()) as Record<string, DefaultBodyType>;
    const cfg = { id: newId("mcp"), tenantId: TENANT_ID, name: String(body.name), transport: body.transport, credentialRef: body.credential ? "cred-new" : undefined, status: "ACTIVE" } as never;
    db.mcpConfigs.push(cfg);
    return HttpResponse.json(cfg, { status: 201 });
  }),
  http.put("*/b/v1/mcp-configs/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const cfg = db.mcpConfigs.find((c) => c.id === params.id);
    if (!cfg) return err(404, "NOT_FOUND", "MCP 配置不存在");
    const { credential, ...rest } = body;
    Object.assign(cfg, rest);
    if (credential) cfg.credentialRef = "cred-updated";
    return HttpResponse.json(cfg);
  }),

  // ---- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）----
  http.get("*/a/v1/data-builders", () => HttpResponse.json([DATA_BUILDER_PRESET])),
  http.post("*/a/v1/data-builders/run", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; dryRun?: boolean };
    return HttpResponse.json(mockBuildJob(body));
  }),
  http.get("*/a/v1/data-builders/jobs/list", () => HttpResponse.json(MOCK_BUILD_JOBS)),
  // g8 故事驱动建域 · P1：StoryBuildRun 历史推演记录
  http.get("*/a/v1/databuilder/runs", () => HttpResponse.json(MOCK_STORY_RUNS)),
  // Dogfooding meta（系统自我）
  http.post("*/a/v1/meta/sync", () => HttpResponse.json({ objects: 64, links: 120, byKind: { SystemInvariant: 14, SystemBreakpoint: 8, SystemEvent: 27, SystemDomain: 11, SystemObjectType: 30, SystemGate: 5, SystemSlice: 9 } })),
  http.get("*/a/v1/meta/ontology", () => HttpResponse.json({ total: 104, byKind: { SystemInvariant: 14, SystemBreakpoint: 8, SystemEvent: 27, SystemDomain: 11, SystemObjectType: 30, SystemGate: 5, SystemSlice: 9 } })),
  http.get("*/a/v1/meta/impact", ({ request }) => { const n = new URL(request.url).searchParams.get("node") ?? ""; return HttpResponse.json({ node: `meta_SystemInvariant_${n}`, affected: [{ id: "PRD:PRD-platform-foundry-aip.md", via: "covered_by" }, { id: "meta_SystemBreakpoint_G-5", via: "related_to" }] }); }),
  http.get("*/a/v1/meta/access-policy", () => HttpResponse.json(META_POLICY)),
  http.put("*/a/v1/meta/access-policy", async ({ request }) => { const b = (await request.json()) as { roles: string[] }; META_POLICY.roles = b.roles; return HttpResponse.json(META_POLICY); }),
  http.get("*/a/v1/databuilder/runs/:id", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    return r ? HttpResponse.json(r) : new HttpResponse(null, { status: 404 });
  }),
  // 工业级工作流运行时：持久化步骤状态机（检查点/可重入/可重试/可观测）
  http.get("*/a/v1/databuilder/workflow-runs", () => {
    for (const wf of MOCK_WORKFLOW_RUNS) advanceMockWorkflow(wf); // 轮询列表即推进后台异步运行（逐步实时跳动）
    return HttpResponse.json([...MOCK_WORKFLOW_RUNS].reverse());
  }),
  http.get("*/a/v1/databuilder/workflow-runs/:id", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    advanceMockWorkflow(wf);
    return HttpResponse.json(wf);
  }),
  // A5：FDE 编排工作流节点状态图（mock：从工作流步状态投影 8 语义节点）。
  http.get("*/a/v1/databuilder/workflow-runs/:id/fde-graph", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    advanceMockWorkflow(wf);
    const st = (key: string) => wf.steps.find((s) => s.stepKey === key)?.status ?? "PENDING";
    const map = (s: string) => (s === "SUCCEEDED" ? "DONE" : s);
    const FDE: { key: string; label: string; from: string }[] = [
      { key: "story", label: "意图/故事", from: "" },
      { key: "comprehend", label: "comprehend 倒推", from: "dry_build" },
      { key: "capability", label: "查能力", from: "dry_build" },
      { key: "gap", label: "比差", from: "gap_analysis" },
      { key: "generate", label: "各模块生成", from: "publish_build" },
      { key: "closure", label: "闭包", from: "dry_build" },
      { key: "publish", label: "publish（R4）", from: "publish_build" },
      { key: "launcher", label: "进启动器", from: "inference" },
    ];
    const crossFailed = st("cross_scaffold") === "FAILED";
    const nodes = FDE.map((d) => {
      let status = d.from ? map(st(d.from)) : "DONE";
      let gapCode: string | undefined;
      if (crossFailed && (d.key === "generate" || d.key === "publish")) { status = "FAILED"; gapCode = "SCAFFOLD_HTTP"; }
      return { key: d.key, label: d.label, status, gapCode, io: d.key === "generate" && status === "DONE" ? { out: 16 } : undefined };
    });
    const done = nodes.filter((n) => n.status === "DONE").length;
    const failed = nodes.find((n) => n.status === "FAILED");
    return HttpResponse.json({
      runId: wf.id, status: wf.status, nodes,
      summary: { total: nodes.length, done, failed: nodes.filter((n) => n.status === "FAILED").length, running: nodes.filter((n) => n.status === "RUNNING").length, skipped: nodes.filter((n) => n.status === "SKIPPED").length, pending: nodes.filter((n) => n.status === "PENDING").length, failedAt: failed?.key },
    });
  }),
  http.post("*/a/v1/databuilder/workflow-runs", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; async?: boolean };
    if (body.async) {
      // 异步：返回初始 RUNNING 快照（全 PENDING），后续 GET 逐步推进（推进时受闸约束，见 advanceMockWorkflow）。
      const wf = mockWorkflowRun((body.script ?? "").trim(), body.seed ?? 42, "SUCCEEDED");
      const keep = new Set(storyPipelineOrder().map((n) => n.stepKey));
      wf.steps = wf.steps.filter((s) => keep.has(s.stepKey)); // 停用节点不进轨迹（同 resolvePipelineSteps）
      for (const s of wf.steps) s.status = "PENDING";
      wf.status = "RUNNING";
      wf.storyRunId = undefined;
      MOCK_WORKFLOW_RUNS.push(wf);
      return HttpResponse.json(wf, { status: 202 });
    }
    // 同步：第一条 mock 故意失败（演示断点 + resume 入口）；其余成功
    const status = MOCK_WORKFLOW_RUNS.length === 0 ? "FAILED" : "SUCCEEDED";
    const wf = mockWorkflowRun((body.script ?? "").trim(), body.seed ?? 42, status as "SUCCEEDED" | "FAILED");
    // WO-87：**按生效 story_build pipeline 跑**——停用的节点不执行、配了「要人工放行」的节点停 PAUSED。
    driveMockStoryRun(wf);
    MOCK_WORKFLOW_RUNS.push(wf);
    return HttpResponse.json(wf, { status: wf.status === "FAILED" ? 200 : 201 });
  }),
  http.post("*/a/v1/databuilder/workflow-runs/recover", () => {
    const recovered: string[] = [];
    for (const wf of MOCK_WORKFLOW_RUNS) if (wf.status === "RUNNING") { for (const s of wf.steps) if (s.status === "PENDING") s.status = "SUCCEEDED"; wf.status = "SUCCEEDED"; recovered.push(wf.id as string); }
    return HttpResponse.json({ recovered });
  }),
  http.post("*/a/v1/databuilder/workflow-runs/:id/resume", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    // 重入：失败/PENDING 步全部转 SUCCEEDED，run 收敛（演示自愈）
    for (const s of wf.steps) if (s.status === "FAILED" || s.status === "PENDING") s.status = "SUCCEEDED";
    wf.status = "SUCCEEDED";
    wf.resumedCount = ((wf.resumedCount as number) ?? 0) + 1;
    wf.storyRunId = wf.storyRunId ?? newId("sbr");
    return HttpResponse.json(wf);
  }),
  http.post("*/a/v1/databuilder/runs", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; stage?: string; buildMode?: string };
    const id = newId("sbr");
    const script = (body.script ?? "").trim();
    // g8-P2：stage=manifest → 倒推补录表单（PENDING_INPUT，不建域）
    if (body.stage === "manifest") {
      const run = {
        id,
        tenantId: "demo",
        script,
        inputManifest: {
          runId: id,
          fields: [
            { key: "type:Order", label: "对象类型 · 订单", dataType: "string", required: false, default: "Order", source: "STORY" },
            { key: "seed", label: "确定性 seed（同 seed 重跑字节级一致）", dataType: "number", required: true, default: body.seed ?? 42, source: "ASK_USER" },
            { key: "reuseConnectors", label: "复用既有连接器（可选）", dataType: "string", required: false, source: "REUSE_EXISTING", options: ["合成数据源（确定性生成）"] },
          ],
        },
        producedConnections: [],
        producedDatasets: [],
        status: "PENDING_INPUT",
        createdAt: new Date().toISOString(),
      };
      MOCK_STORY_RUNS.unshift(run);
      return HttpResponse.json(run, { status: 201 });
    }
    // 区7 不可达分支（守"绿测试≠能用"）：脚本含"缺求解器"标记 → 闭包断 + 自检缺口 → 推演不可达
    if (script.includes("缺求解器")) {
      const run = {
        id, tenantId: "demo", script,
        buildPlan: mockBuildPlan("bpl_fail"),
        closureReport: { gatePassed: false, findings: [{ kind: "CHAIN", ref: "solver:ghost_solver", status: "FAILED", detail: "未注册" }], objectsBound: 0, dataOrphans: 0, forwardMissing: 0, chainBroken: 1, shapeBroken: 0 },
        gapReport: { question: script, taskId: id, verdict: "GAP", path: "BOUNDARY", findings: [{ gapCode: "SOLVER_NOT_FOUND", detail: "ghost_solver" }], generatedAt: new Date().toISOString() },
        producedConnections: [], producedDatasets: [], producedArtifacts: [],
        storyCoverage: mockStoryCoverage(script),
        status: "FAILED", createdAt: new Date().toISOString(),
      };
      MOCK_STORY_RUNS.unshift(run);
      return HttpResponse.json(run, { status: 201 });
    }
    const job = mockBuildJob({ script, seed: body.seed }) as { planId: string; closure: unknown };
    const run = {
      id,
      tenantId: "demo",
      script,
      buildPlan: mockBuildPlan(job.planId),
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }, { kind: "intent", key: "intent_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      gapReport: { question: script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      producedArtifacts: mockProducedArtifacts(),
      storyCoverage: mockStoryCoverage(script),
      validationTrace: mockValidationTrace(),
      // WO-DBUI-FLOW：主流程第 ③ 步恒 PROVISIONAL（先隔离物化，第 ⑥ 步才由人裁决入库/只下载）。
      ...(body.buildMode === "PROVISIONAL"
        ? { buildMode: "PROVISIONAL", domainTrustLevel: "UNVERIFIED", provisionalNamespace: `demo::prov::${id}` }
        : { buildMode: "STRICT" }),
      // 比对现状四分（第 ② 步一等内容；改前埋在「展开七阶段 → 点进 gap 那步」三层之下）。
      gapAnalysis: mockGapAnalysis(),
      status: "SUCCEEDED",
      createdAt: new Date().toISOString(),
    };
    MOCK_STORY_RUNS.unshift(run);
    return HttpResponse.json(run, { status: 201 });
  }),
  /**
   * WO-DBUI-FLOW · 入库前冲突复验（**只读**）。三类冲突分开报，绝不合成一个「N 条冲突」。
   * R4：预检不是审批的替代，是审批的输入。
   */
  http.post("*/a/v1/databuilder/runs/:id/promote-precheck", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!r) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      runId: r.id,
      counts: { typeSameKey: 1, linkSameKeyDiffDef: 1, linkSameKeySameDef: 1 },
      conflicts: [
        {
          kind: "TYPE_SAME_KEY", target: "objectType", key: "Order",
          existingValue: { 显示名: "订单（库里既有）", 所属域: "sales", 属性数: "6" },
          incomingValue: { 显示名: "订单", 所属域: "sales", 属性数: "8" },
          changedFields: ["显示名", "属性数"],
          suggestedAction: "USE", availableActions: ["USE"], requiresDecision: false,
        },
        {
          kind: "LINK_SAME_KEY_DIFF_DEF", target: "linkType", key: "order_of_customer",
          existingValue: { 起点类型: "Order", 终点类型: "Account", 基数: "N:1" },
          incomingValue: { 起点类型: "Order", 终点类型: "Customer", 基数: "N:1" },
          changedFields: ["终点类型"],
          suggestedAction: "USE", availableActions: ["USE", "MERGE"], requiresDecision: true,
        },
        {
          kind: "LINK_SAME_KEY_SAME_DEF", target: "linkType", key: "line_of_base",
          existingValue: { 起点类型: "Line", 终点类型: "Base", 基数: "N:1" },
          incomingValue: { 起点类型: "Line", 终点类型: "Base", 基数: "N:1" },
          changedFields: [],
          suggestedAction: "MERGE", availableActions: ["USE", "MERGE"], requiresDecision: false,
        },
      ],
      clean: { objectTypes: 2, linkTypes: 1 },
      drift: {
        gapAtBuild: { needed: 12, existing: 3, toCreate: 9, missing: 0 },
        gapAtPrecheck: { needed: 12, existing: 4, toCreate: 8, missing: 0 },
        diffs: [
          { dim: "gap", field: "existing", atBuild: "3", atPrecheck: "4" },
          { dim: "gap", field: "toCreate", atBuild: "9", atPrecheck: "8" },
        ],
        changed: true,
      },
      pendingDecisions: 1,
      checkedAt: new Date().toISOString(),
    });
  }),
  // A10：终态闭环末步——手动重跑主问句验证（mock：可答则 VERIFIED + 回灌 launcher 节点 DONE）。
  http.post("*/a/v1/databuilder/runs/:id/verify", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!r) return new HttpResponse(null, { status: 404 });
    const reachable = r.status === "SUCCEEDED" && (((r.gapReport as { findings?: unknown[] } | undefined)?.findings?.length ?? 0) === 0);
    r.verification = reachable
      ? { status: "VERIFIED", question: r.script, answer: "经 QOS 实跑：可答", answerable: true, evidence: "RUNTIME_PROBE", verifiedAt: new Date().toISOString() }
      : { status: "NOT_VERIFIED", question: r.script, gapCode: "NOT_ANSWERABLE", verifiedAt: new Date().toISOString() };
    return HttpResponse.json(r);
  }),
  http.post("*/a/v1/databuilder/runs/:id/promote", async ({ params, request }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!r) return new HttpResponse(null, { status: 404 });
    if (r.buildMode !== "PROVISIONAL") return err(400, "VALIDATION_ERROR", "仅 PROVISIONAL 未审核域可整域晋升");
    // WO-DBUI-FLOW：**无裁决不许写** —— 会改写既有链路定义的冲突没有人的裁决时显式报错，绝不静默覆盖。
    let decisions: { target: string; key: string; action: string }[] = [];
    try {
      decisions = (((await request.json()) as { decisions?: typeof decisions })?.decisions) ?? [];
    } catch { /* 老调用方不带 body */ }
    const decided = new Set(decisions.map((d) => `${d.target}:${d.key}`));
    if (!decided.has("linkType:order_of_customer")) {
      return err(400, "VALIDATION_ERROR", "晋升被拦下：1 条冲突会改写既有本体定义，必须先有人的裁决 —— linkType:order_of_customer（终点类型 将被改写）");
    }
    r.domainTrustLevel = "GOVERNED";
    r.domainPromotion = {
      promotedAt: new Date().toISOString(), promotedBy: "usr-planner", fromNamespace: r.provisionalNamespace ?? `demo::prov::${r.id}`,
      migratedObjects: 12, migratedDatasets: 3, migratedConnections: 1, migratedTypes: 2, promotedSolvers: [],
      // 三份诚实名单：沿用了哪些既有类型 / 保留了哪些既有关系 / 经批准覆盖了哪些。
      reusedTypeKeys: ["Order"],
      keptLinkKeys: decisions.filter((d) => d.action === "USE").map((d) => d.key),
      overwrittenLinkKeys: decisions.filter((d) => d.action === "MERGE").map((d) => d.key),
    };
    return HttpResponse.json(r);
  }),
  http.post("*/a/v1/databuilder/stress", async ({ request }) => {
    const body = (await request.json()) as { scripts: string[] };
    const runs = body.scripts.map((script) => {
      const job = mockBuildJob({ script, seed: 42 }) as { planId: string; closure: unknown };
      const id = newId("sbr");
      MOCK_STORY_RUNS.unshift({
        id, tenantId: "demo", script,
        buildPlan: mockBuildPlan(job.planId),
        closureReport: job.closure,
        gapReport: { question: script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
        producedConnections: ["conn_mock"], producedDatasets: ["rds_mock"],
        producedArtifacts: mockProducedArtifacts(), storyCoverage: mockStoryCoverage(script), validationTrace: mockValidationTrace(),
        status: "SUCCEEDED", createdAt: new Date().toISOString(),
      });
      return { key: script.slice(0, 40), runId: id, status: "SUCCEEDED", fullChainOk: true };
    });
    return HttpResponse.json({ total: runs.length, succeeded: runs.length, failed: 0, runs });
  }),
  http.get("*/a/v1/databuilder/generate-scripts", () => HttpResponse.json([
    { key: "affected_orders", script: "针对订单做风险推演分析" },
    { key: "capacity_forecast", script: "针对基地做产能推演分析" },
    { key: "rule_C03", script: "检查订单的产能约束" },
  ])),
  http.post("*/a/v1/databuilder/backfill", () => {
    // g8-P6：逆向导出既有推演能力（风险/产能）→ 逐条建域 → 写入历史 + 压测报告
    const caps = [
      { key: "affected_orders", script: "针对订单做风险推演分析" },
      { key: "capacity_forecast", script: "针对基地做产能推演分析" },
    ];
    const runs = caps.map((c) => {
      const job = mockBuildJob({ script: c.script, seed: 42 }) as { planId: string; closure: unknown };
      const id = newId("sbr");
      MOCK_STORY_RUNS.unshift({
        id, tenantId: "demo", script: c.script,
        buildPlan: mockBuildPlan(job.planId),
        closureReport: job.closure,
        scaffoldReceipt: { items: [{ kind: "scene", key: `scene_${c.key}`, status: "SCAFFOLDED" }], fullChainOk: true },
        gapReport: { question: c.script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
        answer: `${c.key}: capWanP50=1200, capWanP90=900`,
        producedConnections: ["conn_mock"], producedDatasets: ["rds_mock"],
        producedArtifacts: mockProducedArtifacts(), storyCoverage: mockStoryCoverage(c.script), validationTrace: mockValidationTrace(),
        status: "SUCCEEDED", createdAt: new Date().toISOString(),
      });
      return { key: c.key, runId: id, status: "SUCCEEDED", fullChainOk: true };
    });
    return HttpResponse.json({ total: runs.length, succeeded: runs.length, failed: 0, runs });
  }),
  http.patch("*/a/v1/databuilder/runs/:id/inputs", async ({ request, params }) => {
    const body = (await request.json()) as { inputs?: { seed?: number } };
    const run = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!run) return new HttpResponse(null, { status: 404 });
    const job = mockBuildJob({ script: run.script, seed: body.inputs?.seed }) as { planId: string; closure: unknown };
    Object.assign(run, {
      buildPlan: mockBuildPlan(job.planId),
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      producedArtifacts: mockProducedArtifacts(),
      storyCoverage: mockStoryCoverage(run.script),
      validationTrace: mockValidationTrace(),
      status: "SUCCEEDED",
    });
    return HttpResponse.json(run, { status: 201 });
  }),

  // ---- 推演沙盘：view-config / session / scope-precheck ----
  // 最小 mock：让 mock 模式下沙盘控制台可走通；配置驱动·零行业实体名（演示用占位 key）。
  // WO-SIM-SCOPE-LOCAL ③：原本这三条是为 `/v/sim-init` 三步向导铺的，向导已退役 ——
  // `view-config` / `sessions` 沙盘控制台照用；`scope-precheck` 现**无前端调用方**
  // （`endpoints.ts fetchSimScopePrecheck` 随之只剩定义无消费），保留是因为后端端点仍在，
  // 但它已是「实现有、无生产调用方」的形态，见 PRD-sim-scope-local §遗留。
  // ⚠ WO-BEFE-A（2026-08-14）：这条**从写死的桩改成了真派生** —— `stateVars` / `propagationCount` /
  //   `linkTypes` 全部由 `mockPropRules` / `mockLinkTypes` 两个 store 现算，口径逐条镜像后端
  //   `apps/datacore/src/app.ts:1873-1885`（见 store 声明处的对齐说明）。
  //   复验：`pnpm --filter frontend-shell exec vitest run test/ontology-relations.seam.test.tsx`
  //   桩恒回 `propagationCount: 1` 时，「建一条边 ⇒ 推演口径跟着变」根本无从断言 ——
  //   那正是 SEAM-GATE 要堵的「表单能提交」式假绿。
  //   零回归：种子 = 1 条已启用因果边（`s1 → s2`）⇒ `stateVars` / `propagationCount` 与旧桩逐字节相同；
  //   `linkTypes` 由 `["linkAB"]` 变为 mapping/registries 的同三条真 key（同一份真值，不再是第二套占位名）。
  http.get("*/a/v1/sim/view-config", () =>
    HttpResponse.json({
      tenantId: "demo",
      nodeTypes: ["TypeA", "TypeB", "TypeC"],
      // 后端此处**不看 `deprecation`**（`app.ts:1888` `links.map(l => l.key)`）⇒ 停用结构边不减少这个数。
      linkTypes: mockLinkTypes.map((l) => l.key).sort(),
      stateVars: deriveStateVars(),
      radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
      screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
      propagationCount: derivePublishedRules().length,
    }),
  ),

  // ── WO-BEFE-A · 本体关系编辑器的后端镜像（全部对应真路由，非新造语义）──────────
  // `GET /a/v1/sim/propagation-rules`（后端 app.ts:1860）：`published=false` 才看得到停用的边。
  http.get("*/a/v1/sim/propagation-rules", ({ request }) => {
    const publishedOnly = new URL(request.url).searchParams.get("published") !== "false";
    return HttpResponse.json({ items: publishedOnly ? derivePublishedRules() : mockPropRules });
  }),
  // `POST /a/v1/sim/propagation-rules`（后端 app.ts:1865）：id 由服务端铸（后端把它写在 body 展开之后，
  // 传进来的 id 恒被覆盖 —— 这里照做，否则 mock 会比后端"更能干"，把一个真缺口盖掉）。
  http.post("*/a/v1/sim/propagation-rules", async ({ request }) => {
    const b = (await request.json()) as Partial<MockPropRule>;
    const rule: MockPropRule = {
      id: `simpr_mock_${++mockRelSeq}`, tenantId: "demo",
      key: String(b.key ?? ""),
      sourceTypeKey: String(b.sourceTypeKey ?? ""), sourceStateVar: String(b.sourceStateVar ?? ""),
      viaLinkKey: String(b.viaLinkKey ?? ""),
      targetTypeKey: String(b.targetTypeKey ?? ""), targetStateVar: String(b.targetStateVar ?? ""),
      coefficient: Number(b.coefficient ?? 0), delayTicks: Number(b.delayTicks ?? 0),
      combine: "sum", decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null,
      status: b.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    };
    mockPropRules.push(rule);
    return HttpResponse.json(rule, { status: 201 });
  }),
  // `POST /a/v1/ontology/link-types`（后端 app.ts:2918 · `ontology.upsertLinkType` 按 key 幂等升版）。
  http.post("*/a/v1/ontology/link-types", async ({ request }) => {
    const b = (await request.json()) as { key: string; fromTypeKey: string; toTypeKey: string; cardinality: string };
    const existing = mockLinkTypes.find((l) => l.key === b.key);
    if (existing) {
      existing.fromType = b.fromTypeKey; existing.toType = b.toTypeKey; existing.cardinality = b.cardinality;
    } else {
      mockLinkTypes.push({ key: b.key, fromType: b.fromTypeKey, toType: b.toTypeKey, cardinality: b.cardinality });
    }
    return HttpResponse.json(
      { key: b.key, fromTypeKey: b.fromTypeKey, toTypeKey: b.toTypeKey, cardinality: b.cardinality, version: 1 },
      { status: 201 },
    );
  }),
  // `POST /a/v1/ontology/links/:key/deprecate`（后端 app.ts:2797 → `governance.deprecate`）。
  http.post("*/a/v1/ontology/links/:key/deprecate", async ({ params, request }) => {
    const key = decodeURIComponent(String((params as { key: string }).key));
    const l = mockLinkTypes.find((x) => x.key === key);
    if (!l) return err(404, "NOT_FOUND", `link ${key}`);
    const b = (await request.json().catch(() => ({}))) as { supersededBy?: string };
    l.deprecation = { status: "DEPRECATED", supersededBy: b.supersededBy, deprecatedAt: "2026-08-14T00:00:00.000Z", graceUntil: "2026-11-12T00:00:00.000Z" };
    return HttpResponse.json({ key, deprecation: l.deprecation });
  }),
  // `POST /a/v1/ontology/links/:key/retire`（后端 app.ts:2802 → `governance.retire`）。
  // ⚠ 后端在 `references.total > 0` 时**抛 409 并逐条列引用方** —— 这不是异常是设计，mock 照抄，
  //   否则前端那条「还有人引用就不许下线」的分支永远走不到，等于没接。
  http.post("*/a/v1/ontology/links/:key/retire", ({ params }) => {
    const key = decodeURIComponent(String((params as { key: string }).key));
    const l = mockLinkTypes.find((x) => x.key === key);
    if (!l) return err(404, "NOT_FOUND", `link ${key}`);
    const refs = mockElementRefs(key);
    if (refs.length > 0) {
      return err(409, "INVALID_STATE", `link '${key}' 仍被 ${refs.length} 处引用，无法 RETIRE：${refs.map((r) => `${r.refKind}:${r.key}@${r.where}`).join(", ")}`);
    }
    l.deprecation = { ...(l.deprecation ?? { status: "DEPRECATED" }), status: "RETIRED", retiredAt: "2026-08-14T00:00:00.000Z" };
    return HttpResponse.json({ key, status: "RETIRED" });
  }),
  // 对象类型的弃用流程（后端 app.ts:2788/2793 → 与 link 同一个 `governance.deprecate/retire`，只是 kind 不同）。
  http.post("*/a/v1/ontology/types/:key/deprecate", ({ params }) => {
    const key = decodeURIComponent(String((params as { key: string }).key));
    return HttpResponse.json({
      key,
      deprecation: { status: "DEPRECATED", deprecatedAt: "2026-08-14T00:00:00.000Z", graceUntil: "2026-11-12T00:00:00.000Z" },
    });
  }),
  http.post("*/a/v1/ontology/types/:key/retire", ({ params }) => {
    const key = decodeURIComponent(String((params as { key: string }).key));
    // 与 link 侧同口径：还有人引用就 409（后端 `ontology-governance.ts:203` 对两种 kind 是同一段代码）。
    const refs = mockElementRefs(key);
    if (refs.length > 0) {
      return err(409, "INVALID_STATE", `type '${key}' 仍被 ${refs.length} 处引用，无法 RETIRE：${refs.map((r) => `${r.refKind}:${r.key}@${r.where}`).join(", ")}`);
    }
    return HttpResponse.json({ key, status: "RETIRED" });
  }),
  // `GET /a/v1/ontology/references`（后端 app.ts:2808 → `governance.references`，查 element_refs 索引）。
  http.get("*/a/v1/ontology/references", ({ request }) => {
    const u = new URL(request.url);
    const key = u.searchParams.get("key") ?? "";
    if (!u.searchParams.get("elementKind") || !key) return err(400, "VALIDATION_ERROR", "elementKind 与 key 必填");
    const refs = mockElementRefs(key);
    return HttpResponse.json({ refs, total: refs.length });
  }),
  // `GET /a/v1/ontology/versions`（后端 app.ts:2932）：**唯一**带 `deprecation` 的只读口。
  http.get("*/a/v1/ontology/versions", () =>
    HttpResponse.json([
      {
        id: "over_mock_1", version: mockOntologyVersionSeq, createdAt: "2026-08-14T00:00:00.000Z",
        snapshot: {
          linkTypes: mockLinkTypes.map((l) => ({
            key: l.key, fromTypeKey: l.fromType, toTypeKey: l.toType, cardinality: l.cardinality,
            published: true, ...(l.deprecation ? { deprecation: l.deprecation } : {}),
          })),
        },
      },
    ]),
  ),
  // `GET/POST /a/v1/ontology/publish-requests` + signoff（后端 app.ts:2860/2875/2879）。
  // 全域 APPROVE → 后端自动 `publishVersion`（app.ts:2891）；mock 同样在 APPROVED 时推进版本号，
  // 否则「会签通过了、快照没动」在屏上看不出区别。
  http.get("*/a/v1/ontology/publish-requests", ({ request }) => {
    const st = new URL(request.url).searchParams.get("status");
    const all = [...mockPublishRequests.values()];
    return HttpResponse.json(st ? all.filter((p) => p.status === st) : all);
  }),
  http.post("*/a/v1/ontology/publish-requests", async () => {
    const rec: MockPublishRequest = {
      id: `opr_mock_${++mockRelSeq}`, ontologyVersion: mockOntologyVersionSeq + 1, status: "PENDING",
      touchedDomains: ["factory", "product"], signoffs: [], createdAt: "2026-08-14T00:00:00.000Z",
    };
    mockPublishRequests.set(rec.id, rec);
    return HttpResponse.json(rec, { status: 201 });
  }),
  http.post("*/a/v1/ontology/publish-requests/:id/signoff", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const rec = mockPublishRequests.get(id);
    if (!rec) return err(404, "NOT_FOUND", `publish request ${id}`);
    const b = (await request.json()) as { decision: "APPROVE" | "REJECT" };
    if (b.decision === "REJECT") {
      rec.status = "REJECTED";
    } else {
      rec.signoffs.push({ domainKey: rec.touchedDomains[rec.signoffs.length] ?? "factory", decision: "APPROVE" });
      if (rec.signoffs.length >= rec.touchedDomains.length) {
        rec.status = "APPROVED";
        mockOntologyVersionSeq = rec.ontologyVersion; // 全域通过 → 快照真的固化了
      }
    }
    return HttpResponse.json(rec);
  }),
  http.post("*/a/v1/sim/sessions", async ({ request }) => {
    const body = (await request.json()) as { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> };
    const base = body.baseSnapshot ?? {};
    // WO-L4B：id 保留首个 `sims_mock`（既有用例按此断言），其后递增；会话与世界态双双落 store。
    const id = mockSimSessions.size === 0 ? "sims_mock" : `sims_mock_${++mockSimSeq}`;
    const s: MockSimSession = { id, tenantId: "demo", baseSnapshot: base, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-09T00:00:00.000Z" };
    mockSimSessions.set(id, s);
    mockSimWorlds.set(id, { tick: 0, state: base });
    rememberTickState(id, 0, base);
    return HttpResponse.json(s, { status: 201 });
  }),
  // WO-L4B · 世界列表（= 前端 sessionsQuery 的真数据源；后端对应 app.ts:1405）。
  http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [...mockSimSessions.values()] })),
  // ── WO-ACTIVE-EDGE-UX · 推演边 active 开关三条（后端对应 app.ts 的
  //    GET /sim/propagation-rules · PATCH …/disabled-rules · POST …/counterfactual）──
  //
  // 🔴 本组 mock 的纪律与上面「扰动」那组同源：**只供世界态，绝不冒充引擎**。
  //    差值 `diffs` 由**契约函数** `diffTickStates` 现算（与真后端同一支实现），
  //    mock 只负责给出"边开着"与"边关掉"两份世界态 —— 这样一来：
  //      · 差值算法只有一份，mock 与真后端不可能在算术上漂移；
  //      · 而"关掉这条边世界会长什么样"这件事，mock 老老实实承认是 fixture，不假装是算出来的。
  //    反面教材就在本文件不远处：mock 复制引擎语义 ⇒ 第二套真相源 ⇒ 前端测试全绿而真链路早断。
  //
  // 📅 复验（2026-08-14 实测）：`grep -n "diffTickStates" apps/frontend-shell/src/mocks/handlers.ts`
  //    应只见 import 与调用点各一处 —— mock 与真后端命中**同一个**契约函数；
  //    哪天这里出现自算差值的代码，就是第二套真相源。
  // （原此处有第 2 个 `GET /a/v1/sim/propagation-rules` handler，与 :5819 撞车、先匹配先赢导致它永不触发 ⇒ 已删，单一 handler 见上方。）
  http.patch("*/a/v1/sim/sessions/:id/disabled-rules", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const body = (await request.json().catch(() => ({}))) as { disabledRuleKeys?: string[] };
    const requested = body.disabledRuleKeys ?? [];
    // 与真后端同一条纪律：未知 key **显式 400**，不静默忽略（静默忽略 = 用户以为关掉了、其实没关）。
    const unknown = unknownPropagationRuleKeys(requested, MOCK_PROPAGATION_RULES);
    if (unknown.length > 0) {
      return HttpResponse.json(
        { error: { code: "UNKNOWN_PROPAGATION_RULE_KEY", message: `未知传导规则 key：${unknown.join(", ")}`, requestId: "mock" } },
        { status: 400 },
      );
    }
    const s = mockSimSessions.get(id);
    const keys = [...new Set(requested)].sort();
    if (s) s.disabledRuleKeys = keys;
    return HttpResponse.json({ id, disabledRuleKeys: keys });
  }),
  http.post("*/a/v1/sim/sessions/:id/counterfactual", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const body = (await request.json().catch(() => ({}))) as { n?: number; disabledRuleKeys?: string[] };
    const disabled = [...new Set(body.disabledRuleKeys ?? mockSimSessions.get(id)?.disabledRuleKeys ?? [])].sort();
    const unknown = unknownPropagationRuleKeys(disabled, MOCK_PROPAGATION_RULES);
    if (unknown.length > 0) {
      return HttpResponse.json(
        { error: { code: "UNKNOWN_PROPAGATION_RULE_KEY", message: `未知传导规则 key：${unknown.join(", ")}`, requestId: "mock" } },
        { status: 400 },
      );
    }
    const suppressed = MOCK_PROPAGATION_RULES.filter((r) => disabled.includes(r.key));
    // fixture 世界：基线 = 边全开跑一格；反事实 = 每关掉一条边，其目标格少收一份 `coefficient×源值`。
    // 这是**声明的 fixture**，不是引擎复制品；真后端那一版由 `propagateTick` 真算。
    const baselineState: Record<string, Record<string, number>> = { "TypeA#0": { s1: 60, s2: 40 }, "TypeB#0": { s1: 30, s2: 25 } };
    const counterfactualState: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(baselineState)) as typeof baselineState;
    for (const r of suppressed) {
      const cell = counterfactualState[`${r.targetTypeKey}#0`];
      if (cell && typeof cell[r.targetStateVar] === "number") {
        cell[r.targetStateVar] = Number((cell[r.targetStateVar]! - r.coefficient * (baselineState[`${r.sourceTypeKey}#0`]?.[r.sourceStateVar] ?? 0)).toFixed(6));
      }
    }
    return HttpResponse.json({
      fromTick: mockSimSessions.get(id)?.curTick ?? 0,
      ticks: body.n ?? 1,
      disabledRuleKeys: disabled,
      suppressedRules: suppressed,
      baselineState,
      counterfactualState,
      diffs: diffTickStates(baselineState, counterfactualState), // ← 契约唯一实现，mock 不另写一份差值算法
      // fixture 世界里这几条边确实"跑过"（基线态就是它们跑出来的），故如实回填。
      suppressedRulesFiredInBaseline: suppressed.map((r) => r.key).sort(),
    });
  }),
  // WO-L4B · 当前世界态（= worldQuery 的真数据源；后端对应 app.ts:1410）。
  http.get("*/a/v1/sim/sessions/:id/world", ({ params }) => {
    const id = String((params as { id: string }).id);
    return HttpResponse.json(mockSimWorlds.get(id) ?? { tick: 0, state: {} });
  }),
  // ── WO-SIM-PERTURB-TIMELINE · 扰动一等公民三条（后端对应 datacore app.ts 的 POST/GET/DELETE …/perturbations）──
  // GET 是**扰动时间轴的真数据源**；POST 是施加口在 mock 模式下的镜像（WO-SIM-ACT-CLOSE 只接了真后端）。
  // 施加语义只做入库 + 世界态就地改写（与 datacore `simApplyAtCurrentTick` 同语义），
  // 不复制引擎的传导 —— mock 冒充引擎就是第二套真相源。
  http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const b = (await request.json()) as Record<string, unknown>;
    const cur = mockSimWorlds.get(id) ?? { tick: 0, state: {} };
    const p = {
      id: `simpert_mock_${++mockPertSeq}`,
      tenantId: "demo",
      sessionId: id,
      kind: b.kind,
      targetObjectId: String(b.targetObjectId),
      targetStateVar: String(b.targetStateVar),
      startTick: typeof b.startTick === "number" ? b.startTick : cur.tick,
      durationTicks: (b.durationTicks ?? null) as number | null,
      magnitude: Number(b.magnitude),
      mode: (b.mode ?? "set") as "set" | "delta" | "scale",
      label: String(b.label ?? ""),
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    mockSimPerturbations.set(id, [...(mockSimPerturbations.get(id) ?? []), p]);
    const state = { ...(cur.state as Record<string, Record<string, number>>) };
    const bucket = { ...(state[p.targetObjectId] ?? {}) };
    const before = Number(bucket[p.targetStateVar] ?? 0);
    bucket[p.targetStateVar] = p.mode === "delta" ? before + p.magnitude : p.mode === "scale" ? before * p.magnitude : p.magnitude;
    state[p.targetObjectId] = bucket;
    mockSimWorlds.set(id, { tick: cur.tick, state });
    // WO-BEFE-E：扰动就地改写的是**本 tick 的态**，故同步覆盖历史里那一格 ——
    // 否则「施加扰动 → 存档 → 再扰动 → 回滚」拿回来的会是扰动前的旧态，回滚看起来"多回了一步"。
    rememberTickState(id, cur.tick, state);
    return HttpResponse.json({ perturbation: p, curTick: cur.tick, state }, { status: 201 });
  }),
  http.get("*/a/v1/sim/sessions/:id/perturbations", ({ params }) =>
    HttpResponse.json({ items: mockSimPerturbations.get(String((params as { id: string }).id)) ?? [] }),
  ),
  http.delete("*/a/v1/sim/sessions/:id/perturbations/:pid", ({ params }) => {
    const { id, pid } = params as { id: string; pid: string };
    const rows = mockSimPerturbations.get(String(id)) ?? [];
    // 删的是记录，**不回滚世界态**（与后端同语义：回滚走 checkpoint/rollback）。
    mockSimPerturbations.set(String(id), rows.filter((r) => r.id !== String(pid)));
    return HttpResponse.json({ deleted: true });
  }),
  http.get("*/a/v1/sim/sessions/:id/scope-precheck", ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "LOCAL" ? "LOCAL" : "GLOBAL";
    return HttpResponse.json({
      scope,
      targetRef: scope === "LOCAL" ? url.searchParams.get("target") : null,
      worldCompleteness: {
        pct: 50, // = 100 × (1+0+1) / (2+1+1)：WO-CERT-HONESTY ① 删掉重复的 stateVars 行后重算
        derivationRules: { present: 1, needed: 2 },
        actions: { present: 0, needed: 1 },
        propagationRules: { present: 1, needed: 1 },
        stateVarKeys: ["s2", "s3"],
        entering: [
          { key: "s1", kind: "DERIVATION", source: "deriv:s1" },
          { key: "s2", kind: "PROPAGATION", source: "prop:linkAB" },
        ],
      },
      canEnterSimulation: false,
      gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    });
  }),
  // ---- 推演沙盘 P0（增量 4 · Agent I）：tick / checkpoint / branch / compare / certification 最小 mock ----
  http.post("*/a/v1/sim/sessions/:id/tick", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { n?: number };
    const n = body.n ?? 1;
    // 占位递增态（mock 模式仅证交互；真后端走传导核）。
    const state = { "TypeA#0": { s1: 50 + n * 5, s2: 40 } };
    // WO-L4B：真后端 tick 在 emit 前写了 status=RUNNING + curTick（app.ts:1465），mock 镜像之，
    // 否则「世界列表随 tick 更新」这条断言在 mock 上永远看不出差别。
    const id = String((params as { id: string }).id);
    const s = mockSimSessions.get(id);
    if (s) { s.curTick = n; s.status = "RUNNING"; }
    mockSimWorlds.set(id, { tick: n, state });
    rememberTickState(id, n, state);
    return HttpResponse.json({ curTick: n, state });
  }),
  // WO-BEFE-E：存档改**有状态**（原先恒回 `cp_mock`/`tick:1`，存两次也只看得到一条 ⇒ 清单证明不了任何事）。
  // `tick` 取世界当前 tick（与后端 app.ts:1795 `tick: s.curTick` 同语义），不再写死 1。
  http.post("*/a/v1/sim/sessions/:id/checkpoint", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { label?: string };
    const id = String((params as { id: string }).id);
    const tick = mockSimWorlds.get(id)?.tick ?? 0;
    const seq = ++mockCpSeq;
    const cp = {
      id: `simcp_mock_${seq}`, sessionId: id, tenantId: "demo", tick,
      label: body.label ?? `tick${tick}`,
      // 确定性时间戳：序号 → 固定基准日的秒偏移（无 `new Date()`，同一串操作重跑字节级一致 R6）。
      createdAt: `2026-08-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
    };
    mockSimCheckpoints.set(id, [...(mockSimCheckpoints.get(id) ?? []), cp]);
    return HttpResponse.json(cp, { status: 201 });
  }),
  // WO-BEFE-E · 存档清单读端（后端 app.ts:1825）。排序与后端**同一把尺**：`tick → createdAt → id` 全序，
  // 不靠插入序 —— 「存档 → 回滚 → 在更早的 tick 再存一次」这条常规动作正好会让两者相反。
  http.get("*/a/v1/sim/sessions/:id/checkpoints", ({ params }) => {
    const rows = [...(mockSimCheckpoints.get(String((params as { id: string }).id)) ?? [])];
    rows.sort((a, b) => a.tick - b.tick || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return HttpResponse.json({ items: rows });
  }),
  // WO-BEFE-E · 回滚（后端 app.ts:1832）：删掉该 tick 之后的 tick 态 + `curTick` 拨回 + 回**当时**的世界态。
  // 「回当时的态」这一点是本 handler 的要害：若图省事回当前态，回滚测试会恒绿而缺口仍在。
  http.post("*/a/v1/sim/sessions/:id/rollback", async ({ params, request }) => {
    const id = String((params as { id: string }).id);
    const body = (await request.json().catch(() => ({}))) as { checkpointId?: string };
    const cp = (mockSimCheckpoints.get(id) ?? []).find((c) => c.id === String(body.checkpointId));
    if (!cp) return HttpResponse.json({ error: { code: "NOT_FOUND", message: "checkpoint not found", requestId: "req_mock" } }, { status: 404 });
    const hist = mockSimTickHistory.get(id) ?? new Map<number, Record<string, unknown>>();
    for (const t of [...hist.keys()]) if (t > cp.tick) hist.delete(t);
    mockSimTickHistory.set(id, hist);
    const state = hist.get(cp.tick) ?? {};
    mockSimWorlds.set(id, { tick: cp.tick, state });
    const s = mockSimSessions.get(id);
    if (s) s.curTick = cp.tick;
    return HttpResponse.json({ curTick: cp.tick, state });
  }),
  http.post("*/a/v1/sim/sessions/:id/branch", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { checkpointId?: string };
    // WO-L4B：子会话真的落 store —— 这正是「分叉出的子世界刷新即丢」的修复点（后端 app.ts:1512 本来就落库了）。
    const parentId = String((params as { id: string }).id);
    const child: MockSimSession = {
      id: "sims_child_mock", tenantId: "demo", baseSnapshot: mockSimWorlds.get(parentId)?.state ?? {}, scope: {},
      status: "READY", curTick: 0, parentCheckpointId: body.checkpointId ?? "cp_mock", createdAt: "2026-08-09T00:00:00.000Z",
    };
    mockSimSessions.set(child.id, child);
    mockSimWorlds.set(child.id, { tick: 0, state: child.baseSnapshot });
    return HttpResponse.json(child, { status: 201 });
  }),
  /**
   * WO-BEFE-E · 传导规则清单（datacore app.ts:1860）。
   * `?published=false` 才连草稿一起列（后端判据 `published !== "false"` ⇒ 默认只列已发布）——
   * 桩照抄这一条，否则"默认看不到草稿"这一支永远验不到。
   * 规则条数与 `view-config` 的 `propagationCount: 1` 对齐：两处不一致的话，屏上会出现
   * 「1 传导规则」配一张两行的表，那正是本单要治的「数与内容不是同一件事」。
   */
  // （原此处有第 3 个 `GET /a/v1/sim/propagation-rules` handler（最老的硬编码那份），
  //   同样被 :5819 先匹配吃掉、永不触发 ⇒ 已删。单一真值源 = `mockPropRules`（种子 `MOCK_RULE_SEED`）。）
  http.get("*/a/v1/sim/compare", () =>
    HttpResponse.json({
      a: [{ tick: 0, state: { "TypeA#0": { s1: 50 } } }, { tick: 1, state: { "TypeA#0": { s1: 65 } } }],
      b: [{ tick: 0, state: { "TypeA#0": { s1: 50 } } }, { tick: 1, state: { "TypeA#0": { s1: 40 } } }],
    }),
  ),

  // ---- WO-IMPACT-PROPAGATION · 影响传播统一入口（镜像 datacore `POST /a/v1/simulation/impact-analysis`）----
  //
  // 🔴 本 mock 的纪律是**诚实**，不是"看起来热闹"：
  //  · 闭包用 mock 世界里唯一那条派生（`mockGenericInference` 的 `Base.oeeIndex` 前向重算）算，
  //    不另编一套；`derivationSpecCount: 1` 说的就是它 —— mock 世界确实只有这一条。
  //  · 流程 / 决策 / KPI 三维在 mock 世界里**真的没有承载物**（没有流程定义台账、没有决策台账、
  //    没有同时具备 target+actual 的对象类型），所以一律 `available:false` + 缺什么，
  //    **绝不**拿 `count:0` 冒充"查过了没影响"。这正是本端点契约存在的理由，mock 不许把它抹平。
  //  · 状态码与错误信封逐条镜像真后端：世界不存在 404（暗发）· 入参不合契约 400。
  //  · 无 `Date.now`/随机 ⇒ 同输入同输出（R6）。
  http.post("*/a/v1/simulation/impact-analysis", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const parsed = ImpactAnalysisRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return err(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "invalid body");
    const req = parsed.data;
    // R2 暗发：别的租户 / 不存在的世界一律 404（不是 403）。
    if (!mockSimSessions.has(req.worldId)) return err(404, "NOT_FOUND", "sim world not found");
    const session = mockSimSessions.get(req.worldId)!;
    // 世界态 = `objectId → stateVar → number`（契约 `TickState`）。叠加条数 = objectId × stateVar 的对数。
    const worldState = (mockSimWorlds.get(req.worldId)?.state ?? session.baseSnapshot) as Record<string, Record<string, number> | undefined>;
    const worldOverlayApplied = Object.values(worldState).reduce<number>((n, vars) => n + Object.keys(vars ?? {}).length, 0);

    const inf = mockGenericInference({ apply: [{ ...req.change }] });
    const deltas = ("deltas" in inf ? inf.deltas : []) as { objId: string; type: string; prop: string; before: unknown; after: unknown }[];
    const items = deltas
      .map((d) => ({ objectId: d.objId, objectType: d.type, changedProps: [{ prop: d.prop, before: d.before, after: d.after }] }))
      .sort((a, b) => (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0));
    // 全域 = mock 对象库里真数得出来的行数（与企业状态快照那两片同源，不是编的）。
    const universe = mockEnterpriseTypes().reduce((n, t) => n + t.rows.length, 0);

    const warnings: string[] = [];
    if (worldOverlayApplied === 0) {
      warnings.push(
        `世界 ${req.worldId} 的态为空（baseSnapshot/tick 态均无对象），本次分析实质跑在真本体当前值上，未发生世界隔离——不是「世界里没东西受影响」。`,
      );
    }
    const res: ImpactAnalysisResponse = {
      basis: {
        engine: "ontology-core.recompute",
        worldId: req.worldId,
        worldTick: session.curTick,
        worldStatus: session.status,
        worldOverlayApplied,
        countBasis: "DISTINCT_OBJECTS",
        derivationSpecCount: 1,
        kpiTypeKeys: [],
        oldValueMismatch: false,
      },
      affectedObjects: { available: true, count: items.length, universe, items: items.slice(0, req.limit), truncated: items.length > req.limit },
      affectedProcesses: {
        available: false,
        reason: "mock 世界没有流程定义台账（ProcessDefinition 未进 mock 数据）⇒ 这一维算不了，不是「没有流程受影响」。真后端有该台账时它可用。",
        missingCarrier: "ProcessDefinition",
      },
      affectedDecisions: {
        available: false,
        reason: "mock 世界没有决策台账（Decision 未进 mock 数据）⇒ 这一维算不了，不是「没有决策受影响」。真后端有该台账时它可用。",
        missingCarrier: "Decision",
      },
      affectedKpis: {
        available: false,
        reason: "mock 本体里没有任何对象类型同时具备 `target` 与 `actual` 属性 ⇒ 没有 KPI 承载物，这一维算不了（不是「没有 KPI 受影响」）。",
        missingCarrier: "ObjectType(target+actual)",
      },
      warnings,
    };
    return HttpResponse.json(res);
  }),

  // ---- WO-ENTERPRISE-STATE · 企业状态快照（镜像 datacore app.ts `/a/v1/twin/enterprise-states` 五条路由）----
  // 形状由 contracts 的 `captureEnterpriseState` / `forkEnterpriseState` / `diffEnterpriseStates` 保证
  // 与真后端逐字段相同（同一份纯函数），mock 只喂 mock 世界的输入。状态码/错误信封也逐条镜像真后端。
  http.post("*/a/v1/twin/enterprise-states", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json().catch(() => ({}))) as { worldId?: string };
    const worldId = body.worldId?.trim() || ENTERPRISE_STATE_REAL_WORLD_ID;
    // 真后端：worldId 非 REAL 时必须是一个已存在的推演会话，否则 404（worldId 不是自由字符串）。
    if (worldId !== ENTERPRISE_STATE_REAL_WORLD_ID && !mockSimSessions.has(worldId)) {
      return err(404, "NOT_FOUND", `sim session '${worldId}' not found`);
    }
    return HttpResponse.json(mockCaptureEnterpriseState(worldId), { status: 201 });
  }),
  http.get("*/a/v1/twin/enterprise-states/latest", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const worldId = new URL(request.url).searchParams.get("worldId") ?? ENTERPRISE_STATE_REAL_WORLD_ID;
    const items = [...mockEnterpriseStates.values()]
      .filter((s) => s.worldId === worldId)
      .sort((a, b) => a.capturedAt.tick - b.capturedAt.tick);
    const state = items[items.length - 1];
    // 诚实空（镜像后端）：没有就是没有 —— **不现场偷偷捕获一份**冒充"最新"。
    return state
      ? HttpResponse.json({ worldId, state })
      : HttpResponse.json({ worldId, state: null, reason: `世界 ${worldId} 尚无任何快照（POST /a/v1/twin/enterprise-states 捕获一份）` });
  }),
  http.get("*/a/v1/twin/enterprise-states", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const worldId = new URL(request.url).searchParams.get("worldId") ?? undefined;
    const items = [...mockEnterpriseStates.values()]
      .filter((s) => !worldId || s.worldId === worldId)
      .sort((a, b) => (a.worldId === b.worldId ? a.capturedAt.tick - b.capturedAt.tick : a.worldId < b.worldId ? -1 : 1));
    return HttpResponse.json({ items });
  }),
  http.post("*/a/v1/twin/enterprise-states/:id/fork", async ({ params, request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json().catch(() => ({}))) as { worldId?: string };
    const worldId = body.worldId?.trim() ?? "";
    if (worldId === "" || worldId === ENTERPRISE_STATE_REAL_WORLD_ID) {
      return err(400, "VALIDATION_ERROR", "fork target must be a simulation world");
    }
    if (!mockSimSessions.has(worldId)) return err(404, "NOT_FOUND", `sim session '${worldId}' not found`);
    const source = mockEnterpriseStates.get(String((params as { id: string }).id));
    if (!source) return err(404, "NOT_FOUND", "enterprise state not found");
    const forked = forkEnterpriseState(source, worldId);
    mockEnterpriseStates.set(forked.id, forked);
    return HttpResponse.json(forked, { status: 201 });
  }),
  http.get("*/a/v1/twin/enterprise-states/:id/diff", ({ params, request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const against = new URL(request.url).searchParams.get("against");
    if (!against) return err(400, "VALIDATION_ERROR", "against=<stateId> required");
    const after = mockEnterpriseStates.get(String((params as { id: string }).id));
    const before = mockEnterpriseStates.get(against);
    if (!after || !before) return err(404, "NOT_FOUND", "enterprise state not found");
    return HttpResponse.json({ before: before.id, after: after.id, changes: diffEnterpriseStates(before, after) });
  }),
  http.get("*/a/v1/twin/enterprise-states/:id", ({ params, request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const state = mockEnterpriseStates.get(String((params as { id: string }).id));
    return state ? HttpResponse.json(state) : err(404, "NOT_FOUND", "enterprise state not found");
  }),

  // ---- WO-GSLIVE-1-COCKPIT 桩 · 活①compose 路径（WO-LIVE-NL 预期契约·ranAgentLoop=false·含被挤单/按期率） ----
  http.post("*/b/v1/sim/compose", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json().catch(() => ({}))) as { query?: string; sessionId?: string };
    const res = mockGlobalSim({ scenarios: ["max_ontime", "min_cost", "min_changeover"], objective: "max_ontime", twoStage: true }) as { scenarios: Record<string, unknown>[] };
    const named: Record<string, string> = { max_ontime: "最多按期", min_cost: "最低代价", min_changeover: "最少换型" };
    const rows = (res.scenarios ?? []).map((s) => {
      const ov = s.objectiveValues as Record<string, number>;
      const ontime = ov.ontime ?? 0; const cost = ov.cost ?? 0;
      const served = (s.servedCount as number) ?? 0; const disp = (s.displacedCount as number) ?? 0;
      const rate = served + disp > 0 ? Math.round((ontime / (served + disp)) * 100) : 0;
      return { key: String(s.key), ontime, displaced: disp, ontimeRate: rate, cost };
    });
    const p = rows[0] ?? { key: "max_ontime", ontime: 0, displaced: 0, ontimeRate: 0, cost: 0 };
    const narrative = `联合求解（compose 路径 · 未起 agent 循环）：针对「${body.query ?? ""}」逐方案联合求解——`
      + rows.map((r) => `「${named[r.key] ?? r.key}」按期率 ${r.ontimeRate}%、被挤单 ${r.displaced} 单、代价 ${r.cost}`).join("；")
      + `。推荐主方案「${named[p.key] ?? p.key}」（按期率最高·被挤单 ${p.displaced}）。数字取自 portfolio 联合求解真值（可溯）。`;
    return HttpResponse.json({
      path: "compose", ranAgentLoop: false, narrative, scenarios: rows,
      provenance: [{ kind: "求解器", drillType: "GlobalSim", drillId: "portfolio", drillField: "ontime", drillValue: p.ontime }],
    });
  }),

  // ---- WO-GSLIVE-1-COCKPIT 桩 · 活③方案存/分支/横比（WO-LIVE-SCENARIO 预期契约·SimSession solve-mode） ----
  http.get("*/a/v1/sim/scenarios/compare", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const scenarios = ids.map((id) => gsliveScenarios.get(id)).filter(Boolean).map((s) => ({
      id: s!.id, label: s!.label, kpi: s!.kpi, servedCount: s!.servedCount, displacedCount: s!.displacedCount, ontimeRate: s!.ontimeRate,
    }));
    return HttpResponse.json({ scenarios });
  }),
  http.post("*/a/v1/sim/scenarios/:id/branch", async ({ params, request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const parent = gsliveScenarios.get(String(params.id));
    const b = (await request.json().catch(() => ({}))) as { label?: string; kpi?: GsliveKpi7 };
    const id = newId("scen");
    const kpi = b.kpi ?? parent?.kpi ?? { ontime: 0, cost: 0, changeoverHours: 0, freight: 0, fgInv: 0, transitInv: 0, margin: 0 };
    const snap = {
      id, label: String(b.label ?? `${parent?.label ?? "方案"}·分支`), parentId: String(params.id),
      page: parent?.page ?? "global-sim", primary: parent?.primary ?? "", createdAt: new Date().toISOString(),
      kpi, servedCount: parent?.servedCount ?? 0, displacedCount: parent?.displacedCount ?? 0, ontimeRate: parent?.ontimeRate ?? 0,
    };
    gsliveScenarios.set(id, snap);
    return HttpResponse.json(snap, { status: 201 });
  }),
  http.post("*/a/v1/sim/scenarios", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const b = (await request.json().catch(() => ({}))) as { label?: string; parentId?: string | null; page?: string; primary?: string; kpi?: GsliveKpi7; servedCount?: number; displacedCount?: number; ontimeRate?: number };
    const id = newId("scen");
    const snap = {
      id, label: String(b.label ?? id), parentId: b.parentId ?? null, page: String(b.page ?? "global-sim"), primary: String(b.primary ?? ""),
      createdAt: new Date().toISOString(), kpi: b.kpi ?? { ontime: 0, cost: 0, changeoverHours: 0, freight: 0, fgInv: 0, transitInv: 0, margin: 0 },
      servedCount: b.servedCount ?? 0, displacedCount: b.displacedCount ?? 0, ontimeRate: b.ontimeRate ?? 0,
    };
    gsliveScenarios.set(id, snap);
    return HttpResponse.json(snap, { status: 201 });
  }),
  http.get("*/a/v1/sim/sessions/:id/certification", ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "LOCAL" ? "LOCAL" : "GLOBAL";
    return HttpResponse.json({
      scope,
      targetRef: scope === "LOCAL" ? url.searchParams.get("target") : null,
      level: "L2_RUNNABLE",
      dims: { structure: 70, knowledge: 50, behavior: 35, composite: 52 },
      l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
      // ⚠ 口径必须跟真后端走（本仓已记账的病：`G-AGENTCORE-MOCK-DIVERGED-FROM-ENGINE` /
      //   欠账 #78「mock 与真引擎口径分家」——mock 是第二个真值源，且没有任何机制让它跟随第一个）。
      //   真后端（`app.ts` Trial Tick）**真跑传导相**并恒传 `propagationCovered: true`，
      //   同时下发 fired 与 declared 两个数；这里照同一形态给，否则 mock 模式会一直挂着
      //   「传导未纳入本次空跑」的告警，而真环境早就没有了。
      //   declared=1 与下面 `worldCompleteness.propagationRules.present=1` 同源（同一条传导规则）。
      trialTick: {
        passed: false, derivationNodes: 1,
        propagationRulesFired: 1, propagationRulesDeclared: 1, propagationCovered: true,
        at: null, error: null,
      },
      worldCompleteness: {
        pct: scope === "LOCAL" ? 48 : 50,
        derivationRules: { present: 1, needed: 2 },
        actions: { present: 0, needed: 1 },
        propagationRules: { present: 1, needed: 1 },
        stateVarKeys: ["s2", "s3"],
        entering: [
          { key: "s1", kind: "DERIVATION", source: "deriv:s1" },
          { key: "s2", kind: "PROPAGATION", source: "prop:linkAB" },
        ],
      },
      canEnterSimulation: false,
      gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
      computedAt: new Date().toISOString(),
    });
  }),
  // WO-A · PlanBuilder endpoints（Phase 1：线性多 solver 链）。
  http.get("*/b/v1/plan-builders", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const packageId = url.searchParams.get("packageId") ?? PACKAGE_ID;
    const items = db.planBuilders
      .filter((c) => c.packageId === packageId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post("*/b/v1/plan-builders", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const packageId = url.searchParams.get("packageId") ?? PACKAGE_ID;
    const body = (await request.json().catch(() => ({}))) as CreatePlanBuilderBody;
    if (!body.key || !body.name) return err(400, "VALIDATION_ERROR", "key 与 name 必填");
    const id = `pbc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const canvas: PlanBuilderCanvas = {
      id,
      tenantId: TENANT_ID,
      packageId,
      key: body.key,
      version: 1,
      name: body.name,
      description: body.description,
      status: "DRAFT",
      dsl: body.dsl ?? newPlanBuilderCanvas(id, packageId).dsl,
      createdBy: `usr-${account.username}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.planBuilders.unshift(canvas);
    return HttpResponse.json(canvas, { status: 201 });
  }),
  http.get("*/b/v1/plan-builders/:id", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const canvas = planBuilderById(String(params.id));
    if (!canvas) return err(404, "NOT_FOUND", "画布不存在");
    return HttpResponse.json(canvas);
  }),
  http.put("*/b/v1/plan-builders/:id", async ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const canvas = planBuilderById(String(params.id));
    if (!canvas) return err(404, "NOT_FOUND", "画布不存在");
    if (canvas.status !== "DRAFT") return err(409, "IMMUTABLE_VERSION", "仅 DRAFT 可编辑");
    const body = (await request.json().catch(() => ({}))) as UpdatePlanBuilderBody;
    const next: PlanBuilderCanvas = {
      ...canvas,
      ...body,
      id: canvas.id,
      tenantId: canvas.tenantId,
      version: canvas.version,
      status: canvas.status,
      createdBy: canvas.createdBy,
      createdAt: canvas.createdAt,
      updatedAt: new Date().toISOString(),
    };
    db.planBuilders = db.planBuilders.map((c) => (c.id === canvas.id ? next : c));
    return HttpResponse.json(next);
  }),
  http.post("*/b/v1/plan-builders/:id/compile", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const canvas = planBuilderById(String(params.id));
    if (!canvas) return err(404, "NOT_FOUND", "画布不存在");
    return HttpResponse.json(compilePlanBuilderDSL(canvas.dsl));
  }),
  http.post("*/b/v1/plan-builders/:id/publish", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const canvas = planBuilderById(String(params.id));
    if (!canvas) return err(404, "NOT_FOUND", "画布不存在");
    const compiled = compilePlanBuilderDSL(canvas.dsl);
    if (!compiled.ok) {
      const result: PlanBuilderPublishResult = { ok: false, canvas, errors: compiled.errors, impact: { agents: 0, plans: 0, intents: 0 } };
      return HttpResponse.json(result);
    }
    const next: PlanBuilderCanvas = { ...canvas, status: "PUBLISHED", compiledPlanId: `plan_${canvas.id}`, updatedAt: new Date().toISOString() };
    db.planBuilders = db.planBuilders.map((c) => (c.id === canvas.id ? next : c));
    const result: PlanBuilderPublishResult = { ok: true, canvas: next, plan: compiled.plan, errors: [], impact: { agents: 0, plans: 1, intents: 0 } };
    return HttpResponse.json(result);
  }),
  http.post("*/b/v1/plan-builders/:id/run", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const canvas = planBuilderById(String(params.id));
    if (!canvas) return err(404, "NOT_FOUND", "画布不存在");
    return HttpResponse.json({
      runId: `pbr_${Date.now()}`,
      status: "COMPLETED",
      answer: { blocks: [{ type: "text", markdown: `PlanBuilder ${canvas.name} mock run completed` }] },
    });
  }),

];

/**
 * 发布校验（QOS §4.2 语义约束 + 环检测）：
 * - steps[i] 只能引用 steps[j].output（j<i）→ 违反报 PLAN_VALIDATION_ERROR（定位 stepId）
 * - render_answer 必须为末步
 * - invoke_agent 指向会回调本 workflow 的 agent → CYCLIC_INVOCATION（定位 stepId）
 */
export function validateWorkflow(steps: PlanStep[]): { stepId?: string; code: string; message: string }[] {
  const errors: { stepId?: string; code: string; message: string }[] = [];
  const seen = new Set<string>();
  steps.forEach((s, i) => {
    const text = JSON.stringify(s.params);
    const refs = [...text.matchAll(/\{\{steps\.([\w-]+)\./g)].map((m) => m[1]!);
    for (const ref of refs) {
      if (!seen.has(ref)) {
        errors.push({ stepId: s.id, code: "PLAN_VALIDATION_ERROR", message: `步骤只能引用前序步骤产出：${ref} 不在 #${i + 1} 之前` });
      }
    }
    if (s.type === "invoke_agent" && (s.params as { agentId?: string }).agentId === "agt-explore") {
      // agt-explore 的工具里挂了本 workflow（wf-cap）→ 静态可达环
      errors.push({ stepId: s.id, code: "CYCLIC_INVOCATION", message: "检测到循环调用：agent agt-explore 的工具链回到本 workflow" });
    }
    seen.add(s.id);
  });
  const last = steps[steps.length - 1];
  if (last && last.type !== "render_answer") {
    errors.push({ stepId: last.id, code: "PLAN_VALIDATION_ERROR", message: "render_answer 必须为最后一步" });
  }
  return errors;
}
