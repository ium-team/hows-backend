import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "../firebase/admin";
import { ensureClubExists } from "../utils/firestore";
import { average, scoreToTier } from "../utils/tier";

export type TierType = "overall" | "dribble" | "shoot";

export type ComputedTier = {
  tierType: TierType;
  scores: Record<string, number>;
  tiers: Record<string, string[]>;
  updatedAt: Date;
  version: number;
};

type ParsedTierEntry = {
  userId: string;
  tier: number;
};

type TierListPayload = {
  evaluatorId: string;
  data: unknown;
};

type ApprovedMember = {
  uid: string;
  name: string;
};

type WeightedRank = {
  userId: string;
  score: number;
  hasSignal: boolean;
};

type CompositeRankWeights = {
  overall: number;
  others: number;
  match: number;
};

const DEFAULT_COMPOSITE_WEIGHTS: CompositeRankWeights = {
  overall: 0.65,
  others: 0.2,
  match: 0.15,
};

const CACHE_MS = Number(process.env.COMPUTED_TIER_CACHE_MS ?? 300000);
const LOCK_MS = Number(process.env.COMPUTED_TIER_LOCK_MS ?? 10000);

const MIN_TIER = 0;
const MAX_TIER = 9;

const isValidTierNumber = (value: number) =>
  Number.isInteger(value) && value >= MIN_TIER && value <= MAX_TIER;

