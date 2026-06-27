import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDomainEvents, fetchMcpConfigs, fetchScenarioCards, fetchSkills } from "@/api/endpoints";
import { useQuickLaunch, useScenarioLaunch } from "@/components/ScenarioLauncher/useScenarioLaunch";
import { tokenStore } from "@/api/tokenStore";

/**
 * 平台标准中栏控制台（竞品 image1/2/6 母版「6 子 tab」+ 右 Agent 指挥台）——建模/评估页共用导航。
 * 分层交付 b：基本信息(slot) / Skills(B4) / MCP服务(B3) / 日志(outbox) = 接现成真后端；
 * **图查询 = ③类 §10.1（后端整块未建）→ 显式 RESERVED 不画假构建器**；指南 = 静态文档。
 * 右 Agent 指挥台接 QOS（补 G-3）：点真场景卡 → useScenarioLaunch（带 scenarioIntentKey 确定性绑定）→ 真出推演答案。
 * token 反应式门（pushState 早挂载防御）：enabled:hasToken，token 到位即自动发起。
 */
function useHasToken(): boolean {
  return useSyncExternalStore(tokenStore.subscribe, () => tokenStore.get() != null, () => false);
}

const TABS = ["基本信息", "图查询", "Skills", "MCP服务", "日志", "指南"] as const;
type Tab = (typeof TABS)[number];

export function PlatformConsole({ testId = "platform-console", basicInfo, guide }: { testId?: string; basicInfo?: ReactNode; guide?: ReactNode }) {
  const [tab, setTab] = useState<Tab>("基本信息");
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="panel" data-testid={testId} style={{ padding: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} data-testid={`${testId}-tabs`}>
          {TABS.map((tb) => (
            <button key={tb} className={`btn sm ${tab === tb ? "" : "ghost"}`} data-testid={`${testId}-tab-${tb}`} data-active={tab === tb ? "1" : "0"} onClick={() => setTab(tb)}>{tb}</button>
          ))}
        </div>
        <button className="btn sm ghost" style={{ marginLeft: "auto" }} data-testid={`${testId}-collapse`} onClick={() => setCollapsed((c) => !c)}>{collapsed ? "› 展开" : "‹ 折叠"}</button>
      </div>
      {!collapsed && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }} data-testid={`${testId}-panel-${tab}`}>
            {tab === "基本信息" && (basicInfo ?? <div style={{ fontSize: 12, color: "var(--muted2)" }}>选中节点查看基本信息。</div>)}
            {tab === "图查询" && <GraphQueryReserved />}
            {tab === "Skills" && <SkillsTab />}
            {tab === "MCP服务" && <McpTab />}
            {tab === "日志" && <LogsTab />}
            {tab === "指南" && (guide ?? <GuideTab />)}
          </div>
          <div style={{ width: 340, flexShrink: 0 }}>
            <AgentConsole />
          </div>
        </div>
      )}
    </div>
  );
}

