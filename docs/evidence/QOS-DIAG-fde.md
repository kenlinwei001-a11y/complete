# WO-QOS-DIAG · FDE 亲手真跑证据（/b/v1/queries 全 FAILED 诊断 + 根因修·人机问答单管线命门）

> 目标（用户视角）：demo 租户（未配 LLM key）下，人机问答不再"发什么都 FAILED"——preset 类问句（≈场景意图 examples）无 LLM 也能确定性作答；novel/开放问句仍诚实降级"需配置 LLM"，绝不硬塞假答。

## 根因诊断（真 curl 复现·datacore4091 + agentcore4093 · SEED_DEMO=1 · 无 LLM provider）

`POST /b/v1/queries`「常州基地未来两周产能够不够」→ 4s 后 `status=FAILED, path=AGENT, error=LLM_PURPOSE_UNBOUND`。链路：
- classify（意图分类·路由决策）**需 LLM** → 3 次重试全失败 → `classification=undefined`；
- 回落 path B agent **也需 LLM** → `LLM_PURPOSE_UNBOUND` → FAILED。
- ⇒ **无 LLM provider 时 classify 与 path B 双双依赖 LLM，freeform 问句 100% FAILED**（人机问答单管线死）；scan 标本单"依赖型/越域"、本体 §8 G-3 记"freeform 需真 LLM=环境项·非接线缺陷"。**但"无 LLM 即全死"违反平台第一性「确定性是地板」**——preset 类问句本可无 LLM 确定性路由到 path A。

## 根因修（治本·"确定性是地板"·additive 零回归）

`router/orchestrator.ts`：
- 新增纯函数 `deterministicMatchScore(query, intent)`（R6·字符 bigram「问句被 name/description/examples 覆盖率」containment）。
- 新增 `deterministicClassify(task, candidates)`：唯一强匹配（top≥0.5 且领先第二≥0.15）→ confidence 1.0 → path A（无 LLM 确定性工作流）；多个中等匹配（≥0.34）→ 落 τ 中段 → INTENT_CHOICE 确定性澄清（用户选·仍无 LLM）；全部弱 → `undefined` → 上层照旧诚实降级（path B / 需配置 LLM）。
- 接线：`const classification = (await this.classify(...)) ?? this.deterministicClassify(task, candidates);` ——**仅当 LLM classify 未产出（不可用/失败）时触发**，LLM 可用时零行为变化；model 标 `deterministic:example-match`（审计诚实位·不冒充 LLM）。

## C1 · 后端真跑：无 LLM 下 preset 问句确定性路由 path A 出真答案（真 curl）

同一无 LLM 环境（agentcore4093 新构建）：

| 问句 | 结果 |
|---|---|
| `常州影响哪些订单`（≈affected_orders example「常州停产影响哪些订单」） | `deterministic:example-match` conf=1 → **path=WORKFLOW · status=COMPLETED · trustLevel=VERIFIED_WORKFLOW** · answer「受影响订单共 6 张」+ 6 行表 |
| `常州基地影响哪些订单`（无 selectedObjects·base 槽缺） | `deterministic:example-match` conf=1 → **AWAITING_CLARIFICATION**（确定性索要 base 槽·无 LLM） |
| `今天天气怎么样啊随便说点什么`（无关） | 无强匹配 → `undefined` → path B → FAILED（诚实降级·不硬塞） |

修前：以上 3 问句**全 FAILED**（无 LLM）。修后：preset 类作答 / 确定性澄清，只余真·novel 问句诚实降级。

## C5 · 前后端一致性（逐值对照）

QOS 答案「受影响订单共 6 张」+ 6 行表 == 后端 `affected_orders` 求解器真值：`POST /a/v1/solvers/affected_orders/invoke {base:changzhou}` → `rows=6 · summary.orderCount=6 · dataMode=SYNTHETIC`。前端所见（答案表 6 行）== 后端真值（solver 6 单），非写死非 mock。dataMode=SYNTHETIC（demo 合成数据）→ 由已交付 DATAMODE-SWEEP 保证前端渲染不冒充决策红。

> 浏览器边界：本修为**后端路由**改动（前端 QOS 答案渲染器未动）；答案内容 = 后端 solver 真值（curl 逐值对上）；查询坞渲染 QOS 答案的前端路径为既有且已在 DATAMODE-SWEEP 真浏览器跑中出现。故此单以 curl 端到端（含 path A 真答案）+ 集成测为主证，未另起全栈浏览器截图。

## C6 · 牙齿自证 + 四包全绿 + gates

- `test/router-deterministic-classify.test.ts`（3 用例·全绿）：① 纯函数 score（example 近似高分≥0.5·无关<0.34·R6 同输入同输出）；② 无 LLM（不 queue classify → mock 抛错）+ preset 近似问句 → `model=deterministic:example-match` + intent 正确（非误路由）+ **path=WORKFLOW·COMPLETED**；③ 牙齿·honest degradation——无关问句 → 不以 deterministic 走 path A（不硬塞）。摘掉 `?? this.deterministicClassify(...)` → 用例②转 FAILED（门承重）。
- `pnpm -r build && pnpm -r test && pnpm gates`：见提交贴绿（含 qos-a..g 既有全绿·无回退）。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 G-3：追加 WO-QOS-DIAG 确定性分类兜底（无 LLM 路由地板·preset 问句 path A 无 LLM 作答·novel 诚实降级）。

## 距北极星还差什么（诚实边界）

- 确定性兜底只覆盖**词面接近 examples** 的问句；语义改写（如「产能够不够」vs example「加 20% 六周能不能接」）词面远 → 仍需真 LLM（这是 LLM 必需层的正当边界，非缺陷）。
- 真·开放/novel 问句仍需配置 LLM 用途绑定（环境/凭据项）——修不消除该依赖，只把"无 LLM 即 100% 死"降为"preset 可述问句确定性可用 + novel 诚实降级"。
- 场景卡路径（带 scenarioIntentKey + 真对象槽位）本就无 LLM 走 path A（G-3 既证）；本修补的是**freeform 输入**的确定性地板。
