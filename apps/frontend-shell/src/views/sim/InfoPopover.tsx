import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import zh from "@/locales/zh";
import styles from "./InfoPopover.module.css";

/**
 * WO-SANDBOX-DECLUTTER · **原理说明性文字的正确承载方式**。
 *
 * ── 这个组件解决的问题 ──────────────────────────────────────────────────────────
 * 推演沙盘主屏上有大量「解释某个数字/某个词是什么意思」的常驻段落
 * （口径差 / 联动口径 / 范围能带到哪 / 阻滞点图例 / 某一维为何无 ARGS…）。
 * 它们**是诚实位、必须留着**，但它们的读者是开发者与调试者，而这一屏的主角是决策者 ——
 * 常驻展开的结果就是决策者看不到重点（仓主原话：「信息太多了，无法让决策者看到重点」）。
 *
 * 正解不是删，也不是一股脑塞进抽屉：**解释某个数值的文字应当贴在那个数值旁边**，
 * 平时收成一个 `?`，鼠标放上去（或键盘聚焦）才展开，移开即消失。
 * 抽屉留给**成块的诊断面板**（就绪认证、世界列表）——那些不是"解释某个数"，是独立的一屏内容。
 *
 * ── 为什么不用原生 `title` 属性 ────────────────────────────────────────────────
 * 因为原生 tooltip 正是本单要修的那个 bug（见 `ChainLineMapView` 里被删掉的两个 SVG `<title>`）：
 * 它由操作系统绘制、**不受 React 控制、恒画在最上层**（能盖住画布本身），
 * 移开后滞留是它的常见行为，且样式不跟主题。本组件是受控 DOM 节点：
 * `mouseleave` / `blur` / `Esc` 三条路都当场卸载它（`open=false` ⇒ **不渲染**，不是 `hidden`）。
 *
 * ── 可达性 ────────────────────────────────────────────────────────────────────
 * 触发器是真 `<button>`（Tab 可达）：`focus` 展开 / `blur` 收起 / `Esc` 收起；
 * `aria-expanded` 报开合态，`aria-describedby` 把浮层正文挂到触发器上，
 * 浮层本身 `role="tooltip"`。**鼠标不是唯一入口**。
 */
export function InfoPopover({
  topic,
  children,
  testId,
  align = "left",
}: {
  /** 这条说明**解释的是什么**（进 aria-label 与浮层标题；来自 `locales/zh` 或单一来源数据）。 */
  topic: string;
  children: ReactNode;
  /** DOM 锚点：触发器 `info-{testId}`，正文 `info-body-{testId}`。 */
  testId: string;
  /** 贴屏幕右侧时改向左展开（纯几何，无业务语义）。 */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const bodyId = `info-body-${reactId}`;
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Esc 关闭：只在开着时挂监听（关着不留全局监听）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={styles.wrap}
      data-testid={`info-wrap-${testId}`}
      data-open={open ? "1" : "0"}
      // 鼠标移出**整个 wrap**（含浮层本体）才收 —— 否则鼠标从 `?` 移到浮层上时它会闪掉，
      // 而浮层里有 `<code>` 之类需要选中复制的内容。
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
    >
      <button
        type="button"
        className={styles.trigger}
        data-testid={`info-${testId}`}
        aria-label={zh.sim.sandbox.info.triggerAria(topic)}
        aria-expanded={open}
        aria-describedby={open ? bodyId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => setOpen((v) => !v)}
      >
        {zh.sim.sandbox.info.trigger}
      </button>
      {open ? (
        <span
          id={bodyId}
          role="tooltip"
          className={styles.body}
          data-align={align}
          data-testid={`info-body-${testId}`}
        >
          <b className={styles.title}>{topic}</b>
          {children}
        </span>
      ) : null}
    </span>
  );
}

export default InfoPopover;
