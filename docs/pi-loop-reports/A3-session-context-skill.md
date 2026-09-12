# A3 · 会话 / 上下文工程 / Skill

范围：`packages/agent/src/harness/**`（session/compaction/skills/prompt-templates/system-prompt）+ `packages/coding-agent/src/core/skills.ts`。
所有结论均来自**真跑**；仅静态读码的条目已标 `[仅静态]`。

**环境**：pi v0.83.0；我自建 fake OpenAI 端点 `a3-work/fake3.py`（8137，每次回复带自增编号 `R#NN`，落盘整包请求）与 `a3-work/fake-tool.py`（8139，发工具调用）；自建 agent 目录 `a3-work/agent-dir`（不动共享的 `pi-agent-dir`，避免踩其他 agent）。
**新造工具**（后来者可直接用）：`a3-work/rpc2.py`（驱动 `pi --mode rpc`，等 response 而非死等）、`a3-work/pty2.py`（pty 变体：进程退出也照样出最后一屏；并吞掉 pyte 对 DSR 的崩溃）、`a3-work/prov.py`（会话溯源探针）。
pi 仓临时探针：`packages/agent/test/harness/zz-a3-session-probe.test.ts`、`zz-a3-interop.test.ts`（可删）。

---

## 一、能力清单（逐条带证据）

### 1. 会话树 / 分支

| 能力 | 实测结果 | 证据（命令 + 输出片段） | 判定 |
|---|---|---|---|
| `--session-dir` | 生效；会话直接平铺在该目录（**不**建 `--<path>--` 子目录，与 doc 描述的默认布局不同） | `cli.js … --session-dir $SD --no-tools -p "第一轮：记住暗号 ALPHA"` → `find $SD` = `2026-08-02T11-36-23-891Z_019fc242-….jsonl` | ✅ |
| 会话格式 = JSONL 树 | 与 `docs/session-format.md` 一致：首行 header，其后每条带 `id`(8hex)/`parentId` | `{"type":"session","version":3,"id":"019fc242-…","cwd":"…/sbx"}` / `message 844fd7a3 <- e7599635` | ✅ |
| `--session <path>` 续接 | 真续接，且**真回放**给模型 | 3 轮后 `req-03.json` 的 messages = system + 第一轮/收到/第二轮/收到/第三轮 | ✅ |
| `--session <部分uuid>` | 生效（`--session my-fixed` 命中 `my-fixed-id`）；不存在时明确报错 | `No session found matching 'zzz-nonexistent'` | ✅ |
| `--session-id <id>` | 首次给 warning 后建同名文件，二次真续接 | `Warning: No project session found with id 'my-fixed-id'; creating a new session with that id.` → 文件 `…_my-fixed-id.jsonl` 内 4 条 message 链式相接 | ✅ |
| `--no-session` | 真不落盘（跑完目录文件数不变） | `BEFORE=4 → 文件列表不变` | ✅ |
| `--continue` | 生效 | `r --continue -p "continue 测试"` → `R#47` | ✅ |
| **`--fork <path\|id>`** | 新建**独立文件**，`parentSession` 指回源文件，**且祖先条目的 `id` 逐字保留** | 从同一源 fork 两次 → 两个新文件，两者的 `844fd7a3/d52d3cbb/7f8dbfa5/…` **ID 完全相同**，只在末尾各自长出 `1cccbde1`(分支A) / `8161bccd`(分支B) | ✅ 高价值 |
| 回到**历史节点**开新分支（跨文件） | RPC `fork {entryId}` 可从任意历史 user 消息切；新文件在该 user 消息**之前**截断 | `{"type":"fork","entryId":"7f8dbfa5"}` → `{"success":true,"data":{"text":"第二轮：暗号是什么","cancelled":false}}`；新会话 `get_entries` 只到 `d52d3cbb`，随后接新 ID `dc2497ea` | ✅ |
| 回到历史节点开新分支（**同一文件内**，`/tree`） | 真做出「一父两子」：`bff70718` 同时有旧支 `49509d02` 与新支 `0403119c` | pty 驱动 `/tree` → 上下键选中 `user: T2` → 选 `Summarize` → 文件里出现 `branch_summary 0403119c <- bff70718` 与其后 `message d822c582` | ✅ 高价值 |
| `--resume` 选择器 | 真 TUI，且**按 fork 血缘做树状缩进** | pty 截屏：`› 第一轮：记住暗号 ALPHA  6 19m` 下挂 4 条 `├─/└─ 第一轮：记住暗号 ALPHA`（即 4 个 fork） | ✅ |
| fork 后两支独立 | 独立（各自文件，互不回写）；harness 层同文件双轨也互不污染 | harness 探针：切回轨道A后上下文 = `共同前提/ok/轨道A：方案甲`，`expect(...).not.toContain("方案乙")` 通过 | ✅ |
| **CLI `--fork` 不能指定 entryId** | CLI 只收 `path\|id`；harness 的 `SessionForkOptions{entryId, position:"before"\|"at"}` 出货 CLI 用不到 | `args.ts:113 result.fork = args[++i]`（无第二参数）；`createSessionForkSelection` 只被 `harness/session/repository.ts` 调用 | ⚠有限制 `[仅静态]` |
| harness 层「一父两子」 | 真做出：`u1` 的 children = 2 | `zz-a3-session-probe.test.ts` → `[A3] u1= ccdb2263 children= ["5cafbe76","bf044da5"]`，`Tests 3 passed` | ✅ |
| harness 会额外写 `leaf` 条目 | 有；**`docs/session-format.md` 未记载此条目类型** | harness 落盘 = `session,message,message,message,message,leaf,message,message,leaf` | ⚠格式分叉 |
| 会话导出 HTML | `--export` 产出 280KB 单文件，内嵌**完整会话 JSON**（base64） | `Exported to: /tmp/a3-export.html`；解出 blob 后 `含 FINAL: True \| 含 M1: True \| compaction 次数= 2 \| message 次数= 18` | ✅ 审计友好 |

