import type {
  GapCode,
  GapFinding,
  GapReport,
  GrowthFillResult,
  ScaffoldDraft,
  SubmitQueryBody,
} from "@platform/contracts";
import type { AppDeps } from "../deps.js";
import type { RequestAuth } from "../auth.js";
import { classifyGap, FILL } from "./probe.js";
import { scaffoldDraftPlan, questionSlug } from "./scaffold.js";
import { decideDataGap, groundingVocab } from "./data-boundary.js";

/**
 * 自成长发动机 P3 · wiring 单源（RL3/RL10：probe/fill 只此一份，`/api/v1/growth/run` 与
 * 场景发育闭环 `growScenario`(O9) 共用，不分叉第二套引擎）。
 *
 *  - probe : 把问句经 orchestrator 实跑到终态 → 确定性 classifyGap（纯函数）。
 *  - fill  : 据缺口码分派真补法（缺数据真人正门 / scaffold DRAFT 计划 / 兜底骨架工单）。
 *
 * 与 `runGrowthLoop`(loop.ts) 注入对接：runGrowthLoop({ probe, fill }) 即得"探针→补齐→重跑→收敛"闭环。
 * 本工厂只搬运既有 server.ts 内联实现，逻辑零改（行为等价），便于 growScenario 复用。
 */
export interface GrowthLoopWiring {
  probe: () => Promise<GapReport>;
  fill: (gap: GapFinding) => Promise<GrowthFillResult>;
  /** 本轮已 scaffold 的 DRAFT 草稿（按 gapCode 去重）——供工单回填 scaffoldedDrafts。 */
  scaffoldedByGap: Map<GapCode, ScaffoldDraft[]>;
}

const SCAFFOLDABLE = new Set<GapCode>(["NO_PLAN", "SOLVER_NOT_FOUND"]);

