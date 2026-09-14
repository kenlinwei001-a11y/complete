# AUDIT · 沙盘「三业务跨 seg 推演」为什么做不了

> ## ⚠️ 过期横幅（收编时加·2026-08-13）
> - **基线 sha**：`4ae28e0e` — **canonical 已在其后 260 个提交**。
> - **本次有没有重跑**：**没有**（本文性质即「只取证、只出方案」）⇒ 改做**抽查 `file:line` 锚点回代码核对**。
> - **抽查结论（2/2 命中·未漂移）**：
>   | 文中锚点 | 收编日实测 | 判 |
>   |---|---|---|
>   | `apps/datacore/src/errors.ts:14` `validationError = new AppError("VALIDATION_ERROR", msg, 400)` | **:14 逐字命中** | ✅ |
>   | `apps/datacore/src/solvers/scope.ts:46` `interface ChainScope` | **:46 逐字命中** | ✅ |
> - 未复核：其余 58 个锚点（`battery.ts` / `service.ts` 的四位数行号未逐条回核）。

**工单** WO-A6-SEG（欠账 #146 复验） · **日期** 2026-08-11 · **性质** 只取证、只出方案，**不改 `apps/**` 生产代码**
**审计基线** `origin/claude/inspiring-gates-aqczjg`（canonical）= `4ae28e0e`
**本文全部 `file:line` 均指 canonical 的树，且已逐条在该树上复验**（不是从前人分支抄的）

---

## TL;DR（复验方先读这 10 行）

1. **定性 = 「诚实的未实现」**，不是真缺陷，也不是审核方记错了账。
   引擎确实在 `apps/datacore/src/solvers/service.ts:3118` **显式拒绝**，抛 `VALIDATION_ERROR` / **HTTP 400**。
   它是**主动 fail-closed 的挡板**，防的是「用户以为筛了储能、其实拿到全域」那族静默错答。
2. **审核方的账基本成立，但有三处必须订正**（§6）：行号是 **3118** 不是 3125；
   **前端不是"接了"而是三条路三种状态**；**它不是唯一断点，是四个断点里最外层的那一个**。
3. **只删那 6 行 400 会让系统更糟** —— `businessTypes` 在判定器里**零读取**
   （`chain-impediment.ts` 全文件 0 命中，金丝雀 `baseIds` = 2 命中），删了挡板就等于静默返全域。
4. **本体层：跨 seg 争用是成立的。** 用**完全不含 hash 的纯查表**证明：
   `changzhou`(passenger+storage) 与 `wuhan`/`xiamen`/`zigong`(commercial+passenger) 四个基地
   **结构上可承载跨 seg 争用**。⇒ A6 不是伪需求。
5. **但引擎层今天可按业务线裁的阻滞点 = 0 条**：6 条判据的 locus 里 **5 种本体上不承载业务线**
   （`Line`/`Process`/`MaterialBatch`/`MaterialBalance`/`DataSourceHealth` 属性表已逐个读完，**无别名字段**），
   唯一承载的 `Order` 那条（C22）**恒 UNKNOWN**。
6. **⚠ 新发现（前人分支没查到）：`Model.applicationDomain` 是本体里的第二套业务线词表**，
   有数据（6 个型号）但**生产零消费方**（金丝雀：全仓 8 处命中，全是声明/标签/种子）。
7. **⚠ 而且它不能拿来替代 `Order.businessType`**（纯查表证明·无 hash）：
   24 单里 **3 单会被错标**（宇通客车的 SO-3437/3506/3540 是 commercial，按型号推得 passenger），
   且 `applicationDomain` 取值集 **没有「商用车」** ⇒ commercial 在 Model 层结构性不可达。
   **这条直接否掉「走 `model_certified_on` 把粒度提到线级」这条看起来最诱人的修法。**
8. **前端三条路，三种状态**（§4）：控制台**据实禁用**（不是漏做）· `ChainImpedimentView` **原样透传**
   （但 16 个内置视图**无一设 `options`** ⇒ 默认态下这条路带不出东西）· **MSW mock 也复刻了这道 400**（前人漏记的第 4 处）。
9. **前人分支 `handoff-sandbox-a6-audit` 已整体过期**：它落后 canonical **34623 行**，
   其 §0 头号结论「这份代码不在 canonical 上」**今天完全反了** —— 沙盘全家族已在 canonical（§0）。
10. **我自己抓到自己一次**：我的复算金丝雀只验了「业务线映射」，**没验「落单派生」**，
    而后者才是承重的那一半。已按 §3.3 降级处理，未验的部分一律标为**待真跑确认**，不当结论用。

---

## 0. 与前人分支的对账（`origin/claude/handoff-sandbox-a6-audit`）

派单要求先读前人。读完的结论是：**那份审计的取证质量很高，但它的分支定位结论已整体反转。**

```
$ git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg ; echo $?
0                       ⇒ 我开工时的 HEAD 是 canonical 的祖先 = 落后，已按铁律 0.6 重开分支

$ git diff --stat origin/claude/inspiring-gates-aqczjg origin/claude/handoff-sandbox-a6-audit | tail -1
 202 files changed, 1304 insertions(+), 34623 deletions(-)
```

**两点必须说清（否则复验方会照那份文档的 §0 去 `origin/main` 找文件，重蹈它自己踩过的坑）**：

| 前人 §0 的结论 | 今天的事实 | 判据 |
|---|---|---|
| 「整个沙盘家族只在 handoff 分支上，canonical 一行都没有」 | ❌ **已反转**。`chain-impediment.ts`(799 行) / `impediment-options.ts`(760 行) / `service.ts`(4652 行) / `SandboxConsole.tsx` **全部在 canonical** | 直接 `wc -l`（本文 §1 起所有行号都取自 canonical） |
| 「修复要落在 `b2e99b2e` 那条线」 | ❌ **已过期**。那条线现在**落后 canonical 34623 行**，唯一独有内容就是那份审计文档本身（+794） | 上面的 two-dot diff |

