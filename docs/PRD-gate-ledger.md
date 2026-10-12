# PRD · 门账（Gate Ledger）：把 39 道门从「有脚本」变成「有人跑、红过、有人修」

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-03） |
| 上游 | `docs/PRD-skill-crossreview.md` §3（C3）与 §9 · 任务 #95 |
| 解决问题 | 仓里有 **39 个 `scripts/check-*.mjs` 门脚本，但交付门只跑 21 个**；其余 18 个里有 **10 个零调用方却都在本体 §7 登记在册** —— 与 #76（`boundary-singlesource` 红着零接线活了 24 个 commit）**完全同族**，只是没人做过普查 |
| 不解决 | 不新增业务门、不改任何被普查到的门的判据、不动 Skill 改造本身（五份 Skill PRD 各自的新门由各自 WO 负责，本 PRD 只负责**让它们无处藏身**） |
| 交付形态 | 一张机器可核的门账 + **一道会红的新门** + 一次性的存量定性。**不接受"写一份文档"作为交付** |

> **为什么这张单排在五份 Skill PRD 之前**：五份 PRD 合计新提 **17 道门**，叠加现有的将变成 50 个门脚本。
> 今天 39 个里已经有 10 个是死的（26%）。**在一个 26% 门是死的仓里再加 17 道门，等于把假绿产能翻倍。**
> 本单是那五份的共同前置。

---

## 0. 本体引用与影响（铁律 0 · 强制）

- **触及对象类型**（`docs/SYSTEM-ONTOLOGY.md` §2）：不新增业务对象类型。新增**治理制品** `GateLedger`
  （`scripts/gate-ledger.json`），与既有 `scripts/*-baseline.json` 四份棘轮基线同族
  （`cli-parity-baseline` / `debattery-baseline` / `ontology-anchor-baseline` / `ontology-description-baseline`）。
- **触及链路**（§3）：不触及任何业务链路。只触及**治理链**：
  `scripts/check-*.mjs`（39）→ `package.json:gates`（18）⊕ `scripts/gate.sh` 直调（3）→ `.github/workflows/gates.yml` → 本体 §7 登记。
- **触及事件**（§4）：**不新增事件**。
- **触及不变量**（§5）：不改任何 R 不变量。本单守的是**门禁维自身的完整性**，是 §7 的元规则。
- **触及门禁**（§7）：**新增 1 道** `gate-ledger:check`，并入 `pnpm gates` → **18 → 19**。
  必须同步登记进本体 §7，否则 `ontology-writeback:check` 红。
- **触及断点**（§8）：
  - 直接相关：`G-DEAD-GATE-BY-POLICY`（假绿第 5 形态，#76 已闭**单例**，本单闭**整类**）。
  - **本单新登记一条**（实施时写入 §8）：

    ```
    | G-WRITEBACK-ONE-WAY | 回写门只查单向：`check-ontology-writeback.mjs:34` 断言
      「每个并入 pnpm gates 的门必须在本体 §7 登记」，**不查反向**——§7 登记了、
      但根本没接进任何执行路径的门，一个都抓不到。#76 的 boundary-singlesource
      正是从这个方向漏出去、红着零接线活了 24 个 commit。今日普查：10 个零调用方
      门脚本**全部**在 §7 有登记。
      | scripts/check-*.mjs → package.json:gates → 本体 §7（单向断言）
      | 🔴 未修（本 PRD 治）|
    ```

---

## 1. AS-IS 普查结果（本会话机械统计 · 判据与命令随附，复验方可复算）

统计脚本见 §6.1（交付物之一，**不是一次性的**）。当前结果：

| 归属 | 数量 | 含义 |
|---|---|---|
| ① 进 `pnpm gates` 链 | **18** | 每次 gate / CI 真跑 |
| ② `scripts/gate.sh` 直调 | **3** | `genuine-sim` · `ontology-writeback` · `handoff-integration`（CI 里 handoff 是独立 job） |
| ④ 仅有 npm script 入口 | **6** | `bstack-derive` · `dril-quality` · `dril-registry` · `dril-retrieval` · `link-stabilize` · `modeling-wire` —— **没有任何自动路径会跑它们** |
| ⑤ 仅被其他脚本引用 | **2** | `sim-readiness` · `validation` |
| ⑥ **零调用方** | **10** | `cli-parity` · `cockpit-widgets` · `no-hardcoded-rules` · `ontogenesis` · `opt-determinism` · `opt-template` · `propagation` · `rule-closure` · `sim` · `solver-license` |

**追了一层之后的关键事实（不是 grep 就收工）**：

