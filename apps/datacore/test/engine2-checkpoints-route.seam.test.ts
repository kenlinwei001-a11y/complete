import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/**
 * WO-ENGINE-2 件二 · `GET /a/v1/sim/sessions/:id/checkpoints`（检查点列表读端）。
 *
 * 病根不在前端：`listCheckpoints` 的三处实现（`repo/repo.ts` 接口 · `repo/memory.ts` · `repo/pg.ts`）
 * 早就写好了，但 24 条 `/a/v1/sim/*` 路由里从没有人开这个口 ⇒ **route 层缺口**。
 * 后果：`sim.checkpoint_saved` 事件没有可失效的缓存（前端无列表可读），
 * 回滚/分支只能靠调用方自己记 checkpointId。
 *
 * 断言全是**效果层**（"读到的内容因此不同"），不是运输层（"路由注册了"）：
 * 每建一个检查点 → 列表内容随之变；跨租户读不到；未知会话 404；feature 关 404（R3 先于 authz）。
 */
// `PUT /a/v1/tenants/:id/features` 有 `if (id !== c.tenantId) throw forbidden`（app.ts:4430）：
// 用 demo 的 ADMIN 去开 other 租户的 feature 是**静默 403**，开关根本没落。
// 必须用目标租户自己的 admin 头，并断言 200 —— 否则后面的「跨租户 404」会因 FEATURE_NOT_FOUND
// 而绿得毫无意义（测的是 R3 不是 R2）。
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>, tenant = "demo") => {
  const r = await t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: debugUser(tenant, "admin", "admin"),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } },
  });
  expect(r.statusCode, `开 ${tenant} 的 sim feature 失败 —— 后续断言会测错东西`).toBe(200);
  return r;
};

const BASE = { o1: { risk: 0.5 }, o2: { risk: 0.2 } };

async function newSession(t: Awaited<ReturnType<typeof makeApp>>, headers = ADMIN): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers, payload: { baseSnapshot: BASE } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

const listCps = (t: Awaited<ReturnType<typeof makeApp>>, sid: string, headers = ADMIN) =>
  t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers });

describe("WO-ENGINE-2 件二 · 检查点列表读端", () => {
  it("效果层：每建一个检查点，列表内容随之变（建之前空 → 建两个后按建者顺序可读回 label/tick）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await newSession(t);

    // 建之前：路由通、但内容为空（诚实空，不是 404 也不是臆造）。
    const empty = await listCps(t, sid);
    expect(empty.statusCode, "路由未注册则此处 404 —— 摘掉 app.ts 那段即红").toBe(200);
    expect(empty.json().items).toEqual([]);

    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });
    const cp1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "cpA" } });
    expect(cp1.statusCode).toBe(201);

    const one = await listCps(t, sid);
    expect(one.json().items.length, "建了 1 个检查点后列表仍为空 ⇒ 读端没真接仓储").toBe(1);
    expect(one.json().items[0].label).toBe("cpA");
    expect(one.json().items[0].tick).toBe(2);

    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "cpB" } });

    const two = await listCps(t, sid);
    expect(two.json().items.length).toBe(2);
    expect(two.json().items.map((c: { label: string }) => c.label).sort()).toEqual(["cpA", "cpB"]);
    // tick 也要跟着变 —— 证明读的是真记录不是回声
    expect(two.json().items.map((c: { tick: number }) => c.tick).sort()).toEqual([2, 3]);
  });

  // ⚠️ 下面两条**必须带正向对照**（owner 读得到 / 已知会话读得到）。
  // 只断言「跨租户 404」「未知会话 404」是**同义反复**：路由不存在时 fastify 也返 404，
  // 摘掉 app.ts 那段它们照样绿。这不是假设——变异反证第一轮实测到的就是这个（4 条里只红了 2 条）。
  it("R2 租户隔离：owner 读得到自己的检查点，另一租户的同 id 会话读不到（404，不是读到别人的）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await enableSim(t, "other");
    const sid = await newSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "mine" } });

    // 正向对照：路由没开则此处 404 ⇒ 本条随变异变红，不再同义反复。
    const own = await listCps(t, sid);
    expect(own.statusCode, "owner 都读不到 —— 路由未注册").toBe(200);
    expect(own.json().items.map((c: { label: string }) => c.label)).toEqual(["mine"]);

    const cross = await listCps(t, sid, debugUser("other", "admin", "admin"));
    expect(cross.statusCode, "跨租户竟读到了 —— R2 破").toBe(404);
    // 404 还不够：必须证明这个 404 是「会话不属于你」而非「路由不存在」。
    expect(cross.json().error.code).toBe("NOT_FOUND");
  });

  it("未知会话 → 404（沿用 getSimOr404，不返空列表冒充存在）；已知会话同头同法 → 200", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await newSession(t);

    const known = await listCps(t, sid);
    expect(known.statusCode, "已知会话都不通 —— 路由未注册").toBe(200);

    const r = await listCps(t, "simsess_nonexistent");
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });

  it("R3 entitlement 先于 authz：sim.checkpoint 未开的租户 → 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const r = await listCps(t, "simsess_whatever", debugUser("freshco", "admin", "admin"));
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code, "feature 未开时必须是 FEATURE_NOT_FOUND（能力不存在）而非 NOT_FOUND").toBe("FEATURE_NOT_FOUND");
  });
});
