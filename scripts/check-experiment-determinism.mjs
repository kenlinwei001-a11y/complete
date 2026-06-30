#!/usr/bin/env node
/**
 * 门 `experiment-determinism:check`（WO-EXPERIMENT ④·决策 A/B·冠军-挑战者 · 不变量 R6/R2）。
 *
 * 守冠军-挑战者实验分流核（`apps/datacore/src/solvers/service.ts` chooseArm/routeExperiment）的硬性质
 * （静态哨兵 + test-backed）：
 *  1) **确定性分流（同请求键恒同臂·R6）**：chooseArm 必须用 `hashString(...)` × `canonicalJson(args)`
 *     选臂（hash·非随机），且实验路由方法体内**不得出现 Math.random**（否则同请求键随机落臂 → 违 R6）。
 *  2) **关实验=零影响既有**：routeExperiment 仅取 `status === "RUNNING"` 实验；无 RUNNING → 返 undefined（不分流）。
 *  3) **R2 租户隔离**：实验/臂仓储读写经本租户（routeExperiment 以 tenantId 调 solverExperiments.list）。
 *  4) **行为背书**：跑 `apps/datacore/test/experiment.test.ts`（vitest）全绿
 *     （两臂各约半 + 同请求键恒同臂 + conclude 落胜方 + 无 RUNNING 不分流 + 403/400）。
 *
 * 机制：纯校验，无棘轮基线（新文件、零存量）。任一红 → 退出码 1。
 * 用法：node scripts/check-experiment-determinism.mjs   （package.json: "experiment-determinism:check"）
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const SVC = "apps/datacore/src/solvers/service.ts";
const TEST = "apps/datacore/test/experiment.test.ts";
const fail = [];
const ok = (m) => console.log(`  ok  ${m}`);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

if (!existsSync(SVC)) fail.push(`缺求解器服务 ${SVC}`);
if (!existsSync(TEST)) fail.push(`缺实验单测 ${TEST}`);

if (existsSync(SVC)) {
  const src = stripComments(readFileSync(SVC, "utf8"));

  // 抽 chooseArm 方法体。
  const chooseArm = src.match(/chooseArm\s*\([^)]*\)\s*:\s*ExperimentArmKind\s*\{([\s\S]*?)\n  \}/);
  const chooseBody = chooseArm ? chooseArm[1] : "";
  if (!chooseBody) fail.push("未定位 chooseArm（分流核）方法体");
  else {
    if (!/hashString\s*\(/.test(chooseBody)) fail.push("chooseArm 未用 hashString 分流（确定性 R6 要求 hash·非随机）");
    if (!/canonicalJson\s*\(/.test(chooseBody)) fail.push("chooseArm 未用 canonicalJson(args) 作请求键（同请求键恒同臂）");
    if (!/splitPct/.test(chooseBody)) fail.push("chooseArm 未据 splitPct 选臂");
    if (/Math\.random|Date\.now|new Date\(/.test(chooseBody)) fail.push("chooseArm 含随机/时钟（违 R6 确定性）");
    else ok("chooseArm：hashString × canonicalJson(args) × splitPct，无随机/时钟（确定性分流·R6）");
  }

  // 抽 routeExperiment 方法体（含嵌套花括号：定位到下一个方法签名前）。
  const route = src.match(/private async routeExperiment\s*\([\s\S]*?(?=\n  (?:private|async|public|get) )/);
  const routeBody = route ? route[0] : "";
  if (!routeBody) fail.push("未定位 routeExperiment 方法体");
  else {
    if (!/status\s*===\s*"RUNNING"/.test(routeBody)) fail.push('routeExperiment 未仅取 status==="RUNNING" 实验（关实验须零影响既有）');
    if (!/return undefined/.test(routeBody)) fail.push("routeExperiment 无 RUNNING 时未返回 undefined（不分流）");
    if (/Math\.random|Date\.now|new Date\(/.test(routeBody)) fail.push("routeExperiment 含随机/时钟（违 R6）");
    else if (!fail.some((f) => f.startsWith("routeExperiment"))) ok("routeExperiment：仅 RUNNING 分流 + 无 RUNNING 返 undefined（关实验零影响·R6）");
  }

  // R2：实验路由以 tenantId 维度读仓储。
  if (/solverExperiments\.list\(\s*tenantId/.test(src)) ok("routeExperiment 以 tenantId 维度读 solverExperiments（R2 租户隔离）");
  else fail.push("routeExperiment 未以 tenantId 维度读 solverExperiments（R2）");
}

// 行为背书：跑实验单测。
if (existsSync(TEST) && !process.env.EXPERIMENT_CHECK_SKIP_TEST) {
  try {
    execSync(`pnpm --filter datacore exec vitest run test/experiment.test.ts`, { stdio: "pipe" });
    ok("experiment.test.ts 全绿（两臂各约半 + 同请求键恒同臂 + conclude 落胜方 + 关实验零影响）");
  } catch (e) {
    fail.push(`experiment.test.ts 未过（运行时分流/记录/胜负断言失败）：\n${(e.stdout?.toString() ?? "").slice(-1500)}`);
  }
}

if (fail.length) {
  console.error("\n✗ experiment-determinism:check 未通过：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ experiment-determinism:check：冠军-挑战者分流确定性（同请求键恒同臂·R6）+ 关实验零影响 + R2。");
