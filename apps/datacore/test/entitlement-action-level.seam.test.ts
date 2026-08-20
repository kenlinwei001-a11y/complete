import { describe, expect, it } from "vitest";
import { makeApp, debugUser, ADMIN, PLANNER, BASE_MANAGER, type TestApp } from "./helpers.js";
import { ACTION_TYPE_FEATURE_MAP, FEATURE_REGISTRY } from "../src/features.js";

/**
 * 接缝门 · **ACTION 级 entitlement 的服务端半**（闭断点 `G-ENTITLEMENT-ACTION-LEVEL-CLIENT-ONLY`）。
 *
 * ── 病灶（本文件存在的理由）─────────────────────────────────────────────────
 * ACTION 级特性此前**只有客户端拦**：`useFeature("act.adopt-to-draft")` 隐藏按钮，
 * 而服务端 `POST /a/v1/action-drafts` 一道 entitlement 闸都没有 ⇒
 * **关掉 flag 之后直接打接口照样建草稿**。隐藏按钮是 UX 级，不是 entitlement。
 * 形态（铁律 0.6）：「我用『前端隐藏了按钮』当作『这个特性被关掉了』的证据，而前者并不度量后者。」
 *
 * ── 本门咬的是**链路**不是函数（假绿第 9 形态的对策）────────────────────────
 * 四条主用例全部经 **真 HTTP inject** 打 `POST /a/v1/action-drafts`，
 * 断言落在**响应状态码 + 错误信封 code + 草稿有没有真落库**上，
 * 不断言 `requireActionType` 被调用过 —— 「函数有测试」证明不了「生产那条路有闸」。
 *
 * ── 反侧金丝雀（正反两侧同一份实现）──────────────────────────────────────
 * 必咬：登记在 `ACTION_TYPE_FEATURE_MAP` 里的动作类型，flag 关 → 404。
 * 必**不**咬：未登记的 `对象数据变更`（R4 用户态对象写入的唯一路径），同一次关闭下仍 201。
 * 两侧读的是**同一张表**（`ACTION_TYPE_FEATURE_MAP`，从 src 直接 import，不在本文件另抄一份），
 * 抄一份就是装饰品：改主表时金丝雀拿旧的去测、照样绿。
 */