function GraphQueryReserved() {
  return (
    <div data-testid="pc-graphquery-reserved" style={{ border: "1px dashed var(--border,#333)", borderRadius: 8, padding: 16, color: "var(--muted2)", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--txt)" }}>◌ 图查询 · RESERVED（后端未建·§10.1 TO-DO）</div>
      图查询构建器 + 平台自有查询语言 + 查询代码生成 + Query→Skill 绑定 + Query→MCP 暴露 —— 后端整块尚未建。
      <div style={{ marginTop: 6 }}>分层交付 b 红线：后端未建前不画假构建器/假结果表。后端 backlog 建成后回来复刻+点亮。</div>
    </div>
  );
}

function SkillsTab() {
  const hasToken = useHasToken();
  const { data, isLoading, isError } = useQuery({ queryKey: ["b", "skills"], queryFn: fetchSkills, retry: false, enabled: hasToken });
  if (isError) return <div data-testid="pc-skills-err" style={{ color: "var(--muted2)", fontSize: 12 }}>技能服务不可达（AgentCore off）——诚实降级。</div>;
  if (isLoading || !data) return <div style={{ color: "var(--muted2)", fontSize: 12 }}>加载技能…</div>;
  return (
    <div data-testid="pc-skills">
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>平台技能（B4·{data.length}·真 /b/v1/skills）</div>
      {data.length === 0 ? <div style={{ color: "var(--muted2)", fontSize: 12 }}>暂无已发布技能。</div> : (
        <table className="cmp" style={{ width: "100%", fontSize: 12 }}>
          <thead><tr><th>名称</th><th>键</th><th>状态</th></tr></thead>
          <tbody>{data.map((s) => (<tr key={s.id} data-testid={`pc-skill-${s.key}`}><td>{s.name}</td><td className="mono">{s.key}</td><td><span className={`badge ${s.status === "PUBLISHED" ? "green" : ""}`}>{s.status}</span></td></tr>))}</tbody>
        </table>
      )}
    </div>
  );
}

function McpTab() {
  const hasToken = useHasToken();
  const { data, isLoading, isError } = useQuery({ queryKey: ["b", "mcp-configs"], queryFn: fetchMcpConfigs, retry: false, enabled: hasToken });
  if (isError) return <div data-testid="pc-mcp-err" style={{ color: "var(--muted2)", fontSize: 12 }}>MCP 服务不可达——诚实降级。</div>;
  if (isLoading || !data) return <div style={{ color: "var(--muted2)", fontSize: 12 }}>加载 MCP 服务…</div>;
  return (
    <div data-testid="pc-mcp">
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>MCP 服务（B3·{data.length}·真 /b/v1/mcp-configs）</div>
      {data.length === 0 ? <div data-testid="pc-mcp-empty" style={{ color: "var(--muted2)", fontSize: 12 }}>demo 未配置 MCP 服务（真态为空·非假壳）。</div> : (
        <table className="cmp" style={{ width: "100%", fontSize: 12 }}><tbody>{data.map((m) => (<tr key={m.id}><td>{m.name}</td></tr>))}</tbody></table>
      )}
    </div>
  );
}

function LogsTab() {
  const hasToken = useHasToken();
  const { data, isLoading, isError } = useQuery({ queryKey: ["a", "outbox-events"], queryFn: () => fetchDomainEvents(), retry: false, enabled: hasToken });
  if (isError) return <div data-testid="pc-logs-err" style={{ color: "var(--muted2)", fontSize: 12 }}>事件馈源不可达——诚实降级。</div>;
  if (isLoading || !data) return <div style={{ color: "var(--muted2)", fontSize: 12 }}>加载事件日志…</div>;
  const rows = [...data].slice(-30).reverse();
  return (
    <div data-testid="pc-logs">
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>领域事件日志（真 outbox·近 {rows.length}/{data.length}）</div>
      <table className="cmp" style={{ width: "100%", fontSize: 11.5 }}>
        <thead><tr><th>时间</th><th>事件</th></tr></thead>
        <tbody>{rows.map((e) => (<tr key={e.eventId} data-testid={`pc-log-${e.eventId}`}><td className="mono">{e.createdAt?.replace("T", " ").slice(5, 19)}</td><td><span className="badge">{e.event}</span></td></tr>))}</tbody>
      </table>
    </div>
  );
}

function GuideTab() {
  return (
    <div data-testid="pc-guide" style={{ fontSize: 13, color: "var(--txt)", lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>使用指南</div>
      <ol style={{ paddingLeft: 18, color: "var(--muted2)" }}>
        <li>选中节点/对象查看基本信息与逐对象就绪。</li>
        <li>Skills/MCP 是平台可引用的技能与外部工具服务（真后端）。</li>
        <li>日志为领域事件馈源（本体/规则/物化/推演链真事件）。</li>
        <li>右侧 Agent 指挥台点真场景卡 → QOS 工作流真出推演答案。</li>
      </ol>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted2)" }}>（静态指引·非后端数据；图查询能力后端建成后补章节）</div>
    </div>
  );
}

/** Agent 指挥台接 QOS（补 G-3）：真场景卡 → useScenarioLaunch（scenarioIntentKey 确定性绑定·无需 LLM 真出答案）。 */
function AgentConsole() {
  const quickLaunch = useQuickLaunch();
  const launchCard = useScenarioLaunch();
  const hasToken = useHasToken();
  const { data: cardsData } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards(), retry: false, enabled: hasToken });
  const cards = (cardsData?.items ?? []).filter((c) => !c.inactive).slice(0, 6);
  const [q, setQ] = useState("");
  const ask = () => { const query = q.trim(); if (!query) return; void quickLaunch({ query, targetView: "dash", selectedObjects: [] }); setQ(""); };
  return (
    <div data-testid="pc-agent" style={{ border: "1px solid var(--border,#2a2a2a)", borderRadius: 8, padding: 10, background: "var(--panel,rgba(255,255,255,.02))" }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Agent 指挥台</div>
      <div style={{ borderLeft: "3px solid var(--ok,#62BE77)", fontSize: 12, color: "var(--muted2)", marginBottom: 8, background: "rgba(98,190,119,.06)", borderRadius: 6, padding: "6px 8px" }} data-testid="pc-agent-welcome">
        平台 Agent 已就位。点下方真场景卡 → 经 QOS 工作流真出推演答案（确定性绑定·无需 LLM）。
      </div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>真场景卡（点 → QOS 推演真答案）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }} data-testid="pc-agent-cards">
        {cards.length === 0 ? <div style={{ fontSize: 11, color: "var(--muted2)" }}>暂无已发布场景卡。</div> : cards.map((c) => (
          <button key={c.sNo} className="btn sm ghost" data-testid={`pc-agent-card-${c.intentKey}`} style={{ textAlign: "left", justifyContent: "flex-start", fontSize: 12 }} title={`意图 ${c.intentKey}`} onClick={() => void launchCard(c)}>▶ {c.triggerQuestion}</button>
        ))}
      </div>
      <textarea data-testid="pc-agent-input" value={q} onChange={(e) => setQ(e.target.value)} rows={2} style={{ width: "100%", fontSize: 12, resize: "vertical" }} placeholder="自由提问…"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>自由文本走 LLM classify（demo 无 key 受限）</span>
        <button className="btn primary sm" data-testid="pc-agent-send" disabled={!q.trim()} onClick={ask}>推演</button>
      </div>
    </div>
  );
}
