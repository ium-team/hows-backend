"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = void 0;
const tier_route_1 = require("./tier.route");
const vote_route_1 = require("./vote.route");
const team_route_1 = require("./team.route");
const registerRoutes = async (fastify) => {
    fastify.get("/health", async () => ({ ok: true }));
    await fastify.register(async (api) => {
        api.addHook("onRequest", api.authenticate);
        await api.register(tier_route_1.registerTierRoutes, { prefix: "/tier" });
        await api.register(vote_route_1.registerVoteRoutes, { prefix: "/vote" });
        await api.register(team_route_1.registerTeamRoutes, { prefix: "/team" });
    }, { prefix: "/api" });
};
exports.registerRoutes = registerRoutes;
