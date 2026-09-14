-- 029_process_definitions.sql
-- 业务流程层（承载 S5 的 13 域 × 65 流程）。配置驱动，可增删改——与冻结的 CHAIN_NODE_REGISTRY 相对。
CREATE TABLE IF NOT EXISTS process_definitions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessDefinition：
                                                      --   { key:"P40", domainKey:"D07", name, ownerFunctionKey,
                                                      --     stdDurationDays, waitKind, carrierTypeKey }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS process_definitions_tenant_key ON process_definitions(tenant_id, (doc->>'key'));
CREATE INDEX IF NOT EXISTS process_definitions_tenant_domain ON process_definitions(tenant_id, (doc->>'domainKey'));
-- down: DROP TABLE IF EXISTS process_definitions;

-- ── 一级业务域（PRD §4.2 的 DDL 只画了 process_definitions，域表是本单补的）────────────
-- 为什么域要单独一张表而不是塞进 doc：`domainKey` 是**外键语义**（65 条流程指向 13 个域），
-- 把域名/锚点复制进每条流程的 doc = 65 份副本，改一次域名要改 65 行 —— 那是第二真相源的做法。
-- `business_domain_key` 锚到 graphmeta.ts 的 BUSINESS_DOMAINS（14 域注册表，已有路由与门），
-- 防止流程层凭空造出第二套业务域词表（见 contracts/src/process.ts §3 注释）。
CREATE TABLE IF NOT EXISTS process_domains (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessDomain：
                                                      --   { key:"D07", name, businessDomainKey, order }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS process_domains_tenant_key ON process_domains(tenant_id, (doc->>'key'));
-- down: DROP TABLE IF EXISTS process_domains;
