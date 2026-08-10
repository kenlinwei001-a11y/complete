import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isPerturbationActiveAt, type Perturbation, type PerturbationKind } from "@platform/contracts";
import { deleteSimPerturbation, fetchSimPerturbations } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { HintDot } from "./shared";
import styles from "./SimViews.module.css";

/**
 * ══ WO-SIM-PERTURB-TIMELINE · 扰动时间轴 —— 「这个世界受过哪些扰动」的答案 ══
 *
 * ── 病灶定性（铁律 0.5 三形态，先定性再动手）─────────────────────────────────
 * `fetchSimPerturbations` 是 **形态①「没接线」**，不是「接了线没数据」：
 * 交付前实测 `grep -rn 'fetchSimPerturbations(' apps/frontend-shell/src apps/frontend-shell/test
 * | grep -v api/endpoints.ts` **零命中** —— src 与 test 两侧都没有任何调用点
 * （连"只有 test 引用 = 已排练"那一档都够不上）。
 * 金丝雀（证明该检索不是工具坏了）：同一条命令把符号换成 `createSimPerturbation(`，
 * 命中 `views/sim/SandboxView.tsx:534`。
 * 所以前任 `SIM_EVENT_GAPS` 里写的「读端缺失」是**准确**的，修法是接线（本文件），不是补数据。
 *
 * ── 为什么读端必须先于事件订阅 ───────────────────────────────────────────────
 * `sim.perturbation_created` 此前登记在 `SIM_EVENT_GAPS`，理由是"没有缓存可失效"。
 * 那个理由是真的：先接事件、后接读端 = 给一个不存在的缓存发失效 = 假接线（#90/#92 同族）。
 * 本文件这条 `useQuery(["a","sim-perturbations", sessionId])` **就是那个缓存**；
 * 它落地之后，`eventInvalidation.ts` 才有资格把该事件从台账挪进 `EVENT_INVALIDATES`。
 *
 * ── 屏上每个字段的出处（"不许编造"）─────────────────────────────────────────
 * 全部来自 `GET /a/v1/sim/sessions/:id/perturbations` → `{ items: Perturbation[] }`
 * （datacore `app.ts` 的 `listPerturbations`），逐字段对应：
 *   泳道名  = `targetObjectId` + `targetStateVar`     幅度 = `magnitude` × `mode`
 *   条起点  = `startTick`                              条长度 = `durationTicks`（`null` = 永久）
 *   分类名  = `kind`                                   人话 = `label`   建单时刻 = `createdAt`
 * **后端没有的，本文件一律不画**：
 *   · 每条扰动造成的 KPI 变化量 —— 任何端点都不返回（tick 响应的 `appliedPerturbations[]`
 *     只给"哪几条仍在起作用"的 id，不给归因量）⇒ 屏上以「无归因量」诚实位明示，
 *     不留空、不造占位、不用前端算一个看着像的数（那就是第二套真相源）。
 *
 * ── 结构本身也要表达（CONVENTION §3）────────────────────────────────────────
 * 扰动是**有时序**的，所以第一层不是一张平表：
 *   ① 共享一条 tick 轴的甘特条 ⇒ 先后、时长、是否重叠一眼可见；
 *   ② 「现在」竖线（`curTick`）把已发生 / 正在发生 / 还没到分开；
 *   ③ **同一落点归入同一泳道**，泳道内按后端返回序编号 ①②③ —— 这就是"因果"：
 *      同落点同时生效的多条扰动是**叠加**关系，且 `delta`/`scale` 不可交换
 *      （`(10+2)×1.5=18 ≠ 10×1.5+2=17`），故顺序是语义不是排版。
 *      后端 `listPerturbations` 按 `startTick → 建单先后` 定序，本文件**原样保序**（R6），
 *      只做稳定分组，绝不重排。
 */

/** 契约枚举 `PerturbationKind` 的显示名（单源：施加表单与本时间轴共用，不许各写一份）。 */
export const PERTURBATION_KINDS: { key: PerturbationKind; label: string }[] = [ // hardcoded-data-allow —— 契约枚举的显示名映射，非业务数据
  { key: "demand_shift", label: "需求突变" },
  { key: "supply_disruption", label: "供应中断" },
  { key: "capacity_loss", label: "产能损失" },
  { key: "cost_shock", label: "成本冲击" },
  { key: "quality_event", label: "质量事件" },
];
const kindLabel = (k: string): string => PERTURBATION_KINDS.find((x) => x.key === k)?.label ?? k;

