import { Fragment, useState } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { fetchNeighbors, fetchObjectByKey, fetchObjectTypes, queryObjectsPaged } from "@/api/endpoints";
import { Provenance } from "@/components/Provenance";
import { useSessionStore } from "@/store/sessionStore";
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

  const { data, isLoading } = useQuery({
    queryKey: ["a", "objects", { type: objectType, page, filters }],
    queryFn: () => queryObjectsPaged(objectType, page, PAGE_SIZE, filters),
    placeholderData: keepPreviousData,
  });

  /**
   * WO-ORDER-WORKORDER-UI ② · 行展开里的属性名 —— **中文业务名的单一真值在后端**
   * （`PropertyDef.displayName` / `DerivedPropertyDef.displayName`，值出自
   * `synthetic/battery.ts` 的 `PROP_DISPLAY_NAMES`），前端只消费不内联映射。
   *
   * 修前这里是 `Object.entries(row.props)` 直接把 `k` 打上屏 ⇒ 一张订单展开吐 18 个英文裸键
   * （`so` / `cust` / `customerId` / `demandDelta` …）—— 那是数据库列名，不是业务专家的词。
   * 判形态：**没接线**（本文件此前一次都没请求过 `/a/v1/ontology/object-types`），
   * 不是「接了线没数据」—— 后端 17 个属性里 16 个早就带着中文名下发。
   *
   * ⚠ 两处出处都要查：普通属性在 `properties`，**派生属性在 `derivedProperties`**
   * （`Order.value` = 订单金额，恰恰是最有业务含义的那一格，只查前者会漏掉它）。
   * 查不到即**诚实回落裸键**，不臆造、不渲染空白；技术键始终留在 `title` 供工程排查。
   */
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const typeDef = typesQ.data?.find((t) => t.key === objectType);
  const propZh = (k: string): string =>
    typeDef?.properties?.find((p) => p.propKey === k)?.displayName ??
    typeDef?.derivedProperties?.find((d) => d.propKey === k)?.displayName ??
    k;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  // 服务端说 total 只是下界时，屏上必须写成「≥N」而不是「N」——
  // 否则又回到那个病：给了错的数，而看的人看不出来。
  const lowerBound = data?.totalIsLowerBound === true;

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
        <span
          className="mono"
          style={{ marginLeft: "auto", color: "var(--muted2)", fontSize: 12 }}
          data-testid="ledger-total"
          {...(lowerBound
            ? { title: "匹配行数超过服务端安全上限，这个数是已知下界而非真值；请加筛选条件收窄。" }
            : {})}
        >
          {lowerBound ? "≥" : ""}
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
                            <span style={{ color: "var(--muted2)" }} title={k} data-testid={`ledger-prop-${k}`}>
                              {propZh(k)}
                            </span>{" "}
                            <span className="mono">{formatCell(v)}</span>
                          </div>
                        ))}
                      </div>
                      {objectType === "Order" && <FulfillingWorkOrders orderId={row.id} />}
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
        <span className="mono" style={{ fontSize: 12 }}>
          {page} / {totalPages}
        </span>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          →
        </button>
      </div>
    </div>
  );
}

/** 工单上屏的四列（`propKey` 是接线名；中文名逐个从本体 `WorkOrder` 的 displayName 取）。 */
const WO_COLUMNS = ["woId", "modelId", "baseId", "status"] as const;

/**
 * WO-ORDER-WORKORDER-UI ① · 兑现本单的工单。
 *
 * ── 关系从哪来：本体的 `fulfills` 边，不是 `WorkOrder.orderRef` 这个外键 ─────────────
 * 两者今天同源（`deriveFulfills` 就是照 orderRef 建的边），但**读法必须走边**：
 * 边是平台自己的接线，外键是实现细节；走边的这一条，换个数据源照样成立。
 *
 * ⚠ **方向必须是 `in`**：`fulfills` 声明为 `WorkOrder --fulfills--> Order`（N:1），
 * 引擎沿 `from→to` **单向**走 ⇒ 从订单出发要的是入边。写成 `out` 会得到
 * **恒空且不报错**（实测：`direction=out` 回 `{"groups":[]}`，HTTP 200）——
 * 屏上分辨不出"这单没工单"与"我方向搞反了"，本仓踩过这个坑。
 *
 * ── 属性怎么来：邻接接口只回 `{id,typeKey,objectKey,display}`，不带 props ────────────
 * 故按 `objectKey` 逐张回读 `WorkOrder` 对象取型号/基地/状态。一张订单最多 4 张工单
 * （实测 260 张工单落 186 张订单：1 张×123 · 2 张×54 · 3 张×7 · 4 张×2），
 * 且只在**行展开时**才发请求 —— 不是每页 50 行都打。
 *
 * ── 诚实缺席：500 单里 314 单**本来就没有工单**（覆盖 186/500 = 37.2%）────────────
 * 这一态必须**显示出来**（`ledger-wo-none`），不许留空白、不许整块不渲染：
 * 空白读起来像"系统没查"，而事实是"查了，真没有"。
 */
function FulfillingWorkOrders({ orderId }: { orderId: string }) {
  const nb = useQuery({
    queryKey: ["a", "ledger-fulfills", orderId],
    queryFn: () => fetchNeighbors(orderId, { linkKey: "fulfills", direction: "in" }),
  });
  const group = nb.data?.groups.find((g) => g.linkKey === "fulfills" && g.direction === "in");
  const keys = (group?.items ?? []).map((i) => i.objectKey);

  // 逐张回读工单对象（≤4 张）。中文列名同样来自本体，不在前端写死。
  const woQ = useQueries({
    queries: keys.map((k) => ({
      queryKey: ["a", "workorder", k],
      queryFn: () => fetchObjectByKey("WorkOrder", k),
    })),
  });
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const woType = typesQ.data?.find((t) => t.key === "WorkOrder");
  const woZh = (k: string): string => woType?.properties?.find((p) => p.propKey === k)?.displayName ?? k;

  return (
    <div style={{ marginTop: 8 }} data-testid="ledger-wo">
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        {zh.ledger.woSection}
        {group ? <span className="badge" style={{ marginLeft: 6 }} data-testid="ledger-wo-count">{zh.ledger.woCount(group.total)}</span> : null}
      </div>
      {nb.isLoading && <div className="muted" style={{ fontSize: 12 }}>{zh.ledger.woLoading}</div>}
      {nb.isError && <div className="muted" style={{ fontSize: 12 }} data-testid="ledger-wo-error">{zh.ledger.woError}</div>}
      {!nb.isLoading && !nb.isError && keys.length === 0 && (
        <div className="muted" style={{ fontSize: 12 }} data-testid="ledger-wo-none">{zh.ledger.woNone}</div>
      )}
      {keys.length > 0 && (
        <table className="cmp">
          <thead>
            <tr>{WO_COLUMNS.map((c) => <th key={c} title={c}>{woZh(c)}</th>)}</tr>
          </thead>
          <tbody>
            {keys.map((k, i) => {
              const props = woQ[i]?.data?.data.props ?? {};
              return (
                <tr key={k} data-testid={`ledger-wo-row-${k}`}>
                  {WO_COLUMNS.map((c) => <td key={c} className={/[一-鿿]/.test(String(props[c] ?? "")) ? "zh" : ""}>{formatCell(props[c] ?? (c === "woId" ? k : undefined))}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
