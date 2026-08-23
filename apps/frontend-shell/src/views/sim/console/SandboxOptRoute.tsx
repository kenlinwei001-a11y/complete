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
 * **X（2026-08-22 改造前实测原文）**：本文件旧第 29 行
 * `{...(p.paretoRequest ? { paretoRequest: p.paretoRequest } : {})}`
 * —— `p` 是 `(view.options ?? {})` 的**裸 cast**，既不校验形状、也不补 `sessionId`。
 * 配上 `useParetoFrontier.ts` 的 `const enabled = req !== undefined;`
 * （**不写死行号**，行号会漂；现找：`grep -n 'const enabled = req' apps/frontend-shell/src/views/sim/console/useParetoFrontier.ts`），
 * 于是「宿主不给 ⇒ 一个请求都不发 ⇒ 落 `PLACEHOLDER_OPT_MODEL`」。
 * 而**全仓没有任何地方往 `view.options` 里放 `paretoRequest`** ⇒ 前沿图**恒占位**。
 * ⚠ **2026-08-23 订正这条的理由**：这里原写「后端 workspace **从不下发这四个 viewKey**」，
 *   那句今天已不成立（viewKey 已下发，见 `useConsoleSession` 文件头 2026-08-23 那段）。
 *   真正仍然成立的是**下发的 view 对象没有 `options` 这一格** ——
 *   结论（`paretoRequest` 恒缺席）没变，理由换了一档：从「没接线」变成「接了线没数据」。
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
 * ══════════════════════════════════════════════════════════════════════════
 * WO-SIM-PARETO-MODEL-EXIT · 模型那一半：今天的行为是 X，应该是 Y
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **X（`WO-SIM-PARAM-WIRE` 收工时写在本文件里的原文，逐条属实，我复现过）**：
 * 宿主会校验、会补 `sessionId`、会拒绝坏形状 —— 但**模型本身没人给**。原文写着：
 *
 *  · `ParetoRequest` 的必填三件套是 `family` + `objectives(≥2)` + `levers(≥1)`，
 *    且 `levers[].key` 必须能 **DF.8 接地**到 `args` 里（`opt-whatif.ts` 的 `resolveTarget`）——
 *    也就是说必须先有一份**完整的优化模型**（vars/constraints/成本系数/可产对），才谈得上杠杆。
 *  · 这份模型的**唯一自动装配口在后端且没有出口**：`solvers/opt-binding.ts` 的
 *    `bindToSolverArgs`/`bindCrossObjectOccupancy` 要一份**现成的** `OntologyBinding`；
 *    `solvers/service.ts` 的 `assembleBaselineFromSelection` 是 `private`，只在
 *    `optimize_whatif` 的 `autoBind` 分支里走，且**只回 Δ目标不回 args**。
 *    （**2026-08-22 复现原文**，本机内存态 demo 租户：
 *     `POST /a/v1/solvers/optimize_whatif/invoke {"args":{"family":"facility_location","autoBind":true,…}}`
 *     → `200 {"data":{"applicable":false,"missingRoles":["facility（Base 在选中范围内无实例）"],…}}`
 *     ——通篇没有一格叫 `args`。复验，SEED_DEMO=1 起 datacore 后：
 *     `curl -s -X POST -H 'Content-Type: application/json' -H 'X-Debug-User: demo:admin:admin|planner|catalog_admin' -d '{"args":{"family":"facility_location","autoBind":true}}' http://127.0.0.1:4001/a/v1/solvers/optimize_whatif/invoke`
 *     —— 回包里若出现 `args` 这一格，本段就该重写。）
 *  · 前端自己猜 role（把 `Order.value` 读成 revenue、`Order.qty` 读成 qty…）就是在客户端
 *    另造一套求解口径 —— 正是 R13/R14 反复点名的漂移源。
 *
 * 于是 `view.options.paretoRequest` 恒缺席 ⇒ 前沿图恒 `data-source="placeholder"`。
 *
 * **Y（现在）**：后端开了出口 —— `POST /a/v1/sim/optimize-pareto/assemble`
 * 从**本租户已发布本体**装出模型，回一份**完整的、可直接 POST 的 `ParetoRequest`**。
 * 宿主的活因此变成四件事，一件都不多：
 *   ① **要范围**：把会话 scope 递过去。本页除"当前会话"外没有别的范围可给，
 *      故只递它 —— **不猜 selection**（猜出来的范围就是客户端另造口径的另一种形态）。
 *   ② **不改模型**：装回来的 `family`/`args`/`objectives`/`levers` **一格不动**往下透。
 *      宿主仍然只许"补齐"（`sessionId`），不许"改写" —— 与上半段同一条纪律。
 *   ③ **仍然真过契约**：装配结果照样喂 `resolveParetoRequest()`（= `safeParse`）。
 *      服务端产出的东西为什么还要再校一遍 —— **这一格是接缝不是客套**：前后端版本错位、
 *      代理改写、缓存串包，任何一种都会让"服务端保证过了"失效，而失效时的表现是
 *      发一个必然 400 的请求再被 hook 吞成占位，屏上与"没给"长得一模一样。
 *   ④ **装不出就不发**：`applicable:false`（本体撑不起这个模型）或这一跳自己失败
 *      ⇒ `undefined` ⇒ `useParetoFrontier` 的 `enabled:false` ⇒ **一个 pareto 请求都不发**，
 *      占位原样保留。这正是「不许兜假模型」在前端这一侧的落点。
 *
 * ⚠ **显式给的模型优先**：`view.options.paretoRequest` 若真有值就用它、**连装配口都不调**
 * （显式 > 自动，与 `sessionId` 同一套优先级；`WO-SIM-PARAM-WIRE` 那四条用例因此逐字节仍成立）。
 *
 * ⛔ **版面零改动**：本文件不产出任何 DOM —— 诚实位仍只走既有 `data-source` 属性族，
 *    屏上一个字都没多。像素级 1:1 的验收线（`docs/ux-spec/sandbox/sandbox-opt.html`）不受影响。
 */
