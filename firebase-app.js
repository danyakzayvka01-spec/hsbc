import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword, deleteUser, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const authMessage = document.getElementById("authMessage");
const adminMessage = document.getElementById("adminFormMessage");
const firebaseReady = isFirebaseConfigured;
let auth, db;
let stopClientProfileListener = () => {};
let stopClientTransactionsListener = () => {};
function addIdentityInputs() {
  const form = document.getElementById("createClientForm");
  if (!form || document.getElementById("newClientPassportNumber")) return;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "mb-5 rounded-xl border border-slate-200 p-4";
  fieldset.innerHTML = `<legend class="px-1 text-xs font-bold text-slate-800">Client identity details</legend>
    <p class="mb-4 text-[10px] leading-4 text-amber-800">Enter the specified data for the client</p>
    <label class="mb-3 block text-xs font-semibold">Card expiration<input id="newClientCardExpiry" required type="month" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <label class="mb-3 block text-xs font-semibold">Passport number<input id="newClientPassportNumber" required maxlength="40" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <label class="mb-3 block text-xs font-semibold">Registered address<input id="newClientRegisteredAddress" required maxlength="200" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <div class="mb-3 grid grid-cols-2 gap-3"><label class="block text-xs font-semibold">Phone number<input id="newClientPhoneNumber" required type="tel" maxlength="32" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <label class="block text-xs font-semibold">Citizenship<input id="newClientCitizenship" required maxlength="80" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label></div>
    <label class="block text-xs font-semibold">Passport issue date<input id="newClientPassportIssueDate" required type="date" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>`;
  document.getElementById("adminFormMessage").before(fieldset);
  const expiryInput = document.getElementById("newClientCardExpiry");
  const now = new Date();
  expiryInput.min = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

addIdentityInputs();

function addTransactionTools() {
  const anchor = document.getElementById("balanceMessage");
  if (!anchor || document.getElementById("adminTransactionForm")) return;
  const panel = document.createElement("div");
  panel.id = "adminTransactionPanel";
  panel.className = "mt-6 border-t border-slate-200 pt-5";
  panel.innerHTML = `<div class="mb-4"><h5 class="text-sm font-semibold">Recent activity for this client</h5><p class="mt-1 text-xs text-slate-500">Add a test income or expense record. The account balance updates automatically.</p></div>
    <form id="adminTransactionForm" class="grid gap-3 sm:grid-cols-2">
      <label class="block text-xs font-semibold">Transaction type<select id="transactionType" class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="expense">Expense</option><option value="income">Income</option></select></label>
      <label class="block text-xs font-semibold">Amount<input id="transactionAmount" required type="number" min="0.01" max="1000000" step="0.01" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="0.00"></label>
      <label class="block text-xs font-semibold">From / Merchant<input id="transactionCounterparty" required maxlength="80" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="Employer or shop"></label>
      <label class="block text-xs font-semibold">For / Description<input id="transactionDescription" required maxlength="120" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="Salary, groceries, utility bill"></label>
      <label class="block text-xs font-semibold">Date<input id="transactionDate" required type="date" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
      <label class="block text-xs font-semibold">Status<select id="transactionStatus" class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option>Completed</option><option>Pending</option></select></label>
      <p id="transactionFormMessage" class="hidden text-xs leading-5 sm:col-span-2" role="status"></p>
      <button id="saveTransactionButton" class="rounded-lg bg-[#db0011] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#b8000e] sm:col-span-2">Add transaction</button>
    </form><div id="adminTransactionList" class="mt-3 divide-y divide-slate-200"></div>`;
  anchor.after(panel);
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  document.getElementById("transactionDate").value = date.toISOString().slice(0, 10);
}

addTransactionTools();

function showMessage(el, message, kind = "error") {
  el.textContent = message;
  el.classList.remove("hidden", "text-rose-700", "text-emerald-700");
  el.classList.add(kind === "success" ? "text-emerald-700" : "text-rose-700");
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("user-not-found") || code.includes("wrong-password")) return "Email or password is incorrect.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a little and try again.";
  if (code.includes("email-already-in-use") || code.includes("email-already-exists")) return "An account with this email already exists. Use another email address.";
  if (code.includes("weak-password")) return "Choose a stronger password (at least 10 characters).";
  if (code.includes("permission-denied")) return "Firebase denied the admin check. In Firebase Console, publish firestore.rules and add admins/{your Auth UID} with enabled=true for this administrator.";
  if (code.includes("unauthenticated")) return "Sign in again and retry.";
  if (code.includes("not-found")) return "The requested client account was not found.";
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
    subscribeClientData();
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

function subscribeClientData() {
  const user = auth.currentUser;
  if (!user) return;
  stopClientProfileListener();
  stopClientTransactionsListener();
  stopClientProfileListener = onSnapshot(doc(db, "users", user.uid), async snap => {
    if (!snap.exists()) {
      showMessage(authMessage, "Your client profile is not set up. Ask an administrator to create the account.");
      await signOut(auth);
      return;
    }
    const record = snap.data();
    window.applyClientRecord(record);
    renderClientIdentity(record);
  }, error => showMessage(authMessage, friendlyError(error)));
  const transactionQuery = query(collection(db, "users", user.uid, "transactions"), orderBy("createdAt", "desc"), limit(50));
  stopClientTransactionsListener = onSnapshot(transactionQuery, snapshot => {
    window.applyClientTransactions(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  }, error => showToast(friendlyError(error)));
}

function renderClientIdentity(record) {
  const settings = document.getElementById("view-settings");
  if (!settings) return;
  let panel = document.getElementById("clientIdentityPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientIdentityPanel";
    panel.className = "mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";
    panel.innerHTML = `<div class="mb-4 flex items-center gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700"><i data-lucide="contact-round" class="h-5 w-5"></i></span><div><h2 class="font-semibold">Personal information</h2><p class="mt-1 text-xs text-slate-500">Details provided for this account</p></div></div><dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2"><div><dt class="text-[11px] text-slate-400">Full name</dt><dd data-identity="fullName" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Passport number</dt><dd data-identity="passportNumber" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Registered address</dt><dd data-identity="registeredAddress" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Phone number</dt><dd data-identity="phoneNumber" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Passport issue date</dt><dd data-identity="passportIssueDate" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Citizenship</dt><dd data-identity="citizenship" class="mt-1 break-words text-sm font-medium">—</dd></div></dl><p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900">Your data is visible only to you; other users do not have access to it.</p>`;
    const heading = settings.querySelector(".mb-7");
    settings.replaceChildren(...(heading ? [heading, panel] : [panel]));
  }
  const values = { fullName: record.displayName, ...(record.identity || {}) };
  panel.querySelectorAll("[data-identity]").forEach(item => {
    const value = values[item.dataset.identity];
    item.textContent = value ? String(value) : "Not provided";
  });
  if (window.lucide) window.lucide.createIcons();
}

async function loadClients() {
  const container = document.getElementById("clientList");
  container.replaceChildren(Object.assign(document.createElement("p"), { className: "p-6 text-sm text-slate-400", textContent: "Loading client records…" }));
  try {
    const result = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(250)));
    const clients = result.docs.map(item => ({ uid: item.id, ...item.data() }));
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

function renderAdminTransactions(container, records) {
  container.replaceChildren();
  if (!records.length) {
    container.append(Object.assign(document.createElement("p"), { className: "py-3 text-xs text-slate-400", textContent: "No transactions added for this client yet." }));
    return;
  }
  records.forEach(record => {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3 py-3";
    const description = document.createElement("span");
    description.className = "min-w-0 flex-1";
    const name = document.createElement("span");
    name.className = "block truncate text-xs font-semibold text-slate-800";
    name.textContent = record.counterparty || "Transaction";
    const note = document.createElement("span");
    note.className = "mt-1 block truncate text-[10px] text-slate-500";
    note.textContent = `${record.description || ""} · ${record.date || ""} · ${record.status || "Completed"}`;
    description.append(name, note);
    const amount = document.createElement("span");
    amount.className = `shrink-0 text-xs font-semibold ${record.type === "income" ? "text-emerald-700" : "text-slate-800"}`;
    amount.textContent = `${record.type === "income" ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency: record.currency || "USD" }).format(Number(record.amount || 0))}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shrink-0 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete transaction: ${record.counterparty || "Transaction"}`);
    remove.addEventListener("click", () => deleteAdminTransaction(record, remove));
    row.append(description, amount, remove);
    container.append(row);
  });
}

async function deleteAdminTransaction(record, button) {
  const uid = document.getElementById("selectedClientUid").value;
  if (!uid || !record.id) return;
  if (!window.confirm(`Delete the ${record.type === "income" ? "income" : "expense"} of ${new Intl.NumberFormat("en-US", { style: "currency", currency: record.currency || "USD" }).format(Number(record.amount || 0))} from ${record.counterparty || "this transaction"}? The account balance will be adjusted too.`)) return;

  if (button) { button.disabled = true; button.textContent = "Deleting…"; }
  const message = document.getElementById("transactionFormMessage");
  try {
    const accountRef = doc(db, "users", uid);
    const transactionRef = doc(db, "users", uid, "transactions", record.id);
    let updatedBalance = 0;
    await runTransaction(db, async firestoreTransaction => {
      const [accountSnapshot, transactionSnapshot] = await Promise.all([
        firestoreTransaction.get(accountRef),
        firestoreTransaction.get(transactionRef)
      ]);
      if (!accountSnapshot.exists() || !transactionSnapshot.exists()) throw new Error("The account or transaction no longer exists.");
      const currentTransaction = transactionSnapshot.data();
      const amount = Number(currentTransaction.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("This transaction has an invalid amount and cannot be deleted safely.");
      const balanceChange = currentTransaction.type === "income" ? -amount : amount;
      updatedBalance = Math.round((Number(accountSnapshot.data().checkingBalance || 0) + balanceChange) * 100) / 100;
      if (updatedBalance < 0) throw new Error("The balance cannot be adjusted safely. Update the client's balance before deleting this income.");
      firestoreTransaction.update(accountRef, { checkingBalance: updatedBalance, updatedAt: serverTimestamp() });
      firestoreTransaction.delete(transactionRef);
    });
    document.getElementById("editClientBalance").value = updatedBalance.toFixed(2);
    showMessage(message, "Transaction deleted and account balance adjusted.", "success");
    await Promise.all([loadAdminTransactions(uid), loadClients()]);
  } catch (error) {
    showMessage(message, friendlyError(error));
    await loadAdminTransactions(uid);
  }
}

async function loadAdminTransactions(uid) {
  const container = document.getElementById("adminTransactionList");
  container.replaceChildren(Object.assign(document.createElement("p"), { className: "py-3 text-xs text-slate-400", textContent: "Loading transactions…" }));
  try {
    const result = await getDocs(query(collection(db, "users", uid, "transactions"), orderBy("createdAt", "desc"), limit(50)));
    renderAdminTransactions(container, result.docs.map(item => ({ id: item.id, ...item.data() })));
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
  document.getElementById("transactionFormMessage").classList.add("hidden");
  loadAdminTransactions(client.uid);
}

async function createClientAccount(profile) {
  if (!auth?.currentUser) throw new Error("Sign in with the administrator account first.");
  const adminProfile = await getDoc(doc(db, "admins", auth.currentUser.uid));
  if (!adminProfile.exists() || adminProfile.data().enabled !== true) throw new Error("Only an enabled administrator can create client accounts.");
  if (typeof profile.password !== "string" || profile.password.length < 10 || profile.password.length > 128) throw new Error("The password must contain 10 to 128 characters.");
  const normalizedCardNumber = String(profile.cardNumber || "").replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(normalizedCardNumber)) throw new Error("Enter a fictional card number with 12 to 19 digits.");
  if (!Number.isFinite(profile.checkingBalance) || profile.checkingBalance < 0 || profile.checkingBalance > 1_000_000) throw new Error("The opening balance must be between 0 and 1,000,000.");
  if (!["USD", "EUR", "GBP"].includes(profile.currency)) throw new Error("Choose USD, EUR, or GBP.");
  if (!profile.displayName || profile.displayName.length > 80) throw new Error("Enter the client's full name.");
  if (!profile.passportNumber || profile.passportNumber.length > 40 || !profile.registeredAddress || profile.registeredAddress.length > 200 || !profile.phoneNumber || profile.phoneNumber.length > 32 || !profile.citizenship || profile.citizenship.length > 80) throw new Error("Complete all client identity fields.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(profile.cardExpiry)) throw new Error("Choose a valid card expiration month.");
  const [expiryYear, expiryMonth] = profile.cardExpiry.split("-").map(Number);
  const currentMonth = new Date();
  if (expiryYear < currentMonth.getFullYear() || (expiryYear === currentMonth.getFullYear() && expiryMonth < currentMonth.getMonth() + 1)) throw new Error("The card expiration must be this month or later.");
  const issueDate = new Date(`${profile.passportIssueDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.passportIssueDate) || Number.isNaN(issueDate.getTime()) || issueDate.toISOString().slice(0, 10) !== profile.passportIssueDate) throw new Error("Enter a valid passport issue date.");

  const secondaryApp = initializeApp(firebaseConfig, `client-creator-${crypto.randomUUID()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser = null;
  let profileRef = null;
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, profile.email.trim().toLowerCase(), profile.password);
    createdUser = credential.user;
    const cardNumber = normalizedCardNumber;
    profileRef = doc(db, "users", createdUser.uid);
    await setDoc(profileRef, {
      displayName: profile.displayName,
      email: createdUser.email,
      checkingBalance: Math.round(profile.checkingBalance * 100) / 100,
      currency: profile.currency,
      cardNumber,
      cardLast4: cardNumber.slice(-4),
      cardExpiry: profile.cardExpiry,
      identity: {
        passportNumber: profile.passportNumber,
        registeredAddress: profile.registeredAddress,
        phoneNumber: profile.phoneNumber,
        passportIssueDate: profile.passportIssueDate,
        citizenship: profile.citizenship
      },
      role: "client",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    if (profileRef) await deleteDoc(profileRef).catch(() => {});
    if (createdUser) await deleteUser(createdUser).catch(() => {});
    if (error.code === "auth/email-already-in-use") throw new Error("An account with this email already exists. Use another email address.");
    if (error.code === "auth/weak-password") throw new Error("Choose a stronger password (at least 10 characters).");
    throw error;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
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
    await createClientAccount({
      displayName: document.getElementById("newClientName").value.trim(),
      email: document.getElementById("newClientEmail").value.trim(),
      password: document.getElementById("newClientPassword").value,
      checkingBalance: Number(document.getElementById("newClientBalance").value),
      currency: document.getElementById("newClientCurrency").value,
      cardNumber: document.getElementById("newClientCardNumber").value,
      cardExpiry: document.getElementById("newClientCardExpiry").value,
      passportNumber: document.getElementById("newClientPassportNumber").value.trim(),
      registeredAddress: document.getElementById("newClientRegisteredAddress").value.trim(),
      phoneNumber: document.getElementById("newClientPhoneNumber").value.trim(),
      passportIssueDate: document.getElementById("newClientPassportIssueDate").value,
      citizenship: document.getElementById("newClientCitizenship").value.trim()
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
    await updateDoc(doc(db, "users", document.getElementById("selectedClientUid").value), {
      checkingBalance: Number(document.getElementById("editClientBalance").value),
      currency: document.getElementById("editClientCurrency").value,
      updatedAt: serverTimestamp()
    });
    showMessage(message, "Account balance updated.", "success");
    await loadClients();
  } catch (error) { showMessage(message, friendlyError(error)); }
});

document.getElementById("adminTransactionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("transactionFormMessage");
  const button = document.getElementById("saveTransactionButton");
  const uid = document.getElementById("selectedClientUid").value;
  if (!uid) return showMessage(message, "Select a client account first.");
  const amount = Number(document.getElementById("transactionAmount").value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return showMessage(message, "Enter an amount greater than 0 and no more than 1,000,000.");
  button.disabled = true;
  button.textContent = "Adding transaction…";
  message.classList.add("hidden");
  try {
    const accountRef = doc(db, "users", uid);
    const transactionRef = doc(collection(db, "users", uid, "transactions"));
    const type = document.getElementById("transactionType").value;
    const counterparty = document.getElementById("transactionCounterparty").value.trim();
    const description = document.getElementById("transactionDescription").value.trim();
    let updatedBalance = 0;
    await runTransaction(db, async firestoreTransaction => {
      const accountSnapshot = await firestoreTransaction.get(accountRef);
      if (!accountSnapshot.exists()) throw new Error("The selected client account no longer exists.");
      const account = accountSnapshot.data();
      const currentBalance = Number(account.checkingBalance || 0);
      const signedAmount = type === "income" ? amount : -amount;
      updatedBalance = Math.round((currentBalance + signedAmount) * 100) / 100;
      if (updatedBalance < 0) throw new Error("This expense is greater than the client's current balance.");
      firestoreTransaction.update(accountRef, { checkingBalance: updatedBalance, updatedAt: serverTimestamp() });
      firestoreTransaction.set(transactionRef, {
        type,
        counterparty,
        description,
        amount: Math.round(amount * 100) / 100,
        currency: account.currency || "USD",
        date: document.getElementById("transactionDate").value,
        status: document.getElementById("transactionStatus").value,
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
    });
    event.target.reset();
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    document.getElementById("transactionDate").value = today.toISOString().slice(0, 10);
    showMessage(message, "Transaction added to the client's recent activity.", "success");
    document.getElementById("editClientBalance").value = updatedBalance.toFixed(2);
    await loadAdminTransactions(uid);
    await loadClients();
  } catch (error) {
    if (error.code === "permission-denied") {
      const adminRecord = await getDoc(doc(db, "admins", auth.currentUser.uid)).catch(() => null);
      showMessage(message, adminRecord?.exists() && adminRecord.data().enabled === true
        ? "Firestore denied this write. Publish the latest firestore.rules file, then sign out and sign in again."
        : "This login is not enabled as an administrator. Check admins/{your Auth UID} has enabled=true.");
    } else showMessage(message, friendlyError(error));
  } finally {
    button.disabled = false;
    button.textContent = "Add transaction";
  }
});

document.getElementById("refreshClients").addEventListener("click", loadClients);
document.getElementById("closeBalanceEditor").addEventListener("click", () => document.getElementById("balanceEditor").classList.add("hidden"));
document.getElementById("adminLogout").addEventListener("click", () => signOut(auth));
window.firebaseLogout = () => signOut(auth);

if (!firebaseReady) {
  console.info("Firebase setup needed: edit firebase-config.js before enabling authentication.");
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  onAuthStateChanged(auth, async user => {
    if (!user) {
      stopClientProfileListener();
      stopClientTransactionsListener();
      document.getElementById("bankingApp").classList.add("hidden");
      document.getElementById("publicSite").classList.remove("hidden");
      return;
    }
    try { setPortal(await resolveRole(user)); }
    catch (error) { showMessage(authMessage, friendlyError(error)); await signOut(auth); }
  });
}
