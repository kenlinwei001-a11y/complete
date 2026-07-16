# 前端跨 Agent 变更日志

## 变更状态追踪

| 日期 | 变更 ID | 描述 | 作者 | 状态 |
|------|---------|------|------|------|
| 2026-07-07 | FE-2026-0707-001 | 20+ Admin 页面统一添加 createdAt/createdBy 字段 | Claude | 待确认 |
| 2026-07-07 | FE-2026-0707-002 | ConnectionsPage 改为行模式 + 多字段筛选 | Claude | 已实施 |

---

## FE-2026-0707-001: Admin 页面 createdAt/createdBy 字段统一

### 背景
用户要求在所有 Admin 页面添加创建时间和创建人字段，系统生成数据 creator 显示为"模拟"，用户创建数据显示实际用户名。

### 影响范围
共涉及 **20+ 个 Admin 页面**，分为以下类别：

#### 1. CARD 模式页面（左列表 + 右编辑器）
需在左侧列表按钮上添加时间/创建人信息

| 页面 | 路径 | 当前显示字段 |
|------|------|-------------|
| AgentsPage | `/admin/agents` | status badge + name |
| SkillsPage | `/admin/skills` | status badge + name + version |
| WorkflowsPage | `/admin/workflows` | select dropdown (name + version + status) |
| McpPage | `/admin/mcp` | status badge + name |
| CatalogPage | `/admin/catalog` | status badge + name + version (意图列表) |
| KnowledgePage | `/admin/knowledge` | 知识库名称列表 |

#### 2. TABLE 模式页面（已有表格）
需添加 createdAt/createdBy 列，按创建时间倒序

| 页面 | 路径 | 当前显示字段 | 已有时间字段 |
|------|------|-------------|-------------|
| ConnectionsPage | `/admin/connections` | name, type, category, status, health, lastSyncAt, error | lastSyncAt |
| ScenesPage | `/admin/scenes` | 场景, 交互模式, 落点视图, 意图, presetContext, 引用闭合, 状态 | - |
| SlicesPage | `/admin/slices` | sliceKey, version, rootType, hops, linkKeys, maxNodes, fixtures | - |
| SolversPage | `/admin/solvers` | key, name, description, argHints, outputShape | - |
| ActionsPage | `/admin/actions` | ID, 类型, 状态, 创建时间 | createdAt ✅ |
| LlmProvidersPage | `/admin/llm-providers` | 名称, kind, 状态, 模型数, 密钥, 降级目标 | - |
| EvalsPage | `/admin/evals` | 套件, 通过率, 意图准确率, 工具正确率, parity失因, 平均时延, 模式 | - |
| TenantsPage | `/admin/tenants` | key, name, industry, status, createdAt | createdAt ✅ |
| UsersPage | `/admin/users` | email, displayName, roles, status, lastLoginAt | - |
| RulesPage | `/admin/rules` | key, name, 类型, severity, 作用域, 来源, 状态, version | - |
| DataBuilderPage | `/admin/data-builder` | runId, 状态, 步骤进度, createdAt | createdAt ✅ |

#### 3. 特殊模式页面

| 页面 | 路径 | 模式 | 备注 |
|------|------|------|------|
| FeaturesPage | `/admin/features` | 树形开关面板 | 无需添加 |

---

### 后端 Schema 变更需求

#### 需要新增 createdAt/createdBy 的资源类型

| 资源类型 | 当前已有字段 | 需新增字段 | 影响后端 |
|---------|-------------|-----------|---------|
| `AgentDefinition` | id, key, version, name, status... | createdAt, createdBy | ✅ 是 |
| `SkillDefinition` | id, key, version, name, status... | createdAt, createdBy | ✅ 是 |
| `McpServerConfig` | id, name, status, version, lifecycle... | createdAt, createdBy | ✅ 是 |
| `ConnectionInstance` | id, name, status, lastSyncAt, category... | createdAt, createdBy | ✅ 是 |
| `WorkflowDefinition` | id, key, version, name, status, **createdAt, updatedAt** | createdBy | ✅ 是 (部分已有) |
| `SceneEntryConfig` | id, viewKey, mode... | createdAt, createdBy | ✅ 是 |
| `Scenario` | id, scenarioKey... | createdAt, createdBy | ✅ 是 |
| `OntologySlice` | sliceKey, version... | createdAt, createdBy | ✅ 是 |

