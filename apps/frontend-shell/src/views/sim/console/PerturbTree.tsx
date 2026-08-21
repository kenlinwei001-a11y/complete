/**
 * WO-SIM-FE-HOME · 左栏「扰动因素」树。
 *
 * ── 版面 ────────────────────────────────────────────────────────────────────
 * 逐条照抄规格 `docs/ux-spec/sandbox/sandbox-home.html` 第 186–289 行：
 * 面板宽 304px · 两列 `1fr 84px`（因子 / 落点）· 行高 15px · 组头 15px + 2px ·
 * 组间括号式黄连线（`svg.link`）· 右下角浮出「添加扰动」上下文菜单。
 *
 * ── 数据接的是哪条线（派单硬约束②）────────────────────────────────────────
 * ① **因子目录** = 契约 `CAPACITY_FACTOR_BINDINGS`（20 条 ①–⑳，单源）。
 *    行文字 = `factorName`、圈号 = `mark`、规则闸徽标 = `ruleGate`、
 *    **是否只读**（规格 `.it.ro` 的虚线勾选框）= `writable === false` —— 一条都不是手写的。
 *    右列「落点」= `objectType` 的中文显示名（`OBJECT_TYPE_LABEL`，覆盖度由测试咬住）。
 * ② **受击态**（规格 `.it.hot` 的红字）= `GET /a/v1/sim/sessions/:id/perturbations` 回包里
 *    `targetStateVar` 命中该因子 `prop` 的行。没有 sessionId ⇒ 不发请求 ⇒ 回落规格占位。
 * ③ **上下文菜单词表** = 契约 `PerturbationKindSchema` 的 5 类（经 `PERTURBATION_KINDS` 取显示名，
 *    该表自带「单源：施加表单与本时间轴共用，不许各写一份」的批注）。
 *    点选 → `POST …/perturbations`（`createSimPerturbation`）。
 *
 * ── 诚实位：POST 这条线今天「接了线没数据」，不是「没接线」───────────────────
 * 契约 `PerturbationSchema.targetObjectId` 要的是**对象实例 id**，而因子目录只给到
 * `objectType`（类型）。本页今天没有对象选择器 ⇒ 宿主传不进 `targetObjectId` ⇒
 * `onAdd` 的 POST 分支**恒不进入**。这三种「不工作」修法完全不同（CLAUDE.md 铁律 0.5 判据 1），
 * 故此处点名：**已接线、缺数据**，补法是加一个落点实例选择器（另一张单），不是在这里补兜底。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BASE_REGISTRY,
  CAPACITY_FACTOR_BINDINGS,
  type CapacityFactorBinding,
  type PerturbationKind,
} from "@platform/contracts";
import { createSimPerturbation, fetchSimPerturbations } from "@/api/endpoints";
import { PERTURBATION_KINDS } from "../PerturbationTimeline";
import styles from "./SandboxHome.module.css";

/** 落点对象类型 → 中文显示名。`objectType` 在契约里是自由串，故覆盖度由测试逐条咬（少一个即红）。 */
const OBJECT_TYPE_LABEL: Record<string, string> = {
  Equipment: "设备",
  Process: "工序",
  Line: "产线",
  Material: "物料",
  ChangeoverMatrix: "换型",
  MaintPlan: "检修",
  Order: "订单",
};

/**
 * 分组只切「从哪到哪」，**不重排也不重命名因子** —— 顺序即 `CAPACITY_FACTOR_BINDINGS` 原序。
 * 组名是视图层的看板分组（契约的 `层1..层6` 是产能金字塔的层，不是这张扰动表的分组），
 * 故不从契约派生；但**组行数之和必须等于册长**，由测试咬住（改册漏改这里即红）。
 */
const GROUPS: readonly { title: string; count: number }[] = [ // hardcoded-data-allow —— 纯**分组版面**（每组几行），零业务数值；因子内容全部来自契约 CAPACITY_FACTOR_BINDINGS
  { title: "节拍与产出", count: 6 },
  { title: "良率与人力", count: 4 },
  { title: "产线", count: 3 },
  { title: "物料", count: 3 },
  { title: "投产", count: 1 },
  { title: "其他", count: 3 },
];

/**
 * 无扰动数据（未选世界 / 请求未回）时的**受击占位**，逐条对应规格基准图 pg1 的三行红字：
 * ③ 设备OEE · ⑥ 工序良率 · ⑬ 物料齐套。取值是契约 `CAPACITY_FACTOR_BINDINGS[].prop`，
 * 不是自由串 —— 册里改了属性名，下面的常量对不上，测试会红。
 */
