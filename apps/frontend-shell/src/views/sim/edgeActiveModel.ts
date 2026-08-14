/**
 * 推演边 active 开关的**纯模型**（WO-ACTIVE-EDGE-UX · 无 React 依赖，好测）。
 *
 * 仓主原话：「所有推演的功能，包括"推演沙盘"就需要借鉴这个设计UX」——
 * 指参考件里那个能力：**关系边上有 active 开关，关掉这条边，就能看到推演结果怎么变**。
 * 本文件负责三件事，全部是纯函数：
 *   ① 边列表 → 每行的展示模型（含开关状态、关掉后的降级标记）
 *   ② 开关状态 → 请求体（候选屏蔽集）
 *   ③ 开/关两版结果 → 差异视图模型（方向 + 量级 + 排序）
 *
 * ⛔ **零业务常数（R14）**：本文件不出现任何行业实体名/阈值/文案常量——边的类型名、状态变量名、
 * 系数、延迟全部来自后端下发的 `PropagationRule`（= 租户自己的本体派生）。换租户=换本体内容不改代码。
 *
 * ⛔ **差值算法不在这里重写**：`diffTickStates` 在 `@platform/contracts`，前后端共用同一支。
 * 前端另写一份 `cf - base` 看着无害，但两侧一旦漂移（取整、缺格当 0、容差），
 * 屏上那个"关掉这条边涨了 3.2"就是个查无对证的数。本文件只做**排版**，不做**算术**。
 */
import type { PropagationRule, SandboxViewConfig, SimCounterfactualResult, SimStateDiffCell, TickState } from "@platform/contracts";

/** 一行边的展示模型。 */
export interface EdgeRowVM {
  /** 稳定键（= `PropagationRule.key`）。开关、请求体、差值归因全部认它，不认 `id`（randomBytes 会漂）。 */
  key: string;
  /** `源类型.状态变量` —— 用平台自有术语，不引外部产品名。 */
  from: string;
  /** `目标类型.状态变量`。 */
  to: string;
  /** 经由的链路 key。 */
  viaLinkKey: string;
  coefficient: number;
  delayTicks: number;
  /** `true` = 这条边此刻**开着**（参与推演）；`false` = 本次推演假装它不存在。 */
  active: boolean;
  /**
   * 关掉的边**不从图上消失，只降级**（§3.3）。这个标记就是"降级"的载体：
   * 消失了用户就不知道自己关了什么，也就无从把它拨回来。
   */
  dimmed: boolean;
}

/**
 * 边目录 + 屏蔽集 → 行模型（**确定性排序**：按 `key` 字典序，同一份输入永远同一个屏幕）。
 *
 * 为什么排序写在这里而不是靠后端顺序：后端 `listPropagationRules` 已按 key 排，
 * 但 `published=false` 那条路、mock、以及将来任何新的边来源都不保证——
 * 排序是这一屏的**语义**（用户按位置记住那一行），不能指望上游碰巧是对的。
 */
export function buildEdgeRows(rules: readonly PropagationRule[], disabledRuleKeys: readonly string[]): EdgeRowVM[] {
  const off = new Set(disabledRuleKeys);
  return [...rules]
    .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
    .map((r) => {
      const active = !off.has(r.key);
      return {
        key: r.key,
        from: `${r.sourceTypeKey}.${r.sourceStateVar}`,
        to: `${r.targetTypeKey}.${r.targetStateVar}`,
        viaLinkKey: r.viaLinkKey,
        coefficient: r.coefficient,
        delayTicks: r.delayTicks,
        active,
        dimmed: !active,
      };
    });
}

/**
 * 拨一下某条边的开关 → 新的候选屏蔽集（**去重 + 全序**，同输入同输出 R6）。
 *
 * 返回的是**下一次请求要发的那个集合**，不是"差量"——差量在两端各算一次就会漂。
 */
export function toggleEdge(disabledRuleKeys: readonly string[], key: string, nextActive: boolean): string[] {
  const off = new Set(disabledRuleKeys);
  if (nextActive) off.delete(key);
  else off.add(key);
  return [...off].sort();
}

