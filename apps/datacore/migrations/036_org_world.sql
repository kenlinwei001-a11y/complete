-- 032_org_world.sql
-- WO-ORG-WORLD · 组织世界（七世界之②）。仓主原话：「真实企业最重要的不是机器，而是人。」
-- 让系统能回答「为什么这个流程现在卡住了」——答案常在人侧：没人有那么大额度 / 有额度的人不在岗 /
-- 跨基地这件事谁都批不了。
--
-- R9 仓储双实现：本文件与 repo/memory.ts（MemStore）+ repo/pg.ts（PgStore）+ repo.ts（Store<T> 接口）
-- **四处同改**，一处漏 = pg 模式静默少一张表。
-- R2：每表 tenant_id 隔离，读写一律经 Store 的租户过滤（跨租户 403/404）。
--
-- ⚠️ 为什么 org_principals 是一张表而不是塞进 ObjectInstance：
--   既有 synthetic `Principal` 对象型（battery.ts）承载的是**指标责任人**（7 条 org/role，无人、无职权），
--   且其实例数被 `demo-chain-provenance.test.ts:102` 的金值（11320）逐条咬死。组织世界要加的是
--   **治理数据**（人/职权/额度/代理），不是合成业务对象 —— 混进去既会踩金值，也会让通用图求解器
--   把审批额度当成业务指标去推断角色。两者**同一个契约类型**（OrgPrincipalSchema = PrincipalSchema.extend）、
--   不同承载层，这不是第二个身份类型。

CREATE TABLE IF NOT EXISTS org_principals (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- OrgPrincipal（contracts/org-world.ts）：
                                                      --   { principalId, name, kind:"org"|"role"|"person",
                                                      --     parentRef, orgKey, title, roleRefs[], platformRoles[],
                                                      --     available, workload }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_principals_tenant ON org_principals(tenant_id);
-- 匹配面索引一律建在**机器键**上，不建在中文 name 上（#139：判定路径从不读 name）。
CREATE INDEX IF NOT EXISTS org_principals_tenant_key ON org_principals(tenant_id, (doc->>'orgKey'));
CREATE INDEX IF NOT EXISTS org_principals_tenant_kind ON org_principals(tenant_id, (doc->>'kind'));

CREATE TABLE IF NOT EXISTS org_authorities (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- Authority：
                                                      --   { authorityKey, principalRef, scope, escalationRank, name }
                                                      -- escalationRank 刻意不叫 level（level 撞 ROLE_LEXICON.priority·#139）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_authorities_tenant ON org_authorities(tenant_id);
CREATE INDEX IF NOT EXISTS org_authorities_tenant_key ON org_authorities(tenant_id, (doc->>'authorityKey'));
CREATE INDEX IF NOT EXISTS org_authorities_tenant_scope ON org_authorities(tenant_id, (doc->>'scope'));

CREATE TABLE IF NOT EXISTS org_approval_limits (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ApprovalLimit：
                                                      --   { limitKey, authorityRef, maxOrderValue, minMarginPct,
                                                      --     maxCustomerImportance, allowCrossBase, maxInvestmentValue }
                                                      -- 黑名单维度 null=不设限；白名单维度（跨基地/资本投入）缺省不可批。
                                                      -- maxInvestmentValue 刻意不叫 maxCapexValue（cap 撞
                                                      -- ROLE_LEXICON.capacity·#139）。
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_approval_limits_tenant ON org_approval_limits(tenant_id);
CREATE INDEX IF NOT EXISTS org_approval_limits_tenant_auth ON org_approval_limits(tenant_id, (doc->>'authorityRef'));

CREATE TABLE IF NOT EXISTS org_delegations (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- Delegation：
                                                      --   { delegationKey, fromPrincipalRef, toPrincipalRef, scope,
                                                      --     activeFrom, activeTo, reason }
                                                      -- 生效窗口只在调用方显式传 asOf 时参与判定（R6 不读时钟）。
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_delegations_tenant ON org_delegations(tenant_id);
CREATE INDEX IF NOT EXISTS org_delegations_tenant_from ON org_delegations(tenant_id, (doc->>'fromPrincipalRef'));

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS org_delegations;
--   DROP TABLE IF EXISTS org_approval_limits;
--   DROP TABLE IF EXISTS org_authorities;
--   DROP TABLE IF EXISTS org_principals;
