/**
 * WO-SIM-OPTIONS-P1 · 对策区「采纳此方案」→ ActionDraft 生产者。
 *
 * - 后端零改动：复用 `POST /a/v1/action-drafts` + `plan_change` + `submit=true`。
 * - 幂等：以 `candidateId + scenarioFingerprint` 为键，先查现有草稿，PENDING/APPROVED Reuse。
 * - 态机：idle → submitting → pending → approved / rejected / failed，轮询 `GET /a/v1/action-drafts/:id`。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/workspace/useWorkspace";
import { createActionDraft, fetchActionDraft, fetchActionDrafts } from "@/api/endpoints";
import type { CandidateVM } from "../../chainImpediment";

export interface AdoptLever {
  objectType: string;
  objectId: string;
  prop: string;
  value: number;
}

type AdoptStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "pending"; draftId: string }
  | { kind: "approved"; draftId: string; targetRef?: string }
  | { kind: "rejected"; draftId: string; reason?: string }
  | { kind: "failed"; error: string };

interface SimPerturbationLike {
  kind: string;
  targetObjectId: string;
  targetStateVar: string;
  magnitude: number | null;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // 测试环境 fallback：稳定字符串哈希，不依赖 WebCrypto。
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return `fallback_${Math.abs(h).toString(16).padStart(8, "0")}`;
}

export async function scenarioFingerprint(perturbations: readonly SimPerturbationLike[]): Promise<string> {
  const sorted = [...perturbations].sort((a, b) => {
    const ka = `${a.targetObjectId}.${a.targetStateVar}`;
    const kb = `${b.targetObjectId}.${b.targetStateVar}`;
    return ka.localeCompare(kb);
  });
  const canonical = JSON.stringify(
    sorted.map((p) => ({
      kind: p.kind,
      target: `${p.targetObjectId}.${p.targetStateVar}`,
      magnitude: p.magnitude,
    })),
  );
  return sha256Hex(canonical);
}

export function useOptionAdopt(
  sessionId: string | undefined,
  perturbations: readonly SimPerturbationLike[],
) {
  const { data: workspace } = useWorkspace();
  const [statuses, setStatuses] = useState<Record<string, AdoptStatus>>({});
  const fingerprint = useMemo(() => scenarioFingerprint(perturbations), [perturbations]);

  /** 轮询所有 pending 草稿，直到终态。 */
  useEffect(() => {
    const pending = Object.entries(statuses).filter(([, s]) => s.kind === "pending") as [
      string,
      { draftId: string },
    ][];
    if (pending.length === 0) return;
    let alive = true;
    const tick = async () => {
      for (const [key, { draftId }] of pending) {
        try {
          const d = await fetchActionDraft(draftId);
          if (!alive) return;
          const terminal = ["EXECUTED", "EXECUTION_FAILED", "REJECTED", "CANCELLED"].includes(d.status);
          const next: AdoptStatus =
            d.status === "APPROVED"
              ? { kind: "approved", draftId, targetRef: d.executionResult?.targetRef }
              : d.status === "PENDING_APPROVAL"
                ? { kind: "pending", draftId }
                : d.status === "REJECTED"
                  ? { kind: "rejected", draftId, reason: d.executionResult?.error }
                  : d.status === "EXECUTED"
                    ? { kind: "approved", draftId, targetRef: d.executionResult?.targetRef }
                    : d.status === "EXECUTION_FAILED"
                      ? { kind: "failed", error: d.executionResult?.error ?? "执行失败" }
                      : { kind: "failed", error: `未知状态 ${d.status}` };
          setStatuses((prev) => ({ ...prev, [key]: next }));
          if (terminal) {
            // 到达终态后停止本轮；effect 重新收集剩余 pending。
          }
        } catch {
          // 轮询失败保持原态，下次再试。
        }
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [statuses]);

  const adopt = useMutation({
    mutationFn: async (input: { key: string; candidateId: string; levers: AdoptLever[] }) => {
      const fp = await fingerprint;
      const drafts = await fetchActionDrafts();
      const existing = drafts.find((d) => {
        if (d.actionTypeKey !== "plan_change") return false;
        const ev = d.payload?.evidence as Record<string, unknown> | undefined;
        const src = d.payload?.source as string | undefined;
        return (
          src === "sim-console-options" &&
          ev?.candidateId === input.candidateId &&
          ev?.scenarioFingerprint === fp &&
          !["REJECTED", "CANCELLED", "EXECUTION_FAILED"].includes(d.status)
        );
      });
      if (existing) {
        return { draftId: existing.id, status: existing.status, reused: true };
      }
      const r = await createActionDraft({
        actionTypeKey: "plan_change",
        payload: {
          source: "sim-console-options",
          levers: input.levers,
          evidence: {
            sessionId,
            candidateId: input.candidateId,
            scenarioFingerprint: fp,
            pricing: null,
            disclosure: { tickCount: null, elapsedMs: null, agentInvolved: false },
          },
        },
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      });
      return { draftId: r.draftId, status: r.status, reused: false };
    },
    onMutate: (input) => {
      setStatuses((prev) => ({ ...prev, [input.key]: { kind: "submitting" } }));
    },
    onSuccess: (r, input) => {
      const next: AdoptStatus =
        r.status === "PENDING_APPROVAL"
          ? { kind: "pending", draftId: r.draftId }
          : ["APPROVED", "EXECUTED"].includes(r.status)
            ? { kind: "approved", draftId: r.draftId }
            : { kind: "pending", draftId: r.draftId };
      setStatuses((prev) => ({ ...prev, [input.key]: next }));
    },
    onError: (err, input) => {
      setStatuses((prev) => ({
        ...prev,
        [input.key]: { kind: "failed", error: err instanceof Error ? err.message : String(err) },
      }));
    },
  });

  const reset = useCallback((key: string) => {
    setStatuses((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }, []);

  return { statuses, fingerprint, adopt: adopt.mutate, isPending: adopt.isPending, reset };
}

/** 把引擎候选的 lever 字段转成 plan_change 杠杆行。 */
export function candidateToAdoptLevers(c: CandidateVM): AdoptLever[] {
  return [
    {
      objectType: c.lever.objectType,
      objectId: c.lever.objectId,
      prop: c.lever.prop,
      value: c.toValue,
    },
  ];
}
