/**
 * WO-ENGINE-SCOPE-FIX2（欠账 #116 第二轮）· 引擎层作用域实参**差分门 · 第二批**
 * —— 闭 `G-SOLVER-SCOPE-ECHO` 余下 5 处：`mitigation_select.baseName/base` · `capex_scenario.scenarioKey` ·
 *    `carbon_footprint.modelId`（三处**真重算**）＋ `changeover_sequence.lineId` · `quarterly_gap.quarter`
 *    （两处**数据层没这个维 → 显性标缺席**，见各自 describe 头的三条硬证据）。
 *
 * ⚠ 与第一批（`engine-scope-fidelity.seam.test.ts`）同一纪律，**不是状态门是差分门**：
 *   同一次调用**只换作用域实参的值** → 断言**输出真的不同**，且不同的那部分**等于该实体自己的真数据**。
 *
 * ⚠ 本文件多了一类第一批没有的断言 —— **「做不动」也要有门**。
 *   ④⑤ 两处的裁决是「数据层根本没这个维，所以标 EMPTY 而不是假装算」。这个裁决**依赖于一条数据事实**
 *   （`ChangeoverMatrix.lineId` 全 null / `WorkOrder` 的型号跑出了 `Model` 之外）。所以门里**直接咬那条事实**：
 *   哪天数据补上了，这几条会**变红**，逼下一个人回来把 EMPTY 换成真算 —— 而不是让一句
 *   「当时数据没有」的注释在仓库里永远正确下去。
 *
 * 接缝（SEAM-GATE）：数据半（`BOMHeader`/`BOMDetail`/`Material`/`Base`/`Line`/`ChangeoverMatrix`/`WorkOrder`/`Model`/`PlanTarget`
 *   对象真值 + `solverParams.capexScenario` 情景注册表）× 引擎半（求解器作用域路由）。
 *   期望值一律**从对象库/另一个挂载点真读**，不写死金值 —— 任一半掉即红。
 */
import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

const query = (t: TestApp, objectType: string): Promise<Record<string, unknown>[]> =>
  t.app
    .inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType, filter: {}, limit: 500 } })
    .then((r) => (r.json() as { data: { props: Record<string, unknown> }[] }).data.map((o) => o.props));

const okData = async (t: TestApp, key: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const res = await invokeSolver(t, key, args);
  expect(res.statusCode, `${key}(${JSON.stringify(args)}) → ${res.body}`).toBe(200);
  return (res.json() as { data: Record<string, unknown> }).data;
};

const errCode = async (t: TestApp, key: string, args: Record<string, unknown>): Promise<{ status: number; code: string }> => {
  const res = await invokeSolver(t, key, args);
  return { status: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code ?? "" };
};

/** 抹掉「回显位」后的输出指纹：只回显的实参被抹掉后若两份仍相同 ⇒ 数字根本没跟着变（= 假个性化）。 */
const fingerprintWithout = (o: Record<string, unknown>, echoKeys: string[]): string => {
  const c = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
  for (const k of echoKeys) delete c[k];
  return JSON.stringify(c);
};

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

let app: TestApp;
const boot = async (): Promise<TestApp> => {
  if (!app) {
    app = await makeApp();
    await seedBattery(app);
  }
  return app;
};

