import { describe, it, expect, beforeAll } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import type { ObjectInterface } from "@platform/contracts";

/**
 * WO-INTERFACE-ACTIONTYPE-DEEPVAL · G-NO-INTERFACE 残口②接缝测试。
 *
 * 残口②（本体 §8 自陈）：`actions` 校验止于「ActionType 已注册 + 类型已绑定」，
 * 且注册性只在接口写入时把守（checkInterfaceIntegrity），发布门自身不查；
 * 签名（targetTypeKey 归因 / paramsSchema 参数形状）与被绑定 ActionType 实际定义从不兑现。
 *
 * 本文件三类硬门用例全部走**真 publishVersion 链路**（POST /a/v1/ontology/publish →
 * assertInterfaceConformance → checkInterfaceConformance），断言发布被拒且点名到
 * 哪个接口、哪个 ActionType、哪项不符：
 *  A. 接口声明的 ActionType 未注册（绕过 service 直写仓储造出带病接口 → 发布门必须自己拦住）；
 *  B. targetTypeKey 归因不符（adopt_mitigation 归因 AdoptedMitigation，绑到别的类型 = 假绑定）；
 *  C. 参数形状不符（接口 paramKeys ⊄ ActionType.paramsSchema.properties）。
 * 每类都带正对照（相符 → 发布放行），证明门不是"一律拒"。
 */

const ifaceUrl = "/a/v1/ontology/interfaces";
/** 测试 A 专用独立租户（demo 的电池种子不动，免复位负担）。 */
const DV = { "x-debug-user": "dvdeep:admin:admin" };

async function publishOntology(t: TestApp, headers: Record<string, string> = ADMIN) {
  return t.app.inject({ method: "POST", url: "/a/v1/ontology/publish", headers });
}

async function getType(t: TestApp, key: string) {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
  return (JSON.parse(res.body) as { key: string; properties: Record<string, unknown>[] }[]).find((x) => x.key === key);
}

/**
 * REST 重 upsert 过单位字典门（app.ts POST object-types 逐属性查 UNIT_DICTIONARY），而电池种子的
 * AdoptedMitigation 含 unit='点' 的属性是**仓储直写**进去的、不在字典内 —— 与残口②无关的既有
 * 种子/路由不对称（实测报「未知单位 '点'」400）。本测试断的是接口-行动深校验，不涉单位，
 * 故重 upsert 时剥掉 unit 仅为过路由；isPrimaryKey 显式重建（GET 透出的定义照用其余字段）。
 */
const forReupsert = (props: Record<string, unknown>[]) =>
  props.map((p, i) => {
    const rest: Record<string, unknown> = { ...p };
    delete rest.unit;
    return { ...rest, isPrimaryKey: i === 0 };
  });

