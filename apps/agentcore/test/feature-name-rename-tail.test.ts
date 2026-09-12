import { describe, expect, it } from "vitest";
import { SHARED_FEATURE_NAMES } from "@platform/contracts";
import { FEATURE_REGISTRY } from "../src/features/registry.js";

/**
 * WO-AGENTCORE-RENAME-TAIL · 机制测试：三个被改名视图键在 **agentcore 侧**的显示名
 * 必须逐字节等于契约 `feature-names.ts` 的册值。
 *
 * 为什么有了 `assertSharedFeatureNames` 模块加载期抛，还要这条测试：
 *   ① 加载期抛只覆盖「册里有的键且本地写了别的名」——`view.global-sim` agentcore **没声明**，
 *      抛的射程够不到「agentcore 未来加这个键时写错名」之外更细的三个键逐键点名；
 *   ② 加载期抛的报错位置在 import 栈里，这条测试把「哪个键、册值、本地值」写成**断言级**证据；
 *   ③ 修文案是一次性的，测试才是机制 —— 变异反证（把 registry 字面量改回旧名）必须红。
 *
 * 改名三方（仓主拍板 WO-IA-E2E5E6 · featureName 名册由本单解锁）：
 *   view.project-sim  项目推演 → 接单可行性
 *   view.global-sim   全局项目推演 → 接单组合优选（「优选」非「最优」：求解器无最优性保证，强承诺不上屏）
 *   view.plan-generate 方案生成 → 规划建议（前单已对齐，这里锚住防退化）
 */

const RENAMED = [
  ["view.project-sim", "接单可行性"],
  ["view.global-sim", "接单组合优选"],
  ["view.plan-generate", "规划建议"],
] as const;

describe("WO-AGENTCORE-RENAME-TAIL · agentcore 侧显示名 == 契约册值", () => {
  it("金丝雀：agentcore FEATURE_REGISTRY 真读到了（空数组 = import 坏了，不是「没分叉」）", () => {
    expect(FEATURE_REGISTRY.length).toBeGreaterThan(30);
    expect(FEATURE_REGISTRY.some((d) => d.key === "view.project-sim")).toBe(true);
  });

  it("册值本身是仓主拍板的新名（锚住册，防册被改回旧名而副本跟着「一致地错」）", () => {
    for (const [key, expected] of RENAMED) {
      expect(SHARED_FEATURE_NAMES[key], `册里 ${key} 不是拍板新名`).toBe(expected);
    }
  });

  it("agentcore 声明了的键：显示名逐字节等于册值", () => {
    for (const [key] of RENAMED) {
      const local = FEATURE_REGISTRY.find((d) => d.key === key);
      if (!local) continue; // 未声明的键由下一个用例守
      expect(local.name, `${key} 在 agentcore registry 的名字与册不符`).toBe(SHARED_FEATURE_NAMES[key]);
    }
  });

  it("view.project-sim / view.plan-generate agentcore 必须声明且为新名（这两键 agentcore 在跑）", () => {
    expect(FEATURE_REGISTRY.find((d) => d.key === "view.project-sim")?.name).toBe("接单可行性");
    expect(FEATURE_REGISTRY.find((d) => d.key === "view.plan-generate")?.name).toBe("规划建议");
  });

  it("view.global-sim：agentcore 当前未声明（射程交底）；若未来声明，名字必须取自册", () => {
    const local = FEATURE_REGISTRY.find((d) => d.key === "view.global-sim");
    if (local) {
      expect(local.name).toBe(SHARED_FEATURE_NAMES["view.global-sim"]);
    } else {
      // 未声明是合法现状（功能册三份里 agentcore 不复制该键）——写明确认这不是"漏了断言"
      expect(SHARED_FEATURE_NAMES["view.global-sim"]).toBe("接单组合优选");
    }
  });
});
