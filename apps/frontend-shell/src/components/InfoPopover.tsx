import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import zh from "@/locales/zh";
import styles from "./InfoPopover.module.css";

/**
 * **全局通用的 `?` 说明浮层** —— `docs/CONVENTION-ui-information-layering.md` §2 R-UI-3
 * 规定的那一套浮层规格的**唯一实现**（「别每页各做一套」）。
 *
 * ── 它承载的是哪一层 ──────────────────────────────────────────────────────────
 * 规范 §1 把决策页分三层：**第一层放结论（数值 / 状态 / 名字）· 第二层放明细 ·
 * 浮层放「凭什么」**（口径 · 公式 · 为什么这么算 · 诚实位说明 · 数据来源）。
 * 本组件就是那个「浮层」。凡形如 `A × B ÷ C`、「口径差」「联动口径」
 * 「按 X 显示不按 Y 措辞」的文字，一律进这里。
 *
 * ── 诚实位降层的红线（规范 §1）────────────────────────────────────────────────
 * 诚实位**允许**降到浮层，**绝不允许删除**；且降层后第一层必须留一个可见的记号，
 * 「静默降层等于删除」。本组件的 `?` 触发器本身就是那个记号 ——
 * 所以它**永远可见**（不做 hover 才显形的花活），且是真 `<button>`（Tab 到得了）。
 *
 * ── 为什么不能用原生 `title` / SVG `<title>`（规范 §2 明令禁止）──────────────
 * 那是浏览器原生 tooltip：由操作系统绘制、不受组件控制、**永远画在最上层**、移开后会滞留。
 * 2026-08-10 实测事故：`ChainLineMapView.tsx` 的两个 SVG `<title>` 在环形图上滞留并遮挡图形本身。
 * 本组件是受控 DOM 节点：`mouseleave` / `blur` / `Esc` 三条路都当场**卸载**它
 * （`open === false` ⇒ **不渲染**，不是 `hidden` —— 藏起来的东西照样进 DOM、照样被读屏念）。
 *
 * ── 规格（逐条对着规范 §2 写的）──────────────────────────────────────────────
 *  · 触发：`?` icon，**悬停显示 · 移开立即消失**；
 *  · 键盘可达：`focus` 显示 / `blur` 消失 / `Esc` 关闭；
 *  · `max-width` 380px，超长内部滚动（见 `InfoPopover.module.css`）；
 *  · 文案走 `locales/`（触发器与 aria 文案在 `zh.sim.sandbox.info`），不内联。
 *
 * ── 可达性 ────────────────────────────────────────────────────────────────────
 * `aria-expanded` 报开合态，`aria-describedby` 把浮层正文挂到触发器上，浮层 `role="tooltip"`。
 * **鼠标不是唯一入口。**
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
        /*
         * ⚠ 这里**必须是幂等的 `setOpen(true)`，不能是 `setOpen(v => !v)`**。
         * 实测（本单第一版就踩了）：点击会先触发 `focus`（已把 open 置 true），
         * 紧接着的 `click` 若做取反就把它又关回去 ⇒ **点一下等于没开**，
         * 而 hover 路径是好的，于是"鼠标能看见、点却打不开"，极难看出来。
         * 触摸设备靠"点别处 → blur"关闭；键盘靠 Esc。
         */
        onClick={() => setOpen(true)}
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
