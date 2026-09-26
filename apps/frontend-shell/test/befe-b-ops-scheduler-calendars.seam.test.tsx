import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import {
  fetchCalendar,
  fetchCalendarNetWindow,
  fetchOpsPersonas,
  fetchOpsTickReports,
  fetchSchedulerJobRuns,
  fetchSchedulerJobs,
} from "@/api/endpoints";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-BEFE-B ②③④ · 「行动与审批」组余下三簇「后端注册了、前端零调用」端点
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *   ② S3 定时任务   `GET /scheduler/jobs` · `POST …/pause` · `POST …/resume` · `GET …/runs`
 *   ③ OC9 工厂日历  `GET /calendars/:key` · `PUT` · `GET …/net-window`
 *   ④ 回放编排器    `GET /ops/personas` · `POST /ops/personas/seed` · `GET /ops/playbook`
 *                   · `GET /ops/pools` · `GET /ops/tick-reports`
 *
 * 判据同 ①：走**真 endpoints**（不 `vi.mock` api 层），从真 route 上真实渲染出来的控件驱动，
 * 动作后**重新打一次真 GET** 确认后端态变了 —— 不是"按钮能点"。
 */

describe("WO-BEFE-B ② S3 定时任务台 /admin/scheduler", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("②-A 用户点得到：进 /admin/scheduler → 表格逐行来自 GET /a/v1/scheduler/jobs", async () => {
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");

    const expected = await fetchSchedulerJobs();
    expect(expected.length, "一条定时任务都没有 ⇒ 下面全是空胜").toBeGreaterThan(0);
    for (const j of expected) {
      expect((await screen.findByTestId(`job-${j.id}-status`)).textContent).toBe(j.status);
    }
  });

  it("②-B 接缝真驱动：点「暂停」→ 重取 jobs，后端状态真的变 PAUSED", async () => {
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");

    const before = (await fetchSchedulerJobs()).find((j) => j.status === "ACTIVE");
    expect(before, "没有 ACTIVE 任务 ⇒ 这条用例证明不了暂停").toBeTruthy();

    fireEvent.click(await screen.findByTestId(`job-${before!.id}-toggle`));

    // ★ SEAM 判据：后端态真的迁走（不是屏上 badge 变了）。
    await waitFor(async () => {
      const j = (await fetchSchedulerJobs()).find((x) => x.id === before!.id);
      expect(j!.status, "点了暂停后端还是 ACTIVE ⇒ 按钮是死的").toBe("PAUSED");
    });
  });

  it("②-C 恢复是**反向**动作：PAUSED 的那条点「恢复」→ 后端变 ACTIVE（两条端点不是同一条）", async () => {
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");

    const paused = (await fetchSchedulerJobs()).find((j) => j.status === "PAUSED");
    expect(paused, "没有 PAUSED 任务 ⇒ 证明不了恢复").toBeTruthy();

    fireEvent.click(await screen.findByTestId(`job-${paused!.id}-toggle`));
    await waitFor(async () => {
      const j = (await fetchSchedulerJobs()).find((x) => x.id === paused!.id);
      expect(j!.status, "点了恢复后端还是 PAUSED").toBe("ACTIVE");
    });
  });

  it("②-D 真 URL + 真方法：pause / resume 打的是各自的路径，不是同一条 PATCH", async () => {
    const calls: { url: string; method: string }[] = [];
    server.use(
      http.post("*/a/v1/scheduler/jobs/:id/pause", ({ request, params }) => {
        calls.push({ url: request.url, method: request.method });
        return HttpResponse.json({ id: params.id, status: "PAUSED", kind: "K", refId: "r", cron: "* * * * *", timezone: "UTC", nextRunAt: "2026-06-13T00:00:00Z", tenantId: "t" });
      }),
    );
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");
    const active = (await fetchSchedulerJobs()).find((j) => j.status === "ACTIVE")!;
    fireEvent.click(await screen.findByTestId(`job-${active.id}-toggle`));

    await waitFor(() => expect(calls.length, "点了暂停一个请求都没发").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(decodeURIComponent(calls[0]!.url)).toContain(`/a/v1/scheduler/jobs/${active.id}/pause`);
    expect(decodeURIComponent(calls[0]!.url)).not.toContain("/resume");
  });

  it("②-E 运行历史：点某行 → GET …/:id/runs 逐行上屏，失败必须带原因（不许只显 FAILED）", async () => {
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");

    const jobs = await fetchSchedulerJobs();
    const withRuns = (await Promise.all(jobs.map(async (j) => ({ j, runs: await fetchSchedulerJobRuns(j.id) }))))
      .find((x) => x.runs.length > 0);
    expect(withRuns, "没有任何任务有运行记录 ⇒ 证明不了运行历史").toBeTruthy();

    fireEvent.click(await screen.findByTestId(`job-${withRuns!.j.id}`));
    const table = await screen.findByTestId("runs-table");
    expect(table.getAttribute("data-count")).toBe(String(withRuns!.runs.length));

    // ★ 诚实位：带 error 的那条必须把原因显出来。
    const failed = withRuns!.runs.find((r) => r.error);
    if (failed) {
      expect((await screen.findByTestId(`run-${failed.id}-error`)).textContent).toContain(failed.error!);
    }
  });

  it("②-F 诚实位：PAUSED 且带 lastError 的任务，错误原因在第一层看得见", async () => {
    renderApp("/admin/scheduler");
    await screen.findByTestId("scheduler-page");
    const withErr = (await fetchSchedulerJobs()).find((j) => j.lastError);
    expect(withErr, "种子里没有带 lastError 的任务 ⇒ 证明不了诚实位").toBeTruthy();
    expect((await screen.findByTestId(`job-${withErr!.id}-error`)).textContent).toContain(withErr!.lastError!);
  });
});