**逐条对账（前人的实质结论，在 canonical 上是否仍成立）**

| # | 前人结论 | canonical 复验 | 结果 |
|---|---|---|---|
| 1 | 拒绝点在 `service.ts:3118`（不是 3125） | 原文逐字相同，行号相同 | ✅ **成立** |
| 2 | 错误码 `VALIDATION_ERROR` / HTTP 400 | `errors.ts:14` `validationError = new AppError("VALIDATION_ERROR", msg, 400)` | ✅ **成立** |
| 3 | `businessTypes` 在 `chain-impediment.ts` 零读取 | 0 命中，金丝雀 `baseIds` = 2 命中 | ✅ **成立** |
| 4 | `segOfBusinessType` 生产调用方 = 0 | 9 处命中：3 处在定义文件自身、6 处在 `contracts/test`。**并已追一层关掉它自己没关的口**（§2.3） | ✅ **成立且已闭合** |
| 5 | 6 条 binding 的 locus，只有 `Order` 带业务线；C22 恒 UNKNOWN | `chain-impediment.ts:107–194` 逐条读过，相同 | ✅ **成立** |
| 6 | `model_certified_on` 只连每基地的 `slurry` 线 | `battery.ts:3907` `LINE-WS-${baseId}-${WORKSHOP_DEFS[0]!.suffix}`，`WORKSHOP_REGISTRY[0]` = 制浆 `slurry` | ✅ **成立**（行号 3892→**3907**） |
| 7 | `order_fullchain` 死映射「代码已修、测试注释停在修之前」 | `service.ts:3237` 已是 `BUSINESS_TYPE_LABEL[businessTypeOfOrder(op)]`；而 `sandbox-chain-scope.seam.test.ts:44–50` 的注释**在 canonical 上仍写着「本单未修·已上报」** | ✅ **成立·漂移仍在**（值得顺手修） |
| 8 | 跨 seg 争用基地 = changzhou / wuhan / xiamen（3 个） | 我独立复算得到**相同 3 个**；但**结构上界是 4 个**（多一个 `zigong`），且落单派生这一半我**没能验成**（§3.3） | ⚠ **部分成立·见 §3.3** |
| 9 | 「争用面与阻滞点面交集为空 ⇒ annotate 形态恒空」 | **证据链不完整**：两个阻滞点里我只能在 canonical 上坐实 `LINE-WS-jinhua-slitting` 一个；第二个（前人称"自贡分容"）**canonical 上无出处**，而 `zigong` 恰恰是结构上可跨 seg 的 | ⚠ **未坐实·见 §3.4** |
| 10 | 前端接线事实 | 三条路我全部复验，**并补出前人漏掉的第 4 处（MSW mock）** | ✅ **成立 + 补充** |

**前人漏掉的（本文新增）**：`Model.applicationDomain` 第二套词表（§3.5）、MSW mock 第 4 处 400（§4）、
`view.options` 在 16 个内置视图里**一个都没设**（§4）。

---

## 1. 拒绝点：原文、位置、触发条件

### 1.1 原文（`apps/datacore/src/solvers/service.ts:3116–3125`，符号 `SolverService.chainImpediments`）

