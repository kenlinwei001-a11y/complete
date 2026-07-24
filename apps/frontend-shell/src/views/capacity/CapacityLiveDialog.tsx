import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { askCapacityLive, type CapacityLiveAnswer } from "@/api/endpoints";
import { Provenance } from "@/components/Provenance";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "../RiskBoardView.module.css";

/**
 * WO-CAPLIVE-2 · 产能活台「人机对话」（活能力②）：产能页接**真 NL**（经 orchestrator·替 QaPanel 正则假 NL）。
 * 问句 → askCapacityLive（WO-LIVE-NL 端点·未合并则 MSW 桩·集成接真点=agentcore 产能 what-if 意图路由）
 *   → orchestrator 识别 what-if/根因意图 → 路由 generic_inference/gap_attribution(scope)/capacity_forecast
 *   → 叙述带溯源（R13：<Provenance> 出处·派生公式·输入因子；数字非裸渲染）+ 诚实 dataMode（不谎报实测）。
 * KILL-MOCK：答案随问句变（桩按输入真解析·非写死示意）。
 */
export function CapacityLiveDialog({ baseId, baseName, factor }: { baseId: string; baseName: string; factor?: string }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<CapacityLiveAnswer | null>(null);
  const ask = useMutation({
    mutationFn: (question: string) => askCapacityLive({ baseId, question, factor }),
    onSuccess: (res) => setAnswer(res),
    onError: toastError,
  });
  const submit = (q: string): void => {
    if (q.trim()) ask.mutate(q.trim());
  };
  const presets = zh.risk.live.dialog.presets(baseName);

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`capacity-live-dialog-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>💬 {zh.risk.live.dialog.title}</b>
        <span>{zh.risk.live.dialog.sub}</span>
      </div>
      <div className={styles.qaChips} data-testid="capacity-live-presets">
        {presets.map((q) => (
          <button key={q} className={styles.qaChip} data-testid={`capacity-live-preset-${q}`} onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className={styles.rkAsk}>
        <input
          value={input}
          data-testid="capacity-live-input"
          placeholder={zh.risk.live.dialog.placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              submit(input);
              setInput("");
            }
          }}
        />
        <button data-testid="capacity-live-ask" disabled={ask.isPending} onClick={() => { if (input.trim()) { submit(input); setInput(""); } }}>
          {ask.isPending ? zh.common.loading : zh.risk.live.dialog.ask}
        </button>
      </div>

      {answer ? (
        <div className={styles.rkAns} data-testid="capacity-live-answer">
          <div>
            {answer.answer}
            {answer.dataMode && answer.dataMode !== "LIVE" && (
              <span className={styles.rkSynth} data-testid="capacity-live-datamode" style={{ marginLeft: 6 }}>合成·未接实测</span>
            )}
          </div>
          {/* R13：答案数字出处（求解器 · 派生公式 · 输入因子）——非裸叙述。 */}
          {answer.provenance && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <Provenance
                testId={`capacity-live-${baseId}`}
                src={answer.provenance.src}
                formula={answer.provenance.formula}
                inputs={answer.provenance.inputs}
              >
                <span data-testid="capacity-live-solver">溯源（{answer.solver ?? "orchestrator"}）</span>
              </Provenance>
            </div>
          )}
          {/* what-if 类问句带 before/after（产能少多少）——逐字投影桩输出（非写死）。 */}
          {answer.deltas && answer.deltas.length > 0 && (
            <table className="cmp" data-testid="capacity-live-deltas" style={{ marginTop: 8, fontSize: 11 }}>
              <thead>
                <tr><th>对象</th><th>字段</th><th>before</th><th>after</th></tr>
              </thead>
              <tbody>
                {answer.deltas.map((d, i) => (
                  <tr key={`${d.objectId}-${d.prop}-${i}`} data-testid={`capacity-live-delta-${d.prop}`}>
                    <td className="mono" style={{ fontSize: 10 }}>{d.objectId}</td>
                    <td className="mono">{d.prop}</td>
                    <td className="mono">{d.before}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className={styles.rkAns} data-testid="capacity-live-answer">{zh.risk.live.dialog.empty}</div>
      )}
    </div>
  );
}
