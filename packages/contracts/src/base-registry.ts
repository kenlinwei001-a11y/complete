/**
 * DF.1 单一来源基地册（GenerationBoundary Part A · VOCAB+TOPOLOGY 接地脊柱）。
 * 跨包唯一真相源：datacore 种子（battery.ts BASES）与前端 mock（fixtures.ts BASES /
 * simSolvers.ts MOCK_BASES）皆从此派生各自表示——消灭"改一处崩前后端不同步"漂移（G-5/R14）。
 * 命名以 HTML 参考原型 BASE_DATA 为准（用户裁决 2026-06-23）。
 * R6：本册是数据常量，迁移后各消费端派生值**字节复现当前值**（boundary-singlesource 守门）。
 *
 * 字段 = 三消费端并集：
 *  - datacore BASES 用 {baseId,name,kind,lon,lat}
 *  - 前端 fixtures BASES 用 {id=base-${name},name,util,bottleneck,gwh,position,lines,prodYear,mainProduct,lon,lat}
 *  - 前端 simSolvers MOCK_BASES 用 {name,kind}
 * kind（动力/储能/动力+储能，业态）与 position（动力/储能/混合，前端配色档）显式并存、不互推，避免映射偏差。
 */
export interface CanonicalBase {
  baseId: string; // datacore 拼音 id（changzhou…）
  name: string; // 中文名（跨端共同 key）
  kind: "动力" | "储能" | "动力+储能"; // datacore/MOCK_BASES 业态
  position: "动力" | "储能" | "混合"; // 前端 fixtures 配色档（混合 = 动力+储能）
  lon: number;
  lat: number;
  util: number; // 前端 mock 利用率
  gwh: number; // 前端 mock 产能
  bottleneck: string; // 前端 mock 瓶颈工序
  lines: number;
  prodYear: number;
  mainProduct: string;
}

/**
 * DF.3 单一来源应用细分册（GenerationBoundary · VOCAB+ENUM+RANGE）。
 * 原型 SEG（万元/套单价 + 毛利%/底线% + 配色）此前重复在 battery SEGMENTS / audit.segMargins /
 * 前端 econ / simSolvers / SEG_COLOR 多处——统一为唯一来源，各端派生（值字节复现，R6）。
 * 注：risk.ts affectedOrders 的 SEG_PRICE{0.6…} 是另一营收口径，DF.3b 单独统一（值变、非搬家）。
 */
export interface CanonicalSeg {
  seg: string; // 乘用车/储能/商用车（前端中文 key）
  key: "pas" | "ess" | "com"; // 拼音（audit/risk key）
  priceWan: number; // 万元/套
  marginPct: number; // 毛利率 %
  floorPct: number; // 毛利底线 %
  color: string; // 配色
}

export const SEG_REGISTRY: CanonicalSeg[] = [
  { seg: "乘用车", key: "pas", priceWan: 2.2, marginPct: 19, floorPct: 12, color: "#5E8FE8" },
  { seg: "储能", key: "ess", priceWan: 1.4, marginPct: 13, floorPct: 11, color: "#36BFA5" },
  { seg: "商用车", key: "com", priceWan: 1.8, marginPct: 15, floorPct: 11, color: "#DD9551" },
];

// Wave 1 (#59)：基地产能同步放大到 700 亿收入 / 375 万套年需求规模。
// 缩放系数 SCALE = 375万套 / 132万套 ≈ 2.84（由 SEG_DEMAND 总需求推导，不硬编码在消费端）。
// gwh/lines 为产能指标随需求同比放大；util 为利用率百分比保持原设计区间；
// 所有消费端从 BASE_REGISTRY 派生，改一处全局同步（DF.1/G-5/R14）。
const SCALE = 2.84;

