import type { ReactNode } from "react";
import type { DispositionLead, MissingEvidence } from "@platform/contracts";
import { Provenance } from "@/components/Provenance";
import { InfoPopover } from "@/components/InfoPopover";

/**
 * WO-DECISION-INFO-FE · 决策信息三块（影响面 / 不作为后果 / 方案代价）的**诚实渲染原语**。
 *
 * 本文件只解决一件事：把后端已经诚实标好的三种"算不出"状态，在界面上**照实说出来**——
 *   ① `MissingEvidence{status:"EMPTY", verdict, reason, missingFields, checked}` → 「未承载」块（不留空、不填 0）
 *   ② `DispositionLead{status:"EMPTY"}`                                          → 「前置期未承载」（**不是 0 天**）
 *   ③ 字段整体缺席（后端没下发该 optional 字段）                                 → 「后端本次未返回」（不是"没有影响"）
 *
 * 为什么要把这三种分开（合并即撒谎）：
 *   · EMPTY 是**一等结论**（"查过，本体没有这个承载物"），
 *   · 缺席是**未知**（"这次响应里压根没有这个字段"），
 *   · 0 是**断言**（"影响为零"）——本仓罚过多次拿 0 冒充前两者。
 *
 * ══ WO-CAPSIM-THREE-SLOTS · 本轮改了什么（仓主第二次点名同一页）════════════════
 * 仓主原话：「点击每个卡片，瀑布式展示非常多信息，没有重点，运营负责人无法一眼看到
 * 他关注的内容：问题是什么，问题的根因，建议的方案」。
 *
 * **切法不是「重要/次要」，是「两种用途在不同时刻被需要」**（仓主定的尺）：
 *   | | 决策信息 | 可信度与溯源 |
 *   |何时要| **做决定那一刻** | **怀疑这个数那一刻** |
 *   |不给会怎样| 决定做不了 | 决定照做，但**不敢信** |
 *   |篇幅| 越短越好 | **越全越好** |
 * ⇒ 第二层**不是垃圾桶，是证据库**：降下去的内容该**更全**，不是更简。
 * 逐条判据：「这句话删掉，运营今天的决定会不会变？」
 *   · 会变 ⇒ 第一层 · 不变但会被问「你凭什么」⇒ 第二层 · 都不是 ⇒ 代码注释
 *
 * ⛔ **降层 ≠ 删除**（规范 §1）：本轮一条证据都没删，`?` 触发器就是规范要的那个「可见记号」。
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 缺陷修复 · 字面 `**` 泄漏到屏上（WO-CAPSIM-THREE-SLOTS 实测）
 *
 * 后端这批文案是**按 markdown 写的**（`违约金/罚则**当前本体无承载**：…`），
 * 而前端一路当纯文本渲染 ⇒ **星号原样印在用户屏上**。
 *
 * 实测（真后端 `SEED_DEMO=1` 回包，非源码扫描）：全回包 **151 个串、318 个 `**`**，
 * 其中 `cards[].doNothing.penalty.reason` 一项就贡献 **32 个**（4 个/卡 × 8 卡）——
 * 这就是仓主在屏上数到的那 32 个星号。
 *
 * ⚠ **不是「空列表项」**：亲手核过 `penalty.checked[]` 共 **33 条、无一为空**，
 * 全回包**零个**空串/纯 `*` 项 ⇒ 「空列表渲染漏了」这个病因**未复现**，照它修会修错地方。
 *
 * 修法：把 `**x**` 还原成 `<b>x</b>`（**保住强调意图**，不是把星号删掉了事）。
 * 只认成对的 `**`，落单的星号原样留着（`Order.*` 这类字段通配符不能被吃掉）。
 * ═══════════════════════════════════════════════════════════════════════════ */
