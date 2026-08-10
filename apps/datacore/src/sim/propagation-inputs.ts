import type { PropagationRule } from "@platform/contracts";
import { resolveSimScope, type ResolvedSimScope } from "@platform/contracts";
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
 * 传导相的**唯一装配处**（WO-CERT-CONTRACT-RECONCILE 判据④）。
 *
 * ── 为什么必须只有一处 ────────────────────────────────────────────────────────
 * 传导核 `propagateTick` 是纯函数（R6），它算得对不对，**全看喂进去的四样东西对不对**：
 *   ① 图（对象 + 链路，且已按范围裁剪）② 传导规则 ③ 规则参数（coefficientRef 解析表）
 *   ④ 节拍闸门（E4）。
 * 这四样此前在 `app.ts` 里**装配了两遍** —— tick 路一遍、认证 Trial Tick 一遍。
 * 两份代码今天恰好等价，但那是**巧合不是机制**：任何一边加个过滤条件、改个 status、
 * 换个读回口，两条路就会**静默分家**，而两边的测试都仍然是绿的
 * （屏上「试算说能跑」与「真跑出来的数」对不上，且没有任何红灯——这正是本仓「绿测试≠能用·
 *  断在接缝」的标准形态）。
 *
 * ⚠ 判据是**同源**，不是「两处写得一样」：本函数是两条路的唯一入口，
 *   于是"改一处、两条路一起变"由**结构**保证，不靠人记得同步改两遍。
 *   接缝测试 `sim-cert-contract-reconcile.seam.test.ts` ④ 咬住这件事（变异反证：
 *   只要让任一路绕开本函数自己装配，该断言即红）。
 *
 * ── 本函数只做装配，不做判断 ──────────────────────────────────────────────────
 * 范围解释走契约唯一实现 `resolveSimScope`（GLOBAL 时 `scopePropagationGraph` 原样返回
 * 同一引用 `===`，旧行为逐字节不变 · RL9）；闸门只经 D1 声明的唯一读回口 `cadenceFromProps`
 * 还原，**不补默认**（EMPTY 行 / 周期不可整 tick ⇒ 不产生闸门，由引擎显式报缺，
 * 而不是悄悄按"随到随办"跑）。
 */
export interface PropagationInputs {
  /** 已按范围裁剪的传导图。 */
  graph: PropagationGraph;
  /** 范围回执（这一格是在什么范围下算的 · R-ARG-FIDELITY）。 */
  report: ScopeReport;
  /** 解析后的范围（调用方要判 unresolved 时用）。 */
  resolved: ResolvedSimScope;
  /** PUBLISHED 传导规则（= 本次可能触发的全集，也是 fired 的**分母**）。 */
  rules: PropagationRule[];
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
 * @param scopeRaw 原始范围口袋（tick 路传 `session.scope`；认证路传 `{kind,target,hops}`）——
 *   两者都经**同一个** `resolveSimScope` 解释，故「切 LOCAL 引擎只算局部」在两条路上同时成立。
 */
export async function buildPropagationInputs(
  repos: Repos,
  c: AuthCtx,
  scopeRaw: Record<string, unknown> | null | undefined,
): Promise<PropagationInputs> {
  // ① 物化图（走正门 R16/R4：从本体库读已物化对象 + 链路，任意行业；零硬编码）。
  const objects: PropagationGraph["objects"] = [];
  for (const t of await repos.ontologyTypes.list(c.tenantId)) {
    for (const o of await repos.objects.listByType(c.tenantId, t.key)) {
      if (!o.mergedInto) objects.push({ id: o.id, typeKey: o.type });
    }
  }
  const links = (await repos.links.list(c.tenantId)).map((l) => ({ fromId: l.fromId, toId: l.toId, linkKey: l.type }));

  // ② 范围裁剪（唯一实现 `resolveSimScope` + `scopePropagationGraph`）。
  const resolved = resolveSimScope(scopeRaw);
  const scoped = scopePropagationGraph({ objects, links }, resolved);

  // ③ 规则 + 规则参数（PUBLISHED 才可能触发）。
  const rules = await repos.sim.listPropagationRules(c.tenantId, true);
  const ruleParams: RuleParamLookup = {};
  for (const r of await repos.rules.list(c.tenantId, (x) => x.status === "PUBLISHED")) {
    if (r.params) ruleParams[r.key] = r.params;
  }

  // ④ 节拍闸门（E4）：从对象库现读 D1 落的 `Cadence` 行，经唯一读回口还原。
  const built = buildCadenceGates(
    (await repos.objects.listByType(c.tenantId, "Cadence"))
      .filter((o) => !o.mergedInto)
      .map((o) => ({ nodeId: String(o.props.nodeId ?? o.id), cadence: cadenceFromProps(o.props) })),
  );

  return {
    graph: scoped.graph,
    report: scoped.report,
    resolved,
    rules,
    ruleParams,
    cadenceGates: built.gates,
    gateSkipped: built.skipped,
  };
}
