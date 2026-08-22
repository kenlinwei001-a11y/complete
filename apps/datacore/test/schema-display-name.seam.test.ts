import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { PROP_DISPLAY_NAMES, propDisplayName } from "../src/synthetic/battery.js";
import { LEVER_PROP_META } from "../src/solvers/service.js";
import type { PropertyDef } from "../src/domain.js";

/**
 * WO-SCHEMA-ZH · SEAM-GATE：本体 Schema 的属性中文业务名（PropertyDef.displayName）真下发。
 *
 * 判据是**效果层**，不是"字段定义了"：
 *  ① 断言 displayName 出现在**接口响应里**（GET /a/v1/ontology/object-types 与 /a/v1/ontology/type-semantics），
 *     经真链（合成种子 → 本体仓储 → REST 投影）拿到，不是读源码常量。
 *  ② 断言**诚实回落**：未登记中文名的属性响应里**没有** displayName 键（不是 null/""/"undefined"），
 *     下游据此回落 propKey。
 *  ③ 断言**单源收敛**：求解器杠杆标签（LEVER_PROP_META.label，形如「物料·到货周期」）的属性段
 *     === 同一属性的 displayName。同一属性不得存在两份中文名——改任一侧此断言即红。
 *     ⚠ 标签 = `类型简称` + `·` + `属性中文名`，分隔符是**第一个** "·" 而非最后一个：
 *     属性中文名自身可以含 "·"（`Equipment.oee_current` = 「OEE（综合·事实表7日均值）」，
 *     裁决 C 要求带口径标注），用 `lastIndexOf` 会把口径标注从中间切开，切出「事实表7日均值）」
 *     这种碎片，然后报一条与真相无关的红。类型简称（设备/产线/工序/物料/物料齐套/订单/换型/在途）
 *     里不含 "·"，所以第一个 "·" 就是分隔符。
 *  ④ 断言 propKey **零改**：接线名（求解器/规则/派生公式引用）必须原样保留，展示名是加法不是改名。
 */

const ONTOLOGY_TYPES = "/a/v1/ontology/object-types";

interface TypeRow { key: string; displayName: string; properties: PropertyDef[] }