/** 差异行的展示模型（§3.3：一眼看出**方向和量级**，不是只标个"变了"）。 */
export interface DiffRowVM {
  objectId: string;
  stateVar: string;
  baseline: number | null;
  counterfactual: number | null;
  delta: number | null;
  direction: SimStateDiffCell["direction"];
  /** 方向记号：↑/↓/→/？。`？` = 算不出（某一侧缺这一格），**不拿 0 冒充"没变"**。 */
  arrow: "↑" | "↓" | "→" | "？";
  /** 已带正负号的量级文本（如 `+3.20` / `−1.05`）。`null` 侧一律显式写"缺"。 */
  deltaText: string;
  /** 相对基线的变化幅度（0-1）；基线为 0 或缺失 ⇒ `null`（不造一个百分比出来）。 */
  relative: number | null;
}

/** 六位定点：与引擎 `round12` 同族纪律——屏上不显示浮点噪声，但也不四舍五入到看不出变化。 */
function fmt(n: number): string {
  const r = Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(4);
  // U+2212 MINUS SIGN：小字号下 ASCII 的 `-` 与 `–` 难辨，负号必须一眼可读。
  return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Number(r)).toString();
}

/**
 * 逐格差异 → 差异行（按**影响量级降序**：用户先要看见"最受影响的是谁"）。
 * 量级相同再按 objectId/stateVar 字典序 ⇒ 全序，重跑同屏（R6）。
 */
export function buildDiffRows(cells: readonly SimStateDiffCell[]): DiffRowVM[] {
  return [...cells]
    .map((c): DiffRowVM => ({
      objectId: c.objectId,
      stateVar: c.stateVar,
      baseline: c.baseline,
      counterfactual: c.counterfactual,
      delta: c.delta,
      direction: c.direction,
      arrow: c.direction === "up" ? "↑" : c.direction === "down" ? "↓" : c.direction === "flat" ? "→" : "？",
      deltaText: c.delta === null ? "缺" : fmt(c.delta),
      relative:
        c.delta === null || c.baseline === null || c.baseline === 0 ? null : c.delta / Math.abs(c.baseline),
    }))
    .sort(
      (a, b) =>
        Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
        a.objectId.localeCompare(b.objectId) ||
        a.stateVar.localeCompare(b.stateVar),
    );
}

/**
 * 对照结果 → 一句**诚实**的结论。
 *
 * ⚠ 这里是本单最容易出静默错答的地方：「关掉这条边，什么都没变」有**两个完全不同的成因**，
 * 屏上长得一模一样：
 *   ① 这条边在基线里**真的跑了**，但它的贡献恰好被下游吃掉/裁掉 ⇒ "关掉它确实没影响"
 *   ② 这条边在基线里**压根没触发**（源态为 0 / 无匹配边 / 被节拍闸门挡住） ⇒ "它本来就没在动"
 * 后端 `suppressedRulesFiredInBaseline` 就是为分开这两件事而存在的诚实位；
 * 前端必须用它，不许把两种情况都写成"无影响"。
 */
export type EdgeVerdictKind = "CHANGED" | "NO_EFFECT" | "NEVER_FIRED" | "NOTHING_DISABLED";
export interface EdgeVerdict {
  kind: EdgeVerdictKind;
  /** 给人看的一句话，逐字含**依据**，不含任何断言性因果猜测。 */
  text: string;
  /** 受影响的格数。 */
  changedCells: number;
}

