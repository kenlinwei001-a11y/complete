/**
 * ══ WO-SIM-UNIFIED-SHELL · 统一推演控制台（五区外壳 + 指标卡墙 + 右栏检视 + 底部抽屉）══
 *
 * 三张单里的第 ①：**外壳 + 卡墙 + 右栏 + 抽屉**。
 * 左栏本单只做**收合行为 + 摘要条**（扰动表单属第 ③ 张单）。
 *
 * ══ WO-SIM-SHELL-TABS（第 ②）· 四个独立页降成本壳的模式页签 ═════════════════════
 *
 * 本单**没有写一行页面代码**：四页原样挂载，经 `views/registry.ts` 的 `getRenderer`
 * ——与 `ViewPage` 逐字同构的同一条分发路径（理由见 `unifiedModes.ts` 文件头）。
 *
 * ── 开工前实测的四条前提（铁律 0.5：派单给的是线索不是结论）───────────────────
 *
 * ① **页签占位用的是「另一屏」的模式表**
 *    · 今天的行为是 X：第 ① 单把 `../sandboxModes.ts` 的 `SANDBOX_MODES`
 *      （现状/归因/试一手/求最优/影响半径）搬来当占位，而那五档指向的是
 *      `cleanroom-attr` / `what-if` / `optimize-whatif` / `disruption-radius`——
 *      **旧沙盘控制台 `SandboxConsole` 的四个通用页**，与本单要挂的四页零重叠。
 *    · 应该是 Y：本屏有自己的模式表（`unifiedModes.ts`），成员逐字取自已批准的 UX 规格。
 *      旧表不动（`SandboxConsole` 还在用它），本壳不再引用它。
 *
 * ② **左栏今天「施加不了扰动」——能丢的上下文是选择态，不是扰动本身**
 *    · 今天的行为是 X：左栏 `PerturbTree` 的「＋添加扰动」在
 *      `targetObjectId === undefined` 时**直接 return**（它自己的注释写着「缺了就什么都不做，
 *      不去编一个 objectId 顶上」），而本壳只透 `sessionId` ⇒ 那条 POST 分支**从未进入**。
 *      所以「施加扰动」这个动作今天在本壳里做不到；已施加清单是**后端态**（`GET …/perturbations`），
 *      它天然不随组件卸载消失。
 *    · 应该是 Y：本单要保住的上下文是**左栏的选择态**（落点范围下拉 / 选中因子）
 *      与**卡墙的选中卡**——这两样才是「切页签就没了」的那部分。
 *      故左栏与选中态**提到壳级、跨模式不卸载**（结构保证，不是复制一份状态副本）。
 *      接缝门第 ② 臂咬的就是这个；变异反证 ① 给左栏加 `key={mode}` 强制重挂即当场红。
 *
 * ③ **「四页的像素门会红」这条前提不成立**
 *    · 今天的行为是 X：`sandbox-detail-pixel` / `sandbox-attr-pixel` / `sandbox-opt-pixel`
 *      三门读的是**各页自己的 CSS Module + 规格 HTML**，`renderWithClient` 渲染的也是
 *      各页自己的组件，**从不渲染本壳**。本单不碰那三份 CSS、不碰四页实现
 *      ⇒ 它们的输入一个字节没变。
 *    · 应该是 Y：那批断言**不该改**（改了才是把防线拆了）。逐条判定与实跑 RC 见交付报告。
 *
 * ④ **左栏第 ③ 单的 `rail/PerturbRail.tsx`**
 *    · 本单开工时：`views/sim/unified/rail/` 目录不存在（实测 `ls` 报 No such file），
 *      故保留 `PerturbTree` 不等它，挂载那一行留给收编方。
 *    · ✅ **2026-08-26 收编 `WO-SIM-RAIL-FORMS` 时已挂上**（本壳唯一改动）：
 *      `<PerturbTree sessionId>` → `<PerturbRail sessionId>`，其余一行未动。
 *      ⛔ **刻意不接 `onAppliedChange`**：本壳 `perturbQ`（:190 附近）与 `PerturbRail.tsx:108`
 *      读的是**逐字相同**的查询键，rail 提交后失效的也是它（`PerturbRail.tsx:216`）⇒
 *      `applied`/`summary` 自动跟着走；接了它就是给同一事实造第二个出处。
 *
 * ══ 本单开工前实测的三条前提（铁律 0.5：派单给的是线索不是结论）════════════════
 *
 * ① **层级不该在前端算**（派单原文要求前端按入度/出度现算 —— 照做就是第二套真相源）
 *    · 今天的行为是 X：后端 `apps/datacore/src/sim/drill-scan.ts:290 layerOfStateVars`
 *      已按入度/出度现算层级，经 `GET /a/v1/sim/drill/state-var-layers`（`app.ts:2901`）下发；
 *      前端 `api/endpoints.ts:838 fetchDrillStateVarLayers` 也早就在，
 *      且 `views/sim/DrillPanel.tsx:125` 明文写着「前端再算一份，度数口径一漂两边就各说各话」。
 *    · 应该是 Y：本页**消费**后端算好的层级，前端零度数计算。
 *      「层级不是手工登记的」由门咬**改边集 ⇒ 屏上层级跟着变**来证明。
 *
 * ② **出处记号后端早就有、前端一个消费方都没有**
 *    · 今天的行为是 X：`SeedWorldSnapshotOrigin`（`sim/seed-world.ts:190`）把 tick0 是
 *      `round(hash01(objectId|stateVar)×100)` **结构派生**这件事写进了 `scope.baseSnapshotOrigin`，
 *      随 `GET /a/v1/sim/sessions` 原样下发；而 `grep -rn baseSnapshotOrigin apps/frontend-shell/`
 *      **零命中**（金丝雀：同目录 `fetchDrillStateVarLayers` 同法命中 3 处 ⇒ 检索工具是好的）。
 *      于是屏上把这批占位一律当实测读（`SandboxView.tsx:595` 给任何后端回包盖 `MEASURED` 章）。
 *    · 应该是 Y：把这个记号读出来，**逐卡**标「推演投影·非实测」，标注跟着数字走。
 *
 * ③ **`unit` 恒 `null` 是诚实缺席，不是没做**
 *    · 今天的行为是 X：契约 `SimMetricSeriesItem.unit` 注释实测记账「全仓没有任何
 *      『状态变量 → 单位』的登记册」，17 条真回包全 `null`。
 *    · 应该是 Y：屏上**不带单位**并说明为什么，而不是补一个「%」或「指数」（那是造口径）。
 *
 * ══ 取数口（五条，全部既有，本单一个新端点都没造）════════════════════════════
 *   `fetchSimViewConfig`        → 卡片的**名字与个数**（`stateVars` / `stateVarNames`）
 *   `fetchDrillStateVarLayers`  → 层级（后端现算）
 *   `fetchPropagationRules`     → 传导边（右栏「谁推的 / 推坏谁」）
 *   `metricSeriesPath` + `api.a`→ 指标时序（路径取 `console/useParetoFrontier.ts` 的**单源**，
 *                                 不在本文件再写一遍路径字面量）
 *   `fetchSimSessions`          → 会话 `scope.baseSnapshotOrigin`（缓存键与 `useConsoleSession`
 *                                 共用 `["a","sim-sessions"]` ⇒ 同一份缓存、同一条事件失效链）
 */
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChangeFocus,
  ChangeImpactPreview,
  PropagationRulesResponse,
  SandboxViewConfig,
  SimMetricSeriesResponse,
  SimSessionStatus,
} from "@platform/contracts";
import { api, ApiClientError } from "@/api/apiClient";
import type { ViewConfigVM } from "@/api/types";
import {
  fetchDrillStateVarLayers,
  fetchPropagationRules,
  fetchSimPerturbations,
  fetchSimSessions,
  fetchSimViewConfig,
  patchSimSessionStatus,
  previewChangeImpact,
  type SimSessionStatusTarget,
} from "@/api/endpoints";
import { getRenderer } from "@/views/registry";
import { UNIFIED_MODES, UNIFIED_MODE_SPEC, type UnifiedMode } from "./unifiedModes";
import { stateVarLabel } from "../stateVarLabel";
import { useConsoleSession, type ConsoleSessionReason } from "../console/useConsoleSession";
import { metricSeriesPath } from "../console/useParetoFrontier";
import PerturbRail from "./rail/PerturbRail";
import {
  buildInspectorView,
  buildMetricWall,
  buildRailSummary,
  readSnapshotOrigin,
  type PerturbationBrief,
} from "./metricWallModel";
import { MetricWall } from "./MetricWall";
import { InspectorPane } from "./InspectorPane";
import { BottomDrawer } from "./BottomDrawer";
import styles from "./UnifiedSimShell.module.css";

