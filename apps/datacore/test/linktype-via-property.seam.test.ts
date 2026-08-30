import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-LINKTYPE-IMPL · 接缝门：**建结构边（声明侧）× 多跳检索（实例侧）**。
 *
 * ── 这道门守的是哪条接缝 ──────────────────────────────────────────────────
 * `POST /a/v1/ontology/link-types` 写的是 `repos.ontologyLinks`（`LinkTypeDef`，一句声明）；
 * 多跳检索 `executeSlice` 遍历的是 `repos.links`（`LinkInstance`，带 `fromId`/`toId` 的实例行）。
 * 两张表原先**没有桥** —— 全仓 `repos.links.put` 的非测试调用方只有「出厂种子硬编码 /
 * 命名空间迁移 / 实体归并改 id / 平台元本体」四处，没有任何一处从 LinkTypeDef 推出 LinkInstance。
 * ⇒ 用户在「建结构边」表单里建出来的边**永远 0 实例**，本体建完却检索不到。
 *
 * 两半各自都是绿的（建边 201、检索能返回出厂边），**只有驱动接缝才会红** ——
 * 这正是 SEAM-GATE 要的那种断言：不测「函数能跑」，测「建完的边能不能被检索到」。
 *
 * 每条用例都自带**金丝雀**：先证明检索方法本身是好的（出厂边能返回边），
 * 再报「新建边返回 0」。否则「我的检索坏了」与「这条边没实例」在屏上一模一样。
 */

