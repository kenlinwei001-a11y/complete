import { useMemo } from "react";
import { fmt } from "./shared";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3 · 区⑤ 排产安排表（第8幕）——把 portfolio 联合分配落成**两段可视**执行排产：
 *   电芯段（供芯基地·cellBase×窗口）→ transit（跨基地在途 N 天）→ Pack段（组装基地·packBase）→ 交付日。
 *
 * 真 JOIN（R13·零杜撰）：
 *  - 电芯段/量/窗/延误 = portfolio.allocation 真输出（联合最优解·改杠杆/勾选即变）；
 *  - transit/packBase = 真 `InterBaseTransfer` 对象（键 XFER-{from}-{to}-{model}·transitDays 真值·
 *    从 MODEL_BASE_MAP 派生的跨基地产能调剂）——按 (model==order.model && fromBase==电芯基地) 命中即分两段；
 *    无命中 = 同基地电芯+Pack（诚实单段·非伪造跨基地）。
 *  - 换型停机小时：跨基地段显式标（派生·镜像后端 crossBaseChangeoverMin 口径），同基地 0；
 *    计划级总换型读 scenario.objectiveValues.changeover 真值（脚注）。
 *  - 交付日 = forecastStart + 电芯窗起 + 窗天(+ transit) → ISO（确定性·无时钟随机）。
 */

export interface Alloc {
  item: string; kind: string; committed: boolean; base: string; baseName: string;
  window: number; windowStartDay?: number; qty: number; model?: string; delayDays: number; onTime: boolean;
}
export interface Transfer { transferId: string; fromBase: string; toBase: string; model: string; transitDays: number; status?: string }

/** 跨基地换型停机（小时·派生）：镜像后端 portfolio crossBaseChangeoverMin=60min 口径 → 1.0h。时间常数非业务实体。 */
const CROSS_BASE_CHANGEOVER_H = 1.0; // debattery-allow：换型工时常数（非基地/型号名·镜像后端系数）

function isoAddDays(startIso: string, days: number): string {
  const t = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return "—";
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

interface SchedRow {
  item: string; model: string; qty: number;
  cellBase: string; cellWindow: number;
  transitDays: number; packBase: string; crossBase: boolean;
  changeoverHours: number; deliverDay: string; status: string; onTime: boolean;
}

export function ScheduleTable({
  allocation, transfers, windowDays, forecastStart, baseNameById,
}: {
  allocation: Alloc[];
  transfers: Transfer[];
  windowDays: number;
  forecastStart: string;
  baseNameById: Map<string, string>;
  /** 计划级真换型（scenario.objectiveValues.changeover·分钟单位·脚注真值·非按行拆） */
}) {
  const rows = useMemo<SchedRow[]>(() => {
    // 只排真订单项（WIP 是背景承诺·预测非可排产订单）→ 两段排产表聚焦销售订单执行。
    const orders = allocation.filter((a) => a.kind === "order");
    // 按 (model, fromBase=电芯基地) 索引真调拨。
    const xferByKey = new Map<string, Transfer>();
    for (const t of transfers) xferByKey.set(`${t.model}|${t.fromBase}`, t);
    return orders
      .map((a) => {
        const model = a.model ?? "—";
        const t = xferByKey.get(`${model}|${a.base}`);
        const windowStartDay = a.windowStartDay ?? a.window * windowDays;
        const crossBase = !!t && t.toBase !== a.base;
        const packBase = crossBase ? (baseNameById.get(t!.toBase) ?? t!.toBase) : a.baseName;
        const transitDays = crossBase ? t!.transitDays : 0;
        const deliverDayNum = windowStartDay + windowDays + transitDays;
        return {
          item: a.item, model, qty: a.qty,
          cellBase: a.baseName, cellWindow: a.window,
          transitDays, packBase, crossBase,
          changeoverHours: crossBase ? CROSS_BASE_CHANGEOVER_H : 0,
          deliverDay: isoAddDays(forecastStart, deliverDayNum),
          status: a.onTime ? "按期" : `延误 ${fmt(a.delayDays, 0)} 天`,
          onTime: a.onTime,
        };
      })
      .sort((x, y) => x.item.localeCompare(y.item));
  }, [allocation, transfers, windowDays, forecastStart, baseNameById]);

  const crossCount = rows.filter((r) => r.crossBase).length;

  return (
    <div className={styles.glass} data-testid="global-sim-schedule">
      <span className={styles.grpLabel}>[ 排产安排表 · 电芯段 → 在途 → Pack段（每单展开·异地明示·换型停机·交付日） ]</span>
      {rows.length === 0 ? (
        <div className={styles.empty}>无可排产订单（当前联合解无订单项获排）</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className={styles.gtable} data-testid="global-sim-schedule-table">
            <thead>
              <tr>
                <th>订单</th><th>型号</th><th style={{ textAlign: "right" }}>量(套)</th>
                <th>① 电芯段（供芯基地·窗）</th><th>② 在途</th><th>③ Pack段（组装基地）</th>
                <th style={{ textAlign: "right" }}>换型停机</th><th>交付日</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item} data-testid={`global-sim-sched-${r.item}`} data-cross={String(r.crossBase)}>
                  <td className="mono">{r.item}</td>
                  <td className="mono">{r.model}</td>
                  <td className="num">{fmt(r.qty, 0)}</td>
                  <td data-testid={`global-sim-sched-cell-${r.item}`}>
                    <span className={styles.segCell}>电芯 {r.cellBase}</span> · 窗{r.cellWindow}
                  </td>
                  <td data-testid={`global-sim-sched-transit-${r.item}`}>
                    {r.crossBase
                      ? <span className={styles.segTransit} title={`跨基地在途 ${r.transitDays} 天（真 InterBaseTransfer.transitDays）`}>→ 在途 {r.transitDays} 天 →</span>
                      : <span className={styles.textMuted}>同基地（无在途）</span>}
                  </td>
                  <td data-testid={`global-sim-sched-pack-${r.item}`}>
                    <span className={styles.segPack}>Pack {r.packBase}</span>
                    {r.crossBase && <span className={styles.xbadge} title="电芯与 Pack 异地·跨基地执行">异地</span>}
                  </td>
                  <td className="num" data-testid={`global-sim-sched-chg-${r.item}`} title={r.crossBase ? "跨基地换型停机（派生·镜像后端换型系数）" : "同基地·无跨基地换型"}>
                    {r.changeoverHours > 0 ? `${r.changeoverHours.toFixed(1)} 小时` : "0"}
                  </td>
                  <td className="mono" data-testid={`global-sim-sched-deliver-${r.item}`}>{r.deliverDay}</td>
                  <td className={r.onTime ? styles.ok : styles.bad}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.summary}>
        {rows.length} 单排产 · 其中 <b className={styles.textPrimary}>{crossCount}</b> 单跨基地（电芯↔Pack 异地·真 InterBaseTransfer 调拨在途）·
        换型停机为派生工时（镜像后端 crossBaseChangeoverMin 口径）·计划级总换型见右轨方案比对「换型」列（scenario 真值）。
      </div>
    </div>
  );
}
