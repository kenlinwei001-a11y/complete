# HANDOFF · WO-PROMPT-KEY-LINT —— LLM 摘要语义审查接进发布门（建议式·不阻断）

**分支** `claude/handoff-wo-prompt-key-lint` · **画像 中** · 闭断点 `G-PROMPT-KEYS-CONFIG-ONLY` 的 `skill_summary_lint` 一支
**基线**：开自集成线 tip `955b8ca7`（开工时 0 落后）；交单前已 rebase 到集成线最新 tip `10a026a4`（含 WO-PROMPT-KEYS-WIRE 的三键接线），冲突**仅** `docs/SYSTEM-ONTOLOGY.md` §8 断点行一处（WIRE 与我改同一行，已合并双方内容解为「四键全闭 ✅」，其余 7 文件干净套用），rebase 后 `check-branch-base` RC=0（落后 0）。

## ① 实测数（自己跑的，非转述）

| 工单给的数 | 我的实测 | 口径差异 |
|---|---|---|
| `skill_summary_lint` 在两 app src 0 命中 | **0 命中**（`grep -rn skill_summary_lint apps/agentcore/src apps/datacore/src --include='*.ts'`） | 一致 |
| 金丝雀 `classifier` 15 命中 | **51 命中**（同一条命令） | 数字不同（工单 15 可能数的是词边界/子集），金丝雀结论不变：工具活着，0 是真的 0 |
| 断点注记「`skill-lint.ts` 三条确定性正则与模板文案一字对应但互不相识」 | 属实（`skill-lint.ts` `summary.triggerTemplate`/`summary.exclusion`/`summary.forbiddenWord` 三条正则 vs 模板文案同规则） | 一致 |
| 交单时集成线最新 tip 上 `skill_summary_lint` 消费方 | **仍 0**（`git grep` on `origin/claude/verify-reclaim-6`） | WO-PROMPT-KEYS-WIRE 只接了三键，本键病灶未被别人误修 |

**间接调用追层（工单强制项）**：`resolvePromptOverride`（`agent/prompts.ts`）就是字符串键分发点（`prompts.getPromptTemplate(ctx, key)`，key 为运行时参数）——grep 字面量永远看不见经它间接消费的键。逐 caller 核：`orchestrator.ts` 只传 `"classifier"`；`datacore/app.ts` 的 `resolvePrompt` 只对 CRUD/resolve 端点按键查表（配置面读写通路，不驱动 LLM）。re-export/高阶函数/DI/事件订阅四条：contracts 只经 `export *` barrel 出类型与常量，无消费；无任何订阅者读该键。**结论：真·没接线（调用方集合 = 零，连 test 都没有），不是另外两形态。**

## ② 改法与论据

**裁决① · 门排序**：结构 lint → 引用闭合（probeMissingRefs）→ **本审查（门禁一·语义补）** → 评测门。
论据：结构错的由零成本正则先拦（lint 报错更可操作），LLM 只看「结构对但语义可疑」（如「当需要时使用」过了 `/当[\s\S]+时使用/` 但语义空泛）；引用死路是事实问题、确定性探针先挡（且保持「lint 未过不打外部」的短路语义——审查不耗在被拒发布上）；评测门跑完整 B1 管线最贵压最后。**实际执行点**在全部阻断判据通过后、`repos.skills.update` 之前：建议式输出的价值只在「会落库+会返回」时存在，被 422 拒掉的发布不跑审查（机器证据：lint 失败 ⇒ `composeRequests` 为零，测试钉死）。

**裁决② · R6 不破（硬约束）——选 (a)+(c) 组合：建议式 + 审计留痕，阻断判据保持纯确定性。**
- verdict **不进 422 阻断判据** ⇒ 同输入的发布结果恒确定，R6 不破；这正面回答了断点注记「发布门依赖其确定性（R6)，硬接会造出第二个空转消费方」。
- **不选 (b) 缓存钉死**：缓存命中才确定、首调仍不确定；缓存要新持久面（本仓铁律：新表 = migrations + pg + memory + repo 接口四处同改，中画像单不该扛）；坏 verdict 被钉住直到版本 bump——失效策略比病本身更危险。
- **不选纯 (a) 无留痕**：verdict 落三处（发布响应 + skill 行 additive `summaryReview` 字段 + 干跑端点 opt-in），可追溯才不是空转消费方。
- **「mock 掉 LLM 后门里还剩什么判据」**：请求构造判据（键解出的模板真进 compose 请求体 instruction、摘要原文真进 inputs——mock 的 `composeRequests` 可断言）+ 响应处理判据（PASS/ISSUES/UNPARSEABLE/UNAVAILABLE 四档确定映射）+ R6 机器判据（固定注入时钟跑两遍逐字节相同）。
- **fail-open 但诚实**：LLM 抛错 → `UNAVAILABLE`、输出不可解析 → `UNPARSEABLE`，两档都不阻断、都不许读成「通过」（issues 文案里明写「不得读作摘要合格」）。
- **与 classifier 的关键差异**：classifier 有更详硬编码兜底故 PLATFORM_DEFAULT 不流入；本键**没有**硬编码兜底——`PLATFORM_PROMPT_DEFAULTS.skill_summary_lint` 就是执行提示词本体，无 override 时**必须流入**，否则本键依然只活在配置里。

