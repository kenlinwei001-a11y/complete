# DSH Web UI 实测取证（B 路可行性）· 2026-09-17

**取证头**：`@deepseek-ai/dsh@0.1.5-rc.2` 装在 scratchpad（522 包 / 305MB / 241 个 `@deepseek-ai` 包），
`npx dsh web --no-open --host 127.0.0.1 --port 13080`。**产品源码零改动**，本文件只记结论。

> **B 路** = 保留 DSH 的对话外壳，把我们的本体/推演面板做成它的 UI 模块挂进去。
> 本次要回答的就一件事：**这个挂载点是不是真的存在、契约长什么样。**

---

## ① 跑得起来吗 —— ✅ 跑起来了

| 判据 | 实测 |
|---|---|
| 启动 | `dsh web: http://127.0.0.1:13080/?token=<...>`，二次采样字节数稳定即已就绪 |
| HTTP（带 token） | **303**（正常重定向） |
| HTTP（不带 token） | **401** ⇒ **鉴权是真的，不是装饰** |
| 浏览器页面错误 | **0 条**（Playwright `pageerror` 全程零捕获） |
| 页面标题 | `DeepSeek Harness` |

⚠ **`waitUntil: "networkidle"` 会超时**，因为它挂长连接、网络永不空闲。
判据必须换成 `domcontentloaded` + 显式等待。**照 networkidle 会把「跑起来了」误判成「起不来」。**

⚠ 首屏两道弹窗：`Internal Testing Notice`（自陈 developer preview，核心插件与基础 API 未来数月仍会快速演进）
→ `Add an API key to get started`（可「Configure later」跳过）。

---

## ② B 的挂载契约 —— ✅ 存在，且是公开机制

`@deepseek-ai/dsh-client-modules` 的 package 描述原文：

> "Client module system, **dual-face**: node half composes the `__DSH_BOOT__` entry graph
> (**incremental `dsh.client` scan**, bundle route, index tap, **webPlugins service**);
> browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam"

⇒ 它**扫 `package.json` 里的 `dsh.client` 字段**来发现 UI 模块。实测契约形状
（取自 `@deepseek-ai/dsh-client-ui-chat`，它自己就是一个标准模块）：

```json
"dsh": {
  "client": {
    "inject":   ["@deepseek-ai/dsh-client-ui-conversation",
                 "@deepseek-ai/dsh-client-ui-layout",
                 "@deepseek-ai/dsh-client-ui-renderer",
                 "@deepseek-ai/dsh-client-ui-session",
                 "@deepseek-ai/dsh-client-ui-sidebar-right",
                 "@deepseek-ai/dsh-client-ui-settings",
                 "@deepseek-ai/dsh-client-ui-workspace",
                 "@deepseek-ai/dsh-client-locale",
                 "@deepseek-ai/dsh-api-session-controller",
                 "@deepseek-ai/dsh-api-workspace-controller"],
    "platform": "web"
  }
}
```

可选键（实测于其他模块）：`external`（如 `"@deepseek-ai/dsh-api-gateway/client"`）、`immediately: true`。
`peerDependencies` 只要 `@deepseek-ai/cordis: ^4.0.2`。

**金丝雀（证明这不是孤例、也不是内部私货）**：241 个包里 **65 个带 `dsh` 字段**。

**CLI 侧的两个装载入口**（`dsh --help` 原文）：
- `--patch <path>` — extra patch-list overlay applied after the profile layer（**可重复**）
- `dsh plugin ...` — manage a profile's plugins by forwarding the remaining arguments to pnpm

⇒ **B 路成立。** 做法 = 写一个我们自己的包（如 `@platform/dsh-client-ui-ontology`），
声明 `dsh.client.inject` 挂上 layout/renderer + 我们自己的 API controller，
再用 `dsh plugin add` 或 `--patch` 装进 profile。

---

## ③ 能不能架在我们的网关后、带我们的 JWT —— ◑ 有接口，未实测

`dsh web --help` 给了 `--trusted-host <authority...>`：
「extra authority the **/api browser-trust fence** accepts (host or host:port; repeatable)」

⇒ 它有一道 **/api 浏览器信任围栏**，且**可以加授权方** —— 这正是反代要用的口子。
但它自己的鉴权是 **URL token**（`/?token=<...>`，无 token 401），
**与我们的 Bearer JWT / `X-Debug-User` 不是同一套**。

⛔ **本次没有实测**「网关反代 + JWT 透传」这条路。**这是 B 路剩下的最大未知数**，
必须单独验证，不许拿本节当证据。

---

## ④ 版本 —— 我们落后一整条产品线

| 包 | 本机 | registry `latest` | 备注 |
|---|---|---|---|
| `@deepseek-ai/dsh`（**产品本体**） | 未装 | **0.1.5-rc.1** | UI 在这里 |
| `dsh-agent` 等 14 个运行时子包 | 0.1.0-rc.6 | 0.1.0-rc.6 | 标签自 08-13 起 35 天未动 |
| `@deepseek-ai/cordis` | 4.0.1 → **4.0.2** | 4.0.2 | 本会话已升，13/13 回归绿 |

上游仓 tag 实测到 `dsh-v0.1.6-alpha.1`。

> **形态（照铁律 0.6 句式，本次亲身犯过一次）**：
> **「我用『我们装的那 18 个运行时包里没有 UI 资产』当作『DSH 没有 UI』的证据，
> 而前者并不度量后者 —— 我们只装了它的运行时子集，UI 在没装的顶层包里。」**
> 金丝雀证明了**查法**是好的（79 个 `.js` 命中），但没证明**查的范围**是对的。
> 「我没找到」和「它不存在」仍然是两个命题。

---

## ⑤ 升级的真实成本（另开单时照这个报）

`packages/dsh-harness/plugins/mcp-client-tenant.mjs` 是 **33,825 字节的 vendor fork**，
按上游 sha256 `50ff18e7…` 钉在 rc.6（`test/drift-check.mjs`）。
跳到 0.1.5 要跨 5 个次版本重新 fork —— drift-check 的报错原文就是
`re-apply D1/D2/D3 onto the new upstream and update the pins`。

---

## 顺带记两条本次踩到的坑（都会骗人）

1. **`pnpm --filter <pkg> add` 会打断别的包的符号链接。**
   升 cordis 4.0.1→4.0.2 改变了 peer 解析哈希，`apps/agentcore/node_modules/@deepseek-ai/*`
   当场悬空（旧 hash `3a4119f…` 不存在了，新的是 `c67a020b…`），
   表现为 `Cannot find package '@deepseek-ai/dsh-sdk-client'`，
   **极易被误读成「翻 DSH_HARNESS 把代码弄坏了」**。修法：根目录 `pnpm install` 重链。
2. **端口只能靠真 bind 判空闲。** 本机无 `ss`/`netstat`，它们的沉默会被读成「端口空闲」。
   本次用 `net.createServer().listen()` 实测 13080/13081/3080 三个口。
