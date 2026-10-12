import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { fetchSolverArtifacts } from "@/api/endpoints";
import { checkedTree, factHits } from "./factlock";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ⑤ · **求解器治理三条端点的接缝门**
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `POST /a/v1/solvers/generate`         datacore  `app.ts:3574`（requireAdmin）
 *     `GET  /b/v1/solvers/:key/references`  agentcore `server.ts:1270`
 *     `GET  /a/v1/solvers/:key/field-roles` datacore  `app.ts:3609`
 *
 * ── ⑤① `generate` 是**整页级别**的缺口，不是"少个按钮"（追到底才敢这么说）─────────
 * `solverArtifacts` 这张表的唯一写者是 `registerProvisionalSolver`
 * （`apps/datacore/src/solvers/service.ts:599`/`:626`）← 唯一被 `generateProvisionalSolver`（`:545`）调
 * ← 唯一被本端点调（`app.ts:3579`）；`seed.ts` 里**一条种子都没有**。
 * ⇒ 本端点零前端调用方 = `/admin/solver-review` 这一整页在生产里永远是空的，
 *   而它的空态还写着「LLM 生成后在此审核」—— 把「没有入口」说成了「还没有人生成」。
 *
 * ── R4 判定（写进本门，免得后人重判）────────────────────────────────────────
 * 生成**不写业务真值**：产物是 `PROVISIONAL` + `UNVERIFIED` 的冻结代码。
 * 用它写真值另受两道**已在前端接好**的闸：`write-truth-check`（仅创建人）与 `promote`（人工审批 → GOVERNED）。
 * R4 的闸在下游且已接 ⇒ 本条无需经 Action 审批链。⑤-B 用「新件必须是 PROVISIONAL/UNVERIFIED」把它咬住。
 *
 * ── ⑤②③ 目录页只回答了「有哪些」，没回答「动了谁会疼 / 它绑到哪」────────────────
 * 同族的 `/a/v1/rules/:id/references` 早有前端调用方（`fetchRuleReferences`），求解器这条被落下了。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("WO-BEFE-E ⑤① 生成临时求解器（POST /a/v1/solvers/generate）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("⑤-A 真 URL + 真 body：填 key/intent → 点生成 → POST /a/v1/solvers/generate", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    renderApp("/admin/solver-review");
    await screen.findByTestId("solver-review-page");

    server.use(
      http.post("*/a/v1/solvers/generate", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json(
          {
            id: "sart_probe", tenantId: "demo", key: "probe_solver", version: 1,
            status: "PROVISIONAL", origin: "LLM_GENERATED", trustLevel: "UNVERIFIED",
            computeSource: "export function compute(){return{}}", rationale: "探针",
            hash: "probehash", outputShape: [], createdBy: "admin", createdAt: "2026-08-14T00:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );

    await user.type(screen.getByTestId("solver-gen-key"), "probe_solver");
    await user.type(screen.getByTestId("solver-gen-intent"), "算供应商交期风险");
    await user.click(screen.getByTestId("solver-gen-submit"));

    await waitFor(() => expect(calls.length, "点了生成一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain("/a/v1/solvers/generate");
    // ★ body 逐字段来自表单（不是写死的默认值）。
    expect(calls[0]!.body).toEqual({ key: "probe_solver", intent: "算供应商交期风险" });
  });

  it("⑤-B 效果层 + R4：生成后审核台真多一条，且新件必须是 PROVISIONAL / 未认证（写真值仍锁着）", async () => {
    const user = userEvent.setup();
    renderApp("/admin/solver-review");
    await screen.findByTestId("solver-review-page");
    const before = (await fetchSolverArtifacts()).artifacts.length;

    await user.type(screen.getByTestId("solver-gen-key"), "probe_lead_time");
    await user.type(screen.getByTestId("solver-gen-intent"), "算交期风险");
    await user.click(screen.getByTestId("solver-gen-submit"));

    // ★ 后端侧真多了一条（读的是真端点，不是读组件 state）。
    await waitFor(async () => {
      const after = (await fetchSolverArtifacts()).artifacts;
      expect(after.length, "生成后后端没多出制品 ⇒ 只改了屏，没改库").toBe(before + 1);
      const made = after.find((a) => a.key === "probe_lead_time")!;
      // ★ R4 判据：新件**不得**直接可写真值 —— 状态 PROVISIONAL、信任级 UNVERIFIED。
      expect(made.status, "新生成的临时件直接是 GOVERNED ⇒ 绕过了 R4 人工闸").toBe("PROVISIONAL");
      expect(made.trustLevel).toBe("UNVERIFIED");
    });
    // ★ 屏上：那一行出现，且带着「晋升 GOVERNED」这颗**下游闸**的按钮（不是自动就绿）。
    const row = await screen.findByTestId("solver-artifact-probe_lead_time");
    expect(within(row).getByTestId("solver-status-probe_lead_time").textContent).toBe("审核中");
    expect(within(row).getByTestId("solver-promote-probe_lead_time")).toBeInTheDocument();
  });

  it("⑤-C 后端拒绝不许吞：409 原文亮在屏上，列表不许乐观多一行", async () => {
    const user = userEvent.setup();
    renderApp("/admin/solver-review");
    await screen.findByTestId("solver-review-page");
    const before = (await fetchSolverArtifacts()).artifacts.length;
    server.use(
      http.post("*/a/v1/solvers/generate", () =>
        HttpResponse.json({ error: { code: "INVALID_STATE", message: "求解器 dup_key 已存在临时件", requestId: "req_g" } }, { status: 409 }),
      ),
    );

    await user.type(screen.getByTestId("solver-gen-key"), "dup_key");
    await user.type(screen.getByTestId("solver-gen-intent"), "重复");
    await user.click(screen.getByTestId("solver-gen-submit"));

    expect((await screen.findByTestId("solver-gen-error")).textContent).toContain("已存在临时件");
    expect((await fetchSolverArtifacts()).artifacts.length).toBe(before);
  });
});

describe("WO-BEFE-E ⑤②③ 求解器牵连与接地（GET /b/v1/solvers/:key/references · GET /a/v1/solvers/:key/field-roles）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  /**
   * 让目录页真的列出这几个 key（默认桩 `MOCK_SOLVER_REGISTRY` 只有 4 个代表性求解器，
   * 其中一个都不在后端 `SOLVER_FIELD_ROLES` 的四个之列）。
   * ⚠ 只换**注册表**这一条，`references`/`field-roles` 仍走各用例自己的桩或默认桩 ——
   *   换多了就等于把本门要验的那两跳也一起 mock 掉。
   */
  function registryWith(keys: string[]) {
    server.use(
      http.get("*/a/v1/solvers/registry", () =>
        HttpResponse.json({
          solvers: keys.map((key) => ({ key, name: key, description: `${key} 探针`, argHints: {}, domain: "generic", outputShape: [] })),
        }),
      ),
    );
  }

  /** 打开目录页并展开某条求解器的「牵连与接地」（第二层：点一次才出）。 */
  async function openImpact(user: ReturnType<typeof userEvent.setup>, key: string) {
    renderApp("/admin/solvers");
    await screen.findByTestId("solvers-page");
    await waitFor(() => expect(screen.getByTestId(`solver-row-${key}`)).toBeTruthy());
    // 第二层纪律：默认不渲染，点了才有。
    expect(screen.queryByTestId(`solver-impact-${key}`), "牵连面板默认就在第一层 ⇒ 分层没做").toBeNull();
    await user.click(screen.getByTestId(`solver-detail-toggle-${key}`));
    await screen.findByTestId(`solver-impact-${key}`);
  }

  /**
   * WO-REFERENCES-FAMILY 后：引用反查那半块换成了共享件 `<ReferencesPanel kind="solver">`，
   * 它自己也是折叠的（第一层只留「N 处引用 ▸」记号）。要看逐条明细得再点一次。
   * testid 由共享件按 `${kind}-${id}` 生成 —— 求解器这里就是 `solver-<key>`。
   */
  async function expandRefs(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.click(screen.getByTestId(`references-toggle-solver-${key}`));
    await screen.findByTestId(`references-body-solver-${key}`);
  }

  it("⑤-D 真 URL：展开 → 两条端点各打一次，路径带 solverKey", async () => {
    const user = userEvent.setup();
    const refCalls: string[] = [];
    const roleCalls: string[] = [];
    registryWith(["concentration_risk"]);
    server.use(
      http.get("*/b/v1/solvers/:key/references", ({ request }) => {
        refCalls.push(request.url);
        return HttpResponse.json({ references: [{ kind: "workflow", key: "wf_probe", name: "探针流程", via: "steps[].invoke_solver.solverKey" }], count: 1 });
      }),
      http.get("*/a/v1/solvers/:key/field-roles", ({ request }) => {
        roleCalls.push(request.url);
        return HttpResponse.json({ solverKey: "concentration_risk", roles: { rootType: "ProbeType" }, candidates: { rootType: [{ value: "ProbeType", score: 4, signals: ["fanIn"] }] }, confidence: 0.9, ambiguous: false });
      }),
    );
    await openImpact(user, "concentration_risk");

    await waitFor(() => expect(refCalls.length, "展开后引用反查一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    await waitFor(() => expect(roleCalls.length, "展开后角色解析一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(refCalls[0]!, `打错端点：${refCalls[0]!}`).toContain("/b/v1/solvers/concentration_risk/references");
    expect(roleCalls[0]!, `打错端点：${roleCalls[0]!}`).toContain("/a/v1/solvers/concentration_risk/field-roles");

    // ★ 屏上逐项来自响应（引用条目 + 绑定目标 + 置信度），零写死。
    expect(screen.getByTestId("references-count-solver-concentration_risk").textContent).toContain("1 处引用");
    await expandRefs(user, "concentration_risk");
    expect(screen.getByTestId("references-item-solver-concentration_risk-workflow-wf_probe").textContent).toContain("wf_probe");
    expect(screen.getByTestId("solver-role-concentration_risk-rootType").textContent).toBe("ProbeType");
    expect(screen.getByTestId("solver-roles-confidence-concentration_risk").textContent).toContain("0.90");
  });

  it("⑤-E 「查不出来」不许塌成「没人引用」：references 500 → 明说这次没查到，且不渲染任何计数", async () => {
    const user = userEvent.setup();
    registryWith(["concentration_risk"]);
    server.use(
      http.get("*/b/v1/solvers/:key/references", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "反查炸了", requestId: "req_s" } }, { status: 500 }),
      ),
    );
    await openImpact(user, "concentration_risk");
    await expandRefs(user, "concentration_risk");

    const box = await screen.findByTestId("references-error-solver-concentration_risk");
    expect(box.textContent).toContain("不等于");
    // ★ 反证核心：**不许**渲染出计数（渲染出来就把"没查到"塌成了 0）。
    expect(screen.queryByTestId("references-count-solver-concentration_risk"), "查不出来却渲染了计数 ⇒ 把风险藏起来了").toBeNull();
  });

  it("⑤-F 「不吃角色」与「解析失败」分得开：无声明的求解器显式说明，不画空面板", async () => {
    const user = userEvent.setup();
    registryWith(["capacity_forecast", "shared_bottleneck"]);
    // `capacity_forecast` 不在后端 SOLVER_FIELD_ROLES 的四个之列 ⇒ 空 roles。
    await openImpact(user, "capacity_forecast");
    const none = await screen.findByTestId("solver-roles-none-capacity_forecast");
    expect(none.textContent).toContain("不是解析失败");
    expect(screen.queryByTestId("solver-roles-capacity_forecast"), "空 roles 却渲染了绑定表 ⇒ 表里是编的行").toBeNull();
    // 对照组：有声明的那个必须真的渲染出绑定（否则上一条是空胜）。
    await user.click(screen.getByTestId("solver-detail-toggle-capacity_forecast"));
    await user.click(screen.getByTestId("solver-detail-toggle-shared_bottleneck"));
    await screen.findByTestId("solver-roles-shared_bottleneck");
    expect(screen.getByTestId("solver-role-shared_bottleneck-resourceType").textContent!.length).toBeGreaterThan(0);
  });

  it("⑤-G 不是死组件：三条 URL 真有生产调用方，面板真有挂载点", () => {
    /*
     * ⚠ 判据从「某个写死页面文件的文本」搬到**整棵前端源码树**（`./factlock`，剥注释后）——
     * 除了那一条**页作用域的否定断言**（见下），它天生带文件主语，必须留在原地。
     * 原写法的两个错误方向见 `./factlock` 顶注：搬家假红 · 注释假绿。
     * 「面板真的挂在两个页上」另有更硬的其人：⑤-A…⑤-F 全是 `renderApp("/admin/solver-review")`
     * 与 `renderApp("/admin/solvers")` 端到端真跑。
     */
    const fe = checkedTree("apps/frontend-shell/src", '<SolverImpactPanel solverKey=', 100);
    expect(factHits(fe, 'data-testid="solver-gen-submit"'), "生成入口零生产挂载点").not.toEqual([]);
    expect(factHits(fe, "<SolverImpactPanel solverKey="), "影响面板零生产挂载点").not.toEqual([]);
    expect(factHits(fe, '<ReferencesPanel kind="solver"'), "共享引用面板零生产挂载点").not.toEqual([]);
    for (const fn of ["generateProvisionalSolver", "fetchSolverFieldRoles"]) {
      expect(
        factHits(fe, new RegExp(`(?:queryFn|mutationFn):\\s*${fn}\\b|\\b${fn}\\s*\\(`)),
        `${fn} 零生产调用方（只有声明/只有 import = 没接线）`,
      ).not.toEqual([]);
    }
    // 两条 URL：锁「在不在前端生产代码里」，不锁「在 endpoints.ts 这个文件里」。
    expect(factHits(fe, "/b/v1/solvers/${encodeURIComponent(id)}/references`"), "求解器引用反查 URL 没接").not.toEqual([]);
    expect(factHits(fe, "/a/v1/solvers/${encodeURIComponent(key)}/field-roles`"), "字段角色 URL 没接").not.toEqual([]);
    expect(factHits(fe, '"/a/v1/solvers/generate"'), "临时求解器生成 URL 没接").not.toEqual([]);

    /*
     * 这一条**故意仍锚在 SolversPage.tsx 上**，位置就是事实本身：命题是
     * 「**本页**不许再自持一份引用反查客户端」（WO-REFERENCES-FAMILY 收归共享件）。
     * 整树扫会把主语抹掉 —— 别处存在 `fetchSolverReferences` 与本页存在，是两件不同的事。
     * 门本身也按 N2 放行反向断言（`not.toContain` = 位置即事实）。
     */
    const solvers = readRepoFile("../src/pages/admin/SolversPage.tsx");
    expect(solvers.length, "SolversPage.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    expect(solvers, "本页又自己写了一份引用反查客户端 ⇒ 同一概念两套实现").not.toContain("fetchSolverReferences");
  });
});
