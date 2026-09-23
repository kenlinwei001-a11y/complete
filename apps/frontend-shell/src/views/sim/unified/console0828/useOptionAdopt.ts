/**
 * WO-SIM-OPTIONS-P1 · 对策区「采纳此方案」
 *
 * - 幂等：以 candidateId + scenarioFingerprint 为键，先查现有草稿复用。
 * - 态机：idle → submitting → pending → approved / rejected / failed。
 * - 建稿委托给 shared.tsx 的 useAdoptToDraft，不在这里另写生产者。
 * - objectId 映射：候选里的 objectId 是业务键，必须回读对象清单换成真对象 id 才建稿。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActionDraft, fetchActionDrafts, fetchAllObjects } from "@/api/endpoints";
import { useAdoptToDraft } from "../../shared";
import { scenarioFingerprint, type AdoptLever } from "./console0828Model";

interface SimPerturbationLike {
  kind: string;
  targetObjectId: string;
  targetStateVar: string;
  magnitude: number | null;
}

export type AdoptStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "pending"; draftId: string }
  | { kind: "approved"; draftId: string; targetRef?: string }
  | { kind: "rejected"; draftId: string; reason?: string }
  | { kind: "failed"; error: string };

export interface AdoptInput {
  key: string;
  candidateId: string;
  /** 前端显示用的目标值文本（如 "90%"），只进 reason，不进执行载荷。 */
  toText?: string;
  levers: AdoptLever[];
}

function resolveObjectId(
  objectType: string,
  bizKey: string,
  page: Awaited<ReturnType<typeof fetchAllObjects>>,
): string | null {
  // ① 按任意 props 值等于业务键来匹配（不硬编码 lineId 等属性名）。
  const byProp = page.items.find((o) =>
    Object.entries(o.props).some(([, v]) => typeof v === "string" && v === bizKey),
  );
  if (byProp) return byProp.id;
  // ② 回退到命名约定，但必须验证存在。
  const guessed = `obj_${objectType.toLowerCase()}_${bizKey}`;
  const byId = page.items.find((o) => o.id === guessed);
  return byId ? byId.id : null;
}

export function useOptionAdopt(sessionId: string | undefined, perturbations: readonly SimPerturbationLike[]) {
  const adoptToDraft = useAdoptToDraft("adopt_sim_option");
  const [statuses, setStatuses] = useState<Record<string, AdoptStatus>>({});
  const fingerprint = useMemo(() => scenarioFingerprint(perturbations), [perturbations]);

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
          const next: AdoptStatus =
            d.status === "APPROVED" || d.status === "EXECUTED"
              ? { kind: "approved", draftId, targetRef: d.executionResult?.targetRef }
              : d.status === "PENDING_APPROVAL"
                ? { kind: "pending", draftId }
                : d.status === "REJECTED"
                  ? { kind: "rejected", draftId, reason: d.executionResult?.error }
                  : d.status === "EXECUTION_FAILED"
                    ? { kind: "failed", error: d.executionResult?.error ?? "执行失败" }
                    : { kind: "failed", error: `未知状态 ${d.status}` };
          setStatuses((prev) => ({ ...prev, [key]: next }));
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

  const adopt = useCallback(
    async (input: AdoptInput) => {
      const fp = await fingerprint;
      const drafts = await fetchActionDrafts();
      const existing = drafts.find((d) => {
        if (d.actionTypeKey !== "adopt_sim_option") return false;
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
        const next: AdoptStatus =
          existing.status === "PENDING_APPROVAL"
            ? { kind: "pending", draftId: existing.id }
            : ["APPROVED", "EXECUTED"].includes(existing.status)
              ? { kind: "approved", draftId: existing.id, targetRef: existing.executionResult?.targetRef }
              : { kind: "pending", draftId: existing.id };
        setStatuses((prev) => ({ ...prev, [input.key]: next }));
        return;
      }

      // 业务键 → 真对象 id
      const objectCache = new Map<string, ReturnType<typeof fetchAllObjects>>();
      const resolvedLevers: AdoptLever[] = [];
      for (const l of input.levers) {
        let cached = objectCache.get(l.objectType);
        if (!cached) {
          cached = fetchAllObjects(l.objectType);
          objectCache.set(l.objectType, cached);
        }
        const page = await cached;
        const realId = resolveObjectId(l.objectType, l.objectId, page);
        if (realId === null) {
          setStatuses((prev) => ({
            ...prev,
            [input.key]: {
              kind: "failed",
              error: `未找到对象 ${l.objectType}.${l.objectId}（按业务键/约定 id 均查无）`,
            },
          }));
          return;
        }
        resolvedLevers.push({ ...l, objectId: realId });
      }

      const reason = `采纳对策候选 ${input.candidateId}：拨 ${resolvedLevers
        .map((l) => `${l.prop} → ${input.toText ?? String(l.value)}`)
        .join("，")}`;

      setStatuses((prev) => ({ ...prev, [input.key]: { kind: "submitting" } }));
      adoptToDraft.mutate(
        {
          source: "sim-console-options",
          levers: resolvedLevers,
          reason,
          evidence: {
            sessionId,
            candidateId: input.candidateId,
            scenarioFingerprint: fp,
            pricing: null,
            disclosure: { agentInvolved: false },
          },
        },
        {
          onSuccess: (r: { draftId?: string; status?: string }) => {
            const status = r.status ?? "PENDING_APPROVAL";
            const draftId = r.draftId ?? "unknown";
            const next: AdoptStatus =
              status === "PENDING_APPROVAL"
                ? { kind: "pending", draftId }
                : ["APPROVED", "EXECUTED"].includes(status)
                  ? { kind: "approved", draftId }
                  : { kind: "pending", draftId };
            setStatuses((prev) => ({ ...prev, [input.key]: next }));
          },
          onError: (err: unknown) => {
            setStatuses((prev) => ({
              ...prev,
              [input.key]: { kind: "failed", error: err instanceof Error ? err.message : String(err) },
            }));
          },
        },
      );
    },
    [adoptToDraft, fingerprint, sessionId],
  );

  const reset = useCallback((key: string) => {
    setStatuses((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }, []);

  return { statuses, fingerprint, adopt, isPending: adoptToDraft.isPending, reset };
}