export const BASE_REGISTRY: CanonicalBase[] = [
  { baseId: "changzhou", name: "常州", kind: "动力+储能", position: "混合", lon: 119.95, lat: 31.78, util: 88, gwh: 99.4, bottleneck: "化成柜", lines: 23, prodYear: 2015, mainProduct: "4680-NCM" },
  { baseId: "xiamen", name: "厦门", kind: "动力", position: "动力", lon: 118.1, lat: 24.46, util: 85, gwh: 79.5, bottleneck: "化成柜", lines: 17, prodYear: 2019, mainProduct: "VDA-NCM" },
  { baseId: "chengdu", name: "成都", kind: "动力+储能", position: "混合", lon: 104.07, lat: 30.67, util: 82, gwh: 85.2, bottleneck: "老化库", lines: 20, prodYear: 2018, mainProduct: "4680-LFP" },
  { baseId: "meishan", name: "眉山", kind: "储能", position: "储能", lon: 103.83, lat: 30.05, util: 79, gwh: 62.5, bottleneck: "化成柜", lines: 15, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "wuhan", name: "武汉", kind: "动力", position: "动力", lon: 114.3, lat: 30.59, util: 80, gwh: 56.8, bottleneck: "涂布机", lines: 15, prodYear: 2022, mainProduct: "VDA-NCM" },
  { baseId: "jiangmen", name: "江门", kind: "储能", position: "储能", lon: 113.08, lat: 22.58, util: 83, gwh: 73.8, bottleneck: "老化库", lines: 17, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "hefei", name: "合肥", kind: "动力", position: "动力", lon: 117.28, lat: 31.86, util: 78, gwh: 56.8, bottleneck: "化成柜", lines: 15, prodYear: 2022, mainProduct: "4680-NCM" },
  { baseId: "xinyang", name: "信阳", kind: "储能", position: "储能", lon: 114.09, lat: 32.13, util: 75, gwh: 45.4, bottleneck: "涂布机", lines: 12, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zaozhuang", name: "枣庄", kind: "动力+储能", position: "混合", lon: 117.32, lat: 34.81, util: 73, gwh: 42.6, bottleneck: "化成柜", lines: 12, prodYear: 2023, mainProduct: "4680-LFP" },
  { baseId: "handan", name: "邯郸", kind: "储能", position: "储能", lon: 114.49, lat: 36.61, util: 70, gwh: 34.1, bottleneck: "老化库", lines: 9, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zigong", name: "自贡", kind: "动力", position: "动力", lon: 104.78, lat: 29.34, util: 77, gwh: 45.4, bottleneck: "化成柜", lines: 12, prodYear: 2022, mainProduct: "刀片-LFP" },
  { baseId: "jinhua", name: "金华", kind: "动力", position: "动力", lon: 119.65, lat: 29.08, util: 76, gwh: 39.8, bottleneck: "化成柜", lines: 12, prodYear: 2023, mainProduct: "刀片-LFP" },
  { baseId: "yangzhou", name: "扬州", kind: "储能", position: "储能", lon: 119.42, lat: 32.40, util: 72, gwh: 36.9, bottleneck: "涂布机", lines: 9, prodYear: 2023, mainProduct: "储能-314Ah" },
];

/**
 * DF.4 单一来源规划目标阈值册（GenerationBoundary · VOCAB+RANGE）。
 * 方案生成(plan_generate)的经营目标基线此前**三处重复**：后端 `synthetic/battery.ts planGenerate.targets`
 * （gmFloor 小数口径）· 前端 `PlanGenerateView DEFAULT_GOALS` 兜底（gmFloorPct 百分口径）·
 * 前端 mock `fixtures.ts planGoals`（WorkspaceConfig 下发）——改一处即三处漂移（G-5/R14）。
 * 统一为唯一来源：**canonical 取百分口径**（`gmFloorPct`，前端直用、后端 ÷100 派生小数 gmFloor，
 * R6 字节复现当前值：15.5/100===0.155 精确）。各端派生由 boundary-singlesource 门守不回潮。
 * 注：审计阈值(audit.*)与方案库(risk.mitigations)只在 battery.ts 一处、前端经 API 消费 → 已单一来源，
 * 不入此册（迁移=纯搬家且 audit 校准耦合，无去漂价值）。
 */
export const PLAN_GOAL_TARGETS = {
  revGrowthPct: 18, // 营收增长目标 %
  gmFloorPct: 15.5, // 毛利率底线 %（后端 gmFloor=gmFloorPct/100）
  sharePts: 12, // 份额提升 pct
  capexCap: 20, // CAPEX 上限 亿
  cashFloor: 50, // 现金垫底线 亿
  turns: 6.0, // 库存周转目标 次（后端 turnsFloor / 前端 invTurns）
} as const;

/**
 * DF.7 边界影响图（GenerationBoundary · 单一来源+影响图）：把"改某条边界册会波及谁"显式登记——
 * 回答铁律0 的"改 X 会影响什么"。`members` 派生自册长（非写死）；`consumers` 镜像
 * boundary-singlesource 门所强制校验的派生消费端（门保证其不漂、`boundary-impact.test` 复核每条确实派生）；
 * `downstream` 是 grep 核实的下游受影响面（视图/求解器/派生对象），供改值前评估爆炸半径。
 */
export interface BoundaryConsumer {
  /** 派生消费端源文件。 */
  file: string;
  /** 派生绑定名（消费端把册映射成的本地表示）。 */
  binding: string;
  /** 派生方式 token（门/测试据此校验源码确实从册派生，非内联回潮）。 */
  derivesVia: string;
}
export interface BoundaryRegistryImpact {
  registry: "BASE_REGISTRY" | "SEG_REGISTRY" | "PLAN_GOAL_TARGETS";
  title: string;
  /** 成员数（派生自册长，改册自动同步）。 */
  members: number;
  /** 派生消费端（boundary-singlesource 门强制其从册派生）。 */
  consumers: BoundaryConsumer[];
  /** 下游受影响面（grep 核实：视图/求解器/派生对象）。 */
  downstream: string[];
}

export const BOUNDARY_IMPACT: BoundaryRegistryImpact[] = [
  {
    registry: "BASE_REGISTRY",
    title: "基地集",
    members: BASE_REGISTRY.length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "BASES", derivesVia: "BASE_REGISTRY.map" },
      { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "BASES", derivesVia: "BASE_REGISTRY.map" },
      { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "MOCK_BASES", derivesVia: "BASE_REGISTRY.map" },
    ],
    downstream: [
      "Base 对象库（合成物化）",
      "geo-map 视图（objectType=Base，service.ts）",
      "capacity_forecast/capacity_rollup 求解器（perBaseRows 逐基地）",
      "MODEL_BASE_MAP 型号→基地确定性映射（battery.ts）",
    ],
  },
  {
    registry: "SEG_REGISTRY",
    title: "应用细分集",
    members: SEG_REGISTRY.length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "SEGMENTS / audit.segMargins", derivesVia: "SEG_REGISTRY" },
      { file: "apps/datacore/src/solvers/risk.ts", binding: "SEG_PRICE", derivesVia: "SEG_REGISTRY" },
      { file: "apps/frontend-shell/src/views/plan/OrderChainView.tsx", binding: "ECON / SEG_COLOR", derivesVia: "SEG_REGISTRY" },
      { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "AUDIT_T.segMargins", derivesVia: "SEG_REGISTRY" },
    ],
    downstream: [
      "order-chain 视图 econTable（量价本利）",
      "risk 求解器 affectedOrders.summary.revenue（与 econTable 同源 DF.3b）",
      "DemandSegment 派生 revenueWan=p50×priceWan / marginWan=p50×priceWan×marginPct/100（battery.ts）",
    ],
  },
  {
    registry: "PLAN_GOAL_TARGETS",
    title: "规划目标阈值集",
    members: Object.keys(PLAN_GOAL_TARGETS).length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "planGenerate.targets", derivesVia: "PLAN_GOAL_TARGETS" },
      { file: "apps/frontend-shell/src/views/sim/PlanGenerateView.tsx", binding: "DEFAULT_GOALS", derivesVia: "PLAN_GOAL_TARGETS" },
      { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "planGoals", derivesVia: "PLAN_GOAL_TARGETS" },
    ],
    downstream: [
      "plan_generate 求解器（targets 喂方案达成判定）",
      "方案生成视图 五目标面板默认值 + WorkspaceConfig.planGoals 下发",
    ],
  },
];