/** 会话五态各自的屏上措辞。**不合并** —— 三种"没有会话"处置完全不同（见 `useConsoleSession`）。 */
const SESSION_REASON_TEXT: Record<ConsoleSessionReason, string> = {
  explicit: "宿主指定了会话",
  auto: "自动选中最近一条 RUNNING 会话",
  loading: "会话列表还在路上",
  "no-running-session": "本租户没有 RUNNING 会话 —— 没有世界可推演（不是算不出来）",
  unavailable: "会话列表这一跳失败 —— **不知道**有没有会话（不是没有）",
};

/**
 * ══ WO-SIM-SESSION-WIRE · 会话生命周期（暂停 / 恢复 / 结束）与变更波及面 ═══════════
 *
 * **今天的行为是 X（开工实测）**：本壳区② 只把 `sessionId` 与「会话哪来的」印出来，
 *   **会话自己是什么状态一个字都没有**，更没有任何控制 —— 而后端
 *   `PATCH …/sessions/:id/status` 早就在，且 PAUSED/ENDED 是**世界真的冻结**
 *   （推进 / 施加扰动 / 回滚 / 改屏蔽边一律 409）。用户在这块屏上看着世界继续走，
 *   却没有一个地方能把它停下来。
 * **应该是 Y**：状态条上直接看到状态、直接迁移；三种"没成功"分开说
 *   （后端拒绝这次迁移 · 会话/功能不在 · 这一跳自己没走通 ⇒ 不知道成没成）。
 *
 * **第二件（右栏）**：`POST …/change-impact-preview` 的四桶波及面前端零调用 ⇒
 *   「我改这一格会波及谁」问不出来。补在右栏检视之下，**按需触发**（只读语义不做成副作用节奏）。
 *
 * ⛔ **迁移合法性表不在这里镜像一份**：后端 `SIM_STATUS_TRANSITIONS` 自称唯一真相源，
 *   前端再抄一遍就是第二套语义，两边一漂就各说各话。故三个按钮**照发**，
 *   非法迁移由后端 409 明说（实测原话：「会话 … 不能从 PAUSED 迁到 PAUSED（PAUSED 允许的去向：RUNNING/ENDED）。」），
 *   前端原样上屏 —— 用户读到的是权威答案，不是前端的猜测。
 */

