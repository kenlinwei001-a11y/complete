import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-PREDICATE-EDGE · 接缝门：**谓词边的声明（写入侧）× 求值（物化侧）× 多跳检索（读出侧）**。
 *
 * ── 这道门守的是哪条接缝 ──────────────────────────────────────────────────
 * `viaProperty` 只问「值对不对得上」，不问「这一行**该不该**参与这条边」。
 * `CarbonFactor(kind, key)` 是**通用查表**：只有 `kind === "material"` 时 `key` 才是 `matId`
 * （种子里的守卫见 `synthetic/service.ts:1103`）。没有谓词 ⇒ 任何 `key` 恰好撞上 matId 的
 * 非物料因子行都会被静默连进碳排链。**「能连出边」和「连对了边」是两个命题**（铁律 1.5）。
 *
 * ⚠ **本门刻意不满足于「修前 0 / 修后 8」那组数** —— 实测在**未经改动的 demo 数据**上，
 * 加不加谓词都是 8 条（6 条 grid 行的 `key` 是省名，本来就解析不到任何 Material ⇒ 落进
 * `unresolved` 而不是变成边）。**那组数证明不了谓词做了任何事**：8 完全是 `viaProperty` 一个人干的。
 * 这正是「接了线没数据」那一态 —— 分支从没进入过，测试却全绿。
 * 所以下面 §2 **先把危害注入成真的**（把一行 grid 因子的 `key` 改成真 matId），
 * 让「有谓词 / 无谓词」在同一份数据上**真的分叉**，再断言。
 *
 * §3 是**反向对照**（本单验收硬判据）：改一个对象的属性使它不再满足谓词 ⇒ 那条边必须消失；
 * 改回来必须复现。**边不随属性变 = 谓词没真求值，是查表。**
 */

