import { LIVED_IN_SCENE_HISTORY, BASE_REGISTRY, PLAN_GOAL_TARGETS, assertSharedFeatureNames } from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：规则表达式/抽取候选里的阈值一律派生，禁内联裸阈值/手写百分数。
import { OUTSOURCE_REDLINE, outsourceRedlineConstraintExpr, outsourceRedlinePct, outsourceRedlineViolationExprPublished, ruleParamRef } from "@platform/contracts";
import type {
  ActionDraft,
  AdminTenant,
  AdminUser,
  AdminViewConfig,
  AgentDefinition,
  Answer,
  ConnectorType,
  FeatureDef,
  IntentDefinition,
  McpServerConfig,
  PermissionPolicy,
  RuleEntry,
  SceneEntryConfig,
  Scenario,
  SkillDefinition,
  WorkflowDefinition,
  RiskTimelineOutput,
  // WO-BEFE-B · 行动与审批组（契约已有的形状从这里来）
  FactoryCalendar,
  VirtualPersona,
  OpsPlaybook,
  OpsTickReport,
} from "@platform/contracts";
import type {
  FallbackClusterVM,
  OntologyGraphVM,
  ScheduledJobVM,
  SchedulerRunVM,
  SimClockVM,
  TickReportVM,
  WorkspaceInput,
} from "@/api/types";
import type { ModelingDraftVM, RuleCandidateVM, RuleDocVM } from "@/api/endpoints";

// ⚠ 这两个常量的**定义**已挪到叶子模块 `./ids`，此处只做 re-export（对外 API 一字未变）。
//   原因见 ids.ts 文件头：`export … from "./planBuilderFixtures"` 会被提升，
//   导致浏览器先求值 planBuilderFixtures 而此处常量仍在 TDZ ⇒ 整个 mock 模式白屏。
// ⚠ 必须 **import 后再 export**，不能写 `export … from "./ids"` —— 后者只建立转发、
//   **不创建本地绑定**，而本文件内部多处直接用 PACKAGE_ID/TENANT_ID（如第 800 行附近），
//   写成转发式会得到 `PACKAGE_ID is not defined`（第一次改就踩到，浏览器当场报出来）。
import { TENANT_ID, PACKAGE_ID } from "./ids";
export { TENANT_ID, PACKAGE_ID };

// ---------------------------------------------------------------------------
// 账号（QOS §7.6 权限种子：planner 全量 / base_manager:常州 行级过滤）
// ---------------------------------------------------------------------------

export interface MockAccount {
  username: string;
  password: string;
  roles: string[];
  baseScope: string[] | null; // null = 全部
}

export const ACCOUNTS: MockAccount[] = [
  // 管理平台增量 §2：planner 演示账号兼具 tenant_admin（用户管理入口）
  { username: "planner", password: "demo1234", roles: ["planner", "admin", "catalog_admin", "tenant_admin"], baseScope: null },
  { username: "base_manager", password: "demo1234", roles: ["base_manager:常州"], baseScope: ["常州"] },
  // 管理平台增量 §1/§2：平台超管（仅 /admin/tenants；不读业务数据）
  { username: "padmin", password: "demo1234", roles: ["platform_admin"], baseScope: null },
];

// ---------------------------------------------------------------------------
// 基地 ×13 / 型号 ×6 / 订单 ×20（电池种子）
// ---------------------------------------------------------------------------

// DF.1 单一来源：基地集从 @platform/contracts BASE_REGISTRY 派生（与 datacore 同源，灭漂移 G-5/R14）。
// 前端表示 = {id=base-${name}, name, util, bottleneck, gwh, position, lines, prodYear, mainProduct, lon, lat}（值字节复现，R6）。
export const BASES = BASE_REGISTRY.map((b) => ({
  id: `base-${b.name}`,
  name: b.name,
  util: b.util,
  bottleneck: b.bottleneck,
  gwh: b.gwh,
  position: b.position,
  lines: b.lines,
  prodYear: b.prodYear,
  mainProduct: b.mainProduct,
  lon: b.lon,
  lat: b.lat,
}));

/**
 * DF.1 单一来源：**单条基地引用**也从册派生（不只 BASES 集合）。
 * 病灶（WO-76 修）：风险卡/处置种子/场景预设曾内联 `base:"常州", baseId:"changzhou"` 这种
 * (中文名, 拼音 id) 对共 9 处 —— 册里改 baseId 或删基地，这些引用会**静默指向不存在的基地**
 * （正是 DF.1 要灭的 G-5/R14 漂移，只是粒度是"单条"而非"整集"）。
 * 现一律 `baseRef(中文名)` 查册派生：name 是册自述的"跨端共同 key"（base-registry.ts:16），
 * 可派生的 baseId 只从册来；查不到即**抛错早失败**，不留静默悬空引用。
 * R6：`baseRef("常州")` → `{base:"常州", baseId:"changzhou"}`，与迁移前字节一致。
 */
const baseRef = (name: string): { base: string; baseId: string } => {
  const hit = BASE_REGISTRY.find((b) => b.name === name);
  if (!hit) throw new Error(`[fixtures] 基地「${name}」不在 BASE_REGISTRY 单一来源册（DF.1/R14）`);
  return { base: hit.name, baseId: hit.baseId };
};

export const MODELS = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"];

// WO-GUI4-MULTIOBJ-REAL · mock 同步真 Order 口径（VITE_MOCK 也带 unitPrice/pri 真形状·不再写死另一套假单）：
// unitPrice 元/套（动力 NCM 溢价 / 储能 LFP 偏低·对齐 datacore Model.unitPrice≈priceWan×1e4 量级），供
// 营收=qty×unitPrice 真派生；pri 优先级驱动违约金口径。与真后端 /a/v1/objects?type=Order 同字段集。
const MODEL_UNIT_PRICE: Record<string, number> = {
  "4680-NCM": 22000,
  "VDA-NCM": 20000,
  "4680-LFP": 16000,
  "刀片-LFP": 15000,
  "储能-280Ah": 14000,
  "储能-314Ah": 14500,
};
// 优先级循环周期 7（与 qty 随 i 单调递增去相关 → 同化学体系内小单可高优先/大单可低优先·令权重取舍真翻转）。
const PRI_CYCLE = ["高", "中", "低", "中", "高", "低", "中"];

const CUSTS = ["蔚途汽车", "星河储能", "极光新能源", "蓝海电网", "山岳重工"];
// WO-W5·mock 客户 → 业务类型（乘/商/储·与 datacore businessTypeOfCustomer 同口径·三类都覆盖）。
const CUST_BUSINESS_TYPE: Record<string, "passenger" | "commercial" | "storage"> = {
  蔚途汽车: "passenger", 星河储能: "storage", 极光新能源: "commercial", 蓝海电网: "storage", 山岳重工: "commercial",
};

export const ORDERS = Array.from({ length: 20 }, (_, i) => {
  const base = BASES[i % 13]!;
  const cust = CUSTS[i % CUSTS.length]!;
  const businessType = CUST_BUSINESS_TYPE[cust] ?? "passenger";
  const model = MODELS[i % MODELS.length]!;
  // 商用车订单波动整形（确定性·镜像 datacore shapeBusinessTypeQty·体量小·dev 态波动可见）。
  const rawQty = Math.round((500 + i * 137) * 2.84);
  const volFactors = [0.32, 2.3, 0.55, 1.9];
  const qty = businessType === "commercial" ? Math.max(1, Math.round(rawQty * volFactors[i % volFactors.length]!)) : rawQty;
  // 乘用车部分客户提前交付（确定性·i%3）。
  const early = businessType === "passenger" && i % 3 === 0;
  return {
    id: `ord-${String(i + 1).padStart(3, "0")}`,
    so: `SO-${String(10001 + i)}`,
    cust,
    model,
    qty,
    due: `2026-0${(i % 6) + 4}-${String((i % 27) + 1).padStart(2, "0")}`,
    bases: base.name,
    status: i % 5 === 0 ? "AT_RISK" : "ON_TRACK",
    businessType,
    early,
    // WO-GUI4-MULTIOBJ-REAL：单价（营收=qty×unitPrice）+ 优先级（驱动违约金口径）·真后端 Order 同字段集。
    unitPrice: MODEL_UNIT_PRICE[model] ?? 18000,
    pri: PRI_CYCLE[i % PRI_CYCLE.length]!,
  };
});

// ---------------------------------------------------------------------------
// FeatureRegistry（Entitlement §2 首批注册清单）
// ---------------------------------------------------------------------------

/**
 * ⚠ 功能名（`name`）的单一真相源是 `@platform/contracts` 的 `SHARED_FEATURE_NAMES`
 * （WO-VIEWNAME-SINGLE-SOURCE）。mock 的职责是**如实复刻生产**：这份表在 `VITE_MOCK=1`
 * 下经 handlers.ts 的 `GET …/a/v1/features/registry` 桩喂给「功能开通配置」页 —— 与生产同一个页面、
 * 同一个字段（`FeaturesPage` 渲染 `def.name`）。mock 自起一个名字 = 演示态在对用户说谎，
 * 而且是最难发现的那个方向（两边都"看起来对"）。
 * 2026-08-14 实测：本表曾在 5 个键上与后端各写一个名（`view.risk-board` 写「推演看板」而册是
 * 「风险推演看板」·`shell.query-dock`·`qos.agent-fallback`·`view.project-sim.whatif`·
 * `admin.plan-builder`）。复验命令：
 * `pnpm --filter frontend-shell exec vitest run test/feature-name-single-source.seam.test.ts`。
 * 下面的字面量是**受检副本**，`assertSharedFeatureNames()` 在模块加载期逐条核对，不符即抛；
 * mock 独有的键（`view.aop` / `view.graph-*` / `view.dash.widget.gwh`）不跨服务、不在册内，
 * 保持本地自治。
 */
