import { useMemo, useState } from "react";
import { Feature } from "@/workspace/featureGate";
import { useLiveSolver } from "./useLiveSolver";
import { fmt } from "./shared";
import styles from "./SimViews.module.css";

/**
 * WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用 what-if 面板（前端 Δ 分解 · R3）。
 *
 * 读**真求解器输出**派生（cross_object_occupancy 出占用/被挤订单 · optimize_whatif 出各目标 Δ 分解）：
 *  ① 各目标当前值（营收/违约金/换型成本） ② 改权重滑杆 → 调 optimize_whatif → 各目标 Δ 分解卡
 *  ③ 跨对象占用表（哪些订单上哪条线 + 被挤订单 displaced + 违约金）。
 * 徽标诚实标「CP-SAT 可证最优（推演结果）」——绝不标「数据库事实」。`opt.multiobj` 关 → 整块不存在（R3）。
 *
 * 展示用固定三元（订单×产线×合同）：产线容量+合同额度双约束逼出权衡；改权重→最优真漂移（被挤订单变）。
 */

// 展示三元：A/B 争抢唯一 6-容量线 L1（互斥），C 常驻 L2；合同 K1 额度 11 = 一个 6-单 + C(5)。
// 默认权重下服务 B（避高违约金）挤掉 A；把营收权重拉到 2× → 翻转服务 A 挤掉 B（改权重→最优真漂移）。
const ORDERS = [
  { id: "SO-A", revenue: 300, penalty: 10, qty: 6, contractId: "K1", label: "SO-A 高营收单" },
  { id: "SO-B", revenue: 200, penalty: 200, qty: 6, contractId: "K1", label: "SO-B 高违约金单" },
  { id: "SO-C", revenue: 150, penalty: 20, qty: 5, contractId: "K1", label: "SO-C 中价单" },
];
const LINES = [
  { id: "L1", capacity: 6 },
  { id: "L2", capacity: 5 },
];
const CONTRACTS = [{ id: "K1", cap: 11 }];
const ELIGIBILITY = [
  { order: "SO-A", line: "L1", cost: 2 },
  { order: "SO-B", line: "L1", cost: 2 },
  { order: "SO-C", line: "L2", cost: 1 },
  { order: "SO-C", line: "L1", cost: 4 },
];

const OBJ_META: Record<string, { name: string; goodWhenNeg: boolean }> = {
  revenue: { name: "营收", goodWhenNeg: false },
  penalty: { name: "违约金", goodWhenNeg: true },
  cost: { name: "换型成本", goodWhenNeg: true },
};

interface OccResult {
  occupancy: { order: string; line: string }[];
  displaced: string[];
  objectiveValues: Record<string, number>;
  servedCount: number;
  optimal: boolean;
}
interface WhatifResult {
  deltaByObjective?: Record<string, number>;
  feasible: boolean;
  explanation?: string;
}

function crossArgs(w: Record<string, number>): Record<string, unknown> {
  return {
    scale: 1,
    seed: 42,
    orders: ORDERS.map(({ label, ...o }) => o),
    lines: LINES,
    contracts: CONTRACTS,
    eligibility: ELIGIBILITY,
    method: "weighted",
    objectives: [
      { key: "revenue", weight: w.revenue },
      { key: "penalty", weight: w.penalty },
      { key: "cost", weight: w.cost },
    ],
  };
}

