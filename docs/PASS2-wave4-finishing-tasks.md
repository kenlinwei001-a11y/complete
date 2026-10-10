# PASS2-WAVE4 · 收尾任务清单（剩余 6 块定级）

> Pass-2 第四波摸剩余总纲/addenda 模块。**全 65-92% 已建（收尾）**，无新架构断裂。同前纪律：已建只接不重写；先 FDE 真跑；完成=亲手跑+证据；只 push `claude/vigilant-knuth-b1nmxn`、push 前 rebase。
>
> **建设度**：A2 92% · A7 75-80% · 架构松耦合 75% · 安全可观测 75% · A4/A5 72% · Skill 规范 65%。
>
> ⚠️ **D4 误判已撤回**：A4/A5 agent 称"A2 规则文档停滞"是越界漏看——D3 专摸确认 **A2 五阶段/防幻觉/人审/diff/RD1-2 测试全绿，92% 完整**。（交叉核对抓出 grounding agent 错判。）

---

## 1. 收尾任务（含跨块去重标注）

| # | 块 | 任务 | 锚点 | 优先级 | 判据 |
|---|---|---|---|---|---|
| W4-1 | 架构松耦合 | **C-2 webhook A→B 回调闭合**（= 数据流 DF-5 跨栈 outbox，**两路印证同一缺口·别重复实现**） | `outbox.ts:15-95` 仅本租户投递；agentcore 无回调注册 | **P0** | A 发 ontology.published→B 注册回调收到（D-29） |
| W4-2 | 架构松耦合 | QueueAdapter 接口预留 + A→B 全挂时 readyz soft-fail | grep 无 QueueAdapter；`server.ts:173` 仅报不可达 | P1 | 接口存在；A 侧操作不被 B 不可用阻断 |
| W4-3 | A7 合成 | **discrete-assembly / retail-supply-chain 内置模板**（PRD 称首批 3，实仅 battery） | `builtin-templates.ts:12` 仅 BATTERY | **P0** | 选另两模板一键生成跑通 |
| W4-4 | A7 合成 | **LLM 新行业模板生成 SY3 真验**（发动已实现**未测，桩**；与 comprehend 轨 C 相关） | `service.ts:125-131`，无 SY3 测试 | **P0** | 新行业字符串→LLM 生成模板→全流程产数据（贴证据） |
| W4-5 | A7 合成 | 意图目录种子 B 侧接（§7.2⑤，规则/视图/账号已生成，意图缺） | `service.ts:216-229` 无意图分发 | P1 | 合成后场景启动器出意图卡 |
| W4-6 | A2 文档 | 分段重试端点正规化 + PARTIAL 前端 UI（段级状态表+单段重试） | `app.ts:2720` retrySegment 已有；前端缺 | P1 | PARTIAL→单段重试→OK→IN_REVIEW 前端可操作 |
| W4-7 | A4/A5 | 派生对象 origin 枚举（现仅 synthetic/materialized/manual，派生无第四类）+ OM3 materialize 一致性验收 | `domain.ts` ObjectInstance.origin 无派生值 | P1 | 派生对象可溯 origin |
| W4-8 | 安全可观测 | dc_* 指标显式预声明（现动态创建）+ dc_connector_sync_total 加 tenantId 标签 | `datacore/metrics.ts` 无 dc_* 成员；`connectors/service.ts:246` | P1 | 6 指标 /metrics 可见+跨租户可聚合 |
| W4-9 | Skill 规范 | **多技能互斥重叠检查**（agent 级 summary 两两重叠）+ **出厂范例技能**（production_capacity_interpretation 可发布范例+反例） | `skill-lint.ts:86` 无 checkSkillMutualExclusion；无 examples/ | P0 | 重叠 summary 警告；范例 skill 入库 |
| W4-10 | Skill 规范 | SA2/SA3/SA5 验收测试 + body 超字下沉建议 | `skill-eval-gate.test.ts` 缺三类；`skill-lint.ts:59` 仅判字数 | P1 | 误触发/无增益拒/版本回归 三测；下沉提示 |

> **去重**：W4-1 = 数据流闭环 `PASS2-wave3 §1 DF-5`（跨栈 outbox），**只在数据流轨实现一次**。A4/A5 的 "evaluatedRules 11 求解器" = `H5(规则P3) SV`，别重复。

## 2. 已建·别重写速查
- **A2**：五阶段状态机+LLM 抽取+sourceQuote 防幻觉+人审+origin 回链+diff+PARTIAL（`ruledocs.ts`，RD1-2 绿）。**别动。**
- **A7**：电池一键全链路+派生+校验报告+配套生成+确定性 R6（`synthetic/service.ts`，SY1/SY2 绿）。**核心别碰，只加模板+LLM 真验。**
- **架构**：docker compose 独立+SIGTERM 优雅停机+BlobStore/VectorIndex 抽象（`server.ts`/`blob.ts`）。
- **A4/A5**：sourceBindings+派生拓扑序重算+规则 DSL 解释器+rules/evaluate（`ontology.ts`/`ruledsl.ts`/`rules.ts`）。
- **安全可观测**：OBO<60s 拒调+6 指标部分+/metrics 暴露（`executor.ts`/`metrics.ts`）。
- **Skill**：门禁一结构 lint+门禁二评测≥3（`skill-lint.ts`）。

## 3. 派活 + 评审
- 各块可独立认领；W4-1 归数据流轨（别重复）。评审同各 HANDOFF §5（不重写已建/门绿/FDE 亲手证据/北极星距离）。
- **诚实定性**：全 6 块收尾无架构断裂；A7 的 LLM 新行业（W4-4）与 comprehend 轨 C 共同支撑"听懂任意行业"北极星，值得优先真验。
