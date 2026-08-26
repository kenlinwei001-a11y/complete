/**
 * 求解器**作用域诚实位**的前端读取器（单一出处·后→前这一跳）。
 *
 * ── 病灶（欠账 #178 · 本文件是它的前端半边）────────────────────────────────────
 * 引擎侧已经把「这个数到底算的是谁」显式下发了（WO-SILENT-WRONG-ANSWER-3 /
 * WO-SEAM-ARG-DROP / WO-ENGINE-SCOPE-FIX2 三轮工单），但**前端一个字段都没读**。
 * 于是屏上是一个「看起来像局部答案」的全域数字 —— 这正是引擎侧几轮工单去消灭的
 * 「假个性化」，在最后一跳原样复活。
 *
 * ── 为什么读取器要单独成文件（而不是在视图里写 `if (out.scope === "ALL")`）──────
 * 诚实位在后端**有多种形状**，是不同工单在不同时间加的，键名与取值都不一样。
 * 散在各视图里写 `if`，等于把「今天有几种形状」这件事复制 N 份，加下一种时必漏。
 * 本文件是那份唯一的映射表；视图只消费归一后的 `{level, note}`。
 *
 * ── 三种本读取器**认**的形状（2026-08-13 亲手实测自 canonical）────────────────
 * 复验命令（行号会漂，符号才是可重复的判据；对不上时以命令输出为准并回写本注释）：
 *   `grep -rn 'scopeNote\|scope: { mode\|kitScope\|quoteScope\|lineScope =\|quarterScope =' apps/datacore/src/solvers/`
 *   ⚠ **别只 grep `scope: {`** —— `kit_readiness` / `quote_margin` 的诚实位是先装配到局部变量
 *   `kitScope` / `quoteScope`（`extended.ts:749/758` 与 `:918`），再在别处以 `scope: args.kitScope`
 *   （`:248`）/ `scope: args.quoteScope`（`:455`）随行输出。只 grep 字面 `scope: {` 会漏掉这两个，
 *   于是把「5 个求解器带扁平/对象诚实位」量成 3 个 —— 本文件第一版就是这么量错的。
 *
 *  ① **扁平串 + scopeNote** —— `{ scope: "BASE"|"ALL", scopeBaseId?, scopeBaseName?, scopeNote }`
 *     · `capacity_forecast` —— `apps/datacore/src/solvers/capacity.ts:442-444`（两分支全带）
 *     · `risk_timeline`     —— `apps/datacore/src/solvers/risk.ts:775-777`（两分支全带）
 *     ⚠ 这一族里**只有 `risk_timeline` 在契约里显式声明了这四个键**
 *       （`packages/contracts/src/solvers.ts:351-354`）。`capacity_forecast` 靠
 *       `CapacityForecastOutputSchema` 尾部的 `.catchall(z.unknown())`（同文件 `:152`）才没被
 *       `zod` strip 掉 —— 两条路都能到前端，但**机制不同**，改契约时别把 catchall 摘了。
 *  ② **对象 + mode** —— `{ scope: { mode: "BASE"|"ALL"|"CUSTOMER"|"SCENARIO"|"EXPLICIT", note?, … } }`
 *     · `credit_exposure` —— `solvers/extended.ts:968`（CUSTOMER·无 note）/ `:975`（ALL·有 note）
 *     · `capex_scenario`  —— `solvers/capex.ts:198-205`（EXPLICIT·有 note）/ `:221-227`（SCENARIO·无 note）
 *     · `kit_readiness`   —— `solvers/extended.ts:749`（BASE·有 note）/ `:758`（ALL·有 note），
 *       装配名 `kitScope`，随行输出 `:248`。⚠ 它另带 `orderPoolTotal`/`sampled`/`samplingNote`
 *       这一组**抽样诚实位**：`shortageCount` 的分母是 `sampled` 不是订单池。那是**另一个命题**
 *       （「算了几张」≠「算的是谁」），本文件不吞它 —— 谁给 `kit_readiness` 做界面，那两个数必须
 *       进第一层（它们改变结论的读法），别指望这枚徽标替它说。
 *  ③ **专名维 + dataMode:"EMPTY"** —— `{ dataMode: "EMPTY", reason, missingInputs? }`
 *     · `changeover_sequence.lineScope`  —— `solvers/extended.ts:858-871`（随行输出 `:873`）
 *     · `quarterly_gap.quarterScope`     —— `solvers/extended.ts:1097-1111`（随行输出 `:1112`）
 *
 * ── 本读取器**不认**的三种形状（已实测存在·刻意不接·理由逐条写死在这里）──────────
 * ④ `gap_attribution`：`scope:{ baseId, displayName, availableFactors, factorApplied?, … }`
 *    + `globalGap` + `noBaseData`（`solvers/service.ts:1739/1777/1812`）。没有 `mode` 也没有 `note`
 *    ⇒ 落到 `readModed` 返 `null`。**这是有意的**：`exposure:true` 说的是「敞口树·非全局分摊份额」，
 *    与本文件的「全域 vs 局部」不是同一个命题，硬塞进同一张档位表就是把两件事混成一句。
 *    它今天已被 `views/RiskBoardView.tsx` 的 `RootCausePanel` 局部消费（`availableFactors` /
 *    `factorApplied`），缺的是 `noBaseData`/`globalGap` 这一维 —— 属引擎侧口径先统一的事。
 * ⑤ `ChainScope` 回带（`echoChainScope`·`solvers/scope.ts:167`）：`affected_orders` /
 *    `order_fullchain` / `atp_check` / `chain_impediments` 在**限定了才回带** `scope:{baseIds,…}`。
 *    它是「你要的那一维我收到了」的回执，**未限定时字段整个不出现** ⇒ 恰好没有本文件要的那句
 *    「这个数是全域的」。当成诚实位读会得出相反结论（没字段=没限定=最该提醒，却什么都不画）。
 *    `chain_impediments` 那一路今天由 `views/sim/ChainImpedimentView.tsx:312` 另行显示。
 * ⑥ `quote_margin`：`scope:{ modelId, modelDimension:"APPLIED"|"ALL", modelNote, custName,
 *    custDimension:"NOT_APPLIED", custNote, missingInputs }`（装配名 `quoteScope`·
 *    `solvers/extended.ts:918-936`，随行输出 `:455`）。**没有 `mode`** ⇒ 落到 `readModed` 返 `null`。
 *    **这是有意的**：它是**两个彼此独立的维**（型号维今天真生效 · 客户维恒 `NOT_APPLIED`），
 *    压进单个 `{level, note}` 必然只能说其中一维，另一维当场消失 —— 而消失掉的那一维恰恰是
 *    「换个客户名 margin 不会变」这句最该上屏的话。要接它得画**两行**，不是一枚徽标。
 *    今天 `quote_margin` 与 `kit_readiness` 在前端**都还没有任何调用方**
 *    （`grep -rn 'kit_readiness\|quote_margin' apps/frontend-shell/src` 只命中
 *    `mocks/fixtures.ts:1293` 的一条解读文案），所以这不是「接错地方」而是「还没有地方可接」。
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
  return {
    level: "SCOPED",
    note,
    field: "scope",
    scopedTo: str(payload.scopeBaseName) || str(payload.scopeBaseId) || undefined,
  };
}

/** 形状②：对象 `scope:{ mode, note? }`。 */
function readModed(payload: Record<string, unknown>): ScopeHonesty | null {
  const scope = payload.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return null;
  const s = scope as Record<string, unknown>;
  const mode = str(s.mode);
  if (!mode) return null;
  const note = str(s.note);
  // 「算的是谁」在各求解器里叫不同的名字：客户名 / 情景名 / 基地中文名（`kit_readiness` 的 BASE 路）。
  // 一律优先取**人看得懂的名字**，`baseId` 这类机器键垫底 —— id 用户不认识，拿它当名字等于没说。
  const scopedTo = str(s.custName) || str(s.scenarioKey) || str(s.baseName) || str(s.baseId) || undefined;
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
