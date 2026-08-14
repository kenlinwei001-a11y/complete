import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";

/**
 * WO-DECISION-PLAY-FE-CONSUME · **接缝门**：`decision_play` 引擎回包 ⋈ 决策推演面板。
 *
 * ══ 这道门咬的是链路，不是组件 ═══════════════════════════════════════════════
 * 引擎侧刚改成「**依据可核对才下发方案**」，后果是 `demand_attain` 这个指标的战略方案
 * 从 3 条变成 **0 条**（根因树上没有备份池/长协对象 ⇒ 三条都够不着，被诚实挡下）。
 * 前端若不消费 `optionsOmitted`，屏上就是**一块无缘无故的空白** —— 那比贴三条假方案更糟，
 * 因为它连「为什么」都不给。所以「前端有没有接这三个键」不是锦上添花，是**空白会不会出现**。
 *
 * 故本门全程走**页面深链**（`/v/decision-play?metricKey=…`）这条生产入口驱动：
 * URL → 页面壳 → 面板 → `invokeSolver('decision_play', {metricKey})` → 回包 → 上屏。
 * 只挂载组件、手喂 props 证明不了这条链通 —— 那是**已排练不是已实现**。
 *
 * ══ 四组判据 ═════════════════════════════════════════════════════════════════
 *  · S1 三种态**各说各的话**：三屏的关键句两两不同（不是同一句「暂无」）；
 *  · S2 依据强度 `OBJECT` / `TYPE` 在 **DOM 上真分得开**，且**去掉颜色照样分得开**
 *       （本仓双皮肤 + 色觉障碍用户 ⇒ 判据只落在字形记号与词上，一个色值都不看）；
 *  · S3 `gapClose.value === null` **不出现 `0`** —— 「有值 0」会被读成「没效果」，
 *       而它真正的意思是「算不出来」，两件事；
 *  · S4 **真引擎回包**驱动一遍（下面 `REAL_*` 是 2026-08-14 在 datacore 里跑
 *       `services.solvers.invoke(ADMIN,"decision_play",{metricKey})` 打出来的真 JSON 片段，
 *       逐字段抄的，不是照工单描述编的）。桩绿而真回包红是本仓的老坑，故两条都咬。
 *
 * ⚠ 浮层判据的写法（本仓踩过）：`InfoPopover` 在 `open===false` 时**根本不渲染**，
 *   此时 `queryByTestId` 返回 `null`，用 `not.toBeVisible()` 会让 jest-dom 抛
 *   "received value must be an HTMLElement" —— 那是**测试自己报错**，不是判据成立。
 *   正确写法：先 `expect(q).toBeNull()`，触发之后再 `toBeVisible()`。本文件按此写。
 */

const dpUrl = (metricKey: string) => `/v/decision-play?metricKey=${metricKey}`;

/** 走**默认 handlers**（`src/mocks/handlers.ts` 的生产桩）—— 不 `server.use` 覆盖，这才是接缝。 */
function openMetric(metricKey: string) {
  loginAs("planner");
  return renderApp(dpUrl(metricKey));
}

