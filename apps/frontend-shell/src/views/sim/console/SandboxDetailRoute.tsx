/**
 * 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由。
 *
 * ── WO-SIM-FE-HOST 改了两处 ─────────────────────────────────────────────────
 * ① `sessionId` 不再只从 `view.options` 取（那里恒空，见 `useConsoleSession` 文件头），
 *    没显式指定就自己查最近一条 RUNNING 会话。
 * ② 补透 `impactChange` / `mitigation` 两个入参 —— 但**只从宿主取，不在这里兜底造**。
 *
 * ── WO-SIM-DETAIL-WIRE：把 ② 那句「只从宿主取」落到实处 ─────────────────────
 *
 * **X（2026-08-22 改造前实测）**：`impactChange` / `mitigation` 只从 `view.options` 取，而后端
 * workspace 下发的那四个 view 对象**没有 `options` 这一格**（今天仍如此；逐条复验命令与
 * 「viewKey 已下发、options 仍缺」这一形态的订正，见 `useConsoleSession` 文件头 2026-08-23 那段）
 * ⇒ 两者恒 `undefined` ⇒ `useImpactCone`（`ImpactCone.tsx` 的 `enabled = worldId !== "" && change !== undefined`）
 * 与 `useMitigationCards`（`StrategyCards.tsx` 的 `enabled = args !== undefined && …`）
 * 恒 `enabled:false` ⇒ 影响半径扇区与应对策略栈**连请求都不发**。
 * （两处**刻意不写行号** —— 行号会漂；用 `grep -n 'const enabled' <文件>` 现找那一行。）
 * 前一版注释自己写着「页面开了口，宿主没往里送值」—— 认了账，没修。
 * 同族第三格：`nodeId` 同样恒空，而 `node-detail` 端点要它 ⇒ 那一跳恒 400（见 `SandboxDetail.tsx`）。
 *
 * **Y（应该）**：宿主**自己去解析**，且每个默认值都得有出处 —— 只许从**本租户自己的数据**
 * 派生（会话自己的扰动 / 世界里的对象 / 已注册求解器的输出），
 * ⛔ 不许硬写业务常数（R14），⛔ 不许编一个假参数骗 hook 发请求。
 * 解析不出 ⇒ **这一跳不发**，保留占位，并把「为什么没解析出来」写进 `data-*` 诚实位。
 *
 * ── 三个默认值的口径（选了什么、为什么）══════════════════════════════════════
 *
 * | 入参 | 出处 | 口径 | 解析不出时 |
 * |---|---|---|---|
 * | `nodeId` | `POST /a/v1/sim/chain-loss-matrix` | 矩阵的**首个环节** `heat.nodes[0]` | 不发 `node-detail` |
 * | `impactChange` | `GET …/:id/perturbations` × `GET …/:id/world` × `GET /a/v1/sim/view-config` | 本会话**最近一条扰动**的落点 + 世界里的**实测现值** | 不发 `impact-analysis` |
 * | `mitigation` | 求解器 `bottleneck_matrix` | **张力最高的基地** × 该基地的 `primary` 因素 | 不发 `mitigation_select` |
 *
 * · **`nodeId` 为什么取 `heat.nodes[0]` 而不是"损失最大的那个"**：损失归因台
 *   （`SandboxAttr.tsx:74`）的缺省落点就是 `selectedNodeId ?? heat.nodes[0]?.nodeId ?? null`。
 *   两页钻的是**同一条链**，缺省落点必须同源同序 —— 这里另算一个"最大的"就是第二份口径，
 *   于是同一租户在页2 和页3 上看到的"默认在看哪个环节"会**安静地不一样**。
 *   矩阵本身按 `CHAIN_STAGES` 顺序返回节点（`chain-loss-matrix.ts:169`），故 `[0]` = 链头，确定性。
 *   矩阵这一跳**没通**（`source !== "endpoint"`）⇒ 不拿占位表里的节点冒充落点。
 *
 * · **`impactChange` 为什么必须来自扰动**：`ImpactChange` 的语义是「**改了什么**」。
 *   世界里没有人改过任何东西时，"影响半径"这个问题就没有起点 —— 此时随便挑个对象凑一个
 *   `{objectType, objectId, prop, value}` 去发请求，屏上会出现一个**确凿的假半径**。
 *   故落点取本会话**真实施加过**的那条扰动（`targetObjectId` / `targetStateVar`），
 *   `value` 取**世界里的实测现值**（`GET …/world`）而不是按 `magnitude`/`mode` 自己再算一遍
 *   —— 自己算就是第二套真相源，且引擎还会做上下限规整，算出来的值会与世界里的悄悄不相等
 *   （同一条纪律见 `SandboxView.tsx` 的 `lastPerturbation.anchor` 注释）。
 *   `objectType` 由 `view-config.nodeObjectIds`（每 nodeType → 真物化对象 id，与 tick 引擎同源）
 *   反查得到；查不到类型 ⇒ 不发（传播闭包必空，那是"找不到起点"不是"没影响"）。
 *
 * · **`mitigation` 为什么取 `bottleneck_matrix` 的最紧那格**：应对策略要答的是「在哪个基地
 *   防哪类风险」。这两个值全平台唯一的真出处就是瓶颈矩阵（基地 × 风险因素 → 张力），
 *   风险看板 `RiskBoardView.tsx:1884` 喂 `mitigation_select` 的也是这一对。
 *   取**张力最高的基地 × 该基地自己的 `primary` 因素** = 「此刻最该处置的那一格」，确定性排序。
 *   ⚠ **刻意不把矩阵里的 `tightness` 一起传下去**：`mitigation_select` 的引擎侧
 *   （`solvers/extended.ts:1276`）会按 (基地, 因素) 现算**真张力**并披露 `dataMode`(LIVE/MOCK)，
 *   而调用方一旦直传 `tightness`，引擎就以调用方为准且**不再出 `dataMode`** ⇒ 屏上那份紧张度
 *   失去"实测还是估算"的凭证。让引擎自己派生，是把凭证留在数据侧。
 *
 * ── 诚实位一律走属性（屏上零新增文字·本页验收线是像素级 1:1）─────────────────
 * 沿用本目录既有属性族（`data-source` / `data-session-reason`），本层新增三条
 * `data-*-source`，挂在 `display:contents` 的包裹元素上 ⇒ 不生成盒、版面零影响。
 *
 * ⚠ **上面这句「屏上零新增文字」的适用范围今天缩小了一次，照实回写（WO-EDGE-PANEL-4PAGES）**：
 * 它当时描述的是 `WO-SIM-DETAIL-WIRE` 那一批改动（参数解析），那批确实屏上一个字没多，
 * 这句话对**那批**仍然成立。但本单**新增了画布外的一条折叠抽屉**，屏上多了一条 26px 的标题条
 * —— 仓主对本单的原话是「**挂，并接受版面变化**」，即像素级 1:1 那条验收线在**本处**已被
 * 显式作废，规格 HTML 与基准 PNG 同批已改（`sandbox-detail.html` 的 `.dock` 段）。
 *
 * ── WO-EDGE-PANEL-4PAGES：今天的行为是 X，应该是 Y（四页同一笔账）─────────────
 * **X**：本页（`sim-conduction`）在现算名册里（R3 nav-sim-group），却零个 `EdgeActivePanel`
 * 挂载点（注释里一律写裸名，理由见 `SandboxHomeRoute.tsx` 的同段 ⚠）
 * ⇒ 在传导识别页上做不了「关掉这条传导边看看」——**这一页恰恰就是讲传导的那一页**，
 * 缺得最刺眼。**Y**：挂上，且挂在默认导出的主组件里。
 * 版面取舍见 `SandboxHomeRoute.tsx` 的同名段（画布外 · 紧贴其下 · 默认折叠）。
 */
