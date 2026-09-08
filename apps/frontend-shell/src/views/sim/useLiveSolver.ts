import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runSolver } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";

export interface LiveSolverResult<T> {
  data: T | null;
  snapshotVersion: string | null;
  /** debounce 已触发、最新一次请求未返回 */
  isFetching: boolean;
  error: Error | null;
  /** D5 在途可见：本次在途已耗时（ms·秒级递增）；不在途 = 0。 */
  elapsedMs: number;
  /** D5 二次调参确认：求解在途 + **离散型**调参 → true（此时**未**取消前序、**未**发新请求，等用户决定）。 */
  needsConfirm: boolean;
  /** D5「否」/主动取消之后：参数已改但屏上结果对应**旧参数** → 结果区置灰 + 待用户点「重算」。 */
  isStale: boolean;
  /** 弹窗「确认」：取消上一次推演（D1 后服务端会真的中止底层求解）+ 以新参数立即重算。 */
  confirmRecompute: () => void;
  /** 弹窗「否」：**保留用户改动**但不发起新求解、**不取消**前序在途；结果区标「对应旧参数」。 */
  keepCurrent: () => void;
  /** 「重算」：以当前参数立即发起（清 stale 标记）。 */
  recompute: () => void;
  /** 主动取消在途推演（用户可直接放弃，不必靠改参数间接取消）。 */
  cancel: () => void;
}

/** 二次确认决策态（永远绑定它所针对的那一份 argsKey：参数再变即作废，重新判定）。 */
type Decision =
  | { kind: "none" }
  /** 弹窗待决：key = 用户刚改出的新参数 */
  | { kind: "confirm"; key: string }
  /** 用户已选「否」（或主动取消）：key = 屏上结果**不再对应**的那份新参数 */
  | { kind: "kept"; key: string };

/**
 * 改参即重算（增量 §0-3，四视图统一）：
 * - 输入变更 debounce 300ms 后调用同步求解端点 POST {B}/b/v1/solvers/{key}/run；
 * - 请求竞态最后发出者胜：新请求发出时 AbortController 取消前序，且序号守卫
 *   保证只有最新一次响应上屏（F20）。
 *
 * D1 已并线后「取消前序」不再只是前端丢弃响应——AbortSignal 一路传到 DataCore 与优化器
 * sidecar，底层求解**真的会停**。故本 hook 之上可以诚实地向用户承诺「取消上一次推演」。
 *
 * D5 · 在途可见 + 二次调参确认（本 hook 提供机制，UI 由消费方渲染）：
 *  - `elapsedMs`：在途已耗时（秒级递增）；`cancel()`：用户主动放弃本次推演；
 *  - `needsConfirm`：**求解在途**时发生**离散型**调参（`opts.confirmKeys` 列出的 arg 键 ——
 *    开关 / 下拉 / 批次增删 /「应用」按钮）→ 弹窗二次确认。**滑杆等连续控件不列入**，
 *    照旧 debounce + 取消前序（D1 之后取消是真的，本就免费，每动一下弹一次框不可用）；
 *  - `confirmRecompute()` = 取消前序 + 新参数重算；`keepCurrent()` = 保留改动、不发新请求、
 *    不取消前序，`isStale` 置真让结果区标「参数已改 · 当前结果对应旧参数」并置灰，
 *    待 `recompute()`。两条红线：绝不静默丢弃用户输入；绝不让结果与旁边显示的参数不一致。
 *
 * D4 · 在途去重：同 (solverKey, args) 已有在途请求 → 直接复用，不重复发起
 *   （防「反复微调回同一组参数」把最重的求解叠着打）。
 */
