# PRD · A6 · 拟真值域合成数据（值落业务区间 + 确定性植入越线样本）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 1（基座） |
| 取代/扩展 | 扩 `PRD-addendum-a8-timeseries.md` · `PRD-addendum-validation-loop.md`（VLE） · 关联 `PRD-A3-*`（通用路）· `PRD-de-battery-multitenant-config.md`（G-5） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6 / §7 VLE 七段） · `apps/datacore/src/synthetic/battery.ts`（generateBattery）· `service.ts:771 instantiateGeneric`/`:830 genValue` · `apps/datacore/src/vle.ts:114-134`（查准植入预言机） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：电池路（`generateBattery`）的值已落业务区间且有戏剧点；但**通用路（`instantiateGeneric` + 纯 GenSpec）产的是平坦 uniform/hash 值，无业务分布、无越线样本** → 推演无看点、VLE 查准无素材、风险曲线平。A6 把"**拟真值域 + 确定性植入越线样本**"做成**模板可声明的通用能力**，让任意行业（手机/…）也能产出"像真的、且恰好踩线"的数据。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`SyntheticJob`·`IndustryTemplate`/`GenSpec`·`RawDataset/RawRow`·`ObjectInstance`·`Rule`（越线植入对照其 BLOCK 谓词）·`DerivationSpec`（派生口径）。**新增契约**：`ValueDomainSpec`（值域分布规约）·`PlantSpec`（越线植入规约）。
- **触及链路**（§3）：`IndustryTemplate.generation → genValue(值域分布) → RawRow → ObjectInstance`（拟真值）+ `Rule(BLOCK 谓词) → PlantSpec → 确定性植入越线行`（喂 VLE ④查准 + 风险曲线戏剧点）。
- **触及事件/数据流**（§4）：复用 `dataset.regenerated`/`materialize.completed`（值变 → 下游失效）；不新增事件。
- **触及不变量**（§5）：
  - **R6 确定性（核心）**：值域分布与植入均由 `mulberry32(seed^hash)` 子流 + **固定植入索引**驱动；同 (industry,scale,seed) **字节一致**。植入是确定的，不是随机撒。
  - **R12**：植入行字段齐备（VLE ①接入行数守恒 + ④查全不退化）。
  - **R14**：值域库/植入规约**配置化**（按 域×属性语义 给区间，非按行业写死）；通用路与电池路共用同一机制。
- **关闭/影响断点**（§8）：推进 **G-5**（通用路富度，把电池专属"业务区间+戏剧点"升为模板可声明）；夯实 **VLE ④/⑤**（查准/求解器非退化有真素材）。
- **门禁**（§7）：**VLE 七段**（①行数守恒 ④查准:植入越线被独立谓词捕获>0 ⑤求解器供需双侧非退化）· `ontology:check` · `debattery:check`（值域库非业务常数内联）· 新增 `value-domain:check`（每 BLOCK 规则有≥1 植入越线 + ≥1 近边界样本）。
- **回写承诺**：回写本体 §2（ValueDomainSpec/PlantSpec）· §3（拟真值 + 植入链）· §8（G-5 推进量化 + VLE 素材来源）。

## 1. 目标 / 非目标
### 目标
1. **值落业务区间**：通用路生成的数值不再是裸 `uniform(min,max)`/hash，而是按**值域分布规约**（区间 + 分布形 + 可选相关性）产出，落业务可信区间（如利用率 0.62–0.95、良率 0.90–0.99、毛利率 11–20%）。
2. **确定性植入越线样本**：对每条 BLOCK/WARN 规则，确定性植入 **K 行越线 + K' 行近边界**（固定索引、可复算），让 VLE 查准有素材、风险曲线/推演有戏剧点、求解器供需双侧非退化。
3. **模板可声明、跨行业通用**：值域与植入是 `IndustryTemplate` 的可选增量字段；不声明则回落现有 GenSpec（向后兼容、字节一致）。电池路收编同一机制（口径统一）。

### 非目标
- 不引入随机噪声/外部数据；一切确定性（R6）。
- 不改规则引擎；植入只"对照"规则谓词产出越线，不改规则。
- 不做时序生成本身（A8/已有 tsGenerators）；A6 聚焦截面值域 + 植入（时序戏剧点复用既有 scenarioScript）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 电池路值 | `generateBattery`：`util=round(0.62+rng()*0.35)` 等**已落业务区间** + 戏剧点注入（Shipment.DELAYED/MaintPlan/越线行） | 仅电池硬编码，未泛化 |
| 通用路值 | `genValue`（`:830`）：`number` 走 `uniform(min,max)`，`enum` 均匀，无分布/相关/区间语义 | 平坦、不拟真 |
| 越线植入 | VLE 自己植入 C03 行做查准预言机（`vle.ts:129`，仅校验侧） | **生成侧通用路无植入** → 风险/推演无素材 |
| 声明位 | `IndustryTemplate.generation.propGenerators`（GenSpec 5 种） | 无值域分布/植入字段 |

