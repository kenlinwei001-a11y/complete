# TODO · 统一构建发动机路线 + 全链缺口修复

> 状态：✅ 已完成 · 🔄 进行中 · ⬜ 待办。断点编号见 `docs/SYSTEM-ONTOLOGY.md` §8。
> 工作纪律：每批 `pnpm -r build && test` + `ontology:check` 全绿，改链路/事件回写系统本体。

## 1 · 治理机制（保证本体不烂 + 真被读）
- ✅ CLAUDE.md 铁律 0（产 PRD/架构改动前必读 SYSTEM-ONTOLOGY.md，PRD 须含《本体引用与影响》）
- ✅ SessionStart 钩子（`.claude/` 每会话自动注入本体提醒 + §8 断点）
- ✅ `scripts/check-system-ontology.mjs` + `pnpm ontology:check`（事件/求解器/文件锚点漂移即红）
- ✅ `docs/_PRD-TEMPLATE.md`（强制《本体引用与影响》段）
- ✅ `/ontology` skill（强制先读脑再分析）

## 2 · 统一构建发动机 PRD
- ✅ `docs/PRD-unified-build-engine.md`（三入口分层 + 全链闭包 + 场景为主实体 + 执行计划为产物 + rawin 三路 + generic-inference + LLM 用途可扩展 + 瀑布流 HITL；分期 P1–P6）

## 3 · P0 让 20 场景真端到端可跑
- ✅ **G-2** affected_orders 跨服务形状不匹配 → DataCore 补 rows/count/columns 别名（`risk.ts`，typecheck+测试绿）
- ✅ **G-1** 种子从 SCENARIO_CATALOG 派生全部 20 意图+计划 + mock 求解器兜底（`mocks/seed.ts`/`clients.ts`），agentcore 195 测试绿 + 新增 scenarios-wiring 回归。*注：16 个静态 text 渲染，richer 解读后续走路径B/skill*
- ✅ 真实跨服务集成冒烟（`apps/datacore/test/xservice-smoke.test.ts`：真实 AgentCore HTTP 客户端↔真实 DataCore，守护 G-2 的 rows/count + 错误信封，挡 mock 漂移）

## 4 · P1 自助闭合 + 场景启动器
- ⬜ **G-4** 前端接 createPlan/saveWorkflow(null)/saveSkill(null)，消裁决#27 死路 — *PRD P2*
- ⬜ **G-3** scenarios 启动器视图 + SceneEntryConfig.presetContext + sessionStore 注入 — *PRD P2*

## 5 · P2 推演通用化（去电池锁死）
- ⬜ **G-5** generic-inference 通用 what-if（recompute 底座现成，包 Δ注入+前后对比）— *PRD P4*
- ⬜ **G-5** scaffold 从任意本体生成视图/场景/Agent（去 battery 硬编码）— *PRD P4*
- ⬜ **G-6** parseXlsx + 在线数据模版 + 合成并入连接器 — *PRD P3*

## 6 · 独立 bug
- ✅ **G-7**（部分）LLM 矩阵 model 选不了 → 已绑 model 不在目录仍可见可选（`LlmProvidersPage.tsx`，110 测试绿）
- ⬜ **G-7**（其余）LLM 用途枚举可扩展 + 按页面标注 — *PRD P5*

---

**已完成**：§1 治理全套 · §2 PRD · G-2 · G-7(model 显示)。
**剩余主体**：G-1(16 场景接线) · G-3/G-4(前端闭合) · G-5(通用化) · G-6(xlsx/模版)——即 PRD 的 P1–P5 实现，属大体量逐批工程，按 P0→P1→P2 推进，每批验证 + 回写本体。
