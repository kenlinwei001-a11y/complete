# PRD · 交付出口治理单源 ——「同一判据同一个值，两条交付路两种结局」的结构性修法

> 建议单号 `WO-EXIT-GOV-SINGLE-SOURCE` · 主包 `apps/agentcore` · 2026-10-03
> 依据：三份独立评估对根因的**一致**裁决（候选 `arm-indexed-disposition`）+ 仓主 2026-10-03 裁决（数字红线两路对齐、收紧须为平台级动作）
> 命名说明：正文一律用平台术语「**原生内核（NATIVE）**」「**外部内核（EXTERNAL）**」指两条交付路；文件名/代码路径保留仓内既有标识，不引入外部产品名。
> 本 PRD 的验收判据一律为**对照实验**形态（改 X ⇒ Y 按可预言方式变化 + 反向金丝雀）。凡写不出这种判据的条目已移入《不做的事》。

---

## 0 · 一句话

**判据已经是单源，处置不是。** 本单把「判据 → 处置」提成**唯一一张表、在唯一一处求值**；两条交付路各自只保留「取证」与「送达」两个通道实现，不再各写一个 action。

---

## 1 · 问题（AS-IS · 只引证据，不复述）

### 1.1 主实测：同一份答案，两条交付路两种结局

同一句排产问话（常州基地产能吃紧 → 要几个排产方案与代价对比）· 同一 agent（role=production）· 同一提示词 · 同一判据 `scanBlocks`，两条路各跑一次（真服务 · 同机 live 部署）：

| | 原生内核（NATIVE） | 外部内核（EXTERNAL） |
|---|---|---|
| 判据值 | `answer.unverifiedNumerics = true` | 同一判据、**同一个值** |
| 处置 | **整份照常交付**（A/B/C 三方案 + 代价对比 + 5 条 provenance + 33 条规则挂载） | **整份拒绝**（`ok:false`），用户只看到一句红线文案 |
| 用户拿到 | 完整多方案比对 | 什么都没有 |

判据同源（`apps/agentcore/src/util/numerics.ts` 的 `scanBlocks`，两路 import 同一实现），值相同，**结局相反**。处置写在哪里：`apps/agentcore/src/engine.ts:865-872`（外部侧采样）与 `:969-975`（原生侧采样）——两处 action 各写一遍，是 2026-10-03 裁决后人工对齐的结果，不是机制保证。

### 1.2 同族三例（窗口内 3 天 3 例，形态相同）

| # | 情形 | 原生内核处置 | 外部内核处置 | 位置 |
|---|---|---|---|---|
| ① | `final_answer` 入参不合 schema | 回注 `tool_result`（`isError`）再跑一轮，**用户看不到错误** | 硬拒 + 英文校验报错**印在用户屏上** | `apps/agentcore/src/agent/loop.ts:1188-1201` ⊗ `apps/agentcore/src/dsh-runtime/reassemble.ts:663-679` + `engine.ts:825` |
| ② | 数字红线 `unverifiedNumerics` | 只记 `would_block`、照常交付 | 2026-10-03 前**无条件硬拦**；现同只记（人工对齐） | `apps/agentcore/src/engine.ts:969-975` ⊗ `:865-872` |
| ③ | 求解器名额预算 | **共用件**：派发前扣费 ⇒ 被求解器服务当场拒绝（400/404）也吃名额（8 个名额里 3 次 ERROR 照扣、合计 23ms、零求解器执行、吃掉 37.5%），拒绝恰好发生在模型正要跑第二个方案做对比时；已修 4xx 退费 | 同左（**同一实例**） | `apps/agentcore/src/tools/executor.ts:217`（扣）`:233`（派发）`:252`（退）· `apps/agentcore/src/tools/budget.ts:87-100` |

**③ 的定性必须说清（不许并进 ①② 的账）**：③ 是**共用件内的扣费时机**缺陷，两条路处置完全相同，不是「两臂分裂」的实例。它进本表有两个用途：(a) 说明三天三例**不是同一个单根因**，本 PRD 只闭合 ①② 这一族；(b) 它是**正面证据**——写在共用件里的东西，改一次两条路同时变（见 §2.3），这正是本 PRD 要在治理面复制的形态。

