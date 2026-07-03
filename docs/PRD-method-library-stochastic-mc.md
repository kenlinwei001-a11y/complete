# PRD · 方法库·随机模拟族（种子化蒙特卡洛）——解「P90 启发式冒充分位数」根因

> 状态：设计（待 dev 落地）· 分支 `claude/vigilant-knuth-b1nmxn` · 契约先行（R1）
> 遵：R6 确定性 / R14 行业无关零业务常数 / R13 结论可溯源 / 铁律「不作假」/ R-PRD（本 PRD 逐字段量化·非大概） / R-QUANT（数值给精确值·禁定性）
> 对应 WO：`work-queue.json` → `METHOD-MC-STOCHASTIC`

---

## 0. 《本体引用与影响》（铁律 0 · prd:check 守）

**触及对象类型（§2 / §J 优化融合域 → 泛化为「方法库」）**
- **新增 `StochasticMethodTemplate`（随机模拟族模板 · 全新 · 全代码库零命中）**——抽象 `(uncertainFactors[{role,distribution,dispersionParamKey}], aggregate, percentiles[], iterations)`，零行业实体名（yield/oee 是**角色**，绑定进来才成为电池的 `Process.yield`）。与既有 `OptModelTemplate`（确定性优化族）**同居 §J「方法库」**、共用 `provenance{derivedFrom,license}` 派生留痕。
- **复用 `OntologyBinding`（§J A13 绑定层）→ `MethodBinding`**：role→本体类型/属性 + DF.8 接地（绑本体外实体 400 不落库）。每租户把同一 `StochasticMethodTemplate` 绑到自己本体（R14）。
- **复用 `SolverParam`（§2.D 版本化求解器参数）**：离散度（cv/σ）与迭代数 `mc.iterations` 落 SolverParam（**可被 `CALIBRATION_SWEEP` 校准**——越用越准也调**方差模型**，非仅点估计）。
- **触及既有 `Solver`：`capacity_forecast`（S1.2）**——`p50/p90` 由「点估计 × 常数」改为「种子化 MC 的真实经验分位」。

**触及链路（§3）**
- 新增 **随机模拟链路**：`StochasticMethodTemplate(抽象·零业务常数) --MethodBinding(角色→本体属性,DF.8 接地)--> 逐迭代采样(seeded mulberry32) --聚合--> 经验分布 --type-7 分位--> {p10,p50,p90}+provenance --R13 溯源--> 前端诚实标「真实分位」`。
- 接入既有中枢链 `sys.solving.invoke`（Solver→ObjectType(读)→SolverParam，同输入同输出 R6）。

**触及事件（§4）**：无新事件；`calibration.applied`（既有）在校准离散度后照常发（paramsVersion+1 → MC 重算）。

**触及不变量（§5）**
- **R6 确定性**：`rngFromInput({tenantId,modelId,args,seed,paramsVersion})`（`prng.ts` mulberry32，已存在）→ 同输入 N 样本逐字节一致 → 分位逐字节一致。MC 作用域**禁 `Math.random`/`Date.now`/`new Date`**。
- **R14 行业无关**：离散度、分布族、哪些因子随机——全经模板+绑定+SolverParam，**禁内联电池常数**。删除 `battery.ts:99 health.normal=0.93` 这一「P90 系数」魔数在 P90 路径的使用（`debattery:check` 守）。
- **R13 结论可溯源**：结果带 `method:"monte_carlo"·iterations·seed·percentiles·dispersionSource`，前端悬浮出「P90=真实分位(蒙特卡洛 N=…·seed=…·离散度 SolverParam v…)」，非裸浮点。
- **R1 contracts-only-shared**：`StochasticMethodTemplate`/`MethodBinding` 仅定义于 `packages/contracts`，前端不重定义。

**触及门禁（§7）**
- 新增 **`method-determinism:check`**（并入 `pnpm gates`）——平行 `opt-determinism:check`：MC 作用域用 seeded rng、无非确定来源、样本排序后取分位。
- 既有：`opt-determinism:check`/`opt-template:check`/`solver-license:check`/`debattery:check`/`ontology-slices:check` 不回退。

**命中断点（§8）**
- **G-12**：§J 原「有确定性 what-if 但…」——本单为 §J 增**随机模拟族**（确定性优化之外的第二方法族），G-12 注记扩写。
- 关联 **G-DM/不作假**：P90 由伪分位翻为真分位，闭「合成/启发式冒充真值」残口。

