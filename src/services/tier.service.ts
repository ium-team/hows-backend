import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "../firebase/admin";
import { ensureClubExists } from "../utils/firestore";
import { average, scoreToTier, tierToScore } from "../utils/tier";

export type TierType = "overall" | "dribble" | "shoot";

export type ComputedTier = {
  tierType: TierType;
  scores: Record<string, number>;
  tiers: Record<string, string[]>;
  updatedAt: Date;
};

type ParsedTierEntry = {
  userId: string;
  tier: number;
};

const CACHE_MS = Number(process.env.COMPUTED_TIER_CACHE_MS ?? 300000);
const LOCK_MS = Number(process.env.COMPUTED_TIER_LOCK_MS ?? 10000);

const parseTierListDoc = (payload: unknown): ParsedTierEntry[] => {
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

const buildTiersFromScores = (scores: Record<string, number>): Record<string, string[]> => {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const result: Record<string, string[]> = {};

  for (const [userId, score] of sorted) {
    const tier = String(scoreToTier(score));
    if (!result[tier]) {
      result[tier] = [];
    }
    result[tier].push(userId);
  }

  return result;
};

const getTierCacheDocRef = (clubId: string, tierType: TierType) =>
  getDb().collection("clubs").doc(clubId).collection("computedTier").doc(tierType);

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

  const data = snap.data() as Partial<ComputedTier> & { updatedAt?: unknown };
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
    const db = getDb();
    const tierListSnap = await db.collection("clubs").doc(clubId).collection("tierLists").get();

    const scoreBuckets: Record<string, number[]> = {};

    for (const doc of tierListSnap.docs) {
      const rows = parseTierListDoc(doc.data());
      for (const row of rows) {
        const bucket = scoreBuckets[row.userId] ?? [];
        bucket.push(tierToScore(row.tier));
        scoreBuckets[row.userId] = bucket;
      }
    }

    const scores: Record<string, number> = {};
    for (const [userId, values] of Object.entries(scoreBuckets)) {
      scores[userId] = Number(average(values).toFixed(2));
    }

    const tiers = buildTiersFromScores(scores);

    const computed: ComputedTier = {
      tierType,
      scores,
      tiers,
      updatedAt: new Date(),
    };

    await getTierCacheDocRef(clubId, tierType).set({
      ...computed,
      updatedAt: Timestamp.fromDate(computed.updatedAt),
    });

    return computed;
  });
};

export const getTierExplain = async (clubId: string, userId: string, tierType: TierType) => {
  const db = getDb();
  const computed = await computeTier(clubId, tierType);
  const peer = computed.scores[userId] ?? 0;

  const pairwiseSnap = await db.collection("clubs").doc(clubId).collection("pairwise").get();
  let wins = 0;
  let totals = 0;

  for (const doc of pairwiseSnap.docs) {
    const data = doc.data() as {
      userLow?: string;
      userHigh?: string;
      lowWins?: number;
      highWins?: number;
      total?: number;
    };

    if (data.userLow === userId) {
      wins += data.lowWins ?? 0;
      totals += data.total ?? 0;
    } else if (data.userHigh === userId) {
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
  const memberData = memberDoc.data() as { matchScore?: number } | undefined;
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
