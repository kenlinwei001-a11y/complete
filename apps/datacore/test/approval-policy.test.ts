import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROCESS_OWNER_FUNCTION_KEYS, type ApprovalChainResolution } from "@platform/contracts";
import { FEATURE_REGISTRY, GOVERNANCE_DARK_LAUNCH_FEATURES } from "../src/features.js";
import { makeApp, ADMIN, PLANNER, BASE_MANAGER, type TestApp } from "./helpers.js";

/**
 * WO-APPROVAL-POLICY · **批复策略引擎**。
 *
 * 本文件验的**不是**「有没有返回一个数组」，而是工单 §5 那四条效果层判据：
 *  ① 同一个业务事件、**改一个数** → 批复链**真的变**（断言链条内容逐个 authorityKey 指名道姓）；
 *  ② **正交性**：只改 policy → 链变；只改业务流程定义 → 链**逐字节不变**；
 *  ③ **变异反证**：把动态求值退化成「恒返回固定链」，①② 必须**变红**（本文件把它机器化，见 §3）；
 *  ④ **诚实降级**：组织权限缺失时明确报出缺什么，不静默返回空链、不兜底给 gm。
 *
 * ⚠ 全部经**真跑 HTTP 端点**（`app.inject`）断言，不直连服务对象 —— 「绿测试≠能用·断在接缝」的老坑：
 * 直连服务能证明函数对，证明不了路由/entitlement/契约 parse 这三层接缝也对。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

// ══════════════════════════════════════════════════════════════════════════
// 夹具：组织权限（§1 最小面）+ 两条策略（逐条对应工单里仓主给的 YAML）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 权限位登记。`level` 是**组织层级**，不是装饰排序键 —— 合并口径按它逐级上报（契约 §5）。
 * `roleKey` 挑的是 demo 种子里**真实存在**的角色（`seed.ts` 的 admin/planner/approver），
 * 否则每一条都会撞上 `NO_ELIGIBLE_APPROVER` —— 那样测的就不是链条内容而是降级路径了。
 */
const AUTHORITIES = [
  { key: "planning_director", displayName: "计划总监", functionKey: "production_planning", roleKey: "planner", level: 20 },
  { key: "finance_director", displayName: "财务总监", functionKey: "finance", roleKey: "admin", level: 20 },
  { key: "manufacturing_director", displayName: "制造总监", functionKey: "manufacturing", roleKey: "admin", level: 25 },
  { key: "sales_director", displayName: "销售总监", functionKey: "sales", roleKey: "planner", level: 25 },
  { key: "gm", displayName: "经营负责人", functionKey: "strategy_office", roleKey: "admin", level: 40 },
];

/**
 * 工单原文的两条 YAML：
 *   condition: capacity_gap > 10%   → [planning_director, manufacturing_director, gm]
 *   condition: gross_margin < 0.08  → [finance_director, sales_director, gm]
 *
 * 阈值走**命名阈值** `params.<名>`（复用 `ruledsl.ts` 的一等 param 操作数），不把 0.10 写进表达式：
 * 这样「改一个数」是改**数据**，而不是改表达式 —— 判据②「只改 policy」才有干净的改法。
 */
const POLICY_CAPACITY = {
  name: "产能缺口越线批复",
  condition: "capacity_gap > params.gapThreshold",
  params: { gapThreshold: 0.1 },
  approval: ["planning_director", "manufacturing_director", "gm"],
  subjectKinds: [] as string[],
  priority: 10,
  status: "PUBLISHED" as const,
};
const POLICY_MARGIN = {
  name: "毛利过低批复",
  condition: "gross_margin < params.marginFloor",
  params: { marginFloor: 0.08 },
  approval: ["finance_director", "sales_director", "gm"],
  subjectKinds: [] as string[],
  priority: 20,
  status: "PUBLISHED" as const,
};

/** 业务侧发出的东西**只有**这三样：主体 + 事实。没有 chain 字段可填（正交性靠形状保证）。 */
const request = (facts: Record<string, unknown>) => ({
  subjectKind: "process",
  subjectKey: "P40", // 详细排产 APS —— 一个真实存在的业务流程 key
  facts,
});

