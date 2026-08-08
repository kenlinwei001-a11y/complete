# PRD · 推演沙盘「局部范围」静默错答收口 + 向导退役（WO-SIM-SCOPE-LOCAL）

> 分支 `claude/handoff-wo-sim-scope-local`（基线 `640acb74`）。前端单包改动，零 `apps/datacore/` 触碰。
> 关联欠账：#127（sim 路由守卫零测试覆盖）。

---

## 1. 一句话

沙盘控制台的「局部范围」是个**搬了一半的开关**：把 A 屏（初始化向导）的能力搬到 B 屏（控制台）时，
只搬了 `GLOBAL|LOCAL` 这个枚举、**没搬它的参数 `target`** —— 于是「局部」这一档空转，
屏上照常写着「局部」，算出来的却是全局。本单补齐参数、堵死无参数的 LOCAL、并退役那个只剩枚举可搬的向导页。

---

## 2. 缺陷一（🔴 静默错答·主项）

### 2.1 链路（亲手复核，三跳全对；行号以基线 `640acb74` 为准）

```
SandboxView.tsx:243   useState<"GLOBAL"|"LOCAL">("GLOBAL")        ← 枚举搬来了
SandboxView.tsx:268   fetchSimCertification(s.id, certScope)      ← 只传 2 个实参
SandboxView.tsx:287   fetchSimCertification(sessionId, scope)     ← 只传 2 个实参
        ↓
endpoints.ts:557-558  (sessionId, scope="GLOBAL", target?) =>
                      `…/certification?scope=${scope}${target ? `&target=${enc(target)}` : ""}`
                                                        ↑ target===undefined ⇒ 整段不拼
        ↓
datacore app.ts:1589  const types = scopeKind === "LOCAL" && target ? allTypes.filter(...) : allTypes
                                                        ↑ target 为 null ⇒ 条件恒 false ⇒ types = allTypes（全本体）
datacore app.ts:1640  kind: scopeKind, targetRef: scopeKind === "LOCAL" ? target : null
                                                        ↑ 回包里 scope 仍是 "LOCAL"（targetRef 为 null）
```

**复核结论：工单给的链路完全正确**，仅行号有偏移（工单写 `:227/:252`，基线实为 `:243/:268`，
另有第二个调用点 `:287` 工单未列；datacore 两处 `:1589/:1640` 一字不差）。
`SandboxView.tsx` 全文 `target` 零次作为 state 出现 ⇒ **今天永远走不到真正的 LOCAL**。

### 2.2 三态定性（铁律 0.5 判据）

不是「没接线」，也不是「接了线没数据」，而是 **「接了线接错地方」的一个变体：线接上了，但少接了一根**。
后端 `target` 参数存在、`endpoints.ts` 形参存在、UI 枚举存在 —— **唯独没有任何东西给 `target` 赋过值**。
测试也帮着盖住了它：`test/sandbox-p0.test.tsx:199` 原断言
`expect(fetchCertFn).toHaveBeenCalledWith("sims_main", "LOCAL")` —— **恰好把缺陷钉成了期望**。

### 2.3 危害定级

与 `G-ARG-DROP-SEAM` / `G-PORTFOLIO-BT-SILENT-ALL` / `G-SOLVER-SCOPE-DEAF` 同族：
**plausible-but-WRONG**。界面上完全看不出筛选没生效 —— 用户按「局部」做决策，拿的是全局数字。
本仓对这一族的既有判词是「静默错答比崩溃更危险」（R-ARG-FIDELITY）。

### 2.4 修法裁决：选 (A) 补齐，以 (B) 诚实降级兜底

**选 (A) 的理由**（写明如工单所要求）：

1. **数据源现成且零业务常数**。候选来自 `GET /a/v1/sim/view-config` 的 `nodeTypes`
   （datacore `app.ts:1543` `types.map(t => t.key).sort()`，= 租户本体派生）。代码里零行业实体名，
   `debattery:check`（R14 去业务锁死门）咬不到。
2. **后端能力早就在**，缺的只是前端把参数递过去 —— 走 (B) 等于把一个**已实现**的能力永久关掉。
3. **屏上已有它的显示位**：`SimReadinessPanel.tsx:181` 早就写了 `{cert.targetRef && (…「对象：」…)}`，
   只是 `targetRef` 恒 null 所以从没亮过。补齐 target 后这块显示位自动活过来（零新 UI 债）。
