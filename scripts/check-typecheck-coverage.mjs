#!/usr/bin/env node
/**
 * 门 `typecheck-coverage:check` · **typecheck 扫描面必须真的包含测试目录**（假绿第 13 形态）
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ## 病：**typecheck 全绿，而它连测试文件看都没看**
 *
 * 2026-08-16 实测（WO-TEST-TYPECHECK-BLIND）：`apps/datacore` 与 `apps/agentcore` 的
 * `tsconfig.typecheck.json` **早就存在**（提交 `7302a0fc` 建的，文件头注释白纸黑字写着
 * 「把 `test/` 纳入类型检查面」），而两个包的 `package.json` 里 `typecheck` 脚本
 * **从来指向 `tsconfig.json`** —— 只有 `packages/contracts` 那一份真接上了线。
 *
 * 于是三周里：配置在、注释在、意图在，**466 个测试文件一次都没被类型检查过**。
 * 接上线的当天，两个包一共抖出 **354 个** 真类型错误（契约字段改名后测试没跟上、
 * fixture 缺必填字段、断言类型漏声明生产真会发的字段…），全部躺在正线上没人发现。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『N 包 typecheck 绿』当作『测试文件也没类型错』的证据，
 *   >   而前者并不度量后者 —— 它连看都没看。」**
 *
 * 这与铁律 0.6 已收录的第 4 条（改名要连断言一起改）是**同族但更底层**的病：
 * 那一条说的是「旧名以字符串形态存在，类型系统看不见」；本条说的是
 * **类型系统压根没被指向那些文件**。前者是能力边界，后者是接线断了。
 *
 * ## 判据：**落在「tsc 到底把哪些文件收进了程序」，不是「配置里写没写」**
 *
 * 读 `include`/`exclude` 去推断是**必然出错**的做法 —— `extends` 链、`files`、
 * `exclude` 反选、`references`、乃至 `package.json` 里根本没引用这份配置，
 * 任何一环都能让「写了」与「生效了」分家。本门这次栽的跟头正是这个。
 *
 * 故本门的测量方式是：
 *   ① 从 `package.json` 的 **`typecheck` 脚本原文**里解析出它真正 `-p` 的那份配置
 *      （不是猜某个约定文件名 —— 脚本指哪儿就量哪儿）；
 *   ② 对那份配置跑 `tsc --listFilesOnly`，拿到**程序文件全集**（tsc 自己的口径）；
 *   ③ 断言该包 `git ls-files` 出来的测试文件**逐个**都在这个全集里。
 *
 * 「文件在程序里」与「往它塞一行 `const x: number = "str"` 会报错」是等价的：
 * 进了程序就会被检查。本门取前者是因为它**快 3 个数量级**（`--listFilesOnly` 不做类型推导），
 * 且**不需要改动工作区里任何一个文件**（门不该有副作用）。
 *
 * ## 金丝雀（与主逻辑**共用同一份实现** —— 跑的就是 `surfaceOf()` 本体）
 *
 * **双向**，缺一不可：
 *  · **正向**：每个包的 typecheck 配置面里，测试文件必须**在**（这就是主判据本身）。
 *  · **反向（关键）**：每个包的 **build** 配置面里，测试文件必须**不在**。
 *    这一条锁死的是「`surfaceOf()` 到底有没有在量东西」——
 *    如果它坏成恒返「全都在」（比如 tsc 报错时返回空集又被当成通过），
 *    正向判据会**全部通过**而门读作「仓库干净」。反向金丝雀让这种坏法当场 RC=2。
 *    这正是本仓 2026-08-08 立下的规矩：**报否定结论前先自证工具没瞎。**
 *
 * 反向金丝雀用的是**真仓文件**（各包自己的 build 配置），不是编的样例 ——
 * build 配置必须排除 test 本来就是硬约束（`rootDir: "src"` + `declaration`，
 * 混进 test 会把测试文件 emit 进 dist 并污染包的公开类型面）。
 *
 * ## 变异反证（`--selftest`，双向机验）
 *   · 注入「测量坏了」  ⇒ 必须 RC=**2**（不许是 1 —— 那会读成「你的测试没被覆盖」）
 *   · 注入「真有包没接线」⇒ 必须 RC=**1**（不许被兜底吞成 2 —— 那就是永远不红的装饰品）
 *   后者的注入方式是让门去量该包的 **build** 配置（已知不含 test）——
 *   这**不是**模拟，而是精确复现 2026-08-16 之前 datacore/agentcore 的真实状态。
 *
 * ## 退出码三分
 *   0 = 干净（每个包的 typecheck 面都真的含它的测试文件）
 *   1 = **真有问题**（某个包的测试文件不在它 typecheck 面内）
 *   2 = **工具坏了**（金丝雀不中 / tsc 跑不起来 / 扫描面塌陷）——不许据此报「已覆盖」
 *
 * 用法：
 *   node scripts/check-typecheck-coverage.mjs             · pnpm typecheck-coverage:check
 *   node scripts/check-typecheck-coverage.mjs --report    （打印每包的面内测试文件数）
 *   node scripts/check-typecheck-coverage.mjs --selftest  （变异反证：双向机验退出码）
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const REPORT = ARGS.has("--report");
const SELFTEST = ARGS.has("--selftest");

/** RC=2 专用：工具坏了，**不是**「已覆盖 / 仓库干净」。 */
function toolBroken(why, detail) {
  console.error(`\n✗✗ typecheck-coverage:check —— **工具坏了**（RC=2），不是"已覆盖"：${why}`);
  if (detail) console.error(detail);
  console.error(
    `\n  ⚠ 报「测试文件都在 typecheck 面内」这类肯定结论之前，必须先有金丝雀命中证据。` +
      `\n    金丝雀不中 ⇒ 只能报「工具坏了」（CLAUDE.md 铁律 0.6）。`,
  );
  process.exit(2);
}

