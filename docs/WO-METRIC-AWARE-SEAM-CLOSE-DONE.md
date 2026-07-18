# WO-METRIC-AWARE-SEAM-CLOSE · 交付说明（关掉 metric-aware 因果域接缝）

> **handoff 分支**：`claude/handoff-metric-aware-seam`（一条分支含数据绑定+引擎+C5+金值·一 dev 整单·不开 PR）
> **基线**：canonical `claude/vigilant-knuth-b1nmxn`（q7/cockpit-infer/unit-normalize/capacity 保留）+ merge ceo-data-2 数据。

## 病根（三方机制两两不对接）→ 修（选项A·数据×引擎一套机制握手）

| 半 | 病 | 修 |
|---|---|---|
| 数据 | `cf-{metric}-gap` 每指标边建好但**从未种 `boundMetricKeys`** | 4 个 gap 起点节点种 `boundMetricKeys`（share/rev/cash/demand）+ `CausalFactor += boundMetricKeys:json`·默认[] |
| 引擎 | BFS 起点**硬编码 `cf-cathode-shortage`**·无 metricKey 分支 | `startRoots = cfObjs.filter(boundMetricKeys⊇m.key) \|\| ["cf-cathode-shortage"]`·bound 起点**照常展开**（非终点）沿边到域 isRoot 叶 |
| 域隔离 | 跨域桥边 `cf-material-short→cf-cathode-shortage` 让 demand 泄漏进 cathode | **删桥边**（cf-material-short 本身 isRoot 即 demand 合法终点）·供应类 metric 仍从 cathode 起不受影响 |

**关键接缝点（亲手调通·非只跑存在性）**：ce726e51 的 C2「bound root=终点·不越过」会让 BFS 停在 gap 节点（atomicLeaves=[cf-share-gap]·**不到域根**）——故本 WO **不照搬** ce726e51 的终点语义，改为 bound 起点**照常展开**、终点仍是 isRoot||无出边 → atomicLeaves 落到域根（cf-competitor-price…）。结构层勾稽不破：`matContribution=G*structuralExplained*0.15` 本就 metric-scaled，`Σ子+residual=父` reconciled=true。

## 真证据（审核方逐值复验）

**4 metric 各归自己域根（真跑 gap_attribution·causal cf: 叶）：**
```
market_share => [cf-bid-loss, cf-competitor-price, cf-delivery-reputation]   reconciled=true
cash         => [cf-ar-aging, cf-customer-concentration, cf-dso-stretch]      reconciled=true
demand_attain=> [cf-capacity-short, cf-forecast-bias, cf-material-short]      reconciled=true
revenue      => [cf-churn, cf-pipeline-shrink, cf-price-erosion]              reconciled=true
```
（上轮 bug：四者逐字节相同=[cf-decision-gap,cf-cert-cycle]·全回落 cathode。）

**测（`pnpm --filter datacore test`·datacore vitest.config testTimeout=180000）：**
- **C5 命脉** `metric-aware-composition.test.ts`（6 绿）：4 metric 各归域根 + 不回落 cathode 终点 + 跨 metric 域互不相同 + R6 两跑 deep-equal + reconciled。
- `gap-attribution.test.ts`（16 绿·D4 加域隔离咬：demand 不桥 cathode）。
- **金值** `demo-chain-provenance.test.ts`（2 绿）：72→81 类型·3240→3279 对象（+9 CEO-DATA-2 下钻真类型·实测真值改对）。
- 四包全绿 + gates + debattery(R14=0)。

## 保留物不回退
q7 `supply_demand_gap_attribution`（4 引用在）· unit-normalize · cockpit-infer(DashboardView gap_attribution+ProvenanceDag) · capacity-timeline · 生成器/grains 端点 `POST /a/v1/ceo/dataset/generate`（HTTP 200·与 gap_attribution 正交·未动）。

## 本体回写
§8 新增 `G-METRIC-AWARE-SEAM`（✅ 已闭）·链路 `CausalFactor.boundMetricKeys → gap_attribution startRoots metric-aware BFS → 每 metric 域 isRoot 叶`。
