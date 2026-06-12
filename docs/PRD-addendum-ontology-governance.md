# PRD 增量 · 本体治理与检索体系（域治理 / 演进稳定性 / 检索模式全集）

| 项 | 值 |
|---|---|
| 版本 | v1.0（FDE 评审补全：修订 本体核心增量 §1、平台 PRD §5/§6、前端 PRD；基线 Part B 追加裁决 #20） |
| 解决问题 | ① 域（Domain）升格为治理单元；② 本体演进下切片/公式/规则等预配置的稳定调用；③ 检索模式成体系并补齐缺失 API（对象搜索/邻接/聚合）；④ 单位元数据与对象 360 |

## 1. 域治理（Domain 升格为一等治理单元）

```sql
domains(id PK, tenant_id, domain_key TEXT/*factory|product|process|equip|people|quality|
        capacity|forecast|sales|material|finance|plan|external|decision…场景包定义*/,
        display_name, color TEXT/*前端图例同源*/, owner_user_id FK/*域负责人*/,
        description, UNIQUE(tenant_id, domain_key));
-- object_types.definition.domain 由可选字符串改为：必填且 FK 校验到 domains
```

**治理语义（强制）**：
1. **归域强制**：每个对象类型必须归属唯一域；A3 建模建议必须输出 domain 归属（LLM 建议 schema 增加 `domain` 字段，候选=租户域注册表）；无法判断时归 `unassigned` 域并在发布校验中**阻断**（必须人工归域才能发布）。
2. **域负责人**：域内对象类型/派生公式/绑定规则的发布需域 owner 审批（管理台发布确认页增加 owner 会签步骤；owner 缺位时回退 catalog_admin 并记警告）。
3. **跨域引用规则**：LinkType 的 from/to 跨域时，发布确认页显式标注"跨域关系"并通知双方 owner（不阻断——跨域是常态，但必须可见可审计）；域间依赖图在图谱"按域"视角可视化（前端 GraphOptions 已支持 domain 着色，增加域间汇总边模式 `collapseToDomains:true`）。
4. **域作为切面**：权限策略 resource 增加 `kind:"DOMAIN"`（整域授权）；FeatureRegistry 支持 `domain.{key}` 级开关（关一个域=该域对象类型在图谱/检索/建模中整体不可见——卖"财务域"为可选包的商业形态由此支持）。
5. 建模工作台/映射表/检索结果 UI 一律按域分组展示（前端各处的分组键统一为 domain_key）。

## 2. 本体演进下的稳定调用（切片/公式/规则不静默断裂）

### 2.1 API 名不可变原则（稳定性的根，全平台强制）

`type_key / link_key / 属性 key / slice_key / rule_key` 一经 PUBLISHED **永不重命名、永不复用**；可变的只有 display_name 与描述。语义要变 = 新建 key + 旧 key 走弃用流程。这是 Foundry 的 API Name 纪律，所有下游稳定性都建立在它之上。

### 2.2 弃用流程（deprecation）

```
状态机：ACTIVE → DEPRECATED(附 supersededBy、deprecatedAt、宽限期默认 90 天) → RETIRED
DEPRECATED：可读可被既有引用调用，新引用被拒（创建 slice/公式/规则引用弃用 key → VALIDATION_ERROR）；
            被引用方调用时响应附 deprecation 警告头，审计计数 dc_deprecated_ref_calls_total
RETIRED：   仅当 references=0 才允许；否则 409 列出全部引用方
```

### 2.3 发布影响门禁（本体核心 §1"本体版本演进"的强化替代）

本体新版本发布时，**对四类下游做编译期反查**（统一引用反查服务，复用 LLM&引用增量的 references 机制并扩展到本体元素粒度）：

| 下游 | 反查内容 | 破坏性变更（删除/改型被引用的 key）处理 |
|---|---|---|
| SliceSpec | root/hops 引用的 typeKey/linkKey/filter 属性 | 阻断发布，列出受影响 slice 清单 |
| 派生公式 | deps 中的 (typeKey, prop, linkKey) | 阻断 |
| 规则表达式 | scope 与表达式中的 typeKey.prop | 阻断 |
| 执行计划/意图槽位 | objectType 引用、defaultFrom 路径 | 阻断 |

`force=true`（catalog_admin）仅允许在同一事务内**同时提交下游修订**（变更集发布：本体新版本 + 受影响 slices/公式新版本一并生效）——禁止"先破坏后修"窗口。
**切片契约测试**：每个 PUBLISHED slice 必须带 `contractFixture`（一组 args + 期望输出形状断言：节点类型集合/最小节点数）；本体发布门禁与 CI 均自动跑全部 slice 契约——预配置场景的"稳定调用"由此从约定变成持续验证。

### 2.4 slice 纳入统一引用体系

`Ref.kind` 增加 `"slice"`：执行计划/agent 工具调用对 slice 的引用遵循 latest/pin 语义与影响分析（LLM&引用增量 §2 全套适用）；`GET …/slices/{key}/references` 反查哪些计划/意图/agent 在用——回答"这个切片能不能动"。

