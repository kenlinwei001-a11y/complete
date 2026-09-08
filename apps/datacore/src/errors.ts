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
 * A6 列级安全守卫（WO-69 P1 兜底 → P2 按 Function 本体签名收窄·「宁可少答，不许错答」）：
 * 求解器**声明的读取面**与调用者的权限相交（被禁的列 / 整型不可读）时**拒绝**，
 * 而非带着被剔除的属性算出一个**看不出问题的错数**（受限 margin 0.868 vs 真值 0.2565）。
 * `typeKeys` = 真正踩线的对象类型（P2 后不再是"调用者所有受限类型"，而是**该求解器读到的那几个**）。
 */
export const solverColumnRestricted = (solverKey: string, typeKeys: string[]) =>
  new AppError(
    "SOLVER_COLUMN_RESTRICTED",
    `求解器「${solverKey}」对当前角色不可用：其声明的读取面命中当前角色读不到的对象类型/属性 [${typeKeys.join(", ")}]，` +
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