#### 已有类似字段的资源类型

| 资源类型 | 已有字段 | 说明 |
|---------|---------|------|
| `RuleEntry` | definedAt, definedBy | 语义等同于 createdAt/createdBy，无需新增 |
| `ActionDraft` | createdAt | 已有，无需新增 |
| `Tenant` | createdAt | 已有，无需新增 |
| `StoryBuildRun` | createdAt | 已有，无需新增 |

---

### 数据填充规则

#### 1. 历史数据迁移
- **createdAt**: 默认填充为 `1970-01-01T00:00:00Z` 或当前时间
- **createdBy**: 默认填充为 `"system"` 或 `"模拟"`

#### 2. 新数据创建
- **createdAt**: 当前服务器时间 ISO8601 格式
- **createdBy**: 当前操作用户的 `userId` 或 `username`

#### 3. 系统生成数据（模拟数据）
- **createdBy**: 固定为 `"模拟"`
- **createdAt**: 数据生成时间

#### 4. 用户创建数据
- **createdBy**: 实际用户标识（如 `usr_demo_admin` 或 `admin`）

---

### 回滚方案

#### 前端回滚
1. 所有变更在一个独立的 commit 中
2. 回滚命令: `git revert <commit-hash>`
3. 备选: 使用 feature flag 控制显示/隐藏

#### 后端回滚
1. 数据库迁移使用迁移文件 (migration)
2. 回滚: `pnpm --filter datacore migrate:down` 或 `pnpm --filter agentcore migrate:down`
3. 契约层保持向后兼容（新增 optional 字段）

---

### 开发检查清单

- [ ] 用户确认字段清单
- [ ] 后端 Agent 更新契约 (contracts)
- [ ] 后端 Agent 更新仓储接口
- [ ] 后端 Agent 更新 PG 实现
- [ ] 后端 Agent 更新 Memory 实现
- [ ] 后端 Agent 添加数据库迁移
- [ ] 前端 Agent 更新 CARD 模式页面 (6个)
- [ ] 前端 Agent 更新 TABLE 模式页面 (11个)
- [ ] 所有列表按 createdAt 倒序排序
- [ ] 集成测试

---

## FE-2026-0707-002: ConnectionsPage 行模式改造

### 变更内容
将 `ConnectionsPage` 从 TABLE 模式改为行模式（Row Mode），并添加多字段筛选功能。

### 具体改动
1. **移除**: `<table className="cmp">` 表格布局
2. **新增**: `ConnectionRow` 组件 - 每行一个连接卡片
3. **新增筛选字段**:
   - 名称搜索 (text input)
   - 归类筛选 (select)
   - 状态筛选 (select: ACTIVE/ERROR/INACTIVE)
   - 类型筛选 (select: 动态从 connections 提取)
4. **新增排序**: 创建时间 / 最后同步 / 名称，支持升序/降序切换

### 文件变更
- `apps/frontend-shell/src/pages/admin/ConnectionsPage.tsx`

### 回滚
- 前端: revert 对应 commit
- 后端: 无变更

---

## 跨 Agent 同步说明

### 如何同步
1. 此文档位于 `docs/PRD-frontend-changelog.md`
2. 所有 Agent 启动时应先读取此文档
3. 变更状态使用上述表格追踪

### 冲突解决
- 同一页面多 Agent 修改时，按以下优先级:
  1. 后端契约变更优先
  2. 功能完整性优先
  3. 代码审查 (PR Review)

### 沟通渠道
- 文档注释标注负责人
- Task 系统分配任务

---

*最后更新: 2026-07-07 by Claude*
