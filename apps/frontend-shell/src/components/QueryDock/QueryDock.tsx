import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScene, fetchScenarioCards, submitQuery } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";
import { safeUuid } from "@/lib/uuid"; // P0 crypto 修复·嫁接自 integ-wave-10
import zh from "@/locales/zh";
import { env } from "@/env";
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
  // suggestedQuestions 命中校验（admin-console-closure §5-②）：本视图已发布场景的触发问句
  // 经引用闭合验证（intent→plan 全配置好），优先作为建议问句 → 点了必命中、不落死路。
  const { data: cards } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards(), enabled: expanded });

  const packageId = workspace?.scenarioPackages[0] ?? "";

  const submit = async (q: string) => {
    const text = q.trim();
    if (!text || !packageId) return;
    const store = useSessionStore.getState();
    const localId = safeUuid();
    store.appendConversation({ localId, query: text });
    setExpanded(true);
    setInput("");
    try {
      const context = store.buildContext();
      const res = await submitQuery({ packageId, query: text, context }, safeUuid());
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
  // 已验证场景触发问句（本视图）优先 + 场景入口自由建议问句兜底，去重。
  const verified = (cards?.items ?? []).filter((c) => c.view === view).map((c) => c.triggerQuestion);
  const suggestions = [...new Set([...verified, ...(scene?.uiHints.suggestedQuestions ?? [])])];

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
            {/* 假·脚本对话诚实化（KILL-MOCK-RED·AUDIT 2026-07-24）：VITE_MOCK 态答案为脚本样例（含演示 provenance），
                非真实 QOS 求解——诚实横幅披露，避免用户把 mock 演示当真实数据。部署态（真后端）走真 orchestrator 求解器。 */}
            {env.mock && (
              <div
                data-testid="dock-mock-note"
                style={{ fontSize: 11, lineHeight: 1.5, padding: "6px 10px", margin: "0 0 8px", borderRadius: 6, background: "rgba(232,181,74,.12)", border: "1px solid rgba(232,181,74,.35)", color: "var(--amber, #E8B54A)" }}
              >
                ⓘ 演示模式（VITE_MOCK）· 本对话回答为<b>脚本样例</b>，非真实 QOS 求解 / 真实数据（含演示用 provenance）。连真后端部署态走真 orchestrator 求解器。
              </div>
            )}
            {/* 运营态出厂配置增量 §4.4：按场景预载历史问答（半透明 + 日期 + 信任级徽章 + 分隔线） */}
            {(scene?.preloadedHistory?.length ?? 0) > 0 && (
              <div className={styles.history} data-testid="dock-history">
                {scene!.preloadedHistory!.map((h, i) => (
                  <div key={i} className={styles.historyTurn} data-testid={`dock-history-${i}`}>
                    <div className={styles.userMsg}>
                      {h.question}
                      <span className={styles.historyDate}>{h.date}</span>
                    </div>
                    <div className={styles.historyAnswer}>
                      {h.trustLevel === "VERIFIED_WORKFLOW" ? (
                        <span className="badge green" data-testid={`dock-history-trust-${i}`} data-trust="VERIFIED_WORKFLOW">
                          {zh.dock.verifiedBadge}
                        </span>
                      ) : (
                        <span className="badge amber" data-testid={`dock-history-trust-${i}`} data-trust="AGENT_EXPLORATORY">
                          {zh.dock.exploratoryBadge}
                        </span>
                      )}
                      <div className="zh">{h.answer}</div>
                    </div>
                  </div>
                ))}
                <div className={styles.historyDivider} data-testid="dock-history-divider">
                  以上为历史问答
                </div>
              </div>
            )}
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
                {entry.taskId && <TaskRun taskId={entry.taskId} onRetry={() => void submit(entry.query)} />}
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
