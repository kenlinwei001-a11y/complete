# WO-SNAPSHOT-RESTORE · 阶段① 实测账本（只读分析，未动代码）

> 开工坐标核验（铁律 0.6 第 5 条）：派单给的 file:line 是**线索不是结论**，本账本先给实测，再给设计。
> 分支：`wo-snapshot-restore`（base `claude/verify-reclaim-6`）· 取证日 2026-09-17。

## 0 · 一句话（派单要求的「今天 X，应该 Y」）

**今天：套件 318 个测试文件里 184 个自己合成一遍世界，全套件每轮为播种付 ≈ 808+ 次 seedBattery（实测单次 4–10s，负载下 10–20s）+ ≈1,351 次 makeApp（单次 ~1.2s），折合约 50% 的套件墙钟；应该：全世界 (industry, scale, seed) 每轮套件只合成 1 次、序列化成字节，各文件还原独立深拷，播种成本 ÷10 以上。**

## 1 · 坐标订正（实测与派单前提的差异）

| 派单写的 | 实测 | 处置 |
|---|---|---|
| `sim-real-cells.seam.test.ts` | **不在本基线**。在 sibling 分支 `wo-real-cells` 上（未并入 `claude/verify-reclaim-6`） | 阶段① 用基线内等重重文件替代实测（gap-attribution 18 次 seedBattery / enterprise-state.seam 13 次） |
| `object-constraint-refs`（无后缀） | 不在本基线。`wo-constraint-refs-5b-fix` 上是 `object-constraint-refs.seam.test.ts` | 同上替代 |
| 「套件 362 文件 / 2,557 条」 | 本基线 **318** 个 `.test.ts`（差的 44 个在未并入的 sibling 分支上；362 是含那些分支的全景数） | 阶段① 按基线 318 记账 |
| 其余 3 个重文件（vle-acceptance / empty-tenant-bootstrap / seed-demo-propagation） | 在基线，照常实测 | — |

## 2 · 播种链结构（读码结论，每环都有 file:line）

```
makeApp()                          test/helpers.ts:19
 ├─ mkdtemp blobDir（空目录）
 ├─ createMemoryRepos()            src/repo/memory.ts:440（~90 个空 Map 仓储）
 ├─ new ScriptedLlmClient()        src/llm.ts:94
 ├─ buildApp()                     src/app.ts:404（纯接线；RS256 keygen 每 app 一把，auth.init src/auth.ts:32）
 │    ⚠ 不起任何定时器：scheduler/outbox 的 setInterval 只在 server.ts:133-135 生产启动路径调 start()
 └─ seedDemo(repos)                src/seed.ts:14（tenant 1 行 + users 4 行，argon2 随机盐 src/auth.ts:67）

seedBattery(t, seed=42)            test/helpers.ts:61
 └─ POST /a/v1/synthetic/jobs → synthetic.runJob（路由内同步跑完才返 202，src/app.ts:5479）
     └─ 世界合成全链：objects/links/ontology/rules/tsPoints(≈58,500 点,S 档)/solverParams/
        simulationClocks/viewConfigs/rawDatasets/rawRows/policies/scenarioPackages/... （src/synthetic/service.ts:197 runJob）

重文件再加（接缝组合链，以 sim-real-cells 为典型）：
 + seedDemoPropagationRules(repos)     src/seed.ts（35 条 PUBLISHED 传导规则）
 + seedDemoDerivationSpecs(...)        src/seed-derivation-specs.ts（25 条派生规格编译入库）
 + recomputeDemoDerivationsAtSeed(...) 同上（全量初算 → measuredCells 470→4171）
```

## 3 · 静态账本（基线 318 文件，全量 grep）

| 量 | 值 |
|---|---|
| 测试文件总数 | 318 |
| 用 makeApp 的文件 | **289**（调用点 1,351 处） |
| 用 seedBattery 的文件 | **184**（调用点 808 处） |
| seedBattery 在 beforeAll/beforeEach | 13 处（13 文件） |
| seedBattery 在测试体内（每条测试执行一次） | **808 处（174 文件）** |
| seedBattery 实参 | 807 处默认 seed=42；**1 处 seed=7**（`simclock.test.ts`）→ 快照键只需 2 个 |
| 加跑 seedDemoPropagationRules | 12 文件 |
| 加跑 derivationSpecs + recompute | 基线 1 文件（+ sibling 上 sim-real-cells） |
| 绕过 helpers 直接 buildApp/createMemoryRepos | 11 文件（多为自造仓储的边界测试，快照覆盖不到也不强求） |
| 完全不 import helpers.js | 30 文件（多为纯单测） |

