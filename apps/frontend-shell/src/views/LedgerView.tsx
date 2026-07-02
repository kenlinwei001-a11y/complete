import { Fragment, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryObjectsPaged } from "@/api/endpoints";
import { Provenance } from "@/components/Provenance";
import { useSessionStore } from "@/store/sessionStore";
import { useOpenWhatIf } from "./sim/whatif";
import { useActionDraft } from "./sim/shared";
import type { ViewRendererProps } from "./registry";
import zh from "@/locales/zh";
import styles from "./LedgerView.module.css";

const PAGE_SIZE = 50;

/** 台账（renderer=ledger，PRD §7.3）：服务端分页 + 行展开下钻 + 列筛选（筛选状态进 SessionContext.filters） */
export default function LedgerView({ view }: ViewRendererProps) {
  const objectType = (view.layout?.objectType as string | undefined) ?? "Order";
  const columns = (view.layout?.columns as { key: string; label: string; filterable?: boolean }[] | undefined) ?? [
    { key: "so", label: "SO" },
    { key: "cust", label: "客户", filterable: true },
    { key: "model", label: "型号", filterable: true },
    { key: "qty", label: "数量" },
    { key: "due", label: "交期" },
    { key: "bases", label: "基地", filterable: true },
  ];

  const filters = useSessionStore((s) => s.filters);
  const setFilters = useSessionStore((s) => s.setFilters);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  // WO-BIZVIEW-DOWNSTREAM ①：台账对象下游导航（去死路）——就此对象开 what-if / 看订单全链 / 起 Action 草案。
  const navigate = useNavigate();
  const openWhatIf = useOpenWhatIf();
  const action = useActionDraft();

  const { data, isLoading } = useQuery({
    queryKey: ["a", "objects", { type: objectType, page, filters }],
    queryFn: () => queryObjectsPaged(objectType, page, PAGE_SIZE, filters),
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="panel" data-testid="ledger">
      <div className={styles.filterRow}>
        {columns
          .filter((c) => c.filterable)
          .map((c) => (
            <input
              key={c.key}
              placeholder={`${zh.ledger.filter} ${c.label}`}
              aria-label={`筛选${c.label}`}
              value={(filters[c.key] as string) ?? ""}
              onChange={(e) => {
                const next = { ...filters };
                if (e.target.value) next[c.key] = e.target.value;
                else delete next[c.key];
                setFilters(next);
                setPage(1);
              }}
            />
          ))}
        <span className="mono" style={{ marginLeft: "auto", color: "var(--muted2)", fontSize: 11 }}>
          {data?.total ?? 0} rows
        </span>
      </div>
      {isLoading ? (
        <div className="empty-state">{zh.common.loading}</div>
      ) : (
        <table className="cmp">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <Fragment key={row.id}>
                <tr
                  onClick={() => {
                    setExpanded(expanded === row.id ? null : row.id);
                    useSessionStore.getState().toggleSelectedObject({
                      objectType,
                      objectId: row.id,
                      label: String(row.props.so ?? row.props.name ?? row.id),
                    });
                  }}
                  style={{ cursor: "pointer" }}
                  data-testid={`ledger-row-${row.id}`}
                >
                  <td>{expanded === row.id ? "▾" : "▸"}</td>
                  {columns.map((c, ci) => (
                    <td key={c.key} className={/[一-鿿]/.test(String(row.props[c.key] ?? "")) ? "zh" : ""}>
                      {/* 活数据可溯：首列数据带"悬浮溯源"——溯回原始表/行/连接器（不再是无源头死数据） */}
                      {ci === 0 ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <Provenance objectType={objectType} objectId={row.id}>
                            {formatCell(row.props[c.key])}
                          </Provenance>
                        </span>
                      ) : (
                        formatCell(row.props[c.key])
                      )}
                    </td>
                  ))}
                </tr>
                {expanded === row.id && (
                  <tr>
                    <td colSpan={columns.length + 1}>
                      <div className={styles.expand} data-testid="ledger-expand">
                        {Object.entries(row.props).map(([k, v]) => (
                          <div key={k}>
                            <span style={{ color: "var(--muted2)" }}>{k}</span> <span className="mono">{formatCell(v)}</span>
                          </div>
                        ))}
                      </div>
                      {/* WO-BIZVIEW-DOWNSTREAM ①：下游导航去死路——就此对象开 what-if / 看订单全链 / 起 Action 草案（复用现成通道）。 */}
                      {objectType === "Order" && (
                        <div data-testid={`ledger-actions-${row.id}`} style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <button
                            className="btn sm"
                            data-testid={`ledger-whatif-${row.id}`}
                            onClick={() => openWhatIf({ source: "ledger", subject: String(row.props.so ?? row.id), label: `订单 ${row.props.so ?? row.id} · what-if 推演` })}
                          >
                            ▶ 就此订单开 what-if 推演
                          </button>
                          <button
                            className="btn sm"
                            data-testid={`ledger-orderchain-${row.id}`}
                            onClick={() => {
                              useSessionStore.getState().setSelectedObjects([{ objectType: "Order", objectId: row.id, label: String(row.props.so ?? row.id) }]);
                              navigate(`/v/order-chain?focus=${encodeURIComponent(String(row.props.so ?? row.id))}`);
                            }}
                          >
                            → 看订单全链
                          </button>
                          <button
                            className="btn sm"
                            data-testid={`ledger-action-${row.id}`}
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate({
                                actionTypeKey: "订单跟进",
                                payload: { objectType: "Order", objectId: row.id, so: String(row.props.so ?? row.id), reason: "台账下游跟进（就此订单起草跟进 Action）" },
                              })
                            }
                          >
                            ✎ 起 Action 草案
                          </button>
                          {action.isSuccess && <span className="badge green" data-testid={`ledger-action-ok-${row.id}`}>已起草待审批</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.pager}>
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ←
        </button>
        <span className="mono" style={{ fontSize: 11 }}>
          {page} / {totalPages}
        </span>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          →
        </button>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
