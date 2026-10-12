# PRD 增量 · 管理平台补全（Bootstrap / 租户与用户 / 资源 CRUD / 视图配置）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：扩展 平台 PRD §A0/§6.1/§8，QOS-PRD §8.4 模式推广；新增前端 /admin/tenants、/admin/users、/admin/views 三页） |
| 解决问题 | 管理平台"创建/配置"链路缺口：无引导流程、无账号/租户管理、AgentCore 资源 CRUD 端点未显式化、场景包与视图配置不可创建 |

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及不变量**（§5）：R1 · R3 · R9
- **触及断点**（§8）：（无特定断点）
- **范畴**：管理平台补全：Bootstrap/租户用户/资源 CRUD（仓储四处）/视图配置

## 1. 平台引导（Bootstrap，最高优先）

1. 首次启动：DataCore 检测 `users` 表为空 → 按环境变量 `BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD` 创建**平台超管**（角色 `platform_admin`，归属自动创建的 `default` 租户）；幂等（表非空则跳过）；未配置环境变量且表空 → `/readyz` 返回 503 并日志明示原因。
2. `platform_admin` 是唯一跨租户角色：可建租户、建各租户首个 `tenant_admin`、管理行业模板；**不出现在任何租户的业务数据策略中**（不能读业务对象——管别人房子不看别人抽屉）。
3. 新租户创建后的最小可用路径（前端空态引导卡按此顺序）：建 tenant_admin → 登录 → 一键合成数据（自动产生场景包/本体/意图/视图/演示账号）**或** 克隆行业模板 → 各管理页即有内容可配。

## 2. 租户与用户管理（A0 扩展）

```ts
interface Tenant { id; key; name; status: "ACTIVE"|"SUSPENDED"; createdAt }
interface User   { id; tenantId; email; displayName; roles: string[];
                   attributes: Record<string,string|string[]>;   // 如 baseScope:["常州基地·总部"]
                   status: "ACTIVE"|"DISABLED"; lastLoginAt? }
```

- **角色体系**：内置角色 `platform_admin`（平台级）/ `tenant_admin` / `catalog_admin` / `approver` / `planner` / `viewer`；参数化角色用 `role:param` 约定（如 `base_manager:常州基地·总部`）。自定义角色 = 任意字符串 + A6 策略绑定（角色本身无内置语义，语义全部来自策略与功能配置——保持 A6 单一权威）。
- **API**（DataCore）：

```
POST/GET            /a/v1/tenants                      （platform_admin）
POST/GET/PATCH      /a/v1/tenants/{id}/users           （tenant_admin；PATCH 改角色/属性/状态）
POST                /a/v1/users/{id}/reset-password    （生成一次性链接，本期直接返回新密码亦可，标注 TODO 邮件）
GET                 /a/v1/roles                        （内置+本租户已用角色清单，供下拉）
```

- 安全规则：tenant_admin 不能编辑/禁用自己账号的角色；最后一个 ACTIVE 的 tenant_admin 不可禁用（409 `LAST_ADMIN`）；所有用户管理操作入审计。
- **前端**：`/admin/tenants`（仅 platform_admin：租户列表+创建+首管理员创建）；`/admin/users`（tenant_admin：用户表格——邮箱/角色 chips/属性编辑器/状态开关/重置密码；角色选择器带参数化角色的参数输入）。

## 3. 场景包与视图配置管理

```
POST /a/v1/scenario-packages            Body: { name, fromTemplate?: industryKey | fromPackageId }   // 空建/模板实例化/克隆
PATCH /a/v1/scenario-packages/{id}      （名称/views/toolWhitelist/模型覆盖/阈值）
GET/POST/PUT/DELETE /a/v1/view-configs  （ViewConfig CRUD：viewKey、renderer(12 选 1)、布局/graphOptions、
                                          导航分组与排序、可见角色；viewKey 唯一性校验）
```

