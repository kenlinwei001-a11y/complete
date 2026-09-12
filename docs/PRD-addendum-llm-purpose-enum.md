# PRD 增补 · LLM 用途登记册（闭 `G-7` 的「枚举写死不可扩展」这一半）

> **单号**：`WO-LLM-PURPOSE-ENUM` · **断点**：`G-7` · **上游要求**：`docs/PRD-unified-build-engine.md:29 / :81 / :101`（P5）
> **本文档的性质**：**裁决用**。§5 三个裁决点各自带选项、代价、推荐。落实现前需仓主裁一次。
> **本文档不改任何代码**——用途枚举怎么扩展是产品决策，代码先写就是替产品拍板。

---

## 1 · 一句话

今天「加一个 LLM 用途」不是加一行，是**碰 13 处**；其中**只有 3 处编译器会替你抓**，
另外 **8 处纯靠人记得** —— 而实测**这 8 处 100% 已经漂了**。
本增补主张：**把用途做成一份登记册（单一来源），其余全部派生**，把手写面从 13 处压到 1 处。

---

## 2 · 本体引用与影响

> 铁律 0 要求的章节。以下条目全部经本单亲手打开核对，非转述。

### 2.1 触及的对象类型（本体 §2）

| 对象类型 | 本体位置 | 本增补对它做什么 |
|---|---|---|
| **LlmPurposeBinding** | §2.G `docs/SYSTEM-ONTOLOGY.md:174` | **主对象**。记录形态不变（`{purpose, providerId, modelId, noReasoning?}`），`purpose` 的**取值来源**从「手写枚举」改为「登记册派生」 |
| **LlmProvider** | §2.G 同行 | 不变。绑定校验仍读 `provider.models[].capabilities` |
| **Tenant** | §2.G `:170` | 裁决点 2 直接关于它：用途是平台级还是租户级 |
| **FeatureConfig / DynamicFeature** | §2.G `:171` | 若登记册要可开关（暗发 RL2），复用既有 entitlement，**不另造开关机制** |
| **新增（仅当裁决点 1 选 C/B）**：`LlmPurposeDef` | 待回写 §2.G | 登记册的一行 = 一个用途的定义（key / 名字 / 阶段标注 / 能力要求 / 状态） |

⚠ **`LlmPurposeDef` 是否成为一等持久化对象，取决于裁决点 2**：
平台级 ⇒ 它是**契约里的常量表**，不进库、不进 §2 对象目录（像 `SHARED_FEATURE_NAMES`）；
租户级 ⇒ 它是**租户数据**，必须进 §2、进 R9 四处、带 `tenant_id`。**两者工程量差一个数量级。**

### 2.2 触及的链路（本体 §3）

本体 §3 `docs/SYSTEM-ONTOLOGY.md:785` 现文：

```
LlmPurposeBinding --路由--> { classifier:QOS分类 · agent:路径B · extraction:规则抽取/构建 ·
                             modeling:建模建议 · template_gen:行业模板 · compose:llm_compose }
                             ⚠ 用途枚举写死、不可扩展；model 下拉依赖先选 provider
```

**这行本身就是漂的两处证据之一**：它列 6 个，实际 7 个（缺 `comprehend`）；
且 §2.G `:174` 指的 `contracts/llm.ts:205` 是**过期行号**（真实定义在 `:216`，`:205` 今天是个模型清单条目）。

链路的真实分叉点（本单实测，三段）：

```
① 落库/校验（DataCore）  PUT /a/v1/llm-bindings → llmproviders.ts:497 → putBindings(:257)
                          → PURPOSE_CAPABILITY_REQUIREMENTS[b.purpose](:270) 查能力
                          → llmPurposeBindings.put(:296) → emit llm_binding.updated(:298)

② 路由（DataCore 内部）   TenantRoutedLlmClient.parseStructured(:370)
                          → resolveBinding(tenantId, purpose)(:344)
                          → 键查 `llmb_{tenantId}_{purpose}`(:348)   ← **全泛型·零 per-purpose 分支**

③ 路由（AgentCore）      roleModel(:459) → tenantBoundModel(:488)
                          → directory.bindingFor(tenantId, role)(:492)
                          ⚠ 这里的 `role` 是 **LlmRole**（`providers.ts:395`，只有 3 个值），
                            **不是** LlmPurpose。两者靠**名字碰巧相同**接上，类型系统看不见这条缝。
```

