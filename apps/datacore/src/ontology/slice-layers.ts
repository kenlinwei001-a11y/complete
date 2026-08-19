import type {
  SliceEmptyGraph,
  SliceLayer,
  SliceLayerId,
  SliceLayerItem,
  SliceLayersResponse,
} from "@platform/contracts";
import { SLICE_LAYER_IDS } from "@platform/contracts";
import type { LinkTypeDef, ObjectTypeDef, Rule, SliceSpecRecord, TsSeriesRecord } from "../domain.js";

/**
 * WO-SLICE-16-LAYERS · 把一条本体切片投影成「十六层结构」。
 *
 * 取证见 docs/AUDIT-slice-16-layers.md：`executeSlice` 今天只回 {nodes, edges}，
 * 即十六层里只有 ③对象 ④属性 ⑤关系 三层；其余 11 层**承载物在、数据也在**，
 * 只是没人沿切片的类型集把它们 join 出来（三形态里的「接了线接错地方」）。
 * 本模块就是那条缺失的 join —— **纯读投影、零新真值源**：每层的数据全部来自
 * 既有 object_types / rules / sim_propagation_rules / ts_series / slice_specs / objects。
 *
 * 纯函数（R6 确定性）：入参即全部输入，无 Date.now()/随机/IO；同入参同出参、字典序稳定。
 * 取不到 ⇒ 诚实标 absent + 说明**缺在哪一环**，绝不造占位内容
 * （本仓产品哲学：宁可显示空 + 说明为什么，也不画假数据）。
 */

/** 切片投影的全部输入（调用方从 repos 装配；本模块不做 IO）。 */
export interface SliceLayerInput {
  sliceKey: string;
  version: number;
  spec: SliceSpecRecord["spec"];
  /** executeSlice 的真子图（含加性带出的 origin/epoch）。 */
  graph: {
    nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown>; origin?: { type: string } & Record<string, unknown>; epoch?: number }[];
    edges: { linkKey: string; from: string; to: string }[];
    truncated: boolean;
    snapshotVersion: string;
  };
  /** 全租户已发布对象类型。 */
  types: ObjectTypeDef[];
  /** 全租户链路定义。 */
  linkTypes: LinkTypeDef[];
  /** 全租户 PUBLISHED 规则。 */
  rules: Rule[];
  /** 全租户传导规则（推演状态变量的真承载物）。 */
  propagationRules: { key: string; sourceTypeKey: string; sourceStateVar: string; targetTypeKey: string; targetStateVar: string; viaLinkKey?: string | null; coefficient?: number }[];
  /** 全租户时序系列（entityType 即绑定的对象类型）。 */
  tsSeries: TsSeriesRecord[];
  /** 全库 ExceptionEvent 条数（用于区分「平台没有」与「这条切片没纳入」）。 */
  exceptionEventTotal: number;
  /** 全库 ExceptionEvent 的 refType 分布（异常挂在哪些对象类型上）。 */
  exceptionRefTypes: Record<string, number>;
  /** 该切片被哪些 plan/intent/agent 引用（governance.sliceReferences 的结果）。 */
  references: { refKind: string; key: string; where: string }[];
  /** 全租户 ActionType（无 targetTypeKey 字段 ⇒ 无法机械归因到类型，见 §⑮）。 */
  actionTypeKeys: string[];
  /** 切片类型上的派生规格（证据层：派生 inputs 快照的规格来源）。 */
  derivationSpecKeys: { specKey: string; targetType: string; targetProp: string; formula: string }[];
  /** 本次 resolve 实际收到的试切参数（用于判定「子图为空」是不是缺参导致）。 */
  args: Record<string, unknown>;
  /** root 对象类型在本租户的对象总数（区分「零对象」与「有对象但 selector 没匹配」）。 */
  rootObjectTotal: number;
  /**
   * root 对象样本（**只在子图为空时**由调用方装填，用于给出「可以填什么」的真实候选值）。
   * 候选值全部来自真对象，绝不编造；取不到就留空数组。
   */
  rootObjectSamples: { objectKey: string; props: Record<string, unknown> }[];
}

/** 候选值上限：第一层不该堆一屏值，够点一下就行（多的让人自己填）。 */
const ARG_CANDIDATE_CAP = 8;

