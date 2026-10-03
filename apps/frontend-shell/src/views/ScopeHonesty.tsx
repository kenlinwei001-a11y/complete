import { InfoPopover } from "@/components/InfoPopover";
import { ScopeHonestyBadge } from "@/components/ScopeHonestyBadge";
import { readScopeHonesty } from "@/lib/solverScopeHonesty";
import zh from "@/locales/zh";

/**
 * WO-SCOPE-HONESTY-FE ·「这次算的是谁」在 `kit_readiness` / `quote_margin` 两个求解器上的界面半边。
 *
 * ══ ⚠ 先读这一段：本文件**不是**作用域诚实位的第二份实现 ═══════════════════════
 *
 * 归一档位（`SCOPED` / `GLOBAL` / `UNAPPLIED`）的**唯一出处**是
 * `src/lib/solverScopeHonesty.ts` 的 `readScopeHonesty()`，上屏的**唯一徽标**是
 * `src/components/ScopeHonestyBadge.tsx`。本文件一律**调用**它们，不自己判档位、不自己写档位文案。
 *
 * 那本文件为什么还要存在？因为 `solverScopeHonesty.ts` 的文件头**指名道姓地拒绝**吞下两件事，
 * 并且写明了「谁做这两个求解器的界面，必须自己把它们摆上第一层」：
 *
 *  · **`kit_readiness` 的抽样两数**（原话）：「它另带 `orderPoolTotal`/`sampled`/`samplingNote`
 *    这一组抽样诚实位：`shortageCount` 的分母是 `sampled` 不是订单池。那是**另一个命题**
 *    （「算了几张」≠「算的是谁」），本文件不吞它 —— 谁给 `kit_readiness` 做界面，那两个数必须
 *    进第一层（它们改变结论的读法），别指望这枚徽标替它说。」
 *  · **`quote_margin` 的两个维**（原话）：「它是**两个彼此独立的维**（型号维今天真生效 ·
 *    客户维恒 `NOT_APPLIED`），压进单个 `{level, note}` 必然只能说其中一维，另一维当场消失 ——
 *    而消失掉的那一维恰恰是「换个客户名 margin 不会变」这句最该上屏的话。要接它得画**两行**，
 *    不是一枚徽标。」
 *
 * 所以：**档位 = 调已并那份；抽样两数与两维 = 本文件补的那两个命题。**两者是互补，不是平行。
 *
 * ══ 收编裁决（2026-08-13 · WO-R1 从 `claude/integ-ui-w5` 捞这份文件时做的）══════
 * 本文件在 `integ-ui-w5` 上原本还有第三个导出 `RiskScopeBar`（`risk_timeline` 的诚实位行）。
 * **已整个删除**，理由是实测而非风格偏好：
 *  ① canonical 在 `e6563d1c`「求解器作用域诚实位上屏（欠账 #178）」里已并入同一命题的实现，
 *     且覆盖面**更大** —— `readScopeHonesty` 认三种后端形状、覆 5 个求解器
 *     （`capacity_forecast` / `risk_timeline` / `credit_exposure` / `capex_scenario` / `kit_readiness`）
 *     ＋ 2 个专名维（`changeover_sequence.lineScope` / `quarterly_gap.quarterScope`）；
 *     `RiskScopeBar` 只认 `risk_timeline` 一个。**留下的是超集，删掉的是子集。**
 *  ② `RiskScopeBar` 在 w5 上的唯一生产调用方是 `views/RiskBoardView.tsx:225`，
 *     而 canonical 的 `RiskBoardView.tsx` 已改挂 `<ScopeHonestyBadge payload={data} testId="risk-timeline"/>`
 *     （`:214`）。照搬 `RiskScopeBar` 到 canonical ⇒ **零生产调用方**，正是假绿第 9 形态
 *     （实现有、测试有、且是绿的，链路上没人调）。
 *  ③ 两份都留 = 同一句话在同一屏上有两套措辞与两套 DOM 契约，下次改口径必漏一处。
 *     （本仓刚踩过 `PipelineConfigPage` vs `BuildPipelinesPage`。）
 *
 * ══ 三条不许违反的规矩（逐条对着本体 §8 那几条断点写的）════════════════════════
 * ① **「没说」和「说了是全网」是两件事。** `GLOBAL` 档必须**明说是全域**，而不是什么都不显示 ——
 *    当初把它判成「静默错答」而不是「报错」，直接原因就是屏上看不出区别。
 * ② **后端没给就说没给，绝不填默认值**（R14）。整个诚实位缺席 ⇒ 显式渲「作用域未标注」，
 *    **不许**悄悄当成全网：那正好把①要治的病换个地方复发。
 * ③ **抽样必须上屏。** `orderPoolTotal 24 / sampled 8` 时 `shortageCount=8` 的正确读法是
 *    「抽样的 8 张里 8 张缺料」，不是「共 8 张缺料单」。不显示这两个数，那个数就是在误导。
 *
 * ══ 信息分层（`docs/CONVENTION-ui-information-layering.md` §1 / R-UI-3）═════════
 * 第一层只放**数值 / 状态 / 名字**；口径、公式、为什么不生效、缺哪些源，一律进 `?` 浮层
 * （复用全局唯一的 `InfoPopover`，**禁止原生 `title=`** —— 那是操作系统画的 tooltip，
 * 移开会滞留并遮挡，本仓 2026-08-10 出过事故）。
 * 诚实位允许降层，**不允许删除**：`?` 触发器本身就是第一层那个「这里有话要说」的记号。
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 回包里作用域诚实位的形状（`apps/datacore/src/solvers/extended.ts` 的 `kitScope` / `quoteScope`）。
 * 契约包今天**没有**这两个求解器的输出 schema（只有 `SOLVER_RULE_REFS` 的规则映射），
 * 故在此定义视图侧只读类型 —— 不是重定义契约已有类型（那会违反 contracts-only-shared）。
 * 每个字段都 optional：后端没给就走「未标注」分支，绝不由前端补默认值。
 * ──────────────────────────────────────────────────────────────────────────── */

