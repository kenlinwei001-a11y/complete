# LOOP9 · 本体运营负责人评审：从「建/改/维护」的操作层面看本体

> **评审人视角**：本体运营负责人 —— 不是用本体的人，是每天要把本体**建起来、改下去、维护住**的那个人。
> **方法**：亲手在真前端 + 真后端上做一遍运营会做的事，做不动就记在哪一步做不动。**不读代码去补屏上没有的东西**。
> **前一份分析 `docs/ANALYSIS-ontology-capability-gap.md` 的问题**：它对照的是概念清单（对象/属性/链路/动作/函数/接口…），
> 从头到尾没问过「这些东西**怎么建出来、怎么改、怎么维护**」。本文补的是这一整个维度。

---

## 0 · 评审环境与「我评的是哪个版本」（先把坐标钉死）

| 项 | 值 |
|---|---|
| 代码基线 | `origin/claude/inspiring-gates-aqczjg`（canonical），worktree 分支 `loop9-ops` |
| **`origin/claude/handoff-wo-ontology-edge-edit`** | **未并入**。实测 `git merge-base --is-ancestor origin/claude/handoff-wo-ontology-edge-edit HEAD` ⇒ **false**。<br>⇒ **本文所有关于「本体关系」页的裁决，评的是 canonical 版本，不含那条分支的 `PUT/DELETE/PATCH status` + `description` + `change-impact-preview`。** |
| 后端 | 真 datacore，内存模式 `SEED_DEMO=1`，`PORT=4501`，`node apps/datacore/dist/server.js` |
| 前端 | 真 Vite dev，`VITE_DATACORE_URL=http://127.0.0.1:4501`，端口 5501 |
| **`VITE_MOCK`** | **未设**（`unset VITE_MOCK`）。全程真后端，网络面板可见 `/a/v1/*` 真实响应码 |
| 浏览器 | playwright-core + `/opt/pw-browsers/chromium`，1600×1100 |
| 账号 | `demo / admin / demo1234`（roles: admin+planner+catalog_admin，即**权限最大的那个人**） |

**规模底数（真后端实测，非台账）**：对象类型 **98**、属性 **881**、结构边 **114**、生效因果边 **42**、注册切片 **99**。

> ⚠️ **先纠正派单给我的一条线索**：派单说「本仓刚补完 **873 个属性的 unit**」。
> 实测 `GET /a/v1/ontology/object-types`：881 条属性里带 `unit` 的只有 **24 条（2.7%）**，分布在 **12/98** 个类型上。
> 带 `displayName` 的 798 条、带 `description` 的 104 条。
> （`unit:` 在 datacore 源码里出现 254 次，但绝大多数是**指标/杠杆/切片层**的单位，不是对象类型属性的单位——
> 这是典型的「我用 X 当作 Y 的证据，而 X 并不度量 Y」。）
> 这条纠正**不改变结论**，反而让结论更硬：见 §1 动作 3。

---

## 1 · 十项运营动作逐项实录

> 记法：**想做什么 → 屏上给了什么 → 卡在哪 → 只能怎么绕**。截图编号见 `shots/`。

### 动作 1 · 新建一个对象类型「模具 Mold」，带 3 个属性、其中一个带单位

**想做什么**：我是运营，业务方说「模具要进本体」。我要建一个 `Mold` 类型，属性 `moldId` / `cavityCount` / `maxTonnage(吨)`。

**屏上给了什么**：

1. `建模与图谱 → 对象/类型浏览` (`/admin/object-types`)：98 个类型、按 14 个域分组、每行「属性数 / 主键 / 物化对象数」。
   **全页 ~120 个按钮，全部是「看实例 →」，外加 1 个「?」提示。零个新建/编辑/删除。**
   〔金丝雀：同一套抽取方法**确实**抓到了左导航按钮与 120 个「看实例 →」⇒ 抽取器是好的，「新建」是真没有。〕
   页面名叫「浏览**器**」——命名很诚实，问题是**全系统没有与之配对的「编辑器」**。
2. `建模与图谱 → 本体建模` (`/admin/modeling`)：**全页只有 1 个可点按钮：「AI 建议草案」**。

**卡在哪**：

- 点「AI 建议草案」弹出的模态**只让我从已有的 87 个原始数据集里选一个**（`rds_*`，来自连接器同步/文件上传），
  然后二选一：`确定性建模（全字段）` 或 `生成建议`。
  ⇒ **没有「从空白建一个类型」这条路。** 模具没有已接入的数据集 ⇒ **这个动作在屏上根本起不了步。**
- 我只能**绕道**：随便挑一个不相干的数据集（`mes_base_master`）起草案，再把它改名成 `Mold`。
  实测 `POST /a/v1/modeling/derive` → `201`，得到 `draft_z14f745rxevnw03g`。
- 草案编辑器（**在页面最顶部**，不是弹层）提供：
  `对象类型[Mold] 改名 应用` / `加属性: [propKey][sourceField][类型▾] 应用` / `删属性·改类型·设引用: [选择属性▾][删除属性][ref→typeKey][设引用]` / `归域▾` / `发布` / `对象化`。
- **「新 typeKey」是改名不是新建**：`PATCH` 回来的载荷里 `typeKey` 从 `MesBaseMaster` 变成 `Mold`，
  而 **`displayName` 仍是 `mes_base_master`，且屏上没有任何输入框能改它**。
- **属性类型下拉只有 6 个值**：`string / number / boolean / date / enum / ref`。
  **没有单位、没有属性显示名、没有描述、没有必填/可空、没有枚举值清单、没有默认值、没有校验规则。**

**结果**：我确实把 `Mold` 发布进了本体（`POST .../publish` → `200`，`status: PUBLISHED`，类型数 98 → **99**），但它是这样的：

```
key: "Mold"            displayName: "mes_base_master"    ← 改不掉
properties: 22 条（源数据集的 19 条 + 我加的 3 条）        ← 那 19 条删不干净也不想要
每条属性只有: propKey / dataType / isPrimaryKey / refToTypeKey / searchable
```

**⇒ 动作 1 判定：做不到。** 交付出来的是一个**名字对、显示名错、带 19 条垃圾属性、且一个单位都没有**的类型。

---

### 动作 2 · 给它建一条链路 `Mold —used_by→ Line`

**屏上给了什么**：`建模与图谱 → 本体关系` → 结构边分区顶部：`来源类型▾ → 去向类型▾ + [关系 key] + [基数▾] + 建结构边`。

**结果**：**成功，而且干净利落。** 选 `Mold` → `Line`，key 填 `mold_used_by`，基数 `1:N`，点「建结构边」
⇒ `POST /a/v1/ontology/link-types` → **`201`**，结构边 114 → **115**，新边当场出现在表里。

