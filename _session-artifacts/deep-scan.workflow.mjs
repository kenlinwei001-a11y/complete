export const meta = {
  name: 'deep-scan-gaps',
  description: '全系统彻底深扫：13 功能切片 find → 对抗式 verify → 综合 gap 报告（真跑证据·非 grep）',
  phases: [
    { title: 'Find', detail: '13 个 finder 各深测一个功能切片，真 curl/真渲染取证，结构化报缺口' },
    { title: 'Verify', detail: '每个缺口对抗式复验：复跑 repro，确认真/驳回' },
    { title: 'Synthesize', detail: '去重排序，产出分级 gap 报告' },
  ],
};

const BOOT = `
【系统已起·真跑环境】
- DataCore: http://127.0.0.1:4001 (前缀 /a/v1)
- AgentCore: http://127.0.0.1:4002 (原生 /api/v1 + 别名 /b/v1)
- 前端 vite: http://127.0.0.1:5173
登录取 token: curl -s -X POST http://127.0.0.1:4001/a/v1/auth/login -H 'content-type: application/json' -d '{"tenantId":"demo","username":"admin","password":"demo1234"}' → 字段 .accessToken；后续带 header  Authorization: Bearer <token>。
开发链路亦可用 header  X-Debug-User: demo:admin:admin （调 AgentCore 建议带此头）。
演示账号(密码均 demo1234): admin(admin+planner+catalog_admin) / planner / base_manager:常州。租户 demo。
Kimi LLM 已配置并绑定 classifier/agent/comprehend/modeling(模型 kimi-k2.6·真打 api.moonshot.cn)。LLM 依赖流程现可真跑，但单次 10-90s——节制使用(每类至多 1-2 次)。
仓库根 /home/user/complete。可 Read 源码佐证，但缺口判定必须以真跑证据(真实状态码/响应体/真渲染)为准，禁止只凭 grep(假阴性)。临时脚本写到 /tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad。
【FDE 铁律】绿测试≠能用。重点找: 5xx 崩 · 死按钮(onClick 空/点无反应) · 空壳/空状态 · mock 冒充真实 · 断链(接缝处) · 不变量(R1-R17)违反 · 门禁(G-1..G-12)未闭 · 深链掉登录 · UX 裸错(裸 500/无引导)。
【纪律】不要重启/杀死正在运行的服务(datacore/agentcore/vite)，只做探测。破坏性变更避免；优先读 + 幂等探针。
`;

const GAP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['area', 'summary', 'gaps'],
  properties: {
    area: { type: 'string' },
    summary: { type: 'string', description: '本切片真测了哪些端点/流程·整体健康度一句话' },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'severity', 'kind', 'evidence', 'reproduce'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          kind: { type: 'string', enum: ['bug-5xx', 'dead-button', 'empty-state', 'missing-feature', 'mock-as-real', 'broken-chain', 'invariant-violation', 'gate-not-closed', 'ux-gap', 'deep-link-auth', 'other'] },
          evidence: { type: 'string', description: '真跑证据:真实 curl 状态码+响应体片段 或 真渲染所见' },
          reproduce: { type: 'string', description: '精确复现命令/步骤(可被复验者直接照跑)' },
          ontologyRef: { type: 'string', description: '触及的对象类型/链路/事件/不变量/断点' },
          proposedFix: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['isReal', 'confidence', 'reasoning', 'reproVerified'],
  properties: {
    isReal: { type: 'boolean', description: '复跑 repro 后确认是真缺口?' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    adjustedSeverity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'drop'] },
    reproVerified: { type: 'boolean', description: '是否真的复跑了 reproduce 命令' },
    reasoning: { type: 'string' },
  },
};

