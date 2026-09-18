import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { bomRowCost, isBomInEffect, selectEffectiveBom } from "../src/bom.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

/**
 * WO-BOM-EFFECTIVE-DATE · 「选出生效 BOM」的函数必须真的看生效日期。
 *
 * 病（修前实测·seed 42·scale S）：`selectEffectiveBom` 的选取式是
 * 「`status==="量产"` 优先 + `bomId` 字典序最小」，**`effectiveDate`/`expireDate` 一个字都不读**
 * （金丝雀：修前 `bom.ts` 里 `effectiveDate` 命中 0 / `expireDate` 命中 0，而同文件 `status` 命中 2
 * ⇒ 查法有鉴别力，是真没读不是没查到）。于是 6/6 型号恒选 `V1.0`，而 V1.0 在业务基准日
 * `forecastStart = 2026-06-10` 已失效 **526 天（≈17.3 个月）**（`expireDate: 2024-12-31`）。
 * ⚠ 派单里写的「约 21 个月」是按**墙上时钟今天**算的；本仓判据只认**业务基准日**
 * （R6 禁时钟），按 `forecastStart` 算是 526 天 —— 两个数不是一回事，此处以可复算的那个为准。
 *
 * ⚠ **本文件的命门是 §3 变异反证**：本仓今日 15 份 BOM 摊开**只有 2 个明细指纹**
 * （同型号 V1.0/V1.1/V2.0 逐行相同 —— `battery.ts` 三版共用同一张 `BOM_ITEM_TEMPLATES`），
 * 所以「改选另一版」在真种子上**算出来的钱一分不差**。
 * 只跑真种子 ⇒ 无论修没修，四个数都一样 ⇒ **证明不了修生效**。
 * 故 §3 在**测试内**造一份「V1.1 明细与 V1.0 不同」的数据（⛔ 不改种子），
 * 让「选错版」与「选对版」第一次产生**不同的钱**。
 */