### 1.3 判别变量是「出口」，不是「内核」

`applyPostChecks` 共享闭包（`apps/agentcore/src/engine.ts:585`，双出口调用点 `:873`/`:978`）只覆盖两段 rule postcheck；schema / 红线 / provenance / writeMode / reflect **各自内联在各自的出口**。同一形态在仓内还有第三、第四处（`apps/agentcore/src/router/execute-plan.ts:102-105` 自写 `scanUnverified`；`apps/agentcore/src/workflow/executor.ts:443-448` 自写扫描 + 自定标签），**本 PRD 不修这两处**（见 §7），但修法必须能容纳它们。

---

## 2 · 根因

### 2.1 形态（铁律 0.6 句式）

> **我用〈两条路共用了 `scanBlocks` / `checkJsonSchema` / `reflectAnswer` / `applyPostChecks` 这些「判据单源」〉当作〈两条路同治理〉的证据，而前者并不度量后者 —— 单源只保证判出来的值一样；判完之后怎么办（回注重试 / 只报不断 / 整份拒绝 / 拼缺口块）写在各自的出口代码里，出口是内核的函数，于是同一个值到用户手里是两个结局。**

### 2.2 「判据单源」的实际射程（逐条点名的实测）

- `applyPostChecks` 闭包体**只有两段** `this.deps.dataCore.rules.evaluate`（skill postcheck + ruleBindings POST_CHECK，`engine.ts:586-644`）；schema / 红线 / 预算处置不在其中。
- `metrics.ts:131` 那句「两条路共用同一个判据、同一个 action、同一阶段」是**注释不是守卫**——上一条 §1.1 的实测就是它与事实的差距。
- 判据本身也有一处**两份拷贝**：`final_answer` 入参 schema 在 `loop.ts:80` 与 `reassemble.ts:142` 各一份（今天逐字节同形，靠人盯）。
- 门/计数各写：`unverifiedNumerics.inc` 只在 `loop.ts:703`/`:1402`（`{path:"AGENT"}`），`apps/agentcore/src/dsh-runtime` 目录零命中。

### 2.3 正面证据：共用件不漂移

`executor`/`budget` 写在共用件里 ⇒ 一改两路同时生效：`engine.ts:569`（建实例）→ `:742-756`（登记给外部臂的反向通道）→ `apps/agentcore/src/server.ts:2334`（反向入口同一实例）；原生臂走同一 `executor`。**单源确实做得到**，只是没做在治理面上。

---

## 3 · 修法：判据-处置单源（TO-BE）

### 3.1 三层切分（每层只有一个归属）

| 层 | 内容 | 归属 | 新文件/落点 |
|---|---|---|---|
| **L1 判据层** | 求值：`final_answer` schema、`expectsSchema`、`provenancePolicy`、`writeMode`、数字红线、reflect、rule postcheck —— 输入是**已取证的事实**（`blocks`/`provenance`/`iterations`），输出是 `GateValue { id, failed, diagnostics[] }` | **单源函数** | 新 `apps/agentcore/src/agent/exit-governance.ts`（纯函数 · R6） |
| **L2 处置层** | 「这个值 + 这个臂的能力 ⇒ 做什么」——**唯一注册表**，每条判据一行两档；产出 `Disposition { action, userBlocks?, auditNote? }` | **单源表** | 同上；闭包落点 = 现 `applyPostChecks` 扩为 `applyExitGovernance(result, caps)`（`engine.ts:585`），两出口仍各自调用（`:873`/`:978`），只是多传一个臂能力声明 |
| **L3 通道层** | 「怎么取证」「怎么送达」 | **臂各自实现**（这是真实差异，不是漂移） | 原生：`loop.ts` 回注 = `messages.push(tool_result)+continue`；外部：`reassemble.ts` 收束后拼块（软收尾/缺口块/诚实头） |