4. **实测 `nodeTypes` 生产实参下非空**：demo 租户 94 个已发布对象类型
   （旁证：`test/sandbox-console.seam.test.tsx:443` 注释「demo 租户实测 94 个已发布对象类型」）。
   故工单说的"若 nodeTypes 生产下为空则必须走 (B)"这个前提**不成立**。

**(B) 仍然保留为兜底分支**（不是二选一，是主路 + 兜底）：
`cfg.nodeTypes` 为空时 target 无从取值 ⇒ **不提供** LOCAL 档，并在屏上写明原因
（`sandbox-cert-local-unavailable`：「本体暂无已发布对象类型 → 局部范围不提供（无目标的「局部」在后端等同全局，
不以全局结果冒充局部）」）。**绝不**保留现状那种"说 LOCAL 算 GLOBAL"。

### 2.5 落地

| 位置 | 改动 |
|---|---|
| `SandboxView.tsx` | 新增 `certTarget` state + `effectiveTarget` 派生（未选过时取 `nodeTypes[0]`，语义抄向导 step① 但不 import 它） |
| `SandboxView.tsx` | `reloadCert(scope, target?)`：LOCAL 必带 target；**先拿到该范围的数字、再切屏上的档**（杜绝「档位说 LOCAL、数字还是上一次 GLOBAL」）；失败不切档 |
| `SandboxView.tsx` | `init` 那个调用点同样补齐 —— 不留第二个 2 实参调用点回潮 |
| `SandboxView.tsx` | 右栏就绪认证区加目标对象类型选择器 + 空本体诚实降级位 |
| `SandboxView.tsx` | 采纳留痕带 `scopeTarget`，且**优先取后端真回的 `cert.targetRef`**（非前端 state 的一厢情愿·R13） |

---

## 3. 缺陷二（欠账 #127 · 路由守卫零测试覆盖）

175 个前端测试文件对 `sim-sandbox` / `sim-init` 守卫 **0 命中**；且全仓 `createMemoryRouter` 0 处使用。

新增 `test/sim-route-guards.test.tsx`（6 例），走**真路由**
（`renderApp` = `createMemoryRouter(routes, {initialEntries})`，`routes` 直接来自 `@/App`）：
从 URL 出发经真路由表解析，守卫漏挂、或被 `v/:viewKey` 抢先匹配，都能测出来。

被替换掉的反面样本：原 `test/sim-init-wizard.test.tsx` 拿 `MemoryRouter` 直接 render 组件
—— **绕过守卫**，测的是组件不是链路。该文件随向导一并删除。

覆盖：`sim.sandbox` 开/关 × 路由（沙盘上屏 / 404，且断言**不是 403**、不泄露存在性）、
开/关 × 侧栏入口（暗发 = 关就不存在，不是灰掉）、`/v/sim-init` 退役后落 404 且零向导残留 DOM。

---

## 4. 扩单 ②：把向导的价值融进控制台

### 4.1 取证：向导三步里真正有价值的只有一步

| 向导步骤 | 取证结论 |
|---|---|
| ① 世界基准 GLOBAL/LOCAL + target | **唯一真价值**；已并入控制台（本单 §2） |
| ② 状态变量勾选 | `selectedVars` **压根没进 `createSimSession` 的 body**（`SimInitWizard.tsx:112` 只传 `{kind,target}`）⇒ 勾完什么都不发生，纯屏上装饰 |
| ③ 范围预检 | 与控制台右栏就绪认证**同一个 `assembleCertification`**；`scope-precheck` 端点（`app.ts:1677`）只是 `certification` 的字段子集投影 ⇒ 控制台显示的是**超集** |

### 4.2 被修的坏形态：两屏各建各的会话

```
向导 :112 createSimSession({scope:{kind,target}})  → 会话 A
     :133 navigate("/v/sim-sandbox")               → 向导 unmount，A 的 id 随组件 state 蒸发
SandboxView !sessionId → createSimSession({scope: {}}) → 会话 B（空范围）
```

已复核：`apps/frontend-shell/src/store/` 下 `simSession|sessionId` **零命中**（两屏各持自己的 `useState`），
无 URL 参数、无 storage ⇒ 会话 id 确实传不过去。

