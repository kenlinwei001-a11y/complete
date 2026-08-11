/**
 * 求解器**作用域诚实位**的前端读取器（单一出处·后→前这一跳）。
 *
 * ── 病灶（欠账 #178 · 本文件是它的前端半边）────────────────────────────────────
 * 引擎侧已经把「这个数到底算的是谁」显式下发了（WO-SEAM-ARG-DROP / WO-BASE-ID-FIDELITY /
 * WO-ENGINE-SCOPE-FIX(2)），但**前端一个字段都没读**：`grep -rn scopeNote apps/frontend-shell` = 0。
 * 于是屏上是一个「看起来像局部答案」的全域数字 —— 这正是引擎侧花了两轮工单去消灭的
 * 「假个性化」，在最后一跳原样复活。
 *
 * ── 为什么读取器要单独成文件（而不是在视图里写 `if (out.scope === "ALL")`）──────
 * 诚实位在后端**有三种形状**，是不同工单在不同时间加的，键名与取值都不一样。
 * 散在各视图里写 `if`，等于把「今天有几种形状」这件事复制 N 份，加第四种时必漏。
 * 本文件是那份唯一的映射表；视图只消费归一后的 {level, note}。
 *
 * ── 三种形状（皆实测自 canonical·file:line 为引擎侧出处）─────────────────────────
 *  ① **扁平串 + scopeNote** —— `capacity_forecast`（`apps/datacore/src/solvers/capacity.ts:432-434`）
 *     `{ scope: "BASE"|"ALL", scopeBaseId?, scopeBaseName?, scopeNote: string }`
 *  ② **对象 + mode** —— `credit_exposure`（`solvers/extended.ts:840` CUSTOMER / `:847` ALL·缺省 `:463` EXPLICIT）、
 *     `capex_scenario`（`solvers/capex.ts:198-205` EXPLICIT / `:221-227` SCENARIO·随行输出 `:349`）
 *     `{ scope: { mode: "CUSTOMER"|"SCENARIO"|"ALL"|"EXPLICIT", note?, custName?, scenarioKey?, … } }`
 *  ③ **专名维 + dataMode:"EMPTY"** —— `changeover_sequence.lineScope`（装配 `extended.ts:793`·随行输出 `:333`）、
 *     `quarterly_gap.quarterScope`（装配 `extended.ts:968`·随行输出 `:498`）
 *     `{ dataMode: "EMPTY", reason: string, missingInputs?: … }`
 *
 * ── 本读取器**不认**的第四种形状（已实测存在·刻意不接·留给引擎侧先定性）─────────────
 * `gap_attribution` 另有一族：`scope:{baseId, displayName, exposure?}` + `globalGap` + `noBaseData`
 * （`solvers/service.ts:1661/1699/1733`）。它没有 `mode` 也没有 `note`，故落到 `readModed` 会返 `null`
 * ——**这是有意的**：`exposure:true` 说的是「敞口树·非全局分摊份额」，与本文件的「全域 vs 局部」
 * 不是同一个命题，硬塞进同一张档位表就是把两件事混成一句（本仓反复栽在这上面）。
 * 它的诚实话今天写在 `summary` 里且确实上了屏，缺的是**结构化标注**——属引擎侧口径先统一的事。
 *
 * ── 归一后的三档，对应 CLAUDE.md 铁律 0.5 的三态（**不许混为一谈·混了用户会去修错地方**）──
 *  · `SCOPED`   实参真进了计算，这个数就是你要的那个范围的数 —— 报出算的是谁即可，不是警告。
 *  · `GLOBAL`   该维**未限定**，这个数是全域合计 —— 诚实，但用户容易读成局部，需要留记号。
 *  · `UNAPPLIED` 实参**给了却没参与计算**（只当标签回显 / 该维数据层根本没有）——
 *               最危险的一档：屏上印着用户说的对象，数字却不是那个对象的。
 *
 * ⚠ `note` 一律**取后端原文**，前端不改写、不翻译、不摘要 —— 措辞是引擎侧的单一来源
 * （前端另写一句必然与引擎口径漂移，那正是本欠账要治的病）。前端只负责「让它上屏」。
 */

