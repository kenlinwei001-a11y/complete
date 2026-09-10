/**
 * WO-ONTO-SPINE-11 · 本体建模动线主脊 —— 11 步的**定义与现算**（纯函数，无 React、无网络）。
 *
 * ══ 这一份在修什么（今天的行为 X → 应该的行为 Y）════════════════════════════════════
 * **今天的行为（X）**：11 个建模面在导航里**按 API 资源名平铺**（`adminRegistry.ADMIN_NAV_GROUPS`
 * 的 `modeling` 组 10 条 path，以及左导航真正渲染的 `ShellLayout.NAV_GROUPS`「建模与图谱」组）。
 * 用户看到的是 10 个并列的名词 —— 「本体建模 / 对象-类型浏览 / 域管理 / 本体关系 / 本体切片 /
 * 切片库 / 实体合并 / 边界册治理 / 原型 intake / 对象接口」——
 * **没有先后、没有「我在第几步」、没有「还差多少」**。
 * **应该的行为（Y）**：一条有序的脊 —— 域 → 对象 → 关系 → 状态 → 事件 → 规则 → 约束 →
 * 因果 → 数据 → 场景/求解 → 发布，每格带**现算**的完成度与三态高亮，点每格进**已有的那个面**。
 *
 * ══ 两条硬纪律（本文件的存在理由）══════════════════════════════════════════════════
 * ① **完成度一律现算，不许写死。** 每格的数都来自 `SpineFacts`，而 `SpineFacts` 逐项来自真后端
 *    读端（见 `useSpineFacts`）。设计稿上的 `15 / 12·70 / 0·110 / 11型 / 0·29 / 0·45` 是**设计目标**，
 *    ⛔ 一个都不许抄进代码 —— 抄进来它就在数据变了之后继续说旧话。
 * ② **没有落点的格子如实标 `gap`，⛔ 不许拿一个不相干的面凑数。** 实测本仓「事件」今天
 *    **零个 REST 资源**（金丝雀：同一条正则在 `datacore` 路由表上 `ontology` 命中 53 条、
 *    `event` 命中 0 条 ⇒ 计数器有鉴别力，这个 0 是真 0），能拿到的只有映射表里
 *    **3 条静态种子事件类型**，且**没有任何管理面消费它**。
 *    把它接到「审批中心」那种带 `.events` 字样的页面上 = 拿审计流水冒充本体事件建模，
 *    正是本仓最恨的「事发生了，只是写在你不会去读的那一格」。
 */

/**
 * 一格的态。设计稿只画了三态（done/now/todo）；后两态是实测逼出来的：
 * · `gap`     —— 今天没有落点，见文件头注 ②；
 * · `unknown` —— **该格的读端还没回来**。
 *
 * ⚠ `unknown` 是真浏览器走查当场抓出来的 bug：修前 `ready === undefined` 会落进
 * `ready ? "done" : "todo"` 的 else 支，于是**「还没读到」被画成「待建」**。
 * 实测截到过一屏：规则/数据/场景/发布四格明明各有 30 / 89 / 63 / v1，
 * 在读端回来之前全被涂成「待建」—— 屏上等于说「这四步你都还没做」，**与事实相反**。
 * 形态正是本文件头注在防的那一个：**「我用『我没读到』当作『它不存在』的证据。」**
 */
export type SpineState = "done" | "now" | "todo" | "gap" | "unknown";

export interface SpineStepDef {
  /** 屏上的序号，如 "01"。 */
  no: string;
  /** 稳定键（测试与 `now` 定位用，不上屏）。 */
  key: string;
  /** 屏上主标题。 */
  title: string;
  /** 屏上副标题（设计稿第二行）。 */
  sub: string;
  /**
   * 点这一格去哪儿。**一律指向已有的面**（本单是重排不是新建）。
   * `null` = 今天没有落点 ⇒ 该格恒 `gap`，不可点。
   */
  href: string | null;
  /** 该格的数从哪儿来 —— **业务语言**，不写源码文件名/行号（R-UI-4）。 */
  source: string;
  /** `gap` 格的诚实说明（为什么今天点不了）。 */
  gapNote?: string;
  /** 该格虽有落点，但读数是**别处的派生投影**而非独立建模面时的说明。 */
  derivedNote?: string;
}

