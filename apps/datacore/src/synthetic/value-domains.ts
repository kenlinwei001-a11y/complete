// A6 拟真值域 + 越线植入（确定性，R6）。通用合成路（instantiateGeneric）此前产平坦 uniform/hash 值，
// 无业务分布、无越线样本 → 推演无看点、VLE 查准无素材。本模块把"值落业务区间 + 确定性植入越线/近边界"
// 做成模板可声明的通用能力；值域库按"属性语义"配置化（R14，非按行业写死）；不声明则回落旧 GenSpec（字节一致）。
import type { GenSpec, PlantSpec, ValueDomainShape } from "@platform/contracts";
import { round } from "../prng.js";

interface DomainDef {
  band: [number, number];
  shape: ValueDomainShape;
  precision?: number;
}

/**
 * 值域库（R14 配置化）：键 = 属性语义（小写去分隔后的子串匹配）。模板未给 band/shape 时按此回退。
 * 区间取业务可信范围（如利用率 0.62–0.95、良率 0.90–0.99、毛利率 11–20%）。
 */
export const VALUE_DOMAINS: Record<string, DomainDef> = {
  utilization: { band: [0.62, 0.95], shape: "normal" },
  util: { band: [0.62, 0.95], shape: "normal" },
  oee: { band: [0.55, 0.92], shape: "normal" },
  yield: { band: [0.9, 0.99], shape: "normal", precision: 4 },
  attainment: { band: [0.8, 1.02], shape: "normal" },
  marginpct: { band: [0.11, 0.2], shape: "normal", precision: 4 },
  marginrate: { band: [0.11, 0.2], shape: "normal", precision: 4 },
  grossmargin: { band: [0.11, 0.2], shape: "normal", precision: 4 },
  coverdays: { band: [5, 45], shape: "uniform", precision: 0 },
  coverage: { band: [5, 45], shape: "uniform", precision: 0 },
  leadtime: { band: [7, 60], shape: "uniform", precision: 0 },
  price: { band: [80, 1200], shape: "banded", precision: 2 },
  unitprice: { band: [80, 1200], shape: "banded", precision: 2 },
  cost: { band: [50, 900], shape: "banded", precision: 2 },
  qty: { band: [50, 5000], shape: "banded", precision: 0 },
  quantity: { band: [50, 5000], shape: "banded", precision: 0 },
  capacity: { band: [200, 8000], shape: "normal", precision: 0 },
  demand: { band: [150, 9000], shape: "banded", precision: 0 },
  defectrate: { band: [0.002, 0.05], shape: "banded", precision: 4 },
};

/** 按属性名（小写去 _- 后）子串匹配值域库；命中返回定义，否则 undefined。 */
export function resolveDomainByProp(propKey: string): DomainDef | undefined {
  const norm = propKey.toLowerCase().replace(/[_-]/g, "");
  for (const [key, def] of Object.entries(VALUE_DOMAINS)) {
    if (norm.includes(key)) return def;
  }
  return undefined;
}

/** 默认带宽（库未命中、spec 未给 band）。保守 [0,1] 避免突变。 */
const DEFAULT_BAND: [number, number] = [0, 1];

/**
 * 确定性值域采样（同 rng 同序列字节一致）。
 * - uniform：区间均匀；
 * - normal：固定 Box–Muller（mean=中点, sd=幅/6），截断到 band（消耗 2 个 rng）；
 * - banded：按权重确定性落桶（无 bands 时退化为 3 等分桶按位置权重）。
 */
