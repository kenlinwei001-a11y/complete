/**
 * 感知层埋点（A5）：实体解析的"误触发率"= 域外实体数 / objectRef 解析尝试数。
 * 进程级有界环（per-tenant 隔离 R2），供 GET /api/v1/perception/metrics 观测，
 * 让"裸串实体解析不到"从静默澄清变为可量化信号（分子/分母都记）。
 */
export interface OutOfDomainRecord {
  tenantId: string;
  intentKey: string;
  slotName: string;
  value: string;
  candidates: { objectType: string; objectId: string; label: string; score: number }[];
  at: string;
}

const RING_MAX = 200;
const ring: OutOfDomainRecord[] = [];
const counters = new Map<string, { attempts: number; outOfDomain: number }>();

function bucket(tenantId: string) {
  let c = counters.get(tenantId);
  if (!c) {
    c = { attempts: 0, outOfDomain: 0 };
    counters.set(tenantId, c);
  }
  return c;
}

/** 记 objectRef 解析尝试（分母）：attempted 含命中+域外。 */
export function recordResolutionAttempts(tenantId: string, attempted: number, outOfDomain: number): void {
  if (attempted <= 0) return;
  const c = bucket(tenantId);
  c.attempts += attempted;
  c.outOfDomain += outOfDomain;
}

/** 记一条域外实体（分子明细，入环）。 */
export function recordOutOfDomain(rec: OutOfDomainRecord): void {
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
}

export interface PerceptionMetrics {
  attempts: number;
  outOfDomain: number;
  /** 误触发率 = 域外 / 尝试（0 尝试 → 0）。 */
  falseTriggerRate: number;
  recent: OutOfDomainRecord[];
}

export function perceptionMetrics(tenantId: string, recentLimit = 20): PerceptionMetrics {
  const c = bucket(tenantId);
  const recent = ring.filter((r) => r.tenantId === tenantId).slice(-recentLimit).reverse();
  return {
    attempts: c.attempts,
    outOfDomain: c.outOfDomain,
    falseTriggerRate: c.attempts === 0 ? 0 : Number((c.outOfDomain / c.attempts).toFixed(4)),
    recent,
  };
}

/** 测试隔离用：清空进程级状态。 */
export function resetPerceptionMetrics(): void {
  ring.length = 0;
  counters.clear();
}
