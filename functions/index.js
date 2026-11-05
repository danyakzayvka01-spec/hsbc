const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();
const allowedCurrencies = new Set(["USD", "EUR", "GBP"]);
const MAX_DOCUMENT_BYTES = 512 * 1024;

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
  const { displayName, email, password, checkingBalance, currency, cardNumber, passportNumber, registeredAddress, phoneNumber, passportIssueDate, citizenship } = request.data || {};
  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 80) {
    throw new HttpsError("invalid-argument", "Enter a client name between 2 and 80 characters.");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new HttpsError("invalid-argument", "Temporary password must be at least 10 characters.");
  }
  const normalizedCardNumber = typeof cardNumber === "string" ? cardNumber.replace(/[\s-]/g, "") : "";
  if (!/^\d{12,19}$/.test(normalizedCardNumber)) {
    throw new HttpsError("invalid-argument", "Enter a fictional demo card number containing 12 to 19 digits.");
  }
  const identity = {
    passportNumber: [passportNumber, 4, 40, "Passport number"],
    registeredAddress: [registeredAddress, 5, 200, "Registered address"],
    phoneNumber: [phoneNumber, 5, 32, "Phone number"],
    passportIssueDate: [passportIssueDate, 10, 10, "Issue date"],
    citizenship: [citizenship, 2, 80, "Citizenship"]
  };
  for (const [value, min, max, label] of Object.values(identity)) {
    if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
      throw new HttpsError("invalid-argument", `${label} is required and must be ${min}–${max} characters.`);
    }
  }
  const issueDate = new Date(`${passportIssueDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(passportIssueDate) || Number.isNaN(issueDate.getTime()) || issueDate.toISOString().slice(0, 10) !== passportIssueDate) {
    throw new HttpsError("invalid-argument", "Enter a valid passport issue date.");
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
      cardNumber: normalizedCardNumber,
      cardLast4: normalizedCardNumber.slice(-4),
      identity: Object.fromEntries(Object.entries(identity).map(([key, [value]]) => [key, value.trim()])),
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
    console.error("adminCreateClient failed", error.code || "unknown", error.message || "No error message");
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

exports.adminAddClientDocument = onCall(async request => {
  await requireAdmin(request);
  const { uid, documentId, title, description, category, originalName, fileBase64 } = request.data || {};
  if (typeof uid !== "string" || uid.length < 10) throw new HttpsError("invalid-argument", "A client account is required.");
  if (typeof documentId !== "string" || !/^[a-zA-Z0-9_-]{12,80}$/.test(documentId)) {
    throw new HttpsError("invalid-argument", "Invalid document ID.");
  }
  if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 100) {
    throw new HttpsError("invalid-argument", "Document title must be 2 to 100 characters.");
  }
  if (typeof description !== "string" || description.length > 300) {
    throw new HttpsError("invalid-argument", "Document description is too long.");
  }
  const allowedCategories = new Set(["Statement", "Account confirmation", "Notice", "Other"]);
  if (!allowedCategories.has(category)) throw new HttpsError("invalid-argument", "Choose a valid document type.");
  if (typeof originalName !== "string" || originalName.length > 180 || !originalName.toLowerCase().endsWith(".pdf")) {
    throw new HttpsError("invalid-argument", "Only PDF files are accepted.");
  }
  if (typeof fileBase64 !== "string" || fileBase64.length < 1 || fileBase64.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64)) {
    throw new HttpsError("invalid-argument", "PDF files must be 512 KB or smaller.");
  }
  const fileBytes = Buffer.from(fileBase64, "base64");
  if (fileBytes.length < 5 || fileBytes.length > MAX_DOCUMENT_BYTES || fileBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new HttpsError("invalid-argument", "Upload a valid PDF no larger than 512 KB.");
  }
  const userRef = db.collection("users").doc(uid);
  const user = await userRef.get();
  if (!user.exists) throw new HttpsError("not-found", "Client account was not found.");
  const sizeBytes = fileBytes.length;

  await userRef.collection("documents").doc(documentId).create({
    title: title.trim(),
    description: description.trim(),
    category,
    originalName: originalName.replace(/[\\/\r\n]/g, "_").slice(0, 180),
    dataBase64: fileBytes.toString("base64"),
    contentType: "application/pdf",
    sizeBytes,
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp()
  });
  await db.collection("audit").doc(uid).collection("entries").add({
    action: "demo-document-added",
    adminUid: request.auth.uid,
    documentId,
    title: title.trim(),
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, documentId };
});