### 2. 压缩（往深处推）

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `CompactionEntry` 落盘字段（出货 CLI） | `['details','firstKeptEntryId','fromHook','id','parentId','summary','timestamp','tokensBefore','type','usage']`——**只有 `firstKeptEntryId`，没有 `retainedTail`** | RPC `{"type":"compact"}` 后 dump 会话文件 | ✅（但见下条） |
| **压缩是「非破坏性」的** | **原文全部留在 JSONL 里**，只是不再进模型上下文 | 2 次压缩后文件仍含 `20f830c9 M1 … bbf6d3e0 R#09` 全部 18 条 message + 2 条 compaction | ✅ **推翻主控"原文永久丢弃"的一半**：对**模型上下文**成立，对**会话文件**不成立 |
| 能否回放 / 判定「结论产生于压缩前还是压缩后」 | **能**，纯靠 `parentId` 链 + compaction 条目位置即可判定，无需额外元数据 | `python3 a3-work/prov.py <session>` → `路径上压缩点 ['39cfb489','e87af7e4']`；逐条判出 `M1…M5 = 在 0 次压缩之后产生；其后又被 2 次压缩折叠` / `M6…M8 = 在 1 次压缩之后` / `FINAL = 在 2 次压缩之后` | ✅ |
| 但**没有**记录「这次 LLM 调用当时的上下文指纹」 | assistant 条目只存 `api/provider/model/usage/stopReason/timestamp/responseId`，无 context hash | 会话文件逐条检视 | ⚠有限制 |
| 二次压缩：前一次摘要会不会被再压？ | **不会被当消息重压**——它作为 `<previous-summary>` 单独喂给一个专用的 UPDATE 提示词做**滚动合并** | `req-10.json` 末条 user = `<conversation>[User]: M2…[Assistant]: R#04</conversation>\n\n<previous-summary>\nR#06\n</previous-summary>\n\nThe messages above are NEW conversation messages to incorporate into the existing summary…PRESERVE all existing information…` | ✅ 设计比朴素拼接好 |
| **二次压缩后上下文里会同时存在两份摘要，且旧的那份带误导性前言** | 二次压缩后模型收到：`<summary>R#10</summary>` → `M5/R#05` → `<summary>R#06</summary>` → `M6…M8` → `FINAL`。第二个 `<summary>` 前言仍写 "The conversation history before this point was compacted into…"，但它前面的内容并不是它摘要的对象；而且 R#06 的内容已被 R#10 合并过一遍 → **重复 + 自相矛盾** | `req-11.json` 逐条 dump（用带自增编号的假端点才分得清哪份是哪份） | ⚠有但有害 |
| `tokensBefore` 与 `estimatedTokensAfter` **不同量纲** | `tokensBefore` 取 provider 上报用量(+尾部估算)，`estimatedTokensAfter` 是纯内容估算 → 实测出现 `tokensBefore:15 / estimatedTokensAfter:124`（压缩后比压缩前"大"） | `compaction_end` 事件原文；`compaction.ts:202 estimateContextTokens` 用 `getLastAssistantUsageInfo` | ⚠有限制 |
| `session_before_compact` 能 **cancel** | 能，干净取消：不写 compaction 条目，后续对话正常 | 扩展返回 `{cancel:true}` → `{"type":"compaction_end","reason":"manual","aborted":true}`；会话文件 `compaction 条数= 0` | ✅ |
| `session_before_compact` 能 **完全接管**（自定义压缩，可不调 LLM） | 能，且落盘打 `fromHook:true` 标记 | 扩展返回自定义 compaction → 落盘 `{"summary":"ZZ-CUSTOM-SUMMARY 本次压缩由扩展接管，未调用任何 LLM。",…,"details":{"zzProbe":true,…},"fromHook":true}`，`session_compact fromExtension=true` | ✅ |
| 钩子给的 `preparation` 内容 | `firstKeptEntryId,messagesToSummarize,turnPrefixMessages,isSplitTurn,tokensBefore,previousSummary,fileOps,settings` + `branchEntries`(全支) | 探针日志 `prepKeys=…` | ✅ |
| **压缩出口零校验（比主控发现的更狠）** | 扩展返回 `{summary:"", firstKeptEntryId:"deadbeef", tokensBefore:-999}` → **全盘接受、原样落盘**，且**整段历史从上下文消失**，模型只收到一个空摘要 | 落盘 `{"summary":"","firstKeptEntryId":"deadbeef","tokensBefore":-999,"fromHook":true}`；下一轮 `req-28.json` 只剩 3 条：system + `The conversation history before this point was compacted into the following summary:\n\n<summary>\n\n</summary>` + 新问题 | ❌ 致命 |
| `branch-summarization.ts` 干什么 / 真触发过吗 | 干「切分支时给被放弃的那一支做 LLM 摘要」，`/tree` 弹窗三选一（No summary / Summarize / Summarize with custom prompt）。**真触发过** | pty 截屏拍到弹窗；落盘 `branch_summary 0403119c <- bff70718 fromId=bff70718 summary="The user explored a different conversation branch before returning here.\nSummary of that exploration:\n\n收到。" details={"readFiles":[],"modifiedFiles":[]} fromHook=False`；注入模型时包一层 `The following is a summary of a branch that this conversation came back from:\n\n<summary>…</summary>`（**user 角色**） | ✅ |
| 分支摘要同样零校验 | 假端点回的 3 个字 `收到。` 被原样当摘要注入 | 同上 `summary=…\n\n收到。` | ⚠ 同上 |
| 分支摘要的取材边界 | 从旧 leaf 回溯到**公共祖先**（不含公共祖先本身）；被切中的 user 消息文本回填到编辑器而不进摘要 | `req-14.json` 的 `<conversation>` = `[Assistant]:收到。/[User]:T3…/[Assistant]:收到。`（`T2` 这条 user 不在内） | ✅ |
| 压缩默认阈值 | `enabled:true / reserveTokens:16384 / keepRecentTokens:20000`，可经 `<agentDir>/settings.json` 的 `compaction` 覆写（我压到 120 才逼出小会话压缩） | `settings-manager.ts:778-784`；我写入 `{"compaction":{"enabled":true,"reserveTokens":1000,"keepRecentTokens":120}}` 后压缩真触发 | ✅ `[仅静态+实测]` |
| harness 的 `retainedTail` 是真检查点 | `getBranch()` 遇到带 `retainedTail` 的压缩点**就停**（返回 2 条），上下文 = `compactionSummary,user,assistant,user`；旧内容 `SECRET-OLD` 不在，`尾部保留` 在；原始 5 条 message 仍在文件里 | `zz-a3-session-probe.test.ts` → `[A3] getBranch 返回条数= 2 类型= compaction,message`、`含旧秘密? false 含尾部保留? true`、`retainedTail 条数= 2` | ✅ |
| **出货 CLI 不认识 `retainedTail`（文档写了、代码为零）** | `grep -rn retainedTail packages/coding-agent/{src,test}` = **0 命中**；而 `docs/session-format.md` 第 240/245/327/337/342 行明确描述其语义 | 见下「跨栈互操作」实测 | **[有但无效]** |
| 跨栈互操作：harness 写的会话被出货 CLI 打开 | **不报错，但静默丢数据**：`retainedTail` 里的「尾部」消息**整段消失**，`leaf` 条目被静默跳过 | 用 harness 写会话（含 `compaction{retainedTail:[尾部]}`）→ `cli.js --session <该文件> -p "…"` → 模型只收到 `<summary>HARNESS-COMPACT</summary>` + `压缩后` + 新问题，**没有「尾部」** | ❌ 危险 |