1. **CI 不是第二条路**。`.github/workflows/gates.yml` 跑的是 `bash scripts/gate.sh` + `pnpm gates`
   + `check-ontology-writeback.mjs` + `check-handoff-integration.mjs` —— 与本地**同一套 21 道**。
   其余 18 个脚本在 CI 里同样一次都不跑。
2. **那 10 个零调用方，全部在本体 §7 有登记**（逐个 grep `docs/SYSTEM-ONTOLOGY.md` 命中数 ≥1）。
   所以它们不是"没人要的旧脚本"，而是**制度上宣称存在、实际不执行**的门 —— 与 #76 同族，只是 ×10。
3. **回写门是单向的**（本单的病根）：`scripts/check-ontology-writeback.mjs:34` 只断言
   「gates 链里的门 → §7 有登记」。**反向不查**。它自己的注释也写明了诚实边界（`:8`），
   但那条边界被当成了"暂时不做"，于是 10 个死门在两侧都合规：既不在 gates 链里（回写门不管它们），
   又在 §7 里（看起来受治理）。

> **⚠ 定性纪律（写给执行 agent，违反即返工）**：
> 「零调用方」**不等于**「该删」。三种形态修法完全不同（CLAUDE.md 铁律 0.5）：
> **没接线**（该接）· **接了线没数据**（该补数据或删死分支）· **接了线接错地方**（该补挂载点）。
> 本单要求对 18 个非 gates 门**逐个定性**，不许一刀切删除，也不许一刀切并入。

---

## 2. 目标 / 非目标

### 2.1 目标

1. **G1 · 门账落地**：`scripts/gate-ledger.json` —— 每个 `check-*.mjs` 一条记录，字段见 §4.1。
2. **G2 · 一道会红的新门** `gate-ledger:check`：账与现实不符即红（详见 §4.2 的四条判据）。
3. **G3 · 补上回写门缺的那个方向**：§7 登记了但未接线的门 → 红（这是 #76 整类的收口）。
4. **G4 · 存量 18 个非 gates 门逐个定性**，每个给出**四选一**处置并写进账里：
   `WIRE`（接进 gates）· `MANUAL`（保留手动，须签实名理由 + 触发时机）· `FOLD`（并入别的门）· `DELETE`（删脚本 **且** 同步删 §7 登记）。
5. **G5 · 「曾经真红过」的证据字段**：每道**进 gates 的**门必须有 `provenRed` 证据（§4.3）。

### 2.2 非目标（明确不做，防范围膨胀）

- ❌ 不修改任何现存门的**判据逻辑**（发现某门判据有问题 → 记进账的 `notes`，另立单）。
- ❌ 不新增业务门。
- ❌ 不为 18 个存量门补写测试。
- ❌ **不追求"全部并入 gates"**。gate 时长是真实成本（CI 约 28 分钟），`MANUAL` 是合法答案 —— 但必须签字。

---

## 3. 🚦 范围边界（本 WO 只碰这些文件）

```
新增：
  scripts/gate-ledger.json            门账（数据）
  scripts/check-gate-ledger.mjs       新门（判据）
  scripts/gate-census.mjs             普查器（账的机械来源，供门与人共用）

修改：
  package.json                        gates 链 +1（18 → 19）· 新增 gate-ledger:check 别名
  docs/SYSTEM-ONTOLOGY.md             §7 登记新门 · §8 新登 G-WRITEBACK-ONE-WAY
  scripts/check-ontology-writeback.mjs 仅补反向断言（G3）；**不动它现有的正向逻辑**

⛔ 不碰：apps/** · packages/** · 任何测试文件 · 其余 38 个 check-*.mjs 的判据逻辑
   （只有被定性为 DELETE 的脚本可以删除，且必须同批删 §7 登记）
```

---

## 4. 交付物详规

### 4.1 `scripts/gate-ledger.json` 字段

```jsonc
{
  "version": 1,
  "gates": {
    "check-boundary-singlesource.mjs": {
      "alias": "boundary-singlesource:check",     // package.json 里的调用名（无则 null）
      "binding": "GATES_CHAIN",                   // GATES_CHAIN | GATE_SH | CI_ONLY | MANUAL | NONE
      "disposition": "WIRE",                      // WIRE | MANUAL | FOLD | DELETE（仅对非 GATES_CHAIN 必填）
      "guardedPaths": [                           // ★ 责任边界 = 路径，不是人名（理由见 §4.1.1）
        "apps/datacore/src/synthetic/**",
        "packages/contracts/src/**"
      ],
      "escalation": "审核方",                      // 只有两个合法值：审核方 | 仓主
      "guards": "BASE_REGISTRY/SEG_REGISTRY/PLAN_GOAL_TARGETS 单一来源",  // 守什么
      "ontologyRef": "§7",                        // 本体登记位置（未登记填 null）
      "provenRed": {                              // §4.3
        "kind": "COMMIT",                         // COMMIT | MUTATION | NEVER
        "evidence": "c0a1bcda",                   // commit sha / 变异描述
        "note": "WO-76：该门自身红了 24 个 commit 且零接线，接线后转绿"
      },
      "notes": ""
    }
  }
}
```

