import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MODULE_KINDS, MODULE_KIND_REGISTRY } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";

/**
 * WO-DBUI-13-NEEDS · 第 ② 步「显示目前缺少的信息」——接缝驱动测试（前端半）。
 *
 * ══ 接缝在哪 ══════════════════════════════════════════════════════════════════
 * **后端干跑回执的逐类清单 → 屏上 13 类各自的那句话**。
 * 所以本文件不隔离渲染组件，而是从**真入口**走：登录 → 进数据构建页 →
 * 在脚本框里打字 → 点「开始」→ 等第 ② 步。任一半漏（后端不发 / 前端不读 / 字段改名）即红。
 *
 * ══ 最要害的一条 ══════════════════════════════════════════════════════════════
 * 「查不到」和「不缺」在屏上**必须长得不一样**。
 * 建之前，7 类跨系统需求的现状真的查不到；若照老逻辑默认成「本次新建 N」，
 * 或者干脆渲染成「复用 0 · 待建 0」，看的人都会读成**已经清点过了**。
 * §3 咬死：这几类屏上出现的是「要等创建时才知道」，且**不出现 0 这个数**。
 *
 * ⛔ 同时咬「13 个标题不算显示了 13 类」：每一类都必须有**非空且互不相同**的结论文案，
 *    光有标题、结论是空串的，§2 当场红。
 */

const CROSS_KINDS = ["intent", "plan", "workflow", "skill", "agent", "scene", "mcp"];

/** 从真入口走到第 ② 步（输入脚本 → 开始 → 逐类清点出现）。 */
async function reachStepTwo() {
  const user = userEvent.setup();
  loginAs("planner");
  renderApp("/admin/data-builder");
  await screen.findByTestId("data-builder-page");

  // ① 真的在脚本框里打字（不是直接调 mutation）—— 这才是「经真入口驱动」
  const script = screen.getByTestId("dbf-script") as HTMLTextAreaElement;
  await user.clear(script);
  await user.type(script, "常州基地产能紧张，影响订单交期与客户信用");
  await user.click(screen.getByTestId("dbf-start"));

  const needs = await screen.findByTestId("dbf-needs", undefined, { timeout: 5000 });
  return { user, needs };
}

