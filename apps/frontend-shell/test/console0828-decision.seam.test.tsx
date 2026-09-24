import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig, SimRunDisclosure } from "@platform/contracts";
import { isOnHandOrderStatus, ON_HAND_ORDER_STATUSES, ORDER_STATUSES } from "@platform/contracts";

/**
 * ══ WO-C0828-SEAM · 「统一推演控制台」`console0828` 的**接缝门**（SEAM-GATE：咬链路不咬函数）══
 *
 * ── 这道门为什么存在 ─────────────────────────────────────────────────────────
 * `console0828` 从 2026-09-10 起是 `/v/sim-unified` 的**默认视图**（`UnifiedSimShell.tsx`
 * 的 `if (!expert)` 提前 return），也就是说它是这条 route 上**用户第一眼看到的那块屏**。
 * 而在本门写出来之前，全仓 `apps/frontend-shell/test/` 里对它的引用只有一处形态：
 * 三个既有套件各自的 `enterExpert()` 辅助里那句 `screen.queryByTestId("c0828-expert")`
 * —— 那是**借它的按钮走开**，不是测它。
 *
 * 复量（开工实测，2026-09-10，base `3914f08d`）：
 *   `grep -rl "c0828" apps/frontend-shell/test/`      → 3 个文件，全部只用 `c0828-expert` 这一个锚点
 *   `grep -rn "console0828Model\|eventCatalog" apps/frontend-shell/src` 去掉自身目录后 → **0**
 *   ⇒ 两个模型文件的**唯一消费方**是 `Console0828.tsx`，而没有任何测试渲染过它
 *   ⇒ 「间接覆盖」这条可能性（铁律 0.5 判据 3：re-export / 高阶函数 / 字符串键分发）**已排除**，
 *      不是「我没找到」，是「它确实没有」。
 *   金丝雀（证明上面那个 grep 有鉴别力，否则 0 只能读作「工具坏了」）：
 *      同法搜 `usim-shell` → 2 个文件，`UnifiedSimShell` → 5 个文件。
 *
 * ── 五条臂，每条写清「链路的哪一端到哪一端」───────────────────────────────────
 *  ① **到达路径**：route 默认渲染 `c0828-root`（不是工作台），`c0828-expert` 点下去才切走。
 *     它是其余四条的前提 —— 它一断，别的断言全会红在「找不到 testid」上而指向错误的病因。
 *  ② **三重不可见的回归咬合**（本门最重要的一条）：落不了地的事件（`data-landable="0"`）
 *     **必须点得开**，点开后解释文本非空。历史病因是三样叠在一起：按钮 `disabled` +
 *     兜底原生 `title` + 面板靠点击打开 ⇒ 解释写好了，三条路用户一条都走不到。
 *     故断言**同时**咬住「不是 disabled」「没有原生 title」「点开后有字」——
 *     只咬其中一条，另外两条回归时不会红。
 *  ③ **加事件 → 暂存**：回包（`view-config` × `propagation-rules` × 对象层）决定哪件事落得了地，
 *     选落点 + 填幅度 → `c0828-add-*` → `c0828-staged-count` 跟着变。
 *     **加两件**（1 件与多件在模型层不是同一段：`causeOf` 只在单件时答得上主因）。
 *  ④ **算一下 → 出结果**：一个按钮背后是五跳（world → counterfactual → perturbation×N →
 *     tick → world），断言四块结果面板**同时**出现，且它们读的是同一次结果。
 *  ⑤ **诚实态不许被吞**：三种「算不出来」各有各的屏上位置，且**都不许显示 0 或空白** ——
 *     「算不出来」与「等于 0」是两个不同的命题（`c0828-nocalc-*` / `c0828-run-error` /
 *     `c0828-imp-error`），屏上混了就是骗人。
 *
 * ── ②b（WO-EXPOSURE-CONTRIB · 摘牌）─────────────────────────────────────────
 * 全流程扫描（`chain_impediments`）**不读会话/世界态/扰动** ⇒ 它构造性不可能随扰动变。
 * 2026-09-21 起它**不再**是「算一下」的一环：改走独立的 `impQ`（挂载/换范围触发），
 * 展区明标「基础数据现状 · 与本次扰动无关」（`c0828-base-status`）。
 * ⇒ ⑤b 的语义**反转**：推演整跳失败时，基础数据那两块（impediment/board）**必须在场** ——
 *   它们与这次推演的成败无关；摘牌后还让推演失败把它们拖黑，就是把同一个谎言换个位置。
 * ⇒ ⑤c 的语义不变但路径变了：`c0828-imp-error` 现在来自 `impQ` 的失败（挂载即触发），
 *   不再来自 runM 里的那一跳。
 *
 * ── ⓪ 金丝雀 ────────────────────────────────────────────────────────────────
 * 用例 ⓪ 先跑一个**已知必中**的样例（12 件事全部渲染出按钮）。它若失败 ⇒ 报「**工具坏了**」，
 * ⛔ 不许读作「这件事落不了地」——② 那条臂正是靠「某个按钮 `data-landable=0`」下否定结论的，
 * 探针本身坏掉时那个结论会**恰好反着成立**。
 *
 * ── fixture 纪律 ────────────────────────────────────────────────────────────
 * · 卡点载荷复用既有基线 `fixtures/chain-impediment-baseline.json`（8 处，真引擎形状），
 *   **不新造基线 JSON**（仓主 2026-08-20 禁令 3）。
 * · 三种落地态（`ok` / `no-instance` / `no-statevar`）由**回包现算**，不写死名单：
 *   改 `nodeObjectIds` 或改边集，屏上跟着变 —— 这正是本门要咬的那条线。
 * · R6 确定性：网络全桩，无时钟、无随机。
 */

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ══════════════════════════════════════════════════════════════════════════════
// fixture · 回包
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 传导规则的边集。**只有这里定义**「哪个类型今天承载哪个量」——
 * `resolveLanding` 拿它与对象条数求交，三种落地态全部由此现算。
 *
 * 刻意让三态都非空（否则 ② 那条臂等于没跑）：
 *   · `Material.priceShock`          ⇒ `material-price-up` **ok**
 *   · `Base.loadIndex`               ⇒ `capacity-loss`     **ok**
 *   · `Order.costPressure`           ⇒ `order-reprice`     **ok**，
 *                                     而 `rush-order` 要的是 `demandPressure` ⇒ **no-statevar**
 *   · `Equipment` 压根不在 `nodeObjectIds` 里 ⇒ `equipment-down` **no-instance**
 */
interface Edge {
  sourceTypeKey: string;
  sourceStateVar: string;
  targetTypeKey: string;
  targetStateVar: string;
}

function baseEdges(): Edge[] {
  return [
    { sourceTypeKey: "Material", sourceStateVar: "priceShock", targetTypeKey: "Model", targetStateVar: "costPressure" },
    { sourceTypeKey: "Base", sourceStateVar: "loadIndex", targetTypeKey: "Line", targetStateVar: "utilPressure" },
    { sourceTypeKey: "Order", sourceStateVar: "costPressure", targetTypeKey: "Customer", targetStateVar: "receivablePressure" },
  ];
}

function rulesFromEdges(edges: readonly Edge[]): PropagationRule[] {
  return edges.map((e, i) => ({
    id: `spr_${String(i)}`,
    tenantId: "demo",
    key: `rule_${String(i)}`,
    sourceTypeKey: e.sourceTypeKey,
    sourceStateVar: e.sourceStateVar,
    viaLinkKey: "feeds",
    targetTypeKey: e.targetTypeKey,
    targetStateVar: e.targetStateVar,
    coefficient: 0.65,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
    domainKey: null,
    domainName: null,
    sourceTypeName: null,
    targetTypeName: null,
  })) as unknown as PropagationRule[];
}

/** 落点实体。**没有 `Equipment` 这一项** —— `equipment-down` 的 `no-instance` 由它现算出来。 */
function baseNodeObjectIds(): Record<string, string[]> {
  return {
    Material: ["mat_licarb", "mat_alfoil"],
    Base: ["base_cz", "base_zz"],
    Order: ["ord_1", "ord_2", "ord_3"],
    Customer: ["cust_a", "cust_b"],
    Line: ["line_1"],
  };
}

let nodeObjectIds: Record<string, string[]> = baseNodeObjectIds();
let edges: Edge[] = baseEdges();

