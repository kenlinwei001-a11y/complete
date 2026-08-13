import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { CAPACITY_FACTOR_BINDINGS, factorPropKeys, matchesGrain } from "@platform/contracts";
import { computeByProcessModel, equipmentOee, patchCapacityContext } from "../src/solvers/capacity.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext, SolverParamsShape } from "../src/solvers/types.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-LEVER-BINDING-DRIFT · 产能拨杆「设备层」生产分支 SEAM（治 `G-LEVER-BINDING-DRIFT`）。
 *
 * ─── 这条测试为什么必须**新建**而不是改 `ontology-core.test.ts` 那条 ─────────────────────────
 * 既有 `ontology-core.test.ts`「mode:levers · factors 过滤」用的实参是 `{mode, targetType, targetProp, factors}`
 * ——**不传 `grain`**。而 `service.ts discoverLevers` 开头就是 `if (args.grain) return this.discoverCapacityLevers(...)`：
 * 不传 grain 走的是「ontology-core derivationSpecs 反向 walk」这条通用链，叶子来自该测试自建的 PYRAMID_SPECS 本体；
 * 传 grain 才走「产能金字塔」这条链，候选来自 `CAPACITY_FACTOR_BINDINGS`。
 *
 * **生产只走后者**（`RiskBoardView.tsx` 给 `DynamicLeverPanel` 传 `grain="process-model"` + `factors={[card.factor,…]}`
 * → `endpoints.discoverLevers({factors, grain, modelId, …})`），于是「设备OEE 有测试」证明不了「生产那条分支有测试」——
 * CLAUDE.md 铁律 0.5 判据⑥「路径开关类假绿：生产实参与测试实参交集为空」的又一实例。
 * 本文件补的就是**生产实参**那一格；原测试不动（它验的通用分支仍需保住）。
 */

const MODEL = "2170-NCM"; // 多基地可产型号（与 capacity-atom-factor.test.ts 同源）

interface Lever {
  objectType: string;
  objectId: string;
  prop: string;
  sensitivity: number;
  factor?: string;
  factorName?: string;
  mark?: string;
}

async function levers(t: TestApp, args: Record<string, unknown>): Promise<{ levers: Lever[]; count: number }> {
  const res = await invokeSolver(t, "generic_inference", { mode: "levers", ...args });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { levers: Lever[]; count: number } }).data;
}

/** 生产实参：`RiskBoardView.tsx` 把⑤瓶颈因子原样下传（card.factor ∈ BN 词表·此处取「设备OEE」那一格）。 */
const PROD_ARGS = { grain: "process-model", targetType: "Base", targetProp: "weeklyCap", modelId: MODEL } as const;

