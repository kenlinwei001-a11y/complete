/**
 * WO-FLOWTIME · 反推器的 **IO 适配层**（读仓储 → 调纯函数 → 落表 → 发事件）。
 *
 * 分层照 `chain_loss_attribution` 的兄弟模式：
 *   本文件碰 IO（`listByType` / `processInstances.putMany` / `outbox.emit`），
 *   算法一行不写 —— 全部委派 `@platform/contracts` 的
 *   `reconstructProcessInstances` / `computeFlowTimelines` / `aggregateStations`（纯函数·R6）。
 * 「纯函数不碰 IO 才能被单测直喂 fixture，也才敢承诺同 seed 两跑字节一致」——
 * 这句是 `solvers/service.ts` 里 `chainLossAttribution` 的原话，本文件照办。
 *
 * ── R4 · 只读投影，不写本体真值 ──────────────────────────────────────────────
 * 本文件只写 `process_instances`（派生投影表），**从不**碰 `objects` / `ontology_types` /
 * Action 审批路径。反推产物是对既有真值的重排，不是新的真值 —— 故不经 Action，也不该经。
 */
import type { OutboxService } from "../outbox.js";
import type { Repos } from "../repo/repo.js";
import {
  aggregateStations,
  computeFlowTimelines,
  reconstructProcessInstances,
  type ProcessFlowDefinition,
  type ProcessFlowObject,
  type ProcessFlowRule,
  type ProcessFlowAbsence,
  type ProcessFlowTimeline,
  type ProcessInstance,
  type ProcessStationAggregate,
} from "@platform/contracts";
import { BATTERY_PROCESS_FLOW_RULES, PROCESS_FLOW_STRUCTURAL_NOTES, flowTimeDayZero } from "./flow-rules.js";

/**
 * 分析截止时刻 `asOf` 的来历（R13：数字要能说出自己从哪来）。
 *  · `ARG`            —— 调用方显式传的。
 *  · `DATA_LATEST`    —— 缺省：**数据里观测到的最晚时刻**。
 *  · `FORECAST_START` —— 兜底：一条实例都反推不出时，退回场景包锚点。
 */
export type FlowAsOfSource = "ARG" | "DATA_LATEST" | "FORECAST_START";

/**
 * 为什么缺省不是 `forecastStart`（本仓其它求解器的时间锚），这条判断写清楚免得被"统一"掉：
 *
 * `forecastStart`（2026-06-10）是**预测窗的起点**，不是"现在"。本层的单据横跨
 * 2026-06-04 … 2026-07-03（实测），拿窗口起点当"现在"会把绝大多数单据判成
 * **「尚未入站」**——报告里每一行都写"还没开始"，等于什么都没说。
 *
 * 流转时长是**回溯**分析，它的"现在"应当是**数据的最后一刻**（真 MES 报表里叫
 * "as of last refresh"）。故缺省取观测到的最晚时刻，并把 `asOfSource` 一并回传，
 * 让读的人知道这个"现在"是怎么定的 —— 而不是我偷偷定了一个。
 *
 * R6：`DATA_LATEST` 由数据派生（`max` 全序），**不是** `Date.now()`；同 seed 两跑同值。
 */
export function resolveAsOf(instances: readonly ProcessInstance[], argAsOf?: string): { asOf: string; asOfSource: FlowAsOfSource } {
  if (typeof argAsOf === "string" && /^\d{4}-\d{2}-\d{2}/.test(argAsOf)) return { asOf: argAsOf.slice(0, 10), asOfSource: "ARG" };
  let latest = "";
  for (const inst of instances) {
    if (inst.enteredAt > latest) latest = inst.enteredAt;
    if (inst.exitedAt !== null && inst.exitedAt > latest) latest = inst.exitedAt;
  }
  if (latest === "") return { asOf: flowTimeDayZero(), asOfSource: "FORECAST_START" };
  return { asOf: latest, asOfSource: "DATA_LATEST" };
}

export interface FlowReconstructOutcome {
  instances: ProcessInstance[];
  absences: ProcessFlowAbsence[];
  timelines: ProcessFlowTimeline[];
  stations: ProcessStationAggregate[];
  asOf: string;
  asOfSource: FlowAsOfSource;
  /** 反推规则表覆盖到的流程数 / 总流程数（诚实基数：不藏分母）。 */
  coverage: { rulesCoveredProcesses: number; reconstructedProcesses: number; totalProcesses: number };
}

