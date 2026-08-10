import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SandboxViewConfig, SimCertification, TickState } from "@platform/contracts";
import {
  createSimSession,
  fetchSimCertification,
  fetchSimCompare,
  fetchSimSessions,
  fetchSimViewConfig,
  simBranch,
  simCheckpoint,
  simTick,
  simWorld,
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
import {
  describeSandboxScope,
  EMPTY_SANDBOX_SCOPE,
  SANDBOX_MODES,
  SANDBOX_MODE_LABEL,
  SANDBOX_MODE_QUESTION,
  type SandboxMode,
  type SandboxScope,
} from "./sandboxModes";
import styles from "./SimViews.module.css";

/**
 * WO-SANDBOX-IA-CONSOLIDATE · 四个被收编的推演页（模式切换的后四格）。
 *
 * `lazy` 不是可选项：不 lazy 就等于把四整页的 JS 一起打进沙盘首屏 ——
 * 用户十次里有九次只看「现状」，却每次都为另外四页的代码付加载成本。
 * 与 `App.tsx` 里那四条专用 route 的 `lazy` 是**同一个模块**，
 * 故深链接进来与在沙盘里切过去，加载的是同一份 chunk（不会打两份）。
 */
const CleanroomAttrView = lazy(() => import("@/views/cleanroom/CleanroomAttrView"));
const WhatIfView = lazy(() => import("@/views/WhatIfView"));
const OptimizeWhatifView = lazy(() => import("@/views/OptimizeWhatifView"));
const DisruptionRadiusView = lazy(() => import("@/views/DisruptionRadiusView"));

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
  const qc = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [world, setWorld] = useState<TickState>({});
  const [curTick, setCurTick] = useState(0);

  /**
   * ══ WO-SANDBOX-IA-CONSOLIDATE · 一屏五模式 + 跨模式上下文 ══════════════════════
   *
   * `mode`：当前呈现哪一屏（决策链序见 `sandboxModes.ts`）。默认「现状」= 沙盘控制台本身。
   * **硬约束**：任何时刻只渲染一个模式的内容 —— 切模式 = 换一整屏，判据是另一屏
   * **不在 DOM 里**（`hidden`/`display:none` 一律不算：那只是让人看不见，DOM 还在、请求照发）。
   *
   * `scope`：跨模式活着的上下文。它必须在**这一层**（壳）而不是各模式内部 ——
   * 因为切模式时那些组件整个不渲染，state 随之蒸发。不带上下文的合并只是把五页塞进一个 tab 条。
   */
  const [mode, setMode] = useState<SandboxMode>("now");
  const [scope, setScope] = useState<SandboxScope>(EMPTY_SANDBOX_SCOPE);

  /**
   * ══ WO-L4B（欠账 #145）· `sim.*` 事件的**真消费方**就是下面这两条 useQuery ══
   *
   * 病灶：`sim.session_created` / `sim.branched` / `sim.tick_completed` 三个事件 datacore 一直在发
   * （app.ts:1397 / :1516 / :1467），但前端**没有任何缓存承载它们** —— 会话 id、world、curTick、branchId
   * 全落在本组件的 useState。于是事件发出来没人收，只能记在 SIM_EVENT_GAPS 当缺口（= 欠账 #92 那族：
   * "发了没人收"）。最刺眼的一处：**分支出来的子世界刷新即丢** —— `branchId` 只活在组件 state 里，
   * 后端明明已经把子会话落了库（app.ts:1512 createSession），前端刷一下页面就再也找不到它。
   *
   * 修法不是"给事件塞个空回调让计数好看"，是**把承载它们的缓存真的建出来**：
   *  · `["a","sim-sessions"]`        世界列表 = GET /a/v1/sim/sessions（后端 app.ts:1405 一直都在，
   *                                   缺的只是前端这一跳）→ 分支/建会话后列表真的多一行，刷新也还在；
   *  · `["a","sim-world", sessionId]` 当前世界态 = GET …/:id/world（app.ts:1410；`simWorld` 此前
   *                                   endpoints.ts 有定义，但改造前 src 下没有任何调用点，只有测试桩 ——
   *                                   典型"实现有、没接线"）。
   *
   * 失效→重取的链路：datacore outbox → useDomainEventStream 轮询 → invalidateForEvent →
   * EVENT_INVALIDATES → LABEL_TO_KEYS → 这两个 key。跨标签页/跨用户都能收到。
   *
   * `staleTime: Infinity` 是**刻意**的：世界态的权威副本由本地 mutation（init/tick）用 setQueryData
   * 就地写入，平时不该有背景重取；只有**事件失效**才把它标脏 → 触发真重取。这样"重取"这件事本身
   * 就成了事件到达的证据（测试据此断言副作用真的发生，而不是断言"我调了 invalidateQueries"）。
   */
  const sessionsQuery = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    staleTime: Infinity,
    retry: false,
  });
  const worldQuery = useQuery({
    queryKey: ["a", "sim-world", sessionId ?? ""],
    queryFn: () => simWorld(sessionId as string),
    enabled: !!sessionId,
    staleTime: Infinity,
    retry: false,
  });
  // 事件驱动重取回来的世界态 → 落到屏上（这一步就是 `sim.tick_completed` 的可观测副作用）。
  useEffect(() => {
    const d = worldQuery.data;
    if (!d) return;
    setWorld(d.state);
    setCurTick(d.tick);
  }, [worldQuery.data]);
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
  /**
   * WO-SIM-SCOPE-LOCAL ② · 本会话**建立时用的范围**（= 真正写进 `SimSession.scope` 的那一份）。
   * 与 `certScope`/`certTarget`（就绪认证口径）分开记：两者可以不一致，不一致时屏上必须看得见，
   * 并给一个显式的「按当前范围重建会话」动作 —— 而不是让用户以为自己选的范围已经作用到会话上。
   */
  const [sessionScope, setSessionScope] = useState<{ kind: "GLOBAL" | "LOCAL"; target: string | null } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
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

  // 首次建会话要用「当前选中的范围」，但**不能**让它进那个 effect 的依赖（依赖一变就是第二次 createSimSession）。
  // ref 只读不订阅：既拿得到当前值，又不把 effect 变成"选范围就重建会话"。
  const certScopeRef = useRef<{ kind: "GLOBAL" | "LOCAL"; target: string | null }>({ kind: "GLOBAL", target: null });
  certScopeRef.current = { kind: certScope, target: certScope === "LOCAL" ? effectiveTarget : null };

  // 选中的范围 vs 会话建立时的范围是否已经不是一回事（不一致就必须让用户看见，并给一条显式的收敛路径）。
  const scopeDrifted =
    sessionScope !== null &&
    (sessionScope.kind !== certScope ||
      (certScope === "LOCAL" && sessionScope.target !== effectiveTarget));

  // 全局 KPI = 当前 world 所有对象聚合态的均值（0-100）。
  const globalKpi = useMemo(() => {
    const objs = Object.keys(world);
    if (objs.length === 0) return 0;
    return objs.reduce((a, o) => a + aggregate(world[o]), 0) / objs.length;
  }, [world]);

  /**
   * 建会话：baseSnapshot 由配置派生（无业务常数）。
   *
   * WO-SIM-SCOPE-LOCAL ②：`scope` 从前是硬写的 **`{}`**（空范围）——向导屏里用户逐步选好的
   * `{kind,target}` 被它当场作废（向导 `:112` 建会话 A → `:133` navigate → A 的 id 随组件 state 蒸发 →
   * 本屏 `!sessionId` 又建了个范围为空的会话 B）。现在把**用户当前选的范围真的写进会话**，
   * 会话再也不是"空范围"的了；并记下 `sessionScope` 以便屏上随时对得上账。
   */
  const init = useCallback(async (c: SandboxViewConfig, kind: "GLOBAL" | "LOCAL", target: string | null) => {
    try {
      const base = deriveBaseSnapshot(c);
      const scope = { kind, target: kind === "LOCAL" ? target : null };
      const s = await createSimSession({ baseSnapshot: base, scope });
      setSessionId(s.id);
      setSessionScope(scope);
      setWorld(base);
      setCurTick(0);
      // 权威副本就地写入（避免刚建完又去 GET 一次同样的东西）；此后只有事件失效才触发真重取。
      qc.setQueryData(["a", "sim-world", s.id], { tick: 0, state: base });
      // 建会话 = 世界列表多一行。发起方这一页立刻可见；别的标签页走 sim.session_created 事件。
      void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
      setHistory([Object.keys(base).reduce((a, o) => a + aggregate(base[o]), 0) / Math.max(1, Object.keys(base).length)]);
      // 就绪认证：诚实展示 L0-L4 + 三元组 + Trial Tick + 完整度 + entering + canEnter + gaps。
      // WO-SIM-SCOPE-LOCAL：LOCAL 档必带 target —— 这里也补齐，杜绝再留一个「传 2 个实参」的调用点回潮。
      try {
        setCert(await fetchSimCertification(s.id, kind, kind === "LOCAL" ? (target ?? undefined) : undefined));
      } catch {
        /* certification entitlement 关时容错：仅不显认证面板 */
      }
    } catch (e) {
      toastError(e);
    }
  }, [qc]);

  // 首个会话按**当前选中的范围**建（默认 GLOBAL = 整本体，是个真范围，不是空对象）。
  // 依赖里刻意不放 certScope/effectiveTarget：它们变了要走「重建会话」那条显式路径，
  // 不许在会话建立途中把这个 effect 顶成第二次 createSimSession（重复建会话正是本单要根治的病）。
  useEffect(() => {
    if (cfg && !sessionId) void init(cfg, certScopeRef.current.kind, certScopeRef.current.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, sessionId, init]);

  /** 显式「按当前范围重建会话」：把当前选中的 scope 真的落到一个新会话上（推演从 tick0 重开）。 */
  const rebuildSession = useCallback(async () => {
    if (!cfg || rebuilding) return;
    setRebuilding(true);
    try {
      setBranchId(null);
      setCompare(null);
      await init(cfg, certScope, certScope === "LOCAL" ? effectiveTarget : null);
      toast(`已按范围 ${certScope}${certScope === "LOCAL" ? `:${effectiveTarget}` : ""} 重建会话（推演从 tick 0 重开）`, "success");
    } finally {
      setRebuilding(false);
    }
  }, [cfg, rebuilding, init, certScope, effectiveTarget]);

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
      // 权威副本同步就地更新：本地推进无需再 GET；跨页由 sim.tick_completed 失效后重取。
      qc.setQueryData(["a", "sim-world", sessionId], { tick: res.curTick, state: res.state });
      // tick 同时改了会话行本身（datacore app.ts:1465 写 status=RUNNING + curTick）→ 世界列表也该更新。
      void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
      const g = Object.keys(res.state).reduce((a, o) => a + aggregate(res.state[o]), 0) / Math.max(1, Object.keys(res.state).length);
      setHistory((h) => [...h, g]);
    } catch (e) {
      toastError(e);
    } finally {
      setTicking(false);
    }
  }, [sessionId, qc]);

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
      // 分支 = 世界列表多一个子世界。这一行是「刷新即丢」的正解：子会话此后由**列表缓存**承载，
      // 不再只活在 branchId 这个 useState 里（别的标签页走 sim.branched 事件拿到同样的失效）。
      void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
      const cmp = await fetchSimCompare(sessionId, child.id);
      setCompare(cmp);
      toast(`已从检查点分支（子会话 ${child.id}），可逐 tick 对比`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBranching(false);
    }
  }, [sessionId, curTick, qc]);

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

          {/* ── WO-SIM-SCOPE-LOCAL ②：会话范围对账 + 诚实位 ────────────────────────────
              退役掉的向导屏，唯一有价值的一步是「进沙盘前先把范围选定」；但它选完就丢
              （建了会话 A 就 navigate 走，本屏又建了个 `scope:{}` 的会话 B）。现在范围**真的**
              写进会话，且屏上随时能看到「本会话建立于哪个范围」与「你现在选的是哪个范围」。 */}
          <div data-testid="sandbox-session-scope" className={styles.sub} style={{ marginBottom: 8, lineHeight: 1.6 }}>
            <div data-testid="sandbox-session-scope-of-record">
              本会话建立于范围{" "}
              <b className="mono">
                {sessionScope ? `${sessionScope.kind}${sessionScope.target ? `:${sessionScope.target}` : ""}` : "（建立中…）"}
              </b>
            </div>
            {/* 诚实位（不许暗示范围已生效）：`SimSession.scope` 今天在引擎侧**有写端无读端** ——
                落库在 datacore `app.ts:1391`，此后只被读 `snapshotKind` 一个键（`:1408`/`:1705` 过滤方案快照·
                `:1512` 分支整体继承）；tick 路（`app.ts:1415` 起）遍历的是 `ontologyTypes.list(tenantId)` 全本体，
                从不看 `session.scope`。所以范围选择当前**只作用于就绪认证口径，尚未裁剪推演本身**。
                这笔账另记（G-SIM-SCOPE-UNREAD），本屏只负责不撒谎。 */}
            <div data-testid="sandbox-scope-reach-note">
              ⚠ 范围选择当前<b>只作用于就绪认证口径</b>，<b>尚未裁剪推演本身</b>——推演引擎按整租户本体传导，不读会话范围。
            </div>
            {scopeDrifted && (
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span data-testid="sandbox-scope-drift" style={{ color: "var(--warn)" }}>
                  你当前选的范围（{certScope}
                  {certScope === "LOCAL" ? `:${effectiveTarget}` : ""}）与本会话建立时的范围不一致。
                </span>
                <button
                  className="btn sm ghost"
                  data-testid="sandbox-scope-rebuild-btn"
                  disabled={rebuilding}
                  onClick={() => void rebuildSession()}
                >
                  {rebuilding ? "重建中…" : "按当前范围重建会话"}
                </button>
              </div>
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
      /**
       * WO-L4B · 世界列表（`sim.session_created` / `sim.branched` / `sim.tick_completed` 的**可观测落点**）。
       *
       * 这不是为了让订阅计数好看而摆的空壳：它修的是一个真缺陷 —— 分支出来的子世界此前只活在
       * `branchId` 这个 useState 里，**刷新即丢**（后端 app.ts:1512 明明已经把子会话落库了）。
       * 现在它由 `["a","sim-sessions"]` 缓存承载：分支后列表真的多一行、刷新还在、别的标签页
       * 经 sim.branched 事件也会看到。每行还显示 status/curTick —— 那正是 tick 处理器在 emit 前
       * 写进会话的两个字段（app.ts:1465），所以 `sim.tick_completed` 失效这张表不是凑数。
       */
      id: "worlds",
      title: "世界列表",
      defaultOpen: true,
      node: (
        <div data-testid="sandbox-worlds">
          {sessionsQuery.isError ? (
            <div className={styles.sub} data-testid="sandbox-worlds-error">
              世界列表不可用（沙盘功能未开通或后端不可达）
            </div>
          ) : (sessionsQuery.data?.items?.length ?? 0) === 0 ? (
            <div className={styles.sub} data-testid="sandbox-worlds-empty">
              {sessionsQuery.isLoading ? "加载世界列表…" : "还没有推演会话。"}
            </div>
          ) : (
            <ul data-testid="sandbox-worlds-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {sessionsQuery.data?.items.map((s) => {
                const isCurrent = s.id === sessionId;
                const isBranch = s.parentCheckpointId != null;
                return (
                  <li
                    key={s.id}
                    data-testid={`sandbox-world-${s.id}`}
                    data-current={isCurrent ? "1" : "0"}
                    data-branch={isBranch ? "1" : "0"}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", font: "600 10px var(--font-mono)" }}
                  >
                    <span className="mono" style={{ color: isCurrent ? "var(--accent)" : "var(--muted2)" }}>
                      {isBranch ? "↳ " : ""}
                      {s.id}
                    </span>
                    <span className={styles.sub}>
                      {s.status} · tick {s.curTick}
                      {isBranch ? " · 分支" : " · 主线"}
                    </span>
                    {isCurrent ? (
                      <span className={styles.sub} data-testid={`sandbox-world-current-${s.id}`}>（当前）</span>
                    ) : (
                      <button
                        className="btn sm ghost"
                        data-testid={`sandbox-world-switch-${s.id}`}
                        onClick={() => {
                          // 切世界：只换 sessionId —— worldQuery 的 key 随之变，自动取该世界的真实态。
                          setSessionId(s.id);
                          setBranchId(null);
                          setCompare(null);
                          setHistory([]);
                        }}
                      >
                        切到此世界
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
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
      <SandboxModeSwitch mode={mode} onChange={setMode} scope={scope} />
      {/* ══ 一次只渲染一个模式 ═══════════════════════════════════════════════════
          判据是另一屏**不在 DOM**，不是 hidden —— 故这里是**互斥的条件渲染**，
          不是「都挂上再藏一个」。`hidden` 只让人看不见：DOM 还在、请求照发、
          读屏器照读、页面照样越来越挤（变异 A2 亲手证过这一改测试就红）。

          ⚠ 下面 `<SandboxConsole>` 那一整块**故意没有跟着多缩进一层**：
          它一行内容都没改，只是被包进了条件分支。重新缩进 130 行会让 diff 从
          「加了个壳」变成「整块重写」，与并行的其它前端单撞车面积成倍放大。
          这是刻意的取舍，不是漏改格式。 */}
      {mode !== "now" ? <SandboxModePane mode={mode} /> : null}
      {mode !== "now" ? null : (
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
        // WO-SANDBOX-IA-CONSOLIDATE · 基地范围提到壳里（受控）：切模式不丢。
        // 只提 state，不动控制台任何布局——左栏勾选框、testid、语义（空数组 = 全部基地）一字未改。
        scopeBaseIds={scope.baseIds}
        onScopeBaseIdsChange={(baseIds) => setScope((s) => ({ ...s, baseIds }))}
      />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-IA-CONSOLIDATE · 模式切换骨架（本单只做壳，不重画各模式内部布局）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 顶部模式切换条 + 跨模式上下文条（沙盘这一屏的**第一层**）。
 *
 * ── 分层（`docs/CONVENTION-ui-information-layering.md`）────────────────────────
 *  · **第一层**（不点就看见）：五个模式名 + 当前模式回答哪一问 + 当前范围读数。
 *    只有「名字 / 它是什么 / 一个读数」——没有公式、没有口径推导、没有明细。
 *  · **第二层**（一次点击）：「已收编的原独立页」折叠清单（深链接仍可达，见 `<details>`）。
 *  · 口径与诚实位（订单锚点 / 时窗为什么不在壳里）走 `title` 浮层与折叠区，不占第一层。
 *
 * 仓主对这一屏的原话是「信息太多，第一层看不到重点」——**并完更挤 = 这次合并是负分**。
 * 故本条只加一行按钮 + 一行范围读数，其余一律降层。
 */
function SandboxModeSwitch({
  mode,
  onChange,
  scope,
}: {
  mode: SandboxMode;
  onChange: (m: SandboxMode) => void;
  scope: SandboxScope;
}) {
  return (
    <div className="panel" data-testid="sandbox-mode-switch" data-mode={mode} style={{ padding: 10, marginBottom: 10 }}>
      {/* `role="group"` + `aria-pressed` 而不是 `tablist`/`tab`/`aria-selected`：
          ARIA 的 tab 必须能指向一个 `tabpanel`，而这里切的是**整屏**（另一屏根本不在 DOM），
          没有稳定的 panel id 可指。用 tab 语义会向读屏器承诺一个不存在的关系。
          这也与 `SandboxConsole` 画布模式条的既有做法一致（`role="group" aria-label="画布模式"`）。*/}
      <div role="group" aria-label="推演模式" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {SANDBOX_MODES.map((m, i) => (
          <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {/* 决策链的箭头是**结构表达**，不是装饰：五个模式是「看见 → 为什么 → 试试看 → 最优 → 波及」
                这一条链，不是一排并列 tab（规范 §3：结构本身也要画出来）。 */}
            {i > 0 ? <span aria-hidden style={{ color: "var(--muted2)", fontSize: 11 }}>→</span> : null}
            <button
              type="button"
              className={`btn sm${mode === m ? " primary" : ""}`}
              data-testid={`sandbox-mode-${m}`}
              aria-pressed={mode === m}
              title={SANDBOX_MODE_QUESTION[m]}
              onClick={() => onChange(m)}
            >
              {SANDBOX_MODE_LABEL[m]}
            </button>
          </span>
        ))}
      </div>

      {/* 当前模式回答哪一问（一句话，第一层唯一的说明性文字） */}
      <div className={styles.sub} data-testid="sandbox-mode-question" style={{ marginTop: 6 }}>
        {SANDBOX_MODE_QUESTION[mode]}
      </div>

      {/*
        跨模式上下文条 —— **常驻**（五个模式下都在，且读数同一份）。
        这一条是合并的价值本身：不带上下文的合并只是把五页塞进一个 tab 条。
        诚实位（订单锚点 / 时窗为什么不在这里）降到 title 浮层，不占第一层。
      */}
      <div
        className={styles.sub}
        data-testid="sandbox-scope-strip"
        style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <span>
          当前范围（切模式保持）：<b data-testid="sandbox-scope-bases">{describeSandboxScope(scope)}</b>
        </span>
        <span
          data-testid="sandbox-scope-honesty"
          title={
            "订单锚点：今天不是壳级控件——它由线路图按 so 自取（chain_loss_attribution 唯一认的入参），" +
            "壳里没有第二个订单选择器，硬造一个就是各模式各用各的假旋钮。\n" +
            "时窗：chain_loss_attribution 只认 so、chain_impediments 只认 scope，两者都没有时间窗入参，" +
            "故控制台顶栏那个 30D/60D/90D 是禁用的（挂「时窗无 ARGS」徽标），壳里不再造第二个。"
          }
          style={{ cursor: "help", textDecoration: "underline dotted" }}
        >
          ⓘ 订单锚点 / 时窗尚未提为壳级上下文
        </span>
      </div>

      {/*
        第二层：已收编的原独立页 —— 默认折叠。
        存在理由有二：① 深链接（书签 / 外部链接）仍然可达，这里让它**看得见**，
        不是只有知道 URL 的人才进得去；② 沙盘对某些页只做了投影而非全量搬运
        （`chain-impediments` 的阈值出处 / 未判定判据等四块，见 AUDIT §2）——
        那些内容今天只在原独立页上，得留一条路过去。
      */}
      <details data-testid="sandbox-consolidated-links" style={{ marginTop: 6 }}>
        <summary className={styles.sub} style={{ cursor: "pointer" }}>
          已收编的原独立页（{CONSOLIDATED_PAGES.length} 个 · 深链接仍可达）
        </summary>
        <div className={styles.sub} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          {CONSOLIDATED_PAGES.map((p) => (
            <a key={p.key} href={`/v/${p.key}`} data-testid={`sandbox-consolidated-${p.key}`} title={p.where}>
              {p.label}
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * 收编清单的**屏上投影**（键与 `ShellLayout.CONSOLIDATED_INTO_SANDBOX` 同源 —— 那张表是导航侧的
 * 单一出处，本屏只补一个人读标签）。`sandbox-ia-consolidate.seam` 有一条断言咬两侧不许漂移。
 */
const CONSOLIDATED_PAGES: { key: string; label: string; where: string }[] = [
  { key: "chain-line-map", label: "全链线路图", where: "已在：中栏画布默认模式「线路图」" },
  { key: "physical-topology", label: "物理拓扑", where: "已在：中栏画布模式「物理拓扑」" },
  { key: "node-inspector", label: "节点检视", where: "已在：右栏常驻面板 → 页签「变量输入」" },
  { key: "transit-flow", label: "在途与在制", where: "已在：线路图上的「在途批次图层」勾选框" },
  { key: "chain-impediments", label: "全链阻滞点", where: "已在：主屏统计条 + 逐条清单（阈值出处等四块仍只在原页）" },
  { key: "cleanroom-attr", label: "净室归因", where: "已在：模式「归因」" },
  { key: "what-if", label: "假设推演", where: "已在：模式「试一手」" },
  { key: "optimize-whatif", label: "优化推演", where: "已在：模式「求最优」" },
  { key: "disruption-radius", label: "断供影响半径", where: "已在：模式「影响半径」" },
];

/**
 * 非「现状」模式的内容承载 —— **内容原样搬进来，不重画布局**（本单是骨架单）。
 *
 * 三件事在这里做，别的一件不做：
 *  ① 只渲染当前模式那一个（调用点已经 `mode !== "now"` 才挂，本组件内部再按 mode 分发**一个**）；
 *  ② 给一个稳定的壳级 testid `sandbox-mode-pane-<m>` —— 各模式自己的根 testid
 *     （`cleanroom-attr` / `what-if` / …）在数据取不到时会换成诚实空态，
 *     用它们当"这一屏在不在"的判据会把**空态**误判成**没渲染**；
 *  ③ `<Suspense>`：四个模式都是 `lazy` 进来的（不 lazy 就等于把四页的 JS 全塞进沙盘首屏）。
 */
function SandboxModePane({ mode }: { mode: Exclude<SandboxMode, "now"> }) {
  return (
    <div data-testid={`sandbox-mode-pane-${mode}`} data-mode={mode}>
      <Suspense fallback={<div className="empty-state" data-testid={`sandbox-mode-loading-${mode}`}>加载{SANDBOX_MODE_LABEL[mode]}…</div>}>
        {mode === "attribute" ? <CleanroomAttrView /> : null}
        {mode === "tryone" ? <WhatIfView /> : null}
        {mode === "optimize" ? <OptimizeWhatifView /> : null}
        {mode === "radius" ? <DisruptionRadiusView /> : null}
      </Suspense>
    </div>
  );
}