describe("WO-LEVER-BINDING-DRIFT · 设备层拨杆在生产实参下必须反推得出候选", () => {
  it("生产实参（grain='process-model' + factors=['设备OEE']）→ 杠杆非空且落在 Equipment.oee_current·敏感度非零", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const out = await levers(t, { ...PROD_ARGS, factors: ["设备OEE"], topK: 8 });

    // 红咬：修前此处恒 0（绑定表无 oee_current ⇒ 候选集空 ⇒ 设备层永远拨不出杠杆）。
    expect(out.count, "设备OEE 层在生产实参下反推出 0 个杠杆 —— 拨杆面板必然空白").toBeGreaterThan(0);
    const oee = out.levers.find((l) => l.objectType === "Equipment" && l.prop === "oee_current");
    expect(oee, `未反推出 Equipment.oee_current，实得：${out.levers.map((l) => `${l.objectType}.${l.prop}`).join(",") || "（空）"}`).toBeTruthy();
    // 有候选还不够——候选必须真撬得动 Σp50，否则会在「无下游影响 → 非有效杠杆」处被丢弃（= 用户仍看不见）。
    expect(Math.abs(oee!.sensitivity), "Equipment.oee_current 敏感度为 0 → 仍会被丢弃").toBeGreaterThan(0);
    // 因子归属可溯源（③ = BN 词表「设备OEE」·与 capacity.ts BN_BY_MARK 同名）
    expect(oee!.mark).toBe("③");
    expect(oee!.factor).toBe("设备·OEE"); // LEVER_PROP_META 单源下发
  });

  /**
   * 逐层普查 + **棘轮**：生产会下传的 7 个 BN 因子，逐个单独喂进生产实参，记下哪些层拨不出杠杆。
   *
   * 本单只修「设备OEE」那一层（病因 = **没接线**：绑定表里根本没有 `oee_current` 这个落点 ⇒ 候选集空）。
   * 普查同时坐实另有两层也是空的，但它们是**另一种病**（铁律 0.5 判据①：三种"不工作"不许混为一谈）——
   * 落点登记了、候选也非空，是**敏感度恒 0** 被 `discoverCapacityLevers`「无下游影响 → 非有效杠杆」丢弃：
   *
   *   ⑩ 瓶颈工序 → `Line.utilization`      产能链从不读 Line.utilization —— `capacity.ts:112` 读的是
   *                                        **`proc.props.utilization`（Process.utilization，= 绑定 ⑧）**。
   *                                        落点挂在了错误的对象类型上（"接了线接错地方"）。
   *   ⑤ 换型损失 → `ChangeoverMatrix.minutes`（WO-ENGINE-2 改名前写的是 `changeoverMin`）
   *                                        **三重死**（原注释漏记了最上游那一环，WO-ENGINE-2 补上并逐重实测）：
   *                                        ⓪〔已修〕**键名写错**：真属性是 `minutes`，旧写法 `changeoverMin` 在对象上恒不存在
   *                                          ⇒ `discoverCapacityLevers` 的 `typeof o.props[b.prop] === "number"` 把候选**整批剔除**
   *                                          （失效机制是**过滤**不是 `?? 0` 兜底算 0 —— 两者修法不同，别混）。
   *                                        ②〔已修〕`patchCapacityContext` 的 switch 只认 Process/Equipment/Line/Material，
   *                                          `default: return {...c}` ⇒ 该 override **被静默丢弃**，克隆世界与基线逐字节相同。
   *                                        ①〔**仍未修·真正的拦路虎**〕`capacity.ts` 全文不出现 ChangeoverMatrix：
   *                                          `p50 = processCap × certFactor × yieldRebase × matFactor` **不含换型项**，
   *                                          故即便 ⓪② 都修好，∂Σp50/∂minutes **仍恒 0** ⇒ ⑤ 照旧被
   *                                          「无下游影响 → 非有效杠杆」丢弃。**实测**见 `engine2-changeover-lever.seam.test.ts`
   *                                          （把每条 ChangeoverMatrix.minutes 放大 100× → Σp50 逐字节不变）。
   *                                          修它要**动产能链数学**（让 p50 消费换型），且数据侧 `ChangeoverMatrix.lineId`
   *                                          全库恒 null（`extended.ts` 实测）⇒ 落不到 `grain:"process"` 的工序颗粒 —— 两者都超出改名单的范围。
   *
   * 修它们要动产能链数学 / patch 白名单，**不在本单范围边界内**（见 `docs/PRD-lever-binding-drift.md` §6 遗留）。
   * 故此处按"具名允许清单 + 只降不升"记账：清单里的层允许空，**清单外任何一层变空即红**，
   * 且清单本身不许变长——把存量债钉在明面上，同时封死增量（同 `gate-ledger-baseline.json` 的棘轮形态）。
   */
  it("七层瓶颈因子逐层普查：清单外的层一律不得返回空杠杆集（存量两层具名记账·只降不升）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 生产会下传的全部 BN 因子（与 RiskBoardView 的 [card.factor, ...bnFactors] 同域）。
    const factors = ["设备OEE", "瓶颈工序", "良率波动", "物料齐套", "人力工时", "换型损失", "物流时长"];
    // 存量已知空层（敏感度恒 0·病因见上）。本单交付时实测 = 恰好这两个。
    const KNOWN_EMPTY = ["瓶颈工序", "换型损失"];

    const empties: string[] = [];
    for (const f of factors) {
      const out = await levers(t, { ...PROD_ARGS, factors: [f], topK: 8 });
      if (out.count === 0) empties.push(f);
    }

    // ① 清单外新增空层 → 红（本单修的「设备OEE」若被回退，第一个撞这里）
    const unexpected = empties.filter((f) => !KNOWN_EMPTY.includes(f));
    expect(unexpected, `下列瓶颈因子层在生产实参下反推不出任何杠杆（拨杆面板空白），且不在已知存量清单里：${unexpected.join(" / ")}`).toEqual([]);
    // ② 棘轮：存量只许修好、不许变多（修好了就把它从 KNOWN_EMPTY 里删掉，此断言逼你删）
    expect(empties.length, `已知空层清单 ${KNOWN_EMPTY.join("/")} 已修好 ${KNOWN_EMPTY.length - empties.length} 个 —— 请同步从 KNOWN_EMPTY 删除`).toBe(KNOWN_EMPTY.length);
  });

  /**
   * 反证「改法 (B) 是陷阱」：把 `LEVER_FACTOR_PROPS.设备OEE` 改指三原子 oeeA/oeeP/oeeQ 表面上也能凑出候选，
   * 但产能链读 OEE 只经 `equipmentOee`，其语义是**快照优先**、而合成数据给每台设备都回填了 `oee_current`
   * ⇒ 三原子被完全掩蔽、拨动它们 Σp50 纹丝不动 ⇒ 候选照样在「敏感度 0」处被丢弃。
   * 这条把「为什么选 (A) 不选 (B)」钉成可执行断言，而不是留在 PRD 里的一句话。
   */
  it("反证：oee_current 快照掩蔽三原子 —— 拨 oeeA/oeeP/oeeQ 对 Σp50 零影响，拨 oee_current 才真变", () => {
    const mk = (type: string, id: string, props: Record<string, unknown>): ObjectInstance =>
      ({ id, type, props, origin: { type: "SYNTHETIC" } }) as unknown as ObjectInstance;
    const c = {
      tenantId: "demo",
      params: BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape,
      bases: [mk("Base", "obj_b1", { baseId: "b1", name: "甲基地", formationCapDaily: 1e9, agingCapDaily: 1e9 })],
      lines: [mk("Line", "obj_l1", { lineId: "l1", baseId: "b1", name: "线1", utilization: 70, target_yield: 0.97 })],
      processes: [mk("Process", "obj_p1", { processId: "p1", lineId: "l1", baseId: "b1", name: "涂布", kind: "coating", yield: 0.95, yield_baseline: 0.9, shiftHours: 24, shifts: 1, attendance: 1, utilization: 1 })],
      // 与合成数据同形：三原子俱在，且 oee_current 已回填（battery.ts 对每台设备都回填）。
      equipment: [mk("Equipment", "obj_e1", { equipId: "e1", processId: "p1", lineId: "l1", baseId: "b1", ctSeconds: 1, availFactor: 0.9, oeeA: 0.9, oeeP: 0.88, oeeQ: 0.96, oee_current: 0.76 })],
      maintPlans: [], models: [mk("Model", "obj_m1", { modelId: "m1", name: "型号1", chem: "NCM" })], orders: [], shipments: [],
      segments: [], dataHealth: [], certByModel: new Map([["m1", new Map([["b1", "量产"]])]]), materials: [],
    } as unknown as SolverContext;

    const sum = (ctx: SolverContext): number => computeByProcessModel(ctx, "m1").reduce((a, r) => a + r.p50, 0);
    const baseline = sum(c);
    expect(baseline).toBeGreaterThan(0);

    // 快照优先：equipmentOee 直接返回 oee_current，乘积分支不进入。
    expect(equipmentOee({ oeeA: 0.9, oeeP: 0.88, oeeQ: 0.96, oee_current: 0.76 })).toBe(0.76);

    // 三原子各 +0.05 → Σp50 逐字节不变（= 敏感度恒 0 = 改法 (B) 产出的候选全是死杠杆）
    for (const prop of ["oeeA", "oeeP", "oeeQ"]) {
      const patched = sum(patchCapacityContext(c, "Equipment", "obj_e1", prop, 0.95));
      expect(patched, `拨 Equipment.${prop} 竟改变了 Σp50 —— 快照掩蔽前提不成立，本单的选型理由需重估`).toBe(baseline);
    }
    // 有效 OEE 快照 +0.05 → Σp50 真变（= 改法 (A) 的候选是活杠杆）
    expect(sum(patchCapacityContext(c, "Equipment", "obj_e1", "oee_current", 0.81))).not.toBe(baseline);
  });

  it("交叉校验不变量：LEVER_FACTOR_PROPS 的每个因子键，至少有一个落点在 CAPACITY_FACTOR_BINDINGS 里可拨动", () => {
    // 与门 `scripts/check-lever-binding-drift.mjs` 同一条不变量（门守全仓静态、此处守运行时契约）。
    const keys = factorPropKeys();
    expect(keys.length).toBe(CAPACITY_FACTOR_BINDINGS.length); // 金丝雀：交叉校验函数真返回落点全集
    const dialable = new Set(
      CAPACITY_FACTOR_BINDINGS.filter((b) => b.writable && matchesGrain(b.grain, "process-model")).map((b) => `${b.objectType}.${b.prop}`),
    );
    expect(dialable.has("Equipment.oee_current"), "设备层无可拨动落点 → 拨杆面板必空").toBe(true);
  });
});
