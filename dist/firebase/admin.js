"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = exports.getAuth = exports.initFirebaseAdmin = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
let initialized = false;
const toMultiline = (value) => {
    if (!value) {
        return value;
    }
    return value.replace(/\\n/g, "\n");
};
const initFirebaseAdmin = () => {
    if (initialized && firebase_admin_1.default.apps.length > 0) {
        return firebase_admin_1.default.app();
    }
    if (firebase_admin_1.default.apps.length > 0) {
        initialized = true;
        return firebase_admin_1.default.app();
    }
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = toMultiline(process.env.FIREBASE_PRIVATE_KEY);
    if (projectId && clientEmail && privateKey) {
        firebase_admin_1.default.initializeApp({
            credential: firebase_admin_1.default.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
    }
    else {
        firebase_admin_1.default.initializeApp();
    }
    initialized = true;
    return firebase_admin_1.default.app();
};
exports.initFirebaseAdmin = initFirebaseAdmin;
const getAuth = () => {
    (0, exports.initFirebaseAdmin)();
    return firebase_admin_1.default.auth();
};
exports.getAuth = getAuth;
const getDb = () => {
    (0, exports.initFirebaseAdmin)();
    return firebase_admin_1.default.firestore();
};
exports.getDb = getDb;