**②是好消息**：DataCore 的路由与落库**已经完全 purpose-agnostic**——加用途在这两段是 **0 改动**。
**③是真缺口**：影子枚举 `LlmRole` 与契约枚举并存，B 侧只能路由 3 个用途。

### 2.3 触及的事件（本体 §4）

| 事件 | 生产点 | 消费点 | 本增补的影响 |
|---|---|---|---|
| `llm_binding.updated` | `apps/datacore/src/llmproviders.ts:298`（载荷 `{purposes: []}`） | B 侧缓存失效钩子 `POST /b/v1/internal/invalidate`；TTL 60s 兜底 | **载荷形状不变**（仍是 purpose 字符串数组），无需改订阅方 |
| **新增（仅裁决点 2 选租户级）**：`llm_purpose.updated` | 登记册变更时 | 同上失效通道 | 若选平台级则**不需要**此事件（常量表随部署走，无运行期变更） |

**R10 判据**：本增补若不新增事件，则不新增订阅义务；若新增，必须同时接订阅方，不许只发不收。

### 2.4 触及的不变量（本体 §5，R1–R19）

| 不变量 | 关系 | 判据 |
|---|---|---|
| **R1 contracts-only-shared** | **现状已违反**（本增补的主要修复对象） | `apps/agentcore/src/llm/providers.ts:395` 的 `LlmRole` 是契约枚举的**本地重定义**（3 值子集），且 `apps/frontend-shell/src/mocks/handlers.ts:4791` 的字符串数组是 `PURPOSE_CAPABILITY_REQUIREMENTS` 的**手抄副本**。R1 要求跨包只依赖契约、不重定义契约已有类型 |
| **R2 tenant_id everywhere** | **裁决点 2 的硬约束** | 若用途可租户自定义：登记册读写必带 `tenantId`，且**一个租户的自定义用途 key 不得出现在另一租户的绑定矩阵里**。跨租户读一律 404 |
| **R3 entitlement 先于 authz** | 若登记册暗发（RL2） | 关闭 = 不存在 → 404 `FEATURE_NOT_FOUND`，不是 403 |
| **R5 no-secrets-echo** | 不受影响 | 登记册只含 key/名字/能力要求，**不含任何凭据**。凭据仍走 `credentialRef` |
| **R6 确定性** | **约束派生实现** | 登记册→枚举的派生必须是纯常量求值（`as const` + 类型推导），**不许**运行期读环境变量/时钟决定枚举内容——否则同版本两次构建枚举不一致 |
| **R7 错误信封** | 绑定未知用途时 | 必须 `{error:{code:"VALIDATION_ERROR",…}}`，不许静默丢弃该行绑定 |
| **R9 仓储双实现** | **裁决点 2 决定是否触发** | 平台级 ⇒ 无新表，**不触发 R9**（实测 `apps/datacore/migrations/006_llm_providers_refs.sql:14-20` 是 `doc JSONB` 且**无 CHECK 约束**，加用途零迁移）；租户级 ⇒ 新表，migrations+pg+memory+repo 接口四处同改 |
| **R10 数据流闭环** | 见 §2.3 | 新事件必须有订阅方 |
| **R14 应用层无业务常数** | 同源纪律 | 用途的**中文名与阶段标注**属配置不属代码，应随登记册走，不该内联在页面里（今天 `PURPOSE_LABEL` 内联在 `LlmProvidersPage.tsx:34`） |
| **R15 CLI 对等** | **裁决点 2 选租户级时触发** | 「新增/退役一个用途」若成为对外能力，必须有 CLI 等价命令。今天 `packages/contracts/src/operation-intent.ts:70` 只有粗粒度 `llm` 命令（覆盖 provider/绑定/预算），**不覆盖「管理用途本身」** |
| **R-一致 一个事实一个出处** | **本增补的立论** | 「系统有哪些 LLM 用途」这个事实今天有 **13 个出处**，实测 8 个已互相矛盾 |
| **RL3 单一来源 / RL10 不与在建分叉** | 实现纪律 | 必须复用既有登记册范式（见 §4），**不许**平行造第二套注册机制 |