```ts
3113   * R-ARG-FIDELITY：`businessTypes` / `modelIds` 两维本判定器**不支持** —— 显式拒绝而不是静默返全域
3114   * （"信阳→全 12 基地"那族 plausible-but-WRONG 正是这么来的）。业务线 scope 入口属 WO-SANDBOX-E2。
3115   */
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

### 1.2 是抛错、返空、还是静默过滤？—— **抛错**

`validationError`（`apps/datacore/src/errors.ts:14`）：

```ts
14  export const validationError = (msg: string) => new AppError("VALIDATION_ERROR", msg, 400);
```

⇒ **HTTP 400**，code `VALIDATION_ERROR`，走两系统统一错误信封 `{ error: { code, message, requestId } }`。
**不是返空，不是静默过滤** —— 这一点很重要，见 §2 定性。

### 1.3 触发条件：判**字段存在性**，不判取值

判据是 `!== undefined`。所以：

| 入参 | 结果 |
|---|---|
| `{"scope":{"businessTypes":["storage"]}}` | **400** |
| `{"scope":{"businessTypes":[]}}` | **400**（`[]` 先被 `:3118` 拦下，轮不到 `ChainScopeSchema` 的 `.min(1)`） |
| `{"scope":{"baseIds":["changzhou"]}}` | 200，且**真过滤**（`chain-impediment.ts:573–574`） |
| `{"scope":{}}` / `{}` | 200，全域 |

**契约本身是接受这个字段的** —— `packages/contracts/src/chain-sim.ts:293`：

```ts
291  export const ChainScopeSchema = z.strictObject({
293    businessTypes: z.array(BusinessTypeSchema).min(1).optional(),
```

⇒ **契约不是断点**。断的是求解器实现，不是接口定义。

---

## 2. 定性：**诚实的未实现**（三选一）

> **判据**：本仓口径是「宁可诚实报缺口也不静默错答」。
> 若引擎是**诚实地告诉用户做不了**，这条就不是 bug 而是待做功能，排期与修法完全不同。

### 2.1 三条证据，指向同一个定性

**证据①：拒绝是主动写的，不是没想到。** 方法头注释 `:3113–3114` 把动机写死了，
并且**点名了它要防的那族事故**（"信阳→全 12 基地" plausible-but-WRONG）。

**证据②：删了挡板 = 制造它点名要防的那个事故。** 因为下游**零读取**：

```
$ grep -n "baseIds" apps/datacore/src/solvers/chain-impediment.ts     # 金丝雀
573:  const wantBases = input.scope.baseIds;
576:    return unresolved(`scope.baseIds 过滤后无可判对象（${b.locusObjectType}）`);
                                                        ⇒ 2 命中，工具正常

$ grep -n "businessTypes" apps/datacore/src/solvers/chain-impediment.ts
                                                        ⇒ 0 命中（exit 1）
```

`judgeOne` 里唯一的 scope 过滤（`chain-impediment.ts:573–576`）只认 `baseIds`。
⇒ 把 `:3118` 那 6 行删掉，`businessTypes` 会被**静默忽略**，用户拿到全域 15 条却以为筛过了。
**这比 400 糟得多。** 三分法定性 = **没接线**。

**证据③：它没有假装能做。** 错误信息里写明了「暂不支持」+「业务线 scope 入口见 WO-SANDBOX-E2」，
指出了正确入口。对比本仓真正的静默错答形态（`G-SEG-ATTR-CROSS-SEGMENT`「储能达成率下钻混入整车厂」），
这是**相反**的行为。

### 2.2 所以：不是「历史遗留的过度限制」，是「诚实的 fail-closed」

引入于 E3 求解器诞生的那一单，当时 `judgeOne` 只实现了 baseIds 过滤 —— 那时接受 `businessTypes`
却不过滤就是静默错答。**这道 400 当初是对的，今天也仍然是对的**，因为下游到现在还是零读取。

**真正的欠账不是这道 400，是「E2 的业务线 scope 机制落地了，但没人回来接 `chain_impediments` 这条路」。**
E2 那套机制在 `apps/datacore/src/solvers/scope.ts`（178 行）已经成熟，四个部件齐全：

| 部件 | 位置 | 已服务的求解器 |
|---|---|---|
| 归一 `normalizeChainScope` | `scope.ts:75` | `affected_orders` / `order_fullchain` / `atp_check` |
| 基地维解析 `resolveScopeBaseIds` | `scope.ts:124` | 同上 |
| 效果层谓词 `orderInChainScope` | `scope.ts:144` | 同上 |
| 回带 `echoChainScope` | `scope.ts:167` | 同上 |

### 2.3 但「诚实」不等于「今天能用」——A6 的验收判据今天是 0 分

A6 要求「保谁的判据来自 `SEG_REGISTRY.marginPct/floorPct`」，PRD 指定的唯一出口是
`segOfBusinessType`（`packages/contracts/src/chain-sim.ts:273`）。**它生产调用方 = 0。**

```
$ grep -rn "businessTypeOfOrder" --include=*.ts --include=*.tsx apps packages | wc -l
11                                                        ⇒ 金丝雀命中，命令与扫描面正常

$ grep -rn "segOfBusinessType" --include=*.ts --include=*.tsx apps packages
packages/contracts/src/chain-sim.ts:18       （文件头注释）
packages/contracts/src/chain-sim.ts:273      （定义本体）
packages/contracts/src/chain-sim.ts:292      （字段注释）
packages/contracts/test/chain-sim.test.ts:44/329/490/491/492   ← 全部是 test
```

**⚠ 追一层（铁律 0.5·前人分支把这条列为"未闭合、置信度高但非 100%"，本文关掉它）**：

```
$ grep -n "chain-sim" packages/contracts/src/index.ts
72:export * from "./chain-sim.js";              ⇒ barrel 确实 re-export 了它

$ grep -rn "import \* as .* from \"@platform/contracts" --include=*.ts --include=*.tsx apps packages
（零命中）                                       ⇒ 全仓无 namespace import ⇒ C.segOfBusinessType 不可能存在

$ grep -rn "segOfBusinessType\|\[\"segOf\|SEG_REGISTRY\[" --include=*.ts --include=*.tsx apps
（零命中）                                       ⇒ 无字符串键动态取用
```

三条间接路径（barrel 别名 / namespace 取用 / 字符串键分发）**逐条排除**。
别名 re-export（`export { segOfBusinessType as X }`）也会含该字面串，已被上面的全仓 grep 覆盖。
⇒ **「生产零调用方」现在是 100% 结论**，定性 = **没接线**，且是假绿第 9 形态
（实现有、测试有、全绿、零生产调用方 —— 测试咬的是**函数**不是**链路**）。

---

## 3. 数据层证据：跨 seg 在本体/数据层到底成不成立

### 3.1 先说方法论，因为我在这里抓到了自己一次

我写了一个无依赖脚本逐字重放种子的订单派生，并按铁律 0.6 先跑金丝雀。**两个金丝雀都中**：

```
金丝雀① 业务线分布   复算 {passenger:12, commercial:3, storage:9}
                     基线 同上   ← 抄自 apps/datacore/test/sandbox-chain-scope.seam.test.ts:24（实测值）✅
金丝雀② 储能 SO 集合  复算 SO-3452,3458,3464,3470,3476,3495,3501,3518,3529（9 个 id 逐个对拍）
                     基线 同上   ← 抄自同文件 STORAGE_SOS 常量 ✅
```

**然后我发现这两个金丝雀证明不了我要证明的东西。**
它们只走 `businessTypeOfCustomer`（客户名 → 业务线，纯查表），
**完全没有经过 `hashString`** —— 而「订单落到哪个基地」这一步**唯一**的不确定性就在 hash：

```ts
// apps/datacore/src/synthetic/battery.ts:3528–3532
const startIdx = producible.length > 0 ? hashString(o.so) % producible.length : 0;
const nBases = producible.length >= 3 ? 2 : 1;
const orderBases = ... producible[(startIdx + k) % producible.length] ... .sort()
```

**形态（照铁律 0.6 句式）：「我用『业务线分布对上了』当作『落单派生对了』的证据，而前者并不度量后者。」**
这正是本文件警告的那个病。所以我把结论拆成两半：§3.2 **不含 hash**（可直接采信），
§3.3 **含 hash**（标为待真跑确认，不当结论用）。

### 3.2 不含 hash 的结论：**跨 seg 在本体层成立**（可直接采信）

只用两张确定性表 —— `MODEL_BASE_MAP`（`battery.ts:64–71`，型号→可产基地）
与 `CUSTOMER_BUSINESS_TYPE`（`battery.ts:158`，客户→业务线，经 `businessTypeOfCustomer` `:164`），**一次都不调 hash**：

**① 型号层：`2170-NCM` 单个型号就跨 seg**

| 型号 | 该型号订单的业务线 | 可产基地 |
|---|---|---|
| 4680-NCM | passenger | changzhou/chengdu/hefei/jinhua |
| 4680-LFP | storage | changzhou/zaozhuang |
| **2170-NCM** | **commercial + passenger** ⚠ | **xiamen/wuhan/zigong** |
| 方形-LFP | storage | jiangmen/meishan/handan/zaozhuang |
| 方形-NCM | passenger | changzhou/chengdu/jinhua |
| 圆柱-LFP | storage | xinyang/yangzhou |

**② 基地层上界**（该基地可产型号所涉业务线的并集 —— hash 只决定实际落单，落单集合**必是它的子集**）：

| 基地 | 业务线上界 | 结构上可跨 seg？ |
|---|---|---|
| **changzhou** | passenger + storage | ✅ |
| **wuhan** | commercial + passenger | ✅ |
| **xiamen** | commercial + passenger | ✅ |
| **zigong** | commercial + passenger | ✅ |
| chengdu / hefei / jinhua | passenger | ❌ |
| handan / jiangmen / meishan / xinyang / yangzhou / zaozhuang | storage | ❌ |

⇒ **结构上可承载跨 seg 争用的基地 = 4 个**（changzhou / wuhan / xiamen / zigong）。
**A6 不是伪需求，数据层是支持它的。**

**③ 关系层：`Order → Model → Base/Line` 可达**（`apps/datacore/src/synthetic/service.ts` 三种一等关系边）

```
order_for_model      : Order → Model
model_producible_at  : Model → Base
model_certified_on   : Model → Line    ← ⚠ 见 §3.6，只连 slurry 线
```

### 3.3 含 hash 的结论：**待真跑确认，本文不当结论用**

我的复算给出的落单分布（**未验证**）与前人分支**完全一致**：
`changzhou` 8 单(passenger+storage，含储能 SO-3476) / `wuhan` 3 单 / `xiamen` 4 单跨 seg，其余 10 个基地单 seg。

**但我拿到了两个互相矛盾的旁证，必须照实报**：

| 旁证 | 内容 | 与我的复算 |
|---|---|---|
| `apps/frontend-shell/src/views/sim/chainFamilyLines.ts:15–17`（**亲手跑的实测记录**） | `SO-3391 → hefei` · `SO-3437 → wuhan` · `SO-3452 → meishan` | 前两条 ✅ 落在我算出的集合里；**第三条 ✗**（我算 SO-3452 → handan/zaozhuang，不含 meishan） |
| `apps/frontend-shell/test/fixtures/chain-loss-live-evidence.json:23`（**捕获的真实回包**） | `"baseId": "hefei"`（SO-3391） | ✅ 落在我算出的集合里 |
| `apps/frontend-shell/src/mocks/simSolvers.ts:978–985`（MSW mock） | 6 行 `bases`，与我的复算 **6 中 5 不符** | ✗ —— 但该 mock 自述是"代表值"，且它的阻滞点基线（§3.4）与真跑也不符，**判为手写近似、不是真值源** |

**SO-3452 → meishan 这一条我追了一层**：在该派生下 `meishan`(idx 1) 只可能与 `handan`(idx 2) 配对，
而 `handan` 字典序更小 —— 所以**在任何 startIdx 下，meishan 都不可能是"字典序最小"的那个**。
⇒ 该实测记录里的 base 不是取自 `Order.bases` 的字典序最小值，而是经
`Order.bases → Process(kind=aging)` 这条 hop 派生的（同 fixture `:876` 写着 `derivationEdge`），
**其 tie-break 我没读**。⇒ 它既不能证实也不能证伪我的复算。

**处置**：§3.2 的结构上界（4 个基地）**足以支撑 A6 的立项判断**，不需要精确落单数。
精确的「哪几个基地真有跨 seg 争用、各几单」**必须在实施单里真跑一次种子确认**，
不许照抄本文或前人分支的数字。

### 3.4 前人「交集为空」这条：**证据链不完整，不能照它定形态**

前人的头号结论是「争用面(changzhou/wuhan/xiamen) 与 阻滞点面(jinhua/zigong) 交集为空 ⇒
争用必须做成新判据(produce)、不能做成标注(annotate)」。**这个方向我认同，但它给的证据撑不住**：

- 两个 BOTTLENECK 里，我在 canonical 上**只能坐实一个**：`LINE-WS-jinhua-slitting`（金华分切，C05 95.89% > 95%），
  出处 `docs/VERIFY-sandbox-A5-2026-08-08.md:18`（审核方真跑实拍）。
- 第二个（前人称"自贡分容"）**canonical 上找不到出处**；而 MSW mock 里的两条是
  `LINE-WS-changzhou-formation`(常州化成) 与 `LINE-WS-xiamen-coating`(厦门涂布)
  （`simSolvers.ts:1662–1663`）—— **和真跑记录对不上**（mock 总数 8 条 vs 真跑 15 条，也对不上）。
- **要命的是**：`zigong` 恰恰是 §3.2 里**结构上可跨 seg** 的四个基地之一；
  而 mock 里那两条（changzhou / xiamen）**也都在那四个里**。
  ⇒ 「交集为空」这个判断**高度依赖那个我没能验成的落单派生**。

**处置**：`produce` 形态的建议**照采**（理由是 A6 判据原文写的是「能**产出**阻滞点」，
这是措辞依据，不依赖数据），但**不许**把「annotate 今天恒空」当成已证事实写进工单。
实施单第一步就该真跑一次把这件事钉死。

### 3.5 ⚠ 新发现：本体里有**第二套业务线词表**，且它不能用

`Model.applicationDomain`（`battery.ts:720`）是一个 enum，语义与业务线**重叠但不相等**：

```ts
720  { propKey: "applicationDomain", dataType: "enum", isPrimaryKey: false }, // 储能 | 乘用车 | 商用车 | 消费电子
```

**它有数据**（`battery.ts:3288–3293`，6 个型号全部填了）：
`4680-NCM/2170-NCM/方形-NCM → 乘用车`，`4680-LFP/方形-LFP/圆柱-LFP → 储能`。

**但它生产零消费方**：

```
$ grep -rn "applicationDomain" --include=*.ts --include=*.tsx apps packages | wc -l
8                                        ⇒ 金丝雀：非空集，扫描面正常
逐条：battery.ts:720（属性声明）· battery.ts:1809（中文标签表）· battery.ts:3288–3293（6 条种子值）
      ⇒ 求解器 / 前端 / 契约 一处都没有读它的
```

三分法定性 = **没接线**（有声明、有数据、零读取），**不是**「接了线没数据」。

**⚠ 而且它不能拿来替代 `Order.businessType` —— 纯查表证明，无 hash**：

| 问题 | 证据 |
|---|---|
| **会错标 3 单** | 宇通客车（`CUSTOMER_BUSINESS_TYPE` 判 `commercial`）的 **SO-3437 / SO-3506 / SO-3540** 全用 `2170-NCM`，而该型号 `applicationDomain = 乘用车` ⇒ 按型号推得 `passenger`，**与真值相反** |
| **commercial 结构性不可达** | 6 个型号的 `applicationDomain` 取值集 = `{乘用车, 储能}` —— **一个「商用车」都没有** ⇒ 走 Model 层，商用车这条业务线**永远出不来** |
| **第三套词表** | `applicationDomain` 还有第四个值「消费电子」，在 `BusinessTypeSchema`（passenger/commercial/storage）与 `SEG_REGISTRY`（乘用车/储能/商用车）里**都没有对应项** |

**这条的价值**：它**否掉了修法里看起来最诱人的一条路**。
`model_certified_on : Model → Line` 是一等关系，若 `Model` 能定业务线，就能把争用粒度做到**线级**。
**做不了** —— 型号定不出业务线，业务线只有 `Order` 说了算。

### 3.6 第二个陷阱复验：`model_certified_on` 只连制浆线（前人对，行号要改）

```ts
// apps/datacore/src/synthetic/battery.ts:3907
certLinks.push({ modelId: m.modelId, lineId: `LINE-WS-${baseId}-${WORKSHOP_DEFS[0]!.suffix}`, baseId, status });
```

`WORKSHOP_DEFS`（`battery.ts:2927`）= `WORKSHOP_REGISTRY`（`packages/contracts/src/base-registry.ts:446`）的投影，
**`[0]` = 制浆 `slurry`**；而每基地有 **10 条线**（`battery.ts:3606` `nLinesPerBase = WORKSHOP_DEFS.length`）。

⇒ **`model_certified_on` 边只存在于每基地的 `slurry` 线**。
今天唯一坐实的卡点线 `LINE-WS-jinhua-slitting`（**分切**）上**一条边都没有**
⇒ **`LINK_HOP` 在卡点线上空手**。（行号：前人写 3892，canonical 是 **3907**。）

**合并 §3.5 + §3.6 的结论**：两条通往"线级业务线"的路**都断**——
关系路（`model_certified_on`）够不着卡点线，属性路（`Model.applicationDomain`）语义不对。
⇒ **争用粒度只能是基地级**（`Line.baseId` 值键相等 → 该基地订单集），
**输出文案必须照实说「这个基地」，不许写成「这条线被三个 seg 争」** —— 说得比做的准就是又一个静默错答。

---

## 4. 前端到底接没接（复验审核方的「前端接了」）

**裁定：审核方这半句要订正 —— 不是"接了"，是三条路三种状态，而且默认态下一条都带不出 `businessTypes`。**

| # | 路径 | `file:line` | 状态 | 判据 |
|---|---|---|---|---|
| ① | **沙盘控制台** | `views/sim/SandboxConsole.tsx:257` | **据实禁用**（不是漏做） | `const impArgs = useMemo(() => ({ scope: baseIds.length > 0 ? { baseIds } : {} }), [baseIds])` —— 结构上只可能带 `baseIds`。`:496` 只有 `dim.key === "baseIds"` 分支给 checkbox；`:345` 顶部直接写「业务线/产品**未接线**」 |
| ①' | 控制台的接线台账 | `views/sim/sandboxConsoleModel.ts:107–120` | **诚实台账**，写着病因 | `businessTypes` 标 `wiring: "no-args"`，note 原文引了后端行号。**这是一份主动写下来的缺口声明，不是遗漏** |
| ② | **`ChainImpedimentView`** | `views/sim/ChainImpedimentView.tsx:82–90` `argsFromView` | **原样透传**（真会打出 400） | `for (const dim of ["baseIds","businessTypes","modelIds"]) ... if (Array.isArray(v) && v.length>0) scope[dim]=v`；注释 `:79–80` 明写「引擎该报 400 就让它报 400」 |
| ③ | **MSW mock**（前人漏记） | `mocks/simSolvers.ts:1605–1610` | **复刻了同一道 400** | `if (rawScope.businessTypes !== undefined \|\| rawScope.modelIds !== undefined) return { __err: "chain_impediments 暂不支持…" }`，注释自述「mock 必须同口径，否则 mock 下"看着能用"、真后端一调就 400」 |

### 4.1 ⚠ 追一层：路径 ② 今天其实**带不出东西**

`argsFromView` 读的是 `view.options`。追这个 `options` 从哪来：

```
$ grep -n "options" apps/datacore/src/synthetic/view-manifest.ts
39:  options?: Record<string, unknown>;          ← 类型上声明了
107/108:（注释，说明 options 只有 ViewConfig 这条路送得到）
                                                 ⇒ 16 个 BUILTIN_VIEWS 条目里，**一个都没有真的设 options**
$ grep -c "key:" apps/datacore/src/synthetic/view-manifest.ts
16                                               ⇒ 金丝雀：扫描面 16 个条目，非空集
```

`chain-impediments` 的视图定义（`view-manifest.ts:110`）只有
`{ key, title, renderer, featureKey, featureName, seed, requires, bindings }` —— **无 `options`**。
前端 mock fixture（`mocks/fixtures.ts:530`）同样只有 `layout: {}`。

**但它不是死路** —— `options` 有真写入方：`POST/PUT /a/v1/view-configs`
（`apps/datacore/src/adminplatform.ts:420` / `:452`，均 `requireCatalogAdmin`）会把 `body.options` 存进 `repos.viewConfigs`，
再经 workspace 下发到 `view.options`。所以路径 ② 的三分法 =
**接了线 · 但默认种子无数据**（catalog_admin 手动配一次就会活）。

### 4.2 §4 小结

- **「前端漏接线」不成立** —— 控制台是**主动禁用并写下了病因**，属诚实降级；
- **「前端接了」也不准确** —— 唯一能带下去的路（②）在默认态下 `options` 恒空；
- **真实处境是**：前后端**两侧口径一致**（连 mock 都对齐了），
  三处 400 是**同一个设计决定的三次落实**，不是三处 bug。
- ⚠ **顺手账**：`sandboxConsoleModel.ts:101`/`:112`/`:124` 与 `ChainImpedimentView.tsx:79`
  四处注释把后端行号写成 `service.ts:3125`，**实际是 `:3118`**；`simSolvers.ts:1603` 写成 `:3124`。**五处待订正。**

---

## 5. 若要放开，最小改动路径

**先把两件事分开（它们不是一件事，工作量差一个量级）**：

- **甲 · 单 seg 过滤** =「只看储能的阻滞点」。放开一维 + 接一段过滤。
- **乙 · 跨 seg 争用** =「同一基地被两/三个 seg 争，保谁」。**这才是 A6 的真正要求。甲做完乙不会自动出现。**

### 5.1 ⚠ 头号提醒：甲**单独交付，界面上什么都看不见**

今天 15 条阻滞点的 locus 分布（`docs/VERIFY-sandbox-A5-2026-08-08.md:9–20` 真跑）：

| locus 类型 | 条数 | 承载 `businessType`？ |
|---|---|---|
| `MaterialBalance` | 7 | ❌ |
| `MaterialBatch` | 6 | ❌ |
| `Line` | 2 | ❌ |
| **`Order`** | **0**（C22 恒 UNKNOWN） | ✅ 但一条都没产出 |

⇒ **`businessTypes` 过滤今天的作用面 = 0/15。**
甲的价值是「把门开对 + 把不能筛的诚实说出来」，不是「用户能筛了」。
**派单时必须把这句写进工单**，否则 dev 做完会以为自己没做完。

**locus 属性表已逐个读完，确认无别名字段可代**（关掉前人未闭合的那条）：
`lineProps`（`battery.ts:945–961`，12 个属性）无任何业务线语义；
`processProps`（`:963–991`）的 `kind` 是 `serial|formation|aging`（工序类型，非业务线）。

### 5.2 甲的改动清单

| # | 文件 : 行 | 改法 | 风险 |
|---|---|---|---|
| 甲-1 | `solvers/chain-impediment.ts:492–531` `loci()` | 返回项加 `businessType?`，与既有 `baseId?`（`:508`）**逐字同形**；只在 `case "Order"`（`:522`）填，取值 `businessTypeOfOrder(o.props)`（既有单源，`scope.ts:4` 已这么用） | 低 |
| 甲-2 | `solvers/chain-impediment.ts:573–576` `judgeOne()` | 加 `wantBts`。**⚠ 绝不许照抄 `baseIds` 的放行形态** —— `:574` 写的是 `o.baseId === undefined \|\| ...`（不带就放行）；businessTypes 照抄会让 13/15 条无业务线的 locus 被 `undefined` 静默放行 ⇒ **用户以为筛了其实没筛**，正是那道 400 当初要防的东西**换个地方复现** | **高·头号坑** |
| 甲-3 | 同上 | **诚实降级**（照抄本文件已有的 SUSTAIN 先例 `:613–625`）：承载类真过滤；不承载类**进 `caveats[]`** +`dataMode` 降 `PARTIAL`，文案「locus 类型 `<T>` 在本体上不承载业务线属性，本次未按业务线裁剪」 | 中 |
| 甲-4 | `solvers/service.ts:3118–3123` | 条件从 `businessTypes !== undefined \|\| modelIds !== undefined` **收窄为只剩 `modelIds`**；同步改方法头注释 `:3113–3114`。**建议保留 `modelIds` 的 400**（型号今天无 contracts 级单源册，放开会立刻变成第二个真相源）—— ⚠ **这是产品决策，需仓主裁** | 低 |
| 甲-5 | `views/sim/sandboxConsoleModel.ts:107–113` | `businessTypes` 的 `wiring: "no-args"` → `"wired"`，note 改成实况（含「不承载业务线的 locus 会诚实报 caveat」） | 低 |
| 甲-6 | `views/sim/SandboxConsole.tsx:149 / :257 / :345 / :496` | 加 `businessTypes` state；`impArgs` 带上；`:345` 的「业务线/产品未接线」改；`:496` 判断改成「`wiring==="wired"` 才给 checkbox」 | 中 |
| 甲-7 | `mocks/simSolvers.ts:1605–1610` | **mock 必须同步放开**，否则 mock 模式下反而先报 400（该文件自述的纪律） | 中 |
| 甲-8 | 五处注释行号订正（§4.2） | `3125`→`3118`、`3124`→`3118` | 低 |

**会不会破坏现有断言**：未限定时 `wantBts === undefined` ⇒ 走原路径，既有 15 条应逐字节不变（R6）。
**但本单禁跑 vitest，这条未实测**，实施单必须真跑确认。

### 5.3 乙的改动路径（A6 真正要求）

**今天缺三样，一样都没有**：

| 缺什么 | 事实 | 证据 |
|---|---|---|
| ① 争用关系（谁在争） | `ChainImpediment.locus` 是**单对象** `{objectType, objectId, label}`，无「谁在争」字段 | `chain-impediment.ts:662` 构造处 |
| ② 争用的判定 | 6 条 binding **全是单主体**（某对象某属性越阈），无一条是「多 seg 需求打到同一 locus」 | `:107–194` 逐条读过 |
| ③ 「保谁」的判据出口 | `segOfBusinessType` 生产调用方 **0** | §2.3（已追一层闭合） |

| 步 | 改法 | 依据 |
|---|---|---|
| 乙-0 **形态定案** | 做成**新产出判据（produce）**，不是在既有阻滞点上打标注（annotate） | A6 判据原文写「跨 seg 争用场景**能产出**阻滞点」。⚠ 前人给的第二个理由（annotate 恒空）**我未能坐实**（§3.4），别把它当已证事实 |
| 乙-1 **关系来源** | 走 **`Line.baseId` 值键相等 → 该基地订单集**（`impediment-options.ts:244–267` `narrowByKeyJoin` 现成）。**不要走 `LINK_HOP`**（§3.6），**也不要走 `Model.applicationDomain`**（§3.5，会错标 3 单且丢掉整条商用车线）。<br>⇒ **粒度是基地级**，文案照实说 | §3.5 + §3.6 |
| 乙-2 **规则** | 照 `UNBOUND_IMPEDIMENT_JUDGEMENTS`（`chain-impediment.ts:196+`）的纪律：先核规则库 C01–C33 有没有能担「跨 seg 争用」的规则。**没有就先立规则，不许在引擎里编一条 `contention > 阈值`** —— 该文件 `:5` 铁律是「引擎里一个业务阈值都没有」。<br>**⚠ 这是全案剩下最大的未知**，见 §7 | `chain-impediment.ts:104–106` |
| 乙-3 **契约** | `ChainImpedimentSchema` 加 **optional** `contention?: { businessTypes, keep, basis:{ marginPct, floorPct, source:"SEG_REGISTRY" } }`。**必须 optional** ⇒ 既有 15 条逐字节不变（R6） | — |
| 乙-4 **引擎** | 新增 binding（locus = `Line` 或 `Base`）：同一基地上 ≥2 业务线的 OPEN 订单争同一产能面 ⇒ 产出阻滞点带 `contention`。**「保谁」一律经 `segOfBusinessType(bt)` 取 `marginPct`/`floorPct`，零字面量** | PRD §5.4 禁内联 |
| 乙-5 **注入口** | 照既有 DI 形态 `chain-impediment.ts:720` 的 `const bindings = input.bindings ?? IMPEDIMENT_RULE_BINDINGS`，加 `input.segRegistry ?? SEG_REGISTRY`（供变异反证「改册一个值→结论翻」）。<br>⚠ **防铁律 0.5 判据 #6**：`input.bindings` 这个口今天**生产与测试都没人传** ⇒ 若 `segRegistry` 也走成「只有测试传」，就会得到「测试验的那条路生产不走」。**必须补一条守护断言**：全域真跑（零注入）产出的 `contention.basis` 与 `SEG_REGISTRY` 逐值相等 | — |

### 5.4 需要仓主裁的两件事（**不是 dev 决策**）

1. **放不放开跨 seg** —— 这是产品决策。今天的 400 是**正确的诚实拒绝**，
   在乙落地之前放开甲，用户会得到「能筛但筛不动任何东西」的体验（§5.1）。
   **建议：甲乙同单交付，或甲单独交付时界面明说"本维度当前作用面为 0"。**
2. **`modelIds` 的 400 保不保留**（甲-4）—— 依据是「型号无 contracts 级单源册」，放开会立刻多一个真相源。

### 5.5 派单画像

**跨「数据半 + 引擎半」⇒ 必须一个 dev 整单做**（本仓铁律：拆两半用不同机制不对接 = metric-aware 反复炸的根）。

⚠ **而且仓里已经存在两套 `ChainScope`**，字段同名同义但三处不一样：

| | contracts 版 | datacore 版 |
|---|---|---|
| 位置 | `packages/contracts/src/chain-sim.ts:291` `ChainScopeSchema`（zod strictObject） | `apps/datacore/src/solvers/scope.ts:46` `interface ChainScope` |
| 谁在用 | **只有 `chain_impediments`**（`service.ts:3124` safeParse） | E2 家族（`affected_orders`/`order_fullchain`/`atp_check`） |
| 入参位置 | **嵌套** `args.scope.businessTypes` | **顶层** `args.businessTypes` |
| `[]` 语义 | `.min(1)` ⇒ **拒绝**（400） | 归一为**字段缺省**（= 全域） |

今天不炸，是因为两套没有交集（`chain_impediments` 那边直接 400 了）。
**A6 一放开，交集立刻出现** —— 同一个控制台会同时驱动两族求解器，
一族要 `{scope:{businessTypes}}`、一族要 `{businessTypes}`，`[]` 一族 400 一族当全域。
拆两半几乎必然拼出第三套。**建议：统一两套 ChainScope 单独立单**（硬统一会动 4 个求解器的入参形状 = 破坏性变更）。**CPU 画像 = 重**（跑 datacore vitest）⇒ ≤1，gate 跑着时为 0。

---

## 6. 我推翻 / 订正了审核方哪几条

| # | 审核方原话 | 裁定 | 证据 |
|---|---|---|---|
| 1 | 「引擎显式拒绝」 | ✅ **成立** | `service.ts:3118`，`VALIDATION_ERROR`/400，§1 |
| 2 | 「不是前端没接」 | ⚠ **半对，要订正** | 控制台是**主动禁用并写下病因**（诚实降级，不是"没接"）；唯一透传路 `argsFromView` 在默认态下 `options` 恒空（16 个内置视图无一设 `options`）。**准确说法：前后端口径一致地都拒绝，不是某一侧漏了** —— §4 |
| 3 | 隐含「这就是根因/唯一断点」 | ❌ **推翻** | 它是**四个断点里最外层**的：① 400 挡板 → ② `chain-impediment.ts` 零读取（没接线）→ ③ 5/6 locus 本体不承载业务线 + 唯一承载的恒 UNKNOWN → ④ `segOfBusinessType` 生产零调用方。**只删 400 = 把"诚实报错"换成"静默错答"，比现在更糟** |
| 4 | 隐含「这是 bug」 | ❌ **推翻** | 定性 = **诚实的未实现**。有主动写的动机注释、有指向正确入口的错误文案、有下游零读取的事实支撑 ⇒ 是**待做功能**不是缺陷，排期与修法完全不同（§2） |
| 5 | 「三业务跨 seg 推演做不了」 | ✅ **成立**，且**数据层支持做** | 本体层结构上有 4 个基地可跨 seg（§3.2，纯查表无 hash）⇒ 不是伪需求 |

**对前人分支的推翻**：其 §0「沙盘代码不在 canonical」**今天完全反了**（§0）；
其「交集为空 ⇒ annotate 恒空」**证据链不完整**，不可当已证事实（§3.4）。

---

## 7. 诚实边界

### 7.1 亲手读到调用点与条件的（可直接采信）

拒绝点原文与行号 · `validationError` 定义 · `businessTypes` 零读取（带金丝雀）·
`segOfBusinessType` 零生产调用方（**已追三条间接路径**）· 6 条 binding 的 locus 类型 ·
`lineProps`/`processProps` 完整属性表（无别名字段）· `Model.applicationDomain` 的声明/数据/零消费方 ·
`model_certified_on` 只连 slurry 线 · 前端三条路 + `view.options` 的写入方 · `ChainScopeSchema` 接受该字段。

### 7.2 静态复算 · 金丝雀已中（可直接采信）

§3.2 的全部结论 —— **完全不含 hash**，只用 `MODEL_BASE_MAP` × `CUSTOMER_BUSINESS_TYPE` 两张确定性表。
金丝雀：业务线分布 `12/9/3` + 9 个储能 SO id 逐个对拍，
两者均抄自 `apps/datacore/test/sandbox-chain-scope.seam.test.ts:24` 的实测基线。

### 7.3 ⚠ 未验成的（**实施单必须真跑确认，不许照抄**）

| # | 项 | 为什么没验成 |
|---|---|---|
| ⅰ | **精确落单分布**（哪几个基地真有跨 seg、各几单） | 我的金丝雀**没有覆盖 `hashString` 那一步**（§3.1 自查）。虽与前人分支结论一致，但两份可能同源同错 |
| ⅱ | **第二个 BOTTLENECK 是哪条线** | canonical 上只有 `LINE-WS-jinhua-slitting` 一个出处；MSW mock 给的两条与真跑对不上 |
| ⅲ | **「争用面 ∩ 阻滞点面 = ∅」** | 依赖 ⅰ 和 ⅱ，两者都没关 |
| ⅳ | **规则库 C01–C33 有没有能担「跨 seg 争用」的规则** | **全案剩下最大的未知**。前人也没做。若落空，乙-4 的新判据会**结构性恒 UNKNOWN** ⇒ A6 依旧不过，只是报错更诚实。**实施单第一步必须逐条核完 C01–C33 并贴结论** |
| ⅴ | **甲改完既有 15 条逐字节不变** | 设计上成立（`wantBts === undefined` 走原路径），但本单禁跑 vitest |
| ⅵ | **`modelIds` 保留 400 是否正确** | 产品决策，需仓主裁 |

### 7.4 待回写 `docs/SYSTEM-ONTOLOGY.md` 的清单（**本单不碰该文件，另有 dev 在写，清单交回**）

1. **新增断点** —— 「`chain_impediments` 业务线维度四层断点」（400 挡板 / 判定器零读取 /
   locus 不承载 / `segOfBusinessType` 零生产调用方）。建议按 `G-*` 体例编号。
2. **新增假绿实例** —— `segOfBusinessType`：实现有、测试有、全绿、生产零调用方
   ＝ 第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的又一例。
3. **新增本体缺陷** —— `Model.applicationDomain` 是**第二套业务线词表**：
   与 `BusinessTypeSchema` / `SEG_REGISTRY` 三方不齐（多出「消费电子」、缺「商用车」），
   有数据、零消费方，且**语义上不可替代 `Order.businessType`**（会错标 3/24 单）。
4. **登记既有裂缝** —— 两套 `ChainScope`（contracts 嵌套版 vs datacore 顶层版，
   `[]` 语义相反），A6 放开后交集出现，建议单独立单。
5. **不变量候选** —— 「业务线属性只有 `Order` 承载；任何按业务线裁剪的判据，
   遇到不承载的 locus 必须 `caveats[]` + `dataMode=PARTIAL`，**不许静默放行**」。
6. **文档漂移** —— `sandbox-chain-scope.seam.test.ts:44–50` 的注释说 `order_fullchain`
   死映射「本单未修」，而 `service.ts:3237` **已修**；五处 `service.ts:3125/3124` 行号引用应为 `:3118`。
