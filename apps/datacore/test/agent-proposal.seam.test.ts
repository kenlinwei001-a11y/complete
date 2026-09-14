/**
 * WO-AGENT-IN-LOOP 接缝门 —— 「**agent 出方案 / 求解器出数**」的驱动测试。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：菜单装配（A 侧读本体真值）· agent 提案（B 侧）·
 * 定版落盘（仓储）· 兑现成杠杆网格（契约包纯函数）是四半，任一半漂了本文件就红：
 *  · agent 的产出 schema 里长出一个能装业务数值的格 ⇒ §1 红（**本单最要紧的一条**）；
 *  · 兑现处开始夹逼越界下标而不是抛 ⇒ §2 红（幻觉下标会拿到一个合法的数）；
 *  · 同一提案版本重跑解出不同网格 ⇒ §3 红（确定性 R6 当场破）；
 *  · 换事件而指纹不变 ⇒ §4 红（提案没读世界态，只是换了张固定表）；
 *  · 兜底路径把 `agentInvolved` 留白或写成 true ⇒ §5 红（诚实位）。
 *
 * ⚠ 断言全部是**对照实验**式（铁律 1.5 判据一）：不是「跑得起来吗」，
 *   是「把 X 改成 X'，Y 必须按可预言的方式变」—— §3/§4 各带一条**反向**断言
 *   （该变的变了，**不该变的一个字节都不许变**）。
 *
 * ⚠ 本仓铁律：**测试里 LLM 一律 mock**。本文件用脚本化 `ProposerClient` 替身，
 *   零网络、零模型 —— 真调模型只在手工取证时做（见交单报告）。
 */
import { describe, expect, it } from "vitest";
import {
  AgentProposalDraftSchema,
  ProposalPickSchema,
  ProposalResolveError,
  mapOptionsToSolutions,
  resolveOptionLevers,
  resolveProposalToLevers,
  type AgentProposalDraft,
  type FrozenProposal,
  type ProposalMenu,
} from "@platform/contracts";
import {
  buildProposalMenu,
  deterministicFallbackDraft,
  fingerprintMenu,
  generateAndFreeze,
  noAgentProvenance,
  type ProposerClient,
} from "../src/sim/agent-proposal.js";
import { paretoSolutionId } from "../src/solvers/opt-pareto.js";

// ══ 夹具 ═══════════════════════════════════════════════════════════════════
// 菜单里的数值（0.8/1.0/1.2 与 100/200）**扮演的是「装配器从本体真值算出来的档位」**。
// 本文件全程不新造业务数值 —— 与生产同一条纪律。
const MENU: ProposalMenu = {
  family: "cross_object_occupancy",
  args: { currencyAligned: true },
  objectives: [
    { key: "revenue", dir: "max", label: "营收" },
    { key: "cost", dir: "min", label: "成本" },
  ],
  levers: [
    { key: "lines.L1.capacity", label: "L1 产能", values: [0.8, 1.0, 1.2] },
    { key: "lines.L2.capacity", label: "L2 产能", values: [100, 200] },
  ],
  worldDigest: {
    events: [{ kind: "material_delay", target: "Material.LiCO3.leadTime", magnitude: 15 }],
    baselineMetrics: { revenue: 601.5, cost: 118.85 },
    counts: { Order: 500, Line: 2 },
  },
};

const DRAFT: AgentProposalDraft = AgentProposalDraftSchema.parse({
  options: [
    { name: "保交付", rationale: "物料延期打在 L1 上，先把 L1 拉满保住在手订单。", picks: [{ leverIndex: 0, valueIndex: 2 }, { leverIndex: 1, valueIndex: 0 }] },
    { name: "控成本", rationale: "延期期间压低占线，牺牲部分获排换成本。", picks: [{ leverIndex: 0, valueIndex: 0 }, { leverIndex: 1, valueIndex: 1 }] },
  ],
  comparisonNote: "保交付吃成本换营收；控成本反之。",
});

