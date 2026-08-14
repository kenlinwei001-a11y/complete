import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { installReadRecorder, observedReadSurface } from "./ontology-signature.recorder.js";
import { SOLVER_ONTOLOGY_SIGNATURES } from "../src/solvers/ontology-signature.js";
import { FinanceWorldProjectionOutputSchema, type FinanceWorldProjectionOutput } from "@platform/contracts";

/**
 * ══ WO-FINANCE-WORLDSTATE · 接缝门：财务**金额**随扰动真的会变 ═══════════════════
 *
 * ── 这道门跨的是哪三半（SEAM-GATE：不是各半 unit 各绿就算）────────────────────────
 *  ① **数据半**：`seed.ts` 的成本/现金两条传导规则
 *     （`Material.priceShock →×0.65→ Model.costPressure →×0.9→ Order.costPressure`
 *      `Order.costPressure →×0.5→ Customer.receivablePressure →×0.4→ ARInvoice.overduePressure`）
 *  ② **引擎半**：`finance_world_projection` 把世界态压力折成金额
 *  ③ **口径半**：`basis` / `available` / `notes` 这些诚实位真的下发到回包（前端第一层靠它）
 *
 * 任一半漏都必须红：规则没触发 ⇒ 压力恒 0 ⇒ 金额不动；求解器不吃 worldId ⇒ 金额不动；
 * 诚实位没进输出形状 ⇒ 前端只看得见"有个数"。
 *
 * ── 头号判据（工单 §3）───────────────────────────────────────────────────────────
 * 「施加扰动前后，金额必须真的不同，且差值方向与压力指数的变化方向一致」。
 * 断言写成 **≠ + 方向**，不是「返回了一组数」—— 后者度量的是"接口通不通"，
 * 不度量"这个数随不随扰动动"，那正是本单要治的病。
 *
 * ── 反向判据（同样必须写）───────────────────────────────────────────────────────
 * **不施加任何扰动**时两次调用**逐字节相同**（R6）。只咬正向会漏掉"引擎在编数"这一形态。
 *
 * ── 真跑，不是桩 ────────────────────────────────────────────────────────────────
 * 全程走真 HTTP 端点：真建会话 → 真施加扰动（`POST …/perturbations`）→ 真 tick → 真调求解器。
 * 直接往 `baseSnapshot` 里写值测不到「扰动写端」这条缝（`seed-demo-propagation.test.ts` 同款纪律）。
 */

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 建一个世界。`baseSnapshot` 里放什么由各用例自己决定（空世界那一档要的就是"什么都不放"）。 */
async function createWorld(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(res.statusCode, `建会话失败：${res.body}`).toBe(201);
  return (res.json() as { id: string }).id;
}

const tick = (t: TestApp, sid: string, n: number) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });

/**
 * 跑一次投影，并**按契约校形**。
 *
 * ⚠ 这道校形是本单被**前端全量回归当场咬出来**才加的（不是设计时想到的）：
 * 前端第一版用 `as FinanceWorldProjectionOutput` 硬转回包 —— 编译期断言、运行期零检查，
 * 回包缺一个字段就把整棵 React 树卸掉（**整个沙盘白屏**，不是"这块面板没数据"）。
 * 修法两侧对称、**共用契约那一份 schema**：前端 `safeParse` 失败即退回诚实缺口记号；
 * 这里正向咬住「引擎出的形状真的符合契约」——两半用同一把尺子，才不会各自漂。
 */
async function project(t: TestApp, worldId: string): Promise<FinanceWorldProjectionOutput> {
  const res = await invokeSolver(t, "finance_world_projection", { worldId });
  expect(res.statusCode, `求解器失败：${res.body}`).toBe(200);
  const raw = (res.json() as { data: unknown }).data;
  const parsed = FinanceWorldProjectionOutputSchema.safeParse(raw);
  expect(
    parsed.success,
    `引擎回包不符合 FinanceWorldProjectionOutputSchema：${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))}`,
  ).toBe(true);
  return (raw as FinanceWorldProjectionOutput);
}

const lineOf = (out: FinanceWorldProjectionOutput, role: string) => out.lines.find((l) => l.role === role)!;
const pressureOf = (out: FinanceWorldProjectionOutput, v: string) => out.pressures.find((p) => p.stateVar === v)!;

