import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * X1 单源守卫 —— `summary` 上限三处必须相等（审核方 2026-08-09 裁决）。
 *
 * **病史**：契约 `max(400)` · lint `SUMMARY_MAX=200` · 前端 `maxLength={400}` 三处各写各的。
 * 后果不是抽象的：用户在界面上写到 350 字**保存成功**，点发布**被 lint 拒**，
 * 而界面从不告诉他真正的上限是多少 —— 编辑期与发布期口径不一致造成的返工。
 *
 * **为什么不照 `body` 的两层治理办**（契约 50000 / lint 3000，SPEC §9.3 明确的设计）：
 * `summary` 会被逐条注入 system prompt（`agent/prompts.ts` 的 `- [id] name: summary`），
 * 长度直接吃 token 预算且随 skill 数量线性放大 —— 它是**运行期成本字段**，
 * 不是「存得下就行」的字段。lint 自己的报错文案就写着「summary 是触发器不是简介」。
 *
 * **本测试咬的是「三个数相等」这件事本身**，不是某个具体的值 ——
 * 将来产品要把 200 改成别的数，改三处即可，本测试不拦；只拦「只改了其中一两处」。
 */

const REPO = resolve(__dirname, "../../..");

/** 抽取器与金丝雀共用同一份实现（不许各抄一份正则 —— 抄了就是装饰品）。 */
function extractNumber(relPath: string, re: RegExp): number | null {
  const src = readFileSync(resolve(REPO, relPath), "utf8");
  const m = src.match(re);
  return m?.[1] ? Number(m[1]) : null;
}

const SITES = [
  { name: "契约 SkillDefinitionSchema.summary", path: "packages/contracts/src/agentcore.ts", re: /summary:\s*z\.string\(\)\.max\((\d+)\)/ },
  { name: "lint SUMMARY_MAX", path: "apps/agentcore/src/skill-lint.ts", re: /SUMMARY_MAX\s*=\s*(\d+)/ },
  { name: "前端 SkillsPage textarea", path: "apps/frontend-shell/src/pages/admin/SkillsPage.tsx", re: /aria-label="summary"[^>]*|maxLength=\{(\d+)\}[^>]*aria-label="summary"/ },
] as const;

describe("X1 · summary 上限三处单源", () => {
  it("金丝雀：三个抽取点都能抽到数（抽不到 = 抽取器坏了，不是「代码干净」）", () => {
    const contract = extractNumber(SITES[0].path, SITES[0].re);
    const lint = extractNumber(SITES[1].path, SITES[1].re);
    const fe = extractNumber(SITES[2].path, /maxLength=\{(\d+)\}[^>]*aria-label="summary"/);
    // 三个都必须是数字。任一为 null ⇒ 锚点漂了或文件改了形状 ⇒ 报「工具坏了」而非放行。
    expect(contract, "契约侧抽不到 summary 上限 —— 锚点漂了，先修抽取器再谈结论").not.toBeNull();
    expect(lint, "lint 侧抽不到 SUMMARY_MAX —— 锚点漂了").not.toBeNull();
    expect(fe, "前端侧抽不到 textarea 的 maxLength —— 锚点漂了").not.toBeNull();
  });

  it("三处上限必须相等（只改其中一两处 = 本测试变红）", () => {
    const contract = extractNumber(SITES[0].path, SITES[0].re);
    const lint = extractNumber(SITES[1].path, SITES[1].re);
    const fe = extractNumber(SITES[2].path, /maxLength=\{(\d+)\}[^>]*aria-label="summary"/);
    expect(
      { contract, lint, frontend: fe },
      "summary 上限三处不一致 —— 用户会遇到「编辑期能存、发布期被拒」，三处必须同改",
    ).toEqual({ contract: lint, lint, frontend: lint });
  });
});