function memDeps() {
  const store = new Map<string, FrozenProposal>();
  let n = 0;
  return {
    store,
    deps: {
      countProposals: async (t: string, sid: string) => [...store.values()].filter((p) => p.tenantId === t && p.sessionId === sid).length,
      findProposalByFingerprint: async (t: string, sid: string, fp: string) =>
        [...store.values()].filter((p) => p.tenantId === t && p.sessionId === sid && p.inputFingerprint === fp).sort((a, b) => b.version - a.version)[0] ?? null,
      putProposal: async (p: FrozenProposal) => void store.set(p.proposalId, p),
      newId: (prefix: string) => `${prefix}_${++n}`,
      now: () => "2026-09-08T00:00:00.000Z",
    },
  };
}

const scriptedClient = (draft: unknown, route = "EXTERNAL"): ProposerClient => ({
  propose: async () => ({
    draft,
    provenance: { agentInvolved: true, route, provider: "dcp", model: "dcp:p1:m1", agentId: "agt_x", elapsedMs: 12, fallbackReason: null },
  }),
});

// ══ §1 · 红线：agent 的产出里**没有任何能装业务数值的格** ═══════════════════════
//
// 这一节是本单的心脏。仓主原话：「**agent 产出里出现任何它自己算的数 = 红**」。
// 判据不是「提示词里写了不许算」，是「schema 里根本没那个格」——前者只降低概率，后者是零概率。
describe("§1 · agent 产出零数值格（结构性红线）", () => {
  it("§1a 金丝雀先证扫法有效：ProposalPickSchema 确实只认两个整数下标", () => {
    // 金丝雀：一个**已知必中**的样例 —— 合法下标必须过。它若不过，是本节的读法坏了，
    // 那么下面所有「拒绝」断言都不构成证据（铁律 0.6：报否定结论前先自证工具）。
    expect(ProposalPickSchema.safeParse({ leverIndex: 0, valueIndex: 1 }).success).toBe(true);
  });

  it("§1b 塞一个业务数值进 pick ⇒ 必须被拒（strictObject 不许多余键）", () => {
    // 这正是「agent 自己算了一个数」的形态：它想把 0.87 直接写进来。
    const r = ProposalPickSchema.safeParse({ leverIndex: 0, valueIndex: 1, value: 0.87 });
    expect(r.success).toBe(false);
  });

  it("§1c 方案里塞 metrics / 预测读数 ⇒ 必须被拒", () => {
    const r = AgentProposalDraftSchema.safeParse({
      options: [{ name: "X", rationale: "y", picks: [{ leverIndex: 0, valueIndex: 0 }], metrics: { revenue: 999 } }],
      comparisonNote: "",
    });
    expect(r.success).toBe(false);
  });

  it("§1d 变异反证：draft 全文的数值只出现在下标位，且下标**不承载量纲**", () => {
    // 反证法：把菜单换成完全不同的一组数值，**同一份 draft** 解出来的数必须整体跟着变。
    // 若 draft 里藏了任何自带数值的格，这个断言会失败 —— 因为那个数不会跟着菜单变。
    const other: ProposalMenu = { ...MENU, levers: [{ ...MENU.levers[0]!, values: [7, 8, 9] }, { ...MENU.levers[1]!, values: [70, 80] }] };
    const a = resolveProposalToLevers(MENU, DRAFT);
    const b = resolveProposalToLevers(other, DRAFT);
    expect(a).not.toEqual(b);
    // 且解出来的每一个数都必须**来自菜单**（不是 draft）：
    for (const g of b) {
      const src = other.levers.find((l) => l.key === g.key)!;
      for (const v of g.values) expect(src.values).toContain(v);
    }
  });
});

// ══ §2 · 兑现处 fail-closed（幻觉下标不许拿到合法的数）═══════════════════════════
describe("§2 · 越界下标一律抛，不夹逼", () => {
  it("§2a 杠杆下标越界 ⇒ ProposalResolveError", () => {
    const bad = AgentProposalDraftSchema.parse({ options: [{ name: "幻觉", rationale: "r", picks: [{ leverIndex: 9, valueIndex: 0 }] }], comparisonNote: "" });
    expect(() => resolveProposalToLevers(MENU, bad)).toThrow(ProposalResolveError);
  });
  it("§2b 档位下标越界 ⇒ ProposalResolveError（**不夹到末档**）", () => {
    const bad = AgentProposalDraftSchema.parse({ options: [{ name: "幻觉", rationale: "r", picks: [{ leverIndex: 0, valueIndex: 99 }] }], comparisonNote: "" });
    expect(() => resolveProposalToLevers(MENU, bad)).toThrow(ProposalResolveError);
  });
  it("§2c 同一方案对同一根杠杆挑两档 ⇒ 抛（否则一个方案对应一片解，方案比对说不清）", () => {
    const bad = AgentProposalDraftSchema.parse({
      options: [{ name: "双档", rationale: "r", picks: [{ leverIndex: 0, valueIndex: 0 }, { leverIndex: 0, valueIndex: 1 }] }],
      comparisonNote: "",
    });
    expect(() => resolveProposalToLevers(MENU, bad)).toThrow(ProposalResolveError);
  });
});