/** 换一屏：清缓存 + 卸载，避免 react-query 把上一屏的回包喂给下一屏。 */
async function reopen(metricKey: string) {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  return openMetric(metricKey);
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * S4 用的**真引擎回包**（2026-08-14 实测·逐字段抄自 datacore 真跑的输出）
 * 复验命令（在 apps/datacore 里）：
 *   services.solvers.invoke(ADMIN, "decision_play", { metricKey: "demand_attain" })
 * 三个指标的形态互不相同，这正是本门要咬的事实。
 * ══════════════════════════════════════════════════════════════════════════════ */
const REAL_DEMAND_ATTAIN = {
  rootCause: { factorId: "cf-material-short", label: "物料短缺(root)", metricKey: "demand_attain", gap: 9.2, unit: "%" },
  options: [],
  matrix: [],
  triggers: [],
  recommendedPlan: { planId: "plan-cf-material-short", optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
  sandboxNarrowing: { beforeGap: 9.2, afterGap: 9.2, narrowedPct: 0, ticks: 0 },
  optionsOmitted: [
    {
      optionId: "opt-backup-cert",
      label: "缩短备份供应商认证周期",
      reason:
        "依据对象 BackupSupplierPool|pool-cathode 与其类型都不在本次归因树的落点集里（根因「物料短缺(root)」的下钻面为 " +
        "DecisionGap、Equipment、MaterialBalance）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。",
    },
    {
      optionId: "opt-lta-clause",
      label: "长协加价格联动条款",
      reason:
        "依据对象 LongTermAgreement|lta-lfp-rbkj 与其类型都不在本次归因树的落点集里（根因「物料短缺(root)」的下钻面为 " +
        "DecisionGap、Equipment、MaterialBalance）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。",
    },
    {
      optionId: "opt-insource",
      label: "上游自采矿+战略储备",
      reason:
        "依据对象 LongTermAgreement|lta-lfp-cylk 与其类型都不在本次归因树的落点集里（根因「物料短缺(root)」的下钻面为 " +
        "DecisionGap、Equipment、MaterialBalance）⇒ 该方案与本根因无可核对的依据关系，诚实不下发。",
    },
  ],
  optionsEvidence: [],
  impedimentPlays: {
    joined: [
      {
        impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-1",
        kind: "BREAK",
        locus: { objectType: "MaterialBalance", objectId: "mbal-1", label: "三元正极" },
        severity: 8,
        ruleKey: "C06",
        join: {
          kind: "LOCUS_EXACT",
          path: "gap_attribution.node cf:cf-material-short（贡献 6.4716%·下钻 MaterialBalance/mbal-1.gapTon=1858）== 阻滞点落点 MaterialBalance/mbal-1",
          anchorNodeId: "cf:cf-material-short",
          anchorFactor: "物料短缺(root)",
          anchorContribution: 6.4716,
        },
        candidates: [],
        noCandidateReason:
          "枚举已跑完，有效候选 0 个（探了 2 个杠杆锚点 / 6 次试算），不足 2 个 ⇒ 构不成多方案对比，诚实不下发。",
        noCandidateKind: "NONE",
      },
      {
        impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
        kind: "BREAK",
        locus: { objectType: "MaterialBalance", objectId: "mbal-2", label: "磷酸铁锂正极" },
        severity: 6,
        ruleKey: "C06",
        join: {
          kind: "LOCUS_EXACT",
          path: "gap_attribution.node metricgap:demand_attain（贡献 8.096%·下钻 MaterialBalance/mbal-2.gapTon=492）== 阻滞点落点 MaterialBalance/mbal-2",
          anchorNodeId: "metricgap:demand_attain",
          anchorFactor: "需求达成缺口",
          anchorContribution: 8.096,
        },
        candidates: [
          {
            candidateId: "cand_imp_BREAK.MATERIAL.material-gap_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10",
            impedimentId: "imp_BREAK.MATERIAL.material-gap_mbal-2",
            label: "物料·到货周期 ↓ 10（物料到货·pos_lfp）",
            lever: { objectType: "Material", objectId: "pos_lfp", prop: "leadTime", unit: "天", factorName: "物料到货" },
            fromValue: 26,
            toValue: 10,
            join: { kind: "KEY_JOIN", path: "值键相等 MaterialBalance.material = Material.name = 磷酸铁锂正极（因子⑮ 物料到货）" },
            rungKind: "PEER_BEST",
            rungSource: "同侪 Material.leadTime 真实极值（最小） 10（全类型（同基地同侪不足 2 个）·6 个不同取值·当前 26）",
            dims: [{ key: "breach", label: "超阈幅度（MaterialBalance.gapTon）", value: 492, baseline: 492, unit: "吨" }],
            // ⚠ 引擎真给的就是 null —— 判据读数 492→492 没变，拒绝按比例折算。
            gapClose: {
              value: null,
              basis: "metricgap:demand_attain 贡献 8.096% × Δbreach/breach基线",
              reason:
                "该候选**不改变**本根因的判据读数（492→492吨）——它的效果落在其他维（见 dims 的 capacityP50/severity）；" +
                "本引擎无从把那些维换算成本指标缺口，故不给收窄量。",
            },
          },
        ],
      },
    ],
    scanned: 7,
    joinedCount: 2,
    candidateCount: 2,
    candidatesTruncated: false,
    candidateProbes: 45,
  },
  summary: "根因「物料短缺(root)」→ 0 战略方案比对(另 3 条因依据不在本根因树上未下发)·可执行方案 2 条(接 2/7 个阻滞点)",
};

const REAL_CASH_NO_PLAY_REASON =
  "本次归因树的落点类型 [ARAging、Customer、DSO] 与阻滞点判据册的落点类型 " +
  "[Base、DataSourceHealth、Line、MaterialBalance、MaterialBatch、Order、Process] **交集为空**，" +
  "且归因结构层没有基地面（levels[1].baseId 为空）⇒ 一条 join 路都够不着。" +
  "这是「接不上」不是「没有对策」：要接上需要该指标域的判据（承载物 + 已发布规则），不是在这里挑一个阻滞点凑数。";

const REAL_CASH = {
  ...REAL_DEMAND_ATTAIN,
  rootCause: { factorId: "cf-ar-aging", label: "应收账龄恶化(root)", metricKey: "cash", gap: 2, unit: "亿" },
  impedimentPlays: { joined: [], scanned: 0, joinedCount: 0, candidateCount: 0, noPlayReason: REAL_CASH_NO_PLAY_REASON },
  summary: "根因「应收账龄恶化(root)」→ 0 战略方案比对·可执行方案 0 条(接 0/0 个阻滞点)",
};

/** 真回包驱动：直接把上面那份 JSON 当 `decision_play` 的回包发回去。 */
function useRealPayload(payload: unknown) {
  server.use(
    http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: payload, snapshotVersion: "ov-real" })),
  );
}