/**
 * WO-SLICE-REQUIRED-ARGS：切片占位符正则与 `ontology-core.ts` resolveTemplate 一字不差
 * （口径单源，改一处必同改）。整串锚定 —— 占位符必须占满整个值，`"SO-{{args.x}}"` 这类
 * 拼接串 resolveTemplate 不解 ⇒ 这里也不算需参（与执行期行为严格一致，宁漏勿谎）。
 */
export const SLICE_ARG_PLACEHOLDER = /^\{\{\s*args\.([\w]+)\s*\}\}$/;

/**
 * 从 `spec.root.selector` 抽出该切片声明的试切参数名（byKey + filter 值），去重字典序。
 * 纯函数（R6）：清单投影 / 缺参诊断共用这一条，保证「徽标说的需参」与「诊断说的需参」同源。
 * 注意 hop.filter 的占位符 executeSlice 也解（matchFilter 走同一 resolveTemplate），但本函数
 * 只扫 root.selector —— 与既有 diagnoseEmptyGraph 口径一致；种子切片实测 hop 占位符为零。
 */
export function sliceRequiredArgs(spec: SliceLayerInput["spec"]): string[] {
  const found: string[] = [];
  const scan = (raw: unknown): void => {
    const m = typeof raw === "string" ? SLICE_ARG_PLACEHOLDER.exec(raw) : null;
    if (m) found.push(m[1] as string);
  };
  if (spec.root.selector.byKey !== undefined) scan(spec.root.selector.byKey);
  for (const raw of Object.values(spec.root.selector.filter ?? {})) scan(raw);
  return uniqSorted(found);
}

/**
 * 判定「子图为什么是空的」——**空子图不是「这些层没数据」**（WO-SLICE-16-LAYERS 复核发现）。
 *
 * 实测（2026-08-10 · demo 租户 · 真后端 4093 端口逐条跑完 98 条切片）：无参调用时 **86 条非空 / 12 条空**，
 * 12 条空的分两种、修法完全不同：
 *   - 4 条多跳切片（`enterprise_360` / `order_fulfillment_360` / `order_to_cash_720` / `aop_scenario_chain`）
 *     的 root selector 写着 `{{args.so}}` / `{{args.key}}`，不给参数 ⇒ 过滤恒不匹配。
 *     给 `{"so":"SO-3391"}` 立刻解出 531 节点 / 570 边 / 9 类型 ⇒ **缺的是参数，不是数据**。
 *   - 8 条 `coverage_*` 切片的 root 类型在本租户零对象 ⇒ **缺的是数据**。
 * 把这两种和「层没数据」搅成一个「无」，就是审计 §1.2 那个误判的翻版。
 */
