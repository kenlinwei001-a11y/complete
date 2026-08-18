# HANDOFF · WO-QOS-PAGECTX-EVAL（同屏问答内容面评测集 · 闭 B-4·U7）

- 分支：`claude/handoff-wo-qos-pagectx-eval`（从 `origin/claude/verify-reclaim-6` @ `10a026a4` 长出）
- 交付：`apps/agentcore/test/pagectx-answer-eval.test.ts`（新增）+ 本体 `docs/SYSTEM-ONTOLOGY.md` §8 回写（仅 U7 一项标已判，断点维持 ◑）
- 未碰：`docs/PRD-harness-ux-adoption.md` 表体 · `scripts/lib/layout-probe.mjs` · 其他断点

## ① 修前后对照

- **修前**：`G-SPLITACCOUNT-PROMISE-ONLY` 的 B-4·U7「同屏问答答得对不对」无验收方式 —— PRD §4.2 把 U7 内容面拆出挂账，「编排侧评测集（问题 + 期望要素 + 判分口径）」只开了单（§5 P3），仓内没有任何东西真跑过「答得对不对」。
- **修后**：评测集落成并首跑 **5/5 主场景判「答得对」**；判分口径确定性（R6）、金丝雀双刃在场、变异反证两遍实录（见④）。

## ② 判据形态

6 条同屏场景（view + pageContext + 问题 + 期望要素/禁现要素），pageContext 经 `derivePageContextMirror` 逐字段镜像前端 `sessionStore.derivePageContext`（与 `ceo-pagecontext-seam.test.ts` 同一份镜像）。每条经**真 QOS 管线**（`deterministic:ceo-route` → path-A `invoke_solver` → 模板投影答案·**全程零 LLM 块装配**）逐条真跑。

判分 = `scoreAnswer` 纯函数子串匹配（`extractAnswerText` 序列化与 `evals.ts` 同一份实现），**禁 LLM-as-judge**（R6），三态指名可区分：

- `noAnswer`（没答：任务未 COMPLETED 或答案文本空）
- `missing`（漏答：期望要素未命中，**指名缺哪个**）
- `offTopic`（答非所问：禁现要素出现，**指名是哪个**）

与结构面不重叠：`ceo-pagecontext-seam` 判的是「知不知道自己在哪一页」（usedPageContext / slots 派生），本集咬的是**答案载荷的内容**（用户读到的那段话里有没有对的根因/指标/方案，有没有别页要素）。

场景清单：根因深问（gap_attribution × seg_attain_ess）· 怎么补（decision_play 高保真：cf-cathode-shortage / 上游正极材料减供 / 27.8 / 扩备份供应池 / 长协提量）· 换选中根因答案跟页走（cf-upstream-cut，禁现 cf-cathode-shortage）· 瓶颈题防 RE_ROOTCAUSE 劫持（bottleneck_matrix，禁现 gap_attribution/decision_play）· 供需归因（supply_demand_gap_attribution）。

## ③ 金丝雀证据

- **必中样例** `remedy-cathode`：明知答得对 ⇒ 判对（主套件内，decision_play 高保真答案要素全命中）。
- **必不咬样例** `offtopic-weather`：同屏问「今天天气怎么样」—— 系统诚实降级且**答案块非空**（前置断言钉住：`blocks.length > 0`），专杀「返回了东西就算过」的伪判分。实录输出：

  ```
  [PAGECTX-EVAL·canary] [offtopic-weather] 答不对 —— 漏答(missing): cf-cathode-shortage、扩备份供应池
  ```

  判不对 · 落在「漏答」态并指名两个要素 · 不冤判答非所问（offTopic 空）。

两只金丝雀与主判分**共用同一 `scoreAnswer` 实现**（铁律 0.6，不各抄一份）。

## ④ 变异反证（两遍实录·亲手做）

| 遍 | 变异 | 结果 | 还原 |
|---|---|---|---|
| 一 | `remedy-cathode` mustInclude「扩备份供应池」→「扩备份供应池-ZZ9变异一」 | 主套件当场红：`答不对 —— 漏答(missing): 扩备份供应池-ZZ9变异一` | 转绿 |
| 二 | `bottleneck-risk` mustInclude「bottleneck_matrix」→「bottleneck_matrix-ZZ9变异二」 | 主套件当场红：`答不对 —— 漏答(missing): bottleneck_matrix-ZZ9变异二` | 转绿（终跑 RC=0，3/3） |

## ⑤ 界外发现（如实登记 · 本单边界外未动）

a. **`harness-ux-splitaccount:check` 在裸基线上即红**：判据⑤ B-2 现算读数「面板文件 3→5」漂移（有对位实现 0→0 未变），需该门所有人 `--tighten` 重记基线。已在 pristine `origin/claude/verify-reclaim-6` 对照复跑同签名同红，证实与本单 diff 无关（本单不碰前端面板与 PRD 表体）。
b. **mock 保真度边界**：agentcore `MockDataCore` 对 `gap_attribution` / `bottleneck_matrix` / `supply_demand_gap_attribution` 返通用桩 `{solverKey, ok, args}`，故这些求解器的内容面断言粒度 =「答的是哪个求解器 + 哪个页面要素」；`decision_play` 为高保真 mock（根因标签/方案表/缺口数字全真），断言到方案内容粒度。接真 datacore 后要素只会更丰富，判分口径不变（子串匹配不依赖 mock 特有字段名）。

## ⑥ 前置门 RC

| 门 | RC |
|---|---|
| `npx vitest run test/pagectx-answer-eval.test.ts --maxWorkers=1` | 0（3/3） |
| `tsc -p tsconfig.typecheck.json --noEmit`（agentcore 含测试） | 0 |
| `eslint test/pagectx-answer-eval.test.ts` | 0 |
| `git status --porcelain` | 空 |
| `node scripts/check-branch-base.mjs claude/handoff-wo-qos-pagectx-eval --onto=origin/claude/verify-reclaim-6` | 0（分叉点落后集成线 0 提交） |
| `node scripts/check-merge-conflict-markers.mjs` | 0 |

**现状结论（三选一）：答得对** —— 5/5 主场景全部命中期望要素、零答非所问；否定态金丝雀咬痕在③。
