"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVoteRoutes = void 0;
const zod_1 = require("zod");
const admin_1 = require("../firebase/admin");
const vote_service_1 = require("../services/vote.service");
const firestore_1 = require("../utils/firestore");
const createMatchSchema = zod_1.z
    .object({
    clubId: zod_1.z.string().min(1),
    opponentId: zod_1.z.string().min(1),
});
const resolveMatchSchema = zod_1.z.object({
    clubId: zod_1.z.string().min(1),
    matchId: zod_1.z.string().min(1),
    winnerId: zod_1.z.string().min(1),
});
const registerVoteRoutes = async (fastify) => {
    fastify.post("/create", async (request) => {
        const body = createMatchSchema.parse(request.body);
        if (body.opponentId === request.userId) {
            throw new Error("CANNOT_CHALLENGE_SELF");
        }
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, request.userId);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, body.opponentId);
        await (0, vote_service_1.createMatch)(body.clubId, request.userId, body.opponentId);
        return { success: true };
    });
    fastify.post("/resolve", async (request) => {
        const body = resolveMatchSchema.parse(request.body);
        await (0, firestore_1.ensureOwner)((0, admin_1.getDb)(), body.clubId, request.userId);
        await (0, vote_service_1.resolveMatch)(body.clubId, body.matchId, body.winnerId, request.userId);
        return { success: true };
    });
};
exports.registerVoteRoutes = registerVoteRoutes;
