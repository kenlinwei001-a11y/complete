import type { DataHealthResponse } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import type { SolverService } from "./solvers/service.js";
import { FEATURE_REGISTRY } from "./features.js";
import type { FeatureService } from "./features.js";
import { num, str } from "./solvers/types.js";
import { round } from "./prng.js";
import { CONN_SYSTEM, TYPE_SOURCE_SYSTEM } from "./graphmeta.js";

const DEFAULT_CONN_THRESHOLD_MIN = 24 * 60;

type Source = DataHealthResponse["sources"][number];

/**
 * §7.22 数据健康度：与 C09 降级共用同一事实源 —— DataSourceHealth 对象的 lagHours
 * vs solverParams.health.staleHours（capacity_forecast 的 P90 降级判定完全一致），
 * 外加连接器同步新鲜度。降级影响的受影响求解器 = FeatureRegistry bindings 反查。
 */
export async function buildDataHealth(
  repos: Repos,
  solvers: SolverService,
  features: FeatureService,
  tenantId: string,
): Promise<DataHealthResponse> {
  const params = await solvers.getParams(tenantId);
  const staleHours = params.health.staleHours;
  const now = Date.now();

  // 受影响求解器：启用 feature 的 solverKeys bindings 反查（与功能开通同一份注册表）
  const enabled = new Set((await features.resolve(tenantId)).features);
  const affectedSolvers = [
    ...new Set(
      FEATURE_REGISTRY.filter((f) => enabled.has(f.key)).flatMap((f) => f.bindings?.solverKeys ?? []),
    ),
  ].sort();
  const degradeImpact = {
    p90From: params.health.normal,
    p90To: params.health.degraded,
    affectedSolvers,
  };

  const sources: Source[] = [];
  // WO-7：逐源真对象数归因（对象类型→真实来源系统，权威表 TYPE_SOURCE_SYSTEM）。demo 全对象经单一
  // 合成连接器物化，故不能靠 sourceBindings.connId 连接（对 9 业务源恒空）；改按"该数据类别真实系统主"
  // 归因 + 真实例数。空数组=该源被监控但无物化对象（诚实，非伪造）。
  const typeNames = new Map(
    (await repos.ontologyTypes.list(tenantId)).map((t) => [t.key, t.displayName || t.key] as const),
  );
  const membersBySource = new Map<string, { typeKey: string; displayName: string; count: number }[]>();
  for (const [typeKey, sourceId] of Object.entries(TYPE_SOURCE_SYSTEM)) {
    const count = (await repos.objects.listByType(tenantId, typeKey)).length;
    if (count === 0) continue; // 类型未物化 → 不计（不虚增）
    if (!membersBySource.has(sourceId)) membersBySource.set(sourceId, []);
    membersBySource.get(sourceId)!.push({ typeKey, displayName: typeNames.get(typeKey) ?? typeKey, count });
  }
  for (const m of membersBySource.values()) m.sort((a, b) => (a.typeKey < b.typeKey ? -1 : 1));

  // ① DataSourceHealth 对象（IoT 等关键实时源；C09 的判定输入）
  const healthObjs = (await repos.objects.listByType(tenantId, "DataSourceHealth")).sort((a, b) =>
    str(a.props.sourceId) < str(b.props.sourceId) ? -1 : 1,
  );
  for (const h of healthObjs) {
    const lagHours = num(h.props.lagHours);
    const critical = h.props.critical === true;
    const delayed = critical && lagHours > staleHours;
    const sourceId = str(h.props.sourceId, h.id);
    const members = membersBySource.get(sourceId) ?? [];
    sources.push({
      connId: sourceId,
      name: str(h.props.name, sourceId),
      system: str(h.props.name).includes("IoT") ? "IoT/SCADA" : str(h.props.name, "源系统"),
      lastDataAt: new Date(now - lagHours * 3600_000).toISOString(),
      latencyMin: round(lagHours * 60, 1),
      thresholdMin: round(staleHours * 60, 1),
      status: delayed ? "DELAYED" : "OK",
      members,
      objectCount: members.reduce((s, x) => s + x.count, 0),
      ...(delayed ? { degradeImpact } : {}),
    });
  }
  // ② 连接器（A1）：最近成功同步距今
  const conns = (await repos.connections.list(tenantId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const conn of conns) {
    const lastDataAt = conn.lastSyncAt;
    const latencyMin = lastDataAt ? round((now - Date.parse(lastDataAt)) / 60000, 1) : Number.NaN;
    const status: Source["status"] =
      conn.status === "ERROR"
        ? "DOWN"
        : lastDataAt && latencyMin <= DEFAULT_CONN_THRESHOLD_MIN
          ? "OK"
          : lastDataAt
            ? "DELAYED"
            : "OK";
    sources.push({
      connId: conn.id,
      name: conn.name,
      system: CONN_SYSTEM[conn.id] ?? conn.connectorTypeKey,
      ...(lastDataAt ? { lastDataAt } : {}),
      latencyMin: Number.isFinite(latencyMin) ? latencyMin : 0,
      thresholdMin: DEFAULT_CONN_THRESHOLD_MIN,
      status,
    });
  }
  const overall: DataHealthResponse["overall"] = sources.some((s) => s.status === "DOWN")
    ? "DOWN"
    : sources.some((s) => s.status === "DELAYED")
      ? "DELAYED"
      : "OK";
  return { sources, overall };
}
