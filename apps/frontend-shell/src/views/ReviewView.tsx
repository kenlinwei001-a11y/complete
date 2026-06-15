import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { HistoryBundle } from "@platform/contracts";
import { fetchHistoryBundle } from "@/api/endpoints";
import { EChart } from "@/components/ui/EChart";
import type { ViewRendererProps } from "./registry";
import zh from "@/locales/zh";

/**
 * 运营回顾（renderer=review，运营态出厂配置增量 §4.2）——「越用越准」的证据链页面。
 * 全量消费 GET /a/v1/history/bundle（只读历史）：
 * MAPE 收敛曲线（危机回弹点标注）· 参数校准史（含被拒及方法学原因）· S&OP 版本史
 * · Action 审计史（分页）· 规则演进 · 意图孵化记录。
 */
export default function ReviewView(_props: ViewRendererProps) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "history-bundle", { page, pageSize }],
    queryFn: () => fetchHistoryBundle({ page, pageSize }),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (isError || !data) return <div className="empty-state">暂无运营态历史（先运行 livedIn 合成）</div>;

  return (
    <div data-testid="review-view" style={{ display: "grid", gap: 18 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>运营回顾 · 已运行 12 个月</h2>
        <span className="badge" title={`回放 ${data.generatedFrom.replayFrom} ~ ${data.generatedFrom.replayTo} · seed ${data.generatedFrom.seed}`}>
          {data.generatedFrom.replayFrom} ~ {data.generatedFrom.replayTo}
        </span>
      </header>

      <MapeSection bundle={data} />
      <CalibrationSection bundle={data} />
      <SopSection bundle={data} />
      <ActionAuditSection bundle={data} page={page} pageSize={pageSize} onPage={setPage} />
      <RuleEvolutionSection bundle={data} />
      <IncubationSection bundle={data} />
    </div>
  );
}

/** MAPE 52 周收敛曲线：12% → 7%，第 21–22 周危机回弹点以 markPoint + 文本标注呈现 */
function MapeSection({ bundle }: { bundle: HistoryBundle }) {
  const series = bundle.mapeSeries;
  const events = series.filter((w) => w.event);
  return (
    <section>
      <div className="section-title">预测精度（MAPE）收敛曲线 · 52 周</div>
      <EChart
        height={220}
        testId="mape-curve"
        option={{
          grid: { top: 24, bottom: 28, left: 44, right: 16 },
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: series.map((w) => `W${w.week}`) },
          yAxis: { type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
          series: [
            {
              type: "line",
              smooth: true,
              data: series.map((w) => w.mape),
              itemStyle: { color: "#4C90F0" },
              markPoint: {
                data: events.map((w) => ({ coord: [w.week - 1, w.mape], value: `W${w.week}`, itemStyle: { color: "#E0626C" } })),
              },
            },
          ],
        }}
      />
      <div data-testid="mape-annotations" style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        {events.map((w) => (
          <div key={w.week} data-testid={`mape-event-w${w.week}`}>
            <span className={`badge ${w.event!.includes("危机") ? "red" : "blue"}`}>W{w.week}</span> {w.weekStart} · {w.event}
          </div>
        ))}
      </div>
    </section>
  );
}

const FLAG_REASONS: Record<string, string> = {
  STRUCTURAL_SHIFT: "结构性漂移闸门：观测漂移超阈值，按方法学拒绝自动校准",
  NO_IMPROVEMENT: "回测门槛：模拟改善不足 1pct，拒绝生效",
};

/** 参数校准史（8 次提案，含 2 次被拒及方法学原因 —— Y7 证据链） */
function CalibrationSection({ bundle }: { bundle: HistoryBundle }) {
  return (
    <section>
      <div className="section-title">参数校准史（{bundle.calibrations.proposals.length} 次提案）</div>
      <table className="cmp" data-testid="calibration-history-table">
        <thead>
          <tr>
            <th>参数</th>
            <th>方法</th>
            <th>触发</th>
            <th>当前 → 建议</th>
            <th>状态</th>
            <th>证据 / 被拒原因</th>
          </tr>
        </thead>
        <tbody>
          {bundle.calibrations.proposals.map((p) => {
            const rejectFlags = (p.evidence?.flags ?? []).filter((f) => FLAG_REASONS[f]);
            return (
              <tr key={p.id} data-testid={p.status === "REJECTED" ? `cal-rejected-${p.id}` : undefined} style={p.status === "REJECTED" ? { opacity: 0.85 } : undefined}>
                <td className="zh">{p.parameter}</td>
                <td className="mono">{p.method ?? "—"}</td>
                <td className="mono">{p.trigger}</td>
                <td className="mono">
                  {p.currentValue} → {p.proposedValue}
                </td>
                <td>
                  <span className={`badge ${p.status === "APPLIED" ? "green" : p.status === "REJECTED" ? "red" : ""}`}>{p.status}</span>
                </td>
                <td className="zh" style={{ fontSize: 12 }}>
                  {p.status === "REJECTED" && rejectFlags.length > 0
                    ? rejectFlags.map((f) => <div key={f}>{FLAG_REASONS[f]}</div>)
                    : p.evidence
                      ? `n=${p.evidence.nPairs} · MAPE ${p.evidence.mapeBefore}% → ${p.evidence.simulatedMapeAfter}%${p.realizedMape !== undefined ? `（实现 ${p.realizedMape}%）` : ""}`
                      : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** S&OP 版本史 V1–V12：达成率 88% → 94% 爬坡（与月度实绩同源勾稽） */
function SopSection({ bundle }: { bundle: HistoryBundle }) {
  return (
    <section>
      <div className="section-title">S&OP 版本史（V1–V{bundle.sopVersions.length}）</div>
      <table className="cmp" data-testid="sop-version-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>月份</th>
            <th>需求(万套)</th>
            <th>供给(万套)</th>
            <th>实绩(万套)</th>
            <th>达成率</th>
            <th>第⑤步决议</th>
          </tr>
        </thead>
        <tbody>
          {bundle.sopVersions.map((v) => (
            <tr key={v.label} data-testid={`sop-${v.label}`}>
              <td className="mono">{v.label}</td>
              <td className="mono">{v.month}</td>
              <td className="mono">{v.demand}</td>
              <td className="mono">{v.supply}</td>
              <td className="mono">{v.actualOutput}</td>
              <td className="mono">{v.attainment}%</td>
              <td className="zh" style={{ fontSize: 12 }}>
                {v.resolutions.length > 0 ? v.resolutions.map((r) => r.name).join("；") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Action 审计史（分页）：82% EXECUTED / 11% REJECTED（带审批意见）…… 拒绝痕迹是真实感的关键 */
function ActionAuditSection({ bundle, page, pageSize, onPage }: { bundle: HistoryBundle; page: number; pageSize: number; onPage: (p: number) => void }) {
  const { items, total } = bundle.actionHistory;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const s = bundle.actionStats;
  return (
    <section>
      <div className="section-title">
        Action 审计史（共 {total} 条 · 已执行 {s.executed} / 驳回 {s.rejected} / 取消 {s.cancelled} / 失败 {s.failed}）
      </div>
      <table className="cmp" data-testid="action-audit-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>摘要</th>
            <th>状态</th>
            <th>审批意见</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="mono">{a.createdAt.slice(0, 10)}</td>
              <td className="zh">{a.actionTypeKey}</td>
              <td className="zh">{a.summary}</td>
              <td>
                <span className={`badge ${a.status === "EXECUTED" ? "green" : a.status === "REJECTED" ? "red" : ""}`}>{a.status}</span>
              </td>
              <td className="zh" style={{ fontSize: 12 }}>{a.comment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="action-page-prev">
          上一页
        </button>
        <span className="mono" data-testid="action-page-indicator">
          {page}/{pages}
        </span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="action-page-next">
          下一页
        </button>
      </div>
    </section>
  );
}

/** 规则演进（≥5 版；C16 覆盖天数 3→5 挂「到货危机复盘」） */
function RuleEvolutionSection({ bundle }: { bundle: HistoryBundle }) {
  return (
    <section>
      <div className="section-title">规则演进（{bundle.ruleVersions.length} 个版本）</div>
      <table className="cmp" data-testid="rule-evolution-table">
        <thead>
          <tr>
            <th>规则</th>
            <th>版本</th>
            <th>表达式</th>
            <th>复盘原因</th>
            <th>变更日</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {bundle.ruleVersions.map((r) => (
            <tr key={`${r.key}-${r.label}`} data-testid={`rule-${r.key}-${r.label}`}>
              <td className="zh">
                {r.key} · {r.name}
              </td>
              <td className="mono">{r.label}</td>
              <td className="mono">{r.expression}</td>
              <td className="zh" style={{ fontSize: 12 }}>
                {r.reason}
                {r.tags.map((t) => (
                  <span key={t} className="badge red" style={{ marginLeft: 6 }}>
                    {t}
                  </span>
                ))}
              </td>
              <td className="mono">{r.changedAt}</td>
              <td>
                <span className="badge">{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 意图孵化记录 ×3：「由兜底问题《…》×N 次孵化于某月」—— 运营闭环真实发生过 */
function IncubationSection({ bundle }: { bundle: HistoryBundle }) {
  return (
    <section>
      <div className="section-title">意图孵化记录（{bundle.incubated.length} 条）</div>
      <div data-testid="incubation-list" style={{ display: "grid", gap: 6 }}>
        {bundle.incubated.map((i) => (
          <div key={i.intentKey} className="zh" data-testid={`incubated-${i.intentKey}`} style={{ fontSize: 13 }}>
            <span className="badge blue">{i.name}</span> 由兜底问题《{i.question}》×{i.count} 次孵化于 {i.incubatedAt}
          </div>
        ))}
      </div>
    </section>
  );
}
