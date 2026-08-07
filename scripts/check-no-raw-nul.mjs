#!/usr/bin/env node
/**
 * check-no-raw-nul.mjs · 源码里不许有**裸 NUL 字节**
 *
 * ## 为什么要一道门，而不是"注意一点"
 *
 * NUL 在本仓是个**合理**的分隔符（`memKey(tenantId, id)`、ts point 的四元组键——
 * 它保证任何业务字符串都不可能撞键）。问题不在用它，在**怎么把它写进源码**：
 *   · 写成裸字节  → git 判定整个文件为 binary，`git diff` 只回一句 "Binary files differ"；
 *   · 写成转义序列 → 字符完全相同，diff 照常可读。
 * 二者运行期逐字节等价，**只有可复审性不同**。
 *
 * 代价是实的：`apps/datacore/src/repo/memory.ts`（473 行）与
 * `apps/datacore/src/sim/propagation.ts` 都曾因此在整个生命周期里**没有一次可读的 diff**，
 * 复审只能靠"信任提交者"。一个 15KB 的仓储实现，改动无法被 review —— 这不是洁癖问题。
 *
 * ## 这道门存在的真正理由：我自己刚犯过
 *
 * 2026-08-07：我先修好了 memory.ts 的裸 NUL，**十分钟后在 pg.ts 的新代码里又写了三个**。
 * 同一个人、同一个上下文、刚刚才处理过这件事 —— 照样复发。
 * 结论不是"下次更小心"，是**这类问题只能用机器挡**：人对不可见字符没有感知力，
 * 而 `file(1)` / 一次 indexOf 有。
 *
 * 判据：扫全部纳入版本管理的文本类源文件，命中即红并给出 file:line。
 * 修法永远是同一个：把裸字节换成等价的转义写法（行为不变）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|yml|yaml|css|html|sh)$/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter((f) => f && EXT.test(f));

const hits = [];
for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue; // 已删除但仍在索引里的路径不该让门崩
  }
  let i = buf.indexOf(0);
  if (i < 0) continue;
  // 只报每个文件的第一处 + 总数：一个文件里的裸 NUL 通常是同一处写法复制出来的
  const line = buf.subarray(0, i).toString("utf8").split("\n").length;
  let count = 0;
  while (i >= 0) {
    count++;
    i = buf.indexOf(0, i + 1);
  }
  hits.push({ f, line, count });
}

if (hits.length === 0) {
  console.log(`✅ no-raw-nul: ${files.length} 个文本源文件，零裸 NUL`);
  process.exit(0);
}

console.error(`❌ no-raw-nul: ${hits.length} 个文件含裸 NUL 字节 —— git 会把它们当二进制，diff 不可复审`);
for (const h of hits) console.error(`   ${h.f}:${h.line}  （共 ${h.count} 处）`);
console.error("");
console.error("修法：把裸字节换成等价转义（行为逐字节不变，diff 恢复可读）——");
console.error("   TS/JS 模板串或字符串里写 \\u0000，例如 `${a}\\u0000${b}`");
process.exit(1);
