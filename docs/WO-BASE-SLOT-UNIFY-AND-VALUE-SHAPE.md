# WO-BASE-SLOT-UNIFY-AND-VALUE-SHAPE · 基地槽口径统一 + LLM 槽值形态归一（整单一人做）

> 由来：真 Kimi 合并态 10 题验收 8/10 —— **但 8/10 是个走运的样本**。
> 把其中一题单独跑 5 次，得到 **4 种不同结果**：
>
> | 跑次 | extractedSlots | 终态 |
> |---|---|---|
> | 1 | `base:"常州工厂"` | ❌ FAILED · `unknown base: 常州工厂` |
> | 2 | `base:"常州"` | ✅ COMPLETED |
> | 3 | `base:"常州工厂"` | ❌ FAILED · 同上 |
> | 4 | `{}` | ❌ 反问 |
> | 5 | `{"model":{"type":"objectRef","value":"4680"},…}` | ❌ 反问 |
>
> **单跑一遍 10 题分不出「修好了」和「运气好」。** 本单同时修两条真因 + 换掉那个不合格的判据。

## 🚦 范围边界（= 本单 dev 的身份）

```
apps/agentcore/src/mocks/seed.ts              A：base 槽声明 + 计划模板
apps/agentcore/src/router/l2-decompose.ts     A：底座对 base 的产出形态
packages/llm-adapters/src/slot-harvest.ts     B：槽值形态归一
packages/llm-adapters/src/*.test.ts           B 的 SEAM
apps/datacore/src/solvers/types.ts            A 引擎半：base 归一走共享解析器
apps/datacore/src/solvers/capacity.ts         A 引擎半（仅 base 归一相关）
apps/agentcore/test/** · apps/datacore/test/** SEAM
docs/SYSTEM-ONTOLOGY.md                       §8 断点登记
```
**不许碰**：frontend、`object-ref-resolve.ts`（已由审核方改完·`partial` 档已在）、`orchestrator.ts`。

---

## A · 基地槽口径不统一（数据半 × 引擎半 —— **必须一个 dev 整单做**）

### 已证事实

`apps/agentcore/src/mocks/seed.ts`：
```ts
:380  { name: "model", type: "objectRef", required: true, refType: "Model", … }   // 走解析器 ✅
:386  { name: "base",  type: "string",   required: false,
        description: "基地 ID 或中文名（限定单基地产能作用域·缺省全网合计）" }        // 不走解析器 ❌
```

真实失败任务里两者并排摆着，一眼可见：
```json
"slots": { "model": {"objectType":"Model","objectId":"4680-NCM","label":"4680 三元圆柱"},
           "base":  "常州工厂" }
"error": "DataCore POST /a/v1/solvers/capacity_forecast/invoke -> 400
          {\"code\":\"VALIDATION_ERROR\",\"message\":\"unknown base: 常州工厂\"}"
```

**同一个「基地」概念，在不同意图里被声明成两种槽类型**：
`risk_root_cause.base` / `adopt_mitigation.base` = `objectRef`（解析器覆盖）；
`capacity_feasibility.base` = `string`（谁都不解析，原文直甩 DataCore）。

槽位描述**自己写着**「基地 ID 或中文名」—— 作者知道用户会说中文名，却把解析推给了不知道谁。
（与 #109 那个 `factor` 槽同形：**声明里承认了难点，然后不处理它**。）

### 要求的根治形态（两半都要，缺一半 = 这单白做）

**数据半**：`capacity_feasibility.base` 改 `type:"objectRef"` + `refType:"Base"`，计划模板同步改用
`{{slots.base.objectId}}`（对齐 `risk_root_cause` 已有写法）。同时**扫一遍全部意图**，凡语义是「基地」的槽
一律统一为 `objectRef`/`refType:"Base"`；扫描结果逐条列进交付说明（**别只改这一个**，否则下一题又炸）。

**引擎半**：DataCore 侧的 base 归一（`solvers/types.ts normalizeBaseRef` / `capacity.ts` 那条 `unknown base` 抛错路径）
必须改走 `packages/contracts/src/object-ref-resolve.ts` 的**共享解析器**（`matchObjectRefInType`，`partial` 档已在）。
**不许**在 DataCore 再写第三套中文名匹配 —— 现在已经有两套了，这单是来收口不是来加的。

> 为什么两半必须同一个人做：agent 工具直调（`sim_*` / DRIL）**不经槽位层**，只改数据半，那条路照旧炸；
> 只改引擎半，槽位层仍把裸串当已填、留痕里看不见 matchedBy。CLAUDE.md 明令：跨数据/引擎两半的特性一个 dev 整单做。

---

## B · LLM 槽值形态归一（收割器只收了「袋子」，没管「袋子里装的是什么」）

真 Kimi 实测第 5 跑：
```json
{"model":{"type":"objectRef","value":"4680"},"demandDelta":{"type":"number","value":0.2},
 "weeks":{"type":"number","value":6},"base":{"type":"string","value":"常州"}}
```
每个槽值被包了一层 `{type, value}`。收割器把袋子收对了，但值是包装对象 → `validateSlotValue` 必挂 → 反问。

