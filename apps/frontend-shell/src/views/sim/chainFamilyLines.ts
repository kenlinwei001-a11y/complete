/**
 * WO-SANDBOX-METRO-SEMANTICS · **三条产品族线的锚点发现**（纯派生 + 一次对象查询）。
 *
 * ⚠ WO-CHAIN-MAP-LAYOUT 起，族线在图上是**上下并排的三条横线**（不再是三圈同心环）——
 *   本文件只管「三条线的数据依据是什么」，与画成环还是画成横线无关，故一行未动。
 *   `ringIndex` / `ringCount` 这两个名字保留（它们表达的是"第几条 / 共几条"，不是"第几圈"）。
 *
 * ── 这个文件回答一个问题：三条族线的数据依据在哪 ──────────────────────────────
 * 设计稿把「三条产品族线」画成三圈同心环，但它是**写死**的三条线。
 * 后端这边先要过一道事实关：`chain_loss_attribution` **不吃 `businessTypes` / `modelIds`**
 * （实测：传 `baseIds` 结果逐字节不变，另两维在 `chain_impediments` 上直接 400）。
 * 于是"按产品族分三条链"这件事，**不能**靠给求解器加一个 scope 维度来做。
 *
 * 但它**能**做 —— 走另一条真路：该求解器认 `so`（锚点订单），而**订单自带 `businessType`**。
 * 每个业务类型取一张真实订单当锚点，各调一次求解器 ⇒ 三条**真的不一样**的链。
 *
 * ── 实测证据（本文件存在的全部理由，不是推测）────────────────────────────────
 * 于 demo 租户 seed 42 亲手跑（`POST /b/v1/solvers/chain_loss_attribution/run`）：
 *   passenger  SO-3391 · 4680-NCM · hefei   · leadTime 79.389D · top3 含 capacity.aging 6.39%
 *   commercial SO-3437 · 2170-NCM · wuhan   · leadTime **80.389D** · top3 含 supplier_leadtime **7.58%**
 *   storage    SO-3452 · 方形-LFP · meishan · leadTime 79.389D
 * 三条链的 **totals / 归因排序 / 节点 scope.modelIds / 锚点基地 / 工艺路线**都不同 ⇒
 * 画三圈同心环是**有信息的**，不是给同一份数据上三个颜色。
 *
 * ⚠ 代价必须说清楚：**N 条族线 = N 次求解器调用**。所以它是**默认关**的开关，
 * 打开时界面上明写"多发了 N−1 次请求"。这与"同一份数据不许发第二次"不矛盾——
 * 那条纪律说的是**同一个问题**不许问两遍；这里是 N 个**不同的锚点**，是 N 个问题。
 *
 * R6 确定性：锚点选取 = 「同业务类型内 `so` 字典序最小」，纯全序、无随机、无时钟。
 * R14：业务类型取值与中文名全部来自 contracts `BusinessTypeSchema` / `BUSINESS_TYPE_LABEL`，
 * 本文件**零业务常数**（不写死 SO 号、不写死型号名、不写死三个中文标签）。
 */
import { BUSINESS_TYPE_LABEL, BusinessTypeSchema, type BusinessType } from "@platform/contracts";
import { searchObjects } from "@/api/endpoints";
import { MAX_FAMILY_RINGS, ringOffsets, type FamilyIdentity } from "./chainLineMap";

/** 一条族线的锚点（发现结果）。`so` 是真实订单号，不是构造出来的。 */
export interface FamilyAnchor {
  key: BusinessType;
  label: string;
  so: string;
}

/** 对象查询用的类型 key（`Order` 是在册对象类型）。 */
export const ORDER_OBJECT_TYPE = "Order";

/**
 * 从订单集合派生族锚点。
 *
 * 判据（写死在这里，别处不许再排一套）：
 *  · 分组键 = `Order.businessType`，**必须通过 `BusinessTypeSchema` 校验** ——
 *    种子里冒出个没见过的值，宁可丢掉这一组也不猜（不给一个"看着合理"的默认族）；
 *  · 组内锚点 = `so` 字典序最小（R6 全序，与引擎"锚点订单 = Order 按 so 字典序第一张"同口径）；
 *  · 族序 = `BusinessTypeSchema` 枚举声明序（不是对象键遍历序，也不是订单数量序）。
 *
 * 返回**至多** `MAX_FAMILY_RINGS` 条：环只有这么多圈，多了画不下，
 * 与其挤成一团不如明说（超出部分由调用方的 `truncated` 提示）。
 */
export function deriveFamilyAnchors(rows: readonly { props?: Record<string, unknown> }[]): {
  anchors: FamilyAnchor[];
  /** 因环圈数上限被截掉的族（明说，不静默丢）。 */
  truncated: BusinessType[];
  /** 有订单但 `businessType` 不合契约枚举的条数（诚实计数，不猜）。 */
  unknownTypeCount: number;
} {
  const bySo = new Map<BusinessType, string>();
  let unknownTypeCount = 0;
  for (const row of rows) {
    const p = row.props ?? {};
    const parsed = BusinessTypeSchema.safeParse(p.businessType);
    const so = typeof p.so === "string" ? p.so : null;
    if (!parsed.success || so === null) {
      if (so !== null) unknownTypeCount += 1;
      continue;
    }
    const cur = bySo.get(parsed.data);
    if (cur === undefined || so < cur) bySo.set(parsed.data, so);
  }
  const ordered = BusinessTypeSchema.options.filter((k) => bySo.has(k));
  const kept = ordered.slice(0, MAX_FAMILY_RINGS);
  return {
    anchors: kept.map((key) => ({ key, label: BUSINESS_TYPE_LABEL[key], so: bySo.get(key)! })),
    truncated: ordered.slice(MAX_FAMILY_RINGS),
    unknownTypeCount,
  };
}

/** 锚点 + 环序 → `FamilyIdentity`（`buildChainLineMap` 的构图参数）。锚点细节由载荷回填。 */
export function familyIdentityOf(
  anchor: FamilyAnchor,
  ringIndex: number,
  ringCount: number,
  payloadAnchor?: { so?: string; baseId?: string; routingId?: string },
): FamilyIdentity {
  return {
    key: anchor.key,
    label: anchor.label,
    // 优先用引擎回带的 anchor.so（它才是引擎真正锚定的那张单）；缺席退回请求时用的 so。
    anchorSo: payloadAnchor?.so ?? anchor.so,
    anchorBaseId: payloadAnchor?.baseId ?? null,
    anchorRoutingId: payloadAnchor?.routingId ?? null,
    ringIndex,
    ringOffset: ringOffsets(ringCount)[ringIndex] ?? 1,
    ringCount,
  };
}

/** 拉订单（一次查询，`q=""` = 不过滤）。失败由调用方处置——**不吞异常、不返空数组冒充"没有族"**。 */
export async function fetchOrdersForFamilies(): Promise<{ props?: Record<string, unknown> }[]> {
  const page = await searchObjects(ORDER_OBJECT_TYPE, "", { limit: "500" });
  return (page as unknown as { items?: { props?: Record<string, unknown> }[] }).items ?? [];
}
