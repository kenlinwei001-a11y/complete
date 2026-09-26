// A18 · PROVISIONAL 诚实门（provisional-honesty）：守"未审核态绝不谎报"的纯函数校验。
// 红线（PRD §3.5/R13）：PROVISIONAL 建出的域——① 整域 domainTrustLevel=UNVERIFIED；② 终态验证恒
// PROVISIONAL_ANSWER（绝不 VERIFIED/answerable）；③ 闭包缺口全降 ADVISORY（如实记录、不阻断、不谎报已闭合）。
import type { StoryBuildRun } from "@platform/contracts";

export interface HonestyViolation {
  rule: string;
  detail: string;
}

/** 校验单条 StoryBuildRun 是否守 PROVISIONAL 诚实红线（STRICT 直接通过，空违规）。 */
export function checkProvisionalHonesty(run: StoryBuildRun): HonestyViolation[] {
  if (run.buildMode !== "PROVISIONAL") return [];
  const v: HonestyViolation[] = [];
  if (run.domainTrustLevel !== "UNVERIFIED") {
    v.push({ rule: "TRUST_LABEL", detail: `PROVISIONAL 域必须 domainTrustLevel=UNVERIFIED，实为 ${run.domainTrustLevel ?? "缺失"}` });
  }
  if (run.verification) {
    if (run.verification.status !== "PROVISIONAL_ANSWER") {
      v.push({ rule: "VERDICT", detail: `PROVISIONAL 域验证终态必须 PROVISIONAL_ANSWER，实为 ${run.verification.status}（谎报风险）` });
    }
    if (run.verification.answerable === true) {
      v.push({ rule: "NO_ANSWERABLE", detail: "PROVISIONAL 域不得标 answerable=true（绝不冒充能用）" });
    }
  }
  if (run.closureReport && run.closureReport.buildMode === "PROVISIONAL") {
    for (const f of run.closureReport.findings) {
      if ((f.status === "FAILED" || f.status === "MISSING") && f.severity !== "ADVISORY") {
        v.push({ rule: "ADVISORY_SEVERITY", detail: `PROVISIONAL 闭包缺口 ${f.ref} 必须 severity=ADVISORY（如实记录、不阻断）` });
      }
    }
    if (run.closureReport.blocked) {
      v.push({ rule: "NOT_BLOCKED", detail: "PROVISIONAL 闭包不得 blocked=true（守'不靠阻断成 0'）" });
    }
  }
  return v;
}
