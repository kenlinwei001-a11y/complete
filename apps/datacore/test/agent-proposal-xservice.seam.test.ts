/**
 * WO-AGENT-INTO-SIM · **A↔B 真接缝**：A 侧 `httpProposerClient` → 真 HTTP →
 * B 侧真 `POST /b/v1/sim/propose-candidates`（真 `buildServer` 起的路由）→ 真提案 →
 * A 侧真定版 → 真兑现成杠杆网格。
 *
 * ══ 为什么这条测试非有不可（既有那份 seam 测试证明不了它）══════════════════════
 * `agent-proposal.seam.test.ts` 有 272 行、6 个 describe、全绿 —— 但它**一次 HTTP 都没发**：
 * 每处 A→B 都用脚本化替身（`ProposerClient` 接口的手写实现）。于是这条链上
 * **只由「线」承载、不由任何一端的类型承载的东西，全都没人守**：
 *   · URL 路径 `/b/v1/sim/propose-candidates`（两边各写各的字符串）
 *   · 鉴权头名 `x-service-token`（B 侧 `requireServiceToken` 认的那个）
 *   · 请求体字段名 `menu`/`agentId`/`tenantId`/`userId`/`roles`（B 侧 zod 逐字校验）
 *   · 回包字段名 `draft`/`provenance`（A 侧照名取值）
 * 以上任一处改名，**两侧 `pnpm typecheck` 都不会红**（跨进程的字符串，类型系统看不见），
 * 而屏上只会安静地退回「本次未调用 agent」—— 正是本仓「绿测试≠能用·断在接缝」那个老坑。
 *
 * 形态（铁律 0.6 句式）：
 * **「我用『两侧单测都绿』当作『这条线接得上』的证据，而前者并不度量后者。」**
 *
 * ⚠ **LLM 仍然是 mock**（本仓硬约束：测试一律不碰网络）——被替换的只有「模型」那一格，
 *   A→B 的 HTTP、B 的路由与鉴权、agent 编排、`expectsSchema` 校验、zod 二次校验、
 *   下标兑现**全部是真的**。这与「用替身冒充接缝」是两回事：替身替掉的是**线**，这里替掉的是**模型**。
 *
 * ⚠ 跨包导入 agentcore 源码：与既有 `xservice-smoke.test.ts` 同一口径
 *   （那份的原话是「跨包导入：AgentCore 真实 HTTP DataCore 客户端（生产同一份代码路径，非 mock）」）。
 *   本文件是它的反向：DataCore → AgentCore。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import {
  resolveProposalToLevers,
  type FrozenProposal,
  type ProposalMenu,
} from "@platform/contracts";
import { generateAndFreeze, httpProposerClient, type FreezeDeps } from "../src/sim/agent-proposal.js";
// 跨包导入：真 AgentCore 服务器（生产同一份路由代码，非 mock）。
import { createTestApp, type TestApp } from "../../agentcore/test/helpers.js";
import { toolUse } from "../../agentcore/src/llm/mock.js";
import type { AgentDefinition } from "@platform/contracts";

const SERVICE_TOKEN = "xservice-seam-token";
const TENANT = "demo";

/** 一份**形状真实**的菜单：三根杠杆各 3 档，数值全部当作「装配器已经算好的」。 */
function menuFixture(): ProposalMenu {
  return {
    family: "cross_object_occupancy",
    objectives: [
      { key: "revenue", label: "营收", dir: "max" },
      { key: "cost", label: "成本", dir: "min" },
    ],
    levers: [
      { key: "lines.a.capacity", label: "A 线产能", values: [100, 200, 300], note: "三档" },
      { key: "lines.b.capacity", label: "B 线产能", values: [10, 20, 30], note: "三档" },
    ],
    worldDigest: {
      events: [{ kind: "material_delay", target: "Material.LiCO3.leadTime", magnitude: 15 }],
      baselineMetrics: { revenue: 1000, cost: 500 },
      counts: { Order: 500 },
    },
  };
}

function agentDef(): AgentDefinition {
  return {
    id: "agt_proposer",
    key: "proposer",
    tenantId: TENANT,
    version: 1,
    name: "proposer",
    description: "接缝测试用提案 agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是提案 agent。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
  } as AgentDefinition;
}

/** A 侧定版依赖的内存实现（**不是**替身：与生产同一份 `generateAndFreeze` 在跑）。 */
function freezeDeps(): FreezeDeps & { store: Map<string, FrozenProposal> } {
  const store = new Map<string, FrozenProposal>();
  let n = 0;
  return {
    store,
    countProposals: async () => store.size,
    findProposalByFingerprint: async (_t, _s, fp) => [...store.values()].find((p) => p.inputFingerprint === fp) ?? null,
    putProposal: async (p) => { store.set(p.proposalId, p); },
    newId: (prefix) => `${prefix}_${++n}`,
    now: () => "2026-01-01T00:00:00.000Z",
  };
}

