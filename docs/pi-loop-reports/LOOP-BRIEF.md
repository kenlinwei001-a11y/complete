# LOOP 共享简报 · pi 全功能实测 vs 我方 AgentCore

## 任务目的（仓主原话）

> 把 PI 的功能都 100% 测试一下，与目前系统 agent 有的功能比较，目前系统 agent 没有的，就判断它的价值。
> 结论要回答：**PI 是否是一个可以依赖的框架，我们系统的 agent 未来是否基于它开发**，已有的 agent / MCP / skill 等功能如何与其连接。

## ⛔ 铁律（违反即退单，不接受"我看了源码觉得"）

1. **真跑 > 读码。** 每一条结论必须附**你实际执行的命令 + 真实输出片段**。
   只有 grep/读源码支撑的条目，必须显式标 `[仅静态]`，不得与实测条目混列。
2. **区分三种"没有"**：
   - `[声明放弃]` 官方文档明写不做（例：README 写 "No MCP." "No sub-agents."）——**这不是缺陷**
   - `[设计稿]` 文档/设计文写了、代码为零（例：`lane` 文档 296 处 / 代码 0）
   - `[有但无效]` 文档当能力写、实测不生效（例：skill `allowed-tools` 解析后被静默丢弃且零诊断）
3. **失败要留证**：命令失败、假设被推翻，照实写。**推翻自己的假设比确认它更有价值。**
4. **不改任何仓库代码。** 全部工作在 scratchpad 自己的目录里。pi 仓可加临时探针文件（前缀 `zz-`），我方仓 **只读**。
5. **不要重复别人的活**：只做你 🚦范围边界 内的事。边界外发现的重要线索，写进报告的「越界线索」节交给主控，不要自己动手。

## 环境（已就绪，直接用）

| 项 | 路径/地址 |
|---|---|
| pi 仓（已 `npm ci` + `npm run build`，v0.83.0） | `/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/pi2` |
| pi CLI 入口 | `node <pi2>/packages/coding-agent/dist/cli.js` |
| 我方仓（**只读**，canonical `88f584ec`） | `/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/vfy-rescat` |
| 我方 DataCore（活） | `http://127.0.0.1:4201` |
| 我方 AgentCore（活） | `http://127.0.0.1:4202` |
| 我方鉴权头（开发链路） | `X-Debug-User: demo:admin:admin` |
| 报告目录 | `/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/loop-reports/` |

**调我方服务必须加 `--noproxy 127.0.0.1`**（环境有 HTTPS 代理，不加会 000）。

## 已备好的工具（别重造）

| 工具 | 用途 |
|---|---|
| `<scratch>/pty-drive.py` | pty + pyte 真 VT 驱动终端程序，脚本化 `wait/send/key/snap` 截真屏。需 `pip install pyte`（已装） |
| `<scratch>/fake-llm.py <port> '<bash命令>'` | 假 OpenAI 兼容端点：第 1 轮回一个 **bash 工具调用**，第 2 轮回文本。用于测「工具执行前弹不弹审批」 |
| `<scratch>/fake-llm2.py`（env `FAKE_PORT`/`FAKE_USAGE_IN`/`FAKE_REPLY`） | 假端点 v2：把 pi 发出的**整包请求**落盘到 `/tmp/fake-req-NN.json`。用于看「上下文里到底有什么」 |
| `<scratch>/pi-agent-dir/models.json` | pi 的 agent 目录，已配好 `fakelocal/fake-1` 指向假端点。用 `PI_CODING_AGENT_DIR=<scratch>/pi-agent-dir` |
| `/tmp/fdshim/fd` | 最小 fd 替身（pi 的 `@` 补全依赖 fd，本机没装）。`PATH="/tmp/fdshim:$PATH"` |

`<scratch>` = `/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad`

**跑 pi 的 CLI 模板**（`-p` 非交互必须 `< /dev/null`，否则挂着等 stdin）：

```bash
cd <scratch>/pi-ui-sandbox
PI_CODING_AGENT_DIR=<scratch>/pi-agent-dir NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  PATH="/tmp/fdshim:$PATH" timeout 90 node ../pi2/packages/coding-agent/dist/cli.js \
  --model fakelocal/fake-1 --api-key dummy --no-session -p "你的提示" < /dev/null
```

**跑 pi 自己的测试**：`cd <pi2>/packages/<pkg> && npx vitest run <文件> --silent=false`
> ⚠ `--silent=false` **不能省**：pi 的 vitest 配 `silent: "passed-only"`，通过用例的 console 一个字都不打。我第一轮就栽在这。

## 主控已实测的结论（别重复验，但可推翻——推翻要给证据）

- pi 自测：`pi-agent-core` 282 passed；`pi-coding-agent` 1697 passed / **16 failed**，16 红**全为环境**（本机 root → `chmod 000` 仍可读，EACCES 前提不成立；且 `fd` 未装）
- **两套并行 agent 栈**：出货 CLI `packages/coding-agent` 走 `sdk.ts:294 new Agent(...)`，对 `AgentHarness` **零引用**
- 裸 `Agent` 类：**无 `shouldStopAfterTurn`**（30 连轮全跑）；`beforeToolCall` 的 `block:true` **拦工具不拦循环**（20 轮 executed=3 blocked=17）；`abort()` 只留空壳无降级钩子；改参数**脏值直达工具零重校验**
- 扩展层（`pi.on`）**能**：`context` 注入真到达模型请求 msg[2]；`tool_call` 返回 `{block:true}` 真拦住 bash（探针文件未生成）
- 工具：默认只给模型 **4 个**（read/bash/edit/write）；`find/grep/ls` 在另一套 `createReadOnlyTools`
- CLI 工具闸实测生效：默认 4 → `--tools read` 1 → `--exclude-tools bash,write` 2 → `--no-tools` 0
- 压缩：触发判据是**内容 token**（`keepRecentTokens:20000`），不是 provider 上报用量；独立 LLM 调用 + 固定结构化模板；**出口零校验**——8 个字的垃圾摘要被原样注入且原文永久丢弃
- 上下文文件：`AGENTS.md` 沿 cwd 祖先链进 **system prompt** 的 `<project_context>`；**子目录 `sub/CLAUDE.md` 不进**
- TUI：中文宽字符全对（折行/退格删整字/光标按字符移/插入落点精确）；启动期从 GitHub 下 `fd`，403 后静默降级打死 `@` 补全
- `pi-web-ui` 在 npm 上存在（`0.75.3`，落后核心 8 版本），peerDeps 是 **`lit` + `@mariozechner/mini-lit`**，我们是 React 18

## 报告格式（严格照此，主控要机器化汇总）

写到 `loop-reports/<你的编号>.md`，同时在最终回复里给同样内容的摘要。

```markdown
# <编号> · <你的领域>

## 一、能力清单（逐条带证据）
| 能力 | 实测结果 | 证据（命令 + 输出片段） | 判定 |
|---|---|---|---|
（判定取值：✅可用 / ⚠有限制 / ❌不可用 / [声明放弃] / [设计稿] / [有但无效] / [仅静态]）

## 二、我方对照
| pi 的能力 | 我方是否有 | 我方实现位置/证据 | 谁强 |

## 三、我方没有、pi 有的 —— 逐条判价值
| 能力 | 对我们的价值 | 理由（结合我方的多租户/审批/溯源/确定性约束） | 建议 |
（建议取值：立即取 / 值得学不取代码 / 观望 / 不要）

## 四、致命限制（若我们基于 pi 开发会踩的坑）

## 五、越界线索（边界外发现，交主控）

## 六、我没能验证的（诚实列出，别装作验过）
```
