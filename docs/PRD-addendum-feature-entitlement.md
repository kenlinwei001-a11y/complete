# PRD 增量 · 功能开通与前端展示配置（Feature Entitlement）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：修订 平台 PRD §6.1、前端 PRD §3/§4.1/§8、QOS-PRD §5.1；新增中台配置页与后端强制机制） |
| 需求 | 不同客户需要不同的功能展示（如某客户不需要规划体检），在中台配置即可不展示；配置粒度到视图/区块/操作三层 |

## 1. 设计原则（规范性）

1. **功能配置与权限分离**：功能配置（entitlement）= 租户产品形态（"有没有"）；权限（A6）= 用户数据/操作授权（"能不能"）。功能关闭的表现是**不存在**（导航不渲染、直访 404 `FEATURE_NOT_FOUND`）；权限不足是 403。两套机制独立评估，先 entitlement 后 authz。
2. **前后端双重强制**：前端按配置不渲染只是体验层；后端必须同步拒绝（§4），否则只是"藏"不是"没开通"。
3. **联动闭环**：功能关闭必须级联到 QOS 意图候选、求解端点、合成数据种子（§5）。

## 2. 功能注册表（FeatureRegistry，代码注册 + 配置引用）

```ts
interface FeatureDef {
  key: string;                  // 三层命名：见下
  name: string;                 // 中台展示名
  level: "VIEW" | "BLOCK" | "ACTION";
  defaultOn: boolean;
  requires?: string[];          // 依赖（BLOCK/ACTION 必须声明所属 VIEW；关父级自动关子级）
  bindings?: {                  // 联动声明（§5 的依据）
    intents?: string[];         // 关联 QOS 意图 key
    solverKeys?: string[];      // 关联同步求解端点
    apiTags?: string[];         // 关联后端路由 tag
  };
}
```

**命名规范与首批注册清单（battery 场景包默认全开）**：
- VIEW：`view.dash` `view.ontology-graph` `view.risk-board` `view.ledger` `view.plan-audit` `view.plan-generate` `view.sop-balance` `view.project-sim`
- BLOCK：`shell.query-dock`（查询对话整体）｜`qos.agent-fallback`（路径 B 兜底；关=全局 WORKFLOW_ONLY 行为）｜`view.project-sim.whatif`｜`view.risk-board.mitigation`（处置方案区）｜`view.dash.widget.{widgetKey}`（驾驶舱每卡一 key）
- ACTION：`act.plan-audit.apply-fix`｜`act.adopt-to-draft`（各视图采纳按钮统一受控）｜`act.export`
- 示例联动：`view.plan-audit` 的 bindings = `{ intents:["plan_audit_*"], solverKeys:["plan_audit"], apiTags:["plan-audit"] }`。

## 3. 配置模型与解析（DataCore，A6 旁挂）

**四层解析，后者覆盖前者**：平台默认（FeatureDef.defaultOn）→ 行业模板默认集（IndustryTemplate 新增 `features` 字段）→ **租户配置** → **角色覆盖**（仅允许在租户已开通集合内做"再收窄"，不允许角色开租户未购功能）。

```ts
interface FeatureConfig {       // 表 feature_configs，(tenant_id, role?) 维度
  tenantId: string; role?: string;          // role 为空 = 租户层
  overrides: Record<string, boolean>;       // key → on/off，未出现的 key 取上层
  configVersion: number;                    // 每次保存 +1
  updatedBy: string; updatedAt: string;
}
```

解析结果（已展开的最终生效 key 集合 + configVersion）并入 `GET /a/v1/me/workspace` 响应的 `features: string[]`；导航/视图列表在服务端按 features 过滤后下发——**前端不做解析，只消费结果**。

## 4. 后端强制（entitlement middleware）

- DataCore 与 AgentCore 各挂一层中间件：按路由 tag / solverKey 反查 FeatureRegistry → 该租户未开通 → `404 FEATURE_NOT_FOUND`（注意是 404 不是 403，不泄露功能存在性）。
- AgentCore 获取租户功能集：调 `GET /a/v1/tenants/{id}/features`（带 configVersion 的 ETag 缓存，TTL 60s）——遵守松耦合契约 C-1（B 经 A 公开 API）。
- 同步求解端点 `POST /b/v1/solvers/{key}/run`：solverKey 被任何已关闭 feature 绑定 → 拒绝。

