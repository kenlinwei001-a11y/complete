import { useNavigate } from "react-router-dom";
import { submitQuery, type ScenarioCardVM } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";
import { normalizeViewKey } from "@/views/registry";

/**
 * 场景启动（PRD-scenario-launcher §3.5）：点一张场景卡 → 注入 presetContext
 * （选中对象 + presetSlots）→ 提交 Query（与 CLI ask / 查询 Dock 同一 QOS 管线）→
 * 展开对话坞看 SSE。前端直接组装提交（PRD §4 二选一之一），复用既有 submitQuery + 对话流。
 */
/** 低层启动：注入 presetContext（落点视图 + 选中对象 + presetSlots）→ 提交 QOS Query → 展开对话坞。
 *  供场景卡启动（useScenarioLaunch）与数据构建发动机「一键推演」（区7）共用，避免重复编排。 */
export function useQuickLaunch(): (input: {
  query: string;
  targetView: string;
  selectedObjects?: { objectType: string; objectId: string; label?: string }[];
  slotPresets?: Record<string, unknown>;
  /** PRD-scenario-ontogenesis §2.4 确定性绑定：带场景卡声明的意图键 → 编排器跳过 LLM classify、
   *  直接绑定意图→计划（候选命中且槽位可满足时）→ 无 LLM 也能真出推演答案。 */
  scenarioIntentKey?: string;
  scenarioKey?: string;
}) => Promise<void> {
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace();
  // packageId：统一走 firstPackageId 单一提取点（VM 已归一 string；防御契约 {id,name} 对象漂移 →
  // 杜绝把对象误当 packageId 传给 QOS → 404 PACKAGE_NOT_FOUND）。见 workspace/useWorkspace.ts。
  const packageId = firstPackageId(workspace);
  return async ({ query, targetView, selectedObjects = [], slotPresets = {}, scenarioIntentKey, scenarioKey }) => {
    if (!packageId) return;
    // 命门修复（BLOCK 根因③）：落点导航用规范视图键（短键 project→project-sim），否则 ViewPage 在 workspace.views
    // 按短键找不到视图 → ForbiddenPage（真启动器点卡落 /v/project 空白·视图不渲染）。scenarioPreset 保留原 targetView（读侧归一）。
    const canonicalView = normalizeViewKey(targetView) ?? targetView;
    const store = useSessionStore.getState();
    store.setView(canonicalView);
    store.setSelectedObjects(selectedObjects);
    // WO-SIM-PRESET-INJECT（命门·C4 单一通道）：slotPresets 除了随 submitQuery 进 QOS 对话坞，
    // 同时落 scenarioPreset → 落点推演视图 useScenarioPreset 读之注入求解器入参初值（问句与视图对口·R17·治 G-3）。
    // nonce 保证每次点卡只消费一次（导航后视图 useEffect 按 nonce 去重·不重复注入）。
    store.setScenarioPreset(
      Object.keys(slotPresets).length > 0 ? { targetView, slotPresets, label: query, nonce: crypto.randomUUID() } : null,
    );
    const localId = crypto.randomUUID();
    // 每张场景卡启动 = 一段独立对话线程（清上一卡、重置 conversationId），不与别的卡混合。
    store.startConversation({ localId, query });
    store.setDockExpanded(true);
    navigate(`/v/${canonicalView}`);
    try {
      const res = await submitQuery(
        { packageId, query, context: { view: targetView, selectedObjects, filters: {}, presetSlots: slotPresets, ...(scenarioIntentKey ? { scenarioIntentKey } : {}), ...(scenarioKey ? { scenarioKey } : {}) } },
        crypto.randomUUID(),
      );
      store.updateConversation(localId, { taskId: res.taskId });
      store.setConversationId(res.taskId);
    } catch (e) {
      store.updateConversation(localId, { submitError: (e as Error).message });
      toastError(e);
    }
  };
}

export function useScenarioLaunch(): (card: ScenarioCardVM) => Promise<void> {
  const quickLaunch = useQuickLaunch();
  return async (card: ScenarioCardVM) =>
    quickLaunch({
      query: card.triggerQuestion,
      targetView: card.presetContext.targetView,
      selectedObjects: card.presetContext.selectedObjects,
      slotPresets: card.presetContext.slotPresets,
      // §2.4 确定性绑定：卡声明的意图键随查询搭车 → 编排器跳过 LLM classify 直接绑定（点卡必出真推演答案，不受 classifier 死活影响）。
      scenarioIntentKey: card.intentKey,
      // ONTO-SCEN-LAUNCH-DET §2.5（接缝修复）：卡键也随行——编排器据此识别 GOVERNED 卡（确定性守底）、
      // O10 注入卡规则、不可答时走场景缺口处置（发育卡+工单+通知）。此前 UI 点卡缺此键 → 整条缺口链失联。
      scenarioKey: card.sNo,
    });
}
