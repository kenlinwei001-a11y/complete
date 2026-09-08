import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { OUTSOURCE_REDLINE, outsourceRedlineConstraintExpr, outsourceRedlineViolationExprPublished, ruleParamRef } from "@platform/contracts";
import { RULES, RULE_CANDIDATES } from "@/mocks/fixtures";
import { mockCapacityForecast } from "@/mocks/simSolvers";

/**
 * WO-RULE-EXPR-PARAMS · 前端半（欠账 #78）：**mock 规则库与真后端同口径**。
 *
 * ── 病灶（真实·测试全绿盖住了）─────────────────────────────────────────────
 * `mocks/fixtures.ts RULES` 与真后端 `datacore synthetic/battery.ts BATTERY_RULES` 是**系统性不同口径**：
 * mock 写的是人读的**约束式**（`Order.demandDelta <= 0.5`「必须不超过」），后端写的是规则引擎吃的
 * **违规谓词**（`> 0.5`，为真 ⇒ passed=false）。两者**极性相反**：照 mock 那套喂引擎，
 * 合规订单全报违规、越线订单全部放行。外加主体丢失/中译（C08 `Outsource.ratio`、
 * C05 `产线.utilization` —— `产线` 不是任何已注册对象类型 key）。
 *
 * ── 哪边对：后端 ──────────────────────────────────────────────────────────
 * 不是"后端更权威"，而是契约 `base-registry.ts` 对两种渲染有明文分工：
 * `outsourceRedlineViolationExpr*` 喂规则引擎、`outsourceRedlineConstraintExpr` 只用于文档原文/
 * A2 抽取候选。本表是**已发布规则** ⇒ 必须是违规谓词式。
 *
 * ── 本文件怎么"驱动接缝"而不是各测各半 ────────────────────────────────────
 * 前端不得 import datacore 源码（contracts-only-shared），所以接缝锚点选**两端共用的契约出口**
 * 与**前端内部两份规则表达式的互证**：
 *   ① C08 必须逐字节等于 `outsourceRedlineViolationExprPublished()` —— 后端 battery.ts 用的是同一个出口，
 *      二者同源即同字面；谁改一边，另一边自动跟着变（不是手抄副本）。
 *   ② 同一规则码在 `RULES`（规则库）与 `simSolvers` 的 `evaluatedRules`（求解器留痕）里必须**同一表达式**
 *      —— 这条正是当初咬出病灶的那条：fixtures 写 `<= 0.5`、simSolvers 写 `> 0.5`，前端自己内部都不自洽。
 *   ③ 阈值只存 params 一处：声明了命名阈值的规则，其 expression 不得再出现该值的字面量副本。
 */

/** `RULES` 里每条规则表达式引用的对象类型前缀（`Order.qty` → Order；忽略 params./user. 命名空间）。 */
function objectTypePrefixes(expression: string): string[] {
  const out: string[] = [];
  for (const m of expression.matchAll(/([A-Za-z_À-￿][A-Za-z0-9_À-￿]*)\.[A-Za-z_][A-Za-z0-9_]*/g)) {
    const head = m[1] as string;
    if (head === "params" || head === "user") continue;
    out.push(head);
  }
  return out;
}

