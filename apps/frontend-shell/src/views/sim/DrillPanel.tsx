/**
 * WO-SIM-DRILL-P12 · 推演**演习**面板（PRD-sim-drill-parallel-world §4）。
 *
 * ══ 今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
 * **X（今天）**：沙盘只能「推进 tick」——一次一格、没有天的概念，而且推完只得到一张
 *   四十万格的数值矩阵，**没有任何东西回答「哪里卡住了」**。业务事件（某单改交期）
 *   压根输不进去：扰动契约只收「把某个数值变量拨动多少」。
 * **Y（应该）**：用户输「把 SO-3391 交期提前 10 天，看 30 天」，屏上给出
 *   **被挤占的具体订单号 + 代价数字**，且每条结论标明它是真算的还是估的。
 *
 * ══ 屏上三条红线（都是本仓点名过的假绿形态）═══════════════════════════════
 * ① **「无卡点」与「没算出来」必须是两个不同的屏上状态**（PRD §4.6）。
 *    本组件据 `report.summary.allFailed` 分叉渲染，且「未能评估」的条目
 *    **留在清单里**并单独配色 —— 绝不因为它算不出来就从屏上消失。
 * ② **MOCK / UNDECLARED 的结论必须带记号**。`dataMode !== "LIVE"` 一律挂角标，
 *    与 LIVE 的结论**不许长得一样**。判据走契约的 `drillDataModeIsTrustworthy`
 *    单源函数，不在这里另写一个 `=== "LIVE"`。
 * ③ **截断要说出来**。后端逐类只回前 N 条，`truncated` 为真时屏上明写还有多少 ——
 *    不说 = 用显示上限冒充世界的真实规模。
 *
 * ══ R14 零业务常数 ═══════════════════════════════════════════════════════
 * 本文件**没有任何**基地名/型号/工序名/事件中文名。事件标签、必填字段、提示文案
 * 全部来自 `GET /a/v1/sim/drill/catalog`（后端单源）；结论文案来自后端 `why`。
 * 门 `check-debattery.mjs` 扫的正是这个目录，写死即红。
 */
import { useCallback, useMemo, useState } from "react";
import {
  DRILL_EVENT_SPECS,
  drillDataModeIsTrustworthy,
  type DrillDataMode,
  type DrillEvent,
  type DrillFinding,
  type DrillReport,
} from "@platform/contracts";
import { fetchDrillStateVarLayers, simDrill } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";

/** 诚实位角标文案 —— **后端枚举 → 屏上人话**的唯一映射（前端别处不许再写一份）。 */
const DATA_MODE_BADGE: Record<DrillDataMode, string> = {
  LIVE: "实测",
  MOCK: "估算",
  PARTIAL: "部分估算",
  EMPTY: "无数据",
  // ⚠ 这一档最要紧：求解器**没说**自己是真是假（实测 `sop_reschedule` 就没有 `dataMode` 字段）。
  // 写「实测」就是替它担保，写「估算」又冤枉它 —— 只能如实说「未声明」。
  UNDECLARED: "来源未声明",
};

function DataModeBadge({ mode }: { mode: DrillDataMode }) {
  if (drillDataModeIsTrustworthy(mode)) {
    return (
      <span className="badge ok sm" data-testid="drill-datamode" data-mode={mode}>
        {DATA_MODE_BADGE[mode]}
      </span>
    );
  }
  return (
    <span className="badge warn sm" data-testid="drill-datamode" data-mode={mode} title="这条结论不是实测值，不可当真值读（R13）">
      {DATA_MODE_BADGE[mode]}
    </span>
  );
}

