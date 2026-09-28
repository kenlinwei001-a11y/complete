# WO-CONSOLE-COPY 复验（2026-09-28）

**判定：通过。** 复验对象 = `cdc85e69c7be359a0149d2a5f22445b757011854`（正线 `claude/inspiring-gates-aqczjg` tip）。

> ⚠️ **诚实边界先说**：本轮**没有独立的第三方复验方**。原计划派子 agent（`Agent` 工具），
> 但本机环境变量 `CLAUDE_CODE_SUBAGENT_MODEL=kimi-k2.7-code[1M]` 覆盖了子 agent 的模型选择，
> 而端点 `api.deepseek.com/anthropic` 只认 `deepseek-flash` / `deepseek-v4-pro`
> ⇒ 任何子 agent 在发出第一个请求前即 400（显式传 `model: fable` / `haiku` 各试一次，均被该变量盖掉）。
> 仓主指示「不派子 agent 也可以，你自己直接干」⇒ **本复验是自验**，因此**没有**「实现方视角之外」这一层保证。
> 补偿手段是下面 §3 的**变异反证**：判据自己会红，才算它度量了东西。

## 1. 判据与读数（判据落在**渲染结果**上，禁源码 grep 自证）

| # | 判据 | 读数 | 证据 |
|---|---|---|---|
| 0 | 工作树 == 交付 commit（6 个源文件逐字节） | 6/6 **相同**（blob 哈希） | `01-tree-equals-commit.txt` |
| C0 | 金丝雀（扫法能命中确定存在的串） | `hasDuShu / hasNote` = true | `02-verify-probe.txt` |
| C1 | 表结构：三列表头 + 行数 ≥5 + 每行 3 格 | 表头 `["读数","随本次事件","它在回答什么"]`、5 行 | 同上 |
| C2 | 第二列**逐行**与模型 `consumesEvents` 对齐 | 5/5 对齐（背景 3 / 随事件 2） | 同上 |
| C3 | 每行「它在回答什么」非空 | 5/5 非空 | 同上 |
| C4 | 标题计数自洽 N = X + Y | `5 = 3 + 2` | 同上 |
| C5 | R-UI-3 口径默认可见（无折叠壳） | note 内 `details/summary/aria-expanded=false` = **0** | 同上 |
| C6 | R-UI-4 渲染正文无开发话 | 9 类禁项全 false（seed/端点/curl/pnpm/仓库路径/契约类型名/工单号/世界类词/字面星号） | 同上 |
| C7 | 契约 hint 原样上屏、旧措辞不残留 | 新措辞在屏 = true；「砍掉三成」「百分之多少」= false | 同上 |
| C8 | E6 一屏尺子 | ratio = 1.00 ≤ 1.15 | 同上 |
| C9 | 真后端自证 | 命中 2xx/3xx 打向 4031 | 同上 |
| — | 单测 | **29/29** RC=0 | `07-model-test.txt` |
| — | 前端 build | RC=0（`../03-build.txt`，与工作树逐字节相同的文件） | `../03-build.txt` |

复验用的**独立栈**：datacore `PORT=4031 SEED_DEMO=1`（主工作树 dist，本 commit 未改 datacore，见判据 0.2）+ 前端 `vite dev` 5175。
探针 = `verify-probe.mjs`（**与交付自带的 `test/e2e/console-copy-verify.mjs` 不同源**：自读模型源码逐行配对、自读契约源码抽 hint、自定禁项表）。

## 2. 复验过程里我自己的两个量法错误（记下来，防下次）

1. **C4 正则多转义一层**：文件里写成 `/(\\d+)/g`（在 JS 字面量里等价于「反斜杠+d」）⇒ 计数解析出空数组，
   报了一次**假红**。标题行本身一直是对的（`5 个读数 —— 3 个…，2 个…`）。
2. **C7 读取时刻错**：hint 必须在**订单取消卡片还开着的时候**读；跑到第 ⑤ 步时表单已换成物料价格变动，
   屏上当然找不到 ⇒ 又一次假红。
   两次都不是产品缺陷 —— 修的是量法，不是代码。记录在案，因为「工具坏了」和「代码脏了」在屏上长得一样。

## 3. 变异反证（判据有没有牙）

| 变异 | 注入 | 期望 | 实测 |
|---|---|---|---|
| A | `DecisionConsoleView.tsx`：口径表 → 同样措辞的散文 div | 结构类判据必须红 | **VERIFY_FAIL**：C0/C1/C2/C4 红（`03-mutation-A.txt`，RC=1） |
| B | `decisionConsoleModel.ts`：标题里塞 `seed 42 · POST /a/v1/sim/sessions/:id/drill` | R-UI-4 必须红 | **VERIFY_FAIL**：C6 红（`seed:true, endpoint:true`）（`04-mutation-B.txt`，RC=1） |
| — | 还原（cp 备份回写 + 6 文件哈希复核） | 必须回到绿 | **VERIFY_PASS** 10/10（`05-restored-green.txt`）＋ 6/6 哈希相同（`06-restore-hashes.txt`） |

三个读数齐：**变异前绿（02/05）· 变异后红（03/04）· 还原后绿（05）**。
（变异 B 的「变异前绿」是哈希论证：注入 B 之前工作树与 commit 逐字节相同，而 02 与 05 都是在那个字节上跑绿的。）

## 4. 本轮**没能**验的（诚实边界）

- **没有独立第三方**（见文首）——自验只能证「判据成立」，不能证「实现方没想到的坑不存在」。
- **后端半未独立重建**：用的 datacore 是主工作树 dist 起的实例。该 commit 未改 datacore（`git show --stat cdc85e69c -- apps/datacore` 为空），
  且它消费的契约 hint 已在**渲染层**验到原文一致（C7）——但「后端另起一套 dist 复跑」这件事**没做**。
- **未跑四包全量**：datacore 全量 vitest 有意跳过（本单未碰 datacore，且本机有别人的重画像在跑）。
- **未验生产 build 的运行时行为**：只验了 build 通过 + dev 渲染。
- **「不专业」是主观判断**：本复验只证「结构化成表 / 无开发话 / 术语通俗」这三条**可度量**的判据成立，
  ⛔ 不度量仓主的主观满意。
- 本模块之外（左导航「组织世界」、`views/sim/` 其它各处的「世界」类词）**未验、未改**，属禁令 2 范围。
