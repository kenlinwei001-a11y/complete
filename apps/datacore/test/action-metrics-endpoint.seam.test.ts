import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER } from "./helpers.js";
import { ACTION_METRIC_NAMES } from "../src/metrics.js";

/** 测试用假凭证（非任何真实部署值）。`/metrics` 已收口为服务间鉴权，抓取方须带此头。 */
const SVC = "test-only-fake-service-token";
const SVC_HEADERS = { "x-service-token": SVC };

/**
 * 接缝门：S2 Action 三段埋点 × `/metrics` 端点。
 *
 * 病灶（本测存在的理由）：`app.ts` 构造 `ActionService` 时**没传 metrics 实例** → 服务退化到自有
 * 注册表，计数照记、`services.actions.metrics` 也读得到（既有单测因此全绿），但 `/metrics` 渲染的是
 * **另一个** app 级实例 —— 提交/审批/执行的埋点对外部监控**完全不可见**。典型的「绿测试 ≠ 能用·断在接缝」：
 * 两半各自都对，接缝没接。
 *
 * 断言层级刻意选**效果层**：真跑一条 Action（HTTP 提交 → HTTP 审批 → 域执行器真写回），
 * 然后 `GET /metrics` 读**响应文本**，断言 dc_action_* 计数器出现且值 > 0。
 * 「构造函数收到了 metrics」是运输层断言，不算数 —— 那种断言在计数器被渲染到别处时照样绿。
 */
