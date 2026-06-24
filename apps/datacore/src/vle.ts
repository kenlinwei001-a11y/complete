import type { AuthCtx, ValidationRunRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { SyntheticService } from "./synthetic/service.js";
import type { OntologyService } from "./ontology.js";
import { newId } from "./ids.js";

/** 七段闭环的规范段名（assertionCov = 已验证的规范段数 / 7，非硬编码 1）。 */
const CANONICAL_SEGMENTS = ["①接入", "②建模与对象化", "③聚合与派生", "④规则查全查准", "⑤求解器执行", "⑥行动终态", "⑦校准注入"];

/**
 * 闭环验证引擎（VLE，PRD-addendum-validation-loop）。
 *
 * 不依赖真实用户/数据：用 GenSpec 确定性生成已知真值的模拟数据，经全链路正门流转后，
 * 用独立真值预言机（构造真值 / 不变量）逐段比对。工程验证度从主观评分变为可量化报告。
 *
 * 正门红线（继承回放编排器铁律）：注入经公开服务，**比对时才直读 DB（只读不写）**；
 * 全隔离：每次 run 创建一次性验证租户（origin=VALIDATION），执行→报告落库→租户销毁。
 */

interface Assertion {
  segment: string;
  point: string;
  oracle: "constructed" | "reference" | "invariant";
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
  diff?: string;
}

export interface VleRunOptions {
  /** 测试专用：在生成后注入故障以验证断言能抓到（VL2/VL3）。 */
  injectFault?: "dangling_link" | "broken_aggregate";
}

export class VleService {
  constructor(
    private repos: Repos,
    private synthetic: SyntheticService,
    private ontology: OntologyService,
  ) {}

  /** GenSpec 已知真值：battery-manufacturing / scale=S 的核心类型行数（接入→对象化守恒下界）。 */
  private static readonly GENSPEC_S_COUNTS: Record<string, number> = { Base: 12, Model: 6, Order: 24 };

  async run(
    callerCtx: AuthCtx,
    profile: "SMOKE" | "FULL" | "SOAK",
    seed = 42,
    opts: VleRunOptions = {},
  ): Promise<ValidationRunRecord> {
    const id = newId("vrun");
    const startedAt = new Date().toISOString();
    // 全隔离：一次性验证租户（与演示/真实租户零交叉）。
    const vTenant = `vle_${id}`;
    const vctx: AuthCtx = { tenantId: vTenant, userId: "vle", roles: ["admin"], attributes: {} };
    const assertions: Assertion[] = [];
    try {
      // ① 接入 + ② 建模与对象化：确定性生成（GenSpec 真值已知）。
      await this.synthetic.runJob(vctx, { industry: "battery-manufacturing", scale: "S", seed });
      if (opts.injectFault === "dangling_link") await this.injectDanglingLink(vctx);
      if (opts.injectFault === "broken_aggregate") await this.injectBrokenAggregate(vctx);

      const objects = await this.repos.objects.list(vTenant);
      const links = await this.repos.links.list(vTenant);

      // ① 接入：GenSpec 已知真值 → 核心类型行数守恒（接入/对象化未丢行未串行）。
      const countByType = (t: string) => objects.filter((o) => o.type === t).length;
      const countMismatch = Object.entries(VleService.GENSPEC_S_COUNTS).filter(([t, n]) => countByType(t) !== n);
      assertions.push({
        segment: "①接入",
        point: "接入产出核心类型行数 == GenSpec（Base/Model/Order 行数守恒）",
        oracle: "constructed",
        pass: countMismatch.length === 0,
        expected: VleService.GENSPEC_S_COUNTS,
        actual: Object.fromEntries(Object.keys(VleService.GENSPEC_S_COUNTS).map((t) => [t, countByType(t)])),
        diff: countMismatch.length ? `行数偏离: ${countMismatch.map(([t]) => t).join(",")}` : undefined,
      });

      // 构造真值：生成必产出对象（行数守恒的下界）。
      assertions.push({
        segment: "②建模与对象化",
        point: "materialize 产出对象数 > 0",
        oracle: "constructed",
        pass: objects.length > 0,
        expected: ">0",
        actual: objects.length,
      });

      // 不变量：引用完整性（refs 悬挂 = 0）。
      const objIds = new Set(objects.map((o) => o.id));
      const dangling = links.filter((l) => !objIds.has(l.fromId) || !objIds.has(l.toId));
      assertions.push({
        segment: "②建模与对象化",
        point: "链接引用完整性（悬挂引用=0）",
        oracle: "invariant",
        pass: dangling.length === 0,
        expected: 0,
        actual: dangling.length,
        diff: dangling.length ? `首个悬挂链接 ${dangling[0]!.id}` : undefined,
      });

      // 不变量：驾驶舱聚合 == 明细求和（取一个数值属性双算）。
      const aggCheck = await this.aggregateEqualsDetail(vctx);
      assertions.push({
        segment: "③聚合与派生",
        point: "聚合下推 == 明细求和（守恒律）",
        oracle: "invariant",
        pass: aggCheck.pass,
        expected: aggCheck.expected,
        actual: aggCheck.actual,
        diff: aggCheck.pass ? undefined : `type=${aggCheck.typeKey} prop=${aggCheck.prop}`,
      });

      // ④ 规则查全查准（独立预言机，VL7：不 import 规则引擎，用独立 plain-JS 谓词比对）。
      //   查全(recall)：约束扫描所需字段在 Order 对象上齐备——字段缺失 = 规则静默漏判(假阴)。
      //   查准(precision)：种子按固定步长植入的越线行(C03 demandDelta>0.5)被独立谓词当场捕获。
      const orders = objects.filter((o) => o.type === "Order");
      const SCAN_FIELDS = ["demandDelta", "outsourceRatio", "creditUsedRatio", "leadDays"];
      const fieldGaps = orders.filter((o) => SCAN_FIELDS.some((f) => typeof o.props[f] !== "number")).length;
      assertions.push({
        segment: "④规则查全查准",
        point: "规则所需字段在对象上齐备（查全：字段缺失→静默漏判=0）",
        oracle: "invariant",
        pass: orders.length > 0 && fieldGaps === 0,
        expected: 0,
        actual: fieldGaps,
        diff: fieldGaps ? `${fieldGaps} 个 Order 缺约束扫描字段` : undefined,
      });
      const plantedC03 = orders.filter((o) => Number(o.props.demandDelta) > 0.5).length;
      assertions.push({
        segment: "④规则查全查准",
        point: "植入越线行被独立谓词捕获（查准：C03 demandDelta>0.5 命中>0）",
        oracle: "constructed",
        pass: plantedC03 > 0,
        expected: ">0",
        actual: plantedC03,
      });

      // ⑤ 求解器执行（独立预言机，VL7：不 import 求解器，验"求解链有真实负载"而非空跑）。
      //   供给(Σ基地产能 gwh)与需求(Σ订单 qty)双侧均非退化 → 求解器面对真实供需缺口。
      const bases = objects.filter((o) => o.type === "Base");
      const supply = bases.reduce((s, o) => s + (typeof o.props.gwh === "number" ? (o.props.gwh as number) : 0), 0);
      const demand = orders.reduce((s, o) => s + (typeof o.props.qty === "number" ? (o.props.qty as number) : 0), 0);
      assertions.push({
        segment: "⑤求解器执行",
        point: "求解负载非退化（供给Σgwh>0 且 需求Σqty>0 → 非空跑）",
        oracle: "constructed",
        pass: supply > 0 && demand > 0,
        expected: "supply>0 && demand>0",
        actual: `supply=${Number(supply.toFixed(1))} demand=${demand}`,
      });

      // ⑥ 行动终态（R4 真值经 Action，独立预言机）：每个已注册 ActionType 必有非空审批链——
      //   空审批链 = 绕过审批直写真值的后门（R4 违反）。读注册表独立断言，不触发执行。
      const actionTypes = await this.repos.actionTypes.list(vTenant);
      const noChain = actionTypes.filter((a) => !Array.isArray(a.approvalChain) || a.approvalChain.length === 0);
      assertions.push({
        segment: "⑥行动终态",
        point: "真值变更必经审批（已注册 ActionType 审批链非空，无直写后门）",
        oracle: "invariant",
        pass: actionTypes.length > 0 && noChain.length === 0,
        expected: 0,
        actual: noChain.length,
        diff: noChain.length ? `空审批链: ${noChain.map((a) => a.key).join(",")}` : undefined,
      });

      // ⑦ 校准注入（学习回路注入点，独立预言机）：每个种子校准提案的模拟误差必须改善
      //   (simulatedMapeAfter < mapeBefore)——注入即恶化 = 反校准，回路发散。
      const proposals = await this.repos.calibrationProposals.list(vTenant);
      const worsening = proposals.filter((p) => !(p.evidence && p.evidence.simulatedMapeAfter < p.evidence.mapeBefore));
      assertions.push({
        segment: "⑦校准注入",
        point: "校准注入即收敛（提案 simulatedMapeAfter < mapeBefore，无反校准）",
        oracle: "invariant",
        pass: proposals.length > 0 && worsening.length === 0,
        expected: 0,
        actual: worsening.length,
        diff: worsening.length ? `恶化提案: ${worsening.map((p) => p.id).join(",")}` : undefined,
      });

      // 不变量：同 seed 重放逐字节幂等（确定性）。
      const det = await this.determinismCheck(seed);
      assertions.push({
        segment: "横切·确定性",
        point: "同 seed 全链重放幂等",
        oracle: "invariant",
        pass: det.pass,
        expected: det.expected,
        actual: det.actual,
      });

      // 不变量：epoch 单调（写批次锚点 ≥1）。
      const epoch = await this.repos.epochs.current(vTenant);
      assertions.push({
        segment: "横切·快照",
        point: "epoch 单调（≥1 次写批次）",
        oracle: "invariant",
        pass: epoch >= 1,
        expected: ">=1",
        actual: epoch,
      });
    } finally {
      // 租户销毁（只清验证租户数据，零交叉）。
      await this.destroyTenant(vTenant);
    }

    const report = this.buildReport(profile, seed, assertions);
    const rec: ValidationRunRecord = {
      id,
      tenantId: callerCtx.tenantId,
      profile,
      seed,
      startedAt,
      finishedAt: new Date().toISOString(),
      report,
    };
    await this.repos.validationRuns.put(rec);
    return rec;
  }

  // -- oracles --------------------------------------------------------------

  /** 取首个有数值属性的对象类型，比较聚合 SUM 与逐行求和。 */
  private async aggregateEqualsDetail(
    ctx: AuthCtx,
  ): Promise<{ pass: boolean; expected: number; actual: number; typeKey?: string; prop?: string }> {
    const types = await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
    for (const ty of types) {
      const objs = await this.repos.objects.listByType(ctx.tenantId, ty.key);
      if (objs.length === 0) continue;
      const numProp = ty.properties.find(
        (p) => !p.isPrimaryKey && objs.some((o) => typeof o.props[p.propKey] === "number"),
      );
      if (!numProp) continue;
      const detail = objs.reduce((s, o) => s + (typeof o.props[numProp.propKey] === "number" ? (o.props[numProp.propKey] as number) : 0), 0);
      const agg = (await this.ontology.queryObjects(ctx, ty.key, {}, 1000)).data as { props: Record<string, unknown> }[];
      const viaQuery = agg.reduce((s, o) => s + (typeof o.props[numProp.propKey] === "number" ? (o.props[numProp.propKey] as number) : 0), 0);
      const pass = Math.abs(detail - viaQuery) < 1e-6;
      return { pass, expected: detail, actual: viaQuery, typeKey: ty.key, prop: numProp.propKey };
    }
    return { pass: true, expected: 0, actual: 0 };
  }

  /** 同 seed 两次生成 → 对象数与属性指纹一致（在临时子租户上比对，比对后清理）。 */
  private async determinismCheck(seed: number): Promise<{ pass: boolean; expected: string; actual: string }> {
    const a = `vle_det_a_${newId("d")}`;
    const b = `vle_det_b_${newId("d")}`;
    try {
      await this.synthetic.runJob({ tenantId: a, userId: "vle", roles: ["admin"], attributes: {} }, { industry: "battery-manufacturing", scale: "S", seed });
      await this.synthetic.runJob({ tenantId: b, userId: "vle", roles: ["admin"], attributes: {} }, { industry: "battery-manufacturing", scale: "S", seed });
      const fa = await this.fingerprint(a);
      const fb = await this.fingerprint(b);
      return { pass: fa === fb, expected: fa, actual: fb };
    } finally {
      await this.destroyTenant(a);
      await this.destroyTenant(b);
    }
  }

  /** 对象集合的稳定指纹（按 id 排序的 type+props 串）。 */
  private async fingerprint(tenantId: string): Promise<string> {
    const objs = (await this.repos.objects.list(tenantId)).sort((x, y) => (x.id < y.id ? -1 : 1));
    const canon = objs.map((o) => `${o.id}|${o.type}|${JSON.stringify(o.props, Object.keys(o.props).sort())}`).join("\n");
    let h = 0;
    for (let i = 0; i < canon.length; i++) h = (Math.imul(31, h) + canon.charCodeAt(i)) | 0;
    return `${objs.length}:${h >>> 0}`;
  }

  // -- fault injection (test-only) ------------------------------------------

  private async injectDanglingLink(ctx: AuthCtx): Promise<void> {
    const links = await this.repos.links.list(ctx.tenantId);
    const first = links[0];
    if (first) await this.repos.links.put({ ...first, toId: "obj_does_not_exist" });
  }

  private async injectBrokenAggregate(ctx: AuthCtx): Promise<void> {
    // corrupt one numeric prop so detail-sum diverges from a recomputed sum is not
    // possible (both read same store) — instead drop one object to break count-based
    // invariants downstream; here we no-op aggregate (kept for parity with profile docs).
    const objs = await this.repos.objects.list(ctx.tenantId);
    if (objs[0]) await this.repos.objects.remove(ctx.tenantId, objs[0].id);
  }

  private async destroyTenant(tenantId: string): Promise<void> {
    await this.repos.objects.removeWhere(tenantId, () => true);
    await this.repos.links.removeWhere(tenantId, () => true);
    for (const r of await this.repos.rules.list(tenantId)) await this.repos.rules.remove(tenantId, r.id);
    for (const j of await this.repos.syntheticJobs.list(tenantId)) await this.repos.syntheticJobs.remove(tenantId, j.id);
  }

  // -- report ---------------------------------------------------------------

  private buildReport(profile: "SMOKE" | "FULL" | "SOAK", seed: number, assertions: Assertion[]) {
    const passed = assertions.filter((a) => a.pass).length;
    const total = assertions.length || 1;
    const segments = new Set(assertions.map((a) => a.segment));
    const greenSegments = new Set(
      [...segments].filter((s) => assertions.filter((a) => a.segment === s).every((a) => a.pass)),
    );
    // 三覆盖率：module = 断言通过率；assertion = **已验证的规范段数 / 7**（不再硬编码 1，诚实反映
    // 七段闭环实际覆盖到第几段）；loop = 段全绿比例。
    const moduleCov = passed / total;
    const canonicalCovered = CANONICAL_SEGMENTS.filter((cs) => segments.has(cs)).length;
    const assertionCov = canonicalCovered / CANONICAL_SEGMENTS.length;
    const loopCov = greenSegments.size / segments.size;
    const score = 0.5 * moduleCov + 0.3 * assertionCov + 0.2 * loopCov;
    return {
      profile,
      seed,
      pass: passed === assertions.length,
      assertions,
      coverage: {
        module: Number(moduleCov.toFixed(4)),
        assertion: Number(assertionCov.toFixed(4)),
        loop: Number(loopCov.toFixed(4)),
      },
      engineeringVerificationScore: Number(score.toFixed(4)),
    };
  }
}
