import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
 *     —— 实测 demo（SEED_DEMO=1 真跑 GET /a/v1/sim/sessions/:id/certification）23 条 = 行动 10 · 传导 13 · 派生 0，标题里的名词一条都没有；
 *  ③ `trialTick.rulesFired` 数的是派生依赖图**节点数**，而那趟空跑零求值、传导核根本没被调用（欠账 #152）；
 *  ④ 「已认证 · 可进入推演」与一个远不满的「完整度 N%」并排贴着不解释，读起来自相矛盾
 *     （真跑 demo：L4_CERTIFIED ∧ canEnter=true ∧ 完整度 64%）。
 *
 * 本门的判据一句话：**屏上每个数字/每句话，都要能回答「它度量的到底是什么」。**
 *
 * ══ 2026-08-14 · WO-UI-BURNDOWN-21：三处断言按新的**层**重写（不是放宽）══
 * 这几句解释按 `docs/CONVENTION-ui-information-layering.md` §1 降进了 `?` 浮层
 * （第一层留窄而准的徽标/数值 + `?` 记号）。原来的 `getByTestId(...).textContent` 写法
 * 此后必然拿不到文字 —— 但那不等于文字没了。故断言改成**降层三判据**：
 *   ① `?` 记号默认可见 ② 浮层正文默认不在 DOM ③ hover 后原文一字不少。
 * ⚠ 第 ③ 条是要害：少了它，「降层」与「删除」在测试里长得一模一样，
 *   而本仓这门课的原话就是「静默降层等于删除」。
 * ⚠ 写法：默认态用 `expect(q).toBeNull()`，**不许**用 `not.toBeVisible()` ——
 *   浮层关着时 `queryByTestId` 返回 `null`，jest-dom 会抛 "received value must be an
 *   HTMLElement"，那是**测试自己报错**，不是判据成立。
 *
 * 哪几句**没有**降层（同一份规范的 §4.2，方向相反）：
 *   「⚠ 已发布 N 条传导规则，本次一条都没触发」留在第一层 ——
 *   不看它，「传导触发 0/N」会被读成「本来就没规则」。只有后半句「为什么不触发」进了浮层。
 */

/** 降层三判据的公共动作：hover 那个 `?`，把浮层正文取回来。 */
async function openInfo(testId: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  expect(screen.getByTestId(`info-${testId}`), "第一层没有 `?` 记号 ⇒ 静默降层 = 删除").toBeVisible();
  expect(screen.queryByTestId(`info-body-${testId}`), "浮层正文默认就在 DOM ⇒ 它没起到收纳作用").toBeNull();
  await user.hover(screen.getByTestId(`info-wrap-${testId}`));
  return await screen.findByTestId(`info-body-${testId}`);
}

const okClosure = (): ClosureReport => ({
  gatePassed: true,
  findings: [{ kind: "OBJECT", ref: "Node", status: "BOUND" }],
  objectsBound: 1, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0,
  buildMode: "STRICT", advisoryCount: 0, blocked: false,
});
const noGaps = (): GapReport => ({
  question: "", taskId: "t", verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: "2026-01-01T00:00:00Z",
});
/**
 * **生产实参口径**（铁律 0.5 判据⑥：带布尔开关的分支，必须核对"生产传的那个值"真的被测到）。
 *
 * ⚠ 本 fixture 于 WO-CERT-CONTRACT-RECONCILE 修正过一次，来历要留着：
 *   原文写「`app.ts` 的空跑恒传 `propagationCovered: false`」——那在 WO-CERT-HONESTY 自己那条
 *   分支上是真的，但合流到本线后**已不成立**：canonical 侧的 WO-SIM-SCOPE-TRIAL 让认证路
 *   **真跑了传导相**，生产恒传 `true`。若照旧钉 `false`，这个 SEAM 门就会**验一条生产已经不走的路**
 *   且全绿 —— 正是本仓记载的 `G-SEED-PROVENANCE-BACKFILL-UNASSERTED` 形态。
 *   故默认 fixture 一律跟生产走；`false` 那支另有专门用例（见 ③b：抛错/未覆盖时）。
 */
const trial = (): TrialTickInput => ({
  passed: true,
  derivationNodes: 7,
  propagationRulesFired: PROP_COUNT, // 生产：传导相真跑，三条规则都产出了贡献
  propagationRulesDeclared: PROP_COUNT,
  propagationCovered: true,
  at: "2026-01-01T00:00:00Z", error: null,
});

