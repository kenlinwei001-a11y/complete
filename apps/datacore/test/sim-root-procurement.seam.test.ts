import { describe, expect, it } from "vitest";
import { resolveSimScope, type PropagationRule, type TickState } from "@platform/contracts";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { propagateTick } from "../src/sim/propagation.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import { stateVarDisplayName } from "../src/synthetic/battery.js";

/**
 * WO-SIM-ROOT-PROCUREMENT · **物料采购这个根源**的接缝门（G-ROOT-3）。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
 *
 * **X（改前实测）**：按传导图**入度**分层（入度 0 = 没有上游 = 只能被外部扰动打进来 = 根源），
 * 全世界只有 **3 个根源**：`demandPressure` / `deliveryDelay` / `priceShock`。
 * 而库存侧的 `shortageRisk`（短缺风险）**入度 2 / 出度 6**，是被上游算出来的**枢纽**。
 * ⇒ 想推演「物料采购晚到会怎样」，今天只能去扰 `shortageRisk` —— **从半路插入**：
 * 用户以为在推因，实际在直接改果，推演结论失真。
 *
 * **Y（应该）**：采购到货延迟是**因**，库存短缺是**果**。系统里应有一个入度 0 的
 * `procurementDelay`，扰它才叫扰「物料采购」；`shortageRisk` 从此只当果。
 *
 * ══ 咬的是链路，不是函数（SEAM-GATE：种子数据 × 传导引擎，任一半漏即红）══════════════
 *
 *   种子半：`battery.ts` 声明补货向逆边 + `service.ts` 真物化 + `seed.ts` 三条规则
 *     → `deriveSeedBaseSnapshot` 把 `procurementDelay` 铺进 **`world.state`**
 *   引擎半：`buildPropagationInputs`（唯一装配处）→ `propagateTick` / `POST …/tick`
 *     → `Material.shortageRisk` **真的变了**，且值对得上系数
 *
 * ⚠ **本门最要命的一臂是 ②（落点臂）**，不是 ①。引擎 `propagateTick(graph, **state**, …)
 * 只读 `world.state`，不读对象属性 —— 只在对象属性上加 `procurementDelay` 而不进 `state`，
 * 会得到：用户选「采购延迟 +5 天」→ 请求返回成功 → 引擎读到 `undefined` → **什么都不发生**。
 * 屏上看着施加成功、下游一动不动 = 本仓点名的「静默错答的老形态」。
 * **这种交付比不交付更糟，因为它看起来是好的。** 故本门的验收判据不是「变量登记了」，
 * 是「扰它下游真的动」。
 */

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 本单标的：根源量纲 + 它唯一的下游量纲。写成常量是为了让下面每一处引用同源（改一处即改全部）。 */
const ROOT_VAR = "procurementDelay";
const RESULT_VAR = "shortageRisk";
/** 三类采购台账落点（本单要求它们在 `world.state` 里真带 `procurementDelay`）。 */
const CARRIERS = ["MaterialBatch", "PurchaseOrder", "Supplier"] as const;

/**
 * 状态变量的**现算**入度/出度（在「量纲图」上：一条规则 = `sourceStateVar → targetStateVar` 一条边）。
 *
 * ⚠ **必须现算，不许硬编根源名单**：硬编的名单在下一条边加进来时会**悄悄失效**
 * （那正是 `docs/WO-SIM-ROOT-PERTURB-LAYER.md` §0 记的那次「拿抽取器的数当真实边数」的同族病）。
 * 现算之后，谁哪天加一条 `… → procurementDelay`，它就从根源掉成枢纽，本门当场红。
 */
function varDegrees(rules: readonly PropagationRule[]): Map<string, { in: number; out: number }> {
  const m = new Map<string, { in: number; out: number }>();
  const slot = (v: string) => m.get(v) ?? m.set(v, { in: 0, out: 0 }).get(v)!;
  for (const r of rules) {
    slot(r.sourceStateVar).out += 1;
    slot(r.targetStateVar).in += 1;
  }
  return m;
}

/** 真种子世界（本体对象 + 链路 + 38 条 PUBLISHED 规则 + sim 功能位）。 */
async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