**但**：`POST` 载荷只有 `key / fromTypeKey / toTypeKey / cardinality`。
**没有 displayName、没有描述、没有「这条边是干什么用的」**——这正是参考截图里那一列「影响说明」。

**⇒ 动作 2 判定：能做（七项里唯一一个顺畅的）。** 但建出来的边**没有任何人类可读的语义**。

**追加实测（与动作 3 同一形态，一并写清）**：`POST /a/v1/ontology/link-types` **也是 upsert**——

```
POST key=ops_probe_link  Base→Line   1:N  → 201  id=ltype_m6by…  version=1
POST key=ops_probe_link  Base→Workshop N:N → 201  id=ltype_m6by…  version=2   ← 同一个 id，去向与基数都被改掉
```

⇒ **结构边的「改」在 API 层是有的，而且规规矩矩地递增了 version（1→2）**，
但屏上 115 行每行只有 `查引用 / 停用 / 下线`，**没有「编辑」**。又一处「写端在、入口无」。

> 顺带记一个**不一致**：`link-types` 改动**会**递增 version（1→2），
> 而 `slices` 的 PUT 改完 **version 仍是 1**（§2 第 2 行）。
> **同一套本体里两类元素的版本纪律不一样**，运营无法用同一套心智模型去审计变更。

---

### 动作 3 · 改一个已有属性的量纲/口径

**想做什么**：`Base.gwh` 现在的单位是 `GWh`，业务改口径要换成 `MWh`。运营改一个要几步？

**屏上给了什么**：**零步——因为压根没有入口。**

- `对象/类型浏览`：只读（见动作 1）。
- `本体建模`：只能编辑**草案**，而草案只能从**原始数据集**派生。已发布的 `Base` 不在草案里。
- 属性编辑器本身**就没有 unit 这个字段**（下拉 6 个值全是 dataType）。

**追一层到 API**：

```
apps/datacore/src/app.ts
  3749:  app.post("/a/v1/ontology/object-types"      ← 建
  3891:  app.post("/a/v1/ontology/types/:key/deprecate"
  3896:  app.post("/a/v1/ontology/types/:key/retire"
  ── 没有 PUT / PATCH / DELETE ──
```

> ### ⚠️ 我在这里差点下了一个**错误且会歪掉排期**的结论 —— 必须写出来
>
> 看到「没有 PUT/PATCH/DELETE」，我本来写的是「**对象类型一旦发布，在任何一层都改不了**」。
> **这个结论是错的。** 按铁律 0.5「grep 的结果不是结论，必须再追一层」，我去**实打**了那个 POST：
>
> ```
> POST /a/v1/ontology/object-types  {key:"Base", displayName:"生产基地(改口径)", properties:[… gwh.unit:"吨" …]}
>   → 201 ；类型总数仍为 98（没有变成 99）；回读 Base.displayName = "生产基地(改口径)"、gwh.unit = "吨"
> ```
>
> **这个 POST 是 upsert，不是 create。** 改口径、改显示名、改单位 —— **写端一直都在。**
> 若照我原来的结论派单，会把「**接一条线（把已有字段接进属性编辑器）**」错报成
> 「**造一道门（新增整套本体编辑写端）**」——正是 CLAUDE.md 记过的那次「把工作量错报、直接歪掉排期」。

**所以动作 3 的真实结论是：能力在 API 层已经具备，屏上零入口。** 具体卡点有四个：

1. **UI 一个入口都没有**：属性编辑器只有 `propKey / sourceField / dataType` 三样，
   **`unit` / `displayName` / `description` 这三个字段前端从来不发**。运营只能用 curl。
2. **单位受一本硬编码字典约束**：`apps/datacore/src/ontology-governance.ts:55`
   `UNIT_DICTIONARY = ["万套","GWh","%","吨","天","元","万元","件","秒"]` —— **只有 9 个**。
   实测填 `MWh` 直接 `400 未知单位 'MWh'`。**要加一个单位＝改代码发版**，且屏上看不到这本字典。
3. **upsert 是整体替换，不是打补丁**：body 里漏写一条属性，那条属性**静默消失**。
   19 条属性要改 1 个单位，得把 19 条完整回传。**没有并发校验/版本号**，两人同时改后写覆盖先写。
4. **`retire` 之后无法复活**（单向），所以「删了重建」这条绕法对有物化数据的类型仍然是拆房子——
   `Base` 有 13 个物化对象、被 13 条结构边与 6 个求解器引用。

**金丝雀（报否定结论必须给）**：同一份路由清单里**确实**抓到了 `POST /a/v1/ontology/domains`、
`POST /a/v1/ontology/interfaces/:key/publish` 等 40 条 `/a/v1/ontology*` 路由 ⇒ 抽取方法是好的。

**⇒ 动作 3 判定：屏上做不到（0 步）；绕道要手写整包 JSON 打 curl，且单位被 9 项字典锁死。**

> **这条最能说明问题，但要说准**：881 条属性里那 24 个 `unit`、798 个 `displayName`、104 个 `description`，
> **全部来自种子代码，没有一个是运营在屏上填出来的** —— 不是因为改不了，
> **是因为屏上没给入口**。本体的语义层今天 100% 是开发资产、0% 是运营资产，
> 而**把它变成运营资产所需要的写端，已经写好了在那儿闲着**。

---

### 动作 4 · 新建一条因果边（参考截图那张表的形态）并**停用**它，看波及面

**屏上给了什么**：`本体关系` 页因果边分区：
`[规则 key] + 来源类型▾ + [来源状态变量] + 经由结构边▾ + 去向类型▾ + [去向状态变量] + [系数] + [延迟] + [启停▾] + 建因果边`。

**建，成功**：`POST /a/v1/sim/propagation-rules` → `201`，生效因果边 42 → **43**，
`status` 直接是 **`PUBLISHED`**（无草案、无评审、无预览，**建完立刻进推演**）。

**停用它——做不到。这是本次评审最硬的一条实测**：

用 DOM 逐表统计 `/admin/ontology-relations` 的 20 张表：

| 表 | 表头 | 行数 | 体内 input | 体内 button |
|---|---|---|---|---|
| #0–#10（结构边，11 张） | 关系 / 来源→去向 / 基数 / 状态 / **操作** | 合计 115 | 0 | 3 每行（查引用 · 停用 · 下线） |
| **#11–#17（因果边，7 张）** | 规则 / 影响（来源量→去向量） / 系数 / 延迟 / **启停** | **合计 42** | **0** | **0** |
| #18（守卫） | 守卫 / 条件 / 实测 / 容差 / 当前 / 参与体检 | 9 | 16 | 0 |
| #19（会签请求） | 请求 / 目标版本 / 触及域 / 状态 / 会签 | 0 | 0 | 0 |

