import { Link } from "react-router-dom";
import type { PortResult, Prov } from "./GlobalSimView";

/**
 * WO-U1-U8-SMALL · 判据 U8「看明细不换页」—— global-sim 订单明细抽屉。
 *
 * **设计裁决（先定再放）**：抽屉放**该单在屏上这版联合解里的明细**，不放全量细排试算台。三条理由：
 *  ① U8 要的是「看明细不丢现场」——用户在被挤单/固定单/台账行上想确认的是「这条单在这版方案里
 *     排成什么样 / 为什么没排上」，这些数**已经在屏上**（allocation / schedule / displaced / frozen），
 *     零新取数，且与台账、排产表**同源勾稽**——不可能同屏打架。
 *  ② 全量细排 = project-sim 整页试算台（改型号/数量/分批重算 capacity_forecast）——那是「做别的事」，
 *     判据明写「跳去另一张页做别的事（交接/切视角）不算违反」，故抽屉内保留跳页出口（gs-drawer-goto-project）。
 *  ③ 若抽屉内另跑单排试算，单排结论可能与全局联合解**矛盾**（project-sim 页自带「受全局主计划约束」
 *     警示）——同屏两个打架的数比没有数更糟（R17 同源勾稽）。
 *
 * 内容按单的身份分流（全部取自 props.d，即屏上这份 portfolio 联合解）：
 *  · 已获排 → 分配行（基地×窗×量×按期/延误）+ 两阶段排产链（电芯段→在途→Pack→交付日 ISO）；
 *  · 被挤单 → 未获排说明（量/型号/溯源）+ 怎么办（调杠杆重解 or 跳页单排试算）；
 *  · 固定单 → 产能预扣行（基地/窗/量·不进决策集）。
 * 非订单项（WIP:/FC:）在 DrillAffordance 层就不可下钻（诚实标注），不会进本抽屉。
 */

