# 数据构建发动机升级 · 价值/问题 → WO 对应（一页存档）

> **来源**：`DataBuilder-Handoff_dev.zip`（设计 + 审计文档）+ `REVIEW-field-schema-user-vs-platform.md`（§4 派生映射 · §5 平台该改三处）+ `CALB-data-fields-import-contract.docx`（导入契约）。
> **一句话**：把「数据构建发动机」从**假绿 + 无 LLM 也给垃圾 + 数据进不来 + 用 hash 假值冒充真值 + 建模不对齐用户契约**这五类病，逐条 WO 化、真跑复验闭环。
> **横切铁律（钉死·每条 WO 都守）**：① **通用性**——能力对每个租户都成立，**锂电=示例只**，不把电池常数塞进平台核心（守 R14）；② **R14 边界**——电池业务事实的合法归属地是 `synthetic/battery.ts` 合成包；用户 32 表 ERP schema 走**导入侧**端点，**不**塞进平台通用代码。
> **登记日**：2026-07-11 · 审核方存档（复验状态实时以 `docs/work-queue.json` 为准）。

---

## 一、治「假绿」（根因·最痛）

| 病（zip 审计命名） | 症状 | WO | 状态 |
|---|---|---|---|
| **洞 C** 闭包空壳判绿 | `closure.ts` 只看 domain、不读切片 → 空壳也判绿（G-BUILD-SHELL） | **WO-DB-CLOSURE-HARDEN** | ✅ DONE（真 Kimi·PROVISIONAL 不阻断成 0） |
| **洞 D** verify 写死 PASS | `service.ts buildStoryValidationTrace` 结果写死 PASS（G-BUILD-VERIFY） | **WO-DB-CLOSURE-HARDEN**（同单收） | ✅ DONE |
| **洞 E** 链路派生不稳 | LLM 链路输出不稳、缺确定性 FK 兜底 | **WO-DB-LINK-STABILIZE** | TODO |

## 二、无 LLM 不降级（质量地板）

| 病 | 症状 | WO | 状态 |
|---|---|---|---|
| **无-LLM 地板** | `comprehend` 无 LLM 也吐一个垃圾兜底模型冒充可用（G-COMPREHEND-FLOOR） | **WO-DB-LLM-REQUIRED-NO-FLOOR** | WIP |
| **沙盘 shock 无 LLM 起推演** | `maybeRenderSandbox` 无 LLM 也起，扩这条红线 | **WO-SANDBOX-SHOCK-NO-FLOOR** | TODO |
| **洞 B** B 栈不按故事派生 | workflow/agent 用模板 fan-out，不含故事语义 | **WO-DB-BSTACK-DERIVE** | TODO |

## 三、数据进得来（企业级导入 G1–G4）

| 契约档口 | 能力 | WO | 状态 |
|---|---|---|---|
| **G1** 多表 FK 批量导入 | `POST /a/v1/modeling/derive-bundle`（多表+FK 关系一次导入） | **WO-IMPORT-MULTITABLE** | ✅ DONE（物流域独立验） |
| **G2** 客户本体直导 | `POST /a/v1/ontology/import`（objects/relations 直灌本体） | **WO-IMPORT-ONTOLOGY** | 已建码（`b7a0c2d5`）·**待标 BUILT + 复验** |
| **G3** 场景导入 | `POST /a/v1/scenarios/import`（Stage/触发直导） | **WO-IMPORT-SCENARIO** | TODO |
| **G4** 真数据换 hash 假值 | 租户配置 `world_source`→真数据替换合成（配 CAP-01） | **WO-IMPORT-REPLACE-SYNTHETIC** | TODO（可选·配开关） |

## 四、数据是真的·会派生（换假值 + 派生引擎）

| 病 | 症状 | WO | 状态 |
|---|---|---|---|
| **记录字段→决策字段无派生** | 导入的记录型字段（bom/oee/production_order）没派生成决策字段（util/demandDelta/costBreakdown/allocatedLineIds） | **WO-DB-DERIVE-DECISION-FIELDS**（REVIEW §4 映射） | TODO |
| **配套智能推导缺** | S0 悬置接缝：从故事/需求图派生 propagation_rule 等 | **WO-SANDBOX-CONFIG-DERIVE** | ✅ DONE |
| ↑ 活路径未接线 | pre-analysis 触发时序未接（派生存在但不跑） | **WO-SANDBOX-CONFIG-DERIVE-WIRE** | TODO |

## 五、建模对齐用户契约（字段/基数 · REVIEW §5 三处·全落 `battery.ts`）

| 单 | 改动 | 锚点 | 状态 |
|---|---|---|---|
| **WO-SA-1** | `line_belongs_to_base` 基数 **N:N→N:1**（声明订正） | `battery.ts:770` | TODO（合一期·派单中） |
| **WO-SA-2** | Equipment 补 **mtbf/mttr/health_score**（设备故障真信号） | `:506` 声明 + `:1675` 合成 | TODO（合一期·派单中） |
| **WO-SA-3** | 新增 **Workshop 车间层**（Factory→Workshop→Line） | 新 props + `:739` + 两链路 + `:1654` 合成 | TODO（独立一期） |

> 三改守 **双向对齐门**（声明非派生字段必须合成填·不得填未声明）+ **R6 确定性**（新 draw 追加末尾不插中间）。施工单：`docs/WO-PLATFORM-SCHEMA-ALIGN.md`。

## 附：五幕 UX + 建模接线（体验层）

| 病 | WO | 状态 |
|---|---|---|
| 五幕向导缺理解确认门（覆盖度%·读不懂原句红高亮可拒·真绿才绿） | **WO-DB-FIVE-ACT-UX** | TODO |
| 故事发动机未接 A3 `deriveModelingSuggestion`（上传即从列派生建模） | **WO-DB-MODELING-WIRE** | TODO |

---

**闭环纪律**：每单以「代表问 → NL 真跑 → 逐值对照后端」验收；DONE 必带 `acceptance.criteria` 指向真产物（no-fake-done 门守）。任何改动新增/改变链路·事件·对象类型·不变量·门禁 → 回写 `docs/SYSTEM-ONTOLOGY.md` + `pnpm ontology:slices`。
