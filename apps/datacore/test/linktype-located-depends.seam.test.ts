import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-LAST3-RELATIONS · 接缝门：**`located_in` / `depends_on` 两条关系** 的
 * 「声明侧 → 物化 → 检索侧」整条缝。
 *
 * ── 这道门守的是哪条接缝 ──────────────────────────────────────────────────
 * 产销推演第一优先级 20 条关系里，这两条此前判为 ❌「表达不了」，各自的病因**不同**：
 *
 * · `located_in`：五种声明**本来就够用**（`viaProperty` 等值匹配即可），
 *   缺的是**锚点类型** —— 全仓 99 个类型里没有任何 `Region`/`Geo`，
 *   地理归属只以字符串属性存在（`Base.province` / `Warehouse.province` /
 *   `CustomerLocation.province`，实测**只有这三个**类型带 province）。
 *   ⇒ 「华东产能」这类按地域的聚合不能沿图走，只能按字段过滤。
 *
 * · `depends_on`：工序先后**只靠序号**（`Operation.operationSeq`），没有前驱外键。
 *   五种声明一种都算不出端点（`viaProperty` 只做等值；拿 `operationSeq` 对
 *   `operationSeq` 会把 15 条工艺路线的同序号工序连成**叉积**且不报错）。
 *   ⇒ 补一列派生 FK（`predecessorOperationId`）即可，**不需要新机制**。
 *
 * 两半各自都能绿（对象建得出来、检索能返回出厂边），**只有驱动接缝才会红**。
 *
 * 每条用例自带**金丝雀**：先证明检索方法本身是好的，再报条数。
 * 否则「我的检索坏了」与「这条边没实例」在屏上一模一样。
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
    payload: { version: 1, spec: { root: { typeKey: rootType, selector: {} }, paths: [[{ linkKey, direction }]], maxNodes: 900 } },
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

/** 数某条 linkKey 的实例边条数（走仓储，与切片检索互为独立口径）。 */
const countLinks = async (t: Awaited<ReturnType<typeof makeApp>>, key: string): Promise<number> =>
  (await t.repos.links.list("demo", (l) => l.type === key)).length;

