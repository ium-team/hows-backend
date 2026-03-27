import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../firebase/admin";
import { submitVote } from "../services/vote.service";
import { ensureMember } from "../utils/firestore";

const voteSchema = z
  .object({
    clubId: z.string().min(1),
    A: z.string().min(1),
    B: z.string().min(1),
    selected: z.enum(["A", "B"]),
  })
  .refine((body) => body.A !== body.B, {
    message: "A and B must be different users",
    path: ["B"],
  });

export const registerVoteRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/submit", async (request) => {
    const body = voteSchema.parse(request.body);
    await ensureMember(getDb(), body.clubId, request.userId!);

    await submitVote(body.clubId, request.userId!, body.A, body.B, body.selected);
    return { success: true };
  });
};