### 3. 上下文文件

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 祖先链搜索深度 | **无上限、无 `.git` 边界**：一路 `dirname` 到根才停 | 造 6 层目录树，在 `deep/`、`deep/l1/l2/l3/`、`cwd/` 各放 AGENTS.md → system prompt 里 3 个 `<project_instructions path=…>` 全在，含 6 层之上的 `ANCESTOR-MARKER-DEEP-6LEVELS`；`resource-loader.ts:148 if (parentDir === currentDir) break;` 是唯一终止条件 | ⚠安全隐患 |
| 顺序 | 全局 `<agentDir>/AGENTS.md` 最前，然后祖先由远及近 | 同上输出顺序 `deep → l3 → cwd` | ✅ |
| `--no-context-files` | 生效，`<project_context>` 整段消失 | `含 project_context: False`，system prompt 1860 字符 | ✅ |
| **AGENTS.md/CLAUDE.md 不受项目信任门管辖** | `--no-approve` 下仍全量加载 | `--no-approve 时仍含 project_context: True / 含 CWD-MARKER: True` | ❌ 安全不一致 |
| 全局 `SYSTEM.md`（`<agentDir>/SYSTEM.md`） | **整体替换**内置系统提示（工具清单/守则/pi 文档指引全没了），长度从 1860 → 865 | 写入后 system prompt 首 90 字 = `ZZ-GLOBAL-SYSTEM-PROMPT 我是被 SYSTEM.md 完全替换掉的系统提示。\n\n\n<project_context>…` | ✅（但替换是"全有全无"） |
| `APPEND_SYSTEM.md` | 紧跟在系统提示之后追加 | `…完全替换掉的系统提示。\n\n\nZZ-GLOBAL-APPEND 这是追加段。\n\n\n<project_con…` | ✅ |
| 项目 `.pi/SYSTEM.md` **受信任门** | 未信任 → 用全局；`--approve` → 项目胜出；`--no-approve` → 退回全局 | 三次运行首 60 字分别为 `ZZ-GLOBAL-…` / `ZZ-PROJECT-SYSTEM 项目级 .pi/SYSTEM.md（需信任）` / `ZZ-GLOBAL-…` | ✅ |
| 信任门覆盖范围 | `settings.json / extensions / skills / prompts / themes / SYSTEM.md / APPEND_SYSTEM.md`——**唯独不含 AGENTS.md/CLAUDE.md** | `trust-manager.ts:29-37` + 上面 `--no-approve` 实测 | ⚠ |