describe("WO-RULE-EXPR-PARAMS · 前端 mock 规则库与后端同口径（#78）", () => {
  it("C08 逐字节等于契约的发布态违规谓词（与后端同一个出口，不是手抄副本）", () => {
    const c08 = RULES.find((r) => r.key === "C08");
    expect(c08?.expression).toBe(outsourceRedlineViolationExprPublished());
    // 极性反证：绝不能等于文档约束式（那是 A2 抽取候选的口径，极性相反）。
    expect(c08?.expression).not.toBe(outsourceRedlineConstraintExpr(OUTSOURCE_REDLINE.subject));
    expect(c08?.expression).not.toContain("<=");
    // 主体是真对象类型字段（此前是 `Outsource.ratio` —— 后端从来没有这个主体）。
    expect(c08?.expression).toContain(OUTSOURCE_REDLINE.subject);
    // 阈值只存 params 一处。
    expect(c08?.params?.[OUTSOURCE_REDLINE.paramKey]).toBe(OUTSOURCE_REDLINE.maxRatio);
    expect(c08?.expression).not.toContain(String(OUTSOURCE_REDLINE.maxRatio));
  });

  it("规则库与求解器留痕对同一规则码给出同一表达式（前端内部自洽 —— 当初就是这条不成立）", () => {
    const fromSolver = mockCapacityForecast({ modelId: "4680-NCM", qty: 40, weeks: 6 }) as {
      evaluatedRules: { key: string; expression: string }[];
    };
    const libByKey = new Map(RULES.map((r) => [r.key, r.expression]));
    const shared = fromSolver.evaluatedRules.filter((r) => libByKey.has(r.key));
    expect(shared.length, "两份 mock 应至少共享一条规则码，否则本断言空跑").toBeGreaterThan(0);
    for (const r of shared) {
      expect(r.expression, `${r.key} 在规则库与求解器留痕里是两套写法`).toBe(libByKey.get(r.key));
    }
  });

  it("已发布规则一律违规谓词口径：不出现约束式写法（`<=` 对常量阈值）", () => {
    for (const r of RULES) {
      expect(r.expression, `${r.key} 像是约束式（人读「不得超过」），规则引擎会把判定反过来`).not.toMatch(/<=\s*[\d.]+\s*$/);
    }
  });

  it("对象类型前缀必须是真类型名，不得中译（C05 曾写成 `产线.utilization` ⇒ 永远解析不到 = 哑弹）", () => {
    for (const r of RULES) {
      for (const prefix of objectTypePrefixes(r.expression)) {
        expect(/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix), `${r.key} 的对象类型前缀 \`${prefix}\` 不是合法类型 key`).toBe(true);
      }
    }
    expect(RULES.find((r) => r.key === "C05")?.expression).toBe("SUSTAIN(Line.utilization > 95, 3)");
  });

  it("命名阈值只存 params 一处：expression 引用 `params.<名>`，不复写字面量", () => {
    const c09 = RULES.find((r) => r.key === "C09");
    expect(c09?.expression).toContain(ruleParamRef("staleHours"));
    expect(c09?.expression).not.toMatch(/lagHours\s*>\s*\d/); // 曾是 `> 2`（params 之外的第二份）
    expect(c09?.params?.staleHours).toBe(2);
    // 后端刻意删掉的 normalFactor 不得在 mock 里复活（`health.normal` 归 M11 校准参数所有）。
    expect(c09?.params?.normalFactor).toBeUndefined();
  });

  it("A2 抽取候选**保持**约束式（文档原文口径）—— 别顺手统一，两种渲染各有其位", () => {
    const cand = RULE_CANDIDATES.find((c) => c.candidate.expression.includes("Outsource.ratio"));
    expect(cand?.candidate.expression).toBe(outsourceRedlineConstraintExpr("Outsource.ratio"));
  });
});

describe("WO-RULE-EXPR-PARAMS · 前端展示随口径改变（消费方真的跟着变）", () => {
  it("规则库页面展开行显示的是修正后的表达式（用户看到的就是引擎真吃的那句）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    // 展开 C08：用户可见的那句必须是违规谓词 + 命名阈值引用（不是文档约束式、不含裸阈值）。
    await user.click(screen.getByTestId("rule-C08"));
    const c08Text = await screen.findByText(outsourceRedlineViolationExprPublished());
    expect(c08Text).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(outsourceRedlineConstraintExpr("Outsource.ratio"));

    // 展开 C05：对象类型前缀是 Line 而非中译的 `产线`。
    await user.click(screen.getByTestId("rule-C05"));
    expect(await screen.findByText("SUSTAIN(Line.utilization > 95, 3)")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain("产线.utilization");
  });
});
