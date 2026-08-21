/**
 * WO-DSH-PROD-READY · W4 故障注入共享夹具：剧本化假 harness 物化器。
 *
 * 形态：runner.ts:68 解析的 spawn 目标是 `<harnessDir>/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js`
 * ——这是 W4 的故障注入缝。本 helper 在 tmp 目录物化一个最小假 harness（cordis.yml 仅存在性 +
 * 行帧 JSON-RPC 剧本化 bin.js），行为由子进程 env 驱动（runner env spread 原样透传 process.env）：
 *
 *   FAULT_MODE    healthy       回应 initialize/prompt，发 assistant/message + turn/end(completed)
 *                 healthy-slow  同 healthy 但事件延迟 400ms（并发在跑窗口观测用）
 *                 startup-crash 启动即 exit(1)（stderr 留诊断行）
 *                 mid-crash     回应后发半截 assistant/message 即 exit(1)（无 turn/end）
 *                 hang          回应 initialize/prompt 后永不发事件（等 runner deadline）
 *                 deaf          全哑：任何请求都不回应（initialize 期 hang 形态）
 *                 stubborn      healthy 但拒绝 shutdown/EOF/SIGTERM（逼 client 走 SIGKILL 梯队）
 *   FAULT_RECORD  若设：每收到 initialize / session/prompt 追加一行 JSON
 *                 {pid, method, sessionId?, tenantId?, prompt?} —— 多租户/进程形态观测点。
 *
 * 纪律：剧本化子进程 = 测试面资产；真 harness（packages/dsh-harness）一行不动。
 * bin.js 写 CJS（无 package.json 的 .js 缺省 CJS；spawn 直跑不过 vitest transform）。
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FaultMode =
  | "healthy"
  | "healthy-slow"
  | "startup-crash"
  | "mid-crash"
  | "hang"
  | "deaf"
  | "stubborn";

const BIN_JS = String.raw`
"use strict";
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");

const MODE = process.env.FAULT_MODE || "healthy";
const RECORD = process.env.FAULT_RECORD || "";

function record(entry) {
  if (!RECORD) return;
  try { appendFileSync(RECORD, JSON.stringify(Object.assign({ pid: process.pid }, entry)) + "\n"); } catch {}
}
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function result(id, value) { send({ jsonrpc: "2.0", id, result: value }); }
function notify(sessionId, event) {
  send({ jsonrpc: "2.0", method: "session.event", params: { sessionId, event } });
}

if (MODE === "startup-crash") {
  process.stderr.write("fault-harness deliberate startup crash\n");
  process.exit(1);
}

// hang/deaf/stubborn 形态要活着才挂得住：保活句柄（healthy 系列发完事件也无害，
// 收束靠 shutdown 响应 / stdin EOF 退出）。
const keepAlive = setInterval(() => {}, 1 << 30);

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (typeof msg.method !== "string") return; // 只收请求（client 不发通知给我们）
  const { id, method, params } = msg;
  if (method === "initialize") {
    record({ method, provider: params && params.provider, model: params && params.model });
    if (MODE === "deaf") return;
    result(id, { serverInfo: { name: "fault-harness", version: "0.0.1" } });
    return;
  }
  if (method === "session/prompt") {
    const sessionId = params && params.sessionId;
    const setup = (params && params.setup) || {};
    const blocks = (params && params.contentBlocks) || [];
    const promptText = blocks.map((b) => (b && b.text) || "").join("");
    record({ method, sessionId, tenantId: setup.tenantId || null, prompt: promptText });
    if (MODE === "deaf") return;
    result(id, { accepted: true, messageId: "msg-1" });
    const messageText = "fault-harness 健康回答 prompt=" + promptText;
    if (MODE === "healthy" || MODE === "healthy-slow" || MODE === "stubborn") {
      const emit = () => {
        notify(sessionId, { type: "assistant/message", time: Date.now(), data: { message: { role: "assistant", content: [{ type: "text", text: messageText }] } } });
        notify(sessionId, { type: "turn/end", time: Date.now(), data: { reason: "completed" } });
      };
      if (MODE === "healthy-slow") setTimeout(emit, 400);
      else emit();
    } else if (MODE === "mid-crash") {
      notify(sessionId, { type: "assistant/message", time: Date.now(), data: { message: { role: "assistant", content: [{ type: "text", text: "崩溃前的半截回答" }] } } });
      setTimeout(() => {
        process.stderr.write("fault-harness deliberate mid-run crash\n");
        process.exit(1);
      }, 50);
    }
    // hang：回应完毕即沉默（永不发事件，等 runner deadline / client close）
    return;
  }
  if (method === "shutdown") {
    if (MODE === "stubborn") return; // 协议层也装死，逼 EOF→SIGTERM→SIGKILL 梯队走到底
    if (id !== undefined) result(id, {});
    process.exit(0);
  }
});
rl.on("close", () => { if (MODE !== "stubborn") process.exit(0); });
if (MODE === "stubborn") process.on("SIGTERM", () => {});
`;

export interface FaultHarness {
  /** 物化出的假 harness 根目录（喂 runner opts.harnessDir / env DSH_HARNESS_DIR）。 */
  dir: string;
  /** spawn 目标的绝对路径（zombie 计数的 pgrep 模式，全机唯一）。 */
  binPath: string;
}

/** 物化假 harness（cordis.yml 仅存在性——resolveHarnessDir 的存在探针；内容不被假 bin 消费）。 */
export function materializeFaultHarness(): FaultHarness {
  const dir = mkdtempSync(join(tmpdir(), "dsh-w4-fault-harness-"));
  writeFileSync(join(dir, "cordis.yml"), "# fault-injection fixture: presence probe only\n");
  const libDir = join(dir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib");
  mkdirSync(libDir, { recursive: true });
  const binPath = join(libDir, "bin.js");
  writeFileSync(binPath, BIN_JS);
  return { dir, binPath };
}

/** 只建空目录（缺 cordis.yml 形态：resolveHarnessDir 应在 spawn 前诚实抛错）。 */
export function materializeEmptyHarnessDir(): string {
  return mkdtempSync(join(tmpdir(), "dsh-w4-fault-empty-"));
}

/** 追加型记录文件读取（每行一条 JSON；文件不存在 = 零记录）。 */
export function readFaultRecords(
  recordFile: string,
): { pid: number; method: string; sessionId?: string; tenantId?: string | null; prompt?: string }[] {
  let text: string;
  try {
    text = readFileSync(recordFile, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
