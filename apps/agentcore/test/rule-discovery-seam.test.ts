import { describe, it, expect } from "vitest";
import type { IntelligenceResource } from "@platform/contracts";
import { projectRules } from "../src/dril/resource-projector.js";
import { ResourceSearchEngine } from "../src/dril/search-engine.js";
import { extractTieredTags } from "../src/dril/tag-taxonomy.js";
import type { RuleSummary } from "../src/tools/clients.js";

/**
 * WO-RULE-DISCOVERY · 规则发现面 SEAM 门。
 *
 * 病根（`docs/AUDIT-rule-discoverability-20260912.md` §5.4，真起服务两臂实测）：
 * 规则进 DRIL 索引时唯一的可检索文本是 4–8 字的 name（description 回落 name·tags/answersQuestions 0/30），
 * 召回由问句与规则名的字面重合度决定 ⇒ 念名字 30/30，真实场景问句 5/20——「查字典」不是「发现」。
 *
 * 本门驱动两半接缝，任一半漏即红：
 *   ① 投影半：`projectRules` 必须把 description/tags/answersQuestions 投出去
 *      （此前**即便种子填了也投不出去**——投影函数缺切片那两行，症状是「填了没反应」而四包全绿）；
 *   ② 检索半：投影出的资源进 `ResourceSearchEngine` 后，**真实场景问句**（非念规则名）必须召回对口规则。
 *
 * ⚠ 这里的规则元数据是 datacore `BATTERY_RULES` 的**镜像样例子集**（跨包禁 import 源码）；
 *   真数据全量验收（30 条 × 20 场景问句两臂）在本单报告的 runtime 对照实验（真起服务）。
 */

// ── 镜像样例：9 条带元数据规则（与 battery.ts 同文案）──────────────────────────
const RICH_RULES: RuleSummary[] = [
  { key: "C01", name: "产线设计产能上限", severity: "BLOCK", scopeObjectTypes: ["Line"],
    expression: "Line.weeklyCapacityWan > Line.designCeilingWan",
    description: "产线周产能 weeklyCapacityWan 超过设计上限 designCeilingWan 即阻断——排产/承接不得突破产线设计能力。",
    tags: ["产能", "设计上限", "产线", "承接评审"],
    answersQuestions: ["4680-NCM 加 20% 六周能不能接？", "产线最大能排到多少产能？"] },
  { key: "C03", name: "产能上限约束", severity: "BLOCK", scopeObjectTypes: ["Order"],
    expression: "Order.demandDelta > 0.5",
    description: "订单需求增量 demandDelta 超过 50% 即阻断——需求增幅超出产能可吸收范围的承接评审线。",
    tags: ["产能", "承接评审", "需求增量"],
    answersQuestions: ["4680-NCM 加 20% 六周能不能接？", "订单加量多少就接不了了？"] },
  { key: "C08", name: "外协比例红线", severity: "WARN", scopeObjectTypes: ["Order"],
    expression: "Order.outsourceRatio > params.outsourceRatioMax",
    description: "订单外协比例超过命名阈值 params.outsourceRatioMax 即预警——外协可补缺口保交付，越线提示风险敞口。",
    tags: ["外协", "红线", "缺口补缺", "比例"],
    answersQuestions: ["推荐哪个经营方案？", "缺口 8 万套自产加班还是外协？", "Q2 缺口用什么组合补？"] },
  { key: "C12", name: "预测偏差触发重校", severity: "WARN", scopeObjectTypes: ["Model"],
    expression: "SUSTAIN(Model.forecast_deviation > 0.08, 1)",
    description: "型号预测偏差 forecast_deviation 超过 8% 即触发预警——预测与实际差到这条线就该重新校准需求预测。",
    tags: ["需求", "预测偏差", "重校", "预测"],
    answersQuestions: ["需求预测偏差多大要重新校准？", "预测和实际差多少要重校？"] },
  { key: "C24", name: "接单毛利过线", severity: "BLOCK", scopeObjectTypes: ["Quote"],
    expression: "Quote.marginPct < Quote.floorPct",
    description: "报价毛利率低于地板线 floorPct 即阻断——毛利不过线的报价不建议接单。",
    tags: ["财务", "毛利", "报价", "接单评审"],
    answersQuestions: ["小鹏汽车这单毛利过线吗？", "这单报价毛利够不够地板线？"] },
  { key: "C26", name: "认证资源上限", severity: "BLOCK", scopeObjectTypes: ["Cert"],
    expression: "Cert.parallelTasks > Cert.engineerGroups",
    description: "并行认证任务数超过认证工程师组数即阻断——认证排期不得超过真实人力组数。",
    tags: ["认证", "资源上限", "排期"],
    answersQuestions: ["待认证的型号怎么排认证顺序？", "认证资源最多能并行几个型号？"] },
  { key: "C30", name: "良率连降停线评审", severity: "BLOCK", scopeObjectTypes: ["Process"],
    expression: "SUSTAIN(Process.dailyYield < Process.yieldFloor, 3)",
    description: "工序日良率连续 3 天低于良率地板 yieldFloor（基线−0.02）即阻断并触发停线评审——连降不是波动，是工艺失控信号。",
    tags: ["质量", "良率", "停线评审", "工序"],
    answersQuestions: ["涂布良率为什么掉了？", "良率连续下降几天要停线评审？"] },
  { key: "C33", name: "碳护照前置", severity: "BLOCK", scopeObjectTypes: ["Order"],
    expression: "NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)",
    description: "目的地为欧盟的订单碳足迹超过其欧盟碳阈值即阻断——出口欧盟须先过碳护照，不达标不得承诺出口单。",
    tags: ["合规", "碳足迹", "欧盟", "碳护照", "出口"],
    answersQuestions: ["4680-NCM 出口欧盟的碳足迹达标吗？", "出口欧盟的单碳足迹超限怎么办？"] },
  { key: "C34", name: "跨业务线产能争用", severity: "BLOCK", scopeObjectTypes: ["Base"],
    expression: "COUNT(Base.segClaims.dailyRate) > 1 AND Base.claimedDailyRate > Base.capacityDailyPacks",
    description: "同一基地被 2 条以上业务线申报日产率、且申报合计超过基地日产能即阻断——专判跨业务线抢产能。",
    tags: ["产能", "争用", "业务线", "基地"],
    answersQuestions: ["常州和金华这两条业务线抢同一个基地的产能吗？", "多条业务线争同一个基地产能怎么裁？"] },
];

