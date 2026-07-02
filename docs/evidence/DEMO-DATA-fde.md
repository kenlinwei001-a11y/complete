# WO-DEMO-DATA · FDE 真实交付证据（依赖型空页开箱 · T4 · G-VIS-1）

**WO**：demo 数据补全——一批依赖型页（OEE 14 日趋势 / 运营回顾 / history-bundle）空态，共根 = demo 缺 `livedIn:true` 合成作业。

**根因**（真定位）：`apps/datacore/src/seed.ts:258` `const livedIn = process.env.SEED_LIVED_IN === "1";` —— demo 默认**不跑 livedIn**（标准合成后不回放一年）；`apps/datacore/src/livedin/bundle.ts:33` 无 livedIn 快照时 `GET /a/v1/history/bundle` 显式 `404 (run a synthetic job with livedIn:true first)`。

**决策**（用户亲定·2 项）：① livedIn 启用 = **部署配置启用**（非 seed 默认 on·非轻量补种）；② rule-docs/decisions/evals/quarantine 等 = **诚实空态即可**（需真实运营动作才产数据·demo 不硬塞样本）。

---

## 1. 改了什么（部署配置·additive·零代码回归）

- `docker-compose.yml` datacore：加 `SEED_LIVED_IN: ${SEED_LIVED_IN:-1}`——**部署态 demo 容器开箱跑 livedIn**（标准合成→回放一年 T−365d→T0），OEE/运营回顾/history-bundle 有数据。本地 dev（`node dist/server.js`）不设此变量 → 保持快启（可 opt-in `SEED_LIVED_IN=1`）。幂等·R6 确定性。
- `DEPLOY.md §6`：环境变量表加 `SEED_LIVED_IN` 说明 + 诚实边界（其余子系统需真实运营动作·不硬塞）。
- **无产品代码改动**（seed.ts 门保持 opt-in·未改默认）——纯部署配置 + 文档。

## 2. 真跑实证（前后端逐值对照）

**后端 curl**（datacore :4111·`SEED_DEMO=1 SEED_LIVED_IN=1` 真 boot vs :4101 无 livedIn）：

| 端点 | 无 livedIn（4101） | livedIn（4111） |
|---|---|---|
| `GET /a/v1/history/bundle` | **404**（no livedIn snapshot） | **200**（有数据） |

**真浏览器**（前端真构建指向 4111 livedIn datacore·admin 登录·`/v/review` 运营回顾）：

| 断言 | 无 livedIn | livedIn（真浏览器所见） |
|---|---|---|
| 运营回顾页 | 整页空 / 404「先运行 livedIn 合成」 | **4 张表 · 47 行数据**·无空态/404/「先运行」文案（`has 空/404/先运行: false`）✓ |

证据 `docs/evidence/screens/DEMO-DATA-review-livedin.png`。

## 3. 边界 / 距北极星（诚实）
- ✅ **真做到**：部署态 demo 开箱 livedIn（OEE/运营回顾/history-bundle 有数据·真 boot 200 vs 404·真浏览器运营回顾 47 行）。根因解（demo 缺 livedIn）而非省事（未硬塞快照/未改 seed 默认拖慢本地）。
- ⚠ **诚实边界**（用户亲定·不作假）：rule-docs / decisions / evals / quarantine / llm-providers 等子系统**保持诚实空态**——这些需真实运营动作（跑 eval、抽 rule-doc、记 decision、配 provider）才产数据，demo 不塞样本冒充运营记录（前端已诚实空态·非 bug·审核方已注明）。
- 🔭 **下一步**：如需这些子系统开箱非空，属各自「触发一次运行」的独立 WO（非本 livedIn 共根）；本 WO 只治 livedIn 依赖型空页。

## 4. 门（本轮）
无产品代码改动（docker-compose + DEPLOY.md 非编译产物）；`pnpm gates` 绿（含 ontology-slices:check·本体回写已同步切片）。
