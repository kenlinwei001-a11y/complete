/** 聚合导出（index.ts 依赖面收敛） */
import { SOLVERS } from "./solvers.js";
import type { AuthCtx } from "@platform/contracts";
export { submitQuery, hub, qosInfo } from "./qos.js";

export async function SOLVERS_PROXY(key: string, ctx: AuthCtx, token: string, args: any) {
  const fn = SOLVERS[key];
  if (!fn) throw Object.assign(new Error(`求解器 ${key} 不存在`), { code: "SOLVER_NOT_FOUND" });
  return fn(ctx, token, args);
}
