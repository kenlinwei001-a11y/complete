import type { SkillDefinition } from "@platform/contracts";

/**
 * Skill 语义路由（Phase5C）—— 工业级 agent 上下文工程的「skill router」。
 *
 * 问题（自检）：此前所有绑定 skill 的 summary 全量注入 system prompt，挤占上下文预算、
 * 稀释相关性。本路由在 agent 启动时按 query 相关性给 skill 打分，仅把 top-k 的全文 summary
 * 注入，其余降级为「id+名」可经 load_skill 按需加载（保留渐进式披露）。
 *
 * 确定性：纯词法相关性（CJK 二元组 + ASCII 词），无 LLM、无随机 → 测试可复现。
 */

const STOP = new Set(["的", "了", "吗", "怎么", "如何", "什么", "哪些", "是否", "可以", "需要", "the", "is", "a", "of", "to", "and", "for"]);

/** 分词：ASCII 词(≥2) + 连续 CJK 串的二元组（单字 CJK 退化为单字）。 */
export function lexTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of (s.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [])) if (!STOP.has(w)) out.add(w);
  for (const run of (s.match(/[一-鿿]+/g) ?? [])) {
    if (run.length === 1) {
      if (!STOP.has(run)) out.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP.has(bg)) out.add(bg);
    }
  }
  return out;
}

/** 相关性得分：query token 命中 skill(name/summary) token 数；name 命中权重×2。 */
export function scoreSkill(queryTokens: Set<string>, skill: SkillDefinition): number {
  const nameTok = lexTokens(skill.name ?? "");
  const sumTok = lexTokens(`${skill.summary ?? ""}`);
  let score = 0;
  for (const q of queryTokens) {
    if (nameTok.has(q)) score += 2;
    else if (sumTok.has(q)) score += 1;
  }
  return score;
}

/** 按相关性排序（降序），同分按 skill.id 稳定排序 → 确定性。 */
export function rankSkills(query: string, skills: SkillDefinition[]): { skill: SkillDefinition; score: number }[] {
  const qt = lexTokens(query ?? "");
  return skills
    .map((skill) => ({ skill, score: scoreSkill(qt, skill) }))
    .sort((a, b) => b.score - a.score || (a.skill.id < b.skill.id ? -1 : a.skill.id > b.skill.id ? 1 : 0));
}

/**
 * 选取注入 system prompt 的 skill：
 *  - skills ≤ topK 或 query 为空 → 全部注入（与旧行为一致）；
 *  - 否则 → 取相关性 top-k（至少含命中分>0 的；不足 k 时按排序补足）。
 * 返回 { full: 注入全文 summary, deferred: 仅列 id/名（load_skill 可取） }。
 */
export function selectSkills(
  query: string | undefined,
  skills: SkillDefinition[],
  topK = 6,
): { full: SkillDefinition[]; deferred: SkillDefinition[] } {
  if (!query || skills.length <= topK) return { full: skills, deferred: [] };
  const ranked = rankSkills(query, skills);
  return { full: ranked.slice(0, topK).map((r) => r.skill), deferred: ranked.slice(topK).map((r) => r.skill) };
}