// ══ §3 · 确定性 R6（本单要害）═════════════════════════════════════════════════
describe("§3 · 同一提案版本重跑逐字节一致", () => {
  it("§3a 同一 (菜单, 定版) 解两次 ⇒ JSON 逐字节相同", () => {
    const a = JSON.stringify(resolveProposalToLevers(MENU, DRAFT));
    const b = JSON.stringify(resolveProposalToLevers(MENU, DRAFT));
    expect(a).toBe(b);
  });
  it("§3b 方案书写顺序/档位顺序不影响结果（网格已规范化）", () => {
    const shuffled = AgentProposalDraftSchema.parse({ options: [...DRAFT.options].reverse(), comparisonNote: DRAFT.comparisonNote });
    expect(JSON.stringify(resolveProposalToLevers(MENU, shuffled))).toBe(JSON.stringify(resolveProposalToLevers(MENU, DRAFT)));
  });
  it("§3c 指纹命中 ⇒ **复用同一版，不再调模型**（第 2 格对照实验的机制）", async () => {
    const { deps, store } = memDeps();
    let calls = 0;
    const client: ProposerClient = {
      propose: async () => {
        calls++;
        return { draft: DRAFT, provenance: { agentInvolved: true, route: "EXTERNAL", provider: "dcp", model: "m", agentId: "a", elapsedMs: 1, fallbackReason: null } };
      },
    };
    const first = await generateAndFreeze(deps, client, { tenantId: "t1", sessionId: "s1", menu: MENU, agentId: "a" });
    const second = await generateAndFreeze(deps, client, { tenantId: "t1", sessionId: "s1", menu: MENU, agentId: "a" });
    expect(calls).toBe(1); // ← 第二次**没有**再调 agent
    expect(second.reused).toBe(true);
    expect(second.proposal.proposalId).toBe(first.proposal.proposalId);
    expect(store.size).toBe(1);
  });
});

// ══ §4 · 提案必须真的随事件变（否则只是换了张固定表）═══════════════════════════
describe("§4 · 换事件 ⇒ 指纹变；不换 ⇒ 一个字节都不许变", () => {
  it("§4a 换一个**不同类型**的扰动 ⇒ inputFingerprint 必须变", () => {
    const delay = fingerprintMenu(MENU);
    const cancel: ProposalMenu = {
      ...MENU,
      worldDigest: { ...MENU.worldDigest, events: [{ kind: "order_cancel", target: "Order.O-1.qty", magnitude: -300 }] },
    };
    expect(fingerprintMenu(cancel)).not.toBe(delay);
  });
  it("§4b 反向对照：世界态一个字节没动 ⇒ 指纹必须逐字相同", () => {
    expect(fingerprintMenu(structuredClone(MENU))).toBe(fingerprintMenu(MENU));
  });
  it("§4c 指纹变 ⇒ 会真的去要一份新提案（不是拿旧的套新世界）", async () => {
    const { deps } = memDeps();
    let calls = 0;
    const client: ProposerClient = {
      propose: async () => {
        calls++;
        return { draft: DRAFT, provenance: { agentInvolved: true, route: "NATIVE", provider: "p", model: "m", agentId: "a", elapsedMs: 1, fallbackReason: null } };
      },
    };
    await generateAndFreeze(deps, client, { tenantId: "t1", sessionId: "s1", menu: MENU, agentId: "a" });
    const other: ProposalMenu = { ...MENU, worldDigest: { ...MENU.worldDigest, events: [{ kind: "order_cancel", target: "Order.O-1.qty", magnitude: -300 }] } };
    const second = await generateAndFreeze(deps, client, { tenantId: "t1", sessionId: "s1", menu: other, agentId: "a" });
    expect(calls).toBe(2);
    expect(second.reused).toBe(false);
    expect(second.proposal.version).toBe(2); // 定版号自增，旧版仍在（可回放）
  });
});

