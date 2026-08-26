import { useNavigate } from "react-router-dom";
import { launchScenario, submitQuery, type ScenarioCardVM } from "@/api/endpoints";
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

/**
 * 场景卡启动 —— **走服务端组装**（`POST /b/v1/scenarios/:key/launch`）。
 *
 * ══ WO-BEFE-D：为什么把这条从「前端自己拼 submitQuery」改成打 launch 端点 ═════════
 *
 * 门 `befe-seam:check` 把 `POST /b/v1/scenarios/:key/launch` 报成「后端注册了、前端零调用方」。
 * 追一层才看清这不是"没接线"，是**接了线接错地方**：前端确实在启动场景，只是绕过了
 * 场景语义那一跳，直接打通用的 `/b/v1/queries`。绕过去的**不是风格，是三件后端才做得了的事**
 * （逐条对照 `apps/agentcore/src/server.ts:2750`）：
 *
 *  ① **发布态闸**：`sc.status !== "PUBLISHED"` → 409。前端拼装这条路**完全没有这道闸** ——
 *     一张 DRAFT/RETIRED 的卡照样能被启动（卡片列表默认只给 PUBLISHED，但那是列表的过滤，
 *     不是启动的校验；`includeInactive=true` 与深链接都能绕过列表）。
 *  ② **entitlement 先于 authz（R3）**：场景所属视图关闭 → 404 FEATURE_NOT_FOUND。
 *  ③ **产能可行性变体归一化**：用户在卡上改写了 query 时，后端跑
 *     `parseCapacityFeasibilityVariant()` 把「1天交付」这类自由文本解析成
 *     `{model, demandDelta, weeks, base}` 并回写 `slotPresets`，还把
 *     `_normalizedSlots` 塞进去供 R13 留痕校验。**这一整块前端没有也做不了**
 *     （解析器在 agentcore 的 `agent/sim-planner.ts`，前端跨不过去）——
 *     于是用户敲的自由文本此前拿不到归一化槽位，path-A 只能吃卡上的旧预置值。
 *
 * ⚠ `useQuickLaunch` **保持原样不动**：它服务的是「数据构建发动机一键推演」那类
 *   **没有场景卡**的启动（没有 scenarioKey 可传给 launch 端点）。把它一起改掉就是
 *   拿一条端点去顶两种不同的入参 —— 那才是真的接错地方。
 */
export function useScenarioLaunch(): (card: ScenarioCardVM, userQuery?: string) => Promise<void> {
  const navigate = useNavigate();
  return async (card: ScenarioCardVM, userQuery?: string) => {
    const canonicalView = resolveViewKey(card.presetContext.targetView) ?? card.presetContext.targetView;
    const store = useSessionStore.getState();
    // 本地会话态照旧在**发请求之前**摆好：屏上先进落点视图、先起对话线程，
    // 用户不必盯着一个没反应的按钮等网络（这一段与原实现逐字同义，只换了那一跳网络调用）。
    store.setView(canonicalView);
    store.setSelectedObjects(card.presetContext.selectedObjects);
    const localId = safeUuid();
    store.startConversation({ localId, query: userQuery?.trim() || card.triggerQuestion });
    store.setDockExpanded(true);
    navigate(`/v/${canonicalView}`);
    try {
      // 服务端按 SCENARIO_CATALOG 单源组装 presetContext + 归一化槽位 + 绑定 intentKey，
      // 前端只把「哪张卡 + 用户改写的问句」交出去。
      // ⚠ 卡片 VM 上的 `sNo` **就是** `scenarioKey`（后端 `GET /b/v1/scenarios` 那一跳
      //   逐字写着 `sNo: s.scenarioKey`）。卡上没有第二个叫 scenarioKey 的字段 —— 想当然写
      //   `card.scenarioKey` 会编译报错（2026-08-14 实测，复验：`npx tsc -p apps/frontend-shell/tsconfig.json --noEmit`
      //   报 `Property 'scenarioKey' does not exist on type 'ScenarioCardVM'`）。留此免得下一个人再撞一次。
      const res = await launchScenario(card.sNo, userQuery);
      store.updateConversation(localId, { taskId: res.taskId });
      store.setConversationId(res.taskId);
    } catch (e) {
      store.updateConversation(localId, { submitError: (e as Error).message });
      toastError(e);
    }
  };
}
