/**
 * 事实锁扫描面的**单一出处**在 `apps/frontend-shell/test/factlock.ts`（病历与判据本体都在那里顶注）。
 * datacore 的测试不许各抄一份剥注释/扫描正则 —— 两处写判据 = 迟早对不上（该文件顶注的病历
 * 有一半就是这么来的）。故本文件只做转口，一个字都别在这里「改进」。
 */
// 扩展名 `.js` 不可省：本包是 NodeNext 解析，省了 tsc 报 TS2835，
// 转口随之整个失效（下游 4 个 seam 测试拿到 16 条 TS2305「没有导出成员」）。
// vitest 解析得动、tsc 解析不动 —— 这条 3 年没人看见，正因为 test/ 从来不在 typecheck 面内。
export * from "../../frontend-shell/test/factlock.js";
