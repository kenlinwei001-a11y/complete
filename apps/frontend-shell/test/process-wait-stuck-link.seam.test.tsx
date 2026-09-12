import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";

/**
 * WO-IA-E2E5E6 · E5 接缝验收 —— 「流程等待态」（模板层·这类流程通常等什么）与
 * 「流程卡点」（实例层·这一张单卡在第几站）**不合页**，但必须有双向入口：
 *   ① 模板层每站行内「现在有 N 张单卡在这里 →」→ 实例层过滤到该站；
 *   ② 实例层每张卡「这类流程通常在这站等什么 →」→ 模板层对应站定位。
 *
 * ══ 本单的验收判据（仓主原话）：一条接缝测试断言 ════════════════════════════
 *   **模板层某站显示的计数 == 实例层过滤后的实际条数** —— 不是「链接存在」。
 *   数对不上的链接比没有更坏：用户按 N 张的预期过去，看到 M 张，两页必有一个在说谎。
 *
 * ══ 咬点设计（每条断言对着一种说谎方式）══════════════════════════════════════
 *  · 计数不取常量、不抄 fixture：从模板层链接的 data-count **读出**，再拿去咬实例层
 *    渲染出来的卡片数 —— 改任何一边（分桶逻辑 / 过滤逻辑），另一边不跟着变就红。
 *  · `n >= 1` 的**下界金丝雀**：0 == 0 的相等是空集上的恒真（哑门），必须先排除。
 *  · 反向金丝雀 `P44 不在`：过滤没生效时全量 2 张卡都在，「count 相等」照样成立 ——
 *    不咬这一条，过滤坏了测不出来。
 *  · P44 只活在实例层（定义词表里没有）⇒ 反向跳回必须**明说查无此站**，不许静默空跳。
 *
 * 数据前提（mock MSW，未 vi.mock 任何 endpoint —— 走应用真取数路径）：
 *  `/a/v1/process-instances/stuck` = P17×1 + P44×1 + derivedStuckCount:1；
 *  `/a/v1/process-definitions` 词表含 P17、**不含 P44**（fixture 是 seed 的逐字子集）。
 */

const STUCK_OVERRIDE = "process.runtime";

