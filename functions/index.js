const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const auth = getAuth();

exports.deleteClientAccount = onCall(
  { region: "europe-west2", timeoutSeconds: 540, memory: "512MiB", maxInstances: 5 },
  async request => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in as an administrator first.");
    }

    const adminSnapshot = await db.doc(`admins/${request.auth.uid}`).get();
    if (!adminSnapshot.exists || adminSnapshot.data().enabled !== true) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }

    const uid = request.data?.uid;
    if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(uid)) {
      throw new HttpsError("invalid-argument", "Select a valid client account.");
    }
    if (uid === request.auth.uid) {
      throw new HttpsError("failed-precondition", "An administrator cannot delete their own account here.");
    }

    const profileRef = db.doc(`users/${uid}`);
    const profileSnapshot = await profileRef.get();
    if (!profileSnapshot.exists || profileSnapshot.data().role !== "client") {
      throw new HttpsError("not-found", "The selected client account was not found.");
    }

    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        throw new HttpsError("internal", "Firebase could not remove this client's sign-in.");
      }
    }

    await db.recursiveDelete(profileRef);
    return { success: true, uid };
  }
);