**因果边那 42 行，`启停` 这一列是纯文本「启用」，整片表区 0 个 input、0 个 button。**
⇒ 建完之后**永远不能停用、不能改系数、不能改延迟、不能删除**。
（`启停▾` 只存在于**新建表单**里——你只能在**出生那一刻**决定它启用还是停用，此后不可变。）

**服务端印证**：`app.ts` 只有 `2571: app.get(".../sim/propagation-rules")` 和 `2602: app.post(...)`。
**无 PUT / PATCH / DELETE。**

**然后我踩到了真正危险的那一脚 —— 「修一次错，错翻一倍」**：

系数填错了（填了 `0.9`，本该 `0.3`）。运营唯一能想到的补救是**用同一个 key 再建一次**。实测：

```
第 1 次 POST key=ops_probe_mold_wear coef=0.9 → 201 (simpr_dwjfrfayskbh9y1v)
第 2 次 POST key=ops_probe_mold_wear coef=0.3 → 201 (simpr_tfn43z3d0rt5zvh4)   ← 不是覆盖，是新增
```

屏上当场并排出现**两行同名规则**，一行 0.9 一行 0.3，**都标「启用」**，生效因果边 42 → **44**。

沿链路追一层确认后果（铁律 0.5，不拿 grep 当结论）：

- `GET /a/v1/sim/propagation-rules?published=true` ⇒ 44 条，`ops_probe_mold_wear` 出现 **2 次**，两条都 `status: PUBLISHED`、`combine: "sum"`。
- `apps/datacore/src/sim/propagation.ts:559`：`const sortedRules = [...rules].sort((a,b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));`
  —— **按 key 排完还要拿 id 兜底比较，这个 tiebreaker 的存在本身就说明同 key 多行是被容忍的**，全文件**无任何按 key 去重**。
- `propagation.ts:614`：`applyContribution(next, targetId, rule.targetStateVar, amount, rule.combine, touched)` 在 `for (const rule of ...)` 里**逐条累加**，`combine:"sum"`。

**⇒ 实际生效系数是 0.9 + 0.3 = 1.2，是我想要的 0.3 的 4 倍。运营为了改对，把错误放大了 4 倍，而且两条都删不掉。**

**⇒ 动作 4 判定：建得了、停不了、改不了、删不了；试图改正会静默地让结果更错。**
这不是 UX 抱怨，是**数据完整性缺口**，直接坐实铁律 1.5「跑得起来 ≠ 算得对」。

---

### 动作 5 · 合并两个重复实体

**屏上给了什么**：`实体合并` (`/admin/merge`) —— 全页 **136 字**、**1 个按钮「扫描候选」**、1 个类型输入框（默认 `Base`）、
「无待合并候选」、「暂无合并记录」。

**扫描 `Base`** → `POST /a/v1/objects/merge-scan` → `{"candidates":[]}`。

**金丝雀（先证明扫描器是好的，再报否定结论）**：换 11 个类型逐个扫，
`Base / Line / Customer / Equipment / Material / Supplier / Order / Model / CustomerLocation / Mold` 全空，
**`Process` 出候选** ⇒ **扫描器工作正常，只是 10 个类型的数据本来就干净。**

**扫 `Process` 之后卡在哪**：

- 候选只有 **1 组**，理由是「**归一名称完全一致 · 匹配得分 1/1（相似度） · 130 个对象**」。
- 「并排字段对照」把这 **130 个对象铺成 130 个并排列**，页面文本从 136 字暴涨到 **147,363 字**。
- 操作区是 **130 个按钮**：`以 obj_process_LINE-WS-changzhou-assembly-aging 为准`、`以 …-chengdu-… 为准`…… 每个对象一个。

**这一组根本不是重复实体**：它们是常州/成都/邯郸/合肥/江门…**各基地各产线的 aging 工序**，
只因「归一名称」都叫 aging 就被判为同一实体。而屏上**没有任何办法**：
排除其中某几个 · 说「这不是重复」 · 拆分候选组 · 调匹配阈值 · 改匹配用的字段。
**唯一能点的动作，是把 130 个真实不同的工序合并成 1 个。**

**⇒ 动作 5 判定：机制在，界面反着用。** 「72h 内可还原」这句承诺救不了——
运营在这个界面上**唯一能做的事就是制造一场事故**。

---

### 动作 6 · 定义边界：哪些数据进本体、哪些不进

**屏上给了什么**：`边界册治理` (`/admin/boundary`) —— **1,764 字，0 个按钮，0 个输入框，0 个下拉，0 张表。**
纯只读报告：版本指纹（semver 1.0.0 / digest 52f540b9）+ 三个册（BASE_REGISTRY 13 条 / SEG_REGISTRY 3 条 / PLAN_GOAL_TARGETS 6 条）
+ 每册的「派生消费端」文件清单 + 「下游受影响面」。

**卡在哪**：页面自己把答案写在副标题上——

> 「册为 `@platform/contracts` 单一来源，**改值＝改代码**经 `boundary-singlesource` 门。」

**⇒ 动作 6 判定：运营做不了，这是开发动作。** 要改边界得改 TypeScript、提 PR、过门、等发版。
而且这个「边界」讲的是**三张业务常数表**（基地集/细分集/目标阈值），
**不是**「哪些数据进本体、哪些不进」那个意义上的边界——后者**全系统没有任何表达处**。

> 顺带说清：这一页**作为影响面报告是好的**（见动作 8），它只是不叫「治理」——治理要能改，它不能改。

---

### 动作 7 · 发布一次本体变更：草稿 → 评审 → 发布？改错了能回滚吗？

**屏上给了什么（比预期多，先说好的）**：

- `本体建模` 有草案态：`DRAFT → REVIEWED → PUBLISHED`，草案**服务端持久化**（`GET /a/v1/modeling/drafts` 实测 2 条），
  刷新页面后草案下拉里还在、可续编（⚠️ 我第一次判它「刷新即丢」是**错的**——编辑器在页面**最顶部**，我只 dump 了 main 的尾部。已订正）。
- `本体关系` 页有 **`发起发布会签`** 按钮，页面加载真调 `GET /a/v1/ontology/publish-requests`（200），
  底部第 20 张表就是会签表（表头：请求 / 目标版本 / 触及域 / 状态 / 会签）。
  ⚠️ 我一度按 grep 判「`publish-requests` 前端零命中」，那是**因为 head_limit 把结果截断了**——**订正：它是接线的。**

**卡在哪**：

1. **状态机自己会跳**：我只是把草案的 typeKey 从 `MesBaseMaster` 改成 `Mold`，
   `PATCH` 返回的 `status` 就从 `DRAFT` 变成了 **`REVIEWED`**。
   **「评审过了」这个状态是编辑动作的副产品，不是任何人评审的结果。** 屏上没有「提交评审」按钮，也没有评审人。
