import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ENTERPRISE_STATE_REAL_WORLD_ID, type EnterpriseState, type EnterpriseStateMetric } from "@platform/contracts";
import { fetchLatestEnterpriseState } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import styles from "./SimViews.module.css";

/**
 * WO-ENTERPRISE-STATE · 企业状态快照面板（**只读**）。
 *
 * ── 它答什么 ────────────────────────────────────────────────────────────────
 * 「这个世界**现在**是什么状态」：某个世界（真实 / 仿真）在某个**逻辑时刻**上的
 * KPI / 产能 / 库存 / 订单快照值，按租户本体的域分组。
 *
 * ── 三条本页自己的纪律（每条都对应一次本仓真事故）────────────────────────────
 *
 * ① **一个数都不许写死**（PRD §0.06 裁定二）。本文件里没有任何业务数字、没有任何
 *    行业实体名、没有分组名白名单 —— 分组、标签、单位、数值**全部**来自
 *    `GET /a/v1/twin/enterprise-states/latest` 的响应。反证方式：把该 API 打成 500，
 *    本面板必须变成诚实错误块而不是继续显示一堆数（seam 测试里有这条）。
 *
 * ② **诚实空 ≠ 0**。后端把"数不出来"表达为 `value === null` + `reason`，
 *    本面板必须原样显示成「—」+ 原因，**不许**渲染成 `0` 或 `--` 就完事。
 *    「0」是真数出来是 0，两者在界面上必须分得开，否则看板会用一个假 0 骗人。
 *
 * ③ **时刻显示逻辑时钟，不显示 wall-clock**。顶部那行时间是 `capturedAt.simulatedDate` /
 *    `tick`，不是 `new Date()`。前端一旦自己补一个"现在几点"，界面上的时间就与快照
 *    实际锚定的时间轴分家了 —— 而这份快照的全部意义就在于它锚在某个逻辑时刻上。
 *
 * ── 为什么是"只读" ─────────────────────────────────────────────────────────
 * 捕获（POST）是**写**动作。写真实世界的口子只能有一个（R4 Action 正门），
 * 沙盘右栏这种旁路面板不该开第二个写口 —— 所以这里只展示 `latest`，
 * 没有快照时就照实说"这个世界还没有快照"并把后端给的 `reason` 原样显示。
 */

/** 组内指标按 key 全序（与后端一致，保证同一份数据每次渲染顺序相同）。 */
function groupMetrics(state: EnterpriseState): { group: string; metrics: EnterpriseStateMetric[] }[] {
  const byGroup = new Map<string, EnterpriseStateMetric[]>();
  for (const m of state.metrics) {
    const arr = byGroup.get(m.group) ?? [];
    arr.push(m);
    byGroup.set(m.group, arr);
  }
  return [...byGroup.entries()]
    .map(([group, metrics]) => ({ group, metrics: [...metrics].sort((a, b) => (a.key < b.key ? -1 : 1)) }))
    .sort((a, b) => (a.group < b.group ? -1 : 1));
}

/** 数值展示：`null` → 「—」（诚实空）；有值 → 原样 + 单位。**绝不把 null 渲染成 0**。 */
function fmt(m: EnterpriseStateMetric): string {
  if (m.value === null) return "—";
  const v = Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(2);
  return m.unit ? `${v} ${m.unit}` : v;
}

