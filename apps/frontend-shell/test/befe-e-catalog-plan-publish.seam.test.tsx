import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { fetchPlans } from "@/api/endpoints";
import { db } from "@/mocks/db";
import { PACKAGE_ID } from "@/mocks/ids";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ② · **执行计划「建得出 · 改不了 · 发不了」的接缝门**
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `PUT  /api/v1/catalog/plans/:planId`          agentcore `server.ts:653`（requireRole catalog_admin）
 *     `POST /api/v1/catalog/plans/:planId/publish`  agentcore `server.ts:661`（同上）
 *     （前端经 `/b/v1` 别名重写打同一处 —— `deploy/nginx.conf` 与 server 的 rewriteUrl 表）
 *
 * ── 这条门要证的那件事：**这是一条真死路，不是"少个编辑器"** ──────────────────────
 * `CatalogPage` 的「＋新建执行计划」造出 `status:"DRAFT"`（agentcore `catalog/service.ts:238`）+
 * 一份写死的两步骨架。意图侧照样能保存、能发布 —— 发布前校验走
 * `resolvePlanByRef(..., {forValidation:true})`（service.ts:191），该档**允许回落到未发布的最高版本**
 * （service.ts:76-79）。而**执行期**解析走缺省档 `resolvePlanForIntent`（service.ts:82），
 * 只认 `status === "PUBLISHED"`（service.ts:74），拿不到 `return undefined`。
 * ⇒ **意图发布成功、屏上一片绿、真跑起来永远解析不到计划**。两条端点零前端调用方 = 这条链没有出口。
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ──────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉。本文件走真 endpoints，在 MSW 层拦真 URL + 真 body/method。
 *
 * ── MSW 桩与后端为何不会漂移 ──────────────────────────────────────────────────
 * 三条状态机判据照抄后端 `catalog/service.ts:243/:271/:276`，**一条都不放宽**：
 * 非 DRAFT 改/发 → 409 `INVALID_STATE`；步骤不以 `render_answer` 收尾 → 400 `PLAN_VALIDATION_ERROR`。
 * 桩放宽了，"发不出去时屏上说什么"这一支就永远测不到，而那正是用户最常撞的墙。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 打开 catalog 页并选中一个意图（编辑器里才有计划区）。 */
async function openIntent(key: string) {
  renderApp("/admin/catalog");
  await waitFor(() => expect(screen.getByTestId(`intent-${key}`)).toBeTruthy());
  await userEvent.click(screen.getByTestId(`intent-${key}`));
  await screen.findByTestId("intent-editor");
}

/** 建一个 DRAFT 计划并把绑定切到它上面（走屏上的真按钮，不是往 db 里塞）。 */
async function createAndBindDraft(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  const before = new Set((await fetchPlans(PACKAGE_ID)).map((p) => p.id));
  await user.click(screen.getByTestId("plan-create"));
  await waitFor(() => expect(screen.getByTestId("plan-editor").getAttribute("data-plan-status")).toBe("DRAFT"));
  const created = (await fetchPlans(PACKAGE_ID)).find((p) => !before.has(p.id))!;
  expect(created, "「＋新建执行计划」没造出新行 ⇒ 后面全是空胜").toBeTruthy();
  return created.id;
}

