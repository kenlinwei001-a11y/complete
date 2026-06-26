# SPEC · 复刻沙盘族（1:1 · SandboxView/SimInit：运行评估双雷达 + 初始化向导 + 运行驾驶舱）

> 引用 `SPEC-replica-design-system.md`(token + 组件库)。本份描述沙盘族 3 页(竞品 image1/7/8)专属布局/数据/融合。**视觉1:1 + 接现有 `/a/v1/sim/*`(轨A)。平台术语。**
>
> ⚠️ **后端前置(摸真代码已核·见 `design-system §10`)**：本份多处"接现有"注**已被修正**——**6维健康雷达 / 4维信任雷达 / 业务动作接口(4动作)+RL4驱动 / 分层推演目标 / GEO_WITHIN约束 / 世界状态A-C** 后端**不存在 → 本轮暂不做,登记 TO-DO(`design-system §10.1`),后端建成后再复刻;禁画假数据雷达(继承真推演红线)。** 本轮**只做①接现成**:L0-L4/三维准备度/世界完整度/tick·checkpoint·branch/provenance/向导/运行台骨架(+风险榜接 risk_timeline·MOCK 因素诚实标估算)。
>
> **落点**：`SandboxView`(`/v/sim-sandbox`,轨A P0 已闭、tick 已修)/ `SimInitWizard`(`/v/sim-init`)→ 升级到竞品像素级(多为轨A 的 P1)。

---

## 页1 · 运行态评估（竞品 image1 · 6维健康+4维信任雷达）

**布局(三栏)**：左节点图画布 / 中滚动评估面板 / 右 Agent。
**中面板(1:1·自上而下)**：① 4 行清单 `State 状态变量N` / `Action 行动N·利用率%·Entity/Edge` / `Writeback` / `Query 图查询N`,每行右"跳转"链 ② **6维健康雷达**(规则覆盖/激活/可观测/环安全/闭包/利用率+综合分) ③ **4维信任雷达**(Runtime/Explainability 可计算 + Temporal/Data `🔒Reserved`+`Partial N/4`) ④ **知识激活**(静态可达传播链 N/N·DORMANT)。
- **接后端(融合)**：雷达接 `deriveCertification`/closure(现成五维→扩6维)；信任 Temporal 接沙盘时序、Data 接 R13 lineage,**不可计算诚实 Reserved**(非假数据);State/Action/Query 接真会话态。**这正是轨A P1「双雷达6+4维」,在此落。**
**真值判据**：demo /v/sim-sandbox → 双雷达接真 certification、信任维诚实标可计算/Reserved、综合分=真 closure。

## 页2 · 初始化沙盘向导（竞品 image7 · 三步 + 世界完整度蓝环）

**布局**：主区沙盘卡列表 + 右抽屉三步向导(世界基准时间→推演范围→范围预检)。
**抽屉左表单(1:1·step2 推演范围)**：`业务场景(推荐)`◉全图基线;子tab `手动微调|AI辅助构建`;`主体对象`胶囊多选 / `时序记录` / `关系类型`(绿胶囊+全选/清空);橙告警条(未选→克隆全图);`属性过滤`(名/值+添加);`关系扩展深度`滑块;`每类最多实体数`步进。
**抽屉右统计(1:1)**：**世界完整度蓝色环 100%**(组件库)；4 条进度条(传播链实体/状态变量/派生规则/Action)；**`将进入沙盘的状态变量`清单**(变量名+派生橙徽/Action绿徽+规则名,滚动);已选类型。底部 取消/下一步。
- **接后端(融合·现成)**：接 `/a/v1/sim/sessions/:id/scope-precheck`+`deriveCertification`(**轨A 增量2 已建,SimInitWizard 已 3 步**);完整度环/进入清单=真 scope-precheck 数据。**这是轨A「就绪面板70%元素」的剩余+精修。**
**真值判据**：/v/sim-init → 三步真渲染、完整度环=真预检%、进入清单=真状态变量(可溯派生规则)。

## 页3 · 推演运行台（竞品 image8 · 本体结构画布 + Schema规则 + AI指挥台）

