# 审计 · 假值残口清剿（KILL-MOCK-RED 红线·系统性 sweep）

> 日期 2026-07-03 · 分支 `claude/vigilant-knuth-b1nmxn` · 触发：用户「需要做实 sweep」（断"提议≠落实"病根）
> 方法：4 子代理按同一判据分区穷扫（solvers / datacore 非-solver / agentcore / frontend）→ 审核方**逐簇读真码复核**。
> 判据：**F1** 常数乘子冒充分位/置信 · **F2** 内联业务常数冒充真值(R14) · **F3** 合成/启发式无披露充真 · **F4** hash/确定性噪声冒充真测量。
> 排除（丙档·诚实）：明标 MOCK/SYNTHETIC/PARTIAL/PROVISIONAL、物理常数/单位换算、声明式 synthetic 生成器本体、测试夹具、明标"估算/近似"且披露者。

---

## 1. 统一根因（一句话）

**平台已修好「数据真假门」（KILL-MOCK-RED：dataMode/live 诚实位、真产能源替代 `基地×700`、无真源诚实空态），但门下面那层「量化具体值」仍在造假——甚至在 `dataMode:LIVE` 的卡上。** 即：
- 「**是否红 / 是否有数据**」现在是真的（红线已修）；
- 但「**红到多少 / 何时穿越 / 齐套率几 % / P90 是多少 / 越用越准的曲线**」很多仍是 `p50×常数` / `名字 hash % N` / 手植曲线，且**带真实数据源标签**（WMS/ERP/EAM），无 MOCK 披露。

这是「绿测试≠能用」的同构病在**数值层**的残留：决策的**方向**修了，决策的**数字**还在编。

## 2. 审计表（confirmed·按根因分簇）

验证列：`读码✓`=审核方亲读真码确认 · `代理·待运行复验`=子代理报告、待起服务运行时逐值再验。

### 簇 A · 「P90 伪分位」家族（F1·`value × 常数` 冒充 90 分位）——**一根多site**
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO |
|---|---|---|---|---|---|---|
| A1 | `solvers/capacity.ts:260` | `p90 = p50 * healthFactor(0.93/0.9)` | 缺口裁决 | 读码✓ | P1 | METHOD-MC |
| A2 | `solvers/capacity.ts:275` | 批次 `cumP90 = cum * healthFactor` | 批次 rowOk | 读码✓ | P1 | METHOD-MC |
| A3 | `solvers/capacity.ts:311` | what-if `adjP90 = adjusted * healthFactor` | whatIf.ok | 读码✓ | P1 | METHOD-MC |
| A4 | `solvers/service.ts:2336/2350` | 校准 `predictedP90 = daily/total * healthFactor` | 污染 MAPE 配对 | 读码✓ | P1 | METHOD-MC |
| A5 | `solvers/service.ts:1137` | order_fullchain `p90 = producibleWeekly * 0.9` | 交期"可达/紧张"裁决 | 读码✓ | P0 | METHOD-MC(扩) |
| A6 | `sop.ts:150` | 需求滚动 `p90 = rolling * 0.936` | S&OP P90 列 | 读码✓ | P1 | METHOD-MC(扩) |
| A7 | `vle-oracle.ts:191` | 参考 oracle `p90 = p50 * healthFactor` | 双算自证伪 P90 | 代理·待运行复验 | P2 | METHOD-MC(扩) |
| A8 | `calibration/replay.ts:120` | coverage 阈 `pred * healthFactor` 当 P90 | QUANTILE 提案通过/否 | 代理·待运行复验 | P2 | METHOD-MC(扩) |
| A9 | `calibration/metrics.ts:23` | `coverageOf` over `predictedP90`(=伪) | 校准报告 coverage | 代理·待运行复验 | P2 | METHOD-MC(扩) |
| A10 | `seed.ts:385` | demo `predictedP90 = predicted * healthFactor` | 覆盖率度量 | 代理(披露borderline) | P2 | METHOD-MC(扩) |

