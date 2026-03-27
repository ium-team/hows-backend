"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitVote = void 0;
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("../firebase/admin");
const buildPairKey = (a, b) => {
    const [low, high] = [a, b].sort();
    return { key: `${low}__${high}`, low, high };
};
const submitVote = async (clubId, voterId, A, B, selected) => {
    const db = (0, admin_1.getDb)();
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
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const pairDoc = pairwiseRef.doc(pair.key);
        const pairSnap = await tx.get(pairDoc);
        const row = pairSnap.data() ?? { lowWins: 0, highWins: 0, total: 0 };
        const winnerIsLow = winner === pair.low;
        tx.set(pairDoc, {
            userLow: pair.low,
            userHigh: pair.high,
            lowWins: (row.lowWins ?? 0) + (winnerIsLow ? 1 : 0),
            highWins: (row.highWins ?? 0) + (winnerIsLow ? 0 : 1),
            total: (row.total ?? 0) + 1,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
};
exports.submitVote = submitVote;
