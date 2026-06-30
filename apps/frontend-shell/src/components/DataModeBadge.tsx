import type { SolverDataMode, SolverConfidence } from "@platform/contracts";

/**
 * A0（空洞数据冰山结构性根因修）· 求解器输出诚实位徽章 = 单一展示组件。
 * LIVE=真对象数据派生（低调标）；MOCK=无真数据源·哈希/魔数/硬编码启发（警示，禁冒充真算）；
 * PARTIAL=真假混合（曲线确定性派生但订单真算，或真对象+魔数兜底）。
 * 把 RiskBoardView 已有的内联诚实标抽成共用组件，供 audit_timeline + extended 全族复用。
 *
 * WO-FRESHNESS（置信度三维贯通·追加 STALE/SYNTHETIC 标签·不破既有 LIVE/MOCK/PARTIAL）：
 * - STALE     = 真对象派生但关键源新鲜度滞后 → 「基于 N 小时前」。
 * - SYNTHETIC = 结论建立在合成对象上 → 「合成数据（非真实接入）」。
 * 传 confidence 则在 title/note 里展开三维（真实↔合成 × 新鲜↔陈旧 × 实测↔估算）。
 */
const LABEL: Record<SolverDataMode, string> = {
  LIVE: "实测",
  MOCK: "估算·无实测",
  PARTIAL: "部分估算",
  STALE: "数据滞后",
  SYNTHETIC: "合成数据",
};
const DEFAULT_TITLE: Record<SolverDataMode, string> = {
  LIVE: "结论由真对象数据派生",
  MOCK: "无真数据源，结论为确定性派生/启发估算（非实测）——不可当真值采信",
  PARTIAL: "真假混合：部分由真数据算、部分为确定性派生/魔数兜底（非全实测）",
  STALE: "结论由真对象派生，但关键数据源新鲜度滞后——此决策基于较早前的数据",
  SYNTHETIC: "结论建立在合成对象上（非真实接入）——合成数据用于冷启动/演示，不可当真实接入采信",
};

function buildNote(confidence?: SolverConfidence | null): string | undefined {
  if (!confidence) return undefined;
  if (confidence.note) return confidence.note;
  const parts: string[] = [];
  parts.push(confidence.synthetic ? "真实↔合成：合成数据（非真实接入）" : "真实↔合成：真实接入");
  if (confidence.stale) {
    const src = (confidence.staleSources ?? []).join("、");
    parts.push(`新鲜↔陈旧：关键源${src ? ` ${src}` : ""} 滞后约 ${confidence.lagHours ?? "?"} 小时`);
  } else {
    parts.push("新鲜↔陈旧：新鲜");
  }
  const measLabel = { LIVE: "实测", MOCK: "估算（无实测）", PARTIAL: "部分估算" } as const;
  parts.push(`实测↔估算：${measLabel[confidence.measurement]}`);
  return parts.join("；");
}

export function DataModeBadge({
  mode,
  note,
  confidence,
  testId,
}: {
  mode?: SolverDataMode | string | null;
  note?: string;
  confidence?: SolverConfidence | null;
  testId?: string;
}) {
  if (!mode || !(mode in LABEL)) return null;
  const m = mode as SolverDataMode;
  const warn = m !== "LIVE";
  const title = note ?? buildNote(confidence) ?? DEFAULT_TITLE[m];
  return (
    <span
      className="badge"
      data-testid={testId ?? `datamode-${m}`}
      title={title}
      style={{
        fontSize: 10,
        alignSelf: "flex-start",
        ...(warn
          ? { background: "var(--warn, #caa23a)", color: "#1a1400" }
          : { opacity: 0.8 }),
      }}
    >
      {LABEL[m]}
    </span>
  );
}
