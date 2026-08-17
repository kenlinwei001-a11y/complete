import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOptTemplates, invokeSolver, retrieveOptTemplates, solveOptTemplate } from "@/api/endpoints";
import type { ViewConfigVM } from "@/api/types";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
// WO-SANDBOX-53CELLS · 判据 U5（结论数字标出处）：目标值/Δ 此前是裸数字，
// 屏上唯一带出处的 `ow-family-source` 说的是模板清单的出处、不是目标值的出处。
import { Provenance } from "@/components/Provenance";
import EdgeActivePanel from "./sim/EdgeActivePanel";
// WO-HARNESS-UX-GAP-1 · 判据 U7（同屏问答知道自己在哪一页）+ U9（导出物自带出处与生成时间）。
// 本页走 App.tsx 的专用 route，不经 ViewPage ⇒ 必须自己调 usePageView（理由见 shared.tsx 该函数注释）。
import { ExportReportButton, usePageView } from "./sim/shared";
import type { ProvenanceReport } from "./sim/exportProvenance";
import { SolverStepBar, useSolverStep } from "./sim/SolverStepBar";
// WO-U3-DAG-DESIGN · 判据 U3：本页此前只有步骤条（U2），没有过程图。
// 图与步骤条**同源**（`OW_GRAPH` 一份结构两种画法）—— 见 `reasoningGraph.ts` 头注与
// `docs/DESIGN-u2u3-structure.md`。
import { LayeredDag } from "@/components/Dag/LayeredDag";
import { DagNodeInspector } from "./sim/DagNodeInspector";
import {
  assertReasoningGraph,
  findNode,
  toDagEdges,
  toDagNodeFacts,
  toDagNodes,
  toSolverSteps,
  type ReasoningGraph,
} from "./sim/reasoningGraph";

/**
 * 优化推演页（renderer=optimize-whatif·闭 G-12 前端半）——把 `optimize_whatif`（轨B·增量3）从"一个 Δ 数字"
 * 升级为**让用户看懂的决策比对**：结构化可编辑输入（改前局面）→ 白话推演控制（改哪个参数到多少）→
 * **基线方案 vs 扰动后方案**并排（开哪些设施 / 怎么指派 / 总成本），直接看到"改一个参数，最优决策怎么切换"。
 * 支持**二次推演**：输入/推演随时改，点「推演」重解、重比对。
 *
 * KILL-MOCK 铁律：Δ / 方案结构全部从真 sidecar CP-SAT 重解输出渲染（后端 baselineSolution/perturbedSolution 透传·
 * service.ts SOLVER_OUTPUT_SHAPES.optimize_whatif）；改输入/扰动→重取→决策真变（非写死）。
 * 诚实态：本地无 OPTIMIZER_BASE_URL → 后端返「未接入最优化引擎」→ 本页诚实提示（非空白 / 非假 Δ）。
 */

/**
 * 各 family 的**中文口径与开箱示例**（UI 文案 + 演示输入，不是"有哪些 family"的真相源）。
 *
 * ⚠ **WO-BEFE-E 订正**：这份表原先是清单本身，注释写着「= app.ts OPT_FAMILIES」——
 *   那正是本仓治过的「同一概念两套词表」：后端加/减一个 family，界面不会知道，
 *   两边都能跑、谁也不报错。现在**权威在后端**（`GET /a/v1/opt/templates`），
 *   本表只回答「这个 key 怎么用中文说、拿什么示例开箱跑」。
 *   后端给了而本表没有的 key **照样上屏**（标「本页暂无中文示例」），不许静默隐藏 ——
 *   隐藏就等于把新模板藏起来，恰是本单要治的病。
 */
const FAMILY_COPY: { key: string; label: string; hint: string }[] = [
  { key: "facility_location", label: "选址（基地×订单）", hint: "选开哪些设施 + 每个订单在哪生产·min 总成本" },
  { key: "min_cost_flow", label: "调拨网络", hint: "供需网络·min 运输成本" },
  { key: "set_cover", label: "覆盖布点", hint: "最少集合覆盖全域" },
  { key: "independent_set", label: "互斥选取", hint: "最大权互不相邻节点集" },
  { key: "combinatorial_auction", label: "组合中标", hint: "最大化中标组合价值" },
];

/** 每 family 的最小基线示例（抽象结构·零业务常数）——让页面开箱即可跑一个真解。 */
const FAMILY_EXAMPLE: Record<string, Record<string, unknown>> = {
  facility_location: {
    facilities: [
      { id: "f1", openCost: 100, capacity: 10 },
      { id: "f2", openCost: 120, capacity: 10 },
    ],
    clients: [
      { id: "c1", demand: 3 },
      { id: "c2", demand: 4 },
    ],
    assignCosts: [
      { client: "c1", facility: "f1", cost: 5 },
      { client: "c1", facility: "f2", cost: 8 },
      { client: "c2", facility: "f1", cost: 9 },
      { client: "c2", facility: "f2", cost: 4 },
    ],
  },
  min_cost_flow: {
    nodes: [{ id: "s1", supply: 10 }, { id: "s2", supply: 5 }, { id: "d1", supply: -8 }, { id: "d2", supply: -7 }],
    arcs: [
      { from: "s1", to: "d1", cost: 4, cap: 10 }, { from: "s1", to: "d2", cost: 6, cap: 10 },
      { from: "s2", to: "d1", cost: 5, cap: 10 }, { from: "s2", to: "d2", cost: 3, cap: 10 },
    ],
  },
  set_cover: {
    sets: [
      { id: "A", cost: 3, covers: ["e1", "e2", "e3"] }, { id: "B", cost: 2, covers: ["e2", "e4"] },
      { id: "C", cost: 4, covers: ["e3", "e4", "e5"] }, { id: "D", cost: 2, covers: ["e5", "e1"] },
    ],
  },
  independent_set: {
    nodes: [{ id: "n1", weight: 5 }, { id: "n2", weight: 4 }, { id: "n3", weight: 6 }, { id: "n4", weight: 3 }],
    edges: [{ a: "n1", b: "n2" }, { a: "n2", b: "n3" }, { a: "n3", b: "n4" }],
  },
  combinatorial_auction: {
    bids: [
      { id: "b1", value: 10, items: ["i1", "i2"] }, { id: "b2", value: 8, items: ["i2", "i3"] },
      { id: "b3", value: 6, items: ["i3"] }, { id: "b4", value: 7, items: ["i1"] },
    ],
  },
};

