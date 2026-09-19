-- WO-69 P3 · 对象接口（ObjectInterface = 多态抽象）一等表。
-- 一个 (tenant_id, key, version) 一行 —— **多版本共存**是"开闭/演进"的物理基础：
-- 改接口 = 新增一个版本，pin 在旧版本的已发布实现者不会被悄悄弄失效。
-- 行业无关；doc 为 jsonb 通用列（换行业不改表）。
-- R9 仓储双实现：与 repo/memory.ts（objectInterfaces: MemStore）+ pg.ts（PgStore(pool,"object_interfaces")）
-- + repo/repo.ts（objectInterfaces: Store<ObjectInterfaceRecord>）接口同步。R2：tenant_id 隔离。
CREATE TABLE IF NOT EXISTS object_interfaces (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                           -- R2
  doc         JSONB NOT NULL,                          -- ObjectInterface（contracts/object-interface.ts）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS object_interfaces_tenant ON object_interfaces(tenant_id);
CREATE INDEX IF NOT EXISTS object_interfaces_tenant_key ON object_interfaces(tenant_id, (doc->>'key'));
-- 同一租户下 key+version 唯一（版本共存但不重复）
CREATE UNIQUE INDEX IF NOT EXISTS object_interfaces_tenant_key_version
  ON object_interfaces(tenant_id, (doc->>'key'), (doc->>'version'));

-- down（R9 可回退，additive 新表不影响既有；object_types.doc 上的 implements 字段为可选扩展，回退后被忽略）:
--   DROP TABLE IF EXISTS object_interfaces;