## 5. 联动闭环（强制实现）

| 触点 | 行为 |
|---|---|
| QOS 路由器（QOS-PRD §5.1-1 候选收窄追加条件） | 意图 key 被已关闭 feature 绑定 → 不进候选；分类器目录中也不出现 |
| `qos.agent-fallback` 关闭 | 路由器一切"转路径 B"分支改为返回「请换个问法」+ 可用意图列表（即全局 WORKFLOW_ONLY） |
| `shell.query-dock` 关闭 | workspace 不下发 Dock 配置，前端不渲染；`POST /b/v1/queries` 对该租户 404 |
| 合成数据（A7） | 生成意图/视图种子时跳过已关闭 feature 绑定项 |
| 场景入口配置（B5） | 配置页中引用已关闭视图的 SceneEntry 标"功能未开通"警示，不生效 |

## 6. 中台配置页（前端新增 /admin/features，角色 `catalog_admin`）

- **租户功能树**：三层树形开关（VIEW→BLOCK→ACTION），父关子自动关且子项置灰；每项显示 level 徽章与绑定摘要（n 个意图 / n 个求解器）。
- **角色覆盖 Tab**：选角色 → 在租户已开通集合内做收窄开关；试图开启租户未购项 → 控件禁用 + tooltip「租户未开通」。
- **预览**：「以角色预览」按钮 → 弹层模拟该角色的导航与视图列表（调 workspace 解析接口的 preview 参数，不切换会话）。
- **保存与生效**：保存即 configVersion+1 并写审计（变更 diff）；前端生效机制——workspace 响应携带 configVersion，SPA 在路由切换时比对（轻量 HEAD 请求，TTL 5min），失配则静默重拉 workspace 并更新导航；正在浏览的视图若被关闭 → 跳转首页 + toast「该功能已被管理员关闭」。

### API
```
GET  /a/v1/features/registry                 全量注册表（中台树渲染用）
GET  /a/v1/tenants/{id}/features             解析后的生效集（含 configVersion；B 侧消费同此）
PUT  /a/v1/tenants/{id}/features             Body: { overrides }（租户层）
PUT  /a/v1/tenants/{id}/features/roles/{role}
GET  /a/v1/tenants/{id}/features/preview?role=
GET  /a/v1/tenants/{id}/features/audit
```

## 7. 对既有 PRD 的修订点

1. 平台 PRD §6.1：workspace 响应增加 `features` 与 `configVersion`；IndustryTemplate 增加 `features` 默认集。
2. 前端 PRD §3/§8：路由守卫在角色判断前先查 feature（404 优先于 403）；新增 `useFeature(key)` hook 与 `<Feature flag>` 组件，BLOCK/ACTION 级控制点全部经此（禁止散落 if）。
3. QOS-PRD §5.1：候选收窄追加 feature 过滤条件（§5 表第一行）。
4. 求解器增量 PRD §0 契约：`/b/v1/solvers/{key}/run` 增加 entitlement 校验。

## 8. 验收用例增量

| # | 用例 | 预期 |
|---|---|---|
| E1 | 中台关闭租户的 `view.plan-audit` | 该租户用户：导航无此项；直访 /v/plan-audit → 404 页；`plan_audit` 求解端点 404；对话问"帮我体检计划" → 不命中相关意图（走兜底或提示换问法） |
| E2 | 角色覆盖：租户开通但对 `base_manager` 关闭 `act.adopt-to-draft` | 该角色四个推演视图的采纳按钮均不渲染；planner 正常 |
| E3 | 关闭 `qos.agent-fallback` | 目录外问题不再进路径 B，返回换问法提示+意图列表 |
| E4 | 父子级联 | 关 `view.project-sim` 后其 BLOCK/ACTION 子项在中台树自动置灰且生效集中消失 |
| E5 | 生效机制 | 管理员保存后，已登录用户在下次路由切换时导航更新；正浏览被关视图 → 跳首页+toast |
| E6 | 角色不可越权开通 | 角色覆盖尝试开启租户未购项 → 控件禁用；API 直调 → 422 `ROLE_CANNOT_EXCEED_TENANT` |
| E7 | 合成数据联动 | 关闭 `view.plan-audit` 后重跑合成任务 → 不生成体检相关意图种子 |
