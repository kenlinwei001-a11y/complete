/**
 * WO-AGENT-IN-LOOP · A 侧：**装菜单 → 请 agent 出方案 → 定版落盘 → 兑现成杠杆网格**。
 *
 * ══ 分工（仓主 2026-09-08 架构原则）════════════════════════════════════════════
 * > 「所有计算原则上使用**求解器**而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、
 * >   规则等等输出结果，然后基于结果推演，形成**多个方案和方案比对**。」
 *
 * 本文件是这条原则的兑现处，三件事各归各位：
 *  1. **菜单**（`buildProposalMenu`）—— 数值全在这里，产地是 `assembleParetoModel`
 *     （读本租户已发布本体的真值）+ 求解器基线读数。**零 LLM**。
 *  2. **提案**（agentcore `/b/v1/sim/propose-candidates`）—— agent 只回下标与文字。
 *  3. **兑现**（契约包 `resolveProposalToLevers`）—— 下标 → 数值，纯函数，越界即抛。
 *
 * ⚠ **A 不调 B 的模型，A 调 B 的编排口**：两系统松耦合的方向是「B 经 A 的公开 REST 读数据」，
 *   而 A→B 的出站在本仓已有先例（`databuilder/service.ts` 的 scaffoldClient、`outbox.ts`，
 *   都走 `AGENTCORE_BASE_URL` + `SERVICE_TOKEN`）。本文件沿用那条既有通路，
 *   **不在 datacore 里新起一套 LLM 客户端**（本单硬约束）。
 *
 * ══ 确定性 R6：为什么这样接不破「同输入同输出」════════════════════════════════
 * LLM 只在**生成时刻**出现一次，产物立刻定版（`proposalId` + `version` + `inputFingerprint`）。
 * 之后的每一次求解都读定版 —— 求解路径上**一次模型调用都没有**。
 * 同族先例：`solvers/llm-gen.ts`（「只在生成时刻调一次 LLM，产物随后冻结（hash+版本）」）。
 */
import { createHash } from "node:crypto";
import {
  AgentProposalDraftSchema,
  FrozenProposalSchema,
  type AgentProposalDraft,
  type FrozenProposal,
  type ParetoAssembleResult,
  type ParetoObjective,
  type ProposalMenu,
  type ProposalProvenance,
  resolveProposalToLevers,
} from "@platform/contracts";
import { canonicalJson } from "../prng.js";
import { AppError } from "../errors.js";

/** 未调用 agent 的诚实回执 —— **必须明写，不许留白**（铁律 1.5 判据二）。 */
export function noAgentProvenance(reason: string): ProposalProvenance {
  return { agentInvolved: false, route: "NONE", provider: null, model: null, agentId: null, elapsedMs: null, fallbackReason: reason };
}

/**
 * 输入指纹 = 规范化(菜单) 的 sha256 前 32 位。
 *
 * ⚠ **指纹盖的是「菜单 + 世界态」整体**，因为这两样合起来才是 agent 当时看到的东西。
 *   只盖世界态会漏掉「本体变了导致可选杠杆变了」，只盖菜单会漏掉「同样的杠杆但事件换了」——
 *   而第 4 格对照实验（换事件必须换方案）要的正是后者会变。
 */
export function fingerprintMenu(menu: ProposalMenu): string {
  return createHash("sha256").update(canonicalJson(menu)).digest("hex").slice(0, 32);
}

export interface BuildMenuInput {
  assembled: ParetoAssembleResult;
  /** 本次世界态里的扰动（已按 startTick 排序）。空 = 基线态。 */
  events: { kind: string; target: string; magnitude: number | null }[];
  /** 求解器算出来的基线读数（键 = 目标轴键）。**产地必须是求解器**。 */
  baselineMetrics: Record<string, number>;
  /** 对象类型 → 条数。产地 = 本体。 */
  counts: Record<string, number>;
}

/**
 * 把装配结果 + 世界态揉成一份**给 agent 读的菜单**。
 *
 * ⚠ 这里**一个数都不新造**：`levers` / `objectives` / `constraints` 全部原样取自
 *   `assembleParetoModel` 的产出（它读的是本体真值），`baselineMetrics` 原样取自求解器。
 *   本函数只是换个形状 —— 换形状的地方若开始"顺手算一下"，红线就从这里破。
 */
export function buildProposalMenu(input: BuildMenuInput): ProposalMenu | null {
  if (!input.assembled.applicable) return null;
  const req = input.assembled.request;
  return {
    family: req.family,
    ...(req.args ? { args: req.args } : {}),
    objectives: req.objectives as ParetoObjective[],
    levers: req.levers.map((l) => ({
      key: l.key,
      label: l.label ?? l.key,
      values: l.values,
      note: `档位由本体真值算出（装配器 ${input.assembled.applicable ? "已绑定" : ""}），共 ${l.values.length} 档`,
    })),
    ...(req.constraints ? { constraints: req.constraints } : {}),
    ...(req.unavailableObjectives ? { unavailableObjectives: req.unavailableObjectives } : {}),
    worldDigest: {
      events: input.events,
      baselineMetrics: input.baselineMetrics,
      counts: input.counts,
    },
  };
}

