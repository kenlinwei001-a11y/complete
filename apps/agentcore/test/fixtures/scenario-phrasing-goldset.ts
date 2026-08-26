import { SCENARIO_CATALOG } from "../../src/scenarios-catalog.js";

/**
 * 场景启动器措辞金标集（WO-ROUTING-RETRIEVAL-FIRST · Track A Phase 0 + LOOP 验收）。
 *
 * 由来：仓主实测「4680-NCM 加 20% 常州基地六周能不能交付？」永远答不出。2×2 归属取证证明
 * 唯一变量是**动词**（接 vs 交付），基地与长度无关 —— 即出厂 20 场景的注册例句只覆盖了**一种措辞**，
 * 用户换个说法就掉出确定性通道。本金标集为每个场景补三种真实用户会用的措辞：
 *
 *   V1 加实体词      —— 原句 + 具体基地/型号/客户/时间（用户通常会说得更具体）
 *   V2 实体词变形    —— 同一实体的另一种表面形式（常州 / 常州基地 / 常州工厂；4680-NCM / 4680 三元圆柱）
 *   V3 句式动词变形  —— 换个自然说法 + 带实体（正是「交付 vs 接」那类病的触发面）
 *
 * **题干从 SCENARIO_CATALOG 派生·不手抄**（防金标与目录漂移）；变体按 sNo 挂载，
 * 缺任一场景的变体 → 门变红（见 goldset.test 的完备性断言）。
 *
 * 实体词取自单一来源：`packages/contracts/base-registry.ts`（12 基地）、
 * `apps/datacore/src/synthetic/battery.ts` MODELS（6 型号）。
 */

export interface PhrasingCase {
  sNo: string;
  /** 期望落到的意图 key = 该场景注册的 intentKey（单一来源，不写死） */
  expectIntent: string;
  view: string;
  kind: "ORIGINAL" | "V1_ENTITY" | "V2_ENTITY_VARIANT" | "V3_PHRASING";
  query: string;
}

/** 每个场景三条变体（人工撰写·语义须与原题一致；题干本身由 catalog 提供）。 */
const VARIANTS: Record<string, [string, string, string]> = {
  S01: [
    "常州基地 4680-NCM 加 20% 六周能不能接？",
    "常州工厂 4680 三元圆柱 上浮 20% 六周接得下吗？",
    "4680-NCM 需求涨 20%，常州六周内交付得了吗？",
  ],
  S02: [
    "常州基地这次波动影响哪些订单？",
    "changzhou 基地会连累到哪些订单？",
    "常州出问题的话，哪些订单会受牵连？",
  ],
  S03: [
    "常州基地物料齐套为什么这天越线？",
    "常州工厂的齐套率那天为啥破线了？",
    "常州物料齐套越线，根因是什么？",
  ],
  S04: [
    "现金垫 45 亿的月度规划过得了体检吗？",
    "现金垫圈 45 亿，这版月度计划体检能过吗？",
    "月度规划按现金垫 45 亿来做，体检会不会挂？",
  ],
  S05: [
    "常州和信阳之间推荐哪个经营方案？",
    "常州基地、信阳基地，经营方案选哪个好？",
    "经营方案该采纳哪一个？给个比选",
  ],
  S06: [
    "采纳常州基地的三班制方案",
    "把常州工厂那个三班倒方案定下来",
    "常州三班制这个处置方案，我要采纳",
  ],
  S07: [
    "4680-LFP 等待认证的型号怎么排认证顺序？",
    "4680 磷酸铁锂圆柱这些待认证型号，认证排期怎么定？",
    "待认证型号的认证先后顺序应该怎么安排？",
  ],
  S08: [
    "常州基地下周哪些订单缺料开不了工？",
    "常州工厂下周有哪些单子因为缺料没法开工？",
    "下周物料不齐，哪些订单会停线？",
  ],
  S09: [
    "常州基地 7 月正极长协覆盖够吗？缺口怎么补？",
    "7 月份正极材料的长期协议覆盖率够不够？差的怎么补上？",
    "正极长协 7 月覆盖不足的话，补缺方案是什么？",
  ],
  S10: [
    "常州基地哪些物料超储/欠储？能释放多少资金？",
    "常州工厂的库存里，哪些料压多了、哪些不够？能腾出多少钱？",
    "库存水位不合理的物料有哪些？优化后释放多少资金？",
  ],
  S11: [
    "常州基地下周订单怎么排能少换型？",
    "常州工厂下周的单子怎么排产换型次数最少？",
    "下周排产要减少换型损失，顺序怎么定？",
  ],
  S12: [
    "常州基地涂布良率为什么掉了？",
    "常州工厂的涂布工序直通率为啥下滑？",
    "涂布良率下降的根因是什么？",
  ],
  S13: [
    "常州基地检修计划和交付高峰撞了怎么调？",
    "常州工厂的检修窗口跟交货高峰期冲突了，怎么错开？",
    "检修和交付高峰撞车，检修窗口该怎么挪？",
  ],
  S14: [
    "常州基地缺口 8 万套自产加班还是外协？",
    "常州工厂差 8 万套，是加班自己做还是找外协？",
    "8 万套的缺口，外协和加班哪个划算？",
  ],
  S15: [
    "电网公司 F 这单 4680-NCM 毛利过线吗？",
    "电网公司F 的这笔订单毛利率达标没有？",
    "电网公司 F 这单接下来毛利够不够红线？",
  ],
  S16: [
    "商用车集团 G 的信用还能接新单吗？",
    "商用车集团G 这个客户，授信还够再下一单吗？",
    "商用车集团 G 还能不能再接单？信用有没有问题？",
  ],
  S17: [
    "枣庄基地储能线值得投吗？",
    "zaozhuang 那条储能产线的投资划算吗？",
    "枣庄要不要上这条储能线？投资回报怎么样？",
  ],
  S18: [
    "常州基地本月产销平衡到哪一步了？",
    "本月 S&OP 产销平衡走到哪个阶段了？",
    "这个月的产销平衡进展如何？",
  ],
  S19: [
    "常州基地 Q2 缺口用什么组合补？",
    "第二季度的缺口，用哪些手段组合起来补？",
    "Q2 差的这部分，补缺组合方案是什么？",
  ],
  S20: [
    "4680-NCM 出口欧盟的碳足迹达标吗？",
    "4680 三元圆柱卖到欧盟，碳足迹符合要求吗？",
    "出口欧盟的碳足迹核算，4680-NCM 过线没有？",
  ],
};

