/**
 * WO-SIM-FE-HOST · 推演沙盘四页「当前会话 id」的**单一出处**。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y ═══════════════════════════════════════════
 *
 * **X（今天）**：四个适配层（`Sandbox{Home,Detail,Attr,Opt}Route.tsx`）确实读了
 * `view.options.sessionId` 并往下透，但**全仓没有任何地方往 `view.options` 里放这个值** ——
 * 实测：`grep -rn "sim-console\|sim-conduction\|sim-attribution\|sim-optimize"`
 * 在 `apps/datacore/src` · `apps/agentcore/src` · `packages/contracts/src` 三处**零命中**
 * （金丝雀：同一条命令对确定存在的 `sim-sandbox` 有命中 ⇒ 工具没坏），
 * 即后端 workspace 从不下发这四个 viewKey，`view.options` 恒为 `undefined`。
 * 于是 `sessionId` 恒 `undefined` ⇒ 四页的取数 hook 全部 `enabled:false` ⇒ 一律落占位。
 *
 * **Y（应该）**：宿主没拿到显式指定时，应当**自己去查**本租户最近一条 RUNNING 会话，
 * 查到就把它透下去（四页随即真发请求、诚实位翻 `"endpoint"`）；查不到就**如实报**
 * 「没有会话」并保留占位 —— 而**不是**顺手建一个。
 *
 * ══ 为什么「不许自动新建会话」是硬约束 ═════════════════════════════════════
 *
 * `POST /a/v1/sim/sessions` 是**写操作**（建一个世界、落库、发 `sim.session_created`）。
 * 「用户打开了一个页面」不构成建世界的授权 —— 一个只读的看板一刷新就往库里塞一条记录，
 * 是最难查的那种副作用。所以本 hook **一个 POST 都不发**，连 `createSimSession` 都不 import
 * （import 了就迟早有人在这里调它）。没有会话时的正确行为是**说出来**，不是**造一个**。
 *
 * ══ 诚实位走属性不走屏上文字 ═══════════════════════════════════════════════
 *
 * 四页的验收线是**像素级 1:1**（`docs/ux-spec/sandbox/*.html`），屏上多一行字就作废。
 * 故「有没有会话」这件事与既有的 `data-source` 同族，走 **`data-session-reason` 属性**
 * 挂在适配层的包裹元素上（`display:contents` ⇒ 不生成盒，版面零影响）。
 * 判据据此可分辨两件**完全不同**的事：
 *   · `data-session-reason="no-running-session"` + `data-source="placeholder"` = **没有会话**
 *   · `data-session-reason="auto"|"explicit"`    + `data-source="placeholder"` = **有会话但这一格没数据**
 * 只看 `data-source` 是分不出来的 —— 那正是本单要消除的歧义。
 */
import { useQuery } from "@tanstack/react-query";
import type { SimSession } from "@platform/contracts";
import { fetchSimSessions } from "@/api/endpoints";

/**
 * 会话从哪来 / 为什么没有。**五态互斥**，不许合并成一个布尔。
 *
 * · `explicit`           宿主在 `view.options.sessionId` 里显式指定 ⇒ **优先级最高**，不再去查列表；
 * · `auto`               列表里挑出的最近一条 RUNNING；
 * · `loading`            列表还在路上（此刻没有会话是**暂时**的，不该被读成"没有会话"）；
 * · `no-running-session` 列表回来了，但**一条 RUNNING 都没有** ⇒ 真的没有世界可推演；
 * · `unavailable`        列表这一跳自己失败了（404 / 500 / 网络）⇒ **不知道**有没有会话。
 *
 * ⚠ 后三态**处置不同**，混成一个 `sessionId === undefined` 就丢掉了这个区别：
 * `no-running-session` 该引导用户去建世界，`unavailable` 该提示重试，`loading` 什么都不该说。
 */
export type ConsoleSessionReason = "explicit" | "auto" | "loading" | "no-running-session" | "unavailable";

export interface ConsoleSession {
  /** 当前推演会话 id。`undefined` = 四页照旧落占位（不是"传个空串下去让它发 404"）。 */
  sessionId?: string;
  reason: ConsoleSessionReason;
  isLoading: boolean;
}

/** 宿主可能塞进 `view.options` 的业务参数（本层只认 `sessionId`，其余各 Route 自取）。 */
export interface ConsoleViewOptions {
  sessionId?: unknown;
}

