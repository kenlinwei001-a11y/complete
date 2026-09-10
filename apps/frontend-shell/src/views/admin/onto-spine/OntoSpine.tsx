import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchDomains,
  fetchMappingRegistries,
  fetchObjectTypeStats,
  fetchObjectTypes,
  fetchOntologyVersions,
  fetchPublishRequests,
  fetchRules,
  fetchSimViewConfig,
  fetchSolverRegistry,
} from "@/api/endpoints";
import { computeSpine, type SpineFacts } from "./spineModel";
import css from "./OntoSpine.module.css";

/**
 * WO-ONTO-SPINE-11 · 本体建模**动线主脊**（设计稿页面一批注 #7 的兑现）。
 *
 * 「动线主脊换成 对象 → 关系 → 状态 → 事件 → 规则 → 约束 → 因果 → 数据 → 场景/求解 → 发布，
 *   **不再按 API 表面排**。」
 *
 * ══ 这是**重排**不是新建 ═══════════════════════════════════════════════════════════
 * 11 个建模面的能力今天都在（「本体关系」一页就有 568 个按钮 / 184 行表格）。本组件
 * **不重写任何一个面**，只做两件事：① 把它们排成一条有先后的脊；② 每格现算完成度。
 * 每格的 `href` 一律指向**已有的面**（`SPINE_STEPS`），其中 03/07/08/11 四步同落在
 * 「本体关系」那一页上，故带小节锚点，免得点进去还要自己找。
 *
 * ══ 读端全部复用，零新增 API ════════════════════════════════════════════════════
 * 九个读端的 `queryKey` **逐个对齐既有页面在用的那一个** —— 这不是巧合而是要害：
 * 「本体关系」页建一条边、「域管理」页建一个域之后，它们 `invalidateQueries` 的正是这些键，
 * ⇒ **脊上的数跟着一起动，不需要本组件自己去订阅任何写路**。
 *
 * ⚠ 两个读端带 entitlement 门（沙盘/传导）：关掉的租户会 404。此时对应格的事实保持
 * `undefined` ⇒ 屏上显 `—`，**不退化成 0** —— 「没读到」与「真的是 0」是两个不同的命题，
 * 显 0 会让一个功能齐备的租户看起来像什么都没建。
 */
export default function OntoSpine({ now }: { now?: string }) {
  // 键与既有页面对齐（见文件头注）；staleTime 0 ⇒ 每次进面重读，改完数据回来就看得见。
  const q = { staleTime: 0, refetchOnWindowFocus: false, retry: false } as const;

  const domains = useQuery({ queryKey: ["a", "ontology-domains"], queryFn: fetchDomains, ...q });
  const types = useQuery({ queryKey: ["a", "ontology-object-types"], queryFn: fetchObjectTypes, ...q });
  const stats = useQuery({ queryKey: ["a", "object-type-stats"], queryFn: fetchObjectTypeStats, ...q });
  const registries = useQuery({ queryKey: ["a", "ontology-mapping-registries"], queryFn: fetchMappingRegistries, ...q });
  const viewCfg = useQuery({ queryKey: ["a", "sim-view-config"], queryFn: fetchSimViewConfig, ...q });
  const rules = useQuery({ queryKey: ["a", "rules"], queryFn: fetchRules, ...q });
  const solvers = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry(), ...q });
  const versions = useQuery({ queryKey: ["a", "ontology-versions"], queryFn: fetchOntologyVersions, ...q });
  const pubReqs = useQuery({ queryKey: ["a", "ontology-publish-requests"], queryFn: () => fetchPublishRequests(), ...q });

  const typeList = types.data ?? undefined;
  const statList = stats.data?.stats ?? undefined;

  const facts: SpineFacts = {
    domains: domains.data?.length,
    objectTypes: typeList?.length,
    objectProps: typeList?.reduce((n, t) => n + (t.properties?.length ?? 0), 0),
    // 结构边取**映射表**而非沙盘视图配置：两者实测同为 127，但映射表不带 entitlement 门 ⇒
    // 沙盘关掉的租户，这一格照样有数。
    linkTypes: registries.data?.linkTypes?.length,
    stateVars: viewCfg.data?.stateVars?.length,
    eventTypes: registries.data?.events?.length,
    rulesPublished: rules.data?.filter((r) => r.status === "PUBLISHED").length,
    constraintRefs: typeList?.reduce((n, t) => n + (t.constraintRefs?.length ?? 0), 0),
    typesTotal: typeList?.length,
    causalEdges: viewCfg.data?.propagationCount,
    typesWithData: statList?.filter((s) => (s.count ?? 0) > 0).length,
    objectsTotal: statList?.reduce((n, s) => n + (s.count ?? 0), 0),
    solvers: solvers.data?.solvers?.length,
    ontologyVersion: versions.data?.length ? Math.max(...versions.data.map((v) => v.version)) : undefined,
    pendingSignoff: pubReqs.data?.filter((p) => p.status === "PENDING_SIGNOFF").length,
  };

  const cells = computeSpine(facts);

  return (
    <>
      <div className={css.spine} data-testid="onto-spine" role="navigation" aria-label="本体建模动线">
        {cells.map((c) => {
          // `now` 入参只是**当前页面的自报**；它不改完成度，只在该格本就不是 gap 时覆盖高亮，
          // 让「我正站在哪一页」与「动线算出来的作业面」都能看见。
          const state = now && c.def.key === now && c.state !== "gap" ? "now" : c.state;
          const cls = `${css.cell} ${css[state]}`;
          const title = c.def.gapNote
            ? `${c.def.title} · ${c.def.gapNote}`
            : c.def.derivedNote
              ? `${c.def.title} · 数据来源：${c.def.source}。${c.def.derivedNote}`
              : `${c.def.title} · 数据来源：${c.def.source}`;
          const inner = (
            <>
              <div className={css.no}>{c.def.no}</div>
              <div className={css.title}>{c.def.title}</div>
              <div className={css.sub}>{c.def.sub}</div>
              <div className={css.count} data-testid={`spine-count-${c.def.key}`}>{c.count ?? "—"}</div>
              {c.def.derivedNote && <div className={css.derived}>派生自 08</div>}
              {state === "gap" && <div className={css.derived}>无落点</div>}
            </>
          );
          return c.def.href ? (
            <Link key={c.def.key} to={c.def.href} className={cls} title={title} data-testid={`spine-cell-${c.def.key}`} data-state={state}>
              {inner}
            </Link>
          ) : (
            <div key={c.def.key} className={cls} title={title} data-testid={`spine-cell-${c.def.key}`} data-state={state} aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </div>
      <div className={css.legend} data-testid="onto-spine-legend">
        <span><i className={css.legendDot} style={{ background: "var(--ok)" }} />已建成</span>
        <span><i className={css.legendDot} style={{ background: "var(--accent-solid)" }} />作业面</span>
        <span><i className={css.legendDot} style={{ background: "var(--line)" }} />待建</span>
        <span><i className={css.legendDot} style={{ background: "var(--warn)" }} />今天没有落点</span>
        <span>计数为本租户此刻真实读数，非预设值；`—` = 该读端未返回，不代表 0。</span>
      </div>
    </>
  );
}
