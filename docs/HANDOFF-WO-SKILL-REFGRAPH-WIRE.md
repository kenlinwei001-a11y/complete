# HANDOFF · WO-SKILL-REFGRAPH-WIRE（闭 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ①）

## ① 实测数（以本次实测为准）

- `extractRelations` 接线前 src 引用数：**1（仅定义行 `resource-projector.ts:365`）**，test 引用 2 文件 —— 「没接线」定性属实。
- 生产真用的 `extractResourceRelations`（`relations.ts:44`）唯一 src 调用方 `resource-registry.ts:220`，**整段不读 `skill.references/dependsOn`** —— 属实。
- 接线后生产链路实测（ seam 测试真跑 `GET /b/v1/resources` → `projectTenant` → 落 `resource_relations`）：skill 出边从 **0 条 → 8 条**（1 条 dependsOn + 7 条 references，含 6 条种子非空 references 中两端在册者）。
- **顶回来的一条**：本体 §8 与 CLAUDE.md 铁律 0.5 ① 都把种子那条 dependsOn 边的持有者记成 `sop_meeting` —— **实测持有者是 `capacity_action_draft`**（生产落表行：`capacity_action_draft --dependsOn--> capacity_analysis`）。本体三处已随本单订正；**CLAUDE.md 铁律 0.5 ① 里的同一处误记未动**（超本单范围，见 ⑥）。

## ② 改法与论据

修法取本体原文祝福的第一种：「把 ① 接上生产」，且**组合而非复抄**（旧版 ① 的 workflow/agent 抽取是复抄品，漏 `evaluate_rules→rule` 与去重排序——两份逻辑并存必然漂移）：

1. `apps/agentcore/src/dril/resource-projector.ts` · `extractRelations` 改为：基础边单源委托 `extractResourceRelations`（含去重+定序），其上叠加 skill `references/dependsOn` 边，合并后整体再去重+确定性排序（R6）。
2. `apps/agentcore/src/dril/resource-registry.ts` · `projectTenant` 落 `resource_relations` 的调用点从 `extractResourceRelations` 换成 `extractRelations`（**谁**在什么条件下调它：任何一次 `GET /b/v1/resources` / `GET /b/v1/resources/search` / `GET /b/v1/resources/{kind}/{key}` 都会触发 `projectTenant` 请求态全量重投影（R13），走到该行）。
3. `packages/contracts/src/intelligence-resource.ts` · `RESOURCE_RELATION_TYPES` additive 补 `"references"/"dependsOn"` —— 接线后 `resource.relations` 回填会被契约校验判非法（dril-registry 的 `findInvalidResources` 当场抓出）。论据：DB `rel_type` 为 TEXT 无 CHECK（`migrations/009`），无需迁移；全仓 grep 无按 relType 穷举的分支消费方；四包 typecheck 全绿。
4. `apps/agentcore/src/persistence/repos.ts` 注释同步枚举真值出处。
5. 测试：`skill-partial-a-seam.test.ts` 的「诚实边界」用例从**钉住断点**翻成**钉住接线**（断言落在链路产出：种子 dependsOn 边逐条落表——期望从 seed 现算不手抄键名；references 边 ≥1 条；workflow→solver 正对照）；新增反侧金丝雀（ontologyType 引用真略过 + 悬挂依赖被两端在册过滤拦下）。
6. 本体回写：§2.H「Skill 资源投影」、§8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 行（① 🔴→✅、链路列、② 的误记键名订正）、`scripts/ontology-anchor-baseline.json` 换键。

## ③ T1–T5 实测输出原文

**T1 变异反证（红对地方）**：把 `resource-registry.ts` 接线行换回 `extractResourceRelations(`（= 摘掉本单接的线）→

```
× B · dependsOn 出厂数据（消费方此前从不触发） > SEAM · 生产投影链路真把 skill 的 references/dependsOn 边落进 resource_relations（闭 G-SKILL-REFGRAPH-DEAD-EXTRACTOR ①）
  → dependsOn 边 capacity_action_draft→capacity_analysis 未落 resource_relations: expected false to be true
Tests  1 failed | 10 passed (11)   MUTANT_RC=1
```

红在**链路的产出变了**（resource_relations 表里少了一条真边），不是「函数不存在」。恢复接线后 22/22 绿。

**T2 没碰的东西没红**：
- merge-base（c4e2df8d）探针树跑同一批命令：`test/skill-partial-a-seam.test.ts + test/dril-registry.test.ts` → `Tests 21 passed (21)` RC=0；HEAD 上同两文件 22 passed（+1 = 本单新增的反侧用例）。
- HEAD 全量 agentcore 套件：`Test Files 172 passed | 1 skipped (173) · Tests 1068 passed | 5 skipped (1073)` RC=0 —— 全绿即「没有任何东西被弄红」。
- `check-ontology-anchors.mjs`：HEAD 与 merge-base 失败集**逐字相同**（各 27 条，既存漂移/未校准存量，本单零新增）；`check-ontology-writeback.mjs` 两树同红 `check-name-consistency` 漏登 §7（既存，本单范围外）。
- 四包 typecheck 全 RC=0（contracts 枚举扩后）。

**T3 金丝雀正反两侧（与主逻辑同一条生产链路）**：正侧 = 种子 `capacity_action_draft→capacity_analysis` dependsOn 边与 references 边真落表（必咬）；反侧 = 新用例「ontologyType 引用与悬挂依赖不产边」：插入带 `references:[ontologyType:Base]` + `dependsOn:[__NO_SUCH_SKILL__]` 的 skill 走真 `GET /b/v1/resources`，断言其出边 `toEqual([])` 且同轮正例边仍在 —— 22/22 绿。

**T4 基线没抬**：唯一动的基线文件 `scripts/ontology-anchor-baseline.json`，diff 仅一行换键：`resource-registry.ts::extractResourceRelations` → `resource-registry.ts::extractRelations`。方向说明：不是收紧也不是认账 —— 符号未删，是生产调用点换名后锚点跟随（`--update` 对 ANCHOR_DELETED 刻意拒写，此为其输出指引的「改指新位置并说明理由」路径）；verified 键总数不变、unverified 计数未动。

**T5 交单前三条**：`git status --porcelain` 空 · `check-branch-base.mjs HEAD` RC=0（分叉点=集成线 tip）· `check-merge-conflict-markers.mjs` RC=0。

## ④ 基线变化

未抬未降。一行换键（见 T4）；锚点行号随代码演进校准（`:365→:380` 等，均在门容差内的真实位置更新）。

## ⑤ 与其他 dev 的重叠

`git log --oneline -5 -- apps/agentcore/src/dril …`：本目录最近非本单提交为 `c04e5d7e4`（mock 契约面）与 `182c9b0c6`（P50 改名），无在跑 dev 的同文件改动；`apps/frontend-shell/**` 与沙盘线文件零触碰。

## ⑥ 没做的部分 + 下一步

1. **CLAUDE.md 铁律 0.5 ① 的误记未修**：「`sop_meeting --dependsOn--> capacity_analysis`」应为 `capacity_action_draft`（本单实测顶回，本体三处已订正）。下一步：审核方一句话订正即可。
2. **§8 ② `dependsOn` 覆盖不足**（🔴 未修，定性：7 个种子技能仅 1 条 dependsOn，环检测分支从未进入）—— 归既有单 `WO-SKILL-DEPENDSON-COVER`，本单不抢。
3. `check-name-consistency` 漏登本体 §7（`ontology-writeback:check` 既存红，两树逐字相同）—— 范围外，留给该门的属主单。
4. 本体锚点门既存 27 条漂移/存量失败（两树相同）—— 范围外。
