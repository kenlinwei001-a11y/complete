/**
 * ══ WO-SIM-REALITY-METER · 「这次推演有多少是真业务数」的**第一层读数 + 一键对照** ══════
 *
 * ── 今天的行为是 X（开工实测，2026-09-16 真后端 SEED_DEMO=1 · 端口 14901）────────────
 * `GET /a/v1/sim/sessions` → `scope.baseSnapshotOrigin` 回的是
 * `kind=DERIVED · types=32 · objects=4425 · cells=6363 · measuredCells=450 · derivedCells=5913`，
 * 而屏上只有两处消费它：统一推演台专家条那一句「实测格 450/6363」，
 * 与这块屏 `c0828-verdict-origin` 浮层里**写死的一句 5,895 格 / 真读数 0 格**
 * —— 后者在 `WO-SIM-ORDER-REAL-FIELDS` 落地之后**已经是假话**（真读数不再是 0）。
 * 两处都**没有比例**，也没有任何办法让使用方自己看一眼「那 450 格改变了什么」。
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 *  ① 第一层常显一条**现算**读数：真业务数 N / M 格 · 占比 · 进度条 · 覆盖面；
 *  ② 一个按钮：用**同一套扰动、同样的拍数**，在一个**纯哈希占位世界**上再跑一遍，并排给差值。
 *
 * ── ⚠ 对照实验为什么是「两臂都新建」，而不是「拿屏上那次跑的结果当左臂」───────────
 * 屏上那次跑的起点是种子世界的**第 3 拍**，它身上还挂着种子扰动的在途延迟贡献；
 * 拿它当左臂，两臂的差别里就混进了「拍龄不同 / 在途贡献不同」这两项 —— 那**不是**本实验要问的。
 * 故两臂**都**从同一份 tick0 世界新建，右臂只把每一格换成哈希占位：
 * **两臂唯一的差别就是那些实测格**（铁律 1.5 判据一：「当我把 X 改成 X′，Y 必须按可预言的方式变化」）。
 * ⇒ 这两列数**不等于**上面那排 KPI，屏上把这件事直说，不让人以为它们该对上。
 *
 * ── ⚠ 差 = 0 是交付物，不是 bug ──────────────────────────────────────────────
 * 实测（2026-09-16 真后端，1 件扰动 `原材料涨价 · 铝箔 delta 20`，3 拍）：五项读数逐字节相同，
 * 差值全 0；两臂终态真正不同的只有 **466 格** = 448 格真读数自己 + 18 格
 * `Model.backlogQtyTop / backlogPriceTop / backlogHorizonDays`。
 * 结构原因（不是饱和假象）：那三个量在已发布边集里**不是任何规则的源**
 * （逐条核过：`asSource: 0`）⇒ 真读数格的因果半径就是 1 跳、3 条边、一个死胡同。
 * ⛔ 不许因为差 0 去调参数、换口径或把这块屏藏起来 —— 仓主要的正是「自己看见这件事」。
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SimSession, TickState } from "@platform/contracts";
import { api, ApiClientError } from "@/api/apiClient";
import { createSimPerturbation, createSimSession, patchSimSessionStatus, simTick, simWorld } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import { hash01 } from "../edgeActiveModel";
import type { SnapshotOrigin } from "./metricWallModel";
import { readSnapshotOrigin } from "./metricWallModel";
import { buildMoneyView, diffWorld, type OrderRow, type WorldCells } from "./console0828/console0828Model";
import {
  buildComparisonRows,
  buildPlaceholderTwin,
  buildRealityMeter,
  diffEndStates,
  readMeasuredKeys,
  twinOriginScope,
  verdictOf,
  type ArmReadings,
  type CompareRow,
  type Divergence,
} from "./realityMeter";
import styles from "./console0828/Console0828.module.css";

/**
 * 一条扰动的**提交载荷**。
 *
 * ⚠ 形状**逐字段等于** `createSimPerturbation` 的入参（不是另编一个近似的）——
 * 它由 `Console0828` 的**同一个构造函数**产出，「开始推演」与本对照臂共用那一份
 * ⇒ 验收判据③「两臂扰动逐字段相同」是**结构保证**，不靠人比对。
 */
export type PerturbBody = Parameters<typeof createSimPerturbation>[1];

/** 屏上这次对照要复刻的那一次推演：**同一套扰动 + 同样的拍数**。 */
export interface ReplaySpec {
  readonly payloads: readonly PerturbBody[];
  readonly ticks: number;
}

