// A3.1 · 电池 66 类型 → 14 业务域 覆盖验收报告。
// 把 batteryObjectTypes + extendedObjectTypes 的域归一化到 14 域注册表，
// 输出每个域覆盖的类型清单与覆盖度（C4 证据）。

import { batteryObjectTypes } from "../synthetic/battery.js";
import { extendedObjectTypes } from "../synthetic/battery-extended.js";
import { BUSINESS_DOMAINS, BUSINESS_DOMAIN_KEYS } from "../graphmeta.js";

/** 旧/模板域 → 14 业务域注册表 的归一化映射。 */
export const DOMAIN_NORMALIZATION: Record<string, string> = {
  factory: "factory",
  product: "product",
  process: "process",
  equip: "equip",
  people: "people",
  quality: "quality",
  capacity: "capacity",
  forecast: "forecast",
  sales: "sales",
  material: "material",
  finance: "finance",
  plan: "plan",
  external: "external",
  decision: "decision",
  // 模板历史命名映射
  supply: "material",
  commercial: "sales",
};

export interface BatteryDomainCoverage {
  totalTypes: number;
  coverage: { domain: string; displayName: string; count: number; types: string[] }[];
  unassigned: string[];
  fullyCovered: boolean;
}

/** 收集全部 66 个电池对象类型，归一化到 14 域。 */
export function buildBatteryDomainCoverage(): BatteryDomainCoverage {
  const batteryTypes = [...batteryObjectTypes(), ...extendedObjectTypes()];
  const byDomain = new Map<string, string[]>();
  const unassigned: string[] = [];

  for (const t of batteryTypes) {
    const rawDomain = t.domain ?? "unassigned";
    const normalized = DOMAIN_NORMALIZATION[rawDomain];
    if (!normalized || !BUSINESS_DOMAIN_KEYS.includes(normalized)) {
      unassigned.push(t.key);
      continue;
    }
    if (!byDomain.has(normalized)) byDomain.set(normalized, []);
    byDomain.get(normalized)!.push(t.key);
  }

  const coverage = BUSINESS_DOMAINS.map((d) => ({
    domain: d.key,
    displayName: d.displayName,
    count: byDomain.get(d.key)?.length ?? 0,
    types: [...(byDomain.get(d.key) ?? [])].sort(),
  }));

  return {
    totalTypes: batteryTypes.length,
    coverage,
    unassigned: unassigned.sort(),
    fullyCovered: unassigned.length === 0 && coverage.every((c) => c.count > 0),
  };
}
