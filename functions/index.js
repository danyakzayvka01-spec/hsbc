const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();
const allowedCurrencies = new Set(["USD", "EUR", "GBP"]);

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const adminRecord = await db.collection("admins").doc(request.auth.uid).get();
  if (!adminRecord.exists || adminRecord.data().enabled !== true) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
}

function validateBalance(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    throw new HttpsError("invalid-argument", "Balance must be between 0 and 1,000,000.");
  }
  return Math.round(amount * 100) / 100;
}

function validateCurrency(value) {
  if (!allowedCurrencies.has(value)) throw new HttpsError("invalid-argument", "Choose USD, EUR, or GBP.");
  return value;
}

exports.adminListClients = onCall(async request => {
  await requireAdmin(request);
  const snapshot = await db.collection("users").orderBy("createdAt", "desc").limit(250).get();
  return {
    clients: snapshot.docs.map(document => {
      const { displayName, email, checkingBalance, savingsBalance, currency, cardLast4 } = document.data();
      return { uid: document.id, displayName, email, checkingBalance, savingsBalance, currency, cardLast4 };
    })
  };
});

exports.adminCreateClient = onCall(async request => {
  await requireAdmin(request);
  const { displayName, email, password, checkingBalance, currency, cardLast4 } = request.data || {};
  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 80) {
    throw new HttpsError("invalid-argument", "Enter a client name between 2 and 80 characters.");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new HttpsError("invalid-argument", "Temporary password must be at least 10 characters.");
  }
  if (typeof cardLast4 !== "string" || !/^\d{4}$/.test(cardLast4)) {
    throw new HttpsError("invalid-argument", "Only the last four display digits can be saved.");
  }

  const amount = validateBalance(checkingBalance);
  const code = validateCurrency(currency);
  let userRecord;
  try {
    userRecord = await getAuth().createUser({
      email: email.trim().toLowerCase(),
      password,
      displayName: displayName.trim(),
      emailVerified: false,
      disabled: false
    });
    await db.collection("users").doc(userRecord.uid).create({
      displayName: displayName.trim(),
      email: userRecord.email,
      checkingBalance: amount,
      savingsBalance: 0,
      currency: code,
      cardLast4,
      role: "client",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    await db.collection("audit").doc(userRecord.uid).collection("entries").add({
      action: "client-created",
      adminUid: request.auth.uid,
      amount,
      currency: code,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    if (userRecord) await getAuth().deleteUser(userRecord.uid).catch(() => {});
    if (error instanceof HttpsError) throw error;
    if (error.code === "auth/email-already-exists") throw new HttpsError("already-exists", "A user already exists with this email.");
    throw new HttpsError("internal", "Could not create this demo client account.");
  }
  return { uid: userRecord.uid };
});

exports.adminUpdateBalance = onCall(async request => {
  await requireAdmin(request);
  const { uid, checkingBalance, currency } = request.data || {};
  if (typeof uid !== "string" || uid.length < 10) throw new HttpsError("invalid-argument", "A client account is required.");
  const amount = validateBalance(checkingBalance);
  const code = validateCurrency(currency);
  const userRef = db.collection("users").doc(uid);
  const auditRef = db.collection("audit").doc(uid).collection("entries").doc();

  await db.runTransaction(async transaction => {
    const current = await transaction.get(userRef);
    if (!current.exists) throw new HttpsError("not-found", "Client account was not found.");
    const previousBalance = Number(current.data().checkingBalance || 0);
    const previousCurrency = current.data().currency || "USD";
    transaction.update(userRef, {
      checkingBalance: amount,
      currency: code,
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(auditRef, {
      action: "demo-balance-updated",
      adminUid: request.auth.uid,
      previousBalance,
      previousCurrency,
      checkingBalance: amount,
      currency: code,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return { ok: true };
});