### 2.5 触及的断点（本体 §8）

| 断点 | 关系 |
|---|---|
| **`G-7`**（主） | 两半之一。「矩阵 model 下拉 stale 绑定显示空白」**已修**（本单复核在位，见 §3.3）；「用途枚举写死不可扩展」= 本增补 |
| `G-5`（应用层锁死） | 同族。`PURPOSE_LABEL` 内联中文名是同一种病的小号版本 |
| `G-8`（构建闭包跨栈） | 弱相关。构建发动机新阶段想要独立用途行时，会再次撞上本断点（`apps/datacore/src/solvers/llm-gen.ts:65` 已经因此**借用** `comprehend` 而非自建用途——见 §3.4） |

---

## 3 · 现算：今天的形状（不引转述，全部亲手打开）

### 3.1 枚举今天有哪些值、定义在哪

**唯一定义**：`packages/contracts/src/llm.ts:216-224`，**7 个值**（不是本体说的 6 个）：

| # | key | 注释里的调用点 | 能力要求（`llm.ts:250-257`） |
|---|---|---|---|
| 1 | `classifier` | QOS 意图分类 | structuredOutput |
| 2 | `agent` | 路径 B 工具循环 | tools + structuredOutput |
| 3 | `extraction` | A2 规则文档抽取 | structuredOutput |
| 4 | `modeling` | A3 建模建议 | structuredOutput |
| 5 | `template_gen` | A7 行业模板生成 | structuredOutput |
| 6 | `compose` | workflow `llm_compose` 步骤 | （无硬要求） |
| 7 | **`comprehend`** | 数据构建发动机·故事脚本意图解析 | structuredOutput |

**契约里还有第二个、重叠但不相等的枚举**——`ModelRoleSchema`（`packages/contracts/src/llm.ts:29-37`，同一个文件、早 187 行）：

```
ModelRole  : classifier · agent · extraction · modeling · template    · compose · embedding
LlmPurpose : classifier · agent · extraction · modeling · template_gen · compose · comprehend
                                               ↑ 名字不同     ↑ 各有一个对方没有的值
```

`ModelRoleSchema` 经 `ModelBindingSchema`(`:40`) 服务于 AgentCore 的**旧通道** `repos.llmBindings`
（`apps/agentcore/src/llm/providers.ts:502`、`apps/agentcore/src/server.ts:2197`）。
于是「一个用途叫什么」在契约内部就有**两个不一致的答案**。

### 3.2 谁消费它 —— 三形态分类（铁律 0.5）

> 判据不是 grep 命中数，是**追到调用点的条件**。以下每条都追到了触发条件。

