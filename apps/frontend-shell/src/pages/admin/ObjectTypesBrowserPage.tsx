import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypeStats, fetchBusinessDomains, fetchObjectTypes, queryObjectsPaged, type ObjectTypeStat } from "@/api/endpoints";
import styles from "./ObjectTypesBrowserPage.module.css";

/**
 * WO-OT-INSTANCE-REACH · 类型表**列定义的单一来源**。
 *
 * `<thead>` 与「行内展开行」的 `colSpan` **同吃这一份** —— 以后加/减一列只改这里，两处一起动。
 * 若照抄写死 `colSpan={5}`，加列当天就错位，且错位是**纯视觉的、任何测试都咬不住**
 * （= 下一个「绿测试≠能用」）。故此处不写死，从列数现算。
 * 末列（操作列）表头无文案，保持修前 `<th />` 的呈现。
 */
const OT_COLUMNS: readonly string[] = ["类型", "属性数(源/派生·个)", "主键", "物化对象数(个)", ""];

/**
 * A4 · 对象/类型浏览器（消费 A3 14 域 + 物化计数 + 实例下钻）。闭合用户实测"找不到已发布对象类型在哪看"。
 * 列已发布类型（按 14 域分组）+ 物化对象数 → 点「看实例」→ 实例表 → 点行 → Object360/lineage。
 * R14 零业务常数：类型名/域/列全来自 API（stats + business-domains）。
 */
