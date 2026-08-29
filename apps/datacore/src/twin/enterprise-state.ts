import {
  captureEnterpriseState,
  enterpriseStateId,
  ENTERPRISE_STATE_REAL_WORLD_ID,
  forkEnterpriseState,
  simulatedDateAt,
  type EnterpriseState,
  type EnterpriseStateKpiInput,
  type EnterpriseStateTypeInput,
  type LogicalClock,
} from "@platform/contracts";
import type { AuthCtx, ObjectTypeDef } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import { invalidState, notFound, validationError } from "../errors.js";

/**
 * WO-ENTERPRISE-STATE · `EnterpriseState` 服务（PRD-enterprise-decision-twin §3 第一张表 / §4.1 世界隔离）。
 *
 * ## 职责边界
 * 本服务**只做三件事**：读回真数据 → 交给契约里的**纯函数**算 → 落库 + 发事件。
 * 计算逻辑一律不在这里 —— 它在 `packages/contracts/src/enterprise-state.ts`，
 * 因为前端 mock 也要调同一份（治「mock 与引擎口径分家」，本仓有过真事故）。
 * 这个分层不是洁癖：一旦让 service 自己算一点、mock 自己算一点，
 * 两边就会各自漂移，而测试咬 mock 恒绿 —— 那正是「绿测试 ≠ 能用」的标准形态。
 *
 * ## 时间坐标：为什么没有模拟时钟就直接拒绝
 * `capturedAt` 必须是逻辑时钟（见契约文件头判据一）。若租户还没有 `SimulationClockRecord`
 * （没跑过合成作业），我们**不 fallback 到 `new Date()`**，而是 409 `INVALID_STATE` 明说
 * 「逻辑时钟未初始化」。理由：wall-clock 兜底会让这份快照带上一个**看起来对、实际不在任何时间轴上**的
 * 时刻，之后所有对比/回放/确定性判据都建立在这个假坐标上。诚实报缺 > 兜底编一个（PRD §0.06 裁定二第 3 条）。
 *
 * ## 口径（全部来自租户本体，零业务常数 R14）
 *  · **KPI 组** ← SPINE 指标库对象 `Metric`（`packages/contracts/src/spine.ts`，各视图 KPI 的单一出处），
 *    分组键取该指标自己的 `category`；
 *  · **其余组** ← 逐 ACTIVE 对象类型的**对象数**与**数值属性合计**，分组键取该类型在本体里的 `domain`
 *    （factory/product/supply/capacity/plan/…—— 租户本体的数据，不是代码里的枚举）。
 *    「产能 / 库存 / 订单」这三组不是我们在代码里点名的，是它们各自的类型归在哪个域就落在哪个组。
 */
