import { useEffect, useRef } from "react";
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

  // 推进轮询链的生命线：组件卸下后不许再排下一跳、不许再发请求。
  // 原先 `setTimeout(() => void poll(), 600)` 既不可取消、其 promise 也无人接 —— 卸载后仍会发 fetch，
  // 在测试里就成了「环境已拆除、回调才 fire」的未捕获异步错误（全绿却 RC≠0 的成因之一）。
  const pollAliveRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // 置回 true 不是多余：StrictMode 的 mount→unmount→mount 双跑会先把它置 false，
    // 若只在 cleanup 里写，真实 app 的开发态会永远停在 false（轮询再也不动）。
    pollAliveRef.current = true;
    return () => {
      pollAliveRef.current = false;
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const tickMut = useMutation({
    mutationFn: (advance: "1d" | "7d") => tickSimClock(advance),
    onSuccess: async () => {
      const poll = async () => {
        if (!pollAliveRef.current) return;
        const c = await fetchSimClock();
        if (!pollAliveRef.current) return;
        queryClient.setQueryData(["a", "sim-clock", {}], c);
        if (c.status === "TICKING") {
          pollTimerRef.current = setTimeout(() => {
            pollTimerRef.current = null;
            void poll().catch(() => undefined); // 卸载竞态下的拒绝不外泄成 unhandled rejection
          }, 600);
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
            {r.changedProps.slice(0, 5).map((c, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                {c.object}.{c.prop}: {c.from} → {c.to}
              </div>
            ))}
            {r.newAlerts.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {r.newAlerts.map((a, i) => (
                  <span key={i} className="badge red" style={{ marginRight: 6 }}>
                    {t.clock.newAlerts}: {a.ruleKey} · {a.message}
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