**修法**：`init(cfg, kind, target)` 把**当前选中的范围真的写进 `SimSession.scope`**（不再是硬写的 `{}`），
并记 `sessionScope` 供屏上对账；范围漂移时出提示 + **显式**「按当前范围重建会话」按钮（不静默、不自动重建）。
配合 §5 删掉向导，**一个屏只有一处建会话**，这类错配从此不可能发生。

### 4.3 诚实位（不许暗示范围已生效）

已复核 `SimSession.scope` 在引擎侧 **有写端无读端**：

- 写：`app.ts:1391`
- 读：只读 `snapshotKind` 一个键（`:1408` / `:1705` 过滤方案快照）+ `:1512` 分支整体继承
- **tick 路（`app.ts:1415` 起）遍历 `repos.ontologyTypes.list(c.tenantId)` 全本体，从不看 `session.scope`**

故屏上明写（`sandbox-scope-reach-note`）：
「⚠ 范围选择当前**只作用于就绪认证口径**，**尚未裁剪推演本身** —— 推演引擎按整租户本体传导，不读会话范围。」

这笔账另记为 **`G-SIM-SCOPE-UNREAD`**，不归本单修（§7 建议回写本体）。

### 4.4 ⚠ 未按工单原文实现的部分（**请审核方裁决**）

工单要求：「控制台无会话时**先出开场态**…**显式一个「进入推演」按钮**才 `createSimSession`，
去掉挂载自动建会话的那个 effect」，并要求测试断言「控制台不再在挂载时自动建会话」。

**没做，因为它与本单的禁改边界直接冲突**。取证：

| 测试文件 | 冲突点 | 是否在我边界内 |
|---|---|---|
| `test/sandbox-console.seam.test.tsx:464-468` | 取 `sandbox-tick-btn` → `waitFor(disabled===false)` → 点击 → 断言 KPI 变。**要求会话在无用户操作下就存在** | ❌ **明令禁改**（另一单刚动过 b2801300） |
| `test/sandbox-view.test.tsx:136-145` | 同上形态 | ❌ 不在允许清单 |
| `test/metro-semantics.seam.test.tsx:361/381/392` | `findByTestId("sandbox-console")` 挂载即期待 | ❌ 不在允许清单 |
| `test/sandbox-p0.test.tsx:124/142` | `findByTestId("sandbox-adopt-btn")` 等挂载即可用 | ⚠ 未在禁改清单，本单已最小改 1 行 |

「挂载即有可用会话」与「必须点按钮才建会话」**逻辑互斥**，无法同时成立；
而这些断言恰恰是旧行为的规格书。在不越界的前提下，本单实现了**同等收益的最大子集**：

- ✅ 消灭 `scope: {}` 空范围会话（范围真的落进会话）
- ✅ 消灭"用户选的范围被丢弃"的**根因**（删掉第二个建会话的屏，§5）
- ✅ 范围漂移**显式**可见 + 显式重建（不静默）
- ✅ 诚实位说清范围当前的真实作用面
- ❌ 未做「显式进入推演按钮 + 去掉自动建会话」

**若审核方确认要按原文做**，需一并放开上述 3 个测试文件的改动权（`sandbox-console.seam.test.tsx`
须与 b2801300 那一单协调，避免真实合并冲突）。这是**一行决策**，不是技术难点。

### 4.5 ⚠ 对「demo 租户 `canEnterSimulation` 多半是 false」这一前提的复核 —— **与工单相反**

工单称「实测 demo 租户准备度 47 / 世界完整度 33%，`canEnterSimulation` 多半是 false，做成硬挡会把 demo 锁在外面」。
**canonical 里有一条真端点测试直接反证**（`apps/datacore/test/sim-certification.test.ts`
「WO-RC1 前向闭合硬前置」）：

```ts
await enableSim(t); await seedBattery(t);          // ADMIN = debugUser("demo","admin","admin")
GET /a/v1/sim/sessions/:id/certification?scope=GLOBAL
expect(cert.level).toBe("L4_CERTIFIED");
expect(cert.canEnterSimulation).toBe(true);        // ← GLOBAL 下为 true
```

即 **demo 租户 + GLOBAL 范围下 `canEnterSimulation === true`**。

