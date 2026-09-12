import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CONSTRAINT-REFS · **对象约束面板的接缝门**（前端半）。
 *
 * ── 这道门要证的那**一句话** ────────────────────────────────────────────────
 *   **「在界面上按引用选一条规则挂给某类对象 ⇒ 真的有一个 `POST /a/v1/ontology/object-types`
 *     发出去，body 里带着 `constraintRefs:[{ruleKey, propKey, kind}]`，且**不带**任何表达式/阈值。」**
 *
 * 后端半（存得住 + 求解器读得到 + 对照实验）由 `apps/datacore/test/object-constraint-refs.seam.test.ts`
 * 咬住；两半合起来才是「配了约束真的会发生事情」。只测其中一半都会在缺口仍在时全绿 ——
 * 本单开工时的病正是「屏上说配好了、实际什么都没发生、还不报错」。
 *
 * ── 设计决定（照同目录 `ontology-relations.seam.test.tsx` 的既有纪律）────────────
 *  ① **不 `vi.mock("@/api/endpoints")`** —— 那会把病灶所在的那一跳一起 mock 掉，
 *     URL 模板与 body 序列化根本不参与，断言恒绿而缺口仍在。此处走真 endpoints、在 MSW 层拦真实 URL。
 *  ② **从真渲染出来的可见控件驱动**（真 route `/admin/ontology-relations`），不是隔离挂组件。
 *  ③ `<select>` 一律用 `selectOptions`（change 事件），不是 click —— 本仓有 agent 在这上面栽过。
 */

type Hit = { url: string; body: Record<string, unknown> };

/** 拦真实 URL 记一笔再落回原 handler（有状态 mock 照常推进）。 */
function spyPost(sink: Hit[]) {
  server.use(
    http.post("*/a/v1/ontology/object-types", async ({ request }) => {
      sink.push({ url: request.url, body: (await request.clone().json()) as Record<string, unknown> });
      return undefined as never;
    }),
  );
}

async function openPage() {
  loginAs("planner");
  renderApp("/admin/ontology-relations");
  await screen.findByTestId("ontology-relations-page");
  await screen.findByTestId("orel-cf-type");
}

