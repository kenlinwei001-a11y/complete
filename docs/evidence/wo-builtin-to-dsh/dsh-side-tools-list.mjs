// WO-BUILTIN-TO-DSH · 判据②的**原始读数**生产者：DSH 侧（MCP 客户端）真 spawn 内置工具
// MCP server 子进程 + 真 MCP 握手，把 `tools/list` 的**原文**打出来。
//
// ⛔ 这不是「平台侧也递了一份」：脚本里没有任何平台侧工具清单——工具名一个字都不写死，
//    全部来自子进程的 MCP 应答。平台侧的静态投影另有一处（接缝套件 C3 逐字比两者同源）。
//
// 用法（仓根）：node docs/evidence/wo-builtin-to-dsh/dsh-side-tools-list.mjs
// 退出码：0 = 读到了（且金丝雀命中）；1 = 没读到（含子进程起不来）。

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER = `${REPO_ROOT}apps/agentcore/dist/dsh-runtime/builtin-mcp-server.js`;

// ⚠ 本脚本住在 `docs/` 下（不在任何 workspace 包里）⇒ 裸包名解析不到 agentcore 的依赖树，
//    故按**显式路径**从 agentcore 的 node_modules 取 SDK（与 server 子进程同一份安装）。
const SDK = `${REPO_ROOT}apps/agentcore/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(`${SDK}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);

if (!existsSync(SERVER)) {
  console.error(`⛔ 缺 server 入口 ${SERVER}（先 pnpm --filter agentcore build）`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "wo-builtin-to-dsh-evidence", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();

// 金丝雀（否定结论的前提）：真连上了、真拿到了工具；一件都没有时报「工具坏了」而不是「没有工具面」。
if (!Array.isArray(tools) || tools.length === 0) {
  console.error("⛔ 金丝雀不中：tools/list 为空 —— 报「读不到」，不许读成「本来就没有工具」");
  await client.close();
  process.exit(1);
}
const hasQueryObjects = tools.some((t) => t.name === "query_objects");
if (!hasQueryObjects) {
  console.error("⛔ 金丝雀不中：query_objects 不在 tools/list 里 —— 本读数不构成判据②证据");
  await client.close();
  process.exit(1);
}

// harness 侧注册名：**用本仓自己的实现**（engine 侧 `dshPublicToolName` 复刻 dsh 的
// mcp-client publicToolName 规则），禁手抄拼接串。
const { dshPublicToolName } = await import(`${REPO_ROOT}apps/agentcore/dist/dsh-runtime/index.js`);
const SERVER_NAME = "builtin";

console.log("── DSH 侧 tools/list 原文（真子进程 + 真 MCP 握手；名字一个字都没写死）──");
const show = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
console.log(JSON.stringify(show.filter((t) => t.name === "query_objects"), null, 2));
console.log(`\n── 全量工具名（${tools.length} 件，wire 口径 = 裸名）──`);
console.log(tools.map((t) => `  ${t.name}`).join("\n"));
console.log("\n── 注册后的模型面全名（harness publicToolName = mcp__{serverName}__{rawName}）──");
console.log(tools.map((t) => `  ${dshPublicToolName(SERVER_NAME, t.name)}`).join("\n"));
console.log(
  `\n判定：query_objects ${hasQueryObjects ? "在" : "不在"} DSH 侧工具表；` +
    `模型可见名 = ${dshPublicToolName(SERVER_NAME, "query_objects")}`,
);

await client.close();
process.exit(0);