进一步读 `sim/certification.ts:185`：`canEnter = L4 ∧ trial.passed ∧ closure.gatePassed`，
而 L4 需 `observabilityMet`（`:142`：scope 内**每个**类型都被切片 root 覆盖）。
`batteryCoverageSlices()`（`synthetic/data-categories.ts:109`）为**每个**对象类型生成一个覆盖切片
⇒ GLOBAL 下该条恒满足，与上述测试一致。**LOCAL** 下 `types` 被裁到 1 个、`closure` 依裁剪后的 plan 重算，
结果我**无法在不跑服务的前提下断言**（见下）。

**诚实边界**：我**没有真跑服务复核**。当时 `uptime` 显示 4 核机 load average 8.65、
三个 vitest 各占 ~104% CPU（审核方的四包 gate 在跑），起 datacore 会加剧争用；
工单亦允许「起不了就读 `assembleCertification` 的算法确认」。故上述为**算法 + canonical 测试**双证据，
非我亲手真跑。**47 / 33% 这两个数我复现不出来**，也不在前端 MSW 桩里（桩是 composite 52 / pct 60|48）。

**结论不变但理由要换**：「不要做成硬挡」是对的，但依据不是"demo 进不去"，而是三条更硬的：

1. **本仓早已就此下过定论**：`SimReadinessPanel.tsx:171-179`（WO-RC-UX-DOOR-TEXT）明写
   「未认证 ≠ 硬挡…本就可试跑」，显「◐ 可试跑（未认证·结论仅供参考）」而非「暂不可进入」劝退。
   向导那个 `disabled={!precheck.canEnterSimulation}`（`SimInitWizard.tsx:340`）才是**不一致的那一个**。
2. **空本体/未播种租户**：`totalTypes===0` ⇒ `L0_INVALID` ⇒ 硬挡 ⇒ 永久锁死、连探索都不行。
3. **LOCAL 档**结果不确定，硬挡等于把不确定性变成用户的死路。

现状（已核实）：`grep -rn canEnterSimulation apps/frontend-shell/src` 删向导后**只剩
`SimReadinessPanel` 的显示用途**（着色 + 文案），**全应用零个 `disabled` 依赖它** ⇒ 不存在按认证硬挡的入口。

---

## 5. 扩单 ③：退役初始化向导

仓主定调：「有价值的融入到推演沙盘里面，不需要单独的向导页面」。

删除清单（逐处自查过，与工单一致，无遗漏）：

| # | 位置 | 处置 |
|---|---|---|
| 1 | `src/views/sim/SimInitWizard.tsx` | 删（353 行） |
| 2 | `src/App.tsx` lazy import / `SimInitGuard` / route `v/sim-init` | 删三处 |
| 3 | `src/pages/ShellLayout.tsx` NavIcon `sim-init` / NavLink 入口 / 两处注释口径 | 删 + 改 |
| 4 | `src/mocks/handlers.ts` | **只改注释**：`view-config` / `sessions` 沙盘照用不能删；`scope-precheck` 保留（后端端点仍在） |
| 5 | `test/sim-init-wizard.test.tsx` | 删 |
| 6 | `src/views/sim/SimReadinessPanel.tsx:173` 注释 | 改（见下） |

**第 6 处是重点**：原注释写「真硬挡在 `SimInitWizard`「进入推演」另一入口，那里按钮才 disabled」。
向导删掉后这句话就成了**过期的诚实缺席声明** —— 本仓已因「注释还在、实现早没了」这个形态判错过多次。
已改成实测为真的措辞，并当场核实了「全应用零个 `disabled` 依赖 `canEnterSimulation`」（§4.5 末）。

**遗留（诚实登记，不静默）**：向导删后 `endpoints.ts:565-567` 的
`SimScopePrecheck` / `fetchSimScopePrecheck` **只剩定义、零生产调用方** ——
即假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的同形（实现有、无生产消费方）。
未删是因为后端端点 `app.ts:1677` 仍在、契约仍有效；**建议下一单裁决：要么给它找回消费方，要么删**。

**侧栏叶项计数**：工单提到「67 → 66」。已核实**前端测试里没有任何叶项计数断言**
（`grep -rn "sim-init|sim-sandbox" apps/frontend-shell/test` 命中 0），故无金值需同步。
若该数字写在某份 PRD/部署文档里，需审核方另行核对（本单未改任何计数类文档）。

---

## 6. 验证

### 6.1 门（显式捕获退出码，无管道）

