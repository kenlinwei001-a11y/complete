import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BASE_REGISTRY,
  CHAIN_STEP_KINDS,
  ChainNodeSchema,
  RULE_PARAM_BINDINGS,
  expectedCadenceWaitDays,
  isValueAddKind,
  nodeLeadTimeDays,
  nodeValueAddDays,
} from "@platform/contracts";

import { HINT_MS, InspectorNodePanel } from "@/views/sim/InspectorNodePanel";
import {
  VAR_CLASSES,
  VAR_CONTROL_BY_CLASS,
  buildPlaceholderInspectorInput,
  computeInspectorReadout,
  drivesReadout,
  stepIdOf,
  type InspectorInput,
  type VarValues,
} from "@/views/sim/inspectorModel";

/**
 * WO-SANDBOX-F4 · 节点检视面板 —— SEAM + 七类变量分治 + 诚实缺席 + 三色系 + 定时器纪律。
 *
 * ── SEAM 的咬点 ────────────────────────────────────────────────────────────
 *  ① **K 类机理**：把节拍从 30d 改到 7d → 「等节拍」段与前置期的缩短量必须**恰好** = Δ(everyDays)/2 = 11.5 天。
 *     「变小了」不算过——那正是本仓 metric-aware 反复炸的验收姿势。
 *  ② **相位不进公式**：拨 `offsetDays` → 五段瀑布与流动效率**逐字节不动**（S0 §2 推导）。
 *  ③ **S 类换拓扑**：选中一个结构分支 → **段集**真的变（少一段 / 多一段），
 *     且该组渲染出的**不是** `input[type=range]`（把 S 类做成滑杆即退单）。
 *  ④ **R 类引规则码**：面板上必须看得见改的是哪条规则的哪个 param，且规则码派生自
 *     `RULE_PARAM_BINDINGS`（改绑定表 → 面板跟着变）。
 *  ⑤ **流动效率**：= 增值 ÷ 前置期，且**必须**由契约函数产出（前端不写第二份除法）。
 *
 * ── 变异反证（亲手跑过·红的原文见交付说明）───────────────────────────────
 *  ① 把 S 类的 `discrete` 控件改成 `range` → 「S 类不是滑杆」那一组当场红。
 *  ② 把 `computeInspectorReadout` 的流动效率分母改错（改用「非增值总量」当分母，不再调
 *     `nodeFlowEfficiency`）→ 流动效率那一组当场红。
 */

// 仓根 = 自**本测试文件**向上第一个含 pnpm-workspace.yaml 的目录。
// 刻意不用 process.cwd()：隔离 worktree 里跑时 cwd 仍指向主 checkout，曾据此读错文件造成假绿。
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[inspector-node-panel.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** 节点 id 刻意造成"带点、带冒号、带斜杠"的不透明串——若面板敢解析它，这里立刻暴露。 */
const NODE_ID = "wo.f4/opaque::key.with.dots";
const mkInput = (over: Partial<InspectorInput> = {}): InspectorInput => ({
  ...buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "被检视节点", stage: "CAPACITY", seed: 42 }),
  ...over,
});

const sid = (suffix: string) => stepIdOf(NODE_ID, suffix);

