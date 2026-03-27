import admin from "firebase-admin";

let initialized = false;

const toMultiline = (value?: string): string | undefined => {
  if (!value) {
    return value;
  }
  return value.replace(/\\n/g, "\n");
};

export const initFirebaseAdmin = (): admin.app.App => {
  if (initialized && admin.apps.length > 0) {
    return admin.app();
  }

  if (admin.apps.length > 0) {
    initialized = true;
    return admin.app();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = toMultiline(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    admin.initializeApp();
  }

  initialized = true;
  return admin.app();
};

export const getAuth = () => {
  initFirebaseAdmin();
  return admin.auth();
};

export const getDb = () => {
  initFirebaseAdmin();
  return admin.firestore();
};
