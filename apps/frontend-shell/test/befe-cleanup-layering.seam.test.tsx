import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createIntent, fetchCalendar } from "@/api/endpoints";
import { PACKAGE_ID } from "@/mocks/ids";
import zh from "@/locales/zh";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-CLEANUP · **信息分层的接缝测试**
 * （规范 `docs/CONVENTION-ui-information-layering.md` §1「三层准入」/ §2 R-UI-3）。
 *
 * ══ 为什么这条测试非写不可 ═══════════════════════════════════════════════════
 * 门 `check-ui-first-layer.mjs` 数的是**源码里的静态形状**（first / deferred / formula / prose）。
 * 它能证明「这段字串不再出现在第一层的 AST 位置上」，**证明不了**三件事：
 *   ① 降下去的内容**默认真的看不见**（`open===false` 时 InfoPopover 根本不渲染，
 *      而不是 `hidden` 一藏了事 —— 藏起来的东西照样进 DOM、照样被读屏念）；
 *   ② **真的用鼠标/键盘能把它调出来**（不是"DOM 里查得到"）；
 *   ③ 第一层**还留着可见记号**（规范 §1：静默降层等于删除）。
 * 也就是说：**门绿 ≠ 分层做对了**。三条判据全是运行时的，只有真渲染才验得到 ——
 * 这正是本仓「绿测试 ≠ 能用·断在接缝」那条老账要求的驱动方式。
 *
 * ══ 判据（每条都咬"效果"，不咬"写法"）════════════════════════════════════════
 *  A 真 workspace → 真 route → 真 endpoints（**不** `vi.mock` api 层）→ 屏上真有后端数据；
 *  B 浮层正文**默认不在 DOM**；`user.hover(?)` 之后**真的可见**（`toBeVisible`）；
 *  C 第一层留着 `?` 记号，且它**默认就可见**（不是 hover 才显形）；
 *  D **降层 ≠ 删除**：原文里那几个关键字，降层后必须仍然在浮层里找得到；
 *  E 分层改动**没有碰坏接缝**：改完照旧打真 URL + 真方法（PUT）。
 *
 * ⚠ 断言写法上刻意**不用** `expect(queryByTestId(x)).not.toBeVisible()`：
 *    元素不存在时 `queryByTestId` 返回 `null`，jest-dom 的 `toBeVisible` 拿 null 会抛
 *    「received value must be an HTMLElement」——那是**测试自己报错**，不是判据成立。
 *    默认态用 `toBeNull()`（本组件 `open===false` 直接不渲染），
 *    可见态用 `toBeVisible()`；两句合起来才是"默认不可见 → 触发后可见"。
 */

const L = zh.admin.layer;