/** 关某个 flag（租户 override，L3 层，会 bump configVersion）。 */
async function disableFeature(t: TestApp, tenantId: string, key: string, headers: Record<string, string>): Promise<void> {
  const res = await t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenantId}/features`,
    headers,
    payload: { overrides: { [key]: false } },
  });
  if (res.statusCode !== 200) throw new Error(`关闭 ${key} 失败：${res.statusCode} ${res.body}`);
  const after = res.json() as { features: string[] };
  if (after.features.includes(key)) throw new Error(`关闭 ${key} 后它仍在生效集里（override 没生效，后面的断言全部无意义）`);
}

/** 建草稿（submit:false ⇒ 停在 DRAFT，不牵动审批链/执行器，本门只验闸不验执行）。 */
const createDraft = (t: TestApp, actionTypeKey: string, headers: Record<string, string>, payload: Record<string, unknown> = {}) =>
  t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers,
    payload: { actionTypeKey, payload, submit: false },
  });

const errCode = (res: { json: () => unknown }): string => (res.json() as { error?: { code?: string } }).error?.code ?? "<no error envelope>";

describe("SEAM · ACTION 级 entitlement 的服务端半（关闭 = 不存在 → 404 FEATURE_NOT_FOUND·先于 authz）", () => {
  it("T1 · flag 开 + 有权限用户 → 201，且草稿真落库（不是只回了个 id）", async () => {
    const t = await makeApp();
    const res = await createDraft(t, "plan_change", PLANNER, { versionId: "v-t1", reason: "T1 基线" });
    expect(res.statusCode, res.body).toBe(201);
    const { draftId, status } = res.json() as { draftId: string; status: string };
    expect(status).toBe("DRAFT");

    // 「真落库」判据落在**读回**上：运输层 201 不度量持久化（本仓「ok:true 就算成功」的老坑）。
    const stored = await t.repos.actionDrafts.get("demo", draftId);
    expect(stored?.actionTypeKey).toBe("plan_change");
    const readBack = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: PLANNER });
    expect(readBack.statusCode).toBe(200);
    expect((readBack.json() as { id: string }).id).toBe(draftId);
  });

  it("T2 · flag 关 + 有权限用户 → 404 且 error.code === FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    // 先证明同一请求在关闸前是通的 —— 否则 404 可能来自任何别的原因（假红/假绿两头都堵）。
    expect((await createDraft(t, "plan_change", PLANNER, { versionId: "v-pre", reason: "关闸前" })).statusCode).toBe(201);

    await disableFeature(t, "demo", "act.adopt-to-draft", ADMIN);

    const gone = await createDraft(t, "plan_change", PLANNER, { versionId: "v-t2", reason: "关闸后" });
    expect(gone.statusCode, gone.body).toBe(404);
    expect(errCode(gone)).toBe("FEATURE_NOT_FOUND");
    // 错误信封三件套统一（两系统同口径）。
    const env = gone.json() as { error: { code: string; message: string; requestId: string } };
    expect(typeof env.error.message).toBe("string");
    expect(env.error.requestId).toMatch(/^req/);

    // 一个字节都不许落库：闸拦住 = 草稿根本没建。
    expect(await t.repos.actionDrafts.list("demo", (d) => d.payload?.versionId === "v-t2")).toHaveLength(0);
  });

  it("T3 · flag 关 + **无权限**用户 → 仍是 404（不是 403）⇒ entitlement 排在 authz 之前", async () => {
    const t = await makeApp();
    // 造一个真的「无权限」：给 ACTION_TYPE plan_change 挂策略，只授 planner 执行。
    // 没有这条策略时 authz 是 default-allow（无策略即放行），那样 T3 什么都证明不了。
    await t.repos.policies.put({
      id: "pol_plan_change_planner_only",
      tenantId: "demo",
      resource: { kind: "ACTION_TYPE", key: "plan_change" },
      grants: [{ role: "planner", ops: ["EXECUTE"] }],
    });

    // ① 对照组：flag **开** 时，该用户拿的是 403 —— 证明他确实没权限（否则 T3 的 404 是白给的）。
    const forbiddenWhileOn = await createDraft(t, "plan_change", BASE_MANAGER, { versionId: "v-t3a", reason: "对照" });
    expect(forbiddenWhileOn.statusCode, forbiddenWhileOn.body).toBe(403);

    // ② 关掉 flag：同一个无权限用户、同一个请求 → 404 FEATURE_NOT_FOUND。
    //    403 会泄露「这个功能存在，只是你没权限」；铁律要的是「它不存在」。
    await disableFeature(t, "demo", "act.adopt-to-draft", ADMIN);
    const gone = await createDraft(t, "plan_change", BASE_MANAGER, { versionId: "v-t3b", reason: "关闸后无权限" });
    expect(gone.statusCode, gone.body).toBe(404);
    expect(errCode(gone), "无权限用户在功能关闭时必须拿 404 FEATURE_NOT_FOUND，拿到 403 = 闸挂在 authz 之后").toBe(
      "FEATURE_NOT_FOUND",
    );
  });

  it("T4 · 跨租户：A 租户关、B 租户开 → A 拿 404、B 正常 201 ⇒ 闸读的是**请求上下文的租户**", async () => {
    const t = await makeApp();
    const OTHER_TENANT = "other-tenant";
    const OTHER_PLANNER = debugUser(OTHER_TENANT, "planner", "planner");

    await disableFeature(t, "demo", "act.adopt-to-draft", ADMIN); // 只关 demo

    const a = await createDraft(t, "plan_change", PLANNER, { versionId: "v-t4a", reason: "A 租户（已关）" });
    expect(a.statusCode, a.body).toBe(404);
    expect(errCode(a)).toBe("FEATURE_NOT_FOUND");

    const b = await createDraft(t, "plan_change", OTHER_PLANNER, { versionId: "v-t4b", reason: "B 租户（未关）" });
    expect(b.statusCode, b.body).toBe(201);
    // 落在 B 租户名下（tenant_id everywhere），且没有漏到 A。
    const bId = (b.json() as { draftId: string }).draftId;
    expect((await t.repos.actionDrafts.get(OTHER_TENANT, bId))?.tenantId).toBe(OTHER_TENANT);
    expect(await t.repos.actionDrafts.get("demo", bId)).toBeUndefined();
  });

  it("T5 · 反侧金丝雀：未登记的动作类型（对象数据变更）在同一次关闭下**仍然 201** —— 闸不许越界", async () => {
    const t = await makeApp();
    await disableFeature(t, "demo", "act.adopt-to-draft", ADMIN);

    // `对象数据变更` 是 R4「用户态对象写入的唯一路径」，刻意**不**登记在 ACTION_TYPE_FEATURE_MAP 里；
    // 若它也被关掉，说明闸做成了整条路由一刀切 —— 那会让「关掉采纳」顺带关掉所有对象写入。
    expect(ACTION_TYPE_FEATURE_MAP["对象数据变更"], "对象数据变更 一旦被登记，本条金丝雀的语义就变了，必须重写而不是改断言").toBeUndefined();
    const still = await createDraft(t, "对象数据变更", PLANNER, { objectType: "Order", objectId: "obj_none", patch: { qty: 1 }, reason: "金丝雀" });
    expect(still.statusCode, still.body).toBe(201);
  });

  it("T6 · 逐 flag 精确：关 act.aop-finalize 只打掉 AOP情景拍板，采纳类照常", async () => {
    const t = await makeApp();
    await disableFeature(t, "demo", "act.aop-finalize", ADMIN);

    const aop = await createDraft(t, "AOP情景拍板", ADMIN, { scenarioKey: "base", year: 2026 });
    expect(aop.statusCode, aop.body).toBe(404);
    expect(errCode(aop)).toBe("FEATURE_NOT_FOUND");

    const adopt = await createDraft(t, "plan_change", PLANNER, { versionId: "v-t6", reason: "另一个 flag 不受影响" });
    expect(adopt.statusCode, adopt.body).toBe(201);
  });

  it("T7 · 台账自洽：表里每个 featureKey 都真在注册表里、且都是 ACTION 级（防拼错键 → 闸静默恒开）", async () => {
    const byKey = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));
    const entries = Object.entries(ACTION_TYPE_FEATURE_MAP);
    expect(entries.length, "表空了 = 闸对谁都不生效（空集不许冒充『没问题』）").toBeGreaterThan(0);
    for (const [actionTypeKey, featureKey] of entries) {
      const def = byKey.get(featureKey);
      expect(def, `${actionTypeKey} → ${featureKey}：注册表里没有这个键，闸会永远查不到 ⇒ 恒放行`).toBeDefined();
      expect(def!.level, `${featureKey} 不是 ACTION 级`).toBe("ACTION");
    }
  });
});
