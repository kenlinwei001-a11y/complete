import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import zh from "@/locales/zh";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** 弹窗：focus trap + Esc 关闭（可访问性底线 PRD §10） */
export function Modal({
  title,
  onClose,
  children,
  width = 560,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);

  // WO-PALETTE-USABLE：onClose 的**最新身份**放进 ref，让 focus-trap effect 能挂空依赖。
  // 病因：本 effect 原来依赖 [onClose]，而 22 个调用点里 37 处（26 个文件）传的是**内联箭头**
  // （`onClose={() => setOpen(false)}`）⇒ 父组件每渲染一次 onClose 就换个身份 ⇒ effect 清理+重跑
  // ⇒ 重跑时把焦点抢回「dialog 里文档序第一个可聚焦元素」。而 `.head` 的 ✕ 排在 `.body` 前面，
  // 于是**每敲一键焦点就跳到 ✕**，⌘K 面板变成「点一次只能输入一个字符」（实测 `4680` 只留下 `4`）。
  // 实测日期 2026-09-07（修前树 81adb092）。复验：
  //   `PHASE=before node apps/frontend-shell/test/e2e/verify-palette-usable.mjs`
  // 原始读数存 apps/frontend-shell/test/e2e/palette-before.json 的 `typing[]`
  // （四组输入全部只留首字符，`focusBefore:"INPUT"` → `focusAfter:"BUTTON"`）；
  // 金丝雀同文件 `canary`：登录用户名框用同一 `type()+inputValue()` 留住了 `4680` 全 4 字符
  // ⇒ 上面报的「留不住」是功能坏了，不是量法坏了。
  // 修法选「稳定 onClose 身份」而不是「让首焦跳过 .head」：后者会改掉全部 22 个 Modal 的首焦落点，
  // 本单的反向对照正是要保住它们不被改坏。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = ref.current;
    if (!el) return;
    // 焦点已经在弹窗内（例如 children 自带 autoFocus，如 ⌘K 面板的搜索框）⇒ 无需再移，
    // 移了反而是抢。本 effect 的职责是「把焦点**移进**弹窗」，不是「钉死在第一个元素上」。
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      const firstNode = nodes[0]!;
      const lastNode = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
    // WO-PALETTE-USABLE：空依赖是**本修复的核心**——focus-trap 只该在挂载/卸载各跑一次。
    // onClose 经 onCloseRef 取最新值，故不必进依赖数组。
    // ⚠ 把它改回 [onClose] 会同时坏两件事（测试 §5 咬的是第二件，因为第一件会被 contains 守卫遮住）：
    //   ① 每渲染一次就重跑首焦选择 ⇒ 「点一次只能输入一个字符」；
    //   ② cleanup 每渲染一次就 prevFocus.current.focus() 把焦点弹回弹窗外的触发元素，
    //      且随后 prevFocus.current 被**改写成弹窗内的元素** ⇒ 关闭时焦点再也回不到触发者（无障碍回归）。
  }, []);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        ref={ref}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h3>{title}</h3>
          <button className={styles.close} onClick={onClose} aria-label={zh.common.close}>
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** 二次确认弹窗 */
export function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = zh.common.confirm,
  children,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  children?: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{message}</p>
      {children}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onCancel}>
          {zh.common.cancel}
        </button>
        <button className="btn primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
