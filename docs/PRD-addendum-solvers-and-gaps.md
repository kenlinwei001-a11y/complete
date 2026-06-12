# PRD 增量 · 求解器真实算法规格 + 四项缺口补全

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量文档：修订 平台 PRD v2.0 与 QOS-PRD v1.0 的指定章节，其余不变） |
| 修订对象 | ① 平台 PRD §7.6 的 Mock 求解器与 B7 → 替换为本文 §S1 的真实算法规格；② QOS-PRD"范围外"的 Action 审批 → 本文 §S2 规格化（落 DataCore）；③ 平台 PRD §2.1 schedule.cron 的调度器 → §S3；④ 平台 PRD §1.3 VectorIndex 预留 → §S4 给出本期消费方 |
| 算法来源 | 全部公式逐条提取自原型 HTML 的实际实现（提取位置以原型函数名标注），保证"复刻 demo 推演能力"的口径一致 |

**通用约定**：本文所有数值常数（系数/阈值/降幅）默认进入**场景包配置**（`solverParams` JSONB），代码中不得写死；下文给出的值即 battery-manufacturing 场景包的默认值。所有求解器保持 QOS-PRD §7.1 的统一形态：确定性（同输入+同参数版本 → 同输出）、入参含本体切片快照、出参含中间量（供逐级下钻溯源）。

---

## S1 · 求解器规格（替换 Mock 层）

### S1.1 `capacity_rollup` · 产能逐级聚合（原型：聚合求解器公式声明）

```
设备产能/h = (3600 / 节拍CT_s) × 可用时间系数 × OEE          OEE = A×P×Q
工序产能   = 设备产能 × 良率 × 人力可用系数                   人力 = 班次时长×出勤率×利用率
            串行段取 min(各工序)；并行段取 Σ通道（化成=通道数×单通道产出；老化=库位数/老化天数）
产线产能   = min(串行段) ⊕ 并行段汇合（正负极两线取较慢者决定汇合节拍）
工厂/基地  = Σ产线（受共享资源封顶：化成柜/老化库总量）
```

- 输入：本体切片（产线→工序→设备 + 节拍/OEE/良率/工时实例值）。输出：四级产能 + 每级 `{formula, inputs[]}` 中间量。
- 引用规则：C01（≤设计上限）、C02（串/并口径）。
- 周产能换算（原型 `baseWeeklyW`）：`周产能(万套) = 基地日产能(电芯) × 7 ÷ 单PACK电芯数 ÷ 10000`。

### S1.2 `capacity_forecast` · 型号产能预测（原型：`pmCalc`/`cumCapP50`/`curveMult`/`healthP90`）

**输入**：`{ modelId, qty(万套), weeks }` 或分批 `{ modelId, batches: [{qty, dueDate, address}] }`。

**算法**（逐条对应原型实现）：

1. 可产基地 = 本体中该型号已认证（含认证中）产线所在基地；**认证系数** `certFactor`：产线状态=认证中 → **0.6**，已量产 → 1.0（来源 PLM 认证关系边属性）。
2. **周曲线系数** `curveMult(b, w)`：
   - 爬坡：`w ≤ 4 → 0.88 + 0.03×(w−1)`（即 0.88/0.91/0.94/0.97），`w ≥ 5 → 1.0`；
   - 检修窗：`w = maintWeek(b) → ×0.72`（检修周取自基地检修计划对象；原型用 hash 模拟第 3–10 周）。
