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
import type { SkillCompileResult, SkillDefinition, SkillReference } from "@platform/contracts";
import { isWriteModeSkill } from "@platform/contracts";
import type { SkillSeedGateReport } from "@/api/endpoints";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";

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
        <span className="badge red" data-testid="skill-gov-write-mode">
          写模式（须出 action_draft）
          {/* WO-HOVER-LAYER：推导依据从原生 `title=` 迁到 InfoPopover（规范 §2 R-UI-3）。 */}
          <InfoPopover topic={zh.sim.sandbox.info.skillWriteModeTopic} testId="skill-gov-write-mode">
            {zh.sim.sandbox.info.skillWriteModeBody}
          </InfoPopover>
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

// ---------------------------------------------------------------------------
// ⑤ 编译报告 —— `POST /b/v1/skills/:id/compile` 的可见面（WO-UNBLOCK-SKILL-FE）
// ---------------------------------------------------------------------------

/**
 * Skill Compiler S1 的可见面。**这是本单要解的正题**：编译端点
 * （`apps/agentcore/src/server.ts:1430`）自 WO-SKILL-COMPILER-S1 落地以来
 * 前端零调用 —— 「有端点无入口」的又一例，被 `befe-seam` 门抓住。
 *
 * ⛔ 三条硬约束（与本文件其余部分同源，改动前先读）：
 *  1. **`stages[]` 必须五段全渲染，不许只显示 OK 的那几段。**
 *     后端 `skill-compiler.ts:203 stageReports` 把 optimize / package 显式标成 `NOT_IMPLEMENTED`
 *     并写明归谁做，这是它的**诚实位**。界面若滤掉这两段、只画三个绿勾，就是替后端宣布
 *     「七段管线跑完了」——正是「填了字段没有消费方，比不填更危险」那族病的界面版。
 *  2. **`ok` 与 `diagnostics` 分开读。** `ok === true` 只等于"没有 error 级诊断"
 *     （`skill-compiler.ts:242` `hasError = diagnostics.some(d => d.severity === "error")`），
 *     **不等于**"没有问题"——warning / info 照样在。所以 ok 时也必须把诊断列出来。
 *  3. **`evidence` 原样显示。** 那是 R13 要求「当场亮出证据」的落点（命中的 key / 词表 / 调用点），
 *     摘要掉它，诊断就退回成"有问题"这种没法照着修的话。
 */
const STAGE_LABEL: Record<string, string> = {
  parse: "① 解析",
  validate: "② 校验",
  graph: "③ 推理图",
  optimize: "④ 优化",
  package: "⑤ 运行时包",
};
const SEVERITY_LABEL: Record<string, string> = { error: "错误", warning: "警告", info: "提示" };
const SEVERITY_BADGE: Record<string, string> = { error: "red", warning: "amber", info: "" };

