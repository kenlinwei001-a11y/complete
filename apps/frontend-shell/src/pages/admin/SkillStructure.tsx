/**
 * B4 Skill 工业级结构的**可见面**（WO-FE-SKILL-STUDIO）。
 *
 * 背景：后端 `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236`）早已从 9 个字段长成
 * 治理属性（capability / sideEffect / approvalGate / provenancePolicy / maxBudgetRounds）
 * + 契约（inputSchema / outputSchema）+ 资产绑定（references / dependsOn）；
 * 而 `/admin/skills` 一直只渲染改造之前那 9 个 —— `docs/PRD-skill-compiler-registry.md:50` 预言的
 * 「有端点无入口」。本文件就是那个入口。
 *
 * ⛔ 三条硬约束（贯穿本文件，改动前先读）：
 *  1. **只读后端真值，不许前端自己编**。字段缺失 ⇒ **整块不渲染**，
 *     不许填「未知」「暂无数据」「—」这类占位假值。本仓有多次「诚实位在说谎」的事故记录：
 *     一个编出来的缺省值和一个真实的后端值在界面上长得一模一样，用户无从分辨。
 *     具体后果举例：`sideEffect` 缺省在**运行时**兜底为 READ，但那是后端行为，
 *     不是这个技能「声明了 READ」。界面若替它显示 READ，就是替后端签了一个它没签的字。
 *  2. **契约类型一律从 `@platform/contracts` import，前端不得重定义**（contracts-only-shared 铁律）。
 *     写模式判定也不自己写 `sideEffect==="WRITE" || approvalGate!=="none"`——那正是契约里
 *     `isWriteModeSkill` 反复叮嘱过的"两侧同调、单一出处"（探针与运行时曾各判一半 → 假绿第 6 例）。
 *  3. 不新增任何 feature flag 默认值（开关默认值是产品决策不是 dev 决策）。
 */
import type { SkillDefinition, SkillReference } from "@platform/contracts";
import { isWriteModeSkill } from "@platform/contracts";

// ---------------------------------------------------------------------------
// 词表：把契约枚举值译成中文可读标签。
// **只做 code→label 的翻译，不做"缺省值补齐"**——查不到就原样显示后端给的值，
// 绝不落回某个"合理的"默认。查不到本身也是信息（后端加了新枚举而前端没跟上）。
// ---------------------------------------------------------------------------
const CAPABILITY_LABEL: Record<string, string> = {
  analysis: "分析", forecast: "预测", diagnosis: "诊断", prescription: "处置建议",
  optimization: "优化", planning: "规划", approval: "审批",
};
const SIDE_EFFECT_LABEL: Record<string, string> = { READ: "只读", COMPUTE: "计算", WRITE: "写真值" };
const APPROVAL_GATE_LABEL: Record<string, string> = { none: "免审批", human: "人工审批", workflow: "工作流审批" };
const PROVENANCE_LABEL: Record<string, string> = { required: "必须溯源", best_effort: "尽力溯源", none: "不要求溯源" };
const REF_KIND_LABEL: Record<string, string> = {
  rule: "规则", constraint: "约束", slice: "本体切片", ontologyType: "对象类型",
  solver: "求解器", skill: "技能", workflow: "工作流", agent: "Agent",
};
const REF_ROLE_LABEL: Record<string, string> = {
  precondition: "前置条件", postcheck: "后置校验", context: "上下文", fallback: "兜底",
};

/** code→label：查不到时**返回原 code**（保真优先于好看），绝不返回"未知"。 */
const label = (dict: Record<string, string>, code: string): string => dict[code] ?? code;

// ---------------------------------------------------------------------------
// ① 治理属性带 —— 这个 Skill 能不能写、要不要人批
// ---------------------------------------------------------------------------

/**
 * 只渲染**后端真的给了值**的属性；一个都没给就整块不渲染（返回 null）。
 * status / version / key 是必填字段（契约无 `.optional()`），恒有值。
 */
