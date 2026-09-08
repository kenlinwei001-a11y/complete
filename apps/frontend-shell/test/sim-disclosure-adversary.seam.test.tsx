/**
 * WO-ADVERSARY-ONSCREEN 接缝门 —— **对抗方读侧上屏** × 真后端回包。
 *
 * ── 今天的行为 X / 应该的 Y（本单立单依据·实测非推测）──────────────────────────
 * **X**：对抗方（客户被成本转嫁压过容忍线 ⇒ 砍单）这条链路**后端整条通了**：
 *   规则已种（`demo_customer_reaction_cut_order`）、引擎已算、披露层已把
 *   `rules.adversary` 与逐规则的还手字段一并下发。而**前端一个字都不读** ——
 *   全仓 `apps/frontend-shell/src` 搜 `adversary` 命中 **0**
 *   （金丝雀：同一把尺子量 `appliedDays` 命中 3 ⇒ 量法是好的）。
 *   ⇒ 「对方会怎么反应」今天**算了，但没有任何人看得见**。
 * **Y**：披露面板必须给出对抗方一栏，且**四态各说各的话**（见下 §1）。
 *
 * ── 夹具 = 真后端三次真跑的原样回包 ────────────────────────────────────────
 * `fixtures/sim-disclosure.adversary.real.json` 的三个键，各是内存态 datacore
 * （`SEED_DEMO=1` · seed 42 · demo 租户 · 20 家客户全体拨 `receivablePressure`）
 * 经 `POST /a/v1/sim/sessions/{id}/tick?disclose=1` 拿到的 `disclosure` 段，一个字节没改：
 *   · `off`        —— 缺省态。对抗方是**暗发关闭**的世界层功能 ⇒ `enabled:false` + `suppressed:1`
 *   · `noReaction` —— 经租户 override 开启、但扰动**低于**容忍线（1 < 12）⇒ `fired:0`
 *   · `reacted`    —— 开启且**越过**容忍线（96 > 12）⇒ `fired:1` · 20 家客户越线
 * ⇒ 后端哪天改了字段名或少给一项，这里当场红；手写夹具做不到这一点
 *   （手写的会跟着前端一起改，两边一起漂还一起绿）。
 *
 * ── 本门咬的是**四态可分辨**，不是「字段渲染出来了」───────────────────────────
 * 判据原文（一字不改）：
 * > `无对抗方数据` 与 `对抗方反应为 0` **是两个结论，不许在屏上长成一样**。
 * 故每条断言都成对：**这一态要出现的话** + **另一态那句话不许出现**。
 * 只断言「有没有渲染」验不到这件事 —— 四态全渲染成 `0 项` 也能全绿。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ADVERSARY_MOVE_REGISTRY, type SimRunDisclosure } from "@platform/contracts";
import DisclosurePanel from "@/views/sim/unified/rail/DisclosurePanel";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(
  readFileSync(join(TEST_DIR, "fixtures/sim-disclosure.adversary.real.json"), "utf8"),
) as { off: SimRunDisclosure; noReaction: SimRunDisclosure; reacted: SimRunDisclosure };
/** 这一份**没有** `rules.adversary`（2026-09-03 抓的，早于该字段）⇒ 天然是 `ABSENT` 态的真样本。 */
const PRE_FIELD = JSON.parse(
  readFileSync(join(TEST_DIR, "fixtures/sim-disclosure.real.json"), "utf8"),
) as SimRunDisclosure;

/**
 * 整块渲染开（含二层 `<details>`），返回屏上全部可见文本。
 *
 * ⚠ **必须 `unmount()`**：同一个 `describe` 里连渲四态时，不卸载会让四份 DOM 同时挂在
 * 同一个 body 上 ⇒ `getByTestId` 报「找到多个」，而且 `not.toContain` 会被**别一态的文本**
 * 意外满足 —— 那是「测试自己坏了」冒充「产品对了」，比红更坏。
 */
