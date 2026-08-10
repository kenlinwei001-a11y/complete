/**
 * WO-CERT-CONTRACT-RECONCILE 验收门 —— 沙盘认证契约「两种设计」合成后的四条判据。
 *
 * ── 本门存在的理由（裁决记录，别删）──────────────────────────────────────────
 * 两条 WO 对同一块字段各执一词，实测下来**两边各对一半**：
 *  · WO-CERT-HONESTY ③：「`rulesFired` 这个名字本身就是错的」——**成立**。它装的是
 *    `recompute` 拓扑排序出的**派生规格节点数（规模）**，不是「本次触发数」。
 *  · WO-SIM-SCOPE-TRIAL：「传导相今天真的在跑、真的在数触发」——**也成立**，
 *    `firedPropagationRuleKeys` 只数真产出贡献的规则 key。
 * ⇒ 合成结论：两个数**性质不同、不可相加**，旧字段 `rulesFired = 规模 + 触发` 量纲不成立。
 *
 * ── 四条判据 × 变异反证（**已逐条实跑**，下表是实测结果不是设想）──────────────
 * 判据是「破哪一处 → 哪一条红」**可分辨**：五次变异各有不同的红名单，据此能指认病灶。
 *
 *  | 变异 | 注入点 | 实测红 | 实测绿 |
 *  |---|---|---|---|
 *  | M1 | `propagation.ts scopePropagationGraph` 开头直接 `return {graph,…}`（LOCAL 不裁） | ①×2 | ②③④ 全绿 |
 *  | M2 | `app.ts` Trial Tick 的 `propagationRulesFired` 硬写 `0` | ①×2 · ②a · ④ | ③ 全绿 · ②b②c 绿 |
 *  | M3 | `app.ts` 把 `derivationNodes` 换成 `rc.updatedObjects`（拿触发数冒充规模） | ③端到端 ×1 | ①②④ 全绿 |
 *  | M4a/b | 认证路绕开唯一装配处（分别漏 `ruleParams` / 漏 `cadenceGates`） | ④效果 ×1 | ①②③ 全绿 |
 *  | M4c | 在 `app.ts` 里再装配一遍（`buildCadenceGates(`） | ④结构 | 其余绿 |
 *  | M5 | 关掉 `certification.ts` 的 `PROPAGATION_ALL_SILENT` 分支 | ②c ×1 | ①③④ 全绿 |
 *
 * ⚠ M2 会连带 ① 与 ④ 一起红，这是**诚实的耦合**不是判据没做好：① 与 ④ 都只能**透过**传导计数
 *   去观测（范围裁没裁、入参装没装，最终都体现为"这条规则触没触发"）。把一个计数钉死在 0，
 *   等于把这三条的观测窗口一起蒙上 —— 此时红名单仍与 M1/M3/M4/M5 各不相同，可分辨性成立。
 *   （③ 已刻意与传导计数解耦：M2 下 ③ 三例全绿，故"派生口径坏了"与"传导计数坏了"分得开。）
 *
 * ⚠ 判据一律是**效果层**：比的是端点真回出来的数，不是「某个函数被调用了」——
 *   函数可以调用了却原样返回（本仓 `scopePropagationGraph` 就有这个形态）。
 */
import { describe, expect, it } from "vitest";
import { debugUser, makeApp, type TestApp } from "./helpers.js";

const ORG = { type: "SYNTHETIC" as const, jobId: "cert-reconcile-seam" };
const H = (tenant: string) => debugUser(tenant, "admin", "admin");

const enable = (t: TestApp, tenant: string) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: H(tenant),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

/**
 * 抽象三点链（R14 零行业名）：`a1(TypeA) --FEEDS--> b1(TypeB) --FEEDS--> c1(TypeC)`。
 * 三点而非两点：两点图上 LOCAL(1 跳) 恰好圈住整张图 ⇒ 与 GLOBAL 逐字节相同 ⇒ ① 恒绿而缺陷仍在。
 */
