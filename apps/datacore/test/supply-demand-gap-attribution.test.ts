import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN as ADMIN_HEADERS, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CEO-Q7 · supply_demand_gap_attribution 供需失衡双向归因（挡假推演·绿测试≠能用）。
 * C1 双向(demandSide⊥supplySide+residual+各端叶) · C2 勾稽(需求端+供给端+residual=总缺口≤1e-4·亲验非只信标志)
 * · C3 颗粒①(改 DemandSegment.demandWanPerYearP50→需求端占比变) · C4 颗粒②(改 Equipment.oee_current→供给端占比变)
 * · C5 叶级真值(drillType/drillField/drillValue 齐) · C6 双向敏感(需求虚高 vs 供给不足→占比明显不同·非五五开)
 * · C7 R6(两跑 deep-equal) · C8 端到端(solver.invoke 一次真输出)。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Leaf = { id: string; factor: string; contribution: number; share: number; driverValue: number; provenance: { kind: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number } };
type Side = { contribution: number; share: number; pct: number; drivers: Leaf[] };
type SDG = {
  rootMetric: { key: string; name: string; gap: number; unit: string };
  totalGap: number; unit: string;
  demandSide: Side | null; supplySide: Side | null;
  residual: number;
  reconChecks: { label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  reconciled: boolean; residualPct: number; summary: string;
};

const run = async (t: TestApp): Promise<SDG> =>
  (await t.services.solvers.invoke(ADMIN, "supply_demand_gap_attribution", {})) as unknown as SDG;

describe("WO-CEO-Q7 · supply_demand_gap_attribution 供需失衡双向归因", () => {
  it("C1 双向归因：输出含 demandSide/supplySide 两支 + 各自叶表 + residual", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.totalGap).toBeGreaterThan(0);
    expect(g.demandSide).toBeTruthy();
    expect(g.supplySide).toBeTruthy();
    expect(g.demandSide!.drivers.length).toBeGreaterThan(0);
    expect(g.supplySide!.drivers.length).toBeGreaterThan(0);
    // 需求端叶 drill DemandSegment/Order；供给端叶 drill Line/Equipment/MaterialBalance。
    const dTypes = new Set(g.demandSide!.drivers.map((l) => l.provenance.drillType));
    const sTypes = new Set(g.supplySide!.drivers.map((l) => l.provenance.drillType));
    expect([...dTypes].every((x) => x === "DemandSegment" || x === "Order")).toBe(true);
    expect([...sTypes].every((x) => x === "Line" || x === "Equipment" || x === "MaterialBalance")).toBe(true);
  });

  it("C2 勾稽：需求端贡献 + 供给端贡献 + residual == 总缺口（浮点≤1e-4·亲验）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(Math.abs(g.demandSide!.contribution + g.supplySide!.contribution + g.residual - g.totalGap)).toBeLessThanOrEqual(1e-4);
    // 端内亦勾稽：Σ叶 == 端贡献。
    for (const c of g.reconChecks) {
      expect(Math.abs(c.sumChildren + c.residual - c.parentGap)).toBeLessThanOrEqual(1e-4);
      expect(c.ok).toBe(true);
    }
    expect(g.reconciled).toBe(true);
  });

  it("WO-Q7-RECONCILED-ROBUST C1：需求虚高 7 叶（p50×5+5000）→ reconciled=true·端内Σ叶==端贡献（治舍入伪影·red-bite）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // q7 dist 口径：所有 DemandSegment.demandWanPerYearP50 ×5 +5000 → 需求端 ~7 叶，逐叶 round(,4) 累积 >1e-4 会误报 reconciled=false。
    const segs = await t.repos.objects.listByType(ADMIN.tenantId, "DemandSegment");
    for (const seg of segs) {
      await t.repos.objects.put({ ...seg, props: { ...seg.props, demandWanPerYearP50: Number(seg.props.demandWanPerYearP50) * 5 + 5000 } });
    }
    const g = await run(t);
    // 末叶余额分摊 → 端内 Σ叶 == 端贡献（浮点精确·非 ≤1e-4 容差侥幸）。
    for (const c of g.reconChecks) {
      if (c.label.includes("端内")) expect(Math.abs(c.sumChildren - c.parentGap)).toBe(0);
      expect(c.ok).toBe(true);
    }
    expect(g.reconciled).toBe(true); // red-bite：逐叶独立 round（无末叶分摊）→ 7 叶累积 >1e-4 → false
    expect(g.summary).not.toContain("勾稽未通过");
    // 顶层 C2 仍精确勾稽（构造 diff=0）。
    expect(Math.abs(g.demandSide!.contribution + g.supplySide!.contribution + g.residual - g.totalGap)).toBeLessThanOrEqual(1e-4);
  });

  it("C3 颗粒铁律①（需求）：改一个 DemandSegment.demandWanPerYearP50 → 需求端占比变（前后 diff）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const segs = await t.repos.objects.listByType(ADMIN.tenantId, "DemandSegment");
    const seg = segs[0]!;
    await t.repos.objects.put({ ...seg, props: { ...seg.props, demandWanPerYearP50: Number(seg.props.demandWanPerYearP50) * 3 + 999 } });
    const after = await run(t);
    expect(after.demandSide!.pct).not.toBe(before.demandSide!.pct); // 需求端占比真变（不变=写死）
    expect(after.reconciled).toBe(true); // 改颗粒后归因自洽
  });

  it("C4 颗粒铁律②（供给）：改一台 Equipment.oee_current → 供给端占比变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const equip = await t.repos.objects.listByType(ADMIN.tenantId, "Equipment");
    // 把全部设备 OEE 砍半 → 设备 OEE 损失驱动大增 → 供给端占比升。
    for (const e of equip) await t.repos.objects.put({ ...e, props: { ...e.props, oee_current: Number(e.props.oee_current ?? 0.85) * 0.5 } });
    const after = await run(t);
    expect(after.supplySide!.pct).not.toBe(before.supplySide!.pct);
    expect(after.supplySide!.pct).toBeGreaterThan(before.supplySide!.pct); // OEE 恶化 → 供给端占比升
    expect(after.reconciled).toBe(true);
  });

  it("C5 叶级真值：每叶 drillType/drillField/drillValue 齐（非叙事常数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    for (const l of [...g.demandSide!.drivers, ...g.supplySide!.drivers]) {
      expect(l.provenance.kind).toBeTruthy();
      expect(l.provenance.drillType).toBeTruthy();
      expect(l.provenance.drillField).toBeTruthy();
      expect(typeof l.provenance.drillValue).toBe("number");
      expect(typeof l.driverValue).toBe("number");
    }
  });

  it("C6 双向敏感：需求虚高 vs 供给不足 → 两侧占比明显不同（引擎真分·非固定五五开）", async () => {
    // 场景A 需求虚高：放大 DemandSegment.demandWanPerYearP50（预测偏差/漂移激增）→ 需求端占比应显著高。
    const ta = await makeApp();
    await seedBattery(ta);
    for (const s of await ta.repos.objects.listByType(ADMIN.tenantId, "DemandSegment"))
      await ta.repos.objects.put({ ...s, props: { ...s.props, demandWanPerYearP50: Number(s.props.demandWanPerYearP50) * 5 + 5000 } });
    const a = await run(ta);
    // 场景B 供给不足：OEE 塌 + 物料缺口放大 → 供给端占比应显著高。
    const tb = await makeApp();
    await seedBattery(tb);
    for (const e of await tb.repos.objects.listByType(ADMIN.tenantId, "Equipment"))
      await tb.repos.objects.put({ ...e, props: { ...e.props, oee_current: 0.2 } });
    for (const mb of await tb.repos.objects.listByType(ADMIN.tenantId, "MaterialBalance"))
      await tb.repos.objects.put({ ...mb, props: { ...mb.props, gapTon: Number(mb.props.gapTon ?? 0) + 50000 } });
    const b = await run(tb);
    // 两场景需求端占比明显不同（证非固定五五开·引擎按真颗粒分）。
    expect(Math.abs(a.demandSide!.pct - b.demandSide!.pct)).toBeGreaterThan(5);
    expect(a.demandSide!.pct).toBeGreaterThan(b.demandSide!.pct); // 需求虚高场景需求端占比更高
  });

  it("C7 R6 确定性：同版本两跑 deep-equal", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("C8 端到端：solver.invoke 一次真输出（双向归因 JSON·summary 含需求端/供给端）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.summary).toContain("需求端");
    expect(g.summary).toContain("供给端");
    expect(g.summary).toContain("勾稽");
  });
});