/** A→B 出站客户端接口（注入；测试用脚本化替身，不吊起真 agentcore）。 */
export interface ProposerClient {
  propose(menu: ProposalMenu, agentId: string, who: { tenantId: string; userId?: string; roles?: string[] }): Promise<{ draft: unknown; provenance: unknown }>;
}

/**
 * 走既有 A→B 服务间通路（`AGENTCORE_BASE_URL` + `SERVICE_TOKEN`）的实现。
 * 与 `databuilder/service.ts` 的 scaffoldClient 同一形态，不另发明一套鉴权。
 */
export function httpProposerClient(baseUrl: string, serviceToken: string, timeoutMs = 60_000): ProposerClient {
  return {
    async propose(menu, agentId, who) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/b/v1/sim/propose-candidates`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-service-token": serviceToken },
          // R2：租户随请求点名（服务间调用没有用户身份可推）。
          body: JSON.stringify({ menu, agentId, tenantId: who.tenantId, ...(who.userId ? { userId: who.userId } : {}), ...(who.roles ? { roles: who.roles } : {}) }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`agentcore ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return (await res.json()) as { draft: unknown; provenance: unknown };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface FreezeDeps {
  countProposals(tenantId: string, sessionId: string): Promise<number>;
  findProposalByFingerprint(tenantId: string, sessionId: string, fp: string): Promise<FrozenProposal | null>;
  putProposal(p: FrozenProposal): Promise<void>;
  newId(prefix: string): string;
  now(): string;
}

/**
 * 生成 + 定版。**要么给出一份真由 agent 出的定版，要么明确失败 —— 没有第三条路。**
 *
 * 两条路：
 *  · **复用**：指纹命中已有定版 ⇒ 直接返回它，**不再调模型**（重跑字节级一致靠这条）。
 *  · **新出**：调 agent 成功且产出兑现得出杠杆 ⇒ 定版落盘。
 *
 * ── ⛔ 这里**曾经**有第三条「确定性兜底」，2026-09-18 由仓主当场撤销 ──────────────
 * 原实现在 agent 不可用 / 产出不合契约 / 兑现不出杠杆 / 压根没配 A→B 通路这**四种**情形下，
 * 一律现编一份三档提案（保守/折中/进取 = 菜单首/中/末档），**并 `putProposal` 定版落盘、带版本号**，
 * 只把 `agentInvolved:false` + `fallbackReason` 写进 `provenance`。
 *
 * 当时的辩护是「兜底不是静默降级，屏上读得出『本次未调用 agent』」。**这条辩护不成立**：
 * > **「我用『降级被如实标注了』当作『降级可以存在』的证据，而前者并不度量后者。」**
 * 标注解决的是「有没有骗人」，解决不了「**谁批准了这件事**」—— 没有人批准。
 * 而后果是实的：屏上出现三张带版本号的「方案」，用户读到的是**系统的建议**，
 * 实际上那里面**没有任何针对本次事件的取舍判断**（原 `comparisonNote` 自己都这么写）。
 * 更糟的是它会进 Pareto 比对，于是「方案比对」这个功能在 agent 不可达时**照常出图**。
 *
 * ⛔ 也**不许**改用 `applicable:false` 来装这件事：契约 `sim.ts` 白纸黑字定义那个值是
 * 「本租户本体撑不起这个模型」这个**结论**（明确写着「不是错误，不是 4xx/5xx」）。
 * agent 连不上是**运行故障**，不是本体结论 —— 混用就又是一次「拿 X 表示 Y 而 X 不度量 Y」。
 * 故此处抛 `AGENT_PROPOSAL_UNAVAILABLE`（503），原因原样带出，让调用方自己决定怎么显示。
 */
export async function generateAndFreeze(
  deps: FreezeDeps,
  client: ProposerClient | null,
  args: { tenantId: string; sessionId: string; menu: ProposalMenu; agentId: string; userId?: string; roles?: string[] },
): Promise<{ proposal: FrozenProposal; reused: boolean }> {
  const fp = fingerprintMenu(args.menu);
  const existing = await deps.findProposalByFingerprint(args.tenantId, args.sessionId, fp);
  // 指纹命中 ⇒ 世界态与菜单都没变 ⇒ 复用同一版。**这就是第 2 格对照实验成立的机制**。
  if (existing) return { proposal: existing, reused: true };

  let draft: AgentProposalDraft | null = null;
  let provenance: ProposalProvenance = noAgentProvenance("未配置 AGENTCORE_BASE_URL/SERVICE_TOKEN（A→B 服务间通路不可用）");
  if (client) {
    try {
      const out = await client.propose(args.menu, args.agentId, { tenantId: args.tenantId, ...(args.userId ? { userId: args.userId } : {}), ...(args.roles ? { roles: args.roles } : {}) });
      const parsedDraft = AgentProposalDraftSchema.safeParse(out.draft);
      const prov = out.provenance as ProposalProvenance | undefined;
      if (parsedDraft.success && prov && prov.agentInvolved) {
        // ⚠ **收下之前先兑现一遍**（WO-AGENT-INTO-SIM 变异反证逼出来的第三道关）。
        //
        // 前两关都拦不住越界下标：`expectsSchema` 只认 type/properties/required，
        // `AgentProposalDraftSchema` 只认「是非负整数」——**都不认识菜单**，
        // 而「第几档」越没越界只有对着菜单才知道。于是越界下标一路绿灯走到定版。
        //
        // 实测后果（真跑出来的，不是推演的）：一份越界 draft 被 `putProposal` **定版落盘**，
        // 随后 `resolveProposalToLevers` 抛 ⇒ 路由 500。而定版是按 `inputFingerprint` 复用的，
        // 于是**这个会话在这个世界态下永远 500** —— 重试只会把那份坏定版再取出来抛一次。
        // 亲手复现：同一 sessionId 连打两次，第二次仍是
        // `INTERNAL_ERROR ... 引用了不存在的档位下标 8（该杠杆只有 3 档）`。
        //
        // 形态（铁律 0.6 句式）：
        // **「我用『draft 合 schema』当作『draft 兑现得出来』的证据，而前者并不度量后者
        //   —— schema 不认识菜单。」**
        //
        // ⛔ 修法**不是**让 `resolveProposalToLevers` 变宽容（夹到末档 / 跳过越界项）：
        //   那会让「agent 挑了第 8 档」静默变成「第 3 档」，屏上一切正常而方案已被悄悄换掉 ——
        //   比 500 坏得多。兑现层必须继续**抛**（`agent-proposal.seam.test.ts` §2 咬着它）。
        //   正确的位置是**收下之前**：兑现不出来的 draft 与「不合契约」同一处置 ——
        //   拒收 + 诚实降级到确定性兜底，`agentInvolved:false` + 写清原因。坏产出一步都进不了定版。
        let resolvable = true;
        let resolveErr = "";
        try {
          resolveProposalToLevers(args.menu, parsedDraft.data);
        } catch (e) {
          resolvable = false;
          resolveErr = (e as Error).message;
        }
        if (resolvable) {
          draft = parsedDraft.data;
          provenance = prov;
        } else {
          provenance = noAgentProvenance(`agent 产出兑现不出杠杆网格（下标越界，已拒收）：${resolveErr.slice(0, 200)}`);
        }
      } else {
        provenance = noAgentProvenance(prov?.fallbackReason ?? "agent 未返回合契约的提案");
      }
    } catch (e) {
      provenance = noAgentProvenance(`调 agentcore 失败：${(e as Error).message}`);
    }
  }
  // ⛔ 拿不到真 agent 产出 ⇒ **明确失败，不编**。四种情形（没配通路 / 调用抛 / 产出不合契约 /
  //    兑现不出杠杆）共用这一个出口，原因原样带给调用方 —— 见本函数头注「第三条路已撤销」。
  if (!draft) {
    throw new AppError(
      "AGENT_PROPOSAL_UNAVAILABLE",
      `方案生成未能由 agent 完成，本次不出方案：${provenance.fallbackReason ?? "原因未记录"}`,
      503,
    );
  }

  const version = (await deps.countProposals(args.tenantId, args.sessionId)) + 1;
  const proposal = FrozenProposalSchema.parse({
    proposalId: deps.newId("prop"),
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    version,
    inputFingerprint: fp,
    menu: args.menu,
    draft,
    provenance,
    createdAt: deps.now(),
  });
  await deps.putProposal(proposal);
  return { proposal, reused: false };
}

/**
 * ⛔ **`deterministicFallbackDraft` 已于 2026-09-18 删除，不许恢复。**
 *
 * 它原来在 agent 不可用时按菜单首/中/末档现编三个「方案」（保守/折中/进取）并**定版落盘**。
 * 删除理由见 `generateAndFreeze` 头注：**没有人批准过降级**；「把降级如实标注」不等于「降级可以存在」。
 *
 * 要恢复这类行为，先回答一个问题：**屏上那三张卡，用户会不会把它读成系统的建议？**
 * 会 ⇒ 它就不该在 agent 没参与时出现，无论 `provenance` 里写了什么。
 */
