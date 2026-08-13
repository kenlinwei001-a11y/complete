import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { readScopeHonesty } from "@/lib/solverScopeHonesty";
import { RISK_TIMELINE } from "@/mocks/fixtures";

/**
 * 欠账 #178 · 求解器**作用域诚实位**的后→前这一跳（SEAM-GATE）。
 *
 * ── 病灶 ──────────────────────────────────────────────────────────────────────
 * 引擎侧已把「这个数到底算的是谁」显式下发，且 `risk_timeline` 这一族**连契约里都声明了**
 * （`packages/contracts/src/solvers.ts:351-354`，引擎侧 `solvers/risk.ts:775-777` 两分支全带），
 * 但前端**零消费方** —— 屏上「产能推演」整屏是全网口径的数，用户随时可能读成某个基地的数。
 *
 * ── 本测试咬的是链路，不是函数（假绿第 9 形态的反面）───────────────────────────
 * 不断言「组件能渲染这个 prop」（那只测了一半，且咬的是 mock 的形状不是真渲染）。
 * **两个方向都咬**，缺一不可：
 *   ① 后端响应**带**诚实位 ⇒ 屏上出现那句话（且是**后端原文**，不是前端另写的一句）；
 *   ② 后端响应**不带** ⇒ 屏上**不出现**（不许替后端编一句「未指定范围」）。
 * 两条断言都打在**真视图 + 真 MSW HTTP + 真 useQuery**上（`/v/risk` 走
 * `POST /a/v1/solvers/risk_timeline/invoke`），不打桩 `invokeSolver`。
 */

const BADGE = "scope-honesty-risk-timeline";
const NOTE = "scope-honesty-note-risk-timeline";
/** 引擎原文（`apps/datacore/src/solvers/risk.ts:777`）—— 前端若改写这句，本断言当场红。 */
const ENGINE_NOTE_ALL = "全网（未指定基地·跨全部基地取越线卡）";
/** 引擎原文（`apps/datacore/src/solvers/risk.ts:776` 的 BASE 分支模板代入「常州」·无 factor）。 */
const ENGINE_NOTE_BASE = "仅 常州 基地（该基地全部因素·非全网）";

/** 把载荷里的诚实位**摘掉**（模拟「后端没下发」那一侧）。 */
function stripHonesty(data: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...data };
  delete rest.scope;
  delete rest.scopeNote;
  delete rest.scopeBaseId;
  delete rest.scopeBaseName;
  return rest;
}

/** 本页最小可渲染载荷（真 fixture·避免自己另造一份与视图约定漂移的形状）。 */
function baseline(): Record<string, unknown> {
  return { ...(RISK_TIMELINE as unknown as Record<string, unknown>), planRows: [] };
}