export class EnterpriseStateService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
  ) {}

  /**
   * 读回当前逻辑时刻。**唯一来源是 A8 模拟时钟**（`simclock.ts` 落的 `SimulationClockRecord`）。
   * 读不回来就抛，不造。
   */
  async currentClock(tenantId: string): Promise<LogicalClock> {
    const clock = await this.repos.simulationClocks.get(tenantId, tenantId);
    if (!clock) {
      throw invalidState(
        "logical clock not initialized — enterprise state snapshots are stamped with the simulation clock (A8), never wall-clock. Run a synthetic job first.",
      );
    }
    const t0 = clock.t0.slice(0, 10);
    return { tick: clock.currentTick, simulatedDate: simulatedDateAt(t0, clock.currentTick), t0 };
  }

  /**
   * 本体里某个类型声明的**数值属性**清单（含单位）。
   *
   * 取 `properties.dataType === "number"` ∪ `derivedProperties`（派生属性是算出来的状态量，
   * 天然是数值面；万一某条派生实际是文本，捕获时会得到 `value:null` + reason，
   * 那是**如实报「这条数不出来」**，不是错——比悄悄把它从清单里抹掉诚实）。
   * 单位取本体 `PropertyDef.unit`；没声明就空串，**不臆造**。
   */
  private numericPropsOf(type: ObjectTypeDef): { propKey: string; unit: string }[] {
    const byKey = new Map<string, string>();
    for (const p of type.properties ?? []) {
      if (p.dataType !== "number") continue;
      byKey.set(p.propKey, p.unit ?? "");
    }
    for (const d of type.derivedProperties ?? []) {
      if (!byKey.has(d.propKey)) byKey.set(d.propKey, "");
    }
    return [...byKey.entries()]
      .map(([propKey, unit]) => ({ propKey, unit }))
      .sort((a, b) => (a.propKey < b.propKey ? -1 : a.propKey > b.propKey ? 1 : 0));
  }

  /** SPINE 指标库 → KPI 输入（按 key 全序，R6）。指标库为空则返空数组（诚实空，不补占位指标）。 */
  private async kpiInputs(tenantId: string): Promise<EnterpriseStateKpiInput[]> {
    const rows = await this.repos.objects.listByType(tenantId, "Metric");
    const out: EnterpriseStateKpiInput[] = [];
    for (const o of rows) {
      if (o.mergedInto) continue;
      const p = o.props;
      const key = String(p.key ?? p.metricId ?? o.id);
      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      out.push({
        metricKey: key,
        label: String(p.name ?? key),
        unit: String(p.unit ?? ""),
        category: String(p.category ?? ""),
        actual: num(p.actual),
        target: num(p.target),
      });
    }
    out.sort((a, b) => (a.metricKey < b.metricKey ? -1 : a.metricKey > b.metricKey ? 1 : 0));
    return out;
  }

  /** 逐 ACTIVE 对象类型的输入切片（按 typeKey 全序，R6）。已合并（mergedInto）的行一律不计。 */
  private async typeInputs(tenantId: string): Promise<EnterpriseStateTypeInput[]> {
    const types = (await this.repos.ontologyTypes.list(tenantId)).filter((t) => t.status !== "RETIRED");
    types.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const out: EnterpriseStateTypeInput[] = [];
    for (const t of types) {
      const rows = (await this.repos.objects.listByType(tenantId, t.key)).filter((o) => !o.mergedInto);
      out.push({
        typeKey: t.key,
        displayName: t.displayName || t.key,
        domain: t.domain && t.domain.trim() !== "" ? t.domain : "unassigned",
        numericProps: this.numericPropsOf(t),
        rows: rows.map((o) => o.props),
      });
    }
    return out;
  }

  /**
   * 捕获一份快照。
   *
   * `worldId` 缺省 = 真实世界。指定推演会话 id 时会先校验该会话存在（跨租户/不存在 → 404），
   * **不允许**凭空造一个世界 id —— 否则 `worldId` 就退化成一个自由字符串，
   * 「两个世界物理隔离」立刻变成「随便写个名字就算一个世界」。
   *
   * 幂等：id 由 (tenant, world, tick) 确定 ⇒ 同一逻辑时刻重复捕获覆盖同一行，且内容逐字节相同（R6）。
   */
  async capture(ctx: AuthCtx, opts: { worldId?: string } = {}): Promise<EnterpriseState> {
    const worldId = opts.worldId?.trim() || ENTERPRISE_STATE_REAL_WORLD_ID;
    const isSimulated = worldId !== ENTERPRISE_STATE_REAL_WORLD_ID;
    if (isSimulated) {
      const session = await this.repos.sim.getSession(ctx.tenantId, worldId);
      if (!session) throw notFound(`sim session '${worldId}' (worldId must be REAL or an existing sim session id)`);
    }
    const clock = await this.currentClock(ctx.tenantId);
    const state = captureEnterpriseState({
      tenantId: ctx.tenantId,
      worldId,
      isSimulated,
      forkedFromStateId: null,
      clock,
      kpis: await this.kpiInputs(ctx.tenantId),
      types: await this.typeInputs(ctx.tenantId),
    });
    await this.repos.enterpriseStates.put(state);
    await this.outbox.emit(ctx.tenantId, "enterprise_state.snapshotted", {
      stateId: state.id,
      worldId: state.worldId,
      isSimulated: state.isSimulated,
      tick: state.capturedAt.tick,
      metricCount: state.metrics.length,
    });
    return state;
  }

  /**
   * 把一份快照 fork 进一个仿真世界（PRD §4.1）。**产生新行**，真实世界那一行一个字节都不动
   * —— 世界隔离反证测试咬的就是这条（「在仿真世界改一个属性，真实世界必须不变」）。
   */
  async fork(ctx: AuthCtx, sourceStateId: string, targetWorldId: string): Promise<EnterpriseState> {
    const worldId = targetWorldId.trim();
    if (worldId === "" || worldId === ENTERPRISE_STATE_REAL_WORLD_ID) {
      throw validationError(
        "fork target must be a simulation world (an existing sim session id) — forking into the real world would let simulated numbers masquerade as truth (R4)",
      );
    }
    const session = await this.repos.sim.getSession(ctx.tenantId, worldId);
    if (!session) throw notFound(`sim session '${worldId}'`);
    const source = await this.repos.enterpriseStates.get(ctx.tenantId, sourceStateId);
    if (!source) throw notFound("enterprise state");
    const forked = forkEnterpriseState(source, worldId);
    await this.repos.enterpriseStates.put(forked);
    await this.outbox.emit(ctx.tenantId, "enterprise_state.forked", {
      stateId: forked.id,
      worldId: forked.worldId,
      forkedFromStateId: forked.forkedFromStateId,
      tick: forked.capturedAt.tick,
    });
    return forked;
  }

  /** 列快照（可按世界过滤）。排序确定：worldId → tick（R6，前端时间线直接用）。 */
  async list(ctx: AuthCtx, opts: { worldId?: string } = {}): Promise<EnterpriseState[]> {
    const worldId = opts.worldId?.trim();
    const rows = await this.repos.enterpriseStates.list(ctx.tenantId, (s) => !worldId || s.worldId === worldId);
    return rows.sort((a, b) =>
      a.worldId === b.worldId ? a.capturedAt.tick - b.capturedAt.tick : a.worldId < b.worldId ? -1 : 1,
    );
  }

  /** 取一份快照（跨租户一律 404 · R2）。 */
  async get(ctx: AuthCtx, id: string): Promise<EnterpriseState> {
    const s = await this.repos.enterpriseStates.get(ctx.tenantId, id);
    if (!s) throw notFound("enterprise state");
    return s;
  }

  /** 取某世界最新一份（tick 最大）；没有则 null（诚实空，调用方自己决定要不要现场捕获）。 */
  async latest(ctx: AuthCtx, worldId: string): Promise<EnterpriseState | null> {
    const rows = await this.list(ctx, { worldId });
    return rows.length === 0 ? null : (rows[rows.length - 1] as EnterpriseState);
  }

  /** 契约 id 生成器的转发（路由/测试要算"这个逻辑时刻的快照 id 应该是什么"时用，避免各处再拼一遍）。 */
  static idFor(tenantId: string, worldId: string, tick: number): string {
    return enterpriseStateId(tenantId, worldId, tick);
  }
}
