/** Minimal in-process Prometheus text-format registry (PRD §11 dc_* metrics). */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(",") + "}";
}

/** 一条按租户分桶的计数序列。 */
export interface TenantSeries {
  labels: Labels;
  value: number;
}

export class Metrics {
  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();
  /** name → tenantId → labelKey → 序列。**不进 `render()`**（见 incWithTenant 注释）。 */
  private tenantCounters = new Map<string, Map<string, Map<string, TenantSeries>>>();

  inc(name: string, labels: Labels = {}, value = 1): void {
    const series = this.counters.get(name) ?? new Map<string, number>();
    const key = labelKey(labels);
    series.set(key, (series.get(key) ?? 0) + value);
    this.counters.set(name, series);
  }

  /**
   * 记一次**带租户维**的计数。
   *
   * ⚠ 关键设计：这是**一次调用、一个写入路径、两个投影** —— 全局合计（`/metrics` 的
   * Prometheus 序列，形状分毫未动）与租户分桶（`GET /a/v1/actions/metrics` 读）由同一行代码
   * 同时写出。**不是两套口径**：不存在「同一件事记两个数、然后对不上」的可能，因为没有第二个
   * 写入点可供漂移。不变量「Σ租户 == 全局」由 `test/action-metrics-tenant.test.ts` 咬死。
   *
   * 为什么不直接给 `/metrics` 加 `tenant_id` 标签：① Prometheus 基数 = 序列数 × 租户数，
   * 租户多时是真实运维风险；② `/metrics` 的既有语义就是「全租户合计」，改标签会连带改 10 处
   * 断言（`labelKey` 按键名排序，凡 `outcome="…"` 后紧跟 `}` 的正则/两标签 `get()` 全红）。
   * 故取「合计留在 `/metrics`、租户维另开鉴权端点」，与 `router/perception-metrics.ts` 同款。
   */
  incWithTenant(name: string, tenantId: string, labels: Labels = {}, value = 1): void {
    this.inc(name, labels, value); // 投影一：全租户合计（对外 Prometheus 形状不变）
    const perName = this.tenantCounters.get(name) ?? new Map<string, Map<string, TenantSeries>>();
    const perTenant = perName.get(tenantId) ?? new Map<string, TenantSeries>();
    const key = labelKey(labels);
    const cur = perTenant.get(key);
    perTenant.set(key, { labels, value: (cur?.value ?? 0) + value }); // 投影二：该租户分桶
    perName.set(tenantId, perTenant);
    this.tenantCounters.set(name, perName);
  }

  /** 读某租户在某指标上的全部序列（R2：只返回该 tenantId 的桶，跨租户不可见）。 */
  tenantSeries(name: string, tenantId: string): TenantSeries[] {
    return [...(this.tenantCounters.get(name)?.get(tenantId)?.values() ?? [])];
  }

  /** 该指标出现过的全部租户（**仅测试/不变量校验用**，任何 HTTP 响应都不得下发此列表）。 */
  tenantsOf(name: string): string[] {
    return [...(this.tenantCounters.get(name)?.keys() ?? [])];
  }

  set(name: string, labels: Labels = {}, value: number): void {
    const series = this.gauges.get(name) ?? new Map<string, number>();
    series.set(labelKey(labels), value);
    this.gauges.set(name, series);
  }

  get(name: string, labels: Labels = {}): number {
    return this.counters.get(name)?.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [lk, v] of series) lines.push(`${name}${lk} ${v}`);
    }
    for (const [name, series] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const [lk, v] of series) lines.push(`${name}${lk} ${v}`);
    }
    return lines.join("\n") + "\n";
  }
}

// ---------------------------------------------------------------------------
// S2 Action 三段埋点（提交 / 审批 / 执行）
//
// 病根：全仓 grep 不到任何 Action 成功率/失败率计数器，而验收判据是「跑 100 次同 Action，
// 失败率 < 1%」——测不了就不能声称达标。
//
// 纪律：失败必须分型。笼统一个 `failed` 算出来的"失败率"没法指导行动——校验失败该修调用方
// payload、规则拦截是业务本该拦、审批拒绝是人的决定（根本不该计入系统失败率）、执行异常才是
// 平台的锅。命名沿用本文件既有风格 `dc_<域>_<事>_total` + 标签（见 dc_connector_sync_total）。
// ---------------------------------------------------------------------------

export const ACTION_METRIC_NAMES = {
  submit: "dc_action_submit_total",
  approval: "dc_action_approval_total",
  execute: "dc_action_execute_total",
  executeAttempts: "dc_action_execute_attempts_total",
} as const;

/** 提交段结果。失败分型：payload 校验 / 规则引擎 BLOCK / 无合格审批人 / 状态机非法 / 其它未预期。 */
export type ActionSubmitOutcome =
  | "success"
  | "validation_failed"
  | "rule_blocked"
  | "no_approver"
  | "invalid_state"
  | "unexpected";

