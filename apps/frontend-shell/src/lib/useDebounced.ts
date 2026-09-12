import { useEffect, useState } from "react";

/**
 * 输入防抖（**判据 U1 的配套，不是可选优化**）。
 *
 * ── 为什么它不是提交闸（这一条是判据 U1 的分水岭，别读错）─────────────────────
 * 撤掉提交闸后，输入框每敲一个键都会变成一次求解入参：打 `1200` 会连发
 * `1` `12` `120` `1200` 四次，中间三次都是**没意义的假设**。
 * 防抖只推迟**发请求**，不推迟输入回显 —— 屏上的值一直是用户刚敲的那个。
 * 提交闸的定义是「**不点某个东西，结果永远不更新**」；防抖是「晚 300ms 更新」。
 * 两者结构上不同：防抖之后，「结果永远不更新」这个态**不存在了**。
 *
 * ── 为什么提到 `lib/`（原先是 `WhatIfView.tsx` 的文件内私有函数）─────────────
 * `optimize-whatif` 撤闸时要的是**同一个**行为。各抄一份的下场是两页防抖窗口迟早漂
 * （一个 300ms 一个 500ms），而"为什么这页手感不一样"没有任何东西会报错。
 * 搬迁**逐字节保行为**：实现与 `WhatIfView` 原私有版一致，仅换了位置。
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** 判据 U1 的防抖窗口（两页共用一个数——分开写迟早漂）。 */
export const RERUN_DEBOUNCE_MS = 300;
