# PRD 增量 · M11 校准引擎算法规格（偏差 → 参数建议值）

| 项 | 值 |
|---|---|
| 版本 | v1.0（专门文档：M11 算法层。消费面不变——C12 触发见求解器增量 §S1/A8 增量 §5，报告页见剩余视图增量 §7.21，审批生效见 §S2） |
| 落位 | DataCore 模块（编号沿用 M11，工程目录 `apps/datacore/src/calibration`）；输入=预测对象(A4)+实际值(A8)，输出=校准提案（经 Action 生效） |
| 架构红利 | 求解器全部确定性可重放（同输入+同参数=同输出）——本规格的归因与回测都建立在"历史重放"之上，这是别家做不了的部分 |

## 0. M 系列 → 现行文档落位对照（澄清，非新内容）

| 早期模块 | 现行落位 | 早期模块 | 现行落位 |
|---|---|---|---|
| M0 IAM | A0 + 管理平台增量 | M7 场景推演 | B7/S1 + 同步求解端点 |
| M1 本体元模型 | A4 + A3 | M8 AI 编排 | B1–B6（QOS-PRD） |
| M2 对象实例 | A4 + A8 | M9 Action | §S2 |
| M3 接入 | A1 | M10 事件告警 | outbox/webhook（平台 PRD C-2） |
| M4 派生管线 | A4 | **M11 校准学习** | **消费面已散布，算法层=本文** |
| M5 规则引擎 | A5 + §S1.6 | M12 BFF | 前端 PRD apiClient（轻量化，未独立成层） |
| M6 求解器运行时 | B7 + §S1 | | |

## 1. 配对引擎（pairing）

1. **配对键** = `(solverKey, entityRef, targetWindow)`。预测对象（A4，含 `paramsVersion`、预测值、目标窗口）在窗口**完全过期 + 数据新鲜度正常**后参与配对（源系统延迟中 → 推迟配对，绝不用残缺实际值污染样本）；实际值 = A8 同窗口聚合（`ts_agg_runs`）。
2. 落表 `calibration_pairs { id, solver_key, entity_ref, window, predicted, actual, error, ape, params_version, paired_at }`；`error = predicted − actual`，`ape = |error| / max(actual, ε)`。
3. 一个预测只配对一次；预测后参数已变更的（paramsVersion 不同）正常配对但打 `staleParams` 标记（仍用于评估旧参数，不用于新提案的回测基线）。

## 2. 误差度量与切片

- **MAPE**（滚动 7/30 天双口径）、**Bias** `= Σerror / Σactual`（系统性偏高/偏低，符号决定调参方向）、**覆盖率** `cov = P(actual ≥ P90预测)`。
- 全部指标按维度切片：solverKey × 基地 × 型号 ×（适用时）工序——报告页 §7.21 的三级下钻直接消费此切片。
- 最小样本量 `nMin = 10` 对/切片：不足时该切片只报告不提案（`INSUFFICIENT_SAMPLES`）。

## 3. 触发（与既有规格对齐）

- C12：`SUSTAIN(MAPE_7d > 0.08, 1)` 按切片扫描（S3 RULE_SCAN）→ `calibration.required` 事件 → 对该切片运行提案生成；
- 兜底定时：S3 新增 kind `CALIBRATION_RUN`，每周全量跑一次（即使未触发 C12，温和漂移也被周期性收口）；
- 手动：报告页「立即校准」按钮（catalog_admin）。

## 4. 参数建议值推导（核心算法，按参数类型三种方法）

**可校准参数注册表**（场景包配置，每参数声明 method 与边界）：节拍 CT 基线、良率基线、OEE 基线 → 方法 A；爬坡曲线系数、认证系数、求解器修正系数 → 方法 B；P90 健康度系数 → 方法 C。

### 方法 A · EMA（直接可观测参数）

实际值可由 A8 直接观测（如设备实际 OEE、工序实际良率）：

```
observed = A8 同窗口实测均值
proposed = α × observed + (1−α) × current        α 默认 0.3（场景包可调）
```

**结构性漂移闸门**：`|observed − current| / current > 0.20` → **不出 EMA 提案**，改出 `STRUCTURAL_SHIFT` 标记项（换线/换体系/大修后旧基线失效的典型信号，需人工判断重置基线还是排查数据）——对应原型"概念漂移检测、旧案例降权"的设计意图。

### 方法 B · 重放归因（间接系数）

无法直接观测的系数（爬坡曲线、认证系数等），利用求解器确定性重放做单因子归因：

```
对每个候选因子 f：
  贡献_f = Solver(基线参数, 但 f 用实测重构值) − Solver(全基线参数)     // 历史输入重放
残余偏差按 |贡献_f| 占比分配到各因子
proposed_f = current_f × (1 + 分配偏差_f / 预测值)，单次变幅 clip ±10%
```

