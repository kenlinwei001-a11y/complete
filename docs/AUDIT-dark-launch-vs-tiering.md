# AUDIT · 暗发 vs 产品分档 —— `defaultOn:false` 的 30 个 feature 逐个定性

**日期**：2026-08-10 · **单号**：WO-FIX-DARK-LAUNCH-GATE · **分支**：`claude/handoff-wo-fix-dark-launch-gate`
**结论一句话**：`defaultOn:false` **不是**「暗发」的同义词。全仓 30 个 `defaultOn:false` 的 feature 里，
**真暗发（功能没做完/不该被看见）= 0 个**。原门 `check-dark-launch-integrity.mjs` 报出的 15 个「违规」
**15 个全是误报**，且它给出的修法（「加进某个 `*_DARK_LAUNCH_FEATURES` 集合」）**实测会删掉 demo 的 5 个出厂视图**。

---

## 0 · 本审计的自证（工具先自证，再报结论 · 铁律 0.6）

本文所有数字**不是 grep 出来的**，是**加载真 `FeatureService`（`apps/datacore/dist/features.js`）跑出来的** ——
不重实现 `layeredSet` / `cascade`，重实现就是造第二个真值源。

| 自证项 | 命令 / 证据 | 结果 |
|---|---|---|
| 抽取器有效（金丝雀） | 真 `FEATURE_REGISTRY.filter(f => f.defaultOn === false)` | 命中 **30**，非 0 ⇒ 有效 |
| 静态正则 ≡ 真注册表 | 原门正则抽 30 · 运行期抽 30 | 一致 |
| `grep` 工具有效（金丝雀） | `grep -rn '"sim.sandbox"' apps/datacore/src` | 命中 `view-manifest.ts:85/87/88` ⇒ 有效 |

> ⚠️ 过程中我自己踩了一次金丝雀：先用 `grep -rn 'sim/sandbox'` 当探针，报 0 命中。
> 那**不是**「代码里没有」，是**我选错了探针串**（本仓根本没有 `/a/v1/sim/sandbox` 这条路由）。
> 换成已知必中的 `"sim.sandbox"` 后立刻命中。**「我没找到」≠「它不存在」**，此处留档。

---

## 1 · 派单里两个数字的更正

| 派单原文 | 实测 | 差在哪 |
|---|---|---|
| 「31 个 `defaultOn:false`」 | **30 个** | `apps/datacore/src/features.ts` 实测 `grep -c 'defaultOn: false'` = 30，运行期 registry 亦 = 30 |
| 「31 个里有 **15 个** `sim.*`/`opt.*` 是产品分档」 | 被模板打开的确是 **15 个**，但其中 `sim.*`/`opt.*` 只有 **12 个** | 另 3 个是 `view.global-sim.live` · `data-import.record-materialize` · `ceo.dataset.generate`，需**逐个**定性，不能被 `sim.*/opt.*` 这个措辞盖过去 |

**结论方向是对的，两个数字都要改**。这本身就是本单要治的病的一个小样本：
拿一个**近似的类别名**（"sim.*/opt.*"）当作**集合的完整描述**，而它并不覆盖那个集合。

---

## 2 · 定性的判据（先说判据，再上表）

「暗发」与「产品分档」在代码里长得一模一样（都是 `defaultOn:false` + 模板覆盖），
所以**不能靠形态区分，只能靠意图**。本审计对每一个 key 追以下三条**可证伪**的线索：

1. **后端端点/实现落了没有** —— 落了 ⇒ 功能已完成 ⇒ 不可能是「没做完」的暗发。
2. **生产种子（`apps/datacore/src/seed.ts` `DEMO_LIGHTUP`）有没有把它点亮** ——
   点亮 = 产品明确要用户看见 ⇒ 决定性反证「任何租户都不该看见」。
3. **注释里的原始意图**（写的人当时怎么说的），以及该注释**是否已过期**。

三条线索**互相独立**，任一条指向"已完成"即可否掉"暗发"。

---

## 3 · 四档，不是两档（这是我要顶回来的第一条）

派单给的是二分：**暗发 / 产品分档**。实测这个二分**装不下现状** —— 中间还有第三档，
而且它正是 `QOS_DARK_LAUNCH_FEATURES` / `PERF_DARK_LAUNCH_FEATURES` 两个集合的**真实语义**：