2. **发布后 UI 不刷新**：`POST .../publish` 返回 `200 status: PUBLISHED`，但草案下拉里那一条**仍然显示 `REVIEWED`**。
   运营看不出自己发布成功没有。
3. **两条发布路互不相干**：草案发布（`/modeling/drafts/:id/publish`）**完全绕过**会签（`/ontology/publish-requests`）。
   我建 `Mold`、建 `mold_used_by`、建两条因果边，**全程没触发过一次会签**。
   ⇒ 会签这道门**存在，但不在必经之路上**。
4. **回滚：没有。** `GET /a/v1/ontology/versions` 有版本列表，但**没有任何回滚/切版本的按钮**，
   也没有 `POST .../versions/:id/rollback` 这类路由。对象类型只能 `deprecate`/`retire`（单向），
   因果边**连单向都没有**（动作 4）。

**⇒ 动作 7 判定：有草稿、有会签壳子，但「评审」是假的、发布路绕过会签、回滚不存在。**

---

### 动作 8 · 查一次影响面：我要改这个属性，谁会受影响？

**分两种情况，差别很大**：

- **结构边**：`本体关系` 每行都有 **`查引用`** 按钮 ⇒ **有，可用。**
- **业务常数**：`边界册治理` 整页就是影响面报告，逐册列「派生消费端 + 下游受影响面」
  （例：改 `SEG_REGISTRY` ⇒ order-chain 视图 econTable、risk 求解器 revenue、DemandSegment 派生公式）⇒ **有，且质量不错。**
- **属性**：**没有。** 要改 `Base.gwh` 的单位，屏上问不出「谁在用这个属性」。
- **因果边**：**没有。** 42 条因果边一行一个按钮都没有（动作 4 的表），停用前后的波及面无从查起。

**关于 `change-impact-preview`**：后端有 `POST /a/v1/sim/change-impact-preview`，
前端 `api/endpoints.ts:856` 也**定义了** `fetchChangeImpactPreview`，
但**全前端没有任何页面调用它**（`endpoints.ts:838-842` 的注释自己就写着这件事）。
⇒ 这是「**接了线没数据**」里最尴尬的一种：**函数写好了、放在那儿、零生产调用方**。
（那条未并入的 `handoff-wo-ontology-edge-edit` 分支正是要接它——**但今天没并**。）

**⇒ 动作 8 判定：一半可用（结构边 + 业务常数），一半空白（属性 + 因果边）。**

---

### 动作 9 · 从图谱上找到某个东西：图谱是拿来看的还是拿来用的？

**屏上给了什么**：左导航「图谱体系」是一个 `collapsed: true` 的折叠组，含 **8 个视图**：
`graph-all / graph-backbone / graph-flow / graph-source / graph-solver / graph-mvp / graph-agent / graph-loop`
（`ShellLayout.tsx:480-483`）。
⚠️ 我第一次 dump 左导航时这一组**看起来是空的**，差点报「9 条导航画不出图」——
**真因是它默认折叠**，不是没有子项。**订正记录在此，判据落在「展开后有没有」，不是「文本 dump 里有没有」。**

**逐张实测（8 个视角全跑，真后端、禁 mock）**：

| 视角 | 渲染 | svg 字节 | 节点 fill 分布 | `stroke-dasharray` |
|---|---|---|---|---|
| graph-all | ✅ | 62,876 | factory×85 · solver×11 · equip×4 · agent×4 · product×3 · quality×3 …（10 色） | 0 |
| graph-backbone | ✅ | 66,026 | 10 色 | 0 |
| graph-flow | ✅ | 60,565 | 10 色 | 0 |
| **graph-source** | ✅ | 62,284 | **`var(--muted2)` × 118 —— 118 个节点全是同一个灰** | 0 |
| graph-solver | ✅ | 44,602 | 10 色 | 0 |
| **graph-mvp** | ✅ | 64,762 | **与 graph-all 逐项相同**（factory×85 · solver×11 · equip×4 …） | **0** |
| graph-agent | ✅ | 43,849 | 10 色 | 0 |
| graph-loop | ✅ | 44,520 | 10 色 | 0 |

**三条订正 + 两条新发现**：

1. **订正**：派单线索说「9 条图谱导航只画出 5 张图」——**未复现，8 个视角全部渲染**（每个 svg=1、222 个图形）。
2. **订正**：派单线索说 `graph-mvp` 与普通图谱「**逐字节相同**」——**字面为假**：8 张图 8 个不同 SHA、字节数各异。
3. **但实质成立，且比原话更准**：`graph-mvp` 的**节点着色分布与 `graph-all` 逐项一致**，`stroke-dasharray` = **0**
   ⇒ 它承诺的「**实色高亮核心闭环 + ⊕ 虚线缺口节点**」**一个都没画出来**。
   「⊕」只出现在**页面说明文字**里，从来不是一个节点。根因见 §2 第 7 行：`mvpGap` 零后端产出。
4. **新发现**：**`graph-source` 是一张纯灰图**——118 个节点全部 `var(--muted2)`。
   它的说明写着「按源系统重新着色，回答『每个数据从哪来』」，而**真后端下没有一个节点被判定为源数据**，
   于是「淡出非源节点」的规则把**所有**节点都淡出了。**承诺的那个问题，这张图一个字都没回答。**
5. **新发现**：8 张图的**图例完全相同**（都是同一串「生产基地 | 电池型号 | 产品平台…」），
   **图例不随视角变**——所以屏上没有任何东西告诉运营「这一张和上一张差在哪」。

**⇒ 动作 9 判定：图谱是拿来看的，不是拿来用的。**
没有一个图谱页能建/改/删节点或边；点节点也到不了编辑器（§1 动作 3 已证明编辑器不存在）。
而且**8 张里有 2 张（source / mvp）的核心承诺在真数据下失效**——恰恰是这两张最像「有洞察」的。

---

### 动作 10 · 批量维护：98 类型 / 881 属性 / 115 结构边，逐个点得过来吗？

**实测页面体量**：

| 页面 | 文本长度 | 按钮数 | 说明 |
|---|---|---|---|
| `本体关系` | **24,055 字** | **~350** | 1 页塞 5 个分区、20 张表；结构边 115 行 × 3 按钮 = 345 |
| `实体合并`（扫 Process 后） | **147,363 字** | **131** | 130 个对象铺成 130 列 |
| `对象/类型浏览` | 4,856 字 | ~120 | 全是「看实例 →」 |

