import type { ObjectTypeDef, PropertyDef } from "../domain.js";
import { mulberry32, round } from "../prng.js";

/**
 * 20 场景目录 §7 GenSpec 扩展（成熟度 E6b）：为 13 个新求解器确定性生成所需对象数据，
 * 让场景从 presetContext 即可端到端出结果（无需手传 args）。
 *
 * 确定性：同 seed 字节级一致（mulberry32 派生子流，无时钟/随机）。§7 戏剧点植入：
 * 商用车集团G 逾期 38 天｜6 批 >90 日呆滞｜成都 4680-NCM 碳超标｜2 单 PO 延迟。
 */

const p = (propKey: string, dataType: PropertyDef["dataType"] = "number", isPrimaryKey = false): PropertyDef => ({
  propKey,
  dataType,
  isPrimaryKey,
});

type TypeDef = Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">;
const def = (key: string, displayName: string, domain: string, props: PropertyDef[]): TypeDef => ({
  key,
  displayName,
  domain,
  properties: props,
  derivedProperties: [],
  sourceBindings: [],
});

export function extendedObjectTypes(): TypeDef[] {
  return [
    def("Material", "物料", "supply", [p("matId", "string", true), p("name", "string"), p("unitPrice"), p("leadTime"), p("carbonFactor"), p("bomUnit"), p("dailyUse"), p("onHand"), p("inTransit"), p("devPct"), p("outsourceYield")]),
    def("MaterialBatch", "物料批次", "supply", [p("batchId", "string", true), p("matId", "string"), p("qty"), p("ageDays"), p("idleDays")]),
    def("Customer", "客户", "commercial", [p("custId", "string", true), p("custName", "string"), p("creditLimit"), p("termDays"), p("receivables"), p("wipUnbilled"), p("maxOverdueDays")]),
    def("ARInvoice", "应收发票", "commercial", [p("invoiceId", "string", true), p("custName", "string"), p("amount"), p("overdueDays")]),
    def("Certification", "认证", "factory", [p("certId", "string", true), p("modelId", "string"), p("lineId", "string"), p("status", "string"), p("certHours"), p("gapContribution")]),
    def("EnergyMeter", "能耗计量", "factory", [p("meterId", "string", true), p("baseId", "string"), p("processKey", "string"), p("energyPerUnit"), p("gridFactor")]),
    def("ChangeoverMatrix", "换型矩阵", "factory", [p("pairId", "string", true), p("fromModel", "string"), p("toModel", "string"), p("minutes")]),
    def("CapexProject", "产能投资项目", "plan", [p("projectId", "string", true), p("name", "string"), p("irr"), p("util24"), p("c23pass", "boolean")]),
    def("PurchaseOrder", "采购订单", "supply", [p("poId", "string", true), p("matId", "string"), p("qty"), p("etaDay"), p("delayed", "boolean")]),
    def("CarbonFactor", "碳因子", "supply", [p("factorId", "string", true), p("kind", "string"), p("key", "string"), p("factor")]),
    // Phase5A 财务域：基地现金账户 + 情景级财务指标（让 finance 进切片，凑满 9 域）。
    def("FinanceAccount", "基地财务账户", "finance", [p("accId", "string", true), p("baseId", "string"), p("cashOnHand"), p("receivable"), p("payable"), p("workingCapital")]),
    def("FinanceMetric", "情景财务指标", "finance", [p("metricId", "string", true), p("scenarioKey", "string"), p("cashCushion"), p("irr"), p("capexSpent"), p("netMargin")]),
    // 外部域（EXT_SIG）：环境/市场信号一等对象（domain=external；规划敏感性输入 P2）。
    def("ExternalSignal", "外部信号", "external", [p("signalKey", "string", true), p("name", "string"), p("category", "string"), p("value"), p("unit", "string"), p("asOf", "string"), p("source", "string"), p("trend", "string"), p("impact", "string"), p("elasticity")]),
  ];
}

const MATERIALS = [
  { matId: "pos_ncm", name: "三元正极", base: 180 },
  { matId: "pos_lfp", name: "磷酸铁锂正极", base: 95 },
  { matId: "neg_graphite", name: "石墨负极", base: 60 },
  { matId: "sep_film", name: "隔膜", base: 28 },
  { matId: "elyte", name: "电解液", base: 45 },
  { matId: "cu_foil", name: "铜箔", base: 70 },
  { matId: "al_foil", name: "铝箔", base: 32 },
  { matId: "cell_case", name: "电芯壳体", base: 18 },
];

const PROVINCE_GRID: Record<string, number> = { changzhou: 0.55, hefei: 0.58, xian: 0.62, chengdu: 0.78, zaozhuang: 0.7, jiangmen: 0.5 };

