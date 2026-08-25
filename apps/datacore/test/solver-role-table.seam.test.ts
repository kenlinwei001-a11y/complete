import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, ADMIN, invokeSolver, type TestApp } from "./helpers.js";
import { SOLVER_FIELD_ROLES } from "../src/solvers/field-roles.js";
import { GENERIC_SOLVER_CATALOG } from "../src/catalog.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * ★ WO-SOLVER-ROLE-TABLE-DRIFT · 两条**接缝**测试（咬链路不咬函数）
 *
 *   臂 A「角色表」：`SOLVER_FIELD_ROLES` 登记的 role 名 ↔ 求解器**实读入参名**
 *   臂 B「id 口径」：`concentration_risk` 同一回包里 `rootId` ↔ `dependents[]` 的 id 口径
 *
 * ── 臂 A · 病是什么（实测·各自读到方法边界，非 grep 直读）──────────────────────────────
 * `concentrationRisk`（`service.ts:1408-1453`）实读 `args.startType`(:1409) / `args.path`(:1410)
 * / `args.minDependents`(:1411)，而 `SOLVER_FIELD_ROLES.concentration_risk` 修前登记
 * `["rootType","sinkType"]` ⇒ **交集 0**。另三个实测 ⊆ 成立、无漂移：
 * `supplier_disruption_radius`(`:4647-4679` rootType/rootId/layers)、`shared_bottleneck`(`:1343-1400`)、
 * `margin_attribution`(`:1517-1564`)。
 *
 * **为什么这是 A 类（用户看得到坏东西）而不是记账**：本表唯一生产消费方是
 * `app.ts` 的 `GET /a/v1/solvers/:solverKey/field-roles`，前端 `SolversPage.tsx` 的「字段角色绑定」
 * 块把 role 名**原样上屏**（`<span class=mono>{role}</span> → <b>{roles[role]}</b>`），标题旁的口径写着
 * 「在本租户本体里绑到哪」。⇒ 屏上原本渲染的是 `rootType → 某类型`，而 `concentration_risk`
 * 根本不认 `rootType` 这个入参；更坏的是**方向反了**：那条打分（fanOut + leaf 词库）挑的是
 * **分散起点**（客户/订单），而该求解器自己把**收敛根**叫 `rootType`（`:1443` 从 path 末跳算出的输出字段）
 * —— 同一个词在同一块屏上指着链条的两端。用户照它理解求解器必然错。
 *
 * **判据刻意不是「有没有这几个名字」**（硬编码键名清单会随下次改名再漂，且改的人不会想起来同步它），
 * 而是**行为**：把 role 名从真值组里**删掉**，求解器必须察觉（400 或答案变）。
 * 求解器压根不读的名字，删了它当然什么都不会变 —— 这就是「假绑定」的行为指纹。
 *
 * ── 臂 B · 病是什么 ───────────────────────────────────────────────────────────────────
 * 修前 `rootKey = keyOf(cur)`（`:1438` 少传 pk ⇒ 落 `o.id` **仓储 id** 分支），而同一条 map 里
 * `dependents` 取 `keyOf(s, sPk)`（**主键值**）⇒ 同一个 JSON 两种 id 口径。
 * 不报错，只是对不上 —— **静默错答**。三条真实后果（全部实测）：
 *  ① 与之**互为反向**的 `supplier_disruption_radius` 逐层比 `props[viaField]`（=主键值，`:4660`），
 *     喂仓储 id 进去恒零命中 ⇒ 「断供影响 0 个对象」这种**全清报告**；
 *  ② 前端集中度页把本字段直接上屏当「最大敞口根」（`CleanroomAttrView.tsx:596/606`），
 *     而断供页的 rootId 下拉取 `props[pk] ?? o.id`（`DisruptionRadiusView.tsx:304`）
 *     ⇒ 用户在一页看到 `obj_xxx`、去另一页搜不到它；
 *  ③ 本仓其它求解器一律主键值（`:1359/1380` · `:4661` · `:1534` · `:4699`），仓储 id 是孤例。
 *
 * **判据是「调用方拿这个 id 能不能查到东西」**：两个字段必须能经**同一条** `repos.objects` 规则查回
 * （§2a），且 rootId 必须真能驱动反向那一个求解器扇出（§2b）。
 * 刻意**不用**「查得到就行（主键值 OR 仓储 id 任一命中）」这种宽松口径 —— 那两种口径都能过，
 * 等于把要验的那件事验没了。
 *
 * ── 反假绿设计（铁律 0.6：扫描/判定类结论一律先自证工具）────────────────────────────────
 * §0a 正金丝雀：用**实读键**调 `concentration_risk` 必须给出非平凡真答案（1 个集中点 · 敞口 3）；
 *      不成立 ⇒ 报「**夹具/工具坏了**」，**不许**读作「求解器漂了」——两者处置相反。
 * §0b 端点金丝雀：field-roles 端点对 4 个声明求解器各回**非空** candidates 键集，对未声明者回空
 *      ⇒ 防「端点坏了 → 名字集恒空 → §1 恒真」。
 * §1d/§2c 负金丝雀：把**历史漂移名**与**旧 id 口径**分别喂进 §1b/§2a 的**同一条**判据路径，
 *      必须红。它们与主判据**共用同一份实现**（不另抄一条路径，抄了就是装饰品）。
 */