// ---------------------------------------------------------------------------
// C 组① · mitigation_select 的基地维（#116·G-SOLVER-SCOPE-ECHO + #117 键名不对）
// 修前一处两病：卡片传 `base`、求解器读 `baseName` ⇒ `draftPayload.base` 是**空串**（而这份草稿要变成
// Action 审批件）；且 `tightness` 写死 85 ⇒ 常州问、枣庄问、江门问，urgency/plans/recommended 逐字节相同。
// ---------------------------------------------------------------------------
describe("差分门 C① · mitigation_select 基地维：换基地 → 紧张度/推荐/草稿必须真变", () => {
  it("紧张度必须与 bottleneck_matrix 对同一 (基地,因素) 的读数**逐值相同**（单一出处·不许有第二套张力）", async () => {
    const t = await boot();
    const bm = await okData(t, "bottleneck_matrix", {});
    const rows = bm.rows as { base: string; tightness: Record<string, number> }[];
    expect(rows.length, "数据半：bottleneck_matrix 应有逐基地行").toBeGreaterThanOrEqual(3);
    const factor = "物料齐套";
    for (const row of rows.slice(0, 4)) {
      const out = await okData(t, "mitigation_select", { base: row.base, factor });
      expect(
        out.tightness,
        `${row.base}×${factor}：mitigation_select 的张力应与 bottleneck_matrix 同源同值（有第二套实现即红）`,
      ).toBe(row.tightness[factor]);
    }
  });

  it("换基地 → 紧张度/urgency 真变，且**推荐方案本身**会随基地翻面（不是只换了个标签）", async () => {
    const t = await boot();
    const bm = await okData(t, "bottleneck_matrix", {});
    const rows = bm.rows as { base: string; tightness: Record<string, number>; primary: string }[];
    const factor = "物料齐套";
    // 数据半前置：至少要有一个「该因素是主瓶颈」的基地和一个「不是」的基地，两者张力才会跨过 urgency=0 的门槛。
    const hot = rows.find((r) => r.primary === factor);
    const cold = rows.find((r) => r.primary !== factor);
    expect(hot, `数据半：应有以「${factor}」为主瓶颈的基地`).toBeTruthy();
    expect(cold, `数据半：应有主瓶颈不是「${factor}」的基地`).toBeTruthy();

    const a = await okData(t, "mitigation_select", { base: hot!.base, factor, solutionName: "三班制" });
    const b = await okData(t, "mitigation_select", { base: cold!.base, factor, solutionName: "三班制" });

    expect(a.tightness, `${hot!.base} 与 ${cold!.base} 的张力应不同`).not.toBe(b.tightness);
    expect(a.urgency).not.toBe(b.urgency);
    // ★ 差分判据（机器口径）：抹掉回显位后仍必须不同 —— 修前抹掉 baseName 即逐字节相同。
    expect(fingerprintWithout(a, ["baseName"])).not.toBe(fingerprintWithout(b, ["baseName"]));
    // ★ 业务可见判据：推荐的处置方案随基地变（高张力基地推空运补料，低张力基地推提前备料）。
    expect(
      a.recommended,
      `两基地推荐相同（${String(a.recommended)}）⇒ 作用域没进到选型`,
    ).not.toBe(b.recommended);
  });

  it("draftPayload.base 不再是空串 —— 卡片传的 `base` 键必须被认（这份草稿要变成 Action 审批件）", async () => {
    const t = await boot();
    // S06 卡片今天的原样入参（scenarios-catalog.ts:66）。
    const out = await okData(t, "mitigation_select", { base: "常州", factor: "物料齐套", solutionName: "三班制" });
    expect(out.baseName, "修前恒 ''（求解器读 baseName，卡片传 base）").toBe("常州");
    expect((out.draftPayload as { base: string }).base, "修前恒 ''：空基地的处置草稿照样走完审批").toBe("常州");
  });

  it("baseId 与中文名同解（changzhou ≡ 常州），回显位归一成规范中文名", async () => {
    const t = await boot();
    const byId = await okData(t, "mitigation_select", { base: "changzhou", factor: "物料齐套" });
    const byName = await okData(t, "mitigation_select", { baseName: "常州", factor: "物料齐套" });
    expect(byId.baseName).toBe("常州");
    expect(JSON.stringify(byId)).toBe(JSON.stringify(byName));
  });

  it("诚实缺席：基地解析不到 → 400 AMBIGUOUS_SCOPE（拒绝拿一份无关紧张度选方案）", async () => {
    const t = await boot();
    expect(await errCode(t, "mitigation_select", { base: "火星基地", factor: "物料齐套" })).toEqual({
      status: 400,
      code: "AMBIGUOUS_SCOPE",
    });
  });

  it("加性①：不给 base/baseName → tightness 仍是缺省 85、无 dataMode 键（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const out = await okData(t, "mitigation_select", { factor: "物料齐套" });
    expect(out.baseName).toBe("");
    expect(out.urgency, "85 → (85−70)/30 = 0.5，取证单 §6.7 实测原值").toBe(0.5);
    expect(out.recommended).toBe("air_freight");
    expect(Object.keys(out), "不给基地时不得多出 tightness/dataMode 两键").not.toContain("dataMode");
  });

  it("加性②：调用方直传 tightness → 以调用方为准，且不冠 dataMode（规则 payload 那条路不回归）", async () => {
    const t = await boot();
    const out = await okData(t, "mitigation_select", { factor: "瓶颈工序", baseName: "常州", tightness: 92 });
    expect(out.urgency, "(92−70)/30 = 0.7333").toBe(0.7333);
    expect(Object.keys(out), "调用方的数字不许被冠上 LIVE/MOCK 的名义").not.toContain("dataMode");
  });

  it("防伪：调用方自称 `tightnessDataMode:\"LIVE\"` 不得被透出（同形假个性化·只是换了个字段）", async () => {
    const t = await boot();
    const out = await okData(t, "mitigation_select", {
      factor: "瓶颈工序",
      baseName: "常州",
      tightness: 92,
      tightnessDataMode: "LIVE",
    });
    expect(Object.keys(out), "`dataMode` 是引擎派生出来的凭证，不是调用方能声明的入参").not.toContain("dataMode");
  });

  // 上一条只覆盖了「给了基地」那条返回路。`deriveExtendedArgs` 的 mitigation_select 有**两条**返回路，
  // `!hasBaseRef` 那条同样是 `...args` 在前 —— 不补这一条，等于修了两处却只验了一处
  // （本仓记在案的形态：实现有、测试只咬到其中一半，另一半是「排练过」而非「验过」）。
  it("防伪·无基地路：不给 base/baseName 时调用方自称 `tightnessDataMode` 同样不得透出", async () => {
    const t = await boot();
    const out = await okData(t, "mitigation_select", { factor: "瓶颈工序", tightnessDataMode: "LIVE" });
    expect(Object.keys(out), "没有基地就没有派生，凭证必须为空").not.toContain("dataMode");
  });
});