小步长（±10%/次）防震荡；多因子同窗命中时见 §6 级联抑制。

### 方法 C · 分位数匹配（P90 健康度系数）

目标是覆盖率而非点精度：统计窗口内 `cov = P(actual ≥ P90)`，

```
cov < 0.85 → f −0.01；cov > 0.95 → f +0.01；否则不动；clip 到 [0.85, 0.98]
```

（与 C09 的数据健康度降级独立叠乘：C09 是临时降级，本方法校准的是常态基线。）

## 5. 回测门槛（提案出闸的硬条件）

每个提案生成后**必须回测**：用建议参数对窗口内全部配对样本重放求解器，计算 `simulatedMapeAfter`；

```
仅当 mapeBefore − simulatedMapeAfter ≥ 1pct（场景包可调）才产出提案，否则丢弃并记 NO_IMPROVEMENT
```

提案对象：

```ts
interface CalibrationProposal {        // ID 前缀 cal_
  id; tenantId; sliceKey;             // solverKey×基地×型号
  paramRef: { scope: "SOLVER_PARAMS"|"ONTOLOGY_PROPERTY"; path: string };
  currentValue: number; proposedValue: number;
  method: "EMA"|"REPLAY_ATTRIBUTION"|"QUANTILE";
  evidence: { windowFrom; windowTo; nPairs; mapeBefore; simulatedMapeAfter; bias; flags: string[] };
  status: "PENDING"|"APPLIED"|"REJECTED"|"ROLLED_BACK"|"HOLD";
}
```

## 6. 生效、防护与元闭环

1. **生效**：提案经 Action（actionType=`校准参数变更`，§S2 审批流）→ solverParams/本体基线属性版本 +1；**回滚** = 恢复上一参数版本（一键，亦走 Action）。`autoApply` 场景包开关（默认 false）：开启时仅方法 A 且变幅 <5% 的提案免审批自动生效（仍留全审计）。
2. **频率限制**：同一 paramRef 变更 ≤1 次/周；**级联抑制**：同切片同窗口多参数提案按 simulated 改善幅度排序，只放行第一个，其余 HOLD 至下窗口（防多参数同动导致归因失效）。
3. **元闭环**：提案 APPLIED 后 14 天，自动比对 `实际 MAPE 变化 vs simulatedMapeAfter 预言`，结果写回提案（`realizedMape` 字段）并沉淀 QOS 经验库——校准方法本身的有效性被持续验证，报告页历史时间线展示"预言 vs 实现"。

## 7. 与其他模块关联

A8（实际值与观测均值来源）｜S1 求解器（重放归因与回测的执行体——要求求解器支持"指定参数版本运行"，列为 S1 修订点）｜S2 Action（生效/回滚通道）｜S3 调度器（CALIBRATION_RUN）｜A5/C12（触发）｜§7.21 报告页（全部展示字段与本文 evidence 对齐）｜A7 模拟时钟（T9 演示线：tick 注入 yield_drop → 偏差累积 → C12 → 本引擎出提案 → 批准 → MAPE 收敛可见）。

## 8. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| C1 | 配对正确性 | 窗口未过期/源延迟时不配对；过期且健康后配对；error/ape 与手算一致 |
| C2 | 方法 A | 构造 OEE 实测均值 0.78 vs 基线 0.85 → EMA 提案值 = 0.3×0.78+0.7×0.85；实测 0.60（漂移 >20%）→ 无 EMA 提案、出 STRUCTURAL_SHIFT |
| C3 | 方法 B | 注入仅爬坡偏差的合成历史 → 归因将 ≥80% 偏差分到爬坡系数；提案变幅被 clip ±10% |
| C4 | 方法 C | cov=0.80 的样本集 → f −0.01；cov=0.97 → +0.01；边界 clip |
| C5 | 回测门槛 | 构造"改了也不准"的样本 → NO_IMPROVEMENT、零提案 |
| C6 | 生效与回滚 | 提案批准 → 参数版本+1、后续求解用新值；回滚恢复旧版本；autoApply 仅放行方法 A 小步长 |
| C7 | 防护 | 同参数一周内二次提案被 HOLD；同窗三提案只放行改善最大者 |
| C8 | 元闭环 | APPLIED 14 天后 realizedMape 回写；报告页"预言 vs 实现"渲染 |
| C9 | 端到端（=A8 T9 加强版） | 模拟时钟注入良率下滑 → C12 触发 → 方法 A 提案（含回测证据）→ 批准 → 继续 tick → MAPE 实际收敛且报告页可见全链 |
