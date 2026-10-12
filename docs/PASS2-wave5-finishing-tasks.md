# PASS2-WAVE5 · 收尾任务清单（QOS + 前端 · Pass-2 收官）

> Pass-2 最后一波：QOS 查询编排（65-75%）+ 前端（85%）。**整张 COMPLETION-LEDGER §1 至此 Pass-2 全部完成。** 同前纪律：已建只接不重写；先 FDE 真跑；完成=亲手跑+证据；只 push `claude/vigilant-knuth-b1nmxn`、push 前 rebase。

---

## 1. 🔴 QOS（65-75% · 高风险✅ 坐实 · 优先）

> **诊断**：骨架全真（路由决策双阈 0.85/0.55、4 意图、路径A执行+render_answer、路径B Agent循环+final_answer、SSE 8 事件、数字溯源 scanBlocks）。**但 G-1/G-2 "已修" 是虚判**——只 4/20 卡真跑，16 卡种子模板脆弱、求解器形状接缝无真联测（**种子代码自承注释"闭 G-2 残" `seed.ts:215,245`**）；且路径B数字保障是事后检测非前置。

| # | 任务 | 锚点 | 优先级 | 完成判据 |
|---|---|---|---|---|
| QOS-1 | **G-1/G-2 全量逐卡 probe-e2e + 真 DataCore 联测** | `mocks/seed.ts:395-425`（16 卡仅绑 solverKey 名）；`test/qos-a.test.ts` 仅 4 卡 | **P0** | 20 卡**逐卡**真调 invoke_solver+evaluate_rules+render_answer→Answer 块完整可溯源（非门B 抽 2 卡） |
| QOS-2 | **数字↔provenance 反向一致性校验**（路径B） | `agent/loop.ts:620-646` provenance LLM 自填可谎报；`util/numerics.ts` 仅事后扫悬浮数字 | **P0** | final_answer 的 provenance.outputPath 真指向审计值且数值一致；不一致→降信任级/标记（守 R13） |
| QOS-3 | maxDurationMs 超时降级判定 | `agent/loop.ts:490-533` 仅迭代计数，无时长检查 | P1 | 超 maxDurationMs 无 final_answer→降级收尾 |
| QOS-4 | 澄清轮数语义对齐（意图澄清 vs 槽位澄清） | `orchestrator.ts:537-550` 单计数器混二者 | P1 | 意图选错+槽位反问×2 不超 >2 轮限制（PRD §5.1-3/§5.2-1 对齐） |
| QOS-5 | 系统提示词 5 项约束逐项覆盖核 + 降级摘要数字清理 | `agent/prompts.ts` AGENT_SYSTEM_CORE 未逐项验；`loop.ts:214-226` degrade 无数字剥离 | P1 | 提示含角色/数字红线/写降级/答不了/注入防护 5 项；降级摘要剥编造数字 |

> ⚠️ **QOS-1/QOS-2 是"能用"与"可信"的核心**，建议先做，并补进 `probe-e2e` 作为常态回归。

---

## 2. 前端（85% · 收尾）

| # | 任务 | 锚点 | 优先级 | 判据 |
|---|---|---|---|---|
| FE-1 | 图谱 6 业务域配色（sales/material/finance/plan/external/decision）| `OntologyGraphView.tsx:25-54` 仅 8 域；14 域 GRAPH_DOMAIN 未下发对齐 | P0(小) | 14 域各有中文名+色 token，不再 muted 灰 |
| FE-2 | **场景预设上下文注入（= G-3）** | `useScenarioLaunch.ts`/`ScenesPage.tsx:65` presetContext 未被 Dock 取用 | P1 | 点场景卡→自动填 selectedObjects/filters/timeWindow（零反问） |
| FE-3 | 对象 360 页内容（现框架空/404） | `Object360Page.tsx`；溯源弹窗规则链接深链落点 | P1 | `/o/:type/:key` 渲染头部/属性/关系/足迹四区 |
| FE-4 | 沙盘内容（**在飞·轨 A 的 dev agent 在做，别重复**） | `SandboxView.tsx`/`SimInitWizard` | — | 见轨 A（HANDOFF-sandbox §6.1.A） |

> 已建别重写：useTaskStream（SSE 重连去重）/ 信任级视觉三层 / AnswerBlock 5 渲染器+溯源弹窗 / 本体图谱自研 SVG 力导向 / 38 管理页 / 权限驱动 UI / MSW 4 套 SSE 脚本（`src/sse/`/`components/Answer/`/`views/OntologyGraphView.tsx`）。**别动。**

---

## 3. 派活 + 评审
- **QOS（§1）单独一个 agent**——QOS-1/QOS-2 是核心可信度，必真跑取证。前端（§2）收尾可另派；FE-4 归轨 A 别重复。
- 评审同各 HANDOFF §5（不重写已建/门绿/**FDE 亲手证据**：QOS 必贴 20 卡逐卡真跑 + 数字反向验证证据/北极星距离）。
- **诚实定性**：QOS 骨架真、缺"全量真跑+数字前置保障"（这正是"绿测试≠能用"的核心样本）；前端核心链路通、缺配色/G-3/对象360 细节。
