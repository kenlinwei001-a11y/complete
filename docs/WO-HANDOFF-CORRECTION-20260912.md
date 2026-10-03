# ⚠ 派单包紧急订正 · 转给已开工的 dev

> **三件事，两件会让人白做或撞车。发出后请立刻转给对应的 dev。**

---

## ① WO-RULE-DISCOVERY —— **B 档判据是错的，照字面做会把 30 条全判成 B**

派单里写的：

> **B · 结构性不可达** = `SOLVER_RULE_HINTS` 里没有任何条目指向它

**实测推翻**（诊断报告 `docs/AUDIT-rule-discoverability-20260912.md`，分支 `claude/handoff-wo-diag-rules` @ `77834ab3`）：

`SOLVER_RULE_HINTS` 是 `Record<string,string>`，**值是 7 句散文，零个 `Cxx`** ⇒ 它指向的规则数是 **0**。照那条判据，**30 条规则全部落进 B**，分类表整张作废。

### 正确的现状（三条真通路，不是一条）

| 通路 | 覆盖 | 新增规则会不会自动进 |
|---|---|---|
| `SOLVER_RULE_REFS` | **26 / 30** | ❌ 手抄册，不自动 |
| DRIL 语义检索（`projectRules` 真把规则投进索引） | 30 / 30 可索引 | ✅ 自动 |
| `evaluate_rules(ALL_APPLICABLE)` | **30 / 30** | ✅ 自动 |

⇒ **规则不是「找不到」，是「找得到但检索不准」。**

### 真正的病是这个（实测，本诊断最强证据）

**同一索引、同一端点、两条臂：**

| 臂 | 召回 |
|---|---|
| 念规则名（「外协比例红线」） | **30 / 30 = 100%** |
| **20 条真实场景卡问句** | **5 / 20 = 25%** |

命中的 5 条**全是问句与规则名共享词**的；落空的 15 条**全是换了说法**的（「碳足迹达标吗」vs 规则名「碳护照前置」）。
⇒ **这条检索通道是「查字典」，不是「发现」。**

第二个病（独立的，必须分开修）：`evaluate_rules(ALL_APPLICABLE)` 确实把 30 条全投给模型，**但那 30 条全报「通过」**（空 payload fail-open）—— **是一份假安心清单**。

### 还有一处实测到的硬伤，顺带收掉

`discover` 工具的 kind 枚举**没有 `rules`**，而它的工具说明**写死 `（C01–C23）`**：
- **漏掉 12 条真规则**
- **让模型去要 5 条不存在的**（C07/C14/C17/C19/C20 **从未定义**）
- 不存在的 key **静默丢弃**（实测：要 4 条回 3 条）

### ⇒ 改判据，改成这个

| 定性 | 判据 |
|---|---|
| **A · 真能被发现** | 用**真实场景卡问句**（不是念规则名）检索，该规则能进返回 |
| **B · 只在念名字时可达** | 念规则名能中，换说法就中不了 ⇒ **本单要修的主体** |
| **C · 本来就不该被检索** | 给理由 |
| **D · 判不了** | 写清缺什么证据 |

**⛔ 别用 `SOLVER_RULE_HINTS` 当任何判据。**

### 验收也换掉（直接复用诊断的两臂对照）

> **臂 B（20 条真实问句）召回 ≥ 15/20**，**且臂 A（念规则名）不回退**，
> **且**回归「求解器还排不排得进前 8」（`maxResults=8`，规则丰富后会挤位）。

### ⚠ 这是「三半改动，必须一个 dev 整单做」

补 `answersQuestions`/`tags` 要同时动三处：
1. **契约** —— `IndustryTemplateSchema.rules` **今天连 `description` 字段都没有**
2. **种子** —— 30 条规则逐条补
3. **`projectRules` 投影** —— **最易漏的一半**

> ⚠ 不改第 3 半，**填了也投不出去**。症状是「填了没反应」而**四包全绿**。

### 规则真实条数是 **30**，不是派单写的 39