| 档 | 语义 | 期望行为 | 今天有几个 |
|---|---|---|---|
| `dark` **暗发** | 功能没做完/没验收，**任何**租户都不该看见（override 也不该开） | 到处都是 off | **0** |
| `explicit` **显式启用** | 功能**已完成**，但**禁止**被行业模板顺带开；只能逐租户**显式 override** 开 | 模板不开 · override 可开 | **15** |
| `tiered` **产品分档** | 功能已完成，按套餐/行业模板开给部分租户是**正确**的 | 经模板 on 是对的 | **15** |
| `ga` **全量** | 默认开 | `defaultOn:true` | 0（与 `defaultOn:false` 互斥） |

**证据（`explicit` 这一档不是我编出来的）**：`features.ts:155-158` 那段注释自己就写着两句话——
「**即便行业模板「全开」也保持默认关，必须经显式租户 override 才启用**」（= `explicit`），
以及「**产品分档特性（sim.\* / opt.\* 等）不在此列，照常随模板开**」（= `tiered`）。
两档的分界线**当时就写清楚了**，只是没写成机器能读的东西。

**决定性反证**：这 15 个「暗发集合成员」里，**14 个在生产 demo 上被 `seed.ts` 显式点亮了**
（`DEMO_LIGHTUP`，实测 14 键，与暗发集合的差集恰好只剩 `qos.llm-budget-enforce` 一个）。
一个「任何租户都不该看见」的功能，不会被生产种子主动点亮 14/15。
剩下那 1 个也不是没做完 —— `seed.ts:114-122` 逐字写明**刻意不点**的理由是产品体验
（硬线 429 拒人，demo 里撞墙），并注明「要在 demo 上演示配额，正确做法是运维显式 PUT 一次 override」。

⇒ **`defaultOn:false` 的 30 个，一个真暗发都没有。全部是已完成功能，只是投放策略不同。**

---

## 4 · 30 个 feature 逐条定性

### 4.1 `tiered` 产品分档（15 个）—— 经 battery 模板打开是**正确**的

L2 `templateFeatures()` 对 `battery-manufacturing` 返回 `ALL_FEATURE_KEYS − QOS_DARK − PERF_DARK`，
这 15 个不在两个排除集里 ⇒ 被打开。**这就是设计意图**。

| # | key | 判定依据 |
|---|---|---|
| 1 | `sim.sandbox` | 注释 `features.ts:79-80`「按租户开不同档（lite/Pro/旗舰）」= 分档措辞；**且**有 5 个出厂视图 `requires:["sim.sandbox"]`（见 §5） |
| 2 | `sim.propagation` | 同上批注释（G-11·SPEC §4 同一段） |
| 3 | `sim.propagation.delay` | 同上 |
| 4 | `sim.checkpoint` | 同上 |
| 5 | `sim.branch` | 同上 |
| 6 | `sim.certification` | 同上 |
| 7 | `sim.commander` | 同上 |
| 8 | `opt.solver-pool` | 注释 `features.ts:88-90`「按租户开不同档（lite 给模板池 / Pro 给 what-if / 旗舰再给离线进化）」= 逐字的分档定义 |
| 9 | `opt.whatif` | 同上；且 `seed.ts:105-109` 注明「依赖链底座 `opt.solver-pool`/`opt.whatif` **已随 battery 模板开着**（二者不在暗发排除集）」= 实测注记 |
| 10 | `opt.multiobj` | 同上批（WO-CROSS-OBJECT-MULTIOBJ，`requires: opt.solver-pool`） |
| 11 | `opt.embedding-retrieval` | 同上批 |
| 12 | `opt.evolve` | 同上批（"旗舰再给离线进化" 逐字点名） |
| 13 | `view.global-sim.live` | ⚠️ **注释已过期**，见 §4.3 |
| 14 | `data-import.record-materialize` | 后端真路由已落：`app.ts:3838` 带 feature 门 + `decision/record-materialize.ts` 实现齐全 ⇒ 非"没做完" |
| 15 | `ceo.dataset.generate` | 后端真路由已落：`app.ts:3926` `POST /a/v1/ceo/dataset/generate` + `synthetic/ceo-dataset.ts` 实现 ⇒ 非"没做完" |

