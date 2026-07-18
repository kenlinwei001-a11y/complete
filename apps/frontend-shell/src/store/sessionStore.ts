import { create } from "zustand";
import type { ObjectRef, SessionContext, PageContext, PageEntity } from "@platform/contracts";

export interface ConversationEntry {
  localId: string;
  query: string;
  taskId?: string;
  submitError?: string;
}

interface SessionState {
  view: string;
  selectedObjects: ObjectRef[];
  filters: Record<string, string | string[]>;
  timeWindow?: { from: string; to: string };
  conversationId?: string;
  // 查询 Dock UI 态
  dockExpanded: boolean;
  conversation: ConversationEntry[];

  setView: (view: string) => void;
  setSelectedObjects: (objs: ObjectRef[]) => void;
  toggleSelectedObject: (obj: ObjectRef) => void;
  setFilters: (filters: Record<string, string | string[]>) => void;
  setTimeWindow: (tw?: { from: string; to: string }) => void;
  setConversationId: (id: string) => void;
  setDockExpanded: (v: boolean) => void;
  /** 开一段全新对话线程（场景卡启动用）：清空上一卡的对话 + 重置 conversationId，保证每张卡独立不混合。 */
  startConversation: (e: ConversationEntry) => void;
  appendConversation: (e: ConversationEntry) => void;
  updateConversation: (localId: string, patch: Partial<ConversationEntry>) => void;
  buildContext: () => SessionContext;
  reset: () => void;
}

/** filters 里取字符串值（列筛选可能是 string 或 string[]，只有单值 string 才当聚焦标量用·诚实不猜多值）。 */
function scalarFilter(filters: Record<string, string | string[]>, key: string): string | undefined {
  const v = filters[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * WO-CEO-6-FE（闭 G-3）：从**现有 SessionContext 状态**诚实派生 PageContext（合 `PageContextSchema`）。
 * 不新建视图管道、不伪造：focus 只填能派生的（filters 单值 + 选中对象类型映射）；entities/selection 来自
 * selectedObjects；drillPath 当前 store 无面包屑态 → 不产（绝不伪造·schema default []）。
 * 注入后 orchestrator `hasPageContext` 门打开 → CEO 深问意图进候选并按 focus/selection 派生 args。
 */
function derivePageContext(s: {
  view: string;
  selectedObjects: ObjectRef[];
  filters: Record<string, string | string[]>;
}): PageContext {
  const entities: PageEntity[] = s.selectedObjects.map((o) => ({
    type: o.objectType,
    id: o.objectId,
    label: o.label ?? o.objectId,
    drillRef: o.objectId, // 反向驱动引用 = 源对象 id（前端可定位·非写死）
  }));
  const selection = s.selectedObjects.map((o) => o.objectId);

  // focus 诚实派生：优先 filters 单值，其次由选中对象类型映射（Base→base / Metric→metric / 根因类→factorId）。
  const byType = (t: string) => s.selectedObjects.find((o) => o.objectType === t)?.objectId;
  const focus: NonNullable<PageContext["focus"]> = {};
  const metric = scalarFilter(s.filters, "metric") ?? byType("Metric");
  const base = scalarFilter(s.filters, "base") ?? byType("Base");
  const line = scalarFilter(s.filters, "line") ?? byType("Line");
  const factorId =
    scalarFilter(s.filters, "factorId") ?? byType("RootCause") ?? byType("GapAttribution") ?? byType("Factor");
  if (metric) focus.metric = metric;
  if (base) focus.base = base;
  if (line) focus.line = line;
  if (factorId) focus.factorId = factorId;

  const pageContext: PageContext = { view: s.view, entities, selection, drillPath: [], actions: [] };
  if (Object.keys(focus).length > 0) pageContext.focus = focus;
  return pageContext;
}

const initial = {
  view: "",
  selectedObjects: [] as ObjectRef[],
  filters: {} as Record<string, string | string[]>,
  timeWindow: undefined as { from: string; to: string } | undefined,
  conversationId: undefined as string | undefined,
  dockExpanded: false,
  conversation: [] as ConversationEntry[],
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initial,
  setView: (view) => set({ view }),
  setSelectedObjects: (selectedObjects) => set({ selectedObjects: selectedObjects.slice(0, 10) }),
  toggleSelectedObject: (obj) =>
    set((s) => {
      const exists = s.selectedObjects.some(
        (o) => o.objectType === obj.objectType && o.objectId === obj.objectId,
      );
      return {
        selectedObjects: exists
          ? s.selectedObjects.filter((o) => !(o.objectType === obj.objectType && o.objectId === obj.objectId))
          : [...s.selectedObjects, obj].slice(0, 10),
      };
    }),
  setFilters: (filters) => set({ filters }),
  setTimeWindow: (timeWindow) => set({ timeWindow }),
  setConversationId: (conversationId) => set({ conversationId }),
  setDockExpanded: (dockExpanded) => set({ dockExpanded }),
  startConversation: (e) => set({ conversation: [e], conversationId: undefined }),
  appendConversation: (e) => set((s) => ({ conversation: [...s.conversation, e] })),
  updateConversation: (localId, patch) =>
    set((s) => ({
      conversation: s.conversation.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    })),
  /** SessionContext 组装规则（PRD §6.2，不可变更） */
  buildContext: () => {
    const s = get();
    return {
      view: s.view,
      selectedObjects: s.selectedObjects,
      filters: s.filters,
      timeWindow: s.timeWindow,
      conversationId: s.conversationId,
      // WO-CEO-6-FE：随查询搭车注入 PageContext（闭 G-3）——orchestrator 据此开 hasPageContext 门。
      pageContext: derivePageContext(s),
    };
  },
  reset: () => set({ ...initial }),
}));
