import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, debugUser, ADMIN, PLANNER } from "./helpers.js";
import { ACTION_METRIC_NAMES, type ActionMetricsView } from "../src/metrics.js";

/**
 * 接缝门：Action 三段埋点的**租户维** × `/metrics` 全租户合计。
 *
 * 病灶（本测存在的理由）：埋点标签集只有 `{action_type,outcome}` ⇒ 序列是**全租户合计**，
 * 验收判据「跑 100 次同 Action，失败率 < 1%」在多租户部署下**算不出租户级的数**：
 * 一个租户把某动作跑挂 100 次会拉低所有租户共享的比率，大租户的成功量又会掩盖小租户的持续失败；
 * 失败率越线时也无法从指标定位是哪个租户。
 *
 * 修法取「合计留在 `/metrics`、租户维另开鉴权端点」（仿 `router/perception-metrics.ts`），
 * 而**不是**给 `/metrics` 加 `tenant_id` 标签（Prometheus 基数 = 序列数 × 租户数）。
 *
 * ⚠ 这个修法自带一个风险：另开端点很容易变成**第二个真值源**（同一件事两个数、日久必打架）。
 * 本文件最要紧的一条断言就是钉死它不会 —— `Σ各租户 == /metrics 合计`，逐序列比。
 * 实现上二者由 `Metrics.incWithTenant` **同一行代码**写出，本测把这个不变量变成机器可查的。
 */
const SVC = "test-only-fake-service-token";
const OTHER = debugUser("other-tenant", "u1", "admin");

/** 从 /metrics 文本里读某条序列的值（读不到记 0）。 */
function seriesValue(body: string, name: string, actionType: string, outcome: string): number {
  const re = new RegExp(`^${name}\\{action_type="${actionType}",outcome="${outcome}"\\} (\\d+)$`, "m");
  const m = re.exec(body);
  return m ? Number(m[1]) : 0;
}