export function useLiveSolver<T>(
  solverKey: string,
  /** null → 暂停（如分批模式下批次为空） */
  args: Record<string, unknown> | null,
  parse: (raw: unknown) => T,
  opts?: {
    debounceMs?: number;
    /** D5：**离散型**控件所改的 arg 键。在途时这些键变更 → 弹窗二次确认；缺省 [] = 从不弹窗（其余视图零回归）。 */
    confirmKeys?: readonly string[];
  },
): LiveSolverResult<T> {
  const debounceMs = opts?.debounceMs ?? 300;
  const [state, setState] = useState<{ data: T | null; snapshotVersion: string | null; isFetching: boolean; error: Error | null }>({
    data: null,
    snapshotVersion: null,
    isFetching: false,
    error: null,
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [decision, setDecision] = useState<Decision>({ kind: "none" });
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** 当前**在途**请求的 argsKey（settle 即清空）——D4 去重与 D5 确认判定的唯一依据。 */
  const inFlightKeyRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const confirmKeysRef = useRef<readonly string[]>(opts?.confirmKeys ?? []);
  confirmKeysRef.current = opts?.confirmKeys ?? [];

  // 以序列化形态做依赖，对象字面量重建不触发重复请求
  const argsKey = useMemo(() => (args === null ? null : JSON.stringify(args)), [args]);
  const argsKeyRef = useRef<string | null>(argsKey);
  argsKeyRef.current = argsKey;

  const fire = useCallback(
    (key: string) => {
      const seq = ++seqRef.current;
      abortRef.current?.abort(); // 最后发出者胜：取消前序在途请求（D1 后底层求解真的会停）
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      inFlightKeyRef.current = key;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState((s) => ({ ...s, isFetching: true }));
      runSolver(solverKey, JSON.parse(key) as Record<string, unknown>, ctrl.signal)
        .then((res) => {
          if (seq !== seqRef.current) return; // 序号守卫：过期响应不上屏
          inFlightKeyRef.current = null;
          setState({ data: parseRef.current(res.data), snapshotVersion: res.snapshotVersion, isFetching: false, error: null });
        })
        .catch((err: unknown) => {
          if (seq !== seqRef.current) return;
          inFlightKeyRef.current = null;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState((s) => ({ ...s, isFetching: false, error: err as Error }));
          toastError(err);
        });
    },
    [solverKey],
  );

  /** 两份 args 之间，**离散型**键是否变了（滑杆等连续键的变化不算 → 不弹窗）。 */
  const changedDiscrete = useCallback((prevKey: string, nextKey: string): boolean => {
    const keys = confirmKeysRef.current;
    if (keys.length === 0) return false;
    const prev = JSON.parse(prevKey) as Record<string, unknown>;
    const next = JSON.parse(nextKey) as Record<string, unknown>;
    return keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  }, []);

  useEffect(() => {
    if (argsKey === null) return;
    // 决策只对它当时那份参数有效：参数又变了 → 作废，下一轮重新判定（含弹窗自动跟到最新参数）。
    if (decision.kind !== "none" && decision.key !== argsKey) {
      setDecision({ kind: "none" });
      return;
    }
    if (decision.kind !== "none") return; // 弹窗待决 / 用户已选「否」→ 不自动发起
    const inFlight = inFlightKeyRef.current;
    if (inFlight === argsKey) return; // D4 在途去重：同 (solverKey,args) 已在途 → 复用，不重复发起
    if (inFlight !== null && changedDiscrete(inFlight, argsKey)) {
      setDecision({ kind: "confirm", key: argsKey }); // D5：在途 + 离散调参 → 弹窗（不取消前序·不发新请求）
      return;
    }
    const timer = setTimeout(() => fire(argsKey), debounceMs);
    return () => clearTimeout(timer);
  }, [argsKey, decision, debounceMs, fire, changedDiscrete]);

  // D5 在途已耗时（秒级递增·只在在途时走表）
  useEffect(() => {
    if (!state.isFetching) {
      setElapsedMs(0);
      return;
    }
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [state.isFetching]);

  /** 以当前参数立即重算（弹窗「确认」/ 结果区「重算」同一动作：取消前序 + 新参数发起）。 */
  const recompute = useCallback(() => {
    const key = argsKeyRef.current;
    setDecision({ kind: "none" });
    if (key !== null) fire(key);
  }, [fire]);

  /** 弹窗「否」：保留改动、不发新请求、**不取消**前序；结果区标「对应旧参数」。 */
  const keepCurrent = useCallback(() => {
    const key = argsKeyRef.current;
    if (key !== null) setDecision({ kind: "kept", key });
  }, []);

  /** 主动取消在途推演（用户放弃）：中止请求 + 屏上结果就此对应旧参数 → 标 stale 待「重算」。 */
  const cancel = useCallback(() => {
    if (inFlightKeyRef.current === null) return;
    seqRef.current += 1; // 迟到响应作废
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightKeyRef.current = null;
    setState((s) => ({ ...s, isFetching: false }));
    setElapsedMs(0);
    const key = argsKeyRef.current;
    if (key !== null) setDecision({ kind: "kept", key });
  }, []);

  // 卸载时取消在途请求
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    ...state,
    elapsedMs,
    needsConfirm: decision.kind === "confirm",
    isStale: decision.kind === "kept",
    confirmRecompute: recompute,
    keepCurrent,
    recompute,
    cancel,
  };
}