/** 归一后的诚实位档位（判据见文件头三态表）。 */
export type ScopeHonestyLevel = "SCOPED" | "GLOBAL" | "UNAPPLIED";

export interface ScopeHonesty {
  level: ScopeHonestyLevel;
  /** 后端下发的人话说明**原文**（单一来源·前端不改写）。 */
  note: string;
  /** 诚实位来自载荷哪个键（`scope` / `lineScope` / `quarterScope`）—— 排查用，不给用户看。 */
  field: string;
  /** 该维真正算到的那个对象（`SCOPED` 时有；如基地中文名 / 客户名 / 情景名）。 */
  scopedTo?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 形状①：扁平串 `scope:"BASE"|"ALL"` + `scopeNote`。 */
function readFlat(payload: Record<string, unknown>): ScopeHonesty | null {
  const mode = str(payload.scope);
  const note = str(payload.scopeNote);
  if (!mode || !note) return null;
  if (mode === "ALL") return { level: "GLOBAL", note, field: "scope" };
  // BASE（以及将来可能新增的其它「真收窄」取值）→ 实参真进了计算。
  return { level: "SCOPED", note, field: "scope", scopedTo: str(payload.scopeBaseName) || str(payload.scopeBaseId) || undefined };
}

/** 形状②：对象 `scope:{ mode, note? }`。 */
function readModed(payload: Record<string, unknown>): ScopeHonesty | null {
  const scope = payload.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return null;
  const s = scope as Record<string, unknown>;
  const mode = str(s.mode);
  if (!mode) return null;
  const note = str(s.note);
  const scopedTo = str(s.custName) || str(s.scenarioKey) || undefined;
  // EXPLICIT = 调用方直传数值/项目集 ⇒ 用户说的那个实参**没参与选型**，只当回显标签（capex_scenario 原话）。
  if (mode === "EXPLICIT") return note ? { level: "UNAPPLIED", note, field: "scope", scopedTo } : null;
  if (mode === "ALL") return note ? { level: "GLOBAL", note, field: "scope" } : null;
  // CUSTOMER / SCENARIO / …：真按实参重算。此档后端常不带 note（没什么要坦白的），故 note 可空。
  return { level: "SCOPED", note, field: "scope", scopedTo };
}

/** 形状③：专名维 `{lineScope|quarterScope}: { dataMode:"EMPTY", reason }`。 */
function readNamedDim(payload: Record<string, unknown>, field: string): ScopeHonesty | null {
  const dim = payload[field];
  if (typeof dim !== "object" || dim === null || Array.isArray(dim)) return null;
  const d = dim as Record<string, unknown>;
  if (str(d.dataMode) !== "EMPTY") return null;
  const reason = str(d.reason);
  if (!reason) return null;
  return { level: "UNAPPLIED", note: reason, field };
}

/** 形状③要扫的键（新增专名维时**只改这一行**）。 */
const NAMED_DIMS = ["lineScope", "quarterScope"] as const;

/**
 * 从**任意求解器成功载荷**里读作用域诚实位；没有诚实位 → `null`（视图据此什么都不画）。
 *
 * 判据（两个方向都必须成立，接缝测试逐条咬）：
 *  · 载荷**带**诚实位 ⇒ 返回非 null，`note` 逐字等于后端原文；
 *  · 载荷**不带** ⇒ 返回 `null`（**不许**编一句「未指定范围」——没说的话不许替后端说）。
 */
export function readScopeHonesty(raw: unknown): ScopeHonesty | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  for (const field of NAMED_DIMS) {
    const named = readNamedDim(payload, field);
    if (named) return named;
  }
  return readFlat(payload) ?? readModed(payload);
}