/** 每 family 的默认扰动 target（开箱预置一条·让页面打开即可"推演"·target 接地到该 family 的对象·DF.8）。 */
const FAMILY_DEFAULT_PERTURB: Record<string, { target: string; value: number }> = {
  facility_location: { target: "facilities.f1.openCost", value: 150 },
  min_cost_flow: { target: "arcs.s2-d2.cost", value: 9 },
  set_cover: { target: "sets.A.cost", value: 8 },
  independent_set: { target: "nodes.n3.weight", value: 2 },
  combinatorial_auction: { target: "bids.b1.value", value: 3 },
};

/** 中文口径标签（让"看懂"·未知字段回落原名）。 */
const COLL_LABEL: Record<string, string> = { facilities: "候选基地", clients: "订单需求", assignCosts: "指派成本", nodes: "节点", arcs: "调拨弧", sets: "候选集合", edges: "冲突边", bids: "投标包" };
const FIELD_LABEL: Record<string, string> = { openCost: "开设成本", capacity: "产能", demand: "需求量", cost: "成本", supply: "供给量", cap: "容量上限", weight: "权重", value: "价值", covers: "覆盖元素", items: "含物品" };
const collLabel = (k: string) => COLL_LABEL[k] ?? k;
const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

/** 可扰动数值字段白名单（决定哪些格子可编辑 + 哪些可当推演 target）。 */
const NUMERIC_FIELDS = ["openCost", "capacity", "demand", "cost", "supply", "cap", "weight", "value"];

interface FLSolution {
  openFacilities?: string[];
  assignments?: { client: string; facility: string }[];
  objective?: number;
  optimal?: boolean;
  [k: string]: unknown;
}
/** optimize_whatif 输出（= SOLVER_OUTPUT_SHAPES.optimize_whatif·含决策比对方案结构透传）。 */
interface OptWhatifOutput {
  baselineObjective: number | null;
  perturbedObjective: number | null;
  deltaObjective: number | null;
  feasible: boolean;
  conflictConstraints: string[];
  explanation: string;
  baselineSolution?: FLSolution;
  perturbedSolution?: FLSolution;
  summary?: string;
  optimal?: boolean;
  status?: string;
}

const fmt = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—");

/**
 * WO-U2-STEPWISE-1 建 / WO-U3-DAG-DESIGN 改结构 · `optimize_whatif` 推演结构
 * （判据 U2 步骤条 ＋ 判据 U3 过程图，**同一份结构两种画法**）。
 *
 * 每个节点 = 求解器输出的**真实分段字段**（后端无 `steps[]`·前端按已有字段推导——
 * 契约判定与论据见 `SolverStepBar` 头注，防漂移机制见 `reasoningGraph.ts` 头注）。
 *
 * ── 为什么这一页必须画图，而不是只留步骤条（WO-U3-DAG-DESIGN 的裁决论据）──
 * 本页真实求解链是 **入参 →（基线解 ∥ 扰动后解）→ 比对 → 解读**：
 * 中间那一层是**两次互相独立的 CP-SAT 重解**，谁也不是谁的输入。
 * 步骤条只能把它压成一格「两次求解」⇒ **屏上分辨不出这是两次独立求解**，
 * 而「两次同 seed 同模板族所以可比」正是本页全部结论的立足点 —— 压掉它，
 * 用户就没法判断 Δ 是真的还是求解器在飘。这就是 `isLinearChain(OW_GRAPH) === false`
 * 的实际含义：**有分叉 ⇒ 步骤条不够，必须有图**。
 */
const OW_GRAPH: ReasoningGraph = assertReasoningGraph({
  layerTitles: ["入参与扰动", "两次求解", "比对判定", "解读"],
  nodes: [
    {
      key: "inputs", layer: 0, label: "入参与扰动", sub: "模板族 · seed · 扰动清单",
      data: "模板族 + 基线 args + 扰动清单（data_override）+ seed 42",
      solver: "页面入参 · 未求解",
      rule: "入参回显 · 两次求解同 seed 同模板族 ⇒ 目标值可比（本环无判定）",
      ruleKind: "projection",
      note: "优化解对「模板族 · seed · 扰动清单」三样都敏感：复算时三样必须一致，否则得到的不是同一个最优方案。",
    },
    {
      key: "solve-baseline", layer: 1, label: "基线求解", sub: "改前局面真解一次",
      data: "baselineSolution / baselineObjective",
      solver: "optimize_whatif",
      rule: "基线局面真解一次（CP-SAT sidecar · seed 42 · 同输入同输出）",
      ruleKind: "projection",
    },
    {
      key: "solve-perturbed", layer: 1, label: "扰动后求解", sub: "改后局面真解一次",
      data: "perturbedSolution / perturbedObjective",
      solver: "optimize_whatif",
      rule: "扰动后局面**另解一次**（同 seed 同模板族 ⇒ 与基线可比；不是在基线解上改数）",
      ruleKind: "projection",
    },
    {
      key: "compare", layer: 2, label: "比对判定", sub: "Δ · 决策切换 · 可行性",
      data: "deltaObjective + feasible + conflictConstraints",
      solver: "optimize_whatif",
      rule: "Δ = 扰动后目标值 − 基线目标值；决策切换 = 开设集合排序后不同；约束冲突即不可行",
      ruleKind: "projection",
      formula: "Δ = perturbedObjective − baselineObjective",
    },
    {
      key: "explain", layer: 3, label: "解读", sub: "求解器一句话说明",
      data: "explanation（求解器一句话说明）",
      solver: "optimize_whatif",
      rule: "求解器白话说明 · 原样透传（前端不改写、不总结）",
      ruleKind: "projection",
    },
  ],
  edges: [
    // 分叉：同一组入参喂给两次**互相独立**的求解。
    { from: "inputs", to: "solve-baseline" },
    { from: "inputs", to: "solve-perturbed" },
    // 汇合：Δ 与切换判定都要两次解都在才算得出来。
    { from: "solve-baseline", to: "compare" },
    { from: "solve-perturbed", to: "compare" },
    { from: "compare", to: "explain" },
  ],
});

