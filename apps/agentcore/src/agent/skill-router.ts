import type { SkillDefinition } from "@platform/contracts";
import { cosine, pseudoEmbed } from "../util/embedding.js";

/**
 * Skill 语义路由（Phase5C + Phase7B 升级为 embedding 向量余弦）。
 *
 * 问题（自检）：此前所有绑定 skill 的 summary 全量注入 system prompt，挤占上下文预算、
 * 稀释相关性。本路由按 query 相关性给 skill 打分，仅把 top-k 的全文 summary 注入，
 * 其余降级为「id+名」经 load_skill 按需加载（保留渐进式披露）。
 *
 * 相关性 = embedding 余弦（主）+ 词法重叠（次，仅平手裁决）。embedder 可插拔：
 * 生产可注入真 embedding provider；CI 用确定性 pseudoEmbed（同输入同输出，可复现）。
 */
export type Embedder = (text: string) => number[];
const defaultEmbedder: Embedder = (t) => pseudoEmbed(t);

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

/** 词法重叠计数（平手裁决用）：query token 命中 skill(name 权重×2 / summary ×1)。 */
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

/** 相关性排序：embedding 余弦(主) + 词法重叠×1e-3(次，平手裁决)；再同分按 id 稳定排序。 */
export function rankSkills(
  query: string,
  skills: SkillDefinition[],
  embedder: Embedder = defaultEmbedder,
): { skill: SkillDefinition; score: number }[] {
  const qv = embedder(query ?? "");
  const qt = lexTokens(query ?? "");
  return skills
    .map((skill) => {
      const sim = cosine(qv, embedder(`${skill.name ?? ""} ${skill.summary ?? ""}`));
      const score = Math.round((sim + scoreSkill(qt, skill) * 1e-3) * 1e6) / 1e6;
      return { skill, score };
    })
    .sort((a, b) => b.score - a.score || (a.skill.id < b.skill.id ? -1 : a.skill.id > b.skill.id ? 1 : 0));
}

/**
 * 选取注入 system prompt 的 skill：skills ≤ topK 或 query 空 → 全量；否则相关性 top-k。
 * 返回 { full: 注入全文 summary, deferred: 仅列 id/名（load_skill 可取） }。
 */
export function selectSkills(
  query: string | undefined,
  skills: SkillDefinition[],
  topK = 6,
  embedder: Embedder = defaultEmbedder,
): { full: SkillDefinition[]; deferred: SkillDefinition[] } {
  if (!query || skills.length <= topK) return { full: skills, deferred: [] };
  const ranked = rankSkills(query, skills, embedder);
  return { full: ranked.slice(0, topK).map((r) => r.skill), deferred: ranked.slice(topK).map((r) => r.skill) };
}
