import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AnnualScenario, AopResponse, FinanceWorldLine } from "@platform/contracts";
import { createActionDraft, fetchAop, fetchSimSessions, fetchFinanceWorldProjection } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import { useFeature } from "@/workspace/featureGate";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import { RuleRef } from "@/components/RuleRef";
import { EChart } from "@/components/ui/EChart";
import type { ViewRendererProps } from "../registry";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

// 接线：合成生成器与端点默认均种 2026（battery generatePlanDomain / PlanService.aop 默认年）；
// 视图请求年须与之统一，否则 plan.aop(year) 过滤空 → 视图空数据（修 §2#15 接线 bug）。
const YEAR = 2026;

/** 情景顶边色条（保守灰蓝 / 基准蓝 / 激进琥珀，对齐原型 AOP_SCEN.c） */
const SCEN_COLORS: Record<string, string> = {
  conservative: "#7C8896",
  baseline: "#54B5C4",
  aggressive: "#E8B54A",
};

/** 年度规划（renderer=annual-scenario，§7.14）：三情景卡 + 触发挂牌 + 目标分解流 */
export default function AnnualScenarioView(_props: ViewRendererProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "plan-aop", { year: YEAR }],
    queryFn: () => fetchAop(YEAR),
  });

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  // 基准情景（已拍板优先，否则 key=baseline）——分解 header 数字与窗口曲线均取真实数据，非写死。
  const baseline = data.scenarios.find((s) => s.finalized) ?? data.scenarios.find((s) => s.key === "baseline") ?? data.scenarios[0];

  return (
    <div data-testid="annual-scenario-view">
      <div className={simStyles.head}>
        <div>
          <h3>{zh.aop.title(YEAR)}</h3>
          <div className={simStyles.sub}>
            产能建设求解器：情景需求曲线 vs 投产时点 → 缺口/过剩窗口 · IRR · 利用率预测（<RuleRef code="C23" /> 门槛校验，<RuleRef code="C18" /> 现金垫底线）· 情景挂触发条件活在系统里。
          </div>
        </div>
        <span className="badge" data-testid="aop-compare-chip" style={{ marginLeft: "auto" }}>
          {zh.aop.compareChip(data.scenarios.length)}
        </span>
      </div>

      <div className={styles.scenGrid}>
        {data.scenarios.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>

      {baseline?.capexScenario && <CapexWindowCurve scenario={baseline} />}
      <WorldProjectionBand />
      <TriggerBoard triggers={data.triggers} />
      <DecompositionFlow decomposition={data.decomposition} baselineDemand={baseline?.demand} />
    </div>
  );
}

/**
 * ══ WO-HV-B ① · 「今天做这个决定 → 未来某期结果」——把年度情景接到推演世界 ═══════════
 *
 * **今天的行为是 X（开工实测，非派单转述）**：本页只打一个 `fetchAop(2026)`。
 *   后端 `planviews.ts` 那一行是
 *   `finance: { revenue: num(s.props.revenue), capex: num(s.props.capex), irr }` ——
 *   `revenue`/`capex` **直读 `AnnualScenario` 对象的 props**，而那些 props 是种子里的常数
 *   （`synthetic/battery.ts` 的 `conservative {cashCushion:72, capex:3, irr:9.5}` /
 *   `baseline {58, 8, 14.2}` / `aggressive {42, 27, 18.6}`）。
 *   ⇒ **无论在哪个推演世界里施加什么扰动，这一行钱逐字节不动**。
 *   本页因此答不出「今天做这个决定，未来某期会变成什么样」——它只会背出三个写死的情景。
 *
 * **应该是 Y**：同一页上，除了「真值口径」的那三个数，还要能读到
 *   「**在某个推演世界里、施加了那条扰动之后**，成本/毛利/应收各变成多少钱」。
 *   这一问已经有求解器答得出：`finance_world_projection`
 *   （吃 `args.worldId`，以 `FinancePlan.{budget,rolling}` 与 `ARInvoice.amount` 真值为基线，
 *   用世界态里 costPressure/receivablePressure/overduePressure 三个压力做投影）。
 *   缺的从来不是记号，是**把这条线接到这一页**。
 *
 * ⛔ **三条不许越的线，全部写在屏上而不是只写在注释里**：
 *  ① **`capex` / `irr` / `cashCushion` 本身没有被"投影"**。该求解器的输出面是
 *     收入/销售成本/毛利 + 应收/逾期五行，**它不产 capex 也不产 irr**。
 *     把投影出来的成本改个标签叫 capex，就是编数 —— 本页明写这三个数仍是真值口径、且**按设计不随世界态动**
 *     （与 `finance_pnl` 同理：那是它的正确行为，不是 bug）。
 *  ② **收入行 `projected ≡ rolling`** 是后端有意为之（「本链不驱动收入」，理由随回包的 note 下发），
 *     屏上照实转述，不替它圆场成「收入没受影响」。
 *  ③ **没有世界 / 世界态为空 / 回包不合契约 ⇒ 退回诚实缺口记号**，绝不显示 0、绝不编一个数。
 *     空世界里每条压力都是 0 ⇒ `projected ≡ rolling`，那会是一组「和没扰动时一模一样的钱」
 *     且没有任何记号说它是空的 —— 静默错答比不答更坏。
 *
 * 默认折叠（`<details>`）：本页在第一层棘轮基线里，结论留第一层、口径进第二层。
 */
