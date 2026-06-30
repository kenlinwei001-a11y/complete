import type { SolverDataMode } from "@platform/contracts";

/**
 * A0（空洞数据冰山结构性根因修）· 求解器输出诚实位徽章 = 单一展示组件。
 * LIVE=真对象数据派生（低调标）；MOCK=无真数据源·哈希/魔数/硬编码启发（警示，禁冒充真算）；
 * PARTIAL=真假混合（曲线确定性派生但订单真算，或真对象+魔数兜底）。
 * 把 RiskBoardView 已有的内联诚实标抽成共用组件，供 audit_timeline + extended 全族复用。
 */
const LABEL: Record<SolverDataMode, string> = {
  LIVE: "实测",
  MOCK: "估算·无实测",
  PARTIAL: "部分估算",
};
const DEFAULT_TITLE: Record<SolverDataMode, string> = {
  LIVE: "结论由真对象数据派生",
  MOCK: "无真数据源，结论为确定性派生/启发估算（非实测）——不可当真值采信",
  PARTIAL: "真假混合：部分由真数据算、部分为确定性派生/魔数兜底（非全实测）",
};

export function DataModeBadge({ mode, note, testId }: { mode?: SolverDataMode | string | null; note?: string; testId?: string }) {
  if (!mode || !(mode in LABEL)) return null;
  const m = mode as SolverDataMode;
  const warn = m !== "LIVE";
  return (
    <span
      className="badge"
      data-testid={testId ?? `datamode-${m}`}
      title={note ?? DEFAULT_TITLE[m]}
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
