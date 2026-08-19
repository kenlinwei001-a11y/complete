/**
 * WO-ENTITLEMENT-ACTION-SERVER-GATE · **ACTION 级 entitlement 服务端闸**接缝测试
 * （闭本体 §8 `G-ENTITLEMENT-ACTION-LEVEL-CLIENT-ONLY` 的服务端一半）。
 *
 * ── 病灶（审核方 2026-08-19 实测）──────────────────────────────────────────
 * `act.adopt-to-draft` 在 `features.ts` 是 `level:"ACTION"`，前端 5 个入口全部用
 * `<Feature>`/`useFeature` 包住 —— 但 **`POST /a/v1/action-drafts` 路由体内一个
 * `requireFeature`/`assertFeature` 都没有**。于是关掉这个 flag：屏上按钮消失了，
 * `curl` 照样建草稿、审批通过照样落真值。**客户端隐藏按钮是 UX 级，不是 entitlement。**
 *
 * ── 本测试咬的是**链路**不是函数（SEAM-GATE）─────────────────────────────
 * 全部经真 HTTP inject 驱动「租户 override 关 flag → 打真路由」这条接缝，
 * 而不是直接调 `FeatureService.requireForActionType()`。只测后者 = 「已排练，不是已实现」
 * （假绿第 9 形态）：函数绿而路由没接线时，那种测试照样全绿。
 *
 * ── 判据（缺一不可）───────────────────────────────────────────────────────
 * ① flag 开 ⇒ 201（闸不误杀）
 * ② flag 关 ⇒ **404 且 `error.code === "FEATURE_NOT_FOUND"`**（不是 403，不是 200）
 * ③ flag 关 + **无 EXECUTE 权限**的用户 ⇒ **仍是 404**，不是 403
 *    —— 这一条才是「entitlement 先于 authz」的真判据：403 会泄漏「功能存在，只是你没权限」。
 *    同用例内先用「flag 开 + 同一个用户 ⇒ 403」做**对照组**，证明这个用户确实没权限；
 *    没有对照组时 ③ 恒绿（哪怕闸根本没生效，因为它本来也可能是 404）。
 * ④ **不过度杀伤**：未登记的 actionTypeKey（`plan_change`）在 flag 关时照样 201。
 * ⑤ **防漂移金丝雀**：ACTION 级 flag 全集写死在本文件；新增一个而不登记服务端闸处置 ⇒ 本测试变红。
 */
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, BASE_MANAGER, type TestApp } from "./helpers.js";
import { ACTION_TYPE_FEATURE, FEATURE_REGISTRY } from "../src/features.js";

/** 真 HTTP 驱动接缝：建 Action 草稿（`submit:false` 停在 DRAFT —— 本测试验的是**闸**，不是审批链）。 */
const createDraft = (
  t: TestApp,
  headers: Record<string, string>,
  actionTypeKey: string,
  payload: Record<string, unknown>,
) =>
  t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers,
    payload: { actionTypeKey, payload, submit: false },
  });

/** 租户级 override 开/关一个 flag（L3 层，压过 L1 defaultOn 与 L2 行业模板）。 */
const setTenantFlag = (t: TestApp, key: string, on: boolean) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { [key]: on } },
  });

const errCode = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;

/** `采纳产能预测结论` 的合法 payload（`battery.ts` paramsSchema required: modelId/mode/demandWan/snapshot）。 */
const FORECAST_PAYLOAD = {
  source: "project-sim",
  modelId: "4680-NCM",
  mode: "single",
  demandWan: 120,
  weeks: 8,
  snapshot: { kind: "capacity_forecast", capWanP50: 100, capWanP90: 90, gapWan: 30, mainBn: "涂布" },
};

