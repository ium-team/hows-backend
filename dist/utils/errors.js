"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notMemberError = exports.clubNotFoundError = exports.invalidRequestError = exports.unauthorizedError = exports.AppError = void 0;
class AppError extends Error {
    code;
    statusCode;
    constructor(code, statusCode, message) {
        super(message ?? code);
        this.code = code;
        this.statusCode = statusCode;
    }
}
exports.AppError = AppError;
const unauthorizedError = () => new AppError("UNAUTHORIZED", 401);
exports.unauthorizedError = unauthorizedError;
const invalidRequestError = (message) => new AppError("INVALID_REQUEST", 400, message);
exports.invalidRequestError = invalidRequestError;
const clubNotFoundError = () => new AppError("CLUB_NOT_FOUND", 404);
exports.clubNotFoundError = clubNotFoundError;
const notMemberError = () => new AppError("NOT_MEMBER", 403);
exports.notMemberError = notMemberError;
