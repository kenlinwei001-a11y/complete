# PROV-REF-INTEGRITY · FDE 实证（真起真跑·前端所见逐值对照后端）

> WO：溯源引用完整性（审计簇⑥⑩·全卡死角标 + 单一 provId 泛化悬停）· 2026-07-05
> 栈：datacore(4801, 内存+SEED_DEMO) + agentcore(4802) + frontend vite(5273) · 真浏览器 chromium(playwright-core) · demo/planner 登录

## 根因与治法（单一来源）

- **① 死角标（簇⑩）**：模板/模型产出 `⟦ref:n⟧` **数字索引**（n=provenance 下标·作者位约定，产出时真实 provId 尚不存在），而前端 `AnswerCard.provIndex`/悬停浮层**只按 provId 查找** → 永 miss → 渲染 `[0]` 死角标、悬停恒『0 加载中…』（S01 `[0][0][0]` 三连）。
  **治**：新增 `util/prov-refs.ts resolveNumericRefs(blocks, provenance)`，在**所有答案组装口**统一把数字索引解析成 `provenance[n].id`：Path A `renderAnswer`、规则拦截早退块、Path B/场景 agent `acceptFinalAnswer`、agent 降级路径（provenance 恒空 → 诚实摘除标记，数字转「未溯源」琥珀条，不留假角标）。越界索引=摘除（宁示警不作假）。
- **② 单一 provId 无字段级路径（簇⑥）**：`solver_summary` 全 KPI+表共用 1 个 provId、计算段恒 `$.data` → 每个 KPI 悬停同一泛化 blob；`kpi-{provId}` testid 撞车。
  **治**：`summarizeSolverOutput` 改收 **minter**（`ProvMint: (outputPath)=>provId`），逐 KPI/表/叙事铸独立 provenance 条目（`$.data.<field>`、嵌套 `$.data.<k>.<k2>`、表 `$.data.<arr>`、summary `$.data.summary`）；KPI 延迟物化（截断块不铸孤儿条目）。显式 kpi/table 模板块（S01 型）从**原始模板绑定** `{{steps.s2.output.data.p50}}` 推导字段级路径（值从哪个字段来，悬停就指哪个字段；混排文案回落 `$.data`）。
- 附带根修：观察记忆蒸馏 `recordExperience` 摘除 `⟦ref:…⟧` 后再截断（provId 是答案实例级 ULID，嵌进经验条目破坏 R6 同 trace 字节一致蒸馏——被本改动测试暴露的既有隐患）。

## 真跑证据（S01 = 审计点名 [0][0][0] 卡）

`POST /b/v1/scenarios/capacity_feasibility/launch` → COMPLETED/WORKFLOW。

### curl 后端真值（task JSON）

| 块 | 值 | provId→outputPath | toolName |
|---|---|---|---|
| KPI P50 产能 | 5.1836 GWh | `$.data.p50` | invoke_solver |
| KPI P90 产能 | 4.8585 GWh | `$.data.p90` | invoke_solver |
| KPI 缺口比例 | 0 % | `$.data.gapPct` | invoke_solver |
| 叙事「主要瓶颈为…见上方指标」 | 3 个角标 | = provenance[0..2].id（逐一可查到） | — |

- 数字索引残留：**0**（`/⟦ref:\d+⟧/` 全答案无匹配）
- 全部角标 id ∈ provenance（悬停必出内容）· KPI provId 全唯一 · unverifiedNumerics=false

### 真浏览器（登录→目录墙点 S01 ▶启动→对话坞）

- 角标渲染 **[1][2][3]**（原 [0][0][0]），`prov-mark-prov_01KWRHTXRA…` 三枚 testid 各异 → `PROV-REF-INTEGRITY-01-s01-marks-123.png`
- **悬停 KPI「P50 产能」浮层逐值对照**：值 `5.1836GWh`==后端 `$.data.p50` 真值；来源 `invoke_solver · snapshot 1.2`==后端 toolName/snapshotVersion；计算段 **`$.data.p50`**（字段级，非 `$.data`）→ `PROV-REF-INTEGRITY-02-kpi-hover-fieldpath.png`
- 悬停角标 [1] 浮层：同条目（来源 invoke_solver·计算 $.data.p50）非『加载中…』
- KPI testid：`kpi-prov_01KWRH…` ×3 全唯一（脚本断言 `unique: true`）

### solver_summary 卡抽验（同栈 curl 逐值）

| 卡 | KPI outputPath（抽样） | 表 path | 残留/可解析 |
|---|---|---|---|
| S04 plan_audit_q | `$.data.score` `$.data.verdict` `$.data.gmStruct` | `$.data.H` | 0 / 全可解析 |
| S18 sop_status | `$.data.shortageCount` | `$.data.materials` | 0 / 全可解析 |
| S20 carbon_q | `$.data.total` `$.data.breakdown.materialCarbon` `$.data.breakdown.energyCarbon` `$.data.verdict` | `$.data.evaluatedRules` | 0 / 全可解析 |
| S02 affected_orders | —（表卡） | `$.data.rows` | 0 / 全可解析 |

（S03/S05 等 7 张 AGENT_FIRST 卡在无 LLM key 栈诚实 `LLM_PURPOSE_UNBOUND`——MODE-DISPATCH 设计内，非本 WO 接缝。）

## 齿检（test/prov-ref-integrity.test.ts·7 例 + 存量 2 例改硬）

- `resolveNumericRefs`：下标→id 按序、越界诚实摘除（连前导空格）、真 id 保留、非 text 块不动。
- Path A 端到端（S01 形态模板过 `runWorkflow`）：三角标==provenance[0..2].id、零数字残留、KPI provId 唯一、**显式模板字段级路径** `["$.data.p50","$.data.p90","$.data.gapPct"]`。
- 规则拦截早退块：⟦ref:0⟧→违规条目真实 provId（toolName=evaluate_rules）。
- solver_summary 字段级：KPI provId 全唯一·路径集=={p50,p90,gapPct,feasible}·表=$.data.rows·summary 叙事角标→$.data.summary·**无孤儿铸造**·字符串旧形态兼容。
- 存量改硬：qos-b B1 / scene-agent C7 由「含 ⟦ref:0⟧」改为「含真实 provenance[i].id 且 `/⟦ref:\d+⟧/` 不匹配」。
- **revert 自证（红）**：摘掉 renderAnswer/acceptFinalAnswer 两处 resolveNumericRefs 接线 → `prov-ref-integrity`（Path A 齿）与 `qos-b B1`（Path B 齿）各红 1 例，恢复即绿（本会话实跑记录）。

## 门禁

四包 build 全绿；agentcore 套件 92 文件 510 通过（1 skip）；`pnpm gates` 见提交信息。