async function setup(opts?: { authorities?: typeof AUTHORITIES; policies?: boolean }): Promise<TestApp> {
  const t = await makeApp();
  // 暗发门默认关（GOVERNANCE_DARK_LAUNCH_FEATURES）—— 必须显式 override 才打开。
  const put = await t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "approval.policy-engine": true } },
  });
  expect(put.statusCode, put.body).toBe(200);
  for (const a of opts?.authorities ?? AUTHORITIES) {
    const res = await t.app.inject({
      method: "PUT",
      url: `/a/v1/approval-authorities/${a.key}`,
      headers: ADMIN,
      payload: a,
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  if (opts?.policies !== false) {
    for (const [key, p] of [["capacity-gap", POLICY_CAPACITY], ["thin-margin", POLICY_MARGIN]] as const) {
      const res = await t.app.inject({
        method: "PUT",
        url: `/a/v1/approval-policies/${key}`,
        headers: ADMIN,
        payload: p,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  }
  return t;
}

/** 真跑 `/resolve`，返回链条的 authorityKey 序列（判据要求"指名道姓"，所以断言的就是这个序列）。 */
async function resolve(t: TestApp, facts: Record<string, unknown>): Promise<ApprovalChainResolution> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/approvals/resolve",
    headers: ADMIN,
    payload: request(facts),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ApprovalChainResolution;
}
const chainOf = (r: ApprovalChainResolution): string[] => r.chain.map((s) => s.authorityKey);

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 金丝雀 —— 报否定结论前先自证工具（铁律 0.6 的机制）
// ══════════════════════════════════════════════════════════════════════════

describe("§0 金丝雀：先证明这套夹具真的在动", () => {
  it("已知必中：策略注册后 /resolve 至少能报出两条策略的痕迹", async () => {
    const t = await setup();
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });
    // 金丝雀不中（trace 为空）⇒ 报「夹具坏了」，不许把下面任何一条"链条为空"读成"引擎没命中"。
    expect(r.trace.map((x) => x.policyKey).sort()).toEqual(["capacity-gap", "thin-margin"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 判据① —— 同一个业务事件，改一个数 → 批复链真的变
// ══════════════════════════════════════════════════════════════════════════

describe("§1 判据①：同一业务事件、改一个数 → 链条内容不同", () => {
  it("产能缺口 8% → 无需批复；12% → 计划总监→制造总监→经营负责人", async () => {
    const t = await setup();
    // 主体、事实字段、策略、组织数据**全都没动**，只有 capacity_gap 这一个数从 0.08 变 0.12。
    const under = await resolve(t, { capacity_gap: 0.08, gross_margin: 0.15 });
    const over = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });

    expect(under.required).toBe(false);
    expect(chainOf(under)).toEqual([]); // 零命中 = 正常结论（不是降级）
    expect(under.degraded).toBe(false);

    expect(over.required).toBe(true);
    expect(chainOf(over)).toEqual(["planning_director", "manufacturing_director", "gm"]);
    expect(over.matchedPolicyKeys).toEqual(["capacity-gap"]);
  });

  it("同一事件换另一个数（毛利 7.2%）→ 换成**另一条链**（销售/财务口，不是产能口）", async () => {
    const t = await setup();
    const capacityHit = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });
    const marginHit = await resolve(t, { capacity_gap: 0.08, gross_margin: 0.072 });

    expect(chainOf(marginHit)).toEqual(["finance_director", "sales_director", "gm"]);
    // 头号断言：两条链**内容不同**，且不同在"谁签"上 —— 不是长度不同、也不是顺序不同。
    expect(chainOf(marginHit)).not.toEqual(chainOf(capacityHit));
    expect(new Set(chainOf(marginHit))).not.toEqual(new Set(chainOf(capacityHit)));
    expect(chainOf(marginHit)).not.toContain("planning_director");
    expect(chainOf(capacityHit)).not.toContain("finance_director");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 判据② —— 正交性（本单的灵魂）
// ══════════════════════════════════════════════════════════════════════════

describe("§2 判据②：批复流程 ⟂ 业务流程", () => {
  it("不改任何业务流程定义，只改 policy 的一个阈值 → 批复链变", async () => {
    const t = await setup();
    const before = await resolve(t, { capacity_gap: 0.09, gross_margin: 0.15 });
    expect(chainOf(before)).toEqual([]); // 9% < 10% 阈值 ⇒ 不需批复

    // 只动 policy 的一个数（10% → 5%），业务流程定义一个字节都没碰。
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/approval-policies/capacity-gap",
      headers: ADMIN,
      payload: { ...POLICY_CAPACITY, params: { gapThreshold: 0.05 } },
    });
    expect(put.statusCode, put.body).toBe(200);

    const after = await resolve(t, { capacity_gap: 0.09, gross_margin: 0.15 });
    expect(chainOf(after)).toEqual(["planning_director", "manufacturing_director", "gm"]);
    expect(chainOf(after)).not.toEqual(chainOf(before));
  });

  it("反向：只改业务流程定义（名字/职能/工期）→ 批复链**逐字节不变**", async () => {
    const t = await setup();
    const facts = { capacity_gap: 0.12, gross_margin: 0.072 };
    const before = await resolve(t, facts);

    // 直接改业务流程层的数据（这是"业务流程"在本平台的载体：`ProcessDefinition`）。
    // 把它改得面目全非：换名、换责任职能、换工期、换等待类型、换承载物。
    await t.repos.processDefinitions.put({
      id: "pdef_demo_P40",
      tenantId: "demo",
      key: "P40",
      domainKey: "D07",
      name: "详细排产（本测试故意改名以证明批复链不随它变）",
      ownerFunctionKey: "manufacturing", // 原 production_planning
      stdDurationDays: 99,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierTypeKey: "ProductionSchedule",
    });
    // 再加一条全新的业务流程 —— 业务流程层的内容变了，批复策略层没变。
    await t.repos.processDefinitions.put({
      id: "pdef_demo_P99",
      tenantId: "demo",
      key: "P99",
      domainKey: "D07",
      name: "本测试新增的业务流程",
      ownerFunctionKey: "finance",
      stdDurationDays: 1,
      waitKind: "WAITING_USER",
      carrierTypeKey: "ProductionSchedule",
    });

    const after = await resolve(t, facts);
    // 逐字节不变 —— 连 trace/溯源都不许变。业务流程层对批复链**没有任何输入**。
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("形状即纪律：业务侧无从指定批复链（ApprovalRequest 里塞 chain 会被 strictObject 拒）", async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/approvals/resolve",
      headers: ADMIN,
      payload: { ...request({ capacity_gap: 0.12 }), chain: ["gm"] },
    });
    // 想把链条写死在业务调用里 —— 契约层直接拒（400），不是"忽略该字段"。
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error.code");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 判据③ —— 变异反证（机器化，不是"我手动试过"）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把 §1/§2 那两条判据抽成一个**只依赖 resolver 的断言体**，然后拿两个 resolver 各跑一遍：
 *  · 真引擎   ⇒ 必须过；
 *  · 退化实现（恒返回固定链）⇒ 必须**抛**。
 *
 * 为什么要这么写而不是「我把代码改坏跑了一次看到红」：那种做法下次改动时没人会重跑。
 * 铁律 0.6 的判据原文——「机制的判据：下次同样的错发生时，**是机器先说话**，不是人先想起来」。
 */
type Resolver = (facts: Record<string, unknown>) => Promise<string[]>;

async function assertChainIsDynamic(resolveChain: Resolver): Promise<void> {
  const low = await resolveChain({ capacity_gap: 0.08, gross_margin: 0.15 });
  const highCapacity = await resolveChain({ capacity_gap: 0.12, gross_margin: 0.15 });
  const lowMargin = await resolveChain({ capacity_gap: 0.08, gross_margin: 0.072 });
  // ① 改一个数 → 链变
  expect(highCapacity).not.toEqual(low);
  // ① 换另一个数 → 换**另一条**链（不是同一条链的长短变化）
  expect(lowMargin).not.toEqual(highCapacity);
  expect(lowMargin).not.toEqual(low);
  // 指名道姓：内容必须真的对上
  expect(highCapacity).toEqual(["planning_director", "manufacturing_director", "gm"]);
  expect(lowMargin).toEqual(["finance_director", "sales_director", "gm"]);
}

describe("§3 判据③：变异反证 —— 退化成恒定链必须变红", () => {
  it("真引擎：动态判据全部通过", async () => {
    const t = await setup();
    await assertChainIsDynamic(async (facts) => chainOf(await resolve(t, facts)));
  });

  it("退化实现（恒返回写死的链）：同一组判据必须抛 —— 还绿就说明测的不是这件事", async () => {
    // 这就是「把批复链做成写死的 Workflow」那个反面实现：不看事实，永远这一条。
    const FIXED = ["planning_director", "manufacturing_director", "gm"];
    const degenerate: Resolver = async () => [...FIXED];
    // ⚠ 不能只写 `.rejects.toThrow()` —— 那样任何原因的抛出都算过（连夹具自己坏了都算），
    //    这正是「拿一个看着相关的信号当判据」的老形态。必须咬住**是哪一条断言**红的。
    await expect(assertChainIsDynamic(degenerate)).rejects.toThrow(
      /not.*deeply equal|to not deeply equal|toEqual/i,
    );
    // 更硬的一刀：退化实现下，「高产能缺口」与「低产能缺口」返回的链**一模一样** ——
    // 这就是判据①要否定的那件事本身。
    expect(await degenerate({ capacity_gap: 0.08 })).toEqual(await degenerate({ capacity_gap: 0.12 }));
  });

  it("退化实现之二（只看主体不看事实·「按业务节点写死」的经典形态）：同样必须抛", async () => {
    const bySubjectOnly: Resolver = async () => ["gm"]; // 一律上经营负责人（"兜底给 gm"的那种做法）
    await expect(assertChainIsDynamic(bySubjectOnly)).rejects.toThrow();
    expect(await bySubjectOnly({ gross_margin: 0.072 })).toEqual(await bySubjectOnly({ gross_margin: 0.9 }));
  });

  it("正交性判据同样受变异反证保护：链随业务流程变的实现必须抛", async () => {
    const t = await setup();
    // 一个「把批复链嵌进业务流程定义」的伪实现：读 ProcessDefinition.ownerFunctionKey 拼链。
    const coupled: Resolver = async (facts) => {
      const def = (await t.repos.processDefinitions.list("demo", (d) => d.key === "P40"))[0];
      const base = await resolve(t, facts);
      return def ? [...chainOf(base), `owner:${def.ownerFunctionKey}`] : chainOf(base);
    };
    await t.repos.processDefinitions.put({
      id: "pdef_demo_P40", tenantId: "demo", key: "P40", domainKey: "D07", name: "详细排产",
      ownerFunctionKey: "production_planning", stdDurationDays: 3, waitKind: "WAITING_DATA",
      carrierTypeKey: "ProductionSchedule",
    });
    const before = await coupled({ capacity_gap: 0.12, gross_margin: 0.15 });
    await t.repos.processDefinitions.put({
      id: "pdef_demo_P40", tenantId: "demo", key: "P40", domainKey: "D07", name: "详细排产",
      ownerFunctionKey: "manufacturing", stdDurationDays: 3, waitKind: "WAITING_DATA",
      carrierTypeKey: "ProductionSchedule",
    });
    const after = await coupled({ capacity_gap: 0.12, gross_margin: 0.15 });
    // 耦合实现下「只改业务流程 → 链不变」这条判据会红 —— 证明 §2 那条断言咬得住。
    expect(after).not.toEqual(before);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 判据④ —— 诚实降级
// ══════════════════════════════════════════════════════════════════════════

describe("§4 判据④：组织权限缺失 → 明确报出缺什么，不静默、不兜底", () => {
  it("权限位未登记 → AUTHORITY_UNDEFINED，链不静默补齐、不兜底给 gm", async () => {
    // 只登记 3 个权限位，故意漏掉 manufacturing_director 与 gm。
    const t = await setup({ authorities: AUTHORITIES.filter((a) => a.key === "planning_director" || a.key === "finance_director" || a.key === "sales_director") });
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });

    expect(r.degraded).toBe(true);
    expect(r.missing.map((m) => `${m.authorityKey}:${m.reason}`)).toEqual([
      "gm:AUTHORITY_UNDEFINED",
      "manufacturing_director:AUTHORITY_UNDEFINED",
    ]);
    // 缺什么必须说清楚：是哪条策略要的、该怎么修。
    expect(r.missing[0]?.viaPolicyKeys).toEqual(["capacity-gap"]);
    expect(r.missing[0]?.detail).toContain("未在本租户 ApprovalAuthority 登记");
    // 反面：不许静默返回空链（那会被读成「不需要批复」），也不许兜底给 gm。
    expect(chainOf(r)).toEqual(["planning_director"]);
    expect(r.required).toBe(true);
  });

  it("权限位登记了但**没人**持有那个角色 → NO_ELIGIBLE_APPROVER（与上一种分开报，修法不同）", async () => {
    const t = await setup({
      authorities: AUTHORITIES.map((a) =>
        a.key === "gm" ? { ...a, roleKey: "board_chair_nobody_holds_this" } : a,
      ),
    });
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });
    expect(r.degraded).toBe(true);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]?.reason).toBe("NO_ELIGIBLE_APPROVER");
    expect(r.missing[0]?.detail).toContain("无人持有该角色");
    // 两种缺法的 detail 必须真的不同 —— 合成一句会让人去改错的地方。
    expect(r.missing[0]?.detail).not.toContain("未在本租户 ApprovalAuthority 登记");
  });

  it("降级态**拒绝开批复实例**（409）—— 缺把关人的链跑起来就是拿它冒充完整的链", async () => {
    const t = await setup({ authorities: AUTHORITIES.filter((a) => a.key !== "gm") });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/approvals",
      headers: ADMIN,
      payload: request({ capacity_gap: 0.12, gross_margin: 0.15 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "INVALID_STATE" } });
    expect((res.json() as { error: { message: string } }).error.message).toContain("gm(AUTHORITY_UNDEFINED)");
  });

  it("策略表达式求值出错 ≠ 未命中：显式报 error 且计入 degraded（不 fail-open 成「通过」）", async () => {
    const t = await setup();
    // 事实里**没有** gross_margin 这个字段 —— `<` 比较遇非数返回 false（未命中，正常）；
    // 但引用未声明阈值会抛 —— 这里造后者：临时塞一条引用了未声明阈值的策略绕过发布校验是做不到的
    //（`assertValidExpression` 会拒），所以直接从仓储写入一条"历史遗留"的坏策略。
    await t.repos.approvalPolicies.put({
      id: "apol_demo_legacy-bad",
      tenantId: "demo",
      key: "legacy-bad",
      name: "历史遗留：引用了未声明的阈值",
      condition: "capacity_gap > params.neverDeclared",
      params: {},
      approval: ["gm"],
      subjectKinds: [],
      priority: 5,
      status: "PUBLISHED",
    });
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });
    const bad = r.trace.find((x) => x.policyKey === "legacy-bad");
    expect(bad?.matched).toBe(false);
    expect(bad?.error).toContain("未在本规则 params 中声明");
    expect(r.degraded).toBe(true); // 完整性此刻是**未知**，不是"完整"
  });

  it("发布期就挡住哑弹策略：condition 引用未声明阈值 → 400（不是运行期才炸）", async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: "PUT",
      url: "/a/v1/approval-policies/dud",
      headers: ADMIN,
      payload: { ...POLICY_CAPACITY, name: "哑弹", condition: "capacity_gap > params.notDeclared" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toContain("未声明的命名阈值");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 合并口径（多条策略同时命中）
// ══════════════════════════════════════════════════════════════════════════

describe("§5 多策略同时命中 → 并集按组织层级合并（UNION_BY_LEVEL）", () => {
  it("两条都命中：并集去重，按 level 逐级上报，gm 只出现一次且溯源记两条", async () => {
    const t = await setup();
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.072 });
    expect(r.matchedPolicyKeys).toEqual(["capacity-gap", "thin-margin"]);
    // 并集 = 一个把关诉求都不丢；排序 = (level, minPriority, 首现序) 三段全序。
    expect(chainOf(r)).toEqual([
      "planning_director", // level 20, priority 10
      "finance_director", //  level 20, priority 20
      "manufacturing_director", // level 25, priority 10
      "sales_director", //    level 25, priority 20
      "gm", //                level 40（两条策略都要，去重成一次）
    ]);
    // 「最严」是并集的**效果**：终审人 = 命中策略中层级最高者。
    expect(r.chain.at(-1)?.authorityKey).toBe("gm");
    expect(r.chain.at(-1)?.level).toBe(40);
    // 去重不许把「谁要求的」一并丢掉。
    expect(r.chain.at(-1)?.viaPolicyKeys).toEqual(["capacity-gap", "thin-margin"]);
    expect(r.chain[0]?.viaPolicyKeys).toEqual(["capacity-gap"]);
  });

  it("合并结果是确定的：同输入连跑三次逐字节一致（R6，不靠 Map 迭代序）", async () => {
    const t = await setup();
    const facts = { capacity_gap: 0.12, gross_margin: 0.072 };
    const a = JSON.stringify(await resolve(t, facts));
    const b = JSON.stringify(await resolve(t, facts));
    const c = JSON.stringify(await resolve(t, facts));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("声明序与组织层级序冲突 → 以 level 为准，但 trace 标 reordered（不静默改写）", async () => {
    const t = await setup();
    // gm(40) 写在最前，与逐级上报冲突。
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/approval-policies/capacity-gap",
      headers: ADMIN,
      payload: { ...POLICY_CAPACITY, approval: ["gm", "planning_director", "manufacturing_director"] },
    });
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.15 });
    expect(chainOf(r)).toEqual(["planning_director", "manufacturing_director", "gm"]);
    expect(r.trace.find((x) => x.policyKey === "capacity-gap")?.reordered).toBe(true);
    // 没冲突的那条不许被误标。
    expect(r.trace.find((x) => x.policyKey === "thin-margin")?.reordered).toBeUndefined();
  });

  it("DRAFT 策略不参与求值；subjectKinds 不匹配也不参与（两种 skip 分开报）", async () => {
    const t = await setup();
    await t.app.inject({
      method: "PUT", url: "/a/v1/approval-policies/thin-margin", headers: ADMIN,
      payload: { ...POLICY_MARGIN, status: "DRAFT" },
    });
    await t.app.inject({
      method: "PUT", url: "/a/v1/approval-policies/capacity-gap", headers: ADMIN,
      payload: { ...POLICY_CAPACITY, subjectKinds: ["decision"] },
    });
    const r = await resolve(t, { capacity_gap: 0.12, gross_margin: 0.072 });
    expect(r.required).toBe(false);
    expect(r.trace.find((x) => x.policyKey === "thin-margin")?.skipped).toContain("DRAFT");
    expect(r.trace.find((x) => x.policyKey === "capacity-gap")?.skipped).toContain("subjectKind");
    expect(r.degraded).toBe(false); // 被跳过不是降级
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 6 · 端到端：开实例 → 逐级批复 → APPROVED
// ══════════════════════════════════════════════════════════════════════════

describe("§6 批复实例状态机（承载物真的在跑，不只是求值）", () => {
  it("开单 → planner 签第一步 → admin 签后两步 → APPROVED，事实快照留档", async () => {
    const t = await setup();
    const facts = { capacity_gap: 0.12, gross_margin: 0.15 };
    const created = await t.app.inject({ method: "POST", url: "/a/v1/approvals", headers: ADMIN, payload: request(facts) });
    expect(created.statusCode, created.body).toBe(201);
    const inst = created.json() as { id: string; tasks: { authorityKey: string; roleKey: string }[]; facts: Record<string, unknown> };
    expect(inst.tasks.map((x) => x.authorityKey)).toEqual(["planning_director", "manufacturing_director", "gm"]);
    // 事实快照必须落库：链条是这堆事实求出来的，不存就没有永久解释坐标。
    expect(inst.facts).toEqual(facts);

    // 第一步是 planner 口。用 base_manager 验拒绝路径（X-Debug-User 只带该角色，不持 planner）。
    const wrong = await t.app.inject({
      method: "POST", url: `/a/v1/approvals/${inst.id}/decide`,
      headers: BASE_MANAGER,
      payload: { decision: "APPROVE" },
    });
    expect(wrong.statusCode).toBe(409);

    const s1 = await t.app.inject({ method: "POST", url: `/a/v1/approvals/${inst.id}/decide`, headers: PLANNER, payload: { decision: "APPROVE" } });
    expect(s1.statusCode, s1.body).toBe(200);
    expect((s1.json() as { status: string }).status).toBe("PENDING");
    const s2 = await t.app.inject({ method: "POST", url: `/a/v1/approvals/${inst.id}/decide`, headers: ADMIN, payload: { decision: "APPROVE" } });
    expect((s2.json() as { status: string }).status).toBe("PENDING");
    const s3 = await t.app.inject({ method: "POST", url: `/a/v1/approvals/${inst.id}/decide`, headers: ADMIN, payload: { decision: "APPROVE", comment: "同意" } });
    expect((s3.json() as { status: string }).status).toBe("APPROVED");
  });

  it("任一环节 REJECT → 实例 REJECTED，后续环节不再可签", async () => {
    const t = await setup();
    const created = await t.app.inject({ method: "POST", url: "/a/v1/approvals", headers: ADMIN, payload: request({ capacity_gap: 0.12 }) });
    const id = (created.json() as { id: string }).id;
    const rej = await t.app.inject({ method: "POST", url: `/a/v1/approvals/${id}/decide`, headers: PLANNER, payload: { decision: "REJECT", comment: "产能可自消化" } });
    expect((rej.json() as { status: string }).status).toBe("REJECTED");
    const again = await t.app.inject({ method: "POST", url: `/a/v1/approvals/${id}/decide`, headers: ADMIN, payload: { decision: "APPROVE" } });
    expect(again.statusCode).toBe(409);
  });

  it("零命中不开空实例（400），跨租户读一律 404（R2）", async () => {
    const t = await setup();
    const none = await t.app.inject({ method: "POST", url: "/a/v1/approvals", headers: ADMIN, payload: request({ capacity_gap: 0.01, gross_margin: 0.5 }) });
    expect(none.statusCode).toBe(400);

    const created = await t.app.inject({ method: "POST", url: "/a/v1/approvals", headers: ADMIN, payload: request({ capacity_gap: 0.12 }) });
    const id = (created.json() as { id: string }).id;
    const cross = await t.app.inject({ method: "GET", url: `/a/v1/approvals/${id}`, headers: { "x-debug-user": "other:admin:admin" } });
    expect(cross.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 7 · 结构守门（防止下一次改动把上面这些悄悄拆掉）
// ══════════════════════════════════════════════════════════════════════════

describe("§7 结构守门", () => {
  it("暗发门：默认关 → 全部端点 404 FEATURE_NOT_FOUND（R3 先于 authz）", async () => {
    const t = await makeApp(); // 刻意不开 override
    for (const url of ["/a/v1/approval-policies", "/a/v1/approval-authorities", "/a/v1/approvals"]) {
      const res = await t.app.inject({ method: "GET", url, headers: ADMIN });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: "FEATURE_NOT_FOUND" } });
    }
    const post = await t.app.inject({ method: "POST", url: "/a/v1/approvals/resolve", headers: ADMIN, payload: request({}) });
    expect(post.statusCode).toBe(404);
  });

  it("暗发门 defaultOn:false，且不随 battery「all on」模板顺带开", async () => {
    const def = FEATURE_REGISTRY.find((f) => f.key === "approval.policy-engine");
    expect(def, "approval.policy-engine 必须在平台注册表").toBeDefined();
    expect(def!.defaultOn).toBe(false);
    // 光写 defaultOn:false 挡不住 L2 行业模板 —— 必须同列排除集，否则 demo 上它其实是开的。
    expect(GOVERNANCE_DARK_LAUNCH_FEATURES.has("approval.policy-engine")).toBe(true);
    const t = await makeApp();
    const resolved = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as { features: string[] };
    expect(resolved.features).not.toContain("approval.policy-engine");
  });

  it("红线 1 的物理形式：引擎源码不 import 任何业务流程层符号", async () => {
    const src = await readFile(join(REPO_APP, "src/approval-policy.ts"), "utf8");
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[0]);
    // 金丝雀：抽取器必须真的抽到了 import（抽到 0 条 ⇒ 工具坏了，不许读成"干净"）。
    expect(imports.length).toBeGreaterThan(3);
    expect(imports.some((i) => i.includes("./ruledsl.js"))).toBe(true); // 已知必中
    for (const forbidden of ["process.js", "ProcessDefinition", "processDefinitions", "chain-sim", "CHAIN_NODE_REGISTRY"]) {
      expect(imports.join("\n"), `引擎不得依赖业务流程层：${forbidden}`).not.toContain(forbidden);
    }
    // 正文里也不许出现（绕过 import 直接读 `repos.processDefinitions` 同样是耦合）。
    //
    // ⚠ 这里必须**先剥注释**再查 —— 本仓「提及 ≠ 读取」那条纪律的原样复现：
    // 引擎文件头就有一句「本文件不 import `processDefinitions`」，裸 `toContain` 会把这句**说明**
    // 当成**违规**（第一版就这么红的）。判据是代码里有没有真读它，不是文本里有没有出现这个词。
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
      .replace(/^\s*\/\/.*$/gm, ""); // 行注释
    // 金丝雀：剥完必须还剩真代码（剥空了 ⇒ 剥离器坏了，不许把"啥也没找到"读成"干净"）。
    expect(code).toContain("resolveChain");
    expect(code).toContain("approvalPolicies");
    for (const forbidden of ["processDefinitions", "ProcessDefinition", "CHAIN_NODE_REGISTRY"]) {
      expect(code, `引擎正文不得触碰业务流程层：${forbidden}`).not.toContain(forbidden);
    }
  });

  it("组织权限最小面：functionKey 锚到既有 15 条职能登记册（防第二套组织词表）", async () => {
    for (const a of AUTHORITIES) {
      expect(PROCESS_OWNER_FUNCTION_KEYS, `${a.key} 的 functionKey 必须在登记册内`).toContain(a.functionKey);
    }
  });

  it("R9 三处同改：migration 的表名与 pg.ts 的字面量逐字一致（memory 单测证明不了这一行）", async () => {
    const sql = await readFile(join(REPO_APP, "migrations/030_approval_policy.sql"), "utf8");
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
    expect(created).toEqual(["approval_authorities", "approval_instances", "approval_policies"]); // 金丝雀含在内：抽 0 条会当场红
    const pg = await readFile(join(REPO_APP, "src/repo/pg.ts"), "utf8");
    for (const table of created) {
      expect(pg, `pg.ts 必须有 PgStore(pool, "${table}")`).toContain(`new PgStore(pool, "${table}")`);
    }
    const mem = await readFile(join(REPO_APP, "src/repo/memory.ts"), "utf8");
    for (const field of ["approvalAuthorities", "approvalPolicies", "approvalInstances"]) {
      expect(mem, `memory.ts 必须注册 ${field}`).toContain(`${field}: new MemStore()`);
    }
  });

  it("业务流程契约零改动：PROCESS_WAIT_KINDS 仍是四种，没有 WAITING_APPROVAL", async () => {
    // 本单建了「承载物」，但**没有**顺手把 WAITING_APPROVAL 补进流程层 —— 补了就是把审批
    // 焊回业务流程定义，正交性当场丢失（`process.ts` §1 原文点名警告过这条「顺手补齐」）。
    const { PROCESS_WAIT_KINDS } = await import("@platform/contracts");
    expect([...PROCESS_WAIT_KINDS]).toEqual([
      "WAITING_USER",
      "WAITING_DATA",
      "WAITING_EXTERNAL_SYSTEM",
      "WAITING_SCHEDULE",
    ]);
  });
});