/** 同一批规则的**剥元数据**版（= 改造前形态：description/tags/answersQuestions 全无，投影回落 name）。 */
const STRIPPED_RULES: RuleSummary[] = RICH_RULES.map((r) => ({
  key: r.key,
  name: r.name,
  severity: r.severity,
  scopeObjectTypes: r.scopeObjectTypes,
  expression: r.expression,
}));

const ONTOLOGY_TYPES = [
  { key: "Base", label: "基地" },
  { key: "Line", label: "产线" },
  { key: "Model", label: "型号" },
  { key: "Order", label: "订单" },
  { key: "Customer", label: "客户" },
];

/** 镜像 registry 投影期回填（resource-registry.ts `enrichTieredTags`：L4 从本体类型派生）。 */
function withTiered(summaries: RuleSummary[]): IntelligenceResource[] {
  return projectRules(summaries).map((r) => ({
    ...r,
    tieredTags: extractTieredTags(`${r.label} ${r.description}`, {
      domain: r.domain,
      candidateTypes: r.scopeObjectTypes,
      ontologyTypes: ONTOLOGY_TYPES,
    }),
  })) as unknown as IntelligenceResource[];
}

/** 镜像求解器目录子集（混池回归用·带 answersQuestions 的强竞争对手也在，不许挑软柿子）。 */
const SOLVER_POOL = [
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", domain: "plan" },
  { key: "kit_readiness", name: "物料齐套", description: "逐单算齐套率（含在途按 ETA），输出缺料与建议。", domain: "material" },
  { key: "yield_diagnosis", name: "良率诊断", description: "2σ 滑窗突变检测 + 根因候选按时间贴近度排序。", domain: "quality" },
  { key: "credit_exposure", name: "信用敞口", description: "敞口=应收+在产；可用额与逾期判定（C32）。", domain: "finance" },
  { key: "carbon_footprint", name: "碳足迹核算", description: "物料+能耗两段碳排，对比欧盟阈值给改善杠杆。", domain: "plan" },
  { key: "cert_schedule", name: "认证排期", description: "按缺口贡献/工时优先级，受 C26 并行约束贪心排认证到周。", domain: "plan" },
  { key: "changeover_sequence", name: "换型排序", description: "最近邻贪心最小化换型时长，标注交期不可行单。", domain: "plan" },
  { key: "quote_margin", name: "接单毛利评审", description: "报价毛利过线评审（C15/C24），输出 verdict 与缺口。", domain: "finance" },
  { key: "inventory_optimize", name: "库存优化", description: "目标水位/超储/欠储/呆滞与可释放资金。", domain: "material" },
  { key: "gap_attribution", name: "深度反向缺口归因", description: "总目标缺口沿本体反向多跳结构分摊到基地×订单×瓶颈叶，产原子因素表+residual。", domain: "decision",
    answersQuestions: ["为什么这个指标没达标", "份额下降的根因是什么"], tags: ["gap", "attribution", "rootcause", "缺口归因"] },
];

