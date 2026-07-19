import { useNavigate } from "react-router-dom";
import { submitQuery, type ScenarioCardVM } from "@/api/endpoints";
import { safeUuid } from "@/lib/uuid";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";

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
}) => Promise<void> {
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  return async ({ query, targetView, selectedObjects = [], slotPresets = {} }) => {
    if (!packageId) return;
    const store = useSessionStore.getState();
    store.setView(targetView);
    store.setSelectedObjects(selectedObjects);
    const localId = safeUuid();
    // 每张场景卡启动 = 一段独立对话线程（清上一卡、重置 conversationId），不与别的卡混合。
    store.startConversation({ localId, query });
    store.setDockExpanded(true);
    navigate(`/v/${targetView}`);
    try {
      const res = await submitQuery(
        { packageId, query, context: { view: targetView, selectedObjects, filters: {}, presetSlots: slotPresets } },
        safeUuid(),
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
    });
}