```
pnpm --filter frontend-shell build   → BUILD_RC=0
vitest run（全套）                    → TEST_RC=0 · Test Files 176 passed · Tests 807 passed
```

### 6.2 接缝驱动门（SEAM-GATE）

`test/sim-scope-local.seam.test.tsx`（6 例）**不 mock `@/api/endpoints`**，
在 MSW 层断言**真实请求 URL**。理由：病灶恰好长在 endpoints 那一跳的 URL 模板里
（`target===undefined` ⇒ 整段不拼）。把该模块整个 mock 掉，桩函数照收 3 个实参、URL 模板根本不参与
⇒ **断言恒绿而缺陷仍在**（咬的是函数，不是链路）。这正是既有 sandbox 测试全绿却盖不住本缺陷的原因。

MSW 桩的 `targetRef` 语义与 `app.ts:1640` 一字对齐（`scope==="LOCAL" ? target : null`），
使「没带 target 的 LOCAL」在桩上也复现出「自称 LOCAL、targetRef 为空」那个病样。

### 6.3 变异反证（两处，均先 commit 再变异，贴失败原文）

**① 撤掉 target 实参**（`reloadCert` 改回 `fetchSimCertification(sessionId, scope)`）：

```
FAIL test/sim-scope-local.seam.test.tsx > 切到 LOCAL：请求 URL **真带 &target=** …
AssertionError: LOCAL 档的请求 URL 必须带 &target=；
  实际=http://a.test/a/v1/sim/sessions/sims_seam/certification?scope=LOCAL
FAIL test/sim-scope-local.seam.test.tsx > 换目标对象类型：URL 里的 target 跟着换（选择器不是摆设）
AssertionError: expected 'http://a.test/a/v1/sim/sessions/sims_…' to contain 'target=TypeA'
 Test Files  1 failed (1)   Tests  2 failed | 4 passed (6)
```

失败原文里直接打印出**病灶 URL 本身**（`?scope=LOCAL` 后面空空如也）—— 这就是病历。

**② 守卫改成恒放行**（`if (false && features && !features.includes("sim.sandbox"))`）：

```
FAIL test/sim-route-guards.test.tsx > sim.sandbox 关 → /v/sim-sandbox 渲染 404（R3 …）
TestingLibraryElementError: Unable to find an element by: [data-testid="page-404"]
 Test Files  1 failed (1)
```

两处变异均已 `git checkout --` 撤回，`git status --porcelain` 空。

---

## 7. 《本体引用与影响》

> 本单**不直接改** `docs/SYSTEM-ONTOLOGY.md`（回写由审核方做）。以下为需回写内容。

### 7.1 触及的对象类型（§2 I 推演沙盘域）

- **SimSession** —— `scope` 字段的**前端写入语义**变了：从恒 `{}` 变为 `{kind, target}`（真范围）。
  引擎读端不变（§7.3）。
- **SimCertification** —— 无契约变更；`targetRef` 字段**从此真的会非空**（此前恒 null，因为 target 从没传过）。

### 7.2 触及的链路（§3）

```
沙盘控制台范围选择
  → SandboxView.certScope/certTarget
    → endpoints.fetchSimCertification(sid, scope, target)
      → GET /a/v1/sim/sessions/:id/certification?scope=&target=
        → app.ts assembleCertification(scopeKind, target)
          → allTypes.filter(t => t.key === target)      ← 本单修复前恒不触发
            → deriveCertification → SimCertification.targetRef
```

**被删除的链路**：`/v/sim-init → SimInitGuard → SimInitWizard → createSimSession(scope) → navigate → 会话丢弃`
（整条退役）。

### 7.3 不变量

| 编号 | 关系 |
|---|---|
| **R-ARG-FIDELITY** | **本单是它的前端半**。既有条文覆盖「路由解析出的过滤实体必达求解器」（后端/编排侧）；本单证明**同一条纪律在前端同样会破**——UI 上的过滤维（scope target）根本没上路。建议在该条下补记「前端半」一句。 |
| R3 | entitlement 先于 authz —— 守卫行为一字未改，但**首次获得测试覆盖**（欠账 #127） |
| R6 | 确定性：新测试零网络零时钟随机（MSW + 注入 config） |
| R13 | 结论可溯源：采纳留痕的 `scopeTarget` 取**后端真回的 `cert.targetRef`**，非前端 state |
| R14 | 零业务常数：target 候选全部来自 `view-config.nodeTypes`（本体派生），代码零行业实体名 |
| R17 | 决策单页：向导退役后沙盘是唯一入口，范围选择就地完成，不跳页 |
| RL9 | additive 可回退：`sim.sandbox` 关 = 入口与路由都不存在（已被新测试咬住） |

