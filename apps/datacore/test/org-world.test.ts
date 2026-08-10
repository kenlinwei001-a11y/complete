import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ApprovalLimitSchema,
  ApprovalMatterSchema,
  OrgPrincipalSchema,
  PRINCIPAL_KINDS,
  PrincipalSchema,
  evaluateLimit,
  type ApprovalMatter,
} from "@platform/contracts";
import { lexiconHit, ROLE_LEXICON, type RoleLexiconKey } from "../src/solvers/field-role-lexicon.js";
import {
  REUSED_SYNTHETIC_DEPT_IDS,
  buildApprovalLimits,
  buildAuthorities,
  buildDelegations,
  buildOrgPrincipals,
} from "../src/org/seed.js";
import { ORG_PRINCIPAL_VM_KEYS } from "../src/org/routes.js";
import { OrgWorldService } from "../src/org/service.js";
import { seedDemoOrgWorld } from "../src/seed.js";
import { ADMIN, PLANNER, makeApp, type TestApp } from "./helpers.js";

/**
 * WO-ORG-WORLD · 组织世界（七世界之②）。
 *
 * 本文件的判据一律写在**效果层**：断言「**返回的人变了**」，不是「返回了一个数组」。
 * 「返回了 N 条」这种断言在本仓炸过太多次 —— 它在实现退化成恒真时照样绿。
 *
 * 六组断言：
 *  ① 额度真的起作用（400万 → 张明；600万 → 张明消失、王强顶上）    ← 头号判据
 *  ② 代理真的生效（张明不在岗 → 赵敏以 via="delegated" 顶上）
 *  ③ 单源：扩的是既有 `PrincipalSchema`，没有新造平行身份类型
 *  ④ 变异反证：额度判定退化成恒真 → ① 必须变红
 *  ⑤ #139 守门：数值 propKey 不撞 `ROLE_LEXICON`（用**真的** `lexiconHit`，不抄正则）
 *  ⑥ 铁律：R2 租户隔离 · R6 确定性 · no-secrets-echo · Entitlement 先于 authz · pg 表名对账
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");
const TENANT = "demo";
const CTX = { tenantId: TENANT, userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

/** 待批事项构造器：只写与本条断言相关的维度，其余走 schema 缺省（避免测试里堆无关字面量）。 */
const matter = (over: Partial<ApprovalMatter>): ApprovalMatter => ApprovalMatterSchema.parse(over);

/** 装好组织世界的服务（memory 仓储，不跑合成种子 —— 组织世界与合成数据正交）。 */
async function orgApp(): Promise<{ t: TestApp; svc: OrgWorldService }> {
  const t = await makeApp();
  await seedDemoOrgWorld(t.repos);
  return { t, svc: new OrgWorldService(t.repos) };
}

const namesOf = (r: { eligible: { name: string }[] }): string[] => r.eligible.map((c) => c.name);

