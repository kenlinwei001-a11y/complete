-- 041_ontology_graph.sql
-- WO-ONTOGRAPH-DB · 本体图谱（机器抽取面）出仓入库。
--
-- ══ 这四张表为什么存在 ════════════════════════════════════════════════════
-- `docs/ontology-graph/` 的 YAML 产物实测 **154,518 行 / 6.5 MB**，占该目录 97.3%，
-- 而它 **100% 从源码抽取、零人工维护字段** —— 它是快照，不是源码。
-- 快照进 git 的三笔实际代价：① 每次抽取产生六位数行的 diff，把真实改动淹掉；
-- ② clone/fetch 带着历次快照的全量副本；③ 「改了 YAML」与「改了抽取器」在 review 里同形。
-- 仓主原话：「15 万行数据不应该进入代码，而是在后台数据库里面」。
--
-- ══ 为什么四张而不是一张 ══════════════════════════════════════════════════
-- 四种东西的**基数差三个数量级**：快照 1 · 切片 47 · 原子 6,266 · 边 21,032。
-- 合成一张会逼每个读者为了拿 INDEX 的 47 行切片目录去扫两万行；分开后
-- 「只读索引就能回答哪条切片覆盖 rootType=X」这条设计承诺在 SQL 层照旧成立。
--
-- ══ 为什么全是 doc-jsonb（与 026/030/033/037 同一模子）═══════════════════
-- 八种边的**字段集合互不相同**（registers 带 confidence、seeds 带 count、
-- asserts 带 line、inSlice 带 via 且没有 pkg）。逐列建表要么建成稀疏宽表，
-- 要么每加一种边就加一次 migration。`PgStore` 的 doc-jsonb 假设与本表逐字吻合，
-- 于是两个实现都能直接复用它（含它那三条已经踩过的坑：同批 id 去重 / 绑定参数
-- 65535 上限按列数反算 chunk / extraColumns 取并集）。
--
-- ══ R6 确定性：⛔ doc 里不许有时间戳 ══════════════════════════════════════
-- `created_at` 由 pg 自己打，**不进 doc、不参与任何对账**。判据是
-- 「同一 commit 连落两次，库里读回的 doc 逐字节相同」——
-- 谁往 doc 里塞 generatedAt，这条命题当场失效而且**不会报错**。
--
-- ══ R2 tenant_id everywhere ══════════════════════════════════════════════
-- 四张表都带 tenant_id 且每条读路径都带上它。`snapshot_id` 本身已含租户前缀
-- （`${tenantId}:${generatedFrom}`），但**不许**拿"id 里有租户名"当租户闸 ——
-- 那是拿命名约定当权限，正是本仓 `getPropagationRule` 注释里记着的那个坑。

-- ── 快照（一次抽取 = 一行）。doc = INDEX.yaml 全文，一个键都不裁 ──────────
CREATE TABLE IF NOT EXISTS ontograph_snapshot (
  id              TEXT PRIMARY KEY,              -- `${tenant_id}:${generated_from}`
  tenant_id       TEXT NOT NULL,                 -- R2
  generated_from  TEXT NOT NULL,                 -- 抽取时 HEAD 短 hash（INDEX.generatedFrom）
  doc             JSONB NOT NULL,                -- INDEX 全文：counts/byState 两套口径/canary/
                                                 -- blindSpots/registries/fieldStats/atomShards/slices
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontograph_snapshot_tenant
  ON ontograph_snapshot(tenant_id, generated_from);

-- ── 原子（6,266 行量级）───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ontograph_atom (
  id           TEXT PRIMARY KEY,                 -- `${snapshot_id}:${atom_id}`
  tenant_id    TEXT NOT NULL,                    -- R2
  snapshot_id  TEXT NOT NULL,
  atom_id      TEXT NOT NULL,                    -- 抽取器的 `sym:<file>:<name>`，快照内唯一
  pkg          TEXT NOT NULL,                    -- 分片维度（= atoms/<pkg>.yaml 的 pkg）
  doc          JSONB NOT NULL,                   -- 原子全文（含 inbound 三计数与两份坐标样例）
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 主查询形态两种：① 整快照全取（自检器加载） ② 按包取一片（对应 atoms/<pkg>.yaml）。
CREATE INDEX IF NOT EXISTS ontograph_atom_snapshot
  ON ontograph_atom(tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS ontograph_atom_pkg
  ON ontograph_atom(tenant_id, snapshot_id, pkg);

-- ── 边（21,032 行量级）────────────────────────────────────────────────────
-- ⚠ id 是**排序后的序号**不是 (kind,from,to)：同一三元组可以合法重复出现
--   （同一测试文件在两行各钉一次同一个字段）。拿三元组当主键 = 静默去重 =
--   「落库丢了数据」而两侧都不报错。序号来自一次显式排序，故 R6 成立。
CREATE TABLE IF NOT EXISTS ontograph_edge (
  id           TEXT PRIMARY KEY,                 -- `${snapshot_id}:edge:${ordinal}`
  tenant_id    TEXT NOT NULL,                    -- R2
  snapshot_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,                    -- 八种之一（提列只为「按种类数一数」不必解 jsonb）
  doc          JSONB NOT NULL,                   -- {kind,from,to,pkg?,line?,count?,confidence?,via?}
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontograph_edge_snapshot
  ON ontograph_edge(tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS ontograph_edge_kind
  ON ontograph_edge(tenant_id, snapshot_id, kind);

-- ── 切片（47 行量级；一份 slices/<key>.yaml = 一行）──────────────────────
CREATE TABLE IF NOT EXISTS ontograph_slice (
  id           TEXT PRIMARY KEY,                 -- `${snapshot_id}:slice:${slice_key}`
  tenant_id    TEXT NOT NULL,                    -- R2
  snapshot_id  TEXT NOT NULL,
  slice_key    TEXT NOT NULL,
  doc          JSONB NOT NULL,                   -- 切片全文（spannedTypes/paths/tokens/atoms/consumers…）
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontograph_slice_snapshot
  ON ontograph_slice(tenant_id, snapshot_id);

-- down（R9 可回退；additive 新表，不影响既有）:
--   DROP TABLE IF EXISTS ontograph_slice;
--   DROP TABLE IF EXISTS ontograph_edge;
--   DROP TABLE IF EXISTS ontograph_atom;
--   DROP TABLE IF EXISTS ontograph_snapshot;
