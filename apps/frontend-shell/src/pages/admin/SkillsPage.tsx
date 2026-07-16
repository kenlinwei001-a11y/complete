import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuleBindings, SkillDefinition } from "@platform/contracts";
import { fetchSkillReferences, fetchSkills, publishSkill, saveSkill } from "@/api/endpoints";
import { McpRefSelect, RuleRefSelect } from "@/components/resource-refs/ResourceRefSelect";
import { ReferencesPanel } from "@/components/ReferencesPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

/** Skill 库（B4）：常规 CRUD + 发布 */
export default function SkillsPage() {
  const queryClient = useQueryClient();
  const { data: skills } = useQuery({ queryKey: ["b", "skills", {}], queryFn: fetchSkills });
  // RESOURCE-REF-NAV：?id= 深链
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const selected = skills?.find((s) => s.id === selectedId) ?? null;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "skills"] });
  // G-4：自助创建技能（消"无创建入口"死路）
  const createMut = useMutation({
    // WO-12-1：CreateSkillBody.resources 必填无默认（contracts），漏传则后端 400 VALIDATION_ERROR。新建预填空 resources。
    mutationFn: () => saveSkill(null, { key: `skill_${Date.now()}`, name: "新技能（模板预填）", summary: "解读某类结论的口径。当…时使用。不适用：…", body: "# 步骤要点\n# 反例\n# 输出要求", resources: [] }),
    onSuccess: (s) => { invalidate(); setSelectedId(s.id); },
    onError: toastError,
  });

  // 筛选 + 排序
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "name" | "status">("createdAt");
  const [sortDesc, setSortDesc] = useState(true);

  const filteredSkills = (skills ?? [])
    .filter((s) => {
      if (searchText && !s.name.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === "createdAt") cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      else if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else if (sortBy === "status") cmp = a.status.localeCompare(b.status);
      return sortDesc ? -cmp : cmp;
    });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{zh.nav.skills}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="skill-create">
          ＋新建技能
        </button>
      </div>

      {/* 筛选 + 排序工具栏 */}
      <div className="panel" style={{ marginBottom: 14, padding: "10px 12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
          <span className="section-title" style={{ margin: 0, fontSize: 12 }}>筛选</span>
          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted">名称</span>
            <input
              data-testid="skill-filter-name"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索名称"
              style={{ width: 120, fontSize: 12 }}
            />
          </div>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted">状态</span>
            <select data-testid="skill-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">全部</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
              <option value="RETIRED">RETIRED</option>
            </select>
          </label>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ fontSize: 12 }}>
              <option value="createdAt">创建时间</option>
              <option value="name">名称</option>
              <option value="status">状态</option>
            </select>
            <button className="btn sm" onClick={() => setSortDesc((v) => !v)} title={sortDesc ? "降序" : "升序"}>
              {sortDesc ? "↓" : "↑"}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          共 {(skills ?? []).length} 个技能 · 命中 {filteredSkills.length} 个
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(skills ?? []).length === 0 && (
            <EmptyState message="暂无技能">
              <button className="btn primary sm" disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="cta-skill">
                ＋新建技能
              </button>
            </EmptyState>
          )}
          {filteredSkills.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--line, #333)",
                cursor: "pointer",
                flexWrap: "wrap",
                background: selectedId === s.id ? "var(--panel2, #1a1a2e)" : undefined,
              }}
            >
              <span className="zh" style={{ fontWeight: 500, minWidth: 100, flex: 1 }}>{s.name}</span>
              <span className={`badge ${s.status === "PUBLISHED" ? "green" : s.status === "RETIRED" ? "" : "amber"}`}>{s.status}</span>
              <span className={`badge ${s.createdBy === "system" ? "" : "blue"}`}>{s.createdBy === "system" ? "模拟" : "实际"}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.createdAt?.slice(0, 10) ?? "-"}</span>
              <span style={{ fontSize: 11, color: "var(--muted2)" }}>{s.createdBy ?? "-"}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--muted2)" }}>v{s.version}</span>
            </div>
          ))}
          {filteredSkills.length === 0 && (skills ?? []).length > 0 && (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              无匹配技能——请调整筛选条件
            </div>
          )}
        </div>
        {selected && <SkillEditor key={selected.id} skill={selected} onChanged={invalidate} />}
      </div>
    </div>
  );
}