**改动清单**（6 文件，additive 为主）：
- `packages/contracts/src/agentcore.ts`：`SkillSummaryReviewSchema` + `SkillDefinitionSchema.summaryReview?`（pg 是 JSONB 整对象序列化·**零迁移**，memory repo 同为整对象存）。
- `apps/agentcore/src/agent/prompts.ts`：新增 `resolvePromptTemplate`（返回完整 ResolvedPrompt 含 source/version）；`resolvePromptOverride` 改薄包装——「只采纳 TENANT_OVERRIDE」判据仍只有一份。
- `apps/agentcore/src/skill-summary-review.ts`（新）：`runSkillSummaryReview`——解析生效模板 → 确定性拼 instruction（模板 + 固定【输出契约】尾）→ `llm.compose` → zod 解析裁决 → 四档留痕；头注含两条裁决全文 + 「启动期种子审计刻意不跑本维度」（建议式不属阻断判据、启动期不该对 LLM 有依赖——写明的设计决定不是静默缺口）。
- `apps/agentcore/src/config.ts`：`QOS_SKILL_SUMMARY_REVIEW_MODEL`（默认 `claude-haiku-4-5`，便宜档结构化判定）。
- `apps/agentcore/src/server.ts`：发布路在全部 422 之后、`update` 之前跑审查并随 `published` 落库（响应 `{...published, impact, lint}` 自然带出）；干跑路 `POST /b/v1/skills/lint?review=1` opt-in 追加审查（不带参数响应逐字节不变）。
- `docs/SYSTEM-ONTOLOGY.md`：§7 加「门禁一·语义补」子条；§8 `G-PROMPT-KEYS-CONFIG-ONLY` 行 🔴→◑（本键闭合，其余 3 键已由 WIRE 闭合）。
- `apps/agentcore/test/skill-summary-review.test.ts`（新，26 例）。

## ③ T1–T5 实测输出原文

**T1 · 变异反证（红对地方）**：把 `skill-summary-review.ts` 的回落键从 `skill_summary_lint` 改成 `classifier`（M1）→
`RC=1，恰好 5 红 21 绿`，**全部红在请求体断言**（不是「配置读不到」/「函数不存在」）：
```
× 无 override → instruction 含平台默认模板全文（键真到达 LLM 请求体…）
AssertionError: expected '你是意图分类器。把用户问句映射到候选意图…'
  to contain '你是技能摘要审查器。检查摘要是否含『当…时使用』触发句…'
（另 4 红：无客户端回落档 / 键隔离档 / SEAM 发布路 / SEAM 干跑路——同一断言位）
```
还原后 26/26 绿（RC=0）。

**T2 · 没碰的东西没红**（merge-base = `955b8ca7`，`/tmp/base-probe-pkl` 独立 worktree 装依赖后跑，与 HEAD 逐字对比）：

| 测试文件 | merge-base | HEAD |
|---|---|---|
| skill-eval-gate | RC=0 · 5 passed | RC=0 · 5 passed |
| prompt-defaults-wiring | RC=0 · 15 passed | RC=0 · 15 passed |
| skill-ref-closure.seam | RC=0 · 13 passed | RC=0 · 13 passed |
| skill-partial-a-seam | RC=0 · 11 passed | RC=0 · 11 passed |
| typecheck（agentcore） | RC=2 · 1 错（`mockdc-signature.seam.test.ts:126` TS2344） | RC=2 · **同 1 错，错误清单 diff 完全一致** |

⚠️ 那条 typecheck 错是**基线既存红**（同文件同行同错误，非本单造成）——本单范围外，未顺手改。

