// L1.5 · 案例摄取服务（WO-L1.5-3·PRD-L1.5 §2.3）—— apps/datacore/src/memory/case-ingest.ts
//
// DataCore 一等 Decision（真值单一来源）→ 结构化 DecisionCase（咨询派生 index）的**摄取接线**。
// 决策记录/补录结果达终态 → decisionToArtifact → projectCase → 落 decision_cases → 发 decision_case.learned。
// 记忆域落 DataCore（DISPATCH Lane B）·Decision 与案例 index 同栈·in-process 投影（无 OBO·更简）。
//
// 暗发：QOS_CBR_INGEST≠"1" → 不摄取（案例 index 空·agent 仅路径提示·回退杠杆②·pipeline 零变化）。
// R6：案例 createdAt = decision.updatedAt（源决策的确定性函数·非墙钟）→ 同决策同案例字节一致。
// R4/RL4：案例是咨询派生·非业务真值（Decision 真值零动）；摄取失败绝不阻断决策记录（best-effort）。

import type { AuthCtx } from "../domain.js";
import type { Decision } from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import { decisionToArtifact, projectCase } from "./decision-case.js";

export class CaseIngestService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
    /** 返回 QOS_CBR_INGEST 是否开（config.QOS_CBR_INGEST === "1"）。 */
    private ingestEnabled: () => boolean,
  ) {}

  /**
   * 从一条真 Decision 投影并摄取案例（幂等 upsert-by-caseId·同决策重投影覆盖）。
   * QOS_CBR_INGEST 关 → no-op（诚实空 index）。失败吞（不阻断决策记录·best-effort）。
   */
  async ingestFromDecision(ctx: AuthCtx, decision: Decision): Promise<void> {
    if (!this.ingestEnabled()) return;
    try {
      const artifact = decisionToArtifact(decision);
      // R6：now = decision.updatedAt（源决策确定性时点·非墙钟）→ 案例可重放字节一致。
      const kase = projectCase(artifact, { tenantId: ctx.tenantId, now: decision.updatedAt });
      await this.repos.decisionCases.put({ ...kase, id: kase.caseId });
      await this.outbox.emit(
        ctx.tenantId,
        "decision_case.learned",
        { caseId: kase.caseId, source: kase.source, sourceRefId: kase.sourceRefId }, // 不含业务数字
        kase.caseId,
      );
    } catch {
      /* best-effort·摄取失败不阻断决策记录（案例咨询派生·可后续 rebuild） */
    }
  }
}