/**
 * 11 步的定义。**顺序即业务动线**（设计稿页面一步骤条原文），不是 API 表面顺序。
 * 锚点（`#onto-…`）指向 `OntologyRelationsPage` 里对应的小节 —— 那一页今天同时承载
 * 03/07/08/11 四步，不给锚点就会「点进去还要自己找」。
 */
export const SPINE_STEPS: readonly SpineStepDef[] = [
  { no: "01", key: "domain", title: "域", sub: "Domain", href: "/admin/domains", source: "域注册表" },
  { no: "02", key: "object", title: "对象", sub: "类型 · 属性", href: "/admin/object-types", source: "已发布本体的对象类型与属性" },
  { no: "03", key: "relation", title: "关系", sub: "结构 · 归属 · 业务", href: "/admin/ontology-relations#onto-structural", source: "结构边（关系类型）注册表" },
  {
    no: "04", key: "state", title: "状态", sub: "State",
    href: "/admin/ontology-relations#onto-causal", source: "传导规则的源/目标状态变量去重",
    derivedNote: "状态变量今天**没有独立建模面**：它是因果边（第 08 步）源/目标端的去重投影，改因果边才会变。",
  },
  {
    no: "05", key: "event", title: "事件", sub: "Event",
    href: null, source: "映射表事件类型（静态种子）",
    gapNote: "今天没有落点：事件类型是映射表里的静态种子，既无读写 REST 资源，也无任何管理面消费 —— 缺口如实标出，不拿别的面凑数。",
  },
  { no: "06", key: "rule", title: "规则", sub: "Rule", href: "/admin/rules", source: "规则库（已发布）" },
  { no: "07", key: "constraint", title: "约束", sub: "Constraint", href: "/admin/ontology-relations#onto-constraint", source: "对象类型上引用规则库的约束条目" },
  { no: "08", key: "causal", title: "因果", sub: "Causal", href: "/admin/ontology-relations#onto-causal", source: "生效因果边（传导规则）" },
  { no: "09", key: "data", title: "数据", sub: "灌入 · 对账", href: "/admin/synthetic", source: "已物化对象实例（按类型统计）" },
  { no: "10", key: "scenario", title: "场景", sub: "Scenario · 求解", href: "/admin/solvers", source: "求解器注册表" },
  { no: "11", key: "publish", title: "发布", sub: "评审 · 会签", href: "/admin/ontology-relations#onto-publish", source: "本体版本与待会签发布单" },
] as const;

/**
 * 现算所需的**全部**事实。每一项都对应一个真后端读端；`undefined` = 那一路还没回来或失败
 * （⇒ 该格显示 `—`，**不许拿 0 冒充**：「没读到」与「真的是 0」是两个不同的命题）。
 */
export interface SpineFacts {
  domains?: number;
  objectTypes?: number;
  objectProps?: number;
  linkTypes?: number;
  stateVars?: number;
  eventTypes?: number;
  rulesPublished?: number;
  constraintRefs?: number;
  /** 分母：对象类型总数（07 的 `0 / 100`、09 的 `89 / 100` 都用它）。 */
  typesTotal?: number;
  causalEdges?: number;
  typesWithData?: number;
  objectsTotal?: number;
  solvers?: number;
  ontologyVersion?: number;
  pendingSignoff?: number;
}

export interface SpineCell {
  def: SpineStepDef;
  state: SpineState;
  /** 屏上那行数字。`null` = 还没读到（显示 `—`）。 */
  count: string | null;
  /** 该格「算不算已建成」。`undefined` = 还没读到，不参与 `now` 的推定。 */
  ready?: boolean;
}

/** `n` 未读到时给 `null`，读到了给字符串 —— 把「没读到」与「0」分开。 */
const fmt = (n: number | undefined): string | null => (n === undefined ? null : String(n));
const pair = (a: number | undefined, b: number | undefined): string | null =>
  a === undefined || b === undefined ? null : `${a} / ${b}`;

