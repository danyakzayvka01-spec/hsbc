import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const authMessage = document.getElementById("authMessage");
const adminMessage = document.getElementById("adminFormMessage");
const firebaseReady = isFirebaseConfigured;
let auth, db, functions;
const MAX_DOCUMENT_BYTES = 512 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read the selected PDF."));
    reader.readAsDataURL(file);
  });
}

function downloadPdf(base64, fileName) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "document.pdf";
  link.click();
  URL.revokeObjectURL(url);
}

function showMessage(el, message, kind = "error") {
  el.textContent = message;
  el.classList.remove("hidden", "text-rose-700", "text-emerald-700");
  el.classList.add(kind === "success" ? "text-emerald-700" : "text-rose-700");
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("user-not-found") || code.includes("wrong-password")) return "Email or password is incorrect.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a little and try again.";
  if (code.includes("email-already-exists")) return "An account with this email already exists.";
  if (code.includes("permission-denied")) return "Firebase denied the admin check. In Firebase Console, publish firestore.rules and add admins/{your Auth UID} with enabled=true for this administrator.";
  if (code.includes("unauthenticated")) return "Sign in again and retry.";
  if (code.includes("functions/unavailable") || code.includes("not-found")) return "Firebase Functions are not deployed yet. See the setup guide.";
  return error?.message || "Something went wrong. Please try again.";
}

function openPortal() {
  document.getElementById("publicSite").classList.add("hidden");
  document.getElementById("bankingApp").classList.remove("hidden");
  window.scrollTo({ top: 0 });
}

function setPortal(role) {
  openPortal();
  const admin = role === "admin";
  document.getElementById("clientPortal").classList.toggle("hidden", admin);
  document.getElementById("adminPortal").classList.toggle("hidden", !admin);
  if (admin) {
    document.getElementById("adminIdentity").textContent = auth.currentUser?.email || "Administrator";
    loadClients();
  } else {
    loadClientRecord();
  }
  if (window.lucide) window.lucide.createIcons();
}

function prettyCardNumber(value) {
  return String(value || "").replace(/\D/g, "").match(/.{1,4}/g)?.join(" ") || "";
}

async function resolveRole(user) {
  const adminRecord = await getDoc(doc(db, "admins", user.uid));
  return adminRecord.exists() && adminRecord.data().enabled === true ? "admin" : "client";
}

async function loadClientRecord() {
  const user = auth.currentUser;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      showMessage(authMessage, "Your client profile is not set up. Ask an administrator to create the demo account.");
      await signOut(auth);
      return;
    }
    window.applyClientRecord(snap.data());
  } catch (error) {
    showMessage(authMessage, friendlyError(error));
    await signOut(auth);
  }
}

async function callAdmin(name, payload = {}) {
  const action = httpsCallable(functions, name);
  return (await action(payload)).data;
}

async function loadClients() {
  const container = document.getElementById("clientList");
  container.replaceChildren(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-slate-400", textContent: "Loading client records…" }));
  try {
    const { clients } = await callAdmin("adminListClients");
    document.getElementById("clientCount").textContent = clients.length;
    container.replaceChildren();
    if (!clients.length) {
      container.append(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-slate-400", textContent: "No client accounts yet. Create the first demo account using the form." }));
      return;
    }
    clients.forEach(client => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50";
      const avatar = document.createElement("span");
      avatar.className = "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-xs font-bold text-rose-700";
      avatar.textContent = (client.displayName || "C").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
      const detail = document.createElement("span");
      detail.className = "min-w-0 flex-1";
      const name = document.createElement("span");
      name.className = "block truncate text-sm font-semibold text-slate-800";
      name.textContent = client.displayName || "Client";
      const email = document.createElement("span");
      email.className = "mt-1 block truncate text-xs text-slate-500";
      email.textContent = client.email || "";
      detail.append(name, email);
      const balance = document.createElement("span");
      balance.className = "text-right text-xs font-semibold text-slate-700";
      balance.textContent = new Intl.NumberFormat("en-US", { style: "currency", currency: client.currency || "USD" }).format(Number(client.checkingBalance || 0));
      const card = document.createElement("span");
      card.className = "hidden text-[10px] text-slate-400 sm:block";
      card.textContent = `···· ${client.cardLast4 || "----"}`;
      row.append(avatar, detail, card, balance);
      row.addEventListener("click", () => selectClient(client));
      container.append(row);
    });
  } catch (error) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-rose-700", textContent: friendlyError(error) }));
  }
}