**屏上有没有批量手段**：
- 多选框：**无**（`本体关系` 的 23 个 input 全部属于新建表单和守卫表，**表体 0 个**）。
- 全选 / 批量停用 / 批量改域 / 批量导出：**无**。
- 搜索 / 过滤：`本体切片` 有「显示全部 99 条」，`对象/类型浏览` 有域筛选和「仅有物化」——
  **但 `本体关系` 这个最需要过滤的页面，115 条结构边 + 42 条因果边，没有搜索框。**
- 导入 / 导出 / 批改（CSV、YAML、API 批量）：**屏上无。**

**⇒ 动作 10 判定：点不过来。** 改 10 条边就是 10 次「在 24,000 字的页面里滚动找行 → 点 → 确认」。
改 100 条不可行。**而本体维护的日常正是批量的。**

---

## 2 · 七个面各自的裁决（给判据不给感觉）

**判据（三档，先说清楚才好对号）**：

| 档 | 判据 |
|---|---|
| **交付级** | 运营能独立完成「建 → 改 → 停 → 查影响」四件事的闭环，且规模上去了还能用 |
| **半可用** | 能建或能查，但**改不了或停不了**；或能用但**规模一上来就崩** |
| **demo 级** | 只能看，或唯一能点的操作会把事情弄坏 |

| # | 面 | 裁决 | 判据（实测） |
|---|---|---|---|
| 1 | **本体关系** | **半可用（结构边）／demo 级（因果边）** | 结构边：建 ✅(201) · 停用 ✅ · 下线 ✅ · 查引用 ✅ · **屏上改不了**（无 rename/改基数/加描述），但 **API 的 POST 是 upsert 且 version 1→2 实测可改** ⇒ 又一处「写端在、入口无」。<br>因果边：建 ✅ **但 42 行表体 0 input / 0 button** ⇒ 停不了、改不了、删不了；**且这一条 API 也救不了**——重 POST 同 key **不覆盖而是叠加**（与 object-types/link-types 的 upsert 语义**相反**），`combine:sum` 下实际系数 0.9+0.3=1.2。**服务端只有 GET/POST。** |
| 2 | **本体切片** | **半可用** | 有 `＋新建切片` 与 `看子图/编辑`；**编辑亲手验过**：`maxNodes 200 → 137`，`PUT /a/v1/ontology/slices/:key` → **`201`**，回读确认 137（§2.2）。<br>**但：① 删不掉**（`DELETE …/slices/:key` → **404**；金丝雀 `DELETE /a/v1/view-configs/geo-map` → **200** ⇒ DELETE 方法本身好用，是这条路由真没有）；**② 改了不留痕**——改完 `version` 仍是 **1**，没有版本递增、没有改动人、没有 diff。<br>99 条里屏上自报「多跳业务切片 4 条 · 单类型覆盖切片 95 条」。 |
| 3 | **切片库** | **demo 级** | **两边集合交集 = 0（亲手比对）**：注册表 `GET /a/v1/ontology/slices` **99** 条（`aop_scenario_chain`/`coverage_*`），派生库 `GET /a/v1/slices/library` **61** 条（intra 7 + cross 54，全是 `biz.*`）。**同一个「切片」词在导航里指两个不相干、不互通的集合**，且没有任何一页能看到这件事。 |
| 4 | **建模与图谱** | **demo 级** | 建模：**唯一入口是「从已有原始数据集派生」，无空白建模**；属性编辑器只有 `propKey/sourceField/dataType`，**无单位/显示名/描述/必填/枚举/默认值**；`displayName` 改不掉。<br>⚠ **但写端是在的**：`POST /a/v1/ontology/object-types` 实测是 **upsert**，能改 `unit`/`displayName`（201，类型数不增）⇒ 判为 demo 级是因为**屏上零入口**，不是因为后端没能力。图谱：见第 7 行。 |
| 5 | **实体合并** | **demo 级** | 扫描器可用（Process 出候选，金丝雀成立），但**候选组 = 130 个真实不同的工序**，界面给 130 个「以 X 为准」按钮，**没有排除/否决/拆组/调阈值**。唯一能点的动作是制造事故。 |
| 6 | **边界治理** | **只读报告（作为治理台是 demo 级，作为影响面报告是交付级）** | **0 按钮 0 输入**；页面自述「改值＝改代码」。且它管的是 3 张业务常数表，**不是**「哪些数据进本体」。 |
| 7 | **图谱体系** | **demo 级** | 8 个视角（`collapsed:true` 折叠组）共用 `OntologyGraphView` 一套渲染，靠 `graphOptions` 区分。<br>**8 张全能渲染**（订正派单「只画出 5 张」），但**两张的核心承诺在真数据下是空的**：<br>· **`graph-mvp`**：节点 fill 分布与 `graph-all` **逐项相同**、`dasharray=0` ⇒ 承诺的「实色高亮 + ⊕ 虚线缺口节点」**一个没画**。根因：`mvpOverlay` 被渲染器消费（8 处），但 `n.mvpGap` **全仓只有 `mocks/fixtures.ts` 生产（3 条）、datacore 零产出** ⇒ 禁 mock（= 部署态）时恒 false。〔金丝雀：同法找 `mvpOverlay` 命中 14 次〕<br>· **`graph-source`**：**118 个节点全是 `var(--muted2)` 同一个灰** ⇒「按源系统着色」渲染成一张纯灰图。<br>· 8 张图**图例完全相同**，屏上没有任何东西说明「这张和上张差在哪」。<br>图谱**只能看不能改**：没有一个图谱页能建/改/删节点或边。 |

### 贯穿七个面的那条主线：**「写端在、屏上无入口」，而三类元素的写语义还互相矛盾**

这是本次评审最有用的一张表（全部亲手打过，不是读代码推的）：

| 本体元素 | 屏上能改? | API 写语义（实测） | 版本纪律 | 改错了能救吗 |
|---|---|---|---|---|
| **对象类型** | ❌ 无任何入口 | `POST` = **upsert**（201，总数不增，`displayName`/`unit` 生效） | 无 version 字段 | ✅ 能（curl 整包回传） |
| **结构边** | ❌ 只有停用/下线 | `POST` = **upsert**（同 id，去向/基数被改） | ✅ **version 1→2** | ✅ 能 |
| **切片** | ✅ 能改 `maxNodes` | `PUT` = 覆盖（201，回读生效） | ❌ **version 恒 1** | ✅ 能改，❌ 删不掉（404） |
| **因果边** | ❌ 表体 0 控件 | `POST` = **追加**（同 key 变两行） | — | ❌ **救不了，且越救越错** |