| 消费方 | 位置 | 形态 | 触发条件（实测） |
|---|---|---|---|
| 绑定校验 | `apps/datacore/src/llmproviders.ts:270` | **接了线有数据·会触发** | 每次 `PUT /a/v1/llm-bindings`。`tools` 缺失 → 400 拒绝；`structuredOutput` 缺失 → warning 放行 |
| 请求体校验 | `apps/datacore/src/llmproviders.ts:74` | **接了线** | `BindingsPutSchema` 直接用 `LlmPurposeSchema` ⇒ **未知 key 自动 400**，无需另写校验 |
| 用途路由 | `apps/datacore/src/llmproviders.ts:344-355` | **接了线·全泛型** | 任何带 `{tenantId, purpose}` 的 `parseStructured`。**键查，无 per-purpose 分支** |
| 前端矩阵渲染 | `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx:623` | **接了线·数据驱动** | `LLM_PURPOSES.map` ⇒ 契约加一个值，矩阵**自动多一行** |
| 前端提交 | 同上 `:579` | 同上 | `LLM_PURPOSES.map` 收集草稿 |
| 前端标签 | 同上 `:34-42` | **接了线·穷尽 Record** | `Record<LlmPurpose,string>` ⇒ 漏一个 **tsc 报错** |
| B 侧路由 | `apps/agentcore/src/llm/providers.ts:492` | **接了线接错地方** | 形参类型是 `LlmRole`（3 值），非 `LlmPurpose`（7 值）⇒ B **只能路由 3 个用途**，其余 4 个在 B 侧无法生效 |
| 前端 mock 校验 | `apps/frontend-shell/src/mocks/handlers.ts:4791` | **接了线·数据已漂** | 硬写数组，缺 `comprehend` ⇒ mock 态不报 JSON-mode 降级警告，真后端报 |
| 持久化 | `apps/datacore/src/repo/pg.ts:805` / `memory.ts:494` | **接了线·与取值无关** | 通用 `Store`，存 `doc JSONB`。**加用途零改动、零迁移** |

### 3.3 `G-7` 已修那一半的复核（本单亲手核对）

本体 G-7 引用的 `LlmProvidersPage.tsx:474` 是**过期行号**——今天 `:474` 是 LLM 预算降级说明的浮层。
修复的真实位置是 `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx:663-666`：

```
{/* G-7：已绑 model 不在当前 provider 目录时仍可见可选，避免静默显示空白（像"绑定丢了"） */}
{v.modelId && !(provider?.models ?? []).some((m) => m.modelId === v.modelId) && (
  <option value={v.modelId}>{v.modelId}（已绑 · 不在当前 provider 目录）</option>
)}
```

**结论：这一半确实在位**，本增补不动它。（行号已按本仓纪律改为锚点串回写本体，见 §7。）

### 3.4 「枚举写死」的真实代价 —— 有人已经在绕它

`apps/datacore/src/solvers/llm-gen.ts:58-66`：求解器代码生成这个**全新的 LLM 阶段**，
没有自己的用途行，而是 `purpose: "comprehend"` **借用**了数据构建发动机的用途。

后果具体且可见：租户想给「求解器生成」单独绑一个更强的模型 —— **做不到**，
它和「故事意图解析」共用一行绑定。这正是上游 PRD `docs/PRD-unified-build-engine.md:29`
说的「每个用 LLM 的构建阶段 = 一个可绑、可读名的用途行」尚未成立。

### 3.5 ⬛ 加一个新用途，今天要改几处 —— **13 处**

> **本表每一处都由本单亲手打开核对过**（grep 命中不算）。
> 「编译器抓」= 漏改则 `tsc` 报错；「静默」= 漏改**一切照绿**，只有人眼能发现。

