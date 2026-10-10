# AUDIT · 沙盘 A6「三业务 / 跨 seg 争用」为什么筛不了业务线

**工单** WO-SANDBOX-A6-SEG-AUDIT · **日期** 2026-08-08 · **性质** 只取证、只出方案，**不改代码**
**审计基线（重要，见 §0）** `b2e99b2e`（`claude/handoff-sandbox-a10-audit` == `origin/claude/handoff-sandbox-batch-a2s3`）
**本文全部 file:line 均指该 commit 的树；`origin/main`(778cc589) 上这些文件根本不存在。**

---

## TL;DR（复验方先读这 8 行）

1. **拒绝点在 `service.ts:3118`**（不是 3125；3125 是下一条 zod 判断）→ `VALIDATION_ERROR` / **HTTP 400**。
   引入于 `4c2a7a42`（E3 求解器诞生那单），动机写在 commit message 里：**显式拒绝 > 静默返全域**。
2. **它不是唯一断点，而且是三个里最外层的**。断点② = `chain-impediment.ts` 里 `businessTypes` **零读取**（没接线）；
   断点③ = 6 个 locus 里 5 个**本体上不承载业务线**，唯一承载的那条判据恒 UNKNOWN。
   ⇒ **只删那 6 行 400，会把「诚实报错」换成「静默错答」，比现在更糟。**
3. **今天 15 条阻滞点里，可按业务线裁的是 0 条**（Line 2 / MaterialBalance 7 / MaterialBatch 6 / **Order 0**）。
   甲（单 seg 过滤）单独交付**什么都看不见** —— 派单时必须写明，否则 dev 以为自己没做完。
4. **A6 现状 0 分**：PRD §5.4 指定的判据出口 `segOfBusinessType`（`chain-sim.ts:273`）**生产调用方 = 0**，
   只有 `packages/contracts/test` 五处引用 = 假绿第 9 形态（只有 test 引用 = 已排练，不是已实现）。
5. ✅ **已实测坐实**：seed 42 上**真有**跨 seg 争用 —— `changzhou`(乘用车×7 + 储能 SO-3476) / `wuhan` / `xiamen`。
   （静态复算，金丝雀 = E2 接缝门实测的 `12/3/9` 分布，逐值对上。）
6. ⚠ **但争用面与阻滞点面交集为空**：卡点在 `jinhua`(纯乘用车) 与 `zigong`(纯商用车)。
   ⇒ **争用必须做成「新判据（produce）」，不能做成「在既有阻滞点上打标注（annotate）」** —— annotate 今天恒空，门当场红。
7. ⚠ `model_certified_on` 只连每基地的 `slurry`(制浆) 线，而卡点在 `slitting`(分切) 线 ⇒ **`LINK_HOP` 会空手**，
   得走 `Line.baseId` 值键相等，**争用粒度因此是基地级不是线级**，文案不许写成「这条线被三个 seg 争」。
8. **这份代码不在 `origin/main` 上**（见 §0）。修复要落在 `b2e99b2e` 那条线。

---

## 0. 先纠正一件事：这份代码不在 canonical 上

派单时给的线索是「`apps/datacore/src/solvers/service.ts` 约 `:3125`」。我在默认树（= `origin/main` = `778cc589`）上
第一次查，得到的是一个**恰好相反**的结论假象：

```
$ wc -l apps/datacore/src/solvers/service.ts     # 在 origin/main 上
358 apps/datacore/src/solvers/service.ts
$ grep -rn "chain_impediments" --include=*.ts --include=*.tsx apps packages
（零命中）
```

按铁律 0.6，报「0 命中」之前先自证工具（金丝雀）：

```
$ grep -c "export" apps/datacore/src/solvers/service.ts   → 3      （已知必中，命中）
$ grep -rl "" --include=*.ts --include=*.tsx apps packages | wc -l → 405（扫描面 405 个文件，非空集）
```

金丝雀命中 ⇒ **工具是好的，是这棵树上真没有**。追一层：

```
$ git log --all --oneline -S"chain_impediments" | head
b2e99b2e WO-SANDBOX-S3 ② 枚举器：阻滞点 → N 个候选
...
$ git branch -a --contains b2e99b2e
  claude/handoff-sandbox-a10-audit
  remotes/origin/claude/handoff-sandbox-batch-a2s3
$ git log --oneline -1 origin/main
778cc589 feat(ontoflow): P3 子图→本体发布 ...      ← 沙盘那一批**没并进来**
```

**结论**：整个沙盘家族（`chain_impediments` / `chain-impediment.ts` / `impediment-options.ts` /
`docs/PRD-sandbox-redesign.md` / `SandboxConsole.tsx`）今天**只在 handoff 分支上**，canonical 一行都没有。
本审计分支 `claude/handoff-sandbox-a6-audit` 已 rebase 到 `b2e99b2e`，所有行号按那棵树读。

> 这一条本身就是一个交付风险：A6 的修复要落在 `b2e99b2e` 这条线上，**不是** `origin/main`。
> 若有人在 main 上照本文的行号找，会得到「文件只有 358 行」这个和我第一次一模一样的假象。

---

## 1. 拒绝点：坐实原文与精确位置

### 1.1 原文（`apps/datacore/src/solvers/service.ts:3116–3123`，符号 `SolverService.chainImpediments`）

```ts
3116  private async chainImpediments(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
3117    const rawScope = (args.scope ?? {}) as Record<string, unknown>;
3118    if (rawScope.businessTypes !== undefined || rawScope.modelIds !== undefined) {
3119      throw validationError(
3120        "chain_impediments 暂不支持 scope.businessTypes / scope.modelIds 维度过滤 —— " +
3121          "拒绝静默返全域（R-ARG-FIDELITY）；业务线 scope 入口见 WO-SANDBOX-E2",
3122      );
3123    }
3124    const parsed = ChainScopeSchema.safeParse(rawScope);
3125    if (!parsed.success) throw validationError(`scope 不合法：${parsed.error.issues.map((i) => i.message).join("；")}`);
```

方法头的注释（`:3107–3115`）把意图写死了：

```
3113   * R-ARG-FIDELITY：`businessTypes` / `modelIds` 两维本判定器**不支持** —— 显式拒绝而不是静默返全域
3114   * （"信阳→全 12 基地"那族 plausible-but-WRONG 正是这么来的）。业务线 scope 入口属 WO-SANDBOX-E2。
```

### 1.2 三点订正（审核方的说法基本对，但有三处偏差，逐条给证据）

| # | 派单里的说法 | 实测 | 影响 |
|---|---|---|---|
| ① | 「约 `:3125` 处」 | **拒绝在 `:3118`，抛在 `:3119–3122`**。`:3125` 是**下一条**判断（`scope 不合法`，zod safeParse 失败），与 businessTypes 无关 | 小。但**仓里有三处注释把行号写成 3125**（见 §2.1），一起修 |
| ② | 「显式拒绝」 | ✅ 属实。`validationError`（`apps/datacore/src/errors.ts:14`）→ `new AppError("VALIDATION_ERROR", msg, 400)` ⇒ **HTTP 400 / code `VALIDATION_ERROR`**，走两系统统一错误信封 | 无 |
| ③ | 隐含「这就是唯一断点」 | ❌ **不是**。删掉这 6 行，businessTypes 会被**静默忽略**（见 §2.2 断点②）。这道 400 是**症状的挡板，不是病本身** | **大**。只删 400 = 制造 3113 行注释里点名要防的那个事故 |

### 1.3 它拒绝的到底是什么

拒绝的是**字段的存在性**，不是取值：判据是 `!== undefined`。
所以 `{"scope":{"businessTypes":["storage"]}}` 400，`{"scope":{"businessTypes":[]}}` 也 400（`[]` 先被这行拦下，
轮不到 `ChainScopeSchema` 的 `.min(1)`）。而**契约本身是接受这个字段的**（§2.1 第 3 环）。

### 1.4 从哪个版本引入、当初为什么

```
$ git log --oneline -S"暂不支持 scope.businessTypes" -- apps/datacore/src/solvers/service.ts
4c2a7a42 feat(sandbox-E3): 阻滞点判定器 —— 卡点/堵点/断点机器可判，阈值全从规则读回（WO-SANDBOX-E3）
```

`4c2a7a42`（2026-08-05）**首次引入**，即该求解器诞生的那一个 commit。commit message 末尾原文：

> · R-ARG-FIDELITY：scope.baseIds 真过滤且回带；businessTypes/modelIds **显式 400 拒绝**
>   而不是静默返全域（业务线 scope 入口属 E2）。

