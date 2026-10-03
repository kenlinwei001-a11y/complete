import { describe, expect, it, vi } from "vitest";
import { makeApp, ADMIN, debugUser, type TestApp } from "./helpers.js";

/**
 * WO-SIMSESSION-BIZ-REUSE · SimSession PAUSED/ENDED 生命周期迁移 + 业务页（capacity）接缝。
 *
 * 验收①（真实置位路径）：PATCH /a/v1/sim/sessions/:id/status 驱动真状态迁移，
 *   断言**落库后的状态字节**（repos.sim.getSession 读回），不是 mock 字面量断言。
 *   期望值一律钉字面量（"PAUSED"/"ENDED"/409），不从被测实现的迁移表反推（oracle 独立）。
 * 验收②（接缝）：从产能页路径（/a/v1/sim/live-scenarios/:id/pause|end）发起 ⇒
 *   repos.sim.putSession 被调用（spy 替身断言）+ 真行为断言（落库字节 + 响应回执）。
 *
 * 边界：views/sim/** 不动；useLiveSolver 不碰；迁移实现只有 `setSimSessionStatus` 一份。
 */

const H = { ...ADMIN, "content-type": "application/json" };
const BASE = { o1: { risk: 0.5 }, o2: { risk: 0.2 } };

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } },
  });