**布局(最密·多区)**：顶场景控制条 + 状态卡条 + 主区三分(左工具列/中本体结构画布/右目标+AI指挥台)。
**场景控制条(1:1)**：`运行中`绿徽/场景/主图谱 + `可执行行动N/N`/`手动确认⌄`/`保存检查点`/`检查点`/`刷新状态`/`场景KPI`/`销毁沙盘`红钮。
**状态卡条(1:1)**：`并行全分支/Step+10` / `诞生N规则✓` / `世界状态 健康度+阈控`(橙告警) / `Schema对齐时序窗口` / **`风险TOP3`**(实体+类型+分值)。
**中画布(1:1)**：tab `世界概览|本体结构(选中)|推演传播|实例探索`;**运行态实色节点**(按对象类型上色,组件库)+底部Action/派生计数;单击查属性/双击进实例。
**右栏(1:1)**：上 `目标体系|EC策划`→**Schema Derive Rules**(`▸ r_*: A→B [RUNTIME/INGEST]`)+分层推演目标(总体/分系统/局部三色条)+`+约束`/`+声明目标`;下 **AI 推演指挥台**(`推进N个Tick`/`查看风险最高实体`+`推演对话|行动审计`tab)。
- **接后端(融合)**：节点/tick 接 `propagateTick`(**轨A tick 已修,节点真变色**);派生规则 = 真 PropagationRule/derivedProperties(轨L);检查点/分支接 `/sim/checkpoint`/`branch`(现成);**AI 指挥台接 QOS**(路径B agent 驱动沙盘,补G-3);风险TOP3 接 `risk_timeline`(**注意轨M 真推演红线:接真数据或诚实标,非 mockTightness 裸红**);采纳走 RL4。
**真值判据**：/v/sim-sandbox 运行态 → tick 推进节点真变色、Schema规则=真派生、风险榜接真求解器(非假)、检查点/销毁真生效、AI指挥台经 QOS 真驱动。

---

## 增量（分层交付 b · 只做①接现成 full 1:1;③类后端未建 → TO-DO 不做）

**Phase 1 · ①接现成 full 1:1（真数据·先交付）**
- **增量0** 起 demo 真跑现 SandboxView/SimInit 实拍定基线。
- **增量1 初始化向导**(页2)：三步 + 完整度环 + 进入清单,接 `scope-precheck`/`deriveCertification`(现成·真数据)。
- **增量2 运行台骨架**(页3)：本体结构画布 + tick 节点变色 + 检查点/分支 + curTick(Step+N)/rulesFired(诞生N规则),接 `propagateTick`/checkpoint/branch(现成·真数据);Schema 规则列接 PropagationRule/derivedProperties。
- **增量3 评估面板①部分**(页1)：State/Action/Writeback/Query 清单 + L0-L4/三维准备度 + 知识激活(接 certification 现成)。**两雷达留到 Phase 2。**

**收尾（①/② 便宜的 · 仍做）**
- **增量4** 主题接轨O + 溯源接 `SPEC-trust` + 中栏 6 子 tab + Agent 指挥台接 QOS(现成);**风险榜**接 risk_timeline 但 MOCK 因素诚实标估算(守轨M 真推演红线)。

**不做（③类 · 后端未建 · 登记 TO-DO,见 `design-system §10.1`）**
- **6维健康雷达 / 4维信任雷达 / 业务动作接口+RL4驱动 / 分层推演目标 / GEO_WITHIN 约束** → **本轮不碰**(不画壳、不画假);后端 backlog 排期建成后,再回来复刻+点亮。

## 红线
接 `/a/v1/sim/*`/`deriveCertification`/`propagateTick`/QOS,**不新建并行**;风险/数字接真后端或诚实标(**继承轨M:禁 mock 裸红冒充真**);无外部产品名;域色 theme-invariant。**完成=真浏览器像素对竞品 + 数字溯真后端,非测试绿。**

---

## 补遗（查漏审计补入 · 之前漏的元素）

- **页1 中栏 6 子 tab（image1 漏整条）**：`基本信息 | 图查询 | Skills | MCP服务 | 日志 | 指南` + `执行节点(选中) | 单链执行`。
- **业务动作接口（image4②/image8 漏）**：运行态可调用 4 动作 `断供/恢复供货/产能调整(adjustCapacity)/订单延期(delayOrder)`(见 design-system §8);运行台由 AI 指挥台/手动触发,走 RL4。
- **页3 运行台 image8 补漏**：① 右栏顶 **4 tab 补 2**:`传播过程 | 未来事件`(原只写 目标体系|EC策划) ② 中画布顶 **过滤胶囊条** `N 实体类型 / N 关系类型 / N 可行动` ③ 状态卡条补 **卡明细**:`世界状态`(健康 A–C + 态势 + 阈控 + 展开) / `Schema对齐`(聚合算子 Sum/Max + 窗口契约) ④ 画布 **左工具列** `↻刷新 / +增 / «折叠` + `当前`徽列表 ⑤ 约束 **类型化** `+ GEO_WITHIN 约束`。
- **页2 沙盘列表卡内元素（image7 漏）**：卡内 `100/100 可进入推演 · L4 Certified`环 + `节点 N·边 N` + `已过期`徽 + `重新优化` + 底部 `初始化沙盘 / 编辑 / 删除` + `工作流范围`。
- **进入清单聚合算子（image7）**：状态变量项标 `字段聚合 Sum/Last/Max` 来源类型(原只写 派生/Action徽+规则名)。
- **信任雷达双语义文案（image1）**：`Temporal=防未来数据泄漏 / Data=来源可追溯 / Reserved / Partial N/4`(见 design-system §8);**6 维健康雷达** 补 综合分位置 + 底部轴值图例 `轴名 值` ×6。