describe("WO-DBUI-13-NEEDS · 第 ② 步逐类清点（接缝：干跑回执 → 屏上 13 类）", () => {
  it("§1 13 类逐类上屏，一类不少 —— 且每一类的名字是人话，不是内部键名", async () => {
    const { needs } = await reachStepTwo();

    for (const kind of MODULE_KINDS) {
      within(needs).getByTestId(`dbf-need-${kind}`); // 这一类的卡片在屏上（不在即抛）
      const label = MODULE_KIND_REGISTRY.find((m) => m.kind === kind)!.label;
      /*
       * ⚠ 判据落在**类名那一行**，不是整张卡片。
       *   第一版写成「整张卡片的文本里不许出现 `kind`」，被自己的用例当场证伪：
       *   条目键 `plan_risk_inference` 含 "plan" —— 那是**用户要看的数据**（缺的就是这一条），
       *   不是内部黑话。拿「卡片里出现了这个串」当「内部键名上屏了」的证据，
       *   度量的根本不是同一件事。
       */
      const heading = within(needs).getByTestId(`dbf-need-label-${kind}`);
      expect(heading.textContent, `${kind} 的类名没用人话`).toBe(label);
    }
  });

  it("§2 每一类都**说得出话**：结论非空 —— 13 个空标题不算「显示了 13 类」", async () => {
    const { needs } = await reachStepTwo();

    const verdicts = MODULE_KINDS.map((kind) => {
      const v = within(needs).getByTestId(`dbf-need-verdict-${kind}`);
      return (v.textContent ?? "").trim();
    });
    // 金丝雀：真取到了 13 条文案，不是空数组恒真
    expect(verdicts.length).toBe(MODULE_KINDS.length);
    for (const [i, text] of verdicts.entries()) {
      expect(text.length, `第 ${i + 1} 类的结论是空的（空壳冒充「显示了」）`).toBeGreaterThan(0);
    }
    // 不许所有类都是同一句话（那等于什么都没说）
    expect(new Set(verdicts).size).toBeGreaterThan(1);
  });

  it("§3 【要害】查不到的那几类**明说查不到**，不渲染成 0（0 会被读成「不缺」）", async () => {
    const { needs } = await reachStepTwo();

    // 屏上先集中点名一次（散在卡片里容易被漏读）
    const unprobed = within(needs).getByTestId("dbf-needs-unprobed");
    expect(unprobed.textContent).toContain("还查不出");

    // 金丝雀：这一屏真的存在「查不到」的类，否则下面整段是空转恒真
    const unknownCards = CROSS_KINDS
      .map((k) => within(needs).getByTestId(`dbf-need-${k}`))
      .filter((c) => c.getAttribute("data-evidence") === "NOT_PROBED");
    expect(unknownCards.length).toBeGreaterThan(0);

    for (const card of unknownCards) {
      const kind = card.getAttribute("data-testid")!.replace("dbf-need-", "");
      const verdict = within(card).getByTestId(`dbf-need-verdict-${kind}`).textContent ?? "";
      // 明说：这一刻不知道
      expect(verdict, `${kind} 没说清「现在查不到」`).toContain("要等创建时才知道");
      // 且**不摆出 0** —— 「复用 0 / 待建 0」会被读成「已经清点过、不缺」
      expect(verdict, `${kind} 把「查不到」渲染成了 0`).not.toMatch(/0/);
      // 点开看到的每一条也必须标「现状查不到」，不是「本次新建」
      const detail = within(card).getByTestId(`dbf-need-detail-${kind}`);
      expect(detail.textContent).toContain("现状查不到");
      expect(detail.textContent).not.toContain("本次新建");
    }
  });

  it("§4 查得到的那几类给的是**真数**：复用 / 待建 / 建不出 分得开", async () => {
    const { needs } = await reachStepTwo();

    // 本体对象类型：库里已有 Order（复用），其余待建 —— 「复用了既有的」正是"人不清楚库里现状"的正面回答
    const types = within(needs).getByTestId("dbf-need-ontology_type");
    expect(types.getAttribute("data-evidence")).toBe("PROBED");
    expect(within(types).getByTestId("dbf-need-verdict-ontology_type").textContent).toMatch(/复用 1/);
    expect(within(types).getByTestId("dbf-need-item-ontology_type-Order").textContent).toContain("库里已有");

    // 求解器是代码、不能自动建 ⇒ 缺的那个必须说「建不出来」，不能混进「待建」
    const solver = within(needs).getByTestId("dbf-need-solver");
    expect(within(solver).getByTestId("dbf-need-verdict-solver").textContent).toMatch(/建不出 1/);
    expect(within(solver).getByTestId("dbf-need-item-solver-credit_exposure").textContent).toContain("建不出来");

    // 本次用不到的类也要说话（needed=0 是一个确定的答案，不是空壳）
    const mcp = within(needs).getByTestId("dbf-need-mcp");
    expect(mcp.getAttribute("data-needed")).toBe("0");
    expect(within(mcp).getByTestId("dbf-need-verdict-mcp").textContent).toContain("本次用不到");
  });

  it("§5 「缺几个」在第一层，「缺哪几个」点开才看 —— 明细确实挂在折叠里", async () => {
    const { needs } = await reachStepTwo();

    const types = within(needs).getByTestId("dbf-need-ontology_type");
    const detail = within(types).getByTestId("dbf-need-detail-ontology_type");
    // 明细的宿主是原生折叠（第二层），不是直接摊在第一层
    expect(detail.tagName.toLowerCase()).toBe("details");
    expect((detail as HTMLDetailsElement).open).toBe(false);
    // 结论那一行**不在**折叠里（它属于第一层）
    expect(detail.contains(within(types).getByTestId("dbf-need-verdict-ontology_type"))).toBe(false);
    // 点开之后逐条可见，且每条都带现状
    expect(within(detail).getByTestId("dbf-need-item-ontology_type-Base").textContent).toContain("本次新建");
  });
});
