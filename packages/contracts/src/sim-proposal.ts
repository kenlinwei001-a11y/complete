/**
 * WO-AGENT-IN-LOOP · **agent 出方案 / 求解器出数** 的契约层。
 *
 * ══ 今天的行为是 X，应该是 Y（开工第一件事，实测读出来的原文）══════════════════
 *
 * **X（实测）**：推演路**零 LLM / 零 agent / 零 MCP / 零 skill**。
 *   · 金丝雀先证扫法有效：`apps/agentcore/src` 里 LLM 调用命中 **10 个文件**；
 *     同一把扫法在 `apps/datacore/src/solvers` + `apps/datacore/src/synthetic` 命中 **0**。
 *   · `solvers/` 里 `mcp|skillId|agentId|ReAct` 命中 **0**。
 *   · `solvers/capacity.ts:943` 白纸黑字 `agentInvolved: false`。
 *   于是「方案寻优」那 24 个方案是 `assembleParetoModel` 按**结构信号**（词库命中 / 主键 /
 *   ref 指向 / 实例行数）挑出来的杠杆网格的笛卡尔积 —— 它不读**本次事件**，
 *   故 `costPressure` 设 999 也好、物料延期也好，网格逐字节不变。
 *   **那是一张固定的产线产能扫描表，不是本次事件的对策。**
 *
 * **Y（本文件）**：让 agent 参与**选方案**这一步，同时**一个数都不许它产**。
 *
 * ══ 分工钉死（仓主 2026-09-08 定的架构原则，本文件全部设计的前提）═══════════════
 *
 * > 「**所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、
 * >   规则等等输出结果，然后基于结果推演，形成多个方案和方案比对。**」
 *
 * 落到本契约就是一条**结构上成立**（而不是靠纪律成立）的红线：
 *
 * > ### `AgentProposalDraft` 里**没有任何一个能当数值用的字段**。
 *
 * agent 只能回**下标**（`leverIndex` / `valueIndex`）—— 下标是「我选菜单上第几项」，
 * 不是「我算出来 0.87」。真正的数值全部在 `ProposalMenu` 里，而菜单由**确定性侧**
 * （装配器读本体真值）产出。于是：
 *
 * | 谁 | 产出什么 | 数从哪来 |
 * |---|---|---|
 * | 装配器（确定性） | `ProposalMenu`：有哪些杠杆、每根杠杆有哪些档位 | 本体真值 |
 * | **agent** | `AgentProposalDraft`：**挑哪几项、怎么组成方案、方案之间怎么比** | **不产数** |
 * | 求解器（确定性） | 每个方案的营收/成本/毛利/获排率、支配关系、前沿 | 求解器输出 |
 *
 * ⚠ **为什么这条必须是结构性的而不是提示词纪律**：一个会自己编数的 agent，
 * 屏上每个数都可疑，**而它不会报错**。把「不许产数」写进 system prompt 只能降低概率；
 * 写成「schema 里没有那个字段」才是零概率。`resolveProposalToLevers` 是唯一的兑现处，
 * 下标越界一律**抛错**（fail-closed）——不许静默夹逼到边界，那等于让幻觉出来的下标
 * 悄悄变成一个合法的数。
 *
 * ══ 确定性 R6（本单要害）═════════════════════════════════════════════════════
 * 本仓不可破的不变量：**同 (industry, scale, seed) 重跑字节级一致；求解器同输入同参数版本同输出**。
 * LLM 直接进求解路径会当场破掉它。故本设计是：
 *
 * > **agent 出提案 → 提案落盘定版（`proposalId` + `version` + `inputFingerprint`）
 * >   → 确定性引擎读定版做裁决与计算 → 重跑读定版，不重新调模型。**
 *
 * `resolveProposalToLevers` 是纯函数（无时钟 / 无随机 / 无 IO），故「同一提案版本重跑两次
 * 逐字节相同」不是测出来的巧合，是结构上成立的事。
 */
import { z } from "zod";
import { ParetoLeverGridSchema, ParetoObjectiveGapSchema, ParetoObjectiveSchema, type ParetoLeverGrid } from "./sim.js";

