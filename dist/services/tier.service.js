"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTierExplain = exports.computeTier = void 0;
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("../firebase/admin");
const firestore_2 = require("../utils/firestore");
const tier_1 = require("../utils/tier");
const CACHE_MS = Number(process.env.COMPUTED_TIER_CACHE_MS ?? 300000);
const LOCK_MS = Number(process.env.COMPUTED_TIER_LOCK_MS ?? 10000);
const parseTierListDoc = (payload) => {
    const rows = [];
    if (!payload || typeof payload !== "object") {
        return rows;
    }
    const data = payload;
    const parseTierRecord = (record) => {
        if (!record) {
            return;
        }
        for (const [tierKey, rawUsers] of Object.entries(record)) {
            const tierNumber = Number(tierKey);
            if (!Number.isFinite(tierNumber)) {
                continue;
            }
            if (!Array.isArray(rawUsers)) {
                continue;
            }
            for (const rawUser of rawUsers) {
                if (typeof rawUser !== "string" || !rawUser) {
                    continue;
                }
                rows.push({ userId: rawUser, tier: tierNumber });
            }
        }
    };
    parseTierRecord(data.tiers);
    parseTierRecord(data.tierMap);
    if (Array.isArray(data.rankings)) {
        for (const row of data.rankings) {
            const userId = typeof row.userId === "string" ? row.userId : "";
            const tier = Number(row.tier);
            if (!userId || !Number.isFinite(tier)) {
                continue;
            }
            rows.push({ userId, tier });
        }
    }
    return rows;
};
const buildTiersFromScores = (scores) => {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const result = {};
    for (const [userId, score] of sorted) {
        const tier = String((0, tier_1.scoreToTier)(score));
        if (!result[tier]) {
            result[tier] = [];
        }
        result[tier].push(userId);
    }
    return result;
};
const getTierCacheDocRef = (clubId, tierType) => (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("computedTier").doc(tierType);
const getTierLockDocRef = (clubId, tierType) => (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("computedTierLocks").doc(tierType);
const parseUpdatedAt = (value) => {
    if (value instanceof firestore_1.Timestamp) {
        return value.toDate();
    }
    if (value instanceof Date) {
        return value;
    }
    return null;
};
const readCached = async (clubId, tierType) => {
    const snap = await getTierCacheDocRef(clubId, tierType).get();
    if (!snap.exists) {
        return null;
    }
    const data = snap.data();
    if (!data?.scores || !data.tiers || !data.updatedAt) {
        return null;
    }
    const updatedAt = parseUpdatedAt(data.updatedAt);
    if (!updatedAt) {
        return null;
    }
    return {
        tierType,
        scores: data.scores,
        tiers: data.tiers,
        updatedAt,
    };
};
const withComputationLock = async (clubId, tierType, task) => {
    const db = (0, admin_1.getDb)();
    const lockRef = getTierLockDocRef(clubId, tierType);
    const now = Date.now();
    const locked = await db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const lockData = lockSnap.data();
        if (lockSnap.exists && lockData?.lockedAt && now - lockData.lockedAt < LOCK_MS) {
            return true;
        }
        tx.set(lockRef, { lockedAt: now });
        return false;
    });
    if (locked) {
        const cached = await readCached(clubId, tierType);
        if (cached) {
            return cached;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    try {
        return await task();
    }
    finally {
        await lockRef.delete().catch(() => undefined);
    }
};
const computeTier = async (clubId, tierType, options) => {
    await (0, firestore_2.ensureClubExists)((0, admin_1.getDb)(), clubId);
    if (!options?.force) {
        const cached = await readCached(clubId, tierType);
        if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_MS) {
            return cached;
        }
    }
    return withComputationLock(clubId, tierType, async () => {
        const db = (0, admin_1.getDb)();
        const tierListSnap = await db.collection("clubs").doc(clubId).collection("tierLists").get();
        const scoreBuckets = {};
        for (const doc of tierListSnap.docs) {
            const rows = parseTierListDoc(doc.data());
            for (const row of rows) {
                const bucket = scoreBuckets[row.userId] ?? [];
                bucket.push((0, tier_1.tierToScore)(row.tier));
                scoreBuckets[row.userId] = bucket;
            }
        }
        const scores = {};
        for (const [userId, values] of Object.entries(scoreBuckets)) {
            scores[userId] = Number((0, tier_1.average)(values).toFixed(2));
        }
        const tiers = buildTiersFromScores(scores);
        const computed = {
            tierType,
            scores,
            tiers,
            updatedAt: new Date(),
        };
        await getTierCacheDocRef(clubId, tierType).set({
            ...computed,
            updatedAt: firestore_1.Timestamp.fromDate(computed.updatedAt),
        });
        return computed;
    });
};
exports.computeTier = computeTier;
const getTierExplain = async (clubId, userId, tierType) => {
    const db = (0, admin_1.getDb)();
    const computed = await (0, exports.computeTier)(clubId, tierType);
    const peer = computed.scores[userId] ?? 0;
    const pairwiseSnap = await db.collection("clubs").doc(clubId).collection("pairwise").get();
    let wins = 0;
    let totals = 0;
    for (const doc of pairwiseSnap.docs) {
        const data = doc.data();
        if (data.userLow === userId) {
            wins += data.lowWins ?? 0;
            totals += data.total ?? 0;
        }
        else if (data.userHigh === userId) {
            wins += data.highWins ?? 0;
            totals += data.total ?? 0;
        }
    }
    const vote = totals ? Number(((wins / totals) * 100).toFixed(2)) : peer;
    const memberDoc = await db
        .collection("clubs")
        .doc(clubId)
        .collection("members")
        .doc(userId)
        .get();
    const memberData = memberDoc.data();
    const match = Number(memberData?.matchScore ?? peer);
    const score = Number(((peer + vote + match) / 3).toFixed(2));
    return {
        score,
        details: {
            peer: Number(peer.toFixed(2)),
            vote,
            match,
        },
    };
};
exports.getTierExplain = getTierExplain;
