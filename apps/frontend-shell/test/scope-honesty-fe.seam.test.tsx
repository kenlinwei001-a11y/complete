import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readScopeHonesty } from "@/lib/solverScopeHonesty";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SCOPE-HONESTY-FE · **接缝门：作用域诚实位从回包走到屏幕上**
 *
 * ## 这条门守的是哪一跳
 *
 * `WO-SILENT-WRONG-ANSWER-3` 在**引擎半**把三个求解器的作用域诚实位算了出来，并在契约里声明
 * （不声明 zod 会 strip 掉 ⇒ 服务端写了、契约吞了、前端永远拿不到 = 等于没加）。
 * 那一单的门在 `apps/datacore/test/silent-wrong-answer-3.seam.test.ts`，咬的是**回包**。
 * 本文件咬的是**下一跳**：这些字段有没有真的走到用户眼前。
 *
 * 接线前的实测（金丝雀自证工具是好的，见下面第一条用例）：
 *   `grep -rn kit_readiness apps/frontend-shell/src` → 1 处（还是场景卡 fixture，不是消费方）
 *   `grep -rn quote_margin  apps/frontend-shell/src` → **0 处**
 *   `grep -rln risk_timeline apps/frontend-shell/src` → 5 个文件（金丝雀命中 ⇒ 上面两个 0/1 是真的）
 * ⇒ 引擎半全绿、契约声明齐全、而屏上一个字都没有。这正是本仓「绿测试 ≠ 能用·断在接缝」的老形态。
 *
 * ## 为什么必须从 URL 出发（只渲组件 = 假绿第 9 形态）
 *
 * 只 `render(<RiskBoardView/>)` 证明的是「拿到组件之后能画出来」，**不证明有任何东西能让你拿到它**，
 * 也不证明 `RiskTimelineOutputSchema.parse` 没把新字段 strip 掉（那一步就发生在页面里）。
 * 故本文件所有断言都从 `renderApp("/v/...")` 出发，走
 * `ViewPage → workspace 双闸 → getRenderer → 组件 → 真 MSW 回包 → 契约 parse → 屏幕`。
 *
 * ## ⚠ 收编裁决（2026-08-13 · WO-R1 从 `claude/integ-ui-w5` 捞这份文件时做的）
 *
 * 本文件原本还有一节 **§B `risk_timeline`**（4 例，咬 `risk-scope-mode` 的 BASE/ALL/未标注差分）。
 * **已整节删除**，因为 canonical 在 `e6563d1c` 已并入同一命题、且覆盖更广的实现与门：
 *   · 实现 `src/lib/solverScopeHonesty.ts` + `src/components/ScopeHonestyBadge.tsx`
 *   · 门   `test/solver-scope-honesty.seam.test.tsx` —— 同样从 `/v/risk` 出发走真 MSW，
 *          **两个方向都咬**（带诚实位 ⇒ 上屏且逐字等于后端原文；不带 ⇒ 不上屏、不许编一句），
 *          审核方对它做过反向变异（让读取器在后端不带诚实位时编一句 ⇒ 4 例红）。
 * 保留 §B 等于同一句话在同一页上有两套 DOM 契约与两套措辞 —— 下次改口径必漏一处。
 * 详细理由写在 `src/views/ScopeHonesty.tsx` 文件头的「收编裁决」。
 *
 * 本文件因此**只**守 canonical 那份读取器**指名拒收**的两个命题（见 §F 那条守卫用例）。
 *
 * ## 判据
 *  §A 金丝雀 + 零消费方的取证（否定结论必须带金丝雀证据，铁律 0.6）
 *  §C `kit_readiness`：`orderPoolTotal` 与 `sampled` **都上屏**，且 `shortageCount` 的读法写清楚
 *      （抽样的 N 张里 M 张缺料 ≠ 共 M 张缺料单）；换基地 → 口径真变（args 真的到了求解器）
 *  §D `quote_margin`：客户维必须显式标 `NOT_APPLIED` + 缺什么源；**换客户 margin 不变**这条反向事实也要在屏上说清
 *  §E 浮层规格：口径/原因在 `?` 浮层，**零原生 `title=`**（本仓 2026-08-10 出过滞留遮挡事故）
 *  §F **反双实现守卫**：档位只许有一个出处；`quote_margin` 必须仍落在读取器的 `null` 分支
 */


