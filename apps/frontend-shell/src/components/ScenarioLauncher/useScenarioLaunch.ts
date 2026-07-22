import { useNavigate } from "react-router-dom";
import { submitQuery, type ScenarioCardVM } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";
import { safeUuid } from "@/lib/uuid"; // P0 crypto 修复·嫁接自 integ-wave-10
import { resolveViewKey } from "@/views/registry"; // 场景卡 targetView 可能是短键别名

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
  /** 场景卡意图（确定性绑定键）——传入即让 orchestrator 强制走 path-A 求解器（deterministic:scenario-bind·秒级·真数据），
   *  不落慢 path-B agent。这是"场景问题具象化"的落点：卡已带 intentKey+槽位，此处透传即可 <30s 流式出答。 */
  scenarioIntentKey?: string;
}) => Promise<void> {
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  return async ({ query, targetView, selectedObjects = [], slotPresets = {}, scenarioIntentKey }) => {
    if (!packageId) return;
    const canonicalView = resolveViewKey(targetView) ?? targetView;
    const store = useSessionStore.getState();
    store.setView(canonicalView);
    store.setSelectedObjects(selectedObjects);
    const localId = safeUuid();
    // 每张场景卡启动 = 一段独立对话线程（清上一卡、重置 conversationId），不与别的卡混合。
    store.startConversation({ localId, query });
    store.setDockExpanded(true);
    navigate(`/v/${canonicalView}`);
    try {
      const res = await submitQuery(
        { packageId, query, context: { view: canonicalView, selectedObjects, filters: {}, presetSlots: slotPresets, ...(scenarioIntentKey ? { scenarioIntentKey } : {}) } },
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
      scenarioIntentKey: card.intentKey, // 具象化：透传卡意图 → orchestrator 强制 path-A 秒级出答（不落慢 agent）
    });
}
