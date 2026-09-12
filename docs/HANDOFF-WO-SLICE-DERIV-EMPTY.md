# HANDOFF · WO-SLICE-DERIV-EMPTY —— 切片反查与派生溯源两张表恒空

分支 `claude/handoff-wo-slice-deriv-empty` · 画像 重 · 集成线 `claude/verify-reclaim-6`（分叉点 `9945e77c`）

---

## ① 实测数（自己跑出来的，不是转述）

### 修前复核（全部带金丝雀）

| 断点 | 实测 | 金丝雀 |
|---|---|---|
| ① G-SLICE-REF-PRODUCER-EMPTY | `sliceReferences`（ontology-governance.ts:336）只认 `ref.kind === "slice" \|\| "plan"`；agentcore `refs/report.ts` 全部产出函数（`agentRuleRefs`/`planStepRuleRefs`，调用点 `server.ts:882/884`、`server.ts:1225/1227`、`catalog/service.ts:276-278`）**只产 `kind:"rule"`**，`kind:"slice"` 零产出；contracts `RefKindSchema` 枚举里**根本没有 `"slice"`**——B 侧在类型层面就产不出。A 侧 `RefReportSchema`（llmproviders.ts:77）是 `z.string()` 不拦 kind，report→store→反查链本身活着 | 同文件 `kind:"rule"` 命中 ⇒ 工具没瞎；`dril/relations.ts:57` 的 `resolve_slice` 关系计算命中 ⇒ B 侧**算得出** workflow→slice，只是不回流 |
| ② G-DERIVSPEC-EMPTY | `derivation_specs` ACTIVE **0 条**（接缝测试前态断言 `before.length === 0` 锁死）；`compileSpecs`（ontology-core.ts:219）唯一 src 调用方 = REST 端点（app.ts:4226），**零种子路径**；`derivation_value_runs` 唯一写点 ontology-core.ts:520，**零读取路由**——只写不读，inputs 快照落了库谁也取不到 | 消费方命中：slice-layers.ts ⑭证据层 `ds:` 拼接、change-impact.ts、impact-analysis.ts、solvers/service.ts discoverLevers ⇒ 不是死表，是「接了线没数据」 |
| ③ G-SLICE-ROOT-ARGS-UNDISCOVERABLE | `GET /a/v1/ontology/slices` 摘要只给 `rootType/hops/linkKeys/maxNodes/fixtures`，无 `requiredArgs`；电池合成 4 条需参切片（`enterprise_360`/`order_fulfillment_360`/`order_to_cash_720`/`aop_scenario_chain`） | 占位符正则与 ontology-core.ts resolveTemplate 一字不差 ⇒ 扫描口径有真源可对 |
| ④ G-SLICE16-TWO-VOCABS | `docs/RECONCILE-slice-16-layers-two-vocabs*` **不存在**（工单点名允许如实报）；`two-sets.md` 在（301 行，A≠B 反例证明 + 三处注记全部在位）；B 集 16 层名仍只有 4 个，REQ153 仍只有转述 ⇒ 外部阻塞未解 | `ls docs/RECONCILE-slice-16-layers-*` 命中 `two-sets.md` ⇒ glob 没瞎；`Interface` 在 contracts 的 2 处命中 = `ObjectInterface` 类型（object-interface.ts:43）+ 注记自身（slice-layers.ts 头注），**非 B 集层名** ⇒ 对账文否定结论今日复测仍成立 |
| ⑤ G-SLICE-EMPTYGRAPH-MISREAD | 修前 `POST …/resolve` 空子图返回裸 `{nodes:[],edges:[]}`——「缺参」「零对象」「无匹配」三因接口上不可分（/layers 端点此前已有诊断，resolve 本体没有） | 修后接缝测试两种因分别断言 `missing_args` 与 `no_root_objects` ⇒ 不是一句话 |

### 修后实测

- 接缝测试 `pnpm --filter datacore exec vitest run test/slice-deriv-empty.seam.test.ts` ⇒ **RC=0 · 4 passed**（Duration 242.37s）。
- ① 反查：上报前 `total=0`（病灶前态锁定）→ POST report `kind:"slice"`（service-token）→ `total=1`（workflow/wf_order_tracking），十六层 ①business_scenario 翻 `present`。
- ② 编译 `seam_order_value` → recompute（Order.qty@SO-3391）→ value-runs `inputs=[qty,unitPrice]`、value=decimalRound4(qty×unitPrice)；objectId 过滤 total=1；跨租户 total=0（R2）；种子 3 条 ACTIVE（`fgi_qty_available`/`ibt_eta_day`/`order_value`）幂等重播仍 3；⑭证据层取到 `ds:order_value`。
- ③ 列表摘要 `order_fulfillment_360.requiredArgs=["so"]`；无参切片 `[]`（非缺字段）。
- ⑤ resolve 空图：`empty.reason="missing_args"` + `argCandidates` 含真值 `SO-3391`（填进去真解出子图，`empty` 消失）；root 零对象切片 `reason="no_root_objects"` + `rootObjectTotal=0`。