/**
 * WO-METRICKEY-EMPTY-PROMISE · 空头支票 `metricKey` 的**接缝**：目录声明面 ⊗ 端点回包面。
 *
 * 病（改前实测）：`catalog.ts` 对外声明 `argHints:{metricKey:"达成率指标 key(缺省用 S&OP 产销缺口)"}`，
 * 而 `supplyDemandGapAttribution()` 函数体零处读 args ⇒ 传了**既不报错也不生效**，答案按缺省口径算出来，
 * 调用方（人或模型）以为是按自己指定的那个指标算的 —— 这是**静默错答**，不是"没实现"。
 * 真会传的三条路（复验过、不是推测）：
 *   ① `agentcore/router/ceo-route.ts` 通用 else 支 `if (metricKey) args.metricKey = metricKey`（本求解器落该支）；
 *   ② 种子意图 `ceo_supply_demand_gap` 的 slot `metricKey` + 计划模板 `{{slots.metricKey}}`；
 *   ③ 内置 `discover(kind=solvers)` 工具把 argHints **原样交给模型**（`tools/executor.ts` 的 items 映射）
 *      ⇒ 模型照着提示生成 `metricKey`，而没有任何东西会报错。
 *
 * 修法 = **撤承诺**（非实现）：本体内没有任何 Metric 以万套计量，按指定指标切万套驱动会硬造口径。
 * 撤法两半，缺一半病就回来：**声明面**摘掉 argHint；**回包面**把「你传了、没生效、该去哪」说出口。
 *
 * ⛔ 本 describe 刻意不写"方法能跑通"型断言 —— 那种断言在改前也是绿的，证明不了任何事。
 */