import { useQuery } from "@tanstack/react-query";
import {
  BottleneckMatrixOutputSchema,
  type BottleneckMatrixOutput,
  type ImpactChange,
  type Perturbation,
  type SandboxViewConfig,
  type TickState,
} from "@platform/contracts";
import { fetchSimPerturbations, fetchSimViewConfig, invokeSolver, simWorld } from "@/api/endpoints";
import type { ViewRendererProps } from "@/views/registry";
import EdgeActivePanel from "../EdgeActivePanel";
import { SandboxDetail } from "./SandboxDetail";
import css from "./SandboxDetail.module.css";
import type { MitigationArgs } from "./StrategyCards";
import { useChainLossMatrix } from "./useLossAttribution";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

/** 每个默认入参「从哪来 / 为什么没有」。**互斥**，不许塌成一个布尔。 */
export type ArgSource =
  | "explicit" // 宿主在 view.options 里显式给了
  | "derived" // 从本租户数据解析出来了
  | "unavailable"; // 解析不出 ⇒ 这一跳不发

/**
 * 本会话**最近一条**扰动。
 *
 * ── 排序键为什么是 `createdAt` 而不是 `startTick`（真跑时撞出来的）─────────────
 * 端点自述按 `startTick → id` 稳定排序。照它取"最后一条"在**同一 tick 里连下三条扰动**时
 * 会退化成按 `id` 字典序 —— 而 `id` 是 `newId()` 的 randomBytes，**与先后毫无关系**
 * （实测：同 tick 三条扰动，id 最大的是第二条下的那一条）。
 * 「最近一条」问的是**谁最后被下达**，那是 `createdAt`。`startTick`/`id` 只当同秒兜底，
 * 保证**全序**（R6：同一份清单每次都挑出同一条，且不靠后端返回顺序）。
 *
 * ⚠ 未生效的未来扰动（`startTick > curTick`）本函数**不过滤**，由下游的
 * `deriveImpactChange` 兜住：它要求世界态里真有那一格读数，而未生效的扰动没在世界上留下读数。
 * 「还没发生的事」因此不会被当成「改了什么」。
 */