/** 注册一条一跳切片并解析，返回该 linkKey 的边（排序后，用于逐字节比对）。 */
async function edgesVia(t: TestApp, sliceKey: string, linkKey: string): Promise<string[]> {
  const put = await t.app.inject({
    method: "PUT",
    url: `/a/v1/ontology/slices/${sliceKey}`,
    headers: ADMIN,
    payload: {
      version: 1,
      spec: { root: { typeKey: "Material", selector: {} }, paths: [[{ linkKey, direction: "out" }]], maxNodes: 5000 },
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
  t.app.inject({
    method: "POST",
    url: "/a/v1/ontology/link-types",
    headers: ADMIN,
    payload: { fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N", ...payload },
  });

const PRED = "CarbonFactor.kind == 'material'";
const VIA = { viaProperty: "key", viaSide: "to" as const };

/** 改一个对象的 props 并落库（无 REST 写入口 ⇒ 直接走仓储，与种子同一张表）。 */
async function patchObject(t: TestApp, type: string, pick: (o: { props: Record<string, unknown> }) => boolean, patch: Record<string, unknown>): Promise<string> {
  const rows = await t.repos.objects.listByType("demo", type);
  const target = rows.find(pick);
  if (!target) throw new Error(`no ${type} row matched`);
  await t.repos.objects.put({ ...target, props: { ...target.props, ...patch } });
  return target.id;
}

describe("WO-PREDICATE-EDGE · 接缝：谓词声明 × 求值 × 检索", () => {
  it("§1 金丝雀 + 修前：不给 viaProperty ⇒ 检索 0 条", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀：出厂 material_carbon 必须检索得到，证明检索方法本身是好的。
    // 不中 ⇒ 「我的工具坏了」，下面一切读数不许当结论。
    const canary = await edgesVia(t, "pred-canary", "material_carbon");
    expect(canary.length).toBeGreaterThan(0);

    const before = await createLink(t, { key: "pred_carbon" });
    expect(before.statusCode).toBe(201);
    expect(await edgesVia(t, "pred-before", "pred_carbon")).toHaveLength(0);
  });

  it("§2 对照实验：把危害注入成真的，谓词必须挡住那条脏边", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 未改动的 demo 数据上，加不加谓词都是同一个数 —— 先把这件事断言出来，
    // 免得后人拿这组数当「谓词生效」的证据（它不是）。
    const pristineAll = await createLink(t, { key: "pred_pristine_all", ...VIA });
    expect(pristineAll.statusCode).toBe(201);
    const pristineWith = await createLink(t, { key: "pred_pristine_pred", ...VIA, viaWhere: PRED });
    expect(pristineWith.statusCode).toBe(201);
    const nAll0 = (await edgesVia(t, "pred-p-all", "pred_pristine_all")).length;
    const nPred0 = (await edgesVia(t, "pred-p-pred", "pred_pristine_pred")).length;
    expect(nAll0).toBe(nPred0); // 谓词在原始数据上是**惰性**的：它防的是尚未发生的脏数据

    // ── 注入危害：一行 grid 因子的 key 改成真 matId ⇒ 无谓词就会连出一条脏边 ──
    const mats = await t.repos.objects.listByType("demo", "Material");
    const someMatId = String(mats[0]!.objectKey ?? mats[0]!.props.matId);
    await patchObject(t, "CarbonFactor", (o) => String(o.props.kind) === "grid", { key: someMatId });

    // 重新物化（同 key upsert ⇒ 走一遍 materializeDeclaredLinks）
    await createLink(t, { key: "pred_pristine_all", ...VIA });
    await createLink(t, { key: "pred_pristine_pred", ...VIA, viaWhere: PRED });
    const nAll1 = (await edgesVia(t, "pred-p-all2", "pred_pristine_all")).length;
    const nPred1 = (await edgesVia(t, "pred-p-pred2", "pred_pristine_pred")).length;

    // 这就是本机制存在的全部理由：同一份数据，无谓词多连一条，有谓词没多连。
    expect(nAll1).toBe(nAll0 + 1); // 脏边确实出现了（证明危害是真的，不是假想）
    expect(nPred1).toBe(nPred0); // 谓词把它挡在外面
    expect(nPred1).toBeLessThan(nAll1);
  });

  it("§3 反向对照：属性变了边必须跟着变（边不随属性变 = 没真求值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await createLink(t, { key: "pred_rev", ...VIA, viaWhere: PRED });
    const base = await edgesVia(t, "pred-rev0", "pred_rev");
    expect(base.length).toBeGreaterThan(0);

    // 改一个 material 因子 ⇒ 不再满足谓词 ⇒ 它那条边必须消失
    const flipped = await patchObject(t, "CarbonFactor", (o) => String(o.props.kind) === "material", { kind: "grid" });
    await createLink(t, { key: "pred_rev", ...VIA, viaWhere: PRED });
    const after = await edgesVia(t, "pred-rev1", "pred_rev");
    // eslint-disable-next-line no-console -- 反向对照的两个数是本单验收判据，留在输出里可独立复核
    console.log(`[WO-PREDICATE-EDGE 反向对照] 改前=${base.length} 改后=${after.length}`);
    expect(after).toHaveLength(base.length - 1);

    // 改回来 ⇒ 必须逐字节复现
    const row = (await t.repos.objects.listByType("demo", "CarbonFactor")).find((o) => o.id === flipped)!;
    await t.repos.objects.put({ ...row, props: { ...row.props, kind: "material" } });
    await createLink(t, { key: "pred_rev", ...VIA, viaWhere: PRED });
    expect(await edgesVia(t, "pred-rev2", "pred_rev")).toEqual(base);
  });

  it("§4 确定性（R6）：同一份数据求值两次，边集合逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await createLink(t, { key: "pred_det", ...VIA, viaWhere: PRED });
    const run1 = await edgesVia(t, "pred-det1", "pred_det");
    await createLink(t, { key: "pred_det", ...VIA, viaWhere: PRED });
    const run2 = await edgesVia(t, "pred-det2", "pred_det");
    expect(run1).toEqual(run2);
    expect(run1.length).toBeGreaterThan(0); // 金丝雀：别拿「两次都是 0」冒充确定性
  });

  it("§5 写入校验：会变成哑弹边的写法一律 400 + 错误信封，不许静默收下", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀：合法谓词必须 201（证明这一组 400 不是「什么都拒」）
    expect((await createLink(t, { key: "pred_ok", ...VIA, viaWhere: PRED })).statusCode).toBe(201);

    const cases: { name: string; payload: Record<string, unknown>; expectIn: string }[] = [
      // 打错字段名 ⇒ 恒判假 ⇒ 0 实例的死边。必须当场点名，并列出可选属性。
      { name: "字段打错字", payload: { key: "p1", ...VIA, viaWhere: "CarbonFactor.knid == 'material'" }, expectIn: "knid" },
      // 谓词只能收窄一个已存在的连接，自己造不出连接
      { name: "只给 viaWhere 不给 viaProperty", payload: { key: "p2", viaWhere: PRED }, expectIn: "viaProperty" },
      // 结构边没有 params 袋子 ⇒ 物化中途抛错
      { name: "params.*", payload: { key: "p3", ...VIA, viaWhere: "CarbonFactor.factor > params.floor" }, expectIn: "params" },
      // 同一份数据对不同用户产出不同边集 ⇒ 破 R6
      { name: "user.*", payload: { key: "p4", ...VIA, viaWhere: "CarbonFactor.kind == user.userId" }, expectIn: "user" },
      // 没有 sustain 提供者 ⇒ 恒假 ⇒ 死边
      { name: "SUSTAIN", payload: { key: "p5", ...VIA, viaWhere: "SUSTAIN(CarbonFactor.factor > 1, 3)" }, expectIn: "SUSTAIN" },
      // 谓词逐行判定，聚合在单行上无意义且静默给 0
      { name: "聚合函数", payload: { key: "p6", ...VIA, viaWhere: "SUM(CarbonFactor.factor) > 1" }, expectIn: "SUM" },
      // 语法错误必须带位置，不许吞
      { name: "语法错误", payload: { key: "p7", ...VIA, viaWhere: "CarbonFactor.kind ==" }, expectIn: "viaWhere" },
    ];

    for (const c of cases) {
      const res = await createLink(t, c.payload);
      expect(res.statusCode, `${c.name} 应当 400`).toBe(400);
      const env = JSON.parse(res.body) as { error?: { code?: string; message?: string; requestId?: string } };
      expect(env.error?.code, `${c.name} 错误信封 code`).toBeTruthy();
      expect(env.error?.requestId, `${c.name} 错误信封 requestId`).toBeTruthy();
      expect(env.error?.message ?? "", `${c.name} 报错要点名原因`).toContain(c.expectIn);
      // 被拒的声明**不许留下半条边**
      expect(await edgesVia(t, `pred-rej-${c.payload.key}`, String(c.payload.key))).toHaveLength(0);
    }
  });
});