3. **P50 累计**：`P50 = Σ_{基地} Σ_{w=1..weeks} 周产能(b) × certFactor(b,m) × curveMult(b,w)`。
4. **P90 = P50 × 健康度系数 f**：默认 **0.93**；任一关键数据源（IoT/SCADA）新鲜度延迟 > 2h → 降级 **0.90**（规则 C09，输出需附降级说明文本）。
5. **判定**：整单模式 `gap = qty − P90，ok = gap ≤ 0`；**分批模式**：批次按交付日升序，每批净生产窗口 `wkEff = max(1, floor((dueDay − 物流时长(地址))/7))`（物流时长查物料/物流域地址表），逐批校验 `累计需求 ≤ 累计P90(wkEff)`，`gap = max(各批缺口, 0)`，`ok = 所有批通过`。
6. **主瓶颈**：对每个可产基地取 S1.3 紧张度最高的因素，全局 `mainBn = argmax tightness`。
7. **What-if 调参**（场景求解器交互；原型 `wfAdjusted`）：`调整后P50 = P50 × (1 + 0.06×夜班数 + 0.05×扩化成通道数) + qty × 外协比例`；约束：调整后 ≤ 物理上限（C03）、外协比例 ≤ 20%（C08，超限拒绝该参数组合）。
8. **输出**：`{p50, p90, healthFactor, gap, ok, perBaseRows[{base, weeklyCap, certFactor, maintWeek, bottleneck, tightness, cumTotal}], batchRows?, mainBn, pendingCertList}` —— perBaseRows 即前端逐基地下钻表的数据契约。

### S1.3 `bottleneck_matrix` · 多维瓶颈定位（原型：`bnTight`/`BN_FACTORS`/`BN_PRIMARY`）

- 7 因素固定枚举：瓶颈工序 / 设备OEE / 人力工时 / 物料齐套 / 物流时长 / 换型损失 / 良率波动。输出 `基地 × 因素` 紧张度 0–100 矩阵 + 每基地主瓶颈（行内 ◉）。
- **生产口径**（规格目标）：紧张度 = 各因素真实指标归一化映射——瓶颈工序=约束工序利用率；设备OEE=OEE 缺口率；人力工时=可用工时缺口率；物料齐套=缺料紧张度(1−齐套率归一)；物流时长=在途延迟风险；换型损失=换型时间占比；良率波动=良率损失率。映射函数 `normalize(指标)→0..100` 进场景包配置。
- **Mock 口径**（数据未接入时的降级实现，与原型一致，保证 demo 可复现）：`seed=(base首字符码+因素首字符码×7) mod 9`；主因素 `min(97, 88+seed%9)`；非主因素 `min(83, 55+seed+(利用率>82?6:2))`。主因素表 BN_PRIMARY 由场景包配置。
- 两种口径以 `dataMode: "LIVE"|"MOCK"` 标注在输出中，前端据此显示数据来源徽章。

### S1.4 `risk_timeline` · 风险时序推演引擎（原型：`riskVal`/`riskEvents`/`riskTarget`/`buildRiskCards`）

**核心公式**（基线爬升 + 事件脉冲，逐日 d=1..H）：

```
tension(b,f,d) = cur + (tgt − cur) × min(1, d / (0.72×H)) + Σ_{事件e} pulse(e,d)
pulse(e,d)     = |d−e.d| ≤ 3 ? e.amp × ps × (1 − |d−e.d|/4) : 0
ps             = max(0.25, 1 − (v−68)/45)          // 高位脉冲衰减（v 为叠加前的当日值）
tension        ← min(98, round(tension))
cur = bottleneck_matrix 当日紧张度；tgt = 窗口目标位（生产口径=负荷外推；mock 口径=原型 riskTarget hash）
越线阈值 = 85；越线日 = 首个 tension ≥ 85 的 d
```

**事件生成**（事件是一等对象，来自本体，amp 为默认配置值）：

| 事件类型 | 触发日 d | amp | 作用因素 | 来源 |
|---|---|---|---|---|
| 检修窗口 | `maintWeek(b)×7 − 3` | 14 | 设备OEE / 瓶颈工序 | EAM/CMMS 检修计划 |
| 交付高峰 | 各订单 dueDay（仅可产该基地的订单） | 9 | 瓶颈工序 / 人力工时 | S&OP/ERP 订单交期 |
| 到货间隙 | 自首期起每 14 天周期末端 | 10 | 物料齐套 / 物流时长 | WMS/ERP 采购批次 |