const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;
const int = (x: number): string => x.toLocaleString("zh-CN");
const num2 = (x: number): string => x.toFixed(2);
const fmtCell = (v: number | null, fmt: CompareRow["fmt"]): string =>
  v === null ? "—" : fmt === "money" ? int(Math.round(v)) : fmt === "int" ? int(v) : num2(v);

/** 一次写操作**没成功**，究竟是哪一种没成功（与本屏其余各处同一条纪律：三者不合并）。 */
function describeFailure(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 404) return `后端说这条会话或推演沙盘功能不在：${e.message}`;
    if (e.status === 403) return `没有权限建对照世界：${e.message}`;
    if (e.status === 409) return `后端拒绝了这一步：${e.message}`;
    return `后端回了 ${String(e.status)}：${e.message}`;
  }
  return "这一跳没走通 —— 不知道对照跑没跑成（这和「跑了但没差别」是两件事）。再点一次看看。";
}

interface ArmRun extends ArmReadings {
  readonly world: TickState;
  readonly sent: readonly PerturbBody[];
  readonly ticks: number;
  /** 这个实验世界有没有被迁到 `ENDED`（见 `runArm` 里那段「封存」）。`false` ⇒ 必须上屏警告。 */
  readonly sealed: boolean;
}

interface CompareResult {
  readonly a: ArmRun;
  readonly b: ArmRun;
  readonly rows: readonly CompareRow[];
  readonly divergence: Divergence;
  readonly verdict: string;
  /** 🐤 孪生世界与真值世界逐格不同的格数。0 ⇒ 量法坏了（见 `buildPlaceholderTwin` 头注）。 */
  readonly twinDiffering: number;
  /** 判据③ 的运行时咬合：两臂真正发出去的载荷与拍数**逐字段相同**。 */
  readonly identicalTreatment: boolean;
}