/** `kit_readiness` 回包 `scope`（引擎侧变量名 `kitScope`）。 */
export interface KitScopeVM {
  mode?: "BASE" | "ALL";
  baseId?: string;
  baseName?: string;
  /** 该口径下的订单池总量（BASE = 该基地可承接的；ALL = 全网）。 */
  orderPoolTotal?: number;
  /** 全网订单总量（仅 BASE 路回传，用来说明「从多少里收窄到多少」）。 */
  networkOrderTotal?: number;
  /** 本次真正参与齐套计算的订单数（引擎固定采样上限 8）。 */
  sampled?: number;
  note?: string;
  samplingNote?: string;
  emptyNote?: string;
}

/** `quote_margin` 回包 `scope`（引擎侧变量名 `quoteScope`）。 */
export interface QuoteScopeVM {
  modelId?: string | null;
  modelDimension?: "APPLIED" | "ALL";
  modelNote?: string;
  custName?: string | null;
  /** 今天恒 `NOT_APPLIED`：客户维是**诚实标注**，不是真算。 */
  custDimension?: "NOT_APPLIED" | "APPLIED";
  custNote?: string;
  missingInputs?: { objectType: string; property: string; need: string }[];
}

const T = zh.scopeHonesty;

/** 第一层的状态记号（只放状态色，不放任何解释文字）。 */
function ScopeChip({ tone, testId, children }: { tone: "base" | "all" | "off" | "unknown"; testId: string; children: React.ReactNode }) {
  const color =
    tone === "base" ? "var(--c-capacity, #54B5C4)"
      : tone === "all" ? "var(--c-forecast, #7E8BEE)"
        : tone === "off" ? "#E8B54A"
          : "var(--muted2, #7A8797)";
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${color}`, color, fontSize: 12, lineHeight: 1.7, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** 一行诚实位的容器：左边是标题，右边是第一层记号 + `?` 浮层。 */
function ScopeRow({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", margin: "4px 0" }}
    >
      <span style={{ color: "var(--muted2)" }}>{title}</span>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① kit_readiness —— 档位走已并的单一出处；抽样两数是本文件补的那个命题
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「这份齐套算的是谁 · 算了几张单」。
 *
 * **档位这一半不自己判**：整包载荷交给 `readScopeHonesty()`，档位与口径原文都由它给，
 * 上屏用的也是全平台同一枚 `<ScopeHonestyBadge>` —— 换言之 `kit_readiness` 与
 * `risk_timeline` / `capacity_forecast` 在屏上说的是**同一句话、同一套措辞**。
 * 它返 `null`（后端整个没给诚实位）时才由本文件显式渲「未标注」（规矩②：不许当成全网）。
 *
 * **抽样两数（`orderPoolTotal` / `sampled`）在第一层**，因为它们改变 `shortageCount` 的读法 ——
 * 不是解释，是结论本身的量纲（规范 §1：结论性数字不许只藏在浮层里）。
 * 这一半是 `solverScopeHonesty.ts` 明确不吞、并点名要求「谁做界面谁摆上第一层」的那个命题。
 */
export function KitScopeBar({
  /** `kit_readiness` 成功载荷**原文**（别先 pick `scope` —— 诚实位是加性键，pick 一次就丢一次）。 */
  payload,
  shortageCount,
  testId = "kit-scope",
}: { payload: { scope?: KitScopeVM } | undefined; shortageCount: number | undefined; testId?: string }) {
  // 档位：单一出处。本文件**不**读 `scope.mode`、**不**判 BASE/ALL、**不**写档位文案。
  const honesty = readScopeHonesty(payload);
  const scope = payload?.scope;
  const pool = scope?.orderPoolTotal;
  const sampled = scope?.sampled;
  const truncated = pool !== undefined && sampled !== undefined && sampled < pool;
  return (
    <div data-testid={testId}>
      <ScopeRow title={T.title} testId={`${testId}-row`}>
        {honesty === null ? (
          // 后端整个没给诚实位 ⇒ 明说「未标注」。**不许**默认成全网（R14 / 规矩②）。
          <ScopeChip tone="unknown" testId={`${testId}-unstated`}>{T.unstated}</ScopeChip>
        ) : (
          <ScopeHonestyBadge payload={payload} testId={testId} />
        )}
        {/* 抽样两数：池量 / 实算量。任一缺席就说缺席，不拿另一个数顶。 */}
        <ScopeChip tone={truncated ? "off" : "all"} testId={`${testId}-sampling`}>
          {T.sampling(pool, sampled)}
        </ScopeChip>
        <InfoPopover topic={T.kitTopic} testId={testId}>
          <span data-testid={`${testId}-note`}>
            {/* 口径原文来自回包，前端一个字不编；后端没给就说没给。 */}
            {scope?.note ?? T.noNote}
            {scope?.networkOrderTotal !== undefined ? <><br />{T.networkTotal(scope.networkOrderTotal)}</> : null}
            {scope?.samplingNote ? <><br />{scope.samplingNote}</> : null}
            {scope?.emptyNote ? <><br />{scope.emptyNote}</> : null}
            <br />{T.whyItMatters}
          </span>
        </InfoPopover>
      </ScopeRow>
      {/* `shortageCount` 的**读法**：分母是 sampled，不是订单池，更不是「全部缺料单」。 */}
      <div data-testid={`${testId}-reading`} style={{ fontSize: 12, color: truncated ? "#E8B54A" : "var(--muted)" }}>
        {T.shortageReading(shortageCount, sampled, pool)}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ② quote_margin —— scope.custDimension / custNote / missingInputs
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「哪一维真的生效了、哪一维只是被标出来」。
 *
 * ⚠ 本条最容易做错的地方：**把「不生效」画成一个看起来算过的数，与假装它生效同样是错的。**
 * 后端门里有一条**反向**断言（换客户 `margin` 必须**不变**、但必须标 `NOT_APPLIED`），
 * 前端这一半就是把那条断言渲染出来 —— 客户名照显（它是用户说的话），但它旁边永远挂着「不生效」。
 *
 * ⚠ 这里**刻意不调** `readScopeHonesty()`：`quote_margin` 的 `scope` 没有 `mode` 键，
 * 该函数对它恒返 `null`，而且那是 `solverScopeHonesty.ts` 头注第 ⑥ 条**写明的有意为之** ——
 * 两个独立维压进单个 `{level, note}` 会让其中一维当场消失。接缝测试里有一条断言咬死这件事
 * （`readScopeHonesty(quote 载荷) === null`），防止有人日后"顺手统一"成一枚徽标。
 */
export function QuoteScopeBar({ scope, testId = "quote-scope" }: { scope: QuoteScopeVM | undefined; testId?: string }) {
  const modelDim = scope?.modelDimension;
  const custDim = scope?.custDimension;
  const missing = scope?.missingInputs ?? [];
  return (
    <div data-testid={testId}>
      <ScopeRow title={T.quoteModelTitle} testId={`${testId}-model-row`}>
        {modelDim === undefined ? (
          <ScopeChip tone="unknown" testId={`${testId}-model`}>{T.unstated}</ScopeChip>
        ) : modelDim === "APPLIED" ? (
          <ScopeChip tone="base" testId={`${testId}-model`}>{T.modelApplied(scope?.modelId ?? "")}</ScopeChip>
        ) : (
          <ScopeChip tone="all" testId={`${testId}-model`}>{T.modelAll}</ScopeChip>
        )}
        <InfoPopover topic={T.quoteModelTitle} testId={`${testId}-model`}>
          <span data-testid={`${testId}-model-note`}>{scope?.modelNote ?? T.noNote}</span>
        </InfoPopover>
      </ScopeRow>

      <ScopeRow title={T.quoteCustTitle} testId={`${testId}-cust-row`}>
        {custDim === undefined ? (
          <ScopeChip tone="unknown" testId={`${testId}-cust`}>{T.unstated}</ScopeChip>
        ) : custDim === "NOT_APPLIED" ? (
          // 第一层就把「不生效」写死在脸上：枚举原文 + 人话，两者都要（原文可核、人话可懂）。
          <ScopeChip tone="off" testId={`${testId}-cust`}>{T.custNotApplied(scope?.custName ?? "")}</ScopeChip>
        ) : (
          <ScopeChip tone="base" testId={`${testId}-cust`}>{T.custApplied(scope?.custName ?? "")}</ScopeChip>
        )}
        <InfoPopover topic={T.quoteCustTitle} testId={`${testId}-cust`}>
          <span data-testid={`${testId}-cust-note`}>
            {scope?.custNote ?? T.noNote}
            {missing.length > 0 ? (
              <>
                <br />{T.missingTitle}
                {missing.map((m) => (
                  <span key={`${m.objectType}.${m.property}`} style={{ display: "block" }} data-testid={`${testId}-missing-${m.objectType}-${m.property}`}>
                    · <code>{m.objectType}.{m.property}</code> —— {m.need}
                  </span>
                ))}
              </>
            ) : null}
          </span>
        </InfoPopover>
      </ScopeRow>
    </div>
  );
}