// ---------------------------------------------------------------------------
// C 组② · capex_scenario 的情景维（#116·G-SOLVER-SCOPE-ECHO）
// 修前：`scenarioKey` 只写进输出（capex.ts:272），不参与任何计算 ⇒ baseline / aggressive / conservative
// 三个情景抹掉回显位后逐字节相同。真源 `params.capexScenario.scenarios` 一直在 ctx 里，
// 且 planviews.ts:135（AOP 视图）**今天就在读同一份** —— 病是求解器自己的 invoke 路没挂这个点。
// ---------------------------------------------------------------------------
describe("差分门 C② · capex_scenario 情景维：换情景 → 项目集/供给曲线必须真变", () => {
  const WINDOW = { demand: [50, 48, 49, 51, 52, 53, 54, 55], s0: [45, 45, 45, 45, 45, 45, 45, 45] };

  it("三情景三条不同的供给曲线，且项目集与**另一个挂载点**（AOP 视图）逐 id 一致（单一出处）", async () => {
    const t = await boot();
    const aop = (
      await t.app.inject({ method: "GET", url: "/a/v1/plan/aop?year=2026", headers: ADMIN })
    ).json() as { scenarios: { key: string; capexScenario?: { projects: { id: string }[] } }[] };
    expect(aop.scenarios.length, "数据半：AOP 应有情景").toBeGreaterThanOrEqual(3);

    const seen = new Map<string, string>();
    for (const s of aop.scenarios) {
      const out = await okData(t, "capex_scenario", { scenarioKey: s.key, ...WINDOW });
      const scope = out.scope as { mode: string; scenarioKey: string; projectIds: string[] };
      expect(scope.mode, `${s.key}：未传 projects 时应真取该情景的项目集`).toBe("SCENARIO");
      expect(scope.scenarioKey).toBe(s.key);
      // ★ 单一出处判据：求解器 invoke 路取到的项目集 == AOP 视图路取到的（两个挂载点读同一份注册表）。
      expect(
        [...scope.projectIds].sort(),
        `${s.key}：求解器路与 AOP 视图路的项目集应完全一致（两处读同一个 params.capexScenario.scenarios）`,
      ).toEqual((s.capexScenario?.projects ?? []).map((p) => p.id).sort());
      seen.set(s.key, JSON.stringify(out.S));
    }
    // ★ 差分判据：三情景的供给曲线 S[] 互不相同（修前三者恒等 = s0）。
    expect(new Set([...seen.values()]).size, `三情景供给曲线应互不相同，实测 ${JSON.stringify([...seen])}`).toBe(seen.size);
  });

  it("抹掉回显位后两份输出**不再**逐字节相同（修前恒相同 = ECHO_ONLY 的机器判据）", async () => {
    const t = await boot();
    const a = await okData(t, "capex_scenario", { scenarioKey: "baseline", ...WINDOW });
    const b = await okData(t, "capex_scenario", { scenarioKey: "aggressive", ...WINDOW });
    expect(fingerprintWithout(a, ["scenarioKey", "scope"])).not.toBe(fingerprintWithout(b, ["scenarioKey", "scope"]));
  });

  it("诚实缺席：未传 projects 且情景不在注册表 → 400 AMBIGUOUS_SCOPE（不把情景名印在无关测算上）", async () => {
    const t = await boot();
    expect(await errCode(t, "capex_scenario", { scenarioKey: "不存在的情景X", ...WINDOW })).toEqual({
      status: 400,
      code: "AMBIGUOUS_SCOPE",
    });
  });

  it("调用方直传 projects → 不 400，但输出必须写明「scenarioKey 只是标签、未参与选型」", async () => {
    const t = await boot();
    // rules-p3-payload-11solvers.test.ts:35 CAPEX_ARGS 那条真实用法（scenarioKey:"x" 不是登记情景）。
    const out = await okData(t, "capex_scenario", {
      scenarioKey: "x",
      demand: [10, 12, 14, 16],
      s0: [8, 8, 8, 8],
      projects: [{ id: "P1", q0: 1, cap: 5, capex: [6, 0, 0, 0], m: 200 }],
    });
    const scope = out.scope as { mode: string; note: string };
    expect(scope.mode).toBe("EXPLICIT");
    expect(scope.note).toContain("未参与选型");
    expect((out.projects as { id: string }[]).map((p) => p.id)).toEqual(["P1"]);
  });

  it("加性：不给 scenarioKey → `scope` 键根本不出现（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const out = await okData(t, "capex_scenario", {
      demand: [50, 48, 49, 51],
      s0: [45, 45, 45, 45],
      projects: [{ id: "P", name: "P", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }],
    });
    expect(Object.keys(out)).not.toContain("scope");
    expect(out.scenarioKey).toBe("");
  });
});

