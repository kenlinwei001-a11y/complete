// WO-CI-DSH-TENANTPOOL · 运行时能力补齐：`Promise.withResolvers`（副作用模块，import 即装）。
//
// 为什么存在（实测病因，不是预防性代码）：
//   `Promise.withResolvers` 是 **Node 21.7+ / 22+** 才有的内建（V8 12.x）。本仓 CLAUDE.md
//   声明支持 **Node ≥20**，`.github/workflows/gates.yml` 的主 gate 也**钉死 node-version: 20**
//   （那是声明的最低版本，本仓另有一次「沙箱开关名随版本变过」的便携性事故就是它抓出来的）。
//   而 dsh 供应链 0.1.0-rc.6 **五个包**在运行期直接调它：
//     @deepseek-ai/dsh-mcp-client   lib/index.js:440    ← 本包 plugins/mcp-client-tenant.mjs:487 逐字继承
//     @deepseek-ai/dsh-agent-loop   lib/index.js:414,449,825,872,1066,1108
//     @deepseek-ai/dsh-agent        lib/index.js:728
//     @deepseek-ai/dsh-session-persistence · @deepseek-ai/dsh-subagent
//   ⇒ Node 20 上整包 harness 不可用：unit 段 12/13 红（连接建不起来 ⇒
//   `unknown tool "mcp__erp__whoami"`），smoke 段子进程红（`no agent factory registered`）。
//   开发机跑 Node 22 全绿，CI 跑 Node 20 全红 —— 同一份代码，差异 100% 来自运行时。
//
// 为什么是补齐而不是抬版本：把声明的最低版本从 20 抬到 22 会改动对外支持承诺（DEPLOY/镜像/
// CLAUDE.md），属治理决策，不在本单权限内；且主 gate 跑 Node 20 正是为了让这类漂移**红出来**，
// 抬版本等于把那只金丝雀掐死。补齐让声明的最低版本**真的能跑**，租户隔离断言一条不减。
//
// ⚠ 上游包一律**运行期调用**（无 top-level 捕获引用，已逐处核过），所以本模块只要在那些
// 函数**被调用前**装好即可；ESM 里把它排在首个 import 就满足。
// ⚠ 跨进程不继承：谁 spawn 出新的 node 进程，谁负责把它带过去（见 smoke.mjs / test/run.mjs
//   往子进程 env 注入 `NODE_OPTIONS=--import <本文件 URL>`）。
//
// 语义照 TC39 提案原文：用 `this` 当构造器（子类调用保持子类型），返回 { promise, resolve, reject }。

if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    value: function withResolvers() {
      let resolve
      let reject
      const promise = new this((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    },
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

/** 供 spawn 方拼 `NODE_OPTIONS`：本文件的 file: URL（子进程 `--import` 用）。 */
export const RUNTIME_COMPAT_URL = import.meta.url