const SLICES = [
  { key: 'A0-IAM-权限-租户', prompt: `深测 A0 IAM + A6 行级权限 + 租户隔离。真测: ① 三账号(admin/planner/base_manager:常州)登录各拿 token; ② GET /a/v1/me/workspace 三角色返回的导航/视图/主题是否真不同; ③ 行级过滤: base_manager:常州 调 GET /a/v1/objects?type=Base 等是否只见常州(R6); ④ 跨租户: 用 demo token 试访问其它租户资源应 403/404; ⑤ entitlement 关闭功能→404 FEATURE_NOT_FOUND; ⑥ refresh token cookie / X-Debug-User(含 CJK 角色 base_manager:常州 URI 编码)。报实测到的缺口。` },
  { key: 'A1-连接器-A2-抽取', prompt: `深测 A1 连接器 + A2 规则文档抽取。真测: GET /a/v1/connector-types /connector-categories /connections; 建一个连接→测试连通; GET /a/v1/rule-docs；抽取流程; 凭据 R5: 任何响应不得回显明文密钥(只 credentialRef/hasApiKey)。报缺口。` },
  { key: 'A3-建模全链-A4-本体', prompt: `深测 A3 建模全链 + A4 本体。真跑完整链: POST /a/v1/modeling/derive {rawDatasetIds:[取 GET /a/v1/raw-datasets 前几个 id]} → 拿 draftId → PATCH /a/v1/modeling/drafts/{id} body {operations:[{op:"setDomain",typeKey,domain}]} 等改名/归域/设主键 → publish → materialize(看 created 数)。再 GET /a/v1/ontology/object-types /objects /ontology/graph /ontology/references /ontology/slices。验 R12 字段全建模门(未全建模能否 publish)。注: AI 路径 POST /a/v1/modeling/suggest(调 Kimi·90s)至多跑 1 次。报缺口。` },
  { key: 'A4-求解器-派生-S1', prompt: `深测求解器与派生。GET /a/v1/solvers/registry 取全部 key;逐个 POST /a/v1/solvers/{key}/invoke body {"args":{}} 看 5xx(真崩) vs 4xx(缺参·预期);对 5xx 的再补典型 args 重试。验确定性(同输入同输出)。CP-SAT optimizer 无 OPTIMIZER_BASE_URL 应 graceful 非崩。报真 5xx 崩 + 任何 mock 冒充真实。` },
  { key: 'A5-规则DSL-S2-Action审批', prompt: `深测 A5 规则 DSL + S2 Action 审批。GET /a/v1/rules /rule-docs; 规则求值; GET /a/v1/action-types /action-drafts; 走 Action 审批流(R4: 创建草稿→审批→执行,业务动作不得直写需经草稿)。验断点 G-10(规则是否一等可编辑引用 vs 被写死)。报缺口。` },
  { key: 'A7-合成-A8-时序时钟', prompt: `深测 A7 合成数据 + A8 时序/模拟时钟。验确定性: 同 (industry,scale,seed=42) 重生成是否字节级一致(连跑两次比对)。GET /a/v1/synthetic/clock /clock/ticks /timeseries/agg-specs; 推进模拟时钟; sim/sessions。报非确定性/断链。` },
  { key: 'S1.8-S&OP-计划', prompt: `深测 S1.8 S&OP + 计划族。GET /a/v1/sop/versions(是否空壳·对应 M3 母版满载 vs 系统空); /a/v1/plan/aop /plan/quarterly /plan-versions/current。若空壳/暂无数据,据 FDE 记为 empty-state 缺口。报缺口。` },
  { key: '校准-验证-数据健康', prompt: `深测校准/验证/数据健康。GET /a/v1/calibration/history /proposals /report; /a/v1/validation/runs; /a/v1/field-coverage(R12); /a/v1/data-health(每对象源系统+新鲜度) /ontology/mapping。验数据健康新鲜度是否真实联动(轨R#2 曾有短标签 vs 全名匹配 bug)。报缺口。` },
  { key: 'QOS编排-LLM', prompt: `深测 QOS 查询编排(LLM 依赖·节制: 至多 2 条问句)。POST /api/v1/queries (header X-Debug-User: demo:admin:admin) body {"packageId":"pkg_battery_manufacturing","query":"<自由问句>","context":{"view":"dashboard","selectedObjects":[],"filters":{}}} → 拿 taskId → 轮询 GET /api/v1/queries/{taskId} 到终态(COMPLETED/FAILED) → 看 trust/answer; GET /api/v1/queries/{taskId}/decision-trace 看是否真用 kimi-k2.6 + classify 路由。试一条该命中 Path A 工作流的(如产能/达成类)+一条 Path B 探索类。验 clarification/feedback/cancel。报缺口(如分类错、SSE 断、空答案、trust 标错)。` },
  { key: 'B1-Agent-B2-Workflow-B4-Skill', prompt: `深测 B1 Agent + B2 Workflow + B4 Skill。GET /b/v1/agents /workflows /skills /evals /evals/runs (header X-Debug-User: demo:admin:admin)。看能否列出/执行;空壳? 执行报错? 报缺口。` },
  { key: 'B3-MCP-B5-场景-growth', prompt: `深测 B3 MCP + B5 场景入口 + 自成长。GET /b/v1/mcp-configs /mcp/servers/solvers /scenes /scene-entries /scenarios; POST /api/v1/growth/probe(自由问句探缺口·节制1次)。验断点 G-3(场景启动器/presetContext 注入) G-9(场景卡发育闭环)。报缺口。` },
  { key: '前端视图扫-Playwright', prompt: `用 Playwright 真渲染扫前端(http://127.0.0.1:5173)。先确认 vite 在(curl 5173);浏览器: const pw=await import('/home/user/complete/node_modules/playwright-core/index.js'); chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']})。登录(/login 填 #login-tenant=demo #login-username=admin #login-password=demo1234 点 submit)。然后真访问尽量多的视图(经导航点击 + 直接深链 /v/... 各试)。逐视图查: 死按钮(点了无反应/onClick 空) · 空壳/空状态 · 控制台 error · 深链直接访问是否掉回登录。截图佐证存 scratchpad。报实拍到的缺口(附视图名+所见)。` },
  { key: '不变量R+断点G现状核', prompt: `读 docs/SYSTEM-ONTOLOGY.md §5(不变量 R1-R17) 与 §8(断点 G-1..G-12)。抽样真测关键几条声称的状态 vs 实际: 如 R5(凭据不回显·已可真测) R12(字段全建模门) R6(行级过滤) R14(零业务常量·前端数来自后端非写死); G-3/G-5/G-8/G-9/G-10 声称的闭合度。标出"本体声称闭合/已修但实测仍未闭"或"本体已过期未回写"的偏差。报缺口(kind 多为 invariant-violation/gate-not-closed/other)。` },
];