describe("WO-IA-E2E5E6 · E5 双向入口（模板层 ↔ 实例层）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色
    // 实例层是暗发页（process.runtime defaultOn:false）：显式开通，等价租户打开功能。
    db.tenantOverrides[STUCK_OVERRIDE] = true;
  });
  afterEach(() => {
    delete db.tenantOverrides[STUCK_OVERRIDE];
  });

  it("验收判据：模板层 P17 行内计数 N → 点过去，实例层过滤后**恰好** N 张卡（两页同一个数）", async () => {
    const { router } = renderApp("/v/process-wait");

    // 金丝雀①：定义表真回来了（行在），否则下面的链接断言全在空集上恒真。
    await screen.findByTestId("pw-row-P17");
    // 页级口径声明同时在（derivedStuckCount=1：反推实例不计入各站计数，必须说出来）。
    // （与「不是实测滞留」并入同一段 —— ui-first-layer 门按静态模板数块，不另起块。）
    await waitFor(() =>
      expect(screen.getByTestId("pw-not-measured").textContent ?? "").toContain("不计入"),
    );

    // 金丝雀②：跨层计数链接真的渲染了（只有计数 >0 才渲染）。
    const link = await screen.findByTestId("pw-stuck-link-P17");
    const n = Number(link.getAttribute("data-count"));
    expect(n, "data-count 缺失或非数 ⇒ 接缝两端没有可对齐的数（工具坏了，不是页面干净）").toBeGreaterThanOrEqual(1);
    expect(link.textContent).toBe(`现在有 ${n} 张单卡在这里 →`);

    // 同页对照组：没有卡单的站（P01）渲染的是不可点的「现在没有单卡在这里」，
    // 不许是链接（没有可去的地方给一个入口 = 空跳）。
    const zero = await screen.findByTestId("pw-stuck-zero-P01");
    expect(zero.textContent).toBe("现在没有单卡在这里");
    expect(zero.tagName).not.toBe("A");

    await userEvent.click(link);

    // URL 契约：确实落在实例层、且带上了站过滤参数。
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/process-stuck"));
    expect(router.state.location.search).toContain("proc=P17");

    // ── 验收判据本体 ──────────────────────────────────────────────────────
    const banner = await screen.findByTestId("stuck-filter-banner");
    expect(banner.getAttribute("data-count")).toBe(String(n));
    const cards = screen.getAllByTestId("stuck-card");
    expect(cards.length, "实例层过滤后条数 ≠ 模板层那个 N ⇒ 链接在说谎（本单验收判据）").toBe(n);
    for (const c of cards) {
      expect(c.getAttribute("data-process-key")).toBe("P17");
    }
    // 反向金丝雀：别站（P44）的卡被滤掉了 —— 过滤若没生效，全量 2 张都在，
    // 上面「count 相等」照样成立（2==2 撞巧）。不咬这一条，过滤坏了测不出来。
    expect(screen.queryByTestId("stuck-wait-link-P44")).toBeNull();
    // 过滤是显示层的：等待态计数条仍是全库口径，不许被过滤偷偷改写（P44 的那 1 条还在）。
    expect(screen.getByTestId("tally-WAITING_DATA").textContent).toContain("1");
  });

  it("反向：实例层卡片「这类流程通常在这站等什么 →」跳回模板层，对应站被定位（data-focus + 徽标）", async () => {
    const { router } = renderApp("/v/process-stuck");

    // 金丝雀：未过滤时两站的卡都在（P17 + P44）—— 反向链接是在真数据上点的。
    const cards = await screen.findAllByTestId("stuck-card");
    expect(cards.length, "mock 应给 P17+P44 两张卡；少了说明前提没成立").toBe(2);

    const back = screen.getByTestId("stuck-wait-link-P17");
    expect(back.getAttribute("href")).toBe("/v/process-wait?focus=P17");
    await userEvent.click(back);

    await waitFor(() => expect(router.state.location.pathname).toBe("/v/process-wait"));
    expect(router.state.location.search).toContain("focus=P17");

    // 对应站被定位：行上 data-focus=1 + 站名后带定位徽标文本（只说「跳回来了」不够，得定位到那一站）。
    const row = await screen.findByTestId("pw-row-P17");
    await waitFor(() => expect(row.getAttribute("data-focus")).toBe("1"));
    expect(row.textContent).toContain("定位到这里");
    // 别的行不许被顺带定位（定位信号唯一）。
    expect(document.querySelectorAll('[data-focus="1"]')).toHaveLength(1);
  });

  it("诚实位：focus 的站不在模板层词表（P44 只有运行实例）⇒ 明说查无此站，不静默空跳", async () => {
    renderApp("/v/process-wait?focus=P44");
    // 金丝雀：词表真回来了。
    await screen.findByTestId("pw-row-P17");
    // 「查无此站」并进诚实位「答不了」段（同属"这一页答不出什么"）。
    await waitFor(() => {
      const txt = screen.getByTestId("pw-honesty-cannot").textContent ?? "";
      expect(txt).toContain("P44");
      expect(txt).toContain("没有");
    });
    // 没有任何一行被假装定位。
    expect(document.querySelector('[data-focus="1"]')).toBeNull();
    // 反向：词表里有的站（P17）不误报「查无此站」。
    expect(screen.getByTestId("pw-honesty-cannot").textContent ?? "").not.toContain("「P17」");
  });

  it("诚实位：卡点计数拿不到（404 FEATURE_NOT_FOUND）⇒ 各站摆「暂不可得」+ 原因，绝不摆 0", async () => {
    server.use(
      http.get("*/a/v1/process-instances/stuck", () =>
        HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "feature not found" } }, { status: 404 }),
      ),
    );
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-row-P17");
    const na = await screen.findByTestId("pw-stuck-na-P17");
    expect(na.textContent).toContain("该站计数暂不可得");
    expect(na.textContent).toContain("未开通"); // 原因跟着说（暗发 ≠ 故障，但都要说清）
    // 全页不许有任何一处把「拿不到」伪装成 0 或可点链接。
    expect(screen.queryByTestId("pw-stuck-zero-P17")).toBeNull();
    expect(screen.queryByTestId("pw-stuck-link-P17")).toBeNull();
    expect(document.querySelectorAll('[data-testid^="pw-stuck-zero-"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="pw-stuck-link-"]')).toHaveLength(0);
  });
});