## ② 改法与论据

- **① 形态判定 = 接了线没数据（缺的是产/消两侧的 kind 约定）**，不是「没接线」（A 侧 report 路由/store/反查链接缝测试端到端证实活着）、不是「接错地方」。修法 = 补约定：`packages/contracts/src/refs.ts` 的 `RefKindSchema` 补 `"slice"`（本单范围内）。B 侧生产方挂载点（agentcore `refs/report.ts` 从 `resolve_slice` 步抽取 sliceKey 上报）属 **agentcore 改动面，本单范围明令不碰** ⇒ 挂账（见 ⑥）。
- **② 形态 = 接了线没数据 ⇒ 补数据，不删死分支**。论据：消费方有四个真功能（⑭证据层/change-impact/impact-analysis/discoverLevers），删分支 = 砍真功能。种子挂 `server.ts`/`seed-cli.ts` 播撒序列尾部而**不碰 `seed.ts`**（范围边界明令，seed-cli.ts 头注自己要求两条播种路径同步）。**公式口径诚实声明**：电池 `derivedProperties` 的聚合 `BY` 方言（`COUNT(Order.so BY bases)`）与 §2 DSL 不互通（`parseFormula` 拒裸标识符），机械翻译需链路映射 = 编造口径 ⇒ 只镜像 3 条自属性公式（语义 1:1，6 个输入属性全部实测存在于 battery.ts）。同时补读路径 `GET …/derivation-specs/:specKey/value-runs`——**只写不读的表是②的另一半恒空**；空结果诚实分态（`NOT_FOUND` 规格不存在 vs ACTIVE 尚未重算，两句话不同）。
- **③ 加性下发 `requiredArgs[]`**，与空图诊断共用 `scanRequiredArgs` 同一实现（口径单源，不抄第二份正则——本仓铁律 0.6「金丝雀与主逻辑共用同一份实现」的同源纪律）。
- **⑤ `empty` 诊断块下沉到 resolve 本体**，与 /layers 共用 `diagnoseEmptyGraph`（同上，单源）；非空路径零额外开销（只在 `nodes.length===0` 时读 root 样本，上限 200）。
- **④ 不动 A 集、不选边**（工单明令不许单方面定权威）：复核 `two-sets.md` 否定结论今日仍成立，本体 §8 加 dated 再复核注记。

## ③ T1–T5 实测输出原文

### T1 变异反证（4/4，全部红在正确的地方）

| 变异 | 实测红位 | 证据 |
|---|---|---|
| 拆 contracts 枚举 `"slice"`（+ rebuild dist） | `slice-deriv-empty.seam.test.ts:29` `expect(RefKindSchema.safeParse("slice").success).toBe(true)` | `VITEST_RC=1` · `AssertionError: expected false to be true` ❯ `:29:54` |
| 拆 value-runs 路由 | `slice-deriv-empty.seam.test.ts:142`（溯源读取断言簇：`expect(preBody.specStatus).toBe("NOT_FOUND")`） | `VITEST_RC=1` · `AssertionError: expected undefined to be 'NOT_FOUND'` ❯ `:142:32` |
| 拆列表摘要 `requiredArgs` | `slice-deriv-empty.seam.test.ts:45` `expect(of360!.requiredArgs).toEqual(["so"])` | `VITEST_RC=1` · `AssertionError: expected undefined to deeply equal [ 'so' ]` ❯ `:45:33` |
| 拆 resolve 的 `empty` 块 | `slice-deriv-empty.seam.test.ts:64` `expect(emptyOut.empty?.reason).toBe("missing_args")` | `VITEST_RC=1` · `AssertionError: expected undefined to be 'missing_args'` ❯ `:64:36` |

没有一处红在「函数不存在/组件不见了」——每条链的红都落在**该修的那件事的产出断言**上。变异全部当场还原，还原后 `git status --porcelain` 为空（= 与已提交修复态逐字节一致）。

### T2 没碰的东西有没有被弄红（merge-base = `9945e77c` 对照）