**看板派生**（`buildRiskCards`）：对每个基地，遍历非主瓶颈因素中当前 <85 者，计算窗口内峰值与越线日；有越线者入卡，按越线日升序取前 8；卡内受影响订单 = S1.5。
**处置方案消解**：方案库（按因素 3 案，含 `峰值降幅 eff / 起效 T+n / 成本 / 风险`，场景包配置）；采纳方案 → 自 T+n 日起 `tension ← tension − eff`，曲线重算并与原曲线并排返回（前端画消解对比）。

### S1.5 `affected_orders` · 受影响订单（原型：`riskOrders`/`tlOrders`）

`订单可产基地包含 b ∧ dueDay ∈ [day−7, day+14]`，按交期升序；每单附延误天数估计 `delay = max(1, round((tension峰值−85)/8) + 抖动)`（生产口径换为排产仿真，mock 口径保留 hash 抖动）。时序传导版本（体检/建议共用）：支持业务条件过滤器（如"毛利<线的单"），命中为空时回退为窗口内交期最近 max 单。

### S1.6 `plan_audit` · 规划体检（原型：`runAuditDiag`，确定性规则诊断，**非 LLM**）

**输入**（计划字段，前端表单或 S&OP 版本对象）：`{ dem, seg_pas, seg_ess, seg_com, sup, ltaCov(%), kitGap(吨), gmTarget(%), cashCushion(亿), capex(亿) }`。
**输出三段**：硬矛盾 H[] / 软风险 M[] / 建议修正 S[]，每条 `{id, title, ruleRef?, why(含代入数值的解释文本), fix?{label, patch}}`；fix.patch 为对输入字段的修正量（前端"一键应用"），实际生效仍走 Action 审批。

**诊断规则表**（阈值=默认配置）：

| ID | 判定 | 硬 | 软 | 规则 | fix |
|---|---|---|---|---|---|
| X01 细分自洽 | `|Σ细分 − dem| > 0.5` | ✓ | — | — | 按 dem 比例缩放细分 |
| X02 产销缺口 | `dem − sup > 2` / `> 0.3` | >2 | (0.3,2] | — | 夜班+加急采购的供给增量包 |
| X03 毛利结构 | `gmStruct = w_pas×18% + w_ess×13% + w_com×15%`（细分毛利率来自应用细分对象）；`gmTarget > gmStruct+0.3` / `> gmStruct−0.5` | 超上限 | 贴上限 | C15 | gmTarget ← gmStruct |
| X04 物料齐套 | `kitGap > 800` / `> 0` | >800 | (0,800] | C06/C16 | 加急采购 200 吨 |
| X05 现金垫 | `cashCushion < 50` / `< 55` | <50 | [50,55) | C18 | CAPEX 缩减/推后 |
| R01 结构偏离 | `|w_ess − 基线占比| > 0.05` | — | ✓ | C21 | — |
| R02 CAPEX 门槛 | `capex ≥ 10` | — | ✓ | C23 | 引导年度情景测算 |

**体检评分**（原型导出有 score 但未给显式公式，本规格定义为）：`score = clamp(100 − 25×|H| − 8×|M|, 0, 100)`；结论档位：≥85 通过 / 60–84 有条件通过 / <60 不通过。每条硬/软项可展开"时序推演"（调 S1.4 同构传导：事件窗→越线→波及订单(S1.5)→财务指标击穿）。

### S1.7 `plan_generate` · 规划建议（五路径→三方案；原型：`GEN_PATHS`/`genPathOutcome`）

**路径库**（场景包配置，每路径效果系数作用于经营基线 `base={rev, gm, share, turns, cash}`）：

| 路径 | rev× | gm± | share+ | capex | turns± | cash± |
|---|---|---|---|---|---|---|
| A 保毛利型 | 1.12 | +1.4 | +6 | 0 | +0.6 | +6 |
| B 保规模型 | 1.22 | −0.8 | +16 | 2 | −0.4 | −4 |
| C 扩产型 | 1.20 | +0.2 | +22 | 27 | −0.2 | −12 |
| D 外协型 | 1.16 | −0.5 | +12 | 0 | +0.2 | +2 |
| E 混合型 | 1.18 | +0.4 | +14 | 14 | +0.3 | −2 |

