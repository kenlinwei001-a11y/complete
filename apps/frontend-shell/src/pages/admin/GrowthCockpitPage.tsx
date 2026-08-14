import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GapReport, GrowthRunReport } from "@platform/contracts";
import {
  runGrowth,
  fetchGrowthLedger,
  fetchGrowthTickets,
  claimGrowthTicket,
  // WO-BEFE-D：三条「后端注册了、前端零调用方」的端点补上（探针 / 提交复核 / 重跑验证）。
  probeGrowth,
  submitGrowthTicket,
  verifyGrowthTicket,
} from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * 自成长发动机驾驶舱（PRD §16 / 主线 P6）：把"客户问题"当燃料跑一轮 LOOP（探针→补齐→重跑→收敛），
 * 看 GapReport 逐轮、收敛终态、成长账本(demand-indexed)、缺功能工单看板。让用户"看着发动机跑"。
 */
const TERMINAL_BADGE: Record<string, { label: string; cls: string }> = {
  CONVERGED: { label: "已收敛 ✓", cls: "green" },
  BOUNDARY: { label: "边界（仅剩缺功能工单）", cls: "amber" },
  MAX_ROUNDS: { label: "未收敛（达 K 轮）", cls: "red" },
};
const TICKET_BADGE: Record<string, string> = { OPEN: "amber", IN_PROGRESS: "blue", IN_REVIEW: "blue", MERGED: "green", VERIFIED: "green" };