### 4.2 `explicit` 显式启用（15 个）—— 模板**不得**顺带开，只能逐租户 override

| # | key | 集合 | demo 是否已显式点亮 | 判定依据 |
|---|---|---|---|---|
| 16 | `ceo.free-llm` | QOS | ✅ | 注释「只经显式 override 开」；`DEMO_LIGHTUP` 点亮 |
| 17 | `agent.coordinator` | QOS | ✅ | 同上 |
| 18 | `qos.dril-routing` | QOS | ✅ | 同上 |
| 19 | `agent.critic` | QOS | ✅ | 同上 |
| 20 | `agent.escalation` | QOS | ✅ | 同上 |
| 21 | `agent.skill-on-free-qa` | QOS | ✅ | `seed.ts` 逐字写明「demo 出厂 5 条 PUBLISHED Skill，有数据才点」 |
| 22 | `qos.compose-path` | QOS | ✅ | 同上 |
| 23 | `qos.reasoning-trace` | QOS | ✅ | 同上 |
| 24 | `qos.deterministic-multi-domain` | QOS | ✅ | 同上 |
| 25 | `qos.multi-intent-orchestration` | QOS | ✅ | `seed.ts:101-104` 逐字说明点亮理由 |
| 26 | `qos.opt-whatif-route` | QOS | ✅ | `seed.ts:105-109`「能力存在 ≠ 能力可达」，点亮补路由钥匙 |
| 27 | `qos.multi-intent-l2-decompose` | QOS | ✅ | `seed.ts` 逐字说明 |
| 28 | `qos.multi-intent-l3-coupled` | QOS | ✅ | 同上 |
| 29 | `dc.lazy-solver-context` | **PERF** | ✅ | `seed.ts:110-113`「先真跑 SEAM-EQ 门通过才点」= 已验收 |
| 30 | `qos.llm-budget-enforce` | QOS | ❌ **刻意不点** | `seed.ts:114-122`：不点的理由是**产品体验**（硬线 429 撞墙），非未完成；并注明运维可显式 PUT override |

**为什么这一档必须留着（原门想守的那个真问题是成立的）**：
`templateFeatures()` 的 battery 分支是 `ALL_FEATURE_KEYS − QOS_DARK − PERF_DARK`。
一个 `explicit` 的 key 若**从集合里掉出去**，battery「all on」会立刻把它顺带打开 ——
而这些恰恰是会改写 QOS 路由 / 影响性能 / 硬拒请求的高风险门。
**原门的担忧对，判据错**：它把「必须显式启用」错写成了「凡 `defaultOn:false` 必须进集合」。

### 4.3 单独记一笔：`view.global-sim.live` 的注释已过期

`features.ts:95` 写着：

> 真后端 `/b/v1/sim/compose` · `/a/v1/sim/scenarios` 端点**未落** → defaultOff 不渲染避 404；WO-LIVE-SCENARIO 落后开门。

**实测两个端点都已落**：

- `POST /b/v1/sim/compose` → `apps/agentcore/src/server.ts:2117`（实现 `router/live-endpoints.ts`）
- `POST/GET /a/v1/sim/scenarios` → `apps/datacore/src/app.ts:1909 / 1920`，另有 `/compare`(1927) 与 `/:id/branch`(1939)

⇒ 该 feature **已从「暗发」毕业**，注释停在毕业前，**没有任何机器读得到这次状态变化**。
这正是本单要建的机制所针对的病：**意图只活在注释里，注释过期无人知**。
（本审计不改 `apps/` 代码，故仅记录；清理注释见 §7 后续单。）

---

## 5 · 原门的修法实测会造成什么（决定性反证）

原门对 15 个「违规」给的修法是：**「把它加进 features.ts 里某个 `*_DARK_LAUNCH_FEATURES` 集合」**。
拿 `sim.sandbox` 照做一次（运行期把它塞进真集合，其余不动），跑真 `FeatureService.resolve("demo")`：

```
照门修之前：demo 有效功能 75 个 · 出厂视图可见 14/14
照门修之后：demo 有效功能 63 个 · 出厂视图可见  9/14

丢失的出厂视图（5）：chain-line-map · transit-flow · physical-topology · node-inspector · chain-impediments
丢失的功能键（12）：sim.branch · sim.certification · sim.checkpoint · sim.commander · sim.propagation ·
                    sim.propagation.delay · sim.sandbox · view.chain-impediments · view.chain-line-map ·
                    view.node-inspector · view.physical-topology · view.transit-flow
```