**回写承诺（改了 → 必回写 `SYSTEM-ONTOLOGY.md`）**
1. §J 标题「优化融合域」→「方法库（优化融合 + 随机模拟）」；新增 `StochasticMethodTemplate` 对象条 + 随机模拟链路 + `capacity_forecast` 改造注记。
2. §7 门表加 `method-determinism:check`。
3. §8 G-12 注记扩「随机模拟族已立」。
4. 跑 `pnpm ontology:slices` 重生成 `docs/ontology/`（10-self-domains 等切片同步），`ontology-slices:check` 绿。

---

## 1. 根因（为什么必须做·证据锚点）

| 项 | 现状（file:line） | 问题 |
|---|---|---|
| P90 计算 | `apps/datacore/src/solvers/capacity.ts:260` `const p90 = round(p50 * healthFactor, 4);` | P90 被标为「90 分位」，实为 `p50 × 常数`。**零采样**——不抽 yield/OEE/可用率/出勤/利用率的方差。 |
| 常数来源 | `apps/datacore/src/synthetic/battery.ts:99` `health: { normal: 0.93, degraded: 0.9, staleHours: 2 }` | 系数=**固定 7% haircut**（新鲜 0.93 / 陈旧 0.90），且是**电池专属魔数**（R14 味）。 |
| 批次 P90 | `capacity.ts:275` `cumP90 = cumP50ByWeek[...] * healthFactor` | 同一伪分位口径蔓延到批次判定。 |
| what-if P90 | `capacity.ts:311` `adjP90 = adjusted * healthFactor` | 同。 |

**致命证据**：两个真实波动性天差地别的基地（一个设备稳、一个设备抖）——现口径给出**同一个 p90/p50 = 0.93**。分位数本应反映各自方差，此处完全无信息。这就是「不作假」被违反的具体点：**用一个与概率分布无关的常数，冒充分位数下发给决策者**。

---

## 2. 方法库·家族划分（回应用户「是否需单独算法库并行规则库/约束库」）

**结论：不设独立筒仓；把 §J 泛化为「方法库」，在其内加随机模拟族。** 与规则库按「关注点」并列：

| 库 | 关注点 | 问的问题 | 一等对象 | 家族 |
|---|---|---|---|---|
| **规则约束库**（§C，已统一 evaluation\|constraint，WO-18） | 判定 / 闸门 | X 过不过？ | `Rule`（ruleType=evaluation\|constraint） | — |
| **方法库**（§J·本单泛化） | 计算 / 推演 | 数字是多少？ | `OptModelTemplate` ⊕ **`StochasticMethodTemplate`** | **确定性优化族**（既有 OR/CP-SAT）⊕ **随机模拟族**（新·种子化 MC；后续可扩 forecasting/敏感度） |

规则库=闸门（判定），方法库=引擎（计算最优 or 分布）。二者经 `SolverBinding`/`MethodBinding` 同机制绑本体。**本单不新建平行体系，只在既有 §J 模板池 + OntologyBinding + SolverParam + 门 机制上加一个家族。**

---

## 3. 契约（R1·`packages/contracts/src/opt-template.ts` 扩，或新 `method-template.ts` 同包）