import { projectSolvers, type CatalogItem } from "../src/dril/resource-projector.js";
// 生产相关性门槛（活目录注入/检索过滤同一条线）：得分低于它 = 生产态不可达。
// 直接 import 常量而非抄值——另一张单正在调这条门槛，import 保证本门永远按**现行**门槛判。
import { LIVE_CAPABILITY_MIN_SCORE } from "../src/agent/live-capability-map.js";

function solverResources(): IntelligenceResource[] {
  return projectSolvers(SOLVER_POOL as CatalogItem[]).map((r) => ({
    ...r,
    tieredTags: extractTieredTags(`${r.label} ${r.description} ${r.capability ?? ""}`, {
      domain: r.domain,
      ontologyTypes: ONTOLOGY_TYPES,
    }),
  })) as unknown as IntelligenceResource[];
}

const engine = new ResourceSearchEngine({ ontologyTypes: ONTOLOGY_TYPES });
const richPool = withTiered(RICH_RULES);
const strippedPool = withTiered(STRIPPED_RULES);

function ruleRank(pool: IntelligenceResource[], query: string, key: string): number {
  const res = engine.search(query, pool, { maxResults: 20, minScore: 0 });
  return res.results.findIndex((r) => r.resource.kind === "rule" && r.resource.key === key);
}
function ruleScore(pool: IntelligenceResource[], query: string, key: string): number {
  const res = engine.search(query, pool, { maxResults: 20, minScore: 0 });
  return res.results.find((r) => r.resource.kind === "rule" && r.resource.key === key)?.score ?? 0;
}

describe("WO-RULE-DISCOVERY · 接缝①：projectRules 把发现面元数据投出去", () => {
  it("description 用真文本（不回落 name）· tags/answersQuestions 进资源", () => {
    const c33 = projectRules(RICH_RULES).find((r) => r.key === "C33")!;
    expect(c33.description).toContain("欧盟");
    expect(c33.description).not.toBe("碳护照前置"); // 回落 name = 字典式可检索，不算发现面
    expect(c33.tags).toContain("碳足迹");
    expect(c33.answersQuestions).toContain("4680-NCM 出口欧盟的碳足迹达标吗？");
  });

  it("种子没填时诚实回落 name（不编业务含义·向后兼容旧规则）", () => {
    const c33 = projectRules(STRIPPED_RULES).find((r) => r.key === "C33")!;
    expect(c33.description).toBe("碳护照前置");
    expect(c33.tags).toBeUndefined();
    expect(c33.answersQuestions).toBeUndefined();
  });
});