> **A5/A6 是 NEW（不在原 MC 单 scope）·A7–A10 是同根下游消费者。** METHOD-MC-STOCHASTIC 需从"改 capacity+service 两处"扩为"P90 伪分位家族一次清剿"（真分位替代所有 `×常数` P90，下游 replay/metrics/seed 随真分位自动变真）。

### 簇 B · `risk.ts` 轨迹+事件具体值哈希造假（F4·带**假源归因**·LIVE 卡上仍造）——**洛阳假红的残留层**
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO |
|---|---|---|---|---|---|---|
| B1 | `solvers/risk.ts:284` | `riskTarget lift = (名首码+因子首码)%mod+base` | 轨迹 TARGET→`crossDay` 穿越日 | 读码✓ | P0 | RISK-TRAJECTORY-DEFAKE |
| B2 | `solvers/risk.ts:262` | `kit = 70 + hash(baseId:kit)%12` → "物料齐套率 {kit}%" 标 src=WMS/ERP | 事件卡 | 读码✓ | P1 | RISK-TRAJECTORY-DEFAKE |
| B3 | `solvers/risk.ts:242` | `oee = 4 + hash(baseId:oee)%5` → "OEE 下调 {oee}pt" 标 src=EAM/CMMS | 事件卡 | 读码✓ | P1 | RISK-TRAJECTORY-DEFAKE |
| B4 | `solvers/risk.ts:241/254/261/272-273` | 整簇 `hn()`：停机天/负载/覆盖天/在途批 全 hash·全标真源 | 事件卡具体值 | 读码✓ | P1 | RISK-TRAJECTORY-DEFAKE |
| B5 | `solvers/risk.ts:928` | `baseCredit = base + hash(cust\|so)%mod/100` → "信用占用比 X 超额度 1.0" | 信用阻断根因裁决 | 代理·待运行复验 | P1 | RISK-TRAJECTORY-DEFAKE |
| B6 | `solvers/risk.ts:256` | 工时 `qty * 1.6` 内联系数 | 事件描述 | 读码✓ | P2 | RISK-TRAJECTORY-DEFAKE |
| B7 | `solvers/risk.ts:698` | per-order `delay` 带 `hash(so)%jitterMod` | 受影响订单延误天 | 代理·待运行复验 | P2 | RISK-TRAJECTORY-DEFAKE |
| B8 | `solvers/risk.ts:22` | severity 阈 92/78 + 加成 12 内联·注释诡称"域参数" | HIGH/MED/LOW | 读码✓ | P1 | RISK-TRAJECTORY-DEFAKE |
| B9 | `solvers/risk.ts:129` | tension 常数 62/70/0.6/0.8/40 内联·兄弟 liveTightness 从 params 读·emit live=true | 过阈 85 | 代理·待运行复验 | P2 | RISK-TRAJECTORY-DEFAKE |

> **B 簇要害**：KILL-MOCK-RED 修了**基线**（红/不红只在真数据 live=true），但**轨迹目标(B1)+事件具体值(B2-B4)**在 LIVE 卡上仍 hash 造，且 `EVENT_SRC` 主动标"WMS/ERP/EAM"=**假源归因**（比无披露更坏——它谎称来自真系统）。crossDay/齐套率/OEE 下调全是编的。

