import type {
  GapCode,
  GapFinding,
  GapReport,
  GrowthFillResult,
  ScaffoldDraft,
  SubmitQueryBody,
  WorklistItem,
  WorklistFillPlan,
} from "@platform/contracts";
import type { AppDeps } from "../deps.js";
import type { RequestAuth } from "../auth.js";
import { classifyGap, FILL } from "./probe.js";
import { scaffoldDraftPlan, questionSlug } from "./scaffold.js";
import { decideDataGap, groundingVocab } from "./data-boundary.js";
import { newId } from "../ids.js";

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

/**
 * GROWTH-WORKLIST-HUMAN-FILL · registerWorklist：`/api/v1/growth/run` 驾驶舱 LOOP 传 true → SOFT fillData 与
 * 空租户 provisionWorld **不再自动跑**，改登记为在办项(WorklistItem·OPEN·DATA_GAP)，该轮终态 NEEDS_HUMAN；
 * 人在看板认领后点「补数据缺口」才真跑（R6 seed 确定性）。growScenario(O9) 不传 → 保持既有自动发育行为（另有诚实门定级）。
 */
export function buildGrowthLoopWiring(
  deps: AppDeps,
  a: RequestAuth,
  body: SubmitQueryBody,
  emitDomainEvent: (tenantId: string, event: string, payload?: Record<string, unknown>) => Promise<void>,
  opts: { registerWorklist?: boolean } = {},
): GrowthLoopWiring {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const scaffoldedByGap = new Map<GapCode, ScaffoldDraft[]>();

  // 把「可补项」登记为在办看板一行（不自动补）——R2 带 tenantId。返回 needsHuman 结果，LOOP 该轮落 NEEDS_HUMAN。
  const registerDataGap = async (
    gap: GapFinding,
    fillPlan: WorklistFillPlan,
    action: string,
  ): Promise<GrowthFillResult> => {
    const nowIso = new Date().toISOString();
    const item: WorklistItem = {
      id: newId("wli"),
      tenantId: a.tenantId,
      fromQuestion: body.query,
      gapCode: gap.gapCode,
      kind: "DATA_GAP",
      status: "OPEN",
      fillPlan,
      evidence: gap.evidence,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await deps.repos.growthWorklist.upsert(item);
    await emitDomainEvent(a.tenantId, "growth.fill_proposed", { gapCode: gap.gapCode, advanced: false, needsHuman: true, worklistItemId: item.id, fillMode: fillPlan.mode });
    return { gapCode: gap.gapCode, action, advanced: false, needsHuman: true, worklistItemId: item.id, fillMode: fillPlan.mode };
  };

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
      if (worldEmpty && opts.registerWorklist) {
        // 空租户 provisionWorld **不自动跑** → 登记在办项，待人工认领点触发（R6 seed=42 触发时确定性一致）。
        return registerDataGap(
          gap,
          { mode: "SOFT", action: "provisionWorld", scale: "S", seed: 42 },
          "空租户缺起步世界 → 登记在办项（认领后点「补数据缺口」才真跑 provisionWorld·确定性合成起步世界）",
        );
      }
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
      // GAP-ACTIONABLE（PRD §3.4 · P3 修）：**视图键 ≠ 对象类型**。旧代码 `objectType || view || "Object"`
      // 把视图键（如 "dash"）当对象类型泄漏进工单/DataRequest.typeKey。仅取**显式声明的对象类型**
      // （selectedObjects[0].objectType）；缺失时诚实回落通用占位 "Object"，绝不把 view 键冒充对象类型。
      const explicitObjectType = body.context.selectedObjects?.[0]?.objectType;
      const typeKey = explicitObjectType || "Object";
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
      } else if (opts.registerWorklist) {
        // SOFT 缺数据 **不自动跑** fillData → 登记在办项，待人工认领点触发（R6 seed=42 触发时确定性合成 PROVISIONAL）。
        return registerDataGap(
          gap,
          { mode: "SOFT", action: "fillData", typeKey, fields: ["id", "name", "value"], rows: 6, seed: 42 },
          `SOFT 缺数据（${typeKey}）→ 登记在办项（认领后点「补数据缺口」才真跑 fill-data·确定性合成 PROVISIONAL）`,
        );
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
