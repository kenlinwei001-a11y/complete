import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import {
  DEMO_DERIVATION_SPECS,
  seedDemoDerivationSpecs,
  recomputeDemoDerivationsAtSeed,
} from "../src/seed-derivation-specs.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot, seedHash01 } from "../src/sim/seed-world.js";
import { STATE_VAR_DISPLAY_NAMES, STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-SIM-REAL-DATA · **接缝组合门**（验收判据 7）：从派生规格编译 → recompute → 播种世界
 * → `deriveSeedBaseSnapshot` 的 measuredCells，**整条链一起跑**，不是只测 `parseFormula`。
 *
 * ══ 五道臂（WO §6.3，缺一道不算交付）══
 *   臂1 锚定：算出的数 = 独立手算的数（输入从对象层独立取，⛔ 不许从式子中间结果取 = 自证）。
 *   臂2 量纲：算出的数与该量已知真值同量级（差一个数量级 = 退回重写）。
 *   臂3 敏感性：改输入，输出按**可预言方式**变（线性式 ×2 ⇒ ×2，不许「变了就行」）。
 *   臂4 反向：拿掉输入，必须退回且计数精确变（防「写死常数」）。
 *   臂5 变异反证：故意把实现改坏，这条测试必须红。
 *
 * ══ 播种只铺一次（beforeAll），臂 3/4/5 用 dryRun / 独立小世界，⛔ 不污染共享世界 ══
 * 守门员 `sim-order-real-fields` 实测单次播种 ~30–97s，重复铺会把整条门拖垮。
 *
 * ⛔ 判据一律是对照实验（CLAUDE.md 铁律 1.5 判据一）。本文件**不是新增门** ——
 * 它是 WO-SIM-REAL-DATA 验收判据 7 明文要求的「接缝组合测试」（仓主冻结令豁免：
 * 该 WO 本身就是仓主派的，且这条测的是本单交付物自己的链路，非审核方自我维护的度量装置）。
 */

/** A 档规格全集（从 DEMO_DERIVATION_SPECS 现算，⛔ 不写死字面量 —— 写死不度量今天真的登记了谁）。
 *  今日 26 条 = Customer 1 + A 档 18 + Model.supplyRisk 链核实后升级 1 + A⚠ 档 5（仓主 2026-09-16 ③全批落 5；
 *  orderChurn 无诚实源停笔，理由见规格表段尾）+ 库存环 1（WO-PROP-REVIEW-V2 ② fgi_cover_days，2026-09-17）。
 *  （3 条旧规格 order_value/fgi_qty_available/ibt_eta_day 属 WO-SLICE-DERIV-EMPTY，不在本集。） */
const A_TIER = DEMO_DERIVATION_SPECS.filter((s) => s.specKey !== "order_value" && s.specKey !== "fgi_qty_available" && s.specKey !== "ibt_eta_day");

/** 从对象层**独立**取一个数值属性（臂 1 手算的输入，⛔ 不许走式子中间结果）。 */
function propOf(objs: ObjectInstance[], id: string, prop: string): number {
  const o = objs.find((x) => x.id === id);
  const v = o?.props[prop];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`独立取数失败：${id}.${prop} 不是有限数（得 ${String(v)}）`);
  return v;
}

