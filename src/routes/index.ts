import { FastifyInstance } from "fastify";
import { registerTierRoutes } from "./tier.route";
import { registerVoteRoutes } from "./vote.route";
import { registerTeamRoutes } from "./team.route";

export const registerRoutes = async (fastify: FastifyInstance) => {
  fastify.get("/health", async () => ({ ok: true }));

  await fastify.register(
    async (api) => {
      api.addHook("onRequest", api.authenticate);
      await api.register(registerTierRoutes, { prefix: "/tier" });
      await api.register(registerVoteRoutes, { prefix: "/vote" });
      await api.register(registerTeamRoutes, { prefix: "/team" });
    },
    { prefix: "/api" },
  );
};
