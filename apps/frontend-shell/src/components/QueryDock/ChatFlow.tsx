import { Fragment, memo, type ComponentType, type ReactNode } from "react";
import { Markdown, renderInline } from "@/components/ui/markdown";
import { ProvMark } from "@/components/Provenance/ProvTrigger";
import { REF_RE } from "@/components/Answer/refToken";
import type { AssistantBlock, ChatNode } from "@/sse/chatFlowProjection";
import { ThinkRow } from "./ThinkRow";
import { ToolCallTree, type ToolViewProps } from "./ToolCallTree";

/**
 * ChatFlow —— 按 anchorSeq 排序的流式渲染骨架（投影已在 selectChatFlow 排好序，
 * 本组件按给定序直渲；流式尾经 memo 隔离）。
 *
 * 诚实层预留点：
 *  - text 块统一走 Markdown 包装，⟦ref:N⟧ 与 AnswerBlocks 同源（./Answer/refToken REF_RE）；
 *    提供 provenance 时渲染 ProvMark（点击行为与 Answer 页 ProvTrigger 一致），
 *    未提供时只出只读角标（不造假点击）；
 *  - honesty.scope 经徽章槽上屏（renderScopeBadge 可换绑；缺 honesty 的节点整格不出）；
 *  - agent_degraded 伪步 → notice 节点，文案 = reason 原值逐字；
 *  - compaction 行先出中止/失败态（成功回执无黄金夹具，按 README 规格留骨架）。
 */

export interface ChatFlowProps {
  nodes: ChatNode[];
  /** toolName → 卡片注册表（renderSlot('tool.call.toolview') 的我方换绑） */
  toolViews?: Record<string, ComponentType<ToolViewProps>>;
  /** ⟦ref:N⟧ 溯源上下文；缺省则角标只读 */
  provenance?: { taskId: string; provIndex: (provId: string) => number };
  /** ScopeHonestyBadge 徽章槽（缺省用内置简徽章直出 scope 原文） */
  renderScopeBadge?: (scope: string) => ReactNode;
  openFile?: (path: string) => void;
  inspectCall?: (callId: string) => void;
}

/** text 块：markdown + ⟦ref:provId⟧ 上标角标（inlineWithRefs 与 AnswerBlocks.TextBlock 同款结构） */
function ChatTextBlock({
  text,
  provenance,
}: {
  text: string;
  provenance?: { taskId: string; provIndex: (provId: string) => number };
}) {
  const inlineWithRefs = (line: string, key: string): ReactNode => {
    const parts: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(line)) !== null) {
      if (m.index > last) parts.push(<Fragment key={`${key}t${i}`}>{renderInline(line.slice(last, m.index), `${key}t${i}`)}</Fragment>);
      const provId = m[1]!;
      parts.push(
        provenance !== undefined ? (
          <ProvMark key={`${key}r${i}`} provId={provId} taskId={provenance.taskId} index={provenance.provIndex(provId)} />
        ) : (
          <sup key={`${key}r${i}`} data-testid={`chat-ref-${provId}`}>
            [{provId}]
          </sup>
        ),
      );
      last = m.index + m[0].length;
      i++;
    }
    if (last < line.length) parts.push(<Fragment key={`${key}tail`}>{renderInline(line.slice(last), `${key}tail`)}</Fragment>);
    return <>{parts}</>;
  };
  return (
    <div data-testid="chat-text-block">
      <Markdown source={text} inlineRender={inlineWithRefs} />
    </div>
  );
}

/** assistant 节点（流式尾隔离 memo：settled 兄弟节点不随尾帧重渲） */
const AssistantNodeView = memo(function AssistantNodeView({
  node,
  provenance,
  renderScopeBadge,
}: {
  node: Extract<ChatNode, { kind: "assistant" }>;
  provenance?: ChatFlowProps["provenance"];
  renderScopeBadge?: (scope: string) => ReactNode;
}) {
  const { data } = node;
  const scope = data.honesty?.scope;
  return (
    <div data-testid={`chat-assistant-${data.turn}-${data.step}`} data-status={data.status} style={{ margin: "6px 0" }}>
      {data.blocks.map((block: AssistantBlock, index: number) => {
        const key = `${node.key}:b${index}`;
        if (block.kind === "reasoning") {
          const running = data.status === "running" && index === data.blocks.length - 1;
          return <ThinkRow key={key} text={block.text} running={running} />;
        }
        if (block.kind === "text") {
          return <ChatTextBlock key={key} text={block.text} provenance={provenance} />;
        }
        // tool-call 块由工具树节点承载（call/result 配对权威在投影），此处不重复渲染
        return null;
      })}
      {data.status === "interrupted" && (
        <span data-testid="chat-interrupted" className="badge amber" style={{ fontSize: 10.5 }}>
          已中断
        </span>
      )}
      {scope !== undefined &&
        (renderScopeBadge !== undefined ? (
          renderScopeBadge(scope)
        ) : (
          <span data-testid={`scope-badge-${data.turn}-${data.step}`} className="badge amber" style={{ fontSize: 10.5 }}>
            {scope}
          </span>
        ))}
    </div>
  );
});

/** compaction 生命周期行：中止/失败态直出 error 原值，成功态按 README 规格 */
function CompactionRow({ node }: { node: Extract<ChatNode, { kind: "compaction" }> }) {
  const { data } = node;
  return (
    <div data-testid="chat-compaction" data-phase={data.phase} className="mono" style={{ fontSize: 11, color: "var(--muted2)", margin: "4px 0" }}>
      {data.phase === "running" && <span>正在压缩上下文…</span>}
      {data.phase === "done" && <span>上下文已压缩</span>}
      {data.phase === "error" && (
        <span>
          上下文压缩中止{data.errorText !== undefined ? `：${data.errorText}` : ""}
          {data.commandDoneText !== undefined ? `（/compact：${data.commandDoneText}）` : ""}
        </span>
      )}
    </div>
  );
}

export function ChatFlow({ nodes, toolViews, provenance, renderScopeBadge, openFile, inspectCall }: ChatFlowProps) {
  return (
    <div data-testid="chat-flow">
      {nodes.map((node) => {
        switch (node.kind) {
          case "user":
            return (
              <div key={node.key} data-testid="chat-user" style={{ margin: "6px 0", fontSize: 13 }}>
                {node.text}
              </div>
            );
          case "assistant":
            return <AssistantNodeView key={node.key} node={node} provenance={provenance} renderScopeBadge={renderScopeBadge} />;
          case "tool-call":
            return (
              <ToolCallTree
                key={node.key}
                root={node.root}
                toolViews={toolViews}
                openFile={openFile}
                inspectCall={inspectCall}
                badgeSlot={undefined}
              />
            );
          case "notice":
            return (
              <div key={node.key} data-testid="chat-notice" className="badge amber" style={{ margin: "4px 0", fontSize: 11 }}>
                {node.reason}
              </div>
            );
          case "compaction":
            return <CompactionRow key={node.key} node={node} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
