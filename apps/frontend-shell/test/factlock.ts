import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

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

/**
 * 剥掉块注释与行注释。
 *
 * ── 🔴 2026-08-14 实测：上一版**吞掉了 670 行可执行代码**（WO-BEFE-A 当场撞上）────────────
 * 上一版是两条 `replace` 顺序执行，**块注释先剥**：
 *     `s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^[ \t]*\/\/.*$/gm," ")`
 * 于是一条**行注释里写了路由通配**就会开出一个假块注释：
 *     `// \`listCheckpoints\`，但 24 条 \`/a/v1/sim/*\` 路由里从没有人开这个口`
 *                                            ↑ 这个 `/*` 被当成块注释开头
 * 它一路吞到下一个 `*​/` 为止 —— `apps/datacore/src/app.ts` 实测被吞 **1802–1954 行**，
 * 正是 `GET /a/v1/sim/view-config` 的处理器所在。全仓实测：
 *   | 文件 | 假开头 | 被吞可执行行 |
 *   |---|---|---|
 *   | `apps/datacore/src/app.ts` | 3 | 270 |
 *   | `apps/agentcore/src/server.ts` | 1 | 145 |
 *   | `apps/datacore/src/ontology-core.ts` | 1 | 97 |
 *   | `apps/datacore/src/solvers/chain-impediment.ts` | 1 | 71 |
 *   | `apps/datacore/src/features.ts` | 3 | 34 |
 *   | `apps/agentcore/src/tools/executor.ts` | 1 | 32 |
 *   | `apps/frontend-shell/src/views/sim/SandboxPlaysPanel.tsx` | 1 | 11 |
 *   | `apps/agentcore/src/llm/providers.ts` | 1 | 10 |
 *   合计 **8 个文件 · 670 行**（复验脚本见本条末）。
 *
 * 后果**恰好是本文件存在的理由的反面**：任何针对这些区域的事实锁，问「这个事实还在不在」，
 * 一律得到「不在」—— 而真相是**扫描器把它吃了**。照本文件头那句：
 *   **「我没找到」和「它不存在」是两个不同的命题。**
 * 更难看的是：`commentOnlyCanary` 那条金丝雀**照样绿** —— 它只验「注释没被当成代码」（假绿方向），
 * 从不验「代码没被当成注释」（**假红方向**）。一条只朝一个方向看的金丝雀，
 * 对另一个方向的失效**天然免疫**。故本次同时补了 `codeEatenCanary`（见下）。
 *
 * ── 现在的实现：单趟左→右扫描，谁先出现算谁 ────────────────────────────────
 * 不再是两条 `replace` 分先后 —— 那个「先后」本身就是病根。逐字符走一遍，
 * 在**代码态**才认 `/*` 与 `//`；在字符串/模板串里一律不认（否则 `"https://x"` 会被从 `//` 处截断，
 * 上一版靠 `^[ \t]*` 行首锚点侥幸避开了这个坑，去掉锚点就必须显式处理）。
 * 换行一律保留（被剥掉的注释体只替换成空格），使行结构不被压扁。
 *
 * ⚠ 诚实边界（残留、已知、不假装没有）：**正则字面量**不单独识别。
 * `/foo\/*bar/` 这种「转义斜杠紧跟星号」的写法仍会被误判为块注释开头。
 * 本仓当前无此写法（实测 0 例）；上一版同样有这个洞，本次未扩大。
 *
 * 复验命令（重跑上表）：
 *   `node -e '…'` 见 `docs/WO-BEFE-A-triage.md` §附录A
 */
export const stripComments = (s: string): string => {
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i]!;
    const c2 = s[i + 1];
    // ① 块注释 —— 只在代码态被认；未闭合则吃到文件尾（与 JS 语义一致）
    if (c === "/" && c2 === "*") {
      const end = s.indexOf("*/", i + 2);
      const body = end === -1 ? s.slice(i) : s.slice(i, end + 2);
      out += body.replace(/[^\n]/g, " "); // 换行保留，其余抹成空格
      i += body.length;
      continue;
    }
    // ② 行注释 —— 吃到行尾为止。**关键**：它在这里与 ① 同一趟里按出现先后竞争，
    //    所以行注释里的 `/a/v1/sim/*` 再也开不出块注释了。
    if (c === "/" && c2 === "/") {
      const nl = s.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    // ③ 字符串 / 模板串 —— 原样保留，且内部的 `//` `/*` 一律不认
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === c) { j += 1; break; }
        j += 1;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
};

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

