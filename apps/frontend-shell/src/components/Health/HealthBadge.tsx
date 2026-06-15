import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { DataHealthResponse } from "@platform/contracts";
import { fetchDataHealth } from "@/api/endpoints";
import zh from "@/locales/zh";
import styles from "./HealthBadge.module.css";

export const HEALTH_POLL_MS = 60_000;

export function healthStatusLabel(status: "OK" | "DELAYED" | "DOWN"): string {
  return status === "OK" ? zh.health.statusOk : status === "DELAYED" ? zh.health.statusDelayed : zh.health.statusDown;
}

/**
 * §7.22 全局顶栏健康度徽章：任一源延迟 → 黄点；点击下拉清单 → 跳连接器控制台。
 * 轻量轮询（60s），与连接器页/推演降级说明同一数据源（GET /a/v1/data-health）。
 */
export function HealthBadge() {
  const { data } = useQuery<DataHealthResponse>({
    queryKey: ["a", "data-health", {}],
    queryFn: fetchDataHealth,
    refetchInterval: HEALTH_POLL_MS,
    staleTime: HEALTH_POLL_MS,
  });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!data) return null;
  const degraded = data.overall !== "OK";

  return (
    <div className={styles.wrap}>
      <button
        className={styles.btn}
        title={zh.health.badgeTitle}
        aria-label={zh.health.badgeTitle}
        data-testid="health-badge"
        data-overall={data.overall}
        onClick={() => setOpen(!open)}
      >
        <span className={`${styles.dot} ${degraded ? styles.dotWarn : styles.dotOk}`} data-testid="health-dot" data-degraded={degraded} />
        {zh.health.column}
      </button>
      {open && (
        <div className={styles.pop} data-testid="health-dropdown">
          <div className="section-title">{zh.health.badgeTitle}</div>
          {data.sources.map((s) => (
            <div key={s.connId} className={styles.row} data-testid={`health-src-${s.connId}`}>
              <span className={`${styles.dot} ${s.status === "OK" ? styles.dotOk : s.status === "DELAYED" ? styles.dotWarn : styles.dotErr}`} />
              <span className="zh">{s.name}</span>
              <span className="mono" style={{ color: "var(--muted2)" }}>
                {s.system}
              </span>
              <span className={`badge ${s.status === "OK" ? "green" : s.status === "DELAYED" ? "amber" : "red"}`}>{healthStatusLabel(s.status)}</span>
            </div>
          ))}
          <button
            className="btn sm"
            style={{ marginTop: 8, width: "100%" }}
            data-testid="health-goto-connections"
            onClick={() => {
              setOpen(false);
              navigate("/admin/connections");
            }}
          >
            {zh.health.gotoConnections}
          </button>
        </div>
      )}
    </div>
  );
}