const PLACEHOLDER_HOT_PROPS: readonly string[] = ["oee_current", "yield_baseline", "onHand"];
/**
 * 同上：规格里被选中的那一行（⑮ 物料到货）。
 * ⚠ **行的身份是 `num` 不是 `prop`** —— 册里 `prop` 有重复（实测 20 条只有 19 个不同的 `prop`：
 * ⑧ 利用率 与 ⑩ 瓶颈工序 都落在 `utilization`，只是对象类型不同 Process / Line）。
 * 拿 `prop` 当行 id 会**同时选中两行**、并让 `querySelector([data-factor])` 两次都命中第一行
 * （首版就是这么写的，逐像素比对当场抓到：⑧ 那行画了两条重叠的连线、⑩ 那行一条都没有）。
 */
const DEFAULT_SELECTED_PROP = "leadTime";
const DEFAULT_SELECTED_NUM = CAPACITY_FACTOR_BINDINGS.find((f) => f.prop === DEFAULT_SELECTED_PROP)?.num ?? 0;

/** 轮次页签（规格第 191 行）。第几轮推演是纯 UI 态，今天没有承载物。 */
const ROUNDS = ["第一轮次", "第二轮次", "第三轮次", "第四轮次"] as const;

/** 范围下拉：**从基地册派生**（`BASE_REGISTRY`，13 条），末位补「全网」。规格里那 4 条是占位。 */
const SCOPES: readonly string[] = [...BASE_REGISTRY.map((b) => `${b.name}基地`), "全网"];

/** 把 20 条因子按 `GROUPS` 切段（不重排）。 */
function groupedFactors(): { title: string; rows: CapacityFactorBinding[] }[] {
  const out: { title: string; rows: CapacityFactorBinding[] }[] = [];
  let at = 0;
  for (const g of GROUPS) {
    out.push({ title: g.title, rows: CAPACITY_FACTOR_BINDINGS.slice(at, at + g.count) });
    at += g.count;
  }
  return out;
}

export interface PerturbTreeProps {
  /** 沙盘世界 id。不给 ⇒ 不发任何请求（受击态回落规格占位）。 */
  sessionId?: string;
  /**
   * 施加扰动的落点**对象实例 id**。契约要的是实例，因子目录只给类型 ⇒ 今天没有它，
   * 上下文菜单的 POST 分支不进入（见文件头「诚实位」）。
   */
  targetObjectId?: string;
}