/** U2 步骤条 = `OW_GRAPH` 的线性投影（**不是**另一份手写清单——手写两份必漂移，RL3）。 */
const OW_STEPS = toSolverSteps(OW_GRAPH);

/** 稳定 id（arcs 用 from-to 复合）。 */
const itemId = (coll: string, item: Record<string, unknown>): string => (coll === "arcs" ? `${item.from}-${item.to}` : String(item.id ?? ""));

/** 深克隆（结构化 args 全 JSON 可序列化）。 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 把 data_override 扰动施加到 baseline 克隆（前端只为算"扰动后局面/成本明细"·真解仍在后端）。 */
function applyPerturbs(base: Record<string, unknown>, perturbs: { target: string; value: number }[]): Record<string, unknown> {
  const a = clone(base);
  for (const p of perturbs) {
    const [coll, id, field] = p.target.split(".");
    const arr = a[coll!] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    const obj = arr.find((e) => itemId(coll!, e) === id);
    if (!obj) continue;
    const f = field ?? (coll === "facilities" ? "openCost" : coll === "bids" ? "value" : "cost");
    if (Number.isFinite(p.value)) obj[f] = p.value;
  }
  return a;
}

/** 从 baseline 派生所有可扰动 target（collection.id.field + 当前值 + 中文标签）。 */
function perturbTargets(baseline: Record<string, unknown>): { value: string; label: string; current: number }[] {
  const out: { value: string; label: string; current: number }[] = [];
  for (const [coll, arr] of Object.entries(baseline)) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr as Record<string, unknown>[]) {
      const id = itemId(coll, item);
      if (!id) continue;
      for (const f of NUMERIC_FIELDS) {
        if (typeof item[f] === "number") out.push({ value: `${coll}.${id}.${f}`, label: `${collLabel(coll)} ${id} · ${fieldLabel(f)}`, current: item[f] as number });
      }
    }
  }
  return out;
}