const parseTierListDoc = ({ evaluatorId, data: payload }: TierListPayload): ParsedTierEntry[] => {
  const rows: ParsedTierEntry[] = [];
  if (!payload || typeof payload !== "object") {
    return rows;
  }

  const data = payload as {
    tiers?: Record<string, unknown>;
    rankings?: Array<{ userId?: unknown; tier?: unknown }>;
    tierMap?: Record<string, unknown>;
  };

  const parseTierRecord = (record?: Record<string, unknown>) => {
    if (!record) {
      return;
    }
    for (const [tierKey, rawUsers] of Object.entries(record)) {
      const tierNumber = Number(tierKey);
      if (!isValidTierNumber(tierNumber)) {
        continue;
      }
      if (!Array.isArray(rawUsers)) {
        continue;
      }
      for (const rawUser of rawUsers) {
        if (typeof rawUser !== "string" || !rawUser) {
          continue;
        }
        if (evaluatorId && rawUser === evaluatorId) {
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
      if (!userId || !isValidTierNumber(tier)) {
        continue;
      }
      if (evaluatorId && userId === evaluatorId) {
        continue;
      }
      rows.push({ userId, tier });
    }
  }

  return rows;
};

const getTierCacheDocRef = (clubId: string, tierType: TierType) =>
  getDb().collection("clubs").doc(clubId).collection("computedTier").doc(tierType);

const getTierBoardDocRef = (clubId: string, topicId: string) =>
  getDb().collection("clubs").doc(clubId).collection("computedTierBoard").doc(topicId);

const getTierLockDocRef = (clubId: string, tierType: TierType) =>
  getDb().collection("clubs").doc(clubId).collection("computedTierLocks").doc(tierType);

const parseUpdatedAt = (value: unknown): Date | null => {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
};

const readCached = async (clubId: string, tierType: TierType): Promise<ComputedTier | null> => {
  const snap = await getTierCacheDocRef(clubId, tierType).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() as Partial<ComputedTier> & { updatedAt?: unknown; version?: unknown };
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

const withComputationLock = async <T>(
  clubId: string,
  tierType: TierType,
  task: () => Promise<T>,
): Promise<T> => {
  const db = getDb();
  const lockRef = getTierLockDocRef(clubId, tierType);
  const now = Date.now();

  const locked = await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    const lockData = lockSnap.data() as { lockedAt?: number } | undefined;

    if (lockSnap.exists && lockData?.lockedAt && now - lockData.lockedAt < LOCK_MS) {
      return true;
    }

    tx.set(lockRef, { lockedAt: now });
    return false;
  });

  if (locked) {
    const cached = await readCached(clubId, tierType);
    if (cached) {
      return cached as T;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  try {
    return await task();
  } finally {
    await lockRef.delete().catch(() => undefined);
  }
};

const getApprovedMembers = async (clubId: string): Promise<ApprovedMember[]> => {
  const membersSnap = await getDb().collection("clubs").doc(clubId).collection("members").get();

  return membersSnap.docs
    .map((doc) => {
      const data = doc.data() as { uid?: unknown; name?: unknown; approved?: unknown };
      const uid = typeof data.uid === "string" && data.uid ? data.uid : doc.id;
      const name = typeof data.name === "string" ? data.name : "";
      const approved = Boolean(data.approved);
      return { uid, name, approved };
    })
    .filter((member) => member.approved)
    .map((member) => ({ uid: member.uid, name: member.name }));
};

const getTierListPayloadsByTopic = async (clubId: string, topicId: string): Promise<TierListPayload[]> => {
  const db = getDb();

  if (topicId !== "default") {
    const snap = await db.collection("clubs").doc(clubId).collection("tierTopics").doc(topicId).collection("tierLists").get();
    return snap.docs.map((doc) => ({ evaluatorId: doc.id, data: doc.data() }));
  }

  const defaultTopicSnap = await db
    .collection("clubs")
    .doc(clubId)
    .collection("tierTopics")
    .doc("default")
    .collection("tierLists")
    .get();

  if (!defaultTopicSnap.empty) {
    return defaultTopicSnap.docs.map((doc) => ({ evaluatorId: doc.id, data: doc.data() }));
  }

  const rootSnap = await db.collection("clubs").doc(clubId).collection("tierLists").get();
  return rootSnap.docs.map((doc) => ({ evaluatorId: doc.id, data: doc.data() }));
};

const buildTierSkillMap = (tierPayloads: TierListPayload[], memberSet: Set<string>) => {
  const scoreMap = new Map<string, { sum: number; count: number }>();

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

  const skillMap = new Map<string, number>();
  scoreMap.forEach((value, uid) => {
    const avgTier = value.sum / value.count;
    const clampedAvg = Math.min(9, Math.max(0, avgTier));
    skillMap.set(uid, (9 - clampedAvg) / 9);
  });

  return skillMap;
};

const parseTopicWeight = (rawWeight: unknown) => {
  const weight = Number(rawWeight);
  if (!Number.isFinite(weight) || weight < 0) {
    return 1;
  }
  return weight;
};

const buildWeightedOtherTopicSkillMap = async (
  clubId: string,
  memberSet: Set<string>,
  topicDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
) => {
  const weightedByMember = new Map<string, { weightedSum: number; weightSum: number }>();
  const additionalTopicDocs = topicDocs.filter((topicDoc) => topicDoc.id !== "default");
  if (!additionalTopicDocs.length) {
    return new Map<string, number>();
  }

  const perTopicSkillRows = await Promise.all(
    additionalTopicDocs.map(async (topicDoc) => {
      const payloads = await getTierListPayloadsByTopic(clubId, topicDoc.id);
      const skillMap = buildTierSkillMap(payloads, memberSet);
      const topicWeight = parseTopicWeight(topicDoc.data()?.weight);
      return { skillMap, topicWeight };
    }),
  );

  for (const { skillMap, topicWeight } of perTopicSkillRows) {
    skillMap.forEach((skill, uid) => {
      const prev = weightedByMember.get(uid) ?? { weightedSum: 0, weightSum: 0 };
      weightedByMember.set(uid, {
        weightedSum: prev.weightedSum + skill * topicWeight,
        weightSum: prev.weightSum + topicWeight,
      });
    });
  }

  const result = new Map<string, number>();
  weightedByMember.forEach((value, uid) => {
    if (value.weightSum <= 0) {
      return;
    }
    result.set(uid, value.weightedSum / value.weightSum);
  });

  return result;
};

const buildAverageTierMap = (tierPayloads: TierListPayload[], memberSet: Set<string>) => {
  const scoreMap = new Map<string, { sum: number; count: number }>();

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

  const avgMap = new Map<string, number>();
  scoreMap.forEach((value, uid) => {
    avgMap.set(uid, value.sum / value.count);
  });

  return avgMap;
};

const buildMatchSkillMap = async (clubId: string, memberSet: Set<string>) => {
  const matchesSnap = await getDb().collection("clubs").doc(clubId).collection("matches").get();
  const statMap = new Map<string, { wins: number; total: number }>();

  const ensure = (uid: string) => {
    const prev = statMap.get(uid) ?? { wins: 0, total: 0 };
    statMap.set(uid, prev);
    return prev;
  };

  for (const doc of matchesSnap.docs) {
    const data = doc.data() as {
      challengerId?: unknown;
      opponentId?: unknown;
      winnerId?: unknown;
      status?: unknown;
    };

    const challengerId = typeof data.challengerId === "string" ? data.challengerId : "";
    const opponentId = typeof data.opponentId === "string" ? data.opponentId : "";
    const winnerId = typeof data.winnerId === "string" ? data.winnerId : "";
    const status = typeof data.status === "string" ? data.status : "";

    if (status !== "resolved" || !challengerId || !opponentId || !winnerId) {
      continue;
    }
    if (!memberSet.has(challengerId) || !memberSet.has(opponentId)) {
      continue;
    }

    const challenger = ensure(challengerId);
    const opponent = ensure(opponentId);
    challenger.total += 1;
    opponent.total += 1;
    if (winnerId === challengerId) {
      challenger.wins += 1;
    }
    if (winnerId === opponentId) {
      opponent.wins += 1;
    }
  }

  const skillMap = new Map<string, number>();
  statMap.forEach((value, uid) => {
    skillMap.set(uid, (value.wins + 1) / (value.total + 2));
  });

  return skillMap;
};

const meanOrNeutral = (skillMap: Map<string, number>) => {
  if (!skillMap.size) {
    return 0.5;
  }

  let sum = 0;
  skillMap.forEach((value) => {
    sum += value;
  });
  return sum / skillMap.size;
};

const sortByScoreWithNameTieBreak = (rows: WeightedRank[], memberNameMap: Map<string, string>) =>
  [...rows].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const nameA = memberNameMap.get(a.userId) ?? "";
    const nameB = memberNameMap.get(b.userId) ?? "";
    return nameA.localeCompare(nameB, "ko");
  });

const computeOverallWeightedRanking = async (clubId: string, members: ApprovedMember[]): Promise<WeightedRank[]> => {
  const memberSet = new Set(members.map((member) => member.uid));
  const memberNameMap = new Map(members.map((member) => [member.uid, member.name]));

  const [overallPayloads, topicSnap, matchSkillMap] = await Promise.all([
    getTierListPayloadsByTopic(clubId, "default"),
    getDb().collection("clubs").doc(clubId).collection("tierTopics").get(),
    buildMatchSkillMap(clubId, memberSet),
  ]);

  const overallSkillMap = buildTierSkillMap(overallPayloads, memberSet);
  const othersSkillMap = await buildWeightedOtherTopicSkillMap(clubId, memberSet, topicSnap.docs);

  const hasOverall = overallSkillMap.size > 0;
  const hasOthers = othersSkillMap.size > 0;
  const hasMatch = matchSkillMap.size > 0;
  const activeWeightSum =
    (hasOverall ? DEFAULT_COMPOSITE_WEIGHTS.overall : 0) +
    (hasOthers ? DEFAULT_COMPOSITE_WEIGHTS.others : 0) +
    (hasMatch ? DEFAULT_COMPOSITE_WEIGHTS.match : 0);
  const safeWeightSum = activeWeightSum > 0 ? activeWeightSum : 1;

  const overallFallback = meanOrNeutral(overallSkillMap);
  const othersFallback = meanOrNeutral(othersSkillMap);
  const matchFallback = meanOrNeutral(matchSkillMap);

  const rows = members.map((member) => {
    const overallScore = overallSkillMap.get(member.uid) ?? overallFallback;
    const othersScore = othersSkillMap.get(member.uid) ?? othersFallback;
    const matchScore = matchSkillMap.get(member.uid) ?? matchFallback;

    const weightedScore =
      ((hasOverall ? DEFAULT_COMPOSITE_WEIGHTS.overall * overallScore : 0) +
        (hasOthers ? DEFAULT_COMPOSITE_WEIGHTS.others * othersScore : 0) +
        (hasMatch ? DEFAULT_COMPOSITE_WEIGHTS.match * matchScore : 0)) /
      safeWeightSum;

    const hasSignal =
      overallSkillMap.has(member.uid) || othersSkillMap.has(member.uid) || matchSkillMap.has(member.uid);

    return {
      userId: member.uid,
      score: weightedScore,
      hasSignal,
    };
  });

  return sortByScoreWithNameTieBreak(rows, memberNameMap);
};

const computeTopicAverageRanking = async (
  clubId: string,
  topicId: string,
  members: ApprovedMember[],
): Promise<WeightedRank[]> => {
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

const buildTiersFromRankRows = (rows: WeightedRank[]): Record<string, string[]> => {
  const result: Record<string, string[]> = {};

  for (const row of rows) {
    const tier = String(scoreToTier(row.score * 100));
    if (!result[tier]) {
      result[tier] = [];
    }
    result[tier].push(row.userId);
  }

  return result;
};

const buildScoresFromRankRows = (rows: WeightedRank[]): Record<string, number> => {
  const scores: Record<string, number> = {};

  for (const row of rows) {
    scores[row.userId] = Number((row.score * 100).toFixed(2));
  }

  return scores;
};

const getRankingRowsByTierType = async (clubId: string, tierType: TierType, members: ApprovedMember[]) => {
  if (tierType === "overall") {
    return computeOverallWeightedRanking(clubId, members);
  }
  return computeTopicAverageRanking(clubId, tierType, members);
};

export const computeTier = async (
  clubId: string,
  tierType: TierType,
  options?: { force?: boolean },
): Promise<ComputedTier> => {
  await ensureClubExists(getDb(), clubId);

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

    const computed: ComputedTier = {
      tierType,
      scores,
      tiers,
      updatedAt: new Date(),
      version: Date.now(),
    };

    await getTierCacheDocRef(clubId, tierType).set({
      ...computed,
      updatedAt: Timestamp.fromDate(computed.updatedAt),
    });

    return computed;
  });
};

