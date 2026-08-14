import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LLM_PURPOSES,
  LLM_VENDOR_CATALOG,
  PURPOSE_CAPABILITY_REQUIREMENTS,
  type LlmProvider,
  type LlmPurpose,
  type PurposeBinding,
} from "@platform/contracts";
import {
  createLlmProvider,
  fetchLlmBindings,
  fetchLlmBudget,
  fetchLlmProviders,
  putLlmBindings,
  putLlmBudget,
  testLlmProvider,
  updateLlmProvider,
  type LlmProviderSaveBody,
  type LlmProviderVM,
} from "@/api/endpoints";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";

const KIND_BADGE: Record<LlmProvider["kind"], string> = {
  anthropic: "blue",
  openai_compatible: "amber",
  custom_http: "",
};

const PURPOSE_LABEL: Record<LlmPurpose, string> = {
  classifier: "意图分类（QOS）",
  agent: "Agent 工具循环（路径 B）",
  extraction: "规则文档抽取（A2）",
  modeling: "建模建议（A3）",
  template_gen: "行业模板生成（A7）",
  compose: "llm_compose 步骤",
  comprehend: "数据构建发动机·故事意图解析（接 Kimi）",
};

/**
 * /admin/llm-providers（LLM Provider 增量 §1.4，tenant_admin）：
 * Tab1 Provider 列表（kind 徽章/状态/模型数/token 用量）+ 编辑器（write-only 密钥、
 * 模型清单 + 能力勾选、连接测试、降级目标）；Tab2 用途绑定矩阵（6 用途 ×
 * provider/model 下拉，能力不满足的选项禁用并注明缺什么）。
 */
