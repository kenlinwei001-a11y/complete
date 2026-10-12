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
import type { PropagationRule, SimCounterfactualResult, SimStateDiffCell } from "@platform/contracts";
// WO-STATEVAR-DISPLAYNAME：状态变量中文名的唯一消费路径（真值源在后端，此处只翻译不编名）
import { qualifiedStateVarText, stateVarText } from "./stateVarLabel";

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
  /**
   * WO-STATEVAR-DISPLAYNAME · 源端第一级整串：`类型人话名 · 状态变量人话名`
   * （`生产基地 · 负载指数`）。
   *
   * 改前第一级**只有类型名** —— 因为状态变量在全仓没有任何中文名可查（那是**没接线**：
   * 契约里压根没有承载它的字段），于是同一个 `生产基地` 会在屏上出现 5 次而彼此不可区分，
   * 真正把它们区分开的 `loadIndex` / `demandLoad` 只以裸键形态躺在第二级。
   * 两段各自独立回落（见 `qualifiedStateVarText`）：变量没名字就显裸键，不牵连已有的类型名。
   */
  sourceLabel: string;
  /** 目标端第一级整串（口径同上）。 */
  targetLabel: string;
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
 *
 * 这条纪律今天真的还在被遵守吗（**2026-08-23 复核成立**）—— 两条都能亲手跑：
 *  · 实现：`grep -n 'count: s.rows.length' apps/frontend-shell/src/views/sim/edgeActiveModel.ts`
 *    （`buildDomainSlices` 的最后一行；中途那几处 `count: 0` 是占位，全被这一行覆盖）；
 *  · 机器化断言：`pnpm --filter frontend-shell exec vitest run test/disruption-cards.seam.test.tsx`
 *    —— 用例「纯模型：buildDomainSlices 按域 key 全序、未归域垫底、**count 恒等于 rows.length**」。
 *    改成另存一个数 ⇒ 该用例当场红，而不是等谁在屏上看见"7 条 / 5 行"。
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
  /**
   * WO-STATEVAR-DISPLAYNAME · `状态变量裸键 → 中文名`（随 `GET /sim/propagation-rules` 下发）。
   * **缺省 `undefined` ⇒ 变量名逐条回落裸键**，与本参数引入前逐字节同屏（additive 可回退）。
   * ⛔ 前端不得在此处补任何中文名：真值源是后端 `STATE_VAR_DISPLAY_NAMES`，这里只翻译。
   */
  stateVarNames?: Readonly<Record<string, string>>,
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
        // 第一级整串：类型名 · 变量名（两段各自独立回落，见 stateVarLabel.ts 顶注）。
        sourceLabel: qualifiedStateVarText(r.sourceTypeKey, r.sourceStateVar, typeDisplayNames, stateVarNames),
        targetLabel: qualifiedStateVarText(r.targetTypeKey, r.targetStateVar, typeDisplayNames, stateVarNames),
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
  /** 状态变量**接线名**（`loadIndex`）—— testid / 排序 / 去重全认它，不认人话名。 */
  stateVar: string;
  /**
   * WO-STATEVAR-DISPLAYNAME · 状态变量人话名（`负载指数`）；本体未登记 ⇒ **回落成裸键本身**。
   * 与 `stateVar` 并存而不是替换：屏上要给人看名字，而对账/深链接要认接线名，两者都不能少。
   */
  stateVarName: string;
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
export function buildDiffRows(
  cells: readonly SimStateDiffCell[],
  /** WO-STATEVAR-DISPLAYNAME · 同 `buildEdgeRows`：缺省 ⇒ 逐条回落裸键（additive 可回退）。 */
  stateVarNames?: Readonly<Record<string, string>>,
): DiffRowVM[] {
  return [...cells]
    .map((c): DiffRowVM => ({
      objectId: c.objectId,
      stateVar: c.stateVar,
      // 差异表那一列改显人话名；`stateVar` 裸键**原样保留**（testid、排序、去重全认它）。
      stateVarName: stateVarText(c.stateVar, stateVarNames),
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

// ── tick0 世界态的前端自造实现**已整支删除**（WO-M0-GROUND-TRUTH · F0）──────────────────
/**
 * **今天的行为 X（删之前，2026-09-19 实测）**：本文件住着前端哈希派生三件套 ——
 * 浏览器里按 `round(hash01(objectId|stateVar)×100)` 编 tick0 世界 + 自盖 `derived` 章，
 * 一次 `props` 都不读，经 `createSimSession({baseSnapshot})` 落库。按仓主定义
 * （PRD §2.0.1：只存储在前端的数据 = mock 数据）那是**假数据，且在生产路径上**。
 * **应该是 Y**：世界态由服务端 `deriveSeedBaseSnapshot` 现派生（`app.ts` 建会话端点，
 * 不传 `baseSnapshot` 即触发），逐格盖 `measured`/`derived` 章随回包下发。
 * **裁决留档**：`claude/handoff-real-cells` 的 `resolveTick0World`（路 A：复制后端**冻结**
 * 播种快照）实测同一时刻读到 `equipmentFailure=17`，而真值是 75（路 B：服务端现派生读得）。
 * ⇒ 本单照**路 B** 清，路 A 不收编；两支哈希函数与其唯一调用方（`SandboxView.init` /
 * `EdgeActivePanel.ensureSession`）一起删，不留死代码。
 */
/**
 * `PROBE_WORLD_PROVENANCE` 那段记号（屏上真渲染的字符串，不是注释）**保留**：
 * 服务端派生的世界里取不到真值的格仍是确定性占位，「全占位」那一档措辞仍由它承载
 * （消费方：`EdgeActivePanel` 的探针世界出处段）。
 */
export const PROBE_WORLD_PROVENANCE = "占位·未实测";
/** 探针世界出处的完整说明（同上，屏上真渲染）。 */
export const PROBE_WORLD_PROVENANCE_DETAIL =
  "本页就地开的探针世界，其 tick0 世界态由本体配置结构派生（合成占位值，非实测）。" +
  "下方差值反映的是这条边的结构影响（系数 × 延迟 × 链路扇出），量级不可当实测读。";
