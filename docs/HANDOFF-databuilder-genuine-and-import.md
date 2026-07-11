# HANDOFF · 数据构建发动机「真数据 · 真构建 · 不造假」一套三份（索引 + 开工纪律）

> **这是什么**：审核方对「数据构建 / 数据生成 / 导入」做了多轮**真起服务真跑**（含绑真 Kimi、跑 CALB 5 场景、对照外部 Stage 3.15 生成器）后，把结论收成**一套三份文档**的单一入口。dev 从本文读起。
> **主线一句话**：让"数据是真的（导入）+ 构建是真的（修空壳）+ 不懂就别瞎建（禁地板）"三件事同时成立——**只做任一件都会前功尽弃**。
> **状态**：待派单索引。铁律：一期一单 → dev BUILT → 审核方真跑复验（含 green→red 自证）→ DONE → 才派下一期（`fde-delivery`）。

---

## §0 为什么是三份（依赖关系·先懂再动手）

```
① 导入 PRD        → 世界数据"进得来"       PRD-enterprise-dataset-import.md
        │            （Stage 3.15 企业级真数据一键导入）
        ▼
② AUDIT-DELTA     → 进来后"构建得真不真"    AUDIT-databuilder-genuine-construction-DELTA.md
        │            （修 切片空壳 / B栈模板 / 闭包盖章 / verify假绿）
        ▼
③ NO-FLOOR WO     → 没LLM时"别静默造垃圾"    WO-DB-LLM-REQUIRED-NO-FLOOR.md
                     （无绑定→诚实报错不建）
```

**为什么必须一起**：
- 只做①（导真数据）不做②：真数据进来照样被 `closure.ts:27` 空壳判绿、被 `service.ts:629` verify 盖假章 → 真数据被下游做成假结论，前功尽弃。
- 只做②不做③：修好了构建，但无 LLM 时地板路仍把陌生行业硬套成电池味垃圾（语义全错还判绿）。
- 三份合起来 = **数据真 + 构建真 + 不懂不瞎建** 的完整诚信闭环。

---

## §1 三份逐份价值（dev 该知道每份解决什么）

### ① `PRD-enterprise-dataset-import.md` — 世界数据进得来
- **解决**：外部 Stage 3.15 生成器产出的企业级 CALB 数据集（13 张关联 CSV + objects.json/relations.json + 场景 + neo4j + 校验）**一键真导入**平台。
- **关键立场**：**不把 Stage 3.15 生成逻辑塞进平台代码**（违 R14 锁死电池）——只补"导入侧"。Stage 3.15=外部世界生成器，平台=下游决策引擎。
- **产出 WO**：G1 多表 FK 批量导入 · G2 客户本体直导 · G3 场景导入 · G4 真数据换 synthetic hash 假值。
- **已验证基线**：上传→建模→物化→前后端真查（实测 F001=51 不写死）这条链**真通**，只需扩多表+本体直导两入口。

### ② `AUDIT-databuilder-genuine-construction-DELTA.md` — 构建得真不真（含真跑铁证）
- **解决**：把"系统构建的每类制品是真派生还是盖预制件"用 file:line + 真跑钉死。三个未被既有文档记录的新洞：
  - **洞C/D（最狠）**：`closure.ts:27` 闭包**只看 domain 不读切片** + `service.ts:629` verify **逐条写死 PASS** → **gatePassed 绿 + ALL_PASS 绿能在"切片空、推演没跑"时同时点亮**（用户最信的两个绿灯是假的）。
  - 洞A 规则预制（仅地板路）· 洞B B栈模板 fan-out · 洞E 链路派生不稳（5次里1次links空）。
- **§6 真 LLM 实测（省钱·纠偏）**：绑真 Kimi 后 CALB 5/5 建对多跳、11 求解器全真注册 → **证明"别再调LLM/重写引擎"（H3红线）**，改造精确锁定到"修切片/B栈/闭包这三块 LLM 不经手的下游"。
- **产出 WO**：WO-DB-CLOSURE-HARDEN（最优先）· WO-DB-BSTACK-DERIVE · WO-DB-LINK-STABILIZE。
- **纪律**：增量对账既有 `TODO-fde-build-engine.md`/`H3`，**不覆盖重写**。

