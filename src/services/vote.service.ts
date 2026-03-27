import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../firebase/admin";

const buildPairKey = (a: string, b: string) => {
  const [low, high] = [a, b].sort();
  return { key: `${low}__${high}`, low, high };
};

export const submitVote = async (clubId: string, voterId: string, A: string, B: string, selected: "A" | "B") => {
  const db = getDb();
  const votesRef = db.collection("clubs").doc(clubId).collection("votes");
  const pairwiseRef = db.collection("clubs").doc(clubId).collection("pairwise");

  const winner = selected === "A" ? A : B;
  const loser = selected === "A" ? B : A;
  const pair = buildPairKey(A, B);

  await db.runTransaction(async (tx) => {
    const voteDoc = votesRef.doc();
    tx.set(voteDoc, {
      voterId,
      A,
      B,
      selected,
      winner,
      loser,
      createdAt: FieldValue.serverTimestamp(),
    });

    const pairDoc = pairwiseRef.doc(pair.key);
    const pairSnap = await tx.get(pairDoc);
    const row = (pairSnap.data() as {
      lowWins?: number;
      highWins?: number;
      total?: number;
    }) ?? { lowWins: 0, highWins: 0, total: 0 };

    const winnerIsLow = winner === pair.low;
    tx.set(
      pairDoc,
      {
        userLow: pair.low,
        userHigh: pair.high,
        lowWins: (row.lowWins ?? 0) + (winnerIsLow ? 1 : 0),
        highWins: (row.highWins ?? 0) + (winnerIsLow ? 0 : 1),
        total: (row.total ?? 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
};