**关键结构变更**：`reassembleDshRun` 今天自己 `return { ok:false, errors:[…] }` 的四处（`reassemble.ts:619` / `:623` / `:682-683` / `:685-686`）改为**只产出事实与诊断**（`ok:true` + `unmet: GateValue[]`），由 L2 决定结局；`loop.ts` 的 `acceptFinalAnswer` 同理：不再自己决定「回注还是放弃」，改为问 L2，拿回 `reinject` 就去执行通道动作。判据与处置**从此不在臂文件里**。

### 3.2 处置表（唯一注册点 · 全档强制）

```ts
// apps/agentcore/src/agent/exit-governance.ts
export type ArmCaps = { reinject: boolean; replanBudget: number };   // 臂只声明能力，不写 action
export type Disposition = { action: "pass"|"reinject"|"annotate"|"soft_close"|"degrade_honest"|"reject";
                            userBlocks?: AnswerBlock[]; auditNote?: string };
export const EXIT_GOVERNANCE: ReadonlyArray<{
  id: GateId; judge: (f: Facts) => GateValue;
  whenReinject:  Disposition | ((c: ArmCaps) => Disposition);  // 有回注通道的那一档
  otherwise:     Disposition | ((c: ArmCaps) => Disposition);  // 收束后不可回注的那一档 —— 缺档即红
}>;
```

- **全档强制**：每条目必须**同时**给出两档处置；`reassemble.ts:649-650` 记录的架构事实（外部臂是子进程收束之后的纯 fold、模型已退出 ⇒ 结构上无法回注）**不是臂代码里的 if，而是这一行的 `otherwise` 档**。
- 两档同形的条目（如数字红线：两档都是 `annotate`）**也必须显式写两次**——将来要收紧，改的是表里那一行一个字段，不是两个文件。
- 表内文案（`userBlocks`）是**用户可见面的唯一出处**；诊断串（`diagnostics`）只喂模型与审计。这是 §1.2① 那类「英文校验报错上屏」的结构性出口。

### 3.3 两条臂各自还留什么

| | 原生内核臂 | 外部内核臂 |
|---|---|---|
| **留** | ① 回注通道实现（`messages.push(tool_result)+continue`）；② 有界重规划的次数控制；③ 取证：provenance 富化查 `repos.toolCalls`（`loop.ts:1375`） | ① 收束后送达（拼块）；② 帧流取证（`toolNameByCallId`、宿主实测 `durationMs`）；③ 能力声明 `reinject:false` + 2.3 登记的结构约束 |
| **不留** | 判据求值 · 处置决策 · 用户文案 | 同左 |
| **共同** | 分叉条件（`agent.kernel`，`engine.ts:656`）· stats/审计回声 · `applyExitGovernance` 调用点（`:873`/`:978`） | 同左 |

### 3.4 「新加一条治理规则时，只写一遍」的机器保证

1. **一个注册点**：新规则 = 表里加一行（判据 + 两档 + 文案同处一行）；臂文件零改动。
2. **缺档即红**：接缝测试遍历 `EXIT_GOVERNANCE`，断言每条目两档非空且 `userBlocks` 非空（缺档 = 有人只给一条路写了处置）。
3. **表驱动可验**：J2（§6）在测试里往表注入一条探针判据，断言**两条路同时**出现该行为；只出现在一条路上即红。
4. **结构约束进表**：外部臂不可回注是被断言的**注册事实**（J5），不是注释。

---

## 4 · 迁移路径（每步独立可验 · 每步不许四包变红）

> 验证面纪律：每步的**步内验证** = `apps/agentcore` 包内定向 vitest + 该包 `build`；**收编验证** = 本仓四包 gate（在收编侧执行）。
> 每一步都必须能单独 revert、单独复验，不允许「一次改动两个变量」。

