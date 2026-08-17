import { useActionDraft } from "./shared";

/**
 * WO-U6-ADOPT · 推演页「采纳结论」按钮族（判据 U6：结论即动作——真有 action-draft 调用，文案不算）。
 *
 * 两个入口、两条动作，分工不重叠：
 *  · `AdoptSimConclusionButton` —— actionTypeKey=「采纳推演结论」：把屏上这份结论
 *    （判别字段 + 推演快照）造成 Action 草稿走 S2 审批，审批通过由 domainExecutor 落
 *    `SimConclusionAdoption` 台账对象（payload 契约 = contracts SimConclusionAdoptionPayloadSchema，
 *    source 判别联合·量纲逐字段标注）。optimize-whatif / cleanroom-attr / disruption-radius 三页用。
 *  · `AdoptAssumptionButton` —— actionTypeKey=「对象数据变更」（既有 WIRED 分支）：what-if 页用。
 *    它的「采纳」语义不是登记结论，而是**把假设改成真实数据**（patch 合并进对象 props + runDerivations）。
 *
 * ⛔ 纪律（照 WO-SIM-ACTION-REAL 样板）：
 *  · payload 里的快照必须是**屏上正在显示的那份**（不是重算、不是上一次残留）——各页在结果区挂载，
 *    结果随输入失效即卸载，结构上不存在「采纳到旧结论」。
 *  · 快照数值量纲必须与契约字段名一致（G-LEVER-SNAPSHOT-UNIT-LIE 前科）。
 */

export function AdoptSimConclusionButton({
  testId,
  payload,
  hint,
}: {
  testId: string;
  /** 完整 payload（含 source 判别字段 + snapshot）——调用方按本页结论形态组装。 */
  payload: Record<string, unknown>;
  /** 按钮 title（说清审批后才落真值·R4）。 */
  hint: string;
}) {
  const adopt = useActionDraft();
  return (
    <button
      className="btn sm primary"
      data-testid={testId}
      disabled={adopt.isPending}
      title={hint}
      onClick={() => adopt.mutate({ actionTypeKey: "采纳推演结论", payload })}
    >
      {adopt.isPending ? "生成草稿中…" : "采纳结论（→ Action 审批）"}
    </button>
  );
}

export function AdoptAssumptionButton({
  testId,
  objectType,
  objectId,
  prop,
  value,
  assumptionLine,
}: {
  testId: string;
  objectType: string;
  objectId: string;
  prop: string;
  /** 假设值（已按属性 dataType 做过类型强制的那个值，与屏上结果同源）。 */
  value: unknown;
  /** 人读的一行假设描述（进 reason，审批人据此看懂在批什么）。 */
  assumptionLine: string;
}) {
  const adopt = useActionDraft();
  return (
    <button
      className="btn sm primary"
      data-testid={testId}
      disabled={adopt.isPending}
      title="采纳此假设 → 生成「对象数据变更」Action 草稿（走 S2 审批 · 审批通过才把该属性改成假设值真值 R4，不落库试算就此转正）"
      onClick={() =>
        adopt.mutate({
          actionTypeKey: "对象数据变更",
          payload: {
            objectType,
            objectId,
            patch: { [prop]: value },
            reason: `通用假设推演采纳：${assumptionLine}`,
          },
        })
      }
    >
      {adopt.isPending ? "生成草稿中…" : "采纳此假设为真实变更（→ Action 审批）"}
    </button>
  );
}
