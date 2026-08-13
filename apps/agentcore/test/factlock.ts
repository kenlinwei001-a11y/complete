/**
 * datacore 同款 shim：事实锁判据的**唯一实现**在 `apps/frontend-shell/test/factlock.ts`，
 * 各抄一份正则的金丝雀是装饰品（两处写判据迟早对不上）。agentcore 测试一律从这里取。
 */
export * from "../../frontend-shell/test/factlock";