## 4 · 实测账本（⚠ 机器重负载下测得，标注负载；安静窗补测后更新）

**测量纪律遵守情况**：全机同时只一个 datacore vitest（实测时另一 worktree `complete-wt-sim-severity` 的 run 在跑 ⇒ 我的数字全是**争用态**，且 load avg 65→540 持续恶化；empty-tenant 两次 180s 超时即负载抖落，非基线红——安静窗复跑定案）。

| 测量 | 条件 | 结果 |
|---|---|---|
| 探针：makeApp ×3 | load≈65，与另一 run 争用 | 1894 / 909 / 1237 ms（中位 **~1.2s**） |
| 探针：seedBattery ×3 | 同上 | 9656 / 19441 / 9099 ms（中位 **~9.7s**，离群 19.4s=争用） |
| vle-acceptance 整文件（4 测试 / 3 makeApp / 1 seedBattery） | 同上 | 墙钟 146.8s，其中 tests 126.3s（transform 9.8s + collect 17.2s 是 vitest 每文件固定开销） |
| empty-tenant-bootstrap（2 测试 / 2 makeApp / 0 seedBattery） | load 130–160 | **两次 180s 超时**（该文件含 7 步 bootstrap 重计算；判「负载抖落」，待安静窗复跑） |
| seed-demo-propagation / gap-attribution / enterprise-state.seam | — | 未测成（10 分钟命令超时被杀 + 负载 421+ 不可测） |

**播种占套件墙钟的比例（推算，安静窗复测后定稿）**：
- 串行 CPU 口径：≈808 次 seedBattery × ~4–10s + ≈1,351 次 makeApp × ~1.2s ≈ **0.9–2.2h 纯播种 CPU**（占 4 核 × 平静机 1.3h = 5.2 CPU·h 的 **~20–45%**；负载下播种是纯 CPU 密集、受害最重，占比更高）。
- ⚠ 与 SOP §6「÷5–10」的差距要诚实说清：按单位成本推算，快照把播种压到 ~1 次合成 + 每文件还原（估 0.5–2s/文件），套件墙钟期望 **÷2–3**（Amdahl：播种 ~50% → 消除后 ~÷2；再加上 vitest 每文件 ~27s transform+collect 固定开销构成的下限）。**÷5–10 只有在「播种实际占比远高于静态推算」或「连 vitest 固定开销一起治」时才成立** —— 阶段② 用 before/after 实测定案，不许照抄 SOP 的期望值当验收数。

## 5 · 可序列化态全枚举（快照要装什么）

### 5.1 repos（~90 个 Store，全部纯数据）
- **实现形态**（`src/repo/memory.ts`）：每个 Store = `Map<string, T>`，T 一律 plain record（所有写入都过 `structuredClone`，**无函数/无闭包/无类实例**）。
- 特殊结构 5 处，全部可处理：
  | 仓储 | 结构 | 序列化 |
  |---|---|---|
  | 通用 MemStore ×~80 | `Map<tenant∅id, T>` | entries 数组 |
  | `tsPoints` | `Map<tenant\|series, Map<entity\|ts, TsPointRecord>>`（嵌套） | 两层 entries |
  | `rawRows` | `Map<tenant datasetId, Record[]>` | entries |
  | `epochs` | `Map<tenant, number>` | entries |
  | `kbChunks`（向量索引） | `Map<id, KbChunkRecord>`（embedding 是 number[]） | entries |
  | `sim`（MemSimRepo） | 5 个 Map + `perturbationSeq` 计数器 | entries + 计数器 |
- **结论：全部可裸 JSON / `node:v8` serialize。无函数、无循环引用、无不可序列化态。**

### 5.2 repos 之外
| 态 | 播种后内容 | 快照处置 |
|---|---|---|
| blob store（LocalFsBlobStore） | **空目录**（播种链零 blob 写入：service.ts/seed.ts 全文无 `blob.`） | 不快照；每文件照旧 mkdtemp |
| ScriptedLlmClient | `calls:[]` `queue:[]` `handler:null`（合成走 `viaModelingChain:false`，零 LLM 调用） | 不快照；每文件 new 一个，测试自己 enqueue |
| 模拟时钟 | 在 repos.simulationClocks 表里（t0=forecastStart 配置常数，确定性） | 随表快照 |
| RS256 JWT 密钥对 | buildApp 每 app 新生（auth.init） | **不快照**——每文件 fresh app 自带新密钥，token 本来就不能跨 app 用 |
| Metrics / 服务内缓存 | buildApp 新建，播种只留计数器读数 | 不快照（fresh app 自然归零，与今天每个文件 fresh app 语义一致） |
| 定时器 | buildApp 不起（已核实 scheduler/outbox 只 server.ts start） | 无 |