function FindingRow({ f }: { f: DrillFinding }) {
  const unevaluated = f.kind === "未能评估";
  return (
    <li
      className="drill-finding"
      data-testid="drill-finding"
      data-kind={f.kind}
      data-datamode={f.source.dataMode}
      data-solver={f.source.solverKey}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: "1px solid var(--border, #2a2a2a)",
        // 「未能评估」不是一条低危结论，是一个空洞 —— 视觉上必须与真结论区分开
        opacity: unevaluated ? 0.75 : 1,
      }}
    >
      <span className="badge sm" data-testid="drill-finding-kind">
        {f.kind}
      </span>
      <span>
        <strong>{f.where.label}</strong>
        <span style={{ opacity: 0.85 }}> · {f.why}</span>
        <span style={{ opacity: 0.6, fontSize: 12 }}>
          {" "}
          ← {f.source.solverKey}
          {f.when === null ? "" : ` · 第 ${f.when} 天`}
        </span>
      </span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
        {/* 「未能评估」的 severity 恒 0，那不是「不严重」而是「没有严重度这个量」，故不显示数字 */}
        {unevaluated ? null : <span data-testid="drill-severity">{f.severity.toFixed(1)}</span>}
        <DataModeBadge mode={f.source.dataMode} />
      </span>
    </li>
  );
}

export interface DrillPanelProps {
  sessionId: string | null;
}