function renderDocumentRows(container, documents, uid, emptyMessage, admin = false) {
  container.replaceChildren();
  if (!documents.length) {
    container.append(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-slate-400", textContent: emptyMessage }));
    return;
  }
  documents.forEach(item => {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3 px-5 py-4";
    const icon = document.createElement("span");
    icon.className = "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700";
    icon.innerHTML = '<i data-lucide="file-text" class="h-5 w-5"></i>';
    const detail = document.createElement("span");
    detail.className = "min-w-0 flex-1";
    const title = document.createElement("span");
    title.className = "block truncate text-sm font-semibold text-slate-800";
    title.textContent = item.title || "Document";
    const meta = document.createElement("span");
    meta.className = "mt-1 block truncate text-xs text-slate-500";
    const date = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString("en-US") : "Recently added";
    meta.textContent = `${item.category || "PDF"} · ${date}${admin ? ` · ${Math.max(1, Math.ceil((item.sizeBytes || 0) / 1024))} KB` : ""}`;
    detail.append(title, meta);
    const download = document.createElement("button");
    download.type = "button";
    download.className = "inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50";
    download.innerHTML = '<i data-lucide="download" class="h-4 w-4"></i><span>Download</span>';
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        if (!item.dataBase64) throw new Error("The document file is missing.");
        downloadPdf(item.dataBase64, item.originalName);
      } catch (error) { showToast(friendlyError(error)); }
      finally { download.disabled = false; }
    });
    row.append(icon, detail, download);
    container.append(row);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function loadClientDocuments() {
  const container = document.getElementById("clientDocumentList");
  const user = auth?.currentUser;
  if (!user) return;
  container.replaceChildren(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-slate-400", textContent: "Loading your documents…" }));
  try {
    const result = await getDocs(query(collection(db, "users", user.uid, "documents"), orderBy("createdAt", "desc")));
    const documents = result.docs.map(item => ({ id: item.id, ...item.data() }));
    renderDocumentRows(container, documents, user.uid, "No documents have been shared with you yet.");
  } catch (error) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-rose-700", textContent: friendlyError(error) }));
  }
}

async function loadAdminDocuments(uid) {
  const container = document.getElementById("adminDocumentList");
  container.replaceChildren(Object.assign(document.createElement("p"), { className: "py-3 text-xs text-slate-400", textContent: "Loading client documents…" }));
  try {
    const result = await getDocs(query(collection(db, "users", uid, "documents"), orderBy("createdAt", "desc")));
    const documents = result.docs.map(item => ({ id: item.id, ...item.data() }));
    renderDocumentRows(container, documents, uid, "No documents added for this client yet.", true);
  } catch (error) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "py-3 text-xs text-rose-700", textContent: friendlyError(error) }));
  }
}

function selectClient(client) {
  document.getElementById("balanceEditor").classList.remove("hidden");
  document.getElementById("selectedClientName").textContent = client.displayName || "Client";
  document.getElementById("selectedClientEmail").textContent = client.email || "";
  document.getElementById("selectedClientUid").value = client.uid;
  document.getElementById("editClientBalance").value = Number(client.checkingBalance || 0).toFixed(2);
  document.getElementById("editClientCurrency").value = client.currency || "USD";
  document.getElementById("balanceMessage").classList.add("hidden");
  document.getElementById("documentFormMessage").classList.add("hidden");
  loadAdminDocuments(client.uid);
}

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!firebaseReady) {
    showMessage(authMessage, "Firebase is not configured. Add your Firebase web app values to firebase-config.js and reload this page.");
    return;
  }
  const submit = document.getElementById("loginSubmit");
  submit.disabled = true;
  submit.textContent = "Signing in…";
  authMessage.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, document.getElementById("loginUsername").value.trim(), document.getElementById("loginPassword").value);
  } catch (error) {
    showMessage(authMessage, friendlyError(error));
  } finally {
    submit.disabled = false;
    submit.textContent = "Continue securely";
  }
});

