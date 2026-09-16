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
  // ── WO-SIM-REAL-DATA §2 · A 档第 1 条（§3 valueRef 的活样本）────────────────────
  // 业务口径：应收压力 = 应收账款占授信额度的百分比（receivables / creditLimit × 100）。
  //   出处 = WO 工单 §5 已验证范本（实测 22.67）。`COALESCE(..., 0)` 兜除零/缺属性（陷阱 9）。
  // 对照真值：demo 某客户 receivables/creditLimit 实测算得 22.67（WO 实测值）。
  // 先乘后除（陷阱 3 定点 4 位）：`this.receivables * 100 / this.creditLimit`。
  // ⛔ 不 CLAMP：receivablePressure 在 STATE_VAR_DOMAINS 里（0–100 压力族），
  //   但超界由引擎按域夹（回执点名），式子只算原始百分比，不内联边界常数（R14/陷阱 6）。
  {
    specKey: "customer_receivable_pressure",
    targetType: "Customer",
    targetProp: "receivablePressure",
    formula: "COALESCE(this.receivables * 100 / this.creditLimit, 0)",
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

/**
 * WO-SIM-REAL-DATA §1 · 播种期**全量初算**（在 `seedDemoDerivationSpecs` 之后、
 * `seedDemoSimWorld` 之前调一次）。
 *
 * 病灶（WO 陷阱 2）：播种序列只 `compileSpecs` 入库，**全仓零个播种期 `recompute`** ——
 * 规格是编译了，但一格都不物化。活服务上「compiled 3 demo derivation specs」与
 * 「measuredCells 450」同时成立就是现场证据。而 `seedDemoSimWorld` 铺的世界快照是
 * 一次性取值（`o.props[v]`），晚了不回填 ⇒ 必须抢在世界播种**之前**把派生值灌进对象。
 *
 * 语义 = 全量初算，**不是** dryRun（dryRun 不落库，白跑）。`recompute` 是增量引擎：
 * 变更集空 ⇒ dirty 集空 ⇒ 一格不算（`ontology-core.ts` :400-470）。所以这里按
 * 「全量初算」惯用法（`ontology-core.test.ts` 的 full initial compute 模式）构造变更集：
 * **每条 ACTIVE 规格的每个 dep，一条 `{typeKey, prop, objectIds: 该类型全部对象}`**。
 * 引擎内部做反向闭包 + 拓扑序 + 级联，我们只负责把「所有源都变了」这一事实告诉它。
 *
 * 幂等 + R6：重播时对象 props 已是派生终值，`prev !== value` 不成立 ⇒ 只重写
 * derivation_value_runs（定值 epoch 语义由 `beginEpoch` 保证单调），对象值字节级一致。
 * 返回物化了派生值的对象数（`updatedObjects`）。
 */
export async function recomputeDemoDerivationsAtSeed(
  repos: Repos,
  ontologyCore: OntologyCoreService,
  ctx: AuthCtx,
): Promise<number> {
  const specs = await repos.derivationSpecs.list(ctx.tenantId, (s) => s.status === "ACTIVE");
  if (specs.length === 0) return 0; // 诚实零态：没规格就是没变更是，不是"算了 0 个对象"
  // dep 去重（同一 (typeKey,prop) 被多条规格引用时只取一次对象清单）。
  const depKeys = new Map<string, { typeKey: string; prop: string }>();
  for (const s of specs) {
    for (const d of s.deps) depKeys.set(`${d.typeKey}.${d.prop}`, { typeKey: d.typeKey, prop: d.prop });
  }
  // 每个 dep 类型取一次全对象 id（同类型多 prop 复用同一份清单，少扫几遍 repo）。
  const idsByType = new Map<string, string[]>();
  const objectIdsOf = async (typeKey: string): Promise<string[]> => {
    if (!idsByType.has(typeKey)) {
      idsByType.set(typeKey, (await repos.objects.listByType(ctx.tenantId, typeKey)).map((o) => o.id));
    }
    return idsByType.get(typeKey)!;
  };
  const changes = [];
  for (const d of depKeys.values()) {
    changes.push({ typeKey: d.typeKey, prop: d.prop, objectIds: await objectIdsOf(d.typeKey) });
  }
  const res = await ontologyCore.recompute(ctx, changes);
  return res.updatedObjects;
}
