import { Firestore } from "firebase-admin/firestore";
import { clubNotFoundError, notMemberError, notOwnerError } from "./errors";

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

  const members = db.collection("clubs").doc(clubId).collection("members");
  const directDoc = await members.doc(userId).get();
  if (directDoc.exists) {
    const data = directDoc.data() as { approved?: unknown } | undefined;
    if (data?.approved === true) {
      return;
    }
    throw notMemberError();
  }

  const [byUserId, byUid] = await Promise.all([
    members.where("userId", "==", userId).where("approved", "==", true).limit(1).get(),
    members.where("uid", "==", userId).where("approved", "==", true).limit(1).get(),
  ]);

  if (!byUserId.empty || !byUid.empty) {
    return;
  }

  throw notMemberError();
};

export const ensureOwner = async (db: Firestore, clubId: string, userId: string): Promise<void> => {
  await ensureClubExists(db, clubId);
  const clubDoc = await db.collection("clubs").doc(clubId).get();
  const ownerId = clubDoc.data()?.ownerId;
  if (typeof ownerId !== "string" || ownerId !== userId) {
    throw notOwnerError();
  }
};
