import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import { ACTION_METRIC_NAMES } from "../src/metrics.js";
import type { ActionTypeRecord, AuthCtx } from "../src/domain.js";

/**
 * 欠账 #65 · `G-METRICS-CROSS-TENANT-AND-OPEN` 的验收门（两半各一）。
 *
 * 病灶（本测存在的理由 —— 两条都在本分支基线 `origin/claude/wave4-integration` 上实测复现）：
 *  ① **稳定率跨租户混算**：`ActionMetrics` 的标签只有 `{action_type,outcome}`，
 *     租户 A 的执行失败会把租户 B 读到的稳定率一起拉低。而稳定率是拿来做决策的数 ——
 *     混算意味着**依据是错的**。这是 R2「tenant_id everywhere」在可观测面上的一个洞。
 *  ② **`/metrics` 未鉴权公开**：`/metrics` 在 `PUBLIC_PATHS` 里，鉴权钩子第一行即 return；
 *     且**就算把它从 `PUBLIC_PATHS` 里删掉也还是公开的** —— 钩子第二行
 *     `if (!path.startsWith("/a/")) return;` 会让它照样逃出去。两处必须一起改。
 *     ② 把 ① 那份错的数**对外可读**。
 *
 * 断言层级一律选**效果层**：驱动真实 Action 生命周期，然后读 `GET /metrics` 的**响应文本**。
 * 「标签字段加上了」是运输层断言，不算数。
 */

const SVC = "svc-token-for-metrics-scrape";

/** 直接注册一个可控 ActionType（单步 admin 审批、无校验、无规则）。 */
const probeType = (): Omit<ActionTypeRecord, "id" | "tenantId"> =>
  ({
    key: "stab_probe",
    name: "稳定率探针动作",
    version: 1,
    paramsSchema: { type: "object" },
    checkRules: [],
    approvalChain: [{ role: "admin" }],
  }) as unknown as Omit<ActionTypeRecord, "id" | "tenantId">;

const ctxOf = (tenantId: string, userId: string, roles: string[]): AuthCtx => ({ tenantId, userId, roles, attributes: {} });

/** 在某租户下跑 n 条动作，`mode` 决定执行器成功还是失败。 */
async function driveActions(t: TestApp, tenantId: string, mode: "ok" | "fail", n: number): Promise<void> {
  const actions = t.services.actions;
  const author = ctxOf(tenantId, `${tenantId}-author`, ["planner"]);
  const approver = ctxOf(tenantId, `${tenantId}-approver`, ["admin"]);
  for (let i = 0; i < n; i++) {
    const d = await actions.create(author, { actionTypeKey: "stab_probe", payload: { mode, i } });
    await actions.approve(approver, d.id); // approve 走完即触发 execute
  }
}

/** 从 Prometheus 文本里取一条精确序列的值；取不到记 0（缺序列 = 该维度没有数据）。 */
function series(body: string, name: string, tenant: string, outcome: string): number {
  const re = new RegExp(`^${name}\\{action_type="stab_probe",outcome="${outcome}",tenant="${tenant}"\\} (\\d+)$`, "m");
  const m = re.exec(body);
  return m ? Number(m[1]) : 0;
}

/**
 * 提交段有职责分离前置：`submitInner` 要求该租户下**存在**一个持链上角色、且 ≠ 发起人的用户，
 * 否则 `NO_ELIGIBLE_APPROVER`。合成租户不经 seed，故这里显式补一个审批人。
 */
async function seedApprover(t: TestApp, tenantId: string): Promise<void> {
  await t.repos.users.put({
    id: `${tenantId}-approver`,
    tenantId,
    username: `${tenantId}-approver`,
    passwordHash: "x",
    roles: ["admin"],
    attributes: {},
  });
}