**三点结论**：
1. **本体编辑能力的缺口，大部分是「入口缺口」不是「能力缺口」** —— 这决定了修复是**接线**，不是造门。
2. **同一套本体里，四类元素的写语义有三种**（upsert / 覆盖 / 追加），**版本纪律有两种**（递增 / 恒 1）。
   运营没有一个统一心智模型可用，**每类元素都要单独记它会不会把你坑了**。
3. **唯一真正的能力缺口是因果边** —— 也正是唯一会**静默算错**的那一类。

### 关于仓主那句「都是垃圾，只是 demo 级」

**用实测坐实，不附和也不护短**：

- **坐实的部分（7 个面里 5 个）**：因果边、切片库、建模、实体合并、图谱体系 —— **确实是 demo 级**，
  判据不是「难看」，是**运营在上面完成不了本职工作**，其中实体合并和因果边**用了会出事**。
- **推翻的部分（必须说）**：
  - **结构边不是垃圾**：建/停/下线/查引用四件事都真实工作，`201` 是真的，115 条边是真的。它缺的是「改」和「批量」。
  - **边界册治理作为影响面报告是好东西**：逐册列派生消费端和下游影响，这正是动作 8 想要的东西，**质量高于本仓平均水平**。它只是被放在了「治理」这个名字下面。
  - **草案 + 会签的骨架是真的**：`DRAFT/REVIEWED/PUBLISHED` 状态机在、会签表在、`publish-requests` 真被调用。
    问题是**评审是假的**（状态自己跳）、**会签不在必经路上**，不是「没有」。
### 派单线索的订正（「线索不是结论」——四条我实测后改了口径）

| # | 派单/台账原文 | 实测 | 影响 |
|---|---|---|---|
| 1 | 「本仓刚补完 **873 个属性的 unit**」 | 881 条属性里带 `unit` 的 **24 条**（12/98 个类型）。`unit:` 在 datacore 源码出现 254 次，但多为**指标/杠杆/切片层**的单位 | 不改结论，**反而更硬**：语义层更稀疏，且一条都改不了 |
| 2 | 「全仓 `app.delete(` 只有 **2 条**」 | **8 条**（agentcore 5 + datacore 3）。金丝雀：`app.post(` 162 条 ⇒ grep 好用 | 结论（无本体元素删除）成立，**数字要改** |
| 3 | 「**两个切片页共用同一份实现**」 | **不准**。`SlicesPage.tsx`(356 行) 与 `SliceLibraryPage.tsx`(262 行) 是两份实现、打**两个不同端点**（`/ontology/slices` vs `/slices/library`）；真正共用的是子组件 `SliceInspector` 与 `planSlice` | 「交集 0」成立且更严重：**不是一份实现显示两批数据，是两套东西同名** |
| 4 | 「`graph-mvp` 与普通图谱**逐字节相同**」 | **字面为假**：8 张图 8 个不同 SHA。**实质成立且更准**：`graph-mvp` 的**节点着色分布与 graph-all 逐项一致**、`dasharray=0`，承诺的「实色高亮 + ⊕ 虚线缺口」一个没画。病因：`mvpOverlay` 被渲染器消费（8 处），但 `mvpGap` **只有 mocks/fixtures.ts 生产、datacore 零产出** | 现象一致，**病因完全不同**⇒ 修法也不同（要**后端补 `mvpGap`**，不是改前端）。照原文「逐字节相同」去查会得出「前端渲染器坏了」这个相反结论 |
| 5 | 「9 条图谱导航**只画出 5 张图**」 | **未复现**：8 个视角（不是 9 条）**全部渲染成功**，每张 svg=1 / 222 图形 | 真问题不是「画不出」，是**画出来了但两张的承诺是空的**（source 全灰 / mvp 无高亮） |

> 第 3、4、5 条正是本仓铁律 0.6 反复警告的形态：**一条写在最容易被信的地方的错误病因，比没有这条更危险**——照原文去修会修错方向。
> 这也是为什么派单模板要求「**我给的 file:line 与状态是线索不是结论**」：五条线索里 **2 条数字错、2 条病因错、1 条现象未复现**。

- **我自己在这次评审里判错过 4 次**（都已订正、留在正文里）：
  ① 判「AI 建议草案点了没反应」——实为模态渲染在 `main` 之外；
  ② 判「草案刷新即丢」——实为编辑器在页面顶部而我只看了尾部；
  ③ 判「`publish-requests` 前端零命中」——实为 grep 结果被 `head_limit` 截断；
  ④ **最严重的一次**：判「**对象类型一旦发布在任何一层都改不了**」——
     实测 `POST object-types` 是 **upsert，改得了**。
     **这一条若不订正，会把「接一条线」错报成「造一道门」，直接歪掉排期**（§1 动作 3 已详录）。
  **四次都是「我用 X 当作 Y 的证据，而 X 并不度量 Y」**（④ 是「我用『路由表里没有 PUT』当作『改不了』的证据」），
  正是本仓铁律 0.5/0.6 反复警告的形态。**其中只有 ④ 是靠亲手打那个 POST 才翻出来的 —— grep 一次都看不见。**

---

## 3 · 缺失功能清单（运营维度 —— 前一份分析整个漏掉的那一维）

> 每条写清：**运营要做 X，今天做不了 / 要 N 步 / 只能绕道 Y**。

### A · 建不起来（没有这些，本体就长不出来）

| # | 运营要做 | 今天 | 证据 |
|---|---|---|---|
| A1 | **从空白新建一个对象类型** | **做不了**。唯一入口是从已有 `rds_*` 数据集派生 ⇒ 没有对应数据源的概念（模具、工装、班次模板…）进不了本体 | `/admin/modeling` 全页 1 个按钮；模态只列 87 个 `rds_*` |
| A2 | **给属性设单位 / 显示名 / 描述** | **屏上做不了**（字段在 UI 里不存在）；**API 能做**（upsert 实测 201）⇒ **缺的是入口不是能力** | 属性编辑器仅 `propKey/sourceField/dataType`；`POST object-types` 实测可写 `unit/displayName` |
| A2b | **加一个字典里没有的单位（如 MWh / kg / 小时）** | **做不了**，改代码发版 | `ontology-governance.ts:55` `UNIT_DICTIONARY` 硬编码 9 项；填 MWh → `400 未知单位` |
| A3 | **改类型的显示名** | **屏上做不了**（无输入框）；API 可 upsert | `Mold.displayName` 卡死为 `mes_base_master` |
| A4 | **给结构边/因果边写「影响说明」** | **做不了**，两个建边表单都没有描述字段 | `POST link-types` 载荷仅 4 键 |
| A5 | **建共享属性类型（语义类型）** | **做不了**，全系统 0 个实例，无建立入口 | 派单线索，本次未见任何入口 |

### B · 建得起来但维护不下去（**优先级最高，因为会出事**）