### 簇 C · 校准「越用越准」曲线造假回退（F3/F4·真引擎+假回退·UI 无 SYNTHETIC 标）— ✅ 已闭（WO-CALIB-HONEST-EMPTY）
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO | 治本 |
|---|---|---|---|---|---|---|---|
| C1 | `calibration/service.ts:226` | 无历史回退 `mape = 11.2 - i*0.32 + 噪声` 线性下降 | 收敛看板"越用越准" | 读码✓ | P1 | CALIB-HONEST-EMPTY | ✅ 静态基线常数 `BASELINE_STATIC_MAPE=11.2`（水平线·无 i 衰减/噪声）+ 报告 `baselineOnly` 标 |
| C2 | `livedin/engine.ts:150` | 部署态 `mape = 7 + 5*exp(-(w-1)/16) + rebound` 手画 52 周 | bundle.mapeSeries | 读码✓ | P1 | CALIB-HONEST-EMPTY | ✅ 曲线保留（确定性合成回放走正门）但 `bundle.synthetic=true`·前端"合成演示·非真实学习"徽章 |
| C3 | `livedin/engine.ts:799` | `realizedMape = simulatedAfter + 0.3` 自证 | 元环"预测 vs 实现"真值 | 读码✓ | P1 | CALIB-HONEST-EMPTY | ✅ 改取合成序列生效 2 周后真实点 `mapeAt(week+2)`（对真序列·非自证 +0.3） |
| C4 | `synthetic/service.ts:371/385` | PENDING 提案 evidence `nPairs:168,mapeBefore:11.2,after:8.9,bias` 手填 | 校准审批 UI 决策证据 | 读码✓ | P1 | CALIB-HONEST-EMPTY | ✅ 证据保留但 `proposal.synthetic=true`+`evidence.synthetic=true`·前端 SYNTHETIC 徽章 |
| C5 | `livedin/engine.ts:772/796` | `simulatedAfter = before - 手填improvement` / `bias = 交替确定值` | 提案 evidence | 读码✓ | P2 | CALIB-HONEST-EMPTY | ✅ 同 C4：seeded 提案 `synthetic=true`（叙事内自洽·标合成边界） |
| C6 | `seed.ts:373` | demo 收敛 `actual = predicted*(1-bias)` 反解(手填 BIASES) | 收敛线 25→13.6→5.3 | 读码✓ | P2 | CALIB-HONEST-EMPTY | ✅ 走正门（确定性合成观测→真引擎算 MAPE·非绕引擎手画）·码注披露 demo 边界·UI 标由全局 synthetic watermark 覆盖 demo 租户 |

> **簇 C 治本口径**：校准引擎真（有真 pair→真算 MAPE）·**无真 pair 不造下降线**（C1 静止 + baselineOnly）·**demo/部署合成回放走正门但标 SYNTHETIC**（C2 bundle.synthetic / C4-C5 proposal.synthetic+evidence.synthetic）·**realizedMape 对真序列非自证**（C3 mapeAt(week+2)）。看 demo「越用越准」的人现在分得清"真学会"（LIVE·真 pair）vs"脚本画"（SYNTHETIC 徽章）。前端牙齿 `test/calib-honest-empty.test.tsx`（review-synthetic-badge / calib-baseline-only / calib-synthetic-*·摘条件即红）。

> **C 簇要害**：校准**引擎是真的**（有真 pair 时 210-212 真算 MAPE），但**无真 pair 时回退造一条漂亮下降线**（C1 线性 / C2 指数 / C4 手填 evidence），**UI 无 SYNTHETIC 标**→ 看 demo「越用越准」的人分不清"真学会了"还是"脚本画的"。与我此前判 CALIB-CONVERGENCE-UI DONE 不矛盾（当时有 demo seed 真 pair），但回退/部署 demo 路径造假需诚实标。

### 簇 D · 前端沙盘 hash 造 baseSnapshot（F4·推演从伪状态起）— ✅ 已闭（WO-SIM-REAL-SNAPSHOT）
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO | 治本 |
|---|---|---|---|---|---|---|---|
| D1 | `views/sim/SandboxView.tsx:62` | `row[v] = hash01(oid\|v)*100` → tick0 世界态 POST 为 baseSnapshot(592) | 节点热度红≥70·全下游 tick | 读码✓+真跑双证 | P1 | SIM-REAL-SNAPSHOT | ✅ `deriveBaseSnapshot` 取 view-config `nodeObjectState`(=后端 `obj.props` 命中 stateVar 的数值)·无真值诚实退 0(不 hash) |
| D2 | `views/sim/SimInitWizard.tsx:46` | 同款 hash 造 baseSnapshot(141) | 世界完整度环·precheck | 读码✓+真跑双证 | P1 | SIM-REAL-SNAPSHOT | ✅ 同 D1（两处 deriveBaseSnapshot 同构改真属性态） |
| D3 | `views/sim/SimComparePanel.tsx:82/88`·`SandboxView:889` | 热度阈 70 内联 + 输入本身 hash 派生 | 多情景对比红 | 读码✓+真跑双证 | P2 | SIM-REAL-SNAPSHOT | ✅ 阈 70 归口权威 `DEFAULT_SANDBOX_HEAT_THRESHOLD`(sim/certification.ts)→view-config `heatThreshold` 下发·前端消费(兜底 `DEFAULT_HEAT_THRESHOLD`)；输入 hash 随 D1 消除 |