- **S0 · 基线对齐（前置）**：数字红线「只报不断」的 WIP（`claude/handoff-wo-dsh-redline-parity`，含 `apps/agentcore/test/numeric-redline-parity.seam.test.ts`）先并入或与本单同批。理由：单源化会把**当前实际处置**固化成表里的两档；基线未对齐时固化的是漂移。
- **S1 · 判据层合并（行为零 delta）**：新建 `apps/agentcore/src/agent/exit-governance.ts`；把两份 `FinalAnswerInputSchema` 拷贝合成一处 import；把 `loop.ts:1392-1399` 与 `reassemble.ts:682-686` 的 provenance/writeMode 判据改为调同一 `judgeExitGates()`（返回同一个 `{ok,errors}` 形状）。验证：`dsh-runtime-reassemble.test.ts`、`dsh-e2e-honesty.test.ts`、`numeric-redline-parity.seam.test.ts` §2/§3 全绿且**文案逐字节不变**。
- **S2 · 处置表 + 能力声明（行为零 delta）**：建表，`whenReinject`/`otherwise` **默认取两条路今天各自的实际处置**；两出口改调 `applyExitGovernance(result, caps)`。验证：上述全部用例绿 + 新接缝测试 §1（两路同处置）绿。本步**不改变任何用户可见行为**。
- **S3 · 逐条裁决（唯一允许改行为的步骤 · 一次一条）**：把仍分叉的条目（`expects_schema` / `provenance_required` / `write_mode`）按「收紧必须是平台级动作」的原则逐条定档，每条裁决**必须**配一条 §6 判据。默认值 = 与今天逐字节相同；只在有裁决时改动。
- **S4 · 受众分离 + 结构断言 + 本体回写**：`errors` 通道拆为 `diagnostics`（喂模型/审计）与 `userBlocks`（上屏）；接缝测试补 §5「表全档覆盖」与 J5；回写本体（§5）。

---

## 5 · 《本体引用与影响》（铁律 0 · 必填）

- **对象类型（§2）**：`AgentDefinition`（`kernel` 字段 = 分叉源，`engine.ts:656`）· `SkillDefinition`（治理位 `provenancePolicy`/`writeMode`，经 `skillGovernance` 逐技能回报）· `AgentRunRecord`（iterations/tokens/budgetExhausted，出口后置补丁 `engine.ts:849-864`）· `Answer`/`AnswerBlock`（交付物、`action_draft`/`rule_violation`/`gap` 块类型是治理处置的落点）· `QueryTask`（终态 + `answer` 落盘）。
- **链路（§3）**：**新增一条**——「交付出口治理链路 · 候选答案 → 判据层（单源求值）→ 处置表（全档）→ 臂通道（回注 / 送达）→ `Answer` → 上屏」。关联链路：`engine.ts:656` 分叉 → 两臂 → 双出口（`:873`/`:978`）；§10.4 跨域节点 `sys.orch.query_to_answer`（D7）。
- **事件（§4）**：消费既有 `answer.final`（`apps/agentcore/src/router/orchestrator.ts:2451`）与降级伪 step `step.completed`（`:2443-2450`）；**不新增事件**（D-29 无新增生产者/订阅缺口），事件载荷形状不变。
- **不变量（§5）**：
  - **R-一致（一个事实一个出处）**：本单是该条在**治理面**的延伸——判据值单源、处置单源；先例已在册（R-一致 的「处置推演单源」子注）。
  - **R6 确定性**：表的求值是纯函数，同输入同输出；不含时钟/随机/网络。
  - **R4（写回治理子不变量）**：`writeMode ⇒ 必须有 action_draft` 判据**不放宽**，只换处置落点。
  - **R13 透明可审计**：处置与诊断进审计通道，不再把内部标识串印给用户。
  - **R-UI-4 + `dev-jargon:check`（§7）**：本单把「内部标识串不上屏」从**前端源码面**推广到**运行时生成的答案正文**——今天该门的射程不含后端生成的 markdown。
- **断点（§8）**：
  - 关联 **`G-DSH-DORMANT-UNGUARDED`**（本单不翻休眠 flag，`dsh-dormancy:check` D1–D3 不受影响）· **`G-DSH-GOV-CREDENTIAL`**（已修；处置文案变更不得削弱带外通道身份校验）。
  - **新登记 `G-EXIT-DISPOSITION-DRIFT`**：判据处置按出口各写 ⇒ 同一判据同一个值两种结局（§1.1 实测）。本单闭合，闭合判据 = §6 J1/J2。
  - 编号断点 G-1…G-12（§8 表）与本改动**无交集**（逐条核对，不为凑格式硬挂）。
