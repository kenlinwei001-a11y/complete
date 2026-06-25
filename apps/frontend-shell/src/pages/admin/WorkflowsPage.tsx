import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PlanStep, WorkflowDefinition } from "@platform/contracts";
import {
  fetchAgents,
  fetchRules,
  fetchSolverRegistry,
  fetchWorkflows,
  publishWorkflow,
  runWorkflow,
  saveWorkflow,
  type WorkflowRunResult,
} from "@/api/endpoints";
import { ApiClientError } from "@/api/apiClient";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { filterSuggestions, templateSuggestions } from "./templateSuggest";
import styles from "./WorkflowsPage.module.css";

const t = zh.admin.workflows;

const STEP_TYPES = [
  "resolve_slice",
  "query_objects",
  "invoke_solver",
  "evaluate_rules",
  "llm_compose",
  "render_answer",
  "create_action_draft",
  "invoke_agent",
  "invoke_mcp_tool",
] as const;

function defaultStep(type: (typeof STEP_TYPES)[number], id: string): PlanStep {
  switch (type) {
    case "resolve_slice":
      return { id, type, params: { sliceKey: "", args: {} } };
    case "query_objects":
      return { id, type, params: { objectType: "", filter: {} } };
    case "invoke_solver":
      return { id, type, params: { solverKey: "", args: {} } };
    case "evaluate_rules":
      return { id, type, params: { ruleIds: "ALL_APPLICABLE", payload: null } };
    case "llm_compose":
      return { id, type, params: { instruction: "", inputs: [] } };
    case "render_answer":
      return { id, type, params: { blocks: [] } };
    case "create_action_draft":
      return { id, type, params: { actionType: "", payload: {} } };
    case "invoke_agent":
      return { id, type, params: { agentId: "", version: "latest", prompt: "" } };
    case "invoke_mcp_tool":
      return { id, type, params: { mcpConfigId: "", toolName: "", args: {} } };
  }
}

/** Workflow 步骤列表编辑器（PRD §7.8）：上下移/增删 + TemplateValue 自动补全 + 发布错误定位到步骤行 */
export default function WorkflowsPage() {
  const queryClient = useQueryClient();
  const { data: workflows } = useQuery({ queryKey: ["b", "workflows", {}], queryFn: fetchWorkflows });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workflows?.find((w) => w.id === selectedId) ?? workflows?.[0];

  // G-4：自助创建工作流（消"无创建入口"死路）。骨架=query_objects→render_answer，DRAFT。
  const createMut = useMutation({
    mutationFn: () =>
      saveWorkflow(null, {
        key: `wf_${Date.now()}`,
        name: "新工作流（模板预填）",
        inputs: { type: "object", properties: {} },
        steps: [
          { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "（模板）请编辑步骤" }] } },
        ],
      }),
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: ["b", "workflows"] });
      setSelectedId(wf.id);
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={selected?.id ?? ""} aria-label="选择 workflow" onChange={(e) => setSelectedId(e.target.value)}>
          {(workflows ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} v{w.version} · {w.status}
            </option>
          ))}
        </select>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="workflow-create">
          ＋新建工作流
        </button>
      </div>
      {selected && (
        <WorkflowEditor key={selected.id} workflow={selected} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["b", "workflows"] })} />
      )}
    </div>
  );
}

/** C6 引用控件数据源（求解器目录 / Agent 库 / 规则库）：填充 invoke_solver/invoke_agent/evaluate_rules 引用下拉。 */
export interface StepRefData {
  solvers: { value: string; label: string }[];
  agents: { value: string; label: string }[];
  rules: { value: string; label: string }[];
}

