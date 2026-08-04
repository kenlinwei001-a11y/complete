import { LIVED_IN_INCUBATED, LIVED_IN_SCENE_HISTORY } from "@platform/contracts";
import type { ActionDraft, AuthCtx, LivedInStateRecord, RiskCaseRecord, SopVersion } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { TimeseriesService } from "../timeseries.js";
import type { OntologyService } from "../ontology.js";
import type { RuleScanService } from "../scheduler.js";
import type { RulesService } from "../rules.js";
import { hashString, mulberry32, randInt, round } from "../prng.js";
import { BATTERY_SOLVER_PARAMS, BATTERY_TEMPLATE, BASES, generateBattery } from "../synthetic/battery.js";
import { entityRefFieldOf } from "../synthetic/service.js";
import { caseSeverityFromData } from "../solvers/risk.js";
import { BASE_REGISTRY } from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：版本演进与版本史表达式/理由全部派生，禁内联裸阈值（R14·R-一致）。
import { OUTSOURCE_REDLINE, OUTSOURCE_REDLINE_HISTORY, outsourceRedlineViolationExpr } from "@platform/contracts";
import type { TsGenSpec } from "../synthetic/tsgen.js";
import { livedMaintWindows, livedPoint, type LivedGenContext, type LivedIncident } from "./tsgen.js";

/**
 * 运营态种子引擎（PRD-addendum-lived-in-state §1）。
 *
 * 「生成 + 回放」而非「画出来」：确定性生成 12 个月源头事件流（订单生命周期 /
 * 告警-处置案例 / Action 审计 / 规则演进 / 校准叙事），模拟时钟从 T−365 天起按
 * **月批次**（回放模式 = 批窗口 + 精简批报告 + 复用增量聚合，满足 S 规模 ≤5 分钟）
 * 连续推进至 T0，每个批次走真实 A8 管线：源头时序 → 增量 TS_AGGREGATE → 派生 →
 * 校准配对（M11 onTick）→ RULE_SCAN。同 (industry, scale, seed) 重跑 → history/bundle
 * 字节级一致（所有时间戳/编号皆由 seed 推导，不读墙钟）。
 *
 * 叙事弧线（§1.3，按回放年内的自然季度）：
 *   2025-Q3 爬坡起步（MAPE 12% 高位、校准频繁）+ 储能需求上修（C21 → S&OP V3 决议）
 *   2025-Q4 到货危机（CASE-007 常州正极延迟 → 越线 → 提前备料 → 消解；C16 3→5 天收紧；
 *            MAPE 第 21–22 周回弹 +1.8pct 后继续收敛）
 *   2026-Q1 持续收敛（参数校准生效）
 *   2026-Q2 检修季（各基地错峰检修，产出月度下凹与 MaintPlan 同月）→ 年末稳定
 *
 * 叙事互引（Y4/Y5 强制）：危机时间窗 2025-10-28 → 2025-11-10 同时出现在
 * ① riskCases CASE-007（windowFrom/To）② 已执行 Action（act_lh_*007）
 * ③ C16 规则变更复盘原因（tags 到货危机复盘）④ mapeSeries 第 21–22 周 event；
 * 延期挽回订单的 rescue.note 反向引用 caseNo + actionId。
 */

const DAY_MS = 86400000;
const REPLAY_DAYS = 365;
const CUSTS = ["星辰汽车", "蓝海储能", "极光电动", "云岭新能源", "晨风车业", "沧浪电网"];

const REJECT_COMMENTS = [
  "外协贴近 C08 红线，改用夜班方案",
  "现金垫低于 C18 底线，本月不批增产投入",
  "该基地检修窗口未结束，方案时点不可行，驳回",
  "与当月 S&OP 决议冲突，请走计划版本变更重新提报",
  "风险评估缺少受影响订单清单，补充后再报",
  "外协供应商资质未过审，改用跨基地借调",
  "需求依据为单一客户口头预测，证据不足",
  "成本超出预算上限 12%，请压缩空运比例后重报",
];

interface CaseSpec {
  n: number;
  baseId: string;
  factor: string;
  crossed: string; // 越线日
  // severity 不再写死：由 caseSeverityFromData(基地利用率 + 主瓶颈 + 危机) 真闭环派生（PRD §2.3 / P4）。
  crisis?: boolean;
}

/** 10 例告警-处置闭环案例骨架（CASE-007 = Q4 到货危机，与场景预置问答互引）。 */
// 案例骨架 = 事件事实（哪个基地/哪个因子/何时越线/是否结构性危机）；severity 由 caseSeverityFromData 真闭环派生。
const CASE_SPECS: CaseSpec[] = [
  { n: 1, baseId: "hefei", factor: "设备OEE", crossed: "2025-08-12" },
  { n: 2, baseId: "xiamen", factor: "人力工时", crossed: "2025-09-09" },
  { n: 3, baseId: "jiangmen", factor: "物料齐套", crossed: "2025-09-24" },
  { n: 4, baseId: "meishan", factor: "换型损失", crossed: "2025-10-14" },
  { n: 5, baseId: "handan", factor: "物流时长", crossed: "2025-10-28" },
  { n: 6, baseId: "wuhan", factor: "良率波动", crossed: "2025-11-04" },
  { n: 7, baseId: "changzhou", factor: "物料齐套", crossed: "2025-10-28", crisis: true },
  { n: 8, baseId: "chengdu", factor: "设备OEE", crossed: "2026-01-20" },
  { n: 9, baseId: "zaozhuang", factor: "瓶颈工序", crossed: "2026-03-10" },
  { n: 10, baseId: "yangzhou", factor: "物流时长", crossed: "2026-04-21" },
];