function SkillEditor({ skill, onChanged }: { skill: SkillDefinition; onChanged: () => void }) {
  const [name, setName] = useState(skill.name);
  const [summary, setSummary] = useState(skill.summary);
  const [body, setBody] = useState(skill.body);
  // WO-RESOURCE-REF §2.3：skill 引用规则（含约束条件）+ MCP（含内置求解器）——声明+落库+进被引用图（诚实边界见 WO §4）。
  const [ruleBindings, setRuleBindings] = useState<RuleBindings>(
    skill.ruleBindings ?? { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
  );
  const [mcpServers, setMcpServers] = useState<{ mcpConfigId: string }[]>(skill.mcpServers ?? []);
  // SKILL-LIBRARY-EVERYWHERE §3：方法论「结构模板 + 判定口径」——供工作流确定性消费（render_answer 结论叙事体现口径·非 LLM 注入）。
  const [conclusionTemplate, setConclusionTemplate] = useState(skill.methodology?.conclusionTemplate ?? "");
  const [criteriaText, setCriteriaText] = useState((skill.methodology?.criteria ?? []).join("\n"));
  const editable = skill.status === "DRAFT";
  // RESOURCE-REF-NAV：被引用只读区（哪些 agent 挂载了本 skill）
  const refsQuery = useQuery({
    queryKey: ["b", "skill-references", skill.id],
    queryFn: () => fetchSkillReferences(skill.id),
  });

  const methodology = conclusionTemplate.trim()
    ? { conclusionTemplate: conclusionTemplate.trim(), criteria: criteriaText.split("\n").map((c) => c.trim()).filter(Boolean) }
    : undefined;
  const saveMut = useMutation({
    mutationFn: () => saveSkill(skill.id, { name, summary, body, ruleBindings, mcpServers, methodology }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });
  const publishMut = useMutation({ mutationFn: () => publishSkill(skill.id), onSuccess: onChanged, onError: toastError });

  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={name} disabled={!editable} aria-label="skill 名称" onChange={(e) => setName(e.target.value)} style={{ fontWeight: 600, flex: 1 }} />
        {editable && (
          <>
            <button className="btn sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {zh.common.save}
            </button>
            <button className="btn primary sm" onClick={() => publishMut.mutate()} disabled={publishMut.isPending}>
              {zh.common.publish}
            </button>
          </>
        )}
      </div>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>summary（≤400 字，常驻 agent system prompt）</label>
      <textarea style={{ width: "100%", minHeight: 50, marginBottom: 10 }} maxLength={400} value={summary} disabled={!editable} aria-label="summary" onChange={(e) => setSummary(e.target.value)} />
      <label style={{ fontSize: 12, color: "var(--muted)" }}>body（markdown 全文）</label>
      <textarea className="mono" style={{ width: "100%", minHeight: 220, fontSize: 12 }} value={body} disabled={!editable} aria-label="body" onChange={(e) => setBody(e.target.value)} />

      {/* SKILL-LIBRARY-EVERYWHERE §3：方法论结构模板（工作流确定性消费口·非 agent 提示注入）。 */}
      <div style={{ marginTop: 12 }} data-testid="skill-methodology">
        <div className="section-title">
          方法论结构模板 <span className="badge amber" style={{ marginLeft: 6 }}>工作流确定性消费·非 LLM 注入</span>
        </div>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>结论叙事框 conclusionTemplate（workflow.skillRefs 绑定后，结论叙事步确定性体现此口径）</label>
        <textarea
          style={{ width: "100%", minHeight: 50, marginBottom: 8 }}
          maxLength={600}
          value={conclusionTemplate}
          disabled={!editable}
          aria-label="方法论结论叙事框"
          data-testid="skill-methodology-template"
          onChange={(e) => setConclusionTemplate(e.target.value)}
        />
        <label style={{ fontSize: 12, color: "var(--muted)" }}>判定口径 criteria（每行一条）</label>
        <textarea
          style={{ width: "100%", minHeight: 70, fontSize: 12 }}
          value={criteriaText}
          disabled={!editable}
          aria-label="方法论判定口径"
          data-testid="skill-methodology-criteria"
          onChange={(e) => setCriteriaText(e.target.value)}
        />
      </div>

      {/* WO-RESOURCE-REF §2.3：规则引用 + MCP 引用（复用共享控件；声明落库 + 进被引用图，诚实不扩执行语义）。 */}
      <div style={{ marginTop: 12 }} data-testid="skill-rule-refs">
        <div className="section-title">规则引用</div>
        <RuleRefSelect
          value={ruleBindings.ruleKeys}
          disabled={!editable}
          label=""
          allHint="ALL_APPLICABLE（本技能声明适用的全部已发布规则）"
          testid="skill-rulebindings-select"
          onChange={(v) => setRuleBindings({ ...ruleBindings, ruleKeys: v })}
        />
        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>
            mode
            <select
              value={ruleBindings.mode}
              disabled={!editable}
              aria-label="规则模式"
              style={{ display: "block" }}
              onChange={(e) => setRuleBindings({ ...ruleBindings, mode: e.target.value as RuleBindings["mode"] })}
            >
              {["PRE_CHECK", "POST_CHECK", "BOTH"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div style={{ marginTop: 12 }} data-testid="skill-mcp-refs">
        <div className="section-title">MCP 引用</div>
        <McpRefSelect value={mcpServers} disabled={!editable} testid="skill-mcpservers-select" onChange={setMcpServers} />
      </div>

      {skill.resources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="section-title">资源</div>
          {skill.resources.map((r) => (
            <span key={r.name} className="badge" style={{ marginRight: 6 }}>
              {r.name}
            </span>
          ))}
        </div>
      )}
      <ReferencesPanel testId="skill-references" loading={refsQuery.isLoading} references={refsQuery.data?.references} />
    </div>
  );
}