/**
 * 反推一次并**落表**（幂等：id 确定性 ⇒ `putMany` 覆盖同一批行，不堆行）。
 *
 * 事件（⑦环）：
 *  · `process.instance_entered` —— 本次反推产出了实例（含新入站的那批）。
 *  · `process.instance_stuck`   —— 有实例到 `asOf` 仍未出站（**这是本单要答的那个问题**）。
 * 两个事件都在 `apps/agentcore/src/event-subscriptions.ts` 有订阅方（D-29 / R10：
 * 发了就必须有人听 —— 有事件没消费方与有消费方没数据是**两种**病，都要治）。
 */
export async function reconstructAndPersist(
  repos: Repos,
  tenantId: string,
  opts?: { asOf?: string; rules?: readonly ProcessFlowRule[]; outbox?: OutboxService },
): Promise<FlowReconstructOutcome> {
  const rules = opts?.rules ?? BATTERY_PROCESS_FLOW_RULES;
  const defs = await repos.processDefinitions.list(tenantId);
  const definitions: ProcessFlowDefinition[] = defs.map((d) => ({
    key: d.key,
    name: d.name,
    ownerFunctionKey: d.ownerFunctionKey,
    waitKind: d.waitKind,
    carrierTypeKey: d.carrierTypeKey,
    // ⚠ 刻意**不取** d.stdDurationDays —— 见 contracts/process-instance.ts 文件头那条红线。
  }));

  // 只读规则表点名到的那些类型（不是把全库对象拉进来 —— 65 类全拉在 XL 档是几十万行）
  const neededTypes = [...new Set([...rules.flatMap((r) => r.stations.map((s) => s.typeKey)), ...definitions.map((d) => d.carrierTypeKey)])].sort((a, b) => a.localeCompare(b));
  const objectsByType: Record<string, ProcessFlowObject[]> = {};
  for (const t of neededTypes) {
    objectsByType[t] = (await repos.objects.listByType(tenantId, t)).map((o) => ({ id: o.id, type: o.type, props: o.props }));
  }

  const { instances, absences } = reconstructProcessInstances({
    tenantId,
    rules,
    definitions,
    objectsByType,
    structuralNotes: PROCESS_FLOW_STRUCTURAL_NOTES,
    dayZeroDate: flowTimeDayZero(),
    // 第一遍用锚点解析（此时还不知道数据最晚时刻）；asOf 只影响 dwell 计算，不影响实例本身。
    asOf: flowTimeDayZero(),
  });
  const { asOf, asOfSource } = resolveAsOf(instances, opts?.asOf);
  const timelines = computeFlowTimelines(instances, asOf);
  const stations = aggregateStations(timelines, definitions);

  if (instances.length > 0) await repos.processInstances.putMany(instances);

  const stuck = timelines.filter((t) => t.stuckProcessKey !== null);
  if (opts?.outbox) {
    if (instances.length > 0) {
      await opts.outbox.emit(tenantId, "process.instance_entered", {
        instanceCount: instances.length,
        processKeys: [...new Set(instances.map((i) => i.processKey))].sort((a, b) => a.localeCompare(b)),
        asOf,
        asOfSource,
        origin: "DERIVED_FROM_DOCUMENT",
      });
    }
    if (stuck.length > 0) {
      // 只发**聚合**信号（不是一条实例一个事件）：13 万条实例发 13 万个事件会把 outbox 打爆，
      // 而消费方（前端缓存失效 / 通知）要的是「有卡顿，去刷新」而不是逐条流水。
      const worst = [...stuck].sort((a, b) => (b.stuckDays ?? 0) - (a.stuckDays ?? 0) || a.flowKey.localeCompare(b.flowKey))[0]!;
      await opts.outbox.emit(tenantId, "process.instance_stuck", {
        stuckFlowCount: stuck.length,
        worstFlowKey: worst.flowKey,
        worstProcessKey: worst.stuckProcessKey,
        worstStuckDays: worst.stuckDays,
        asOf,
        asOfSource,
      });
    }
  }

  return {
    instances,
    absences,
    timelines,
    stations,
    asOf,
    asOfSource,
    coverage: {
      rulesCoveredProcesses: new Set(rules.flatMap((r) => r.stations.map((s) => s.processKey))).size,
      reconstructedProcesses: new Set(instances.map((i) => i.processKey)).size,
      totalProcesses: definitions.length,
    },
  };
}