| # | 运营要做 | 今天 | 证据 |
|---|---|---|---|
| **B1** | **改 / 停 / 删一条因果边** | **屏上和 API 都做不了**，且**重建会叠加不会覆盖** ⇒ 静默算错。**三类本体元素里唯一连绕道都没有的一类** | 42 行表体 0 input/0 button；服务端仅 GET/POST 且**非 upsert**；`propagation.ts:559/614` 逐条累加 |
| **B2** | **改一个已发布类型的任何东西** | **屏上做不了**；API 的 `POST object-types` 是 **upsert，实测能改**（201，类型数不增）⇒ **接线活，不是造门活** | 实测改 `Base.displayName` + `gwh.unit` 成功；但**整体替换**（漏传即丢属性）、**无版本/并发校验** |
| **B3** | **删一条切片** | **做不了** | `DELETE /a/v1/ontology/slices/:key` → **404**（金丝雀 `DELETE /a/v1/view-configs/geo-map` → **200**）。全仓 `app.delete(` **8 条**（agentcore 5 + datacore 3），**无一是 slice / object-type / link-type / propagation-rule** |
| **B8** | **改切片后能看出「谁改的、改了啥」** | **做不了** | `PUT` 成功后 `version` 仍为 **1**，无版本递增 / 无改动人 / 无 diff |
| **B4** | **在合并里排除误判成员 / 否决候选 / 调阈值** | **做不了**，只能全合或不合 | Process 组 130 个对象、130 个「以 X 为准」 |
| **B5** | **回滚一次本体变更** | **做不了**，有版本列表无回滚动作 | `GET /ontology/versions` 有；无 rollback 路由/按钮 |
| **B6** | **真评审**（有人看过才叫 REVIEWED） | **做不了**，状态是编辑副产品 | 改个 typeKey ⇒ `DRAFT→REVIEWED` |
| **B7** | **让发布必须过会签** | **做不了**，草案发布绕过会签 | 全程建 4 个对象 0 次会签 |

### C · 查得到但问不出（影响面）

| # | 运营要做 | 今天 |
|---|---|---|
| C1 | 查「改这个**属性**谁受影响」 | **做不了**（结构边和业务常数可以，属性不行） |
| C2 | 查「停这条**因果边**切断哪条传播路径」 | **做不了**（正是参考截图那句副标题承诺的事） |
| C3 | 改前预览影响 | 后端有 `change-impact-preview`，**前端零调用方** |

### D · 规模上不去（批量）

| # | 运营要做 | 今天 |
|---|---|---|
| D1 | 批量停用/改域/改基数 | **无多选、无批量动作**（表体 0 个 checkbox） |
| D2 | 在 115 条边里找一条 | **无搜索框**，24,055 字页面靠滚 |
| D3 | 导入/导出本体（CSV/YAML/API 批改） | 屏上**无** |
| D4 | 分页/虚拟滚动 | **无**，合并页 147,363 字一次铺完 |

### E · 命名与信息架构（便宜但影响每天）

| # | 问题 |
|---|---|
| E1 | 「本体切片」与「切片库」**共用实现、交集为 0**，同名指两物 |
| E2 | 「边界册治理」**不能治理**（0 按钮），名不副实 |
| E3 | 「对象/类型浏览**器**」诚实，但**没有配套编辑器** |
| E4 | 「本体关系」1 页 24,055 字 / 5 分区 / 20 表 / ~350 按钮，应拆 |

---

## 4 · 排序

### 第一档 · 不补则**会出事**（比「建不起来」还急，因为它在制造错数）

1. **B1 因果边可改/可停/可删 + 同 key 幂等**（今天：改正一次 ⇒ 系数翻 4 倍，且删不掉）
2. **B4 合并候选可排除 / 可否决 / 可调阈值**（今天：唯一能点的操作会合掉 130 个真实不同的工序）

> 这两条是**数据完整性**问题，不是 UX 问题。铁律 1.5 的「跑得起来 ≠ 算得对」在这里各有一个活标本。

### 第二档 · 不补则**本体建不起来**

3. **A2/A3/B2 把已有写端接进屏幕** —— **本档性价比最高，是接线不是造门**：
   `POST /a/v1/ontology/object-types` 已是 upsert 且实测能改 `unit`/`displayName`/`description`，
   只需在属性编辑器上加三个输入框 + 一个「已发布类型也能编辑」的入口。
   ⚠ 接的时候必须同时解决 upsert 的**整体替换**语义（前端要回传完整属性表，否则静默丢属性）。
4. **A1 空白新建对象类型**（不依赖数据集）
5. **A2b 单位字典可扩展**（今天 9 项硬编码；至少要让它可配、且屏上看得见）
6. **A4 边的「影响说明」**（参考截图那一列，也是 C2 的前提）

### 第三档 · 建得起来但**维护不下去**

7. **B5 回滚** + **B6 真评审** + **B7 发布必过会签**（三条是一件事：变更治理闭环）
8. **B3 切片删除**
9. **C1/C2 属性与因果边的影响面查询**（C3：把已有的 `change-impact-preview` 接上，成本最低）
10. **D1/D2 批量与搜索**

### 第四档 · 能忍

11. E1–E4 命名与拆页；切片库/图谱体系的重复实现收敛；95 条零跳切片存根的清理

---

## 5 · 必答一问：参考截图那张表的水平，本仓七个面里有几个达到了？

**参考截图的形态拆成 6 项能力**（一屏之内说清「关掉这条边会切断哪条传播路径」）：

`①来源▾` · `②去向▾` · `③关系▾` · `④影响说明（人话）` · `⑤启☑（就地启停）` · `⑥✕（删除）` · `⑦＋新增关系边`

| 面 | ① | ② | ③ | ④影响说明 | ⑤就地启停 | ⑥删除 | ⑦新增 | 达标? |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **本体关系 · 结构边** | ✅ | ✅ | ✅ | ❌ | ◑ 停用/下线是**按钮不是就地☑**，且不可逆 | ◑ 只有「下线」，非删除 | ✅ | **接近但未达**（缺④，⑤⑥不可逆） |
| **本体关系 · 因果边** | ✅ | ✅ | ✅（经由结构边） | ❌ | **❌ 表体 0 控件** | **❌** | ✅ | **未达** |
| **本体切片** | — | — | — | ❌ | ❌ | **❌ 无删除（DELETE→404）** | ✅ | 未达 |
| **切片库** | — | — | — | ❌ | ❌ | ❌ | ❌ | 未达 |
| **建模与图谱** | ✅（草案内） | ✅ | ✅ | ❌ | ❌ | ◑ 仅草案内「删除属性」 | ◑ 仅从数据集派生 | 未达 |
| **实体合并** | — | — | — | ◑ 有「归一名称完全一致·得分1/1」 | ❌ | ❌ | — | 未达 |
| **边界治理** | — | — | — | ✅ **唯一做到④的一页** | ❌ | ❌ | ❌ | 未达 |
| **图谱体系** | — | — | — | ❌ | ❌ | ❌ | ❌ | 未达 |