#### 4.1.1 为什么责任边界是**路径**而不是**人名**（仓主 2026-08-03 定）

`CLAUDE.md:102` LOOP 纪律③ 已有明文：**「一 WO 一 fresh dedicated dev·靠文件边界不靠身份 ——
每张 WO 顶部写 🚦范围边界（只碰哪些文件/包），这就是该 dev 本单的"身份"，无需追问哪个 dev 是哪个」**。

dev 是一单一换的临时体。往一张**长期存在**的账里写 dev 名字，那个名字**落笔即过期**：
三周后门红了，按名字找不到任何人。更糟的是，它会变成一个**声明了没有消费方的字段** ——
正是本单要治的病本身。门账里长一个假绿字段，是自相矛盾。

故拆为两个字段：

| 字段 | 填什么 | 为什么它是活的 |
|---|---|---|
| `guardedPaths[]` | 这道门**实际断言的文件边界**（glob） | **可机器核**（路径必须真存在 → 判据④ 有牙可红）；**且能回答"谁该修"**：门红了跑 `git log -- <path>`，比一个三周前写死的名字准确 |
| `escalation` | 只有 `审核方` / `仓主` 两个合法值 | 本仓**只有两个常驻角色**。`审核方` = 判、修或派单；`仓主` = 需要**政策决定**时（删门、放宽判据、门该不该存在）。dev 不是常驻角色，不进此字段 |

**默认判法（执行方照此填，不需要回来问）**：
- 绝大多数门 → `escalation: "审核方"`（无论它守 `scripts/**` 还是 `apps/**` —— 派单与复验都归审核方）；
- **只有一种情况填 `仓主`**：该门被定性为 `DELETE`，或其判据需要**放宽**。
  删门与放宽红线是政策决定，不由审核方或执行 agent 拍板。

> 因此**不设「待指派」逃生口** —— 不存在填不出来的情况。少一个逃生口，少一处可糊弄的地方。

### 4.2 `gate-ledger:check` 的四条判据（**四条同时成立才算过**）

| # | 判据 | 红的样子 |
|---|---|---|
| ① **无遗漏** | `scripts/check-*.mjs` 的文件集合 ⊆ 账的键集合 | 新加一个门脚本不登账 → 红 |
| ② **无幽灵** | 账的键集合 ⊆ 实际存在的文件集合 | 删了脚本不删账 → 红 |
| ③ **绑定属实** | 账里的 `binding` 必须与**现算**的普查结果一致（`gate-census.mjs` 现场跑，不读缓存） | 把门从 gates 链摘掉但账里还写 `GATES_CHAIN` → 红 |
| ④ **责任边界属实** | 每一条的 `guardedPaths` 非空，**且其中每条路径在仓里真实存在**（glob 至少匹配 1 个文件）；`escalation ∈ {审核方, 仓主}`；非 `GATES_CHAIN` 的另需 `disposition` 非空 | 写一个不存在的路径 → 红；新门挂着不定性 → 红 |

> **③ 是这道门的牙**。①②④ 只防"忘了写"，③ 防的是"写了但和现实脱节"——
> 也就是本仓所有假绿的共同形状。**③ 必须现算，不许把普查结果固化进账里自证。**

### 4.3 `provenRed`：门必须红过一次

**判据**：`kind` 只有三种合法值。

- `COMMIT` —— 该门在历史上真的红过，`evidence` 填 commit sha 或 CI run。**最强证据。**
- `MUTATION` —— 无历史红，但执行方**亲手做过变异反证**：故意引入一处该门应当拦截的改动，
  确认它变红，再还原。`evidence` 写清**改了什么、红在哪一条断言**。
  ⚠ 变异反证前必须先证 `tsc --noEmit` RC=0 —— 否则"红"可能只是编译失败，不是门在工作。
- `NEVER` —— **允许填，但会被门统计并打印告警**（不红，只暴露）。
  一个从未红过的门不算门，但把它藏起来比留着更糟。

**本单不要求把所有 `NEVER` 清零** —— 那是下一张单的事。本单要求的是**让 `NEVER` 的数量可见且可棘轮**
（同 `debattery-baseline.json` 模式：基线记当前 `NEVER` 数，**只许降不许升**）。

### 4.4 G3 · 回写门补反向

在 `scripts/check-ontology-writeback.mjs` **追加**（不改现有正向逻辑）：