### 5.3 非确定性残留（快照字节与「新鲜合成」会不同的点，必须圈出）
1. `syntheticJobs` 表：`id: newId("job")`（randomBytes）+ `createdAt: new Date()`（service.ts:214/220）——**每次合成都不同**。
2. `users.passwordHash`：argon2 随机盐（auth.ts:67）——每次 makeApp 都不同（今天本来就如此）。
3. `outboxEvents`：runJob 尾 emit 一条 `dataset.regenerated`（service.ts:336），携带墙钟。
4. `connections.lastSyncAt` 等（service.ts:632/669）墙钟字段。

⇒ **字节相等证明（验收①）的口径**：确定性世界表（objects/links/tsPoints/tsSeries/rules/ontology*/derivation*/sim 规则/simulationClocks/solverParams/viewConfigs/sliceSpecs/rawDatasets/rawRows/policies/scenarioPackages/featureConfigs/process*/org*/...）逐表逐字节；上列 4 类非确定表**不在比对口径内**（它们今天在同一台机两次新鲜合成之间也不等）。这正是守门员④ 现有口径（比 `deriveSeedBaseSnapshot` 的 state JSON / measuredCells，不比 users/syntheticJobs）。

## 6 · 还原方案设计（阶段② 蓝图，待审核）

### 6.1 形态
- **快照文件 = 测试缓存，不是基线**（禁令 3 合规）：落 `node_modules/.cache/` 或 `os.tmpdir()`，**不进 git**，文件名带内容键：
  `dc-world-<v>-<seed>-<sha256(seed 链源文件)>.bin`。
  键含 `src/seed.ts / src/synthetic/** / src/seed-derivation-specs.ts / src/repo/{repo,memory}.ts / test/helpers.ts` 的哈希 —— **种子语义变了快照自动作废**，不需要人工失效纪律。
- **序列化格式**：`node:v8` serialize（原生吃 Map，大对象比 JSON 快数倍；~90 张表 entries + 计数器一个对象打完）。备选 JSON（可读性，慢）。
- **谁建快照**：每个 vitest worker 进程内**懒建 + 原子落盘**（tmp 文件 + rename），首个需要世界的文件付一次真合成（负载下 ~40s），其余文件读盘还原。**不改 vitest.config、不加 globalSetup**（禁令 3 边缘：globalSetup 算测试基建改动，先不动）。
- **构建时双跑自证**：快照构建路径里**合成两遍、逐表字节比对**（确定性表口径 §5.3），不等即抛错 —— 守门员④「两次独立合成一致」的证据强度**不降格**：快照机制若让各文件都还原同一批字节，④ 退化成「两次还原一致」恒真；把该性质挪进构建点，每轮套件仍真测一次「合成是纯函数」。

### 6.2 还原入口（test/ 内，src 零改动）
- `test/world-snapshot.ts`（新文件）：
  - `ensureWorldSnapshot(seed): Buffer`（懒建/读盘）
  - `restoreWorldIntoRepos(repos, snapshot): Promise<void>`——还原语义**精确对齐 live runJob**（§6.2.1）。
- `helpers.ts` 改动（**只包测试工装**）：
  - `makeApp` 不变（seedDemo 很便宜；users/tenants 留在 live 路径，argon2 语义不动）。
  - `seedBattery(t, seed)` 内部改为：有快照 ⇒ `restoreWorldIntoRepos`；无快照 ⇒ 走今天的 POST 真合成 **并把结果写成快照**。**对外签名与语义不变**（调用方零修改，808 处调用点原样受益）。
  - 重链另包：`seedDemoPropagationRules` / `seedDemoDerivationSpecs`+`recompute` 的复合快照键（12+1 个文件受益）——快照内容是「seedBattery 之后再叠这两步」的世界态，键加一层后缀。