describe("WO-SCOPE-HONESTY-FE §A · 取证：接线前这三个求解器在前端的消费方（金丝雀先自证工具）", () => {
  /**
   * 铁律 0.6 的机制：报「零消费方」这类**否定结论**，必须同时给出金丝雀的命中证据 ——
   * 否则「我没找到」会被当成「它不存在」。这里的金丝雀是 `risk_timeline`：
   * 它**一定**在同一张表里（canonical 的 `ScopeHonestyBadge` 就在渲染它的页面上用），
   * 所以它若也扫出 0，那是扫描口径坏了，不是代码死了。
   */
  it("金丝雀：三个求解器的键名都真实存在于契约的规则映射表里（扫描口径可信）", async () => {
    const { SOLVER_RULE_REFS } = await import("@platform/contracts");
    // 金丝雀（已知必中）
    expect(Object.keys(SOLVER_RULE_REFS)).toContain("risk_timeline");
    // 待测的两个 —— 与金丝雀同一张表、同一次查找，扫不到不是因为键名拼错
    expect(Object.keys(SOLVER_RULE_REFS)).toContain("kit_readiness");
    expect(Object.keys(SOLVER_RULE_REFS)).toContain("quote_margin");
  });
});

describe("WO-SCOPE-HONESTY-FE §C · kit_readiness：抽样两数必须上屏，否则 shortageCount 在误导", () => {
  it("全网态：orderPoolTotal 与 sampled **都出现**，且写明 shortageCount 是抽样里的数", async () => {
    loginAs("planner");
    renderApp("/v/order-chain"); // 走 base handler 的真 mock（不 override）——这就是 demo 态用户看到的东西

    const sampling = await screen.findByTestId("oc-kit-scope-sampling");
    // 两个数缺一不可（工单 §2②：不显示这两个数，shortageCount 就是在误导）
    expect(sampling).toHaveTextContent("订单池");
    expect(sampling).toHaveTextContent("本次分析");
    const poolText = sampling.textContent ?? "";
    const nums = poolText.match(/\d+/g) ?? [];
    expect(nums.length).toBeGreaterThanOrEqual(2);
    const [pool, sampled] = [Number(nums[0]), Number(nums[1])];
    expect(sampled).toBeLessThan(pool); // 全网态订单池 > 采样上限 ⇒ 真发生了截断

    // shortageCount 的**读法**：分母是 sampled，不是订单池，更不是「全部缺料单」
    const reading = screen.getByTestId("oc-kit-scope-reading");
    expect(reading).toHaveTextContent(`本次分析的 ${sampled} 张里`);
    expect(reading).toHaveTextContent(`订单池共 ${pool} 张`);
    // 口径为全域时第一层要**明说**（「没说」和「说了是全域」是两件事）。
    // ⚠ 断言打在 canonical 那枚**唯一**徽标上（`scope-honesty-<testId>` / `data-level`），
    //   不是本文件另造的 chip —— 收编裁决要求档位只有一个出处，这条断言就是那条纪律的机器化。
    const badge = screen.getByTestId("scope-honesty-oc-kit-scope");
    expect(badge).toHaveAttribute("data-level", "GLOBAL");
    expect(badge).toHaveTextContent("全域口径 · 非所选范围");
    // 「未标注」那个分支必须**没有**被走到（否则就是把「说了是全域」渲成了「没说」）
    expect(screen.queryByTestId("oc-kit-scope-unstated")).toBeNull();
  });

  it("换基地 → 实参真的到了求解器：档位从「全域」变成该基地中文名，且订单池两数一起变", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    const before = (await screen.findByTestId("oc-kit-scope-sampling")).textContent ?? "";
    expect(screen.getByTestId("scope-honesty-oc-kit-scope")).toHaveAttribute("data-level", "GLOBAL");

    await user.selectOptions(screen.getByTestId("oc-base-filter"), "常州");

    await waitFor(() => expect(screen.getByTestId("scope-honesty-oc-kit-scope")).toHaveAttribute("data-level", "SCOPED"));
    const badge = screen.getByTestId("scope-honesty-oc-kit-scope");
    // ① 显中文名（id「changzhou」这种用户不认识的东西不许出现在第一层）
    expect(badge).toHaveTextContent("常州");
    expect(badge.textContent ?? "").not.toContain("changzhou");
    // ② 与全域态**显示不同**（差分判据：两态若渲成同一串字，本条整条失去意义）
    expect(badge).not.toHaveTextContent("全域口径");
    const after = screen.getByTestId("oc-kit-scope-sampling").textContent ?? "";
    // ③ 抽样两数也真变了：两态若逐字相同，就是「传了没人读」——那正是本单上游要治的病
    expect(after).not.toBe(before);
    // ④ 浮层里能看到「从多少收窄到多少」的口径**原文**（前端一个字不编）
    await user.hover(within(screen.getByTestId("oc-kit-scope-row")).getByTestId("info-oc-kit-scope"));
    expect(await screen.findByTestId("oc-kit-scope-note")).toHaveTextContent("非全网");
  });

  it("后端整个不给诚实位 → 显「作用域未标注」，**不许**悄悄当成全域（R14 不填默认）", () => {
    // 这条不打页面，打的是本文件与已并读取器的**交接约定**本身：
    // `readScopeHonesty` 返 null（后端什么都没说）时，KitScopeBar 必须走 `-unstated` 分支。
    // 「没说」与「说了是全域」是两个命题，编一句就是拿前端的猜测冒充引擎的结论。
    expect(readScopeHonesty({ rows: [], shortageCount: 0 })).toBeNull();
    expect(readScopeHonesty({ scope: { orderPoolTotal: 24, sampled: 8 } })).toBeNull(); // 只有抽样、没有档位
  });
});

