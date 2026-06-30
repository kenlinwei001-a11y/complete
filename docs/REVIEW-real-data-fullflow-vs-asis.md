# 审核核查 · "表格上传 / 倒推求解器 / 本体建模" 三点要求 vs 系统现状（钉代码证据）

> 用户三点要求：①连接器改**表格上传**·源数据**入库**·**前端可见** ②**倒推**求解器·规则**预部署/公开源下载** ③本体建模**基于源数据**·前后端可见·**模拟真实业务全流程**。
> **审核方真跑核查（直读代码·非信本体自述）结论**：三点的"**机制**"绝大多数**已在代码里**——真缺口不在"建路径"，在"**真实业务数据真走这条已建路径端到端**（现 demo 走合成捷径）" + **N1 多源融合**。
> 纪律：绿测试≠能用——"代码在"(本文 §1 直读核实) ≠ "真实数据端到端能用"(§2 明确标未验证)。

## §1 逐条对照（钉文件:行·直读代码核实，非信本体自述）

| 用户要求 | 系统现状 | 代码证据（本轮直读核实） | 判定 |
|---|---|---|---|
| ①a 连接器→**表格上传** | 上传端点 + 三路解析已在 | `POST /a/v1/uploads`(`app.ts:2832`)→BlobStore→自动建 `file_upload` 连接(`connectors/service.ts:340/354`)→discovery+sync；`connectors/parsers.ts` **parseXlsx**(node-xlsx)/parseCsv/parseJsonRows 三路统一出口 | ✅ 已在（G-6 收口） |
| ①b 源数据**入库**非前端代码 | 上传落 RawDataset(repo memory/pg) | 上传→`raw_dataset.uploaded`(L1 事件)→RawDataset 仓储；前端 `mocks/`(fixtures/handlers) 仅 **VITE_MOCK 无后端 dev 态**用，真路径数据在后端仓储 | ✅ 已在（基础册 BASE/SEG 在 `@platform/contracts` 单一来源·`boundary-singlesource:check` 门守不散写） |
| ①c 源数据**前端可见** | 多个可见页 | `DataSourcePanel.tsx`·`FieldProfilePage.tsx`(原始表逐字段)·`ObjectTypesBrowserPage.tsx`(`/admin/object-types` 34 类型/14 域 + 逐对象就绪%)·`GET /a/v1/data-templates`(模版下载) | ✅ 已在 |
| ② **倒推**求解器 | 自动倒推已在 | `databuilder/solver-args.ts` **deriveSolverArgs**(5.8KB·从对象类型字段/ref 倒推多跳求解器路径+字段映射)·comprehend→`BuildPlan.solverNeeds(+args)` | ✅ 已在 |
| ② 求解器/规则**预部署** | 46 求解器 + C01-C26 规则一等 | SOLVER_KEYS 46(含 5 CP-SAT)·C01-C26(`battery.ts rules[]` expression/severity/params)·`rule-closure:check` 门守"引用⊆已定义" | ✅ 已在 |
| ② 规则**公开源下载** | 优化模板族派生公开 OR | 9 OR 核心模板借鉴 OR-Tools/CP-SAT·LIC3 MIT 署名/LIC4 CDLA 取派生·`solver-license:check`(Gurobi 不碰/不训练) | ✅ 已在（优化族） |
| ③ 本体建模**基于源数据** | RawDataset→建模→发布链 | 本体§3:197 `RawDataset --suggest/modeling--> OntologyDraft --publish--> OntologyType/Link/Version`·`ModelingPage` UI·databuilder comprehend 链 | ✅ 链路在册 |
| ③ **前后端均可见** | 后端仓储 + 前端图谱/浏览器 | `ObjectTypesBrowserPage`(34 类型)·`OntologyGraphView`(GRAPH-2 本会话已验)·`ModelingPage` `DataPipelineDag`(横向 ETL·R13 字段映射) | ✅ 已在 |
| ③ FK 一致 / 数据模版 | 已在 | `synthetic/data-template.ts` **buildDataTemplates**(派生上传列模版·排除派生列·ref 标父类型)+**generateRelatedDatasets**(依赖序·真 PK 池·子表 ref 取父真 PK·样例可直接试灌) | ✅ 已在 |

→ **9/9 机制均有真实代码**（直读文件:行核实·非信本体自述）。**用户的"需要修改为/需要预先生成"前提，多数已是 AS-IS。**

## §2 那真缺口在哪？（机制齐 ≠ 能用·这才是审核方该指的）

平台第一性原则=绿测试≠能用。机制都在，**真缺口三处，全在"真实数据真走路径"而非"建路径"**：