/**
 * 金丝雀③（2026-08-14 新增·WO-BEFE-A）：一段**真代码**，写在一条「含路由通配的行注释」之后。
 * `factHits(codeEatenCanary("X"), "X")` 必须**命中**，否则 `stripComments` 又把代码当注释吃了。
 *
 * ── 为什么非补不可 ────────────────────────────────────────────────────────────
 * 金丝雀② 只朝**一个方向**看：「注释有没有被当成代码」（假绿方向）。
 * 而 2026-08-14 实测撞上的那次失效是**反方向**：「代码被当成了注释」（假红方向，670 行）——
 * ② 对它天然免疫，所以扫描器烂了整整一段时间而全套金丝雀照样绿。
 *
 * 照 CLAUDE.md 铁律 0.6 的句式：
 *   **「我用『注释没被当成代码』当作『剥注释是对的』的证据，而前者只度量了一半。」**
 * 一个只验一个方向的金丝雀，就是只测了一半的门。
 *
 * 样例里的 `/a/v1/sim/*` 不是随手编的 —— 它逐字取自 `apps/datacore/src/app.ts:1802`
 * 那条真实的行注释，正是它开出假块注释吞掉了 1802–1954 行。
 */
export const codeEatenCanary = (probe: string): CodeTree => [
  [
    "canary-eaten.ts",
    stripComments(
      `// 24 条 \`/a/v1/sim/*\` 路由里从没有人开这个口 —— 行注释里的通配不该开出块注释\n` +
        `const ${probe} = 1;\n` +
        `/** 真块注释，该被剥掉 */\n` +
        `export const url = "https://example.com/x"; // 串里的 // 不该把这行截断\n`,
    ),
  ],
];

/**
 * 扫树 + 双金丝雀**一步到位** —— 2026-08-11 普查（WO-C）发现各测试文件各写各的金丝雀，
 * 写着写着就会有人省掉 —— 省掉的那天，「事实没了」又是裸结论。故把铁律 0.6 结构进函数签名：
 * 不给 `knownHit`（一个**已知必中**、与被测事实无关的串）就拿不到树。
 *
 * ① 规模下界：树扫空了 ⇒ 工具坏了，不许读作「全仓没有」；
 * ② `knownHit` 必须命中 ⇒ 扫描/剥注释管线活着；
 * ③ `commentOnlyCanary` 必须**不**中 ⇒ 注释没被当成代码（**假绿**方向）；
 * ④ `codeEatenCanary` 必须**中** ⇒ 代码没被当成注释（**假红**方向，2026-08-14 新增，见该函数注释）。
 * 四条任何一条挂了，当场红的是「工具坏了」，不是「事实没了」。
 */
export function checkedTree(rel: string, knownHit: string, minFiles: number): CodeTree {
  const tree = srcCode(rel);
  expect(tree.length, `扫描面塌了：${rel} 只扫到 ${tree.length} 个文件（下界 ${minFiles}）⇒ 工具坏了，结论作废`).toBeGreaterThan(
    minFiles,
  );
  expect(
    factHits(tree, knownHit),
    `金丝雀①：已知必中的「${knownHit}」零命中 ⇒ 扫描器坏了，本次一切否定结论作废`,
  ).not.toEqual([]);
  expect(
    factHits(commentOnlyCanary(`${knownHit}·CANARY`), `${knownHit}·CANARY`),
    "金丝雀②：只在注释里出现的串被当成代码命中 ⇒ stripComments 坏了或被摘了，结论作废",
  ).toEqual([]);
  expect(
    factHits(codeEatenCanary(`${knownHit}_EATEN`), `${knownHit}_EATEN`),
    "金丝雀④：行注释后面的**真代码**被当成注释吃掉了 ⇒ 一切「事实没了」的否定结论作废（2026-08-14 实测过 670 行）",
  ).not.toEqual([]);
  return tree;
}
