import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import type { CatalogItem } from "../src/catalog.js";
import { BUILTIN_SLICE_CATALOG } from "../src/catalog.js";

/**
 * WO-SLICE-DISCOVERY · 接缝驱动门（SEAM-GATE）—— 闭 §8 `G-SLICE-CATALOG-TWO-ITEMS`
 * 与 `G-SLICE-ROOT-ARGS-UNDISCOVERABLE`。
 *
 * 病灶（真后端实测 2026-08-10 · demo · seed 42 · 端口 4193 亲手跑）：
 *   `GET /a/v1/slices/index` → 98 条 SliceSpec；`GET /a/v1/catalog?kind=slices` → **2 条**。
 *   两条差 96 —— 全部卡在 `catalog.ts` 的 `spec.description` 非空过滤上（没有任何生产写入方
 *   产出这个字段）。而目录里那 2 条还是 `BUILTIN_SLICE_CATALOG` 硬编码的，`slice_specs` 里
 *   根本不存在它们。
 *
 * **本门刻意不只测"派生函数能产出 description"** —— 那是假绿第 9 形态（咬的是函数不是链路）。
 * 它驱动的是真链路：真播种 → 真仓储 → 真 `CatalogService.discover` → 真路由；
 * 并且把「摘要说要什么参数」拿去**真跑一次 resolve**，证明摘要与执行期是同一个真源
 * （两处各写一份，迟早对不上，而且对不上时没有任何信号 —— 这正是本仓反复吃亏的坑）。
 */

interface SliceIndexEntry {
  sliceKey: string;
  rootType: string;
  spannedTypes: string[];
}

/**
 * 真播种：走 `POST /a/v1/synthetic/jobs` 这条**生产写入路径** —— 98 条 SliceSpec 正是它落的
 * （`synthetic/service.ts` → `batteryBuiltinSlices()` + `batteryCoverageSlices()`）。
 * 不用 `repos.sliceSpecs.put` 手塞：手塞就绕开了「切片是怎么来的」，本门也就不再驱动那条链。
 */
async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  return t;
}

