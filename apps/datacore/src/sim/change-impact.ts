/**
 * WO-CHANGE-IMPACT-PREVIEW · 变更传播预览（模型层）。
 *
 * 病灶：用户改扰动 / 关传导边 / 改派生公式，**按下去之前看不到波及面**（与事故
 * G-LEVER-SNAPSHOT-UNIT-LIE 同源：假数进审批留痕，屏上看不见）。参照物
 * docs/REF-ontology-twin-ux.html:156 的「变更传播预览」按关系类型分桶列出必须执行的动作。
 *
 * 本模块 = 纯函数预览核心（无 React、无 I/O）+ 一个世界装配器（唯一的 repo 读取处）。
 * 覆盖实测的五类关系族中的四类可传播族（报告 §1）：
 *   ① 传导规则 PropagationRule → bucket "recompute"（实例级，沿 link 实例逐跳）
 *   ③ 派生属性 ObjectTypeDef.derivedProperties → bucket "rederive"
 *      （聚合 FN(S.p BY f) 跨类型按 byField 匹配目标主键 / 算术同对象标识符——
 *       两型的解析**复用 ontology.ts 的 parseAggregate/evalArithmetic 同一实现**，不另抄正则）
 *   ④ DerivationSpec 第二套派生 → bucket "rederive"
 *      （目标解析**镜像 ontology-core.ts recompute 的 resolveAffectedTargets 语义**：
 *       self dep ⇒ 变更对象即目标；direction=out ⇒ 目标在 fromId 侧；in ⇒ toId 侧）
 *   ⑤ 规则表达式 RuleEntry.expression → bucket "rejudge"
 *      （字段引用经 ruledsl parseExpression 解析后抽取——含 cmp 直挂 field 与 SUM() 等 func 参数）
 *   ② 结构边本身不是传播族，是 ①④ 的导航基底；焦点为边时进 bucket "rewire"。
 *
 * 跳数：焦点本身不计（hop 0），每经一条边 +1。BFS + visited 集 ⇒ 环天然终止（环上节点
 * 只列一次、跳数标首达值）。MAX_HOPS=32 是**保险丝不是终止机制**：visited 已保证有限图终止，
 * 32 给本仓最深真链（3 跳）10× 余量；真触发 ⇒ truncated:true + unresolved 点名，不静默截断。
 *
 * 语义边界（说清才不误导）：预览是**结构闭包**——「这条链通，就会波及」。引擎的运行期
 * 值语义（propagateTick 的 `sourceVal===0` 跳过、clamp 撞顶、decay 归零）预览不模拟：
 * 结构上可达但本次数值为 0 的目标仍会列出。这是**故意的保守方向**（多报 ≻ 漏报），
 * 「预览与实际一致」验收在两者相等的世界里断言等式（测试 fixture 保证链上非零）。
 *
 * 诚实位纪律（⛔ 不许空集冒充「没有波及」）：
 *   · 焦点不存在 / 公式或表达式解析失败 / 可达规则零实例（接了线没数据）/ 截断 ⇒ 全部进
 *     unresolved[] 并写明「什么追不到、缺什么」；
 *   · items 空 + unresolved 空 = 焦点确为叶子（真没有下游），与「算不出来」在响应里分得开。
 */
import { evalArithmetic, parseAggregate } from "../ontology.js";
import { parseExpression } from "../ruledsl.js";
import type { Repos } from "../repo/repo.js";

// ---------------------------------------------------------------------------
// 世界输入（纯数据；装配器在文件底部，是唯一 I/O 处）
// ---------------------------------------------------------------------------

export interface ChangeImpactObject {
  id: string;
  typeKey: string;
  props: Record<string, unknown>;
}

export interface ChangeImpactLink {
  fromId: string;
  toId: string;
  linkKey: string;
}

/** 只带预览需要的字段；调用方只传 PUBLISHED（与 tick 同口径）。 */
export interface ChangeImpactPropagationRule {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  viaLinkKey: string;
  targetTypeKey: string;
  targetStateVar: string;
}

export interface ChangeImpactDerivedType {
  typeKey: string;
  /** 目标类型主键属性名（ontology.ts primaryKeyProp 同口径：isPrimaryKey ?? "id"）。 */
  primaryKey: string;
  derived: { propKey: string; formula: string }[];
}

