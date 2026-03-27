"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTeamRoutes = void 0;
const zod_1 = require("zod");
const admin_1 = require("../firebase/admin");
const team_service_1 = require("../services/team.service");
const firestore_1 = require("../utils/firestore");
const teamSchema = zod_1.z.object({
    clubId: zod_1.z.string().min(1),
    teamCount: zod_1.z.number().int().min(1).max(20),
    tierType: zod_1.z.enum(["overall", "dribble", "shoot"]).default("overall"),
});
const registerTeamRoutes = async (fastify) => {
    fastify.post("/generate", async (request) => {
        const body = teamSchema.parse(request.body);
        await (0, firestore_1.ensureMember)((0, admin_1.getDb)(), body.clubId, request.userId);
        return (0, team_service_1.generateTeams)(body.clubId, body.teamCount, body.tierType);
    });
};
exports.registerTeamRoutes = registerTeamRoutes;
