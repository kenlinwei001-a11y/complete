/**
 * WO-DSH-POC-S3 · agentcore → dsh-harness 子进程的执行缝（路 B 客户端）。
 *
 * 边界：这是 dsh-runtime 里**唯一**碰进程/wire 的模块；setup-spec（纯映射）与
 * reassemble（纯重组装）都不 import 这里。S4 的 engine flag 分叉（engine.ts:492）
 * 调 runDshAgent 一次拿 ReassembledRun，外包装 AgentLoopResult 的 run/metrics 留痕。
 *
 * 休眠开关：本模块不被任何生产路径 import（S3 只建缝不开流）；启用见 S4 的
 * DSH_HARNESS env 分叉。harness 目录解析：opts.harnessDir > env DSH_HARNESS_DIR >
 * <repo>/packages/dsh-harness。
 */

import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DshSessionEvent, ReassembleOptions, ReassembledRun, SseEmission } from "./reassemble.js";
import { createSseMapper, reassembleDshRun } from "./reassemble.js";
import type { DshSetupSpec } from "./setup-spec.js";

export interface DshRunnerOptions {
  harnessDir?: string;
  requestTimeoutMs?: number;
  /** 子进程环境增量（如 PLATFORM_GOV_DENY / ECHO_COUNT_FILE；与 process.env 合并）。 */
  env?: Record<string, string>;
  /**
   * WO-DSH-N1-PROVIDER · cordis 配置档文件名（additive·缺省 "cordis.yml" 既有调用方字节兼容）。
   * 测试专档 "cordis.poc.yml"（= 生产内容 + mock-llm + echo-tool；E1/E2/smoke/stall 剧本用），
   * 生产档只挂 platform-llm。
   */
  cordisFile?: string;
}

export interface DshRunInput {
  prompt: string;
  setup?: DshSetupSpec;
  provider: string;
  model: string;
  maxTokens?: number;
  sessionId?: string;
  reassemble?: ReassembleOptions;
  /** 逐 SSE 增量回调（createSseMapper 产出即推；answer.final/task.* 由外层在拿结果后发）。 */
  onSse?: (emission: SseEmission) => void;
}

export interface DshRunOutput {
  result: ReassembledRun;
  /** 原始帧流（留痕/排障用；含全部 session.event event 载荷）。 */
  events: DshSessionEvent[];
  sessionId: string;
}

function resolveHarnessDir(opts: DshRunnerOptions): string {
  const dir = opts.harnessDir
    ?? process.env.DSH_HARNESS_DIR
    ?? resolve(process.cwd(), "packages/dsh-harness");
  const cordisFile = opts.cordisFile ?? "cordis.yml";
  if (!existsSync(join(dir, cordisFile))) {
    throw new Error(`dsh-harness ${cordisFile} not found under ${dir} (set DSH_HARNESS_DIR)`);
  }
  return dir;
}

export async function runDshAgent(input: DshRunInput, opts: DshRunnerOptions = {}): Promise<DshRunOutput> {
  const harnessDir = resolveHarnessDir(opts);
  const cordisFile = opts.cordisFile ?? "cordis.yml";
  const client = new HarnessClient({
    command: process.execPath,
    args: [join(harnessDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"), cordisFile],
    cwd: harnessDir,
    requestTimeoutMs: opts.requestTimeoutMs ?? 120_000,
    env: { ...process.env, ...opts.env },
  });
  const sessionId = input.sessionId ?? `dsh-${new Date().getTime().toString(36)}`;
  const events: DshSessionEvent[] = [];
  const mapper = createSseMapper(); // N2·D-7：工厂持 meta callId 集，一次 run 一个实例
  const sub = client.subscribeSessionTree(sessionId);
  const collector = (async () => {
    for await (const n of sub) {
      if (n.method !== "session.event") continue;
      const event = (n.params as { event?: DshSessionEvent } | undefined)?.event;
      if (!event) continue;
      events.push(event);
      const sse = mapper(event);
      if (sse) input.onSse?.(sse);
    }
  })().catch(() => undefined); // sub.close() 会拒 pending waiter；立即挂 catch 防 unhandled rejection
  try {
    client.start();
    await client.initialize({
      cwd: harnessDir,
      provider: input.provider,
      model: input.model,
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    });
    await client.request("session/prompt", {
      sessionId,
      contentBlocks: [{ type: "text", text: input.prompt }],
      ...(input.setup ? { setup: input.setup } : {}),
    });
    // turn/end 即收束（requestTimeoutMs 兜底悬死）。
    const deadline = Date.now() + (opts.requestTimeoutMs ?? 120_000);
    while (!events.some((e) => e.type === "turn/end") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const result = reassembleDshRun(events, input.reassemble ?? {});
    return { result, events, sessionId };
  } finally {
    sub.close();
    await client.close();
    await collector;
  }
}