/** 注册一条一跳切片并解析，返回 {nodes, edges}。检索方法单源，各用例共用。 */
async function resolveOneHop(
  t: Awaited<ReturnType<typeof makeApp>>,
  sliceKey: string,
  rootType: string,
  linkKey: string,
  direction: "out" | "in" = "out",
): Promise<{ nodes: { id: string; typeKey: string }[]; edges: { linkKey: string; from: string; to: string }[] }> {
  const put = await t.app.inject({
    method: "PUT",
    url: `/a/v1/ontology/slices/${sliceKey}`,
    headers: ADMIN,
    payload: { version: 1, spec: { root: { typeKey: rootType, selector: {} }, paths: [[{ linkKey, direction }]], maxNodes: 500 } },
  });
  if (put.statusCode >= 300) throw new Error(`slice put failed: ${put.statusCode} ${put.body}`);
  const res = await t.app.inject({
    method: "POST",
    url: `/a/v1/ontology/slices/${sliceKey}/resolve`,
    headers: ADMIN,
    payload: { args: {} },
  });
  if (res.statusCode >= 300) throw new Error(`slice resolve failed: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body) as { nodes: { id: string; typeKey: string }[]; edges: { linkKey: string; from: string; to: string }[] };
}

const createLink = (t: Awaited<ReturnType<typeof makeApp>>, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN, payload });

describe("WO-LINKTYPE-IMPL · 接缝：建结构边 × 多跳检索", () => {
  it("金丝雀 + 修前/修后对照：不给 viaProperty 检索 0 条，给了才有边", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ── 金丝雀：出厂边必须能被检索到（证明检索方法是好的）──────────────────
    // 不中 ⇒ 是「我的工具坏了」，下面两个读数一律不许当结论。
    const canary = await resolveOneHop(t, "seam-canary", "ProductSeries", "series_belongs_to_platform");
    expect(canary.edges.length).toBeGreaterThan(0);

    // ── 修前：只声明、不说由哪个属性实现 ⇒ 建成了，但一条实例边都长不出来 ────
    const noVia = await createLink(t, { key: "seam_no_via", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform", cardinality: "N:1" });
    expect(noVia.statusCode).toBe(201);
    expect(JSON.parse(noVia.body).materialized).toEqual({ created: 0, unresolved: 0, carrierObjects: 0 });
    const before = await resolveOneHop(t, "seam-before", "ProductSeries", "seam_no_via");
    expect(before.edges).toEqual([]); // ← 这就是用户报的病：本体建完了，检索拿回 0 条边

    // ── 修后：补上「由哪个属性实现」⇒ 同一个检索必须返回边 ──────────────────
    const withVia = await createLink(t, { key: "seam_with_via", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform", cardinality: "N:1", viaProperty: "platformId" });
    expect(withVia.statusCode).toBe(201);
    const m = JSON.parse(withVia.body).materialized as { created: number; unresolved: number; carrierObjects: number };
    expect(m.created).toBeGreaterThan(0);
    const after = await resolveOneHop(t, "seam-after", "ProductSeries", "seam_with_via");
    expect(after.edges.length).toBe(m.created); // 回执说连了几条，检索就得看见几条
    expect(after.edges.length).toBeGreaterThan(0);
    // 同一份底层数据、同向、同一个 FK：出厂边与新建边的边数必须一致 —— 差的只是那一个字段。
    expect(after.edges.length).toBe(canary.edges.length);
  });

  it("变异反证：实现属性打错字 / 两端类型不存在 —— 必须报错，不许静默通过", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 打错属性名（本仓有过「自由文本状态变量打错字 = 静默造死变量」的坑，这里不许复制）
    const typo = await createLink(t, { key: "seam_typo", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform", cardinality: "N:1", viaProperty: "platformIdTYPO" });
    expect(typo.statusCode).toBe(400);
    expect(typo.body).toContain("platformIdTYPO");
    expect(typo.body).toContain("platformId"); // 报错要把可选属性列出来，不能只说「不对」

    // 去向类型根本不存在（修前实测：静默 201，造出一条永远不可能有实例的死边）
    const bogus = await createLink(t, { key: "seam_bogus", fromTypeKey: "ProductSeries", toTypeKey: "NoSuchType_ZZZ", cardinality: "N:1" });
    expect(bogus.statusCode).toBe(400);

    // 打错的那条边不许落库（400 之后不能留下半条记录）
    const list = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN });
    const keys = (JSON.parse(list.body).linkTypes as { key: string }[]).map((l) => l.key);
    expect(keys).not.toContain("seam_typo");
    expect(keys).not.toContain("seam_bogus");
  });

  it("一对多边：外键长在**去向**类型上（viaSide=to），边的方向必须是 from→to 不是反的", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // Base → Line，外键是 `Line.baseId`（实测 116 条结构边里 23 条是这个形态；
    // 只支持 from 侧的话，用户在表单里选中这类边会看到一个空下拉、无路可走）。
    const rev = await createLink(t, { key: "seam_reverse", fromTypeKey: "Base", toTypeKey: "Line", cardinality: "1:N", viaProperty: "baseId", viaSide: "to" });
    expect(rev.statusCode).toBe(201);
    const m = JSON.parse(rev.body).materialized as { created: number };
    expect(m.created).toBeGreaterThan(0);

    const g = await resolveOneHop(t, "seam-reverse", "Base", "seam_reverse");
    expect(g.edges.length).toBeGreaterThan(0);
    // ⚠ 方向断言：from 必须是 Base、to 必须是 Line。写反了照样有边、照样"绿"，
    //   但图的拓扑是错的 —— 这正是「跑得起来 ≠ 算得对」，必须逐条咬住类型。
    const typeById = new Map(g.nodes.map((n) => [n.id, n.typeKey]));
    for (const e of g.edges) {
      expect(typeById.get(e.from)).toBe("Base");
      expect(typeById.get(e.to)).toBe("Line");
    }
  });

  it("幂等（R6）+ 出厂边零回归：重建不翻倍，且绝不误删手写的出厂实例边", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const factoryBefore = await resolveOneHop(t, "seam-fac-1", "ProductSeries", "series_belongs_to_platform");
    expect(factoryBefore.edges.length).toBeGreaterThan(0); // 金丝雀

    const payload = { key: "seam_idem", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform", cardinality: "N:1", viaProperty: "platformId" };
    const first = JSON.parse((await createLink(t, payload)).body).materialized as { created: number };
    const g1 = await resolveOneHop(t, "seam-idem-1", "ProductSeries", "seam_idem");
    // 同一条边重建：link 实例 id 由 key + 来源对象 id 确定性拼出 ⇒ put 覆盖，不新增。
    const second = JSON.parse((await createLink(t, payload)).body).materialized as { created: number };
    const g2 = await resolveOneHop(t, "seam-idem-2", "ProductSeries", "seam_idem");
    expect(second.created).toBe(first.created);
    expect(g2.edges.length).toBe(g1.edges.length);

    // 重算只删自己造的那批（origin=LINK_DERIVED）；出厂边是 SYNTHETIC，一条都不许少。
    const factoryAfter = await resolveOneHop(t, "seam-fac-2", "ProductSeries", "series_belongs_to_platform");
    expect(factoryAfter.edges.length).toBe(factoryBefore.edges.length);
  });
});