export function DrillPanel({ sessionId }: DrillPanelProps) {
  const [horizonDays, setHorizonDays] = useState("30");
  const [eventKind, setEventKind] = useState<string>("");
  const [targetObjectId, setTargetObjectId] = useState("");
  /** payload 逐键的输入值（键来自 catalog，不是写死的表单字段）。 */
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DrillReport | null>(null);
  /**
   * 状态变量**三层重排**（根源 / 枢纽 / 末端）—— 层级由传导图入度出度**后端现算**，不手工登记。
   *
   * ⚠ 与事件目录同一条纪律：**在点击事件里取，不在渲染期取**。
   * 渲染期新增 endpoint 依赖会被整体替换式 `vi.mock` 打成 undefined 而当场抛，
   * 把别的单的门整片打红（本单实测栽过一次，见上方 `specs` 的头注）。
   *
   * 为什么不在前端自己按传导规则算一遍：那是第二套真相源 ——
   * 后端 `layerOfStateVars` 是唯一实现，前端再算一份，度数口径一漂两边就各说各话。
   */
  const [layers, setLayers] = useState<{ stateVar: string; layer: string; label: string }[] | null>(null);

  /**
   * 事件目录 —— **直接读契约包，不打网络**。
   *
   * ⚠ 这不是「前端自己写一份」：`DRILL_EVENT_SPECS` 就是后端 `GET /a/v1/sim/drill/catalog`
   * 下发的那一份，同一个模块、同一个常量。跨包只依赖 `@platform/contracts` 正是本仓
   * `contracts-only-shared` 约定要的形态 —— 编译期读同一个源，比运行时再打一跳更强，
   * 因为它连「版本漂移」都不可能发生。
   *
   * ⛔ **为什么不 `useQuery(fetchDrillCatalog)`**（2026-08-25 实测踩过，别改回去）：
   * 本面板挂在推演沙盘上，而**全仓大量前端测试对 `@/api/endpoints` 做整体替换式 mock**
   * （`vi.mock("@/api/endpoints", () => ({...}))`，没有 `importOriginal`）。
   * 给共享视图**在渲染期**新增一个 endpoint 依赖 ⇒ 那些 mock 里没有这个导出 ⇒
   * `useQuery` 拿到 `undefined` 的 `queryFn` 当场抛，把**别的单的门**整片打红。
   * 实测：改成 useQuery 时 `test/sandbox-three-zone.seam.test.tsx` **18 例全红**，
   * 而那个文件属于并行在跑的另一张单、本单严禁修改。
   * 同一条教训契约里已写过一次（`PropagationRule.sourceTypeName` 的头注：
   * 「给共享面板加一个 endpoint 依赖会把它们全部打红」）—— 这是第二次，照它办。
   *
   * `simDrill` 不受此限：它只在**点击事件里**调用，渲染期不碰。
   * 而 `/drill/catalog` 端点仍然保留 —— 它服务的是**不能 import TS 的消费方**
   * （agentcore / curl / CLI，R15「CLI/curl 先于 UI」），由接缝门覆盖。
   */
  const specs = DRILL_EVENT_SPECS;
  const spec = useMemo(() => specs.find((s) => s.kind === eventKind) ?? null, [specs, eventKind]);

  const onRun = useCallback(async () => {
    if (!sessionId) return;
    const days = Math.max(1, Math.floor(Number(horizonDays)));
    if (!Number.isFinite(days)) {
      toastError(new Error("推演天数必须是正整数"));
      return;
    }
    // 没选事件 ⇒ 只跑卡点扫描（一期行为），**不是**报错：扫描本身就有价值。
    const events: DrillEvent[] =
      spec && targetObjectId.trim() !== ""
        ? [
            {
              kind: spec.kind,
              targetObjectId: targetObjectId.trim(),
              // 按 catalog 声明的类型转换 —— 类型也是数据，不在这里 if 死每个字段名
              payload: Object.fromEntries(
                spec.payloadKeys
                  .map((pk) => {
                    const raw = payload[pk.key];
                    if (raw === undefined || raw.trim() === "") return null;
                    return [pk.key, pk.type === "number" ? Number(raw) : raw] as const;
                  })
                  .filter((x): x is readonly [string, string | number] => x !== null),
              ),
              effectiveDay: 0,
            },
          ]
        : [];
    setRunning(true);
    try {
      const r = await simDrill(sessionId, { events, horizonDays: days, scanOnly: events.length === 0 });
      setReport(r);
      // 三层重排与演习结果同时上屏。**单独 try**：层级取不到不该让整场演习白跑，
      // 但也不静默 —— 取不到就保持 `null`，屏上那一段直接不出现（不画一个空壳假装有）。
      try {
        setLayers((await fetchDrillStateVarLayers()).layers);
      } catch {
        setLayers(null);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setRunning(false);
    }
  }, [sessionId, horizonDays, spec, targetObjectId, payload]);

  return (
    <section className="card" data-testid="drill-panel">
      <h3 style={{ marginTop: 0 }}>推演演习 · 扫端到端卡点</h3>
      <p style={{ opacity: 0.75, fontSize: 12, marginTop: -6 }}>
        {/* ⛔ 原文写的是 `**业务上发生的事**` —— 这段文案按**纯文本**渲染，
            markdown 的星号不会被解析，会原样印在屏上。强调一律用 <strong>。 */}
        输入一件<strong>业务上发生的事</strong>（不是拨数值），沿真实求解器算出卡点 / 堵点 / 脆弱点。
        阈值取该变量在本世界的 P90/P95 分位，零配置。
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>推演天数</span>
          <input
            data-testid="drill-horizon-days"
            value={horizonDays}
            onChange={(e) => setHorizonDays(e.target.value)}
            inputMode="numeric"
            style={{ width: 90 }}
          />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>发生了什么</span>
          <select
            data-testid="drill-event-kind"
            value={eventKind}
            onChange={(e) => {
              setEventKind(e.target.value);
              setPayload({});
            }}
          >
            {/* 空档 = 只扫卡点不调求解器，是**一等选项**不是"请选择"的占位 */}
            <option value="">（不输事件·只扫卡点）</option>
            {specs.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {spec === null ? null : (
          <>
            <label>
              <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>对象编号</span>
              <input
                data-testid="drill-target-object"
                value={targetObjectId}
                onChange={(e) => setTargetObjectId(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
            {/* 表单字段由 catalog 生成 —— 加一个事件，前端零改动就有了它的输入框 */}
            {spec.payloadKeys.map((pk) => (
              <label key={pk.key}>
                <span style={{ display: "block", fontSize: 12, opacity: 0.8 }} title={pk.hint}>
                  {pk.key}
                  {pk.required ? " *" : ""}
                </span>
                <input
                  data-testid={`drill-payload-${pk.key}`}
                  value={payload[pk.key] ?? ""}
                  onChange={(e) => setPayload((p) => ({ ...p, [pk.key]: e.target.value }))}
                  placeholder={pk.hint}
                  inputMode={pk.type === "number" ? "numeric" : "text"}
                  style={{ width: 130 }}
                />
              </label>
            ))}
          </>
        )}
        <button className="btn primary" data-testid="drill-run-btn" disabled={!sessionId || running} onClick={onRun}>
          {running ? "演习中…" : "开始演习"}
        </button>
      </div>


      {report === null ? null : (
        <div style={{ marginTop: 12 }} data-testid="drill-report">
          {/* ⚠ 红线①：allFailed 与「没扫出卡点」是两个状态，绝不合并渲染 */}
          <p
            data-testid="drill-summary"
            data-all-failed={String(report.summary.allFailed)}
            data-datamode={report.summary.dataMode}
            className={report.summary.allFailed ? "badge warn" : undefined}
          >
            {report.summary.text}
          </p>

          {/* ⚠ 红线③：截断必须说出来 */}
          {report.truncated ? (
            <p data-testid="drill-truncated" style={{ opacity: 0.8, fontSize: 12 }}>
              每类只显示前 {report.appliedLimitPerKind} 条（实际：
              {Object.entries(report.totalByKind)
                .map(([k, n]) => `${k} ${n}`)
                .join("·")}
              ）。
            </p>
          ) : null}

          {/* 求解器回执 —— 「求解器真被调用」这件事屏上可见，不必开 network 面板 */}
          {/*
            状态变量**三层重排**（根源 / 枢纽 / 末端）—— 层级现算，不手工登记（2026-08-25）。
            复验：`GET /a/v1/sim/drill/state-var-layers`（后端唯一实现 `sim/drill-scan.ts` 的
            `layerOfStateVars`）—— 前端只消费，不算第二份；改边集则该端点回包跟着变。
            为什么值得单独一段：仓主的分层判据「库存是衍生不是根源」在数据上成立，
            而屏上一直没有任何东西表达它 —— 用户看到 36 个平铺的变量，
            分不出「扰它有意义」（根源）与「扰它等于从半路插入」（末端）。
            取不到 ⇒ 整段不渲染（不画空壳）。
          */}
          {layers === null || layers.length === 0 ? null : (
            <details data-testid="drill-statevar-layers">
              <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.85 }}>
                状态变量三层（根源 {layers.filter((l) => l.layer === "根源").length}·枢纽{" "}
                {layers.filter((l) => l.layer === "枢纽").length}·末端 {layers.filter((l) => l.layer === "末端").length}）
              </summary>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                {(["根源", "枢纽", "末端"] as const).map((layer) => {
                  const items = layers.filter((l) => l.layer === layer);
                  if (items.length === 0) return null;
                  return (
                    <p key={layer} data-testid="drill-layer-row" data-layer={layer} style={{ margin: "4px 0" }}>
                      <strong>{layer}</strong>（
                      {layer === "根源"
                        ? "入度 0·没人喂它，扰它才有意义"
                        : layer === "末端"
                          ? "出度 0·它只承接，是结果不是输入"
                          : "两头都有·传导中继"}
                      ）：{items.map((l) => l.label).join("、")}
                    </p>
                  );
                })}
              </div>
            </details>
          )}

          <details data-testid="drill-solver-runs">
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.85 }}>
              求解器回执（{report.solverRuns.length} 次调用）
            </summary>
            <ul style={{ fontSize: 12, opacity: 0.9 }}>
              {report.solverRuns.map((r, i) => (
                <li key={`${r.solverKey}-${i}`} data-testid="drill-solver-run" data-solver={r.solverKey} data-ok={String(r.ok)}>
                  {r.solverKey} · {r.ok ? `产出 ${r.findingCount} 条` : `失败：${r.error ?? "未知错误"}`} ·{" "}
                  <DataModeBadge mode={r.dataMode} />
                </li>
              ))}
            </ul>
          </details>

          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }} data-testid="drill-findings">
            {report.findings.map((f) => (
              <FindingRow key={f.key} f={f} />
            ))}
          </ul>

          {/* 降级区：守恒未通过的结论不删掉，但不混进主清单（PRD §4.6） */}
          {report.degraded.length === 0 ? null : (
            <details data-testid="drill-degraded" style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.85 }}>
                降级区 · {report.degraded.length} 条守恒校验未通过（不进主清单）
              </summary>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {report.degraded.map((f) => (
                  <FindingRow key={f.key} f={f} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default DrillPanel;