describe("WO-BEFE-B ③ OC9 工厂日历 /admin/calendars", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("③-A 用户点得到：进 /admin/calendars → 周末口径与例外日来自 GET /a/v1/calendars/default", async () => {
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");

    const cal = await fetchCalendar("default");
    expect(cal.exceptions.length, "日历没有例外日 ⇒ 下面证明不了什么").toBeGreaterThan(0);
    await waitFor(() =>
      expect((screen.getByTestId("weekend-mode") as HTMLSelectElement).value).toBe(cal.weekendMode),
    );
    for (let i = 0; i < cal.exceptions.length; i++) {
      expect((await screen.findByLabelText(`例外日期 ${i}`)) as HTMLInputElement).toHaveProperty(
        "value",
        cal.exceptions[i]!.date,
      );
    }
  });

  it("③-B 净窗口是**后端算的**：屏上的数 = 再打一次真 net-window 端点的数（前端零复算）", async () => {
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");

    const expected = await fetchCalendarNetWindow("default", "2026-06-01", "2026-06-30");
    // 金丝雀：净天数为 0 说明区间或日历不对，下面的相等会是空胜。
    expect(expected.netProductionDays, "净生产天数为 0 ⇒ 样例失效").toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByTestId("net-days").textContent).toBe(String(expected.netProductionDays)),
    );
  });

  it("③-C 接缝真驱动：加一个 HOLIDAY 并保存 → 后端日历真变，且净生产天数**真的少 1**", async () => {
    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");
    await screen.findByTestId("net-days");

    const before = await fetchCalendarNetWindow("default", "2026-06-01", "2026-06-30");
    const beforeCal = await fetchCalendar("default");

    // 挑一个区间内、当前**是工作日**且尚未被例外覆盖的日子（2026-06-17 周三）。
    const NEW_HOLIDAY = "2026-06-17";
    expect(beforeCal.exceptions.some((e) => e.date === NEW_HOLIDAY), "该日已是例外 ⇒ 换一天").toBe(false);

    fireEvent.click(screen.getByTestId("add-exception"));
    const idx = beforeCal.exceptions.length;
    fireEvent.change(await screen.findByLabelText(`例外日期 ${idx}`), { target: { value: NEW_HOLIDAY } });
    fireEvent.change(screen.getByLabelText(`例外类型 ${idx}`), { target: { value: "HOLIDAY" } });
    fireEvent.click(screen.getByTestId("save-calendar"));

    // ★ 后端日历真的多了这一条。
    await waitFor(async () => {
      const after = await fetchCalendar("default");
      expect(after.exceptions.map((e) => e.date), "保存后后端日历没变 ⇒ PUT 是死的").toContain(NEW_HOLIDAY);
    });
    // ★ 效果层：净生产天数真的少 1（证明 PUT 与 net-window 是同一份日历，不是两套数据）。
    const after = await fetchCalendarNetWindow("default", "2026-06-01", "2026-06-30");
    expect(after.netProductionDays, "加了节假日净天数没变 ⇒ 日历与净窗口没接在一起").toBe(
      before.netProductionDays - 1,
    );
  });

  it("③-D 真 URL：PUT 打的是 `/a/v1/calendars/default`，net-window 带 from/to query", async () => {
    const puts: { url: string; method: string }[] = [];
    const gets: string[] = [];
    server.use(
      http.put("*/a/v1/calendars/:key", async ({ request, params }) => {
        puts.push({ url: request.url, method: request.method });
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: `cal_t_${params.key}`, tenantId: "t", calendarKey: String(params.key), weekendMode: body.weekendMode ?? "SAT_SUN_OFF", exceptions: body.exceptions ?? [], updatedAt: "2026-06-12T00:00:00Z" });
      }),
      http.get("*/a/v1/calendars/:key/net-window", ({ request }) => {
        gets.push(request.url);
        return HttpResponse.json({ calendarKey: "default", from: "2026-06-01", to: "2026-06-30", netProductionDays: 21 });
      }),
    );

    renderApp("/admin/calendars");
    await screen.findByTestId("calendars-page");
    await waitFor(() => expect(gets.length, "净窗口一次都没请求").toBeGreaterThan(0));
    const u = new URL(gets[0]!);
    expect(u.pathname).toContain("/a/v1/calendars/default/net-window");
    expect(u.searchParams.get("from")).toBe("2026-06-01");
    expect(u.searchParams.get("to")).toBe("2026-06-30");

    fireEvent.click(screen.getByTestId("save-calendar"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]!.method).toBe("PUT");
    expect(decodeURIComponent(puts[0]!.url)).toContain("/a/v1/calendars/default");
  });
});