describe("SEAM · Action 埋点租户维（另开端点，且不得成为第二个真值源）", () => {
  it("真跑成功+失败两条 Action 后：租户端点给出该租户的三段明细与执行稳定率", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await seedBattery(t);

    // ① 成功侧：对象数据变更（已接执行器 → EXECUTED）
    const orders = await t.repos.objects.listByType("demo", "Order");
    const okDraft = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: {
        actionTypeKey: "对象数据变更",
        payload: { objectType: "Order", objectId: orders[0]!.id, patch: { qty: 777 }, reason: "租户维埋点验证" },
      },
    });
    expect(okDraft.statusCode, okDraft.body).toBe(201);
    const okApproved = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${(okDraft.json() as { draftId: string }).draftId}/approve`,
      headers: ADMIN,
      payload: {},
    });
    expect((okApproved.json() as { status: string }).status).toBe("EXECUTED");

    // ② 失败侧：采纳经营方案 + 刻意不合契约的载荷（WO-ADOPT-SCHEME-CARRIER 已接线该型，
    //    失败产地 = 真分支的契约拒绝「payload 不合契约」，不再落兜底线 → 仍诚实失败 EXECUTION_FAILED）
    const badDraft = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "采纳经营方案", payload: { schemeNo: "S-9", scheme: {}, targets: {} } },
    });
    expect(badDraft.statusCode, badDraft.body).toBe(201);
    const badApproved = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${(badDraft.json() as { draftId: string }).draftId}/approve`,
      headers: ADMIN,
      payload: {},
    });
    expect(
      (badApproved.json() as { status: string }).status,
      "本用例依赖契约拒绝的诚实失败（payload 不合契约 → EXECUTION_FAILED）；载荷若哪天变合法，请换一份仍非法的载荷或改用无 levers 的 plan_change 重写本例",
    ).toBe("EXECUTION_FAILED");

    // ---- 租户端点：该租户自己的明细 + 稳定率 ------------------------------------------
    const res = await t.app.inject({ method: "GET", url: "/a/v1/actions/metrics", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ActionMetricsView;

    expect(view.tenantId).toBe("demo");
    expect(view.submit.find((c) => c.actionType === "对象数据变更" && c.outcome === "success")!.count).toBeGreaterThan(0);
    expect(view.approval.find((c) => c.actionType === "对象数据变更" && c.outcome === "approved")!.count).toBeGreaterThan(0);
    expect(view.execute.find((c) => c.actionType === "对象数据变更" && c.outcome === "success")!.count).toBeGreaterThan(0);
    // 失败侧必须真的进了分母（只守好看的那一半 = 没守）
    expect(
      view.execute.find((c) => c.actionType === "采纳经营方案" && c.outcome === "failed")!.count,
      "执行失败没进租户视图 —— 稳定率的分母被做掉了",
    ).toBeGreaterThan(0);

    // 稳定率：2 次执行终态、1 成 1 败 ⇒ 0.5。这是本端点存在的全部理由（此前算不出租户级的数）
    expect(view.stability.executions).toBe(2);
    expect(view.stability.succeeded).toBe(1);
    expect(view.stability.failed).toBe(1);
    expect(view.stability.failureRate).toBe(0.5);
  });

  it("R2 跨租户隔离：别的租户读同一端点，看不到 demo 的任何计数", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const d = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: {
        actionTypeKey: "对象数据变更",
        payload: { objectType: "Order", objectId: orders[0]!.id, patch: { qty: 888 }, reason: "隔离验证" },
      },
    });
    await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${(d.json() as { draftId: string }).draftId}/approve`,
      headers: ADMIN,
      payload: {},
    });

    // 前提自证：demo 侧确实有数（否则「另一租户为空」是废断言）
    const mine = (await t.app.inject({ method: "GET", url: "/a/v1/actions/metrics", headers: ADMIN })).json() as ActionMetricsView;
    expect(mine.execute.length).toBeGreaterThan(0);

    const theirs = (await t.app.inject({ method: "GET", url: "/a/v1/actions/metrics", headers: OTHER })).json() as ActionMetricsView;
    expect(theirs.tenantId).toBe("other-tenant");
    expect(theirs.submit).toEqual([]);
    expect(theirs.approval).toEqual([]);
    expect(theirs.execute).toEqual([]);
    expect(theirs.executeAttempts).toEqual([]);
    expect(theirs.stability).toEqual({ executions: 0, succeeded: 0, failed: 0, failureRate: 0 });
  });

  it("匿名不得读租户端点（它带租户私有的业务动作类型名）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/actions/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("★ 不是第二个真值源：Σ各租户 == /metrics 合计（逐序列比）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    for (const qty of [11, 22]) {
      const d = await t.app.inject({
        method: "POST",
        url: "/a/v1/action-drafts",
        headers: PLANNER,
        payload: {
          actionTypeKey: "对象数据变更",
          payload: { objectType: "Order", objectId: orders[0]!.id, patch: { qty }, reason: "合计一致性" },
        },
      });
      await t.app.inject({
        method: "POST",
        url: `/a/v1/action-drafts/${(d.json() as { draftId: string }).draftId}/approve`,
        headers: ADMIN,
        payload: {},
      });
    }
    // 再跑一条失败的，保证失败序列也进入比对
    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "采纳经营方案", payload: { schemeNo: "S-7", scheme: {}, targets: {} } },
    });
    await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${(bad.json() as { draftId: string }).draftId}/approve`,
      headers: ADMIN,
      payload: {},
    });

    const text = (await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } })).body;
    const m = t.services.actions.metrics;

    let compared = 0;
    for (const name of Object.values(ACTION_METRIC_NAMES)) {
      const tenants = m.tenantsOf(name);
      expect(tenants.length, `${name} 一个租户桶都没有 —— 租户维根本没写入`).toBeGreaterThan(0);
      // 把所有租户的桶按 (action_type,outcome) 汇总
      const summed = new Map<string, number>();
      for (const tid of tenants) {
        for (const s of m.tenantSeries(name, tid)) {
          // 用 JSON 数组当复合键：action_type 是租户自定的业务中文名，任何单字符分隔符都可能与之撞车
          const key = JSON.stringify([s.labels["action_type"], s.labels["outcome"]]);
          summed.set(key, (summed.get(key) ?? 0) + s.value);
        }
      }
      // 逐指标的**基数下限**（WO-R6 收编时补，由 coverage-blind:check 咬出来的真缺口）：
      // 文末那条 `compared > 3` 是**跨四个指标名的合计**，挡不住「其中一个指标名一条序列都没有、
      // 被另一个指标名的多条撑过阈值」——那正是 LOOP_NO_FLOOR 说的「0/N 与 N/N 同色」。
      // 锚在被遍历的集合 `summed` 自己身上，空集当场红，而不是等合计去兜。
      expect([...summed], `${name} 汇总后一条序列都没有 —— 下面的逐序列比对会空转`).not.toHaveLength(0);
      for (const [key, sum] of summed) {
        const [actionType, outcome] = JSON.parse(key) as [string, string];
        expect(
          seriesValue(text, name, actionType, outcome),
          `两套口径打架：${name}{${actionType},${outcome}} 合计端与租户端不一致 —— 出现了第二个真值源`,
        ).toBe(sum);
        compared++;
      }
    }
    // 金丝雀：上面这个循环必须真的比过东西，不能因为「一条序列都没有」而空转通过
    expect(compared, "一条序列都没比 —— 断言空转（不变量没被真正检验）").toBeGreaterThan(3);
  });
});
