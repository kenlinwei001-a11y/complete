import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScene, submitQuery } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { TaskRun } from "./TaskRun";
import styles from "./QueryDock.module.css";

/**
 * 查询 Dock（PRD §6.1/§6.2）：收起=单行输入框；展开=720px 右侧滑出对话面板。
 * 提交：组装 SessionContext → POST /b/v1/queries（Idempotency-Key）→ useTaskStream。
 */
export function QueryDock() {
  const { data: workspace } = useWorkspace();
  const view = useSessionStore((s) => s.view);
  const expanded = useSessionStore((s) => s.dockExpanded);
  const setExpanded = useSessionStore((s) => s.setDockExpanded);
  const conversation = useSessionStore((s) => s.conversation);
  const selectedObjects = useSessionStore((s) => s.selectedObjects);
  const [input, setInput] = useState("");

  const { data: scene } = useQuery({
    queryKey: ["b", "scene", { view }],
    queryFn: () => fetchScene(view),
    enabled: view !== "",
  });

  const packageId = workspace?.scenarioPackages[0] ?? "";

  const submit = async (q: string) => {
    const text = q.trim();
    if (!text || !packageId) return;
    const store = useSessionStore.getState();
    const localId = crypto.randomUUID();
    store.appendConversation({ localId, query: text });
    setExpanded(true);
    setInput("");
    try {
      const context = store.buildContext();
      const res = await submitQuery({ packageId, query: text, context }, crypto.randomUUID());
      store.updateConversation(localId, { taskId: res.taskId });
      if (!store.conversationId && context.conversationId == null) {
        // 同一会话多次提问 conversationId 保持
        store.setConversationId(res.taskId);
      }
    } catch (e) {
      store.updateConversation(localId, { submitError: (e as Error).message });
      toastError(e);
    }
  };

  const placeholder = scene?.uiHints.placeholder ?? zh.dock.placeholder;
  const suggestions = scene?.uiHints.suggestedQuestions ?? [];

  return (
    <>
      {/* 收起态：底部单行输入 */}
      {!expanded && (
        <div className={styles.bar} data-testid="query-dock-bar">
          <input
            type="text"
            value={input}
            placeholder={placeholder}
            aria-label="查询输入"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit(input);
            }}
          />
          <button className="btn sm" onClick={() => setExpanded(true)} aria-label={zh.dock.expand}>
            ⌃
          </button>
        </div>
      )}

      {/* 展开态：右侧滑出对话面板 */}
      {expanded && (
        <div className={styles.panel} data-testid="query-dock-panel" role="complementary" aria-label="查询对话">
          <div className={styles.panelHead}>
            <span style={{ fontWeight: 600 }}>查询对话</span>
            {selectedObjects.length > 0 && (
              <span className={styles.ctxChips}>
                {selectedObjects.map((o) => (
                  <span key={`${o.objectType}:${o.objectId}`} className="badge blue">
                    {o.label ?? o.objectId}
                  </span>
                ))}
              </span>
            )}
            <button className={styles.collapseBtn} onClick={() => setExpanded(false)} aria-label={zh.dock.collapse}>
              ✕
            </button>
          </div>
          <div className={styles.panelBody}>
            {conversation.length === 0 && suggestions.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.map((s) => (
                  <button key={s} className={styles.chip} onClick={() => void submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {conversation.map((entry) => (
              <div key={entry.localId} className={styles.turn}>
                <div className={styles.userMsg}>{entry.query}</div>
                {entry.taskId && <TaskRun taskId={entry.taskId} />}
                {entry.submitError && <div className="badge red">{entry.submitError}</div>}
              </div>
            ))}
          </div>
          <div className={styles.panelInput}>
            <input
              type="text"
              value={input}
              placeholder={placeholder}
              aria-label="查询输入"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit(input);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