describe("SEAM · Action 三段埋点必须汇入 /metrics 端点", () => {
  it("真跑一条 Action（提交→审批→执行）后，GET /metrics 文本里三段计数器均 > 0", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await seedBattery(t);

    // 端点在跑 Action **之前**不得已有该 Action 类型的计数（否则 >0 可能来自别处，断言就没鉴别力）
    const before = await t.app.inject({ method: "GET", url: "/metrics", headers: SVC_HEADERS });
    expect(before.statusCode).toBe(200);
    expect(before.body).not.toContain('dc_action_submit_total{action_type="对象数据变更"');

    const orders = await t.repos.objects.listByType("demo", "Order");
    const objectId = orders[0]!.id;

    // ① 提交（PLANNER）→ PENDING_APPROVAL
    const draftRes = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "对象数据变更", payload: { objectType: "Order", objectId, patch: { qty: 4242 }, reason: "埋点接缝验证" } },
    });
    expect(draftRes.statusCode).toBe(201);
    const { draftId } = draftRes.json() as { draftId: string };

    // ② 审批（ADMIN）→ ③ 域执行器执行 → EXECUTED（真写回，非 mock 假成功）
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect((approved.json() as { status: string }).status).toBe("EXECUTED");
    expect((await t.repos.objects.get("demo", objectId))!.props.qty).toBe(4242); // 执行段真发生过

    // ---- 头号判据：外部监控真的看得见 -------------------------------------------------
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: SVC_HEADERS });
    expect(res.statusCode).toBe(200);
    const body = res.body;

    // 三段各自的具体序列 + 数值，逐条从响应文本里读出来（不是读 services.actions.metrics）
    const seriesValue = (name: string, outcome: string): number => {
      const re = new RegExp(`^${name}\\{action_type="对象数据变更",outcome="${outcome}"\\} (\\d+)$`, "m");
      const m = re.exec(body);
      return m ? Number(m[1]) : 0;
    };
    expect(body).toContain(`# TYPE ${ACTION_METRIC_NAMES.submit} counter`);
    expect(body).toContain(`# TYPE ${ACTION_METRIC_NAMES.approval} counter`);
    expect(body).toContain(`# TYPE ${ACTION_METRIC_NAMES.execute} counter`);
    expect(seriesValue(ACTION_METRIC_NAMES.submit, "success"), "提交段埋点未出现在 /metrics 文本里").toBeGreaterThan(0);
    expect(seriesValue(ACTION_METRIC_NAMES.approval, "approved"), "审批段埋点未出现在 /metrics 文本里").toBeGreaterThan(0);
    expect(seriesValue(ACTION_METRIC_NAMES.execute, "success"), "执行段埋点未出现在 /metrics 文本里").toBeGreaterThan(0);
    expect(seriesValue(ACTION_METRIC_NAMES.executeAttempts, "success"), "执行尝试埋点未出现在 /metrics 文本里").toBeGreaterThan(0);

    // 单源：服务侧读到的数与端点文本里的数必须一致（分叉成两份注册表时这里就会对不上）
    expect(seriesValue(ACTION_METRIC_NAMES.submit, "success")).toBe(
      t.services.actions.metrics.get(ACTION_METRIC_NAMES.submit, { action_type: "对象数据变更", outcome: "success" }),
    );

    // 端点未把别的域挤掉（同一注册表共存）
    expect(body).toContain("# TYPE dc_");
  });

  /**
   * ★ 失败侧覆盖 —— 补的是**独立复验当场抓到的一个幸存变异**（本单最要紧的一条）。
   *
   * 上一版只驱动了一条 WIRED 成功动作，于是把 `actions.ts` 里执行失败的 `am.execute(typeKey,"failed")`
   * 改成 `"success"`（= 让每一次执行失败都记成成功、稳定率永远 100%），这道门**照绿**。
   * 而「稳定率」这个指标的全部意义就在失败侧——只守分子里好看的那一半，等于没守。
   *
   * 这里走 `采纳经营方案` + **刻意不合契约的载荷**（scheme 缺 name/outcome/scores/hardViol）：
   * WO-ADOPT-SCHEME-CARRIER 已把该型接上真执行器（落 scheme_adoptions 台账），失败产地从兜底线的
   * `EXECUTOR_NOT_IMPLEMENTED` 变成真分支的**契约拒绝**（「payload 不合契约」·拒绝臆造写入）——
   * 执行期仍诚实失败，指标 outcome="failed" 不变。断言它**确实进了分母的失败侧**：
   * 失败动作不许为了让稳定率好看而被悄悄排除（诚实 > 好看）。
   */
  it("失败侧：契约拒绝的诚实失败后，/metrics 里必须出现 outcome=\"failed\" 的执行计数（不许只统计成功）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await seedBattery(t);

    const draftRes = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: {
        actionTypeKey: "采纳经营方案",
        payload: { schemeNo: "S-1", scheme: { note: "埋点失败侧验证" }, targets: {} },
      },
    });
    expect(draftRes.statusCode, draftRes.body).toBe(201);
    const { draftId } = draftRes.json() as { draftId: string };

    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const st = approved.json() as { status: string };
    // 前置自证：这条动作**确实执行失败了**（契约拒绝）。若哪天契约放宽到这份载荷变合法，
    // 本用例要换一份仍非法的载荷、或改用无 levers 的 plan_change——
    // 而不是把断言删掉：删掉就等于把失败侧的守卫一并删了。
    expect(st.status, "本用例依赖契约拒绝的诚实失败（payload 不合契约 → EXECUTION_FAILED）；载荷若变合法，请换失败样本重写本例").toBe(
      "EXECUTION_FAILED",
    );

    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: SVC_HEADERS });
    const body = res.body;
    const failed = new RegExp(
      `^${ACTION_METRIC_NAMES.execute}\\{action_type="采纳经营方案",outcome="failed"\\} (\\d+)$`,
      "m",
    ).exec(body);
    expect(
      failed,
      "执行失败没有进 /metrics 的 failed 序列 —— 稳定率的分母被做掉了（失败被当成功记或根本没记）",
    ).toBeTruthy();
    expect(Number(failed![1])).toBeGreaterThan(0);

    // 反向咬死：同一动作**绝不可**同时出现在 success 序列里（那正是幸存变异的形态）。
    expect(
      body,
      "执行失败的动作却记成 execute success —— 把失败洗成成功，稳定率将永远好看",
    ).not.toMatch(new RegExp(`^${ACTION_METRIC_NAMES.execute}\\{action_type="采纳经营方案",outcome="success"\\}`, "m"));
  });
});
