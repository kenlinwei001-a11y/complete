/**
 * WO-RULE-SCOPE-DROP —— 规则 `scopeObjectTypes` 的**诚实校验**（单一实现，扫描/构建/门共用）。
 *
 * ## 病历（真跑取证，非推断）
 *
 * `RuleEntry` 上有两个长得很像、语义完全不同的东西：
 *
 * | 字段 | 含义 | 真值源 | 写错了会怎样（改前） |
 * |---|---|---|---|
 * | `expression` 里的 `Xxx.field` 前缀 | **求值期注入命名空间** | 调用方注入的 payload（如求解器 `base.Cert = {...}`） | 前缀可省略（`resolveField` 会退一层），大多仍可求值 |
 * | `scopeObjectTypes` | **本体对象类型键** | `ontology.listTypes()` | 类型不存在 ⇒ 所有消费方查空 ⇒ **规则永不参与评估，且零信号** |
 *
 * `battery.ts` 的原注释「与 expression 对象前缀一致」正是病根 —— 它把这两件事当成同一个东西，
 * 于是照着表达式前缀抄进了 `scopeObjectTypes`。二者恰好同名（`Order`/`Line`/`Customer`…）时没事；
 * `Batch`↔`MaterialBatch` 这种不同名的就悄悄错开。
 *
 * `scopeObjectTypes` 的真实消费方（全部按"它是对象类型键"来用）：
 *   - `scheduler.ts` `RuleScanService.scan`  → `objects.listByType(tenantId, typeKey)`（**评估驱动**）
 *   - `app.ts` `/a/v1/ontology/graph`        → 类型节点上挂哪些规则
 *   - `ontology.ts` / `mapping.ts`           → 类型↔规则映射表
 *   - `ontology/slice-layers.ts`             → 切片的规则层
 *   - `rules.ts`                             → 改 scope 的影响面传播
 *   - `databuilder/closure.ts`               → 正向闭包 HARD 门
 *
 * ## 本模块提供什么
 *
 * 一个**机器判据**，把「作用域解析不了」这件事分成两种**修法完全不同**的形态：
 *   - `RENAME_CANDIDATE`：本体里找得到唯一近似承载者 ⇒ 就是抄错了名，改名即可；
 *   - `NO_CARRIER`：本体里找不到任何候选 ⇒ **真缺对象类型**，记成缺口，**不许硬塞一个近似类型**。
 *
 * 判据是机器给的，不是人拍的 —— 这正是「同一个错第二次必须建机制」要的那种东西。
 */

/**
 * 未解析作用域的诚实位。
 *
 * `reason` 三态**互不可替代**（混为一谈就会修错地方，与铁律 0.5「三种不工作」同源）：
 *   - `RENAME_CANDIDATE`：本体里**恰好一个**候选 ⇒ 就是抄错名，改名即可；
 *   - `AMBIGUOUS`：候选**不止一个** ⇒ 机器判不准，**如实列出候选让人裁**，绝不替人挑一个；
 *   - `NO_CARRIER`：**零候选** ⇒ 本体里真没有这个承载类型，是缺口，需补类型或退役规则。
 */
export interface RuleScopeFinding {
  ruleKey: string;
  /** scope 里那个在本体中查不到的类型键。 */
  unknownTypeKey: string;
  /** **唯一**候选时才填；多候选或零候选一律 `null` —— 不猜。 */
  suggestion: string | null;
  /** 全部候选（0 / 1 / 多）。多候选时这就是交给人裁决的证据。 */
  candidates: string[];
  reason: "RENAME_CANDIDATE" | "AMBIGUOUS" | "NO_CARRIER";
}

/** 诚实位的事件名（落 outbox ⇒ `/a/v1/outbox` 与 webhook 都看得见）。 */
export const RULE_SCOPE_UNRESOLVED_EVENT = "rule.scope_unresolved";
/** 诚实位的结构化错误码（与错误信封同风格，便于前端/告警按码路由）。 */
export const RULE_SCOPE_UNRESOLVED_CODE = "RULE_SCOPE_TYPE_UNKNOWN";

/** 驼峰键的大写首字母缩写：`LongTermAgreement` → `LTA`。非驼峰返回空串。 */
function acronym(key: string): string {
  return key.replace(/[^A-Z]/g, "");
}

/**
 * 列出一个查不到的类型键在本体里的**全部**近似承载候选（确定性排序）。
 *
 * 三档，**取第一个非空档就停**（档内不再跨档混合）：
 *   1. 大小写不敏感全等  —— `order` → `Order`
 *   2. 已知键**包含**该串 —— `Batch` → `MaterialBatch`
 *   3. 驼峰首字母缩写全等 —— `Lta` → `LongTermAgreement`（L·T·A）
 *
 * 刻意**不做**编辑距离/前缀模糊匹配：那会把 `Outsource` 硬配到 `Order` 之类，
 * 把「真缺类型」伪装成「打错名」—— 正是本单要根治的那种自欺。
 */
