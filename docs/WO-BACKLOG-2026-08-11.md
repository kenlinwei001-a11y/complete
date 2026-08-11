# WO 待办清单 · 2026-08-11 交接

> **给派单人**：§0 是**通用前置**，必须**原样贴在每一张单的最前面**再发给 dev。
> 少贴这一段，dev 会在落后上千提交的树上开工、把已实现的读成「不存在」——
> 本会话一天之内骗到过 4 个 dev。
>
> **置信度标记**（每条病灶都带）：
> - ✅ **实测** —— 今天由我或某个 dev 亲手跑出来的，附证据
> - ⚠️ **未复验** —— 我的账，**可能是错的**。今天我的账被 dev 推翻过 4 次，每次都是 dev 对
>
> 看到 ⚠️ 的条目，dev 的**第一步是取证不是动手**。

---

## §0 · 通用前置（必须贴在每张单最前面）

```markdown
## 开工前置（不许跳过）

CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，必须重开"; git checkout -B <本单分支名> $CANON; } \
  || echo "不落后，可原地开工"
pnpm install --prefer-offline
pnpm --filter @platform/contracts build   # 不装会报与本单无关的假红

## 纪律（违反即返工）

- ⛔ **禁止**跑 `bash scripts/gate.sh` / `pnpm -r test` / `pnpm -r build`。
  这是 4 核机器，同时跑 datacore vitest 的上限是 **1**。只跑你改到的那几个测试文件：
  `pnpm --filter <pkg> exec vitest run <你的测试文件>`
- ⛔ 退出码必须 `out=$(cmd 2>&1); rc=$?`。
  **禁止** `cmd | tail -n; echo "EXIT=$?"` —— 管道里 `$?` 取的是 `tail`/`head` 的退出码，恒 0。
  本仓真出现过「RC=0」与「🔴 有问题」同屏打印。
- ⛔ 报**否定结论**（「没有」「零调用方」「死代码」「做不了」）之前：
  1. 先追一层间接调用：re-export / 高阶函数 / 依赖注入 / 字符串键分发 / 事件订阅 / renderer 注册表 —— 这些 grep 一次都看不见；
  2. 跑一个**已知必中**的金丝雀自证工具没坏，并在报告里**给出金丝雀的命中证据**。
     没有金丝雀证据的否定结论 = 无效结论。
- ⛔ 区分**三种「不工作」**，混了必修错地方：

  | 形态 | 判据 | 修法 |
  |---|---|---|
  | 没接线 | 调用方集合里**只有 test** | 接线 |
  | 接了线没数据 | 有 src 调用方，但输入恒空/恒假，分支从未进入 | 补数据或删死分支 |
  | 接了线接错地方 | 有 src 调用方，但挂在错误的路径上 | 补挂载点 |

  **只有 test 引用 = 已排练，不是已实现。**
- ⚠️ **变异落了地 ≠ 变异生效了**。sed/正则没匹配上是常态。改完**读回文件确认差异真的存在**再下结论。
  今天有人据一个根本没发生的变异宣布「门没牙」；另一个人的变异是哑弹（散文里路径后跟中文逗号，
  扫描器没在非 ASCII 处停），差点据此宣布「修法有牙」。
- ⚠️ 改名做变异时，**换成不含原子串的新名**。`foo` → `fooXX` 这种，`toContain("foo")` 照样过。
- ⚠️ 金丝雀**必须与主逻辑共用同一份实现**，不许各抄一份正则。
  抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。
- ⚠️ 诚实位（「金丝雀 N/N 命中」这类计数）**现算，不写死**。
  写死的计数是假绿形态：加了断言而计数不动，屏上照旧「5/5 全中」。
- ⚠️ 用 `ps` 做探针时**必须排除自己这条进程链**（按 PID 剔，不靠字串排除），
  且**别把待搜串放进 `awk -v` 的 argv** —— 那会让 awk 自己的命令行含该串，匹配器匹配到自己。
  两个坑今天都真实中过招。
- ✅ **每完成一个可命名单元立刻 `git commit` + `git push -u origin <本单分支名>`。**
  沙箱定期重启。本仓真丢过一次 dev 的全部产出；另一次 12 个提交 / 3397 行零远端分支，靠磁盘没被清才幸存。
  **push 与「过 gate」是两回事**，推旁支零风险零成本。
- ✅ 仓库约定：`tenant_id` everywhere · 错误信封 `{ error: { code, message, requestId } }` ·
  跨包只依赖 `@platform/contracts`，前端不得重定义契约已有类型 ·
  仓储双实现（新增表要同时改 `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口）·
  凭据一律不回显明文，只回 credentialRef。