const createSession = async (t: TestApp, base: Record<string, unknown> = BASE): Promise<string> => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: H, payload: { baseSnapshot: base } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
};
const patchStatus = (t: TestApp, sid: string, status: string, headers: Record<string, string> = H) =>
  t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/status`, headers, payload: { status } });
/** 落库后的状态字节（独立通路：绕过路由直读仓储）。 */
const persistedStatus = async (t: TestApp, sid: string): Promise<string> =>
  (await t.repos.sim.getSession("demo", sid))!.status;

describe("WO-SIMSESSION-BIZ-REUSE ① · PAUSED/ENDED 真实置位路径（路由驱动·断言落库字节）", () => {
  it("READY → PAUSED：响应回执 + 落库字节都是 PAUSED", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    const r = await patchStatus(t, sid, "PAUSED");
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("PAUSED");
    expect(await persistedStatus(t, sid)).toBe("PAUSED"); // 落库字节，非响应回显
    await t.app.close();
  });

  it("READY → ENDED：响应回执 + 落库字节都是 ENDED", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    const r = await patchStatus(t, sid, "ENDED");
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("ENDED");
    expect(await persistedStatus(t, sid)).toBe("ENDED");
    await t.app.close();
  });

  it("PAUSED 真行为：tick 被 409 拦住；迁回 RUNNING 后 tick 真进位（curTick 0→2）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    await patchStatus(t, sid, "PAUSED");
    const blocked = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 2 } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    expect((await t.repos.sim.getSession("demo", sid))!.curTick).toBe(0); // 一格都没走
    // 恢复（PAUSED → RUNNING）后世界继续走
    const resume = await patchStatus(t, sid, "RUNNING");
    expect(resume.statusCode).toBe(200);
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 2 } });
    expect(tick.statusCode).toBe(200);
    expect(tick.json().curTick).toBe(2);
    expect(await persistedStatus(t, sid)).toBe("RUNNING");
    await t.app.close();
  });

  it("ENDED 是终态：tick 409；ENDED → PAUSED / RUNNING 一律 409，落库字节不动", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    await patchStatus(t, sid, "ENDED");
    const blocked = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H, payload: { n: 1 } });
    expect(blocked.statusCode).toBe(409);
    for (const target of ["PAUSED", "RUNNING", "ENDED"]) {
      const r = await patchStatus(t, sid, target);
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    }
    expect(await persistedStatus(t, sid)).toBe("ENDED");
    await t.app.close();
  });

  it("非法迁移 409 明说：DRAFT → PAUSED（草稿无世界可暂停）；RUNNING → RUNNING 不在表内", async () => {
    const t = await makeApp();
    await enableSim(t);
    // 空 baseSnapshot ⇒ 建会话落 DRAFT（与 sim-session.test.ts 既有语义同一条路径）
    const sid = await createSession(t, {});
    expect(await persistedStatus(t, sid)).toBe("DRAFT");
    const r = await patchStatus(t, sid, "PAUSED");
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    expect(await persistedStatus(t, sid)).toBe("DRAFT"); // 拒绝后一个字节不动
    // RUNNING → RUNNING（tick 置的 RUNNING，重复迁移不在迁移表内）
    const sid2 = await createSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid2}/tick`, headers: H, payload: { n: 1 } });
    expect(await persistedStatus(t, sid2)).toBe("RUNNING");
    const r2 = await patchStatus(t, sid2, "RUNNING");
    expect(r2.statusCode).toBe(409);
    await t.app.close();
  });

  it("R2 隔离：他租户迁移本会话 → 404；R3 暗发：无 feature 租户 → 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    const other = await patchStatus(t, sid, "PAUSED", { ...debugUser("other", "admin", "admin"), "content-type": "application/json" });
    expect(other.statusCode).toBe(404);
    const fresh = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${sid}/status`,
      headers: { ...debugUser("freshco", "admin", "admin"), "content-type": "application/json" }, payload: { status: "PAUSED" },
    });
    expect(fresh.statusCode).toBe(404);
    expect(fresh.json().error.code).toBe("FEATURE_NOT_FOUND");
    await t.app.close();
  });
});

describe("WO-SIMSESSION-BIZ-REUSE 退修① · 世界冻结：全部写入口过 assertSimSessionWritable 唯一闸", () => {
  const PERT = { kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0.9, durationTicks: null, mode: "set", label: "停机" };
  const world = async (t: TestApp, sid: string) =>
    (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json();

  it("PAUSED：/act 409 且世界字节零变化；/perturbations 409 且扰动记录零增长", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    await patchStatus(t, sid, "PAUSED");
    const act = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: H, payload: { objectId: "o1", stateVar: "risk", value: 0.99 } });
    expect(act.statusCode).toBe(409);
    expect(act.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    // 落库字节零变化（独立通路：world 读回还是建会话时的字面量）
    const w = await world(t, sid);
    expect(w.tick).toBe(0);
    expect(w.state.o1.risk).toBe(0.5);
    const pert = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: H, payload: PERT });
    expect(pert.statusCode).toBe(409);
    expect(pert.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    expect((await t.repos.sim.listPerturbations("demo", sid)).length).toBe(0); // 记录零增长
    await t.app.close();
  });

  it("ENDED：/act 409 且世界字节零变化；/perturbations 409 且扰动记录零增长（终态拒写）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    await patchStatus(t, sid, "ENDED");
    const act = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: H, payload: { objectId: "o1", stateVar: "risk", value: 0.99 } });
    expect(act.statusCode).toBe(409);
    expect(act.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    const w = await world(t, sid);
    expect(w.state.o1.risk).toBe(0.5);
    const pert = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: H, payload: PERT });
    expect(pert.statusCode).toBe(409);
    expect((await t.repos.sim.listPerturbations("demo", sid)).length).toBe(0);
    await t.app.close();
  });

  it("恢复 RUNNING 后 /act 真放行：世界态 0.5 → 0.99 真落库（真行为，不是只比状态码）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    await patchStatus(t, sid, "PAUSED");
    await patchStatus(t, sid, "RUNNING");
    const act = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: H, payload: { objectId: "o1", stateVar: "risk", value: 0.99 } });
    expect(act.statusCode).toBe(200);
    // 独立通路读回落库字节（绕过响应回显）
    const ts = await t.repos.sim.getTickState("demo", sid, 0);
    expect(ts!.state.o1?.risk).toBe(0.99);
    await t.app.close();
  });

  it("上闸全集金丝雀（PAUSED）：tick / disabled-rules / rollback / DELETE perturbation 各 409；刻意不上闸的 counterfactual 200 · checkpoint 201", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    // 暂停前备好后续断言要用的实体：一条扰动 + 一个检查点
    const created = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: H, payload: PERT });
    expect(created.statusCode).toBe(201);
    const pid = created.json().perturbation.id as string;
    const cp = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: H, payload: { label: "cp0" } });
    expect(cp.statusCode).toBe(201);
    const cpId = cp.json().id as string;
    await patchStatus(t, sid, "PAUSED");
    // 上闸全集（枚举见 app.ts assertSimSessionWritable 注释，两路交叉核对得出）
    for (const [method, url, payload] of [
      ["POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }],
      ["PATCH", `/a/v1/sim/sessions/${sid}/disabled-rules`, { disabledRuleKeys: [] }],
      ["POST", `/a/v1/sim/sessions/${sid}/rollback`, { checkpointId: cpId }],
      ["DELETE", `/a/v1/sim/sessions/${sid}/perturbations/${pid}`, {}],
    ] as const) {
      const r = await t.app.inject({ method, url, headers: H, payload });
      expect(r.statusCode, `${method} ${url}`).toBe(409);
      expect(r.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    }
    // 被拒后世界一个字节不动：扰动记录仍 1 条、curTick 仍 0
    expect((await t.repos.sim.listPerturbations("demo", sid)).length).toBe(1);
    expect((await t.repos.sim.getSession("demo", sid))!.curTick).toBe(0);
    // 刻意不上闸：counterfactual（persist:false 零写入）照常出对照；checkpoint（冻结态只读快照）照常存档
    const cf = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/counterfactual`, headers: H, payload: {} });
    expect(cf.statusCode).toBe(200);
    const cp2 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: H, payload: { label: "cp-paused" } });
    expect(cp2.statusCode).toBe(201);
    await t.app.close();
  });

  it("ENDED 逃逸口不上闸：branch 从终态世界派生新会话 201，父世界字节不动", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await createSession(t);
    const cp = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: H, payload: { label: "cpE" } });
    const cpId = cp.json().id as string;
    await patchStatus(t, sid, "ENDED");
    const br = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: H, payload: { checkpointId: cpId } });
    expect(br.statusCode).toBe(201);
    expect(br.json().status).toBe("READY");
    expect(await persistedStatus(t, sid)).toBe("ENDED"); // 父世界纹丝不动
    await t.app.close();
  });
});