describe("WO-BOM-EFFECTIVE-DATE · 生效期裁决", () => {
  const ASOF = String(BATTERY_SOLVER_PARAMS.forecastStart); // 2026-06-10，确定性纪元·非时钟（R6）

  // ── ① 真种子·六型逐个：修后选中的 bomId 与生效期画像 ──────────────────────
  it("六型逐个：基准日 2026-06-10 下无一型有「当期量产」BOM ⇒ 全部落 stale-fallback 并被标记", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const hdrs = (await t.repos.objects.listByType("demo", "BOMHeader")).map((o) => o.props);
    const dtls = (await t.repos.objects.listByType("demo", "BOMDetail")).map((o) => o.props);
    const models = [...new Set(hdrs.map((h) => String(h.modelId)))].sort();
    expect(models.length, "金丝雀：种子里应有 6 个型号；为 0 说明没播种，下面的断言全是空转").toBe(6);
    expect(hdrs.length).toBe(15);

    // 判据1 · 修前/修后逐型号选中的 bomId（**实测钉死**，不是推导出来的）。
    // 修前 6/6 恒选 V1.0（不看日期）；修后 3 型改选当期试产 V2.0、3 型无当期候选落 stale-fallback（身份仍 V1.0）。
    const EXPECTED: Record<string, { before: string; after: string; rule: string }> = {
      "2170-NCM": { before: "BOM-2170-NCM-V1.0", after: "BOM-2170-NCM-V1.0", rule: "stale-fallback:量产" },
      "4680-LFP": { before: "BOM-4680-LFP-V1.0", after: "BOM-4680-LFP-V1.0", rule: "stale-fallback:量产" },
      "4680-NCM": { before: "BOM-4680-NCM-V1.0", after: "BOM-4680-NCM-V1.0", rule: "stale-fallback:量产" },
      "圆柱-LFP": { before: "BOM-圆柱-LFP-V1.0", after: "BOM-圆柱-LFP-V2.0", rule: "in-effect:非量产" },
      "方形-LFP": { before: "BOM-方形-LFP-V1.0", after: "BOM-方形-LFP-V2.0", rule: "in-effect:非量产" },
      "方形-NCM": { before: "BOM-方形-NCM-V1.0", after: "BOM-方形-NCM-V2.0", rule: "in-effect:非量产" },
    };
    for (const m of models) {
      const exp = EXPECTED[m];
      expect(exp, `型号 ${m} 不在预期表里 —— 种子型号集变了，判据1 的基线要重取`).toBeDefined();
      const pre = selectEffectiveBom(hdrs, dtls, m); // 修前口径
      expect(String(pre.header?.bomId), `${m}: 修前基线对不上`).toBe(exp!.before);
      expect(pre.rule).toBe("no-date-filter");
      const post = selectEffectiveBom(hdrs, dtls, m, ASOF); // 修后口径
      expect(String(post.header?.bomId), `${m}: 修后选取对不上`).toBe(exp!.after);
      expect(post.rule, `${m}: 裁决路径对不上`).toBe(exp!.rule);
    }

    for (const m of models) {
      const eff = selectEffectiveBom(hdrs, dtls, m, ASOF);
      // 全 6 型：候选里没有一份是「当期 + 量产」——量产两版(V1.0/V1.1)在基准日都已失效，
      // 唯一当期的是试产 V2.0（且只有 3 个型号有 V2.0）。
      expect(eff.dateFilterApplied, `${m}: 给了基准日却没按日期裁决`).toBe(true);
      expect(eff.asOf).toBe(ASOF);
      expect(eff.rule, `${m}: 不该出现「当期量产」这一档`).not.toBe("in-effect:量产");
      // ⛔ 回落必须带标记 —— 这条就是「不许静默回落」的门。
      if (eff.rule.startsWith("stale-fallback")) {
        expect(eff.stale, `${m}: 回落了却没标记 stale ⇒ 问题被藏起来了`).toBe(true);
        expect(eff.inEffectCount, `${m}: 声称全不当期，却又数出当期候选`).toBe(0);
      } else {
        expect(eff.rule).toBe("in-effect:非量产");
        expect(eff.stale).toBe(false);
        expect(String(eff.header?.status)).toBe("试产");
      }
    }
  });

  // ── ② 钱不许动：明细逐行相同 ⇒ 换版后 total 必须逐位不变 ──────────────────
  it("判据2·四数：明细三版逐行相同 ⇒ 无论选哪版，BOM 成本逐位不变（632.835 / 540.2012 不动）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const hdrs = (await t.repos.objects.listByType("demo", "BOMHeader")).map((o) => o.props);
    const dtls = (await t.repos.objects.listByType("demo", "BOMDetail")).map((o) => o.props);
    const mats = await t.repos.objects.listByType("demo", "Material");
    const priceOf = new Map(mats.map((m) => [String(m.props.matId), Number(m.props.unitPrice)]));
    const cost = (rows: Record<string, unknown>[]) =>
      Math.round(rows.reduce((s, r) => s + bomRowCost(r, (id) => priceOf.get(id) ?? 0), 0) * 1e4) / 1e4;

    for (const [modelId, golden] of [
      ["4680-NCM", 632.835],
      ["方形-LFP", 540.2012],
    ] as const) {
      const before = selectEffectiveBom(hdrs, dtls, modelId); // 修前口径（不给基准日）
      const after = selectEffectiveBom(hdrs, dtls, modelId, ASOF); // 修后口径
      expect(cost(before.rows), `${modelId}: 修前金值对不上，基线本身错了`).toBeCloseTo(golden, 4);
      // 核心断言：**钱一分不差**，哪怕选中的 BOM 身份变了。
      expect(cost(after.rows), `${modelId}: 换版后钱变了 ⇒「明细逐行相同」这条前提是错的，停手报出来`).toBeCloseTo(golden, 4);
    }
  });

  it("判据2·端到端：quote_margin 经真求解器给出的 bomCost 不因本单改动而变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const [modelId, golden] of [
      ["4680-NCM", 632.835],
      ["方形-LFP", 540.2012],
    ] as const) {
      const r = await invokeSolver(t, "quote_margin", { custName: "国家电网", modelId });
      expect(r.statusCode).toBe(200);
      const d = r.json() as { data: { breakdown: { bomCost: number } } };
      expect(d.data.breakdown.bomCost, `${modelId}: 报价口径的钱动了`).toBeCloseTo(golden, 4);
    }
  });

  // ── ③ 变异反证（本单命门）：造一份明细不同的 V1.1，证明修真的改变了选取与结果 ──
  it("判据3·变异反证：V1.1 明细与 V1.0 不同时，修前选 V1.0 / 修后选 V1.1，且两者钱不同", () => {
    // ⛔ 不改种子：以下全部是测试内构造的属性包。
    const headers = [
      { bomId: "BOM-T-V1.0", modelId: "T", status: "量产", effectiveDate: "2024-01-01", expireDate: "2024-12-31" },
      { bomId: "BOM-T-V1.1", modelId: "T", status: "量产", effectiveDate: "2024-06-01", expireDate: "2025-06-30" },
    ];
    const details = [
      // V1.0：贵料 10 个单位
      { bomDetailId: "d0", bomId: "BOM-T-V1.0", materialId: "M1", sequence: 1, quantity: 10, lossRate: 0 },
      // V1.1：同一物料只要 3 个单位（工艺优化版真实会发生的变化）
      { bomDetailId: "d1", bomId: "BOM-T-V1.1", materialId: "M1", sequence: 1, quantity: 3, lossRate: 0 },
    ];
    const price = (id: string) => (id === "M1" ? 100 : 0);
    const cost = (rows: Record<string, unknown>[]) => rows.reduce((s, r) => s + bomRowCost(r, price), 0);
    // 基准日落在 V1.0 失效之后、V1.1 失效之前 ⇒ 唯一当期的是 V1.1。
    const ASOF_MID = "2025-01-15";
    expect(isBomInEffect(headers[0]!, ASOF_MID), "金丝雀：V1.0 在该基准日应当已失效").toBe(false);
    expect(isBomInEffect(headers[1]!, ASOF_MID), "金丝雀：V1.1 在该基准日应当仍生效").toBe(true);

    const before = selectEffectiveBom(headers, details, "T"); // 修前口径：不看日期
    const after = selectEffectiveBom(headers, details, "T", ASOF_MID); // 修后口径：看日期

    expect(String(before.header?.bomId), "修前应当恒选字典序最小的 V1.0").toBe("BOM-T-V1.0");
    expect(String(after.header?.bomId), "修后应当选当期的 V1.1 —— 选不动说明日期过滤没生效").toBe("BOM-T-V1.1");
    expect(after.rule).toBe("in-effect:量产");
    expect(after.stale).toBe(false);
    expect(after.inEffectCount).toBe(1);

    // 钱必须真的不同 —— 这一条是「修生效了」的唯一硬证据。
    expect(cost(before.rows)).toBe(1000);
    expect(cost(after.rows)).toBe(300);
    expect(cost(after.rows)).not.toBe(cost(before.rows));
  });

  // ── ④ 全不在生效期：走声明的那条路，不是静默回落 ────────────────────────
  it("判据4·全不当期：返回 stale=true + rule=stale-fallback（回落可见，不是假装正常）", () => {
    const headers = [
      { bomId: "BOM-T-V1.0", modelId: "T", status: "量产", effectiveDate: "2024-01-01", expireDate: "2024-12-31" },
      { bomId: "BOM-T-V1.1", modelId: "T", status: "量产", effectiveDate: "2024-06-01", expireDate: "2025-06-30" },
    ];
    const eff = selectEffectiveBom(headers, [], "T", "2026-06-10");
    expect(eff.inEffectCount).toBe(0);
    expect(eff.stale, "全不当期却没标记 ⇒ 问题被藏起来了").toBe(true);
    expect(eff.rule).toBe("stale-fallback:量产");
    expect(String(eff.header?.bomId), "回落仍需确定性：量产 + bomId 升序").toBe("BOM-T-V1.0");
    // 「没给基准日」与「给了基准日且全过期」必须是两件可区分的事。
    const noDate = selectEffectiveBom(headers, [], "T");
    expect(noDate.rule).toBe("no-date-filter");
    expect(noDate.stale, "没给基准日时不许宣称 stale —— 那是没算，不是算出来过期").toBe(false);
    expect(noDate.dateFilterApplied).toBe(false);
    expect(noDate.asOf).toBeNull();
  });

  it("「给了坏日期」与「没给日期」必须可区分（否则传错的人会以为过滤生效了）", () => {
    const headers = [{ bomId: "B1", modelId: "T", status: "量产", effectiveDate: "2024-01-01", expireDate: "2024-12-31" }];
    for (const bad of ["2026/06/10", "今天", "2026-6-10", "2026-06-10T00:00:00Z"]) {
      const r = selectEffectiveBom(headers, [], "T", bad);
      expect(r.rule, `坏日期「${bad}」应报 bad-date`).toBe("bad-date");
      expect(r.dateFilterApplied).toBe(false);
      expect(r.asOf).toBeNull();
    }
    expect(selectEffectiveBom(headers, [], "T").rule).toBe("no-date-filter");
    // 金丝雀：同一批断言里放一个**好**日期，证明上面报 bad-date 不是因为函数恒报 bad-date。
    expect(selectEffectiveBom(headers, [], "T", "2024-06-01").rule).toBe("in-effect:量产");
  });

  // ── ⑤ 边界：空 expireDate = 未失效（种子里 V2.0 就是空串）────────────────
  it("空 expireDate 视为未失效；空 effectiveDate 视为无起始界", () => {
    const openEnded = { bomId: "B", modelId: "T", status: "试产", effectiveDate: "2025-01-01", expireDate: "" };
    expect(isBomInEffect(openEnded, "2099-12-31"), "空串被当成「已失效」会把唯一当期的那份判死").toBe(true);
    expect(isBomInEffect(openEnded, "2024-12-31"), "早于生效日仍应判未生效").toBe(false);
    const noStart = { bomId: "B", modelId: "T", status: "量产", effectiveDate: "", expireDate: "2025-06-30" };
    expect(isBomInEffect(noStart, "1999-01-01")).toBe(true);
    expect(isBomInEffect(noStart, "2025-07-01")).toBe(false);
  });

  // ── ⑥ 确定性（R6）：同输入两跑逐字节一致，且不读时钟 ────────────────────
  it("R6：同输入重复调用结果逐字节一致", () => {
    const headers = [
      { bomId: "BOM-T-V2.0", modelId: "T", status: "试产", effectiveDate: "2025-01-01", expireDate: "" },
      { bomId: "BOM-T-V1.0", modelId: "T", status: "量产", effectiveDate: "2024-01-01", expireDate: "2024-12-31" },
    ];
    const run = () => JSON.stringify(selectEffectiveBom(headers, [], "T", "2026-06-10"));
    expect(run()).toBe(run());
    // 当期的只有试产 V2.0 ⇒ 状态不再能把一份已退役的版本顶上来。
    expect(JSON.parse(run()).header.bomId).toBe("BOM-T-V2.0");
    expect(JSON.parse(run()).rule).toBe("in-effect:非量产");
  });
});
