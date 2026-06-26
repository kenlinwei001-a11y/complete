# 轨L 增量2 · demo 走真建模链 · 实施前去风险调查 + 计划（高 blast-radius·先surface）

> 增量2 改 `seedDemoSynthetic` 的本体产出从 runJob 直接 upsertType+objects → 经 `deriveModeling→草案→发布→materialize`。
> 这是本轨最高 blast-radius 增量（demo 种子是全测试套件 + 沙盘的地基）。本文件记实施前**亲手真跑**的去风险结论 + 实施计划，供审核方先核。

## 1. 去风险调查（live datacore 真跑，已坐实）

### 1.1 ✅ 关键可行性：deriveModeling 推断 pk == A 路显式 pk（全 34 类零 mismatch）
A 路 obj id = `obj_${type}_${row[pk]}`，pk 是 putAll 显式传的业务键（Base→baseId / Order→**so**(非标准) / …）。
deriveModeling pk 推断（`modeling.ts:91`）= 第一个 uniqueRate≥0.95 字段（否则首字段）。
**真跑 34 类逐一比对：inferred pk === 显式 pk，mismatch 0**——因 generate 函数把唯一 pk 列放在首位且 uniqueRate=1.0，
稳定排序取首个唯一列即命中显式 pk。⇒ 经链 materialize 出的 obj id 可逐字节复现 A 路基线（8277a5a7）。

### 1.2 ✅ 已修：obj id 净化 regex 对齐（CJK pk）
基线 467 obj id 中 **27 个含 CJK**（如 `obj_changeovermatrix_2170-NCM__圆柱-LFP`，ChangeoverMatrix.pairId 含中文）。
A 路用 `[^\p{L}\p{N}_-]gu`（保留 CJK），增量1 我改的 B 路 materialize 误用 `[^\w-]`（ASCII，会把 CJK→`_`）→ 27 id 将分叉。
**本提交已把 modeling.ts 两处 materialize regex 对齐为 `[^\p{L}\p{N}_-]gu`**（与 A 路一致），消除 CJK 分叉。

### 1.3 ✅ 无跨系统硬引用旧 B 路 id（增量1 已核）；但链路硬引用 obj id（须字节不变）
`instantiateBattery` 的 link fromId/toId 直接拼 `obj_${type}_${pk}`（如 `obj_model_${m.modelId}`，service.ts:590-636）——
依赖 obj id 字节不变。由 1.1 经链复现同 id → 链路仍解析。

## 2. 实施计划（待执行·按此做）
1. `instantiateBattery` 加模式参（默认 A 路不变，仅 demo 用链模式）：链模式下 putAll **只产 rawDataset+rawRows，跳过对象 put**，且跳过 `batteryObjectTypes()` 直接 upsert（类型改由链产）；`batteryLinkTypes()` + 各 link 仍种（引用同 id）。
2. `seedDemoSynthetic`：runJob(链模式) → `modeling.suggest`(确定性 derive 全字段路径，**无 LLM**) 一次性吃 34 个 demo rawDataset → 草案 → `publish`(类型带真 sourceDataset/sourceBindings) → `materialize`(增量1 统一 id + 1.2 regex → 字节同基线)。
3. 顺序：rawDataset → 链发布类型 → 链路类型(batteryLinkTypes，引用已发布类型) → materialize 对象 → seedDemoPropagationRules（type key 不变即不破）。

## 3. 验证门（增量2 完成判据·必跑）
- **字节红线**：重导出 §增量0 三件，typekeys=cc787b32 / objids=8277a5a7 / noi=a958632a **逐字节相等**。
- **零回归**：`pnpm -r test`（含 modeling/scenario-build-e2e/sim/求解器/sandbox）；沙盘真浏览器 tick 节点 Σ 仍真变。
- **provenance 真**：ModelingPage 中心显真本体、34 数据集显已建模、点数据集溯到其类型（增量3 UI 闭合）。
- 任一不达 = 自己打回，不提交。

## 4. blast-radius 说明（surface 给审核方）
本增量替换 demo 种子的类型来源（batteryObjectTypes hardcoded → 链 deriveModeling 派生）。类型 KEY 集不变（已证），
但类型**属性元数据**（dataType 推断/displayName/domain）可能与 batteryObjectTypes 有差异——靠 §3「零回归」全测试套件兜底验证；
若发现求解器/闭包读类型元数据导致回归且不可调和 → 停手报审核方（HANDOFF §2 注 + 禁止清单）。

## 5. 实施路线裁决（曾疑分叉·复读 HANDOFF 后定为路线 A·无需 surface）
> 早前我把此处记为"(A)全链 vs (B)链在上"的待裁分叉并倾向 (B)。**复读 §1.A/§2/§3.3 后更正：此分叉系误读，合同明确指向 (A)。**

- **§1.A 的"保留 A 路种法"只针对「本体链路类型」那一行**（order_for_model… 沙盘传导依赖其 key），**不针对对象类型**。
  对象类型行说的是"type key 来源=**一致**（A/B 路 key 都=Base）"+"provenance=**走 B 路（建模链）**"——KEY 恒定、provenance 经链，二者皆与路线 A 相容。
- **§2 字面**："把 seedDemoSynthetic 的**本体产出**从『runJob 直接 upsertType+objects.put』**改为** deriveModeling→草案→**发布**→materialize"——
  即**类型创建本身移入链 publish**（demo 跳过 batteryObjectTypes upsert），这就是路线 A。
- **§3.3 红线**："provenance 因果真实……**不是事后盖戳**"。我曾推荐的 (B) 让类型**先由 batteryObjectTypes 建、再被链补 provenance**——
  类型**存在性不由链导致**，仅 provenance 元数据事后挂上，存被判"事后盖戳"之实质风险。⇒ **(B) 触红线，弃。**
- **裁决 = 路线 A**：demo 的对象类型由链 deriveModeling→publish **原生产出**（存在性因果真实）；runJob 仍产 rawDataset + 链路类型（§1.A 末行 + §1.C 复用）。

### 5.1 路线 A 的 blast-radius 与"牵动面超预期"停手判据（经验测，不臆测）
- 类型 **KEY 集 / obj id 集 / 沙盘 noi** 仍守字节红线（§3.1，已证 KEY 恒定、id 经链可复现基线）。
- 字节红线**不约束类型属性元数据**（displayName/domain/属性 dataType）——链推断值与 batteryObjectTypes 手工值**会有差异**，此为路线 A 固有。
- **判据=零回归门（§3 全测试套件 + 沙盘 tick）当 oracle**：路线 A 落地后跑 `pnpm -r test` + 沙盘真 tick：
  - **全绿 + 三 SHA256 字节相等** → 路线 A 成立，提交增量2。
  - **可调和回归**（少量读类型元数据处）→ 修后复跑。
  - **不可调和 / 牵动面超预期** → **revert 路线 A（保留本 checkpoint）+ 附具体失败清单报审核方**（HANDOFF §2 注「牵动面超预期停手报审核方」之**带证据**落地）。
- 现状：安全前置（obj id 净化 regex 对齐 CJK·§1.2）已落并验（datacore 749/749 绿）；下一步落路线 A 主体并过上述 oracle。