describe("WO-SLICE-DISCOVERY · 98 条切片进资源目录（接缝驱动）", () => {
  it("SEAM-1：目录里的切片数 == 内置 + slice_specs 全量（不再被空 description 过滤掉）", async () => {
    const t = await seededApp();

    // ① 真仓储里到底有几条切片（判据取自库，不写死 98 —— 种子演进时本门仍成立）。
    const idx = await t.app.inject({ method: "GET", url: "/a/v1/slices/index", headers: ADMIN });
    expect(idx.statusCode).toBe(200);
    const registered = (idx.json() as { entries: SliceIndexEntry[] }).entries;
    // 金丝雀：库里必须真有一批切片，否则本门在空集上恒绿（那就不是门，是装饰品）。
    expect(registered.length, "slice_specs 应有成规模的切片；为 0 说明播种链断了，本门失去意义").toBeGreaterThan(50);

    // ② 目录端点（Agent 发现的供给侧）。
    const cat = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    expect(cat.statusCode).toBe(200);
    const items = (cat.json() as { items: CatalogItem[] }).items;

    // 修前：items.length === BUILTIN_SLICE_CATALOG.length（2），registered 全军覆没。
    expect(items.length).toBe(BUILTIN_SLICE_CATALOG.length + registered.length);
    // 每一条登记切片都必须在目录里找得到（逐条比对，不是只看总数 —— 总数相等也可能是换了一批）。
    const keys = new Set(items.map((i) => i.key));
    for (const e of registered) {
      expect(keys.has(e.sliceKey), `切片 ${e.sliceKey} 应可被发现`).toBe(true);
    }

    // ③ 「无描述不允许发布」这道纪律仍然有牙：每条都得有非空描述与实参声明。
    for (const it of items) {
      expect(it.description.trim().length, `${it.key} 描述非空`).toBeGreaterThan(0);
      expect(Array.isArray(it.requiredArgs), `${it.key} 应下发 requiredArgs`).toBe(true);
    }
  });

  it("SEAM-2：多跳业务切片可被发现，且摘要 requiredArgs == 执行期真正吃的那组实参", async () => {
    const t = await seededApp();
    const cat = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    const items = (cat.json() as { items: CatalogItem[] }).items;

    // 找一条**真的需要实参**的切片（不写死 key —— 换租户/换行业时判据不该失效）。
    const needsArgs = items.filter((i) => (i.requiredArgs ?? []).length > 0 && !BUILTIN_SLICE_CATALOG.some((b) => b.key === i.key));
    expect(needsArgs.length, "应至少有一条 root selector 带 {{args.X}} 的切片被发现").toBeGreaterThan(0);

    for (const item of needsArgs) {
      const args = item.requiredArgs ?? [];
      // 摘要必须为每个必需参数说清「该填什么」，否则调用方拿到名字也不知道填啥。
      for (const a of args) expect(item.argHints[a], `${item.key}.${a} 应有 argHint`).toBeTruthy();

      // 接缝驱动的要害：拿**摘要声明的参数名**去真跑一次 resolve。
      // 不给参数 ⇒ root 过滤恒不匹配 ⇒ 空子图；给了 ⇒ 解得出。
      // 若摘要与执行期不是同一个真源（各写一份正则/各扫一遍 selector），这一条必红。
      const empty = await t.app.inject({
        method: "POST",
        url: `/a/v1/slices/${item.key}/resolve`,
        headers: ADMIN,
        payload: { args: {} },
      });
      expect(empty.statusCode).toBe(200);
      expect((empty.json() as { data: { nodes: unknown[] } }).data.nodes.length, `${item.key} 无参应解出空子图`).toBe(0);
    }
  });

  it("SEAM-3：给上摘要声明的实参（真值取自真对象）→ 真解出非空子图（摘要与执行同源）", async () => {
    const t = await seededApp();
    const cat = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    const items = (cat.json() as { items: CatalogItem[] }).items;

    // 取一条需参切片，从**十六层投影的 argCandidates**（后端从真对象读出的候选值）拿真实参 ——
    // 那正是前端首屏默认实参走的同一条路（WO-SLICE-DEFAULT-ARGS），二者共用同一份占位符解析。
    // 只在**登记切片**（slice_specs 有记录）里挑：`BUILTIN_SLICE_CATALOG` 那 2 条是硬编码目录项，
    // 走的是 `ontology.resolveSlice` 的内置分支，压根没有 SliceSpec ⇒ 十六层端点必然 404。
    const builtinKeys = new Set(BUILTIN_SLICE_CATALOG.map((b) => b.key));
    const target = items.find((i) => (i.requiredArgs ?? []).length === 1 && !builtinKeys.has(i.key));
    expect(target, "应能找到一条单参的登记切片").toBeDefined();
    const argName = (target!.requiredArgs ?? [])[0]!;

    const layers = await t.app.inject({
      method: "GET",
      url: `/a/v1/ontology/slices/${target!.key}/layers`,
      headers: ADMIN,
    });
    expect(layers.statusCode).toBe(200);
    const empty = (layers.json() as { graph: { empty?: { reason: string; requiredArgs: string[]; argCandidates: { arg: string; values: string[] }[] } } }).graph.empty;
    expect(empty, `${target!.key} 无参应报空子图诊断`).toBeDefined();
    // 同源判据①：诊断层报的 requiredArgs 与目录摘要报的**必须一字不差**（两处各扫一遍就会漂）。
    expect(empty!.requiredArgs).toEqual(target!.requiredArgs);
    expect(empty!.reason).toBe("missing_args");

    const cand = empty!.argCandidates.find((c) => c.arg === argName);
    expect(cand, `应给出 ${argName} 的真值候选`).toBeDefined();
    if ((cand!.values ?? []).length === 0) return; // 真对象取不到候选 ⇒ 诚实跳过（不编一个值来凑绿）

    // 同源判据②：把候选值按**摘要给的参数名**填进去，真的解得出子图。
    const resolved = await t.app.inject({
      method: "POST",
      url: `/a/v1/slices/${target!.key}/resolve`,
      headers: ADMIN,
      payload: { args: { [argName]: cand!.values[0] } },
    });
    expect(resolved.statusCode).toBe(200);
    expect(
      (resolved.json() as { data: { nodes: unknown[] } }).data.nodes.length,
      `${target!.key} 给了 ${argName}=${cand!.values[0]} 应解出非空子图`,
    ).toBeGreaterThan(0);
  });

  it("SEAM-4：派生摘要带回 rootType/includedTypes（供 B 侧检索打分与 slice→objectType 关系）", async () => {
    const t = await seededApp();
    const [cat, idx] = await Promise.all([
      t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN }),
      t.app.inject({ method: "GET", url: "/a/v1/slices/index", headers: ADMIN }),
    ]);
    const items = (cat.json() as { items: CatalogItem[] }).items;
    const entries = (idx.json() as { entries: SliceIndexEntry[] }).entries;

    // 目录派生的覆盖类型集必须与 A3.4 切片索引**逐条一致**（同一份 resolveSpannedTypes，非另造一套图遍历）。
    let checked = 0;
    for (const e of entries) {
      const item = items.find((i) => i.key === e.sliceKey);
      expect(item, `${e.sliceKey} 应在目录中`).toBeDefined();
      expect(item!.rootType).toBe(e.rootType);
      expect(item!.includedTypes).toEqual(e.spannedTypes);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("SEAM-5：确定性（R6）—— 同租户两次 discover 字节级一致", async () => {
    const t = await seededApp();
    const a = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    const b = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    expect(a.body).toBe(b.body);
  });

  it("SEAM-6：tenant 隔离（R2）—— 别租户看不到本租户切片", async () => {
    const t = await seededApp();
    const other = await t.app.inject({
      method: "GET",
      url: "/a/v1/catalog?kind=slices",
      headers: { "x-debug-user": "other:u1:admin" },
    });
    expect(other.statusCode).toBe(200);
    const items = (other.json() as { items: CatalogItem[] }).items;
    // 别租户只剩平台内置切片（无 slice_specs 记录）。
    expect(items.map((i) => i.key).sort()).toEqual(BUILTIN_SLICE_CATALOG.map((b) => b.key).sort());
  });

  it("SEAM-7：真值源自带 description/argHints 时以它为准（派生只补位，不覆盖人写的业务描述）", async () => {
    const t = await seededApp();
    const own = "这是人写的业务描述，派生逻辑不许覆盖它。";
    // ⚠ 只能直写仓储：`PUT /a/v1/ontology/slices/:key` 的 zod body schema 里**没有** description 字段，
    //   zod 默认 strip 未声明键 ⇒ 经该路由写进去的 description 会被静默丢掉。这也正是「98 条一条都没
    //   description」的成因之一（另一半是几个生产写入方压根不产这个字段）。本例走 `repos.sliceSpecs.put`，
    //   与 `synthetic/service.ts:1153` / `databuilder/service.ts:1233` 是同一个写入口。
    await t.repos.sliceSpecs.put({
      id: "slice_wo_slice_discovery_own_desc",
      tenantId: "demo",
      sliceKey: "wo_slice_discovery_own_desc",
      version: 1,
      spec: {
        root: { typeKey: "Base", selector: {} },
        paths: [],
        maxNodes: 50,
        description: own,
        argHints: { someArg: "人写的 hint" },
      } as never,
    });
    const cat = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN });
    const item = (cat.json() as { items: CatalogItem[] }).items.find((i) => i.key === "wo_slice_discovery_own_desc");
    expect(item).toBeDefined();
    expect(item!.description).toBe(own);
    expect(item!.descriptionSynthesized).toBeUndefined();
    // 真值源自带的 argHints 不丢（即使它描述的是 requiredArgs 之外的可选参数）。
    expect(item!.argHints.someArg).toBe("人写的 hint");
  });
});