function WorkflowEditor({ workflow, onChanged }: { workflow: WorkflowDefinition; onChanged: () => void }) {
  const [steps, setSteps] = useState<PlanStep[]>(workflow.steps);
  const [errors, setErrors] = useState<{ stepId?: string; code: string; message: string }[]>([]);
  // 引用模式增量 §2.3：破坏性变更门禁（BREAKING_CHANGE_WITH_LATEST_REFS → 提示 force）
  const [breaking, setBreaking] = useState<string | null>(null);
  const editable = workflow.status === "DRAFT";

  // C6 引用控件数据源（求解器目录/Agent 库/规则库）。
  const { data: solverReg } = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry() });
  const { data: agents } = useQuery({ queryKey: ["b", "agents"], queryFn: fetchAgents });
  const { data: rules } = useQuery({ queryKey: ["a", "rules"], queryFn: fetchRules });
  const refData: StepRefData = useMemo(
    () => ({
      solvers: (solverReg?.solvers ?? []).map((s) => ({ value: s.key, label: `${s.name}（${s.key}）` })),
      agents: (agents ?? []).map((a) => ({ value: a.id, label: `${a.name} v${a.version}` })),
      rules: (rules ?? []).map((r) => ({ value: r.id, label: `${r.name}（${r.key}）` })),
    }),
    [solverReg, agents, rules],
  );

  // C8 试运行（编辑器内所见即所得）：先存当前 steps 再调既有同步 run 端点。
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const runMut = useMutation({
    mutationFn: async () => {
      await saveWorkflow(workflow.id, { steps });
      return runWorkflow(workflow.id, {});
    },
    onSuccess: (r) => {
      setRunResult(r);
      if (r.status === "COMPLETED") toast("试运行完成", "success");
      else toast(`试运行失败：${r.error?.code ?? "FAILED"}`, "error");
    },
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => saveWorkflow(workflow.id, { steps }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });

  const publishMut = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      await saveWorkflow(workflow.id, { steps });
      return publishWorkflow(workflow.id, { force });
    },
    onSuccess: (r) => {
      if (r.ok) {
        setErrors([]);
        setBreaking(null);
        const n = r.impact?.refs.length ?? 0;
        toast(`发布并立即生效于 ${n} 个引用方 · 约 1 分钟内对所有引用方生效${r.forced ? "（force 已审计）" : ""}`, "success");
        onChanged();
      } else {
        setErrors(r.errors ?? []);
      }
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "BREAKING_CHANGE_WITH_LATEST_REFS") {
        setBreaking(e.message);
        return;
      }
      toastError(e);
    },
  });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    setSteps(next);
  };

  const globalErrors = errors.filter((e) => !e.stepId);

  return (
    <div className="panel" data-testid="workflow-editor">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <strong>{workflow.name}</strong>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>
          v{workflow.version} · {workflow.status}
        </span>
        {editable && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="btn sm" disabled={runMut.isPending} onClick={() => runMut.mutate()} data-testid="wf-dry-run">
              {runMut.isPending ? "试运行中…" : "试运行"}
            </button>
            <button className="btn sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {zh.common.save}
            </button>
            <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate({ force: false })} data-testid="wf-publish">
              {zh.common.publish}
            </button>
          </div>
        )}
      </div>

      {runResult && <DryRunResult result={runResult} onClose={() => setRunResult(null)} />}

      {breaking && (
        <div className="panel" style={{ borderColor: "var(--danger)", marginBottom: 8 }} data-testid="wf-breaking-gate">
          <div className="badge red" style={{ marginBottom: 6 }}>BREAKING_CHANGE_WITH_LATEST_REFS</div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{breaking}</p>
          <button className="btn danger sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate({ force: true })} data-testid="wf-force-publish">
            强制发布（force=true · catalog_admin · 全审计）
          </button>
        </div>
      )}
      {globalErrors.map((e, i) => (
        <div key={i} className="badge red" style={{ marginBottom: 6 }} data-testid="wf-global-error">
          {e.code}: {e.message}
        </div>
      ))}

      {steps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          index={i}
          steps={steps}
          inputs={workflow.inputs}
          editable={editable}
          refData={refData}
          errors={errors.filter((e) => e.stepId === step.id)}
          onChange={(s) => setSteps(steps.map((x, j) => (j === i ? s : x)))}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
          onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
        />
      ))}

      {editable && (
        <AddStep
          onAdd={(type) => {
            const id = `s${steps.length + 1}_${Math.random().toString(36).slice(2, 6)}`;
            setSteps([...steps, defaultStep(type, id)]);
          }}
        />
      )}
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (type: (typeof STEP_TYPES)[number]) => void }) {
  const [type, setType] = useState<(typeof STEP_TYPES)[number]>("query_objects");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <select value={type} aria-label="步骤类型" onChange={(e) => setType(e.target.value as typeof type)}>
        {STEP_TYPES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button className="btn sm" onClick={() => onAdd(type)} data-testid="wf-add-step">
        {t.addStep}
      </button>
    </div>
  );
}

