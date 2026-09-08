# 【每张 WO 必须原样带的抬头】代码在哪 · 从哪开分支 · 推到哪

> 仓主 2026-08-17 定：**每张 WO 都要写清楚代码放在哪个地址，避免每次都反复。**
> 以下整块**照抄进每一张派单的最前面**，一个字都不许省。

---

## 📍 代码地址（唯一，别去别处找）

```
仓库    https://github.com/kenlinwei001-a11y/complete
远端名  origin
```

**三条线，作用完全不同，别混：**

| 线 | 分支全名 | 它是什么 | 你和它的关系 |
|---|---|---|---|
| **集成线** | `claude/verify-reclaim-6` | **当前唯一的开工基线**，审核方在这条线上收编所有 WO | **← 从这条开分支，rebase 也回这条** |
| canonical | `claude/inspiring-gates-aqczjg` | 仓主指定的正线，集成线过完门链后并进来 | 你**不碰** |
| main | `main` | **陈旧的历史起点，落后集成线 2417 个提交** | ⛔ **绝对不要从它开分支** |

⚠️ **`main` 是个陷阱，已经真的坑过人**：2026-08-17 有一条交单分支从 `main` 开出，
六项证据 + 一轮「独立复验 PASS」全部走完，才发现基线差 2417 个提交 ——
凡是相对基线得出的结论（「某文件零 diff」「某常量未增」「某红是既存的」「只改了 N 行」）
**全部失效**，因为它们度量的是另一棵树。
最硬的实例：`KNOWN_EVENTS` 在 `main` 上 9 名、在集成线上 10 名（多 `coordinator.planned`）——
不在这张表里的 SSE 具名事件 EventSource **不订阅、整条丢**，而它的测试 18/18 全绿。

---

## 🔧 开工前置（原样跑，不许跳）

```bash
# ① 拿到代码（已有克隆就跳过 clone）
git clone https://github.com/kenlinwei001-a11y/complete && cd complete

# ② 判断当前树对不对 —— 判据是**祖先关系**，不是「某个文件在不在」
CANON=origin/claude/verify-reclaim-6
git fetch origin
git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是集成线的祖先 ⇒ 落后，必须重开"; git checkout -B <本单分支名> $CANON; } \
  || echo "HEAD 不落后于集成线，可原地开工"

# ③ 机器复核基线（不许只看上面那句 echo）
node scripts/check-branch-base.mjs HEAD
#   RC=0 基线够新 · RC=1 太老要 rebase · RC=2 工具坏了（不许读作「没问题」）

# ④ 先推空提交占住分支，再开工
git commit --allow-empty -m "<本单编号> 占位"
git push -u origin HEAD:claude/handoff-<本单编号小写>

# ⑤ 环境（worktree 常缺，不装会报与本单无关的假红）
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
```

⚠️ **判据是祖先关系不是文件存在性** —— 本仓曾用「某文件在不在」判断分支新旧，
**一天之内骗到 4 个 dev**，其中一个在落后 1310 个提交的树上开了工，
把已实现的东西读成「不存在」，得出与事实相反的结论。

⚠️ **不装依赖会报 `Failed to resolve entry for package "@platform/contracts"`** ——
这是**环境假红**，与你的改动无关，极易被误判成契约包坏了。

---

## 📤 交单时推到哪

```bash
git push -u origin HEAD:claude/handoff-<本单编号小写>
```

- **每张 WO = 一条 `claude/handoff-*` 分支。你不碰集成线，更不碰 canonical。**
- **push 与「过 gate」是两件事**：推 handoff 分支**零风险零成本**，任何时候都该立刻做；
  只有「并进正线」才需要 gate 和审核方裁决。
  ⛔ **不许因为「等 merge 落定」而不 push** —— 容器是整台回收的，
  `.git` 不随 `/tmp` 清理消失**但随容器一起没**。真正的分界是**本地-vs-远端**，不是 tmp-vs-.git。
  本仓已因此真的丢过一个 dev 的**全部**产出。
- **每完成一个可命名单元就 commit + push**，不要攒到最后一次推。

---

## 🧭 上游变了怎么办

集成线每天都在动。开工中途若要同步：

```bash
git fetch origin && git rebase origin/claude/verify-reclaim-6
node scripts/check-branch-base.mjs HEAD          # 复核
git push --force-with-lease -u origin HEAD:claude/handoff-<本单编号小写>   # 别用 --force
```

⚠️ rebase 起冲突时**不许逐块取 theirs 图快** —— 本仓真发生过逐块取 theirs
把别人的函数定义删掉、造成 `ReferenceError`。同一文件被整体重写时**整文件取一侧**再手工合。
解完必须自查零残留：

```bash
node scripts/check-merge-conflict-markers.mjs    # RC=0 才算解干净
```

（正线上真的活过两个带未解冲突标记的文件，其中一个把一张 12 行的表在解析器眼里截成 4 行。）
