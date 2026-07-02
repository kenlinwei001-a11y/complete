# 全前端真跑扫描 · 缺口findings（4 agent 真浏览器 + curl 取证）

> 施工合同背景。审核方派 4 子 agent 真浏览器逐页跑真后端（~60 页），按 6 类问题取证并分 依赖型/自身型。以下 WO 据此开：DATAMODE-SWEEP / RISK-FIX / QOS-DIAG / DEMO-DATA / PROVENANCE-SWEEP / UI-POLISH。

## 跨模块主题（这些 WO 的根）

### T1 合成充真成片（→ DATAMODE-SWEEP · P0 · 不作假红线）
后端已下发 `dataMode`，多处 renderer 未消费→合成数据渲染成决策级红/越线/✗裁决。KILL-MOCK-RED 只修了 4 组件，漏网点：
- **驾驶舱 metric-strip 物料保障率**：合成(SYNTHETIC)显真红「越线」`rgb(221,126,158)`+`data-decision-mode=MISS`；同页 plan-drill/problems 已正确降级(灰+「合成/估算·不作决策依据」)。根因：view-config `valuePath:"metrics"` 抽 metrics 数组剥掉顶层 dataMode；`MetricStrip` 抑制逻辑因 `m.dataMode` 恒 undefined 永不触发。**自身型**。
- **根因归因 DAG**：KPI 节点白字粉底「RED」徽标，合成未降级(`valuePath:"dag"` 剥 dataMode·ProvenanceDag 按 status 上色不感知)。**自身型**。
- **规划体检 65/100「可定稿」**：`plan_audit` dataMode=SYNTHETIC，决策评分零合成标识(唯一 caveat「演示用」是说动作不落地非说数据合成)。**自身型**。
- **方案生成**：`plan_generate` SYNTHETIC 出现金垫64亿/毛利17.4%/⛔C18硬约束红判决，合成 pill 仅 10px 极弱。**自身型**。
- **推演/project-sim/order-chain**：capacity_forecast/affected_orders SYNTHETIC 出「✗缺口35.2万套」「不建议接」红硬决策，无 risk 板那条披露横幅。**自身型**。
- 正面范式：risk 板有「合成数据·此决策基于合成数据(非真实接入)」披露横幅——应移植到所有决策页。

### T2 旗舰功能渲染失真（→ RISK-FIX · P0）
- **/v/risk 预判看板核心预测失真**：抓包证前端收到 `risk_timeline` 真值 `crossDay=3/3/4/5/13/14/18/19`(全越线)+series 上升(84→96)+`dataMode=LIVE`，却全渲染成「未越线」+火柴图 30 根等高全平+徽标「估算·无实测」(与 LIVE 冲突)。旗舰"预判"看板名存实亡。**自身型**（前端 risk-board renderer 三处丢绑定/取反）。⚠ 须自查是否 KILL-MOCK-RED 抑制逻辑对 LIVE 过度生效(=回归)。
- **/v/order-chain 采纳CTA必400**：「采纳结论→工单」提交漏 `plan_change` schema 必填 `versionId`→`VALIDATION_ERROR` 红错·不落库。唯一决策落地按钮 100% 失败。同页 `/a/v1/plan-versions/current` 可取。**自身型**。
- **/admin/object-types「看实例→」死按钮×35**：onClick 未接线·点击 no-op(3 种点法均无反应)；目标页 `/o/:typeKey/:objectKey` 本身可用。**自身型**。

### T3 QOS 编排失败（→ QOS-DIAG · P0 · 人机问答命门）
- `/b/v1/queries` 返回的测试查询 status 全 **FAILED**。查询历史页本身正常(如实渲染 FAILED)。失败根因在 QOS 编排(路径B·cockpit/sim agent)。**依赖型/越域**——这是所有人机问答(场景/意图/产能问答)的单管线，断了下游全废。

### T4 依赖型无种子数据空态（→ DEMO-DATA · P1）
共根：demo 缺 `livedIn:true` 合成作业 + 一批页需触发一次运行。前端多已诚实空态(非 bug)：
- OEE14日趋势空(oee:equip 止 06-09·14天窗0点)；运营回顾整页空(`/a/v1/history/bundle` 404·"先运行 livedIn 合成")；rule-docs/llm-providers/decisions/evals/quarantine 后端`[]`；meta 落库共0需手动 sync。

### T5 Provenance 溯源薄（→ PROVENANCE-SWEEP · P1）
- 规划6页(quarterly/annual/plan-audit/plan-generate)决策数字(现金垫/毛利/缺口/评分)多缺溯源悬浮。**4 求解器 provenance 字段=0**(后端契约缺·前端无米下锅)+前端已有 ruleRef/src 未做成悬浮。ⓘ图标死交互(plan-generate×3/plan-audit×1 hover/click 无 tooltip)。**混合型**。

### T6 布局小瑕疵（→ UI-POLISH · P2 · 自身型）
- dash 3.72屏仅3分区标题无 tab/折叠；sim-init 向导挤右上90%空白；geo-map 气泡+标签叠字碰撞；兜底统计/llm-providers 裸表头无空态；order-chain P90 `1.1615` 裸浮点。

## 诚实边界
- 扫描 D agent 二次验证撤回多个误报(图谱视角/查询历史0条/connections错字/modeling拥挤/scenes死交互)·可信度高。
- 竖排渲染 bug 是**沙盘专属**(D 扫53页无此问题)·归沙盘重构轨非本批。
- 每条 WO 的验收含**前后端一致性检查**(curl后端真值 + 真浏览器screenshot + 逐值对照)——不作假硬门。