### 4. Skill

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 加载路径 | 全局 `<agentDir>/skills/`、项目 `<cwd>/.pi/skills/`、`--skill <文件\|目录>` 三条都真生效 | 未信任时只出 `globalskill(agent-dir)`；`--approve` 后出 `globalskill(.pi)/huge/projskill`；`--no-skills --skill <path>` 只出 `pathskill` | ✅ |
| 项目 skill 受信任门 | 是 | 同上，`--no-approve` 时 `.pi/skills` 里 3 个 skill 全不出现 | ✅ |
| `--no-skills` | 生效（`<available_skills>` 整段消失），但**不影响** `--skill` 显式路径 | `✗ 无 available_skills 段` / 加 `--skill` 后又出现 | ✅ |
| 注入形态 = **渐进式披露** | system prompt 只放 `name/description/**location**` + 一句"用 read 工具去读"，**正文不进上下文** | 480KB 正文的 `huge` skill 在场时 system prompt 仅 5097 字符 | ✅ 设计好 |
| **同名冲突** | **项目胜出**，且**有诊断**（但只在交互式看得到） | 交互式 `--verbose` 首屏：`[Skill conflicts]  "globalskill" collision:  ✓ auto (project) …/.pi/skills/globalskill/SKILL.md   ✗ …/agent-dir/skills/globalskill/SKILL.md (skipped)` | ✅ |
| **诊断在非交互模式全丢** | `-p` / `--mode rpc` 下即使加 `--verbose`，stdout/stderr **一个字都没有** | `--verbose --approve -p "hi"` → stdout 仅 `R#40`，stderr 空 | ⚠ |
| `description` 超 1024 | 仍加载，只给 warning（同样只在交互式可见） | 1200 字描述照样进 `<available_skills>`（`desc 长度= 1200`）；交互式显示 `description exceeds 1024 characters (1200)` | ⚠ |
| **skill 正文超长** | 不进上下文时无事；一旦 `/skill:huge` 显式调用则**整段内联、零截断、零告警** | `/skill:huge` → 注入的单条 user 消息 **180297 字符**（请求体 512KB），模型窗口 128k tokens | ❌ 无护栏 |
| `disable-model-invocation: true` | 真从 `<available_skills>` 排除，但 `/skill:hidden` 仍可显式调用 | `--approve` 那次列表里没有 `hidden`；`{"type":"prompt","message":"/skill:hidden …"}` → 注入 `<skill name="hidden" location="…">` | ✅ |
| `/skill:name` 展开形态 | `<skill name=… location=…>\nReferences are relative to <baseDir>.\n\n<正文>\n</skill>` + 余下参数 | `req-41.json` 末条 user | ✅ |
| `/skill:不存在` | **静默原样透传**为普通文本，无任何错误 | `req-43.json` 末条 user = `"/skill:nope 不存在的技能"` | ⚠ |
| skill 里的 `scripts/` / `references/` 相对引用 | **工具层不认**：相对路径按 **cwd** 解析 → ENOENT。只有模型自己照提示词拼绝对路径才行 | 假端点发 `read {"path":"references/rules.md"}` → tool 结果 `ENOENT: no such file or directory, access '…/skx/references/rules.md'`；换成绝对路径 → `RULES-BODY 引用文件内容` | ⚠ 靠模型自觉 |
| frontmatter 7 字段只活 3 个 | **确认**，且这是**写进 pi 自己测试的有意设计**，不是 bug | `skills.ts:67-72` 只声明 `name/description/disable-model-invocation`；`test/skills.test.ts:87` `it("should ignore unknown frontmatter fields")` 断言 `expect(diagnostics).toHaveLength(0)`；真跑 `npx vitest run test/skills.test.ts --silent=false` → `Tests 28 passed`。实测放了 `allowed-tools/license/compatibility/metadata/version` 五个字段，`get_commands` 与 system prompt 里一个都不出现 | **[声明放弃]**（但对 Agent Skills 规范而言是**不完整实现**，`allowed-tools` 是规范字段） |
| harness 有一套**平行**的 skills 实现 | `packages/agent/src/harness/skills.ts` 有结构化诊断码（`file_info_failed/list_failed/read_failed/parse_failed/invalid_metadata`）、异步 `ExecutionEnv`、`skill.content` 预载；仍只认那 3 个字段 | 源码 + `formatSkillsForSystemPrompt` 与 coding-agent 版文案不同（`Read the full skill file` vs `Use the read tool to load`） | ⚠两套并行 `[仅静态]` |

