import type { ResolvedSimScope } from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { cadenceFromProps } from "../synthetic/cadence.js";
import {
  buildCadenceGates,
  scopePropagationGraph,
  type CadenceGateLookup,
  type PropagationGraph,
  type RuleParamLookup,
  type ScopeReport,
} from "./propagation.js";

/**
 * 传导相入参的**唯一装配处**。
 *
 * ── 来历（两条工单先后各推了一半，合并单把它收成一份，功劳分开记）────────────────
 *  · `WO-SIM-ACT-CLOSE`（#152）先立了「单一装配处」这条纪律，并写下了下面那两段
 *    「为什么抽成一处」「为什么它必须吃 scope」的论证 —— 论证原文保留，别改写。
 *  · `WO-SIM-SCOPE-TRIAL`（#129/#130 `G-SIM-SCOPE-UNREAD`）让范围真正落到图物化这一步。
 *  · `WO-CERT-CONTRACT-RECONCILE` 只做了一件事：这个函数一度**存在两份**
 *    （`app.ts` 里一个闭包 + 本模块一个同名导出，两个 dev 并行各造一份）。
 *    收成一份时**取了各自更强的那一半**：语义取 `app.ts` 那份（排除 propRules 的性能判据 +
 *    调用方自己解析 scope），封装取本模块（提到 `app.ts` 之外）——
 *    因为只有装配代码**不在 `app.ts` 里**，那道结构门才能无条件地断言
 *    「`app.ts` 里出现任何一处装配 = 红」；留在 `app.ts` 里就只能退而求其次数「恰好一次」。
 *    门见 `apps/datacore/test/sim-cert-contract-reconcile.seam.test.ts` ④结构判据。
 *
 * 🔴 **为什么抽成一处**（欠账 #152 · `WO-SIM-ACT-CLOSE` 的结构性对策，不是为省行数）：
 * Trial Tick 若另抄一份装配，就会出现「就绪认证说这个世界能跑、真 tick 跑起来不是这个数」——
 * 两处输入不同源 = 第二套真相源，正是本仓「绿测试≠能用·断在接缝」的老形态。
 * 现在认证里那一跑与 `POST …/tick` 那一跑**吃的是同一份图、同一份参数、同一份闸门**。
 *
 * 🔴 **为什么它必须吃 `scope`**（欠账 #129/#130 `G-SIM-SCOPE-UNREAD` · `WO-SIM-SCOPE-TRIAL`）：
 * 范围裁剪的落点就是**图物化这一步**。把范围留在装配处之外（谁调用谁自己裁），
 * 等于把「唯一装配处」这条纪律当场作废 —— 少裁一处，那条路就悄悄退回全域，
 * 用户在屏上切了「局部推演」而引擎照样按 GLOBAL 全量算（静默错答，#129 的原样病样）。
 * 所以这两条纪律不是二选一：**单一装配处 ∧ 范围裁剪** 在这一个函数里同时成立。
 * · GLOBAL ⇒ `scopePropagationGraph` 原样返回**同一引用**（`===`），旧行为逐字节不变（RL9 可回退）；
 * · LOCAL ⇒ 只留根类型对象 + `hops` 跳邻域 + 两端都在范围内的边；范围拿不到 ⇒ 裁成空图，
 *   **绝不**退回 GLOBAL（「我算不出局部」与「局部等于全局」是两个命题）。
 *
 * ⚠ 刻意**不含** `propRules` 与 `pending`/`perturbations`：前者是"要不要走引擎"的判据（调用方先查、
 * 为空则整段装配都省掉，保住"无传导规则的租户零本体读"这条既有性能特征），后两者是逐调用方的时基状态。
 * ⇒ 因此 `propagationRulesDeclared` 的分母由**调用方**从它自己查到的那份规则表取，不从这里回带。
 */
export interface PropagationInputs {
  /** 已按范围裁剪的传导图。 */
  graph: PropagationGraph;
  /** 这一跑到底算了哪些对象/边、丢了多少、范围是不是根本拿不到（R-ARG-FIDELITY 诚实回执）。 */
  scopeReport: ScopeReport;
  /** coefficientRef 解析表（G-10 P1「改规则即改推演」）：PUBLISHED 规则 key → params。 */
  ruleParams: RuleParamLookup;
  /** 节拍闸门表（E4）：改 `Cadence.everyDays` 即改推演——每次现读，不缓存不写死。 */
  cadenceGates: CadenceGateLookup;
  /** 无法换算成整 tick 闸门而被跳过的节点（诚实报缺，不补默认）。 */
  gateSkipped: { nodeId: string; reason: string }[];
}

/**
 * 从库里现读并装配传导相的全部入参。
 *
 * @param scope **已解析**的范围（调用方走契约唯一实现 `resolveSimScope`，不在这里再写一套 if）。
 */
export async function buildPropagationInputs(
  repos: Repos,
  c: AuthCtx,
  scope: ResolvedSimScope,
): Promise<PropagationInputs> {
  // 物化图（走正门 R16/R4：从本体库读已物化对象 + 链路，任意行业；零硬编码）。
  const objects: PropagationGraph["objects"] = [];
  for (const t of await repos.ontologyTypes.list(c.tenantId)) {
    for (const o of await repos.objects.listByType(c.tenantId, t.key)) {
      if (!o.mergedInto) objects.push({ id: o.id, typeKey: o.type });
    }
  }
  const links = (await repos.links.list(c.tenantId)).map((l) => ({ fromId: l.fromId, toId: l.toId, linkKey: l.type }));
  // ── 会话/认证范围读端：裁剪就发生在这里，两条路（tick / Trial Tick）因此天然同口径 ──
  const scoped = scopePropagationGraph({ objects, links }, scope);
  // coefficientRef 解析表（G-10 P1「改规则即改推演」）：PUBLISHED 规则 key -> params。
  const ruleParams: RuleParamLookup = {};
  for (const r of await repos.rules.list(c.tenantId, (x) => x.status === "PUBLISHED")) {
    if (r.params) ruleParams[r.key] = r.params;
  }
  // 节拍闸门表（E4）：改 Cadence.everyDays 即改推演——闸门每次现读，不缓存不写死。
  // 只经 D1 声明的唯一读回口 `cadenceFromProps` 还原，**不补默认**：EMPTY 行 / 周期不可整 tick
  // 都进 skipped，不会变成闸门 —— 声明了它们的规则会被引擎显式报缺，而不是悄悄按"随到随办"跑。
  const built = buildCadenceGates(
    (await repos.objects.listByType(c.tenantId, "Cadence"))
      .filter((o) => !o.mergedInto)
      .map((o) => ({ nodeId: String(o.props.nodeId ?? o.id), cadence: cadenceFromProps(o.props) })),
  );
  return {
    graph: scoped.graph,
    scopeReport: scoped.report,
    ruleParams,
    cadenceGates: built.gates,
    gateSkipped: built.skipped,
  };
}