/**
 * 逐格算「建成没有」。判据写在这里，**一处可读、可改、可测**。
 * ⚠ 判据一律落在**这一步自己的产物**上，不借别步的数当证据。
 */
function readiness(key: string, f: SpineFacts): boolean | undefined {
  switch (key) {
    case "domain": return f.domains === undefined ? undefined : f.domains > 0;
    case "object": return f.objectTypes === undefined ? undefined : f.objectTypes > 0;
    case "relation": return f.linkTypes === undefined ? undefined : f.linkTypes > 0;
    case "state": return f.stateVars === undefined ? undefined : f.stateVars > 0;
    // 事件恒 false：即便种子里有 3 条，今天**没有面能建、能改、能看** ⇒ 不算建成。
    case "event": return false;
    case "rule": return f.rulesPublished === undefined ? undefined : f.rulesPublished > 0;
    case "constraint": return f.constraintRefs === undefined ? undefined : f.constraintRefs > 0;
    case "causal": return f.causalEdges === undefined ? undefined : f.causalEdges > 0;
    case "data": return f.typesWithData === undefined ? undefined : f.typesWithData > 0;
    case "scenario": return f.solvers === undefined ? undefined : f.solvers > 0;
    // 发布：本体已发过版才算建成（待会签数是**待办量**不是建成判据，故不进这一条）。
    case "publish": return f.ontologyVersion === undefined ? undefined : f.ontologyVersion > 0;
    default: return undefined;
  }
}

/** 屏上那行数字：格式照设计稿（有分母的给 `N / M`，其余给单数）。 */
function countOf(key: string, f: SpineFacts): string | null {
  switch (key) {
    case "domain": return fmt(f.domains);
    case "object": return pair(f.objectTypes, f.objectProps);
    case "relation": return fmt(f.linkTypes);
    case "state": return fmt(f.stateVars);
    case "event": return fmt(f.eventTypes);
    case "rule": return fmt(f.rulesPublished);
    case "constraint": return pair(f.constraintRefs, f.typesTotal);
    case "causal": return fmt(f.causalEdges);
    case "data": return pair(f.typesWithData, f.typesTotal);
    case "scenario": return fmt(f.solvers);
    case "publish":
      if (f.ontologyVersion === undefined) return null;
      return f.pendingSignoff ? `v${f.ontologyVersion} · ${f.pendingSignoff} 待签` : `v${f.ontologyVersion}`;
    default: return null;
  }
}

/**
 * 把事实算成 11 格。
 *
 * **`now` 的判据**：第一个「有落点、且还没建成」的格子 —— 即**动线上的作业面**。
 * ⚠ `gap` 格（今天没有落点）**不参与** `now` 的竞争：把 `now` 停在一个点不进去的格子上，
 * 等于让屏上指着一扇不存在的门。
 * ⚠ 还没读到（`ready === undefined`）的格子同样不参与 —— 「没读到」不是「没建成」。
 */
export function computeSpine(facts: SpineFacts): SpineCell[] {
  const base = SPINE_STEPS.map((def) => ({
    def,
    ready: readiness(def.key, facts),
    count: countOf(def.key, facts),
  }));

  const nowIdx = base.findIndex((c) => c.def.href !== null && c.ready === false);

  return base.map((c, i) => {
    // 顺序即优先级，改动前先读这四句：
    //  ① 没落点 ⇒ gap（永远不参与 now）
    //  ② 读端没回来 ⇒ unknown（⛔ 绝不落 todo —— 那是「没读到」冒充「没建成」）
    //  ③ 动线作业面 ⇒ now
    //  ④ 其余按 ready 二分
    const state: SpineState =
      c.def.href === null ? "gap"
        : c.ready === undefined ? "unknown"
          : i === nowIdx ? "now"
            : c.ready ? "done" : "todo";
    return { def: c.def, count: c.count, ready: c.ready, state };
  });
}
