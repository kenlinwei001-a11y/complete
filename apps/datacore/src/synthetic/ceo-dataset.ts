import {
  BASE_REGISTRY,
  SEG_REGISTRY,
  type CeoAtomicGrain,
  type CeoDataset,
  type CeoDatasetGenerateRequest,
  type CeoMetricSummary,
  CEO_DATASET_METRICS,
  type CeoDatasetMetricKey,
} from "@platform/contracts";
import { hashString, mulberry32, randInt, round } from "../prng.js";
import { HTML_ORDERS, MODEL_BASE_MAP, MODELS } from "./battery.js";

/**
 * WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集生成器（纯函数·无 IO·确定性 R6）。
 *
 * 输出每颗都是原子颗粒（order_line / competitor_share / ar_invoice / demand_base_period /
 * segment_period），不预聚合。驾驶舱 KPI 可通过对同 metricKey 的颗粒求和或加权平均
 * 精确复现（back-derivation）。
 *
 * 维度：每颗颗粒必带 tenant_id + period + scenario；按需带 base / product / segment，
 * 使任何 rollup 都能从颗粒重新算回。
 */

const DEFAULT_PERIOD = "2026-Q2";
const DEFAULT_SCENARIO = "actual";

/** 按客户名判定应用细分（与 battery.ts segOfCust 同源）。 */
function segOfCust(cust: string): { segment: string; key: string; priceWan: number; marginPct: number } {
  if (cust.includes("商用车")) return { segment: "商用车", ...SEG_REGISTRY.find((s) => s.key === "com")! };
  if (cust.includes("储能") || cust.includes("电网")) return { segment: "储能", ...SEG_REGISTRY.find((s) => s.key === "ess")! };
  return { segment: "乘用车", ...SEG_REGISTRY.find((s) => s.key === "pas")! };
}

/** 确定性选该型号可产基地之一。 */
function baseForModel(rng: () => number, modelId: string): string {
  const candidates = MODEL_BASE_MAP[modelId] ?? BASE_REGISTRY.map((b) => b.baseId);
  return candidates[Math.floor(rng() * candidates.length)]!;
}

const SCALE_MULTIPLIERS: Record<NonNullable<CeoDatasetGenerateRequest["scale"]>, number> = {
  S: 1,
  M: 5,
  L: 20,
  XL: 100,
};

function isoNow(): string {
  return new Date().toISOString();
}

export interface GenerateCeoDatasetOptions {
  tenantId: string;
  seed?: number;
  scenario?: string;
  period?: string;
  scale?: "S" | "M" | "L" | "XL";
}

