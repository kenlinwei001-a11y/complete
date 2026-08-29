import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-ADOPT-SCHEME-CARRIER · 「采纳经营方案」payload 契约 + 方案采纳台账记录契约
// （G-ADOPT-SCHEME-NO-CARRIER 收口 · 断点原文：「缺的是承载对象，不是执行器」）
//
// 链路：PlanGenerateView.adoptScheme() → ActionDraft(采纳经营方案) → S2 审批 →
// domainExecutor 落 `scheme_adoptions` 台账（037_scheme_adoptions.sql · 专用 doc-jsonb 表，
// 非本体对象仓储——理由见下）→ AOP 细化读端（PlanService.aop 的 schemeAdoption 段）。
//
// 为什么是专用表而不是照 AdoptedMitigation/ForecastAdoption 走 repos.objects：
// ① 工单硬约定「新增对象类型同时改四处（migrations + repo/pg + repo/memory + repo 接口），漏一处即退」；
// ② 本体语义上它是**审批留痕台账**（公司级年度拍板记录，与 Decision 台账同族），
//   不是推演会读的本体对象——plan_generate 的对象读取声明本就是空数组，
//   塞进 objects 只会让它在本体图谱里冒充一个「可被推演绎联的实体」（那正是断点论据①警告的形态）。
//
// 业务裁定（已定·勿改）：采纳一个方案**不得覆盖**全局经营目标基线 PLAN_GOAL_TARGETS。
// 台账里的 targets 是「用户拍板那一刻目标面板的快照」，只供对账，**没有任何写回基线的路径**。
//
// ⚠️ 量纲纪律（G-LEVER-SNAPSHOT-UNIT-LIE 前科：无量纲紧张度曾被塞进 capWanP50 进审批留痕）：
// outcome 与 targets 两个对象的量纲**互不相同且内部也不统一**（gm 是 0-1 小数、share 是百分数、
// rev 是归一指数——归一指数连"元"都不是），逐字段 @unit 如下。改名必须连量一起对。
// ---------------------------------------------------------------------------

/** 方案 outcome 快照（= plan_generate `schemes[].outcome`，与求解器输出同轴同量纲）。 */
export const SchemeOutcomeSnapshotSchema = z
  .object({
    /** 营收水平：**归一指数（base=100）**，非万元/亿元——前端只显派生增速 (rev/base−1)×100%。 */
    rev: z.number(),
    /** 毛利率：**0–1 小数**（0.16 = 16%；前端 ×100 显示）。 */
    gm: z.number(),
    /** 市场份额：**百分数**（18 = 18%）。 */
    share: z.number(),
    /** 库存周转：**次/年**。 */
    turns: z.number(),
    /** 现金垫：**亿元**。 */
    cash: z.number(),
    /** CAPEX 投入：**亿元**。 */
    capex: z.number(),
  })
  .strict();
export type SchemeOutcomeSnapshot = z.infer<typeof SchemeOutcomeSnapshotSchema>;

/** 方案评分快照（plan.ts `clamp(...,0,100)` 五维 + 综合）。 */
export const SchemeScoresSnapshotSchema = z
  .object({
    /** 盈利分，**0–100 无量纲**。 */ profit: z.number(),
    /** 规模分，**0–100 无量纲**。 */ scale: z.number(),
    /** 现金分，**0–100 无量纲**。 */ cash: z.number(),
    /** 增长分，**0–100 无量纲**。 */ growth: z.number(),
    /** 稳健分，**0–100 无量纲**。 */ stability: z.number(),
    /** 综合分，**0–100 无量纲**（五维均值 − 硬违规罚分）。 */ total: z.number(),
  })
  .strict();
export type SchemeScoresSnapshot = z.infer<typeof SchemeScoresSnapshotSchema>;

/**
 * 拍板那一刻的目标面板快照（PlanGenerateView goals 面板）。
 * ⚠️ 与 PLAN_GOAL_TARGETS 的口径差异是**有意的**：这里是**用户拨定值**，
 * gmFloor 已被前端 ÷100 成小数（与求解器入参同轴），而基线册里 gmFloorPct 是百分数——
 * 两个名字差一个 Pct 后缀，量纲差 100 倍，对账时别看错。
 */
