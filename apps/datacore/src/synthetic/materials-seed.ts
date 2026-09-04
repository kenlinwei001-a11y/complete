/**
 * 物料种子的**单一实现**（WO-UNITCOST-LAND 抽出）。
 *
 * ══ 为什么要抽出来，而不是在 battery.ts 里再算一遍物料价 ══════════════════════
 *
 * `Model.unitCost`（每电芯物料成本，元）= Σ BOMDetail.quantity ×(1+lossRate)× Material.unitPrice。
 * BOM 在 `battery.ts`（`generateBattery`），而 `Material.unitPrice` 在 `battery-extended.ts`
 * （`generateExtended`）—— 两边都要读同一份物料价。
 *
 * 三条路都堵死了，只剩抽公共模块这一条：
 *  ① `battery.ts` 反向 import `battery-extended.ts` ⇒ **循环依赖**
 *     （`battery-extended.ts` 已经 import `battery.js` 取 `withPropDisplayNames` 等，
 *     且那几个符号在模块初始化期就要用 ⇒ TDZ，启动即炸）。
 *  ② 在 `battery.ts` 里照抄一份 `round(base*(0.9+rng()*0.2),2)` 重放 ⇒ **两份实现**。
 *     本仓纪律明写「金丝雀必须与主逻辑共用同一份实现，抄了就是装饰品」——
 *     抄的那份迟早与主逻辑漂移，而漂移了**不报错**，只是两处物料价悄悄不等。
 *  ③ 把注入挪到 `service.ts`（`generateExtended` 之后）⇒ `generateBattery` 单独跑时
 *     （`livedin/engine.ts`、十余个测试）**Model 身上没有 unitCost**，
 *     而对象类型上又声明了它 ⇒ 正是「接了线没数据」那一态。
 *
 * ══ R6 字节确定性：这次抽出**一次 rng 调用都没有增减** ═══════════════════════
 *
 * `generateExtended` 原本第一句就是 `const rng = mulberry32(seed + 7919)`，紧接着
 * `materials` 是该流上**第一个**消费者。本函数把「建流 + 产物料」整段搬过来，
 * 并**把 rng 本身连同物料一起返回**，让 `generateExtended` 拿着同一个 rng 继续往下抽 ——
 * 流的位置、次数、顺序全部原样，故 `generateExtended` 的全部下游合成值逐字节不动。
 *
 * `battery.ts` 侧则是**另建一条自己的流**（同 seed ⇒ 同物料价），用完即弃，
 * **不碰 `generateBattery` 自己的任何 rng 流** ⇒ 既有 90 个集合的字节基线同样不动。
 * 实测：接线前后 `TOTAL` 逐集合比对，仅 `models` / `orderLines` 两个集合变化，
 * 剔除新增字段后两者 hash 回到基线值。
 */
import { WAVE1_SCALE_FACTOR } from "@platform/contracts";
import { mulberry32, round } from "../prng.js";

