/**
 * WO-SLICE-DERIV-EMPTY · demo 派生溯源规格种子（本体 §8 `G-DERIVSPEC-EMPTY`）。
 *
 * 病灶：`derivation_specs` 实测 ACTIVE **0 条** —— `ontologyCore.compileSpecs` 的唯一 src
 * 调用方是 REST 端点 `POST /a/v1/ontology/derivation-specs/compile`，**没有任何种子路径调它**
 * ⇒ 十六层 ⑭证据层的「派生 inputs 快照来源」那一半永远取不到。形态 = 接了线没数据
 * （消费方 `slice-layers.ts` ⑭ / sim `change-impact.ts` / `impact-analysis.ts` /
 * `solvers/service.ts` discoverLevers 全在，输入恒空），修法 = 补数据，不是删死分支。
 *
 * 挂载点选择：`apps/datacore/src/seed.ts` 是另一条在途单的改动面（本单 🚦 不碰），
 * 故挂在 `server.ts` / `seed-cli.ts` 的既有播撒序列尾部（两条路径必须同步 —— seed-cli.ts
 * 头注自己警告过「两条播种路径漂了就会只在某些机器上复现」）。
 *
 * 公式口径（诚实声明，不许含糊）：电池模板的 `derivedProperties` 用的是**另一种方言**
 * （裸标识符 + `COUNT(Order.so BY bases)` 聚合），与原子规格 §2 DSL（`this.x` + `out(L)`/`in(L)`
 * 单跳导航）**不互通** —— `parseFormula` 会把裸标识符当非法 token 拒掉。因此本种子只
 * 镜像**自属性公式**（语义 1:1，可机械翻译）；聚合法言的（`BY xxx`）需要链路映射，不做
 * 机械翻译（翻了就是编造口径），留待后续单显式声明。
 *
 * 幂等 + R6：compileSpecs 按 `dspec_<specKey>` 定值 id upsert，重播字节级一致；
 * 公式输入属性全部实测存在于电池模板（qty/unitPrice/qtyOnHand/qtyReserved/dispatchDay/transitDays）。
 */
import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OntologyCoreService } from "./ontology-core.js";
import type { OntologyGovernanceService } from "./ontology-governance.js";

/** demo 派生规格集：与电池模板 derivedProperties 同语义、§2 DSL 方言（自属性公式，1:1 镜像）。 */
export const DEMO_DERIVATION_SPECS: readonly {
  specKey: string;
  targetType: string;
  targetProp: string;
  formula: string;
}[] = [
  // battery.ts orderDerived：value = qty * unitPrice
  { specKey: "order_value", targetType: "Order", targetProp: "value", formula: "this.qty * this.unitPrice" },
  // battery.ts finishedGoodsInvDerived：qtyAvailable = qtyOnHand − qtyReserved
  {
    specKey: "fgi_qty_available",
    targetType: "FinishedGoodsInventory",
    targetProp: "qtyAvailable",
    formula: "this.qtyOnHand - this.qtyReserved",
  },
  // battery.ts interBaseTransferDerived：etaDay = dispatchDay + transitDays
  {
    specKey: "ibt_eta_day",
    targetType: "InterBaseTransfer",
    targetProp: "etaDay",
    formula: "this.dispatchDay + this.transitDays",
  },
];

/**
 * 编译 demo 派生规格入库（ACTIVE），并同步 §7.4 element_refs 引用索引（与 REST 编译路由同序）。
 * 返回编译入库的规格条数。幂等：重播覆盖同 id 记录。
 */
export async function seedDemoDerivationSpecs(
  repos: Repos,
  ontologyCore: OntologyCoreService,
  governance: OntologyGovernanceService,
  ctx: AuthCtx,
): Promise<number> {
  const versions = await repos.ontologyVersions.list(ctx.tenantId);
  const ontologyVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
  const out = await ontologyCore.compileSpecs(ctx, ontologyVersion, [...DEMO_DERIVATION_SPECS]);
  // §7.4：派生规格 deps 引用同步入库 element_refs（与 app.ts 编译路由同一动作，两条产径不漂）。
  for (const s of out.specs) await governance.indexDerivationRefs(ctx, s.specKey, s.targetType, s.deps);
  return out.specs.length;
}
