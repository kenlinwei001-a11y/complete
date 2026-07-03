# METHOD-MC-STOCHASTIC · FDE 证据（P90 伪分位 → 种子化蒙特卡洛真实分位）

> WO：`work-queue.json` → `METHOD-MC-STOCHASTIC`（P1 根因单·不作假）。PRD：`docs/PRD-method-library-stochastic-mc.md`。
> 根因：`capacity.ts` `p90 = round(p50 * healthFactor, 4)`（healthFactor=`battery.ts:99` 固定 0.93/0.90 haircut·电池魔数）——
> 用与概率分布无关的常数冒充 90 分位，两个真实波动性天差地别的基地给出同一 p90/p50=0.93（不作假红线违反点）。

## 治本（§J 泛化为「方法库」·加随机模拟族）

- 契约 `packages/contracts/src/method-template.ts`：`StochasticMethodTemplate`/`UncertainFactor`/`MethodBinding`/`McForecastResult`（R14 抽象角色·零业务实体名）。
- 引擎 `apps/datacore/src/solvers/method-mc.ts`：`quantileType7`（type-7 线性插值）+ `sampleDist`（normal/lognormal/triangular/beta/uniform·只吃 seeded rng）+ `monteCarlo`（逐迭代 ∏ 相对乘子→聚合→经验分布→分位）+ 内置 `BUILTIN_CAPACITY_MC`。
- 离散度 SolverParam `mc.dispersion.*`（yield .03/oee .05/avail .04/attend .02/util .04）+ `mc.iterations`=2000 + `mc.staleDispersionMult`=1.6（`battery.ts`·CALIBRATION 可调方差模型）。
- 接线 `capacity.ts`：p50/p90/批次 cumP90/what-if adjP90 改走 MC（`rngFromInput` 种子化·R6）；`service.ts recordCalibrationForecasts predictedP90` 同款 fake 同批收口（用 MC 派生 `mcDispRatio`）。
- 前端 `ProjectSimView`/`simSolvers`（mock 同源紧凑 MC）：决策数字悬浮出「真实分位(蒙特卡洛 N·seed·离散度源)」，删「× 健康度 0.93」伪分位文案。

## A1 根因证否（真起 datacore :4051·SEED_DEMO·curl 实证）

```
POST /a/v1/solvers/capacity_forecast/invoke  {args:{modelId:"4680-NCM",qty:100000,weeks:6,seed:42}}
→ {p50:5.1836, p90:4.8679, p10:5.5164, ratio:0.9391, method:"monte_carlo", iters:2000, seed:42,
   dispersionSource:"SolverParam(mc.dispersion.*)·staleMult=1.6"}
```
- p90 4.8679 **< p50** 5.1836（保守下限）· p10 5.5164 **> p50**（乐观上限）· ratio **0.9391 ≠ 0.93**（真实经验分位·非固定 haircut）。
- 旧码此处恒给 round(5.1836×0.93)=4.8207（伪分位）。method=`monte_carlo`·dispersionSource 非空（R13）。

## A2 R6 确定性（同 seed 两调逐字节一致）

同 `(modelId,qty,weeks,seed)` 连调两次 → `jq -S '.data|{p10,p50,p90}'` diff **空**（PASS）。

## A3/A1b 单测（`test/method-mc.test.ts` 13/13 绿）

- quantileType7 对 [1..5] 返回精确 3 / 1.4 / 4.6（type-7）。
- cv=0 退化：p10=p50=p90=点估计和（塌回点估计）。
- 离散度整体 ×3 → p90/p50 比值随之变化（0.9395→0.8271·证真分布非固定系数）。
- 陈旧单元 → cv 放大 → p90 更低（C09 诚实建模）。
- 同 seed 两跑逐字节一致（R6）。

## A5 门 `method-determinism:check`（有牙齿）

- exit 0：MC 作用域 seeded rng·无 Math.random/Date·样本排序取分位·`p50*healthFactor` 伪分位式零命中（capacity+calibration）。
- 牙齿自证：seed 行注入 `Math.random()` → 门红（exit 1）；还原 → 绿。并入 `pnpm gates`（35→并列）。

## A6 回写 + 切片

- `SYSTEM-ONTOLOGY.md §J`「优化融合域」→「方法库（优化融合 + 随机模拟）」+ `StochasticMethodTemplate` 对象条 + 随机模拟链路(§3) + `capacity_forecast` 改造注记 + §7 门表 + §8 G-12 注记。
- `pnpm ontology:slices` 重生成 11 切片·`ontology-slices:check` exit 0（母体↔切片不漂）。

## A7 四包全绿 + gates

- frontend 383/383 · datacore 全绿（新增 method-mc 13 测 + 更新 solvers/calibration-health 断言到 MC 语义）· agentcore 不回退 · contracts 建成。
- `pnpm gates` exit 0（42 门·含 method-determinism / validation V10 / ontology-slices / seed-demo-smoke）。
- V10 SMOKE：P50 仍逐位独立双算（点估计·第二套代码）；P90 改结构性校验（<P50 且距 haircut anchor ≤10%P50·method=monte_carlo）——P90 字节级验证由 method-mc 单测 + determinism 门守（比重复预言机更强）。

## 距北极星 / 诚实边界

- ✅ 根因收口：P90 全路径（主/批次/what-if/校准 predictedP90）由伪分位 → 真实经验分位；两处同款 fake 一处不漏。
- ◐ MethodBinding REST 端点/前端绑定 UI 未做（demo 走内置 `capacity_mc` 默认模板 + 默认 SolverParam·向后兼容）；本 WO 聚焦根因收口 + 引擎/门/回写，绑定 UI 属后续。
- ◐ 其余分布族（triangular/beta/uniform）已实现 + 单测均值≈1，但内置 capacity_mc 仅用 normal/beta；其余族待有租户模板消费。
