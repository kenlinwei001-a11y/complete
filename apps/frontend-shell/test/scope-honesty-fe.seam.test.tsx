import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { BASE_REGISTRY } from "@platform/contracts";
import { server } from "./setup";
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
 * ## 判据（对着工单 §2⑤ 逐条）
 *  §A 金丝雀 + 零消费方的取证（否定结论必须带金丝雀证据，铁律 0.6）
 *  §B `risk_timeline`：同一页在 `scope=BASE` 与 `scope=ALL` 两种回包下**显示不同**
 *      —— 且 `ALL` 必须**明说是全网**（「没说」和「说了是全网」是两件事）；后端不给 ⇒ 说「未标注」，不许当全网
 *  §C `kit_readiness`：`orderPoolTotal` 与 `sampled` **都上屏**，且 `shortageCount` 的读法写清楚
 *      （抽样的 N 张里 M 张缺料 ≠ 共 M 张缺料单）；换基地 → 口径真变（args 真的到了求解器）
 *  §D `quote_margin`：客户维必须显式标 `NOT_APPLIED` + 缺什么源；**换客户 margin 不变**这条反向事实也要在屏上说清
 *  §E 浮层规格：口径/原因在 `?` 浮层，**零原生 `title=`**（本仓 2026-08-10 出过滞留遮挡事故）
 */

const RISK_URL = "*/a/v1/solvers/risk_timeline/invoke";

/** 只覆写 `risk_timeline` 这一条：其余（bottleneck_matrix / objects / workspace…）照走 base handler。 */
function serveRiskTimeline(patch: Record<string, unknown>) {
  server.use(
    http.post(RISK_URL, async () => {
      const base = await baselineRiskTimeline();
      return HttpResponse.json({ data: { ...base, ...patch }, snapshotVersion: "ov-12" });
    }),
  );
}

/** 取一份 base handler 的真回包当底座 —— 自己拼 cards 会把「页面能不能渲染」和「诚实位」两件事混在一起。 */
async function baselineRiskTimeline(): Promise<Record<string, unknown>> {
  const { RISK_TIMELINE } = await import("@/mocks/fixtures");
  return { ...(RISK_TIMELINE as unknown as Record<string, unknown>) };
}

const CHANGZHOU = BASE_REGISTRY.find((b) => b.name === "常州")!;