> **D 簇要害**：推演沙盘的**初始世界态**是"对象 id 取 hash → 0-100"，不是后端真实对象属性；整个 what-if 从伪状态起跑。治本：baseSnapshot 取后端真对象当前属性态。
> **✅ 治本落实（WO-SIM-REAL-SNAPSHOT）**：契约 `SandboxViewConfig += nodeObjectState/heatThreshold`；datacore view-config 从真 `obj.props` 采数值型 stateVar 属性(缺省=诚实空)；两处 `deriveBaseSnapshot` 逐值取真属性态、无真值退 0。**FDE 双证**(`docs/evidence/SIM-REAL-SNAPSHOT-fde.md`)：真浏览器 mock baseSnapshot 逐值=nodeObjectState(obj_a1.s1=62≠hash 77)+UI KPI 逐值对账；真后端 curl demo `nodeObjectState:{}` 诚实空(493 真对象 id·旧码全 hash 成伪世界→新码诚实空态零造假)。牙齿 sandbox-view.test.tsx(回退 hash 即红)。

### 簇 E · 前端客户端重算绕后端权威 + 内联常数（F2/F4·`debattery-allow` 白名单漏网）
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO |
|---|---|---|---|---|---|---|
| E1 | `views/DashboardView.tsx:209/217` | 后端 marginLedger 缺→客户端重算 gmRate 用内联 `{price:0.6,margin:13}`·无"估算"标 | 综合毛利率 KPI | 代理·待运行复验 | P1 | FRONTEND-VALUE-AUTHORITY |
| E2 | `views/sim/SopBalanceView.tsx:296/25` | `revAttain = revSum/内联 revBudget240` 自算·后端已有权威 revAttainPct | 收入达成率 | 代理·待运行复验 | P1 | FRONTEND-VALUE-AUTHORITY |
| E3 | `views/plan/QuarterlyRollingView.tsx:128` | LTA 偏差阈 5% 内联·驱动红+提报徽标 | 升级裁决 | 代理·待运行复验 | P1 | FRONTEND-VALUE-AUTHORITY |
| E4 | `views/plan/OrderChainView.tsx:34/360` | 库存占营收系数 coef 内联(debattery-allow) + 瓶颈阈 `?? 85` | 占用资金/瓶颈色 | 代理·待运行复验 | P2 | FRONTEND-VALUE-AUTHORITY |
| E5 | `views/sim/SopBalanceView.tsx:343` | 毛利容差 0.5pp 内联 | 毛利红 | 代理(披露) | P2 | FRONTEND-VALUE-AUTHORITY |
| E6 | `views/DashboardView.tsx:800` | 三线偏差 `缺口=需求−供给` 客户端自算·绕后端 gap | 偏差条 | 代理(披露) | P2 | FRONTEND-VALUE-AUTHORITY |
| E7 | `views/plan/GeoMapView.tsx:22` | 12 基地名→坐标静态表(debattery-allow) | 地图落点(非决策) | 代理·待运行复验 | P3 | FRONTEND-VALUE-AUTHORITY |

> **E 簇要害**：多处 `// debattery-allow` 把内联业务常数**白名单放行**过了 `debattery:check` 门——门被自己开的后门绕过。且前端在后端权威值缺失/存在时**客户端重算**（gmRate/revAttain/gap），绕开单一真相源。

