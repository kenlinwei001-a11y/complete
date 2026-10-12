/**
 * WO-LIVE-ENDPOINTS · 活①②「活系统」端点纯映射层（server.ts 调·可单测·R6 无 Date/random/网络）。
 *
 * ① compose（/b/v1/sim/compose）：真 portfolio(GlobalSimResponse) 逐方案联合求解 → 叙述 + 三方案读数。
 *    compose 单原语（非 path-B Agent）→ ranAgentLoop 恒 false（runAgentLoop 未落·分水岭）。
 * ② capacity-live（/b/v1/capacity-live/ask）：真 generic_inference(levers)/gap_attribution 输出 → CapacityLiveAnswer。
 *
 * 数字全取求解器真值——改输入（问句/基地/portfolio 真解）→ 输出变（KILL-MOCK·非正则假 NL/写死示意）。
 */

// ── 活① compose（形状对齐前端 SimComposeNarrative） ─────────────────────────────
export const SIM_COMPOSE_SCENARIOS = ["max_ontime", "min_cost", "min_changeover"] as const;
const SCEN_NAME: Record<string, string> = { max_ontime: "最多按期", min_cost: "最低代价", min_changeover: "最少换型" };

export interface ComposeScenarioRow { key: string; ontime: number; displaced: number; ontimeRate: number; cost: number }
export interface ComposeNarrative {
  path: "compose";
  ranAgentLoop: false;
  narrative: string;
  scenarios: ComposeScenarioRow[];
  provenance: { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }[];
}

/**
 * GlobalSimResponse.scenarios（各含 objectiveValues.{ontime,cost} + servedCount/displacedCount）→ compose 叙述 + 读数。
 * ontimeRate = round(ontime/(served+displaced)*100)（同 mockGlobalSim 口径·与前端桩字节对齐）。
 */
export function buildComposeNarrative(query: string, scenarios: Record<string, unknown>[]): ComposeNarrative {
  const rows: ComposeScenarioRow[] = scenarios.map((s) => {
    const ov = (s.objectiveValues ?? {}) as Record<string, number>;
    const ontime = Number(ov.ontime ?? 0);
    const cost = Number(ov.cost ?? 0);
    const served = Number(s.servedCount ?? 0);
    const disp = Number(s.displacedCount ?? 0);
    const ontimeRate = served + disp > 0 ? Math.round((ontime / (served + disp)) * 100) : 0;
    return { key: String(s.key), ontime, displaced: disp, ontimeRate, cost };
  });
  const p = rows[0] ?? { key: "max_ontime", ontime: 0, displaced: 0, ontimeRate: 0, cost: 0 };
  const narrative =
    `联合求解（compose 路径 · 未起 agent 循环）：针对「${query}」逐方案联合求解——`
    + rows.map((r) => `「${SCEN_NAME[r.key] ?? r.key}」按期率 ${r.ontimeRate}%、被挤单 ${r.displaced} 单、代价 ${r.cost}`).join("；")
    + `。推荐主方案「${SCEN_NAME[p.key] ?? p.key}」（按期率最高·被挤单 ${p.displaced}）。数字取自 portfolio 联合求解真值（可溯）。`;
  return {
    path: "compose",
    ranAgentLoop: false,
    narrative,
    scenarios: rows,
    provenance: [{ kind: "求解器", drillType: "GlobalSim", drillId: "portfolio", drillField: "ontime", drillValue: p.ontime }],
  };
}

// ── 活② 产能页 what-if 意图识别 + 求解器输出映射（形状对齐前端 CapacityLiveAnswer） ──
const RE_CAP_WHATIF = /(良率|产能|降到|降至|提到|提至|少多少|多少|OEE|oee|利用率|稼动|扩|加班|夜班|外包)/;

