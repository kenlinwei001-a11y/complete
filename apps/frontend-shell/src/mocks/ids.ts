/**
 * mock 域的**叶子常量**模块 —— 存在理由是打断一个真实的 ESM 循环，不是为了整洁。
 *
 * ── 病（2026-08-13 亲手在浏览器里跑出来的，四包测试全绿）────────────────────────
 * `VITE_MOCK=1 pnpm --filter frontend-shell dev`（CLAUDE.md「常用命令」里那条）打开是**整页空白**，
 * `#root` 零子节点，控制台：
 *   `ReferenceError: Cannot access 'TENANT_ID' before initialization`
 *   at src/mocks/planBuilderFixtures.ts:5
 *
 * 机制：`fixtures.ts` 底部有 `export { … } from "./planBuilderFixtures"`。
 * **`export … from` 是导入声明，会被提升到模块体之前执行** ⇒ 浏览器先整个求值
 * `planBuilderFixtures.ts`，而它第 5 行是顶层 `const … = [{ tenantId: TENANT_ID, … }]`，
 * 此刻 `fixtures.ts` 第 32 行的 `TENANT_ID` 还在 TDZ ⇒ 抛错 ⇒ 整个 mock 模式一行都跑不起来。
 *
 * ── 为什么 1129 个前端测试全绿却没咬住 ────────────────────────────────────────
 * vitest 的 SSR 转换把 ESM 改写成带惰性 getter 的形式，**循环导入被容忍**；浏览器原生 ESM 不容忍。
 * 于是测试跑的那份模块图与用户浏览器跑的那份**不是同一份**。
 * 这是「绿测试 ≠ 能用」最纯粹的形态：断言全对、语义全对，只是**根本没在被测的那个运行时里跑过**。
 *
 * ── 修法为什么是新建叶子模块而不是挪一行 ──────────────────────────────────────
 * 把 `TENANT_ID` 挪到 `fixtures.ts` 更前面**治不了**：提升的是整条 `export … from`，
 * 与常量在文件里排第几行无关。必须让两边都依赖一个**不回指任何人**的叶子，环才断得掉。
 */
export const TENANT_ID = "tenant-battery";
export const PACKAGE_ID = "pkg_battery";
