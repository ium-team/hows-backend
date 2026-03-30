"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = void 0;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const zod_1 = require("zod");
const admin_1 = require("./firebase/admin");
const routes_1 = require("./routes");
const errors_1 = require("./utils/errors");
const getTokenFromAuthHeader = (authorization) => {
    if (!authorization) {
        return null;
    }
    const [scheme, token] = authorization.split(" ");
    if (scheme !== "Bearer" || !token) {
        return null;
    }
    return token;
};
const buildApp = () => {
    (0, admin_1.initFirebaseAdmin)();
    const app = (0, fastify_1.default)({ logger: true });
    void app.register(cors_1.default, {
        origin: process.env.CORS_ORIGIN?.trim() || true,
    });
    app.decorate("authenticate", async (request, _reply) => {
        const token = getTokenFromAuthHeader(request.headers.authorization);
        if (!token) {
            throw (0, errors_1.unauthorizedError)();
        }
        try {
            const decoded = await (0, admin_1.getAuth)().verifyIdToken(token);
            request.userId = decoded.uid;
        }
        catch {
            throw (0, errors_1.unauthorizedError)();
        }
    });
    app.setErrorHandler((error, request, reply) => {
        if (error instanceof errors_1.AppError) {
            reply.status(error.statusCode).send({ error: error.code });
            return;
        }
        if (error instanceof zod_1.ZodError) {
            reply.status(400).send({ error: "INVALID_REQUEST" });
            return;
        }
        request.log?.error?.({ err: error }, "Unhandled error");
        reply.status(500).send({ error: "INVALID_REQUEST" });
    });
    void app.register(routes_1.registerRoutes);
    return app;
};
exports.buildApp = buildApp;