function WorldProjectionBand() {
  const [worldId, setWorldId] = useState<string>("");

  // 世界清单：`worldId` 必须是**已存在的推演会话 id**（`SimSession.id`），不是自由字符串。
  const sessions = useQuery({
    queryKey: ["a", "sim-sessions", "aop-projection"],
    queryFn: () => fetchSimSessions(),
    retry: false,
  });
  const worlds = sessions.data?.items ?? [];
  // 选择器留空 ⇒ 取清单第一条（**不造一个 id**）；清单为空 ⇒ 下面走"没有世界"的诚实分支。
  const effectiveWorldId = worldId || worlds[0]?.id || "";

  const proj = useQuery({
    // worldId 进 key：不进的话换世界后命中旧缓存 ⇒ 屏上金额停在上一个世界（静默错答）。
    queryKey: ["b", "finance-world-projection", "aop", effectiveWorldId],
    enabled: effectiveWorldId !== "",
    retry: false,
    queryFn: ({ signal }) => fetchFinanceWorldProjection(effectiveWorldId, signal),
  });

  const out = proj.data;
  /**
   * 🔴 判据取契约，不取回包的一面之词（同 `SandboxImpactBand` 的既有判据，**共用同一条**）：
   * 契约对 `worldObjectCount` 的原文是「0 = 空世界 → available:false」——
   * 「空世界」与「不可用」在契约里是同一件事。只信 `available` 的那一版会把基线原样当投影摆上屏。
   */
  const worldEmpty = out !== undefined && out.worldObjectCount === 0;
  const usable = out !== undefined && out.available && !worldEmpty;

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="aop-world-projection">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        这个决定在推演世界里变成多少钱
        <select
          data-testid="aop-world-select"
          value={effectiveWorldId}
          onChange={(e) => setWorldId(e.target.value)}
          style={{ fontSize: 12 }}
          disabled={worlds.length === 0}
        >
          {worlds.length === 0 && <option value="">（没有推演世界）</option>}
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.id}（第 {w.curTick} 拍 · {w.status}）
            </option>
          ))}
        </select>
      </div>

      {/* 常驻口径行 —— 一个推演数被读成实测数，比不给这个数更坏，所以这句不许只待在浮层里。 */}
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }} data-testid="aop-world-caliber">
        推演投影 · 非实测。
        <InfoPopover topic="它和上面三张情景卡的钱是什么关系" testId="aop-world-caliber-info">
          上面情景卡里的 <b>收入 / CAPEX / IRR</b> 是<b>本体真值口径</b>：直读 <span className="mono">AnnualScenario</span> 的属性，
          <b>按设计不随推演世界变</b>（同 <span className="mono">finance_pnl</span>——那是它的正确行为，不是缺陷）。
          <br />
          这一块是<b>世界态投影口径</b>：基线取 <span className="mono">FinancePlan.rolling</span> 真值，
          增量由这个世界里的成本/应收/逾期三个压力沿传导规则折算。换算除数与传导链系数随回包下发，前端零写死系数。
          <br />
          ⚠ 该求解器<b>不产 CAPEX / IRR / 现金垫</b>，所以这三个数这里<b>没有</b>投影版本 ——
          把成本投影改个标签叫 CAPEX 就是编数。
        </InfoPopover>
      </div>

      {sessions.isError && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="aop-world-list-error">
          取不到推演世界清单 —— 本块据实留空，不拿真值冒充投影。
        </div>
      )}
      {!sessions.isError && worlds.length === 0 && !sessions.isLoading && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="aop-world-none">
          还没有任何推演世界。去沙盘起一次推演之后，这一页就能读出「那个决定让这些钱变成多少」。
          <b> 现在不显示数字，是因为真的没有——不是 0。</b>
        </div>
      )}
      {proj.isLoading && effectiveWorldId !== "" && (
        <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="aop-world-loading">
          {zh.common.loading}
        </div>
      )}
      {proj.isError && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="aop-world-error">
          这个世界的金额投影算不出来：{projErrText(proj.error)}
        </div>
      )}
      {out !== undefined && !usable && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="aop-world-unavailable">
          {worldEmpty
            ? "这个世界里还没有任何对象带态（baseSnapshot / tick 态均为空）—— 投影会恒等于基线，那不是「扰动不影响钱」，是「这个世界里还没发生任何事」。故本块据实留空。"
            : (out.unavailableReason ?? "后端报此次投影不可用，且未给出理由。")}
        </div>
      )}

      {usable && out && (
        <>
          <table className="cmp" data-testid="aop-world-lines">
            <thead>
              <tr>
                <th>科目</th>
                <th>基线（真值滚动预测）</th>
                <th>世界态投影</th>
                <th>Δ</th>
                <th>Δ%</th>
                <th>凭什么是这个数</th>
              </tr>
            </thead>
            <tbody>
              {out.lines.map((l: FinanceWorldLine) => (
                <tr key={l.subject} data-testid={`aop-world-line-${l.role}`}>
                  <td className="zh">{l.subject}</td>
                  <td className="mono">{l.rolling.toLocaleString("zh-CN")}</td>
                  <td className="mono" data-testid={`aop-world-projected-${l.role}`}>
                    {l.projected.toLocaleString("zh-CN")}
                  </td>
                  <td className="mono" data-testid={`aop-world-delta-${l.role}`}>
                    {l.delta.toLocaleString("zh-CN")}
                  </td>
                  <td className="mono">{l.deltaPct}%</td>
                  {/* 铁律「推演过程必须可披露」：算式与驱动压力由回包逐字下发，前端只转述不改写。
                      `driver === ""` 是**诚实缺席**（本链不驱动这一行），不是「不受影响」—— 照实写。 */}
                  <td style={{ fontSize: 12, color: "var(--muted)" }} data-testid={`aop-world-formula-${l.role}`}>
                    {l.formula}
                    {l.driver === "" && <span>（本链不驱动此行 · 原样透传）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 压力来源：这三个数就是「那个决定」在这个世界里留下的痕迹，摆出来才看得出投影凭什么。 */}
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }} data-testid="aop-world-pressures">
            世界态压力：
            {out.pressures.map((p, i) => (
              <span key={p.stateVar}>
                {i > 0 ? " · " : ""}
                {p.stateVar} <span className="mono">{p.value}</span>（{p.objectType} {p.carriers}/{p.universe} 承载）
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 4 }} data-testid="aop-world-basis">
            换算：{out.basis.note}
          </div>
          {out.notes.length > 0 && (
            <ul style={{ fontSize: 12, color: "var(--muted2)", margin: "4px 0 0 16px" }} data-testid="aop-world-notes">
              {out.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** 错误信封 → 一句人话（与本仓其余页同判据：有 error.message 就用后端原话，不自己编）。 */
function projErrText(e: unknown): string {
  const m = (e as { error?: { message?: string } })?.error?.message;
  return m ?? (e instanceof Error ? e.message : "未知错误");
}

/** 缺口/过剩窗口曲线（消费 capex_scenario 已产 demand/supply/gap/windows）：季度需求 vs 供给双线 + 缺口柱 + 窗口标段。 */
function CapexWindowCurve({ scenario: s }: { scenario: AnnualScenario }) {
  const cs = s.capexScenario;
  if (!cs || cs.quarters.length === 0) return null;
  const markAreas = cs.windows.map((w) => [
    { xAxis: w.fromQ, itemStyle: { color: w.kind === "gap" ? "rgba(221,126,158,.14)" : "rgba(84,181,196,.12)" } },
    { xAxis: w.toQ },
  ]);
  // WO-UNIT-MEANING · 纵轴量纲：改前 y 轴纯裸刻度（「1150」是万套？亿元？GWh？看不出）。
  // 单源：**沿用页面内唯一的数量单位常量 `zh.aop.demandUnit`（"万套/年"）**，不新造第二处「万套」字面量。
  //   为何要换分母：本曲线是**季度**序列——datacore/planviews.ts `capexScenarioFor` 把年需求按季节权重卷积到季
  //   （`demand.push(annualDemand * wq / 12)`），supply/gap 与 demand 同尺，故量纲 = 数量单位 + 季粒度。
  // 为何前端就近而非消费单源：契约 `planviews.ts` 的 `AnnualScenarioSchema.demand` / `capexScenario.demand`
  //   只有代码注释「年需求（万套）」，**没有运行时 unit 字段**可消费；收敛路径 = 后端把 unit 随 capexScenario 一起回传。
  const qtyUnit = zh.aop.demandUnit.split("/")[0] ?? zh.aop.demandUnit; // "万套/年" → "万套"（唯一单位来源）
  const yAxisName = zh.aop.wcAxisName(qtyUnit);
  const option = {
    grid: { left: 44, right: 16, top: 28, bottom: 24 },
    tooltip: { trigger: "axis" },
    legend: { data: [zh.aop.wcDemand, zh.aop.wcSupply, zh.aop.wcGap], top: 0, textStyle: { color: "#9AA8B6" } },
    xAxis: { type: "category", data: cs.quarters, axisLine: { lineStyle: { color: "#3A4655" } } },
    yAxis: { type: "value", name: yAxisName, nameTextStyle: { fontSize: 12 }, splitLine: { lineStyle: { color: "rgba(58,70,85,.4)" } } },
    series: [
      { name: zh.aop.wcDemand, type: "line", smooth: true, data: cs.demand, lineStyle: { color: "#E8B54A" }, itemStyle: { color: "#E8B54A" },
        markArea: markAreas.length > 0 ? { silent: true, data: markAreas } : undefined },
      { name: zh.aop.wcSupply, type: "line", smooth: true, data: cs.supply, lineStyle: { color: "#54B5C4" }, itemStyle: { color: "#54B5C4" } },
      { name: zh.aop.wcGap, type: "bar", data: cs.gap, itemStyle: { color: "rgba(221,126,158,.55)" }, barWidth: "40%" },
    ],
  };
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="aop-window-curve">
      <div className="section-title">{zh.aop.windowSection}</div>
      {/* jsdom 无 canvas（EChart 静默降级），轴名同文案另以 caption 落 DOM——可测 + 浏览器里也是有用的图注。 */}
      <div data-testid="aop-window-axis-caption" style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 2 }}>
        {zh.aop.wcAxisCaption(yAxisName)}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>
        {zh.aop.windowHint(s.name)}
        {cs.windows.map((w) => (
          <span key={`${w.kind}-${w.fromQ}`} className={`badge ${w.kind === "gap" ? "amber" : "green"}`} data-testid={`aop-window-${w.kind}-${w.fromQ}`} style={{ marginLeft: 6 }}>
            {w.kind === "gap" ? zh.aop.wcGapWin(w.fromQ, w.toQ) : zh.aop.wcSurplusWin(w.fromQ, w.toQ)}
          </span>
        ))}
      </div>
      <EChart option={option} height={240} testId="aop-window-chart" />
    </div>
  );
}

function ScenarioCard({ scenario: s }: { scenario: AnnualScenario }) {
  const [openRule, setOpenRule] = useState<string | null>(null);
  const color = SCEN_COLORS[s.key] ?? "var(--accent)";
  const canFinalize = useFeature("act.aop-finalize");
  const { data: workspace } = useWorkspace();
  const isCatalogAdmin = (workspace?.user?.roles ?? []).some((r) => r.split(":")[0] === "catalog_admin");

  const finalize = useMutation({
    mutationFn: () =>
      createActionDraft({
        actionTypeKey: "AOP情景拍板",
        payload: { scenarioId: s.id, scenarioKey: s.key, year: s.year, demand: s.demand },
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`${zh.aop.finalizeDone}（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });

  return (
    <div
      className={`${styles.scenCard} ${s.finalized ? styles.pick : ""}`}
      style={{ borderTopColor: color }}
      data-testid={`scen-card-${s.key}`}
      data-finalized={s.finalized}
    >
      <div className={styles.scenHead}>
        <b style={{ color }}>{s.name}</b>
        {s.finalized && (
          <span className="badge green" data-testid={`scen-finalized-${s.key}`}>
            {zh.aop.finalizedChip}
          </span>
        )}
        {!s.finalized && isCatalogAdmin && canFinalize && (
          <button
            className="btn sm"
            style={{ marginLeft: "auto" }}
            disabled={finalize.isPending}
            onClick={() => finalize.mutate()}
            data-testid={`scen-finalize-${s.key}`}
          >
            {zh.aop.finalizeBtn}
          </button>
        )}
      </div>
      <div className={styles.scenBig}>
        {s.demand.toLocaleString("zh-CN")} <small>{zh.aop.demandUnit}</small>
      </div>
      {s.note && (
        <div className={styles.scenNote} data-testid={`scen-note-${s.key}`}>
          {s.note}
        </div>
      )}
      <div className={styles.scenRow}>
        <span>{zh.aop.capacityDecision}</span>
        <div className="zh">{s.capacityDecision}</div>
      </div>
      <div className={styles.scenRow}>
        <span>{zh.aop.ltaLock}</span>
        <div className="zh">{s.ltaLock}</div>
      </div>
      <div className={styles.scenRow}>
        <span>{zh.aop.finance}</span>
        <div className="mono">{zh.aop.financeText(s.finance.revenue, s.finance.capex, s.finance.irr)}</div>
      </div>
      {s.capexScenario && s.capexScenario.projects.length > 0 && (
        <div className={styles.scenRow}>
          <span>{zh.aop.projectFinance}</span>
          <div data-testid={`scen-projects-${s.key}`}>
            {s.capexScenario.projects.map((p) => (
              <div key={p.id} className="mono" data-testid={`scen-project-${s.key}-${p.id}`} style={{ fontSize: 12 }}>
                {p.name}：IRR {p.irr.toFixed(1)}% · 24月利用率 {(p.util24 * 100).toFixed(1)}%{" "}
                <span className={`badge ${p.c23pass ? "green" : "amber"}`}>{p.c23pass ? "C23 ✓" : "C23 ⚠"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.scenRow}>
        <span>{zh.aop.ruleChecks}</span>
        <div>
          {s.ruleChecks.map((rc) => (
            <span key={rc.ruleKey} style={{ marginRight: 6 }}>
              <button
                className={`badge ${rc.passed ? "green" : "amber"}`}
                data-testid={`scen-rule-${s.key}-${rc.ruleKey}`}
                onClick={() => setOpenRule(openRule === rc.ruleKey ? null : rc.ruleKey)}
              >
                {rc.ruleKey} {rc.passed ? "✓" : "⚠"}
              </button>
            </span>
          ))}
          {openRule && (
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 5, background: "var(--bg2)", borderRadius: 6, padding: "5px 8px" }} data-testid={`scen-rule-detail-${s.key}`}>
              {s.ruleChecks.find((rc) => rc.ruleKey === openRule)?.explanation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 触发条件挂牌表：已触发行高亮 + 触发时间 + 通知记录（后端规则扫描，前端只读） */
function TriggerBoard({ triggers }: { triggers: AopResponse["triggers"] }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="section-title">{zh.aop.triggerSection}</div>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 8 }}>{zh.aop.triggerHint}</div>
      <table className="cmp" data-testid="aop-trigger-table">
        <thead>
          <tr>
            <th>{zh.aop.trgCond}</th>
            <th>{zh.aop.trgAction}</th>
            <th>{zh.aop.trgState}</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((t) => (
            <tr
              key={t.id}
              className={`${styles.trgRow} ${t.status === "TRIGGERED" ? styles.trgTriggered : ""}`}
              data-testid={`aop-trigger-${t.id}`}
              data-status={t.status}
            >
              <td className="zh">
                <b>{t.condition}</b>
              </td>
              <td className="zh">{t.action}</td>
              <td className="zh">
                {t.status === "MONITORING" ? (
                  <span className="badge amber">{zh.aop.monitoring}</span>
                ) : (
                  <>
                    <span className="badge green">{zh.aop.triggered}</span>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                      {t.triggeredAt && <span className="mono">{zh.aop.triggeredAt(t.triggeredAt.slice(0, 16).replace("T", " "))}</span>}
                      {t.notifiedTo && t.notifiedTo.length > 0 && <div>{zh.aop.notified(t.notifiedTo.join("、"))}</div>}
                    </div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 目标分解流（年 → 季 → 月）：分解节点悬停溯源（targetRef 与 S&OP 目标线同源） */
function DecompositionFlow({ decomposition, baselineDemand }: { decomposition: AopResponse["decomposition"]; baselineDemand?: number }) {
  const [prov, setProv] = useState<{ ref: string; top: number; left: number } | null>(null);
  const year = decomposition.find((d) => d.level === "year");
  const quarters = decomposition.filter((d) => d.level === "quarter");
  const months = decomposition.filter((d) => d.level === "month");

  const hover = (e: ReactMouseEvent, targetRef?: string) => {
    if (!targetRef) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProv({ ref: targetRef, top: r.bottom + 6, left: r.left });
  };

  return (
    <div className="panel">
      <div className="section-title">
        {zh.aop.decompSection}
        {baselineDemand !== undefined && (
          <span className={styles.decBaseline} data-testid="aop-dec-baseline">
            {zh.aop.decompBaseline(baselineDemand)}
          </span>
        )}
      </div>
      <div className={styles.decFlow} data-testid="aop-dec-flow">
        {year && (
          <div className={styles.decNode} data-testid="dec-node-year" onMouseEnter={(e) => hover(e, year.targetRef)} onMouseLeave={() => setProv(null)}>
            <b>{year.period}</b>
            {year.value.toLocaleString("zh-CN")} 万套
          </div>
        )}
        {quarters.map((q) => {
          const qMonths = months.filter((m) => quarterOf(m.period) === q.period);
          return (
            <span key={q.period} style={{ display: "contents" }}>
              <span className={styles.decArrow}>→</span>
              <div
                className={styles.decNode}
                data-testid={`dec-node-${q.period}`}
                onMouseEnter={(e) => hover(e, q.targetRef)}
                onMouseLeave={() => setProv(null)}
              >
                <b>{q.period}</b>
                {q.value} 万套
                {qMonths.length > 0 && (
                  <div className={styles.decMonths}>
                    {qMonths.map((m) => (
                      <i
                        key={m.period}
                        data-testid={`dec-month-${m.period}`}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          hover(e, m.targetRef);
                        }}
                        onMouseLeave={() => setProv(null)}
                      >
                        {m.period.slice(5)}月 {m.value}
                      </i>
                    ))}
                  </div>
                )}
              </div>
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 8 }} data-testid="aop-dec-footnote">
        {zh.aop.decompFootnote}
      </div>
      {prov && (
        <div className={`popover-surface ${styles.decProv}`} style={{ top: prov.top, left: prov.left }} role="tooltip" data-testid="dec-prov-pop">
          <span className="mono">{prov.ref}</span>
          <div>{zh.aop.decompProv(prov.ref)}</div>
        </div>
      )}
    </div>
  );
}

function quarterOf(month: string): string {
  const [y, m] = month.split("-");
  const q = Math.ceil(Number(m) / 3);
  return `${y}-Q${q}`;
}