**结果测算**：`rev=base.rev×eff.rev; gm=base.gm+eff.gm; cash=base.cash+eff.cashD; …`。
**硬约束**（目标面板可调，hard 标志可开关）：毛利底线（C15）、现金垫底线（C18）、CAPEX 上限；违反者入 `hardViol[]`（方案标 ⛔ 但仍展示，注明解锁条件）。
**五维评分**（0–100 clamp）：

```
盈利 = 50 + (gm − gmFloor) × 22        规模 = 40 + shareGrow × 3
现金 = 50 + (cash − cashFloor) × 4     增长 = 30 + revGrowAbs × 2.5
稳健 = 90 − capex × 2.2
total = round(五维均值) − 15 × |hardViol|，clamp ≥ 0
```

**三方案**：稳健（路径 A）/ 均衡（路径 E）/ 进取（路径 C 或 B，取 total 高者）固定映射 + 各自的问题清单与传导链（场景包配置）；**推荐 = hardViol 为空者中 total 最高**。输出含雷达五维、取舍矩阵（每方案的 gain/give 字段）、每方案问题的时序推演（S1.4 同构）。系统只算路径与后果，**不自动决策**——采纳动作走 Action（§S2）。

### S1.8 `sop_balance` · S&OP 月度平衡（原型：`buildSOP`/`sopStep1..5`）

落地形态 = **一个 Workflow 模板（五步）+ 月度计划版本对象**，每步绑定确定性计算：

| 步 | 计算/校验 | 公式 |
|---|---|---|
| ①产品评审 | 可产矩阵变更清单（认证转量产/爬坡/EOL）→ 供给可行域边界 | 来自 PLM 认证关系边属性 diff，量化每条变更的 万套/月 影响 |
| ②需求评审 | 三线对照（目标/滚动P50/上月实际），按应用细分 | `dv = (roll−tgt)/tgt`；`|dv|>10% → C21 提报项自动写入第⑤步议程`；合计行同口径 |
| ③供应评审 | `sup = Σ基地(周产能×curveMult×certFactor)`（即 S1.2 的月聚合）+ 已决议增量项 | 缺口 `gap = dem − sup`，>2 万套标红 |
| ④财务整合 | `毛利率_roll = gmΣ/revΣ` vs 预算；现金垫 C18 校验 | 不通过 → 阻断进入⑤ |
| ⑤高管决策会 | 议程 = ②的 C21 项 + ③的缺口对策 + ④的越线项；决议 = 供给增量项列表（如 常州夜班 +1.2/江门加急 +0.5） | 决议追加进 sup 重算 → 定稿 |

**版本状态机**：`DRAFT → IN_REVIEW(步①–④) → EXEC_MEETING(⑤) → FINAL(定稿，C22 锁定)`；定稿后任何字段变更必须走"计划变更 Action"（§S2），禁止直改（API 层 409 `PLAN_LOCKED`）。版本快照含五步各自的输入输出与决议留痕。

---

## S2 · Action 审批流规格化（DataCore 侧，补 QOS-PRD 范围外）

### S2.1 状态机

```
DRAFT ──submit──▶ PENDING_APPROVAL ──step全过──▶ APPROVED ──出队──▶ EXECUTING ──▶ EXECUTED
                        │  │                                            └─失败重试×3─▶ EXECUTION_FAILED
                        │  └─任一步 reject─▶ REJECTED
                        └─发起人/管理员─▶ CANCELLED（EXECUTING 前任意态可取消）
```

### S2.2 模型

```ts
interface ActionDraft {                 // ID 前缀 act_
  id: string; tenantId: string;
  actionTypeKey: string;                // 引用本体 Action 类型（参数 schema/校验规则/审批链在类型上）
  payload: Record<string, unknown>;     // 全参数快照，提交后不可变
  origin: { taskId?: string; agentId?: string; userId: string };   // 来源链（QOS 任务/agent/人）
  status: ActionStatus;
  approvalSteps: { seq: number; role: string; approverId?: string;
                   decision?: "APPROVE"|"REJECT"; comment?: string; decidedAt?: string }[];
  executionResult?: { ok: boolean; targetRef?: string; error?: string; attempts: number };
  createdAt: string; updatedAt: string;
}
```

