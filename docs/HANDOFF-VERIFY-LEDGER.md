# 待复验分支台账（仓主 2026-08-16 交办）

> **这份台账的存在理由**：仓主在 2026-08-16 分两次交办了「已推」与「已安排他人复验」两批分支。
> 这些信息**只存在于对话里**，而对话会被截断、沙箱会重启 —— 写进仓库才不丢。
> 本仓真丢过一整个 dev 的产出（2026-08-06），教训是「没落盘的等于没做过」。
>
> **口径**：本文件只记「谁在复验什么、复验重点是什么、当前定性」。
> **不记**结论 —— 结论必须由复验方亲手跑出来后回写，**别人的转述不算复验**。

---

## 一 · 仓主已推（不再有丢失风险）

| 检查面 | 仓主实测结果 |
|---|---|
| 主 checkout `/Users/apple/deploy/complete` | 干净：`status --porcelain` 空，`@{u}..HEAD` 零提交，就在 canonical 上 |
| 已知历史风险点 `rescue-r13-drillfield-0811` | 当年「12 提交 3397 行零远端」的事故残片，**已在远端** |

### ⚠️ 仓主自己标注的诚实边界（原文照录，不许弱化）

> 这一类只能证明**本机**没有。**其他 agent 本机的未推工作，任何仓库文档和我都看不见 —— 台账天然覆盖不到。**

这句话必须留在台账里。它划定的是**本台账的能力上界**：
本文件能证明「远端有什么」，**不能**证明「没有别处还藏着未推的东西」。
把「台账干净」读成「全仓无丢失」就是又一次「我用 X 当作 Y 的证据，而 X 并不度量 Y」。

---

## 二 · `rescue-r13-drillfield-0811` 已定性（欠账 #96 结案）

**结论：它不带任何集成分支缺失的内容 —— 无丢失。**

远端 tip `f9b0c0ec`（10 个「容器重启防丢快照」autosave 提交）。相对 `origin/claude/verify-reclaim-6`
只有 3 个文件不同，**全部 DIFFER、零 ABSENT**：

| 文件 | 集成分支 | rescue |
|---|---|---|
| `apps/datacore/src/solvers/service.ts` | 5996 行 | 4594 行 |
| `apps/datacore/test/prov-drillfield-truth.test.ts` | 530 行 / 11 个 `it()` | 360 行 / 8 个 `it()` |
| `docs/SYSTEM-ONTOLOGY.md` | 2125 行 | 1115 行 |

### 定性方法（这一段是重点，比结论重要）

第一版差点判错。`diff` 报「rescue 独有行 189 行（service.ts）+ 102 行（测试）」，
**照字面读会得出「有 291 行丢了」这个与事实相反的结论**。

错在**行级 diff 的「独有行」不度量「内容丢失」** —— 一行里改一个字，整行就算独有。
形态照铁律 0.6 句式：**「我用『行级 diff 的独有行数』当作『内容有没有丢』的证据，而前者并不度量后者。」**

改用**符号级**核对后结论当场反转，9 个符号在集成分支**全部命中**：

```
detectChainImpediments   5      chain_impediments   6      quote_margin        8
quarterly_gap            3      decision_play      11      mitigation_select   3
changeover_sequence      3      capex_scenario      8      SOLVER_RULE_REFS    4
金丝雀 __不可能的符号__  0  ⇒ 工具正常，上面的非零命中可信
```

测试文件的 5 个关键断言同样全部命中（`gap_attribution` 20 · `AGGREGATE` 9 ·
`listTypes` 2 · `seg_attain_ess` 4 · `无第三类` 1），且集成分支 `it()` 条数 **11 > 8**
⇒ 集成分支是**严格超集**，rescue 是它的早期形态。

**复验命令**（任何人可重跑）：
```bash
for f in apps/datacore/src/solvers/service.ts apps/datacore/test/prov-drillfield-truth.test.ts; do
  diff <(git show f9b0c0ec:$f) <(git show origin/claude/verify-reclaim-6:$f) | grep '^<'
done   # 行级：会报 291 行「独有」——**这是假信号**
grep -c detectChainImpediments <(git show origin/claude/verify-reclaim-6:apps/datacore/src/solvers/service.ts)
       # 符号级：命中 5 ⇒ 没丢
```

