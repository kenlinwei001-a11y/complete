# DataBuilder / 数据导入 · Dev Handoff 包（先读我）

目标分支：`claude/vigilant-knuth-b1nmxn`（kenlinwei001-a11y/complete）

## 这个包是什么
把「数据构建发动机 / 企业级数据导入 / 字段对照」相关的全部依据收在一个包里。核心一句话：
**让系统能导入用户设计的真实企业数据（数据字段.docx），并把它建成能跑复杂推演、不造假的世界。**

## 阅读顺序
1. **HANDOFF-databuilder-genuine-and-import.md** ← 总索引（三条主线 + 派单序 + 纪律），从这读起
2. **数据字段.docx** ← 用户设计的数据模型（13 主数据 + 19 事务 + Ontology/Neo4j/pg schema）= 导入的"标准契约"
3. **REVIEW-field-schema-user-vs-platform.md** ← docx 字段 ↔ 平台现有字段 细致对照（含记录型→决策型派生映射 + 平台该改三处）
4. **PRD-enterprise-dataset-import.md** ← 导入侧程序 WO（多表FK导入/本体直导/场景导入/真数据换hash假值）
5. **AUDIT-databuilder-genuine-construction-DELTA.md** ← 构建真伪审计（切片空壳/B栈模板/闭包假绿 + 真LLM 5场景实测）
6. **WO-DB-LLM-REQUIRED-NO-FLOOR.md** ← 取消无LLM地板降级（不懂就诚实报错不建）

## dev 要开发的是"程序"，不是数据字段
- 数据字段（docx）用户已设计完，作为导入契约，不重新设计。
- dev 写代码：① 导入端点（读docx的objects/relations→建本体→物化）② 平台字段/基数改动（补Workshop层/Equipment补MTBF·MTTR/修line_belongs_to_base N:N→N:1）③ 派生引擎（记录字段→决策字段·治假值）④ 构建质量修复（闭包/verify不假绿）。

## 铁律
- 先真起服务摸底（fde-delivery·不信测试绿）。一期一单·每单 green→red 自证·回退演练。
- 勿从零重写引擎（H3红线）。守 R14（不锁电池·debattery:check绿）。守 R-NO-ORPHAN-SOURCE（导入对象挂真rawDatasetId）。
- 改本体/字段/基数 → 回写母体 docs/SYSTEM-ONTOLOGY.md + pnpm ontology:slices。KILL-MOCK-RED（不盖PASS章冒充真）。
- .md 文档可直接放进 docs/（对应补丁也在，纯新增·git apply 干净）。