describe("WO-BEFE-B ④ 虚拟操作团队与剧本（/admin/ops-schedule D 段）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("④-A 用户点得到：进 /admin/ops-schedule → D 段人格表逐行来自 GET /a/v1/ops/personas", async () => {
    renderApp("/admin/ops-schedule");
    await screen.findByTestId("virtual-ops-panel");

    const expected = await fetchOpsPersonas();
    expect(expected.items.length, "没有虚拟人格 ⇒ 空胜").toBeGreaterThan(0);
    const table = await screen.findByTestId("personas-table");
    expect(table.getAttribute("data-count")).toBe(String(expected.items.length));
    for (const p of expected.items) {
      expect(await screen.findByTestId(`persona-${p.username}`)).toBeInTheDocument();
    }
  });

  it("④-B 剧本 / tick 报告 / 文本池三块都真下发（四条端点各自有屏上落点）", async () => {
    renderApp("/admin/ops-schedule");
    await screen.findByTestId("virtual-ops-panel");

    // 剧本：key 与 version 来自响应
    expect((await screen.findByTestId("playbook-key")).textContent).toBe("default-ops");
    expect((await screen.findByTestId("playbook-version")).textContent).toBe("v3");

    // tick 报告：行数 = 响应条数，且执行/跳过计数逐条相等
    const ticks = await fetchOpsTickReports();
    expect(ticks.items.length, "无 tick 报告 ⇒ 空胜").toBeGreaterThan(0);
    const tbl = await screen.findByTestId("ticks-table");
    expect(tbl.getAttribute("data-count")).toBe(String(ticks.items.length));
    for (const r of ticks.items) {
      expect(screen.getByTestId(`tick-${r.tick}-executed`).textContent).toContain(String(r.executed.length));
      expect(screen.getByTestId(`tick-${r.tick}-skipped`).textContent).toContain(String(r.skipped.length));
    }

    // 文本池
    expect(await screen.findByTestId("pools-box")).toBeInTheDocument();
  });

  it("④-C 诚实空分得开：读不到人格时说的是「本就不该有 / 还没播种」，不是一句「暂无数据」", async () => {
    server.use(http.get("*/a/v1/ops/personas", () => HttpResponse.json({ items: [] })));
    renderApp("/admin/ops-schedule");
    await screen.findByTestId("virtual-ops-panel");

    const empty = await screen.findByTestId("personas-empty");
    // 两种原因都必须写出来（隔离语义不能只活在后端）。
    expect(empty.textContent).toContain("SYNTHETIC");
    expect(empty.textContent).toContain("播种");
    expect(screen.queryByTestId("personas-table"), "空却渲染了表 ⇒ 里面是编的行").toBeNull();
  });

  it("④-D 播种是真写：点「播种默认团队」→ POST /ops/personas/seed（真 URL、真方法）", async () => {
    const calls: { url: string; method: string }[] = [];
    server.use(
      http.get("*/a/v1/ops/personas", () => HttpResponse.json({ items: [] })),
      http.post("*/a/v1/ops/personas/seed", ({ request }) => {
        calls.push({ url: request.url, method: request.method });
        return HttpResponse.json({ items: [{ username: "vp_probe", roles: ["planner"], attributes: {}, isVirtual: true, styleSeed: 1 }] }, { status: 201 });
      }),
    );
    renderApp("/admin/ops-schedule");
    await screen.findByTestId("virtual-ops-panel");
    fireEvent.click(await screen.findByTestId("seed-personas"));

    await waitFor(() => expect(calls.length, "点了播种一个请求都没发").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("/a/v1/ops/personas/seed");
  });
});

