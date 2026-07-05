import type { AnswerBlock, ProvenanceRef } from "@platform/contracts";

/**
 * 溯源角标引用完整性（WO PROV-REF-INTEGRITY·审计簇⑩死角标·R13/G-3）。
 *
 * 单一约定：`⟦ref:n⟧` **数字索引**是"作者位"记号——执行计划模板与 agent prompt 同款约定
 * （n = 本答案 provenance 数组下标，作者/模型产出时真实 provId 尚不存在）；而**前端只认 provId**
 * （AnswerCard.provIndex 按 id 查找、悬停浮层按 id 取条目），数字索引永 miss → 渲染 [0] 死角标、
 * 悬停恒『加载中…』（审计 S01 [0][0][0] 三连）。
 *
 * 因此所有答案组装口（Path A renderAnswer / 规则拦截块 / Path B & 场景 agent acceptFinalAnswer）
 * 在出答案前统一调用本函数把数字索引解析成真实 provId：
 *  - `⟦ref:2⟧` → `⟦ref:${provenance[2].id}⟧`（悬停即出该条真溯源：来源工具/字段路径/快照版本）；
 *  - 越界/无对应条目 → **诚实摘除标记**（该句数字随之被 §5.5 扫描打「未溯源」琥珀条——宁可诚实
 *    示警，不留一个点不出内容的假角标）；
 *  - 已是真实 provId 的标记（prov_… 含字母，非纯数字）原样保留。
 */
const NUMERIC_REF_RE = /( ?)⟦ref:(\d+)⟧/gu;
const ANY_REF_RE = /( ?)⟦ref:[^⟧]*⟧/gu;

/**
 * 摘除全部 ⟦ref:…⟧ 角标（含前导空格）。用于**脱离本答案上下文**的文本再利用（如观察记忆蒸馏
 * keyFindings/outcome）：provId 是**答案实例级**标识（每次运行新铸 ULID），嵌进经验条目既悬停
 * 不可解析、又破坏 R6 同 trace 字节一致蒸馏。
 */
export function stripRefMarks(markdown: string): string {
  return markdown.replace(ANY_REF_RE, "");
}

export function resolveNumericRefs(blocks: AnswerBlock[], provenance: ProvenanceRef[]): AnswerBlock[] {
  return blocks.map((b) => {
    if (b.type !== "text") return b;
    const markdown = b.markdown.replace(NUMERIC_REF_RE, (_m, sp: string, idx: string) => {
      const entry = provenance[Number(idx)];
      return entry ? `${sp}⟦ref:${entry.id}⟧` : "";
    });
    return markdown === b.markdown ? b : { ...b, markdown };
  });
}
