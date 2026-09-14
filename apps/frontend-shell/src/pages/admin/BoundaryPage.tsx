import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchBoundaryImpact, fetchBoundaryVersion } from "@/api/endpoints";
import zh from "@/locales/zh";
import styles from "./BoundaryPage.module.css";

/**
 * DF.12 边界册治理面板（GenerationBoundary 单一来源可视）：
 * 把"改某条业务常数册（基地/应用细分/规划目标阈值）会波及谁"显式呈现——回答铁律0「改 X 影响什么」。
 * 只读（册是 @platform/contracts 单一来源，改值=改代码经 boundary-singlesource 门）；展示版本指纹（改值留痕）+ 影响图。
 */
export default function BoundaryPage() {
  const { data: ver } = useQuery({ queryKey: ["a", "boundary-version"], queryFn: fetchBoundaryVersion });
  const { data: imp, isLoading } = useQuery({ queryKey: ["a", "boundary-impact"], queryFn: fetchBoundaryImpact });

  if (isLoading || !imp) return <div className="empty-state" data-testid="boundary-loading">{zh.common.loading}</div>;

  // WO-UX-ONTO #6 概览条：四个数**全部由 /a/v1/boundary/impact 的回包现算**，⛔ 无一个占位数。
  // 这一页此前把「波及面」这份富数据平铺在三块长列表里，第一眼读不出规模 —— 概览条补的就是那一眼。
  //
  // 实测日期：2026-09-11（真后端 SEED_DEMO=1，非 mock）。屏上读数 3/22/10/9，
  // 且 13+3+6=22 与册版本指纹自洽。
  // 复验方式：起内存态 datacore 后 `GET /a/v1/boundary/impact`，把回包按下面四条 reduce 自己算一遍，
  // 与屏上四张卡逐数比对；不等即为本注释过期。
  const regCount = imp.impact.length;
  const memberCount = imp.impact.reduce((s, b) => s + b.members, 0);
  const consumerCount = imp.impact.reduce((s, b) => s + b.consumers.length, 0);
  const downstreamCount = imp.impact.reduce((s, b) => s + b.downstream.length, 0);

  return (
    <div data-testid="boundary-page">
      <h2>{zh.boundary.title}</h2>
      <div className="sub" style={{ color: "var(--muted2)", marginBottom: 12 }}>{zh.boundary.sub}</div>

      {/* 概览条（规律 2）：每张卡一个真数 + 一句口径。本页**只读**，故这里也只有数字没有控件。 */}
      <div className={styles.overview} data-testid="boundary-overview">
        <div className={styles.ovCard} data-testid="bd-ov-registries">
          <div className={styles.ovNum}>{regCount}</div>
          <div className={styles.ovLabel}>常数册（本）</div>
          <div className={styles.ovCaliber}>口径：受 boundary-singlesource 门管辖的册数；册是 @platform/contracts 单一来源。</div>
        </div>
        <div className={styles.ovCard} data-testid="bd-ov-members">
          <div className={styles.ovNum}>{memberCount}</div>
          <div className={styles.ovLabel}>业务常数（条）</div>
          <div className={styles.ovCaliber}>口径：各册 members 合计 —— 改任一条都要经改代码 + 过门，不是配置项。</div>
        </div>
        <div className={styles.ovCard} data-testid="bd-ov-consumers">
          <div className={styles.ovNum}>{consumerCount}</div>
          <div className={styles.ovLabel}>派生消费端（处）</div>
          <div className={styles.ovCaliber}>口径：门强制其从册派生、不内联的代码位；<b>不是</b>运行时调用次数。</div>
        </div>
        <div className={styles.ovCard} data-testid="bd-ov-downstream">
          <div className={styles.ovNum}>{downstreamCount}</div>
          <div className={styles.ovLabel}>下游受影响面（个）</div>
          <div className={styles.ovCaliber}>口径：改册会波及的对象库 / 视图 / 求解器，逐册列举于下方；即「改 X 影响什么」的答案面。</div>
        </div>
      </div>

      {/* 版本指纹（改值留痕） */}
      {ver && (
        <div className="panel" data-testid="boundary-version" style={{ marginBottom: 14 }}>
          <div className="section-title">{zh.boundary.versionTitle}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span className="badge">semver <b className="mono">{ver.semver}</b></span>
            <span className="badge" data-testid="boundary-digest">digest <b className="mono">{ver.digest}</b></span>
            {ver.registries.map((r) => (
              <span key={r.registry} className="badge" data-testid={`boundary-ver-${r.registry}`}>{r.registry}·{r.members}条 <b className="mono">{r.digest}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* 影响图：每册 → 消费端（门强制派生）+ 下游受影响面 —— 三块等价并列，故用 2 列网格而非纵向堆叠 */}
      <div className={styles.grid}>
      {imp.impact.map((b) => (
        <div key={b.registry} className="panel" data-testid={`boundary-reg-${b.registry}`}>
          <div className="section-title">{b.title}（{b.registry} · {b.members} 条）</div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{zh.boundary.consumers}</b>（{zh.boundary.consumersNote}）：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.consumers.map((c) => (
                <li key={c.surface + c.binding} data-testid={`boundary-consumer-${b.registry}`}>
                  <span className="mono">{c.surface}</span> · {c.binding} <span style={{ color: "var(--muted2)" }}>（{zh.boundary.derivesVia} {c.derivesVia}）</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: 12 }}>
            <b>{zh.boundary.downstream}</b>：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.downstream.map((d, i) => (
                <li key={i} style={{ color: "var(--muted)" }}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
      </div>

      {/* 底部元信息行 + 下钻出口（规律 3）：三个目的地**今天都已存在**（adminRegistry 里的 path），
          且都是上面「下游受影响面」里点名过的那类承载物。⛔ 未新建任何屏。

          ⚠ 数据源读的是 `GET /a/v1/boundary/impact` —— 这条**接口路径留在注释层，不上屏**：
          用户读了它做不出任何决定（`dev-jargon:check` 的判据），出处属工程师层。
          屏上只保留「这个数是什么口径」这一层：边界册影响面 · 即时值不走缓存。 */}
      <div className={styles.metaRow} data-testid="boundary-meta">
        <span>
          数据源：边界册影响面（本次读取的即时值，不走缓存）
          {ver ? ` · 册版本 ${ver.semver} · digest ${ver.digest}` : ""} · 本页只读：改册值 = 改代码，经 boundary-singlesource 门
        </span>
        <span className={styles.drillRow}>
          <Link className={styles.drill} to="/admin/synthetic" data-testid="bd-drill-synthetic">查看合成数据 →</Link>
          <Link className={styles.drill} to="/admin/solvers" data-testid="bd-drill-solvers">查看求解器 →</Link>
          <Link className={styles.drill} to="/admin/object-types" data-testid="bd-drill-object-types">查看对象/类型浏览 →</Link>
        </span>
      </div>
    </div>
  );
}