// ── ① 菜单：确定性侧产出，**所有真实数值都在这里** ──────────────────────────────

/**
 * 菜单上的一根杠杆。`values` 是**装配器从本体真值算出来的候选档位**，
 * 不是 agent 想出来的数 —— 这一句是整个 WO 的支点，改这个字段的产地就等于把红线拆了。
 */
export const ProposalMenuLeverSchema = z.strictObject({
  /** 扰动 target（DF.8 接地语法，与 `optimize_whatif` / `ParetoLeverGrid` 同一套）。 */
  key: z.string().min(1),
  /** 人读名（给 agent 看的，也给屏上看的）。 */
  label: z.string().min(1),
  /** 候选档位。**产地 = 本体真值**（装配器算）。agent 只能引用下标，不能新增元素。 */
  values: z.array(z.number()).min(1),
  /** 这根杠杆动的是什么（喂给 agent 做语义判断用；纯描述，不参与计算）。 */
  note: z.string().optional(),
});
export type ProposalMenuLever = z.infer<typeof ProposalMenuLeverSchema>;

/**
 * 一次提案的**输入面**：世界态摘要 + 可选杠杆菜单 + 目标轴。
 *
 * ⚠ `worldDigest` 是**给 agent 读的世界态**，不是本体真值的替代品：它只承载
 * 「这次发生了什么事」（扰动种类/受影响对象/求解器已经算出来的基线读数），
 * agent 据此判断哪几根杠杆与**本次事件**相关。它进 `inputFingerprint`，
 * 故世界态一变，提案指纹就变 —— 这是第 4 格对照实验（换事件必须换方案）的机器判据。
 */
export const ProposalMenuSchema = z.strictObject({
  family: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  objectives: z.array(ParetoObjectiveSchema).min(2),
  levers: z.array(ProposalMenuLeverSchema).min(1),
  constraints: z.array(z.strictObject({ key: z.string().min(1), limit: z.number() })).optional(),
  unavailableObjectives: z.array(ParetoObjectiveGapSchema).optional(),
  /** 世界态摘要（本次事件 + 求解器基线读数）。**只读，不含任何 agent 可写的数值格**。 */
  worldDigest: z.strictObject({
    /** 本次扰动/事件的种类与落点（如 `material_delay@Material.LiCO3`）。空数组 = 无扰动的基线态。 */
    events: z.array(z.strictObject({ kind: z.string().min(1), target: z.string(), magnitude: z.number().nullable() })),
    /** 求解器已经算出来的基线读数（键 = 目标轴键）。**产地 = 求解器**。 */
    baselineMetrics: z.record(z.string(), z.number()),
    /** 受影响对象条数摘要（对象类型 → 条数）。产地 = 本体。 */
    counts: z.record(z.string(), z.number().int().nonnegative()),
  }),
});
export type ProposalMenu = z.infer<typeof ProposalMenuSchema>;

// ── ② agent 的产出：**只有下标与文字，没有一个数值格** ────────────────────────

/**
 * 一次「挑档位」的动作 = 「第 i 根杠杆，选它第 j 个档位」。
 *
 * ⚠ **这两个 int 是下标不是数量**。判据很硬：把菜单换一份，同一个 draft 解出来的
 * 数值就全变了 —— 说明数值的产地是菜单，不是 draft。若哪天有人给这个 schema 加一个
 * `value: z.number()`，那一刻这条红线就没了，`sim-proposal-no-numbers` 那条断言会当场红。
 */
export const ProposalPickSchema = z.strictObject({
  leverIndex: z.number().int().nonnegative(),
  valueIndex: z.number().int().nonnegative(),
});
export type ProposalPick = z.infer<typeof ProposalPickSchema>;

/**
 * 一个**方案**：名字 + 理由 + 每根它要动的杠杆各选一档。
 *
 * 「每根杠杆恰好一档」是有意的：这样一个方案**唯一对应一个解**（`paretoSolutionId` 可算），
 * 屏上「方案 A 在不在前沿上」才是一句有确定答案的话。若允许一个方案给一根杠杆挑多档，
 * 它就对应一片解而不是一个解，「方案比对」当场退化成「区域比对」，没法说清。
 */