### 答案：**0 个。七个面里没有一个达到参考截图的水平。**

**最接近的是「本体关系 · 结构边」**，它拿到了 ①②③⑦，但：
- **缺 ④「影响说明」**——而这正是参考截图的**灵魂**：那张表的副标题「关闭"市场→商机"等边会切断该传播路径」
  是在**用人话解释这条边的因果后果**。本仓 115 条结构边、42 条因果边，**没有一条有一个字的说明**。
- **⑤⑥ 是单向的**：「停用/下线」点了回不来，不是参考截图那个可以随手勾掉再勾回来的 ☑。

**最反讽的一条**：参考截图整张表的意义是「**关掉这条边，看它切断什么**」。
本仓**唯一真正做到「说清影响面」的页面是「边界册治理」**——而那一页**恰恰 0 个按钮，什么都关不掉**。
**能说清影响的地方不能操作，能操作的地方说不清影响。** 这就是七个面共同的病。

---

## 附 · 复验命令（任何人可原地重跑）

```bash
# 环境（禁 VITE_MOCK）
pnpm install --prefer-offline
pnpm --filter @platform/llm-adapters build   # ⚠ 不先建这个，datacore build 会假红 TS2307
pnpm --filter @platform/contracts build && pnpm --filter datacore build
PORT=4501 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '4%.0s' {1..64}) node apps/datacore/dist/server.js
VITE_DATACORE_URL=http://127.0.0.1:4501 pnpm --filter frontend-shell dev --port 5501

H='X-Debug-User: demo:admin:admin|planner|catalog_admin'

# §0 底数 + 「873 unit」纠正
curl -s -H "$H" localhost:4501/a/v1/ontology/object-types | python3 -c "
import sys,json;i=json.load(sys.stdin);p=[q for x in i for q in x['properties']]
print(len(i),'types',len(p),'props','unit=',sum(1 for q in p if q.get('unit')))"

# 动作 3/4：写端到底有没有
grep -nE 'app\.(get|post|put|patch|delete)\(\"/a/v1/(ontology/object-types|sim/propagation-rules)' \
  apps/datacore/src/app.ts

# 动作 4：同 key 不覆盖而叠加（先在 UI 建两条同 key 规则）
curl -s -H "$H" 'localhost:4501/a/v1/sim/propagation-rules?published=true' | python3 -c "
import sys,json;from collections import Counter
r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get('rules',[])
c=Counter(x['key'] for x in r); print({k:v for k,v in c.items() if v>1})"
grep -n 'sortedRules' apps/datacore/src/sim/propagation.ts   # :559 无按 key 去重

# 动作 5：金丝雀——扫描器是好的，只是数据干净
for t in Base Line Customer Process; do
  echo -n "$t -> "; curl -s -X POST -H "$H" -H 'content-type: application/json' \
    -d "{\"typeKey\":\"$t\"}" localhost:4501/a/v1/objects/merge-scan | head -c 120; echo
done

# 动作 9：图谱体系不是空组，是 collapsed:true
grep -n '图谱体系' -A 3 apps/frontend-shell/src/pages/ShellLayout.tsx

# §2.7 graph-mvp：区分用的数据只活在 mock 里（金丝雀 mvpOverlay 应命中 14）
grep -rn 'mvpGap'     apps/ packages/ --include=*.ts --include=*.tsx   # 仅 mocks/fixtures.ts 生产
grep -rc 'mvpOverlay' apps/ packages/ --include=*.ts --include=*.tsx | grep -v ':0'
# 屏上复验（登录后逐张取 svg）：graph-mvp 的 fill 分布应与 graph-all 逐项相同、dasharray=0；
# graph-source 应是 fill="var(--muted2)" × 118 一色。脚本见 scratchpad/loop9/graphdiff.mjs、gsrc.mjs

# §2.2 切片可改不可删（金丝雀：view-configs 的 DELETE 是 200）
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "$H" localhost:4501/a/v1/ontology/slices/aop_scenario_chain  # 404
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "$H" localhost:4501/a/v1/view-configs/geo-map                # 200

# §2.3 两个切片集合交集 = 0
python3 - <<'PY'
import json,urllib.request
H={'X-Debug-User':'demo:admin:admin|planner|catalog_admin'}
g=lambda p: json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4501'+p,headers=H)))
reg={x['sliceKey'] for x in g('/a/v1/ontology/slices')}
lib=g('/a/v1/slices/library'); lib={x['sliceKey'] for x in lib['intra']+lib['cross']}
print(len(reg), len(lib), 'intersection =', len(reg&lib))
PY

# §3 B3 全仓 delete 路由（应为 8 条，无一是本体元素）
grep -rn 'app\.delete(' apps/*/src/

# §1 动作 3 最关键的一条：POST object-types 是 upsert（不是 create）——屏上没入口而已
python3 - <<'PY'
import json,urllib.request
H={'content-type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'}
B='http://127.0.0.1:4501'
g=lambda p: json.load(urllib.request.urlopen(urllib.request.Request(B+p,headers=H)))
base=[t for t in g('/a/v1/ontology/object-types') if t['key']=='Base'][0]
props=[dict(p) for p in base['properties']]
for p in props:
    if p['propKey']=='gwh': p['unit']='吨'          # 'MWh' 会 400：不在 9 项字典里
body={'key':'Base','displayName':'生产基地(改口径)','domain':base.get('domain'),'properties':props}
r=urllib.request.urlopen(urllib.request.Request(B+'/a/v1/ontology/object-types',
    data=json.dumps(body).encode(),method='POST',headers=H))
print('POST ->',r.status)                                    # 201
t=g('/a/v1/ontology/object-types'); print('总数',len(t))      # 仍 98 ⇒ upsert 不是 create
b=[x for x in t if x['key']=='Base'][0]
print(b['displayName'], [p for p in b['properties'] if p['propKey']=='gwh'])
PY
grep -n 'UNIT_DICTIONARY' apps/datacore/src/ontology-governance.ts   # :55 硬编码 9 项
```

> ⚠️ **复跑注意**：本机同时有多个 agent 各跑一套 datacore，实测**内存竞争会把新起的 datacore SIGKILL（exit 137）**。
> 起服务要带重试与健康探针（见 `scratchpad/loop9/dc.sh` 的 25 次轮询），
> 且**「NOT_FOUND」可能只是种子还没跑完**——本次实测就出现过第 1 步 404、第 3 步同一条读到值的情况。
