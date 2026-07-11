-- WO-IMPORT-SCENARIO（G3·PRD-enterprise-dataset-import §3.3）· 导入场景卡落库。
-- Stage 3.15 场景 JSON → 映射 IndustryScenario（决策卡 + 声明式 answer query）→ 经 GET /a/v1/scenarios/pack
-- 合入本租户场景包 → AgentCore 启动器目录消费（既有 datacore→agentcore 场景 seam·零 agentcore 改动）。
-- ⛔ R14：平台不含 Stage 3.15 业务语义（order_acceptance→哪个求解器等映射不写死平台）——answer query 由调用方给
-- 或缺省 objects 直列；presetContext.selectedObjects 对已物化对象库解析（对不上 → 诚实 gap·不造幽灵引用）。
-- R9 仓储双实现：与 repo/memory.ts（MemStore）+ pg.ts（new PgStore(pool,"imported_scenarios")）+ repo.ts 接口同步。
-- 列约定与通用 PgStore 一致（整条 ImportedScenarioRecord 序列化进 doc JSONB；id = scenario key）。
-- R2 tenant_id 隔离；读写一律 tenantId 限定（跨租户 404）。R6 确定性：同 JSON 同映射字节一致（无时钟/随机入内容）。
CREATE TABLE IF NOT EXISTS imported_scenarios (
  id TEXT PRIMARY KEY,                       -- = `${tenantId}:${scenarioKey}`（同租户同 key 幂等覆盖）
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                        -- ImportedScenarioRecord 整条
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_imported_scenarios_tenant ON imported_scenarios(tenant_id);

-- down（R9 可回退·additive 新表·业务真值零损·导入卡可重导重生·RL9）:
--   DROP INDEX IF EXISTS idx_imported_scenarios_tenant;
--   DROP TABLE IF EXISTS imported_scenarios;
