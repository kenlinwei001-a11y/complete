# WO-DATAMODE-UNIFY-PROVENANCE — FDE 真实证据（铁律 0.4）

**P0 · 用户第一优先 · 系统性 KILL-MOCK-RED 根 · 违铁律 0.4 的「合成冒充 LIVE」**
Dev-1 backend · 2026-07-12 · 遵**已裁决方案**（`docs/work-queue.json` reviewerRuling · commit `ad60266` · 用户钉死「两正交维」）。

## 0. 根因（三症同根）

demo 决策对象是 **MATERIALIZED-from-synthetic**：B 路建模链（`synthetic/service.ts instantiateBattery(chainMode)` · `viaModelingChain:true`）从 `config.synthetic===true` 的合成数据源连接物化 → 对象 `origin={type:"MATERIALIZED", datasetId:<合成源 rawDataset>}`（provenance 因果真实但底仍是合成源）。权威判据 `isSyntheticDecision`（`solvers/service.ts`）识别这一类（`origin.type===SYNTHETIC || (MATERIALIZED && synthDatasetIds.has(datasetId))`），但此前**内联私有**；三处 dataMode 站点用弱判据（只看 `origin.type==="SYNTHETIC"`）→ 漏 MATERIALIZED-from-synthetic → demo 合成世界被误标 **LIVE/实测**。

**静态门/夹具漏此运行期 bug**：既有 `sim-trust-badge.test.ts` 夹具直设 `origin=SYNTHETIC`（干净），全绿；真 demo 链产 `origin=MATERIALIZED`，判据不同源 → nodeObjectMode 102/102 LIVE（TRUST-BADGE-BE 收口时误报 "honest LIVE"）。

## 1. 方案（遵裁决 · 两正交维 · 非 dev4 探路的错层）

裁决（`ad60266`）判定「下沉 `isSyntheticDecision` 到 `lt.source`」为**错层**——污染 measurement 维、破 6 测（CAP-01 C1 + solvers V5/V5d + FRESHNESS①/①b）。系统 dataMode 是**两正交维**：

- ① **provenance 维**（合成种子）：`isSyntheticDecision` / `confidence.synthetic` / `nodeObjectMode` 徽标。
- ② **measurement 维**（读真 OEE/util/真供需即 LIVE，即便合成种子）：`liveTightness.source` / `card.dataMode` / `row.live`。

**决策级染红 = provenance(非合成) AND measurement(真实测) 双维**。后端职责：**不动 measurement 维**（CAP-01『DemandSegment=LIVE』保留），修 provenance 维 + 加性透出 provenance 信号供前端双维 gate。

### 复用的唯一真相谓词（抽出·非新造）
`SolverService.buildSynthProvenancePredicate(tenantId): (o)=>boolean` —— 把 `isSyntheticDecision` 内联的逐对象判据抽为可复用谓词（synthDatasetIds 缓存 `synthDatasetIdsByTenant`·`invalidateConfidenceCache` 清）。`isSyntheticDecision` 本身复用它（**行为字节不变**·FRESHNESS 全绿佐证）。`loadContext` 注入 `SolverContext.isSynthProvenance`。

### 三处站点（before → after）
| # | 站点 | before | after |
|---|---|---|---|
| ① | `app.ts deriveCellMode`（nodeObjectMode·provenance 徽标·backend gate） | `originType==="SYNTHETIC" ? SYNTHETIC : criticalStale ? STALE : LIVE`（漏 MATERIALIZED-from-synthetic → **102/102 LIVE**） | `isSynthProvenance(obj) ? SYNTHETIC : criticalStale ? STALE : LIVE` → **102/102 SYNTHETIC**；真对象仍 LIVE（honest inverse） |
| ② | `risk.ts` risk 卡 | 仅 `card.dataMode`（measurement·demo=LIVE），前端 `cardDecisionMode` 只看 dataMode==LIVE → 决策红 | measurement **不动**（dataMode 保持 LIVE）；**加性** `provenanceSynthetic` 位（卡底层 Base+需求源合成物化→true）供前端双维 gate |
| ③ | `capacity.ts` perBaseRows | 仅 `live=lt.live`（measurement），前端逐行只看 live → 决策红 | measurement **不动**（`live` 保持）；**加性** `provenanceSynthetic` 位（基地对象合成物化→true） |