document.getElementById("forgotPassword").addEventListener("click", async () => {
  if (!firebaseReady) return showMessage(authMessage, "Configure Firebase before requesting a password reset.");
  const email = document.getElementById("loginUsername").value.trim();
  if (!email) return showMessage(authMessage, "Enter your email address first.");
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage(authMessage, "If the account exists, a password reset email has been sent.", "success");
  } catch (error) { showMessage(authMessage, friendlyError(error)); }
});

document.getElementById("createClientForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = document.getElementById("createClientSubmit");
  submit.disabled = true;
  submit.textContent = "Creating account…";
  adminMessage.classList.add("hidden");
  try {
    await callAdmin("adminCreateClient", {
      displayName: document.getElementById("newClientName").value.trim(),
      email: document.getElementById("newClientEmail").value.trim(),
      password: document.getElementById("newClientPassword").value,
      checkingBalance: Number(document.getElementById("newClientBalance").value),
      currency: document.getElementById("newClientCurrency").value,
      cardNumber: document.getElementById("newClientCardNumber").value
    });
    event.target.reset();
    document.getElementById("newClientBalance").value = "0.00";
    showMessage(adminMessage, "Demo client account created.", "success");
    await loadClients();
  } catch (error) { showMessage(adminMessage, friendlyError(error)); }
  finally { submit.disabled = false; submit.textContent = "Create demo account"; }
});

document.getElementById("balanceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("balanceMessage");
  try {
    await callAdmin("adminUpdateBalance", {
      uid: document.getElementById("selectedClientUid").value,
      checkingBalance: Number(document.getElementById("editClientBalance").value),
      currency: document.getElementById("editClientCurrency").value
    });
    showMessage(message, "Demo balance updated and audit entry recorded.", "success");
    await loadClients();
  } catch (error) { showMessage(message, friendlyError(error)); }
});

document.getElementById("adminDocumentForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("documentFormMessage");
  const button = document.getElementById("uploadDocumentButton");
  const file = document.getElementById("documentFile").files[0];
  const uid = document.getElementById("selectedClientUid").value;
  if (!uid) return showMessage(message, "Select a client account first.");
  if (!file || file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    return showMessage(message, "Choose a PDF document.");
  }
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) {
    return showMessage(message, "PDF files must be 512 KB or smaller.");
  }
  const documentId = crypto.randomUUID();
  button.disabled = true;
  button.textContent = "Saving PDF…";
  message.classList.add("hidden");
  try {
    await callAdmin("adminAddClientDocument", {
      uid,
      documentId,
      title: document.getElementById("documentTitle").value.trim(),
      description: document.getElementById("documentDescription").value.trim(),
      category: document.getElementById("documentCategory").value,
      originalName: file.name,
      fileBase64: await fileToBase64(file)
    });
    event.target.reset();
    showMessage(message, "PDF saved and shared with the selected client.", "success");
    await loadAdminDocuments(uid);
  } catch (error) {
    showMessage(message, friendlyError(error));
  } finally {
    button.disabled = false;
    button.textContent = "Upload document";
  }
});

document.getElementById("refreshClients").addEventListener("click", loadClients);
document.getElementById("closeBalanceEditor").addEventListener("click", () => document.getElementById("balanceEditor").classList.add("hidden"));
document.getElementById("adminLogout").addEventListener("click", () => signOut(auth));
window.firebaseLogout = () => signOut(auth);
window.loadClientDocuments = loadClientDocuments;

if (!firebaseReady) {
  console.info("Firebase setup needed: edit firebase-config.js before enabling authentication.");
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  functions = getFunctions(firebaseApp);
  onAuthStateChanged(auth, async user => {
    if (!user) {
      document.getElementById("bankingApp").classList.add("hidden");
      document.getElementById("publicSite").classList.remove("hidden");
      return;
    }
    try { setPortal(await resolveRole(user)); }
    catch (error) { showMessage(authMessage, friendlyError(error)); await signOut(auth); }
  });
}
