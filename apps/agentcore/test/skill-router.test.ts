import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { lexTokens, rankSkills, selectSkills } from "../src/agent/skill-router.js";
import { buildSkillSection } from "../src/agent/prompts.js";

const mk = (id: string, name: string, summary: string): SkillDefinition =>
  ({ id, key: id, name, summary, body: "", version: 1, status: "PUBLISHED", tenantId: "demo", resources: [] }) as unknown as SkillDefinition;

const SKILLS = [
  mk("s02", "受影响订单解读", "解读交期风险扫描结果，说明哪些订单受影响"),
  mk("s04", "规划体检解读", "解读规划体检结论，硬矛盾软风险评分"),
  mk("s08", "齐套分析解读", "解读物料齐套分析，缺什么料、何时补齐"),
  mk("s15", "接单毛利解读", "解读接单毛利评审，毛利是否过线"),
  mk("s16", "客户信用解读", "解读客户信用判定，敞口与逾期"),
  mk("s20", "碳足迹解读", "解读碳足迹核算，是否达标、怎么降"),
  mk("s10", "库存优化解读", "解读库存优化清单，超储欠储呆滞"),
];

describe("Phase5C skill 语义路由", () => {
  it("SR1: 词法分词含 CJK 二元组 + ASCII 词，过滤停用词", () => {
    const t = lexTokens("常州基地影响哪些订单 IRR");
    expect(t.has("常州")).toBe(true);
    expect(t.has("订单")).toBe(true);
    expect(t.has("irr")).toBe(true);
    expect(t.has("哪些")).toBe(false); // 停用词
  });

  it("SR2: 相关性排序 —— 交期风险问句把受影响订单技能排到首位", () => {
    const ranked = rankSkills("常州基地影响哪些订单，交期风险大吗", SKILLS);
    expect(ranked[0]!.skill.id).toBe("s02");
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it("SR3: 同分按 id 稳定排序（确定性）", () => {
    const a = rankSkills("无关查询zzz", SKILLS).map((r) => r.skill.id);
    const b = rankSkills("无关查询zzz", SKILLS).map((r) => r.skill.id);
    expect(a).toEqual(b);
  });

  it("SR4: selectSkills 收紧到 top-k，其余 deferred；技能数 ≤ topK 时全量", () => {
    const sel = selectSkills("毛利过线吗，客户信用敞口", SKILLS, 3);
    expect(sel.full).toHaveLength(3);
    expect(sel.deferred).toHaveLength(SKILLS.length - 3);
    const fullIds = sel.full.map((s) => s.id);
    expect(fullIds).toContain("s15"); // 毛利
    expect(fullIds).toContain("s16"); // 信用

    const all = selectSkills("任意", SKILLS.slice(0, 2), 6);
    expect(all.full).toHaveLength(2);
    expect(all.deferred).toHaveLength(0);
  });

  it("SR6: embedder 可插拔（生产可注入真 embedding provider）——自定义向量覆盖词法排序", () => {
    const query = "毛利过线吗"; // 词法上与 s15(毛利) 相关
    // 自定义 embedder：把 query 与含“碳”的 s20 文本映射到同向量，其余正交 → 模拟“语义”关联。
    const embedder = (text: string) => (text === query || text.includes("碳") ? [1, 0] : [0, 1]);
    const ranked = rankSkills(query, SKILLS, embedder);
    // 尽管词法指向 s15，embedding 主导 → s20 居首（证明 embedding 覆盖词法、且可插拔）
    expect(ranked[0]!.skill.id).toBe("s20");
  });

  it("SR5: buildSkillSection 带 query → 全文仅 top-k，其余列为 load_skill 可取", () => {
    const sec = buildSkillSection(SKILLS, { query: "碳足迹达标吗", topK: 2 });
    expect(sec).toContain("s20"); // 碳足迹全文
    expect(sec).toContain("其余");
    // 无 query → 全量（向后兼容）
    const all = buildSkillSection(SKILLS);
    for (const s of SKILLS) expect(all).toContain(s.id);
    expect(all).not.toContain("其余");
  });
});