export function PerturbTree({ sessionId, targetObjectId }: PerturbTreeProps): JSX.Element {
  const qc = useQueryClient();
  const groups = useMemo(groupedFactors, []);
  const [selectedNum, setSelectedNum] = useState<number>(DEFAULT_SELECTED_NUM);

  const listQuery = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled: sessionId !== undefined && sessionId !== "",
    staleTime: Infinity,
    retry: false,
  });

  /**
   * 受击 = 世界里真有一条扰动打在这个因子的落点属性上。没回包 ⇒ 规格占位。
   * ⚠ 这里按 `targetStateVar` 匹配，而扰动契约只给到「哪个对象的哪个状态变量」——
   * 故 `utilization` 上的一条扰动会把 ⑧ 与 ⑩ **同时**点亮。这是**据实的过近似**，
   * 不是 bug：要区分得先能把 `targetObjectId` 解析回 objectType，那是落点选择器那张单的事。
   */
  const hotProps = useMemo(
    () =>
      listQuery.data === undefined
        ? new Set(PLACEHOLDER_HOT_PROPS)
        : new Set(listQuery.data.items.map((p) => p.targetStateVar)),
    [listQuery.data],
  );
  const hotSource: "endpoint" | "placeholder" = listQuery.data === undefined ? "placeholder" : "endpoint";

  const onAdd = useCallback(
    (kind: PerturbationKind) => {
      const factor = CAPACITY_FACTOR_BINDINGS.find((f) => f.num === selectedNum);
      // 三个前置缺一不可；缺了就**什么都不做**，不去编一个 objectId 顶上（那是造假数据）。
      if (sessionId === undefined || targetObjectId === undefined || factor === undefined) return;
      void createSimPerturbation(sessionId, {
        kind,
        targetObjectId,
        targetStateVar: factor.prop,
        magnitude: 0,
        label: `${factor.mark} ${factor.factorName}`,
      }).then(() => qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId] }));
    },
    [qc, selectedNum, sessionId, targetObjectId],
  );

  // ── 组间括号式黄连线：与规格同一套算法（量 DOM 而不是猜版面），jsdom 无布局 ⇒ 自然为空 ──
  const gridRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<{ d: string; key: string }[]>([]);
  const [linkBox, setLinkBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const r0 = grid.getBoundingClientRect();
    if (r0.width === 0 && r0.height === 0) return; // 无布局环境（jsdom）：不画，也不报错
    const next: { d: string; key: string }[] = [];
    for (const f of CAPACITY_FACTOR_BINDINGS) {
      const a = grid.querySelector(`[data-factor="${f.num}"]`);
      const b = grid.querySelector(`[data-drop="${f.num}"]`);
      if (a === null || b === null) continue;
      const A = a.getBoundingClientRect();
      const B = b.getBoundingClientRect();
      const x1 = A.right - r0.left + 2;
      const y1 = A.top - r0.top + A.height / 2;
      const x2 = B.left - r0.left - 2;
      const y2 = B.top - r0.top + B.height / 2;
      const mx = x1 + (x2 - x1) * 0.42;
      next.push({ key: String(f.num), d: `M${x1} ${y1} H${mx} V${y2} H${x2}` });
    }
    setLinkBox({ w: r0.width, h: r0.height });
    setLinks(next);
  }, [groups]);

  return (
    <section className={`${styles.pan} ${styles.left}`} data-testid="sandbox-home-left">
      <div className={styles.ph}>
        <i>▤</i>
        <b>扰动因素</b>
        <span className={styles.rt}>▤ ⤢</span>
      </div>
      <div className={`${styles.pb} ${styles.pbScroll}`}>
        <div className={styles.sel}>
          <select defaultValue={SCOPES[0]} data-testid="sandbox-home-scope">
            {SCOPES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className={styles.wv}>
          {ROUNDS.map((r, i) => (
            <b key={r} className={i === 0 ? styles.on : undefined}>
              {r}
            </b>
          ))}
          <span className={styles.nav}>
            <u>‹</u>
            <u>›</u>
          </span>
        </div>

        <div className={styles.grid2} ref={gridRef} data-hot-source={hotSource}>
          <svg className={styles.link} width={linkBox.w} height={linkBox.h} aria-hidden>
            {links.map((l) => (
              <path key={l.key} d={l.d} fill="none" strokeWidth={1} opacity={0.34} style={{ stroke: "var(--warn)" }} />
            ))}
          </svg>

          {/* 左列：因子 */}
          <div>
            {groups.map((g) => (
              <div key={g.title} className={styles.grp}>
                <div className={styles.gh}>
                  <em>▤</em>
                  {g.title}
                </div>
                {g.rows.map((f) => {
                  const ro = !f.writable;
                  const on = f.num === selectedNum;
                  const hot = !on && hotProps.has(f.prop);
                  return (
                    <div
                      key={f.num}
                      className={[styles.it, ro ? styles.ro : "", on ? styles.on : "", hot ? styles.hot : ""]
                        .filter(Boolean)
                        .join(" ")}
                      data-factor={f.num}
                      data-testid={`sandbox-home-factor-${f.num}`}
                      onClick={() => setSelectedNum(f.num)}
                    >
                      <span className={styles.mk}>{f.mark}</span>
                      <span className={styles.tg}>{ro ? "／" : "▤"}</span>
                      {f.factorName}
                      {f.ruleGate !== undefined && <span className={styles.rg}>{f.ruleGate}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 右列：落点 */}
          <div>
            {groups.map((g) => (
              <div key={g.title} className={styles.grp}>
                <div className={styles.gh}>
                  <em>▤</em>
                  落点
                </div>
                {g.rows.map((f) => (
                  <div key={f.num} className={styles.dp} data-drop={f.num} data-testid={`sandbox-home-drop-${f.num}`}>
                    ▸ <b>{OBJECT_TYPE_LABEL[f.objectType] ?? f.objectType}</b>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* 上下文菜单：词表 = 契约 PerturbationKind 的 5 类 */}
          <div className={styles.ctx} data-testid="sandbox-home-ctx">
            <u>添加扰动</u>
            {PERTURBATION_KINDS.map((k) => (
              <u key={k.key} data-testid={`sandbox-home-ctx-${k.key}`} onClick={() => onAdd(k.key)}>
                ＋ {k.label}
              </u>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