### 簇 F · agentcore 编排骨架 lineage 常数（F2·可解释性 trace 冒充真血缘）✅ 已闭
| # | file:line | 造假 | 触达决策 | 验证 | 严重 | WO |
|---|---|---|---|---|---|---|
| F1 | `router/orchestration-skeleton.ts:55` | ~~内联 base/line/型号/工序/求解器/agent 名(4680/化成/老化/聚合求解器…)~~ **✅ 已闭**：删 `SkeletonNode.data/solvers/agents` 三字段 + 10 节点内联电池常数（in/proc/out IPO 视图文案保留） | 推演过程 DAG 节点"用到的数据/求解器" | ✅ 真起双服务 curl trace 复验 | P2 | AGENTCORE-TRACE-LINEAGE |
| F2 | `router/project-trace.ts:237` | ~~`agents: skel.agents` 无条件发骨架名(即使无真 lineage)~~ **✅ 已闭**：agents 改真血缘派生（invoke_agent.agentId / AGENT 路径真 toolName）·缺→空数组 | trace 节点 | ✅ 真跑 + 牙齿 test | P2 | AGENTCORE-TRACE-LINEAGE |
| F3 | `router/project-trace.ts:235` | ~~AGENT 路径回退 `skel.data`(电池常数)~~ **✅ 已闭**：data/solvers 删 skel 回退·真 trace 派生·缺→空数组「本次未记录来源」 | trace 节点 | ✅ 真跑 + 牙齿 test | P2 | AGENTCORE-TRACE-LINEAGE |

> **F 簇 ✅ 已闭**（WO-AGENTCORE-TRACE-LINEAGE）：`/queries/:taskId/trace` 可解释性图在真 lineage 缺失时，~~把骨架电池常数当"本节点真实用到的数据/求解器/agent"发给用户~~ → 治本后**节点显空数组（前端"本次未记录来源"），只发真 trace（task/plan/toolCalls）派生血缘**，真血缘存在则保留（R13/R6·任意租户/行业 R14）。FDE：真起 datacore+agentcore·真提交 4680 PACK 订单查询→ AGENT 路径 FAILED·`GET /trace` 10 节点血缘全空·零骨架常数。牙齿 `test/project-trace.test.ts`「血缘诚实簇」（回退改回 skel 即红）。

### 簇 G · 潜伏（今不可达但会造假）
| # | file:line | 造假 | 验证 | 严重 | WO |
|---|---|---|---|---|---|
| G1 | `solvers/risk.ts:810/820` | fallback 单价 `?? 0.6` 万/套·注释诡称已消除·今 SEG_REGISTRY 全命中不可达 | 读码✓ | P2 | RISK-TRAJECTORY-DEFAKE |
| G2 | `solvers/extended.ts:517/548` | 缺省 gap = `totalDemand * 0.15` 无 dataMode 标 | 代理·待运行复验 | P2 | RISK-TRAJECTORY-DEFAKE |
| G3 | `solvers/extended.ts:541` | yield_diagnosis 喂手植 0.95→0.85 step·断点 day33 标 source:MES·求解器"检测"出植入断点 | 代理·待运行复验 | P2 | RISK-TRAJECTORY-DEFAKE |

## 3. WO 派发（1 扩 + 5 新）