function StepRow({
  step,
  index,
  steps,
  inputs,
  editable,
  refData,
  errors,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: PlanStep;
  index: number;
  steps: PlanStep[];
  inputs: Record<string, unknown>;
  editable: boolean;
  refData: StepRefData;
  errors: { code: string; message: string }[];
  onChange: (s: PlanStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const suggestions = useMemo(() => templateSuggestions(inputs, steps, index), [inputs, steps, index]);
  const hasError = errors.length > 0;

  return (
    <div className={`${styles.stepRow} ${hasError ? styles.stepError : ""}`} data-testid={`wf-step-${step.id}`}>
      <div className={styles.stepHead}>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>
          #{index + 1}
        </span>
        <span className="badge blue">{step.type}</span>
        <span className="mono" style={{ fontSize: 11 }}>
          {step.id}
        </span>
        {editable && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button className="btn sm" onClick={onMoveUp} aria-label={`${t.moveUp} ${step.id}`}>
              ↑
            </button>
            <button className="btn sm" onClick={onMoveDown} aria-label={`${t.moveDown} ${step.id}`}>
              ↓
            </button>
            <button className="btn sm danger" onClick={onRemove} aria-label={`删除 ${step.id}`}>
              ✕
            </button>
          </span>
        )}
      </div>
      <StepParams step={step} editable={editable} suggestions={suggestions} refData={refData} onChange={onChange} />
      {errors.map((e, i) => (
        <div key={i} className="badge red" style={{ marginTop: 6 }} data-testid={`wf-step-error-${step.id}`}>
          {e.code}: {e.message}
        </div>
      ))}
    </div>
  );
}

/** 每种 step type 一个参数表单（关键 TemplateValue 字段使用补全输入框；C6 资源字段用引用下拉） */
function StepParams({
  step,
  editable,
  suggestions,
  refData,
  onChange,
}: {
  step: PlanStep;
  editable: boolean;
  suggestions: string[];
  refData: StepRefData;
  onChange: (s: PlanStep) => void;
}) {
  const p = step.params as Record<string, unknown>;
  const setParam = (k: string, v: unknown) => onChange({ ...step, params: { ...p, [k]: v } } as PlanStep);

  // C6：solverKey/agentId 改引用下拉（带＋新建/查看/空态有路），从 fields 排除以免重复渲染。
  // C8：render_answer blocks 改可视编排（D-28 禁裸 JSON）。
  const refKeys = new Set<string>();
  if (step.type === "invoke_solver") refKeys.add("solverKey");
  if (step.type === "invoke_agent") refKeys.add("agentId");

  const fields: { key: string; label: string; template?: boolean; json?: boolean }[] = (() => {
    switch (step.type) {
      case "resolve_slice":
        return [
          { key: "sliceKey", label: "sliceKey" },
          { key: "args", label: "args", template: true, json: true },
        ];
      case "query_objects":
        return [
          { key: "objectType", label: "objectType" },
          { key: "filter", label: "filter", template: true, json: true },
        ];
      case "invoke_solver":
        return [
          { key: "solverKey", label: "solverKey" },
          { key: "args", label: "args", template: true, json: true },
        ];
      case "evaluate_rules":
        return [
          { key: "ruleIds", label: "ruleIds", json: true },
          { key: "payload", label: "payload", template: true, json: true },
        ];
      case "llm_compose":
        return [
          { key: "instruction", label: "instruction" },
          { key: "inputs", label: "inputs", template: true, json: true },
        ];
      case "render_answer":
        return [{ key: "blocks", label: "blocks", template: true, json: true }];
      case "create_action_draft":
        return [
          { key: "actionType", label: "actionType" },
          { key: "payload", label: "payload", template: true, json: true },
        ];
      case "invoke_agent":
        return [
          { key: "agentId", label: "agentId" },
          { key: "prompt", label: "prompt", template: true },
        ];
      case "invoke_mcp_tool":
        return [
          { key: "mcpConfigId", label: "mcpConfigId" },
          { key: "toolName", label: "toolName" },
          { key: "args", label: "args", template: true, json: true },
        ];
      default:
        return [];
    }
  })();

  const renderAnswer = step.type === "render_answer";

  return (
    <div className={styles.params}>
      {/* C6：求解器/Agent 引用下拉（三态闭合） */}
      {step.type === "invoke_solver" && (
        <ReferenceSelect
          label="solverKey"
          value={String(p.solverKey ?? "")}
          disabled={!editable}
          options={refData.solvers}
          targetPath="admin/solvers"
          targetLabel="求解器目录"
          emptyText="尚无可见求解器，点击查看目录"
          testid={`wf-solver-select-${step.id}`}
          onChange={(v) => setParam("solverKey", v)}
        />
      )}
      {step.type === "invoke_agent" && (
        <ReferenceSelect
          label="agentId"
          value={String(p.agentId ?? "")}
          disabled={!editable}
          options={refData.agents}
          targetPath="admin/agents"
          targetLabel="Agent"
          emptyText="尚无 Agent，点击创建"
          testid={`wf-agent-select-${step.id}`}
          onChange={(v) => setParam("agentId", v)}
        />
      )}
      {/* C8：render_answer 可视 block 编排（D-28 禁裸 JSON） */}
      {renderAnswer ? (
        <RenderBlocksEditor
          blocks={Array.isArray(p.blocks) ? (p.blocks as RenderBlock[]) : []}
          editable={editable}
          suggestions={suggestions}
          stepId={step.id}
          onChange={(b) => setParam("blocks", b)}
        />
      ) : (
        fields
          .filter((f) => !refKeys.has(f.key))
          .map((f) => (
            <ParamField
              key={f.key}
              field={f}
              initial={f.json ? JSON.stringify(p[f.key] ?? null) : String(p[f.key] ?? "")}
              editable={editable}
              suggestions={suggestions}
              stepId={step.id}
              onCommit={(text) => {
                if (f.json) {
                  try {
                    setParam(f.key, JSON.parse(text));
                  } catch {
                    setParam(f.key, text);
                  }
                } else {
                  setParam(f.key, text);
                }
              }}
            />
          ))
      )}
    </div>
  );
}

/** render_answer block 类型（QOS-PRD §4.2）：可视编排支持的 block 种类。 */
type RenderBlock = { type: string; [k: string]: unknown };
const BLOCK_TYPES = ["text", "table", "kpi", "rule_violation", "action_draft"] as const;
/** 各 block 类型主值字段（绑定 {{steps.*}}）。 */
const BLOCK_MAIN_FIELD: Record<string, { key: string; label: string }> = {
  text: { key: "markdown", label: "markdown（支持 {{steps.x.output.path}}）" },
  table: { key: "rows", label: "rows 绑定（{{steps.x.output.rows}}）" },
  kpi: { key: "value", label: "value 绑定（{{steps.x.output.value}}）" },
  rule_violation: { key: "evaluations", label: "evaluations 绑定（{{steps.x.output.evaluatedRules}}）" },
  action_draft: { key: "draft", label: "draft 绑定（{{steps.x.output.draft}}）" },
};

/**
 * C8 render_answer 可视 block 编排（addendum §3.3 · D-28）：增删 block + 选类型 + 主值绑定 {{steps.*}}，
 * 替代裸 JSON 文本框。底层仍存为 blocks 数组（与既有执行引擎契约一致）。
 */
function RenderBlocksEditor({
  blocks,
  editable,
  suggestions,
  stepId,
  onChange,
}: {
  blocks: RenderBlock[];
  editable: boolean;
  suggestions: string[];
  stepId: string;
  onChange: (b: RenderBlock[]) => void;
}) {
  const setBlock = (i: number, patch: Partial<RenderBlock>) =>
    onChange(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBlock = () => onChange([...blocks, { type: "text", markdown: "" }]);
  const removeBlock = (i: number) => onChange(blocks.filter((_, j) => j !== i));

  return (
    <div data-testid={`wf-render-blocks-${stepId}`} style={{ width: "100%" }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        render_answer 可视编排（增删 block · 主值绑定 {"{{steps.*}}"}）
      </div>
      {blocks.length === 0 && <div className="empty-state" style={{ marginBottom: 6 }}>暂无 block，点击下方添加</div>}
      {blocks.map((b, i) => {
        const main = BLOCK_MAIN_FIELD[String(b.type)] ?? BLOCK_MAIN_FIELD.text!;
        return (
          <div key={i} className="panel" style={{ marginBottom: 6, padding: 8 }} data-testid={`wf-block-${stepId}-${i}`}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 11 }}>#{i + 1}</span>
              <select
                aria-label={`block ${i} 类型`}
                data-testid={`wf-block-type-${stepId}-${i}`}
                value={String(b.type)}
                disabled={!editable}
                onChange={(e) => setBlock(i, { type: e.target.value })}
              >
                {BLOCK_TYPES.map((bt) => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
              {editable && (
                <button className="btn sm danger" style={{ marginLeft: "auto" }} onClick={() => removeBlock(i)} aria-label={`删除 block ${i}`}>
                  ✕
                </button>
              )}
            </div>
            <TemplateInput
              label={main.label}
              value={typeof b[main.key] === "string" ? (b[main.key] as string) : b[main.key] != null ? JSON.stringify(b[main.key]) : ""}
              disabled={!editable}
              suggestions={suggestions}
              onChange={(v) => setBlock(i, { [main.key]: v })}
              stepId={`${stepId}-block-${i}`}
            />
          </div>
        );
      })}
      {editable && (
        <button className="btn sm" onClick={addBlock} data-testid={`wf-block-add-${stepId}`}>
          ＋添加 block
        </button>
      )}
    </div>
  );
}

/** C8 试运行结果面板（步骤输出时间线 + 渲染结果）。 */
function DryRunResult({ result, onClose }: { result: WorkflowRunResult; onClose: () => void }) {
  const steps = Object.entries(result.stepOutputs ?? {});
  return (
    <div className="panel" style={{ marginBottom: 10, borderColor: result.status === "COMPLETED" ? "var(--ok)" : "var(--danger)" }} data-testid="wf-dry-run-result">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className={`badge ${result.status === "COMPLETED" ? "green" : "red"}`}>{result.status}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>{result.runId}</span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose}>关闭</button>
      </div>
      {result.error && (
        <div className="badge red" style={{ marginBottom: 8 }} data-testid="wf-dry-run-error">
          {result.error.code}{result.error.stepId ? `@${result.error.stepId}` : ""}: {result.error.message}
        </div>
      )}
      <div className="section-title">步骤输出时间线</div>
      {steps.length === 0 ? (
        <div className="muted" style={{ fontSize: 11 }}>（无步骤输出）</div>
      ) : (
        <ol style={{ fontSize: 11, paddingLeft: 18 }}>
          {steps.map(([sid, out]) => (
            <li key={sid} data-testid={`wf-dry-run-step-${sid}`} style={{ marginBottom: 4 }}>
              <span className="mono">{sid}</span>：
              <span className="muted">{JSON.stringify(out).slice(0, 160)}</span>
            </li>
          ))}
        </ol>
      )}
      {result.answer && (
        <>
          <div className="section-title">渲染结果（render_answer）</div>
          <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto", background: "var(--panel2,#1112)", padding: 8 }} data-testid="wf-dry-run-answer">
            {JSON.stringify(result.answer, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

/** 参数字段：本地保留原始文本（避免 JSON round-trip 干扰输入），提交时再解析 */
function ParamField({
  field,
  initial,
  editable,
  suggestions,
  stepId,
  onCommit,
}: {
  field: { key: string; label: string; template?: boolean; json?: boolean };
  initial: string;
  editable: boolean;
  suggestions: string[];
  stepId: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const apply = (v: string) => {
    setText(v);
    onCommit(v);
  };
  return field.template ? (
    <TemplateInput label={field.label} value={text} disabled={!editable} suggestions={suggestions} onChange={apply} stepId={stepId} />
  ) : (
    <label className={styles.paramLabel}>
      {field.label}
      <input value={text} disabled={!editable} aria-label={`${stepId}-${field.key}`} onChange={(e) => apply(e.target.value)} />
    </label>
  );
}

/**
 * C6 引用控件三态（addendum §2 · D-27）：选择 + 查看（跳目标）+ ＋新建（跳目标创作页）+ 空态有路。
 * 数据源为引用目标资源列表；空列表显示"尚无{资源}，点击创建"而非死下拉。
 */
function ReferenceSelect({
  label,
  value,
  disabled,
  options,
  targetPath,
  targetLabel,
  emptyText,
  testid,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  /** 目标资源创作/发现页路径（＋新建 / 查看 跳转） */
  targetPath: string;
  targetLabel: string;
  emptyText: string;
  testid: string;
  onChange: (v: string) => void;
}) {
  const hasOptions = options.length > 0;
  return (
    <label className={styles.paramLabel} style={{ minWidth: 220 }}>
      {label}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {hasOptions ? (
          <select
            data-testid={testid}
            value={value}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">（未选）</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Link to={`/${targetPath}`} data-testid={`${testid}-empty`} className="badge amber" style={{ flex: 1, textDecoration: "none" }}>
            {emptyText} →
          </Link>
        )}
        {/* 查看已选（跳目标详情/发现页，带返回锚点由路由保留） */}
        {value && (
          <Link to={`/${targetPath}`} data-testid={`${testid}-view`} title={`查看${targetLabel}`} className="btn sm" style={{ textDecoration: "none" }}>
            查看
          </Link>
        )}
        {/* ＋新建（跳目标创作页） */}
        {!disabled && (
          <Link to={`/${targetPath}`} data-testid={`${testid}-new`} title={`新建${targetLabel}`} className="btn sm" style={{ textDecoration: "none" }}>
            ＋
          </Link>
        )}
      </div>
    </label>
  );
}

/** TemplateValue 输入框：输入 {{ 触发补全（只提示已声明 slots 与前序步骤） */
export function TemplateInput({
  label,
  value,
  disabled,
  suggestions,
  onChange,
  stepId,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  suggestions: string[];
  onChange: (v: string) => void;
  stepId: string;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (text: string) => {
    onChange(text);
    const caret = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const m = /\{\{([\w.]*)$/.exec(before);
    if (m) {
      setToken(m[1] ?? "");
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const pick = (s: string) => {
    const caret = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/\{\{[\w.]*$/, "");
    const after = value.slice(caret);
    onChange(before + s + after);
    setOpen(false);
  };

  const filtered = filterSuggestions(suggestions, token);

  return (
    <label className={styles.paramLabel} style={{ position: "relative" }}>
      {label}
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        aria-label={`${stepId}-${label}`}
        data-testid={`tpl-input-${stepId}-${label}`}
        onChange={(e) => update(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <ul className={styles.suggest} data-testid={`tpl-suggest-${stepId}`} role="listbox">
          {filtered.map((s) => (
            <li key={s}>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