describe("WO-DECISION-PLAY-FE-CONSUME · decision_play 三键上屏接缝", () => {
  it("S1 三种态各说各的话（有方案 / 方案 0 条有候选 / 全空带理由）—— 关键句两两不同", async () => {
    // ── 态①：有方案 + 有候选 ───────────────────────────────────────────────
    openMetric("seg_attain_ess");
    const opts1 = await screen.findByTestId("dp-options");
    expect(within(opts1).getByTestId("dp-option-opt-backup-cert")).toBeInTheDocument();
    // 有方案时不该出现「被挡下」那一块（它是空态的答案，不是常驻装饰）。
    expect(screen.queryByTestId("dp-options-omitted")).toBeNull();
    const plays1 = screen.getByTestId("dp-imp-plays");
    expect(plays1).toHaveAttribute("data-joined-count", "2");
    const state1 = plays1.textContent ?? "";

    // ── 态②：战略方案 0 条（三条全被挡下），但卡点上有可动手的候选 ─────────────
    await reopen("demand_attain");
    const omitted = await screen.findByTestId("dp-options-omitted");
    // 「为什么这里空」必须逐条留名 —— 不是「暂无数据」。
    expect(omitted).toHaveAttribute("data-omitted-count", "3");
    expect(screen.getByTestId("dp-omitted-opt-backup-cert")).toHaveTextContent("缩短备份供应商认证周期");
    expect(screen.getByTestId("dp-omitted-opt-lta-clause")).toHaveTextContent("长协加价格联动条款");
    expect(screen.getByTestId("dp-omitted-opt-insource")).toHaveTextContent("上游自采矿+战略储备");
    // 一张方案卡都没有，但屏上有话说。
    expect(screen.queryByTestId("dp-option-opt-backup-cert")).toBeNull();
    const lead2 = (screen.getByTestId("dp-omitted-lead").textContent ?? "").trim();
    expect(lead2.length).toBeGreaterThan(0);
    // 「接上了卡点但这个卡点没候选」与「一条都接不上」是两句话，不许塌成一句。
    expect(screen.getByTestId("dp-imp-nocand-imp_BREAK.MATERIAL.material-gap_mbal-1")).toBeInTheDocument();
    expect(screen.queryByTestId("dp-imp-no-play")).toBeNull();
    const state2 = (screen.getByTestId("dp-imp-plays").textContent ?? "");

    // ── 态③：全空 —— 方案 0 条 + 一个卡点都接不上，带机器可读理由 ────────────
    await reopen("cash");
    expect(await screen.findByTestId("dp-options-omitted")).toHaveAttribute("data-omitted-count", "3");
    const noPlay = screen.getByTestId("dp-imp-no-play");
    expect(noPlay).toHaveTextContent("接不上");
    // 「接不上」≠「没有对策」——这句区别必须在屏上。
    expect(noPlay).toHaveTextContent("不是「没有对策」");
    expect(screen.queryByTestId("dp-imp-nocand-imp_BREAK.MATERIAL.material-gap_mbal-1")).toBeNull();
    const state3 = (screen.getByTestId("dp-imp-plays").textContent ?? "");

    // ── 三屏两两不同：这一条才是「三种态各说各的话」的判据 ────────────────────
    expect(state1).not.toBe(state2);
    expect(state2).not.toBe(state3);
    expect(state1).not.toBe(state3);
    // 且没有一屏是「暂无数据」这种什么都没说的话。
    for (const s of [state1, state2, state3]) expect(s).not.toContain("暂无数据");
  });

  it("S2 依据强度 OBJECT / TYPE 在 DOM 上真分得开，且**去掉颜色照样分得开**", async () => {
    openMetric("seg_attain_ess");
    const strong = await screen.findByTestId("dp-evidence-opt-backup-cert");
    const weak = screen.getByTestId("dp-evidence-opt-lta-clause");

    // ① 机器可读档位不同
    expect(strong).toHaveAttribute("data-evidence", "OBJECT");
    expect(weak).toHaveAttribute("data-evidence", "TYPE");

    // ② **词**不同（判据只看文字，一个色值都不读 —— 双皮肤 + 色觉障碍用户的那条要求）
    const strongText = (strong.textContent ?? "").trim();
    const weakText = (weak.textContent ?? "").trim();
    expect(strongText).not.toBe(weakText);
    expect(weakText).toContain("弱");
    expect(strongText).not.toContain("弱");

    // ③ **字形记号**不同（打印成黑白同样分得开）
    const strongMark = (screen.getByTestId("dp-evidence-mark-opt-backup-cert").textContent ?? "").trim();
    const weakMark = (screen.getByTestId("dp-evidence-mark-opt-lta-clause").textContent ?? "").trim();
    expect(strongMark).not.toBe(weakMark);
    expect(strongMark.length).toBeGreaterThan(0);
    expect(weakMark.length).toBeGreaterThan(0);

    // ④ 弱依据的**理由**是引擎原文，且按分层纪律在浮层里 ——
    //    ⚠ `InfoPopover` 关着时**根本不渲染**，所以先断言 `toBeNull()`，触发后才 `toBeVisible()`。
    expect(screen.queryByTestId("dp-evidence-why-opt-lta-clause")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("info-wrap-dp-evidence-opt-lta-clause"));
    const why = await screen.findByTestId("dp-evidence-why-opt-lta-clause");
    expect(why).toBeVisible();
    expect(why).toHaveTextContent("同类型不同实例");

    // ⑤ 比对矩阵那张表里也带记号 —— 「每列最优」会把弱依据推成最优，表里不标就等于没标。
    expect(screen.getByTestId("dp-evidence-matrix-opt-lta-clause")).toHaveAttribute("data-evidence", "TYPE");
    expect(screen.getByTestId("dp-evidence-matrix-opt-backup-cert")).toHaveAttribute("data-evidence", "OBJECT");
  });

  it("S3 gapClose 为空**不渲染成 0**（「算不出来」与「没效果」是两件事）", async () => {
    openMetric("seg_attain_ess");
    await screen.findByTestId("dp-imp-plays");

    const nullTag = screen.getByTestId(
      "dp-gapclose-cand_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10",
    );
    expect(nullTag).toHaveAttribute("data-value", "null");
    // 这就是本条判据本体：屏上**一个 `0` 都不许有**。
    expect(nullTag.textContent ?? "").not.toContain("0");
    expect(nullTag).toHaveTextContent("给不出收窄量");

    // 反面样例（金丝雀）：能算出来的那条**必须**出真数 —— 否则「不出 0」可能只是整块没渲染。
    // ⚠ 屏上走本页统一的两位显示（`fmt`：4.048 → 4.05），**机器可读位保留引擎原值**，
    //   两者刻意分开：显示精度是排版，`data-value` 才是那个数本身。
    const valueTag = screen.getByTestId("dp-gapclose-cand_mbal-2_MaterialBalance.gapTon_mbal-2_PEER_NEXT_246");
    expect(valueTag).toHaveAttribute("data-value", "4.048");
    expect(valueTag).toHaveTextContent("4.05%");

    // 「为什么给不出」在浮层里（先 null，触发后可见）。
    expect(screen.queryByTestId("dp-gapclose-why-cand_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10")).toBeNull();
    fireEvent.mouseEnter(
      screen.getByTestId("info-wrap-dp-gapclose-cand_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10"),
    );
    const gcWhy = await screen.findByTestId("dp-gapclose-why-cand_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10");
    expect(gcWhy).toBeVisible();
    expect(gcWhy).toHaveTextContent("不改变");
  });

  it("S4 拿**真引擎回包**再驱动一遍（桩绿而真回包红是老坑，两条都咬）", async () => {
    loginAs("planner");
    useRealPayload(REAL_DEMAND_ATTAIN);
    renderApp(dpUrl("demand_attain"));

    // 战略方案 0 条 —— 但屏上不是空白：三条被挡下的逐条留名。
    expect(await screen.findByTestId("dp-options-omitted")).toHaveAttribute("data-omitted-count", "3");
    expect(screen.queryByTestId("dp-option-opt-insource")).toBeNull();
    // 引擎原文进浮层（关着时不渲染 ⇒ 先 null）。
    expect(screen.queryByTestId("dp-omitted-why-opt-insource")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("info-wrap-dp-omitted-opt-insource"));
    const omitWhy = await screen.findByTestId("dp-omitted-why-opt-insource");
    expect(omitWhy).toBeVisible();
    expect(omitWhy).toHaveTextContent("诚实不下发");

    // 真回包里 `gapClose.value` 就是 null —— 屏上照样一个 0 都没有。
    const real = screen.getByTestId(
      "dp-gapclose-cand_imp_BREAK.MATERIAL.material-gap_mbal-2_Material.leadTime_pos_lfp_PEER_BEST_10",
    );
    expect(real).toHaveAttribute("data-value", "null");
    expect(real.textContent ?? "").not.toContain("0");

    // 三条接法各一句话：这里是 LOCUS_EXACT。
    expect(screen.getByTestId("dp-imp-imp_BREAK.MATERIAL.material-gap_mbal-2")).toHaveAttribute("data-join-kind", "LOCUS_EXACT");

    // ── 同一份代码换真 cash 回包：一个卡点都接不上 ⇒ 引擎理由原文上屏 ──────────
    cleanup();
    await queryClient.cancelQueries();
    queryClient.clear();
    server.resetHandlers();
    useRealPayload(REAL_CASH);
    renderApp(dpUrl("cash"));
    const noPlay = await screen.findByTestId("dp-imp-no-play");
    expect(noPlay).toHaveTextContent("交集为空");
    expect(noPlay).toHaveTextContent("不是「没有对策」");
  });

  it("S5 候选与战略方案**在屏上明说不是一回事**，且不摆成一张可比的表", async () => {
    openMetric("seg_attain_ess");
    const plays = await screen.findByTestId("dp-imp-plays");

    // 第一层就得有这句话（不是藏在浮层里 —— 藏起来等于没说）。
    expect(screen.getByTestId("dp-imp-vs-options")).toHaveTextContent("不能并排比");
    // 候选区里一张表都没有（比对矩阵是 `dp-matrix` 那一块，不在这里）。
    expect(plays.querySelectorAll("table")).toHaveLength(0);
    // 候选也没有混进比对矩阵。
    const matrix = screen.getByTestId("dp-matrix");
    expect(matrix.textContent ?? "").not.toContain("物料·到货周期");

    // 「为什么不能并排比」在浮层（先 null，触发后可见）。
    expect(screen.queryByTestId("dp-imp-vs-options-why")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("info-wrap-dp-imp-vs-options"));
    const why = await screen.findByTestId("dp-imp-vs-options-why");
    expect(why).toBeVisible();
    expect(why).toHaveTextContent("编四个数");
  });

  it("S6 引擎不给这三个键时（老形状回包）不崩、不画空面板", async () => {
    loginAs("planner");
    useRealPayload({
      rootCause: { factorId: "cf-x", label: "老形状根因", metricKey: "seg_attain_ess", gap: 5, unit: "%" },
      options: [],
      matrix: [],
      triggers: [],
      recommendedPlan: { planId: "p", optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
      sandboxNarrowing: { beforeGap: 5, afterGap: 5, narrowedPct: 0, ticks: 0 },
      summary: "老形状",
    });
    renderApp(dpUrl("seg_attain_ess"));
    await screen.findByTestId("dp-root-cause");
    // 缺键 ⇒ 整块不出现（**不是**渲染一块空面板说「暂无」）。
    expect(screen.queryByTestId("dp-imp-plays")).toBeNull();
    expect(screen.queryByTestId("dp-options-omitted")).toBeNull();
    // 但「方案 0 条」这件事本身仍要出声 —— 引擎连被挡名单都没给，也得说出来。
    expect(screen.getByTestId("dp-options-silent")).toHaveTextContent("前端不替它编一份");
  });
});
