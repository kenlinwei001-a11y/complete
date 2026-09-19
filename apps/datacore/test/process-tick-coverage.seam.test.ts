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
 * ── 四档判据（与前端 `classifyTickDrive` 同一套，**结构性**结论）────────────────
 * | 档 | 判据 | 定性 |
 * |---|---|---|
 * | `TICK_DRIVEN`        | carrier ∈ 规则 **target** 端 **且** 该类型有物化对象 | 推 tick 它真会动 |
 * | `NO_CARRIER_OBJECTS` | carrier ∈ 规则 **target** 端，但 0 个物化对象 | 接了线没数据 |
 * | `SOURCE_ONLY`        | carrier ∈ 规则两端，但**只在 source 端**（入度 0） | 只当源：推得动别人，自己不动 |
 * | `NOT_TICK_DRIVEN`    | carrier ∉ 规则两端类型 | 没接线：引擎结构上够不着它 |
 * 结构性的根据：`sim/propagation.ts propagateTick` 唯一的写法是
 * `next[targetObjectId][targetStateVar] = …`，`targetObjectId` 只能来自规则的
 * `targetTypeKey` 那一端 ⇒ **不在 target 集合里的类型不可能变**，不是"今天恰好没变"。
 *
 * ── 🔴 2026-09-19：判据从「∈ 两端」改成「∈ target 端」（原判据是错的）────────────
 * **形态（铁律 0.6 句式）**：
 * > 「我用『它出现在某条规则的两端』当作『它会动』的证据，而前者并不度量后者
 * > —— 出现在**源**端只说明它能推动别人，不说明它自己会动。」
 * ⚠ **本门自己也写着正确的根据（上一段「只能来自 targetTypeKey 那一端」），而判据写的是两端**
 *   —— 注释与代码各说各的，谁都没红。这就是为什么本门**刻意不 import 生产那份实现**：
 *   两边各写一份、同一套判据，错了才有第二个证人。
 *
 * ── ⚠ 本门**如实亮出**的诚实缺席（不许被绿色盖住）─────────────────────────────
 * ① `NO_CARRIER_OBJECTS` 与 `SOURCE_ONLY` 这两档在真世界里**现为 0 条流程**。
 *    不能因此说"这两档没用" —— 它们照样必须**说得出话**，否则一个只会返回两档的
 *    实现同样能让本文件全绿。故 §A3 用构造输入逼它们开口（金丝雀，不是真数据）。
 * ② **类型级**的「只当源」今天有一个：`Equipment`（`WO-PROP-REVIEW-V2 ㉜` 方向反向之后
 *    入度归 0；仓主裁决保留 ㉜，且实测本体里没有任何真实链路能写它）。
 *    但它**不是 65 条流程里任何一条的承载物** ⇒ 流程级 `SOURCE_ONLY` 仍为 0 条。
 *    §C4 因此钉死名单而不是断言空集：**再多一个只出不进的类型就红**。
 */

const SEED_PATH = fileURLToPath(new URL("../src/seed.ts", import.meta.url));

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

type Drive = "TICK_DRIVEN" | "NO_CARRIER_OBJECTS" | "SOURCE_ONLY" | "NOT_TICK_DRIVEN";

/**
 * 与前端 `classifyTickDrive` **同一套判据、各自一份实现**（**本门唯一一支**，金丝雀与主逻辑共用它）。
 *
 * ⛔ **刻意不 import 生产那份** —— 本门要当的是「第二个独立证人」。
 * import 过来就变成「自己证自己」：生产判据写错时门跟着一起错，照样全绿
 * （那正是 2026-09-19 这次要治的病：旧判据「∈ 两端」两边一样错，门陪着绿了一路）。
 *
 * ⚠ 判据 2026-09-19 订正：`TICK_DRIVEN` 要求 carrier 在规则的 **target** 端。
 * 只在 source 端 = 入度 0 = 没有任何规则写它 ⇒ 推拍它自己不动 ⇒ 落 `SOURCE_ONLY`。
 * 形态：「我用『它出现在某条规则的两端』当作『它会动』的证据，而前者并不度量后者。」
 */