## 3. 检索模式全集（八种，统一权限语义：全部经 A6 数据层过滤）

| # | 模式 | API | 典型调用方 | 本期/后期 |
|---|---|---|---|---|
| 1 | 按键取对象 | `GET /a/v1/objects/{typeKey}/{objectKey}` | 槽位校验、对象 360 | 本期（已有） |
| 2 | 过滤列表 | `POST /a/v1/objects/query`（等值过滤+limit） | 视图表格、工具 query_objects | 本期（已有） |
| 3 | **关键词搜索（补）** | `GET /a/v1/objects/search?q=&types=&domains=&limit≤20`；命中范围=objectKey+display 属性+元模型标记 `searchable:true` 的属性；实现=pg_trgm GIN 索引，按相似度排序；返回 `{typeKey, objectKey, display, domain, score}` | 前端对象选择器（槽位 objectRef）、全局搜索框 | **本期** |
| 4 | **邻接导航（补）** | `GET /a/v1/objects/{id}/neighbors?linkKey=&direction=&limit≤50` 单跳展开 | 图谱实例下钻、对象 360 关系区、agent 探索 | **本期** |
| 5 | 子图切片 | resolveSlice（本体核心 §3） | 工作流/求解器/agent | 本期（已有） |
| 6 | **聚合查询（补）** | `POST /a/v1/objects/aggregate`：`{ typeKey, filter?, groupBy: prop[]≤2, metrics: [{prop, fn: count\|sum\|avg\|min\|max}]≤5 }` → 行集；驾驶舱 widget 的"声明式 query 定义"正式落在此 API（前端 PRD §7.3 的悬空契约补齐）；新增同名内置工具 `aggregate_objects`（READ，进路径 B 白名单——Agent 做"对比储能与动力基地平均利用率"类问题从拉全量改为聚合下推） | 驾驶舱 widgets、agent | **本期** |
| 7 | 时序聚合 | query_timeseries_agg（A8 §4） | 趋势图、agent | 本期（已有） |
| 8 | 语义检索 | 对象/类型的向量检索（"找跟化成产能相关的对象"） | agent 增强 | **v2**（pgvector 底座已备，显式不做于本期——关键词+结构化已覆盖演示与首客户） |

实现注记：#3 需元模型属性增加 `searchable:boolean`（默认 false，A3 建议时对名称类字段置 true）；#6 强制 groupBy 基数保护（结果行 >500 → 400 要求收窄）。

## 4. 元模型补充：单位与展示格式（工业系统硬要求）

属性定义增加：`unit?: string`（"万套"|"GWh"|"%"|"吨"|"天"…，场景包单位字典约束）与 `displayFormat?: string`（如 `"0.0"`、`"0,0"`）。**消费链全打通**：派生公式编译期做单位一致性 lint（加减要求同单位，乘除产出复合单位仅记录不阻断）；溯源弹窗/KPI 卡/表格列头自动带单位；A9 量级 lint（§9.3）按单位字典分别套用合理区间。

## 5. 对象 360 页（前端补充）

路由 `/o/:typeKey/:objectKey`：头部（display+域色徽章+objectKey）｜属性区（按元模型分组，temporal 属性带迷你趋势，来源=检索#1+#7）｜关系区（按 linkKey 分组的邻接列表，来源=#4，可逐组展开）｜足迹区（涉及该对象的 任务/Action/告警 各最近 5 条）。全局搜索框（Shell 顶栏，来源=#3）选中即跳此页；图谱实例节点双击同跳。这是"任何数字点开最终落地的地方"——溯源链的终点页。

## 6. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| G1 | 归域强制 | 建模建议含 domain；unassigned 发布被阻断；域 owner 会签记录在发布审计 |
| G2 | 域开关 | 关闭 `domain.finance` → 财务域类型在图谱/搜索/建模/聚合中整体不可见 |
| G3 | API 名不可变 | 对 PUBLISHED type_key 重命名请求 → 拒绝并提示弃用流程 |
| G4 | 弃用流程 | DEPRECATED 后新建引用被拒、既有调用带警告计数；references>0 时 RETIRE 被拒并列清单 |
| G5 | 发布影响门禁 | 删除被 slice 引用的 linkKey → 发布阻断列出 slice；force 变更集（本体+slice 新版同事务）通过且原子生效 |
| G6 | 切片契约 | 本体发布自动跑全部 slice contractFixture；构造破坏 fixture 的变更 → 门禁拦截 |
| G7 | 对象搜索 | "常州"命中基地（searchable 属性）；权限内排序合理；czmgr 搜不到其他基地 |
| G8 | 聚合查询 | 按 pos 分组 avg(util) 结果与手算一致；agent 用 aggregate_objects 回答对比类问题（审计断言未拉全量行） |
| G9 | 邻接导航 | 对象 360 关系区按 linkKey 分组正确；limit 生效 |
| G10 | 单位 lint | 不同单位属性相加的公式发布告警；KPI/溯源弹窗展示单位 |