export function RichText({ children }: { children?: string }) {
  if (!children) return null;
  const parts = children.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/**
 * **诚实位记号 · 删除线**（08-28 设计稿 `docs/design/UI-sim-console-20260828.html` 页脚原文）：
 *   > 〔估〕= 推演投影，不是实测。**删除线 = 这次没算，不是 0，也不是「无变化」**。
 *
 * ⛔ 刻意**不另发明一套记号** —— 设计稿已经定了这一套，全屏统一。
 * 记号本身承载「不是 0」这个断言 ⇒ **不必每个空格子再重复一段话**
 * （那段统一说明降进浮层，一次说明服务全屏所有记号）。
 */
export function NoCalc({ children }: { children: ReactNode }) {
  return (
    <span
      data-nocalc="1"
      style={{ color: "var(--muted2)", textDecoration: "line-through", textDecorationThickness: 1 }}
    >
      {children}
    </span>
  );
}

/** 记号的**全屏统一说明**（浮层）——所有 `NoCalc` 共用这一份，不每处重写。 */
export function MarkLegend({ testId }: { testId: string }) {
  return (
    <InfoPopover topic="这些记号什么意思" testId={testId}>
      <div>
        <NoCalc>删除线</NoCalc> = <b>这次算不出来</b>，不是 0，也不是「无变化」。
      </div>
      <div style={{ marginTop: 6 }}>
        显示 0 等于断言「不赔钱 / 没影响」，而本平台<b>没有任何规则或字段支持该断言</b> ——
        所以这里刻意留空并划线，而不是填一个 0。这条纪律对全屏所有划线格子一致。
      </div>
      <div style={{ marginTop: 6, color: "var(--muted2)" }}>〔估〕= 推演投影，不是实测。</div>
    </InfoPopover>
  );
}

/**
 * 「后端本次未返回该字段」——optional 字段缺席分支的唯一出处（缺席 ≠ 没有影响 ≠ 0）。
 *
 * 分层：第一层只留**结论一句**（「X：本次响应未返回」+ 划线记号）；
 * 「可观测事实是哪个字段缺席、为什么这是未知不是 0」整段降进浮层（原文一字未删）。
 */
export function AbsentNote({ testId, field, what, hint }: { testId: string; field: string; what: string; hint?: string }) {
  return (
    <div className="empty-state" data-testid={testId} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
      <b style={{ color: "var(--muted2)" }}>
        <NoCalc>{what}</NoCalc>：本次响应未返回
      </b>
      <InfoPopover topic={`${what}为什么没有`} testId={`${testId}-why`}>
        <div>
          可观测事实：risk_timeline 响应里没有 <span className="mono">{field}</span> 字段（该字段在契约中是 optional）。
        </div>
        <div style={{ marginTop: 6 }}>
          这是<b>未知</b>，不是「没有影响」，更不是 0 —— 故此处不渲染任何数字。
        </div>
        {hint ? <div style={{ marginTop: 6, color: "var(--muted2)" }}>{hint}</div> : null}
      </InfoPopover>
    </div>
  );
}

/**
 * 「算不出」的诚实块（后端 `MissingEvidence`）。
 *
 * **第一层**：`verdict`（后端给的短结论）+ 划线记号 + `?`。⛔ 就这一行，不再多。
 * **第二层（证据库·越全越好）**：`reason` 全文 + 已核过的**全部**承载物 + 补齐清单。
 *
 * ⚠ `missingFields`（「补 `Order.latePenaltyRatePerDay` 才能点亮」）**不是运营的决策信息**，
 * 是**本体/建模负责人**的 —— 运营看了什么也做不了。本轮先把它降进第二层并**显式标明读者**；
 * 它真正该去的地方是建模台（`views/admin/` 本体面），⛔ 但那批文件另有单在动，本单不碰，
 * 只负责把它移出运营的第一层 + 在交付报告里点名它该去哪。
 */
export function MissingEvidenceNote({ testId, title, ev }: { testId: string; title: string; ev: MissingEvidence }) {
  // `verdict` 是本轮新加的短结论；旧回包（或桩）没有它时回落到 `title`，绝不留白。
  const verdict = ev.verdict?.trim() || title;
  return (
    <div data-testid={testId} style={{ fontSize: 12, lineHeight: 1.65, color: "var(--muted)" }}>
      <span className="badge" data-testid={`${testId}-badge`} style={{ marginRight: 6 }}>未承载</span>
      <b style={{ color: "var(--muted2)" }} data-testid={`${testId}-verdict`}>
        <NoCalc>{verdict}</NoCalc>
      </b>
      <InfoPopover topic="凭什么说算不出" testId={`${testId}-evidence`}>
        {/* ── 证据库 · 第 1 份：结论的完整论证（原文一字未删）───────────────── */}
        <div data-testid={`${testId}-reason`}>
          <RichText>{ev.reason}</RichText>
        </div>

        {/* ── 证据库 · 第 2 份：已逐条核过哪些承载物（证明「查过确实没有」而非「没查」）── */}
        {ev.checked.length > 0 && (
          <div style={{ marginTop: 8 }} data-testid={`${testId}-checked`}>
            <b>已逐条核过 {ev.checked.length} 处承载物</b>
            <span style={{ color: "var(--muted2)" }}>（这是"查过确实没有"的证明，不是"没查"）</span>
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {ev.checked.map((k) => (
                <li key={k} className="mono" style={{ fontSize: 12 }}>{k}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 证据库 · 第 3 份：补齐清单。⚠ 读者是**建模负责人**，不是运营 ───────── */}
        {ev.missingFields.length > 0 && (
          <div style={{ marginTop: 8 }} data-testid={`${testId}-missing`}>
            <b>要点亮这一格，需要补这些承载物</b>
            <div style={{ color: "var(--muted2)" }}>
              👤 这条是给<b>本体 / 建模负责人</b>的，不是给运营的 —— 运营今天的决定不会因为它改变。
            </div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {ev.missingFields.map((f) => (
                <li key={f} className="mono" style={{ fontSize: 12 }}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </InfoPopover>
    </div>
  );
}

/**
 * 前置期读数（R13）：OK → 溯到具体那条记录的字段值（复用既有 <Provenance>，不另造溯源范式）；
 * EMPTY → **明说取不到 + 缺哪个字段 + 日期未叠加任何假设偏移**，绝不显示「0 天」
 * （0 天是一个断言："当天就能到"，而本体并没有任何对象支持这个断言）。
 *
 * 分层：第一层留「取不到」+ 划线记号；「缺哪个字段 / 未叠加偏移 / 后端 reason」降进浮层。
 */
export function LeadTimeReading({ testId, lead, label }: { testId: string; lead: DispositionLead; label: string }) {
  if (lead.status === "OK" && lead.source && lead.days != null) {
    const s = lead.source;
    return (
      <span data-testid={testId} data-lead="OK">
        {label}
        <Provenance
          testId={`${testId}-prov`}
          src="真对象读数（R13）"
          formula={`${s.objectType}.${s.field} = ${s.value}`}
          inputs={[`${s.objectType}#${s.objectId}`]}
          note="前置期取自真对象记录，可拿此标签回仓储逐位对拍"
        >
          <b className="mono">{lead.days} 天</b>
        </Provenance>
      </span>
    );
  }
  return (
    <span data-testid={testId} data-lead="EMPTY" style={{ color: "var(--muted2)" }}>
      {label}
      <b><NoCalc>前置期取不到</NoCalc></b>
      <InfoPopover topic="前置期为什么取不到" testId={`${testId}-why`}>
        <div>
          缺 <span className="mono">{lead.missingField ?? "?"}</span> —— 本步日期按触发日给出，
          <b>未叠加任何假设前置期</b>（叠一个假设偏移等于悄悄替决策者做了个没人审过的假设）。
        </div>
        {lead.reason ? (
          <div style={{ marginTop: 6 }}><RichText>{lead.reason}</RichText></div>
        ) : null}
      </InfoPopover>
    </span>
  );
}

/** 小节容器（与 rk-det 内既有小节风格一致·不另造视觉范式）。 */
export function SubSection({ testId, title, sub, children }: { testId: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid={testId} style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--line, rgba(140,170,200,.22))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 5 }}>
        <b style={{ fontSize: 12 }}>{title}</b>
        {sub ? <span style={{ fontSize: 12, color: "var(--muted2)" }}>{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WO-CAPSIM-THREE-SLOTS · 三槽（第一层的**全部**内容）
 *
 * 仓主原话：「运营负责人无法一眼看到他关注的内容：**问题是什么，问题的根因，建议的方案**」
 * ⇒ 第一层就这三样，按这个顺序，一槽一句。其余（口径 / 公式 / 规则 key / 承载物清单 /
 * 逐条核过的过程 / 机器编号）**全部进第二层，点开才看**。
 *
 * 硬约束（写成类型，不靠自觉）：
 *  · 每槽 `line` 是**一句话**（结论 + 那个数），`evidence` 是它的证据（进浮层）。
 *  · `action` 槽**不许留白** —— 今天给不出对策就明写「今天没有对策」并说清为什么，
 *    留白会被读成「还没加载出来」。故 `action` 与其余两槽一样是必填。
 *  · ⛔ 根因不许写「多种因素共同作用」这类听着对的空话 —— 说不出就明写说不出 + 缺什么
 *    （正面范例见 datacore `decision-info.ts` 加班副作用那段：「本体无人力工时上限/疲劳度/
 *    加班额度承载物 → 说不出『加这些班会撞到什么』；**拒绝写一句听着对的空话**」）。
 * ═══════════════════════════════════════════════════════════════════════════ */
export type DecisionSlot = {
  /** 第一层那一句（结论 + 数）。 */
  line: ReactNode;
  /** 第二层证据（浮层）。**越全越好** —— 这里是证据库不是垃圾桶。 */
  evidence?: ReactNode;
  /** 该槽今天答不出（渲染成划线记号 + 明写为什么，⛔ 不留白）。 */
  unavailable?: boolean;
};

const SLOT_META = [
  { key: "problem", no: "①", label: "问题是什么" },
  { key: "cause", no: "②", label: "根因" },
  { key: "action", no: "③", label: "建议方案" },
] as const;

export function DecisionSlots({
  testId,
  problem,
  cause,
  action,
}: {
  testId: string;
  problem: DecisionSlot;
  cause: DecisionSlot;
  action: DecisionSlot;
}) {
  const slots = { problem, cause, action };
  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gap: 6,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--line, rgba(140,170,200,.22))",
        background: "var(--panel2, rgba(140,170,200,.05))",
      }}
    >
      {SLOT_META.map((m) => {
        const s = slots[m.key];
        return (
          <div
            key={m.key}
            data-testid={`${testId}-${m.key}`}
            data-unavailable={s.unavailable ? "1" : "0"}
            style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, lineHeight: 1.6 }}
          >
            <span style={{ color: "var(--muted2)", flex: "0 0 auto", fontSize: 12 }}>
              {m.no} {m.label}
            </span>
            <span style={{ flex: "1 1 auto" }}>
              {s.unavailable ? <NoCalc>{s.line}</NoCalc> : s.line}
              {s.evidence ? (
                <InfoPopover topic={`${m.label}·凭什么这么说`} testId={`${testId}-${m.key}-evidence`}>
                  {s.evidence}
                </InfoPopover>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
