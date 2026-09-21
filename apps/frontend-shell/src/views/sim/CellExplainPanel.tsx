import { useQuery } from "@tanstack/react-query";
// 校形用**契约那一份 schema**（`safeParse`），故不 import 它的 type：
// 类型由 `parsed.data` 推出来，与运行期校验同一个出处 —— 两者分家正是本仓 `as` 硬转的病根。
import { SimExplainSliceSchema } from "@platform/contracts";
import { simExplainSlice } from "@/api/endpoints";
import { stateVarText } from "./stateVarLabel";
import styles from "./SandboxConsole.module.css";

/**
 * ══ 「**这一格这一拍为什么变成这样**」—— 解释切片的屏上一侧 ══
 *
 * ── 它补的是哪个洞（2026-09-21 实测，不是推测）────────────────────────────────
 * 后端 `GET /a/v1/sim/sessions/:id/explain-slice` **早就存在**，从真实推演 trace 事后收敛出
 * 因果子图。而它在前端的消费方是 **0 个**（金丝雀：同族的 `metric-series` / `node-detail`
 * 在 `views/sim` 命中 54 处，本端点 0 处）。
 * ⇒ 沙盘屏上能看见「`costPressure` 从 0 变成了 7.65」，**没有任何一条路径能问「为什么」**。
 * 推演系统最该回答的那句话，算出来了、存下来了、没人看得到。
 *
 * ── ⛔ 覆盖账本必须显示，且 `amountCoveredPct` **不许单独读**（本面板最要紧的一条）──
 * 一张 ≤20 节点的图去解释一条数千边的链，**必然残缺**。不把「丢了多少」摆在脸上，
 * 它就是又一个「看起来完整、其实是编的」。
 * 更阴的一层：分母为 0 时百分比**只能**取 100，于是
 *   · 「这一格这拍根本没动」  ⇒ 0 边 / 100%
 *   · 「这一格被完整解释了」  ⇒ N 边 / 100%
 * 两句话在回包里**逐字节相同**。所以本面板对 `targetInEdges === 0` 走**完全不同的分支**，
 * 一个百分号都不印 —— 印了就是拿「我没得算」冒充「我算全了」。
 *
 * ── 屏上的比例是「占图上这些」，不是「占全部」（诚实措辞，别改窄）────────────────
 * 每条边的百分比分母是**本图保留下来的那几条**，不是该格的全部入流 ——
 * 后者被截断了，前端**不去反推**（拿 `keptSum / (pct/100)` 倒算全量是在前端重造后端的数，
 * 正是本仓反复禁的「第二套真相源」）。两个比例各自标清楚，读者自己合得上账。
 */

export interface CellExplainPanelProps {
  sessionId: string;
  /** 被解释的那一格：对象。 */
  objectId: string;
  /** 被解释的那一格：量纲。⚠ 少了它后端直接 400 —— 一格 =（对象, 量纲）。 */
  stateVar: string;
  /** 解释哪一拍。差分面板问的是「基线 → 当前」，故传当前 tick。 */
  tick: number;
  /** 量纲裸键 → 中文名字典（后端单源）。缺省 ⇒ 显裸键，**不编名字**。 */
  stateVarNames?: Readonly<Record<string, string>>;
}

/** 后端错误信封里的原话（拿不到就把对象串出来 —— 宁可难看，也不替它编一句解释）。 */
function backendMessage(e: unknown): string {
  const env = e as { error?: { message?: string; code?: string }; status?: number } | undefined;
  return env?.error?.message ?? env?.error?.code ?? (e instanceof Error ? e.message : JSON.stringify(e));
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1000 ? n.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) : n.toPrecision(4).replace(/\.?0+$/, "");