function cfg(): SandboxViewConfig {
  return {
    tenantId: "demo",
    nodeTypes: Object.keys(nodeObjectIds),
    nodeObjectIds,
    linkTypes: ["feeds"],
    stateVars: ["priceShock", "costPressure", "loadIndex", "utilPressure", "receivablePressure"],
    stateVarNames: { priceShock: "价格冲击", costPressure: "成本压力", loadIndex: "负载指数" },
    radarDims: [{ key: "structure", label: "结构" }],
    screens: ["sandbox"],
    propagationCount: edges.length,
  } as unknown as SandboxViewConfig;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WO-ORDER-SCOPE · 订单状态一律**取自契约**，⛔ 门里不写状态字面量
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ **本段是被一次真红逼出来的，值得记一笔**：本夹具原文写的是
 *   `status: "CONFIRMED"` / `"PLANNED"` —— **两个都不在 `ORDER_STATUSES` 里**
 *   （契约三态只有 `OPEN` / `IN_PRODUCTION` / `COMPLETED`）。
 *   旧口径的取舍判据是二值的 `status === "COMPLETED"` 取反，于是这三张**状态压根不认识**的单
 *   全部被静默算进敞口，屏上照样报「2 张单」⇒ **门一直是绿的，而它咬的是一个假前提**。
 *   改吃在手口径后同一份夹具当场红：
 *     `expected '0 张单 · 占订单簿 0.0%' to contain '2 张单'`
 *   —— 三张单全部落进「判不了」。**这一红就是本单要修的那条缝的指纹。**
 *   形态（铁律 0.6 句式）：**「我用『门是绿的』当作『夹具的状态值是真的』的证据，
 *   而前者并不度量后者 —— 二值判据对任何不认识的值都给同一个答案。」**
 *
 * ⇒ 状态值从此**全部现取自契约**，一个字面量都不写：契约哪天改枚举，夹具自动跟上，
 *   不会再出现「夹具用着一个平台不认识的状态，而门照样绿」这一态。
 *   （唯一故意写字面量的地方是 ④d 那个**刻意不认识**的状态 —— 那是被测对象本身。）
 */
function pickStatus(from: readonly string[], i: number, what: string): string {
  const s = from[i];
  /* 🐤 金丝雀：取不到就**当场抛**，⛔ 不许回落成 `undefined`。
     `undefined` 状态恰好就是 ④d 要测的「判不了」那一档 ⇒ 一旦回落，
     ④c 会从「已完成不计入」悄悄变成「判不了不计入」，两条用例一起失去鉴别力，
     而屏上两者都表现为「这张单没进敞口」，红不了。 */
  if (s === undefined) throw new Error(`契约状态集取不到${what}（i=${i}）⇒ 量法坏了，不是代码坏了`);
  return s;
}
/** 在手两态（口径出处 = 契约 `ON_HAND_ORDER_STATUSES`）。 */
const ST_OPEN = pickStatus(ON_HAND_ORDER_STATUSES, 0, "在手第一态");
const ST_IN_PRODUCTION = pickStatus(ON_HAND_ORDER_STATUSES, 1, "在手第二态");
/** 认识但不在手 —— **现算的差集**，今天恰好只有「已交付关闭」。 */
const OFF_HAND_STATUSES = ORDER_STATUSES.filter((s) => !isOnHandOrderStatus(s));
const ST_COMPLETED = pickStatus(OFF_HAND_STATUSES, 0, "认识但不在手的态");

/**
 * 订单簿。**单独具名**（而不是只活在 `OBJECTS.Order` 里）——
 * 本包开了 `noUncheckedIndexedAccess`，`OBJECTS.Order` 取出来是 `T | undefined`，
 * 用例里要拿它现算期望值就得先判空。具名之后期望值是从**同一份 fixture** 算出来的，
 * 而不是另抄一个字面量：抄一份就等于「期望值和被测数据各自漂」，改了 fixture 测试照样绿。
 */
const ORDERS: { id: string; props: Record<string, unknown> }[] = [
  { id: "ord_1", props: { cust: "宁德时代", qty: 1200, value: 30_000_000, due: "2026-10-01", status: ST_IN_PRODUCTION, model: "M1" } },
  { id: "ord_2", props: { cust: "宁德时代", qty: 800, value: 20_000_000, due: "2026-11-01", status: ST_OPEN, model: "M2" } },
  { id: "ord_3", props: { cust: "比亚迪", qty: 500, value: 12_000_000, due: "2026-12-01", status: ST_OPEN, model: "M1" } },
];

/**
 * ④c / ④d 的**追加**订单（默认空 ⇒ 其余 18 条用例的订单簿仍是 3 张，一个期望值都不动）。
 *
 * ⚠ 为什么不直接加进 `ORDERS`：`bookOrders` / `bookTotal` / 状态分布 / 客户家数
 *   全都是**现算**的，加进去会同时改掉十几条既有断言的被测数据 —— 那就分不清
 *   「新加的两条在测什么」与「旧的十几条为什么数变了」。
 */
let extraOrders: { id: string; props: Record<string, unknown> }[] = [];
/** 本次用例的订单簿 = 基线三张 + 追加。取数桩与期望值**同读这一个函数**。 */
function orderBook(): { id: string; props: Record<string, unknown> }[] {
  return [...ORDERS, ...extraOrders];
}

/** 对象层。名字只从这里来（组件取 `props.name` / `props.cust` 等，取不到就回落 id，不编）。 */
const OBJECTS: Record<string, { id: string; props: Record<string, unknown> }[]> = {
  Material: [
    { id: "mat_licarb", props: { name: "碳酸锂", matName: "碳酸锂" } },
    { id: "mat_alfoil", props: { name: "铝箔", matName: "铝箔" } },
  ],
  Base: [
    { id: "base_cz", props: { name: "常州基地" } },
    { id: "base_zz", props: { name: "枣庄基地" } },
  ],
  Order: ORDERS,
  Customer: [
    { id: "cust_a", props: { name: "宁德时代" } },
    { id: "cust_b", props: { name: "比亚迪" } },
  ],
  Line: [{ id: "line_1", props: { name: "常州 A 线" } }],
};

/**
 * 世界前后两态。差分**必须落在订单 id 上**，否则「被推动的订单敞口」恒 0 ——
 * 那会让 ④ 那条臂在一个「链路通了但读数没动」的假象上变绿。
 * `ord_1` / `ord_2` 动，`ord_3` 不动 ⇒ 敞口 = 30M + 20M = 5000 万，占订单簿 6200 万的 80.6%。
 */
const WORLD_BEFORE = {
  ord_1: { costPressure: 10 },
  ord_2: { costPressure: 20 },
  ord_3: { costPressure: 30 },
  mat_licarb: { priceShock: 0 },
};
const WORLD_AFTER = {
  ord_1: { costPressure: 16.5 },
  ord_2: { costPressure: 24.25 },
  ord_3: { costPressure: 30 },
  mat_licarb: { priceShock: 20 },
};

/**
 * ④c / ④d 的追加格：给追加单一个**大幅** delta（10 → 90，远超噪声地板 0.01）。
 *
 * 「动了也不算」这句话要有鉴别力，前提是它**真的动了**：
 * 若追加单没有 delta，它不进敞口的原因就分不清是「状态被排除了」还是「压根没动」——
 * 那条用例会在一个假象上变绿（本仓原话：「链路通了但读数没动」的假绿）。
 *
 * ⚠ 这两格**跟着 `extraOrders` 一起开关**，⛔ 不许常开：`result.deltas.length` 是上屏的数
 * （「N 格读数发生变化」），常开会把其余用例的那个数从 2 改成 4。
 */
const EXTRA_CELLS_BEFORE: Record<string, Record<string, number>> = {
  ord_extra: { costPressure: 10 },
};
const EXTRA_CELLS_AFTER: Record<string, Record<string, number>> = {
  ord_extra: { costPressure: 90 },
};
const worldBefore = (): Record<string, Record<string, number>> =>
  extraOrders.length === 0 ? WORLD_BEFORE : { ...WORLD_BEFORE, ...EXTRA_CELLS_BEFORE };
const worldAfter = (): Record<string, Record<string, number>> =>
  extraOrders.length === 0 ? WORLD_AFTER : { ...WORLD_AFTER, ...EXTRA_CELLS_AFTER };

/**
 * 披露层回包 —— **真后端一次真跑的原样回包**，不是手写夹具（复用既有
 * `fixtures/sim-disclosure.real.json`，⛔ 不新造基线 JSON·仓主 2026-08-20 禁令 3）。
 *
 * ── 为什么必须换掉原来那个手写常量（2026-09-18·WO-DISCLOSURE-TIMINGS）─────────────
 * 本常量原文是：
 *   `{ graph:{objects:11_348,links:40_212}, slice:{…}, rules:{…}, agent:{…}, timings:{total:812} }`
 * —— 它**照着当时前端读法的形状写的，而不是照着契约写的**。而契约
 * （`packages/contracts/src/sim-disclosure.ts`）里那两段是 **`data`** 和
 * **`timings: {phase,ms}[]`**。于是：
 *   · 前端读 `graph.objects` / `timings.total`，手写夹具**恰好喂得出来** ⇒ 测试绿；
 *   · 真后端回的是 `data.objects` / `timings:[…{phase:"total",ms}]` ⇒ **屏上恒 `—`**。
 * **两边一起漂，还一起绿。** 这正是同目录 `sim-disclosure-panel.seam.test.tsx` 头注点名的那条：
 * 「手写的会跟着前端一起改，两边一起漂还一起绿」。
 * 反证（开工实测）：把原来那个手写常量喂给契约 `SimRunDisclosureSchema` ⇒ **失败** ——
 * 它从一开始就不是一个合法回包，只是恰好长成了当时那段读法要的样子。
 *
 * ⚠ **这份真回包自己也不是「整包合契约」的**，别照着它下相反的结论：
 * 它是 2026-09-03 抓的，早于 `WO-ADVERSARY-REACTION`；今天拿整包 `safeParse` 去验
 * **失败 415 处**，全部落在后来新增的还手字段（`rules.items[].isReaction` 等）上。
 * 本门读的 9 项（`data` / `slice` / `rules` 三个计数 / `agent` / `timings`）**逐项都在且都是真值**，
 * 故它对本门仍然有效；⛔ 但不许拿它当「整包契约符合性」的证据 —— 那是另一件事。
 * （同目录 `sim-disclosure-panel.seam.test.tsx` 也用这份 fixture，且是 `as` 断言进去的，
 *   所以那边同样不验整包 —— 这笔账记在这里，免得下一个人以为验过了。）
 *
 * ⇒ 换成真回包后，**后端哪天改了这 9 项里任何一项的字段名或形状，这里当场红**；
 *   而 §④ 新增的三条断言（对象/关系/耗时合计）全部由本 fixture **现算**，不写死数字。
 */
const DISCLOSURE = JSON.parse(
  readFileSync(join(FIX, "sim-disclosure.real.json"), "utf8"),
) as SimRunDisclosure;

/** 屏上「耗时合计」那个数的**唯一正确取法**（契约：`timings` 是数组，按 `phase` 找）。 */
const DISCLOSURE_TOTAL_MS = DISCLOSURE.timings.find((t) => t.phase === "total")?.ms ?? null;

/**
 * 卡点载荷。基线 fixture **一个字节都不改**（仓主 2026-08-20 禁令 3：不新增基线 JSON），
 * 要对策时就地给前两处各挂一条 —— 形状逐字段抄自真引擎回包
 * （本单实测 `POST /a/v1/solvers/chain_impediments/invoke` 的
 * `cand_…_Material.leadTime_pos_lfp_PEER_BEST_10`），不是我想出来的结构。
 */
function impedimentPayload(): unknown {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as {
    impediments: { impedimentId: string; locus: { objectType: string; objectId: string }; candidates: unknown[] }[];
  };
  if (!withCandidates) return raw;
  for (const im of raw.impediments.slice(0, 2)) {
    im.candidates = [
      {
        candidateId: `cand_${im.impedimentId}_lead`,
        impedimentId: im.impedimentId,
        label: `物料·到货周期 ↓ 10（${im.locus.objectId}）`,
        lever: {
          objectType: "Material", objectId: im.locus.objectId, prop: "leadTime",
          factorName: "物料到货", factorMark: "⑮", grain: "model-material", unit: "天", valueKind: "days",
        },
        fromValue: 26, toValue: 10,
        join: { kind: "LINK_HOP", path: "batch_replenishes_material: MaterialBatch→Material" },
        rungKind: "PEER_BEST",
        rungSource: "同侪 Material.leadTime 真实极值（最小） 10",
        effectKind: "DOWNSTREAM_ONLY",
        // ⚠ `dims` 至少要有**一维真的动了**（契约 `superRefine`：不动的不是方案）——
        //    第一版我把 value 与 baseline 写成同一个数，`ChainImpedimentPayloadSchema.parse()`
        //    当场抛，屏上退成「卡点识别未完成」，而我差点把它读成「注入没生效」。
        dims: [
          { key: "breach", label: "超阈幅度（Batch.idleDays）", value: 19, baseline: 19, unit: "天", betterWhen: "lower", dataMode: "SYNTHETIC" },
          { key: "capacityP50", label: "产能 cellsPerDayP50 合计（电芯/日）", value: 36_603_161.75, baseline: 32_081_231.89, unit: "电芯/日", betterWhen: "higher", dataMode: "SYNTHETIC" },
        ],
        provenance: {
          solverKey: "chain_impediments",
          formula: "patchCapacityContext(Material.leadTime: 26→10) → 判据重算 + Σ cellsPerDayP50 重算",
          inputs: ["Material.leadTime", "Batch.idleDays", "rule:C28"],
        },
        dataMode: "SYNTHETIC",
      },
    ];
  }
  return raw;
}

// ── 可变桩开关（每个用例 beforeEach 重置） ────────────────────────────────────
/** `simTick` 这一跳失败 ⇒ 整个「算一下」失败（⑤ 的 `c0828-run-error` 臂）。 */
let tickFails = false;
/** 求解器这一跳失败 ⇒ 钱还在，卡点那半说「没问出来」（⑤ 的 `c0828-imp-error` 臂）。 */
let solverFails = false;
/** 每次「开始推演」真正打出去的扰动请求（③④ 断言「打的是我选的那个落点」）。 */
let perturbCalls: Record<string, unknown>[] = [];
/**
 * 会话的 `tickDays`（`null` = 回包里压根没有这一格 ⇒ 契约「缺省 1」）。
 * ⑥ 的对照实验就是拨它：**同一条会话、同一个第 6 拍，`tickDays` 1 vs 3 必须给出不同的日期**。
 */
let sessionTickDays: number | null = null;
/** 会话创建日 —— 第 0 拍那一天。`null` ⇒ 取不到，屏上必须退回「第 N 拍」而**不是编一个今天**。 */
let sessionCreatedAtRaw: string | null = "2026-09-10T00:00:00.000Z";
/** 卡点载荷要不要带对策（基线 8 处全是 0 对策 ⇒ 四栏面板根本不渲染，⑦ 就没东西可咬）。 */
let withCandidates = false;

vi.mock("@/api/endpoints", () => ({
  // ── console0828 这一屏用到的六个 ──
  fetchSimViewConfig: vi.fn(async () => cfg()),
  fetchPropagationRules: vi.fn(async () => ({ items: rulesFromEdges(edges), stateVarNames: {} })),
  fetchAllObjects: vi.fn(async (type: string) => {
    // WO-ORDER-SCOPE：`Order` 走 `orderBook()`（基线三张 + 本用例的追加），其余类型原样。
    const items = type === "Order" ? orderBook() : (OBJECTS[type] ?? []);
    return { items, total: items.length, hasMore: false, page: 1, pageSize: 500 };
  }),
  /*
   * 落点下拉的「号」取自**本体声明的主键**（`properties.find(isPrimaryKey).propKey`）——
   * 单一真相源，⛔ 前端不手抄「哪个键是订单号」的清单。
   *
   * ⚠ 这条桩是被本门**当场逼出来的**，值得记一笔：
   *   组件新增一个 `fetchObjectTypes` import 之后，typecheck 绿、真浏览器跑通，
   *   而这里的 `vi.mock` 是**手写的导出清单**，不会自动跟上 ⇒ 组件拿到 `undefined`
   *   ⇒ 渲染当场抛错 ⇒ 本文件 **18/18 全红，连 ⓪ 金丝雀一起**。
   *   形态：「我用『typecheck 绿 + 真浏览器跑通』当作『这个新 import 处处可用』的证据，
   *          而前者并不度量后者 —— mock 的导出面是手写的，类型系统一个字都看不见。」
   *   （同族见 CLAUDE.md 铁律 0.6 第 4 条：改名/加名要连断言一起改。）
   *
   * 桩里只给 `Order` 与 `Material` 两个类型，各带一个主键：
   * 够本屏用（12 件事的落点类型），且**故意不给全** —— 取不到主键时下拉应只显示名字，
   * 那条回退路径也该被真跑到，不该被一份"什么都有"的桩掩盖。
   */
  fetchObjectTypes: vi.fn(async () => [
    { key: "Order", displayName: "销售订单", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }] },
    { key: "Material", displayName: "物料", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }] },
  ]),
  simWorld: vi.fn(async () => ({
    tick: perturbCalls.length === 0 ? 0 : 3,
    state: perturbCalls.length === 0 ? worldBefore() : worldAfter(),
  })),
  /* WO-EXPOSURE-CONTRIB：对照世界桩。`runM` 的差分基准 = 它的 `counterfactualState`
     （同会话 active 规则集 · 同 N 拍 · 无本批扰动）。桩成 `WORLD_BEFORE` ⇒ 差分与
     改前 `diffWorld(before, after)` 逐格相同，④ 的全部期望原样成立 —— 这不是巧合，
     零扰动时对照世界 ≡ 推演前世界（真后端实测 6381 格 diff=0）。 */
  simCounterfactual: vi.fn(async () => ({
    fromTick: 0,
    ticks: 3,
    disabledRuleKeys: [],
    suppressedRules: [],
    baselineState: worldBefore(),
    counterfactualState: worldBefore(),
    diffs: [],
    suppressedRulesFiredInBaseline: [],
  })),
  createSimPerturbation: vi.fn(async (_sid: string, body: Record<string, unknown>) => {
    perturbCalls.push(body);
    return { perturbation: { id: `simpert_${String(perturbCalls.length)}`, startTick: 0, ...body } };
  }),
  simTick: vi.fn(async (_sid: string, n: number) => {
    if (tickFails) throw new Error("推进这一跳没走通（桩：本用例刻意不回）");
    return { curTick: n, state: worldAfter(), disclosure: DISCLOSURE };
  }),
  runSolver: vi.fn(async () => {
    if (solverFails) throw new Error("求解器这一跳没走通（桩：本用例刻意不回）");
    return { data: impedimentPayload(), snapshotVersion: "sv-test" };
  }),
  proposeSimCandidates: vi.fn(),

  // ── 外壳 `UnifiedSimShell` 在提前 return 之前照样跑的那几个 hook ──
  fetchSimSessions: vi.fn(async () => ({
    items: [
      {
        id: "sims_c0828",
        tenantId: "demo",
        status: "RUNNING",
        curTick: 0,
        parentCheckpointId: null,
        ...(sessionCreatedAtRaw === null ? {} : { createdAt: sessionCreatedAtRaw }),
        ...(sessionTickDays === null ? {} : { tickDays: sessionTickDays }),
        scope: {},
      },
    ],
  })),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  fetchDrillStateVarLayers: vi.fn(async () => ({ layers: [], ruleCount: edges.length })),
  patchSimSessionStatus: vi.fn(),
  previewChangeImpact: vi.fn(),
}));

