import type { LlmBudgetStatus } from "@platform/contracts";

/**
 * OC7 · 租户 LLM token 配额账本的 **AgentCore 侧消费方**（#92）。
 *
 * 病灶：DataCore 的 `/a/v1/llm-budgets`（GET/PUT/record）状态机完整且有测试坐实
 *（OK → SOFT_EXCEEDED → HARD_EXCEEDED·`degrade:true`），但 `grep -rn "llm-budgets"`
 * 在 `apps/agentcore/src` 与 `apps/frontend-shell/src` **零命中** —— 账本记得对，**没有任何调用方
 * 写它或读它**。契约注释里写明的意图（软线→路径B 拒新任务前先警示 / 路径A 跳过非必要 compose；
 * 硬线→拒）从来没有落地过。
 *
 * 本端口补上写入与读取两侧；**执行策略**（拒不拒）在 orchestrator，且门控于暗发 feature。
 *
 * 铁律：**账本不可用绝不阻断业务**。拉不到状态 → 视为 OK（fail-open）；记账失败 → 吞掉并计数。
 * 成本治理是运营诉求，不该把一次 DataCore 抖动变成用户不能提问。
 */
export interface LlmBudgetPort {
  /** 取本租户配额状态；不可用/未配置 → undefined（调用方按"无约束"处理）。 */
  status(tenantId: string): Promise<LlmBudgetStatus | undefined>;
  /** 记一次用量（input+output）。best-effort：失败只计数不抛。 */
  record(tenantId: string, tokens: number): Promise<void>;
  /** 可观测：记账失败次数（账本静默失效同样是"看起来没事"的一种）。 */
  readonly stats: { recorded: number; recordFailures: number; statusFailures: number };
}

/** 未配置 DATACORE_BASE_URL / SERVICE_TOKEN 时的空实现（测试默认·既有行为逐字节不变）。 */
export class NoopLlmBudget implements LlmBudgetPort {
  readonly stats = { recorded: 0, recordFailures: 0, statusFailures: 0 };
  async status(): Promise<undefined> {
    return undefined;
  }
  async record(): Promise<void> {
    /* no ledger configured → nothing to record */
  }
}

export class HttpLlmBudget implements LlmBudgetPort {
  readonly stats = { recorded: 0, recordFailures: 0, statusFailures: 0 };
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: { baseUrl: string; serviceToken: string; fetchImpl?: typeof fetch },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(tenantId: string): Record<string, string> {
    return {
      "x-service-token": this.opts.serviceToken,
      "x-tenant-id": tenantId,
      "x-service-caller": "agentcore",
      "content-type": "application/json",
    };
  }

  async status(tenantId: string): Promise<LlmBudgetStatus | undefined> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/a/v1/llm-budgets`, { headers: this.headers(tenantId) });
      if (!res.ok) {
        this.stats.statusFailures += 1;
        return undefined;
      }
      return (await res.json()) as LlmBudgetStatus;
    } catch {
      this.stats.statusFailures += 1;
      return undefined;
    }
  }

  async record(tenantId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/a/v1/llm-budgets/record`, {
        method: "POST",
        headers: this.headers(tenantId),
        body: JSON.stringify({ tokens }),
      });
      if (!res.ok) {
        this.stats.recordFailures += 1;
        return;
      }
      this.stats.recorded += 1;
    } catch {
      this.stats.recordFailures += 1;
    }
  }
}