```ts
// 随机模拟族模板（抽象·R14 零业务常数）
export const DistributionFamily = z.enum(["normal", "lognormal", "triangular", "beta", "uniform"]);

export const UncertainFactor = z.object({
  role: z.string(),                     // 抽象角色："yield" | "oee" | "availability" | "attendance" | "utilization" …（非电池实体名）
  distribution: DistributionFamily,     // 分布族
  dispersionParamKey: z.string(),       // 离散度的 SolverParam 键名（值不内联·如 "mc.dispersion.yield"）
  clamp: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(), // 如 yield∈[0,1]
});

export const StochasticMethodTemplate = z.object({
  key: z.string(),                                  // 如 "capacity_mc"
  family: z.literal("stochastic"),                  // 方法库家族判别
  method: z.literal("monte_carlo"),
  uncertainFactors: z.array(UncertainFactor).min(1),
  aggregate: z.enum(["sum", "min", "product"]),     // 单元样本→场景总量的聚合口径
  percentiles: z.array(z.number().min(0).max(100)).min(1),   // 要出哪些分位·如 [10,50,90]
  iterations: z.number().int().positive(),          // 默认迭代数 N（精确·如 2000）
  provenance: z.object({ derivedFrom: z.string(), license: z.string() }), // 复用 §J 派生留痕
  status: z.enum(["ACTIVE", "PROVISIONAL"]),
});

// 绑定（复用 OntologyBinding 形态）：role→本体类型.属性 + DF.8 接地
export const MethodBinding = z.object({
  id: z.string(),
  tenantId: z.string(),
  methodKey: z.string(),                             // → StochasticMethodTemplate.key
  roleBindings: z.array(z.object({
    role: z.string(),
    bind: z.object({ kind: z.enum(["objectProp"]), ref: z.string() }), // 如 "Process.yield"
  })),
  status: z.enum(["DRAFT", "ACTIVE"]),
});

export const McForecastResult = z.object({
  p10: z.number(), p50: z.number(), p90: z.number(),
  method: z.literal("monte_carlo"),
  iterations: z.number().int(),
  seed: z.number().int(),
  dispersionSource: z.string(),                      // R13：如 "SolverParam(mc.dispersion.*) v7"
  percentiles: z.record(z.string(), z.number()),     // {"p10":…,"p50":…,"p90":…}
});
```

---

## 4. SolverParam（离散度/迭代数·可校准·替代 0.93 魔数）

新增 SolverParam 键（**默认值精确给定**·经 CALIBRATION_SWEEP 可调）：

| SolverParam 键 | 默认值 | 含义 |
|---|---|---|
| `mc.iterations` | `2000` | 迭代数 N（精确·非「若干」） |
| `mc.dispersion.yield` | `0.03` | 良率变异系数 cv（σ/μ） |
| `mc.dispersion.oee` | `0.05` | OEE 变异系数 |
| `mc.dispersion.availability` | `0.04` | 可用率变异系数 |
| `mc.dispersion.attendance` | `0.02` | 出勤率变异系数 |
| `mc.dispersion.utilization` | `0.04` | 利用率变异系数 |
| `mc.staleDispersionMult` | `1.6` | 关键源陈旧时对相关因子 cv 的**放大倍数**（C09 诚实建模：陈旧→方差变宽→p90 下探，理由真实） |

> 陈旧口径改造：原 `healthFactor` 从「乘在 p50 上的伪分位系数」改为「陈旧时把相关因子的 cv × `mc.staleDispersionMult`」——staleness 真实拓宽分布，p90（保守下限）因此下探，`degradeNote` 照实解释。**C09 行为保留、但诚实。**

---

## 5. 种子化 MC 算法（精确·R6·dev 照此实现）

```
function monteCarloCapacity(ctx, template, binding, args, params) -> McForecastResult:
  N     = params.solverParam("mc.iterations")                         // 2000
  seed  = args.seed ?? 42
  rng   = rngFromInput({ tenantId: ctx.tenantId, modelId: args.modelId,
                         args, seed, paramsVersion: params.version })  // mulberry32 流·R6
  // 贡献单元 = computeRollup 的每个 base×week add 项；每单元携带其点因子 point[role]
  units = collectContributingUnits(ctx, args)   // 复用 computeRollup 的因子分解·不重算业务口径

  samples: number[N]
  for i in 0..N-1:
    total = aggregateIdentity(template.aggregate)   // sum→0 / min→+∞ / product→1
    for unit in units:
      f = clone(unit.pointFactors)
      for uf in template.uncertainFactors:
        role  = uf.role
        cv    = params.solverParam(uf.dispersionParamKey)
        if unit.stale[role]: cv *= params.solverParam("mc.staleDispersionMult")
        f[role] = clampTo(uf.clamp, sampleDist(rng, uf.distribution, mean=unit.pointFactors[role], cv=cv))
      unitCap = recomputeUnitCapacity(unit, f)       // 与 computeRollup 同公式·因子替为样本
      total = aggregate(template.aggregate, total, unitCap)
    samples[i] = total

  samples.sort(ascending)                            // 确定性排序（消顺序抖动）
  return {
    p10: quantileType7(samples, 0.10),
    p50: quantileType7(samples, 0.50),
    p90: quantileType7(samples, 0.90),               // 详见方向约定
    method: "monte_carlo", iterations: N, seed,
    dispersionSource: `SolverParam(mc.dispersion.*) v${params.version}`,
    percentiles: { p10, p50, p90 },
  }
```