describe("WO-METRICKEY-EMPTY-PROMISE · metricKey 空头支票（声明面 ⊗ 回包面接缝）", () => {
  const SDGA = "supply_demand_gap_attribution";
  type CatalogItemLite = { key: string; description: string; argHints: Record<string, string> };
  type SdgaOut = SDG & { ignoredArgs: { name: string; received: string; reason: string }[] };

  const catalogItems = async (t: TestApp): Promise<CatalogItemLite[]> => {
    const res = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: CatalogItemLite[] }).items;
  };
  /** 走真端点（不是直调私有方法）：调用方传 args → POST invoke → 回包。 */
  const invokeViaEndpoint = async (t: TestApp, args: Record<string, unknown>): Promise<SdgaOut> => {
    const res = await t.app.inject({
      method: "POST", url: `/a/v1/solvers/${SDGA}/invoke`, headers: ADMIN_HEADERS, payload: { args },
    });
    expect(res.statusCode, `POST /a/v1/solvers/${SDGA}/invoke 应 200（撤承诺路不 400 打断既有 CEO 深问）`).toBe(200);
    return (res.json() as { data: SdgaOut }).data;
  };

  it("①声明面：目录/注册表都不再声明 metricKey（含金丝雀——扫描器确实能看见真的 argHint）", async () => {
    const t = await makeApp();
    const items = await catalogItems(t);

    // 金丝雀（**与主判据同一份读法**·铁律 0.6）：报"没有 metricKey"这种否定结论前，先证明我确实读到了 argHints。
    const forecast = items.find((i) => i.key === "capacity_forecast");
    expect(forecast, "金丝雀条目 capacity_forecast 不在目录里 ⇒ 是扫描坏了，不是 metricKey 没了").toBeDefined();
    expect(
      Object.keys(forecast!.argHints),
      "金丝雀：capacity_forecast 必须仍声明 modelId —— 它若也空了，本用例读到的就不是真 argHints",
    ).toContain("modelId");
    // 第二只金丝雀：`gap_attribution` 的 metricKey 是**真读**的（service.ts `args.metricKey` 命中 Metric.key），
    // 必须还在 —— 否则「本文件在扫 metricKey 这个键」这件事本身没被证明过。
    const ga = items.find((i) => i.key === "gap_attribution");
    expect(Object.keys(ga!.argHints), "金丝雀：gap_attribution 的 metricKey 是真读的，不许被一起摘掉").toContain("metricKey");

    // 主判据：本求解器不再声明 metricKey（也不声明任何入参 —— 它一个都不吃）。
    const sdga = items.find((i) => i.key === SDGA);
    expect(sdga, `${SDGA} 必须仍在目录里（撤的是入参声明，不是整条能力）`).toBeDefined();
    expect(Object.keys(sdga!.argHints), `${SDGA} 不许再声明 metricKey（声明了却不读 = 静默错答）`).not.toContain("metricKey");
    expect(Object.keys(sdga!.argHints), `${SDGA} 不吃任何入参 ⇒ argHints 必须为空`).toEqual([]);
    // 「不许只删一行了事」：描述里必须说清为什么没有这个参数 + 想按别的指标看该去哪，
    // 否则下一个人（或模型）会以为是漏了，再加回来。描述是**模型看得见**的那一份，故判据落在它上面。
    expect(sdga!.description, "描述必须写明本求解器不吃入参").toContain("不吃任何入参");
    expect(sdga!.description, "描述必须给出替代正门 gap_attribution").toContain("gap_attribution");

    // 注册表镜像（/a/v1/solvers/registry）同源，不许两份漂移。
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN_HEADERS })).json() as {
      solvers: (CatalogItemLite & { outputShape: string[] })[];
    };
    const regSdga = reg.solvers.find((s) => s.key === SDGA)!;
    expect(Object.keys(regSdga.argHints ?? {}), "注册表镜像也不许留着 metricKey").not.toContain("metricKey");
    expect(regSdga.outputShape, "ignoredArgs 必须进输出形状契约（漏了 = 下游看不见这条回执）").toContain("ignoredArgs");
  });

  it("②回包面：传 metricKey → 200 且回包**点名**说它没生效（不静默吞·理由里给替代正门）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await invokeViaEndpoint(t, { metricKey: "seg_attain_ess" });

    const hit = out.ignoredArgs.find((a) => a.name === "metricKey");
    expect(hit, "传了 metricKey 却在回包里找不到任何交代 ⇒ 静默吞，病没治").toBeDefined();
    expect(hit!.received, "回执必须回显调用方到底传了什么（否则用户无从确认是不是自己那一个）").toBe("seg_attain_ess");
    expect(hit!.reason.length, "理由不能是空串").toBeGreaterThan(10);
    expect(hit!.reason, "理由必须指向替代正门 gap_attribution，不能只说『不支持』").toContain("gap_attribution");
    // summary 是**屏上/模型手里**那一句：回执只落在机器可读字段里，人和模型照样看不见。
    expect(out.summary, "summary 必须点名被忽略的入参").toContain("已忽略入参");
    expect(out.summary, "summary 必须带上参数名").toContain("metricKey");
  });

  it("③不传 → ignoredArgs 为空数组（『没什么可忽略』≠『我没查』）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await invokeViaEndpoint(t, {});
    expect(Array.isArray(out.ignoredArgs), "字段必须恒在（缺字段 = 下游无从区分『没传』与『旧版没这功能』）").toBe(true);
    expect(out.ignoredArgs).toEqual([]);
    expect(out.summary, "什么都没传时不许出现忽略提示").not.toContain("已忽略入参");
  });

  it("④没有第二条口径：传 metricKey 与不传，**归因数值部分逐字节相同**（撤承诺 ≠ 偷换成另一个静默口径）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bare = await invokeViaEndpoint(t, {});
    const withArgs = await invokeViaEndpoint(t, { metricKey: "cash", factorId: "f-x", scope: { baseId: "hefei" } });
    // 只把两个**诚实位**（回执 + 带回执的 summary）摘掉，其余全部对拍：
    // 若哪天真接了入参、算出了第二组数，这里当场红 —— 那时必须回来把新口径的判据补上。
    const strip = (o: SdgaOut): string => {
      const rest: Record<string, unknown> = { ...o };
      delete rest.ignoredArgs;
      delete rest.summary;
      return JSON.stringify(rest);
    };
    expect(strip(withArgs), "传参改变了归因数值 ⇒ 出现了第二条口径，本用例的前提失效，必须回来补判据").toBe(strip(bare));
    // 而三个参数**每一个**都要被点名（判据落在「消费集为空」上，不是一张会过期的已知参数名单）。
    expect(withArgs.ignoredArgs.map((a) => a.name)).toEqual(["factorId", "metricKey", "scope"]); // 按键名升序·R6
    expect(withArgs.ignoredArgs.find((a) => a.name === "scope")!.reason.length).toBeGreaterThan(10); // 未逐个登记的键也有通用理由
  });

  it("⑤R6 确定性：带同一组入参两跑 deep-equal（回执不引入时钟/随机/枚举序抖动）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const args = { metricKey: "demand_attain", zzz: 1, aaa: [1, 2, 3] };
    const a = await invokeViaEndpoint(t, args);
    const b = await invokeViaEndpoint(t, args);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.ignoredArgs.map((x) => x.name), "键名升序（插入序会让回包随调用方 JSON 字段序抖动）").toEqual(["aaa", "metricKey", "zzz"]);
  });
});
