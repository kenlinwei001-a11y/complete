import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { batteryLinkTypes, EXC_SOURCE_LINKS } from "../src/synthetic/battery.js";

/**
 * WO-COMPUTED-EDGE · 接缝门：**算端点 / anchor 侧谓词 / 叉积** 三件的
 * 声明（写入侧）× 求值（物化侧）× **多跳检索（读出侧）**。
 *
 * ── 这道门守的是哪条接缝 ──────────────────────────────────────────────────
 * 本仓踩过两次同一个坑，**方向相反、都不会红**：
 *   ① 声明收下了、物化 0 条 —— 建成功的边永远检索不到（`viaProperty` 打错字那次）；
 *   ② 边写进 `repos.links` 了、**检索读不出来** —— 实测 `{nodes:9, edges:0}`。
 * 所以本门每条用例都同时断言**两个数**：物化回执的 `created` 与**走真路由检索**到的边条数。
 * 只断言其中一个 = 只守住一半接缝。
 *
 * ── 反假绿设计（每一节都在防一种「测了个寂寞」）────────────────────────────────
 * §0 金丝雀：一条我确定「五种声明够用」的边（`viaProperty:"baseId", viaSide:"to"`）必须连得出 130 条。
 *    它不中 ⇒ **报「我的尺子坏了」**，本文件任何 0 都不许当结论。
 * §1 算端点（`viaKeyExpr`）：修前（不给任何实现声明）0 条 → 修后 17/6 条，**并给键分布**。
 * §2 **反向对照**：改 carrier 行上被表达式读的那一列 ⇒ 那一行的边必须**跟着换端点**；改回来必须复现。
 *    边不随属性变 = 没真求值，是查表。
 *    ⚠ 变异**必须打在被测那一半的输入上**：这里改的是 `PlanTarget.level`，正是 `viaKeyExpr` 读的那一列。
 * §3 叉积（`viaCross`）：限界证据（候选 N → 边 M）+ **超预算必须一条边都不写**。
 * §4 anchor 侧谓词（`viaWhereTo`）：同一份数据，有/无谓词**必须分叉**（不分叉的对照证明不了任何事）。
 * §5 `EXC_SOURCE_LINKS` 与 `batteryLinkTypes()` 的五条声明逐条对齐（两处漏改任一处当场红）。
 * §6 写入期校验：三类「会静默变成死边」的写法必须 400，且报文点名说人话。
 */

/** 注册一条一跳切片并解析，返回该 linkKey 的边（`from->to`，排序后可逐字节比对）。 */
async function edgesVia(t: TestApp, sliceKey: string, rootType: string, linkKey: string): Promise<string[]> {
  const put = await t.app.inject({
    method: "PUT",
    url: `/a/v1/ontology/slices/${sliceKey}`,
    headers: ADMIN,
    payload: {
      version: 1,
      spec: { root: { typeKey: rootType, selector: {} }, paths: [[{ linkKey, direction: "out" }]], maxNodes: 20000 },
    },
  });
  if (put.statusCode >= 300) throw new Error(`slice put ${put.statusCode} ${put.body}`);
  const res = await t.app.inject({
    method: "POST",
    url: `/a/v1/ontology/slices/${sliceKey}/resolve`,
    headers: ADMIN,
    payload: { args: {} },
  });
  if (res.statusCode >= 300) throw new Error(`slice resolve ${res.statusCode} ${res.body}`);
  const g = JSON.parse(res.body) as { edges?: { linkKey: string; from: string; to: string }[] };
  return (g.edges ?? []).filter((e) => e.linkKey === linkKey).map((e) => `${e.from}->${e.to}`).sort();
}

const createLink = (t: TestApp, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN, payload });

type Materialized = {
  created: number;
  unresolved: number;
  carrierObjects: number;
  keyExprDistinctKeys?: number;
  keyExprNullRows?: number;
  crossFrom?: number;
  crossTo?: number;
};
const materializedOf = (body: string): Materialized => (JSON.parse(body) as { materialized: Materialized }).materialized;

/** 改一个对象的 props 并落库（无 REST 写入口 ⇒ 直接走仓储，与种子同一张表）。回滚用返回的原值。 */
async function patchObject(
  t: TestApp,
  type: string,
  pick: (o: { props: Record<string, unknown> }) => boolean,
  patch: Record<string, unknown>,
): Promise<{ id: string; before: Record<string, unknown> }> {
  const rows = await t.repos.objects.listByType("demo", type);
  const target = rows.find(pick);
  if (!target) throw new Error(`no ${type} row matched`);
  await t.repos.objects.put({ ...target, props: { ...target.props, ...patch } });
  return { id: target.id, before: target.props };
}