### 5. Prompt 模板

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `--prompt-template <文件\|目录>` | 生效，进 `get_commands`（`source:"prompt"`） | `{"name":"reviewx","description":"A3 测试用提示模板：接受位置参数","source":"prompt",…}` | ✅ |
| 参数替换 | bash 风格：`$1 / $ARGUMENTS / ${2:-默认} / ${@:2}` 全部生效 | `/reviewx src/a.ts 空指针 越权` → `请评审文件 src/a.ts，重点关注 空指针。\n全部参数：src/a.ts 空指针 越权\n从第2个起：空指针 越权`；`/reviewx`（无参）→ `请评审文件 ，重点关注 默认重点。` | ✅ |
| **与 skill 的本质区别** | 模板**不进 system prompt**（模型不知道它存在），纯人触发的宏展开；skill 进 system prompt 供模型自选 | `含 available_skills: False \| 含 reviewx: False`（system prompt 1840 字符） | ✅ |

### 6. 顺带打到的（我范围内、值得记）

| 项 | 结果 | 证据 |
|---|---|---|
| **`--mode rpc` 是完整可编程面** | 有 `prompt/steer/follow_up/abort/compact/set_auto_compaction/bash/fork/clone/switch_session/get_tree/get_entries/get_fork_messages/get_commands/get_session_stats/export_html/set_session_name/…` 30+ 条 JSONL 命令 | `grep -n 'case "' rpc-mode.ts` + 我全程用它驱动 |
| RPC 缺 `navigateTree` | `/tree`（同文件内切支）**只有 TUI 能走**，RPC 无对应命令；`agent-session.ts:2895 navigateTree` 无任何非 TUI 调用点 | `grep -rn "navigateTree"` 无调用者 |
| `AgentHarness` 是**公开 API** | `@earendil-works/pi-agent-core` 的 `src/index.ts` 第 6/14/29-59 行 `export * from "./harness/…"` 全量导出 | 即：即便出货 CLI 不用它，我们可以直接当库用 |

---

## 二、我方对照

