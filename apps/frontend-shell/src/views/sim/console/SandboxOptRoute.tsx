/** 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由（注册表的契约是
 *  `ComponentType<ViewRendererProps>`，而指控台组件的入参是**业务参数**；直接注册靠的是
 *  「所有 props 都可选」这条结构类型巧合，哪天加一个必填 prop 就静默断）。
 *
 *  WO-SIM-FE-HOST：`sessionId` 不再只从 `view.options` 取（那里恒空，见 `useConsoleSession`
 *  文件头），没显式指定就自己查最近一条 RUNNING 会话。
 *
 *  ⚠ **本页两个入参各驱动一半屏，诚实位也是两个，不许拿一个盖另一个**：
 *   · `paretoRequest` → `useParetoFrontier` → 根节点 `[data-testid="sandbox-opt"]` 的 `data-source`
 *     （帕累托前沿解集，**与会话无关**）；
 *   · `sessionId`     → `useExecutionCompare` → 底部执行对比 `[data-testid="sandbox-opt-grid"]`
 *     的 `data-source`（接 `GET …/:id/metric-series`）。
 *  故本页会出现"执行对比 `endpoint`、前沿图 `placeholder`"的**正常**中间态，这不是漏接。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WO-SIM-PARAM-WIRE ① · 今天的行为是 X，应该是 Y
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **X（改造前实测原文）**：本文件旧第 29 行 `{...(p.paretoRequest ? { paretoRequest: p.paretoRequest } : {})}`
 * —— `p` 是 `(view.options ?? {})` 的**裸 cast**，既不校验形状、也不补 `sessionId`。
 * 配上 `useParetoFrontier.ts:618` 的 `const enabled = req !== undefined;`，
 * 于是「宿主不给 ⇒ 一个请求都不发 ⇒ 落 `PLACEHOLDER_OPT_MODEL`」。
 * 而**全仓没有任何地方往 `view.options` 里放 `paretoRequest`**（同 `useConsoleSession` 文件头
 * 记过的那笔账：后端 workspace 从不下发这四个 viewKey）⇒ 前沿图**恒占位**。
 *
 * **Y（现在）**：宿主真的**组装**一份参数再透下去 —— 组装 = 校验 + 补齐 + 拒绝，三件事：
 *   ① **校验**：`ParetoRequestSchema.safeParse` 真过一遍契约。形状不对 ⇒ **不发请求**
 *      （旧代码会把一份坏 request 原样透下去，换来一个必然 400，然后被 hook 静默吞成占位 ——
 *      屏上与"宿主没给"长得一模一样，两件完全不同的事分不出来）。
 *   ② **补齐**：`sessionId` ← **会话 scope**（`useConsoleSession` 查到的那条 RUNNING）。
 *      契约 `ParetoRequestSchema.sessionId` 的原话是「R6 确定性键的一部分：同 session +
 *      同杠杆集 + 同参数版本 ⇒ 字节级一致」。旧代码**连这一格都没送过**，
 *      于是同一份网格在两个世界里算出来的解在缓存/追溯上分不开。
 *      显式给了就不覆盖（显式 > 自动，与 `useConsoleSession` 的优先级同一套）。
 *   ③ **拒绝**：解析不出 ⇒ 返回 `undefined` ⇒ `enabled:false` ⇒ **一个请求都不发**，
 *      `[data-testid="sandbox-opt"]` 的 `data-source` 保持 `placeholder`。
 *
 * ══ ⛔ 为什么模型部分（`family`/`args`/`objectives`/`levers`）**不由前端生成** ══════
 *
 * 这是本单唯一一处「本来想做、实测做不了、故如实报」的地方，证据逐条如下（都是亲手跑出来的）：
 *
 *  · `ParetoRequest` 的必填三件套是 `family` + `objectives(≥2)` + `levers(≥1)`，
 *    且 `levers[].key` 必须能 **DF.8 接地**到 `args` 里（`opt-whatif.ts` 的 `resolveTarget`）——
 *    也就是说必须先有一份**完整的优化模型**（vars/constraints/成本系数/可产对），才谈得上杠杆。
 *  · 这份模型在本仓是**建模产物**，唯一的自动装配口在后端且**没有出口**：
 *    `solvers/opt-binding.ts` 的 `bindToSolverArgs` / `bindCrossObjectOccupancy`（要一份
 *    `OntologyBinding` 的 role→本体映射），以及 `solvers/service.ts` 的
 *    `assembleBaselineFromSelection`（`private`，只在 `optimize_whatif` 的 `autoBind` 分支里走）。
 *    两者都**不回显装配出来的 `args`**，前端拿不到。
 *  · 前端自己猜 role（把 `Order.value` 读成 revenue、`Order.qty` 读成 qty…）就是在客户端
 *    另造一套求解口径 —— 正是 R13/R14 反复点名的漂移源，也是 `SandboxOptProps.paretoRequest`
 *    与 `useParetoFrontier.ts` 文件头立的那条纪律。**判据 1 明写「解析不出就不发请求」，故不发。**
 *  · 补充实测（内存态 · `node apps/datacore/dist/server.js`）：即使前端拼得出模型，
 *    `GET /a/v1/opt/templates` 在册的 5 个族（facility_location / min_cost_flow / set_cover /
 *    independent_set / combinatorial_auction）**一律**回
 *    `400 "<family> 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）"`；
 *    内存态唯一能真解的族是 `cross_object_occupancy`（`InProcOptimizerClient` 兜底，实测 200、
 *    `frontier` 3 个解）。**故也不许拿「在册族」去做白名单校验** —— 那会把唯一能解的族挡掉。
 */
import type { ViewRendererProps } from "@/views/registry";
import { ParetoRequestSchema, type ParetoRequest } from "@platform/contracts";
import { SandboxOpt } from "./SandboxOpt";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

/**
 * 宿主参数组装口 —— **前沿图这一半的唯一入口**（`SandboxOptRoute` 只调它，不再自己拼）。
 *
 * @param raw       `view.options.paretoRequest` 的**未校验**原值（视图配置是外部输入）。
 * @param sessionId 会话 scope 里那条会话（`useConsoleSession` 的产出）。
 * @returns 可发的 `ParetoRequest`；**解析不出一律 `undefined`**（= 不发请求、保留占位）。
 *
 * 三条判据，逐条对着一个具体的坏结局：
 *  · `raw` 缺席 ⇒ `undefined`：宿主没给模型，前端**不生成**（理由见文件头 ⛔ 段）。
 *  · `raw` 形状不对 ⇒ `undefined`：**不做部分修补**。补一半的 request 会真的发出去、
 *    换回一个 400，再被 hook 吞成占位 —— 屏上和"没给"一样，而库里多了一次无效求解。
 *  · `sessionId` **只补不覆盖**：`raw` 自带的优先（显式 > 自动）。两个都没有也照发 ——
 *    契约里这一格是 `optional`，`runOptimizePareto` 不读它，把它升成硬门槛属于加戏。
 */
export function resolveParetoRequest(raw: unknown, sessionId?: string): ParetoRequest | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = ParetoRequestSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const req = parsed.data;
  if (req.sessionId !== undefined || sessionId === undefined || sessionId === "") return req;
  return { ...req, sessionId };
}

export default function SandboxOptRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; paretoRequest?: unknown };
  const session = useConsoleSession(p);
  const paretoRequest = resolveParetoRequest(p.paretoRequest, session.sessionId);
  return (
    <div {...consoleHostProps(session)}>
      <SandboxOpt
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(paretoRequest ? { paretoRequest } : {})}
      />
    </div>
  );
}
