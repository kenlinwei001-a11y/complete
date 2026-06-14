# 仿真两场景 · 逐步细节与推演结果（推演 + 规划体检）

> 来源：`scripts/provision-enterprise.mjs` 第【5b】步，跑在工业级 **XL** 数据上（10⁴ 订单 / 12 基地 / 6 型号 / 2000 物料批次 / 90 天时序）。所有数值取自真实运行，过程取自代码（标 `文件:函数`）。两场景均经操作员 JWT 走正门 API、行级权限贯穿、结果带 snapshotVersion 可下钻溯源、支持增删改查后二次推演。

环境前置（同一脚本第【1】–【5】步，全经 REST 配置，非硬编码）：
- 登录 demo/admin → JWT（A 签发 / B 经 JWKS 验签，OBO 透传）
- `POST /a/v1/synthetic/jobs {battery, scale:XL}` 一键合成：10 数据域 + 23 跨域本体类型 + 链接 + **10000 订单 + 2000 物料批次 + 3000 采购单 + 60 客户 + 90 天时序** + C01–C25 规则 + 21 求解器
- `POST /a/v1/rules` 追加并发布 C26–C33（共 15 约束）；`/b/v1/skills`×20、`/b/v1/agents`×10、场景入口×10

---

## 场景一 · 推演：受影响订单（"常州基地影响哪些订单？"）

意图 `affected_orders` · 视图 `risk` · 风险级 COMPUTE · 求解器 `affected_orders`。

### 逐步 IPO

| 步 | 模块 | 输入 I | 处理 P（做什么·怎么做） | 输出 O | 数据量 |
|---|---|---|---|---|---|
| 1 | AgentCore 鉴权 | `Bearer <JWT>` | resolveAuth 验签取 tid/sub/roles，保留 OBO token | RequestAuth{demo, admin} | — |
| 2 | 求解端点 entitlement | solverKey=affected_orders | `requireFeatureTag("solverKeys","affected_orders")`（关→404 不泄露） | 放行 | — |
| 3 | A6 行级取数 | ctx + args{baseId:"changzhou"} | `ontology.invokeSolver` 先经 **A6 过滤的 `queryObjects("Order")`** 取 visibleOrders（行策略 `Object.bases IN ${user.baseScope}`；admin 全量=10000） | visibleOrders(10000) | 扫 10⁴ 订单 |
| 4 | 上下文装载 | tenantId, visibleOrders | `loadContext`：并行拉 Bases(12)/Models(6)/Segments… + visibleOrders（#4 优化：不加载 13 新求解器才用的扩展类型） | SolverContext | 12+6+… |
| 5 | 求解算法 | ctx + {baseId, fromDay,toDay} | `affectedOrders`（risk.ts:275）：取 base=常州订单，窗口 **[day−7, day+14]** 过滤；逐单 `delay=⌈扰动/delayDiv(8)⌉`、`impact`；归并 **problems[]（4 类）** + **rootChains[]（order→judgement→rootCause→remedy）**。确定性，无时钟/随机 | {affected, total, problems, rootChains} | 命中子集 |
| 6 | 快照戳 | — | `snapshotVersion = ontology_version.epoch` | "1.2" | — |
| 7 | 返回 | — | `{ data:{…}, snapshotVersion }`（每数字可经 toolCall→snapshot 下钻） | JSON | — |

### 推演结果（真实运行）

- **受影响订单：45 单**（10000 单中按常州 + 窗口过滤命中）
- 样本行：`SO-10799 · 蓝海储能 · L148-LFP · 269 万套 · 交期 2026-07-01 · 延误估计 2 天 · 影响度 0.40`
- **problems[]：3 组**（按交期/齐套/瓶颈等归并）；每单挂 **rootChain** 根因链
- snapshotVersion `1.2`（可二次推演：改订单/扰动后重算，同输入字节级一致）
- 权限：base_manager:常州 跑同一推演只会命中含常州的订单子集（A6 行级贯穿，已有回归锁）

---

## 场景二 · 规划体检（"这版月度计划过得了体检吗？"）

意图 `plan_audit_q` · 视图 `audit` · 求解器 `plan_audit`（plan.ts:planAudit）。

### 输入（操作员录入的本月计划口径，单位 万套 / 亿 / %）

| 字段 | 值 | 含义 |
|---|---|---|
| dem | 480 | 总需求 |
| seg_pas / seg_ess / seg_com | 220 / 170 / 90 | 动力/储能/商用 三细分（合计 480，自洽） |
| sup | 450 | 总供给 |
| gmTarget | 18% | 毛利目标 |
| cashCushion | 55 亿 | 现金垫 |
| capex | 60 亿 | 资本开支 |
| ltaCov / kitGap | 0.85 / 5 | 长协覆盖率 / 齐套缺口 |

### 处理：逐条体检（硬矛盾 H / 软风险 M / 建议 S）

| 检查 | 规则 | 逻辑 | 本次判定 |
|---|---|---|---|
| X01 细分自洽 | — | `|Σseg − dem| ≤ 容差` | ✅ 通过（220+170+90=480） |
| X02 产销缺口 | — | `dem − sup` vs 软/硬阈值 | ❌ **硬**：缺口 30 万套 > 硬阈值 |
| X03 毛利结构 | C15 | `gmTarget` vs 细分加权结构毛利 `Σ wᵢ×marginᵢ` | ❌ **硬**：18% 超结构毛利上限 |
| X04 物料齐套 | C16 | 齐套缺口 vs 阈值 | ⚠ 软风险 |
| R02 CAPEX 门槛 | C18/C23 | capex/现金垫与门槛 | ⚠ 软风险 |
| 现金垫底线 | C18 | `cashCushion ≥ 底线` | ✅（55 亿过线） |

模块：DataCore A5 规则库（C15/C16/C18）+ A4 细分对象（segMargins 取应用细分毛利）+ 求解器评分。评分=满分扣 H/M 罚分（`c.params.audit` 权重）。

### 体检结果（真实运行）

- **评分 34 / 100 · 结论：不通过**
- **硬矛盾（2）**：`X02 产销缺口`、`X03 毛利结构`
- **软风险（2）**：`X04 物料齐套`、`R02 CAPEX 门槛`
- **修正建议（3）**：`S-X02`（夜班+加急采购供给增量包，补缺口 30）、`S-X03`（毛利目标回归结构毛利）、`S-X04`（齐套补料）
- 每条 H/M 带 `why`（代入数值）+ `fix.patch`（可一键试修 → **二次体检**）；fix 仅演示，真正生效走 S2 Action 审批

---

## 两场景共性（工业级 + 可审计 + 可二次推演）

- **数据规模**：均在 10⁴ 订单 + 配套工业级数据上运行（非 demo 量级）。
- **非硬编码**：场景/agent/skill/规则/数据全经 REST 配置产生（见 provision-enterprise.mjs），可增删改查。
- **引用源/输入源**：每条数据带 `origin`（SYNTHETIC/MANUAL/连接器）；每个推演数字可经 toolCall→snapshotVersion 下钻到来源行。
- **二次推演**：改输入（订单/计划口径/规则参数）后重算；同 (seed/args/snapshot) 确定性一致。
- **权限**：行级策略贯穿求解器取数（base_manager 只见本基地）。
- **持久化**：对 PG 部署运行 `--remote` 后，以上配置与数据落库，部署重启后依旧可见、可继续推演。