| pi 的能力 | 我方是否有 | 我方实现位置 / 证据 | 谁强 |
|---|---|---|---|
| 会话持久化为 JSONL 树（`id`/`parentId`） | ❌ **没有**。我方只有扁平 `conversationId → QueryTask[]` | `apps/agentcore/src/persistence/repos.ts:165 listByConversation(tenantId, conversationId)`；`grep -rn "parentId" persistence/*.ts contracts/qos.ts` = 0 命中 | **pi 强** |
| fork / 分支 / 回到历史节点 | ❌ 没有任何 fork/branch 概念 | 同上 | **pi 强** |
| 分支摘要（切支时摘要被放弃的那一支） | ❌ 没有 | — | **pi 强** |
| 上下文压缩 | ✅ 有，且更成体系：token 预算器（Anthropic `count_tokens` 每 2 轮实测 + 期间 `chars/3.5` 估算，软 70% / 硬 90%）；三刀清理（折叠最旧迭代 tool_result → 服务端 compaction → 强制收尾） | `apps/agentcore/src/agent/context.ts:312 ContextBudgeter`、`:160 foldOldestFrame`、`:22 CONTEXT_FULL_REMINDER` | **我方强** |
| 工具结果截断 | ✅ `truncateToolResultJson`：**在最大数组维度二分截断保 JSON 结构合法**，并附「共 n 条仅含前 k 条，请用更精确过滤重查」尾注（把"取太多"变成模型可自纠信号）；非数组超长降级为 `{_truncated,preview}` | `context.ts:99-133` | **我方强**（pi 侧无对应，工具输出截断在别处且无结构感） |
| **摘要出口校验** | ✅ 有，且**明确针对 pi 这个坑写的**：`summaryLooksAnchored()` 从笔记抽「锚点」（数字/百分比/标识符），摘要一个锚点都不命中即判失效 → 退确定性兜底并打 `[[SUMMARY_DEGRADED]]` 标记 | `context.ts:227-306`；注释原文：「某宿主的摘要提示词严格要求结构化模板，模型回了 8 个不相干的字，宿主**原样注入并永久丢弃原文**——它的出口校验也只有「非空」。我们此前一模一样。」 | **我方强**（pi 实测：空串/垃圾/负数/不存在的 `firstKeptEntryId` 全盘接受） |
| 摘要确定性兜底 | ✅ `defaultRollingSummary`：去重、近端优先、有界（1600 字）、纯函数无时钟随机 → CI 字节级可复现 | `context.ts:191-213` | **我方强**（pi 的压缩必须调 LLM，测试里只能 mock） |
| 压缩留痕 | ✅ `ContextBudgeter.record()` → `ContextOp[]` + Prometheus `contextOps` 计数 | `context.ts:356-359` | **我方强** |
| 压缩非破坏性（原文可回溯） | ✅ 我方审计存全量（`truncateToolResultJson` 注释：「审计仍存全量（tool_calls 既有规则，不经过此函数）」）；pi 的 JSONL 也全量保留 | 双方都有 | 平 |
| Skill：定义 | ✅ 契约化：`tenantId/key/version/status(DRAFT\|PUBLISHED)/capability/sideEffect(READ\|WRITE)/approvalGate(none\|human)/provenancePolicy/inputSchema/outputSchema/references[{kind,key,role,required}]/resources` | 活服务 `curl …/b/v1/skills` → 7 个 skill，字段全集如左 | **我方强**（pi 只有 name/description/filePath/baseDir/disableModelInvocation） |
| Skill：质量门禁 | ✅ `skill-lint.ts`：body 七段骨架（目的/适用边界/前置检查/步骤/示例/失败处理/输出要求）、禁词表（"有用/强大/全面/各种/帮助你/介绍"）、summary ≤200 / body ≤3000、工具名拼写反查注册表、`dependsOn` 循环依赖 + 发布态要求依赖已 PUBLISHED | `apps/agentcore/src/skill-lint.ts:41-52` | **我方强**（pi 只校验 name 字符集 + description 非空，且超限只 warning） |
| Skill：评测/探针 | ✅ `skill-probe.ts`（412 行） | — | **我方强** |
| Skill：注入策略 | ✅ **语义 top-k**：embedding 余弦（主）+ 词法重叠（次，平手裁决），top-k 注入全文 summary，其余降级为 id+名由 `load_skill` 按需取 | `apps/agentcore/src/agent/skill-router.ts:1-70`（注释直指"此前全量注入挤占预算、稀释相关性"） | **我方强**（pi 把**所有**非隐藏 skill 的 name+desc 全量注入，skill 一多线性膨胀） |
| Skill：资源附件 | ✅ `read_skill_resource` + `LocalFsSkillResourceReader` 带路径穿越防护（`normalize` + 拒 `..`） | `apps/agentcore/src/tools/skill-resources.ts:22-45` | **我方强**（pi 的相对引用实测 ENOENT，纯靠模型自觉拼绝对路径） |
| Skill：文件系统即写即用 | ❌ 我方要走 API + 发布流程 | — | **pi 强**（作者体验） |
| Skill：显式调用 `/skill:name` | ⚠ 我方有 `load_skill` 工具（模型侧），无「用户强制内联」入口 | `tools/registry.ts LOAD_SKILL_TOOL` | pi 略强 |
| 上下文文件（AGENTS.md 沿祖先链） | ❌ 我方无此机制（我方是租户/角色驱动的 system prompt） | `apps/agentcore/src/agent/prompts.ts` | pi 有、我方按需 |
| Prompt 模板（`$1/${@:2}` 宏） | ❌ 无对等物 | — | pi 有 |
| 会话导出为自包含 HTML | ❌ 无 | — | pi 有 |

---

## 三、我方没有、pi 有的 —— 逐条判价值

