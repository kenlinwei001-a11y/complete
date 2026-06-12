import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SceneEntryConfig, SceneEntryMode } from "@platform/contracts";
import { fetchAgents, fetchScenes, putScene } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { featureOn } from "@/workspace/featureGate";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const MODES: SceneEntryMode[] = ["WORKFLOW_FIRST", "WORKFLOW_ONLY", "AGENT_FIRST", "AGENT_ONLY"];

/** 场景入口配置（B5）：每视图一行（mode 四选一 + defaultAgent + 建议问题） */
export default function ScenesPage() {
  const { data: scenes } = useQuery({ queryKey: ["b", "scenes", {}], queryFn: fetchScenes });
  const { data: agents } = useQuery({ queryKey: ["b", "agents", {}], queryFn: fetchAgents });
  const { data: workspace } = useWorkspace();

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{zh.admin.scenes.title}</h2>
      {(scenes ?? []).map((s) => (
        <SceneRow
          key={s.viewKey}
          scene={s}
          agents={(agents ?? []).map((a) => ({ id: a.id, name: a.name }))}
          featureOff={workspace ? !featureOn(workspace, `view.${s.viewKey}`) : false}
        />
      ))}
    </div>
  );
}

function SceneRow({
  scene,
  agents,
  featureOff,
}: {
  scene: SceneEntryConfig;
  agents: { id: string; name: string }[];
  featureOff: boolean;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SceneEntryMode>(scene.mode);
  const [defaultAgentId, setDefaultAgentId] = useState(scene.defaultAgentId ?? "");
  const [questions, setQuestions] = useState(scene.uiHints.suggestedQuestions.join("\n"));
  const [placeholder, setPlaceholder] = useState(scene.uiHints.placeholder);

  const saveMut = useMutation({
    mutationFn: () =>
      putScene(scene.viewKey, {
        mode,
        defaultAgentId: defaultAgentId || undefined,
        uiHints: { placeholder, suggestedQuestions: questions.split("\n").filter(Boolean) },
      }),
    onSuccess: () => {
      toast("已保存", "success");
      void queryClient.invalidateQueries({ queryKey: ["b", "scenes"] });
    },
    onError: toastError,
  });

  return (
    <div className="panel" style={{ marginBottom: 12 }} data-testid={`scene-${scene.viewKey}`}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <strong className="mono">{scene.viewKey}</strong>
        {/* 引用已关闭视图的 SceneEntry 标「功能未开通」警示（Entitlement §5） */}
        {featureOff && <span className="badge amber" data-testid="scene-feature-off">{zh.admin.scenes.featureOff}</span>}
        <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
          {MODES.map((m) => (
            <label key={m} style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 11 }}>
              <input type="radio" name={`mode-${scene.viewKey}`} checked={mode === m} onChange={() => setMode(m)} />
              {m}
            </label>
          ))}
        </div>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          {zh.common.save}
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          defaultAgent
          <select
            value={defaultAgentId}
            aria-label={`defaultAgent-${scene.viewKey}`}
            onChange={(e) => setDefaultAgentId(e.target.value)}
            style={{ display: "block", marginTop: 4, minWidth: 180 }}
          >
            <option value="">（无）</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          placeholder
          <input style={{ display: "block", width: "100%", marginTop: 4 }} value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          建议问题（每行一条）
          <textarea style={{ display: "block", width: "100%", marginTop: 4, minHeight: 56 }} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