async function setupTwoTenants(t: TestApp): Promise<void> {
  const actions = t.services.actions;
  await seedApprover(t, "t-alpha");
  await seedApprover(t, "t-beta");
  await actions.registerType(ctxOf("t-alpha", "t-alpha-admin", ["admin"]), probeType());
  await actions.registerType(ctxOf("t-beta", "t-beta-admin", ["admin"]), probeType());
  // 执行器按 payload.mode 分流：本测要的是**同一个 action_type 在两个租户里成败分布不同**。
  actions.setExecutor(
    {
      execute: async (draft) =>
        draft.payload.mode === "fail"
          ? { ok: false, error: "scripted failure" }
          : { ok: true, targetRef: `obj:${draft.id}` },
    },
    [1, 1, 1],
  );
  // 租户 A：1 成功 + 2 失败 → 稳定率 1/3。租户 B：1 成功 + 0 失败 → 稳定率 1/1。
  await driveActions(t, "t-alpha", "ok", 1);
  await driveActions(t, "t-alpha", "fail", 2);
  await driveActions(t, "t-beta", "ok", 1);
}

describe("SEAM · Action 稳定率按租户分维（A 的失败不得污染 B 的数）", () => {
  it("同一 action_type 在两租户下渲染为两条独立序列；A 租户的 2 次失败对 B 的稳定率零影响", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await setupTwoTenants(t);

    // 服务令牌 = 全量视图（Prometheus 抓取正门）
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.body;

    const aOk = series(body, ACTION_METRIC_NAMES.execute, "t-alpha", "success");
    const aFail = series(body, ACTION_METRIC_NAMES.execute, "t-alpha", "failed");
    const bOk = series(body, ACTION_METRIC_NAMES.execute, "t-beta", "success");
    const bFail = series(body, ACTION_METRIC_NAMES.execute, "t-beta", "failed");

    // ---- 头号判据：两条曲线彼此独立 -------------------------------------------------
    expect([aOk, aFail], "租户 A 自己的成败分布对不上（1 成功 / 2 失败）").toEqual([1, 2]);
    expect(
      bFail,
      "租户 B 读到了非零失败数 —— A 的失败漏进了 B 的分母，稳定率跨租户混算（欠账 #65 复发）",
    ).toBe(0);
    expect(bOk, "租户 B 自己的成功数被 A 的序列吞掉了").toBe(1);

    // 稳定率本身：A=1/3、B=1/1。混算时两者会同为 2/4=0.5 —— 下面两条把那个形态咬死。
    const stability = (ok: number, fail: number): number => (ok + fail === 0 ? NaN : ok / (ok + fail));
    expect(stability(aOk, aFail)).toBeCloseTo(1 / 3, 10);
    expect(stability(bOk, bFail), "B 的稳定率不是 100% —— 它只跑过成功动作，被拉低即为混算").toBe(1);
    expect(stability(aOk, aFail)).not.toBeCloseTo(stability(bOk, bFail), 10);

    // 三段埋点都必须带租户维（不是只给 execute 补了一半）
    expect(series(body, ACTION_METRIC_NAMES.submit, "t-alpha", "success")).toBe(3);
    expect(series(body, ACTION_METRIC_NAMES.submit, "t-beta", "success")).toBe(1);
    expect(series(body, ACTION_METRIC_NAMES.approval, "t-alpha", "approved")).toBe(3);
    expect(series(body, ACTION_METRIC_NAMES.approval, "t-beta", "approved")).toBe(1);
    expect(series(body, ACTION_METRIC_NAMES.executeAttempts, "t-alpha", "executor_rejected")).toBe(6); // 2 次失败 × 3 次重试
    expect(series(body, ACTION_METRIC_NAMES.executeAttempts, "t-beta", "executor_rejected")).toBe(0);

    // 反向：绝不允许出现一条**不带 tenant 标签**的 dc_action_* 合成序列（那就是混算的原形）
    expect(
      body,
      "出现了无 tenant 标签的 dc_action_* 序列 —— 存在一条把所有租户合成一条的曲线",
    ).not.toMatch(/^dc_action_\w+(?:\{(?![^}]*\btenant=)[^}]*\})? /m);
  });

  it("admin 只看得到自己租户那条曲线（补了租户维不等于可以互相看）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await setupTwoTenants(t);
    t.services.actions.metrics.inc("dc_wo65_probe_total", {}, 1); // 一条无 tenant 标签的进程级序列

    const asAlpha = await t.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-debug-user": "t-alpha:t-alpha-admin:admin" },
    });
    expect(asAlpha.statusCode, asAlpha.body).toBe(200);
    expect(asAlpha.body).toContain('tenant="t-alpha"');
    expect(
      asAlpha.body,
      "t-alpha 的 admin 读到了 t-beta 的序列 —— 把 R2 从『合成一条』恶化成『明码列出别家』",
    ).not.toContain('tenant="t-beta"');
    // 进程级指标（无 tenant 标签）不许被过滤误伤 —— 断的是**那条具体序列**，
    // 不是"存在某条 dc_ 行"（后者被租户序列自己满足，等于没断）。
    expect(asAlpha.body, "进程级序列（无 tenant 标签）被租户过滤误伤了").toContain("dc_wo65_probe_total 1");

    // 服务令牌视图则两个租户都在（否则抓取侧会漏掉大半数据）
    const asService = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
    expect(asService.body).toContain('tenant="t-alpha"');
    expect(asService.body).toContain('tenant="t-beta"');
  });
});

