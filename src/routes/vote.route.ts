import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../firebase/admin";
import { createMatch, resolveMatch } from "../services/vote.service";
import { ensureMember, ensureOwner } from "../utils/firestore";

const createMatchSchema = z
  .object({
    clubId: z.string().min(1),
    opponentId: z.string().min(1),
  });

const resolveMatchSchema = z.object({
  clubId: z.string().min(1),
  matchId: z.string().min(1),
  winnerId: z.string().min(1),
});

export const registerVoteRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/create", async (request) => {
    const body = createMatchSchema.parse(request.body);
    if (body.opponentId === request.userId) {
      throw new Error("CANNOT_CHALLENGE_SELF");
    }
    await ensureMember(getDb(), body.clubId, request.userId!);
    await ensureMember(getDb(), body.clubId, body.opponentId);

    await createMatch(body.clubId, request.userId!, body.opponentId);
    return { success: true };
  });

  fastify.post("/resolve", async (request) => {
    const body = resolveMatchSchema.parse(request.body);
    await ensureOwner(getDb(), body.clubId, request.userId!);

    await resolveMatch(body.clubId, body.matchId, body.winnerId, request.userId!);
    return { success: true };
  });
};
