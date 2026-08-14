import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SkillCompileResult, SkillDefinition } from "@platform/contracts";
import { isWriteModeSkill } from "@platform/contracts";
import { compileSkill, fetchSkills, fetchSkillSeedGate, publishSkill, saveSkill } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import ReferencesPanel from "@/components/ReferencesPanel";
import zh from "@/locales/zh";
import {
  parseDeadRefKeys,
  SkillCompileReport,
  SkillGovernanceStrip,
  SkillPublishGateFeedback,
  SkillReferenceTable,
  SkillSchemaView,
  SkillSeedGateStrip,
  type SkillPublishRejection,
} from "./SkillStructure";

/**
 * Skill 库（B4）：常规 CRUD + 发布 + **工业级结构可见面**（WO-FE-SKILL-STUDIO）。
 *
 * 本页改造前只渲染 `id/name/status/version/body/summary/resources` 九个字段——全是 Skill 大改造
 * **之前**就有的；改造新增的治理属性 / 契约 / 资产引用，前端消费方为 0
 * （`docs/PRD-skill-compiler-registry.md:50` 预言的「有端点无入口」）。结构展示块见 `./SkillStructure`。
 *
 * WO-UNBLOCK-SKILL-FE 续接两处同族缺口（`befe-seam` 门抓出、本单接上）：
 *  · **编译**（`POST /b/v1/skills/:id/compile`）：Skill Compiler S1 的唯一入口——
 *    发布前干跑七段管线，把诊断/推理图/未实现段当场摊在编辑器里；
 *  · **出厂技能门审计诚实位**（`GET /b/v1/ops/skill-seed-gate`）：后端注释写着「运维随时可查」，
 *    而在本单之前**没有任何地方可查**。
 */