function diagnoseEmptyGraph(
  spec: SliceLayerInput["spec"],
  args: Record<string, unknown>,
  rootObjectTotal: number,
  rootObjectSamples: SliceLayerInput["rootObjectSamples"],
): SliceEmptyGraph {
  // 占位符正则 = 模块级 SLICE_ARG_PLACEHOLDER（口径单源，与 resolveTemplate 一字不差）。
  const PLACEHOLDER = SLICE_ARG_PLACEHOLDER;
  // 占位符所在的**位置**要记住：filter 的 key 就是 root 对象上的属性名，byKey 则取 objectKey。
  // 只记参数名不记位置，就没法回答「这个参数该填什么」——那正是缺参诊断最有用的一半。
  const argSource = new Map<string, { from: "prop"; propKey: string } | { from: "objectKey" }>();
  const scan = (raw: unknown, source: { from: "prop"; propKey: string } | { from: "objectKey" }): string[] => {
    const m = typeof raw === "string" ? PLACEHOLDER.exec(raw) : null;
    if (!m) return [];
    const name = m[1] as string;
    if (!argSource.has(name)) argSource.set(name, source);
    return [name];
  };
  const found = [
    ...(spec.root.selector.byKey !== undefined ? scan(spec.root.selector.byKey, { from: "objectKey" }) : []),
    ...Object.entries(spec.root.selector.filter ?? {}).flatMap(([propKey, raw]) => scan(raw, { from: "prop", propKey })),
  ];
  const requiredArgs = uniqSorted(found);
  const missingArgs = requiredArgs.filter((a) => args[a] === undefined || args[a] === "");

  /** 真值候选：从真对象上读，不编。确定性 —— 先按 objectKey 字典序，再去重取前 CAP 个。 */
  const candidatesFor = (arg: string): string[] => {
    const src = argSource.get(arg);
    if (!src) return [];
    const ordered = [...rootObjectSamples].sort((a, b) => by(a.objectKey, b.objectKey));
    const raw = ordered.flatMap((o) => {
      const v = src.from === "objectKey" ? o.objectKey : o.props[src.propKey];
      // 数组属性（如 Order.bases）逐元素展开；对象/undefined 一律丢弃（宁可少给也不给看不懂的值）。
      const vs = Array.isArray(v) ? v : [v];
      return vs.filter((x): x is string | number => typeof x === "string" || typeof x === "number").map(String);
    });
    return [...new Set(raw)].slice(0, ARG_CANDIDATE_CAP);
  };

  if (missingArgs.length > 0) {
    return {
      reason: "missing_args",
      requiredArgs,
      missingArgs,
      rootObjectTotal,
      argCandidates: missingArgs.map((a) => ({ arg: a, values: candidatesFor(a) })),
      message: `子图为空是因为**缺试切参数**：该切片的 root selector 声明了 ${requiredArgs.map((a) => `{{args.${a}}}`).join("、")}，本次未提供 ${missingArgs.join("、")} ⇒ root 过滤恒不匹配。补上参数即可解出真子图（十六层随之有数）。`,
    };
  }
  if (rootObjectTotal === 0) {
    return {
      reason: "no_root_objects",
      requiredArgs,
      missingArgs,
      rootObjectTotal,
      argCandidates: [],
      message: `子图为空是因为 root 对象类型 ${spec.root.typeKey} 在本租户**一个对象都没有**（不是切片写错，是这一类还没有数据）。`,
    };
  }
  return {
    reason: "no_match",
    requiredArgs,
    missingArgs,
    rootObjectTotal,
    argCandidates: requiredArgs.map((a) => ({ arg: a, values: candidatesFor(a) })),
    message: `子图为空是因为 root selector 过滤后无匹配：${spec.root.typeKey} 共 ${rootObjectTotal} 个对象，没有一个满足 selector 条件。`,
  };
}

const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort(by);

/** 属性中文名回落：displayName 缺省即业务含义未确证 ⇒ 诚实显裸键，不臆造（WO-SCHEMA-ZH）。 */
const propLabel = (typeKey: string, p: { propKey: string; displayName?: string }): string =>
  `${typeKey}.${p.displayName ?? p.propKey}`;

interface LayerDraft {
  carrier: string;
  unit: string;
  items: SliceLayerItem[];
  /** 平台全库条数（>0 且 items 为空 ⇒ not_in_slice；=0 ⇒ absent）。 */
  platformCount?: number;
  /** 恒空/缺 join 键这类**结构性**缺席的说明；给了它就一定是 absent（不看 platformCount）。 */
  absentReason?: string;
}