> ⚠ **未 backend-only 可闭半（诚实边界）**：risk 卡 / capacity 行的**决策级染红收窄**（provenance ∧ measurement 双维）落点是前端 `RiskBoardView.tsx:138 cardDecisionMode` + capacity 逐行 gate = **Dev-3 前端**（后端已备双维信号：`provenanceSynthetic` per-object + `confidence.synthetic` tenant 级）。裁决明示不可 backend-only（否则破 measurement 维 6 测）。

## 2. 真起服务 FDE（真起 dist/server.js · SEED_DEMO=1 · 真 viaModelingChain 链 · curl 真读）

`PORT=4051 JWT_SECRET=dev BLOB_DIR=… SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js` · `/healthz` 200 就绪 · `X-Debug-User: demo:admin:admin`。

### 齿①（headline）`GET /a/v1/sim/view-config` → nodeObjectMode
```
cells 102  objects 102  tally {'SYNTHETIC': 102}
```
**before（WO/TRUST-BADGE-BE FDE 报告）：102/102 LIVE**（合成物化冒充实测·bug）。
**after（本 WO·真服务实测）：102/102 SYNTHETIC**（provenance 徽标诚实标合成物化）。

### 齿② `POST /a/v1/solvers/risk_timeline/invoke` → cards
```
top dataMode SYNTHETIC  confidence.synthetic True
data-cards 8  dataMode tally {'LIVE': 8}  provenanceSynthetic tally {True: 8}
sample [{'f':'瓶颈工序','dm':'LIVE','ps':True}, {'f':'瓶颈工序','dm':'LIVE','ps':True}]
```
measurement 维 `dataMode=LIVE` 保留（读真供需·CAP-01/V5/V5d 不回归）；provenance 维 `provenanceSynthetic=true` + 顶层 `confidence.synthetic=true` → 前端双维 gate 可静音决策红。

### 齿③ `POST /a/v1/solvers/capacity_forecast/invoke {modelId:4680-NCM,qty:40,weeks:6}` → perBaseRows
```
top dataMode SYNTHETIC  confidence.synthetic True
rows [{'b':'常州','live':True,'ps':True},{'b':'成都','live':True,'ps':True},{'b':'合肥','live':True,'ps':True}]
```
`live` 保持 measurement 语义；`provenanceSynthetic=true` 逐行透出。

## 3. green→red 运行期齿（`test/datamode-unify-provenance.test.ts` · 真起 app+inject · 真 viaModelingChain 链）

- **齿①**（headline）：nodeObjectMode 102/102 SYNTHETIC + **red-bite**：复算旧 `origin.type-only` 判据对这些 MATERIALIZED 对象 → 零 SYNTHETIC（新鲜 → 全 LIVE），即 revert 后翻回 LIVE（bug 咬住）。
- **齿②**：card.dataMode 保持 LIVE（measurement 不回归）+ provenanceSynthetic=true + confidence.synthetic=true；**red-bite**：`loadContext` 去谓词（旧后端）→ provenanceSynthetic 全 false → 前端只剩 dataMode==LIVE → 误染红。
- **齿③**：perBaseRows provenanceSynthetic=true + confidence.synthetic=true；**red-bite**：去谓词 → 全 false。
- **齿④**（honest inverse·非过度纠偏）：真接入对象（MATERIALIZED·datasetId∉合成集）→ nodeObjectMode 保持 LIVE + `buildSynthProvenancePredicate` 判其为 false（真对象照常实测·非「全盘 SYNTHETIC 锤」）。
- **齿⑤**：R6 同输入双跑 nodeObjectMode 逐位字节一致。

单文件：`5 passed`。

## 4. 回归 / 门

- **datacore 全量**：`1270 passed | 15 skipped`（**0 failed**）——含 sim-certification / sim-trust-badge / risk-* / capacity-* / wo-cap-01-realdemand / solvers（V5/V5b/V5d/FRESHNESS①/①b）全绿。**首版曾破 6 测**（下沉 lt.source 的错层）→ 遵裁决改「不动 measurement + 加性 provenance 位」后全绿，佐证裁决正确、非弱化。
- 门：`datacore build` ✓ · `check-sim` ✓ · `check-genuine-sim` ✓ · `check-no-fake-data` ✓（决策路径无 hash 裸冒充）· `check-no-silent-mock` ✓ · `build-ontology-slices --check` ✓。
- 本体回写：§8 新增 `G-DATAMODE-PROVENANCE-LEAK`（◐ 后端半闭·前端 Dev-3 未落半）；§2.E / §G-DM-1 沙盘徽标叙述补两正交维 + `buildSynthProvenancePredicate`；切片已重生成一致。
