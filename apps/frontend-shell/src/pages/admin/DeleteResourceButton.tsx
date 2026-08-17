import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ConfirmModal } from "@/components/ui/Modal";
import ReferencesPanel from "@/components/ReferencesPanel";
import { toast, toastError } from "@/store/toastStore";
import type { ReferenceTargetKind } from "@/api/endpoints";

/**
 * WO-BEFE-DELETE-WIRE · **删除入口的唯一实现**（Agent / 流程 / 技能 / MCP 配置 / 场景入口五处共用）。
 *
 * ── 为什么是一份实现，不是五个页各写一个 ────────────────────────────────────
 * 五条端点的后端语义**由同一对函数决定**（`apps/agentcore/src/resources.ts` 的
 * `computeReferences` + `assertRetireOrDelete`）。措辞散到五页去写，迟早出现
 * 「A 页说会连带删、B 页说会被拒」这种自相矛盾 —— 而后端只有一种行为。
 * 判据（可证伪）：**改本文件一处文案，五个挂载点的断言必须同时红**，
 * 由 `test/befe-delete-wire.seam.test.tsx` 的「同一份实现」用例咬住。
 *
 * ── 确认文案的事实依据（**实测后端读出来的，不是猜的**）───────────────────────
 * `assertRetireOrDelete(op, refs, confirm)` 的分支（`resources.ts`，函数顶注原文
 * 「退役：有引用必须 confirm；删除：有引用一律拒绝」）：
 *   · `refs.length === 0` ⇒ 直接放行；
 *   · `op === "delete"` 且有引用 ⇒ **无条件** `throw HttpError(409, "REFERENCED", …)`，
 *     **`confirm` 参数根本走不到**（那行 throw 在 confirm 判断之前）。
 * 四条资源路由传的都是 `assertRetireOrDelete("delete", refs, true)` —— 那个写死的 `true`
 * 只对 retire 有意义，对 delete 是**死参数**。
 * ⇒ 所以后端是「**有引用就拒绝**」，**不是级联删**。屏上必须这么说：
 *   ① 删除不可恢复；
 *   ② 被别人引用时**删不掉**（后端 409 挡回），要先解除引用或改用「退役」；
 *   ③ **它自己引用的下游资源不受影响** —— `computeReferences` 查的是「**谁引用它**」
 *     （入向），删除只摘掉这一个对象，被它引用的技能/MCP 配置**一个都不会被删**。
 *     ③ 是最容易写反的一条：把「删 Agent 会连带删它挂的技能」写上去就是**假警告**，
 *     会吓得人不敢用；反过来漏掉「会被拒」则是**假承诺**。两头都错，故逐条对着源码写。
 *
 * ── 场景入口是例外，单独一套文案 ─────────────────────────────────────────────
 * `DELETE /b/v1/scene-entries/:id` 的 handler **压根不调**上面那对函数（叶子对象，
 * `computeReferences` 收尾注释：「scene-entry：无被引用方（入口本身是叶子）→ 恒空数组」）
 * ⇒ 它**不会**被 409 挡回，点了就是真删。故 `referenceKind` 传 `null` 时切另一套措辞，
 * 不许让它显示一句「有引用会被拒」的假话。
 */

/** 删除确认弹窗的全部文案 —— 五个挂载点的**唯一**出处（改这里五处同时变）。 */
export const DELETE_COPY = {
  button: "删除",
  title: (label: string) => `删除${label}`,
  /** 不可恢复 —— 五种资源共用的第一句。 */
  irreversible: "删除后不可恢复，也没有回收站。",
  /** 有引用反查的四种资源：说清「会被拒」+「下游不受影响」。 */
  guarded:
    "若仍有对象引用它，服务端会拒绝删除并列出引用方；需先解除这些引用，或改用「退役」保留历史。它自身引用的下游资源（技能 / MCP 配置 / 流程等）不会被连带删除。",
  /** 叶子资源（场景入口）：没有引用方可言，点了即删。 */
  leaf: "场景入口是叶子对象，没有其他对象引用它，因此不会被引用检查挡回——确认即真删。删除后该视图将回落到系统默认的提问引导。",
  /** 引用清单的引导语（第二层，点开才出）。 */
  refsHint: "先看看谁在引用它：",
  confirmLabel: "确认删除",
  ok: (label: string) => `${label}已删除`,
} as const;

export interface DeleteResourceButtonProps {
  /** 资源在屏上的称呼（「Agent」「流程」…），进标题与成功提示。 */
  label: string;
  /** 被删对象的显示名，让用户确认删的是**哪一个**。 */
  name: string;
  /** 真正发请求的那一跳。 */
  onDelete: () => Promise<void>;
  /** 删成功后刷新列表 / 清空选中。 */
  onDeleted: () => void;
  /**
   * 引用反查的族。**传 `null` = 该资源在后端无引用检查**（目前只有场景入口），
   * 此时不渲染引用面板、并切到 `leaf` 文案。
   */
  referenceKind: ReferenceTargetKind | null;
  /** 引用反查用的 id（`referenceKind` 非 null 时必给）。 */
  referenceId?: string;
  /** testid 前缀，五个挂载点各不同。 */
  testidPrefix: string;
  disabled?: boolean;
}

export default function DeleteResourceButton({
  label,
  name,
  onDelete,
  onDeleted,
  referenceKind,
  referenceId,
  testidPrefix,
  disabled,
}: DeleteResourceButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const delMut = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      setOpen(false);
      toast(DELETE_COPY.ok(label), "success");
      onDeleted();
    },
    /**
     * 失败**不关弹窗**：409 REFERENCED 的 message 里列着**具体哪些对象在引用它**
     * （后端 `assertRetireOrDelete` 拼的 `${kind}:${name}(${via})`），那是照着去解除引用的信息。
     * 关掉弹窗只弹一条 3 秒就消失的 toast，等于把这份清单扔了。
     */
    onError: toastError,
  });

  const err = delMut.error as { code?: string; message?: string } | null;

  return (
    <>
      <button
        type="button"
        className="btn danger sm"
        disabled={disabled || delMut.isPending}
        onClick={() => setOpen(true)}
        data-testid={`${testidPrefix}-delete`}
      >
        {DELETE_COPY.button}
      </button>

      {open && (
        <ConfirmModal
          title={DELETE_COPY.title(label)}
          message={`${name}——${DELETE_COPY.irreversible}${referenceKind ? DELETE_COPY.guarded : DELETE_COPY.leaf}`}
          confirmLabel={DELETE_COPY.confirmLabel}
          onCancel={() => {
            delMut.reset();
            setOpen(false);
          }}
          onConfirm={() => delMut.mutate()}
        >
          {/* 引用清单：删之前就能当场看见「谁在引用它」，而不是点了被 409 才知道。
              叶子资源（场景入口）没有这一块 —— 渲染一个恒为 0 的面板等于制造一句废话。 */}
          {referenceKind && referenceId && (
            <div style={{ marginTop: 10 }} data-testid={`${testidPrefix}-delete-refs`}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{DELETE_COPY.refsHint}</div>
              <ReferencesPanel kind={referenceKind} id={referenceId} />
            </div>
          )}

          {/* 被 409 挡回时，把后端原文（含引用方清单）常驻显示在弹窗里，不随 toast 消失。 */}
          {err && (
            <div
              className="panel"
              style={{ borderColor: "var(--danger)", marginTop: 10, padding: 8 }}
              data-testid={`${testidPrefix}-delete-error`}
            >
              <span className="badge red">{err.code ?? "DELETE_FAILED"}</span>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>{err.message}</p>
            </div>
          )}
        </ConfirmModal>
      )}
    </>
  );
}