// ---------------------------------------------------------------------------
// C 组③ · carbon_footprint 的型号维（#116·G-SOLVER-SCOPE-ECHO）
// 修前：物料段恒取 `Material` 按 id 排序的前 4 行（al_foil/cell_case/cu_foil/elyte —— 连正极都不在里面），
// 与 modelId 无关 ⇒ 任何型号 materialCarbon 恒 348.311，而输出印着用户问的型号。
// ---------------------------------------------------------------------------
describe("差分门 C③ · carbon_footprint 型号维：materialCarbon 必须等于该型号自己那份 BOM", () => {
  /** 从对象库真读：某型号的 BOM 物料碳（Σ quantity×(1+lossRate)×Material.carbonFactor）。 */
  const bomCarbonOf = async (t: TestApp, modelId: string): Promise<number> => {
    const heads = (await query(t, "BOMHeader")).filter((h) => String(h.modelId) === modelId);
    expect(heads.length, `数据半：型号 ${modelId} 应有 BOMHeader`).toBeGreaterThan(0);
    const bomId = String(heads[0]!.bomId); // sortById 后的首份（同型号各版本共用同一份用量模板）
    const details = (await query(t, "BOMDetail")).filter((d) => String(d.bomId) === bomId);
    expect(details.length, `数据半：${bomId} 应有明细`).toBeGreaterThan(0);
    const mats = new Map((await query(t, "Material")).map((m) => [String(m.matId), m]));
    let sum = 0;
    for (const d of details) {
      const m = mats.get(String(d.materialId));
      if (!m) continue;
      sum += round4(Number(d.quantity) * (1 + Number(d.lossRate))) * Number(m.carbonFactor);
    }
    return round4(sum);
  };

  it("materialCarbon == 该型号真 BOM 的逐行合计（数据半 × 引擎半·任一半掉即红）", async () => {
    const t = await boot();
    for (const modelId of ["4680-NCM", "方形-LFP"]) {
      const out = await okData(t, "carbon_footprint", { modelId, baseName: "成都" });
      const got = (out.breakdown as { materialCarbon: number }).materialCarbon;
      expect(got, `${modelId} 的物料碳应等于它自己那份 BOM`).toBeCloseTo(await bomCarbonOf(t, modelId), 3);
    }
  });

  it("跨化学体系换型号 → 抹掉回显位后**不再**逐字节相同（修前恒相同 = ECHO_ONLY 的机器判据）", async () => {
    const t = await boot();
    const ncm = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "成都" });
    const lfp = await okData(t, "carbon_footprint", { modelId: "方形-LFP", baseName: "成都" });
    expect(fingerprintWithout(ncm, ["modelId"])).not.toBe(fingerprintWithout(lfp, ["modelId"]));
    expect((ncm.breakdown as { materialCarbon: number }).materialCarbon).not.toBe(
      (lfp.breakdown as { materialCarbon: number }).materialCarbon,
    );
  });

  it("实事求是：同化学体系两型号 BOM 逐行相同 ⇒ 物料碳本就应当相同（不假装它会变）", async () => {
    const t = await boot();
    // 这不是"没重算"，是真值如此：BOM_ITEM_TEMPLATES 只在正极那一行按 NCM/LFP 分叉，其余 6 行完全相同。
    // 门咬的是**数据半的这条事实**：哪天 BOM 真按型号分化了，这条会红，逼人回来把断言改成"应当不同"。
    const a = await bomCarbonOf(t, "4680-NCM");
    const b = await bomCarbonOf(t, "2170-NCM");
    expect(a, "本 seed 里两个 NCM 型号共用同一份用量模板").toBeCloseTo(b, 6);
    const outA = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "成都" });
    const outB = await okData(t, "carbon_footprint", { modelId: "2170-NCM", baseName: "成都" });
    expect((outA.breakdown as { materialCarbon: number }).materialCarbon).toBeCloseTo(
      (outB.breakdown as { materialCarbon: number }).materialCarbon,
      6,
    );
  });

  it("诚实缺席：型号无 BOM → 400 AMBIGUOUS_SCOPE（拒绝拿全局前 4 种物料冒充该型号）", async () => {
    const t = await boot();
    expect(await errCode(t, "carbon_footprint", { modelId: "不存在的型号X", baseName: "成都" })).toEqual({
      status: 400,
      code: "AMBIGUOUS_SCOPE",
    });
  });

  it("加性：不给 modelId → 仍取 Material 排序前 4 行（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const mats = (await query(t, "Material")).slice(0, 4);
    const expected = round4(mats.reduce((s, m) => s + Number(m.bomUnit ?? 1) * Number(m.carbonFactor ?? 10), 0));
    const out = await okData(t, "carbon_footprint", {});
    expect((out.breakdown as { materialCarbon: number }).materialCarbon).toBeCloseTo(expected, 3);
    expect(out.maxLever, "取证单 §6.6 实测原值：修前最大杠杆是铝箔（前 4 行里没有正极）").toBe("物料:al_foil");
  });
});