### ③ `WO-DB-LLM-REQUIRED-NO-FLOOR.md` — 不懂就别瞎建
- **解决**：落地用户决定"取消无-LLM 地板降级，只有绑 LLM 才能建，否则造垃圾"。改 `service.ts:97` 三条静默降级路（catch吞错/0对象/没绑）→ 诚实报错不建（`LLM_PURPOSE_UNBOUND`/`COMPREHEND_NOT_UNDERSTOOD`/502）。
- **顺手修真 bug**：seed 演示只建 LLM provider、**漏绑 comprehend 用途**（导致演示环境永远走地板·实测踩坑）。
- **诚实代价（已写明让人决策）**：硬依赖在线 LLM·CI 须绑或 mock·离线不能建——都做成诚实态。

---

## §2 建议派单序（跨三份·按杠杆排）

| 期 | WO | 属 | 为什么这个序 |
|---|---|---|---|
| 1 | **WO-DB-CLOSURE-HARDEN** | ② | 最狠的假绿（闭包/verify 盖章）·治了它其余才可信 |
| 2 | **WO-DB-LLM-REQUIRED-NO-FLOOR** | ③ | 堵住陌生行业垃圾入口·顺修 comprehend 绑定 bug |
| 3 | **WO-IMPORT-MULTITABLE**（G1） | ① | 让 Stage 3.15 数据进得来·复用确定性 deriveModelingSuggestion |
| 4 | WO-IMPORT-ONTOLOGY（G2）· WO-DB-BSTACK-DERIVE（②） | ①② | 本体直导 + B栈真派生 |
| 5 | WO-IMPORT-SCENARIO（G3）· WO-DB-LINK-STABILIZE（②·洞E） | ①② | 场景导入 + 链路兜底 |
| 6 | WO-IMPORT-REPLACE-SYNTHETIC（G4）配 WO-CAP-01 | ① | 真数据换 hash 假值·治假推演源头 |

---

## §3 全局开工纪律（每单必守）
1. **先真跑摸底**（fde-delivery·不信测试绿）：起服务，绑真 LLM 跑一个非电池故事 + 一个 CALB 场景，亲眼确认"LLM 建得对、但切片 hops 空、verify 假绿"。
2. **一期一单**·每单 acceptance 含 **green→red 自证**（植入空切片/BUILD_STATIC→门必红）·含回退演练。
3. **不覆盖重写**：引用既有 TODO-fde/H3 为靶，H3 明令"照 stale TODO 从零重写引擎=红线级打回"。
4. **守 R14/R-PACK**：平台代码无新增电池业务常数（`debattery:check` 绿）；Stage 3.15 逻辑不入平台。
5. **守 R-NO-ORPHAN-SOURCE**：导入对象挂真 rawDatasetId（可下载审计·green→red：删源→报孤儿）。
6. **改本体判据/新增门 → 回写母体 §8 + `pnpm ontology:slices`**（G-BUILD-SHELL/G-BUILD-VERIFY/G-COMPREHEND-FLOOR/G-8）。
7. **诚信红线 KILL-MOCK-RED**：无真理解/无真数据 → 诚实报缺/报错，绝不合成/哈希/写死/盖 PASS 章冒充真。

---

## §4 关联既有文档（勿重复·勿推翻）
- `TODO-fde-build-engine.md`（北极星靶）· `HANDOFF-comprehend-engine-build-and-review-contract.md`（H3·勿从零重写）· `PRD-databuilder-page-unified-spec.md`（八区 UX·可合五幕向导）· `PRD-capacity-sim-decision-flow.md`（WO-CAP-01 REALDEMAND·G4 配合）· `modeling.ts:85-96`（deriveModelingSuggestion 确定性反推·导入复用核心）· `AUDIT-fake-simulation-inventory.md`（hash 假值根）。

## 附录 · 一句话给决策人
**给系统真 LLM，它的大脑在真实电池域上能懂 5 种复杂决策、映射对全部求解器——大脑合格了。真正卡住的是三块 LLM 不经手的东西：空切片、模板 B栈、和被空壳满足的闭包/verify 假绿；再加上"没数据源"和"没 LLM 时造垃圾"。这套三份文档,就是把这五件事一次性讲清、按杠杆排好、带真跑铁证的开工地图——修完,复杂推演就能在真数据上端到端跑通、且不造假。**
