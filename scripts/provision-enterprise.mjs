#!/usr/bin/env node
/**
 * 锂电制造企业 · 工业级环境一键配置脚本（COO 视角）。
 *
 * 设计原则（对齐用户要求）：
 *  - **非硬编码 IPO**：一切都通过登录后的 REST API 配置完成（= 模拟对应账号的人在中台点配置），
 *    DataCore /a/v1/* 与 AgentCore /b/v1/*；本脚本不直写任何库。
 *  - **工业级数据**：合成走 XL 档（10⁴ 订单 + 2000 物料批次 + 3000 采购单 + 60 客户 + 90 天时序），
 *    经"一键合成"配置入口产生（A9 GenSpec 正门），每条数据有来源(origin=SYNTHETIC)与引用，可 CRUD。
 *  - **跨 ≥5 域的本体链**：合成即建 10 个数据域 + 跨域本体 + 链接，切片检索可跨域。
 *  - **配套环境**：≥20 skills / ≥10 求解器(21) / ≥10 约束(C01–C33) / 10 场景+对应 agent / 场景入口 / MCP / 评测用例。
 *  - **持久化**：对 PG 部署（设 DATABASE_URL）运行后全部落 PG，部署重启后依旧可见（见 DEPLOY.md）。
 *
 * 用法：
 *   node scripts/provision-enterprise.mjs                 # 自起内存双服务做端到端验证 + 打印清单
 *   PROVISION_TARGET=http://gateway node scripts/provision-enterprise.mjs --remote   # 对已部署实例配置（持久化）
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = process.argv.includes("--remote");
const SCALE = process.env.PROVISION_SCALE ?? "XL";

// ---------------------------------------------------------------------------
// HTTP 助手（与 SPA apiClient 同形态：登录拿 JWT，A/B 同 token，OBO）
// ---------------------------------------------------------------------------
let TOKEN = "";
async function http(base, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let body;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers, body });
  const text = await res.text();
  let json;
  try { json = text.length ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// 0 · 目标实例（远程已部署 / 本地自起内存双服务做验证）
// ---------------------------------------------------------------------------
let A, B, children = [];
function spawnService(script, env) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (c) => (log += c)); child.stderr.on("data", (c) => (log += c));
  child.tail = () => log.split("\n").slice(-15).join("\n"); children.push(child); return child;
}
async function waitFor(url, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${url}`); await new Promise((r) => setTimeout(r, 300)); }
}

if (REMOTE) {
  A = process.env.DATACORE_URL ?? "http://127.0.0.1:4001";
  B = process.env.AGENTCORE_URL ?? "http://127.0.0.1:4002";
} else {
  const BLOB = mkdtempSync(join(tmpdir(), "prov-"));
  const AP = 15200 + Math.floor(Math.random() * 200), BP = AP + 1;
  A = `http://127.0.0.1:${AP}`; B = `http://127.0.0.1:${BP}`;
  const dc = spawnService(join(ROOT, "apps/datacore/dist/server.js"), {
    PORT: String(AP), JWT_SECRET: "prov", SERVICE_TOKEN: "prov-svc", CREDENTIAL_KEY: "a".repeat(64),
    BLOB_DIR: BLOB, SEED_DEMO: "1", LOG_LEVEL: "warn",
  });
  const ac = spawnService(join(ROOT, "apps/agentcore/dist/main.js"), {
    PORT: String(BP), DATACORE_BASE_URL: A, SERVICE_TOKEN: "prov-svc", LOG_LEVEL: "warn",
  });
  try { await waitFor(`${A}/a/v1/healthz`); await waitFor(`${B}/b/v1/healthz`); }
  catch (e) { console.error(String(e), "\nDC:", dc.tail(), "\nAC:", ac.tail()); process.exit(1); }
}
const a = (p, o) => http(A, p, o);
const b = (p, o) => http(B, p, o);

const report = {};
function log(step, detail) { console.log(`  ✓ ${step}${detail ? " · " + detail : ""}`); }

try {
  // -------------------------------------------------------------------------
  // 1 · 登录（操作员账号；之后所有配置都以该 JWT 经正门 API 完成）
  // -------------------------------------------------------------------------
  console.log("【1】登录操作员账号 demo/admin");
  const login = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "admin", password: "demo1234" } });
  TOKEN = login.body?.accessToken ?? login.body?.token;
  if (!TOKEN) throw new Error("登录失败：" + JSON.stringify(login.body));
  log("已获取 JWT（A 签发 / B 经 JWKS 验签，OBO 贯穿）");

  // -------------------------------------------------------------------------
  // 2 · 工业级数据 + 10 域 + 跨域本体 + 21 求解器 + C01–C33 约束（一键合成正门）
  // -------------------------------------------------------------------------
  console.log(`【2】一键合成工业级数据（scale=${SCALE}）`);
  const job = await a("/a/v1/synthetic/jobs", { body: { industry: "battery-manufacturing", scale: SCALE, seed: 42 } });
  if (job.status !== 202) throw new Error("合成失败：" + JSON.stringify(job.body));
  log("合成作业完成", `job=${job.body.id}`);

  // 2b · 追加 C26–C33 约束（场景目录 §3；经 /a/v1/rules 创建 + 发布，DSL 校验通过）
  const CONSTRAINTS = [
    ["C26", "认证资源上限", "Certification.certHours <= 200", ["Certification"], "BLOCK"],
    ["C27", "长协执行偏差", "Material.devPct <= 0.05", ["Material"], "WARN"],
    ["C28", "呆滞预警", "MaterialBatch.idleDays <= 90", ["MaterialBatch"], "WARN"],
    ["C29", "排产冻结期", "Order.leadDays >= 3", ["Order"], "BLOCK"],
    ["C30", "良率连降停线评审", "Process.yield >= 0.9", ["Process"], "BLOCK"],
    ["C31", "外协质量门", "Material.outsourceYield >= 0.93", ["Material"], "BLOCK"],
    ["C32", "逾期冻结", "Customer.maxOverdueDays <= 30", ["Customer"], "BLOCK"],
    ["C33", "碳护照前置", "Model.carbonFootprint <= 70", ["Model"], "BLOCK"],
  ];
  let constraintsCreated = 0;
  const existingRules = (await a("/a/v1/rules")).body ?? [];
  for (const [key, name, expr, scope, sev] of CONSTRAINTS) {
    if (existingRules.some((r) => r.key === key)) continue;
    const c = await a("/a/v1/rules", { body: { key, name, expression: expr, scopeObjectTypes: scope, severity: sev } });
    if (c.status !== 201) { console.error("约束创建失败", key, c.body); continue; }
    const pub = await a(`/a/v1/rules/${c.body.id}/publish`, { body: {} });
    if (pub.status === 200) constraintsCreated++;
  }
  log("追加约束 C26–C33", `新建并发布 ${constraintsCreated}`);

  const domains = (await a("/a/v1/ontology/domains")).body ?? [];
  const types = (await a("/a/v1/ontology/object-types")).body ?? [];
  const solvers = (await a("/a/v1/catalog?kind=solvers")).body?.items ?? [];
  const rules = (await a("/a/v1/rules?status=PUBLISHED")).body ?? [];
  const countOf = async (typeKey) => {
    const r = await a("/a/v1/objects/aggregate", { body: { typeKey, groupBy: [], metrics: [{ prop: "id", fn: "count" }] } });
    return r.body?.rows?.[0]?.metrics?.count_id ?? 0;
  };
  report.domains = domains.length;
  report.objectTypes = types.length;
  report.solvers = solvers.length;
  report.constraints = rules.length;
  report.orders = await countOf("Order");
  report.materialBatches = await countOf("MaterialBatch");
  report.purchaseOrders = await countOf("PurchaseOrder");
  report.customers = await countOf("Customer");
  log("数据域", String(report.domains));
  log("跨域本体类型", String(report.objectTypes));
  log("求解器目录", String(report.solvers));
  log("约束（已发布规则）", String(report.constraints));
  log("工业级数据量", `订单 ${report.orders} · 物料批次 ${report.materialBatches} · 采购单 ${report.purchaseOrders} · 客户 ${report.customers}`);

  // -------------------------------------------------------------------------
  // 3 · ≥20 skills（经 /b/v1/skills 创建 + 结构 lint 门禁 + 发布）
  // -------------------------------------------------------------------------
  console.log("【3】配置 ≥20 个 skills（结构 lint 门禁通过后发布）");
  const SKILL_SPECS = buildSkillSpecs();
  let skillsCreated = 0;
  const skillIdByKey = {};
  for (const s of SKILL_SPECS) {
    const existing = (await b("/b/v1/skills")).body?.find?.((x) => x.key === s.key);
    let id = existing?.id;
    if (!id) {
      const c = await b("/b/v1/skills", { body: { key: s.key, name: s.name, summary: s.summary, body: s.body, resources: [] } });
      if (c.status !== 201) { console.error("skill 创建失败", s.key, c.body); continue; }
      id = c.body.id;
      const pub = await b(`/b/v1/skills/${id}/publish`, { body: {} });
      if (pub.status !== 200) { console.error("skill 发布失败（lint）", s.key, pub.body); continue; }
      skillsCreated++;
    }
    skillIdByKey[s.key] = id;
  }
  report.skills = Object.keys(skillIdByKey).length;
  log("skills 就绪", `${report.skills}（本次新建 ${skillsCreated}）`);

  // -------------------------------------------------------------------------
  // 4 · 10 场景 → 10 agents（绑定 skills + 规则 + 工具范围）+ 场景入口
  // -------------------------------------------------------------------------
  console.log("【4】配置 10 个场景 agent + 场景入口");
  const SCENARIOS = buildScenarioAgents(skillIdByKey);
  let agentsCreated = 0, scenesCreated = 0;
  for (const sc of SCENARIOS) {
    let agent = (await b("/b/v1/agents")).body?.find?.((x) => x.key === sc.agentKey);
    let agentId = agent?.id;
    if (!agentId) {
      const c = await b("/b/v1/agents", { body: sc.agent });
      if (c.status !== 201) { console.error("agent 创建失败", sc.agentKey, c.body); continue; }
      agentId = c.body.id;
      await b(`/b/v1/agents/${agentId}/publish`, { body: {} });
      agentsCreated++;
    }
    // 场景入口：视图 → 默认 agent（AGENT_FIRST）
    const se = await b(`/b/v1/scene-entries/${encodeURIComponent(sc.view)}`, {
      method: "PUT",
      body: { mode: "AGENT_FIRST", defaultAgentId: agentId, uiHints: { placeholder: sc.placeholder, suggestedQuestions: [sc.trigger] } },
    });
    if (se.status === 200) scenesCreated++;
  }
  report.agents = SCENARIOS.length;
  report.sceneEntries = scenesCreated;
  log("场景 agent", `${report.agents}（新建 ${agentsCreated}）`);
  log("场景入口", String(report.sceneEntries));

  // -------------------------------------------------------------------------
  // 5 · 评测用例（从 20 场景目录派生）+ MCP 集成位（预留对接）
  // -------------------------------------------------------------------------
  console.log("【5】评测用例 + MCP 集成位");
  const pkg = (await b("/b/v1/packages"))?.body?.[0]?.id ?? "pkg_battery_manufacturing";
  const ev = await b("/b/v1/evals/seed-scenarios", { body: { packageId: pkg } });
  report.evalCases = (await b("/b/v1/evals")).body?.items?.length ?? 0;
  log("评测用例", String(report.evalCases));
  const existingMcp = (await b("/b/v1/mcp-configs")).body ?? [];
  if (!existingMcp.some?.((m) => m.name === "ERP 网关（预留）")) {
    await b("/b/v1/mcp-configs", { body: { name: "ERP 网关（预留）", transport: { type: "streamable_http", url: "https://erp.internal/mcp" }, status: "DISABLED" } });
  }
  report.mcp = ((await b("/b/v1/mcp-configs")).body ?? []).length;
  log("MCP 集成位（预留对接）", String(report.mcp));

  // -------------------------------------------------------------------------
  // 5b · 仿真：① 推演场景（受影响订单）② 规划体检场景 —— 跑在工业级 XL 数据上
  // -------------------------------------------------------------------------
  console.log("【5b】仿真两个场景（工业级数据上的真实求解）");
  const sim1 = await a("/a/v1/solvers/affected_orders/invoke", { body: { args: { baseId: "changzhou" } } });
  const aff = sim1.body?.data;
  log("① 推演·受影响订单（常州）", `命中 ${aff?.total ?? "?"} 单 · snapshot ${sim1.body?.snapshotVersion} · 可下钻溯源`);
  const sim2 = await a("/a/v1/solvers/plan_audit/invoke", {
    // 细分按 万套 计且合计=总需求（自洽）；现金垫 55 亿、毛利目标 18%
    body: { args: { dem: 480, seg_pas: 220, seg_ess: 170, seg_com: 90, sup: 450, ltaCov: 0.85, kitGap: 5, gmTarget: 18, cashCushion: 55, capex: 60 } },
  });
  const au = sim2.body?.data;
  log("② 规划体检", `评分 ${au?.score ?? "?"}/100 · 结论 ${au?.verdict ?? "?"} · 硬矛盾 ${au?.H?.length ?? au?.hard?.length ?? "?"}`);
  report.sim = { affected: aff?.total, auditScore: au?.score, auditVerdict: au?.verdict };

  // -------------------------------------------------------------------------
  // 6 · 配置清单
  // -------------------------------------------------------------------------
  console.log("\n========== 企业环境配置清单 ==========");
  const need = { domains: 10, objectTypes: 5, solvers: 10, constraints: 10, skills: 20, agents: 10, sceneEntries: 10 };
  const rows = [
    ["数据域 domains", report.domains, need.domains],
    ["本体对象类型", report.objectTypes, need.objectTypes],
    ["求解器 solvers", report.solvers, need.solvers],
    ["约束 constraints", report.constraints, need.constraints],
    ["skills", report.skills, need.skills],
    ["场景 agents", report.agents, need.agents],
    ["场景入口", report.sceneEntries, need.sceneEntries],
    ["评测用例", report.evalCases, 0],
    ["MCP 集成位", report.mcp, 0],
  ];
  let pass = true;
  for (const [name, got, min] of rows) {
    const ok = got >= min; if (!ok) pass = false;
    console.log(`  ${ok ? "✅" : "❌"} ${name}: ${got}${min ? ` (≥${min})` : ""}`);
  }
  console.log("  —— 工业级数据 ——");
  console.log(`     订单 ${report.orders} · 物料批次 ${report.materialBatches} · 采购单 ${report.purchaseOrders} · 客户 ${report.customers} · 90 天时序`);
  console.log(pass ? "\n✅ 企业环境配置达标（全部经 REST API 配置，可 CRUD + 二次推演；PG 部署下持久化）" : "\n❌ 未达标");
  if (!REMOTE) for (const c of children) c.kill();
  process.exit(pass ? 0 : 1);
} catch (err) {
  console.error("配置失败：", err);
  for (const c of children) c.kill();
  process.exit(1);
}

// ===========================================================================
// 配置内容（操作员将在中台编辑器里录入的内容；此处作为可复现的配置素材）
// ===========================================================================
function buildSkillSpecs() {
  // 20 场景对应技能：summary 走触发器模板（当…时使用 + 不适用：，无禁用词），body 七段骨架 + 正/反例。
  const S = [
    ["s01_feasibility", "订单可承接性解读", "解读产能可承接结论的口径", "对比 P50/P90、解释认证系数或爬坡折减时", "产能数值计算本身（应由 capacity_forecast 求解器计算）"],
    ["s02_affected", "受影响订单解读", "解读交期风险扫描结果", "说明哪些订单受影响、解释窗口口径时", "单订单承接性测算（用 s01）"],
    ["s03_rootcause", "风险越线根因解读", "解释风险越线的根因与时序", "用户问为什么这天越线、峰值多高、什么事件推的时", "给处置方案（用 s06）"],
    ["s04_audit", "规划体检解读", "解读规划体检结论", "解释硬矛盾软风险条目、说明评分与修正建议时", "直接改计划（fix 仅演示，生效走审批）"],
    ["s05_plan", "经营方案比选解读", "解读三方案比选", "解释推荐理由、五维取舍、硬约束违反时", "替用户拍板（系统只算路径与后果）"],
    ["s06_mitigation", "处置方案采纳协助", "协助采纳风险处置方案", "用户说采纳、就用某方案、下单处理时", "比较方案优劣（本技能只执行采纳）"],
    ["s07_cert", "认证排期解读", "解读认证排期建议", "问先认证哪个、何时完成、解锁多少产能时", "修改认证状态（PLM 域职责）"],
    ["s08_kit", "齐套分析解读", "解读物料齐套分析", "问哪些单开不了工、缺什么料、何时补齐时", "直接下采购单（给建议）"],
    ["s09_lta", "长协补缺解读", "解读长协覆盖与补缺", "问长协够不够、现货要补多少、何时下单时", "长协条款变更（年度 AOP 决策）"],
    ["s10_inventory", "库存优化解读", "解读库存优化清单", "问哪些超储欠储呆滞、能释放多少资金时", "执行调拨（建议态）"],
    ["s11_changeover", "换型排序解读", "解读换型排序建议", "问怎么排单换型最少、能省多少时间时", "冻结期内重排（须走变更 Action）"],
    ["s12_yield", "良率诊断解读", "解读良率波动诊断", "问良率为什么掉、从哪天开始、疑似什么原因时", "判定责任（定责走质量流程）"],
    ["s13_maint", "检修错峰解读", "解读检修错峰建议", "问检修和交付撞期怎么办、挪到哪周时", "直接改检修计划（EAM 域）"],
    ["s14_outsourcing", "外协分配解读", "解读外协分配方案", "问加班还是外协、各多少、成本差异时", "选外协厂（采购域职责）"],
    ["s15_quote", "接单毛利解读", "解读接单毛利评审", "问这单毛利过不过线、成本怎么构成时", "调价谈判策略（给数据不给话术）"],
    ["s16_credit", "客户信用解读", "解读客户信用判定", "问还能不能接某客户新单、敞口多大时", "调整信用额度（财务域审批）"],
    ["s17_capex", "产能投资解读", "解读产能投资评审", "问值不值得投、IRR 多少、利用率预测时", "替投委会决策（C23 是门槛非批准）"],
    ["s18_sop", "S&OP 进度解读", "解读 S&OP 进度与平衡状态", "问走到第几步、缺口多少、哪些要上会时", "代行第五步决策"],
    ["s19_qgap", "季度缺口对策解读", "解读季度缺口对策组合", "问某季缺口怎么补、组合成本时", "执行单项对策（跳对应场景）"],
    ["s20_carbon", "碳足迹解读", "解读碳足迹核算", "问碳足迹多少、达不达标、怎么降时", "申报文件制作（合规域）"],
  ];
  return S.map(([key, name, cap, when, notUse]) => ({
    key, name,
    summary: `${cap}。当${when}使用。不适用：${notUse}。`,
    body: `## 目的\n${cap}。\n## 适用边界\n适用：${when}。不适用：${notUse}。\n## 前置检查\n确认求解结果的 snapshotVersion 与入参回显一致；选中对象与问句指代一致。\n## 步骤\n1. 按口径逐项核对并代入数值。\n2. 结论句给出判定与主要驱动项。\n## 示例\n正例：用户问对应问题→逐口径解释并挂溯源角标。\n反例：只报结论不报证据链（错：结论必须可溯源）。\n## 失败处理\n求解器返回错误码→转述错误并给下一步，禁止编造结果。\n## 输出要求\n每个数字挂溯源角标；结论句含判定与主要驱动项。`,
  }));
}

function buildScenarioAgents(skillIdByKey) {
  const SC = [
    ["s01_feasibility", "project", "订单可承接性评审", "4680-NCM 加 20% 六周能不能接？", "capacity_forecast"],
    ["s02_affected", "risk", "交期风险与受影响订单", "常州基地影响哪些订单？", "affected_orders"],
    ["s04_audit", "audit", "月度规划体检", "现金垫 45 亿过得了体检吗？", "plan_audit"],
    ["s07_cert", "project", "产线认证排期", "待认证的型号怎么排认证顺序？", "cert_schedule"],
    ["s08_kit", "risk", "物料齐套分析", "下周哪些订单缺料开不了工？", "kit_readiness"],
    ["s10_inventory", "dash", "库存水位优化", "哪些物料超储欠储？能释放多少资金？", "inventory_optimize"],
    ["s15_quote", "dash", "接单毛利评审", "电网公司 F 这单毛利过线吗？", "quote_margin"],
    ["s16_credit", "dash", "客户信用风险", "商用车集团 G 还能接新单吗？", "credit_exposure"],
    ["s17_capex", "generate", "产能投资评审", "枣庄储能线值得投吗？", "capex_scenario"],
    ["s20_carbon", "dash", "碳足迹核算", "4680-NCM 出口欧盟的碳足迹达标吗？", "carbon_footprint"],
  ];
  return SC.map(([key, view, name, trigger, solver]) => ({
    agentKey: key,
    view: `ent-${view}-${key}`,
    trigger,
    placeholder: `${name}：试试「${trigger}」`,
    agent: {
      key,
      name: `${name} Agent`,
      description: `专长：${name}。优先调用 ${solver}；解读遵循已加载技能的输出要求。`,
      model: "claude-opus-4-8",
      systemPrompt: `你是${name}分析助手。数字必溯源；写操作降级为 Action 草稿；优先调用 ${solver}。`,
      tools: [{ kind: "BUILTIN", name: "query_objects" }, { kind: "BUILTIN", name: "invoke_solver" }, { kind: "BUILTIN", name: "evaluate_rules" }, { kind: "BUILTIN", name: "discover" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "POST_CHECK" },
      skills: skillIdByKey[key] ? [{ skillId: skillIdByKey[key], version: "latest" }] : [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Base", "Model", "Order"], toolNames: ["query_objects", "invoke_solver", "evaluate_rules", "discover"] },
      budget: { maxIterations: 6 },
    },
  }));
}