vi.mock("@/api/apiClient", () => ({
  api: {
    a: vi.fn(async (path: string) => {
      throw new Error(`未桩的路径：${path}`);
    }),
    b: vi.fn(),
    aRaw: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

import UnifiedSimShell from "@/views/sim/unified/UnifiedSimShell";
import { BUSINESS_EVENTS } from "@/views/sim/unified/console0828/eventCatalog";
/* ⚠ `fmtMoney` 从**被测代码的单源**取（它自己也是转调 `ParetoChart.fmtXTick` 的那一份）——
   ⛔ 不在门里另写一遍「元 → 亿/万」的折算：抄一份就是期望值与屏上各自漂，改一边照样绿。 */
import { fmtMoney, MONEY_BREAKDOWN_LABELS } from "@/views/sim/unified/console0828/console0828Model";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnifiedSimShell />
    </QueryClientProvider>,
  );
}

/**
 * 等到左栏把 12 件事的落地判定**算完**再断言。
 *
 * ⚠ **不许只等 `c0828-root`**：根节点在 `view-config` / `propagation-rules` 两跳都还在路上时
 * 就已经挂出来了，那一帧上每件事都还是「还在判定」，`data-landable` 一律是 `"0"` ——
 * 于是 ② 那条臂会在**所有**事件上都「成立」，包括那些其实落得了地的。
 * 形态正是铁律 0.6 那一句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
 * 故探针落在「至少有一件事真的判成了可落地」上（`data-landable="1"`）。
 */
async function railReady(): Promise<void> {
  await screen.findByTestId("c0828-root");
  await waitFor(() => {
    const landable = screen
      .getAllByTestId(/^c0828-ev-/)
      .filter((b) => b.getAttribute("data-landable") === "1");
    expect(landable.length).toBeGreaterThan(0);
  });
}

/** 加一件事：展开 → 选落点 → （可选）改幅度 → 加进去。 */
async function addEvent(eventId: string, objectId: string, magnitude?: number): Promise<void> {
  fireEvent.click(screen.getByTestId(`c0828-ev-${eventId}`));
  const sel = await screen.findByTestId(`c0828-pick-${eventId}`);
  // 候选来自对象层那一跳，等它回来再选 —— 不等就会选在一个只有占位项的下拉上。
  await waitFor(() => {
    expect(within(sel as HTMLSelectElement).getAllByRole("option").length).toBeGreaterThan(1);
  });
  fireEvent.change(sel, { target: { value: objectId } });
  if (magnitude !== undefined) {
    fireEvent.change(screen.getByTestId(`c0828-mag-${eventId}`), { target: { value: String(magnitude) } });
  }
  const add = screen.getByTestId(`c0828-add-${eventId}`);
  expect(add).not.toBeDisabled();
  fireEvent.click(add);
}

/**
 * WO-ORDER-SCOPE · ④c/④d 的公共动作：挂载 → 加一件事 → 算一下 → 等钱那块出来。
 * 两条用例只在 `extraOrders` 上不同，动作一字不差 —— 抄两份就会出现
 * 「一条改了动作另一条没改」而两条都还绿的那种漂移。
 */
async function runFlow(): Promise<void> {
  mount();
  await railReady();
  await addEvent("material-price-up", "mat_licarb", 15);
  fireEvent.click(screen.getByTestId("c0828-go"));
  await screen.findByTestId("c0828-money");
  /* ⚠ 必须**真点那个页签**再断言可见性：五块面板用 `hidden` 属性切换、全留在 DOM 里
     （`.tabPane[hidden]{display:none}`）⇒ 不切页签时 `c0828-cust` 整棵子树对
     `toBeVisible()` 是不可见的，而 `toBeInTheDocument()` 照样过。
     这正是本仓「读屏照样念 / 门也白降」那条的同一面：**在不在 DOM ≠ 看得见**。
     顺带这也让 ④c/④d 走的是用户真实动线（点页签），不是直接摸 DOM。 */
  fireEvent.click(screen.getByTestId("c0828-tab-cust"));
  await waitFor(() => {
    expect(screen.getByTestId("c0828-pane-cust")).toBeVisible();
  });
}

/** 打开口径浮层并回正文（`InfoPopover` 关着时正文**不在 DOM**，必须真点开）。 */
async function openInfo(testId: string): Promise<HTMLElement> {
  expect(
    screen.queryByTestId(`info-body-${testId}`),
    "浮层正文默认就在 DOM ⇒ 它没起到收纳作用（读屏照样念）",
  ).toBeNull();
  const trigger = screen.getByTestId(`info-${testId}`);
  expect(trigger, "第一层没有 `?` 记号 ⇒ 静默降层 = 删除（规范 §1）").toBeVisible();
  fireEvent.click(trigger);
  return screen.findByTestId(`info-body-${testId}`);
}

/** 屏上「三档」那三个数 —— 从**口径浮层正文**里现取，⛔ 不读组件内部 state。 */
function scopeCountsFrom(body: HTMLElement): { onHand: number; offHand: number; undecidable: number } {
  const t = body.textContent ?? "";
  const grab = (label: string): number => {
    const m = new RegExp(`${label}\\s*(\\d+)`).exec(t);
    if (m?.[1] === undefined) throw new Error(`口径浮层里读不到「${label}」⇒ 量法坏了，不是屏上没数。正文：${t}`);
    return Number(m[1]);
  };
  return { onHand: grab("在手"), offHand: grab("已交付关闭"), undecidable: grab("判不了") };
}

beforeEach(() => {
  nodeObjectIds = baseNodeObjectIds();
  edges = baseEdges();
  tickFails = false;
  solverFails = false;
  perturbCalls = [];
  sessionTickDays = null;
  sessionCreatedAtRaw = "2026-09-10T00:00:00.000Z";
  withCandidates = false;
  extraOrders = [];
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════════

describe("WO-C0828-SEAM · 08-28 决策屏接缝门", () => {
  it("⓪ 金丝雀：12 件事全部挂出按钮，且三种落地态都非空 —— 失败 ⇒ 报「工具坏了」，不许读作「今天没有可加的事」", async () => {
    mount();
    await railReady();

    // 已知必中：目录里有几件事，屏上就该有几个按钮。
    const btns = screen.getAllByTestId(/^c0828-ev-/);
    expect(btns).toHaveLength(BUSINESS_EVENTS.length);
    expect(BUSINESS_EVENTS.length).toBe(12);

    // 三态都要有样本，否则 ②③ 两条臂里的否定/肯定结论都失去对照。
    const landable = btns.filter((b) => b.getAttribute("data-landable") === "1");
    const unlandable = btns.filter((b) => b.getAttribute("data-landable") === "0");
    expect(landable.length).toBeGreaterThan(0);
    expect(unlandable.length).toBeGreaterThan(0);

    // 组件自己的金丝雀位：它认为「一件都落不了地」时才会挂 c0828-canary-broken。
    expect(screen.queryByTestId("c0828-canary-broken")).toBeNull();
  });

  it("① 到达路径：route 默认就是决策屏（不是工作台），且「专家模式」点下去真能切过去", async () => {
    mount();
    await railReady();

    // 默认这一屏是 console0828，外壳自己也这么标。
    const shell = screen.getByTestId("usim-shell");
    expect(shell.getAttribute("data-view")).toBe("console0828");
    expect(screen.getByTestId("c0828-rail")).toBeInTheDocument();
    // 工作台此刻不在 DOM 里 —— 「默认渲染 c0828」这句话的另一半。
    expect(screen.queryByTestId("usim-wall")).toBeNull();

    fireEvent.click(screen.getByTestId("c0828-expert"));

    await waitFor(() => {
      expect(screen.getByTestId("usim-shell").getAttribute("data-view")).toBe("expert");
    });
    // 切过去之后决策屏让位，工作台接手（两屏同一条 route、同一个会话）。
    expect(screen.queryByTestId("c0828-root")).toBeNull();
  });

  it("② 三重不可见回归：落不了地的事**点得开**，且理由三条路都到得了（不是 disabled · 无原生 title · 点开有字）", async () => {
    mount();
    await railReady();

    // 这件事今天落不了地，是**回包现算**出来的：`Equipment` 不在 nodeObjectIds 里。
    const btn = screen.getByTestId("c0828-ev-equipment-down");
    expect(btn.getAttribute("data-landable")).toBe("0");

    // ── 三条路，缺一条当年就制造过「解释写好了没人看得到」 ──
    // 路 ①：按钮不能是 disabled，否则下面那一 click 根本不会发生。
    expect(btn).not.toBeDisabled();
    expect(btn.hasAttribute("disabled")).toBe(false);
    // 路 ②：口径不许塞进原生 title（disabled 元素上多数浏览器根本不渲染它；且违反 R-UI-3）。
    expect(btn.getAttribute("title")).toBeNull();
    // 路 ③：理由在第一层就已经摆着，不用点开也读得到。
    expect(btn.textContent ?? "").toContain("无任何实例");

    // 点开 ⇒ 解释面板出现，且**有字**（空面板与「没有面板」在屏上一样难用）。
    fireEvent.click(btn);
    const panel = await screen.findByTestId("c0828-absent-equipment-down");
    expect((panel.textContent ?? "").trim().length).toBeGreaterThan(20);
    expect(panel.textContent ?? "").toContain("不是取数失败");
    // 它找过哪些落点 —— 名单来自事件目录，不是拼出来的一句空话。
    expect(panel.textContent ?? "").toContain("Equipment");

    // 点得开 ≠ 加得进去：真正的写口另有早退守着，表单一律不出现。
    expect(screen.queryByTestId("c0828-form-equipment-down")).toBeNull();
    expect(screen.queryByTestId("c0828-add-equipment-down")).toBeNull();
  });

  it("②b 三态不许塌成一个：「一个实例都没有」与「有实例但没有这个量」是两句不同的话", async () => {
    mount();
    await railReady();

    // rush-order 要 Order.demandPressure，而边集里 Order 只承载 costPressure ⇒ no-statevar。
    const rush = screen.getByTestId("c0828-ev-rush-order");
    expect(rush.getAttribute("data-landable")).toBe("0");
    fireEvent.click(rush);
    const statevar = await screen.findByTestId("c0828-absent-rush-order");
    expect(statevar.textContent ?? "").toContain("无传导路径");

    // ⚠ 左栏一次只展开一件事 ⇒ 先把这一句取下来再去点下一件，否则它的面板已经收走了。
    const whyStateVar = screen.getByTestId("c0828-absent-why-rush-order").textContent ?? "";

    // 同为「落不了地」，措辞必须与 no-instance 那条不同 —— 合并即红。
    fireEvent.click(screen.getByTestId("c0828-ev-equipment-down"));
    const noinst = await screen.findByTestId("c0828-absent-equipment-down");
    /**
     * ⚠ **咬「那句措辞」本身，不咬整块面板**（本单实测修正的一处假绿）：
     * 整块面板里还混着「它找过哪些落点」那段**逐事件明细**，两个事件的明细天然不同 ⇒
     * 把两条措辞改成**一模一样**，`noinst.textContent !== statevar.textContent` **仍然成立**，
     * 门全绿。变异反证当场抖出来的：把 `LANDING_ABSENCE_TEXT` 两条改成同一句 ⇒ 14/14 全过。
     * 形态（铁律 0.6 句式）：
     * 「我用『两块面板的文本不相等』当作『两种措辞不一样』的证据，而前者并不度量后者。」
     * 故改咬 `c0828-absent-why-*` —— 那个锚点上**只有**那一句措辞。
     */
    const whyNoInst = screen.getByTestId("c0828-absent-why-equipment-down").textContent ?? "";
    expect(whyStateVar.trim().length).toBeGreaterThan(10);
    expect(whyNoInst.trim().length).toBeGreaterThan(10);
    expect(whyNoInst).not.toBe(whyStateVar);
    // 两句各自的**可判定内核**也要在（只比"不相等"的话，改一个标点就能骗过去）。
    expect(whyNoInst).toContain("无任何实例");
    expect(whyStateVar).toContain("无传导路径");
    expect(noinst.textContent).not.toBe(statevar.textContent);

    // 而同一个 Order 上换一个量就落得了地 ⇒ 上面那个 "0" 是**这个量**的结论，不是「Order 取不到数」。
    expect(screen.getByTestId("c0828-ev-order-reprice").getAttribute("data-landable")).toBe("1");
  });

  it("③ 加事件 → 暂存：件数跟着变，**加两件必须显示 2 件**（1 件与多件在模型层不是同一段）", async () => {
    mount();
    await railReady();

    expect(screen.getByTestId("c0828-staged-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("c0828-staged-count")).toBeNull();

    await addEvent("material-price-up", "mat_licarb", 15);
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("1 件");
    });
    // 名字来自对象层那一跳，不是回显 id。
    expect(screen.getByTestId("c0828-chip-material-price-up").textContent ?? "").toContain("碳酸锂");
    expect(screen.queryByTestId("c0828-staged-empty")).toBeNull();

    await addEvent("capacity-loss", "base_cz");
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("2 件");
    });
    expect(screen.getByTestId("c0828-chip-capacity-loss").textContent ?? "").toContain("常州基地");
  });

  it("④ 算一下 → 出结果：一个按钮背后五跳走完，四块结果面板同时出现且读的是同一次结果", async () => {
    mount();
    await railReady();

    // 一件都没加时按钮是死的 —— 「算一下」不该在没有输入时可点。
    expect(screen.getByTestId("c0828-go")).toBeDisabled();
    expect(screen.getByTestId("c0828-idle")).toBeInTheDocument();

    await addEvent("material-price-up", "mat_licarb", 15);
    const go = screen.getByTestId("c0828-go");
    await waitFor(() => {
      expect(go).not.toBeDisabled();
    });
    fireEvent.click(go);

    // 四块面板 —— 缺一块都算这条链没走通。
    await screen.findByTestId("c0828-money");
    expect(screen.getByTestId("c0828-cust")).toBeInTheDocument();
    expect(screen.getByTestId("c0828-impediment")).toBeInTheDocument();
    expect(screen.getByTestId("c0828-board")).toBeInTheDocument();
    expect(screen.queryByTestId("c0828-idle")).toBeNull();

    /* ②b 摘牌的两块明标（第一层可见）：基础组与结果组各有各的分组标，
       读者不读代码也能判断哪组数随这次扰动。 */
    const baseCap = screen.getByTestId("c0828-base-status");
    expect(baseCap.textContent ?? "").toContain("基础数据现状");
    expect(baseCap.textContent ?? "").toContain("与本次扰动无关");
    expect(screen.getByTestId("c0828-result-status").textContent ?? "").toContain("本次推演结果");

    // 打出去的扰动实参 = 我在屏上选的那一个（落点/量/幅度/kind 逐项对得上，不是「发了个请求」）。
    expect(perturbCalls).toHaveLength(1);
    expect(perturbCalls[0]).toMatchObject({
      targetObjectId: "mat_licarb",
      targetStateVar: "priceShock",
      magnitude: 15,
      kind: "cost_shock",
      mode: "delta",
    });

    // 敞口来自**差分 ∩ 订单**（ord_1 + ord_2 动了，ord_3 没动）——
    // 写死期望会让「差分算错」这件事测不出来，故期望值由 fixture 现算。
    const moved = ["ord_1", "ord_2"];
    const expected = ORDERS.filter((o) => moved.includes(o.id)).reduce(
      (s, o) => s + (o.props.value as number),
      0,
    );
    expect(screen.getByTestId("c0828-exposure-sub").textContent ?? "").toContain(`${String(moved.length)} 张单`);
    expect(expected).toBe(50_000_000);
    // 屏上是「5000 万元」这类人话格式，故咬「不是 0、不是空」+ 张数，金额精确值由上面那一行守。
    const exposure = screen.getByTestId("c0828-exposure").textContent ?? "";
    expect(exposure.trim()).not.toBe("");
    expect(exposure).not.toMatch(/^0\s*元$/);

    // 单件 ⇒ 主因答得上（这正是 ③ 要加两件的原因：多件时这句话必须换成「说不清」）。
    expect(screen.getByTestId("c0828-maincause").textContent ?? "").toContain("原材料涨价");

    // 卡点两半都来自引擎基线（8 处），前端零判定。
    expect(screen.getByTestId("c0828-impediment").textContent ?? "").toContain("扫出 8 处");
    expect(screen.getByTestId("c0828-board").textContent ?? "").toContain("8 处受阻环节");
    expect(screen.queryByTestId("c0828-imp-error")).toBeNull();

    // 披露层上屏（铁律 1.5 判据二：推演过程必须可披露，且「没调 agent」要明写不许留白）。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain(DISCLOSURE.slice.sliceKey);
    expect(honesty).toContain("本次未调用 agent");

    /**
     * ── ④c 披露层**逐项**要与回包逐字一致（WO-DISCLOSURE-TIMINGS·2026-09-18）────────
     *
     * 这三项在本单之前**恒显示 `—`**，而屏上其余三项（切片/跳数/规则）一直是对的 ——
     * 于是「六项里有三项是死的」这件事，靠上面那两条断言一次都没红过：
     * 它们咬的恰好是**活着的那三项**。
     *
     * 病因见 `Console0828.tsx` 的 `readDisclosure` 头注：`timings.total`（契约是数组）、
     * `totalMs`（后端从来没有过）、`graph.objects/links`（后端那段叫 `data`）三条路全死，
     * 而 `as Record<string, unknown>` 让 `tsc` 一个字都不说。
     *
     * ⚠ 期望值**全部由 fixture 现算**，不写死数字 —— 写死了就只是把另一个常量抄进断言，
     * 回包一改照样绿（那正是原来那个手写夹具犯的病）。
     */
    // ⓪ 🐤 金丝雀：先证明这三个期望值**本身不是空的**。
    //    若 fixture 哪天少了这几段，期望值会变成 `undefined`/`null`，
    //    而 `toContain(String(undefined))` 这类断言会**恰好在屏上也没有值时通过** ——
    //    那就把「两边都没有」读成了「两边一致」。故先把探针自己验一遍。
    expect(DISCLOSURE_TOTAL_MS, "fixture 里没有 phase=total 这一格 ⇒ 探针坏了，不是屏上没数").not.toBeNull();
    expect(DISCLOSURE.data.objects).toBeGreaterThan(0);
    expect(DISCLOSURE.data.links).toBeGreaterThan(0);

    // ① 耗时合计：屏上那个数必须 = 回包 `timings[phase="total"].ms`，逐字一致。
    expect(honesty).toContain(`耗时合计 ${String(DISCLOSURE_TOTAL_MS)} 毫秒`);
    // ⛔ 并且**不许**还是那个恒缺席的破折号 —— 「有个数」与「是对的数」要分开咬：
    //    只断言上一行的话，屏上若同时出现别处的同名字样也可能蒙混过去。
    expect(honesty).not.toContain("耗时合计 — 毫秒");

    // ② / ③ 引用的数据：对象数与关系条数同样取自 `data` 段。
    expect(honesty).toContain(`对象 ${String(DISCLOSURE.data.objects)} 个`);
    expect(honesty).toContain(`关系 ${String(DISCLOSURE.data.links)} 条`);
    expect(honesty).not.toContain("对象 — 个");
    expect(honesty).not.toContain("关系 — 条");
  });

  it("④b 多件时主因这句话必须换成「说不清」——不许挑一个顶上（差分层看不出某一格是谁推的）", async () => {
    mount();
    await railReady();

    await addEvent("material-price-up", "mat_licarb", 15);
    await addEvent("capacity-loss", "base_cz");
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("2 件");
    });

    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    expect(perturbCalls).toHaveLength(2);
    const cause = screen.getByTestId("c0828-maincause").textContent ?? "";
    expect(cause).toContain("无法归因到单一事件");
    expect(cause).not.toContain("原材料涨价");
  });

  /* ══ WO-ORDER-SCOPE · ④c / ④d ════════════════════════════════════════════════
   *
   * 这两条守的是**「哪些单进得来」**这一件事，⛔ 不碰「每张单算多少钱」（那是红线，需签字）。
   *
   * 判据落在**屏上**（DOM 文本），不落在模型返回值：口径改对了而屏上没接线，
   * 读者看到的还是旧数 —— 本仓原话「绿测试 ≠ 能用，断在接缝」。
   */
  const EXTRA_VALUE = 99_000_000;
  /** ④c/④d 的追加单：同一张单，**只有 `status` 不同** —— 这就是两条用例的唯一自变量。 */
  const extraOrder = (status: string) => [
    { id: "ord_extra", props: { cust: "追加客户", qty: 100, value: EXTRA_VALUE, due: "2026-12-31", status, model: "M1" } },
  ];
  /** 基线两张动了的单的敞口（ord_1 + ord_2）—— 由 fixture 现算，⛔ 不写死 5000 万。 */
  const MOVED_VALUE = ORDERS.filter((o) => ["ord_1", "ord_2"].includes(o.id)).reduce(
    (s, o) => s + (o.props.value as number),
    0,
  );

  it("④c 已交付关闭的单**动了也不算**：不进敞口、不进张数，且口径在屏上说得出来", async () => {
    // 追加一张**已完成**单，并给它一个大幅 delta（10 → 90，远超噪声地板 0.01）。
    // 🐤 前提金丝雀：它必须真的动了 —— 否则「动了也不算」这句话没有鉴别力，
    //    它不进敞口的原因就分不清是「状态被排除」还是「压根没动」。
    extraOrders = extraOrder(ST_COMPLETED);
    expect(EXTRA_CELLS_AFTER.ord_extra?.costPressure).not.toBe(EXTRA_CELLS_BEFORE.ord_extra?.costPressure);

    await runFlow();

    // ① 张数与金额都还是基线那两张 —— 已完成单**一张都没混进来**。
    const sub = screen.getByTestId("c0828-exposure-sub").textContent ?? "";
    expect(sub, "已完成单混进了影响面（仓主报的原始 bug 复活）").toContain("2 张单");
    const exposure = screen.getByTestId("c0828-exposure").textContent ?? "";
    expect(exposure).toContain(fmtMoney(MOVED_VALUE, "元"));
    // ⛔ 反向：它的钱也不许进敞口。只咬张数抓不住「张数对了金额多算了」。
    expect(exposure, "已完成单的金额被算进了敞口").not.toContain(fmtMoney(MOVED_VALUE + EXTRA_VALUE, "元"));

    // ② 诚实位：被排除的那张必须**上屏**（只报 2 不报「另有 1 张已完成不计入」= 不可核）。
    const settled = screen.getByTestId("c0828-cust").textContent ?? "";
    expect(settled).toContain("已完成·不计入");

    // ③ 它是**认识**的状态 ⇒ 不许落到「判不了」那一档去（两档混了等于没分）。
    expect(
      screen.queryByTestId("c0828-undecidable"),
      "已完成单被算成「状态判不了」——两个排除档混成了一个",
    ).toBeNull();

    // ④ 口径在屏上说得出来：三档 + Σ 恒等式（= 全簿），读者不读代码就能自己核。
    const body = await openInfo("c0828-scope-caliber");
    const c = scopeCountsFrom(body);
    expect(c).toEqual({ onHand: ORDERS.length, offHand: 1, undecidable: 0 });
    expect(
      c.onHand + c.offHand + c.undecidable,
      "三档之和 ≠ 全簿张数 ⇒ 划分漏了一档（互斥且并集=全簿 这条性质破了）",
    ).toBe(orderBook().length);
  });

  it("④d 状态不认识的单落「判不了」，**不静默并进任一侧**；反向金丝雀：改成认识的在手态就必须离开这一档", async () => {
    /* ⚠ 本条**必须配反向金丝雀**：只验「不认识的落进判不了」抓不住
     *   「所有单都落进判不了」这个相反的故障 —— 本仓记过这笔账，
     *   而且今天开工时它就真的发生过一次（夹具的 CONFIRMED/PLANNED 让三张全落判不了，
     *   屏上 `0 张单 · 占订单簿 0.0%`）。故第二臂把同一张单的状态换成**认识的在手态**，
     *   它必须**离开**这一档并**进入**敞口。 */

    // ── 臂 ① 状态平台不认识（含它压根不是契约枚举里的值）──────────────────────
    const WEIRD = "WAT_IS_THIS";
    expect(
      (ORDER_STATUSES as readonly string[]).includes(WEIRD),
      "这个状态居然在契约枚举里 ⇒ 本条用例的自变量选错了，它测不到「判不了」",
    ).toBe(false);
    extraOrders = extraOrder(WEIRD);
    await runFlow();

    const undecidable = screen.getByTestId("c0828-undecidable");
    expect(undecidable.textContent ?? "", "状态判不了的单没有单独上屏").toContain("1 张");
    // 不静默并进「已完成」那一侧。
    expect(
      screen.getByTestId("c0828-cust").textContent ?? "",
      "判不了的单被并进了「已完成·不计入」——那会让人以为它是正常业务排除",
    ).not.toContain("已完成·不计入");
    // 也不静默并进敞口：张数与金额都还是基线那两张。
    const sub1 = screen.getByTestId("c0828-exposure-sub").textContent ?? "";
    expect(sub1, "状态判不了的单被算进了影响面（这就是本单要修的那条缝）").toContain("2 张单");
    const exp1 = screen.getByTestId("c0828-exposure").textContent ?? "";
    expect(exp1).toContain(fmtMoney(MOVED_VALUE, "元"));
    expect(exp1).not.toContain(fmtMoney(MOVED_VALUE + EXTRA_VALUE, "元"));

    const body1 = await openInfo("c0828-scope-caliber");
    expect(scopeCountsFrom(body1)).toEqual({ onHand: ORDERS.length, offHand: 0, undecidable: 1 });

    // ── 臂 ② 反向金丝雀：同一张单，状态换成**认识的在手态** ───────────────────
    cleanup();
    perturbCalls = []; // 世界态桩按它判「推演前/后」，不清会让第二臂拿到 after 当 before。
    extraOrders = extraOrder(ST_IN_PRODUCTION);
    await runFlow();

    expect(
      screen.queryByTestId("c0828-undecidable"),
      "换成认识的在手态之后它还留在「判不了」⇒ 这一档是个黑洞：所有单都会掉进去，而第一臂照样绿",
    ).toBeNull();
    const sub2 = screen.getByTestId("c0828-exposure-sub").textContent ?? "";
    expect(sub2, "在手单没有进影响面 ⇒ 划分把在手态也排除了").toContain("3 张单");
    const exp2 = screen.getByTestId("c0828-exposure").textContent ?? "";
    expect(exp2, "在手单的金额没进敞口").toContain(fmtMoney(MOVED_VALUE + EXTRA_VALUE, "元"));

    const body2 = await openInfo("c0828-scope-caliber");
    expect(scopeCountsFrom(body2)).toEqual({ onHand: ORDERS.length + 1, offHand: 0, undecidable: 0 });
  });

  it("⑤ 诚实态 · 三行钱：算不出来的画「这次算不出来」——⛔ 不许显示 0，也不许留空", async () => {
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // 三行各自有自己的位置，且都是「算不出来」这一态 —— 三行塌成一行、或悄悄变 0，都在这里红。
    // ⚠ 栏目名从**被测代码的单源**取（`MONEY_BREAKDOWN_LABELS`），⛔ 不在这里另抄一份数组 ——
    //   抄一份就是「期望值与被测数据各自漂」，改了一边照样绿。
    expect(MONEY_BREAKDOWN_LABELS).toHaveLength(3);
    for (const label of MONEY_BREAKDOWN_LABELS) {
      const cell = screen.getByTestId(`c0828-nocalc-${label}`);
      const txt = (cell.textContent ?? "").trim();
      expect(txt).toBe("本次无法计算");
      // 「算不出来」与「等于 0」是两个命题 —— 这两条断言就是那条界线本身。
      expect(txt).not.toBe("0");
      expect(txt).not.toBe("");
      expect(txt).not.toMatch(/^0\s*元$/);
    }

    // 全屏诚实位把这条语义写在字面上，不靠用户自己领会删除线。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain("本次无法计算");
    expect(honesty).toContain("不是 0");
  });

  it("⑤b 诚实态 · 整跳失败：说「这次没算成」，而**不是**摆一屏 0 出来", async () => {
    tickFails = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));

    const err = await screen.findByTestId("c0828-run-error");
    expect(err.textContent ?? "").toContain("本次推演未完成");
    // 屏上必须写明这是「这一跳失败」，与「结果是 0」分开 —— 两者处置相反。
    expect(err.textContent ?? "").toContain("不是「结果为 0」");

    // 推演结果一个数都不许摆出来：没有结果就没有钱那两块、没有执行记录。
    expect(screen.queryByTestId("c0828-money")).toBeNull();
    expect(screen.queryByTestId("c0828-cust")).toBeNull();
    expect(screen.getByTestId("c0828-idle")).toBeInTheDocument();

    /* ②b 反转（WO-EXPOSURE-CONTRIB · 摘牌）：基础数据那两块**必须在场** ——
       全流程扫描独立于「开始推演」（`impQ` 挂载即跑），推演失败与它们无关；
       摘牌后还让失败把它们拖黑，就是把「这个数是这次推演算出来的」换个位置继续撒。
       且分组明标必须在第一层，读者不读代码就能判断这组数与扰动无关。 */
    await screen.findByTestId("c0828-impediment");
    await screen.findByTestId("c0828-board");
    const baseStatus = screen.getByTestId("c0828-base-status");
    expect(baseStatus.textContent ?? "").toContain("基础数据现状");
    expect(baseStatus.textContent ?? "").toContain("与本次扰动无关");
  });

  it("⑤c 诚实态 · 扫描失败：钱照出，而卡点那半说「没问出来」——不许静默吞成「没有卡点」", async () => {
    solverFails = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));

    // 钱这一半走通了，照常上屏（扫描的失败不该把推演结果拖黑 —— ②b 后两者本就不在一跳里）。
    await screen.findByTestId("c0828-money");
    expect(screen.queryByTestId("c0828-run-error")).toBeNull();

    // 卡点这一半照实说「没问出来」，且与「没有卡点」字面分开。
    const impErr = await screen.findByTestId("c0828-imp-error");
    expect(impErr.textContent ?? "").toContain("卡点识别未完成");
    expect(impErr.textContent ?? "").toContain("不是「无卡点」");
    // 没问出来 ⇒ 看板不许摆出来（摆一张空看板 = 说「一处卡点都没有」）。
    expect(screen.queryByTestId("c0828-board")).toBeNull();
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ⑥ 拍 → 真实日期（WO-C0828-VOICE · 仓主 2026-09-11「从几拍太模糊了，为何不调整为日期」）
   * ════════════════════════════════════════════════════════════════════════════
   * **铁律 1.5 判据一要的那条对照实验**：不是「跑得起来吗」，而是
   * 「当我把 `tickDays` 从 1 改成 3，第 N 拍的日期必须按可预言的方式变化」。
   * 判据：`Δ = N × (3 − 1)` 天。四个数（两种 tickDays × 第 0 拍 / 第 6 拍）缺一个不算交付。
   * ⚠ 用 UTC 日历日算期望值，不走本地时区 —— 否则这条门在 CI 与本机会各说一套。
   */
  const D0 = Date.parse("2026-09-10T00:00:00.000Z");
  const iso = (days: number): string => new Date(D0 + days * 86_400_000).toISOString().slice(0, 10);

  async function tickTextAt(td: number | null, horizonTicks: number): Promise<string> {
    // ⚠ 两次量测在**同一个用例**里，而 `beforeEach` 只在用例之间跑 ——
    //    不清零的话第二次 `simWorld` 会按「已经施过扰动」回 tick 3，
    //    于是「第 0 拍」那两个数就不是第 0 拍了（第一版实测正是栽在这里）。
    perturbCalls = [];
    sessionTickDays = td;
    mount();
    await railReady();
    fireEvent.change(screen.getByTestId("c0828-horizon"), { target: { value: String(horizonTicks) } });
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");
    return screen.getByTestId("c0828-tl-head").textContent ?? "";
  }

  it("⑥ 对照实验 · tickDays 1 vs 3：同一个第 6 拍必须给出不同日期，且差值 = 6×(3−1) = 12 天", async () => {
    // 桩里 `simTick` 回 `curTick = n` ⇒ 推 6 拍后终点就是第 6 拍，起点第 0 拍。
    const t1 = await tickTextAt(1, 6);
    cleanup();
    const t3 = await tickTextAt(3, 6);

    // 四个数，逐个写出来（缺一个不算交付）。
    const d0_td1 = iso(0);            // tickDays=1 · 第 0 拍
    const d6_td1 = iso(6 * 1);        // tickDays=1 · 第 6 拍
    const d0_td3 = iso(0);            // tickDays=3 · 第 0 拍（起点与 tickDays 无关）
    const d6_td3 = iso(6 * 3);        // tickDays=3 · 第 6 拍
    expect([d0_td1, d6_td1, d0_td3, d6_td3]).toEqual(["2026-09-10", "2026-09-16", "2026-09-10", "2026-09-28"]);

    expect(t1).toContain(d0_td1);
    expect(t1).toContain(d6_td1);
    expect(t3).toContain(d0_td3);
    expect(t3).toContain(d6_td3);

    // 这一条才是对照实验本身：**换了口径，屏上的数必须真的跟着变**。
    expect(d6_td3).not.toBe(d6_td1);
    expect((Date.parse(d6_td3) - Date.parse(d6_td1)) / 86_400_000).toBe(12);
    expect(t3).not.toContain(d6_td1);

    // 「拍」不许被日期挤掉 —— 引擎收发的量就是拍，两层对不上账时要靠它追。
    expect(t1).toContain("第 6 拍");
    expect(t3).toContain("第 6 拍");
  });

  it("⑥b 取不到起始日 ⇒ 退回「第 N 拍」并说明，⛔ 不许编一个今天顶上", async () => {
    sessionCreatedAtRaw = null;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    const head = screen.getByTestId("c0828-tl-head").textContent ?? "";
    expect(head).toContain("第 0 拍");
    // 「没取到」与「没有」是两个命题，且都不许变成一个编出来的日期。
    expect(head).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const why = screen.getByTestId("c0828-tl-calibre").textContent ?? "";
    expect(why.trim().length).toBeGreaterThan(10);
    expect(why).toContain("按拍显示");
    // 今天的日期一个字都不许出现 —— 这正是「编一个今天顶上」的指纹。
    expect(why).not.toContain(new Date().toISOString().slice(0, 10));
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ⑦ 「N 种对策 ▸」点了要有反应（仓主实拍：点了没反应）
   * ════════════════════════════════════════════════════════════════════════════
   * 三条病因叠在一起，故断言也咬三条：面板**标题跟着选择走** · 选中态在按钮上
   * （`aria-pressed`）· **点默认那一项也算数**（它原本是「`picked` 前后完全相同」那一条）。
   * 变异反证：把 `setPickedFix` 改成空函数 ⇒ 本用例第一条断言必红。
   */
  it("⑦ 对策面板跟着选择走：点 A 标题是 A，点 B 变成 B，且选中态落在按钮上", async () => {
    withCandidates = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // 载荷里前两处带了对策 ⇒ 两条可选，够做 A/B 对照（一条的话这条臂等于没跑）。
    const buttons = screen.getAllByTestId(/^c0828-fixbtn-/);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const [btnA, btnB] = buttons as [HTMLElement, HTMLElement];
    const idA = (btnA.getAttribute("data-testid") ?? "").replace("c0828-fixbtn-", "");
    const idB = (btnB.getAttribute("data-testid") ?? "").replace("c0828-fixbtn-", "");
    expect(idA).not.toBe(idB);

    // 默认就画着第一处 ⇒ 选中态必须**一进来就标在它头上**，
    // 否则屏上会出现「面板画着 A，而 A 没被标选中」这种自相矛盾。
    expect(btnA.getAttribute("aria-pressed")).toBe("true");
    expect(btnB.getAttribute("aria-pressed")).toBe("false");

    // ⚠ 点**默认那一项**：`picked` 前后相同，但反馈不许因此消失。
    fireEvent.click(btnA);
    await waitFor(() => {
      expect(screen.getByTestId("c0828-fixbtn-" + idA).getAttribute("aria-pressed")).toBe("true");
    });
    const tagA = screen.getByTestId("c0828-options-tag").textContent ?? "";

    // 点 B ⇒ 面板**真的换了一处**（标题与辨识串同时变）。
    fireEvent.click(screen.getByTestId("c0828-fixbtn-" + idB));
    await waitFor(() => {
      expect(screen.getByTestId("c0828-fixbtn-" + idB).getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByTestId("c0828-fixbtn-" + idA).getAttribute("aria-pressed")).toBe("false");
    const tagB = screen.getByTestId("c0828-options-tag").textContent ?? "";

    // 这一条就是变异反证咬住的那个命题：`setPickedFix` 一被掐掉，两者当场相等。
    expect(tagB).not.toBe(tagA);
    // 辨识串必须真的指向被选中的那一处（重名两行靠它分开）。
    expect(tagB).toContain(idB.split("_").at(-1) ?? "");
  });

  it("⑦b 同名两行必须分得开：辨识串带判据码 + 落点，⛔ 不是「①②」这种序号", async () => {
    withCandidates = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    const rows = screen.getAllByTestId(/^c0828-fix-/);
    const tags = rows.map((r) => r.textContent ?? "");
    // 两行的可见文本不许一字不差 —— 这正是实拍里那两行「磷酸铁锂正极」的病。
    expect(new Set(tags).size).toBe(tags.length);
    for (const t of tags) {
      expect(t).toContain("判据 ");
      expect(t).toContain("落点 ");
    }
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ⑧⑨⑩⑪ WO-SIM-PLAIN-WORDS · 左栏加扰动表单：业务语言 + 一次性事件不摆「持续时长」
   * ════════════════════════════════════════════════════════════════════════════
   * ⑥ 管的是**时点**（第 N 拍 → 哪一天），已在上面。这四条管的是另外三件事：
   *  ⑧ **长度**这一头的主次（拍 vs 天），两个方向都要测；
   *  ⑨ 一次性事件**不渲染**「持续」那一格 —— 必须带反向臂，否则「永远不渲染」也会绿；
   *  ⑩ 它提交出去的 `durationTicks` 真的是 `null`（屏上没了不等于载荷里没了）；
   *  ⑪ 降层/改措辞**一个字都没删**。
   */
  describe("WO-SIM-PLAIN-WORDS · 加扰动表单的业务语言与时间形态", () => {
    /** 展开一件事的表单（不选落点、不提交）—— ⑧⑨⑪ 只看屏上的字。 */
    function openForm(eventId: string): void {
      fireEvent.click(screen.getByTestId(`c0828-ev-${eventId}`));
    }

    /**
     * 两个样本，**都从目录现取**、不写死：
     *  · `once`      样本 = `material-price-up`（fixture 里 `Material.priceShock` 可落地）
     *  · `sustained` 样本 = `capacity-loss`（fixture 里 `Base.loadIndex` 可落地）
     * 取完**当场核对它俩的 `timeShape` 真是一 once 一 sustained** —— 若有人把归类改了，
     * 这两个样本会静悄悄地变成同一类，⑨ 的「反向臂」就名存实亡（两臂测的是同一件事，照样全绿）。
     */
    const ONCE_ID = "material-price-up";
    const SUSTAINED_ID = "capacity-loss";
    function shapeOf(id: string): string {
      const ev = BUSINESS_EVENTS.find((e) => e.id === id);
      expect(ev, `目录里没有 ${id} —— 样本选错了，不是「这件事没有时间形态」`).toBeDefined();
      return (ev as { timeShape: string }).timeShape;
    }

    it("⑧ 对照实验 · 长度口径：持续填 3，tickDays 1→3 屏上必须从「3 天」变成「9 天」；取不到刻度则退回「3 拍」+ 原因", async () => {
      // ── 臂 1：tickDays = 1 ⇒ 一拍就是一天，单位词写「天」是逐字相等，不是换算。
      sessionTickDays = 1;
      mount();
      await railReady();
      openForm(SUSTAINED_ID);
      fireEvent.change(await screen.findByTestId(`c0828-dur-${SUSTAINED_ID}`), { target: { value: "3" } });
      const echoTd1 = screen.getByTestId(`c0828-dur-echo-${SUSTAINED_ID}`).textContent ?? "";
      expect(echoTd1).toContain("3 天");
      expect(echoTd1).toContain("（3 拍）"); // 拍不许删干净：后端回执上的量就是它
      cleanup();

      // ── 臂 2：tickDays = 3 ⇒ **同一个 3**，天数必须跟着口径变。这才是对照实验本身。
      perturbCalls = [];
      sessionTickDays = 3;
      mount();
      await railReady();
      openForm(SUSTAINED_ID);
      fireEvent.change(await screen.findByTestId(`c0828-dur-${SUSTAINED_ID}`), { target: { value: "3" } });
      const echoTd3 = screen.getByTestId(`c0828-dur-echo-${SUSTAINED_ID}`).textContent ?? "";
      expect(echoTd3).toContain("9 天");
      expect(echoTd3).toContain("（3 拍）");
      // 换了口径屏上的数真的变了 —— 两串不许相同（相同 = 那个乘法根本没接上 `tickDays`）。
      expect(echoTd3).not.toBe(echoTd1);
      cleanup();

      // ── 臂 3（反方向）：刻度真取不到 ⇒ 退回「N 拍」并写明为什么，⛔ 不许默认 tickDays=1 假装知道。
      perturbCalls = [];
      sessionTickDays = null;
      sessionCreatedAtRaw = null;
      mount();
      await railReady();
      openForm(SUSTAINED_ID);
      fireEvent.change(await screen.findByTestId(`c0828-dur-${SUSTAINED_ID}`), { target: { value: "3" } });
      const echoNone = screen.getByTestId(`c0828-dur-echo-${SUSTAINED_ID}`).textContent ?? "";
      expect(echoNone).toContain("3 拍");
      expect(echoNone).toContain("按拍显示"); // 原因必须在场
      // 「3 天」这个编出来的数一个字都不许出现 —— 那正是「默认 tickDays=1 假装知道」的指纹。
      expect(echoNone).not.toContain("3 天");
    });

    it("⑨ 一次性事件查不到「持续」那一格，持续型查得到（反向臂缺一条则「永远不渲染」也会绿）", async () => {
      // 金丝雀：两个样本必须真是一 once 一 sustained，否则下面两臂测的是同一件事。
      expect(shapeOf(ONCE_ID)).toBe("once");
      expect(shapeOf(SUSTAINED_ID)).toBe("sustained");
      // 目录层面两类都非空 —— 全 once（或全 sustained）时本用例会退化成单臂。
      const onceN = BUSINESS_EVENTS.filter((e) => e.timeShape === "once").length;
      const sustN = BUSINESS_EVENTS.filter((e) => e.timeShape === "sustained").length;
      expect(onceN).toBeGreaterThan(0);
      expect(sustN).toBeGreaterThan(0);
      expect(onceN + sustN).toBe(BUSINESS_EVENTS.length);

      mount();
      await railReady();

      // ── 正臂：一次性 ⇒ 没有「持续」那一格，且第一层说清为什么没有。
      openForm(ONCE_ID);
      await screen.findByTestId(`c0828-form-${ONCE_ID}`);
      expect(screen.queryByTestId(`c0828-dur-${ONCE_ID}`)).toBeNull();
      // 「没有这一格」必须配一句解释，⛔ 不许只是悄悄少一格（少一格用户会当成 bug）。
      expect(screen.getByTestId(`c0828-seg2-${ONCE_ID}`).textContent ?? "").toContain("一次性变更，之后一直生效");
      expect((screen.getByTestId(`c0828-once-${ONCE_ID}`).textContent ?? "").length).toBeGreaterThan(20);

      // ── 反臂：持续型 ⇒ 那一格必须在。没有这一臂，组件里写死 `return null` 也照样全绿。
      openForm(ONCE_ID); // 收起上一件
      openForm(SUSTAINED_ID);
      await screen.findByTestId(`c0828-form-${SUSTAINED_ID}`);
      expect(screen.queryByTestId(`c0828-dur-${SUSTAINED_ID}`)).not.toBeNull();
      expect(screen.queryByTestId(`c0828-once-${SUSTAINED_ID}`)).toBeNull();
      expect(screen.getByTestId(`c0828-seg2-${SUSTAINED_ID}`).textContent ?? "").not.toContain("一次性变更");
    });

    it("⑩ 提交形状：一次性事件的载荷 `durationTicks === null`（永久）；持续型填了 3 就发 3", async () => {
      sessionTickDays = 1;
      mount();
      await railReady();

      // 一次性：表单上压根没有那一格 ⇒ 载荷必须显式 `null`（契约「null = 永久」），
      // ⛔ 不是 `undefined` 蒙混，也不是 0（0 会被契约 zod `min(1)` 拒）。
      await addEvent(ONCE_ID, "mat_licarb", 15);
      // 持续型对照臂：同一次推演里填 3 ⇒ 必须原样发出去。
      // 没有这一臂，组件里把 `durationTicks` 写死成 `null` 也会全绿。
      openForm(SUSTAINED_ID);
      const sel = await screen.findByTestId(`c0828-pick-${SUSTAINED_ID}`);
      await waitFor(() => {
        expect(within(sel as HTMLSelectElement).getAllByRole("option").length).toBeGreaterThan(1);
      });
      fireEvent.change(sel, { target: { value: "base_cz" } });
      fireEvent.change(screen.getByTestId(`c0828-dur-${SUSTAINED_ID}`), { target: { value: "3" } });
      fireEvent.click(screen.getByTestId(`c0828-add-${SUSTAINED_ID}`));

      fireEvent.click(screen.getByTestId("c0828-go"));
      await screen.findByTestId("c0828-money");

      expect(perturbCalls).toHaveLength(2);
      const onceCall = perturbCalls.find((c) => String(c.targetObjectId) === "mat_licarb");
      const sustCall = perturbCalls.find((c) => String(c.targetObjectId) === "base_cz");
      expect(onceCall, "一次性那条扰动没发出去 —— 后面的断言就不度量本条命题了").toBeDefined();
      expect(sustCall).toBeDefined();
      expect(Object.keys(onceCall as object)).toContain("durationTicks"); // 键必须在（不是 undefined 蒙混）
      expect((onceCall as { durationTicks: unknown }).durationTicks).toBeNull();
      expect((sustCall as { durationTicks: unknown }).durationTicks).toBe(3);

      // `mode` 一条都没改：一次性靠 `durationTicks:null` 表达，不是靠 `mode:"set"`。
      // （`set` 把相对量 15% 当成「把该量设为 15」，不会报错，只会静默算错。）
      expect((onceCall as { mode: unknown }).mode).toBe("delta");
    });

    it("⑪ 一个字都没删：改措辞/降层前表单上有的可读文本，改完之后一条不少", async () => {
      sessionTickDays = 1;
      mount();
      await railReady();
      openForm(SUSTAINED_ID);
      const form = await screen.findByTestId(`c0828-form-${SUSTAINED_ID}`);
      const text = form.textContent ?? "";

      /**
       * 下面这一串是**改动之前**表单区就有的可读内容，逐条抄下来当断言
       * （判据 4：降层允许、删除不允许 —— `docs/CONVENTION-ui-information-layering.md` §1）。
       * ⚠ 抄的是**语义单位**不是整句：措辞本来就要改（那正是本单要做的事），
       *   能拿来当「没被删掉」证据的只有那些**不因改措辞而消失的诚实位**。
       */
      const MUST_KEEP = [
        "落点对象", // 选哪一个实体
        "幅度", // 加多少
        "Base", // 落点类型（typeKey）—— 降到第二层，⛔ 不许删
        "loadIndex", // 状态变量（stateVar）—— 同上
        "整段落在过去", // 「填了也不生效」那条诚实位
        "201", // 后端仍会受理这件事本身
      ];
      for (const s of MUST_KEEP) {
        expect(text, `表单里丢了「${s}」—— 降层允许，删除不允许`).toContain(s);
      }
      // `ev.detail`（这件事先推动什么）整句仍在第二层。
      const ev = BUSINESS_EVENTS.find((e) => e.id === SUSTAINED_ID) as { detail: string };
      expect(text).toContain(ev.detail);

      // 三段式的三个抬头都在，且就是仓主说的那三个词、那个顺序。
      const i1 = text.indexOf("什么事");
      const i2 = text.indexOf("发生时间");
      const i3 = text.indexOf("调整了什么");
      expect(i1).toBeGreaterThanOrEqual(0);
      expect(i2).toBeGreaterThan(i1);
      expect(i3).toBeGreaterThan(i2);

      // 内部字段名**降层不删**：typeKey / stateVar 必须在 `<details>` 里，不在第一层。
      const detailsText = (form.querySelector("details")?.textContent ?? "");
      expect(detailsText).toContain("Base");
      expect(detailsText).toContain("loadIndex");
    });
  });
});