| # | 位置（file:line） | 是什么 | 漏改会怎样 | 谁来抓 |
|---|---|---|---|---|
| 1 | `packages/contracts/src/llm.ts:216-224` | `LlmPurposeSchema` 枚举字面量 | 值根本不存在 | — （定义本身） |
| 2 | `packages/contracts/src/llm.ts:246-257` | `PURPOSE_CAPABILITY_REQUIREMENTS: Record<LlmPurpose,…>` | — | ✅ **编译器**（穷尽 Record） |
| 3 | `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx:34-42` | `PURPOSE_LABEL: Record<LlmPurpose,string>` | — | ✅ **编译器**（穷尽 Record） |
| 4 | 调用点，如 `apps/datacore/src/synthetic/service.ts:175`／`ruledocs.ts:216`／`modeling.ts:220`／`databuilder/service.ts:127`／`solvers/llm-gen.ts:65` | 真正发起调用时传 `purpose:"<new>"` | 用途是**死行**：矩阵上能绑，绑了没有任何调用会用它 | ❌ 无（新增用途必配一个调用点，**没有机制保证**） |
| 5 | `apps/agentcore/src/llm/providers.ts:395` | `LlmRole = "classifier"\|"agent"\|"compose"` 影子枚举 | B 侧永远路由不到新用途 | ❌ **静默**（两个枚举无类型关联） |
| 6 | `apps/frontend-shell/src/mocks/handlers.ts:4791` | 手抄的能力要求数组 | mock 与真后端行为分叉（警告不一致） | ❌ 静默 |
| 7 | `apps/datacore/src/domain.ts:1184` | `purpose: string;` 后的枚举值注释 | 注释骗下一个人 | ❌ 静默 |
| 8 | `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx:568` | JSDoc「6 用途 ×…」 | 同上 | ❌ 静默 |
| 9 | `apps/frontend-shell/test/f36.llm-providers.test.tsx:36,45` | 用例名「6 用途行」+ 硬写 6 值数组 | **测试照绿**（`getByTestId` 逐个查 = 子集断言，不锁总数） | ❌ 静默（**测试自己就是假绿**） |
| 10 | `docs/SYSTEM-ONTOLOGY.md:174` | §2.G「6 用途 …」+ 过期行号 `llm.ts:205` | 本体过期即失效（铁律 0） | ❌ 静默 |
| 11 | `docs/SYSTEM-ONTOLOGY.md:785` | §3 链路图列 6 个 | 同上 | ❌ 静默 |
| 12 | `docs/PRD-addendum-llm-providers-and-references.md:56-63,69` | 用途表 6 行 +「6 用途 ×」 | PRD 与实现分叉 | ❌ 静默 |
| 13 | `DEPLOY.md:135` | 部署指南列 6 个 | 交付文档骗客户 | ❌ 静默 |

**另有 1 处并列问题**（不是「加用途要改」，是「本来就该收」）：
`packages/contracts/src/llm.ts:29-37` `ModelRoleSchema` —— 与 `LlmPurposeSchema` 重叠但不相等的第二份枚举（§3.1）。

#### 这张表最要紧的一行数字

`comprehend` 是最近一次真实加的用途。本单逐处核对它落在哪些位置：

| 类别 | 处数 | 已跟上 | 已漂 | 漂移率 |
|---|---|---|---|---|
| **编译器强制**（#2 #3） | 2 | 2 | 0 | **0 %** |
| **静默且应当列全部用途**（#6–#13） | 8 | 0 | 8 | **100 %** |

> 逐条实测（那一行/那个数组里有没有 `comprehend`）：
> `handlers.ts:4791` 数组 ❌ · `domain.ts:1184` 注释 ❌ · `LlmProvidersPage.tsx:568` JSDoc ❌ ·
> `f36 test:36,45` ❌ · `SYSTEM-ONTOLOGY.md:174` ❌ · `:785` ❌ ·
> `PRD-addendum-llm-providers…:56-63,:69` ❌ · `DEPLOY.md:135` ❌
> ⇒ **8 处该列全的静默位置，8 处全漂。**

> ⚠ **#5 `LlmRole` 刻意不计入上面这个漂移率** —— 它从来就没有 `extraction`/`modeling`/`template_gen`，
> 是个**有意的 3 值子集**（B 侧今天只路由这三个），不是 `comprehend` 造成的漂移。
> 它是**另一个性质的问题**（影子枚举 / 违反 R1），修法也不同（收编类型关联，不是补一个值）。
> **两件事必须分开说** —— 把它们合成一个数字，正是本仓铁律 0.6 点名的
> 「拿一个笼统数字盖住两个不同事实」。

**这就是本增补的全部立论**：
不是「加用途很难」，是**加用途很容易，而保持一致很难，且今天没有任何机制在保持它**。
编译器管到的地方一次没漏，编译器管不到的地方一次没跟上。
⇒ **正确的修法不是"再抄仔细一点"，是把这 8 处静默副本变成派生产物（外加收编 1 处影子枚举）。**

---

