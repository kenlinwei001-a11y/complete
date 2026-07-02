import { create } from "zustand";
import type { ObjectRef, SessionContext } from "@platform/contracts";

export interface ConversationEntry {
  localId: string;
  query: string;
  taskId?: string;
  submitError?: string;
}

/**
 * WO-SIM-PRESET-INJECT（命门·G-3 视图侧注入单一通道·C4）：场景启动器点卡 → useQuickLaunch 除了把
 * slotPresets 送进 QOS query context（对话坞），**同时**落此 scenarioPreset → 落点推演视图经 `useScenarioPreset`
 * 读之，把型号/需求/时窗/现金垫等 slot 注入求解器入参初值（问句与视图对口·R17）。单一通道（非 URL·跨 4 视图统一），
 * nonce 保证每次点卡只消费一次（导航后不重复注入）。此前 slotPresets 只进 Dock → 视图用 models[0]×40万 → G-3 未治。
 */
export interface ScenarioPreset {
  targetView: string;
  slotPresets: Record<string, unknown>;
  label?: string;
  nonce: string;
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
  // WO-SIM-PRESET-INJECT：场景启动器带入的推演视图入参预设（单一通道·C4）。
  scenarioPreset: ScenarioPreset | null;

  setView: (view: string) => void;
  setSelectedObjects: (objs: ObjectRef[]) => void;
  toggleSelectedObject: (obj: ObjectRef) => void;
  setFilters: (filters: Record<string, string | string[]>) => void;
  setTimeWindow: (tw?: { from: string; to: string }) => void;
  setConversationId: (id: string) => void;
  setDockExpanded: (v: boolean) => void;
  /** 场景启动器落 scenarioPreset（供落点视图 useScenarioPreset 读入参初值·C4 单一通道）。 */
  setScenarioPreset: (p: ScenarioPreset | null) => void;
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
  scenarioPreset: null as ScenarioPreset | null,
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
  setScenarioPreset: (scenarioPreset) => set({ scenarioPreset }),
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
