import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, type TestApp } from "./helpers.js";

// WO-EXPERIMENT（④·决策 A/B·冠军-挑战者）端到端：
// 建实验(champion/challenger 参数版本 + split)→start→真 invoke 求解器 N 次（变请求键）→
// GET 回执两臂 invokeCount/均值/胜负；确定性分流（同请求键恒同臂·hash 非随机·R6）；
// conclude 落胜方；关实验(无 RUNNING)恒走 champion 当前版本·零影响既有。

/** 直接在 memory 仓储种一个参数历史版本（带 ramp.base 偏移使 capacity_forecast.p50 与当前版本可分）。 */
async function seedChallengerParams(t: TestApp, version: number, rampBase: number): Promise<void> {
  await t.repos.solverParamsHistory.put({
    id: `sparh_demo_v${version}`,
    tenantId: "demo",
    version,
    // 仅覆盖 ramp.base（浅合并到场景包默认之上）→ 改变爬坡基线 → p50 随之变（确定性 R6）。
    params: { ramp: { base: rampBase, step: 0.1, fullWeek: 4 } },
    createdAt: new Date().toISOString(),
  });
}

const createExperiment = (t: TestApp, body: Record<string, unknown>, headers = ADMIN) =>
  t.app.inject({ method: "POST", url: "/a/v1/experiments", headers, payload: body });
const getExperiment = (t: TestApp, id: string, headers = ADMIN) =>
  t.app.inject({ method: "GET", url: `/a/v1/experiments/${encodeURIComponent(id)}`, headers });
const lifecycle = (t: TestApp, id: string, action: "start" | "conclude") =>
  t.app.inject({ method: "POST", url: `/a/v1/experiments/${encodeURIComponent(id)}/${action}`, headers: ADMIN });
// 真实 modelId（HTML 原型种子）+ 变化的请求键（k=分流键载体，capacity_forecast 忽略未知字段）。
const MODEL_ID = "4680-NCM";
const invoke = (t: TestApp, key: string) =>
  t.app.inject({ method: "POST", url: "/a/v1/solvers/capacity_forecast/invoke", headers: ADMIN, payload: { args: { modelId: MODEL_ID, k: key } } });

describe("WO-EXPERIMENT 决策 A/B 冠军-挑战者", () => {
  it("确定性分流：两臂各约半 + 同请求键恒同臂；conclude 落胜方", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 当前版本 = champion；种一个挑战者参数版本（ramp.base 显著拉低 → p50 更小）。
    await seedChallengerParams(t, 7, 0.2);

    const created = await createExperiment(t, {
      solverKey: "capacity_forecast",
      championVersion: 1,
      challengerVersion: 7,
      splitPct: 50,
      metricKey: "p50",
    });
    expect(created.statusCode).toBe(200);
    const expId = created.json().id as string;

    await expect(lifecycle(t, expId, "start")).resolves.toMatchObject({ statusCode: 200 });

    // 真 invoke N 次，变请求键（modelId 不同）→ 跑遍分流桶。
    const N = 40;
    const armByKey = new Map<string, string>();
    for (let i = 0; i < N; i++) {
      const res = await invoke(t, `M-${i}`);
      expect(res.statusCode).toBe(200);
      const out = res.json().data as Record<string, unknown>;
      const exp = out.__experiment as { id: string; arm: string };
      expect(exp).toBeTruthy();
      expect(exp.id).toBe(expId);
      armByKey.set(`M-${i}`, exp.arm);
    }

    const report = (await getExperiment(t, expId)).json();
    const champ = report.arms.find((a: { arm: string }) => a.arm === "CHAMPION");
    const chall = report.arms.find((a: { arm: string }) => a.arm === "CHALLENGER");
    // 两臂各约半（容差宽松，确定性 hash 分布）。
    expect(champ.invokeCount + chall.invokeCount).toBe(N);
    expect(champ.invokeCount).toBeGreaterThan(N * 0.25);
    expect(chall.invokeCount).toBeGreaterThan(N * 0.25);

    // 均值可比，且非零（capacity_forecast.p50 真值）。
    expect(champ.metricMean).toBeGreaterThan(0);
    expect(chall.metricMean).toBeGreaterThan(0);
    // 挑战者参数 ramp.base 更低 → 其 p50 均值 < 冠军（参数版本真生效）。
    expect(chall.metricMean).toBeLessThan(champ.metricMean);

    // 同请求键恒同臂（R6）：重跑同 modelId 必落同臂。
    for (const [key, arm] of armByKey) {
      const out = (await invoke(t, key)).json().data as Record<string, unknown>;
      expect((out.__experiment as { arm: string }).arm).toBe(arm);
    }

    // conclude 落胜方（均值高者胜 = champion，因 challenger p50 更低）。
    const concluded = (await lifecycle(t, expId, "conclude")).json();
    expect(concluded.winner).toBe("CHAMPION");
    expect(concluded.experiment.status).toBe("CONCLUDED");
    // 结束后 GET 仍回落定胜方。
    expect((await getExperiment(t, expId)).json().winner).toBe("CHAMPION");
  });

  it("split=0 恒走 champion·split=100 恒走 challenger", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedChallengerParams(t, 9, 0.2);

    const exp0 = (await createExperiment(t, {
      solverKey: "capacity_forecast", championVersion: 1, challengerVersion: 9, splitPct: 0, metricKey: "p50",
    })).json().id as string;
    await lifecycle(t, exp0, "start");
    for (let i = 0; i < 10; i++) {
      const out = (await invoke(t, `Z-${i}`)).json().data as Record<string, unknown>;
      expect((out.__experiment as { arm: string }).arm).toBe("CHAMPION");
    }
    await lifecycle(t, exp0, "conclude");

    const exp100 = (await createExperiment(t, {
      solverKey: "capacity_forecast", championVersion: 1, challengerVersion: 9, splitPct: 100, metricKey: "p50",
    })).json().id as string;
    await lifecycle(t, exp100, "start");
    for (let i = 0; i < 10; i++) {
      const out = (await invoke(t, `Y-${i}`)).json().data as Record<string, unknown>;
      expect((out.__experiment as { arm: string }).arm).toBe("CHALLENGER");
    }
  });

  it("无 RUNNING 实验 → 输出不含 __experiment（零影响既有·关实验恒走 champion）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 建但不 start（DRAFT）→ 不分流。
    const expId = (await createExperiment(t, {
      solverKey: "capacity_forecast", championVersion: 1, challengerVersion: 1, splitPct: 100, metricKey: "p50",
    })).json().id as string;
    const out = (await invoke(t, "DRAFT-1")).json().data as Record<string, unknown>;
    expect(out.__experiment).toBeUndefined();
    expect(out.p50).toBeGreaterThan(0);
    // 两臂计数为 0（DRAFT 不记录）。
    const report = (await getExperiment(t, expId)).json();
    expect(report.arms.every((a: { invokeCount: number }) => a.invokeCount === 0)).toBe(true);
  });

  it("R2/authz：非 admin 建实验 403；跨用途 metricKey 必填", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const denied = await createExperiment(t, {
      solverKey: "capacity_forecast", championVersion: 1, challengerVersion: 2, splitPct: 50, metricKey: "p50",
    }, PLANNER);
    expect(denied.statusCode).toBe(403);

    const bad = await createExperiment(t, {
      solverKey: "not_a_solver", championVersion: 1, challengerVersion: 2, splitPct: 50, metricKey: "p50",
    });
    expect(bad.statusCode).toBe(400);
  });
});