/** forecastStart + 天数 → ISO（与 ScheduleTable 同口径·确定性·无时钟随机）。 */
function isoAddDays(startIso: string, days: number): string {
  const t = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const STATUS_ZH: Record<string, string> = {
  ok: "正常",
  displaced: "被挤/延误",
  material_blocked: "物料受阻",
  split: "分批",
};

export default function GlobalSimOrderDrawer({
  orderId,
  d,
  baseNameById,
  forecastStartIso,
  snapshotVersion,
  provTitle,
  onClose,
}: {
  orderId: string;
  d: PortResult;
  baseNameById: Map<string, string>;
  forecastStartIso: string;
  snapshotVersion?: string | null;
  provTitle: (p: Prov) => string;
  onClose: () => void;
}) {
  const allocRows = d.allocation.filter((a) => a.item === orderId && a.kind === "order");
  const schedRows = (d.schedule ?? []).filter((s) => s.orderId === orderId);
  const displacedRow = d.displaced.find((x) => x.orderId === orderId);
  const frozenRow = d.frozen.find((f) => f.orderId === orderId);

  const verdict = allocRows.length
    ? `已获排 ${allocRows.length} 段`
    : displacedRow
      ? "本版方案未获排（被挤）"
      : frozenRow
        ? "固定单 · 产能预扣"
        : "屏上方案中无此单";

  return (
    <aside
      data-testid="global-sim-order-drawer"
      role="dialog"
      aria-label={`订单明细 ${orderId}`}
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 380, maxWidth: "92vw", zIndex: 60,
        background: "var(--panel-bg, #141a26)", borderLeft: "1px solid var(--line, rgba(140,160,200,.25))",
        boxShadow: "-12px 0 32px rgba(0,0,0,.35)", padding: "16px 18px", overflowY: "auto",
        fontSize: 13, color: "var(--txt)", lineHeight: 1.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <strong style={{ fontSize: 15 }}>订单明细 · <span className="mono">{orderId}</span></strong>
        <span data-testid="gs-drawer-verdict" style={{ fontSize: 12, color: "var(--accent-txt)" }}>{verdict}</span>
        <button
          type="button"
          data-testid="gs-drawer-close"
          aria-label="关闭"
          onClick={onClose}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}
        >
          ✕
        </button>
      </div>
      <div data-testid="gs-drawer-source" style={{ fontSize: 11, color: "var(--muted2, #8a94a6)", marginBottom: 12 }}>
        数据：屏上这份联合解（求解器 portfolio{snapshotVersion ? ` · 快照 ${snapshotVersion}` : ""}）——
        与本页台账/排产表同源勾稽，非另算。
      </div>

      {allocRows.length > 0 && (
        <section data-testid="gs-drawer-alloc" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>分配（基地 × 窗口）</div>
          {allocRows.map((a) => (
            <div key={`${a.base}-${a.window}`} title={provTitle(a.provenance)}>
              {a.baseName} · 窗口{a.window} · <b>{a.qty}</b> 套 ·{" "}
              <span style={{ color: a.onTime ? "var(--ok, #58c98b)" : "var(--red, #e0626c)" }}>
                {a.onTime ? "按期" : `延误 ${a.delayDays} 天`}
              </span>
            </div>
          ))}
        </section>
      )}

      {schedRows.length > 0 && (
        <section data-testid="gs-drawer-schedule" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>两阶段排产链（电芯段 → 在途 → Pack 段 → 交付）</div>
          {schedRows.map((r) => (
            <div key={r.orderId} style={{ marginBottom: 8 }} title={r.provenance ? provTitle(r.provenance) : undefined}>
              {r.batches.map((b) => `${baseNameById.get(b.cellBase) ?? b.cellBase} 窗${b.cellWindow} ×${b.qty}套`).join(" + ")}
              {" → "}在途 {r.transitDays} 天（运费 {r.freightCost}）
              {" → "}Pack {baseNameById.get(r.packBase) ?? r.packBase} 窗{r.packWindow}
              {" → "}<b data-testid={`gs-drawer-deliver-${r.orderId}`}>交付 {isoAddDays(forecastStartIso, r.deliverDay)}</b>
              <div style={{ fontSize: 11, color: "var(--muted2, #8a94a6)" }}>
                换型 {r.changeoverHours} 小时 · 状态 {STATUS_ZH[r.status] ?? r.status}
              </div>
            </div>
          ))}
        </section>
      )}

      {displacedRow && allocRows.length === 0 && (
        <section data-testid="gs-drawer-displaced" style={{ marginBottom: 14 }} title={provTitle(displacedRow.provenance)}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>未获排说明</div>
          本版方案未获排：<b>{displacedRow.qty}</b> 套 · {displacedRow.model}
          （{displacedRow.kind === "forecast" ? "预测需求" : displacedRow.kind === "wip" ? "在产工单" : "销售订单"}）。
          产能让给了更高优先级需求——可在左侧调杠杆 / 固定 / 排除后重解，或去项目推演页做单项目细排试算。
        </section>
      )}

      {frozenRow && (
        <section data-testid="gs-drawer-frozen" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>固定单 · 产能预扣（不进决策集）</div>
          {baseNameById.get(frozenRow.base) ?? frozenRow.base} · 窗口{frozenRow.window} · <b>{frozenRow.qty}</b> 套
        </section>
      )}

      <div style={{ borderTop: "1px solid var(--line, rgba(140,160,200,.2))", paddingTop: 10, marginTop: 6 }}>
        <Link
          to={`/v/project-sim?order=${encodeURIComponent(orderId)}`}
          data-testid="gs-drawer-goto-project"
          style={{ color: "var(--accent-txt)", fontSize: 12, textDecoration: "none", borderBottom: "1px dashed var(--accent)" }}
        >
          去项目推演页做单项目细排 →
        </Link>
        <div style={{ fontSize: 11, color: "var(--muted2, #8a94a6)", marginTop: 6 }}>
          跳页 = 离开本页去做单项目试算（改型号/数量/分批重算 capacity_forecast）——那是另一件事；
          看本版方案明细不用跳（判据 U8：切视角/做别的事不算违反，「想看细节被带走」才算）。
        </div>
      </div>
    </aside>
  );
}
