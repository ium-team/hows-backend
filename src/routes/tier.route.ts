import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ensureMember } from "../utils/firestore";
import { getDb } from "../firebase/admin";
import { computeTier, getTierExplain, TierType } from "../services/tier.service";

const computeSchema = z.object({
  clubId: z.string().min(1),
  tierType: z.enum(["overall", "dribble", "shoot"]),
});

const explainSchema = z.object({
  clubId: z.string().min(1),
  userId: z.string().min(1),
  tierType: z.enum(["overall", "dribble", "shoot"]).default("overall"),
});

export const registerTierRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/compute", async (request) => {
    const body = computeSchema.parse(request.body);
    await ensureMember(getDb(), body.clubId, request.userId!);

    const computed = await computeTier(body.clubId, body.tierType as TierType);
    return { tiers: computed.tiers };
  });

  fastify.get("/explain", async (request) => {
    const query = explainSchema.parse(request.query);
    await ensureMember(getDb(), query.clubId, request.userId!);

    return getTierExplain(query.clubId, query.userId, query.tierType as TierType);
  });
};