describe("欠账 #178 · 作用域诚实位上屏（后→前接缝·两个方向都咬）", () => {
  it("金丝雀：默认 mock 夹具确实带诚实位（夹具自证——不中就是夹具坏了，不许据此报「前端没接线」）", () => {
    const data = baseline();
    expect(data.scope).toBe("ALL");
    expect(data.scopeNote).toBe(ENGINE_NOTE_ALL);
    // 摘掉之后必须真的没了（stripHonesty 自己也要自证，否则方向②测的是个恒真命题）。
    expect(stripHonesty(data).scopeNote).toBeUndefined();
  });

  it("方向① 后端**带**诚实位 → 屏上出现，且浮层正文逐字等于后端原文", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");

    // 第一层记号：永远可见（规范「静默降层等于删除」），且直说结论。
    const badge = await screen.findByTestId(BADGE);
    expect(badge).toHaveAttribute("data-level", "GLOBAL");
    expect(badge).toHaveTextContent("全域口径 · 非所选范围");

    // 浮层：`?` 触发器（**不是** title= 属性——规范 §2 明令禁止），点开看后端原文。
    expect(screen.queryByTestId(NOTE)).toBeNull(); // 未展开时不在 DOM（藏起来的东西照样被读屏念）
    await user.click(screen.getByTestId(`info-${BADGE}`));
    expect(await screen.findByTestId(NOTE)).toHaveTextContent(ENGINE_NOTE_ALL);
  });

  it("方向② 后端**不带**诚实位 → 屏上不出现（不许替后端编一句）", async () => {
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
        HttpResponse.json({ data: stripHonesty(baseline()), snapshotVersion: "ov-12" }),
      ),
    );
    renderApp("/v/risk");

    // 等载荷真上屏（KPI 条出现 = risk_timeline 已渲染），再断言"没有徽标"——
    // 否则"还没加载完"会冒充"不显示"，方向②就成了恒真命题。
    await screen.findByTestId("risk-kpi");
    await waitFor(() => expect(screen.getByTestId("risk-window-30")).toBeInTheDocument());
    expect(screen.queryByTestId(BADGE)).toBeNull();
  });

  it("方向① 变体 · 真收窄（scope:BASE）→ 报出算的是谁，且**不**染成警示档", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
        HttpResponse.json({
          data: {
            ...stripHonesty(baseline()),
            scope: "BASE",
            scopeBaseId: "changzhou",
            scopeBaseName: "常州",
            scopeNote: ENGINE_NOTE_BASE,
          },
          snapshotVersion: "ov-12",
        }),
      ),
    );
    renderApp("/v/risk");

    const badge = await screen.findByTestId(BADGE);
    expect(badge).toHaveAttribute("data-level", "SCOPED");
    expect(badge).toHaveTextContent("仅 常州 · 已按此范围重算");
    await user.click(screen.getByTestId(`info-${BADGE}`));
    expect(await screen.findByTestId(NOTE)).toHaveTextContent("非全网");
  });

  /**
   * 读取器单测：三种形状**同一份实现**读得出来（新增第四种形状时这里必须跟着加，否则视图里散写 if 的老病复发）。
   * 这不是替代上面的链路测试 —— 只有 test 引用 = 已排练，不是已实现（假绿第 9 形态）。
   */
  describe("readScopeHonesty · 三种后端形状归一到同一档位表", () => {
    it("形状① 扁平串 + scopeNote（risk_timeline / capacity_forecast）", () => {
      expect(readScopeHonesty({ scope: "ALL", scopeNote: ENGINE_NOTE_ALL })).toEqual({
        level: "GLOBAL",
        note: ENGINE_NOTE_ALL,
        field: "scope",
      });
      expect(readScopeHonesty({ scope: "BASE", scopeBaseName: "江门", scopeNote: "仅 江门 基地" })).toMatchObject({
        level: "SCOPED",
        scopedTo: "江门",
      });
    });

    it("形状② 对象 + mode（credit_exposure / capex_scenario）", () => {
      // credit_exposure 未指定客户 → 全部客户合计（`extended.ts:975` 原文）。
      expect(
        readScopeHonesty({ scope: { mode: "ALL", customerCount: 6, note: "未指定客户→全部客户合计敞口（非首客户）" } }),
      ).toMatchObject({ level: "GLOBAL", note: "未指定客户→全部客户合计敞口（非首客户）" });
      // capex_scenario 直传 projects → scenarioKey 只是标签，**没参与选型**（`capex.ts:201-203` 原文节选）。
      expect(
        readScopeHonesty({ scope: { mode: "EXPLICIT", scenarioKey: "x", note: "scenarioKey 仅为回显标签、未参与选型" } }),
      ).toMatchObject({ level: "UNAPPLIED", scopedTo: "x" });
      // 真选到登记情景 → 真重算。
      expect(readScopeHonesty({ scope: { mode: "SCENARIO", scenarioKey: "aggressive" } })).toMatchObject({
        level: "SCOPED",
        scopedTo: "aggressive",
      });
      // kit_readiness 的 BASE 路（`extended.ts:749` 装配名 kitScope·随行输出 `:248`）——
      // 「算的是谁」要报**基地中文名**，不是 baseId（id 用户不认识，拿它当名字等于没说）。
      expect(
        readScopeHonesty({
          scope: { mode: "BASE", baseId: "changzhou", baseName: "常州", orderPoolTotal: 12, sampled: 8, note: "仅 常州 基地可承接的订单（Order.bases ∋ changzhou）·非全网" },
        }),
      ).toMatchObject({ level: "SCOPED", scopedTo: "常州" });
      expect(readScopeHonesty({ scope: { mode: "ALL", orderPoolTotal: 24, note: "全网口径（未指定基地·跨全部产地）" } })).toMatchObject({
        level: "GLOBAL",
        note: "全网口径（未指定基地·跨全部产地）",
      });
    });

    it("形状⑥ quote_margin 的双维 scope **不认**（`extended.ts:918`）—— 压成单枚徽标必吞掉一维", () => {
      // 型号维今天真生效 · 客户维恒 NOT_APPLIED：压进一个 {level,note} 只能说一维，
      // 而消失掉的那一维恰恰是「换个客户名 margin 不会变」这句最该上屏的话。要接它得画两行。
      expect(
        readScopeHonesty({
          scope: { modelId: "4680-NCM", modelDimension: "APPLIED", modelNote: "按型号真 BOM 逐行计", custName: "蔚途汽车", custDimension: "NOT_APPLIED", custNote: "客户维今天不生效" },
        }),
      ).toBeNull();
    });

    it("形状③ 专名维 dataMode:EMPTY（changeover_sequence.lineScope / quarterly_gap.quarterScope）", () => {
      expect(
        readScopeHonesty({ lineScope: { dataMode: "EMPTY", lineId: "LINE-1", reason: "本次排序用的是全局换型矩阵" } }),
      ).toEqual({ level: "UNAPPLIED", note: "本次排序用的是全局换型矩阵", field: "lineScope" });
      expect(
        readScopeHonesty({ quarterScope: { dataMode: "EMPTY", quarter: "2026Q2", reason: "缺口取的是占位缺省值" } }),
      ).toMatchObject({ level: "UNAPPLIED", field: "quarterScope" });
      // dataMode 不是 EMPTY（真算了）→ 不是诚实位，别乱标。
      expect(readScopeHonesty({ lineScope: { dataMode: "LIVE", reason: "x" } })).toBeNull();
    });

    it("形状⑤ ChainScope 回带**不是**诚实位（`solvers/scope.ts:167` echoChainScope）—— 认错方向会得出相反结论", () => {
      // affected_orders / order_fullchain / atp_check：限定了才回带，且没有 mode/note。
      // 若把它当诚实位读：限定时画一个记号、**未限定时（最该提醒的那一侧）反而什么都不画**。
      expect(readScopeHonesty({ scope: { baseIds: ["changzhou"], businessTypes: ["EV"] } })).toBeNull();
    });

    it("没有诚实位 → null（**不许**编一句「未指定范围」：没说 ≠ 说了没限定）", () => {
      expect(readScopeHonesty({ p50: 1, p90: 2 })).toBeNull();
      expect(readScopeHonesty({ scope: "ALL" })).toBeNull(); // 有档位没原文 → 不摆一个点不开的记号
      expect(readScopeHonesty(null)).toBeNull();
      expect(readScopeHonesty([{ scope: "ALL", scopeNote: "x" }])).toBeNull();
    });
  });
});