| 能力 | 对我们的价值 | 理由（结合多租户/审批/溯源/确定性约束） | 建议 |
|---|---|---|---|
| **会话树（`id`/`parentId` + 同文件多分支）** | **高**。这是「方案对比 / 反事实双轨推演」缺的那块地基：同一决策上下文下派生 N 条推演支，每支独立演进、可随时切回、可并列对比。我方现在只有 `conversationId → QueryTask[]` 扁平表，做"两个方案并排推演"只能靠上层各建一个 conversation，**共同前提无法结构化共享，也无法证明两支起点相同** | 与我方约束**相容**：树是纯数据结构，`tenantId` 照常带；每条 entry 有稳定 ID → 天然是溯源锚点；确定性种子不受影响 | **立即取（取设计，不取代码）**：在 `QueryTask` 上加 `parentTaskId`，在 contracts 里定义 `branch(fromTaskId)`；**不要**照搬 JSONL 落盘（我方是 pg 仓储双实现） |
| **fork 时保留祖先 entry ID** | **高**。两支跨文件仍能按 ID 对齐，做"同一节点两种走法"的 diff 只需比 ID 集合 | 直接服务溯源不变量：同一 `⟦ref:N⟧` 证据在两支里可判定是否同源 | **立即取（设计）** |
| **分支摘要（切支时摘要被放弃的那一支并注入新支）** | **中高**。反事实推演的关键补充：切到方案 B 时让模型知道"方案 A 探到哪、卡在哪"，避免重复试错 | 但 pi 的实现零校验（3 个字也收）。我方已有 `summaryLooksAnchored` + 降级标记，可直接复用到分支摘要上 | **值得学不取代码** |
| **`retainedTail` 自包含压缩检查点** | **中高**。压缩点即检查点 → 重建上下文 O(1)、不必回溯更早条目；也让"从某个检查点重放"变得干净 | 与我方"审计存全量、上下文存精简"两分法完全一致 | **值得学**（注意：pi 自己的出货 CLI 都不认它，取思想别取实现） |
| **压缩的滚动合并（`<previous-summary>` + UPDATE 提示词）** | **中**。我方 `makeLlmRollingSummarizer` 是"把折叠笔记压一遍"，pi 是"拿旧摘要 + 新消息做增量更新"，长会话下后者信息衰减更慢 | 需配合我方的锚定校验（否则一次坏合并会污染此后所有摘要——pi 的二次压缩正是这个风险） | **值得学** |
| **`--mode rpc` JSONL 可编程面** | **中**。做 agent 的自动化回归/评测很顺手（我这轮整个压缩深挖都靠它） | 我方已有 REST + SSE，形态不同但目的相同 | **观望** |
| **会话导出自包含 HTML（内嵌完整 JSON）** | **中**。审批/复盘场景可以"一个文件交出去" | 我方审批链需要可交付的证据包 | **值得学** |
| 上下文文件沿祖先链（AGENTS.md） | **低**。对 CLI 开发者有用；我方是服务端多租户，system prompt 由租户/角色/本体驱动，不该被文件系统旁路 | 且 pi 这条路**不过信任门**（实测 `--no-approve` 仍加载）——放进我方等于开一个不受 entitlement 管的提示注入口 | **不要** |
| Prompt 模板（bash 风格宏） | **低**。我方 skill 的 `inputSchema` 已经是更强的参数契约 | — | **不要** |
| skill 的 `--skill <path>` 文件系统直载 | **低偏中**。对"本地调试一个 skill"有用，但绕过我方 `status/version/lint/approvalGate` 全部治理 | 与"发布门"直接冲突 | **不要**（若要，只能开在 DRAFT 预览通道） |

---

## 四、致命限制（若我们基于 pi 开发会踩的坑）

1. **压缩出口零校验 —— 会静默销毁工作上下文。**
   实测：`{summary:"", firstKeptEntryId:"deadbeef", tokensBefore:-999}` 被原样落盘，下一轮模型只收到 `<summary>\n\n</summary>`，5 轮历史全部消失，**零告警**。默认 LLM 摘要器同样只判非空（主控已证 8 字垃圾照收）。我方 `summaryLooksAnchored` 正是补这个洞——**若基于 pi 开发，这层必须我们自己加，pi 不会给。**

2. **两套并行的会话栈，格式不兼容且静默丢数据。**
   `packages/agent/src/harness/**`（新，写 `retainedTail` + `leaf`）与 `packages/coding-agent/src/core/session-manager.ts`（出货 CLI，只认 `firstKeptEntryId`）。实测把 harness 写的会话喂给出货 CLI：**不报错，但 `retainedTail` 里的消息整段消失**。而 `docs/session-format.md` 是**按 harness 语义写的**（第 240/245/327/337/342 行），出货代码 `grep retainedTail` = 0 命中 → **文档与出货实现分叉**。选层要极其小心：跟着文档写会踩空。

3. **二次压缩会在上下文中央留下过期摘要，且前言自相矛盾。**
   实测 2 次压缩后模型看到 `<summary>新</summary> … <summary>旧</summary> …`，两个都写 "history before this point was compacted into…"，而旧的那份内容已被新的那份合并过一遍。会话越长这类"化石摘要"越多。

4. **`tokensBefore` / `estimatedTokensAfter` 不同量纲**，任何基于二者做"压缩收益"的监控/自动策略都是错的（实测出现 after > before）。