export default function SkillsPage() {
  const queryClient = useQueryClient();
  const { data: skills } = useQuery({ queryKey: ["b", "skills", {}], queryFn: fetchSkills });
  /**
   * 出厂技能门审计（页级，与选中哪条技能无关）。
   * `retry: false` 是刻意的：这道位的价值全在"说真话"，请求失败就该**整块不渲染**
   * （见 `SkillSeedGateStrip`），而不是反复重试后拿一个陈旧值糊上去。
   */
  const { data: seedGate } = useQuery({ queryKey: ["b", "ops", "skill-seed-gate"], queryFn: () => fetchSkillSeedGate(), retry: false });
  /**
   * 显式手动刷新（WO-SEEDGATE-FRESHNESS 缺陷 A）：后端按请求现算但带 TTL 缓存，
   * 单纯 invalidate 只会在 TTL 内拿回同一份快照。运维刚修好上游要能**立刻**验证，
   * 故走 `?refresh=1` 跳过 TTL，再把新结论写回 query 缓存。
   */
  const refreshSeedGate = useMutation({
    mutationFn: () => fetchSkillSeedGate({ refresh: true }),
    onSuccess: (r) => queryClient.setQueryData(["b", "ops", "skill-seed-gate"], r),
    onError: toastError,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = skills?.find((s) => s.id === selectedId) ?? null;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "skills"] });
  // G-4：自助创建技能（消"无创建入口"死路）
  const createMut = useMutation({
    mutationFn: () => saveSkill(null, { key: `skill_${Date.now()}`, name: "新技能（模板预填）", summary: "解读某类结论的口径。当…时使用。不适用：…", body: "# 步骤要点\n# 反例\n# 输出要求" }),
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
      {/* 出厂技能门审计诚实位：与选中哪条技能无关，故在列表之上、页级展示。 */}
      <SkillSeedGateStrip report={seedGate} onRefresh={() => refreshSeedGate.mutate()} refreshing={refreshSeedGate.isPending} />
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(skills ?? []).map((s) => (
            <button key={s.id} className="btn" style={{ width: "100%", marginBottom: 6, justifyContent: "flex-start", borderColor: selectedId === s.id ? "var(--accent)" : undefined }} onClick={() => setSelectedId(s.id)} data-testid="skill-list-item">
              <span className={`badge ${s.status === "PUBLISHED" ? "green" : "amber"}`}>{s.status}</span>
              <span className="zh">{s.name}</span>
              {/* 写模式在列表里就要看得见（判定单一出处在契约，不在这里重写一遍）。
                  缺省不显示——「没标写模式」不等于「后端说它是只读」，只等于「它没进写模式」。 */}
              {isWriteModeSkill(s) && <span className="badge red" data-testid="skill-list-write-mode">写</span>}
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12 }}>v{s.version}</span>
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
  /**
   * 发布门被拒的常驻态。用 state 而不是只弹 toast：`SKILL_REF_UNRESOLVED` 的 message 里写着
   * **具体哪条引用死了**，那是要照着去修的信息，不能三秒后自己消失。
   */
  const [rejection, setRejection] = useState<SkillPublishRejection | null>(null);
  /**
   * 编译报告的常驻态。与 `rejection` 同理用 state 而非 toast：诊断里写着**具体哪条引用/哪个工具出问题**
   * （含 `evidence`），那是要照着去修的信息。
   *
   * ⚠️ 编译是**只读干跑**（后端 `server.ts:1430` 不落库、不改状态、不发事件），故：
   *  · 不 `invalidate` 任何 query —— 服务端真值没变，刷新只会让报告闪一下；
   *  · PUBLISHED 技能**也能编译**（干跑不写，没有理由只让 DRAFT 用）——
   *    且发布态技能恰恰是最该复查的（它已经在被 agent 加载）。
   */
  const [compiled, setCompiled] = useState<SkillCompileResult | null>(null);
  const editable = skill.status === "DRAFT";

  const saveMut = useMutation({
    mutationFn: () => saveSkill(skill.id, { name, summary, body }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });
  const compileMut = useMutation({
    mutationFn: () => compileSkill(skill.id),
    onSuccess: setCompiled,
    onError: (e: unknown) => { setCompiled(null); toastError(e); },
  });
  const publishMut = useMutation({
    mutationFn: () => publishSkill(skill.id),
    onSuccess: () => { setRejection(null); onChanged(); },
    onError: (e: unknown) => {
      // apiClient 抛的是 ApiClientError（含 code/message/requestId，源头是统一错误信封
      // `{error:{code,message,requestId}}`）。这里只取真值，不改写措辞。
      const err = e as { code?: string; message?: string; requestId?: string };
      setRejection({
        code: err?.code ?? "PUBLISH_FAILED",
        message: err?.message ?? String(e),
        ...(err?.requestId ? { requestId: err.requestId } : {}),
      });
      toastError(e);
    },
  });

  // 死路 key 只在 SKILL_REF_UNRESOLVED 时才有意义：其他错误码（lint / 评测门）的 message 里
  // 同样有「」引号（如 `body 缺骨架段落「## 目的」`），拿去标引用行会**标错人**。
  const deadKeys = rejection?.code === "SKILL_REF_UNRESOLVED" ? parseDeadRefKeys(rejection.message) : undefined;

  return (
    <div className="panel" data-testid="skill-editor">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={name} disabled={!editable} aria-label="skill 名称" onChange={(e) => setName(e.target.value)} style={{ fontWeight: 600, flex: 1 }} />
        {/* 编译不受 editable 限制：只读干跑，PUBLISHED 技能同样可复查（见 compiled 的注释）。 */}
        <button className="btn sm" onClick={() => compileMut.mutate()} disabled={compileMut.isPending} data-testid="skill-compile">
          {compileMut.isPending ? "编译中…" : "编译"}
        </button>
        {editable && (
          <>
            <button className="btn sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {zh.common.save}
            </button>
            <button className="btn primary sm" onClick={() => publishMut.mutate()} disabled={publishMut.isPending} data-testid="skill-publish">
              {zh.common.publish}
            </button>
          </>
        )}
      </div>

      {/* ① 治理属性：能不能写、要不要人批 */}
      <SkillGovernanceStrip skill={skill} />

      {/* ④ 发布门反馈：被拒时把后端原文（含具体死路引用）常驻显示 */}
      <SkillPublishGateFeedback rejection={rejection} onDismiss={() => setRejection(null)} />

      <label style={{ fontSize: 12, color: "var(--muted)" }}>summary（≤400 字，常驻 agent system prompt）</label>
      <textarea style={{ width: "100%", minHeight: 50, marginBottom: 10 }} maxLength={200} value={summary} disabled={!editable} aria-label="summary" onChange={(e) => setSummary(e.target.value)} />
      <label style={{ fontSize: 12, color: "var(--muted)" }}>body（markdown 全文）</label>
      <textarea className="mono" style={{ width: "100%", minHeight: 220, fontSize: 12 }} value={body} disabled={!editable} aria-label="body" onChange={(e) => setBody(e.target.value)} />

      {/* ② 引用与依赖：Skill「绑了哪些业务资产」的唯一可见面。空则整块不渲染。 */}
      <SkillReferenceTable title="引用资产" testid="skill-references" refs={skill.references} deadKeys={deadKeys} />
      <SkillReferenceTable title="依赖技能" testid="skill-depends-on" refs={skill.dependsOn} deadKeys={deadKeys} />

      {/* ②b **反向**引用（WO-REFERENCES-FAMILY · `GET /b/v1/skills/:id/references`）：
          上面两块是本技能**出向**引用的资产；这一块是**谁在引用本技能**（哪些 Agent 挂了它）。
          方向相反、事实源相反（前者读 `skill.references` 字段，后者读 `computeReferences`），
          缺了它，退役/改写一个技能时看不到会打断谁。 */}
      <ReferencesPanel kind="skill" id={skill.id} title="被谁引用" />

      {/* ③ 契约：结构化展示，不是丢一坨 JSON 字符串 */}
      <SkillSchemaView title="输入契约" testid="skill-input-schema" schema={skill.inputSchema} />
      <SkillSchemaView title="输出契约" testid="skill-output-schema" schema={skill.outputSchema} />

      {/* ⑤ 编译报告：七段管线的落地状态 + 诊断 + 推理图（发布前干跑，不落库） */}
      <SkillCompileReport result={compiled} onDismiss={() => setCompiled(null)} />

      {skill.resources.length > 0 && (
        <div style={{ marginTop: 12 }}>
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