/**
 * 挑「最近一条 RUNNING」。
 *
 * 排序键是 `createdAt`（ISO 串，字典序即时间序）。**同 `createdAt` 时取列表里靠后的那条**
 * —— 后端 `GET /a/v1/sim/sessions` 按插入序返回，靠后 = 后建的。写成 `>=` 而不是 `>`
 * 就是这个意思，别"优化"成 `>`：那会在时间戳撞车时静默改成"取先建的那条"。
 *
 * 只认 `RUNNING`：`DRAFT`/`READY` 是还没跑起来的空壳（取数回来是空的，比占位更难看），
 * `PAUSED`/`ENDED` 是历史世界（拿它冒充"当前"会让屏上的数与用户正在推的那个世界对不上）。
 */
export function pickLatestRunningSession(items: readonly SimSession[]): SimSession | undefined {
  let best: SimSession | undefined;
  for (const s of items) {
    if (s.status !== "RUNNING") continue;
    if (best === undefined || s.createdAt >= best.createdAt) best = s;
  }
  return best;
}

/**
 * 四页共用的会话获取口。**唯一新增逻辑**，四个适配层都只调它、不各写一份。
 *
 * @param options `view.options`（视图配置里的 renderer 专属参数）。
 *
 * 取值顺序：显式 → 自动查最近 RUNNING → 没有。
 * 显式给了就**不发列表请求**（`enabled:false`）—— 既省一跳，也让"请求打的是显式那个 id"
 * 这件事可被测试直接断言（列表请求一条都没有，剩下的请求全指向显式 id）。
 *
 * 缓存键刻意复用 `["a","sim-sessions"]`：与 `SandboxView` / `EdgeActivePanel` 同一份缓存，
 * 于是 `sim.session_created` / `sim.branched` / `sim.tick_completed` 三个事件的失效链路
 * （`store/eventInvalidation.ts` 的 `EVENT_INVALIDATES`）**自动**把本 hook 也带上 ——
 * 别人建了个世界，这四页刷新即可见，不用在这里再接一遍事件。
 */
export function useConsoleSession(options?: ConsoleViewOptions): ConsoleSession {
  const raw = options?.sessionId;
  const explicit = typeof raw === "string" && raw !== "" ? raw : undefined;

  const q = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    enabled: explicit === undefined,
    staleTime: Infinity,
    // 失败**不重试**：拿不到列表时正确的行为是如实报 `unavailable` 并落占位，
    // 不是把一条打不通的路反复打三遍再落占位（那只是把同一个结论晚 3 个 RTT 给出来）。
    retry: false,
  });

  if (explicit !== undefined) return { sessionId: explicit, reason: "explicit", isLoading: false };
  if (q.isLoading) return { reason: "loading", isLoading: true };
  if (q.data === undefined) return { reason: "unavailable", isLoading: false };

  const picked = pickLatestRunningSession(q.data.items);
  if (picked === undefined) return { reason: "no-running-session", isLoading: false };
  return { sessionId: picked.id, reason: "auto", isLoading: false };
}

/** `consoleHostProps()` 的返回形状（四个适配层的包裹元素属性）。 */
export interface ConsoleHostProps {
  "data-testid": "sandbox-console-host";
  "data-session-reason": ConsoleSessionReason;
  /** 真正透下去的那个 id（没有则空串）。测试据此断言"透下去的是显式那个，不是自动查到的那个"。 */
  "data-session-id": string;
  style: { display: "contents" };
}

/**
 * 四个适配层包裹元素的属性。**一份实现，四处共用** —— 各抄一份就会漂
 * （改了 reason 的枚举而某一页的包裹元素还写着旧属性名，这类漂移类型系统看不见）。
 *
 * `display:contents` 是刻意的：包裹元素**不生成盒**，页面根仍然直接参与父级布局 ⇒
 * 四页的像素级 1:1 逐字节不受影响（这是"加一层宿主"唯一能做到零版面代价的写法）。
 */
export function consoleHostProps(s: ConsoleSession): ConsoleHostProps {
  return {
    "data-testid": "sandbox-console-host",
    "data-session-reason": s.reason,
    "data-session-id": s.sessionId ?? "",
    style: { display: "contents" },
  };
}
