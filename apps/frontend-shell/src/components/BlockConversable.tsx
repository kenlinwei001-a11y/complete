import { useState, type ReactNode } from "react";
import { useSessionStore, type ActiveBlock } from "@/store/sessionStore";

/**
 * WO-BLOCK-DIALOGUE（闭 G-3 块级）：把任意 block 升级为**可就地深问**——包住既有块，渲一个 hover 角标「深问此块」入口，
 * 点击 → 捕获该块**真实渲染数据**快照（getData()·非写死）→ 设 sessionStore.activeBlock（blockId/blockType/blockTitle/
 * blockData/provenance/块内 selection）→ 打开 QueryDock（块级锚定）。此后在 Dock 提问，buildContext 把 pageContext.block
 * 随查询搭车推给 agent → orchestrator 按 blockType 定向路由 + blockData 作强上下文 → 答案针对性锚定「哪页·哪块·块里有哪些信息」。
 *
 * KILL-MOCK：blockData 一律来自 getData() 返回的**该块真实渲染数据**（改块数据→推给 agent 的 blockData 变·C4）；
 * 绝不写死。无点击则不设 activeBlock（页面级退化·C5）。
 */
export interface BlockConversableProps {
  /** 块唯一标识（= data-testid·如 dash-supply-demand）。 */
  blockId: string;
  /** 块语义类型（供后端 blockType 定向路由）。 */
  blockType: string;
  /** 块标题（人读·进 agent prompt 锚定）。 */
  blockTitle: string;
  /** 取该块**真实渲染数据**的结构化快照（点击时调用·非写死）。 */
  getData: () => Record<string, unknown>;
  /** 溯源引用（可选·块数据来源求解器/对象）。 */
  provenanceRef?: string;
  /** 块内选中项 id（可选·如选中某根因叶/某方案·驱动 factorId）。 */
  getSelection?: () => string[];
  children: ReactNode;
}

export function BlockConversable({ blockId, blockType, blockTitle, getData, provenanceRef, getSelection, children }: BlockConversableProps) {
  const setActiveBlock = useSessionStore((s) => s.setActiveBlock);
  const setDockExpanded = useSessionStore((s) => s.setDockExpanded);
  const activeBlockId = useSessionStore((s) => s.activeBlock?.blockId);
  const [hover, setHover] = useState(false);
  const active = activeBlockId === blockId;

  const ask = () => {
    // 捕获该块真实渲染数据快照（getData 返真值·非写死）→ 设活跃块 → 打开 Dock（块级锚定）。
    const block: ActiveBlock = {
      blockId,
      blockType,
      blockTitle,
      blockData: getData(),
      selection: getSelection ? getSelection() : [],
      ...(provenanceRef ? { provenanceRef } : {}),
    };
    setActiveBlock(block);
    setDockExpanded(true);
  };

  return (
    <div
      data-block-conversable={blockId}
      data-block-active={active ? "1" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative" }}
    >
      {(hover || active) && (
        <button
          type="button"
          className="badge blue"
          data-testid={`block-ask-${blockId}`}
          title={`就地深问此块「${blockTitle}」——把本块真实数据推给 AI 针对性推演`}
          onClick={ask}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            zIndex: 5,
            cursor: "pointer",
            fontSize: 11,
            padding: "2px 8px",
            border: active ? "1px solid var(--accent)" : undefined,
          }}
        >
          💬 深问此块{active ? " ·已锚定" : ""}
        </button>
      )}
      {children}
    </div>
  );
}
