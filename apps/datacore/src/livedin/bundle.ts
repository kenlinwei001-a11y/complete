import type { HistoryBundle, HistoryWatermark } from "@platform/contracts";
import type { AuthCtx, LivedInStateRecord, ObjectInstance, TsPointRecord } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { AuthzService } from "../authz.js";
import { notFound, validationError } from "../errors.js";
import { round } from "../prng.js";
import { BATTERY_SOLVER_PARAMS, BATTERY_TEMPLATE } from "../synthetic/battery.js";
import { entityRefFieldOf } from "../synthetic/service.js";
import { attainEventFlag, rollupLineAttainment, type TsGenSpec } from "../synthetic/tsgen.js";
import { livedMaintWindows, livedPoint, maintMonthOf, type LivedGenContext } from "./tsgen.js";
import { incidentsFromCases } from "./engine.js";

const DAY_MS = 86400000;

/**
 * 运营态历史查询面（§5 GET /a/v1/history/bundle）+ §6 origin 替换路径。
 *
 * 行级权限同样作用于历史（Y6）：基地维度记录（trend/monthly/案例/已交付订单）按
 * visibleBases / Order 行策略过滤；准交率等聚合在可见范围上重算；Action/校准/规则/
 * S&OP/任务史为租户级记录，全量下发。大体量子集（actionHistory）分页。
 *
 * 数字同源（Y3）：trend/monthly 直接由 output:line 原始时序点聚合（与回放写入
 * 同一事实源、同一求和次序）——任何下钻（月度 → 基地明细 → 检修对象）都能对上。
 */
