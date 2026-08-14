import type { FeatureDef } from "./features.js";

/**
 * WO-VIEWNAME-SINGLE-SOURCE · **跨服务功能名册（单一真相源）**。
 *
 * ── 病灶（2026-08-14 实测坐实，不是推测）─────────────────────────────────────
 * 同一个功能键的**名字**此前散落在三份手维护的注册表里，谁也不看谁：
 *   ① `apps/agentcore/src/features/registry.ts` FEATURE_REGISTRY[].name
 *   ② `apps/datacore/src/features.ts` FEATURE_REGISTRY[].name
 *      （其 VIEW 段派生自 `synthetic/view-manifest.ts` BUILTIN_VIEWS[].featureName）
 *   ③ `apps/frontend-shell/src/mocks/fixtures.ts` FEATURE_REGISTRY[].name
 * 实测 61 个键被 ≥2 份注册表声明，其中 **8 个键三份各写各的**：
 *   view.dash（经营驾驶舱 / 驾驶舱 / 驾驶舱）· view.risk-board（风险看板 / 风险推演看板 / 推演看板）·
 *   shell.query-dock · qos.agent-fallback · view.project-sim.whatif · admin.plan-builder ·
 *   qos.reasoning-trace · qos.multi-intent-l2-decompose。
 *
 * ── 为什么名字定在 DataCore 那一份（判据是"用户真看到哪一份"，不是"哪个好听"）──
 * 三份里**只有 DataCore 那一份真上屏**：
 *   · 前端「功能开通配置」页 `pages/admin/FeaturesPage.tsx` 渲染 `{def.name}`，
 *     数据来自 `api.a("/a/v1/features/registry")` ⇒ **DataCore** 的 FEATURE_REGISTRY；
 *   · AgentCore 的 `name` **全仓零读取** —— 该模块的消费方只用 key/bindings/requires/defaultOn
 *     （`featureEnabled` / `intentAllowed` / `solverAllowed` / `viewAllowed` / `defaultOnKeys`），
 *     且 AgentCore 从不下发功能册（它自己的头注释就写着"权威解析集来自 DataCore"）；
 *   · 前端 mock 那一份只在 `VITE_MOCK=1` 演示态复述**同一个页面**，职责是"如实复刻生产"。
 * ⇒ 收敛方向唯一：**AgentCore / mock 跟 DataCore**。实测 61 个跨服务键 DataCore **一个不缺**，
 *   它天然就是那份册，不需要另立第四个权威。
 *
 * ⚠ **本册不是"视图标题"**。导航栏与页面标题走的是**另一个命名空间**：
 *   `BUILTIN_VIEWS[].title` → `VIEW_DEFS[k].title` → ViewConfig.title/navigation.label →
 *   `GET /a/v1/me/workspace`。同一个 slug 上「功能名」与「视图标题」各有一份是**正常的**
 *   （`view.dash` 功能名「驾驶舱」/ 视图标题「经营驾驶舱」；`view.risk-board` 功能名
 *   「风险推演看板」/ 视图标题「产能推演」）。把两者揉成一个桶会报出一堆假分叉。
 *
 * ── 收录判据（不许凭感觉加）────────────────────────────────────────────────
 * **一个键只要被 ≥2 份注册表声明，就必须在本册里**；只被一份声明的键（如 DataCore 独有的
 * `view.dash.widget.*`、mock 独有的 `view.graph-*`）**不收** —— 它们不跨边界，没有分叉的可能，
 * 收进来只会让本册变成第二份全量注册表。这条判据由 `assertSharedFeatureNames()`（构造期）
 * 与接缝测试（`apps/frontend-shell/test/feature-name-single-source.seam.test.ts`）两道一起钉死。
 */