- **回写要求（不动本体即过期）**：`docs/SYSTEM-ONTOLOGY.md` **§2.H**（AgentDefinition.kernel 与交付出口语义）· **§3**（新增上述链路一条）· **§4 note**（answer.final 载荷语义补注：处置文案单源）· **§5 / R-一致**（处置单源子注）· **§7**（`dev-jargon:check` 射程补注：运行时生成文案在其射程外，由本表补位）· **§8**（`G-EXIT-DISPOSITION-DRIFT` 登记与闭合）。

---

## 6 · 验收判据（对照实验 + 反向金丝雀 · 缺反向金丝雀的条目视为装饰品）

> 全部判据的载体 = `apps/agentcore/test/exit-governance-parity.seam.test.ts`（**接缝测试**，本仓 SEAM-GATE 明文要求；**不是新门、不新增棘轮/基线**）。形态基线沿用现成的 `runNative`/`runDsh` 双跑 helper（`apps/agentcore/test/numeric-redline-parity.seam.test.ts` §1）。

- **J1 · 处置档由表与能力决定（主判据）**
  **把 X 改成 X′**：把表中 `provenance_required` 行的 `otherwise` 档从 `reject` 改为 `honest_degrade`；**Y 必须**：同一份 `provenance=[]` 的产出走外部臂 ⇒ `outcome` 由 `FAILED` 变 `ANSWERED` 且出现【本次回答的已知不足】块；**同时**原生臂对该输入的「回注」行为与最终答案**逐字节不变**（它走 `whenReinject` 档）。
  **反向金丝雀**：只改 `otherwise` 时若原生臂也变了 ⇒ 档位不是由 `caps` 分的，单源不成立，判据作废。
- **J2 · 新规则只写一遍（机器证明）**
  **把 X 改成 X′**：往表注入一条**测试用**探针判据（`__probe__`，只在测试构造的表实例里，不入出厂表），两档都返回带可识别 `userBlocks` 的处置；**Y 必须**：两条路的屏上文本**都**出现该标记。
  **反向金丝雀**：不经表、只在某一臂文件里写同一个 `if` ⇒ **另一条臂必须不出现**该标记（证明 J2 观测到的「同时出现」真由表驱动，而非巧合）。
- **J3 · 受众分离（诊断串 ≠ 用户文案）**
  **把 X 改成 X′**：把某条判据的 `userBlocks` 文案改成一句可识别中文；**Y 必须**：两臂上屏文本**同时**变化，且上屏文本不含 `Skill provenancePolicy=` / `final_answer` / `Invalid input` 这类内部标识串；而原生臂喂给模型的 `tool_result`（不入 `answer.blocks`）**仍含**诊断串。
  **反向金丝雀**：把诊断串直接塞进 `userBlocks` ⇒ 断言必须红（证明断言咬的是通道，不是「文本恰好不同」）。
- **J4 · 判据值单源（保持型 · 必不出现面）**
  **把 X 改成 X′**：对共享的 `FinalAnswerInputSchema` 做一次只加不改的收紧（测试内注入）；**Y 必须**：两条路对同一输入**同时**判失败（今天两份拷贝的任一漂移都会被这条抓住）。
  **反向金丝雀**：让一臂继续用旧 schema 实例 ⇒ 断言必须红。
- **J5 · 架构约束是被断言的注册事实**
  **把 X 改成 X′**：把外部臂 `caps.reinject` 改成 `true`；**Y 必须**：有断言红（该臂的通道实现里没有任何回注通道 —— `reassemble.ts` 全文件零 `await`；否则「不可回注」这个前提在仓里无人守）。
  **反向金丝雀**：`caps.reinject=false` 时，同一条目必须落 `otherwise` 档（两档产出可区分）。
- **J6 · 诚实边界（不许读成「已全覆盖」）**
  断言：表注册的判据集合 **≠** 全部治理判据集合，差额 = ① `workflow/executor.ts` 自写扫描 ② `execute-plan.ts` 自写 `scanUnverified`（两者**本单不修**）。这条判据的作用是让残差**可见**，防止下一个人把本单读成「治理面已单源」。