describe("WO-BEFE-E ② 执行计划改 / 发（PUT …/plans/:id · POST …/plans/:id/publish）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("②-A 用户看得到那条死路：新建的计划是 DRAFT，且第一层写明「执行期解析不到」", async () => {
    const user = userEvent.setup();
    await openIntent("adopt_mitigation");
    await createAndBindDraft(user);

    const warn = screen.getByTestId("plan-draft-warning");
    // 诚实位必须说清楚**后果**（执行期解析不到），不是一句"未发布"。
    expect(warn.textContent).toContain("执行期解析不到");
    expect(screen.getByTestId("plan-editor-status").textContent).toBe("DRAFT");
  });

  it("②-B 真 URL + 真 method/body：改步骤 → PUT …/catalog/plans/<id>，body.steps = 编辑框里那份", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    await openIntent("adopt_mitigation");
    const planId = await createAndBindDraft(user);

    server.use(
      http.put("*/b/v1/catalog/plans/:planId", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ id: planId, packageId: PACKAGE_ID, key: "probe_key", version: 1, status: "DRAFT", steps: [] });
      }),
    );

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    await user.clear(editor);
    // 刻意一份**与骨架完全不同**的步骤：body 里若还是骨架，说明发的是写死的默认值。
    await user.type(
      editor,
      '[{{"id":"probe","type":"render_answer","params":{{"blocks":[]}}}}]'.replace(/\{\{/g, "{").replace(/\}\}/g, "}"),
    );
    await user.click(screen.getByTestId("plan-save"));

    await waitFor(() => expect(calls.length, "点了保存一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain(`/catalog/plans/${planId}`);
    expect(calls[0]!.body).toEqual({ steps: [{ id: "probe", type: "render_answer", params: { blocks: [] } }] });
  });

  it("②-C 效果层（本门的要害）：发布 → 计划真的从 DRAFT 变 PUBLISHED，影响面来自响应", async () => {
    const user = userEvent.setup();
    await openIntent("adopt_mitigation");
    const planId = await createAndBindDraft(user);

    // 骨架已以 render_answer 收尾（CatalogPage `createPlanMut` 的模板），故这一发应当成功。
    await user.click(screen.getByTestId("plan-publish"));

    // ★ 后端侧真变了（读的是真 `GET …/plans`，不是读组件 state）。
    await waitFor(async () => {
      const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
      expect(truth.status, "发布后后端仍是 DRAFT ⇒ 只改了屏，没改库").toBe("PUBLISHED");
    });
    // ★ 屏上跟着变：DRAFT 警示消失、状态徽章翻绿、编辑按钮收起（PUBLISHED 不可改，后端 409）。
    await waitFor(() => expect(screen.getByTestId("plan-editor-status").textContent).toBe("PUBLISHED"));
    expect(screen.queryByTestId("plan-draft-warning"), "已发布还挂着「执行期解析不到」⇒ 诚实位说谎了").toBeNull();
    expect(screen.queryByTestId("plan-publish"), "PUBLISHED 还留着发布按钮 ⇒ 点了必 409").toBeNull();
    // ★ 影响面是**响应里**那个数（引用它的意图数），不是前端数出来的。
    const impact = screen.getByTestId("plan-publish-impact");
    expect(within(impact).getByTestId("plan-impact-intents").textContent).toBe(
      String(db.intents.filter((i) => i.status !== "RETIRED" && i.planId === planId).length),
    );
  });

  it("②-D 后端校验失败不许吞：步骤不以 render_answer 收尾 → 400 原文亮在屏上，状态仍是 DRAFT", async () => {
    const user = userEvent.setup();
    await openIntent("adopt_mitigation");
    const planId = await createAndBindDraft(user);

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(
      editor,
      '[{{"id":"s1","type":"query_objects","params":{{"objectType":"Order","filter":{{}}}}}}]'
        .replace(/\{\{/g, "{")
        .replace(/\}\}/g, "}"),
    );
    await user.click(screen.getByTestId("plan-save"));
    await waitFor(async () => {
      const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
      expect(truth.steps.length, "保存没落到后端 ⇒ 下面的发布失败测的不是这份步骤").toBe(1);
    });

    await user.click(screen.getByTestId("plan-publish"));
    const box = await screen.findByTestId("plan-publish-error");
    // 后端原文（`render_answer` 收尾）必须照显，不许换成一句"发布失败"。
    expect(box.textContent).toContain("render_answer");
    // ★ 失败后状态不许被前端乐观翻绿。
    const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
    expect(truth.status).toBe("DRAFT");
    expect(screen.getByTestId("plan-editor-status").textContent).toBe("DRAFT");
  });

  it("②-E JSON 写坏了当场说、且不发请求（把 400 换成一句本地原文错误）", async () => {
    const user = userEvent.setup();
    let putHits = 0;
    await openIntent("adopt_mitigation");
    await createAndBindDraft(user);
    server.use(
      http.put("*/b/v1/catalog/plans/:planId", () => {
        putHits += 1;
        return HttpResponse.json({});
      }),
    );

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "not json at all");
    await user.click(screen.getByTestId("plan-save"));

    expect((await screen.findByTestId("plan-steps-error")).textContent).toContain("解析失败");
    expect(putHits, "JSON 都没解析成功还发了请求 ⇒ 把本地错误推给了后端").toBe(0);
  });

  it("②-F 不是死组件：`PlanEditor` 真的挂在 CatalogPage，两条 URL 真在 endpoints.ts 里", () => {
    const page = readRepoFile("../src/pages/admin/CatalogPage.tsx");
    expect(page.length, "CatalogPage.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(page).toContain("<PlanEditor plan=");
    expect(page).toContain("publishPlan");
    expect(page).toContain("updatePlan");

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：先抓一个**已知必在**的同族 URL；抓不到说明读法坏了，而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/b/v1/catalog/packages/${packageId}/plans");
    expect(eps).toContain("/b/v1/catalog/plans/${encodeURIComponent(planId)}`");
    expect(eps).toContain("/b/v1/catalog/plans/${encodeURIComponent(planId)}/publish`");
  });
});
