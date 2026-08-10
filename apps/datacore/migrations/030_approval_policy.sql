-- 030_approval_policy.sql
-- WO-APPROVAL-POLICY · 批复策略引擎。批复链由「业务规则 × 组织权限」动态生成，不写死在 Workflow 里。
--
-- 🔴 三张表**没有一个字段指向业务流程**（无 process_key / 无 process_definition_id）：
--    这是正交性的存储层落点。业务节点只发出「需要批复 + 上下文事实」（facts），
--    由引擎按策略求值出链条。谁想把批复链焊回某条业务流程，在这个 schema 里没有地方放。
--    反向也一样：`process_definitions`（029）一个字段都不因本单改动。

-- ── 组织权限最小面：权限位（谁有权签这一级）────────────────────────────────
-- 红线 3：只建引擎必需的一层。Person/OrgUnit/ApprovalLimit（金额上限）等**不在本单**，
-- 见 docs/WO-APPROVAL-POLICY-delivery.md §6「还缺什么」。
CREATE TABLE IF NOT EXISTS approval_authorities (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ApprovalAuthority：
                                                      --   { key:"planning_director", displayName, functionKey,
                                                      --     roleKey:"planner", level:20 }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_authorities_tenant_key ON approval_authorities(tenant_id, (doc->>'key'));
-- down: DROP TABLE IF EXISTS approval_authorities;

-- ── 批复策略：condition（规则 DSL）→ approval（权限位序列）──────────────────
-- `condition` 是 apps/datacore/src/ruledsl.ts 的表达式字符串（复用 A5 求值器，红线 2），
-- 阈值走 doc->'params' 的命名阈值（params.<名>），不把数字写进表达式 —— 「改一个数」是改数据。
CREATE TABLE IF NOT EXISTS approval_policies (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ApprovalPolicy：
                                                      --   { key, name, condition, params, approval:[...],
                                                      --     subjectKinds:[], priority, status }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_policies_tenant_key ON approval_policies(tenant_id, (doc->>'key'));
CREATE INDEX IF NOT EXISTS approval_policies_tenant_status ON approval_policies(tenant_id, (doc->>'status'));
-- down: DROP TABLE IF EXISTS approval_policies;

-- ── 批复实例：链条求值结果 + 状态机（承载物）────────────────────────────────
-- `facts` 存事实快照：链条是这堆事实在那一刻求出来的，不存就没有永久解释坐标
-- （同 actions.ts 快照 actionTypeVersion 的同一条理由）。
CREATE TABLE IF NOT EXISTS approval_instances (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ApprovalInstance：
                                                      --   { subjectKind, subjectKey, facts, matchedPolicyKeys,
                                                      --     tasks:[{seq,authorityKey,roleKey,level,status,...}],
                                                      --     status, createdBy, createdAt, updatedAt }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_instances_tenant_status ON approval_instances(tenant_id, (doc->>'status'));
CREATE INDEX IF NOT EXISTS approval_instances_tenant_subject ON approval_instances(tenant_id, (doc->>'subjectKind'), (doc->>'subjectKey'));
-- down: DROP TABLE IF EXISTS approval_instances;
