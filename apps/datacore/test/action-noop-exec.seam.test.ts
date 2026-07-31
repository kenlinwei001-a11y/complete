import { describe, expect, it } from "vitest";
import { ACTION_WIRING, UnwiredActionExecutor, MockActionExecutor, planChangeIsWired } from "../src/actions.js";
import type { ActionDraft } from "../src/domain.js";

/**
 * G-ACTION-NOOP-EXEC 收口 · **效果层**断言（不是 `ok:true` 那种运输断言）。
 *
 * 病灶：`app.ts domainExecutor` 只有 7 个分支，未覆盖者落 `MockActionExecutor` →
 * 返回 `MO-2026-${hashString(draft.id)%9000}` —— **哈希编出来的假工单号，形态与真 MO 一模一样**。
 * 于是「审批通过」与「真的写了」在界面/审计里**完全无法分辨**；而 `mapping.ts:85` 还声称
 * 「采纳产能保障方案 → target: 生产工单MO（写回）」。R4「真值经 Action」在最深处被架空。
 *
 * 这解释了用户反复追问的「为何点了采纳，结论/内容什么都不变」——
 * 另一半病根是 `discoverLevers` 丢弃 scopeObjectIds（拖的是别人家的工序）。
 *
 * 本测的头号判据：**未接线动作绝不产出看起来像真的成功**。
 */

const draftOf = (actionTypeKey: string, payload: Record<string, unknown> = {}): ActionDraft =>
  ({ id: `act_${actionTypeKey}_1`, tenantId: "t1", actionTypeKey, payload, status: "APPROVED" }) as unknown as ActionDraft;

/** 真 MO 号形态：`MO-` + 4 位数字。假单号正是照这个形态编的。 */
const looksLikeRealMo = (s: string | undefined): boolean => /^MO-\d{4}/.test(String(s ?? "")) || /^MO-2026-\d+/.test(String(s ?? ""));

describe("G-ACTION-NOOP-EXEC · 未接线动作不得冒充已执行", () => {
  it("头号断言：未实现的动作**不返回成功**，且绝不产出 MO 形态的 targetRef", async () => {
    const ex = new UnwiredActionExecutor();
    for (const key of ["adopt_mitigation", "采纳经营方案", "采纳产能保障方案"]) {
      const r = await ex.execute(draftOf(key));
      expect(r.ok, `「${key}」未接执行器却返回 ok:true —— 假成功会被当成事实沉淀进决策`).toBe(false);
      expect(
        looksLikeRealMo(r.targetRef),
        `「${key}」产出了 MO 形态的 targetRef「${r.targetRef}」—— 假单号与真单号不可分辨正是本断点的病灶`,
      ).toBe(false);
      expect(r.error, `失败必须带可识别错误码，否则前端/审计无法区分"没接"与"执行出错"`).toContain(
        "EXECUTOR_NOT_IMPLEMENTED",
      );
    }
  });

  it("反证：旧兜底 MockActionExecutor 确实产出 MO 形态假单号（病灶存在性·非臆断）", async () => {
    const r = await new MockActionExecutor().execute(draftOf("采纳产能保障方案"));
    expect(r.ok).toBe(true);
    expect(
      looksLikeRealMo(r.targetRef),
      "若此断言变假，说明 MockActionExecutor 已改口径——本测的病灶描述需同步更新",
    ).toBe(true);
  });

  it("plan_change 只有 global-sim 来源算接线；其余来源不得借 WIRED 之名假装写了", () => {
    expect(planChangeIsWired({ source: "global-sim" })).toBe(true);
    expect(planChangeIsWired({ source: "order-chain" })).toBe(false);
    expect(planChangeIsWired({})).toBe(false);
    expect(planChangeIsWired(undefined)).toBe(false);
  });

  it("归类表诚实性：NOT_IMPLEMENTED 不得被悄悄改成 NO_WRITE 掩盖欠账", () => {
    // NO_WRITE 语义 = **设计上**不写真值（如纯审计动作）。把欠账标成 NO_WRITE 会让门变绿而问题仍在，
    // 且比 NOT_IMPLEMENTED 更难发现——因为它看起来"已经想清楚了"。
    // 这三条在 mapping.ts / decision-kernel 里都有明确的写回意图，只能是欠账。
    for (const key of ["adopt_mitigation", "采纳经营方案", "采纳产能保障方案"]) {
      expect(
        ACTION_WIRING[key],
        `「${key}」在 mapping.ts/decision-kernel 里有明确写回意图，标成 ${ACTION_WIRING[key]} 会掩盖欠账`,
      ).toBe("NOT_IMPLEMENTED");
    }
  });

  it("NO_WRITE 若被使用，targetRef 必须显式自证无写入（不许空字符串蒙混）", async () => {
    const ex = new UnwiredActionExecutor();
    const spy = { ...ACTION_WIRING };
    try {
      (ACTION_WIRING as Record<string, string>).__probe_no_write__ = "NO_WRITE";
      const r = await ex.execute(draftOf("__probe_no_write__"));
      expect(r.ok).toBe(true);
      expect(r.targetRef).toContain("NO_WRITE");
      expect(looksLikeRealMo(r.targetRef)).toBe(false);
    } finally {
      delete (ACTION_WIRING as Record<string, string>).__probe_no_write__;
      expect(Object.keys(ACTION_WIRING).sort()).toEqual(Object.keys(spy).sort());
    }
  });
});