/**
 * WO 指定的接缝画像：**派生 0 · 行动 10 · 传导 3**（共 13 条 entering）。
 * 选它是因为它复刻了实测 demo 的**形态**（派生恒 0、其余全是行动与传导），
 * 而旧标题偏偏管这一整串叫「状态变量」。
 * ⚠ 只是形态相同，**数量不同**：真 demo 今天是 23 条（行动 10 · 传导 13 · 派生 0）——
 *   本门用固定小样本保证确定性 R6，不跟着种子数据漂。
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

    // 后端这一半：13 条 entering，派生 0 条（形态同实测 demo：派生恒 0）。
    expect(cert.worldCompleteness.entering).toHaveLength(ACTION_COUNT + PROP_COUNT);
    expect(cert.worldCompleteness.entering.filter((e) => e.kind === "DERIVATION")).toHaveLength(0);

    // 前端这一半：三类计数一眼可见，且**用词与 kind 一一对应**。
    const groups = screen.getByTestId("sim-cert-entering-groups");
    expect(groups.textContent).toBe(`行动 ${ACTION_COUNT} · 传导 ${PROP_COUNT} · 派生 0`);

    // 分组区块：有内容的两组在，空的那组不渲染空壳。
    expect(screen.getByTestId("sim-cert-entering-group-ACTION")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-entering-group-PROPAGATION")).toBeTruthy();
    expect(screen.queryByTestId("sim-cert-entering-group-DERIVATION")).toBeNull();

    // 标题里绝不许再出现「状态变量」——这 13 条里没有一条是状态变量（真 demo 23 条同样一条都没有）。
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

  it("③a Trial Tick 每个数各叫各的名：派生报**规模**、传导报**真触发/分母**，屏上绝无「规则触发 N 条」", async () => {
    const cert = renderPanel(skewedScope());

    // 后端口径：派生那个数是规模（名副其实），传导那两个数是真触发与分母。
    expect(cert.trialTick.derivationNodes).toBe(7);
    expect(cert.trialTick.propagationRulesFired).toBe(PROP_COUNT);
    expect(cert.trialTick.propagationRulesDeclared).toBe(PROP_COUNT);
    expect(cert.trialTick.propagationCovered).toBe(true); // 生产实参：传导相真的跑了

    // 过渡字段仍在（契约 additive 可回退），但**语义已作废**：它是规模+触发的和，量纲不成立。
    // 判据不是"它消失了"，而是"屏上不再拿它当'触发数'说话"（见下一条断言）。
    expect(cert.trialTick.rulesFired).toBe(7 + PROP_COUNT);

    const card = screen.getByTestId("sim-cert-trial-tick");
    // 旧文案「规则触发 N 条」会被读成「传导跑过了、只是没触发」——屏上必须绝迹。
    expect(card.textContent ?? "").not.toContain("规则触发");
    expect(screen.getByTestId("sim-cert-trial-derivation-nodes").textContent).toContain("派生图节点 7 个");
    expect(screen.getByTestId("sim-cert-trial-propagation-fired").textContent).toContain(`传导触发 ${PROP_COUNT}/${PROP_COUNT} 条`);
    // 传导真跑了 ⇒ 不该再挂「未纳入」提示；也没有全哑火 ⇒ 不该挂哑火告警。
    expect(screen.queryByTestId("sim-cert-trial-propagation-uncovered")).toBeNull();
    expect(screen.queryByTestId("sim-cert-trial-propagation-silent")).toBeNull();
    // passed 的语义写在屏上：它证明的是「重算没崩」，不是「这个世界推得动」。
    expect(screen.getByTestId("sim-cert-trial-passed").textContent).toContain("重算未抛异常");
    // passed 的语义仍然写在屏上，只是**换了层**：第一层留 `?` 记号，正文 hover 才出（见文件头记账）。
    expect(card.textContent ?? "", "这句还留在第一层 ⇒ 降层没做").not.toContain("不代表这个世界已经推动过");
    const meaning = await openInfo("sim-cert-trial-meaning");
    expect(meaning.textContent, "降层把这句降没了 —— 那是删除不是分层").toContain("不代表这个世界已经推动过");
    /**
     * ⚠ 2026-08-17 WO-SCREEN-PLAINSPEAK 改判据落点，**守的承诺一个字没放宽**。
     *
     * 原断言咬 `"派生依赖图可拓扑排序"` —— 「可拓扑排序」是图论术语，属 R-UI-4
     * 点名的形态：判据「这句话用户读了能做什么决定？」对它答不出来。
     * 现文案把**同一个数学事实**说成人话：「派生关系没有互相打转（**无环**）」。
     * 「可拓扑排序」与「无环」在有向图上**是同一个命题**（DAG ⟺ 存在拓扑序），
     * 所以这不是换个说法糊弄，是**等价改写**。
     *
     * ⛔ 判据必须仍然咬住那个**限定**（passed 只证明无环，不证明世界推得动），
     * 否则这条断言就退化成「浮层里有字」。故两半都咬：
     *   ① 「无环」这个事实本身还在（换成人话，不是删掉）；
     *   ② 上一行已咬的限定「不代表这个世界已经推动过」还在。
     */
    expect(
      meaning.textContent,
      "「passed 只证明派生关系无环」这个口径被降没了 —— 那是删除不是分层",
    ).toMatch(/无环|没有互相打转/);
    // 「派生图节点」那个数的口径同样在浮层里，原文一字不少。
    const nodes = await openInfo("sim-cert-trial-nodes-meaning");
    expect(nodes.textContent).toContain("派生依赖图规模");
    expect(nodes.textContent).toContain("实际求值 0 条");
  });

  it("③b 病样看得见：declared>0 且 fired===0 ⇒ 屏上明说「一条都没触发」，并入 gaps[]（不是一个静默的 0）", async () => {
    // 这一支就是本仓最常见的病：规则声明了一堆，跑起来一条都不触发。
    // 只报 fired 的话，它与「本来就没有规则」在屏上长得**一模一样**——分辨不了就等于没报。
    const cert = deriveCertification(
      okClosure(), noGaps(),
      { passed: true, derivationNodes: 7, propagationRulesFired: 0, propagationRulesDeclared: PROP_COUNT, propagationCovered: true, at: "t", error: null },
      skewedScope(), DEFAULT_CERT_CONFIG,
    );
    render(<SimReadinessPanel cert={cert} scope="GLOBAL" onScopeChange={() => {}} />);

    expect(cert.gaps.map((g) => g.gapCode)).toContain("PROPAGATION_ALL_SILENT");
    const silent = screen.getByTestId("sim-cert-trial-propagation-silent");
    // 这条诚实位**不点就看得见**（规范 §4.2：不看它，「传导触发 0/N」会被读成「本来就没规则」）。
    expect(silent.textContent).toContain(`已发布 ${PROP_COUNT} 条传导规则`);
    expect(silent.textContent).toContain("一条都没触发");
    // 而「为什么不触发」是口径，降进浮层 —— 原文一字不少。
    const why = await openInfo("sim-cert-trial-silent-why");
    expect(why.textContent).toContain("规则在册，但当前世界态驱动不动传导");
    expect(why.textContent).toContain("闸门未放行");
    // 对照组：**没有**传导规则时（declared=0）不许报哑火——那不是病，是这个世界本来就没传导。
    const noRules = deriveCertification(
      okClosure(), noGaps(),
      { passed: true, derivationNodes: 7, propagationRulesFired: 0, propagationRulesDeclared: 0, propagationCovered: true, at: "t", error: null },
      skewedScope(), DEFAULT_CERT_CONFIG,
    );
    expect(noRules.gaps.map((g) => g.gapCode)).not.toContain("PROPAGATION_ALL_SILENT");
  });

  it("③c 未覆盖传导时（如空跑抛错）⇒ 显式标注「不可解读」并入 gaps[]，绝不把 0 当作「跑了没触发」", () => {
    const cert = deriveCertification(
      okClosure(), noGaps(),
      { passed: true, derivationNodes: 7, propagationRulesFired: 0, propagationRulesDeclared: PROP_COUNT, propagationCovered: false, at: "t", error: null },
      skewedScope(), DEFAULT_CERT_CONFIG,
    );
    render(<SimReadinessPanel cert={cert} scope="GLOBAL" onScopeChange={() => {}} />);
    expect(cert.gaps.map((g) => g.gapCode)).toContain("PROPAGATION_NOT_COVERED");
    expect(screen.getByTestId("sim-cert-trial-propagation-uncovered").textContent).toContain("传导未纳入本次空跑");
    // 未覆盖时不许把 fired 摆出来当结论（0 在这里的含义是"没人跑过"，不是"跑了没触发"）。
    expect(screen.queryByTestId("sim-cert-trial-propagation-fired")).toBeNull();
    expect(screen.queryByTestId("sim-cert-trial-propagation-silent")).toBeNull();
  });

  it("④ 「已认证」与「完整度」并排时必须带一句解释：两者度量不同、互不蕴含（判据不改，只改表达）", async () => {
    // 认证达 L4「✓可进入推演」，同时完整度远不满 —— 老屏上这两个贴一起就是自相矛盾。
    const scope = skewedScope();
    scope.needed = { derivationRules: 20, actions: ACTION_COUNT, propagationRules: PROP_COUNT }; // 应建 33 · 已建 13
    const cert = renderPanel(scope);

    expect(cert.level).toBe("L4_CERTIFIED");
    expect(cert.canEnterSimulation).toBe(true);
    expect(cert.worldCompleteness.pct).toBeLessThan(50); // 两者同屏成立，不是 bug
    expect(screen.getByTestId("sim-cert-canenter").textContent).toContain("可进入推演");

    // 第一层留的是那个**结论**（六个字），解释降进 `?` 浮层 —— 原文一字不少（见文件头记账）。
    const note = screen.getByTestId("sim-cert-completeness-note");
    expect(note.textContent).toContain("完整度 ≠ 认证");
    expect(note.textContent, "整段解释还摆在第一层 ⇒ 降层没做").not.toContain("互不蕴含");
    const body = await openInfo("sim-cert-completeness-note-why");
    expect(body.textContent).toContain("能不能跑");
    expect(body.textContent).toContain("这个世界建得全不全");
    expect(body.textContent).toContain("互不蕴含");
    expect(body.textContent).toContain("只建了一部分的世界");
  });
});