// ---------------------------------------------------------------------------
// 夹具 · 一张自足的对象图（Ah2* 前缀：与 demo 种子及兄弟测试的 Ah* 夹具都不撞）
//   ⚠ `makeApp()` 默认**已播 demo 种子**，故类型键必须自带前缀；本文件所有断言都不依赖
//     「哪个类型在角色打分里胜出」——臂 A 只用 role **名**，臂 B 显式点名类型。
// ---------------------------------------------------------------------------

const SUPPLIER = "华东电解液";
const CUSTOMERS = ["星辰", "蓝海", "远景"] as const;

async function seedRoleTableGraph(t: TestApp): Promise<void> {
  const ot = (key: string, props: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string }[]) =>
    t.repos.ontologyTypes.put({
      id: `ot_${key}`, tenantId: "demo", key, displayName: key, domain: "x", version: 1,
      status: "ACTIVE", derivedProperties: [], sourceBindings: [],
      properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
    });
  const obj = (id: string, type: string, props: Record<string, unknown>) =>
    t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId: "demo", type, props });

  // 共享瓶颈 + 毛利倒挂：Ah2Resource ← Ah2Sharer
  // ⚠ 收入字段刻意叫 `unitPrice` 而非 `revenue`：`marginAttribution:1519` 的 revenueField **默认值就是
  //   "revenue"**，若夹具用默认名，§1b 的「删掉 revenueField」探针会因默认值兜底而拿到字节相同的答案
  //   ——那是**探针失灵**（假绿），不是「该键没被读」。
  await ot("Ah2Resource", [
    { propKey: "resId", dataType: "string", isPrimaryKey: true },
    { propKey: "capacity", dataType: "number" },
  ]);
  await ot("Ah2Sharer", [
    { propKey: "sharerId", dataType: "string", isPrimaryKey: true },
    { propKey: "resRef", dataType: "ref", refToTypeKey: "Ah2Resource" },
    { propKey: "qty", dataType: "number" },
    { propKey: "prio", dataType: "number" },
    { propKey: "unitPrice", dataType: "number" },
    { propKey: "rawCost", dataType: "number" },
    { propKey: "freight", dataType: "number" },
  ]);
  await obj("ah2_r1", "Ah2Resource", { resId: "化成", capacity: 10 });
  await obj("ah2_s1", "Ah2Sharer", { sharerId: "星辰", resRef: "化成", qty: 7, prio: 3, unitPrice: 100, rawCost: 120, freight: 5 });
  await obj("ah2_s2", "Ah2Sharer", { sharerId: "蓝海", resRef: "化成", qty: 8, prio: 2, unitPrice: 100, rawCost: 130, freight: 4 });

  // 隐性集中度 + 断供半径：Ah2Customer → Ah2Order → Ah2Material → Ah2Supplier（三跳收敛到一根）
  // 主键值（"华东电解液"/"星辰"…）与仓储 id（"ah2_sup1"/"ah2_c_星辰"…）**刻意不相等**，
  // 否则两种 id 口径在断言里长得一样，臂 B 验的东西自动消失。
  await ot("Ah2Supplier", [{ propKey: "supId", dataType: "string", isPrimaryKey: true }]);
  await ot("Ah2Material", [
    { propKey: "matId", dataType: "string", isPrimaryKey: true },
    { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Ah2Supplier" },
  ]);
  await ot("Ah2Order", [
    { propKey: "soId", dataType: "string", isPrimaryKey: true },
    { propKey: "materialRef", dataType: "ref", refToTypeKey: "Ah2Material" },
  ]);
  await ot("Ah2Customer", [
    { propKey: "custId", dataType: "string", isPrimaryKey: true },
    { propKey: "orderRef", dataType: "ref", refToTypeKey: "Ah2Order" },
  ]);
  await obj("ah2_sup1", "Ah2Supplier", { supId: SUPPLIER });
  await obj("ah2_m1", "Ah2Material", { matId: "正极A", supplierRef: SUPPLIER });
  await obj("ah2_m2", "Ah2Material", { matId: "电解液B", supplierRef: SUPPLIER });
  for (const [so, mat] of [["SO1", "正极A"], ["SO2", "电解液B"], ["SO3", "正极A"]] as const) {
    await obj(`ah2_${so}`, "Ah2Order", { soId: so, materialRef: mat });
  }
  for (const [cust, so] of [["星辰", "SO1"], ["蓝海", "SO2"], ["远景", "SO3"]] as const) {
    await obj(`ah2_c_${cust}`, "Ah2Customer", { custId: cust, orderRef: so });
  }
}