/** 生成完整 CEO 原子颗粒数据集。 */
export function generateCeoAtomicDataset(opts: GenerateCeoDatasetOptions): CeoDataset {
  const tenantId = opts.tenantId;
  const seed = opts.seed ?? 42;
  const scenario = opts.scenario ?? DEFAULT_SCENARIO;
  const period = opts.period ?? DEFAULT_PERIOD;
  const scale = opts.scale ?? "S";
  const rng = mulberry32(seed ^ hashString("ceo-dataset"));
  const grains: CeoAtomicGrain[] = [];

  const mult = SCALE_MULTIPLIERS[scale];

  // 1. revenue & gross_profit：每订单行一颗颗粒（最细营收/毛利颗粒）。
  for (let r = 0; r < mult; r++) {
    for (const order of HTML_ORDERS) {
      const orderRng = mulberry32(seed ^ hashString(`rev-${order.so}-${r}`));
      const seg = segOfCust(order.cust);
      const base = baseForModel(orderRng, order.model);
      const unitPrice = seg.priceWan * 10000; // 元/套
      const revenue = round((order.qty * unitPrice) / 10000, 4); // 亿元
      const grossProfit = round(revenue * (seg.marginPct / 100), 4);
      const cost = round(revenue - grossProfit, 4);
      const grainId = r === 0 ? order.so : `${order.so}~${r}`;

      grains.push({
        tenantId,
        metricKey: "revenue",
        grainType: "order_line",
        grainId,
        period,
        scenario,
        base,
        product: order.model,
        segment: seg.key,
        value: revenue,
        valueUnit: "亿元",
        dimensions: { so: order.so, cust: order.cust, qty: order.qty, unitPrice },
        provenanceSynthetic: true,
      });

      grains.push({
        tenantId,
        metricKey: "gross_profit",
        grainType: "order_line",
        grainId,
        period,
        scenario,
        base,
        product: order.model,
        segment: seg.key,
        value: grossProfit,
        valueUnit: "亿元",
        dimensions: { so: order.so, cust: order.cust, qty: order.qty, cost, revenue },
        provenanceSynthetic: true,
      });
    }
  }

  // 2. market_share：每竞品 × 细分 × 期间一颗份额颗粒。
  const competitors = ["我方", "竞对A", "竞对B", "竞对C"];
  for (const seg of SEG_REGISTRY) {
    const shareRng = mulberry32(seed ^ hashString(`ms-${seg.key}`));
    // 确定性生成份额，确保每细分和为 100。
    let remaining = 100;
    const segmentShares: { competitor: string; sharePct: number }[] = [];
    for (let i = 0; i < competitors.length - 1; i++) {
      const max = Math.max(5, remaining - (competitors.length - 1 - i) * 5);
      const share = randInt(shareRng, 5, max);
      segmentShares.push({ competitor: competitors[i]!, sharePct: share });
      remaining -= share;
    }
    segmentShares.push({ competitor: competitors[competitors.length - 1]!, sharePct: remaining });

    // 用总市场规模做分母，使加权平均 = 我方份额。
    const marketSize = 1000 + randInt(shareRng, 0, 500); // 抽象市场规模单位
    for (const s of segmentShares) {
      const sharePts = round((s.sharePct / 100) * marketSize, 2);
      grains.push({
        tenantId,
        metricKey: "market_share",
        grainType: "competitor_share",
        grainId: `ms-${seg.key}-${s.competitor}`,
        period,
        scenario,
        segment: seg.key,
        value: round(s.sharePct, 2),
        valueUnit: "%",
        numerator: sharePts,
        denominator: marketSize,
        dimensions: { competitor: s.competitor, marketSize, segmentName: seg.seg },
        provenanceSynthetic: true,
      });
    }
  }

  // 3. cash：每客户 AR 发票颗粒（金额 + 逾期天数）。
  const uniqueCustomers = [...new Set(HTML_ORDERS.map((o) => o.cust))];
  for (let r = 0; r < mult; r++) {
    for (const cust of uniqueCustomers) {
      const seg = segOfCust(cust);
      const nInvoices = randInt(rng, 1, 3);
      for (let i = 0; i < nInvoices; i++) {
        const invoiceRng = mulberry32(seed ^ hashString(`cash-${cust}-${i}-${r}`));
        const amount = round(1 + invoiceRng() * 9, 2); // 亿元
        const overdueDays = randInt(invoiceRng, -15, 90);
        const bucket = overdueDays <= 0 ? "current" : overdueDays <= 30 ? "1-30" : overdueDays <= 60 ? "31-60" : overdueDays <= 90 ? "61-90" : "90+";
        const grainId = r === 0 ? `inv-${cust}-${i}` : `inv-${cust}-${i}~${r}`;
        grains.push({
          tenantId,
          metricKey: "cash",
          grainType: "ar_invoice",
          grainId,
          period,
          scenario,
          segment: seg.key,
          value: amount,
          valueUnit: "亿元",
          dimensions: { customer: cust, overdueDays, bucket },
          provenanceSynthetic: true,
        });
      }
    }
  }

  // 4. demand_attain：每细分 × 基地 × 期间的需求目标/实际颗粒。
  const bases = BASE_REGISTRY.map((b) => b.baseId);
  for (const seg of SEG_REGISTRY) {
    for (const base of bases) {
      const demandRng = mulberry32(seed ^ hashString(`demand-${seg.key}-${base}`));
      const target = round(50 + demandRng() * 150, 1); // 万套
      const actual = round(target * (0.85 + demandRng() * 0.2), 1);
      grains.push({
        tenantId,
        metricKey: "demand_attain",
        grainType: "demand_base_period",
        grainId: `demand-${seg.key}-${base}`,
        period,
        scenario,
        base,
        segment: seg.key,
        value: round((actual / target) * 100, 2),
        valueUnit: "%",
        numerator: actual,
        denominator: target,
        dimensions: { segmentName: seg.seg },
        provenanceSynthetic: true,
      });
    }
  }

  // 5. seg_attain：每细分 × 期间的计划目标/实际颗粒（与 demand_attain 不同 grain，不互为聚合）。
  for (const seg of SEG_REGISTRY) {
    const segRng = mulberry32(seed ^ hashString(`seg-${seg.key}`));
    const target = round(100 + segRng() * 200, 1);
    const actual = round(target * (0.8 + segRng() * 0.25), 1);
    grains.push({
      tenantId,
      metricKey: "seg_attain",
      grainType: "segment_period",
      grainId: `seg-${seg.key}`,
      period,
      scenario,
      segment: seg.key,
      value: round((actual / target) * 100, 2),
      valueUnit: "%",
      numerator: actual,
      denominator: target,
      dimensions: { segmentName: seg.seg },
      provenanceSynthetic: true,
    });
  }

  const byMetric = computeByMetric(grains);

  return {
    tenantId,
    seed,
    scenario,
    period,
    generatedAt: isoNow(),
    metrics: [...CEO_DATASET_METRICS],
    grains,
    byMetric,
  };
}

/** 从原子颗粒派生各指标摘要（back-derivation）。 */
function computeByMetric(grains: CeoAtomicGrain[]): Record<CeoDatasetMetricKey, CeoMetricSummary> {
  const byMetric: Partial<Record<CeoDatasetMetricKey, CeoMetricSummary>> = {};
  for (const key of CEO_DATASET_METRICS) {
    const list = grains.filter((g) => g.metricKey === key);
    const count = list.length;
    const sum = round(list.reduce((s, g) => s + g.value, 0), 6);
    const avg = count > 0 ? round(sum / count, 6) : 0;
    const unit = list[0]?.valueUnit ?? "";

    let kpiValue = sum;
    let denominatorSum: number | undefined;
    if (key === "market_share" || key === "demand_attain" || key === "seg_attain") {
      // 加权平均：value 本身是比例，但保留 numerator/denominator 用于精确复现。
      const num = list.reduce((s, g) => s + (g.numerator ?? g.value), 0);
      const den = list.reduce((s, g) => s + (g.denominator ?? 1), 0);
      kpiValue = den > 0 ? round((num / den) * 100, 2) : 0;
      denominatorSum = den;
    }

    byMetric[key] = {
      count,
      sum,
      avg,
      unit,
      kpiValue,
      ...(denominatorSum !== undefined ? { denominatorSum } : {}),
    };
  }
  return byMetric as Record<CeoDatasetMetricKey, CeoMetricSummary>;
}

/** 便捷：生成报告摘要。 */
export function ceoDatasetReport(dataset: CeoDataset): {
  tenantId: string;
  seed: number;
  scenario: string;
  period: string;
  totalGrains: number;
  metricKeys: CeoDatasetMetricKey[];
} {
  return {
    tenantId: dataset.tenantId,
    seed: dataset.seed,
    scenario: dataset.scenario,
    period: dataset.period,
    totalGrains: dataset.grains.length,
    metricKeys: dataset.metrics,
  };
}