/* 顶层兜底：任何**未预期**异常也归 2。
 * node 对未捕获异常一律退 1 —— 恰好撞上本门「真有包没接线」那个码，
 * 于是「门自己崩了」会被读成「你的测试没被覆盖」，方向正好相反。 */
process.on("uncaughtException", (e) =>
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n")),
);
process.on("unhandledRejection", (e) =>
  toolBroken(`未预期 Promise 拒绝（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n")),
);

/** 故障注入开关：只给 `--selftest` 用，机械验证「测量坏了 ⇒ RC=2」这条路径真的成立。 */
if (process.env.TYPECHECK_COVERAGE_FORCE_TOOL_BROKEN === "1") {
  toolBroken("（故障注入）模拟测量面塌陷", "  这是自检在验「环境故障 ⇒ RC=2」这条路径。");
}
/**
 * 变异注入开关：让门改去量各包的 **build** 配置。
 * build 配置按设计不含 test —— 这精确复现 2026-08-16 之前 datacore/agentcore 的真实状态，
 * 故门**必须**报 RC=1。若它仍报 0，说明主判据是装饰品。
 */
const MUTATE = process.env.TYPECHECK_COVERAGE_MUTATE === "1";

// ────────────────────────────────────────────────────────────────────────────
// §1 待查包 —— 从 pnpm workspace 的实际布局取，不写死清单
// ────────────────────────────────────────────────────────────────────────────
/**
 * `buildConfig` 是**反向金丝雀**与变异注入共用的那份「已知不含 test」的配置。
 * 它不是猜的：这些包的 build 都靠 `rootDir: "src"` emit，混进 test 会当场 TS6059。
 */
const PACKAGES = [
  { name: "@platform/contracts", dir: "packages/contracts", buildConfig: "tsconfig.json" },
  { name: "@platform/llm-adapters", dir: "packages/llm-adapters", buildConfig: null },
  { name: "datacore", dir: "apps/datacore", buildConfig: "tsconfig.json" },
  { name: "agentcore", dir: "apps/agentcore", buildConfig: "tsconfig.json" },
  { name: "frontend-shell", dir: "apps/frontend-shell", buildConfig: "tsconfig.build.json" },
];

/**
 * `llm-adapters` 的 `buildConfig` 是 `null` —— **诚实标注，不是遗漏**：
 * 它的测试就写在 `src/*.test.ts` 里（没有独立 `test/` 目录），build 与 typecheck 共用一份配置，
 * 所以它**没有**「已知不含 test 的配置」可当反向金丝雀。给它编一个反而是假证据。
 */

// ────────────────────────────────────────────────────────────────────────────
// §2 测量：这个包的 typecheck 脚本，实际把哪些文件收进了程序
// ────────────────────────────────────────────────────────────────────────────

/** 从 `package.json` 的 `typecheck` 脚本原文里解析它真正 `-p` 的配置文件名。 */
export function tsconfigOfScript(script) {
  if (typeof script !== "string") return null;
  const m = /(?:^|\s)(?:-p|--project)\s+(\S+)/.exec(script);
  if (m) return m[1];
  // 没写 -p ⇒ tsc 走目录默认的 tsconfig.json
  return /(?:^|\s)tsc(?:\s|$)/.test(script) ? "tsconfig.json" : null;
}

/**
 * 跑 `tsc --listFilesOnly` 拿程序文件全集（**tsc 自己的口径**，不是我们解析配置猜的）。
 * 返回**仓库根相对路径**的 Set。
 *
 * ⚠ 失败必须 `toolBroken`，绝不能返回空集 —— 空集会让下游「测试文件都在吗」
 * 的判据变成「都不在」⇒ 报 RC=1「没接线」，把**工具故障**说成**代码问题**。
 */
export function surfaceOf(pkgDir, tsconfigName) {
  const abs = join(ROOT, pkgDir, tsconfigName);
  if (!existsSync(abs)) toolBroken(`${pkgDir}/${tsconfigName} 不存在，无法测量扫描面`);
  let out;
  try {
    out = execFileSync("npx", ["tsc", "-p", tsconfigName, "--listFilesOnly", "--noEmit"], {
      cwd: join(ROOT, pkgDir),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // tsc 在**配置错误**时非 0 退出；`--listFilesOnly` 不做类型检查，故正常情况下不该失败。
    const so = String(e?.stdout || "");
    if (!so.trim()) {
      toolBroken(`tsc --listFilesOnly 在 ${pkgDir}/${tsconfigName} 上失败且无输出`, String(e?.stderr || e).slice(0, 800));
    }
    out = so;
  }
  const files = new Set();
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    files.add(relative(ROOT, resolve(join(ROOT, pkgDir), p)).split(sep).join("/"));
  }
  if (files.size === 0) toolBroken(`${pkgDir}/${tsconfigName} 的扫描面为空 —— 测量塌陷，不是"没有文件"`);
  return files;
}

/** 该包 git 在册的测试文件（相对仓库根）。 */
export function testFilesOf(pkgDir) {
  let out;
  try {
    // pathspec 里的 `*` **跨 `/`**（CLAUDE.md 铁律 0.5 判据 #5 的 2026-08-11 订正，本单复测确认）：
    // `test/*.ts` 已经收到 `test/fixtures/qos-20q-goldset.ts` 这类嵌套文件 ——
    // 实测 agentcore 该式命中 175，与 `git ls-files 'apps/agentcore/test/*'` 同数，两个 fixtures 都在内。
    // 故**不**另加 `test/**/*.ts`：那一式反而要求至少一个中间目录段，收窄而非放宽。
    // 只收 .ts/.tsx —— `test/fixtures/*.json` 不是 TypeScript，本就不进类型面（frontend 那 7 个即是）。
    out = execFileSync("git", ["ls-files", "--",
      `${pkgDir}/test/*.ts`, `${pkgDir}/test/*.tsx`,
      `${pkgDir}/src/*.test.ts`, `${pkgDir}/src/*.test.tsx`,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    toolBroken(`git ls-files 失败（${pkgDir}）`, String(e?.stderr || e).slice(0, 400));
  }
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ────────────────────────────────────────────────────────────────────────────
// §3 金丝雀 —— 与主逻辑共用 surfaceOf()，不另抄一份实现
// ────────────────────────────────────────────────────────────────────────────
/**
 * 反向金丝雀：build 配置的面里**不该有**该包的测试文件。
 *
 * 这一条锁死的是「`surfaceOf()` 到底有没有在量东西」。若它坏成恒返「全都在」，
 * 主判据会全部通过、门报「干净」—— 而那正是本门要根治的那种假绿。
 */
function runReverseCanary() {
  const evidence = [];
  for (const pkg of PACKAGES) {
    if (!pkg.buildConfig) continue; // llm-adapters：无「已知不含 test」的配置，见上方说明
    const tests = testFilesOf(pkg.dir);
    if (tests.length === 0) continue;
    const surface = surfaceOf(pkg.dir, pkg.buildConfig);
    const leaked = tests.filter((f) => surface.has(f));
    if (leaked.length > 0) {
      toolBroken(
        `反向金丝雀不中：${pkg.dir}/${pkg.buildConfig}（build 配置）的面里**竟然有**测试文件 ${leaked.length} 个`,
        `  样例：${leaked.slice(0, 3).join("  ")}\n` +
          `  build 配置按设计必须排除 test（rootDir: "src" + declaration，混进去会 TS6059 且污染 dist）。\n` +
          `  出现这种情况 ⇒ 要么 surfaceOf() 量错了对象，要么 build 配置被改坏 —— 两者都不许读作"已覆盖"。`,
      );
    }
    evidence.push(`${pkg.dir}/${pkg.buildConfig}: ${tests.length} 个测试文件全部**不在**面内 ✓`);
  }
  if (evidence.length === 0) {
    toolBroken("反向金丝雀一条都没跑成 —— 没有任何包提供了可比对的 build 配置");
  }
  return evidence;
}

// ────────────────────────────────────────────────────────────────────────────
// §4 变异反证
// ────────────────────────────────────────────────────────────────────────────
function selftest() {
  const self = ["node", "scripts/check-typecheck-coverage.mjs"];
  const run = (env) => {
    try {
      execFileSync(self[0], [self[1]], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      return 0;
    } catch (e) {
      return typeof e?.status === "number" ? e.status : -1;
    }
  };
  let bad = 0;

  const rcBroken = run({ TYPECHECK_COVERAGE_FORCE_TOOL_BROKEN: "1" });
  const okBroken = rcBroken === 2;
  console.log(`  ${okBroken ? "✓" : "✗"} 注入「测量坏了」 ⇒ RC=${rcBroken}（要求 2 —— 报 1 会被读成"你的测试没被覆盖"）`);
  if (!okBroken) bad++;

  const rcViolate = run({ TYPECHECK_COVERAGE_MUTATE: "1" });
  const okViolate = rcViolate === 1;
  console.log(
    `  ${okViolate ? "✓" : "✗"} 注入「真有包没接线」（改量 build 配置=复现 2026-08-16 前的真实状态） ⇒ RC=${rcViolate}` +
      `（要求 1 —— 报 0 说明主判据是装饰品，报 2 说明被兜底吞了）`,
  );
  if (!okViolate) bad++;

  const rcClean = run({});
  const okClean = rcClean === 0;
  console.log(`  ${okClean ? "✓" : "✗"} 不注入 ⇒ RC=${rcClean}（要求 0）`);
  if (!okClean) bad++;

  if (bad > 0) {
    console.error(`\n✗ 变异反证失败 ${bad} 项 —— 本门当前是装饰品，别信它的绿。`);
    process.exit(1);
  }
  console.log("\n✅ 变异反证通过：RC 0/1/2 三条路径都机械验证过。");
  process.exit(0);
}

// ────────────────────────────────────────────────────────────────────────────
// §5 主流程
// ────────────────────────────────────────────────────────────────────────────
function main() {
  if (SELFTEST) return selftest();

  const canaryEvidence = runReverseCanary();

  const violations = [];
  const rows = [];
  for (const pkg of PACKAGES) {
    const pjPath = join(ROOT, pkg.dir, "package.json");
    if (!existsSync(pjPath)) toolBroken(`${pkg.dir}/package.json 不存在`);
    let pj;
    try {
      pj = JSON.parse(readFileSync(pjPath, "utf8"));
    } catch (e) {
      toolBroken(`${pkg.dir}/package.json 解析失败`, String(e?.message || e));
    }
    const script = pj?.scripts?.typecheck;
    if (!script) {
      violations.push({ pkg: pkg.dir, why: "package.json 没有 typecheck 脚本 —— 这个包的类型面无人看守" });
      continue;
    }
    // 变异注入：改去量 build 配置（已知不含 test）⇒ 门必须报红
    const cfg = MUTATE && pkg.buildConfig ? pkg.buildConfig : tsconfigOfScript(script);
    if (!cfg) {
      violations.push({ pkg: pkg.dir, why: `typecheck 脚本里解析不出 tsconfig：${script}` });
      continue;
    }

    const tests = testFilesOf(pkg.dir);
    if (tests.length === 0) {
      rows.push(`  ${pkg.dir.padEnd(24)} ${String(cfg).padEnd(26)} 无测试文件，跳过`);
      continue;
    }
    const surface = surfaceOf(pkg.dir, cfg);
    const missing = tests.filter((f) => !surface.has(f));
    if (missing.length > 0) {
      violations.push({
        pkg: pkg.dir,
        why:
          `typecheck 走的是 ${cfg}，但该包 ${tests.length} 个测试文件里有 ${missing.length} 个**不在**它的扫描面内 ——\n` +
          `      这些文件的类型错误在全仓不可见，而 \`pnpm typecheck\` 照样绿。\n` +
          `      样例：${missing.slice(0, 3).join("  ")}\n` +
          `      修法：让 typecheck 脚本指向一份 include 含 test 的配置（**别**动 build 用的那份，\n` +
          `      它靠 rootDir:"src" emit，混进 test 会 TS6059 并把测试吐进 dist）。`,
      });
    }
    rows.push(`  ${pkg.dir.padEnd(24)} ${String(cfg).padEnd(26)} ${tests.length - missing.length}/${tests.length} 个测试文件在面内`);
  }

  if (REPORT || violations.length > 0) {
    console.log("\n── typecheck 扫描面普查（判据 = tsc --listFilesOnly 的程序全集，不是配置里写没写）──");
    for (const r of rows) console.log(r);
  }
  if (REPORT) {
    console.log("\n── 反向金丝雀证据（证明测量没瞎）──");
    for (const e of canaryEvidence) console.log(`  ${e}`);
  }

  if (violations.length > 0) {
    console.error(`\n✗ typecheck-coverage:check —— ${violations.length} 个包的测试文件不在 typecheck 面内（RC=1）\n`);
    for (const v of violations) console.error(`  · ${v.pkg}\n      ${v.why}\n`);
    console.error(
      `  形态（CLAUDE.md 铁律 0.6）：\n` +
        `  「我用『typecheck 绿』当作『测试文件也没类型错』的证据，而前者并不度量后者 —— 它连看都没看。」\n`,
    );
    process.exit(1);
  }

  console.log(
    `✅ typecheck-coverage:check 干净：${PACKAGES.length} 个包的 typecheck 面都真的含它们的测试文件` +
      `（反向金丝雀 ${canaryEvidence.length} 条全中，证明测量没瞎）。`,
  );
  process.exit(0);
}

try {
  main();
} catch (e) {
  if (e && typeof e.code === "string" && e.code === "ERR_EXIT") throw e;
  toolBroken(`主流程未预期失败（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n"));
}
