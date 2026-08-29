# 本批并线复验记录（审核方亲手，非采信 dev 自证）

## 头号判据（CLAUDE.md LOOP 纪律②）
接缝驱动通 + 四包全绿 + **亲手真跑**。以下每条都是我自己跑出来的，dev 的变异反证只作参考不作证据。

## 我亲手复验的四条

**① 单源门是真修好还是被绕过去**
- 门绿：`chain-node-singlesource:check` RC=0（注册表 24 节点 · 扫 193 文件 · 类型锚自检 4 正/6 反 · C 豁免命中 12 处/1 文件）
- **我自己造真手抄**（裸数组 4 个在册 id）→ RC=1，报 `__reviewer_probe__.ts:2 [C·抄表] … 4 个在册 nodeId`
- **我自己伪造类型锚白嫖**（本地 `type RegisteredChainNodeId = string`）→ **仍 RC=1**
- 撤掉探针 → RC=0，`git status --porcelain` 空
⇒ 门仍有牙，豁免不可伪造。判定：修的是门不是代码（`chainNodeSemantics.ts` 剥注释后 diff 为空，我核过）。

**② 拨杆那单的病因判定**
`Equipment.oee_current` **不是幽灵属性**：`battery.ts:3623` 由 A×P×Q 真算落库、`:954` Schema 注册、`:2628` 时序物化。真缺口是缺登记。
`factorPropKeys` 零调用方：`grep -rl` 分别扫 `apps/*/src packages/*/src`、`scripts/`、`apps/*/test` 三处全空；**金丝雀** `normalizeBaseRef` 同一命令命中 3 个 src 文件 ⇒ 工具无误。

**③ 红线闸 `checkProvisionalHonesty` 的死法**
比符号级更强的证法：全文扫 `provisional-honesty` 于 src+scripts，命中的**只有它自己那行文件头注释** ⇒ 连目录内都没人 import。
对照：同目录 `service.ts` 有 21 个外部 importer ⇒ 目录是活的，不是整块死代码。
（首版 importer 统计的金丝雀 `solvers/scope` 报 0 → 方法坏了，改认 ESM `./x.js` 写法后重做。）

**④ 悬空引用检测器自己的假绿**
门报「悬空 0」，实为 1（`G-LEVER-BINDING-DRIFT`）。病灶：正则 `(?:闭合?|关闭)\s*(?:§\s*8\s*)?(?=G-)` 的先行断言要求紧接 `G-`，而本仓惯例把断点名写进**反引号** ⇒ 5 处声明门完全看不见。
（我自己的复核脚本也有坑：120 字符窗口把 `G-NO-FREIGHT-COST` 截成 `-CO` 误报了一个悬空，验原文才排除。）

## 我今天判错并已更正的
1. 把一个 gate **子进程**（ppid = 我自己的 gate）误报成「别的 agent 违规起的」。
2. 拿「demo 准备度 47 / 完整度 33」当「不做硬挡」的理由 —— canonical `sim-certification.test.ts:184` 用 `seedBattery` + 真端点断言的正是 `canEnterSimulation === true`。结论保留，理由作废。
3. 报「沙盘 LOCAL 只有一处调用点漏传 target」—— 实为两处（首建 + `reloadCert`）。

## 工具自证四次抓错（无金丝雀的扫描结论一律不可信）
| # | 工具 | 症状 | 若信了会得出 |
|---|---|---|---|
| 1 | `git grep -- "apps/*/src"` | pathspec 的 `*` 不跨 `/`，恒 0 命中 | 「全仓都是死代码」 |
| 2 | import 图解析器 | 不认 ESM `./x.js` 说明符，barrel 边全丢 | 「contracts 整包是死代码」 |
| 3 | `BUILTIN_VIEWS` 抽取 | 抽出 0 条，且 grep 的是停在旧分支的主工作目录 | 「6 个专用 route 后端全不下发」（结论方向对但证据是假的） |
| 4 | 悬空复核脚本 | 120 字符窗口截断符号名 | 「多一个悬空引用」 |

## 环境性假红（不是代码红，别当回归）
- 首轮 gate：新 worktree 未 `pnpm install`，BUILD/TEST 两个 ❌ 证明的是「这个目录没装依赖」。
- 两个 dev 各报一条 datacore 红：`empty-tenant-bootstrap`（180s 超时，实测 247s）与 `livedin`（hook 300s 超时），均为**并发三方争抢 4 核**所致，原文是 timeout 不是断言失败，且各自给了不归因证据。判据：隔离重跑必须绿，且同一次运行里其余用例全绿，两条都成立才算通过。