export const computeTierBoard = async (clubId: string, topicId = "default") => {
  await ensureClubExists(getDb(), clubId);

  const members = await getApprovedMembers(clubId);
  const rows =
    topicId === "default"
      ? await computeOverallWeightedRanking(clubId, members)
      : await computeTopicAverageRanking(clubId, topicId, members);

  const board: Record<string, string[]> = { pool: [] };
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

export const computeAndStoreTierBoard = async (clubId: string, topicId = "default") => {
  const result = await computeTierBoard(clubId, topicId);
  const now = new Date();
  await getTierBoardDocRef(clubId, topicId).set({
    topicId,
    board: result.board,
    updatedAt: Timestamp.fromDate(now),
    version: Date.now(),
  });
  return result;
};

export const recomputeClubTierSnapshots = async (clubId: string, topicId?: string) => {
  await ensureClubExists(getDb(), clubId);

  const tierTypes: TierType[] = ["overall", "dribble", "shoot"];
  await Promise.all(tierTypes.map((type) => computeTier(clubId, type, { force: true })));

  if (topicId) {
    await computeAndStoreTierBoard(clubId, topicId);
    return { updatedTierTypes: tierTypes, updatedBoards: [topicId] };
  }

  const topicSnap = await getDb().collection("clubs").doc(clubId).collection("tierTopics").get();
  const topicIds = Array.from(new Set(["default", ...topicSnap.docs.map((doc) => doc.id)]));
  await Promise.all(topicIds.map((id) => computeAndStoreTierBoard(clubId, id)));

  return { updatedTierTypes: tierTypes, updatedBoards: topicIds };
};

const deleteCollectionDocs = async (
  collection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) => {
  const db = getDb();
  let deleted = 0;

  while (true) {
    const snap = await collection.limit(300).get();
    if (snap.empty) {
      break;
    }

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      deleted += 1;
    }
    await batch.commit();
  }

  return deleted;
};