5. **上下文文件不过信任门。** `AGENTS.md`/`CLAUDE.md` 沿 cwd 祖先链一路找到 `/`，**无深度上限、无 `.git` 边界、`--no-approve` 也拦不住**，直接进 system prompt。同一份 `trust-manager` 却把 `.pi/SYSTEM.md` 管得死死的。多租户服务端若沿用此机制 = 开了一个不受 entitlement 管的提示注入面。

6. **skill 显式调用无长度护栏。** `/skill:huge` 把 180297 字符正文一次性内联进单条 user 消息（128k 窗口），零截断零告警。我方 skill body 有 3000 字 lint 上限，pi 没有。

7. **诊断在非交互模式全部丢失。** 同名冲突、description 超限、skill 路径不存在……`-p` 与 `--mode rpc` 下即使 `--verbose` 也一个字不打。服务端集成（我们必然是非交互）等于全程盲飞。

8. **skill frontmatter 只认 3 个字段，且是写进测试的有意设计**（`test/skills.test.ts:87` 断言未知字段的 diagnostics 长度为 0）。`allowed-tools` 是 Agent Skills 规范字段却被丢弃 → **skill 无法自带权限边界**。我方 `sideEffect`/`approvalGate`/`references.required` 这类治理字段在 pi 里没有落点，只能全部外挂。

9. **`/tree`（同文件内切支）只有 TUI 有。** RPC 面没有 `navigateTree`，`agent-session.ts:2895` 的 `navigateTree` 在仓里零非 TUI 调用点。也就是说：**pi 最有价值的"反事实双轨"能力，在无头集成场景下拿不到**——只能用 `fork`（每支一个新文件）。

10. **skill 相对引用靠模型自觉。** 提示词写"references 相对 skill 目录"，但工具层按 cwd 解析 → 实测 ENOENT。模型一旦忘了拼绝对路径就静默失败。

---

## 五、越界线索（边界外发现，交主控）

1. **`--mode rpc` 是被低估的一整面**（不在我边界内，但我全程靠它取证）。30+ 条 JSONL 命令，含 `steer`/`follow_up`/`abort`/`set_auto_retry`/`abort_retry`/`bash`/`extension_ui_response`。评估「pi 能不能当我们 agent 的执行内核」时，这比 CLI/TUI 重要得多。建议派人专测。
2. **`SessionBeforeTreeResult` 允许扩展改写分支摘要指令**（`customInstructions` / `replaceInstructions` / `label`），`SessionBeforeCompactResult` 允许整体接管——扩展层对上下文的控制权比主控测到的 `context` 注入更大。属 A4 边界。
3. **项目信任模型**（`trust-manager.ts` 的 `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`）与上下文文件的不一致，是个独立的安全议题，建议单列一条。
4. `packages/coding-agent/examples/extensions/` 有 70+ 个官方扩展示例（含 `custom-compaction.ts`、`subagent/`、`permission-gate.ts`、`plan-mode/`、`sandbox/`）。`subagent/` 的存在与"README 声明 No sub-agents"需要主控核对口径。
5. `--export` 的 HTML 把整份会话 JSON base64 内嵌 —— 若我方要做"审批证据包"，这是现成范式。

---

## 六、我没能验证的（诚实列出，别装作验过）

1. **真实 LLM 下的压缩质量**。全程用假端点，摘要内容都是 `R#NN`/`收到。`。我验的是**管道与校验**，不是摘要好不好。
2. **自动压缩（threshold / overflow 两种 reason）的真实触发**。我只跑了 `reason:"manual"`（RPC `compact`）与扩展钩子。`overflow` 恢复路径（`willRetry:true`）没跑到。主控已测过触发判据，我没重复。
3. **`session_before_tree` 钩子**（能 cancel / 改摘要指令 / 打 label）只读了类型定义，**没真跑**——它只能从 TUI 触发，pty 驱动成本高。标 `[仅静态]`。
4. **`switch_session` / `clone` / `createBranchedSession(leafId)` 的 leaf 语义**没单独验，只验了 `fork`。
5. **sqlite 会话后端**（`packages/storage/sqlite-node`、`test/harness/sqlite-*.test.ts`）完全没碰。若我们要服务端持久化，这一层值得再派人。
6. **skill 的 `.gitignore/.ignore/.fdignore` 过滤**、符号链接去重、`nested/` 递归规则只读了代码 + 跑了 pi 自带的 28 个单测，没做我自己的对抗性验证。
7. **多 skill 规模下 system prompt 的膨胀曲线**（pi 全量注入 name+desc）我只造了 4 个 skill，没量到 50/100 个时的真实 token 占用。
8. **harness 的 `AgentHarness` 本体**（1185 行）我只跑了它的 session/compaction 子系统，没跑完整 harness 生命周期——那是 A2 的 `agent.ts`/`agent-loop.ts` 邻域，我没越界。