/** 会话状态的**五态**（四种"拿不到"各有处置，禁止塌成一个 `undefined`）。 */
type SessionStatusState =
  | { kind: "known"; status: SimSessionStatus }
  /** 壳压根没解析出会话 —— 理由走 `SESSION_REASON_TEXT`，这里不重复一遍。 */
  | { kind: "no-session" }
  /** 会话清单还在路上：此刻"没状态"是**暂时**的，不该被读成"它没有状态"。 */
  | { kind: "loading" }
  /** 会话清单这一跳自己失败了 ⇒ **不知道**它是什么状态（不是"它没状态"）。 */
  | { kind: "unavailable" }
  /** 清单回来了、里面没有这一条 ⇒ 这是**清单的结论**，与"这一跳失败"完全不同。 */
  | { kind: "absent" };

const SESSION_STATUS_ABSENCE_TEXT: Record<Exclude<SessionStatusState["kind"], "known">, string> = {
  "no-session": "没有会话，也就没有状态可迁移",
  loading: "会话清单还在路上 —— 状态待会才知道",
  unavailable: "会话清单这一跳失败 —— 不知道它现在是什么状态（不是它没有状态）",
  absent: "会话清单里没有这一条 —— 它可能不是沙盘会话（清单只回沙盘会话），也可能已被删",
};

/** 三个迁移目标的屏上说法。目标集合与后端 zod 收的那三个逐字对应。 */
const STATUS_ACTIONS: readonly { target: SimSessionStatusTarget; label: string; hint: string }[] = [
  { target: "PAUSED", label: "暂停", hint: "世界停住：推进、施加扰动、回滚一律被拒" },
  { target: "RUNNING", label: "恢复", hint: "解冻，世界可以继续推" },
  { target: "ENDED", label: "结束", hint: "终态，之后只能从它分叉出新世界" },
];

/**
 * 一次写操作**没成功**，究竟是哪一种没成功。
 * ⛔ 三者绝不合并成一句「失败」：前两种是**后端给的结论**（照它办即可），
 *    第三种是**我们不知道**（得再看一眼才知道成没成）—— 处置完全相反。
 */
function describeWriteFailure(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 409) return `后端拒绝了这次迁移：${e.message}`;
    if (e.status === 404) return `后端说这条会话或推演沙盘功能不在：${e.message}`;
    if (e.status === 403) return `没有权限做这次迁移：${e.message}`;
    return `后端回了 ${e.status}：${e.message}`;
  }
  return "这一跳没走通 —— 不知道迁移成没成（这和「后端拒绝了」是两件事）。刷新后再看一眼状态。";
}

/** 波及面四桶的屏上说法（桶名与契约 `ChangeImpactItem.bucket` 一一对应，不多不少）。 */
const IMPACT_BUCKET_TEXT: Record<ChangeImpactPreview["items"][number]["bucket"], string> = {
  recompute: "传导重算",
  rederive: "派生重算",
  rejudge: "规则重判",
  rewire: "结构改写",
};

/**
 * 一个模式档的内容区。
 *
 * **懒加载在这里成立**：`getRenderer()` 取回的是 `registry.ts` 里 `lazy(() => import(...))`
 * 造出来的那个组件 —— React 只在**它真被渲染**的那一刻才去跑 `import()`。
 * 本函数只渲染当前选中那一档 ⇒ 其余三页的 chunk 首屏不下载、DOM 里也没有它们。
 * （变异反证 ③：把这里改成把四档一起渲染出来，接缝门第 ③ 臂当场红。）
 *
 * 键解析不中时**照实说**并把键名打出来，不落一个空白区 ——
 * 「屏上什么都没有」与「这一档没注册」在用户眼里一模一样，正是本仓最恨的那种静默。
 */
function ModePanel({ mode, view }: { mode: UnifiedMode; view: ViewConfigVM }): JSX.Element {
  const key = UNIFIED_MODE_SPEC[mode].renderer;
  const Renderer = getRenderer(key ?? undefined);
  if (key === null || Renderer === undefined) {
    // ⛔ 原文把源码文件名（`views/` 下那份注册表的文件名）印在屏上 —— 属 dev-jargon:check 的
    //    「实现细节标识符」。用户读到一个源码文件名做不出任何决定，那是给工程师看的坐标。
    //    **诚实位一个字没减**：仍然把「接线缺口」与「没有数据」分开说（这一句才是用户要的）；
    //    渲染器键仍上屏（它是这一档的身份，运维可据此报障），坐标降进 title 浮层且只说口径。
    return (
      <div
        className={styles.modeFallback}
        data-testid="usim-mode-unresolved"
        title="口径：这一档要显示什么，取决于它在渲染器注册表里登记了没有。登记表为空即此提示。"
      >
        这一档挂的渲染器 <code>{key ?? "（本表未填）"}</code> 还没有注册
        —— 这是接线缺口，不是「没有数据」。
      </div>
    );
  }
  return (
    <Suspense fallback={<div className={styles.modeFallback}>{UNIFIED_MODE_SPEC[mode].label} 载入中…</div>}>
      <Renderer view={view} />
    </Suspense>
  );
}

