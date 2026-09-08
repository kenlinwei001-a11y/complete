import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-MATERIALIZE-3EXT · 接缝门：**声明这三类映射（声明侧）× 多跳检索真能取到边（实例侧）**。
 *
 * ── 守的是哪条接缝 ────────────────────────────────────────────────────────
 * `POST /a/v1/ontology/link-types` 写 `repos.ontologyLinks`（声明），
 * `executeSlice` 遍历 `repos.links`（实例）。`viaProperty` 已把这座桥架起来 80%，
 * 剩下的三类**元模型里没有形状可以表达**，于是「建成了、检索恒 0」：
 *
 * | 桶 | 病 | 本单的显式声明 |
 * |---|---|---|
 * | ② | 外键值对得上，但对上的那一列**不是主键** | `anchorProperty` |
 * | ⑤ | 一个属性里放**多个**目标 id（数组） | `viaMultiValue` |
 * | ① | 关系本身是个**桥对象**，两端谁都装不下 | `viaBridge` |
 *
 * 每条用例都自带**金丝雀**：先证明检索方法本身是好的（出厂边能返回边），再报「新建边 0 条」。
 * 否则「我的检索坏了」与「这条边没实例」在屏上一模一样。
 *
 * ⚠ 断言咬的是**边数 + 端点类型**，不只是「有边」——写反方向照样有边、照样绿，但拓扑是错的。
 */

async function resolveOneHop(
  t: Awaited<ReturnType<typeof makeApp>>,
  sliceKey: string,
  rootType: string,
  linkKey: string,
): Promise<{ nodes: { id: string; typeKey: string }[]; edges: { linkKey: string; from: string; to: string }[] }> {
  const put = await t.app.inject({
    method: "PUT",
    url: `/a/v1/ontology/slices/${sliceKey}`,
    headers: ADMIN,
    payload: { version: 1, spec: { root: { typeKey: rootType, selector: {} }, paths: [[{ linkKey, direction: "out" }]], maxNodes: 1000 } },
  });
  if (put.statusCode >= 300) throw new Error(`slice put failed: ${put.statusCode} ${put.body}`);
  const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology/slices/${sliceKey}/resolve`, headers: ADMIN, payload: { args: {} } });
  if (res.statusCode >= 300) throw new Error(`slice resolve failed: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body) as { nodes: { id: string; typeKey: string }[]; edges: { linkKey: string; from: string; to: string }[] };
}

const createLink = (t: Awaited<ReturnType<typeof makeApp>>, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN, payload });

/** 金丝雀：出厂边必须检索得到。不中 ⇒ 报「工具坏了」，不许把下面的 0 读成「没有边」。 */
async function canary(t: Awaited<ReturnType<typeof makeApp>>, key: string): Promise<number> {
  const g = await resolveOneHop(t, `c-${key}`, "ProductSeries", "series_belongs_to_platform");
  expect(g.edges.length).toBeGreaterThan(0);
  return g.edges.length;
}