/**
 * 幅度的**第一层写法**：`mode` 决定读法，所以三种模式各有各的记号。
 * 只写数字（`10`）读者分不清是"加 10"、"乘 10" 还是"设成 10"——那是三个完全不同的世界。
 */
function magnitudeText(p: Pick<Perturbation, "magnitude" | "mode">): string {
  if (p.mode === "scale") return `×${p.magnitude}`;
  if (p.mode === "set") return `=${p.magnitude}`;
  return p.magnitude >= 0 ? `+${p.magnitude}` : `−${Math.abs(p.magnitude)}`;
}

type Status = "future" | "active" | "past";
/**
 * 三态判据。**"生效中"直接调契约的 `isPerturbationActiveAt`** —— 那是引擎（`propagateTick`）
 * 与路由（`POST /perturbations` 的"已在当前 tick 生效者立即施加"）共用的同一份判据。
 * 前端另写一遍 `t>=start && t<start+dur` 就是第二套真相源：契约改口径而这里不改，
 * 屏上会安静地显示成另一个世界。
 */
function statusOf(p: Perturbation, curTick: number): Status {
  if (curTick < p.startTick) return "future";
  return isPerturbationActiveAt(p, curTick) ? "active" : "past";
}
const STATUS_TEXT: Record<Status, string> = { future: "未开始", active: "生效中", past: "已结束" };

/** 一条扰动在 tick 轴上占的区间 `[startTick, end)`；`durationTicks===null` ⇒ 一直到轴的右端（永久）。 */
function spanOf(p: Perturbation, domainEnd: number): { from: number; to: number; forever: boolean } {
  const forever = p.durationTicks === null;
  const to = forever ? domainEnd + 1 : p.startTick + p.durationTicks!;
  return { from: p.startTick, to, forever };
}

export interface PerturbationTimelineProps {
  sessionId: string | null;
  /** 当前 tick（= "现在"竖线的位置，也是三态判据的 `t`）。由宿主传入，不重复请求。 */
  curTick: number;
}