**当初的判断是对的**：E3 那单只做「判定器」，`judgeOne` 里只实现了 baseIds 的过滤。
如果那时接受 businessTypes 却不过滤，就是「用户以为筛了储能、拿到的是全域 15 条」——
比 400 糟得多。**这道 400 是一次诚实的 fail-closed，不是偷懒**，评价时不该当成技术债贬义项。
真正的问题是：E2（业务线 scope 入口）落地了，但**只挂在订单类求解器上**，`chain_impediments` 这条路
从此再没人回来接（见 §4）。

---

## 2. 顺链路走一遍：断在哪一环

### 2.1 七环全景

| 环 | 位置 | 状态 | 证据 |
|---|---|---|---|
| ① 沙盘控制台筛选 UI | `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:480–525` | **据实禁用**（不是漏做） | `SCOPE_DIMENSIONS` 逐维渲染；`:496` 只有 `dim.key === "baseIds"` 分支给 checkbox，另两维只读 + 「无 ARGS」徽标 |
| ①' 控制台出参 | `SandboxConsole.tsx:149` / `:257` | 只带 baseIds | `const [baseIds, setBaseIds] = useState<string[]>([])` · `const impArgs = useMemo(() => ({ scope: baseIds.length > 0 ? { baseIds } : {} }), [baseIds])` |
| ①'' 接线事实表 | `apps/frontend-shell/src/views/sim/sandboxConsole.ts:100–128` | **诚实台账**，写着病因 | `businessTypes` / `modelIds` 标 `wiring: "no-args"`，note 原文：「chain_impediments 显式拒绝 scope.businessTypes（后端 service.ts:3125「暂不支持」并报 400）——今天这一维带不下去，故此处只读不可勾。」 |
| ①''' **另一条前端路** | `apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx:82–90` `argsFromView` | **会原样透传** | `for (const dim of ["baseIds","businessTypes","modelIds"])... if (Array.isArray(v) && v.length>0) scope[dim]=v` —— 注释 `:79–80` 明写「引擎该报 400 就让它报 400，前端悄悄吞掉一个维度才是那族 plausible-but-WRONG 的病根」。**所以线上真有一条能打出 400 的路**（视图 `options` 驱动） |
| ② 契约 | `packages/contracts/src/chain-sim.ts:291–298` `ChainScopeSchema` | **接受** businessTypes | `businessTypes: z.array(BusinessTypeSchema).min(1).optional()`。**契约不是断点** |
| ③ REST | `apps/datacore/src/app.ts:2793` `POST /a/v1/solvers/:solverKey/invoke` → `service.ts:4340` 字符串键分发 `if (solverKey === "chain_impediments") return this.chainImpediments(ctx, args)` | 通 | — |
| ④ 求解器入参校验 | `service.ts:3118` | **断点①（显式 400）** | §1.1 |
| ⑤ 求解器内部 | `apps/datacore/src/solvers/chain-impediment.ts:572–576`（`judgeOne`） | **断点②（真断点）** | 见 §2.2 |
| ⑥ 输出 | `chain-impediment.ts:661` `scope: input.scope` 原样回带 | 通 | — |

### 2.2 断点②才是病本身（把 400 删了会更糟）

`judgeOne` 里唯一的 scope 过滤（`chain-impediment.ts:572–576`）：

```ts
572  // scope 过滤：只对**带 baseId 的 locus** 生效；不带 baseId 的对象类型（物料/数据源等）不是基地维实体。
573  const wantBases = input.scope.baseIds;
574  const scoped = wantBases ? objs.filter((o) => o.baseId === undefined || wantBases.includes(o.baseId)) : objs;
575  if (scoped.length === 0) {
576    return unresolved(`scope.baseIds 过滤后无可判对象（${b.locusObjectType}）`);
```

**`businessTypes` 在整个 `chain-impediment.ts` 里零命中**（金丝雀：同文件同命令 `grep -c "baseIds"` = **2** 命中，
证明命令与路径是对的）：

```
$ grep -c "baseIds" apps/datacore/src/solvers/chain-impediment.ts   → 2   （金丝雀，命中）
$ grep -n "businessTypes" apps/datacore/src/solvers/chain-impediment.ts → （零命中，exit 1）
```

**三分法定性（断点②）＝「没接线」**：`input.scope.businessTypes` 在判定器里**一个读取方都没有**。
所以：**删掉 `service.ts:3118` 那 6 行 ≠ 修好**，那等于把「显式 400」换成「静默返全域」——
正是 `service.ts:3114` 注释里点名的「信阳→全 12 基地」那族事故。

### 2.3 断点②之下还有一层：locus 根本不承载业务线（这才是真正难的地方）

判定器的 6 条 binding（`chain-impediment.ts:107–194` `IMPEDIMENT_RULE_BINDINGS`）落在 6 种对象上：

| bindingId | kind | ruleKey | locusObjectType | 该类型有 `businessType` 属性吗 |
|---|---|---|---|---|
| `BOTTLENECK.CAPACITY.process-hard-capacity` | 卡点 | C02 | `Process` | ❌ |
| `BOTTLENECK.CAPACITY.line-utilization-redline` | 卡点 | C05 | `Line` | ❌ |
| `CONGESTION.CAPACITY.order-changeover` | 堵点 | C22 | **`Order`** | ✅（但该判据今天恒 UNKNOWN，见下） |
| `CONGESTION.MATERIAL.batch-idle` | 堵点 | C28 | `MaterialBatch` | ❌ |
| `BREAK.MATERIAL.material-gap` | 断点·物理 | C06 | `MaterialBalance` | ❌ |
| `BREAK.DATA.datasource-stale` | 断点·数据 | C09 | `DataSourceHealth` | ❌ |

种子里**只有三类**对象声明了 `businessType` 属性（`apps/datacore/src/synthetic/battery.ts`）：
`Order`（`:939`）、`DemandSegment`（`:1070`）、`Metric`（`:1113`）。`Line`/`Process`/`MaterialBatch`/
`MaterialBalance`/`DataSourceHealth` **都没有**。

而唯一带 `businessType` 的 locus（`Order`）上的那条判据，**今天恒 UNKNOWN**——
`chain-impediment.ts:136–137` 原注释：

```
// 实测：`Order.changeoverMin` **不是 Order 的对象属性**（由 changeover_sequence 求解器算出），
// 故本判据今天恒 UNKNOWN —— 这是"接了线没数据"，不是"没接线"，reason 里说清楚。
```

（复核过：`grep -rn "changeoverMin" apps/datacore/src` 只在 `battery.ts:326` 的规则表达式、
`extended.ts:303/311` 的求解器产出、`service.ts:4496–4500` 的规则求值注入里出现，
**没有任何一处把它写成 Order 的对象属性**。）

**所以今天的真实处境是**：即便把 400 删掉、把过滤按 baseIds 那个形态照抄一遍，
6 条判据里 5 条的 locus 不承载业务线、剩下 1 条恒 UNKNOWN ⇒ **筛出来的结果与不筛逐字节相同**。
这就是「筛了个寂寞」。**这一段是本审计最要紧的一条，修复方案必须从这里起步，而不是从那 6 行 400 起步。**

### 2.4 用真跑数据坐实：今天 15 条阻滞点里，**可按业务线裁的是 0 条**

审核方 2026-08-08 的真跑记录（`docs/VERIFY-sandbox-A5-2026-08-08.md:9–20`）给出了 locus 分布：

| locus 类型 | 条数 | 承载 `businessType`？ |
|---|---|---|
| `Line`（`LINE-WS-jinhua-slitting` 金华分切 · 自贡分容） | 2（BOTTLENECK） | ❌ |
| `MaterialBalance`（如 `mbal-6` 铜箔，缺口 398 吨） | 7（BREAK） | ❌ |
| `MaterialBatch`（如 `elyte_b2` 电解液，呆滞 121 天） | 6（CONGESTION） | ❌ |
| `Order` | **0**（C22 恒 UNKNOWN） | ✅ 但一条都没产出 |
| `Process` / `DataSourceHealth` | 0 | ❌ |

⇒ **`businessTypes` 过滤今天的作用面是 0/15。**
甲（单 seg 过滤）**单独交付什么都看不见** —— 它的价值是「把门开对、把不能筛的诚实说出来」，
不是「用户能筛了」。**派单时必须把这句写进工单，否则 dev 做完会以为自己没做完。**

---

## 3. `SEG_REGISTRY` 现状（追一层调用，落三分法）

### 3.1 在哪、有什么字段

`packages/contracts/src/base-registry.ts:37–50`

```ts
37  export interface CanonicalSeg {
38    seg: string;        // 乘用车/储能/商用车（前端中文 key）
39    key: "pas" | "ess" | "com";
40    priceWan: number;   // 万元/套
41    marginPct: number;  // 毛利率 %
42    floorPct: number;   // 毛利底线 %
43    color: string;
44  }
46  export const SEG_REGISTRY: CanonicalSeg[] = [
47    { seg: "乘用车", key: "pas", priceWan: 2.2, marginPct: 19, floorPct: 12, color: "#5E8FE8" },
48    { seg: "储能",   key: "ess", priceWan: 1.4, marginPct: 13, floorPct: 11, color: "#36BFA5" },
49    { seg: "商用车", key: "com", priceWan: 1.8, marginPct: 15, floorPct: 11, color: "#DD9551" },
50  ];
```

### 3.2 今天有没有求解器真读它、并让结论跟着变？——**分两条答，不许混为一谈**

#### (a) `order_fullchain`：**是**。链路完整，改值结论真变。三分法 =「接了线 · 有数据 · 已生效」

追到底的四跳（每一跳都读到了调用点，不是 grep 命中就收工）：

1. **册 → 种子**：`apps/datacore/src/synthetic/battery.ts:3946–3952`
   ```ts
   3946  const SEGMENTS = SEG_DEMAND.map((d) => {
   3947    const s = SEG_REGISTRY.find((x) => x.seg === d.segment)!;
   3948    return { ...d, price: s.priceWan, margin: s.marginPct, floor: s.floorPct };
   3949  });
   3950  const demandSegments = SEGMENTS.map((s, i) => ({
   3951    segId: `dseg-${i + 1}`, segment: s.segment, tgt: s.tgt, p50: s.p50, p90: s.p90, act: s.act,
   3952    priceWan: s.price, marginPct: s.margin, floorPct: s.floor,
   ```
2. **种子 → 对象库**：`demandSegments` 落成 `DemandSegment` 对象实例（属性 `marginPct`/`floorPct`）。
3. **对象库 → 求解器**：`apps/datacore/src/solvers/service.ts:3238–3241`
   ```ts
   3238  const dsegs = await this.repos.objects.listByType(ctx.tenantId, "DemandSegment");
   3239  const dseg = dsegs.find((d) => str(d.props.segment) === seg);
   3240  const marginPct = num(dseg?.props.marginPct);
   3241  const floorPct  = num(dseg?.props.floorPct);
   ```
4. **求解器 → 结论**：`service.ts:3258–3269`
   ```ts
   3258  const marginOk = marginPct >= floorPct;
   3259  const priceUpPct = marginOk ? 0 : Math.ceil(floorPct - marginPct);
   3269  else if (!marginOk) { verdict = `提价${priceUpPct}%接`; ... }
   ```
   ⇒ 改 `SEG_REGISTRY` 里储能的 `floorPct: 11 → 20`，`verdict` 会从「可接」翻成「提价 7% 接」。**结论真跟着变。**

> 附带订正一条**过期取证**：`apps/datacore/test/sandbox-chain-scope.seam.test.ts:44–50` 的注释说
> `order_fullchain` 的 seg 是死映射（`modelId.includes("S192")→储能`）、「每一张单都被标成乘用车」。
> **那是历史**：`service.ts:3229–3237` 已经把它修成 `const seg = BUSINESS_TYPE_LABEL[businessTypeOfOrder(op)]`，
> 并把死映射的病因写进了注释。**代码已修、测试注释还停在修之前**。（这是文档漂移，不是缺陷；
> 但下一个 dev 照那段注释做判断会走偏，建议顺手更新。）

#### (b) `chain_impediments`（= A6 要的那个）：**否，零读取**。三分法 =「没接线」

```
$ grep -c "baseIds" apps/datacore/src/solvers/chain-impediment.ts                 → 2   （金丝雀，命中）
$ grep -n "SEG_REGISTRY\|marginPct\|floorPct\|segOfBusinessType" \
        apps/datacore/src/solvers/chain-impediment.ts apps/datacore/src/solvers/impediment-options.ts
  （零命中，exit 1）
```

阻滞点判定器与候选枚举器**从来没有碰过 SEG_REGISTRY**。这与该文件的设计铁律一致
（`chain-impediment.ts:5` 「本引擎里没有任何业务阈值。一个数字都没有」）——
但也意味着 **A6 后半句「保谁的判据来自 `SEG_REGISTRY.marginPct/floorPct`」今天零实现**。

#### (c) 桥函数 `segOfBusinessType`：**只有 test 引用 = 已排练，不是已实现**

PRD §5.4 与 `chain-sim.ts:260–276` 把它指定为「业务线 → 经济参数」的**唯一出口**：

```ts
266   * 二者靠 `BUSINESS_TYPE_LABEL` 对齐。本函数就是那座桥的**唯一出口**：
267   * 拿业务线取它的价/利/底线（PRD §5.4「跨 seg 争用保谁」的判据来源）走这里，
268   * **不许再在任何地方手写「中文细分名 → 业务线枚举」的映射表**
273  export function segOfBusinessType(bt: BusinessType): CanonicalSeg | undefined {
```

全仓引用（金丝雀：同形命令对 `businessTypeOfOrder` 命中 8 处 src 调用，证明命令是对的）：

```
$ grep -rn "segOfBusinessType" --include=*.ts --include=*.tsx apps packages
packages/contracts/src/chain-sim.ts:18       （文件头注释）
packages/contracts/src/chain-sim.ts:273      （定义本体）
packages/contracts/src/chain-sim.ts:292      （ChainScopeSchema 字段注释）
packages/contracts/test/chain-sim.test.ts:44/329/490/491/492   ← 全部是 test
```

**生产调用方 = 0**。三分法 =「**没接线**」，且正是铁律 0.5 判据 #2 点名的假绿第 9 形态
（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且是绿的，零生产调用方——测试咬的是**函数**不是**链路**）。

**这一条直接判定 A6 今天是 0 分**：A6 的验收方式是「改 `SEG_REGISTRY` 一个值 → 结论真跟着变」，
而通往「保谁」结论的那座桥，今天没有任何生产代码走过。

### 3.3 §3 小结表

| 对象 | 三分法 | 判据 | 修法 |
|---|---|---|---|
| `service.ts:3118` 的 400 | **接了线 · fail-closed 挡板** | 有 src 调用方（就是求解器本体）、条件恒满足 | 不是删，是**先把下游填上再放开** |
| `chain-impediment.ts` 的 businessTypes 过滤 | **没接线** | 全文件零命中（金丝雀 baseIds=2） | 接线（§5 甲） |
| `SEG_REGISTRY` → `chain_impediments` | **没接线** | 全文件零命中 | 接线（§5 乙） |
| `segOfBusinessType` | **没接线**（只有 test） | 生产调用方 0 | 接线（§5 乙），并用它做 A6 的判据出口 |
| `SEG_REGISTRY` → `order_fullchain` | **接了线 · 已生效** | 四跳链路逐跳读到调用点 | 无需修 |
| C22 `Order.changeoverMin` | **接了线没数据** | binding 在、locus 在，属性全仓无承载 | 补数据（越出本单） |

---

## 4. 参照系：其它求解器怎么处理 seg 的（**要对齐既有机制，不要再造一套**）

本仓**已经有一套成熟的业务线作用域机制**，出自 `WO-SANDBOX-E2`，单一出处
`apps/datacore/src/solvers/scope.ts`（179 行，整份读过）。

### 4.1 已支持业务线过滤的求解器（≥2 个，实测）

| 求解器 | 入口 file:line | 入参形状 | 过滤发生在哪一层 | 判据从哪读 |
|---|---|---|---|---|
| **`affected_orders`** | `apps/datacore/src/solvers/risk.ts:1270` `const scope = normalizeChainScope(args)` | **顶层扁平** `args.businessTypes` | **取数之后、判定之前的「选集合」层**：`risk.ts:1134–1135` 造谓词 `inScope`，逐单 filter | `orderInChainScope`（`scope.ts:149`）→ `businessTypeOfOrder(orderProps)`（`portfolio.ts:719`）= 种子 `Order.businessType` 优先、客户名兜底 |
| **`order_fullchain`** | `service.ts:3218` `const scope = normalizeChainScope(args)` | 顶层扁平 | 选单层：`service.ts:3222` `pickScopedOrder(...)` → `service.ts:3182` `orderInChainScope(...)` | 同上 |
| **`atp_check`** | `service.ts:3321` | 顶层扁平 | 同上（`service.ts:3324`，`openFirst: true`） | 同上 |
| **`portfolio` 族**（最接近「跨 seg 争用」的先例） | `portfolio.ts:865–885` | `PortfolioInput.businessTypes` | **收窄世界重解**：`portfolio.ts:874–881` 按业务线过滤 `bases` / `lines` / `demandSegments` 后整体重算 | `businessTypeOfOrder` + `businessTypeOfSegmentObj`（`portfolio.ts:723`） |
| **`chain_loss_attribution`** | — | — | **不吃这三维**（连 baseIds 都不读，见 `chainFamilyLines.ts:7` 的实测注释） | — |

### 4.2 这套机制的四个部件（复用时逐个对齐，别新写）

1. **归一**：`normalizeChainScope(args)`（`scope.ts:75`）—— 非法值**抛**（`scope.ts:85`），
   `[]` **归一为字段缺省**（`scope.ts:65`）。注释 `scope.ts:22–26` 写明为什么不能 filter 掉不认识的值。
2. **基地维解析**：`resolveScopeBaseIds`（`scope.ts:124`）—— 未知基地抛，不静默当未限定。
3. **效果层谓词**：`orderInChainScope`（`scope.ts:144`）—— 三维全 AND。
4. **回带**：`echoChainScope` + `isChainScopeUnscoped`（`scope.ts:167` / `:53`）——
   未限定 ⇒ 字段整个不出现 ⇒ 既有调用方逐字节不变（R6）。

### 4.3 ⚠ 已存在的两套 `ChainScope`（接缝上的真裂缝，修复时必须正面处置）

| | contracts 版 | datacore 版 |
|---|---|---|
| 位置 | `packages/contracts/src/chain-sim.ts:291` `ChainScopeSchema`（zod strictObject） | `apps/datacore/src/solvers/scope.ts:46` `interface ChainScope` |
| 谁在用 | **只有 `chain_impediments`**（`service.ts:3124` safeParse） | E2 家族全部（`affected_orders`/`order_fullchain`/`atp_check`） |
| 入参位置 | **嵌套** `args.scope.businessTypes` | **顶层** `args.businessTypes` |
| `[]` 语义 | `.min(1)` ⇒ **拒绝**（400） | `arrayDim` ⇒ **归一为缺省**（= 全域） |
| 未知值 | zod enum 拒 | `normalizeChainScope` 抛（附合法值+中文标签） |

字段同名同义，但**入参位置、`[]` 语义、归一实现三处都不一样**。
今天不炸是因为两套没有交集（`chain_impediments` 那边直接 400 了）。
**A6 一放开，交集立刻出现** —— 同一个前端控制台会同时驱动两族求解器，
一族要 `{scope:{businessTypes}}`、一族要 `{businessTypes}`，`[]` 一族 400 一族当全域。
这正是本仓「metric-aware 反复炸」的同一形态（两半用不同机制不对接）。

---

## 5. 修复方案（最小改动路径）

**先把两件事分开**——WO 问得对，它们不是一件事，工作量差一个量级：

- **甲 · 单 seg 过滤** =「只看储能的阻滞点」。放开一维 + 接一段过滤。
- **乙 · 跨 seg 争用** =「同一条线被三个 seg 争，保谁」。**这是 A6 的真正要求**，需要新判据 + 新输出字段 + 新关系。
  **甲做完，乙不会自动出现。**

### 5.0 契约要不要动

| 项 | 结论 | 依据 |
|---|---|---|
| `ChainScopeSchema`（`chain-sim.ts:291`） | **不动** | 已经接受 `businessTypes: z.array(BusinessTypeSchema).min(1).optional()` |
| `ChainImpedimentSchema` | **甲不动 · 乙要加一个 optional 字段** | 见 §5.2 |
| 两套 ChainScope 统一 | **本单不做，但必须立账** | §4.3。硬统一会动 4 个求解器的入参形状 = 破坏性变更，应单独立单 |

### 5.1 甲 · 单 seg 过滤

#### 引擎侧过滤应该发生在哪一层 —— 三选一，说清为什么

| 层 | 做法 | 判定 |
|---|---|---|
| **取数层**（`service.ts:3126` `loadContext` 之后按 seg 裁 `c.lines/c.orders/...`） | ❌ **不行** | `loadContext` 是**全量共享上下文**，S3 候选枚举器 `impediment-options.ts` 的 `LINK_HOP`（`:221–234`）/ `KEY_JOIN`（`:244–258`）都靠它当可达面。在这里裁 = 把可达面一起裁掉 ⇒ 候选凭空消失，且 gaps 文案会撒谎（说「本体上它是孤点」，其实是被 scope 裁没了） |
| **判定层 / 集合层**（`chain-impediment.ts:572–576`，与 `baseIds` **同一处**） | ✅ **推荐** | ① 与既有 baseIds 逐字同形，零新机制；② `unresolved` 的 reason、`sawMetric` 判定、severity 分母**自动**跟着一致（这三个数今天都是按 `scoped` 算的）；③ 这一层已被实测验证过（`SandboxConsole.tsx:523` 记着「实测 baseIds=changzhou 时 total 15→13」） |
| **输出层**（`detectChainImpediments` 返回前 filter `impediments[]`） | ❌ **不行** | 「算完再筛」⇒ `counts` / `thresholds[]` / `unresolved[]` 的分母仍是全域，与筛后的 `impediments[]` 对不上。这是「筛了个寂寞」的第二形态：**筛是筛了，但屏幕上的数字互相打架** |

#### ⚠ 但**不许照抄 baseIds 的放行形态**

`chain-impediment.ts:574` 现在写的是 `o.baseId === undefined || wantBases.includes(o.baseId)`
—— **不带 baseId 就放行**。businessTypes 若照抄这一句，结果是：
选了「储能」，返回的 15 条里 13 条是 `Line`/`MaterialBalance`/`MaterialBatch`（它们没有 `businessType`，
被 `undefined` 放行）⇒ **用户以为筛了、其实没筛，界面完全看不出来**。
这正是 `service.ts:3114` 那道 400 当初要防的东西，**换个地方复现一遍**。

#### 推荐做法：**诚实降级**（照抄本文件已有的 SUSTAIN 先例，零新机制）

`chain-impediment.ts:613–625` 已经有成熟形态：判不了持续天数就**说没判** + `caveats[]` + `dataMode=PARTIAL`。
businessTypes 按同一形态处理：

| locus 类型 | 处置 |
|---|---|
| 承载 `businessType` 的（今天只有 `Order`） | **真过滤** |
| 不承载的（`Line`/`Process`/`MaterialBatch`/`MaterialBalance`/`DataSourceHealth`） | **进 `caveats[]`**：「本判据的 locus 类型 `<T>` 在本体上不承载业务线属性，本次**未按业务线裁剪**」+ `dataMode` 标 `PARTIAL`。**绝不静默放行** |

#### 精确改动清单（甲）

| # | 文件 : 行 | 函数 | 改法 |
|---|---|---|---|
| 甲-1 | `apps/datacore/src/solvers/chain-impediment.ts:492–533` | `loci()` | 返回项加 `businessType?: BusinessType`，与既有 `baseId?`（`:508–509`）**逐字同形**。只在 `case "Order"`（`:522–523`）填，取值 `businessTypeOfOrder(o.props)`（从 `portfolio.ts:719` import——`scope.ts:4` 已是这么用的，零新机制） |
| 甲-2 | `apps/datacore/src/solvers/chain-impediment.ts:572–576` | `judgeOne()` | 在 `wantBases` 之后加 `wantBts = input.scope.businessTypes`；**承载类** 真过滤，**不承载类** 记 caveat 并整类放行；`scoped.length === 0` 的 reason 文案区分是哪一维筛空的 |
| 甲-3 | `apps/datacore/src/solvers/chain-impediment.ts:658` 附近 | `judgeOne()` 产出 | `dataMode` 在「本次有 businessTypes 限定 且 该 binding 的 locus 不承载」时降为 `PARTIAL`（与 SUSTAIN 同规则） |
| 甲-4 | `apps/datacore/src/solvers/service.ts:3118–3123` | `chainImpediments()` | 把条件从 `businessTypes !== undefined \|\| modelIds !== undefined` **收窄为只剩 `modelIds`**。**建议保留 `modelIds` 的 400**：型号今天没有 contracts 级单源册（`chain-sim.ts:287–289` 原文），放开会立刻变成第二个真相源。同时更新方法头注释 `:3113–3114` |
| 甲-5 | `apps/frontend-shell/src/views/sim/sandboxConsole.ts:108–116` | `SCOPE_DIMENSIONS` | `businessTypes` 的 `wiring: "no-args"` → `"wired"`，note 改成实况（含「不承载业务线的 locus 会诚实报 caveat」这句） |
| 甲-6 | `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:149 / :257 / :345 / :496` | 组件 | 加 `businessTypes` state；`impArgs` 带上它；`scopeText`（`:345` 写死「业务线/产品未接线」）改；`:496` 的 `dim.key === "baseIds"` 判断改成「wired 才给 checkbox」 |
| 甲-7 | `sandboxConsole.ts:112` · `:124` · `ChainImpedimentView.tsx:79` | 注释 | 三处 `service.ts:3125` 的行号引用订正为 `service.ts:3118`（§1.2 ①） |
| 甲-8 | `ChainImpedimentView.tsx:82–90` `argsFromView` | — | **不用动**，它已经原样透传 |

### 5.2 乙 · 跨 seg 争用（A6 的真正要求）

A6 原文（`docs/PRD-sandbox-redesign.md:364`）：

> **A6** | **三业务**：跨 seg 争用场景能产出阻滞点，且保谁的判据来自 `SEG_REGISTRY.marginPct/floorPct`
> | 改 `SEG_REGISTRY` 一个值 → 结论真跟着变

PRD §5.4（`:194–206`）与 §附录 A B6（`:477–479`）把它说得更死：
「**不是三个页签分开看，是同一条线被三个 seg 争用时保谁**」。

**今天缺三样，一样都没有**：

| 缺什么 | 今天的事实 | 证据 |
|---|---|---|
| ① **争用关系**（谁在争这个 locus） | `ChainImpediment.locus` 是**单对象** `{objectType, objectId, label}`，没有「谁在争」的字段 | `chain-impediment.ts:648`（`locus:` 构造处） |
| ② **争用的判定** | `IMPEDIMENT_RULE_BINDINGS` 六条**全是单主体**（「某对象某属性越阈」），没有任何一条是「多个 seg 的需求同时打到同一个 locus」 | `chain-impediment.ts:107–194` 逐条读过 |
| ③ **保谁的判据出口** | `segOfBusinessType` 生产调用方 **0**（§3.2c） | grep 全仓，含金丝雀 |

#### 5.2.0 ✅ 已实测坐实：seed 42 里**真有**跨 seg 争用，但**不在今天出阻滞点的那两条线上**

这一条原本是本审计最大的未验证假设，现已用**静态复算**（不跑 vitest，只按种子代码逐字重放）坐实。

**关系拓扑**（`apps/datacore/src/synthetic/service.ts:828–861`，三种一等关系边）：

```
order_for_model      : Order  → Model     （:841-849，每张单一条）
model_producible_at  : Model  → Base      （:830-840，按 MODEL_BASE_MAP）
model_certified_on   : Model  → Line      （:851-861，props {status, modelId, baseId}）
```

⇒ **`Order → Model → Line` 是 2 跳可达**（`links` 已由 `service.ts:3130` 全量载进判定器）。

**复算方法**：逐字重放 `battery.ts:3510–3520` 的 `orderBases` 派生（`hashString(so) % 可产基地数` 取起点，
≥3 基地取相邻 2 个）+ `businessTypeOfCustomer`（`battery.ts:164`）。
**金丝雀**：复算出的业务线分布 = `passenger 12 / commercial 3 / storage 9`，与 E2 接缝门文件头
（`sandbox-chain-scope.seam.test.ts:24`）**实测抄下来的基线逐值相同** ⇒ 复算是对的。

**结果：13 个落单基地里 3 个存在跨 seg 争用**

| 基地 | 落单数 | 业务线 | 争用？ |
|---|---|---|---|
| **changzhou 常州** | 8 | `passenger` + `storage` | ✅ **最厚的争用面**（SO-3476 储能 4680-LFP vs 7 张乘用车单） |
| **wuhan 武汉** | 3 | `passenger` + `commercial` | ✅ |
| **xiamen 厦门** | 4 | `passenger` + `commercial` | ✅ |
| chengdu / hefei / **jinhua 金华** | 4 / 4 / **7** | `passenger` only | ❌ |
| handan / jiangmen / meishan / xinyang / yangzhou / zaozhuang | 2/4/2/1/1/4 | `storage` only | ❌ |
| **zigong 自贡** | **1** | `commercial` only | ❌ |

#### 5.2.1 ⚠ **最要命的一条：争用面与今天的阻滞点面，交集为空**

今天产出 BOTTLENECK 的两条线是 **`LINE-WS-jinhua-slitting`（金华分切）** 与 **自贡分容**
（`docs/VERIFY-sandbox-A5-2026-08-08.md:18` 真跑实拍）。
对照上表：**jinhua = 纯 passenger，zigong = 纯 commercial —— 两条都没有跨 seg 争用。**
而有争用的 changzhou / wuhan / xiamen，今天**一条阻滞点都没产出**。

**后果（派单时必须写进工单，否则 dev 会做出一个恒空的功能）**：

> 若把「争用」做成**在既有阻滞点上打标注**（annotate），今天会得到 **0 个 contention 实例** ——
> A6 的门当场红，而且红的原因**不是代码错，是设计选错了形态**。

**正确形态是把争用做成一条新判据（produce），不是标注（annotate）**。
依据是 A6 判据的原文措辞：「跨 seg 争用场景**能产出阻滞点**」（`PRD-sandbox-redesign.md:364`）——
**产出**，不是「给已有的加个字段」。落到 `changzhou` 那 8 张单，就是 A6 想要的那个场景：
**同一条线上，1 张储能单（marginPct 13）与 7 张乘用车单（marginPct 19）争，保谁。**

#### 5.2.2 ⚠ 第二条陷阱：`model_certified_on` 只连到**第 1 个车间**的线

`certLinks` 的构造（`battery.ts:3892`）：

```ts
certLinks.push({ modelId: m.modelId, lineId: `LINE-WS-${baseId}-${WORKSHOP_DEFS[0]!.suffix}`, baseId, status });
```

`WORKSHOP_DEFS[0]` = `WORKSHOP_REGISTRY[0]` = **制浆 `slurry`**（`packages/contracts/src/base-registry.ts:447`）。
而每个基地有 **10 条线**（`battery.ts:3591` `nLinesPerBase = WORKSHOP_DEFS.length`，
制浆/涂布/辊压/分切/卷绕/装配/注液/化成/分容/PACK）。

⇒ **`model_certified_on` 边只存在于每基地的 `slurry` 线上**；
今天出卡点的 `LINE-WS-jinhua-slitting`（**分切**）**一条 `model_certified_on` 边都没有**。

**所以 `LINK_HOP`（沿一等关系一跳/两跳）在卡点线上会空手而归。**
可行路径是 **`Line.baseId` 值键相等 → 该基地的订单集**（`impediment-options.ts:244–258`
`narrowByKeyJoin` 有现成实现，且该文件 `:245–247` 的注释正是为这种情形写的：
「有真关系且真能撬动时以关系为准，撬不动才退到值键相等」）。
**争用的粒度因此是「基地级」而不是「线级」**——这一点必须在 PRD 里说清楚，
否则输出会声称「这条线被三个 seg 争」，而实际判据是「这个基地」。**说得比做的准 = 又一个静默错答。**

**最小可信落法（不造假判定）**：

| # | 层 | 改法 |
|---|---|---|
| 乙-0 | **形态定案（最要紧）** | 争用必须做成**一条新的产出判据（produce）**，**不是**在既有阻滞点上打标注（annotate）。依据 §5.2.1：annotate 形态今天产出 **0** 个实例（争用面 changzhou/wuhan/xiamen 与阻滞点面 jinhua/zigong **交集为空**） |
| 乙-1 | **关系来源** | 走 **`Line.baseId` 值键相等 → 该基地订单集**（`impediment-options.ts:244–258` `narrowByKeyJoin` 现成）。**不要走 `LINK_HOP`** —— `model_certified_on` 只连每基地的 `slurry` 线，卡点所在的 `slitting`/`grading` 线上零边（§5.2.2）。<br>⚠ 因此争用粒度是**基地级**，PRD 与输出文案必须照实说，不许写成「这条线被三个 seg 争」 |
| 乙-2 | **规则** | 照 `UNBOUND_IMPEDIMENT_JUDGEMENTS`（`chain-impediment.ts:196+`）的既有纪律：先确认规则库 C01–C33 里**有没有**能担「跨 seg 争用」的规则。**没有就先立规则，不许在引擎里编一条 `contention > 阈值`** —— 那正是该文件明令禁止的「看起来合理的假判定」。<br>（候选：C15「经营毛利底线」`Order.marginPct < Order.floorPct` 已是 `SEG_REGISTRY` 口径的规则，可能可担「保谁」那一半的阈值来源；**本审计未逐条核对 C01–C33，不下结论**） |
| 乙-3 | **契约** `packages/contracts/src/chain-sim.ts`（`ChainImpedimentSchema`） | 加 **optional** 字段：<br>`contention?: { businessTypes: BusinessType[]; keep: BusinessType; basis: { marginPct: number; floorPct: number; source: "SEG_REGISTRY" } }`<br>**必须 optional** ⇒ 既有 15 条阻滞点逐字节不变（R6），既有调用方零影响 |
| 乙-4 | **引擎** `chain-impediment.ts` | 新增一条 binding（进 `IMPEDIMENT_RULE_BINDINGS`，locus = `Line` 或 `Base`）：同一基地上有 ≥2 个业务线的 OPEN 订单在争同一产能面 ⇒ 产出阻滞点并带 `contention`。**「保谁」一律经 `segOfBusinessType(bt)` 取 `marginPct`/`floorPct`，零字面量**（PRD §5.4「禁内联」＋ A7 `boundary-singlesource:check`） |
| 乙-5 | **注入口（为了变异反证，见 §6）** | `detectChainImpediments` 已有现成的 DI 形态：`chain-impediment.ts:720` `const bindings = input.bindings ?? IMPEDIMENT_RULE_BINDINGS`。**照它加一个 `input.segRegistry ?? SEG_REGISTRY`**。<br>⚠ **但要防铁律 0.5 判据 #6 的坑**：`input.bindings` 这个注入口今天**生产与测试都没人传**（实测：`service.ts:3131` 不传；`apps/datacore/test/*.ts` 里也搜不到）。若 `segRegistry` 也走成「只有测试传」，就会得到「测试验的那条路生产不走」——**必须补一条守护断言**（§6 用例 5） |

---

## 6. 验收设计（SEAM-GATE + 变异反证）

**测试文件**：`apps/datacore/test/sandbox-a6-cross-seg.seam.test.ts`（新建）
**同族参照**：`apps/datacore/test/sandbox-chain-scope.seam.test.ts`（E2 的 scope 门）、
`apps/datacore/test/chain-impediment-seam.test.ts`（E3 的接缝门）
**真世界纪律**（照抄 E2 那份的头）：走 `seedBattery`（真 battery 合成种子·seed 42）+
真路由 `POST /a/v1/solvers/chain_impediments/invoke`，**不 mock 求解器、不直构 ctx**。

### 6.1 头号纪律：断言必须落在**结果集本身**

A1 的教训（PRD §9 已把原措辞标成「空转判据」）必须在这里复用：

> ❌ **禁止**这样写：`expect(out.scope.businessTypes).toEqual(["storage"])`
> —— 那只证明「参数被回带了」，**无法失败于真正的病**（结果集根本没筛）。
> ✅ 判据一律落在 `impediments[].locus` **回仓储 join 真值**对拍。

### 6.2 用例清单（名字 + 断言原文）

**用例 1 · 单 seg 过滤 · 效果层**
```ts
it("scope.businessTypes=['storage'] → 200，且每条 Order locus 回仓储 join Order.businessType 必等于 storage", async () => {
  const out = await scan(t, { scope: { businessTypes: ["storage"] } });
  const bySo = await btBySo(t);            // 回仓储取真值，不采信求解器自述（照 E2 门的做法）
  const orderLoci = out.impediments.filter((x) => x.locus.objectType === "Order");
  for (const im of orderLoci) {
    expect(bySo.get(im.locus.objectId),
      `Order locus ${im.locus.objectId} 泄漏了非储能单 —— G-SEG-ATTR-CROSS-SEGMENT 同类事故`
    ).toBe("storage");
  }
});
```

**用例 2 · 不承载业务线的 locus 必须诚实报缺，不许静默放行**（这是「筛了个寂寞」的门）
```ts
it("Line/MaterialBalance 等不承载业务线的 locus，必须进 caveats 并标 PARTIAL，不许当它通过", async () => {
  const out = await scan(t, { scope: { businessTypes: ["storage"] } });
  const notCarrying = out.impediments.filter((x) => x.locus.objectType !== "Order");
  if (notCarrying.length > 0) {
    expect(out.caveats.some((c) => /不承载业务线/.test(c.note)),
      `返回了 ${notCarrying.length} 条不承载业务线的 locus，却没有任何 caveat —— ` +
      `这就是"用户以为筛了、其实没筛"，界面完全看不出来`
    ).toBe(true);
    expect(notCarrying.every((x) => x.dataMode === "PARTIAL")).toBe(true);
  }
});
```

**用例 3 · SEAM 驱动：跨 seg 争用（数据半 × 引擎半，A6 前半句）**
> **实例已实测锁定**（§5.2.0）：seed 42 上 `changzhou` 是 `passenger`(7 单) + `storage`(SO-3476) 争用，
> `wuhan` / `xiamen` 是 `passenger` + `commercial`。**用例可以直接钉这三个基地的名字**，
> 不必写成「至少有一条」这种可以被空实现骗过去的软断言。
```ts
it("A6 · 跨 seg 争用场景能产出阻滞点，且 contention.keep 的判据来自 SEG_REGISTRY", async () => {
  const out = await scan(t, {});                         // 全域扫描，争用是客观事实不需要筛
  const cons = out.impediments.filter((x) => x.contention);
  // 钉死实测的三个争用基地（复算自种子·金丝雀 = E2 门的 12/9/3 分布）
  const bases = [...new Set(cons.map((x) => x.contention!.baseId))].sort();
  expect(bases, "seed 42 上真实存在的跨 seg 争用基地是 changzhou/wuhan/xiamen —— 少一个是漏判，多一个是误判")
    .toEqual(["changzhou", "wuhan", "xiamen"]);
  const con = cons.find((x) => x.contention!.baseId === "changzhou");
  expect(con, "常州 8 张单（7 乘用车 + 1 储能 SO-3476）是最厚的争用面，产不出来 = A6 前半句不成立").toBeDefined();
  expect(con!.contention!.businessTypes.length,
    "争用至少要有两个 seg，否则不叫争用").toBeGreaterThanOrEqual(2);
  expect(con!.contention!.basis.source,
    "保谁的判据必须声明出处是 SEG_REGISTRY，不许是代码里的偏好").toBe("SEG_REGISTRY");
  // 效果层：保下来的必须是册里 marginPct 更高的那一个
  const keep = segOfBusinessType(con!.contention!.keep)!;
  const losers = con!.contention!.businessTypes
    .filter((b) => b !== con!.contention!.keep)
    .map((b) => segOfBusinessType(b)!);
  expect(losers.every((o) => keep.marginPct >= o.marginPct),
    `保下来的是 ${con!.contention!.keep}(marginPct=${keep.marginPct})，` +
    `但败者里有 marginPct 更高的 —— "保谁"不是按册判的`).toBe(true);
});
```

**用例 4 · 变异反证 M1（A6 的验收方式原文：改册一个值 → 结论真跟着变）**
> **变异值是算好的**：常州争的是 `passenger`(marginPct **19**) vs `storage`(**13**) ⇒ 基线 keep = `passenger`。
> 把乘用车 19 → **5**（低于储能 13）⇒ keep 必须翻成 `storage`。武汉/厦门是 19 vs `commercial` **15**，同向翻。
```ts
it("变异反证 M1：SEG_REGISTRY 乘用车 marginPct 19→5（低于储能 13）→ 常州的 contention.keep 必须从 passenger 翻成 storage", async () => {
  const pick = (r) => r.impediments.find((x) => x.contention?.baseId === "changzhou")!.contention!.keep;
  const before = await scanWithRegistry(t, {}, SEG_REGISTRY);
  const mutated = SEG_REGISTRY.map((s) => (s.key === "pas" ? { ...s, marginPct: 5 } : s));
  const after  = await scanWithRegistry(t, {}, mutated);
  const kBefore = pick(before);
  const kAfter  = pick(after);
  expect(kBefore).toBe("passenger");
  expect(kAfter,
    `改了 SEG_REGISTRY 里一个数，"保谁"的结论没变（仍是 ${kBefore}）⇒ 判据不是真从册里读的，` +
    `是代码里另有一份偏好 —— A6 验收方式当场不成立`
  ).toBe("storage");
  expect(kAfter).not.toBe(kBefore);
});
```
> **为什么用注入而不是 `vi.mock("@platform/contracts")`**：整包 mock contracts 在本仓会牵连一大片
> （`chain-sim.ts` / `base-registry.ts` 被几十个模块 import）。用 `detectChainImpediments` 已有的
> DI 形态（`input.bindings ?? IMPEDIMENT_RULE_BINDINGS`，`chain-impediment.ts:720`）加一个
> `input.segRegistry ?? SEG_REGISTRY` 更小、更稳。

**用例 5 · 守护断言：防「测试验的那条路生产不走」（铁律 0.5 判据 #6）**
```ts
it("守护：生产路径传给判定器的 segRegistry 就是 SEG_REGISTRY 本体（不是测试专用副本）", async () => {
  // 生产入口 service.ts:3131 不传 segRegistry ⇒ 判定器必须落到 `?? SEG_REGISTRY` 这一支。
  // 断言方式：全域扫描（走真 REST，无任何注入）产出的 contention.basis 必须与 SEG_REGISTRY 逐值相等。
  const out = await scan(t, {});                          // 真 REST，零注入
  const con = out.impediments.find((x) => x.contention)!;
  const fromRegistry = segOfBusinessType(con.contention!.keep)!;
  expect(con.contention!.basis.marginPct,
    "生产路径拿到的 marginPct 与 SEG_REGISTRY 对不上 ⇒ 生产走的是另一条路，M1 验的那条测试路白验"
  ).toBe(fromRegistry.marginPct);
  expect(con.contention!.basis.floorPct).toBe(fromRegistry.floorPct);
});
```

**用例 6 · R6 确定性（A3 同族）**
```ts
it("同 (seed, scope) 连跑两次，impediments 逐字节一致（含新加的 contention 字段）", async () => {
  const a = await scan(t, { scope: { businessTypes: ["storage"] } });
  const b = await scan(t, { scope: { businessTypes: ["storage"] } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
```

### 6.3 变异反证 M2（掐接线 → 必须变红）

实施单**必须亲手做一遍并在交付说明里贴红的原文**（本审计单不跑测试，故此处只给设计）：

| 掐哪里 | 必须红的用例 | 若没红说明什么 |
|---|---|---|
| 注释掉 甲-2 新加的 businessTypes 过滤那一行 | 用例 1 | 过滤根本没生效，或断言咬的不是结果集 |
| 把 甲-2 的「不承载类记 caveat」改成「不承载类静默放行」 | 用例 2 | 「筛了个寂寞」的门是装饰品 |
| 把 乙-4 的 `keep` 改成固定 `"passenger"` | 用例 3 + 用例 4 | 「保谁」不是按册判的 |
| 把 乙-5 的 `input.segRegistry ?? SEG_REGISTRY` 改成恒取 `SEG_REGISTRY`（忽略注入） | 用例 4 | 注入口是假的，M1 验不到东西 |
| 把 `service.ts:3131` 改成传一份写死的 registry | 用例 5 | 生产与测试实参交集为空（判据 #6 那个坑） |

### 6.4 反向自查：这些断言**能不能失败**

照 A1 的教训逐条过一遍（「无法失败的断言 = 恒绿哑门」）：

- 用例 1 能失败：只要过滤没接上，`bySo.get(...)` 会返回 `passenger`/`commercial`。
- 用例 2 能失败：今天（未修状态）就是红的——因为今天连 200 都拿不到（400）。修完若照抄 baseIds 的放行形态，它也红。
- 用例 3 能失败：今天 `contention` 字段不存在 ⇒ `toBeDefined()` 直接红。
- 用例 4 能失败：M2 表第 3/4 行任一变异都让它红。
- 用例 5 能失败：M2 表第 5 行让它红。
- 用例 6 能失败：任何引入时钟/随机的实现都让它红。

---

## 7. 工作量与派单建议

### 7.1 能不能一个 dev 整单做完 —— **必须一个 dev 整单做**

A6 是**跨「数据半 + 引擎半」**的特性：
- 数据半 = locus 承载业务线（`loci()` 取 `Order.businessType`）、争用关系从哪来（links / 值键相等）；
- 引擎半 = 过滤判定、争用标注、「保谁」经 `segOfBusinessType` 取册。

本仓铁律点名：「**跨数据/引擎两半的特性必须一个 dev 整单做（拆两半用不同机制不对接 = metric-aware 反复炸的根）**」。
再加上 §4.3 已经存在**两套 `ChainScope`**这个现成的裂缝——拆两半几乎必然拼出第三套。

### 7.2 分步（同一 dev、同一条 handoff 分支、**每步 commit + push**）

| 步 | 内容 | 碰的文件 | 出口判据 |
|---|---|---|---|
| **1** | **取证与定案（不做完不许开工步 5）**：① ~~links 表有没有 Line↔Order 边~~ **本审计已做完，见 §5.2.0/§5.2.2**（有 3 种边，但卡点线上无边 ⇒ 走值键相等、粒度为基地级）；② ~~seed 里有没有真争用~~ **已做完，changzhou/wuhan/xiamen 三处**；**③ 仍需做**：规则库 C01–C33 里哪条能担「跨 seg 争用」，没有就立规则 | 只读 + 回写 `docs/PRD-sandbox-redesign.md` §5.4 | 逐条核过 C01–C33 并贴结论；无规则则显式立单，**不许编判定** |
| **2** | 甲·引擎过滤 + 诚实降级 | `solvers/chain-impediment.ts`(`loci`/`judgeOne`) · `solvers/service.ts:3118` | 用例 1 + 用例 2 绿 |
| **3** | 甲·前端解禁 + 三处行号订正 | `views/sim/sandboxConsole.ts` · `views/sim/SandboxConsole.tsx` | frontend vitest 绿 |
| **4** | 乙·契约加 optional `contention` | `packages/contracts/src/chain-sim.ts` + `packages/contracts/test/chain-sim.test.ts` | 既有 15 条阻滞点逐字节不变 |
| **5** | 乙·引擎产出 contention + `segOfBusinessType` 接线 + `segRegistry` 注入口 | `solvers/chain-impediment.ts` | 用例 3 + 用例 5 绿 |
| **6** | 接缝门 + 变异反证 | `apps/datacore/test/sandbox-a6-cross-seg.seam.test.ts`（新建） | 用例 1–6 全绿 + M2 五条变异**逐条贴红的原文** |
| **7** | 注册即更 + 本体回写 | `apps/datacore/test/ontology-core.test.ts` 金值 · `docs/SYSTEM-ONTOLOGY.md` §2/§4/§7 · `scripts/gate-ledger.json` | `ontology-writeback:check` + `gate-ledger:check` 绿 |

**粗估**：步 2–3 约半天（是「接一条线」，不是「造一道门」）。
步 1/4/5/6 是主体，1–2 天，**其中步 1 的不确定性最大**——若 links 里没有 `Line`↔`Order` 边、
且规则库里确实没有跨 seg 争用的规则，步 5 会从「接线」升级为「加对象/加规则」，**再加 1 天以上**。

### 7.3 CPU 画像与并发

**重画像**（要跑 datacore vitest）⇒ 按铁律 2 的表，**≤1，且 gate 跑着时为 0**。

### 7.4 顺手立的三笔账（不在本单范围内，但发现了就记上）

1. **两套 `ChainScope` 未统一**（§4.3）—— A6 放开后交集出现，建议单独立单。
2. **`input.bindings` 注入口零调用方**（`chain-impediment.ts:720`，生产与测试都没人传）—— 属「留了口没人用」。
3. **`sandbox-chain-scope.seam.test.ts:44–50` 的注释是过期取证**（§3.2a 附注）—— 代码已修、注释停在修之前。

---

## 8. 诚实边界（分三类，逐条）

### 8.1 亲手读代码验过的（读到了调用点与条件，不是 grep 命中就收工）

| # | 结论 | 怎么验的 |
|---|---|---|
| 1 | 拒绝点在 `service.ts:3118`，抛在 `:3119–3122`，符号 `SolverService.chainImpediments`（`:3116`） | `Read` 了 `service.ts:3060–3200` 全段 |
| 2 | 错误码 = `VALIDATION_ERROR` / HTTP **400** | 读到 `apps/datacore/src/errors.ts:14` 定义原文 |
| 3 | 拒绝判据是**字段存在性**（`!== undefined`），不是取值 | 读原文 |
| 4 | 引入于 `4c2a7a42`（2026-08-05，E3 那单），动机在 commit message 里写着 | `git log -S` + `git log -1 --format=%B` 读全文 |
| 5 | 契约 `ChainScopeSchema` **接受** businessTypes | 读 `packages/contracts/src/chain-sim.ts:291–298` |
| 6 | `judgeOne` 里 scope 过滤**只处理 baseIds** | 读 `chain-impediment.ts:536–695` 全函数 |
| 7 | 6 条 binding 的 locus 类型；只有 `Order` 可能带业务线；C22 那条恒 UNKNOWN | 读 `chain-impediment.ts:107–194` 全表 + `:136–137` 注释 + 复核 `changeoverMin` 全仓出现处 |
| 8 | `loci()` 怎么取 `baseId`（`:508–509`），可照此加 `businessType` | 读 `chain-impediment.ts:492–533` 全函数 |
| 9 | E2 那套 scope 机制的四个部件与调用点 | **整份读完** `apps/datacore/src/solvers/scope.ts`（179 行） |
| 10 | `order_fullchain` 的 SEG_REGISTRY 链路四跳全通、改值 verdict 真变 | 逐跳读到 `battery.ts:3946–3952` → `service.ts:3238–3241` → `:3258–3269` |
| 11 | 前端三条路径的实际行为（控制台禁用 / 台账诚实 / `argsFromView` 透传） | 读 `SandboxConsole.tsx` 相关行 + `sandboxConsole.ts:80–128` + `ChainImpedimentView.tsx:60–90` |
| 12 | REST 路由在 `apps/datacore/src/app.ts:2793` | grep 命中后确认是 `app.post(...)` 定义行 |
| 13 | `detectChainImpediments` 已有 DI 形态（`:720` `input.bindings ?? ...`） | 读 `:719–740` |
| 14 | 沙盘代码不在 `origin/main`，在 `b2e99b2e` | `git log --all -S` + `git branch -a --contains` + `git log -1 origin/main`，全部带金丝雀 |
| 15 | 种子里三种一等关系边（`order_for_model` / `model_producible_at` / `model_certified_on`），`Order→Model→Line` 2 跳可达 | 读 `apps/datacore/src/synthetic/service.ts:828–861` 全段 |
| 16 | `model_certified_on` **只连每基地的 `slurry`（制浆）线**；每基地 10 条线 | 读 `battery.ts:3892`（`WORKSHOP_DEFS[0]!.suffix`）+ `battery.ts:3591`（`nLinesPerBase`）+ `packages/contracts/src/base-registry.ts:446–457`（`WORKSHOP_REGISTRY` 十条，`[0]` = 制浆 `slurry`） |
| 17 | 今天 15 条阻滞点的 locus 分布：Line 2 / MaterialBalance 7 / MaterialBatch 6 / **Order 0** | 读 `docs/VERIFY-sandbox-A5-2026-08-08.md:9–20`（审核方真跑实拍记录） |
| 18 | 卡点线是 `LINE-WS-jinhua-slitting`（金华**分切**） | 读 `docs/VERIFY-sandbox-A5-2026-08-08.md:18` 原文 |

### 8.1b 静态复算验过的（**不跑 vitest**，只按种子代码逐字重放；脚本可复现）

| # | 结论 | 方法 | 金丝雀 |
|---|---|---|---|
| 19 | seed 42 的 24 张单落到 13 个基地，其中 **changzhou / wuhan / xiamen 三处存在跨 seg 争用**；changzhou 是 `passenger`×7 + `storage`×1(SO-3476) | 逐字重放 `battery.ts:3510–3520` 的 `orderBases` 派生（`hashString(so) % 可产基地数`，≥3 基地取相邻 2）+ `businessTypeOfCustomer`（`battery.ts:164`）+ `MODEL_BASE_MAP`（`battery.ts:64–71`）+ `HTML_ORDERS` 24 行（`battery.ts:194–218`） | **复算出的业务线分布 = `passenger 12 / commercial 3 / storage 9`，与 E2 接缝门文件头 `sandbox-chain-scope.seam.test.ts:24` 实测抄下的基线逐值相同** |
| 20 | **争用面与阻滞点面交集为空**：jinhua = 纯 passenger、zigong = 纯 commercial | 上表 × #17/#18 对照 | 同上 |

> ⚠ 这两条是**静态复算**不是真跑：它重放的是 `generateBattery` 里那一段派生逻辑，
> **没有**经过仓储落库、`loadContext`、以及任何可能在中途改写 `Order.bases` 的代码。
> 置信度高（金丝雀对上了一个独立来源的实测基线），但**实施单仍应在真跑上复核一次**。

### 8.2 只 grep 到（**带金丝雀**，但**没有再追一层**，请复验方注意）

| # | 结论 | grep 证据 | 金丝雀 | 为什么没追下去 |
|---|---|---|---|---|
| A | `businessTypes` 在 `chain-impediment.ts` 里**零命中** | `grep -n "businessTypes" <file>` → exit 1 | 同文件 `grep -c "baseIds"` = **2** | 已是否定结论的最强形态（全文件读过一遍，确认无间接分发） |
| B | `SEG_REGISTRY`/`marginPct`/`floorPct`/`segOfBusinessType` 在 `chain-impediment.ts` + `impediment-options.ts` 里**零命中** | 同上 | 同上 | 同上 |
| C | `segOfBusinessType` **生产调用方 0**（只有 `packages/contracts/test/chain-sim.test.ts`） | `grep -rn "segOfBusinessType" --include=*.ts --include=*.tsx apps packages` 共 8 行，5 行在 test、3 行在定义文件自身 | 同形命令对 `businessTypeOfOrder` 命中 8 处含 5 处 src 调用 | **未排除**「经 barrel re-export 后被别名调用」这一种可能。该包有 `index.ts` barrel（2026-08-08 已知的 ESM `./x.js` 说明符解析坑）。**判为「没接线」的置信度：高但非 100%** |
| D | 种子里只有 `Order`/`DemandSegment`/`Metric` 三类声明了 `businessType` 属性 | `grep -n "businessType" apps/datacore/src/synthetic/battery.ts`（`:939`/`:1070`/`:1113`） | 同命令另有 20+ 行命中，非空集 | 未逐类展开读 `Line`/`Process` 的完整属性表；**可能存在别名字段**（如 `segment` / `kind`）能间接推出业务线 |
| E | `input.bindings` 注入口**生产与测试都没人传** | `grep -rn "bindings" apps/datacore/test/*.ts` 无相关命中；`service.ts:3131` 不传 | `grep -c "chain_impediments" chain-impediment-seam.test.ts` = **5** | 未逐个测试文件读完 |

### 8.3 未验证的假设（**实施前必须先证**，尤其步 1）

| # | 假设 | 风险 |
|---|---|---|
| ~~ⅰ~~ | ~~`links` 表里存在能把 `Line` 连到 `Order`/`Model` 的一等关系行~~ | ✅ **已关闭**（§5.2.0/§5.2.2、诚实边界 #15/#16）：**有**三种边、2 跳可达，**但卡点所在的线上无边** ⇒ 结论改为「走值键相等，粒度降为基地级」 |
| ~~ⅲ~~ | ~~seed 42 真的存在跨 seg 争用~~ | ✅ **已关闭**（诚实边界 #19）：**存在**，changzhou / wuhan / xiamen 三处。**但同时查出一个更糟的事实**（§5.2.1）：争用面与今天的阻滞点面**交集为空** ⇒ annotate 形态会恒空 |
| ⅱ | 规则库 C01–C33 里有一条能担「跨 seg 争用」的规则 | **高（仍未关闭）**。`chain-impediment.ts:196+` 的 `UNBOUND_IMPEDIMENT_JUDGEMENTS` 已经为「断点·时间」逐条核过 C01–C33 并判定「无」；**我没有为「跨 seg 争用」做同样的逐条核对**。这是步 1 剩下的唯一取证项 |
| ⅲ' | 争用做成「新判据」后，那条判据的**阈值**能从某条规则读回来 | **高**。`chain-impediment.ts:5` 的铁律是「引擎里一个业务阈值都没有，阈值全从规则读回，读不回来就 UNKNOWN」。若 ⅱ 落空，新判据会**结构性地恒 UNKNOWN** —— 那等于 A6 依旧不过，只是报错文案更诚实了 |
| ⅳ | 甲-2 改完后既有 15 条阻滞点（未限定时）逐字节不变 | **低**。设计上未限定 ⇒ `wantBts === undefined` ⇒ 走原路径。但**没跑过测试**（本单禁止跑 vitest） |
| ⅴ | §6 的用例 1–6 全部可执行、断言语法在本仓 helpers 下成立 | **中**。`scan()` / `scanWithRegistry()` / `btBySo()` 三个 helper 中，只有 `btBySo` 在 `sandbox-chain-scope.seam.test.ts:56–59` 有现成实现可抄；另两个是我按 `invokeSolver` 的形状拟的，**未编译验证** |
| ⅵ | 保留 `modelIds` 的 400（甲-4）是对的 | **低–中**。依据是 `chain-sim.ts:287–289`「型号今天没有 contracts 级单源册」。但这是**产品决策不是技术决策**，需要仓主拍板 |

### 8.4 对派单里那句「引擎显式拒绝」的最终裁定

**基本成立，三处需订正**（§1.2 已列）：行号是 `3118` 不是 `3125`；错误码是 `VALIDATION_ERROR`/400（这条派单没说，补上）；
以及最要紧的一条——**它不是唯一断点，而且是三个断点里最外层、最好修的那一个**：

```
断点① service.ts:3118        显式 400（诚实的 fail-closed）        ← 派单指到的
断点② chain-impediment.ts    businessTypes 零读取（没接线）
断点③ 本体层                  5/6 的 locus 不承载 businessType；唯一承载的那条判据恒 UNKNOWN
                            ⇒ 实测：今天 15 条阻滞点里可按业务线裁的是 0 条
断点④ 数据面（本审计新查出）    争用面(changzhou/wuhan/xiamen) 与 阻滞点面(jinhua/zigong) 交集为空
                            ⇒ 「在既有阻滞点上打标注」这个形态今天恒空，A6 门会红在设计上而不是代码上
```

**只修①会把「诚实报错」换成「静默错答」**，比现在更糟。
**而只做①②③、把争用做成 annotate，会得到一个恒空的功能 —— 全绿、零产出、A6 依旧不过。**
这两条是本审计最想让复验方带走的结论。
