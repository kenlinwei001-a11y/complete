/**
 * WO-MULTISRC-FUSION-DOMAIN · N1 多源融合引擎（纯函数核·确定性 R6·建在 SolverBinding 之上）。
 *
 * 输入：已经 SolverBinding 归一到同一 canonical role 的多源对象实例（每源一份类型/字段映射），
 * 按业务主键 (pk) 归并 → 逐字段冲突仲裁（规则驱动·A5 DSL 可编辑·G-10）→ 数值测谎（跨源不一致
 * 超阈值 → SUSPECT + 置信降级·**不照单全收 R13**）→ 带置信+溯源的融合答案。
 *
 * 本文件**只做纯计算**（无 IO / 无时钟 / 无随机）：对象加载、审计留痕、快照落库在 service 层。
 * 复用 ①（solver-binding role 归一）、A5 规则 DSL（arbitration 规则表达式经 evaluateExpression 判定
 * 字段级策略覆盖）、既有 audit（service 层调 AuditService）。不新造并行引擎。
 */
import type {
  ArbitrationStrategy,
  FusedField,
  FusedObject,
  FusionSource,
  MultiSourceFusionOutput,
} from "@platform/contracts";
import type { AstNode } from "../ruledsl.js";
import { evaluateAst } from "../ruledsl.js";

/** 一个已加载的源：源声明 + 该源在 role 下的对象实例（props 已是真实字段）。 */
export interface LoadedFusionSource {
  spec: FusionSource;
  /** 该源对象：{ pk: string, props: Record<string,unknown> }（pk 已按 spec.pkField/主键抽取）。 */
  rows: { pk: string; props: Record<string, unknown> }[];
}

/**
 * 字段级仲裁规则（A5 DSL）：当 `when` 表达式对某字段的跨源上下文求值为真时，用 `strategy` 仲裁该字段。
 * `when` 已解析为 AstNode（service 层用 parseExpression 解析规则 expression，R6）。规则驱动 = G-10 可编辑。
 * payload 上下文：`field`（当前 canonical 字段名）、`role`、`conflict`（是否多源冲突）、`suspect`（测谎命中）、
 * `spread`（跨源相对极差）、`sourceCount`。规则表达式可写如 `suspect == true`（测谎命中走 CONSERVATIVE）。
 */
export interface ArbitrationRuleAst {
  key: string;
  name: string;
  /** 匹配该字段（canonical 字段名精确匹配；缺省匹配所有字段）。 */
  field?: string;
  when: AstNode;
  strategy: ArbitrationStrategy;
}

