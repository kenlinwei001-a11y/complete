import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/store/sessionStore";

/**
 * F55 · 场景启动器每张卡的对话独立、不混合（修：此前所有卡 append 进同一对话线程、
 * conversationId 只设一次永不换 → 多张卡的对话混在一起）。
 *
 * 故事脚本（~100 字）：管理员先点"订单可承接性"卡问了一句，再点另一张"产能推演"卡。两张卡的对话
 * 应各自独立——点第二张卡时，对话坞里只剩第二张卡的这段，不该还混着第一张卡的历史；conversationId
 * 也重置为新线程，避免后端把两段当同一会话续接。
 */
describe("F55 · 场景卡对话独立不混合", () => {
  beforeEach(() => useSessionStore.getState().reset());

  it("点第二张卡 → 清空第一张卡的对话，开新线程（conversationId 重置）", () => {
    const s = useSessionStore.getState();
    // 第一张卡启动
    s.startConversation({ localId: "a", query: "常州停产影响哪些订单" });
    s.setConversationId("task-1");
    expect(useSessionStore.getState().conversation.map((c) => c.query)).toEqual(["常州停产影响哪些订单"]);
    expect(useSessionStore.getState().conversationId).toBe("task-1");

    // 第二张卡启动 —— 独立线程
    s.startConversation({ localId: "b", query: "4680 加 20% 六周能不能接" });
    const st = useSessionStore.getState();
    expect(st.conversation.map((c) => c.query)).toEqual(["4680 加 20% 六周能不能接"]); // 只剩第二张，不混第一张
    expect(st.conversation.some((c) => c.query.includes("常州"))).toBe(false);
    expect(st.conversationId).toBeUndefined(); // 重置；待新 task 回来再 set

    // 模拟新 task 回填 → 成为新线程 id
    s.setConversationId("task-2");
    expect(useSessionStore.getState().conversationId).toBe("task-2");
  });

  it("同一卡内追问仍 append（线程内续接，不被独立化破坏）", () => {
    const s = useSessionStore.getState();
    s.startConversation({ localId: "a", query: "本月产销缺口多大" });
    s.appendConversation({ localId: "a2", query: "那加夜班能补齐吗" }); // dock 内追问
    expect(useSessionStore.getState().conversation.map((c) => c.query)).toEqual(["本月产销缺口多大", "那加夜班能补齐吗"]);
  });
});