export function sampleValueDomain(spec: Extract<GenSpec, { kind: "valueDomain" }>, propKey: string, rng: () => number): number {
  const lib = spec.domainKey ? VALUE_DOMAINS[spec.domainKey] : resolveDomainByProp(propKey);
  const band = spec.band ?? lib?.band ?? DEFAULT_BAND;
  const shape = spec.shape ?? lib?.shape ?? "uniform";
  const precision = spec.precision ?? lib?.precision ?? 2;
  const [lo, hi] = band;
  let v: number;
  if (shape === "normal") {
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // 标准正态
    const mean = (lo + hi) / 2;
    const sd = (hi - lo) / 6;
    v = Math.min(hi, Math.max(lo, mean + z * sd)); // 截断到 band
  } else if (shape === "banded") {
    const buckets = spec.bands ?? [
      { range: [lo, lo + (hi - lo) / 3] as [number, number], weight: 0.5 },
      { range: [lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3] as [number, number], weight: 0.35 },
      { range: [lo + (2 * (hi - lo)) / 3, hi] as [number, number], weight: 0.15 },
    ];
    const total = buckets.reduce((a, b) => a + b.weight, 0);
    let r = rng() * total;
    let chosen = buckets[0]!.range;
    for (const b of buckets) { if (r < b.weight) { chosen = b.range; break; } r -= b.weight; }
    v = chosen[0] + rng() * (chosen[1] - chosen[0]);
  } else {
    v = lo + rng() * (hi - lo); // uniform（含未知 shape 回退）
  }
  return round(v, precision);
}

/**
 * 从规则表达式（= 违规谓词，本体口径）反推默认 PlantSpec。仅解析简单形 `Type.field <op> number`；
 * 复杂表达式跳过（返回 undefined，不强行植入）。op：> → gt（值需 > 阈值才违规）；< → lt。
 */
export function derivePlantFromRule(rule: { key: string; expression: string; scopeObjectTypes?: string[] }, typeKey: string): PlantSpec | undefined {
  const m = /(\w+)\.(\w+)\s*(>=|<=|>|<)\s*(-?[\d.]+)/.exec(rule.expression);
  if (!m) return undefined;
  const [, exprType, field, cmp, numStr] = m;
  if (exprType !== typeKey) return undefined;
  const threshold = Number(numStr);
  if (!Number.isFinite(threshold)) return undefined;
  const op: "gt" | "lt" = cmp!.startsWith(">") ? "gt" : "lt";
  return { ruleKey: rule.key, typeKey, field: field!, op, threshold, crossCount: 2, nearCount: 2, delta: Math.max(0.01, Math.abs(threshold) * 0.05 || 0.02) };
}

/**
 * 确定性植入越线/近边界样本（固定索引，可复算）：crossCount 行改写到越线值（threshold ± delta，违规侧），
 * nearCount 行改写到近边界（恰好合规侧）。返回被植入的索引集合（供溯源/报告）。原地改写 rows。
 */
export function applyPlantCrossings(rows: Record<string, unknown>[], plant: PlantSpec): { crossedIdx: number[]; nearIdx: number[] } {
  const crossedIdx: number[] = [];
  const nearIdx: number[] = [];
  const crossVal = plant.op === "gt" ? plant.threshold + plant.delta : plant.threshold - plant.delta; // 越线（违规）
  const nearVal = plant.op === "gt" ? plant.threshold - plant.delta : plant.threshold + plant.delta; // 近边界（合规）
  const k = Math.min(plant.crossCount, rows.length);
  const kn = Math.min(plant.nearCount, Math.max(0, rows.length - k));
  for (let i = 0; i < k; i++) { rows[i]![plant.field] = round(crossVal, 4); crossedIdx.push(i); }
  for (let i = 0; i < kn; i++) { rows[k + i]![plant.field] = round(nearVal, 4); nearIdx.push(k + i); }
  return { crossedIdx, nearIdx };
}

/** 独立谓词（不复用规则引擎）：行是否越线——给 value-domain:check / 测试做查准预言机。 */
export function violatesPlant(row: Record<string, unknown>, plant: PlantSpec): boolean {
  const v = Number(row[plant.field]);
  if (!Number.isFinite(v)) return false;
  return plant.op === "gt" ? v > plant.threshold : v < plant.threshold;
}
