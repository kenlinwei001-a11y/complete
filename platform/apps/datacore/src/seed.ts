/** 种子数据：电池制造场景包（battery-manufacturing）——与 PRD §7.6 一致，所有派生数据由计算得出 */

export interface BaseObj { id: string; name: string; pos: "动力" | "储能" | "动力+储能"; lines: number; gwh: number; year: number; prod: string; util: number; bn: string }
export interface ModelObj { id: string; chem: string; pos: string; bases: string[]; certPending?: string[] }
export interface OrderObj { id: string; so: string; cust: string; model: string; qty: number; due: string; seg: string }

export const T0 = new Date("2026-06-12T00:00:00Z");

export const BASES: BaseObj[] = [
  { id: "b-cz", name: "常州基地·总部", pos: "动力+储能", lines: 8, gwh: 35, year: 2015, prod: "4680·方形三元", util: 88, bn: "化成" },
  { id: "b-xm", name: "厦门基地", pos: "动力", lines: 6, gwh: 28, year: 2019, prod: "方形三元", util: 85, bn: "化成" },
  { id: "b-cd", name: "成都基地", pos: "动力+储能", lines: 7, gwh: 30, year: 2018, prod: "方形·储能", util: 82, bn: "老化" },
  { id: "b-ms", name: "眉山基地", pos: "储能", lines: 5, gwh: 22, year: 2021, prod: "储能LFP", util: 79, bn: "化成" },
  { id: "b-wh", name: "武汉基地", pos: "动力", lines: 5, gwh: 20, year: 2022, prod: "方形三元", util: 80, bn: "涂布" },
  { id: "b-jm", name: "江门基地", pos: "储能", lines: 6, gwh: 26, year: 2021, prod: "储能LFP", util: 83, bn: "老化" },
  { id: "b-hf", name: "合肥基地", pos: "动力", lines: 5, gwh: 20, year: 2022, prod: "方形三元", util: 78, bn: "化成" },
  { id: "b-xy", name: "信阳基地", pos: "储能", lines: 4, gwh: 16, year: 2023, prod: "储能LFP", util: 75, bn: "涂布" },
  { id: "b-zz", name: "枣庄基地", pos: "动力+储能", lines: 4, gwh: 15, year: 2023, prod: "方形·储能", util: 73, bn: "化成" },
  { id: "b-hd", name: "邯郸基地", pos: "储能", lines: 3, gwh: 12, year: 2023, prod: "储能LFP", util: 70, bn: "老化" },
  { id: "b-zg", name: "自贡基地", pos: "动力", lines: 4, gwh: 16, year: 2022, prod: "方形三元", util: 77, bn: "化成" },
  { id: "b-ly", name: "洛阳基地", pos: "储能", lines: 3, gwh: 12, year: 2024, prod: "储能LFP", util: 68, bn: "涂布" },
];

export const MODELS: ModelObj[] = [
  { id: "4680-NCM", chem: "NCM", pos: "动力", bases: ["常州基地·总部", "成都基地", "合肥基地"], certPending: ["合肥基地"] },
  { id: "2170-NCM", chem: "NCM", pos: "动力", bases: ["厦门基地", "武汉基地", "自贡基地"] },
  { id: "方形-NCM", chem: "NCM", pos: "动力", bases: ["常州基地·总部", "成都基地"] },
  { id: "方形-LFP", chem: "LFP", pos: "储能", bases: ["江门基地", "眉山基地", "邯郸基地", "枣庄基地"] },
  { id: "圆柱-LFP", chem: "LFP", pos: "储能", bases: ["信阳基地", "洛阳基地"] },
  { id: "4680-LFP", chem: "LFP", pos: "动力+储能", bases: ["常州基地·总部", "枣庄基地"], certPending: ["枣庄基地"] },
];

const CUSTS = ["头部车企A", "新势力B", "电网公司F", "储能集成商C", "商用车集团G", "海外车企E", "车企D"];
export const ORDERS: OrderObj[] = Array.from({ length: 20 }, (_, i) => {
  const m = MODELS[i % MODELS.length];
  const due = new Date(T0.getTime() + (5 + (i * 4) % 38) * 864e5);
  return {
    id: `o-${3400 + i * 7}`, so: `SO-${3400 + i * 7}`, cust: CUSTS[i % CUSTS.length], model: m.id,
    qty: Math.round((4 + (i * 13) % 30) * 10) / 10,
    due: due.toISOString().slice(0, 10),
    seg: m.pos === "储能" ? "储能" : i % 5 === 4 ? "商用车" : "乘用车",
  };
});

export const RULES = [
  { id: "C03", expression: "demandDelta <= 0.5", scope: "产能预测", severity: "BLOCK" as const, name: "预测产能不得超物理上限", explain: (p: any) => `需求增量 ${(p.demandDelta * 100).toFixed(0)}% 超出物理上限弹性 50%，禁止超限输出` },
  { id: "C08", expression: "outsourceRatio <= 0.2", scope: "方案生成", severity: "BLOCK" as const, name: "外协比例红线 ≤20%", explain: (p: any) => `外协比例 ${(p.outsourceRatio * 100).toFixed(0)}% 超过质量管控红线 20%` },
  { id: "C15", expression: "gmTarget <= gmStruct + 0.3", scope: "毛利", severity: "WARN" as const, name: "接单毛利线", explain: (p: any) => `毛利目标 ${p.gmTarget}% 高于细分结构反推上限 ${p.gmStruct?.toFixed?.(1)}%` },
  { id: "C18", expression: "cashCushion >= 50", scope: "现金流", severity: "BLOCK" as const, name: "现金安全垫 ≥50亿", explain: (p: any) => `滚动13周现金流最低点 ${p.cashCushion} 亿低于安全垫 50 亿` },
];

/** 账号种子：admin / planner / 常州基地负责人（行级权限演示） */
export const USERS = [
  { id: "u-admin", username: "admin", password: "admin123", roles: ["tenant_admin", "catalog_admin", "planner"], attributes: {} as Record<string, any> },
  { id: "u-planner", username: "planner", password: "planner123", roles: ["planner"], attributes: {} },
  { id: "u-czmgr", username: "czmgr", password: "cz123", roles: ["base_manager"], attributes: { baseScope: ["常州基地·总部"] } },
];

export const TENANT = { id: "t-demo", key: "demo", name: "演示租户 · 电池制造" };