function classify(
  carrierTypeKey: string,
  ruleTargetTypes: ReadonlySet<string>,
  ruleEndpointTypes: ReadonlySet<string>,
  carrierObjectCount: number,
): Drive {
  if (!ruleEndpointTypes.has(carrierTypeKey)) return "NOT_TICK_DRIVEN";
  if (!ruleTargetTypes.has(carrierTypeKey)) return "SOURCE_ONLY";
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
  /** 在图里、但只当源（入度 0）⇒ 推拍自己不动。2026-09-19 从 `driven` 里拆出来的那一档。 */
  sourceOnly: string[];
  dark: string[];
  ruleEndpointTypes: Set<string>;
  ruleTargetTypes: Set<string>;
  /** 规则的类型级有向边（source → target），供 §C1 做「从种子可达」的前向闭包。 */
  ruleEdges: { sourceTypeKey: string; targetTypeKey: string }[];
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
  // 「会不会动」只看 target 端（引擎唯一的写法是写到 target 那一端的对象上）。
  const ruleTargetTypes = new Set(rules.map((r) => r.targetTypeKey));
  const objectIdsByType = new Map(Object.entries(cfg.nodeObjectIds));
  const byKey = new Map<string, { domainKey: string; carrier: string; drive: Drive }>();
  for (const d of defs.definitions) {
    byKey.set(d.key, {
      domainKey: d.domainKey,
      carrier: d.carrierTypeKey,
      drive: classify(d.carrierTypeKey, ruleTargetTypes, ruleEndpointTypes, (objectIdsByType.get(d.carrierTypeKey) ?? []).length),
    });
  }
  const pick = (v: Drive) => [...byKey.entries()].filter(([, x]) => x.drive === v).map(([k]) => k).sort();
  return {
    byKey,
    driven: pick("TICK_DRIVEN"),
    noData: pick("NO_CARRIER_OBJECTS"),
    sourceOnly: pick("SOURCE_ONLY"),
    dark: pick("NOT_TICK_DRIVEN"),
    ruleEndpointTypes,
    ruleTargetTypes,
    ruleEdges: rules.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
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

  it("§A3 🐤 分档函数四档都说得出话（一个恒返回某一档的实现必须在这里就红）", () => {
    const targets = new Set(["CanaryType"]);
    const ends = new Set(["CanaryType", "CanarySourceOnly"]);
    expect(classify("CanaryType", targets, ends, 3)).toBe("TICK_DRIVEN");
    expect(classify("CanaryType", targets, ends, 0)).toBe("NO_CARRIER_OBJECTS"); // 真世界里现为 0 条，故必须在这里逼它开口
    // 2026-09-19 新拆的第四档：在两端集合里、但**不在 target 集合里** ⇒ 没人写它 ⇒ 自己不动。
    expect(classify("CanarySourceOnly", targets, ends, 3)).toBe("SOURCE_ONLY");
    expect(classify("NotInGraph", targets, ends, 3)).toBe("NOT_TICK_DRIVEN");
    // 🐤 判定序：只当源的类型**即便 0 对象**也必须落 SOURCE_ONLY，不许落 NO_CARRIER_OBJECTS
    //    （后者的语义是「补数据即动」—— 对一个没人写的类型来说那是假话）。
    expect(classify("CanarySourceOnly", targets, ends, 0)).toBe("SOURCE_ONLY");
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
    // 四档合计必须仍然 = 65（新拆出的 SOURCE_ONLY 必须进这个和，否则那一档的流程从总数里蒸发）
    expect(tri.driven.length + tri.noData.length + tri.sourceOnly.length + tri.dark.length).toBe(65);

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
    // 三个源里 `deliveryDelay` / `priceShock` 是「没有任何规则写它」的纯源，
    // 所以下面任何一个非源类型的读数变了，都只可能是**传导走过去的**，不可能是我们塞的。
    // ⚠ **2026-08-25 WO-SIM-ROOT-TRIAD 起，`demandPressure` 不再是纯源**（入度 0 → 1，
    //   被 `demo_forecast_bias_to_order_demand` 写 —— 有意的降级）。**本节的推理仍然成立，
    //   但理由换了、必须写明**：下面的 `baseSnapshot` 只给 Supplier/Order/Material 三类塞格子，
    //   写它的那条边的源 `Model.forecastBias` 在这个世界态里**根本没有那一格** ⇒ `readVar` 取 0
    //   ⇒ 零贡献。照旧说法读作"没人写 demandPressure"会得到一个今天已经不成立的前提。
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

    // ── C1 三个源头类型之外，**每一个从这三个种子够得到的** TICK_DRIVEN 承载物都必须从 0 变成非 0 ──
    // 断言的是「这条链真的通到了它」，不是「它有一条规则」。
    //
    // ⚠ **2026-09-19：这里必须按「从种子可达」筛，而不是拿整个 driven 名单**。
    //   原写法隐含了一个从没写出来的前提：「driven 名单里每一个都从这三个种子够得到」。
    //   ㉜ 方向反向（`Equipment.loadPressure → Process.queuePressure`）之后这个前提破了 ——
    //   `Equipment` 成了入度 0 的根，而 `MaintenanceOrder` 的**唯一**上游就是它
    //   ⇒ 只塞 Supplier/Order/Material 这三个种子，`MaintenanceOrder` 结构上就走不到。
    //   形态：「我用『它是某条规则的 target』当作『这三个种子推得动它』的证据，而前者并不度量后者。」
    //   ⛔ 这不是把期望放宽：够不到的那一组**逐条钉死在下面**，多一个就红。
    const SOURCE_SEEDED = new Set(["Supplier", "Order", "Material"]);
    // 从种子出发沿规则边（source → target）做前向可达闭包。
    const reachable = new Set(SOURCE_SEEDED);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of tri.ruleEdges) {
        if (reachable.has(r.sourceTypeKey) && !reachable.has(r.targetTypeKey)) {
          reachable.add(r.targetTypeKey);
          grew = true;
        }
      }
    }
    // 🐤 可达闭包非空且真的长过：至少要够到 Model（Order→Model 是第一跳），否则闭包算法坏了。
    expect(reachable.has("Model"), "可达闭包必须至少够到 Model；不够 ⇒ 闭包算坏了").toBe(true);

    const drivenCarriers = [...new Set(tri.driven.map((k) => tri.byKey.get(k)!.carrier))];
    const mustMove = drivenCarriers.filter((c) => !SOURCE_SEEDED.has(c) && reachable.has(c));
    const unreachable = drivenCarriers.filter((c) => !SOURCE_SEEDED.has(c) && !reachable.has(c)).sort();
    expect(mustMove.length, "可达的 driven 承载物不能为空，否则下面的断言在空跑").toBeGreaterThan(0);

    const stillZero: string[] = [];
    for (const carrier of mustMove) {
      const ids = idsOf(carrier);
      expect(reading(before, ids)).toBe(0); // 起点必须真是 0，否则"变了"是废话
      if ((reading(after, ids) ?? 0) === 0) stillZero.push(carrier);
    }
    expect(stillZero).toEqual([]);

    // 🔴 够不到的那一组**逐条钉死**：它们是 target（所以判 `TICK_DRIVEN` 没错 —— 用户直接扰动
    //    它们的上游根就会动），但**这三个种子推不动它们**。多出一个 ⇒ 又有一条链被从根上断开了，
    //    机器在这里当场红，而不是等人去屏上发现"标着会动却不动"。
    expect(unreachable).toEqual(["MaintenanceOrder"]);

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
    // 🔴 这一条与 C1 度量的**不是同一件事**：C1 问「这个类型的读数变了吗」（只覆盖 driven 名单），
    //    C4 问「规则图上有没有只出不进的类型」（结构性，覆盖所有端点类型）。分开写，别合并。
    //
    // ⚠ **2026-09-19：判据从「恒为空」改成「逐条钉死」**。
    //   `WO-PROP-REVIEW-V2 ㉜` 有意把 `Process.queuePressure → Equipment.loadPressure` 掉头成
    //   `Equipment.loadPressure → Process.queuePressure`（评审优先级 5），`Equipment` 因此**升格为根**
    //   （入度 0）。仓主裁决：**保留 ㉜ 反向**，且实测本体里**没有**任何一条真实链路能写 `Equipment`
    //   （6 条声明指向 Equipment 的链路：`process_uses_equipment` 正是 ㉜ 删掉的那条 ·
    //    `product_equip_capability` 源是静态主数据 · 另 4 条实例数为 0）。
    //   ⇒ 这是**已知且被接受的结构事实**，不是回归。故这里钉死名单而不是断言空集 ——
    //   **再多出一个只出不进的类型，照样当场红。**
    //   ⛔ 不许改回 `toEqual([])`（那是在要求补一条编出来的边），也⛔ 不许放宽成 `length <= 1`。
    expect(tri.ruleEndpointTypes.size).toBeGreaterThan(0); // 先证明真拿到了端点集，否则空集恒过
    const sourceOnly = [...tri.ruleEndpointTypes].filter((k) => !tri.ruleTargetTypes.has(k)).sort();
    expect(sourceOnly).toEqual(["Equipment"]);

    // 🔴 **把分档函数按在真数据上咬一次**（这一行就是判据本身的变异反证锚点）：
    //    真类型 `Equipment` + 真对象数，必须判 `SOURCE_ONLY`。
    //    判据若被改回「carrier ∈ 规则**两端** ⇒ TICK_DRIVEN」，这一行**当场红**。
    //    ⚠ 没有这一行，§C 咬不住判据本身 —— 因为 `Equipment` **不是任何一条流程的承载物**，
    //      判据改错在流程级（driven/dark 名单）上一个数都不动。这正是「门看起来在守、其实没守」的形态。
    expect(classify("Equipment", tri.ruleTargetTypes, tri.ruleEndpointTypes, idsOf("Equipment").length))
      .toBe("SOURCE_ONLY");
    // 正向金丝雀：`Process` 是 `demo_equipment_load_to_process_queue` 的 target ⇒ 必须仍判 TICK_DRIVEN。
    // （若改完之后**全部**落进 SOURCE_ONLY，说明判据写反了 —— 这一行会先红。）
    expect(classify("Process", tri.ruleTargetTypes, tri.ruleEndpointTypes, idsOf("Process").length))
      .toBe("TICK_DRIVEN");
    // ⚠ **类型级的「只当源」与流程级的 `SOURCE_ONLY` 档不是同一个数，别混**：
    //   `Equipment` 在规则图上确实只当源（上面那条），但它**不是 65 条流程里任何一条的承载物**
    //   （实测 `carrierTypeKey: "Equipment"` 命中 0）⇒ 屏上没有它的格子
    //   ⇒ 流程级 `SOURCE_ONLY` 这一档今天**恒为空**。
    //   这一档为空**不等于**它没用：§A3 已用构造输入逼分档函数为它开过口
    //   （一个永远说不出 `SOURCE_ONLY` 的实现在那里就红）。
    //   将来谁把某条流程的承载物改成一个只当源的类型，这一行会从 `[]` 变红。
    expect(tri.sourceOnly).toEqual([]);
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
    //
    // ⚠ 这一格原写死 `toBe(46)`，**三次随种子长而漂**（35 → 38 → 46 → 47）。最后一次是
    //   `0c759423` 有意补的对抗方还手边 `demo_customer_reaction_cut_order`（Customer
    //   --customer_places_order--> Order · PUBLISHED）。注释里早就写着判据是"删边前后同一个数"，
    //   而代码写的是"这个数是 46" —— **写死的字面量并不度量那句话**，于是每补一条种子就假红一次，
    //   把一道真门的注意力耗在改数字上。现按注释的原意**现取前后两次**：种子再长本条也不动，
    //   而"变异误伤了规则表"这件事照样当场红。
    const rulesBefore = (await t.repos.sim.listPropagationRules("demo", true)).length;
    expect(rulesBefore).toBeGreaterThan(0); // 金丝雀：别在空规则集上比"前后相同"（0===0 恒真）
    const doomed = await t.repos.links.list("demo", (l) => l.type === "line_runs_work_order");
    expect(doomed.length).toBeGreaterThan(0); // 变异必须真的有东西可删
    for (const l of doomed) await t.repos.links.remove("demo", l.id);
    expect((await t.repos.links.list("demo", (l) => l.type === "line_runs_work_order")).length).toBe(0);
    // 规则条数**没变** —— 这正是"条数不度量链路通不通"的当场证据。
    expect((await t.repos.sim.listPropagationRules("demo", true)).length).toBe(rulesBefore);

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
