import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FactoryCalendar } from "@platform/contracts";
import { fetchCalendar, fetchCalendarNetWindow, saveCalendar } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-BEFE-B · OC9 工厂日历与净生产窗口。
 *
 * 治的是三条「后端注册了、前端零调用」端点（门 `befe-seam:check` 载体②）：
 *   `GET /a/v1/calendars/:key`（app.ts:1293）· `PUT`（1297）· `GET …/net-window`（1304）—— 均 admin only。
 *
 * 为什么这条缺口要紧：求解器/排程读日历把「自然天数」折算成「净生产天数」（春节周、检修扣除）。
 * 日历配错，下游所有交期与产能推演跟着错，而在此之前**它在界面上根本改不了、也看不到**。
 *
 * 诚实位：净生产天数是**后端算的**（`netProductionDays`），本页只显示、不在前端复算 ——
 * 前端自己算一遍就会出现"屏上的数和求解器用的数不是同一个"这种最难查的偏差。
 */
const WEEKEND_MODES = ["SAT_SUN_OFF", "SUN_OFF", "NONE"] as const;
const EXC_KINDS = ["HOLIDAY", "MAINTENANCE", "EXTRA_WORKDAY"] as const;

export default function CalendarsPage() {
  const qc = useQueryClient();
  const [key, setKey] = useState("default");
  const [from, setFrom] = useState("2026-06-01");
  const [to, setTo] = useState("2026-06-30");
  const [draft, setDraft] = useState<Pick<FactoryCalendar, "weekendMode" | "exceptions"> | null>(null);

  const cal = useQuery({ queryKey: ["a", "calendar", key], queryFn: () => fetchCalendar(key) });
  const net = useQuery({
    queryKey: ["a", "calendar-net", key, from, to],
    queryFn: () => fetchCalendarNetWindow(key, from, to),
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (cal.data) setDraft({ weekendMode: cal.data.weekendMode, exceptions: cal.data.exceptions });
  }, [cal.data]);

  const saveMut = useMutation({
    mutationFn: () => saveCalendar(key, draft ?? {}),
    onSuccess: () => {
      toast("日历已保存", "success");
      void qc.invalidateQueries({ queryKey: ["a", "calendar", key] });
      // 净窗口依赖日历 ⇒ 保存后必须一起失效，否则屏上留着旧数（"改了没生效"的经典来源）。
      void qc.invalidateQueries({ queryKey: ["a", "calendar-net", key] });
    },
    onError: toastError,
  });

  const addExc = () =>
    setDraft((d) => ({ ...d!, exceptions: [...(d?.exceptions ?? []), { date: from, kind: "HOLIDAY", label: "" }] }));
  const updExc = (i: number, patch: Partial<FactoryCalendar["exceptions"][number]>) =>
    setDraft((d) => ({ ...d!, exceptions: d!.exceptions.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const delExc = (i: number) => setDraft((d) => ({ ...d!, exceptions: d!.exceptions.filter((_, j) => j !== i) }));

  return (
    <div data-testid="calendars-page">
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>工厂日历与净生产窗口（OC9）</h2>

      <section className="panel" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12 }}>
          日历键：
          <input className="inp" value={key} onChange={(e) => setKey(e.target.value)} data-testid="calendar-key" />
        </label>
        <label style={{ fontSize: 12, marginLeft: 12 }}>
          周末口径：
          <select
            className="inp"
            aria-label="周末口径"
            value={draft?.weekendMode ?? "SAT_SUN_OFF"}
            onChange={(e) => setDraft((d) => ({ ...d!, weekendMode: e.target.value as FactoryCalendar["weekendMode"] }))}
            data-testid="weekend-mode"
          >
            {WEEKEND_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="section-title">例外日（节假日 / 检修 / 调休补班）</div>
        <table className="cmp">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>说明</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(draft?.exceptions ?? []).map((e, i) => (
              <tr key={i} data-testid={`exc-${i}`}>
                <td>
                  <input className="inp" value={e.date} onChange={(ev) => updExc(i, { date: ev.target.value })} aria-label={`例外日期 ${i}`} />
                </td>
                <td>
                  <select
                    className="inp"
                    value={e.kind}
                    aria-label={`例外类型 ${i}`}
                    onChange={(ev) => updExc(i, { kind: ev.target.value as (typeof EXC_KINDS)[number] })}
                  >
                    {EXC_KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="inp" value={e.label} onChange={(ev) => updExc(i, { label: ev.target.value })} aria-label={`例外说明 ${i}`} />
                </td>
                <td>
                  <button className="btn sm" onClick={() => delExc(i)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" onClick={addExc} data-testid="add-exception">+ 添加例外日</button>
        <button
          className="btn primary sm"
          style={{ marginLeft: 8 }}
          disabled={saveMut.isPending || !draft}
          onClick={() => saveMut.mutate()}
          data-testid="save-calendar"
        >
          保存日历
        </button>
      </section>

      <section className="panel">
        <div className="section-title">净生产窗口（后端按本日历重算，前端不复算）</div>
        <label style={{ fontSize: 12 }}>
          起：
          <input className="inp" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="net-from" aria-label="窗口起" />
        </label>
        <label style={{ fontSize: 12, marginLeft: 8 }}>
          止：
          <input className="inp" value={to} onChange={(e) => setTo(e.target.value)} data-testid="net-to" aria-label="窗口止" />
        </label>
        {net.isError ? (
          <div className="muted" style={{ fontSize: 12 }} data-testid="net-error">净窗口读取失败</div>
        ) : net.data ? (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            净生产天数：<strong className="mono" data-testid="net-days">{net.data.netProductionDays}</strong>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
              （{net.data.from} → {net.data.to}）
            </span>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>…</div>
        )}
      </section>
    </div>
  );
}