那 5 个视图在 `synthetic/view-manifest.ts` 里是 `seed: true` 的**出厂视图**，
且逐个写着 `requires: ["sim.sandbox"]`（`view-manifest.ts:87/88/89/90/111`），
注释原文：「四者与沙盘主屏**同生共死**（沙盘门关 → 级联判不生效 → 导航消失 + 404）」。

⇒ **照原门修一个 key，删掉 5 个出厂视图。** 门不是没用，是**指着反方向**。

**并且这个坑早有人踩过并留了警示**：`apps/frontend-shell/src/mocks/fixtures.ts:173-176` 与
`apps/datacore/src/seed.ts:123-133` 两处**各自独立**写下同一条更正——

> `sim.sandbox` 在后端 `features.ts` 写着 `defaultOn: false`，看上去像"暗发没开"，**但那是 L1**
> …… 实测坐实（非读码推断）：把 override 里的 sim.* 三键全删，`GET /a/v1/me/workspace` 仍返回全部 7 个 sim.* 键。

原门等于把这两处**实测得来的结论**又反着写了一遍。

---

## 6 · 顺带查出的一处**潜伏**接缝（不是本单要修的，但要记账）

`apps/datacore/src/synthetic/battery.ts:2666`：

```ts
export const BATTERY_TEMPLATE: IndustryTemplate = { ..., features: [...ALL_FEATURE_KEYS], ... }
```

这是**第二个** all-on 面，而且它**不减**任何暗发集合。按铁律 0.5 追一层它今天到底走不走得到：

- `templateFeatures()`（`features.ts:282`）对 battery **硬编码短路**，直接返回 `ALL − QOS_DARK − PERF_DARK`，**从不读库**；
- `BUILTIN_INDUSTRY_TEMPLATES`（`builtin-templates.ts:12`）只被 `app.ts:3736-3737` 的**列表端点**消费，**从不写库**；
- 库里那条 battery 记录不存在 ⇒ `features.ts:285-289` 的读库分支对 battery **进不去**。

⇒ 定性：**「接了线接错地方 / 今天走不到的死分支」**，**不是**现行漏洞。
但它是颗雷：**哪天有人把 `features.ts:282` 那个硬编码短路重构成"统一读库"**（一个很像"消除特例"的好改动），
`features: [...ALL_FEATURE_KEYS]` 会把 **15 个 `explicit` 门一次全开**。
故新门加了一条**判据自证**断言（见 §7 判据⑥）：短路机制若变了，门先红。

---

## 7 · 新判据（取代「集合成员」）

**旧判据**：凡 `defaultOn:false` ⇒ 必须出现在某个 `*_DARK_LAUNCH_FEATURES` 集合。
→ 形态（照铁律 0.6 句式）：**「我用『是否 `defaultOn:false`』当作『是否暗发』的证据，而前者并不度量后者。」**

**新判据**：意图**显式声明**在 `scripts/feature-rollout.json`，门只断言**声明与机制是否一致**：

| # | 断言 | 今天咬谁 |
|---|---|---|
| ① | 每个 `defaultOn:false` 的 key **必须**有声明；未声明 ⇒ **红**（不猜） | 每一个未来新增的 off-by-default feature |
| ② | `stage:"dark"` ⇒ **任何模板都不得打开它**（必须在某个 `*_DARK_LAUNCH_FEATURES` 集合里） | 今天 0 个；将来声明 dark 的那一刻起 |
| ③ | `stage:"explicit"` ⇒ **必须**在某个 `*_DARK_LAUNCH_FEATURES` 集合里（掉出去 = battery all-on 顺带开） | **15 个**，即刻生效 |
| ④ | `stage:"tiered"` ⇒ **不得**在任何 `*_DARK_LAUNCH_FEATURES` 集合里（进去 = 删出厂视图，见 §5） | **15 个**，即刻生效 |
| ⑤ | `stage:"ga"` 与 `defaultOn:false` **互斥**；声明了却已不再 `defaultOn:false`（或 key 已删）⇒ **红** | 防"毕业了没人改声明" |
| ⑥ | **判据自证**：`templateFeatures()` 的 battery 短路必须仍是「`ALL_FEATURE_KEYS` 减去两个集合」。机制变了 ⇒ **红** | §6 那颗雷 |
| ⑦ | **抽取器自证**：静态抽出的 key 集合必须 ≡ 运行期真 `FEATURE_REGISTRY`（dist 在时） | 正则漂移 |

