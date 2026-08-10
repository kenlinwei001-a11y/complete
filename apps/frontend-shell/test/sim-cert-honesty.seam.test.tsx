import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ClosureReport, GapReport } from "@platform/contracts";

// ── 接缝驱动（SEAM-GATE）：真后端投影函数 → 真前端面板，中间不插任何手写 fixture ──────────
// 咬的是**链路**不是函数：`deriveCertification` 产出的 `entering[]`/`worldCompleteness`/`trialTick`
// 直接喂进 `SimReadinessPanel` 渲染。任一半改了口径（后端换字段名、前端换标题/分组）本门即红。
// 先例：`global-sim-seam-realsolver.test.tsx` 同样直接 import datacore src 驱动真引擎。
import {
  deriveCertification,
  DEFAULT_CERT_CONFIG,
  type CertScope,
  type TrialTickInput,
} from "../../datacore/src/sim/certification.js";
import { SimReadinessPanel } from "@/views/sim/SimReadinessPanel";

/**
 * WO-CERT-HONESTY · 就绪认证面板「口径错标」四处的接缝门。
 *
 * 病灶不是功能缺失，是**名不副实**——数字与名词都在，但没有一个度量它自称度量的东西：
 *  ① `worldCompleteness.stateVars` 与 `derivationRules` 恒等（后端取同一个变量/同一个表达式）；
 *  ② `entering[]` 混装 DERIVATION|ACTION|PROPAGATION 三类，标题却写「状态变量」
 *     —— 实测 demo 13 条里 DERIVATION 恰好 0 条，标题里的名词一条都没有；
 *  ③ `trialTick.rulesFired` 数的是派生依赖图**节点数**，而那趟空跑零求值、传导核根本没被调用（欠账 #152）；
 *  ④ 「已认证 · 可进入推演」与「完整度 33%」并排贴着不解释，读起来自相矛盾。
 *
 * 本门的判据一句话：**屏上每个数字/每句话，都要能回答「它度量的到底是什么」。**
 */

const okClosure = (): ClosureReport => ({
  gatePassed: true,
  findings: [{ kind: "OBJECT", ref: "Node", status: "BOUND" }],
  objectsBound: 1, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0,
  buildMode: "STRICT", advisoryCount: 0, blocked: false,
});
const noGaps = (): GapReport => ({
  question: "", taskId: "t", verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: "2026-01-01T00:00:00Z",
});
/** 生产实参口径：`app.ts` 的空跑恒传 `propagationCovered: false`（跑的是 recompute 不是 propagateTick）。 */
const trial = (): TrialTickInput => ({
  passed: true, derivationNodes: 7, propagationCovered: false, at: "2026-01-01T00:00:00Z", error: null,
});

/**
 * WO 指定的接缝画像：**派生 0 · 行动 10 · 传导 3**。
 * 选它正因为它复刻了实测 demo 的形态——13 条 entering 里一条派生都没有，
 * 而旧标题偏偏管这 13 条叫「状态变量」。
 */
const ACTION_COUNT = 10;
const PROP_COUNT = 3;
const skewedScope = (): CertScope & { computedAt: string } => ({
  kind: "GLOBAL", targetRef: null, computedAt: "2026-01-01T00:00:00Z",
  objectTypes: [
    { typeKey: "Node", bound: true, fieldCount: 2, consumedFieldCount: 2, sliceCovered: true, behaviorReady: true },
  ],
  derivations: [], // ← 派生 0 条
  actions: Array.from({ length: ACTION_COUNT }, (_, i) => ({ key: `act_${i}`, targetTypeKey: "Node" })),
  slices: [{ key: "s" }],
  propagationRules: Array.from({ length: PROP_COUNT }, (_, i) => ({
    key: `p_${i}`, sourceTypeKey: "Node", sourceStateVar: `src_${i}`,
    targetTypeKey: "Node", targetStateVar: "load", present: true,
  })),
  needed: { derivationRules: 0, actions: ACTION_COUNT, propagationRules: PROP_COUNT },
});

