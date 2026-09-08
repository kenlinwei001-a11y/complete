/**
 * WO-AGENT-IN-LOOP · **方案生成**：让 agent 参与「挑哪几条对策」，且一个数都不许它产。
 *
 * ══ 分工（仓主 2026-09-08 定的架构原则，本文件的前提）════════════════════════
 * > 「所有计算原则上使用**求解器**而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、
 * >   规则等等输出结果，然后基于结果推演，形成**多个方案和方案比对**。」
 *
 * 本文件就是「agent 只负责编排 + 出方案」那一层：
 *  · **入**：`ProposalMenu` —— 装配器（确定性）从本体真值算出来的**杠杆菜单** + 世界态摘要
 *            （含求解器已经算好的基线读数）。
 *  · **出**：`AgentProposalDraft` —— **只有下标与文字**（见契约 `sim-proposal.ts` 的红线段）。
 *  · **数**：一个都不产。数值全在菜单里，兑现在 `resolveProposalToLevers`（契约包，纯函数）。
 *
 * ⚠ 「不许产数」不靠提示词，靠 `expectsSchema`：本文件把 `AgentProposalDraft` 的 JSON-Schema
 *   下发给两条臂（内置 `loop.ts acceptFinalAnswer` / dsh `reassemble.ts` 都按它 fail-closed 校验），
 *   schema 里根本没有承载业务数值的格 ⇒ agent 想产数也没地方放。
 *
 * ══ 走哪条内核：**读实际发生的，不预测** ═══════════════════════════════════════
 * `route` 取自 `runRegisteredAgent` 回来的 `result.run.kernel` —— 那是**真跑过之后**由
 * engine 标的（`NATIVE` = 内置 runAgentLoop / `EXTERNAL` = dsh 出进程 JSON-RPC 分叉）。
 *
 * ⛔ **本文件不复刻 engine 那条分叉表达式，也不 import `dsh-runtime`**：
 *   · 复刻 = 两处判据迟早漂，而屏上那句「本次走的是 dsh」会先于代码漂掉；
 *   · import = `check-dsh-dormancy.mjs` 的 D2/D3 当场红，且**它红得对**
 *     （静态 import 在链接期加载 ⇒ flag 关着也照跑，休眠论证直接作废）。
 *   本文件对 dsh 的全部关系就是**读回它跑完之后留下的那个字段**，零耦合。
 *
 * ⛔ 本文件**不翻 `DSH_HARNESS`**、不写任何部署面。翻 flag 的三条前置条件见
 *   `docs/DECISION-dsh-fusion.md` §3，销账另有其单（`WO-DSH-UNFREEZE`）。
 *   走 dsh 的合法途径只有一条：**agent 记录自己声明 `kernel:"EXTERNAL"`**
 *   （`WO-AGENT-KERNEL-SELECT` 的 per-agent 选择，engine.ts:630 显式值优先于 env）。
 */
import {
  AgentProposalDraftSchema,
  type AgentProposalDraft,
  type ProposalMenu,
  type ProposalProvenance,
  type ProposalRoute,
} from "@platform/contracts";

/**
 * 下发给两条臂的 JSON-Schema。**手写而不是从 zod 生成**：本仓 `expectsSchema` 走的是
 * `util/jsonschema.ts` 那个最小实现（type/properties/required/items/enum），
 * 用完整 JSON-Schema 生成器产出的东西它认不全 —— 与其让校验静默放行，不如写死这一份小的。
 *
 * ⚠ **这份 schema 与 `AgentProposalDraftSchema` 必须同构**，且同构性由测试咬住
 *   （`agent-proposal-no-numbers` 那条：两边都不许出现承载业务数值的格）。
 */
export const PROPOSAL_DRAFT_JSON_SCHEMA = {
  type: "object",
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "rationale", "picks"],
        properties: {
          name: { type: "string" },
          rationale: { type: "string" },
          picks: {
            type: "array",
            items: {
              type: "object",
              required: ["leverIndex", "valueIndex"],
              properties: {
                // ⚠ 这两个是**下标**不是数量 —— 全 schema 仅有的两个 number，
                //   它们索引菜单，不承载业务量。见契约 `ProposalPickSchema` 的红线段。
                leverIndex: { type: "number" },
                valueIndex: { type: "number" },
              },
            },
          },
        },
      },
    },
    comparisonNote: { type: "string" },
  },
} as const;

/** 本文件对 engine 的全部依赖面（注入，便于测试用脚本化替身，不吊起真 engine）。 */
export interface ProposeEngineLike {
  runRegisteredAgent(opts: {
    taskId: string;
    agentId: string;
    version: number | "latest";
    prompt: string;
    ctx: unknown;
    nesting: unknown;
    emit: (event: string, payload: unknown) => Promise<void>;
    expectsSchema?: Record<string, unknown>;
  }): Promise<{ outcome: string; structured?: unknown; run: { kernel?: string; model?: string } }>;
}

export interface ProposeInput {
  menu: ProposalMenu;
  agentId: string;
  version?: number | "latest";
  taskId: string;
  ctx: unknown;
  nesting: unknown;
}

export interface ProposeOutput {
  draft: AgentProposalDraft | null;
  provenance: ProposalProvenance;
}

/**
 * 把菜单渲染成 agent 读得懂的编号清单。
 *
 * **下标是这里印出去的那个**（从 0 起），与 `resolveProposalToLevers` 解的是同一套 ——
 * 两边若各编各的号，agent 挑第 2 项会解成第 3 项，而结果看起来完全正常。
 * 故渲染与兑现共用同一个数组顺序（`menu.levers` 原序，装配器已定序）。
 */
