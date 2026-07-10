import type {
  OntologyWorkflow,
  ReadinessResult,
  EntityReadiness,
  ReadinessDimension,
  ReadinessGrade,
} from "@platform/contracts";

/**
 * OntoFlow（PRD v2 · P4，附录 A.5）局部仿真准备度评分 —— 纯确定性函数。
 *
 * 对每个 SUBGRAPH_ENTITY 节点在 7 个加权维度上打分（0–100），加权求和得实体分，
 * 再按阈值分级；工作流整体分 = 各实体分的四舍五入均值（无实体记 0）。
 * 对应截图「局部仿真准备度 67/100 + breakdown + 缺项引导」。
 *
 * 确定性：仅函数于 wf；不读时钟/随机。同一 wf 多次调用字节级一致。
 *
 * ── 维度权重（合计 1.00）──────────────────────────────────────────────
 *   properties     0.20  子图建模属性数（每属性 +34 分，≥3 满分）
 *   primaryKey     0.20  主键定义 + 是否有主键映射（isPrimaryKey mapping）
 *   dataSource     0.15  数据源绑定（rawDatasetId/connId）或数据处理映射
 *   stateVariables 0.15  状态变量数（每个 +50 分，≥2 满分）
 *   actions        0.10  类型级行动绑定（≥1 满分）
 *   derived        0.10  派生属性数（每个 +50 分，≥2 满分）
 *   storageMode    0.10  ONTOLOGY=100 / STATIC=0（未提升为本体图谱不可推演）
 * ── 分级阈值 ──────────────────────────────────────────────────────────
 *   score < 40             → NASCENT   （雏形）
 *   40 ≤ score < 75        → DEVELOPING（成型中）
 *   score ≥ 75             → READY     （可用）
 */

type EntityNode = Extract<OntologyWorkflow["nodes"][number], { kind: "SUBGRAPH_ENTITY" }>;

interface DimSpec {
  key: ReadinessDimension["key"];
  label: string;
  weight: number;
  /** 该维度缺失（score=0）时的中文引导。 */
  missingHint: string;
  score: (n: EntityNode) => { score: number; detail: string };
}

const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

const DIMENSIONS: DimSpec[] = [
  {
    key: "properties",
    label: "属性",
    weight: 0.2,
    missingHint: "未定义属性",
    score: (n) => {
      const count = n.modeling.properties?.length ?? 0;
      return { score: clamp(count * 34), detail: `${count} 个属性` };
    },
  },
  {
    key: "primaryKey",
    label: "主键映射",
    weight: 0.2,
    missingHint: "缺主键映射",
    score: (n) => {
      const pk = n.modeling.primaryKey?.trim();
      if (!pk) return { score: 0, detail: "无主键" };
      const mapped = (n.processing?.mappings ?? []).some((m) => m.isPrimaryKey);
      return mapped ? { score: 100, detail: `主键 ${pk}（已映射）` } : { score: 60, detail: `主键 ${pk}（未映射数据源）` };
    },
  },
  {
    key: "dataSource",
    label: "数据源",
    weight: 0.15,
    missingHint: "未配数据源",
    score: (n) => {
      const ds = n.dataSource;
      if (ds && (ds.rawDatasetId || ds.connId)) return { score: 100, detail: "已绑定数据源" };
      if ((n.processing?.mappings?.length ?? 0) > 0) return { score: 50, detail: "有数据处理，未显式绑定源" };
      return { score: 0, detail: "无数据源" };
    },
  },
  {
    key: "stateVariables",
    label: "状态变量",
    weight: 0.15,
    missingHint: "无状态变量",
    score: (n) => {
      const count = n.modeling.stateVariables?.length ?? 0;
      return { score: clamp(count * 50), detail: `${count} 个状态变量` };
    },
  },
  {
    key: "actions",
    label: "行动",
    weight: 0.1,
    missingHint: "未绑定行动",
    score: (n) => {
      const count = n.modeling.actions?.length ?? 0;
      return { score: count > 0 ? 100 : 0, detail: `${count} 个行动` };
    },
  },
  {
    key: "derived",
    label: "派生",
    weight: 0.1,
    missingHint: "无派生属性",
    score: (n) => {
      const count = n.modeling.derived?.length ?? 0;
      return { score: clamp(count * 50), detail: `${count} 个派生属性` };
    },
  },
  {
    key: "storageMode",
    label: "存储模式",
    weight: 0.1,
    missingHint: "未提升为本体图谱(storageMode=STATIC)",
    score: (n) => (n.storageMode === "ONTOLOGY" ? { score: 100, detail: "本体图谱" } : { score: 0, detail: "静态图谱" }),
  },
];

function grade(score: number): ReadinessGrade {
  if (score >= 75) return "READY";
  if (score >= 40) return "DEVELOPING";
  return "NASCENT";
}

function scoreEntity(n: EntityNode): EntityReadiness {
  const dimensions: ReadinessDimension[] = [];
  const missing: string[] = [];
  let weighted = 0;
  for (const spec of DIMENSIONS) {
    const { score, detail } = spec.score(n);
    dimensions.push({ key: spec.key, label: spec.label, score, weight: spec.weight, detail });
    weighted += score * spec.weight;
    if (score === 0) missing.push(spec.missingHint);
  }
  const score = clamp(weighted);
  return {
    nodeId: n.id,
    typeKey: n.modeling.typeKey,
    storageMode: n.storageMode === "ONTOLOGY" ? "ONTOLOGY" : "STATIC",
    score,
    grade: grade(score),
    dimensions,
    missing,
  };
}

/** 计算工作流准备度（各实体 breakdown + 整体分/等级）。 */
export function computeReadiness(wf: OntologyWorkflow): ReadinessResult {
  const entities = wf.nodes
    .filter((n): n is EntityNode => n.kind === "SUBGRAPH_ENTITY")
    .map(scoreEntity);
  const overall = entities.length
    ? clamp(entities.reduce((s, e) => s + e.score, 0) / entities.length)
    : 0;
  return { overall, grade: grade(overall), entities };
}