const KINDS: PhrasingCase["kind"][] = ["V1_ENTITY", "V2_ENTITY_VARIANT", "V3_PHRASING"];

/** 全量用例 = 20 场景 × (1 原句 + 3 变体) = 80 条。题干与 intentKey/view 均取自 catalog。 */
export function phrasingGoldset(): PhrasingCase[] {
  const out: PhrasingCase[] = [];
  for (const c of SCENARIO_CATALOG) {
    out.push({ sNo: c.sNo, expectIntent: c.intentKey, view: c.view, kind: "ORIGINAL", query: c.triggerQuestion });
    const vs = VARIANTS[c.sNo];
    if (!vs) continue; // 完备性由 goldset 门断言，不在此静默补
    vs.forEach((q, i) => out.push({ sNo: c.sNo, expectIntent: c.intentKey, view: c.view, kind: KINDS[i]!, query: q }));
  }
  return out;
}

/** 供完备性断言：目录里有、金标集没配变体的场景。 */
export function scenariosMissingVariants(): string[] {
  return SCENARIO_CATALOG.filter((c) => !VARIANTS[c.sNo] || VARIANTS[c.sNo]!.length !== 3).map((c) => c.sNo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 第二类 · **探索型**推演金标集（仓主指正：不能只测意图命中型）
//
// 为什么必须单列：仓主实测出事的那 203 s，走的正是**探索**路径——而只断言「落到注册意图」
// 的门，永远不会跑到探索路径上去，于是探索段的病（串行扇出/首轮撞满超时/旁白不可达/
// 无部分结果）在全绿的测试集下依然存在。**这就是「绿测试 ≠ 能用」的教科书形状。**
//
// 这些题**本体内确实没有对口意图**（真开放），期望行为不是"命中"，而是：
//   ① 进得去探索（path=AGENT·非被正则门劫持成窄意图 → 自信错答）
//   ② 出得来（不 degraded/不超时/不落"未能产出回答"占位）
//   ③ 答案有出处（provenance 非空 + 真调过工具，而非零工具直接 final_answer 编一段）
// ─────────────────────────────────────────────────────────────────────────────

export interface ExploratoryCase {
  eNo: string;
  view: string;
  kind: PhrasingCase["kind"];
  query: string;
}

const EXPLORATORY: Record<string, { view: string; base: string; variants: [string, string, string] }> = {
  E01: {
    view: "risk",
    base: "常州和信阳的化成瓶颈成因有什么不同？",
    variants: [
      "常州基地和信阳基地的化成工序瓶颈，成因差在哪？",
      "changzhou 与 xinyang 两个厂的化成柜卡点，根子上有什么区别？",
      "为什么常州卡在化成、信阳也卡化成，但原因不一样？",
    ],
  },
  E02: {
    view: "dash",
    base: "储能这条业务线整体还有多少增长空间？",
    variants: [
      "眉山、江门、信阳这些储能基地，整体还有多少增长余地？",
      "储能业务（meishan/jiangmen/xinyang）的增长天花板在哪？",
      "储能这块往后还能长多少？受什么限制？",
    ],
  },
  E03: {
    view: "project",
    base: "如果 4680-NCM 长期供不上，对整个产品结构意味着什么？",
    variants: [
      "常州的 4680-NCM 长期缺货，会怎么影响整体产品结构？",
      "4680 三元圆柱持续供不应求，产品组合要怎么变？",
      "假设 4680-NCM 一直紧张，我们的产品结构该往哪调？",
    ],
  },
  E04: {
    view: "risk",
    base: "为什么老是同一批订单出问题？",
    variants: [
      "常州基地为什么总是同一批订单反复出状况？",
      "常州工厂那几个单子老是出事，背后是不是同一个原因？",
      "反复出问题的订单有没有共同点？根子在哪？",
    ],
  },
};

/** 探索型全量 = 4 题 × (1 原句 + 3 变体) = 16 条。 */
export function exploratoryGoldset(): ExploratoryCase[] {
  const out: ExploratoryCase[] = [];
  for (const [eNo, e] of Object.entries(EXPLORATORY)) {
    out.push({ eNo, view: e.view, kind: "ORIGINAL", query: e.base });
    e.variants.forEach((q, i) => out.push({ eNo, view: e.view, kind: KINDS[i]!, query: q }));
  }
  return out;
}