> 从本体 §7 正文提取所有 `check-*.mjs` 脚本名 → 每一个都必须在门账里
> `binding ∈ {GATES_CHAIN, GATE_SH, CI_ONLY}` **或** `disposition ∈ {MANUAL, FOLD, DELETE}` 且已签 `owner`。
> 既不接线、又无处置签字 = **被制度指定的死门** → 红，打印脚本名与 §7 行号。

---

## 5. 验收判据（复验方按此逐条核，缺一不算过）

| # | 判据 | 怎么核 |
|---|---|---|
| A1 | `pnpm gates` 为 **19** 道且 `RC=0` | `out=$(pnpm gates 2>&1); rc=$?` —— **禁止管道后取 `$?`** |
| A2 | `bash scripts/gate.sh` 全绿，`REAL_GATE_RC=0` | 五包逐包点名，包数=5 |
| A3 | 39 个门脚本**逐个**在账里且 `binding` 与现算一致 | 跑 `gate-census.mjs` 与账比对，差异必须为 0 |
| A4 | 39 条**逐个**有 `guardedPaths`（路径均真实存在）+ `escalation`；18 个非 gates 门另有 `disposition` | 把任一条 `guardedPaths` 改成不存在的路径 → 判据④ 必须红（当场做，贴原文） |
| A5 | 本体 §7 已登记新门；§8 已登 `G-WRITEBACK-ONE-WAY` | `ontology-writeback:check` 绿 |
| A6 | **门自证 ①**：把任一门从 `gates` 链摘掉 → `gate-ledger:check` **必须红在判据③** | 亲手做，贴红的原文 |
| A7 | **门自证 ②**：新建一个空的 `scripts/check-fake.mjs` → **必须红在判据①** | 亲手做，做完删除 |
| A8 | **门自证 ③**：在 §7 登记一个未接线的门名 → G3 反向断言**必须红** | 亲手做，做完还原 |
| A9 | `provenRed` 中 `NEVER` 的条数已入基线，且基线文件被 `gate-ledger:check` 读取 | 改大 `NEVER` 数 → 红 |

> **A4 也是有牙的一条**：路径存在性可机器核，所以「责任边界」不可能像人名那样填了等于没填。
>
> **A6/A7/A8 是本单的核心验收**。一道没红过的门不算门 —— 这正是本单要治的病，
> 所以**本单自己的门必须当场红三次**。只交"跑了绿"不算过。

---

## 6. 实施提示（省下执行 agent 的探路时间）

### 6.1 普查器已有可用原型

本 PRD 的 §1 数据由一版一次性脚本产出，逻辑可直接搬进 `scripts/gate-census.mjs`：
读 `package.json` 的 `scripts.gates` 拆 `&&`、读 `scripts/gate.sh` 全文、grep `.github/`，
按「进链 / gate.sh 直调 / 仅 CI / 仅 npm 入口 / 仅被别的脚本引用 / 零调用」六分类。
**注意**：判"gate.sh 直调"时要同时匹配**脚本文件名**与**其 npm alias**，只匹配文件名会漏
（`gate.sh` 里有的门是用 alias 调的）。

### 6.2 已有的棘轮先例（照抄，别新造模式）

`scripts/debattery-baseline.json` · `ontology-anchor-baseline.json` · `ontology-description-baseline.json`
· `cli-parity-baseline.json` —— 四份都是「存量可见、只降不升」。`provenRed: NEVER` 的棘轮照同一形状做。

### 6.3 两个容易踩的坑

1. **别把普查结果写死进账再拿账去校验账**（自证循环）。判据③必须**现算**。
2. **`cli-parity` 这一条要小心**：它有 baseline 文件（`cli-parity-baseline.json`）说明曾被认真做过，
   但脚本零调用方 —— 属于「接了线又被摘掉」还是「从没接」需要查 git 历史再定性，
   **不要看见零调用就判 DELETE**。

---

## 7. 诚实边界

- §1 的普查是**本会话现算**的，随代码演进会漂 —— 这正是要把普查器固化成 `gate-census.mjs` 的原因。
- 本 PRD **没有**逐个阅读那 18 个非 gates 门的判据逻辑，因此 §2.2 明确把「判据是否正确」排除在外；
  执行 agent 若在定性时发现某门判据本身有问题，**记进 `notes` 另立单**，不要在本单里顺手改。
- 「10 个零调用方全部在 §7 有登记」这一条是按**脚本名在 `SYSTEM-ONTOLOGY.md` 的命中数 ≥1** 判的，
  未逐条确认那处命中是不是正式的 §7 登记（可能出现在 §8 断点描述里）。
  执行时须**逐条核到章节**，如发现某条其实未在 §7 登记，按事实修正账与本节。