export const SHARED_FEATURE_NAMES: Readonly<Record<string, string>> = {
  // ── VIEW 级 · 出厂内置视图（DataCore synthetic/view-manifest.ts BUILTIN_VIEWS）──
  "view.dash": "驾驶舱",
  "view.ontology-graph": "本体图谱",
  "view.risk-board": "风险推演看板",
  "view.ledger": "订单台账",
  "view.plan-audit": "规划体检",
  "view.plan-generate": "规划建议",
  "view.sop-balance": "月度规划",
  "view.project-sim": "项目推演",
  "view.global-sim": "全局项目推演",
  "view.chain-line-map": "全链线路图",
  "view.transit-flow": "在途与在制",
  "view.physical-topology": "物理拓扑",
  "view.node-inspector": "节点检视",
  "view.chain-impediments": "全链阻滞点",
  "view.process-wait": "流程等待态",
  "view.procurement-legs": "采购四段腿分解",
  // ── VIEW 级 · 增量视图（DataCore features.ts 手注册段）──
  "view.annual-scenario": "年度规划",
  "view.quarterly-rolling": "季度规划",
  "view.order-chain": "订单进展与卡因",
  "view.geo-map": "基地地理视图",
  "view.review": "运营复盘",
  "sim.sandbox": "推演沙盘",
  "process.runtime": "流程运行时（实例·卡点）",
  // ── BLOCK 级 · 视图内区块 ──
  "view.task-dag": "任务详情·编排 DAG",
  "view.project-sim.whatif": "What-if 调参",
  "view.risk-board.mitigation": "处置方案区",
  "view.global-sim.live": "全局推演·活系统(NL/方案存比)",
  "view.graph.persp.all": "图谱·全景",
  "view.graph.persp.backbone": "图谱·主干分级",
  "view.graph.persp.flow": "图谱·产能推演网络",
  "view.graph.persp.source": "图谱·数据来源",
  "view.graph.persp.solver": "图谱·求解器",
  "view.graph.persp.mvp": "图谱·MVP",
  "view.graph.persp.agent": "图谱·智能体网络",
  "view.graph.persp.loop": "图谱·学习闭环",
  // ── BLOCK 级 · 外壳与 QOS 路由 ──
  "shell.query-dock": "查询对话坞",
  "qos.agent-fallback": "Agent 兜底（路径 B）",
  "qos.compose-path": "QOS 组合路径（多 solver 服务端编排）",
  "qos.dril-routing": "DRIL 智能资源路由（Path-B 组包注入）",
  "qos.reasoning-trace": "QOS 推理旁白流（path-B agent 思考实时展示）",
  "qos.llm-budget-enforce": "LLM token 配额执行（硬线耗尽拒新任务·暗发）",
  "qos.deterministic-multi-domain": "确定性跨域分路（多域并行 solver·零 LLM）",
  "qos.multi-intent-orchestration": "LLM 多意图兜底（分类器多候选并行 solver·零 LLM 装配）",
  "qos.opt-whatif-route": "结构化优化 what-if 会话路由（NL→optimize_whatif·CP-SAT 重解）",
  "qos.multi-intent-l2-decompose": "QOS L2 真分解（LLM 产 solver 计划·确定性校验·补漏意图）",
  "qos.multi-intent-l3-coupled": "QOS L3 耦合联合求解（一次 portfolio 守恒解·真传导）",
  // ── BLOCK 级 · Agent 能力 ──
  "ceo.free-llm": "CEO 深问真 LLM 自由推理",
  "agent.coordinator": "跨域多角色 Coordinator 编排",
  "agent.critic": "Agent 反思 LLM critic（确定性复盘之上的 advisory 复核·fail-open）",
  "agent.escalation": "Agent 停滞升级阶梯（换策略再试→诚实降级·暗发）",
  "agent.skill-on-free-qa": "自由问答挂载租户技能（默认 path-B 可见并 load_skill·暗发）",
  // ── BLOCK 级 · 优化 / 决策 / 组织 / 管理台 ──
  "opt.solver-pool": "优化模板池",
  "opt.whatif": "优化 what-if",
  "opt.multiobj": "多目标 + 跨对象占用",
  "decision.causal-graph": "决策因果图",
  "org.world": "组织世界（人/角色/部门/职权/审批额度/代理）",
  "admin.plan-builder": "计划构建器",
  // ── ACTION 级 ──
  "act.aop-finalize": "AOP 情景拍板",
  "act.adopt-to-draft": "采纳为草稿",
  "act.export": "导出",
  "act.plan-audit.apply-fix": "体检一键修正",
};

/** 册里有就返回名字；没有返回 `undefined`（**不抛**：只被一份注册表声明的本地键是合法的）。 */
export function sharedFeatureName(key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SHARED_FEATURE_NAMES, key) ? SHARED_FEATURE_NAMES[key] : undefined;
}

/**
 * **构造期钉死**：注册表在模块加载时自查，任一条目的 `name` 与本册不符 ⇒ **当场抛**。
 *
 * 为什么是"抛"而不是"静默用册里的值覆盖"：覆盖会造出本仓最难查的那种假绿 ——
 * 源码里那行字面量写着 A、运行时却是 B，下一个人改了字面量却什么都没发生。
 * 抛则**机器先说话**（服务启动 / 任一测试导入注册表的瞬间就红），且错误里点名是哪个键、
 * 哪两个值、该改哪边。字面量**保留**（不改成 `sharedFeatureName(...)` 调用）也是有意的：
 * 一份 300 行的功能册，名字必须在声明处看得见；本函数保证它只能是册里那一个。
 *
 * 只校验**册里有的键**；册外的键原样放行（那是单一注册表的本地键，天然不会分叉）。
 */
export function assertSharedFeatureNames<T extends Pick<FeatureDef, "key" | "name">>(defs: T[], where: string): T[] {
  const bad: string[] = [];
  for (const d of defs) {
    const canonical = sharedFeatureName(d.key);
    if (canonical !== undefined && canonical !== d.name) {
      bad.push(`  · ${d.key}: 本地写「${d.name}」，跨服务册写「${canonical}」`);
    }
  }
  if (bad.length > 0) {
    throw new Error(
      `[${where}] 功能名与跨服务册不符 ${bad.length} 条 —— 同一个功能键在两份注册表里两个名字，` +
        `用户在「功能开通配置」页看到的和这里写的不是一回事：\n${bad.join("\n")}\n` +
        `修法：名字的单一真相源是 packages/contracts/src/feature-names.ts 的 SHARED_FEATURE_NAMES。` +
        `要改名就改那里（三份注册表一起变）；要在本地另起一个名字 —— 不允许。`,
    );
  }
  return defs;
}