// ---------------------------------------------------------------------------
// D 组① · changeover_sequence 的产线维 —— **裁决③：数据层没这个维，显性标缺席**
//
// 为什么这里不是"补一行过滤"（三条硬证据，本 describe 逐条真咬）：
//   ① `ChangeoverMatrix.lineId` 全库恒 null（生成器写死·battery-extended.ts:667「无线级实测→全局值」）；
//   ② `Order` 没有产线归属（只有 bases[]，全链无 Order→Line 边）；
//   ③ 唯一带真 lineId 的 `WorkOrder`，其型号取值跑出了 `Model` 之外（储能-280Ah/储能-314Ah）
//      ⇒ 不在换型矩阵里 ⇒ 接上去会把「不知道换型多久」算成「0 分钟」，比现状更坏。
// ---------------------------------------------------------------------------
describe("诚实缺席门 D① · changeover_sequence 产线维：标 EMPTY，而不是把全网排序冠上这条线的名字", () => {
  it("数据半事实①：ChangeoverMatrix 全库无线级 lineId（哪天灌了值，本条变红 → 逼人回来改成真过滤）", async () => {
    const t = await boot();
    const cm = await query(t, "ChangeoverMatrix");
    expect(cm.length, "数据半：换型矩阵应非空").toBeGreaterThan(0);
    const withLine = cm.filter((x) => x.lineId !== null && x.lineId !== undefined && String(x.lineId) !== "");
    expect(
      withLine.length,
      `换型矩阵已出现线级 lineId（${withLine.length}/${cm.length} 行）⇒ 产线维不再是"数据层没有"，` +
        `lineScope 的 EMPTY 裁决作废，须回来把 changeover_sequence 改成真按产线过滤`,
    ).toBe(0);
  });

  it("数据半事实②：WorkOrder 的型号跑出了 Model 之外 ⇒ 拿它当产线队列会编造 0 分钟换型", async () => {
    const t = await boot();
    const woModels = new Set((await query(t, "WorkOrder")).map((w) => String(w.modelId)));
    const modelIds = new Set((await query(t, "Model")).map((m) => String(m.modelId)));
    expect(woModels.size, "数据半：WorkOrder 应非空").toBeGreaterThan(0);
    const orphans = [...woModels].filter((m) => !modelIds.has(m)).sort();
    expect(
      orphans.length,
      `WorkOrder 的型号已全部落在 Model 内（孤儿 ${JSON.stringify(orphans)}）⇒ 换型矩阵能查全，` +
        `"接 WorkOrder 会编造 0 分钟换型"这条理由作废，须回来重估产线维`,
    ).toBeGreaterThan(0);
  });

  it("给了真实产线 → 输出必须带 lineScope.dataMode=EMPTY + 说清缺什么（不静默冒充线级排产）", async () => {
    const t = await boot();
    const line = (await query(t, "Line"))[0]!;
    const out = await okData(t, "changeover_sequence", { lineId: String(line.lineId), week: 1 });
    const scope = out.lineScope as { dataMode: string; lineId: string; baseId: string; missingInputs: { objectType: string }[] };
    expect(scope.dataMode).toBe("EMPTY");
    expect(scope.lineId).toBe(String(line.lineId));
    expect(scope.baseId, "标注里的基地必须是这条产线真实所属的基地").toBe(String(line.baseId));
    expect(scope.missingInputs.map((m) => m.objectType).sort()).toEqual(["ChangeoverMatrix", "Order", "WorkOrder"]);
  });

  it("诚实缺席：产线不存在 → 400（修前照样把 `LINE-WS-火星-x` 回显在一张排序表上）", async () => {
    const t = await boot();
    expect(await errCode(t, "changeover_sequence", { lineId: "LINE-WS-火星-assembly" })).toEqual({
      status: 400,
      code: "AMBIGUOUS_SCOPE",
    });
  });

  it("加性：不给 lineId → `lineScope` 键不出现（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const out = await okData(t, "changeover_sequence", {});
    expect(Object.keys(out)).not.toContain("lineScope");
    expect(out.lineId, "既有缺省不动").toBe("L1");
  });
});