export class HistoryService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
  ) {}

  private async state(tenantId: string): Promise<LivedInStateRecord> {
    const s = await this.repos.livedInStates.get(tenantId, tenantId);
    if (!s) throw notFound("history bundle (run a synthetic job with livedIn:true first)");
    return s;
  }

  private async visibleBases(ctx: AuthCtx): Promise<{ baseId: string; name: string }[]> {
    const filters = await this.authz.require(ctx, "OBJECT_TYPE", "Base", "READ");
    return (await this.repos.objects.listByType(ctx.tenantId, "Base"))
      .filter((b) => this.authz.rowAllowed(ctx, filters, b.props))
      .map((b) => ({ baseId: String(b.props.baseId), name: String(b.props.name) }))
      .sort((a, b) => (a.baseId < b.baseId ? -1 : 1));
  }

  private async outputPoints(tenantId: string): Promise<TsPointRecord[]> {
    const series = (await this.repos.tsSeries.list(tenantId, (s) => s.seriesKey === "output:line"))[0];
    if (!series) return [];
    return this.repos.tsPoints.list(tenantId, series.id);
  }

  async bundle(ctx: AuthCtx, q?: { page?: number; pageSize?: number }): Promise<HistoryBundle> {
    const state = await this.state(ctx.tenantId);
    const tid = ctx.tenantId;
    const packCellCount = BATTERY_SOLVER_PARAMS.packCellCount as number;
    const bases = await this.visibleBases(ctx);
    const visible = new Set(bases.map((b) => b.baseId));
    const replayMonths: string[] = [];
    {
      let t = Date.parse(`${state.generatedFrom.replayFrom}T00:00:00Z`);
      const end = Date.parse(`${state.generatedFrom.replayTo}T00:00:00Z`);
      while (t < end) {
        const m = new Date(t).toISOString().slice(0, 7);
        if (replayMonths[replayMonths.length - 1] !== m) replayMonths.push(m);
        t += DAY_MS;
      }
    }

    // -- trend / monthly：output:line 原始点 → 基地×月求和（与回放求和次序一致） ----
    const points = await this.outputPoints(tid);
    const baseMonthCells = new Map<string, number>();
    for (const p of points) {
      const baseId = p.entityId.replace(/^LINE-/, "");
      if (!visible.has(baseId)) continue;
      const month = p.ts.slice(0, 7);
      const key = `${baseId}|${month}`;
      baseMonthCells.set(key, (baseMonthCells.get(key) ?? 0) + (p.values.output ?? 0));
    }
    const maintPlans = (await this.repos.objects.listByType(tid, "MaintPlan")).map((m) => ({
      baseId: String(m.props.baseId),
      lastMaintStart: String(m.props.lastMaintStart),
    }));
    const maintWindows = livedMaintWindows(maintPlans);
    const maintMonthByBase = new Map<string, string>();
    for (const [baseId, w] of maintWindows) maintMonthByBase.set(baseId, maintMonthOf(w));
    const baseNameOf = new Map(bases.map((b) => [b.baseId, b.name]));
    const monthly: HistoryBundle["monthly"] = [];
    const trend: HistoryBundle["trend"] = [];
    for (const month of replayMonths) {
      let totalWan = 0;
      const maintBaseIds: string[] = [];
      for (const b of bases) {
        const cells = baseMonthCells.get(`${b.baseId}|${month}`) ?? 0;
        const wan = round(cells / packCellCount / 10000, 2);
        totalWan = round(totalWan + wan, 4);
        const maint = maintMonthByBase.get(b.baseId) === month;
        if (maint) maintBaseIds.push(b.baseId);
        monthly.push({ baseId: b.baseId, baseName: baseNameOf.get(b.baseId) ?? b.baseId, month, output: wan, maint });
      }
      trend.push({
        month,
        output: round(totalWan, 2),
        maintBaseIds,
        ...(state.liveMonths.includes(month) ? { live: true } : {}),
      });
    }

    // -- delivered：已交付订单台账（Order 行策略过滤；聚合在可见范围重算） -------------
    const orderFilters = await this.authz.require(ctx, "OBJECT_TYPE", "Order", "READ");
    const deliveredObjs = (await this.repos.objects.listByType(tid, "Order"))
      .filter((o) => o.props.livedIn === true && this.authz.rowAllowed(ctx, orderFilters, o.props))
      .sort((a, b) => (String(a.props.so) < String(b.props.so) ? -1 : 1));
    const delivered = deliveredObjs.map((o) => this.toDelivered(o));
    const onTime = delivered.filter((d) => d.onTime).length;
    const onTimeRate = delivered.length > 0 ? round((onTime / delivered.length) * 100, 1) : 0;

    // -- riskCases：基地维度过滤（czmgr 只见常州案例） --------------------------------
    const riskCases = (await this.repos.riskCases.list(tid, (c) => visible.has(c.baseId)))
      .sort((a, b) => (a.caseNo < b.caseNo ? -1 : 1))
      .map((c) => ({
        id: c.id,
        caseNo: c.caseNo,
        title: c.title,
        baseId: c.baseId,
        baseName: c.baseName,
        factor: c.factor,
        severity: c.severity,
        windowFrom: c.windowFrom,
        windowTo: c.windowTo,
        crossedAt: c.crossedAt,
        adoptedAt: c.adoptedAt,
        resolvedAt: c.resolvedAt,
        mitigation: c.mitigation,
        actionId: c.actionId,
        affectedOrders: c.affectedOrders,
        timeline: c.timeline,
        tags: c.tags,
        curve: c.curve,
      }));

    // -- actionHistory：租户级，分页（createdAt desc, id desc 稳定序） ------------------
    const allActions = (await this.repos.actionDrafts.list(tid, (d) => d.id.startsWith("act_lh_"))).sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
    );
    const page = Math.max(1, q?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q?.pageSize ?? 20));
    const items = allActions.slice((page - 1) * pageSize, page * pageSize).map((d) => {
      const reject = d.approvalSteps.find((s) => s.decision === "REJECT");
      return {
        id: d.id,
        actionTypeKey: d.actionTypeKey,
        summary: String(d.payload.summary ?? d.actionTypeKey),
        status: d.status as "EXECUTED" | "REJECTED" | "CANCELLED" | "EXECUTION_FAILED",
        requestedBy: d.origin.userId,
        decidedBy: d.approvalSteps.find((s) => s.decision)?.approverId ?? "",
        ...(reject?.comment ? { comment: reject.comment } : {}),
        createdAt: d.createdAt,
        ...(d.executionResult?.targetRef ? { targetRef: d.executionResult.targetRef } : {}),
      };
    });
    const countBy = (s: string) => allActions.filter((d) => d.status === s).length;
    const actionStats = {
      executed: countBy("EXECUTED"),
      rejected: countBy("REJECTED"),
      cancelled: countBy("CANCELLED"),
      failed: countBy("EXECUTION_FAILED"),
      total: allActions.length,
    };

    // -- calibrations：lived 叙事记录（cal_lh_ / calh_lh_） ---------------------------
    const proposals = (await this.repos.calibrationProposals.list(tid, (p) => p.id.startsWith("cal_lh_")))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((p) => ({
        id: p.id,
        parameter: p.parameter,
        paramPath: p.paramPath,
        ...(p.method ? { method: p.method } : {}),
        trigger: p.trigger,
        status: p.status,
        currentValue: p.currentValue,
        proposedValue: p.proposedValue,
        createdAt: p.createdAt,
        ...(p.appliedAt ? { appliedAt: p.appliedAt } : {}),
        ...(p.realizedMape !== undefined ? { realizedMape: p.realizedMape } : {}),
        ...(p.evidence ? { evidence: p.evidence } : {}),
      }));
    const calHistory = (await this.repos.calibrationHistory.list(tid, (h) => h.id.startsWith("calh_lh_")))
      .sort((a, b) => (a.at < b.at ? -1 : 1))
      .map((h) => ({
        at: h.at,
        trigger: h.trigger,
        changedParams: h.changedParams,
        mapeBefore: h.mapeBefore,
        mapeAfter: h.mapeAfter,
        ...(h.method ? { method: h.method } : {}),
        ...(h.simulatedMapeAfter !== undefined ? { simulatedMapeAfter: h.simulatedMapeAfter } : {}),
        ...(h.realizedMape !== undefined ? { realizedMape: h.realizedMape } : {}),
      }));

    // -- sopVersions：V1–V12（达成率/实绩为种子时与回放同源计算的值） -------------------
    const sopVersions = (await this.repos.sopVersions.list(tid, (v) => v.id.startsWith("sop_lh_")))
      .sort((a, b) => (a.month < b.month ? -1 : 1))
      .map((v, i) => ({
        month: v.month,
        label: `V${i + 1}`,
        status: v.status,
        demand: Number(v.inputs.demTotal ?? 0),
        supply: Number(v.inputs.supTotal ?? 0),
        gap: round(Number(v.inputs.demTotal ?? 0) - Number(v.inputs.supTotal ?? 0), 2),
        attainment: Number(v.inputs.attainmentPct ?? 0),
        actualOutput: Number(v.inputs.actualOutputWan ?? 0),
        resolutions: v.resolutions,
      }));

    return {
      generatedFrom: {
        ...state.generatedFrom,
        liveMonths: state.liveMonths,
        liveRatio: round(state.liveMonths.length / Math.max(1, replayMonths.length), 4),
      },
      crisisWindow: state.crisisWindow,
      trend,
      // 三线偏差（驾驶舱 #5）：供给=月产出；需求=供给×需求系数（危机窗口拉高 → 缺口可见）。
      deviation: trend.map((t) => {
        const crisis = t.month >= state.crisisWindow.from.slice(0, 7) && t.month <= state.crisisWindow.to.slice(0, 7);
        const demand = round(t.output * (crisis ? 1.22 : 1.06), 2);
        return { month: t.month, demand, supply: t.output, gap: round(demand - t.output, 2) };
      }),
      monthly,
      delivered,
      deliveredCount: delivered.length,
      onTimeRate,
      riskCases,
      actionHistory: { items, total: allActions.length, page, pageSize },
      actionStats,
      mapeSeries: state.mapeSeries,
      calibrations: { proposals, history: calHistory },
      sopVersions,
      ruleVersions: state.ruleChanges,
      incubated: state.incubated,
      taskHistory: state.taskHistory as HistoryBundle["taskHistory"],
    };
  }

  private toDelivered(o: ObjectInstance): HistoryBundle["delivered"][number] {
    const p = o.props as Record<string, unknown>;
    const lifecycle = (p.lifecycle ?? {}) as Record<string, string>;
    const rescue = p.rescue as { caseId: string; actionId: string; note: string } | undefined;
    const delayDays = Number(p.delayDays ?? 0);
    return {
      so: String(p.so),
      cust: String(p.cust),
      model: String(p.model),
      qty: Number(p.qty ?? 0),
      bases: (p.bases as string[]) ?? [],
      due: String(p.due),
      deliveredAt: lifecycle.deliveredAt ?? String(p.due),
      delayDays,
      onTime: delayDays <= 0,
      lifecycle: {
        createdAt: lifecycle.createdAt ?? "",
        scheduledAt: lifecycle.scheduledAt ?? "",
        producedAt: lifecycle.producedAt ?? "",
        deliveredAt: lifecycle.deliveredAt ?? "",
      },
      ...(rescue ? { rescue: { caseId: rescue.caseId, actionId: rescue.actionId, note: rescue.note } } : {}),
    };
  }

  /** 全局合成水印（§4.5）：hover 显示 generatedFrom 与 seed；随 LIVE 占比消退。 */
  async watermark(ctx: AuthCtx): Promise<HistoryWatermark> {
    const s = await this.repos.livedInStates.get(ctx.tenantId, ctx.tenantId);
    if (!s) return { synthetic: false };
    return {
      synthetic: true,
      industry: s.generatedFrom.industry,
      scale: s.generatedFrom.scale,
      seed: s.generatedFrom.seed,
      replayFrom: s.generatedFrom.replayFrom,
      replayTo: s.generatedFrom.replayTo,
      liveMonths: s.liveMonths,
      liveRatio: round(s.liveMonths.length / 13, 4),
    };
  }

  /**
   * §6 / Y9 origin 替换路径（最小实现，FDE 交付口径）：接入一个月 LIVE 实绩，
   * 同期 SYNTHETIC 点被同键覆盖（series+entity+ts upsert），趋势无缝；水印 LIVE
   * 占比随之变化。本期 LIVE 值由连接器同管线回填——测试钩子用与回放同一确定性
   * 生成器重算该月值（佐证「同一管线、前端无感」），生产路径换成连接器行即可。
   * 直接走 ts_points.upsert（历史回填绕过 7 天迟到容差，不产生 late-arrival 告警）。
   */
  async liveIngest(ctx: AuthCtx, month: string): Promise<{ month: string; written: number; liveMonths: string[]; liveRatio: number }> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw validationError("month must be YYYY-MM");
    const state = await this.state(ctx.tenantId);
    if (month < state.generatedFrom.replayFrom.slice(0, 7) || month >= state.generatedFrom.replayTo) {
      throw validationError(`month ${month} outside the replay window ${state.generatedFrom.replayFrom} ~ ${state.generatedFrom.replayTo}`);
    }
    const tid = ctx.tenantId;
    const maintPlans = (await this.repos.objects.listByType(tid, "MaintPlan")).map((m) => ({
      baseId: String(m.props.baseId),
      lastMaintStart: String(m.props.lastMaintStart),
    }));
    const cases = await this.repos.riskCases.list(tid);
    const genCtx: LivedGenContext = {
      seed: state.generatedFrom.seed,
      replayFromMs: Date.parse(`${state.generatedFrom.replayFrom}T00:00:00Z`),
      maint: livedMaintWindows(maintPlans),
      incidents: incidentsFromCases(cases),
    };
    const generators = (BATTERY_TEMPLATE.tsGenerators ?? []) as unknown as TsGenSpec[];
    const days: string[] = [];
    {
      let t = Date.parse(`${month}-01T00:00:00Z`);
      while (new Date(t).toISOString().slice(0, 7) === month) {
        days.push(new Date(t).toISOString().slice(0, 10));
        t += DAY_MS;
      }
    }
    const ingestedAt = new Date().toISOString();
    // 逐设备勾稽（A1）：attainment:line 由该线真实 oee:equip/yield:process rollup（与历史/sim/engine 单一来源）。
    const planBase = BATTERY_SOLVER_PARAMS.planBaseline as { oeePlan: number; yieldPlan: number };
    const equipByLine = new Map<string, string[]>();
    for (const e of await this.repos.objects.listByType(tid, "Equipment")) {
      const ln = String(e.props.lineId ?? "");
      (equipByLine.get(ln) ?? equipByLine.set(ln, []).get(ln)!).push(String(e.props.equipId ?? e.id));
    }
    const procByLine = new Map<string, string[]>();
    for (const p of await this.repos.objects.listByType(tid, "Process")) {
      const ln = String(p.props.lineId ?? "");
      (procByLine.get(ln) ?? procByLine.set(ln, []).get(ln)!).push(String(p.props.processId ?? p.id));
    }
    const oeeByEquipDay = new Map<string, Map<string, { oee: number; output: number }>>();
    const yieldByProcDay = new Map<string, Map<string, number>>();
    let written = 0;
    for (const gen of generators) {
      const series = (await this.repos.tsSeries.list(tid, (s) => s.seriesKey === gen.seriesKey))[0];
      if (!series) continue;
      const refField = entityRefFieldOf(gen.entityType);
      const isAttain = gen.derive?.kind === "attainment";
      const entities = (await this.repos.objects.listByType(tid, gen.entityType))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ entityId: String(e.props[refField] ?? e.id), baseId: String(e.props.baseId ?? "") }));
      const rows: TsPointRecord[] = [];
      for (const e of entities) {
        for (const dateIso of days) {
          const dayIndex = Math.round((Date.parse(`${dateIso}T00:00:00Z`) - genCtx.replayFromMs) / DAY_MS);
          let values: Record<string, number>;
          if (isAttain) {
            const eqs = (equipByLine.get(e.entityId) ?? []).map((eq) => oeeByEquipDay.get(eq)?.get(dateIso)).filter((x): x is { oee: number; output: number } => !!x);
            const prs = (procByLine.get(e.entityId) ?? []).map((pr) => yieldByProcDay.get(pr)?.get(dateIso)).filter((y): y is number => y != null);
            values = rollupLineAttainment(eqs, prs, planBase, attainEventFlag(dateIso, genCtx.maint.get(e.baseId)));
          } else {
            values = livedPoint(gen, e, dateIso, dayIndex, genCtx);
            if (gen.seriesKey === "oee:equip") {
              let m = oeeByEquipDay.get(e.entityId);
              if (!m) oeeByEquipDay.set(e.entityId, (m = new Map()));
              m.set(dateIso, { oee: values.oee ?? 0, output: values.output ?? 1 });
            } else if (gen.seriesKey === "yield:process") {
              let m = yieldByProcDay.get(e.entityId);
              if (!m) yieldByProcDay.set(e.entityId, (m = new Map()));
              m.set(dateIso, values.yield ?? 0);
            }
          }
          rows.push({ seriesId: series.id, entityId: e.entityId, ts: `${dateIso}T00:00:00.000Z`, values, ingestedAt, tick: 0, origin: "LIVE" });
        }
      }
      written += await this.repos.tsPoints.upsert(tid, rows);
    }
    if (!state.liveMonths.includes(month)) {
      state.liveMonths = [...state.liveMonths, month].sort();
      await this.repos.livedInStates.put(state);
    }
    return { month, written, liveMonths: state.liveMonths, liveRatio: round(state.liveMonths.length / 13, 4) };
  }
}
