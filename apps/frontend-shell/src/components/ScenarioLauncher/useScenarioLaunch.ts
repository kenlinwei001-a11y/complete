import { useNavigate } from "react-router-dom";
import { submitQuery, type ScenarioCardVM } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";

/**
 * 场景启动（PRD-scenario-launcher §3.5）：点一张场景卡 → 注入 presetContext
 * （选中对象 + presetSlots）→ 提交 Query（与 CLI ask / 查询 Dock 同一 QOS 管线）→
 * 展开对话坞看 SSE。前端直接组装提交（PRD §4 二选一之一），复用既有 submitQuery + 对话流。
 */
export function useScenarioLaunch(): (card: ScenarioCardVM) => Promise<void> {
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  return async (card: ScenarioCardVM) => {
    if (!packageId) return;
    const store = useSessionStore.getState();
    const view = card.presetContext.targetView;
    store.setView(view);
    store.setSelectedObjects(card.presetContext.selectedObjects);
    const localId = crypto.randomUUID();
    store.appendConversation({ localId, query: card.triggerQuestion });
    store.setDockExpanded(true);
    navigate(`/v/${view}`);
    try {
      const res = await submitQuery(
        {
          packageId,
          query: card.triggerQuestion,
          context: { view, selectedObjects: card.presetContext.selectedObjects, filters: {}, presetSlots: card.presetContext.slotPresets },
        },
        crypto.randomUUID(),
      );
      store.updateConversation(localId, { taskId: res.taskId });
      if (!store.conversationId) store.setConversationId(res.taskId);
    } catch (e) {
      store.updateConversation(localId, { submitError: (e as Error).message });
      toastError(e);
    }
  };
}
