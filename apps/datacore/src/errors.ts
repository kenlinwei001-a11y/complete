/** Application error carrying an HTTP status + machine code; rendered into the unified envelope. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`, 404);
export const validationError = (msg: string) => new AppError("VALIDATION_ERROR", msg, 400);
export const unauthorized = (msg = "authentication required") =>
  new AppError("UNAUTHORIZED", msg, 401);
export const forbidden = (msg = "forbidden") => new AppError("FORBIDDEN", msg, 403);
export const invalidState = (msg: string) => new AppError("INVALID_STATE", msg, 409);
/**
 * A6 列级安全兜底（WO-69 P1·「宁可少答，不许错答」）：调用者存在列级约束时**拒绝求解器**，
 * 而非带着被剔除的属性算出一个**看不出问题的错数**（受限 margin 0.868 vs 真值 0.2565）。
 * 粗粒度保守（可能误伤本可安全计算的场景）——待 P2 Function 本体签名按「该 solver 真读哪些 type.prop」收窄。
 */
export const solverColumnRestricted = (solverKey: string, typeKeys: string[]) =>
  new AppError(
    "SOLVER_COLUMN_RESTRICTED",
    `求解器「${solverKey}」对当前角色不可用：调用者在 [${typeKeys.join(", ")}] 上存在列级（属性级）限制，` +
      `带缺失属性计算会产出静默错数，故拒绝而非降级出数（宁可少答，不许错答）。`,
    403,
  );

/** A6 列级（属性级）安全：写入不可写属性 —— 显式拒绝，绝不静默丢弃字段后返回成功。 */
export const propertyForbidden = (props: string[], detail = "") =>
  new AppError(
    "PROPERTY_FORBIDDEN",
    `属性级权限不足：不可写属性 [${props.join(", ")}]${detail ? `（${detail}）` : ""}`,
    403,
  );
