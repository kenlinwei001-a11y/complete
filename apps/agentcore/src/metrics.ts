/** Minimal Prometheus text-format metrics registry (counters, gauges, histograms). */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k]}"`).join(",");
}

class Counter {
  readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [k, v] of this.values) lines.push(k ? `${this.name}{${k}} ${v}` : `${this.name} ${v}`);
    return lines.join("\n");
  }
}

class Gauge {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(v: number): void {
    this.value = v;
  }
  get(): number {
    return this.value;
  }
  render(): string {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${this.name} ${this.value}`;
  }
}

class Histogram {
  private readonly counts: number[];
  private sum = 0;
  private total = 0;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[],
  ) {
    this.counts = buckets.map(() => 0);
  }
  observe(v: number): void {
    this.sum += v;
    this.total += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (v <= (this.buckets[i] as number)) this.counts[i] = (this.counts[i] as number) + 1;
    }
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (let i = 0; i < this.buckets.length; i++) {
      lines.push(`${this.name}_bucket{le="${this.buckets[i]}"} ${this.counts[i]}`);
    }
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.total}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.total}`);
    return lines.join("\n");
  }
}

export class Metrics {
  readonly tasksTotal = new Counter("qos_tasks_total", "Tasks by path and terminal status");
  readonly pathAHitRatio = new Gauge("qos_path_a_hit_ratio", "Rolling 1h path A hit ratio");
  readonly classifierLatency = new Histogram(
    "qos_classifier_latency_ms",
    "Classifier latency in ms",
    [50, 100, 250, 500, 1000, 1500, 3000, 10000],
  );
  readonly classifierErrors = new Counter("qos_classifier_errors_total", "Classifier failures after retries");
  readonly clarificationRounds = new Counter("qos_clarification_rounds_total", "Clarification rounds by kind");
  readonly agentBudgetExhausted = new Counter(
    "qos_agent_budget_exhausted_total",
    "Agent runs ended by budget exhaustion",
  );
  readonly unverifiedNumerics = new Counter(
    "qos_unverified_numerics_total",
    "Answers flagged with unverified numerics by path",
  );
  readonly toolCalls = new Counter("qos_tool_calls_total", "Tool calls by tool and outcome");
  readonly llmTokens = new Counter("qos_llm_tokens_total", "LLM tokens by model and direction");
  readonly nestedInvocations = new Counter("ac_nested_invocations_total", "Nested agent/workflow invocations by kind");
  readonly oboDenied = new Counter("ac_obo_denied_total", "Tool calls refused due to expiring OBO token");
  /** 增量 §1.3：上下文清理操作（fold/compact/force_finalize） */
  readonly contextOps = new Counter("ac_context_ops_total", "Agent context cleanup operations by op");
  /** 增量 §4.1：MCP server 状态告警（error/recovered） */
  readonly mcpAlerts = new Counter("ac_mcp_alerts_total", "MCP server lifecycle alerts by kind");
  /** 增量 §2：启动扫描置 FAILED 的中断任务数 */
  readonly interruptedTasks = new Counter("ac_interrupted_tasks_total", "Tasks failed by restart sweep");

  // rolling window for hit ratio
  private readonly routed: { at: number; pathA: boolean }[] = [];
  recordRouting(pathA: boolean): void {
    const now = Date.now();
    this.routed.push({ at: now, pathA });
    const cutoff = now - 3600_000;
    while (this.routed.length > 0 && (this.routed[0] as { at: number }).at < cutoff) this.routed.shift();
    const hits = this.routed.filter((r) => r.pathA).length;
    this.pathAHitRatio.set(this.routed.length === 0 ? 0 : hits / this.routed.length);
  }

  render(): string {
    return (
      [
        this.tasksTotal,
        this.pathAHitRatio,
        this.classifierLatency,
        this.classifierErrors,
        this.clarificationRounds,
        this.agentBudgetExhausted,
        this.unverifiedNumerics,
        this.toolCalls,
        this.llmTokens,
        this.nestedInvocations,
        this.oboDenied,
        this.contextOps,
        this.mcpAlerts,
        this.interruptedTasks,
      ]
        .map((m) => m.render())
        .join("\n") + "\n"
    );
  }
}
