/** Minimal in-process Prometheus text-format registry (PRD §11 dc_* metrics). */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(",") + "}";
}

/** 租户维标签键。带此标签的序列 = 业务计数（按租户分维）；不带 = 进程级健康指标。 */
export const TENANT_LABEL = "tenant";

interface Series {
  /** 原始标签（render 过滤按标签值判定，不靠解析已渲染的字符串）。 */
  labels: Labels;
  value: number;
}

/**
 * `render()` 视图口径（WO-65 / `G-METRICS-CROSS-TENANT-AND-OPEN`）：
 * - 不传 / `{}` → 全量（`service` 角色 = Prometheus 抓取正门）；
 * - 传 `tenantId` → 只渲染 `tenant=<tenantId>` 的业务序列 + 全部无 tenant 标签的进程级序列
 *   （admin 只能看自己租户那条曲线；否则「补了租户维」反把 R2 从"合成一条"恶化成"明码列出别家"）。
 */
export interface RenderView {
  tenantId?: string;
}

export class Metrics {
  private counters = new Map<string, Map<string, Series>>();
  private gauges = new Map<string, Map<string, Series>>();

  private static bump(store: Map<string, Map<string, Series>>, name: string, labels: Labels, mut: (s: Series) => void): void {
    const series = store.get(name) ?? new Map<string, Series>();
    const key = labelKey(labels);
    const cur = series.get(key) ?? { labels: { ...labels }, value: 0 };
    mut(cur);
    series.set(key, cur);
    store.set(name, series);
  }

  inc(name: string, labels: Labels = {}, value = 1): void {
    Metrics.bump(this.counters, name, labels, (s) => {
      s.value += value;
    });
  }

  set(name: string, labels: Labels = {}, value: number): void {
    Metrics.bump(this.gauges, name, labels, (s) => {
      s.value = value;
    });
  }

  get(name: string, labels: Labels = {}): number {
    return this.counters.get(name)?.get(labelKey(labels))?.value ?? 0;
  }

  render(view: RenderView = {}): string {
    // 进程级序列（无 tenant 标签）对所有可读者可见；带 tenant 标签的业务序列按视图收窄。
    const visible = (s: Series): boolean => {
      if (view.tenantId === undefined) return true;
      const t = s.labels[TENANT_LABEL];
      return t === undefined || t === view.tenantId;
    };
    const lines: string[] = [];
    const emit = (store: Map<string, Map<string, Series>>, kind: "counter" | "gauge"): void => {
      for (const [name, series] of store) {
        const shown = [...series].filter(([, s]) => visible(s));
        if (shown.length === 0) continue; // 整条 metric 都不属于本租户 → 连名字都不渲染
        lines.push(`# TYPE ${name} ${kind}`);
        for (const [lk, s] of shown) lines.push(`${name}${lk} ${s.value}`);
      }
    };
    emit(this.counters, "counter");
    emit(this.gauges, "gauge");
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
 *
 * **租户维（WO-65 · R2「tenant_id everywhere」补到可观测面）**：四个方法的第一个参数一律是
 * `tenantId`，落 `tenant` 标签。缺它 → 租户 A 的失败会把租户 B 看到的稳定率一起拉低，
 * 而稳定率是拿来做决策的数：混算 = 依据是错的。**类型层强制**（必填位参，不是可选项），
 * 漏传直接编译不过——这比任何 lint 门都硬。
 */
export class ActionMetrics {
  constructor(private readonly m: Metrics) {}

  private bump(name: string, tenantId: string, actionType: string, outcome: string): void {
    this.m.inc(name, { [TENANT_LABEL]: tenantId, action_type: actionType, outcome });
  }

  submit(tenantId: string, actionType: string, outcome: ActionSubmitOutcome): void {
    this.bump(ACTION_METRIC_NAMES.submit, tenantId, actionType, outcome);
  }

  approval(tenantId: string, actionType: string, outcome: ActionApprovalOutcome): void {
    this.bump(ACTION_METRIC_NAMES.approval, tenantId, actionType, outcome);
  }

  execute(tenantId: string, actionType: string, outcome: ActionExecuteOutcome): void {
    this.bump(ACTION_METRIC_NAMES.execute, tenantId, actionType, outcome);
  }

  executeAttempt(tenantId: string, actionType: string, outcome: ActionExecuteAttemptOutcome): void {
    this.bump(ACTION_METRIC_NAMES.executeAttempts, tenantId, actionType, outcome);
  }
}
