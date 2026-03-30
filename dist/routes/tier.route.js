"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTierRoutes = void 0;
const zod_1 = require("zod");
const firestore_1 = require("../utils/firestore");
const admin_1 = require("../firebase/admin");
const tier_service_1 = require("../services/tier.service");
const computeSchema = zod_1.z.object({
    clubId: zod_1.z.string().min(1),
    tierType: zod_1.z.enum(["overall", "dribble", "shoot"]),
});
const explainSchema = zod_1.z.object({
    clubId: zod_1.z.string().min(1),
    userId: zod_1.z.string().min(1),
    tierType: zod_1.z.enum(["overall", "dribble", "shoot"]).default("overall"),
});
const boardSchema = zod_1.z.object({
    clubId: zod_1.z.string().min(1),
    topicId: zod_1.z.string().min(1).default("default"),
});
const registerTierRoutes = async (fastify) => {
    fastify.post("/compute", async (request) => {
        const body = computeSchema.parse(request.body);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, request.userId);
        const computed = await (0, tier_service_1.computeTier)(body.clubId, body.tierType);
        return { tiers: computed.tiers };
    });
    fastify.get("/explain", async (request) => {
        const query = explainSchema.parse(request.query);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), query.clubId, request.userId);
        return (0, tier_service_1.getTierExplain)(query.clubId, query.userId, query.tierType);
    });
    fastify.post("/board", async (request) => {
        const body = boardSchema.parse(request.body);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, request.userId);
        return (0, tier_service_1.computeTierBoard)(body.clubId, body.topicId);
    });
};
exports.registerTierRoutes = registerTierRoutes;