export function typeKeyCandidates(unknownTypeKey: string, knownTypeKeys: Iterable<string>): string[] {
  const needle = unknownTypeKey.trim();
  if (!needle) return [];
  const lower = needle.toLowerCase();
  const known = [...knownTypeKeys];
  const sorted = (cands: string[]): string[] =>
    cands.slice().sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1));

  const exact = sorted(known.filter((k) => k.toLowerCase() === lower));
  if (exact.length > 0) return exact;
  const contains = sorted(known.filter((k) => k.toLowerCase().includes(lower)));
  if (contains.length > 0) return contains;
  return sorted(known.filter((k) => acronym(k).length >= 2 && acronym(k).toLowerCase() === lower));
}

/**
 * 给一个查不到的类型键推荐承载者 —— **只有唯一候选时才推荐**，否则返回 `null`。
 *
 * ⚠️ 这条「唯一才推荐」不是洁癖，是**实测逼出来的**（真跑 94 个类型的 demo 本体）：
 *   - `Cert`     → `Certification` **和** `OperatorSkillCert` 两个候选
 *   - `Scenario` → `AnnualScenario` **和** `ScenarioTrigger` 两个候选
 * 初版按「取最短」在多候选里挑一个，于是给 C10 的 `Scenario` 推荐了 `AnnualScenario` ——
 * **一个看起来很像、但完全不对的名字**。推荐器一旦开始猜，它产出的就不再是证据而是噪音，
 * 下一个人照着改就把缺口糊掉了。宁可说「有 2 个候选，你来定」。
 */
export function suggestTypeKey(unknownTypeKey: string, knownTypeKeys: Iterable<string>): string | null {
  const cands = typeKeyCandidates(unknownTypeKey, knownTypeKeys);
  return cands.length === 1 ? cands[0]! : null;
}

/**
 * 找出规则集合里所有**解析不到本体对象类型**的 scope 键。返回按 (ruleKey, unknownTypeKey) 稳定排序。
 * 已知类型集为空时返回空数组 —— 「本体还没建」不该被读成「所有规则都错」（否则种子期满屏假红）。
 */
export function findUnknownScopeTypes(
  rules: readonly { key: string; scopeObjectTypes?: readonly string[] }[],
  knownTypeKeys: Iterable<string>,
): RuleScopeFinding[] {
  const known = [...knownTypeKeys];
  if (known.length === 0) return [];
  const knownSet = new Set(known);
  const out: RuleScopeFinding[] = [];
  for (const r of rules) {
    for (const t of r.scopeObjectTypes ?? []) {
      if (knownSet.has(t)) continue;
      const candidates = typeKeyCandidates(t, known);
      out.push({
        ruleKey: r.key,
        unknownTypeKey: t,
        suggestion: candidates.length === 1 ? candidates[0]! : null,
        candidates,
        reason: candidates.length === 1 ? "RENAME_CANDIDATE" : candidates.length > 1 ? "AMBIGUOUS" : "NO_CARRIER",
      });
    }
  }
  return out.sort((a, b) =>
    a.ruleKey !== b.ruleKey ? (a.ruleKey < b.ruleKey ? -1 : 1) : a.unknownTypeKey < b.unknownTypeKey ? -1 : 1,
  );
}

/** 诚实位的人话文案（事件 payload / 日志共用一份，不许两处各写各的）。 */
export function ruleScopeMessage(f: RuleScopeFinding): string {
  const head = `规则 ${f.ruleKey} 的作用域类型 “${f.unknownTypeKey}” 不是本体对象类型 —— 该规则不会在任何对象上被评估`;
  if (f.reason === "RENAME_CANDIDATE") return `${head}；本体中恰有一个承载者，建议改为 “${f.suggestion}”。`;
  if (f.reason === "AMBIGUOUS")
    return `${head}；本体中有 ${f.candidates.length} 个近似承载者（${f.candidates.join(" / ")}）——` +
      `机器判不准该挂哪个，需人工裁决，**不要随手挑一个**。`;
  return `${head}，且本体中找不到任何近似承载者。这是「真缺对象类型」的缺口，需补建承载类型或退役该规则，**不要硬塞一个近似类型**。`;
}

/** 事件/错误共用的 payload 形状（结构化错误码 + 规则 key + 未知键 + 候选/建议名）。 */
export function ruleScopePayload(f: RuleScopeFinding): Record<string, unknown> {
  return {
    code: RULE_SCOPE_UNRESOLVED_CODE,
    ruleKey: f.ruleKey,
    unknownTypeKey: f.unknownTypeKey,
    suggestion: f.suggestion,
    candidates: f.candidates,
    reason: f.reason,
    message: ruleScopeMessage(f),
  };
}