export const ProposalOptionSchema = z.strictObject({
  name: z.string().min(1).max(40),
  /** 为什么这个组合是本次事件的对策（agent 的推演，纯文字）。 */
  rationale: z.string().min(1).max(400),
  picks: z.array(ProposalPickSchema).min(1).max(16),
});
export type ProposalOption = z.infer<typeof ProposalOptionSchema>;

/**
 * agent 的完整产出。**全文件搜不到一个承载业务数值的字段** —— 这是设计，不是巧合。
 */
export const AgentProposalDraftSchema = z.strictObject({
  options: z.array(ProposalOptionSchema).min(1).max(8),
  /** 方案之间怎么比（agent 的比对结论，纯文字）。 */
  comparisonNote: z.string().max(600).default(""),
});
export type AgentProposalDraft = z.infer<typeof AgentProposalDraftSchema>;

// ── ③ 定版记录：落盘的那一份 ───────────────────────────────────────────────────

/**
 * 本次提案**走的哪条路**（仓主 2026-09-08 追加的可披露项）。
 *
 * `route` 三值不许合并：
 *  · `NONE`     —— 本次**未调用 agent**（确定性兜底或功能关闭）。**必须明写，不许留白**
 *                  （铁律 1.5 判据二原文：留白会让人以为调了）。
 *  · `NATIVE`   —— 内置 `runAgentLoop`。
 *  · `EXTERNAL` —— dsh（deepseek-harness）出进程 JSON-RPC 分叉。
 */
export const ProposalRouteSchema = z.enum(["NONE", "NATIVE", "EXTERNAL"]);
export type ProposalRoute = z.infer<typeof ProposalRouteSchema>;

export const ProposalProvenanceSchema = z.strictObject({
  /** 本次是否真调了 agent。`false` 时下面四格恒 null（不给像模像样的空串）。 */
  agentInvolved: z.boolean(),
  route: ProposalRouteSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  agentId: z.string().nullable(),
  /** agent 往返耗时（ms）。未调用 ⇒ null。 */
  elapsedMs: z.number().nonnegative().nullable(),
  /**
   * 未调用 agent 时**为什么**（功能关闭 / agentcore 不可达 / 产出不合法被拒 …）。
   * 调用成功 ⇒ null。⚠ 这一格是诚实位：兜底与「真的调了」在屏上必须分得开。
   */
  fallbackReason: z.string().nullable(),
});
export type ProposalProvenance = z.infer<typeof ProposalProvenanceSchema>;

/**
 * **定版记录**（落盘的那一份）。重跑读它，不重新调模型。
 *
 * `inputFingerprint` 是「菜单 + 世界态」的规范化哈希：
 *  · 世界态没变 ⇒ 指纹相同 ⇒ 可以直接复用同一份定版（重跑字节级一致，第 2 格）；
 *  · 世界态变了 ⇒ 指纹不同 ⇒ 拿旧定版去解会被 `assertProposalFresh` 当场拒
 *    （**不许**静默用旧方案套新世界 —— 那会让屏上出现一组「针对上一个事件」的对策，
 *    而它看起来完全正常）。
 */
export const FrozenProposalSchema = z.strictObject({
  proposalId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  /** 同一 (tenant, session) 下自增，从 1 起。人读用；机器判新鲜度用 `inputFingerprint`。 */
  version: z.number().int().positive(),
  inputFingerprint: z.string().min(1),
  menu: ProposalMenuSchema,
  draft: AgentProposalDraftSchema,
  provenance: ProposalProvenanceSchema,
  createdAt: z.string().min(1),
});
export type FrozenProposal = z.infer<typeof FrozenProposalSchema>;

// ── ④ 兑现：菜单 + 定版 → 杠杆网格（**唯一**的数值兑现处，纯函数）────────────────

/** 下标越界 —— fail-closed 的那一类错。单开一个类型是为了让调用方能与「求解失败」分开处理。 */
export class ProposalResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalResolveError";
  }
}

