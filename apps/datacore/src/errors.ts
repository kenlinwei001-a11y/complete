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
/** A6 列级（属性级）安全：写入不可写属性 —— 显式拒绝，绝不静默丢弃字段后返回成功。 */
export const propertyForbidden = (props: string[], detail = "") =>
  new AppError(
    "PROPERTY_FORBIDDEN",
    `属性级权限不足：不可写属性 [${props.join(", ")}]${detail ? `（${detail}）` : ""}`,
    403,
  );