/** 物料基表（matId / 基准价 / 计量单位 / 主供…）。基准价 `base` 的量纲见 `unit` 那一格。 */
export const MATERIALS = [
  { matId: "pos_ncm", name: "三元正极", base: 180, materialCode: "MAT-001", category: "正极材料", spec: "NCM811", unit: "kg", isKey: true, supplierIds: ["SUP-001", "SUP-002"] },
  { matId: "pos_lfp", name: "磷酸铁锂正极", base: 95, materialCode: "MAT-002", category: "正极材料", spec: "LFP-100", unit: "kg", isKey: true, supplierIds: ["SUP-001", "SUP-003"] },
  { matId: "neg_graphite", name: "石墨负极", base: 60, materialCode: "MAT-003", category: "负极材料", spec: "人造石墨", unit: "kg", isKey: true, supplierIds: ["SUP-004", "SUP-005"] },
  { matId: "sep_film", name: "隔膜", base: 28, materialCode: "MAT-004", category: "隔膜", spec: "湿法隔膜", unit: "㎡", isKey: true, supplierIds: ["SUP-006", "SUP-007"] },
  // WO-SANDBOX-D2：高电压电解液的主供改为进口（SUP-015·日本）——**这是为了让清关段有真数据可测**，
  // 而不是为了好看：全 14 家原供应商都是境内（region 华东/华北/…），清关段永远 NOT_APPLICABLE 就等于没接线。
  // 国内电池厂高端电解液/添加剂从日本进口是行业实况，非臆造。境内二供 SUP-008/009 保留（备份路径不变）。
  { matId: "elyte", name: "电解液", base: 45, materialCode: "MAT-005", category: "电解液", spec: "高电压电解液", unit: "L", isKey: true, supplierIds: ["SUP-015", "SUP-008", "SUP-009"] },
  { matId: "cu_foil", name: "铜箔", base: 70, materialCode: "MAT-006", category: "其他", spec: "6μm铜箔", unit: "kg", isKey: false, supplierIds: ["SUP-010"] },
  { matId: "al_foil", name: "铝箔", base: 32, materialCode: "MAT-007", category: "其他", spec: "12μm铝箔", unit: "kg", isKey: false, supplierIds: ["SUP-011"] },
  { matId: "cell_case", name: "电芯壳体", base: 18, materialCode: "MAT-008", category: "结构件", spec: "4680壳体", unit: "个", isKey: true, supplierIds: ["SUP-012", "SUP-013"] },
];

/** 物料合成行的形状（`generateExtended` 原地产出的那一批，字段一个不多一个不少）。 */
export type SeededMaterial = {
  matId: string; name: string; unitPrice: number; leadTime: number; carbonFactor: number;
  bomUnit: number; dailyUse: number; onHand: number; inTransit: number; devPct: number;
  outsourceYield: number; materialCode: string; category: string; spec: string; unit: string;
  supplierId: string; shelfLife: number; isKeyMaterial: boolean; status: string;
};

/**
 * 建 `seed + 7919` 子流并产出物料行。**rng 一并返回**，调用方要续用同一条流就接着抽。
 *
 * ⚠ 两个调用方，两种用法，缺一不可：
 *  · `generateExtended`：`const { rng, materials } = seedMaterials(seed)` —— 续用 rng（流位置不变）。
 *  · `generateBattery`：只取 `.materials` 里的 `unitPrice`，rng 丢弃（自建自弃，不污染主流）。
 */
export function seedMaterials(seed: number): { rng: () => number; materials: SeededMaterial[] } {
  const rng = mulberry32(seed + 7919); // 独立子流，与主生成不串扰
  const materials: SeededMaterial[] = MATERIALS.map((m) => ({
    matId: m.matId,
    name: m.name,
    unitPrice: round(m.base * (0.9 + rng() * 0.2), 2),
    leadTime: 7 + Math.floor(rng() * 21),
    carbonFactor: round(8 + rng() * 40, 2),
    bomUnit: round(0.5 + rng() * 2, 3),
    dailyUse: round((50 + rng() * 200) * WAVE1_SCALE_FACTOR, 1),
    onHand: round((500 + rng() * 4000) * WAVE1_SCALE_FACTOR, 0),
    inTransit: round(rng() * 1500 * WAVE1_SCALE_FACTOR, 0),
    // C27 长协执行偏差 / C31 外协质量门：从 matId 确定性派生，各植入一处越线。
    devPct: m.matId === "pos_ncm" ? 0.08 : 0.02,
    outsourceYield: m.matId === "sep_film" ? 0.91 : 0.95,
    // Phase 2 Wave 2：扩展工程属性（固定值，不消耗 rng，保 R6）。
    materialCode: m.materialCode,
    category: m.category,
    spec: m.spec,
    unit: m.unit,
    supplierId: m.supplierIds[0] as string,
    shelfLife: m.matId === "elyte" ? 180 : m.matId === "sep_film" ? 365 : 730,
    isKeyMaterial: m.isKey,
    status: "活跃",
  }));
  return { rng, materials };
}

/** 物料价查表（matId → 元/该料计量单位）。`battery.ts` 算 `Model.unitCost` 用。 */
export function materialUnitPrices(seed: number): Map<string, number> {
  return new Map(seedMaterials(seed).materials.map((m) => [m.matId, m.unitPrice]));
}