/** 引擎真吃的那张图/那批参数 —— 走**唯一装配处**，绝不在测试里另拼一张（第二套真相源的老坑）。 */
const engineInputs = async (t: TestApp) =>
  buildPropagationInputs(t.repos, t.adminCtx, resolveSimScope({}), await t.repos.sim.listPropagationRules("demo", true));

describe("WO-SIM-ROOT-PROCUREMENT · 物料采购是根源（种子 × 引擎 SEAM）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // ① 入度臂 —— `procurementDelay` 是**根源**（入度 0），不是枢纽
  // ══════════════════════════════════════════════════════════════════════════
  it("① 入度臂：procurementDelay 入度=0（根源）· 出度>0（真能推动东西）· shortageRisk 入度>0（是果不是源）", async () => {
    const t = await seededApp();
    const rules = await t.repos.sim.listPropagationRules("demo", true);

    // 🐤 金丝雀 A（工具自证）：先证明我数的这批边真的非空 —— 空表会让下面每个"入度 0"恒真。
    expect(rules.length, "种子规则为 0 ⇒ 取数坏了，不是『图很干净』").toBeGreaterThan(10);
    const deg = varDegrees(rules);

    // 🐤 金丝雀 B（同一支 `varDegrees`，不另抄一份）：拿一个**已知必中**的根源先跑一遍。
    // 它若也算不对，报的是「度数算法坏了」，**不许**报「procurementDelay 不是根源」。
    // ⚠ 金丝雀原本拿 `demandPressure` 当「已知必中的根源」。**收编 WO-SIM-ROOT-TRIAD 后它不再是根源** ——
    //   G-ROOT-1 有意加了 `forecastBias → demandPressure`（预测偏差带方向、需求压力不带），
    //   把它从根源降级为一级衍生（入度 0 → 1）。那是**有意的模型修正，不是回归**。
    //   故金丝雀改指 `deliveryDelay`：它在两张单之前就存在，且今天仍是入度 0。
    //   ⛔ 不许因为金丝雀红了就把它删掉 —— 它证明的是「度数算法没瞎」，删了就没人证明了。
    expect(deg.get("deliveryDelay"), "金丝雀变量不在图里 ⇒ 度数索引坏了").toBeDefined();
    expect(deg.get("deliveryDelay")!.in, "🐤 金丝雀：既有根源 deliveryDelay 入度必须为 0").toBe(0);
    expect(deg.get("deliveryDelay")!.out).toBeGreaterThan(0);
    // 反向钉住上面那句「降级是有意的」：demandPressure 现在必须**不是**根源。
    expect(deg.get("demandPressure")!.in, "demandPressure 应已被 forecastBias 降级为一级衍生").toBeGreaterThan(0);

    // 🔴 本臂标的（否定结论「入度为 0」与上面的金丝雀命中证据一同给出）。
    const d = deg.get(ROOT_VAR);
    expect(d, `${ROOT_VAR} 压根不在传导图里 ⇒ 种子半没接线`).toBeDefined();
    expect(d!.in, `${ROOT_VAR} 有上游 ⇒ 它已经掉成枢纽，扰它就是从半路插入（本单要治的正是这个）`).toBe(0);
    expect(d!.out, `${ROOT_VAR} 没有下游 ⇒ 扰了不传导（"接了线没数据"的孪生形态）`).toBeGreaterThan(0);

    // 🔴 语义修正：库存从「源」回到「果」—— `shortageRisk` 必须有上游，且上游里**真有** procurementDelay。
    expect(deg.get(RESULT_VAR)!.in, `${RESULT_VAR} 入度为 0 ⇒ 它仍被当成源，本单的语义修正没落地`).toBeGreaterThan(0);
    const rootEdges = rules.filter((r) => r.sourceStateVar === ROOT_VAR);
    expect(rootEdges.every((r) => r.targetStateVar === RESULT_VAR), "根源边必须全部指向 shortageRisk").toBe(true);
    expect([...new Set(rootEdges.map((r) => r.sourceTypeKey))].sort()).toEqual([...CARRIERS]);

    // 中文展示名（`statevar-display-name.seam.test.ts` ④ 也会咬这条；这里就近再钉一次口径）。
    expect(stateVarDisplayName(ROOT_VAR)).toBe("采购到货延迟");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ② 落点臂 —— 三类落点在 **`world.state`** 里真带这个变量（本单最容易假绿的一格）
  // ══════════════════════════════════════════════════════════════════════════
  it("② 落点臂：三类采购台账在 world.state 里真带 procurementDelay 且值非空（不是只在对象属性上有）", async () => {
    const t = await seededApp();
    // 走**播种侧真实现**（`SEED_DEMO=1` 铺 tick0 世界态用的就是这一支），不是测试里手搓一份 state。
    const { state, origin } = await deriveSeedBaseSnapshot(t.repos, "demo");

    // 🐤 金丝雀：世界态本身非空（空 state 会让下面的 `every` 全部恒真）。
    expect(origin.cells, "tick0 世界态零格子 ⇒ 取数坏了").toBeGreaterThan(1000);

    for (const typeKey of CARRIERS) {
      const objs = (await t.repos.objects.listByType("demo", typeKey)).filter((o) => !o.mergedInto);
      // 🐤 金丝雀：这一类真有已物化对象 —— 0 个对象时"每个都带"是句空话。
      expect(objs.length, `${typeKey} 零已物化对象 ⇒ 落点在结构上不成立`).toBeGreaterThan(0);

      const missing: string[] = [];
      const zero: string[] = [];
      for (const o of objs) {
        const v = state[o.id]?.[ROOT_VAR];
        if (typeof v !== "number" || !Number.isFinite(v)) { missing.push(o.id); continue; }
        if (v === 0) zero.push(o.id);
        // 🔴 判据落在 **state** 上，不落在对象属性上：`propagateTick` 只读前者。
        //    同时反向咬死"没被顺手登记成 PropertyDef"（那条由 statevar-display-name ⑥ 把守，
        //    这里从数据侧再确认一次：真对象上**没有**这一格）。
        expect(o.props[ROOT_VAR], `${o.id} 的 ${ROOT_VAR} 跑到对象属性上去了 —— 状态变量只活在 world.state`).toBeUndefined();
      }
      expect(missing, `${typeKey} 有对象在 world.state 里拿不到 ${ROOT_VAR} ⇒ 扰了不传导（静默错答）`).toEqual([]);
      // "带真值，不是 0 占位"：值恒 0 的源在引擎里会被 `if (sourceVal === 0) continue` 直接跳过，
      // 屏上看着有这一格、扰动却推不动任何东西 —— 与"根本没这一格"同样是无事发生。
      expect(zero.length, `${typeKey} 有 ${zero.length}/${objs.length} 个落点的 ${ROOT_VAR} 恒 0 ⇒ 这些落点扰不动`).toBeLessThan(objs.length / 2);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ③ 传导臂（本单标的）—— 扰 `procurementDelay` ⇒ `shortageRisk` **真的变了**，且值对得上
  // ══════════════════════════════════════════════════════════════════════════
  it("③ 传导臂：给采购单打一条扰动 → propagateTick → 该物料 shortageRisk 按系数真的抬起来（方向+量级）", async () => {
    const t = await seededApp();
    const inputs = await engineInputs(t);
    const rules = await t.repos.sim.listPropagationRules("demo", true);

    // 🐤 金丝雀（引擎自证）：先跑一条**已知必通**的既有根源链 `Order.demandPressure → Model.demandLoad`。
    // 它若也不动 ⇒ 报「传导引擎/图坏了」，**不许**报「采购这条边不通」。
    const demandLink = (await t.repos.links.list("demo", (l) => l.type === "order_for_model"))[0]!;
    expect(demandLink, "🐤 金丝雀链路 order_for_model 零实例 ⇒ 图坏了").toBeDefined();
    const canary = propagateTick(
      inputs.graph, { [demandLink.fromId]: { demandPressure: 10 } }, rules, [], 0,
      inputs.ruleParams, inputs.cadenceGates,
      [], // perturbations：本金丝雀不施加扰动
      // ⚠ 权重表必须一起喂（WO-COEF-FROM-BOM）：`demo_order_demand_pressure` 已声明
      // `weightRef`，少喂这一项 ⇒ 引擎按**诚实缺席**处理、该规则整条不传导 ⇒ 这里读到 undefined，
      // 而那会被误读成"引擎坏了"。少喂输入与引擎坏掉是两件事，判据不能混。
      inputs.pairWeights,
    );
    // 0.8 × 该单的**订单量相对倍率** × 10。倍率 = 该单 qty ÷ 该型号在手单 qty 均值（均值=1·保总量），
    // 故这里**不写死 8**（写死等于赌"这张单恰好是均值单"）—— 只咬「真的推动了」+「量级合理」。
    // 咬死一个由种子 qty 决定的小数，才是把测试变成"赌种子不变"的那种写法。
    const canaryLoad = canary.next[demandLink.toId]?.demandLoad;
    expect(canaryLoad, "🐤 金丝雀：既有根源都推不动 ⇒ 引擎坏了，不是本单的边坏了").toBeGreaterThan(0);
    expect(canary.unresolvedWeights, "🐤 金丝雀：权重表没喂进去 ⇒ 下面每条『不通』都读不出真假").toEqual([]);

    // 🔴 标的：采购单 → 它补的那个物料。落点从**真链路表**取（不是猜 id 拼接）。
    const poRule = rules.find((r) => r.sourceStateVar === ROOT_VAR && r.sourceTypeKey === "PurchaseOrder")!;
    expect(poRule, "种子里没有 PurchaseOrder 的根源边").toBeDefined();
    const poLink = (await t.repos.links.list("demo", (l) => l.type === poRule.viaLinkKey))[0]!;
    expect(poLink, `${poRule.viaLinkKey} 在真链路表上零实例 ⇒ 声明了逆边但没物化（#158 的孪生形态）`).toBeDefined();

    const MAG = 5; // 「采购到货晚 5 天」
    const out = propagateTick(
      inputs.graph, { [poLink.fromId]: { [ROOT_VAR]: MAG } }, rules, [], 0,
      inputs.ruleParams, inputs.cadenceGates,
    );
    const got = out.next[poLink.toId]?.[RESULT_VAR];
    // 方向：抬高（不是"没报错"、也不是"变了一点"）。
    expect(got, `${poLink.toId} 的 ${RESULT_VAR} 没动 ⇒ 扰了不传导`).toBeGreaterThan(0);
    // 量级：**逐值对得上系数**。写死 0.8 会在改系数时变成一句谎；这里从规则自己读。
    expect(got).toBe(poRule.coefficient * MAG);
    // 溯源：trace 里真有这条规则的行（"值变了"与"是这条规则改的"是两个命题）。
    expect(out.trace.some((x) => x.ruleKey === poRule.key && x.toObjectId === poLink.toId)).toBe(true);

    // 反面对照：**不扰**时这一格纹丝不动 —— 证明上面那个数确实来自扰动，不是世界自己在漂。
    const idle = propagateTick(inputs.graph, {}, rules, [], 0, inputs.ruleParams, inputs.cadenceGates);
    expect(idle.next[poLink.toId]?.[RESULT_VAR] ?? 0).toBe(0);
  });

  it("③b 传导臂 · 另两类台账（批次 / 供应商）延一拍到达，同样把 shortageRisk 抬起来", async () => {
    const t = await seededApp();
    const inputs = await engineInputs(t);
    const rules = await t.repos.sim.listPropagationRules("demo", true);

    for (const typeKey of ["MaterialBatch", "Supplier"] as const) {
      const rule = rules.find((r) => r.sourceStateVar === ROOT_VAR && r.sourceTypeKey === typeKey)!;
      expect(rule, `${typeKey} 没有根源边`).toBeDefined();
      expect(rule.delayTicks, `${typeKey} 这条边的行程假设变了，本臂的时基断言要跟着改`).toBe(1);
      const link = (await t.repos.links.list("demo", (l) => l.type === rule.viaLinkKey))[0]!;
      expect(link, `${rule.viaLinkKey} 零实例`).toBeDefined();

      const MAG = 4;
      const t0 = propagateTick(
        inputs.graph, { [link.fromId]: { [ROOT_VAR]: MAG } }, rules, [], 0,
        inputs.ruleParams, inputs.cadenceGates,
      );
      // delayTicks=1 ⇒ 本拍**不**到达，先排进 pending（"到货晚"要等下一拍才显现，不是当拍）。
      expect(t0.next[link.toId]?.[RESULT_VAR] ?? 0, `${typeKey}: delayTicks=1 却当拍就到了`).toBe(0);
      expect(t0.pending.some((p) => p.ruleKey === rule.key && p.targetObjectId === link.toId)).toBe(true);

      // 下一拍结算：值必须**逐值等于** 系数 × 幅度。
      const t1 = propagateTick(
        inputs.graph, t0.next, rules, t0.pending, 1,
        inputs.ruleParams, inputs.cadenceGates,
      );
      expect(t1.next[link.toId]?.[RESULT_VAR], `${typeKey}: 延迟贡献没落地 ⇒ 这条边其实不通`).toBe(rule.coefficient * MAG);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ④ 全链臂 —— 走**真 HTTP 路由**，采购根源一路带到订单（证明它接的是那条真链路，不是一个孤立函数）
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ **这一臂刻意从「真种子铺出来的 tick0 世界态」出发，不自己造 state** ——
  //   ③/③b 喂的是测试手搓的最小 state（为了能逐值对系数），那证明的是**引擎半**：
  //   「给了这一格，引擎会算对」。但它证明不了**数据半**：「这一格真的会被种出来」。
  //   两半合起来才是接缝。判据落在这一句：本臂的幅度**取自 `seedState[poId].procurementDelay`**，
  //   若种子没把这一格铺进 `world.state`，这里**当场拿不到数** ⇒ 红在取数那一行，
  //   而不是安静地拿一个测试自己塞的值把数据半的窟窿糊过去（变异反证②咬的正是这条）。
  it("④ 全链臂（真 HTTP · 从真种子世界态出发）：采购到货延迟 → 物料短缺 → 型号缺料 → 订单缺口，四跳全程真的分叉", async () => {
    const t = await seededApp();
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const poRule = rules.find((r) => r.sourceStateVar === ROOT_VAR && r.sourceTypeKey === "PurchaseOrder")!;

    // 挑一条**下游真的走得通**的采购单：它补的物料要真被某个型号用、那个型号要真被某张订单要。
    const poLinks = await t.repos.links.list("demo", (l) => l.type === poRule.viaLinkKey);
    const matToModel = await t.repos.links.list("demo", (l) => l.type === "material_used_by_model");
    const modelToOrder = await t.repos.links.list("demo", (l) => l.type === "model_demanded_by_order");
    expect(poLinks.length, "🐤 采购补货边零实例").toBeGreaterThan(0);
    expect(matToModel.length, "🐤 material_used_by_model 零实例").toBeGreaterThan(0);
    expect(modelToOrder.length, "🐤 model_demanded_by_order 零实例").toBeGreaterThan(0);

    let chain: { poId: string; matId: string; modelId: string; orderId: string } | null = null;
    for (const pl of [...poLinks].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const mm of matToModel.filter((l) => l.fromId === pl.toId)) {
        const mo = modelToOrder.find((l) => l.fromId === mm.toId);
        if (mo) { chain = { poId: pl.fromId, matId: pl.toId, modelId: mm.toId, orderId: mo.toId }; break; }
      }
      if (chain) break;
    }
    expect(chain, "找不到一条 采购单→物料→型号→订单 的完整链 ⇒ 图上走不通").not.toBeNull();
    const { poId, matId, modelId, orderId } = chain!;

    const mkSession = async (baseSnapshot: TickState): Promise<string> => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
      expect(r.statusCode).toBe(201);
      return (r.json() as { id: string }).id;
    };
    const tick = async (id: string, n: number): Promise<TickState> => {
      const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${id}/tick`, headers: ADMIN, payload: { n } });
      expect(r.statusCode).toBe(200);
      return (r.json() as { state: TickState }).state;
    };

    // ── 世界从**播种侧真实现**铺出来（`SEED_DEMO=1` 用的就是这一支）──────────────────
    const { state: seedState } = await deriveSeedBaseSnapshot(t.repos, "demo");
    const seeded = seedState[poId]?.[ROOT_VAR];
    // 🔴 数据半的判据就在这两行：种子**必须**已经把这一格铺进世界态，且值非 0
    //    （值恒 0 的源被引擎 `if (sourceVal === 0) continue` 跳过 ⇒ 下面拨大它也推不动任何东西）。
    expect(typeof seeded, `种子没把 ${poId}.${ROOT_VAR} 铺进 world.state ⇒ 引擎读到 undefined，扰了不传导`).toBe("number");
    expect(seeded, `${poId}.${ROOT_VAR} 恒 0 ⇒ 这个落点扰不动`).toBeGreaterThan(0);

    // 基线 vs 扰动后：**同一份真世界**，唯一差别是把这一张采购单的到货延迟拨到 3 倍。
    const bumped: TickState = { ...seedState, [poId]: { ...seedState[poId]!, [ROOT_VAR]: seeded! * 3 } };
    const baseline = await tick(await mkSession(seedState), 4);
    const actual = await tick(await mkSession(bumped), 4);

    const read = (s: TickState, id: string, v: string) => s[id]?.[v] ?? 0;
    // 四跳逐跳分叉。⚠ 这里比的是 `actual > baseline` 而不是 `baseline === 0`：
    // 真世界里每个根源量纲本来就非 0（`deliveryDelay`/`demandPressure`/`priceShock` 同样），
    // 基线自己就在长 —— 「变大了」才是这条扰动的可归因效果，「非 0」不是。
    expect(read(actual, matId, RESULT_VAR), "第 1 跳：物料短缺没跟着变大").toBeGreaterThan(read(baseline, matId, RESULT_VAR));
    expect(read(actual, modelId, "supplyRisk"), "第 2 跳：型号供应风险没跟着变大").toBeGreaterThan(read(baseline, modelId, "supplyRisk"));
    expect(read(actual, orderId, RESULT_VAR), "第 3 跳：订单缺口没跟着变大").toBeGreaterThan(read(baseline, orderId, RESULT_VAR));
    // 第 4 跳（交付向）：物料短缺会回头压到采购加急上 —— 证明它进的是那张真图，不是一条直线。
    expect(read(actual, poId, "expeditePressure"), "第 4 跳：采购加急压力没跟着变大").toBeGreaterThan(read(baseline, poId, "expeditePressure"));
    // 反向金丝雀：**与采购链无关**的那一路不该被这条扰动带动（否则"到处都在涨"，上面四条就不成其为证据）。
    expect(read(actual, orderId, "costPressure"), "成本向被采购扰动带动了 ⇒ 图上串味了").toBe(read(baseline, orderId, "costPressure"));
    // 根源自己**不被任何规则改写**（入度 0 的可观测后果：推了 4 拍还是拨进去的那个数）。
    expect(read(actual, poId, ROOT_VAR), "根源被下游写回来了 ⇒ 它已经不是根源").toBe(seeded! * 3);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑤ R6 确定性 —— 同 (industry, scale, seed) 重跑，落点与传导逐字节一致
  // ══════════════════════════════════════════════════════════════════════════
  it("⑤ 确定性 R6：同 seed 重种，procurementDelay 的落点与一拍传导结果字节级一致", async () => {
    const snapshot = async (): Promise<string> => {
      const t = await seededApp();
      const { state } = await deriveSeedBaseSnapshot(t.repos, "demo");
      const cells = Object.keys(state).sort()
        .filter((id) => state[id]![ROOT_VAR] !== undefined)
        .map((id) => `${id}=${state[id]![ROOT_VAR]}`);
      const inputs = await engineInputs(t);
      const rules = await t.repos.sim.listPropagationRules("demo", true);
      const out = propagateTick(inputs.graph, state, rules, [], 0, inputs.ruleParams, inputs.cadenceGates);
      return JSON.stringify({ cells, next: out.next, pending: out.pending });
    };
    const a = await snapshot();
    // 🐤 金丝雀：快照真的含 `procurementDelay` 的落点（空串两次也相等 ⇒ 这条断言会恒绿）。
    expect(a).toContain(ROOT_VAR);
    expect(a.length).toBeGreaterThan(1000);
    expect(await snapshot()).toBe(a);
  });
});
