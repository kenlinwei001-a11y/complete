import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { safeUuid } from "@/lib/uuid";
import { fetchScene, fetchScenarioCards, submitQuery } from "@/api/endpoints";
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
  const activeBlock = useSessionStore((s) => s.activeBlock);
  const clearActiveBlock = useSessionStore((s) => s.clearActiveBlock);
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
  const pageSuggestions = [...new Set([...verified, ...(scene?.uiHints.suggestedQuestions ?? [])])];
  // 修（块对话·建议问句串页·你报"不是与供需相关的问题"）：锚定某块时起手问句应**关于本块**（非页面级泛问）。
  // 无锚定块 → 页面级（C5 退化不变）。问句锚 blockTitle·submit 时 buildContext 仍把该块真数据推 agent。
  const suggestions = activeBlock
    ? [
        `「${activeBlock.blockTitle}」这个结果是怎么来的？帮我拆解`,
        `针对「${activeBlock.blockTitle}」有哪些可行的改善动作？`,
        `「${activeBlock.blockTitle}」的主要驱动因素 / 占比是什么？`,
      ]
    : pageSuggestions;

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
            {/* WO-BLOCK-DIALOGUE 修（Bug·块对话串页）：锚定某块时，对话头显示**该块**（标题 + 真实渲染数据快照），
                并抑制页面级预载历史，避免展示"其他页面的信息"。无锚定块 → 页面级不变（C5 退化）。 */}
            {activeBlock && (
              <div data-testid="dock-block-anchor" style={{ margin: "0 0 12px", padding: "9px 11px", border: "1px solid var(--accent)", borderRadius: 8, background: "rgba(76,144,240,.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <span>💬 已锚定此块：<b>{activeBlock.blockTitle}</b></span>
                  <button className="btn sm" style={{ marginLeft: "auto" }} onClick={clearActiveBlock} title="取消锚定，回到页面级提问" data-testid="dock-block-clear">回页面级</button>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted2)", marginBottom: 7 }}>本块下列真实数据已随提问推给 AI，答案将针对此块作答：</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(activeBlock.blockData).slice(0, 8).map(([k, v]) => (
                    <span key={k} className="badge blue" style={{ fontSize: 10.5 }} data-testid={`dock-block-field-${k}`}>
                      <span style={{ opacity: 0.65 }}>{k}:</span>{" "}
                      {typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 48) : String(v).slice(0, 48)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 运营态出厂配置增量 §4.4：按场景预载历史问答。锚定块时抑制（避免串到其他页面历史）。 */}
            {!activeBlock && (scene?.preloadedHistory?.length ?? 0) > 0 && (
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
