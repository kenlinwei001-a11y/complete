# WO-MULTISRC-FUSION-DOMAIN · N1 多源融合（仲裁 + 测谎·建在 SolverBinding 之上）

> DECISION-LOG D1②：N1 提 P1。CEO 日常 10 问 8/10 卡此（多源各执一词）。**建在 `WO-SOLVER-ONTOLOGY-BINDING` 绑定层之上**（多源/多名→同一 canonical role 后，才谈融合）。铁律0.5 自包含设计。

## §0 目标
ERP/MES/SRM 对**同一事实**各执一词（订单交期 vs 产能 vs 在途到货）→ 融合成**一个带置信的答案 + 冲突仲裁 + 测谎**（跨源不一致 → 嗅可疑数据·防虚报）。这是 Maven"价值在接缝"的第一条（跨筒仓融合），也是本系统缺口。

## §1 现状（钉）
- **地基（依赖）**：`WO-SOLVER-ONTOLOGY-BINDING` 让多源类型→canonical role（同一 Order 来自 ERP 表和 MES 表，经绑定都映到 role=order）。
- **既有可复用**：`shared_bottleneck.contention` 字段·`dataMode` 诚实位（置信地基·LIVE/PARTIAL/MOCK/SYNTHETIC）。
- **缺**：① 同 canonical 对象的多源实例融合（按 pk 归并多份）② 冲突仲裁规则 ③ 测谎（跨源同字段数值不一致检测）④ 带置信+溯源的融合答案。

> **命名订正（诚实·2026-07-09 收尾）**：本 WO 设计初稿把求解器暂名 `source_conflict`（"源冲突"占位名，见早期 curl 验收与 §8 G-16 诈账记录）。**落地实现的真实求解器 key 是 `multisource_fusion`**（`SOLVER_KEYS` 第 39·`solvers/service.ts multiSourceFusion`）。`source_conflict` 从未注册，仅为设计期占位；后续一律以 `multisource_fusion` 为准。

## §2 施工范围
- **A. 多源对象融合**：同 role 的多源实例按 (pk) 归并 → `FusedObject{pk, fields:{value, sources:[{source,value,confidence}]}, verdict}`·确定性 R6。
- **B. 冲突仲裁**：规则驱动（权威源优先 / 新鲜度优先 / 多数票）·留痕（采纳哪个源·为何）·R6。仲裁规则走 A5 规则 DSL（可编辑·G-10）。
- **C. 测谎**：跨源同字段数值不一致超阈值 → 标 `SUSPECT` + 置信降级（**不照单全收·R13**）；尤其防"某基地虚报产能好看"（MU13）。
- **D. 答案带置信+溯源**：融合结果 `dataMode` 反映多源一致性（全一致 LIVE·有冲突 PARTIAL + 仲裁说明 + 溯源到源）。
- **E. AUDIT 问责**：仲裁/测谎全留痕（谁/何源/为何采纳/置信几分）→ 复用 WO-AUDIT-OBS append-only。

## §3 验收（FDE·真实求解器 key = `multisource_fusion`）
1. 注同一 Order 多源（ERP 交期 T1·MES 产能不足→实际 T2）→ 融合出"交期风险"带两源 + 仲裁结论 + 置信。
2. **测谎**：某源虚报产能（明显高于他源）→ 标 SUSPECT + 置信降级（不照单全收）。
3. R6 确定·R2 隔离·AUDIT 留痕可复盘。
4. 回归四包绿 + 融合/仲裁/测谎测。

### §3.1 收尾（2026-07-09·活体真 demo 多源数据 + NL 路由接地）
初版求解器 + 单测已绿，但 (a) 运行态 demo 租户**无任一对象存在两源同 pk 冲突**→S25 活体 NL 问句一跑必空；(b) 场景卡 S25 的 `sources` 指向不相关类型（`Order`+`Model`·pk 永不重叠）。收尾闭合：
- **A · 真 demo 多源夹具**（`apps/datacore/src/seed.ts seedDemoMultiSourceFusion`·SEED_DEMO 路径调用·`server.ts`）：播三个已发布对象类型（domain=sales）`ErpOrder{so,due,cap,asOf}` / `MesOrder{so,due,cap,asOf}` / `SrmOrder{so,cap,asOf}`，用**真实 demo 订单号**（SO-3391/3402/3415/3431/3445）跨三源同 pk。**诚实数据边界**：这是 **DEMO 合成夹具（origin=SYNTHETIC·jobId=seed-multisrc-fusion-demo）**，演示"同一订单事实被 ERP/MES/SRM 各执一词"的融合机制，**非真实源系统抽数**；真实租户由真连接器 + SolverBinding 归一喂入（机制同·数据真）。确定性 R6（固定表·重跑字节一致）·R2 全落 demo 租户。三源而非两源：两源无法定中位判谁虚报，三源方能揪出 MES 离群。
- **B · S25 场景卡接地**（`apps/agentcore/src/scenarios-catalog.ts`）：`slotPresets.sources` 改指 `ErpOrder/MesOrder/SrmOrder`（role=order·fields=[due,cap]·authority ERP1/MES3/SRM2·defaultStrategy=AUTHORITY·suspectThreshold=0.15）→ NL 问句「多源数据打架时按什么口径仲裁？有没有测谎命中的可疑源？」路由 `multisource_fusion` 出**真冲突 + 真测谎**。
- **活体 FDE 证据**（真起内存 datacore + agentcore·真 HTTP·`POST /a/v1/solvers/multisource_fusion/invoke` X-Debug-User admin）：5 对象归并·conflictCount=4·suspectCount=2·**SO-3391**：due 冲突（权威仲裁采 MES 实际交期 2026-07-08）+ cap 测谎命中（离群源 MES·虚报值 20·极差 1.333>0.15）→ 审慎取最保守 cap=8（**不照单全收 20**·CONSERVATIVE·置信降级 0.35）·verdict=SUSPECT。整批 `dataMode=MOCK`（有测谎命中→头条最审慎不冒充真值；因底层数据 origin=SYNTHETIC，纯冲突无测谎的 due-only 融合叠加为 `dataMode=SYNTHETIC`——诚实标注合成边界）。`GET /b/v1/scenarios` 确认 S25 下发新 sources。
- **门**：`test/multisource-fusion.test.ts` 扩「DEMO SEED 多源夹具」组（断言 seedDemoMultiSourceFusion 播的真 demo 数据经 S25 口径融合出 conflictCount=4/suspectCount=2/SO-3391 SUSPECT/cap 审慎取 8/AUDIT 留痕·teeth：撤种子即红）。

## §4 不在范围
- 实时流式多源同步（属连接器 sync 域）。
- 跨承诺一致性（MU11）/资源争夺仲裁（MU15）——N1 域后续子能力。

## 本体引用与影响
- **链路**：`多源 RawDataset → SolverBinding(→canonical role) → **多源融合(仲裁+测谎)** → 带置信答案(dataMode+溯源) → R4 采纳`。
- **不变量**：R13（置信/测谎不照单全收）·R6（融合/仲裁确定）·R2·R4（采纳走审批）·G-10（仲裁规则可编辑）。
- **断点**：**G-N1 多源融合域**（求解器真实 key = `multisource_fusion`[设计初稿占位名 `source_conflict` 已弃]·+ 测谎子能力）·Maven 接缝第一条·建议 P1。
- **回写**：已回写 §2.新域 + §3 链路 + §8 G-N1（收尾追记真 demo 多源夹具 + S25 NL 接地）。

---
*审核方自包含施工单（design+review·铁律0.5·建在 SolverBinding 之上·N1 提 P1 见 DECISION-LOG D1）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