describe("WO-RULE-DISCOVERY · 接缝②：真实场景问句召回（对照：同一引擎·富元数据 vs 剥光）", () => {
  // 诊断报告 §5.4 臂B 里**落空**的代表问句（换了说法的那些），逐条给「该出的规则」。
  const ARM_B: { query: string; expect: string }[] = [
    { query: "4680-NCM 出口欧盟的碳足迹达标吗？", expect: "C33" }, // S20·改前 0 命中
    { query: "涂布良率为什么掉了？", expect: "C30" }, // S12·改前 0 命中
    { query: "4680-NCM 加 20% 六周能不能接？", expect: "C01" }, // S01·改前 0 命中（C01/C03 任一即算，见下）
    { query: "缺口 8 万套自产加班还是外协？", expect: "C08" }, // S14·改前 0 命中
    { query: "待认证的型号怎么排认证顺序？", expect: "C26" }, // S07·改前恰好命中（共享词）——不许回退
  ];

  it("富元数据池：5/5 场景问句召回对口规则（top-3）", () => {
    const misses: string[] = [];
    for (const { query, expect: key } of ARM_B) {
      const alts = key === "C01" ? ["C01", "C03"] : [key]; // S01 对口 C01/C02/C03/C09 任一达标
      const ranks = alts.map((k) => ruleRank(richPool, query, k)).filter((r) => r >= 0);
      const best = ranks.length > 0 ? Math.min(...ranks) : -1;
      if (best < 0 || best > 2) misses.push(`${query} → 期望 ${alts.join("/")} top-3·实得 rank=${best}`);
    }
    if (misses.length > 0) console.log("[rule-discovery] 富池未命中：\n" + misses.join("\n"));
    expect(misses, misses.join("\n")).toEqual([]);
  });

  it("对照：剥光元数据后，换说法的问句跌穿生产相关性门槛（证明召回来自元数据而非名字巧合）", () => {
    // 判据用**生产语义**而不是小池名次：9 条的小池里任何非零分都排第一（剥光池 C33 实测仍 rank=0，
    // 靠单字「碳」），名次在小池里没有判别力；有判别力的是「过不过得了 LIVE_CAPABILITY_MIN_SCORE」。
    // 实测（本门 probe 打印）：富池 5 条 0.46–0.59（过门槛=可达）；剥光池 5 条 0.14–0.30（全穿门槛=生产态被滤掉）。
    for (const { query, expect: key } of ARM_B) {
      const rich = ruleScore(richPool, query, key);
      const stripped = ruleScore(strippedPool, query, key);
      console.log(`[rule-discovery] ${query} → ${key} 富=${rich.toFixed(4)} 剥=${stripped.toFixed(4)} 门槛=${LIVE_CAPABILITY_MIN_SCORE}`);
      expect(rich, `${query}：富池分 ${rich} 须过生产门槛 ${LIVE_CAPABILITY_MIN_SCORE}（否则改了等于没改）`).toBeGreaterThanOrEqual(
        LIVE_CAPABILITY_MIN_SCORE,
      );
      expect(rich, `${query}：富池分 ${rich} 应严格大于剥光池 ${stripped}`).toBeGreaterThan(stripped);
      if (key !== "C26") {
        // C26 是「问句恰好与规则名共享词（认证）」的那条（诊断臂B 改前恰好命中的 5 条之一）——
        // 它剥光后也不许变好，但本就不该拿「穿门槛」当它的判据；其余 4 条换了说法的必须穿门槛。
        expect(
          stripped,
          `${query}：剥光池分 ${stripped} 须跌穿生产门槛 ${LIVE_CAPABILITY_MIN_SCORE}（=改前生产态不可达）`,
        ).toBeLessThan(LIVE_CAPABILITY_MIN_SCORE);
      }
    }
  });

  it("臂A 不回退：念规则名两池都召回（字典式查询本来就通·不许修坏）", () => {
    expect(ruleRank(richPool, "外协比例红线", "C08")).toBeGreaterThanOrEqual(0);
    expect(ruleRank(strippedPool, "外协比例红线", "C08")).toBeGreaterThanOrEqual(0);
    expect(ruleRank(richPool, "碳护照前置", "C33")).toBeGreaterThanOrEqual(0);
  });
});

