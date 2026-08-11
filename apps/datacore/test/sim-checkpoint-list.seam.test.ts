import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/**
 * ══ 接缝门 · 检查点存档「写→读→再驱动」整条链（欠账 #157 · `G-SIM-CHECKPOINT-NOREAD`）══
 *
 * 🔴 **本文件咬的是链路，不是函数**（假绿第 9 形态的对策）。
 * `repo.listCheckpoints` 三处实现（`repo/repo.ts` 接口 · `repo/memory.ts:70` · `repo/pg.ts:103`）
 * 在本单之前**全仓零调用方** —— 实现有、类型有、双实现齐全，就是没人调。给它补一条
 * 「函数返回了数组」的 unit 测试毫无意义：那咬的还是函数。所以本文件的每条断言都必须
 * **穿过 HTTP 路由**，并且**用列表吐出来的那个 id 去真的驱动下游动作**（rollback / branch）——
 * 列表若是空壳或顺序错了，下游当场错，测试才会红。
 *
 * 判据来自真服务实测（2026-08-11，端口 4088 起 `dist/server.js`）：
 *   · 补路由前：`GET /a/v1/sim/sessions/:id/checkpoints` → 404 `{"code":"NOT_FOUND","message":"route not found"}`
 *     —— 注意这是 **Fastify 路由级 404**，与应用级 404（`"sim session not found not found"`）
 *     字面不同，故可判定「路由真不存在」而非「实体不存在」。
 *   · 同一会话 `POST …/checkpoint` 两次均 201，落库成功 —— **写端一直是通的**，缺的只有读端。
 */
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>, tenant = "demo") =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } },
  });
const BASE = { o1: { risk: 0.5 }, o2: { risk: 0.2 } };

type Cp = { id: string; sessionId: string; tenantId: string; tick: number; label: string; createdAt: string };

const mkSession = async (t: Awaited<ReturnType<typeof makeApp>>, headers = ADMIN) =>
  (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers, payload: { baseSnapshot: BASE } })).json().id as string;

