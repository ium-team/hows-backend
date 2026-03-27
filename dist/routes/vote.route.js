"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVoteRoutes = void 0;
const zod_1 = require("zod");
const admin_1 = require("../firebase/admin");
const vote_service_1 = require("../services/vote.service");
const firestore_1 = require("../utils/firestore");
const voteSchema = zod_1.z
    .object({
    clubId: zod_1.z.string().min(1),
    A: zod_1.z.string().min(1),
    B: zod_1.z.string().min(1),
    selected: zod_1.z.enum(["A", "B"]),
})
    .refine((body) => body.A !== body.B, {
    message: "A and B must be different users",
    path: ["B"],
});
const registerVoteRoutes = async (fastify) => {
    fastify.post("/submit", async (request) => {
        const body = voteSchema.parse(request.body);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, request.userId);
        await (0, vote_service_1.submitVote)(body.clubId, request.userId, body.A, body.B, body.selected);
        return { success: true };
    });
};
exports.registerVoteRoutes = registerVoteRoutes;