describe("WO-RULE-DISCOVERY · 混池回归：规则丰富后求解器仍排得进前 8", () => {
  // 诊断报告 §8.2 风险：30 条规则有了丰富文本会挤占求解器名次（DRIL 默认 maxResults=8）。
  const mixed = [...solverResources(), ...richPool];
  const GOLDEN_SOLVER: { query: string; expect: string }[] = [
    { query: "哪个求解器算产能缺口满足度", expect: "capacity_forecast" },
    { query: "产品碳足迹核算能耗碳排", expect: "carbon_footprint" },
    { query: "客户信用逾期敞口多大", expect: "credit_exposure" },
  ];

  it("3/3 golden 求解器问句：预期 solver 进 top-8（与规则混池）", () => {
    const misses: string[] = [];
    for (const { query, expect: key } of GOLDEN_SOLVER) {
      const res = engine.search(query, mixed, { maxResults: 8, minScore: 0 });
      const keys = res.results.map((r) => r.resource.key);
      if (!keys.includes(key)) misses.push(`${query} → 期望 ${key} 进 top-8·实得 [${keys.join(", ")}]`);
    }
    if (misses.length > 0) console.log("[rule-discovery] 混池回归未命中：\n" + misses.join("\n"));
    expect(misses, misses.join("\n")).toEqual([]);
  });

  it("R6 确定性：同问句同混池两次检索字节同序", () => {
    const a = engine.search("4680-NCM 出口欧盟的碳足迹达标吗？", mixed, { maxResults: 8, minScore: 0 });
    const b = engine.search("4680-NCM 出口欧盟的碳足迹达标吗？", mixed, { maxResults: 8, minScore: 0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

import {
  projectNavigationSlice,
  renderNavigationSlice,
  type RuleCatalog,
} from "../src/agent/navigation-slice.js";

describe("WO-RULE-DISCOVERY · 接缝③：导航图规则目录段（文件10·mock ruleCatalog 证投影/渲染/R6）", () => {
  // 镜像 ruleCatalog（生产将由 live-capability-map.fetchLiveRuleCatalog 供——文件11 落线前本段先用 mock 驱动）。
  // 刻意乱序插入（C33 在 C01 前）+ 一条 reads 空（C35 参数载体）+ 一条长描述（C33·55 字 > 40 截断窗）。
  const RULE_CATALOG: RuleCatalog = {
    C33: { capability: RICH_RULES.find((r) => r.key === "C33")!.description!, reads: ["Order"] },
    C01: { capability: RICH_RULES.find((r) => r.key === "C01")!.description!, reads: ["Line"] },
    C08: { capability: RICH_RULES.find((r) => r.key === "C08")!.description!, reads: ["Order"] },
    C35: { capability: "推演参数载体：电池衰减率等推演专用参数，不挂场景问句，evaluate_rules 按 key 直取。", reads: [] },
  };
  const Q = "4680-NCM 加 20% 六周能不能接？";

  it("① 渲染：传入 ruleCatalog 即出规则目录段·按码字典序·brief ≤ 截断窗+1·长描述被截断", () => {
    const slice = projectNavigationSlice(Q, undefined, undefined, undefined, RULE_CATALOG);
    const out = renderNavigationSlice(slice);
    expect(out).toContain("业务规则目录（共 4 条");
    // 字典序（与插入序无关·C01<C08<C33<C35 零填充天然字典序）；
    const i01 = out.indexOf("· C01：");
    const i08 = out.indexOf("· C08：");
    const i33 = out.indexOf("· C33：");
    const i35 = out.indexOf("· C35：");
    expect(i01).toBeGreaterThanOrEqual(0);
    expect(i01).toBeLessThan(i08);
    expect(i08).toBeLessThan(i33);
    expect(i33).toBeLessThan(i35);
    // brief 截断：C33 原文 55 字 > 40 字窗 ⇒ 渲染出的必是截断版（≤ 窗+1=41·句末切点的边界形态）。
    const c33line = out.split("\n").find((l) => l.includes("· C33："))!;
    const brief = c33line.split("· C33：")[1];
    expect(brief.length).toBeLessThanOrEqual(41);
    expect(brief.length).toBeLessThan(RULE_CATALOG.C33.capability.length);
    // 指引文案只许指 retrieve_knowledge（discover 枚举缺 "rules" 是未修硬伤，指那条路 = 引导模型打会被拒的调用）。
    expect(out).toContain('retrieve_knowledge(kinds:["rule"]');
    expect(out).not.toContain('discover(kind:"rules"');
  });

  it("② 降级路径：不传 ruleCatalog ⇒ ruleRoster 空·渲染无规则目录段（残本不宣称全集）", () => {
    const slice = projectNavigationSlice(Q);
    expect(slice.ruleRoster).toEqual([]);
    const out = renderNavigationSlice(slice);
    expect(out).not.toContain("业务规则目录");
  });

  it("③ scope 过滤：相交保留·越界剔除·reads 空=无证据判越界=保留", () => {
    const slice = projectNavigationSlice(Q, undefined, { objectTypes: ["Order"] }, undefined, RULE_CATALOG);
    const keys = (slice.ruleRoster ?? []).map((r) => r.key);
    expect(keys).toContain("C33"); // Order ∩ Order
    expect(keys).toContain("C35"); // reads 空 → 保留（同 solver 段先例：没证据不当越界）
    expect(keys).not.toContain("C01"); // Line ∩ Order = ∅ → 剔除
  });

  it("④ R6：同输入投影+渲染两次，输出逐字节一致（可吃 prompt 缓存）", () => {
    const a = renderNavigationSlice(projectNavigationSlice(Q, undefined, undefined, undefined, RULE_CATALOG));
    const b = renderNavigationSlice(projectNavigationSlice(Q, undefined, undefined, undefined, RULE_CATALOG));
    expect(a).toBe(b);
  });
});