describe("WO-SIMSESSION-BIZ-REUSE ② · 产能页路径接缝 ⇒ repos.sim.putSession（spy + 真行为）", () => {
  const createLive = async (t: TestApp): Promise<string> => {
    const r = await t.app.inject({
      method: "POST", url: "/a/v1/sim/live-scenarios", headers: H,
      payload: { baseId: "changzhou", name: "化成扩通道", apply: [{ objectType: "Process", objectId: "proc-coating", prop: "yield_baseline", value: 1.2 }] },
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };

  it("POST /live-scenarios/:id/pause ⇒ putSession 被调一次且载 PAUSED；落库字节 + 列表回执真变", async () => {
    const t = await makeApp();
    const sid = await createLive(t);
    const spy = vi.spyOn(t.repos.sim, "putSession"); // 建会话之后挂 spy ⇒ 计数不受 createSession 污染
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/live-scenarios/${sid}/pause`, headers: H, payload: {} });
    expect(r.statusCode).toBe(200);
    // spy 替身断言：产能页路径 ⇒ 接缝（repos.sim.putSession）真的被走
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: sid, status: "PAUSED" }));
    // 真行为断言①：落库字节
    expect((await t.repos.sim.getSession("demo", sid))!.status).toBe("PAUSED");
    // 真行为断言②：业务页自己的读取路径（列表）回执带 PAUSED，不是安静的字节
    const list = await t.app.inject({ method: "GET", url: "/a/v1/sim/live-scenarios?baseId=changzhou", headers: ADMIN });
    const mine = (list.json().scenarios as { id: string; status: string }[]).find((s) => s.id === sid)!;
    expect(mine.status).toBe("PAUSED");
    expect(r.json().status).toBe("PAUSED");
    spy.mockRestore();
    await t.app.close();
  });

  it("POST /live-scenarios/:id/end ⇒ putSession 载 ENDED；终态后再 pause 被 409 拦住", async () => {
    const t = await makeApp();
    const sid = await createLive(t);
    const spy = vi.spyOn(t.repos.sim, "putSession");
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/live-scenarios/${sid}/end`, headers: H, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: sid, status: "ENDED" }));
    expect((await t.repos.sim.getSession("demo", sid))!.status).toBe("ENDED");
    // 真行为：业务页路径与通用路由同一份迁移校验 ⇒ 终态不可复活，且不再写库
    const again = await t.app.inject({ method: "POST", url: `/a/v1/sim/live-scenarios/${sid}/pause`, headers: H, payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("INVALID_SIM_STATUS_TRANSITION");
    expect(spy).toHaveBeenCalledTimes(1); // 409 不触库
    spy.mockRestore();
    await t.app.close();
  });

  it("接缝边界：拿沙盘会话当产能方案 pause → 404（snapshotKind 判别，不许跨池操作）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sandboxSid = await createSession(t);
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/live-scenarios/${sandboxSid}/pause`, headers: H, payload: {} });
    expect(r.statusCode).toBe(404);
    expect((await t.repos.sim.getSession("demo", sandboxSid))!.status).toBe("READY"); // 未误伤
    await t.app.close();
  });
});
