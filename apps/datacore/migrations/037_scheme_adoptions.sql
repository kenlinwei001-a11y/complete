-- 037_scheme_adoptions.sql
-- WO-ADOPT-SCHEME-CARRIER · 方案采纳台账（G-ADOPT-SCHEME-NO-CARRIER 收口）。
--
-- 为什么是独立一张表而不是照 AdoptedMitigation/ForecastAdoption 走 objects 通用对象仓储：
--   · 工单硬约定：新增对象类型同时改四处（migrations + repo/pg + repo/memory + repo 接口）。
--   · 本体语义：它是**公司级年度拍板的审批留痕台账**（与 Decision 台账同族），
--     不是推演艺联的本体对象——plan_generate 的对象读取声明本就是空数组，
--     塞进 objects 会让它在本体图谱里冒充「可被推演关联的实体」（断点论据①警告的形态）。
--   · 读端只有一处：AOP 细化读端（PlanService.aop 的 schemeAdoption 段，按 year 取 ACTIVE 一条）。
--
-- 不变量：同 (tenant_id, year) 至多一条 ACTIVE（写时不变量，执行器先置旧 SUPERSEDED）。
-- ⛔ 业务裁定（勿改）：本表的 targets 是「拍板那一刻目标面板的快照」，只供对账；
--    采纳一个方案**不得覆盖**全局经营目标基线 PLAN_GOAL_TARGETS。
CREATE TABLE IF NOT EXISTS scheme_adoptions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- SchemeAdoption：
                                                      --   { adoptionId, year, schemeNo, pathKey, schemeName,
                                                      --     outcome{rev(归一指数base=100),gm(0-1),share(pct),turns(次),cash(亿),capex(亿)},
                                                      --     scores{...0-100}, hardViol[], targets{拍板快照·勿写回基线},
                                                      --     adoptedAt(确定性锚 forecastStart), actionDraftId, status }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 主查询形态就是「这个租户这一年度的现役采纳」，故索引落在 (tenant, year)。
CREATE INDEX IF NOT EXISTS scheme_adoptions_tenant_year
  ON scheme_adoptions(tenant_id, (doc->>'year'));
-- down: DROP TABLE IF EXISTS scheme_adoptions;
