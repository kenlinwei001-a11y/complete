/**
 * WO-CLOSE-SIM-ONTO-2 · **世界态版本**——推演页缓存键里缺的那一格（§8 `G-PARETO-WORLDSTATE-CACHE`）。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 * **X（修前·亲手复现）**：`SandboxOptRoute` 的装配查询键是
 * `["a","sim-pareto-assemble", sessionId]` —— **只认会话身份，不认这个会话现在是什么样**。
 * 而后端 `POST /a/v1/sim/optimize-pareto/assemble` 走
 * `SolverService.assembleParetoModel → buildWorldReadView(repos, ctx, sessionId)`，
 * 逐格读的就是**世界态**。
 *
 * **实测于 2026-09-09**（真后端 `SEED_DEMO=1` + 真浏览器从登录走起、禁 `VITE_MOCK`，
 * 会话 `sims_demo_seed_world`）。**复验方式**（任何人可重跑，两条命令）：
 * ```
 * PORT=4801 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> \
 *   node apps/datacore/dist/server.js
 * # 施扰动：POST /a/v1/sim/perturbations ×3（三基地 loadIndex→0），再
 * # POST /a/v1/sim/optimize-pareto/assemble {sessionId} 比对前后回包的 capacity
 * ```
 * 施三条 `loadIndex→0` 扰动（http 201×3）后同一条 assemble 回包里
 * `jiangmen 5879.216357 → 56500.941444`、`meishan 2642.394601 → 26982.916866`、
 * `xiamen 4599.803718 → 45258.402093`（13 条产线总 capacity `24838.238169 → 140459.083896`）
 * ⇒ **后端真的变了，而前端命中同一条缓存，屏上一格不动**。
 * 用户施完扰动看屏上没动，会得出「**这个杠杆没用**」这个**与事实相反**的结论 —— A 类错答。
 *
 * **Y（应该）**：装配结果的有效期是「**世界态没变**」，那就把世界态版本**写进键里**。
 * 世界变了 ⇒ 键变 ⇒ 重取；世界没变 ⇒ 键不变 ⇒ **照常命中缓存**。
 *
 * ══ ⛔ 为什么不许用「关掉缓存」当修法 ═══════════════════════════════════════════
 * `staleTime:0` / 每次 `refetch` 会让这一层每渲染一次就打一趟装配口，
 * 那是**把正确性问题换成性能问题**，而且换完还不解决问题的根：键仍然在说谎
 * （它宣称"同一个会话的装配结果都一样"，而这句话本来就不成立）。
 * 判据落在**对照实验第 2 行**：不施扰动时屏上值必须**稳定**，不许每次渲染都打穿缓存。
 *
 * ══ 版本从哪来 —— 取后端已有的两样，一样都不新造 ═══════════════════════════════
 * 世界态被改动的路**恰好两条**，各对应一个已经在跑的缓存：
 *  · **推拍** `POST …/tick` ⇒ 会话 `curTick` 进位。承载物 = `["a","sim-sessions"]`
 *    （`useConsoleSession` 已在用的同一条，列表项**自带 `curTick`**，实测 `curTick=3`）；
 *    `sim.tick_completed` 已订阅并失效 `sim-sessions`（`store/eventInvalidation.ts`）。
 *  · **施扰动** `POST …/perturbations` ⇒ 世界态当场被写，**而 `curTick` 一格不动**。
 *    承载物 = `["a","sim-perturbations", sessionId]`（`PerturbationTimeline` 已在用的同一条）；
 *    `sim.perturbation_created` 已订阅并失效它，**同标签页**还另有
 *    `SandboxView` 施加成功后的本地 `invalidateQueries` 兜着。
 *
 * ⚠ **只取 `curTick` 是不够的，这正是 §8 点名的坑**：「施扰动但不推拍」时 `curTick` 不动，
 * 光把它写进键，屏上照旧是旧数。两样**都要**，缺一条就还剩一半的病。
 *
 * ══ 为什么复用这两条键，而不是新开端点 ═════════════════════════════════════════
 * 两条键都 `staleTime: Infinity` 且**已有别的组件在用**：走同一条键 = 同一份缓存，
 * 于是本 hook 在沙盘各页之间**零额外请求**，并且**自动**继承那两条键既有的事件失效链路 ——
 * 不用在这里再订阅一遍事件（再订一遍就是第二套真相源，迟早与那边漂）。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSimPerturbations, fetchSimSessions } from "@/api/endpoints";

/**
 * 把一串扰动 id 折成定长摘要（FNV-1a 32 位，与本仓既有 `hash01` 同族）。
 *
 * 为什么要折：键会进 TanStack 的 hash、也会出现在 devtools 里，
 * 扰动多起来时整串 id 拼进去只是噪声。**折的是长度不是信息** ——
 * 摘要变了就一定是集合变了（这正是键需要的那半句）。
 */
