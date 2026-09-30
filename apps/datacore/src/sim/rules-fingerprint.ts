/**
 * 规则集的**内容指纹** —— 「这套规则变了没有」的唯一判据。
 *
 * ── 为什么单独成文件，而不是各写一份 ──────────────────────────────────────────
 * 两个地方都要这条判据：影子线备忘录（`shadow-memo.ts`）与装配备忘录（`assembly-memo.ts`）。
 * 各写一份 = **两套真相源**：将来给 `PropagationRule` 加一个字段，
 * 改了 A 忘了 B，B 那一侧就会「规则明明变了却仍然命中」——
 * 拿旧规则算出来的数当成新规则的结果，**屏上看不出来**（本仓反复栽的那种静默错答）。
 * 与 `seed-world.ts::listSimWorldObjects` 收编「成员判据被手抄 5 份」是同一条纪律。
 *
 * ⚠ 指纹**只覆盖引擎真正读到的那几个字段**：`PropagationRule` 上的 `params` 不在这里
 *   —— 它经 `ruleParams` 那张表进引擎，由 `shadowFingerprint` 单独哈希。
 */

import { createHash } from "node:crypto";
import type { PropagationRule } from "@platform/contracts";

// ⚠ 分隔符的值是一个 NUL（U+0000）——**必须写成转义**，不许写成字面 NUL 字节：
//   字面 NUL 会让 git 把本文件判成 binary（`git diff` 只剩「Binary files differ」）、
//   grep 也只回「Binary file matches」⇒ 这个文件的每一次改动都没人能看见。
//   同一个坑在 `shadow-memo.ts` 上真实发作过一次（该文件头注有病历）。
const SEP = "\u0000";

/** 逐字段哈希一条规则的**全部**入参字段；顺序即语义的一部分（宁可多算，不可错复用）。 */
export function rulesFingerprint(rules: readonly PropagationRule[]): string {
  const h = createHash("sha256");
  h.update(`r${rules.length}${SEP}`);
  for (const r of rules) {
    h.update(
      `${r.key}${SEP}${String(r.coefficient)}${SEP}${String(r.delayTicks)}${SEP}${r.combine}${SEP}` +
        `${String(r.decay)}${SEP}${JSON.stringify(r.clamp)}${SEP}${String(r.coefficientRef)}${SEP}` +
        `${String(r.cadenceNodeId)}${SEP}${r.status}${SEP}${JSON.stringify(r.reaction ?? null)}${SEP}`,
    );
  }
  return h.digest("hex");
}
