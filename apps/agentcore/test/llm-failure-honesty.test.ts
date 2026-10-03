import { describe, expect, it } from "vitest";
import { classifySynthFailure } from "../src/router/execute-plan.js";

/**
 * 「没配」与「配了但打不通」必须分开报 —— 由来是一次真实的白费工夫。
 *
 * 仓主给了真 Kimi key，审核方绑定时把模型名写成了不存在的 `kimi-k2-0905-preview`
 * （Kimi 真实返回 `Not found the model kimi-k2-0905-preview or Permission denied`，HTTP 404）。
 * 而系统报的是「**当前未接入可用的 LLM 提供商**，请在「设置 → LLM」绑定一个提供商后重试」——
 * 明明已经绑了。照这句话去做，只会在设置页反复检查绑定，而真正要改的是**模型名**。
 *
 * 病灶是 `execute-plan.ts` 里一个**裸 catch**：`} catch { …「无 LLM provider」… }`，
 * 把四种成因完全不同的失败吞成同一句诊断。这与本仓 E1 那处「硬编码诊断」
 * （`STRUCTURAL_GAPS` 无条件断言「全仓没有 Cadence」）是同一种病：
 * **一个断言性的句子，却从不检查它所断言的条件。**
 */
describe("LLM 综合失败 · 真因分档（不许把四种病说成一种）", () => {
  it("真没绑 provider → NO_PROVIDER", () => {
    const f = classifySynthFailure(new Error("no provider"), false);
    expect(f.kind).toBe("NO_PROVIDER");
  });

  it("绑了但模型名不存在（Kimi 真实 404 原文）→ MODEL_MISSING，**不得**报成没绑", () => {
    const real = new Error('{"error":{"message":"Not found the model kimi-k2-0905-preview or Permission denied","type":"resource_not_found_error"}}');
    const f = classifySynthFailure(real, true);
    expect(f.kind, "绑了 provider 却报 NO_PROVIDER → 会把人指去设置页白查一遍").toBe("MODEL_MISSING");
    expect(f.detail).toContain("kimi-k2-0905-preview"); // 原文要带上，否则还是不知道改哪个名字
  });

  it("HTTP 404 裸形态也判 MODEL_MISSING", () => {
    expect(classifySynthFailure(new Error("request failed with status 404"), true).kind).toBe("MODEL_MISSING");
  });

  it("限流 → RATE_LIMITED（等/换模型，不是去绑定）", () => {
    expect(classifySynthFailure(new Error("429 Too Many Requests"), true).kind).toBe("RATE_LIMITED");
    expect(classifySynthFailure(new Error("rate limit exceeded"), true).kind).toBe("RATE_LIMITED");
  });

  it("其余失败 → CALL_FAILED 并保留原文（超时/网络/5xx 都要能看见到底怎么了）", () => {
    const f = classifySynthFailure(new Error("ETIMEDOUT connect"), true);
    expect(f.kind).toBe("CALL_FAILED");
    expect(f.detail).toContain("ETIMEDOUT");
  });

  it("四档互不相同 —— 若有人把分档改回「一律 NO_PROVIDER」，本条即红", () => {
    const kinds = new Set([
      classifySynthFailure(new Error("x"), false).kind,
      classifySynthFailure(new Error("404 model not found"), true).kind,
      classifySynthFailure(new Error("429"), true).kind,
      classifySynthFailure(new Error("boom"), true).kind,
    ]);
    expect(kinds.size, "四种成因必须产出四种不同判定；塌缩成一种 = 回到「一句诊断盖所有病」").toBe(4);
  });
});