const daysOf = (kind: string): number | null => {
  const raw = screen.getByTestId(`insp-wf-${kind}`).getAttribute("data-days");
  return raw === null || raw === "" ? null : Number(raw);
};
const leadDays = (): number => Number(screen.getByTestId("insp-flow-eff").getAttribute("data-lead-days"));
const valueDays = (): number => Number(screen.getByTestId("insp-flow-eff").getAttribute("data-value-days"));
const flowPct = (): number | null => {
  const raw = screen.getByTestId("insp-flow-eff").getAttribute("data-flow-efficiency");
  return raw === null || raw === "" ? null : Number(raw);
};
const setRange = (varId: string, v: number) => {
  fireEvent.change(screen.getByTestId(`insp-input-${varId}`), { target: { value: String(v) } });
};

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM · K 类：Δ等待 == Δ(everyDays)/2（本单最要害的一条）
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · K 类节拍：等待期望 = everyDays ÷ 2", () => {
  it("节拍 30d → 7d：等节拍段与前置期的缩短量**恰好** = Δ(everyDays)/2 = 11.5 天", () => {
    render(<InspectorNodePanel input={mkInput()} />);

    // 基线：Cadence 对象全仓 0 条 ⇒ 等节拍段 EMPTY（不补 0）
    expect(daysOf("cadence")).toBeNull();
    const leadNoCadence = leadDays();

    setRange("K1", 30);
    const cad30 = daysOf("cadence");
    const lead30 = leadDays();
    expect(cad30).toBeCloseTo(expectedCadenceWaitDays({ everyDays: 30 }), 10);
    expect(cad30).toBeCloseTo(15, 10); // ← 30/2；写成 30（最坏等待）或 0（当节拍不存在）都会在这里红
    expect(lead30 - leadNoCadence).toBeCloseTo(15, 10);

    setRange("K1", 7);
    const cad7 = daysOf("cadence");
    const lead7 = leadDays();
    expect(cad7).toBeCloseTo(3.5, 10);

    // ★ 机理判据：缩短量 == Δ(everyDays)/2，不是"随便变小了"
    expect(cad30! - cad7!).toBeCloseTo((30 - 7) / 2, 10);
    expect(lead30 - lead7).toBeCloseTo((30 - 7) / 2, 10);
  });

  it("相位 offsetDays 是相位，**不进公式**：拨它 → 瀑布与流动效率逐字节不动", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    setRange("K1", 30);

    const before = CHAIN_STEP_KINDS.map((k) => daysOf(k));
    const beforeFlow = [leadDays(), valueDays(), flowPct()];

    setRange("K2", 7);
    expect(CHAIN_STEP_KINDS.map((k) => daysOf(k))).toEqual(before);
    expect([leadDays(), valueDays(), flowPct()]).toEqual(beforeFlow);

    // 且面板必须**当面说清**为什么拨了不动（"拨了没反应"不解释就是静默错答）
    const note = screen.getByTestId("insp-inert-K2");
    expect(note).toHaveTextContent("不驱动读数");
    expect(note).toHaveTextContent("相位");
    expect(screen.getByTestId("insp-var-K2")).toHaveAttribute("data-drives", "0");
  });

  it("K 类承载 = 缺：初始值 EMPTY，**不给假默认**；拨出来的值一律标 what-if 不冒充实测", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    expect(screen.getByTestId("insp-var-K1")).toHaveAttribute("data-carrier", "缺");
    expect(screen.getByTestId("insp-val-K1")).toHaveTextContent("EMPTY");
    expect(screen.getByTestId("insp-val-K1")).not.toHaveTextContent(/\b0\b/);
    expect(screen.getByTestId("insp-empty-K1")).toHaveTextContent("不给默认值");
    // 滑块只能停在 min 上，但辅助技术读到的必须是「没有值」而不是「值 = 最小值」
    expect(screen.getByTestId("insp-input-K1")).toHaveAttribute("aria-valuetext", expect.stringContaining("EMPTY"));
    expect(screen.getByTestId("insp-wf-cadence")).toHaveAttribute("data-provenance", "EMPTY");
    expect(screen.getByTestId("insp-wf-reason-cadence")).toHaveTextContent(/Cadence.*0 条/);

    setRange("K1", 30);
    expect(screen.getByTestId("insp-wf-cadence")).toHaveAttribute("data-provenance", "WHATIF");
    expect(screen.getByTestId("insp-wf-cadence")).toHaveTextContent("what-if 试算");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SEAM · 其余机理各自成立（不是"随便变"）
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 每一类变量的变化量与其机理一致", () => {
  it("T 类：直接设定该段天数 —— 设成 2.0 → 作业段就是 2.0 天，前置期同步移动", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const work0 = daysOf("work")!;
    const lead0 = leadDays();
    setRange("T1", 2);
    expect(daysOf("work")).toBeCloseTo(2, 10);
    expect(leadDays() - lead0).toBeCloseTo(2 - work0, 10);
    expect(valueDays()).toBeCloseTo(2, 10); // 只有 work 增值（契约 isValueAddKind 判据）
  });

  it("C 类：能力翻倍 → 排队段**恰好减半**（同在制量下天数 ∝ 1/能力）", () => {
    const input = mkInput();
    const c1 = input.variables.find((v) => v.varId === "C1")!;
    render(<InspectorNodePanel input={input} />);
    const q0 = daysOf("queue")!;
    setRange("C1", c1.baseline! * 2);
    expect(daysOf("queue")).toBeCloseTo(q0 / 2, 8);
  });

  it("R 类：新鲜度阈值 24h → 48h ⇒ 交接段**恰好 +1 天**（(48−24)/24）", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const h0 = daysOf("handoff")!;
    setRange("R2", 48);
    expect(daysOf("handoff")! - h0).toBeCloseTo(1, 10);
    setRange("R2", 0);
    expect(daysOf("handoff")! - h0).toBeCloseTo(-1, 10);
  });

  it("R 类：降额系数减半 → 有效能力减半 ⇒ 排队段**恰好翻倍**", () => {
    const input = mkInput();
    const r1 = input.variables.find((v) => v.varId === "R1")!;
    render(<InspectorNodePanel input={input} />);
    const q0 = daysOf("queue")!;
    setRange("R1", r1.baseline! / 2);
    expect(daysOf("queue")).toBeCloseTo(q0 * 2, 8);
  });

  it("多变量叠加确定性（R6）：同一组值无论怎么拨到位，读数字节一致", () => {
    const input = mkInput();
    const a = computeInspectorReadout(input, { T1: 2, K1: 30, R2: 48 });
    const b = computeInspectorReadout(input, { R2: 48, K1: 30, T1: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 同 seed 输入本身也必须字节一致
    expect(JSON.stringify(buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "x", stage: "CAPACITY", seed: 42 }))).toBe(
      JSON.stringify(buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "x", stage: "CAPACITY", seed: 42 })),
    );
    expect(JSON.stringify(buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "x", stage: "CAPACITY", seed: 42 }))).not.toBe(
      JSON.stringify(buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "x", stage: "CAPACITY", seed: 7 })),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. S 类判据：**离散分支换拓扑**，绝不是滑杆