describe("接缝 · 沙盘检查点存档可读（欠账 #157）", () => {
  it("① 写→读接缝：存两个检查点 → GET …/checkpoints 真吐出这两条（字段逐个对得上，不是空壳）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await mkSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });
    const a = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "存档甲" } })).json() as Cp;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 3 } });
    const b = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "存档乙" } })).json() as Cp;

    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const items = r.json().items as Cp[];
    // 内容级判据：不是「返回了 200」，是**这两条真的在里面且字段没串**。
    expect(items).toHaveLength(2);
    expect(items.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(items.map((c) => c.label)).toEqual(["存档甲", "存档乙"]);
    expect(items.map((c) => c.tick)).toEqual([2, 5]);
    expect(items.every((c) => c.sessionId === sid)).toBe(true);
    expect(items.every((c) => c.tenantId === "demo")).toBe(true);
    // 存档时间是真时间戳，不是占位串。
    expect(Number.isNaN(Date.parse(items[0].createdAt))).toBe(false);
  });

  it("② 顺序即语义：tick 大的先存、tick 小的后存 → 列表按 tick 升序（咬死 memory 仓储的插入序）", async () => {
    // 🔴 这条是本文件的**主锚点**。`repo/pg.ts:103` 有 `ORDER BY tick`，而 `repo/memory.ts:70`
    // **一个 sort 都没有**（Map 插入序）——两个实现在此处天生分叉（破 R9）。
    // 沙盘的常规动作恰好会踩中：存档 → 回滚 → 在更早的 tick 再存一次，于是**插入序与 tick 序相反**。
    // 路由层排序若被拿掉，memory 会吐出 [tick5, tick2]，本条当场红。
    const t = await makeApp();
    await enableSim(t);
    // 乱序复现（同一会话内）：tick2 存「锚」→ 推到 tick8 存「顶」→ **回滚到 tick2** → 再存「回」。
    // 于是插入序 = [锚@2, 顶@8, 回@2]，而 tick 升序 = [锚@2, 回@2, 顶@8] —— 两者不同。
    const s5 = await mkSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/tick`, headers: ADMIN, payload: { n: 2 } });
    const anchor2 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/checkpoint`, headers: ADMIN, payload: { label: "锚@2" } })).json() as Cp;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/tick`, headers: ADMIN, payload: { n: 6 } });
    const top8 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/checkpoint`, headers: ADMIN, payload: { label: "顶@8" } })).json() as Cp;
    expect(top8.tick).toBe(8);
    // 回滚到 tick2 → 再存一个 tick2 的档：**插入序第 3、tick 最小**
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/rollback`, headers: ADMIN, payload: { checkpointId: anchor2.id } });
    const back2 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s5}/checkpoint`, headers: ADMIN, payload: { label: "回@2" } })).json() as Cp;
    expect(back2.tick).toBe(2);

    const items = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${s5}/checkpoints`, headers: ADMIN })).json().items as Cp[];
    expect(items).toHaveLength(3);
    // tick 升序：两个 tick2 排在 tick8 之前 —— memory 的插入序会把「顶@8」排在中间，本条即红。
    expect(items.map((c) => c.tick)).toEqual([2, 2, 8]);
    expect(items[2].label).toBe("顶@8");
    // 同 tick 内按 createdAt→id 定全序：先存的「锚@2」在后存的「回@2」之前。
    expect(items.slice(0, 2).map((c) => c.label)).toEqual(["锚@2", "回@2"]);
  });

  it("③ 列表吐的 id 真能驱动 rollback（读端不是装饰品：挑一条历史档，世界真回到那个 tick）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await mkSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "早" } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 4 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "晚" } });
    // 只经 GET 拿 id —— 模拟前端「列清单 → 用户挑一条」，不复用 POST 的返回值。
    const items = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: ADMIN })).json().items as Cp[];
    const earliest = items[0];
    expect(earliest.label).toBe("早");
    const rb = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/rollback`, headers: ADMIN, payload: { checkpointId: earliest.id } });
    expect(rb.statusCode).toBe(200);
    expect(rb.json().curTick).toBe(2); // 世界真回到清单里那条档的 tick
    const world = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN });
    expect(world.json().tick).toBe(2);
  });

  it("④ 列表吐的 id 真能驱动 branch（这正是 SandboxView 今天做不到的「从任意历史档开分支」）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await mkSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 3 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "分叉点" } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 5 } });
    const items = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: ADMIN })).json().items as Cp[];
    expect(items).toHaveLength(1);
    const br = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN, payload: { checkpointId: items[0].id } });
    expect(br.statusCode).toBe(201);
    // 子世界确实挂在**清单里那条**档上（不是当场新存的那个）——旧路径必须先 POST 一个新档才能分支。
    expect(br.json().parentCheckpointId).toBe(items[0].id);
    expect(br.json().curTick).toBe(0);
  });

  it("⑤ R3 暗发先于 authz：只开 sim.sandbox、不开 sim.checkpoint → 404 FEATURE_NOT_FOUND（证明门挂在 sim.checkpoint 上）", async () => {
    const t = await makeApp();
    const TEN = "cpfeat";
    const H = debugUser(TEN, "admin", "admin");
    await t.app.inject({ method: "PUT", url: `/a/v1/tenants/${TEN}/features`, headers: H, payload: { overrides: { "sim.sandbox": true } } });
    const sid = await mkSession(t, H); // sandbox 开着 ⇒ 建会话成功
    expect(typeof sid).toBe("string");
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: H });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("⑥ R2 跨租户隔离：他租户拿本租户 sessionId 读检查点 → 404，且不泄露任何存档", async () => {
    const t = await makeApp();
    await enableSim(t);
    await enableSim(t, "other");
    const sid = await mkSession(t);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "私密存档" } });
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: debugUser("other", "admin", "admin") });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain("私密存档");
  });

  it("⑦ 未知会话 → 应用级 404（而非路由级 404：路由在，实体不在）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions/sims_nope/checkpoints", headers: ADMIN });
    expect(r.statusCode).toBe(404);
    // 判据即真服务实测里区分两种 404 的那条：应用级说的是「实体不在」，路由级说的是「route not found」。
    expect(r.json().error.message).toContain("sim session not found");
    expect(r.json().error.message).not.toContain("route not found");
  });

  it("⑧ 空存档 → 200 + 空数组（不是 404，也不是 null：前端要能拿它渲染空列表）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await mkSession(t);
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/checkpoints`, headers: ADMIN });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toEqual([]);
  });
});