这是 #106 那个病的**值层版本**：位置层已经容忍了四种形态，值层还是只认一种。

### 要求的根治形态
在 `slot-harvest.ts` 里加**值归一**（同一个单源模块，别另建）：一个槽值若是形如
`{type: string, value: <primitive|object>}` 的**单层包装**，取 `value`；其余形态原样透出。
硬要求：
1. **只拆一层、只拆这一种签名**（`type` 是字符串 且 有 `value` 键 且 键数 ≤3）。乱拆会把合法的
   `{objectType, objectId}` object ref 拆坏 —— 这个必须有测试咬住。
2. 拆掉的包装要进 `sources`/留痕，别静默改写用户数据。
3. 不认得的形态**不许猜**，原样透出让下游校验去判（诚实边界）。

---

## C · 判据换掉（审核方自认的方法缺陷）

旧判据「跑一遍 10 题、10/10 COMPLETED 且零反问」**不合格**：它测不出稳定性，一次走运就报绿。

新判据：
- **每题连跑 5 次**，记录终态分布。达标 = **每题 5/5 稳定 COMPLETED 且零反问**（除 §D 豁免题）。
- 出现**任何**跑次分歧（同题不同终态）即视为未达标，且必须给出分歧原因，不许"重跑一次就好了"。

### D · 已裁定的豁免（审核方判断，写明理由）
**#10「采纳常州的三班制方案」** 用户没说针对哪个风险因子，**系统问一句本来就是对的**。
本题达标判据改为：**一次澄清 + 用户回答后能完成**（而不是零反问）。
本单要补一条测试：澄清 → 回答 → `COMPLETED`，断言落在**回答之后的终态**。
（原判据是审核方设错的，不是产品缺陷；不许为了凑 10/10 让系统去猜因子。）

---

## E · SEAM-GATE（头号判据）

1. **A 的接缝测**：在 merge 态断言 `capacity_feasibility` 拿「常州工厂 / 常州基地 / 常州 / changzhou」四种写法
   都能跑到 `COMPLETED`，且 DataCore 侧收到的是**同一个 base**。任一写法漏 = 红。
   **变异反证**：把 base 槽改回 `type:"string"` → 必须转红。
2. **A 的引擎半独立测**：直调 DataCore `capacity_forecast`，四种写法同结果。
   **变异反证**：把 DataCore 的 base 归一改回自己那套 → 后缀写法转红。
3. **B 的形态测**：用**真实抓到的**那条 `{type,value}` 报文原样做 fixture，断言四个槽都归一成裸值；
   另加一条**反向**测试：合法的 `{objectType,objectId}` object ref **不许**被拆坏。
   **变异反证**：去掉值归一 → 第一条红；把拆包条件放宽到"有 value 键就拆" → 第二条红。
4. 断言一律落**终态**，不许落 routedIntent（上一轮 7 个失败全部 routed 正确）。

## F · 完成判据
1. `pnpm --filter agentcore test` + `pnpm --filter datacore test` + `pnpm -r typecheck` 全绿（失败贴 `error TS|FAIL|AssertionError` 原文）。
2. §E 四组 SEAM 都在，四条变异反证真跑真转红，终端输出贴进交付说明。
3. §A 的「全意图 base 槽扫描」结果逐条列出（改了哪些、没改哪些及理由）。
4. `docs/SYSTEM-ONTOLOGY.md` §8 登记：`G-BASE-SLOT-TYPE-SPLIT`（同一概念两种槽类型）、
   `G-SLOT-VALUE-SHAPE`（收割器只管位置不管值形态）。
5. push 到 `claude/handoff-wo-base-unify`，**不碰正线，不开 PR**。

## G · 本体引用与影响
- **对象类型**（§2.H）：`IntentDefinition.slots`（base 语义槽统一为 objectRef）、`ClassificationResult.extractedSlots`（值层形态归一）
- **链路**（§3）：`classify → harvest(位置+值) → floor → fillSlots → plan → DataCore solver`。本单收口最后两段的口径。
- **不变量**：R14（应用层零业务常数 —— DataCore 侧不许再写第三套中文名词表）、R6（归一为纯函数）
- **断点**：关闭 `G-BASE-SLOT-TYPE-SPLIT`、`G-SLOT-VALUE-SHAPE`；与已修的 `G-SLOT-REF-ID-ONLY`(#105)、
  `G-SLOT-HARVEST-BLIND`(#106) 同属槽位链，**但都是不同的病**：那两条是"抽到了填不进去/抽到了被丢掉"，
  这两条是"填进去了但两边口径不同"和"袋子收对了值没归一"。

## H · 纪律
- 独立 worktree；**不许**跑 `bash scripts/gate.sh` / 全量 datacore vitest（4 核机器）。整包 gate 由审核方做。
- **每完成一个可命名单元就立刻 commit + push**（`wip(base-unify):` 前缀）。本会话容器已重启三次，
  等到最后再推 = 赌运气。push 与"过 gate"是两回事：推旁支零风险，gate 只决定能不能进 canonical。