## 4 · 可复用的既有范式（RL10：不许平行造第二套）

本仓已经治过一模一样的病，方案现成，**建议照抄形态而非另起炉灶**：

**`packages/contracts/src/feature-names.ts`（WO-VIEWNAME-SINGLE-SOURCE）** —— 功能名曾散在
3 份手维护注册表里，实测 61 个键被 ≥2 份声明、8 个键三份各写各的。收敛做法三件：

1. **契约里一份 `SHARED_FEATURE_NAMES` 常量表**当唯一真相源；
2. **构造期断言** `assertSharedFeatureNames()`（`apps/datacore/src/features.ts:21` 调用）——
   注册表构造时就对账，不一致直接构造失败；
3. **接缝测试** `apps/frontend-shell/test/feature-name-single-source.seam.test.ts` 守跨包不回潮。

同族的还有 `SOLVER_CATALOG` / `deriveOperationCatalog` / `BASE_REGISTRY` / `SEG_REGISTRY`
（R14、R16「目录从注册表自动派生，非手维护」）。

⇒ **用途登记册应当长成同一个样子**：契约一份表 → 枚举/能力要求/标签/阶段标注全部 `derive`，
外加一道守静默副本的门。**这不是新机制，是把已经生效的机制再用一次。**

---

## 5 · 裁决点（每个都有推荐；请否决，不必从零挑）

### 裁决点 1 · 契约形态：闭合枚举 / 开放字符串 / **登记册派生闭合枚举**

| 选项 | 做法 | 代价 | 得到什么 |
|---|---|---|---|
| **A** 维持现状 | 继续手抄 13 处 | 每加一次用途，静默漂移 8 处（实测 `comprehend` 那次 8/8 全漂）；`G-7` 永不闭合 | 零工作量 |
| **B** 开放字符串 + 运行期注册表 | `purpose: z.string()`，合法性运行期查表 | **失去 zod 闭合校验**（未知 key 不再自动 400，要手写）；失去 TS 穷尽性 ⇒ #2 #3 两处**从"编译器抓"退化为"静默"**——**把仅有的两处保护也拆了**；前端 `Record<LlmPurpose,…>` 全部要改成 `Record<string,…>` + 运行期兜底 | 租户可自定义（但见裁决点 2：今天没有消费方） |
| **C ⭐推荐** | **登记册派生闭合枚举**：契约里 `LLM_PURPOSE_REGISTRY` 一张 `as const` 表（key/名字/阶段标注/能力要求/状态），`LlmPurposeSchema`·`LLM_PURPOSES`·`PURPOSE_CAPABILITY_REQUIREMENTS`·标签全部从它推导 | 一次性重构：改 #2 #3 为派生、#6 改为引用契约、#5 收编影子枚举、#7–#13 改为引用或加门 | **加一个用途 = 登记册加一行**；zod 闭合校验与 TS 穷尽性**全部保留**；#2 #3 #6 #8 从"要改"变成"不存在" |

**推荐 C 的理由（三条，都可当场复验）**：

1. **B 拆掉的正是唯一在起作用的东西。** 实测编译器管到的 2 处漂移率 0%、管不到的 8 处漂移率 100%。
   开放字符串会把 2 处保护也变成 0 —— **朝着已被数据证伪的方向走**。
2. **C 不需要"能力":** 迁移零成本已实测 —— 表是 `doc JSONB` 无 CHECK（`migrations/006_llm_providers_refs.sql:14-20`），
   路由是键查无分支（`llmproviders.ts:348`），前端是 `.map` 数据驱动（`LlmProvidersPage.tsx:623`）。
   **底座早就是可扩展的，卡住的只有"用途清单写在哪"这一件事。**
3. **C 是本仓已验证的范式**（§4），不新增机制、不与在建分叉（RL10）。

