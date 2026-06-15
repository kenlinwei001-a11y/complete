# TODO · 系统协同进化路线（按重要程度排序）

> 状态：✅ 已完成 · 🔄 进行中 · ⬜ 待办。断点编号见 `docs/SYSTEM-ONTOLOGY.md` §8；域/切片见 §10。
> 纪律：每批 `pnpm -r build && test` + `ontology:check` 全绿；改链路/事件回写系统本体。

## ✅ Tier 0 · 已完成（基线）
- 系统本体 `docs/SYSTEM-ONTOLOGY.md` §1–§10（含域/切片/跨域节点）+ 治理闭环（CLAUDE.md 铁律0 / SessionStart 钩子 / `/ontology` skill / `ontology:check` / PRD 模板）
- PRD `docs/PRD-unified-build-engine.md`（统一构建发动机）
- 审核 `docs/AUDIT-0614-fullchain.md`
- **P0 修复**：G-1（20 场景全接通意图+计划）· G-2（跨服务形状）· 跨服务冒烟 · G-7（model 显示）

## 🥇 Tier 1 · 机制定型（最高：决定能否持续敏捷+稳定+协同进化）
- 🔄 **1. 运行模型文档** `docs/OPERATING-MODEL.md`（协同进化闭环 + 两层本体 + 防腐三防线 + 域/切片/跨域节点 + Claude 嵌入）
- ⬜ **2. 全链闭包门 R11 落地**（统一构建发动机 P1：BuildPlan 扩 AgentCore 栈 + ClosureReport 加 CHAIN/SHAPE）—— 大

## 🥈 Tier 2 · 人机/AI 统一入口 + 可追溯
- ⬜ **3. CLI 对话入口**（瘦客户端：login/ask/SSE 渲染/clarification 多轮/approve）—— Claude 嵌入落地形态
- ⬜ **4. PRD库结构化**（PRD 入图、《本体引用》机器可解析、需求↔制品↔缺口可查）

## 🥉 Tier 3 · 剩余断点修复（产品可用性）
- ⬜ **5. G-4** 前端自助闭合（createPlan/saveWorkflow/saveSkill，消裁决#27 死路）
- ⬜ **6. G-3** 场景启动器 + `SceneEntryConfig.presetContext` + 注入
- ⬜ **7. G-5** `generic-inference` 通用 what-if + scaffold 去电池锁死 —— 大
- ⬜ **8. G-6** `parseXlsx` + 在线数据模版 + 合成并入连接器（含引库决策）
- ⬜ **9. G-7 余项** LLM 用途枚举可扩展 + 按页面标注

## 🔭 Tier 4 · dogfooding 终态
- ⬜ **10.** 本体落库 PoC（系统本体注册为平台 ObjectType/SliceSpec/Rule → 平台切系统自己）
- ⬜ **11.** 本体活查询面（MCP/端点，Claude 问运行中的系统）
- ⬜ **12.** 本体自动派生扩展（§2/§3/§4 从代码生成，人只策展语义）

---
执行顺序：1（框架）→ 3（CLI 快赢+嵌入实体）→ 2（结构性稳定）→ Tier 3 修断点 → Tier 4 dogfooding。
