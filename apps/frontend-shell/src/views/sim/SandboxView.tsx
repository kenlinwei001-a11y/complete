import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImpactChange, PerturbationKind, SandboxViewConfig, SimCertification, TickState } from "@platform/contracts";
import {
  createSimPerturbation,
  createSimSession,
  fetchSimCertification,
  fetchSimCheckpoints,
  fetchSimCompare,
  fetchSimSessions,
  fetchSimViewConfig,
  simBranch,
  simCheckpoint,
  simRollback,
  simTick,
  simWorld,
  submitQuery,
  type SimCompareSeries,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
import { useFeature } from "@/workspace/featureGate";
import { useWorkspace } from "@/workspace/useWorkspace";
import { TaskRun } from "@/components/QueryDock/TaskRun";
import { PmDag, type PmDagNode } from "./PmDag";
import { PerturbationTimeline, PERTURBATION_KINDS } from "./PerturbationTimeline";
import { HeatStrip, useActionDraft } from "./shared";
import { SimReadinessPanel } from "./SimReadinessPanel";
import { SimComparePanel } from "./SimComparePanel";
import { SandboxConsole, type SandboxConsoleRailSection } from "./SandboxConsole";
import { SandboxImpactBand } from "./SandboxImpactBand"; // WO-SANDBOX-V3 · ③下区影响带（本文件是它唯一的生产调用方）
import consoleStyles from "./SandboxConsole.module.css";
import {
  describeSandboxScope,
  EMPTY_SANDBOX_SCOPE,
  SANDBOX_MODES,
  SANDBOX_MODE_LABEL,
  SANDBOX_MODE_QUESTION,
  type SandboxMode,
  type SandboxScope,
} from "./sandboxModes";
import { EnterpriseStatePanel } from "./EnterpriseStatePanel"; // WO-ENTERPRISE-STATE · 企业状态快照（只读）——本文件的 rail 是它唯一的生产调用方
import { EnterpriseStateTwinPanel } from "./EnterpriseStateTwinPanel"; // WO-BEFE-WIRE-3 · 快照分叉(fork)与比对(diff)——同样，本文件的 rail 是它唯一的生产调用方
import SandboxPlaysPanel, { type PlayAnchor } from "./SandboxPlaysPanel"; // WO-V4-PLAYS · 方案环（本文件的左区是它唯一的生产调用方）
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
 * 治理横幅上**先显几条**缺件。纯呈现常数（不是业务阈值 —— 它不参与任何判定，
 * 改成 2 或 5 都不会让任何结论变），且截断量当面写出来（「另有 N 条」+ 进抽屉看全），
 * 所以它不可能变成一条"看起来只有这么多"的谎。
 */
const BANNER_GAP_PREVIEW = 3;

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

/**
 * 扰动语义类型的中文标签（WO-SIM-ACT-CLOSE）。
 *
 * 逐条对应契约 `PerturbationKindSchema` 的枚举成员（`packages/contracts/src/sim.ts`）——
 * 这是**契约枚举的显示名**，不是业务数据：换行业这五类照样成立（契约注释里写明 `kind` 不进传导规则，
 * 只管展示分类）。枚举里加了成员而这里没加 ⇒ 该项在下拉里消失，`sandbox-perturbation.seam.test.tsx`
 * 的逐条对账用例会红。
 */
// WO-SIM-PERTURB-TIMELINE：`PERTURBATION_KINDS` 已挪进 `PerturbationTimeline.tsx` 并从那里导出 ——
// 施加表单（本文件）与扰动时间轴（那里）显示的是同一批分类名，两处各写一份迟早对不上。
// 依赖方向是单向的（SandboxView → PerturbationTimeline），不成环。

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

/**
 * ══ WO-V4-HONEST-ORIGIN（PRD-sandbox-v4 §2.1 / §4.3）· 屏上这批读数**是哪来的** ══════════
 *
 * `DERIVED` = 前端 `deriveBaseSnapshot` 的哈希占位值（`hash01(对象id|变量名)×100`）。
 *   它是 R6 合规的确定性占位，**不改它的派生本身** —— 改成"看着不像 50"只会得到一屏
 *   更像真的假数据，比现在更坏（PRD §2.1 末段原话）。要修的是**记号**，不是数值。
 * `MEASURED` = 后端世界态（`GET …/:id/world` 回包 / `POST …/tick` 回包 / `POST …/perturbations` 回包）。
 *
 * ⚠ 为什么出处必须**跟着数据走**、不能用 `worldQuery.data !== undefined` 推断：
 *   `init()` 建完会话就 `qc.setQueryData(["a","sim-world", id], …)` 把**占位值**塞进了同一个缓存键，
 *   而该 query 是 `staleTime: Infinity` ⇒ 新建会话的那个 GET **根本不会发**。
 *   于是「data 到达」这个信号在新建会话时**恒真且恒假**（有 data，但那是前端自己塞的占位）。
 *   照它标记就会立刻显示"实测"而屏上全是哈希数 —— 那正是本单要消灭的那种谎，只是换了个说法。
 *   故把出处**写进缓存条目本身**：塞占位时标 `DERIVED`，`queryFn` 真取回来时标 `MEASURED`，
 *   tick / 扰动的回包同样标 `MEASURED`。谁写的数据谁盖章，不靠下游猜。
 */
export type WorldOrigin = "DERIVED" | "MEASURED";
/** 世界态缓存条目（`["a","sim-world", sessionId]`）。`origin` 是**这份 state 的出处**，不是 UI 状态。 */
export interface WorldSnapshot {
  tick: number;
  state: TickState;
  origin: WorldOrigin;
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

/**
 * WO-SANDBOX-DECLUTTER · **主屏唯一保留的治理信号**：为什么现在不能推演。
 *
 * ── 为什么只留这一条 ──────────────────────────────────────────────────────────
 * 就绪认证整块（L0–L4 stepper、三维准备度、世界完整度 gauge、entering 清单、缺件清单）
 * 是**建模者**的工作台，收进诊断抽屉。但其中有**一位**信息是决策者必须当面看到的：
 * 「这个沙盘还没通过就绪认证，所以你现在看到的结论只是试跑」。
 * 那句话不该藏在抽屉里 —— 藏起来就等于默认让人把未认证的结论当认证结论用。
 *
 * ── 三条硬判据 ────────────────────────────────────────────────────────────────
 * ① `canEnterSimulation === true` ⇒ **返回 null**（不渲染，不占像素）。「一切正常」不需要横幅。
 * ② `cert` 还没取到（认证 entitlement 关 / 请求未回）⇒ 也返回 null。
 *    **不知道**不等于**不能推演**，拿一条警告去填未知就是在编造治理结论。
 * ③ 显示的每一条 gap 都是 `cert.gaps[]` 的原文（gapCode / ref / detail 逐字透传），
 *    截断了必须写明还剩几条，并给一条进抽屉看全的路。
 */
function SimGovernanceBanner({
  cert,
  onOpenDiagnostics,
}: {
  cert: SimCertification | null;
  onOpenDiagnostics: () => void;
}) {
  // ②：cert 未取到时不出横幅（未知 ≠ 不可推演）。
  if (cert === null) return null;
  // ①：已认证 ⇒ 整条不渲染。
  if (cert.canEnterSimulation) return null;
  const shown = cert.gaps.slice(0, BANNER_GAP_PREVIEW);
  const rest = cert.gaps.length - shown.length;
  return (
    <div className={consoleStyles.banner} data-testid="sandbox-gov-banner" role="status">
      <span className={consoleStyles.bannerTitle} data-testid="sandbox-gov-banner-title">
        ◐ {zh.sim.sandbox.banner.title}
      </span>
      {shown.length > 0 ? (
        <span className={consoleStyles.bannerGaps} data-testid="sandbox-gov-banner-gaps">
          {zh.sim.sandbox.banner.why}
          {shown.map((g, i) => (
            <span key={`${g.gapCode}-${i}`} data-testid={`sandbox-gov-banner-gap-${i}`}>
              {i > 0 ? "；" : ""}
              <code>{g.gapCode}</code> · {g.ref} — {g.detail}
            </span>
          ))}
          {rest > 0 ? <span data-testid="sandbox-gov-banner-more">（{zh.sim.sandbox.banner.more(rest)}）</span> : null}
        </span>
      ) : null}
      <button
        type="button"
        className="btn sm ghost"
        data-testid="sandbox-gov-banner-cta"
        aria-label={zh.sim.sandbox.banner.ctaAria}
        onClick={onOpenDiagnostics}
      >
        {zh.sim.sandbox.banner.cta}
      </button>
    </div>
  );
}

/** 第一层保留几个读数（**布局**常数，非业务常数）：其余降进 `<details>` 第二层。
 *  取 3 与规范 §2 R-UI-2「一屏最多三级」同源 —— 第一层要能一眼扫完，不是把表搬上来。 */
const FIRST_LAYER_KPIS = 3;

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
  const worldQuery = useQuery<WorldSnapshot>({
    queryKey: ["a", "sim-world", sessionId ?? ""],
    // WO-V4-HONEST-ORIGIN：**真取回来的**那一份盖 `MEASURED` 章。占位那一份由 `init` 盖 `DERIVED`。
    queryFn: async () => ({ ...(await simWorld(sessionId as string)), origin: "MEASURED" as const }),
    enabled: !!sessionId,
    staleTime: Infinity,
    retry: false,
  });
  /**
   * 屏上这批读数的出处（顶栏诚实位的唯一真相源）。
   * 初值 `DERIVED`：会话还没建时屏上是空世界 / 建完就是 `deriveBaseSnapshot` 的占位 ——
   * 两种情形都**不是**实测，先标占位再说；标错方向的代价是把假数说成真数，反过来只是保守。
   */
  const [worldOrigin, setWorldOrigin] = useState<WorldOrigin>("DERIVED");
  // 事件驱动重取回来的世界态 → 落到屏上（这一步就是 `sim.tick_completed` 的可观测副作用）。
  useEffect(() => {
    const d = worldQuery.data;
    if (!d) return;
    setWorld(d.state);
    setCurTick(d.tick);
    setWorldOrigin(d.origin);
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
  /**
   * WO-BEFE-E · 存档清单（`GET /a/v1/sim/sessions/:id/checkpoints`）。
   *
   * 在此之前「存档检查点」这颗按钮**存进去的东西没有任何出口**：`onCheckpoint` 只 toast 一句，
   * 清单看不到、回滚点不了；分支用的还是当场新存的那一个，历史存档一个都用不上。
   * 这条 query 就是那个出口 —— 也是 `sim.checkpoint_saved` 事件第一次有可失效的缓存承载。
   */
  const checkpointsQuery = useQuery({
    queryKey: ["a", "sim-checkpoints", sessionId ?? ""],
    queryFn: () => fetchSimCheckpoints(sessionId as string),
    enabled: !!sessionId,
    retry: false,
  });
  const [rollingBack, setRollingBack] = useState<string | null>(null); // 正在回滚的那个 checkpointId
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值）

  /**
   * ══ WO-SIM-ACT-CLOSE（欠账 #150）· 扰动入口 —— 沙盘此前**没有任何施加扰动的动作** ══
   *
   * 病灶（实测复核 2026-08-10，非照抄台账）：后端两个入口都在、都能用，缺的是**用户这一跳**：
   *  · `POST /a/v1/sim/sessions/:id/act`          零 src 调用方（只有 datacore 测试调），
   *    `endpoints.ts` **连封装都没有** ⇒ 铁律 0.5 形态①「没接线」；
   *  · `POST /a/v1/sim/sessions/:id/perturbations` `endpoints.ts` 有 `createSimPerturbation` 封装
   *    （WO-P0 落的），但**全仓无 UI 调用方** ⇒ 形态②「接了线没数据」，从用户视角同样是不存在。
   * 净效果：用户能推进时间、能存档、能分叉、能比对，**唯独不能让任何事情发生** ——
   * 一个只会原地滴答的沙盘（PRD §2.2①）。
   *
   * 走 `/perturbations` 而不是 `/act`：后者是前者的退化子集（`mode:"set"` + `durationTicks:null`，
   * 契约 `applyPerturbationToState` 已是两者唯一施加实现），但它**无 id、不入库、不发事件、无时序**，
   * 于是「这个世界受过哪些扰动」问不出来、「第 5 天起停机 72h」排不了。接一个一等公民的入口，
   * 不接一个裸标量写入。
   */
  const [pKind, setPKind] = useState<PerturbationKind>("capacity_loss");
  const [pObject, setPObject] = useState<string>("");
  const [pStateVar, setPStateVar] = useState<string>("");
  const [pMode, setPMode] = useState<"set" | "delta" | "scale">("delta");
  const [pMagnitude, setPMagnitude] = useState<string>("-10");
  const [pDuration, setPDuration] = useState<string>(""); // 空 = 永久（durationTicks: null）
  const [perturbing, setPerturbing] = useState(false);
  /** 最近一次施加的回执（后端真回的 perturbation + 该动作造成的 KPI 变化量）——不是本地臆造的乐观态。 */
  /**
   * 最近一次扰动。
   *
   * WO-SANDBOX-V3 补了 `change` 那三个字段（`objectType` / `objectId` / `prop` / `value`）——
   * 它们就是下区 `ImpactAnalysisPanel` 要的那"一处变更"（`ImpactChangeSchema`）。
   * 以前只留 `label`（人话串）与前后 KPI，**没有机器可用的落点**，
   * 于是影响传播只能挂在「试一手」那个模式手填的假设上（形态③「接了线接错地方」，
   * 取证见 `SandboxImpactBand.tsx` 文件头）。这三个字段就是那条线的接口。
   */
  const [lastPerturbation, setLastPerturbation] = useState<{
    id: string;
    label: string;
    kpiBefore: number;
    kpiAfter: number;
    change: ImpactChange;
    /**
     * WO-V4-PLAYS · 方案环要的那个**锚**：这条扰动打在哪、在那条状态变量上造成了多大**实测效应**。
     *
     * `before` 取施加前屏上的世界态、`after` 取**后端回包**里的新值 —— 两头都是"世界里的数"，
     * 前端不按 `magnitude`/`mode` 自己再算一遍（`set`/`delta`/`scale` 各算一遍 = 第二套真相源，
     * 且引擎还会做上下限规整，算出来的差值会与世界里的差值悄悄不相等）。
     */
    anchor: PlayAnchor;
  } | null>(null);
  /**
   * 本世界的**基线快照**（`SimSession.baseSnapshot`）—— 下区差分的左端。
   *
   * ⚠ 不用 `deriveBaseSnapshot(cfg)` 现算：切到别人的世界（`sandbox-world-switch-*`）之后，
   *   那个世界的基线是**它自己建会话时**的那一份，与本屏当前 cfg 现算的不一定是同一个东西。
   *   现算 = 拿一个看起来相关的数字当基线，差分会安静地算错。取不到就是 `null`，屏上诚实说没有。
   */
  const [baseWorld, setBaseWorld] = useState<TickState | null>(null);
  /**
   * 切世界（`sandbox-world-switch-*` 只换 `sessionId`）之后，基线也得跟着换到**那个世界的**那一份。
   * 会话列表里找不到（列表还没回来 / 该会话不在本租户可见集）⇒ 置 `null`，
   * 下区差分整块显示诚实空 —— **绝不**留着上一个世界的基线继续算：那会算出一组看着合理的假差值。
   */
  useEffect(() => {
    if (sessionId === null) return;
    const s = sessionsQuery.data?.items.find((x) => x.id === sessionId);
    if (s !== undefined) setBaseWorld(s.baseSnapshot);
  }, [sessionId, sessionsQuery.data]);

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

  // ── 扰动落点候选（全部来自 view-config = 租户本体派生；本文件零行业实体名 R14）─────────────
  // 对象 id 取 `cfg.nodeObjectIds`（= 引擎 `idsByType` 同源的**真物化对象 id**）——不是类型名。
  // 这一点是本单能不能"KPI 真的变"的分水岭：扰动写到 `Type#0` 这种占位键上，
  // `propagateTick` 的 `state[sourceId]` 永远取不到，屏上看着变了、下游一动不动（静默错答的老形态）。
  const perturbTargets = useMemo(() => {
    const out: { id: string; typeKey: string }[] = [];
    for (const t of cfg?.nodeTypes ?? []) for (const id of cfg?.nodeObjectIds?.[t] ?? []) out.push({ id, typeKey: t });
    return out;
  }, [cfg]);
  const effPObject = pObject || perturbTargets[0]?.id || "";
  const effPStateVar = pStateVar || cfg?.stateVars[0] || "";
  /** 本体里一个已物化对象都没有 ⇒ 无处可施加。诚实禁用并写明原因，不给一个点了没反应的按钮。 */
  const canPerturb = perturbTargets.length > 0 && effPStateVar !== "";

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
      // 基线快照取**后端回的那一份**（`s.baseSnapshot`），不是本地 `base` ——
      // 两者今天相同，但真相源是会话对象；写 `base` 就是在本地留了第二套真相源。
      setBaseWorld(s.baseSnapshot);
      setCurTick(0);
      // WO-V4-HONEST-ORIGIN：这一份是**前端哈希占位**，盖 `DERIVED` 章 —— 顶栏据此标「合成·占位」。
      setWorldOrigin("DERIVED");
      // 权威副本就地写入（避免刚建完又去 GET 一次同样的东西）；此后只有事件失效才触发真重取。
      // ⚠ 正因为这一行，新建会话时那个 GET **不会发**（staleTime: Infinity）——
      //   所以出处必须跟着数据盖章，不能靠「data 到没到」推断（详见 WorldOrigin 的注释）。
      qc.setQueryData<WorldSnapshot>(["a", "sim-world", s.id], { tick: 0, state: base, origin: "DERIVED" });
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
      setWorldOrigin("MEASURED"); // 这一份是**后端算的**世界态（tick 回包）⇒ 顶栏换「实测」记号
      // 权威副本同步就地更新：本地推进无需再 GET；跨页由 sim.tick_completed 失效后重取。
      qc.setQueryData<WorldSnapshot>(["a", "sim-world", sessionId], { tick: res.curTick, state: res.state, origin: "MEASURED" });
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

  /**
   * 施加一条扰动（#150 的那一跳）—— 用户在沙盘上做一个动作，世界当场就变。
   *
   * 闭环的四段，缺一段就是「画得出、推不动」：
   *   ① 本函数 → `POST …/perturbations`（一等公民入口·入库·发 `sim.perturbation_created`）；
   *   ② 后端 `simApplyAtCurrentTick` 把它落到**当前 tick** 的世界态（`/act` 与它同一支实现）；
   *   ③ 回包的 `state` 就是新世界态 → 这里就地落屏 ⇒ **KPI 当场变**（不等下一次 tick）；
   *   ④ 之后每次「推进 tick」，引擎把这条扰动一并喂给 `propagateTick` ⇒ **沿本体链路往下游扩散**，
   *      到期还会回退（`durationTicks` 非空时）。
   *
   * 为什么 KPI 用后端回的 `state` 重算、而不是本地按 magnitude 自己算一份：
   * 本地算 = 第二套真相源，`mode:"scale"`/clamp/派生一改就与后端漂移，而且漂移**不会报错**，
   * 只会让屏上的数悄悄不等于世界里的数。这里只搬运，不计算。
   */
  const onApplyPerturbation = useCallback(async () => {
    if (!sessionId || !canPerturb) return;
    const magnitude = Number(pMagnitude);
    if (!Number.isFinite(magnitude)) {
      toast("幅度必须是数字", "error");
      return;
    }
    const durationRaw = pDuration.trim();
    const durationTicks = durationRaw === "" ? null : Math.floor(Number(durationRaw));
    if (durationTicks !== null && (!Number.isFinite(durationTicks) || durationTicks < 1)) {
      toast("持续 tick 数留空 = 永久；填则必须 ≥ 1", "error");
      return;
    }
    setPerturbing(true);
    const kpiBefore = globalKpi;
    // 施加**前**该落点的值（屏上世界态）——与回包里的新值配对，就是这条扰动的实测效应 Δ。
    const varBefore = world[effPObject]?.[effPStateVar] ?? 0;
    try {
      const res = await createSimPerturbation(sessionId, {
        kind: pKind,
        targetObjectId: effPObject,
        targetStateVar: effPStateVar,
        magnitude,
        mode: pMode,
        durationTicks,
        // label 是给人看的溯源串（R13），由用户选的四个维度拼出——不写死任何行业词。
        label: `${pKind} · ${effPObject}.${effPStateVar} ${pMode} ${magnitude}${durationTicks === null ? "（永久）" : `（${durationTicks} tick）`}`,
      });
      // ③ 后端回的世界态就地落屏：KPI 当场变（权威副本同步，避免再 GET 一次同样的东西）。
      setWorld(res.state);
      setCurTick(res.curTick);
      setWorldOrigin("MEASURED"); // 这一份是**后端算的**世界态（扰动回包）⇒ 顶栏换「实测」记号
      qc.setQueryData<WorldSnapshot>(["a", "sim-world", sessionId], { tick: res.curTick, state: res.state, origin: "MEASURED" });
      const objs = Object.keys(res.state);
      const kpiAfter = objs.length ? objs.reduce((a, o) => a + aggregate(res.state[o]), 0) / objs.length : 0;
      // 时间轴上把这一格**替换**成扰动后的值：扰动不推进 tick（它作用在当前 tick），
      // 追加一格会让 heat 条凭空多出一个不存在的 tick。
      setHistory((h) => (h.length === 0 ? [kpiAfter] : [...h.slice(0, -1), kpiAfter]));
      setLastPerturbation({
        id: res.perturbation.id,
        label: res.perturbation.label,
        kpiBefore,
        kpiAfter,
        /**
         * 折算成影响传播要的那"一处变更"。
         * `value` 取**后端回的世界态里的真实新值**，不是前端按 mode 自己算一遍
         * （`delta`/`scale`/`set` 三种模式各算一遍 = 第二套真相源；且引擎还会做上下限规整）。
         * 取不到就退回本次的 magnitude —— 那是"调用方声称的值"，契约允许（`oldValue` 同族语义）。
         */
        change: {
          objectType: perturbTargets.find((t) => t.id === effPObject)?.typeKey ?? "",
          objectId: effPObject,
          prop: effPStateVar,
          value: res.state[effPObject]?.[effPStateVar] ?? magnitude,
        },
        // WO-V4-PLAYS：方案环的锚。`after` 同样取后端回包（取不到才退 `varBefore` ⇒ 效应 0 ⇒ 方案环诚实说"没有可比的差异"）。
        anchor: {
          objectId: effPObject,
          stateVar: effPStateVar,
          before: varBefore,
          after: res.state[effPObject]?.[effPStateVar] ?? varBefore,
          label: res.perturbation.label,
        },
      });
      // WO-SIM-PERTURB-TIMELINE：清单重取（**不**本地 push 一条 —— 那是第二套真相源，
      // 且顺序会与后端 `listPerturbations` 的 `startTick → 建单先后` 定序漂移，而顺序是语义）。
      // 同标签页靠这一行；别的标签页靠 `sim.perturbation_created` 事件失效同一个 key。
      void qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId] });
      toast(`扰动已施加：${res.perturbation.label} → 全局态 ${kpiBefore.toFixed(1)} → ${kpiAfter.toFixed(1)}`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setPerturbing(false);
    }
  }, [sessionId, canPerturb, pMagnitude, pDuration, pKind, effPObject, effPStateVar, pMode, globalKpi, perturbTargets, qc, world]);

  const onCheckpoint = useCallback(async () => {
    if (!sessionId) return;
    try {
      const cp = await simCheckpoint(sessionId, `tick${curTick}`);
      // WO-BEFE-E：存完**重取清单**（不本地 push 一条 —— 那是第二套真相源，且顺序会与后端
      // `(tick, createdAt, id)` 全序漂移，而顺序在这里是语义：用户按它挑回滚点，顺序错 = 挑错档）。
      void qc.invalidateQueries({ queryKey: ["a", "sim-checkpoints", sessionId] });
      toast(`检查点已存：${cp.label}（tick ${cp.tick}）`, "success");
    } catch (e) {
      toastError(e);
    }
  }, [sessionId, curTick, qc]);

  /**
   * WO-BEFE-E · 回到某个存档（`POST /a/v1/sim/sessions/:id/rollback`）。
   *
   * ⚠ **破坏性**：后端 `deleteTicksAfter`（app.ts:1836）真的把该 tick 之后的推演删了。
   *   所以这里给的是「回滚」而不是「预览」；想留住分叉请点旁边的「分支」（主线零字节改动）。
   * 世界态直接落屏 —— 用的是**后端回包里的那一份**，不是前端按 checkpoint.tick 猜一份。
   */
  const onRollback = useCallback(
    async (checkpointId: string, label: string, tick: number) => {
      if (!sessionId) return;
      setRollingBack(checkpointId);
      try {
        const res = await simRollback(sessionId, checkpointId);
        setWorld(res.state);
        setCurTick(res.curTick);
        // 回滚后世界态的出处是**后端实测**（与 tick 回包同源），不是本地占位。
        setWorldOrigin("MEASURED");
        // 时间轴同步截断：轨迹留到回滚点为止，否则时间轴还画着已被删掉的那几格。
        setHistory((h) => h.slice(0, res.curTick + 1));
        // 分支对比失效：主线已被截断，旧的 A/B 序列不再对应同一条时间线。
        setCompare(null);
        // 后端把 `curTick` 写回了会话（app.ts:1838），世界列表那一列要跟着变；
        // 扰动/存档清单同理重取（回滚删的是 tick 态，清单口径由后端说了算，前端不猜）。
        void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
        void qc.invalidateQueries({ queryKey: ["a", "sim-checkpoints", sessionId] });
        void qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId] });
        toast(`已回到存档「${label}」（tick ${tick}）—— 其后的推演已删除`, "success");
      } catch (e) {
        toastError(e);
      } finally {
        setRollingBack(null);
      }
    },
    [sessionId, qc],
  );

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

  /**
   * WO-SANDBOX-DECLUTTER · **诊断抽屉**（建模者 / 调试者那两档）。
   *
   * 病灶（仓主亲眼所见）：「就绪认证」L0–L4 + 世界完整度 gauge + 「将进入沙盘的状态变量（13）」
   * 13 条全展开 + 「世界列表」7 个世界各带一个按钮 —— 全部常驻右栏，把决策者要看的
   * 卡点/堵点/断点挤到看不见，右栏本身也塞爆。
   *
   * 这些内容**一条都没删**（它们是真功能、也是诚实位），只是从"常驻右栏"改成
   * "默认折叠的诊断抽屉"。抽屉入口带**真计数**（`issues`）：就绪认证报 `cert.gaps.length`
   * ——也就是「还差哪几件才算就绪」的真条数，不是装饰徽标。
   *
   * ── 并线单 WO-SANDBOX-UI-INTEGRATE 的一处**主动裁决**（不是自动合并的结果）──────
   * declutter 分叉时 canonical 还没有 `perturbation`（扰动入口，WO-SIM-ACT-CLOSE #150），
   * 所以它的两个数组里都没这一节。若照 declutter 一侧原样取，**扰动入口会被静默删掉**。
   * 裁决：`perturbation` **不进本抽屉，进第一层 `rail`** —— 它是「沙盘上唯一让事情发生的
   * 动作」，属于决策者的操作项，不属于建模者/调试者的诊断信息。
   * 于是 rail = [扰动, 多场景对比, AI 指挥台]（保持 canonical 的相对次序），
   * diagnostics = [就绪认证, 世界列表, 本体派生]。canonical 那句「一个都不许掉」全部兑现。
   */
  const diagnostics: SandboxConsoleRailSection[] = [ // hardcoded-data-allow：本数组是**右栏区块的 JSX 结构**，块内数值字面量实测全是布局值（gap/marginTop/lineHeight/width），零业务数据
    {
      id: "readiness",
      title: "就绪认证",
      defaultOpen: true,
      // 缺件清单的真条数 = 这一格真正的待办数（cert 未取到时不报数，不拿 0 冒充"没问题"）。
      issues: cert?.gaps.length ?? 0,
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
            {/* 诚实位 —— **这行字曾经是反的，必须随实现一起改，别再让它漂回去**。
                旧文案：「范围选择只作用于就绪认证口径，尚未裁剪推演本身」。那句话在 `G-SIM-SCOPE-UNREAD`
                开着的时候是真的（`SimSession.scope` 有写端无读端，tick 路遍历全本体）。
                `WO-SIM-SCOPE-TRIAL` 闭掉该断点之后它就成了**反着的谎**：引擎已经真的按范围裁剪，
                屏上却还在说没有 —— 用户会以为自己选的「局部推演」没生效而去绕路。
                这一处是合并时（WO-SIM-TRIAL-SCOPE-RECONCILE）发现的：实现改了、UI 文案没跟，
                而且**有一条绿测试把这句谎话锁着**（`test/sim-scope-local.seam.test.tsx` 原断言
                `toContain("尚未裁剪推演本身")`）—— 绿测试证明的是"文案没变"，不是"说的是真的"。
                今天的真相（引擎侧单源：`datacore app.ts buildPropagationInputs` → `scopePropagationGraph`）：
                 · GLOBAL ⇒ 全本体，逐字节同旧；
                 · LOCAL ⇒ 只算根类型 + hops 跳邻域，且只留两端都在范围内的边；
                 · 自称 LOCAL 却拿不到根 ⇒ 裁成空图并显式报缺，**绝不**退回 GLOBAL。
                tick 回包里的 `scope` 回执（算了几个对象/几条边/丢了多少）就是它的收据。 */}
            <div data-testid="sandbox-scope-reach-note">
              ✅ 范围选择<b>已作用于推演本身</b>：切「局部」后引擎只按该对象类型的邻域子图传导，
              就绪认证的试算也跑在同一范围里。范围拿不到根时<b>裁成空图并报缺</b>，不会拿全局结果冒充局部。
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
      /**
       * WO-BEFE-E · 存档与回滚（`GET …/:id/checkpoints` + `POST …/:id/rollback`，两条此前前端零调用）。
       *
       * 修的不是"少了个列表"，是**「存档检查点」这颗按钮此前是单向的**：能存进去，看不见，回不去。
       * 后端 `app.ts:1808` 那段注释里写着「前端 useQuery 属 WO-1/WO-4 边界，不在本单」——
       * 那张单没落地，读端就在后端躺着。这一栏是它的出口。
       *
       * ⚠ 诚实位：回滚是**破坏性**的（后端真删该 tick 之后的态），所以按钮旁必须写明这一句，
       *   而不是让用户点完才发现推演没了。想留住分叉走「分支」——那条主线零字节改动。
       */
      id: "checkpoints",
      title: "存档与回滚",
      node: (
        <div data-testid="sandbox-checkpoints">
          {checkpointsQuery.isError ? (
            <div className={styles.sub} data-testid="sandbox-checkpoints-error">
              存档清单不可用（沙盘存档功能未开通或后端不可达）
            </div>
          ) : (checkpointsQuery.data?.items?.length ?? 0) === 0 ? (
            <div className={styles.sub} data-testid="sandbox-checkpoints-empty">
              {checkpointsQuery.isLoading ? "加载存档…" : "还没有存档。点上方「存档检查点」存一个，之后可以回到这一刻。"}
            </div>
          ) : (
            <>
              <div className={styles.sub} style={{ marginBottom: 4 }} data-testid="sandbox-checkpoints-count">
                {checkpointsQuery.data!.items.length} 个存档（按 tick 排序 · 回滚会删掉该存档之后的推演）
              </div>
              <ul data-testid="sandbox-checkpoints-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {checkpointsQuery.data!.items.map((cp) => (
                  <li
                    key={cp.id}
                    data-testid={`sandbox-checkpoint-${cp.id}`}
                    data-tick={String(cp.tick)}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", font: "600 10px var(--font-mono)" }}
                  >
                    <span className="mono" style={{ color: "var(--muted2)" }} data-testid={`sandbox-checkpoint-label-${cp.id}`}>
                      {cp.label}
                    </span>
                    <span className={styles.sub} data-testid={`sandbox-checkpoint-tick-${cp.id}`}>tick {cp.tick}</span>
                    <button
                      className="btn sm ghost"
                      data-testid={`sandbox-rollback-${cp.id}`}
                      disabled={rollingBack !== null}
                      onClick={() => void onRollback(cp.id, cp.label, cp.tick)}
                    >
                      {rollingBack === cp.id ? "回滚中…" : "回到这一刻"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ),
    },
    {
      /**
       * WO-SANDBOX-DECLUTTER · 本体派生计数（旧顶栏 `sandbox-config-summary`）。
       * 「3 类对象 · 1 类链路 · 2 状态变量 · 1 传导规则」是**调试者**的读数：
       * 它回答「这一屏的骨架从哪来」，不回答「今天该动哪个决策」。搬进抽屉，字一个没改。
       */
      id: "derived",
      title: "本体派生",
      node: (
        <span data-testid="sandbox-config-summary" style={{ font: "600 10px var(--font-mono)", color: "var(--muted2)" }}>
          本体派生 {cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 ·{" "}
          {cfg.propagationCount} 传导规则
        </span>
      ),
    },
  ];

  /**
   * ── ① 左区内容：**扰动因素输入**（WO-SANDBOX-V3 · PRD §1①）───────────────────
   *
   * WO-SIM-ACT-CLOSE（#150）· 沙盘上唯一"让事情发生"的动作。
   * 落点候选全部来自 view-config（本体派生），本段零行业实体名（R14）。
   *
   * ⚠ 本单把它从 `rail[0]`（右栏折叠区的第一格，`defaultOpen: true`）**提到左区一等位置**。
   *   `rail` 的每一格外面都套着一层 `<details><summary>`；扰动是这一屏的**入口**，
   *   而入口不该是一个"默认展开的折叠块"—— 那是把主角摆在配角的容器里。
   *   testid `sandbox-perturbation` 与块内一切**一个字未改**（D4）：只换了位置与层。
   *   `sc-rail-perturbation`（那层 `<details>` 的 testid）随之消失 —— 它是**容器**的 id，
   *   不是内容的 id；内容的 id 全在。
   */
  const inputZone = (
    <div className={styles.panel} data-testid="sandbox-input-zone-body">
        <div data-testid="sandbox-perturbation">
          {!canPerturb ? (
            <div className={styles.sub} data-testid="sandbox-perturbation-unavailable">
              本体暂无已物化对象（或无状态变量）⇒ 扰动无处落点。先在建模页发布对象并物化，再回来推演。
              （不提供一个点了没反应的按钮：扰动写到不存在的对象上，屏上会变、下游不动 = 静默错答。）
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <span className={styles.sub}>类型</span>
                <select
                  data-testid="sandbox-perturbation-kind"
                  aria-label="扰动类型"
                  value={pKind}
                  onChange={(e) => setPKind(e.target.value as PerturbationKind)}
                >
                  {PERTURBATION_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>

                <span className={styles.sub}>落点对象</span>
                <select
                  data-testid="sandbox-perturbation-object"
                  aria-label="扰动落点对象"
                  value={effPObject}
                  onChange={(e) => setPObject(e.target.value)}
                >
                  {perturbTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.typeKey} · {t.id}
                    </option>
                  ))}
                </select>

                <span className={styles.sub}>状态变量</span>
                <select
                  data-testid="sandbox-perturbation-statevar"
                  aria-label="扰动状态变量"
                  value={effPStateVar}
                  onChange={(e) => setPStateVar(e.target.value)}
                >
                  {(cfg.stateVars.length > 0 ? cfg.stateVars : [effPStateVar]).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <span className={styles.sub}>方式 / 幅度</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <select
                    data-testid="sandbox-perturbation-mode"
                    aria-label="扰动方式"
                    value={pMode}
                    onChange={(e) => setPMode(e.target.value as "set" | "delta" | "scale")}
                  >
                    {/* 三种方式来自契约 PerturbationSchema.mode —— 「涨价 15%」是 scale、「加 200 台」是 delta、
                        「停机」是 set 0。只给 set 会逼前端自己算差值 = 第二套真相源。 */}
                    <option value="delta">增减（delta）</option>
                    <option value="scale">乘以（scale）</option>
                    <option value="set">设为（set）</option>
                  </select>
                  <input
                    data-testid="sandbox-perturbation-magnitude"
                    aria-label="扰动幅度"
                    style={{ width: 72 }}
                    value={pMagnitude}
                    onChange={(e) => setPMagnitude(e.target.value)}
                  />
                </div>

                <span className={styles.sub}>持续 tick</span>
                <input
                  data-testid="sandbox-perturbation-duration"
                  aria-label="扰动持续 tick 数（留空为永久）"
                  placeholder="留空 = 永久"
                  style={{ width: 110 }}
                  value={pDuration}
                  onChange={(e) => setPDuration(e.target.value)}
                />
              </div>

              <button
                className="btn sm primary"
                data-testid="sandbox-perturbation-apply-btn"
                disabled={!sessionId || perturbing}
                onClick={() => void onApplyPerturbation()}
              >
                {perturbing ? "施加中…" : "施加扰动"}
              </button>

              <div className={styles.sub} style={{ marginTop: 6, lineHeight: 1.6 }} data-testid="sandbox-perturbation-note">
                扰动作用在<b>当前 tick</b>（不推进时间）；之后每次「推进 tick」，引擎沿本体链路把它扩散到下游，
                填了持续 tick 数的到期还会自动回退。沙盘是<b>模拟态</b>，采纳才经 Action 正门写真值（R4）。
              </div>

              {lastPerturbation && (
                <div
                  className={styles.sub}
                  data-testid="sandbox-perturbation-last"
                  style={{ marginTop: 6, lineHeight: 1.6 }}
                >
                  最近一次：<b className="mono" data-testid="sandbox-perturbation-last-id">{lastPerturbation.id}</b>
                  <br />
                  {lastPerturbation.label}
                  <br />
                  全局态{" "}
                  <b data-testid="sandbox-perturbation-last-delta">
                    {lastPerturbation.kpiBefore.toFixed(1)} → {lastPerturbation.kpiAfter.toFixed(1)}
                  </b>
                </div>
              )}
            </>
          )}
        </div>

        {/*
          ── WO-V4-PLAYS · 方案环（PRD-sandbox-v4 §3.3）──────────────────────────────
          左区一等位置（**不套 `<details>`**）。它是「拨完扰动之后要干的那件事」，
          所以紧贴扰动块之下、与它同区：输入与它的直接下一步分居两区，读者就得来回跳。
          它带 `<select>`/`<button>` ⇒ 只能在左区（`sandbox-three-zone.seam` §3 的等号断言）。
        */}
        <SandboxPlaysPanel sessionId={sessionId} curTick={curTick} anchor={lastPerturbation?.anchor ?? null} />

        {/*
          ── WO-V4-PLAYS · AI 指挥台**提到一等位置**（PRD-sandbox-v4 §3.3 末行）───────────
          它此前住在 `rail` 的折叠格里（`sc-rail-commander`）。「全程可问 AI 指挥台」这件事
          不该要求用户先想起来去展开一个折叠块 —— 那等于它不在。

          ⛔ D4 守恒（**允许降层，不允许删除**）：`sc-rail-commander` 那一格**没有删**，
             仍在 `rail` 里、仍是默认收起的 `<details>`（三处既有断言咬着它：
             `sandbox-console.seam:485` / `sandbox-three-zone.seam:416` / `sandbox-declutter:467`），
             只是格子里的内容换成一行**指路**（指向这里），而不是第二份指挥台 ——
             同一个 `sim-commander-dock` 渲染两遍会让 `getByTestId` 直接抛"找到多个"，
             而且用户会看到两个互不同步的输入框。升层 + 留指路牌，不留双份实例。

          `sim.commander` 关时组件返回 `null` ⇒ 这里一个像素都不占（R3 暗发的正确形态）。
        */}
        <SimCommanderDock sessionId={sessionId} curTick={curTick} />
    </div>
  );

  // ── 左区折叠区：决策者用得上的几样（多场景对比 / AI 指挥台 / 企业状态 / 快照分叉）─────
  //    PRD §2 末两行判的是「已在折叠区，**不动**」——本单不改它们的层，只随左区一起搬。
  const rail: SandboxConsoleRailSection[] = [ // hardcoded-data-allow：本数组是**折叠区区块的 JSX 结构**，块内数值字面量实测全是布局值（gap/marginTop/lineHeight/width），零业务数据
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
      /**
       * WO-V4-PLAYS · 本格**保留不删**（D4 守恒），内容换成一行指路。
       *
       * 指挥台本体已提到左区一等位置（见 `inputZone` 末尾）。这一格若原样再渲染一份
       * `SimCommanderDock`，屏上就会出现**两个互不同步的输入框**，`getByTestId("sim-commander-dock")`
       * 也会直接抛「找到多个」。所以：实例只留一份（在上面），这里留**入口与去向**。
       *
       * 为什么不干脆删掉这一格：三处既有断言把它当"折叠区还在、层没变"的判据咬着
       *（`sandbox-console.seam:485` / `sandbox-three-zone.seam:416` / `sandbox-declutter:467`），
       * 而且规范写的是「允许降层，绝不允许删除」—— 升层同理：别把原来的入口抹掉。
       */
      id: "commander",
      title: "AI 指挥台",
      node: (
        <div className={styles.sub} data-testid="sandbox-commander-moved" style={{ lineHeight: 1.7 }}>
          AI 指挥台已提到左区<b>一等位置</b>（本区块上方，不再需要展开折叠块才能问）。
          这一格保留为入口记号：功能没有删，只是升了层。
        </div>
      ),
    },
    {
      // WO-ENTERPRISE-STATE · 企业状态快照（只读）。
      //
      // ⚠ **本行是 `EnterpriseStatePanel` 唯一的生产调用方**。沙盘右栏是手工组装的 rail 数组、
      //    无自动扫描 —— 不加这一行，那个组件就是本仓 F2/F3/F4 连踩三次的
      //    `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 形态：实现有、测试绿、却没有任何路由渲染得到。
      //
      // 挂在沙盘（而不是新造一个导航组）是 PRD §0.06 裁定三的要求：沙盘复用既有模块，不做新页面。
      // 世界固定为**真实世界**：右栏的推演会话是 tick 态（TickState），与企业状态快照不是同一个东西 ——
      // 拿会话 id 当 worldId 传会得到"这个仿真世界还没有快照"的诚实空，反而让人以为面板坏了。
      // 仿真世界的快照走 `POST …/fork` —— 那条线已由下面「快照分叉与比对」接上（WO-BEFE-WIRE-3），
      // 本面板仍只答"真实世界现在什么状态"（只读，一个动作按钮都不放）。
      id: "enterprise-state",
      title: "企业状态快照",
      node: <EnterpriseStatePanel />,
    },
    {
      /**
       * WO-BEFE-WIRE-3 · 快照**分叉与比对** —— `POST …/:id/fork` 与 `GET …/:id/diff`
       * 这两条后端注册了却零前端调用方的端点，真消费方就是本行渲染的那个组件。
       *
       * ⚠ **本行是 `EnterpriseStateTwinPanel` 唯一的生产调用方**（右栏是手工组装的数组、无自动扫描）——
       *   删了这一行，那个组件立刻退化成本仓连踩三次的 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：
       *   实现有、测试绿、却没有任何路由渲染得到。
       *
       * `defaultOpen` 不给（= 默认收起）：按 `docs/CONVENTION-ui-information-layering.md` §1，
       * 动作与逐项下钻属于**第二层**，不该和上面那面板的重点指标挤在同一层。
       */
      id: "enterprise-state-twin",
      title: "快照分叉与比对",
      node: <EnterpriseStateTwinPanel />,
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
        /**
         * WO-SANDBOX-DECLUTTER · **主屏唯一保留的治理信号**。
         *
         * 判据只有一个：`cert.canEnterSimulation === false`。为 `true` 时这个函数返回 `null` ⇒
         * 横幅**不渲染**（不是 `display:none`），一个像素都不占 —— 「没有问题」时屏上不该有
         * 任何提示占位，那是把噪音当成安全感。
         *
         * 内容取 `cert.gaps[]` 的**真条目**（gapCode + ref + detail 原文透传，前端不改写、不总结），
         * 只在屏上显前几条，其余条数明写并给「查看详情 →」进抽屉看全 —— 截断必须看得见，
         * 不许让人以为"就这几条"。
         */
        banner={(openDiag) => <SimGovernanceBanner cert={cert} onOpenDiagnostics={openDiag} />}
        /**
         * 旧主屏 KPI 行 → 顶栏标签（全局态 + 逐 stateVar 均值）。
         *
         * WO-SANDBOX-UI-INTEGRATE · **量纲口径降层**（规范 §2 R-UI-3）：
         * 此前每个读数都自带 `（0–100 指数·全对象均值）` 这截括号说明，顶栏因此被口径撑满，
         * 而顶栏该留给「这一页要回答的那个数」（R-UI-2 最大一级只给它）。
         * 现在第一层只剩 **名字 + 数值 + tick**（三者都是规范 §1 允许的：名字/数值/状态），
         * 口径整段进 `?` 浮层。
         *
         * ⚠ 这是**降层不是删除**：量纲是 WO-UNIT-MEANING 立的诚实位（裸「62.5」看不出满分多少），
         * 原文一字不改搬进浮层，第一层留 `?` 当可见记号。三条老断言随之从
         * 「第一层含 0–100 指数」改判为「浮层里含、且第一层不再含」——**两向都咬**，
         * 既证明没删、也证明真降下去了。
         */
        topTags={
          <>
            <span
              data-testid="sandbox-kpis"
              style={{ display: "flex", gap: 8, alignItems: "center", font: "600 10px var(--font-mono)" }}
            >
              <span data-testid="sandbox-kpi-global">
                全局态 · tick {curTick}{" "}
                <b style={{ color: heatColor(globalKpi) }} data-testid="sandbox-kpi-global-val">
                  {globalKpi.toFixed(1)}
                </b>
              </span>
              {/**
               * WO-V4-HONEST-ORIGIN（PRD-sandbox-v4 §2.1 / §4.3）· **顶栏读数的出处徽标**。
               *
               * 病历（仓主截图 · 2026-08-13）：顶栏 16 个读数全落在 49.5–50.4 —— 那是
               * `hash01(对象id|变量名)×100` 全对象取均值的**必然**结果（大数定律），
               * 不是"企业各项压力恰好都在中位"。同屏阻滞点行**有**「合成数据」徽标，顶栏一个都没有；
               * 两者并排，读者只会把没记号的那批读成实测。
               * 复验：`apps/frontend-shell/test/sandbox-world-origin.seam.test.tsx` 第 ① 条
               * 把屏上每个读数与 `deriveBaseSnapshot(cfg)` 的均值逐个对等。
               *
               * ⛔ 修的是**记号**不是数值：`hash01` 的派生本身一行不动（它是 R6 合规的确定性占位）。
               *    把占位值改得"不像 50"只会得到一屏更像真的假数据，比现在更坏。
               *
               * 两向（缺一向都证明不了）：占位期必须有记号 ⇒ `DERIVED`／「合成·占位」；
               * 后端世界态到达后记号必须**换掉** ⇒ `MEASURED`／「实测」。
               */}
              <span
                data-testid="sandbox-kpi-origin"
                data-origin={worldOrigin}
                style={{ color: worldOrigin === "DERIVED" ? "var(--warn)" : "var(--ok)" }}
              >
                {worldOrigin === "DERIVED" ? "◐ 合成·占位" : "● 实测"}
                <InfoPopover topic={zh.sim.sandbox.info.kpiOrigin} testId="kpi-origin">
                  <span data-testid="sandbox-kpi-origin-note">
                    {worldOrigin === "DERIVED"
                      ? zh.sim.sandbox.info.kpiOriginDerived
                      : zh.sim.sandbox.info.kpiOriginMeasured}
                  </span>
                </InfoPopover>
              </span>
              {/**
               * WO-SANDBOX-KPI-LAYER · **按偏离度分层**（规范 §1 第一层只放要回答的那个数）。
               *
               * 病历（仓主 2026-08-13 二次反馈 + 截图）：上一轮 declutter 只把**量纲口径**降进了浮层，
               * 读数本身仍是 `cfg.stateVars.map()` **无条件全铺**——16 个状态变量、同字号、同权重，
               * 实测值全落在 49.5–50.4 之间。**16 个几乎相同的数 = 零信息量，却占着最贵的一条**。
               * 形态：口径降层做了，**分层没做**；「少了括号」被当成了「分了层」。
               *
               * ⛔ D4 守恒：允许降到第二层，**绝不允许删除**——
               * `sandbox-console.seam.test.tsx:469` 逐个 stateVar 断言 testid 在 DOM 里。
               * 故用原生 `<details>`：**折叠态内容照样在 DOM**，getByTestId 找得到，
               * 而屏幕上只剩「其余 N 项」一个可见记号（降层的记号，不是消失）。
               *
               * 判据不引入业务常数（去电池锁死 R14）：不写死「基线 50」这类阈值，
               * 而是按**这批数自己的中位数**算偏离度，取偏离最大的前 `FIRST_LAYER_KPIS` 个。
               * 纯相对、纯数据派生 —— 数据变了排序自动跟着变，不需要有人来改常数。
               */}
              {(() => {
                const objs = Object.keys(world);
                const rows = cfg.stateVars.map((v) => ({
                  v,
                  avg: objs.length ? objs.reduce((a, o) => a + (world[o]?.[v] ?? 0), 0) / objs.length : 0,
                }));
                const sorted = [...rows].map((r) => r.avg).sort((a, b) => a - b);
                const mid = sorted.length
                  ? sorted.length % 2
                    ? sorted[(sorted.length - 1) / 2]!
                    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
                  : 0;
                // ⚠ 比较器必须是**全序**：平手时返回 0，不许写 `a.v < b.v ? -1 : 1`（那种写法
                //   对相等元素恒不返回 0，违反比较器契约，V8 会给出**任意**顺序）。
                //   实测日期 2026-08-13：8 个等值 stateVar 排出来是 flat_a/flat_c/flat_d 而非字典序。
                //   复验方式：把本行比较器改回 `a.v < b.v ? -1 : 1`，再跑
                //   `pnpm --filter frontend-shell exec vitest run test/sandbox-kpi-layer.seam.test.tsx`
                //   —— 该用例（`apps/frontend-shell/test/sandbox-kpi-layer.seam.test.tsx:127`）当场红。
                const ranked = [...rows].sort(
                  (a, b) => Math.abs(b.avg - mid) - Math.abs(a.avg - mid) || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0),
                );
                const first = ranked.slice(0, FIRST_LAYER_KPIS);
                const rest = ranked.slice(FIRST_LAYER_KPIS);
                const cell = (r: { v: string; avg: number }) => (
                  <span key={r.v} data-testid={`sandbox-kpi-${r.v}`}>
                    {r.v} <b data-testid={`sandbox-kpi-${r.v}-val`}>{r.avg.toFixed(1)}</b>
                  </span>
                );
                return (
                  <>
                    {first.map(cell)}
                    {rest.length > 0 && (
                      <details data-testid="sandbox-kpi-rest">
                        <summary style={{ cursor: "pointer", opacity: 0.75 }} data-testid="sandbox-kpi-rest-toggle">
                          其余 {rest.length} 项
                        </summary>
                        <span style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>{rest.map(cell)}</span>
                      </details>
                    )}
                  </>
                );
              })()}
              {/* 口径记号：第一层唯一保留的「这里有话要说」，点/悬停出全文（诚实位降层的可见记号）。 */}
              <InfoPopover topic={zh.sim.sandbox.info.kpiUnit} testId="kpi-unit">
                <span data-testid="sandbox-kpi-unit-note">
                  {zh.sim.sandbox.info.kpiUnitGlobal}
                  <br />
                  {zh.sim.sandbox.info.kpiUnitVar}
                </span>
              </InfoPopover>
            </span>
          </>
        }
        // 旧主屏 tick 控制条：推进 / 存档 / 分支 / 采纳 / tick 时间轴 heat（整块搬来，行为不变）
        // ＋ WO-SIM-PERTURB-TIMELINE：扰动时间轴紧贴其下。
        //   放这里而不是放右栏，是因为它**要和上面那条 tick 轴共用同一根时间线**：
        //   右栏 300px 画不出"先后"，而"哪一格 KPI 动了 / 那一格里哪几条扰动在生效"
        //   必须上下对得上才叫看得出因果（CONVENTION §3）。
        controlBar={
          <>
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
          <PerturbationTimeline sessionId={sessionId} curTick={curTick} />
          </>
        }
        // WO-SANDBOX-V3 · ① 左区：扰动因素输入（唯一输入区）
        inputZone={inputZone}
        /**
         * WO-SANDBOX-V3 · ③ 下区：影响带（PRD §1③）。
         *
         * `change` 取**已施加的那条扰动**折算出的一处变更 —— 这就是本单补的那个挂载点：
         * 在此之前 `ImpactAnalysisPanel` 只挂在「试一手」模式手填的假设上（形态③「接了线接错地方」，
         * 取证见 `SandboxImpactBand.tsx` 文件头）。沙盘「现状」屏此前零渲染它。
         */
        impactZone={
          <SandboxImpactBand
            sessionId={sessionId}
            change={lastPerturbation?.change ?? null}
            baseWorld={baseWorld}
            world={world}
            curTick={curTick}
            stateVars={cfg.stateVars}
          />
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
        diagnostics={diagnostics}
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
              /* WO-SANDBOX-UI-INTEGRATE：此前是 `title={…}` —— 那是**原生 tooltip**，
                 规范 §2 R-UI-3 明令禁止（由操作系统绘制、永远画在最上层、移开后滞留；
                 本仓 2026-08-10 真出过环形图被 SVG <title> 遮挡的事故）。
                 这句「回答哪一问」不需要浮层：当前模式的那一句本来就常驻第一层（见下方
                 `sandbox-mode-question`）。故改为 `aria-label` —— 读屏仍读得到，
                 屏上不再冒出一个不受控的黄框。 */
              aria-label={`${SANDBOX_MODE_LABEL[m]}：${SANDBOX_MODE_QUESTION[m]}`}
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
        诚实位（订单锚点 / 时窗为什么不在这里）降到 `?` 浮层，不占第一层。
        ⚠ WO-SANDBOX-UI-INTEGRATE 改：原来降到的是**原生 `title`**，那正是规范 §2 R-UI-3
        点名禁止的东西（不受控、画在最上层、移开滞留）。现改用受控的 `InfoPopover`，
        降层这件事不变，承载方式换成合规的那一个。
      */}
      <div
        className={styles.sub}
        data-testid="sandbox-scope-strip"
        style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <span>
          当前范围（切模式保持）：<b data-testid="sandbox-scope-bases">{describeSandboxScope(scope)}</b>
        </span>
        {/* 第一层只留这一行「有话要说」的记号 + `?`；两段口径正文进浮层（静默降层 = 删除，故记号必须可见）。 */}
        <span data-testid="sandbox-scope-honesty" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          ⓘ 订单锚点 / 时窗尚未提为壳级上下文
          <InfoPopover topic={zh.sim.sandbox.info.shellContextGap} testId="scope-shell-gap">
            <span data-testid="sandbox-scope-honesty-note">
              {zh.sim.sandbox.info.shellContextAnchor}
              <br />
              {zh.sim.sandbox.info.shellContextWindow}
            </span>
          </InfoPopover>
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
            /* `title` → `aria-label`：同上，原生 tooltip 一律不用；这句是"点哪里能到"的短提示，
               读屏读得到即可，不需要一个不受控的悬浮框。 */
            <a key={p.key} href={`/v/${p.key}`} data-testid={`sandbox-consolidated-${p.key}`} aria-label={`${p.label}：${p.where}`}>
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
