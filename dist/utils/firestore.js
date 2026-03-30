"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMember = exports.ensureClubExists = void 0;
const errors_1 = require("./errors");
const ensureClubExists = async (db, clubId) => {
    const clubDoc = await db.collection("clubs").doc(clubId).get();
    if (!clubDoc.exists) {
        throw (0, errors_1.clubNotFoundError)();
    }
};
exports.ensureClubExists = ensureClubExists;
const ensureMember = async (db, clubId, userId) => {
    await (0, exports.ensureClubExists)(db, clubId);
    // Fast path: trust club.memberIds when member documents are legacy/inconsistent.
    const clubDoc = await db.collection("clubs").doc(clubId).get();
    const clubData = clubDoc.data();
    const memberIds = Array.isArray(clubData?.memberIds)
        ? clubData.memberIds.filter((id) => typeof id === "string")
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
    throw (0, errors_1.notMemberError)();
};
exports.ensureMember = ensureMember;
