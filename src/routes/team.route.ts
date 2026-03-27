import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../firebase/admin";
import { generateTeams } from "../services/team.service";
import { TierType } from "../services/tier.service";
import { ensureMember } from "../utils/firestore";

const teamSchema = z.object({
  clubId: z.string().min(1),
  teamCount: z.number().int().min(1).max(20),
  tierType: z.enum(["overall", "dribble", "shoot"]).default("overall"),
});

export const registerTeamRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/generate", async (request) => {
    const body = teamSchema.parse(request.body);
    await ensureMember(getDb(), body.clubId, request.userId!);

    return generateTeams(body.clubId, body.teamCount, body.tierType as TierType);
  });
};