describe("WO-COMPUTED-EDGE · 接缝：算端点 / anchor 谓词 / 叉积 —— 声明 × 物化 × 检索", () => {
  it("§0 金丝雀 + §1 算端点：修前 0 条 → 修后连得出，且回执带键分布", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 🐤 金丝雀：五种声明本来就够用的一条边。它不中 ⇒ 尺子坏了，下面任何 0 都不算数。
    const canary = await createLink(t, { key: "zz_ce_canary", fromTypeKey: "Base", toTypeKey: "Line", cardinality: "1:N", viaProperty: "baseId", viaSide: "to" });
    expect(canary.statusCode, "🐤 金丝雀建边失败 ⇒ 我的尺子坏了").toBe(201);
    expect(materializedOf(canary.body).created, "🐤 金丝雀 0 条 ⇒ 我的尺子坏了，不许读作「机制没生效」").toBeGreaterThan(0);
    expect((await edgesVia(t, "zzce-canary", "Base", "zz_ce_canary")).length).toBe(materializedOf(canary.body).created);

    // ── 修前：同一条边不给任何实现声明 ⇒ 声明收下、0 实例（这正是今天用户自建这两条边的处境）──
    const before = await createLink(t, { key: "zz_ce_pto_before", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1" });
    expect(before.statusCode).toBe(201);
    expect(materializedOf(before.body).created).toBe(0);
    expect(await edgesVia(t, "zzce-pto-before", "PlanTarget", "zz_ce_pto_before")).toHaveLength(0);

    // ── 修后 A1-①：条件常量（`plantarget_ownedby` 的声明式等价物）。零新 AST 节点：IF/cmp/string 都是现成的。
    const pto = await createLink(t, {
      key: "zz_ce_pto", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1",
      viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")',
    });
    expect(pto.statusCode, pto.body).toBe(201);
    const mPto = materializedOf(pto.body);
    expect(mPto.created).toBeGreaterThan(0);
    expect(mPto.unresolved).toBe(0);
    // 键分布必须上回执：`distinct===1` 就是「所有行塌到同一个锚点」这件事唯一能被当场看见的形态。
    expect(mPto.keyExprDistinctKeys, "算端点必须回报键分布").toBe(2);
    const ptoEdges = await edgesVia(t, "zzce-pto", "PlanTarget", "zz_ce_pto");
    expect(ptoEdges.length, "边写进去了但检索读不到 = 只守住了一半接缝").toBe(mPto.created);
    // 月度目标归计划部、年/季归运营负责人 —— 与种子 `plantarget_ownedby` 同构。
    expect(ptoEdges.some((e) => e.includes("PT-2026-01") && e.endsWith("obj_principal_prin-plan"))).toBe(true);
    expect(ptoEdges.some((e) => e.includes("PT-2026-Q1") && e.endsWith("obj_principal_prin-coo"))).toBe(true);

    // ── 修后 A1-②：枚举映射（`model_in_segment`）。**这一条同时是「死分支」的回归闸**：
    //    旧派生式按 modelId 串匹配 S192/L148，6 个型号一个都匹不中 ⇒ 全落 pas ⇒ distinct 会是 **1**。
    const mis = await createLink(t, {
      key: "zz_ce_mis", fromTypeKey: "Model", toTypeKey: "Segment", cardinality: "N:N",
      viaKeyExpr: 'IF(this.pos == "储能", "ess", "pas")',
    });
    expect(mis.statusCode, mis.body).toBe(201);
    const mMis = materializedOf(mis.body);
    expect(mMis.created).toBe(6);
    expect(mMis.keyExprDistinctKeys, "细分坍缩成一个 = 死分支回归（旧口径就是这个数：1）").toBe(2);
    const misEdges = await edgesVia(t, "zzce-mis", "Model", "zz_ce_mis");
    expect(misEdges.filter((e) => e.endsWith("obj_segment_ess")).length).toBe(2);
    expect(misEdges.filter((e) => e.endsWith("obj_segment_pas")).length).toBe(4);
  });

  it("§2 反向对照：改被表达式读的那一列 ⇒ 该行的边必须换端点，改回来必须复现", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const decl = {
      key: "zz_ce_rev", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1",
      viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")',
    };
    await createLink(t, decl);
    const base = await edgesVia(t, "zzce-rev0", "PlanTarget", "zz_ce_rev");
    expect(base.length).toBeGreaterThan(0);
    const monthRow = base.find((e) => e.includes("PT-2026-03"));
    expect(monthRow, "取样行不存在 ⇒ 数据形态变了，本用例的判据要重定").toContain("obj_principal_prin-plan");

    // ⚠ 变异打在**被测那一半的输入**上：`level` 正是 viaKeyExpr 读的那一列。
    // （上一批有人的变异反证只喂给"修前"那半、"修后"那半写死 ⇒ 三次输入相同、恒不可能红。）
    const snap = await patchObject(t, "PlanTarget", (o) => String(o.props.tgtId) === "PT-2026-03", { level: "quarter" });
    await createLink(t, decl); // 同 key upsert ⇒ 重新物化
    const mutated = await edgesVia(t, "zzce-rev1", "PlanTarget", "zz_ce_rev");
    expect(mutated.find((e) => e.includes("PT-2026-03")), "改了 level 边却没换端点 ⇒ 拿的不是真数据，是查表").toContain("obj_principal_prin-coo");
    // 其余行一条不动（对照实验的第二个必要条件：变化必须是**局部**的）。
    expect(mutated.filter((e) => !e.includes("PT-2026-03"))).toEqual(base.filter((e) => !e.includes("PT-2026-03")));

    // 改回来必须逐字节复现（不可逆 = 物化里藏了状态）。
    await t.repos.objects.put({ ...(await t.repos.objects.listByType("demo", "PlanTarget")).find((o) => o.id === snap.id)!, props: snap.before });
    await createLink(t, decl);
    expect(await edgesVia(t, "zzce-rev2", "PlanTarget", "zz_ce_rev")).toEqual(base);

    // 属性形态的反向对照（补列那两条走的是这条路）：把源列改成查无锚点的值 ⇒ 该行边消失、计入 unresolved。
    const lbwDecl = { key: "zz_ce_lbw", fromTypeKey: "Workshop", toTypeKey: "Line", cardinality: "1:N", viaProperty: "workshopId", viaSide: "to" as const };
    const lbw0 = await createLink(t, lbwDecl);
    expect(lbw0.statusCode, lbw0.body).toBe(201);
    const n0 = materializedOf(lbw0.body).created;
    expect(n0).toBeGreaterThan(0);
    await patchObject(t, "Line", (o) => String(o.props.lineId) === "LINE-WS-changzhou-assembly", { workshopId: "WS-不存在的车间" });
    const lbw1 = await createLink(t, lbwDecl);
    const m1 = materializedOf(lbw1.body);
    expect(m1.created, "改错源列边却没少 ⇒ 物化没读那一列").toBe(n0 - 1);
    expect(m1.unresolved, "有值查无目标必须如实回报，不许静默吞").toBe(1);
  });

  it("§3 叉积：限界证据（候选 → 边）+ 超预算一条都不许写", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // base_data_health：两侧都不筛 ⇒ 候选 13 × 9 = 117，边 117（谓词筛掉 0）。
    const bdh = await createLink(t, {
      key: "zz_ce_bdh", fromTypeKey: "Base", toTypeKey: "DataSourceHealth", cardinality: "N:N",
      viaCross: { maxEdges: 10000 },
    });
    expect(bdh.statusCode, bdh.body).toBe(201);
    const mBdh = materializedOf(bdh.body);
    expect(mBdh.crossFrom).toBe(13);
    expect(mBdh.crossTo).toBe(9);
    expect(mBdh.created, "边数必须恰等于两侧筛后行数之积 —— 对不上就是限界算错了").toBe(mBdh.crossFrom! * mBdh.crossTo!);
    expect((await edgesVia(t, "zzce-bdh", "Base", "zz_ce_bdh")).length).toBe(117);

    // scenario_to_capex：**fromWhere 是叉积的唯一收窄手段**（没有外键可依）。
    // 候选 3 × 3 = 9 → 谓词筛掉 conservative 那一个情景 → 2 × 3 = 6。
    const all = await createLink(t, {
      key: "zz_ce_s2c_all", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject", cardinality: "N:N",
      viaCross: { maxEdges: 10000 },
    });
    const mAll = materializedOf(all.body);
    expect(mAll.crossFrom).toBe(3);
    expect(mAll.created).toBe(9);
    const s2c = await createLink(t, {
      key: "zz_ce_s2c", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject", cardinality: "N:N",
      viaCross: { fromWhere: "AnnualScenario.key != 'conservative'", maxEdges: 10000 },
    });
    const mS2c = materializedOf(s2c.body);
    expect(mS2c.crossFrom, "谓词没筛掉任何候选 ⇒ 这个对照证明不了谓词做了事").toBe(2);
    expect(mS2c.created).toBe(6);
    expect((await edgesVia(t, "zzce-s2c", "AnnualScenario", "zz_ce_s2c")).length).toBe(6);
    expect(mS2c.created, "有/无谓词必须分叉").toBeLessThan(mAll.created);

    // 超预算：**一条边都不许写**（事后统计意味着 43 万条已经写进去了）。
    const over = await createLink(t, {
      key: "zz_ce_over", fromTypeKey: "Base", toTypeKey: "DataSourceHealth", cardinality: "N:N",
      viaCross: { maxEdges: 116 }, // 比 117 少 1
    });
    expect(over.statusCode).toBe(400);
    const msg = JSON.parse(over.body).error.message as string;
    expect(msg).toContain("117"); // 报文必须给出实算的乘积，而不是一句「太多了」
    expect(msg).toContain("13");
    expect(msg).toContain("9");
    expect(await edgesVia(t, "zzce-over", "Base", "zz_ce_over"), "超预算却写了边 ⇒ 预算是装饰品").toHaveLength(0);
  });

  it("§4 anchor 侧谓词：同一份数据，有/无 viaWhereTo 必须分叉", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { fromTypeKey: "Order", toTypeKey: "PlanTarget", cardinality: "N:N", viaProperty: "dueMonth", anchorProperty: "period" };

    // ⚠ 出厂数据上 period 三档编码恰好不撞值（"2026" / "2026-Q1" / "2026-03"）⇒ 加不加 anchor 谓词同数。
    //   **先把这件事断言出来**，免得后人拿这组数当「viaWhereTo 生效」的证据（它不是）。
    const noPred = await createLink(t, { key: "zz_ce_otp_all", ...base });
    const withPred = await createLink(t, { key: "zz_ce_otp", ...base, viaWhereTo: "PlanTarget.level == 'month'" });
    expect(noPred.statusCode, noPred.body).toBe(201);
    expect(withPred.statusCode, withPred.body).toBe(201);
    const n0 = materializedOf(noPred.body).created;
    const p0 = materializedOf(withPred.body).created;
    expect(n0).toBe(p0); // 谓词在原始数据上是**惰性**的：它防的是尚未发生的编码撞车
    expect(p0).toBeGreaterThan(0);

    // ── 注入危害：让**季度**目标占住 "2026-06" 这个编码（月度那一行改名让开）。
    //   这模拟的是「换个客户、period 编码一变」那种真实情形 —— 今天不撞值纯属数据形态的巧合。
    //   ⚠ 只改季度那一行是**不够**的：两行同值时 `buildAnchorIndex` 按 id 排序取首，
    //     而 "PT-2026-06" < "PT-2026-Q1"，月度那行仍然赢 ⇒ 什么都不会变，那样的对照是空的。
    //     （这一句是实测踩出来的：第一版就是只改一行，两侧同为 458，证明不了任何事。）
    await patchObject(t, "PlanTarget", (o) => String(o.props.tgtId) === "PT-2026-06", { period: "2026-06-RETIRED" });
    await patchObject(t, "PlanTarget", (o) => String(o.props.tgtId) === "PT-2026-Q1", { period: "2026-06" });
    const noPred2 = await createLink(t, { key: "zz_ce_otp_all", ...base });
    const withPred2 = await createLink(t, { key: "zz_ce_otp", ...base, viaWhereTo: "PlanTarget.level == 'month'" });
    const n1 = materializedOf(noPred2.body).created;
    const p1 = materializedOf(withPred2.body).created;
    // 这就是 anchor 谓词存在的全部理由：同一份数据，无谓词把六月的单静默连到了**季度**目标上
    //（下钻结果不会少、只会连错），有谓词的那一侧诚实地少掉这批边。
    expect(n1, "危害没注入成功 ⇒ 这个对照证明不了任何事").toBeGreaterThan(p1);
    const allEdges = await edgesVia(t, "zzce-otp-all", "Order", "zz_ce_otp_all");
    expect(allEdges.some((e) => e.endsWith("obj_plantarget_PT-2026-Q1")), "脏边没出现 ⇒ 危害是假想的").toBe(true);
    const withEdges = await edgesVia(t, "zzce-otp", "Order", "zz_ce_otp");
    expect(withEdges.length).toBe(p1);
    expect(withEdges.some((e) => e.endsWith("obj_plantarget_PT-2026-Q1")), "季度目标被连上了 ⇒ anchor 谓词没生效").toBe(false);
  });

  it("§5 多态目标拆边：EXC_SOURCE_LINKS 与 batteryLinkTypes() 五条声明逐条对齐 + 检索真能取到", async () => {
    // 两处（映射表 × 类型声明）必须一一对应。声明侧刻意写成字面量（B 侧镜像门的抽取器是文本正则，
    // 看不见 `...map()` 展开），所以**需要这条断言当那两处的粘合剂** —— 漏改任一处当场红。
    const declared = new Map(batteryLinkTypes().filter((l) => l.key.startsWith("exc_sourced_from")).map((l) => [l.key, l.toTypeKey]));
    expect(declared.size, "溯源边声明条数与映射表对不上").toBe(EXC_SOURCE_LINKS.length);
    for (const s of EXC_SOURCE_LINKS) {
      expect(declared.get(s.linkKey), `溯源边 ${s.linkKey} 的 toTypeKey 与映射表的 refType 不一致`).toBe(s.refType);
    }

    const t = await makeApp();
    await seedBattery(t);
    // 修前：一条多态边把 372 条实例全塞进声明为 EquipmentDowntime 的那条 key，检索只看得见 166 条。
    // 修后：五条各自可达，合计 = 全部 ExceptionEvent 行。
    let total = 0;
    for (const s of EXC_SOURCE_LINKS) {
      const edges = await edgesVia(t, `zzce-exc-${s.linkKey}`, "ExceptionEvent", s.linkKey);
      expect(edges.length, `溯源边 ${s.linkKey}（→${s.refType}）零实例 ⇒ 拆边把这一源拆丢了`).toBeGreaterThan(0);
      total += edges.length;
    }
    const excRows = await t.repos.objects.listByType("demo", "ExceptionEvent");
    const withKnownRef = excRows.filter((o) => EXC_SOURCE_LINKS.some((s) => s.refType === String(o.props.refType)));
    expect(total, "拆后可检索边数 ≠ 有已知 refType 的异常事件数 ⇒ 还有源在静默丢边").toBe(withKnownRef.length);
    // 修前那条多态边只能看见停机那一源；这个不等式就是本次拆边买到的东西。
    const dtOnly = await edgesVia(t, "zzce-exc-dt", "ExceptionEvent", "exc_sourced_from");
    expect(total).toBeGreaterThan(dtOnly.length);
  });

  it("§6 写入期校验：三类会静默变成死边的写法必须 400 且说人话", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const P = { fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1" };

    // ① 表达式引用了不存在的属性 ⇒ 求值恒 null ⇒ 全落空的死边。
    const typo = await createLink(t, { key: "zz_ce_bad1", ...P, viaKeyExpr: 'IF(this.levl == "month", "a", "b")' });
    expect(typo.statusCode).toBe(400);
    expect(JSON.parse(typo.body).error.message).toContain("levl");

    // ② 常量公式（不含 this.x）⇒ 每行同一个键 = 把全集连到一个锚点上，那是叉积的退化形态。
    const konst = await createLink(t, { key: "zz_ce_bad2", ...P, viaKeyExpr: '"prin-plan"' });
    expect(konst.statusCode).toBe(400);
    expect(JSON.parse(konst.body).error.message).toContain("viaCross");

    // ③ 两种实现形态同时声明 ⇒ 物化时该听谁的？不许猜。
    const both = await createLink(t, { key: "zz_ce_bad3", ...P, viaProperty: "level", viaKeyExpr: 'this.level' });
    expect(both.statusCode).toBe(400);
    expect(JSON.parse(both.body).error.message).toContain("互斥");

    // ④ 聚合要沿链路导航，而物化此刻正在**建**这些链路（循环依赖）。
    const agg = await createLink(t, { key: "zz_ce_bad4", ...P, viaKeyExpr: 'COUNT(out(scenario_to_target))' });
    expect(agg.statusCode).toBe(400);

    // ⑤ 叉积没有上限 = 一次误声明写爆仓储。
    const noBudget = await t.app.inject({
      method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN,
      payload: { key: "zz_ce_bad5", fromTypeKey: "Base", toTypeKey: "DataSourceHealth", cardinality: "N:N", viaCross: {} },
    });
    expect(noBudget.statusCode).toBe(400);

    // 🐤 反向金丝雀：合法声明必须仍然 201（上面五条不是「什么都拒」）。
    const ok = await createLink(t, { key: "zz_ce_ok", ...P, viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")' });
    expect(ok.statusCode, "🐤 合法声明被拒 ⇒ 校验收得太狠，上面五条 400 证明不了什么").toBe(201);
  });
});