- ✅ **派单人写的任何事实若与你实测不符 —— 以你的实测为准，并在报告里顶回来。**
  本会话已被 dev 顶回来 10 次，**每次都是 dev 对**。有一个 dev 推翻了派单人 5 条事实里的 4 条，
  另一个把一条账的三个断言全部推翻。顶回来比照做有价值得多。

## 报告必须包含

1. 病灶复验结果 —— **派单人哪里说错了，直接列出来**
2. 变异反证的**原文输出**（变异后 + 还原后），不是「测试红了」四个字
3. 你跑过的命令与 RC（显式捕获的那种）
4. 分支名 + 最终 commit sha
```

---

## §1 · 已完成、待复验并线的 4 条（这不是新单，是复验任务）

这四条 dev 已交回并推了远端。派给复验人时，**任务是「独立复验 + 并线」，不是重做**。

| 分支 | HEAD | 内容 | 复验重点 |
|---|---|---|---|
| `claude/integ-w3-sandbox` | `111983c1` | 推演沙盘 UI 重设计整合（16 分支 + 沙盘超集 `cd4205d5`） | 前端全套 vitest。typecheck 已验 RC=0/0 错（202 个测试文件在扫描面内） |
| `claude/handoff-wo-databuilder-pipeline` | `25232e9c` | 数据构建发动机改造为可配置 pipeline 工作流 | datacore 全套。出厂默认行为必须逐条不变 |
| `claude/handoff-wo-befe-seam-prosemask` | `3df69500` | befe-seam 门的散文遮蔽修复 | 门本体 + 5 例门自变异 |
| `claude/handoff-wo-rule-scope-drop` | `63d7e9ac` | 规则 scope 静默丢弃 + C10 范畴错误登记 + 本体回写 | `rule-scope-drop.seam` 8 例 + 四道本体门 |

**并线顺序建议**：`integ-w3-sandbox` 先（它是仓主在等的那一屏），其余按 datacore 门的排队来 —— 同时只许 1 个 datacore vitest。

**复验时的已知坑**：
- ✅ 实测：`integ-w3-sandbox` 的 9 处冲突里，`zh.ts` 有一个 hunk 的 `cd4205d5` 侧**是空的** ——
  照 `--theirs` 会静默删掉 95 行 `processWait` 词表。已按并集解，但复验时请确认那 95 行还在。
- ✅ 实测：`cd4205d5` 对沙盘系是 `integ-wave-ui-11` 的**严格超集**（共有 14 条 handoff 分支，
  它另含 `sandbox-declutter` 与 `sandbox-ia-consolidate`）。
- ⚠️ 未复验：`integ-w3-sandbox` 的全套前端测试**从没跑过**（负载一直在 15–23，跑了会撞上
  两条挂墙钟的断言拿到假红）。**跑之前先确认载荷 < 8**：`bash scripts/dispatch-deficit.sh`。

---

## §2 · 被中途叫停的 4 条 WIP（续做单）

这四条是 agent 被叫停瞬间的现场快照，**已推远端但未完成、未验证**。
每条的 commit message 里都写了它缺什么。

> 🔴 **给接手人的硬要求**：**不许因为「已经改了」就当结论成立。**
> 每条都必须**从头补齐该单要求的双向变异反证**再说话。

### WO-A · 门退出码纪律（`claude/handoff-wo-gate-rc2` @ `3e64870b`）

**一句话**：57 道门里，「工具坏了」被报成「你的代码有问题」。

**病灶** ✅ 实测（今天两道**不同**的门独立撞上同一个错）：

本仓门的退出码是三分约定（`docs/SOP-reviewer-claim-discipline.md` §3）：

| RC | 含义 | 允许说什么 |
|---|---|---|
| 0 | 干净 | 可以下结论 |
| 1 | **真有问题** | 先修再说 |
| **2** | **工具自己坏了** | **只许说「我没查出来」，绝不许说「它不存在 / 代码干净」** |

实测两例：
1. `check-ui-first-layer.mjs` 缺 `node_modules` 时 `require("typescript")` 抛未捕获异常
   ⇒ node 默认退出码 **1** ⇒ `gate.sh` 读作「UI 第一层超标」，真相是「我根本没扫描」。
   修它时又查出**另外 4 条**环境路径也走 1（基线非法 JSON / 基线缺 `files` 字段 / `--rev` 打错 / `--explain` 缺参）。
2. `check-backend-frontend-seam.mjs` 某变异下崩出裸 `TypeError` ⇒ RC=1 ⇒ 被读成「你的代码有接缝缺口」。**方向正好相反。**

形态：**「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」**

**现状数字** ✅ 实测（用 node 扫，**不要用 `grep -E`** —— 它是行式的，`[\s\S]*` 跨行模式永远不匹配，
派单人第一次就是这么把数字量成 `0/57` 的，金丝雀当场抖出来）：

- 门脚本 **57** 个 · 有 `exit(2)` 路径 **11** · 有 `exit(2)` **且**顶层兜底 **2** · 连 `exit(2)` 都没有 **46**

**已有的样板**：`scripts/check-ui-first-layer.mjs` 的 `toolBroken()` + 顶层 try/catch，照抄。

**这条 WIP 缺什么**（commit message 里也写了）：
- 🔴 **没做「真违规仍 RC=1」的反向验证**。缺了它，这批改动可能把门变成**永远不红** —— 比原来的假红更坏
- 没建守门的 `check-gate-exit-discipline.mjs`
- 没登门账、没接 gates 链
- `package.json` 与两个 `prd-*-index.json` 的改动来历不明，需逐条复核

**要点**：
- 别只给已知失败路径补 catch —— 「已知失败路径」永远不完整。**改默认失败方向**：
  统一出口 `toolBroken(why)` + 顶层兜底，让 **RC=1 只剩主判据一条路径**
- 范围裁剪自己定，但**按「这道门崩了会被误读成什么」排序**：接在 gates 链/`gate.sh` 上的优先、
  读 `dist/` 或外部依赖的优先、结论是**否定命题**的优先（误读代价最大）
- **改不完的必须在报告里列出来并说明为什么不改**。静默截断会让报告读起来像全覆盖

**门账登记要求**（新门必须同批登，否则天然免疫治理）：
`guardedPaths` 要能**真解析**（双星 `**` glob 会被判「指向空气」）；
`binding: GATES_CHAIN` 就得在 `package.json` 的 `gates` 链里**直呼脚本**
（别用 `pnpm xxx:check` 这层间接，门账探测器看不见）。参照 `check-css-token-defined.mjs` 那条。

---

### WO-B · 第一层信息降层 top3（`claude/handoff-wo-ui-declutter-top3` @ `9bb4f1d1`）

**一句话**：全仓第一层堆了 4260 块信息，可折叠的只有 11.3% —— 近九成一层到底。

**病灶** ✅ 实测（`docs/AUDIT-ui-first-layer-density.md`，95 个页面文件普查）：

| 文件 | 第一层块 | 口径公式 | 长说明 | 字号级 | 可折叠 | 原生 title |
|---|---|---|---|---|---|---|
| `views/RiskBoardView.tsx` | **227**（全仓最高） | 4 | 17 | **14** | 27 | 6 |
| `pages/admin/DataBuilderPage.tsx` | 189 | 0 | 21 | 7 | 29 | 16 |
| `views/DashboardView.tsx` | 137 | 0 | 6 | 10 | 5 | 4 |

最刺眼的一条：`RiskBoardView.tsx:1355` 第一层**直接渲染口径公式**
`为什么推荐？综合评分 = 见效 × 紧迫度 ÷（投入档 × 周期）——比对如下（评分降序）`。

**范围边界**：只碰上面三个文件（及各自 `.module.css`）。
⛔ **绝对不碰 `apps/frontend-shell/src/views/sim/**`** —— 沙盘那一屏在 `integ-w3-sandbox` 里，碰了必冲突。

**🔴 唯一红线：允许降到浮层，绝不允许删除。**
门里的 **D4 守恒判据**守的就是这个，两个方向都会红：
- 拆掉浮层、内容搬回第一层 ⇒ `【D4 守恒·浮层被拆】`
- **纯删除信息** ⇒ `【D4 守恒·内容变少】`
  ⚠️ 后者尤其要记住：**只看第一层计数，删除恰好"看起来像变好了"**。227→180 既可能是降层做对了，也可能是把信息删了。

**原生 `title=` 不算浮层**：不可控样式、移动端不可达，且本仓出过 SVG `<title>` 遮挡事故。要降层就用真浮层组件。

**验收**：
1. `node scripts/check-ui-first-layer.mjs` RC=0，且三个文件**第一层读数都降、第二层读数都升**
   （两个同时成立才是降层，只降不升就是删除）
2. `node scripts/check-ui-first-layer.mjs --selftest` RC=0
3. `node scripts/check-css-token-defined.mjs` RC=0
   —— ⚠️ 新增颜色必须走 `tokens.css` 真令牌。写 `var(--text)` 而真名是 `--txt` 时，
   `var()` 替换失败 ⇒ `fill`/`color` 是**可继承**属性 ⇒ 回落 `inherit` ⇒ 一路继承到根 = **纯黑**。
   控制台一声不吭、测试全绿、屏上全黑。本周实测 14 个这种幽灵令牌
4. 收工用 `--update` 更新棘轮基线，报告里贴基线 diff 原文
5. 咬这三个页面的既有测试仍绿 —— 先 `grep -rl RiskBoardView apps/frontend-shell/test` 把它们都找出来，
   **别只跑一个文件就宣布「测试全绿」**

---

### WO-C · 事实锁锚点普查（`claude/handoff-wo-factlock-anchor` @ `e56841f4`）

**一句话**：会因一次无害重构而红的门，只会训练人把门删掉。

**病灶** ✅ 实测（今天真实发生）：

`apps/frontend-shell/test/stale-claims.seam.test.ts` §3 原先写死：

```ts
const app = readRepo("apps/datacore/src/app.ts");
expect(app).toContain("buildCadenceGates");
expect(app).toContain('listByType(c.tenantId, "Cadence")');
```

集成分支把这段装配从 `app.ts` 抽到了 `apps/datacore/src/sim/propagation-inputs.ts:88-89`
（`app.ts` 还留了注释说明「刻意不在本文件 import」）——**能力一行没少，纯粹搬了个家**。
于是同一次重构里，这一条 `it` 同时产出两个**方向相反**的错误信号：

| 断言 | 结果 | 为什么 |
|---|---|---|
| `listByType(…, "Cadence")` | **假红** | 事实还在，只是锚点搬走了 |
| `buildCadenceGates` | **假绿** | 它命中的是 `app.ts` 里那句**注释**和 **import 行**，不是调用点。真调用搬走了，断言一声不吭 |

形态：**「我用『某串在 app.ts 里』当作『tick 仍在读回 Cadence』的证据，而前者并不度量后者。」**

**修法样板**（已并 canonical `e639a6c2`，照着读）：
1. 扫整棵源码树，不写死单个文件
2. 剥注释 —— 注释里提一嘴不算「代码里有」
3. 排除声明式：`/(?<!function\s)\bbuildCadenceGates\s*\(/` ——
   光有 `export function foo(` 是「没接线」不是「在调用」；import 行没有紧跟括号，天然不算
4. 两条金丝雀与主逻辑共用同一份实现：①已知必中的串必须命中；②只在注释里出现的合成串必须**不**中

**要做**：
1. **普查**全仓还有多少条事实锁锚在位置上。判据（命中任一即嫌疑）：
   - 断言里 `readFileSync`/`readRepo` 参数是**写死的单个源码路径**，随后 `toContain` 一个符号名
   - 用 `expect(<某文件内容>).toContain("<函数名>")` 证明「某能力还在」
   - 失败文案说的是**能力**（「不再读回」「零消费方」），而判据只覆盖**一个文件**

   ⚠️ **「位置就是事实本身」是合法的**，别一刀切：比如「`gate.sh` 里必须挂着某道门」——
   那个事实本来就是「在这个文件里」，锚对了。要咬的是**事实与位置无关却锚了位置**的那些。

   ⚠️ 报「零命中」前先跑金丝雀：拿 `git show e639a6c2^:apps/frontend-shell/test/stale-claims.seam.test.ts`
   的旧写法当已知必中样例。咬不中 ⇒ 报「工具坏了」，**不许**报「全仓没有同病」。

2. **修**：按样板改。每条都要**双向**变异反证 ——
   制造「事实还在但搬了家」⇒ 新写法**不红**；制造「事实真没了」⇒ 新写法**红**。
   只做一个方向会把门改成永不红。

3. **建门** `scripts/check-factlock-anchor.mjs`，守「不许再新增位置锚」。棘轮基线 + 三分退出码 + 共用实现的金丝雀。

**范围边界**：只碰 `apps/*/test/**` · `scripts/` · `docs/`。
**不碰任何 `src/` 生产代码** —— 若发现某条事实锁红了是因为生产代码真有问题，**停手写报告**。

---

### WO-D · A6 竞争规则（`claude/handoff-wo-a6-contention` @ `14e5963d`）

⚠️ **未复验** —— 这条我手上没有 dev 的完整交回报告（被叫停在写引擎 `basis` 消费方与测试的中途）。
接手人请先 `git log` + `git diff origin/claude/inspiring-gates-aqczjg...HEAD` 读懂它做到哪，
再决定继续还是重来。**别信我对这条的任何描述。**

---

## §3 · 新单（今天查出来、还没派的）

### WO-E · 本体门的发射端抽取器只认字符串字面量 🔴

✅ **实测**（由做规则 scope 那单的 dev 发现并给了证据）

`scripts/check-system-ontology.mjs` 抽取发射端的正则是 `outbox\.emit\(…,\s*"<字面量>"`。
**事件名来自变量或常量的 emit 对它完全不可见**：既不计入「真 emit N 个」，
也永远撞不上「§4 未登记」的棘轮。

**实测证据**：dev 新增 `rule.scope_unresolved`（常量引用）后，该数字**纹丝不动停在 22**。

落在盲区里的至少三条：`rule.alert` / `calibration.required`（事件名是三元表达式算出的变量）/ `rule.scope_unresolved`。
**这三条是人工登记进 §4 的，不是门逼出来的。**

形态是该门自己注释里就记着的病的**第三次**：
**「我用『字面量 emit 的条数』当作『真发事件数』的证据，而前者并不度量后者。」**

**要做**：让抽取器认得常量/变量命名的 emit（至少：同文件内常量的字面量求值 + 引用追踪）。
必须有金丝雀钉死这三条已知盲区样例。
改完 §4 事件表的「真 emit N 个」这个数会跳 —— 那个跳幅本身就是本单的证据，请贴出来。

**范围**：`scripts/check-system-ontology.mjs` + 它的基线 + `docs/SYSTEM-ONTOLOGY.md` §4 诚实边界那段。

---

### WO-F · `changeoverMin` 三处键名写错（改名不足以复活）

✅ **实测**（同一个 dev 查的，他在自己的范围边界外没动，交回来给别人做）

- 真名是 **`minutes`**（`apps/datacore/src/synthetic/battery-extended.ts:152`）
- 三个写错的点：`packages/contracts/src/capacity-factors.ts:71` ·
  `apps/datacore/src/solvers/lever-meta.ts:29` · `apps/datacore/src/solvers/service.ts:366`
- ⚠️ **失效机制不是 `?? 0` 兜底算 0**（我原来的假设，是错的），
  是 `apps/datacore/src/solvers/service.ts:903` 的 `typeof o.props[b.prop] === "number"` **过滤** ——
  对象全被剔掉 ⇒ 杠杆**恒不出现**
- 🔴 **改名单独不足以复活**：`capacity.ts` 全文 **0 次** `ChangeoverMatrix`，
  `patchCapacityContext` 的 switch 不认它 ⇒ override 会被静默丢弃。
  `lever-binding-drift.test.ts` 已具名棘轮记账，但注释漏了最上游这一环

**判据**：改完后杠杆要**真的出现并且拨动它真的改推演结果**，不是「字段名对上了」。
必须有一条驱动接缝的测试：改这个值 ⇒ 推演输出跟着变。

**另注** ✅：`Order.changeoverMin`（C22）**没写错** —— 那是求解器注入命名空间，
`chain-impediment.ts:136` 已诚实标注。**别顺手改它。**

---

### WO-G · checkpoints 路由缺口 + 它会引爆的那颗哑弹（两件事必须一个人一起做）

✅ **实测**（两个 dev 各查到一半，合起来才是全貌）

**半边 A**（欠账 #157）：`listCheckpoints` 三处实现俱在（`repo.ts` 接口 / `memory.ts` / `pg.ts`），
但 24 条 `/a/v1/sim/*` 路由里**没有 `GET .../checkpoints`**。病根在 route 层，不在前端。

**半边 B**（今天新查到）：`apps/frontend-shell/src/store/eventInvalidation.ts:93` 的
`SIM_EVENT_GAPS` 里有一句**中文散文**写着
「解法：开 GET /a/v1/sim/sessions/:id/checkpoints → 前端加 checkpoints useQuery」。

`check-backend-frontend-seam.mjs` 的路由抽取器从**字符串字面量**里切 URL，
会把这句散文读成「前端在调这条路由」。

今天遮蔽半径 = **0**（后端还没开那条路由，所以撞不上）。
**但这是一把上了膛没击发的枪**：谁哪天真开了那条路由，门**第一天**就会认为前端已经在调它 ——
于是「后端开了、前端零调用方」这个真缺口**出生即豁免**。

**所以两件事必须一个人一起做**：开路由的那一刻，就得同时处理那句散文
（新门已经会点名报出它：`其中 1 条无任何真 URL 串佐证`）。

拆成两个人做，第二个人会看到一道绿门和一个不存在的缺口。

---

### WO-H · 求解器 scope 诚实位的前端消费（`claude/handoff-wo-solver-scope-fe` @ `7b52d4f2`）

这条 dev 已推 4 个提交且工作区干净，但**我没拿到交回报告**（叫停时它正在跑全套复验）。

⚠️ **未复验**：我原来的账是「三个求解器的 scope 诚实位后端已下发，前端零消费方」。
但欠账 #116 说的是「20 卡里仅 3+1 真按实参重算」——**两个数对不上**，说明我至少有一处记错。

**接手人第一步**：读那 4 个提交做了什么，再决定还缺什么。**别信我说的「三个」这个数字。**

---

## §4 · 派单节奏（这台机器的真实约束）

**别数 agent，数 vitest。**「6 个 agent」不是问题，「6 个都在跑 datacore vitest」才是。

| 画像 | 上限 |
|---|---|
| 重（datacore vitest） | **≤ 1**，且自己要起组合门时为 **0** |
| 中（agentcore / frontend vitest） | 2–3 |
| 轻（脚本 / 文档 / 只读调查） | 不设限 |

派单前后都跑一次：

```bash
bash scripts/dispatch-deficit.sh <待派单数>
# RC=0 均衡 / RC=1 失衡（欠派或超派）/ RC=2 工具自己坏了（不许据此说「调度正常」）
```

今天的教训 ✅ 实测：8 个 agent → **16 个 vitest 进程 / 载荷 23**，
把自己要跑的集成门挤到跑不动，且此时跑测试会撞上两条挂墙钟的断言拿到**假红**
（欠账 #141）——然后去查一个不存在的回归。

---

## §5 · 抢救出来的、需要有人定性的

`claude/rescue-r13-drillfield-0811` @ `f9b0c0ec`

- 有 **10 个提交从没推过**，是 08-06 的容器重启自动快照
- 远端 `claude/handoff-wo-r13-drillfield` 已经分叉，我**没有强推覆盖任何东西**，另开了抢救分支
- ✅ 实测：本地独有 3 个文件与远端**内容不同**：
  `apps/datacore/src/solvers/service.ts` · `apps/datacore/test/prov-drillfield-truth.test.ts` · `docs/SYSTEM-ONTOLOGY.md`

需要有人判：这 10 个提交里有没有远端丢失的东西（对应欠账 #96
「R13 溯源口径错标：`drillField:"value"` 回的却是 `orderVal`，差 1e4」）。
