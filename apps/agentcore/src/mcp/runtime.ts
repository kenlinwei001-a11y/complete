import type { McpServerConfig } from "@platform/contracts";
import { decryptSecret } from "../crypto.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import type { McpClientPort, McpConnection, McpConnectorFactory, McpToolInfo } from "./types.js";

/**
 * MCP 运行时（PRD 增量 · Agent 运行时强化 §4.1）。
 *
 * - streamable_http：每 server 连接池（≤4），空闲 30s 关闭；tools/call 超时 20s
 *   （per-server toolTimeoutMs 覆盖，≤60s）；失败重连退避 1s/2s/4s；
 *   连续 5 次失败 → server 置 ERROR + 告警事件，引用它的 agent 调用即时得 is_error
 *   tool_result（不阻塞循环）；恢复探测成功自动回 ACTIVE。
 * - stdio：持久子进程 + 30s 心跳 ping，崩溃自动重启 ≤3 次/小时后置 ERROR。
 * - schema 缓存 TTL 10min + refreshTools（配置页「刷新工具清单」按钮）。
 * - stdio 安全（§4.3 红线）：MCP_STDIO_ENABLED=1 + 绝对路径白名单精确匹配 +
 *   args 字符集白名单 —— 启动（connect）即校验，任一不满足直接拒绝。
 */

export class McpServerUnavailableError extends Error {
  constructor(
    readonly mcpConfigId: string,
    message: string,
  ) {
    super(message);
    this.name = "McpServerUnavailableError";
  }
}

export interface StdioPolicy {
  enabled: boolean;
  /** 绝对路径白名单（精确匹配，前缀不行） */
  commandAllowlist: string[];
}

/** args 白名单字符集（拒绝 shell 元字符注入，§4.3-3）。 */
export const STDIO_ARG_RE = /^[A-Za-z0-9_\-./=:@,+]*$/;

export function validateStdioTransport(
  transport: Extract<McpServerConfig["transport"], { type: "stdio" }>,
  policy: StdioPolicy,
): string | undefined {
  if (!policy.enabled) {
    return "stdio 传输默认禁用：需部署方设置 MCP_STDIO_ENABLED=1 与 MCP_STDIO_COMMAND_ALLOWLIST";
  }
  if (!policy.commandAllowlist.includes(transport.command)) {
    return `command 不在白名单内（需绝对路径精确匹配）：${transport.command}`;
  }
  for (const arg of transport.args) {
    if (!STDIO_ARG_RE.test(arg)) {
      return `args 含非法字符（shell 元字符被拒绝）：${arg}`;
    }
  }
  return undefined;
}

export interface McpRuntimeOpts {
  repos: Repos;
  credentialKeyHex: string;
  factory: McpConnectorFactory;
  metrics?: Metrics;
  stdioPolicy?: StdioPolicy;
  /** 告警事件出口（server ERROR / 恢复）。 */
  onAlert?: (event: { mcpConfigId: string; kind: "ERROR" | "RECOVERED"; message: string }) => void;
  /** 时间参数（测试可注入加速值）。 */
  backoffMs?: number[];
  idleCloseMs?: number;
  defaultCallTimeoutMs?: number;
  maxCallTimeoutMs?: number;
  schemaTtlMs?: number;
  maxPoolPerServer?: number;
  failureThreshold?: number;
  probeIntervalMs?: number;
  heartbeatMs?: number;
  maxStdioRestartsPerHour?: number;
}

interface PoolEntry {
  conn: McpConnection;
  idleTimer?: NodeJS.Timeout;
}

interface ServerState {
  /** idle http connections / the single persistent stdio connection */
  pool: PoolEntry[];
  busy: number;
  consecutiveFailures: number;
  toolsCache?: { tools: McpToolInfo[]; fetchedAt: number };
  probeTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
  stdioRestarts: number[]; // restart timestamps (rolling hour)
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

export class McpRuntime implements McpClientPort {
  private readonly states = new Map<string, ServerState>();
  private closed = false;

  private readonly backoffMs: number[];
  private readonly idleCloseMs: number;
  private readonly defaultCallTimeoutMs: number;
  private readonly maxCallTimeoutMs: number;
  private readonly schemaTtlMs: number;
  private readonly maxPoolPerServer: number;
  private readonly failureThreshold: number;
  private readonly probeIntervalMs: number;
  private readonly heartbeatMs: number;
  private readonly maxStdioRestartsPerHour: number;

  constructor(private readonly opts: McpRuntimeOpts) {
    this.backoffMs = opts.backoffMs ?? [1000, 2000, 4000];
    this.idleCloseMs = opts.idleCloseMs ?? 30_000;
    this.defaultCallTimeoutMs = opts.defaultCallTimeoutMs ?? 20_000;
    this.maxCallTimeoutMs = opts.maxCallTimeoutMs ?? 60_000;
    this.schemaTtlMs = opts.schemaTtlMs ?? 600_000;
    this.maxPoolPerServer = opts.maxPoolPerServer ?? 4;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.probeIntervalMs = opts.probeIntervalMs ?? 30_000;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.maxStdioRestartsPerHour = opts.maxStdioRestartsPerHour ?? 3;
  }