### 7.4 断点登记（§8）—— 建议新增两条

**① `G-SIM-SCOPE-LOCAL-DEGRADE`（本单已闭）**

> **形态：「搬了一半的开关」** —— 把 A 屏能力搬到 B 屏时**只搬了枚举开关、没搬它的参数**，
> 于是有一档空转，却照常显示那一档的名字。
>
> 实证：`SandboxView` 的 `certScope` 从初始化向导搬到控制台时，`target` 参数没跟过来
> ⇒ `fetchSimCertification` 只传 2 个实参 ⇒ `endpoints.ts:558` URL 模板不拼 `&target=`
> ⇒ `app.ts:1589` `scopeKind==="LOCAL" && target` 恒 false ⇒ 算全本体
> ⇒ 而 `app.ts:1640` 仍回 `scope:"LOCAL"`。**屏上写「局部」、数字是「全局」**。
> 同族 `G-ARG-DROP-SEAM` / `G-PORTFOLIO-BT-SILENT-ALL`（静默错答比崩溃更危险）。
>
> **加剧因素**：`test/sandbox-p0.test.tsx:199` 原断言 `toHaveBeenCalledWith("sims_main","LOCAL")`
> **把缺陷钉成了期望**；且既有 sandbox 测试全部 `vi.mock("@/api/endpoints")`
> —— 恰好把病灶所在那一跳 mock 掉了（假绿：咬的是函数不是链路）。
>
> → **✅ 已闭**：补齐 target（候选取本体派生 `nodeTypes`·R14）+ 无 target 时**拒绝进入 LOCAL 档**
> （诚实降级，屏上写明）+ 会话/认证两处调用点同修。
> 门 = `apps/frontend-shell/test/sim-scope-local.seam.test.tsx`（真 endpoints + MSW 拦真实 URL），
> 变异反证真红并打印病灶 URL 原文。

**② `G-SIM-SCOPE-UNREAD`（未闭·不归本单）**

> `SimSession.scope` **有写端无读端**：写在 `app.ts:1391`，此后全仓只被读 `snapshotKind` 一个键
> （`:1408`/`:1705` 过滤方案快照·`:1512` 分支整体继承）；tick 路（`:1415` 起）遍历
> `ontologyTypes.list(tenantId)` 全本体，**从不看 `session.scope`**
> ⇒ 用户选的推演范围**不会真的裁剪推演**。
> 属「接了线没数据」之外的第四形态：**接了线、有数据、但没有读端**。
>
> → **◐ 前端侧已加诚实位**（`sandbox-scope-reach-note`：明写「只作用于就绪认证口径，尚未裁剪推演本身」），
> 引擎侧未修（`apps/datacore/**` 越界·非本单）。真闭需 `propagateTick` 的图物化按 `session.scope` 裁剪。

### 7.5 门禁（§7）

- 新增 SEAM 门 `sim-scope-local.seam.test.tsx`（前端包内，随 `pnpm --filter frontend-shell test` 跑）。
- 新增守卫门 `sim-route-guards.test.tsx`（闭欠账 #127；**全仓第一处** `createMemoryRouter` 真路由测试，
  可作为后续路由守卫测试的样板 —— replace 掉「`MemoryRouter` 直 render 组件」那种绕过守卫的写法）。

---

## 8. 遗留 / 未做（诚实清单）

1. **§4.4 的「显式进入推演按钮 + 去掉挂载自动建会话」未做** —— 与 3 个禁改/越界测试文件逻辑互斥，需审核方放权。
2. **`fetchSimScopePrecheck` 成为零生产调用方**（§5 遗留），建议下一单裁决。
3. **`G-SIM-SCOPE-UNREAD` 引擎侧未修**（越界），前端只做到不撒谎。
4. **未真跑服务复核 `canEnterSimulation`**（§4.5），依据为算法 + canonical 端点测试；47/33% 两个数未能复现。
5. **侧栏叶项 67→66** 若写在某份文档里，本单未改（前端测试中无该断言）。
