import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import { createSimSession, fetchSimCertification } from "@/api/endpoints";
import { SimReadinessPanel } from "./SimReadinessPanel";
import { ReadinessRadar, HealthTrustRadar, deriveHealthDims, deriveTrustDims } from "./readinessRadars";
import styles from "../RiskBoardView.module.css";

/**
 * WO-SANDBOX-READINESS-UX：CAPSIM 看板（/v/risk）顶部**紧凑单行信任条** + `[查看完整体检▸]` 抽屉。
 *
 * 守 RL3（只渲染，零新算）：**只消费**既有 `SimCertification`（GET /a/v1/sim/sessions/:id/certification?scope=GLOBAL），
 * 无任何新计算字段——canEnter/level/dims/雷达全 DERIVE 自后端投影。**非通栏 banner**：一行 chip 条嵌 header 区，
 * 看板 1:1 复刻主体（rk-grid 几何）一字节不动；L0–L4 stepper + 三维/健康6维/信任4维雷达全收进抽屉（默认关）。
 *
 * 诚实降级（暗发 R3）：token 未就绪或 sim.sandbox/certification entitlement 关 → createSimSession 404 → 整条不渲染
 * （return null·非画假认证）。文案守既有口径：canEnter=true → 绿「✓ 可进入推演」；false/未认证 → 「◐ 可试跑（未认证·结论仅供参考）」。
 */

/** 反应式 token 就绪（同 ModelingPage useHasToken）：token 到位即重渲染 → enabled 打开 → cert 自动取。 */
function useHasToken(): boolean {
  return useSyncExternalStore(tokenStore.subscribe, () => tokenStore.get() != null, () => false);
}

/**
 * 极简 SimSession（空 baseSnapshot）仅为驱动 deriveCertification（GLOBAL 全局就绪）。
 * token 未就绪不建会话；建会话/取认证失败（entitlement 关）→ 诚实降级（cert 保持 null → 信任条不渲染）。
 */
function useBoardCert() {
  const hasToken = useHasToken();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scope, setScope] = useState<"GLOBAL" | "LOCAL">("GLOBAL");
  useEffect(() => {
    if (!hasToken) return;
    let alive = true;
    (async () => {
      try {
        const s = await createSimSession({ baseSnapshot: {}, scope: {} });
        if (alive) setSessionId(s.id);
      } catch {
        /* entitlement 关 / 无会话 → 保持 sessionId=null → cert 保持 null → 信任条诚实不渲染 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [hasToken]);
  const { data: cert } = useQuery({
    queryKey: ["a", "risk-trustbar-cert", sessionId, scope],
    queryFn: () => fetchSimCertification(sessionId!, scope),
    enabled: !!sessionId,
    retry: false,
  });
  return { cert: cert ?? null, scope, setScope };
}

/** 三维就绪雷达维（结构/知识/行为·对齐 SandboxView radarValues）。 */
const TRIAD_DIMS = [
  { key: "structure", label: "结构" },
  { key: "knowledge", label: "知识" },
  { key: "behavior", label: "行为" },
];

export function BoardReadinessTrustBar() {
  const { cert, scope, setScope } = useBoardCert();
  const [open, setOpen] = useState(false);
  // 诚实降级：无 cert（token 未就绪 / entitlement 关 / 取认证失败）→ 整条不渲染，看板几何不受影响。
  if (!cert) return null;

  const canEnter = cert.canEnterSimulation;
  const verdictColor = canEnter ? "var(--ok)" : "var(--warn, #e8b54a)";
  const radarValues: Record<string, number> = {
    structure: cert.dims.structure,
    knowledge: cert.dims.knowledge,
    behavior: cert.dims.behavior,
  };

  return (
    <>
      {/* 紧凑单行信任条（非通栏·嵌 header 区·rk-grid 主体不动）。 */}
      <div className={styles.trustBar} data-testid="risk-trustbar" data-can-enter={String(canEnter)}>
        <span className={styles.trustDot} style={{ background: verdictColor }} />
        <b style={{ fontSize: 12.5, color: verdictColor, whiteSpace: "nowrap" }} data-testid="risk-trustbar-verdict">
          {canEnter ? "✓ 可进入推演" : "◐ 可试跑（未认证·结论仅供参考）"}
        </b>
        <span style={{ fontSize: 11, color: "var(--muted2)", whiteSpace: "nowrap" }} data-testid="risk-trustbar-summary">
          就绪认证 {cert.level.replace(/_/g, " ")} · 综合 {cert.dims.composite.toFixed(0)}
        </span>
        <button
          type="button"
          className="badge"
          data-testid="risk-trustbar-toggle"
          onClick={() => setOpen(true)}
          style={{ marginLeft: "auto", cursor: "pointer" }}
        >
          查看完整体检 ▸
        </button>
      </div>

      {/* [查看完整体检] 抽屉（默认关）：L0–L4 stepper + 三维/健康6维/信任4维雷达——全经既有渲染件·零新算（RL3）。 */}
      {open && (
        <div className={styles.drawerScrim} onClick={() => setOpen(false)}>
          <div
            className={styles.drawer}
            role="dialog"
            aria-label="就绪完整体检"
            data-testid="risk-trustbar-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.drawerHead}>
              <b style={{ fontSize: 14 }}>就绪完整体检 · L0–L4 + 双雷达</b>
              <button
                type="button"
                className="btn sm ghost"
                data-testid="risk-trustbar-drawer-close"
                onClick={() => setOpen(false)}
              >
                关闭 ✕
              </button>
            </div>
            <SimReadinessPanel
              cert={cert}
              scope={scope}
              onScopeChange={setScope}
              radar={<ReadinessRadar dims={TRIAD_DIMS} values={radarValues} />}
            />
            <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
              <HealthTrustRadar title="健康度" dims={deriveHealthDims(cert)} color="#43B7D7" />
              <HealthTrustRadar title="信任度" dims={deriveTrustDims(cert)} color="#7BD389" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