export function pickLatestPerturbation(items: readonly Perturbation[]): Perturbation | undefined {
  const rank = (p: Perturbation): [string, number, string] => [p.createdAt, p.startTick, p.id];
  let best: Perturbation | undefined;
  for (const p of items) {
    if (best === undefined) {
      best = p;
      continue;
    }
    const [ca, sa, ia] = rank(p);
    const [cb, sb, ib] = rank(best);
    if (ca > cb || (ca === cb && (sa > sb || (sa === sb && ia > ib)))) best = p;
  }
  return best;
}

/** `objectId` → 它的 nodeType（`view-config.nodeObjectIds` 的反查）。 */
export function objectTypeOf(cfg: SandboxViewConfig | undefined, objectId: string): string | undefined {
  // `nodeObjectIds` 在契约里是 optional（老 config 没有这一格）——缺它就是**解析不出类型**，
  // 不是"类型是空串"。回 undefined ⇒ 上层不发请求。
  const byType = cfg?.nodeObjectIds;
  if (byType === undefined) return undefined;
  for (const typeKey of Object.keys(byType).sort()) {
    if ((byType[typeKey] ?? []).includes(objectId)) return typeKey;
  }
  return undefined;
}

/**
 * 扰动 + 世界态 + 本体类型 → 一处变更。**三样缺一就 `undefined`**（= 不发请求）。
 * `value` 只认世界里那个数：世界态里没有这一格 ⇒ 说明这条扰动今天没在世界上留下读数，
 * 此时凭 `magnitude` 现算一个填进去，就是拿"我以为的"冒充"世界里的"。
 */
export function deriveImpactChange(
  p: Perturbation | undefined,
  world: TickState | undefined,
  cfg: SandboxViewConfig | undefined,
): ImpactChange | undefined {
  if (p === undefined || world === undefined) return undefined;
  const objectType = objectTypeOf(cfg, p.targetObjectId);
  if (objectType === undefined) return undefined;
  const value = world[p.targetObjectId]?.[p.targetStateVar];
  if (value === undefined) return undefined;
  return { objectType, objectId: p.targetObjectId, prop: p.targetStateVar, value };
}

/**
 * 瓶颈矩阵 → 「在哪个基地防哪类风险」。取**张力最高的基地 × 它自己的 `primary` 因素**；
 * 张力并列时按基地名升序（R6 全序，同输入同输出）。
 * 某行的 `primary` 在 `tightness` 里没有读数 ⇒ 跳过该行（**不拿 0 顶替**：
 * "没这个读数"与"张力是 0"是两件事）。
 */
export function deriveMitigation(bn: BottleneckMatrixOutput | undefined): MitigationArgs | undefined {
  if (bn === undefined) return undefined;
  let best: { base: string; factor: string; value: number } | undefined;
  for (const r of bn.rows) {
    const value = r.tightness[r.primary];
    if (typeof value !== "number" || r.base === "" || r.primary === "") continue;
    const better =
      best === undefined || value > best.value || (value === best.value && r.base.localeCompare(best.base) < 0);
    if (better) best = { base: r.base, factor: r.primary, value };
  }
  // ⚠ `tightness` 刻意不下传：让引擎按 (基地,因素) 现算并披露 dataMode（见文件头）。
  return best === undefined ? undefined : { baseName: best.base, factor: best.factor };
}

