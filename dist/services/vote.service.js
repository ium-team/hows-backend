"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMatch = exports.createMatch = void 0;
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("../firebase/admin");
const createMatch = async (clubId, challengerId, opponentId) => {
    const db = (0, admin_1.getDb)();
    const matchesRef = db.collection("clubs").doc(clubId).collection("matches");
    await matchesRef.add({
        challengerId,
        opponentId,
        createdBy: challengerId,
        status: "pending",
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
};
exports.createMatch = createMatch;
const resolveMatch = async (clubId, matchId, winnerId, resolvedBy) => {
    const db = (0, admin_1.getDb)();
    const matchRef = db.collection("clubs").doc(clubId).collection("matches").doc(matchId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) {
            throw new Error("MATCH_NOT_FOUND");
        }
        const data = snap.data();
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
            resolvedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
};
exports.resolveMatch = resolveMatch;