describe("WO-SIM-REAL-DATA · 真业务数进推演世界（SEAM 组合）", () => {
  let t: TestApp;
  let measuredCells = 0;
  let totalCells = 0;
  /** 各类型对象缓存（臂 1 手算输入 + 臂 2 对照真值都从对象层独立取）。 */
  const objsByType = new Map<string, ObjectInstance[]>();
  const objectsOf = async (type: string): Promise<ObjectInstance[]> => {
    if (!objsByType.has(type)) objsByType.set(type, await t.repos.objects.listByType("demo", type));
    return objsByType.get(type)!;
  };

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    // §1：编译规格 → 播种期全量初算（生产 SEED_DEMO=1 的同一条链）。
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
    // 铺世界读 measuredCells（与 GET /a/v1/sim/sessions 的 baseSnapshotOrigin 同源）。
    const { origin } = await deriveSeedBaseSnapshot(t.repos, "demo");
    measuredCells = origin.measuredCells;
    totalCells = origin.cells;
  }, 180_000);

  // ── ⓒ 接缝驱动（验收判据 7）：编译→recompute→播种→读数 整条通 ─────────────────
  it("ⓒ 接缝驱动：26 条规格编译入库 + 物化后 measuredCells 从 470 涨到 4183（主判据 3,896 过线）", () => {
    // 前态锚点：§1 只带 3 条旧规格时 measuredCells=470（WO 实测基线，含 Customer 那条 20 格）。
    // 20 条 A 档物化 +3,221 ⇒ 3691；A⚠ 5 条（仓主 2026-09-16 ③批）再 +480（Order 150×3 +
    // MaterialBatch 24 + Model 6）⇒ 4171 ≥ 主判据 3,896（+275）。orderChurn 停笔不减格（它从未物化）。
    // WO-PROP-REVIEW-V2 库存环再 +18：新边 `demo_fg_cover_days_to_model_demand` 把
    // (FinishedGoodsInventory, coverDays) 纳入规则触及集 ⇒ 世界新铺 18 格（FGI 18 行 × 1 新量纲），
    // 且 `fgi_cover_days` 规格把这 18 格全部物化成真值 ⇒ totalCells 6363→6381、measuredCells 4171→4189
    // （/tmp/t3-probe.txt ③ 实测两数，与预测逐字节一致）。
    // ⚠ WO-FORECASTBIAS-RETIRE（2026-09-20）**减 6**：4189→4183。退役 `model_forecast_bias`
    //   （分子 `totalDemand − SUM(in(order_for_model).qty)` 两项同源 ⇒ **恒 0**，却盖着 "measured" 章）
    //   ⇒ `Model.forecastBias` 6 格从「实测」退回哈希占位。
    //   **`totalCells` 一格不动（仍 6381）**：格子还在，换的是出处章 —— 这正是本条该有的样子，
    //   两个数一起看才分得清「少了一格」与「同一格换了出处」。
    //   ⛔ 别把这 −6 读成「丢了 6 格真读数」：那 6 格原本就不是真读数，是一个恒等式的零。
    expect(totalCells).toBe(6381);
    expect(measuredCells).toBe(4183);
  });

  // ── ⓑ 指认粒度（验收判据 ⓑ）：逐条点名物化数，红了能指出是哪一条 ─────────────────
  it("ⓑ 指认粒度：26 条规格逐条物化数 = 该类型进世界对象数（逐条点名，不一锅断言）", async () => {
    // 每条规格的物化数 = 其 targetType 上进世界的对象数（独立数，不从 measuredCells 反推）。
    const expected: Record<string, number> = {};
    for (const s of A_TIER) {
      const n = (await objectsOf(s.targetType)).length;
      expected[s.specKey] = n;
    }
    for (const s of A_TIER) {
      // 逐条断言：物化了 ⇒ 该类型每个对象的 targetProp 都是有限数。
      const objs = await objectsOf(s.targetType);
      const materialized = objs.filter((o) => typeof o.props[s.targetProp] === "number" && Number.isFinite(o.props[s.targetProp])).length;
      expect(
        { key: s.specKey, n: materialized },
        `规格 ${s.specKey} 物化 ${materialized}/${expected[s.specKey]}（红了就指这条）`,
      ).toEqual({ key: s.specKey, n: expected[s.specKey] });
    }
  });

  // ── 臂 1 锚定（抽 5 条代表：自属性 / 单跳聚合 / 链方向易错各覆盖）────────────────
  it("臂1 锚定：Equipment.equipmentFailure = 100 − health_score（独立手算）", async () => {
    const eqs = await objectsOf("Equipment");
    const sample = eqs[0]!;
    const hand = 100 - propOf(eqs, sample.id, "health_score");
    expect(propOf(eqs, sample.id, "equipmentFailure")).toBeCloseTo(hand, 4);
  });

  it("臂1 锚定：Line.utilPressure = utilization 逐字节（同量纲直取）", async () => {
    const lines = await objectsOf("Line");
    const sample = lines[0]!;
    expect(propOf(lines, sample.id, "utilPressure")).toBe(propOf(lines, sample.id, "utilization"));
  });

  it("臂1 锚定：Model.costPressure = unitCost×100÷unitPrice（先乘后除 4 位定点）", async () => {
    const models = await objectsOf("Model");
    const sample = models[0]!;
    const hand = (propOf(models, sample.id, "unitCost") * 100) / propOf(models, sample.id, "unitPrice");
    expect(propOf(models, sample.id, "costPressure")).toBeCloseTo(hand, 4);
  });

  it("臂1 锚定：Process.queuePressure = utilization × 100", async () => {
    const procs = await objectsOf("Process");
    const sample = procs[0]!;
    expect(propOf(procs, sample.id, "queuePressure")).toBeCloseTo(propOf(procs, sample.id, "utilization") * 100, 4);
  });

  it("臂1 锚定：Supplier.deliveryDelay = (1 − onTimeRate) × 100", async () => {
    const sups = await objectsOf("Supplier");
    const sample = sups[0]!;
    expect(propOf(sups, sample.id, "deliveryDelay")).toBeCloseTo((1 - propOf(sups, sample.id, "onTimeRate")) * 100, 4);
  });

  // ── 臂 1 锚定 · A⚠ 档（仓主 ③批 5 条抽 3：ratio 代理 / 恒等直取 / 双字段比率各覆盖）────────
  it("臂1 锚定：Order.shortageRisk = outsourceRatio × 100（A⚠ 仓主批口径代理）", async () => {
    const orders = await objectsOf("Order");
    const sample = orders[0]!;
    expect(propOf(orders, sample.id, "shortageRisk")).toBeCloseTo(propOf(orders, sample.id, "outsourceRatio") * 100, 4);
  });

  it("臂1 锚定：MaterialBatch.procurementDelay = ageDays 逐字节（恒等直取）", async () => {
    const batches = await objectsOf("MaterialBatch");
    const sample = batches[0]!;
    expect(propOf(batches, sample.id, "procurementDelay")).toBe(propOf(batches, sample.id, "ageDays"));
  });

  it("臂1 锚定：Model.demandLoad = orderCount × 100 ÷ capacity（先乘后除 4 位定点）", async () => {
    const models = await objectsOf("Model");
    const sample = models[0]!;
    const hand = (propOf(models, sample.id, "orderCount") * 100) / propOf(models, sample.id, "capacity");
    expect(propOf(models, sample.id, "demandLoad")).toBeCloseTo(hand, 4);
  });

  // ── 臂 2 量纲 · 上下文规则版（仓主 2026-09-17 打回②修：白名单换全扫）────────────────────
  it("臂2 量纲：全扫 STATE_VAR_DOMAINS 已声明域的变量逐个不越域；无域族归档「刻意无上界」", async () => {
    // 打回②的结构病：旧版是 7 元组白名单 —— 只扫得到「有人想起来加进表」的变量。
    //   全扫第一网就捞到白名单永远看不到的两条：WIPLot.feedPressure 260/260 全在 ≈111（域 [0,100]）、
    //   Model.supplyRisk 6/6 全负（≈−29）—— 白名单结构性地抓不住表外变量。
    //   修 = 域在 STATE_VAR_DOMAINS 里声明 ⇒ 自动受守（新增变量不用有人想起来往表里加）；
    //        没声明 ⇒ 按族归档「刻意无上界」，只断言有限数。
    //
    // 如实例外表（回执点名过的先例：式子只算原始值，越域由引擎按域夹，对象上留原始值——
    //   同 expeditePressure −32~212 / loadIndex 74–552 判例，⛔ 不许 CLAMP 内联边界常数 = R14）。
    //   区间全部实测于本 tip（探针 /tmp/arm2-scan.mjs：全链播种后全对象扫描），⛔ 不许拍脑袋宽限。
    //   ⚠ 例外键若永远扫不到 ⇒ 档案腐坏 ⇒ 红（下方 expect(excLeft).toEqual([])），逼维护不逼删守。
    const EXCEPTIONS: Record<string, readonly [number, number, string]> = {
      // 应收超授信 25.6%（1 户）：应收 > 授信 = 超压如实。注意 22.67 是臂1锚点那户的值，不是分布上界。
      "Customer|receivablePressure": [0, 126, "实测 6.40–125.59（n=20，越域 1 户）"],
      // 16 单 creditUsedRatio>1（i%7 单 1.15×100=115）：超授信即超压（仓主 ③批「如实」）。
      "Order|costPressure": [0, 116, "实测 40–115（n=500，越域 16 单）"],
      // 负=未到船期、>100=已超窗（A 档交付记录）。
      "PurchaseOrder|expeditePressure": [-33, 213, "实测 −32.43–212.5（n=30，越域 13）"],
      // >100=基地承诺量超两产能之和，超载如实（A 档交付记录）。
      "Base|loadIndex": [0, 553, "实测 74.18–552.02（n=13，越域 10）"],
      // 负=超储（在手+在途 > 日耗×提前期），缺货率如实（A 档交付记录）。
      "Material|shortageRisk": [-162, 52, "实测 −161.42–51.00（n=8，越域 4）"],
      // >100=在手订单超产能（同 loadIndex 先例，仓主 ③批「如实」）。
      "Model|demandLoad": [0, 139, "实测 23.57–138（n=6，越域 1）"],
      // AVG(物料 shortageRisk) 继承负尾（负=该型号物料整体超储）。论界 = 均值必落入输入界 [−161.42, 51.00]。
      // ⚠ 本条是全扫的第一条新catch：supplyRisk 声明域 [0,100] 是「单物料缺货率」的域，对「跨物料均值」口径不适用；
      //   白名单时代它从未被扫到。处置 = 如实归档不改式（⛔ 不许为它 CLAMP，同判例）；要不要换口径归仓主裁。
      "Model|supplyRisk": [-162, 52, "实测 −29.44–−28.86（n=6，全负；输入 shortageRisk ∈ [−161.42, 51.00]）"],
      // 260/260 全在 ≈111 = 100/0.9（合成 90% 收率不变式：批 qty = 工单 qtyPlanned × 0.9，1:1 链）。
      // ⚠ 全扫第二条新catch：投料压力恒 ≈111 是合成不变式的镜像，不是业务信号。如实归档不改式；
      //   「恒值压力有没有推演价值」是仓主的裁决，不是本测试的（它的职责是抓住它 —— 已抓住）。
      "WIPLot|feedPressure": [111, 112, "实测 111.1111–111.1888（n=260，全部；= 1/0.9 收率镜像）"],
      // T6 形态②（2026-09-18）：本键起声明域 [0,100]（评审原文「名字是 0–100 压力指数，却无界累积到 945」⇒ 自报量纲即出处），
      //   但**种子真值本就超界**（/tmp/t6-arm2-scan.txt RC=0）——域管引擎每拍夹（tick1 实测 129 条 saturations 记账），
      //   对象上的原始真值如实归档（同 expeditePressure −32~212 判例，⛔ 不许为它改种子 = 动 hash）。种子收口交仓主。
      "Line|blockedPressure": [0, 183, "实测 27.72–182.73（n=130，越界 49 条）"],
    };
    // 无域族归档（打回②要求的「单独归档并写明刻意无上界」；注册表现算 **10 键**，T6 形态② 后重排）：
    //   ① 天数族 4：clearanceQueueDays/procurementDelay/deliveryDelay/backlogHorizonDays
    //      —— procurementDelay/deliveryDelay 是**根源**（入度 0，无入流不累积 ⇒ 非积分器，形态② 不适用）；
    //         clearanceQueueDays 实测 **−8.9 负值**可疑 ⇒ 交仓主：此刻声明下界 0 是把数据 bug 夹成看起来正常。
    //   ② 件数族 2：backlogQtyTop/backlogPriceTop —— 业务原值统计量，不该夹（同 ③ 判例）。
    //   ③ 真值支 3：qty/unitPrice/leadDays —— 带真实单位的业务量（套/元/天）走真值支，不适用压力域（域表出处注）。
    //   ④ coverDays —— 根源 + 真值支 + restPoint≠0 无出处（T6 逐项裁决 defer，理由见 battery.ts 域表头注）。
    //   （T6 前 15 键：queueDays/inspectBacklog/repairBacklog/handlingBacklog/qualificationQueue 已带
    //    「下界 0 + 无界 max + 消化速率 decayRef」进域表（均非对象 prop，臂2 扫不到，归 tick 回执守）；
    //    blockedPressure 归压力族，其种子超界真值上移进 EXCEPTIONS，不再是本族成员。）
    const NO_DOMAIN = Object.keys(STATE_VAR_DISPLAY_NAMES).filter((k) => !(k in STATE_VAR_DOMAINS));

    // 金丝雀先行（防扫描空转假绿）：域表至少 38 键（31 压力族 + forecastBias + T6 形态② 6 键，
    // 只能多不能少 —— 少了 = 有人在拆守 ⇒ 红）。
    expect(Object.keys(STATE_VAR_DOMAINS).length).toBeGreaterThanOrEqual(38);

    const all = await t.repos.objects.list("demo");
    const excLeft = new Set(Object.keys(EXCEPTIONS));
    const domGroups = new Set<string>();
    const noDomGroups = new Set<string>();
    for (const o of all) {
      for (const [prop, v] of Object.entries(o.props)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const key = `${o.type}|${prop}`;
        const dom = STATE_VAR_DOMAINS[prop];
        if (dom) {
          domGroups.add(key);
          const exc = EXCEPTIONS[key];
          if (exc) {
            excLeft.delete(key);
            expect(v >= exc[0] && v <= exc[1], `${key}=${v} 越出如实例外区间 [${exc[0]},${exc[1]}]（${exc[2]}）`).toBe(true);
          } else {
            // `max === null` = T6 无界声明（积压/天数族）：上夹不生效，只守下界（⛔ 不许 `?? Infinity` 把无界混进有界路径）。
            expect(v >= dom.min && (dom.max === null || v <= dom.max), `${key}=${v} 越出声明域 [${dom.min},${dom.max ?? "无上界"}] = 量纲错配（越域 = 量纲错配的指纹，utilPressure 460 vs 91 的教训）`).toBe(true);
          }
        } else if (NO_DOMAIN.includes(prop)) {
          // 刻意无上界 ⇒ 只断言有限数（上方 isFinite 已是断言本身），计数归档。
          noDomGroups.add(key);
        }
        // 其余 prop 不是状态量（普通业务属性），不在本臂守卫范围。
      }
    }
    // 完整性三断言：① 扫描真的扫到了域键（现算 21 组 /tmp/t6-arm2-scan.txt，⛔ 不许写死 —— 写死不度量今天真的登记了谁）；
    expect(domGroups.size).toBeGreaterThanOrEqual(15);
    // ② 例外表零腐坏（扫不到的例外 = 死档案 ⇒ 红）；
    expect([...excLeft], `例外表腐坏：这些键从未扫到 → ${[...excLeft].join(", ")}`).toEqual([]);
    // ③ 无域族确实在世界里出现（现算 19 组 Type|prop 组合 /tmp/t6-arm2-scan.txt ——
    //    计数与 T6 前恰同，成分已换：coverDays 进、blockedPressure 出）。
    expect(noDomGroups.size).toBeGreaterThanOrEqual(10);
  });

  // ── ⓐ 引擎归属（验收判据 ⓐ 方式 2 釜底抽薪）：清掉规格 ⇒ 本单值全消失 ─────────────────
  it("ⓐ 引擎归属：derivationSpecs 清成 0 条 ⇒ 25 个 targetProp 全部消失（证明是引擎②算的）", async () => {
    // 独立小世界：不碰共享 t。规格库空 ⇒ §3 校验收窄跳过 ⇒ 这 24 格走哈希（仍 measured），
    // 但**对象 props 上没有 targetProp**（没 recompute 物化）⇒ 釜底抽薪的证明是「属性本身消失」。
    const t2 = await makeApp();
    await seedBattery(t2);
    await seedDemoPropagationRules(t2.repos);
    // ⛔ 不 seedDemoDerivationSpecs ⇒ 规格库 0 条。
    for (const s of A_TIER) {
      const objs = await t2.repos.objects.listByType("demo", s.targetType);
      const withProp = objs.filter((o) => s.targetProp in o.props).length;
      expect(withProp, `清规格后 ${s.specKey} 的 ${s.targetType}.${s.targetProp} 仍有 ${withProp} 对象带值 = 不是引擎②算的`).toBe(0);
    }
  }, 120_000);

  // ── 臂 3 敏感性（dryRun what-if，不污染共享世界）：改输入 ⇒ 输出按预言变 ─────────────────
  it("臂3 敏感性：Customer.receivables ×2 ⇒ receivablePressure 精确 ×2（线性式）", async () => {
    const custs = await objectsOf("Customer");
    const sample = custs.find((c) => typeof c.props.receivables === "number" && typeof c.props.receivablePressure === "number" && c.props.receivablePressure > 0);
    expect(sample, "要一个 receivablePressure>0 的样本做 ×2 对照").toBeTruthy();
    const before = sample!.props.receivablePressure as number;
    const r = sample!.props.receivables as number;
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Customer", prop: "receivables", objectIds: [sample!.id] }],
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "receivables", value: r * 2 }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "receivablePressure");
    expect(delta, "dryRun 必须给出 receivablePressure 的 before/after").toBeTruthy();
    // 线性式 receivables×100/creditLimit：receivables ×2 ⇒ 输出精确 ×2（4 位定点内）。
    expect((delta!.after as number) / before).toBeCloseTo(2, 3);
  });

  it("臂3 敏感性：Equipment.health_score ↓10 ⇒ equipmentFailure 精确 ↑10（反向线性）", async () => {
    const eqs = await objectsOf("Equipment");
    const sample = eqs.find((e) => (e.props.health_score as number) >= 20);
    const before = sample!.props.equipmentFailure as number;
    const hs = sample!.props.health_score as number;
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Equipment", prop: "health_score", objectIds: [sample!.id] }],
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "health_score", value: hs - 10 }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "equipmentFailure");
    // equipmentFailure = 100 − health_score：hs ↓10 ⇒ failure 精确 ↑10。
    expect((delta!.after as number) - before).toBeCloseTo(10, 4);
  });

  // ── 臂 4 反向（dryRun：拿掉输入 ⇒ 退回 null/0，防写死常数）─────────────────────────
  it("臂4 反向：拿掉 Line.max_capacity_day ⇒ blockedPressure 退回（COALESCE 兜 0，非写死常数）", async () => {
    const lines = await objectsOf("Line");
    const sample = lines.find((l) => (l.props.blockedPressure as number) > 0);
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Line", prop: "max_capacity_day", objectIds: [sample!.id] }],
      // 拿掉分母（dryRun apply 成 undefined ⇒ div-zero ⇒ COALESCE 兜 0）。
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "max_capacity_day", value: undefined }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "blockedPressure");
    // 不是写死常数 ⇒ 分母没了输出必须变（兜 0 或变，不是停在原值）。
    expect(delta!.after as number).not.toBe(sample!.props.blockedPressure as number);
    expect(delta!.after as number).toBe(0); // COALESCE(...,0) 兜除零
  });

  // ── 臂 5 变异反证：把实现改坏 ⇒ 这条测试必须红（在独立小世界变异，⛔ 不改共享实现）────────────────
  it("臂5 变异反证：把 equipmentFailure 的『100 −』改成『100 +』⇒ 臂1 锚定断言当场红", async () => {
    // 在独立小世界编译一条**变异规格**（同 targetType/targetProp，公式改坏），
    // recompute 后读值必须 ≠ 手算（证明臂1 真的咬得住「式子被改坏」这种病）。
    const t3 = await makeApp();
    await seedBattery(t3);
    await seedDemoDerivationSpecs(t3.repos, t3.services.ontologyCore, t3.services.governance, t3.adminCtx);
    // 编译变异规格：把 100 - health_score 改成 100 + health_score。
    const versions = await t3.repos.ontologyVersions.list("demo");
    const ov = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
    await t3.services.ontologyCore.compileSpecs(t3.adminCtx, ov, [
      { specKey: "equipment_failure_rate", targetType: "Equipment", targetProp: "equipmentFailure", formula: "100 + this.health_score" },
    ]);
    await recomputeDemoDerivationsAtSeed(t3.repos, t3.services.ontologyCore, t3.adminCtx);
    const eqs = await t3.repos.objects.listByType("demo", "Equipment");
    const sample = eqs[0]!;
    const handCorrect = 100 - propOf(eqs, sample.id, "health_score");
    const actual = propOf(eqs, sample.id, "equipmentFailure");
    // 变异后实测 = 100 + hs ≠ 手算 100 − hs ⇒ 若此处 actual 仍等于 handCorrect，说明臂1 咬不住。
    expect(actual, "变异没生效（式子没真被改坏）").not.toBeCloseTo(handCorrect, 4);
    expect(actual).toBeCloseTo(100 + propOf(eqs, sample.id, "health_score"), 4);
  }, 120_000);

  // ── R6 确定性（验收判据 4）：同 seed 重铺 ⇒ measuredCells 逐字节一致 ─────────────────
  it("R6 确定性：同 (seed=42) 重铺世界 ⇒ measuredCells / totalCells 逐字节一致", async () => {
    const a = await deriveSeedBaseSnapshot(t.repos, "demo");
    const b = await deriveSeedBaseSnapshot(t.repos, "demo");
    expect(a.origin.measuredCells).toBe(b.origin.measuredCells);
    expect(a.origin.cells).toBe(b.origin.cells);
    // 逐格字节一致（派生必须是纯函数，⛔ 无时钟无随机）。
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  // ── §3 绑定判据（验收判据 5）：valueRef 指向查无 specKey ⇒ 必须红 ─────────────────
  it("§3 绑定判据：valueRef 指向不存在的 specKey ⇒ 播种当场抛错变红（⛔ 不静默回落哈希）", async () => {
    const battery = await import("../src/synthetic/battery.js");
    const orig = battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"];
    battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"] = { specKey: "NONEXISTENT_spec_key_变异" };
    try {
      // 规格库非空（beforeAll 已播种）⇒ 校验生效 ⇒ 断引用必红。
      await expect(deriveSeedBaseSnapshot(t.repos, "demo")).rejects.toThrow(/绑定断裂|NONEXISTENT_spec_key_变异/);
    } finally {
      // 恢复注册表（变异复原 = cp 备份思路：先存原值再改，finally 复原并核验）。
      if (orig === undefined) delete battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"];
      else battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"] = orig;
    }
    // 复原后必须能正常播种（证明变异真的被复原，不留残毒）。
    const ok = await deriveSeedBaseSnapshot(t.repos, "demo");
    // WO-PROP-REVIEW-V2：4171→4189（+18 库存环 coverDays 格）；
    // WO-FORECASTBIAS-RETIRE：4189→4183（−6 Model.forecastBias 格退役回哈希）。理由见 ⓒ 段注释。
    expect(ok.origin.measuredCells).toBe(4183);
  });

  // ── WO-FORECASTBIAS-RETIRE（2026-09-20）：退役必须**两处同时**干净 ──────────────────
  // 上面 ⓒ / §3 两处的 `4183` 是**计数**，计数能被别的改动补平（一格退役 + 一格新增 = 数不动）。
  // 本条咬的是**这件事本身**：那条恒 0 的式子没了，且没有任何地方还指着它。
  // ⚠ 两臂缺一不可 —— 只咬规格没了，会漏掉「规格删了但 valueRef 还登记着」这个**播种抛错**态；
  //   只咬登记没了，会漏掉「登记删了但规格还在物化假的 measured 值」这个**假绿**态。
  it("§退役 · `model_forecast_bias` 与它的 valueRef 登记必须同时不存在（残留任一处即红）", async () => {
    const battery = await import("../src/synthetic/battery.js");
    // 臂①：规格表里查无此式（`DEMO_DERIVATION_SPECS` 是播种的唯一真相源）。
    expect(
      DEMO_DERIVATION_SPECS.map((s) => s.specKey),
      "`model_forecast_bias` 又回来了 —— 它的分子 `totalDemand − SUM(in(order_for_model).qty)` " +
        "两项同源、**恒等于 0**，且会给 `Model.forecastBias` 盖上 \"measured\" 章（屏上谎称实测）。" +
        "⛔ 要复活它必须先让分子的两项来自**不同**的量。",
    ).not.toContain("model_forecast_bias");
    // 臂②：没有任何 valueRef 还指着它（指着 ⇒ `deriveSeedBaseSnapshot` 抛「绑定断裂」）。
    expect(
      Object.entries(battery.STATE_VAR_VALUE_REFS)
        .filter(([, v]) => v.specKey === "model_forecast_bias")
        .map(([k]) => k),
      "还有 valueRef 指着已退役的 `model_forecast_bias` ⇒ SEED_DEMO 播种会当场抛「绑定断裂」。",
    ).toEqual([]);
    // 🐤 双向金丝雀：这把尺子得能**数得到**别的登记，否则上面两个空集是「工具坏了」不是「干净」。
    expect(
      Object.entries(battery.STATE_VAR_VALUE_REFS).filter(([, v]) => v.specKey === "model_cost_pressure").map(([k]) => k),
      "🐤 同一把尺子连 `model_cost_pressure` 的登记都数不到 ⇒ **量法坏了**，上面的空集不构成证据",
    ).toEqual(["Model|costPressure"]);
    expect(
      DEMO_DERIVATION_SPECS.map((s) => s.specKey),
      "🐤 同一把尺子连 `model_cost_pressure` 都查不到 ⇒ **量法坏了**",
    ).toContain("model_cost_pressure");
    // 臂③：退役后这一格必须**真的**回到哈希占位档，且出处章如实写 "derived"（不是 "measured"）。
    // ⛔ 只查「规格没了」不够：那是查源码，不是查读数（本仓铁律 0.6 第 6 条）。
    const { state, provenance } = await deriveSeedBaseSnapshot(t.repos, "demo");
    const modelIds = (await objectsOf("Model")).map((o) => o.id).filter((id) => state[id]);
    expect(modelIds.length, "🐤 进世界的 Model 数对不上 6 ⇒ 先解释再往下走").toBe(6);
    const provs = modelIds.map((id) => provenance[id]?.forecastBias);
    expect(provs, "退役后 `Model.forecastBias` 的出处章必须是 derived —— 哈希占位不是实测").toEqual(
      new Array(6).fill("derived"),
    );
    // 值必须**不再全等于 0**（恒 0 正是病的指纹）。
    const vals = modelIds.map((id) => state[id]!.forecastBias!);
    expect(
      new Set(vals).size,
      `退役后 6 个型号的 forecastBias 仍然只有一个取值 [${vals.join(",")}] —— 恒等式那个零回来了？`,
    ).toBeGreaterThan(1);
  }, 120_000);

  // ── seedHash01 金丝雀（校验哈希兜底路径仍在，占位格仍可复现）────────────────────────
  it("金丝雀：seedHash01 确定性（占位格的哈希兜底未受本单影响）", () => {
    expect(seedHash01("obj_x|qty")).toBe(seedHash01("obj_x|qty"));
    expect(seedHash01("obj_x|qty")).toBeGreaterThanOrEqual(0);
    expect(seedHash01("obj_x|qty")).toBeLessThanOrEqual(1);
  });
});