/** 真值组 · 「用求解器**真读的键**调用能算出真答案」的那一组实参（值是夹具，键的清单不是被验对象）。 */
const CONCENTRATION_PATH = [
  { viaField: "orderRef", toType: "Ah2Order" },
  { viaField: "materialRef", toType: "Ah2Material" },
  { viaField: "supplierRef", toType: "Ah2Supplier" },
];
const DISRUPTION_LAYERS = [
  { type: "Ah2Material", viaField: "supplierRef" },
  { type: "Ah2Order", viaField: "materialRef" },
  { type: "Ah2Customer", viaField: "orderRef" },
];

const WORKING_ARGS: Record<string, Record<string, unknown>> = {
  shared_bottleneck: {
    resourceType: "Ah2Resource", sharedByType: "Ah2Sharer", viaField: "resRef",
    capacityField: "capacity", demandField: "qty", priorityField: "prio",
  },
  concentration_risk: { startType: "Ah2Customer", path: CONCENTRATION_PATH, minDependents: 2 },
  margin_attribution: {
    targetType: "Ah2Sharer", revenueField: "unitPrice",
    costFields: [{ field: "rawCost", label: "原料" }, { field: "freight", label: "运费" }],
    marginThreshold: 0,
  },
  supplier_disruption_radius: { rootType: "Ah2Supplier", rootId: SUPPLIER, layers: DISRUPTION_LAYERS },
};

// ---------------------------------------------------------------------------
// 唯一几条调用路径 —— 金丝雀与主判据**共用**它们
// ---------------------------------------------------------------------------

interface Outcome { statusCode: number; code: string | null; message: string; data: Record<string, unknown> }

async function invoke(t: TestApp, solverKey: string, args: Record<string, unknown>): Promise<Outcome> {
  const res = await invokeSolver(t, solverKey, args);
  const body = res.json() as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
  return { statusCode: res.statusCode, code: body.error?.code ?? null, message: body.error?.message ?? "", data: body.data ?? {} };
}

/** 可比较指纹：状态 + 错误码 + 数据体。**刻意不含 requestId**（每次都不同，会把「答案没变」染成「变了」）。 */
const fingerprint = (o: Outcome): string => `${o.statusCode}|${o.code ?? ""}|${JSON.stringify(o.data)}`;

/**
 * ★ 臂 A 的唯一判据实现：**这个键，求解器读不读**。
 * 判法 = 从真值组里删掉它再调一次；求解器若真读它，行为必变（缺必填 → 400，或答案不同）。
 * 求解器压根不认的名字，删了当然字节不变 —— 那就是「假绑定」。
 */