// ---------------------------------------------------------------------------
// D 组② · quarterly_gap 的季度维 —— **裁决③：显性标缺席**
// S19 卡片 preset 只有 `{quarter:"2026Q2"}`（不带 gap）⇒ 答案里的缺口是求解器写死的 50，
// 却与「2026Q2」并排渲染成 KPI。季度需求真源在库（PlanTarget level=quarter），
// 但缺口 = 需求 − 供给的**供给侧**要走 capex.deriveS0（仅 planviews 路可达、季度索引未与日历季对齐）。
// ---------------------------------------------------------------------------
describe("诚实缺席门 D② · quarterly_gap 季度维：给了季度却没给缺口 → 必须标 EMPTY", () => {
  it("数据半事实：季度需求真源在库（missingInputs 指的不是虚构的对象类型）", async () => {
    const t = await boot();
    const quarters = (await query(t, "PlanTarget")).filter((x) => String(x.level) === "quarter");
    expect(quarters.length, "PlanTarget level=quarter 应存在（标注里点名了它）").toBeGreaterThanOrEqual(4);
  });

  it("S19 卡片原样入参（只给 quarter）→ quarterScope.dataMode=EMPTY，写明这个数不是该季真缺口", async () => {
    const t = await boot();
    const out = await okData(t, "quarterly_gap", { quarter: "2026Q2" });
    const scope = out.quarterScope as { dataMode: string; quarter: string; missingInputs: { objectType: string }[] };
    expect(scope.dataMode).toBe("EMPTY");
    expect(scope.quarter).toBe("2026Q2");
    expect(scope.missingInputs.map((m) => m.objectType)).toContain("PlanTarget");
  });

  it("调用方给了 gap → 数字归调用方所有，不标 EMPTY（不给别人的数扣一顶占位的帽子）", async () => {
    const t = await boot();
    const out = await okData(t, "quarterly_gap", {
      quarter: "Q3",
      gap: 50,
      options: [{ key: "outsource", name: "外协", release: 20, costRank: 2 }],
    });
    expect(Object.keys(out)).not.toContain("quarterScope");
    expect(out.residualGap).toBe(30);
  });

  it("加性：不给 quarter → `quarterScope` 键不出现（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const out = await okData(t, "quarterly_gap", {});
    expect(Object.keys(out)).not.toContain("quarterScope");
    expect(out.quarter).toBe("2026Q2");
    expect(out.residualGap).toBe(50);
  });
});