function MultiObjWhatifInner() {
  const [w, setW] = useState<Record<string, number>>({ revenue: 1, penalty: 1, cost: 1 });

  // ③ 当前占用（真 cross_object_occupancy）：改权重即重算（useLiveSolver debounce）。
  const occ = useLiveSolver<OccResult>("cross_object_occupancy", crossArgs(w), (raw) => raw as OccResult);

  // ② 多目标 Δ 分解（真 optimize_whatif）：基线权重(1,1,1) → 当前权重的各目标 Δ。
  const perturbations = useMemo(
    () => (["revenue", "penalty", "cost"] as const).map((k) => ({ kind: "change_objective_weight" as const, target: `objectives.${k}.weight`, value: w[k]! })),
    [w],
  );
  const whatif = useLiveSolver<WhatifResult>(
    "optimize_whatif",
    { family: "cross_object_occupancy", args: crossArgs({ revenue: 1, penalty: 1, cost: 1 }), perturbations },
    (raw) => raw as WhatifResult,
  );

  const orderLabel = (id: string) => ORDERS.find((o) => o.id === id)?.label ?? id;
  const ov = occ.data?.objectiveValues ?? {};
  const delta = whatif.data?.deltaByObjective;
  // KILL-MOCK-RED：优化器 CP-SAT sidecar 未接入时后端**显式抛「未接入」错**（service.ts）——面板须诚实披露，
  // 不能静默把空/0 当结果显示（0 会被误读为「真求解出来是 0」）。有任何求解错就披露。
  const solverErr = occ.error ?? whatif.error;
  const notWired = !!solverErr && /未接入|OPTIMIZER_BASE_URL|sidecar/i.test(solverErr.message);

  return (
    <div className={styles.audCard} data-testid="multiobj-whatif">
      <div className={styles.audHead}>
        <strong>多目标 + 跨对象占用推演</strong>
        <span className={styles.chip} title="决策变量在 CP-SAT 上求可证最优，非数据库既有事实" data-testid="multiobj-badge">
          CP-SAT 可证最优 · 推演结果（非数据库事实）
        </span>
      </div>

      {/* 输入示意披露（假·toy fixture 诚实化·KILL-MOCK-RED·AUDIT 2026-07-24）：SO-A/B/C 三元是演示权衡机制的
          固定示意场景（产线容量+合约额度双约束），非本租户真实订单簿；下方数字是真求解器基于该示意输入的计算结果。 */}
      <div className={styles.noteInfo} data-testid="multiobj-input-disclosure" style={{ fontSize: 11, margin: "2px 0 6px" }}>
        ⓘ 输入为<b>示意样例</b>（SO-A/B/C × 产线 L1/L2 × 合约 K1·演示"产线容量+合约额度双约束逼出权衡"机制），
        非本租户真实订单簿；下方营收/违约金/换型成本为<b>真求解器</b>（cross_object_occupancy · optimize_whatif）基于该示意输入的计算结果，改权重→最优真漂移。
      </div>

      {/* KILL-MOCK-RED：优化器未接入/求解失败 → 显式披露，绝不让空/0 冒充真实结果 */}
      {solverErr && (
        <div
          data-testid="multiobj-not-wired"
          style={{ fontSize: 12, margin: "4px 0 8px", padding: "6px 10px", borderRadius: 6, background: "rgba(192,57,43,.08)", border: "1px solid rgba(192,57,43,.35)", color: "var(--c-danger, #c0392b)" }}
        >
          {notWired ? (
            <>⚠ <b>优化器引擎（CP-SAT sidecar）未接入</b>——需设 <code>OPTIMIZER_BASE_URL</code> 并启动 <code>services/optimizer</code>。下方数值为空/0 表示<b>「尚未求解」</b>，<b>不是</b>真实推演结果。</>
          ) : (
            <>⚠ 求解失败：{solverErr.message}。下方数值非有效结果。</>
          )}
        </div>
      )}

      {/* ① 各目标当前值 —— 数字诚实化（KILL-MOCK·防误读成亿/万元）：这些是「当前权重下最优方案」的目标值，
          示意值·无量纲（示意 fixture 非真金额）·会随权重此消彼长；接真订单簿后才标真实口径（万元/亿元）。 */}
      <div style={{ fontSize: 11, opacity: 0.7, margin: "6px 0 2px" }} data-testid="multiobj-objvalues-caption">
        当前权重下<b>最优方案</b>的各目标值（<b>示意值·无量纲</b>·非金额·随权重变）
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 8px" }} data-testid="multiobj-objvalues">
        {(["revenue", "penalty", "cost"] as const).map((k) => (
          <div key={k} className={styles.kpi} style={{ minWidth: 120 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{OBJ_META[k]!.name}{OBJ_META[k]!.goodWhenNeg ? "（越低越好）" : "（越高越好）"}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {typeof ov[k] === "number" ? fmt(ov[k]!, 0) : "—"}
              {typeof ov[k] === "number" ? <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 400, marginLeft: 3 }}>示意值</span> : null}
            </div>
          </div>
        ))}
      </div>

      {/* ② 权重滑杆 → 各目标 Δ 分解卡 */}
      <div className={styles.miniForm} style={{ display: "grid", gap: 8, margin: "8px 0" }}>
        {(["revenue", "penalty", "cost"] as const).map((k) => (
          <label key={k} className={styles.formRow} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 80 }}>{OBJ_META[k]!.name}权重</span>
            <input
              type="range" min={0} max={2} step={0.1} value={w[k]}
              data-testid={`multiobj-weight-${k}`}
              onChange={(e) => setW((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
            />
            <span style={{ width: 40, textAlign: "right" }}>{w[k]!.toFixed(1)}×</span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0" }} data-testid="multiobj-delta-cards">
        {delta
          ? (["revenue", "penalty", "cost"] as const).map((k) => {
              const d = delta[k] ?? 0;
              const good = OBJ_META[k]!.goodWhenNeg ? d < 0 : d > 0;
              const color = d === 0 ? "#888" : good ? "#2e9e5b" : "#c0392b";
              return (
                <div key={k} className={styles.kpi} style={{ minWidth: 130, borderLeft: `3px solid ${color}` }} data-testid={`multiobj-delta-${k}`}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{OBJ_META[k]!.name} Δ</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color }}>{d > 0 ? "+" : ""}{fmt(d, 0)}</div>
                </div>
              );
            })
          : <span style={{ opacity: 0.6 }}>调整权重滑杆查看各目标 Δ 分解…</span>}
      </div>

      {/* ③ 跨对象占用表 + 被挤订单 */}
      <table className={styles.abCompare} data-testid="multiobj-occupancy" style={{ width: "100%", marginTop: 8 }}>
        <thead>
          <tr><th>订单</th><th>获排产线</th><th>营收</th><th>违约金(未排即计)</th></tr>
        </thead>
        <tbody>
          {ORDERS.map((o) => {
            const loaded = !!occ.data;
            const on = occ.data?.occupancy.find((a) => a.order === o.id);
            const displaced = occ.data?.displaced.includes(o.id) ?? false;
            return (
              <tr key={o.id} data-testid={`multiobj-row-${o.id}`} style={displaced ? { opacity: 0.55 } : undefined}>
                <td>{orderLabel(o.id)}</td>
                {/* 未加载完不得渲染「被挤」占位（否则 loading 态伪装成 displaced）；仅数据到手且真未排才标被挤。 */}
                <td>{!loaded ? "…" : on ? on.line : <span style={{ color: "#c0392b" }} data-testid={`multiobj-displaced-${o.id}`}>被挤（未排）</span>}</td>
                <td>{fmt(o.revenue, 0)}</td>
                <td>{displaced ? fmt(o.penalty, 0) : "0"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {occ.data?.displaced.length ? (
        <div className={styles.noteAmber} data-testid="multiobj-displaced-note" style={{ marginTop: 6 }}>
          被挤订单：{occ.data.displaced.map(orderLabel).join("、")}（产线容量/合同额度约束下的最优取舍，改权重可换人）
        </div>
      ) : null}
      {whatif.error || occ.error ? <div className={styles.noteRed}>求解失败：{String((whatif.error || occ.error)?.message ?? "")}</div> : null}
    </div>
  );
}

/** opt.multiobj 关 → 整块不存在（R3）。 */
export function MultiObjWhatifPanel() {
  return (
    <Feature flag="opt.multiobj">
      <MultiObjWhatifInner />
    </Feature>
  );
}
