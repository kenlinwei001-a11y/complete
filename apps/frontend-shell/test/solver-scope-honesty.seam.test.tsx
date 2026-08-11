import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { readScopeHonesty } from "@/lib/solverScopeHonesty";
import { mockCapacityForecast } from "@/mocks/simSolvers";

/**
 * 欠账 #178 · 求解器**作用域诚实位**的后→前这一跳（SEAM-GATE）。
 *
 * ── 病灶 ──────────────────────────────────────────────────────────────────────
 * 引擎侧已把「这个数到底算的是谁」显式下发（`solvers/capacity.ts:432-434` 的 `scope`/`scopeNote`，
 * 三条返回路全带；`extended.ts`/`capex.ts` 另两种形状同族），但前端**零消费方** ——
 * 屏上是个「看起来像局部答案」的全域数字。
 *
 * ── 本测试咬的是链路，不是函数（假绿第 9 形态的反面）───────────────────────────
 * 不断言「组件能渲染这个 prop」（那只测了一半，且咬的是 mock 的形状不是真渲染）。
 * **两个方向都咬**，缺一不可：
 *   ① 后端响应**带**诚实位 ⇒ 屏上出现那句话（且是**后端原文**，不是前端另写的一句）；
 *   ② 后端响应**不带** ⇒ 屏上**不出现**（不许替后端编一句「未指定范围」）。
 * 两条断言都打在**真视图 + 真 MSW HTTP + 真 useLiveSolver**上（`/v/project-sim` 走
 * `POST /b/v1/solvers/capacity_forecast/run`），不打桩 `runSolver`。
 */

const BADGE = "scope-honesty-capacity-forecast";
const NOTE = "scope-honesty-note-capacity-forecast";
/** 引擎原文（`apps/datacore/src/solvers/capacity.ts:434`）—— 前端若改写这句，本断言当场红。 */
const ENGINE_NOTE = "全网合计（未指定基地·跨该型号全部认证基地）";

/** 把 mock 载荷里的诚实位**摘掉**（模拟「后端没下发」那一侧）。 */
function stripHonesty(data: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...data };
  delete rest.scope;
  delete rest.scopeNote;
  return rest;
}

describe("欠账 #178 · 作用域诚实位上屏（后→前接缝·两个方向都咬）", () => {
  it("金丝雀：默认 mock 载荷确实带诚实位（夹具自证——不中就是夹具坏了，不许据此报「前端没接线」）", () => {
    const data = mockCapacityForecast({ modelId: "4680-NCM", qty: 40, weeks: 6 }) as Record<string, unknown>;
    expect(data.scope).toBe("ALL");
    expect(data.scopeNote).toBe(ENGINE_NOTE);
    // 摘掉之后必须真的没了（stripHonesty 自己也要自证，否则方向②测的是个恒真命题）。
    expect(stripHonesty(data).scopeNote).toBeUndefined();
  });

  it("方向① 后端**带**诚实位 → 屏上出现，且浮层正文逐字等于后端原文", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 第一层记号：永远可见（规范「静默降层等于删除」），且直说结论。
    const badge = await screen.findByTestId(BADGE);
    expect(badge).toHaveAttribute("data-level", "GLOBAL");
    expect(badge).toHaveTextContent("全域口径 · 非所选范围");

    // 浮层：`?` 触发器（**不是** title= 属性——规范 §2 明令禁止），点开看后端原文。
    expect(screen.queryByTestId(NOTE)).toBeNull(); // 未展开时不在 DOM（藏起来的东西照样被读屏念）
    await user.click(screen.getByTestId(`info-${BADGE}`));
    expect(await screen.findByTestId(NOTE)).toHaveTextContent(ENGINE_NOTE);
  });

  it("方向② 后端**不带**诚实位 → 屏上不出现（不许替后端编一句）", async () => {
    loginAs("planner");
    server.use(
      http.post("*/b/v1/solvers/capacity_forecast/run", async ({ request }) => {
        const body = (await request.json()) as { args?: Record<string, unknown> };
        const data = mockCapacityForecast(body.args as never) as Record<string, unknown>;
        return HttpResponse.json({ data: stripHonesty(data), snapshotVersion: "ov-12" });
      }),
    );
    renderApp("/v/project-sim");

    // 等推演真回来（stepper 出现 = 载荷已上屏），再断言"没有徽标"——
    // 否则"还没加载完"会冒充"不显示"，方向②就成了恒真命题。
    await screen.findByTestId("pm-stepper");
    await waitFor(() => expect(screen.getByTestId("snapshot-badge")).toBeInTheDocument());
    expect(screen.queryByTestId(BADGE)).toBeNull();
  });

  it("方向① 变体 · 真收窄（scope:BASE）→ 报出算的是谁，且**不**染成警示档", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(
      http.post("*/b/v1/solvers/capacity_forecast/run", async ({ request }) => {
        const body = (await request.json()) as { args?: Record<string, unknown> };
        const data = mockCapacityForecast(body.args as never) as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            ...stripHonesty(data),
            scope: "BASE",
            scopeBaseId: "changzhou",
            scopeBaseName: "常州",
            scopeNote: "仅 常州 基地（该型号该基地产能·非全网合计）",
          },
          snapshotVersion: "ov-12",
        });
      }),
    );
    renderApp("/v/project-sim");

    const badge = await screen.findByTestId(BADGE);
    expect(badge).toHaveAttribute("data-level", "SCOPED");
    expect(badge).toHaveTextContent("仅 常州 · 已按此范围重算");
    await user.click(screen.getByTestId(`info-${BADGE}`));
    expect(await screen.findByTestId(NOTE)).toHaveTextContent("非全网合计");
  });

  /**
   * 读取器单测：三种形状**同一份实现**读得出来（新增第四种形状时这里必须跟着加，否则视图里散写 if 的老病复发）。
   * 这不是替代上面的链路测试 —— 只有 test 引用 = 已排练，不是已实现（假绿第 9 形态）。
   */
  describe("readScopeHonesty · 三种后端形状归一到同一档位表", () => {
    it("形状① 扁平串 + scopeNote（capacity_forecast）", () => {
      expect(readScopeHonesty({ scope: "ALL", scopeNote: ENGINE_NOTE })).toEqual({
        level: "GLOBAL",
        note: ENGINE_NOTE,
        field: "scope",
      });
      expect(readScopeHonesty({ scope: "BASE", scopeBaseName: "江门", scopeNote: "仅 江门 基地" })).toMatchObject({
        level: "SCOPED",
        scopedTo: "江门",
      });
    });

    it("形状② 对象 + mode（credit_exposure / capex_scenario）", () => {
      // credit_exposure 未指定客户 → 全部客户合计（`extended.ts:847` 原文）。
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

    it("没有诚实位 → null（**不许**编一句「未指定范围」：没说 ≠ 说了没限定）", () => {
      expect(readScopeHonesty({ p50: 1, p90: 2 })).toBeNull();
      expect(readScopeHonesty({ scope: "ALL" })).toBeNull(); // 有档位没原文 → 不摆一个点不开的记号
      expect(readScopeHonesty(null)).toBeNull();
      expect(readScopeHonesty([{ scope: "ALL", scopeNote: "x" }])).toBeNull();
    });
  });
});
