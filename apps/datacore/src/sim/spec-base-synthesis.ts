/**
 * C2 合成层 · `state = 派生基值 + 累积传导量`（WO-CONSOLE-DUE-CHANGE 干预实验）。
 *
 * 🔴 病灶（实测定稿，见 `docs/evidence/WO-DUE-CHANGE-rootcause.md`）：
 *   传导核**只看得见传导图**，判「这格该不该衰减」用的是 `isExogenous`（= 入度是否为 0）。
 *   而有一类格的**真值不在图上** —— 它由本体派生规格算得、**播种期已物化在对象同名属性上**
 *   （`seed-world.ts` 那条 `o.props[v]` 取法）。这类格里**入度>0** 的那 17 格
 *   既不被豁免、又无人补基值 ⇒ 退化成**纯传导积分器**：
 *   读数 = 净入流的产物，与规格值无关（净负→贴地板、净正→涨飞）。
 *   实测锚点：`SO-3391` 规格值恒 60（`demandDelta×100`，props 10 拍 0 变化），屏上第 10 拍读 **0**。
 *
 * ⛔ 三条不许（都由根因链推出，别再试）：
 *   · 不许在 tick 里调 `runDerivations` —— 它是**变更驱动**的，空 `changes` ⇒ 逐节点 `continue`
 *     ⇒ **空转**（`assembleCertification` 就是活证据：调了，`updatedObjects` 恒 0）。
 *   · 不许让传导核（`propagation.ts`）认识规格格 —— 违反契约 `sim.ts:13`「传导态 §1.2 **纯数值，无业务语义**」。
 *     本模块刻意**独立成文件**、由调用方在核**之外**合成，就是为了守住这条边界。
 *   · 不许在衰减相里 `continue` 掉规格格 —— 那会把它**冻死**在 tick0（就是那 8 个入度 0 的格
 *     现在的样子：恒定、且扰动再也进不去）。
 *
 * ✅ 修法 = 在传导层**之外**合成。代数上等价于「衰减只作用于累积量」：
 *     核 给   x' = rest + (1−λ)(x − rest) + c = (1−λ)x + λ·rest + c
 *     想要    x' = base + (1−λ)(x − base) + c = (1−λ)x + λ·base + c
 *     **差 = λ·(base − rest)** —— 一次加法，不碰核。
 *
 * ── ⛔⛔ 这个文件为什么存在（以及它的前身踩过的两个坑，别再犯）────────────────────────────
 *
 * **坑 1 · 守卫条件写错 ⇒ 从「修 17 格」变成「改全世界」。**
 *   第一版写的是 `if (typeof base !== "number") continue;`，注释还自称
 *   「缺键 = 该格不是规格格 ⇒ 跳过」—— **那句话是错的**：播种路（`seed-world.ts`）
 *   对**每一格**都写数（有同名 prop 写 prop，没有则写 `round(seedHash01(...)×100)`），
 *   **`baseSnapshot` 的键永不缺失**。于是判据恒真，合成作用在**全世界每一个非外生衰减格**上，
 *   把合法瞬态也锚死在 tick0 ⇒ 4 个文件 6 条测试变红（A/B 实测，见
 *   `docs/evidence/WO-DUE-CHANGE-c2-intervention.md`）。
 *   **正确判据 = 「这格归不归派生规格所有」**，且仓里**已经有**这个函数：
 *   `stateVarValueRef(typeKey, stateVar)`（`synthetic/battery.ts`）—— 播种路自己就在用它
 *   （`measuredRefVarKeys` 那一行）。**复用它，不许另立一份登记表。**
 *
 * **坑 2 · 只改生产 tick 路 ⇒ 与手工镜像的回放环分叉。**
 *   `metric-series.ts` 的回放环是 `simAdvanceTicks` 的**手工镜像副本**（该文件 `:84` 自述
 *   「逐行对齐」，`:39` 自述为什么不复用）。第一版只给生产路加了合成，
 *   镜像副本没跟上 ⇒ 曲线与落盘世界对不上 ⇒ `sim-seed-world.seam.test.ts ⑤` 当场变红。
 *   ⚠ **那一臂 `:stateVarDomains` 文档里记着同一个错的**上一次**：
 *   「本模块的回放曾只传 `pairWeights` 不传 `stateVarDomains`」——
 *   **接缝门在同一个地方咬了第二次，这是设计意图，不是意外。**
 *   ⇒ 本模块存在的**第二个理由**：一份实现、两个调用点。**⛔ 不许再各写一份。**
 *
 * 🔴 **第三件必须知道的事（WO-3ROOT-P3）——本模块只写了答案的一半**：
 *   上面那行代数 `cur + λ·(base − rest)` 的产物**可以出域**（`λ·base` 直接继承了播种基值的
 *   符号与量级：实测 `Material.elyte.shortageRisk` 得 −59.724650，而同一拍回执报「已夹到 0」）。
 *   域**不在本模块里执行**，也**不许**在本模块里补一刀 —— 补了就是第二真相源，且"代数一行不改"
 *   这条硬约束当场破。三条写路的域统一在**出口**执行：唯一投影入口 `sim/world-projection.ts`
 *   （`projectWorldCells`），由**调用方**在本函数返回**之后**、`putTickState` **之前**调一次。
 *   ⛔ 次序不许颠倒：先投影再合成 = 刚收回来的值又被代数覆写掉，退回病灶（见该文件头注「三条不许」）。
 */