describe("WO-INTERFACE-ACTIONTYPE-DEEPVAL · 接口 ActionType 绑定深校验（残口②）", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 120_000);

  // ── A · 未注册 ActionType ────────────────────────────────────────────────
  it("A：接口声明的 ActionType 未注册（直写仓储绕过写入期完整性门）→ 真发布链拒绝并点名", async () => {
    // 带病接口只能直写仓储造出（走 service 会在 upsert 被 checkInterfaceIntegrity 拦下——
    // 这正是本用例的意义：写入期那道门之外，发布门自身必须兜得住注册表漂移/直写）。
    const ghost: ObjectInterface = {
      id: "oif_ghost_dv",
      tenantId: "dvdeep",
      key: "__Ghost",
      version: 1,
      name: "幽灵接口",
      properties: [],
      actions: [{ actionTypeKey: "未注册的行动XYZ", required: true }],
      status: "PUBLISHED",
    };
    await t.repos.objectInterfaces.put(ghost);

    // 类型甚至"绑定"了这个 key —— 修前发布门只看绑定与否（INTERFACE_ACTION_MISSING 不触发），
    // 从未拿注册表对表 ⇒ 带病进快照。类型绑定的是字符串，upsert 不校验行动 key，放得进去。
    const up = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: DV,
      payload: {
        key: "__GhostType",
        displayName: "幽灵类型",
        properties: [{ propKey: "ghostId", dataType: "string", isPrimaryKey: true, unit: "dimensionless", scale: "absolute" }],
        implements: [{ interfaceKey: "__Ghost", version: "latest" }],
        actions: [{ actionTypeKey: "未注册的行动XYZ" }],
      },
    });
    expect(up.statusCode).toBe(201);

    const blocked = await publishOntology(t, DV);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_ACTION_UNKNOWN");
    expect(blocked.body).toContain("__Ghost"); // 哪个接口
    expect(blocked.body).toContain("未注册的行动XYZ"); // 哪个 ActionType
    expect(blocked.body).toContain("__GhostType"); // 哪个实现者

    // 复位：摘除 implements/actions → 门对该类型空转 → 发布恢复
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: DV,
      payload: {
        key: "__GhostType",
        displayName: "幽灵类型",
        properties: [{ propKey: "ghostId", dataType: "string", isPrimaryKey: true, unit: "dimensionless", scale: "absolute" }],
        implements: [],
        actions: [],
      },
    });
    expect((await publishOntology(t, DV)).statusCode).toBe(200);
  }, 60_000);

  // ── B · targetTypeKey 归因不符 ───────────────────────────────────────────
  it("B：绑定的 ActionType 归因目标不是本类型（假绑定）→ 拒绝并点名；归因相符 → 放行", async () => {
    // adopt_mitigation 是电池种子真注册的 ActionType，targetTypeKey = AdoptedMitigation（WO-ACTIONTYPE-TARGET）。
    const mk = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "__Mitigatable",
        name: "可处置物",
        properties: [],
        actions: [{ actionTypeKey: "adopt_mitigation", required: true }],
      },
    });
    expect(mk.statusCode).toBe(201);
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/__Mitigatable/publish`, headers: ADMIN, payload: {} });

    // 正对照先行：归因相符的绑定（AdoptedMitigation 绑 adopt_mitigation）必须放行 —— 门不是"一律拒"。
    const am = await getType(t, "AdoptedMitigation");
    expect(am, "AdoptedMitigation 应在电池种子里").toBeTruthy();
    const bindOk = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "AdoptedMitigation",
        displayName: "已采纳处置方案",
        properties: forReupsert(am!.properties),
        implements: [{ interfaceKey: "__Mitigatable", version: "latest" }],
        actions: [{ actionTypeKey: "adopt_mitigation" }],
      },
    });
    expect(bindOk.statusCode).toBe(201);
    expect((await publishOntology(t)).statusCode).toBe(200);

    // 负例：另一个类型也绑 adopt_mitigation —— 归因目标是 AdoptedMitigation，不是它 ⇒ 假绑定。
    const fake = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "__FakeMitigationTarget",
        displayName: "假处置目标",
        properties: [{ propKey: "fmId", dataType: "string", isPrimaryKey: true, unit: "dimensionless", scale: "absolute" }],
        implements: [{ interfaceKey: "__Mitigatable", version: "latest" }],
        actions: [{ actionTypeKey: "adopt_mitigation" }],
      },
    });
    expect(fake.statusCode).toBe(201);

    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_ACTION_TARGET_MISMATCH");
    expect(blocked.body).toContain("__FakeMitigationTarget"); // 哪个类型
    expect(blocked.body).toContain("__Mitigatable"); // 哪个接口
    expect(blocked.body).toContain("adopt_mitigation"); // 哪个 ActionType
    expect(blocked.body).toContain("AdoptedMitigation"); // 哪项不符：实际归因目标

    // 复位：两处绑定都摘掉 → 发布恢复
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "__FakeMitigationTarget",
        displayName: "假处置目标",
        properties: [{ propKey: "fmId", dataType: "string", isPrimaryKey: true, unit: "dimensionless", scale: "absolute" }],
        implements: [],
        actions: [],
      },
    });
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "AdoptedMitigation",
        displayName: "已采纳处置方案",
        properties: forReupsert(am!.properties),
        implements: [],
        actions: [],
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  // ── C · 参数形状不符 ─────────────────────────────────────────────────────
  it("C：接口声明的 paramKeys 超出 ActionType.paramsSchema → 拒绝并点名缺哪个参数", async () => {
    // adopt_mitigation.paramsSchema.properties = { base, factor, planKey }（电池种子字面量）。
    const mk = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "__PlanKeyed",
        name: "需方案键物",
        properties: [],
        actions: [{ actionTypeKey: "adopt_mitigation", required: true, paramKeys: ["base", "factor", "planKey"] }],
      },
    });
    expect(mk.statusCode).toBe(201);
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/__PlanKeyed/publish`, headers: ADMIN, payload: {} });

    // 绑定到归因相符的 AdoptedMitigation；v1 的 paramKeys 全在 paramsSchema 内 → 正对照放行。
    const am = await getType(t, "AdoptedMitigation");
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "AdoptedMitigation",
        displayName: "已采纳处置方案",
        properties: forReupsert(am!.properties),
        implements: [{ interfaceKey: "__PlanKeyed", version: "latest" }],
        actions: [{ actionTypeKey: "adopt_mitigation" }],
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);

    // 演进接口 v2：要求一个 paramsSchema 里没有的参数键 → 发布被拒并点名缺哪个。
    const up = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "__PlanKeyed",
        name: "需方案键物",
        properties: [],
        actions: [{ actionTypeKey: "adopt_mitigation", required: true, paramKeys: ["base", "不存在的参数键"] }],
      },
    });
    expect(up.statusCode).toBe(201);
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/__PlanKeyed/publish`, headers: ADMIN, payload: {} });

    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_ACTION_PARAM_MISMATCH");
    expect(blocked.body).toContain("AdoptedMitigation"); // 哪个类型
    expect(blocked.body).toContain("__PlanKeyed"); // 哪个接口
    expect(blocked.body).toContain("adopt_mitigation"); // 哪个 ActionType
    expect(blocked.body).toContain("不存在的参数键"); // 哪项不符：缺哪个参数

    // 复位：退役 v2 + 摘绑定 → 发布恢复
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/__PlanKeyed/retire`, headers: ADMIN, payload: { version: 2 } });
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "AdoptedMitigation",
        displayName: "已采纳处置方案",
        properties: forReupsert(am!.properties),
        implements: [],
        actions: [],
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  // ── 零回归 ───────────────────────────────────────────────────────────────
  it("零回归：电池种子既有接口绑定（对象数据变更·不可静态归因·无 paramKeys）逐字节沿用现状", async () => {
    // 对象数据变更 targetTypeKey 缺省 = 不可静态归因 → 跳过对齐校验（不许冒充不符）；
    // Approvable 的 action 要求无 paramKeys → 参数对表不触发。全量发布必须照样放行。
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);
});