async function isKeyRead(t: TestApp, solverKey: string, key: string): Promise<{ read: boolean; base: string; without: string }> {
  const full = WORKING_ARGS[solverKey]!;
  const base = await invoke(t, solverKey, full);
  const stripped: Record<string, unknown> = { ...full };
  delete stripped[key];
  const without = await invoke(t, solverKey, stripped);
  return { read: fingerprint(base) !== fingerprint(without), base: fingerprint(base), without: fingerprint(without) };
}

/**
 * ★ 臂 B 的唯一判据实现：经 `repos.objects` 按**本仓统一 id 口径**（主键值，无主键回落仓储 id）查回。
 * 与求解器内 `keyOf(o, pk)` 同一条规则。**不做「主键值 OR 仓储 id」的宽松兜底** —— 宽松兜底两种口径都能过。
 */
async function lookupByCaliber(t: TestApp, typeKey: string, id: string): Promise<ObjectInstance | undefined> {
  const objs = await t.repos.objects.listByType("demo", typeKey);
  const tdef = (await t.repos.ontologyTypes.list("demo", (x) => x.key === typeKey))[0];
  const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
  return objs.find((o) => String((pk ? o.props[pk] : undefined) ?? o.id) === id);
}

const hintKeysOf = (solverKey: string): string[] =>
  Object.keys(GENERIC_SOLVER_CATALOG.find((x) => x.key === solverKey)?.argHints ?? {});

const DECLARED = Object.keys(SOLVER_FIELD_ROLES).sort();

interface ConcRow { rootType: string; rootId: string; dependents: string[]; count: number }
interface ConcOut { concentrations: ConcRow[]; topExposure: ConcRow | null; summary: string }

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
  await seedRoleTableGraph(t);
}, 120_000);