/**
 * 右栏「改这一格会波及谁」。**四态各回各的**，一态都不许并进另一态：
 *   ① 问不出来（这张卡没有落点对象 ⇒ 焦点根本组不出来）
 *   ② 还没问 / 正在算
 *   ③ 这一跳没走通 ⇒ **不知道**（再细分：功能没开 vs 别的原因）
 *   ④ 后端答了 —— 而「答的是空」还要再分两态：确为叶子 vs 有算不出来的部分
 *
 * ⛔ 第 ④ 态那两半合并成一句「没有波及」就是造谎：契约原文写着
 *    「items 空 + unresolved 空 = 焦点确为叶子；unresolved 非空 = 有算不出来的部分」。
 */
function ChangeImpactSection({
  objectId,
  stateVar,
  asked,
  onAsk,
  query,
}: {
  objectId: string | null;
  stateVar: string;
  asked: ChangeFocus | null;
  onAsk: (focus: ChangeFocus) => void;
  query: { isLoading: boolean; isError: boolean; error: unknown; data: ChangeImpactPreview | undefined };
}): JSX.Element {
  const focus: ChangeFocus | null = objectId === null ? null : { kind: "stateVar", objectId, stateVar };
  /** 问过的那一格，是不是**眼前**这一格 —— 否则上一张卡的答案会顶着当这一张的答案（静默错答）。 */
  const isThisOne =
    focus !== null &&
    asked !== null &&
    asked.kind === "stateVar" &&
    asked.objectId === focus.objectId &&
    asked.stateVar === focus.stateVar;

  const body = (): JSX.Element => {
    if (focus === null) {
      return (
        <div className={styles.calibre} data-testid="usim-impact-nofocus">
          这张卡没有落点对象，问不出波及面 —— 这是问不出来，不是「没有波及」。
        </div>
      );
    }
    if (!isThisOne) {
      return (
        <button
          type="button"
          className={styles.tab}
          data-testid="usim-impact-ask"
          title="只读预览：不改世界线，也不推进任何一拍"
          onClick={() => onAsk(focus)}
        >
          看看改这一格会波及谁
        </button>
      );
    }
    if (query.isLoading) {
      return (
        <div className={styles.calibre} data-testid="usim-impact-loading">
          正在问 —— 还不知道
        </div>
      );
    }
    if (query.isError) {
      const e = query.error;
      const notEnabled = e instanceof ApiClientError && e.status === 404;
      return (
        <div className={`${styles.calibre} ${styles.warn}`} data-testid="usim-impact-error">
          {notEnabled
            ? `后端说传导预览这项功能不在：${(e as ApiClientError).message}`
            : "这一跳没走通 —— 不知道有没有波及（这和「后端说没有波及」是两件事）"}
        </div>
      );
    }
    const d = query.data;
    if (d === undefined) {
      return (
        <div className={styles.calibre} data-testid="usim-impact-empty-unknown">
          没拿到回包 —— 不知道有没有波及
        </div>
      );
    }
    const counts = new Map<string, number>();
    for (const it of d.items) counts.set(it.bucket, (counts.get(it.bucket) ?? 0) + 1);
    const shown = d.items.slice(0, 12);
    return (
      <div data-testid="usim-impact-result" data-items={d.items.length} data-unresolved={d.unresolved.length}>
        {d.items.length === 0 && d.unresolved.length === 0 ? (
          <div className={styles.calibre} data-testid="usim-impact-leaf">
            改这一格不波及任何下游 —— 这是后端给的结论，不是缺数据。
          </div>
        ) : (
          <>
            <div className={styles.calibre} data-testid="usim-impact-buckets">
              {d.items.length === 0
                ? "一条波及都没算出来"
                : [...counts].map(([b, n]) => `${IMPACT_BUCKET_TEXT[b as keyof typeof IMPACT_BUCKET_TEXT]} ${n}`).join(" · ")}
            </div>
            {shown.length === 0 ? null : (
              <ul className={styles.list} data-testid="usim-impact-list">
                {shown.map((it) => (
                  <li key={`${it.bucket}:${it.target}:${it.via}`}>
                    {IMPACT_BUCKET_TEXT[it.bucket]} · {it.target} · {it.hops} 跳 · 经 {it.via}
                  </li>
                ))}
              </ul>
            )}
            {d.items.length > shown.length ? (
              <div className={styles.calibre}>还有 {d.items.length - shown.length} 条没列出来</div>
            ) : null}
          </>
        )}
        {d.unresolved.length === 0 ? null : (
          <div className={`${styles.calibre} ${styles.warn}`} data-testid="usim-impact-unresolved">
            有 {d.unresolved.length} 处算不出来（所以上面那份不是全部）：
            {d.unresolved.map((u) => `${u.what} 缺 ${u.missing}`).join("；")}
          </div>
        )}
        {d.truncated ? (
          <div className={`${styles.calibre} ${styles.warn}`} data-testid="usim-impact-truncated">
            追到第 {d.maxHops} 跳就停了 —— 更远处有没有波及，这里答不了。
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className={styles.section} data-testid="usim-impact">
      <div className={styles.sectionHead}>改这一格会波及谁</div>
      {body()}
    </section>
  );
}

export default function UnifiedSimShell({ view }: { view?: ViewConfigVM }): JSX.Element {
  const session = useConsoleSession(view?.options);

  /**
   * ══ 壳**钉住**它正在控制的那个世界 ═══════════════════════════════════════════
   *
   * **这不是优化，是「暂停」能不能用的前提**（2026-08-26 真浏览器实测抓到，绿测试没抓到）：
   * `useConsoleSession` 的自动选取**只认 RUNNING**（`pickLatestRunningSession`，那条规则本身是对的
   * —— 拿 PAUSED/ENDED 冒充"当前"会让屏上的数与用户正在推的世界对不上）。
   * 于是接上迁移之后出现了一条**单程路**：按下「暂停」⇒ 会话不再 RUNNING ⇒ 自动选取当场丢掉它 ⇒
   * 状态位翻成「没有会话」、三个按钮一起变灰 —— **把它恢复回来的那个按钮，被它自己按没了**。
   * 实测原文（真浏览器）：`data-status=no-session` / 「没有会话，也就没有状态可迁移」。
   *
   * 正确的语义是：**用户在这块屏上盯着的那个世界，不因为它停下来了就不再是"这块屏在看的世界"。**
   * 故壳一旦解析出会话就钉住它；钉住 ≠ 冒充 RUNNING —— 状态条照实印 PAUSED/ENDED，
   * 且屏上明说「自动选取已经不会再选中它了」。
   *
   * ⛔ 修法刻意**不动** `useConsoleSession`：那条 hook 是四页共用的（且属别的边界），
   *   把「只认 RUNNING」放宽会连带改掉四页的取数语义 —— 那是另一件事。
   */
  const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null);
  if (session.sessionId !== undefined && session.sessionId !== pinnedSessionId) {
    // 渲染期改 state 的"随入参调整"官方写法：条件保证只在真的换了世界时走一次，不会自激。
    setPinnedSessionId(session.sessionId);
  }
  /** 钉住的那个世界正在被用，而自动选取已经不认它了 —— 这件事屏上要说，不许闷着。 */
  const usingPinned = session.sessionId === undefined && pinnedSessionId !== null;
  const sessionId = session.sessionId ?? pinnedSessionId ?? undefined;
  const enabled = sessionId !== undefined && sessionId !== "";

  const [mode, setMode] = useState<UnifiedMode>("now");
  const [selected, setSelected] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [log, setLog] = useState<readonly string[]>([]);
  const say = (line: string): void => setLog((p) => [...p, line].slice(-50));
  const qc = useQueryClient();
  /** 用户**主动问过**的那一格（`null` = 还没问）。只读预览不许挂在选中态上自动发。 */
  const [askedFocus, setAskedFocus] = useState<ChangeFocus | null>(null);

  const cfgQ = useQuery({
    queryKey: ["a", "sim-view-config"],
    queryFn: fetchSimViewConfig,
    staleTime: Infinity,
    retry: false,
  });
  const layersQ = useQuery({
    queryKey: ["a", "sim-statevar-layers"],
    queryFn: fetchDrillStateVarLayers,
    staleTime: Infinity,
    retry: false,
  });
  const rulesQ = useQuery({
    queryKey: ["a", "sim-propagation-rules", true],
    queryFn: () => fetchPropagationRules(true),
    staleTime: Infinity,
    retry: false,
  });
  const seriesQ = useQuery({
    queryKey: ["a", "sim-metric-series", sessionId ?? ""],
    queryFn: () => api.a<SimMetricSeriesResponse>(metricSeriesPath(sessionId as string)),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  // 与 `useConsoleSession` **同一个缓存键** ⇒ 不多发一次请求，也不另立一套"当前会话"判定。
  const sessionsQ = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    staleTime: Infinity,
    retry: false,
  });
  const perturbQ = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  /**
   * 变更波及面。`enabled` 咬在「用户问过了」上 —— 没问就一发不发（只读，但方法是 POST）。
   * `retry:false`：这一跳失败时正确的行为是**如实说不知道**，不是偷偷重试几次再说。
   */
  const impactQ = useQuery({
    queryKey: ["a", "sim-change-impact", askedFocus === null ? "" : JSON.stringify(askedFocus)],
    queryFn: () => previewChangeImpact(askedFocus as ChangeFocus),
    enabled: askedFocus !== null,
    staleTime: Infinity,
    retry: false,
  });

  /**
   * 会话状态迁移。成功即失效 `["a","sim-sessions"]` —— 权威状态**只有清单那一份**
   * （单跳实测 1,087 字节），不在本组件另存一个 status 副本当第二个出处。
   */
  const statusM = useMutation({
    mutationFn: (target: SimSessionStatusTarget) => patchSimSessionStatus(sessionId as string, target),
    onSuccess: (r) => {
      say(`会话迁到「${r.status}」（第 ${r.curTick} 拍）`);
      void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
    },
    onError: (e) => say(describeWriteFailure(e)),
  });

  const cfg = cfgQ.data as SandboxViewConfig | undefined;
  const rules = (rulesQ.data as PropagationRulesResponse | undefined)?.items ?? [];
  /**
   * 名字字典**两条端点同形状**（契约明文：「两个端点用同一种形状前端才能共用一条消费路径」）。
   * view-config 那份优先；它没下发时回落到 propagation-rules 那份。两份同源同投影函数，不会打架。
   */
  const names = cfg?.stateVarNames ?? (rulesQ.data as PropagationRulesResponse | undefined)?.stateVarNames;

  /**
   * 清单里那一条会话本身。**这一步单独拿出来**，是因为「清单里没有这一条」与
   * 「这一条没有出处记号」此前被合并成了同一句话（`origin === null`）——
   * 两者一个是**清单的结论**、一个是**会话的属性**，处置完全不同。
   */
  const current = useMemo(
    () => (sessionsQ.data?.items ?? []).find((x) => x.id === sessionId),
    [sessionsQ.data, sessionId],
  );
  const origin = useMemo(() => (current === undefined ? null : readSnapshotOrigin(current.scope)), [current]);
  const statusState: SessionStatusState = useMemo(() => {
    if (!enabled) {
      // 「压根没有会话」与「不知道有没有会话」不是一回事 —— 沿用 `useConsoleSession` 已经分好的那五态，
      // 不在这里把它们又揉成一句（揉了就是把上游辛苦分出来的区别当场丢掉）。
      if (session.reason === "unavailable") return { kind: "unavailable" };
      if (session.reason === "loading") return { kind: "loading" };
      return { kind: "no-session" };
    }
    if (current !== undefined) return { kind: "known", status: current.status };
    if (sessionsQ.isLoading) return { kind: "loading" };
    if (sessionsQ.isError) return { kind: "unavailable" };
    return { kind: "absent" };
  }, [enabled, session.reason, current, sessionsQ.isLoading, sessionsQ.isError]);

  const wall = useMemo(
    () =>
      buildMetricWall({
        stateVars: cfg?.stateVars ?? [],
        stateVarNames: names,
        layers: layersQ.data?.layers ?? null,
        series: seriesQ.data ?? null,
        seriesAbsenceReason: enabled
          ? seriesQ.isLoading
            ? "指标时序还在路上"
            : "指标时序这一跳失败了 —— 不知道这些变量变了没有"
          : SESSION_REASON_TEXT[session.reason],
        origin,
      }),
    [cfg, names, layersQ.data, seriesQ.data, seriesQ.isLoading, enabled, session.reason, origin],
  );

  const inspector = useMemo(() => {
    if (selected === null) return null;
    const card = wall.cards.find((c) => c.stateVar === selected);
    if (card === undefined) return null;
    return buildInspectorView({ card, wall, rules, stateVarNames: names });
  }, [selected, wall, rules, names]);

  const applied: PerturbationBrief[] = useMemo(
    () =>
      (perturbQ.data?.items ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        targetStateVar: p.targetStateVar,
        targetLabel: stateVarLabel(p.targetStateVar, names),
        magnitude: p.magnitude,
        mode: p.mode,
      })),
    [perturbQ.data, names],
  );
  const summary = useMemo(() => buildRailSummary(applied, wall), [applied, wall]);

  const windowDays =
    seriesQ.data === undefined ? null : seriesQ.data.ticks.length * (seriesQ.data.tickDays ?? 1);

  /**
   * 透给被挂载那一页的 `view`。**上下文就是从这里过去的**，三件事各有出处：
   *
   *  · `sessionId` —— 壳已经解析好的那个会话。透下去 ⇒ 各页 `useConsoleSession` 走
   *    `reason:"explicit"` 分支，**不再各自去查一遍**「最近一条 RUNNING」。
   *    这是「切页签不换世界」的结构保证：四页与卡墙看的是**同一个** sessionId，
   *    而不是四次独立查询碰巧查到同一条（那种一致性经不起一次会话变更）。
   *    壳自己都没解析出会话时**不透**（不传空串下去让它发 404）——
   *    此时各页回落到自己那条同 `queryKey` 的查询，同缓存同答案。
   *
   *  · 宿主自己的 `view.options` —— 原样带过去（如损失归因的 `so` 锚点订单号、
   *    方案寻优的 `paretoRequest`、线路图的 `baseIds`）。深链进本壳的参数因此仍然到得了页面；
   *    **壳不在这里编任何默认值**（编一个就是造假锚点，见 `SandboxAttrRoute` 文件头）。
   *
   *  · `key` / `renderer` —— 填这一档的 renderer key，与 `ViewPage` 下发的形状一致。
   *
   * ⚠ `useMemo` 不是优化，是**必需**：`ChainLineMapView` 的 `argsFromView(view)` 按引用做
   *   `useMemo` 依赖，每渲染新造一个对象会让它反复重取。
   */
  const modeViews = useMemo(() => {
    const inherited = view?.options ?? {};
    const out: Partial<Record<UnifiedMode, ViewConfigVM>> = {};
    for (const m of UNIFIED_MODES) {
      const key = UNIFIED_MODE_SPEC[m].renderer;
      if (key === null) continue;
      out[m] = {
        key,
        title: UNIFIED_MODE_SPEC[m].label,
        renderer: key,
        layout: undefined,
        options: { ...inherited, ...(sessionId === undefined ? {} : { sessionId }) },
      };
    }
    return out;
  }, [view?.options, sessionId]);

  const modeView = modeViews[mode];

  return (
    <div className={styles.shell} data-testid="usim-shell">
      {/* ── 区① 顶部模式页签（顺序与分组 = `unifiedModes.ts`，本处不另排一套）──
          `role="tablist"` + `aria-selected`：这排按钮换的是**同一屏的哪一面**，不是导航到别处，
          故用 tab 语义而不是链接（与规格 `.modes[role=tablist]` 一致）。 */}
      <nav className={styles.tabs} data-testid="usim-tabs" role="tablist" aria-label="推演模式">
        {UNIFIED_MODES.map((m) => {
          const spec = UNIFIED_MODE_SPEC[m];
          const on = m === mode;
          const disabled = spec.pending !== null;
          return (
            <span key={m} className={styles.tabSlot}>
              {spec.group === null ? null : (
                <span className={styles.tabGroup} data-testid={`usim-tab-group-${m}`} aria-hidden>
                  {spec.group}
                </span>
              )}
              <button
                type="button"
                role="tab"
                className={`${styles.tab} ${on ? styles.tabOn : ""}`}
                data-testid={`usim-tab-${m}`}
                data-active={on ? "1" : "0"}
                disabled={disabled}
                title={disabled ? `${spec.question} —— ${spec.pending}` : spec.question}
                aria-selected={on}
                onClick={() => {
                  setMode(m);
                  say(`切到「${spec.label}」`);
                }}
              >
                {spec.label}
              </button>
            </span>
          );
        })}
      </nav>

      {/* ── 区② 状态条：会话出处 + 世界态出处（诚实位，两件事分开说）── */}
      <div className={styles.status} data-testid="usim-status" data-session-reason={session.reason}>
        <span>
          <span className={styles.statusKey}>会话 </span>
          {sessionId ?? "—"}
        </span>
        <span className={styles.calibre} data-testid="usim-session-reason" data-pinned={usingPinned ? "1" : "0"}>
          {usingPinned
            ? "这块屏继续盯着刚才那个世界 —— 它已经不是 RUNNING 了，自动选取不会再选中它"
            : SESSION_REASON_TEXT[session.reason]}
        </span>
        <span data-testid="usim-origin" data-origin-kind={origin?.kind ?? "unknown"} className={styles.calibre}>
          {origin === null
            ? current === undefined
              ? // 「清单里根本没有这一条」—— 这与「有这一条、但它没带出处记号」是两件事，
                // 从前两者共用一句话，屏上分不出来。现在按 statusState 分开说。
                `世界态出处：${SESSION_STATUS_ABSENCE_TEXT[statusState.kind === "known" ? "absent" : statusState.kind]}`
              : "世界态出处：这条会话没有带出处记号 ⇒ 出处不明，屏上一律按「非实测」读"
            : `世界态出处：${origin.kind}${origin.note === null ? "" : ` · ${origin.note}`}${
                origin.measuredCells === null || origin.cells === null
                  ? ""
                  : ` · 实测格 ${origin.measuredCells}/${origin.cells}`
              }`}
        </span>
      </div>

      {/* ── 会话生命周期条：状态 + 暂停/恢复/结束（WO-SIM-SESSION-WIRE）──────────
          状态只有一个出处 = 会话清单。迁移合法性不在前端镜像，非法迁移由后端明说。 */}
      <div className={styles.status} data-testid="usim-lifecycle" data-status={statusState.kind === "known" ? statusState.status : statusState.kind}>
        <span>
          <span className={styles.statusKey}>状态 </span>
          {statusState.kind === "known" ? statusState.status : "—"}
        </span>
        {statusState.kind === "known" ? null : (
          <span className={styles.calibre} data-testid="usim-status-absent">
            {SESSION_STATUS_ABSENCE_TEXT[statusState.kind]}
          </span>
        )}
        {STATUS_ACTIONS.map((a) => (
          <button
            key={a.target}
            type="button"
            className={styles.tab}
            data-testid={`usim-status-${a.target.toLowerCase()}`}
            disabled={!enabled || statusM.isPending}
            title={enabled ? a.hint : "先要有一个会话，才谈得上迁移它的状态"}
            onClick={() => {
              say(`请求把会话迁到「${a.target}」`);
              statusM.mutate(a.target);
            }}
          >
            {a.label}
          </button>
        ))}
        {statusM.isPending ? (
          <span className={styles.calibre} data-testid="usim-status-pending">
            正在迁移 —— 还不知道结果
          </span>
        ) : null}
        {statusM.isError ? (
          <span className={`${styles.calibre} ${styles.warn}`} data-testid="usim-status-error">
            {describeWriteFailure(statusM.error)}
          </span>
        ) : null}
      </div>

      {/* 左栏收起后的常驻摘要条（仓主明确要的那条） */}
      {!railOpen ? (
        <div className={styles.summaryBar} data-testid="usim-rail-summary">
          <span data-testid="usim-rail-summary-applied">已施加：{summary.appliedText}</span>
          <span data-testid="usim-rail-summary-result">{summary.resultText}</span>
          <button type="button" data-testid="usim-rail-reopen" onClick={() => setRailOpen(true)}>
            改扰动
          </button>
        </div>
      ) : null}

      {/* ── 区③ 三栏主体 ──────────────────────────────────────────────────────
          **左栏是壳的一部分，不属于任何一档** —— 切页签只换中/右两栏。
          这不是版面偏好，是本单的**功能判据**：左栏一旦挂在某一档之下，切页签就等于
          卸载它，用户正在挑的落点/范围当场清零 —— 那正是「今天跨页会丢上下文」这件事
          换个地方复发。规格原型把左栏只画在首档，是因为静态 HTML 没有"卸载"这回事；
          真做出来必须提到壳级。要整版宽度时按「收起」（收起态摘要条常驻，规格里那条）。 */}
      <div
        className={[
          styles.body,
          mode === "now" ? "" : styles.bodyMode,
          railOpen ? "" : mode === "now" ? styles.bodyRailOff : styles.bodyModeRailOff,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="usim-body"
        data-mode={mode}
      >
        {railOpen ? (
          <aside className={styles.col} data-testid="usim-rail">
            <div className={styles.railHead}>
              <strong>扰动</strong>
              <button type="button" data-testid="usim-rail-collapse" onClick={() => setRailOpen(false)}>
                收起
              </button>
            </div>
            {/* 左栏 = `rail/PerturbRail`（WO-SIM-RAIL-FORMS）。历史：本壳交付时挂的是
                `console/PerturbTree`（一行未改），收编 ③ 时替换。原注释保留在下方作沿革：
                它自带取数与 20 条因子目录，props 只有 `{sessionId, targetObjectId}`。
                本单不动它的表单形态 —— 那是第 ③ 张单。 */}
            {/*
              WO-SIM-RAIL-FORMS 收编 · 挂载（②③ 都不归它，归收编方）。

              ⛔ **刻意不接 `onAppliedChange`** —— 那会给同一个事实造第二条路。
              实测：本壳 `perturbQ`（:190）与 `PerturbRail`（`PerturbRail.tsx:108`）读的是
              **逐字相同**的查询键 `["a","sim-perturbations", sessionId ?? ""]` ⇒ React Query 去重，
              两边取的是同一份缓存；而 rail 提交成功后失效的也正是这个键
              （`PerturbRail.tsx:216`）⇒ 本壳的 `applied` / `summary` **自动跟着更新**，
              一行都不用改。接了 `onAppliedChange` 反而让「已施加什么」有两个出处，
              两边一漂就各说各话 —— 那正是本仓治过多次的第二套真相源。
            */}
            <PerturbRail sessionId={sessionId} />
          </aside>
        ) : null}

        {/* 「指标态势」= 本壳自带的卡墙 + 右栏检视；其余档 = 挂现成页面，占中右整块。
            **任何时刻只有一档在 DOM 里**（`sandboxModes.ts` 那条硬约束的同一条：
            不是 `hidden`/`display:none` —— 那只是让人看不见，请求照发、屏幕阅读器照读）。 */}
        {mode === "now" ? (
          <>
            <main className={styles.col} data-testid="usim-center">
              <MetricWall
                wall={wall}
                selected={selected}
                onSelect={(sv) => {
                  setSelected(sv);
                  say(`选中 ${sv}`);
                }}
              />
            </main>

            <aside className={styles.col} data-testid="usim-right">
              <InspectorPane
                view={inspector}
                onExpand={() => {
                  setDrawerOpen(true);
                  say(`展开抽屉 ${inspector?.card.stateVar ?? ""}`);
                }}
                onAction={(a) => say(`动作 ${a}（本单不落写操作）`)}
              />
              {inspector === null ? null : (
                <ChangeImpactSection
                  objectId={inspector.card.objectId}
                  stateVar={inspector.card.stateVar}
                  asked={askedFocus}
                  onAsk={(f) => {
                    setAskedFocus(f);
                    say(`问了一次波及面：${f.kind === "stateVar" ? f.stateVar : f.kind}`);
                  }}
                  query={impactQ}
                />
              )}
            </aside>
          </>
        ) : (
          <section
            className={styles.col}
            data-testid="usim-mode-panel"
            data-mode={mode}
            data-renderer={UNIFIED_MODE_SPEC[mode].renderer ?? ""}
            role="tabpanel"
            aria-label={UNIFIED_MODE_SPEC[mode].label}
          >
            {/* 同上：坐标降 title 且只说口径，屏上只留用户能据以判断的那一句。 */}
            {modeView === undefined ? (
              <div
                className={styles.modeFallback}
                data-testid="usim-mode-unresolved"
                title="口径：这一档要显示什么，由本壳的档位表决定。档位表里这一档没填渲染器即此提示。"
              >
                这一档还没有配渲染器 —— 接线缺口，不是「没有数据」。
              </div>
            ) : (
              <ModePanel mode={mode} view={modeView} />
            )}
          </section>
        )}
      </div>

      {/* ── 区④ 底部抽屉 ──────────────────────────────────────────────────────
          抽屉装的是**选中那张指标卡**的详情（链路/落点/时序），只有「指标态势」有卡可选。
          其余档下不渲染开关：摆一个点开永远是空的开关，就是本仓最恨的假旋钮。 */}
      {mode === "now" ? (
        <div>
          <button
            type="button"
            data-testid="usim-drawer-toggle"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            {drawerOpen ? "收起抽屉" : "展开抽屉"}
          </button>
          {drawerOpen ? <BottomDrawer view={inspector} windowDays={windowDays} /> : null}
        </div>
      ) : null}

      {/* ── 区⑤ 底部日志 ── */}
      <div className={styles.log} data-testid="usim-log">
        {log.length === 0 ? "（无操作）" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
