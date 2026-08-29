// A18.2 · LLM 临时求解器生成（消灭 P5：缺求解器 → LLM 生成纯函数代码）。
// 只在生成时刻调一次 LLM，产物随后冻结（hash+版本）+ 锁死沙箱跑通——LLM 的不确定性被隔离在"生成时刻"之外（R6）。
import type { LlmClient } from "../llm.js";
import { SolverGenDraftSchema, type SolverGenDraft } from "@platform/contracts";

export interface SolverGenSpec {
  /** 缺失的求解器 key（如 capacity_switch_optimizer）。 */
  key: string;
  /** 自然语言意图（这个求解器要算什么）。 */
  intent: string;
  /** 可用对象类型 schema（ctx.objectsByType 的键 + 字段），供 LLM 写正确字段引用。
   * DF.5 语义目录：`propDocs` 给字段业务描述（propKey→描述），注入 prompt 让 LLM 按语义选对字段、不臆造列名。 */
  objectTypes: { typeKey: string; props: string[]; propDocs?: Record<string, string> }[];
  /** DF.8 生成接地：已发布业务词表（基地/细分实例名）。注入 prompt + 注册前越界校验，使生成不造业务事实。 */
  vocab?: string[];
}

/**
 * DF.8 接地校验（确定性，R6）：扫 computeSource 中"实体名样式"字符串字面量（以 基地/产线/工厂 结尾），
 * 凡不在已发布业务词表内 → 判越界（= LLM 编造了不存在的业务实体）。窄规则：只认实体后缀，
 * 不误伤单位/状态/工序文案（万套/认证中/化成柜…）。返回越界实体名集（空=接地通过）。
 */
export function checkGrounding(computeSource: string, vocab: string[]): string[] {
  const allowed = new Set<string>([...vocab, ...vocab.map((v) => `${v}基地`)]);
  const re = /["'`]([^"'`]*?(?:基地|产线|工厂))["'`]/g;
  const violations: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(computeSource))) {
    const lit = m[1]!;
    if (allowed.has(lit) || allowed.has(lit.replace(/基地$/, ""))) continue;
    violations.push(lit);
  }
  return [...new Set(violations)];
}

const SYSTEM = [
  "你为决策平台生成**临时求解器纯函数**。严格约束（违反即被沙箱拒）：",
  "1) 只输出一个纯函数表达式 `(ctx, args) => output`，无 import/require/网络/fs；",
  "2) **禁用** Date.now/new Date()/Math.random 等非确定来源（沙箱会掐死，必须确定性）；",
  "3) 只读 `ctx.objectsByType[<类型>]`（对象行数组）与 `args`（调用参数），返回可 JSON 序列化的对象；",
  "4) outputShape 列出 output 的顶层 key；argHints 给入参提示；rationale 一句话说明算法。",
  "computeSource 形如：(ctx, args) => { const orders = ctx.objectsByType.Order || []; return { total: orders.length }; }",
].join("\n");

/** 调 LLM 产出求解器草稿（沙箱跑通自检前）。mock LLM 测试；真 Kimi env-gated。 */
export async function generateSolverDraft(llm: LlmClient, spec: SolverGenSpec, opts: { tenantId?: string } = {}): Promise<SolverGenDraft> {
  const schemaText = spec.objectTypes
    .map((t) => {
      // DF.5：有语义描述的字段渲染 propKey(描述)，让 LLM 按业务含义选字段。
      const props = t.props.map((p) => (t.propDocs && t.propDocs[p] ? `${p}(${t.propDocs[p]})` : p));
      return `${t.typeKey}{${props.join(",")}}`;
    })
    .join(" · ");
  // DF.8 接地：注入业务词表，约束 LLM 只引用边界内实体、不造业务事实。
  const vocabText = spec.vocab && spec.vocab.length > 0
    ? `\n**业务词表（实体只能引用以下，禁止编造基地/型号/细分名，越界将被拒）**：${spec.vocab.join("、")}`
    : "";
  const draft = await llm.parseStructured<SolverGenDraft>({
    model: "default",
    maxTokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `求解器 key：${spec.key}\n意图：${spec.intent}\n可用对象类型：${schemaText}${vocabText}\n生成 {computeSource,outputShape,argHints,rationale}。` }],
    schema: SolverGenDraftSchema,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    purpose: "comprehend",
  });
  return draft;
}