export const FEATURE_REGISTRY: FeatureDef[] = assertSharedFeatureNames([
  { key: "view.dash", name: "驾驶舱", level: "VIEW", defaultOn: true, bindings: { intents: ["capacity_feasibility"] } },
  { key: "view.ontology-graph", name: "本体图谱", level: "VIEW", defaultOn: true },
  { key: "view.risk-board", name: "风险推演看板", level: "VIEW", defaultOn: true, bindings: { intents: ["affected_orders", "risk_root_cause"], solverKeys: ["risk_timeline"] } },
  { key: "view.ledger", name: "订单台账", level: "VIEW", defaultOn: true, bindings: { intents: ["affected_orders"] } },
  { key: "view.plan-audit", name: "规划体检", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_audit_run"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "view.plan-generate", name: "规划建议", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["plan_generate"] } },
  { key: "view.sop-balance", name: "月度规划", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["sop_balance"] } },
  { key: "view.project-sim", name: "项目推演", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["capacity_forecast"] } },
  { key: "view.global-sim", name: "全局项目推演", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["portfolio"] } },
  // 全局推演·活系统 NL/方案存比暗发门（mock 态开·MSW 桩支撑·真后端 defaultOff 避 404）。
  { key: "view.global-sim.live", name: "全局推演·活系统(NL/方案存比)", level: "BLOCK", defaultOn: true },
  // 原型中的 story 视图无后端支持 → 保留 aop 直链入口演示「该视图类型暂不支持」兜底（renderer="aop" 未注册）
  { key: "view.aop", name: "年度规划（旧入口）", level: "VIEW", defaultOn: true },
  // 剩余视图增量（§7.14–7.17 / §7.19）
  { key: "view.annual-scenario", name: "年度规划", level: "VIEW", defaultOn: true },
  { key: "view.quarterly-rolling", name: "季度规划", level: "VIEW", defaultOn: true },
  { key: "view.order-chain", name: "订单进展与卡因", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["affected_orders"] } },
  { key: "view.geo-map", name: "基地地理视图", level: "VIEW", defaultOn: true },
  // 运营态出厂配置增量 §2/§4：运营复盘（只读历史证据链页面，消费 GET /a/v1/history/bundle）
  { key: "view.review", name: "运营复盘", level: "VIEW", defaultOn: true, bindings: { apiTags: ["history"] } },
  { key: "view.task-dag", name: "任务详情·编排 DAG", level: "BLOCK", defaultOn: true },
  // ── 推演沙盘四子视图（WO-NAV-GATE · mock 对齐后端真实下发）─────────────────────
  //
  // 为什么此前 mock 里一条都没有 —— 而这正是 G-NAV-FALLBACK-BUCKET 的机械门写不出来的原因：
  // 后端 `apps/datacore/src/synthetic/view-manifest.ts` 的 `BUILTIN_VIEWS` 早已把这四项入册
  // （seed:true → scenarioSeed.views → GET /a/v1/me/workspace 真实下发 26 视图 / 44 nav），
  // 而 mock 停在 22 项。差集恰好就是「落进『其它』兜底桶的那四个」——
  // 于是在 mock 上写「业务视图不得落『其它』」的断言**恒真**，是哑门（本仓 `provenRed` 字段存在的理由）。
  //
  // `sim.sandbox` 在后端 `features.ts` 写着 `defaultOn: false`，看上去像"暗发没开"，
  // **但那是 L1**：demo 租户的 L2 行业模板（battery = ALL_FEATURE_KEYS − QOS/PERF 暗发集）把 sim.* 全开了
  // （见 `apps/datacore/src/seed.ts:71-79` 的实测注记）。mock 若照抄 L1 的 false，
  // 四个视图会被级联过滤掉 —— 那是「接了线没数据」，跟没接线一样测不出东西。故此处 defaultOn: true。
  { key: "sim.sandbox", name: "推演沙盘", level: "VIEW", defaultOn: true },
  { key: "view.chain-line-map", name: "全链线路图", level: "VIEW", defaultOn: true, requires: ["sim.sandbox"], bindings: { solverKeys: ["chain_loss_attribution"] } },
  { key: "view.transit-flow", name: "在途与在制", level: "VIEW", defaultOn: true, requires: ["sim.sandbox"] },
  { key: "view.physical-topology", name: "物理拓扑", level: "VIEW", defaultOn: true, requires: ["sim.sandbox"] },
  { key: "view.node-inspector", name: "节点检视", level: "VIEW", defaultOn: true, requires: ["sim.sandbox"] },
  // WO-IMPEDIMENTS-REACHABLE：沙盘第五子视图（后端 BUILTIN_VIEWS 同批入册）。mock 缺它 ⇒
  // `nav-group-coverage:check` 判据② 红，且 f61 的归组断言对它恒真（哑门）——同 #99/#110 的病根。
  { key: "view.chain-impediments", name: "全链阻滞点", level: "VIEW", defaultOn: true, requires: ["sim.sandbox"], bindings: { solverKeys: ["chain_impediments"] } },
  // WO-WAITING-STATES-FE：流程等待态（后端 BUILTIN_VIEWS 同批入册·seed:true）。
  // 不挂 requires —— 业务流程层是配置驱动的主数据，与 sim.sandbox 无从属关系（挂上去是假依赖）。
  { key: "view.process-wait", name: "流程等待态", level: "VIEW", defaultOn: true },
  // WO-R9-NAVREACH：采购四段腿分解（后端 BUILTIN_VIEWS 同批入册·seed:true）。
  // 不挂 requires —— 采购/齐套域业务主数据页，与 sim.sandbox 无从属关系（挂上去是假依赖）。
  // 不挂 bindings.solverKeys ——`kit_readiness` 是多路共用求解器（见后端 view-manifest 该行注释），
  // 绑上去会让「关这一页」连带 404 掉所有别的调用方（mock handlers.ts:3701 的 boundOff 分支同理）。
  { key: "view.procurement-legs", name: "采购四段腿分解", level: "VIEW", defaultOn: true },
  // WO-PROCESS-INSTANCE · 流程运行时（实例·卡点）——「为什么**这一张单**现在卡住了」。
  // ⚠ `defaultOn: false` 在这里是**照抄真相**，不是照抄 L1（与上面 sim.* 那批的处置刚好相反）：
  //   `process.runtime` 同时进了后端的 `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`
  //   （`apps/datacore/src/features.ts:244`），battery 模板的 L2「all on」**会跳过它** ⇒
  //   对真实 demo 租户它就是**关着的**。mock 若写 true，演示态会比生产态多一页 ——
  //   那是 mock 在说谎，而且是往"功能更全"的方向说谎（最难发现的那个方向）。
  // 要在 mock 模式看这一页：`db.tenantOverrides["process.runtime"] = true`（正是租户开通的等价动作）。
  { key: "process.runtime", name: "流程运行时（实例·卡点）", level: "VIEW", defaultOn: false },
  // ── WO-BEFE-D · 两个新键，**两个方向相反的真相**（照抄 resolve 后的结果，不照抄注册表字面量）──
  //
  // 判据是 `apps/datacore/src/features.ts:342 templateFeatures()`：battery 模板 =
  // `ALL_FEATURE_KEYS` **减去** 四个暗发集合（QOS / PERF / WORLD / INCOMPLETE_DATA）。
  // 于是 `defaultOn:false` 这个字面量**单靠自己拦不住** demo 租户 —— 进没进那四个集合才是判据。
  //
  //  · `org.world` **在** `WORLD_DARK_LAUNCH_FEATURES`（features.ts:222）⇒ 对 demo 租户**真的关**。
  //    后端 `org-world.test.ts:450` 用真 HTTP + demo 租户断言 404 FEATURE_NOT_FOUND，坐实这一点。
  //    mock 写 false = 照抄真相；要在 mock 模式看这一页：`db.tenantOverrides["org.world"] = true`。
  //  · `decision.causal-graph` **不在**任何暗发集合里（features.ts:95 只写了 defaultOn:false）
  //    ⇒ battery 模板 L2「all on」**会把它打开** ⇒ 对 demo 租户实际是**开**的。
  //    mock 若照抄 L1 的 false，因果图面板会被级联过滤掉，接缝断言恒真（哑门）——
  //    这正是上面 sim.* 那批注释里写的同一个坑，故此处 defaultOn: true。
  { key: "org.world", name: "组织世界（人/角色/部门/职权/审批额度/代理）", level: "VIEW", defaultOn: false },
  { key: "decision.causal-graph", name: "决策因果图", level: "BLOCK", defaultOn: true },
  { key: "act.aop-finalize", name: "AOP 情景拍板", level: "ACTION", defaultOn: true, requires: ["view.annual-scenario"] },
  // 图谱八视角（§7.18：零新代码视角，BLOCK 级逐个开关；key 与视图 key 对齐路由守卫 view.{viewKey}）
  { key: "view.graph-all", name: "图谱·业务建模全景", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-backbone", name: "图谱·推演主干分级", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-flow", name: "图谱·产能推演网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-source", name: "图谱·数据来源", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-solver", name: "图谱·求解器布局", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-mvp", name: "图谱·MVP 核心与缺口", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-agent", name: "图谱·智能体网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph-loop", name: "图谱·学习闭环", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "shell.query-dock", name: "查询对话坞", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "Agent 兜底（路径 B）", level: "BLOCK", defaultOn: true },
  { key: "view.project-sim.whatif", name: "What-if 调参", level: "BLOCK", defaultOn: true, requires: ["view.project-sim"] },
  { key: "view.risk-board.mitigation", name: "处置方案区", level: "BLOCK", defaultOn: true, requires: ["view.risk-board"], bindings: { intents: ["adopt_mitigation"] } },
  { key: "view.dash.widget.gwh", name: "驾驶舱·总产能卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "act.plan-audit.apply-fix", name: "体检一键修正", level: "ACTION", defaultOn: true, requires: ["view.plan-audit"] },
  { key: "act.adopt-to-draft", name: "采纳为草稿", level: "ACTION", defaultOn: true, requires: ["view.risk-board"], bindings: { intents: ["adopt_mitigation"] } },
  { key: "act.export", name: "导出", level: "ACTION", defaultOn: true },
  // 优化融合（G-12）：暗发 defaultOff（与后端 features.ts 同步）——关则前端整块不存在（R3）。
  { key: "opt.solver-pool", name: "优化模板池", level: "VIEW", defaultOn: false },
  { key: "opt.whatif", name: "优化 what-if", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"], bindings: { solverKeys: ["optimize_whatif"] } },
  // WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用。
  { key: "opt.multiobj", name: "多目标 + 跨对象占用", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"], bindings: { solverKeys: ["multi_objective", "cross_object_occupancy"] } },
  // WO-A · No-code Plan Builder Canvas（Phase 1：线性多 solver 链）。defaultOn 与两侧后端注册表 parity。
  { key: "admin.plan-builder", name: "计划构建器", level: "BLOCK", defaultOn: true },
  /**
   * WO-BEFE-F 实测补齐的 **parity 缺口**：`qos.dril-routing` 在**两侧后端都注册了**
   * （`apps/datacore/src/features.ts:125` · `apps/agentcore/src/features/registry.ts:117`，
   * 均 `defaultOn: false` 暗发），而本 mock 注册表**没有它** —— 于是
   * `featuresForAccount()` 只遍历 FEATURE_REGISTRY，`db.tenantOverrides["qos.dril-routing"]=true`
   * **静默失效**（改了个不存在的键），/admin/resources 恒 404。
   *
   * 形态（铁律 0.6 句式）：「我用『设了 tenantOverride』当作『功能被打开了』的证据，
   * 而前者并不度量后者 —— 覆盖表只对注册表里有的键起作用。」
   * 这一条正是工单提醒的那个坑：**功能键 ≠ 路由键**，而且注册表漏一个键 = 该功能永远开不出来。
   */
  { key: "qos.dril-routing", name: "DRIL 智能资源路由（Path-B 组包注入）", level: "BLOCK", defaultOn: false },
], "frontend-shell/src/mocks/fixtures.ts FEATURE_REGISTRY");

/** 账号 → 生效功能集（base_manager 关闭 view.plan-audit 与 act.adopt-to-draft，演示 404 与 E2） */
export function featuresForAccount(account: MockAccount, tenantOverrides: Record<string, boolean>): string[] {
  let keys = FEATURE_REGISTRY.filter((f) => tenantOverrides[f.key] ?? f.defaultOn).map((f) => f.key);
  // 级联：父关子关
  for (const f of FEATURE_REGISTRY) {
    if (f.requires?.some((r) => !keys.includes(r))) keys = keys.filter((k) => k !== f.key);
  }
  if (account.username === "base_manager") {
    keys = keys.filter((k) => k !== "view.plan-audit" && k !== "act.adopt-to-draft" && k !== "act.plan-audit.apply-fix");
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Workspace（两账号导航/视图/主题不同）
// ---------------------------------------------------------------------------

// 去电池锁死 8a（R14）：规划体检字段组结构由 ViewConfig.layout 声明（非前端写死）。
// 含一个独有"配置驱动分组-X"——它渲染出来即证明字段组走的是配置、不是组件 FIELD_GROUPS 兜底。
const PLAN_AUDIT_LAYOUT = {
  fieldGroups: [
    {
      title: "需求侧（万套）",
      fields: [
        { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
        { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 },
        { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
        { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 },
      ],
    },
    {
      title: "供给侧",
      fields: [
        { key: "sup", label: "月度可供给", unit: "万套", step: 0.1 },
        { key: "ltaCov", label: "长协覆盖率", unit: "%", step: 1 },
        { key: "kitGap", label: "正极物料缺口", unit: "吨", step: 10 },
      ],
    },
    {
      title: "财务侧",
      fields: [
        { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.5 },
        { key: "cashCushion", label: "现金安全垫(13周最低点)", unit: "亿", step: 0.5 },
        { key: "capex", label: "CAPEX 本月", unit: "亿", step: 0.5 },
      ],
    },
    { title: "配置驱动分组-X", fields: [] },
  ],
};

// 去电池锁死 8a（R14）：规划建议目标字段结构由 ViewConfig.layout.goalFields 声明（非前端写死）。
// sharePts 标签带独有"·配置驱动X"——渲染出来即证明结构走配置。键/单位/步长与组件一致，f16 用 key-testid 不受影响。
const PLAN_GENERATE_LAYOUT = {
  goalFields: [
    { key: "revGrowthPct", label: "收入增长", unit: "%", step: 1 },
    { key: "gmFloorPct", label: "毛利底线", unit: "%", step: 0.1, hardKey: "hardGm" },
    { key: "sharePts", label: "份额增·配置驱动X", unit: "pct", step: 1 },
    { key: "capexCap", label: "CAPEX 上限", unit: "亿", step: 1, hardKey: "hardCapex" },
    { key: "cashFloor", label: "现金底线", unit: "亿", step: 1, hardKey: "hardCash" },
    { key: "invTurns", label: "库存周转", unit: "次", step: 0.5 },
  ],
};

// 去电池锁死 8a（R14）：项目推演 DAG 的驱动因子层结构由 ViewConfig.layout.driverFactors 声明（非前端写死电池因子）。
// 含独有"配置驱动因子-X"——它出现在 DAG 里即证明 DAG 结构走配置（回答"DAG 哪里可配"）。
const PROJECT_SIM_LAYOUT = {
  driverFactors: [
    { id: "f1", label: "节拍 × OEE × 良率", sub: "IoT/MES/QMS 驱动因子" },
    { id: "f2", label: "爬坡曲线 + 检修窗", sub: "前4周 0.88→1.0 · 各基地检修周" },
    { id: "f3", label: "配置驱动因子-X", sub: "由 ViewConfig.layout 声明" },
  ],
};

const DASH_LAYOUT = {
  widgets: [
    {
      key: "gwh",
      type: "kpi",
      title: "总产能 (GWh)",
      featureKey: "view.dash.widget.gwh",
      unit: "GWh",
      query: { kind: "objects-aggregate", objectType: "Base", agg: "sum", prop: "gwh" },
      provenance: { toolName: "query_objects", outputPath: "$.sum(gwh)", snapshotVersion: "ov-12" },
    },
    {
      key: "orders",
      type: "kpi",
      title: "在手订单",
      query: { kind: "objects-aggregate", objectType: "Order", agg: "count" },
      provenance: { toolName: "query_objects", outputPath: "$.count", snapshotVersion: "ov-12" },
    },
    // PRD-cockpit §2.1 订单经营台账 + 规划决策推演（与后端 DASH_LAYOUT 同步；门A 守两套不漂）。
    {
      key: "order-ledger", type: "order-ledger", title: "订单经营台账 · 逐单根因下钻", span: 2,
      query: { kind: "solver", solverKey: "affected_orders", args: {} },
      provenance: { toolName: "invoke_solver", outputPath: "$.rows", snapshotVersion: "ov-12" },
    },
    {
      key: "plan-drill", type: "plan-drill", title: "规划决策推演 · 未达成指标根因下钻", span: 2,
      query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "kpis" },
      provenance: { toolName: "invoke_solver", outputPath: "$.kpis", snapshotVersion: "ov-12" },
    },
    // 与后端 DASH_LAYOUT 同步（门A 守不漂）：经营指标条 + 根因归因 DAG。
    {
      key: "metric-strip", type: "metric-strip", title: "经营指标（目标 vs 实际 · 单一出处）", span: 2,
      query: { kind: "solver", solverKey: "metric_rollup", args: { level: "op" }, valuePath: "metrics" },
      provenance: { toolName: "invoke_solver", outputPath: "$.metrics", snapshotVersion: "ov-12" },
    },
    {
      key: "rootcause", type: "dag", title: "规划决策推演 · 未达成指标根因下钻", span: 2,
      query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "dag" },
      provenance: { toolName: "invoke_solver", outputPath: "$.dag", snapshotVersion: "ov-12" },
    },
    // DS.2 富 KPI 补全（与后端 DASH_LAYOUT 同步，门A 守不漂）：cockpit_kpi 一 solver 出 5 标量。
    { key: "supply-v7", type: "kpi", title: "可供给 (万·终版)", unit: "万", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "supplyV7" }, provenance: { toolName: "invoke_solver", outputPath: "$.supplyV7", snapshotVersion: "ov-12" } },
    { key: "rev-attain", type: "kpi", title: "收入达成率", unit: "%", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "revAttainPct" }, provenance: { toolName: "invoke_solver", outputPath: "$.revAttainPct", snapshotVersion: "ov-12" } },
    { key: "util-peak", type: "kpi", title: "利用率瓶颈 (峰)", unit: "%", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "utilPeak" }, provenance: { toolName: "invoke_solver", outputPath: "$.utilPeak", snapshotVersion: "ov-12" } },
    { key: "aop-base", type: "kpi", title: "AOP 基准营收 (万)", unit: "万", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "aopBaseRev" }, provenance: { toolName: "invoke_solver", outputPath: "$.aopBaseRev", snapshotVersion: "ov-12" } },
    { key: "cash-cushion", type: "kpi", title: "现金垫 C18 (亿)", unit: "亿", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "cashCushion" }, provenance: { toolName: "invoke_solver", outputPath: "$.cashCushion", snapshotVersion: "ov-12" } },
    {
      key: "util",
      type: "kpi",
      title: "平均利用率",
      unit: "%",
      query: { kind: "objects-aggregate", objectType: "Base", agg: "avg", prop: "util" },
      provenance: { toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12" },
    },
    {
      key: "attain",
      type: "kpi",
      title: "计划达成率",
      unit: "%",
      query: { kind: "solver", solverKey: "schedule_attainment", args: {}, valuePath: "value" },
      provenance: { toolName: "query_timeseries_agg", outputPath: "$.value", snapshotVersion: "agg-77" },
    },
    {
      key: "oee-trend",
      type: "chart",
      title: "OEE 7日趋势",
      span: 2,
      chartKind: "line",
      query: { kind: "timeseries", seriesKey: "oee_daily", entityIds: [], grain: "day", agg: "avg", days: 14 },
    },
    {
      key: "risk-orders",
      type: "table",
      title: "风险订单",
      span: 2,
      query: { kind: "objects", objectType: "Order", filter: { status: "AT_RISK" }, columns: ["so", "cust", "model", "due"], limit: 8 },
    },
    // 运营态出厂配置增量 §4.1：12 个月产出趋势 / 准交率 KPI / 年度已执行工单 / 已交付台账
    {
      key: "trend-12m",
      type: "chart",
      title: "12 个月产出趋势（万套）",
      span: 2,
      chartKind: "bar",
      query: { kind: "history", field: "trend" },
      provenance: { toolName: "query_timeseries_agg", outputPath: "$.trend", label: "output:line 月度聚合（检修月下凹可见）" },
    },
    {
      key: "ontime-rate",
      type: "kpi",
      title: "已交付准交率",
      unit: "%",
      query: { kind: "history", field: "onTimeRate" },
      provenance: { toolName: "query_objects", outputPath: "$.onTimeRate", label: "近 12 个月已交付订单按期率" },
    },
    {
      key: "executed-workorders",
      type: "kpi",
      title: "年度已执行工单",
      query: { kind: "history", field: "executedCount" },
      provenance: { toolName: "query_objects", outputPath: "$.actionStats.executed", label: "Action 审计史 EXECUTED 计数" },
    },
    {
      key: "delivered-ledger",
      type: "table",
      title: "已交付订单台账",
      span: 2,
      query: { kind: "history", field: "delivered", columns: ["so", "cust", "model", "qty", "due", "deliveredAt", "delayDays"] },
      provenance: { toolName: "query_objects", outputPath: "$.delivered", label: "已交付订单（生命周期完整）" },
    },
    // #5 三线偏差复合图：需求/供给/缺口逐月 + 偏差柱（危机窗口缺口凸显）
    {
      key: "demand-supply-gap",
      type: "chart",
      title: "需求 / 供给 / 缺口（三线偏差）",
      span: 2,
      chartKind: "trideviation",
      query: { kind: "history", field: "deviation" },
      provenance: { toolName: "query_objects", outputPath: "$.deviation", label: "逐月需求-供给-缺口（gap=需求−供给）" },
    },
    // #5 问题聚合摘要：affected_orders 求解器 problems[] 四类归并
    {
      key: "problem-summary",
      type: "summary",
      title: "待解决问题聚合",
      span: 2,
      query: { kind: "solver", solverKey: "affected_orders", args: {} },
      provenance: { toolName: "affected_orders", outputPath: "$.problems", label: "受影响订单按类别归并（交期/毛利/齐套/信用）" },
    },
    // cockpit P5：S&OP 版本切换（SopVersionRow）+ 反事实双轨推演（counterfactual_timeline）
    {
      key: "version-toggle", type: "version-toggle", title: "S&OP 版本切换（V5/V7）", span: 1,
      query: { kind: "objects", objectType: "SopVersionRow", limit: 20 },
      provenance: { toolName: "query_objects", outputPath: "$.items", label: "SopVersionRow 版本演进" },
    },
    {
      key: "counterfactual", type: "counterfactual", title: "反事实双轨推演（如不解决会怎样）", span: 2,
      query: { kind: "solver", solverKey: "counterfactual_timeline", args: { horizon: 30 } },
      provenance: { toolName: "invoke_solver", outputPath: "$", label: "counterfactual_timeline 双曲线" },
    },
  ],
};

const LEDGER_LAYOUT = {
  objectType: "Order",
  columns: [
    { key: "so", label: "SO" },
    { key: "cust", label: "客户", filterable: true },
    { key: "model", label: "型号", filterable: true },
    { key: "qty", label: "数量" },
    { key: "due", label: "交期" },
    { key: "bases", label: "基地", filterable: true },
    { key: "status", label: "状态", filterable: true },
  ],
};

/**
 * §7.18 八视角：零新代码 —— 全部表达为 ViewConfig(renderer="ontology-graph", options.graphOptions)。
 *
 * 描述卡走 `options.desc` / `options.descLink{to,label}`，与**生产**（`datacore/src/synthetic/service.ts`
 * 的 `graphView()`）同形状 —— 契约单一来源 `GraphViewDescSchema`。
 * ⚠ 这里曾经是**唯一走对形状的一侧**：生产写 `layout.description`（裸字符串 link），mock 写对的，
 * 于是 `G-GRAPH-DESC-CONTRACT-SPLIT` 全绿藏了很久。**mock 比生产"对"也是骗人** ——
 * 改动本常量务必与 `service.ts` 同步；`test/graph-desc-contract.seam.test.tsx` 会咬住两边同形。
 * 导出是为了让那道门能直接比对本常量（否则只能间接经 MSW 猜）。
 */
/**
 * 「本体图谱」(`graph`) 视角配置 —— 与后端 `view-manifest.ts` 的 `ONTOLOGY_BROWSER_OPTIONS` 同语义。
 * 业务域 14 键取自后端 `graphmeta.BUSINESS_DOMAIN_KEYS`；此处是 mock，无法 import 后端源码
 * （contracts-only-shared），故逐字对齐 —— `test/graph-desc-contract.seam.test.tsx` 会拿**真后端抓下来的
 * ViewConfig** 与本常量对账，漂移即红（不是靠人记得同步）。
 */
export const ONTOLOGY_BROWSER_OPTIONS_MOCK = {
  graphOptions: {
    colorBy: "domain",
    nodeFilter: {
      domains: [
        "factory", "product", "process", "equip", "people", "quality", "capacity",
        "forecast", "sales", "material", "finance", "plan", "external", "decision",
      ],
    },
    dimOthers: true,
    layoutSeed: 42,
  },
  desc:
    "对象本体层：14 业务域的对象类型与它们之间的结构关系，点任一节点看属性、来源字段、适用规则与派生公式。" +
    "求解器与智能体属于其上的推演层与编排层，在此淡出——要三层同时看，切「图谱·全景」。",
};

export const GRAPH_VIEWPOINTS = [
  {
    key: "graph-all", title: "图谱·全景",
    options: { graphOptions: { colorBy: "domain", layoutSeed: 7 }, desc: "计划+执行一体化运营本体全景：圆形为业务对象，◆ 品红为求解器，⬡ 青为 Agent，颜色按数据域区分。" },
  },
  {
    key: "graph-backbone", title: "图谱·主干分级",
    options: { graphOptions: { nodeFilter: { tiers: [1] }, dimOthers: true, colorBy: "domain", layoutSeed: 11 }, desc: "一级 = 推演主干：工序产能 → 产能金字塔 → 产能预测 ← 基地/产线；二三级明细已淡出。" },
  },
  {
    key: "graph-flow", title: "图谱·产能推演网络",
    options: {
      graphOptions: { nodeFilter: { ids: ["OEE历史", "OEE指标", "良率", "工序产能", "n-cap", "产能预测", "n-forecast", "实际产出", "生产工单MO"] }, linkKinds: ["flow", "agg"], dimOthers: true, colorBy: "domain", layoutSeed: 13 },
      desc: "产能金字塔自下而上派生：节拍×OEE → 工序产能 → min瓶颈 → 产线/工厂产能 → Σ → 产能预测（仅渲染 flow+agg 边）。",
    },
  },
  {
    key: "graph-source", title: "图谱·数据来源",
    options: { graphOptions: { colorBy: "source", layoutSeed: 17 }, desc: "按源系统重新着色，回答『每个数据从哪来』：派生对象、求解器、智能体不是源数据，已淡出。" },
  },
  {
    key: "graph-solver", title: "图谱·求解器布局",
    options: {
      graphOptions: { nodeFilter: { ids: ["聚合求解器", "精度校准器", "n-solver-cap", "n-solver-risk", "工序产能", "n-cap", "产能预测"] }, linkKinds: ["solve", "fb"], dimOthers: true, colorBy: "domain", layoutSeed: 19 },
      desc: "求解器以智能辅助决策中台形式注册：读取业务对象、写回派生对象（仅渲染 solve+fb 边）。",
    },
  },
  {
    key: "graph-mvp", title: "图谱·MVP",
    options: {
      graphOptions: { nodeFilter: { ids: ["n-proc", "n-equip", "良率", "工序产能", "n-cap", "n-order", "产能预测", "聚合求解器"] }, mvpOverlay: true, dimOthers: true, colorBy: "domain", layoutSeed: 23 },
      desc: "最小可验证系统：实色高亮 MVP 必备核心闭环；⊕ 虚线节点是当前缺口（实际产出 / OEE历史 / 生产工单MO），缺它们系统就『算不准、学不会』。",
    },
  },
  {
    key: "graph-agent", title: "图谱·智能体网络",
    options: {
      graphOptions: { nodeFilter: { domains: ["agent", "solver"] }, linkKinds: ["orch", "solve"], dimOthers: true, colorBy: "domain", layoutSeed: 29 },
      desc: "编排 Agent 指挥专职智能体团队，把求解器与业务建模当工具调用（仅渲染 orch+solve 边）。",
    },
  },
  {
    key: "graph-loop", title: "图谱·学习闭环",
    options: {
      graphOptions: { nodeFilter: { ids: ["产能预测", "实际产出", "精度校准器", "学习Agent", "经验记忆库", "良率", "OEE历史", "OEE指标", "聚合求解器", "工序产能"] }, linkKinds: ["fb", "orch"], dimOthers: true, colorBy: "domain", layoutSeed: 31 },
      desc: "预测 ↔ 实际偏差 → 精度校准器 → 参数写回 → 越用越准（真实数据 MAPE 趋势见校准报告页，不做假动画）。",
      descLink: { to: "/admin/calibration", label: "查看精度趋势与校准历史 →" },
    },
  },
];