1. **🔴 demo 数据走"合成捷径"·非真实表格上传端到端** —— 现 demo 经 `SyntheticJob --gen(seed)--> Connection(合成源)+RawDataset --materialize--> ObjectInstance`（合成并入连接器·确定性 R6·诚实标 SYNTHETIC）。**不是真有人把真实锂电业务 Excel 经 `POST /a/v1/uploads` 灌进去。** 用户要的"模拟真实业务全流程"=**让真实数据真走这条已建的路径**，而非再建路径。两条路径都真实存在（合成正门 R16 + 上传正门），但 demo 默认走合成。
2. **🔴 端到端"真上传→自动建模→倒推求解器→出答案"从未以真实数据实拍验证**（绿测试≠能用）—— 每块有代码（§1），但"**上传一包真实锂电 Excel → FieldProfile/ObjectTypesBrowser 看见对象 → deriveSolverArgs 倒推 → 求解器真出答案 → C 规则真裁决**"这条**单一连续真实流**未被走通核实。断点常在接缝（合成↔真上传切换/多表 FK 对齐/口径）。
3. **🔴 N1 多源融合** —— 真实业务里 ERP/MES/SRM 对同一事实各执一词（订单交期 vs 产能 vs 在途到货），上传三份表后"**融成一个答案 + 冲突仲裁 + 测谎**"无机制（本会话反复命中·CEO 日常 10 问 8/10 卡此·建议 N1 提 P1）。

## §3 提议：把"建"改成"真跑验"——真实锂电业务数据包 + 全流程实拍

**审核方建议（FDE 纪律·亲手用一遍才算完成）**：不重建已有路径，而是**设计一包真实锂电业务表格 + 真起服务把它端到端走一遍**，证明"模拟真实业务全流程"真能用，or 钉出真断点：

1. **造真实业务数据包**（≈8-12 张 Excel/CSV·真实锂电语义·非内置 demo seed）：订单(ERP)·基地/产线/工序(MES)·设备 OEE(SCADA)·物料齐套(WMS)·在途/采购(SRM)·型号 BOM(PLM)·检测良率(LIMS)·外部锂价信号(EXTERNAL)。先 `GET /a/v1/data-templates` 拉真实列模版当骨架。
2. **真走上传链**：`POST /a/v1/uploads` 逐张传 → RawDataset → 前端 `DataSourcePanel`/`FieldProfilePage` 看见 → A3 建模 suggest → 发布本体 → `ObjectTypesBrowserPage` 看见对象 + 就绪%。
3. **真倒推 + 求解**：`deriveSolverArgs` 倒推求解器入参 → invoke 求解器(order_fullchain/quote_margin/...) → 出真答案 → C 规则 `evaluate_rules` 裁决 PASS/WARN/BLOCK。
4. **实拍录证**：每步截图 / curl 真响应（FDE：用户看到什么才算数·非"应该能"）。
5. **诚实报断点**：哪一接缝断了（预判：① demo 默认合成 vs 真实上传的切换 ② 多表 FK/口径对齐 ③ N1 多源同一事实融合）。

这把用户三点要求落成**一次可验收的真实业务全流程实拍**（北极星：CEO 上传自家报表→一句话问→真答案），而不是重造已有轮子。

## §4 一句话
**你要的"表格上传 / 倒推求解器 / 规则预部署 / 本体建模基于源数据 / 前后端可见"——直读代码核实，9/9 机制都已在（不是 greenfield）。真缺口是"让真实业务数据真走这条已建路径端到端、实拍验证、并补上 ERP/MES/SRM 同一事实的多源融合(N1)"。建议先真跑验证现有全流程（造真实数据包·实拍 upload→建模→倒推→答案·钉真断点），而非重建。**

## 本体引用与影响
- **链路**：`上传/连接器(A1)→RawDataset→A3 建模→本体(A4)→deriveSolverArgs 倒推→求解器→C 规则→答案`（全在·本体§3:195-209）；A6 行级权限贯穿。
- **对象类型**：Connection/RawDataset/RawRow/OntologyDraft/ObjectType/ObjectInstance/SolverParam/Rule（`TYPE_SOURCE_SYSTEM` 真归因）。
- **断点**：G-6 ✅(三路上传 + 数据模版 + FK 一致已收口·不回退)；**真缺口非既有断点**——建议新增观察项 **「G-13 真实业务数据包端到端未实拍」**（合成捷径 vs 真上传）+ **N1 多源融合(建议 P1)**。
- **不变量**：R6(确定性合成·字节一致)·R13(诚实位 SYNTHETIC/LIVE)·R16(发育走正门)·R14(行业无关·非电池可用)·R4(发布走审批)。
- **回写**：本文不改既有断点判定（G-6 仍 ✅）；若用户采纳 §3 真跑并钉出新断点，再回写本体 §8。

---
*审核方核查（design+review·直读代码核实 9 机制·非真起服务实拍——§3 提议真跑待用户定向）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