describe("WO-BEFE-B ②③④ 不是死页面 · 可达性与分诊结论", () => {
  it("②③-G 两个新页真的注册进了路由与**两处**分组源（只改一处会掉进「其它」兜底桶）", () => {
    const app = checkedTree("apps/frontend-shell/src", "admin(\"actions\"", 100);
    expect(factHits(app, "admin(\"actions\""), "金丝雀未中 ⇒ 扫描坏了").not.toEqual([]);
    expect(factHits(app, "admin(\"scheduler\""), "scheduler 没注册路由 ⇒ 点进去 404").not.toEqual([]);
    expect(factHits(app, "admin(\"calendars\""), "calendars 没注册路由").not.toEqual([]);

    // 两处分组源都必须含新页（adminRegistry.ADMIN_NAV_GROUPS 与 ShellLayout.NAV_GROUPS）。
    const pages = checkedTree("apps/frontend-shell/src/pages", "运营与审批", 5);
    const opsGroupLines = factHits(pages, /"运营与审批"[\s\S]{0,200}?scheduler[\s\S]{0,80}?calendars/);
    expect(opsGroupLines.length, "两处「运营与审批」分组里没有同时出现 scheduler+calendars ⇒ 有一处漏登记").toBe(2);
  });

  it("④-E 分诊留证：**不接** ops/auto-ask（后端无条件 403），前端不许出现这个 URL", () => {
    const fe = checkedTree("apps/frontend-shell/src", "/a/v1/ops/", 100);
    // 金丝雀：同法先抓已知必在的 ops URL，抓不到说明读法坏了而不是真没有（铁律 0.6）。
    expect(factHits(fe, "/a/v1/ops/personas"), "金丝雀未中 ⇒ 下面的「不存在」不可信").not.toEqual([]);
    expect(factHits(fe, "/a/v1/ops/playbook"), "金丝雀② 未中").not.toEqual([]);
    // ★ 否定结论（有金丝雀佐证）：auto-ask 按设计不接。
    expect(factHits(fe, "/a/v1/ops/auto-ask"), "接了 auto-ask ⇒ 造了一个必然 403 的死控件").toEqual([]);
  });
});