// ---------------------------------------------------------------------------
// §0 金丝雀 —— 先证明夹具/求解器/端点都是活的，再谈「表对不对」「id 对不对」
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ROLE-TABLE-DRIFT §0 · 金丝雀（不成立则报「工具坏了」，不许报「求解器漂了」）", () => {
  const BROKEN = "金丝雀失败：用**实读键**调用都算不出预期答案 ⇒ **夹具/求解器坏了，不是表漂了 / id 口径错了**。本次 §1/§2 的结论一律作废。";

  it("§0a 正金丝雀：concentration_risk 用实读键 → 三个客户经三跳收敛到同一供应商（1 个集中点 · 敞口 3）", async () => {
    const r = await invoke(t, "concentration_risk", WORKING_ARGS.concentration_risk!);
    expect(r.statusCode, `${BROKEN} 实收 ${r.code}: ${r.message}`).toBe(200);
    const out = r.data as unknown as ConcOut;
    expect(out.concentrations.length, BROKEN).toBe(1);
    expect(out.topExposure?.rootType, BROKEN).toBe("Ah2Supplier");
    expect(out.topExposure?.count, BROKEN).toBe(3);
  });

  it("§0b 端点金丝雀：4 个声明求解器各回非空 candidates 键集；未声明者回空 roles（防「端点坏了 ⇒ §1 恒真」）", async () => {
    for (const k of DECLARED) {
      const r = (await t.app.inject({ method: "GET", url: `/a/v1/solvers/${k}/field-roles`, headers: ADMIN })).json() as {
        candidates: Record<string, unknown[]>;
      };
      expect(Object.keys(r.candidates).length, `${k} 的 field-roles 端点回了 0 个角色 ⇒ 端点/解析器坏了，§1a 会恒真`).toBeGreaterThan(0);
    }
    // 反向：注册表里存在、但**未声明角色**的求解器必须回空 —— 端点若给每个 key 都编一份角色，上面那条也恒真。
    const undeclared = GENERIC_SOLVER_CATALOG.map((x) => x.key).find((k) => !(k in SOLVER_FIELD_ROLES));
    expect(undeclared, "目录里找不到任何「未声明角色」的求解器 ⇒ 本条反向金丝雀失效（工具坏了）").toBeTruthy();
    const none = (await t.app.inject({ method: "GET", url: `/a/v1/solvers/${undeclared}/field-roles`, headers: ADMIN })).json() as {
      roles: Record<string, string>;
    };
    expect(Object.keys(none.roles), `${undeclared} 未在 SOLVER_FIELD_ROLES 里声明，端点却给了角色`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §1 臂 A · 角色表 —— 屏上渲染的 role 名，必须是求解器真读的入参名
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ROLE-TABLE-DRIFT §1 · 角色表臂（role 名 ≡ 求解器实读入参名）", () => {
  it("§1a 链路：field-roles 端点回包的角色名集 === SOLVER_FIELD_ROLES（屏上渲染的就是这些名）", async () => {
    for (const k of DECLARED) {
      const r = (await t.app.inject({ method: "GET", url: `/a/v1/solvers/${k}/field-roles`, headers: ADMIN })).json() as {
        candidates: Record<string, unknown[]>;
      };
      expect(
        Object.keys(r.candidates).sort(),
        `${k}：端点下发的角色名与 SOLVER_FIELD_ROLES 对不上 —— 前端 SolversPage「字段角色绑定」渲染的就是这一组名`,
      ).toEqual([...SOLVER_FIELD_ROLES[k]!].sort());
    }
  });

  for (const solverKey of DECLARED) {
    it(`★ §1b ${solverKey}：每个 role 名都必须是求解器实读键（删掉它，求解器必须察觉）`, async () => {
      expect(WORKING_ARGS[solverKey], `${solverKey} 没有真值组 ⇒ 本条退化成恒真（新增声明角色的求解器请补一组实参）`).toBeTruthy();
      for (const role of SOLVER_FIELD_ROLES[solverKey]!) {
        const p = await isKeyRead(t, solverKey, role);
        expect(
          p.read,
          `${solverKey} 的角色名 \`${role}\` **求解器一处也不读**：把它从真值组里删掉，回包字节不变（${p.base}）。\n` +
            `⇒ 前端 SolversPage 的「字段角色绑定」会把 \`${role} → 某类型\` 原样上屏，而那是**假绑定**：` +
            `用户照它去理解/调用这个求解器必然错。\n` +
            `修：改 apps/datacore/src/solvers/field-roles.ts 的 SOLVER_FIELD_ROLES[${solverKey}] 为求解器**真读的**入参名` +
            `（解析器解不出的结构化数组/运行期标量不登记），**不是**去改求解器。`,
        ).toBe(true);
      }
    });
  }

  it("§1c 交叉网（现算·不硬编码键名）：role 名 ⊆ 目录 argHints 键（该目录已被 solver-arghints-contract 真调用验过）", () => {
    const bad: string[] = [];
    for (const k of DECLARED) {
      const hints = new Set(hintKeysOf(k));
      expect(hints.size, `${k} 的目录 argHints 为空 ⇒ 本条退化成恒真（金丝雀）`).toBeGreaterThan(0);
      for (const role of SOLVER_FIELD_ROLES[k]!) if (!hints.has(role)) bad.push(`${k}.${role}`);
    }
    expect(
      bad,
      "角色名不在该求解器的目录 argHints 里 —— 两份「给外部看的入参说明」互相矛盾，至少一份在骗人。",
    ).toEqual([]);
  });

  it("§1d 负金丝雀：把历史漂移名 rootType/sinkType 喂进 §1b **同一条**探针 → 必须判「不被读」（证明 §1b 不空转）", async () => {
    for (const stale of ["rootType", "sinkType"]) {
      const p = await isKeyRead(t, "concentration_risk", stale);
      expect(
        p.read,
        `判据空转了：\`${stale}\` 是 concentration_risk 修前登记、而求解器从不读的名字，探针竟判它「被读」` +
          `⇒ §1b 的绿证明不了任何事，必须先修本探针而不是宣布通过。`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 臂 B · id 口径 —— 同一回包里的 rootId 与 dependents[] 必须是同一套 id
// ---------------------------------------------------------------------------

describe("WO-SOLVER-ROLE-TABLE-DRIFT §2 · id 口径臂（判据 = 拿这个 id 真能查到东西）", () => {
  const runConc = async (): Promise<ConcOut> => {
    const r = await invoke(t, "concentration_risk", WORKING_ARGS.concentration_risk!);
    expect(r.statusCode, `concentration_risk 调用失败 ${r.code}: ${r.message}`).toBe(200);
    return r.data as unknown as ConcOut;
  };

  it("★ §2a rootId 与 dependents[] 必须经**同一条** repos.objects 规则查回（不是「长得像」）", async () => {
    const out = await runConc();
    const top = out.topExposure!;
    // 金丝雀：待查集合非空，否则下面两条是拿空集比空集。
    expect(top.dependents.length, "dependents 为空 ⇒ 本条退化成恒真（工具坏了）").toBe(3);

    const rootObj = await lookupByCaliber(t, top.rootType, top.rootId);
    expect(
      rootObj?.props.supId,
      `rootId="${top.rootId}" 经 repos.objects 查不回 ${top.rootType} 的任何对象。` +
        `同一回包里的 dependents[] 却查得回 ⇒ **一个 JSON 两种 id 口径**（静默错答：不报错，只是对不上）。` +
        `修：service.ts concentrationRisk 的 rootKey 取主键值（keyOf(cur, pk)），与 dependents 同规则。`,
    ).toBe(SUPPLIER);

    for (const dep of top.dependents) {
      const depObj = await lookupByCaliber(t, "Ah2Customer", dep);
      expect(depObj, `dependents 里的 "${dep}" 经同一条规则查不回 Ah2Customer 对象`).toBeTruthy();
    }
    expect([...top.dependents].sort(), "依赖方应是三个客户的主键值").toEqual([...CUSTOMERS].sort());
  });

  it("★ §2b 链路：rootId 直接喂给**互为反向**的 supplier_disruption_radius → 必须真扇出（3 层 · 叶层 3 个客户）", async () => {
    const out = await runConc();
    const top = out.topExposure!;
    // 两个求解器的头注互称反向：这里的收敛根，就是那里的断供根。口径不一 ⇒ 那里恒零命中而**不报错**。
    const r = await invoke(t, "supplier_disruption_radius", { rootType: top.rootType, rootId: top.rootId, layers: DISRUPTION_LAYERS });
    expect(r.statusCode, `${r.code}: ${r.message}`).toBe(200);
    const rad = r.data as { radius: number; totalAffected: number; leafCount: number };
    expect(
      rad.radius,
      `把 concentration_risk 的 rootId="${top.rootId}" 喂给反向求解器，扇出 0 层 ⇒ ` +
        `「断供影响 0 个对象」的**全清报告**。这不是没影响，是两个求解器的 id 口径对不上（supplier_disruption_radius ` +
        `逐层比 props[viaField] = 主键值）。`,
    ).toBe(3);
    expect(rad.leafCount).toBe(3);
    expect(rad.totalAffected).toBe(2 + 3 + 3);
  });

  it("§2c 负金丝雀：把**旧口径**（仓储 id，现算取自 repos）喂进 §2a/§2b 同一条路径 → 必须查不回 + 扇出 0（证明 §2 不空转）", async () => {
    const sup = (await t.repos.objects.listByType("demo", "Ah2Supplier"))[0]!;
    expect(sup.id, "夹具的仓储 id 与主键值不该相等，否则 §2 验的东西自动消失").not.toBe(SUPPLIER);

    expect(
      await lookupByCaliber(t, "Ah2Supplier", sup.id),
      `判据空转了：仓储 id "${sup.id}" 经 §2a 的同一条规则竟然查得回 ⇒ §2a 的绿证明不了口径统一。`,
    ).toBeUndefined();

    const r = await invoke(t, "supplier_disruption_radius", { rootType: "Ah2Supplier", rootId: sup.id, layers: DISRUPTION_LAYERS });
    expect(r.statusCode).toBe(200);
    expect(
      (r.data as { radius: number }).radius,
      `判据空转了：拿仓储 id 当断供根竟然也扇出了 ⇒ §2b 的绿证明不了任何事。`,
    ).toBe(0);
  });
});
