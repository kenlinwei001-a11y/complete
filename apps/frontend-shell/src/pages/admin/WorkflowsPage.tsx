import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlanStep, WorkflowDefinition } from "@platform/contracts";
import { fetchWorkflows, publishWorkflow, saveWorkflow } from "@/api/endpoints";
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
      </div>
      {selected && (
        <WorkflowEditor key={selected.id} workflow={selected} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["b", "workflows"] })} />
      )}
    </div>
  );
}

function WorkflowEditor({ workflow, onChanged }: { workflow: WorkflowDefinition; onChanged: () => void }) {
  const [steps, setSteps] = useState<PlanStep[]>(workflow.steps);
  const [errors, setErrors] = useState<{ stepId?: string; code: string; message: string }[]>([]);
  const editable = workflow.status === "DRAFT";

  const saveMut = useMutation({
    mutationFn: () => saveWorkflow(workflow.id, { steps }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      await saveWorkflow(workflow.id, { steps });
      return publishWorkflow(workflow.id);
    },
    onSuccess: (r) => {
      if (r.ok) {
        setErrors([]);
        toast("发布成功", "success");
        onChanged();
      } else {
        setErrors(r.errors ?? []);
      }
    },
    onError: toastError,
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
            <button className="btn sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {zh.common.save}
            </button>
            <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()} data-testid="wf-publish">
              {zh.common.publish}
            </button>
          </div>
        )}
      </div>

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
      <StepParams step={step} editable={editable} suggestions={suggestions} onChange={onChange} />
      {errors.map((e, i) => (
        <div key={i} className="badge red" style={{ marginTop: 6 }} data-testid={`wf-step-error-${step.id}`}>
          {e.code}: {e.message}
        </div>
      ))}
    </div>
  );
}

/** 每种 step type 一个参数表单（关键 TemplateValue 字段使用补全输入框） */
function StepParams({
  step,
  editable,
  suggestions,
  onChange,
}: {
  step: PlanStep;
  editable: boolean;
  suggestions: string[];
  onChange: (s: PlanStep) => void;
}) {
  const p = step.params as Record<string, unknown>;
  const setParam = (k: string, v: unknown) => onChange({ ...step, params: { ...p, [k]: v } } as PlanStep);

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

  return (
    <div className={styles.params}>
      {fields.map((f) => (
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
      ))}
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