/**
 * 审批段结果。`approved`=整条审批链走完；`step_advanced`=本步通过但链未完；
 * `rejected`=审批人主动拒绝（**业务结论，不是系统故障**）；`denied`=角色不符/自批被拦/状态非法；
 * `invalid_request`=请求本身不合法（如 reject 缺意见）。
 */
export type ActionApprovalOutcome =
  | "approved"
  | "step_advanced"
  | "rejected"
  | "denied"
  | "invalid_request"
  | "unexpected";

/** 执行段（整次执行的终态）。`failed` = 重试耗尽仍未成功。 */
export type ActionExecuteOutcome = "success" | "failed" | "invalid_state";

/** 执行段（单次重试尝试）。区分执行器抛异常与执行器返回 ok:false —— 二者的排障方向不同。 */
export type ActionExecuteAttemptOutcome = "success" | "executor_error" | "executor_rejected";

/**
 * Action 埋点的类型化门面：metric 名与标签键只在此处定义一次，调用点不再手写字符串
 * （杜绝 `outcome` 拼写漂移把两条曲线劈成两半）。
 */
export class ActionMetrics {
  constructor(private readonly m: Metrics) {}

  submit(tenantId: string, actionType: string, outcome: ActionSubmitOutcome): void {
    this.m.incWithTenant(ACTION_METRIC_NAMES.submit, tenantId, { action_type: actionType, outcome });
  }

  approval(tenantId: string, actionType: string, outcome: ActionApprovalOutcome): void {
    this.m.incWithTenant(ACTION_METRIC_NAMES.approval, tenantId, { action_type: actionType, outcome });
  }

  execute(tenantId: string, actionType: string, outcome: ActionExecuteOutcome): void {
    this.m.incWithTenant(ACTION_METRIC_NAMES.execute, tenantId, { action_type: actionType, outcome });
  }

  executeAttempt(tenantId: string, actionType: string, outcome: ActionExecuteAttemptOutcome): void {
    this.m.incWithTenant(ACTION_METRIC_NAMES.executeAttempts, tenantId, { action_type: actionType, outcome });
  }
}

/** 单段的一条明细。 */
export interface ActionStageCount {
  actionType: string;
  outcome: string;
  count: number;
}

/**
 * 单租户的 Action 三段埋点视图（`GET /a/v1/actions/metrics` 响应）。
 *
 * `stability` 是验收判据「跑 100 次同 Action，失败率 < 1%」**第一次可按租户算出来**的地方：
 * 此前 `/metrics` 是全租户合计 —— 一个租户把某动作跑挂 100 次会拉低所有租户共享的比率，
 * 反之大租户的成功量会**掩盖**小租户的持续失败，租户级稳定率根本算不出来。
 */
export interface ActionMetricsView {
  tenantId: string;
  submit: ActionStageCount[];
  approval: ActionStageCount[];
  execute: ActionStageCount[];
  executeAttempts: ActionStageCount[];
  stability: {
    /** 执行段终态总数（= 分母）。 */
    executions: number;
    succeeded: number;
    failed: number;
    /** failed / executions（0 次执行 → 0）。 */
    failureRate: number;
  };
}

const toCounts = (m: Metrics, name: string, tenantId: string): ActionStageCount[] =>
  m
    .tenantSeries(name, tenantId)
    .map((s) => ({ actionType: s.labels["action_type"] ?? "unknown", outcome: s.labels["outcome"] ?? "unknown", count: s.value }))
    .sort((a, b) => (a.actionType === b.actionType ? a.outcome.localeCompare(b.outcome) : a.actionType.localeCompare(b.actionType)));

/**
 * 组装单租户视图。**纯读**：不新增任何计数，只是 `incWithTenant` 那一个写入路径的第二个投影
 * —— 因此不可能与 `/metrics` 的合计打架（不变量 Σ租户 == 全局，测试咬死）。
 */
export function actionMetricsView(m: Metrics, tenantId: string): ActionMetricsView {
  const execute = toCounts(m, ACTION_METRIC_NAMES.execute, tenantId);
  // 稳定率只看**终态**（execute），不看单次尝试（executeAttempts）——一次执行可能重试多次，
  // 拿尝试数当分母会把「重试后成功」记成失败，稳定率失真。
  const executions = execute.reduce((s, c) => s + c.count, 0);
  const succeeded = execute.filter((c) => c.outcome === "success").reduce((s, c) => s + c.count, 0);
  const failed = execute.filter((c) => c.outcome === "failed").reduce((s, c) => s + c.count, 0);
  return {
    tenantId,
    submit: toCounts(m, ACTION_METRIC_NAMES.submit, tenantId),
    approval: toCounts(m, ACTION_METRIC_NAMES.approval, tenantId),
    execute,
    executeAttempts: toCounts(m, ACTION_METRIC_NAMES.executeAttempts, tenantId),
    stability: {
      executions,
      succeeded,
      failed,
      failureRate: executions === 0 ? 0 : Number((failed / executions).toFixed(4)),
    },
  };
}
