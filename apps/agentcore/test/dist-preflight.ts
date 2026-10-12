/**
 * dist 前置自检 · vitest globalSetup（WO-AGENTCORE-DIST-PREFLIGHT）
 *
 * ══ 治什么 ═══════════════════════════════════════════════════════════════════════
 * `test/dsh-*` 一大类测试**从 `dist/` 起子进程**（stdio MCP server：ontology / solvers /
 * workflow / rules / builtin —— 经 src/engine.ts 的 resolve*McpServerPath 与各测试文件里的
 * SERVER_PATH）。没先 `pnpm --filter agentcore build` 就跑 `vitest run` ⇒ **一片红**，
 * 而每条红**逐条读起来都像产品坏了**：`MCP error -32000: Connection closed`、
 * `缺入口 …/dist/…`、工具面读成空串。
 *
 * 2026-10-09 一天之内实测两次（两个人各一次）：某单先红 24 条 → build 后 0 条红；
 * 某单先红 8 条 → build 后 20/20 绿。**同一个病第二次 ⇒ 建机制（CLAUDE.md 铁律 0.6）。**
 *
 * 形态（铁律 0.6 句式）：
 *   「我用『测试红了』当作『代码坏了』的证据，而前者并不度量后者 ——
 *     有一个前置没做，红的是**前置**不是代码。」
 *
 * ══ 形态选型（为什么是 globalSetup，不是各测试文件里的 helper）═════════════════════
 * 需要 dist 的文件集**不是静态可知的**：任何把 DSH 分叉跑起来的测试都会经引擎解析器
 * spawn dist 入口（今天 28 个测试文件引用 DSH_HARNESS，且还会长）。依赖「每个测试作者记得
 * 调一句 helper」= **人先想起来**，不是机器先说话 —— 正是铁律 0.6 判为「不是机制」的那类。
 * 故判据上移到 globalSetup：**新测试文件天然被覆盖，一个都漏不掉**。
 *
 * ══ 判据（三条同时成立才算数）══════════════════════════════════════════════════════
 *   ① 前置缺失 ⇒ **本次一个测试都不跑**，只吐下面那一条消息并退 **RC=2**
 *      （2 = 环境没准备好，与「测试跑过且失败」的 1 分开；对齐 scripts/dist-freshness.mjs
 *      的 exitToolNotReady 约定 —— 把「我没查」读成「我查了，你有问题」方向正好相反）；
 *   ② 前置齐全 ⇒ **静默通过**（不打任何字）⇒ 测试数与结果逐字节不变；
 *   ③ 不吞真红：本文件只做**存在性前置**，不接管任何测试失败 —— dist 在时真产品缺陷照旧红。
 *
 * ⛔ 不许在这里偷偷 build（「测试运行应该是确定且快的」；要人做前置就明确报出来）。
 * ⛔ 判据是「产物**在不在**」，不是「新不新」：过期 dist（src 比 dist 新）是另一族病
 *    （欠账 #161，门侧由 scripts/dist-freshness.mjs 守），本单不扩大范围。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 测试会 spawn 的 dist 产物全集（相对 `apps/agentcore/dist/`）。
 * = src/engine.ts 五个 resolve*McpServerPath 的落点 + 各测试里显式 SERVER_PATH / spawn args。
 */
const REQUIRED_DIST_ENTRIES = [
  "dsh-runtime/ontology-mcp-server.js",
  "dsh-runtime/solvers-mcp-server.js",
  "dsh-runtime/workflow-mcp-server.js",
  "dsh-runtime/rules-mcp-server.js",
  "dsh-runtime/builtin-mcp-server.js",
] as const;

const BUILD_CMD = "pnpm --filter agentcore build";

export default function distPreflight(): void {
  const distRoot = new URL("../dist/", import.meta.url);
  const srcRoot = new URL("../src/", import.meta.url);

  // 自证（金丝雀的另一半）：源码侧对照物必须在。它不在 ⇒ 是**本文件路径拼错了**（工具坏了），
  // 不许报成「前置没做」——否则这份自检自己会变成一台恒红机（报「没 build」而其实是它瞎了）。
  const srcMissing = REQUIRED_DIST_ENTRIES.filter(
    (e) => !existsSync(fileURLToPath(new URL(e.replace(/\.js$/, ".ts"), srcRoot))),
  );
  if (srcMissing.length > 0) {
    console.error(
      `\n⛔ agentcore dist 前置自检**自己坏了**：找不到源码对照物 ${srcMissing.join("、")}。\n` +
        `   这是工具坏了（路径解析漂了），**不是前置没做、更不是代码坏了** —— 本次结论作废（RC=2）。\n`,
    );
    process.exit(2);
  }

  const distMissing = REQUIRED_DIST_ENTRIES.filter((e) => !existsSync(fileURLToPath(new URL(e, distRoot))));
  if (distMissing.length === 0) return; // ② 齐全 ⇒ 静默通过（不打字，测试面逐字节不变）

  console.error(
    `\n⛔ agentcore vitest 前置未就绪：**dist 未构建**（缺 ${distMissing.length} 个产物入口）——\n` +
      `   本次一个测试都没跑，任何红/绿结论都不存在（RC=2）。\n` +
      `   缺：${distMissing.map((e) => `dist/${e}`).join("、")}\n\n` +
      `   这不是产品坏了，是**前置没做**：这些测试从 dist 起 stdio MCP 子进程，没 build 就只剩\n` +
      `   「连接被关 / 缺入口」这类假红。请先构建再重跑：  ${BUILD_CMD}\n`,
  );
  process.exit(2);
}
