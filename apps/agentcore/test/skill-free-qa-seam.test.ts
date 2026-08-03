import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { selectTenantSkills, skillOnFreeQaEnabled } from "../src/router/orchestrator.js";

/**
 * #90 SEAM · 默认自由问答挂载租户技能（暗发 `agent.skill-on-free-qa`）。
 *
 * 病灶：`buildSkillSection` 全仓**只有一个调用方** `engine.ts:313 runRegisteredAgent`——skill 绑在
 * `agent.skills` 上。泛化 path-B（`orchestrator.ts runPathB → runAgentLoop`）用裸 `AGENT_SYSTEM_CORE`，
 * 既无技能段、也不传 `loadSkillEnabled`/`loadSkill` → 整套 Skill 子系统（发布双门禁 / evals /
 * 语义路由 / `QOS_EMBEDDING_*` 旋钮）对**默认路径完全不可达**。这不是"忘传一个 flag"：泛化路径
 * 根本没有 agent，需要一条**租户级**技能来源，所以走暗发门而不是直接改默认行为。
 *
 * 门关 = 既有 path-B 的 system prompt 与工具集**逐字节不变**（①）；门开才接（②③）。
 */

const skill = (over: Partial<SkillDefinition> & { id: string; key: string; version: number }): SkillDefinition => ({
  tenantId: TENANT,
  name: `技能 ${over.key}`,
  summary: `摘要 ${over.key} v${over.version}`,
  body: `正文 ${over.key} v${over.version}`,
  resources: [],
  status: "PUBLISHED",
  ...over,
});

const ON = [...defaultOnKeys(), "agent.skill-on-free-qa"];
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

async function freeQa(t: TestApp, query = "给我个自由结论") {
  t.llm.queueClassification(OUT_OF_CATALOG);
  const { taskId } = await submitQuery(t, PLANNER, query, { view: "dash" });
  const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
  return { task, taskId, req0: t.llm.agentRequests[0]! };
}

describe("#90 SEAM · Skill 对默认自由问答路径可达（暗发）", () => {
  it("① 门关（缺省）：租户有已发布技能也不进 system、load_skill 不在工具集 —— 既有 path-B 字节兼容", async () => {
    const t: TestApp = await createTestApp();
    await t.repos.skills.insert(skill({ id: "skl_a", key: "cap_sop", version: 1 }));
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "答。" }], provenance: [] })] });
    const { req0 } = await freeQa(t);
    expect(req0.system).not.toContain("可用技能");
    expect(req0.system).not.toContain("摘要 cap_sop");
    expect(req0.tools.map((x) => x.name)).not.toContain("load_skill");
  });

  it("② 门开：技能摘要进 system，且 load_skill 真能取到全文（效果层·不是只把工具挂上）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    await t.repos.skills.insert(skill({ id: "skl_a", key: "cap_sop", version: 1, body: "正文含暗号 SOP-9527" }));

    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: "skl_a" })] }, (req) => {
      // 第二轮：全文已进对话（渐进披露第二级）——这才是「技能真被用上」的效果层证据。
      expect(JSON.stringify(req.messages)).toContain("SOP-9527");
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已按技能执行。" }], provenance: [] })] };
    });

    const { req0, taskId, task } = await freeQa(t);
    expect(task.path).toBe("AGENT");
    expect(req0.system).toContain("可用技能");
    expect(req0.system).toContain("摘要 cap_sop");
    expect(req0.system).not.toContain("SOP-9527"); // 全文不常驻 system（渐进披露）
    expect(req0.tools.map((x) => x.name)).toContain("load_skill");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    expect(calls.some((c) => c.toolName === "load_skill" && c.outcome === "OK")).toBe(true);
  });

  it("③ 门开但租户无已发布技能：不挂 load_skill（空池挂工具 = 给模型一个永远返 undefined 的钩子）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    await t.repos.skills.insert(skill({ id: "skl_d", key: "draft_only", version: 1, status: "DRAFT" }));
    await t.repos.skills.insert(skill({ id: "skl_r", key: "retired_only", version: 1, status: "RETIRED" }));
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "答。" }], provenance: [] })] });
    const { req0 } = await freeQa(t);
    expect(req0.tools.map((x) => x.name)).not.toContain("load_skill");
    expect(req0.system).not.toContain("可用技能");
  });

  it("④ 越权守卫：模型猜一个不在本次清单里的 skillId → load_skill 取不到（不得越出租户已发布集）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    await t.repos.skills.insert(skill({ id: "skl_a", key: "cap_sop", version: 1 }));
    // 同库里存在但**未发布**的另一个技能：清单里没有它 → 猜中 id 也拿不到。
    await t.repos.skills.insert(skill({ id: "skl_secret", key: "secret_sop", version: 1, status: "DRAFT", body: "机密正文 XYZZY" }));

    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: "skl_secret" })] }, (req) => {
      expect(JSON.stringify(req.messages)).not.toContain("XYZZY");
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "取不到。" }], provenance: [] })] };
    });
    const { req0 } = await freeQa(t);
    expect(req0.system).not.toContain("secret_sop");
  });

  it("⑤ 纯函数 selectTenantSkills：只收 PUBLISHED · 同 key 取最高版本 · key 字典序（R6 同输入同输出）", () => {
    const pool = [
      skill({ id: "s3", key: "b_sop", version: 3 }),
      skill({ id: "s1", key: "a_sop", version: 1 }),
      skill({ id: "s2", key: "b_sop", version: 5 }),
      skill({ id: "s4", key: "c_sop", version: 9, status: "DRAFT" }),
      skill({ id: "s5", key: "d_sop", version: 2, status: "RETIRED" }),
    ];
    const picked = selectTenantSkills(pool);
    expect(picked.map((s) => `${s.key}@${s.version}`)).toEqual(["a_sop@1", "b_sop@5"]);
    expect(selectTenantSkills([...pool].reverse()).map((s) => s.id)).toEqual(picked.map((s) => s.id)); // 输入顺序无关
  });

  it("⑥ 门判据字节兼容：`ALL`（mock 默认 / DataCore 降级）一律视为关，不因 fail-open 被动开暗发", () => {
    expect(skillOnFreeQaEnabled("ALL")).toBe(false);
    expect(skillOnFreeQaEnabled(new Set(defaultOnKeys()))).toBe(false);
    expect(skillOnFreeQaEnabled(new Set(ON))).toBe(true);
  });

  it("⑦ 防回潮：`buildSkillSection` 不得再回到「只有注册 agent 路径一个调用方」的状态", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    const callers = walk(SRC).filter((f) => {
      if (f.endsWith("/agent/prompts.ts")) return false; // 定义处不算调用方
      return /buildSkillSection\(/.test(readFileSync(f, "utf8"));
    });
    const rel = callers.map((f) => f.slice(SRC.length + 1)).sort();
    expect(rel).toEqual(["engine.ts", "router/orchestrator.ts"]);
  });
});