export function SkillGovernanceStrip({ skill }: { skill: SkillDefinition }): JSX.Element {
  // 写模式：单一出处在契约（`isWriteModeSkill` = 会改真值 或 需要审批），前端不另判一次。
  const writeMode = isWriteModeSkill(skill);
  return (
    <div data-testid="skill-governance" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 12 }}>
      <span className={`badge ${skill.status === "PUBLISHED" ? "green" : skill.status === "RETIRED" ? "red" : "amber"}`} data-testid="skill-gov-status">
        {skill.status}
      </span>
      <span className="badge" data-testid="skill-gov-version">v{skill.version}</span>
      <span className="badge" data-testid="skill-gov-key">{skill.key}</span>
      {skill.capability !== undefined && (
        <span className="badge blue" data-testid="skill-gov-capability">能力 {label(CAPABILITY_LABEL, skill.capability)}</span>
      )}
      {skill.sideEffect !== undefined && (
        <span className={`badge ${skill.sideEffect === "WRITE" ? "red" : ""}`} data-testid="skill-gov-side-effect">
          副作用 {label(SIDE_EFFECT_LABEL, skill.sideEffect)}
        </span>
      )}
      {skill.approvalGate !== undefined && (
        <span className={`badge ${skill.approvalGate === "none" ? "" : "amber"}`} data-testid="skill-gov-approval-gate">
          {label(APPROVAL_GATE_LABEL, skill.approvalGate)}
        </span>
      )}
      {skill.provenancePolicy !== undefined && (
        <span className="badge" data-testid="skill-gov-provenance">{label(PROVENANCE_LABEL, skill.provenancePolicy)}</span>
      )}
      {skill.maxBudgetRounds !== undefined && (
        <span className="badge" data-testid="skill-gov-budget">预算 {skill.maxBudgetRounds} 轮</span>
      )}
      {/* 写模式是**推导位**，非后端字段：故显式标注推导依据，别让它冒充一个后端下发的属性。 */}
      {writeMode && (
        <span className="badge red" data-testid="skill-gov-write-mode" title="契约 isWriteModeSkill：会改变真值 或 需要审批 ⇒ 受 R4「真值只经 Action 审批链变更」约束">
          写模式（须出 action_draft）
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 引用与依赖 —— Skill「绑了哪些业务资产」的唯一可见面
// ---------------------------------------------------------------------------

/**
 * 一张引用表。`refs` 为空/未给 ⇒ **返回 null，整块不渲染**（不出现空表头、不出现「暂无数据」）。
 *
 * @param deadKeys 发布门 422 `SKILL_REF_UNRESOLVED` 回来的死路 key 集合。
 *        来源是**后端 message 里逐条列出的 key**，不是前端猜的；空集时不标任何行。
 */
export function SkillReferenceTable({
  title, testid, refs, deadKeys,
}: {
  title: string;
  testid: string;
  refs: SkillReference[] | undefined;
  deadKeys?: ReadonlySet<string>;
}): JSX.Element | null {
  if (!refs || refs.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }} data-testid={testid}>
      <div className="section-title">{title}（{refs.length}）</div>
      <table className="cmp" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", width: "18%" }}>类型</th>
            <th style={{ textAlign: "left" }}>资产 key</th>
            <th style={{ textAlign: "left", width: "18%" }}>角色</th>
            <th style={{ textAlign: "left", width: "14%" }}>必需</th>
          </tr>
        </thead>
        <tbody>
          {refs.map((r, i) => {
            const dead = deadKeys?.has(r.key) ?? false;
            return (
              <tr key={`${r.kind}:${r.key}:${i}`} data-testid={`${testid}-row`} data-ref-key={r.key} data-ref-kind={r.kind}>
                <td><span className="badge">{label(REF_KIND_LABEL, r.kind)}</span></td>
                <td className="mono" style={{ wordBreak: "break-all" }}>
                  {r.key}
                  {/* version 是可选字段：后端没给就不显示，不补 "latest"（那是后端的解析行为，不是声明值）。 */}
                  {r.version !== undefined && <span className="badge" style={{ marginLeft: 6 }}>v{r.version}</span>}
                  {dead && (
                    <span className="badge red" style={{ marginLeft: 6 }} data-testid="skill-ref-dead">
                      死路·发布被拒
                    </span>
                  )}
                </td>
                <td>{label(REF_ROLE_LABEL, r.role)}</td>
                <td>{r.required ? <span className="badge amber">必需</span> : <span className="badge">可选</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ③ 契约（inputSchema / outputSchema）—— 结构化展示，不是丢一坨 JSON 字符串
// ---------------------------------------------------------------------------

/** 契约里 `JsonSchemaObject = z.record(z.string(), z.unknown())`，故运行时形状要自己收窄，不能瞎断言。 */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * JSON Schema 的属性表。
 *
 * 诚实边界（本块最容易犯规的地方）：
 *  · schema 未给 ⇒ 不渲染。
 *  · schema 给了但没有可解析的 `properties` ⇒ **不假装结构化**，原样把 JSON 摊出来。
 *    宁可显示得朴素，也不许把一份读不懂的 schema 渲染成一张空表（空表 = 在说"它没有字段"，那是假话）。
 *  · 单个属性的 type / description 缺失 ⇒ 该格**留空**，不写 "any"、不写 "无描述"。
 */
export function SkillSchemaView({
  title, testid, schema,
}: {
  title: string;
  testid: string;
  schema: Record<string, unknown> | undefined;
}): JSX.Element | null {
  if (!schema || Object.keys(schema).length === 0) return null;
  const props = isRecord(schema.properties) ? schema.properties : undefined;
  const requiredList = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : [];
  const entries = props ? Object.entries(props) : [];

  return (
    <div style={{ marginTop: 12 }} data-testid={testid}>
      <div className="section-title">{title}{entries.length > 0 ? `（${entries.length} 字段）` : ""}</div>
      {entries.length === 0 ? (
        // 结构不可解析：原样呈现后端真值，绝不编造一张结构表。
        <pre className="mono" data-testid={`${testid}-raw`} style={{ fontSize: 11, margin: 0, padding: 8, overflowX: "auto", border: "1px solid var(--line2)", borderRadius: 8 }}>
          {JSON.stringify(schema, null, 2)}
        </pre>
      ) : (
        <table className="cmp" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: "28%" }}>字段</th>
              <th style={{ textAlign: "left", width: "16%" }}>类型</th>
              <th style={{ textAlign: "left", width: "12%" }}>必填</th>
              <th style={{ textAlign: "left" }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, raw]) => {
              const p = isRecord(raw) ? raw : {};
              const type = typeof p.type === "string" ? p.type : undefined;
              const desc = typeof p.description === "string" ? p.description : undefined;
              const enumVals = Array.isArray(p.enum) ? p.enum : undefined;
              return (
                <tr key={name} data-testid={`${testid}-field`} data-field-name={name}>
                  <td className="mono" style={{ wordBreak: "break-all" }}>{name}</td>
                  {/* type 缺失 ⇒ 空格子。不填 "any"：JSON Schema 里"没写 type"和"type 是 any"不是一回事。 */}
                  <td className="mono">{type ?? ""}</td>
                  <td>{requiredList.includes(name) ? <span className="badge amber">必填</span> : ""}</td>
                  <td>
                    {desc ?? ""}
                    {enumVals && (
                      <span style={{ marginLeft: desc ? 6 : 0 }}>
                        {enumVals.map((v, i) => (
                          <span key={i} className="badge" style={{ marginRight: 4 }}>{String(v)}</span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ④ 发布门反馈 —— 被拒时说清"到底哪条引用死了"，而不是一句「发布失败」
// ---------------------------------------------------------------------------

/**
 * 从后端 `SKILL_REF_UNRESOLVED` 的 message 里抽出死路 key。
 *
 * 依据（真后端 `apps/agentcore/src/server.ts` 发布路，逐条形如）：
 *   `求解器「capacity_forecast」在 DataCore 未注册`
 *   `规则「C03」在 DataCore 规则库不存在`
 *   `对象类型「Base」在 DataCore 本体不存在`
 * key 一律裹在中文书名号 `「」` 里 ⇒ 抽 `「…」` 即得。
 *
 * 为何这是"读后端真值"而非"前端自己编"：key 完全来自后端 message，前端只做定位高亮；
 * 且**原始 message 始终原样展示**（见下方组件）——抽取失败最多是少标几行红，
 * 不会让用户看到一条后端没说过的死路。
 */
export function parseDeadRefKeys(message: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!message) return out;
  for (const m of message.matchAll(/「([^」]+)」/g)) {
    const key = m[1];
    if (key) out.add(key);
  }
  return out;
}

export interface SkillPublishRejection {
  code: string;
  message: string;
  requestId?: string;
}

/**
 * 发布被拒的常驻面板（**不是** toast —— toast 几秒就没了，而"哪条引用死了"是要照着去修的信息）。
 * 始终原样展示后端 message + code；不改写、不摘要、不"翻译成人话"。
 */
export function SkillPublishGateFeedback({
  rejection, onDismiss,
}: {
  rejection: SkillPublishRejection | null;
  onDismiss: () => void;
}): JSX.Element | null {
  if (!rejection) return null;
  return (
    <div
      data-testid="skill-publish-rejection"
      data-error-code={rejection.code}
      style={{
        marginTop: 10, padding: "10px 12px", borderRadius: 10,
        border: "1px solid rgba(224, 98, 108, 0.45)", background: "rgba(224, 98, 108, 0.08)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span className="badge red">发布被拒</span>
        <span className="badge red mono" data-testid="skill-publish-rejection-code">{rejection.code}</span>
        {rejection.requestId && <span className="badge mono">{rejection.requestId}</span>}
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onDismiss} data-testid="skill-publish-rejection-dismiss">
          知道了
        </button>
      </div>
      {/* 后端原文，一字不改 —— 具体是哪条引用死了就写在这里面。 */}
      <div data-testid="skill-publish-rejection-message" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {rejection.message}
      </div>
    </div>
  );
}
