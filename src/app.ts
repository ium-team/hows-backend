import Fastify, { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { getAuth, initFirebaseAdmin } from "./firebase/admin";
import { registerRoutes } from "./routes";
import { AppError, unauthorizedError } from "./utils/errors";

const getTokenFromAuthHeader = (authorization?: string): string | null => {
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
};

export const buildApp = (): FastifyInstance => {
  initFirebaseAdmin();

  const app = Fastify({ logger: true });
  void app.register(cors, {
    origin: process.env.CORS_ORIGIN?.trim() || true,
  });

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const token = getTokenFromAuthHeader(request.headers.authorization);
      if (!token) {
        throw unauthorizedError();
      }

      try {
        const decoded = await getAuth().verifyIdToken(token);
        request.userId = decoded.uid;
      } catch {
        throw unauthorizedError();
      }
    },
  );

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: error.code });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({ error: "INVALID_REQUEST" });
      return;
    }

    request.log?.error?.({ err: error }, "Unhandled error");
    reply.status(500).send({ error: "INVALID_REQUEST" });
  });

  void app.register(registerRoutes);
  return app;
};