export const resetClubTierData = async (clubId: string, options?: { includeMatches?: boolean }) => {
  await ensureClubExists(getDb(), clubId);

  const includeMatches = options?.includeMatches ?? true;
  const clubRef = getDb().collection("clubs").doc(clubId);

  const rootTierListsDeleted = await deleteCollectionDocs(clubRef.collection("tierLists"));
  const computedTierDeleted = await deleteCollectionDocs(clubRef.collection("computedTier"));
  const computedTierBoardDeleted = await deleteCollectionDocs(clubRef.collection("computedTierBoard"));
  const computedTierLocksDeleted = await deleteCollectionDocs(clubRef.collection("computedTierLocks"));
  const matchesDeleted = includeMatches ? await deleteCollectionDocs(clubRef.collection("matches")) : 0;

  const topicSnap = await clubRef.collection("tierTopics").get();
  let topicTierListsDeleted = 0;
  let tierTopicsDeleted = 0;
  for (const topicDoc of topicSnap.docs) {
    topicTierListsDeleted += await deleteCollectionDocs(topicDoc.ref.collection("tierLists"));
    await topicDoc.ref.delete();
    tierTopicsDeleted += 1;
  }

  return {
    includeMatches,
    deleted: {
      rootTierLists: rootTierListsDeleted,
      topicTierLists: topicTierListsDeleted,
      tierTopics: tierTopicsDeleted,
      computedTier: computedTierDeleted,
      computedTierBoard: computedTierBoardDeleted,
      computedTierLocks: computedTierLocksDeleted,
      matches: matchesDeleted,
    },
  };
};