/**
 * DF.10 边界册版本化（GenerationBoundary · 改值留痕 + 跨服务缓存失效锚）：
 * semver 手维护（结构变更时 bump）；digest 自动——对各册内容算确定性指纹（djb2，R6 同内容同 digest），
 * 改任一业务常数（基地/价利/目标）→ digest 变，可被审计/缓存失效检测（呼应 DF.7 影响图「改 X」的时间维）。
 * 纯 JS hash（contracts 跨前后端，不用 node:crypto）。
 */
export const BOUNDARY_SEMVER = "1.0.0";

/** 确定性字符串指纹（djb2，无依赖，前后端一致 R6）。 */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export interface BoundaryRegistryVersion {
  registry: "BASE_REGISTRY" | "SEG_REGISTRY" | "PLAN_GOAL_TARGETS";
  members: number;
  digest: string;
}
export interface BoundaryVersion {
  semver: string;
  /** 全册合并指纹（任一册改值即变）。 */
  digest: string;
  registries: BoundaryRegistryVersion[];
}

/** 计算当前边界册版本（semver + 内容指纹）。确定性（R6）：同内容恒同 digest。 */
export function boundaryVersion(): BoundaryVersion {
  const registries: BoundaryRegistryVersion[] = [
    { registry: "BASE_REGISTRY", members: BASE_REGISTRY.length, digest: djb2Hex(JSON.stringify(BASE_REGISTRY)) },
    { registry: "SEG_REGISTRY", members: SEG_REGISTRY.length, digest: djb2Hex(JSON.stringify(SEG_REGISTRY)) },
    { registry: "PLAN_GOAL_TARGETS", members: Object.keys(PLAN_GOAL_TARGETS).length, digest: djb2Hex(JSON.stringify(PLAN_GOAL_TARGETS)) },
  ];
  return { semver: BOUNDARY_SEMVER, digest: djb2Hex(registries.map((r) => `${r.registry}:${r.digest}`).join("|")), registries };
}
