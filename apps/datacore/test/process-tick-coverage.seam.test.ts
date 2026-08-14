import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules, seedDemoProcessLayer } from "../src/seed.js";

/**
 * WO-PROCESS-TICK-COVERAGE · **接缝门**：推演沙盘第五档「流程画布」的节拍覆盖面
 * （守 §8 `G-PROCESS-TICK-COVERAGE`）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 这道门为什么不能写成「规则条数变多了」
 * ══════════════════════════════════════════════════════════════════════════════
 * 「35 条规则」度量的是**种子数量**，不度量「这些流程的读数会不会动」。
 * 本仓已经栽过一次同形态的（#158：种子写了、方向反了、恒不触发、全绿很久）。
 * 所以本门的头号判据是**效果层**：
 *
 *   > 推一拍 ⇒ **新点亮的那些流程，屏上读数真的变了**；
 *   > 而判为「本层不随节拍变」的那些，推多少拍都**真的没动**。
 *
 * 两句缺一不可。只断言前者，一个「把所有类型都标成随节拍变」的实现照样全绿；
 * 只断言后者，一个「谁都不动」的实现照样全绿。
 *
 * ── 「读数」的口径 = 前端第五档那一份（`views/sim/processCanvas.ts`）─────────────
 * 站上的读数 = **该承载类型全部对象、全部状态变量的平均值**（取平均不取和，是因为
 * 不同类型的对象数差两个数量级，求和会让「圈更大」只反映「对象更多」）。
 * 这里**照抄口径、不照抄实现**：前端读的是它自己那份视图模型，本门读的是
 * **引擎 tick 回包的真 state**。两边算出同一个方向的结论才叫接缝通。
 *
 * ── 三档判据（与前端 `classifyTickDrive` 同一套，**结构性**结论）────────────────
 * | 档 | 判据 | 定性 |
 * |---|---|---|
 * | `TICK_DRIVEN`        | carrier ∈ 规则两端类型 **且** 该类型有物化对象 | 推 tick 它真会动 |
 * | `NO_CARRIER_OBJECTS` | carrier ∈ 规则两端类型，但 0 个物化对象 | 接了线没数据 |
 * | `NOT_TICK_DRIVEN`    | carrier ∉ 规则两端类型 | 没接线：引擎结构上写不到它 |
 * 结构性的根据：`sim/propagation.ts propagateTick` 唯一的写法是
 * `next[targetObjectId][targetStateVar] = …`，`targetObjectId` 只能来自规则的
 * `targetTypeKey` 那一端 ⇒ 不在两端集合里的类型**不可能变**，不是"今天恰好没变"。
 *
 * ── ⚠ 本门**如实亮出**的诚实缺席（不许被绿色盖住）─────────────────────────────
 * ① `NO_CARRIER_OBJECTS` 这一档在真世界里**现为 0 条**。
 *    不能因此说"这一档没用" —— 它照样必须**说得出话**，否则一个只会返回两档的
 *    实现同样能让本文件全绿。故 §A3 用构造输入逼它开口（金丝雀，不是真数据）。
 * ② 分档判据取的是「source **或** target 两端」，而**只当 source 的类型读数永远不会变**
 *    （没有任何规则写它）。档 1/2 交付时本世界里确有一个（`Supplier`/P28），
 *    **档 3 已把它闭掉**（`demo_po_expedite_to_supplier_review` 真写 `Supplier.reviewPressure`）。
 *    §C4 因此从「登记这处缺席」翻转成**守住它不再复发**：`sourceOnly` 必须恒为空 ——
 *    将来谁再补一条只读不写的类型进来，机器当场红，而不是等人去屏上发现"标着会动却不动"。
 */

const SEED_PATH = fileURLToPath(new URL("../src/seed.ts", import.meta.url));

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

type Drive = "TICK_DRIVEN" | "NO_CARRIER_OBJECTS" | "NOT_TICK_DRIVEN";

