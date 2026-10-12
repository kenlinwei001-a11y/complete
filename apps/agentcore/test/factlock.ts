/**
 * datacore 同款 shim：事实锁判据的**唯一实现**在 `apps/frontend-shell/test/factlock.ts`，
 * 各抄一份正则的金丝雀是装饰品（两处写判据迟早对不上）。agentcore 测试一律从这里取。
 */
// 扩展名 `.js` 不可省（NodeNext 解析）：省了 tsc 报 TS2835，转口整个失效。
export * from "../../frontend-shell/test/factlock.js";