export const getTierExplain = async (clubId: string, userId: string, tierType: TierType) => {
  const db = getDb();
  const computed = await computeTier(clubId, tierType);
  const peer = computed.scores[userId] ?? 0;

  const matchesSnap = await db.collection("clubs").doc(clubId).collection("matches").get();
  let wins = 0;
  let totals = 0;

  for (const doc of matchesSnap.docs) {
    const data = doc.data() as {
      challengerId?: unknown;
      opponentId?: unknown;
      winnerId?: unknown;
      status?: unknown;
    };

    const challengerId = typeof data.challengerId === "string" ? data.challengerId : "";
    const opponentId = typeof data.opponentId === "string" ? data.opponentId : "";
    const winnerId = typeof data.winnerId === "string" ? data.winnerId : "";
    const status = typeof data.status === "string" ? data.status : "";

    if (status !== "resolved" || !challengerId || !opponentId || !winnerId) {
      continue;
    }

    if (challengerId === userId || opponentId === userId) {
      totals += 1;
      if (winnerId === userId) {
        wins += 1;
      }
    }
  }

  const matchResult = totals ? Number(((wins / totals) * 100).toFixed(2)) : peer;

  const memberDoc = await db.collection("clubs").doc(clubId).collection("members").doc(userId).get();
  const memberData = memberDoc.data() as { matchScore?: number } | undefined;
  const match = Number(memberData?.matchScore ?? peer);

  const score = Number(average([peer, matchResult, match]).toFixed(2));

  return {
    score,
    details: {
      peer: Number(peer.toFixed(2)),
      matchResult,
      match,
    },
  };
};