- **联动**（强制）：创建 ViewConfig → 自动向 FeatureRegistry 注册 `view.{viewKey}`（默认开）；删除视图 → 级联提示其 feature/场景入口/意图引用并要求确认。
- **前端 `/admin/views`**：视图列表（renderer 徽章/导航位置/feature 状态）→ 编辑器按 renderer 分支：dashboard=widget 网格编辑（widget 类型/数据声明/布局拖拽可后置为表单排序）；ontology-graph=GraphOptions 表单；其余 renderer=数据范围参数表单。导航排序用上下移。保存即 configVersion+1（沿用功能开通增量 §6 的生效机制）。

## 4. AgentCore 资源 CRUD 端点（显式化，统一资源模式）

agents / workflows / skills / mcp-configs / scene-entries 五类资源统一遵循（与 QOS-PRD §8.4 意图目录同模式）：

```
GET    /b/v1/{res}?status=&q=            列表（分页 50）
POST   /b/v1/{res}                       创建 DRAFT v1
GET    /b/v1/{res}/{id}                  详情（含版本列表）
PUT    /b/v1/{res}/{id}                  仅 DRAFT 可改；PUBLISHED 资源调用 → 409 IMMUTABLE_VERSION
POST   /b/v1/{res}/{id}/new-version      从任意版本派生新 DRAFT
POST   /b/v1/{res}/{id}/publish          发布校验（agent：scopeDeclaration 非空+工具引用存在+模型 ID 合法；
                                          workflow：QOS-PRD §4.2 全部校验+环检测；mcp：连接测试通过；
                                          scene-entry：AGENT_* 模式必须 defaultAgentId 且该 agent 已发布）
POST   /b/v1/{res}/{id}/retire
POST   /b/v1/mcp-configs/{id}/test       连接测试 → tools/list 结果
GET    /b/v1/{res}/{id}/references       被引用清单（删除/退役前置检查：哪些 agent 用此 workflow/skill/mcp、
                                          哪些意图绑定此 plan——有引用则退役需确认，删除被拒）
```

权限：以上全部要求 `catalog_admin`；scene-entries 的修改即时生效（无版本化，带 updatedAt 乐观锁）。

## 5. 规则库手工管理（A5 补全）

```
POST/PUT /a/v1/rules        （origin=MANUAL；expression 经 DSL 解析校验，错误定位到字符位）
POST     /a/v1/rules/{id}/publish | /retire     （版本化同上模式）
POST     /a/v1/rules/dry-run                    Body: { expression, samplePayload } → 即时求值（编辑器"测试"按钮）
```

前端 `/admin/rules`（原 PRD 已列路由但未给规格）：规则表（key/作用域/严重级/来源徽章 MANUAL|DOCUMENT|SYNTHETIC/版本/状态）+ 编辑器（expression 输入带 DSL 语法错误内联提示 + dry-run 面板）。

## 6. 空态与引导规范（全管理页统一）

每个管理页空态必须给"下一步"：无连接器→「上传文件或创建连接」按钮；无本体→「从数据建模」或「一键合成」；无意图→「创建意图」或「从兜底记录孵化」；无 agent→「创建 Agent」+ 模板预填（系统提示词骨架+默认预算）。禁止空白表格无操作入口。

## 7. 验收用例增量

| # | 用例 | 预期 |
|---|---|---|
| M1 | 空库启动（带 BOOTSTRAP 环境变量） | 超管创建成功且幂等；不带变量空库启动 → readyz 503 |
| M2 | 端到端最小路径：建租户→建 tenant_admin→登录→一键合成→打开 8 个管理页 | 全部有内容、可编辑保存；全程无 5xx |
| M3 | 用户管理 | 参数化角色保存与生效（base_manager:常州 行级过滤验证）；最后管理员不可禁用；自改角色被拒 |
| M4 | 资源统一模式 | agent 发布后 PUT → 409；new-version 派生可改；references 非空时 retire 需确认、delete 被拒 |
| M5 | scene-entry 校验 | AGENT_FIRST 且 defaultAgent 未发布 → 发布失败信息明确 |
| M6 | 视图配置 | 新建视图自动注册 feature 并出现在导航；删除时级联提示引用 |
| M7 | 规则手工管理 | 非法 expression 定位字符位；dry-run 即时求值正确 |
| M8 | 空态引导 | 新租户未合成数据时，8 个管理页空态均有可点的下一步入口 |