- **审批链**定义在 ActionType 上：`approvalChain: { role: string }[]`（1–3 级，顺序审批，不做会签）；提交时按链实例化 steps。
- **提交校验**（C10）：参数 schema（zod）+ 规则引擎预检（ActionType.checkRules）+ 审批链非空 + **发起人不得位于审批链可自批位置**（同人到步 → 该步自动跳给同角色其他人，无人则提交失败 `NO_ELIGIBLE_APPROVER`）。
- **执行**：APPROVED → outbox 表 → 写回适配器（接口 `ActionExecutor.execute(draft)`；本期实现 Mock 适配器=标记成功 + 生成 targetRef 如 `MO-2026-xxxx`）；失败指数退避重试 3 次 → EXECUTION_FAILED + 事件告警。
- **事件**：`action.pending_approval`（@每步流转，通知该角色）/ `action.approved` / `action.rejected` / `action.executed` / `action.execution_failed`，进 outbox webhook（平台 PRD C-2 机制）。

### S2.3 API（DataCore，前端 /admin/actions 即消费此组）

```
POST /a/v1/action-drafts                     创建（QOS 的 create_action_draft 即调此端点）
POST /a/v1/action-drafts/{id}/submit         DRAFT→PENDING（独立于创建，允许暂存草稿）
GET  /a/v1/action-drafts?status=&role=mine   列表（"待我审批"= steps 当前步角色 ∈ 我的角色）
POST /a/v1/action-drafts/{id}/approve        Body { comment? }   仅当前步角色可调，409 INVALID_STEP
POST /a/v1/action-drafts/{id}/reject         Body { comment }    必填意见
POST /a/v1/action-drafts/{id}/cancel
GET  /a/v1/action-drafts/{id}/audit          全程留痕（快照+每步决策+执行结果）
```

---

## S3 · 调度器组件（补 connections.schedule.cron 的触发方）

- **归属**：DataCore 内部组件 `SchedulerService`（非独立服务）；AgentCore 用同一实现（contracts 包内共享代码）调度自己的定时 workflow。
- **机制**：表 `scheduled_jobs { id, tenant_id, kind, ref_id, cron, timezone, next_run_at, last_run_at, status(ACTIVE|PAUSED), last_error }`；tick 循环每 30s：`SELECT … WHERE next_run_at <= now() AND status='ACTIVE' FOR UPDATE SKIP LOCKED` → 投递 `QueueAdapter` → 计算下次 next_run_at（cron 解析用 `cron-parser`）。SKIP LOCKED 保证多副本部署安全；任务执行幂等键 = `(jobId, scheduledAt)`，重复投递去重。
- **本期消费方（kind 枚举）**：`CONNECTOR_SYNC`（创建/更新连接时自动注册/注销 job）、`DERIVATION_FULL`（派生管线定时全量，租户级默认每日）、`RULE_SCAN`（持续监测类规则扫描，默认每小时）、`WORKFLOW_RUN`（AgentCore：定时 workflow，service-account 身份执行，遵守 §6.3 Q1 例外条款）。
- **API**：`GET /a/v1/scheduler/jobs?kind=`、`POST /a/v1/scheduler/jobs/{id}/pause|resume`、`GET /a/v1/scheduler/jobs/{id}/runs`（执行历史，最近 50 条）。
- 误差容忍：调度精度分钟级即可；错过的窗口（停机期间）不补跑，记 `MISSED` 历史。

---

## S4 · VectorIndex 本期消费方（pgvector 不再纯预留）

### S4.1 知识库连接器语义检索（主消费方）

