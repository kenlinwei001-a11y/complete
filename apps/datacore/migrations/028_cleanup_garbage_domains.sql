-- WO-4 ③：一次性清理历史"探针垃圾域"残留（CONN_GARBAGE_*/FdeProbe* 测试探针经旧 setDomain 漏洞落库的
-- 幽灵类型/域分组）。归域门收紧（modeling.ts setDomain/publishDraft 约束 14 合法业务域 enum）后不再产生新垃圾。
-- 安全：仅按**测试探针 key/域前缀**精确删除（CONN_GARBAGE/FdeProbe/conn_ 域），不触碰真实业务类型；幂等。
-- 备注：本仓 demo 走内存仓储每次重播净世界、无此残留；本迁移服务 pg 部署的历史脏数据。

-- 1) 删除探针 key 命名的幽灵对象类型（明确测试制品）。
DELETE FROM ontology_types
 WHERE doc->>'key' LIKE 'CONN_GARBAGE%'
    OR doc->>'key' LIKE 'FdeProbe%'
    OR doc->>'key' LIKE 'FdeProbeBogus%';

-- 2) 误归到 connId 当域（conn_xxx / CONN_GARBAGE_* 域）的真实类型：复位为 unassigned（不删，待人工重归真域）。
UPDATE ontology_types
   SET doc = jsonb_set(doc, '{domain}', '"unassigned"'::jsonb)
 WHERE doc->>'domain' LIKE 'conn_%'
    OR doc->>'domain' LIKE 'CONN_GARBAGE%'
    OR doc->>'domain' LIKE 'FdeProbe%';
