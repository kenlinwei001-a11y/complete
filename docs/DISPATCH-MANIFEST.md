# DISPATCH-MANIFEST · 单一派发清单（转 dev·一次启动并行实现）

> DECISION-LOG D2：设计单 dispatch-ready。本清单=**单一收口**·每单一句提示词 + 链接·你一次转 dev（可多 agent 并行）。dev 建完审核方按各单 §3 FDE 复验闭环（**写完≠做完·🔵→🟢 只凭用户动作证据**）。
> 优先序：**P0 B3命门（真实数据出真答案）→ P1 修门红/真实业务全流程 → P2 出站/可观测**。

| # | WO | 一句提示词（给 dev agent） | 链接 | 优先 |
|---|---|---|---|---|
| 1 | **WO-SOLVER-ONTOLOGY-BINDING** | 解 B3：把 `opt-binding.ts` 范式扩到 canonical 求解器——`SolverBinding(role→真实类型/字段·DF.8 接地·无绑定回退默认)`，让上传类型喂求解器出真答案；按 §3 FDE 亲手验（realco/Orders 出真答案 + demo 零绑定回退 + 两行业 R14） | `docs/WO-SOLVER-ONTOLOGY-BINDING.md` | **P0 命门** |
| 2 | **WO-FIX 2-CONCERN** | 修 2 门红：`Object360Page` 补 `{drawer && <DagNodeDrawer/>}`（死交互）+ `invalidateConfidenceCache` 接生产写路径（诚实位失真）；补测防回潮 | `docs/WO-FIX-2concern-graph-freshness.md` | P1 |
| 3 | **WO-SOURCE-TRANSPARENCY** | 消灭走捷径：合成源数据→连接器页可见 Excel + 下载 + `no-orphan-source` 门；诚实保留 SYNTHETIC 不洗成真实 | `docs/WO-SOURCE-TRANSPARENCY-no-shortcut.md` | P1 |
| 4 | **WO-MULTISRC-FUSION-DOMAIN** | N1 多源融合：ERP/MES/SRM 同一事实→融合+冲突仲裁+测谎+带置信溯源；建在 SolverBinding 之上 | `docs/WO-MULTISRC-FUSION-DOMAIN.md` | P1 |
| 5 | **WO-E1 / WO-E2** | 校准活体常态化（`CALIBRATION_SWEEP`+convergenceHistory）+ 沙盘 what-if 进决策（`openWhatIf`）；设计已在、**实现零代码待建** | `docs/WO-design-E-calibration-sandbox-live-loop.md` | P1 |
| 6 | **WO-ACTUATE** | 决策出站 writeback：`WritebackAdapter`(mock echo+回声对账) + 真 ERP stub(`NOT_CONFIGURED`) + 诚实标"写到 MOCK" | `docs/WO-ACTUATE-writeback-adapter.md` | P2 |
| 7 | **WO-OBSERVABILITY** | OTel span 树：在 requestId spine 上加分布式 trace（未配 OTLP→no-op）·禁明文凭据 | `docs/WO-OBSERVABILITY-otel-span-tree.md` | P2 |

## 派发后协议
- 每单 dev 建完 → 审核方按各单 §3 FDE **亲手复验**（不读 dev 声明）+ REQ-LEDGER 回写状态。
- dev 交付走 `claude/vigilant-knuth-b1nmxn`·每单独立 commit·诚实标合成/真实边界。

## 仍待审核方补写（REQ-LEDGER v3 暴露的真遗漏·非本批）
R15（统一资源模型：规则/求解器/MCP 引用）· R16（agent 资产广度+入口预配体系）· R17（全局二级页回退普查）· R19（1C 抽取解析率/异步化）· R21（本体文件优化）· R22（深色字对比度）· R27（灾备备份/外部审计对接）。

---
*审核方派发清单（design+review·DECISION-LOG D2·单一收口给用户转 dev）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