export const SchemeTargetsSnapshotSchema = z
  .object({
    /** 营收增长目标：**百分数**（18 = 18%）。 */
    revGrowthPct: z.number(),
    /** 毛利率底线：**0–1 小数**（求解器入参口径；= 面板百分值 ÷100）。 */
    gmFloor: z.number(),
    /** 份额提升目标：**pct 点**。 */
    sharePts: z.number(),
    /** 库存周转底线：**次/年**。 */
    turnsFloor: z.number(),
    /** CAPEX 上限：**亿元**。 */
    capexCap: z.number(),
    /** 现金垫底线：**亿元**。 */
    cashFloor: z.number(),
    /** 硬约束开关（true = 该项当硬约束卡方案可行性）。 */
    hard: z.object({ gm: z.boolean(), cash: z.boolean(), capex: z.boolean() }).strict(),
  })
  .strict();
export type SchemeTargetsSnapshot = z.infer<typeof SchemeTargetsSnapshotSchema>;

/** 采纳经营方案的 Action payload（actionTypeKey=`采纳经营方案` · 生产者 PlanGenerateView.adoptScheme）。 */
export const SchemeAdoptionPayloadSchema = z
  .object({
    /** 方案序号（壹/贰/叁 —— 三案收敛后的展示序号）。 */
    schemeNo: z.string().min(1),
    /** 路径键（plan_generate 五路径骨架之选中者）。 */
    pathKey: z.string().min(1),
    /** 方案快照（name + outcome + scores + hardViol —— 用户看到并拍板的那份，不是重算）。 */
    scheme: z
      .object({
        name: z.string().min(1),
        outcome: SchemeOutcomeSnapshotSchema,
        scores: SchemeScoresSnapshotSchema,
        /** 硬违规规则键数组（空 = 可行方案）。 */
        hardViol: z.array(z.string()),
      })
      .strict(),
    /** 拍板那一刻的目标面板快照（只供对账，**不得写回 PLAN_GOAL_TARGETS**）。 */
    targets: SchemeTargetsSnapshotSchema,
    /** 规划年度（缺省 → 执行期取 forecastStart 的年份，确定性派生）。 */
    year: z.number().int().optional(),
  })
  .strict();
export type SchemeAdoptionPayload = z.infer<typeof SchemeAdoptionPayloadSchema>;

/**
 * 方案采纳台账记录（doc-jsonb 五列表 `scheme_adoptions` 的 doc 形状 · Store&lt;T&gt; 泛型约束
 * 要求 id/tenantId 在顶层，与 EnterpriseState/ProcessStepTemplate 同形态）。
 *
 * 不变量：**同 (tenantId, year) 至多一条 ACTIVE** —— 写时不变量（执行器先把旧的置 SUPERSEDED），
 * 读侧（AOP 细化读端）无需在多条里挑，也就没有挑错的余地（同 AdoptedMitigation 的「单源不并存」裁决）。
 * 幂等：同一方案重复采纳 → 确定性 adoptionId 覆盖同一条记录，不产重复。
 */
export const SchemeAdoptionSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    /** 确定性采纳 id（由 year|schemeNo|pathKey|outcome 全字段哈希派生 · R6 禁 Date.now/random）。 */
    adoptionId: z.string(),
    /** 规划年度（AOP 细化读端按它过滤）。 */
    year: z.number().int(),
    schemeNo: z.string(),
    pathKey: z.string(),
    schemeName: z.string(),
    /** 方案 outcome 快照（量纲见 SchemeOutcomeSnapshotSchema 逐字段标注）。 */
    outcome: SchemeOutcomeSnapshotSchema,
    scores: SchemeScoresSnapshotSchema,
    hardViol: z.array(z.string()),
    /** 拍板那一刻的目标面板快照（对账用·不写回基线）。 */
    targets: SchemeTargetsSnapshotSchema,
    /** 采纳日期（确定性时间锚 forecastStart · 同 GlobalSimPlanExecutor/adopt_mitigation 纪律）。 */
    adoptedAt: z.string(),
    /** 溯源：哪张 ActionDraft 审批落的这条。 */
    actionDraftId: z.string(),
    /** ACTIVE = 现役采纳；SUPERSEDED = 被同年度后一次采纳取代。 */
    status: z.enum(["ACTIVE", "SUPERSEDED"]),
  })
  .strict();
export type SchemeAdoption = z.infer<typeof SchemeAdoptionSchema>;