/** 与前端 `classifyTickDrive` 同一套判据（**本门唯一一支实现**，金丝雀与主逻辑共用它）。 */
function classify(carrierTypeKey: string, ruleTypeKeys: ReadonlySet<string>, carrierObjectCount: number): Drive {
  if (!ruleTypeKeys.has(carrierTypeKey)) return "NOT_TICK_DRIVEN";
  return carrierObjectCount > 0 ? "TICK_DRIVEN" : "NO_CARRIER_OBJECTS";
}

/**
 * 从**种子源码**抽 `DEMO_PROPAGATION_RULES` 的字段。
 *
 * ⚠ 这支抽取器是**为了给运行态当独立第二证人**用的（源码写了几条 vs 库里真有几条），
 * 不是为了省事。它自己就骗过人一次：上一单的整体正则要求
 * `sourceTypeKey→sourceStateVar→viaLinkKey→targetTypeKey→targetStateVar` 五行连续，
 * 而种子里多条规则的 `viaLinkKey` 行尾带 `// 实测 …` 注释 ⇒ 只抽到 5/13，
 * **而当时的金丝雀只验「抽到了一条」（存在性）⇒ 照样绿**。
 * 形态：「我用『抽到了一条』当作『抽全了』的证据，而前者并不度量后者。」
 * 机制：金丝雀改成**恒等式** —— 抽出条数 === 原文 `^\s*sourceTypeKey:` 行数，
 * 不等即报「**工具坏了**」，不许报覆盖率（铁律 0.6）。
 */
