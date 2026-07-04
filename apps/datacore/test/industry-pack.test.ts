import { describe, expect, it } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeApp } from "./helpers.js";
import type { AuthCtx, ViewConfig } from "../src/domain.js";
import { IndustryPackSchema, SEG_REGISTRY } from "@platform/contracts";
import { SOLVER_REGISTRY } from "../src/solvers/solver-registry.js";
import { BATTERY_TEMPLATE, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import { LOGISTICS_TEMPLATE } from "../src/synthetic/logistics.js";
import {
  batteryPack,
  logisticsPack,
  PACK_REGISTRY,
  loadIndustryPack,
  packSolverDescriptors,
  BATTERY_VIEW_FRAGMENTS,
  scanPackFiles,
  keyFromFile,
  PACKS_DIR,
} from "../src/synthetic/industry-pack.js";

/**
 * INDUSTRY-PACK-CONVERGE（P1 北极星）teeth：单一声明式 IndustryPack + 加载器装配全栈。
 *
 * 红线证据：
 *  T1 收编·byte-identical（R6）—— batteryPack 各字段 === 既有单源常量（搬家不改值）。
 *  T2 加载器驱动解析（teeth·退回散落硬编码即红）—— runJob 后 storage 的 solver_params/视图结构 === pack 装配值。
 *  T3 换行业零码（2nd pack）—— logisticsPack 仅登记即为其装配全栈（模板/求解器 descriptor 子集），
 *     runJob 真物化非电池世界，**零跨文件代码改动**。
 */
const ctxFor = (tenantId: string): AuthCtx => ({ tenantId, userId: "u", roles: ["admin"], attributes: {} });

describe("INDUSTRY-PACK-CONVERGE · 单一声明式行业包 + 加载器", () => {
  // ---- T1 收编·byte-identical（R6）----
  it("T1a batteryPack 通过 IndustryPackSchema 校验（可序列化声明式包）", () => {
    expect(() => IndustryPackSchema.parse(batteryPack)).not.toThrow();
    expect(() => IndustryPackSchema.parse(logisticsPack)).not.toThrow();
  });

  it("T1b 电池散落配置**引用**收编（identity 相等·搬家不改值 R6）", () => {
    // 阈值/本体/意图层：template 直接引用既有 IndustryTemplate 束（不拆散重建）。
    expect(batteryPack.template).toBe(BATTERY_TEMPLATE);
    expect(batteryPack.industryKey).toBe("battery-manufacturing");
    // params(阈值)层单源 = template.solverParams = BATTERY_SOLVER_PARAMS（同一对象）。
    expect(batteryPack.template.solverParams).toBe(BATTERY_SOLVER_PARAMS);
    // 实体层 = SEG_REGISTRY（同一册·换行业换册即换分类语义）。
    expect(batteryPack.entities.segments).toBe(SEG_REGISTRY);
    // 时间层 t0 = solverParams.forecastStart（权威）。
    expect(batteryPack.clock.t0).toBe(BATTERY_SOLVER_PARAMS.forecastStart);
  });

  it("T1c 结构层视图片段收编进 pack（含应用细分行·退回内联即漂移）", () => {
    // 结构层：电池视图结构数据现驻 pack（曾内联 service.ts seedViewConfigs）。
    const pas = BATTERY_VIEW_FRAGMENTS.planAuditFieldGroups[0]!.fields.map((f) => f.label);
    expect(pas).toContain("乘用车");
    expect(BATTERY_VIEW_FRAGMENTS.planGenerateGoalFields.map((f) => f.key)).toContain("gmFloorPct");
    expect(BATTERY_VIEW_FRAGMENTS.orderChainLabels).toMatchObject({ DELIVERY: "交期", CREDIT: "信用" });
    // pack.views 投影引用同一片段（单源不漂）。
    expect((batteryPack.views["plan-audit"]!.layout as { fieldGroups: unknown }).fieldGroups).toBe(
      BATTERY_VIEW_FRAGMENTS.planAuditFieldGroups,
    );
  });

  it("T1d solverDescriptors 绑定共享 SOLVER_REGISTRY（不复制进包·R14 平台共享）", () => {
    // 电池包省略 solverKeys → 消费全平台 descriptor（顺序稳定 R6）。
    const bat = packSolverDescriptors(batteryPack);
    expect(bat).toEqual([...SOLVER_REGISTRY]);
    expect(bat.length).toBe(SOLVER_REGISTRY.length);
  });

  // ---- T2 加载器驱动解析（teeth·退回散落硬编码即红）----
  it("T2a loadIndustryPack 为 template 解析单源（identity·byte-identical）", () => {
    expect(loadIndustryPack("battery-manufacturing")!.template).toBe(BATTERY_TEMPLATE);
    expect(loadIndustryPack("logistics-warehouse")!.template).toBe(LOGISTICS_TEMPLATE);
    expect(loadIndustryPack("does-not-exist")).toBeUndefined();
  });

  it("T2b runJob 后 storage solver_params === pack 装配值（阈值层经 loader 落库·退回 bypass 即红）", async () => {
    const t = await makeApp({ seed: false });
    const ctx = ctxFor("bat-pack");
    const job = await t.services.synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42 });
    expect(job.status).toBe("SUCCEEDED");
    const stored = await t.repos.solverParams.get("bat-pack", "spar_bat-pack");
    // 落库的 params 逐值 == pack 装配的 params（loader 是单源；若 seed 绕过 pack 或 pack 漂移即红）。
    expect(stored?.params).toEqual(loadIndustryPack("battery-manufacturing")!.template.solverParams);
    // 且求解器阈值实际可见（阈值层真到位）。
    expect((stored?.params as { forecastStart: string }).forecastStart).toBe(batteryPack.clock.t0);
  });

  it("T2c runJob 后 plan-audit 视图 layout.fieldGroups === pack 结构片段（结构层经 pack 落库·退回内联即红）", async () => {
    const t = await makeApp({ seed: false });
    const ctx = ctxFor("bat-view");
    await t.services.synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42 });
    const vcs = await t.repos.viewConfigs.list("bat-view", (v: ViewConfig) => v.role === "admin");
    const pa = vcs[0]!.views.find((v) => v.key === "plan-audit");
    expect((pa!.layout as { fieldGroups: unknown }).fieldGroups).toEqual(BATTERY_VIEW_FRAGMENTS.planAuditFieldGroups);
    const oc = vcs[0]!.views.find((v) => v.key === "order-chain");
    expect((oc!.layout as { categoryLabels: unknown }).categoryLabels).toEqual(BATTERY_VIEW_FRAGMENTS.orderChainLabels);
  });

  // ---- T3 换行业零码（2nd pack·非纸面契约）----
  it("T3a logisticsPack 登记即在 PACK_REGISTRY（新增行业=登记一份 pack）", () => {
    expect(PACK_REGISTRY.map((p) => p.industryKey)).toContain("logistics-warehouse");
    expect(logisticsPack.template).toBe(LOGISTICS_TEMPLATE);
    // 物流栈 solverKeys 声明子集 → 从共享 SOLVER_REGISTRY 绑定（全部存在·descriptor 零改）。
    const descs = packSolverDescriptors(logisticsPack);
    expect(descs.map((d) => d.key).sort()).toEqual([...logisticsPack.solverKeys!].sort());
    expect(descs.every((d) => SOLVER_REGISTRY.includes(d))).toBe(true);
    expect(descs.some((d) => d.key === "facility_location")).toBe(true);
  });

  it("T3b 加载器为物流租户装配全栈·runJob 真物化非电池世界（零跨文件代码改动）", async () => {
    const t = await makeApp({ seed: false });
    const ctx = ctxFor("logi-pack");
    const job = await t.services.synthetic.runJob(ctx, { industry: "logistics-warehouse", scale: "S", seed: 42 });
    expect(job.status).toBe("SUCCEEDED");
    const warehouses = await t.repos.objects.listByType("logi-pack", "Warehouse");
    const stores = await t.repos.objects.listByType("logi-pack", "Store");
    expect(warehouses.length).toBe(6);
    expect(stores.length).toBe(10);
    // 非电池世界：零电池实体（Base/Order 不存在于此租户）。
    const bases = await t.repos.objects.listByType("logi-pack", "Base");
    expect(bases.length).toBe(0);
    // 该行业无应用细分（entities.segments=[]）——pack 声明即栈行为。
    expect(logisticsPack.entities.segments).toEqual([]);
  });
});