export function workspaceForAccount(account: MockAccount, tenantOverrides: Record<string, boolean>, configVersion: number): WorkspaceInput {
  const features = featuresForAccount(account, tenantOverrides);
  const allViews = [
    { key: "dash", title: "经营驾驶舱", renderer: "dashboard", layout: DASH_LAYOUT },
    // 「本体图谱」不再是零配置（修 G-GRAPH-ENTRY-DUP：它此前与「图谱·全景」渲染输出完全相同）。
    // 配置逐字对齐后端单一来源 `apps/datacore/src/synthetic/view-manifest.ts` 的 ONTOLOGY_BROWSER_OPTIONS
    // ——业务域为主角、求解器/智能体淡出；理由见那边的长注释。
    // ⚠ mock 与生产必须同形状同语义：mock 若留在零配置，前端测试里两个入口照样一模一样，
    // 这个 bug 就还是测不出来（本仓刚吃过 mock 走对/生产走错的亏，反过来一样是骗人）。
    { key: "graph", title: "本体图谱", renderer: "ontology-graph", layout: {}, options: ONTOLOGY_BROWSER_OPTIONS_MOCK },
    { key: "risk", title: "产能推演", renderer: "risk-board", layout: {} },
    { key: "order", title: "订单台账", renderer: "ledger", layout: LEDGER_LAYOUT },
    // 推演类业务视图（增量 PRD 由原型 docs/demo-推演系统.html 反推；renderer 已注册）
    { key: "plan-audit", title: "规划体检", renderer: "plan-audit", layout: PLAN_AUDIT_LAYOUT },
    { key: "plan-generate", title: "方案生成", renderer: "plan-generate", layout: PLAN_GENERATE_LAYOUT },
    { key: "project-sim", title: "项目推演", renderer: "project-sim", layout: PROJECT_SIM_LAYOUT },
    // WO-PORTFOLIO-OPTIMAL 全局项目推演（全订单×全基地×时间联合最优组合·共享产能守恒·冻结子集·多方案）
    { key: "global-sim", title: "全局项目推演", renderer: "global-sim", layout: {} },
    { key: "sop-balance", title: "月度规划", renderer: "sop-balance", layout: {} },
    // 剩余视图增量（§7.14–7.17）
    { key: "annual-scenario", title: "年度规划", renderer: "annual-scenario", layout: {} },
    { key: "quarterly-rolling", title: "季度规划", renderer: "quarterly-rolling", layout: {} },
    {
      key: "order-chain",
      title: "订单进展与卡因",
      renderer: "order-chain",
      // 去电池锁死 8a（R14）：问题分类标签/产品段配色由 ViewConfig.layout 声明（DELIVERY 标签独有"·配置X"以证明）
      layout: {
        categoryLabels: { DELIVERY: "交期·配置X", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用" },
        segColors: { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" },
      },
    },
    { key: "geo-map", title: "基地地理视图", renderer: "geo-map", layout: {} },
    // 运营态出厂配置增量 §4.2：运营复盘（只读历史证据链页面）
    { key: "review", title: "运营复盘", renderer: "review", layout: {} },
    // ── 推演沙盘四子视图（WO-NAV-GATE · mock 对齐后端真实下发）───────────────────
    // key/title/renderer 逐字对齐后端单一来源 `apps/datacore/src/synthetic/view-manifest.ts`
    // 的 `BUILTIN_VIEWS`（seed:true 那批）。⚠ 这不是"手抄一份清单"——
    // `scripts/check-nav-group-coverage.mjs` 机械读那份清单与本数组比对，任一侧漂移即红
    // （#99/#110 的病根正是两侧各手维护一套词表、没有任何东西对账）。
    { key: "chain-line-map", title: "全链线路图", renderer: "chain-line-map", layout: {} },
    { key: "transit-flow", title: "在途与在制", renderer: "transit-flow", layout: {} },
    { key: "physical-topology", title: "物理拓扑", renderer: "physical-topology", layout: {} },
    { key: "node-inspector", title: "节点检视", renderer: "node-inspector", layout: {} },
    { key: "chain-impediments", title: "全链阻滞点", renderer: "chain-impediments", layout: {} },
    // WO-WAITING-STATES-FE：流程等待态（key/title/renderer 逐字对齐后端 view-manifest.ts BUILTIN_VIEWS）
    { key: "process-wait", title: "流程等待态", renderer: "process-wait", layout: {} },
    // WO-R9-NAVREACH：采购四段腿分解（同上·逐字对齐后端 BUILTIN_VIEWS，门 check-nav-group-coverage 判据② 机械对账）
    { key: "procurement-legs", title: "采购四段腿分解", renderer: "procurement-legs", layout: {} },
    // WO-PROCESS-INSTANCE：流程卡点（**实例层**，与上一行的模板层是两页）。
    // key/title/renderer 逐字对齐后端 `synthetic/service.ts` 的 `VIEW_DEFS["process-stuck"]` ——
    // 它走的是**增量视图**桶（同 geo-map/review），不在 BUILTIN_VIEWS 里，故不在 nav 门判据② 的射程；
    // 但漂了照样是「列表显示的 renderer 与注册表对不上 → 兜底卡」，所以照样必须逐字抄。
    { key: "process-stuck", title: "流程卡点", renderer: "process-stuck", layout: {} },
    // §7.18 八视角（renderer 复用 ontology-graph，仅 options 不同）
    ...GRAPH_VIEWPOINTS.map((v) => ({ key: v.key, title: v.title, renderer: "ontology-graph", layout: {}, options: v.options })),
    // aop（旧直链入口）：renderer="aop" 未注册，演示「该视图类型暂不支持」兜底
    { key: "aop", title: "年度规划（旧）", renderer: "aop", layout: {} },
  ];
  // ⚠ 这张表必须与后端 `VIEW_FEATURE_MAP`（apps/datacore/src/features.ts）同口径。
  //   `process-stuck` 的控制键**不是** `view.process-stuck` 而是 `process.runtime`
  //   （features.ts:272 有意为之：卡点面板与运行时引擎同生共死，不另立一个能各自开关的 view.* 键）。
  //   照默认规则算成 `view.process-stuck` ⇒ 该键永不在 features 里 ⇒ 视图恒被过滤掉，
  //   表现为「注册了、下发表里也写了，就是不出现」——最难查的那种。
  const featureKeyOf = (viewKey: string) =>
    viewKey === "graph"
      ? "view.ontology-graph"
      : viewKey === "risk"
        ? "view.risk-board"
        : viewKey === "order"
          ? "view.ledger"
          : viewKey === "process-stuck"
            ? "process.runtime"
            : `view.${viewKey}`;
  // 服务端按 features 过滤后下发（前端不做解析，只消费结果）
  const views = allViews.filter((v) => features.includes(featureKeyOf(v.key)));
  // aop 不进导航（仅直链可达，演示兜底卡）；base_manager 额外隐藏图谱（含八视角）
  const navViews = (account.username === "planner" ? views : views.filter((v) => v.key !== "graph" && !v.key.startsWith("graph-"))).filter(
    (v) => v.key !== "aop",
  );

  // features 集合按视图 key 对齐路由（/v/:viewKey 守卫直接查 view.{viewKey}）
  const routeFeatures = features.flatMap((f) => {
    if (f === "view.ontology-graph") return [f, "view.graph"];
    if (f === "view.risk-board") return [f, "view.risk"];
    if (f === "view.ledger") return [f, "view.order"];
    if (f === "view.dash") return [f, "view.dash"];
    // WO-PROCESS-INSTANCE：功能键是 `process.runtime`（非 view.* 命名），而 `ViewPage` 路由守卫
    // 写死查 `view.${viewKey}`（ViewPage.tsx:33）⇒ 必须补这条别名，否则「导航里点得到、点进去 404」。
    // 与后端 `withRouteFeatureAliases`（app.ts:1102）同一份口径，两侧必须同增同减。
    if (f === "process.runtime") return [f, "view.process-stuck"];
    return [f];
  });

  return {
    tenant: { id: TENANT_ID, name: "星辰电池制造", industry: "battery-manufacturing" },
    user: { id: `usr-${account.username}`, username: account.username, roles: account.roles, attributes: { baseScope: account.baseScope ?? undefined } },
    theme: account.username === "planner" ? { "--accent": "#4C90F0" } : { "--accent": "#36BFA5" },
    navigation: navViews.map((v) => ({ key: v.key, label: v.title })),
    // views 含 aop（直链可达，renderer 未注册 → 兜底卡）；navigation 不含
    views: account.username === "planner" ? views : views.filter((v) => v.key !== "graph" && !v.key.startsWith("graph-")),
    // 契约形态（与真实后端同形）；前端 VM 归一化为 id 字符串数组
    scenarioPackages: [{ id: PACKAGE_ID, name: "电池制造场景包" }],
    // 去电池锁死（R14）：推演视图的型号/物流/KPI阈值/三段/目标由 WorkspaceConfig 下发（按租户/行业），非前端写死
    simConfig: {
      models: ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah", "配置驱动型号-X"],
      logistics: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 },
    },
    sopConfig: {
      gapRed: 2,
      cashFloor: 50,
      revBudget: 700.0, // 需求结构 53.8/37.1/9.1 → 滚动确认收入 700亿
      // 滚动预测按 lastActual 趋势修正：乘用车贴目标；储能实绩偏弱下修；商用车实绩偏强上修（>±10% → C21）。
      // 三段 rolling 合计对齐 seed/audit 需求 375（= 乘用车 201.7 + 储能 133.8 + 商用车 39.5），
      // 与③供给基线 367.9 得产销缺口 ≈7.1 万套（>gapRed 2 → 红标）。
      segments: [
        { key: "pas", name: "乘用车", target: 201.7, rolling: 201.7, rollingWanPerMonthP90: 199.6, lastActual: 200.6 },
        { key: "ess", name: "储能", target: 139.2, rolling: 133.8, rollingWanPerMonthP90: 108.4, lastActual: 100.5 },
        { key: "com", name: "商用车", target: 34.1, rolling: 39.5, rollingWanPerMonthP90: 34.0, lastActual: 39.5 },
      ],
      defaultResolutions: [
        { name: "常州化成夜班×1", delta: 3.4 },
        { name: "江门正极加急 200 吨", delta: 1.4 },
      ],
    },
    // DF.4 单一来源：planGoals 从 PLAN_GOAL_TARGETS 派生（与后端 targets 同源，灭三处漂移 R14/R6）。
    planGoals: { revGrowthPct: PLAN_GOAL_TARGETS.revGrowthPct, gmFloorPct: PLAN_GOAL_TARGETS.gmFloorPct, sharePts: PLAN_GOAL_TARGETS.sharePts, capexCap: PLAN_GOAL_TARGETS.capexCap, cashFloor: PLAN_GOAL_TARGETS.cashFloor, invTurns: PLAN_GOAL_TARGETS.turns },
    features: routeFeatures,
    configVersion,
  };
}

// ---------------------------------------------------------------------------
// 本体图谱
// ---------------------------------------------------------------------------

export const GRAPH: OntologyGraphVM = {
  nodes: [
    { id: "n-base", key: "Base", label: "基地", kind: "object", domain: "factory", tier: 1, sourceSystem: "ERP", properties: [{ propKey: "name", dataType: "string", isPrimaryKey: true }, { propKey: "util", dataType: "number" }, { propKey: "gwh", dataType: "number" }], sourceBindings: [{ connId: "conn-erp", dataset: "plants", fieldMappings: { name: "plant_name", util: "utilization", gwh: "capacity_gwh" } }], rules: [{ key: "C05", name: "利用率持续告警", expression: "SUSTAIN(产线.utilization > 95, 3)" }], derivations: [] },
    { id: "n-workshop", key: "Workshop", label: "车间", kind: "object", domain: "factory", tier: 1, sourceSystem: "MES", properties: [{ propKey: "workshopId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref" }, { propKey: "name", dataType: "string" }, { propKey: "processType", dataType: "enum" }], sourceBindings: [{ connId: "conn-mes", dataset: "workshops" }], rules: [], derivations: [] },
    { id: "n-line", key: "Line", label: "产线", kind: "object", domain: "factory", tier: 1, sourceSystem: "MES", properties: [{ propKey: "lineId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref" }, { propKey: "name", dataType: "string" }, { propKey: "utilization", dataType: "number" }, { propKey: "actual_output_daily", dataType: "number" }, { propKey: "schedule_attainment", dataType: "number" }, { propKey: "line_code", dataType: "string" }, { propKey: "max_capacity_day", dataType: "number" }, { propKey: "target_yield", dataType: "number" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_lines", fieldMappings: { lineId: "LINE_ID", baseId: "BASE_ID", name: "LINE_NAME", line_code: "LINE_CODE", max_capacity_day: "MAX_CAP_DAY", target_yield: "TARGET_YIELD", status: "STATUS" } }], rules: [], derivations: [{ propKey: "schedule_attainment", formula: "rollup(week, 排产 vs 实绩)" }] },
    { id: "n-model", key: "Model", label: "型号", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "modelNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-erp", dataset: "models" }], rules: [], derivations: [] },
    { id: "n-order", key: "Order", label: "订单", kind: "object", domain: "product", tier: 2, sourceSystem: "CRM", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "qty", dataType: "number" }, { propKey: "due", dataType: "date" }], sourceBindings: [{ connId: "conn-crm", dataset: "orders", fieldMappings: { so: "so", qty: "qty", due: "delivery_date" } }], rules: [{ key: "C13", name: "信用额度", expression: "Order.credit <= Customer.creditLimit" }], derivations: [] },
    { id: "n-proc", key: "Process", label: "工序", kind: "object", domain: "process", tier: 2, sourceSystem: "MES", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }, { propKey: "yield_baseline", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "process" }], rules: [], derivations: [{ propKey: "yield_baseline", formula: "ts_agg(yield_daily, avg, 7d)" }] },
    { id: "n-equip", key: "Equipment", label: "设备", kind: "object", domain: "equip", tier: 2, sourceSystem: "IoT", properties: [{ propKey: "equipId", dataType: "string", isPrimaryKey: true }, { propKey: "processId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "baseId", dataType: "ref" }, { propKey: "ctSeconds", dataType: "number" }, { propKey: "availFactor", dataType: "number" }, { propKey: "oeeA", dataType: "number" }, { propKey: "oeeP", dataType: "number" }, { propKey: "oeeQ", dataType: "number" }, { propKey: "oee_current", dataType: "number" }, { propKey: "equipment_code", dataType: "string" }, { propKey: "equipment_type", dataType: "enum" }, { propKey: "manufacturer", dataType: "string" }, { propKey: "install_date", dataType: "date" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-iot", dataset: "iot_equipment", fieldMappings: { equipId: "EQUIP_ID", processId: "PROC_ID", lineId: "LINE_ID", baseId: "BASE_ID", ctSeconds: "CT_SECONDS", availFactor: "AVAIL", oeeA: "OEE_A", oeeP: "OEE_P", oeeQ: "OEE_Q", equipment_code: "EQUIP_CODE", equipment_type: "EQUIP_TYPE", manufacturer: "MANUFACTURER", install_date: "INSTALL_DATE", status: "STATUS" } }], rules: [], derivations: [{ propKey: "oee_current", formula: "ts_agg(oee_daily, weighted_avg, 7d)" }] },
    { id: "n-people", key: "Crew", label: "班组", kind: "object", domain: "people", tier: 3, sourceSystem: "HR", properties: [{ propKey: "crewId", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-quality", key: "QualityLot", label: "质检批", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "lotNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: OUTSOURCE_REDLINE.ruleKey, name: "外协红线", expression: outsourceRedlineConstraintExpr("Outsource.ratio") }], derivations: [] },
    { id: "n-cap", key: "CapacityPyramid", label: "产能金字塔", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "week", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: "C03", name: "产能上限", expression: "demandDelta <= 0.5" }], derivations: [{ propKey: "capWanP90", formula: "capacity_forecast(capWanP90)" }] },
    { id: "n-forecast", key: "DemandForecast", label: "需求预测", kind: "object", domain: "forecast", tier: 2, sourceSystem: "派生", properties: [{ propKey: "period", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [] },
    { id: "n-solver-cap", key: "capacity_forecast", label: "产能推演", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-solver-risk", key: "risk_timeline", label: "风险时间线", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-agent", key: "explore_agent", label: "探索 Agent", kind: "agent", domain: "agent", sourceSystem: "智能体", properties: [], sourceBindings: [], rules: [], derivations: [] },
    // —— §7.18 八视角增量节点（学习闭环 / 产能推演网络 / MVP 缺口）——
    { id: "产能预测", key: "CapacityForecast", label: "产能预测", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "week", dataType: "string", isPrimaryKey: true }, { propKey: "capWanP50", dataType: "number" }, { propKey: "capWanP90", dataType: "number" }], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [{ propKey: "capWanP90", formula: "capWanP50 × healthFactor" }] },
    { id: "工序产能", key: "ProcessCapacity", label: "工序产能", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [{ propKey: "weeklyCap", formula: "节拍 × OEE × 良率 × 可用工时" }] },
    { id: "实际产出", key: "ActualOutput", label: "实际产出", kind: "object", domain: "capacity", tier: 3, sourceSystem: "MES", mvpGap: true, properties: [{ propKey: "date", dataType: "date", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-mes", dataset: "output_daily" }], rules: [], derivations: [] },
    { id: "良率", key: "YieldRate", label: "良率", kind: "object", domain: "quality", tier: 2, sourceSystem: "QMS", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-qms", dataset: "yield_daily" }], rules: [], derivations: [] },
    { id: "OEE指标", key: "OeeMetric", label: "OEE指标", kind: "object", domain: "equip", tier: 2, sourceSystem: "IoT", properties: [{ propKey: "equipNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-iot", dataset: "oee:equip" }], rules: [], derivations: [] },
    { id: "OEE历史", key: "OeeHistory", label: "OEE历史", kind: "object", domain: "equip", tier: 3, sourceSystem: "IoT", mvpGap: true, properties: [{ propKey: "ts", dataType: "date", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-iot", dataset: "oee_history" }], rules: [], derivations: [] },
    { id: "生产工单MO", key: "MfgOrder", label: "生产工单MO", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", mvpGap: true, properties: [{ propKey: "moNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-mes", dataset: "mo" }], rules: [], derivations: [] },
    { id: "聚合求解器", key: "agg_solver", label: "聚合求解器", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "精度校准器", key: "calibrator", label: "精度校准器", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [] },
    { id: "学习Agent", key: "learning_agent", label: "学习Agent", kind: "agent", domain: "agent", sourceSystem: "智能体", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "经验记忆库", key: "ExperienceMemory", label: "经验记忆库", kind: "object", domain: "agent", tier: 3, sourceSystem: "智能体", properties: [{ propKey: "entryId", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [] },
    // —— Phase 2 产品工程主数据域 ——
    { id: "n-platform", key: "ProductPlatform", label: "产品平台", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "platformId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_platforms" }], rules: [], derivations: [] },
    { id: "n-series", key: "ProductSeries", label: "产品系列", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "seriesId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_series" }], rules: [], derivations: [] },
    { id: "n-version", key: "ProductVersion", label: "产品版本", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "versionId", dataType: "string", isPrimaryKey: true }, { propKey: "versionCode", dataType: "string" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_versions" }], rules: [], derivations: [] },
    { id: "n-bom", key: "BOMHeader", label: "BOM", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "bomId", dataType: "string", isPrimaryKey: true }, { propKey: "bomCode", dataType: "string" }, { propKey: "bomLevel", dataType: "number" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_headers" }], rules: [], derivations: [] },
    { id: "n-bomd", key: "BOMDetail", label: "BOM明细", kind: "object", domain: "product", tier: 3, sourceSystem: "PLM", properties: [{ propKey: "bomDetailId", dataType: "string", isPrimaryKey: true }, { propKey: "sequence", dataType: "number" }, { propKey: "quantity", dataType: "number" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_details" }], rules: [], derivations: [] },
    { id: "n-material", key: "Material", label: "物料", kind: "object", domain: "supply", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "unitPrice", dataType: "number" }], sourceBindings: [{ connId: "conn-erp", dataset: "erp_materials" }], rules: [], derivations: [] },
    { id: "n-supplier", key: "Supplier", label: "供应商", kind: "object", domain: "supply", tier: 2, sourceSystem: "SRM", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "rating", dataType: "enum" }], sourceBindings: [{ connId: "conn-srm", dataset: "srm_suppliers" }], rules: [], derivations: [] },
    { id: "n-matalt", key: "MaterialAlternative", label: "物料替代", kind: "object", domain: "supply", tier: 3, sourceSystem: "PLM", properties: [{ propKey: "altId", dataType: "string", isPrimaryKey: true }, { propKey: "priority", dataType: "number" }, { propKey: "approvalStatus", dataType: "enum" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_material_alts" }], rules: [], derivations: [] },
    { id: "n-routing", key: "Routing", label: "工艺路线", kind: "object", domain: "process", tier: 2, sourceSystem: "MES", properties: [{ propKey: "routingId", dataType: "string", isPrimaryKey: true }, { propKey: "routingCode", dataType: "string" }, { propKey: "operationCount", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_routings" }], rules: [], derivations: [] },
    { id: "n-op", key: "Operation", label: "工序", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", properties: [{ propKey: "operationId", dataType: "string", isPrimaryKey: true }, { propKey: "operationName", dataType: "string" }, { propKey: "standardTime", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_operations" }], rules: [], derivations: [] },
    { id: "n-pcw", key: "ProcessCapabilityWindow", label: "工艺能力边界", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", properties: [{ propKey: "capabilityId", dataType: "string", isPrimaryKey: true }, { propKey: "parameterName", dataType: "string" }, { propKey: "minValue", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_process_capabilities" }], rules: [], derivations: [] },
    { id: "n-qs", key: "QualityStandard", label: "质量标准", kind: "object", domain: "quality", tier: 2, sourceSystem: "QMS", properties: [{ propKey: "standardId", dataType: "string", isPrimaryKey: true }, { propKey: "itemName", dataType: "string" }, { propKey: "targetValue", dataType: "number" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_standards" }], rules: [], derivations: [] },
    { id: "n-ic", key: "InspectionCharacteristic", label: "检验特性", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "charId", dataType: "string", isPrimaryKey: true }, { propKey: "charName", dataType: "string" }, { propKey: "inspectionType", dataType: "enum" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_inspection_chars" }], rules: [], derivations: [] },
    { id: "n-plc", key: "ProductLineCapability", label: "产品产线能力", kind: "object", domain: "factory", tier: 2, sourceSystem: "MES", properties: [{ propKey: "capId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxCapacity", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_line_cap" }], rules: [], derivations: [] },
    { id: "n-pec", key: "ProductEquipmentCapability", label: "产品设备能力", kind: "object", domain: "equip", tier: 3, sourceSystem: "MES", properties: [{ propKey: "equipCapId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxSpeed", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_equip_cap" }], rules: [], derivations: [] },
    { id: "n-ec", key: "EngineeringChange", label: "工程变更", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "changeId", dataType: "string", isPrimaryKey: true }, { propKey: "changeNumber", dataType: "string" }, { propKey: "changeType", dataType: "enum" }], sourceBindings: [{ connId: "conn-plm", dataset: "plm_ecn" }], rules: [], derivations: [] },
    // —— battery.ts 缺失节点补齐 ——
    { id: "n-maint", key: "MaintPlan", label: "检修计划", kind: "object", domain: "equip", tier: 2, sourceSystem: "MES", properties: [{ propKey: "planId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref" }, { propKey: "week", dataType: "number" }, { propKey: "lastMaintStart", dataType: "date" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_maint_plans" }], rules: [], derivations: [] },
    { id: "n-seg", key: "Segment", label: "应用细分", kind: "object", domain: "product", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "segKey", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "gmRate", dataType: "number" }, { propKey: "baselineShare", dataType: "number" }], sourceBindings: [{ connId: "conn-erp", dataset: "erp_segments" }], rules: [], derivations: [] },
    { id: "n-ship", key: "Shipment", label: "在途批次", kind: "object", domain: "capacity", tier: 2, sourceSystem: "SRM", properties: [{ propKey: "shipId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref" }, { propKey: "etaDay", dataType: "number" }, { propKey: "status", dataType: "enum" }, { propKey: "qtyTons", dataType: "number" }, { propKey: "coverageDays", dataType: "number" }], sourceBindings: [{ connId: "conn-srm", dataset: "srm_shipments" }], rules: [], derivations: [] },
    { id: "n-dsh", key: "DataSourceHealth", label: "数据源健康度", kind: "object", domain: "quality", tier: 3, sourceSystem: "IoT", properties: [{ propKey: "sourceId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "critical", dataType: "boolean" }, { propKey: "lagHours", dataType: "number" }], sourceBindings: [{ connId: "conn-iot", dataset: "iot_source_health" }], rules: [], derivations: [] },
    { id: "n-ascn", key: "AnnualScenario", label: "年度情景", kind: "object", domain: "plan", tier: 1, sourceSystem: "计划", properties: [{ propKey: "scnId", dataType: "string", isPrimaryKey: true }, { propKey: "key", dataType: "enum" }, { propKey: "name", dataType: "string" }, { propKey: "year", dataType: "number" }, { propKey: "demand", dataType: "number" }, { propKey: "revenue", dataType: "number" }, { propKey: "capex", dataType: "number" }, { propKey: "irr", dataType: "number" }, { propKey: "cashCushion", dataType: "number" }, { propKey: "finalized", dataType: "boolean" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-trig", key: "ScenarioTrigger", label: "情景触发条件", kind: "object", domain: "plan", tier: 2, sourceSystem: "计划", properties: [{ propKey: "trigId", dataType: "string", isPrimaryKey: true }, { propKey: "condition", dataType: "string" }, { propKey: "expr", dataType: "string" }, { propKey: "action", dataType: "string" }, { propKey: "status", dataType: "enum" }, { propKey: "triggeredAt", dataType: "date" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-ptgt", key: "PlanTarget", label: "计划目标", kind: "object", domain: "plan", tier: 2, sourceSystem: "计划", properties: [{ propKey: "tgtId", dataType: "string", isPrimaryKey: true }, { propKey: "period", dataType: "string" }, { propKey: "level", dataType: "enum" }, { propKey: "value", dataType: "number" }, { propKey: "year", dataType: "number" }, { propKey: "scenarioKey", dataType: "string" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-dseg", key: "DemandSegment", label: "需求细分", kind: "object", domain: "forecast", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "segId", dataType: "string", isPrimaryKey: true }, { propKey: "segment", dataType: "string" }, { propKey: "tgt", dataType: "number" }, { propKey: "demandWanPerYearP50", dataType: "number" }, { propKey: "demandWanPerYearP90", dataType: "number" }, { propKey: "act", dataType: "number" }, { propKey: "priceWan", dataType: "number" }, { propKey: "marginPct", dataType: "number" }, { propKey: "floorPct", dataType: "number" }], sourceBindings: [], rules: [], derivations: [{ propKey: "revenueWan", formula: "demandWanPerYearP50 * priceWan" }, { propKey: "marginWan", formula: "demandWanPerYearP50 * priceWan * marginPct / 100" }] },
    { id: "n-finp", key: "FinancePlan", label: "财务预算", kind: "object", domain: "finance", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "finId", dataType: "string", isPrimaryKey: true }, { propKey: "line", dataType: "string" }, { propKey: "budget", dataType: "number" }, { propKey: "rolling", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-mbal", key: "MaterialBalance", label: "物料平衡", kind: "object", domain: "material", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "matBalId", dataType: "string", isPrimaryKey: true }, { propKey: "material", dataType: "string" }, { propKey: "unit", dataType: "string" }, { propKey: "netDemandTon", dataType: "number" }, { propKey: "ltaPct", dataType: "number" }, { propKey: "gapTon", dataType: "number" }, { propKey: "etaDate", dataType: "string" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-metric", key: "Metric", label: "经营指标", kind: "object", domain: "decision", tier: 1, sourceSystem: "派生", properties: [{ propKey: "metricId", dataType: "string", isPrimaryKey: true }, { propKey: "key", dataType: "string" }, { propKey: "name", dataType: "string" }, { propKey: "level", dataType: "enum" }, { propKey: "category", dataType: "enum" }, { propKey: "target", dataType: "number" }, { propKey: "actual", dataType: "number" }, { propKey: "floorVal", dataType: "number" }, { propKey: "unit", dataType: "string" }, { propKey: "weight", dataType: "number" }, { propKey: "ksfRef", dataType: "ref" }, { propKey: "ownerRef", dataType: "ref" }, { propKey: "chainKey", dataType: "string" }], sourceBindings: [], rules: [], derivations: [{ propKey: "delta", formula: "actual - target" }, { propKey: "gapPct", formula: "(actual - target) / target * 100" }] },
    { id: "n-ksf", key: "KSF", label: "关键成功要素", kind: "object", domain: "decision", tier: 2, sourceSystem: "计划", properties: [{ propKey: "ksfId", dataType: "string", isPrimaryKey: true }, { propKey: "key", dataType: "enum" }, { propKey: "name", dataType: "string" }, { propKey: "sub", dataType: "string" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-prin", key: "Principal", label: "责任主体", kind: "object", domain: "people", tier: 2, sourceSystem: "HR", properties: [{ propKey: "principalId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "kind", dataType: "enum" }, { propKey: "parentRef", dataType: "ref" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-rcc", key: "RootCauseChain", label: "根因归因链", kind: "object", domain: "decision", tier: 2, sourceSystem: "派生", properties: [{ propKey: "chainId", dataType: "string", isPrimaryKey: true }, { propKey: "kpiCategory", dataType: "enum" }, { propKey: "factor", dataType: "string" }, { propKey: "driverType", dataType: "string" }, { propKey: "evidenceField", dataType: "string" }, { propKey: "selectField", dataType: "string" }, { propKey: "baseWeight", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-sopv", key: "SopVersionRow", label: "S&OP版本演进", kind: "object", domain: "plan", tier: 2, sourceSystem: "计划", properties: [{ propKey: "verId", dataType: "string", isPrimaryKey: true }, { propKey: "ver", dataType: "string" }, { propKey: "date", dataType: "string" }, { propKey: "demand", dataType: "number" }, { propKey: "supply", dataType: "number" }, { propKey: "note", dataType: "string" }, { propKey: "isFinal", dataType: "boolean" }], sourceBindings: [], rules: [], derivations: [{ propKey: "gap", formula: "demand - supply" }] },
    // —— battery-extended.ts 缺失节点补齐 ——
    { id: "n-cust", key: "Customer", label: "客户", kind: "object", domain: "commercial", tier: 2, sourceSystem: "CRM", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "custName", dataType: "string" }, { propKey: "creditLimit", dataType: "number" }, { propKey: "termDays", dataType: "number" }, { propKey: "receivables", dataType: "number" }, { propKey: "wipUnbilled", dataType: "number" }, { propKey: "maxOverdueDays", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-ar", key: "ARInvoice", label: "应收发票", kind: "object", domain: "commercial", tier: 3, sourceSystem: "ERP", properties: [{ propKey: "invoiceId", dataType: "string", isPrimaryKey: true }, { propKey: "custName", dataType: "string" }, { propKey: "amount", dataType: "number" }, { propKey: "overdueDays", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-mbatch", key: "MaterialBatch", label: "物料批次", kind: "object", domain: "supply", tier: 3, sourceSystem: "ERP", properties: [{ propKey: "batchId", dataType: "string", isPrimaryKey: true }, { propKey: "matId", dataType: "string" }, { propKey: "qty", dataType: "number" }, { propKey: "ageDays", dataType: "number" }, { propKey: "idleDays", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-po", key: "PurchaseOrder", label: "采购订单", kind: "object", domain: "supply", tier: 2, sourceSystem: "SRM", properties: [{ propKey: "poId", dataType: "string", isPrimaryKey: true }, { propKey: "matId", dataType: "string" }, { propKey: "qty", dataType: "number" }, { propKey: "etaDay", dataType: "number" }, { propKey: "delayed", dataType: "boolean" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-cf", key: "CarbonFactor", label: "碳因子", kind: "object", domain: "supply", tier: 3, sourceSystem: "ERP", properties: [{ propKey: "factorId", dataType: "string", isPrimaryKey: true }, { propKey: "kind", dataType: "string" }, { propKey: "key", dataType: "string" }, { propKey: "factor", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-em", key: "EnergyMeter", label: "能耗计量", kind: "object", domain: "factory", tier: 2, sourceSystem: "IoT", properties: [{ propKey: "meterId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "string" }, { propKey: "processKey", dataType: "string" }, { propKey: "energyPerUnit", dataType: "number" }, { propKey: "gridFactor", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-com", key: "ChangeoverMatrix", label: "换型矩阵", kind: "object", domain: "factory", tier: 3, sourceSystem: "MES", properties: [{ propKey: "pairId", dataType: "string", isPrimaryKey: true }, { propKey: "fromModel", dataType: "string" }, { propKey: "toModel", dataType: "string" }, { propKey: "minutes", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-capex", key: "CapexProject", label: "产能投资项目", kind: "object", domain: "plan", tier: 2, sourceSystem: "计划", properties: [{ propKey: "projectId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "irr", dataType: "number" }, { propKey: "util24", dataType: "number" }, { propKey: "c23pass", dataType: "boolean" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-fa", key: "FinanceAccount", label: "基地财务账户", kind: "object", domain: "finance", tier: 2, sourceSystem: "ERP", properties: [{ propKey: "accId", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "string" }, { propKey: "cashOnHand", dataType: "number" }, { propKey: "receivable", dataType: "number" }, { propKey: "payable", dataType: "number" }, { propKey: "workingCapital", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-fm", key: "FinanceMetric", label: "情景财务指标", kind: "object", domain: "finance", tier: 2, sourceSystem: "计划", properties: [{ propKey: "metricId", dataType: "string", isPrimaryKey: true }, { propKey: "scenarioKey", dataType: "string" }, { propKey: "cashCushion", dataType: "number" }, { propKey: "irr", dataType: "number" }, { propKey: "capexSpent", dataType: "number" }, { propKey: "netMargin", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-ext", key: "ExternalSignal", label: "外部信号", kind: "object", domain: "external", tier: 2, sourceSystem: "外部", properties: [{ propKey: "signalKey", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "string" }, { propKey: "value", dataType: "number" }, { propKey: "unit", dataType: "string" }, { propKey: "asOf", dataType: "string" }, { propKey: "source", dataType: "string" }, { propKey: "trend", dataType: "string" }, { propKey: "impact", dataType: "string" }, { propKey: "elasticity", dataType: "number" }], sourceBindings: [], rules: [], derivations: [] },
    // —— Phase 3 MES Domain 节点 ——
    { id: "n-wo", key: "WorkOrder", label: "生产工单", kind: "object", domain: "process", tier: 2, sourceSystem: "MES", properties: [{ propKey: "woId", dataType: "string", isPrimaryKey: true }, { propKey: "moNo", dataType: "string" }, { propKey: "modelId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "qtyPlanned", dataType: "number" }, { propKey: "qtyActual", dataType: "number" }, { propKey: "startDate", dataType: "date" }, { propKey: "endDate", dataType: "date" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_work_orders" }], rules: [], derivations: [] },
    { id: "n-ps", key: "ProductionSchedule", label: "生产排程", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", properties: [{ propKey: "schedId", dataType: "string", isPrimaryKey: true }, { propKey: "woId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "shift", dataType: "enum" }, { propKey: "scheduledDate", dataType: "date" }, { propKey: "qty", dataType: "number" }, { propKey: "priority", dataType: "number" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_schedules" }], rules: [], derivations: [] },
    { id: "n-sp", key: "ShiftPlan", label: "班次计划", kind: "object", domain: "people", tier: 3, sourceSystem: "MES", properties: [{ propKey: "shiftId", dataType: "string", isPrimaryKey: true }, { propKey: "lineId", dataType: "ref" }, { propKey: "plannedHeadcount", dataType: "number" }, { propKey: "actualHeadcount", dataType: "number" }, { propKey: "date", dataType: "date" }, { propKey: "hours", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_shift_plans" }], rules: [], derivations: [] },
    { id: "n-wipl", key: "WIPLot", label: "在制批次", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", properties: [{ propKey: "lotId", dataType: "string", isPrimaryKey: true }, { propKey: "woId", dataType: "ref" }, { propKey: "modelId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "currentProcess", dataType: "string" }, { propKey: "qty", dataType: "number" }, { propKey: "status", dataType: "enum" }, { propKey: "startTime", dataType: "date" }, { propKey: "lastMoveTime", dataType: "date" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_wip_lots" }], rules: [], derivations: [] },
    { id: "n-wipm", key: "WIPMove", label: "在制移动", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", properties: [{ propKey: "moveId", dataType: "string", isPrimaryKey: true }, { propKey: "lotId", dataType: "ref" }, { propKey: "fromProcess", dataType: "string" }, { propKey: "toProcess", dataType: "string" }, { propKey: "qty", dataType: "number" }, { propKey: "moveTime", dataType: "date" }, { propKey: "operatorId", dataType: "string" }], sourceBindings: [{ connId: "conn-mes", dataset: "mes_wip_moves" }], rules: [], derivations: [] },
    { id: "n-wipq", key: "WIPQualityCheckpoint", label: "在制质检点", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "checkpointId", dataType: "string", isPrimaryKey: true }, { propKey: "lotId", dataType: "ref" }, { propKey: "processName", dataType: "string" }, { propKey: "checkType", dataType: "enum" }, { propKey: "result", dataType: "enum" }, { propKey: "checkTime", dataType: "date" }, { propKey: "inspectorId", dataType: "string" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_wip_checkpoints" }], rules: [], derivations: [] },
    { id: "n-ql", key: "QualityLot", label: "质检批次", kind: "object", domain: "quality", tier: 2, sourceSystem: "QMS", properties: [{ propKey: "qlotId", dataType: "string", isPrimaryKey: true }, { propKey: "woId", dataType: "ref" }, { propKey: "modelId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "batchSize", dataType: "number" }, { propKey: "sampleSize", dataType: "number" }, { propKey: "passQty", dataType: "number" }, { propKey: "failQty", dataType: "number" }, { propKey: "status", dataType: "enum" }, { propKey: "inspectDate", dataType: "date" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_quality_lots" }], rules: [], derivations: [] },
    { id: "n-ir", key: "InspectionResult", label: "检验结果", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "resultId", dataType: "string", isPrimaryKey: true }, { propKey: "qlotId", dataType: "ref" }, { propKey: "charId", dataType: "ref" }, { propKey: "measuredValue", dataType: "number" }, { propKey: "targetValue", dataType: "number" }, { propKey: "upperLimit", dataType: "number" }, { propKey: "lowerLimit", dataType: "number" }, { propKey: "result", dataType: "enum" }, { propKey: "inspectTime", dataType: "date" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_inspection_results" }], rules: [], derivations: [] },
    { id: "n-dr", key: "DefectRecord", label: "缺陷记录", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "defectId", dataType: "string", isPrimaryKey: true }, { propKey: "qlotId", dataType: "ref" }, { propKey: "lotId", dataType: "ref" }, { propKey: "defectType", dataType: "enum" }, { propKey: "severity", dataType: "enum" }, { propKey: "qty", dataType: "number" }, { propKey: "description", dataType: "string" }, { propKey: "foundAt", dataType: "date" }, { propKey: "processName", dataType: "string" }], sourceBindings: [{ connId: "conn-qms", dataset: "qms_defects" }], rules: [], derivations: [] },
    { id: "n-eoee", key: "EquipmentOEE", label: "设备OEE", kind: "object", domain: "equip", tier: 3, sourceSystem: "IoT", properties: [{ propKey: "oeeId", dataType: "string", isPrimaryKey: true }, { propKey: "equipId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "date", dataType: "date" }, { propKey: "availability", dataType: "number" }, { propKey: "performance", dataType: "number" }, { propKey: "quality", dataType: "number" }, { propKey: "oee", dataType: "number" }, { propKey: "plannedProductionTime", dataType: "number" }, { propKey: "actualProductionTime", dataType: "number" }], sourceBindings: [{ connId: "conn-iot", dataset: "iot_oee_daily" }], rules: [], derivations: [] },
    { id: "n-edt", key: "EquipmentDowntime", label: "设备停机", kind: "object", domain: "equip", tier: 3, sourceSystem: "IoT", properties: [{ propKey: "dtId", dataType: "string", isPrimaryKey: true }, { propKey: "equipId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "startTime", dataType: "date" }, { propKey: "endTime", dataType: "date" }, { propKey: "durationMin", dataType: "number" }, { propKey: "reason", dataType: "enum" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-iot", dataset: "iot_downtime" }], rules: [], derivations: [] },
    { id: "n-eal", key: "EquipmentAlarm", label: "设备告警", kind: "object", domain: "equip", tier: 3, sourceSystem: "IoT", properties: [{ propKey: "alarmId", dataType: "string", isPrimaryKey: true }, { propKey: "equipId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "alarmCode", dataType: "string" }, { propKey: "alarmLevel", dataType: "enum" }, { propKey: "message", dataType: "string" }, { propKey: "triggeredAt", dataType: "date" }, { propKey: "clearedAt", dataType: "date" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-iot", dataset: "iot_alarms" }], rules: [], derivations: [] },
    { id: "n-mo", key: "MaintenanceOrder", label: "维修工单", kind: "object", domain: "equip", tier: 3, sourceSystem: "EAM", properties: [{ propKey: "moId", dataType: "string", isPrimaryKey: true }, { propKey: "equipId", dataType: "ref" }, { propKey: "lineId", dataType: "ref" }, { propKey: "maintType", dataType: "enum" }, { propKey: "priority", dataType: "enum" }, { propKey: "plannedStart", dataType: "date" }, { propKey: "plannedEnd", dataType: "date" }, { propKey: "actualStart", dataType: "date" }, { propKey: "actualEnd", dataType: "date" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-eam", dataset: "eam_maint_orders" }], rules: [], derivations: [] },
    { id: "n-spc", key: "SparePartConsumption", label: "备件消耗", kind: "object", domain: "equip", tier: 3, sourceSystem: "EAM", properties: [{ propKey: "consumptionId", dataType: "string", isPrimaryKey: true }, { propKey: "moId", dataType: "ref" }, { propKey: "partCode", dataType: "string" }, { propKey: "partName", dataType: "string" }, { propKey: "qtyUsed", dataType: "number" }, { propKey: "unit", dataType: "string" }, { propKey: "consumedAt", dataType: "date" }], sourceBindings: [{ connId: "conn-eam", dataset: "eam_spare_parts" }], rules: [], derivations: [] },
    { id: "n-oa", key: "OperatorAttendance", label: "操作工考勤", kind: "object", domain: "people", tier: 3, sourceSystem: "HR", properties: [{ propKey: "attId", dataType: "string", isPrimaryKey: true }, { propKey: "operatorId", dataType: "string" }, { propKey: "operatorName", dataType: "string" }, { propKey: "lineId", dataType: "ref" }, { propKey: "date", dataType: "date" }, { propKey: "shift", dataType: "enum" }, { propKey: "checkIn", dataType: "date" }, { propKey: "checkOut", dataType: "date" }, { propKey: "hoursWorked", dataType: "number" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-hr", dataset: "hr_attendance" }], rules: [], derivations: [] },
    { id: "n-osc", key: "OperatorSkillCert", label: "操作工技能认证", kind: "object", domain: "people", tier: 3, sourceSystem: "HR", properties: [{ propKey: "certId", dataType: "string", isPrimaryKey: true }, { propKey: "operatorId", dataType: "string" }, { propKey: "skillName", dataType: "string" }, { propKey: "skillLevel", dataType: "enum" }, { propKey: "certifiedBy", dataType: "string" }, { propKey: "certifiedDate", dataType: "date" }, { propKey: "expireDate", dataType: "date" }, { propKey: "status", dataType: "enum" }], sourceBindings: [{ connId: "conn-hr", dataset: "hr_skill_certs" }], rules: [], derivations: [] },
  ],
  edges: [
    // SA-3：Base→Workshop→Line 四层结构
    { id: "e1a", from: "n-base", to: "n-workshop", label: "拥有", kind: "rel" },
    { id: "e1b", from: "n-workshop", to: "n-line", label: "拥有", kind: "rel" },
    { id: "e1c", from: "n-base", to: "n-line", label: "拥有(直联)", kind: "rel" },
    { id: "e2", from: "n-line", to: "n-equip", label: "部署", kind: "rel" },
    { id: "e3", from: "n-line", to: "n-proc", label: "执行", kind: "rel" },
    { id: "e4", from: "n-order", to: "n-model", label: "订购", kind: "rel" },
    { id: "e5", from: "n-model", to: "n-base", label: "可产", kind: "rel" },
    { id: "e6", from: "n-people", to: "n-line", label: "排班", kind: "rel" },
    { id: "e7", from: "n-quality", to: "n-proc", label: "检验", kind: "rel" },
    { id: "e8", from: "n-cap", to: "n-base", label: "汇总", kind: "agg" },
    { id: "e9", from: "n-forecast", to: "n-model", label: "预测", kind: "rel" },
    { id: "e10", from: "n-solver-cap", to: "n-cap", label: "计算", kind: "solve" },
    { id: "e11", from: "n-solver-risk", to: "n-base", label: "推演", kind: "solve" },
    { id: "e12", from: "n-agent", to: "n-solver-cap", label: "调用", kind: "orch" },
    // —— 产能推演链（flow/agg）——
    { id: "e13", from: "OEE历史", to: "OEE指标", label: "聚合", kind: "flow" },
    { id: "e14", from: "OEE指标", to: "工序产能", label: "派生", kind: "flow" },
    { id: "e15", from: "良率", to: "工序产能", label: "派生", kind: "flow" },
    { id: "e16", from: "工序产能", to: "n-cap", label: "上卷", kind: "agg" },
    { id: "e17", from: "n-cap", to: "产能预测", label: "汇总", kind: "agg" },
    { id: "e18", from: "n-forecast", to: "产能预测", label: "需求输入", kind: "flow" },
    { id: "e19", from: "生产工单MO", to: "实际产出", label: "报工", kind: "flow" },
    { id: "e20", from: "n-line", to: "实际产出", label: "产出", kind: "flow" },
    // —— 求解（solve）——
    { id: "e21", from: "聚合求解器", to: "产能预测", label: "计算", kind: "solve" },
    { id: "e22", from: "聚合求解器", to: "n-cap", label: "计算", kind: "solve" },
    // —— 学习闭环（fb 反馈 / orch 编排）——
    { id: "e23", from: "实际产出", to: "精度校准器", label: "实际", kind: "fb" },
    { id: "e24", from: "产能预测", to: "精度校准器", label: "预测", kind: "fb" },
    { id: "e25", from: "精度校准器", to: "工序产能", label: "参数写回", kind: "fb" },
    { id: "e26", from: "OEE历史", to: "精度校准器", label: "偏差样本", kind: "fb" },
    { id: "e27", from: "良率", to: "精度校准器", label: "偏差样本", kind: "fb" },
    { id: "e28", from: "学习Agent", to: "精度校准器", label: "编排", kind: "orch" },
    { id: "e29", from: "学习Agent", to: "经验记忆库", label: "沉淀", kind: "orch" },
    { id: "e30", from: "学习Agent", to: "聚合求解器", label: "触发重算", kind: "orch" },
    { id: "e31", from: "经验记忆库", to: "OEE指标", label: "经验引用", kind: "orch" },
    // —— Phase 2 产品工程链路 ——
    { id: "e32", from: "n-platform", to: "n-series", label: "拥有", kind: "rel" },
    { id: "e33", from: "n-series", to: "n-model", label: "拥有", kind: "rel" },
    { id: "e34", from: "n-model", to: "n-version", label: "拥有", kind: "rel" },
    { id: "e35", from: "n-version", to: "n-bom", label: "BOM", kind: "rel" },
    { id: "e36", from: "n-bom", to: "n-bomd", label: "明细", kind: "rel" },
    { id: "e37", from: "n-bomd", to: "n-material", label: "使用物料", kind: "rel" },
    { id: "e38", from: "n-matalt", to: "n-material", label: "替代", kind: "rel" },
    { id: "e39", from: "n-version", to: "n-routing", label: "工艺路线", kind: "rel" },
    { id: "e40", from: "n-routing", to: "n-op", label: "工序", kind: "rel" },
    { id: "e41", from: "n-op", to: "n-pcw", label: "能力边界", kind: "rel" },
    { id: "e42", from: "n-model", to: "n-qs", label: "质量标准", kind: "rel" },
    { id: "e43", from: "n-qs", to: "n-ic", label: "检验特性", kind: "rel" },
    { id: "e44", from: "n-model", to: "n-plc", label: "产线能力", kind: "rel" },
    { id: "e45", from: "n-plc", to: "n-line", label: "涉及产线", kind: "rel" },
    { id: "e46", from: "n-model", to: "n-pec", label: "设备能力", kind: "rel" },
    { id: "e47", from: "n-pec", to: "n-equip", label: "涉及设备", kind: "rel" },
    { id: "e48", from: "n-ec", to: "n-model", label: "影响", kind: "rel" },
    { id: "e49", from: "n-material", to: "n-supplier", label: "供应", kind: "rel" },
    // —— 新增节点链路补齐 ——
    { id: "e50", from: "n-base", to: "n-maint", label: "检修", kind: "rel" },
    { id: "e51", from: "n-base", to: "n-ship", label: "在途", kind: "rel" },
    { id: "e52", from: "n-base", to: "n-dsh", label: "数据源", kind: "rel" },
    { id: "e53", from: "n-base", to: "n-em", label: "能耗", kind: "rel" },
    { id: "e54", from: "n-base", to: "n-fa", label: "财务", kind: "rel" },
    { id: "e55", from: "n-model", to: "n-seg", label: "细分", kind: "rel" },
    { id: "e56", from: "n-model", to: "n-com", label: "换型", kind: "rel" },
    { id: "e57", from: "n-order", to: "n-cust", label: "客户", kind: "rel" },
    { id: "e58", from: "n-cust", to: "n-ar", label: "应收", kind: "rel" },
    { id: "e59", from: "n-material", to: "n-mbatch", label: "批次", kind: "rel" },
    { id: "e60", from: "n-material", to: "n-po", label: "采购", kind: "rel" },
    { id: "e61", from: "n-material", to: "n-cf", label: "碳因子", kind: "rel" },
    { id: "e62", from: "n-ascn", to: "n-ptgt", label: "目标", kind: "rel" },
    { id: "e63", from: "n-ascn", to: "n-capex", label: "投资", kind: "rel" },
    { id: "e64", from: "n-ascn", to: "n-fm", label: "财务指标", kind: "rel" },
    { id: "e65", from: "n-metric", to: "n-ksf", label: "KSF", kind: "rel" },
    { id: "e66", from: "n-metric", to: "n-prin", label: "责任人", kind: "rel" },
    { id: "e67", from: "n-ptgt", to: "n-prin", label: "责任人", kind: "rel" },
    { id: "e68", from: "n-trig", to: "n-ascn", label: "触发", kind: "rel" },
    { id: "e69", from: "n-dseg", to: "n-forecast", label: "需求", kind: "rel" },
    { id: "e70", from: "n-mbal", to: "n-material", label: "平衡", kind: "rel" },
    { id: "e71", from: "n-rcc", to: "n-metric", label: "归因", kind: "rel" },
    { id: "e72", from: "n-sopv", to: "n-ascn", label: "版本", kind: "rel" },
    // —— Phase 3 MES Domain 边 ——
    { id: "e73", from: "n-wo", to: "n-model", label: "型号", kind: "rel" },
    { id: "e74", from: "n-wo", to: "n-line", label: "产线", kind: "rel" },
    { id: "e75", from: "n-ps", to: "n-wo", label: "排程", kind: "rel" },
    { id: "e76", from: "n-sp", to: "n-line", label: "班次", kind: "rel" },
    { id: "e77", from: "n-wipl", to: "n-wo", label: "工单", kind: "rel" },
    { id: "e78", from: "n-wipl", to: "n-line", label: "产线", kind: "rel" },
    { id: "e79", from: "n-wipm", to: "n-wipl", label: "批次", kind: "rel" },
    { id: "e80", from: "n-wipq", to: "n-wipl", label: "质检", kind: "rel" },
    { id: "e81", from: "n-ql", to: "n-wo", label: "工单", kind: "rel" },
    { id: "e82", from: "n-ir", to: "n-ql", label: "质检", kind: "rel" },
    { id: "e83", from: "n-dr", to: "n-ql", label: "缺陷", kind: "rel" },
    { id: "e84", from: "n-dr", to: "n-wipl", label: "在制", kind: "rel" },
    { id: "e85", from: "n-eoee", to: "n-equip", label: "OEE", kind: "rel" },
    { id: "e86", from: "n-edt", to: "n-equip", label: "停机", kind: "rel" },
    { id: "e87", from: "n-eal", to: "n-equip", label: "告警", kind: "rel" },
    { id: "e88", from: "n-mo", to: "n-equip", label: "维修", kind: "rel" },
    { id: "e89", from: "n-spc", to: "n-mo", label: "备件", kind: "rel" },
    { id: "e90", from: "n-oa", to: "n-line", label: "考勤", kind: "rel" },
    { id: "e91", from: "n-osc", to: "n-oa", label: "技能", kind: "rel" },
  ],
};

// ---------------------------------------------------------------------------
// 风险时间线（solver 输出，契约 RiskTimelineOutput）
// ---------------------------------------------------------------------------

function riskSeries(seed: number, peakDay: number, peak: number): number[] {
  return Array.from({ length: 14 }, (_, d) => {
    const base = 45 + Math.sin((d + seed) * 0.7) * 12;
    const spike = peak * Math.exp(-((d - peakDay) ** 2) / 6);
    return Math.min(100, Math.round(base + spike * 0.55));
  });
}

export const RISK_TIMELINE: RiskTimelineOutput = {
  horizon: 14,
  threshold: 85,
  cards: [
    {
      ...baseRef("常州"), factor: "化成柜张力", peak: 96, crossDay: 5, series: riskSeries(1, 5, 96),
      events: [
        { type: "maint_window", day: 4, amp: 18, factors: ["化成柜"], tag: "检修窗", obj: "常州", desc: "年度检修（第1周）：计划停机 5 天，设备OEE 由基线下调 6 个百分点", src: "EAM/CMMS 检修计划" },
        { type: "delivery_peak", day: 6, amp: 12, factors: ["交付"], tag: "交付高峰", obj: "SO-10001", desc: "SO-10001·蔚途汽车 交付 1500 万套到期：当周产线排产负载 +9 个百分点", src: "S&OP/ERP 订单交期" },
      ],
      // 增量 §7.10-4/§7.11 PropagationTimeline：越线窗口内受波及订单（affected_orders 同源）
      affectedOrders: [
        { so: "SO-10001", cust: "蔚途汽车", model: "4680-NCM", qty: 1500, due: "2026-06-20", dueDay: 8, delay: 3, impact: 0.5 },
        { so: "SO-10004", cust: "极光新能源", model: "储能-280Ah", qty: 2200, due: "2026-06-24", dueDay: 12, delay: 5, impact: 0.7 },
      ],
    },
    {
      ...baseRef("江门"), factor: "交付高峰", peak: 91, crossDay: 8, series: riskSeries(2, 8, 91),
      events: [{ type: "delivery_peak", day: 8, amp: 16, factors: ["交付"] }],
      affectedOrders: [{ so: "SO-10002", cust: "星河储能", model: "储能-314Ah", qty: 820, due: "2026-06-25", dueDay: 13, delay: 2, impact: 0.4 }],
    },
    { ...baseRef("合肥"), factor: "到货间隙", peak: 82, crossDay: null, series: riskSeries(3, 9, 82), events: [{ type: "arrival_gap", day: 9, amp: 10, factors: ["供料"] }] },
    { ...baseRef("眉山"), factor: "分容柜瓶颈", peak: 76, crossDay: null, series: riskSeries(4, 11, 76), events: [] },
    { ...baseRef("成都"), factor: "卷绕机稼动", peak: 71, crossDay: null, series: riskSeries(5, 3, 71), events: [] },
    { ...baseRef("武汉"), factor: "注液机产能", peak: 64, crossDay: null, series: riskSeries(6, 7, 64), events: [] },
  ],
  // PRD-IND-risk §2.4：处置行动计划表。
  // WO-LIVE-DISPOSITION（KILL-MOCK·mock 也真重算·不写死两套）：planRows 不再是静态字面量，而是由
  // `mockRiskPlanRows()`（handlers.ts）用**与后端同一份** `deriveDisposition`（@platform/contracts）从下方
  // RISK_DISPOSITION_SEED 真派生——基线（apply 空）与杠杆推演态（apply 非空）走**同一条代码路径**，
  // 只是 capRatio 不同 → 前端 mock 模式下调杠杆点「生成/重算」处置表也真变（与真引擎口径一致）。
  planRows: [],
  // 欠账 #178 · 作用域诚实位（KILL-MOCK：与真引擎 `apps/datacore/src/solvers/risk.ts:777` 一字不差）。
  // 本 fixture 的 `cards[]` 是**全部 8 个基地**、从不按 `args.base` 裁剪 ⇒ 它算出来的恒是全网口径，
  // 所以恒标 `ALL`。**不许**因为调用方传了 base 就改标 `BASE` —— 那是拿标签冒充计算，
  // 正是引擎侧几轮工单在消灭的「假个性化」，在 mock 里复活一份等于把病灶搬进开发态。
  // （引擎侧走 BASE 分支时另有 `scopeBaseId`/`scopeBaseName`；mock 没有那条路，故两键不出现。）
  scope: "ALL",
  scopeNote: "全网（未指定基地·跨全部基地取越线卡）",
};

/**
 * WO-LIVE-DISPOSITION · mock 世界的处置推演真数据源（镜像后端 SolverContext 的对应输入）：
 *   freeDaily  ← 后端 Σ Line.capacityDaily×(1−util/100)
 *   demand     ← 该卡 affectedOrders Σqty（mock 的"窗内未来订单"）
 *   capRatio   ← 杠杆 overlay 经"产能链"吸收（后端 = computeByProcessModel 覆写前后比；mock = Π 值/基线）
 *   plans      ← 后端 params.risk.mitigations（方案库参照名·仅作 act/eff 回落与 plan 字段）
 * 所有数值都是 mock 数据，但**派生过程与后端同一函数**（非两套写死结果）。
 */
export const RISK_DISPOSITION_SEED = {
  forecastStart: "2026-06-10",
  defaultHorizon: 30,
  coeff: { overtimeUpliftPct: 0.15, crossBaseAbsorbPct: 0.6 },
  /** 产能链原子因子当前值（mock 基线）——capRatio = Π（覆写值/基线，utilization 类取倒数：利用率↑=可用产能↓）。 */
  leverBaseline: {
    "Equipment.oee_current": 0.82,
    "Process.yield_baseline": 0.9,
    "Line.utilization": 0.75,
    "Material.onHand": 6116,
    "MaterialBalance.coverage": 0.72,
    // redline-allow：这是**观测值**（当前外协比例），非红线阈值本身；恰好等于红线是数据巧合，见 DF.13 报告。
    "Order.outsourceRatio": 0.2,
  } as Record<string, number>,
  inverseProps: ["utilization"],
  bases: [
    { ...baseRef("常州"), owner: "基地负责人 · 王经理", freeDaily: 100, plans: [{ name: "关键正极提前备料", eff: 12, tn: 2 }, { name: "增开夜班", eff: 11, tn: 2 }] },
    { ...baseRef("江门"), owner: "基地负责人 · 李经理", freeDaily: 20, plans: [{ name: "近端仓+供应商VMI", eff: 9, tn: 5 }, { name: "跨基地调剂", eff: 8, tn: 4 }] },
  ],
  /**
   * WO-DECISION-INFO-FE · 决策三块的 mock 真数据源（镜像后端读的那几个真对象）：
   *   crossBaseLead / outsourceLead ← `InterBaseTransfer.transitDays` / `Supplier.leadTime`
   *                                   （前置期·R13 溯源锚：治「+7 / +14 两个魔数」）
   *   crossBaseFreight              ← `InterBaseTransfer.freightCost ÷ qty`（跨基地调剂成本唯一出处）
   *   displaceable                  ← 其他基地窗内在手单（跨基地调剂的副作用**点名到单**）
   *   coefficients                  ← 与真仓一致标 `DEFAULT_FALLBACK`：`base_outlook_coeffs` 这条规则
   *                                   全仓只有读方没有写方（"接了线没数据"）→ 系数是代码兜底、不是治理口径
   *
   * ⚠ 加班杠杆刻意**不给**前置期与成本：本体确实没有「加班启动前置期 / 加班工时费率」承载字段。
   *   mock 若给了，前端就会被训练成"总有数可显"，而真环境是 EMPTY —— 那正是假绿的温床。
   */
  crossBaseLead: {
    status: "OK" as const,
    days: 3,
    source: { objectType: "InterBaseTransfer", objectId: "IBT-CZ-JM-01", field: "transitDays", value: 3 },
  },
  outsourceLead: {
    status: "OK" as const,
    days: 6,
    source: { objectType: "Supplier", objectId: "SUP-EXT-07", field: "leadTime", value: 6 },
  },
  /** 运费单价 = freightCost ÷ qty = 86000 ÷ 4000 = 21.5 元/套（自洽·不写第二个数）。 */
  crossBaseFreight: { transferId: "IBT-CZ-JM-01", freightCost: 86000, qty: 4000, yuanPerUnit: 21.5 },
  displaceable: [
    { so: "SO-20231", cust: "远东商用车", ...baseRef("江门"), baseName: "江门", qty: 900, pri: "低", due: "2026-06-28", dueDay: 18, freeDaily: 20 },
    { so: "SO-20244", cust: "南方电网", ...baseRef("合肥"), baseName: "合肥", qty: 1400, pri: "中", due: "2026-07-02", dueDay: 22, freeDaily: 35 },
  ],
  coefficients: [
    {
      key: "overtimeUpliftPct",
      value: 0.15,
      basis: "DEFAULT_FALLBACK" as const,
      ruleKey: "base_outlook_coeffs",
      note: "规则 base_outlook_coeffs 未发布（全仓只有读方没有写方）→ 本值是**代码兜底默认**，不是被治理过的口径；要让它可校准，需在场景包规则表里种下该 params",
    },
    {
      key: "crossBaseAbsorbPct",
      value: 0.6,
      basis: "DEFAULT_FALLBACK" as const,
      ruleKey: "base_outlook_coeffs",
      note: "同上：代码兜底默认值，非规则口径",
    },
  ],
};

// ---------------------------------------------------------------------------
// 意图 ×4 + 规则 + 策略
// ---------------------------------------------------------------------------

const now = "2026-06-01T00:00:00Z";

export const INTENTS: IntentDefinition[] = [
  {
    id: "int-affected", packageId: PACKAGE_ID, key: "affected_orders", version: 3, status: "PUBLISHED",
    name: "受影响订单查询", description: "查询某基地在风险时间窗内受影响的订单", examples: ["影响哪些订单？", "常州风险波及哪些交付", "受影响订单清单"],
    enabledViews: ["risk", "order"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", clarifyPrompt: "请选择基地", description: "目标基地" },
      { name: "timeWindow", type: "timeWindow", required: false, description: "时间窗" },
    ],
    planId: "plan-affected", riskLevel: "READ", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-cap", packageId: PACKAGE_ID, key: "capacity_feasibility", version: 2, status: "PUBLISHED",
    name: "需求增量可行性", description: "判断某型号增量需求能否承接", examples: ["4680-NCM 加 20% 六周能不能接？", "增产可行吗"],
    enabledViews: "*", slots: [
      { name: "model", type: "objectRef", required: true, description: "型号" },
      { name: "demandDelta", type: "number", required: true, description: "需求增量比例" },
      { name: "weeks", type: "number", required: false, description: "周数" },
    ],
    planId: "plan-cap", riskLevel: "COMPUTE", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-root", packageId: PACKAGE_ID, key: "risk_root_cause", version: 1, status: "PUBLISHED",
    name: "越线归因", description: "解释某基地某天为什么越线", examples: ["为什么这天越线", "D+5 张力为何超阈值"],
    enabledViews: ["risk"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", description: "基地" },
      { name: "day", type: "date", required: true, clarifyPrompt: "请提供日期", description: "日期" },
    ],
    planId: "plan-root", riskLevel: "READ", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-adopt", packageId: PACKAGE_ID, key: "adopt_mitigation", version: 1, status: "PUBLISHED",
    name: "采纳处置方案", description: "把处置方案落为 Action 草稿走审批", examples: ["采纳常州的三班制方案"],
    enabledViews: ["risk"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", description: "基地" },
      { name: "solutionName", type: "enum", required: true, enumValues: ["三班制", "外协转移", "提前备料"], description: "方案" },
    ],
    planId: "plan-adopt", riskLevel: "ACTION_DRAFT", owner: "ops", createdAt: now, updatedAt: now,
  },
];

/**
 * 执行计划 mock。
 *
 * WO-BEFE-E：补齐 `packageId` + `steps` —— 此前只有 `{id,key,version,status}` 四个字段，
 * 而后端 `listPlans` 返的是完整 `ExecutionPlan`（`catalog/service.ts:226` 直接吐仓储行）。
 * 少这两个字段的直接后果：计划编辑器**在 mock 态永远看不到步骤**，于是"改步骤 → 保存 → 真的变了"
 * 这条链在测试里演不出来，断言只能咬桩。形状对齐后 mock 与真后端同形（R9 双实现同构的同款纪律）。
 * `steps` 一律以 `render_answer` 收尾 —— 那正是后端 `validatePlanSteps(..., {requireRenderAnswer:true})`
 * （`catalog/service.ts:276`）发布时的硬校验，mock 不能给一份"发布必红"的种子。
 */
export const PLANS = [
  { id: "plan-affected", packageId: PACKAGE_ID, key: "affected_orders_plan", version: 3, status: "PUBLISHED",
    steps: [{ id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
            { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "受影响订单" }] } }] },
  { id: "plan-cap", packageId: PACKAGE_ID, key: "capacity_feasibility_plan", version: 2, status: "PUBLISHED",
    steps: [{ id: "s1", type: "invoke_solver", params: { solverKey: "capacity_analysis", args: {} } },
            { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "产能可行性" }] } }] },
  { id: "plan-root", packageId: PACKAGE_ID, key: "risk_root_cause_plan", version: 1, status: "PUBLISHED",
    steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "根因" }] } }] },
  { id: "plan-adopt", packageId: PACKAGE_ID, key: "adopt_mitigation_plan", version: 1, status: "PUBLISHED",
    steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "采纳" }] } }] },
];

/**
 * 已发布规则库 mock（A5）—— **口径必须与真后端 `datacore synthetic/battery.ts BATTERY_RULES` 一致**。
 *
 * WO-RULE-EXPR-PARAMS（欠账 #78）修的病：本表此前与真后端**系统性不同口径**，四处全错且测试全绿：
 *  ① **极性反了**：写成人读的**约束式**（`Order.demandDelta <= 0.5`「必须不超过」），
 *     而规则引擎吃的是**违规谓词**（`> 0.5`，表达式为真 ⇒ passed=false）。照 mock 的写法喂引擎，
 *     每条规则的判定**恰好反过来**——合规订单全部报违规、越线订单全部放行。
 *     （同一份 mock 里 `simSolvers.ts` 的 evaluatedRules 用的却是违规谓词式 → 前端自己内部都不自洽。）
 *  ② **主体/字段错**：C08 写成 `Outsource.ratio`（真后端是 `Order.outsourceRatio`）、
 *     C13 写成 `Order.credit <= Customer.creditLimit`（真后端是 `Order.creditUsedRatio > 1`）。
 *  ③ **对象类型名被中译**：C05 写成 `SUSTAIN(产线.utilization > 95, 3)` —— `产线` 不是任何已注册
 *     对象类型 key（真后端是 `Line`），字段永远解析不到 ⇒ 该规则在 mock 态是哑弹。
 *  ④ **params 多一份已删的阈值**：C09 带 `normalFactor: 0.93`，而真后端刻意把它删了
 *     （`health.normal` 归 M11 校准参数 `p90_health` 所有，规则再声明一份就是第二个写者 + 诱饵）。
 *
 * 判定「哪边对」：**后端对**。理由不是"后端更权威"，而是 `packages/contracts/src/base-registry.ts`
 * 对这两种渲染有明文分工——`outsourceRedlineViolationExpr` 喂规则引擎、`outsourceRedlineConstraintExpr`
 * 只用于**文档原文/A2 抽取候选**（人读的「不得超过」）。本表是**已发布规则**，属前者。
 * （本文件里 A2 抽取候选 `RULE_CANDIDATES` 仍用约束式 —— 那是对的，别"顺手统一"。）
 *
 * 阈值一律**只存 params 一处**，expression 用 `params.<名>` 引用（与后端同机制，见 ruleParamRef）。
 */
export const RULES: RuleEntry[] = [
  // WO-RULES-CLASSIFY：category 与真后端 battery.ts 种子同步（规则库分类筛选真元数据；约束条件另按 severity=BLOCK 判别）。
  { id: "rule-c03", key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.5", scopeObjectTypes: ["Order", "CapacityPyramid"], severity: "BLOCK", category: "产能", origin: { type: "DOCUMENT", docId: "doc-policy", span: { start: 120, end: 180 }, extractJobId: "job-ex1" }, version: 2, status: "PUBLISHED" },
  { id: "rule-c08", key: "C08", name: "外协比例红线", expression: outsourceRedlineViolationExprPublished(), scopeObjectTypes: ["Order"], severity: "WARN", category: "外协", params: { [OUTSOURCE_REDLINE.paramKey]: OUTSOURCE_REDLINE.maxRatio }, origin: { type: "MANUAL" }, version: 1, status: "PUBLISHED" },
  { id: "rule-c13", key: "C13", name: "客户信用额度", expression: "Order.creditUsedRatio > 1", scopeObjectTypes: ["Order"], severity: "BLOCK", category: "财务", origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED" },
  { id: "rule-c05", key: "C05", name: "产线利用率持续越线", expression: "SUSTAIN(Line.utilization > 95, 3)", scopeObjectTypes: ["Line"], severity: "WARN", category: "产能", origin: { type: "DOCUMENT", docId: "doc-policy", span: { start: 320, end: 390 }, extractJobId: "job-ex1" }, version: 1, status: "PUBLISHED" },
  // 规则即引用 P1：曾"未找到定义"的规则补为一等规则（含命名阈值 params）——mock 与真后端同步。
  { id: "rule-c09", key: "C09", name: "数据时延临时降级", expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`, scopeObjectTypes: ["DataSourceHealth"], severity: "WARN", category: "质量", params: { staleHours: 2, degradedFactor: 0.9 }, origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED" },
];

export const POLICIES: PermissionPolicy[] = [
  { id: "pol-base", tenantId: TENANT_ID, resource: { kind: "OBJECT_TYPE", key: "Base" }, grants: [{ role: "planner", ops: ["READ", "WRITE"] }, { role: "base_manager", ops: ["READ"] }], rowFilter: "Base.name IN ${user.attributes.baseScope}" },
  { id: "pol-order", tenantId: TENANT_ID, resource: { kind: "OBJECT_TYPE", key: "Order" }, grants: [{ role: "planner", ops: ["READ", "WRITE"] }, { role: "base_manager", ops: ["READ"] }], rowFilter: "Order.bases IN ${user.attributes.baseScope}" },
  { id: "pol-action", tenantId: TENANT_ID, resource: { kind: "ACTION_TYPE", key: "shift_plan_change" }, grants: [{ role: "planner", ops: ["EXECUTE"] }, { role: "admin", ops: ["EXECUTE"] }] },
];

// ---------------------------------------------------------------------------
// 连接器 / 规则文档 / 建模草案
// ---------------------------------------------------------------------------

export const CONNECTOR_TYPES: ConnectorType[] = [
  {
    key: "sap_erp", category: "ERP",
    configSchema: {
      type: "object",
      required: ["host", "client"],
      properties: {
        host: { type: "string", title: "主机", description: "SAP 应用服务器地址" },
        client: { type: "string", title: "Client" },
        username: { type: "string", title: "用户名" },
        password: { type: "string", title: "密码", format: "secret" },
        useTls: { type: "boolean", title: "启用 TLS", default: true },
        landscape: { type: "string", title: "环境", enum: ["DEV", "QAS", "PRD"] },
      },
    },
    capabilities: { batch: true, incremental: true, schemaDiscovery: true },
  },
  {
    key: "rest_api", category: "EXTERNAL",
    configSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", title: "URL" },
        apiKey: { type: "string", title: "API Key", format: "secret" },
        pageSize: { type: "number", title: "分页大小" },
      },
    },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "mock_erp", category: "ERP",
    configSchema: { type: "object", properties: { dataset: { type: "string", title: "样本集", enum: ["orders", "plants"] } } },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
];

export const RULE_DOC: RuleDocVM = {
  id: "doc-policy",
  filename: "产销协同管理制度v3.docx",
  status: "IN_REVIEW",
  createdAt: now,
  segments: [
    { idx: 0, heading: "三、产能承接", text: "各基地接单需校核产能上限：单型号需求增量超过基准产能的 50% 时，禁止直接承接，须升级至产销协同会审批。", spanStart: 0, spanEnd: 60 },
    // DF.13：被抽取的**制度原文**也用同一红线渲染 —— 否则原文说 20%、候选说别的，A2 抽取演示自己就先自相矛盾。
    { idx: 1, heading: "四、外协管理", text: `外协比例原则上不得超过 ${outsourceRedlinePct()}%，超出部分需提交外协风险评估报告并由质量部会签。`, spanStart: 61, spanEnd: 120 },
    { idx: 2, heading: "五、信用管理", text: "客户在手订单金额不得超过其授信额度，超出时新订单冻结发运。", spanStart: 121, spanEnd: 170 },
  ],
};

export const RULE_CANDIDATES: RuleCandidateVM[] = [
  {
    id: "cand-1", docId: "doc-policy", segmentIdx: 0, span: { start: 12, end: 48 },
    candidate: { name: "产能上限", description: "需求增量超过基准产能 50% 禁止直接承接", expression: "Order.demandDelta <= 0.5", expressionConfidence: 0.92, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "单型号需求增量超过基准产能的 50% 时，禁止直接承接" },
    status: "PENDING", diff: "变更", duplicateOf: "C03",
  },
  {
    id: "cand-2", docId: "doc-policy", segmentIdx: 1, span: { start: 0, end: 20 },
    candidate: { name: "外协红线", description: `外协比例不得超过 ${outsourceRedlinePct()}%`, expression: outsourceRedlineConstraintExpr("Outsource.ratio"), expressionConfidence: 0.88, scopeObjectTypes: ["QualityLot"], severity: "WARN", sourceQuote: `外协比例原则上不得超过 ${outsourceRedlinePct()}%` },
    status: "PENDING", diff: "新增",
  },
  {
    id: "cand-3", docId: "doc-policy", segmentIdx: 2, span: { start: 0, end: 26 },
    candidate: { name: "信用额度冻结", description: "在手订单金额超授信额度冻结发运", expression: "Order.credit <= Customer.creditLimit", expressionConfidence: 0.61, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "客户在手订单金额不得超过其授信额度" },
    status: "PENDING", diff: "疑似删除",
  },
];

export const MODELING_DRAFT: ModelingDraftVM = {
  id: "draft-1",
  status: "DRAFT",
  rawDatasetIds: ["rds-orders", "rds-plants"],
  datasets: [
    {
      name: "orders.csv",
      fields: [
        { name: "so_no", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "customer", inferredType: "string", nullRate: 0.02, uniqueRate: 0.2, enumCandidates: ["蔚途汽车", "星河储能"] },
        { name: "model_no", inferredType: "string", nullRate: 0, uniqueRate: 0.3 },
        { name: "qty", inferredType: "number", nullRate: 0, uniqueRate: 0.9 },
        { name: "due_date", inferredType: "date", nullRate: 0.05, uniqueRate: 0.7 },
        { name: "plant", inferredType: "string", nullRate: 0, uniqueRate: 0.1 },
      ],
    },
    {
      name: "plants.csv",
      fields: [
        { name: "plant_code", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "plant_name", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "capacity_gwh", inferredType: "number", nullRate: 0, uniqueRate: 0.8 },
      ],
    },
  ],
  suggestion: {
    objectTypes: [
      {
        action: "MAP_TO_EXISTING", existingTypeKey: "Order", typeKey: "Order", displayName: "订单", domain: "product", sourceDataset: "orders.csv",
        properties: [
          { propKey: "so", sourceField: "so_no", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
          { propKey: "cust", sourceField: "customer", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "model", sourceField: "model_no", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
          { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "due", sourceField: "due_date", dataType: "date", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "base", sourceField: "plant", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
        ],
        confidence: 0.93,
      },
      {
        action: "CREATE", existingTypeKey: null, typeKey: "Plant", displayName: "工厂", domain: "unassigned", sourceDataset: "plants.csv",
        properties: [
          { propKey: "code", sourceField: "plant_code", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "name", sourceField: "plant_name", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "gwh", sourceField: "capacity_gwh", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
        ],
        confidence: 0.71,
      },
    ],
    linkTypes: [
      { fromTypeKey: "Order", toTypeKey: "Plant", viaFields: { fromField: "plant", toField: "plant_code" }, cardinality: "1:N", nameSuggestion: "produced_at", confidence: 0.9 },
    ],
  },
};

// ---------------------------------------------------------------------------
// AgentCore 配置
// ---------------------------------------------------------------------------

export const AGENTS: AgentDefinition[] = [
  {
    id: "agt-explore", tenantId: TENANT_ID, key: "explore_agent", version: 2, name: "探索分析 Agent", description: "目录外问题兜底分析",
    model: "claude-opus-4-8", systemPrompt: "你是企业决策系统的分析助手。所有业务数字必须来自工具结果并以 ⟦ref:N⟧ 标注。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }, { kind: "BUILTIN", name: "invoke_solver" }, { kind: "WORKFLOW", workflowId: "wf-cap", version: "latest" }],
    ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "POST_CHECK" },
    skills: [{ skillId: "skl-capacity", version: "latest" }],
    mcpServers: [{ mcpConfigId: "mcp-demo" }],
    scopeDeclaration: { objectTypes: ["Base", "Order", "Model"], toolNames: ["query_objects", "invoke_solver"] },
    budget: { maxIterations: 8, maxToolCalls: 10 },
    status: "PUBLISHED",
  },
  {
    id: "agt-draft", tenantId: TENANT_ID, key: "report_agent", version: 1, name: "周报生成 Agent（草稿）", description: "",
    model: "claude-opus-4-8", systemPrompt: "",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [], mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "DRAFT",
  },
];

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "wf-cap", tenantId: TENANT_ID, key: "capacity_check", version: 2, name: "产能校核流程", description: "型号增量校核",
    inputs: { type: "object", properties: { model: { type: "string" }, demandDelta: { type: "number" }, weeks: { type: "number" } } },
    steps: [
      { id: "s1", type: "resolve_slice", params: { sliceKey: "model_capacity_network", args: { modelId: "{{slots.model}}" } } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { modelId: "{{slots.model}}", demandDelta: "{{slots.demandDelta}}" } } },
      { id: "s3", type: "evaluate_rules", params: { ruleIds: ["C03"], payload: "{{steps.s2.output}}" } },
      { id: "s4", type: "render_answer", params: { blocks: [] } },
    ],
    status: "PUBLISHED",
  },
  {
    id: "wf-draft", tenantId: TENANT_ID, key: "risk_digest", version: 1, name: "风险日报（草稿）", description: "",
    inputs: { type: "object", properties: { base: { type: "string" }, horizon: { type: "number" } } },
    steps: [
      { id: "s1", type: "query_objects", params: { objectType: "Base", filter: { name: "{{slots.base}}" } } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "risk_timeline", args: { base: "{{steps.s1.output}}" } } },
      { id: "s3", type: "invoke_agent", params: { agentId: "agt-explore", version: "latest", prompt: "总结 {{steps.s2.output}}" } },
      { id: "s4", type: "render_answer", params: { blocks: [] } },
    ],
    status: "DRAFT",
  },
];

/**
 * B4 Skill 库 mock —— **口径对齐真后端种子** `apps/agentcore/src/mocks/seed.ts`（WO-FE-SKILL-STUDIO）。
 *
 * 病灶（2026-08-09 改前实测 · 复验命令：`grep -c 'capability\|sideEffect\|approvalGate' apps/frontend-shell/src/mocks/fixtures.ts`
 * 改前为 0，金丝雀 `grep -c 'status:'` 同文件 >0 证明工具有效）：
 * 本 fixture 只有 `SkillDefinition` 九个「改造之前就有的」字段
 * （id/tenantId/key/version/name/summary/body/resources/status），而契约
 * `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236`）早已带上
 * capability / sideEffect / approvalGate / provenancePolicy / inputSchema / outputSchema /
 * references / dependsOn / maxBudgetRounds。于是 mock 模式下这些块**永远渲染不出来**，
 * 前端等于在一份比真后端瘦一圈的数据上自测——正是本仓吃过的「前端 mock 与真后端口径分家」。
 *
 * 对齐口径（逐条对得上真种子，不是编的）：
 *   · `skl-capacity`  ≙ seed `skl_seed_capacity`（analysis/READ·references 2 条：solver+rule）
 *   · `skl-draft`     ≙ seed `skl_seed_sop_meeting`（planning/READ·references 1 条：workflow）
 *   · `skl-action`    ≙ seed `skl_seed_capacity_action`（prescription · sideEffect WRITE · approvalGate human ·
 *                       provenancePolicy required —— 出厂唯一写回型技能，写模式判定的活体样本）
 *   · `skl-mcp-guide` ≙ seed `skl_seed_mcp_guide`（`references: []` —— **空引用**的对照样本，
 *                       用来钉死「空则不渲染该块、不崩、不出现假值」这条断言）
 *
 * ⚠️ 一处**刻意的、已知的**与真种子的差异，不许当成对齐失败：`skl-action.dependsOn`。
 *    亲手实测 canonical（`grep -n 'dependsOn' apps/agentcore/src/mocks/seed.ts` → **0 命中**；
 *    同文件 `grep -c 'references:'` → 7 命中，证明 grep 工具本身没坏）：真种子里 `dependsOn`
 *    **一条都没有**，属「接了线没数据」而非「没接线」（消费方 skill-lint.ts 确实在读它）。
 *    此处种 1 条**契约合法**的 `kind:"skill"` 依赖，只为让该渲染路径有活体可验；
 *    对着真后端跑时该块会是空的 → 按设计不渲染。此差异已写进交付说明，勿删本注释。
 */
export const SKILLS: SkillDefinition[] = [
  {
    id: "skl-capacity", tenantId: TENANT_ID, key: "capacity_analysis", version: 3, name: "产能分析方法论",
    summary: "产能金字塔口径与 P50/P90 解读要点。", body: "# 产能分析\n\n1. 先看认证状态…",
    resources: [{ name: "口径表.xlsx", blobKey: "blob-1" }], status: "PUBLISHED",
    capability: "analysis", sideEffect: "READ", provenancePolicy: "best_effort", approvalGate: "none",
    inputSchema: {
      type: "object",
      required: ["modelId"],
      properties: {
        modelId: { type: "string", description: "型号键" },
        weeks: { type: "number", description: "推演周数" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        conclusion: { type: "string" }, capWanP50: { type: "number" }, capWanP90: { type: "number" }, gapPct: { type: "number" },
      },
    },
    references: [
      { kind: "solver", key: "capacity_forecast", role: "context", required: true },
      { kind: "rule", key: "C03", role: "postcheck", required: true },
    ],
  },
  {
    id: "skl-draft", tenantId: TENANT_ID, key: "sop_meeting", version: 1, name: "S&OP 会议纪要技能（草稿）",
    summary: "纪要结构化要点。", body: "# 纪要", resources: [], status: "DRAFT",
    capability: "planning", sideEffect: "READ", provenancePolicy: "best_effort", approvalGate: "none",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string" }, segment: { type: "string" } },
    },
    references: [{ kind: "workflow", key: "sop_balance_wf", role: "context", required: true }],
  },
  {
    id: "skl-action", tenantId: TENANT_ID, key: "capacity_action_draft", version: 1, name: "产能处置行动拟稿",
    summary: "把产能推演结论落成可审批的行动项。不适用：只问数不要行动。", body: "# 行动拟稿\n\n## 目的\n把结论转成可审批草案。",
    resources: [], status: "DRAFT",
    capability: "prescription", sideEffect: "WRITE", approvalGate: "human", provenancePolicy: "required",
    maxBudgetRounds: 6,
    inputSchema: {
      type: "object",
      required: ["modelId"],
      properties: {
        modelId: { type: "string", description: "型号键" },
        baseId: { type: "string", description: "基地键（缺省=全网）" },
      },
    },
    outputSchema: { type: "object", properties: { actions: { type: "array" }, rationale: { type: "string" } } },
    references: [{ kind: "solver", key: "capacity_forecast", role: "precondition", required: true }],
    dependsOn: [{ kind: "skill", key: "capacity_analysis", role: "precondition", required: true }],
  },
  {
    // 空引用对照样本（≙ seed `skl_seed_mcp_guide` 的 `references: []`）：该技能不绑任何业务资产，
    // 界面**不得**为它渲染「引用与依赖」块，更不得填「暂无数据」这类假值。
    id: "skl-mcp-guide", tenantId: TENANT_ID, key: "mcp_integration", version: 1, name: "MCP 集成指南",
    summary: "指导 MCP 服务器接入、命名规范与故障恢复。", body: "# MCP 集成\n\n## 目的\n指导接入。",
    resources: [], status: "PUBLISHED",
    capability: "analysis", sideEffect: "READ", provenancePolicy: "best_effort", approvalGate: "none",
    inputSchema: {
      type: "object",
      properties: {
        serverName: { type: "string" },
        transport: { type: "string", enum: ["streamable_http", "stdio"] },
      },
    },
    references: [],
  },
];

export const MCP_CONFIGS: McpServerConfig[] = [
  { id: "mcp-demo", tenantId: TENANT_ID, name: "示例 MCP 服务器", transport: { type: "streamable_http", url: "https://mcp.example.com" }, credentialRef: "cred-1", status: "ACTIVE" },
];

/** 运营态出厂配置增量 §2/§4.4：每场景预载历史问答（事实源 = contracts LIVED_IN_SCENE_HISTORY，与 A 侧 taskHistory 同一常量） */
const sceneHistory = (scene: string) => ({ preloadedHistory: LIVED_IN_SCENE_HISTORY[scene] ?? [] });

export const SCENES: SceneEntryConfig[] = [
  { id: "scn-dash", tenantId: TENANT_ID, viewKey: "dash", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问问经营数据，如：2026-07 常州基地 4680-NCM 计划达成率怎么样？", suggestedQuestions: ["常州基地 4680-NCM 未来六周加 20% 能不能接？", "2026-07 常州基地 4680-NCM 计划达成率怎么样？"] }, ...sceneHistory("dash") },
  { id: "scn-risk", tenantId: TENANT_ID, viewKey: "risk", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "针对选中基地提问，如：影响哪些订单？", suggestedQuestions: ["影响哪些订单？", "为什么这天越线", "采纳常州的三班制方案"] }, ...sceneHistory("risk") },
  { id: "scn-order", tenantId: TENANT_ID, viewKey: "order", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "查订单，如：影响哪些订单？", suggestedQuestions: ["影响哪些订单？"] } },
  { id: "scn-graph", tenantId: TENANT_ID, viewKey: "graph", mode: "AGENT_FIRST", defaultAgentId: "agt-explore", uiHints: { placeholder: "围绕本体随便问", suggestedQuestions: [] }, ...sceneHistory("graph") },
  { id: "scn-plan-audit", tenantId: TENANT_ID, viewKey: "plan-audit", mode: "WORKFLOW_ONLY", uiHints: { placeholder: "问体检结论，如：我的计划站得住吗？", suggestedQuestions: ["我的计划站得住吗？", "最大的硬矛盾是什么？"] }, ...sceneHistory("plan-audit") },
  { id: "scn-plan-generate", tenantId: TENANT_ID, viewKey: "plan-generate", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问方案取舍，如：推荐哪个方案？为什么？", suggestedQuestions: ["推荐哪个方案？为什么？", "三个方案最大的差异是什么？"] }, ...sceneHistory("plan-generate") },
  { id: "scn-project-sim", tenantId: TENANT_ID, viewKey: "project-sim", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "针对选中订单/型号提问，如：能按期交付吗？", suggestedQuestions: ["能按期交付吗？", "主瓶颈在哪？"] }, ...sceneHistory("project-sim") },
  { id: "scn-sop-balance", tenantId: TENANT_ID, viewKey: "sop-balance", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问月度平衡，如：本月产销缺口多大？", suggestedQuestions: ["本月产销缺口多大？"] } },
  // 运营态增量 §2：运营复盘入口（只读历史）
  { id: "scn-review", tenantId: TENANT_ID, viewKey: "review", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "回顾一年运营，如：到货危机当时是怎么闭环的？", suggestedQuestions: ["到货危机当时是怎么闭环的？", "S&OP 达成率趋势如何？"] }, ...sceneHistory("review") },
];

// 场景启动器 P2/P3：Scenario 一等对象（场景为主键；每个用 workflow/agent 的场景完整可配）。
const scenario = (
  scenarioKey: string, name: string, targetView: string, intentKey: string, triggerQuestion: string,
  mode: Scenario["mode"], presetContext: Scenario["presetContext"], extra: Partial<Scenario> = {},
): Scenario => ({
  id: `scn-${scenarioKey}`, tenantId: TENANT_ID, scenarioKey, name, domain: extra.domain, targetView, intentKey,
  triggerQuestion, solver: extra.solver, rules: extra.rules ?? [], riskLevel: extra.riskLevel ?? "COMPUTE",
  summary: extra.summary ?? "", mode, defaultAgentId: extra.defaultAgentId,
  presetContext, status: extra.status ?? "PUBLISHED", version: 1, updatedAt: "2026-06-15T00:00:00Z",
});

export const SCENARIOS: Scenario[] = [
  scenario("S01", "订单可承接性评审", "project", "capacity_feasibility", "4680-NCM 加 20% 六周能不能接？", "WORKFLOW_FIRST",
    { targetView: "project", selectedObjects: [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }], slotPresets: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 } },
    { domain: "产能与项目", solver: "capacity_forecast", rules: ["C01", "C02", "C03", "C09"], summary: "解读产能可承接结论的口径" }),
  scenario("S02", "交期风险与受影响订单", "risk", "affected_orders", "常州基地影响哪些订单？", "WORKFLOW_FIRST",
    // DF.1：场景预设的基地引用同样查册派生（objectId/label/slotPresets.baseId 三处曾各写死一遍）。
    { targetView: "risk", selectedObjects: [{ objectType: "Base", objectId: baseRef("常州").baseId, label: baseRef("常州").base }], slotPresets: { baseId: baseRef("常州").baseId } },
    { domain: "风险与齐套", solver: "affected_orders", rules: ["C05"], summary: "解读交期风险扫描结果" }),
  scenario("S04", "月度规划体检", "audit", "plan_audit_q", "现金垫 45 亿过得了体检吗？", "WORKFLOW_ONLY",
    { targetView: "audit", selectedObjects: [], slotPresets: { cashCushion: 4_500_000_000 } },
    { domain: "规划与平衡", solver: "plan_audit", rules: ["C15", "C18", "C21"], summary: "解读规划体检结论" }),
  scenario("S06", "处置方案采纳", "risk", "adopt_mitigation", "采纳常州的三班制方案", "WORKFLOW_FIRST",
    { targetView: "risk", selectedObjects: [{ objectType: "Base", objectId: baseRef("常州").baseId, label: baseRef("常州").base }], slotPresets: { baseName: baseRef("常州").base, solutionName: "三班制" } },
    { domain: "风险与齐套", solver: "mitigation_select", rules: ["C08", "C10"], riskLevel: "ACTION_DRAFT", summary: "协助采纳风险处置方案" }),
  scenario("S08", "物料齐套分析", "risk", "kit_analysis", "下周哪些订单缺料开不了工？", "WORKFLOW_FIRST",
    { targetView: "risk", selectedObjects: [], slotPresets: { fromDay: 1, toDay: 14 } },
    { domain: "风险与齐套", solver: "kit_readiness", rules: ["C06", "C16"], summary: "解读齐套分析" }),
  scenario("SX-explore", "本体自由探索", "graph", "graph_explore", "围绕本体随便问", "AGENT_FIRST",
    { targetView: "graph", selectedObjects: [], slotPresets: {} },
    { domain: "经营与财务", defaultAgentId: "agt-explore", summary: "探索型场景（路径B agent 主导）" }),
];

export const FALLBACK_CLUSTERS: FallbackClusterVM[] = [
  { traceId: "fbt-1", querySample: "对比一下储能基地和动力基地的平均利用率", count: 17, lastSeen: now, outcomeBreakdown: { ANSWERED: 14, FAILED: 3 }, topToolSketch: ["query_objects", "query_objects"], trend: [1, 2, 2, 4, 3, 5] },
  { traceId: "fbt-2", querySample: "哪个客户的订单延期风险最高", count: 9, lastSeen: now, outcomeBreakdown: { ANSWERED: 8, BUDGET_EXHAUSTED: 1 }, topToolSketch: ["query_objects", "invoke_solver"], trend: [0, 1, 1, 2, 2, 3] },
];

export const ACTION_DRAFTS: ActionDraft[] = [
  {
    id: "act-001", tenantId: TENANT_ID, actionTypeKey: "shift_plan_change",
    payload: { base: "常州", solution: "三班制", effectiveFrom: "2026-06-15", expectedRelief: 0.12 },
    origin: { taskId: "task-adopt-demo", userId: "usr-planner" },
    status: "PENDING_APPROVAL",
    approvalSteps: [{ seq: 1, role: "planner" }, { seq: 2, role: "admin" }],
    createdAt: "2026-06-10T08:00:00Z", updatedAt: "2026-06-10T08:00:00Z",
  },
  {
    id: "act-002", tenantId: TENANT_ID, actionTypeKey: "outsource_transfer",
    payload: { base: "江门", ratio: 0.15 },
    origin: { userId: "usr-planner" },
    status: "APPROVED",
    approvalSteps: [{ seq: 1, role: "planner", approverId: "usr-planner", decision: "APPROVE", comment: "同意", decidedAt: now }],
    createdAt: "2026-06-08T08:00:00Z", updatedAt: "2026-06-09T08:00:00Z",
  },
  /**
   * WO-BEFE-B · **DRAFT 态**草稿（此前 mock 里一条都没有，于是这个缺口在前端测不出来）。
   * 来源与真后端一致：`decisions/:id/commit`（`apps/datacore/src/decision/kernel.ts:175`）
   * 显式以 `submit: false` 建单 ⇒ 落地即 DRAFT，**不在**审批链上。
   * 而前端 `DecisionPlayView.tsx:630` 真在走这条 commit 路 ⇒ 这类草稿在生产里真会出现。
   * 没有「提交审批」入口时它们推不动，且 ActionsPage 的状态筛选里连 DRAFT 都没有 ⇒ 连列都列不出来。
   */
  {
    id: "act-003", tenantId: TENANT_ID, actionTypeKey: "adopt_mitigation",
    payload: { base: "常州", planKey: "mitigation-a", effectiveFrom: "2026-06-20" },
    origin: { userId: "usr-planner" },
    status: "DRAFT",
    approvalSteps: [{ seq: 1, role: "planner" }],
    createdAt: "2026-06-11T08:00:00Z", updatedAt: "2026-06-11T08:00:00Z",
  },
];

/**
 * WO-BEFE-B · Action 审批留痕事件（`GET /a/v1/action-drafts/:id/audit` 的 `events` 段）。
 *
 * 真后端从 outbox 里筛 `action.*` 且 `payload.draftId === id`（`actions.ts:824`）。
 * mock 侧同样**由真实变更追加**（见 handlers 里 decision / cancel 两处 `pushActionEvent`），
 * 不是摆一份静态好看的清单 —— 摆静态的话，审批面就算根本没打后端也照样显示留痕，
 * 那正是本仓「绿测试≠能用」要堵的形态。种子这两条对应上面两份草稿的既有状态。
 */
export const ACTION_EVENTS: { event: string; payload: Record<string, unknown>; at: string; status?: string }[] = [
  { event: "action.pending_approval", payload: { draftId: "act-001", actionTypeKey: "shift_plan_change", step: 1, role: "planner" }, at: "2026-06-10T08:00:00Z", status: "SENT" },
  { event: "action.approved", payload: { draftId: "act-002", actionTypeKey: "outsource_transfer" }, at: "2026-06-09T08:00:00Z", status: "SENT" },
];

/** WO-BEFE-B · S3 调度任务（后端 `scheduler.ts` · `domain.ts:786`）。 */
export const SCHEDULED_JOBS: ScheduledJobVM[] = [
  { id: "sjob-forecast-w", tenantId: TENANT_ID, kind: "FORECAST", refId: "model-arima-1", cron: "0 2 * * 1", timezone: "Asia/Shanghai", nextRunAt: "2026-06-15T18:00:00Z", lastRunAt: "2026-06-08T18:00:00Z", status: "ACTIVE" },
  { id: "sjob-sop-open", tenantId: TENANT_ID, kind: "SOP_CYCLE", refId: "sop-monthly", cron: "0 1 25 * *", timezone: "Asia/Shanghai", nextRunAt: "2026-06-24T17:00:00Z", status: "ACTIVE" },
  // 带 lastError 的一条：诚实位——错误必须在屏上看得见，不许被"已暂停"三个字盖掉。
  { id: "sjob-remind", tenantId: TENANT_ID, kind: "APPROVAL_REMINDER", refId: "reminder-default", cron: "0 0 * * *", timezone: "Asia/Shanghai", nextRunAt: "2026-06-13T16:00:00Z", lastRunAt: "2026-06-12T16:00:00Z", status: "PAUSED", lastError: "上一轮 3 条催办未送达（通知通道 503）" },
];

/** WO-BEFE-B · 调度运行历史（`GET /a/v1/scheduler/jobs/:id/runs`）。 */
export const SCHEDULER_RUNS: SchedulerRunVM[] = [
  { id: "sjob-forecast-w@2026-06-08T18:00:00Z", tenantId: TENANT_ID, jobId: "sjob-forecast-w", scheduledAt: "2026-06-08T18:00:00Z", startedAt: "2026-06-08T18:00:01Z", finishedAt: "2026-06-08T18:02:11Z", status: "SUCCEEDED" },
  { id: "sjob-forecast-w@2026-06-01T18:00:00Z", tenantId: TENANT_ID, jobId: "sjob-forecast-w", scheduledAt: "2026-06-01T18:00:00Z", startedAt: "2026-06-01T18:00:01Z", finishedAt: "2026-06-01T18:00:09Z", status: "FAILED", error: "模型 model-arima-1 输入窗口不足 8 周" },
  { id: "sjob-remind@2026-06-12T16:00:00Z", tenantId: TENANT_ID, jobId: "sjob-remind", scheduledAt: "2026-06-12T16:00:00Z", startedAt: "2026-06-12T16:00:00Z", finishedAt: "2026-06-12T16:00:03Z", status: "FAILED", error: "通知通道 503" },
];

/** WO-BEFE-B · OC9 工厂日历（契约 `FactoryCalendarSchema`）。 */
export const FACTORY_CALENDARS: FactoryCalendar[] = [
  {
    id: `cal_${TENANT_ID}_default`, tenantId: TENANT_ID, calendarKey: "default", weekendMode: "SAT_SUN_OFF",
    exceptions: [
      { date: "2026-06-25", kind: "HOLIDAY", label: "端午" },
      { date: "2026-06-27", kind: "EXTRA_WORKDAY", label: "调休补班" },
      { date: "2026-07-06", kind: "MAINTENANCE", label: "年度检修" },
    ],
    updatedAt: "2026-06-01T00:00:00Z",
  },
];

/**
 * WO-BEFE-B · 虚拟操作团队（回放编排器 §1）。
 * ⚠️ 真后端只在 SYNTHETIC 租户返回非空（`opsteam/team.ts:30`）；mock 直接给内容，
 * 但页面上必须把「这是 SYNTHETIC 租户才有的东西」这句话显出来（隔离语义不能只活在后端）。
 */
export const OPS_PERSONAS: VirtualPersona[] = [
  { username: "vp_planner_zhang", roles: ["planner"], attributes: {}, isVirtual: true, styleSeed: 11, displayName: "张（虚拟计划员）" },
  { username: "vp_approver_li", roles: ["admin"], attributes: {}, isVirtual: true, styleSeed: 22, displayName: "李（虚拟审批人）" },
  { username: "vp_sop_host", roles: ["planner"], attributes: {}, isVirtual: true, styleSeed: 33, displayName: "王（虚拟 S&OP 主持）" },
];

/** WO-BEFE-B · 剧本（回放编排器 §2）。 */
export const OPS_PLAYBOOK: OpsPlaybook = {
  key: "default-ops",
  version: 3,
  cadence: {
    daily: [
      { kind: "ask", persona: "vp_planner_zhang", view: "cockpit", queryPool: "daily_ops", prob: 0.6 },
      { kind: "review_actions", persona: "vp_approver_li", policy: { approve: 0.82, reject: 0.11, cancel: 0.04 }, commentPool: "approval_comments" },
    ],
    monthly: [{ kind: "sop_cycle", persona: "vp_sop_host" }],
  },
};

/** WO-BEFE-B · 回放 tick 报告（回放编排器 §3）。 */
export const OPS_TICK_REPORTS: OpsTickReport[] = [
  {
    tick: 1, date: "2026-06-11",
    executed: [
      { kind: "ask", persona: "vp_planner_zhang", ref: "task-vp-001" },
      { kind: "review_actions", persona: "vp_approver_li", ref: "act-002", decision: "APPROVE" },
    ],
    skipped: [{ kind: "sop_cycle", persona: "vp_sop_host", reason: "非月度节点" }],
  },
  {
    tick: 2, date: "2026-06-12",
    executed: [{ kind: "ask", persona: "vp_planner_zhang", ref: "task-vp-002" }],
    skipped: [{ kind: "review_actions", persona: "vp_approver_li", reason: "无待审批草稿" }],
  },
];

/** WO-BEFE-B · 文本池快照（`GET /a/v1/ops/pools`，后端 `poolSnapshot()`）。 */
export const OPS_POOLS: Record<string, unknown> = {
  daily_ops: { size: 40, consumed: 12 },
  approval_comments: { size: 24, consumed: 7 },
  sop_resolutions: { size: 16, consumed: 3 },
};

// ---------------------------------------------------------------------------
// 合成数据 / 模拟时钟
// ---------------------------------------------------------------------------

export const SYNTHETIC_PHASES = ["行业模板", "本体实例化", "源对象生成", "历史时序生成（90 天）", "派生计算", "配套生成与校验"];

export const SYNTHETIC_REPORT = {
  rowCounts: { Base: 13, Model: 6, Order: 24, Workshop: 130, Line: 130, Process: 650, Equipment: 780, ProductPlatform: 3, ProductSeries: 6, ProductVersion: 18, BOMHeader: 18, BOMDetail: 250, Material: 8, Supplier: 14, MaterialAlternative: 5, Routing: 18, Operation: 180, ProcessCapabilityWindow: 50, QualityStandard: 40, InspectionCharacteristic: 100, ProductLineCapability: 40, ProductEquipmentCapability: 250, EngineeringChange: 12, MaintPlan: 36, Segment: 6, Shipment: 24, DataSourceHealth: 12, DemandSegment: 6, FinancePlan: 12, MaterialBalance: 8, Metric: 12, KSF: 8, Principal: 10, RootCauseChain: 6, SopVersionRow: 5, Customer: 8, ARInvoice: 16, MaterialBatch: 24, PurchaseOrder: 12, CarbonFactor: 6, EnergyMeter: 24, ChangeoverMatrix: 6, CapexProject: 4, FinanceAccount: 12, FinanceMetric: 3, ExternalSignal: 5 },
  ruleScan: [
    { ruleKey: "C03", evaluated: 20, violations: 1 },
    { ruleKey: "C08", evaluated: 36, violations: 0 },
    { ruleKey: "C13", evaluated: 20, violations: 0 },
  ],
  derivationSpotChecks: [
    { typeKey: "CapacityPyramid", propKey: "capWanP90", objectId: "cap-1", ok: true },
    { typeKey: "Line", propKey: "schedule_attainment", objectId: "line-9", ok: true },
  ],
  timeseries: [
    { seriesKey: "oee:equip", points: 84213, gaps: 0, aggSpotCheckOk: true },
    { seriesKey: "yield:proc", points: 12960, gaps: 2, aggSpotCheckOk: true },
  ],
};

export const SIM_SCRIPT = [
  { tick: 3, event: "iot_delay" },
  { tick: 5, event: "shipment_delay" },
  { tick: 8, event: "yield_drop" },
];

export function initialClock(): SimClockVM {
  return {
    simDate: "2026-06-12",
    currentTick: 0,
    status: "ACTIVE",
    script: SIM_SCRIPT.map((s) => ({ ...s, fired: false })),
  };
}

export function tickReport(tick: number, simDate: string): TickReportVM {
  return {
    tick,
    simDate,
    newPoints: 1280 + tick * 37,
    changedProps: [
      { object: "设备-CZ-07", prop: "oee_current", from: 0.86, to: 0.84 },
      { object: "产线-CZ-2", prop: "schedule_attainment", from: 0.914, to: 0.908 },
      { object: "工序-化成", prop: "yield_baseline", from: 0.975, to: 0.973 },
    ],
    newAlerts: tick === 8 ? [{ ruleKey: "C05", message: "常州产线利用率连续 3 日 >95%" }] : [],
    clearedAlerts: [],
    forecastDeviation: tick >= 3 ? 0.02 + tick * 0.008 : undefined,
  };
}

// ---------------------------------------------------------------------------
// 演示回答（A1/A2/B1 + unverifiedNumerics 样例）
// ---------------------------------------------------------------------------

export const ANSWER_A1: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "text", markdown: "常州基地风险窗口内共 **3 张订单**受影响⟦ref:prov-a1-1⟧，合计 4,820 套⟦ref:prov-a1-1⟧。" },
    {
      type: "table",
      columns: ["SO", "客户", "型号", "数量", "交期"],
      rows: [
        ["SO-10001", "蔚途汽车", "4680-NCM", 1500, "2026-06-20"],
        ["SO-10006", "星河储能", "储能-280Ah", 1820, "2026-06-24"],
        ["SO-10013", "蔚途汽车", "4680-NCM", 1500, "2026-07-02"],
      ],
      provId: "prov-a1-1",
    },
  ],
  provenance: [
    {
      id: "prov-a1-1", source: "TOOL_RESULT", toolCallId: "tc-a1-1", toolName: "invoke_solver:affected_orders",
      outputPath: "$.orders", snapshotVersion: "ov-12",
      ...({ stepId: "s2", formula: "affected_orders(base=常州, window=D+0..D+14)", rules: [{ key: "C03", expression: "Order.demandDelta <= 0.5" }], value: "3 单 / 4,820 套", valueLabel: "受影响订单" } as Record<string, unknown>),
    } as Answer["provenance"][number],
  ],
};

export const ANSWER_A2: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "kpi", label: "P50 产能", value: "21.4", unit: "GWh", provId: "prov-a2-1" },
    { type: "kpi", label: "P90 产能", value: "18.9", unit: "GWh", provId: "prov-a2-2" },
    { type: "kpi", label: "缺口", value: "-1.2", unit: "GWh", provId: "prov-a2-3" },
    // redline-allow：20% 是需求增幅（承接问句的回答），非红线阈值。
    { type: "text", markdown: "加 20% 后六周内 P90 口径存在 **1.2 GWh** 缺口⟦ref:prov-a2-3⟧，主要瓶颈为化成柜⟦ref:prov-a2-1⟧。建议评估外协或排程平移。" },
  ],
  provenance: [
    { id: "prov-a2-1", source: "TOOL_RESULT", toolCallId: "tc-a2-1", toolName: "invoke_solver:capacity_forecast", outputPath: "$.capWanP50", snapshotVersion: "ov-12", ...({ stepId: "s2", formula: "capacity_forecast(model=4680-NCM, delta=0.2, weeks=6)", value: "21.4 GWh", valueLabel: "P50 产能" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-a2-2", source: "TS_AGGREGATE", toolCallId: "tc-a2-1", toolName: "query_timeseries_agg", outputPath: "$.capWanP90", snapshotVersion: "ov-12", tsAgg: { aggRunId: "aggrun-889", specKey: "oee_daily@v2", window: { start: "2026-06-01", end: "2026-06-07" }, rowsIn: 84213 }, ...({ value: "18.9 GWh", valueLabel: "P90 产能（OEE 加权）" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-a2-3", source: "TOOL_RESULT", toolCallId: "tc-a2-2", toolName: "invoke_solver:capacity_forecast", outputPath: "$.gap", snapshotVersion: "ov-12", ...({ stepId: "s3", formula: "gap = demand - capWanP90", rules: [{ key: "C03", expression: "Order.demandDelta <= 0.5" }], value: "-1.2 GWh", valueLabel: "产能缺口" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const ANSWER_B1: Answer = {
  trustLevel: "AGENT_EXPLORATORY",
  unverifiedNumerics: false,
  blocks: [
    { type: "text", markdown: "储能基地平均利用率 **71.5%**⟦ref:prov-b1-1⟧，动力基地平均 **84.2%**⟦ref:prov-b1-2⟧，相差 12.7 个百分点⟦ref:prov-b1-2⟧。" },
    { type: "kpi", label: "储能基地均值", value: "71.5", unit: "%", provId: "prov-b1-1" },
    { type: "kpi", label: "动力基地均值", value: "84.2", unit: "%", provId: "prov-b1-2" },
  ],
  provenance: [
    { id: "prov-b1-1", source: "TOOL_RESULT", toolCallId: "tc-b1-1", toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12", ...({ value: "71.5%", valueLabel: "储能基地平均利用率" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-b1-2", source: "TOOL_RESULT", toolCallId: "tc-b1-2", toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12", ...({ value: "84.2%", valueLabel: "动力基地平均利用率" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

/** unverifiedNumerics 警示样例 */
export const ANSWER_UNVERIFIED: Answer = {
  trustLevel: "AGENT_EXPLORATORY",
  unverifiedNumerics: true,
  blocks: [
    { type: "text", markdown: "按当前爬坡速度估算，印尼基地约需 5 个月达到 80% 稼动率（行业经验值，未能从工具数据中溯源）。已核实当前稼动率为 **58%**⟦ref:prov-uv-1⟧。" },
  ],
  provenance: [
    { id: "prov-uv-1", source: "TOOL_RESULT", toolCallId: "tc-uv-1", toolName: "query_objects", outputPath: "$.util", snapshotVersion: "ov-12", ...({ value: "58%", valueLabel: "印尼基地稼动率" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const ANSWER_ADOPT: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "rule_violation", ruleId: OUTSOURCE_REDLINE.ruleKey, severity: "WARN", explanation: `三班制将提高外协依赖至 18%，接近 ${outsourceRedlinePct()}% 红线，需关注。`, provId: "prov-ad-1" }, // DF.13 红线数派生
    { type: "action_draft", draftId: "act-001", actionType: "shift_plan_change", summary: "常州基地 6/15 起切换三班制，预计释放 12% 张力" },
    { type: "text", markdown: "已生成 Action 草稿并进入审批流，**未直接执行**任何变更。" },
  ],
  provenance: [
    // WO-RULE-EXPR-PARAMS：这是 `evaluate_rules` 的**规则引擎求值留痕**，必须显违规谓词式（与已发布 C08 一字不差）；
    // 此前显的是文档约束式，等于给用户看了一条极性相反、且主体也不同的表达式。
    { id: "prov-ad-1", source: "TOOL_RESULT", toolCallId: "tc-ad-1", toolName: "evaluate_rules", outputPath: "$.verdicts[0]", snapshotVersion: "ov-12", ...({ stepId: "s1", rules: [{ key: "C08", expression: outsourceRedlineViolationExprPublished() }], value: "WARN", valueLabel: "规则评估" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const TS_AGG_POINTS = Array.from({ length: 14 }, (_, i) => ({
  entityId: "equip-cz-07",
  bucket: `2026-05-${String(25 + i).padStart(2, "0")}`,
  value: 0.82 + Math.sin(i * 0.8) * 0.05 + i * 0.002,
})).map((p, i) => ({ ...p, bucket: i < 7 ? `2026-06-0${i + 1}` : `2026-06-${String(i + 1).padStart(2, "0")}` }));

// ---------------------------------------------------------------------------
// 管理平台增量：租户 / 用户 / 视图配置 / 角色清单（MSW 种子）
// ---------------------------------------------------------------------------

export const ADMIN_TENANTS: AdminTenant[] = [
  { id: TENANT_ID, key: TENANT_ID, name: "星辰电池制造", industry: "battery-manufacturing", status: "ACTIVE", createdAt: "2026-01-05T08:00:00Z" },
];

export const ADMIN_USERS: AdminUser[] = [
  {
    id: "usr-planner", tenantId: TENANT_ID, username: "planner", email: "planner@battery.io", displayName: "规划员",
    roles: ["planner", "admin", "catalog_admin", "tenant_admin"], attributes: {}, status: "ACTIVE", lastLoginAt: "2026-06-11T09:00:00Z",
  },
  {
    id: "usr-cz", tenantId: TENANT_ID, username: "base_manager", email: "cz@battery.io", displayName: "常州基地长",
    roles: ["base_manager:常州"], attributes: { baseScope: ["常州"] }, status: "ACTIVE",
  },
  {
    id: "usr-viewer", tenantId: TENANT_ID, username: "viewer1", email: "viewer1@battery.io", displayName: "观察员",
    roles: ["viewer"], attributes: {}, status: "DISABLED",
  },
];

export const ROLES_RESPONSE = {
  builtIn: ["platform_admin", "tenant_admin", "catalog_admin", "approver", "planner", "viewer"],
  parameterized: { convention: "role:param（如 base_manager:常州）", examples: ["base_manager:常州"] },
  inUse: ["planner", "admin", "catalog_admin", "tenant_admin", "base_manager:常州", "viewer"],
};

export const ADMIN_VIEWS: AdminViewConfig[] = [
  {
    viewKey: "dash", title: "经营驾驶舱", renderer: "dashboard",
    layout: { widgets: [{ key: "gwh", type: "kpi", title: "总产能 (GWh)" }, { key: "orders", type: "kpi", title: "在手订单" }] },
    options: {}, nav: { group: "business", order: 0 }, roles: ["planner", "admin"], featureKey: "view.dash", featureOn: true,
  },
  {
    viewKey: "graph", title: "本体图谱", renderer: "ontology-graph",
    layout: {}, options: { graphOptions: { colorBy: "domain" } },
    nav: { group: "business", order: 1 }, roles: ["planner"], featureKey: "view.ontology-graph", featureOn: true,
  },
  {
    viewKey: "order", title: "订单台账", renderer: "ledger",
    layout: { objectType: "Order" }, options: {},
    nav: { group: "business", order: 2 }, roles: ["planner", "base_manager"], featureKey: "view.ledger", featureOn: false,
  },
];


// ---------------------------------------------------------------------------
// LLM Provider 配置体系增量 §1（契约形态：LlmProvider / PurposeBinding）
// ---------------------------------------------------------------------------

export const LLM_PROVIDERS = [
  {
    id: "llmp-anthropic",
    tenantId: TENANT_ID,
    name: "Anthropic 官方",
    kind: "anthropic" as const,
    models: [
      { modelId: "claude-opus-4-8", displayName: "Opus 4.8", capabilities: { tools: true, structuredOutput: true, maxContext: 200000 } },
      { modelId: "claude-haiku-4-5", displayName: "Haiku 4.5", capabilities: { tools: true, structuredOutput: true, maxContext: 200000 } },
    ],
    status: "ACTIVE" as const,
    hasApiKey: true,
    usage7dTokens: 1284530,
  },
  {
    id: "llmp-vllm-qwen",
    tenantId: TENANT_ID,
    name: "本地 vLLM-Qwen",
    kind: "openai_compatible" as const,
    baseUrl: "http://vllm.internal:8000/v1",
    models: [
      { modelId: "qwen3-72b", displayName: "Qwen3 72B", capabilities: { tools: false, structuredOutput: false, maxContext: 131072 } },
    ],
    status: "ACTIVE" as const,
    fallbackProviderId: "llmp-anthropic",
    hasApiKey: false,
    usage7dTokens: 90210,
  },
];

export const LLM_BINDINGS = [
  { purpose: "classifier" as const, providerId: "llmp-anthropic", modelId: "claude-haiku-4-5" },
  { purpose: "agent" as const, providerId: "llmp-anthropic", modelId: "claude-opus-4-8" },
];

// WO-A · PlanBuilder fixtures 复用（避免 handlers/db 直接依赖新文件）。
export { PLAN_BUILDER_FIXTURES, newPlanBuilderCanvas } from "./planBuilderFixtures";
