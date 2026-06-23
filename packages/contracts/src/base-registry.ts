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

export const BASE_REGISTRY: CanonicalBase[] = [
  { baseId: "changzhou", name: "常州", kind: "动力+储能", position: "混合", lon: 119.95, lat: 31.78, util: 88, gwh: 35, bottleneck: "化成柜", lines: 8, prodYear: 2015, mainProduct: "4680-NCM" },
  { baseId: "xiamen", name: "厦门", kind: "动力", position: "动力", lon: 118.1, lat: 24.46, util: 85, gwh: 28, bottleneck: "化成柜", lines: 6, prodYear: 2019, mainProduct: "VDA-NCM" },
  { baseId: "chengdu", name: "成都", kind: "动力+储能", position: "混合", lon: 104.07, lat: 30.67, util: 82, gwh: 30, bottleneck: "老化库", lines: 7, prodYear: 2018, mainProduct: "4680-LFP" },
  { baseId: "meishan", name: "眉山", kind: "储能", position: "储能", lon: 103.83, lat: 30.05, util: 79, gwh: 22, bottleneck: "化成柜", lines: 5, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "wuhan", name: "武汉", kind: "动力", position: "动力", lon: 114.3, lat: 30.59, util: 80, gwh: 20, bottleneck: "涂布机", lines: 5, prodYear: 2022, mainProduct: "VDA-NCM" },
  { baseId: "jiangmen", name: "江门", kind: "储能", position: "储能", lon: 113.08, lat: 22.58, util: 83, gwh: 26, bottleneck: "老化库", lines: 6, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "hefei", name: "合肥", kind: "动力", position: "动力", lon: 117.28, lat: 31.86, util: 78, gwh: 20, bottleneck: "化成柜", lines: 5, prodYear: 2022, mainProduct: "4680-NCM" },
  { baseId: "xinyang", name: "信阳", kind: "储能", position: "储能", lon: 114.09, lat: 32.13, util: 75, gwh: 16, bottleneck: "涂布机", lines: 4, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zaozhuang", name: "枣庄", kind: "动力+储能", position: "混合", lon: 117.32, lat: 34.81, util: 73, gwh: 15, bottleneck: "化成柜", lines: 4, prodYear: 2023, mainProduct: "4680-LFP" },
  { baseId: "handan", name: "邯郸", kind: "储能", position: "储能", lon: 114.49, lat: 36.61, util: 70, gwh: 12, bottleneck: "老化库", lines: 3, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zigong", name: "自贡", kind: "动力", position: "动力", lon: 104.78, lat: 29.34, util: 77, gwh: 16, bottleneck: "化成柜", lines: 4, prodYear: 2022, mainProduct: "刀片-LFP" },
  { baseId: "luoyang", name: "洛阳", kind: "储能", position: "储能", lon: 112.45, lat: 34.62, util: 68, gwh: 12, bottleneck: "涂布机", lines: 3, prodYear: 2024, mainProduct: "储能-314Ah" },
];