// ══════════════════════════════════════════════════════════════════════════
// ① 额度真的起作用 —— 头号判据：**返回的人变了**
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ① 审批额度真的起作用（指名道姓）", () => {
  it("400万订单 → 销售经理张明有权；600万 → 张明无权、上浮到总经理王强", async () => {
    const { svc } = await orgApp();

    // ── 400 万：销售经理额度 500 万，够 ────────────────────────────────
    const at400 = await svc.resolveApprovers(CTX, matter({ scope: "order", amount: 4_000_000, marginPct: 8 }));
    expect(namesOf(at400)).toContain("张明"); // 销售经理本人
    expect(at400.stuck).toBe(false);
    // 张明是最低够用的那一档 ⇒ 排在最前（escalationRank 10 < 20 < 30 < 40）
    expect(at400.eligible[0]!.name).toBe("张明");
    expect(at400.eligible[0]!.authorityKey).toBe("auth_sales_order");

    // ── 600 万：同一笔事项只改金额 ────────────────────────────────────
    const at600 = await svc.resolveApprovers(CTX, matter({ scope: "order", amount: 6_000_000, marginPct: 8 }));
    // 🔴 头号断言：**这个人消失了**（不是「数组变短了」）
    expect(namesOf(at600)).not.toContain("张明");
    // 🔴 且**上浮到了总经理**（指名道姓）
    expect(namesOf(at600)).toContain("王强");
    expect(at600.eligible[0]!.authorityKey).toBe("auth_finance_order"); // 20 档财务先接住
    expect(namesOf(at600)).toContain("李芳");

    // 落选原因必须说清楚**为什么**卡住 —— 这是本世界存在的理由
    const salesBlocked = at600.blockers.find((b) => b.authorityKey === "auth_sales_order");
    expect(salesBlocked).toBeDefined();
    expect(salesBlocked!.reasons.join()).toContain("超过可批上限 5000000");
    expect(salesBlocked!.name).toBe("张明");
  });

  it("利润率下限：3% → 财务负责人李芳无权；8% → 李芳有权（同一笔金额）", async () => {
    const { svc } = await orgApp();
    const lowMargin = await svc.resolveApprovers(CTX, matter({ amount: 6_000_000, marginPct: 3 }));
    expect(namesOf(lowMargin)).not.toContain("李芳");
    expect(
      lowMargin.blockers.find((b) => b.authorityKey === "auth_finance_order")!.reasons.join(),
    ).toContain("低于可批下限 5%");

    const okMargin = await svc.resolveApprovers(CTX, matter({ amount: 6_000_000, marginPct: 8 }));
    expect(namesOf(okMargin)).toContain("李芳");
  });

  it("跨基地：普通订单张明可批；同一笔标 crossBase → 只剩经营委员会孙伟", async () => {
    const { svc } = await orgApp();
    const local = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8 }));
    expect(namesOf(local)).toContain("张明");

    const cross = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8, crossBase: true }));
    expect(namesOf(cross)).not.toContain("张明");
    expect(namesOf(cross)).not.toContain("王强"); // 总经理也没有跨基地权
    expect(namesOf(cross)).toEqual(["孙伟"]); // 只剩经营委员会
    expect(cross.blockers.find((b) => b.authorityKey === "auth_sales_order")!.reasons).toContain("无跨基地审批权");
  });

  it("资本投入：800万总经理王强可批；1.2亿 → 王强无权、上浮到经营委员会孙伟", async () => {
    const { svc } = await orgApp();
    const small = await svc.resolveApprovers(
      CTX,
      matter({ scope: "investment", amount: 8_000_000, capitalExpenditure: true }),
    );
    expect(namesOf(small)).toContain("王强");

    const huge = await svc.resolveApprovers(
      CTX,
      matter({ scope: "investment", amount: 120_000_000, capitalExpenditure: true }),
    );
    expect(namesOf(huge)).not.toContain("王强");
    expect(namesOf(huge)).toEqual(["孙伟"]);
  });

  it("谁都批不了时 stuck=true 且给出一句话诊断（= 「为什么这个流程现在卡住了」）", async () => {
    const { svc } = await orgApp();
    // 20 亿资本投入：连经营委员会的 10 亿上限都过不去
    const r = await svc.resolveApprovers(
      CTX,
      matter({ scope: "investment", amount: 2_000_000_000, capitalExpenditure: true }),
    );
    expect(r.eligible).toEqual([]);
    expect(r.stuck).toBe(true);
    // 诊断必须指向**最高职权**被挡的原因（低职权的落选原因是噪音）
    expect(r.diagnosis).toContain("经营委员会");
    expect(r.diagnosis).toContain("2000000000");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ② 代理真的生效
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ② 代理关系真的生效", () => {
  it("张明不在岗 → 返回代理人赵敏（via=delegated·delegatedFrom 指回张明）", async () => {
    const { t, svc } = await orgApp();
    const m = matter({ amount: 4_000_000, marginPct: 8 });

    // 在岗时是张明本人
    expect(namesOf(await svc.resolveApprovers(CTX, m))).toContain("张明");

    // 置为不在岗（**显式字段**，不动时钟 —— R6）
    const zhang = (await t.repos.orgPrincipals.list(TENANT, (p) => p.principalId === "prin-p-zhangming"))[0]!;
    await t.repos.orgPrincipals.put({ ...zhang, available: false });

    const after = await svc.resolveApprovers(CTX, m);
    expect(namesOf(after)).not.toContain("张明");
    expect(namesOf(after)).toContain("赵敏"); // 🔴 代理人顶上
    const deputy = after.eligible.find((c) => c.name === "赵敏")!;
    expect(deputy.via).toBe("delegated");
    expect(deputy.delegatedFrom).toBe("prin-p-zhangming");
    expect(deputy.authorityKey).toBe("auth_sales_order"); // 代的是张明那份职权
  });

  it("代理人自己也不在岗 → 不顶，诚实记为 blocker（不静默丢人）", async () => {
    const { t, svc } = await orgApp();
    for (const id of ["prin-p-zhangming", "prin-p-zhaomin"]) {
      const p = (await t.repos.orgPrincipals.list(TENANT, (x) => x.principalId === id))[0]!;
      await t.repos.orgPrincipals.put({ ...p, available: false });
    }
    const r = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8 }));
    expect(namesOf(r)).not.toContain("张明");
    expect(namesOf(r)).not.toContain("赵敏");
    expect(r.blockers.some((b) => b.name === "张明" && b.reasons.join().includes("不在岗"))).toBe(true);
  });

  it("R6：代理窗口只在显式传 asOf 时判定，绝不读时钟", async () => {
    const { t, svc } = await orgApp();
    const zhang = (await t.repos.orgPrincipals.list(TENANT, (p) => p.principalId === "prin-p-zhangming"))[0]!;
    await t.repos.orgPrincipals.put({ ...zhang, available: false });

    // 窗口内 → 生效
    const inside = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8, asOf: "2026-06-01" }));
    expect(namesOf(inside)).toContain("赵敏");
    // 窗口外 → 不生效（种子窗口 2026-01-01..2026-12-31）
    const outside = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8, asOf: "2027-06-01" }));
    expect(namesOf(outside)).not.toContain("赵敏");
    // 不传 asOf → 不做窗口判定（视为生效）—— 这正是「不读时钟」的可观测形式：
    // 若实现偷偷用了 Date.now()，这一条会随真实日期漂移（2027 年跑就红）。
    const noAsOf = await svc.resolveApprovers(CTX, matter({ amount: 4_000_000, marginPct: 8 }));
    expect(namesOf(noAsOf)).toContain("赵敏");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 单源断言 —— 扩的是既有 Principal，没有新造平行身份类型
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ③ 单源：扩既有 Principal，未新造 Person", () => {
  it("OrgPrincipalSchema 的**前 N 个键与顺序**逐字等于 PrincipalSchema（= .extend() 的指纹）", () => {
    const base = Object.keys(PrincipalSchema.shape);
    const ext = Object.keys(OrgPrincipalSchema.shape);
    expect(base.length).toBeGreaterThan(0); // 金丝雀：基类型真有字段，别拿空集比空集
    // `.extend()` 保留基 schema 的键序作为前缀；手抄一个平行 z.object 极难复现该前缀序，
    // 且即便复现也已是「抄了一份」——这条断言把「扩」与「抄」分开。
    expect(ext.slice(0, base.length)).toEqual(base);
  });

  it("kind 值域直接来自 PRINCIPAL_KINDS，没有抄第二份三值表", () => {
    expect(OrgPrincipalSchema.shape.kind.options).toEqual([...PRINCIPAL_KINDS]);
    // 组织世界的 Person/Role/Department 三者就是这三个值，不是三个新类型
    expect([...PRINCIPAL_KINDS].sort()).toEqual(["org", "person", "role"]);
  });

  it("契约包里不存在平行身份类型（PersonSchema/EmployeeSchema/StaffSchema…）·带金丝雀", async () => {
    const idx = await readFile(join(REPO_APP, "../../packages/contracts/src/org-world.ts"), "utf8");
    // 金丝雀：先证明「我这个正则真能在这份文件里咬到东西」，再报否定结论。
    // 不中 ⇒ 报「工具坏了」，不许报「没有平行类型」。
    const canary = /export const (\w+)Schema/g;
    const declared = [...idx.matchAll(canary)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(0); // ← 金丝雀命中证据
    expect(declared).toContain("OrgPrincipal"); // ← 已知必中样例
    // 否定结论（有金丝雀背书）：没有任何平行身份类型
    for (const forbidden of ["Person", "Employee", "Staff", "User", "Headcount"]) {
      expect(declared).not.toContain(forbidden);
    }
    // 且 OrgPrincipal 必须由 PrincipalSchema.extend 产出（源码级证据，不靠记性）
    expect(idx).toContain("PrincipalSchema.extend(");
  });

  it("组织种子复用既有 synthetic Principal 的部门 id，不为同一实体造第二行·带金丝雀", async () => {
    const battery = await readFile(join(REPO_APP, "src/synthetic/battery.ts"), "utf8");
    // 金丝雀：先确认能在 battery.ts 里咬到 principalId 字面量（咬不到 = 工具坏了，不是「没有复用」）
    const found = [...battery.matchAll(/principalId: "(prin-[a-z-]+)"/g)].map((m) => m[1]!);
    expect(found.length).toBeGreaterThanOrEqual(7); // ← 金丝雀命中证据（battery.ts:4006 共 7 条）
    // 否定/肯定结论：本单声明复用的每个 id 都真的在 synthetic population 里存在
    for (const id of Object.values(REUSED_SYNTHETIC_DEPT_IDS)) expect(found).toContain(id);
    // 且组织种子里**没有**为这些部门另造一行（同 principalId 只可能出现一次）
    const seeded = buildOrgPrincipals(TENANT).map((p) => p.principalId);
    expect(new Set(seeded).size).toBe(seeded.length); // 无重复
    for (const id of Object.values(REUSED_SYNTHETIC_DEPT_IDS)) {
      expect(seeded.filter((s) => s === id)).toHaveLength(0); // 复用者不重新播，只被引用
    }
    // 引用是真的存在的（角色/人的 parentRef 指向复用 id）
    const parents = buildOrgPrincipals(TENANT).map((p) => p.parentRef);
    expect(parents).toContain(REUSED_SYNTHETIC_DEPT_IDS.finance);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 变异反证 —— 额度判定退化成恒真，① 必须变红
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ④ 变异反证：额度退化成恒真 → ① 变红", () => {
  it("把销售经理额度改成「不设限」(maxOrderValue=null) → 600万时张明**又出现了**", async () => {
    const { t, svc } = await orgApp();
    const m600 = matter({ scope: "order", amount: 6_000_000, marginPct: 8 });

    // 变异前：① 的断言成立（张明不在）
    expect(namesOf(await svc.resolveApprovers(CTX, m600))).not.toContain("张明");

    // 变异：金额维度退化成恒真
    const lim = (await t.repos.orgApprovalLimits.list(TENANT, (l) => l.limitKey === "lim_sales_order"))[0]!;
    await t.repos.orgApprovalLimits.put({ ...lim, maxOrderValue: null });

    // 🔴 变异后张明回来了 ⇒ ① 那条断言在此变异下**会红**
    //    ⇒ 证明 ① 咬的是「额度真的起作用」，不是某个恰好成立的巧合。
    expect(namesOf(await svc.resolveApprovers(CTX, m600))).toContain("张明");
  });

  it("纯函数层同一反证：evaluateLimit 退化成恒返回 [] 与真实实现结果不同", () => {
    const lim = ApprovalLimitSchema.parse({
      id: "x",
      tenantId: TENANT,
      limitKey: "lim_probe",
      authorityRef: "auth_probe",
      maxOrderValue: 5_000_000,
    });
    const m = matter({ amount: 6_000_000 });
    const real = evaluateLimit(lim, m);
    const degenerate: string[] = []; // 恒真变异体
    expect(real).not.toEqual(degenerate); // 真实实现确实在做判定
    expect(real.join()).toContain("超过可批上限");
    // 反向：额度够时两者一致（证明不是「恒假」那种同样退化的实现）
    expect(evaluateLimit(lim, matter({ amount: 4_000_000 }))).toEqual([]);
  });

  it("空额度 = 无权（缺省收紧），不是「不设限」—— 否则忘配额度会变成谁都能批", async () => {
    const { t, svc } = await orgApp();
    for (const l of await t.repos.orgApprovalLimits.list(TENANT)) await t.repos.orgApprovalLimits.remove(TENANT, l.id);
    const r = await svc.resolveApprovers(CTX, matter({ amount: 1, marginPct: 99 }));
    expect(r.eligible).toEqual([]);
    expect(r.stuck).toBe(true);
    expect(r.blockers.every((b) => b.reasons.join().includes("未配置任何审批额度"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ #139 守门 —— 数值 propKey 不撞 ROLE_LEXICON（用真的 lexiconHit，不抄正则）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ⑤ 欠账 #139 守门", () => {
  /**
   * #139：`ROLE_LEXICON` 只认 **`propKey` 原文**，中文 `displayName` 一律无效
   * （`field-roles.ts:91/93/95/102` 拿 `numFields(t).propKey` 去 `lexiconHit`）。
   * 于是一个叫 `maxCapexValue` 的字段里那三个字母 `cap` 会让整条记录被通用图求解器
   * 推断成「资源/产能类型」—— 而中文名写得再清楚也救不了。
   *
   * 本门用**真的 `lexiconHit`**（与主逻辑共用同一份实现，**不抄正则** —— 抄了就是装饰品，
   * 改主正则时门拿旧的去测、照样绿）逐个数值字段跑一遍。
   */
  const FIELD_LEVEL_LEXICONS: RoleLexiconKey[] = ["capacity", "demand", "priority", "revenue", "cost"];

  /** 组织世界全部**数值**字段的 propKey（数值才进 `numFields`，才被字段级词库扫）。 */
  const NUMERIC_PROP_KEYS = [
    "workload", // OrgPrincipal
    "escalationRank", // Authority（刻意不叫 level）
    "maxOrderValue", // ApprovalLimit
    "minMarginPct",
    "maxInvestmentValue", // 刻意不叫 maxCapexValue
  ];

  it("金丝雀：lexiconHit 本身是活的（已知必中样例必须命中）", () => {
    // 报「零命中」这种否定结论之前，先自证工具没坏（铁律 0.6）。
    expect(lexiconHit("capacity", "capacity")).toBe(true);
    expect(lexiconHit("maxCapexValue", "capacity")).toBe(true); // ← 就是本单刻意规避的那个命名
    expect(lexiconHit("level", "priority")).toBe(true); // ← 刻意规避的第二个
    expect(lexiconHit("maxCustomerTier", "priority")).toBe(true); // ← 刻意规避的第三个
    expect(Object.keys(ROLE_LEXICON).length).toBeGreaterThan(0);
  });

  it("组织世界的数值 propKey 一个都不撞五个字段级词库（有金丝雀背书的否定结论）", () => {
    const collisions: string[] = [];
    for (const key of NUMERIC_PROP_KEYS) {
      for (const lex of FIELD_LEVEL_LEXICONS) {
        if (lexiconHit(key, lex)) collisions.push(`${key} ⇄ ROLE_LEXICON.${lex}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("这些 propKey 真的就是契约里在用的那些（防清单与实现漂移）", () => {
    const limitKeys = Object.keys(ApprovalLimitSchema.shape);
    expect(limitKeys).toContain("maxOrderValue");
    expect(limitKeys).toContain("minMarginPct");
    expect(limitKeys).toContain("maxInvestmentValue");
    // 反向：被规避掉的那两个名字**不许**出现（谁改回去，这里当场红）
    expect(limitKeys).not.toContain("maxCapexValue");
    expect(limitKeys).not.toContain("maxCustomerTier");
    expect(Object.keys(OrgPrincipalSchema.shape)).toContain("workload");
  });

  it("#139 的组织世界形态：判定只认机器键，改中文名不改变任何结果", async () => {
    const { t, svc } = await orgApp();
    const m = matter({ amount: 4_000_000, marginPct: 8 });
    const before = await svc.resolveApprovers(CTX, m);

    // 把所有中文名/职务名改掉（机器键一个不动）
    for (const p of await t.repos.orgPrincipals.list(TENANT)) {
      await t.repos.orgPrincipals.put({ ...p, name: `改名_${p.orgKey}`, title: "改了" });
    }
    const after = await svc.resolveApprovers(CTX, m);

    // 🔴 命中的**人**（principalId）与职权完全不变 —— 证明判定路径没读中文名
    expect(after.eligible.map((c) => c.principalId)).toEqual(before.eligible.map((c) => c.principalId));
    expect(after.eligible.map((c) => c.authorityKey)).toEqual(before.eligible.map((c) => c.authorityKey));
    // 只有给人看的显示名变了
    expect(after.eligible[0]!.name).not.toBe(before.eligible[0]!.name);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 铁律：R2 隔离 · R6 确定性 · no-secrets-echo · Entitlement · pg 表名对账
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ORG-WORLD ⑥ 平台铁律", () => {
  it("R2：另一租户读不到 demo 的组织世界（跨租户为空，不是漏筛）", async () => {
    const { svc } = await orgApp();
    const other = { ...CTX, tenantId: "other-tenant" };
    expect(await svc.listPrincipals(other)).toEqual([]);
    const r = await svc.resolveApprovers(other, matter({ amount: 4_000_000, marginPct: 8 }));
    expect(r.eligible).toEqual([]);
    expect(r.stuck).toBe(true);
    // 金丝雀：同一把尺子量 demo 必须有货（否则「空」证明的是种子没播，不是隔离生效）
    expect((await svc.listPrincipals(CTX)).length).toBeGreaterThan(0);
  });

  it("R6：同租户重跑种子字节级一致（无时钟无随机）", async () => {
    const a = JSON.stringify([
      buildOrgPrincipals(TENANT),
      buildAuthorities(TENANT),
      buildApprovalLimits(TENANT),
      buildDelegations(TENANT),
    ]);
    const b = JSON.stringify([
      buildOrgPrincipals(TENANT),
      buildAuthorities(TENANT),
      buildApprovalLimits(TENANT),
      buildDelegations(TENANT),
    ]);
    expect(a).toBe(b);
    expect(a).not.toContain(String(new Date().getFullYear() + 100)); // 哨兵：没有偷偷塞时间戳
  });

  it("R6：resolveApprovers 同输入同输出（排序确定，无 Set/Map 迭代序泄漏）", async () => {
    const { svc } = await orgApp();
    const m = matter({ amount: 4_000_000, marginPct: 8 });
    const r1 = JSON.stringify(await svc.resolveApprovers(CTX, m));
    const r2 = JSON.stringify(await svc.resolveApprovers(CTX, m));
    expect(r1).toBe(r2);
  });

  it("no-secrets-echo：人员下发是白名单，键集逐字受控", async () => {
    const { t } = await orgApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "org.world": true } },
    });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/org/chart", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { persons: Record<string, unknown>[] };
    expect(body.persons.length).toBeGreaterThan(0); // 金丝雀：真有人，别拿空集证明「没泄漏」
    for (const p of body.persons) {
      expect(Object.keys(p).sort()).toEqual([...ORG_PRINCIPAL_VM_KEYS].sort());
    }
    // 敏感字段一个都不许出现（即便将来 OrgPrincipal 加了它们）
    const raw = JSON.stringify(body);
    for (const secret of ["passwordHash", "password", "idCard", "salary", "phone", "email"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("Entitlement 先于 authz：org.world 关闭 → 404 FEATURE_NOT_FOUND（暗发 defaultOn:false）", async () => {
    const { t } = await orgApp();
    // 未 override ⇒ 默认关（开关默认值是产品决策，dev 不自己开）
    const closed = await t.app.inject({ method: "GET", url: "/a/v1/org/chart", headers: ADMIN });
    expect(closed.statusCode).toBe(404);
    expect((closed.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    // 错误信封统一
    expect(closed.json()).toHaveProperty("error.requestId");

    // 显式 override 后才通
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "org.world": true } },
    });
    const open = await t.app.inject({ method: "GET", url: "/a/v1/org/chart", headers: ADMIN });
    expect(open.statusCode).toBe(200);
  });

  it("主端点 POST /a/v1/org/approvers/resolve 端到端：400万→张明，600万→王强", async () => {
    const { t } = await orgApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "org.world": true } },
    });
    const call = (amount: number) =>
      t.app.inject({
        method: "POST",
        url: "/a/v1/org/approvers/resolve",
        headers: ADMIN,
        payload: { scope: "order", amount, marginPct: 8 },
      });
    const r400 = (await call(4_000_000)).json() as { eligible: { name: string }[] };
    const r600 = (await call(6_000_000)).json() as { eligible: { name: string }[] };
    expect(r400.eligible.map((c) => c.name)).toContain("张明");
    expect(r600.eligible.map((c) => c.name)).not.toContain("张明");
    expect(r600.eligible.map((c) => c.name)).toContain("王强");
  });

  /**
   * 「接了线没数据」防线：`available` 若没有写面，生产里它永远是种子的 `true`，
   * 代理分支**一次都不会进** —— 实现有、单测绿、生产零触发（本仓假绿的老形态）。
   * 故这条断言走**真 HTTP**，从改在岗状态到代理生效整条链一次打通，不手改仓储。
   */
  it("代理链在生产可达：真 HTTP 改在岗状态 → 同一端点返回的人从张明变成赵敏", async () => {
    const { t } = await orgApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "org.world": true } },
    });
    const ask = async () => {
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/org/approvers/resolve",
        headers: ADMIN,
        payload: { scope: "order", amount: 4_000_000, marginPct: 8 },
      });
      return (res.json() as { eligible: { name: string; via: string }[] }).eligible;
    };
    expect((await ask()).map((c) => c.name)).toContain("张明");

    // 真 HTTP 写面（不是手改仓储）
    const patch = await t.app.inject({
      method: "PATCH",
      url: "/a/v1/org/principals/prin-p-zhangming/availability",
      headers: ADMIN,
      payload: { available: false },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { available: boolean }).available).toBe(false);

    const after = await ask();
    expect(after.map((c) => c.name)).not.toContain("张明");
    expect(after.map((c) => c.name)).toContain("赵敏");
    expect(after.find((c) => c.name === "赵敏")!.via).toBe("delegated");
  });

  it("写面守权：planner 改不了他人在岗状态（403）；不存在的人 404；部门/角色 400", async () => {
    const { t } = await orgApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "org.world": true } },
    });
    const patch = (id: string, headers: Record<string, string>) =>
      t.app.inject({
        method: "PATCH",
        url: `/a/v1/org/principals/${id}/availability`,
        headers,
        payload: { available: false },
      });
    expect((await patch("prin-p-zhangming", PLANNER)).statusCode).toBe(403);
    expect((await patch("prin-p-nobody", ADMIN)).statusCode).toBe(404);
    // 角色没有在岗状态 → VALIDATION_ERROR（本仓 validationError 是 400，见 errors.ts:14；
    // 不是 422 —— 422 在本仓专给 ROLE_CANNOT_EXCEED_TENANT 那类语义冲突用）
    const roleRes = await patch("prin-role-sales-mgr", ADMIN);
    expect(roleRes.statusCode).toBe(400);
    expect((roleRes.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("R9 四处齐：030 migration 的表名与 pg.ts 的字面量逐字对账（含金丝雀）", async () => {
    const sql = await readFile(join(REPO_APP, "migrations/030_org_world.sql"), "utf8");
    const pg = await readFile(join(REPO_APP, "src/repo/pg.ts"), "utf8");
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);
    // 金丝雀：抽不到 4 张表 ⇒ 报「工具坏了」，不许报「表名对上了」
    expect(tables).toHaveLength(4);
    expect(tables).toContain("org_principals");
    for (const tbl of tables) expect(pg).toContain(`new PgStore(pool, "${tbl}")`);
    // memory.ts 三处同改的第二处也在（漏了 pg 模式会静默少表）
    const mem = await readFile(join(REPO_APP, "src/repo/memory.ts"), "utf8");
    for (const field of ["orgPrincipals", "orgAuthorities", "orgApprovalLimits", "orgDelegations"]) {
      expect(mem).toContain(`${field}: new MemStore()`);
    }
  });
});
