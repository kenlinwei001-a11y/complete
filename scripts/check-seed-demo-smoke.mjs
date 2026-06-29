/**
 * 门 `seed-demo-smoke:check`（WO-0 · 防"绿测试≠能用"复发 · 真启动冒烟）：
 *
 * 由来（本轮两次"vitest 绿但真东西红"）：
 *  - WO-4：归域门收紧后 `SEED_DEMO=1` 真启动 datacore 崩 Exit 1（demo 整站起不来），但 vitest 778 绿
 *    （单测走 A 路绕开发布门、从不跑真种子链）→ 漏。
 *  - 教训：`pnpm -r build` + `pnpm -r test` 都过，却**从不真起一次带 SEED_DEMO 的 datacore**。
 *
 * 本门：内存模式真起 `apps/datacore/dist/server.js`（SEED_DEMO=1·无 DATABASE_URL），断言进程在超时内
 * 打印 "datacore listening"（= 种子链全过、未在 seed 期 Exit 1），否则非零退出并贴最后日志。
 * 这是 CI/`pnpm gates` 里唯一一道**真把服务起起来**的门——挡 WO-4 类"种子/启动期崩"回归。
 *
 * 前置：gates 链在本门之前已 `pnpm --filter datacore build`（dist 新鲜）。本门不重建（保持单一职责）。
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = "apps/datacore/dist/server.js";
if (!existsSync(SERVER)) {
  console.error(`✗ seed-demo-smoke: 缺 ${SERVER}（gates 链应先 pnpm --filter datacore build）`);
  process.exit(1);
}

const PORT = 4099; // 冒烟专用端口（避开 4001/4002 常用口）
const env = { ...process.env };
delete env.DATABASE_URL; // 强制内存模式（不依赖外部 pg）
Object.assign(env, {
  PORT: String(PORT),
  JWT_SECRET: "smoke",
  BLOB_DIR: mkdtempSync(join(tmpdir(), "dc-smoke-")),
  SEED_DEMO: "1",
  CREDENTIAL_KEY: randomBytes(32).toString("hex"),
  SERVICE_TOKEN: "smoke-svc",
  // 不设 LOG_LEVEL：保留 info 级，'datacore listening' 才会打印（探测信号）。
});

const TIMEOUT_MS = 90_000; // 种子链正常 ~3-5s；90s 给 CI 充裕余量
const proc = spawn("node", [SERVER], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
let listening = false;
let done = false;

const collect = (d) => {
  out += d.toString();
  if (!listening && out.includes("datacore listening")) listening = true;
};
proc.stdout.on("data", collect);
proc.stderr.on("data", collect);

function finish(code, msg) {
  if (done) return;
  done = true;
  clearInterval(poll);
  try { proc.kill("SIGKILL"); } catch { /* noop */ }
  if (code === 0) {
    console.log("✓ seed-demo-smoke:check —— SEED_DEMO=1 datacore 真启动监听成功（种子链全过·无 Exit 1）。");
  } else {
    console.error(`✗ seed-demo-smoke:check —— ${msg}`);
    console.error("--- 最后日志 ---\n" + out.slice(-2000));
  }
  process.exit(code);
}

proc.on("exit", (code) => {
  if (!listening) finish(1, `datacore 在 'listening' 前退出(code ${code}) —— SEED_DEMO 真启动崩（WO-4 类回归）。`);
});
proc.on("error", (err) => finish(1, `无法启动 datacore：${err.message}`));

const deadline = Date.now() + TIMEOUT_MS;
const poll = setInterval(() => {
  if (listening) finish(0);
  else if (Date.now() > deadline) finish(1, `${TIMEOUT_MS}ms 内未见 'datacore listening'（启动卡死或种子超时）。`);
}, 300);
