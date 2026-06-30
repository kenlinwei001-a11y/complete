# WO-MULTISRC-FUSION-DOMAIN · N1 多源融合（仲裁 + 测谎·建在 SolverBinding 之上）

> DECISION-LOG D1②：N1 提 P1。CEO 日常 10 问 8/10 卡此（多源各执一词）。**建在 `WO-SOLVER-ONTOLOGY-BINDING` 绑定层之上**（多源/多名→同一 canonical role 后，才谈融合）。铁律0.5 自包含设计。

## §0 目标
ERP/MES/SRM 对**同一事实**各执一词（订单交期 vs 产能 vs 在途到货）→ 融合成**一个带置信的答案 + 冲突仲裁 + 测谎**（跨源不一致 → 嗅可疑数据·防虚报）。这是 Maven"价值在接缝"的第一条（跨筒仓融合），也是本系统缺口。

## §1 现状（钉）
- **地基（依赖）**：`WO-SOLVER-ONTOLOGY-BINDING` 让多源类型→canonical role（同一 Order 来自 ERP 表和 MES 表，经绑定都映到 role=order）。
- **既有可复用**：`source_conflict` 概念（本体建议域）·`shared_bottleneck.contention` 字段·`dataMode` 诚实位（置信地基·LIVE/PARTIAL/MOCK）。
- **缺**：① 同 canonical 对象的多源实例融合（按 pk 归并多份）② 冲突仲裁规则 ③ 测谎（跨源同字段数值不一致检测）④ 带置信+溯源的融合答案。

## §2 施工范围
- **A. 多源对象融合**：同 role 的多源实例按 (pk) 归并 → `FusedObject{pk, fields:{value, sources:[{source,value,confidence}]}, verdict}`·确定性 R6。
- **B. 冲突仲裁**：规则驱动（权威源优先 / 新鲜度优先 / 多数票）·留痕（采纳哪个源·为何）·R6。仲裁规则走 A5 规则 DSL（可编辑·G-10）。
- **C. 测谎**：跨源同字段数值不一致超阈值 → 标 `SUSPECT` + 置信降级（**不照单全收·R13**）；尤其防"某基地虚报产能好看"（MU13）。
- **D. 答案带置信+溯源**：融合结果 `dataMode` 反映多源一致性（全一致 LIVE·有冲突 PARTIAL + 仲裁说明 + 溯源到源）。
- **E. AUDIT 问责**：仲裁/测谎全留痕（谁/何源/为何采纳/置信几分）→ 复用 WO-AUDIT-OBS append-only。

## §3 验收（FDE）
1. 注同一 Order 多源（ERP 交期 T1·MES 产能不足→实际 T2）→ 融合出"交期风险"带两源 + 仲裁结论 + 置信。
2. **测谎**：某源虚报产能（明显高于他源）→ 标 SUSPECT + 置信降级（不照单全收）。
3. R6 确定·R2 隔离·AUDIT 留痕可复盘。
4. 回归四包绿 + 融合/仲裁/测谎测。

## §4 不在范围
- 实时流式多源同步（属连接器 sync 域）。
- 跨承诺一致性（MU11）/资源争夺仲裁（MU15）——N1 域后续子能力。

## 本体引用与影响
- **链路**：`多源 RawDataset → SolverBinding(→canonical role) → **多源融合(仲裁+测谎)** → 带置信答案(dataMode+溯源) → R4 采纳`。
- **不变量**：R13（置信/测谎不照单全收）·R6（融合/仲裁确定）·R2·R4（采纳走审批）·G-10（仲裁规则可编辑）。
- **断点**：建 **G-N1 多源融合域**（含 `source_conflict` 求解器 + 测谎子能力）·Maven 接缝第一条·建议 P1。
- **回写**：落地后回写 §2.新域 + §3 链路 + §8 G-N1。

---
*审核方自包含施工单（design+review·铁律0.5·建在 SolverBinding 之上·N1 提 P1 见 DECISION-LOG D1）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