export default function GrowthCockpitPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("常州影响哪些订单？"); // debattery-allow（输入框示例占位，非业务常数）
  const [maxRounds, setMaxRounds] = useState(4);
  const [report, setReport] = useState<GrowthRunReport | null>(null);
  const ledgerQ = useQuery({ queryKey: ["b", "growth-ledger"], queryFn: fetchGrowthLedger });
  const ticketsQ = useQuery({ queryKey: ["b", "growth-tickets"], queryFn: fetchGrowthTickets });
  const ledger = ledgerQ.data;
  const tickets = ticketsQ.data;
  // 账本 / 工单是两条**互相独立**的查询：任一未落地时，下面的派生指标（可答率/开放工单/累计运行）
  // 都还没有真值。此前无条件渲染 `0%` / `0` —— 加载态被画成"测得的零"，属静默错数（诚实 > 好看）；
  // 同时也让"元素恒存在"的 findBy 只能等到出现、等不到数据，测试随 CPU 负载随机读到占位值。
  // ready 由两条查询的真实 status 派生（单一真源），既修正显示又给出确定性终态信号 data-ready。
  const ready = ledgerQ.isSuccess && ticketsQ.isSuccess;
  const DASH = "—";

  const run = useMutation({
    mutationFn: () => runGrowth(query, maxRounds),
    onSuccess: (r) => {
      setReport(r);
      void qc.invalidateQueries({ queryKey: ["b", "growth-ledger"] });
      void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] });
    },
    onError: toastError,
  });
  const claim = useMutation({
    mutationFn: (id: string) => claimGrowthTicket(id),
    onSuccess: () => { toast("已认领", "success"); void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] }); },
    onError: toastError,
  });

  // ── WO-BEFE-D · 只探针不补（POST /b/v1/growth/probe）───────────────────────────
  // 与「运行」的差别是**副作用**不是精度：LOOP 会补数据、scaffold DRAFT、开工单、发 growth.* 事件；
  // 探针只诊断。「先看看断在哪，别动我的库」此前只能 curl —— 这颗按钮就是补它。
  const [probe, setProbe] = useState<GapReport | null>(null);
  const probeMut = useMutation({
    mutationFn: () => probeGrowth(query),
    onSuccess: setProbe,
    onError: toastError,
  });

  // ── WO-BEFE-D · 工单生命周期后两跳（此前前端只到「认领」就断了）────────────────
  // OPEN →(claim) IN_PROGRESS →(submit) IN_REVIEW →(verify) VERIFIED / 停 IN_REVIEW 并回带新缺口。
  const submitTk = useMutation({
    mutationFn: (id: string) => submitGrowthTicket(id),
    onSuccess: () => { toast("已提交复核", "success"); void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] }); },
    onError: toastError,
  });
  // 验证结果按工单 id 存 —— 这是「这一张单重跑之后到底能不能答」的答案，不是可缓存资源。
  const [verifyResult, setVerifyResult] = useState<Record<string, { verified: boolean; verdict: string; gapCodes: string[] }>>({});
  const verifyTk = useMutation({
    mutationFn: (id: string) => verifyGrowthTicket(id).then((r) => ({ id, ...r })),
    onSuccess: (r) => {
      setVerifyResult((prev) => ({
        ...prev,
        [r.id]: { verified: r.verified, verdict: r.gapReport.verdict, gapCodes: r.gapReport.findings.map((f) => f.gapCode) },
      }));
      toast(r.verified ? "重跑通过：已 VERIFIED" : `仍答不出（${r.gapReport.verdict}）—— 停在 IN_REVIEW`, r.verified ? "success" : "info");
      void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] });
    },
    onError: toastError,
  });

  const runs = ledger?.items ?? [];
  const tks = tickets?.items ?? [];
  // 量化：需求可答率 = CONVERGED / 总运行
  const answerable = runs.filter((e) => e.report.terminalState === "CONVERGED").length;
  const answerRate = runs.length ? Math.round((answerable / runs.length) * 100) : 0;

  return (
    <div data-testid="growth-cockpit-page" data-ready={ready ? "1" : "0"}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>自成长发动机驾驶舱</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        把"客户明确问题"当燃料：真跑一遍 QOS 诊断缺口 → 能自动补的补(数据真人正门) → 缺功能出工单 → 循环重跑直到收敛。
      </div>

      {/* 运行 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input data-testid="growth-query" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
        <label style={{ fontSize: 12 }}>K <input data-testid="growth-k" type="number" value={maxRounds} min={1} max={20} onChange={(e) => setMaxRounds(Number(e.target.value))} style={{ width: 56 }} /></label>
        <button className="btn primary sm" data-testid="growth-run" disabled={run.isPending || !query.trim()} onClick={() => run.mutate()}>{run.isPending ? "跑动中…" : "运行"}</button>
        {/* WO-BEFE-D：只诊断不动数据。刻意不是 primary —— 它是「先看看」，不是主动作。
            规范 §2 R-UI-3：口径不放进原生 `title=`（触屏读不到 + 有棘轮咬着），写成按钮旁的可见小字。 */}
        <button
          className="btn sm"
          data-testid="growth-probe"
          disabled={probeMut.isPending || !query.trim()}
          onClick={() => probeMut.mutate()}
        >
          {probeMut.isPending ? "探针中…" : "只探针（不补）"}
        </button>
        <span className="muted" style={{ fontSize: 10.5 }}>
          「运行」会补数据 / 开工单 / 发事件；「只探针」不动任何数据。
        </span>
      </div>

      {/* 探针结果：与「本次运行」分开一块——两者副作用不同，混在一起会让人以为探完就已经补过了。 */}
      {probe && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="growth-probe-report">
          <div className="section-title">
            探针结论 <span className="badge" data-testid="growth-probe-verdict">{probe.verdict}</span>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>只诊断，未补任何数据 / 未开工单</span>
          </div>
          {probe.findings.length === 0 ? (
            <div className="muted" style={{ fontSize: 11.5 }}>无缺口条目</div>
          ) : (
            probe.findings.map((f, i) => (
              <div key={`${f.gapCode}-${i}`} data-testid={`growth-probe-finding-${f.gapCode}`} style={{ fontSize: 11.5, padding: "3px 0" }}>
                <span className="mono">{f.gapCode}</span>
                <span className="muted" style={{ marginLeft: 8 }}>{f.evidence}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* 量化指标 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", gap: 24, fontSize: 12 }}>
        {/* WO-UNIT-MEANING：三个指标此前都是裸数——「开放工单 4」是 4 张还是 4 类？「累计运行 12」是 12 次还是 12 轮？
            契约 growth.ts 里 tickets/runs 都是数组（无 unit 字段可消费），故就近点明计数单位；
            可答率括号内补「可答/总运行」说明这是**次数比**而非百分数第二遍。 */}
        <span data-testid="metric-answer-rate">需求可答率 <b style={{ color: "var(--ok)" }}>{ledgerQ.isSuccess ? `${answerRate}%` : DASH}</b> <span className="muted">(可答 {ledgerQ.isSuccess ? answerable : DASH} 次 / 共 {ledgerQ.isSuccess ? runs.length : DASH} 次)</span></span>
        <span>开放工单 <b className="amber" data-testid="metric-open-tickets">{ticketsQ.isSuccess ? tks.filter((t) => t.status === "OPEN").length : DASH}</b> 张</span>
        <span>累计运行 <b>{ledgerQ.isSuccess ? runs.length : DASH}</b> 次</span>
      </div>

      {/* 本次运行结果 */}
      {report && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="growth-report">
          <div className="section-title">
            本次运行 <span className={`badge ${TERMINAL_BADGE[report.terminalState]?.cls}`} data-testid="growth-terminal">{TERMINAL_BADGE[report.terminalState]?.label}</span>
            {/* WO-UNIT-MEANING：`K=8` 此前是无解释的裸参数——K 即**最大轮数上限**（同单位：轮）。 */}
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>已跑 {report.rounds.length} 轮 / 上限 K={report.maxRounds} 轮</span>
          </div>
          {report.rounds.map((rd) => (
            <div key={rd.round} data-testid={`growth-round-${rd.round}`} style={{ fontSize: 11.5, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
              <b>第 {rd.round} 轮</b> · 缺口 <span className="badge">{rd.gapReport.verdict}</span>{" "}
              {rd.gapReport.findings.map((f, i) => <span key={i} className="mono" style={{ marginLeft: 6 }}>{f.gapCode}</span>)}
              {rd.fillApplied && <span style={{ marginLeft: 8, color: "var(--muted)" }}>→ 补：{rd.fillApplied.action}{rd.fillApplied.advanced ? " ✓推进" : ""}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 工单看板 */}
      <div className="section-title">成长工单（缺功能·需开发）</div>
      {/* 生命周期一行说明（原先塞在按钮 title= 里；R-UI-3 要求口径进可见文字）。 */}
      <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }} data-testid="growth-ticket-lifecycle-note">
        OPEN →「认领」→ IN_PROGRESS →「提交复核」→ IN_REVIEW →「重跑验证」（把原问句经 QOS 再跑一遍：
        能答出来才 VERIFIED，否则停在 IN_REVIEW 并把新缺口码显示在旁边）。
      </div>
      <table className="cmp" data-testid="growth-tickets" style={{ width: "100%", marginBottom: 14 }}>
        <thead><tr><th>问题</th><th>缺口</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {tks.map((t) => (
            <tr key={t.id} data-testid={`ticket-${t.id}`}>
              <td style={{ fontSize: 11.5 }}>{t.fromQuestion}</td>
              <td className="mono">{t.gapCode}</td>
              <td><span className={`badge ${TICKET_BADGE[t.status] ?? ""}`}>{t.status}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {t.status === "OPEN" && <button className="btn sm" data-testid={`claim-${t.id}`} onClick={() => claim.mutate(t.id)}>认领</button>}
                {/* WO-BEFE-D：认领之后此前就没有下一颗按钮了 —— 工单永远停在 IN_PROGRESS，
                    后端的 submit/verify 两条端点只能 curl。这两颗补上生命周期的后两跳。 */}
                {t.status === "IN_PROGRESS" && (
                  <button className="btn sm" data-testid={`submit-${t.id}`} disabled={submitTk.isPending} onClick={() => submitTk.mutate(t.id)}>
                    提交复核
                  </button>
                )}
                {/* 规范 §2 R-UI-3：两处口径都不进原生 `title=` —— 重跑语义写在下面表头下的一行说明里，
                    「还缺什么」直接就是徽标的**可见文字**（缺口码原样列出，不折进 tooltip）。 */}
                {t.status === "IN_REVIEW" && (
                  <button
                    className="btn sm primary"
                    data-testid={`verify-${t.id}`}
                    disabled={verifyTk.isPending}
                    onClick={() => verifyTk.mutate(t.id)}
                  >
                    {verifyTk.isPending ? "重跑中…" : "重跑验证"}
                  </button>
                )}
                {verifyResult[t.id] && (
                  <span
                    className={`badge ${verifyResult[t.id]!.verified ? "green" : "amber"}`}
                    style={{ marginLeft: 4 }}
                    data-testid={`verify-result-${t.id}`}
                  >
                    {verifyResult[t.id]!.verified ? "重跑可答 ✓" : `仍缺：${verifyResult[t.id]!.gapCodes.join("、") || verifyResult[t.id]!.verdict}`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ticketsQ.isSuccess && tks.length === 0 && <div className="empty-state">暂无工单</div>}

      {/* 成长账本 */}
      <div className="section-title">成长账本（demand-indexed）</div>
      <table className="cmp" data-testid="growth-ledger" style={{ width: "100%" }}>
        {/* WO-UNIT-MEANING：末两列格内是 length 计数；列头「工单」此前易被读成工单号，故点明"开放工单数(张)"。 */}
        <thead><tr><th>客户问题</th><th>终态</th><th>轮数(轮)</th><th>开放工单数(张)</th></tr></thead>
        <tbody>
          {runs.map((e) => (
            <tr key={e.id} data-testid={`ledger-${e.id}`}>
              <td style={{ fontSize: 11.5 }}>{e.report.question}</td>
              <td><span className={`badge ${TERMINAL_BADGE[e.report.terminalState]?.cls}`}>{e.report.terminalState}</span></td>
              <td className="mono">{e.report.rounds.length}</td>
              <td className="mono">{e.report.openTickets.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ledgerQ.isSuccess && runs.length === 0 && <div className="empty-state">暂无运行记录——输入一个客户问题点「运行」。</div>}
    </div>
  );
}