describe("WO-BEFE-CLEANUP · UI 信息分层接缝（/admin/calendars 为落点）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("A 真链路：真 workspace → /admin/calendars → 周末制式的值来自 GET /a/v1/calendars/default", async () => {
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");

    const cal = await fetchCalendar("default");
    // 金丝雀：后端没给 weekendMode ⇒ 下面的相等是空胜，先把工具自证一遍。
    expect(cal.weekendMode, "后端日历没有 weekendMode ⇒ 本条证明不了什么").toBeTruthy();
    await waitFor(() =>
      expect((screen.getByTestId("weekend-mode") as HTMLSelectElement).value).toBe(cal.weekendMode),
    );
  });

  it("B+C+D 降层三判据：`?` 记号默认可见 · 正文默认不在 DOM · hover 后真可见且原文还在", async () => {
    const user = userEvent.setup();
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");

    // ── C 第一层记号：`?` 触发器**默认就看得见**（规范 §1「静默降层等于删除」）。
    const trigger = await screen.findByTestId("info-cal-weekend");
    expect(trigger, "第一层没有 `?` 记号 ⇒ 这是静默降层 = 删除").toBeVisible();

    // ── B① 默认态：浮层正文**根本不在 DOM**（不是 hidden）。
    expect(
      screen.queryByTestId("info-body-cal-weekend"),
      "浮层正文默认就在 DOM 里 ⇒ 它没起到收纳作用（读屏照样念、门也白降）",
    ).toBeNull();

    // ── B② 触发态：真 hover（不是查 DOM、不是直接 setState）。
    await user.hover(trigger);
    const body = await screen.findByTestId("info-body-cal-weekend");
    expect(body, "hover 之后浮层没出来 ⇒ 内容被降没了").toBeVisible();

    // ── D 降层 ≠ 删除：原标签「周末口径」四个字与三个后端枚举的口径，必须都还在。
    expect(body.textContent).toContain(L.calWeekendTopic); // 「周末口径」——原第一层标签的原文
    for (const mode of ["SAT_SUN_OFF", "SUN_OFF", "NONE"]) {
      expect(body.textContent, `浮层里没有 ${mode} 的口径 ⇒ 降层时把内容丢了`).toContain(mode);
    }

    // ── B③ 移开即收（规范 §2「悬停显示 · 移开立即消失」）。
    await user.unhover(screen.getByTestId("info-wrap-cal-weekend"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("info-body-cal-weekend"),
        "移开鼠标浮层还赖着 ⇒ 它会挡住下面的内容",
      ).toBeNull(),
    );
  });

  it("C' 净生产窗口那条同判据：口径降层后，第一层留的是**数值**不是公式", async () => {
    const user = userEvent.setup();
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");

    // 第一层留的是**结论性数字**（规范 §1：数字不许只藏在浮层里）。
    const days = await screen.findByTestId("net-days");
    expect(days).toBeVisible();
    expect(Number(days.textContent), "净生产天数不是个数 ⇒ 第一层留错了东西").toBeGreaterThan(0);

    // 而「怎么算出来的」在浮层里，且默认不可见。
    expect(screen.queryByTestId("info-body-cal-net")).toBeNull();
    await user.hover(await screen.findByTestId("info-cal-net"));
    const body = await screen.findByTestId("info-body-cal-net");
    expect(body).toBeVisible();
    expect(body.textContent, "净天数的口径没跟着降下来").toContain("netProductionDays");
  });

  it("E 分层没碰坏接缝：改完照旧打真 URL + 真方法 —— PUT /a/v1/calendars/default", async () => {
    const user = userEvent.setup();
    const puts: { url: string; method: string }[] = [];
    server.use(
      http.put("*/a/v1/calendars/:key", async ({ request, params }) => {
        puts.push({ url: request.url, method: request.method });
        const b = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: `cal_t_${params.key}`,
          tenantId: "t",
          calendarKey: String(params.key),
          weekendMode: b.weekendMode ?? "SAT_SUN_OFF",
          exceptions: b.exceptions ?? [],
          updatedAt: "2026-06-12T00:00:00Z",
        });
      }),
    );

    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");
    await waitFor(() => expect((screen.getByTestId("weekend-mode") as HTMLSelectElement).value).toBeTruthy());

    await user.click(screen.getByTestId("save-calendar"));
    await waitFor(() => expect(puts.length, "保存没发出任何请求 ⇒ 接缝被改坏了").toBe(1));
    // ★ 方法维要单独咬 —— 门在前端侧只比路径不比方法，这里补上。
    expect(puts[0]!.method).toBe("PUT");
    expect(decodeURIComponent(puts[0]!.url)).toContain("/a/v1/calendars/default");
  });
});

/**
 * 第二组：**状态留第一层、只降解释** —— 本单最要紧的那条纪律。
 *
 * 降层最容易做坏的方式不是"没降下去"，而是**把状态一起降下去** ——
 * 用户不点就不知道这条链今天是断的。故这一组咬的是「状态词**没**跟着走」。
 *
 * 走真 API 造一条 DRAFT 意图（种子里 4 条意图全 PUBLISHED、4 个计划全已绑且全 PUBLISHED，
 * 「未绑定」这一支在默认世界里根本不出现 —— 不造就只能写一条空胜的用例）。
 */
describe("WO-BEFE-CLEANUP · 状态留第一层，只有「凭什么」降浮层（/admin/catalog）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("F 未绑定执行计划：状态在第一层可见，后果解释默认不在 DOM、hover 后才有", async () => {
    const user = userEvent.setup();
    const key = `befe_cleanup_probe_${Date.now()}`;
    await createIntent(PACKAGE_ID, {
      key,
      name: "WO-BEFE-CLEANUP 分层探针意图",
      description: "",
      examples: [],
      slots: [],
      planId: "",
      riskLevel: "READ",
      owner: "admin",
      enabledViews: "*",
    });

    renderApp("/admin/catalog");
    await waitFor(() => expect(screen.getByTestId(`intent-${key}`)).toBeTruthy());
    await user.click(screen.getByTestId(`intent-${key}`));
    await screen.findByTestId("intent-editor");

    // ★ 状态词**留在第一层**且可见 —— 不点就得知道这条链是断的。
    const unbound = await screen.findByTestId("plan-editor-unbound");
    expect(unbound).toBeVisible();
    expect(unbound.textContent, "状态词跟着解释一起降下去了 ⇒ 用户不点就不知道链断了").toContain(
      "未绑定执行计划",
    );

    // ★ 而「后果」（执行期解析不到计划）默认不在 DOM。
    expect(screen.queryByTestId("info-body-catalog-risk-unbound")).toBeNull();
    await user.hover(screen.getByTestId("info-catalog-risk-unbound"));
    const body = await screen.findByTestId("info-body-catalog-risk-unbound");
    expect(body).toBeVisible();
    // D 守恒：原文里的关键后果一个字没丢。
    expect(body.textContent).toContain("执行期解析不到计划");
    expect(body.textContent).toContain("QOS 路径 A");
  });
});