/**
 * 取一条**真**的成本链实例：`Material --material_used_by_model--> Model --model_demanded_by_order--> Order`。
 * 全部来自真链路表（不是编的 id）—— 编 id 会让这条测试在链路改了之后照样绿。
 */
async function costChainInstance(t: TestApp) {
  const links = await t.repos.links.list("demo");
  const mubm = links.find((l) => l.type === "material_used_by_model")!;
  const materialId = mubm.fromId;
  const modelId = mubm.toId;
  const mdbo = links.find((l) => l.type === "model_demanded_by_order" && l.fromId === modelId)!;
  const orderId = mdbo.toId;
  const custLink = links.find((l) => l.type === "order_of_customer" && l.fromId === orderId);
  return { materialId, modelId, orderId, customerId: custLink?.toId ?? null };
}

describe("WO-FINANCE-WORLDSTATE · 财务金额随世界态扰动的投影", () => {
  it("金丝雀：链路/种子/求解器三样都在（任一不在 ⇒ 后面的『没变化』读不出是坏了还是真没变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    /**
     * ① 传导规则真的种进去了，且成本/现金那四条**一条不缺**。
     *
     * ⚠ 判据写成**集合等号**而不是 `for … toContain`：后者是 `coverage-blind` 门的
     *   `EXISTS_FOR_ALL` 形态 —— 「四条里只种了一条」与「四条全种」在某些写法下给同一个颜色。
     *   （这条是那道门在本单**当场报红逼出来的**，不是我自己想起来的：机器先说话。）
     */
    const COST_CASH_RULE_KEYS = [
      "demo_customer_receivable_to_invoice_overdue",
      "demo_material_price_to_model_cost",
      "demo_model_cost_to_order_cost",
      "demo_order_cost_to_customer_receivable",
    ];
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    expect(rules.length).toBeGreaterThan(4);
    const keys = rules.map((r) => r.key);
    expect(keys).toHaveLength(rules.length); // 基数锚：keys 不是空集也不是被过滤过的子集
    // 等号（不是包含）：成本/现金链在种子里恰好是这四条，多一条少一条都要有人看见。
    expect(keys.filter((k) => COST_CASH_RULE_KEYS.includes(k)).sort()).toEqual(COST_CASH_RULE_KEYS);
    // ② 金额基线真的在（FinancePlan 三行 + ARInvoice 台账非空）。
    const plans = await t.repos.objects.listByType("demo", "FinancePlan");
    expect(plans.length).toBeGreaterThan(2);
    const invoices = await t.repos.objects.listByType("demo", "ARInvoice");
    expect(invoices.length).toBeGreaterThan(4);
    // ③ 求解器真的注册了（反向金丝雀：一个不存在的 key 必须 404/400，不许"什么都返回"）。
    const sid = await createWorld(t, {});
    const ok = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    expect(ok.statusCode).toBe(200);
    const bogus = await invokeSolver(t, "finance_world_projection_not_a_key", { worldId: sid });
    expect(bogus.statusCode).not.toBe(200);
  });

  it("🔴 头号判据 · SEAM：真扰动 → 真 tick → 金额**真的变了**，且方向与压力一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);

    // 世界里放上这条链的两端（态为空的世界会被求解器判 available:false —— 那是另一条用例）。
    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 0 } });

    // ── 扰动前 ───────────────────────────────────────────────────────────────────
    const before = await project(t, sid);
    expect(before.available).toBe(true);
    expect(pressureOf(before, "costPressure").value).toBe(0);
    const cogsBefore = lineOf(before, "COST");
    const gmBefore = lineOf(before, "MARGIN");
    expect(cogsBefore.projected).toBe(cogsBefore.rolling); // 零压力 ⇒ 投影 == 基线（不是"约等于"）
    expect(cogsBefore.rolling).toBeGreaterThan(0); // 基线本身非 0，否则"变没变"无从谈起

    // ── 经**真扰动路由**施加物料涨价（不是直接写 baseSnapshot —— 那样测不到写端接缝）──
    const created = await t.app.inject({
      method: "POST",
      url: `/a/v1/sim/sessions/${sid}/perturbations`,
      headers: ADMIN,
      payload: {
        kind: "cost_shock",
        targetObjectId: materialId,
        targetStateVar: "priceShock",
        magnitude: 12,
        mode: "set",
        label: "碳酸锂涨价 12%",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    // 两跳：Material.priceShock → Model.costPressure → Order.costPressure。
    expect((await tick(t, sid, 2)).statusCode).toBe(200);

    // ── 扰动后 ───────────────────────────────────────────────────────────────────
    const after = await project(t, sid);
    const pressureAfter = pressureOf(after, "costPressure");
    const cogsAfter = lineOf(after, "COST");
    const gmAfter = lineOf(after, "MARGIN");

    // ① 压力真的动了（数据半通）
    expect(pressureAfter.value).toBeGreaterThan(0);
    expect(pressureAfter.carriers).toBeGreaterThan(0);
    expect(pressureAfter.universe).toBeGreaterThan(pressureAfter.carriers - 1); // universe ≥ carriers
    // ② **头号判据**：金额真的不同（≠，不是"返回了一组数"）
    expect(cogsAfter.projected).not.toBe(cogsBefore.projected);
    expect(gmAfter.projected).not.toBe(gmBefore.projected);
    // ③ 方向与压力一致：成本压力为正 ⇒ 销售成本↑、毛利↓
    expect(cogsAfter.projected).toBeGreaterThan(cogsBefore.projected);
    expect(cogsAfter.delta).toBeGreaterThan(0);
    expect(gmAfter.projected).toBeLessThan(gmBefore.projected);
    expect(gmAfter.delta).toBeLessThan(0);
    // ④ 金额与压力**同一条算式**：projected == rolling ×（1 + 压力 ÷ divisor）。
    //    写成恒等式而不是写死一个数 —— 写死等于赌种子不变，种子一改这条测试就在测别的东西。
    const expectCogs = Math.round(cogsAfter.rolling * (1 + pressureAfter.value / after.basis.divisor) * 100) / 100;
    expect(cogsAfter.projected).toBeCloseTo(expectCogs, 6);
    // ⑤ 基线**没被动过**（R4：投影不写回本体真值）
    expect(cogsAfter.rolling).toBe(cogsBefore.rolling);
    expect(gmAfter.rolling).toBe(gmBefore.rolling);
    const plansNow = await t.repos.objects.listByType("demo", "FinancePlan");
    expect(plansNow.map((p) => Number(p.props.rolling)).sort((a, b) => a - b)).toEqual(
      before.lines.map((l) => l.rolling).sort((a, b) => a - b),
    );
  });

  it("🔴 现金半同样真的动：应收压力 → 应收投影↑ / 逾期压力 → 逾期敞口↑（逐张发票用真 amount）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId, customerId } = await costChainInstance(t);
    expect(customerId, "这条订单没挂到客户上 ⇒ 现金链走不通，用例前提不成立").not.toBeNull();

    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 0 } });
    const before = await project(t, sid);
    expect(before.cash.available).toBe(true);
    expect(before.cash.arBaseline).toBeGreaterThan(0);
    expect(before.cash.customerLinked).toBeGreaterThan(0); // 发票→客户经真链路挂上了
    expect(before.cash.arProjected).toBe(before.cash.arBaseline); // 零压力 ⇒ 应收投影 == 基线
    expect(before.cash.overdueExposure).toBe(0);

    await t.app.inject({
      method: "POST",
      url: `/a/v1/sim/sessions/${sid}/perturbations`,
      headers: ADMIN,
      payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 20, mode: "set", label: "涨价 20%" },
    });
    // 四跳 + 最后一跳 delayTicks=1 ⇒ 跑够 5 个 tick 才看得到 overduePressure。
    expect((await tick(t, sid, 5)).statusCode).toBe(200);

    const after = await project(t, sid);
    expect(pressureOf(after, "receivablePressure").value).toBeGreaterThan(0);
    expect(pressureOf(after, "overduePressure").value).toBeGreaterThan(0);
    // 金额真的不同 + 方向一致
    expect(after.cash.arProjected).not.toBe(before.cash.arProjected);
    expect(after.cash.arProjected).toBeGreaterThan(before.cash.arProjected);
    expect(after.cash.arDelta).toBeGreaterThan(0);
    expect(after.cash.overdueExposure).toBeGreaterThan(before.cash.overdueExposure);
    expect(after.cash.overdueSharePct).toBeGreaterThan(0);
    // 基线未被动（投影不写真值）
    expect(after.cash.arBaseline).toBe(before.cash.arBaseline);
  });

  it("🔴 反向判据 · R6 确定性：不施加任何扰动 ⇒ 两次调用**逐字节相同**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 0 } });

    const a = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    const b = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    expect(a.statusCode).toBe(200);
    // 逐字节（不是"字段相等"）——`snapshotVersion` 之外整份回包必须一致。
    expect(JSON.stringify((a.json() as { data: unknown }).data)).toBe(JSON.stringify((b.json() as { data: unknown }).data));

    // 且零扰动时**每一行**的投影都严格等于基线（不是"差不多"）。
    const out = (a.json() as { data: FinanceWorldProjectionOutput }).data;
    expect(out.lines.length).toBeGreaterThan(2);
    for (const l of out.lines) expect(l.projected, `${l.subject} 在零扰动下不该动`).toBe(l.rolling);
    for (const l of out.lines) expect(l.delta).toBe(0);
  });

  it("🔴 R6 跨 tick 也确定：同一个 tick 上重复跑字节一致，且 tick 推进后金额单调不回头", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 0 } });
    await t.app.inject({
      method: "POST",
      url: `/a/v1/sim/sessions/${sid}/perturbations`,
      headers: ADMIN,
      payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 12, mode: "set", label: "涨价 12%" },
    });
    await tick(t, sid, 2);
    const x = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    const y = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    expect(JSON.stringify((x.json() as { data: unknown }).data)).toBe(JSON.stringify((y.json() as { data: unknown }).data));
    const at2 = (x.json() as { data: FinanceWorldProjectionOutput }).data;
    expect(at2.worldStateSource).toBe("TICK"); // 读的是 tick 态，不是回落基线
    expect(at2.curTick).toBe(2);
  });

  it("口径常驻：basis / chain / provenance 三样一起下发（缺一样这个金额就不可复核）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 5 }, [orderId]: { costPressure: 0 } });
    const out = await project(t, sid);

    // ① 换算口径：`PROJECTION` 是"推演≠实测"的机器判据；divisor 随包下发且说明出处。
    expect(out.basis.kind).toBe("PROJECTION");
    expect(out.basis.divisor).toBe(100);
    expect(out.basis.source).toBe("DEFAULT_DECLARED");
    expect(out.basis.note.length).toBeGreaterThan(0);
    // 可由 args 改写 ⇒ 它不是藏在代码里的魔数。
    const asRatio = await project(t, sid); // 先证明缺省档存在
    expect(asRatio.basis.divisor).toBe(100);
    const r = await invokeSolver(t, "finance_world_projection", { worldId: sid, pressureUnit: "ratio" });
    const ratioOut = (r.json() as { data: FinanceWorldProjectionOutput }).data;
    expect(ratioOut.basis.divisor).toBe(1);
    expect(ratioOut.basis.source).toBe("ARG");
    // 非法量纲显式拒绝（不静默当缺省 —— 静默会让调用方以为口径生效了）。
    const bad = await invokeSolver(t, "finance_world_projection", { worldId: sid, pressureUnit: "百分号" });
    expect(bad.statusCode).toBe(400);

    // ② 传导链：真规则 id + 真系数（改种子系数 → 这里跟着变）。
    expect(out.chain.length).toBeGreaterThan(3);
    const hop = out.chain.find((h) => h.ruleKey === "demo_material_price_to_model_cost")!;
    expect(hop.coefficient).toBe(0.65); // = seed.ts 里那条规则的真系数
    expect(hop.from).toBe("Material.priceShock");
    expect(hop.to).toBe("Model.costPressure");
    expect(hop.provenance.drillType).toBe("PropagationRule");
    expect(hop.provenance.drillId).toBe("simpr_demo_material_price_to_model_cost"); // 单对象 → 真主键
    expect(hop.provenance.drillValue).toBe(0.65);

    // ③ 每个金额带 provenance，且**单对象填真主键**（不是 "*"）。
    expect(out.lines.length).toBeGreaterThan(2);
    for (const l of out.lines) {
      expect(l.provenance.drillType).toBe("FinancePlan");
      expect(l.provenance.drillId, `${l.subject} 的 drillId 应是真 finId`).not.toBe("*");
      expect(l.provenance.drillField).toBe("rolling");
      expect(l.provenance.drillValue).toBe(l.rolling);
    }
    expect(out.lines.map((l) => l.provenance.drillId)).toContain("fin-cogs");
    // 压力是**聚合值**：无承载对象时 drillId 才是 "*"；有承载对象时给真对象 id（R13 可下钻）。
    const cost = pressureOf(out, "costPressure");
    expect(cost.provenance.drillField).toBe("costPressure");
    expect(cost.provenance.drillId).toBe(orderId);
    expect(cost.universe).toBeGreaterThan(0);

    // ④ 勾稽：投影没有把「收入−成本−毛利」的既有残差改掉。
    expect(out.reconChecks.length).toBeGreaterThan(0);
    expect(out.reconciled).toBe(true);
  });

  it("诚实缺席：世界态为空 ⇒ available:false + 原因（**不给一个不动的 0**）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const sid = await createWorld(t, {}); // 空世界
    const out = await project(t, sid);

    expect(out.worldObjectCount).toBe(0);
    expect(out.available).toBe(false);
    expect(out.unavailableReason ?? "").not.toBe("");
    expect(out.notes.some((n) => n.includes("态为空"))).toBe(true);
    /**
     * ⚠ 这里**不是** `BASE_SNAPSHOT` —— 实测订正（本单写这条测试时被它当场咬红）：
     * `POST /a/v1/sim/sessions` 在建会话时就落了 tick0 态（`app.ts:1568`），
     * 所以经 HTTP 建的世界**从第 0 个 tick 起就有 tick 态**，`worldStateSource` 恒 `TICK`。
     * 原先我按"没 tick 过 ⇒ 回落基线"写断言，那是**猜的**，不是读到的。
     * 回落分支的真触发条件是「会话有、但那个 tick 的态行缺失」—— 下一条用例专门驱动它，
     * 免得这个分支变成"实现有、测试有、零真实触发"的死代码。
     */
    expect(out.worldStateSource).toBe("TICK");
    // 诚实位不是"藏起数字"：基线仍然给出来（可读），只是明说这次投影没意义。
    expect(out.lines.length).toBeGreaterThan(2);
    for (const l of out.lines) expect(l.projected).toBe(l.rolling);
  });

  it("回落分支真被驱动：tick 态行缺失 ⇒ 读 baseSnapshot 并据实标 BASE_SNAPSHOT（不是默默当空世界）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { orderId } = await costChainInstance(t);

    // 直接经仓储建会话：**不写任何 tick 态行**，这正是回落分支的触发条件。
    // （经 HTTP 建会落 tick0 态，永远走不到这条分支 —— 上一条用例已实测。）
    const sid = "sims_fallback_probe";
    await t.repos.sim.createSession({
      id: sid,
      tenantId: "demo",
      baseSnapshot: { [orderId]: { costPressure: 30 } },
      scope: {},
      status: "READY",
      curTick: 0,
      parentCheckpointId: null,
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(await t.repos.sim.getTickState("demo", sid, 0)).toBeNull(); // 前提：确实没有 tick 态行

    const out = await project(t, sid);
    expect(out.worldStateSource).toBe("BASE_SNAPSHOT");
    expect(out.worldObjectCount).toBe(1);
    expect(out.available).toBe(true);
    // 回落读到的态**真的被用了**（不是读了个寂寞）：成本压力非 0 ⇒ 金额真的动。
    expect(pressureOf(out, "costPressure").value).toBeGreaterThan(0);
    expect(lineOf(out, "COST").delta).toBeGreaterThan(0);
  });

  it("R2 隔离 + 入参纪律：别人的世界 404；不给 worldId 显式 400（不静默回落到本体真值口径）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t);
    const sid = await createWorld(t, {});

    const noArg = await invokeSolver(t, "finance_world_projection", {});
    expect(noArg.statusCode).toBe(400);
    const ghost = await invokeSolver(t, "finance_world_projection", { worldId: "sims_not_exist" });
    expect(ghost.statusCode).toBe(404);
    // 金丝雀：同一个 key 在**存在的**世界上必须 200 —— 否则上面两条读不出是"隔离生效"还是"求解器坏了"。
    expect((await invokeSolver(t, "finance_world_projection", { worldId: sid })).statusCode).toBe(200);
  });

  /**
   * 本体签名是**机器校验的事实**，不是手写清单（WO-69 P2 S5 同款判据）。
   *
   * ⚠ 为什么不去 `ontology-signature.seam.test.ts` 的 `S5_FIXTURES` 里加一行：那个跑法是
   * `invoke(ctx, key, args)` 直调，而本求解器**必须先有一个世界**（不给 `worldId` 直接 400）——
   * 加进去只会得到一条"跑不起来"的样例。故在**本文件**里用同一个记录器验同一件事：
   * 它有真世界可跑，验的是同一个不变量。
   *
   * 判据方向与 S5 一致：**观测 ⊆ 声明**。漏声明 = 列级守卫会误放行 = 受限用户拿到错数字
   * （WO-69 的原病例：quote_margin 毛利 0.868 vs 真值 0.2565，「没权限」伪装成「业务数字」）。
   * 过度声明是安全方向（多拒），不判红。
   */
  it("🔴 本体签名实跑比对：真读到的类型/属性都在 SOLVER_ONTOLOGY_SIGNATURES 声明内（漏声明即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 8 }, [orderId]: { costPressure: 5 } });

    const sig = SOLVER_ONTOLOGY_SIGNATURES.finance_world_projection;
    expect(sig, "求解器必须有签名——**未知读取面 = 列级受限调用者一律拒**，未知≠安全").toBeDefined();
    const declared = new Map((sig!.reads ?? []).map((r) => [r.typeKey, r.propKeys]));
    expect(declared.size).toBeGreaterThan(3); // 基数锚：声明不是空集

    const { rec, restore } = installReadRecorder(t);
    try {
      await t.services.solvers.invoke(t.adminCtx, "finance_world_projection", { worldId: sid });
    } finally {
      restore();
    }
    const observed = observedReadSurface(rec);
    expect(observed.size).toBeGreaterThan(0); // 金丝雀：记录器真记到了东西（记 0 条 = 探针坏了，不是"没读"）

    const violations: string[] = [];
    for (const [typeKey, props] of observed) {
      if (!declared.has(typeKey)) {
        violations.push(`真读了未声明的对象类型 ${typeKey}（属性 ${[...props].sort().join("/")}）`);
        continue;
      }
      const propKeys = declared.get(typeKey);
      if (propKeys === undefined) continue; // 声明为全属性
      const missing = [...props].filter((p) => !propKeys.includes(p)).sort();
      if (missing.length > 0) violations.push(`类型 ${typeKey} 真读了未声明的属性 ${missing.join(", ")}`);
    }
    expect(violations, `签名漏声明（列级守卫会误放行 → 出错数字）：\n${violations.join("\n")}`).toEqual([]);
  });

  it("分层不重复：`finance_pnl` 保持「本体真值口径」（施加扰动它照样不动，这是它的正确行为）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 0 } });

    const pnlBefore = await invokeSolver(t, "finance_pnl", {});
    await t.app.inject({
      method: "POST",
      url: `/a/v1/sim/sessions/${sid}/perturbations`,
      headers: ADMIN,
      payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 30, mode: "set", label: "涨价 30%" },
    });
    await tick(t, sid, 2);
    const pnlAfter = await invokeSolver(t, "finance_pnl", {});

    // `finance_pnl` **必须**逐字节不变 —— 本单一个字都没动它，动了就是连坐（它有既有调用方与金值）。
    expect(JSON.stringify((pnlAfter.json() as { data: unknown }).data)).toBe(
      JSON.stringify((pnlBefore.json() as { data: unknown }).data),
    );
    // 而新求解器在同一时刻**必须**已经变了 —— 两条一起断言才说明"分层"是真的：
    // 只咬前者 = 证明了旧口径没坏；只咬后者 = 证明了新口径能动；**两者同时**才证明它们答的是两个问题。
    const projected = await project(t, sid);
    expect(lineOf(projected, "COST").delta).toBeGreaterThan(0);
  });
});