describe("WO-CONSTRAINT-REFS · 对象约束面板（接缝：四个下拉 × POST /a/v1/ontology/object-types）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("① 四样全是下拉，面板内零个自由文本框（表达式无从手写 ⇒ 结构上打不出错字）", async () => {
    await openPage();
    for (const t of ["orel-cf-type", "orel-cf-rule", "orel-cf-prop", "orel-cf-kind"]) {
      expect(screen.getByTestId(t).tagName, `${t} 必须是 <select>`).toBe("SELECT");
    }
    // 金丝雀：面板确实找到了（否则下面的 0 是"没找到面板"而不是"没有输入框"）。
    const panel = screen.getByTestId("orel-cf-type").closest(".panel");
    expect(panel, "金丝雀：约束面板应当存在").not.toBeNull();
    expect(panel!.querySelectorAll('input[type="text"], textarea').length).toBe(0);
  });

  it("② 约束类型下拉的选项来自契约单一真值（前端不内联第二份中文表）", async () => {
    await openPage();
    const opts = within(screen.getByTestId("orel-cf-kind")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["不得超过（上限）", "不得低于（下限）", "需要产能", "必须早于（时序）"]);
  });

  it("③ 选类型后，属性下拉只列**该类型自己**的属性（不是全库属性大杂烩）", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.selectOptions(screen.getByTestId("orel-cf-type"), "Line");
    await waitFor(() => {
      const vals = within(screen.getByTestId("orel-cf-prop")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value).filter(Boolean);
      expect(vals).toContain("utilization"); // Line 有
      expect(vals).not.toContain("custId"); // Customer 的，不该出现在 Line 上
    });
  });

  it("④ 接缝主断言：挂一条约束 ⇒ 真发 POST，body 带 constraintRefs 且**不带**表达式/阈值", async () => {
    const user = userEvent.setup();
    const hits: Hit[] = [];
    await openPage();
    spyPost(hits);

    await user.selectOptions(screen.getByTestId("orel-cf-type"), "Line");
    await waitFor(() => expect((screen.getByTestId("orel-cf-prop") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    const ruleSel = screen.getByTestId("orel-cf-rule") as HTMLSelectElement;
    const firstRule = [...ruleSel.options].map((o) => o.value).find(Boolean)!;
    await user.selectOptions(ruleSel, firstRule);
    await user.selectOptions(screen.getByTestId("orel-cf-prop"), "utilization");
    await user.selectOptions(screen.getByTestId("orel-cf-kind"), "must_not_exceed");
    await user.click(screen.getByTestId("orel-cf-add"));

    await waitFor(() => expect(hits.length).toBe(1));
    const body = hits[0]!.body;
    expect(hits[0]!.url).toContain("/a/v1/ontology/object-types");
    expect(body.key).toBe("Line");
    expect(body.constraintRefs).toEqual([{ ruleKey: firstRule, propKey: "utilization", kind: "must_not_exceed" }]);
    // 引用模式的核心：屏上配出来的东西里**不许**出现表达式/阈值（否则就分叉出第二份业务常数）。
    const s = JSON.stringify(body.constraintRefs);
    expect(s).not.toContain("expression");
    expect(s).not.toContain("params");
    // 整份 upsert：既有属性必须原样带回（后端不是 PATCH，漏传会把属性抹掉）。
    expect(Array.isArray(body.properties) && (body.properties as unknown[]).length).toBeGreaterThan(0);
  });

  it("⑤ 配完屏上看得见：表格列出该约束 + 只读显示规则库里的表达式", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.selectOptions(screen.getByTestId("orel-cf-type"), "Line");
    await waitFor(() => expect((screen.getByTestId("orel-cf-prop") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    const ruleSel = screen.getByTestId("orel-cf-rule") as HTMLSelectElement;
    const firstRule = [...ruleSel.options].map((o) => o.value).find(Boolean)!;
    await user.selectOptions(ruleSel, firstRule);
    await user.selectOptions(screen.getByTestId("orel-cf-prop"), "utilization");
    await user.click(screen.getByTestId("orel-cf-add"));

    await waitFor(() => expect(screen.getByTestId(`orel-cf-row-${firstRule}`)).toBeTruthy());
    const row = screen.getByTestId(`orel-cf-row-${firstRule}`).textContent ?? "";
    expect(row).toContain("utilization");
    expect(row).toContain("不得超过（上限）");
    // 总览计数跟着变（"全库已配约束的类型"不是装饰文字）。
    await waitFor(() => expect(screen.getByTestId("orel-cf-summary").textContent).toContain("Line(1)"));
  });

  it("⑥ 后端 400 原样弹出，不吞（规则可能在页面打开之后被别人下线 —— 那时必须有人说话）", async () => {
    const user = userEvent.setup();
    await openPage();
    server.use(
      http.post("*/a/v1/ontology/object-types", () =>
        HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "未知规则 'C_GONE'（对象约束只能引用**已发布**规则；当前已发布 3 条）", requestId: "req_x" } }, { status: 400 }),
      ),
    );
    await user.selectOptions(screen.getByTestId("orel-cf-type"), "Line");
    await waitFor(() => expect((screen.getByTestId("orel-cf-prop") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    const ruleSel = screen.getByTestId("orel-cf-rule") as HTMLSelectElement;
    await user.selectOptions(ruleSel, [...ruleSel.options].map((o) => o.value).find(Boolean)!);
    await user.selectOptions(screen.getByTestId("orel-cf-prop"), "utilization");
    await user.click(screen.getByTestId("orel-cf-add"));
    await waitFor(() => expect(document.body.textContent).toContain("未知规则 'C_GONE'"));
  });
});