export function renderMenuPrompt(menu: ProposalMenu): string {
  const events = menu.worldDigest.events.length
    ? menu.worldDigest.events
        .map((e) => `  · ${e.kind} @ ${e.target}${e.magnitude === null ? "" : `（幅度 ${e.magnitude}）`}`)
        .join("\n")
    : "  · （无扰动：这是基线态）";
  const baseline = Object.entries(menu.worldDigest.baselineMetrics)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `  · ${k} = ${v}`)
    .join("\n") || "  · （求解器未给基线读数）";
  const counts = Object.entries(menu.worldDigest.counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `  · ${k}：${v} 条`)
    .join("\n") || "  · （无）";
  const levers = menu.levers
    .map((l, i) => {
      const vals = l.values.map((v, j) => `[${j}] ${v}`).join("  ");
      return `  杠杆 [${i}] ${l.label}（${l.key}）${l.note ? ` —— ${l.note}` : ""}\n      可选档位：${vals}`;
    })
    .join("\n");
  const objectives = menu.objectives.map((o) => `  · ${o.label ?? o.key}（${o.key}，${o.dir === "max" ? "越大越好" : "越小越好"}）`).join("\n");

  return [
    "【本次事件】",
    events,
    "",
    "【求解器算出来的基线读数】（这些数是求解器给的，你直接引用，不要自己重算）",
    baseline,
    "",
    "【世界态规模】",
    counts,
    "",
    "【权衡的目标轴】",
    objectives,
    "",
    "【可用杠杆菜单】（档位数值由本体真值算出，你**只能引用下标**）",
    levers,
    "",
    "【你的任务】",
    "针对**本次事件**，组织 2–5 个**互相有权衡关系**的候选对策方案。每个方案：",
    "  · name：短名（≤40 字），要能看出这个方案的取向；",
    "  · rationale：为什么这组杠杆是对**本次事件**的对策（≤400 字）；",
    "  · picks：这个方案要动哪几根杠杆、各选第几档 —— 用 {leverIndex, valueIndex} 下标。",
    "    ⚠ 同一根杠杆在一个方案里只能选一档。",
    "最后用 comparisonNote 说清这几个方案之间的**权衡**（谁牺牲了什么换到了什么）。",
    "",
    "【硬约束】",
    "  ⛔ 你**不做任何数值计算**，也**不要输出任何业务数字**：每个方案的营收/成本/毛利/获排率",
    "     由求解器算，算完会贴回你的方案上。你的产出里只有下标和文字。",
    "  ⛔ 档位只能从菜单里挑，不许自己编一个数或编一个不存在的下标。",
    "  · 优先挑与本次事件**因果相关**的杠杆；与本次事件无关的杠杆即使可用也别凑数。",
  ].join("\n");
}

/** 未调用 agent 时的诚实回执 —— **必须明写，不许留白**（铁律 1.5 判据二）。 */
export function noAgentProvenance(reason: string): ProposalProvenance {
  return { agentInvolved: false, route: "NONE", provider: null, model: null, agentId: null, elapsedMs: null, fallbackReason: reason };
}

/**
 * 跑一次方案生成。
 *
 * 失败一律**诚实降级**（返回 `draft:null` + `fallbackReason`），不抛 —— 调用方据此回落
 * 到今天那条确定性装配路径，屏上仍有方案可看，只是明写「本次未调用 agent」。
 * ⚠ 这不是 fail-open 放水：被拒的产出**绝不**进定版，红线一步没松。
 */
export async function proposeCandidates(engine: ProposeEngineLike, input: ProposeInput): Promise<ProposeOutput> {
  const started = Date.now();
  let result: Awaited<ReturnType<ProposeEngineLike["runRegisteredAgent"]>>;
  try {
    result = await engine.runRegisteredAgent({
      taskId: input.taskId,
      agentId: input.agentId,
      version: input.version ?? "latest",
      prompt: renderMenuPrompt(input.menu),
      ctx: input.ctx,
      nesting: input.nesting,
      emit: async () => {},
      expectsSchema: PROPOSAL_DRAFT_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (e) {
    return { draft: null, provenance: noAgentProvenance(`agent 调用抛错：${(e as Error).message}`) };
  }
  const elapsedMs = Date.now() - started;
  // 内核标识取**真跑过之后**engine 标的那个值（不预测、不复刻分叉表达式）。
  const route: ProposalRoute = result.run?.kernel === "EXTERNAL" ? "EXTERNAL" : "NATIVE";
  const model = result.run?.model ?? null;
  const base = { agentInvolved: true, route, provider: model ? model.split(":")[0] ?? null : null, model, agentId: input.agentId, elapsedMs };

  if (result.outcome !== "ANSWERED") {
    return { draft: null, provenance: { ...base, agentInvolved: false, route: "NONE", fallbackReason: `agent 未给出答案（outcome=${result.outcome}）` } };
  }
  // 二次校验：`expectsSchema` 那一关只认最小 JSON-Schema（type/properties/required），
  // 这里再用 zod **strictObject** 咬一遍 —— 多出来的字段、越界的下标一律拒。
  const parsed = AgentProposalDraftSchema.safeParse(result.structured);
  if (!parsed.success) {
    return { draft: null, provenance: { ...base, agentInvolved: false, route: "NONE", fallbackReason: `agent 产出不合契约：${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` } };
  }
  return { draft: parsed.data, provenance: { ...base, fallbackReason: null } };
}