- **HEAD**：`pnpm --filter datacore exec vitest run test/slices-list.test.ts test/slice-order-fulfillment.test.ts test/slice-governance-full.test.ts test/ontology-core.test.ts test/llm-providers.test.ts test/process-inspect.seam.test.ts test/change-impact-preview.seam.test.ts test/impact-propagation.seam.test.ts test/lever-binding-drift.test.ts` ⇒ **RC=0 · 9 files · 92 passed**。
- **merge-base 基线树**（`/tmp/base-probe`，`pnpm install --prefer-offline` + 两包 build 后跑**同一批命令**）⇒ **RC=0 · 9 passed (9) · Tests 92 passed (92)**——与 HEAD 逐字同数（文件清单与通过数完全一致，仅耗时随负载浮动）。**结论：本单对没碰的东西零新红。**
- **agentcore typecheck**（contracts 枚举变更的 B 侧影响面）：基线树 RC=2 / 13 个 `error TS`，HEAD RC=2 / 13 个，`diff` **零差异**（全部既存于 `test/dsh-e2e-dualrun50.test.ts`，与本单无关）⇒ 枚举加 `"slice"` 对 B 侧编译**零影响**（z.enum 加性，无穷尽 switch）。
- **frontend-shell typecheck**（HEAD）⇒ **RC=0**，零 error。
- 基线树插曲（如实记）：首次 install 后 `node_modules` 与两包 `dist` 一度整树消失（期间无本 agent 操作；磁盘 98% 满），重装重建后批次跑通——已按「没跑完不许交单」重跑，非跳过。

### T3 金丝雀正反两侧（新抽取器 `scanRequiredArgs`）

与主逻辑（`diagnoseEmptyGraph`/`requiredSliceArgs`）**共用同一份实现**，正反两侧都在接缝测试里：
- 正侧（必咬）：`order_fulfillment_360`（root selector `byKey:"{{args.so}}"`）⇒ `requiredArgs=["so"]`、`empty.requiredArgs=["so"]`。
- 反侧（必不咬）：无参切片 ⇒ `requiredArgs=[]`（断言 `toEqual([])`，不是 `undefined`）。

### T4 基线有没有被抬

本单不碰任何基线/台账文件（`git diff HEAD~2 --stat -- scripts/ docs/gate-ledger.json` 零命中）；无 `--update`/`--tighten` 动作。金值检查：未新增对象类型/求解器 ⇒ golden 计数无需同步；migrations 未新增表 ⇒ 四位同步无需动作（`git status --porcelain apps/datacore/migrations/` 为空，`ls` 最大序号 037 与基线一致）。

### T5 交单前三条

- `git status --porcelain` ⇒ 空（变异全部还原后实测）。
- `node scripts/check-branch-base.mjs HEAD` ⇒ **RC=0**（分叉点 `9945e77c` 落后集成线 94 < 200，分叉点在集成线历史里）。
- `node scripts/check-merge-conflict-markers.mjs` ⇒ **RC=0**（实测；本门只查标记不查内容，逐块取错侧它看不见——本单无 merge 动作，风险面不存在）。

## ④ 基线变化

没动。无 gate-ledger、无 baseline、无 golden 文件变更。

## ⑤ 与其他 dev 的文件重叠

`git log --oneline -5 -- <本单碰的文件>`：近期提交全部来自**已收编进集成线**的单（WO-ADOPT-SCHEME-CARRIER / WO-CHANGE-IMPACT-PREVIEW / WO-ONTO-EDGE-TRICLASS），即基线自带、非并发冲突。在途观察：rule-scope-triad 单的 dev 在本机并行跑 `rule-scope-triad.seam.test.ts`——其改动面 `rule-scope.ts`/规则 DSL 与本单零交集；`packages/contracts/src/refs.ts` 无其他在途改动。集成线在本单期间前进了 94 个提交（`9945e77c..e1694f00`），`check-branch-base` 判定无需 rebase。

## ⑥ 没做的部分 + 差什么才能做

1. **B 侧 slice 引用生产方**（① 的仍开一半）：agentcore `refs/report.ts` 目前只产 `kind:"rule"`；需在 workflow/plan/agent 发布路径把 `resolve_slice` 步的 `sliceKey` 抽成 `kind:"slice"` 上报。差什么：属 agentcore 改动面（本单范围明令不碰）。**可派下一步**：小单，改动点 `apps/agentcore/src/refs/report.ts`（新增 `planStepSliceRefs`，抽取逻辑 `dril/relations.ts:57` 现成）+ `server.ts:882/884` 与 `1225/1227` 调用点；验收 = demo 态 `GET /a/v1/ontology/slices/order_fulfillment_360/references` total>0（本单接缝测试已给出 A 侧断言模板）。
2. **聚合法言 `derivedProperties` → §2 DSL 的显式翻译**：电池模板的 `COUNT(... BY ...)` 类公式未镜像进 derivation_specs。差什么：需要 `BY <linkKey>` 到本体链路键的映射语义声明（翻了就是编造口径）。**可派下一步**：先在 PRD/本体里声明映射，再补种子。
3. **前端「需参数」徽标**：`requiredArgs` 已下发，徽标渲染属 frontend-shell 改动面（本单不碰）。差什么：一张前端小单，数据源现成。
4. **④ B 集 16 层名补录**：仓外阻塞，需仓主把 S7 原文档收进 `docs/` 或把 16 个层名逐字抄进 REQ153 证据位；在那之前 A/B 关系只能停在「已证不同、成因未知」（对账文 `two-sets.md` 结论）。