import { buildCellRoles, type PropagationRule, type StateVarDomainLookup, type TickState } from "@platform/contracts";
import { stateVarValueRef, stateVarSemantics } from "../synthetic/battery.js";
import { round12, type PropagationGraph } from "./propagation.js";

export interface SpecBaseSynthesisDeps {
  /**
   * tick0 世界态（建会话时写一次、此后不动）。
   * · 生产路传 `s.baseSnapshot`；回放环传它自己的 `seed`（契约要求是**本会话自己**的 tick0 行）。
   * · ⚠ 必须用**不含扰动**的那一份：扰动是施加在当前态上的，用当前态当基值会把扰动重复补一遍。
   */
  baseSnapshot: TickState;
  graph: PropagationGraph;
  /** 本跑真正喂进引擎的规则集（与 `propagateTick` 第 3 位同一份）。 */
  rules: readonly PropagationRule[];
  stateVarDomains: StateVarDomainLookup | undefined;
}

/** `(state, decayed) => void` —— 就地改写 `state`，与 `propagateTick` 的 `next` 同一个对象。 */
export type RestoreSpecBase = (state: TickState, decayed: Record<string, number>) => void;

export function makeRestoreSpecBase(deps: SpecBaseSynthesisDeps): RestoreSpecBase {
  const objType = new Map(deps.graph.objects.map((o) => [o.id, o.typeKey]));
  const cellRoles = buildCellRoles(deps.rules as PropagationRule[]);
  return (st: TickState, decayed: Record<string, number>): void => {
    for (const objId of Object.keys(st)) {
      const baseRow = deps.baseSnapshot[objId];
      if (baseRow === undefined) continue;
      const tk = objType.get(objId);
      if (tk === undefined) continue; // 不在传导图里的对象：判不了外生，按核的行为不动它
      const bucket = st[objId]!;
      for (const sv of Object.keys(bucket)) {
        const lambda = decayed[sv];
        if (lambda === undefined) continue; // 本拍此量纲没衰减 ⇒ 没有基值可丢
        // 核本就没动这一格（外生豁免）⇒ 它已经冻在基值上，再补就把它顶到基值之上。
        if (cellRoles.isExogenous(tk, sv)) continue;
        // 🔴 判据是「**归不归派生规格所有**」，不是「baseSnapshot 里有没有键」（那永远有）。
        //    与播种路（`seed-world.ts` 的 `measuredRefVarKeys`）**同一个函数**，不另立登记表。
        if (stateVarValueRef(tk, sv) === undefined) continue;
        // ★ WO-SEMANTICS-DECLARED：`DEVIATION` 语义的格【跳过】——
        //   本模块的活是「把核的 rest 锚换成 base 锚」。语义一旦定死，锚就唯一了：
        //     · 声明 `DEVIATION` ⇒ 锚**就是** `restPoint` ⇒ 核已经用对了 ⇒ C2 对它恒等，无活可干
        //     · 声明 `LEVEL`     ⇒ 锚是 `base`（规格产出的水平值）⇒ 正是本模块要补的那个差
        //   ⛔ 本行与播种值那一支（`seed-world.ts` 的 DEVIATION 分支）**必须同批落地**：
        //      只做本行 ⇒ 零臂的 `−λx` 与 `+λ·base` 失去抵消 ⇒ 零臂从 90.38 指数衰减到 0。
        if (stateVarSemantics(tk, sv) !== "LEVEL") continue;
        const base = baseRow[sv];
        if (typeof base !== "number") continue;
        const cur = bucket[sv];
        if (typeof cur !== "number") continue;
        const rest = deps.stateVarDomains?.[sv]?.restPoint ?? 0;
        bucket[sv] = round12(cur + lambda * (base - rest));
      }
    }
  };
}