我那个 39 来自 grep `C\d\d` 的 **134 次命中** —— 规则码在注释里被反复引用。源码侧与真起服务互证均为 **30**，全 `PUBLISHED`。

---

## ② 两张单**必须换基点**，从 canonical 切会撞车或没有前提

**canonical 现在是 `c69d345d`，下面这些分支都还没并进去：**

| 分支 | tip | 里面有什么 |
|---|---|---|
| `claude/handoff-wo-tools-list` | `970c9e32` | **两段式发现面**（目录段 63 条 + 详情段），改了 `navigation-slice.ts` + `live-capability-map.ts` |
| `claude/handoff-wo-solver-inputschema` | `2916311e` | **12 个求解器的真 inputSchema**（在 `packages/contracts/src/solver-args.ts`） |

### ⇒ 请这样改基点

| 单 | 原基点 | **改成** | 为什么 |
|---|---|---|---|
| **WO-RULE-DISCOVERY** | canonical | **`origin/claude/handoff-wo-tools-list`** | 它要动 `navigation-slice.ts` / `live-capability-map.ts`，而两段式刚改过这两个文件。从 canonical 切必然冲突 |
| **WO-INPUTSCHEMA-B** | 「等前 12 个合并」 | **`origin/claude/handoff-wo-solver-inputschema`** | 那 12 个**还没并进 canonical**，从 canonical 切等于没有前提、会重复造表 |

### ⚠ 另有两个 agent 正在动同一批文件，**请让 dev 先确认边界**

| 在跑的工作 | 正在改 |
|---|---|
| inputSchema 接进 agent 主循环 | `apps/agentcore/src/tools/registry.ts` · `tools/executor.ts` |
| 相关性门槛 | `apps/agentcore/src/agent/live-capability-map.ts` |

**`live-capability-map.ts` 是真冲突点** —— WO-RULE-DISCOVERY 与「相关性门槛」都会碰它。
建议：**WO-RULE-DISCOVERY 的 dev 开工第一件事报一下它打算改哪几个文件**，撞上了我来协调先后。

---

## ③ 数字订正

| 派单里写的 | 实测 |
|---|---|
| 求解器 **60** 个 | **63**（`SOLVER_KEYS` = `ALL_SOLVER_CATALOG`，双向差集 0）。60 是 `grep -c` 的数、62 是正则解析的数，**只有读真数组那个在度量「注册了几条」** |
| WO-INPUTSCHEMA-B「剩余 **48** 个」 | **剩余 51 个**（63 − 12） |
| 规则 **39** 条 | **30** 条 |
| description 是「一句话」 | **p90 328 字 / max 712 字**，不截断的全量目录 17,529 字节 —— **喂不起**，必须先定义确定性截断（两段式那张单已实现 `briefOf`，40 字上限） |

---

## ④ 树龄探针有坑（每张单都在用这句）

```bash
git merge-base --is-ancestor HEAD "$PIN"      # ⚠ 祖先关系含自反：HEAD 就是 PIN 时也返回真
```

⇒ **树本来就对的时候，探针照样打「落后」**，dev 会白重开一次。

**正确写法**：
```bash
if git merge-base --is-ancestor HEAD "$PIN" && [ "$(git rev-parse HEAD)" != "$(git rev-parse "$PIN")" ]; then
  echo "落后 ⇒ 必须重开"
else
  echo "不落后"
fi
```

---

## ⑤ 给所有 dev 的一句话

**连续四张单，派单里的前提被实测推翻**：60→63 · 「`args-schemas.ts` 是空的」实为薄 re-export（已有 11 条）· 39→30 · 「一句话 description」实为 p90 328 字 · 「`lineGranularity` 零调用方」实为**第五态「接了线但没声明」**。

共同形态：
> **「我用一次 `grep` 的命中数当作事实，而真相要用真数组 / 真服务 / 真渲染去量。」**

⇒ **派单里的 `file:line` 和数字一律当线索，不当结论。实测推翻了就顶回来 —— 前四张都是这么救回来的。**