**T3 · 正反两侧**：本单是运行态审查器非 grep 门，两侧 = 必咬（mock `{"ok":false,"issues":["触发句空泛"]}` → ISSUES 透传 ✓）+ 必不咬（`{"ok":true}` → PASS ✓）+ 不在错误路径上跑（lint 失败的发布 → 零 compose 调用 ✓）+ 围栏容错（```json 包裹可解析 ✓）/ 不可解析 → UNPARSEABLE ✓ / 抛错 → UNAVAILABLE ✓——26 例中逐条钉死。

**T4 · 基线没动**：未碰 `scripts/gate-ledger.json`、任何 baseline JSON、`package.json`（`grep -c '"gates"'` 无需——没改）；contracts 改动为 additive 可选字段（非改名非收紧）；棘轮类文件零接触。`git diff --name-only 955b8ca7..HEAD` 仅上述 7 文件。

**T5 · 交单前三条**（rebase 后复测）：`git status --porcelain` 空 · `check-branch-base.mjs HEAD` RC=0（落后 0）· `check-merge-conflict-markers.mjs` RC=0。

**rebase 后 7 文件复跑**（tip `10a026a4` 之上，全绿）：skill-summary-review 26 · skill-eval-gate 5 · prompt-defaults-wiring 15 · skill-ref-closure.seam 13 · skill-partial-a-seam **12** · skill-contract 3 · skill-lint 14。⚠️ skill-partial-a-seam 由 T2 时的 11 → 12：rebase 带进来的集成线新提交给该文件加了 1 例（非本单改动，本单没碰该文件）。

## ③+ 真机验收（fde-delivery：亲手用一遍，非测试绿冒充）

真起 agentcore（隔离端口 4399·自起自灭·未碰用户任何服务），以 `catalog_admin` 身份真走 HTTP：
1. 建技能 `cap_interp_live` → 201；
2. `POST /b/v1/skills/lint`（不带参数）→ 响应键 = `['ok','violations']`，**无 summaryReview**（零回归实证）；
3. `POST /b/v1/skills/lint?review=1` → `summaryReview` 在场：`{templateSource:"PLATFORM_DEFAULT", model:"claude-haiku-4-5", verdict:"UNAVAILABLE", issues:["LLM 调用失败…404 Not found the model claude-haiku-4-5 or Permission denied"]}`——**键的模板真的驱动了一次真实 LLM 请求**（本机 anthropic 端点无该模型权限，诚实档如实记录、不冒充合格）；
4. `POST …/publish?force=true` → **200 PUBLISHED**，响应带 `summaryReview`（fail-open 不阻断实证）；
5. `GET …/skills/:id` 回读 → 落库行 `summaryReview.verdict="UNAVAILABLE"` 在档（持久化实证）。

## ④ 基线变化

没动任何基线/棘轮文件。typecheck 既存红 1 条（`mockdc-signature.seam.test.ts:126`）为 merge-base 原样，**未升未降**，本单范围外。

## ⑤ 与其他 dev 的文件重叠

- 我碰的文件最近 5 提交全部来自已收编的 reclaim 批次（`dc9c8b85`/`ef5778df` 等），无在跑 dev 同碰。
- **WO-PROMPT-KEYS-WIRE**（批次 01·同碰提示词键）：开工时远端无此分支，交单前**已并入集成线**（`254bd334`）——它接 `extraction`/`modeling`/`answer_compose` 三键（datacore `modeling.ts`/`ruledocs.ts`/`app.ts`/`prompts.ts` + agentcore `orchestrator.ts`/`execute-plan.ts` + 测试 + 本体回写），**与我的 7 文件零重叠**，且明确把 `skill_summary_lint` 留给本单（其提交注「3 键已接线·skill_summary_lint 挂账待裁决」）。本单已 rebase 到它之上，满足「它先落地、我在其上做」。
- 断点行 `G-PROMPT-KEYS-CONFIG-ONLY` 现态：**4 键全闭，行状态已置 ✅ 已闭合**（rebase 冲突即此行——WIRE 版「三键已接·本键挂账」与本单版「本键已闭·三键挂账」互补，已合并为双方内容俱在的单行）。

## ⑥ 没做的部分 + 差什么才能做

1. **生产态 PASS/ISSUES 两档未见真 LLM 跑过**：本机 anthropic 端点对 `claude-haiku-4-5` 无权限（404），live 只走到 UNAVAILABLE 诚实档。差什么：部署态配一个可用的审查模型（`QOS_SKILL_SUMMARY_REVIEW_MODEL` 指向有权限的模型 id）后，用一条真发布走一遍 PASS 与 ISSUES 各一次，把响应截图/落库行存档。
2. **评测门（非 force）路径下审查与 `runSkillProbe` 同跑的 LLM 调用排序**：本单 seam 用 `force=true` 避开评测门探针（探针消费 agent 队列）；非 force 路径两串 LLM 调用（compose 队列 vs agent 队列，互不串味）未做 seam。差什么：一张轻单补「非 force 发布 + 3 评测用例 + 审查留痕」的组合 seam（可归入评测门既有测试文件）。
3. **审查 verdict 的前端可见性**：留痕已在 API/落库行，前端技能编辑器/发布按钮尚无「摘要语义审查结果」展示。差什么：前端单（属 frontend-shell 边界，本单不碰）——`POST /b/v1/skills/lint?review=1` 已在 API 侧备好 opt-in 入口，接一块只读面板即可。
4. **UNAVAILABLE/UNPARSEABLE 的可观测聚合**：单条留痕有了，缺「近 N 次发布里审查不可用的占比」这类运维视图。差什么：ops 端点或指标（可挂 `GET /b/v1/ops/skill-seed-gate` 同族），一张轻单。
