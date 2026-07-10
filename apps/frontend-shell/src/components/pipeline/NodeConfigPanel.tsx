import { useState } from "react";
import type {
  WfNode,
  WfAggFn,
  ProcessingSpec,
  AttributeMapping,
  MaskRule,
  FnDef,
} from "@platform/contracts";
import { NODE_KIND_META, nodeDisplayName } from "./WorkflowCanvas";
import styles from "./pipeline.module.css";

const DATA_TYPES = ["String", "Double", "Int", "Boolean", "Date", "Json"] as const;
const AGG_FNS: WfAggFn[] = ["Last", "First", "Sum", "Max", "Min", "Avg", "Count"];
const MASK_STRATS = ["HASH", "REDACT", "PARTIAL"] as const;

export interface NodeConfigPanelProps {
  node: WfNode;
  onChange: (node: WfNode) => void;
  /** 提升 STATIC→ONTOLOGY（仅 SUBGRAPH_ENTITY 有意义）。 */
  onPromote: () => void;
  promoting?: boolean;
  rawDatasets: { id: string; name: string }[];
  /** 上传文件 → rawDatasetId（数据源页签）。 */
  onUpload?: (file: File) => void;
}

/** 右侧逐节点配置面板（PRD v2 §7）：存储模式 + 提升 + 实体三页签 / 其它节点简易编辑。 */
export function NodeConfigPanel({ node, onChange, onPromote, promoting, rawDatasets, onUpload }: NodeConfigPanelProps) {
  const meta = NODE_KIND_META[node.kind];
  return (
    <aside className={styles.configPanel} data-testid="node-config-panel" data-kind={node.kind}>
      <div className={styles.configHead}>
        <span className={styles.configKindDot} style={{ background: meta.color }} />
        <strong>{nodeDisplayName(node)}</strong>
        <span className="badge">{meta.label}</span>
      </div>

      {(node.kind === "SUBGRAPH_ENTITY" || node.kind === "SUBGRAPH_LINK") && (
        <div className={styles.storageRow}>
          <span className={styles.configLabel}>存储模式</span>
          <div className={styles.toggle} data-testid="storage-mode-toggle">
            {(["STATIC", "ONTOLOGY"] as const).map((m) => (
              <button
                key={m}
                className={`${styles.toggleBtn} ${node.storageMode === m ? styles.toggleOn : ""}`}
                data-testid={`storage-mode-${m}`}
                onClick={() => onChange({ ...node, storageMode: m })}
              >
                {m === "STATIC" ? "静态图谱" : "本体图谱"}
              </button>
            ))}
          </div>
          {node.kind === "SUBGRAPH_ENTITY" && (
            <button
              className="btn primary sm"
              data-testid="promote-btn"
              disabled={promoting || node.storageMode === "ONTOLOGY"}
              onClick={onPromote}
              style={{ marginLeft: "auto" }}
            >
              提升
            </button>
          )}
        </div>
      )}

      {node.kind === "SUBGRAPH_ENTITY" ? (
        <EntityConfig node={node} onChange={onChange} rawDatasets={rawDatasets} onUpload={onUpload} />
      ) : node.kind === "PROCESS" ? (
        <ProcessingEditor
          spec={node.spec}
          onChange={(spec) => onChange({ ...node, spec })}
        />
      ) : (
        <SpecEditor node={node} onChange={onChange} rawDatasets={rawDatasets} />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// 实体节点三页签
// ---------------------------------------------------------------------------

type EntityNode = Extract<WfNode, { kind: "SUBGRAPH_ENTITY" }>;

function EntityConfig({
  node,
  onChange,
  rawDatasets,
  onUpload,
}: {
  node: EntityNode;
  onChange: (node: WfNode) => void;
  rawDatasets: { id: string; name: string }[];
  onUpload?: (file: File) => void;
}) {
  const [tab, setTab] = useState<"source" | "process" | "modeling">("source");
  const emptyProc: ProcessingSpec = { mappings: [], mode: "BATCH" };
  return (
    <div>
      <div className={styles.tabs} data-testid="entity-tabs">
        <button className={`${styles.tab} ${tab === "source" ? styles.tabOn : ""}`} data-testid="tab-source" onClick={() => setTab("source")}>
          数据源
        </button>
        <button className={`${styles.tab} ${tab === "process" ? styles.tabOn : ""}`} data-testid="tab-process" onClick={() => setTab("process")}>
          数据处理
        </button>
        <button className={`${styles.tab} ${tab === "modeling" ? styles.tabOn : ""}`} data-testid="tab-modeling" onClick={() => setTab("modeling")}>
          子图建模
        </button>
      </div>

      {tab === "source" && (
        <div className={styles.tabBody} data-testid="tab-body-source">
          <label className={styles.field}>
            原始数据集
            <select
              value={node.dataSource?.rawDatasetId ?? ""}
              data-testid="ds-raw-dataset"
              onChange={(e) => onChange({ ...node, dataSource: { ...node.dataSource, rawDatasetId: e.target.value || undefined, role: node.dataSource?.role ?? "master" } })}
            >
              <option value="">（未选择）</option>
              {rawDatasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            角色
            <select
              value={node.dataSource?.role ?? "master"}
              data-testid="ds-role"
              onChange={(e) => onChange({ ...node, dataSource: { ...node.dataSource, role: e.target.value as "event" | "master" } })}
            >
              <option value="master">主数据 master</option>
              <option value="event">事件 event</option>
            </select>
          </label>
          <label className={styles.field}>
            上传文件（含 .xlsx）→ RawDataset
            <input
              type="file"
              data-testid="ds-upload"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && onUpload) onUpload(f);
              }}
            />
          </label>
        </div>
      )}

      {tab === "process" && (
        <div className={styles.tabBody} data-testid="tab-body-process">
          <ProcessingEditor spec={node.processing ?? emptyProc} onChange={(spec) => onChange({ ...node, processing: spec })} />
        </div>
      )}

      {tab === "modeling" && (
        <div className={styles.tabBody} data-testid="tab-body-modeling">
          <ModelingEditor node={node} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 数据处理编辑器（逐属性映射 + 分组/失效/脱敏）
// ---------------------------------------------------------------------------

function ProcessingEditor({ spec, onChange }: { spec: ProcessingSpec; onChange: (spec: ProcessingSpec) => void }) {
  const mappings = spec.mappings ?? [];
  const setMappings = (m: AttributeMapping[]) => onChange({ ...spec, mappings: m });
  const updateMapping = (i: number, patch: Partial<AttributeMapping>) =>
    setMappings(mappings.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <div>
      <div className="section-title">逐属性映射</div>
      <table className={styles.mapTable} data-testid="mapping-table">
        <thead>
          <tr>
            <th>源字段</th>
            <th>目标属性</th>
            <th>类型</th>
            <th>函数</th>
            <th>PK</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {mappings.map((m, i) => (
            <tr key={i} data-testid={`mapping-row-${i}`}>
              <td>
                <input value={m.sourceField} aria-label={`源字段 ${i}`} onChange={(e) => updateMapping(i, { sourceField: e.target.value })} />
              </td>
              <td>
                <input value={m.targetProp} aria-label={`目标属性 ${i}`} onChange={(e) => updateMapping(i, { targetProp: e.target.value })} />
              </td>
              <td>
                <select value={m.dataType} aria-label={`类型 ${i}`} onChange={(e) => updateMapping(i, { dataType: e.target.value as AttributeMapping["dataType"] })}>
                  {DATA_TYPES.map((dt) => (
                    <option key={dt}>{dt}</option>
                  ))}
                </select>
              </td>
              <td>
                <select value={m.fn} aria-label={`函数 ${i}`} onChange={(e) => updateMapping(i, { fn: e.target.value as WfAggFn })}>
                  {AGG_FNS.map((fn) => (
                    <option key={fn}>{fn}</option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" aria-label={`主键 ${i}`} checked={Boolean(m.isPrimaryKey)} onChange={(e) => updateMapping(i, { isPrimaryKey: e.target.checked })} />
              </td>
              <td>
                <input type="checkbox" aria-label={`状态变量 ${i}`} checked={Boolean(m.isStateVariable)} onChange={(e) => updateMapping(i, { isStateVariable: e.target.checked })} />
              </td>
              <td>
                <button className="btn sm danger" aria-label={`删除映射 ${i}`} onClick={() => setMappings(mappings.filter((_, idx) => idx !== i))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn sm"
        data-testid="mapping-add"
        onClick={() => setMappings([...mappings, { sourceField: "", targetProp: "", dataType: "String", fn: "Last" }])}
      >
        + 加映射
      </button>

      <div className="section-title" style={{ marginTop: 12 }}>
        分组 / 失效 / 脱敏
      </div>
      <label className={styles.field}>
        分组字段（逗号分隔）
        <input
          value={(spec.groupBy?.fields ?? []).join(",")}
          data-testid="group-by"
          onChange={(e) => {
            const fields = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ ...spec, groupBy: fields.length ? { fields, window: spec.groupBy?.window } : undefined });
          }}
        />
      </label>
      <div className={styles.inlineFields}>
        <label className={styles.field}>
          失效字段
          <input
            value={spec.expiry?.field ?? ""}
            data-testid="expiry-field"
            onChange={(e) => {
              const field = e.target.value.trim();
              onChange({ ...spec, expiry: field ? { field, ttlDays: spec.expiry?.ttlDays ?? 30 } : undefined });
            }}
          />
        </label>
        <label className={styles.field}>
          TTL 天
          <input
            type="number"
            value={spec.expiry?.ttlDays ?? 30}
            aria-label="TTL 天"
            disabled={!spec.expiry?.field}
            onChange={(e) => spec.expiry && onChange({ ...spec, expiry: { ...spec.expiry, ttlDays: Math.max(1, Number(e.target.value) || 1) } })}
          />
        </label>
      </div>
      <MaskRuleEditor
        rules={spec.masking ?? []}
        testid="processing-masking"
        onChange={(masking) => onChange({ ...spec, masking: masking.length ? masking : undefined })}
      />
    </div>
  );
}

function MaskRuleEditor({ rules, onChange, testid }: { rules: MaskRule[]; onChange: (r: MaskRule[]) => void; testid: string }) {
  return (
    <div data-testid={testid}>
      <div className={styles.subLabel}>脱敏规则</div>
      {rules.map((r, i) => (
        <div key={i} className={styles.inlineFields} data-testid={`${testid}-row-${i}`}>
          <input value={r.prop} aria-label={`脱敏属性 ${i}`} placeholder="prop" onChange={(e) => onChange(rules.map((x, idx) => (idx === i ? { ...x, prop: e.target.value } : x)))} />
          <select value={r.strategy} aria-label={`脱敏策略 ${i}`} onChange={(e) => onChange(rules.map((x, idx) => (idx === i ? { ...x, strategy: e.target.value as MaskRule["strategy"] } : x)))}>
            {MASK_STRATS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="btn sm danger" aria-label={`删除脱敏 ${i}`} onClick={() => onChange(rules.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...rules, { prop: "", strategy: "REDACT" }])}>
        + 加脱敏
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子图建模：本体构建 6 页（属性/类型/函数/行动/派生/安全）
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function ModelingEditor({ node, onChange }: { node: EntityNode; onChange: (node: WfNode) => void }) {
  const m = node.modeling;
  const set = (patch: Partial<EntityNode["modeling"]>) => onChange({ ...node, modeling: { ...m, ...patch } });
  const properties = (m.properties ?? []) as Rec[];
  const derived = (m.derived ?? []) as Rec[];
  const functions = m.functions ?? [];
  const actions = m.actions ?? [];
  const security = m.security ?? [];

  return (
    <div className={styles.facets}>
      {/* 类型 */}
      <fieldset className={styles.facet} data-testid="facet-type">
        <legend>类型</legend>
        <label className={styles.field}>
          typeKey
          <input value={m.typeKey} aria-label="typeKey" onChange={(e) => set({ typeKey: e.target.value })} />
        </label>
        <label className={styles.field}>
          显示名
          <input value={m.displayName} aria-label="显示名" onChange={(e) => set({ displayName: e.target.value })} />
        </label>
        <div className={styles.inlineFields}>
          <label className={styles.field}>
            主键
            <input value={m.primaryKey} aria-label="主键" onChange={(e) => set({ primaryKey: e.target.value })} />
          </label>
          <label className={styles.field}>
            实体类型
            <input value={m.entityType ?? ""} aria-label="实体类型" placeholder="如 人/传感器" onChange={(e) => set({ entityType: e.target.value || undefined })} />
          </label>
        </div>
      </fieldset>

      {/* 属性 */}
      <fieldset className={styles.facet} data-testid="facet-properties">
        <legend>属性</legend>
        {properties.map((p, i) => (
          <div key={i} className={styles.inlineFields} data-testid={`prop-row-${i}`}>
            <input value={String(p.propKey ?? "")} aria-label={`属性键 ${i}`} placeholder="propKey" onChange={(e) => set({ properties: properties.map((x, idx) => (idx === i ? { ...x, propKey: e.target.value } : x)) })} />
            <select value={String(p.dataType ?? "String")} aria-label={`属性类型 ${i}`} onChange={(e) => set({ properties: properties.map((x, idx) => (idx === i ? { ...x, dataType: e.target.value } : x)) })}>
              {DATA_TYPES.map((dt) => (
                <option key={dt}>{dt}</option>
              ))}
            </select>
            <button className="btn sm danger" aria-label={`删除属性 ${i}`} onClick={() => set({ properties: properties.filter((_, idx) => idx !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn sm" data-testid="add-property" onClick={() => set({ properties: [...properties, { propKey: "", dataType: "String" }] })}>
          + 加属性
        </button>
      </fieldset>

      {/* 函数 */}
      <fieldset className={styles.facet} data-testid="facet-functions">
        <legend>函数</legend>
        {functions.map((f, i) => (
          <div key={i} className={styles.inlineFields} data-testid={`fn-row-${i}`}>
            <input value={f.name} aria-label={`函数名 ${i}`} placeholder="name" onChange={(e) => set({ functions: functions.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) })} />
            <input value={f.builtin ?? f.expr ?? ""} aria-label={`函数体 ${i}`} placeholder="builtin/expr" onChange={(e) => set({ functions: functions.map((x, idx) => (idx === i ? { ...x, builtin: e.target.value } : x)) })} />
            <button className="btn sm danger" aria-label={`删除函数 ${i}`} onClick={() => set({ functions: functions.filter((_, idx) => idx !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn sm" data-testid="add-function" onClick={() => set({ functions: [...functions, { name: "", returns: "Double" } as FnDef] })}>
          + 加函数
        </button>
      </fieldset>

      {/* 行动 */}
      <fieldset className={styles.facet} data-testid="facet-actions">
        <legend>行动</legend>
        {actions.map((a, i) => (
          <div key={i} className={styles.inlineFields} data-testid={`action-row-${i}`}>
            <input value={a.actionTypeKey} aria-label={`行动 ${i}`} placeholder="actionTypeKey" onChange={(e) => set({ actions: actions.map((x, idx) => (idx === i ? { actionTypeKey: e.target.value } : x)) })} />
            <button className="btn sm danger" aria-label={`删除行动 ${i}`} onClick={() => set({ actions: actions.filter((_, idx) => idx !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn sm" data-testid="add-action" onClick={() => set({ actions: [...actions, { actionTypeKey: "" }] })}>
          + 加行动
        </button>
      </fieldset>

      {/* 派生 */}
      <fieldset className={styles.facet} data-testid="facet-derived">
        <legend>派生</legend>
        {derived.map((d, i) => (
          <div key={i} className={styles.inlineFields} data-testid={`derived-row-${i}`}>
            <input value={String(d.propKey ?? "")} aria-label={`派生键 ${i}`} placeholder="propKey" onChange={(e) => set({ derived: derived.map((x, idx) => (idx === i ? { ...x, propKey: e.target.value } : x)) })} />
            <input value={String(d.formula ?? "")} aria-label={`派生公式 ${i}`} placeholder="formula" onChange={(e) => set({ derived: derived.map((x, idx) => (idx === i ? { ...x, formula: e.target.value } : x)) })} />
            <button className="btn sm danger" aria-label={`删除派生 ${i}`} onClick={() => set({ derived: derived.filter((_, idx) => idx !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn sm" data-testid="add-derived" onClick={() => set({ derived: [...derived, { propKey: "", formula: "" }] })}>
          + 加派生
        </button>
      </fieldset>

      {/* 安全 */}
      <fieldset className={styles.facet} data-testid="facet-security">
        <legend>安全</legend>
        <MaskRuleEditor rules={security} testid="modeling-security" onChange={(s) => set({ security: s.length ? s : undefined })} />
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 其它节点简易编辑器
// ---------------------------------------------------------------------------

function SpecEditor({ node, onChange, rawDatasets }: { node: WfNode; onChange: (node: WfNode) => void; rawDatasets: { id: string; name: string }[] }) {
  if (node.kind === "SOURCE_SELECT") {
    return (
      <div className={styles.tabBody} data-testid="spec-source-select">
        <label className={styles.field}>
          连接器 connId
          <input value={node.spec.connId ?? ""} aria-label="connId" onChange={(e) => onChange({ ...node, spec: { ...node.spec, connId: e.target.value || undefined } })} />
        </label>
        <label className={styles.field}>
          数据集名
          <input value={node.spec.datasetName ?? ""} aria-label="datasetName" onChange={(e) => onChange({ ...node, spec: { ...node.spec, datasetName: e.target.value || undefined } })} />
        </label>
      </div>
    );
  }
  if (node.kind === "SOURCE_TABLE") {
    return (
      <div className={styles.tabBody} data-testid="spec-source-table">
        <label className={styles.field}>
          RawDataset
          <select value={node.spec.rawDatasetId} aria-label="rawDatasetId" onChange={(e) => onChange({ ...node, spec: { ...node.spec, rawDatasetId: e.target.value } })}>
            <option value="">（未选择）</option>
            {rawDatasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          角色
          <select value={node.spec.role} aria-label="role" onChange={(e) => onChange({ ...node, spec: { ...node.spec, role: e.target.value as "event" | "master" } })}>
            <option value="master">master</option>
            <option value="event">event</option>
          </select>
        </label>
      </div>
    );
  }
  if (node.kind === "SUBGRAPH_LINK") {
    return (
      <div className={styles.tabBody} data-testid="spec-link">
        <label className={styles.field}>
          linkKey
          <input value={node.spec.linkKey} aria-label="linkKey" onChange={(e) => onChange({ ...node, spec: { ...node.spec, linkKey: e.target.value } })} />
        </label>
        <div className={styles.inlineFields}>
          <label className={styles.field}>
            from
            <input value={node.spec.fromTypeKey} aria-label="fromTypeKey" onChange={(e) => onChange({ ...node, spec: { ...node.spec, fromTypeKey: e.target.value } })} />
          </label>
          <label className={styles.field}>
            to
            <input value={node.spec.toTypeKey} aria-label="toTypeKey" onChange={(e) => onChange({ ...node, spec: { ...node.spec, toTypeKey: e.target.value } })} />
          </label>
        </div>
        <label className={styles.field}>
          基数
          <select value={node.spec.cardinality} aria-label="cardinality" onChange={(e) => onChange({ ...node, spec: { ...node.spec, cardinality: e.target.value as "1:1" | "1:N" | "N:N" } })}>
            {["1:1", "1:N", "N:N"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (node.kind === "ONTOLOGY_SINK") {
    return (
      <div className={styles.tabBody} data-testid="spec-sink">
        <label className={styles.field}>
          本体域
          <input value={node.spec.ontologyDomain ?? ""} aria-label="ontologyDomain" onChange={(e) => onChange({ ...node, spec: { ...node.spec, ontologyDomain: e.target.value || undefined } })} />
        </label>
        <label className={styles.field}>
          sliceKey
          <input value={node.spec.sliceKey ?? ""} aria-label="sliceKey" onChange={(e) => onChange({ ...node, spec: { ...node.spec, sliceKey: e.target.value || undefined } })} />
        </label>
      </div>
    );
  }
  return null;
}

export default NodeConfigPanel;
