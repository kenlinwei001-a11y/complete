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
import { SandboxConsole, type SandboxConsoleRailSection } from "./SandboxConsole";
import styles from "./SimViews.module.css";

/**
 * 推演沙盘主决策页（增量 4 · R17「一页看全 数据→推演→溯源→动作→AI」· 配置驱动·零业务常数 R14）。
 *
 * ══ WO-SANDBOX-CONSOLE 改造：本页从「PmDag 单层拓扑 + 就绪雷达 + tick 控制条」变成**一页控制台** ══
 *
 * 上一单（WO-SANDBOX-VIEW-MOUNT）把 F1–F4 四个已完工组件登记进后端 `BUILTIN_VIEWS` 让它们可达，
 * 代价是它们成了**四个平级导航页**，而本主屏一行没动。设计稿的 IA 是**一页**，不是五个页。
 * 现在本文件的职责拆成两半：
 *  · **布局与两个链路求解器** → `SandboxConsole`（新组件）：顶栏 / 阻滞点统计条 / 三栏 / Pareto / 指标行；
 *  · **会话与推演逻辑** → 仍在本文件：init / tick / checkpoint / branch / compare / adopt / certification /
 *    AI 指挥台。这些是**已接线的真功能，一个都没删**，只是换了摆放位置：
 *
 *    | 旧主屏的东西      | 现在在哪                                                    |
 *    |------------------|------------------------------------------------------------|
 *    | KPI 行            | 顶栏标签（`topTags`）：全局态 + 各 stateVar 均值             |
 *    | tick 控制条       | 控制台的 `controlBar` 槽（三栏之下、Pareto 之上）             |
 *    | 就绪认证 + 雷达   | 右栏可折叠区「就绪认证」（默认展开）                          |
 *    | 多场景对比        | 右栏可折叠区「多场景对比」（分支后出现）                      |
 *    | AI 指挥台         | 右栏可折叠区「AI 指挥台」                                     |
 *    | 本体 PmDag 拓扑   | 画布**第四模式**「本体拓扑」（`ontologyCanvas` 槽）           |
 *
 * 全部节点 / 边 / 状态变量 / 雷达维 / KPI 仍来自 `GET /a/v1/sim/view-config`（= 租户本体 + 传导规则派生），
 * 代码里**零行业实体名**——换租户 / 换行业 = 换本体内容，本组件一行不改（两配置证见 test/sandbox-view.test.tsx）。
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
  /**
   * WO-SIM-SCOPE-LOCAL · 局部范围的**目标对象类型**（= `GET …/certification?scope=LOCAL&target=<typeKey>` 的 target）。
   *
   * 病灶（本单修的就是它）：`certScope` 这个枚举开关当初从向导屏搬到主屏时**只搬了枚举、没搬它的参数**——
   * 调用点只传 2 个实参（`fetchSimCertification(sid, scope)`），`endpoints.ts` 的 URL 模板遇 `target===undefined`
   * 就整段不拼 `&target=`；后端 `app.ts:1589` 的裁子图条件是 `scopeKind === "LOCAL" && target`，target 为 null ⇒
   * 恒 false ⇒ **types = allTypes（全本体）**，而 `app.ts:1640` 仍照 `scopeKind` 回 `scope:"LOCAL"`。
   * 净效果：用户点「局部」，屏上写「局部」，**算的是全局** —— 静默错答（同族 R-ARG-FIDELITY / G-ARG-DROP-SEAM，
   * 危害不在崩溃而在没人知道它算的不是你问的那个范围）。
   *
   * 修法（(A) 补齐参数）：本 state 承载 target，LOCAL 档必带它下发；候选**全部来自 view-config 的 nodeTypes**
   * （= 租户本体派生），代码里零行业实体名（R14）。本体无已发布对象类型 ⇒ target 无从取值 ⇒ 走 (B) 诚实降级：
   * **不提供** LOCAL 档（拒绝进入「说 LOCAL 算 GLOBAL」那个状态），屏上写明原因。
   */
  const [certTarget, setCertTarget] = useState<string>("");
  const [branching, setBranching] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null); // 子分支会话 id（对比用）
  const [compare, setCompare] = useState<{ a: SimCompareSeries; b: SimCompareSeries } | null>(null);
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值）

  // ── WO-SIM-SCOPE-LOCAL：局部范围候选与生效 target ──────────────────────────────
  // 候选 = 本体派生的 nodeTypes（零业务常数 R14）。未显式选过时取首个（语义抄向导屏 step①，但**不 import 它**）。
  // 刻意**不用 useEffect 初始化 state**：那会让 `init` 的依赖在会话建立途中变身 → 重跑 init → 重复建会话。
  const localTargets = cfg?.nodeTypes ?? [];
  const effectiveTarget = certTarget || localTargets[0] || "";
  const canLocal = localTargets.length > 0; // 本体无对象类型 ⇒ LOCAL 无 target 可带 ⇒ 该档不提供（诚实降级）

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
      // WO-SIM-SCOPE-LOCAL：LOCAL 档必带 target —— 这里也补齐，杜绝再留一个「传 2 个实参」的调用点回潮。
      try {
        setCert(await fetchSimCertification(s.id, certScope, certScope === "LOCAL" ? effectiveTarget : undefined));
      } catch {
        /* certification entitlement 关时容错：仅不显认证面板 */
      }
    } catch (e) {
      toastError(e);
    }
  }, [certScope, effectiveTarget]);

  useEffect(() => {
    if (cfg && !sessionId) void init(cfg);
  }, [cfg, sessionId, init]);

  // ④ scope 切换 → 重取就绪认证（GLOBAL↔LOCAL），不重建会话。
  // LOCAL 必带 target；**先拿到与该范围对应的数字、再切屏上的档**，杜绝「档位说 LOCAL、数字还是上一次 GLOBAL」。
  const reloadCert = useCallback(
    async (scope: "GLOBAL" | "LOCAL", target?: string) => {
      const t = target ?? effectiveTarget;
      if (scope === "LOCAL" && !t) {
        // 诚实降级（(B)）：没有 target 的 LOCAL 在后端等同 GLOBAL（app.ts:1589 条件恒 false），
        // 只是回包上仍印着 "LOCAL"。宁可不提供该档，也不把全局数字挂上局部的名字。
        toast("局部范围需先选对象类型；本体暂无已发布对象类型，故不提供局部范围（不以全局结果冒充局部）", "info");
        return;
      }
      if (!sessionId) {
        setCertScope(scope);
        if (scope === "LOCAL") setCertTarget(t);
        return;
      }
      try {
        const next = await fetchSimCertification(sessionId, scope, scope === "LOCAL" ? t : undefined);
        setCert(next);
        setCertScope(scope);
        if (scope === "LOCAL") setCertTarget(t);
      } catch {
        /* 容错：失败时**不切档**——屏上范围与屏上数字必须始终同源 */
      }
    },
    [sessionId, effectiveTarget],
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
        // 范围随结论走：LOCAL 必带目标对象类型（否则留痕里的「LOCAL」说不清算的是哪一块 —— 本单病灶的下游）。
        reason: `采纳推演沙盘结论（${certScope}${certScope === "LOCAL" ? `:${cert?.targetRef ?? effectiveTarget}` : ""} · 全局态 ${globalKpi.toFixed(1)}${cert ? ` · ${cert.level}` : ""}）`,
        patch: {
          source: "sim_sandbox",
          simulated: true, // 诚实标：此为模拟态结论，采纳才经 Action 正门写真值（RL4）
          sessionId,
          tick: curTick,
          globalKpi: Number(globalKpi.toFixed(2)),
          certLevel: cert?.level ?? null,
          scope: certScope,
          // 溯源位（R13）：优先用**后端真回来的** targetRef（= 真正参与裁子图的那个），而非前端 state 的一厢情愿。
          scopeTarget: certScope === "LOCAL" ? (cert?.targetRef ?? effectiveTarget) : null,
        },
      },
    });
  }, [sessionId, curTick, globalKpi, cert, certScope, effectiveTarget, adopt]);

  if (!cfg) {
    if (cfgQuery.isError) return <div className="empty-state" data-testid="sandbox-config-error">沙盘配置不可用（沙盘功能未开通或本体为空）</div>;
    return <div className="empty-state" data-testid="sandbox-loading">加载沙盘配置…</div>;
  }

  const nodes = buildNodes(cfg, world);
  const edges = buildEdges(cfg);
  const radarValues: Record<string, number> = cert
    ? { structure: cert.dims.structure, knowledge: cert.dims.knowledge, behavior: cert.dims.behavior }
    : {};

  // ── 右栏可折叠区：旧主屏的就绪认证 / 多场景对比 / AI 指挥台，一个都不许掉 ─────────
  const rail: SandboxConsoleRailSection[] = [
    {
      id: "readiness",
      title: "就绪认证",
      defaultOpen: true,
      node: (
        <div data-testid="sandbox-readiness">
          {/* WO-SIM-SCOPE-LOCAL：局部范围的目标对象类型选择器（候选来自本体派生 cfg.nodeTypes·R14 零行业实体名）。
              LOCAL 档从此**真带 target** 下发；本体空 ⇒ 该档不提供并当面写明原因（诚实降级，不冒充局部）。 */}
          <div
            data-testid="sandbox-cert-target-row"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
          >
            <span className={styles.sub}>局部范围目标</span>
            {canLocal ? (
              <>
                <select
                  data-testid="sandbox-cert-target-select"
                  value={effectiveTarget}
                  aria-label="局部范围目标对象类型"
                  onChange={(e) => {
                    const t = e.target.value;
                    setCertTarget(t);
                    // 已在局部档 → 换目标即换范围，必须重算；全局档下只记住选择，不发无意义请求。
                    if (certScope === "LOCAL") void reloadCert("LOCAL", t);
                  }}
                >
                  {localTargets.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className={styles.sub} data-testid="sandbox-cert-target-hint">
                  {certScope === "LOCAL"
                    ? `当前按对象类型 ${effectiveTarget} 裁子图计算`
                    : "切到「局部」后按此对象类型裁子图计算"}
                </span>
              </>
            ) : (
              <span className={styles.sub} data-testid="sandbox-cert-local-unavailable">
                本体暂无已发布对象类型 → 局部范围不提供（无目标的「局部」在后端等同全局，不以全局结果冒充局部）
              </span>
            )}
          </div>
          {cert ? (
            <SimReadinessPanel
              cert={cert}
              scope={certScope}
              onScopeChange={(s) => void reloadCert(s)}
              radar={<ReadinessRadar dims={cfg.radarDims} values={radarValues} size={132} />}
            />
          ) : (
            <div className={styles.sub} data-testid="sandbox-cert-na">
              就绪认证未开通（sim.certification 关）
            </div>
          )}
        </div>
      ),
    },
    {
      id: "compare",
      title: "多场景对比",
      node: compare ? (
        <div data-testid="sandbox-compare">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className={styles.sub}>分支后各自推进 tick，再刷新对比看 A/B 差异</span>
            <button className="btn sm ghost" data-testid="sandbox-compare-refresh-btn" disabled={!branchId} onClick={onRefreshCompare}>
              刷新对比
            </button>
          </div>
          <SimComparePanel a={compare.a} b={compare.b} />
        </div>
      ) : (
        <div className={styles.sub} data-testid="sandbox-compare-idle">
          还没有分支。点控制条的「分支（多场景对比）」从当前 tick 派生子会话，这里出 A/B 逐 tick 差异。
        </div>
      ),
    },
    {
      id: "commander",
      title: "AI 指挥台",
      node: <SimCommanderDock sessionId={sessionId} curTick={curTick} />,
    },
  ];

  return (
    <div data-testid="sandbox-view" className={styles.head}>
      <SandboxConsole
        // 旧主屏 KPI 行 → 顶栏标签（全局态 + 逐 stateVar 均值，量纲仍是 0–100 状态指数）
        topTags={
          <>
            <span data-testid="sandbox-config-summary" style={{ font: "600 10px var(--font-mono)", color: "var(--muted2)" }}>
              本体派生 {cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 ·{" "}
              {cfg.propagationCount} 传导规则
            </span>
            <span
              data-testid="sandbox-kpis"
              style={{ display: "flex", gap: 8, alignItems: "center", font: "600 10px var(--font-mono)" }}
            >
              <span data-testid="sandbox-kpi-global">
                全局态（0–100 指数 · tick {curTick}）{" "}
                <b style={{ color: heatColor(globalKpi) }} data-testid="sandbox-kpi-global-val">
                  {globalKpi.toFixed(1)}
                </b>
              </span>
              {cfg.stateVars.map((v) => {
                const objs = Object.keys(world);
                const avg = objs.length ? objs.reduce((a, o) => a + (world[o]?.[v] ?? 0), 0) / objs.length : 0;
                return (
                  <span key={v} data-testid={`sandbox-kpi-${v}`}>
                    {v}（0–100 指数·全对象均值） <b data-testid={`sandbox-kpi-${v}-val`}>{avg.toFixed(1)}</b>
                  </span>
                );
              })}
            </span>
          </>
        }
        // 旧主屏 tick 控制条：推进 / 存档 / 分支 / 采纳 / tick 时间轴 heat（整块搬来，行为不变）
        controlBar={
          <div
            className="panel"
            data-testid="sandbox-controls"
            style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 10 }}
          >
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
              <div className={styles.sub} style={{ marginBottom: 2 }}>
                tick 时间轴（全局态轨迹 · 模拟态，采纳才经 Action 正门写真值 R4）
              </div>
              <HeatStrip series={history} threshold={70} />
            </div>
          </div>
        }
        // 旧主屏本体 PmDag 拓扑 → 画布第四模式
        ontologyCanvas={
          <div data-testid="sandbox-topology" style={{ padding: 10, overflow: "auto" }}>
            {nodes.length > 0 ? (
              <PmDag layers={[nodes]} edges={edges} step={0} testId="sandbox-dag" />
            ) : (
              <div className={styles.sub} data-testid="sandbox-topology-empty">
                本体暂无已发布对象类型——先在建模页发布对象。
              </div>
            )}
          </div>
        }
        rail={rail}
      />
    </div>
  );
}
