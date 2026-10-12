#!/usr/bin/env node
/**
 * 一次性：为遗留 PRD 补录《本体引用与影响》§0（TODO #2 余项）。
 * 仅引用真实存在的不变量 R1–R14 / 断点 G-1..G-8（避免 prd:check 悬空引用）。
 * 幂等：已含"本体引用"段的文件跳过。插入位置=第一个 "## " 标题之前。
 */
import { readFileSync, writeFileSync } from "node:fs";

/** PRD → { r:[不变量], g:[断点], note } —— 按各 PRD 域人工策展（保守、仅平台 R/G）。 */
const MAP = {
  "PRD-addendum-a8-timeseries.md": { r: ["R6", "R2"], g: [], note: "A8 时序数据层：Raw 时序→聚合派生→结论数据（确定性、tenant 隔离）" },
  "PRD-addendum-admin-console-closure.md": { r: ["R1", "R3"], g: ["G-4"], note: "管理面引用闭合 + 执行计划编辑器（自助创建无死路）" },
  "PRD-addendum-admin-platform.md": { r: ["R1", "R3", "R9"], g: [], note: "管理平台补全：Bootstrap/租户用户/资源 CRUD（仓储四处）/视图配置" },
  "PRD-addendum-agent-runtime.md": { r: ["R6", "R10"], g: [], note: "Agent 运行时：上下文/Workflow 执行语义/Skill 资源/MCP 运行时（D7 编排域）" },
  "PRD-addendum-capability-routing.md": { r: ["R6"], g: ["G-7"], note: "能力发现与路由：切片/工具目录 + 等价能力故障转移（用途枚举 G-7）" },
  "PRD-addendum-dataflow-loop-closure.md": { r: ["R10"], g: ["G-6"], note: "数据流闭环与模块联动：上传/产出跨模块流转（D-29 事件、§4 失效图）" },
  "PRD-addendum-execution-semantics.md": { r: ["R10", "R6"], g: [], note: "执行语义统一：互斥/投递/迁移 Saga/回放幂等/降级（at-least-once 排序）" },
  "PRD-addendum-feature-entitlement.md": { r: ["R3"], g: [], note: "功能开通与展示配置：entitlement 先于 authz，功能关=404" },
  "PRD-addendum-lived-in-state.md": { r: ["R6", "R2"], g: [], note: "运营态出厂配置（拎包入住）：确定性回放一年运营态，tenant 隔离" },
  "PRD-addendum-llm-providers-and-references.md": { r: ["R5", "R10"], g: ["G-7"], note: "LLM 多厂商配置 + 统一引用模式变更传播（凭据 no-secrets-echo）" },
  "PRD-addendum-m11-calibration.md": { r: ["R4", "R6"], g: [], note: "M11 校准引擎：偏差→参数建议；批准走 Action 审批（真值经 Action）" },
  "PRD-addendum-ontology-core.md": { r: ["R12", "R1"], g: [], note: "本体服务原子规格：元模型 DDL / 派生 DSL / resolveSlice 切片语法" },
  "PRD-addendum-ontology-governance.md": { r: ["R12", "R4"], g: [], note: "本体治理与检索：域治理（归域会签）/演进稳定性/检索模式全集" },
  "PRD-addendum-operational-completeness.md": { r: ["R6", "R2"], g: [], note: "运营完备性查漏补缺：实体解析/评测/迁移/隔离区等十项" },
  "PRD-addendum-replay-orchestrator.md": { r: ["R6"], g: [], note: "回放编排器与虚拟操作团队：确定性回放（D10 运营时序域）" },
  "PRD-addendum-skill-authoring.md": { r: ["R1"], g: [], note: "Skill 编写规范与质量门禁：技能优秀=可校验属性（lint + 评测用例）" },
  "PRD-addendum-solvers-and-gaps.md": { r: ["R11", "R6"], g: ["G-1", "G-2", "G-8"], note: "求解器真实算法规格 + 四项缺口补全（全链闭包、跨服务形状）" },
  "PRD-addendum-validation-loop.md": { r: ["R11", "R4", "R6"], g: [], note: "闭环验证引擎 VLE：模拟数据进入→整体闭环→工程验证度量化" },
  "PRD-catalog-battery-20-scenarios.md": { r: ["R11", "R3"], g: ["G-1"], note: "锂电 20 场景目录（Skills×Agents×Workflows×Solvers×约束）；场景全链上架" },
  "PRD-frontend-addendum-remaining-views.md": { r: ["R3", "R13", "R14"], g: [], note: "前端剩余视图补全（§7.14–7.22）：渲染分发、结论溯源、无业务常数" },
  "PRD-frontend-addendum-sim-views.md": { r: ["R13", "R14"], g: [], note: "前端推演视图渲染器（§7.10–7.13）：结论可溯源、应用层无业务常数" },
  "PRD-frontend.md": { r: ["R1", "R3", "R13", "R14"], g: [], note: "前端 Workspace Shell + 决策工作台：契约只读引用、entitlement、溯源、去电池" },
  "PRD-implementation-handbook.md": { r: ["R1", "R6", "R9"], g: [], note: "低能力开发代理实施手册：契约共享、确定性、仓储双实现四处同改（流程纲领）" },
  "PRD-maturity-master-plan.md": { r: ["R11", "R12"], g: [], note: "迈向 Foundry+AIP 80% 成熟度总纲路线图（全链闭包 + 双向闭包为里程碑）" },
  "PRD-platform-foundry-aip.md": { r: ["R1", "R2", "R3", "R4", "R5"], g: [], note: "平台总纲（DataCore+AgentCore 双系统）：核心不变量基线（冲突时以本总纲为准）" },
  "PRD-query-orchestration-service.md": { r: ["R3", "R6", "R10"], g: ["G-1", "G-2", "G-3"], note: "QOS 智能查询路由与执行：分类→路径A工作流/路径B Agent→SSE；事件失效" },
  "PRD-traceability-and-baseline-v2.md": { r: ["R6"], g: [], note: "需求追踪矩阵与文档基线 v2（收口）；注：文中 R 编号（15 起）为本 PRD 自有需求编号，非平台不变量" },
  "PRD-traceability-and-baseline.md": { r: ["R6"], g: [], note: "需求追踪矩阵与文档基线（收口）；注：文中 R 编号（15 起）为本 PRD 自有需求编号，非平台不变量" },
};

let done = 0;
let skipped = 0;
for (const [file, m] of Object.entries(MAP)) {
  const path = `docs/${file}`;
  const text = readFileSync(path, "utf8");
  if (/本体引用/.test(text)) { skipped++; continue; }
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => /^##\s/.test(l));
  const at = idx < 0 ? lines.length : idx;
  const block = [
    "## 0. 本体引用与影响（补录）",
    "",
    "> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。",
    "",
    `- **触及不变量**（§5）：${m.r.join(" · ") || "（通用）"}`,
    `- **触及断点**（§8）：${m.g.length ? m.g.join(" · ") : "（无特定断点）"}`,
    `- **范畴**：${m.note}`,
    "",
  ];
  lines.splice(at, 0, ...block);
  writeFileSync(path, lines.join("\n"));
  done++;
}
console.log(`§0 补录：写入 ${done} 篇，跳过 ${skipped} 篇（已含）。`);