---

## 7 · 不做的事（刻意的范围边界 · 防扩散）

1. **不翻休眠 flag、不动部署面**（`DSH_HARNESS` 保持缺省关；`dsh-dormancy:check` 三条判据不受影响）。
2. **不收紧数字红线**：不把 `would_block` 变 `blocked`；判据仍是 `scanBlocks`，检测器误报（序号、非业务计数）与「必须有 number→求解器产出绑定」的事实源缺失**不在本单**。
3. **不做修复档的架构改动**：不把严校验下沉进子进程内工具、不改 runner 为多轮 prompt、不给外部臂造回注通道。本单只把「收束后不可回注」写成表的显式降级档（§3.2）。
4. **不新增门 / 棘轮 / 基线 JSON**（仓主冻结令）；只新增接缝测试（SEAM-GATE 明文要求）。
5. **不修第三、第四处置点**（`apps/agentcore/src/workflow/executor.ts:443-448`、`apps/agentcore/src/router/execute-plan.ts:102-105`）——登记为残差（J6），另立单。
6. **不修 ③ 的残余**（`executor.ts:690-693` 退费面只覆盖 4xx；499/5xx/不可达仍扣）——属「取样点/代理量」另一条线，另立单。
7. **不统一两条路的模型行为与答案质量**：那是被测对象（#17 双跑量的就是它），不是不变量。
8. **不改前端**（前端只消费 `answer.final`，本单不改事件/契约形状）。

---

## 8 · 风险与代价（明写这次合并**放弃**什么）

1. **放弃「两条路各自特化处置」的能力。** 今天外部臂能用「软收尾」把格式手滑救回来（`reassemble.ts:663-679`）、原生臂能用回注把错误藏起来；合并后每条判据只有**两档**（有回注 / 无回注），两档都写在表里。**代价**：将来若想让两条路对同一条判据做**不同的、非能力驱动的**处置，得改表并显式登记为「臂特化档」——这正是想要的（可见化），但它确实降低了臂作者的自由度。
2. **新规则的作者成本上升。** 以前是「写一个 `if` 就完事」，现在是「必须同时想清楚无回注通道时怎么办」。这是刻意的：想不清 ⇒ 缺档 ⇒ 测试红。
3. **用户可见信息变少。** 诊断串从屏上撤到审计通道后，用户看到的是成品文案（「技能 X 的治理要求未满足」这类），排障要走 audit。**代价真实**，且会让现有一条金值文案变化（`dsh-e2e-honesty.test.ts:251/:296` 咬住 `dsh 重组装拒绝：…` 前缀），需同批更新。
4. **能力声明可能与真实通道漂移**：`caps.reinject=false` 是被断言的注册事实（J5），但若将来 runner 支持多轮 prompt（修复档落地），必须同时改声明与表；声明与实现的漂移由 J5 挡，但 J5 是测试不是运行时守卫。
5. **单源不消灭「判据本身错」。** 本单只保证「同一个值 ⇒ 同一个结局」；值本身的代理性（红线量的是引用格式而非数字出处）留给第 2 条另立单。
6. **一处改、两路变**：表是共享件 ⇒ 改动影响面变大，这是单源的定义性代价；缓解 = S2 的行为零 delta + S3 一次一条 + 每条配判据。

---

## 9 · 覆盖边界与已知残余（诚实登记）

- **闭合**：交付出口治理（两内核出口）的**处置**单源；`final_answer` schema 两份拷贝合流。
- **未闭合**：第三/第四处置点（§7.5）· 红线检测器的代理性（§7.2）· 预算退费面窄（§7.6）· 外部臂负载下的真实复核（#17 双跑仍是本单收编后的**独立**验证项，不替代本单判据）。
- **未实测面（不许读成已证）**：本 PRD 的判据尚未跑过一枪；引用的 file:line 均为读码核对，行为结论以接缝测试真跑为准（铁律 1.5：跑得起来不度量算得对）。