describe("WO-SCOPE-HONESTY-FE §D · quote_margin：客户维必须标成「不生效」，不许画成算过的数", () => {
  it("第一层出现 NOT_APPLIED 的明示；缺哪两个源在浮层里逐条可查", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    const cust = await screen.findByTestId("oc-quote-scope-cust");
    // 枚举原文（可核）+ 人话（可懂），两个都要在第一层
    expect(cust).toHaveTextContent("NOT_APPLIED");
    expect(cust).toHaveTextContent("不生效");
    expect(cust).toHaveAttribute("data-tone", "off");

    // 缺源登记在浮层里逐条可查（诚实位降层不删除）
    await user.hover(within(screen.getByTestId("oc-quote-scope-cust-row")).getByTestId("info-oc-quote-scope-cust"));
    const note = await screen.findByTestId("oc-quote-scope-cust-note");
    expect(note).toHaveTextContent("换个客户名，margin 与 verdict 不会变");
    expect(screen.getByTestId("oc-quote-scope-missing-Customer-segment")).toBeInTheDocument();
    expect(screen.getByTestId("oc-quote-scope-missing-Customer-quotedPrice")).toBeInTheDocument();
  });

  it("反向事实：换客户 margin **不变**（且仍标 NOT_APPLIED）；换型号 margin **真变**（型号维是真接线）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    const margin0 = (await screen.findByTestId("oc-quote-margin")).textContent;

    // ① 换客户 → margin 逐字不变（这就是后端门里那条**反向**断言的前端半）
    await user.selectOptions(screen.getByTestId("oc-quote-cust"), "蔚途汽车");
    await waitFor(() => expect(screen.getByTestId("oc-quote-scope-cust")).toHaveTextContent("蔚途汽车"));
    expect(screen.getByTestId("oc-quote-margin").textContent).toBe(margin0);
    // 客户名照显（那是用户说的话），但它旁边永远挂着「不生效」
    expect(screen.getByTestId("oc-quote-scope-cust")).toHaveTextContent("NOT_APPLIED");

    // ② 换型号 → margin 真变，且型号维标 APPLIED（两维定性不同，不许合成一句）
    await user.selectOptions(screen.getByTestId("oc-quote-model"), "4680-NCM");
    await waitFor(() => expect(screen.getByTestId("oc-quote-scope-model")).toHaveTextContent("4680-NCM"));
    expect(screen.getByTestId("oc-quote-scope-model")).toHaveTextContent("已生效");
    expect(screen.getByTestId("oc-quote-margin").textContent).not.toBe(margin0);
  });

  it("整块零原生 title=（浮层一律走 InfoPopover·2026-08-10 滞留遮挡事故的对策）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("oc-scope-panel");
    expect(panel.querySelectorAll("[title]")).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §F · **反双实现守卫**（2026-08-13 · WO-R1 收编时加的，不是原 w5 内容）
 *
 * 收编裁决的结论是「档位只许有一个出处」。裁决写在注释里**不是机制** ——
 * 下一个人「顺手统一一下」时，注释一个字都拦不住他。这一节把它变成机器能说话的断言。
 * ════════════════════════════════════════════════════════════════════════════ */
describe("WO-SCOPE-HONESTY-FE §F · 档位单一出处：本文件补的是读取器**指名拒收**的那两个命题", () => {
  /**
   * `solverScopeHonesty.ts` 头注第 ⑥ 条白纸黑字：`quote_margin` **没有 `mode`** ⇒ 落到
   * `readModed` 返 `null`，**这是有意的** —— 型号维/客户维是两个独立维，压进单个
   * `{level, note}` 必然只能说其中一维，而消失掉的那一维恰恰是「换个客户名 margin 不会变」。
   *
   * 所以 `QuoteScopeBar` 画**两行**而不是一枚徽标，**不是**重复实现。
   * 这条断言就是那句话的机器化：谁哪天"顺手"给 quote 的 scope 加个 `mode` 让它落进读取器，
   * 本条当场红，逼他先回来读这段为什么。
   */
  it("守卫：quote_margin 的 scope 必须仍落在读取器的 null 分支（落进去 = 有一维当场消失）", () => {
    const quoteScope = {
      scope: {
        modelId: "4680-NCM",
        modelDimension: "APPLIED",
        modelNote: "BOM 成本按型号 4680-NCM 的真 BOM 逐行计",
        custName: "蔚途汽车",
        custDimension: "NOT_APPLIED",
        custNote: "客户维今天不生效：换个客户名，margin 与 verdict 不会变。",
        missingInputs: [{ objectType: "Customer", property: "segment", need: "客户所属细分" }],
      },
    };
    expect(readScopeHonesty(quoteScope)).toBeNull();
  });

  /**
   * 反向金丝雀：同一个 `readScopeHonesty`，对 `kit_readiness` 的形状**必须**返非 null。
   * 单向断言证明不了什么 —— 一个恒返 null 的读取器也能让上面那条过。
   * 这一条同时锚死「kit 的档位走已并那份、不由本文件自己判」这个交接约定。
   */
  it("反向金丝雀：同一读取器对 kit_readiness 的形状必须返非 null（否则上面那条是恒真命题）", () => {
    const kit = readScopeHonesty({
      scope: { mode: "BASE", baseId: "changzhou", baseName: "常州", orderPoolTotal: 2, sampled: 2, note: "仅 常州 基地可承接的订单·非全网" },
    });
    expect(kit).not.toBeNull();
    expect(kit?.level).toBe("SCOPED");
    expect(kit?.scopedTo).toBe("常州");
    // `note` 逐字取后端原文 —— 前端不改写、不摘要（措辞是引擎侧的单一来源）
    expect(kit?.note).toBe("仅 常州 基地可承接的订单·非全网");
  });
});
