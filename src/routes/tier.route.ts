import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ensureMember, ensureOwner } from "../utils/firestore";
import { getDb } from "../firebase/admin";
import {
  computeTier,
  computeTierBoard,
  getTierExplain,
  resetClubTierData,
  recomputeClubTierSnapshots,
  TierType,
} from "../services/tier.service";

const computeSchema = z.object({
  clubId: z.string().min(1),
  tierType: z.enum(["overall", "dribble", "shoot"]),
});

const explainSchema = z.object({
  clubId: z.string().min(1),
  userId: z.string().min(1),
  tierType: z.enum(["overall", "dribble", "shoot"]).default("overall"),
});

const boardSchema = z.object({
  clubId: z.string().min(1),
  topicId: z.string().min(1).default("default"),
});

const recomputeSchema = z.object({
  clubId: z.string().min(1),
  topicId: z.string().min(1).optional(),
});

const resetSchema = z.object({
  clubId: z.string().min(1),
  includeMatches: z.boolean().optional(),
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

  fastify.post("/board", async (request) => {
    const body = boardSchema.parse(request.body);
    await ensureMember(getDb(), body.clubId, request.userId!);

    return computeTierBoard(body.clubId, body.topicId);
  });

  fastify.post("/recompute", async (request) => {
    const body = recomputeSchema.parse(request.body);
    await ensureOwner(getDb(), body.clubId, request.userId!);
    return recomputeClubTierSnapshots(body.clubId, body.topicId);
  });

  fastify.post("/reset", async (request) => {
    const body = resetSchema.parse(request.body);
    await ensureOwner(getDb(), body.clubId, request.userId!);
    return resetClubTierData(body.clubId, { includeMatches: body.includeMatches });
  });
};