- `knowledge_base` 连接器（平台 PRD §2.1 已注册类型）补全实现：同步文档（md/txt/pdf/docx，复用 A2 的文本抽取）→ 分块（约 512 token，重叠 64）→ `EmbeddingProvider.embed()` → pgvector 表 `kb_chunks { id, tenant_id, conn_id, doc_id, chunk_text, span, embedding vector }`。
- **新增内置工具 `search_knowledge`**（sideEffect=READ，进 QOS-PRD §7.1 注册表与路径 B 白名单）：入参 `{ query: string, topK?: number≤10, connId?: string }`；出参 `{ hits: [{ text, score, docId, span, source }] }`——hit 即可作为回答的 ProvenanceRef 来源（`source:"KB_CHUNK"` 扩展枚举）。权限：kb 连接器同样挂 PermissionPolicy，检索在 SQL 层带租户+策略条件。
- **EmbeddingProvider 接口**：`embed(texts: string[]): Promise<number[][]>`；本期默认实现为确定性哈希伪向量（管线/测试可跑通），生产 embedding 模型（如 Voyage 等）由部署方实现该接口并经环境变量切换——**不在本期范围**，但接口与表结构按真实维度（可配置，默认 1024）设计。

### S4.2 次级消费方（小成本顺带实现）

1. **规则候选去重**（A2 管线增强）：候选规则 `name+expression` embedding 化，与已发布规则相似度 > 0.92 → 审核界面标"疑似重复"并并排展示既有规则。
2. **QOS 兜底语义聚类**：`fallback_traces.normalized_query` 增加 embedding 列；`/ops/fallback-stats` 的聚类从字符串规范化升级为"规范化 + 向量近邻合并（相似度>0.9 归簇）"，提升孵化候选质量。意图分类的 kNN 检索增强**不在本期**（仅留数据基础）。

---

## S5 · 验收用例增量（自动化）

| # | 用例 | 预期 |
|---|---|---|
| V1 | capacity_forecast：4680-NCM、40 万套、6 周（种子数据） | P50 = 按 S1.2 公式手算值（测试内独立实现公式比对）；含认证中基地 0.6 系数与检修周 0.72；P90=P50×0.93 |
| V2 | 数据健康度降级：标记 IoT 延迟 4.2h | 同输入 P90 系数变 0.90，输出含降级说明 |
| V3 | 分批模式：3 批含一紧批 | 紧批 `wkEff` 扣物流正确；逐批累计校验，gap=max |
| V4 | what-if：夜班2+通道4+外协10% | 调整后 P50 公式精确；外协 25% → C08 拒绝 |
| V5 | risk_timeline：常州·物料齐套 H=30 | 逐日曲线与公式一致；到货间隙事件每 14 天叠加；越线日=首个 ≥85；采纳"提前备料"方案后峰值 −12 且越线消失/推迟 |
| V6 | plan_audit：构造五硬两软的输入 | H/M 条目、why 文本数值代入、fix.patch 正确；score=100−25×5−8×2 clamp 后=0 → 不通过 |
| V7 | plan_generate：默认目标 | 路径 C 触发 CAPEX 上限 hardViol；推荐=无违规中 total 最高（默认数据下为 E）；五维分逐项比对 |
| V8 | sop_balance：商用车滚动偏差 −11.8% | C21 自动写入第⑤步议程；④现金不达 → 阻断⑤；定稿后改字段 → 409 PLAN_LOCKED |
| V9 | Action 全链：QOS 采纳方案 → 草稿 → 二级审批（第 2 步 reject） | 状态机流转、发起人不可自批、reject 必填意见、审计完整；approve 路线走到 EXECUTED（Mock 适配器）且 outbox 事件齐全 |
| V10 | 调度器：注册 cron 每分钟的 CONNECTOR_SYNC | 双副本并发只执行一次（SKIP LOCKED）；pause 后不再触发；MISSED 记录 |
| V11 | search_knowledge：上传 3 篇文档后检索 | topK 命中带 span 与 score；无权限的连接器内容不出现；路径 B 中 agent 可调用并在回答中引用为溯源 |
| V12 | 规则去重：上传与已发布规则语义相同的文档 | 候选标"疑似重复"并关联既有规则 ID |