// ══ §5 · 诚实位：未调用 agent 必须明写，不许留白 ═══════════════════════════════
describe("§5 · agentInvolved 不许留白", () => {
  it("§5a 无 A→B 通路 ⇒ agentInvolved:false + route:NONE + 写清原因", async () => {
    const { deps } = memDeps();
    const r = await generateAndFreeze(deps, null, { tenantId: "t1", sessionId: "s1", menu: MENU, agentId: "a" });
    expect(r.proposal.provenance.agentInvolved).toBe(false);
    expect(r.proposal.provenance.route).toBe("NONE");
    expect(r.proposal.provenance.fallbackReason).toBeTruthy(); // ← 留白即红
    expect(r.proposal.draft.options.length).toBeGreaterThan(0); // 兜底仍给可比方案
  });
  it("§5b agent 产出不合契约 ⇒ **拒收**并降级，绝不把它写进定版", async () => {
    const { deps } = memDeps();
    // 这一份 draft 里塞了自带数值的 `value` —— 正是「agent 自己算了个数」的形态。
    const r = await generateAndFreeze(deps, scriptedClient({ options: [{ name: "X", rationale: "y", picks: [{ leverIndex: 0, valueIndex: 0, value: 0.87 }] }] }), {
      tenantId: "t1", sessionId: "s1", menu: MENU, agentId: "a",
    });
    expect(r.proposal.provenance.agentInvolved).toBe(false);
    expect(r.proposal.provenance.fallbackReason).toContain("提案");
    // 且落盘的那一份**不含**那个编出来的数：
    expect(JSON.stringify(r.proposal.draft)).not.toContain("0.87");
  });
  it("§5c 走 dsh ⇒ route 如实回 EXTERNAL（走内置回 NATIVE）", async () => {
    const { deps } = memDeps();
    const ext = await generateAndFreeze(deps, scriptedClient(DRAFT, "EXTERNAL"), { tenantId: "t1", sessionId: "sE", menu: MENU, agentId: "a" });
    expect(ext.proposal.provenance).toMatchObject({ agentInvolved: true, route: "EXTERNAL" });
    const nat = await generateAndFreeze(deps, scriptedClient(DRAFT, "NATIVE"), { tenantId: "t1", sessionId: "sN", menu: MENU, agentId: "a" });
    expect(nat.proposal.provenance).toMatchObject({ agentInvolved: true, route: "NATIVE" });
  });
  it("§5d 兜底提案自己也不造数（档位全部来自菜单）", () => {
    const fb = deterministicFallbackDraft(MENU);
    for (const g of resolveProposalToLevers(MENU, fb)) {
      const src = MENU.levers.find((l) => l.key === g.key)!;
      for (const v of g.values) expect(src.values).toContain(v);
    }
    expect(noAgentProvenance("x").agentInvolved).toBe(false);
  });
});

// ══ §6 · 方案 → 解 id 必须与求解器同源（屏上「方案 A 是哪个点」有确定答案）═══════
describe("§6 · 方案与解的对照", () => {
  it("§6a 每个方案解出的 id 与 paretoSolutionId 逐字一致", () => {
    const mapped = mapOptionsToSolutions(MENU, DRAFT, paretoSolutionId);
    expect(mapped).toHaveLength(2);
    for (const m of mapped) expect(m.solutionId).toBe(paretoSolutionId(m.levers));
  });
  it("§6b 每个方案的解都**在**兑现出来的网格里（不会算了一批却漏掉方案本身）", () => {
    const grid = resolveProposalToLevers(MENU, DRAFT);
    for (const o of DRAFT.options) {
      for (const lv of resolveOptionLevers(MENU, o)) {
        expect(grid.find((g) => g.key === lv.key)!.values).toContain(lv.value);
      }
    }
  });
  it("§6c 菜单装配：装配不出 ⇒ 返回 null（不兜一份假菜单去请 agent）", () => {
    const none = buildProposalMenu({
      assembled: { applicable: false, missingRoles: ["facility"], note: "n" },
      events: [], baselineMetrics: {}, counts: {},
    });
    expect(none).toBeNull();
  });
});