export function buildGrowthLoopWiring(
  deps: AppDeps,
  a: RequestAuth,
  body: SubmitQueryBody,
  emitDomainEvent: (tenantId: string, event: string, payload?: Record<string, unknown>) => Promise<void>,
): GrowthLoopWiring {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const scaffoldedByGap = new Map<GapCode, ScaffoldDraft[]>();

  const probe = async (): Promise<GapReport> => {
    const { taskId } = await deps.orchestrator.submitQuery(a, body, undefined, { internal: true });
    let task = await deps.repos.tasks.get(taskId);
    for (let i = 0; i < 100 && (!task || !TERMINAL.has(task.status)); i++) {
      await new Promise((r) => setTimeout(r, 50));
      task = await deps.repos.tasks.get(taskId);
    }
    if (!task) throw new Error("PROBE_FAILED: probe task vanished");
    return classifyGap(task);
  };

  const fill = async (gap: GapFinding): Promise<GrowthFillResult> => {
    await emitDomainEvent(a.tenantId, "growth.gap_detected", { gapCode: gap.gapCode, atStep: gap.atStep ?? null });
    let result: GrowthFillResult;
    // G-9 发育闭环招牌（缺件卡→自动补→GOVERNED 活体）：空租户根因 = 无任何对象世界 → 卡的预设对象/槽位
    // 填不上 → 路由落 path-B、求解器无数据可投影。单类型 fillData 无法重构 solver 级一致世界；故先探测
    // "世界全空"，是则经 datacore 真合成正门**一次性 provision 确定性一致起步世界**（FK 一致·R6·SYNTHETIC
    // 可溯·datacore 据租户配置定 industry 故零行业常数 R14·仅入空租户不 clobber 真数据）。world ready 后
    // 槽位可填→确定性绑定→path-A→求解器真投影→重验 dataOk→GOVERNED。任一可自动补缺口（含 EMPTY_DATA/
    // RENDER_NOT_PROJECTED/路由类）首轮先过此门。
    if (gap.gapCode === "EMPTY_DATA" || gap.gapCode === "NO_INTENT" || gap.gapCode === "OTHER") {
      const types = await deps.dataCore.ontology.listObjectTypes(a).catch(() => [] as { instanceCount: number }[]);
      const worldEmpty = types.length === 0 || types.every((t) => (t.instanceCount ?? 0) === 0);
      if (worldEmpty) {
        const prov: { provisioned: boolean; reason?: string; industry?: string; objectCount?: number } =
          await deps.dataCore.ontology.provisionWorld(a, { scale: "S", seed: 42 }).catch((e) => ({ provisioned: false, reason: (e as Error).message }));
        if (prov.provisioned) {
          result = { gapCode: gap.gapCode, action: `空租户自动 provision 确定性合成起步世界（真合成正门·SYNTHETIC·${prov.industry ?? "?"}·${prov.objectCount ?? 0} 对象）`, advanced: true, fillMode: "SOFT" };
          await emitDomainEvent(a.tenantId, "growth.fill_proposed", { gapCode: gap.gapCode, advanced: true, fillMode: "SOFT", provisioned: prov.objectCount ?? 0 });
          return result;
        }
        // 非空租户/拒绝 → 落既有分流（HARD 真人正门 / 单类型 SOFT / 骨架工单），不静默。
      }
    }
    if (gap.gapCode === "EMPTY_DATA") {
      // DF.9 真人正门 HARD/SOFT 分流：缺真实业务实体 → HARD（出 DataRequest，不静默合成）；否则 SOFT 合成 PROVISIONAL。
      const ctxText = [
        ...(body.context.selectedObjects ?? []).map((o) => o.objectId),
        ...Object.values(body.context.filters ?? {}).map((v) => String(v)),
      ].join(" ");
      const typeKey = body.context.selectedObjects?.[0]?.objectType || body.context.view || "Object";
      const decision = decideDataGap(body.query, ctxText, groundingVocab(), { typeKey });
      if (decision.mode === "HARD") {
        result = {
          gapCode: gap.gapCode,
          action: `HARD 缺真实业务数据（${decision.entities.join("、")}）→ 真人正门导入，不静默合成`,
          advanced: false,
          fillMode: "HARD",
          dataRequest: decision.dataRequest!,
          ticket: { gapCode: gap.gapCode, detail: decision.dataRequest!.reason },
        };
      } else {
        try {
          await deps.dataCore.ontology.fillData(a, { typeKey, fields: ["id", "name", "value"], rows: 6, seed: 42 });
          result = { gapCode: gap.gapCode, action: "SOFT 缺数据 → 经管线确定性合成 PROVISIONAL(fill-data)", advanced: true, fillMode: "SOFT" };
        } catch {
          result = { gapCode: gap.gapCode, action: "fill-data 失败", advanced: false, fillMode: "SOFT", ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
        }
      }
    } else if (SCAFFOLDABLE.has(gap.gapCode)) {
      if (!scaffoldedByGap.has(gap.gapCode)) {
        const planKey = `plan_growth_${questionSlug(body.query)}`;
        const drafts = await scaffoldDraftPlan(deps, a.tenantId, planKey);
        scaffoldedByGap.set(gap.gapCode, drafts);
        result = drafts.length > 0
          ? { gapCode: gap.gapCode, action: `自动 scaffold DRAFT 执行计划 ${planKey}（绑 generic_inference 兜底）→ 待审批发布`, advanced: true, scaffolded: drafts }
          : { gapCode: gap.gapCode, action: "执行计划骨架已存在（DRAFT，待审批发布）", advanced: false, ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
      } else {
        result = { gapCode: gap.gapCode, action: "DRAFT 骨架已就绪，待审批发布/补全参数", advanced: false, ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
      }
    } else {
      result = { gapCode: gap.gapCode, action: `${FILL[gap.gapCode]}（当前不可自动补→骨架工单）`, advanced: false, ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
    }
    await emitDomainEvent(a.tenantId, "growth.fill_proposed", { gapCode: gap.gapCode, advanced: result.advanced, scaffolded: result.scaffolded?.length ?? 0, ...(result.fillMode ? { fillMode: result.fillMode } : {}) });
    return result;
  };

  return { probe, fill, scaffoldedByGap };
}