export function RealityMeterRow({
  origin,
  absence,
  varsByType,
  typeNames,
  stateVarNames,
  sessionId,
  replay,
  orders,
}: {
  readonly origin: SnapshotOrigin | null;
  readonly absence: string | null;
  readonly varsByType: ReadonlyMap<string, ReadonlySet<string>>;
  readonly typeNames: ReadonlyMap<string, string>;
  readonly stateVarNames: Readonly<Record<string, string>> | undefined;
  readonly sessionId: string | undefined;
  readonly replay: ReplaySpec | null;
  readonly orders: readonly OrderRow[];
}): JSX.Element {
  const meter = buildRealityMeter(origin, absence);
  const keys = readMeasuredKeys(origin, varsByType);
  const [result, setResult] = useState<CompareResult | null>(null);

  const runArm = async (snapshot: TickState, scope: Record<string, unknown>, spec: ReplaySpec): Promise<ArmRun> => {
    const s = await createSimSession({ baseSnapshot: snapshot, scope });
    const before = await simWorld(s.id);
    const sent: PerturbBody[] = [];
    for (const p of spec.payloads) {
      await createSimPerturbation(s.id, p);
      sent.push(p);
    }
    // ⚠ 0 拍不发 tick：后端对 n<1 会 400，而「这次推演没推拍」与「这一跳失败」是两件事。
    if (spec.ticks > 0) await simTick(s.id, spec.ticks, false);
    const after = await simWorld(s.id);
    /**
     * ── ⚠ **封存**：不封存会把这块屏切到对照世界上去（本单实测抓到的真 bug）──────────
     *
     * `POST …/sessions` 建出来的会话是 `READY`，**但 `POST …/tick` 会把它翻成 `RUNNING`**
     * （真浏览器实测 2026-09-16：跑完对照后 `GET /a/v1/sim/sessions` 三条**全是 RUNNING**）。
     * 而 `views/sim/console/useConsoleSession.ts` 的选法是「**最近一条 RUNNING**」
     * ⇒ 下一次会话清单刷新时，宿主会自动选中**刚建的纯占位臂**，
     * 于是第一层那条真实度读数当场翻成 `0 / 6,363 · 0.0%` —— 屏上一切正常，答案却换了个世界。
     * 形态（铁律 0.6 句式）：**「我用『这两个世界只是拿来算一次的』当作『它们不会被别人选中』的证据。」**
     *
     * ⇒ 读完世界就迁到 `ENDED`：`useConsoleSession` 明文把 PAUSED/ENDED 当**历史世界**排除，
     *   而 `ENDED` 又是终态（推进/施扰/回滚一律 409）⇒ 这两个实验世界既不会被选中，也不会被误写。
     * ⛔ **不改用 `scope.snapshotKind` 让它从清单里消失**：那样复审就没法用
     *   `GET /a/v1/sim/sessions` 去核右臂的 `measuredCells === 0`（验收判据②要的正是这条证据）。
     * ⚠ 封存失败**不吞**：记下来上屏（下面 `sealed`），因为它的后果正是上面那个静默换世界。
     */
    let sealed = true;
    try {
      await patchSimSessionStatus(s.id, "ENDED");
    } catch {
      sealed = false;
    }
    const deltas = diffWorld(before.state as WorldCells, after.state as WorldCells);
    // 钱与张数走**既有模型层**（`buildMoneyView`），⛔ 本文件不新写一套口径。
    // `causeOf` 只喂 `mainCause`（本块屏不显示它），故恒 `null` —— 不编一个主因。
    const money = buildMoneyView(deltas, orders, () => null);
    // 会话回包自称的出处 ⇒ 用与左臂**完全相同**的那条读法核它（验收判据②）。
    const back = readSnapshotOrigin(s.scope);
    return {
      sessionId: s.id,
      measuredCells: back?.measuredCells ?? null,
      cells: back?.cells ?? null,
      deltaCells: deltas.length,
      movedOrders: money.exposedOrders,
      exposure: money.exposure,
      deltaMagnitudeP50: money.magnitude.deltaMagnitudeP50,
      deltaMagnitudeMax: money.magnitude.max,
      world: after.state,
      sent,
      ticks: spec.ticks,
      sealed,
    };
  };

  const compareM = useMutation({
    mutationFn: async (): Promise<CompareResult> => {
      if (sessionId === undefined || replay === null) throw new Error("没有可复刻的推演");
      /**
       * 左臂的起点 = 当前世界的 **tick0 基线**（不是当前态）。
       * ⛔ 不用 `GET …/:id/world`：那是当前拍的世界态，拿它当基线两臂就都不是 tick0 了。
       * ⚠ 走 `api.a` 而不是 `fetchSimSessionBaseSnapshot`：后者是从**列表**里剥一条出来，
       *   而列表端点在 `WO-SIM-SESSIONS-PROJECTION` 之后**已经不再下发** `baseSnapshot`
       *   （本单实测：列表项上 `"baseSnapshot" in item === false`）⇒ 那条今天恒回 `null`。
       */
      const full = await api.a<SimSession>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}`);
      const real = full.baseSnapshot;
      // 🐤 拿不到基线就**当场说出来**：⛔ 不许退回一个空世界跑两臂 ——
      //    那会得到「两臂都 0 格变化、差 0」这个看着完全正常的错答。
      if (real === undefined || Object.keys(real).length === 0) {
        throw new Error("这条会话没回基线世界态（tick0）⇒ 建不出对照世界。这是取不到，不是「没有差别」。");
      }
      const twin = buildPlaceholderTwin(real, hash01);
      // 左臂 scope 原样带上**本会话自己的**出处记号 —— 它用的就是这份快照，不是另编一个说法。
      const a = await runArm(
        real,
        origin === null ? { label: "对照实验 · 含真值臂" } : { label: "对照实验 · 含真值臂", baseSnapshotOrigin: origin },
        replay,
      );
      const b = await runArm(twin.snapshot, twinOriginScope(twin, "对照实验 · 纯占位臂"), replay);
      const rows = buildComparisonRows(a, b);
      const divergence = diffEndStates(a.world, b.world);
      return {
        a,
        b,
        rows,
        divergence,
        verdict: verdictOf(rows, divergence),
        twinDiffering: twin.differingCells,
        identicalTreatment:
          a.ticks === b.ticks && JSON.stringify(a.sent) === JSON.stringify(b.sent) && a.sessionId !== b.sessionId,
      };
    },
    onSuccess: setResult,
  });

  const canRun = sessionId !== undefined && replay !== null && replay.payloads.length > 0;

  return (
    <div className={styles.meter} data-testid="c0828-reality-meter">
      <div className={styles.meterRow}>
        <span className={styles.meterKey}>真业务数</span>
        {/* ── 三个数全部现算（`baseSnapshotOrigin`）。⛔ 一个都不写死：
            每收编一个类型，这条读数自己往上走 —— 它就是进度本身。 */}
        {meter.measuredCells === null || meter.cells === null ? (
          <span className={styles.meterAbsent} data-testid="c0828-meter-absent">
            {meter.absence ?? "取不到世界态出处记号 ⇒ 不知道有多少是真业务数（这和「一格都没有」是两件事）"}
          </span>
        ) : (
          <>
            <b className={styles.meterBig} data-testid="c0828-meter-cells">
              {int(meter.measuredCells)} / {int(meter.cells)} 格
            </b>
            <span className={styles.meterPct} data-testid="c0828-meter-pct">
              {meter.share === null ? "—" : pct1(meter.share)}
            </span>
            <span className={styles.meterBar} aria-hidden data-testid="c0828-meter-bar">
              {meter.bar}
            </span>
            <span className={styles.meterDim} data-testid="c0828-meter-objects">
              覆盖 {meter.coveredObjects === null ? "—" : int(meter.coveredObjects)} /{" "}
              {meter.objects === null ? "—" : int(meter.objects)} 个对象
            </span>
            <span className={styles.meterDim} data-testid="c0828-meter-where">
              {keys.kind === "known"
                ? `实测格落在「${[...new Set(keys.pairs.map((p) => typeNames.get(p.typeKey) ?? p.typeKey))].join("、")}」的 ${keys.pairs
                    .map((p) => stateVarNames?.[p.stateVar] ?? p.stateVar)
                    .join(" / ")} 上`
                : keys.kind === "none"
                  ? "这份世界态一格实测都没有 —— 全部是结构派生的占位"
                  : `实测格落在哪几个属性上：读不出来（${keys.why}）`}
            </span>
          </>
        )}
        <InfoPopover topic="「真业务数」这三个数怎么来的" testId="c0828-reality-meter">
          三个数全部取自本会话回包的世界态出处记号（<b>每次现算，屏上不写死</b>）：总格数 = 对象 ×
          该类型被已发布传导规则触及的状态变量；实测格 = 播种时逐格探到的真读数（状态变量名恰好是该对象的一个数值属性）。
          <br />
          <b>覆盖对象数写「—」是诚实缺席</b>：{meter.coveredObjectsWhy}
          <br />
          {keys.kind === "unreadable" ? (
            <>
              <b>⚠ 实测格落点读不出来</b>：{keys.why}。这是「<b>量法坏了</b>」，不是「没有实测格」——
              两者处置相反。
              <br />
            </>
          ) : null}
          <b>右边那个按钮会做什么</b>：用<b>同一套扰动、同样的推演拍数</b>，在一个<b>纯哈希占位世界</b>上再跑一遍，
          并排给两组数与差值。两臂都是新建的世界、都从本会话第 0 拍起跑，
          <b>唯一的差别就是上面那些真业务数格</b>。
          <br />
          <b>⛔ 这两档不是「真实 vs 模拟」</b>：含真值那一档今天也有{" "}
          {meter.share === null ? "绝大部分" : pct1(1 - meter.share)} 是占位。差别是{" "}
          {meter.share === null ? "—" : pct1(meter.share)} 与 0%，不是真与假。
        </InfoPopover>
        <span className={styles.meterActs}>
          {/* ⚠ 按钮点不动时，理由摆在**第一层可见文字**里，⛔ 不塞进原生 `title=`：
              本仓已记过这笔账（「三重不可见」）—— disabled 元素上多数浏览器根本不渲染 title，
              于是「为什么点不动」写好了，用户一条路都看不到。
              且 R-UI-3 明令口径不进原生 title（棘轮 `provenance-popover-legibility` 只减不增）。
              「它会做什么」那一段在左边那个 `?` 浮层里，不在这里重复一份。 */}
          {canRun ? null : (
            <span className={styles.meterDim} data-testid="c0828-compare-why-disabled">
              先推演一次（左栏加一件扰动 → 开始推演），才有可复刻的那一套扰动
            </span>
          )}
          <button
            type="button"
            className={styles.btn}
            data-testid="c0828-compare-run"
            disabled={!canRun || compareM.isPending}
            onClick={() => compareM.mutate()}
          >
            {compareM.isPending ? "对照中…" : "跟纯占位世界对照 ▸"}
          </button>
        </span>
      </div>

      {compareM.isPending ? (
        <p className={styles.calibre} data-testid="c0828-compare-pending">
          正在建两个世界并各推 {replay === null ? "—" : String(replay.ticks)} 拍 —— 还不知道结果。
        </p>
      ) : null}
      {compareM.isError ? (
        <p className={`${styles.calibre} ${styles.warnBox}`} data-testid="c0828-compare-error">
          对照没跑成：{describeFailure(compareM.error)}
        </p>
      ) : null}

      {result === null ? null : (
        <div className={styles.compare} data-testid="c0828-compare">
          {/* 🐤 金丝雀先说话：孪生世界若与真值世界逐字节相同，下面的「差 0」就毫无意义。 */}
          {result.twinDiffering === 0 ? (
            <p className={`${styles.calibre} ${styles.warnBox}`} data-testid="c0828-compare-canary-broken">
              量法坏了：占位孪生世界与含真值世界<b>逐格相同</b>（0 格不同）⇒ 下面的差值不可读作「没有差别」。
            </p>
          ) : null}
          {result.a.sealed && result.b.sealed ? null : (
            <p className={`${styles.calibre} ${styles.warnBox}`} data-testid="c0828-compare-unsealed">
              这两个实验世界<b>没能封存</b>（迁到「已结束」那一步没走通）⇒ 它们仍是「推演中」，
              而本屏会自动选中<b>最近一条推演中的世界</b> —— 刷新之后上面那条真实度读数可能读的是对照世界，不是你的世界。
              刷新前先在专家模式里把它们结束掉。
            </p>
          )}
          <table className={styles.cmpTable}>
            <thead>
              <tr>
                <th>读数</th>
                <th>
                  含真值（
                  {result.a.measuredCells === null || result.a.cells === null || result.a.cells === 0
                    ? "—"
                    : pct1(result.a.measuredCells / result.a.cells)}
                  ）
                </th>
                <th>纯占位（0%）</th>
                <th>差值</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.key} data-testid={`c0828-cmp-${r.key}`}>
                  <td>{r.label}</td>
                  <td className={styles.cmpNum}>{fmtCell(r.a, r.fmt)}</td>
                  <td className={styles.cmpNum}>{fmtCell(r.b, r.fmt)}</td>
                  <td className={styles.cmpNum} data-diff={r.diff === null ? "nocalc" : r.diff === 0 ? "0" : "nonzero"}>
                    {r.diff === null ? "算不出来" : fmtCell(r.diff, r.fmt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.calibre} data-testid="c0828-compare-verdict">
            {result.verdict}
          </p>
          {/* 取证条：两个世界的身份与「两臂受到的待遇是否逐字段相同」——复审据此复算，不必相信本屏。 */}
          {/* ⚠ 用 `div` 不是 `p`：`InfoPopover` 内部有 `details`/`div`，塞进 `<p>` 会触发
              React 的 `validateDOMNesting` 告警（本文件同屏已有几处历史遗留，⛔ 不再新增）。 */}
          <div className={styles.calibre} data-testid="c0828-compare-provenance">
            两个世界：<code>{result.a.sessionId}</code>（实测格{" "}
            {result.a.measuredCells === null ? "—" : int(result.a.measuredCells)}）·{" "}
            <code>{result.b.sessionId}</code>（实测格{" "}
            {result.b.measuredCells === null ? "—" : int(result.b.measuredCells)}）
            {" · "}两臂各施 {result.a.sent.length} 件扰动、各推 {result.a.ticks} 拍
            {" · "}
            <span data-testid="c0828-compare-identical">
              {result.identicalTreatment ? "两臂载荷与拍数逐字段相同 ✓" : "⚠ 两臂受到的待遇不相同 —— 这次对照不成立"}
            </span>
            {" · "}占位孪生与含真值世界逐格比对：{int(result.twinDiffering)} 格不同
            <InfoPopover topic="这两列数为什么与上面那排 KPI 对不上" testId="c0828-compare-provenance">
              这两臂<b>都是新建的世界</b>，都从本会话的第 0 拍世界态起跑，再施同一套扰动、推同样的拍数。
              上面那排 KPI 是从本会话<b>当前那一拍</b>往后推的，起点带着此前扰动的在途影响。
              <br />
              两臂都新建，是为了让<b>唯一的差别就是那些实测格</b> ——
              拿屏上那次跑当左臂，差别里会混进「拍龄不同 / 在途贡献不同」，那不是这次要问的。
              <br />
              两臂终态真正不同的格：<b>{int(result.divergence.cells)}</b>
              {result.divergence.byVar.length === 0
                ? ""
                : `（落在 ${result.divergence.byVar.map((x) => `${stateVarNames?.[x.stateVar] ?? x.stateVar} ${String(x.n)} 格`).join("、")}）`}
              。
            </InfoPopover>
          </div>
        </div>
      )}
    </div>
  );
}

export default RealityMeterRow;