function InstancePanel({ typeKey, pk, onClose }: { typeKey: string; pk: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["a", "ot-instances", typeKey], queryFn: () => queryObjectsPaged(typeKey, 1, 20, {}) });
  // WO-SCHEMA-ZH：属性预览此前是裸键值对（`util=0.87`），业务专家看不出这个数字是什么。
  // 中文名取后端 PropertyDef.displayName 单一真值（前端不内联映射）；缺则诚实回落 propKey。
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const propZh = (k: string): string =>
    typesQ.data?.find((t) => t.key === typeKey)?.properties?.find((p) => p.propKey === k)?.displayName ?? k;
  const rows = q.data?.items ?? [];
  return (
    <div className="panel" style={{ margin: "8px 0" }} data-testid="ot-instance-panel">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* WO-UNIT-MEANING：徽章此前只有裸数「20」——是实例数还是页码看不出。计数无 unit 契约，就近点明"个实例"。 */}
        实例 · <code>{typeKey}</code> <span className="badge" data-testid="ot-instance-total">共 {q.data?.total ?? rows.length} 个实例</span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose} data-testid="ot-instance-close">关闭</button>
      </div>
      {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>无物化实例。</div>}
      {rows.length > 0 && (
        <table className="cmp">
          <thead><tr><th title={pk ?? "id"}>{pk ? propZh(pk) : "id"}</th><th>属性预览</th><th /></tr></thead>
          <tbody>
            {rows.map((o) => {
              const keyVal = pk && o.props[pk] != null ? String(o.props[pk]) : o.id;
              const preview = Object.entries(o.props).filter(([k]) => k !== pk).slice(0, 3).map(([k, v]) => `${propZh(k)}=${String(v)}`).join(" · ");
              return (
                <tr key={o.id} data-testid={`ot-inst-${o.id}`}>
                  <td><Link to={`/o/${encodeURIComponent(o.type)}/${encodeURIComponent(keyVal)}`} data-testid={`ot-inst-link-${o.id}`}>{keyVal}</Link></td>
                  <td className="muted" style={{ fontSize: 12 }}>{preview}</td>
                  <td><Link className="btn sm" to={`/o/${encodeURIComponent(o.type)}/${encodeURIComponent(keyVal)}`}>360 →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ObjectTypesBrowserPage() {
  const statsQ = useQuery({ queryKey: ["a", "object-type-stats"], queryFn: fetchObjectTypeStats });
  const domQ = useQuery({ queryKey: ["a", "business-domains"], queryFn: fetchBusinessDomains });
  const [domainFilter, setDomainFilter] = useState("");
  const [kw, setKw] = useState("");
  const [onlyMaterialized, setOnlyMaterialized] = useState(false);
  const [selected, setSelected] = useState<ObjectTypeStat | null>(null);

  const stats = statsQ.data?.stats ?? [];
  const domains = domQ.data?.domains ?? [];
  const domLabel = (k: string) => domains.find((d) => d.key === k)?.displayName ?? k;
  const domColor = (k: string) => domains.find((d) => d.key === k)?.color ?? "#888";

  const filtered = stats.filter(
    (s) =>
      (!domainFilter || s.domain === domainFilter) &&
      (!kw || s.key.toLowerCase().includes(kw.toLowerCase()) || s.displayName.includes(kw)) &&
      (!onlyMaterialized || s.count > 0),
  );
  const byDomain = new Map<string, ObjectTypeStat[]>();
  for (const s of filtered) {
    if (!byDomain.has(s.domain)) byDomain.set(s.domain, []);
    byDomain.get(s.domain)!.push(s);
  }

  return (
    <div data-testid="object-types-page">
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>对象/类型浏览器</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
        <select data-testid="ot-domain-filter" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
          <option value="">全部域（{domains.length}）</option>
          {domains.map((d) => <option key={d.key} value={d.key}>{d.displayName}</option>)}
        </select>
        <input data-testid="ot-keyword" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索类型/键" style={{ fontSize: 12 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" data-testid="ot-only-mat" checked={onlyMaterialized} onChange={(e) => setOnlyMaterialized(e.target.checked)} />
          仅有物化
        </label>
        <span className="muted" data-testid="ot-count">{filtered.length} / {stats.length} 类型</span>
      </div>

      {stats.length === 0 && <div className="muted" style={{ fontSize: 13 }} data-testid="ot-empty">尚无已发布对象类型。先经数据构建发动机/合成建域。</div>}

      {[...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dom, rows]) => (
        <div key={dom} className="panel" style={{ marginBottom: 10 }} data-testid={`ot-domain-${dom}`}>
          <div className="section-title" style={{ borderLeft: `3px solid ${domColor(dom)}`, paddingLeft: 8 }}>
            {domLabel(dom)} <span className="badge" data-testid={`ot-domain-count-${dom}`}>{rows.length} 个类型</span>
          </div>
          {/* WO-UNIT-MEANING：「物化数」的格子是**已物化对象条数**，列头点明单位（个），避免与"属性数"混读。 */}
          <table className="cmp">
            <thead>
              <tr>
                {/* 列定义单一来源 = OT_COLUMNS（展开行的 colSpan 同源·加列不错位）。 */}
                {OT_COLUMNS.map((label, ci) => <th key={ci}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {/* WO-OT-INSTANCE-REACH · 闭断点 G-OT-INSTANCE-PANEL-OFFSCREEN：
                  实例面板**紧跟被点那一行**（`<tr><td colSpan>` 展开行），不再挂在整页最底部 ——
                  修前真后端 94 类型 / 15 域，点第 1 行时面板在 93 行之后，用户视角就是「点了没反应」。
                  该文件零 scrollIntoView / useRef / Modal（已复验），面板没有任何把自己带进视口的手段。
                  取 `<Fragment>`+colSpan 就近展开而非 Modal：本页是**浏览器**，用户要的是
                  「这一类型的实例」与邻近类型对照着看，Modal 会把表盖住、丢掉行上下文；
                  且沿用本仓既有行内展开范式（LedgerView.tsx:104 · RiskBoardView 处置表），不另造一套。 */}
              {rows.map((s) => {
                const rowOpen = selected?.key === s.key;
                const hasInstances = s.count > 0;
                const toggle = () => setSelected(rowOpen ? null : s);
                const detailId = `ot-instance-detail-${s.key}`;
                // 禁用理由**全部取自接口**（displayName + count 均来自 /a/v1/ontology/object-types/stats）：
                // 不写死任何业务常数（R14）—— 接口哪天回 count>0，这句话自动消失、按钮自动可点。
                // 修前禁用按钮一个字都不说，用户看到「能点的样子」却点不动（仓主实测的另一半）。
                const whyDisabled = `「${s.displayName}」当前物化对象数为 ${s.count} 个 —— 没有实例可下钻；经数据构建/合成建域物化后此按钮自动可用。`;
                return (
                  <Fragment key={s.key}>
                    <tr data-testid={`ot-row-${s.key}`} className={rowOpen ? styles.otRowOpen : undefined}>
                      <td><b className="zh">{s.displayName}</b> <code style={{ fontSize: 11 }}>{s.key}</code></td>
                      <td>{s.propCount}/{s.derivedCount}</td>
                      <td>{s.pk ?? "—"}</td>
                      <td data-testid={`ot-count-${s.key}`}>
                        {s.count > 0 ? <span className="badge green">{s.count}</span> : <span className="muted">0</span>}
                      </td>
                      <td>
                        <button
                          className="btn sm"
                          data-testid={`ot-instances-${s.key}`}
                          disabled={!hasInstances}
                          title={hasInstances ? undefined : whyDisabled}
                          aria-expanded={hasInstances ? rowOpen : undefined}
                          aria-controls={rowOpen ? detailId : undefined}
                          onClick={toggle}
                        >
                          {rowOpen ? "收起 ↑" : "看实例 →"}
                        </button>
                        {!hasInstances && (
                          <div className={`muted ${styles.otWhyDisabled}`} data-testid={`ot-instances-why-${s.key}`} title={whyDisabled}>
                            物化 {s.count} 个 · 无实例可下钻
                          </div>
                        )}
                      </td>
                    </tr>
                    {rowOpen && (
                      <tr data-testid={`ot-instance-detail-row-${s.key}`} className={styles.otDetailRow}>
                        <td id={detailId} colSpan={OT_COLUMNS.length}>
                          <InstancePanel typeKey={s.key} pk={s.pk} onClose={() => setSelected(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