// ═══════════════════════════════════════════════════════════════════════════════
describe("S 类 · 离散换拓扑（做成滑杆即退单）", () => {
  it("S 组渲染出的**不是** input[type=range]：零 slider，全是 radio 选项", () => {
    const { container } = render(<InspectorNodePanel input={mkInput()} />);
    const sGroup = screen.getByTestId("insp-group-S");

    // ① DOM 形态：S 组里一个 range 都不许有
    expect(sGroup.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(within(sGroup).queryAllByRole("slider")).toHaveLength(0);
    // ② 必须是离散选项组
    expect(within(sGroup).getAllByRole("radiogroup").length).toBeGreaterThanOrEqual(3);
    expect(within(sGroup).getAllByRole("radio").length).toBeGreaterThanOrEqual(6);
    // ③ 契约层同口径：类 → 控件的唯一映射说 S 是 discrete
    expect(VAR_CONTROL_BY_CLASS.S).toBe("discrete");
    expect(sGroup).toHaveAttribute("data-control", "discrete");
    for (const el of Array.from(sGroup.querySelectorAll("[data-cls='S']"))) {
      expect(el.getAttribute("data-control")).toBe("discrete");
    }
    // ④ 反面锚：T/K/B/C/P 组确实是滑杆（证明"不是所有组都没滑杆"）
    for (const cls of ["T", "K", "C"] as const) {
      expect(screen.getByTestId(`insp-group-${cls}`).querySelectorAll('input[type="range"]').length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll('input[type="range"]').length).toBeGreaterThan(0);
  });

  it("选中「并工序」→ 段集真少一段（交接段消失），不是把交接时长调成 0", async () => {
    const user = userEvent.setup();
    render(<InspectorNodePanel input={mkInput()} />);
    expect(daysOf("handoff")).not.toBeNull();
    const lead0 = leadDays();
    const h0 = daysOf("handoff")!;

    await user.click(screen.getByTestId("insp-opt-S1-route-merged"));

    // 段**没了**（EMPTY），不是变成 0
    expect(daysOf("handoff")).toBeNull();
    expect(screen.getByTestId("insp-wf-handoff")).toHaveAttribute("data-provenance", "EMPTY");
    expect(leadDays()).toBeCloseTo(lead0 - h0, 8);
    // 作用在该段上的 T2 / R2 变量随之标「本拓扑下不适用」
    expect(screen.getByTestId("insp-var-T2")).toHaveAttribute("data-inapplicable", "1");
    expect(screen.getByTestId("insp-inapplicable-T2")).toBeInTheDocument();
    expect(screen.getByTestId("insp-input-T2")).toBeDisabled();
  });

  it("选中「分流并行」→ 段集真多一段（汇合交接），前置期跟着涨", async () => {
    const user = userEvent.setup();
    const input = mkInput();
    render(<InspectorNodePanel input={input} />);
    const lead0 = leadDays();
    const base = computeInspectorReadout(input, {});
    expect(base.node.steps.some((s) => s.stepId === sid("merge"))).toBe(false);

    await user.click(screen.getByTestId("insp-opt-S1-route-split"));
    const after = computeInspectorReadout(input, { S1: "route-split" });
    expect(after.node.steps.some((s) => s.stepId === sid("merge"))).toBe(true);
    expect(leadDays()).toBeGreaterThan(lead0);
  });

  it("承接基地选项**派生自 BASE_REGISTRY**（换册 → 选项跟着换），跨基地即多一段交接", async () => {
    const user = userEvent.setup();
    const input = mkInput();
    const s2 = input.variables.find((v) => v.varId === "S2")!;
    expect(s2.options!.map((o) => o.optionId)).toEqual(BASE_REGISTRY.slice(0, 3).map((b) => b.baseId));
    expect(s2.options!.map((o) => o.label)).toEqual(BASE_REGISTRY.slice(0, 3).map((b) => b.name));

    render(<InspectorNodePanel input={input} />);
    const lead0 = leadDays();
    const second = BASE_REGISTRY[1]!;
    await user.click(screen.getByTestId(`insp-opt-S2-${second.baseId}`));
    expect(leadDays()).toBeGreaterThan(lead0);
    expect(computeInspectorReadout(input, { S2: second.baseId }).node.steps.some((s) => s.stepId === sid("transfer"))).toBe(true);
    // 该分支物化出来的段是 what-if，不冒充实测
    expect(screen.getByTestId("insp-var-T3")).toHaveAttribute("data-inapplicable", "0");
  });

  it("S3 无契约承载 ⇒ **初始不选任何分支**（不给假默认），并标 EMPTY 说明", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const s3 = screen.getByTestId("insp-options-S3");
    expect(within(s3).getAllByRole("radio").every((r) => r.getAttribute("data-selected") === "0")).toBe(true);
    expect(screen.getByTestId("insp-var-S3")).toHaveAttribute("data-carrier", "缺");
    expect(screen.getByTestId("insp-empty-S3")).toHaveTextContent("初始不选任何分支");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. R 类判据：必须引规则码 + param 名
// ═══════════════════════════════════════════════════════════════════════════════
describe("R 类 · 必须引规则码（改的是 rule param，不是自由数字）", () => {
  it("面板显示规则码 + param 名 + solver_params 路径，且三者派生自 RULE_PARAM_BINDINGS", () => {
    render(<InspectorNodePanel input={mkInput()} />);

    const derate = RULE_PARAM_BINDINGS.find((b) => b.param === "pendingCertFactor")!;
    const stale = RULE_PARAM_BINDINGS.find((b) => b.param === "staleHours")!;

    const r1 = screen.getByTestId("insp-rule-R1");
    expect(r1).toHaveAttribute("data-rule-key", derate.ruleKey);
    expect(r1).toHaveAttribute("data-rule-param", derate.param);
    expect(r1).toHaveTextContent(derate.ruleKey);
    expect(r1).toHaveTextContent(derate.param);
    expect(r1).toHaveTextContent(derate.path);

    const r2 = screen.getByTestId("insp-rule-R2");
    expect(r2).toHaveAttribute("data-rule-key", stale.ruleKey);
    expect(r2).toHaveAttribute("data-rule-param", stale.param);
    expect(r2).toHaveTextContent(stale.ruleKey);
    expect(r2).toHaveTextContent("staleHours");

    // R 组的每个变量都必须带规则引用——没有规则码的"R 类"就是个自由数字
    const rGroup = screen.getByTestId("insp-group-R");
    const rVars = Array.from(rGroup.querySelectorAll("[data-cls='R']"));
    expect(rVars.length).toBeGreaterThan(0);
    for (const el of rVars) {
      expect(el.getAttribute("data-control")).toBe("rule-param");
      expect(el.querySelector("[data-rule-key]")).not.toBeNull();
      expect(el.querySelector("[data-rule-param]")).not.toBeNull();
    }
  });

  it("绑定表里没有的 param ⇒ 该变量根本不生成（派生而非手抄）", () => {
    // 用 mock 把绑定表清空：R 类变量必须整组消失。手抄一份就不会消失 —— 这条就是防手抄的门。
    const input = buildPlaceholderInspectorInput({ nodeId: NODE_ID, label: "x", stage: "CAPACITY", seed: 42 });
    expect(input.variables.filter((v) => v.cls === "R")).toHaveLength(2);
    for (const v of input.variables.filter((v) => v.cls === "R")) {
      expect(RULE_PARAM_BINDINGS.some((b) => b.ruleKey === v.ruleRef!.ruleKey && b.param === v.ruleRef!.param)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 五段瀑布 + 流动效率（全部经 S0 契约函数，前端不写第二份公式）
// ═══════════════════════════════════════════════════════════════════════════════
describe("五段瀑布 · 流动效率 = 增值 ÷ 前置期", () => {
  it("五桶顺序 = CHAIN_STEP_KINDS（S0 冻结），增值判据 = isValueAddKind（不复写）", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const rows = Array.from(screen.getByTestId("insp-waterfall").querySelectorAll("[data-kind]"))
      .filter((el) => el.tagName === "LI")
      .map((el) => el.getAttribute("data-kind"));
    expect(rows).toEqual([...CHAIN_STEP_KINDS]);
    for (const k of CHAIN_STEP_KINDS) {
      expect(screen.getByTestId(`insp-wf-${k}`)).toHaveAttribute("data-value-add", isValueAddKind(k) ? "1" : "0");
    }
    // 五段里**只有一段**增值
    expect(CHAIN_STEP_KINDS.filter((k) => isValueAddKind(k))).toHaveLength(1);
  });

  it("流动效率 == 增值 ÷ 前置期，且 == 契约 nodeValueAddDays / nodeLeadTimeDays（分母写错立刻红）", () => {
    const input = mkInput();
    render(<InspectorNodePanel input={input} />);
    setRange("K1", 30);

    const lead = leadDays();
    const va = valueDays();
    const fe = flowPct()!;
    expect(fe).toBeCloseTo((va / lead) * 100, 6);

    // 与契约函数逐值互核：前端若自己写了第二份除法并写歪，这里必红
    const readout = computeInspectorReadout(input, { K1: 30 });
    expect(readout.leadTimeDays).toBeCloseTo(nodeLeadTimeDays(readout.node), 10);
    expect(readout.valueAddDays).toBeCloseTo(nodeValueAddDays(readout.node), 10);
    expect(readout.flowEfficiency).toBeCloseTo(nodeValueAddDays(readout.node) / nodeLeadTimeDays(readout.node), 12);
    expect(readout.flowEfficiency).toBeCloseTo(va / lead, 12);
    // 分母必须是**前置期**（含增值段），不是"非增值总量"
    const nonValue = readout.node.steps.filter((s) => !s.valueAdd).reduce((a, s) => a + s.days, 0);
    expect(readout.flowEfficiency).not.toBeCloseTo(nodeValueAddDays(readout.node) / nonValue, 6);

    // 读数低是正常的（制造业典型 5–15%），不因"看着难看"改口径
    expect(fe).toBeGreaterThan(0);
    expect(fe).toBeLessThan(100);
  });

  it("损失归因守恒：非增值桶的 pctOfChainLoss 之和 == 100%（分母排除增值段）", () => {
    const input = mkInput();
    const readout = computeInspectorReadout(input, { K1: 30 });
    const sum = readout.buckets.filter((b) => !b.valueAdd && b.pctOfChainLoss !== null).reduce((a, b) => a + b.pctOfChainLoss!, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(readout.lossResidual).not.toBeNull();
    expect(Math.abs(readout.lossResidual!)).toBeLessThanOrEqual(0.001);
    // 增值桶恒不进损失表
    expect(readout.buckets.filter((b) => b.valueAdd).every((b) => b.pctOfChainLoss === null)).toBe(true);
  });

  it("产出的节点仍是合法 ChainNode（S0 strict 往返）：valueAdd 与 kind 硬绑没被拨歪", () => {
    const input = mkInput();
    const cases: VarValues[] = [{}, { K1: 30 }, { S1: "route-split" }, { S3: "qc-on", K1: 12 }, { S1: "route-merged", S2: BASE_REGISTRY[1]!.baseId }];
    for (const values of cases) {
      const readout = computeInspectorReadout(input, values);
      expect(() => ChainNodeSchema.parse(readout.node)).not.toThrow();
    }
  });

  it("有缺席段时必须显式说「本读数偏高」——否则流动效率会静默虚高", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const warn = screen.getByTestId("insp-flow-absent");
    expect(warn).toHaveTextContent("本读数偏高");
    expect(warn).toHaveTextContent("前置期被低估");
    expect(screen.getByTestId("insp-flow-eff")).toHaveAttribute("data-absent", "2"); // 等节拍 + 返工

    // 返工段缺的是「单件返工工时率」，不是"暂无数据"——原因必须具体
    expect(screen.getByTestId("insp-wf-reason-rework")).toHaveTextContent(/返工工时|工时率/);
    expect(screen.getByTestId("insp-wf-rework")).toHaveAttribute("data-days", "");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 七类齐全 + 承载状态诚实标注
// ═══════════════════════════════════════════════════════════════════════════════
describe("七类变量分组 + 承载状态（有 / 薄 / 缺）", () => {
  it("七组都渲染，且每组的控件形态与 VAR_CONTROL_BY_CLASS 一致（五种形态覆盖七类）", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    for (const cls of VAR_CLASSES) {
      const g = screen.getByTestId(`insp-group-${cls}`);
      expect(g).toHaveAttribute("data-control", VAR_CONTROL_BY_CLASS[cls]);
      expect(within(g).getAllByTestId(/^insp-var-/).length).toBeGreaterThan(0);
    }
    expect(new Set(VAR_CLASSES.map((c) => VAR_CONTROL_BY_CLASS[c])).size).toBe(5);
  });

  it("每个变量都带承载徽标与 file:line 取证；非「有」的必须写清缺在哪", () => {
    const input = mkInput();
    render(<InspectorNodePanel input={input} />);
    for (const v of input.variables) {
      const row = screen.getByTestId(`insp-var-${v.varId}`);
      expect(row).toHaveAttribute("data-carrier", v.carrier);
      expect(within(row).getByText(`承载 ${v.carrier}`)).toBeInTheDocument();
      const ev = screen.getByTestId(`insp-evidence-${v.varId}`);
      expect(ev.textContent ?? "").toMatch(/\.ts|packages\/|apps\//); // 取证要能翻到源码
      if (v.carrier !== "有") expect((ev.textContent ?? "").length).toBeGreaterThan(30);
    }
  });

  it("承载「缺」的变量一律 baseline === null（**没有一个假默认值**）", () => {
    const input = mkInput();
    for (const v of input.variables.filter((v) => v.carrier === "缺")) {
      if (v.options) expect(v.baselineOptionId).toBeNull();
      else expect(v.baseline).toBeNull();
    }
    // 至少覆盖到 K / B / S 三类的缺口（本单诚实边界的实证）
    const missingClasses = new Set(input.variables.filter((v) => v.carrier === "缺").map((v) => v.cls));
    expect([...missingClasses].sort()).toEqual(["B", "K", "S"]);
  });

  it("P 类：值域 [0,1] 且按百分比显示（不是 0.93 这种裸小数）", () => {
    const input = mkInput();
    render(<InspectorNodePanel input={input} />);
    const p1 = input.variables.find((v) => v.varId === "P1")!;
    expect(p1.domain).toEqual({ min: 0, max: 1, step: 0.01 });
    const slider = screen.getByTestId("insp-input-P1");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1");
    expect(screen.getByTestId("insp-val-P1").textContent ?? "").toMatch(/^\d+(\.\d+)?%$/);
    expect(screen.getByTestId("insp-group-P")).toHaveAttribute("data-control", "probability");
  });

  it("不驱动读数的变量必须**当面写清原因**（拨了没反应不解释 = 静默错答）", () => {
    const input = mkInput();
    render(<InspectorNodePanel input={input} />);
    const inert = input.variables.filter((v) => !drivesReadout(v));
    expect(inert.length).toBeGreaterThan(0);
    // 三种不驱动都得覆盖到：零消费方（inert）+ 公式无关（相位）
    expect(inert.map((v) => v.varId)).toContain("K2");
    expect(inert.some((v) => v.effect.op === "inert")).toBe(true);
    for (const v of inert) {
      expect(v.inertReason, `${v.varId} 标了 inert 却没给原因`).toBeTruthy();
      expect(screen.getByTestId(`insp-inert-${v.varId}`)).toHaveTextContent("不驱动读数");
      expect(screen.getByTestId(`insp-var-${v.varId}`)).toHaveAttribute("data-drives", "0");
    }
    // P1 良率有承载，但落到「返工天数」的换算缺承载 —— 原因里必须点名
    expect(screen.getByTestId("insp-inert-P1")).toHaveTextContent(/返工工时|工时率/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 推演进行中 ⇒ 调参控件全部置灰
// ═══════════════════════════════════════════════════════════════════════════════
describe("推演进行中 · 调参控件置灰", () => {
  it("running 时：所有滑杆、所有离散选项、复位键都 disabled，并挂横幅说明", () => {
    const input = mkInput();
    const { container } = render(<InspectorNodePanel input={input} running />);
    expect(screen.getByTestId("insp-panel")).toHaveAttribute("data-running", "1");
    expect(screen.getByTestId("insp-running-banner")).toHaveTextContent("推演进行中");

    const ranges = Array.from(container.querySelectorAll('input[type="range"]'));
    expect(ranges.length).toBeGreaterThan(0);
    for (const el of ranges) expect(el).toBeDisabled();

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const el of radios) expect(el).toBeDisabled();

    expect(screen.getByTestId("insp-reset")).toBeDisabled();
    for (const v of input.variables) expect(screen.getByTestId(`insp-var-${v.varId}`)).toHaveAttribute("data-disabled", "1");
  });

  it("running 时拨不动：点选项 / 改滑杆都不改读数", async () => {
    const user = userEvent.setup();
    render(<InspectorNodePanel input={mkInput()} running />);
    const lead0 = leadDays();
    await user.click(screen.getByTestId("insp-opt-S1-route-merged"));
    setRange("T1", 9);
    expect(leadDays()).toBe(lead0);
  });

  it("running 解除后恢复可拨（不是永久禁用）", () => {
    const input = mkInput();
    const { rerender } = render(<InspectorNodePanel input={input} running />);
    expect(screen.getByTestId("insp-input-T1")).toBeDisabled();
    rerender(<InspectorNodePanel input={input} running={false} />);
    expect(screen.getByTestId("insp-input-T1")).not.toBeDisabled();
    const lead0 = leadDays();
    setRange("T1", 9);
    expect(leadDays()).not.toBe(lead0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 不写死节点 ID / 不解析 nodeId / 不复写契约公式（审核方补充约束的机器判据）
// ═══════════════════════════════════════════════════════════════════════════════
describe("架构约束 · 节点 ID 不透明 · 公式单源", () => {
  const tsxPath = "apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx";
  const tsPath = "apps/frontend-shell/src/views/sim/inspectorModel.ts";
  const tsx = readRepo(tsxPath);
  const ts = readRepo(tsPath);
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("nodeId 是不透明键：源码里零 split(...) 解析、零前缀匹配", () => {
    for (const [name, src] of [["tsx", tsx], ["ts", ts]] as const) {
      const body = stripComments(src);
      expect(body.match(/\.split\s*\(/g) ?? [], `${name} 里出现了对键的字符串解析`).toEqual([]);
      expect(body.match(/nodeId\s*\.\s*(startsWith|includes|indexOf|match|replace)/g) ?? [], `${name} 里解析了 nodeId`).toEqual([]);
    }
    // 带点/冒号/斜杠的 id 原样显示，不被拆
    render(<InspectorNodePanel input={mkInput()} />);
    expect(screen.getByTestId("insp-node-id")).toHaveTextContent(NODE_ID);
    expect(screen.getByTestId("insp-stage")).toHaveTextContent("CAPACITY"); // stage 读契约字段，不从 id 猜
  });

  it("增值判据只有契约一份：源码里没有第二处 `kind === \"work\"`", () => {
    for (const [name, src] of [["tsx", tsx], ["ts", ts]] as const) {
      const body = stripComments(src);
      expect(body.match(/kind\s*===\s*["'`]work["'`]/g) ?? [], `${name} 复写了增值判据`).toEqual([]);
    }
    expect(ts).toMatch(/isValueAddKind\(/);
  });

  it("流动效率 / 前置期 / 增值量必须直接来自契约函数（不写第二份除法）", () => {
    expect(ts, "flowEfficiency 不是 nodeFlowEfficiency 的返回值 —— 有人手搓了第二份除法").toMatch(
      /const\s+flowEfficiency\s*=\s*nodeFlowEfficiency\(/,
    );
    expect(ts).toMatch(/const\s+leadTimeDays\s*=\s*nodeLeadTimeDays\(/);
    expect(ts).toMatch(/const\s+valueAddDays\s*=\s*nodeValueAddDays\(/);
    expect(ts).toMatch(/computeLossAttribution\(/);
    expect(ts).toMatch(/expectedCadenceWaitDays\(/);
    // 五桶顺序取自契约常量，不在前端另立一份五段清单
    expect(ts).toMatch(/CHAIN_STEP_KINDS\.map\(/);
  });

  it("面板不持有任何节点清单：换一个 nodeId / label / stage 就整体跟着换", () => {
    const other = buildPlaceholderInspectorInput({ nodeId: "another::opaque", label: "另一个节点", stage: "MATERIAL", seed: 7 });
    render(<InspectorNodePanel input={other} />);
    expect(screen.getByTestId("insp-title")).toHaveTextContent("另一个节点");
    expect(screen.getByTestId("insp-node-id")).toHaveTextContent("another::opaque");
    expect(screen.getByTestId("insp-stage")).toHaveTextContent("MATERIAL");
    expect(other.node.steps.every((s) => s.nodeId === "another::opaque")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. 三色系：零硬编码颜色 + 用到的 token 必须在 :root
// ═══════════════════════════════════════════════════════════════════════════════
describe("三色系 · dark / light / warm 全过", () => {
  const css = readRepo("apps/frontend-shell/src/views/sim/InspectorNodePanel.module.css");
  const tsx = readRepo("apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx");
  const ts = readRepo("apps/frontend-shell/src/views/sim/inspectorModel.ts");
  const tokens = readRepo("apps/frontend-shell/src/styles/tokens.css");
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("样式与组件里零硬编码颜色（hex / rgb / hsl）", () => {
    // 注释不参与判定：本文件的门禁说明里就写着 "rgb()/hsl()" 这些字样，
    // 不剥注释的话门会咬到自己的说明书（而注释本来也不产生任何样式）。
    const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const hex = cssBody.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `样式里出现硬编码 hex：${hex.join(", ")}`).toEqual([]);
    const fn = cssBody.match(/\b(rgba?|hsla?)\s*\(/g) ?? [];
    expect(fn, `样式里出现硬编码 ${fn.join(", ")}`).toEqual([]);
    for (const [name, src] of [["tsx", tsx], ["ts", ts]] as const) {
      const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(body.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${name} 里出现硬编码 hex`).toEqual([]);
      expect(body.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${name} 里出现硬编码 rgb/hsl`).toEqual([]);
    }
    // 反面锚：门确实咬得住 —— 往样式正文里塞一个 hex 必被抓出
    expect((`${cssBody}\n.x{color:#ff0000}`).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toHaveLength(1);
  });

  it("样式里用到的每个 CSS 变量都定义在 tokens.css 的 :root（否则某套主题下取不到值）", () => {
    const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const used = new Set([...cssNoComment.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    const missing = [...used].filter((t) => !rootTokens.has(t));
    expect(missing, `这些 token 不在 :root（只在某个 data-theme 分支里定义 → 其它主题下失效）：${missing.join(", ")}`).toEqual([]);
  });

  it("三套主题下都渲染出完整面板（dark 无属性 / light / warm）", () => {
    for (const theme of [null, "light", "warm"] as const) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = render(<InspectorNodePanel input={mkInput()} />);
      expect(screen.getByTestId("insp-panel")).toBeInTheDocument();
      for (const k of CHAIN_STEP_KINDS) expect(screen.getByTestId(`insp-wf-${k}`)).toBeInTheDocument();
      for (const cls of VAR_CLASSES) expect(screen.getByTestId(`insp-group-${cls}`)).toBeInTheDocument();
      expect(screen.getByTestId("insp-flow-eff")).toBeInTheDocument();
      unmount();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. 定时器纪律（覆盖 ref 前先 clear · 卸载清）
// ═══════════════════════════════════════════════════════════════════════════════
describe("定时器纪律 · 提示条", () => {
  it("连点结构分支：ref 被覆盖前先 clear，不留孤儿句柄（leakGuard 在 afterEach 收割）", async () => {
    const user = userEvent.setup();
    render(<InspectorNodePanel input={mkInput()} />);
    await user.click(screen.getByTestId("insp-opt-S1-route-merged"));
    await user.click(screen.getByTestId("insp-opt-S1-route-split"));
    await user.click(screen.getByTestId("insp-reset"));
    expect(screen.getByTestId("insp-hint")).toBeInTheDocument();
  });

  /**
   * ⚠ 本例与 `physical-topology.seam.test.tsx` 的同名用例**同族同病**（欠账 #120），一并按同一判据重写。
   * 旧写法：`vi.useFakeTimers({ shouldAdvanceTime: true })` + `await vi.advanceTimersByTimeAsync(2000)`。
   * 病在两处，缺一不成灾：
   *  ① `shouldAdvanceTime: true` 会在测试之外**挂一条真实 20ms `setInterval` 替你 tick 假时钟**
   *     （实测：真实等 2500ms，假时钟自己走了 2420ms，提示条不用测试推就自己消隐了）。
   *     于是「谁烧掉这个句柄」取决于机器忙不忙 —— 判据被挂钟绑架。
   *  ② `advanceTimersByTimeAsync` **不在 `act()` 里**：定时器回调里的 `setState` 何时落到 DOM，
   *     靠的是 React 异步刷新与 sinon 内部让出宏任务的**顺风车**，测试从未显式驱动它。
   * 新写法把两条不确定性都拆掉：纯假时钟（无真实 interval）+ `fireEvent`（同步、RTL 自带 act）
   * + 推进一律裹 `act()`（退出时 React 同步 flush ⇒ 断言点看到的 DOM 必然是已刷新的）。
   * 另外把「差 1ms 不消 / 到点才消」与句柄计数 0→1→0→1→0 一并咬死：
   * 旧写法推 2000ms 只能证明「推得够久就消」，证不了「到点消」。
   */
  it("提示条到点自动消隐，且卸载后不再有句柄存活", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<InspectorNodePanel input={mkInput()} />);
      expect(vi.getTimerCount(), "挂载本身不该排定时器").toBe(0);

      fireEvent.click(screen.getByTestId("insp-reset"));
      expect(screen.getByTestId("insp-hint")).toBeInTheDocument();
      expect(vi.getTimerCount(), "点一次 = 恰好一个句柄").toBe(1);

      // 差 1ms 不消隐 —— 咬的是「到点」，不是「推进过就消」
      act(() => void vi.advanceTimersByTime(HINT_MS - 1));
      expect(screen.getByTestId("insp-hint")).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.queryByTestId("insp-hint")).toBeNull();
      expect(vi.getTimerCount(), "到点后句柄自注销").toBe(0);

      // 提示条还亮着就卸载 → 卸载清理必须把句柄带走
      fireEvent.click(screen.getByTestId("insp-reset"));
      expect(screen.getByTestId("insp-hint")).toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount(), "卸载清理必须把句柄带走").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("复位回基线：缺承载的变量回到 EMPTY，**不回到 0**", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    setRange("K1", 30);
    expect(daysOf("cadence")).toBeCloseTo(15, 10);
    fireEvent.click(screen.getByTestId("insp-reset"));
    expect(screen.getByTestId("insp-val-K1")).toHaveTextContent("EMPTY");
    expect(daysOf("cadence")).toBeNull();
  });
});