function digest(parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const s of parts) {
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2f; // 分隔符：防 ["ab","c"] 与 ["a","bc"] 撞成同一个摘要
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 本会话**当前世界态**的版本串。
 *
 * @returns `undefined` = **还不知道**（两条依赖里至少一条没回来）。
 *   调用方必须据此**不发请求** —— 拿一个占位版本先取一次、回来再换真版本取第二次，
 *   等于开页两次装配，且第一份是用一个假版本缓存起来的（比不缓存更坏）。
 *   `sessionId` 为空时同样是 `undefined`：没有会话就没有世界，也就没有版本。
 */
export function useWorldStateVersion(sessionId: string | undefined): string | undefined {
  // 与 `useConsoleSession` 同键 ⇒ 同一份缓存、同一条 `sim.tick_completed` 失效链路。
  //
  // ⚠ **`enabled: false` 是刻意的：本 hook 只读这份缓存，一条列表请求都不自己发。**
  // 理由是一条既有接缝断言（`sandbox-host-wiring.seam` ④「显式给了 id 还去查会话列表」）——
  // 宿主拿到 `view.options.sessionId` 时**不发列表请求**是本仓明写的契约，
  // 我第一版让本 hook 无条件 `enabled: !!sessionId`，当场把那条门咬红了（**门先说话，不是我想起来的**）。
  //   · **自动态**：`useConsoleSession` 必须先拿到列表才解得出 `sessionId`
  //     ⇒ 到这里时列表**一定**已在缓存里 ⇒ `curTick` 拿得到。
  //   · **显式态**：列表从未被取 ⇒ `curTick` 拿不到 ⇒ 版本里记 `t?`（**据实说"不知道"**，
  //     不许拿 0 冒充）。此时"推拍导致装配变化"这一路由 `store/eventInvalidation.ts` 里
  //     `sim-world` 标签上挂着的 `["a","sim-pareto-assemble"]` 兜住 —— 两半正好互补，
  //     所以这里不需要为了拿一个 tick 去顶掉那条契约。
  const sessionsQ = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
  // 与 `PerturbationTimeline` 同键同参 ⇒ 同一份缓存、同一条 `sim.perturbation_created` 失效链路。
  const pertQ = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled: !!sessionId,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    if (!sessionId) return undefined;
    // **扰动集是必需的那一半**：它是"施扰动但不推拍"唯一的信号，拿不到就答"还不知道"。
    const perts = pertQ.data?.items;
    if (perts === undefined) return undefined;
    // tick 是**尽力而为**的那一半（见上 `enabled:false` 段）。拿不到就据实记 `t?` ——
    // ⛔ 不许拿 0 冒充：0 是一个**真的 tick 值**，用它冒充"不知道"会让 tick0 与未知态撞成同一条缓存。
    const tick = sessionsQ.data?.items.find((s) => s.id === sessionId)?.curTick;
    const ids = perts.map((p) => p.id).sort();
    return `${tick === undefined ? "t?" : `t${tick}`}·p${ids.length}·${digest(ids)}`;
  }, [sessionId, sessionsQ.data, pertQ.data]);
}
