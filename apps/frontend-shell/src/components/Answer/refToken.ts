/**
 * ⟦ref:provId⟧ 记号正则（抽自 AnswerBlocks.tsx:81，N6 CHATUX 诚实层共用 helper）。
 * Answer 页与会话页（ChatFlow）同源；/g 有 lastIndex 状态，调用方须先重置
 * （`REF_RE.lastIndex = 0`），与 AnswerBlocks 既有用法一致。
 */
export const REF_RE = /⟦ref:([^⟧]+)⟧/g;
