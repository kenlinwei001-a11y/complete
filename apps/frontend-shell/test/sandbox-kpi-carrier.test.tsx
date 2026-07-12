import { describe, expect, it } from "vitest";
import type { SandboxViewConfig, TickState } from "@platform/contracts";
import { carrierMean } from "@/views/sim/SandboxView";

/**
 * WO-RC-UX-KPI-CARRIER（感知层命门·治「推了没反应·死的」错觉·一手证据 VERIFIED§1③）：
 * KPI 磁贴 carrierMean 原只认初始快照载体 → 传导目标（Base.loadIndex 无初始载体）tick 后恒 0（主视觉 DAG 真变、磁贴不动）。
 * 修：携带者 = 初始载体 ∪ tick 后 world 有非零真值的对象（KILL-MOCK-RED 取真 post-tick 态·不补 0·不复稀释 WO-CAP-03）。
 */

const CFG = {
  nodeObjectIds: { Base: ["wuhan", "xiamen", "zigong"], ARInvoice: ["inv1"] },
  // 初始快照：Base 只有 util 载体·loadIndex 无载体（= 审核实测 demo：传导目标初始无载体）。
  nodeObjectState: {
    wuhan: { util: 90 }, xiamen: { util: 92 }, zigong: { util: 88 },
  },
} as unknown as SandboxViewConfig;

describe("carrierMean · tick 后传导目标纳入携带者（磁贴随 DAG 真动·非恒 0）", () => {
  it("green→red：loadIndex 初始无载体·tick 后 world 写入非零 → 磁贴取真 post-tick 均值（非 0）", () => {
    // tick 后世界态：Base.loadIndex 被传导写入真值（DAG Σ0→Σ 真变）；未触及对象（ARInvoice）恒 0/缺。
    const worldPostTick: TickState = {
      wuhan: { util: 90, loadIndex: 1940000 },
      xiamen: { util: 92, loadIndex: 1940000 },
      zigong: { util: 88, loadIndex: 842481 },
      inv1: { loadIndex: 0 }, // 未触及对象 world 恒 0 → 不得纳入（防复稀释 WO-CAP-03）
    };
    const r = carrierMean(CFG, worldPostTick, "loadIndex");
    // 修前：初始无 loadIndex 载体 → ids 空 → {value:0, carriers:0}（磁贴恒 0 = 死的错觉）。
    // 修后：3 个 Base（非零传导目标）纳入·inv1(0) 排除。
    expect(r.carriers).toBe(3);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeCloseTo((1940000 + 1940000 + 842481) / 3, 0);
  });

  it("初始载体照常 + 不因 tick 后 0 值稀释（WO-CAP-03 守恒）：util 仍只 3 载体均值", () => {
    const world: TickState = {
      wuhan: { util: 90, loadIndex: 100 }, xiamen: { util: 92, loadIndex: 100 }, zigong: { util: 88, loadIndex: 100 },
      inv1: { util: 0, loadIndex: 0 }, // 未触及 0 → 不纳入 util（初始非载体·world 0）
    };
    const r = carrierMean(CFG, world, "util");
    expect(r.carriers).toBe(3); // inv1 的 util=0 不纳入（防稀释）
    expect(r.value).toBeCloseTo((90 + 92 + 88) / 3, 5);
  });

  it("tick 0（world=初始快照·传导目标未写入）→ loadIndex 无携带者·诚实 0（未推进时不臆造）", () => {
    const world0: TickState = { wuhan: { util: 90 }, xiamen: { util: 92 }, zigong: { util: 88 } };
    const r = carrierMean(CFG, world0, "loadIndex");
    expect(r).toEqual({ value: 0, carriers: 0 }); // 未 tick → 传导目标无值 → 诚实 0（非补值）
  });
});
