import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../firebase/admin";

export const createMatch = async (clubId: string, challengerId: string, opponentId: string) => {
  const db = getDb();
  const matchesRef = db.collection("clubs").doc(clubId).collection("matches");

  await matchesRef.add({
    challengerId,
    opponentId,
    createdBy: challengerId,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const resolveMatch = async (clubId: string, matchId: string, winnerId: string, resolvedBy: string) => {
  const db = getDb();
  const matchRef = db.collection("clubs").doc(clubId).collection("matches").doc(matchId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) {
      throw new Error("MATCH_NOT_FOUND");
    }

    const data = snap.data() as {
      challengerId?: unknown;
      opponentId?: unknown;
      status?: unknown;
    };

    const challengerId = typeof data.challengerId === "string" ? data.challengerId : "";
    const opponentId = typeof data.opponentId === "string" ? data.opponentId : "";
    const status = typeof data.status === "string" ? data.status : "";

    if (!challengerId || !opponentId) {
      throw new Error("INVALID_MATCH");
    }

    if (winnerId !== challengerId && winnerId !== opponentId) {
      throw new Error("WINNER_NOT_IN_MATCH");
    }

    if (status === "resolved") {
      return;
    }

    tx.update(matchRef, {
      status: "resolved",
      winnerId,
      resolvedBy,
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};
