import type { AgentIteration } from "@platform/contracts";
import { scanBlocks } from "../util/numerics.js";

/**
 * WO-REFLECT-LOOP · Agent 收尾前的**确定性复盘**（补齐「理解-计划-分解-执行-反思」闭环的反思步）。
 *
 * 定位（loop.ts §收尾）：模型将调 final_answer 收尾前先过一遍此清单——不过关则 loop 把「不过关原因」回注、
 * 硬有界重规划一轮再复盘。**纯确定性 R6**（无 LLM/时钟/随机）——同 (answer, 轨迹, 问句) → 同判定；可选 LLM critic
 * 由 loop.ts 侧 advisory 叠加（fail-open·不入本模块）。仅服务 path-B `runAgentLoop`（path-A/compose 直出不经此）。
 */

export interface ReflectInput {
  /** final_answer 的 blocks（复用 scanBlocks 判裸数）。 */
  blocks: { type: string; markdown?: string }[];
  /** provenance 条数（判 ⟦ref:N⟧ 下标是否越界）。 */
  provenanceCount: number;
  /** 本次运行工具调用轨迹（判静默失败 + 是否调过对口 solver）。 */
  iterations: AgentIteration[];
  /** 用户问句正文（判排产/优化类是否走了 solver·求解纪律）。 */
  userContent: string;
}

export interface ReflectVerdict {
  ok: boolean;
  /** 未过关的原因清单（回注重规划提示·也用作 replanReason 观测）。 */
  reasons: string[];
}

/** 排产/优化/资源分配/可行性类问句 → 求解纪律：禁自算，必须调对口 solver。 */
const SOLVER_REQUIRED_RE =
  /(排产|排程|重排|挤占|拆产|优化|最优|最大化|最小化|最低成本|最大收益|资源分配|联合求解|承诺|接单|齐套|产能.{0,6}(可行|够|承接|缺口|穿仓)|可行性)/;
/** 答案是否承认了取证失败（静默失败护栏：有工具报错但答案只字未提 → 判静默吞）。 */
const FAILURE_ACK_RE = /(取证失败|未能|失败|无权|超时|无数据|无法|受限|不完整|未获取|缺该|部分结论)/;
/** 占位/空答（非真正作答）。 */
const PLACEHOLDER_RE = /(未能产出回答|探索模式未能|未形成最终结论|未能完全解答|无可复述)/;
/** ⟦ref:N⟧ 溯源指针。 */
const REF_RE = /⟦ref:(\d+)⟧/g;

/** 是否至少一次成功的 invoke_solver（求解纪律的"走了 solver"判据）。 */
function calledSolverOk(iterations: AgentIteration[]): boolean {
  return iterations.some((it) => it.toolCalls.some((c) => c.toolName === "invoke_solver" && c.outcome === "OK"));
}

/** 有工具报错/被拒/超预算，但答案文本只字未提 → 静默失败（KILL-MOCK-RED·不许把失败当没发生）。 */
function hasSilentToolFailure(iterations: AgentIteration[], blocks: ReflectInput["blocks"]): boolean {
  const anyFail = iterations.some((it) =>
    it.toolCalls.some((c) => c.outcome === "ERROR" || c.outcome === "DENIED" || c.outcome === "BUDGET_EXCEEDED"),
  );
  if (!anyFail) return false;
  const ack = blocks.some((b) => b.type === "text" && typeof b.markdown === "string" && FAILURE_ACK_RE.test(b.markdown));
  return !ack;
}

/** 每个 ⟦ref:N⟧ 的 N 必须落在 [0, provenanceCount)（溯源指针有效）。 */
function refsWithinRange(blocks: ReflectInput["blocks"], provenanceCount: number): boolean {
  for (const b of blocks) {
    if (b.type !== "text" || typeof b.markdown !== "string") continue;
    for (const m of b.markdown.matchAll(REF_RE)) {
      const n = Number(m[1]);
      if (!(Number.isInteger(n) && n >= 0 && n < provenanceCount)) return false;
    }
  }
  return true;
}

/**
 * 收尾前确定性复盘清单（R6）：返回 {ok, reasons}。不过关 → 调用方回注 reasons 重规划一轮。
 * 检查项（对齐 WO-REFLECT-LOOP §产出①③）：
 *  ① 答了吗——blocks 非空且非占位；② 数字落地——无裸数（scanBlocks）且 ⟦ref:N⟧ 不越界；
 *  ③ 工具静默失败——有报错/被拒但答案未体现；④ Solver-first——排产/优化题未调过 solver（求解纪律违规）。
 * （口径一致 crossValidate / 越 scope 对象域判定需上游注入 hook·本纯函数不承载·见 loop.ts 侧可选叠加。）
 */
export function reflectAnswer(input: ReflectInput): ReflectVerdict {
  const reasons: string[] = [];
  const textBlocks = input.blocks.filter((b) => b.type === "text");

  // ① 答了吗（blocks 空 / 文本全为占位 → 未真正作答）。
  const emptyOrPlaceholder =
    input.blocks.length === 0 ||
    (textBlocks.length > 0 && textBlocks.every((b) => !b.markdown?.trim() || PLACEHOLDER_RE.test(b.markdown)));
  if (emptyOrPlaceholder) reasons.push("答案为空或仅占位（未真正作答）");

  // ② 数字落地（数字红线）：裸数 / ⟦ref:N⟧ 越界。
  if (scanBlocks(input.blocks)) reasons.push("存在未溯源业务数字（数字红线：每个业务数字须 ⟦ref:N⟧）");
  if (!refsWithinRange(input.blocks, input.provenanceCount))
    reasons.push("⟦ref:N⟧ 引用下标越出 provenance 范围（溯源指针无效）");

  // ③ 工具静默失败（不许把失败当没发生）。
  if (hasSilentToolFailure(input.iterations, input.blocks))
    reasons.push("有工具调用报错/被拒/超预算，但答案未体现（静默失败·须诚实交代或补取证）");

  // ④ Solver-first（求解纪律）：排产/优化/可行性题未调过对口 solver。
  if (SOLVER_REQUIRED_RE.test(input.userContent) && !calledSolverOk(input.iterations))
    reasons.push("排产/优化/可行性类问题未调用对口 solver（求解纪律：禁自算·须走 invoke_solver）");

  return { ok: reasons.length === 0, reasons };
}
