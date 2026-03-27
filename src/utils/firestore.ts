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

  const members = db.collection("clubs").doc(clubId).collection("members");
  const directDoc = await members.doc(userId).get();
  if (directDoc.exists) {
    return;
  }

  const query = await members.where("userId", "==", userId).limit(1).get();
  if (query.empty) {
    throw notMemberError();
  }
};