export function CellExplainPanel({ sessionId, objectId, stateVar, tick, stateVarNames }: CellExplainPanelProps) {
  const q = useQuery({
    // 四样全进 key：少一样就会在换格/换拍之后命中旧缓存 ⇒ 屏上拿上一格的因果答这一格（静默错答）。
    queryKey: ["sim-explain-slice", sessionId, objectId, stateVar, tick],
    retry: false,
    queryFn: async () => {
      const raw = await simExplainSlice(sessionId, objectId, stateVar, tick);
      const parsed = SimExplainSliceSchema.safeParse(raw);
      if (!parsed.success) {
        throw {
          error: {
            code: "EXPLAIN_SLICE_SHAPE_MISMATCH",
            message:
              `解释切片回包不符合契约形状（${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("；")}）` +
              ` —— 本面板不猜它想说什么。`,
          },
        };
      }
      return parsed.data;
    },
  });

  const label = stateVarText(stateVar, stateVarNames);

  if (q.isLoading) {
    return (
      <p className={styles.stateLine} data-testid="cell-explain-loading">
        正在取「{objectId} · {label}」这一格的因果链…
      </p>
    );
  }
  if (q.isError) {
    /* 404 = 该拍无贡献行。这是**真实情况**不是故障，措辞必须分开 —— 否则用户以为系统坏了。 */
    const msg = backendMessage(q.error);
    const noTrace = msg.includes("空 trace") || msg.includes("传导 trace");
    return (
      <p className={noTrace ? styles.note : styles.errBox} data-testid="cell-explain-error">
        {noTrace
          ? `第 ${tick} 拍没有任何传导贡献行 —— 这一格这一拍不是被传导改的（可能是扰动直接设定的，或它本来就没动）。`
          : `取不到这一格的因果链：${msg}`}
      </p>
    );
  }

  const s = q.data;
  /* 既不 loading 也不 error 却没有 data：react-query 的 idle/paused 态（如离线暂停）。
     ⛔ 不用 `!` 压掉 —— 那是把一个真会发生的态当成不会发生，然后在它发生时抛。 */
  if (s === undefined) {
    return (
      <p className={styles.note} data-testid="cell-explain-nodata">
        这一格的因果链还没取到（请求未发出或已暂停）。
      </p>
    );
  }
  const cov = s.coverage;

  /* ── 没有入边：**单独一条分支，一个百分号都不印**（见文件头）───────────────── */
  if (cov.targetInEdges === 0) {
    return (
      <p className={styles.noteWarn} data-testid="cell-explain-empty">
        第 {tick} 拍，<b>没有任何一条传导边写这一格</b>（入边 0 条）。
        所以这里没有因果链可讲 —— 它这一拍的值要么来自扰动直接设定，要么就是没动。
        <br />
        ⚠ 这不是「已完整解释」：覆盖率在入边为 0 时只能取 100%，两句话会长得一模一样，故本面板不印它。
      </p>
    );
  }

  /* 直接入边 = 写这一格的那些。上游再往前的边归到「更上游」。 */
  const direct = s.edges.filter((e) => e.toObjectId === objectId);
  const shownSum = direct.reduce((a, e) => a + Math.abs(e.amount), 0);
  const upstream = s.nodes.filter((n) => n.hop >= 2).sort((a, b) => b.contribution - a.contribution);

  return (
    <div className={styles.impChainPanel} data-testid="cell-explain-panel">
      {/* ── 覆盖账本：摆在最前面。⛔ 不显示它 = 拿残图冒充全图 ────────────────── */}
      <p className={cov.truncated ? styles.noteWarn : styles.note} data-testid="cell-explain-coverage">
        这一格第 {tick} 拍共有 <b data-testid="cell-explain-in-edges">{cov.targetInEdges}</b> 条入边，
        图上留了 <b>{direct.length}</b> 条，合计占该格全部入流的{" "}
        <b data-testid="cell-explain-pct">{cov.amountCoveredPct}%</b>。
        {cov.truncated
          ? `（已截断：还有 ${cov.droppedNodes} 个上游对象、${cov.droppedEdges} 条边没画出来 —— 想看全就调大节点上限。）`
          : "（未截断：这张图就是全部。）"}
      </p>

      <ul className={styles.deltaList} data-testid="cell-explain-edges">
        {direct.map((e) => {
          const share = shownSum === 0 ? 0 : (Math.abs(e.amount) / shownSum) * 100;
          return (
            <li
              className={styles.whyRow}
              key={`${e.fromObjectId}|${e.ruleKey}|${e.viaLinkKey}`}
              data-testid={`cell-explain-edge-${e.ruleKey}`}
            >
              <span className={styles.deltaName} title={`${e.fromObjectId} —${e.ruleKey}→`}>
                {e.fromObjectId}
              </span>
              <span className={styles.deltaVals}>
                规则 <code>{e.ruleKey}</code>
              </span>
              <span className={styles.deltaAmt} data-dir={e.amount > 0 ? "up" : e.amount < 0 ? "down" : "flat"}>
                {e.amount > 0 ? "+" : e.amount < 0 ? "−" : ""}
                {fmt(Math.abs(e.amount))}
                {" · "}
                {share.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
      <p className={styles.stateLine} data-testid="cell-explain-share-basis">
        上面每条的百分比 = <b>占图上这几条的比例</b>，不是占该格全部入流 —— 全量那个数见上一行的覆盖率。
      </p>

      {upstream.length > 0 ? (
        <details className={styles.zoneSection} data-testid="cell-explain-upstream">
          <summary>再往上游 · {upstream.length} 个对象（第 2 跳及以上）</summary>
          <ul className={styles.deltaList}>
            {upstream.map((n) => (
              <li className={styles.whyRow} key={n.objectId}>
                <span className={styles.deltaName}>{n.objectId}</span>
                <span className={styles.deltaVals}>第 {n.hop} 跳</span>
                <span className={styles.deltaAmt}>{fmt(n.contribution)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default CellExplainPanel;