function extractSeedRules(src: string): { keys: string[]; via: string[]; endpoints: string[]; declaredRows: number } {
  const start = src.indexOf("const DEMO_PROPAGATION_RULES");
  const end = src.indexOf("export async function seedDemoPropagationRules");
  if (start < 0 || end < 0 || end <= start) throw new Error("工具坏了：seed.ts 里找不到 DEMO_PROPAGATION_RULES 的锚点");
  const block = src.slice(start, end);
  const grab = (re: RegExp) => [...block.matchAll(re)].map((m) => m[1]!);
  return {
    keys: grab(/^\s*key: "([A-Za-z0-9_]+)"/gm),
    via: grab(/^\s*viaLinkKey: "([A-Za-z0-9_]+)"/gm),
    endpoints: grab(/^\s*(?:source|target)TypeKey: "([A-Za-z0-9_]+)"/gm),
    declaredRows: (block.match(/^\s*sourceTypeKey: "/gm) ?? []).length,
  };
}

/** 同上，抽 65 条流程定义的承载物。恒等式金丝雀：抽出条数 === `{ key: "P##"` 行数。 */
function extractSeedCarriers(src: string): { carriers: string[]; declaredRows: number } {
  const start = src.indexOf("const DEMO_PROCESS_DEFINITIONS");
  const end = src.indexOf("export async function seedDemoProcessLayer");
  if (start < 0 || end < 0 || end <= start) throw new Error("工具坏了：seed.ts 里找不到 DEMO_PROCESS_DEFINITIONS 的锚点");
  const block = src.slice(start, end);
  return {
    carriers: [...block.matchAll(/carrierTypeKey: "([A-Za-z0-9_]+)"/g)].map((m) => m[1]!),
    declaredRows: (block.match(/^\s*\{ key: "P\d+"/gm) ?? []).length,
  };
}

/** 一个世界的三档现算结果（全部来自**真路由下发的数据**，零字面量名单）。 */
interface Trichotomy {
  byKey: Map<string, { domainKey: string; carrier: string; drive: Drive }>;
  driven: string[];
  noData: string[];
  dark: string[];
  ruleEndpointTypes: Set<string>;
  objectIdsByType: Map<string, string[]>;
}

async function trichotomy(t: Awaited<ReturnType<typeof makeApp>>): Promise<Trichotomy> {
  const defs = (await (await t.app.inject({ method: "GET", url: "/a/v1/process-definitions", headers: ADMIN })).json()) as {
    definitions: { key: string; domainKey: string; carrierTypeKey: string }[];
  };
  const rules = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()).items as {
    sourceTypeKey: string; targetTypeKey: string;
  }[];
  const cfg = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as {
    nodeObjectIds: Record<string, string[]>;
  };
  const ruleEndpointTypes = new Set(rules.flatMap((r) => [r.sourceTypeKey, r.targetTypeKey]));
  const objectIdsByType = new Map(Object.entries(cfg.nodeObjectIds));
  const byKey = new Map<string, { domainKey: string; carrier: string; drive: Drive }>();
  for (const d of defs.definitions) {
    byKey.set(d.key, {
      domainKey: d.domainKey,
      carrier: d.carrierTypeKey,
      drive: classify(d.carrierTypeKey, ruleEndpointTypes, (objectIdsByType.get(d.carrierTypeKey) ?? []).length),
    });
  }
  const pick = (v: Drive) => [...byKey.entries()].filter(([, x]) => x.drive === v).map(([k]) => k).sort();
  return {
    byKey,
    driven: pick("TICK_DRIVEN"),
    noData: pick("NO_CARRIER_OBJECTS"),
    dark: pick("NOT_TICK_DRIVEN"),
    ruleEndpointTypes,
    objectIdsByType,
  };
}

/** 站上读数（口径同前端）：该类型全部对象、全部状态变量的**平均值**。无对象 ⇒ null。 */
function reading(state: Record<string, Record<string, number>>, ids: readonly string[]): number | null {
  if (ids.length === 0) return null;
  let sum = 0;
  for (const id of ids) for (const v of Object.values(state[id] ?? {})) sum += v;
  return sum / ids.length;
}

describe("WO-PROCESS-TICK-COVERAGE · 第五档流程画布的节拍覆盖面（SEAM·守 G-PROCESS-TICK-COVERAGE）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // §A 金丝雀先说话 —— 报任何「零命中 / 这一档为空」之前，先自证工具是好的
  // ══════════════════════════════════════════════════════════════════════════
  it("§A1 🐤 恒等式金丝雀：种子抽取器抽全了（抽出条数 === 原文声明行数），不等即『工具坏了』", () => {
    const src = readFileSync(SEED_PATH, "utf8");
    const r = extractSeedRules(src);
    const c = extractSeedCarriers(src);
    // 🔴 恒等式，不是存在性。「抽到了一条」证明不了「抽全了」——上一单正是栽在这一句上。
    expect(r.declaredRows).toBeGreaterThan(0); // 先证明"原文里真有东西"，否则 0===0 恒真
    expect(r.keys.length).toBe(r.declaredRows);
    expect(r.via.length).toBe(r.declaredRows);
    expect(r.endpoints.length).toBe(r.declaredRows * 2); // 每条规则恰好一个 source + 一个 target
    expect(c.declaredRows).toBe(65);
    expect(c.carriers.length).toBe(c.declaredRows);
  });

  it("§A2 🐤 变异反证：把 viaLinkKey 行尾加注释（上一单的原坑），恒等式金丝雀必须仍然抓得住", () => {
    const src = readFileSync(SEED_PATH, "utf8");
    const before = extractSeedRules(src);
    // 上一单的真实形态：行尾带 `// 实测 …` 注释 —— 逐字段抽不受影响，整体多行正则会漏。
    const mutated = src.replace(/^(\s*viaLinkKey: "[A-Za-z0-9_]+",)(\s*\/\/[^\n]*)?$/gm, "$1 // 变异反证：行尾注释");
    expect(mutated).not.toBe(src); // 变异必须真的发生（本仓踩过 sed/replace 静默 no-op）
    const after = extractSeedRules(mutated);
    expect(after.via.length).toBe(after.declaredRows); // 恒等式仍成立 ⇒ 逐字段抽是对的
    expect(after.via).toEqual(before.via);
  });

  it("§A3 🐤 分档函数三档都说得出话（一个恒返回某一档的实现必须在这里就红）", () => {
    const rules = new Set(["CanaryType"]);
    expect(classify("CanaryType", rules, 3)).toBe("TICK_DRIVEN");
    expect(classify("CanaryType", rules, 0)).toBe("NO_CARRIER_OBJECTS"); // 真世界里现为 0 条，故必须在这里逼它开口
    expect(classify("NotInGraph", rules, 3)).toBe("NOT_TICK_DRIVEN");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §B 三档现算（真路由下发的数据 × 真种子世界）
  // ══════════════════════════════════════════════════════════════════════════
  it("§B1 🔴 覆盖率现算：29/65 随节拍变 · 0 无承载对象 · 36 本层不随节拍变（三档合计 = 65）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoProcessLayer(t.repos);
    await enableSim(t);

    const tri = await trichotomy(t);
    expect(tri.byKey.size).toBe(65); // 先证明"确实拿到了 65 条"，否则下面的计数都在数空气
    expect(tri.driven.length + tri.noData.length + tri.dark.length).toBe(65);

    // 🔴 本单的量化交付面：9/65（13.8%）→ 29/65（44.6%）。
    expect(tri.driven.length).toBe(29);
    expect(tri.dark.length).toBe(36);
    // 诚实缺席：这一档真世界里为 0 条 —— §A3 已单独逼分档函数为它开过口。
    expect(tri.noData).toEqual([]);

    // 逐条列出来：哪条被点亮是可核对的事实，不是一个总数。
    expect(tri.driven).toEqual([
      "P15", "P16", "P17", "P18", "P19", // D03 销售与客户（客户/收货地点/订单/订单行/交期承诺）
      "P22",                              // D04 产品与工程（型号）
      "P28", "P31", "P32", "P33", "P34", "P35", "P36", // D05 采购与供应
      "P38", "P41",                       // D06 计划与排产（产能复核/跨基地调拨）
      "P42", "P43", "P45",                // D07 生产制造（工单/在制/换型）
      "P47", "P48", "P49",                // D08 质量管理（质检批/缺陷/异常）
      "P50", "P51",                       // D09 设备与维护（检修窗/维修派工）
      "P54", "P55", "P56", "P57",         // D10 基地与仓储交付
      "P59", "P60",                       // D11 财务与成本（应收/催收）
    ]);
  }, 120000);

  it("§B2 🔴 反面判据（红线 1）：D01 经营规划 与 D02 外部信号**整域**必须是「本层不随节拍变」", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoProcessLayer(t.repos);
    await enableSim(t);
    const tri = await trichotomy(t);

    // 派单原话：「年度场景 / KSF / 竞对价格这类本来就不随节拍变 —— 强行让它们跟着 tick 抖动就是造假」。
    // ⇒ 覆盖率**不是越高越好**。这条断言的作用是：谁将来为了把数字做漂亮而给这两域造边，机器当场红。
    const d01d02 = [...tri.byKey.entries()].filter(([, v]) => v.domainKey === "D01" || v.domainKey === "D02");
    expect(d01d02.length).toBe(11); // 先证明这两域真有 11 条（否则"全都不随节拍变"是因为一条都没数到）
    expect(d01d02.filter(([, v]) => v.drive !== "NOT_TICK_DRIVEN").map(([k]) => k)).toEqual([]);

    // 同一条判据的正面：真正的执行域必须**不是**整域全黑（否则上面那条靠"全世界都黑"也能绿）。
    for (const dom of ["D03", "D05", "D07", "D08", "D09", "D10"]) {
      const rows = [...tri.byKey.entries()].filter(([, v]) => v.domainKey === dom);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some(([, v]) => v.drive === "TICK_DRIVEN")).toBe(true);
    }
  }, 120000);

  // ══════════════════════════════════════════════════════════════════════════
  // §C 接缝：推真拍 ⇒ 读数真的变（这一节才是本门的头号判据）
  // ══════════════════════════════════════════════════════════════════════════
  it("§C 🔴 接缝：真 tick ⇒ 29 个点亮承载物读数**全部**真变 · 36 条黑档读数**真的一动不动**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoProcessLayer(t.repos);
    await enableSim(t);
    const tri = await trichotomy(t);

    // ── 只在**三个源头量纲**上施加初值，其余一律靠传导自己走到 ──────────────────
    // 三个源都是「没有任何规则写它」的纯源（deliveryDelay / demandPressure / priceShock），
    // 所以下面任何一个非源类型的读数变了，都只可能是**传导走过去的**，不可能是我们塞的。
    const idsOf = (type: string) => tri.objectIdsByType.get(type) ?? [];
    const baseSnapshot: Record<string, Record<string, number>> = {};
    for (const id of idsOf("Supplier")) baseSnapshot[id] = { deliveryDelay: 10 };
    for (const id of idsOf("Order")) baseSnapshot[id] = { demandPressure: 10 };
    for (const id of idsOf("Material")) baseSnapshot[id] = { priceShock: 5 };
    expect(Object.keys(baseSnapshot).length).toBeGreaterThan(0); // 别在空世界上测

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot },
    })).json()).id as string;

    // 12 拍：最深的一条链是 Order→Model→Base→Line→WorkOrder→WIPLot→DefectRecord→ExceptionEvent，
    // 中间还夹着两处 delayTicks=1，加上「产出落在 tick+1」这一格，7 拍才到底；12 拍留足余量。
    const tickRes = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 12 } });
    expect(tickRes.statusCode).toBe(200);
    const after = (tickRes.json() as { state: Record<string, Record<string, number>> }).state;
    const before = baseSnapshot;

    // ── C1 三个源头类型之外，**每一个** TICK_DRIVEN 承载物的读数都必须从 0 变成非 0 ──
    // 断言的是「这条链真的通到了它」，不是「它有一条规则」。
    const SOURCE_SEEDED = new Set(["Supplier", "Order", "Material"]);
    const drivenCarriers = [...new Set(tri.driven.map((k) => tri.byKey.get(k)!.carrier))];
    const stillZero: string[] = [];
    for (const carrier of drivenCarriers) {
      if (SOURCE_SEEDED.has(carrier)) continue;
      const ids = idsOf(carrier);
      expect(reading(before, ids)).toBe(0); // 起点必须真是 0，否则"变了"是废话
      if ((reading(after, ids) ?? 0) === 0) stillZero.push(carrier);
    }
    expect(stillZero).toEqual([]);

    // ── C2 三个被塞了初值的源头类型：也必须**变**（不是"起点就非 0"蒙混过去）──
    // 三个都是下游规则的 target：Order（订单缺口/成本）· Material（物料短缺）·
    // Supplier（档 3 新增的绩效复评压力 —— 在此之前它只当 source，读数恒定，见 §C4）。
    for (const carrier of ["Order", "Material", "Supplier"]) {
      const ids = idsOf(carrier);
      expect(reading(before, ids)).not.toBe(reading(after, ids));
    }

    // ── C3 反面判据：36 条「本层不随节拍变」推 12 拍后读数**必须仍然精确为 0** ──
    // 这条是结构性结论的实证：propagateTick 只写规则 target 那一端，够不着的类型不可能变。
    const darkCarriers = [...new Set(tri.dark.map((k) => tri.byKey.get(k)!.carrier))];
    expect(darkCarriers.length).toBeGreaterThan(0);
    const movedInDark: string[] = [];
    for (const carrier of darkCarriers) {
      const ids = idsOf(carrier);
      if (ids.length === 0) continue; // 0 对象 ⇒ 读数 null，这里不是它的判据
      if ((reading(after, ids) ?? 0) !== 0) movedInDark.push(carrier);
    }
    expect(movedInDark).toEqual([]);
    // 并且这两组**交集为空**（防"把所有类型都塞进 driven"这种作弊让 C1/C3 同时绿）。
    expect(drivenCarriers.filter((c) => darkCarriers.includes(c))).toEqual([]);

    // ── C4 🔴 「标着会动、其实不动」必须一条都不剩（档 3 闭掉的那处缺席的**复发闸**）──
    // 分档判据取「source **或** target 两端」，所以**只当 source 的类型**会被标成「随节拍变」，
    // 而它的读数推多少拍都是同一个数 —— 没有任何规则写它。档 1/2 交付时本世界确有一个：
    // `Supplier`（P28 供应商准入与评估）。档 3 给它补了真正写它的规则
    // （`demo_po_expedite_to_supplier_review`：采购单反复加急 ⇒ 供应商绩效复评压力）。
    //
    // 判据从「登记它」翻转成「守住它」：`sourceOnly` 恒为空。将来谁再补一条**只读不写**的
    // 类型进来（哪怕规则条数涨了、屏上多一个点"亮着"），机器在这里当场红 ——
    // 而不是等人去屏上发现「标着会动却推多少拍都不动」。
    // 🔴 这一条与 C1 度量的**不是同一件事**：C1 问「这个类型的读数变了吗」（只覆盖 driven 名单），
    //    C4 问「规则图上有没有只出不进的类型」（结构性，覆盖所有端点类型）。分开写，别合并。
    const rules = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()).items as {
      sourceTypeKey: string; targetTypeKey: string;
    }[];
    const targets = new Set(rules.map((r) => r.targetTypeKey));
    expect(tri.ruleEndpointTypes.size).toBeGreaterThan(0); // 先证明真拿到了端点集，否则空集恒过
    const sourceOnly = [...tri.ruleEndpointTypes].filter((k) => !targets.has(k)).sort();
    expect(sourceOnly).toEqual([]);
    // 并且 Supplier 这一条**真的在动**（光有规则不算数 —— 那正是"条数不度量链路通不通"）。
    expect(reading(before, idsOf("Supplier"))).not.toBe(reading(after, idsOf("Supplier")));
  }, 180000);

  // ══════════════════════════════════════════════════════════════════════════
  // §D 变异反证 —— 证明 §C 咬的是「链通不通」，不是「规则条数」
  // ══════════════════════════════════════════════════════════════════════════
  it("§D 🔴 变异反证：抽掉执行链头一条边的**实例**（Line→WorkOrder），D07 那一串必须整条塌掉", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoProcessLayer(t.repos);
    await enableSim(t);
    const tri = await trichotomy(t);
    const idsOf = (type: string) => tri.objectIdsByType.get(type) ?? [];

    // 变异：删掉 `line_runs_work_order` 的全部实例（规则一条不动、条数一条不少）。
    // 若本门咬的是"规则条数"，这一步不会有任何影响 —— 那就说明门是装饰品。
    const doomed = await t.repos.links.list("demo", (l) => l.type === "line_runs_work_order");
    expect(doomed.length).toBeGreaterThan(0); // 变异必须真的有东西可删
    for (const l of doomed) await t.repos.links.remove("demo", l.id);
    expect((await t.repos.links.list("demo", (l) => l.type === "line_runs_work_order")).length).toBe(0);
    // 规则条数**没变** —— 这正是"条数不度量链路通不通"的当场证据。
    expect((await t.repos.sim.listPropagationRules("demo", true)).length).toBe(35);

    const baseSnapshot: Record<string, Record<string, number>> = {};
    for (const id of idsOf("Order")) baseSnapshot[id] = { demandPressure: 10 };
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot },
    })).json()).id as string;
    const after = ((await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 12 },
    })).json() as { state: Record<string, Record<string, number>> }).state;

    // 断掉这一条 ⇒ 它下游整串（工单/在制/质检批/缺陷/异常）全部读不到数。
    for (const carrier of ["WorkOrder", "WIPLot", "QualityLot", "DefectRecord", "ExceptionEvent"]) {
      expect({ carrier, r: reading(after, idsOf(carrier)) }).toEqual({ carrier, r: 0 });
    }
    // 而**不在这条链上**的那些照常亮（证明变异是定点的，不是把整个引擎打死了）。
    for (const carrier of ["Line", "Process", "ChangeoverMatrix", "OrderLine"]) {
      expect(reading(after, idsOf(carrier))).not.toBe(0);
    }
  }, 180000);
});
