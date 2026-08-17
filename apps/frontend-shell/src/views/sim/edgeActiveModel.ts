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
  /**
   * 源对象类型的**人话名**（`生产基地`）—— 取自本体 `ObjectType.displayName`，
   * 查不到就回落成类型 key 原文。⛔ **前端一个中文名都不许内联**（R14 零业务常数 +
   * `G-GATE-ROSTER-HANDCOPIED`）：本仓 `fetchObjectTypes` 的注释原文就是
   * 「前端**只消费 `displayName ?? propKey`**，不得内联任何中文名映射」。
   */
  sourceTypeName: string;
  /** 目标对象类型的人话名（口径同上）。 */
  targetTypeName: string;
  /** 域 key（`D05`）；`null` = 未归域（target 不是任何流程的承载物）。 */
  domainKey: string | null;
  /** 域的人话名；`null` 同上。 */
  domainName: string | null;
}

/**
 * 一个域的切片（= 屏上的一个 chip + 它管的那些行）。
 *
 * ⛔ **`count` 必须从 `rows.length` 现算，不许另存一个数** —— 两个数就有两套真相，
 * 而"chip 上写着 7 条、点开只有 5 行"正是本单要防的那种错（分类里凭空少掉边）。
 */
export interface DomainSliceVM {
  /** 域 key；`null` = 未归域分片。 */
  key: string | null;
  /**
   * 选中态与 testid 用的稳定串（`key` 或 `__unassigned__`）。
   * 单独给一个是因为 `key` 可空，而"当前选中哪一片"必须是个**能相等比较的值** ——
   * 拿 `null` 当选中值，就分不出「选中了未归域」与「什么都没选中」。
   */
  sliceId: string;
  /** chip 上显示的名字。未归域用平台自有措辞，不编一个业务域名出来。 */
  name: string;
  /** 该域的边数 —— **恒等于 `rows.length`**（见上）。 */
  count: number;
  rows: EdgeRowVM[];
}

/** 未归域分片的 `sliceId`（不是域 key —— 它不是一个域）。 */
export const UNASSIGNED_SLICE_ID = "__unassigned__";

/** 未归域分片的 chip 名（**不是**某个业务域的名字，是"这些边的归属在数据里没定义"这句话）。 */
export const UNASSIGNED_DOMAIN_LABEL = "未归域";
/** 未归域分片的说明（屏上真渲染 —— 不解释就会被读成"系统漏了"）。 */
export const UNASSIGNED_DOMAIN_DETAIL =
  "这些边的目标对象类型不是任何业务流程的承载物，因此在数据里没有域归属。" +
  "它们多是链路上的中间跳（压力从这里穿过去，落点在别的域）。这是数据的实情，不是漏填 —— 故单列一片，不塞进最近的那个域。";

/**
 * 边目录 → 按业务域切片（**分组依据只有一个：边自己带的 `domainKey`**）。
 *
 * ⛔ **前端不许存任何「规则→域」的对照表**（本体 §8 `G-GATE-ROSTER-HANDCOPIED`）：
 * 手抄名单里没有的规则**永远绿、永远漏** —— 新增一条边忘了加进表里，它就从分类里消失，
 * 而没有任何东西会报错。域由产出这批边的那一侧（`seed.ts resolveRuleDomain`）算好随边下发，
 * 本函数只做 `groupBy`，一个业务判断都不做。
 *
 * 排序（R6 全序，同输入同屏）：域 key 升序，**未归域恒垫底**（它不是一个业务域，
 * 混在字母序里会让人以为它和别的域平级）。
 */
export function buildDomainSlices(rows: readonly EdgeRowVM[]): DomainSliceVM[] {
  const byKey = new Map<string, DomainSliceVM>();
  const unassigned: EdgeRowVM[] = [];
  for (const r of rows) {
    if (r.domainKey === null) {
      unassigned.push(r);
      continue;
    }
    const cur = byKey.get(r.domainKey);
    if (cur) cur.rows.push(r);
    // 名字取这条边自带的那个；缺名就显 key 原文，**不编一个中文名**（诚实缺席）。
    else byKey.set(r.domainKey, { key: r.domainKey, sliceId: r.domainKey, name: r.domainName ?? r.domainKey, count: 0, rows: [r] });
  }
  const slices = [...byKey.values()].sort((a, b) => a.sliceId.localeCompare(b.sliceId));
  if (unassigned.length > 0) {
    slices.push({ key: null, sliceId: UNASSIGNED_SLICE_ID, name: UNASSIGNED_DOMAIN_LABEL, count: 0, rows: unassigned });
  }
  // count 一律回填成 rows.length —— 这一行就是"两个数不许分家"在代码里的落点。
  return slices.map((s) => ({ ...s, count: s.rows.length }));
}