export default function LlmProvidersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"providers" | "bindings" | "budget">("providers");
  const { data: providers } = useQuery({ queryKey: ["a", "llm-providers"], queryFn: fetchLlmProviders });
  const [editing, setEditing] = useState<LlmProviderVM | "new" | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["a", "llm-providers"] });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 8 }}>
        <h2 style={{ fontSize: 16 }}>LLM Provider</h2>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`btn sm ${tab === "providers" ? "primary" : ""}`} onClick={() => setTab("providers")} data-testid="tab-providers">
            Provider
          </button>
          <button className={`btn sm ${tab === "bindings" ? "primary" : ""}`} onClick={() => setTab("bindings")} data-testid="tab-bindings">
            用途绑定矩阵
          </button>
          {/* WO-BEFE-F · OC7 成本配额：与 provider/绑定同页，因为三者是同一件事的三面
              （用哪个模型 / 谁在用 / 用了多少还能用多少）。不新开导航项 ⇒ 不动信息架构。 */}
          <button className={`btn sm ${tab === "budget" ? "primary" : ""}`} onClick={() => setTab("budget")} data-testid="tab-budget">
            成本配额
          </button>
        </div>
        {tab === "providers" && (
          <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEditing("new")} data-testid="provider-create">
            新建 Provider
          </button>
        )}
      </div>

      {tab === "providers" && (
        <div className="panel">
          <table className="cmp">
            <thead>
              <tr>
                <th>名称</th>
                <th>kind</th>
                <th>状态</th>
                <th>模型数</th>
                <th>近 7 日 token 用量</th>
                <th>密钥</th>
                <th>降级目标</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(providers ?? []).map((p) => (
                <tr key={p.id} data-testid={`provider-${p.id}`}>
                  <td className="zh">{p.name}</td>
                  <td>
                    <span className={`badge ${KIND_BADGE[p.kind]}`} data-testid={`provider-kind-${p.id}`}>
                      {p.kind}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${p.status === "ACTIVE" ? "green" : "red"}`}>{p.status}</span>
                  </td>
                  <td>{p.models.length}</td>
                  <td className="mono">{p.usage7dTokens != null ? p.usage7dTokens.toLocaleString() : "—"}</td>
                  <td className="mono" data-testid={`provider-key-${p.id}`}>
                    {p.hasApiKey ? "••• 已配置" : "未配置"}
                  </td>
                  <td className="zh">{providers?.find((x) => x.id === p.fallbackProviderId)?.name ?? "—"}</td>
                  <td>
                    <button className="btn sm" onClick={() => setEditing(p)} data-testid={`provider-edit-${p.id}`}>
                      {zh.common.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bindings" && <BindingMatrix providers={providers ?? []} />}

      {tab === "budget" && <BudgetPanel />}

      {editing && (
        <ProviderEditor
          provider={editing === "new" ? null : editing}
          providers={providers ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
            toast("已保存 · 约 1 分钟内对所有引用方生效", "success");
          }}
        />
      )}
    </div>
  );
}

interface ModelRow {
  modelId: string;
  displayName: string;
  tools: boolean;
  structuredOutput: boolean;
  maxContext: number;
}

function ProviderEditor({
  provider,
  providers,
  onClose,
  onSaved,
}: {
  provider: LlmProviderVM | null;
  providers: LlmProviderVM[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [kind, setKind] = useState<LlmProvider["kind"]>(provider?.kind ?? "openai_compatible");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  // Phase8 厂商目录：选厂商 → 预填 kind/baseUrl + 提供型号下拉导入。
  const [vendorKey, setVendorKey] = useState("");
  const vendor = LLM_VENDOR_CATALOG.find((v) => v.key === vendorKey);
  const [pickModel, setPickModel] = useState("");
  const onPickVendor = (key: string) => {
    setVendorKey(key);
    const v = LLM_VENDOR_CATALOG.find((x) => x.key === key);
    if (v) {
      setKind(v.kind);
      setBaseUrl(v.defaultBaseUrl ?? "");
      setName((n) => n || v.displayName);
      setPickModel(v.models[0]?.modelId ?? "");
    }
  };
  const addCatalogModel = (modelId: string) => {
    const cm = vendor?.models.find((x) => x.modelId === modelId);
    if (!cm) return;
    setModels((rows) =>
      rows.some((r) => r.modelId === cm.modelId)
        ? rows
        : [...rows, { modelId: cm.modelId, displayName: cm.displayName, tools: cm.capabilities.tools, structuredOutput: cm.capabilities.structuredOutput, maxContext: cm.capabilities.maxContext }],
    );
  };
  const [status, setStatus] = useState<LlmProvider["status"]>(provider?.status ?? "ACTIVE");
  const [fallbackProviderId, setFallbackProviderId] = useState(provider?.fallbackProviderId ?? "");
  // 密钥 write-only：已配置 → 显示「••• 已配置」+「更换」；点更换才出现输入框
  const [replacingKey, setReplacingKey] = useState(!provider?.hasApiKey);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelRow[]>(
    (provider?.models ?? []).map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      tools: m.capabilities.tools,
      structuredOutput: m.capabilities.structuredOutput,
      maxContext: m.capabilities.maxContext,
    })),
  );
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; probedModels?: string[]; message?: string } | null>(null);

  const testMut = useMutation({
    mutationFn: () => testLlmProvider(provider!.id),
    onSuccess: setTestResult,
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body: LlmProviderSaveBody = {
        name,
        kind,
        baseUrl: baseUrl || undefined,
        status,
        fallbackProviderId: fallbackProviderId || undefined,
        models: models
          .filter((m) => m.modelId.trim())
          .map((m) => ({
            modelId: m.modelId.trim(),
            displayName: m.displayName || m.modelId.trim(),
            capabilities: { tools: m.tools, structuredOutput: m.structuredOutput, maxContext: m.maxContext || 128000 },
          })),
        ...(replacingKey && apiKey ? { apiKey } : {}),
      };
      return provider ? updateLlmProvider(provider.id, body) : createLlmProvider(body);
    },
    onSuccess: onSaved,
    onError: toastError,
  });

  const setModel = (i: number, patch: Partial<ModelRow>) =>
    setModels((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal title={provider ? `Provider · ${provider.name}` : "新建 Provider"} onClose={onClose} width={680}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          厂商（选后自动预填 kind/baseUrl/型号）
          <select value={vendorKey} aria-label="厂商" onChange={(e) => onPickVendor(e.target.value)} data-testid="provider-vendor-select">
            <option value="">— 自定义 —</option>
            {LLM_VENDOR_CATALOG.map((v) => (
              <option key={v.key} value={v.key}>
                {v.displayName}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          kind
          <select value={kind} aria-label="kind" onChange={(e) => setKind(e.target.value as LlmProvider["kind"])} data-testid="provider-kind-select">
            <option value="anthropic">anthropic</option>
            <option value="openai_compatible">openai_compatible</option>
            <option value="custom_http">custom_http（预留）</option>
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          名称
          <input style={{ width: "100%" }} value={name} aria-label="provider 名称" onChange={(e) => setName(e.target.value)} data-testid="provider-name-input" />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          状态
          <select value={status} aria-label="状态" onChange={(e) => setStatus(e.target.value as LlmProvider["status"])}>
            <option>ACTIVE</option>
            <option>DISABLED</option>
          </select>
        </label>
      </div>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
        baseUrl（openai_compatible 必填；anthropic 留空 = 官方端点）
        <input style={{ width: "100%" }} className="mono" value={baseUrl} aria-label="baseUrl" onChange={(e) => setBaseUrl(e.target.value)} data-testid="provider-baseurl-input" />
      </label>

      <div className="section-title">API 密钥（write-only：保存后永不回显）</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {!replacingKey ? (
          <>
            <span className="mono" data-testid="provider-key-masked">••• 已配置</span>
            <button className="btn sm" onClick={() => setReplacingKey(true)} data-testid="provider-key-replace">
              更换
            </button>
          </>
        ) : (
          <input
            style={{ flex: 1 }}
            type="password"
            placeholder="sk-…（留空 = 不修改）"
            value={apiKey}
            aria-label="API 密钥"
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="provider-key-input"
          />
        )}
      </div>

      <div className="section-title">模型清单（能力勾选）</div>
      <table className="cmp" style={{ marginBottom: 6 }}>
        <thead>
          <tr>
            <th>modelId</th>
            <th>显示名</th>
            <th>tools</th>
            <th>structuredOutput</th>
            <th>maxContext</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={i}>
              <td>
                <input className="mono" style={{ width: 160 }} value={m.modelId} aria-label={`modelId-${i}`} onChange={(e) => setModel(i, { modelId: e.target.value })} data-testid={`model-id-${i}`} />
              </td>
              <td>
                <input style={{ width: 110 }} value={m.displayName} aria-label={`显示名-${i}`} onChange={(e) => setModel(i, { displayName: e.target.value })} />
              </td>
              <td>
                <input type="checkbox" checked={m.tools} aria-label={`tools-${i}`} onChange={(e) => setModel(i, { tools: e.target.checked })} data-testid={`model-tools-${i}`} />
              </td>
              <td>
                <input type="checkbox" checked={m.structuredOutput} aria-label={`structuredOutput-${i}`} onChange={(e) => setModel(i, { structuredOutput: e.target.checked })} data-testid={`model-so-${i}`} />
              </td>
              <td>
                <input className="mono" style={{ width: 90 }} type="number" value={m.maxContext} aria-label={`maxContext-${i}`} onChange={(e) => setModel(i, { maxContext: Number(e.target.value) })} />
              </td>
              <td>
                <button className="btn danger sm" onClick={() => setModels((rows) => rows.filter((_, j) => j !== i))}>
                  删
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {vendor && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>从「{vendor.displayName}」目录添加：</span>
          <select value={pickModel} aria-label="厂商型号" onChange={(e) => setPickModel(e.target.value)} data-testid="catalog-model-select">
            {vendor.models.map((cm) => (
              <option key={cm.modelId} value={cm.modelId}>
                {cm.displayName}（{cm.modelId}）
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => addCatalogModel(pickModel)} data-testid="catalog-model-add">
            添加该型号
          </button>
          <button className="btn sm" onClick={() => vendor.models.forEach((cm) => addCatalogModel(cm.modelId))} data-testid="catalog-model-add-all">
            导入全部型号
          </button>
        </div>
      )}
      <button
        className="btn sm"
        style={{ marginBottom: 10 }}
        onClick={() => setModels((rows) => [...rows, { modelId: "", displayName: "", tools: false, structuredOutput: false, maxContext: 128000 }])}
        data-testid="model-add-row"
      >
        + 添加模型（自定义）
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          降级目标（fallback，≤1 级，禁止链式）
          <select style={{ width: "100%" }} value={fallbackProviderId} aria-label="降级目标" onChange={(e) => setFallbackProviderId(e.target.value)} data-testid="provider-fallback-select">
            <option value="">（无）</option>
            {providers
              .filter((p) => p.id !== provider?.id && !p.fallbackProviderId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {provider && (
          <button className="btn sm" disabled={testMut.isPending} onClick={() => testMut.mutate()} data-testid="provider-test-button">
            连接测试
          </button>
        )}
      </div>
      {testResult && (
        <div className={`badge ${testResult.ok ? "green" : "red"}`} style={{ marginBottom: 8 }} data-testid="provider-test-result">
          {testResult.ok
            ? `可用 · 延迟 ${testResult.latencyMs}ms${testResult.probedModels?.length ? ` · 探测到模型：${testResult.probedModels.join("、")}` : ""}`
            : `失败：${testResult.message ?? "未知错误"}${testResult.latencyMs != null ? `（${testResult.latencyMs}ms）` : ""}`}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button className="btn primary" disabled={saveMut.isPending || !name} onClick={() => saveMut.mutate()} data-testid="provider-save">
          {zh.common.save}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Tab3：OC7 成本配额（WO-BEFE-F · `GET`/`PUT /a/v1/llm-budgets`）。
 *
 * 三态与后端 `budgetStatus()`（`apps/datacore/src/app.ts:1269-1274`）一字对齐，前端**不重算**：
 * `state` / `softLimitTokens` / `degrade` 全部读后端回值 —— 自己再算一遍就会有第二个真值源，
 * 软线口径一漂移，屏上说「还没超」而路径 B 已经在降级。
 *
 * `hardLimitTokens = 0` 在后端语义是**不限**（`hard > 0 &&` 才判超），UI 必须照说，
 * 不能显示成「上限 0 ⇒ 全都超了」。
 */
function BudgetPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["a", "llm-budget"], queryFn: fetchLlmBudget });
  const [hardLimit, setHardLimit] = useState("");
  const [softPct, setSoftPct] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const hard = Number(hardLimit);
      if (!Number.isFinite(hard) || hard < 0 || !Number.isInteger(hard)) {
        throw new Error("硬线须为 ≥0 的整数 token 数（0 = 不限）");
      }
      const pct = softPct.trim() === "" ? undefined : Number(softPct) / 100;
      if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 1)) {
        throw new Error("软线百分比须在 0–100 之间");
      }
      return putLlmBudget({ hardLimitTokens: hard, ...(pct !== undefined ? { softLimitPct: pct } : {}) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["a", "llm-budget"] });
      toast("配额已更新 · 下一次 LLM 调用即按新线判定", "success");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : String(e)),
  });

  const unlimited = data != null && data.hardLimitTokens === 0;
  const pctUsed =
    data && data.hardLimitTokens > 0 ? Math.min(100, (data.usedTokens / data.hardLimitTokens) * 100) : 0;

  return (
    <div className="panel" data-testid="llm-budget-panel">
      <div className="section-title">当前用量</div>
      {isLoading ? (
        <span className="muted">加载中…</span>
      ) : !data ? (
        <span className="muted" data-testid="llm-budget-empty">
          账本不可用
          {/* 诚实位：「这次没查到」≠「没超」。状态留第一层，理由降 `?`（规范 §1）。 */}
          <InfoPopover topic={zh.admin.layer.llmLedgerTopic} testId="llm-ledger-unavailable">
            <p>{zh.admin.layer.llmLedgerBody}</p>
          </InfoPopover>
        </span>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              className={`badge ${data.state === "OK" ? "green" : data.state === "SOFT_EXCEEDED" ? "amber" : "red"}`}
              data-testid="llm-budget-state"
            >
              {data.state === "OK" ? "正常" : data.state === "SOFT_EXCEEDED" ? "已过软线" : "已过硬线"}
            </span>
            {data.degrade && (
              <span className="muted" style={{ fontSize: 12 }} data-testid="llm-budget-degrade">
                ⚠ 已触发降级
                {/* 「降级了」是状态，留第一层；「降级具体做什么」是口径，降 `?`。 */}
                <InfoPopover topic={zh.admin.layer.llmDegradeTopic} testId="llm-degrade">
                  <p>{zh.admin.layer.llmDegradeBody}</p>
                  <p>过硬线则直接拒绝。</p>
                </InfoPopover>
              </span>
            )}
          </div>
          <table className="cmp" style={{ width: "100%", maxWidth: 460 }}>
            <tbody>
              <tr>
                <td>已用 token</td>
                <td className="mono" data-testid="llm-budget-used">{data.usedTokens.toLocaleString()}</td>
              </tr>
              <tr>
                <td>硬线</td>
                <td className="mono" data-testid="llm-budget-hard">
                  {unlimited ? "不限" : data.hardLimitTokens.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td>软线</td>
                <td className="mono" data-testid="llm-budget-soft">
                  {unlimited ? "不限" : data.softLimitTokens.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
          {!unlimited && (
            <div
              style={{ height: 6, background: "var(--hover-tint)", borderRadius: 3, marginTop: 8, maxWidth: 460 }}
              role="progressbar"
              aria-valuenow={Math.round(pctUsed)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="配额用量"
            >
              <div
                style={{
                  height: "100%",
                  width: `${pctUsed}%`,
                  borderRadius: 3,
                  background: data.state === "OK" ? "var(--green)" : data.state === "SOFT_EXCEEDED" ? "var(--amber)" : "var(--red)",
                }}
              />
            </div>
          )}
        </>
      )}

      <div className="section-title" style={{ marginTop: 16 }}>调整配额</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        硬线 = 本周期 token 上限（<b>0 表示不限</b>）；软线 = 硬线的百分比，越线即开始降级。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          硬线（token）{" "}
          <input
            data-testid="llm-budget-hard-input"
            aria-label="硬线 token 上限"
            type="number"
            min={0}
            step={1000}
            value={hardLimit}
            placeholder={data ? String(data.hardLimitTokens) : "0"}
            onChange={(e) => setHardLimit(e.target.value)}
            style={{ width: 140 }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          软线（%）{" "}
          <input
            data-testid="llm-budget-soft-input"
            aria-label="软线百分比"
            type="number"
            min={0}
            max={100}
            value={softPct}
            placeholder="80"
            onChange={(e) => setSoftPct(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <button
          className="btn primary sm"
          data-testid="llm-budget-save"
          disabled={hardLimit.trim() === "" || save.isPending}
          onClick={() => save.mutate()}
        >
          保存配额
        </button>
      </div>
    </div>
  );
}

/** Tab2：用途绑定矩阵（6 用途 × provider/model；tools 缺失 → agent 用途选项禁用并注明）。 */
function BindingMatrix({ providers }: { providers: LlmProviderVM[] }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "llm-bindings"], queryFn: fetchLlmBindings });
  const [draft, setDraft] = useState<Record<string, { providerId: string; modelId: string; noReasoning?: boolean }>>({});

  const current = (purpose: LlmPurpose): { providerId: string; modelId: string; noReasoning?: boolean } =>
    draft[purpose] ?? data?.bindings.find((b) => b.purpose === purpose) ?? { providerId: "", modelId: "" };

  const saveMut = useMutation({
    mutationFn: () => {
      const bindings: PurposeBinding[] = LLM_PURPOSES.map((purpose) => {
        const v = current(purpose);
        return v.providerId && v.modelId
          ? { purpose, providerId: v.providerId, modelId: v.modelId, ...(v.noReasoning ? { noReasoning: true } : {}) }
          : null;
      }).filter((b): b is PurposeBinding => b !== null);
      return putLlmBindings(bindings);
    },
    onSuccess: (r) => {
      toast(`绑定已保存 · 约 1 分钟内对所有引用方生效${r.warnings.length ? `（${r.warnings.length} 条降级提示）` : ""}`, "success");
      for (const w of r.warnings) toast(`${w.purpose}: ${w.message}`, "info");
      void queryClient.invalidateQueries({ queryKey: ["a", "llm-bindings"] });
      setDraft({});
    },
    onError: toastError,
  });

  return (
    <div className="panel" data-testid="binding-matrix">
      <table className="cmp">
        <thead>
          <tr>
            <th>用途</th>
            {/* 能力要求列：口径（tools 硬性 / structuredOutput 可降级）在表头浮层里说一次，
                不再逐行重复挂在每个单元格上（规范 §2 R-UI-3 + §1「第一层只放名字」）。 */}
            <th>
              能力要求
              <InfoPopover topic={zh.admin.layer.llmCapTopic} testId="llm-cap">
                <p>{zh.admin.layer.llmCapBody}</p>
                <p>tools（硬性）：供应商不支持工具调用即不可用于该用途，没有降级路径。</p>
              </InfoPopover>
            </th>
            <th>provider</th>
            <th>model</th>
            {/* WO-HOVER-LAYER：口径从原生 `title=` 迁到 InfoPopover（规范 §2 R-UI-3）。 */}
            <th>
              关推理
              <InfoPopover topic={zh.sim.sandbox.info.llmNoReasoningTopic} testId="llm-no-reasoning" align="right">
                {zh.sim.sandbox.info.llmNoReasoningBody}
              </InfoPopover>
            </th>
          </tr>
        </thead>
        <tbody>
          {LLM_PURPOSES.map((purpose) => {
            const req = PURPOSE_CAPABILITY_REQUIREMENTS[purpose];
            const v = current(purpose);
            const provider = providers.find((p) => p.id === v.providerId);
            return (
              <tr key={purpose} data-testid={`binding-row-${purpose}`}>
                <td className="zh">
                  <span className="mono" style={{ fontSize: 12 }}>{purpose}</span> · {PURPOSE_LABEL[purpose]}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {/* 只留能力**名字**；「硬性 / 可 JSON-mode 降级」的口径在本列表头的 `?` 里。 */}
                  {[req.tools ? "tools" : null, req.structuredOutput ? "structuredOutput" : null]
                    .filter(Boolean)
                    .join(" + ") || "无"}
                </td>
                <td>
                  <select
                    value={v.providerId}
                    aria-label={`${purpose}-provider`}
                    data-testid={`binding-provider-${purpose}`}
                    onChange={(e) => setDraft((d) => ({ ...d, [purpose]: { providerId: e.target.value, modelId: "", noReasoning: v.noReasoning } }))}
                  >
                    <option value="">（未绑定 → 系统默认）</option>
                    {providers
                      .filter((p) => p.status === "ACTIVE")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select
                    value={v.modelId}
                    aria-label={`${purpose}-model`}
                    data-testid={`binding-model-${purpose}`}
                    onChange={(e) => setDraft((d) => ({ ...d, [purpose]: { providerId: v.providerId, modelId: e.target.value, noReasoning: v.noReasoning } }))}
                  >
                    <option value="">（选择模型）</option>
                    {/* G-7：已绑 model 不在当前 provider 目录时仍可见可选，避免静默显示空白（像"绑定丢了"） */}
                    {v.modelId && !(provider?.models ?? []).some((m) => m.modelId === v.modelId) && (
                      <option value={v.modelId}>{v.modelId}（已绑 · 不在当前 provider 目录）</option>
                    )}
                    {(provider?.models ?? []).map((m) => {
                      const missing: string[] = [];
                      if (req.tools && !m.capabilities.tools) missing.push("tools");
                      // tools 为硬性要求 → 禁用并注明缺什么；structuredOutput 缺失允许选（运行期降级）
                      const soNote = req.structuredOutput && !m.capabilities.structuredOutput ? "（JSON-mode 降级）" : "";
                      return (
                        <option key={m.modelId} value={m.modelId} disabled={missing.length > 0}>
                          {m.modelId}
                          {missing.length > 0 ? `（缺 ${missing.join("、")}，不可绑定）` : soNote}
                        </option>
                      );
                    })}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={`${purpose}-noReasoning`}
                    data-testid={`binding-noreason-${purpose}`}
                    checked={Boolean(v.noReasoning)}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [purpose]: { providerId: v.providerId, modelId: v.modelId, noReasoning: e.target.checked } }))
                    }
                  />
                  {v.noReasoning && (provider?.models ?? []).find((m) => m.modelId === v.modelId)?.capabilities.reasoning ? (
                    <div style={{ fontSize: 12, color: "var(--muted2)" }}>→非推理兄弟</div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn primary sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} data-testid="binding-save">
          保存绑定
        </button>
      </div>
    </div>
  );
}
