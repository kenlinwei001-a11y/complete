import { create } from "zustand";
import type { ObjectRef, SessionContext } from "@platform/contracts";

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
    };
  },
  reset: () => set({ ...initial }),
}));
