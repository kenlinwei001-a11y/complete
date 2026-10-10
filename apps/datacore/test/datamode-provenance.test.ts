import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-DATAMODE-UNIFY-PROVENANCE（P0·根·三症同源·KILL-MOCK-RED 命门）：统一合成 provenance 判据，闭"合成数据冒充
 * LIVE/实测"。两正交维模型：measurement 维（liveTightness.live·读到真 OEE/util/良率即 LIVE）与 provenance 维
 * （合成种子·origin SYNTHETIC ∪ MATERIALIZED-from-synthetic）正交——本 WO 只补 provenance 维（不动 measurement）。
 *
 * 齿：① A 路合成世界的 risk/capacity 卡·行诚实标 provenanceSynthetic（不冒充实测）；② 唯一真相谓词把
 * MATERIALIZED-from-synthetic 判合成、真导入判非合成（红咬 honest inverse，旧弱判据只看 origin.type 会误判）；
 * ③ measurement 与 provenance 两维并存（合成派生了真字段 → live=true 但 provenanceSynthetic 仍 true）；④ R6 确定性。
 */
describe("WO-DATAMODE-UNIFY-PROVENANCE · 合成不冒充实测（两正交维·provenance 维）", () => {
  it("① A 路合成世界（origin SYNTHETIC）：capacity 逐行 + risk 卡 provenanceSynthetic=true（不冒充实测）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const cap = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 })).json() as {
      data: { perBaseRows: Array<{ base: string; live?: boolean; provenanceSynthetic?: boolean }> };
    };
    expect(cap.data.perBaseRows.length).toBeGreaterThan(0);
    for (const r of cap.data.perBaseRows) {
      expect(r.provenanceSynthetic).toBe(true); // provenance 维：合成种子 → 诚实合成，绝不冒充 LIVE/实测
    }

    // 强制一张 risk 卡（base+factor forced）→ 断言其 provenanceSynthetic=true 且未把合成当决策级实测。
    const risk = (await invokeSolver(t, "risk_timeline", { base: "常州", factor: "设备OEE" })).json() as {
      data: { cards: Array<{ base: string; dataMode?: string; provenanceSynthetic?: boolean }> };
    };
    expect(risk.data.cards.length).toBeGreaterThan(0);
    for (const card of risk.data.cards) expect(card.provenanceSynthetic).toBe(true);
  });

  it("② measurement 维与 provenance 维正交：合成派生真字段 → 存在 live=true 的行，但 provenance 仍标合成", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cap = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 })).json() as {
      data: { perBaseRows: Array<{ live?: boolean; provenanceSynthetic?: boolean }> };
    };
    // 至少一行 measurement=LIVE（合成派生了真 OEE/util/良率字段），却 provenance=合成 → 两维并存、不塌成一维。
    const liveSynth = cap.data.perBaseRows.filter((r) => r.live === true && r.provenanceSynthetic === true);
    expect(liveSynth.length).toBeGreaterThan(0);
  });

  it("③ 唯一真相谓词：MATERIALIZED-from-synthetic 判合成·真导入判非合成（红咬·honest inverse）", async () => {
    const t = await makeApp();
    // demo 本体经真建模链产出（viaModelingChain）→ 对象 MATERIALIZED-from-synthetic（源连接 conn-mes 已诚实标 synthetic）。
    await t.services.synthetic.runJob(t.adminCtx, { industry: "battery-manufacturing", scale: "S", seed: 42, viaModelingChain: true });
    const pred = await t.services.solvers.buildSynthProvenancePredicate("demo");

    const base = await t.repos.objects.get("demo", "obj_base_changzhou");
    expect(base!.origin.type).toBe("MATERIALIZED"); // 现状：MATERIALIZED-from-synthetic（旧弱判据 origin.type→误判真导入）
    expect(pred(base!)).toBe(true); // 治本：唯一真相谓词判其为合成 → 不冒充 LIVE

    // honest inverse（红咬）：真导入对象 = MATERIALIZED 且 datasetId ∉ 合成数据集集 → 非合成（真导入即真实测底料）。
    const realImport = { id: "obj_base_real", tenantId: "demo", type: "Base", props: { baseId: "real" }, origin: { type: "MATERIALIZED", datasetId: "rds-real-erp-not-synthetic" } } as unknown as ObjectInstance;
    expect(pred(realImport)).toBe(false);
    // origin 缺省 → 非合成（防御·不冒充合成）。
    const noOrigin = { id: "obj_x", tenantId: "demo", type: "Base", props: {}, origin: undefined } as unknown as ObjectInstance;
    expect(pred(noOrigin)).toBe(false);
    // origin SYNTHETIC（A 路直注）→ 合成。
    const synthObj = { id: "obj_y", tenantId: "demo", type: "Base", props: {}, origin: { type: "SYNTHETIC", jobId: "j" } } as unknown as ObjectInstance;
    expect(pred(synthObj)).toBe(true);
  });

  it("④ R6 确定性：同 seed 两跑 provenanceSynthetic 分类字节一致（无时钟/随机）", async () => {
    const classify = async (): Promise<Array<[string, boolean]>> => {
      const t = await makeApp();
      await seedBattery(t);
      const pred = await t.services.solvers.buildSynthProvenancePredicate("demo");
      const bases = (await t.repos.objects.listByType("demo", "Base")).sort((a, b) => (a.id < b.id ? -1 : 1));
      return bases.map((b) => [b.id, pred(b)] as [string, boolean]);
    };
    const a = await classify();
    const b = await classify();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every(([, synth]) => synth === true)).toBe(true); // 合成世界全合成
  });
});