> **上游 PRD 的字面写法是 `registerPurpose`**（`PRD-unified-build-engine.md:81`，实测全仓 0 命中）。
> 建议**按语义落地而非按字面**：`registerPurpose` 暗示运行期注册（= 选项 B）；
> 而同句括号里写的是「**保留枚举校验**，加 `registerPurpose` **或配置驱动**」——
> **C 正是那个"配置驱动"分支，且是唯一同时满足"保留枚举校验"的分支。**

### 裁决点 2 · 权限层级：平台级 / 租户级

| 选项 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **A ⭐推荐** | **平台级登记册；租户只"绑"不"增"** | 租户不能自助新增用途 | 低。登记册是契约常量，不进库、不触发 R9、不需要新事件、不需要新 CLI 命令（R15 由现有粗粒度 `llm` 命令覆盖，`operation-intent.ts:70`） |
| **B** | 租户级自定义用途 | 触发 R9 四处同改（新表+pg+memory+repo 接口）、R2 跨租户隔离、R15 新 CLI 命令、新 `llm_purpose.updated` 事件 + 订阅方（R10）、前端管理页 | **高，且大概率白做** —— 见下 |

**推荐 A 的理由（一条，但很硬）**：

> **一个用途 = 代码里的一个调用点。**

`purpose: "template_gen"` 是**源码里的字面实参**（`synthetic/service.ts:175`），不是配置。
租户新建一个用途 `my_custom`，**代码里没有任何地方会传 `purpose:"my_custom"`** ⇒
它在矩阵上能绑、绑完永远不触发 —— 就是本仓反复治的「**接了线没数据**」的一个新实例，
而且是**主动制造**一个。

租户级自定义**只有在"调用点也能配置化地挂用途"之后才有意义**，那是另一个大得多的工程
（要让构建阶段/求解器/工作流步骤能声明自己走哪个用途）。**建议不要在本轮做，也不要为它留半成品接口。**

**若仓主判定必须租户级**，最小安全形态：
租户只能对**平台已登记的用途**做「启用/停用 + 改显示名」，**不能新造 key**——
这样既满足"租户可定制"，又不产生死行，且 key 空间仍闭合（R2 无泄露面，因为 key 全局唯一且公开）。

### 裁决点 3 · 用途退役时，指向它的既有绑定怎么办

| 选项 | 做法 | 代价 |
|---|---|---|
| **A** 拒绝退役 | 有绑定就不让下线 | 平台被单个租户的一条历史绑定卡住，不可运营 |
| **B ⭐推荐** | **软退役 `RETIRED`：绑定行保留、屏上标「已退役」、路由不再消费、不可新绑** | 登记册加 `status` 字段 + 前端一个徽章 |
| **C** 级联删除绑定 | 静默删数据、不可逆 | 违反本仓「不静默丢弃」哲学；与 `G-7` 已修那半自相矛盾 |

**推荐 B 的理由（两条）**：

1. **本仓已有这个三态先例**：`Scenario` / `Intent` / `Workflow` / `Skill` 都是
   `DRAFT / PUBLISHED / RETIRED`（本体 §8 `G-3` 条目）。复用 = RL10 不分叉。
2. **`G-7` 已修的那一半走的就是这个哲学**：已绑 model 不在目录时**仍可见可选**，
   宁可标注也不静默变空（`LlmProvidersPage.tsx:663-666`，原文「避免静默显示空白（像"绑定丢了"）」）。
   **退役用途理应沿用同一条**：绑定还在、标清楚、不再路由。选 C 等于在同一个断点的另一半上，
   做出与已修那半**相反**的选择。

---

## 6 · 落实现建议（裁决后的工单骨架，本单不做）

> 按推荐组合 **C + A + B**。给出来是为了让仓主看见"裁决完要花多少"，不是本单交付物。