export interface FusionEngineArgs {
  role: string;
  sources: LoadedFusionSource[];
  fields: string[];
  suspectThreshold: number;
  defaultStrategy: ArbitrationStrategy;
  /** A5 规则驱动的字段级策略覆盖（可编辑·G-10）。按数组序优先命中。 */
  rules?: ArbitrationRuleAst[];
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 中位数（确定性；空返回 0）。 */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** 稳定判等（数值容差 1e-9，其余 JSON 串比）。 */
function eq(a: unknown, b: unknown): boolean {
  if (isNum(a) && isNum(b)) return Math.abs(a - b) < 1e-9;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 众数（确定性：命中数降序 → 值 JSON 串字典序 tie-break）。返回 { value, count }。 */
function mode(values: { source: string; value: unknown }[]): { value: unknown; count: number } {
  const buckets: { value: unknown; count: number; key: string }[] = [];
  for (const { value } of values) {
    const hit = buckets.find((b) => eq(b.value, value));
    if (hit) hit.count++;
    else buckets.push({ value, count: 1, key: JSON.stringify(value) });
  }
  buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return buckets[0]!;
}

/**
 * 解析 canonical 字段 → 某源真实字段（fieldMap 缺省字段名一致·与 SolverBinding.resolveField 同范式）。
 */
function realField(spec: FusionSource, canonicalField: string): string {
  return spec.fieldMap?.[canonicalField] ?? canonicalField;
}

/**
 * 融合一个字段：收集各源取值 → 测谎（数值极差超阈值）→ 仲裁（策略选值）→ 置信。
 * 审慎口径（R13）：测谎命中 → 强制 CONSERVATIVE（取最保守/最不利值·不照单全收虚报）+ 越界源置信砍半 + 字段整体置信降级。
 */
function fuseField(
  field: string,
  role: string,
  perSource: { source: string; typeKey: string; value: unknown; authority: number; asOf: number | null }[],
  threshold: number,
  defaultStrategy: ArbitrationStrategy,
  rules: ArbitrationRuleAst[],
): FusedField {
  // 只保留有值（非 undefined/null）的源参与仲裁。
  const present = perSource.filter((s) => s.value !== undefined && s.value !== null);
  const nums = present.filter((s) => isNum(s.value)) as {
    source: string;
    typeKey: string;
    value: number;
    authority: number;
    asOf: number | null;
  }[];

  // 冲突：≥2 源且取值不全相同。
  const distinct: unknown[] = [];
  for (const s of present) if (!distinct.some((d) => eq(d, s.value))) distinct.push(s.value);
  const conflict = present.length >= 2 && distinct.length >= 2;

  // 测谎（数值维）：跨源相对极差 (max-min)/|median| 超阈值 → 疑虚报。
  let suspect = false;
  let suspectEvidence: FusedField["suspectEvidence"];
  let outlierSource: string | null = null;
  if (nums.length >= 2) {
    const values = nums.map((n) => n.value);
    const mx = Math.max(...values);
    const mn = Math.min(...values);
    const med = median(values);
    const denom = Math.abs(med) > 1e-9 ? Math.abs(med) : 1;
    const spread = round6((mx - mn) / denom);
    if (spread > threshold) {
      suspect = true;
      // 越界源 = 偏离中位最远者（确定性 tie-break by source 字典序）。
      const ranked = [...nums].sort(
        (a, b) => Math.abs(b.value - med) - Math.abs(a.value - med) || a.source.localeCompare(b.source),
      );
      const outlier = ranked[0]!;
      outlierSource = outlier.source;
      suspectEvidence = {
        spread,
        threshold,
        outlierSource: outlier.source,
        outlierValue: outlier.value,
        median: round6(med),
      };
    }
  }

  // 策略选择（规则驱动·A5 DSL·G-10 可编辑）：测谎命中优先 CONSERVATIVE（审慎·不照单全收）；
  // 否则按字段级规则命中；再否则默认策略。
  let strategy: ArbitrationStrategy = defaultStrategy;
  let ruleKey: string | null = null;
  if (suspect) {
    strategy = "CONSERVATIVE";
  } else {
    const ctx = {
      field,
      role,
      conflict,
      suspect,
      spread: suspectEvidence?.spread ?? 0,
      sourceCount: present.length,
    };
    for (const r of rules) {
      if (r.field && r.field !== field) continue;
      if (evaluateAst(r.when, { payload: ctx })) {
        strategy = r.strategy;
        ruleKey = r.key;
        break;
      }
    }
  }

  // 仲裁：按策略选采纳源/值。
  const pickAuthority = () =>
    [...present].sort((a, b) => b.authority - a.authority || a.source.localeCompare(b.source))[0];
  const pickFreshness = () =>
    [...present].sort(
      (a, b) => (b.asOf ?? -Infinity) - (a.asOf ?? -Infinity) || a.source.localeCompare(b.source),
    )[0];

  let chosen: { source: string; value: unknown };
  let reason: string;
  if (present.length === 0) {
    chosen = { source: "(none)", value: undefined };
    reason = "无源提供该字段取值";
  } else if (strategy === "CONSERVATIVE" && nums.length >= 2) {
    // 审慎：取最保守值。测谎命中场景多为"虚报偏高"（如产能虚高好看）→ 取**最小值**（最不利/最保守），
    // 明确不照单全收越界源的虚高值（R13）。溯源到提供该保守值的源。
    const minSrc = [...nums].sort((a, b) => a.value - b.value || a.source.localeCompare(b.source))[0]!;
    chosen = { source: minSrc.source, value: minSrc.value };
    reason = suspect
      ? `测谎命中（源 ${outlierSource} 疑虚报，跨源极差 ${suspectEvidence!.spread} > 阈值 ${threshold}）→ 审慎取最保守值（最小 ${minSrc.value}·不照单全收）`
      : `审慎策略：取最保守（最小）值 ${minSrc.value}`;
  } else if (strategy === "FRESHNESS") {
    const f = pickFreshness()!;
    chosen = { source: f.source, value: f.value };
    reason = `新鲜度优先：采纳最新源 ${f.source}`;
  } else if (strategy === "MAJORITY") {
    const m = mode(present.map((s) => ({ source: s.source, value: s.value })));
    // 采纳众数值·溯源到首个提供众数值的源（确定性）。
    const src = [...present].filter((s) => eq(s.value, m.value)).sort((a, b) => a.source.localeCompare(b.source))[0]!;
    chosen = { source: src.source, value: m.value };
    reason = `多数票：${m.count}/${present.length} 源一致，采纳 ${src.source}`;
  } else {
    // AUTHORITY（默认）。
    const a = pickAuthority()!;
    chosen = { source: a.source, value: a.value };
    reason = conflict
      ? `权威源优先：采纳权威度最高源 ${a.source}`
      : `全源一致，采纳 ${a.source}`;
  }
  if (ruleKey) reason = `规则 ${ruleKey} → ${reason}`;

  // 逐源置信：权威度归一为基线（0.5 + 0.5*authorityShare）；测谎命中的越界源砍半。
  const maxAuth = Math.max(1, ...present.map((s) => s.authority));
  const sources = perSource.map((s) => {
    let conf = 0.5 + 0.5 * (Math.max(0, s.authority) / maxAuth);
    if (suspect && s.source === outlierSource) conf = round6(conf * 0.5);
    return { source: s.source, typeKey: s.typeKey, value: s.value, confidence: round6(conf) };
  });

  // 字段整体置信：一致=高(0.95)；冲突降(0.7)；测谎命中再降(0.35·R13 不照单全收)。
  let fieldConf = 0.95;
  if (conflict) fieldConf = 0.7;
  if (suspect) fieldConf = 0.35;

  return {
    field,
    value: chosen.value,
    chosenSource: chosen.source,
    reason,
    strategy,
    conflict,
    suspect,
    ...(suspectEvidence ? { suspectEvidence } : {}),
    confidence: fieldConf,
    sources,
  };
}

/**
 * 融合引擎主入口（纯函数·R6）：按 pk 归并多源 → 逐字段仲裁/测谎 → FusedObject 数组 + 头条诚实位。
 */
export function fuseMultiSource(args: FusionEngineArgs): {
  output: MultiSourceFusionOutput;
  objects: FusedObject[];
} {
  const { role, sources, fields, suspectThreshold, defaultStrategy } = args;
  const rules = args.rules ?? [];

  // 归并索引：pk → 逐源 row。
  const pks: string[] = [];
  const bySourcePk = new Map<string, Map<string, { pk: string; props: Record<string, unknown> }>>();
  for (const ls of sources) {
    const m = new Map<string, { pk: string; props: Record<string, unknown> }>();
    for (const r of ls.rows) {
      m.set(r.pk, r);
      if (!pks.includes(r.pk)) pks.push(r.pk);
    }
    bySourcePk.set(ls.spec.sourceLabel, m);
  }
  pks.sort(); // 确定性

  const fusedObjects: FusedObject[] = [];
  const strategiesUsed = new Set<ArbitrationStrategy>();
  let suspectCount = 0;
  let conflictCount = 0;

  for (const pk of pks) {
    // 参与该 pk 的源（有该 pk 行的源）。
    const contributing = sources.filter((s) => bySourcePk.get(s.spec.sourceLabel)!.has(pk));
    // 单源对象：无融合意义（≥2 才谈融合），跳过（诚实——不为单源伪造 fused）。
    if (contributing.length < 2) continue;

    const fusedFields: FusedField[] = [];
    let objConflict = false;
    let objSuspect = false;
    for (const field of fields) {
      const perSource = contributing.map((s) => {
        const row = bySourcePk.get(s.spec.sourceLabel)!.get(pk)!;
        const val = row.props[realField(s.spec, field)];
        const asOfRaw = s.spec.asOfField ? row.props[s.spec.asOfField] : undefined;
        const asOf = typeof asOfRaw === "string" ? Date.parse(asOfRaw) : isNum(asOfRaw) ? asOfRaw : null;
        return {
          source: s.spec.sourceLabel,
          typeKey: s.spec.typeKey,
          value: val,
          authority: s.spec.authority ?? 0,
          asOf: Number.isNaN(asOf as number) ? null : asOf,
        };
      });
      const ff = fuseField(field, role, perSource, suspectThreshold, defaultStrategy, rules);
      strategiesUsed.add(ff.strategy);
      if (ff.conflict) objConflict = true;
      if (ff.suspect) objSuspect = true;
      fusedFields.push(ff);
    }
    if (objConflict) conflictCount++;
    if (objSuspect) suspectCount++;
    const objConf = round6(Math.min(...fusedFields.map((f) => f.confidence)));
    fusedObjects.push({
      pk,
      role,
      fields: fusedFields,
      verdict: objSuspect ? "SUSPECT" : "TRUSTED",
      contributingSources: contributing.map((s) => s.spec.sourceLabel).sort(),
      confidence: objConf,
    });
  }

  // 头条诚实位（审慎·R13）：有测谎命中 → MOCK（不冒充真值）；有冲突 → PARTIAL；全一致 → LIVE。
  const dataMode: MultiSourceFusionOutput["dataMode"] =
    suspectCount > 0 ? "MOCK" : conflictCount > 0 ? "PARTIAL" : "LIVE";

  const summary =
    `多源融合 ${fusedObjects.length} 个对象（role=${role}·${sources.length} 源）：` +
    `${conflictCount} 个存在跨源冲突经仲裁，${suspectCount} 个测谎命中标 SUSPECT（置信降级·不照单全收）。`;

  return {
    output: {
      role,
      fused: fusedObjects,
      suspectCount,
      conflictCount,
      dataMode,
      strategies: [...strategiesUsed].sort(),
      summary,
    },
    objects: fusedObjects,
  };
}
