import { Modal } from "./ui/Modal";

/**
 * D5 · 二次调参确认弹窗（求解在途 + **离散型**调参才弹）。
 *
 * 为什么只对离散型：滑杆每动一下弹一次框不可用——连续控件保留既有 debounce + 取消前序
 * （D1 并线后服务端会真的中止底层求解，取消本就免费）。开关 / 下拉 / 批次增删 /「应用」
 * 这类一次一决策的调参才值得打断用户问一句。
 *
 * 两个出口都不丢用户输入（红线）：
 *  - 确认 → 取消上一次推演（底层求解真停）+ 以新参数重算；
 *  - 否（含 Esc / 点遮罩 / ✕）→ **保留改动**、不发起新求解、不取消前序，
 *    结果区标「参数已改 · 当前结果对应旧参数」并置灰，待用户点「重算」。
 */
export function RecomputeConfirmDialog({
  elapsedMs,
  onConfirm,
  onKeep,
  what = "本次推演",
}: {
  /** 前序求解已耗时（ms）——让用户知道自己要放弃的是一次跑了多久的求解。 */
  elapsedMs: number;
  onConfirm: () => void;
  onKeep: () => void;
  /** 被取消对象的称呼（默认「本次推演」）。 */
  what?: string;
}) {
  const sec = Math.floor(Math.max(0, elapsedMs) / 1000);
  return (
    <Modal title="求解在途 · 二次调参确认" onClose={onKeep} width={460}>
      <div data-testid="recompute-confirm" data-elapsed-sec={sec}>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, margin: 0 }} data-testid="recompute-confirm-msg">
          上一次{what}<b style={{ color: "var(--txt)" }}>仍在求解中</b>
          （已耗时 <b className="mono" data-testid="recompute-confirm-elapsed">{sec}</b> 秒）。你刚改了参数——要用新参数重算吗？
        </p>
        <ul style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.7, margin: "10px 0 0", paddingLeft: 18 }}>
          <li><b style={{ color: "var(--txt)" }}>确认重算</b>：取消上一次推演（服务端会真的中止底层求解），立即以新参数重新求解。</li>
          <li><b style={{ color: "var(--txt)" }}>暂不重算</b>：保留你刚才的改动但不发起新求解；当前结果仍对应旧参数（会标灰提示），随时可点「重算」。</li>
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" data-testid="recompute-confirm-keep" onClick={onKeep}>
            暂不重算 · 保留改动
          </button>
          <button className="btn primary" data-testid="recompute-confirm-ok" onClick={onConfirm}>
            确认 · 取消上次并重算
          </button>
        </div>
      </div>
    </Modal>
  );
}