export interface ExtendedData {
  materials: Record<string, unknown>[];
  materialBatches: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  arInvoices: Record<string, unknown>[];
  certifications: Record<string, unknown>[];
  energyMeters: Record<string, unknown>[];
  changeoverMatrix: Record<string, unknown>[];
  capexProjects: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
  carbonFactors: Record<string, unknown>[];
  financeAccounts: Record<string, unknown>[];
  financeMetrics: Record<string, unknown>[];
}

/** 确定性生成（基于型号/基地/订单上下文 + seed 派生子流）。scale 控工业级数据量（XL）。 */
export function generateExtended(
  seed: number,
  ctx: { models: { modelId: string }[]; bases: { baseId: string; name: string }[]; lines: { lineId: string }[] },
  scale: "S" | "M" | "L" | "XL" = "L",
): ExtendedData {
  const rng = mulberry32(seed + 7919); // 独立子流，与主生成不串扰
  // 工业级数据量：S/M/L 保持原 demo 量级（既有测试），XL 放大到产线真实量级。
  const batchesPerMat = scale === "XL" ? 250 : 3; // 8 料 × 250 = 2000 批
  const poCount = scale === "XL" ? 3000 : 30;
  const extraCustomers = scale === "XL" ? 54 : 0; // 6 + 54 = 60 客户
  const invoicesPerCust = scale === "XL" ? 40 : 3;

  const materials = MATERIALS.map((m) => ({
    matId: m.matId,
    name: m.name,
    unitPrice: round(m.base * (0.9 + rng() * 0.2), 2),
    leadTime: 7 + Math.floor(rng() * 21),
    carbonFactor: round(8 + rng() * 40, 2),
    bomUnit: round(0.5 + rng() * 2, 3),
    dailyUse: round(50 + rng() * 200, 1),
    onHand: round(500 + rng() * 4000, 0),
    inTransit: round(rng() * 1500, 0),
    // C27 长协执行偏差 / C31 外协质量门：从 matId 确定性派生，各植入一处越线。
    devPct: m.matId === "pos_ncm" ? 0.08 : 0.02,
    outsourceYield: m.matId === "sep_film" ? 0.91 : 0.95,
  }));

  // MaterialBatch：每物料 batchesPerMat 批，植入 6 批 >90 日呆滞（XL=工业级 2000 批）
  const materialBatches: Record<string, unknown>[] = [];
  let dormantInjected = 0;
  for (const m of MATERIALS) {
    for (let i = 0; i < batchesPerMat; i++) {
      const makeDormant = dormantInjected < 6 && i === 2; // 每料第3批设呆滞，直到注满6批
      if (makeDormant) dormantInjected++;
      materialBatches.push({
        batchId: `${m.matId}_b${i}`,
        matId: m.matId,
        qty: round(200 + rng() * 800, 0),
        ageDays: makeDormant ? 95 + Math.floor(rng() * 60) : Math.floor(rng() * 80),
        idleDays: makeDormant ? 95 + Math.floor(rng() * 30) : Math.floor(rng() * 60),
      });
    }
  }

  // Customer：6 命名客户（含戏剧点）+ extraCustomers 工业级补充
  const custNames = ["星辰汽车", "蓝海储能", "极光电动", "云岭新能源", "电网公司F", "商用车集团G"];
  const customers = [
    ...custNames.map((name, ci) => ({
      custId: `cust_${ci}`, // ascii pk（避免中文名 sanitize 后 id 碰撞）
      custName: name,
      creditLimit: round(2000 + rng() * 8000, 0),
      termDays: 60,
      receivables: round(rng() * 3000, 0),
      wipUnbilled: round(rng() * 2000, 0),
      maxOverdueDays: name === "商用车集团G" ? 38 : Math.floor(rng() * 25),
    })),
    ...Array.from({ length: extraCustomers }, (_, k) => ({
      custId: `cust_x${k}`,
      custName: `客户${String(k + 1).padStart(3, "0")}`,
      creditLimit: round(1000 + rng() * 9000, 0),
      termDays: 60,
      receivables: round(rng() * 3000, 0),
      wipUnbilled: round(rng() * 2000, 0),
      maxOverdueDays: Math.floor(rng() * 25),
    })),
  ];

  // ARInvoice：每客户 invoicesPerCust 张（G 含逾期张）
  const arInvoices: Record<string, unknown>[] = [];
  for (const [ci, c] of customers.entries()) {
    for (let i = 0; i < invoicesPerCust; i++) {
      arInvoices.push({
        invoiceId: `arinvoice_${ci}_${i}`, // ascii pk（避免与搜索 token 碰撞）
        custName: c.custName,
        amount: round(200 + rng() * 1500, 0),
        overdueDays: c.custName === "商用车集团G" && i === 0 ? 38 : Math.floor(rng() * 20),
      });
    }
  }

  // Certification：型号×产线子集 18 条（量产12/认证中4/待认证2）
  const certifications: Record<string, unknown>[] = [];
  const statuses = [...Array(12).fill("量产"), ...Array(4).fill("认证中"), ...Array(2).fill("待认证")];
  let si = 0;
  outer: for (const m of ctx.models) {
    for (const l of ctx.lines) {
      if (si >= statuses.length) break outer;
      const status = statuses[si++];
      certifications.push({
        certId: `cert_${m.modelId}_${l.lineId}`.replace(/[^\w-]/g, "_"),
        modelId: m.modelId,
        lineId: l.lineId,
        status,
        certHours: 40 + Math.floor(rng() * 160),
        gapContribution: round(rng() * 30, 2),
      });
    }
  }

  // EnergyMeter：每基地一条（省电网因子；成都偏高 → S20 超标戏剧点）
  const energyMeters = ctx.bases.map((b) => ({
    meterId: `em_${b.baseId}`,
    baseId: b.baseId,
    processKey: "涂布",
    energyPerUnit: round(1.5 + rng() * 1.5, 3),
    gridFactor: PROVINCE_GRID[b.baseId] ?? round(0.5 + rng() * 0.3, 2),
  }));

  // ChangeoverMatrix：型号两两（对角 0，同体系 30–60，跨体系 90–180 —— 用名字简化）
  const changeoverMatrix: Record<string, unknown>[] = [];
  for (const a of ctx.models) {
    for (const b of ctx.models) {
      if (a.modelId === b.modelId) continue;
      const cross = a.modelId.includes("LFP") !== b.modelId.includes("LFP");
      changeoverMatrix.push({
        pairId: `${a.modelId}__${b.modelId}`,
        fromModel: a.modelId,
        toModel: b.modelId,
        minutes: cross ? 90 + Math.floor(rng() * 90) : 30 + Math.floor(rng() * 30),
      });
    }
  }

  // CapexProject：3 项目（枣庄达标 / 江门临界 / 一虚构不达标）
  const capexProjects = [
    { projectId: "capex_zaozhuang", name: "枣庄储能线", irr: 0.22, util24: 0.82, c23pass: true },
    { projectId: "capex_jiangmen", name: "江门动力线", irr: 0.155, util24: 0.76, c23pass: true },
    { projectId: "capex_virtual", name: "某低效项目", irr: 0.09, util24: 0.61, c23pass: false },
  ];

  // PurchaseOrder：poCount 单，2 单延迟（XL=工业级 3000 单）
  const purchaseOrders: Record<string, unknown>[] = [];
  for (let i = 0; i < poCount; i++) {
    const m = MATERIALS[i % MATERIALS.length]!;
    purchaseOrders.push({
      poId: `po_${i}`,
      matId: m.matId,
      qty: round(300 + rng() * 1200, 0),
      etaDay: 1 + Math.floor(rng() * 20),
      delayed: i === 5 || i === 17, // 植入 2 单延迟
    });
  }

  // CarbonFactor：物料 8 + 省电网 6
  const carbonFactors = [
    ...materials.map((m) => ({ factorId: `cf_${m.matId}`, kind: "material", key: m.matId, factor: m.carbonFactor })),
    ...Object.entries(PROVINCE_GRID).map(([k, v]) => ({ factorId: `cf_grid_${k}`, kind: "grid", key: k, factor: v })),
  ];

  // Phase5A 财务：每基地现金账户（确定性派生，不动 rng 流）+ 3 情景财务指标。
  const financeAccounts = ctx.bases.map((b, i) => ({
    accId: `fa_${b.baseId}`,
    baseId: b.baseId,
    cashOnHand: round(20 + ((i * 37) % 60), 1), // 亿
    receivable: round(8 + ((i * 53) % 40), 1),
    payable: round(6 + ((i * 29) % 30), 1),
    workingCapital: round(20 + ((i * 37) % 60) + 8 + ((i * 53) % 40) - (6 + ((i * 29) % 30)), 1),
  }));
  const FIN = { conservative: { cashCushion: 72, capex: 3, irr: 9.5, netMargin: 12.5 }, baseline: { cashCushion: 58, capex: 8, irr: 14.2, netMargin: 14.0 }, aggressive: { cashCushion: 42, capex: 27, irr: 18.6, netMargin: 13.2 } };
  const financeMetrics = Object.entries(FIN).map(([k, v]) => ({ metricId: `fm_${k}`, scenarioKey: k, cashCushion: v.cashCushion, irr: v.irr, capexSpent: v.capex, netMargin: v.netMargin }));

  return { materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix, capexProjects, purchaseOrders, carbonFactors, financeAccounts, financeMetrics };
}
