import { Firestore } from "firebase-admin/firestore";
import { clubNotFoundError, notMemberError } from "./errors";

export const ensureClubExists = async (db: Firestore, clubId: string): Promise<void> => {
  const clubDoc = await db.collection("clubs").doc(clubId).get();
  if (!clubDoc.exists) {
    throw clubNotFoundError();
  }
};

export const ensureMember = async (
  db: Firestore,
  clubId: string,
  userId: string,
): Promise<void> => {
  await ensureClubExists(db, clubId);

  // Fast path: trust club.memberIds when member documents are legacy/inconsistent.
  const clubDoc = await db.collection("clubs").doc(clubId).get();
  const clubData = clubDoc.data() as { memberIds?: unknown } | undefined;
  const memberIds = Array.isArray(clubData?.memberIds)
    ? clubData.memberIds.filter((id): id is string => typeof id === "string")
    : [];
  if (memberIds.includes(userId)) {
    return;
  }

  const members = db.collection("clubs").doc(clubId).collection("members");
  const directDoc = await members.doc(userId).get();
  if (directDoc.exists) {
    return;
  }

  const [byUserId, byUid] = await Promise.all([
    members.where("userId", "==", userId).limit(1).get(),
    members.where("uid", "==", userId).limit(1).get(),
  ]);

  if (!byUserId.empty || !byUid.empty) {
    return;
  }

  throw notMemberError();
};
