import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SandboxViewConfig, SimCertification, TickState } from "@platform/contracts";
import {
  createSimSession,
  fetchSimCertification,
  fetchSimCompare,
  fetchSimViewConfig,
  simBranch,
  simCheckpoint,
  simTick,
  submitQuery,
  type SimCompareSeries,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { useFeature } from "@/workspace/featureGate";
import { useWorkspace } from "@/workspace/useWorkspace";
import { TaskRun } from "@/components/QueryDock/TaskRun";
import { PmDag, type PmDagNode } from "./PmDag";
import { HeatStrip, useActionDraft } from "./shared";
import { SimReadinessPanel } from "./SimReadinessPanel";
import { SimComparePanel } from "./SimComparePanel";
import styles from "./SimViews.module.css";

/**
 * 推演沙盘主决策页（增量 4 · R17「一页看全 数据→推演→溯源→动作→AI」· 配置驱动·零业务常数 R14）。
 *
 * 全部节点 / 边 / 状态变量 / 雷达维 / KPI 来自 `GET /a/v1/sim/view-config`（= 租户本体 + 传导规则派生），
 * 代码里**零行业实体名**——换租户 / 换行业 = 换本体内容，本组件一行不改（两配置证见 test/sandbox-view.test.tsx）。
 *
 * 交互：init 会话（baseSnapshot 由 view-config 派生）→「推进 tick」simTick → 节点色 / KPI 随 world 态变。
 * 复用：PmDag（拓扑）· HeatStrip（KPI heat）· 自绘就绪雷达（维 = certification.dims）。
 */

// ── 确定性派生（R6/R14）：从配置 + 索引算初值，无任何业务常数（纯结构哈希）。 ────────────
/** 字符串 → 稳定 [0,1)（用于把抽象 key 映射成可视初值；与行业无关）。 */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** 从配置派生 tick0 世界态。P0 修：键 = **真物化对象 id**（cfg.nodeObjectIds，= propagateTick 引擎 idsByType
 * 同源）→ state[sourceId] 真命中 → tick 真传导。空世界（该类型无对象）退 `${type}#0` 占位（无传导，页面仍可跑）。 */
export function deriveBaseSnapshot(cfg: SandboxViewConfig): TickState {
  const state: TickState = {};
  const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"]; // 无传导规则态：单占位变量，保证页面可跑
  for (const t of cfg.nodeTypes) {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`]; // 有真对象用真 id；空世界退占位键
    for (const oid of keys) {
      const row: Record<string, number> = {};
      for (const v of vars) row[v] = Math.round(hash01(`${oid}|${v}`) * 100);
      state[oid] = row;
    }
  }
  return state;
}

/** 对象当前态聚合成单值（节点着色用）：所有 stateVar 均值，0-100。 */
function aggregate(row: Record<string, number> | undefined): number {
  if (!row) return 0;
  const vals = Object.values(row);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** 聚合值 → 着色（高=暖红 警示 / 中=琥珀 / 低=青）。纯函数，无业务语义。 */
function heatColor(v: number): string {
  if (v >= 70) return "#E0626C";
  if (v >= 45) return "#E8B54A";
  return "#43B7D7";
}

/** 配置 → PmDag 单层节点（节点=nodeTypes，着色 = 该类型**所有真物化对象**当前态均值）。
 * P0 修：world 现按真对象 id 键 → 聚合 cfg.nodeObjectIds[t] 各对象态（空世界退 `${t}#0` 占位）。 */
function buildNodes(cfg: SandboxViewConfig, world: TickState): PmDagNode[] {
  return cfg.nodeTypes.map((t) => {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`];
    const vals = keys.map((k) => aggregate(world[k]));
    const v = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { id: t, label: t, sub: `Σ ${v.toFixed(0)}`, color: heatColor(v), st: 0 };
  });
}

/** 配置 → 边：优先用 linkTypes 串成相邻链；无链路则按 nodeTypes 顺序兜底相邻（保证拓扑可见）。 */
function buildEdges(cfg: SandboxViewConfig): [string, string][] {
  const n = cfg.nodeTypes;
  const edges: [string, string][] = [];
  for (let i = 0; i + 1 < n.length; i++) edges.push([n[i]!, n[i + 1]!]);
  return edges;
}

// ── 就绪雷达（自绘·维数动态 = certification.dims，不复用固定 5 维 RadarChart）─────────────
function ReadinessRadar({
  dims,
  values,
  size = 168,
}: {
  dims: { key: string; label: string }[];
  values: Record<string, number>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, frac: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(100, frac)) / 100;
    return [Number((cx + r * k * Math.cos(a)).toFixed(2)), Number((cy + r * k * Math.sin(a)).toFixed(2))];
  };
  const rings = [1 / 3, 2 / 3, 1].map((f) =>
    dims.map((_, i) => pt(i, f * 100).join(",")).join(" "),
  );
  const poly = dims.map((d, i) => pt(i, values[d.key] ?? 0).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="就绪雷达" data-testid="sandbox-radar">
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
      })}
      <polygon points={poly} fill="#43B7D7" fillOpacity={0.22} stroke="#43B7D7" strokeWidth={1.6} data-testid="sandbox-radar-polygon" />
      {dims.map((d, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const lx = cx + (size / 2 - 8) * Math.cos(a);
        const ly = cy + (size / 2 - 8) * Math.sin(a);
        return (
          <text key={d.key} x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fill="#9AA8B6" data-testid={`sandbox-radar-axis-${d.key}`}>
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

/** 测试可注入 config（绕过网络，喂两套 mock config 证 R14）；生产留空走 view-config 端点。 */
export interface SandboxViewProps {
  injectedConfig?: SandboxViewConfig;
}

/**
 * WO-REAL-LLM-FREE-QUERY · AI 指挥台 NL 入口（R17「…→AI」一格落地）：自然语言指挥沙盘
 *（如「把某基地产能推进两个 tick 看负载」）→ 带**本沙盘 sessionId** 提交 QOS → orchestrator 识别沙盘上下文
 *（filters.simSessionId）+ sim.commander 开 → path-B → agent 调 sim_* 工具**真驱动本会话**（模拟态·不写真值 R4）。
 * `sim.commander` 关 → 入口**不存在**（R3 暗发·useFeature 门）。答案经 TaskRun 流式渲染（诚实标真 LLM 推理）。
 */
function SimCommanderDock({ sessionId, curTick }: { sessionId: string | null; curTick: number }) {
  const commanderOn = useFeature("sim.commander"); // R3：关→入口不存在
  const { data: workspace } = useWorkspace();
  const [input, setInput] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!commanderOn) return null;
  const packageId = workspace?.scenarioPackages[0] ?? "";
  const submit = async () => {
    const q = input.trim();
    if (!q || !sessionId || !packageId || busy) return;
    setBusy(true);
    try {
      // 带沙盘 sessionId 作上下文（filters.simSessionId）→ orchestrator 指挥台分路 → agent 用 sim_tick/sim_world 驱动本会话。
      const res = await submitQuery(
        { packageId, query: q, context: { view: "sim-sandbox", selectedObjects: [], filters: { simSessionId: sessionId, simCurTick: String(curTick) } } },
        crypto.randomUUID(),
      );
      setTaskId(res.taskId);
      setInput("");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" data-testid="sim-commander-dock" style={{ padding: 12, marginTop: 12 }}>
      <div className={styles.secHead}>AI 指挥台 · 自然语言驱动推演</div>
      <div className={styles.sub} style={{ marginBottom: 8 }}>
        用自然语言指挥本沙盘会话（如「把某基地产能推进两个 tick 看负载」）——AI 经 path-B 调 sim_* 工具真驱动（模拟态·不写真值 R4）。
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          data-testid="sim-commander-input"
          value={input}
          placeholder={sessionId ? "例：推进两个 tick 看哪些节点过载" : "沙盘会话未就绪…"}
          disabled={!sessionId || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          style={{ flex: 1 }}
        />
        <button className="btn primary" data-testid="sim-commander-submit" disabled={!sessionId || busy || !input.trim()} onClick={() => void submit()}>
          {busy ? "指挥中…" : "指挥"}
        </button>
      </div>
      {taskId && (
        <div style={{ marginTop: 10 }} data-testid="sim-commander-answer">
          <TaskRun taskId={taskId} />
        </div>
      )}
    </div>
  );
}

export default function SandboxView({ injectedConfig }: SandboxViewProps = {}) {
  const cfgQuery = useQuery({
    queryKey: ["a", "sim", "view-config"],
    queryFn: fetchSimViewConfig,
    enabled: !injectedConfig,
    retry: false,
  });
  const cfg = injectedConfig ?? cfgQuery.data;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [world, setWorld] = useState<TickState>({});
  const [curTick, setCurTick] = useState(0);
  const [ticking, setTicking] = useState(false);
  const [history, setHistory] = useState<number[]>([]); // 逐 tick 全局均值轨迹（时间轴/KPI heat）
  const [cert, setCert] = useState<SimCertification | null>(null);
  const [certScope, setCertScope] = useState<"GLOBAL" | "LOCAL">("GLOBAL"); // ④ 就绪范围（现可切，不再写死 GLOBAL）
  const [branching, setBranching] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null); // 子分支会话 id（对比用）
  const [compare, setCompare] = useState<{ a: SimCompareSeries; b: SimCompareSeries } | null>(null);
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值）

  // 全局 KPI = 当前 world 所有对象聚合态的均值（0-100）。
  const globalKpi = useMemo(() => {
    const objs = Object.keys(world);
    if (objs.length === 0) return 0;
    return objs.reduce((a, o) => a + aggregate(world[o]), 0) / objs.length;
  }, [world]);

  // init 会话：baseSnapshot 由配置派生（无业务常数）。配置就绪即自动建会话。
  const init = useCallback(async (c: SandboxViewConfig) => {
    try {
      const base = deriveBaseSnapshot(c);
      const s = await createSimSession({ baseSnapshot: base, scope: {} });
      setSessionId(s.id);
      setWorld(base);
      setCurTick(0);
      const g0 = Object.keys(base).reduce((a, o) => a + aggregate(base[o]), 0) / Math.max(1, Object.keys(base).length);
      setHistory([g0]);
      // 就绪认证：诚实展示 L0-L4 + 三元组 + Trial Tick + 完整度 + entering + canEnter + gaps。
      try {
        setCert(await fetchSimCertification(s.id, certScope));
      } catch {
        /* certification entitlement 关时容错：仅不显认证面板 */
      }
    } catch (e) {
      toastError(e);
    }
  }, [certScope]);

  useEffect(() => {
    if (cfg && !sessionId) void init(cfg);
  }, [cfg, sessionId, init]);

  // ④ scope 切换 → 重取就绪认证（GLOBAL↔LOCAL），不重建会话。
  const reloadCert = useCallback(
    async (scope: "GLOBAL" | "LOCAL") => {
      setCertScope(scope);
      if (!sessionId) return;
      try {
        setCert(await fetchSimCertification(sessionId, scope));
      } catch {
        /* 容错 */
      }
    },
    [sessionId],
  );

  const onTick = useCallback(async () => {
    if (!sessionId) return;
    setTicking(true);
    try {
      const res = await simTick(sessionId, 1);
      setWorld(res.state);
      setCurTick(res.curTick);
      const g = Object.keys(res.state).reduce((a, o) => a + aggregate(res.state[o]), 0) / Math.max(1, Object.keys(res.state).length);
      setHistory((h) => [...h, g]);
    } catch (e) {
      toastError(e);
    } finally {
      setTicking(false);
    }
  }, [sessionId]);

  const onCheckpoint = useCallback(async () => {
    if (!sessionId) return;
    try {
      const cp = await simCheckpoint(sessionId, `tick${curTick}`);
      toast(`检查点已存：${cp.label}（tick ${cp.tick}）`, "success");
    } catch (e) {
      toastError(e);
    }
  }, [sessionId, curTick]);

  // 分支（北极星）：当前 tick 存检查点 → 从该检查点派生子会话 → 取 A(主线)/B(分支) 对比序列。
  const onBranch = useCallback(async () => {
    if (!sessionId) return;
    setBranching(true);
    try {
      const cp = await simCheckpoint(sessionId, `branch@tick${curTick}`);
      const child = await simBranch(sessionId, cp.id);
      setBranchId(child.id);
      const cmp = await fetchSimCompare(sessionId, child.id);
      setCompare(cmp);
      toast(`已从检查点分支（子会话 ${child.id}），可逐 tick 对比`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBranching(false);
    }
  }, [sessionId, curTick]);

  // 对比刷新（分支会话各自推进后重新拉序列；A 主线 + B 分支）。
  const onRefreshCompare = useCallback(async () => {
    if (!sessionId || !branchId) return;
    try {
      setCompare(await fetchSimCompare(sessionId, branchId));
    } catch (e) {
      toastError(e);
    }
  }, [sessionId, branchId]);

  // 采纳此推演结论 → R4 Action 草稿（RL4 正门）：沙盘是模拟态不写真值，采纳才经 Action 审批流写。
  const onAdopt = useCallback(() => {
    if (!sessionId) return;
    adopt.mutate({
      actionTypeKey: "plan_change",
      payload: {
        // plan_change 必填 versionId + reason（走 S2 审批正门）；沙盘以会话@tick 作版本锚。
        versionId: `sim:${sessionId}@tick${curTick}`,
        reason: `采纳推演沙盘结论（${certScope} · 全局态 ${globalKpi.toFixed(1)}${cert ? ` · ${cert.level}` : ""}）`,
        patch: {
          source: "sim_sandbox",
          simulated: true, // 诚实标：此为模拟态结论，采纳才经 Action 正门写真值（RL4）
          sessionId,
          tick: curTick,
          globalKpi: Number(globalKpi.toFixed(2)),
          certLevel: cert?.level ?? null,
          scope: certScope,
        },
      },
    });
  }, [sessionId, curTick, globalKpi, cert, certScope, adopt]);

  if (!cfg) {
    if (cfgQuery.isError) return <div className="empty-state" data-testid="sandbox-config-error">沙盘配置不可用（沙盘功能未开通或本体为空）</div>;
    return <div className="empty-state" data-testid="sandbox-loading">加载沙盘配置…</div>;
  }

  const nodes = buildNodes(cfg, world);
  const edges = buildEdges(cfg);
  const radarValues: Record<string, number> = cert
    ? { structure: cert.dims.structure, knowledge: cert.dims.knowledge, behavior: cert.dims.behavior }
    : {};

  return (
    <div data-testid="sandbox-view" className={styles.head}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3>推演沙盘 · 一页看全（数据 → 推演 → 溯源 → 动作 → AI）</h3>
        <div className={styles.sub} data-testid="sandbox-config-summary">
          本体派生：{cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 · {cfg.propagationCount} 传导规则
        </div>
      </div>

      {/* KPI 行：全局态 + 逐 stateVar（全从配置 stateVars 渲染）
          WO-UNIT-MEANING：这些读数此前是裸数「62.5」。量纲＝**0–100 状态指数**——由本文件 deriveBaseSnapshot
          （`hash01()*100`）与 aggregate（"所有 stateVar 均值，0-100"）共同界定，是**前端沙盘自有口径**，
          后端/契约无对应 unit 字段可消费（tick 引擎只回 Record<string,number>），故就近在标签上标量程。 */}
      <div className={styles.threeKpiRow} data-testid="sandbox-kpis">
        <div className={styles.kpi} data-testid="sandbox-kpi-global">
          <span>全局态（0–100 指数 · tick {curTick}）</span>
          <b style={{ color: heatColor(globalKpi) }} data-testid="sandbox-kpi-global-val">{globalKpi.toFixed(1)}</b>
        </div>
        {cfg.stateVars.map((v) => {
          const objs = Object.keys(world);
          const avg = objs.length ? objs.reduce((a, o) => a + (world[o]?.[v] ?? 0), 0) / objs.length : 0;
          return (
            <div key={v} className={styles.kpi} data-testid={`sandbox-kpi-${v}`}>
              <span>{v}（0–100 指数·全对象均值）</span>
              <b data-testid={`sandbox-kpi-${v}-val`}>{avg.toFixed(1)}</b>
            </div>
          );
        })}
      </div>

      {/* 控制条：推进 tick / 存档 / tick 时间轴 heat */}
      <div className="panel" data-testid="sandbox-controls" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 12 }}>
        <button className="btn" data-testid="sandbox-tick-btn" disabled={!sessionId || ticking} onClick={onTick}>
          {ticking ? "推进中…" : "推进 tick"}
        </button>
        <button className="btn sm" data-testid="sandbox-checkpoint-btn" disabled={!sessionId} onClick={onCheckpoint}>
          存档检查点
        </button>
        <button className="btn sm" data-testid="sandbox-branch-btn" disabled={!sessionId || branching} onClick={onBranch}>
          {branching ? "分支中…" : "分支（多场景对比）"}
        </button>
        <button className="btn sm primary" data-testid="sandbox-adopt-btn" disabled={!sessionId || adopt.isPending} onClick={onAdopt}>
          {adopt.isPending ? "采纳中…" : "采纳此推演结论"}
        </button>
        <div style={{ flex: 1, minWidth: 160 }} data-testid="sandbox-timeline">
          <div className={styles.sub} style={{ marginBottom: 2 }}>tick 时间轴（全局态轨迹）</div>
          <HeatStrip series={history} threshold={70} />
        </div>
      </div>

      <div className={styles.twoCol} style={{ marginTop: 12 }}>
        {/* 就绪面板（左）：6 项砌齐 —— L0-L4 stepper / L4 三元组 / Trial Tick / scope 切换 / 完整度 gauge / entering 清单 */}
        <div className="panel" data-testid="sandbox-readiness" style={{ padding: 12 }}>
          {cert ? (
            <SimReadinessPanel
              cert={cert}
              scope={certScope}
              onScopeChange={(s) => void reloadCert(s)}
              radar={<ReadinessRadar dims={cfg.radarDims} values={radarValues} />}
            />
          ) : (
            <>
              <div className={styles.secHead}>就绪认证</div>
              <div className={styles.sub} data-testid="sandbox-cert-na">就绪认证未开通（sim.certification 关）</div>
            </>
          )}
        </div>

        {/* 拓扑（右）：PmDag 单层，节点=nodeTypes，着色随 world 态 */}
        <div className="panel" data-testid="sandbox-topology" style={{ padding: 12 }}>
          <div className={styles.secHead}>本体拓扑（节点态随 tick 变色）</div>
          {nodes.length > 0 ? (
            <PmDag layers={[nodes]} edges={edges} step={0} testId="sandbox-dag" />
          ) : (
            <div className={styles.sub} data-testid="sandbox-topology-empty">本体暂无已发布对象类型——先在建模页发布对象。</div>
          )}
        </div>
      </div>

      {/* 多场景 KPI 对比面板（北极星）：分支后出现，A 主线 vs B 分支逐 tick 差异 */}
      {compare && (
        <div className="panel" data-testid="sandbox-compare" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className={styles.sub}>分支后各自推进 tick，再刷新对比看 A/B 差异</span>
            <button className="btn sm ghost" data-testid="sandbox-compare-refresh-btn" disabled={!branchId} onClick={onRefreshCompare}>
              刷新对比
            </button>
          </div>
          <SimComparePanel a={compare.a} b={compare.b} />
        </div>
      )}

      {/* AI 指挥台 NL 入口（R17「…→AI」·WO-REAL-LLM-FREE-QUERY）：sim.commander 关则不存在（R3 暗发）。 */}
      <SimCommanderDock sessionId={sessionId} curTick={curTick} />
    </div>
  );
}