export function SkillCompileReport({
  result, onDismiss,
}: {
  result: SkillCompileResult | null;
  onDismiss: () => void;
}): JSX.Element | null {
  if (!result) return null;
  const notImplemented = result.stages.filter((s) => s.status === "NOT_IMPLEMENTED");
  const errors = result.diagnostics.filter((d) => d.severity === "error");

  return (
    <div style={{ marginTop: 12 }} data-testid="skill-compile-report" data-compile-ok={String(result.ok)}>
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>编译报告</span>
        {/* ok 的措辞刻意不写「编译通过」：它只表示"无 error 级诊断"，warning/info 可能仍在。 */}
        <span className={`badge ${result.ok ? "green" : "red"}`} data-testid="skill-compile-ok">
          {result.ok ? "无错误级诊断" : `${errors.length} 条错误级诊断`}
        </span>
        <span className="badge mono" data-testid="skill-compile-version">
          {result.skillKey} v{result.skillVersion}
        </span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onDismiss} data-testid="skill-compile-dismiss">
          收起
        </button>
      </div>

      {/* —— 七段管线的落地状态：五段全列，NOT_IMPLEMENTED 显式在案 —— */}
      <table className="cmp" style={{ width: "100%" }} data-testid="skill-compile-stages">
        <thead>
          <tr>
            <th style={{ textAlign: "left", width: "16%" }}>阶段</th>
            <th style={{ textAlign: "left", width: "16%" }}>状态</th>
            <th style={{ textAlign: "left" }}>说明</th>
          </tr>
        </thead>
        <tbody>
          {result.stages.map((s) => (
            <tr key={s.stage} data-testid="skill-compile-stage-row" data-stage={s.stage} data-stage-status={s.status}>
              <td>{STAGE_LABEL[s.stage] ?? s.stage}</td>
              <td>
                <span className={`badge ${s.status === "OK" ? "green" : s.status === "FAILED" ? "red" : "amber"}`}>
                  {/* 枚举值原样带出（不译成"未完成"这类模糊话）：NOT_IMPLEMENTED 是后端签的字。 */}
                  {s.status}
                </span>
              </td>
              {/* note 原文照登：NOT_IMPLEMENTED 时它写着「归哪张工单」，摘要掉就没法追。 */}
              <td style={{ fontSize: 11.5, lineHeight: 1.6 }}>{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notImplemented.length > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }} data-testid="skill-compile-not-implemented-note">
          ⚠️ {notImplemented.length} 段未实现（{notImplemented.map((s) => STAGE_LABEL[s.stage] ?? s.stage).join(" / ")}）——
          本报告**不含**任何可分发运行时制品，上方推理图是未经优化的派生图。
        </div>
      )}

      {/* —— 诊断：ok 时也要列（ok 只说明没有 error 级） —— */}
      {result.diagnostics.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="skill-compile-diagnostics">
          <div className="section-title">诊断（{result.diagnostics.length}）</div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: "16%" }}>诊断码</th>
                <th style={{ textAlign: "left", width: "10%" }}>级别</th>
                <th style={{ textAlign: "left", width: "16%" }}>位置</th>
                <th style={{ textAlign: "left" }}>说明与证据</th>
              </tr>
            </thead>
            <tbody>
              {result.diagnostics.map((d, i) => (
                <tr key={`${d.code}:${d.path}:${i}`} data-testid="skill-compile-diagnostic-row" data-diag-code={d.code} data-diag-severity={d.severity}>
                  <td className="mono" style={{ fontSize: 11 }}>{d.code}</td>
                  <td><span className={`badge ${SEVERITY_BADGE[d.severity] ?? ""}`}>{SEVERITY_LABEL[d.severity] ?? d.severity}</span></td>
                  {/* JSON Pointer；根路径后端给的是空串 ⇒ 留空，不补 "/"（那会指向一个它没说过的位置）。 */}
                  <td className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{d.path}</td>
                  <td style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                    {d.message}
                    {/* R13：证据原样亮出，不摘要 —— 没有它，诊断就退回成"有问题"这种没法照着修的话。 */}
                    {d.evidence !== undefined && (
                      <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4, wordBreak: "break-all" }} data-testid="skill-compile-diagnostic-evidence">
                        {d.evidence}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* —— 推理图：这条技能跑起来会依次碰哪些平台能力 —— */}
      <div style={{ marginTop: 12 }} data-testid="skill-compile-graph">
        <div className="section-title">
          推理图（{result.graph.nodes.length} 节点 · {result.graph.edges.length} 条边）
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {result.graph.nodes.map((n) => (
            <span
              key={n.id}
              className={`badge ${n.id === result.graph.entry ? "blue" : n.type === "exit_error" ? "red" : n.type === "create_action_draft" ? "amber" : ""}`}
              data-testid="skill-compile-graph-node"
              data-node-id={n.id}
              data-node-type={n.type}
              // onError 是**声明位**：null 表示该节点未声明异常语义，不是"声明了 FAIL"。
              title={`${n.type}${n.ref ? ` · ${n.ref.kind}:${n.ref.key}` : ""}${n.onError ? ` · onError=${n.onError}` : ""}`}
            >
              {n.ref ? `${n.ref.kind}:${n.ref.key}` : n.type}
            </span>
          ))}
        </div>
      </div>

      {/* —— 派生工具集：跑这条技能必然要用到平台的哪个工具（derived，非作者声明） —— */}
      {result.ast.tools.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="skill-compile-tools">
          <div className="section-title">派生工具（{result.ast.tools.length}）</div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
            由引用 kind 与写模式**推导**得出（`source: derived`），不是作者声明的字段——每条标出推它的依据。
          </div>
          {result.ast.tools.map((t) => (
            <div key={t.name} style={{ fontSize: 11.5, marginBottom: 3 }} data-testid="skill-compile-tool-row" data-tool-name={t.name}>
              <span className="badge mono">{t.name}</span>
              <span className="muted" style={{ marginLeft: 6 }}>← {t.impliedBy.join("、")}</span>
            </div>
          ))}
        </div>
      )}

      {/* —— execution.steps 的诚实位：恒空属「接了线没数据」，不是「这个技能没有步骤」 —— */}
      {!result.ast.execution.declared && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }} data-testid="skill-compile-execution-note">
          {result.ast.execution.note}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⑥ 出厂技能门审计诚实位 —— `GET /b/v1/ops/skill-seed-gate` 的可见面