function renderPanel(scope: CertScope & { computedAt: string }) {
  const cert = deriveCertification(okClosure(), noGaps(), trial(), scope, DEFAULT_CERT_CONFIG);
  render(<SimReadinessPanel cert={cert} scope="GLOBAL" onScopeChange={() => {}} />);
  return cert;
}

describe("WO-CERT-HONESTY · 就绪认证面板口径（接缝：deriveCertification → SimReadinessPanel）", () => {
  it("② entering[] 按 kind 分组显示真计数「行动 10 · 传导 3 · 派生 0」，标题不再自称「状态变量」", () => {
    const cert = renderPanel(skewedScope());

    // 后端这一半：13 条 entering，派生 0 条（正是实测 demo 的形态）。
    expect(cert.worldCompleteness.entering).toHaveLength(ACTION_COUNT + PROP_COUNT);
    expect(cert.worldCompleteness.entering.filter((e) => e.kind === "DERIVATION")).toHaveLength(0);

    // 前端这一半：三类计数一眼可见，且**用词与 kind 一一对应**。
    const groups = screen.getByTestId("sim-cert-entering-groups");
    expect(groups.textContent).toBe(`行动 ${ACTION_COUNT} · 传导 ${PROP_COUNT} · 派生 0`);

    // 分组区块：有内容的两组在，空的那组不渲染空壳。
    expect(screen.getByTestId("sim-cert-entering-group-ACTION")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-entering-group-PROPAGATION")).toBeTruthy();
    expect(screen.queryByTestId("sim-cert-entering-group-DERIVATION")).toBeNull();

    // 标题里绝不许再出现「状态变量」——这 13 条里没有一条是状态变量。
    const enteringSection = screen.getByTestId("sim-cert-entering");
    const title = enteringSection.firstElementChild!;
    expect(title.textContent).toContain("将进入沙盘的要素");
    expect(title.textContent).not.toContain("状态变量");

    // 逐条仍可见且带真 source（testid 索引沿用原数组序，分组只改呈现）。
    expect(within(screen.getByTestId("sim-cert-entering-0")).getByText(/ACTION act_0/)).toBeTruthy();
    expect(screen.getByTestId(`sim-cert-entering-${ACTION_COUNT}`).textContent).toContain("p_0");
  });

  it("① 「状态变量」不再是派生数的复制品：完整度只剩三对有独立承载物的比值，状态变量改列真名", () => {
    const cert = renderPanel(skewedScope());

    // 后端：worldCompleteness 里已无 stateVars 比值；stateVarKeys = 传导规则 source∪target 去重升序。
    expect(cert.worldCompleteness).not.toHaveProperty("stateVars");
    expect(cert.worldCompleteness.stateVarKeys).toEqual(["load", "src_0", "src_1", "src_2"]);

    // pct 不再把派生在分子分母里各数两遍：(0+10+3)/(0+10+3) = 100%。
    expect(cert.worldCompleteness.pct).toBe(100);

    // 前端：三行比值 + 一行真状态变量名；旧的「状态变量 N/M」比值行已消失。
    expect(screen.getByTestId("sim-cert-wc-派生规则")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-wc-写回行动")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-wc-传导规则")).toBeTruthy();
    expect(screen.queryByTestId("sim-cert-wc-状态变量")).toBeNull();
    const sv = screen.getByTestId("sim-cert-wc-statevars");
    expect(sv.textContent).toContain("世界将承载的状态变量 4 个");
    expect(sv.textContent).toContain("load · src_0 · src_1 · src_2");
  });

  it("① 反证：派生数与状态变量数**不再联动**（改派生只动派生那一行，状态变量清单纹丝不动）", () => {
    // 老口径下这两个数取自同一个变量，改一个必然两个一起变 —— 这条就是那个耦合的探针。
    const scope = skewedScope();
    scope.derivations = [
      { typeKey: "Node", propKey: "risk", sourceVars: ["Node.qty"], present: true },
      { typeKey: "Node", propKey: "eta", sourceVars: ["Node.qty"], present: true },
    ];
    scope.needed.derivationRules = 2;
    const cert = renderPanel(scope);

    expect(cert.worldCompleteness.derivationRules).toEqual({ present: 2, needed: 2 });
    // 状态变量仍只由传导规则决定，与派生的 2 无关。
    expect(cert.worldCompleteness.stateVarKeys).toHaveLength(4);
    expect(screen.getByTestId("sim-cert-entering-groups").textContent).toBe(`行动 ${ACTION_COUNT} · 传导 ${PROP_COUNT} · 派生 2`);
  });

  it("③ Trial Tick 只说它真做过的事：派生图节点数 + 「重算未抛异常」+ 显式标注传导未纳入（欠账 #152）", () => {
    const cert = renderPanel(skewedScope());

    // 后端口径：字段名已改成实测的东西，且这条路恒不覆盖传导。
    expect(cert.trialTick.derivationNodes).toBe(7);
    expect(cert.trialTick.propagationCovered).toBe(false);
    expect(cert.trialTick).not.toHaveProperty("rulesFired");

    const card = screen.getByTestId("sim-cert-trial-tick");
    // 旧文案「规则触发 N 条」会被读成「传导跑过了、只是没触发」——屏上必须绝迹。
    expect(card.textContent ?? "").not.toContain("规则触发");
    expect(screen.getByTestId("sim-cert-trial-derivation-nodes").textContent).toContain("派生图节点 7 个");
    // passed 的语义写在屏上：它证明的是「重算没崩」，不是「这个世界推得动」。
    expect(screen.getByTestId("sim-cert-trial-passed").textContent).toContain("重算未抛异常");
    expect(screen.getByTestId("sim-cert-trial-meaning").textContent).toContain("不代表这个世界已经推动过");
    expect(screen.getByTestId("sim-cert-trial-propagation-uncovered").textContent).toContain("传导未纳入本次空跑");
  });

  it("③ 反向：propagationCovered=true（L3-a 落地后）→「传导未纳入」提示自动消失，无需改 UI 文案", () => {
    const cert = deriveCertification(
      okClosure(), noGaps(),
      { passed: true, derivationNodes: 7, propagationCovered: true, at: "t", error: null },
      skewedScope(), DEFAULT_CERT_CONFIG,
    );
    render(<SimReadinessPanel cert={cert} scope="GLOBAL" onScopeChange={() => {}} />);
    expect(screen.queryByTestId("sim-cert-trial-propagation-uncovered")).toBeNull();
  });

  it("④ 「已认证」与「完整度」并排时必须带一句解释：两者度量不同、互不蕴含（判据不改，只改表达）", () => {
    // 认证达 L4「✓可进入推演」，同时完整度远不满 —— 老屏上这两个贴一起就是自相矛盾。
    const scope = skewedScope();
    scope.needed = { derivationRules: 20, actions: ACTION_COUNT, propagationRules: PROP_COUNT }; // 应建 33 · 已建 13
    const cert = renderPanel(scope);

    expect(cert.level).toBe("L4_CERTIFIED");
    expect(cert.canEnterSimulation).toBe(true);
    expect(cert.worldCompleteness.pct).toBeLessThan(50); // 两者同屏成立，不是 bug
    expect(screen.getByTestId("sim-cert-canenter").textContent).toContain("可进入推演");

    const note = screen.getByTestId("sim-cert-completeness-note");
    expect(note.textContent).toContain("完整度 ≠ 认证");
    expect(note.textContent).toContain("能不能跑");
    expect(note.textContent).toContain("这个世界建得全不全");
    expect(note.textContent).toContain("互不蕴含");
  });
});