**分布采样 `sampleDist`（精确）**：`normal` 用 Box–Muller（两个 rng() 抽标准正态，×cv×mean+mean）；`lognormal`=exp(normal(ln μ, cv))；`triangular`/`uniform`/`beta` 各给闭式（PRD 附录 A，dev 实现时逐族单测）。**全部只吃 `rng()`，不吃 Math.random。**

**方向约定（钉死·防 dev 反向）**：产能=**供给**。**`P90(capacity)` = 90% 情景下可达到-或-超过的产能 = 升序样本的第 10 百分位 = 保守下限**。故 `p90 < p50`（与旧口径 `p50×0.93<p50` 同向，语义保留）。`p10`=乐观上限。实现取 `quantileType7(samples, 0.10)` 映射到 P90 标签（保守）。**PRD §5 表：标签 p90 ← 升序 0.10 分位；标签 p50 ← 0.50；标签 p10 ← 0.90。**

**`quantileType7(sorted, q)`（精确·numpy/Excel 默认线性插值）**：
```
h = (n - 1) * q ;  lo = floor(h) ;  frac = h - lo
return sorted[lo] + frac * (sorted[lo+1] - sorted[lo])   // lo+1 越界时取 sorted[lo]
```
（type-7·确定性·无随机。）

---

## 6. `capacity_forecast` 改造点（root-cause 收口）

- `capacity.ts:259-260`：删 `p90 = round(p50 * healthFactor, 4)`；p50/p90 由 `monteCarloCapacity(...)` 的真分位替代（p50 取 MC 中位数，与旧 p50 点估计对齐在 cv→0 时相等）。
- `capacity.ts:275` 批次 `cumP90`、`:311` what-if `adjP90`：同改为对相应场景样本取分位（或对总分布按比例——PRD §6.2 给精确口径，避免再引入常数）。
- 结果对象加 `method/iterations/seed/dispersionSource/percentiles`（R13）；`degradeNote` 改述为「陈旧→cv×1.6→分布变宽」。
- **降级路径**：租户未配 `MethodBinding`（如 demo 出厂）→ 用内置 `capacity_mc` 默认模板 + 默认 SolverParam（向后兼容，不 400）；显式关 entitlement `method.stochastic` → 回落旧点估计并**诚实标 `method:"point_estimate"`**（不静默冒充分位）。

---

## 7. 验收（DoD·全 curl/gate/unit·根因证否优先）

| # | 类型 | 断言 |
|---|---|---|
| **A1** | curl | **根因证否**：新鲜数据（旧口径会给 p90=p50×0.93）下，MC 结果 **p90 严格 < p50 且 `p90/p50 ≠ 0.93`**；再把 `mc.dispersion.*` 整体调大重跑 → **p90/p50 比值随之变化**（证真分布非固定 haircut）。旧码两次都给 0.93。 |
| **A2** | curl | **R6**：同 `(tenant,modelId,args,seed,paramsVersion)` 连调两次 invoke → `jq -S` 后 diff 空（p10/p50/p90 逐字节一致）。 |
| **A3** | unit | **分位正确性**：`quantileType7` 对已知样本数组返回精确 type-7 插值值；**cv=0 退化**：所有 `mc.dispersion.*`=0 → p10=p50=p90（无方差→塌回点估计，且=旧 p50）。 |
| **A4** | unit/curl | **R14 行业无关**：同一 `StochasticMethodTemplate` 被 A 租户绑 `Process.yield`、B 租户（异行业·异属性名）绑各自属性 → 各出真分位，**求解器源码零改**（仅 MethodBinding 不同）；`debattery:check` 绿（P90 路径不再含 `0.93` 电池魔数）。 |
| **A5** | gate | **新门 `method-determinism:check` exit 0** 且有牙齿：MC 作用域用 `rngFromInput`/mulberry32、无 `Math.random`/`Date.now`/`new Date`、样本 `.sort` 后取分位；把 seed 行改成 `Math.random()` 重跑该门→**变红**（证门真挡）。并入 `pnpm gates`。 |
| **A6** | gate | **回写+切片**：`SYSTEM-ONTOLOGY.md §J` 已泛化为方法库含 `StochasticMethodTemplate`；`pnpm ontology:slices` 重生成后 `ontology-slices:check` exit 0（母体↔切片不漂）。 |
| **A7** | gate | **回归四包全绿**：`pnpm -r build && pnpm -r test` exit 0（datacore 新增 MC/quantile/binding 单测计入·不减基线；agentcore/frontend/contracts 不回退）；`m11-calibration.test.ts` 绿（离散度可校准未破 R4/R6）。 |
| **A8** | gate/unit | **不作假收口**：`rg 'p50 \* healthFactor'`（或等价伪分位式）在 `capacity.ts` 的 p90 生成处**零命中**；结果对象含 `method:"monte_carlo"` 与 `dispersionSource` 非空。 |