describe("WO-SCOPE-HONESTY-FE §A · 取证：接线前这三个求解器在前端的消费方（金丝雀先自证工具）", () => {
  /**
   * 铁律 0.6 的机制：报「零消费方」这类**否定结论**，必须同时给出金丝雀的命中证据 ——
   * 否则「我没找到」会被当成「它不存在」。这里的金丝雀是 `risk_timeline`：
   * 它**一定**有消费方（本文件 §B 就在渲染它的页面），所以它若也扫出 0，那是扫描器坏了，不是代码死了。
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

describe("WO-SCOPE-HONESTY-FE §B · risk_timeline：BASE 与 ALL 在同一页上必须显示不同", () => {
  it("scope=ALL → 第一层**明说是全网**（不是什么都不说）", async () => {
    loginAs("planner");
    serveRiskTimeline({ scope: "ALL", scopeNote: "全网口径（未指定基地·跨全部风险基地）" });
    renderApp("/v/risk");

    const mode = await screen.findByTestId("risk-scope-mode");
    expect(mode).toHaveTextContent("全网");
    expect(mode).toHaveAttribute("data-tone", "all");
    // 「没说」与「说了是全网」是两件事 —— 这里必须是后者。
    expect(mode).not.toHaveTextContent("未标注");
  });

  it("scope=BASE → 第一层显**基地中文名**（不是 id），且与 ALL 态显示不同", async () => {
    loginAs("planner");
    serveRiskTimeline({
      scope: "BASE",
      scopeBaseId: CHANGZHOU.baseId,
      scopeBaseName: CHANGZHOU.name,
      scopeNote: `仅 ${CHANGZHOU.name} 一个基地的因素·非全网`,
    });
    renderApp("/v/risk");

    const mode = await screen.findByTestId("risk-scope-mode");
    // ① 显中文名
    expect(mode).toHaveTextContent(CHANGZHOU.name);
    // ② **不是** id（"changzhou" 这种用户不认识的东西不许出现在第一层）
    expect(mode.textContent ?? "").not.toContain(CHANGZHOU.baseId);
    // ③ 与 ALL 态**显示不同**（差分判据：两态若渲成同一串字，本条整条失去意义）
    expect(mode).not.toHaveTextContent("全网");
    expect(mode).toHaveAttribute("data-tone", "base");
  });

  it("后端没下发 scope → 显「作用域未标注」，**不许**悄悄当成全网（R14 不填默认）", async () => {
    loginAs("planner");
    // 显式不给 scope（这就是接线前 base mock 的样子，也是老后端的样子）
    server.use(
      http.post(RISK_URL, async () => {
        const base = await baselineRiskTimeline();
        delete base.scope;
        delete base.scopeNote;
        return HttpResponse.json({ data: base, snapshotVersion: "ov-12" });
      }),
    );
    renderApp("/v/risk");

    const mode = await screen.findByTestId("risk-scope-mode");
    expect(mode).toHaveTextContent("未标注");
    expect(mode).toHaveAttribute("data-tone", "unknown");
    // 关键：不许把「没说」渲染成「全网」—— 那是把本单要治的病换个地方复发。
    expect(mode).not.toHaveTextContent("全网");
  });

  it("口径原文进 `?` 浮层（第一层只留记号），且**零原生 title=**", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const note = "仅 常州 一个基地的因素（按 base 收窄后跑该基地全部因子）·非全网";
    serveRiskTimeline({ scope: "BASE", scopeBaseId: CHANGZHOU.baseId, scopeBaseName: CHANGZHOU.name, scopeNote: note });
    renderApp("/v/risk");

    const row = await screen.findByTestId("risk-scope");
    // 不点：口径原文**不在**第一层（规范 R-UI-3）
    expect(row.textContent ?? "").not.toContain(note);
    // 但记号（`?` 触发器）永远可见 —— 诚实位允许降层、不允许静默降层
    const trigger = within(row).getByTestId("info-risk-scope");
    await user.hover(trigger);
    expect(await screen.findByTestId("risk-scope-note")).toHaveTextContent(note);
    // 浮层里能查到 baseId（可核查），但它不占第一层
    expect(screen.getByTestId("risk-scope-note")).toHaveTextContent(CHANGZHOU.baseId);
    // 零原生 tooltip：整行（含触发器）不许有 title 属性
    expect(row.querySelectorAll("[title]")).toHaveLength(0);
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
    // 口径为全网时第一层要明说
    expect(screen.getByTestId("oc-kit-scope-mode")).toHaveTextContent("全网");
  });

  it("换基地 → 实参真的到了求解器：口径从「全网」变成该基地中文名，且订单池两数一起变", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    const before = (await screen.findByTestId("oc-kit-scope-sampling")).textContent ?? "";
    expect(screen.getByTestId("oc-kit-scope-mode")).toHaveTextContent("全网");

    await user.selectOptions(screen.getByTestId("oc-base-filter"), "常州");

    await waitFor(() => expect(screen.getByTestId("oc-kit-scope-mode")).toHaveTextContent("常州"));
    const after = screen.getByTestId("oc-kit-scope-sampling").textContent ?? "";
    // 差分判据：两态若逐字相同，就是「传了没人读」——那正是本单上游要治的病
    expect(after).not.toBe(before);
    // 单基地口径不许还显示「全网」
    expect(screen.getByTestId("oc-kit-scope-mode")).not.toHaveTextContent("全网");
    // 浮层里能看到「从多少收窄到多少」的口径原文
    await user.hover(within(screen.getByTestId("oc-kit-scope-row")).getByTestId("info-oc-kit-scope"));
    expect(await screen.findByTestId("oc-kit-scope-note")).toHaveTextContent("非全网");
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