// ---------------------------------------------------------------------------

/**
 * F14 的诚实位。**六态各有各的措辞，绝不合并**：
 *
 * | status | 界面措辞 | 绝不可渲染成 |
 * |---|---|---|
 * | `NOT_RUN`              | 未审计（灰） | 通过 / 绿 |
 * | `CLEAN`                | 通过（绿）   | — |
 * | `VIOLATIONS`           | 有违规（红） | — |
 * | `REGISTRY_UNREACHABLE` | 注册表读不出（黄）+ 上游原文 | 通过 / 绿 / 「网络不可达」 |
 * | `REGISTRY_EMPTY`       | 注册表答了 0 条（黄） | 通过 / 绿 / 「都合法」 |
 * | `GATE_UNAVAILABLE`     | 无法判定（黄）+ 原因原文 | 通过 / 绿 |
 *
 * 把 `NOT_RUN` / 三个不可用态画成绿色，就是把「我没找到」说成「它不存在」——
 * 那这道位就白加了（后端 `skill-publish-gate.ts` 原话）。
 *
 * **WO-SEEDGATE-FRESHNESS · 缺陷 B**：`REGISTRY_UNREACHABLE` / `REGISTRY_EMPTY` 是本单拆出来的。
 * 原先两者共用一句"注册表读不出来"，而后端播报的 reason 却二选一地说「DataCore is unreachable」
 * ——运维照那条结论去查网络，会查一整天查不到东西。现在**观测到哪一种就说哪一种**；
 * `REGISTRY_UNREACHABLE` 的措辞刻意**不**替上游下"不可达"这个结论，只说"读取抛错"并把原文摆出来。
 */
const SEED_GATE_VIEW: Record<SkillSeedGateReport["status"], { label: string; badge: string; hint: string }> = {
  NOT_RUN: { label: "未审计", badge: "", hint: "启动期审计尚未跑过 —— 这不等于出厂技能干净，只等于没人问过。" },
  CLEAN: { label: "通过", badge: "green", hint: "出厂技能已用与发布路完全相同的门问过一遍，零违规。" },
  VIOLATIONS: { label: "有违规", badge: "red", hint: "出厂技能经旁路落库时带着违规 —— 它们从未走过发布门。" },
  REGISTRY_UNREACHABLE: {
    label: "注册表读不出",
    badge: "amber",
    hint: "探针读注册表时抛错，门无法判定。⚠️ 这不等于「网络不可达」—— 鉴权失败 / 上游报错也落这一支，以下方原始错误原文为准。",
  },
  REGISTRY_EMPTY: {
    label: "注册表读回空集",
    badge: "amber",
    hint: "注册表答了，答的是 0 条已知 key —— 门无从比对。空集 ≠ 都合法；网络是通的，该查的是 A 侧注册表为何空。",
  },
  GATE_UNAVAILABLE: { label: "无法判定", badge: "amber", hint: "读不出（不可达或空集，未能区分）—— 没判定 ≠ 判定为好。" },
};

