export type AppErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "CLUB_NOT_FOUND"
  | "NOT_MEMBER"
  | "NOT_OWNER";

export class AppError extends Error {
  code: AppErrorCode;
  statusCode: number;

  constructor(code: AppErrorCode, statusCode: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const unauthorizedError = () => new AppError("UNAUTHORIZED", 401);
export const invalidRequestError = (message?: string) =>
  new AppError("INVALID_REQUEST", 400, message);
export const clubNotFoundError = () => new AppError("CLUB_NOT_FOUND", 404);
export const notMemberError = () => new AppError("NOT_MEMBER", 403);
export const notOwnerError = () => new AppError("NOT_OWNER", 403);
