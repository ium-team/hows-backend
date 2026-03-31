"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTierExplain = exports.recomputeClubTierSnapshots = exports.computeAndStoreTierBoard = exports.computeTierBoard = exports.computeTier = void 0;
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("../firebase/admin");
const firestore_2 = require("../utils/firestore");
const tier_1 = require("../utils/tier");
const DEFAULT_COMPOSITE_WEIGHTS = {
    overall: 0.65,
    others: 0.2,
    vote: 0.15,
};
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
const getTierCacheDocRef = (clubId, tierType) => (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("computedTier").doc(tierType);
const getTierBoardDocRef = (clubId, topicId) => (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("computedTierBoard").doc(topicId);
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
        version: typeof data.version === "number" ? data.version : 0,
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
const getApprovedMembers = async (clubId) => {
    const membersSnap = await (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("members").get();
    return membersSnap.docs
        .map((doc) => {
        const data = doc.data();
        const uid = typeof data.uid === "string" && data.uid ? data.uid : doc.id;
        const name = typeof data.name === "string" ? data.name : "";
        const approved = Boolean(data.approved);
        return { uid, name, approved };
    })
        .filter((member) => member.approved)
        .map((member) => ({ uid: member.uid, name: member.name }));
};
const getTierListPayloadsByTopic = async (clubId, topicId) => {
    const db = (0, admin_1.getDb)();
    if (topicId !== "default") {
        const snap = await db.collection("clubs").doc(clubId).collection("tierTopics").doc(topicId).collection("tierLists").get();
        return snap.docs.map((doc) => doc.data());
    }
    const defaultTopicSnap = await db
        .collection("clubs")
        .doc(clubId)
        .collection("tierTopics")
        .doc("default")
        .collection("tierLists")
        .get();
    if (!defaultTopicSnap.empty) {
        return defaultTopicSnap.docs.map((doc) => doc.data());
    }
    const rootSnap = await db.collection("clubs").doc(clubId).collection("tierLists").get();
    return rootSnap.docs.map((doc) => doc.data());
};
const buildTierSkillMap = (tierPayloads, memberSet) => {
    const scoreMap = new Map();
    for (const payload of tierPayloads) {
        const rows = parseTierListDoc(payload);
        for (const row of rows) {
            if (!memberSet.has(row.userId)) {
                continue;
            }
            const prev = scoreMap.get(row.userId) ?? { sum: 0, count: 0 };
            scoreMap.set(row.userId, { sum: prev.sum + row.tier, count: prev.count + 1 });
        }
    }
    const skillMap = new Map();
    scoreMap.forEach((value, uid) => {
        const avgTier = value.sum / value.count;
        const clampedAvg = Math.min(9, Math.max(0, avgTier));
        skillMap.set(uid, (9 - clampedAvg) / 9);
    });
    return skillMap;
};
const buildAverageTierMap = (tierPayloads, memberSet) => {
    const scoreMap = new Map();
    for (const payload of tierPayloads) {
        const rows = parseTierListDoc(payload);
        for (const row of rows) {
            if (!memberSet.has(row.userId)) {
                continue;
            }
            const prev = scoreMap.get(row.userId) ?? { sum: 0, count: 0 };
            scoreMap.set(row.userId, { sum: prev.sum + row.tier, count: prev.count + 1 });
        }
    }
    const avgMap = new Map();
    scoreMap.forEach((value, uid) => {
        avgMap.set(uid, value.sum / value.count);
    });
    return avgMap;
};
const buildVoteSkillMap = async (clubId, memberSet) => {
    const votesSnap = await (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("votes").get();
    const statMap = new Map();
    const ensure = (uid) => {
        const prev = statMap.get(uid) ?? { wins: 0, total: 0 };
        statMap.set(uid, prev);
        return prev;
    };
    for (const doc of votesSnap.docs) {
        const data = doc.data();
        const leftId = typeof data.leftId === "string" ? data.leftId : typeof data.A === "string" ? data.A : "";
        const rightId = typeof data.rightId === "string" ? data.rightId : typeof data.B === "string" ? data.B : "";
        const winnerId = typeof data.winnerId === "string" ? data.winnerId : typeof data.winner === "string" ? data.winner : "";
        if (!leftId || !rightId || !winnerId) {
            continue;
        }
        if (!memberSet.has(leftId) || !memberSet.has(rightId)) {
            continue;
        }
        const left = ensure(leftId);
        const right = ensure(rightId);
        left.total += 1;
        right.total += 1;
        if (winnerId === leftId) {
            left.wins += 1;
        }
        if (winnerId === rightId) {
            right.wins += 1;
        }
    }
    const skillMap = new Map();
    statMap.forEach((value, uid) => {
        skillMap.set(uid, (value.wins + 1) / (value.total + 2));
    });
    return skillMap;
};
const meanOrNeutral = (skillMap) => {
    if (!skillMap.size) {
        return 0.5;
    }
    let sum = 0;
    skillMap.forEach((value) => {
        sum += value;
    });
    return sum / skillMap.size;
};
const sortByScoreWithNameTieBreak = (rows, memberNameMap) => [...rows].sort((a, b) => {
    if (b.score !== a.score) {
        return b.score - a.score;
    }
    const nameA = memberNameMap.get(a.userId) ?? "";
    const nameB = memberNameMap.get(b.userId) ?? "";
    return nameA.localeCompare(nameB, "ko");
});
const computeOverallWeightedRanking = async (clubId, members) => {
    const memberSet = new Set(members.map((member) => member.uid));
    const memberNameMap = new Map(members.map((member) => [member.uid, member.name]));
    const [overallPayloads, topicSnap, voteSkillMap] = await Promise.all([
        getTierListPayloadsByTopic(clubId, "default"),
        (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("tierTopics").get(),
        buildVoteSkillMap(clubId, memberSet),
    ]);
    const otherPayloadGroups = await Promise.all(topicSnap.docs.map((topicDoc) => getTierListPayloadsByTopic(clubId, topicDoc.id)));
    const otherPayloads = otherPayloadGroups.flat();
    const overallSkillMap = buildTierSkillMap(overallPayloads, memberSet);
    const othersSkillMap = buildTierSkillMap(otherPayloads, memberSet);
    const hasOverall = overallSkillMap.size > 0;
    const hasOthers = othersSkillMap.size > 0;
    const hasVote = voteSkillMap.size > 0;
    const activeWeightSum = (hasOverall ? DEFAULT_COMPOSITE_WEIGHTS.overall : 0) +
        (hasOthers ? DEFAULT_COMPOSITE_WEIGHTS.others : 0) +
        (hasVote ? DEFAULT_COMPOSITE_WEIGHTS.vote : 0);
    const safeWeightSum = activeWeightSum > 0 ? activeWeightSum : 1;
    const overallFallback = meanOrNeutral(overallSkillMap);
    const othersFallback = meanOrNeutral(othersSkillMap);
    const voteFallback = meanOrNeutral(voteSkillMap);
    const rows = members.map((member) => {
        const overallScore = overallSkillMap.get(member.uid) ?? overallFallback;
        const othersScore = othersSkillMap.get(member.uid) ?? othersFallback;
        const voteScore = voteSkillMap.get(member.uid) ?? voteFallback;
        const weightedScore = ((hasOverall ? DEFAULT_COMPOSITE_WEIGHTS.overall * overallScore : 0) +
            (hasOthers ? DEFAULT_COMPOSITE_WEIGHTS.others * othersScore : 0) +
            (hasVote ? DEFAULT_COMPOSITE_WEIGHTS.vote * voteScore : 0)) /
            safeWeightSum;
        const hasSignal = overallSkillMap.has(member.uid) || othersSkillMap.has(member.uid) || voteSkillMap.has(member.uid);
        return {
            userId: member.uid,
            score: weightedScore,
            hasSignal,
        };
    });
    return sortByScoreWithNameTieBreak(rows, memberNameMap);
};
const computeTopicAverageRanking = async (clubId, topicId, members) => {
    const memberSet = new Set(members.map((member) => member.uid));
    const memberNameMap = new Map(members.map((member) => [member.uid, member.name]));
    const payloads = await getTierListPayloadsByTopic(clubId, topicId);
    const avgTierMap = buildAverageTierMap(payloads, memberSet);
    const rows = members.map((member) => {
        const avgTier = avgTierMap.get(member.uid);
        if (avgTier === undefined) {
            return {
                userId: member.uid,
                score: 0,
                hasSignal: false,
            };
        }
        const clampedAvg = Math.min(9, Math.max(0, avgTier));
        return {
            userId: member.uid,
            score: (9 - clampedAvg) / 9,
            hasSignal: true,
        };
    });
    return sortByScoreWithNameTieBreak(rows, memberNameMap);
};
const buildTiersFromRankRows = (rows) => {
    const result = {};
    for (const row of rows) {
        const tier = String((0, tier_1.scoreToTier)(row.score * 100));
        if (!result[tier]) {
            result[tier] = [];
        }
        result[tier].push(row.userId);
    }
    return result;
};
const buildScoresFromRankRows = (rows) => {
    const scores = {};
    for (const row of rows) {
        scores[row.userId] = Number((row.score * 100).toFixed(2));
    }
    return scores;
};
const getRankingRowsByTierType = async (clubId, tierType, members) => {
    if (tierType === "overall") {
        return computeOverallWeightedRanking(clubId, members);
    }
    return computeTopicAverageRanking(clubId, tierType, members);
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
        const members = await getApprovedMembers(clubId);
        const rows = await getRankingRowsByTierType(clubId, tierType, members);
        const scores = buildScoresFromRankRows(rows);
        const tiers = buildTiersFromRankRows(rows);
        const computed = {
            tierType,
            scores,
            tiers,
            updatedAt: new Date(),
            version: Date.now(),
        };
        await getTierCacheDocRef(clubId, tierType).set({
            ...computed,
            updatedAt: firestore_1.Timestamp.fromDate(computed.updatedAt),
        });
        return computed;
    });
};
exports.computeTier = computeTier;
const computeTierBoard = async (clubId, topicId = "default") => {
    await (0, firestore_2.ensureClubExists)((0, admin_1.getDb)(), clubId);
    const members = await getApprovedMembers(clubId);
    const rows = topicId === "default"
        ? await computeOverallWeightedRanking(clubId, members)
        : await computeTopicAverageRanking(clubId, topicId, members);
    const board = { pool: [] };
    for (let i = 0; i <= 9; i += 1) {
        board[String(i)] = [];
    }
    for (const row of rows) {
        if (!row.hasSignal) {
            board["pool"]?.push(row.userId);
            continue;
        }
        const tierKey = Math.min(9, Math.max(0, Math.round((1 - row.score) * 9))).toString();
        const bucket = board[tierKey];
        if (!bucket) {
            continue;
        }
        bucket.push(row.userId);
    }
    return { board };
};
exports.computeTierBoard = computeTierBoard;
const computeAndStoreTierBoard = async (clubId, topicId = "default") => {
    const result = await (0, exports.computeTierBoard)(clubId, topicId);
    const now = new Date();
    await getTierBoardDocRef(clubId, topicId).set({
        topicId,
        board: result.board,
        updatedAt: firestore_1.Timestamp.fromDate(now),
        version: Date.now(),
    });
    return result;
};
exports.computeAndStoreTierBoard = computeAndStoreTierBoard;
const recomputeClubTierSnapshots = async (clubId, topicId) => {
    await (0, firestore_2.ensureClubExists)((0, admin_1.getDb)(), clubId);
    const tierTypes = ["overall", "dribble", "shoot"];
    await Promise.all(tierTypes.map((type) => (0, exports.computeTier)(clubId, type, { force: true })));
    if (topicId) {
        await (0, exports.computeAndStoreTierBoard)(clubId, topicId);
        return { updatedTierTypes: tierTypes, updatedBoards: [topicId] };
    }
    const topicSnap = await (0, admin_1.getDb)().collection("clubs").doc(clubId).collection("tierTopics").get();
    const topicIds = Array.from(new Set(["default", ...topicSnap.docs.map((doc) => doc.id)]));
    await Promise.all(topicIds.map((id) => (0, exports.computeAndStoreTierBoard)(clubId, id)));
    return { updatedTierTypes: tierTypes, updatedBoards: topicIds };
};
exports.recomputeClubTierSnapshots = recomputeClubTierSnapshots;
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
    const memberDoc = await db.collection("clubs").doc(clubId).collection("members").doc(userId).get();
    const memberData = memberDoc.data();
    const match = Number(memberData?.matchScore ?? peer);
    const score = Number((0, tier_1.average)([peer, vote, match]).toFixed(2));
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