export function SkillSeedGateStrip({
  report,
  onRefresh,
  refreshing,
}: {
  report: SkillSeedGateReport | undefined;
  /** 显式手动刷新入口（`?refresh=1`）。缺省则不渲染按钮 —— 没有入口就别画一个假的。 */
  onRefresh?: () => void;
  refreshing?: boolean;
}): JSX.Element | null {
  // 还没取到（加载中/请求失败）⇒ 整块不渲染。不许先画一个"通过"再等真值回来。
  if (!report) return null;
  const view = SEED_GATE_VIEW[report.status];
  if (!view) return null;
  return (
    <div
      className="panel"
      style={{ marginBottom: 12, padding: "8px 12px" }}
      data-testid="skill-seed-gate"
      data-seed-gate-status={report.status}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12 }}>出厂技能发布门审计</span>
        <span className={`badge ${view.badge}`} data-testid="skill-seed-gate-status">{view.label}</span>
        {/* checked 是"审计了几个"，与 findings.length（"几个有违规"）不是一回事，分别点明所数何物。 */}
        <span className="badge mono" data-testid="skill-seed-gate-checked">已审 {report.checked} 个技能</span>
        {/*
          ranAt 必须**明说它是什么时刻**。WO-SEEDGATE-FRESHNESS 缺陷 A 的杀伤力全在这里：
          光秃秃一个时间戳会被读成"刚刚测过"，而它曾经是进程启动那一瞬的常量、三分钟不动。
          现在它是「这份数据真正被计算的时刻」，并把缓存窗口一并说清。
        */}
        {report.ranAt && (
          <span className="badge mono" data-testid="skill-seed-gate-ran-at" title="这份数据真正被计算的时刻（不是页面加载时刻）">
            实测于 {report.ranAt}
            {report.ttlSeconds !== undefined && `（缓存 ≤${report.ttlSeconds}s）`}
          </span>
        )}
        {onRefresh && (
          <button
            className="btn sm"
            onClick={onRefresh}
            disabled={refreshing === true}
            data-testid="skill-seed-gate-refresh"
            title="跳过缓存，立刻重跑一遍审计"
          >
            {refreshing === true ? "重测中…" : "重新实测"}
          </button>
        )}
        <span className="muted" style={{ fontSize: 11.5 }}>{view.hint}</span>
      </div>
      {/* 门不可用时的原因原文：运维照着它直接定位是哪个注册表读不出来。 */}
      {report.unavailableReason !== undefined && (
        <div className="mono" style={{ fontSize: 11, marginTop: 6, wordBreak: "break-all" }} data-testid="skill-seed-gate-reason">
          {report.unavailableReason}
        </div>
      )}
      {report.findings.length > 0 && (
        <div style={{ marginTop: 6 }} data-testid="skill-seed-gate-findings">
          {report.findings.map((f) => (
            <div key={f.skillId} style={{ fontSize: 11.5, marginTop: 3 }} data-testid="skill-seed-gate-finding" data-skill-key={f.skillKey}>
              <span className="badge red mono">{f.skillKey}</span>
              {/* 违规原文一字不改（含 code），那是要照着去修的信息。 */}
              {f.violations.map((v, i) => (
                <span key={i} style={{ marginLeft: 6 }}>
                  <span className="mono">{v.code}</span>：{v.message}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