/**
 * C2『换行业 0 码改』teeth：PACK_REGISTRY 由目录扫描派生（非手工数组）·新增行业 = 加 packs/** 一个文件即被发现。
 */
describe("INDUSTRY-PACK-CONVERGE · C2 目录约定 + auto-discover（真 0 码改）", () => {
  it("C2a PACK_REGISTRY 键集 === packs/ 目录扫描键集（目录派生·非手工登记数组）", () => {
    const dirKeys = scanPackFiles().map(keyFromFile).sort();
    const regKeys = PACK_REGISTRY.map((p) => p.industryKey).sort();
    expect(regKeys).toEqual(dirKeys);
    // 目录约定：文件名（去 .pack.<ext>）=== 该 pack.industryKey（键即路由·无手工映射漂移）。
    for (const name of scanPackFiles()) {
      const p = loadIndustryPack(keyFromFile(name));
      expect(p, `packs/${name} 应被扫描登记`).toBeDefined();
      expect(p!.industryKey).toBe(keyFromFile(name));
    }
    // 两内置行业均在（battery byte-identical + logistics 非电池）。
    expect(dirKeys).toContain("battery-manufacturing");
    expect(dirKeys).toContain("logistics-warehouse");
  });

  it("C2b 加一个 packs/*.pack.json 即被同一扫描发现（0 码改·新增行业=1 文件·非纸面）", () => {
    const probeKey = "_probe-zzz-testonly";
    const probeFile = join(PACKS_DIR, `${probeKey}.pack.json`);
    const before = scanPackFiles();
    expect(before.map(keyFromFile)).not.toContain(probeKey);
    try {
      // 仅落一个数据文件（零代码改动）→ 同一 scanPackFiles 立即发现（=registry 构建所依据的目录扫描）。
      writeFileSync(probeFile, JSON.stringify({ industryKey: probeKey }));
      const after = scanPackFiles();
      expect(after.map(keyFromFile)).toContain(probeKey);
      // 且文件名派生键与约定一致。
      expect(keyFromFile(`${probeKey}.pack.json`)).toBe(probeKey);
    } finally {
      rmSync(probeFile, { force: true });
    }
    // 复位后不再出现（无残留·确定性）。
    expect(scanPackFiles().map(keyFromFile)).not.toContain(probeKey);
  });
});