#### 6.2.1 还原 ≡ live 的精确语义（读码实测，service.ts:228-234）
live `runJob` 的幂等清理 = **只清 origin=SYNTHETIC 的 objects/links/rules + synthetic TS（series+points+aggRuns）**，其余一律 put-upsert。
⇒ 还原路径照抄同一语义：**① 同一组谓词清 SYNTHETIC → ② 快照行 putMany-upsert**。
论证「对任意前态等价」：测试在 makeApp→seedBattery 之间自建的行，两条路都存活（id 不撞）；世界行 id 确定性（R6 前提），upsert 落同键 ⇒ 与 live 逐字节同。**不是「清空 repos 再灌」**——那会抹掉测试自建行，语义改变。
- 消费方排查（全量 grep）：`syntheticJobs` 只有 features.test.ts:191 / simclock.test.ts:42 两处读「最新一条 job」——快照含该行即兼容；`lastSyncAt` 零断言；`passwordHash` 三处（admin-platform/org-world/sop-actions）只断「不回显/可登录」，不断具体值。
- ⚠ putMany 会 structuredClone 一遍（memory.ts:167）——v1 先接受（正确性优先），若实测还原成本过高再评估给 memory.ts 加 **additive** 的快照装填口（动 src/repo 不动 seed 语义，红线允许与否由审核方定）。

### 6.3 防污染判据（验收④ 的机制）
- 每次还原 = **重新 deserialize**（v8.deserialize 产出全新对象图）+ putMany 再 clone 一遍 ⇒ **文件间零共享引用**。
- ⛔ 明令禁止的实现：模块级缓存**解析后的对象图**再往外发（那会让同 worker 内两个文件摸到同一批对象）。模块级只许缓存 **Buffer**（字节），不许缓存 parse 结果。判据测试：A 文件改一个对象 prop，B 文件读不到（验收④ 原文）。
- 世界态读数泄漏的另一条路是**模拟时钟/派生缓存**——已核实全在 repos 表内，随还原灌入，无进程内残留。

### 6.4 红线自查
- 生产 seed 路径（`src/seed*.ts`、`src/synthetic/**`）**零改动**——快照存的是它们的输出。✔
- 不新增门/棘轮/基线 JSON——快照文件是 tmpdir 缓存、不进 git、不作为断言对象。✔
- R6 不破——守门员④ 与 sim-real-cells R6 臂照样绿；确定性性质改在构建点双跑自证（§6.1）。✔
- 调用方零修改——808 处 seedBattery 调用点不动。✔

## 7 · 阶段② 验收对应关系（预告）
1. 还原世界 vs 新鲜合成 **≥3 重文件逐字节相等**（口径 §5.3）→ 用 gap-attribution / seed-demo-propagation / enterprise-state.seam（+ sibling 合并后补 sim-real-cells）。
2. 单文件墙钟 before/after（期望 ÷3 以上）→ 安静窗实测。
3. 全量套件绿 → SOP §4 安静时间窗 + maxWorkers=2。
4. 文件间状态独立 → §6.3 判据测试。

## 8 · 待补（安静窗）
- [ ] 干净 probe：makeApp / seedBattery 单次成本（无争用）
- [ ] 5 个重文件（vle-acceptance / empty-tenant-bootstrap / seed-demo-propagation / gap-attribution / enterprise-state.seam）干净墙钟
- [ ] empty-tenant-bootstrap 负载抖落定性复跑
- [ ] 世界序列化后字节大小（决定每文件还原成本 → ÷? 的下限）
- [ ] v8.deserialize + putMany 灌入的单次还原成本实测

## 9 · 阶段① 状态结语（2026-09-17 12:50）

只读分析与设计**完成**；实测数字为**负载态**（load 65–556，与 `complete-wt-sim-severity` worktree 的 vitest 争用；
两次共 ~20 分钟轮询等不到安静窗，负载最低 144 即回升 500+，另一 run 反复起新 worker）。
**播种占比数字（负载态推算）**：套件每轮 ≈808 次 seedBattery + ≈1,351 次 makeApp ≈ 0.9–2.2h 纯播种 CPU ≈ **平静机墙钟的 20–45%、负载机 ~50%**；
期望提速 **÷2–3（Amdahl 诚实口径）**，SOP §6 的 ÷5–10 需阶段② before/after 实测裁决。
设计一句话：**`seedBattery` 内包一层「v8 字节快照（键=种子链源文件哈希+seed，tmpdir 缓存不进 git）· 有则按 runJob 同语义清 SYNTHETIC+upsert 还原 · 无则真合成并落盘 · 构建点双跑自证 R6」· 808 处调用点零修改**。
⛔ 等审核方「可以」才进阶段②。

## 10 · 阶段② 实证证据（2026-09-17 下午，负载 270–416 标注）