/** DerivationSpecRecord 的预览子集；只传 status==="ACTIVE"。 */
export interface ChangeImpactDerivationSpec {
  specKey: string;
  targetType: string;
  targetProp: string;
  deps: { typeKey: string; prop: string; via?: string; direction?: "out" | "in" }[];
}

/** Rule 的预览子集；只传 status==="PUBLISHED"。 */
export interface ChangeImpactRule {
  key: string;
  expression: string;
  scopeObjectTypes: string[];
}

export interface ChangeImpactWorld {
  objects: ChangeImpactObject[];
  links: ChangeImpactLink[];
  propagationRules: ChangeImpactPropagationRule[];
  derivedTypes: ChangeImpactDerivedType[];
  derivationSpecs: ChangeImpactDerivationSpec[];
  rules: ChangeImpactRule[];
}

// ---------------------------------------------------------------------------
// 焦点与产出
// ---------------------------------------------------------------------------

export type ChangeFocus =
  | { kind: "stateVar"; objectId: string; stateVar: string }
  | { kind: "prop"; objectId: string; propKey: string }
  | { kind: "propagationRule"; ruleKey: string }
  | { kind: "link"; linkKey: string; fromId: string; toId: string }
  | { kind: "derivedProp"; typeKey: string; propKey: string };

export type ImpactBucket = "recompute" | "rederive" | "rejudge" | "rewire";

export interface ImpactItem {
  bucket: ImpactBucket;
  /**
   * 稳定目标串：`sv:{objectId}.{stateVar}`（recompute）· `op:{objectId}.{propKey}`（rederive）·
   * `rule:{ruleKey}`（rejudge）· `pr:{ruleKey}` / `spec:{specKey}`（rewire）。
   */
  target: string;
  /** ≥1；焦点本身不计。多路径首达跳数（BFS 最短）。 */
  hops: number;
  /** 经由什么到达：传导规则 key / `derived:{type}.{prop}` / `spec:{key}` / linkKey / "expression"。 */
  via: string;
}

export interface UnresolvedImpact {
  /** 追不到的是什么（规则 key / 类型.属性 / 焦点描述）。 */
  what: string;
  /** 缺什么（零实例 / 解析失败原因 / 截断保险丝）。 */
  missing: string;
}

export interface ChangeImpactPreview {
  focus: ChangeFocus;
  /** 稳定排序：(hops, bucket, target)——同世界同焦点同输出（R6）。 */
  items: ImpactItem[];
  unresolved: UnresolvedImpact[];
  truncated: boolean;
  maxHops: number;
}

/**
 * 跳数保险丝。论据：终止由 visited 集保证（有限节点集，每节点只展开一次），本上限只是
 * 防御性兜底；本仓最深真实传导链 = 3 跳（seedDemoPropagationRules 的 Order→Model→Base→Line），
 * 32 给 10× 余量。参照物 REF-ontology-twin-ux.html 用 MAX_DEPTH=256，但它**不记跳数、
 * 只用 seen 防环**，256 是遍历上限；本实现逐跳计数且节点含实例级对象，32 已远超任何
 * 合理链长。触发即 truncated:true + unresolved 点名，不静默。
 */
export const CHANGE_IMPACT_MAX_HOPS = 32;

// ---------------------------------------------------------------------------
// 预览核心（纯函数）
// ---------------------------------------------------------------------------

type NodeKind = "sv" | "op" | "pr" | "spec" | "rule";

interface BfsNode {
  kind: NodeKind;
  /** sv/op: objectId；pr/rule: ruleKey；spec: specKey。 */
  id: string;
  /** sv: stateVar；op: propKey；其余空串。 */
  member: string;
  hops: number;
}

const nodeKey = (n: BfsNode) => (n.member ? `${n.kind}:${n.id}.${n.member}` : `${n.kind}:${n.id}`);
// 导航索引键：`\0` 分隔（linkKey / 对象 id 自身可含 `|`，撞键即假阴性——propagation.ts 同款）。
// ⚠ 构建与所有查找必须同用本函数，不许各写一份字面量——曾因此回归（构建处 \0 / 查找处 |），
// 6 例导航全落空；而字面 NUL 又会让 file/grep 把整文件判成二进制、回归藏住。两头都是铁律 0.6 活实例。
const navKey = (linkKey: string, objectId: string) => `${linkKey}${objectId}`;