/** 延期挽回链（Y5）：9 单曾延期，7 单经案例处置挽回至 ≤2 天。 */
const DELAY_OVERRIDES: { idx: number; due: string; caseN?: number; delay: number; origDelay?: number }[] = [
  // CASE-007 到货危机受影响 4 单（3 挽回 + 1 未挽回）
  { idx: 25, due: "2025-11-26", caseN: 7, delay: 2, origDelay: 7 },
  { idx: 26, due: "2025-11-29", caseN: 7, delay: 1, origDelay: 6 },
  { idx: 27, due: "2025-12-03", caseN: 7, delay: 2, origDelay: 7 },
  { idx: 28, due: "2025-12-06", caseN: 7, delay: 6 }, // 未挽回（危机外溢）
  // 其余 4 单分别由 4 例案例挽回
  { idx: 10, due: "2025-09-15", caseN: 2, delay: 1, origDelay: 5 },
  { idx: 17, due: "2025-10-20", caseN: 4, delay: 2, origDelay: 6 },
  { idx: 40, due: "2026-01-28", caseN: 8, delay: 1, origDelay: 4 },
  { idx: 47, due: "2026-03-18", caseN: 9, delay: 2, origDelay: 8 },
  // 1 单普通延期（无处置）
  { idx: 34, due: "2026-02-10", delay: 9 },
];

export interface LivedCase extends RiskCaseRecord {
  crisis: boolean;
  /** CaseSpec 序号（1..10）—— 订单挽回链 DELAY_OVERRIDES.caseN 按此回查。 */
  n: number;
}

export interface LivedInRunInput {
  industry: string;
  scale: "S" | "M" | "L" | "XL";
  seed: number;
  /** 确定性 origin 标识（synthetic-<industry>-<scale>-<seed>）。 */
  jobId: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  return iso(Date.parse(`${dateIso}T00:00:00Z`) + days * DAY_MS);
}

function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** 案例 → 时序事件窗口（engine 与 live-ingest 回填共用，保证重生成值一致）。 */
export function incidentsFromCases(
  cases: Pick<RiskCaseRecord, "baseId" | "crossedAt" | "adoptedAt" | "resolvedAt" | "tags">[],
): Map<string, LivedIncident[]> {
  const map = new Map<string, LivedIncident[]>();
  for (const c of cases) {
    const inc: LivedIncident = {
      from: addDays(c.crossedAt, -4),
      low: c.crossedAt,
      adopted: c.adoptedAt,
      to: c.resolvedAt,
      depth: c.tags.includes("到货危机") ? 0.78 : 0.86,
    };
    const arr = map.get(c.baseId) ?? [];
    arr.push(inc);
    map.set(c.baseId, arr);
  }
  return map;
}

/** 回放年 52 周 MAPE 序列：12% → 7% 指数收敛 + 第 21–22 周危机回弹 +1.8pct。 */
export function mapeSeriesFor(replayFrom: string): { week: number; weekStart: string; mape: number; event?: string }[] {
  const rebound: Record<number, number> = { 21: 1.8, 22: 1.4, 23: 0.7, 24: 0.3 };
  const events: Record<number, string> = {
    4: "首轮参数校准生效（良率基线 EMA）",
    21: "Q4 到货危机：精度回弹 +1.8pct（正极到货延迟）",
    23: "提前备料处置生效，恢复收敛",
  };
  const out: { week: number; weekStart: string; mape: number; event?: string }[] = [];
  for (let w = 1; w <= 52; w++) {
    const mape = round(7 + 5 * Math.exp(-(w - 1) / 16) + (rebound[w] ?? 0), 2);
    out.push({ week: w, weekStart: addDays(replayFrom, (w - 1) * 7), mape, ...(events[w] ? { event: events[w] } : {}) });
  }
  return out;
}

export class LivedInEngine {
  /** M11 配对/元闭环钩子（回放批次内、RULE_SCAN 之前调用）。 */
  private calibrationTicker: ((tenantId: string) => Promise<void>) | null = null;
  /** 回放编排器 §1：随运营态合成创建虚拟团队 + 默认剧本（SYNTHETIC 租户）。 */
  private opsTeamSeeder: ((tenantId: string) => Promise<void>) | null = null;

  constructor(
    private repos: Repos,
    private ts: TimeseriesService,
    private ontology: OntologyService,
    private ruleScan: RuleScanService,
    private rules: RulesService,
  ) {}

  setCalibrationTicker(ticker: (tenantId: string) => Promise<void>): void {
    this.calibrationTicker = ticker;
  }

  setOpsTeamSeeder(seeder: (tenantId: string) => Promise<void>): void {
    this.opsTeamSeeder = seeder;
  }