/**
 * 当前该选中哪个 chip（**受控回落**，不是每次渲染重算一个）。
 *
 * 为什么需要它：切片数量会随数据变（换租户、加边、后端只回 published）。
 * 用户选中的那个域若在新数据里没有了，屏上不能变成"一个 chip 都没选中 ⇒ 一行都不显示"
 * —— 那看起来和"这页坏了"一模一样。故：选中的还在就保持，不在就回落到第一片。
 */
export function resolveActiveSlice(slices: readonly DomainSliceVM[], picked: string | null): string | null {
  if (slices.length === 0) return null;
  return slices.some((s) => s.sliceId === picked) ? picked : slices[0]!.sliceId;
}

/**
 * 边目录 + 屏蔽集 → 行模型（**确定性排序**：按 `key` 字典序，同一份输入永远同一个屏幕）。
 *
 * 为什么排序写在这里而不是靠后端顺序：后端 `listPropagationRules` 已按 key 排，
 * 但 `published=false` 那条路、mock、以及将来任何新的边来源都不保证——
 * 排序是这一屏的**语义**（用户按位置记住那一行），不能指望上游碰巧是对的。
 */
export function buildEdgeRows(
  rules: readonly PropagationRule[],
  disabledRuleKeys: readonly string[],
  /**
   * `对象类型 key → displayName`（来自 `GET /a/v1/ontology/object-types`）。
   * **缺省空 Map ⇒ 人话名逐条回落成类型 key** —— 与本字段引入前逐字节同屏（additive 可回退），
   * 也保证名字这一路取不回来时页面照常可用（"名字没取到"不该让开关面板整块消失）。
   */
  typeDisplayNames: ReadonlyMap<string, string> = new Map(),
): EdgeRowVM[] {
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
        // `displayName ?? key`：查不到就显裸键，**不渲染空白、也不内联中文名映射**
        // （`fetchObjectTypes` 注释立的同一条规矩）。
        sourceTypeName: typeDisplayNames.get(r.sourceTypeKey) ?? r.sourceTypeKey,
        targetTypeName: typeDisplayNames.get(r.targetTypeKey) ?? r.targetTypeKey,
        // 域**直取后端下发的字段**，前端零加工、零对照表（`G-GATE-ROSTER-HANDCOPIED`）。
        // `?? null`：老响应/租户自建边没有这两个字段 ⇒ 读作未归域，不 crash。
        domainKey: r.domainKey ?? null,
        domainName: r.domainName ?? null,
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
  /** 方向记号：↑/↓/→/？。`？` = 两侧都没有这一格（真的算不出，不上桌）。 */
  arrow: "↑" | "↓" | "→" | "？";
  /** 已带正负号的量级文本（如 `+3.20` / `−1.05`）。 */
  deltaText: string;
  /**
   * 这一格在哪一版世界里**根本不存在**（不是"值为 0"）。
   * 屏上必须分得开：「关掉这条边之后，这个状态变量整个没了」与「它变成了 0」是两句不同的话，
   * 而 `delta` 两种情形都按引擎约定算成 −10 —— 不标出来就把这个区别抹掉了。
   */
  absentIn: "none" | "baseline" | "counterfactual";
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
      deltaText: c.delta === null ? "算不出" : fmt(c.delta),
      absentIn: c.baseline === null ? "baseline" : c.counterfactual === null ? "counterfactual" : "none",
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
/**
 * `deriveBaseSnapshot` 产出的那批读数的**来源记号**（屏上真渲染的字符串，不是注释）。
 *
 * 为什么必须是导出的常量而不是各页各写一句：`hash01` 派生出的数**长得和真值一模一样**
 * （有量纲感、有小数位、会随对象变化），用户没有任何办法分辨。记号只有一份、跟着这个函数走，
 * 才不会出现"迁了实现、记号留在原文件"的情况 —— 本单迁移 `deriveBaseSnapshot` 时，
 * `screen-value-provenance:check` **当场就是这么报红的**：源点跟着代码走了，记号没跟。
 *
 * ⚠ 不许为了让门变绿在文件里随手塞一个含"占位"二字的字符串（门只到文件级，确实拦不住）——
 * 那是把一个可见的债换成一个看不见的谎。本常量**必须真的渲染在屏上**
 * （消费方：`EdgeActivePanel` 的探针世界出处段）。
 */
export const PROBE_WORLD_PROVENANCE = "占位·未实测";
/** 探针世界出处的完整说明（同上，屏上真渲染）。 */
export const PROBE_WORLD_PROVENANCE_DETAIL =
  "本页就地开的探针世界，其 tick0 世界态由本体配置结构派生（合成占位值，非实测）。" +
  "下方差值反映的是这条边的结构影响（系数 × 延迟 × 链路扇出），量级不可当实测读。";

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