export function PerturbationTimeline({ sessionId, curTick }: PerturbationTimelineProps) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null); // 第二层：展开哪一条的明细
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * ★ 本单要接的那条线。`staleTime: Infinity` 与 `sessionsQuery`/`worldQuery` 同款、且是**刻意**的：
   * 平时不背景重取，只有**事件失效**能把它标脏 ⇒ "重取发生了"本身就是"事件到达了"的证据，
   * 接缝测试据此断言副作用，而不是断言"我调了 invalidateQueries"。
   */
  const listQuery = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled: !!sessionId,
    staleTime: Infinity,
    retry: false,
  });
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);

  const onDelete = useCallback(
    async (id: string) => {
      if (!sessionId) return;
      setDeletingId(id);
      try {
        await deleteSimPerturbation(sessionId, id);
        // 删完重取权威清单（不本地splice —— 那是第二套真相源）。
        await qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId] });
        setOpenId((cur) => (cur === id ? null : cur));
        toast("扰动记录已删除（世界态**不回滚** —— 回滚走检查点/分支那条有语义的路）", "success");
      } catch (e) {
        toastError(e);
      } finally {
        setDeletingId(null);
      }
    },
    [sessionId, qc],
  );

  /**
   * 轴的定义域：`[0, domainEnd]`，取「当前 tick」与「最晚结束的扰动」的较大者，
   * 保证"现在"与所有条都在画面内。永久条按至少 1 tick 计入右端，避免空轴。
   */
  const domainEnd = useMemo(() => {
    let end = curTick;
    for (const p of items) end = Math.max(end, p.startTick + (p.durationTicks ?? 1));
    return Math.max(end, 1);
  }, [items, curTick]);
  const slots = domainEnd + 1; // tick 0..domainEnd 各占一格
  const pct = (t: number) => `${(t / slots) * 100}%`;

  /**
   * 泳道 = 落点（`targetObjectId.targetStateVar`）。**保序分组**：
   * 泳道之间按首次出现序、泳道之内按后端返回序 —— 两级都不重排（R6：`listPerturbations`
   * 已按 `startTick → 建单先后` 定序，重排会把"叠加顺序"这个语义弄丢）。
   */
  const lanes = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, Perturbation[]>();
    for (const p of items) {
      const key = `${p.targetObjectId} ${p.targetStateVar}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
        order.push(key);
      }
      bucket.push(p);
    }
    return order.map((key) => {
      const bucket = byKey.get(key)!;
      const [objectId, stateVar] = key.split(" ");
      return {
        key,
        objectId: objectId!,
        stateVar: stateVar!,
        items: bucket,
        /** 此刻同时生效的条数 ≥2 ⇒ 它们在**叠加**（顺序即语义）。 */
        activeNow: bucket.filter((p) => statusOf(p, curTick) === "active").length,
      };
    });
  }, [items, curTick]);

  const activeCount = useMemo(() => items.filter((p) => statusOf(p, curTick) === "active").length, [items, curTick]);

  /** 轴刻度：最多 ~8 个标签，避免密密麻麻（CONVENTION §1：第一层不放明细）。 */
  const axisTicks = useMemo(() => {
    const step = Math.max(1, Math.ceil(slots / 8));
    const out: number[] = [];
    for (let t = 0; t <= domainEnd; t += step) out.push(t);
    return out;
  }, [slots, domainEnd]);

  return (
    <div className={styles.ptlBox} data-testid="sandbox-perturbation-timeline">
      <div className={styles.ptlHead}>
        <span className={styles.ptlTitle}>扰动时间轴</span>
        {/* 第一层的「数值」：这个世界受过几次扰动、此刻几条在起作用。 */}
        <span className={styles.ptlCount} data-testid="ptl-summary">
          共 <b data-testid="ptl-total">{items.length}</b> 次 · 此刻生效 <b data-testid="ptl-active">{activeCount}</b> 条 · 现在 tick{" "}
          <b data-testid="ptl-now">{curTick}</b>
        </span>
        <HintDot label="扰动时间轴" testId="ptl-hint">
          <b>这张图的口径</b>
          <br />
          数据源：<code>GET /a/v1/sim/sessions/:id/perturbations</code> → <code>items[]</code>，逐字段对应 ——
          泳道名 = <code>targetObjectId</code>.<code>targetStateVar</code>；条起点 = <code>startTick</code>；
          条长度 = <code>durationTicks</code>（<code>null</code> = 永久，右端虚线不封口）；
          幅度 = <code>magnitude</code> 按 <code>mode</code> 读（<code>delta</code> 记 ±、
          <code>scale</code> 记 ×、<code>set</code> 记 =）。
          <br />
          <br />
          <b>「生效中」怎么算</b>
          <br />
          <code>t ≥ startTick ∧ (durationTicks = null ∨ t &lt; startTick + durationTicks)</code>，
          直接调契约的 <code>isPerturbationActiveAt</code> —— 与引擎 <code>propagateTick</code>、
          与路由「已在当前 tick 生效者立即施加」是**同一份判据**，前端不另写一遍。
          <br />
          <br />
          <b>顺序为什么是语义</b>
          <br />
          同落点同时生效的多条扰动是<b>叠加</b>关系，而 <code>delta</code>/<code>scale</code> 不可交换
          （<code>(10+2)×1.5 = 18 ≠ 10×1.5+2 = 17</code>）。后端按 <code>startTick</code> → 建单先后定序，
          本图原样保序、只做分组，泳道内编号 ①②③ 就是叠加顺序。
          <br />
          <br />
          <b>诚实位 · 无归因量</b>
          <br />
          <b>没有任何端点返回「某一条扰动造成了多少 KPI 变化」</b>。tick 响应的{" "}
          <code>appliedPerturbations[]</code> 只给"这一格里哪几条仍在起作用"的 id，不给归因量。
          所以本图不显示逐条影响 —— 不留空、不造占位、也不在前端自己算一个看着像的数（那是第二套真相源）。
          <br />
          <br />
          <b>删除的语义</b>
          <br />
          删的是<b>扰动记录</b>，<b>不回滚世界态</b>（回滚走检查点 / 分支那条有语义的路）。
        </HintDot>
        {/* 诚实位降到浮层了，第一层必须留一个可见记号（CONVENTION §1「静默降层等于删除」）。 */}
        <span className={styles.ptlFlag} data-testid="ptl-honesty-flag">
          无归因量
        </span>
      </div>

      {!sessionId ? (
        <div className={styles.sub} data-testid="ptl-no-session">
          尚未建立推演世界 —— 先在上方建会话，扰动才有地方可落。
        </div>
      ) : listQuery.isError ? (
        <div className={styles.sub} data-testid="ptl-error">
          扰动清单读取失败（<code>GET …/perturbations</code>）：{(listQuery.error as Error | undefined)?.message ?? "未知错误"}
          —— 这里不拿空清单冒充「没受过扰动」，两者不是一回事。
        </div>
      ) : listQuery.isPending ? (
        <div className={styles.sub} data-testid="ptl-loading">
          读取扰动清单…
        </div>
      ) : items.length === 0 ? (
        <div className={styles.sub} data-testid="ptl-empty">
          这个世界还没受过任何扰动 —— 右栏「施加扰动」做一次，这里会出现第一条。
        </div>
      ) : (
        <>
          {/* tick 轴（泳道名列宽 128px 与 .ptlLane 的 grid 第一列对齐） */}
          <div className={styles.ptlAxis} data-testid="ptl-axis">
            {axisTicks.map((t) => (
              <span key={t} className={styles.ptlAxisTick} style={{ left: pct(t + 0.5) }}>
                {t}
              </span>
            ))}
            <span className={styles.ptlNowCap} style={{ left: pct(curTick + 0.5) }} data-testid="ptl-now-cap">
              现在
            </span>
          </div>

          {lanes.map((lane) => (
            <div className={styles.ptlLane} key={lane.key} data-testid={`ptl-lane-${lane.objectId}-${lane.stateVar}`}>
              <div className={styles.ptlLaneName}>
                {/* 第一层「名字」：落点是什么。口径说明不在这里。 */}
                <b>{lane.objectId}</b>
                <span>.{lane.stateVar}</span>
                {lane.activeNow >= 2 && (
                  <div className={styles.ptlStack} data-testid={`ptl-stack-${lane.objectId}-${lane.stateVar}`}>
                    ⚠ 叠加 {lane.activeNow} 层
                  </div>
                )}
              </div>
              <div className={styles.ptlTrack}>
                {/* "现在"竖线穿过每条泳道 —— 没有它就看不出哪些已经发生、哪些还没到。 */}
                <span className={styles.ptlNow} style={{ left: pct(curTick + 0.5) }} aria-hidden="true" />
                {lane.items.map((p, i) => {
                  const st = statusOf(p, curTick);
                  const { from, to, forever } = spanOf(p, domainEnd);
                  return (
                    <div className={styles.ptlRow} key={p.id}>
                      <button
                        type="button"
                        className={`${styles.ptlBar} ${styles[st]}${forever ? ` ${styles.forever}` : ""}`}
                        style={{ left: pct(from), width: pct(Math.max(to - from, 0.6)) }}
                        data-testid={`ptl-bar-${p.id}`}
                        data-status={st}
                        aria-expanded={openId === p.id}
                        aria-label={`${kindLabel(p.kind)} ${magnitudeText(p)} ${STATUS_TEXT[st]}`}
                        onClick={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
                      >
                        {/* 泳道内序号 = 叠加顺序（后端返回序，本图不重排）。 */}
                        <span className={styles.ptlOrd}>{"①②③④⑤⑥⑦⑧⑨"[i] ?? `${i + 1}.`}</span>
                        {/* 第一层三件套：名字（分类）· 数值（幅度）· 状态。公式与口径都在 `?` 里。 */}
                        <span className={styles.ptlBarLabel}>
                          {kindLabel(p.kind)} {magnitudeText(p)} · {STATUS_TEXT[st]}
                          {forever ? " ▸" : ""}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* 第二层（一次点击）：逐字段明细 + 可操作项。第一层不放这些。 */}
              {lane.items.map((p) =>
                openId === p.id ? (
                  <div className={styles.ptlDetail} key={`${p.id}-detail`} data-testid={`ptl-detail-${p.id}`}>
                    <dl>
                      <dt>id</dt>
                      <dd data-testid={`ptl-detail-id-${p.id}`}>{p.id}</dd>
                      <dt>label</dt>
                      <dd>{p.label}</dd>
                      <dt>kind</dt>
                      <dd>{p.kind}</dd>
                    </dl>
                    <dl>
                      <dt>落点</dt>
                      <dd>
                        {p.targetObjectId}.{p.targetStateVar}
                      </dd>
                      <dt>mode / magnitude</dt>
                      <dd>
                        {p.mode} / {p.magnitude}
                      </dd>
                      <dt>startTick / duration</dt>
                      <dd data-testid={`ptl-detail-window-${p.id}`}>
                        {p.startTick} / {p.durationTicks === null ? "永久" : `${p.durationTicks} tick`}
                      </dd>
                    </dl>
                    <dl>
                      <dt>createdAt</dt>
                      <dd>{p.createdAt}</dd>
                      <dt>本条影响</dt>
                      {/* 诚实位：后端不返回逐条归因量。写明缺什么，不留空、不造占位。 */}
                      <dd data-testid={`ptl-detail-attr-${p.id}`}>无归因量（端点不返回）</dd>
                    </dl>
                    <button
                      className="btn sm"
                      data-testid={`ptl-delete-${p.id}`}
                      disabled={deletingId === p.id}
                      onClick={() => void onDelete(p.id)}
                    >
                      {deletingId === p.id ? "删除中…" : "删除记录"}
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