describe("WO-AGENT-INTO-SIM · A↔B 提案接缝（真 HTTP · 真 B 路由 · mock 的只有模型）", () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    t = await createTestApp({ env: { SERVICE_TOKEN } });
    await t.repos.agents.insert(agentDef());
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = t.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => { await t.app.close(); });

  /** 让 mock 模型回一份**合法**提案（只有下标与文字，与红线一致）。 */
  function scriptValidDraft(): void {
    t.llm.agentTurns = [
      {
        content: [
          toolUse("final_answer", {
            options: [
              { name: "守成", rationale: "两根杠杆都压最低档，代价最小。", picks: [{ leverIndex: 0, valueIndex: 0 }, { leverIndex: 1, valueIndex: 0 }] },
              { name: "强攻", rationale: "两根杠杆都拉最高档，见效最快。", picks: [{ leverIndex: 0, valueIndex: 2 }, { leverIndex: 1, valueIndex: 2 }] },
            ],
            comparisonNote: "守成省代价、强攻见效快。",
          }),
        ],
      },
    ];
  }

  it("① 金丝雀先证这条线本身是活的：带对 SERVICE_TOKEN 打真 B 路由 ⇒ 不是 401/404", async () => {
    const res = await fetch(`${baseUrl}/b/v1/sim/propose-candidates`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ menu: menuFixture(), agentId: "agt_proposer", tenantId: TENANT }),
    });
    // 金丝雀的作用：若这里是 404，下面每个「降级了」的断言都会**因为路径写错**而假绿。
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(401);
  });

  it("②【接缝主判据】A 发起 → B 真回提案 → A 兑现成杠杆：agentInvolved 必须为 true", async () => {
    scriptValidDraft();
    const menu = menuFixture();
    const client = httpProposerClient(baseUrl, SERVICE_TOKEN);
    const { proposal } = await generateAndFreeze(freezeDeps(), client, {
      tenantId: TENANT, sessionId: "sims_seam", menu, agentId: "agt_proposer", userId: "admin", roles: ["admin"],
    });

    // 这一条就是「线接上了」的全部证据：任何一端改名 ⇒ 这里退回 false，测试当场红。
    expect(proposal.provenance.agentInvolved).toBe(true);
    expect(proposal.provenance.fallbackReason).toBeNull();
    expect(proposal.provenance.agentId).toBe("agt_proposer");
    expect(proposal.draft.options.map((o) => o.name)).toEqual(["守成", "强攻"]);

    // 兑现：数值**只能**来自菜单（agent 一个数都没产）。
    const grids = resolveProposalToLevers(menu, proposal.draft);
    const byKey = Object.fromEntries(grids.map((g) => [g.key, g.values]));
    expect(byKey["lines.a.capacity"]).toEqual([100, 300]);
    expect(byKey["lines.b.capacity"]).toEqual([10, 30]);
  }, 30_000);

  it("③ 鉴权是真的：token 不对 ⇒ B 拒收 ⇒ A 诚实降级（不是静默当成功）", async () => {
    scriptValidDraft();
    const client = httpProposerClient(baseUrl, "wrong-token");
    const { proposal } = await generateAndFreeze(freezeDeps(), client, {
      tenantId: TENANT, sessionId: "sims_badtoken", menu: menuFixture(), agentId: "agt_proposer",
    });
    expect(proposal.provenance.agentInvolved).toBe(false);
    expect(proposal.provenance.fallbackReason).toMatch(/agentcore|401|403/i);
    // 降级不是丢东西：仍然给得出确定性兜底方案，屏上不会空着。
    expect(proposal.draft.options.length).toBeGreaterThan(0);
  }, 30_000);

  it("④ 越界下标：拒收于**定版之前**，且落盘的那一份不带 agent 署名（本单实测缺陷的回归守卫）", async () => {
    // 让模型回一个菜单上不存在的档位（第 0 根杠杆只有 3 档，这里挑第 9 档）。
    t.llm.agentTurns = [
      { content: [toolUse("final_answer", { options: [{ name: "越界", rationale: "故意越界。", picks: [{ leverIndex: 0, valueIndex: 9 }] }], comparisonNote: "" })] },
    ];
    const menu = menuFixture();
    const deps = freezeDeps();
    const { proposal } = await generateAndFreeze(deps, httpProposerClient(baseUrl, SERVICE_TOKEN), {
      tenantId: TENANT, sessionId: "sims_oob", menu, agentId: "agt_proposer",
    });

    // 修前：越界 draft 被定版落盘 → 兑现层抛 → 路由 500，且因指纹复用**该会话永远 500**。
    expect(proposal.provenance.agentInvolved).toBe(false);
    expect(proposal.provenance.fallbackReason).toMatch(/越界|兑现不出/);
    // 落盘的那一份必须是**兑现得出来的**（这是「永远 500」不再可能的机器判据）。
    expect(() => resolveProposalToLevers(menu, proposal.draft)).not.toThrow();

    // ⚠ 同时确认红线**没有被放松**：兑现层对越界 draft 依旧抛，不夹档、不跳过。
    expect(() => resolveProposalToLevers(menu, { options: [{ name: "越界", rationale: "x", picks: [{ leverIndex: 0, valueIndex: 9 }] }], comparisonNote: "" }))
      .toThrow(/不存在的档位下标/);
  }, 30_000);
});