export function projectSliceLayers(input: SliceLayerInput): SliceLayersResponse {
  const { graph, spec } = input;
  const typeKeys = uniqSorted(graph.nodes.map((n) => n.typeKey));
  const typeKeySet = new Set(typeKeys);
  const linkKeys = uniqSorted(graph.edges.map((e) => e.linkKey));
  const typeByKey = new Map(input.types.map((t) => [t.key, t]));
  /** 切片触达的类型定义（字典序）。 */
  const sliceTypes = typeKeys.map((k) => typeByKey.get(k)).filter((t): t is ObjectTypeDef => !!t);

  const drafts: Record<SliceLayerId, LayerDraft> = {
    // ── ① 业务场景 ────────────────────────────────────────────────────────────
    // 承载物 reportedRefs 已接线（app.ts:2375 → governance.sliceReferences），但上游
    // AgentCore 的 refs/report.ts 只产 rule 引用、从不产 kind:"slice" ⇒ 恒空。
    // 这是「接了线没数据」而不是「没接线」——修法是补 producer，不是造承载物。
    business_scenario: {
      carrier: "reported_refs（B→A 引用上报）→ governance.sliceReferences",
      unit: "个",
      items: input.references
        .filter((r) => r.refKind === "scene" || r.refKind === "workflow")
        .map((r) => ({ key: r.key, label: r.key, group: r.refKind, detail: r.where }))
        .sort((a, b) => by(a.key, b.key)),
      absentReason:
        "承载物在（GET …/slices/{key}/references 已接线），但 AgentCore 侧 refs/report.ts 只上报 rule 引用、从不产出 kind:\"slice\" ⇒ 反查恒空。缺的是上报方，不是切片。",
    },
    // ── ② 决策意图 ────────────────────────────────────────────────────────────
    // 同①。AgentCore 的 dril/relations.ts 其实真算出了 workflow--includes-->slice，
    // 但那份关系图不回写 DataCore ⇒ A 侧反查依旧为空（接了线接错地方）。
    decision_intent: {
      carrier: "reported_refs.refKind ∈ {plan, intent, agent}",
      unit: "个",
      items: input.references
        .filter((r) => r.refKind === "plan" || r.refKind === "intent" || r.refKind === "agent")
        .map((r) => ({ key: r.key, label: r.key, group: r.refKind, detail: r.where }))
        .sort((a, b) => by(a.key, b.key)),
      absentReason:
        "AgentCore dril/relations.ts 已算出 workflow→slice 的引用关系，但不回写 DataCore 的 reported_refs ⇒ A 侧反查取不到（关系算在了 B 侧，没有回流）。",
    },
    // ── ③ 对象（executeSlice 已带出） ─────────────────────────────────────────
    object: {
      carrier: "objects（executeSlice 真子图 nodes）",
      unit: "类",
      items: typeKeys.map((k) => {
        const t = typeByKey.get(k);
        return {
          key: k,
          label: t?.displayName ? `${t.displayName}（${k}）` : k,
          group: t?.domain ?? "unassigned",
          count: graph.nodes.filter((n) => n.typeKey === k).length,
          detail: `${graph.nodes.filter((n) => n.typeKey === k).length} 个对象`,
        };
      }),
    },
    // ── ④ 属性（executeSlice 已带出值；此处补口径：中文名/单位/类型/是否主键） ──
    property: {
      carrier: "object_types.properties（PropertyDef）+ 子图 node.props",
      unit: "个",
      items: sliceTypes
        .flatMap((t) =>
          t.properties.map((p) => ({
            key: `${t.key}.${p.propKey}`,
            label: propLabel(t.key, p),
            group: t.key,
            detail: [p.dataType, p.unit ? `单位 ${p.unit}` : null, p.isPrimaryKey ? "主键" : null]
              .filter(Boolean)
              .join(" · "),
          })),
        )
        .sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑤ 关系（executeSlice 只带 linkKey；此处补回基数与端类型） ─────────────
    relation: {
      carrier: "links（子图 edges）+ ontology_links（LinkTypeDef 基数/端类型）",
      unit: "种",
      items: linkKeys.map((k) => {
        const lt = input.linkTypes.find((l) => l.key === k);
        return {
          key: k,
          label: k,
          group: lt ? `${lt.fromTypeKey}→${lt.toTypeKey}` : "未登记链路",
          count: graph.edges.filter((e) => e.linkKey === k).length,
          detail: lt
            ? `${lt.fromTypeKey} →[${lt.cardinality}]→ ${lt.toTypeKey} · ${graph.edges.filter((e) => e.linkKey === k).length} 条边`
            : `${graph.edges.filter((e) => e.linkKey === k).length} 条边 · 链路定义未登记`,
        };
      }),
    },
    // ── ⑥ 事件 ────────────────────────────────────────────────────────────────
    // ExceptionEvent 是一等对象类型（四源归一投影）。切片若把它纳进 paths 就取得到；
    // 没纳进来 ⇒ not_in_slice（平台有 N 条），**不是** absent。
    event: {
      carrier: "objects[type=ExceptionEvent]（四源归一异常事件）+ exc_sourced_from 链路",
      unit: "条",
      platformCount: input.exceptionEventTotal,
      items: graph.nodes
        .filter((n) => n.typeKey === "ExceptionEvent")
        .map((n) => ({
          key: n.objectKey || n.id,
          label: String(n.props.summary ?? n.objectKey ?? n.id),
          group: String(n.props.excType ?? "未分类"),
          detail: [n.props.severity, n.props.status, n.props.refType ? `源 ${String(n.props.refType)}` : null]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑦ 状态 ────────────────────────────────────────────────────────────────
    // 两个承载物、定性不同，必须拆开（审计 §2 表）：
    //   (a) ObjectTypeDef.stateVariables —— 实测 94 类全空（接了线没数据）
    //   (b) sim_propagation_rules 的 {source,target}StateVar —— 实测 13 条真数据
    //   (c) enum 型属性 —— 对象的可枚举状态
    // 这里三者都投影，group 标明各自来源，让人一眼看出哪个来源在供数。
    state: {
      carrier: "sim_propagation_rules.{source,target}StateVar + object_types.stateVariables + enum 属性",
      unit: "个",
      items: [
        ...input.propagationRules
          .filter((r) => typeKeySet.has(r.sourceTypeKey) || typeKeySet.has(r.targetTypeKey))
          .flatMap((r) => [
            ...(typeKeySet.has(r.sourceTypeKey)
              ? [{ key: `pr:${r.sourceTypeKey}.${r.sourceStateVar}`, label: `${r.sourceTypeKey}.${r.sourceStateVar}`, group: "传导状态变量", detail: `→ ${r.targetTypeKey}.${r.targetStateVar}${r.viaLinkKey ? ` via ${r.viaLinkKey}` : ""}` }]
              : []),
            ...(typeKeySet.has(r.targetTypeKey)
              ? [{ key: `pr:${r.targetTypeKey}.${r.targetStateVar}`, label: `${r.targetTypeKey}.${r.targetStateVar}`, group: "传导状态变量", detail: `← ${r.sourceTypeKey}.${r.sourceStateVar}` }]
              : []),
          ]),
        ...sliceTypes.flatMap((t) =>
          (t.stateVariables ?? []).map((sv) => ({
            key: `sv:${t.key}.${sv.propKey}`,
            label: `${t.key}.${sv.propKey}`,
            group: "类型级状态变量",
            detail: `${sv.fn}(${sv.fromField}) : ${sv.dataType}`,
          })),
        ),
        ...sliceTypes.flatMap((t) =>
          t.properties
            .filter((p) => p.dataType === "enum")
            .map((p) => ({
              key: `en:${t.key}.${p.propKey}`,
              label: propLabel(t.key, p),
              group: "枚举状态属性",
              detail: (p.enumValues ?? []).join(" / ") || "枚举取值未声明",
            })),
        ),
      ]
        .filter((x, i, arr) => arr.findIndex((y) => y.key === x.key) === i)
        .sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑧ 指标 ────────────────────────────────────────────────────────────────
    metric: {
      carrier: "object_types.derivedProperties.formula + PropertyDef.unit",
      unit: "个",
      items: [
        ...sliceTypes.flatMap((t) =>
          (t.derivedProperties ?? []).map((d) => ({
            key: `d:${t.key}.${d.propKey}`,
            label: `${t.key}.${d.propKey}`,
            group: "派生指标",
            detail: d.formula,
          })),
        ),
        ...sliceTypes.flatMap((t) =>
          t.properties
            .filter((p) => p.unit)
            .map((p) => ({
              key: `u:${t.key}.${p.propKey}`,
              label: propLabel(t.key, p),
              group: "带量纲度量",
              detail: `单位 ${p.unit}`,
            })),
        ),
      ].sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑨ 时间 ────────────────────────────────────────────────────────────────
    // (a) ts_series.entityType 绑对象类型（实测 Equipment/Process/Line/Base 有真系列）
    // (b) PropertyDef.temporal → 实测 0（接了线没数据，属性没人标 temporal）
    // (c) date 型属性
    time: {
      carrier: "ts_series.entityType + PropertyDef.temporal/date",
      unit: "个",
      items: [
        ...input.tsSeries
          .filter((s) => typeKeySet.has(s.entityType))
          .map((s) => ({
            key: `ts:${s.seriesKey}`,
            label: s.seriesKey,
            group: "时序系列",
            detail: `${s.entityType} · ${s.measureFields.join("/")}${s.unit ? ` · ${s.unit}` : ""}`,
          })),
        ...sliceTypes.flatMap((t) =>
          t.properties
            .filter((p) => p.temporal)
            .map((p) => ({ key: `tp:${t.key}.${p.propKey}`, label: propLabel(t.key, p), group: "时变属性（落历史表）", detail: "temporal=true → object_prop_history" })),
        ),
        ...sliceTypes.flatMap((t) =>
          t.properties
            .filter((p) => p.dataType === "date")
            .map((p) => ({ key: `dt:${t.key}.${p.propKey}`, label: propLabel(t.key, p), group: "日期属性", detail: "date" })),
        ),
      ].sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑩ 规则 ────────────────────────────────────────────────────────────────
    // join 键 Rule.scopeObjectTypes ∩ 切片类型 —— app.ts:1741 已在认证装配里这么用了，
    // 只是切片这条路上从来没接。
    rule: {
      carrier: "rules.scopeObjectTypes ∩ 切片类型（PUBLISHED）",
      unit: "条",
      platformCount: input.rules.length,
      items: input.rules
        .filter((r) => r.scopeObjectTypes.some((k) => typeKeySet.has(k)))
        .map((r) => ({
          key: r.key,
          label: `${r.key} ${r.name}`,
          group: r.category ?? r.severity,
          detail: `${r.expression}${Object.keys(r.params ?? {}).length > 0 ? ` · 阈值 ${Object.keys(r.params ?? {}).join("/")}` : ""}`,
        }))
        .sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑪ 约束 ────────────────────────────────────────────────────────────────
    constraint: {
      carrier: "slice_specs.spec.contractFixtures + rules[severity=BLOCK] + rules.params",
      unit: "条",
      items: [
        ...(spec.contractFixtures ?? []).map((f) => ({
          key: `fx:${f.name}`,
          label: f.name,
          group: "切片契约",
          detail: `minNodes ≥ ${f.expect.minNodes}${f.expect.mustIncludeTypes?.length ? ` · 须含类型 ${f.expect.mustIncludeTypes.join("/")}` : ""}${f.expect.mustIncludeLinkKeys?.length ? ` · 须含链路 ${f.expect.mustIncludeLinkKeys.join("/")}` : ""}`,
        })),
        ...input.rules
          .filter((r) => r.severity === "BLOCK" && r.scopeObjectTypes.some((k) => typeKeySet.has(k)))
          .map((r) => ({ key: `blk:${r.key}`, label: `${r.key} ${r.name}`, group: "硬约束（BLOCK）", detail: r.expression })),
        ...input.rules
          .filter((r) => Object.keys(r.params ?? {}).length > 0 && r.scopeObjectTypes.some((k) => typeKeySet.has(k)))
          .flatMap((r) =>
            Object.entries(r.params ?? {}).map(([k, v]) => ({
              key: `pm:${r.key}.${k}`,
              label: `${r.key}.${k}`,
              group: "命名阈值",
              detail: `= ${Array.isArray(v) ? v.join("/") : String(v)}`,
            })),
          ),
      ].sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑫ 数据绑定 ────────────────────────────────────────────────────────────
    data_binding: {
      carrier: "object_types.sourceBindings（connId / dataset / 字段映射）",
      unit: "条",
      items: sliceTypes
        .flatMap((t) =>
          (t.sourceBindings ?? []).map((b) => ({
            key: `${t.key}:${b.connId}:${b.dataset}`,
            label: `${t.key} ← ${b.dataset}`,
            group: b.connId,
            count: Object.keys(b.fieldMappings ?? {}).length,
            detail: `连接器 ${b.connId} · ${Object.keys(b.fieldMappings ?? {}).length} 个字段映射`,
          })),
        )
        .sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑬ 场景 ────────────────────────────────────────────────────────────────
    // 场景 = 推演分叉/传导：AnnualScenario/ScenarioTrigger 对象 + 传导规则（有向边）。
    scenario: {
      carrier: "objects[AnnualScenario/ScenarioTrigger] + sim_propagation_rules（传导链）",
      unit: "条",
      platformCount: input.propagationRules.length,
      items: [
        ...graph.nodes
          .filter((n) => n.typeKey === "AnnualScenario" || n.typeKey === "ScenarioTrigger")
          .map((n) => ({ key: `sc:${n.objectKey || n.id}`, label: String(n.props.name ?? n.objectKey ?? n.id), group: n.typeKey, detail: String(n.props.note ?? "") })),
        ...input.propagationRules
          .filter((r) => typeKeySet.has(r.sourceTypeKey) || typeKeySet.has(r.targetTypeKey))
          .map((r) => ({
            key: `pg:${r.key}`,
            label: `${r.sourceTypeKey}.${r.sourceStateVar} → ${r.targetTypeKey}.${r.targetStateVar}`,
            group: "传导链",
            detail: `系数 ${r.coefficient ?? "—"}${r.viaLinkKey ? ` · via ${r.viaLinkKey}` : ""}`,
          })),
      ].sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑭ 证据 ────────────────────────────────────────────────────────────────
    evidence: {
      carrier: "derivation_specs（派生 inputs 快照来源）+ slice_specs.contractFixtures",
      unit: "条",
      items: [
        ...input.derivationSpecKeys
          .filter((d) => typeKeySet.has(d.targetType))
          .map((d) => ({ key: `ds:${d.specKey}`, label: `${d.targetType}.${d.targetProp}`, group: "派生溯源规格", detail: d.formula })),
        ...(spec.contractFixtures ?? []).map((f) => ({
          key: `ev:${f.name}`,
          label: `契约基线 ${f.name}`,
          group: "契约证据",
          detail: `期望 root=${f.expect.rootType} · minNodes ≥ ${f.expect.minNodes}`,
        })),
      ].sort((a, b) => by(a.key, b.key)),
    },
    // ── ⑮ 行动 ────────────────────────────────────────────────────────────────
    // 真结构缺口：ActionType **没有 targetTypeKey 字段**（app.ts:1728 已注明「按全本体计数」），
    // ObjectTypeDef.actions 又实测全空 ⇒ 全局有动作，但无法归因到本切片的类型。
    // 这是唯一一层「即使补取数也取不出来」的——必须诚实说明缺的是 join 键。
    action: {
      carrier: "object_types.actions[]（类型级绑定）+ action_types（全局注册表）",
      unit: "个",
      platformCount: input.actionTypeKeys.length,
      items: sliceTypes
        .flatMap((t) => (t.actions ?? []).map((a) => ({ key: `${t.key}:${a.actionTypeKey}`, label: a.actionTypeKey, group: t.key })))
        .sort((a, b) => by(a.key, b.key)),
      // 复核修正（WO-SLICE-16-LAYERS 接续单 · 2026-08-10 实测）：前稿把 actions 恒空写成
      //「接了线没数据」，只说对了一半。追一层调用发现是**两道口子叠在一起**：
      //   ① 生产方确实不产：种子 battery.ts 里 `actions:` 与 `stateVariables` 命中数皆为 0
      //      （金丝雀 `derivedProperties` 同文件 14 命中 ⇒ grep 工具正常，是真的 0）。
      //   ② 就算产了也落不了库：`pipeline/subgraph.ts:53-57` 确实构造了 stateVariables/actions/
      //      functions/security，但唯一入库口 `ontology.ts:199 upsertType` 逐字段列举重建 def，
      //      这四个字段一个都没抄 ⇒ 写进去也丢（与 docs/ONTOLOGY-7ELEM-AUDIT.md §2.1(b) 同结论）。
      // 二者定性不同、修法不同（补种子 vs 补持久化窄门），必须一起说，否则会去修错那一头。
      absentReason:
        `全局注册了 ${input.actionTypeKeys.length} 个 ActionType，但归因不到本切片的类型，缺口有两道：` +
        `(1) 结构缺口 —— ActionType 无 targetTypeKey 字段，无法机械 join 到对象类型；` +
        `(2) 持久化窄门 —— object_types.actions[] 全空，且 ontology.ts:199 upsertType 逐字段重建 def 时不抄 actions/stateVariables/functions/security，` +
        `即便 pipeline/subgraph.ts:53-57 产出了也落不了库。补种子与补窄门是两件事，不许当一件做。`,
    },
    // ── ⑯ 治理与溯源 ──────────────────────────────────────────────────────────
    // 本单最重的一条：executeSlice 原本在 nodes.set 时丢掉了 o.origin / o.epoch
    // （R13 破口）。改为加性带出后，这一层才有真数据。
    governance: {
      carrier: "objects.origin/epoch（子图带出）+ object_types.domain/published",
      unit: "项",
      items: [
        ...Object.entries(
          graph.nodes.reduce<Record<string, number>>((acc, n) => {
            const k = n.origin?.type ?? "UNKNOWN";
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([k, n]) => ({ key: `og:${k}`, label: `来源 ${k}`, group: "对象溯源", count: n, detail: `${n} 个对象` })),
        ...uniqSorted(sliceTypes.map((t) => t.domain ?? "unassigned")).map((d) => ({
          key: `dm:${d}`,
          label: `域 ${d}`,
          group: "归域",
          count: sliceTypes.filter((t) => (t.domain ?? "unassigned") === d).length,
          detail: `${sliceTypes.filter((t) => (t.domain ?? "unassigned") === d).length} 个类型`,
        })),
        ...(sliceTypes.filter((t) => t.published).length > 0
          ? [{ key: "pb:published", label: "已发布类型", group: "发布状态", count: sliceTypes.filter((t) => t.published).length, detail: `${sliceTypes.filter((t) => t.published).length}/${sliceTypes.length} 类已发布` }]
          : []),
        ...(sliceTypes.filter((t) => t.deprecation && t.deprecation.status !== "ACTIVE").length > 0
          ? [{ key: "dp:deprecated", label: "已弃用类型", group: "发布状态", count: sliceTypes.filter((t) => t.deprecation && t.deprecation.status !== "ACTIVE").length, detail: "切片仍引用弃用类型" }]
          : []),
        { key: "sv:snapshot", label: `快照 ${graph.snapshotVersion}`, group: "版本", detail: "ontologyVersion.epoch" },
      ].sort((a, b) => by(a.key, b.key)),
    },
  };

  // 子图空 ⇒ 十三个「靠子图 join」的层必然为空，但那**不是层的问题**。①②只看 reportedRefs、
  // 与子图无关，所以不受此影响（否则会把「上游不上报」错报成「参数没给」）。
  const emptyGraph = graph.nodes.length === 0
    ? diagnoseEmptyGraph(spec, input.args, input.rootObjectTotal, input.rootObjectSamples)
    : undefined;
  const GRAPH_INDEPENDENT: ReadonlySet<SliceLayerId> = new Set<SliceLayerId>(["business_scenario", "decision_intent"]);

  const layers: SliceLayer[] = SLICE_LAYER_IDS.map((id, i) => {
    const d = drafts[id];
    const count = d.items.length;
    // 三态判定（审计 §3.3）：有明细 = present；无明细但平台有 = not_in_slice；否则 absent。
    // absentReason 是**结构性**说明（恒空 / 缺 join 键），给了就一定不是 present。
    let status: SliceLayer["status"];
    if (count > 0) status = "present";
    else if ((d.platformCount ?? 0) > 0 && !d.absentReason) status = "not_in_slice";
    else status = "absent";
    const layer: SliceLayer = {
      id,
      ordinal: i + 1,
      status,
      count,
      unit: d.unit,
      carrier: d.carrier,
      items: d.items,
    };
    if (d.platformCount !== undefined) layer.platformCount = d.platformCount;
    // 子图为空时，靠子图 join 的层一律改口径为「子图没解出来」——原文案「平台有 N 条但本切片没纳入」
    // 在这里是**假话**：切片纳没纳入根本还没判定过。这正是「不许拿一个看起来相关的说法当解释」。
    const graphEmptyBlocked = emptyGraph !== undefined && !GRAPH_INDEPENDENT.has(id) && status !== "present";
    if (graphEmptyBlocked) {
      layer.absentReason =
        `本切片未解出子图 ⇒ 这一层还没被判定过（不是「平台没有」）。${emptyGraph.message}` +
        (d.platformCount !== undefined ? `（平台现有 ${d.platformCount} ${d.unit}。）` : "");
    } else if (status === "not_in_slice") {
      layer.absentReason =
        d.absentReason ??
        `平台有 ${d.platformCount ?? 0} ${d.unit}，但本切片的路径没纳入 —— 改切片 paths 把相关类型接进来即可取到。`;
    } else if (status === "absent") {
      layer.absentReason = d.absentReason ?? `本租户此层无数据（承载物：${d.carrier}）。`;
    }
    return layer;
  });

  return {
    sliceKey: input.sliceKey,
    version: input.version,
    rootType: spec.root.typeKey,
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      truncated: graph.truncated,
      typeKeys,
      linkKeys,
      ...(emptyGraph ? { empty: emptyGraph } : {}),
    },
    snapshotVersion: graph.snapshotVersion,
    layers,
    summary: {
      total: 16,
      present: layers.filter((l) => l.status === "present").length,
      notInSlice: layers.filter((l) => l.status === "not_in_slice").length,
      absent: layers.filter((l) => l.status === "absent").length,
    },
  };
}