export default function OptimizeWhatifView({ view }: { view?: ViewConfigVM }) {
  usePageView("optimize-whatif");
  const initialFamily = (view?.layout as { family?: string } | undefined)?.family ?? "facility_location";
  const [family, setFamily] = useState(initialFamily);
  const [baseline, setBaseline] = useState<Record<string, unknown>>(() => clone(FAMILY_EXAMPLE[initialFamily] ?? {}));
  const [perturbs, setPerturbs] = useState<{ target: string; value: number }[]>(() => {
    const d = FAMILY_DEFAULT_PERTURB[initialFamily];
    return d ? [{ ...d }] : [];
  });
  // 已提交求解的入参（点「推演」才更新·支持二次推演：改后再点即重解）。
  const [submitted, setSubmitted] = useState<{ family: string; baseline: Record<string, unknown>; perturbs: { target: string; value: number }[] } | null>(null);

  const onPickFamily = (k: string) => {
    setFamily(k);
    setBaseline(clone(FAMILY_EXAMPLE[k] ?? {}));
    const d = FAMILY_DEFAULT_PERTURB[k];
    setPerturbs(d ? [{ ...d }] : []);
    setSubmitted(null);
  };

  const targets = useMemo(() => perturbTargets(baseline), [baseline]);

  // 编辑基线数值格（immutable 更新）。
  const editCell = (coll: string, idx: number, field: string, raw: string) => {
    setBaseline((prev) => {
      const next = clone(prev);
      const arr = next[coll] as Record<string, unknown>[];
      const num = Number(raw);
      arr[idx]![field] = raw === "" ? "" : Number.isFinite(num) ? num : arr[idx]![field];
      return next;
    });
  };
  const editPerturb = (i: number, patch: Partial<{ target: string; value: number }>) =>
    setPerturbs((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPerturb = () => setPerturbs((prev) => [...prev, { target: targets[0]?.value ?? "", value: targets[0]?.current ?? 0 }]);
  const removePerturb = (i: number) => setPerturbs((prev) => prev.filter((_, j) => j !== i));

  const runSolve = () => setSubmitted({ family, baseline: clone(baseline), perturbs: clone(perturbs) });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "optimize_whatif", submitted?.family, JSON.stringify(submitted?.baseline), JSON.stringify(submitted?.perturbs)],
    enabled: submitted != null && (submitted?.perturbs.length ?? 0) > 0,
    retry: false,
    queryFn: async () => {
      const perturbations = submitted!.perturbs.map((p) => ({ kind: "data_override", target: p.target, value: p.value }));
      const res = await invokeSolver("optimize_whatif", { family: submitted!.family, args: submitted!.baseline, perturbations, seed: 42 });
      return res.data as OptWhatifOutput;
    },
  });

  /**
   * WO-BEFE-E · 模板族**权威清单**（`GET /a/v1/opt/templates`）。
   *
   * `retry:false`：`opt.solver-pool` 是暗发 feature（defaultOn:false），关着时后端回
   * 404 `FEATURE_NOT_FOUND`（R3 先于 authz）——那是「本租户没开通」，不是「后端坏了」，重试没意义。
   * 取不到 ⇒ 回退到本页内置的 `FAMILY_COPY` 键集，并**在屏上写明这是回退**（不冒充权威）。
   */
  const templatesQuery = useQuery({ queryKey: ["a", "opt-templates"], queryFn: fetchOptTemplates, retry: false });
  const authoritative = templatesQuery.data?.families ?? null;
  /** 屏上要铺的 family 卡：后端给的为准；后端给了而本页无中文文案的**照样上屏**（标注而非隐藏）。 */
  const families = useMemo(() => {
    const keys = authoritative ?? FAMILY_COPY.map((f) => f.key);
    return keys.map((key) => FAMILY_COPY.find((f) => f.key === key) ?? { key, label: key, hint: "本页暂无中文示例——可经 CLI/curl 调用（R15）" });
  }, [authoritative]);

  const errMsg = (error as { message?: string } | undefined)?.message ?? "";
  const unavailable = isError && /未接入|OPTIMIZER_BASE_URL|not.?configured/i.test(errMsg);
  const activeFamily = families.find((f) => f.key === family);

  // ── WO-BEFE-E · 按需求检索模板（`GET /a/v1/opt/retrieve`·advisory 不入确定性求解路径）──
  const [need, setNeed] = useState("");
  const [needSubmitted, setNeedSubmitted] = useState<string | null>(null);
  const retrieveQuery = useQuery({
    queryKey: ["a", "opt-retrieve", needSubmitted],
    queryFn: () => retrieveOptTemplates(needSubmitted!),
    enabled: needSubmitted !== null && needSubmitted.trim() !== "",
    retry: false,
  });

  // ── WO-BEFE-E · 基线求解（`POST /a/v1/opt/solve`）——「就现在，最优怎么排」──────────
  // 此前本页**必须先加一条扰动才肯求解**（下面「推演」按钮 `disabled={perturbs.length === 0}`），
  // 于是这个最朴素的问法在界面上问不出来。
  const [baseSolve, setBaseSolve] = useState<Record<string, unknown> | null>(null);
  const [baseSolving, setBaseSolving] = useState(false);
  const onSolveBaseline = async () => {
    setBaseSolving(true);
    try {
      setBaseSolve(await solveOptTemplate(family, baseline));
    } catch (e) {
      setBaseSolve(null);
      toastError(e);
    } finally {
      setBaseSolving(false);
    }
  };

  /**
   * 判据 U9 · 导出物内容 —— 只搬屏上已有的值，本函数不做算术。
   * `basis` 必须同时写清 **模板族 · seed · 扰动清单**：优化解对这三样都敏感，
   * 少写一样，拿到文档的人复算出来的最优方案就可能与附件里的不是同一个。
   */
  const buildReport = (): ProvenanceReport => {
    const perturbLines = (submitted?.perturbs ?? perturbs).map((p) => `${p.target}→${p.value}`);
    return {
      docName: "优化推演",
      basis: [
        `求解器 optimize_whatif · 模板族 ${submitted?.family ?? family}（seed 42·同输入同输出）`,
        perturbLines.length ? `扰动：${perturbLines.join("，")}` : "扰动：（未设）",
        submitted ? "下表为已提交求解的那一版入参对应的解" : "尚未点「推演」——下表只反映输入，不含求解结果",
        data ? `可行性 ${data.feasible ? "可行" : "不可行"}${data.status ? ` · 状态 ${data.status}` : ""}` : "本次无求解结果",
      ],
      sections: [
        {
          heading: "目标值对照",
          head: ["项", "值"],
          rows: data
            ? [
                ["基线目标值", fmt(data.baselineObjective)],
                ["扰动后目标值", fmt(data.perturbedObjective)],
                ["差值", fmt(data.deltaObjective)],
                ["冲突约束", data.conflictConstraints.join(" ") || "—"],
                ["说明", data.explanation || "—"],
              ]
            : [],
        },
      ],
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="optimize-whatif">
      {/* 标题 + family 选择 */}
      <div className="panel">
        <div className="section-title">
          优化推演 · {activeFamily?.label ?? family}
          <ExportReportButton pageKey="optimize-whatif" build={buildReport} />
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.6 }}>{activeFamily?.hint}——改一个参数，看最优决策怎么变。</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }} data-testid="ow-family-list">
          {families.map((f) => (
            <button key={f.key} data-testid={`ow-family-${f.key}`} className={`btn sm${family === f.key ? " primary" : ""}`} title={f.hint} onClick={() => onPickFamily(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {/* WO-BEFE-E · 清单出处的诚实位：来自后端（权威）还是本页内置（回退）—— 两者绝不长得一样。
         *
         * 分层（规范 §1 + §4.2，两个方向各用一次）：
         *  · **出处这个状态留第一层** —— 按 §4.2 判据「这条诚实位若为真，用户会不会重新解读
         *    第一层的那个结论？」会：不看它，上面那排按钮会被当成后端权威清单，
         *    而回退态下它可能与后端不一致。所以「权威 / 回退」「未开通或取不到」留在屏上。
         *  · **完整口径降浮层** —— 从哪个后端地址取的、哪个功能没开通、可能怎么不一致，
         *    都是「凭什么」，属浮层；第一层留 `?` 记号（静默降层等于删除）。
         * 原文一字未删，只是换了层。 */}
        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="ow-family-source" data-authoritative={authoritative ? "1" : "0"}>
          {authoritative ? (
            <>
              模板清单 · 后端权威 {authoritative.length} 个
              <InfoPopover topic={zh.opt.info.familySource} testId="ow-family-source-why">
                {/* 出处（工程师层，不上屏）：读端 GET /a/v1/opt/templates。 */}
                <span data-testid="ow-family-source-body">
                  模板族清单由后端下发（{authoritative.length} 个 · 权威口径），不是前端写死的列表
                </span>
              </InfoPopover>
            </>
          ) : templatesQuery.isLoading ? (
            "正在取模板族清单…"
          ) : (
            <>
              ⚠ 模板清单 · 本页回退（未开通或取不到）
              <InfoPopover topic={zh.opt.info.familySource} testId="ow-family-source-why">
                <span data-testid="ow-family-source-body">
                  取不到后端模板族清单（本租户未开通优化模板池 opt.solver-pool，或后端不可达）——下面是本页内置的回退清单，可能与后端不一致
                </span>
              </InfoPopover>
            </>
          )}
        </div>
      </div>

      {/* WO-BEFE-E · 按需求找模板（GET /a/v1/opt/retrieve · advisory 不入确定性求解路径 FUS2） */}
      <div className="panel" data-testid="ow-retrieve">
        <div className="section-title">
          按需求找模板<span style={{ fontSize: 12, color: "var(--muted2)", fontWeight: 400, marginLeft: 8 }}>只帮你选型，不参与求解</span>
          {/* placeholder 是**文案型属性**，门与人都读作第一层的一块内容 —— 举例属于「怎么用」，
              按规范 §1 降进浮层；输入框里只留那句提示本身。例子原文照搬，一个字没删。 */}
          <InfoPopover topic={zh.opt.info.retrieveHow} testId="ow-retrieve-how">
            <span data-testid="ow-retrieve-how-body">用一句话说你要解什么（例：选在哪些地方开点、成本最低）</span>
          </InfoPopover>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input
            data-testid="ow-need-input"
            value={need}
            placeholder="用一句话说你要解什么"
            onChange={(e) => setNeed(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button className="btn sm" data-testid="ow-need-search" disabled={need.trim() === ""} onClick={() => setNeedSubmitted(need.trim())}>
            找模板
          </button>
        </div>
        {retrieveQuery.isError && (
          <div style={{ fontSize: 12, color: "var(--amber-txt)", marginTop: 6 }} data-testid="ow-retrieve-error">
            {/* 「没查出来 ≠ 没有」这半句**留第一层**（§4.2：不看它，这一格会被读成「确实没有匹配的模板」，
                结论当场反过来）；「为什么不可用」是口径，降浮层。 */}
            ⚠ 检索不可用（不是「没有匹配的模板」）
            <InfoPopover topic={zh.opt.info.retrieveError} testId="ow-retrieve-error-why">
              <span data-testid="ow-retrieve-error-body">
                检索不可用（本租户未开通优化模板池，或后端不可达）——这是「没查出来」，不是「没有匹配的模板」。
              </span>
            </InfoPopover>
          </div>
        )}
        {retrieveQuery.data && (
          <div style={{ marginTop: 8, fontSize: 12 }} data-testid="ow-retrieve-result" data-mode={retrieveQuery.data.mode}>
            {/* `mode` 必须原样显示：用户有权知道这次是 embedding 还是关键词回退（后端明写"不静默"）。 */}
            <span className="badge" data-testid="ow-retrieve-mode">
              {retrieveQuery.data.mode === "embedding" ? "向量检索" : "关键词回退（模板复用检索未开通）"}
            </span>
            <span style={{ marginLeft: 8 }}>
              {retrieveQuery.data.candidates.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="badge mono"
                  style={{ marginRight: 4, cursor: "pointer" }}
                  data-testid={`ow-retrieve-pick-${c.key}`}
                  onClick={() => onPickFamily(c.key)}
                >
                  {c.key}
                </button>
              ))}
            </span>
            {retrieveQuery.data.note && (
              <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 4 }} data-testid="ow-retrieve-note">{retrieveQuery.data.note}</div>
            )}
          </div>
        )}
      </div>

      {/* ① 输入 · 当前局面（可编辑数值格） */}
      <div className="panel" data-testid="ow-input">
        <div className="section-title">① 输入 · 当前局面<span style={{ fontSize: 12, color: "var(--muted2)", fontWeight: 400, marginLeft: 8 }}>数值格可直接改</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 8 }}>
          {Object.entries(baseline).map(([coll, arr]) =>
            Array.isArray(arr) && arr.length > 0 ? <EditableTable key={coll} coll={coll} rows={arr as Record<string, unknown>[]} onEdit={editCell} /> : null,
          )}
        </div>
        {/* WO-BEFE-E · 「就现在，最优怎么排」（POST /a/v1/opt/solve）——
            此前必须先加一条扰动才肯求解，这个最朴素的问法在界面上问不出来。 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn sm" data-testid="ow-solve-baseline" disabled={baseSolving} onClick={() => void onSolveBaseline()}>
            {baseSolving ? "求解中…" : "只求基线最优（不改任何参数）"}
          </button>
          {baseSolve && (
            <span style={{ fontSize: 12 }} data-testid="ow-baseline-result">
              目标值 <b className="mono" data-testid="ow-baseline-objective">{fmt(baseSolve.objective as number | null)}</b>
              {typeof baseSolve.optimal === "boolean" && (
                <span className="badge" style={{ marginLeft: 6 }} data-testid="ow-baseline-optimal">
                  {baseSolve.optimal ? "可证最优" : String(baseSolve.status ?? "非最优")}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ② 推演 · 改参数 */}
      <div className="panel" data-testid="ow-perturb">
        <div className="section-title">② 推演 · 改一个参数看影响</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {perturbs.map((p, i) => {
            const cur = targets.find((t) => t.value === p.target)?.current;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} data-testid={`ow-perturb-${i}`}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>把</span>
                <select data-testid={`ow-perturb-target-${i}`} value={p.target} onChange={(e) => editPerturb(i, { target: e.target.value })} style={selStyle}>
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {typeof cur === "number" && <span style={{ fontSize: 12, color: "var(--muted2)" }}>从 <span className="mono">{cur}</span></span>}
                <span style={{ color: "var(--muted2)" }}>改为</span>
                <input type="number" data-testid={`ow-perturb-value-${i}`} value={p.value} onChange={(e) => editPerturb(i, { value: Number(e.target.value) })} style={numStyle} />
                {perturbs.length > 1 && <button className="btn sm" data-testid={`ow-perturb-remove-${i}`} onClick={() => removePerturb(i)} title="移除这条">✕</button>}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn sm" data-testid="ow-perturb-add" onClick={addPerturb} disabled={targets.length === 0}>＋ 再加一条</button>
            <button className="btn primary" data-testid="ow-solve" onClick={runSolve} disabled={perturbs.length === 0} style={{ marginLeft: "auto" }}>
              推演 →
            </button>
          </div>
          {perturbs.length === 0 && <div style={{ fontSize: 12, color: "var(--amber-txt)" }}>至少加一条推演（改一个参数）才能求解。</div>}
        </div>
      </div>

      {/* ③ 结果 · 决策怎么变 */}
      {submitted && isLoading && <div className="empty-state" data-testid="ow-loading">{zh.common.loading}</div>}

      {unavailable && (
        <div className="empty-state" data-testid="ow-unavailable">
          <div className="code">🔌</div>
          {/* 「未接入最优化引擎」是**结论**（状态），留第一层；「怎么接上」是一整段部署口径，
              且只对运维/管理员有用 —— 按规范 §1 降进 `?` 浮层，第一层留记号。
              后端回的那句错误原文（errMsg）**不降层**：它是这次请求的事实，用户要靠它判断是
              「没装引擎」还是「装了但这次挂了」。 */}
          <div style={{ fontWeight: 600, color: "var(--txt)" }}>
            未接入最优化引擎
            <InfoPopover topic={zh.opt.info.unavailable} testId="ow-unavailable-how">
              {/* 出处与接法（工程师层，不上屏）：optimize_whatif 需 CP-SAT sidecar（services/optimizer）；
                  本地内存模式要设环境变量 OPTIMIZER_BASE_URL 并起 sidecar（见 DEPLOY.md），compose 态已自动接入。 */}
              <span data-testid="ow-unavailable-body">
                这套环境还没有接上最优化引擎 —— 求解要靠它来算，所以这一页现在给不出方案。
                需要由管理员在部署时接入；接上之前，这里<b>不会拿估算的数字充数</b>，宁可空着。
              </span>
            </InfoPopover>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{errMsg}</div>
          </div>
        </div>
      )}

      {isError && !unavailable && (
        <div className="empty-state" data-testid="ow-error">
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center" }}>求解失败：{errMsg || "未知错误"}</div>
        </div>
      )}

      {data && !isError && submitted && <DecisionResult out={data} family={submitted.family} baseArgs={submitted.baseline} perturbs={submitted.perturbs} />}
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          ⚠ 本页自己的 Δ 来自 CP-SAT 重解，**不由传导边驱动**；本面板给出的是同一租户传导世界的
          反事实差异，面板内文案已写明其口径与出处，不冒充本页优化结果的变化。 */}
      <EdgeActivePanel pageKey="optimize-whatif" />
    </div>
  );
}