  private stateFor(id: string): ServerState {
    let s = this.states.get(id);
    if (!s) {
      s = { pool: [], busy: 0, consecutiveFailures: 0, stdioRestarts: [] };
      this.states.set(id, s);
    }
    return s;
  }

  private async config(mcpConfigId: string): Promise<McpServerConfig> {
    const config = await this.opts.repos.mcpConfigs.get(mcpConfigId);
    if (!config) throw new Error(`mcp config not found: ${mcpConfigId}`);
    return config;
  }

  private async resolveSecret(config: McpServerConfig): Promise<string | undefined> {
    if (!config.credentialRef) return undefined;
    const row = await this.opts.repos.credentials.get(config.credentialRef);
    if (!row) return undefined;
    return decryptSecret(row.ciphertext, this.opts.credentialKeyHex);
  }

  /** 建连（退避 1s/2s/4s）。每次失败计入 consecutiveFailures。 */
  private async connect(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport.type === "stdio") {
      const err = validateStdioTransport(
        config.transport,
        this.opts.stdioPolicy ?? { enabled: false, commandAllowlist: [] },
      );
      if (err) throw new McpServerUnavailableError(config.id, `stdio 启动被拒：${err}`);
    }
    const secret = await this.resolveSecret(config);
    const state = this.stateFor(config.id);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.backoffMs.length; attempt++) {
      try {
        const conn = await this.opts.factory(config, secret);
        return conn;
      } catch (e) {
        lastErr = e;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= this.failureThreshold) {
          await this.markError(config, e instanceof Error ? e.message : String(e));
          throw new McpServerUnavailableError(config.id, `MCP server ${config.name} 连续失败已置 ERROR`);
        }
        if (attempt < this.backoffMs.length) await sleep(this.backoffMs[attempt] as number);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async markError(config: McpServerConfig, message: string): Promise<void> {
    const fresh = await this.opts.repos.mcpConfigs.get(config.id);
    if (fresh && fresh.status !== "ERROR") {
      await this.opts.repos.mcpConfigs.update({ ...fresh, status: "ERROR" });
    }
    this.opts.metrics?.mcpAlerts.inc({ kind: "error" });
    this.opts.onAlert?.({ mcpConfigId: config.id, kind: "ERROR", message });
    this.startRecoveryProbe(config.id);
  }

  /** 恢复探测：成功 tools/list → 状态回 ACTIVE（§4.1）。 */
  private startRecoveryProbe(mcpConfigId: string): void {
    const state = this.stateFor(mcpConfigId);
    if (state.probeTimer || this.closed) return;
    const probe = async (): Promise<void> => {
      state.probeTimer = undefined;
      if (this.closed) return;
      try {
        const config = await this.config(mcpConfigId);
        if (config.status !== "ERROR") return; // manually disabled / already recovered
        const secret = await this.resolveSecret(config);
        const conn = await this.opts.factory(config, secret);
        const tools = await conn.listTools();
        state.toolsCache = { tools, fetchedAt: Date.now() };
        state.consecutiveFailures = 0;
        state.stdioRestarts = [];
        this.release(config, state, conn);
        await this.opts.repos.mcpConfigs.update({ ...config, status: "ACTIVE" });
        this.opts.metrics?.mcpAlerts.inc({ kind: "recovered" });
        this.opts.onAlert?.({ mcpConfigId, kind: "RECOVERED", message: `MCP server ${config.name} 已恢复 ACTIVE` });
      } catch {
        state.probeTimer = setTimeout(() => void probe(), this.probeIntervalMs);
        state.probeTimer.unref?.();
      }
    };
    state.probeTimer = setTimeout(() => void probe(), this.probeIntervalMs);
    state.probeTimer.unref?.();
  }

  /** 取连接：stdio 复用持久连接；http 从池取或新建。 */
  private async acquire(config: McpServerConfig, state: ServerState): Promise<McpConnection> {
    const entry = state.pool.shift();
    if (entry) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      state.busy += 1;
      return entry.conn;
    }
    const conn = await this.connect(config);
    state.busy += 1;
    if (config.transport.type === "stdio") this.startHeartbeat(config, state, conn);
    return conn;
  }