## 3. 设计（扩 GenSpec + 值域库 + 植入器；电池路收编）
### 3.1 值域分布规约 `ValueDomainSpec`（扩 GenSpec）
- `contracts/datacore.ts` GenSpec 联合**加判别支**：`{kind:"valueDomain", domainKey?, band:[lo,hi], shape:"uniform"|"normal"|"lognormal"|"banded", bands?:[{range,weight}], corrWith?}`。
- **值域库** `value-domains.ts`（新，配置化 R14）：按 `域×属性语义`（如 `util`/`yield`/`marginPct`/`coverDays`）给默认 `band+shape`；模板未给则查库，库未命中回落 `number uniform`（向后兼容）。
- `genValue` 扩：`valueDomain` 走确定性分布采样（normal 用固定 Box–Muller + seed 子流；banded 按权重确定性落桶）。**单表无 valueDomain 与旧版字节一致**（R6 向后兼容）。
### 3.2 越线植入器 `PlantSpec` + `plantCrossings`
- `PlantSpec`：`{ruleKey, typeKey, field, op, threshold, crossCount K, nearCount K', strategy:"fixedIndex"}`。
- 模板可声明 `generation[].plants[]`；未声明则由 **规则反推**：对每条 scope 该类型的 BLOCK 规则，自动派生默认 PlantSpec（K=2/K'=2），保证"每 BLOCK 规则有越线素材"。
- `plantCrossings`（在 `instantiateGeneric`/`instantiateBattery` 物化前）：在**固定行索引**（如 `i % stride === 0` 的前 K 行）把目标字段确定性改写到越线值（threshold ± δ），near 行改写到边界内 δ'。**确定性、可复算、可溯**（植入行 origin 标 `planted:ruleKey`）。
### 3.3 电池路收编
- `generateBattery` 的散点业务区间与戏剧点重表述为 `ValueDomainSpec`/`PlantSpec`，与通用路共用 `genValue`/`plantCrossings`（口径单一来源）；回归保证电池数据**字节不变**（R6）。
### 3.4 门禁
- 新 `value-domain:check`：跑一遍合成 → 断言每 BLOCK 规则有≥1 越线行被独立谓词捕获（复用 VLE ④预言机思路）+ ≥1 近边界行；否则红。

## 4. 契约 / 端点
- `contracts/datacore.ts`：GenSpec 加 `valueDomain` 支；新增 `ValueDomainSpec`/`PlantSpec`/`IndustryTemplate.generation[].plants?`。
- 无新端点（值在合成作业内产出）；VLE 报告（`SyntheticReport`）加 `plantedCrossings:[{ruleKey,planted,caught}]` 段（前端合成向导 Curated 阶段可见，对接 `PRD-synthetic-wizard-ontoprompt-chain.md` ④阶段）。
- 无新表（R9）。

## 5. 关键流程（端到端）
合成作业 → 解析模板 `generation`（valueDomain + plants，或库/规则回退）→ 逐类型生成：`genValue(valueDomain)` 落拟真值 → `plantCrossings` 在固定索引植入越线/近边界 → 物化 ObjectInstance（植入行可溯）→ 派生 → VLE ④查准命中植入行 + ⑤求解器供需非退化 → 报告 `plantedCrossings`。

## 6. 非功能（§5）
R6（分布与植入全确定，单测字节锁 + 重跑一致）· R12（植入不破行数守恒/查全）· R14（值域库配置化）。

## 7. 验收（DoD）
- 通用路（如 `phone-manufacturing` 或测试行业）数值落业务区间；每 BLOCK 规则有越线 + 近边界样本；风险/求解器非退化。
- 电池数据回归**字节不变**（R6 向后兼容锁）。
- `pnpm -r build && pnpm -r test` 全绿（新增 value-domain 单测 + 电池字节回归）；VLE 七段绿；`value-domain:check`/`debattery:check` 过。
- 回写本体 §2/§3/§8。

## 8. 分期
- **A6.1** ValueDomainSpec + 值域库 + genValue 扩（拟真值，向后兼容）。
- **A6.2** PlantSpec + plantCrossings（规则反推默认 + 模板声明）+ `value-domain:check`。
- **A6.3** 电池路收编同机制（字节回归）+ 报告 plantedCrossings 段。

> 基线分支：实现前定准（值域库/植入器为新文件，冲突小；电池收编需对基线 generateBattery 做字节回归）。