export function buildVerdict(result: SimCounterfactualResult): EdgeVerdict {
  const off = result.disabledRuleKeys.length;
  if (off === 0) {
    return { kind: "NOTHING_DISABLED", text: "当前没有关掉任何边——把某条边的开关拨到关，即可看到推演结果的差异。", changedCells: 0 };
  }
  if (result.diffs.length > 0) {
    return {
      kind: "CHANGED",
      text: `关掉 ${off} 条边后，${result.diffs.length} 个状态变量的取值发生变化（对照跑 ${result.ticks} 个 tick，未写入会话）。`,
      changedCells: result.diffs.length,
    };
  }
  const fired = result.suppressedRulesFiredInBaseline.length;
  if (fired === 0) {
    return {
      kind: "NEVER_FIRED",
      text:
        `关掉的这 ${off} 条边在"边开着"那一版里**一次都没触发**（后端 suppressedRulesFiredInBaseline 为空），` +
        `所以差值为空说明的是"它本来就没在动"，不是"关掉它没有影响"——两者不是一回事。`,
      changedCells: 0,
    };
  }
  return {
    kind: "NO_EFFECT",
    text: `关掉的这 ${off} 条边在基线里确实触发过（${fired} 条），但对照后没有任何状态变量取值改变。`,
    changedCells: 0,
  };
}

/**
 * 从若干会话里挑"本页该拿哪个世界来对照"。
 *
 * 判据（有来历，别改成"取第一个"）：
 *  · 排除方案快照会话（`scope.snapshotKind` 非空）——那是 `WO-LIVE-ENDPOINTS` 借用 `sim_session`
 *    存的活方案 bag，不是可推演的世界（后端 `GET /a/v1/sim/sessions` 已滤，这里是第二道保险：
 *    别的入口拿到的列表未必滤过）。
 *  · 其余按 `createdAt` 降序取最新 ⇒ 同一份输入永远选同一个（R6），不靠数组顺序碰运气。
 */
export function pickProbeSession<T extends { id: string; createdAt: string; scope: Record<string, unknown> }>(
  sessions: readonly T[],
): T | null {
  const usable = sessions.filter((s) => !(s.scope as { snapshotKind?: unknown })?.snapshotKind);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}

// ── tick0 世界态派生（**从 SandboxView 迁来，不是新写的第二份**）─────────────────────────
/**
 * 字符串 → 稳定 [0,1)（把抽象 key 映射成可视初值；与行业无关，R14）。
 *
 * ⚠ **迁移说明（重要，别读成"又造了一份"）**：`hash01` / `deriveBaseSnapshot` 原本住在
 * `SandboxView.tsx`，本单把它们迁到这里、由 `SandboxView` 反向 import —— **实现一行未改**，
 * 迁的唯一理由是：`EdgeActivePanel` 也要用它（给没有推演世界的页就地开一个探针世界），
 * 而 `SandboxView → EdgeActivePanel` 已经是一条依赖边，反向 import 会成环。
 * 在这里放一份**副本**才是错的：两份 tick0 派生 ⇒ 沙盘的世界与探针世界不是同一个世界，
 * 而用户看到的差值会因此对不上账。
 */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * 从配置派生 tick0 世界态。键 = **真物化对象 id**（`cfg.nodeObjectIds`，与 `propagateTick` 引擎
 * `idsByType` 同源）→ `state[sourceId]` 真命中 → tick 真传导。
 * 空世界（该类型无对象）退 `${type}#0` 占位（无传导，页面仍可跑）。
 *
 * ⚠ **这批值是 `DERIVED` 占位、不是实测**（`SandboxView` 的 `WorldOrigin` 章程原文）。
 * 凡是拿它当起点算出来的差值，界面上必须跟着标出处 —— 见 `EdgeActivePanel` 里那句
 * 「本页就地开的探针世界」。不标 = 把占位值算出来的数当实测给人看，那是 R13 明令禁止的。
 */
export function deriveBaseSnapshot(cfg: SandboxViewConfig): TickState {
  const state: TickState = {};
  const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"]; // 无传导规则态：单占位变量，保证页面可跑
  for (const t of cfg.nodeTypes) {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`]; // 有真对象用真 id；空世界退占位键
    for (const oid of keys) {
      const row: Record<string, number> = {};
      for (const v of vars) row[v] = Math.round(hash01(`${oid}|${v}`) * 100);
      state[oid] = row;
    }
  }
  return state;
}