export function EnterpriseStatePanel({ worldId = ENTERPRISE_STATE_REAL_WORLD_ID }: { worldId?: string }) {
  const q = useQuery({
    // 与 store/eventInvalidation.ts 的 `enterprise-states` 语义标签同一个前缀 ——
    // `enterprise_state.snapshotted` 事件到达时本面板才会真的重取（否则事件就是发给空气的）。
    queryKey: ["a", "enterprise-states", worldId],
    queryFn: () => fetchLatestEnterpriseState(worldId),
    staleTime: 30_000,
  });

  const groups = useMemo(() => (q.data?.state ? groupMetrics(q.data.state) : []), [q.data]);

  if (q.isLoading) {
    return (
      <div className={styles.sub} data-testid="enterprise-state-loading">
        读取企业状态快照…
      </div>
    );
  }

  // 诚实错误块：只陈述能从响应直接读出的事实，不内联病因猜测，更不回落到任何"默认数字"。
  if (q.isError) {
    const e = q.error as { code?: string; message?: string; requestId?: string };
    return (
      <div className={styles.sub} data-testid="enterprise-state-error" style={{ color: "var(--warn-txt)" }}>
        企业状态快照不可用（{e?.code ?? "ERROR"}）：{e?.message ?? "请求失败"}
        {e?.requestId ? ` · requestId ${e.requestId}` : ""}
      </div>
    );
  }

  const state = q.data?.state ?? null;
  if (!state) {
    return (
      <div className={styles.sub} data-testid="enterprise-state-empty">
        {/* 后端给了原因就原样显示 —— 不许前端自己编一句"暂无数据"把它盖掉。 */}
        {q.data?.reason ?? `世界 ${worldId} 尚无任何企业状态快照`}
      </div>
    );
  }

  const emptyCount = state.metrics.filter((m) => m.value === null).length;

  return (
    <div data-testid="enterprise-state-panel">
      <div className={styles.sub} data-testid="enterprise-state-clock" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        {/* ③ 逻辑时钟：显示 tick + 模拟日期 + 时钟原点，**没有 wall-clock**。 */}
        世界 <b className="mono">{state.worldId}</b>
        {state.isSimulated ? "（仿真）" : "（真实）"} · 逻辑时刻{" "}
        <b className="mono" data-testid="enterprise-state-tick">
          tick {state.capturedAt.tick}
        </b>{" "}
        · 模拟日{" "}
        <b className="mono" data-testid="enterprise-state-simdate">
          {state.capturedAt.simulatedDate}
        </b>
        <div data-testid="enterprise-state-clock-note">
          ⚠ 该时刻取自模拟时钟（时钟原点 {state.capturedAt.t0}），<b>不是真实世界的当前时间</b>。
        </div>
      </div>

      {/*
       * 分层（规范 §1 / R-UI-3）：「口径版本 / 读入几类输入 / 从哪 fork 来」是**数据来源**，
       * 规范把它划给浮层；第一层留「自哪来」这一个名字 + `?` 记号。
       * 而下面那条「N 项数不出来」是**诚实位**，且它为真时用户会重新解读上面那些数
       * （规范 §4.2 判据）⇒ 留在第一层，只把「已按诚实空显示为『—』并附原因」这句口径降层。
       */}
      <div className={styles.sub} data-testid="enterprise-state-provenance" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        溯源：{state.provenance.mode === "FORK" ? "自另一份快照 fork" : "自对象库现场捕获"}
        <InfoPopover topic="这份快照怎么来的" testId="enterprise-state-provenance-caliber">
          {state.forkedFromStateId ? `源快照 ${state.forkedFromStateId} · ` : ""}口径版本{" "}
          {state.provenance.captureVersion} · 读入{" "}
          <span data-testid="enterprise-state-input-count">{state.provenance.inputs.length}</span> 类输入
        </InfoPopover>
        {emptyCount > 0 ? (
          <div data-testid="enterprise-state-empty-note">
            其中 <b>{emptyCount}</b> 项<b>数不出来</b>，显示为「—」（<b>不是 0</b>）。
            <InfoPopover topic="为什么是「—」不是 0" testId="enterprise-state-empty-caliber">
              这 {emptyCount} 项当前数不出来，已按诚实空显示为「—」并附原因（<b>不是 0</b>）；
              显示 0 等于断言「数出来就是零」，那是另一件事。
            </InfoPopover>
          </div>
        ) : null}
      </div>

      {groups.map((g) => (
        <div key={g.group} data-testid={`enterprise-state-group-${g.group}`} style={{ marginBottom: 10 }}>
          <div className={styles.grpHead}>
            {/* 分组名来自本体的域 key —— 前端不做任何中文映射白名单（映射表就是第二套真相源）。 */}
            {g.group} <span className={styles.sub}>· {g.metrics.length} 项</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {g.metrics.map((m) => (
                <tr key={m.key} data-testid={`enterprise-state-metric-${m.key}`}>
                  <td style={{ padding: "2px 6px 2px 0", opacity: 0.85 }} title={`${m.source.kind} · ${m.source.ref}`}>
                    {m.label}
                  </td>
                  <td
                    className="mono"
                    style={{ padding: "2px 0", textAlign: "right", whiteSpace: "nowrap" }}
                    data-testid={`enterprise-state-value-${m.key}`}
                  >
                    {fmt(m)}
                  </td>
                  <td style={{ padding: "2px 0 2px 8px", width: "45%" }}>
                    {m.value === null && m.reason ? (
                      <span className={styles.sub} data-testid={`enterprise-state-reason-${m.key}`}>
                        {m.reason}
                      </span>
                    ) : m.target !== null ? (
                      <span className={styles.sub} data-testid={`enterprise-state-target-${m.key}`}>
                        目标 {m.target}
                        {m.unit}
                      </span>
                    ) : (
                      <span className={styles.sub}>{m.source.sampleCount} 行</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default EnterpriseStatePanel;
