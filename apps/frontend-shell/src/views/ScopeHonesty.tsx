import type { RiskTimelineOutput } from "@platform/contracts";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";

/**
 * WO-SCOPE-HONESTY-FE · **「这次算的是谁」的唯一前端实现**
 *
 * ── 补的是哪一跳 ──────────────────────────────────────────────────────────────
 * `WO-SILENT-WRONG-ANSWER-3` 在引擎半把三个求解器的作用域诚实位算了出来、并在契约里声明
 * （不声明 zod 会 strip 掉 ⇒ 等于没加），但**前端零消费方** —— 屏上仍然看不出这一次算的是
 * 一个基地还是全网。这个文件就是那条缺失的链路：把回包里的诚实位渲染成人看得懂的一行。
 *
 * ── 三条不许违反的规矩（逐条对着本体 §8 那几条断点写的）────────────────────────
 * ① **「没说」和「说了是全网」是两件事。** `scope==="ALL"` 时必须**明说是全网**，
 *    而不是什么都不显示 —— 当初把它判成「静默错答」而不是「报错」，直接原因就是屏上看不出区别。
 * ② **后端没给就说没给，绝不填默认值**（R14）。`scope === undefined` ⇒ 显式渲「作用域未标注」，
 *    **不许**悄悄当成全网：那正好把①要治的病换了个地方复发。
 * ③ **抽样必须上屏。** `orderPoolTotal 24 / sampled 8` 时 `shortageCount=8` 的正确读法是
 *    「抽样的 8 张里 8 张缺料」，不是「共 8 张缺料单」。不显示这两个数，那个数就是在误导。
 *
 * ── 信息分层（`docs/CONVENTION-ui-information-layering.md` §1 / R-UI-3）────────
 * 第一层只放**数值 / 状态 / 名字**（基地中文名 · BASE/ALL · 池量与抽样量 · NOT_APPLIED）；
 * 口径、公式、为什么不生效、缺哪些源，一律进 `?` 浮层（复用全局唯一的 `InfoPopover`，
 * **禁止原生 `title=`** —— 那是操作系统画的 tooltip，移开会滞留并遮挡，本仓 2026-08-10 出过事故）。
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
        border: `1px solid ${color}`, color, fontSize: 11.5, lineHeight: 1.7, whiteSpace: "nowrap",
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
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)", margin: "4px 0" }}
    >
      <span style={{ color: "var(--muted2)" }}>{title}</span>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① risk_timeline —— 顶层 scope / scopeBaseId / scopeBaseName / scopeNote
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「这份风险时间线算的是谁」。
 * BASE ⇒ 第一层显**基地中文名**（`scopeBaseName`，不是 id —— id 用户不认识）；
 * ALL  ⇒ 第一层**明说是全网**；
 * 缺席 ⇒ 第一层明说**未标注**（不是全网·②）。
 */
export function RiskScopeBar({ data, testId = "risk-scope" }: { data: Pick<RiskTimelineOutput, "scope" | "scopeBaseId" | "scopeBaseName" | "scopeNote">; testId?: string }) {
  const { scope, scopeBaseId, scopeBaseName, scopeNote } = data;
  // 名字缺席时**不编**：退到 id 并当场说明「后端未回传中文名」，而不是让一个 id 冒充名字。
  const named = scope === "BASE" ? (scopeBaseName ?? scopeBaseId ?? "") : "";
  const nameIsId = scope === "BASE" && !scopeBaseName;
  return (
    <ScopeRow title={T.title} testId={testId}>
      {scope === undefined ? (
        <ScopeChip tone="unknown" testId={`${testId}-mode`}>{T.unstated}</ScopeChip>
      ) : scope === "BASE" ? (
        <ScopeChip tone="base" testId={`${testId}-mode`}>{T.baseOnly(named)}</ScopeChip>
      ) : (
        <ScopeChip tone="all" testId={`${testId}-mode`}>{T.networkWide}</ScopeChip>
      )}
      <InfoPopover topic={T.title} testId={testId}>
        <span data-testid={`${testId}-note`}>
          {/* 口径原文来自回包（`scopeNote`），前端一个字不编；后端没给就说没给。 */}
          {scopeNote ?? T.noNote}
          {scopeBaseId ? <><br />{T.baseIdLabel}：<code>{scopeBaseId}</code></> : null}
          {nameIsId ? <><br />{T.baseNameMissing}</> : null}
          <br />{T.whyItMatters}
        </span>
      </InfoPopover>
    </ScopeRow>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ② kit_readiness —— scope.mode/baseName + orderPoolTotal / sampled / samplingNote
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「这份齐套算的是谁 · 算了几张单」。
 * **抽样两数（`orderPoolTotal` / `sampled`）在第一层**，因为它们改变 `shortageCount` 的读法 ——
 * 不是解释，是结论本身的量纲（规范 §1：结论性数字不许只藏在浮层里）。
 */
export function KitScopeBar({ scope, shortageCount, testId = "kit-scope" }: { scope: KitScopeVM | undefined; shortageCount: number | undefined; testId?: string }) {
  const mode = scope?.mode;
  const named = scope?.baseName ?? scope?.baseId ?? "";
  const pool = scope?.orderPoolTotal;
  const sampled = scope?.sampled;
  const truncated = pool !== undefined && sampled !== undefined && sampled < pool;
  return (
    <div data-testid={testId}>
      <ScopeRow title={T.title} testId={`${testId}-row`}>
        {mode === undefined ? (
          <ScopeChip tone="unknown" testId={`${testId}-mode`}>{T.unstated}</ScopeChip>
        ) : mode === "BASE" ? (
          <ScopeChip tone="base" testId={`${testId}-mode`}>{T.baseOnly(named)}</ScopeChip>
        ) : (
          <ScopeChip tone="all" testId={`${testId}-mode`}>{T.networkWide}</ScopeChip>
        )}
        {/* 抽样两数：池量 / 实算量。任一缺席就说缺席，不拿另一个数顶。 */}
        <ScopeChip tone={truncated ? "off" : "all"} testId={`${testId}-sampling`}>
          {T.sampling(pool, sampled)}
        </ScopeChip>
        <InfoPopover topic={T.kitTopic} testId={testId}>
          <span data-testid={`${testId}-note`}>
            {scope?.note ?? T.noNote}
            {scope?.networkOrderTotal !== undefined ? <><br />{T.networkTotal(scope.networkOrderTotal)}</> : null}
            {scope?.samplingNote ? <><br />{scope.samplingNote}</> : null}
            {scope?.emptyNote ? <><br />{scope.emptyNote}</> : null}
            <br />{T.whyItMatters}
          </span>
        </InfoPopover>
      </ScopeRow>
      {/* `shortageCount` 的**读法**：分母是 sampled，不是订单池，更不是「全部缺料单」。 */}
      <div data-testid={`${testId}-reading`} style={{ fontSize: 11.5, color: truncated ? "#E8B54A" : "var(--muted)" }}>
        {T.shortageReading(shortageCount, sampled, pool)}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ③ quote_margin —— scope.custDimension / custNote / missingInputs
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 「哪一维真的生效了、哪一维只是被标出来」。
 *
 * ⚠ 本条最容易做错的地方：**把「不生效」画成一个看起来算过的数，与假装它生效同样是错的。**
 * 后端门里有一条**反向**断言（换客户 `margin` 必须**不变**、但必须标 `NOT_APPLIED`），
 * 前端这一半就是把那条断言渲染出来 —— 客户名照显（它是用户说的话），但它旁边永远挂着「不生效」。
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