function screenText(d: SimRunDisclosure): string {
  const { container, unmount } = render(<DisclosurePanel disclosure={d} />);
  container.querySelectorAll("details").forEach((el) => el.setAttribute("open", ""));
  const text = container.textContent ?? "";
  unmount();
  return text;
}
function stateOf(d: SimRunDisclosure): string {
  const { unmount } = render(<DisclosurePanel disclosure={d} />);
  const s = screen.getByTestId("sim-disclosure-adversary").getAttribute("data-state") ?? "";
  unmount();
  return s;
}

describe("§0 夹具自证（金丝雀先行 —— 不然下面全是废话）", () => {
  it("三份夹具的对抗方读数确实两两不同", () => {
    const a = REAL.off.rules.adversary;
    const b = REAL.noReaction.rules.adversary;
    const c = REAL.reacted.rules.adversary;
    // 三份若相同 ⇒ 取证时开关没真的切换过，下面所有对照全是自欺。
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(c));
    // 四个数（铁律 1.5 判据一）—— 缺一个都不算交付。
    expect(a.enabled, "缺省态必须是关的（暗发）").toBe(false);
    expect(a.suppressed, "关闭态必须点名挂起了几条，不许留白").toBeGreaterThan(0);
    expect(b.enabled).toBe(true);
    expect(b.fired, "低于容忍线 ⇒ 一条都不许还手").toBe(0);
    expect(c.fired, "越过容忍线 ⇒ 必须真的还手").toBeGreaterThan(0);
    expect(c.triggeredActors, "越线对手数为 0 ⇒ 这一格没验到东西").toBeGreaterThan(0);
  });

  it("旧夹具确实没有这一栏（= ABSENT 态的真样本，不是我编的）", () => {
    expect("adversary" in (PRE_FIELD.rules as object)).toBe(false);
  });
});

describe("§1 四态在屏上必须各说各的话（本单的要害）", () => {
  it("四态判定各不相同", () => {
    expect(stateOf(PRE_FIELD)).toBe("ABSENT");
    expect(stateOf(REAL.off)).toBe("ONE_SIDED");
    expect(stateOf(REAL.noReaction)).toBe("NO_REACTION");
    expect(stateOf(REAL.reacted)).toBe("REACTED");
  });

  it("ABSENT：说「未取到」，⛔ 不许渲染成一片 0", () => {
    const t = screenText(PRE_FIELD);
    expect(t).toContain("未取到对抗方回执");
    // 反面：不许把「没取到」说成「对手没还手」——那是拿缺席冒充结论。
    expect(t).not.toContain("单方推演");
    expect(t).not.toContain("无人越过容忍线");
  });

  it("ONE_SIDED：说「单方推演」+ 挂起条数，⛔ 不许说成「对手没还手」", () => {
    const t = screenText(REAL.off);
    expect(t).toContain("单方推演");
    expect(t).toContain(`挂起还手规则 ${REAL.off.rules.adversary.suppressed} 条`);
    // 要害：关闭态与「开了但没人越线」**必须**分得开。
    expect(t, "关闭态说成『无人越过容忍线』= 把「对手没上场」冒充「对手没动手」").not.toContain(
      "无人越过容忍线",
    );
    expect(t).not.toContain("未取到对抗方回执");
  });

  it("NO_REACTION：说「无人越过容忍线」，⛔ 不许长成 ONE_SIDED 或一张 0 项空表", () => {
    const t = screenText(REAL.noReaction);
    expect(t).toContain("无人越过容忍线");
    expect(t).toContain("在册还手规则 1 条");
    expect(t, "开着却说『单方推演』= 谎报对手缺席").not.toContain("单方推演");
    expect(t).not.toContain("未取到对抗方回执");
  });

  it("REACTED：给出动作 · 越线对手数 · 选择方", () => {
    const t = screenText(REAL.reacted);
    const a = REAL.reacted.rules.adversary;
    expect(t).toContain("砍单"); // 人话名，⛔ 屏上不许只显裸键
    expect(t).toContain(`本拍还手 ${a.fired} 条`);
    expect(t).toContain(`越线对手 ${a.triggeredActors} 个`);
    expect(t).toContain("规则表直选"); // 「这一步没有模型参与」必须明写，不许留白
    expect(t).not.toContain("无人越过容忍线");
    expect(t).not.toContain("单方推演");
  });

  it("收起态就能看见对抗方结论（不必点开两层）", () => {
    for (const [d, want] of [
      [PRE_FIELD, "对抗方未取到"],
      [REAL.off, "单方推演"],
      [REAL.noReaction, "对抗方未越线"],
      [REAL.reacted, "对抗方还手 1 条"],
    ] as const) {
      const { unmount } = render(<DisclosurePanel disclosure={d} />);
      expect(screen.getByTestId("sim-disclosure-adversary-flag").textContent).toBe(want);
      unmount();
    }
  });
});

