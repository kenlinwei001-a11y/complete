import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSimClock, fetchTickReports, resetSimClock, tickSimClock } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { queryClient as globalQueryClient } from "@/store/queryClient";
import zh from "@/locales/zh";
import styles from "./SyntheticPage.module.css";

const t = zh.admin.synthetic;

/**
 * 模拟时钟控制台（A8 §6.3）。统一规格页面归属决议：从合成数据页**移出**，迁至运营自动化页
 * （ops-schedule）——时钟是运营时序关切、非数据构建/合成关切。组件自包含（自有 query/mutation）。
 */
export function SimClockConsole() {
  const queryClient = useQueryClient();
  const { data: clock } = useQuery({
    queryKey: ["a", "sim-clock", {}],
    queryFn: fetchSimClock,
    refetchInterval: (q) => (q.state.data?.status === "TICKING" ? 600 : false),
  });
  const { data: reports } = useQuery({ queryKey: ["a", "tick-reports", {}], queryFn: fetchTickReports });

  const tickMut = useMutation({
    mutationFn: (advance: "1d" | "7d") => tickSimClock(advance),
    onSuccess: async () => {
      const poll = async () => {
        const c = await fetchSimClock();
        queryClient.setQueryData(["a", "sim-clock", {}], c);
        if (c.status === "TICKING") {
          setTimeout(() => void poll(), 600);
        } else {
          await queryClient.invalidateQueries({ queryKey: ["a", "tick-reports"] });
          await globalQueryClient.invalidateQueries({ queryKey: ["a"] });
          toast(t.clock.refreshHint, "info");
        }
      };
      await poll();
    },
    onError: toastError,
  });

  const resetMut = useMutation({
    mutationFn: resetSimClock,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["a", "sim-clock"] });
      await queryClient.invalidateQueries({ queryKey: ["a", "tick-reports"] });
    },
    onError: toastError,
  });

  if (!clock) return null;

  return (
    <div className="panel" data-testid="clock-console">
      <div className="section-title">{t.clock.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.clock.current}</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }} data-testid="sim-date">
            {clock.simDate}
          </div>
        </div>
        <span className="badge blue">tick #{clock.currentTick}</span>
        {clock.status === "TICKING" && <span className="badge amber">TICKING…</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn sm primary" disabled={tickMut.isPending || clock.status === "TICKING"} onClick={() => tickMut.mutate("1d")} data-testid="tick-1d">
            {t.clock.tick1d}
          </button>
          <button className="btn sm" disabled={tickMut.isPending || clock.status === "TICKING"} onClick={() => tickMut.mutate("7d")}>
            {t.clock.tick7d}
          </button>
          <button className="btn sm danger" disabled={resetMut.isPending} onClick={() => resetMut.mutate()}>
            {t.clock.reset}
          </button>
        </div>
      </div>

      <div className="section-title">{t.clock.script}</div>
      <div className={styles.scriptLine} data-testid="script-timeline">
        {clock.script.map((e) => (
          <span key={`${e.tick}-${e.event}`} className={`${styles.scriptEvent} ${e.fired ? styles.fired : ""}`}>
            {e.fired ? "✓" : "○"} t{e.tick} · {e.event}
          </span>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 12 }}>
        {t.clock.reports}
      </div>
      <div className={styles.reportStream}>
        {(reports ?? []).map((r) => (
          <div key={r.tick} className={styles.tickCard} data-testid={`tick-report-${r.tick}`}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span className="badge blue">tick #{r.tick}</span>
              <span className="mono" style={{ fontSize: 11 }}>{r.simDate}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>+{r.newPoints.toLocaleString()} pts</span>
              {r.forecastDeviation != null && (
                <span className="badge amber">偏差 {(r.forecastDeviation * 100).toFixed(1)}%</span>
              )}
            </div>
            {/* WO-VIS-SIGNALS-2 ⑦：属性变更可跳对象 360（object=`${type}-${id}` → /o/type/id·首个连字符切分）。
                此前 tick 报告变更/告警纯文本，看到"某对象某属性变了/触发某规则"却无处下钻。 */}
            {r.changedProps.slice(0, 5).map((c, i) => {
              const dash = c.object.indexOf("-");
              const typeKey = dash > 0 ? c.object.slice(0, dash) : "";
              const objKey = dash > 0 ? c.object.slice(dash + 1) : "";
              return (
                <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                  {typeKey && objKey ? (
                    <Link to={`/o/${encodeURIComponent(typeKey)}/${encodeURIComponent(objKey)}`} data-testid={`tick-change-link-${r.tick}-${i}`}>
                      {c.object}
                    </Link>
                  ) : (
                    c.object
                  )}
                  .{c.prop}: {c.from} → {c.to}
                </div>
              );
            })}
            {r.newAlerts.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {/* 告警 ruleKey 跳规则库（?ruleKey= 落该规则展开·看命中阈值/表达式）。 */}
                {r.newAlerts.map((a, i) => (
                  <span key={i} className="badge red" style={{ marginRight: 6 }}>
                    {t.clock.newAlerts}:{" "}
                    <Link to={`/admin/rules?ruleKey=${encodeURIComponent(a.ruleKey)}`} data-testid={`tick-alert-rule-${r.tick}-${a.ruleKey}`} style={{ color: "inherit", textDecoration: "underline" }}>
                      {a.ruleKey}
                    </Link>{" "}
                    · {a.message}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