describe("WO-MATERIALIZE-3EXT · 接缝：三类新映射 × 多跳检索", () => {
  it("桶② anchorProperty：外键对到**非主键列**——修前 0 条，修后连出边，锚点改回主键即消失", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await canary(t, "b2");

    // Customer(主键 custId) ← ARInvoice.custName。值对得上，对上的是**名字列**。
    const base = { key: "m3_cust_invoice", fromTypeKey: "Customer", toTypeKey: "ARInvoice", cardinality: "N:N", viaProperty: "custName", viaSide: "to" };

    // 修前：老口径去对 anchor 的**主键**（custId）⇒ 一条都连不上，且 unresolved 如实回报
    const before = await createLink(t, base);
    expect(before.statusCode).toBe(201);
    const mBefore = JSON.parse(before.body).materialized as { created: number; unresolved: number; carrierObjects: number };
    expect(mBefore.created).toBe(0);
    expect(mBefore.unresolved).toBeGreaterThan(0); // ← 「查无目标」必须说出来，不许静默吞成 0
    expect((await resolveOneHop(t, "m3-b2-before", "Customer", "m3_cust_invoice")).edges).toEqual([]);

    // 修后：声明「对到 Customer.custName」⇒ 同一个检索必须返回边
    const after = await createLink(t, { ...base, anchorProperty: "custName" });
    expect(after.statusCode).toBe(201);
    const mAfter = JSON.parse(after.body).materialized as { created: number };
    expect(mAfter.created).toBe(mBefore.unresolved); // 之前全部落空的那批，现在全部命中
    const g = await resolveOneHop(t, "m3-b2-after", "Customer", "m3_cust_invoice");
    expect(g.edges.length).toBe(mAfter.created); // 回执说几条，检索就得看见几条
    expect(g.edges.length).toBeGreaterThan(0);
    // 方向断言：from 必须是 Customer、to 必须是 ARInvoice（写反了照样"绿"，但拓扑是错的）
    const typeById = new Map(g.nodes.map((n) => [n.id, n.typeKey]));
    for (const e of g.edges) {
      expect(typeById.get(e.from)).toBe("Customer");
      expect(typeById.get(e.to)).toBe("ARInvoice");
    }

    // 反向对照（铁律 1.5）：锚点列改回主键 custId ⇒ 值对不上，边必须消失。
    // 仍在 = 这些边不是从真数据匹配出来的。
    const rev = await createLink(t, { ...base, anchorProperty: "custId" });
    expect((JSON.parse(rev.body).materialized as { created: number }).created).toBe(0);
    expect((await resolveOneHop(t, "m3-b2-rev", "Customer", "m3_cust_invoice")).edges).toEqual([]);
  });

  it("桶⑤ viaMultiValue：一个型号可产 N 个基地 ⇒ 必须是 N 条边，不是 1 条", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await canary(t, "b5");

    const base = { key: "m3_model_bases", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N", viaProperty: "bases", viaSide: "from" };
    // 修前：数组被 String() 拼成 "a,b,c" ⇒ 匹配不上任何 baseId
    const before = await createLink(t, base);
    const mBefore = JSON.parse(before.body).materialized as { created: number; carrierObjects: number };
    expect(mBefore.created).toBe(0);
    expect(mBefore.carrierObjects).toBeGreaterThan(0); // 载体不是 0 ⇒ 0 条不是「没数据」造成的
    expect((await resolveOneHop(t, "m3-b5-before", "Model", "m3_model_bases")).edges).toEqual([]);

    // 修后：显式声明多值
    const after = await createLink(t, { ...base, viaMultiValue: true });
    const mAfter = JSON.parse(after.body).materialized as { created: number };
    const g = await resolveOneHop(t, "m3-b5-after", "Model", "m3_model_bases");
    expect(g.edges.length).toBe(mAfter.created);
    expect(g.edges.length).toBeGreaterThan(0);

    // ⚠ 头号断言：**逐元素展开**，不是每个型号一条。
    // 只断言「边数 > 0」的话，「每个型号连 1 条」也会绿 —— 那正是本桶的病。
    const models = (await t.repos.objects.listByType("demo", "Model")).filter((m) => !m.mergedInto);
    const multi = models.filter((m) => Array.isArray(m.props.bases) && (m.props.bases as unknown[]).length > 1);
    expect(multi.length).toBeGreaterThan(0); // 金丝雀：种子里真有多基地型号
    for (const m of multi) {
      const outs = g.edges.filter((e) => e.from === m.id);
      expect(outs.length).toBe((m.props.bases as unknown[]).length);
    }
    // 总边数 = 所有型号 bases 长度之和（不是型号数）
    const expectedTotal = models.reduce((a, m) => a + (Array.isArray(m.props.bases) ? (m.props.bases as unknown[]).length : 0), 0);
    expect(g.edges.length).toBe(expectedTotal);
    expect(expectedTotal).toBeGreaterThan(models.length); // 展开确实发生了

    // 反向对照：关掉多值 ⇒ 回到 0
    const rev = await createLink(t, { ...base, viaMultiValue: false });
    expect((JSON.parse(rev.body).materialized as { created: number }).created).toBe(0);
    expect((await resolveOneHop(t, "m3-b5-rev", "Model", "m3_model_bases")).edges).toEqual([]);
  });

  it("桶① viaBridge：桥实体投影成边，且**桥的 props 随边带过去**（不带 = 认证状态整个丢失）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await canary(t, "b1");

    // 修前：两侧都没有对侧 FK（Model 无 lineId、Line 无 modelId）⇒ 连声明都建不出来
    const direct = await createLink(t, { key: "m3_cert_direct", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaProperty: "lineId" });
    expect(direct.statusCode).toBe(400);
    expect(direct.body).toContain("lineId");

    // 修后：经桥 Certification(modelId, lineId) 实现
    const key = "m3_model_certified_on";
    const res = await createLink(t, { key, fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "Certification", fromProperty: "modelId", toProperty: "lineId" } });
    expect(res.statusCode).toBe(201);
    const m = JSON.parse(res.body).materialized as { created: number; carrierObjects: number };
    expect(m.created).toBeGreaterThan(0);
    const bridges = (await t.repos.objects.listByType("demo", "Certification")).filter((o) => !o.mergedInto);
    expect(m.carrierObjects).toBe(bridges.length); // 扫过的行数 = 桥记录数
    expect(m.created).toBe(bridges.length); // 种子里每条认证两端都解析得到

    const g = await resolveOneHop(t, "m3-b1-after", "Model", key);
    expect(g.edges.length).toBe(m.created);
    const typeById = new Map(g.nodes.map((n) => [n.id, n.typeKey]));
    for (const e of g.edges) {
      expect(typeById.get(e.from)).toBe("Model");
      expect(typeById.get(e.to)).toBe("Line");
    }

    /*
     * 「一份记录两个投影」：桥的 props **原样**上边（外加 bridgeObjectId 回指）。
     *
     * ⚠ 这一段刻意**不走切片路由**去读 —— 实测 `executeSlice` 的边投影是
     * `{ linkKey, from, to }`，**边的 props 在检索侧被丢掉**（出厂手写的
     * `model_certified_on.props.status` 今天同样读不到）。真正的生产消费方是
     * `solvers/service.ts` 的产能求解器：它直接 `repos.links.list(... "model_certified_on")`
     * 然后读 `link.props?.status`，**取不到时回落成常量 "量产"** ——
     * 即「边上没有 props」不会报错，只会让认证状态静默变成一个默认值。
     * 所以这里按那个消费方的读法断言，咬的是它真读的那条路。
     */
    const links = await t.repos.links.list("demo", (l) => l.type === key);
    expect(links.length).toBe(m.created);
    const byBridge = new Map(bridges.map((b) => [b.id, b]));
    for (const l of links) {
      const src = byBridge.get(String(l.props?.["bridgeObjectId"]));
      expect(src).toBeDefined(); // 每条边都回指得到它那一行桥记录
      // 原样投影：桥上每个字段在边上都取得到同一个值（不是白名单挑几个）
      for (const [k, v] of Object.entries(src!.props)) expect(l.props?.[k]).toEqual(v);
    }
    // 认证状态确实带过来了（这正是求解器回落成 "量产" 的那一格）
    const statuses = new Set(links.map((l) => String(l.props?.["status"])));
    expect(statuses.size).toBeGreaterThan(0);
    expect(statuses.has("undefined")).toBe(false);

    // 反向对照：桥的来源列改成 certId（真存在，但值对不上 Model 主键）⇒ 边必须消失
    const rev = await createLink(t, { key, fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "Certification", fromProperty: "certId", toProperty: "lineId" } });
    expect((JSON.parse(rev.body).materialized as { created: number }).created).toBe(0);
    expect((await resolveOneHop(t, "m3-b1-rev", "Model", key)).edges).toEqual([]);
  });

  it("变异反证：三类的打错字 / 缺前提 / 机制冲突一律 400，且不留半条记录", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cases: [string, Record<string, unknown>][] = [
      ["m3_bad_anchor_typo", { key: "m3_bad_anchor_typo", fromTypeKey: "Customer", toTypeKey: "ARInvoice", cardinality: "N:N", viaProperty: "custName", viaSide: "to", anchorProperty: "custNameTYPO" }],
      // 修饰词单独出现 = 用户以为声明了实现方式，其实什么都没声明（会静默得到 0 实例的边）
      ["m3_bad_anchor_only", { key: "m3_bad_anchor_only", fromTypeKey: "Customer", toTypeKey: "ARInvoice", cardinality: "N:N", anchorProperty: "custName" }],
      ["m3_bad_multi_only", { key: "m3_bad_multi_only", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N", viaMultiValue: true }],
      ["m3_bad_bridge_type", { key: "m3_bad_bridge_type", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "NoSuchBridge_ZZZ", fromProperty: "a", toProperty: "b" } }],
      ["m3_bad_bridge_prop", { key: "m3_bad_bridge_prop", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "Certification", fromProperty: "modelIdTYPO", toProperty: "lineId" } }],
      ["m3_bad_bridge_anchor", { key: "m3_bad_bridge_anchor", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "Certification", fromProperty: "modelId", toProperty: "lineId", toAnchorProperty: "lineIdTYPO" } }],
      // 两套机制同时声明 ⇒ 物化时听谁的？不许猜
      ["m3_bad_both", { key: "m3_bad_both", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaProperty: "modelId", viaBridge: { typeKey: "Certification", fromProperty: "modelId", toProperty: "lineId" } }],
    ];
    for (const [, payload] of cases) {
      const r = await createLink(t, payload);
      expect(r.statusCode).toBe(400);
    }
    // 打错字的边一条都不许落库（400 之后不能留半条记录）
    const list = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN });
    const keys = (JSON.parse(list.body).linkTypes as { key: string }[]).map((l) => l.key);
    for (const [k] of cases) expect(keys).not.toContain(k);
  });

  it("R6 确定性 + 出厂边零回归：重建不翻倍，且绝不误删手写的出厂实例边", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const factoryBefore = (await resolveOneHop(t, "m3-fac-1", "Model", "model_certified_on")).edges.length;
    expect(factoryBefore).toBeGreaterThan(0); // 金丝雀

    const payload = { key: "m3_idem", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N", viaBridge: { typeKey: "Certification", fromProperty: "modelId", toProperty: "lineId" } };
    const first = JSON.parse((await createLink(t, payload)).body).materialized as { created: number };
    const g1 = await resolveOneHop(t, "m3-idem-1", "Model", "m3_idem");
    const second = JSON.parse((await createLink(t, payload)).body).materialized as { created: number };
    const g2 = await resolveOneHop(t, "m3-idem-2", "Model", "m3_idem");
    expect(second.created).toBe(first.created);
    // 逐字节：同输入两次跑出来的边集合必须完全相同（不只是条数相同）
    const sig = (g: { edges: { from: string; to: string }[] }) => g.edges.map((e) => `${e.from}->${e.to}`).sort().join("\n");
    expect(sig(g2)).toBe(sig(g1));

    // 多值形态同样要幂等（id 带元素序号，重跑覆盖不翻倍）
    const mv = { key: "m3_idem_mv", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N", viaProperty: "bases", viaSide: "from", viaMultiValue: true };
    const mv1 = JSON.parse((await createLink(t, mv)).body).materialized as { created: number };
    const mvG1 = await resolveOneHop(t, "m3-mv-1", "Model", "m3_idem_mv");
    const mv2 = JSON.parse((await createLink(t, mv)).body).materialized as { created: number };
    const mvG2 = await resolveOneHop(t, "m3-mv-2", "Model", "m3_idem_mv");
    expect(mv2.created).toBe(mv1.created);
    expect(sig(mvG2)).toBe(sig(mvG1));

    // 重算只删自己造的那批（origin=LINK_DERIVED）；出厂边是 SYNTHETIC，一条都不许少。
    expect((await resolveOneHop(t, "m3-fac-2", "Model", "model_certified_on")).edges.length).toBe(factoryBefore);
  });
});