async function fetchTypes(t: TestApp): Promise<TypeRow[]> {
  const res = await t.app.inject({ method: "GET", url: ONTOLOGY_TYPES, headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return res.json() as TypeRow[];
}

/**
 * 从杠杆标签里取**属性段**：`类型简称` + `·` + `属性中文名` ⇒ 第一个 "·" 之后全都是属性中文名。
 * ③ 与 ③b **共用这一份实现**（CLAUDE.md 铁律 0.6：门里的金丝雀不许与主逻辑各抄一份正则，
 * 抄了就是装饰品 —— 改主逻辑时另一处拿旧的去测、照样绿）。
 */
function propSegOf(label: string): string {
  const i = label.indexOf("·");
  return i >= 0 ? label.slice(i + 1) : label;
}

function propOf(types: TypeRow[], typeKey: string, propKey: string): PropertyDef {
  const t = types.find((x) => x.key === typeKey);
  expect(t, `本体应含对象类型 ${typeKey}`).toBeTruthy();
  const p = t!.properties.find((x) => x.propKey === propKey);
  expect(p, `${typeKey} 应含属性 ${propKey}`).toBeTruthy();
  return p!;
}

describe("WO-SCHEMA-ZH · 属性中文业务名经接口真下发（SEAM）", () => {
  it("① GET /a/v1/ontology/object-types 响应里带 displayName（用户原话点名的 Material.leadTime 等）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // 用户原话："把截屏里面非必要的英文词汇调整为中文，比如 Material.leadTime"
    expect(propOf(types, "Material", "leadTime").displayName).toBe("到货周期");
    expect(propOf(types, "Process", "yield_baseline").displayName).toBe("良率基线");

    // Equipment.oee_current 的中文名**不在这里写死第三份**：它的值归仓主裁决 C（WO-OEE-UNIFY）管，
    // 口径标注由 `oee-ssot.seam.test.ts` S5 咬（必须含「综合」「事实表7日均值」）。此处只咬本条要咬的
    // 那件事 —— **接口下发的就是 PROP_DISPLAY_NAMES 那一份**（表 → REST 这条缝）。
    // 原写死 `toBe("OEE")` 是裁决 C 之前的期望，裁决落地后成了陈述过期的断言，红了三周（本单修的就是它）。
    const oeeZh = propOf(types, "Equipment", "oee_current").displayName;
    expect(oeeZh, "OEE 中文名没经接口下发 / 与单源表不一致").toBe(PROP_DISPLAY_NAMES["Equipment.oee_current"]);
    // 金丝雀：表里那条被整个删掉时，上一行会两边同为 undefined 而**空过**——这一行不让它空过。
    expect(oeeZh, "OEE 应形如「OEE（口径…）」：主名 + 括号口径标注").toMatch(/^OEE（.+）$/);
    // 「系统所有类似的数字，需要配套它的意义」：中文名与既有 unit 并存，两者都在同一条响应里。
    const util = propOf(types, "Base", "util");
    expect(util.displayName).toBe("产能利用率");
    expect(util.unit).toBe("%");
  });

  it("② 诚实回落：未登记中文名的属性**不带** displayName 键（不是 null/空串），下游回落 propKey", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // Base.position 与 Base.kind 同值（生成处 `position: b.kind`），业务语义待确认 → 故意留白。
    const pos = propOf(types, "Base", "position");
    expect(propDisplayName("Base", "position"), "留白项不得偷偷登记").toBeUndefined();
    expect("displayName" in pos, "留白应表现为键缺失，不是 null/空串").toBe(false);

    // Material.devPct 无消费方、口径不明 → 同样留白（宁可让界面显裸键，也不臆造中文名）。
    expect("displayName" in propOf(types, "Material", "devPct")).toBe(false);

    // 全局：不允许任何属性带空串/空白 displayName（"编个空的"比留白更坏）。
    for (const ty of types) {
      for (const p of ty.properties ?? []) {
        if (p.displayName !== undefined) {
          expect(typeof p.displayName, `${ty.key}.${p.propKey}`).toBe("string");
          expect(p.displayName.trim(), `${ty.key}.${p.propKey} 不得为空白中文名`).not.toBe("");
        }
      }
    }
  });

  it("③ 单源收敛：求解器杠杆标签「类型·属性」的属性段 === PropertyDef.displayName（同属性只有一份中文名）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 走 capacity 金字塔反推（grain 分支）——杠杆标签 factor 即由 LEVER_PROP_META 下发。
    const cap = await invokeSolver(t, "capacity_forecast", { modelId: "2170-NCM", granularity: "process-model" });
    expect(cap.statusCode).toBe(200);
    const rows = (cap.json() as { data: { byProcessModel?: { process: string }[] } }).data.byProcessModel ?? [];
    expect(rows.length, "应有工序×型号颗粒行").toBeGreaterThan(0);
    const res = await invokeSolver(t, "generic_inference", {
      mode: "levers", grain: "process-model", modelId: "2170-NCM", processKey: rows[0]!.process,
    });
    expect(res.statusCode).toBe(200);
    const levers = (res.json() as { data: { levers: { objectType: string; prop: string; factor?: string }[] } }).data.levers;
    expect(levers.length, "应能反推出杠杆").toBeGreaterThan(0);

    let checked = 0;
    for (const l of levers) {
      const zh = propDisplayName(l.objectType, l.prop);
      if (!zh || !l.factor || !l.factor.includes("·")) continue;
      // 杠杆标签 = 类型简称 + "·" + 属性中文名；属性段必须与本体 displayName 逐字一致。
      // 用**第一个** "·" 切（见抬头 ③ 的说明：属性中文名自身可含 "·"）。
      expect(propSegOf(l.factor), `${l.objectType}.${l.prop} 杠杆标签与本体展示名分叉`).toBe(zh);
      checked++;
    }
    expect(checked, "至少应覆盖到一个既有杠杆标签又有 displayName 的属性").toBeGreaterThan(0);
  });

  /**
   * ③b 单源收敛 · **静态穷举**（审核方补强 —— ③ 的运行时版本覆盖不全，实测漏过一处）。
   *
   * ③ 只检查「某一个场景（2170-NCM × rows[0].process）运行时恰好反推出来的杠杆」，
   * 且收口断言是 `checked > 0` —— **覆盖到一个就算数**。变异反证当场打穿：
   * 把 `LEVER_PROP_META["Line.utilization"].label` 从「产线·利用率」改成「产线·产能利用比」
   * （= 同一属性出现两份中文名，正是 ③ 声称要防的），③ **照绿**；
   * 换成 `Process.yield_baseline` 才红。也就是说 ③ 的判别力取决于跑到了哪几个杠杆，
   * 而两表交集有 10 个属性 —— 剩下的分叉可以一路溜进正线。
   *
   * 本条改为**静态穷举两表交集**：不跑求解器、不依赖种子与场景，逐个比对
   * `LEVER_PROP_META[k].label` 的属性段 === `PROP_DISPLAY_NAMES[k]`。
   * 更强、更快、且 R6 确定性（无运行期分支）。③ 保留 —— 它证的是**经真链下发**这件事，
   * 与本条的**穷举一致性**互补，不重复。
   *
   * ── 2026-08-22 · WO-FIX-SCHEMA-DISPLAY-NAME 之后本条还剩什么牙 ──────────────
   * `lever-meta.ts` 已改成**从 `PROP_DISPLAY_NAMES` 现取**属性中文名（不再各存一份整串），
   * 所以在当前实现下本条必绿。**这不代表它变成了装饰品** —— 它咬的是"分叉"这个形态本身：
   * 谁把某一行的 `label` 改回写死的整串（回归到旧机制，或图省事直接改标签不改本体展示名），
   * 本条当场红并点名那个属性。本单交付前已按此做过变异反证（把 `Equipment.oee_current`
   * 的标签写死回「设备·OEE」→ 本条红、点名该属性）。
   * 判据一句话：**本条不是在验"两份表抄得一样"，是在验"屏上同一属性只有一个中文名"** ——
   * 后者才是用户会看到的东西，实现换成派生只是让它更难被违反，不是让它无须再验。
   */
  it("③b 单源收敛（静态穷举）：LEVER_PROP_META 与 PROP_DISPLAY_NAMES 的每一个交集属性都必须同名", () => {
    const both = Object.keys(LEVER_PROP_META).filter((k) => PROP_DISPLAY_NAMES[k] !== undefined);
    expect(both.length, "两表交集为空 —— 解析失锚，勿让本条空跑通过").toBeGreaterThan(5);
    const diverged: string[] = [];
    for (const k of both) {
      const label = LEVER_PROP_META[k]!.label;
      const zh = PROP_DISPLAY_NAMES[k]!;
      const seg = propSegOf(label); // 与 ③ 共用（第一个 "·" 切，见抬头）
      if (seg !== zh) diverged.push(`${k}: 杠杆标签「${label}」→「${seg}」 ≠ 本体展示名「${zh}」`);
    }
    expect(diverged, `同一属性出现两份中文名（改任一侧都必须同步改另一侧）：\n${diverged.join("\n")}`).toEqual([]);
  });

  it("④ propKey 零改 + 展示名表键形合法：只加展示层，不动接线名", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // 接线名原样（求解器 / 规则 DSL / 派生公式 / golden 都引用这些串）。
    for (const [typeKey, propKey] of [
      ["Material", "leadTime"], ["Material", "onHand"], ["Equipment", "oee_current"],
      ["Process", "yield_baseline"], ["Line", "utilization"], ["Order", "outsourceRatio"],
    ] as const) {
      expect(propOf(types, typeKey, propKey).propKey).toBe(propKey);
    }

    // 表里每个键都得对上真属性（防拼错类型/属性名导致"登记了但永不生效"的假绿）。
    const known = new Map(types.map((ty) => [ty.key, new Set((ty.properties ?? []).map((p) => p.propKey))]));
    const orphans = Object.keys(PROP_DISPLAY_NAMES).filter((k) => {
      const i = k.indexOf(".");
      const [ty, prop] = [k.slice(0, i), k.slice(i + 1)];
      const props = known.get(ty);
      return props !== undefined && !props.has(prop); // 类型未种进本租户则不判（合成子集不含）
    });
    expect(orphans, "PROP_DISPLAY_NAMES 有键指向不存在的属性").toEqual([]);
  });

  it("⑤ type-semantics（喂 B 侧 LLM 的口径投影）同样带中文名，缺则整键不下发", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/type-semantics?types=Material,Base", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { types: { typeKey: string; props: { propKey: string; displayName?: string }[] }[] };
    const mat = body.types.find((x) => x.typeKey === "Material");
    expect(mat?.props.find((p) => p.propKey === "leadTime")?.displayName).toBe("到货周期");
    const pos = body.types.find((x) => x.typeKey === "Base")?.props.find((p) => p.propKey === "position");
    expect(pos, "Base.position 应在投影里").toBeTruthy();
    expect("displayName" in pos!, "留白项在 B 侧也表现为键缺失").toBe(false);
  });
});