③④ 是**互为镜像**的一对，这正是新门方向正确的原因：它不再说「off 的都得进集合」，
而是说「**你声明的意图，和代码的机制，必须一致**」。

### 7.1 为什么「未声明」是红，而不是给个默认档（派单要求说明理由）

派单要求「默认值的选择要保守」。**我的答案是：不设默认值，未声明即红。** 理由：

- 默认成 `dark` ⇒ 15 个合法分档特性当场全红，**原门的误报一模一样再来一遍**，
  并且把 dev 推向那个**实测会删 5 个出厂视图**的修法。这不叫保守，叫定向误伤。
- 默认成 `tiered` / `ga` ⇒ 新加的、真没做完的功能**静默放行**，
  正是这道门存在的全部理由（`defaultOn:false` 写了却对 demo 是开的 = 静默越权）被绕过。
- **两个方向的默认值都会错，且错法相反。** 唯一不猜的选项是**拒绝猜**：
  多写一行 JSON 的成本，换「机器先说话」——这正是铁律 0.6 对机制的判据。

「保守」在这里指**对产品行为保守**（不擅自改变任何 feature 的可见性），
而不是"对门的红绿保守"。二者在此处正好相反，原门取错了那一头。

---

## 8 · 本体引用与影响

- **对象类型**：`FeatureDef`（`packages/contracts`）· `FeatureConfigRecord` · `IndustryTemplate`
- **链路**：L1 平台默认 → L2 行业模板（`templateFeatures`）→ L3 租户 override → L4 角色收窄 →
  `cascade(requires)` → `GET /a/v1/me/workspace` 导航下发
- **不变量**：**R3 Entitlement 先于 authz**（功能关闭 = 不存在 → 404 `FEATURE_NOT_FOUND`）
- **门禁**：`dark-launch:check`（本单重建判据）
- **本单不新增/不改变**链路、事件、对象类型 ⇒ **无需回写** `docs/SYSTEM-ONTOLOGY.md` 的链路/事件章节；
  仅门禁判据变更，已在本文与门脚本头注记录。

---

## 9 · 遗留（不在本单范围，建议后续单）

1. **`rollout` 应搬到 `FeatureDef` 上**（`packages/contracts` + `apps/datacore/src/features.ts`）——
   本单 🚦范围边界明令「不碰 apps/ 与 packages/ 的业务代码」，故声明先落在 `scripts/feature-rollout.json`。
   独立文件的代价是**可能与定义漂移**，已用判据①⑤（缺声明红 / 陈旧声明红）把漂移窗口关死，
   但**同处一行**仍然更好。最小改法见 §9.1。
2. **`features.ts:95` 的过期注释**（`view.global-sim.live` 端点其实已落）应清理。
3. **`battery.ts:2666` 的 `features: [...ALL_FEATURE_KEYS]`** 建议改为减去两个集合，
   把 §6 那颗雷拆掉（今天走不到，但改法只有一行）。

### 9.1 搬到 `FeatureDef` 的最小改法（供后续单）

```ts
// packages/contracts/src/features.ts —— FeatureDefSchema 增一个可选字段
rollout: z.enum(["dark", "explicit", "tiered", "ga"]).optional(),
```
```ts
// apps/datacore/src/features.ts —— 逐条标注，例：
{ key: "sim.sandbox", name: "推演沙盘", level: "VIEW", defaultOn: false, rollout: "tiered" },
{ key: "ceo.free-llm", name: "CEO 深问真 LLM 自由推理", level: "BLOCK", defaultOn: false, rollout: "explicit" },
```
门脚本改动量：把读 `scripts/feature-rollout.json` 换成读运行期 `FEATURE_REGISTRY` 的 `rollout` 字段，
§7 的 ①–⑦ 七条断言**一条都不用改**（判据与载体解耦）。
