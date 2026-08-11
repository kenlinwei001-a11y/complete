import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **事实锁的公用扫描面** —— 锚在**事实**上，不锚在**位置**上。
 *
 * ── 为什么要有这个文件（2026-08-11 实测的病样，`e639a6c2`）──────────────────────
 * `stale-claims.seam.test.ts` §3 原先写死 `readRepo("apps/datacore/src/app.ts")` 去找两个串。
 * 集成分支把那段装配抽到了 `sim/propagation-inputs.ts` —— **能力一行没少，纯粹搬了个家**。
 * 同一次重构里，一条 it 同时产出两个**方向相反**的错误信号：
 *   · `listByType(…, "Cadence")` → **假红**：事实还在，只是锚点搬走了；
 *   · `buildCadenceGates`        → **假绿**：命中的是那个文件里的**注释**与 **import 行**，
 *     不是调用点 —— 真调用搬走了，断言一声不吭。
 *
 * 照 CLAUDE.md 铁律 0.6 的句式：
 *   **「我用『某串在 app.ts 里』当作『tick 仍在读回 Cadence』的证据，而前者并不度量后者。」**
 * **会因一次无害重构而红的门，只会训练人把门删掉** —— 等真删了那天就没人拦了。
 *
 * ── 用法三条（缺一条就退回老病）──────────────────────────────────────────────
 *  ① 扫**整棵源码树**（`srcCode`），别写死单个文件；
 *  ② **剥注释**（`stripComments` 已在 `srcCode` 里做掉）—— 注释里提一嘴不算「代码里有」；
 *  ③ 排除**声明式**：用 `/(?<!function\s)\bfoo\s*\(/` 之类 —— 光有 `export function foo(`
 *     是「没接线」，不是「在调用」；import 行没有紧跟的括号，天然不算。
 *
 * ⚠ 报「事实没了」这种**否定结论**之前，必须先跑金丝雀自证扫描器没坏（铁律 0.6）：
 *   一个**已知必中**的串必须命中；一段**只在注释里**出现的合成串必须**不**中。
 *   两条金丝雀与主判据共用本文件的同一份实现 —— 各抄一份正则的金丝雀是装饰品。
 *
 * 🚦 本文件不是测试（无 `.test.` 后缀，vitest 不收集），只被测试 import。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "../../..");

/** 剥掉块注释与行注释（保留行数无关紧要，判据只看「在不在」）。 */
export const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

/** 仓库相对路径读原文。 */
export const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

/** `[仓库相对路径, **剥注释后的可执行代码**][]` */
export type CodeTree = [string, string][];

/**
 * 递归读一棵源码树（`.ts` / `.tsx`），逐文件剥注释。
 * @param rel 仓库相对目录，如 `"apps/datacore/src"`
 */
export function srcCode(rel: string): CodeTree {
  const root = join(REPO_ROOT, rel);
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [],
    );
  return walk(root).map((f) => [f.slice(REPO_ROOT.length + 1), stripComments(readFileSync(f, "utf8"))]);
}

/** 事实命中的文件清单（**空数组 = 该事实在可执行代码里已不存在**）。 */
export const factHits = (code: CodeTree, probe: string | RegExp): string[] =>
  code.filter(([, s]) => (typeof probe === "string" ? s.includes(probe) : probe.test(s))).map(([f]) => f);

/**
 * 金丝雀②的合成样例：一段**只在注释里**提到 `probe` 的代码。
 * `factHits(commentOnlyCanary("X"), "X")` 必须为 `[]`，否则 `stripComments` 坏了或被摘了，
 * 本次一切「事实还在」的结论作废 —— 那正是当初「命中注释而误报绿」的形态。
 */
export const commentOnlyCanary = (probe: string): CodeTree => [
  ["canary.ts", stripComments(`/* 提到 ${probe} 但只是散文 */\nconst x = 1;\n// ${probe} 也只是注释\n`)],
];
