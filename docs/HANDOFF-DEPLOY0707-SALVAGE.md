# HANDOFF · deploy-0707 择要移植（以 vigilant 为准，不反向合并）

> 审核方产出（2026-07-09）。用户定：**以 vigilant-knuth 为最新主干**（dev 全部 WO 已建完），从旧分支 `deploy-0707` **择要移植**其独有价值，**不做整分支反向合并**。
>
> **为何不整分支合并**：对最新 vigilant（`9cc7ea3`）比对，`deploy-0707` 基于很旧的 vigilant——缺 **718** 个 vigilant 已有文件、在 **254** 个文件上分叉（大多只是旧版本），部署基建（3 个 Dockerfile / nginx.conf / docker-compose.seed）**逐字节相同**、DEPLOY.md/docker-compose.yml deploy-0707 反而更旧，且"新增"里有 vigilant 已删的残留（`GeoMapView.tsx` 等，NAV-DROP 删的）。反向合并会**倒退 718 文件 + 复活已删代码 + 254 文件冲突**。

## 一、移植材料（本目录 `deploy0707-salvage.tar.gz`·64KB·14 文件）

解包：`tar -xzf docs/deploy0707-salvage.tar.gz -C <临时目录>`。内含 deploy-0707 相对 vigilant **真正独有**的源+文档：

**A. pipeline / OntologyWorkflow 特性（源码·需评估后适配移植）**
- `apps/datacore/src/pipeline/{processing,service,subgraph}.ts`（一张画布 OntologyWorkflow + 六种节点；EntityNode 含 数据源/数据处理/子图建模 三配置；`STATIC↔ONTOLOGY`、`DATA_FIRST/GRAPH_FIRST`）
- `packages/contracts/src/pipeline.ts`（契约：WfStorageMode/WfEntryMode/聚合折叠等）
- `apps/datacore/migrations/013_pipeline.sql`
- 测试：`apps/datacore/test/{processing,workflow,xlsx-parser}.test.ts` + `packages/contracts/test/pipeline.test.ts`

**B. 设计文档（择 relevant 并入 docs/·舍 obsolete）**
- `PRD-gap-analysis-engine-v2.md` / `-v3.md`、`PRD-ontoflow-v2-unified-modeling.md`、`PRD-ontoflow-data-builder.md`、`DEV-NOTES-admin-row-mode-and-databuilder.md`

## 二、⚠ 唯一需先决策：pipeline 与现有 databuilder 的重叠

vigilant 已有 `apps/datacore/src/databuilder/{service,comprehend}.ts`（数据构建发动机·故事意图解析），概念与 deploy-0707 的 pipeline/OntologyWorkflow **高度重叠**（都是"低代码数据构建 / 本体工作流"）。**移植前必须先判**：并 / 不并 / 部分并——**绝不造第二套并行的建模引擎**。deploy-0707 pipeline 基于旧 vigilant，其引用的契约/接口 vigilant 已变，**不能裸拷，须适配当前 API**。

## 三、不入 git（用户本地持有·需要时另议）
- `db-seed/datacore-seed.sql`（**159,780 行** SQL 数据 dump·不宜入源码库·如需走 artifacts store / 重新 `SEED_DEMO` 生成）
- `deliverables/`（**5.6MB 二进制**：`全域决策支撑系统-安装包-含历史推演.zip` 4.3MB + Phase1-6 zips + Excel 模板·构建产物·不入 git·走发布物存储）

## 四、移植纪律（铁律 0.4/0.6）
以 vigilant 为准；只移植**真 additive、非重复**的部分；移植的源须**适配当前 vigilant 契约/接口**、齐 contracts+migration+tests、build+test+gates 全绿、触及链路/对象则**回写本体**；移植完**删除本 HANDOFF + tarball**（handoff 不留库）。
