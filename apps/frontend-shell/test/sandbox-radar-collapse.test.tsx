import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SimCertification } from "@platform/contracts";
import { SimReadinessPanel } from "@/views/sim/SimReadinessPanel";
import { simCertVerdict, simRadarHumanLabel, summarizeCertGaps } from "@/locales/zh";

/**
 * WO-SANDBOX-RADAR-COLLAPSE（S4·纯前端·执行 REVIEW "拒绝照搬竞品形式"一刀）：
 *  ① L0-L4 黑话台阶 → 一句人话结论（能不能拿来决策）·台阶/三元组/Trial Tick 收「查看认证详情」折叠（DOM 全保留）。
 *  ② 主雷达三维换人话名（structure/knowledge/behavior → 数据/结构齐备 等）·值 DERIVE 自 cert 不改数（R13）。
 *  ③ feature sim.radar_collapse 关 → 原样（L0-L4 stepper 主视觉·无一句话·旧 DOM 未删·回退演练 §5.5）。
 */

const mkCert = (over: Partial<SimCertification> = {}): SimCertification => ({
  scope: "GLOBAL",
  targetRef: null,
  level: "L2_RUNNABLE",
  dims: { structure: 100, knowledge: 25, behavior: 14, composite: 52 },
  l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
  trialTick: { passed: true, rulesFired: 3, at: "2026-07-11T00:00:00.000Z", error: null },
  worldCompleteness: {
    pct: 41,
    stateVars: { present: 5, needed: 5 },
    derivationRules: { present: 2, needed: 4 }, // 缺
    actions: { present: 12, needed: 12 },
    propagationRules: { present: 1, needed: 3 }, // 缺
    entering: [],
  },
  canEnterSimulation: false,
  gaps: [{ gapCode: "NO_SLICE", ref: "Base", detail: "未全归域" }],
  computedAt: "2026-07-11T00:00:00.000Z",
  ...over,
});

afterEach(cleanup);

describe("simCertVerdict · L0-L4 → 一句人话结论（R14 i18n·R13 派生·不新造真值）", () => {
  it("每级映射正确 + gaps 占位拼入", () => {
    expect(simCertVerdict("L4_CERTIFIED", "")).toContain("可直接据此落 Action");
    expect(simCertVerdict("L3_VERIFIED", "残项")).toContain("可支持决策");
    expect(simCertVerdict("L2_RUNNABLE", "前向闭合(规则 scope 类型缺失)")).toContain("仅供参考");
    expect(simCertVerdict("L2_RUNNABLE", "前向闭合(规则 scope 类型缺失)")).toContain("前向闭合");
    expect(simCertVerdict("L1_CONFIGURED", "")).toContain("尚不可推演");
    // FDE 校正：L1 不再硬套"世界未就绪"（worldCompleteness 可能 100%·真断点在闭合/可观测）
    expect(simCertVerdict("L1_CONFIGURED", "")).not.toContain("世界未就绪");
    expect(simCertVerdict("L0_INVALID", "")).toContain("尚不可推演");
  });
});

describe("summarizeCertGaps · cert.gaps → 人话缺件桶（FDE 校正·诚实指向真断点·R14 关键词桶）", () => {
  it("前向闭合/图查询覆盖/归域 归类去重；未命中桶回退 gapCode", () => {
    const gaps = [
      { gapCode: "NO_SLICE", ref: "closure:FORWARD", detail: "FORWARD rule:C24->Quote：规则 scope 类型缺失（HARD）" },
      { gapCode: "NO_SLICE", ref: "closure:FORWARD", detail: "FORWARD rule:C45->Action：规则 scope 类型缺失（HARD）" },
      { gapCode: "NO_SLICE", ref: "GLOBAL", detail: "图查询覆盖 40/43 对象，切片 48 < minQueries 1" },
    ];
    const s = summarizeCertGaps(gaps);
    expect(s).toContain("前向闭合"); // 两条 FORWARD 去重成一桶
    expect(s).toContain("图查询覆盖不足");
    expect(s.split("、").length).toBe(2); // 去重
    expect(summarizeCertGaps([{ gapCode: "WEIRD_CODE", ref: "x", detail: "y" }])).toBe("WEIRD_CODE"); // 回退
  });
});

describe("simRadarHumanLabel · 三维人话映射（R14·未登记回退原 label 诚实不臆造）", () => {
  it("structure/knowledge/behavior → 人话；未登记键回退 fallback", () => {
    expect(simRadarHumanLabel("structure", "结构")).toBe("数据/结构齐备");
    expect(simRadarHumanLabel("knowledge", "知识")).toBe("规则/知识覆盖");
    expect(simRadarHumanLabel("behavior", "行为")).toBe("行为已验证");
    expect(simRadarHumanLabel("__unknown__", "原名")).toBe("原名");
  });
});