/**
 * 把一个方案解成**一组具体杠杆档位**（`{key, value}[]`，按 key 字典序）。
 *
 * ⚠ 这是**唯一**一处把「agent 的下标」变成「真实数值」的代码。别处再写一份，
 * 红线就有两个兑现口，迟早一个漏校验。越界一律抛：静默夹逼等于给幻觉发一张合法通行证。
 */
export function resolveOptionLevers(menu: ProposalMenu, option: ProposalOption): { key: string; value: number }[] {
  const seen = new Set<number>();
  const out: { key: string; value: number }[] = [];
  for (const p of option.picks) {
    const lever = menu.levers[p.leverIndex];
    if (!lever) {
      throw new ProposalResolveError(
        `方案「${option.name}」引用了不存在的杠杆下标 ${p.leverIndex}（菜单只有 ${menu.levers.length} 根）——` +
          `⛔ 不夹逼到边界：那会把一个编出来的下标悄悄变成一个合法的档位。`,
      );
    }
    if (seen.has(p.leverIndex)) {
      throw new ProposalResolveError(
        `方案「${option.name}」对同一根杠杆 '${lever.key}' 挑了两次档位 —— 一个方案对一根杠杆只能有一档` +
          `（否则它对应的是一片解不是一个解，「方案比对」就没法说清）。`,
      );
    }
    seen.add(p.leverIndex);
    const value = lever.values[p.valueIndex];
    if (value === undefined) {
      throw new ProposalResolveError(
        `方案「${option.name}」在杠杆 '${lever.key}' 上引用了不存在的档位下标 ${p.valueIndex}` +
          `（该杠杆只有 ${lever.values.length} 档）。`,
      );
    }
    out.push({ key: lever.key, value });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * 把定版提案兑现成**求解器要的杠杆网格**：逐根杠杆取「所有方案在它上面挑过的档位」的并集。
 *
 * 为什么是并集而不是「一个方案一次求解」：`runOptimizePareto` 本来就按网格枚举 + 支配剔除，
 * 复用它**一行不改**是本单最大的一笔省 —— 且并集保证「每个方案都在被求解的那批里」，
 * 于是「方案 A 在不在前沿上」有确定答案。网格里多出来的交叉组合不是噪声：
 * 它们是同一批杠杆的其它组合，一并算出来只会让前沿更完整。
 *
 * 确定性：杠杆按 key 字典序、档位去重升序 ⇒ 同一份定版重跑 `JSON.stringify` 逐字节一致。
 */
export function resolveProposalToLevers(menu: ProposalMenu, draft: AgentProposalDraft): ParetoLeverGrid[] {
  const byKey = new Map<string, { label: string; values: Set<number> }>();
  for (const option of draft.options) {
    for (const lv of resolveOptionLevers(menu, option)) {
      const lever = menu.levers.find((l) => l.key === lv.key);
      const bucket = byKey.get(lv.key) ?? { label: lever?.label ?? lv.key, values: new Set<number>() };
      bucket.values.add(lv.value);
      byKey.set(lv.key, bucket);
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ParetoLeverGridSchema.parse({ key, label: v.label, values: [...v.values].sort((x, y) => x - y) }));
}

/**
 * 方案 → 解 id 的对照（屏上「方案 A 是哪个点」用）。
 * `solutionId` 的拼法必须与 `opt-pareto.ts` 的 `paretoSolutionId` **同源** ——
 * 故这里接一个注入的 `idOf`，不在契约里另抄一份拼串（抄了就会在某天开始对不上）。
 */
export function mapOptionsToSolutions(
  menu: ProposalMenu,
  draft: AgentProposalDraft,
  idOf: (levers: readonly { key: string; value: number }[]) => string,
): { name: string; rationale: string; solutionId: string; levers: { key: string; value: number }[] }[] {
  return draft.options.map((o) => {
    const levers = resolveOptionLevers(menu, o);
    return { name: o.name, rationale: o.rationale, solutionId: idOf(levers), levers };
  });
}