| 阶段 | 内容 | 守它的门 |
|---|---|---|
| S1 | 契约建 `LLM_PURPOSE_REGISTRY`（key/name/stage/capabilities/status），`LlmPurposeSchema` 等 4 个导出改为派生 | 四包 typecheck（穷尽性自动保住） |
| S2 | 收编影子枚举：`apps/agentcore/src/llm/providers.ts:395` `LlmRole` 改为契约 `LlmPurpose` 的**显式子集类型**（若 B 侧确实只路由 3 个），并在类型层建立关联，使新增用途时 B 侧**编译期可见** | **接缝测试**（SEAM-GATE）：A 侧绑一个 B 侧要用的用途 → B 侧 `roleModel` 真解析到它 |
| S3 | mock 与真后端同源：`handlers.ts:4791` 改为读契约的 `PURPOSE_CAPABILITY_REQUIREMENTS` | 接缝测试：同一绑定在 mock 与真后端产生**同样的 warnings** |
| S4 | 加一道**静默副本门**：扫 `domain.ts` 注释 / JSDoc / 测试硬写数组 / 三份文档，凡列举用途值的地方与登记册对账不上即红。退出码三分（0 干净 / 1 违规 / 2 工具坏），金丝雀与主逻辑共用同一份实现 | 门自身 + 登账 `scripts/gate-ledger.json` |
| S5 | `f36.llm-providers.test.tsx:45` 的子集断言改为**对总数与集合的相等断言**（今天它锁不住任何东西） | 变异反证：登记册加一行而测试不改 → 必须红 |
| S6 | 回写本体 §2.G `:174`、§3 `:785`、`DEPLOY.md:135`、`PRD-addendum-llm-providers-and-references.md:56-63`；`ModelRoleSchema` 与 `LlmPurposeSchema` 的关系裁一次（合并 / 明确分工 / 退役其一） | `ontology:check` |

**⚠ S4 是本增补里唯一"新造"的东西，也是最要紧的一件**：
没有 S4，S1–S3 修完之后，下一个人**照样**能在文档和注释里写出第 10 处副本。
按铁律 0.6 的判据 —— **机制的标准是"下次同样的错发生时，是机器先说话"**。
今天这个错已经发生过（`comprehend` 一次漂 8 处），**第二次就必须建机制，不能只写"下次注意"。**

---

## 7 · 本增补对本体的回写

本单只改 `docs/SYSTEM-ONTOLOGY.md` 的 `G-7` 那一行（§8，`:2170`），改动内容见交单报告。
**以下三处本单已核实为过期，但按 🚦 范围边界不在本单动**，留给 S6：

| 位置 | 现状 | 应为 |
|---|---|---|
| `docs/SYSTEM-ONTOLOGY.md:174` | 「6 用途 …/compose」+ 行号 `contracts/llm.ts:205` | 7 用途（补 `comprehend`）+ 行号 `:216`（或改锚点串） |
| `docs/SYSTEM-ONTOLOGY.md:785` | 链路图列 6 个 | 补 `comprehend`；「⚠ 用途枚举写死」改为指向本增补 |
| `DEPLOY.md:135` / `docs/PRD-addendum-llm-providers-and-references.md:56-63,:69` | 列 6 个 | 补第 7 个 |

> 本单**刻意不顺手改它们**：`docs/SYSTEM-ONTOLOGY.md:174/785` 与两份文档不在本单 🚦 范围边界内，
> 顺手改会与其它 dev 撞。**如实标注比擅自扩范围更符合本仓纪律。**

---

## 8 · 复验判据（审核方按此验收本文档）

| # | 判据 | 在哪看 |
|---|---|---|
| T1 | 含《本体引用与影响》，且对象类型/链路/事件/不变量/断点与本体对得上 | §2 |
| T2 | 「加一个用途要改几处」每处有 file:line 且经亲手核对 | §3.5（13 行表） |
| T3 | 每个裁决点有 ≥2 选项 + 各自代价 + 明确推荐 | §5（三个裁决点，推荐 C / A / B） |
| T4 | 命名不含外部产品名，用平台自有术语 | 全文 |
| T5 | 否定结论带金丝雀证据 | 交单报告（`registerPurpose` / `build_decompose` = 0，同命令金丝雀 `PURPOSE_CAPABILITY_REQUIREMENTS` = 5） |