  private release(config: McpServerConfig, state: ServerState, conn: McpConnection): void {
    state.busy = Math.max(0, state.busy - 1);
    const isStdio = config.transport.type === "stdio";
    const poolCap = isStdio ? 1 : this.maxPoolPerServer;
    if (state.pool.length >= poolCap || this.closed) {
      void conn.close().catch(() => undefined);
      return;
    }
    const entry: PoolEntry = { conn };
    if (!isStdio) {
      // 空闲 30s 关闭（stdio 持久子进程不空闲关闭，由心跳监管）
      entry.idleTimer = setTimeout(() => {
        const idx = state.pool.indexOf(entry);
        if (idx >= 0) state.pool.splice(idx, 1);
        void conn.close().catch(() => undefined);
      }, this.idleCloseMs);
      entry.idleTimer.unref?.();
    }
    state.pool.push(entry);
  }

  /** stdio 30s 心跳；失败 → 自动重启（≤3/小时），超限置 ERROR。 */
  private startHeartbeat(config: McpServerConfig, state: ServerState, conn: McpConnection): void {
    if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
    const beat = async (): Promise<void> => {
      if (this.closed) return;
      try {
        await (conn.ping ? conn.ping() : conn.listTools());
        state.heartbeatTimer = setTimeout(() => void beat(), this.heartbeatMs);
        state.heartbeatTimer.unref?.();
      } catch {
        void conn.close().catch(() => undefined);
        state.pool = state.pool.filter((e) => e.conn !== conn);
        const now = Date.now();
        state.stdioRestarts = state.stdioRestarts.filter((t) => now - t < 3600_000);
        if (state.stdioRestarts.length >= this.maxStdioRestartsPerHour) {
          await this.markError(config, "stdio 子进程崩溃重启超限（≤3 次/小时）");
          return;
        }
        state.stdioRestarts.push(now);
        try {
          const fresh = await this.connect(config);
          this.stateFor(config.id).pool.push({ conn: fresh });
          this.startHeartbeat(config, state, fresh);
        } catch {
          /* connect 内部已计失败/置 ERROR */
        }
      }
    };
    state.heartbeatTimer = setTimeout(() => void beat(), this.heartbeatMs);
    state.heartbeatTimer.unref?.();
  }

  async listTools(mcpConfigId: string): Promise<McpToolInfo[]> {
    const state = this.stateFor(mcpConfigId);
    const cached = state.toolsCache;
    if (cached && Date.now() - cached.fetchedAt < this.schemaTtlMs) return cached.tools;
    return this.refreshTools(mcpConfigId);
  }

  /** schema 缓存强制刷新（TTL 10min；配置页「刷新工具清单」）。 */
  async refreshTools(mcpConfigId: string): Promise<McpToolInfo[]> {
    const config = await this.config(mcpConfigId);
    if (config.status === "DISABLED") throw new Error(`mcp config disabled: ${mcpConfigId}`);
    if (config.status === "ERROR") {
      throw new McpServerUnavailableError(mcpConfigId, `MCP server ${config.name} 处于 ERROR 状态`);
    }
    const state = this.stateFor(mcpConfigId);
    const conn = await this.acquire(config, state);
    try {
      const tools = await withTimeout(conn.listTools(), this.callTimeout(config), "tools/list");
      state.consecutiveFailures = 0;
      state.toolsCache = { tools, fetchedAt: Date.now() };
      this.release(config, state, conn);
      return tools;
    } catch (e) {
      state.busy = Math.max(0, state.busy - 1);
      void conn.close().catch(() => undefined);
      await this.recordCallFailure(config, state, e);
      throw e;
    }
  }

  private callTimeout(config: McpServerConfig): number {
    return Math.min(config.toolTimeoutMs ?? this.defaultCallTimeoutMs, this.maxCallTimeoutMs);
  }

  private async recordCallFailure(config: McpServerConfig, state: ServerState, err: unknown): Promise<void> {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      await this.markError(config, err instanceof Error ? err.message : String(err));
    }
  }

  async callTool(mcpConfigId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = await this.config(mcpConfigId);
    if (config.status === "DISABLED") throw new Error(`mcp config disabled: ${mcpConfigId}`);
    // ERROR 状态 → 即时拒绝（agent 得 is_error tool_result，不阻塞循环）
    if (config.status === "ERROR") {
      throw new McpServerUnavailableError(
        mcpConfigId,
        `MCP server ${config.name} 处于 ERROR 状态（等待恢复探测），调用被即时拒绝`,
      );
    }
    const state = this.stateFor(mcpConfigId);
    const conn = await this.acquire(config, state);
    try {
      const result = await withTimeout(conn.callTool(toolName, args), this.callTimeout(config), `tools/call ${toolName}`);
      state.consecutiveFailures = 0;
      this.release(config, state, conn);
      return result;
    } catch (e) {
      state.busy = Math.max(0, state.busy - 1);
      void conn.close().catch(() => undefined);
      await this.recordCallFailure(config, state, e);
      throw e;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const state of this.states.values()) {
      if (state.probeTimer) clearTimeout(state.probeTimer);
      if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
      for (const entry of state.pool) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        await entry.conn.close().catch(() => undefined);
      }
      state.pool = [];
    }
    this.states.clear();
  }
}