| WO | 覆盖簇 | 根因治本 |
|---|---|---|
| **METHOD-MC-STOCHASTIC（扩 scope）** | A1–A10 | 种子化 MC 真分位替代**所有** `×常数` P90；下游 replay/metrics/seed 随真分位自动变真。原单 §6 只列 A1–A4，须扩 A5(service:1137 order_fullchain)/A6(sop:150)/A7-A10(vle/replay/metrics/seed)。 |
| **RISK-TRAJECTORY-DEFAKE（新·P1）** | B1–B9,G1–G3 | risk_timeline 轨迹目标+事件具体值：真数据算或诚实空；**删 EVENT_SRC 假源归因**（无真值不标真源）；阈值/系数入 params。 |
| **CALIB-HONEST-EMPTY（新·P1）✅ 已闭** | C1–C6 | 无真 pair→诚实空/静止(非造下降线)；demo/部署 mapeSeries+evidence 上 SYNTHETIC 标；realizedMape 从真未来 pair 算。**落实**：C1 静态基线常数+report.baselineOnly·C2 bundle.synthetic·C3 realizedMape=mapeAt(week+2)·C4/C5 proposal.synthetic+evidence.synthetic·C6 走正门码注披露。前端徽章：ReviewView"合成演示·非真实学习"+CalibrationPage"静态基线·无真实配对"/SYNTHETIC。牙齿 test/calib-honest-empty.test.tsx。 |
| **SIM-REAL-SNAPSHOT（新·P1）✅ 已闭** | D1–D3 | baseSnapshot 取后端真对象属性态(非 hash(oid))；热度阈入 sim 认证/config。**落实**：契约 `SandboxViewConfig += nodeObjectState/heatThreshold`·view-config 从 `obj.props` 采数值型 stateVar(缺省诚实空)·两处 `deriveBaseSnapshot` 逐值取真属性态无真值退 0·阈 70 归口 `DEFAULT_SANDBOX_HEAT_THRESHOLD`。FDE 双证(真浏览器逐值 62/48… + 真后端 curl demo `nodeObjectState:{}` 诚实空)·牙齿 sandbox-view.test.tsx。 |
| **FRONTEND-VALUE-AUTHORITY（新·P1）✅ 已闭** | E1–E7 | 消费后端权威字段(revAttainPct/gmRate/gap)；缺失→诚实空态非内联常数重算；清 `debattery-allow` 白名单常数入后端 layout/rule。**落实**：E1 marginLedger 缺→「估算」标·E2 后端 sop.s4.revAttainPct(params.sop.revBudget)前端消费·缺则 workspace 预算·再缺 null(去内联240)·E3 后端 ltaDeviation.breach(C27 阈5%)前端消费·E4 消费 k.threshold 缺→灰(去?? 85;coef 已 view.layout 权威+估算标)·E5 消费 s4.gmOk(去内联0.5pp)·E6 消费 r.gap(去自算col0−col1)。E7 坐标表=Base.props.lon/lat 兜底·非决策·诚实披露(P3 保留)。牙齿 test/frontend-value-authority.test.tsx。 |
| **AGENTCORE-TRACE-LINEAGE（新·P2）✅ 已闭** | F1–F3 | trace 节点真 lineage 缺失→空/"本次未记录来源"，勿发骨架电池常数。**落实**：F1 删 `SkeletonNode.data/solvers/agents` + 10 节点内联常数（in/proc/out IPO 保留）·F2 agents 改真血缘派生（invoke_agent.agentId / AGENT 真 toolName）缺→空·F3 data/solvers 删 skel 回退真 trace 派生缺→空数组。真血缘存在则保留（R13/R6/R14）。FDE 真起双服务 curl trace 证 10 节点血缘全空零骨架常数。牙齿 `test/project-trace.test.ts` 血缘诚实簇（回退改回 skel 即红）。 |

## 4. 回写本体 + 建门（防回潮）

- 本审计表 = **KILL-MOCK-RED 红线的落地清单**，回写 `SYSTEM-ONTOLOGY.md`（§8 KILL-MOCK-RED / G-DM 邻域「量化具体值残留层」）。
- **建议新门**（防同类回潮）：
  - `no-fake-percentile:check`：静态扫 `p90/P90` 赋值来源含 `* <常数>` / `* healthFactor` → 红（除非注册为 method 真分位）。
  - `no-source-mislabel:check`：hash 派生值（`hashString`/`charCodeAt % `）不得同对象同时带 `src:` 真源标签（禁假源归因）。
  - `no-frontend-rederive:check`：前端决策 KPI 不得在后端已暴露权威字段时客户端重算（AST 或约定检查）。
  - `debattery-allow` 白名单**冻结+登记**：每个 allow 必附"为何非业务常数"理由 + 到期回收计划。

## 5. 诚实边界
- 标 `代理·待运行复验` 的行=子代理读码报告、审核方尚未起真服务逐值再验；标 `读码✓`=审核方本轮亲读真码确认。
- 排除的丙档诚实项（各代理列举 ~7–12 个/区）不在此表：如 `liveTightness`(无真返 null)、`fusion` 置信档(带 dataMode)、`util/numerics` 反假守卫、声明式 MSW mock、`DecisionValue` KILL-MOCK-RED 渲染门 等——它们如实披露，不算假。