describe("SimReadinessPanel · humanize 开/关（一句人话 + 详情折叠 vs 原样·DOM 全保留）", () => {
  const radar = <svg data-testid="fake-radar" />;

  it("humanize 关（默认）→ L0-L4 stepper 主视觉内联·无一句话结论（原样·回退演练）", () => {
    render(<SimReadinessPanel cert={mkCert()} scope="GLOBAL" onScopeChange={() => {}} radar={radar} />);
    expect(screen.getByTestId("sim-cert-level")).toBeTruthy(); // stepper 内联可见
    expect(screen.queryByTestId("sim-cert-verdict")).toBeNull(); // 无一句话结论
    expect(screen.queryByTestId("sim-cert-details")).toBeNull(); // 无折叠详情卡
  });

  it("humanize 开 → 一句人话结论置顶(L2·仅供参考·缺派生规则/传导规则) + L0-L4 台阶收「查看认证详情」折叠(DOM 保留)", () => {
    render(<SimReadinessPanel cert={mkCert()} scope="GLOBAL" onScopeChange={() => {}} radar={radar} humanize />);
    // 一句人话结论
    const verdict = screen.getByTestId("sim-cert-verdict");
    expect(verdict.getAttribute("data-cert-level")).toBe("L2_RUNNABLE");
    expect(screen.getByTestId("sim-cert-verdict-text").textContent).toContain("仅供参考");
    expect(screen.getByTestId("sim-cert-verdict-text").textContent).toContain("类型未归域"); // gaps 真派生自 cert.gaps(未全归域→桶)
    // L0-L4 台阶黑话收进折叠详情卡（默认折叠·DOM 保留）
    const details = screen.getByTestId("sim-cert-details");
    expect(details.getAttribute("data-open")).toBe("0"); // 默认折叠
    expect(screen.getByTestId("sim-cert-level")).toBeTruthy(); // stepper 仍在 DOM（hidden 保留·功能不删）
    // 三元组/Trial Tick 详情也在 DOM
    expect(screen.getByTestId("sim-cert-l4-triad")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-trial-tick")).toBeTruthy();
  });

  it("值一致（只重组不改数·R13）：humanize 开/关 canEnter + 综合值同源", () => {
    const { rerender } = render(<SimReadinessPanel cert={mkCert()} scope="GLOBAL" onScopeChange={() => {}} radar={radar} />);
    const canEnterOff = screen.getByTestId("sim-cert-canenter").textContent;
    rerender(<SimReadinessPanel cert={mkCert()} scope="GLOBAL" onScopeChange={() => {}} radar={radar} humanize />);
    expect(screen.getByTestId("sim-cert-canenter").textContent).toBe(canEnterOff); // 结论文字未改数
    expect(screen.getByTestId("sim-cert-composite").textContent).toContain("52"); // 综合值 === cert.dims.composite
  });

  it("L4 结论 → 可直接落 Action（决策级人话·不同级不同结论）", () => {
    render(<SimReadinessPanel cert={mkCert({ level: "L4_CERTIFIED", canEnterSimulation: true })} scope="GLOBAL" onScopeChange={() => {}} radar={radar} humanize />);
    expect(screen.getByTestId("sim-cert-verdict-text").textContent).toContain("可直接据此落 Action");
  });

  it("FDE 校正回归：worldCompleteness=100% 但仍有闭合缺件 → 结论指向真断点(前向闭合/图查询覆盖)·绝不臆断「世界未就绪」", () => {
    // 复现用户 FDE 实测：demo L1·世界完整度 100%·卡在前向闭合 + 图查询覆盖（非 world-completeness）。
    const cert = mkCert({
      level: "L1_CONFIGURED",
      worldCompleteness: {
        pct: 100,
        stateVars: { present: 11, needed: 11 },
        derivationRules: { present: 11, needed: 11 },
        actions: { present: 12, needed: 12 },
        propagationRules: { present: 3, needed: 3 }, // 全齐·world 100%
        entering: [],
      },
      gaps: [
        { gapCode: "NO_SLICE", ref: "closure:FORWARD", detail: "FORWARD rule:C24->Quote：规则 scope 类型缺失（HARD）" },
        { gapCode: "NO_SLICE", ref: "GLOBAL", detail: "图查询覆盖 40/43 对象，切片 48 < minQueries 1" },
      ],
    });
    render(<SimReadinessPanel cert={cert} scope="GLOBAL" onScopeChange={() => {}} radar={radar} humanize />);
    const text = screen.getByTestId("sim-cert-verdict-text").textContent ?? "";
    expect(text).toContain("前向闭合"); // 指向真断点
    expect(text).toContain("图查询覆盖不足");
    expect(text).not.toContain("世界未就绪"); // 世界 100% 齐·不臆断（诚实·KILL-MOCK-RED 精神）
  });
});