import type { ViewRendererProps } from "@/views/registry";
import { useQuery } from "@tanstack/react-query";
import { ParetoAssembleResultSchema, ParetoRequestSchema, type ParetoRequest } from "@platform/contracts";
import { api } from "@/api/apiClient";
import { SandboxOpt } from "./SandboxOpt";
import { consoleHostProps, useConsoleSession, type ConsoleSession } from "./useConsoleSession";

/**
 * 宿主参数组装口 —— **前沿图这一半的唯一入口**（`SandboxOptRoute` 只调它，不再自己拼）。
 *
 * @param raw     `view.options.paretoRequest` 的**未校验**原值（视图配置是外部输入）。
 * @param session 会话 scope（`useConsoleSession` 的五态产出 —— 要的是**态**不只是 id，理由见判据三）。
 * @returns 可发的 `ParetoRequest`；**解析不出一律 `undefined`**（= 不发请求、保留占位）。
 *
 * 四条判据，逐条对着一个具体的坏结局：
 *  · `raw` 缺席 ⇒ `undefined`：宿主没给模型，前端**不生成**（理由见文件头 ⛔ 段）。
 *  · `raw` 形状不对 ⇒ `undefined`：**不做部分修补**。补一半的 request 会真的发出去、
 *    换回一个 400，再被 hook 吞成占位 —— 屏上和"没给"一样，而库里多了一次无效求解。
 *  · **会话还在路上（`loading`）⇒ 先不发**。这一条是被本单的接缝测试当场逼出来的，
 *    实测原文：`expected [ … ] to have a length of 1 but got 2` ——
 *    第一次渲染时 `sessionId` 还是 `undefined`，于是先发了一份**缺 R6 确定性键**的 request；
 *    列表回来后 request 变了、`queryKey` 跟着变，**又发一份**。一次开页两次求解，
 *    而第一份正是本单要消灭的那种"没带会话的解"。`useConsoleSession` 的文件头早就写着
 *    「`loading` 什么都不该说」—— 这里就是那句话的落点：**等它定态再组装**。
 *    其余四态（`explicit`/`auto`/`no-running-session`/`unavailable`）都已是**结论**，照常组装。
 *  · `sessionId` **只补不覆盖**：`raw` 自带的优先（显式 > 自动）。会话定态后仍没有 id
 *    （`no-running-session` / `unavailable`）也照发 —— 契约里这一格是 `optional`，
 *    `runOptimizePareto` 不读它，把它升成硬门槛属于加戏。
 */