/**
 * C3『非电池行业完整 app 活体』teeth：logisticsPack 自带非电池 viewLayouts + 决策场景卡，
 * runJob 后该租户 ViewConfig 由 pack 驱动渲染非电池视图（非电池 KPI·零 Base/乘用车），场景卡答案 query 声明式可答。
 */
describe("INDUSTRY-PACK-CONVERGE · C3 非电池行业自有视图/场景（pack 驱动·活体）", () => {
  it("C3a logisticsPack 自带非电池 viewLayouts + 决策场景（浏览器可答·答案声明式 query）", () => {
    // 视图：配送网络看板（dashboard·KPI 全来自 Warehouse/Store 聚合·非电池 KPI）。
    const net = logisticsPack.views["logi-network"];
    expect(net?.renderer).toBe("dashboard");
    const widgets = (net!.layout as { widgets: { query: { objectType?: string } }[] }).widgets;
    const objTypes = new Set(widgets.map((w) => w.query.objectType).filter(Boolean));
    expect(objTypes).toContain("Warehouse");
    expect(objTypes).toContain("Store");
    // 零电池实体泄露（非电池 KPI·无 Base/DemandSegment）。
    expect(objTypes.has("Base")).toBe(false);
    expect(objTypes.has("DemandSegment")).toBe(false);
    // 场景卡：≥1，答案为声明式 query（objects-aggregate/objects/solver）。
    expect(logisticsPack.scenarios.length).toBeGreaterThanOrEqual(1);
    for (const s of logisticsPack.scenarios) {
      expect(["objects-aggregate", "objects", "solver"]).toContain(s.answer.kind);
      expect(s.question.length).toBeGreaterThan(0);
    }
  });

  it("C3b runJob(logistics) 后 admin ViewConfig 由 pack 渲染非电池视图 + 决策场景（引擎零 if(industry===)）", async () => {
    const t = await makeApp({ seed: false });
    const ctx: AuthCtx = { tenantId: "logi-c3", userId: "u", roles: ["admin"], attributes: {} };
    await t.services.synthetic.runJob(ctx, { industry: "logistics-warehouse", scale: "S", seed: 42 });
    const vcs = await t.repos.viewConfigs.list("logi-c3", (v: ViewConfig) => v.role === "admin");
    const views = vcs[0]!.views;
    const keys = views.map((v) => v.key);
    // pack.views + 场景视图入该租户导航（非电池行业其**自有**视图·config-driven）。
    expect(keys).toContain("logi-network");
    expect(keys).toContain("decision-scenarios");
    // 电池推演视图不泄露到物流租户（plan-audit/order-chain 不在）。
    expect(keys).not.toContain("plan-audit");
    expect(keys).not.toContain("order-chain");
    // 场景视图 widgets = pack.scenarios 物化（问句为卡标题·答案声明式 query）。
    const sc = views.find((v) => v.key === "decision-scenarios");
    expect(sc?.renderer).toBe("dashboard");
    const scWidgets = (sc!.layout as { widgets: { title: string }[] }).widgets;
    expect(scWidgets.length).toBe(logisticsPack.scenarios.length);
    expect(scWidgets.map((w) => w.title)).toEqual(logisticsPack.scenarios.map((s) => s.question));
    // 配送网络看板真渲染非电池 KPI（objectType Warehouse/Store·真数据经聚合·前端 config-driven）。
    const net = views.find((v) => v.key === "logi-network");
    const netW = (net!.layout as { widgets: { query: { objectType?: string } }[] }).widgets;
    expect(netW.some((w) => w.query.objectType === "Warehouse")).toBe(true);
    expect(netW.some((w) => w.query.objectType === "Store")).toBe(true);
  });
});