async function threeNodeWorld(t: TestApp, tenant: string): Promise<void> {
  for (const k of ["TypeA", "TypeB", "TypeC"]) {
    await t.repos.ontologyTypes.put({
      id: `otype_${k}_${tenant}`, tenantId: tenant, key: k, displayName: k,
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
  }
  await t.repos.objects.put({ id: "a1", tenantId: tenant, type: "TypeA", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "b1", tenantId: tenant, type: "TypeB", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "c1", tenantId: tenant, type: "TypeC", props: {}, origin: ORG });
  await t.repos.links.put({ id: "l_ab", tenantId: tenant, type: "FEEDS", fromId: "a1", toId: "b1", origin: ORG });
  await t.repos.links.put({ id: "l_bc", tenantId: tenant, type: "FEEDS", fromId: "b1", toId: "c1", origin: ORG });
}

/** 两条即时传导规则：A.flow→B.load、B.flow→C.load（源态都非零 ⇒ GLOBAL 下两条都真触发）。 */
async function publishTwoRules(t: TestApp, tenant: string): Promise<void> {
  for (const r of [
    { key: "r_ab", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "load" },
    { key: "r_bc", sourceTypeKey: "TypeB", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeC", targetStateVar: "load" },
  ]) {
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H(tenant),
      payload: { ...r, coefficient: 1, delayTicks: 0, status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
  }
}

const BASE = { a1: { flow: 10 }, b1: { flow: 5, load: 0 }, c1: { load: 0 } };

type Cert = {
  trialTick: {
    passed: boolean;
    derivationNodes?: number;
    propagationRulesFired?: number;
    propagationRulesDeclared?: number;
    propagationCovered?: boolean;
    rulesFired?: number;
    derivationRulesFired?: number;
    error: string | null;
  };
  gaps: { gapCode: string; ref: string; detail: string }[];
};

/** 建会话 + 取认证（走真 HTTP，不直调纯函数）。 */
async function certify(t: TestApp, tenant: string, query: string, base: Record<string, Record<string, number>> = BASE): Promise<Cert> {
  const sid = (await (await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: H(tenant),
    payload: { baseSnapshot: base, scope: { kind: "GLOBAL" } },
  })).json()).id as string;
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?${query}`, headers: H(tenant) });
  expect(r.statusCode).toBe(200);
  return r.json() as Cert;
}

// ══════════════════════════════════════════════════════════════════════════
describe("WO-CERT-CONTRACT-RECONCILE ① 切 LOCAL ⇒ 引擎真的只算局部", () => {
  it("① 认证 Trial Tick 的传导计数随范围变（GLOBAL 2 → LOCAL(TypeA) 1）——不是「局部=全局」", async () => {
    const t = await makeApp();
    const TEN = "recon1";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    const g = await certify(t, TEN, "scope=GLOBAL");
    const l = await certify(t, TEN, "scope=LOCAL&target=TypeA");

    // GLOBAL：两条边都在 ⇒ 两条规则都产出贡献。
    expect(g.trialTick.propagationRulesFired).toBe(2);
    // LOCAL(TypeA, 1 跳)：范围 = {a1,b1}；`b1 --FEEDS--> c1` 两端不全在范围内 ⇒ 整条边被裁
    // ⇒ r_bc 一个 target 都取不到 ⇒ 只剩 r_ab 能触发。
    expect(l.trialTick.propagationRulesFired).toBe(1);
    // 头号判据（效果层）：两个范围**必须给出不同的数**。
    // 「scopePropagationGraph 被调用了」证明不了任何事——它可以调用了却原样返回。
    expect(l.trialTick.propagationRulesFired).not.toBe(g.trialTick.propagationRulesFired);
  });

  it("① 诚实缺席：自称 LOCAL 却没有根 ⇒ 传导计数为 0，**绝不静默退回 GLOBAL 的 2**", async () => {
    const t = await makeApp();
    const TEN = "recon1b";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    const g = await certify(t, TEN, "scope=GLOBAL");
    const noTarget = await certify(t, TEN, "scope=LOCAL"); // 无 target
    expect(g.trialTick.propagationRulesFired).toBe(2);
    expect(noTarget.trialTick.propagationRulesFired).toBe(0);
    // 「我算不出局部」与「局部等于全局」是两个命题——后者正是本项要根治的静默错答。
    expect(noTarget.trialTick.propagationRulesFired).not.toBe(g.trialTick.propagationRulesFired);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("WO-CERT-CONTRACT-RECONCILE ② 传导相真的跑 + declared vs fired 的差看得见", () => {
  it("②a 传导相真跑：covered=true 且 fired>0（此前恒 0——跑的是派生重算，不是传导核）", async () => {
    const t = await makeApp();
    const TEN = "recon2a";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    const cert = await certify(t, TEN, "scope=GLOBAL");
    expect(cert.trialTick.passed).toBe(true);
    expect(cert.trialTick.error).toBeNull();
    expect(cert.trialTick.propagationCovered).toBe(true); // 这条路**确实**调了传导核
    expect(cert.trialTick.propagationRulesFired).toBe(2);
    expect(cert.trialTick.propagationRulesDeclared).toBe(2); // 分母也报
    // 真跑且全触发 ⇒ 不该报"全哑火"，也不该报"未覆盖"。
    const codes = cert.gaps.map((x) => x.gapCode);
    expect(codes).not.toContain("PROPAGATION_ALL_SILENT");
    expect(codes).not.toContain("PROPAGATION_NOT_COVERED");
  });

  it("②b 分母的意义：`declared` 与 `fired` 是两个数——同一批规则，只改源态就能让 fired 掉到 0 而 declared 不变", async () => {
    const t = await makeApp();
    const TEN = "recon2b";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    // 源态全 0 ⇒ `propagateTick` 的 `if (sourceVal === 0) continue` ⇒ 一条都不触发，
    // 但已发布规则数**没变**。只报 fired 的话，这个世界与"根本没有传导规则"长得一模一样。
    const silent = await certify(t, TEN, "scope=GLOBAL", { a1: { flow: 0 }, b1: { flow: 0, load: 0 }, c1: { load: 0 } });
    expect(silent.trialTick.propagationRulesDeclared).toBe(2); // 分母不变
    expect(silent.trialTick.propagationRulesFired).toBe(0); // 分子归零
    expect(silent.trialTick.propagationCovered).toBe(true); // 确实跑过了（不是"没跑"）
  });

  it("②c 病样必须看得见：declared>0 且 fired===0 ⇒ gaps 里有 PROPAGATION_ALL_SILENT（不是一个静默的 0）", async () => {
    const t = await makeApp();
    const TEN = "recon2c";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    const silent = await certify(t, TEN, "scope=GLOBAL", { a1: { flow: 0 }, b1: { flow: 0, load: 0 }, c1: { load: 0 } });
    const gap = silent.gaps.find((x) => x.gapCode === "PROPAGATION_ALL_SILENT");
    expect(gap, "已发布传导规则却一条都没触发 —— 这必须显式报出来，不许被一个 0 盖住").toBeDefined();
    expect(gap!.detail).toContain("2"); // 报出分母，让人知道"本来该有多少"

    // 对照组：**没有**传导规则的租户 ⇒ declared=0 ⇒ 这不是病，不许报。
    const TEN2 = "recon2c2";
    await threeNodeWorld(t, TEN2);
    await enable(t, TEN2);
    const bare = await certify(t, TEN2, "scope=GLOBAL");
    expect(bare.trialTick.propagationRulesDeclared).toBe(0);
    expect(bare.trialTick.propagationRulesFired).toBe(0);
    expect(bare.gaps.map((x) => x.gapCode)).not.toContain("PROPAGATION_ALL_SILENT");
    // ⇒ 「本来就没规则」与「有规则但全哑火」两个 0 现在**分得开**了。这正是分母存在的理由。
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("WO-CERT-CONTRACT-RECONCILE ③ 派生那个数名副其实（规模 ≠ 触发）", () => {
  it("③ 取证：`recompute` 的 order.length 在「零求值」与「真求值」两趟里**同一个数** ⇒ 它是规模不是触发数", async () => {
    const t = await makeApp({ seed: false });
    const TEN = "recon3";
    const ctx = { tenantId: TEN, userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.ontologyTypes.put({
      id: `otype_Order_${TEN}`, tenantId: TEN, key: "Order", displayName: "Order",
      properties: [{ propKey: "qty", dataType: "number" }, { propKey: "unitPrice", dataType: "number" }] as never,
      derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
    await t.repos.objects.put({ id: "o1", tenantId: TEN, type: "Order", props: { qty: 3, unitPrice: 7 }, origin: ORG });
    // 两条派生规格，`total` 依赖 `value` ⇒ 图里有一条真实排序边。
    await t.services.ontologyCore.compileSpecs(ctx, 1, [
      { specKey: "order_value", targetType: "Order", targetProp: "value", formula: "this.qty * this.unitPrice" },
      { specKey: "order_total", targetType: "Order", targetProp: "total", formula: "this.value + 1" },
    ]);

    // ① 空变更集 = **认证路的实参**（`app.ts` 传 `[]`）。
    const empty = await t.services.ontologyCore.recompute(ctx, [], { dryRun: true });
    // ② 非空变更集 ⇒ 真的会求值。
    const fired = await t.services.ontologyCore.recompute(ctx, [{ typeKey: "Order", prop: "qty", objectIds: ["o1"] }], { dryRun: true });

    // 头号判据：**同一个数**。若它度量的是"本次触发了几条"，空变更集下必须是 0。
    expect(empty.order.length).toBe(2);
    expect(fired.order.length).toBe(2);
    expect(empty.order.length).toBe(fired.order.length);
    // 而真正的"触发"在这两趟里**是不同的**：空变更集零求值，非空变更集有求值。
    expect(empty.updatedObjects).toBe(0);
    expect(empty.dryRunDeltas ?? []).toHaveLength(0);
    expect(fired.updatedObjects).toBeGreaterThan(0);
    expect(fired.dryRunDeltas ?? []).not.toHaveLength(0);
    // ⇒ order.length 与"触发"正交 ⇒ 它是**图的规模**。字段名 `derivationNodes` 名副其实。
  });

  it("③ 端到端：认证下发的 derivationNodes == 派生图规模，且**不随源态/触发情况变**", async () => {
    const t = await makeApp({ seed: false });
    const TEN = "recon3b";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);
    const ctx = { tenantId: TEN, userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.objects.put({ id: "a1", tenantId: TEN, type: "TypeA", props: { qty: 2 }, origin: ORG });
    await t.services.ontologyCore.compileSpecs(ctx, 1, [
      { specKey: "a_twice", targetType: "TypeA", targetProp: "twice", formula: "this.qty * 2" },
    ]);

    // 两次认证：源态一次有料、一次全 0 —— 世界的"活跃度"截然不同。
    const live = await certify(t, TEN, "scope=GLOBAL");
    const dead = await certify(t, TEN, "scope=GLOBAL", { a1: { flow: 0 }, b1: { flow: 0, load: 0 }, c1: { load: 0 } });

    // 判据只咬**派生那一个数**：它是规模 ⇒ 世界活跃与否都不该动它。
    // ⚠ 本例**刻意不断言传导计数**（那是 ②b 的活）——两条判据共用一个观测量的话，
    //   变异反证就分辨不出"是派生口径坏了"还是"是传导计数坏了"。判据要能各自指认病灶。
    expect(live.trialTick.derivationNodes).toBe(1); // 本租户恰有 1 条 ACTIVE 派生规格
    expect(dead.trialTick.derivationNodes).toBe(1);
    expect(live.trialTick.derivationNodes).toBe(dead.trialTick.derivationNodes);
  });

  it("③ 过渡字段可回退：deprecated 的 rulesFired 仍下发，且恒等于「规模 + 触发」（老消费方不破）", async () => {
    const t = await makeApp();
    const TEN = "recon3c";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishTwoRules(t, TEN);

    const cert = await certify(t, TEN, "scope=GLOBAL");
    expect(cert.trialTick.rulesFired).toBe(cert.trialTick.derivationNodes! + cert.trialTick.propagationRulesFired!);
    expect(cert.trialTick.derivationRulesFired).toBe(cert.trialTick.derivationNodes);
    // ⚠ 这条断言**不是**在给旧口径背书：它只保证过渡期老消费方读到的数与本单之前逐字节相同。
    //   契约里两个字段都已标 @deprecated 并写明可删条件；新代码一律读上面那三个诚实字段。
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("WO-CERT-CONTRACT-RECONCILE ④ 传导相入参只有唯一装配处（tick 路与认证路同源）", () => {
  /**
   * 判据设计：挑两样**认证路曾经各装配一遍**的东西，让它们成为"触发/不触发"的分水岭 ——
   *  · 规则参数：规则内联 `coefficient: 0` + `coefficientRef` 指向一条 params 给非零系数的规则。
   *    装配了 ruleParams ⇒ 有效系数非零 ⇒ 触发；漏了 ⇒ 退回内联 0 ⇒ `amount===0` ⇒ **不触发**。
   *  · 节拍闸门：规则声明 `cadenceNodeId`，且对象库里有对应 Cadence 行。
   *    装配了 gates ⇒ 闸门解析得到 ⇒ 触发；漏了 ⇒ `gates[id]===undefined` ⇒ `continue` ⇒ **不触发**。
   * 两者都是**效果层**分水岭：认证路只要绕开 `buildPropagationInputs` 少装一样，计数立刻掉下来。
   */
  it("④ 认证路与 tick 路同源：走 coefficientRef 的规则 与 挂节拍闸门的规则，在**认证 Trial Tick 里同样触发**", async () => {
    const t = await makeApp();
    const TEN = "recon4";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);

    // (a) 规则参数单源：业务规则 C_COEF 的 params 提供真系数；传导规则内联系数为 0。
    await t.repos.rules.put({
      id: "rule_coef", tenantId: TEN, key: "C_COEF", name: "接缝门·系数来源",
      expression: "noop", scopeObjectTypes: ["TypeA"], severity: "INFO",
      params: { feedCoeff: 2 }, origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED",
    } as never);
    expect((await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H(TEN),
      payload: {
        key: "r_byref", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeB", targetStateVar: "load",
        coefficient: 0, // ← 内联为 0：漏了 ruleParams 就会退回它 ⇒ amount===0 ⇒ 不触发
        coefficientRef: { ruleKey: "C_COEF", paramKey: "feedCoeff" },
        delayTicks: 0, status: "PUBLISHED",
      },
    })).statusCode).toBe(201);

    // (b) 节拍闸门单源：Cadence 行落库（用**已在册**的 nodeId，不新增注册表条目）。
    //     everyDays=1 ⇒ 每 tick 都开闸 ⇒ 闸门取得到就必然即时放行（判据不依赖相位）。
    //     ⚠ 字段名是 `cadenceKind` 不是 `kind`，且 dataMode 必须是 SYNTHETIC ——
    //       这是 D1 声明的唯一读回口 `cadenceFromProps` 的口径，写错会让整趟 Trial Tick 抛错
    //       （诚实标 passed:false，不静默兜底）。本单实测踩过一次，留个记号免得下一个人再踩。
    await t.repos.objects.put({
      id: "obj_cadence_demand_consensus", tenantId: TEN, type: "Cadence",
      props: { nodeId: "demand.consensus", everyDays: 1, offsetDays: 0, cadenceKind: "meeting", dataMode: "SYNTHETIC" }, origin: ORG,
    });
    expect((await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H(TEN),
      payload: {
        key: "r_gated", sourceTypeKey: "TypeB", sourceStateVar: "flow", viaLinkKey: "FEEDS",
        targetTypeKey: "TypeC", targetStateVar: "load", coefficient: 1, delayTicks: 0,
        cadenceNodeId: "demand.consensus", // ← 漏了 gates 就取不到闸门 ⇒ continue ⇒ 不触发
        status: "PUBLISHED",
      },
    })).statusCode).toBe(201);

    const cert = await certify(t, TEN, "scope=GLOBAL");

    // 头号判据：两条都触发了 ⇒ 认证路确实拿到了 **ruleParams** 与 **cadenceGates**。
    // 少装任一样，这个数就是 1 而不是 2（而且哪一条掉了，下面两条分断言直接指出来）。
    expect(cert.trialTick.propagationRulesDeclared).toBe(2);
    expect(cert.trialTick.propagationRulesFired, "认证路少装了 ruleParams 或 cadenceGates").toBe(2);

    // tick 路的对照：同一份世界跑真 tick，两条规则的效果都真的落在世界态上
    // ⇒ 两条路对同一份入参得出同一结论（这就是"同源"的效果层定义）。
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: H(TEN),
      payload: { baseSnapshot: BASE, scope: { kind: "GLOBAL" } },
    })).json()).id as string;
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H(TEN), payload: { n: 1 } });
    expect(tick.statusCode).toBe(200);
    const state = (tick.json() as { state: Record<string, Record<string, number>> }).state;
    // r_byref：系数取自 C_COEF.params.feedCoeff = 2 ⇒ b1.load = 2 × a1.flow(10) = 20
    // （若 ruleParams 没装配，这里会是 0 —— 内联系数）。
    expect(state.b1!.load).toBe(20);
    // r_gated：闸门 everyDays=1 ⇒ 每 tick 开闸 ⇒ c1.load = 1 × b1.flow(5) = 5
    // （若 gates 没装配，规则被 `continue` 跳过，这里会是 0）。
    expect(state.c1!.load).toBe(5);
  });

  it("④ 结构判据：全仓只有一处装配传导相入参（新增第二处 = 两条路会静默分家）", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const inputs = readFileSync(new URL("../src/sim/propagation-inputs.ts", import.meta.url), "utf8");

    // 金丝雀：先证明这个扫描确实能命中已知存在的东西（否则"0 命中"不可信）。
    expect(app.length, "app.ts 读到空内容 —— 路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(app).toContain("buildPropagationInputs"); // 金丝雀命中
    expect(inputs).toContain("buildCadenceGates"); // 金丝雀命中

    // 判据：装配三件套的调用只出现在**唯一装配处**，app.ts 里一处都没有。
    for (const sym of ["buildCadenceGates(", "scopePropagationGraph(", "resolveSimScope("]) {
      expect(
        app.includes(sym),
        `app.ts 里出现了 ${sym} —— 传导相入参又被装配了第二遍。` +
        `两份今天可能恰好等价，但那是巧合不是机制：任一边改个过滤条件就会静默分家，而两边测试都仍然绿。` +
        `请改走 sim/propagation-inputs.ts 的 buildPropagationInputs。`,
      ).toBe(false);
    }
    // 且唯一装配处**确实**把三件套都装了（否则"只有一处"是靠少做事换来的）。
    for (const sym of ["buildCadenceGates(", "scopePropagationGraph(", "resolveSimScope("]) {
      expect(inputs, `唯一装配处漏装 ${sym}`).toContain(sym);
    }
  });
});