/** 可编辑数值表：数值格 → input，非数值（id/from/to/covers…）→ 文本。 */
function EditableTable({ coll, rows, onEdit }: { coll: string; rows: Record<string, unknown>[]; onEdit: (coll: string, idx: number, field: string, raw: string) => void }) {
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="panel" style={{ padding: "10px 12px", background: "var(--panel2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{collLabel(coll)}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>{cols.map((c) => <th key={c} style={{ textAlign: NUMERIC_FIELDS.includes(c) ? "right" : "left", color: "var(--muted2)", fontWeight: 600, padding: "3px 6px", fontSize: 12 }}>{fieldLabel(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {cols.map((c) => {
                const v = row[c];
                const editable = typeof v === "number" && NUMERIC_FIELDS.includes(c);
                return (
                  <td key={c} style={{ padding: "3px 6px", borderTop: "1px solid var(--line)", textAlign: editable ? "right" : "left" }}>
                    {editable ? (
                      <input
                        type="number"
                        data-testid={`ow-cell-${coll}-${itemId(coll, row)}-${c}`}
                        value={v as number}
                        onChange={(e) => onEdit(coll, idx, c, e.target.value)}
                        style={{ width: 62, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, padding: "2px 5px", borderRadius: 5, border: "1px solid var(--line2)", background: "var(--bg2)", color: "var(--txt)" }}
                      />
                    ) : Array.isArray(v) ? (
                      <span style={{ color: "var(--muted)" }}>{v.join(", ")}</span>
                    ) : (
                      <span className="mono" style={{ fontWeight: c === "id" ? 600 : 400 }}>{String(v)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 结果区：决策切换横幅 + 基线/扰动后方案并排 + Δ + 白话解读。
 *
 * ══ 判据 U5「结论数字标出处」 ══
 * 改前本页三个结论数字（Δ 目标值 · 基线目标值 · 扰动后目标值）**全是裸数字**。
 * 屏上唯一带出处的是 `ow-family-source` —— 但那条说的是**模板清单**的出处
 * （「这 N 个 family 是后端权威给的还是页面回退的」），**不是目标值的出处**。
 * 拿它当 U5 的证据就是「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 *
 * 改后每个目标值挂 `<Provenance>`，并写清优化解**敏感的那三样**：
 * 模板族 · seed · 扰动清单 —— 少写一样，第三方复算出来的最优方案就可能不是同一个。
 */
function DecisionResult({ out, family, baseArgs, perturbs }: { out: OptWhatifOutput; family: string; baseArgs: Record<string, unknown>; perturbs: { target: string; value: number }[] }) {
  const perturbLines = perturbs.map((p) => `${p.target}→${p.value}`);
  const solverBasis = [`模板族 ${family}`, "seed 42", perturbLines.length ? `扰动 ${perturbLines.join("，")}` : "扰动（未设）"];
  // WO-U2-STEPWISE-1 · 判据 U2：步骤态**真正驱动结果分段**——每个结果段经 `upto(步号)` 闸，
  // 点第 N 步 ⇒ 屏上的数只显示到第 N 步为止（默认末步 = 完整结果，与改前屏面一致）。
  const { active: owStep, setActive: setOwStep, upto } = useSolverStep(OW_STEPS.length);
  // WO-U3-DAG-DESIGN · 判据 U3：点过程图上的一环 → 面板出该环的**来源与规则**。
  const [dagNodeKey, setDagNodeKey] = useState<string | null>(null);
  const dagNode = dagNodeKey === null ? null : findNode(OW_GRAPH, dagNodeKey);
  const { baselineObjective, perturbedObjective, deltaObjective, feasible, conflictConstraints, explanation, baselineSolution, perturbedSolution } = out;
  const delta = typeof deltaObjective === "number" ? deltaObjective : null;
  const deltaColor = delta == null ? "var(--muted)" : delta > 0 ? "var(--amber)" : delta < 0 ? "var(--ok)" : "var(--muted)";
  const perturbedArgs = useMemo(() => applyPerturbs(baseArgs, perturbs), [baseArgs, perturbs]);

  const isFL = family === "facility_location" && (baselineSolution?.openFacilities || perturbedSolution?.openFacilities);
  const baseOpen = baselineSolution?.openFacilities ?? [];
  const pertOpen = perturbedSolution?.openFacilities ?? [];
  const switched = isFL && feasible && JSON.stringify([...baseOpen].sort()) !== JSON.stringify([...pertOpen].sort());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="ow-result">
      {/* 判据 U2 · 推演步骤条：点第 N 步 ⇒ 下方结果区只显示到第 N 步（分段闸 = upto）。 */}
      <SolverStepBar steps={OW_STEPS} active={owStep} onSelect={setOwStep} testId="ow-steps" />
      {/* 第 1 步 · 入参与扰动：本次求解的入参回执（优化解对这三样都敏感——复算三样必须一致）。 */}
      <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="ow-step-inputs">
        入参回执：{solverBasis.join(" · ")}
      </div>

      {/*
        判据 U3 · 推演过程图（与上面那条步骤条**同源** `OW_GRAPH`）。
        它比步骤条多说的那一件事：中间层是**两个并列节点** —— 基线与扰动后是两次互相独立的求解，
        步骤条压成一格就看不见了。点任一环 → 面板出该环的来源与规则。
      */}
      <div className="panel" data-testid="ow-process-graph" style={{ padding: "10px 12px", overflowX: "auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted2)", marginBottom: 5 }}>
          推演过程 · 点任一环看它凭什么
        </div>
        <LayeredDag
          nodes={toDagNodes(OW_GRAPH)}
          edges={toDagEdges(OW_GRAPH)}
          layerTitles={OW_GRAPH.layerTitles}
          onNodeClick={(n) => setDagNodeKey(n.id)}
          testId="ow-dag"
        />
      </div>
      <DagNodeInspector
        facts={dagNode === null ? null : toDagNodeFacts(dagNode)}
        onClose={() => setDagNodeKey(null)}
        testId="dag-node-inspector"
      />

      {/* 决策切换横幅 / Δ —— 第 3 步「比对判定」（Δ 与切换判定都由两次求解比对得出）。 */}
      {upto(3) && (
      <div
        className="panel"
        data-testid={switched ? "ow-switch-banner" : "ow-delta-banner"}
        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderLeft: `3px solid ${switched ? "var(--accent)" : deltaColor}` }}
      >
        {switched ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-txt)" }}>决策切换</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 7, background: "var(--hover-tint-strong)" }}>
              开 {baseOpen.join("/")} → 开 {pertOpen.join("/")}
            </span>
            {/* 「决策切换」这个徽标 + 上面那行「开 X → 开 Y」已经把结论说全了；
                「为什么会切换」是解释，降浮层（规范 §1）。原句一字未删。 */}
            <InfoPopover topic={zh.opt.info.switched} testId="ow-switch-why">
              <span data-testid="ow-switch-why-body">最优方案变了：改参后原方案不再划算，求解器自动改选</span>
            </InfoPopover>
          </>
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--txt)" }}>{feasible ? "最优决策不变（只是成本变化）" : "扰动后不可行"}</span>
        )}
        <span className="mono" data-testid="ow-delta-obj" style={{ marginLeft: "auto", fontSize: 20, fontWeight: 700, color: deltaColor }}>
          {/* 判据 U5：Δ 是本页最重的那个结论数字 —— 它必须说得出谁算的、算在什么之上。 */}
          <Provenance
            testId="ow-delta"
            src={`求解器 optimize_whatif · ${family}`}
            formula="Δ = 扰动后目标值 − 基线目标值（两次求解同 seed 同模板族，可比）"
            inputs={[...solverBasis, `基线目标值 ${fmt(baselineObjective)}`, `扰动后目标值 ${fmt(perturbedObjective)}`]}
            rule="确定性重算：同一组入参 + 同一个 seed 重跑，结果逐字节一致 —— 数变了必然是扰动改的，不是求解器在飘"
            note="优化解对「模板族 · seed · 扰动清单」三样都敏感，复算时三样必须一致，否则得到的不是同一个最优方案。"
          >
            {delta != null && delta > 0 ? "+" : ""}{fmt(deltaObjective)}
          </Provenance>
        </span>
      </div>
      )}

      {/* 判据 U5：整屏结论的口径一句话说清（基线/扰动后两张卡的目标值同出一处）——第 2 步「两次求解」。 */}
      {upto(2) && (
      <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="ow-objective-source">
        目标值出处：求解器 <span className="mono">optimize_whatif</span> · {solverBasis.join(" · ")}
      </div>
      )}

      {/* 基线 vs 扰动后 方案并排 —— 第 2 步「两次求解」。 */}
      {upto(2) && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <SolutionCard testid="ow-baseline-card" title="基线方案" tag="改前" tagKind="base" family={family} args={baseArgs} solution={baselineSolution} objective={baselineObjective} feasible />
        <SolutionCard testid="ow-perturbed-card" title="扰动后方案" tag="改后" tagKind="pert" family={family} args={perturbedArgs} solution={perturbedSolution} objective={perturbedObjective} feasible={feasible} />
      </div>
      )}

      {/* 可行性 / 冲突约束（不可行时才展开）—— 第 3 步「比对判定」。 */}
      {upto(3) && (
      <div className="panel" data-testid="ow-feasibility" style={{ padding: "10px 12px" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>可行性 </span>
        <span className={`badge ${feasible ? "green" : "red"}`} data-testid="ow-feasible" data-feasible={feasible ? "1" : "0"}>{feasible ? "可行" : "不可行"}</span>
        {!feasible && conflictConstraints.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {conflictConstraints.map((c, i) => (
              <div key={i} data-testid={`ow-conflict-${i}`} style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--danger-txt)" }}>· {c}</div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* 白话解读 —— 第 4 步「解读」。 */}
      {upto(4) && (
      <div className="panel" data-testid="ow-explanation" style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted2)", marginBottom: 5 }}>一句话解读</div>
        <div style={{ fontSize: 13, color: "var(--txt)", lineHeight: 1.75 }}>{explanation || "—"}</div>
      </div>
      )}
    </div>
  );
}

/** 单个方案卡：facility_location 渲"开哪些设施 + 怎么指派 + 成本明细"；其余 family 渲通用"选中项 + 目标值"。 */
function SolutionCard({
  testid, title, tag, tagKind, family, args, solution, objective, feasible,
}: {
  testid: string; title: string; tag: string; tagKind: "base" | "pert"; family: string; args: Record<string, unknown>; solution?: FLSolution; objective: number | null; feasible: boolean;
}) {
  const infeasible = !feasible && tagKind === "pert";
  return (
    <div className="panel" data-testid={testid} style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{title}</span>
        <span className="badge" style={tagKind === "pert" ? { background: "var(--accent)", color: "var(--on-accent)" } : undefined}>{tag}</span>
      </div>
      {infeasible ? (
        <div style={{ fontSize: 12.5, color: "var(--danger-txt)", padding: "8px 0" }}>扰动后无可行方案（约束冲突）。</div>
      ) : family === "facility_location" ? (
        <FacilityBody args={args} solution={solution} objective={objective} />
      ) : (
        <GenericBody solution={solution} objective={objective} />
      )}
    </div>
  );
}

/** facility_location 方案主体：每个设施 开/不开 + 客户指派 + 成本明细。 */
function FacilityBody({ args, solution, objective }: { args: Record<string, unknown>; solution?: FLSolution; objective: number | null }) {
  const facilities = (args.facilities as { id: string; openCost: number; capacity?: number }[]) ?? [];
  const assignCosts = (args.assignCosts as { client: string; facility: string; cost: number }[]) ?? [];
  const open = new Set(solution?.openFacilities ?? []);
  const assignments = solution?.assignments ?? [];
  const openCostSum = facilities.filter((f) => open.has(f.id)).reduce((s, f) => s + f.openCost, 0);
  const assignSum = assignments.reduce((s, a) => s + (assignCosts.find((x) => x.client === a.client && x.facility === a.facility)?.cost ?? 0), 0);
  const byFac = (fid: string) => assignments.filter((a) => a.facility === fid).map((a) => a.client);

  return (
    <div>
      {facilities.map((f) => {
        const isOpen = open.has(f.id);
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, marginBottom: 5, border: "1px solid var(--line)", background: isOpen ? "rgba(98,190,119,.1)" : "transparent", opacity: isOpen ? 1 : 0.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOpen ? "var(--ok)" : "var(--muted2)" }} />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{f.id}</span>
            {isOpen && byFac(f.id).length > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>← {byFac(f.id).join(", ")}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: isOpen ? "var(--ok-txt)" : "var(--muted2)" }}>{isOpen ? "✓ 开设" : "✗ 不开"}</span>
          </div>
        );
      })}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>总成本</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", fontFamily: "var(--font-mono)" }}>开设 {openCostSum} + 指派 {assignSum}</div>
        </div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{fmt(objective)}</div>
      </div>
    </div>
  );
}

/** 通用方案主体（非 FL family）：把解里的数组字段（chosen/winners/flows…）列出 + 目标值。 */
function GenericBody({ solution, objective }: { solution?: FLSolution; objective: number | null }) {
  const arrays = Object.entries(solution ?? {}).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];
  return (
    <div>
      {arrays.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>（方案结构见目标值）</div>
      ) : (
        arrays.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted2)" }}>{fieldLabel(k)}：</span>
            <span className="mono" style={{ fontSize: 12 }}>{v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")}</span>
          </div>
        ))
      )}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>目标值</div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{fmt(objective)}</div>
      </div>
    </div>
  );
}

const selStyle: React.CSSProperties = { fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--line2)", background: "var(--bg2)", color: "var(--txt)" };
const numStyle: React.CSSProperties = { width: 80, fontFamily: "var(--font-mono)", fontSize: 12.5, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--accent)", background: "var(--bg2)", color: "var(--txt)", fontWeight: 700 };
