/**
 * WO-WORLDSTATE-SURFACE · **统一世界态读取面** —— 白名单 + 注入器（机制本体）。
 *
 * ══ 今天的行为是 X，应该是 Y（开工实测原文）══════════════════════════════════════
 *
 * **X**：`compute()` 是**同步**函数，而 `repos.sim.getTickState` 是 async ⇒ 世界态结构上够不着；
 *   `SolverContext`（types.ts）39 个字段里没有世界态那一格；`loadContext`（service.ts:5714+）
 *   世界态命中 0（金丝雀：同函数 `repos.objects` 命中 11 ⇒ 量法有效）；
 *   `compute()` 的两个调用方（invoke:6398 / runWithParams:6214）都走 loadContext；
 *   全文件唯一 async 预注入器是时序那个（`injectYieldDiagnosisSeries`），不存在世界态注入器。
 *   ⇒ 走 compute 路的求解器不是「忘了读」世界态，是**没有口可以读**：
 *   同一租户施加任何扰动，`risk_timeline`（230KB）/ `portfolio`（92KB）等回包逐字节不变；
 *   金丝雀（量法自证）：`chain_loss_attribution` 传 sessionId 就变、不传就不变，
 *   同进程同一分钟只差一个 args 键 ⇒ 不变是求解器性质，不是实验假象。
 *
 * **Y（本文件）**：把「世界态读取面」做成求解器的**统一入参**（`SolverContext.world`），
 *   「真值口径 / 推演口径」变成一个开关（`args.worldId`），而不是两个求解器。
 *
 * ══ 三道闸（工单硬约束，缺一即回退到那个病）══════════════════════════════════════
 *  ① **白名单**：仅 `WORLD_AWARE_SOLVERS` 登记的求解器注入。台账/体检类（答「今天的事实
 *     是什么」的：审计/校验/目录）随推演变反而是错的 —— 机制必须够不着它们。
 *     全 63 个求解器的 worldAware 判定与理由见 `docs/AUDIT-worldstate-rollout.md`。
 *  ② **开关**：`args.worldId` 不给 ⇒ 一行都不执行 ⇒ 真值口径，与本单上线前**逐字节一致**
 *    （R6 最重要的兼容判据；无 Date.now / 无随机，叠加核遍历全排序）。
 *  ③ **不静默回落**（照 `finance_world_projection` 样板 —— 63 个里唯一把「我没有世界态」
 *     做成硬错误的）：
 *       · `worldId` 给了但会话不存在 / 属于别租户 ⇒ **404**（叠加核闸门，R2 暗发）；
 *       · `worldId` 给了但不是非空字符串 ⇒ **400**（不静默当没传 —— 静默会让调用方以为
 *         自己看的是推演口径，屏上却是真值口径，那正是这个病换个位置复发）；
 *       · 世界态为空 ⇒ 照样算（真值就是它此刻的全部事实），但 `worldState.disclosure.note`
 *         如实说「未发生世界隔离」（`impact-analysis.ts` 的诚实处置先例）。
 *
 * ══ R4 / R6 ════════════════════════════════════════════════════════════════════
 * R4：叠加只发生在 **ctx 副本**上（`overlayRows` 返回新数组/新 props），仓储行一个字节不动。
 * R6：叠加核全程排序遍历、无时钟无随机 ⇒ 同 (worldId, tick, args) 两跑字节一致。
 */