export function resolveParetoRequest(raw: unknown, session: ConsoleSession): ParetoRequest | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (session.reason === "loading") return undefined;
  const parsed = ParetoRequestSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const req = parsed.data;
  const sessionId = session.sessionId;
  if (req.sessionId !== undefined || sessionId === undefined || sessionId === "") return req;
  return { ...req, sessionId };
}

/** 装配出口的路径 —— 与 `useParetoFrontier.PARETO_ENDPOINT` 同族，写成常量供测试引用。 */
export const PARETO_ASSEMBLE_ENDPOINT = "/a/v1/sim/optimize-pareto/assemble" as const;

/**
 * 向后端要一份模型（`WO-SIM-PARETO-MODEL-EXIT`）。
 *
 * 三条判据，逐条对着一个具体的坏结局：
 *  · **`explicit` 时不调**：宿主已经拿到显式模型，再调一次装配口就是白发一个请求，
 *    而且会让"显式 > 自动"这条优先级在网络层看起来是反的。
 *  · **会话还在路上（`loading`）不调**：与下半段同一条理由 —— 先发一份缺 `sessionId` 的、
 *    列表回来再发一份，一次开页两次装配，且第一份装出来的模型缺 R6 确定性键。
 *  · **回包必须过契约**（`ParetoAssembleResultSchema.safeParse`）：解析不出就当装不出。
 *    ⛔ 不做部分修补 —— 半份模型发出去换回 400，再被吞成占位，屏上与"没装出来"一模一样。
 *
 * `retry:false`：装不出是**结论**不是抖动，重试三次只会把同一个结论算三遍。
 */
function useAssembledParetoRequest(session: ConsoleSession, enabled: boolean): ParetoRequest | undefined {
  const sessionId = session.sessionId;
  const body = sessionId ? { sessionId } : {};
  const q = useQuery({
    queryKey: ["a", "sim-pareto-assemble", sessionId ?? ""],
    enabled: enabled && session.reason !== "loading",
    retry: false,
    queryFn: () => api.a<unknown>(PARETO_ASSEMBLE_ENDPOINT, { body }),
  });
  if (q.data === undefined) return undefined;
  const parsed = ParetoAssembleResultSchema.safeParse(q.data);
  if (!parsed.success || !parsed.data.applicable) return undefined;
  return parsed.data.request;
}

export default function SandboxOptRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; paretoRequest?: unknown };
  const session = useConsoleSession(p);
  const explicit = resolveParetoRequest(p.paretoRequest, session);
  // 显式没给才去装配（hook 恒调用、只切 `enabled` —— React hook 规则不许条件调用）。
  const assembled = useAssembledParetoRequest(session, explicit === undefined && p.paretoRequest === undefined);
  // 装回来的那份**再过一遍同一个判官**：补 `sessionId`、坏形状照样拒。
  const paretoRequest = explicit ?? resolveParetoRequest(assembled, session);
  return (
    <div {...consoleHostProps(session)}>
      <SandboxOpt
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(paretoRequest ? { paretoRequest } : {})}
      />
    </div>
  );
}
