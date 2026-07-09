# 本体切片 §9 · 演进与维护

<!-- 自动生成·勿手改 -->
> ⚠ **本文件由 `scripts/build-ontology-slices.mjs` 从母体 `docs/SYSTEM-ONTOLOGY.md §9` 派生**（本体克隆切片·层 2）。
> **改接线改母体 §9，再跑 `node scripts/build-ontology-slices.mjs` 同步**（勿直接改本文·门 `ontology-slices:check` 守漂移）。母体 hash `9d21ff4ddcbca150`。

---

## 9. 演进与维护

- 本文是**接线单一来源**：改动若新增/改变对象类型、链路、事件、不变量、门禁 → **必须同步本文对应章节**，否则大脑过期即失效。
- 治理已落地（不靠自觉）：`CLAUDE.md` 铁律 0（必读）· SessionStart 钩子（每会话动态注入 §8 未修断点）· `pnpm ontology:check`（漂移即红）· `docs/_PRD-TEMPLATE.md`（强制《本体引用与影响》）· `/ontology` skill。
- **本体克隆切片（母体→克隆·层层索引·自动同步）**：本文=**母体（唯一真相源）**；`scripts/build-ontology-slices.mjs` 从本文派生 `docs/ontology/` 逐节切片 + `INDEX.md`（层 1 任务→切片路由 · 层 2 逐节克隆 · 层 3 片内锚点）。日常检索读 `docs/ontology/INDEX.md`（简洁），改接线仍改本母体、再跑 `pnpm ontology:slices` 同步。切片是**派生克隆不新增事实**（R-一致）；门 `ontology-slices:check`（入 `pnpm gates`）守漂移——母体改而切片未重生成即红。
- 相关文档：**`docs/OPERATING-MODEL.md`（协同进化运行模型 = 机制宪法，统摄本体与 PRD）** · `docs/PRD-unified-build-engine.md`（统一构建发动机，全链闭包将补 R11 门禁）· `docs/AUDIT-0614-fullchain.md`（全链审核）· `docs/TODO.md`（排序路线）。
- 远期可**落库**：把本文的对象类型/链路/规则注册为平台自己的 ObjectType/Link/Rule（dogfooding），让"系统本体"也能被切片/校验/推演——即用平台分析平台自身。

---