export function previewChangeImpact(
  world: ChangeImpactWorld,
  focus: ChangeFocus,
  opts?: { maxHops?: number },
): ChangeImpactPreview {
  const maxHops = opts?.maxHops ?? CHANGE_IMPACT_MAX_HOPS;
  const unresolved: UnresolvedImpact[] = [];
  const items: ImpactItem[] = [];
  let truncated = false;

  // ── 索引（一次性）─────────────────────────────────────────────────────────
  const objById = new Map(world.objects.map((o) => [o.id, o]));
  const typeOf = (id: string) => objById.get(id)?.typeKey;
  const objectsByType = new Map<string, ChangeImpactObject[]>();
  for (const o of world.objects) {
    (objectsByType.get(o.typeKey) ?? objectsByType.set(o.typeKey, []).get(o.typeKey)!).push(o);
  }
  const navOut = new Map<string, ChangeImpactLink[]>(); // navKey(linkKey, fromId)
  const navIn = new Map<string, ChangeImpactLink[]>(); // navKey(linkKey, toId)
  for (const l of world.links) {
    const ko = navKey(l.linkKey, l.fromId);
    const ki = navKey(l.linkKey, l.toId);
    (navOut.get(ko) ?? navOut.set(ko, []).get(ko)!).push(l);
    (navIn.get(ki) ?? navIn.set(ki, []).get(ki)!).push(l);
  }

  // 传导规则：按 (sourceType, sourceStateVar) 索引 + 全租户实例计数（零实例 = 接了线没数据）。
  const propRulesBySource = new Map<string, ChangeImpactPropagationRule[]>();
  const propRuleInstanceCount = new Map<string, number>();
  for (const r of world.propagationRules) {
    const k = `${r.sourceTypeKey}.${r.sourceStateVar}`;
    (propRulesBySource.get(k) ?? propRulesBySource.set(k, []).get(k)!).push(r);
    let n = 0;
    for (const l of world.links) {
      if (l.linkKey !== r.viaLinkKey) continue;
      if (typeOf(l.fromId) === r.sourceTypeKey && typeOf(l.toId) === r.targetTypeKey) n++;
    }
    propRuleInstanceCount.set(r.key, n);
  }

  // 派生公式：每类型每条公式编译一次。聚合 ⇒ 跨类型；算术 ⇒ 同对象标识符。
  // 解析复用 ontology.ts 同一实现（parseAggregate / evalArithmetic），不另抄正则。
  interface CompiledDerived {
    typeKey: string;
    propKey: string;
    formula: string;
    agg: { sourceType: string; sourceProp: string; byField: string } | null;
    arithDeps: string[]; // 算术型：同对象标识符（聚合型为空）
  }
  const derivedByType = new Map<string, CompiledDerived[]>();
  const aggBySource = new Map<string, CompiledDerived[]>(); // `${sourceType}.${sourceProp}` 与 `${sourceType}.${byField}`
  // 聚合的值同时依赖 sourceProp、byField（匹配集）与目标主键（applyAggregate 同口径）——
  // 三个键都要进索引，只索 sourceProp 会在「改 byField / 改目标主键」时假阴性（对抗审查实证）。
  const aggByTargetPk = new Map<string, CompiledDerived[]>(); // `${targetType}.${primaryKey}`
  for (const t of world.derivedTypes) {
    for (const d of t.derived) {
      const agg = parseAggregate(d.formula);
      const cd: CompiledDerived = {
        typeKey: t.typeKey,
        propKey: d.propKey,
        formula: d.formula,
        agg: agg
          ? { sourceType: agg.sourceType, sourceProp: agg.sourceProp, byField: agg.byField }
          : null,
        arithDeps: [],
      };
      if (!agg) {
        try {
          // 干跑只为验证语法（未知标识符按 0 计是 evalArithmetic 语义，不会误报）。
          evalArithmetic(d.formula, {});
          cd.arithDeps = [
            ...new Set(d.formula.match(/[A-Za-z_][\w]*/g) ?? []),
          ].sort();
        } catch (e) {
          unresolved.push({
            what: `${t.typeKey}.${d.propKey}`,
            missing: `派生公式解析失败：${e instanceof Error ? e.message : String(e)}`,
          });
          continue;
        }
      }
      (derivedByType.get(t.typeKey) ?? derivedByType.set(t.typeKey, []).get(t.typeKey)!).push(cd);
      if (cd.agg) {
        for (const k of [`${cd.agg.sourceType}.${cd.agg.sourceProp}`, `${cd.agg.sourceType}.${cd.agg.byField}`]) {
          (aggBySource.get(k) ?? aggBySource.set(k, []).get(k)!).push(cd);
        }
        const pkKey = `${t.typeKey}.${t.primaryKey}`;
        (aggByTargetPk.get(pkKey) ?? aggByTargetPk.set(pkKey, []).get(pkKey)!).push(cd);
      }
    }
  }
  const primaryKeyOf = new Map(world.derivedTypes.map((t) => [t.typeKey, t.primaryKey]));

  // DerivationSpec：dep (typeKey,prop) → specs（含 `Type.*` 通配，同 ontology-core propToSpecs）。
  const specsByDep = new Map<string, ChangeImpactDerivationSpec[]>();
  for (const s of world.derivationSpecs) {
    for (const d of s.deps) {
      const k = `${d.typeKey}.${d.prop}`;
      (specsByDep.get(k) ?? specsByDep.set(k, []).get(k)!).push(s);
    }
  }
  const specsFor = (typeKey: string, prop: string): ChangeImpactDerivationSpec[] => [
    ...(specsByDep.get(`${typeKey}.${prop}`) ?? []),
    ...(specsByDep.get(`${typeKey}.*`) ?? []),
  ];
  /** 镜像 ontology-core.ts resolveAffectedTargets：self dep ⇒ 自身；out ⇒ 目标在 fromId 侧；in ⇒ toId 侧。 */
  const resolveSpecTargets = (spec: ChangeImpactDerivationSpec, changedObjId: string): string[] => {
    const out = new Set<string>();
    const obj = objById.get(changedObjId);
    if (!obj) return [];
    if (spec.deps.some((d) => d.typeKey === spec.targetType && !d.via) && obj.typeKey === spec.targetType) {
      out.add(changedObjId);
    }
    for (const d of spec.deps) {
      if (!d.via) continue;
      if (d.direction === "out") {
        for (const l of navIn.get(navKey(d.via, changedObjId)) ?? []) {
          if (typeOf(l.fromId) === spec.targetType) out.add(l.fromId);
        }
      } else {
        for (const l of navOut.get(navKey(d.via, changedObjId)) ?? []) {
          if (typeOf(l.toId) === spec.targetType) out.add(l.toId);
        }
      }
    }
    return [...out].sort();
  };

  // 规则表达式：parseExpression 同一解析器；field 路径 + func 参数都抽（collectFieldPaths
  // 只抽 cmp 直挂 field，SUM(...) 的参数会漏——这里把 func.arg.path 一并收集）。
  // 解析失败 ⇒ 无法判定是否波及 ⇒ unresolved（不许静默当它不引用）。
  const rulesByField = new Map<string, ChangeImpactRule[]>(); // `Type.prop`
  for (const r of world.rules) {
    let ast: ReturnType<typeof parseExpression>;
    try {
      ast = parseExpression(r.expression);
    } catch (e) {
      unresolved.push({
        what: `rule:${r.key}`,
        missing: `规则表达式解析失败，无法判定是否波及：${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    const paths: string[][] = [];
    const walk = (v: unknown): void => {
      if (v == null || typeof v !== "object") return;
      if (Array.isArray(v)) {
        for (const x of v) walk(x);
        return;
      }
      const rec = v as Record<string, unknown>;
      if (rec.kind === "field" && Array.isArray(rec.path)) paths.push(rec.path as string[]);
      if (rec.kind === "func") {
        const arg = rec.arg as { path?: string[] } | undefined;
        if (arg && Array.isArray(arg.path)) paths.push(arg.path);
      }
      for (const x of Object.values(rec)) walk(x);
    };
    walk(ast);
    const keys = new Set<string>();
    const nestedPaths: string[] = [];
    for (const p of paths) {
      if (p.length === 2) {
        keys.add(`${p[0]}.${p[1]}`);
        // resolveField（ruledsl :450）的前缀丢弃回退：`Order.qty` 直查失败即按 ["qty"] 查——
        // 而 scheduler 按 scopeObjectTypes 逐类型求值 ⇒ 两段路径实际绑定到**每个 scope 类型**
        // 的同名 prop。只索 `${p[0]}.${p[1]}` 会在多 scope / 首段类型∉scope 时假阴性（对抗审查实证）。
        for (const st of r.scopeObjectTypes) keys.add(`${st}.${p[1]}`);
      } else if (p.length === 1) {
        for (const st of r.scopeObjectTypes) keys.add(`${st}.${p[0]}`);
      } else if (p.length > 2) {
        nestedPaths.push(p.join("."));
      }
    }
    if (nestedPaths.length > 0) {
      unresolved.push({
        what: `rule:${r.key}`,
        missing: `嵌套字段路径（${[...new Set(nestedPaths)].sort().join(", ")}）超出两段建模——该规则的波及判定可能不全`,
      });
    }
    for (const k of keys) {
      (rulesByField.get(k) ?? rulesByField.set(k, []).get(k)!).push(r);
    }
  }

  // ── BFS ───────────────────────────────────────────────────────────────────
  const visited = new Set<string>();
  const reachedPropRules = new Set<string>(); // 展开时碰到的传导规则（零实例判定只对这些做）
  const queue: BfsNode[] = [];

  const emit = (node: BfsNode, bucket: ImpactBucket, via: string) => {
    if (node.hops > maxHops) {
      if (!truncated) {
        truncated = true;
        unresolved.push({
          what: `hops>${maxHops} 的下游（首个断点 ${nodeKey(node)}，经由 ${via}）`,
          missing: `MAX_HOPS=${maxHops} 保险丝截断；终止本由 visited 集保证，此为防御性上限`,
        });
      }
      return;
    }
    const k = nodeKey(node);
    if (visited.has(k)) return;
    visited.add(k);
    items.push({ bucket, target: k, hops: node.hops, via });
    queue.push(node);
  };

  /** sv 节点展开：传导规则逐实例单跳（镜像 propagateTick 的 navOut 导航与类型匹配）。 */
  const expandStateVar = (n: BfsNode) => {
    const o = objById.get(n.id);
    if (!o) return;
    for (const r of propRulesBySource.get(`${o.typeKey}.${n.member}`) ?? []) {
      reachedPropRules.add(r.key);
      for (const l of navOut.get(navKey(r.viaLinkKey, n.id)) ?? []) {
        if (typeOf(l.toId) !== r.targetTypeKey) continue;
        emit(
          { kind: "sv", id: l.toId, member: r.targetStateVar, hops: n.hops + 1 },
          "recompute",
          r.key,
        );
      }
    }
  };

  /** op 节点展开：派生公式（算术同对象 / 聚合跨类型 BY 匹配）+ DerivationSpec + 规则 rejudge。 */
  const expandObjectProp = (n: BfsNode) => {
    const o = objById.get(n.id);
    if (!o) return;
    // 算术：同对象内引用该 prop 的派生。
    for (const cd of derivedByType.get(o.typeKey) ?? []) {
      if (!cd.agg && cd.arithDeps.includes(n.member)) {
        emit(
          { kind: "op", id: n.id, member: cd.propKey, hops: n.hops + 1 },
          "rederive",
          `derived:${cd.typeKey}.${cd.propKey}`,
        );
      }
    }
    // 聚合：该对象作为源，匹配目标主键（applyAggregate 同口径：标量相等或数组 includes）。
    // 改的是 byField 时同走这里——当前世界的匹配集 = 改前依赖集（失去贡献的那批必在其中）。
    for (const cd of aggBySource.get(`${o.typeKey}.${n.member}`) ?? []) {
      const pk = primaryKeyOf.get(cd.typeKey) ?? "id";
      for (const t of objectsByType.get(cd.typeKey) ?? []) {
        const by = o.props[cd.agg!.byField];
        const key = t.props[pk];
        const matches = Array.isArray(by) ? by.includes(key) : by === key;
        if (!matches) continue;
        emit(
          { kind: "op", id: t.id, member: cd.propKey, hops: n.hops + 1 },
          "rederive",
          `derived:${cd.typeKey}.${cd.propKey}`,
        );
      }
    }
    // 聚合目标侧：改的是目标主键 ⇒ 该目标自己的派生值重算（匹配集随 pk 变）。
    for (const cd of aggByTargetPk.get(`${o.typeKey}.${n.member}`) ?? []) {
      emit(
        { kind: "op", id: n.id, member: cd.propKey, hops: n.hops + 1 },
        "rederive",
        `derived:${cd.typeKey}.${cd.propKey}`,
      );
    }
    // DerivationSpec：dep 命中 ⇒ 反导航解析目标实例（resolveAffectedTargets 同语义）。
    for (const s of specsFor(o.typeKey, n.member)) {
      for (const tid of resolveSpecTargets(s, n.id)) {
        emit({ kind: "op", id: tid, member: s.targetProp, hops: n.hops + 1 }, "rederive", `spec:${s.specKey}`);
      }
    }
    // 规则表达式引用 ⇒ 重新判定（叶子：规则结果不回写值图）。
    for (const r of rulesByField.get(`${o.typeKey}.${n.member}`) ?? []) {
      emit({ kind: "rule", id: r.key, member: "", hops: n.hops + 1 }, "rejudge", "expression");
    }
  };

  /** pr 节点展开：该规则在全租户所有匹配实例上的 target（改规则 ⇒ 它驱动的这批变）。 */
  const expandPropRule = (n: BfsNode) => {
    const r = world.propagationRules.find((x) => x.key === n.id);
    if (!r) return;
    reachedPropRules.add(r.key);
    for (const l of world.links) {
      if (l.linkKey !== r.viaLinkKey) continue;
      if (typeOf(l.fromId) !== r.sourceTypeKey || typeOf(l.toId) !== r.targetTypeKey) continue;
      emit({ kind: "sv", id: l.toId, member: r.targetStateVar, hops: n.hops + 1 }, "recompute", r.key);
    }
  };

  /** spec 节点展开（结构改写后）：该规格当前解析出的全部目标实例。 */
  const expandSpec = (n: BfsNode) => {
    const s = world.derivationSpecs.find((x) => x.specKey === n.id);
    if (!s) return;
    // 规格的目标全集 = 对每个源实例做反导航的并集；等价于「目标类型的每个实例若有
    // 任一 dep 导航源存在」——此处取保守全集：目标类型所有实例（rewire 语义下目标解析
    // 本身在变，精确差分不可静态判定 ⇒ 给全集并在 via 注明）。
    for (const t of objectsByType.get(s.targetType) ?? []) {
      emit({ kind: "op", id: t.id, member: s.targetProp, hops: n.hops + 1 }, "rederive", `spec:${s.specKey}`);
    }
  };

  // ── 焦点落种 ──────────────────────────────────────────────────────────────
  let focusOk = true;
  if (focus.kind === "stateVar") {
    if (!objById.has(focus.objectId)) {
      unresolved.push({ what: `焦点对象 ${focus.objectId}`, missing: "对象在本租户不存在" });
      focusOk = false;
    } else {
      const k = `sv:${focus.objectId}.${focus.stateVar}`;
      visited.add(k);
      queue.push({ kind: "sv", id: focus.objectId, member: focus.stateVar, hops: 0 });
    }
  } else if (focus.kind === "prop") {
    if (!objById.has(focus.objectId)) {
      unresolved.push({ what: `焦点对象 ${focus.objectId}`, missing: "对象在本租户不存在" });
      focusOk = false;
    } else {
      const k = `op:${focus.objectId}.${focus.propKey}`;
      visited.add(k);
      queue.push({ kind: "op", id: focus.objectId, member: focus.propKey, hops: 0 });
    }
  } else if (focus.kind === "propagationRule") {
    const r = world.propagationRules.find((x) => x.key === focus.ruleKey);
    if (!r) {
      unresolved.push({ what: `焦点传导规则 ${focus.ruleKey}`, missing: "规则不存在或非 PUBLISHED" });
      focusOk = false;
    } else {
      const k = `pr:${r.key}`;
      visited.add(k);
      queue.push({ kind: "pr", id: r.key, member: "", hops: 0 });
    }
  } else if (focus.kind === "link") {
    const link = world.links.find(
      (l) => l.linkKey === focus.linkKey && l.fromId === focus.fromId && l.toId === focus.toId,
    );
    if (!link) {
      unresolved.push({
        what: `焦点边 ${focus.fromId} --${focus.linkKey}--> ${focus.toId}`,
        missing: "该边实例在本租户不存在",
      });
      focusOk = false;
    } else {
      // rewire：吃这条边的传导规则与 DerivationSpec 先列（hop 1），再列经它流动的值（hop 1）。
      // sv/op 先于 pr/spec 入队 ⇒ 下游值拿到最短跳数（pr/spec 展开出的同节点已 visited）。
      for (const r of world.propagationRules) {
        if (r.viaLinkKey !== focus.linkKey) continue;
        if (typeOf(focus.fromId) !== r.sourceTypeKey || typeOf(focus.toId) !== r.targetTypeKey) continue;
        reachedPropRules.add(r.key);
        emit({ kind: "sv", id: focus.toId, member: r.targetStateVar, hops: 1 }, "recompute", r.key);
        emit({ kind: "pr", id: r.key, member: "", hops: 1 }, "rewire", focus.linkKey);
      }
      for (const s of world.derivationSpecs) {
        if (!s.deps.some((d) => d.via === focus.linkKey)) continue;
        for (const d of s.deps) {
          if (d.via !== focus.linkKey) continue;
          const targetId = d.direction === "out" ? focus.fromId : focus.toId;
          if (typeOf(targetId) === s.targetType) {
            emit({ kind: "op", id: targetId, member: s.targetProp, hops: 1 }, "rederive", `spec:${s.specKey}`);
          }
        }
        emit({ kind: "spec", id: s.specKey, member: "", hops: 1 }, "rewire", focus.linkKey);
      }
    }
  } else {
    // derivedProp：改公式 ⇒ 该类型全部实例的该派生值重算（hop 1），再沿各自下游走。
    const t = world.derivedTypes.find((x) => x.typeKey === focus.typeKey);
    const d = t?.derived.find((x) => x.propKey === focus.propKey);
    if (!t || !d) {
      unresolved.push({
        what: `焦点派生 ${focus.typeKey}.${focus.propKey}`,
        missing: "该类型不存在，或其 derivedProperties 无此 propKey",
      });
      focusOk = false;
    } else {
      const instances = objectsByType.get(focus.typeKey) ?? [];
      if (instances.length === 0) {
        unresolved.push({
          what: `焦点派生 ${focus.typeKey}.${focus.propKey}`,
          missing: `类型 ${focus.typeKey} 无实例（接了线没数据），公式改动当前无对象可波及`,
        });
      }
      for (const o of instances) {
        emit({ kind: "op", id: o.id, member: focus.propKey, hops: 1 }, "rederive", `derived:${focus.typeKey}.${focus.propKey}`);
      }
    }
  }

  // ── 主循环 ────────────────────────────────────────────────────────────────
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.hops >= maxHops) {
      // 到达保险丝的节点仍可能有出边——判一次，有即截断点名。
      truncatedProbe(n);
      continue;
    }
    if (n.kind === "sv") expandStateVar(n);
    else if (n.kind === "op") expandObjectProp(n);
    else if (n.kind === "pr") expandPropRule(n);
    else if (n.kind === "spec") expandSpec(n);
    // rule 节点 = rejudge 叶子，不展开。
  }

  /** 探 hop===maxHops 节点是否还有未走的出边（有 ⇒ truncated + 点名一次）。 */
  function truncatedProbe(n: BfsNode) {
    if (truncated) return;
    const hasOutgoing = (() => {
      if (n.kind === "sv") {
        const o = objById.get(n.id);
        if (!o) return false;
        return (propRulesBySource.get(`${o.typeKey}.${n.member}`) ?? []).some(
          (r) => (navOut.get(navKey(r.viaLinkKey, n.id)) ?? []).some((l) => typeOf(l.toId) === r.targetTypeKey),
        );
      }
      if (n.kind === "op") {
        const o = objById.get(n.id);
        if (!o) return false;
        return (
          (derivedByType.get(o.typeKey) ?? []).some((cd) => !cd.agg && cd.arithDeps.includes(n.member)) ||
          (aggBySource.get(`${o.typeKey}.${n.member}`) ?? []).length > 0 ||
          specsFor(o.typeKey, n.member).length > 0 ||
          (rulesByField.get(`${o.typeKey}.${n.member}`) ?? []).length > 0
        );
      }
      return n.kind === "pr" || n.kind === "spec";
    })();
    if (hasOutgoing) {
      truncated = true;
      unresolved.push({
        what: `hops>${maxHops} 的下游（断点 ${nodeKey(n)}）`,
        missing: `MAX_HOPS=${maxHops} 保险丝截断；终止本由 visited 集保证，此为防御性上限`,
      });
    }
  }

  // ── 可达但零实例的传导规则（接了线没数据 ⇒ 追不到，明说）────────────────────
  for (const key of [...reachedPropRules].sort()) {
    if ((propRuleInstanceCount.get(key) ?? 0) === 0) {
      const r = world.propagationRules.find((x) => x.key === key)!;
      unresolved.push({
        what: `pr:${key}`,
        missing: `规则经 ${r.viaLinkKey}（${r.sourceTypeKey}→${r.targetTypeKey}）在本租户零实例——结构上可达、数据上追不到（接了线没数据）`,
      });
    }
  }

  items.sort((a, b) => a.hops - b.hops || a.bucket.localeCompare(b.bucket) || a.target.localeCompare(b.target));
  unresolved.sort((a, b) => a.what.localeCompare(b.what));
  if (!focusOk) return { focus, items: [], unresolved, truncated, maxHops };
  return { focus, items, unresolved, truncated, maxHops };
}

/** 测试/接线便利：recompute 桶的 `objectId.stateVar` 集合（预览 vs 实际一致性的比对面）。 */
export function recomputeStateVars(preview: ChangeImpactPreview): string[] {
  return preview.items
    .filter((i) => i.bucket === "recompute")
    .map((i) => i.target.slice("sv:".length))
    .sort();
}

// ---------------------------------------------------------------------------
// 世界装配器（唯一 I/O 处；口径与 buildPropagationInputs 同源：对象非 mergedInto、
// 规则只 PUBLISHED；派生/规格/规则表达式各自按运行引擎同款过滤）
// ---------------------------------------------------------------------------

export async function buildChangeImpactWorld(repos: Repos, tenantId: string): Promise<ChangeImpactWorld> {
  // 传导图物化**不过滤 status**——镜像 buildPropagationInputs（propagation-inputs.ts :72）：
  // propagateTick 的 typeOf/idsByType 收全类型对象，非 ACTIVE 类型的对象与边在真传导图里，
  // 预览少了它们 = recompute 桶假阴性（对抗审查实证：曾把派生族的 ACTIVE 过滤漏进图物化）。
  const allTypes = await repos.ontologyTypes.list(tenantId);
  const objects: ChangeImpactObject[] = [];
  for (const t of allTypes) {
    for (const o of await repos.objects.listByType(tenantId, t.key)) {
      if (!o.mergedInto) objects.push({ id: o.id, typeKey: o.type, props: o.props });
    }
  }
  // ACTIVE 过滤只留给派生族（runDerivations 走 listTypes=ACTIVE，ontology.ts :144/:864）。
  const types = allTypes.filter((t) => t.status === "ACTIVE");
  const links = (await repos.links.list(tenantId)).map((l) => ({
    fromId: l.fromId,
    toId: l.toId,
    linkKey: l.type,
  }));
  const propagationRules = (await repos.sim.listPropagationRules(tenantId, true)).map((r) => ({
    key: r.key,
    sourceTypeKey: r.sourceTypeKey,
    sourceStateVar: r.sourceStateVar,
    viaLinkKey: r.viaLinkKey,
    targetTypeKey: r.targetTypeKey,
    targetStateVar: r.targetStateVar,
  }));
  const derivedTypes = types
    .filter((t) => t.derivedProperties.length > 0)
    .map((t) => ({
      typeKey: t.key,
      primaryKey: t.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id",
      derived: t.derivedProperties.map((d) => ({ propKey: d.propKey, formula: d.formula })),
    }));
  const derivationSpecs = (await repos.derivationSpecs.list(tenantId, (s) => s.status === "ACTIVE")).map((s) => ({
    specKey: s.specKey,
    targetType: s.targetType,
    targetProp: s.targetProp,
    deps: s.deps,
  }));
  const rules = (await repos.rules.list(tenantId, (r) => r.status === "PUBLISHED")).map((r) => ({
    key: r.key,
    expression: r.expression,
    scopeObjectTypes: r.scopeObjectTypes,
  }));
  return { objects, links, propagationRules, derivedTypes, derivationSpecs, rules };
}