describe("WO-LAST3-RELATIONS · 接缝：located_in / depends_on 声明 × 物化 × 检索", () => {
  it("located_in：三类设施 → 行政区，出厂边可检索（13 / 34 / 30），且端点方向正确", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ── 金丝雀：出厂边必须能被检索到（证明检索方法是好的）──────────────────
    // 不中 ⇒ 「我的工具坏了」，下面的条数一律不许当结论。
    const canary = await resolveOneHop(t, "loc-canary", "ProductSeries", "series_belongs_to_platform");
    expect(canary.edges.length, "金丝雀：出厂边检索不到 ⇒ 是检索坏了，不是本单的边没落").toBeGreaterThan(0);

    // ── 锚点类型必须真的存在（此前 99 个类型里一个地理类型都没有）──────────
    const regions = await t.repos.objects.listByType("demo", "Region");
    expect(regions.length, "行政区行由三个载体的 province 取值并集派生").toBe(13);
    // 取值确定性：按省名排序，且每行都能查到大区（查不到 buildRegions 会 throw）。
    expect(regions.map((r) => String(r.props.regionId))).toEqual(
      ["上海", "北京", "四川", "安徽", "山东", "广东", "江苏", "河北", "河南", "浙江", "湖北", "福建", "重庆"],
    );

    // ── 三条边的实例条数 = 各自载体的对象数（每个设施恰好落在一个省）────────
    expect(await countLinks(t, "base_located_in")).toBe(13);
    expect(await countLinks(t, "warehouse_located_in")).toBe(34);
    expect(await countLinks(t, "custloc_located_in")).toBe(30);

    // ── 检索侧真能取到（这一步才是接缝；边写进去了但读不到是本仓踩过的坑）──
    const g = await resolveOneHop(t, "loc-base", "Base", "base_located_in");
    expect(g.edges.length, "声明了映射但检索侧取不到 ⇒ 接缝断").toBe(13);
    // 方向：源必须是 Base、目标必须是 Region（接反了同样有 13 条，只有查端点类型才抓得住）。
    const byId = new Map(g.nodes.map((n) => [n.id, n.typeKey]));
    for (const e of g.edges) {
      expect(byId.get(e.from)).toBe("Base");
      expect(byId.get(e.to)).toBe("Region");
    }
    // 具体一对：常州基地在江苏（拿真值咬，不只咬条数）。
    expect(g.edges.some((e) => e.from === "obj_base_changzhou" && e.to === "obj_region_江苏")).toBe(true);

    // 反向可走：Region 反着走回设施（故意不落逆边，靠 direction:"in"）。
    const back = await resolveOneHop(t, "loc-back", "Region", "base_located_in", "in");
    expect(back.edges.length).toBe(13);
  });

  it("depends_on：工序 → 同路线前驱，135 条 = 150 工序 − 15 条路线（首工序无前驱）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const canary = await resolveOneHop(t, "dep-canary", "Operation", "operation_belongs_to_routing");
    expect(canary.edges.length, "金丝雀：工序→工艺路线出厂边").toBe(150);

    // 每条工艺路线的**首工序**没有前驱 ⇒ 边数比工序数正好少 15。
    // 这个差值就是判据：若某条边跨了工艺路线（叉积），条数会远大于 135。
    expect(await countLinks(t, "operation_depends_on")).toBe(135);

    const g = await resolveOneHop(t, "dep-op", "Operation", "operation_depends_on");
    expect(g.edges.length).toBe(135);

    // ⚠ 头号误接形态：跨工艺路线。同一条边的两端必须属于**同一条** routing。
    const ops = await t.repos.objects.listByType("demo", "Operation");
    const routingOf = new Map(ops.map((o) => [o.id, String(o.props.routingId)]));
    for (const e of g.edges) {
      expect(routingOf.get(e.from), `跨工艺路线接线：${e.from} -> ${e.to}`).toBe(routingOf.get(e.to));
    }
    // 且必须是「后一道 → 前一道」，序号差恰好 1（方向接反 seq 差会变成 −1）。
    const seqOf = new Map(ops.map((o) => [o.id, Number(o.props.operationSeq)]));
    for (const e of g.edges) expect((seqOf.get(e.from) ?? 0) - (seqOf.get(e.to) ?? 0)).toBe(1);
  });

  it("depends_on 反向对照：前驱 FK 指向不存在的工序，该边必须消失（135→134，且只塌那一条）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 与 `located_in` 那条同一把尺子，但**必须对本条边单独做一遍** ——
    // 「另一条边的数据是真的」证明不了「这条边的数据是真的」。
    const declaredKey = "op_dep_declared";
    const mk = await createLink(t, {
      key: declaredKey,
      fromTypeKey: "Operation",
      toTypeKey: "Operation",
      cardinality: "N:1",
      viaProperty: "predecessorOperationId",
    });
    expect(mk.statusCode, mk.body).toBeLessThan(300);
    // 声明即物化，条数与种子手写那条一致（两条独立路径得同一个数 = 互为对照口径）。
    expect(await countLinks(t, declaredKey), "声明侧与种子侧必须得到同一个数").toBe(135);

    // 把某一道工序的前驱改成**不存在的 operationId** ⇒ 它那条边必须消失。
    const ops = await t.repos.objects.listByType("demo", "Operation");
    const victim = ops.find((o) => String(o.props.predecessorOperationId ?? "") !== "");
    expect(victim, "金丝雀：必须存在带前驱的工序（首工序之外的 135 道）").toBeTruthy();
    await t.repos.objects.put({ ...victim!, props: { ...victim!.props, predecessorOperationId: "OP-DOES-NOT-EXIST" } });

    const again = await createLink(t, {
      key: declaredKey,
      fromTypeKey: "Operation",
      toTypeKey: "Operation",
      cardinality: "N:1",
      viaProperty: "predecessorOperationId",
    });
    expect(again.statusCode, again.body).toBeLessThan(300);
    expect(await countLinks(t, declaredKey), "前驱指向不存在的工序 ⇒ 该边必须消失").toBe(134);

    // 消失的正是那一条，其余 134 条一条不少（证明没有连坐、也没有整表重算成别的东西）。
    const left = await t.repos.links.list("demo", (l) => l.type === declaredKey);
    expect(left.some((l) => l.fromId === victim!.id), "被改坏的那条工序边必须不在了").toBe(false);
    expect(left.length).toBe(134);
  });

  it("声明侧够用 + 反向对照：viaProperty 一声明就连得出边，FK 指向不存在的目标即消失", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ── 这一条证明的是「现有五种声明其实够用」：**不动种子**，在同一租户里
    //    另建一条同形状的边，只靠 `viaProperty` 让它自己物化。
    //    （出厂那三条之所以手写物化，是因为 `upsertLinkType` 在种链路类型时就跑一次
    //     物化，而那一刻对象还一个都没落库 —— 是**时序**问题，不是表达力问题。
    //     这里对象已在库，故声明即连得出来，正好把两者分开证明。）
    const mk = await createLink(t, {
      key: "wh_region_declared",
      fromTypeKey: "Warehouse",
      toTypeKey: "Region",
      cardinality: "N:1",
      viaProperty: "province",
    });
    expect(mk.statusCode, mk.body).toBeLessThan(300);
    expect(await countLinks(t, "wh_region_declared"), "声明即物化：34 个仓库各落一条").toBe(34);

    // 检索侧同样取得到（声明 → 物化 → 检索，整条缝走通）。
    const g = await resolveOneHop(t, "decl-wh", "Warehouse", "wh_region_declared");
    expect(g.edges.length).toBe(34);

    // ── 反向对照（铁律 1.5 判据一）：把源侧那个属性值改成**指向不存在的目标**，
    //    这条边必须**消失**。仍在 ⇒ 拿的不是真数据，是别处漏进来的边。
    const whs = await t.repos.objects.listByType("demo", "Warehouse");
    const victim = whs.find((w) => String(w.props.province) === "江苏");
    expect(victim, "江苏必须有仓库（金丝雀：常州基地在江苏）").toBeTruthy();
    const jiangsuCount = whs.filter((w) => String(w.props.province) === "江苏").length;
    await t.repos.objects.put({ ...victim!, props: { ...victim!.props, province: "不存在省" } });

    // 同 key 重新 upsert ⇒ 重跑一遍物化。
    const again = await createLink(t, {
      key: "wh_region_declared",
      fromTypeKey: "Warehouse",
      toTypeKey: "Region",
      cardinality: "N:1",
      viaProperty: "province",
    });
    expect(again.statusCode, again.body).toBeLessThan(300);
    expect(await countLinks(t, "wh_region_declared"), "FK 指向不存在的目标 ⇒ 该边必须消失").toBe(33);

    // 且消失的正是那一个（不是随便少了一条）。
    const left = await t.repos.links.list("demo", (l) => l.type === "wh_region_declared");
    expect(left.some((l) => l.fromId === victim!.id), "被改坏的那条仓库边必须不在了").toBe(false);
    // 江苏剩下的仓库边**一条不少** —— 证明只塌了被改的那一个，没有连坐。
    expect(left.filter((l) => l.toId === "obj_region_江苏").length).toBe(jiangsuCount - 1);
  });

  it("写入校验不放松：端点类型不存在 / 实现属性不存在，一律 4xx + 标准错误信封", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 端点类型根本不存在 —— 本仓踩过「只校验字符串非空 ⇒ 81/133 条非法边全部 201」。
    const bad1 = await createLink(t, {
      key: "bogus_located_in",
      fromTypeKey: "Base",
      toTypeKey: "NoSuchRegionType",
      cardinality: "N:1",
      viaProperty: "province",
    });
    expect(bad1.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad1.statusCode).toBeLessThan(500);
    const env1 = JSON.parse(bad1.body) as { error?: { code?: string; message?: string; requestId?: string } };
    expect(env1.error?.code, bad1.body).toBeTruthy();
    expect(env1.error?.message).toBeTruthy();
    expect(env1.error?.requestId).toBeTruthy();

    // ② 实现属性拼错 —— 静默放过就会得到一条**永远 0 实例**的边（本单最想灭的形态）。
    const bad2 = await createLink(t, {
      key: "bogus_located_in2",
      fromTypeKey: "Base",
      toTypeKey: "Region",
      cardinality: "N:1",
      viaProperty: "provinceTypo",
    });
    expect(bad2.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad2.statusCode).toBeLessThan(500);
    const env2 = JSON.parse(bad2.body) as { error?: { code?: string; requestId?: string } };
    expect(env2.error?.code, bad2.body).toBeTruthy();
    expect(env2.error?.requestId).toBeTruthy();
  });
});