---

## 三 · 仓主已安排他人复验的分支（我不重复跑，只登记）

| 分支 | 内容 | 复验重点 | 来源 |
|---|---|---|---|
| `integ-w3-sandbox` | 沙盘 UI 重设计整合（16 分支超集） | 前端全套 vitest（**载荷 < 8 才许跑**）；`zh.ts` 95 行 `processWait` 词表防丢 | BACKLOG §1 |
| `handoff-wo-databuilder-pipeline` | 数据构建发动机 → 可配置 pipeline | datacore 全套（**重画像，须独占**） | BACKLOG §1 |
| `handoff-wo-befe-seam-prosemask` | `befe-seam` 门散文遮蔽修复 | 门本体 + 5 例自变异 | BACKLOG §1 |
| `handoff-wo-rule-scope-drop` | 规则 scope 静默丢弃 + C10 + 本体回写 | 8 例 seam + 四道本体门 | BACKLOG §1 |
| `handoff-skill-compiler-s1` | 4 提交 1513 行，4 文件 canonical 缺失 | 卡 `server.ts`/contracts 冲突，**需串行并** | STATUS §1.1 |
| `handoff-skill-partial-a` | 3 提交 381 行，1 测试缺失 + 6 DIFFER | 同上卡冲突 | STATUS §1.1 |
| `verify-skill3` | 2 对抗测试 ABSENT + 16 DIFFER | 定性「**待处置不是待并**」：重做或只摘两测试 | STATUS §1.2 |
| 8 条纯文档分支 | `coverage-full` / `skill-migration-scope` / `skill-agent-reconcile` / `metro-prd` / `field-inventory` / `a6-audit` / `a10-audit` / `sandbox-a10` | 无代码风险，内容有价值待收编 | STATUS §1.3 |
| `handoff-wo-dsh-poc-s1` | dsh POC 5 提交（E1–E6 全绿，报告已交） | **等仓主拍板：并 / 灰度 / 废** | 本会话 |
| `rescue-r13-drillfield-0811` | 10 个抢救提交 | 定性有无远端丢失内容（欠账 #96） | BACKLOG §5 |

### ⚠️ 给复验方的三条硬提醒（都是本仓真踩过的坑）

1. **`DIFFER` 不等于「canonical 缺内容」，`ABSENT` 才是**。
   上面 §2 就是活例子：3 个文件全 DIFFER，实际零丢失。
   核对必须落到**符号**，不是行数、不是提交数、不是 `diff` 的独有行数。
2. **`git rev-parse <rev>:<path>` 必须带 `--verify -q`**。
   不带时路径不存在会**把输入串原样打到 stdout**，只看 `-n "$out"` 的脚本会被骗成
   「存在但内容不同」。判据要落在 **RC** 上（git 2.43.0 实测：不带参数 RC=128，带参数 RC=1）。
3. **`tip 不是集成分支的祖先` 不度量「内容没并进来」**。
   历史分支多是 cherry-pick / squash 进正线的，祖先关系天然不成立。
   拿它当判据会把「早已收编」读成「待复验」（实测曾报出 288 条，加时间闸后 4 条）。

### 并发红线（复验方必须遵守）

| 画像 | 例子 | 同时上限 |
|---|---|---|
| **重**（跑 datacore vitest） | `handoff-wo-databuilder-pipeline` | **≤1，且四包 gate 跑着时为 0** |
| **中**（跑 agentcore / frontend vitest） | `integ-w3-sandbox` | 2–3 |
| **轻**（只读 + 写文档 / 门脚本） | 8 条纯文档分支、`befe-seam-prosemask` | 不设限 |

反面教材：曾 6 个 agent **全部**跑 vitest → 4 核机负载 35，自伤。
错的不是「6 个 agent」，是「6 个都是重画像」。

---

## 四 · 状态回写规矩

复验完成后，**由复验方**在对应行追加：
`✅ 已并（集成分支 <sha>）` 或 `❌ 退回（原因 + file:line）` 或 `⏸ 待仓主裁决`。

**不许**在没亲手跑过的情况下填 ✅ —— 本仓的判据是「亲手真跑」，
「绿测试 ≠ 能用」这句戒律正是为这一步存在的。