**method（复现命令·dev/审核方共用）**
```bash
# 起内存态 datacore（从 apps/datacore cwd·SEED_DEMO）
cd apps/datacore && PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(openssl rand -hex 32) SERVICE_TOKEN=svc node dist/server.js &
# A1 根因证否：
curl -s -XPOST :4001/a/v1/solvers/capacity_forecast/invoke -H 'X-Debug-User:demo:admin:admin' \
  -H 'Content-Type: application/json' -d '{"args":{"modelId":"<某型号>","qty":100000,"weeks":6,"seed":42}}' \
  | jq '{p50:.data.p50,p90:.data.p90,ratio:(.data.p90/.data.p50),method:.data.method}'
#   期望 method=="monte_carlo"、ratio!=0.93、p90<p50
# A2 R6：上式连调两次 | jq -S . | diff → 空
# A5：node scripts/check-method-determinism.mjs; echo exit=$?  → 0（改 seed 行→非 0）
# A6：pnpm ontology:slices && node scripts/build-ontology-slices.mjs --check; echo exit=$?  → 0
# A7：cd /home/user/complete && pnpm -r build && pnpm -r test; echo exit=$?  → 0
```

---

## 8. 施工顺序（dev·§2 LOOP 后端→前端→回写→门）

1. **契约**（R1）：`StochasticMethodTemplate`/`MethodBinding`/`McForecastResult` 入 `packages/contracts`；`pnpm --filter contracts build`。
2. **方法引擎**：`apps/datacore/src/solvers/method-mc.ts`（`monteCarloCapacity`+`sampleDist`+`quantileType7`，纯函数·R6）；单测逐分布族。
3. **绑定层**：`solvers/method-binding.ts`（复用 opt-binding 的 DF.8 接地）；内置 `capacity_mc` 默认模板（provenance 带 license）。
4. **SolverParam**：注册 `mc.*` 默认（§4 表·精确值）；接入 CALIBRATION（离散度可校准）。
5. **接线**：`capacity.ts` p50/p90/批次/what-if 改走 MC；结果加 provenance 字段。
6. **门**：`scripts/check-method-determinism.mjs`（平行 `check-opt-determinism.mjs`）；并入 `package.json` `gates` 链。
7. **回写**：`SYSTEM-ONTOLOGY.md §J/§7/§8` → `pnpm ontology:slices` → `ontology-slices:check` 绿。
8. **前端（薄）**：决策数字悬浮出「真实分位(蒙特卡洛 N·seed·离散度源)」（复用 `<Provenance>`·R13）；无新页。
9. 跑全清单 T1–T12（`DEV-SOP-1to1-LOOP.md §3`），BUILT 交审核方复验。

## 附录 A · 分布族采样闭式（dev 实现·各配单测）
- **normal(μ,cv)**：`σ=cv*μ`；Box–Muller：`z=sqrt(-2 ln u1) cos(2π u2)`（u1,u2=rng()）；`return μ+σ z`。
- **lognormal(μ,cv)**：`σln=sqrt(ln(1+cv²))`；`μln=ln μ-σln²/2`；`return exp(μln+σln·z)`。
- **triangular(μ,cv)**：以 μ 为众数、`±√6·σ` 为界的对称三角；逆 CDF 采样。
- **uniform(μ,cv)**：`半宽=√3·σ`；`return μ+半宽·(2 rng()-1)`。
- **beta(μ,cv)**（用于 clamp∈[0,1] 的 yield/率）：由 μ、σ 反解 α,β；`clamp` 兜底。
- 全部**仅消费 `rng()`**——`method-determinism:check` 静态校验作用域无 `Math.random`。