describe("ACTION 级 entitlement 服务端闸（G-ENTITLEMENT-ACTION-LEVEL-CLIENT-ONLY）", () => {
  it("①② act.adopt-to-draft：开 ⇒ 201；关 ⇒ 404 FEATURE_NOT_FOUND（不是 403 也不是 200）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① flag 开（demo=battery 模板 all-on + defaultOn:true）⇒ 正常建草稿
    const on = await createDraft(t, ADMIN, "采纳产能预测结论", FORECAST_PAYLOAD);
    expect(on.statusCode).toBe(201);
    expect((on.json() as { status: string }).status).toBe("DRAFT");

    // ② 租户级关掉 ⇒ 功能关闭 = 不存在
    expect((await setTenantFlag(t, "act.adopt-to-draft", false)).statusCode).toBe(200);
    const off = await createDraft(t, ADMIN, "采纳产能预测结论", { ...FORECAST_PAYLOAD, demandWan: 121 });
    expect(off.statusCode).toBe(404);
    expect(errCode(off)).toBe("FEATURE_NOT_FOUND");

    // 同一 flag 门后的另外两个动作类型一并关闭（不是只堵了一个 key）
    const off2 = await createDraft(t, ADMIN, "采纳经营方案", { schemeNo: 1, reason: "x" });
    expect(off2.statusCode).toBe(404);
    expect(errCode(off2)).toBe("FEATURE_NOT_FOUND");
    const off3 = await createDraft(t, ADMIN, "采纳产能保障方案", { modelId: "4680-NCM", levers: [] });
    expect(off3.statusCode).toBe(404);
    expect(errCode(off3)).toBe("FEATURE_NOT_FOUND");

    // 关掉后**没有任何草稿落库**（真值层判据，不是只看状态码）
    const list = await t.app.inject({ method: "GET", url: "/a/v1/action-drafts", headers: ADMIN });
    const drafts = (list.json() as { items?: unknown[] } | unknown[]) as { items?: { actionTypeKey: string }[] };
    const items = Array.isArray(drafts) ? (drafts as { actionTypeKey: string }[]) : (drafts.items ?? []);
    expect(items.filter((d) => d.actionTypeKey === "采纳产能预测结论").length).toBe(1); // 只有 ① 那一张
    expect(items.some((d) => d.actionTypeKey === "采纳经营方案")).toBe(false);
  });

  it("③ entitlement 先于 authz：flag 关 + 无 EXECUTE 权限的用户 ⇒ 仍是 404，不是 403", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 给该 ActionType 挂一条只授 planner 的策略 ⇒ base_manager 无 EXECUTE 权限
    // （无策略时 authz 默认放行，不挂这条就造不出「无权限用户」，③ 会退化成恒绿）。
    await t.repos.policies.put({
      id: "pol_act_forecast_adopt",
      tenantId: "demo",
      resource: { kind: "ACTION_TYPE", key: "采纳产能预测结论" },
      grants: [{ role: "planner", ops: ["EXECUTE"] }],
    });

    // 对照组：flag **开**时，同一个用户拿到的是 403 —— 证明他确实没权限（没有这一步 ③ 恒绿）
    const denied = await createDraft(t, BASE_MANAGER, "采纳产能预测结论", FORECAST_PAYLOAD);
    expect(denied.statusCode).toBe(403);
    // 有权限的用户此时正常
    const allowed = await createDraft(t, PLANNER, "采纳产能预测结论", { ...FORECAST_PAYLOAD, demandWan: 122 });
    expect(allowed.statusCode).toBe(201);

    // 关掉 flag ⇒ 无权限用户看到的**必须**从 403 变成 404（功能关闭 = 不存在，先于角色判定）
    await setTenantFlag(t, "act.adopt-to-draft", false);
    const gone = await createDraft(t, BASE_MANAGER, "采纳产能预测结论", FORECAST_PAYLOAD);
    expect(gone.statusCode).toBe(404);
    expect(errCode(gone)).toBe("FEATURE_NOT_FOUND");
    // 有权限的用户同样 404（闸对所有人一致，不是只拦没权限的）
    const goneToo = await createDraft(t, PLANNER, "采纳产能预测结论", { ...FORECAST_PAYLOAD, demandWan: 123 });
    expect(goneToo.statusCode).toBe(404);
    expect(errCode(goneToo)).toBe("FEATURE_NOT_FOUND");
  });

  it("① ② act.aop-finalize：AOP情景拍板 开 ⇒ 201；关 ⇒ 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const payload = { year: 2026, scenarioKey: "base", reason: "年度拍板" };

    const on = await createDraft(t, ADMIN, "AOP情景拍板", payload);
    expect(on.statusCode).toBe(201);

    await setTenantFlag(t, "act.aop-finalize", false);
    const off = await createDraft(t, ADMIN, "AOP情景拍板", { ...payload, scenarioKey: "high" });
    expect(off.statusCode).toBe(404);
    expect(errCode(off)).toBe("FEATURE_NOT_FOUND");

    // 级联：父 view.annual-scenario 关 ⇒ act.aop-finalize 级联关 ⇒ 同样 404（cascade 真进闸，不是只看自身 override）
    const t2 = await makeApp();
    await seedBattery(t2);
    await setTenantFlag(t2, "view.annual-scenario", false);
    const cascaded = await createDraft(t2, ADMIN, "AOP情景拍板", payload);
    expect(cascaded.statusCode).toBe(404);
    expect(errCode(cascaded)).toBe("FEATURE_NOT_FOUND");
  });

  it("④ 不过度杀伤：未登记的 actionTypeKey（plan_change / 对象数据变更）在 flag 关时照样 201", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await setTenantFlag(t, "act.adopt-to-draft", false);
    // `plan_change` 有 7 处**没过这道 flag 门**的生产者（GlobalSim / RiskBoard / OrderChain …），
    // 收进闸表就等于关一个「采纳为草稿」把它们一起打死 —— 故意不收，此断言就是那条边界的守卫。
    const planChange = await createDraft(t, ADMIN, "plan_change", { versionId: "v-1", reason: "全局推演采纳" });
    expect(planChange.statusCode).toBe(201);
    // `对象数据变更` 是 R4「真值经 Action」的**通用**对象写路径（注册在多个 ObjectType 上），同理不收。
    const objChange = await createDraft(t, ADMIN, "对象数据变更", {
      objectId: "obj-not-exist",
      patch: { x: 1 },
      reason: "r",
    });
    expect(objChange.statusCode).toBe(201);
  });

  it("⑤ 防漂移金丝雀：ACTION 级 flag 全集 + 每个的服务端闸处置必须逐条登记（新增一个即变红）", async () => {
    /**
     * 2026-08-19 逐条实测的服务端闸现状（本体 §8 该条原文说「其余 ACTION 级特性未逐条核」，这里核完）：
     *  · GATED_BY_ACTION_TYPE   —— 本单新接：`POST /a/v1/action-drafts` 按 actionTypeKey 判（features.ts ACTION_TYPE_FEATURE）
     *  · GATED_BY_BINDING       —— 早已有闸：`features.enabled(...) → featureNotFound()`（app.ts 记录物化两条路由）
     *  · NO_SERVER_WRITE_ROUTE  —— **服务端根本没有对应写路由**：纯客户端呈现动作，
     *      `act.export` = `downloadBlob`/`downloadProvenanceReport`（用已取到的数据在浏览器里拼文档），
     *      `act.plan-audit.apply-fix` = `PlanAuditView.applyFix` 只 `setForm({...})` 改本地表单。
     *      ⚠ 这两条**不许**硬加一层闸凑数：给它们加闸只能去卡底层只读路由，那是另一种过度杀伤。
     */
    const SERVER_GATE_STATUS: Record<string, "GATED_BY_ACTION_TYPE" | "GATED_BY_BINDING" | "NO_SERVER_WRITE_ROUTE"> = {
      "act.plan-audit.apply-fix": "NO_SERVER_WRITE_ROUTE",
      "act.adopt-to-draft": "GATED_BY_ACTION_TYPE",
      "act.export": "NO_SERVER_WRITE_ROUTE",
      "act.aop-finalize": "GATED_BY_ACTION_TYPE",
      "data-import.record-materialize": "GATED_BY_BINDING",
    };
    const actionFlags = FEATURE_REGISTRY.filter((f) => f.level === "ACTION").map((f) => f.key).sort();
    // 金丝雀：先自证抽取是对的（已知必中 act.adopt-to-draft）——抽出 0 条时报「工具坏了」，不许读成「没有 ACTION 级特性」
    expect(actionFlags).toContain("act.adopt-to-draft");
    expect(actionFlags).toEqual(Object.keys(SERVER_GATE_STATUS).sort());

    // 标了 GATED_BY_ACTION_TYPE 的，必须真的在闸表里出现（登记与实现不许各说各话）
    const gatedByActionType = new Set(Object.values(ACTION_TYPE_FEATURE));
    for (const [flag, status] of Object.entries(SERVER_GATE_STATUS)) {
      if (status === "GATED_BY_ACTION_TYPE") expect(gatedByActionType.has(flag)).toBe(true);
      else expect(gatedByActionType.has(flag)).toBe(false);
    }
  });
});