### 10.1 非确定残留全枚举 —— §5.3 的 4 类被实证**大幅扩编**（双跑全量 diff 探针，四轮收敛）

探针方法：同机同代码连合两次 seed=42 世界 → dump 全 ~90 表 → 归一化 + 默认口径比对，
`unexpected` 即「两次新鲜合成之间也不等」的字段全集。四轮：**2000(cap打满) → 2000(cap) → 234 → 0**。

| 类别 | 字段 | 码坐标 | 处置 |
|---|---|---|---|
| 随机 id **跨表传播** 8 组 | connections(newId conn)×1 / rawDatasets(rds)×87 / ontologyTypes(otype)×30 / ontologyLinks(ltype)×101 / rules(rule)×29 / ontologyVersions(over)×1 / derivationRuns(drun)×1 / objectInterfaces(oif)×1 | service.ts:626/719 · ontology.ts upsertType/upsertLinkType/:369 · rules.ts:107 · ontology.ts:923/935 · ontology-governance.ts:1007 | **canonicalizeForDiff 归一化**：规范名换随机 id（确定性属性派生），并集映射深度 ExactMatch 改写所有 mem/sim 表值；行键同步换名重排。归一化后全部回 strict 逐字节 |
| id 传播终点（实证计数） | objects.origin.rawDatasetId ×1556 · objects.origin.sourceConnId ×411 · rawRows 行键 · tsSeries.connId · ontologyTypes.sourceBindings.*.connId · ontologyVersions 整份内嵌快照 | service.ts:749 等 | 同上（深度换名自动覆盖） |
| 叶子级墙钟 | connections.lastSyncAt ×8 · rawDatasets.syncedAt ×87 · tsAggRuns.runAt ×153920 · tsAggSpecs.lastRunAt · tsPoints.ingestedAt（每点一戳）· derivationRuns.startedAt/finishedAt · objectInterfaces.createdAt/updatedAt · ontologyVersions.createdAt · domains.createdAt ×15 · scenarioPackages.createdAt/updatedAt · solverParams.updatedAt | service.ts:632/724 · timeseries.ts:283/380/151 · ontology.ts:372 等 | DIFF_POLICY ignorePaths（逐字段跳过，其余 strict） |
| 随机盐/整表随机 | users.passwordHash（argon2 盐）· syntheticJobs（newId job + 墙钟）· outboxEvents（事件 id + 墙钟 + 嵌随机 job id） | auth.ts:67 · service.ts:214/336 | users=ignorePaths；后两表 countOnly（只比行数） |
| **实证为确定、不纳入** | objects/links/rules 的 origin.jobId（service.ts:225 刻意确定性串 `synthetic-industry-scale-seed`）· tsSeries/tsAggSpecs/tsAggRuns 的 id（tser_/tspec_/tsrun_ 派生串）· tsSeries.createdAt（刻意 new Date(0)）· industryTemplates（battery 不走 LLM 模板路） | — | strict |

**机制教训（写进代码头注）**：随机 id 作 memKey 排序键 ⇒ 双跑排序不同 ⇒ 位置比对全表错位 ——
第二轮 ontologyTypes 的 properties.displayName ×193 洪峰、第三轮 rules 的 ×29 洪峰**全是错位伪差**，
不是内容差。这病靠「归一化行键再 strict」根治，靠 ignorePaths 逐字段圈永远圈不完。

### 10.2 双跑自证（守门员④ 性质在构建点的兑现）

第四轮探针（= buildWorldTwice 同口径）：`unexpected=0`（diffMs≈20s / 82.9MB 世界）。
每次建快照都真合成两遍、按上表口径逐表比对，不一致当场抛错不落盘 ——
「合成是纯函数」在每轮套件仍真测一次，证据强度不降格为「两次还原相等」（那是恒真命题）。

### 10.3 世界体积与构建成本（负载 270–416，安静窗复测后更新）

- 序列化世界 **82.9MB**（tsPoints 39.57MB · tsAggRuns 30.04MB · objects 7.54MB · rawRows 3.12MB · links 2.18MB）。
- 单次合成 24–46s（负载相关）；双跑自证构建 71–119s；归一化+比对 ~14–20s。
- 快照构建成本 = 每轮套件**一次**（磁盘缓存命中后为零），摊到 318 文件 ≈ 每文件 +0.3s。

### 10.4 验收① 字节相等证明（seed=42 与 seed=7 双证）

（待填 —— 探针在跑，结果落此节。）