describe("§2 可披露层：一个看不到代码的人能自己判断这是真推演还是查表", () => {
  it("还手边逐项给出 系数 · 容忍线 · 分摊口径 · 走的那条链", () => {
    const t = screenText(REAL.reacted);
    const item = REAL.reacted.rules.items.find((i) => i.isReaction)!;
    expect(item, "夹具里没有还手边 ⇒ 取证跑错了，不是前端没渲染").toBeTruthy();
    expect(t).toContain(item.ruleKey); // 规则 key 是业务事实，必须给
    expect(t).toContain(String(item.coefficient)); // 系数
    expect(t).toContain(String(item.reactionTolerance)); // 阈值
    expect(t).toContain(item.weightBasis!); // 分摊口径
    expect(t).toContain(item.via); // 走的那条链
    expect(t).toContain("对手还手"); // 与物理传导边分得开
  });

  it("还手边与物理传导边在同一张表里标记不同", () => {
    render(<DisclosurePanel disclosure={REAL.reacted} />);
    const rows = screen.getByTestId("sim-disclosure-rule-items").querySelectorAll("li");
    const reaction = [...rows].filter((r) => r.getAttribute("data-reaction") === "1");
    const physical = [...rows].filter((r) => r.getAttribute("data-reaction") === "0");
    // 金丝雀：物理边必须占绝大多数（46 条边里只有 1 条是还手）——
    // 两边条数若接近，说明标记打错了，不是数据长这样。
    expect(physical.length, "物理边为 0 ⇒ 标记反了").toBeGreaterThan(10);
    expect(reaction.length).toBe(REAL.reacted.rules.adversary.declared);
  });

  it("规则表直选 ⇒ 不许打出「选择出处」（留空串会读起来像编排层参与过）", () => {
    const item = REAL.reacted.rules.items.find((i) => i.isReaction)!;
    expect(item.reactionSelectorRef, "夹具前提：规则表直选恒 null").toBeNull();
    expect(screenText(REAL.reacted)).not.toContain("选择出处");
  });

  it("动作人话名取自契约登记册，前端不另抄一份表", () => {
    // 登记册加了第四种动作，屏上必须跟着变 —— 抄一份表就做不到。
    const moves = REAL.reacted.rules.adversary.moves;
    for (const k of moves) {
      const reg = ADVERSARY_MOVE_REGISTRY.find((m) => m.key === k);
      expect(reg, `${k} 不在登记册里 ⇒ 后端产出了在册外的动作`).toBeTruthy();
      expect(screenText(REAL.reacted)).toContain(reg!.name);
    }
  });
});

describe("§3 文体硬约束（同既有披露门，新增这一栏一样要守）", () => {
  it("⛔ 屏上无 Markdown 字面量 / 源码文件名 / 行号", () => {
    for (const d of [REAL.off, REAL.noReaction, REAL.reacted]) {
      const t = screenText(d);
      // 金丝雀：扫法要能抓到人为注入的违规，否则「扫不出来」与「真的没有」一模一样。
      expect("**粗体**".match(/\*\*/)).toBeTruthy();
      expect(t.match(/\*\*/), "屏上出现 Markdown 粗体字面量").toBeNull();
      expect(t.match(/`/), "屏上出现反引号").toBeNull();
      expect(t.match(/\.tsx?:\d+/), "屏上出现源码文件名 + 行号（R-UI-4）").toBeNull();
    }
  });

  it("⛔ 屏上无排期语汇（工单 / WO / 本单）", () => {
    for (const d of [REAL.off, REAL.noReaction, REAL.reacted]) {
      const t = screenText(d);
      expect(t.match(/工单|本单|\bWO-/), "屏上出现排期语汇").toBeNull();
    }
  });
});
