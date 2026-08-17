import { memo, useState, type ComponentType, type ReactNode } from "react";
import type { ToolBlock, ToolResultBlock } from "@/sse/chatFlowProjection";

/**
 * ToolCallTree —— 移植 dsh-client-ui-tool/lib/client.js:857-939。
 *  - renderSlot('tool.call.toolview', entryKey=toolName) 换绑为我方
 *    `toolViews: Record<toolName, FC>` 注册表 + GenericToolCard 兜底；
 *  - DOM 契约保留：data-chat-anchor-key={`call:${callId}`} + data-chat-call-id（884-885）；
 *  - openFile/inspectCall 宿主回调 → 零实现诚实缺省（不传即不出按钮，不造假链接）；
 *  - 「Runtime 仍是 call/result 配对与 subCalls 投影的权威」（README 原话）——
 *    本组件只渲染投影产物，不自己配对。
 */

export interface ToolViewProps {
  callId: string;
  toolName: string;
  block: ToolBlock;
  openFile?: (path: string) => void;
  inspect?: () => void;
}

/** callName(860-862)：两种生命周期形态取 wire 名 */
function callName(node: ToolBlock): string {
  return "kind" in node ? (node.call?.name ?? "") : node.name;
}

const resultText = (block: ToolResultBlock): string =>
  (block.content as { type?: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");

/** 兜底卡片：call/result 全字段直出（argsRaw/result 文本/error 原值不改写） */
function GenericToolCard({ callId, toolName, block, openFile, inspect }: ToolViewProps) {
  const settled = "kind" in block;
  const isError = settled && block.isError;
  return (
    <div data-testid={`tool-card-${callId}`} style={{ fontSize: 12.5 }}>
      <span className="mono" style={{ color: "var(--muted2)" }}>
        {toolName}
      </span>
      {settled && isError && (
        <span className="badge red" data-testid={`tool-error-${callId}`} style={{ marginLeft: 6 }}>
          ERROR
        </span>
      )}
      {!settled && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--muted2)" }}>调用中…</span>}
      {"argsRaw" in block && block.argsRaw !== "" && (
        <div className="mono" data-testid={`tool-args-${callId}`} style={{ fontSize: 11, color: "var(--muted2)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {block.argsRaw}
        </div>
      )}
      {settled && resultText(block) !== "" && (
        <div data-testid={`tool-result-${callId}`} style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>
          {resultText(block)}
        </div>
      )}
      {settled && block.error !== undefined && (
        <div className="mono" data-testid={`tool-error-detail-${callId}`} style={{ fontSize: 11, color: "var(--red, #c00)" }}>
          {typeof block.error === "string" ? block.error : JSON.stringify(block.error)}
        </div>
      )}
      {(openFile !== undefined || inspect !== undefined) && (
        <div style={{ marginTop: 2 }}>
          {inspect !== undefined && (
            <button type="button" className="btn sm" onClick={inspect} data-testid={`tool-inspect-${callId}`}>
              检查
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** ToolCall(864-895)：一个原子调用行经 keyed 注册表分发 */
const ToolCall = memo(function ToolCall({
  callId,
  toolName,
  block,
  toolViews,
  openFile,
  inspectCall,
  badgeSlot,
  children,
}: {
  callId: string;
  toolName: string;
  block: ToolBlock;
  toolViews?: Record<string, ComponentType<ToolViewProps>>;
  openFile?: (path: string) => void;
  inspectCall?: (callId: string) => void;
  badgeSlot?: (block: ToolBlock) => ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const View = toolViews?.[toolName];
  const viewProps: ToolViewProps = {
    callId,
    toolName,
    block,
    ...(openFile === undefined ? {} : { openFile }),
    ...(inspectCall === undefined ? {} : { inspect: () => inspectCall(callId) }),
  };
  return (
    <div data-chat-anchor-key={`call:${callId}`} data-chat-call-id={callId} style={{ margin: "2px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
        {children !== null && children !== undefined ? (
          <button
            type="button"
            aria-expanded={open}
            data-testid={`tool-toggle-${callId}`}
            onClick={() => setOpen((v) => !v)}
            style={{ background: "none", border: 0, cursor: "pointer", padding: "0 2px", color: "var(--muted2)" }}
            aria-label={`${toolName} 子调用`}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <div style={{ flex: 1 }}>
          {View !== undefined ? <View {...viewProps} /> : <GenericToolCard {...viewProps} />}
          {badgeSlot?.(block)}
        </div>
      </div>
      {open && children}
    </div>
  );
});

/** ToolCallBranch(897-921)：递归子调用，同一原子 keyed 分发 */
const ToolCallBranch = memo(function ToolCallBranch(props: {
  block: ToolBlock;
  toolViews?: Record<string, ComponentType<ToolViewProps>>;
  openFile?: (path: string) => void;
  inspectCall?: (callId: string) => void;
  badgeSlot?: (block: ToolBlock) => ReactNode;
}) {
  const { block } = props;
  return (
    <ToolCall
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      toolViews={props.toolViews}
      openFile={props.openFile}
      inspectCall={props.inspectCall}
      badgeSlot={props.badgeSlot}
    >
      {block.subCalls.length > 0 ? (
        <div data-subcalls="true" style={{ marginLeft: 18, borderLeft: "1px solid var(--line, #ddd)", paddingLeft: 8 }}>
          {block.subCalls.map((child) => (
            <ToolCallBranch key={child.callId} {...props} block={child} />
          ))}
        </div>
      ) : null}
    </ToolCall>
  );
});

/** ToolCallTree(933-939)：单根 + 递归子调用 */
export function ToolCallTree(props: {
  root: ToolBlock;
  toolViews?: Record<string, ComponentType<ToolViewProps>>;
  openFile?: (path: string) => void;
  inspectCall?: (callId: string) => void;
  badgeSlot?: (block: ToolBlock) => ReactNode;
}) {
  return <ToolCallBranch block={props.root} toolViews={props.toolViews} openFile={props.openFile} inspectCall={props.inspectCall} badgeSlot={props.badgeSlot} />;
}