  /** 入口：标准合成（对象/规则/账号/视图）完成后调用。 */
  async run(ctx: AuthCtx, input: LivedInRunInput): Promise<LivedInStateRecord> {
    const t0Iso = BATTERY_SOLVER_PARAMS.forecastStart as string;
    const replayTo = t0Iso;
    const replayFrom = iso(Date.parse(`${t0Iso}T00:00:00Z`) - REPLAY_DAYS * DAY_MS);

    await this.clearPrevious(ctx);

    // ① 确定性源头记录：告警-处置案例 ←→ 已交付订单（挽回链） ←→ Action 审计史
    const cases = this.buildCases(ctx.tenantId, replayFrom);
    const orders = this.buildDeliveredOrders(ctx.tenantId, input, replayFrom, cases);
    const actions = this.buildActions(ctx.tenantId, input.seed, replayFrom, cases);
    for (const c of cases) {
      // LivedCase 的 crisis/n 为构造期辅助字段，不落库
      const rec: RiskCaseRecord & { crisis?: boolean; n?: number } = { ...c };
      delete rec.crisis;
      delete rec.n;
      await this.repos.riskCases.put(rec);
    }
    for (const a of actions) await this.repos.actionDrafts.put(a);
    for (const o of orders) {
      await this.repos.objects.put({
        id: `obj_order_${String(o.so)}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        type: "Order",
        props: o,
        origin: { type: "SYNTHETIC", jobId: input.jobId },
      });
    }

    // ② 回放：T−365d → T0，月批次走真实 A8 管线
    const replay = await this.replay(ctx, replayFrom, input.seed, cases);

    // ③ 回放后叙事：S&OP V1–V12（与月度实绩同源勾稽）/ 规则演进 / 校准叙事
    await this.seedSopVersions(ctx, replayFrom, replay.baseMonthWan);
    const ruleChanges = await this.seedRuleEvolution(ctx);
    await this.seedCalibrationNarrative(ctx, replayFrom);

    // ④ 运营态元数据（generatedFrom 水印 / MAPE 叙事 / 任务史副本 / 孵化记录）
    const state: LivedInStateRecord = {
      id: ctx.tenantId,
      tenantId: ctx.tenantId,
      generatedFrom: {
        industry: input.industry,
        scale: input.scale,
        seed: input.seed,
        jobId: input.jobId,
        replayFrom,
        replayTo,
        replayDays: REPLAY_DAYS,
      },
      crisisWindow: { from: "2025-10-28", to: "2025-11-10" },
      mapeSeries: mapeSeriesFor(replayFrom),
      taskHistory: Object.entries(LIVED_IN_SCENE_HISTORY).flatMap(([scene, entries]) =>
        entries.map((e) => ({ scene, ...e })),
      ),
      incubated: LIVED_IN_INCUBATED.map((i) => ({ ...i })),
      ruleChanges,
      liveMonths: [],
      replay: { batches: replay.batches, days: REPLAY_DAYS, points: replay.points },
    };
    await this.repos.livedInStates.put(state);

    // §1 虚拟操作团队 + §2 默认剧本（运营态即 SYNTHETIC 租户，隔离守卫自然通过）。
    if (this.opsTeamSeeder) await this.opsTeamSeeder(ctx.tenantId);

    return state;
  }

  /** 幂等：同 seed 重跑回到同一运营态（删除上一次 lived-in 痕迹）。 */
  private async clearPrevious(ctx: AuthCtx): Promise<void> {
    const tid = ctx.tenantId;
    for (const d of await this.repos.actionDrafts.list(tid, (x) => x.id.startsWith("act_lh_"))) {
      await this.repos.actionDrafts.remove(tid, d.id);
    }
    for (const v of await this.repos.sopVersions.list(tid, (x) => x.id.startsWith("sop_lh_"))) {
      await this.repos.sopVersions.remove(tid, v.id);
    }
    for (const p of await this.repos.calibrationProposals.list(tid, (x) => x.id.startsWith("cal_lh_"))) {
      await this.repos.calibrationProposals.remove(tid, p.id);
    }
    for (const h of await this.repos.calibrationHistory.list(tid, (x) => x.id.startsWith("calh_lh_"))) {
      await this.repos.calibrationHistory.remove(tid, h.id);
    }
    for (const c of await this.repos.riskCases.list(tid)) await this.repos.riskCases.remove(tid, c.id);
    await this.repos.livedInStates.remove(tid, tid);
  }

  // -- ① 告警-处置闭环案例（10 例，含 Q4 到货危机） -------------------------------

  private buildCases(tenantId: string, replayFrom: string): LivedCase[] {
    const baseNames = new Map(BASES.map((b) => [b.baseId, b.name]));
    const baseUtil = new Map(BASE_REGISTRY.map((b) => [b.baseId, b.util]));
    const bn = BATTERY_SOLVER_PARAMS.bottleneck as { primary: Record<string, string>; defaultPrimary: string };
    const mitigations = (BATTERY_SOLVER_PARAMS.risk as { mitigations: Record<string, { key: string; name: string }[]> })
      .mitigations;
    void replayFrom;
    return CASE_SPECS.map((s) => {
      const adopted = addDays(s.crossed, 3);
      const resolved = addDays(s.crossed, 13);
      const baseName = baseNames.get(s.baseId) ?? s.baseId;
      // P4 真闭环：severity 由基地真实利用率 + 是否主瓶颈因子 + 危机派生（替代写死，R13 可溯源 R6 确定）。
      const isPrimary = s.factor === (bn.primary[baseName] ?? bn.defaultPrimary);
      const severity = caseSeverityFromData(baseUtil.get(s.baseId) ?? 0, isPrimary, s.crisis ?? false);
      const mit = (mitigations[s.factor] ?? [])[0] ?? { key: "early_stock", name: "提前备料" };
      const actionId = `act_lh_${tenantId}_${String(s.n).padStart(3, "0")}`;
      const tags = s.crisis ? ["到货危机"] : [];
      const title = s.crisis ? `${baseName}·正极到货危机处置` : `${baseName}·${s.factor}风险处置`;
      return {
        id: `case_lh_${tenantId}_${s.n}`,
        tenantId,
        caseNo: `CASE-${String(s.n).padStart(3, "0")}`,
        title,
        baseId: s.baseId,
        baseName,
        factor: s.factor,
        severity,
        windowFrom: s.crossed,
        windowTo: resolved,
        crossedAt: s.crossed,
        adoptedAt: adopted,
        resolvedAt: resolved,
        mitigation: { name: mit.name, planKey: mit.key },
        actionId,
        affectedOrders: [], // 订单生成时回填（互引）
        timeline: [
          { date: addDays(s.crossed, -4), event: s.crisis ? "正极材料到货延迟 5 天，齐套覆盖跌破 3 天" : `${s.factor}指标连续走弱` },
          { date: s.crossed, event: `风险越线（${s.factor}），生成告警` },
          { date: adopted, event: `采纳「${mit.name}」处置方案（Action ${actionId} 审批执行）` },
          { date: resolved, event: "曲线消解，恢复正常运行" },
        ],
        tags,
        curve: {
          seriesKey: "output:line",
          entityId: `LINE-WS-${s.baseId}-slurry`,
          from: addDays(s.crossed, -10),
          to: addDays(resolved, 7),
        },
        crisis: s.crisis ?? false,
        n: s.n,
      };
    });
  }

  // -- ① 订单生命周期：已交付 60（9 延期 / 7 挽回，互引案例与 Action） ----------------

  private buildDeliveredOrders(
    tenantId: string,
    input: LivedInRunInput,
    replayFrom: string,
    cases: LivedCase[],
  ): Record<string, unknown>[] {
    const rng = mulberry32(input.seed ^ hashString("livedin-orders"));
    const g = generateBattery(input.seed, input.scale);
    const byCase = new Map(cases.map((c) => [c.n, c] as const));
    const overrides = new Map(DELAY_OVERRIDES.map((o) => [o.idx, o] as const));
    const orders: Record<string, unknown>[] = [];
    for (let i = 1; i <= 60; i++) {
      const so = `SO-2${String(i).padStart(4, "0")}`;
      let model = g.models[(i - 1) % g.models.length] as { modelId: string; bases: string[]; unitPrice: number };
      const ov = overrides.get(i);
      const kase = ov?.caseN != null ? byCase.get(ov.caseN) : undefined;
      let bases: string[];
      if (kase) {
        // 受案例影响订单：落在案例基地（优先选可产该基地的型号，保 FK 一致）
        const covering = g.models.find((m) => (m.bases as string[]).includes(kase.baseId));
        if (covering) model = covering as typeof model;
        bases = [kase.baseId];
      } else {
        bases = [(model.bases as string[])[(i - 1) % (model.bases as string[]).length] as string];
      }
      const qty = randInt(rng, 100, 2500);
      const due = ov?.due ?? addDays(replayFrom, 10 + Math.round(((i - 1) * 340) / 59));
      const delay = ov?.delay ?? 0;
      const early = ov ? 0 : i % 3; // 按期单提前 0–2 天交付
      const deliveredAt = addDays(due, delay > 0 ? delay : -early);
      const createdAt = addDays(due, -(40 + (i % 21)));
      const lifecycle = {
        createdAt,
        scheduledAt: addDays(createdAt, 7),
        producedAt: addDays(deliveredAt, -2),
        deliveredAt,
      };
      const rescue =
        kase && ov?.origDelay != null
          ? {
              caseId: kase.id,
              caseNo: kase.caseNo,
              actionId: kase.actionId,
              note: `原计划延期 ${ov.origDelay} 天，采纳「${kase.mitigation.name}」处置（${kase.caseNo} / ${kase.actionId}）后挽回至 ${delay} 天交付`,
            }
          : undefined;
      if (kase) kase.affectedOrders.push(so);
      orders.push({
        so,
        cust: CUSTS[(i * 3 + 1) % CUSTS.length],
        model: model.modelId,
        qty,
        due,
        bases,
        status: "DELIVERED",
        unitPrice: model.unitPrice,
        livedIn: true,
        wasDelayed: delay > 0,
        delayDays: delay,
        lifecycle,
        ...(rescue ? { rescue } : {}),
      });
    }
    // 非延期案例也挂受影响订单（窗口邻近订单，凑足完整链）
    for (const c of cases) {
      if (c.affectedOrders.length > 0) continue;
      const near = orders
        .filter((o) => Math.abs(Date.parse(`${String(o.due)}T00:00:00Z`) - Date.parse(`${c.crossedAt}T00:00:00Z`)) < 30 * DAY_MS)
        .slice(0, 2)
        .map((o) => String(o.so));
      c.affectedOrders.push(...near);
    }
    return orders;
  }

  // -- ① Action 审计史 200 条（82% EXECUTED / 11% REJECTED / 4% CANCELLED / 3% FAILED） ----

  private buildActions(tenantId: string, seed: number, replayFrom: string, cases: LivedCase[]): ActionDraft[] {
    const out: ActionDraft[] = [];
    const baseNames = new Map(BASES.map((b) => [b.baseId, b.name]));
    const mkId = (i: number) => `act_lh_${tenantId}_${String(i).padStart(3, "0")}`;
    const approve = (role: string, approverId: string, at: string, comment?: string) => ({
      seq: 0,
      role,
      decision: "APPROVE" as const,
      approverId,
      decidedAt: `${at}T10:00:00.000Z`,
      ...(comment ? { comment } : {}),
    });
    // 1..10：案例处置 Action（全部 EXECUTED，createdAt = 案例采纳日 → 叙事互引）
    for (const c of cases) {
      const at = c.adoptedAt;
      const steps = [
        { ...approve("planner", `usr_${tenantId}_planner`, at, "方案有效性已验证，同意执行"), seq: 1 },
        { ...approve("admin", `usr_${tenantId}_admin`, at), seq: 2 },
      ];
      out.push({
        id: c.actionId,
        tenantId,
        actionTypeKey: "adopt_mitigation",
        payload: {
          base: c.baseName,
          factor: c.factor,
          planKey: c.mitigation.planKey,
          summary: `${c.baseName} · 采纳「${c.mitigation.name}」（${c.caseNo}）`,
          caseId: c.id,
        },
        origin: { userId: `usr_${tenantId}_base_manager` },
        status: "EXECUTED",
        approvalSteps: steps,
        executionResult: { ok: true, targetRef: `MO-${at.slice(0, 4)}-${1000 + (hashString(c.actionId) % 9000)}`, attempts: 1 },
        createdAt: `${at}T08:30:00.000Z`,
        updatedAt: `${at}T10:05:00.000Z`,
      });
    }
    // 11..200：日常审计史（状态分布精确 154/22/8/6 → 合计 164E/22R/8C/6F）
    const statuses: ActionDraft["status"][] = [
      ...Array<ActionDraft["status"]>(154).fill("EXECUTED"),
      ...Array<ActionDraft["status"]>(22).fill("REJECTED"),
      ...Array<ActionDraft["status"]>(8).fill("CANCELLED"),
      ...Array<ActionDraft["status"]>(6).fill("EXECUTION_FAILED"),
    ];
    const shuffleRng = mulberry32(seed ^ hashString("livedin-actions"));
    for (let i = statuses.length - 1; i > 0; i--) {
      const j = Math.floor(shuffleRng() * (i + 1));
      const tmp = statuses[i] as ActionDraft["status"];
      statuses[i] = statuses[j] as ActionDraft["status"];
      statuses[j] = tmp;
    }
    const TYPES: { key: string; summary: (i: number, base: string) => string }[] = [
      { key: "plan_change", summary: (i, base) => `${base} 周排产计划微调（B${100 + i}）` },
      { key: "采纳产能保障方案", summary: (_i, base) => `${base} 产能保障：夜班 + 渠道扩容组合` },
      { key: "adopt_mitigation", summary: (_i, base) => `${base} 处置方案执行` },
      { key: "定稿月度计划版本", summary: (i) => `${monthOf(addDays("2025-07-01", ((i - 11) * 364) / 189))} 月度计划定稿` },
      { key: "校准参数变更", summary: () => "校准提案参数落库" },
      { key: "计划版本变更", summary: () => "定稿版本字段变更（审批通道）" },
    ];
    let rejectSeq = 0;
    for (let i = 11; i <= 200; i++) {
      const status = statuses[i - 11] as ActionDraft["status"];
      const dayOffset = Math.round(((i - 11) * 364) / 189);
      const day = addDays(replayFrom, dayOffset);
      const t = TYPES[i % TYPES.length] as (typeof TYPES)[number];
      const baseId = BASES[i % BASES.length]?.baseId ?? "changzhou";
      const baseName = baseNames.get(baseId) ?? baseId;
      const createdAt = `${day}T0${8 + (i % 2)}:${String(10 + (i % 45)).padStart(2, "0")}:00.000Z`;
      const decidedAt = `${addDays(day, 1)}T09:30:00.000Z`;
      const steps: ActionDraft["approvalSteps"] = [];
      let executionResult: ActionDraft["executionResult"];
      if (status === "EXECUTED" || status === "EXECUTION_FAILED") {
        steps.push({ seq: 1, role: "admin", decision: "APPROVE", approverId: `usr_${tenantId}_admin`, decidedAt });
        executionResult =
          status === "EXECUTED"
            ? { ok: true, targetRef: `MO-${day.slice(0, 4)}-${1000 + (hashString(mkId(i)) % 9000)}`, attempts: 1 }
            : { ok: false, error: "下游 MES 写回超时（3 次重试后放弃）", attempts: 3 };
      } else if (status === "REJECTED") {
        steps.push({
          seq: 1,
          role: "admin",
          decision: "REJECT",
          approverId: `usr_${tenantId}_admin`,
          decidedAt,
          comment: REJECT_COMMENTS[rejectSeq++ % REJECT_COMMENTS.length] as string,
        });
      }
      out.push({
        id: mkId(i),
        tenantId,
        actionTypeKey: t.key,
        payload: { summary: t.summary(i, baseName), base: baseName },
        origin: { userId: i % 3 === 0 ? `usr_${tenantId}_base_manager` : `usr_${tenantId}_planner` },
        status,
        approvalSteps: steps,
        ...(executionResult ? { executionResult } : {}),
        createdAt,
        updatedAt: status === "CANCELLED" ? createdAt : decidedAt,
      });
    }
    return out;
  }

  // -- ② 回放（月批次 × 真实管线） ------------------------------------------------

  private async replay(
    ctx: AuthCtx,
    replayFrom: string,
    seed: number,
    cases: LivedCase[],
  ): Promise<{ batches: number; points: number; baseMonthWan: Map<string, number> }> {
    const maintPlans = (await this.repos.objects.listByType(ctx.tenantId, "MaintPlan")).map((m) => ({
      baseId: String(m.props.baseId),
      lastMaintStart: String(m.props.lastMaintStart),
    }));
    const genCtx: LivedGenContext = {
      seed,
      replayFromMs: Date.parse(`${replayFrom}T00:00:00Z`),
      maint: livedMaintWindows(maintPlans),
      incidents: incidentsFromCases(cases),
    };
    const generators = (BATTERY_TEMPLATE.tsGenerators ?? []) as unknown as TsGenSpec[];
    // 实体清单一次性加载（回放期内对象不变）
    const entitiesByType = new Map<string, { entityId: string; baseId: string }[]>();
    for (const gen of generators) {
      if (entitiesByType.has(gen.entityType)) continue;
      const refField = entityRefFieldOf(gen.entityType);
      const list = (await this.repos.objects.listByType(ctx.tenantId, gen.entityType))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ entityId: String(e.props[refField] ?? e.id), baseId: String(e.props.baseId ?? "") }));
      entitiesByType.set(gen.entityType, list);
    }
    // 月批次切分
    const months: { month: string; days: string[] }[] = [];
    for (let d = 0; d < REPLAY_DAYS; d++) {
      const dateIso = addDays(replayFrom, d);
      const month = monthOf(dateIso);
      const last = months[months.length - 1];
      if (!last || last.month !== month) months.push({ month, days: [dateIso] });
      else last.days.push(dateIso);
    }
    const packCellCount = BATTERY_SOLVER_PARAMS.packCellCount as number;
    const baseMonthCells = new Map<string, number>();
    let points = 0;
    let lastWriteMs = 0;
    for (const batch of months) {
      // 增量聚合按 ingestedAt 水位推进：保证批与批的 ingestedAt 严格递增（毫秒级）
      while (Date.now() <= lastWriteMs) await new Promise((r) => setTimeout(r, 1));
      for (const gen of generators) {
        const series = await this.ts.ensureSeries(ctx.tenantId, {
          seriesKey: gen.seriesKey,
          entityType: gen.entityType,
          entityRefField: entityRefFieldOf(gen.entityType),
          timeField: "ts",
          measureFields: gen.weightField ? [gen.measureField, gen.weightField] : [gen.measureField],
          origin: "SYNTHETIC",
        });
        const entities = entitiesByType.get(gen.entityType) ?? [];
        const batchPoints: { entityId: string; ts: string; values: Record<string, number>; tick?: number }[] = [];
        for (const e of entities) {
          for (const dateIso of batch.days) {
            const dayIndex = Math.round((Date.parse(`${dateIso}T00:00:00Z`) - genCtx.replayFromMs) / DAY_MS);
            const values = livedPoint(gen, e, dateIso, dayIndex, genCtx);
            batchPoints.push({ entityId: e.entityId, ts: `${dateIso}T00:00:00.000Z`, values, tick: 0 });
            if (gen.seriesKey === "output:line") {
              const key = `${e.baseId}|${batch.month}`;
              baseMonthCells.set(key, (baseMonthCells.get(key) ?? 0) + (values[gen.measureField] ?? 0));
            }
          }
        }
        const r = await this.ts.writePoints(ctx.tenantId, series, batchPoints);
        points += r.written;
      }
      lastWriteMs = Date.now();
      // 真实管线：增量聚合 → 派生 → 校准配对（M11）→ 规则扫描（精简批报告 = 不落 tick 报告）
      await this.ts.runAggregation(ctx.tenantId);
      await this.ontology.runDerivations(ctx);
      if (this.calibrationTicker) await this.calibrationTicker(ctx.tenantId);
      await this.ruleScan.scan(ctx.tenantId);
    }
    // 万套口径（pack = packCellCount 颗电芯）
    const baseMonthWan = new Map<string, number>();
    for (const [key, cells] of baseMonthCells) baseMonthWan.set(key, round(cells / packCellCount / 10000, 2));
    return { batches: months.length, points, baseMonthWan };
  }

  // -- ③ S&OP V1–V12：达成率 88% → 94%，与月度实绩同源勾稽 -------------------------

  private async seedSopVersions(ctx: AuthCtx, replayFrom: string, baseMonthWan: Map<string, number>): Promise<void> {
    void replayFrom;
    // 月序列从回放实绩键集合推导（V1..V12 与回放月一一对应）
    const monthSet = [...new Set([...baseMonthWan.keys()].map((k) => k.split("|")[1] as string))].sort();
    const baseIds = BASES.map((b) => b.baseId).sort();
    const segs = (await this.repos.objects.listByType(ctx.tenantId, "Segment")).sort((a, b) =>
      String(a.props.segKey) < String(b.props.segKey) ? -1 : 1,
    );
    const resolutionsByIdx: Record<number, { name: string; delta: number }[]> = {
      2: [{ name: "枣庄一线提前爬坡（C21 储能需求上修决议）", delta: 1.2 }],
      4: [{ name: "正极提前备料专项（到货危机对策）", delta: 0.8 }],
      9: [{ name: "检修季错峰排产", delta: 0.5 }],
    };
    const agendaByIdx: Record<number, { source: string; title: string }[]> = {
      2: [{ source: "C21", title: "储能 滚动预测偏差 +15.0%（>±10%），自动提报高管决策会" }],
      4: [{ source: "GAP", title: "正极到货危机：常州齐套断档，需供给对策" }],
    };
    for (let m = 0; m < monthSet.length; m++) {
      const month = monthSet[m] as string;
      // 月度实绩 = Σ基地（与 history/bundle trend 同一求和次序 → 字节一致）
      let actual = 0;
      for (const b of baseIds) actual = round(actual + (baseMonthWan.get(`${b}|${month}`) ?? 0), 4);
      const attainment = round(88 + (m * 6) / 11, 1);
      const demand = round(actual / (attainment / 100), 2);
      const supply = round((actual + demand) / 2, 2);
      const rows = segs.map((s) => {
        const share = Number(s.props.baselineShare ?? 0);
        const target = round(demand * share, 2);
        return { key: String(s.props.segKey), name: String(s.props.name), target, rolling: target, lastActual: round(actual * share, 2), dv: 0, flagged: false };
      });
      const version: SopVersion = {
        id: `sop_lh_${ctx.tenantId}_${month}`,
        tenantId: ctx.tenantId,
        month,
        status: "FINAL",
        inputs: { livedIn: true, demTotal: demand, supTotal: supply, actualOutputWan: actual, attainmentPct: attainment },
        steps: {
          s1: { changes: [], boundaryDeltaWanPerMonth: 0 },
          s2: { rows, total: { target: demand, rolling: demand, dv: 0 } },
          s3: { perBase: [], increments: [], sup: supply, dem: demand, gap: round(demand - supply, 4), flagged: false },
          s4: { revSum: 0, gmSum: 0, gmBudget: 16, cashCushion: 58, gmRoll: 16, gmOk: true, cashOk: true, pass: true, violations: [] },
          s5: { agenda: agendaByIdx[m] ?? [], resolutions: resolutionsByIdx[m] ?? [], supFinal: supply, gapFinal: round(demand - supply, 4) },
        },
        agenda: agendaByIdx[m] ?? [],
        resolutions: resolutionsByIdx[m] ?? [],
        supFinal: supply,
        createdBy: `usr_${ctx.tenantId}_planner`,
        createdAt: `${month}-25T09:00:00.000Z`,
        updatedAt: `${month}-28T09:00:00.000Z`,
      };
      await this.repos.sopVersions.put(version);
    }
  }

  // -- ③ 规则演进（≥5 条版本史；C16 收紧挂「到货危机复盘」） -------------------------

  private async seedRuleEvolution(ctx: AuthCtx): Promise<LivedInStateRecord["ruleChanges"]> {
    const mk = async (
      key: string,
      name: string,
      expression: string,
      description: string,
      params?: Record<string, number>,
    ) => {
      await this.rules.create(ctx, {
        key,
        name,
        description,
        expression,
        scopeObjectTypes: key === "C16" ? ["Shipment"] : ["Order"],
        severity: "WARN",
        ...(params ? { params } : {}),
        origin: { type: "SYNTHETIC" },
        status: "PUBLISHED",
      });
    };
    // C08 红线演进（DF.13 单一来源 OUTSOURCE_REDLINE_HISTORY）：标准合成已发布**现行值**作 v1；
    // 此处按版本史重放收紧过程，末条（PUBLISHED）落回现行红线 —— 表达式/复盘理由全部派生，禁内联百分数。
    // WO-RULE-EXPR-PARAMS：**每一版都是引用式 expression + 自己那一版的 params**（不是把历史值烤进
    // 表达式字符串）。否则这条链会重新引入 G-C08-EXPR-PARAM-SPLIT：lived-in 租户的发布态 C08
    // 判定按 expression 里的字面量走，而 `whatIf.outsourceMax` 按 params 走，两个数又分叉了。
    for (const h of OUTSOURCE_REDLINE_HISTORY.slice(1)) {
      await mk(
        OUTSOURCE_REDLINE.ruleKey,
        OUTSOURCE_REDLINE.ruleName,
        outsourceRedlineViolationExpr(OUTSOURCE_REDLINE.subject, { param: OUTSOURCE_REDLINE.paramKey }),
        h.reason,
        { [OUTSOURCE_REDLINE.paramKey]: h.maxRatio },
      );
    }
    // C16：齐套覆盖天数 3 → 5（到货危机复盘）
    await mk("C16", "齐套覆盖天数下限", "Shipment.coverageDays < 3", "出厂基线：关键材料齐套覆盖 ≥3 天");
    await mk(
      "C16",
      "齐套覆盖天数下限",
      "Shipment.coverageDays < 5",
      "到货危机复盘（2025-10-28~2025-11-10）：正极到货延迟导致齐套断档，覆盖天数 3→5 天",
    );
    const row = (
      key: string,
      version: number,
      label: string,
      expression: string,
      reason: string,
      changedAt: string,
      status: string,
      tags: string[],
    ) => ({ key, name: key === "C16" ? "齐套覆盖天数下限" : "外协比例红线", version, label, expression, reason, changedAt, status, tags });
    return [
      // DF.13：C08 版本史逐条从 OUTSOURCE_REDLINE_HISTORY 派生（末条 PUBLISHED 即现行红线，改红线自动同步）。
      ...OUTSOURCE_REDLINE_HISTORY.map((h) =>
        row(
          OUTSOURCE_REDLINE.ruleKey,
          h.version,
          h.label,
          outsourceRedlineViolationExpr(OUTSOURCE_REDLINE.subject, h.maxRatio),
          h.reason,
          h.changedAt,
          h.status,
          [],
        ),
      ),
      row("C16", 1, "v1.0", "Shipment.coverageDays < 3", "出厂基线：关键材料齐套覆盖 ≥3 天", "2025-07-01", "RETIRED", []),
      row(
        "C16",
        2,
        "v2.0",
        "Shipment.coverageDays < 5",
        "到货危机复盘（2025-10-28~2025-11-10）：正极到货延迟导致齐套断档，覆盖天数 3→5 天",
        "2025-12-03",
        "PUBLISHED",
        ["到货危机复盘"],
      ),
    ];
  }

  // -- ③ 校准叙事：8 次提案（6 生效 + 2 被拒：漂移闸门 / 回测不足 1pct） ----------------

  private async seedCalibrationNarrative(ctx: AuthCtx, replayFrom: string): Promise<void> {
    const tid = ctx.tenantId;
    const mape = mapeSeriesFor(replayFrom);
    const mapeAt = (week: number) => (mape[week - 1] as { mape: number }).mape;
    type P = {
      k: number;
      createdAt: string;
      week: number;
      method: "EMA" | "REPLAY_ATTRIBUTION" | "QUANTILE";
      parameter: string;
      scope: "SOLVER_PARAMS" | "ONTOLOGY_PROPERTY";
      path: string;
      cur: number;
      prop: number;
      status: "APPLIED" | "REJECTED";
      improvement: number; // mapeBefore − simulatedMapeAfter（pct）
      flags: string[];
      trigger: string;
    };
    const specs: P[] = [
      { k: 1, createdAt: "2025-07-26", week: 4, method: "EMA", parameter: "工序良率基线（化成）", scope: "ONTOLOGY_PROPERTY", path: "Process.yield", cur: 0.952, prop: 0.958, status: "APPLIED", improvement: 2.1, flags: [], trigger: "C12" },
      { k: 2, createdAt: "2025-08-30", week: 9, method: "REPLAY_ATTRIBUTION", parameter: "产能预测·爬坡系数基线", scope: "SOLVER_PARAMS", path: "ramp.base", cur: 0.88, prop: 0.9, status: "APPLIED", improvement: 1.8, flags: ["ATTRIBUTION_SHARE:0.79"], trigger: "C12" },
      { k: 3, createdAt: "2025-10-04", week: 14, method: "QUANTILE", parameter: "P90 健康度系数", scope: "SOLVER_PARAMS", path: "health.normal", cur: 0.93, prop: 0.94, status: "APPLIED", improvement: 1.2, flags: [], trigger: "CALIBRATION_RUN" },
      // 到货危机窗口内观测漂移 31% > 20% → 结构性漂移闸门，不出 EMA 提案（M11 §4）
      { k: 4, createdAt: "2025-11-29", week: 22, method: "EMA", parameter: "检修产能系数（OEE 基线）", scope: "SOLVER_PARAMS", path: "maintMult", cur: 0.72, prop: 0.55, status: "REJECTED", improvement: 0, flags: ["STRUCTURAL_SHIFT"], trigger: "C12" },
      { k: 5, createdAt: "2026-01-17", week: 29, method: "REPLAY_ATTRIBUTION", parameter: "产能预测·爬坡系数基线", scope: "SOLVER_PARAMS", path: "ramp.base", cur: 0.9, prop: 0.92, status: "APPLIED", improvement: 1.6, flags: ["ATTRIBUTION_SHARE:0.84"], trigger: "CALIBRATION_RUN" },
      // 回测改善 0.6pct < 1pct 门槛 → NO_IMPROVEMENT 拒绝（M11 §5）
      { k: 6, createdAt: "2026-02-21", week: 34, method: "EMA", parameter: "工序良率基线（卷绕）", scope: "ONTOLOGY_PROPERTY", path: "Process.yield", cur: 0.957, prop: 0.958, status: "REJECTED", improvement: 0.6, flags: ["NO_IMPROVEMENT"], trigger: "CALIBRATION_RUN" },
      { k: 7, createdAt: "2026-04-11", week: 41, method: "QUANTILE", parameter: "P90 健康度系数", scope: "SOLVER_PARAMS", path: "health.normal", cur: 0.94, prop: 0.95, status: "APPLIED", improvement: 1.1, flags: [], trigger: "CALIBRATION_RUN" },
      { k: 8, createdAt: "2026-06-06", week: 49, method: "EMA", parameter: "工序良率基线（涂布）", scope: "ONTOLOGY_PROPERTY", path: "Process.yield", cur: 0.96, prop: 0.963, status: "APPLIED", improvement: 1.3, flags: [], trigger: "C12" },
    ];
    for (const s of specs) {
      const windowFrom = addDays(s.createdAt, -14);
      const mapeBefore = mapeAt(s.week);
      const simulatedAfter = round(mapeBefore - s.improvement, 2);
      const applied = s.status === "APPLIED";
      await this.repos.calibrationProposals.put({
        id: `cal_lh_${tid}_${s.k}`,
        tenantId: tid,
        parameter: s.parameter,
        paramPath: s.path,
        objectRef: "Solver:capacity_forecast",
        currentValue: s.cur,
        proposedValue: s.prop,
        basis: { windowFrom, windowTo: s.createdAt, samples: 140 + s.k * 7 },
        trigger: s.trigger,
        status: s.status,
        ...(applied ? { appliedFrom: s.cur, appliedAt: `${addDays(s.createdAt, 2)}T08:00:00.000Z` } : {}),
        createdAt: `${s.createdAt}T07:00:00.000Z`,
        sliceKey: `capacity_forecast|all|${s.k % 2 === 0 ? "圆柱-LFP" : "4680-NCM"}`,
        paramRef: { scope: s.scope, path: s.path },
        method: s.method,
        evidence: {
          windowFrom,
          windowTo: s.createdAt,
          nPairs: 140 + s.k * 7,
          mapeBefore,
          simulatedMapeAfter: simulatedAfter,
          bias: round((s.k % 2 === 0 ? -1 : 1) * 0.02 * (1 + s.k / 10), 4),
          flags: s.flags,
        },
        ...(applied ? { realizedMape: round(simulatedAfter + 0.3, 2) } : {}),
      });
      if (applied) {
        await this.repos.calibrationHistory.put({
          id: `calh_lh_${tid}_${s.k}`,
          tenantId: tid,
          at: `${addDays(s.createdAt, 2)}T08:00:00.000Z`,
          trigger: s.trigger,
          changedParams: [s.parameter],
          mapeBefore,
          mapeAfter: simulatedAfter,
          proposalId: `cal_lh_${tid}_${s.k}`,
          method: s.method,
          simulatedMapeAfter: simulatedAfter,
          realizedMape: round(simulatedAfter + 0.3, 2),
        });
      }
    }
  }
}