export default function SandboxDetailRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as {
    sessionId?: string;
    nodeId?: string;
    impactChange?: ImpactChange;
    mitigation?: MitigationArgs;
  };
  const session = useConsoleSession(p);
  const sid = session.sessionId ?? "";

  // ── ① 落点节点：与损失归因台同源同序（`SandboxAttr.tsx:74`）──────────────────
  const heat = useChainLossMatrix();
  const derivedNodeId = heat.source === "endpoint" ? heat.nodes[0]?.nodeId : undefined;
  const nodeId = p.nodeId ?? derivedNodeId;
  const nodeSource: ArgSource = p.nodeId !== undefined ? "explicit" : nodeId === undefined ? "unavailable" : "derived";

  // ── ② 一处变更：本会话真实施加过的那条扰动 ──────────────────────────────────
  const perturbations = useQuery({
    queryKey: ["a", "sim-perturbations", sid],
    enabled: p.impactChange === undefined && sid !== "",
    retry: false,
    queryFn: () => fetchSimPerturbations(sid),
  });
  const latest = pickLatestPerturbation(perturbations.data?.items ?? []);
  // 后两跳**挂在扰动存在之上**：没有扰动就没有"改了什么"，这两条请求一个都不必发。
  const world = useQuery({
    queryKey: ["a", "sim-world", sid],
    enabled: latest !== undefined && sid !== "",
    retry: false,
    queryFn: () => simWorld(sid),
  });
  // 缓存键与 `SandboxView` / `ProcessCanvasView` 共用同一份（`["a","sim","view-config"]`）——
  // 别的沙盘页刚开过就直接命中，不多打一跳。
  const viewConfig = useQuery({
    queryKey: ["a", "sim", "view-config"],
    enabled: latest !== undefined,
    retry: false,
    queryFn: fetchSimViewConfig,
  });
  const derivedChange = deriveImpactChange(latest, world.data?.state, viewConfig.data);
  const impactChange = p.impactChange ?? derivedChange;
  const impactSource: ArgSource =
    p.impactChange !== undefined ? "explicit" : impactChange === undefined ? "unavailable" : "derived";

  // ── ③ 处置口径：瓶颈矩阵里最紧的那一格 ──────────────────────────────────────
  const bottleneck = useQuery({
    queryKey: ["a", "bottleneck_matrix", "sandbox-detail"],
    enabled: p.mitigation === undefined,
    retry: false,
    queryFn: async () => {
      const res = await invokeSolver("bottleneck_matrix", { dataMode: "LIVE" });
      // 形状对不上 ⇒ 解析不出这一对 ⇒ 不发 `mitigation_select`（`as` 会把一个陌生形状
      // 一路带到 `r.tightness[r.primary]` 上，在渲染里炸；本页的失败态该是占位不是白屏）。
      return BottleneckMatrixOutputSchema.safeParse(res.data);
    },
  });
  const derivedMitigation = deriveMitigation(
    bottleneck.data?.success === true ? bottleneck.data.data : undefined,
  );
  const mitigation = p.mitigation ?? derivedMitigation;
  const mitigationSource: ArgSource =
    p.mitigation !== undefined ? "explicit" : mitigation === undefined ? "unavailable" : "derived";

  return (
    <div
      {...consoleHostProps(session)}
      data-node-id={nodeId ?? ""}
      data-node-source={nodeSource}
      data-impact-change-source={impactSource}
      data-mitigation-source={mitigationSource}
    >
      <SandboxDetail
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(nodeId === undefined ? {} : { nodeId })}
        {...(impactChange === undefined ? {} : { impactChange })}
        {...(mitigation === undefined ? {} : { mitigation })}
      />
      {/* WO-EDGE-PANEL-4PAGES 挂载点：**主组件里**、不在 `impactChange && …` 那类条件之下
          —— 挂进条件里就是「没解析出扰动就看不见开关」，正是本门拦的那个形态。 */}
      <details className={css.dock} data-testid="sim-conduction-edge-dock">
        <summary className={css.dockSum} data-testid="sim-conduction-edge-summary">
          关掉一条传导边，看这次推演的数怎么变 ▸
        </summary>
        <EdgeActivePanel pageKey="sim-conduction" sessionId={session.sessionId} />
      </details>
    </div>
  );
}
