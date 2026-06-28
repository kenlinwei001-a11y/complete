import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SkillDefinition } from "@platform/contracts";
import { fetchSkills, publishSkill, saveSkill } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

/** Skill 库（B4）：常规 CRUD + 发布 */
export default function SkillsPage() {
  const queryClient = useQueryClient();
  const { data: skills } = useQuery({ queryKey: ["b", "skills", {}], queryFn: fetchSkills });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = skills?.find((s) => s.id === selectedId) ?? null;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "skills"] });
  // G-4：自助创建技能（消"无创建入口"死路）
  const createMut = useMutation({
    // WO-12-1：CreateSkillBody.resources 必填无默认（contracts），漏传则后端 400 VALIDATION_ERROR。新建预填空 resources。
    mutationFn: () => saveSkill(null, { key: `skill_${Date.now()}`, name: "新技能（模板预填）", summary: "解读某类结论的口径。当…时使用。不适用：…", body: "# 步骤要点\n# 反例\n# 输出要求", resources: [] }),
    onSuccess: (s) => { invalidate(); setSelectedId(s.id); },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{zh.nav.skills}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="skill-create">
          ＋新建技能
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(skills ?? []).map((s) => (
            <button key={s.id} className="btn" style={{ width: "100%", marginBottom: 6, justifyContent: "flex-start", borderColor: selectedId === s.id ? "var(--accent)" : undefined }} onClick={() => setSelectedId(s.id)}>
              <span className={`badge ${s.status === "PUBLISHED" ? "green" : "amber"}`}>{s.status}</span>
              <span className="zh">{s.name}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 10 }}>v{s.version}</span>
            </button>
          ))}
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
  const editable = skill.status === "DRAFT";

  const saveMut = useMutation({
    mutationFn: () => saveSkill(skill.id, { name, summary, body }),
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
    </div>
  );
}