describe("SEAM · /metrics 鉴权（无凭证 / 错凭证 / 对凭证）", () => {
  it("无凭证 → 401；错的 service token → 401；非 admin 已认证角色 → 403；admin / 正确 service token → 200", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    // 先往 app 级注册表放一条**无 tenant 标签**的进程级序列（`t.services.actions.metrics`
    // 就是 `/metrics` 渲染的那一份，见 action-metrics-endpoint.seam.test.ts）。两个作用：
    // ① 让 200 的响应体有确定内容可断言（空注册表 render() 只返回 "\n"，断言就没鉴别力）；
    // ② 顺带守住「按租户过滤不许误伤进程级指标」—— 它必须在 admin 的租户视图里照常可见。
    t.services.actions.metrics.inc("dc_wo65_probe_total", {}, 1);

    // ① 无凭证 —— 这正是基线上的病：基线此处是 200，且响应体带全租户业务活动画像
    const anon = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(anon.statusCode, `/metrics 无凭证仍可读（原文前 200 字符）：${anon.body.slice(0, 200)}`).toBe(401);
    expect((anon.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
    expect(anon.body, "401 的响应体里仍漏出了指标内容").not.toContain("dc_");

    // ② 错的 service token（无其它凭据）→ 落到「无凭据」分支 → 401
    const badSvc = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "wrong-token" } });
    expect(badSvc.statusCode).toBe(401);
    expect(badSvc.body).not.toContain("dc_");

    // ③ 已认证但非 admin（planner）→ 403，不是 401（凭据是对的，权限不够）
    const planner = await t.app.inject({ method: "GET", url: "/metrics", headers: PLANNER });
    expect(planner.statusCode, planner.body).toBe(403);
    expect((planner.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(planner.body).not.toContain("dc_");

    // ④ 对凭证 A：admin 角色 → 200
    const admin = await t.app.inject({ method: "GET", url: "/metrics", headers: ADMIN });
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.body, "进程级序列（无 tenant 标签）被租户过滤误伤了").toContain("dc_wo65_probe_total 1");

    // ⑤ 对凭证 B：service token → 200，且**不需要** X-Tenant-Id
    //    （抓取侧要的是全量；若这里强制租户头，加鉴权就等于打断 Prometheus 抓取）
    const svc = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
    expect(svc.statusCode, svc.body).toBe(200);
    expect(svc.body).toContain("dc_wo65_probe_total 1");
  });

  it("未配置 SERVICE_TOKEN 时 service 分支恒不命中（不得因为env缺省而退化成公开）", async () => {
    const t = await makeApp(); // 无 SERVICE_TOKEN
    const anon = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(anon.statusCode).toBe(401);
    const anySvc = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "" } });
    expect(anySvc.statusCode).toBe(401);
  });

  it("/metrics 不在任何公开路径集合里（防回潮：塞回 PUBLIC_PATHS 这条即红）", async () => {
    const t = await makeApp();
    // 与上一条不同：这条不看角色、只看「匿名能不能拿到内容」，是把病灶咬死的最短判据。
    for (const url of ["/metrics", "/metrics?x=1"]) {
      const res = await t.app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} 匿名可读 —— /metrics 又变回公开端点了`).toBe(401);
    }
    // 健康探针保持公开（别误伤：网关/编排器靠它探活）
    expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  });
});