import { validationError } from "../errors.js";
import type { ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { buildSolverWorldOverlay } from "../sim/world-read.js";
import { str, type SolverContext } from "./types.js";

/**
 * **worldAware: true 的白名单**（solverKey → 一句理由）。
 *
 * 收录判据（工单约束 ②）：这个求解器答的是「**这次推演里**会怎样」，不是「今天的事实是什么」。
 * 每条理由必须能答出「世界态的哪一格会改变它读的哪一格」——答不出来的不收录，
 * 收进来就是把机制做成装饰品（白名单里有它、扰动来了照样不动，而屏上写着 worldAware）。
 *
 * 其余 60 个求解器的 true/false/判不了 判定：`docs/AUDIT-worldstate-rollout.md`。
 */
export const WORLD_AWARE_SOLVERS: Readonly<Record<string, string>> = {
  risk_timeline:
    "答「这次推演里风险曲线怎么走」：曲线由 Line.capacityDaily（空闲产能）与 Order.qty（需求）算出；" +
    "世界态 utilPressure→capacity↓、demandPressure→qty↑ 都在 demo 传导链上（demo_order_demand_pressure 等 4 条），不读世界态它就永远是真值口径。",
  capacity_forecast:
    "答「这次推演的产能还够不够」：需求基线 = Σ OPEN Order.qty（demandPressure 直达），供给 = 产线能力（loadIndex/utilPressure 占用）；" +
    "两端都被世界态改写，不读世界态则「需求 +20% 的推演」与「没推演」给出同一个 capWanP50。",
  affected_orders:
    "答「这次扰动波及哪些订单、延几天」：延迟判定吃 Order.qty 与基地空闲产能（Line.capacityDaily）；" +
    "世界态两端都在传导链上，不读世界态则「施加扰动」与「没施加」列出同一张波及表。",
};

/** 该求解器是否登记为世界态感知（供披露/审计复用同一份表，不另抄）。 */
export function worldAwareReason(solverKey: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(WORLD_AWARE_SOLVERS, solverKey)
    ? WORLD_AWARE_SOLVERS[solverKey]
    : undefined;
}

/**
 * ctx 里**已加载**的对象数组 → 本体类型 key（叠加核按类型统计披露）。
 *
 * ⚠ 与 `service.ts instancesByType` 是同一张映射：**新增 ctx 对象数组时两处一起加**，
 * 漏哪一处，哪一处就静默少一维（这里漏 ⇒ 那类对象不叠世界态；那边漏 ⇒ 对象约束少评一类）。
 * ⛔ optional 数组为 `undefined` 时**保持 undefined**（有的求解器区分「没载」与「空」，
 * 把 undefined 叠成 [] 会把「按需未加载」静默改成「查了是空的」——两个不同的诚实位）。
 */
const CTX_ARRAYS: ReadonlyArray<readonly [typeKey: string, get: (c: SolverContext) => ObjectInstance[] | undefined, set: (c: SolverContext, rows: ObjectInstance[]) => void]> = [
  ["Base", (c) => c.bases, (c, r) => { c.bases = r; }],
  ["Line", (c) => c.lines, (c, r) => { c.lines = r; }],
  ["Process", (c) => c.processes, (c, r) => { c.processes = r; }],
  ["Equipment", (c) => c.equipment, (c, r) => { c.equipment = r; }],
  ["MaintPlan", (c) => c.maintPlans, (c, r) => { c.maintPlans = r; }],
  ["Model", (c) => c.models, (c, r) => { c.models = r; }],
  ["Order", (c) => c.orders, (c, r) => { c.orders = r; }],
  ["Shipment", (c) => c.shipments, (c, r) => { c.shipments = r; }],
  ["Segment", (c) => c.segments, (c, r) => { c.segments = r; }],
  ["DataSourceHealth", (c) => c.dataHealth, (c, r) => { c.dataHealth = r; }],
  ["Material", (c) => c.materials, (c, r) => { c.materials = r; }],
  ["MaterialBatch", (c) => c.materialBatches, (c, r) => { c.materialBatches = r; }],
  ["Customer", (c) => c.customers, (c, r) => { c.customers = r; }],
  ["ARInvoice", (c) => c.arInvoices, (c, r) => { c.arInvoices = r; }],
  ["Certification", (c) => c.certifications, (c, r) => { c.certifications = r; }],
  ["EnergyMeter", (c) => c.energyMeters, (c, r) => { c.energyMeters = r; }],
  ["ChangeoverMatrix", (c) => c.changeoverMatrix, (c, r) => { c.changeoverMatrix = r; }],
  ["CapexProject", (c) => c.capexProjects, (c, r) => { c.capexProjects = r; }],
  ["PurchaseOrder", (c) => c.purchaseOrders, (c, r) => { c.purchaseOrders = r; }],
  ["Supplier", (c) => c.suppliers, (c, r) => { c.suppliers = r; }],
  ["CustomsClearance", (c) => c.customsClearances, (c, r) => { c.customsClearances = r; }],
  ["IncomingInspection", (c) => c.incomingInspections, (c, r) => { c.incomingInspections = r; }],
  ["CarbonFactor", (c) => c.carbonFactors, (c, r) => { c.carbonFactors = r; }],
  ["BOMHeader", (c) => c.bomHeaders, (c, r) => { c.bomHeaders = r; }],
  ["BOMDetail", (c) => c.bomDetails, (c, r) => { c.bomDetails = r; }],
  ["AdoptedMitigation", (c) => c.adoptedMitigations, (c, r) => { c.adoptedMitigations = r; }],
  ["InterBaseTransfer", (c) => c.interBaseTransfers, (c, r) => { c.interBaseTransfers = r; }],
  ["CapacityPool", (c) => c.capacityPools, (c, r) => { c.capacityPools = r; }],
];

/**
 * **世界态预注入器**（唯一挂载点：async 派发口 invoke / runWithParams，loadContext 之后 compute 之前）。
 *
 * 三道闸全过才会动 ctx：白名单 ⇒ 开关 ⇒ 404/400 硬错误。全过之后：
 * ctx 里**已加载**的每个对象数组被叠加核改写为世界态下的值（A6 行级过滤与 WO-69 列投影
 * 已在 loadContext 里作用过，叠加只缩放**已允许读取的**数值格，不会把被禁列叠回来）；
 * `c.world` 带上披露块，由派发口随回包 `worldState` 键下发。
 */
export async function applyWorldStateToContext(
  repos: Repos,
  tenantId: string,
  solverKey: string,
  args: Record<string, unknown>,
  c: SolverContext,
): Promise<void> {
  // 闸①：白名单 —— 机制只对登记的求解器生效（C 类台账/体检求解器够不着这个口）。
  if (worldAwareReason(solverKey) === undefined) return;
  // 闸②：开关 —— 不传 worldId ⇒ 真值口径（R6：与本单上线前逐字节一致，一行都不许执行）。
  if (args.worldId === undefined || args.worldId === null) return;
  const worldId = str(args.worldId);
  // 闸③a：给了但不是非空字符串 ⇒ 400，不静默当没传（静默 = 「以为在看推演、屏上是真值」）。
  if (worldId === "") {
    throw validationError(
      `${solverKey} 的 args.worldId 必须是非空字符串（收到 ${JSON.stringify(args.worldId)}）——` +
        "不静默当没传：静默会让调用方以为自己拿到的是推演口径，屏上却是真值口径。",
    );
  }
  // 闸③b：会话不存在/跨租户 ⇒ 404（叠加核闸门，与 finance_world_projection 同一个 notFound）。
  const overlay = await buildSolverWorldOverlay(repos, tenantId, worldId);

  for (const [typeKey, get, set] of CTX_ARRAYS) {
    const rows = get(c);
    if (rows === undefined) continue; // 按需未加载 ⇒ 保持 undefined（「没载」≠「空」）
    set(c, overlay.overlayRows(typeKey, rows));
  }
  const disclosure = overlay.disclosure();
  c.world = {
    worldId: overlay.worldId,
    tick: overlay.tick,
    source: overlay.source,
    objectsWithState: overlay.objectsWithState,
    cellsApplied: disclosure.cellsApplied,
    disclosure,
  };
}