function verifyPrompt(g, areaKey) {
  return `${BOOT}\n你是对抗式复验者(默认怀疑)。复验下面这条来自「${areaKey}」的缺口断言——真的去复跑 reproduce 命令,亲眼看结果,再判定。无法复现/证据不支持 → isReal=false。\n\n标题: ${g.title}\n严重度(报告方): ${g.severity} | kind: ${g.kind}\n证据(报告方): ${g.evidence}\n复现步骤: ${g.reproduce}\n\n要求: ① 真的执行 reproduce(curl/渲染),把你看到的真实结果作为 reasoning 依据; ② reproVerified 标你是否真复跑了; ③ 若真但严重度报错了,用 adjustedSeverity 修正;若是预期行为/误报,adjustedSeverity=drop 且 isReal=false。`;
}

// ---- 执行 ----
log('深扫启动: 13 切片 find → 对抗 verify → 综合');
const perArea = await pipeline(
  SLICES,
  (slice) => agent(`${BOOT}\n【你的切片】${slice.key}\n${slice.prompt}\n\n只报实测到的、有真跑证据的实质缺口(别报 nitpick)。无缺口就返回空 gaps 数组并在 summary 说明已测项。`,
    { label: `find:${slice.key}`, phase: 'Find', schema: GAP_SCHEMA }),
  (found, slice) => {
    if (!found || !Array.isArray(found.gaps) || found.gaps.length === 0) {
      return { area: slice.key, summary: found?.summary ?? '(无返回)', verified: [] };
    }
    return parallel(found.gaps.map((g) => () =>
      agent(verifyPrompt(g, found.area || slice.key), { label: `verify:${slice.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then((v) => ({ ...g, area: found.area || slice.key, verdict: v }))
        .catch(() => null),
    )).then((vs) => ({ area: found.area || slice.key, summary: found.summary, verified: vs.filter(Boolean) }));
  },
);

const areas = perArea.filter(Boolean);
const allGaps = areas.flatMap((a) => a.verified);
const confirmed = allGaps.filter((g) => g.verdict && g.verdict.isReal && g.verdict.adjustedSeverity !== 'drop');
log(`Find 完成: ${areas.length} 切片; 报告缺口 ${allGaps.length}; 复验确认 ${confirmed.length}`);

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'themes', 'rankedGaps'],
  properties: {
    headline: { type: 'string' },
    themes: { type: 'array', items: { type: 'string' }, description: '横切主题(反复出现的缺口模式)' },
    rankedGaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'severity', 'area', 'kind', 'evidence', 'fix'],
        properties: {
          title: { type: 'string' }, severity: { type: 'string' }, area: { type: 'string' },
          kind: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
          ontologyRef: { type: 'string' },
        },
      },
    },
    coverageNote: { type: 'string', description: '哪些切片测得透/哪些受限(如 LLM 节制、未触达)' },
  },
};

phase('Synthesize');
const confirmedForSynth = confirmed.map((g) => ({
  title: g.title, severity: g.verdict.adjustedSeverity && g.verdict.adjustedSeverity !== 'drop' ? g.verdict.adjustedSeverity : g.severity,
  area: g.area, kind: g.kind, evidence: String(g.evidence).slice(0, 500), reproduce: String(g.reproduce).slice(0, 300),
  ontologyRef: g.ontologyRef || '', confidence: g.verdict.confidence,
}));
const report = await agent(
  `你是综合官。下面是 13 切片深扫、经对抗式复验确认为真的缺口清单(JSON)。请: ① 去重合并同一根因的条目; ② 按 P0>P1>P2>P3 与影响面排序; ③ 提炼横切主题; ④ 每条给一句可执行 fix。诚实标注覆盖盲区。\n\n确认缺口:\n${JSON.stringify(confirmedForSynth, null, 1)}\n\n各切片 summary:\n${areas.map((a) => `- ${a.area}: ${a.summary}`).join('\\n')}`,
  { phase: 'Synthesize', schema: REPORT_SCHEMA },
);

return {
  stats: { slices: areas.length, reported: allGaps.length, confirmed: confirmed.length },
  byArea: areas.map((a) => ({ area: a.area, reported: a.verified.length, confirmed: a.verified.filter((g) => g.verdict?.isReal && g.verdict?.adjustedSeverity !== 'drop').length })),
  report,
  confirmedGaps: confirmedForSynth,
};
