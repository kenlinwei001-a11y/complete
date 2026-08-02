# pi 评估探针与驱动器（配套 `docs/ASSESS-pi-agent-harness-replacement.md` 附录 B）

这些文件**不参与本仓构建与测试**，是评估外部项目 `earendil-works/pi` 时用的取证工具。
存进来的唯一理由：附录 B 的每条结论都声称"亲手真跑"，**跑法丢了结论就不可复核**。

## 为什么不是 grep

附录 A 的事实靠 grep，被附录 B 推翻两处（详见该附录）。**「代码里有这个符号」≠「照文档写下去能跑通」**。
本目录的工具就是为了跨过这条缝。

## API 层探针（放进 pi 的 `packages/agent/test/`）

| 文件 | 测什么 |
|---|---|
| `zz-probe-governance.test.ts` | P0 基线 · P1 有无内建迭代上限 · P2 `shouldStopAfterTurn` 可达性 · P3 mutate 后是否重校验 · P4 确定性 |
| `zz-probe2.test.ts` | Q1 `beforeToolCall` 的 `block:true` 能否停住循环 · Q2 `abort()` 之后拿得到什么 · Q3 脏参是否直达工具 |
| `zz-probe3-skill.test.ts` | `skills.md` 列的 7 个 frontmatter 字段，解析后活下来几个；拼错字段有没有诊断 |

```bash
cd <pi>/packages/agent && npx vitest run test/zz-probe2.test.ts --silent=false
```

> ⛔ **`--silent=false` 不能省**。pi 的 `vitest.config.ts` 设了 `silent: "passed-only"`，
> 通过的用例 console 输出**一个字都不打**。第一轮我因此只看到失败探针的输出，
> 误以为其余探针没跑出东西——「探针跑了 ≠ 你看得见它说了什么」，与本仓「门在跑 ≠ 门有牙」同族。

## TUI 层驱动器

`pty-drive.py` —— pty fork + `pyte` 真 VT 模拟，脚本化驱动任意终端程序并截真屏。
不是读源码猜它会画什么，是把它画出来的字符接住。

```bash
pip install pyte
python3 pty-drive.py <cwd> node <pi>/packages/coding-agent/dist/cli.js <<'EOF'
wait 4
snap 启动首屏
send 常州基地七月产能缺口是多少？
key bs bs bs
snap 退格三次（验宽字符不撕裂）
EOF
```

脚本指令：`wait <秒>` / `send <文本>` / `key <名>`（enter/esc/tab/up/down/ctrl-c/ctrl-o…）/ `snap <标签>`。

`fake-llm.py` —— 假 OpenAI 兼容端点。第 1 轮回一个 bash 工具调用，第 2 轮回文本收尾。
目的不是测模型，是**测宿主在工具执行前弹不弹审批**。

```bash
python3 fake-llm.py 8123 'echo TOOL_REALLY_RAN > /tmp/pi-approval-probe.txt; echo done'
# 再写一份 models.json 指向它（baseUrl + api: openai-completions），跑完 cat 那个文件：
# 文件存在 = 宿主零审批直接执行了模型给的 shell 命令。
```

## 变异反证的两个对照

1. **fd 有/无**：不装 `fd` 时 pi 的 `@` 文件补全全无反应；把任意 fd 塞进 PATH 后补全立刻复活。
   ——证明"补全没反应"的病因是启动期下载 fd 失败（GitHub 403），而非补全没实现。
2. **工具执行留痕**：上面那个 `TOOL_REALLY_RAN` 文件本身就是"无审批即执行"的实物证据，
   不依赖任何截屏解读。