export interface CapacityIntent { isWhatIf: boolean; num: number | null; factors: string[] }
/** 产能 what-if 意图判定（关键词 + 数值）+ 因子集派生（喂 generic_inference levers·R6 确定）。 */
export function classifyCapacityQuestion(q: string): CapacityIntent {
  const m = q.match(/(\d+(?:\.\d+)?)\s*%?/);
  const num = m ? parseFloat(m[1]!) : null;
  const isWhatIf = RE_CAP_WHATIF.test(q) && num != null;
  const factors: string[] = [];
  if (/良率|yield/.test(q)) factors.push("良率波动");
  if (/OEE|oee|稼动|利用率|设备/.test(q)) factors.push("设备OEE");
  if (/扩|通道|夜班|加班|产能/.test(q)) factors.push("瓶颈工序");
  if (/外包|外协/.test(q)) factors.push("物料齐套");
  return { isWhatIf, num, factors: factors.length ? [...new Set(factors)] : ["瓶颈工序"] };
}

export interface CapacityLiveAnswer {
  answer: string;
  solver: string;
  provenance: { src: string; formula?: string; inputs?: string[] };
  deltas?: { objectId: string; type?: string; prop: string; before: number; after: number }[];
  dataMode: string;
}

/**
 * generic_inference(levers) 输出 → what-if 叙述（最敏感杠杆·带溯源·答案随基地/因子变）。
 * levers 空（本体该作用域无下游派生边）→ dataMode:"EMPTY"（调用方据此诚实转 gap_attribution 兜底·不返空壳）。
 */
export function mapLeversAnswer(q: string, base: string, baseId: string, data: Record<string, unknown>): CapacityLiveAnswer {
  const levers = Array.isArray(data.levers) ? (data.levers as Record<string, unknown>[]) : [];
  const top = levers[0] as
    | { objectType?: string; objectId?: string; prop?: string; currentValue?: number; sensitivity?: number; provenance?: { src?: string; formula?: string; inputs?: string[] } }
    | undefined;
  if (!top) return { answer: "", solver: "generic_inference", provenance: { src: "" }, dataMode: "EMPTY" };
  const prov =
    top.provenance && top.provenance.src
      ? { src: top.provenance.src, formula: top.provenance.formula, inputs: top.provenance.inputs }
      : { src: "generic_inference · recompute(dryRun,±ε)", formula: "∂(下游派生)/∂(因子)", inputs: baseId ? [`scope.baseId=${baseId}`] : [] };
  return {
    answer: `按 ${base} 推演「${q}」：反推出 ${levers.length} 个可撬动产能杠杆，最敏感因子 ${top.objectType}.${top.prop}（当前值 ${top.currentValue}、敏感度 ∂产能/∂因子≈${top.sensitivity}）——沿派生链前向重算（generic_inference·recompute dryRun ±ε）。`,
    solver: "generic_inference",
    provenance: prov,
    deltas:
      typeof top.currentValue === "number"
        ? [{ objectId: String(top.objectId ?? ""), type: String(top.objectType ?? ""), prop: String(top.prop ?? ""), before: top.currentValue, after: top.currentValue }]
        : [],
    dataMode: "LIVE",
  };
}

/** gap_attribution 输出 → 根因叙述（rootMetric/totalGap/summary·结构反向多跳分摊·带溯源）。 */
export function mapGapAnswer(q: string, base: string, baseId: string, factor: string | undefined, data: Record<string, unknown>): CapacityLiveAnswer {
  const rootMetric = (data.rootMetric ?? {}) as { name?: string; gap?: number; unit?: string };
  const totalGap = data.totalGap ?? rootMetric.gap ?? 0;
  const summary = typeof data.summary === "string" && data.summary ? data.summary : `根目标缺口 ${totalGap}${rootMetric.unit ?? ""}`;
  return {
    answer: `已按 ${base}${factor ? `·${factor}` : ""} 结构反向归因「${q || "根因"}」：${summary}（gap_attribution·逐层 Σ子+residual 硬勾稽）。`,
    solver: "gap_attribution",
    provenance: { src: "gap_attribution · 结构反向归因", inputs: [...(baseId ? [`scope.baseId=${baseId}`] : []), ...(factor ? [`scope.factorId=${factor}`] : [])] },
    dataMode: "SYNTHETIC",
  };
}
