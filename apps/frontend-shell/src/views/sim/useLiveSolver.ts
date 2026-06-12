import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runSolver } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";

export interface LiveSolverResult<T> {
  data: T | null;
  snapshotVersion: string | null;
  /** debounce 已触发、最新一次请求未返回 */
  isFetching: boolean;
  error: Error | null;
}

/**
 * 改参即重算（增量 §0-3，四视图统一）：
 * - 输入变更 debounce 300ms 后调用同步求解端点 POST {B}/b/v1/solvers/{key}/run；
 * - 请求竞态最后发出者胜：新请求发出时 AbortController 取消前序，且序号守卫
 *   保证只有最新一次响应上屏（F20）。
 */
export function useLiveSolver<T>(
  solverKey: string,
  /** null → 暂停（如分批模式下批次为空） */
  args: Record<string, unknown> | null,
  parse: (raw: unknown) => T,
  opts?: { debounceMs?: number },
): LiveSolverResult<T> {
  const debounceMs = opts?.debounceMs ?? 300;
  const [state, setState] = useState<LiveSolverResult<T>>({
    data: null,
    snapshotVersion: null,
    isFetching: false,
    error: null,
  });
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;

  // 以序列化形态做依赖，对象字面量重建不触发重复请求
  const argsKey = useMemo(() => (args === null ? null : JSON.stringify(args)), [args]);

  const fire = useCallback(
    (key: string) => {
      const seq = ++seqRef.current;
      abortRef.current?.abort(); // 最后发出者胜：取消前序在途请求
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState((s) => ({ ...s, isFetching: true }));
      runSolver(solverKey, JSON.parse(key) as Record<string, unknown>, ctrl.signal)
        .then((res) => {
          if (seq !== seqRef.current) return; // 序号守卫：过期响应不上屏
          setState({ data: parseRef.current(res.data), snapshotVersion: res.snapshotVersion, isFetching: false, error: null });
        })
        .catch((err: unknown) => {
          if (seq !== seqRef.current) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState((s) => ({ ...s, isFetching: false, error: err as Error }));
          toastError(err);
        });
    },
    [solverKey],
  );

  useEffect(() => {
    if (argsKey === null) return;
    const timer = setTimeout(() => fire(argsKey), debounceMs);
    return () => clearTimeout(timer);
  }, [argsKey, debounceMs, fire]);

  // 卸载时取消在途请求
  useEffect(() => () => abortRef.current?.abort(), []);

  return state;
}
